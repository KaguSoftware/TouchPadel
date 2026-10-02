/**
 * The hold ladder on lesson bookings (plan "Coaching: make it bulletproof" TG-04; build contracts
 * D-4, R30, R31; docs/design/coaching/db.md §4.7.4 step 4). In one rolled-back transaction
 * (coaching-core-harness.ts):
 *
 *   * two unsettled lesson strikes put a guest in cooldown: lesson_book_private, lesson_join and
 *     course_join each refuse HOLD_COOLDOWN and write nothing (the settle the ladder ran rolls
 *     back with the refusal, so the strikes are still unsettled after);
 *   * a suspended standing refuses BOOKING_SUSPENDED;
 *   * with the ladder switched off (platform_settings.hold_strikes_since NULL) the same guest books;
 *   * a coach's and the desk's cancels inside the late window leave no strike; the guest's own late
 *     cancel, the control, does.
 *
 * Plus a source-text pin: in the latest body of each guest write, lesson_guest_ladder runs after
 * lock_principal (one guest at a time) and before lock_coach (never under a coach lock).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { at, data, E, failed, FROM, R, SETUP } from './coaching-core-harness';
import { latestBody } from './coaching-source';

const up = await stackAvailable();
const docker = up && dockerReachable();

const BOOK = (label: string, who: string, when: string) =>
  E(
    label,
    who,
    `select app.lesson_book_private({{c1}}, {{lt_p}}, ${when}, 1, '{}'::text[], 'desk', 30000, 'k-${label}')`,
  );
const DESK_FOR = (label: string, guest: string, when: string) =>
  E(
    label,
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_p}}, ${when}, {{${guest}}}, null, null, 1, 'k-${label}')`,
  );
/** A strike planted on a lesson and enrolment of a guest, struck now. */
const STRIKE = (guest: string, lesson: string, enrolment: string) =>
  X(`insert into lesson_strikes (enrolment_id, lesson_id, venue_id, guest_id, kind)
     values ({{${enrolment}}}::uuid, {{${lesson}}}::uuid, {{v}}::uuid, {{${guest}}}::uuid, 'late_cancel')`);
const ROWS = (label: string, guest: string) =>
  R(
    label,
    `select jsonb_build_object(
       'enrolments', (select count(*) from lesson_enrolments where guest_id = {{${guest}}}::uuid),
       'lessons', (select count(*) from lessons where created_by_profile_id = {{${guest}}}::uuid),
       'unsettled', (select count(*) from lesson_strikes where guest_id = {{${guest}}}::uuid and settled_at is null))`,
  );
const STRIKES = (label: string, guest: string) =>
  R(label, `select to_jsonb(count(*)) from lesson_strikes where guest_id = {{${guest}}}::uuid`);

