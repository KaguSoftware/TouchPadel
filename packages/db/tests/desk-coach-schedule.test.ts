/**
 * 0356 desk_coach_schedule: the court desk's Coaches tab (Sait 2026-10-21).
 *
 * In one rolled-back transaction (coaching-core-harness.ts):
 *   * the court desk, the manager and the owner read it; a guest and the
 *     cashier are FORBIDDEN, a window over 7 days INVALID_ARGUMENT p_to;
 *   * a coach active at the branch is listed with their hours here, their
 *     time off in the window (no reason) and their lessons as busy; a retired
 *     coach and one not active at the branch are not;
 *   * a lesson at another branch is busy with no id; one here carries its id;
 *   * nothing carries the coach's phone, profile or a price.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { at, code, data, E, FROM, SETUP } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;
interface Coach {
  coach_id: string;
  status: string;
  hours: { weekday: number; start_time: string; end_time: string }[];
  time_off: Json[];
  busy: { lesson_id: string | null; here: boolean; start_at: string; end_at: string }[];
}

const WINDOW = `${at(1)}, ${at(3)}`;
const READ = (label: string, who: string, window = WINDOW) =>
  E(label, who, `select app.desk_coach_schedule({{v}}::uuid, ${window})`);

const BODY: string[] = [
  SETUP,
  `select pg_temp.branch('v');`,
  `select pg_temp.branch('w');`,
  `select pg_temp.guest('g1');`,
  `select pg_temp.guest('g2');`,
  `select pg_temp.guest('g3');`,
  `select pg_temp.guest('g4');`,
  `select pg_temp.coach('c1', 'g1');`,
  `select pg_temp.at_branch('c1', 'w');`,
  `select pg_temp.coach('gone', 'g2');`,
  X(`update coaches set status = 'retired', retired_at = now() where id = {{gone}}::uuid`),
  `select pg_temp.coach('away', 'g3', 'w');`,
  `select pg_temp.lt('lt_v', 'private');`,
  `select pg_temp.lt('lt_w', 'private', 'w');`,
  `select pg_temp.teach('c1', 'lt_v');`,
  `select pg_temp.teach('c1', 'lt_w');`,
  // Hours here: Sunday 10:00-14:00 only (the other branch keeps all day).
  X(`delete from coach_hours where coach_id = {{c1}}::uuid and venue_id = {{v}}::uuid`),
  X(`insert into coach_hours (coach_id, venue_id, weekday, start_time, end_time, set_by)
     values ({{c1}}::uuid, {{v}}::uuid, 0, '10:00', '14:00', 'coach')`),
  // Time off inside the window, and one long past it.
  X(`insert into coach_time_off (coach_id, period, reason, set_by)
     values ({{c1}}::uuid, tstzrange(${at(1, 2)}, ${at(1, 4)}, '[)'), 'dentist', 'coach'),
            ({{c1}}::uuid, tstzrange(${at(9)}, ${at(10)}, '[)'), 'trip', 'coach')`),
  // A lesson at each branch inside the window: hours all day while booking.
  X(`delete from coach_hours where coach_id = {{c1}}::uuid and venue_id = {{v}}::uuid`),
  X(`insert into coach_hours (coach_id, venue_id, weekday, start_time, end_time, set_by)
     select {{c1}}::uuid, {{v}}::uuid, d, '00:00', '24:00', 'coach' from generate_series(0, 6) d`),
  E(
    'book_here',
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_v}}, ${at(2, 1)}, null, 'Walk In', null, 1, 'k-dcs-here')`,
  ),
  FROM('lesson_here', 'book_here', 'lesson_id'),
  X(`insert into staff_venues (staff_id, venue_id, role)
     values (pg_temp.var('desk')::uuid, {{w}}::uuid, 'court_desk') on conflict do nothing`),
  `select set_config('app.venue_id', '', true);`,
  E(
    'book_there',
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_w}}, ${at(2, 5)}, null, 'Walk In W', null, 1, 'k-dcs-there')`,
  ),
  X(`delete from coach_hours where coach_id = {{c1}}::uuid and venue_id = {{v}}::uuid`),
  X(`insert into coach_hours (coach_id, venue_id, weekday, start_time, end_time, set_by)
     values ({{c1}}::uuid, {{v}}::uuid, 0, '10:00', '14:00', 'coach')`),

  READ('desk', 'desk'),
  READ('manager', 'manager'),
  READ('owner', 'owner'),
  READ('guest', 'g4'),
  READ('cashier', 'cashier'),
  READ('too_long', 'desk', `${at(1)}, ${at(9)}`),
];

describe.skipIf(!docker)('0356 desk_coach_schedule, one transaction', () => {
  let r: Results;
  beforeAll(() => {
    r = scenario('c356', BODY);
  });

  it('answers the desk, the manager and the owner, and refuses everyone else', () => {
    expect(data(r, 'desk')).toBeDefined();
    expect(data(r, 'manager')).toBeDefined();
    expect(data(r, 'owner')).toBeDefined();
    expect(code(r, 'guest')).toBe('FORBIDDEN');
    expect(code(r, 'cashier')).toBe('FORBIDDEN');
    expect(code(r, 'too_long')).toBe('INVALID_ARGUMENT:p_to');
  });

  it("lists the branch's coaches with their hours here, their time off and their lessons", () => {
    expect(data(r, 'book_here')).toMatchObject({ lesson_id: expect.any(String) });
    expect(data(r, 'book_there')).toMatchObject({ lesson_id: expect.any(String) });
    const out = data<{ timezone: string; coaches: Coach[] }>(r, 'desk');
    expect(out.timezone).toBe('Asia/Baghdad');
    expect(out.coaches).toHaveLength(1);
    const c = out.coaches[0]!;
    expect(c.hours).toEqual([{ weekday: 0, start_time: '10:00', end_time: '14:00' }]);
    expect(c.time_off).toHaveLength(1);
    expect(Object.keys(c.time_off[0]!).sort()).toEqual(['ends_at', 'starts_at']);
    expect(c.busy).toHaveLength(2);
    const here = c.busy.find((b) => b.here)!;
    const there = c.busy.find((b) => !b.here)!;
    expect(here.lesson_id).toBe(data<Json>(r, 'book_here').lesson_id);
    expect(there.lesson_id).toBeNull();
  });

  it('carries no phone, profile or money', () => {
    const text = JSON.stringify(data(r, 'desk'));
    for (const key of ['phone', 'profile_id', 'full_name', 'price_iqd', 'reason', 'dentist']) {
      expect(text).not.toContain(key);
    }
  });
});
