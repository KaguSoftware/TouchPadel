/**
 * Month boundaries at branch-local midnight (plan "Coaching: make it bulletproof" TG-13; money.md
 * CM-16, §7; build contracts §1.15 D3). In one rolled-back transaction (coaching-core-harness.ts),
 * at an Asia/Baghdad branch, three completed, paid private lessons of one coach:
 *
 *   * L_last: 23:30 on the last day of month A running to 00:30 on the 1st of month B (D3: a
 *     lesson may cross midnight);
 *   * L_first: 00:30 to 01:30 on the 1st of month B;
 *   * L_mid: 10:00 on the 10th of month B.
 *
 * Statements are local calendar months by the lesson's start (CM-16): month A's statement holds
 * L_last as a regular line and nothing of B; once A is approved, month B's holds L_first and L_mid
 * as regular lines, with no adjustment for A. report_lessons counts business days instead (from
 * 04:00): L_last and L_first both fall on A's last business day, so month A's report has both and
 * month B's only L_mid.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, type Results } from './stores-harness';
import { data, E, K, R, SETUP } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

const MONTH_FNS = String.raw`
-- The first of a branch-local month, k months from this one.
create function pg_temp.m(k int) returns date language sql as $f$
  select (date_trunc('month', now() at time zone 'Asia/Baghdad') + make_interval(months => k))::date
$f$;
-- Local time on day d of month k, h hours past midnight.
create function pg_temp.lm(k int, d int, h numeric) returns timestamptz language sql as $f$
  select ((pg_temp.m(k) + (d - 1))::timestamp + h * interval '1 hour') at time zone 'Asia/Baghdad'
$f$;
-- A completed private lesson of c1 at v, paid online by p_guest.
create function pg_temp.done(p_name text, p_guest text, p_start timestamptz) returns void language plpgsql as $f$
declare l uuid; e uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into lessons (venue_id, coach_id, lesson_type_id, kind, start_at, end_at, price_iqd, court_share_iqd,
                       coach_share_bp, max_places, min_places, status, completed_at, booked_by_kind,
                       created_by_staff_id)
  values (pg_temp.var('v')::uuid, pg_temp.var('c1')::uuid, pg_temp.var('lt_p')::uuid, 'private', p_start,
          p_start + interval '1 hour', 30000, 5000, 6000, 2, 1, 'completed', p_start + interval '1 hour', 'staff',
          pg_temp.var('desk')::uuid)
  returning id into l;
  insert into lesson_enrolments (venue_id, lesson_id, guest_id, booked_by_kind, booked_by_profile_id,
                                 link_confirmed_at, price_iqd, payment_mode, status)
  values (pg_temp.var('v')::uuid, l, pg_temp.var(p_guest)::uuid, 'guest', pg_temp.var(p_guest)::uuid,
          p_start - interval '2 days', 30000, 'online', 'booked')
  returning id into e;
  insert into booking_payments (purpose, provider, sandbox, request_id, amount_iqd, quoted_price_iqd, status, locale,
                                deadline_at, succeeded_at, guest_id, venue_id, lesson_enrolment_id)
  values ('lesson', 'fake', false, gen_random_uuid(), 30000, 30000, 'succeeded', 'en',
          p_start - interval '2 days', p_start - interval '2 days', pg_temp.var(p_guest)::uuid,
          pg_temp.var('v')::uuid, e);
  insert into pg_temp.vars values (p_name, l::text) on conflict (name) do update set val = excluded.val;
end $f$;
`;

/** Month A is two months back, B the month after it (both over at the branch). */
const A = -3;
const B = -2;

const LINES = (label: string, month: number) =>
  R(
    label,
    `select coalesce(jsonb_object_agg(
              case ln.lesson_id when {{L_last}}::uuid then 'L_last' when {{L_first}}::uuid then 'L_first'
                                when {{L_mid}}::uuid then 'L_mid' else ln.lesson_id::text end,
              jsonb_build_object('adj', ln.is_adjustment, 'collected', ln.collected_iqd)), '{}'::jsonb)
       from coach_statement_lines ln
       join coach_statements st on st.id = ln.statement_id
      where st.coach_id = {{c1}}::uuid and st.month = pg_temp.m(${month}) and st.status <> 'void'`,
  );