describe.skipIf(!docker)('the hold ladder on lesson bookings (TG-04, rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('ctg04', [
      SETUP,
      `select pg_temp.branch('v');`,
      X(`update venue_settings set cancellation_window_hours = 12 where venue_id = {{v}}::uuid`),
      X(`update platform_settings set hold_strikes_since = now() - interval '1 day' where id`),
      `select pg_temp.guest('g1');`,
      ...['s1', 's2', 's4', 's5'].map((g) => `select pg_temp.guest('${g}');`),
      `select pg_temp.coach('c1', 'g1', 'v');`,
      `select pg_temp.lt('lt_p', 'private', 'v');`,
      `select pg_temp.lt('lt_g', 'group', 'v');`,
      `select pg_temp.lt('lt_c', 'course', 'v');`,
      ...['lt_p', 'lt_g', 'lt_c'].map((t) => `select pg_temp.teach('c1', '${t}');`),
      E('grp', 'desk', `select app.desk_create_group({{c1}}, {{lt_g}}, ${at(3)}, 'k-grp')`),
      FROM('grp_lesson', 'grp', 'lesson_id'),
      E(
        'crs',
        'desk',
        `select app.desk_create_course({{c1}}, {{lt_c}},
           array[${at(4)}, ${at(5)}, ${at(6)}, ${at(7)}]::timestamptz[], '', '', 'k-crs')`,
      ),
      FROM('crs_id', 'crs', 'course_id'),

      // ── s1: two unsettled strikes (on two desk bookings made for them) ──
      DESK_FOR('s1_a', 's1', at(8)),
      DESK_FOR('s1_b', 's1', at(8, 2)),
      FROM('s1_a_l', 's1_a', 'lesson_id'),
      FROM('s1_a_e', 's1_a', 'enrolment_id'),
      FROM('s1_b_l', 's1_b', 'lesson_id'),
      FROM('s1_b_e', 's1_b', 'enrolment_id'),
      STRIKE('s1', 's1_a_l', 's1_a_e'),
      STRIKE('s1', 's1_b_l', 's1_b_e'),
      ROWS('s1_before', 's1'),
      BOOK('cool_book', 's1', at(2)),
      E('cool_join', 's1', `select app.lesson_join({{grp_lesson}}, 'desk', 15000, 'k-cool_join')`),
      E('cool_course', 's1', `select app.course_join({{crs_id}}, 'desk', 80000, 'k-cool_course')`),
      ROWS('s1_after', 's1'),

      // ── s2: suspended ────────────────────────────────────────────────────
      X(`insert into hold_standing (key, guest_id, strikes, last_strike_at, blocked_until, suspended_at, needs_review)
         values (app.hold_standing_key({{s2}}::uuid), {{s2}}::uuid, 4, now() - interval '1 hour',
                 now() + interval '7 days', now() - interval '1 hour', true)`),
      BOOK('susp_book', 's2', at(2, 2)),
      E('susp_join', 's2', `select app.lesson_join({{grp_lesson}}, 'desk', 15000, 'k-susp_join')`),

      // ── coach and desk cancels inside the late window; the guest's own, the control ──
      BOOK('dc', 's4', at(0, 5)),
      FROM('dc_e', 'dc', 'enrolment_id'),
      E('dc_cancel', 'desk', `select app.desk_cancel_enrolment({{dc_e}}, 'customer_request')`),
      BOOK('dl', 's4', at(0, 7)),
      FROM('dl_lesson', 'dl', 'lesson_id'),
      E('dl_cancel', 'desk', `select app.desk_cancel_lesson({{dl_lesson}}, 'court_needed')`),
      BOOK('cc', 's4', at(0, 9)),
      FROM('cc_lesson', 'cc', 'lesson_id'),
      E('cc_cancel', 'g1', `select app.coach_cancel_lesson({{cc_lesson}}, 'coach_unavailable')`),
      E('gj', 's4', `select app.lesson_join({{grp_lesson}}, 'desk', 15000, 'k-gj')`),
      FROM('gj_e', 'gj', 'enrolment_id'),
      E('rm_cancel', 'g1', `select app.coach_remove_student({{gj_e}}, 'other')`),
      STRIKES('s4_strikes', 's4'),
      BOOK('own', 's5', at(0, 11)),
      FROM('own_e', 'own', 'enrolment_id'),
      E('own_cancel', 's5', `select app.lesson_cancel_mine({{own_e}})`),
      STRIKES('s5_strikes', 's5'),

      // ── the ladder switched off: s1 books, s2 joins ──────────────────────
      X(`update platform_settings set hold_strikes_since = null where id`),
      BOOK('off_book', 's1', at(2, 4)),
      E('off_join', 's2', `select app.lesson_join({{grp_lesson}}, 'desk', 15000, 'k-off_join')`),
    ]);
  });

  it('two unsettled lesson strikes: HOLD_COOLDOWN from the private booking, the join and the course join; nothing written', () => {
    for (const label of ['cool_book', 'cool_join', 'cool_course'])
      expect(failed(r, label).code, label).toBe('HOLD_COOLDOWN');
    expect(data(r, 's1_before')).toEqual({ enrolments: 2, lessons: 0, unsettled: 2 });
    expect(data(r, 's1_after')).toEqual(data(r, 's1_before'));
  });

  it('a suspended standing is BOOKING_SUSPENDED', () => {
    expect(failed(r, 'susp_book').code).toBe('BOOKING_SUSPENDED');
    expect(failed(r, 'susp_join').code).toBe('BOOKING_SUSPENDED');
  });

  it('the ladder switched off: the same guests book and join', () => {
    expect(data(r, 'off_book')).toMatchObject({ duplicate: false, status: 'booked' });
    expect(data(r, 'off_join')).toMatchObject({ duplicate: false, status: 'booked' });
  });

  it('coach and desk cancels inside the late window strike nobody; the guest late cancel does', () => {
    for (const label of ['dc_cancel', 'dl_cancel', 'cc_cancel', 'rm_cancel']) data(r, label);
    expect(data(r, 's4_strikes')).toBe(0);
    expect(data(r, 'own_cancel')).toMatchObject({ cancel_kind: 'guest_late', strike: true });
    expect(data(r, 's5_strikes')).toBe(1);
  });
});

describe('the ladder runs between the guest lock and the coach lock (TG-04, source)', () => {
  it.each(['lesson_book_private', 'lesson_join', 'course_join'])('%s', (fn) => {
    const { body } = latestBody(fn);
    const principal = body.indexOf("app.lock_principal('hold_slot'");
    const ladder = body.indexOf('app.lesson_guest_ladder(');
    const coach = body.indexOf('app.lock_coach(');
    expect(principal, 'lock_principal').toBeGreaterThan(0);
    expect(ladder, 'lesson_guest_ladder').toBeGreaterThan(principal);
    expect(coach, 'lock_coach').toBeGreaterThan(ladder);
  });
});