/** report_lessons for a whole local month, as the manager scoped to v. */
const REPORT = (label: string, month: number) =>
  E(
    label,
    'manager',
    `select app.report_lessons(pg_temp.m(${month}), (pg_temp.m(${month + 1}) - 1))
       from (select set_config('app.venue_id', {{v}}, true)) scope`,
  );

describe.skipIf(!docker)('month boundaries at branch-local midnight (TG-13, rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('ctg13', [
      SETUP,
      MONTH_FNS,
      `select pg_temp.branch('v');`,
      `select pg_temp.guest('g1');`,
      `select pg_temp.guest('s1');`,
      `select pg_temp.coach('c1', 'g1', 'v');`,
      `select pg_temp.lt('lt_p', 'private', 'v');`,
      `select pg_temp.teach('c1', 'lt_p');`,
      `select pg_temp.done('L_last', 's1', pg_temp.lm(${B}, 1, 0) - interval '30 minutes');`,
      `select pg_temp.done('L_first', 's1', pg_temp.lm(${B}, 1, 0.5));`,
      `select pg_temp.done('L_mid', 's1', pg_temp.lm(${B}, 10, 10));`,

      E(
        'build_a',
        null,
        `select to_jsonb(app.coach_statement_build({{c1}}, {{v}}, pg_temp.m(${A})))`,
      ),
      LINES('lines_a', A),
      K(
        'st_a',
        `select id::text from coach_statements where coach_id = {{c1}}::uuid and month = pg_temp.m(${A})`,
      ),
      E(
        'approve_a',
        'manager',
        `select app.coach_statement_approve({{st_a}}) from (select set_config('app.venue_id', {{v}}, true)) scope`,
      ),
      E(
        'build_b',
        null,
        `select to_jsonb(app.coach_statement_build({{c1}}, {{v}}, pg_temp.m(${B})))`,
      ),
      LINES('lines_b', B),

      REPORT('rep_a', A),
      REPORT('rep_b', B),
      R('a_last_day', `select to_jsonb((pg_temp.m(${B}) - 1)::text)`),
      R('b_tenth', `select to_jsonb((pg_temp.m(${B}) + 9)::text)`),
    ]);
  });

  it("month A's statement: the 23:30-00:30 lesson as a regular line, nothing of month B", () => {
    expect(data(r, 'build_a')).not.toBeNull();
    expect(data(r, 'lines_a')).toEqual({ L_last: { adj: false, collected: 30000 } });
  });

  it("after A is approved, month B's statement: the 00:30 lesson and the 10th as regular lines, no adjustment", () => {
    expect(data(r, 'approve_a')).toMatchObject({ status: 'approved' });
    expect(data(r, 'build_b')).not.toBeNull();
    expect(data(r, 'lines_b')).toEqual({
      L_first: { adj: false, collected: 30000 },
      L_mid: { adj: false, collected: 30000 },
    });
  });

  it('report_lessons splits by business day: both midnight lessons on A’s last day, B has the 10th only', () => {
    type Rep = {
      totals: { lessons: number };
      byDay: Array<{ date: string; lessons: number; collectedIqd: number }>;
    };
    const a = data<Rep>(r, 'rep_a');
    expect(a.totals.lessons).toBe(2);
    expect(a.byDay.filter((d) => d.lessons > 0)).toEqual([
      expect.objectContaining({ date: data(r, 'a_last_day'), lessons: 2, collectedIqd: 60000 }),
    ]);
    const b = data<Rep>(r, 'rep_b');
    expect(b.totals.lessons).toBe(1);
    expect(b.byDay.filter((d) => d.lessons > 0)).toEqual([
      expect.objectContaining({ date: data(r, 'b_tenth'), lessons: 1, collectedIqd: 30000 }),
    ]);
  });
});
