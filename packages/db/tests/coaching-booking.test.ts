/**
 * Coaching, database sub-step 0283 lesson_booking, the core writes
 * (docs/design/coaching/db.md §4.7, §6, §7; build contracts C-1, C-2, C-8,
 * C-9, C-10, C-13, C-15, C-19, C-20, C-21, C-23, C-24, C-25, CD-2, CD-9,
 * CD-11, R8, R9, R10, R25, R30, R32, R34, R44, R45, R47, R50, R56, R61, R66,
 * R73, R81).
 *
 * In one rolled-back transaction (coaching-core-harness.ts):
 *   * a private lesson booked by a guest (the enrolment's status, X5; the
 *     court row: kind lesson, guest_id NULL, 'Lesson', no price; one event),
 *     replayed, a stranger's key, PRICE_CHANGED, the 30-minute grid (R9),
 *     COACH_BUSY, PARTY_TOO_LARGE, the horizon, coaching off (the desk may
 *     stage, D-12), a coach who has not accepted (R61), self-enrolment (R56);
 *   * online: held with a hold row (R1), the hold cap counting held lessons
 *     (R30), the lessons terms (R50), a held lesson not movable (R32), its
 *     cancel expiring the hold row at once (R25);
 *   * courts: NO_COURT_FREE, and the other court picked (R34);
 *   * a coach's private lesson at one branch against a group at another
 *     (COACH_BUSY: the coach key is branch-free);
 *   * creation inside the cut-off (R47), course starts (count, order, grid with
 *     the session number), joins up to LESSON_FULL, a late course join priced
 *     on the sessions left (C-15);
 *   * reschedule: a course session keeps its order, the last start closes
 *     sign-up, a group's cut-off follows, a guest booked before a reschedule
 *     cancels free inside the window (R8); a late cancel records a strike;
 *   * the typed-phone link (C-21, R10, R44): the same answer matched or not,
 *     pending until "Is this you?", "Not me" unlinks with no event, an
 *     already-enrolled match is not linked;
 *   * hoarding (R56) and the daily cap (CD-9);
 *   * attendance (CD-11, CD-2), the desk's court move (R7), cancels;
 *   * a paused coach (R16) and retirement cancelling everything (C-25, R45).
 * The committed two-connection races (two guests for one coach and slot, two
 * coaches for the branch's last court) are in coaching-races.test.ts (TG-03).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { COACHING_SHAPES, missingKeys } from '../../core/src/coaching/shapes';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { at, code, data, E, failed, FROM, K as KEEP, R, SETUP } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/** A guest's private booking; the key is the label's unless given. */
const BOOK = (
  label: string,
  who: string | null,
  coach: string,
  type: string,
  when: string,
  o: { party?: number; friends?: string; mode?: string; price?: number; key?: string } = {},
) =>
  E(
    label,
    who,
    `select app.lesson_book_private({{${coach}}}, {{${type}}}, ${when}, ${o.party ?? 1}, ` +
      `${o.friends ?? `'{}'::text[]`}, '${o.mode ?? 'desk'}', ${o.price ?? 30000}, '${o.key ?? `k-${label}`}')`,
  );

const JOIN = (label: string, who: string, lesson: string, price = 15000) =>
  E(label, who, `select app.lesson_join({{${lesson}}}, 'desk', ${price}, 'k-${label}')`);

const CJOIN = (label: string, who: string, course: string, price: number) =>
  E(label, who, `select app.course_join({{${course}}}, 'desk', ${price}, 'k-${label}')`);

/** The coach of `who` adds a student (name, phone) to a group session. */
const ADD = (
  label: string,
  who: string,
  lesson: string,
  name: string,
  phone: string | null,
  key = `k-${label}`,
) =>
  E(
    label,
    who,
    `select app.coach_add_student({{${lesson}}}, null, '${name}', ${phone === null ? 'null' : `'${phone}'`}, '${key}')`,
  );

/** The coach c2 (guest g2) books a private lesson for a walk-in. */
const CB = (label: string, when: string) =>
  E(
    label,
    'g2',
    `select app.coach_book_private({{lt_p}}, {{v}}, ${when}, 'Student ${label}', null, 1, 'k-${label}')`,
  );

const BODY: string[] = [
  SETUP,
  // ── fixtures ────────────────────────────────────────────────────────────
  `select pg_temp.branch('v');`,
  `select pg_temp.branch('w');`,
  `select pg_temp.branch('off', false);`,
  X(`update venue_settings set cancellation_window_hours = 12, max_booking_horizon_days = 60
      where venue_id in ({{v}}::uuid, {{w}}::uuid, {{off}}::uuid)`),
  `select pg_temp.guest('g1');`,
  `select pg_temp.guest('g2');`,
  `select pg_temp.guest('g3');`,
  `select pg_temp.guest('s1');`,
  `select pg_temp.guest('s2');`,
  `select pg_temp.guest('s3');`,
  `select pg_temp.guest('s4', '{"verified": "9647790012345"}');`,
  `select pg_temp.guest('s5', '{"verified": "9647790012346"}');`,
  `select pg_temp.guest('s6', '{"terms": "2026-08-01"}');`,
  `select pg_temp.coach('c1', 'g1', 'v');`,
  `select pg_temp.at_branch('c1', 'w');`,
  `select pg_temp.at_branch('c1', 'off');`,
  `select pg_temp.coach('c2', 'g2', 'v');`,
  `select pg_temp.coach('c3', 'g3', 'v', '{"accepted": false}');`,
  `select pg_temp.lt('lt_p', 'private', 'v');`,
  `select pg_temp.lt('lt_g', 'group', 'v');`,
  `select pg_temp.lt('lt_c', 'course', 'v');`,
  `select pg_temp.lt('lt_g8', 'group', 'v', '{"max_places": 8}');`,
  `select pg_temp.lt('lt_gw', 'group', 'w');`,
  `select pg_temp.lt('lt_po', 'private', 'off');`,
  ...['lt_p', 'lt_g', 'lt_c', 'lt_g8', 'lt_gw', 'lt_po'].map(
    (t) => `select pg_temp.teach('c1', '${t}');`,
  ),
  `select pg_temp.teach('c2', 'lt_p');`,
  `select pg_temp.teach('c3', 'lt_p');`,

  // ── A. a guest's private lesson (C-2, X5) ───────────────────────────────
  BOOK('p1', 's1', 'c1', 'lt_p', at(2), { party: 2, friends: `array['Ali']` }),
  FROM('p1_lesson', 'p1', 'lesson_id'),
  FROM('p1_e', 'p1', 'enrolment_id'),
  R('p1_state', `select pg_temp.lesson_state({{p1_lesson}}::uuid)`),
  BOOK('p1_replay', 's1', 'c1', 'lt_p', at(2), { party: 2, friends: `array['Ali']`, key: 'k-p1' }),
  BOOK('p1_foreign', 's2', 'c1', 'lt_p', at(2), { key: 'k-p1' }),
  BOOK('p_price', 's2', 'c1', 'lt_p', at(2, 2), { price: 29000 }),
  BOOK('p_grid', 's2', 'c1', 'lt_p', at(3, 0, 15)),
  BOOK('p_busy', 's2', 'c1', 'lt_p', at(2)),
  BOOK('p_party', 's2', 'c1', 'lt_p', at(2, 2), { party: 3 }),
  BOOK('p_friends', 's2', 'c1', 'lt_p', at(2, 2), { party: 1, friends: `array['A']` }),
  BOOK('p_self', 'g1', 'c1', 'lt_p', at(2, 2)),
  BOOK('p_unaccepted', 's2', 'c3', 'lt_p', at(2, 2)),
  BOOK('p_off', 's2', 'c1', 'lt_po', at(2, 2)),
  BOOK('p_horizon', 's2', 'c1', 'lt_p', at(70)),
  BOOK('p_anon', null, 'c1', 'lt_p', at(2, 2)),
  BOOK('p_online_off', 's2', 'c1', 'lt_p', at(2, 2), { mode: 'online' }),
  E(
    'desk_off',
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_po}}, ${at(2, 4)}, null, 'Walk In', null, 1, 'k-desk_off')`,
  ),
  E(
    'desk_unaccepted',
    'desk',
    `select app.desk_book_lesson({{c3}}, {{lt_p}}, ${at(3, 4)}, null, 'Walk In 2', null, 1, 'k-desk_unacc')`,
  ),
  E(
    'desk_self',
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_p}}, ${at(3, 6)}, {{g1}}, null, null, 1, 'k-desk_self')`,
  ),

  // ── B. online: held, the cap, the terms, not movable, released at once ──
  `select pg_temp.online('v');`,
  X(`update platform_settings set max_live_holds_per_guest = 1 where id`),
  BOOK('h1', 's3', 'c1', 'lt_p', at(3), { mode: 'online' }),
  FROM('h1_lesson', 'h1', 'lesson_id'),
  FROM('h1_e', 'h1', 'enrolment_id'),
  R('h1_state', `select pg_temp.lesson_state({{h1_lesson}}::uuid)`),
  BOOK('h2', 's3', 'c1', 'lt_p', at(3, 2), { mode: 'online' }),
  BOOK('h_terms', 's6', 'c1', 'lt_p', at(3, 2), { mode: 'online' }),
  E('h_resched', 'g1', `select app.coach_reschedule_session({{h1_lesson}}, ${at(3, 4)})`),
  E('h_cancel', 's3', `select app.lesson_cancel_mine({{h1_e}})`),
  R('h1_after', `select pg_temp.lesson_state({{h1_lesson}}::uuid)`),
  E('h_cancel_again', 's3', `select app.lesson_cancel_mine({{h1_e}})`),
  X(`update venue_settings set lesson_payment_mode = 'desk' where venue_id = {{v}}::uuid`),

  // ── C. courts (R34) ─────────────────────────────────────────────────────
  `select pg_temp.booking('v_c1', ${at(4)});`,
  `select pg_temp.booking('v_c2', ${at(4)});`,
  BOOK('full', 's2', 'c1', 'lt_p', at(4)),
  `select pg_temp.booking('v_c1', ${at(4, 2)});`,
  BOOK('court2', 's2', 'c1', 'lt_p', at(4, 2)),

  // ── D. one coach, two branches: the key is branch-free ───────────────────
  E(
    'x_private',
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_p}}, ${at(5)}, null, 'Walk A', null, 1, 'k-x_private')`,
  ),
  FROM('x_e', 'x_private', 'enrolment_id'),
  FROM('x_lesson', 'x_private', 'lesson_id'),
  E(
    'x_group_w',
    'desk',
    `select app.desk_create_group({{c1}}, {{lt_gw}}, ${at(5)}, 'k-x_group_w')`,
  ),
  E(
    'x_group_w_ok',
    'desk',
    `select app.desk_create_group({{c1}}, {{lt_gw}}, ${at(5, 2)}, 'k-x_group_w_ok')`,
  ),

  // ── E. creation: the cut-off (R47), the grid, course starts ─────────────
  E(
    'grp_cutoff',
    'g1',
    `select app.coach_create_group({{lt_g}}, {{v}}, ${at(0, 1)}, 'k-grp_cutoff')`,
  ),
  E(
    'grp_grid',
    'g1',
    `select app.coach_create_group({{lt_g}}, {{v}}, ${at(1, 0, 45)}, 'k-grp_grid')`,
  ),
  E('grp1', 'g1', `select app.coach_create_group({{lt_g}}, {{v}}, ${at(1)}, 'k-grp1')`),
  FROM('grp1_lesson', 'grp1', 'lesson_id'),
  E('grp1_replay', 'g1', `select app.coach_create_group({{lt_g}}, {{v}}, ${at(1)}, 'k-grp1')`),
  E(
    'crs_cutoff',
    'g1',
    `select app.coach_create_course({{lt_c}}, {{v}}, array[${at(0, 1)}, ${at(7)}, ${at(14)}, ${at(21)}], '', '', 'k-crs_cutoff')`,
  ),
  E(
    'crs_count',
    'g1',
    `select app.coach_create_course({{lt_c}}, {{v}}, array[${at(1, 3)}, ${at(8, 3)}, ${at(15, 3)}], '', '', 'k-crs_count')`,
  ),
  E(
    'crs_order',
    'g1',
    `select app.coach_create_course({{lt_c}}, {{v}}, array[${at(8, 3)}, ${at(1, 3)}, ${at(15, 3)}, ${at(22, 3)}], '', '', 'k-crs_order')`,
  ),
  E(
    'crs_grid',
    'g1',
    `select app.coach_create_course({{lt_c}}, {{v}}, array[${at(1, 3)}, ${at(8, 3, 30)}, ${at(15, 3, 15)}, ${at(22, 3)}], '', '', 'k-crs_grid')`,
  ),
  E(
    'crs',
    'g1',
    `select app.coach_create_course({{lt_c}}, {{v}}, array[${at(1, 3)}, ${at(8, 3)}, ${at(15, 3)}, ${at(22, 3)}], 'Spring', 'ربيع', 'k-crs')`,
  ),
  FROM('crs_id', 'crs', 'course_id'),
  FROM('crs_s1', 'crs', 'sessions,0,lesson_id'),
  FROM('crs_s2', 'crs', 'sessions,1,lesson_id'),
  FROM('crs_s3', 'crs', 'sessions,2,lesson_id'),
  FROM('crs_s4', 'crs', 'sessions,3,lesson_id'),

  // ── F. joins (C-1, C-15) ────────────────────────────────────────────────
  JOIN('j1', 's1', 'grp1_lesson'),
  JOIN('j2', 's2', 'grp1_lesson'),
  JOIN('j3', 's3', 'grp1_lesson'),
  JOIN('j4', 's5', 'grp1_lesson'),
  JOIN('j_self', 'g1', 'grp1_lesson'),
  JOIN('j_again', 's1', 'grp1_lesson'),
  JOIN('j_price', 's6', 'grp1_lesson', 14000),
  CJOIN('cj1', 's1', 'crs_id', 80000),
  // Session 1 has started: the late joiner pays sessions 2-4 (iqd_split(80000, 4) = 20000 each).
  X(`update lessons set start_at = now() - interval '2 hours', end_at = now() - interval '1 hour'
      where id = {{crs_s1}}::uuid`),
  CJOIN('cj_price', 's2', 'crs_id', 80000),
  CJOIN('cj2', 's2', 'crs_id', 60000),

  // ── G. reschedule (R8, R32, R47, R66) ───────────────────────────────────
  E('rs_order', 'g1', `select app.coach_reschedule_session({{crs_s2}}, ${at(16, 3)})`),
  E('rs_s2', 'g1', `select app.coach_reschedule_session({{crs_s2}}, ${at(9, 3)})`),
  E('rs_last', 'desk', `select app.desk_reschedule_session({{crs_s4}}, ${at(23, 3)})`),
  R(
    'crs_signup',
    `select to_jsonb(signup_closes_at = ${at(23, 3)}) from courses where id = {{crs_id}}::uuid`,
  ),
  E('rs_grp_same', 'g1', `select app.coach_reschedule_session({{grp1_lesson}}, ${at(1)})`),
  E('rs_grp_grid', 'g1', `select app.coach_reschedule_session({{grp1_lesson}}, ${at(1, 4, 10)})`),
  E('rs_grp_cutoff', 'g1', `select app.coach_reschedule_session({{grp1_lesson}}, ${at(0, 1)})`),
  E('rs_grp', 'g1', `select app.coach_reschedule_session({{grp1_lesson}}, ${at(1, 4)})`),
  R(
    'grp1_cutoff',
    `select to_jsonb(cutoff_at = ${at(1, 2)}) from lessons where id = {{grp1_lesson}}::uuid`,
  ),
  E('rs_stranger', 'g2', `select app.coach_reschedule_session({{grp1_lesson}}, ${at(1, 6)})`),
  // R8: booked inside the window, then moved by the coach: free until the new start.
  BOOK('r8', 's5', 'c1', 'lt_p', at(0, 3)),
  FROM('r8_lesson', 'r8', 'lesson_id'),
  FROM('r8_e', 'r8', 'enrolment_id'),
  X(
    `update lesson_enrolments set created_at = now() - interval '1 hour' where id = {{r8_e}}::uuid`,
  ),
  E('r8_move', 'g1', `select app.coach_reschedule_session({{r8_lesson}}, ${at(0, 5)})`),
  E('r8_cancel', 's5', `select app.lesson_cancel_mine({{r8_e}})`),
  // The control: inside the window, never moved: late, with a strike (CD-2).
  BOOK('late', 's2', 'c1', 'lt_p', at(0, 7)),
  FROM('late_e', 'late', 'enrolment_id'),
  E('late_cancel', 's2', `select app.lesson_cancel_mine({{late_e}})`),

  // ── H. the typed-phone link, no oracle (C-21, R10, R44) ─────────────────
  E('l_grp', 'g1', `select app.coach_create_group({{lt_g8}}, {{v}}, ${at(2, 6)}, 'k-l_grp')`),
  FROM('l_lesson', 'l_grp', 'lesson_id'),
  ADD('a1', 'g1', 'l_lesson', 'Mona', '+964 779 001 2345'),
  ADD('a2', 'g1', 'l_lesson', 'Zaid', '+964 790 000 0000'),
  FROM('a1_e', 'a1', 'enrolment_id'),
  FROM('a2_e', 'a2', 'enrolment_id'),
  R(
    'a_rows',
    `select jsonb_build_object(
                 'a1_linked', (select guest_id = {{s4}}::uuid from lesson_enrolments where id = {{a1_e}}::uuid),
                 'a1_pending', (select link_confirmed_at is null from lesson_enrolments where id = {{a1_e}}::uuid),
                 'a1_name', (select guest_name from lesson_enrolments where id = {{a1_e}}::uuid),
                 'a2_unlinked', (select guest_id is null from lesson_enrolments where id = {{a2_e}}::uuid),
                 'a1_events', (select count(*) from lesson_events where enrolment_id = {{a1_e}}::uuid),
                 'a2_events', (select count(*) from lesson_events where enrolment_id = {{a2_e}}::uuid))`,
  ),
  E('a1_cancel_pending', 's4', `select app.lesson_cancel_mine({{a1_e}})`),
  R(
    'l_events_before',
    `select to_jsonb(count(*)) from lesson_events where lesson_id = {{l_lesson}}::uuid`,
  ),
  E('a1_no', 's4', `select app.lesson_link_confirm({{a1_e}}, false)`),
  R(
    'l_events_after',
    `select to_jsonb(count(*)) from lesson_events where lesson_id = {{l_lesson}}::uuid`,
  ),
  R(
    'a1_after',
    `select to_jsonb(guest_id is null) from lesson_enrolments where id = {{a1_e}}::uuid`,
  ),
  E('a1_no_again', 's4', `select app.lesson_link_confirm({{a1_e}}, false)`),
  ADD('a3', 'g1', 'l_lesson', 'Sara', '+964 779 001 2346'),
  FROM('a3_e', 'a3', 'enrolment_id'),
  E('a3_yes', 's5', `select app.lesson_link_confirm({{a3_e}}, true)`),
  E('a3_yes_again', 's5', `select app.lesson_link_confirm({{a3_e}}, true)`),
  E('a3_no_late', 's5', `select app.lesson_link_confirm({{a3_e}}, false)`),
  ADD('a4', 'g1', 'l_lesson', 'Sara again', '+964 779 001 2346'),
  FROM('a4_e', 'a4', 'enrolment_id'),
  R(
    'a4_unlinked',
    `select to_jsonb(guest_id is null) from lesson_enrolments where id = {{a4_e}}::uuid`,
  ),
  ADD('a_foreign', 'g2', 'l_lesson', 'Nope', null),
  ADD('a_private', 'g1', 'p1_lesson', 'Nope', null),
  ADD('a_replay', 'g1', 'l_lesson', 'Zaid', '+964 790 000 0000', 'k-a2'),

  // ── I. hoarding (R56) and the daily cap (CD-9) ──────────────────────────
  X(`update venue_settings set coach_max_open_private = 2 where venue_id = {{v}}::uuid`),
  CB('cb1', at(6)),
  FROM('cb1_lesson', 'cb1', 'lesson_id'),
  FROM('cb1_e', 'cb1', 'enrolment_id'),
  FROM('cb1_court', 'cb1', 'court_id'),
  CB('cb2', at(6, 2)),
  FROM('cb2_lesson', 'cb2', 'lesson_id'),
  FROM('cb2_e', 'cb2', 'enrolment_id'),
  CB('cb3', at(6, 4)),
  // 28 more coach adds today (cancelled, so they hold no place): 30 in all.
  X(`insert into lesson_enrolments (venue_id, lesson_id, guest_name, booked_by_kind, booked_by_profile_id, price_iqd,
                                    payment_mode, status, cancel_kind, cancelled_at)
     select {{v}}::uuid, {{cb1_lesson}}::uuid, 'Planted ' || i, 'coach', {{g2}}::uuid, 30000, 'desk', 'cancelled',
            'coach', now()
       from generate_series(1, 28) i`),
  CB('cb_day', at(6, 6)),

  // ── J. attendance (CD-11, CD-2, R31) ────────────────────────────────────
  X(`update lessons set start_at = now() - interval '30 minutes', end_at = now() + interval '30 minutes'
      where id in ({{cb2_lesson}}::uuid, {{p1_lesson}}::uuid)`),
  E('m_coach', 'g2', `select app.coach_mark_attendance({{cb2_lesson}}, {{cb2_e}}, 'no_show')`),
  R(
    'm_coach_strikes',
    `select to_jsonb(count(*)) from lesson_strikes where enrolment_id = {{cb2_e}}::uuid`,
  ),
  E(
    'm_coach_again',
    'g2',
    `select app.coach_mark_attendance({{cb2_lesson}}, {{cb2_e}}, 'no_show')`,
  ),
  E('m_future', 'g2', `select app.coach_mark_attendance({{cb1_lesson}}, {{cb1_e}}, 'attended')`),
  E('m_stranger', 'g1', `select app.coach_mark_attendance({{cb2_lesson}}, {{cb2_e}}, 'attended')`),
  E(
    'm_guest_no_show',
    'desk',
    `select app.desk_mark_attendance({{p1_lesson}}, {{p1_e}}, 'no_show')`,
  ),
  R(
    'm_guest_strikes',
    `select to_jsonb(count(*)) from lesson_strikes where enrolment_id = {{p1_e}}::uuid`,
  ),
  E(
    'm_guest_attended',
    'desk',
    `select app.desk_mark_attendance({{p1_lesson}}, {{p1_e}}, 'attended')`,
  ),
  R(
    'm_guest_strikes_after',
    `select to_jsonb(count(*)) from lesson_strikes where enrolment_id = {{p1_e}}::uuid`,
  ),
  E('m_bad', 'desk', `select app.desk_mark_attendance({{p1_lesson}}, {{p1_e}}, 'late')`),
  E('cancel_started', 's1', `select app.lesson_cancel_mine({{p1_e}})`),

  // ── K. the desk's court move (R7, R34) and cancels ──────────────────────
  E('mv_same', 'desk', `select app.desk_move_lesson_court({{cb1_lesson}}, {{cb1_court}})`),
  E(
    'mv',
    'desk',
    `select app.desk_move_lesson_court({{cb1_lesson}},
      (select c.id from courts c where c.venue_id = {{v}}::uuid and c.is_active and c.id <> {{cb1_court}}::uuid
        order by c.sort_order limit 1))`,
  ),
  `select pg_temp.booking('cb1_court', ${at(6)});`,
  E('mv_busy', 'desk', `select app.desk_move_lesson_court({{cb1_lesson}}, {{cb1_court}})`),
  E('mv_other_branch', 'desk', `select app.desk_move_lesson_court({{cb1_lesson}}, {{w_c1}})`),
  E('dc_session', 'desk', `select app.desk_cancel_lesson({{crs_s3}}, 'customer_request')`),
  E('cc_session', 'g1', `select app.coach_cancel_lesson({{crs_s3}}, 'coach_unavailable')`),
  E('dc_bad_reason', 'desk', `select app.desk_cancel_enrolment({{cb1_e}}, 'because')`),
  E(
    'dc_enrol',
    'desk',
    `select app.desk_cancel_enrolment({{cb1_e}}, 'customer_request: changed plans')`,
  ),
  R('cb1_after', `select pg_temp.lesson_state({{cb1_lesson}}::uuid)`),
  E('dc_enrol_again', 'desk', `select app.desk_cancel_enrolment({{cb1_e}}, 'customer_request')`),
  E('rm_student', 'g1', `select app.coach_remove_student({{a2_e}}, 'other: moved to Friday')`),
  E('rm_private', 'g1', `select app.coach_remove_student({{p1_e}}, 'other')`),

  // ── L. a paused coach (R16) ─────────────────────────────────────────────
  X(`update coaches set status = 'paused' where id = {{c2}}::uuid`),
  BOOK('paused_guest', 's2', 'c2', 'lt_p', at(7)),
  E(
    'paused_desk',
    'desk',
    `select app.desk_book_lesson({{c2}}, {{lt_p}}, ${at(7)}, null, 'Walk P', null, 1, 'k-paused_desk')`,
  ),

  // ── M. retirement cancels everything, never refused (C-25, R45) ─────────
  E('retire', 'owner', `select app.set_coach_status({{c1}}, 'retired', 'moved away')`),
  R(
    'retired_live',
    `select to_jsonb(count(*)) from lessons
                      where coach_id = {{c1}}::uuid and status in ('held', 'scheduled') and start_at > now()`,
  ),
  R(
    'retired_course',
    `select jsonb_build_object('status', co.status, 'reason', co.cancel_reason,
                         'kinds', (select jsonb_agg(distinct e.cancel_kind) from lesson_enrolments e where e.course_id = co.id))
                         from courses co where co.id = {{crs_id}}::uuid`,
  ),
  R(
    'retired_private',
    `select jsonb_build_object('lesson', pg_temp.lesson_state({{x_lesson}}::uuid),
                          'kind', (select cancel_kind from lesson_enrolments where id = {{x_e}}::uuid))`,
  ),
  E('retire_again', 'owner', `select app.set_coach_status({{c1}}, 'retired', null)`),
  BOOK('book_retired', 's2', 'c1', 'lt_p', at(9)),
  E(
    'coach_retired_self',
    'g1',
    `select app.coach_create_group({{lt_g}}, {{v}}, ${at(9)}, 'k-coach_retired_self')`,
  ),
];

describe.skipIf(!docker)('coaching booking (0283 core writes), one transaction', () => {
  let r: Results;
  beforeAll(() => {
    r = scenario('c280', BODY);
  });

  it('books a private lesson: the enrolment status, the court row, one event, the answer keys (X5, R81)', () => {
    const p1 = data<Json>(r, 'p1');
    expect(missingKeys(p1, COACHING_SHAPES.lesson_book_private)).toEqual([]);
    expect(p1).toMatchObject({
      duplicate: false,
      status: 'booked',
      payment_mode: 'desk',
      price_iqd: 30000,
    });
    expect(p1).not.toHaveProperty('court_id');
    expect(data<Json>(r, 'p1_state')).toMatchObject({
      kind: 'private',
      status: 'scheduled',
      court_rows: [
        {
          kind: 'lesson',
          status: 'confirmed',
          guest_id: null,
          guest_name: 'Lesson',
          price_iqd: null,
        },
      ],
      events: ['booked'],
    });
    expect(data<Json>(r, 'p1_replay')).toMatchObject({
      duplicate: true,
      enrolment_id: p1.enrolment_id,
    });
    expect(code(r, 'p1_foreign')).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('refuses a changed price, an off-grid start, a busy coach, a big party and bad friend names', () => {
    const f = failed(r, 'p_price');
    expect(f.code).toBe('PRICE_CHANGED');
    expect(JSON.parse(f.detail!)).toEqual({ quoted_iqd: 29000, current_iqd: 30000 });
    expect(code(r, 'p_grid')).toBe('SLOT_NOT_ON_GRID');
    expect(code(r, 'p_busy')).toBe('COACH_BUSY');
    expect(code(r, 'p_party')).toBe('PARTY_TOO_LARGE:2');
    expect(code(r, 'p_friends')).toBe('INVALID_ARGUMENT:p_friend_names');
    expect(code(r, 'p_horizon')).toBe('BEYOND_HORIZON:60');
    expect(code(r, 'p_anon')).toBe('AUTH_REQUIRED');
    expect(code(r, 'p_online_off')).toBe('ONLINE_PAYMENT_OFF');
  });

  it('no self-enrolment (R56), no unaccepted coach for guests (R61), no guest booking while coaching is off; the desk stages', () => {
    expect(code(r, 'p_self')).toBe('ALREADY_ENROLLED:coach');
    expect(code(r, 'p_unaccepted')).toBe('COACH_NOT_FOUND');
    expect(code(r, 'p_off')).toBe('COACHING_OFF');
    const desk = data<Json>(r, 'desk_off');
    expect(missingKeys(desk, COACHING_SHAPES.desk_book_lesson)).toEqual([]);
    expect(data<Json>(r, 'desk_unaccepted')).toMatchObject({ duplicate: false });
    expect(code(r, 'desk_self')).toBe('ALREADY_ENROLLED:coach');
  });

  it('holds the court for an online payment, counts held lessons against the hold cap, needs the lessons terms (R1, R30, R50)', () => {
    expect(data<Json>(r, 'h1')).toMatchObject({ status: 'held', payment_mode: 'online' });
    expect(data<Json>(r, 'h1').hold_expires_at).not.toBeNull();
    expect(data<Json>(r, 'h1_state')).toMatchObject({
      status: 'held',
      court_rows: [{ kind: 'hold', status: 'pending', guest_id: null, guest_name: 'Lesson' }],
      events: ['held'],
    });
    expect(code(r, 'h2')).toBe('HOLD_QUOTA_EXCEEDED:1');
    expect(code(r, 'h_terms')).toBe('TERMS_REQUIRED:lessons');
    // R32: a held lesson is mid-payment.
    expect(code(r, 'h_resched')).toBe('INVALID_TRANSITION:held');
  });

  it('cancels a held lesson free and expires its hold row at once (R25)', () => {
    const c = data<Json>(r, 'h_cancel');
    expect(missingKeys(c, COACHING_SHAPES.lesson_cancel_mine)).toEqual([]);
    expect(c).toMatchObject({ cancel_kind: 'guest_free', strike: false, duplicate: false });
    expect(data<Json>(r, 'h1_after')).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'guest_cancel',
      court_rows: [{ kind: 'hold', status: 'expired' }],
      events: ['held', 'enrolment_cancelled:guest_free', 'cancelled:guest_cancel'],
    });
    expect(data<Json>(r, 'h_cancel_again')).toMatchObject({ duplicate: true });
  });

  it('takes a court only when one is free, and picks the free one (R34)', () => {
    expect(code(r, 'full')).toBe('NO_COURT_FREE');
    expect(data<Json>(r, 'court2')).toMatchObject({ court_name_en: 'C280 v court 2' });
  });

  it('keeps one coach to one lesson at a time across branches (the key is branch-free)', () => {
    expect(data<Json>(r, 'x_private')).toMatchObject({ duplicate: false });
    expect(code(r, 'x_group_w')).toBe('COACH_BUSY');
    expect(missingKeys(data(r, 'x_group_w_ok'), COACHING_SHAPES.desk_create_group)).toEqual([]);
  });

  it('refuses creation inside the cut-off (R47) and off the grid (R9); checks course starts (X31)', () => {
    expect(code(r, 'grp_cutoff')).toBe('LESSON_CLOSED:cutoff');
    expect(code(r, 'grp_grid')).toBe('SLOT_NOT_ON_GRID');
    const grp = data<Json>(r, 'grp1');
    expect(missingKeys(grp, COACHING_SHAPES.coach_create_group)).toEqual([]);
    expect(data<Json>(r, 'grp1_replay')).toMatchObject({
      duplicate: true,
      lesson_id: grp.lesson_id,
    });
    expect(code(r, 'crs_cutoff')).toBe('LESSON_CLOSED:cutoff');
    expect(code(r, 'crs_count')).toBe('COURSE_STARTS_INVALID:count');
    expect(code(r, 'crs_order')).toBe('COURSE_STARTS_INVALID:order');
    expect(code(r, 'crs_grid')).toBe('SLOT_NOT_ON_GRID:3');
    const crs = data<Json>(r, 'crs');
    expect(missingKeys(crs, COACHING_SHAPES.coach_create_course)).toEqual([]);
    expect((crs.lesson_ids as string[]).length).toBe(4);
  });

  it('fills a group session to LESSON_FULL; refuses the coach and a second place; prices a late course join (C-15)', () => {
    expect(data<Json>(r, 'j1')).toMatchObject({ status: 'booked', places_left: 2 });
    expect(missingKeys(data(r, 'j1'), COACHING_SHAPES.lesson_join)).toEqual([]);
    expect(data<Json>(r, 'j2')).toMatchObject({ places_left: 1 });
    expect(data<Json>(r, 'j3')).toMatchObject({ places_left: 0 });
    expect(code(r, 'j4')).toBe('LESSON_FULL');
    expect(code(r, 'j_self')).toBe('ALREADY_ENROLLED:coach');
    expect(code(r, 'j_again')).toBe('ALREADY_ENROLLED');
    expect(failed(r, 'j_price').code).toBe('PRICE_CHANGED');
    const cj1 = data<Json>(r, 'cj1');
    expect(missingKeys(cj1, COACHING_SHAPES.course_join)).toEqual([]);
    expect(cj1).toMatchObject({ price_iqd: 80000, first_session_no: 1, sessions_covered: 4 });
    const late = failed(r, 'cj_price');
    expect(late.code).toBe('PRICE_CHANGED');
    expect(JSON.parse(late.detail!)).toEqual({ quoted_iqd: 80000, current_iqd: 60000 });
    expect(data<Json>(r, 'cj2')).toMatchObject({
      price_iqd: 60000,
      first_session_no: 2,
      sessions_covered: 3,
    });
  });

  it('moves any kind on the grid; keeps a course in order; the cut-off and sign-up follow (R8, R32, R47, R66)', () => {
    expect(code(r, 'rs_order')).toBe('SESSION_NOT_MOVABLE:order');
    const s2 = data<Json>(r, 'rs_s2');
    expect(missingKeys(s2, COACHING_SHAPES.coach_reschedule_session)).toEqual([]);
    expect(s2.rescheduled_at).not.toBeNull();
    expect(missingKeys(data(r, 'rs_last'), COACHING_SHAPES.desk_reschedule_session)).toEqual([]);
    expect(data(r, 'crs_signup')).toBe(true);
    expect(data<Json>(r, 'rs_grp_same')).toMatchObject({ duplicate: true });
    expect(code(r, 'rs_grp_grid')).toBe('SLOT_NOT_ON_GRID');
    expect(code(r, 'rs_grp_cutoff')).toBe('LESSON_CLOSED:cutoff');
    expect(data<Json>(r, 'rs_grp')).toMatchObject({ duplicate: false });
    expect(data(r, 'grp1_cutoff')).toBe(true);
    expect(code(r, 'rs_stranger')).toBe('LESSON_NOT_FOUND');
  });

  it('lets a guest whose lesson was moved cancel free inside the window; a plain late cancel strikes (R8, CD-2)', () => {
    expect(data<Json>(r, 'r8_move')).toMatchObject({ duplicate: false });
    expect(data<Json>(r, 'r8_cancel')).toMatchObject({ cancel_kind: 'guest_free', strike: false });
    expect(data<Json>(r, 'late_cancel')).toMatchObject({ cancel_kind: 'guest_late', strike: true });
  });

  it('links a typed phone only to a verified account, pending, with the same answer either way (C-21, R10, R44)', () => {
    const a1 = data<Json>(r, 'a1');
    const a2 = data<Json>(r, 'a2');
    expect(Object.keys(a1).sort()).toEqual(Object.keys(a2).sort());
    expect(missingKeys(a1, COACHING_SHAPES.coach_add_student)).toEqual([]);
    expect(a1).toMatchObject({ duplicate: false, places_left: 7 });
    expect(a2).toMatchObject({ duplicate: false, places_left: 6 });
    expect(data<Json>(r, 'a_rows')).toEqual({
      a1_linked: true,
      a1_pending: true,
      a1_name: 'Mona',
      a2_unlinked: true,
      a1_events: 1,
      a2_events: 1,
    });
    // "Is this you?" first; "Not me" unlinks with no event (the coach is never told).
    expect(code(r, 'a1_cancel_pending')).toBe('LESSON_NOT_CANCELLABLE:link_pending');
    expect(data<Json>(r, 'a1_no')).toMatchObject({ linked: false, duplicate: false });
    expect(data(r, 'l_events_after')).toBe(data(r, 'l_events_before'));
    expect(data(r, 'a1_after')).toBe(true);
    expect(code(r, 'a1_no_again')).toBe('ENROLMENT_NOT_FOUND');
    expect(data<Json>(r, 'a3_yes')).toMatchObject({ linked: true, duplicate: false });
    expect(data<Json>(r, 'a3_yes_again')).toMatchObject({ duplicate: true });
    expect(code(r, 'a3_no_late')).toBe('INVALID_TRANSITION:confirmed');
    // An account already holding a place here is simply not linked.
    expect(data(r, 'a4_unlinked')).toBe(true);
    expect(code(r, 'a_foreign')).toBe('LESSON_NOT_FOUND');
    expect(code(r, 'a_private')).toBe('LESSON_NOT_FOUND');
    expect(data<Json>(r, 'a_replay')).toMatchObject({ duplicate: true });
  });

  it('caps upcoming coach-booked private lessons (R56) and coach adds per day (CD-9)', () => {
    expect(missingKeys(data(r, 'cb1'), COACHING_SHAPES.coach_book_private)).toEqual([]);
    expect(data<Json>(r, 'cb2')).toMatchObject({ duplicate: false });
    expect(code(r, 'cb3')).toBe('COACH_ADD_LIMIT:live');
    expect(code(r, 'cb_day')).toBe('COACH_ADD_LIMIT:day');
  });

  it('marks attendance in the window; a no-show strikes only a guest-booked place; correcting it removes the strike', () => {
    expect(data<Json>(r, 'm_coach')).toMatchObject({ attendance: 'no_show', duplicate: false });
    expect(data(r, 'm_coach_strikes')).toBe(0);
    expect(data<Json>(r, 'm_coach_again')).toMatchObject({ duplicate: true });
    expect(code(r, 'm_future')).toBe('INVALID_TRANSITION:not_started');
    expect(code(r, 'm_stranger')).toBe('LESSON_NOT_FOUND');
    expect(data<Json>(r, 'm_guest_no_show')).toMatchObject({ attendance: 'no_show' });
    expect(data(r, 'm_guest_strikes')).toBe(1);
    expect(data<Json>(r, 'm_guest_attended')).toMatchObject({ attendance: 'attended' });
    expect(data(r, 'm_guest_strikes_after')).toBe(0);
    expect(code(r, 'm_bad')).toBe('INVALID_ARGUMENT:p_status');
    expect(code(r, 'cancel_started')).toBe('LESSON_NOT_CANCELLABLE:started');
  });

  it("moves a lesson's court only through the desk (R7); cancels by desk and coach", () => {
    expect(data<Json>(r, 'mv_same')).toMatchObject({ duplicate: true });
    expect(data<Json>(r, 'mv')).toMatchObject({ duplicate: false });
    expect(code(r, 'mv_busy')).toBe('NO_COURT_FREE');
    expect(code(r, 'mv_other_branch')).toBe('COURT_NOT_FOUND');
    expect(code(r, 'dc_session')).toBe('LESSON_NOT_CANCELLABLE:course_session');
    expect(code(r, 'cc_session')).toBe('LESSON_NOT_CANCELLABLE:course_session');
    expect(code(r, 'dc_bad_reason')).toBe('INVALID_ARGUMENT:p_reason');
    const dc = data<Json>(r, 'dc_enrol');
    expect(missingKeys(dc, COACHING_SHAPES.desk_cancel_enrolment)).toEqual([]);
    expect(dc).toMatchObject({
      status: 'cancelled',
      lesson_cancelled: true,
      refund_due_iqd: 0,
      online_refund: 0,
    });
    expect(data<Json>(r, 'cb1_after')).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'staff_cancel',
    });
    expect(data<Json>(r, 'dc_enrol_again')).toMatchObject({ duplicate: true });
    expect(data<Json>(r, 'rm_student')).toMatchObject({ ok: true, duplicate: false });
    expect(code(r, 'rm_private')).toBe('LESSON_NOT_CANCELLABLE:private');
  });

  it('a paused coach takes no new booking from guests or the desk (R16)', () => {
    expect(code(r, 'paused_guest')).toBe('COACH_INACTIVE');
    expect(code(r, 'paused_desk')).toBe('COACH_INACTIVE');
  });

  it('retiring cancels every upcoming lesson and course as coach_retired and is never refused (C-25, R45)', () => {
    const ret = data<Json>(r, 'retire');
    expect(missingKeys(ret, COACHING_SHAPES.set_coach_status)).toEqual([]);
    expect(ret).toMatchObject({ status: 'retired', duplicate: false, courses_cancelled: 1 });
    expect(ret.lessons_cancelled as number).toBeGreaterThanOrEqual(4);
    expect(data(r, 'retired_live')).toBe(0);
    expect(data<Json>(r, 'retired_course')).toEqual({
      status: 'cancelled',
      reason: 'coach_retired',
      kinds: ['course_cancelled'],
    });
    expect(data<Json>(r, 'retired_private')).toMatchObject({
      kind: 'coach',
      lesson: {
        status: 'cancelled',
        cancel_reason: 'coach_retired',
        court_rows: [{ kind: 'lesson', status: 'cancelled' }],
      },
    });
    expect(data<Json>(r, 'retire_again')).toMatchObject({ duplicate: true });
    expect(code(r, 'book_retired')).toBe('COACH_NOT_FOUND');
    expect(code(r, 'coach_retired_self')).toBe('NOT_A_COACH');
  });
});

// ── 0291 lesson_booking_guards (DB-07, DB-08, DB-10 to DB-14), one transaction ─

/** A lapsed hold of another guest (sh, whose ladder it strikes) on a court, kept as `name`. */
const LAPSED = (name: string, court: string, when: string) =>
  KEEP(
    name,
    `insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_id, guest_name, source,
                               hold_expires_at)
     select c.venue_id, c.id, 'hold', 'pending', ${when}, ${when} + interval '60 minutes', {{sh}}::uuid,
            'Foreign hold', 'mobile', now() - interval '1 minute'
       from courts c where c.id = {{${court}}}::uuid
     returning id`,
  );

/** A court row's status, recorded under `label`. */
const ROW_STATUS = (label: string, res: string) =>
  R(label, `select to_jsonb(status) from reservations where id = {{${res}}}::uuid`);

const BODY_291: string[] = [
  SETUP,
  `select pg_temp.branch('v');`,
  `select pg_temp.branch('x', true, false);`,
  `select pg_temp.branch('y');`,
  ...['g1', 'g2', 'g3', 'g4', 'gx', 's1', 's2', 'sh'].map((g) => `select pg_temp.guest('${g}');`),
  `select pg_temp.guest('s4', '{"verified": "9647790012345"}');`,
  `select pg_temp.coach('c1', 'g1', 'v');`,
  `select pg_temp.at_branch('c1', 'y');`,
  `select pg_temp.coach('c2', 'g2', 'v');`,
  `select pg_temp.coach('c3', 'g3', 'v');`,
  `select pg_temp.coach('c4', 'g4', 'v');`,
  `select pg_temp.coach('cx', 'gx', 'x');`,
  `select pg_temp.lt('lt_p', 'private', 'v');`,
  `select pg_temp.lt('lt_off', 'private', 'v', '{"is_active": false}');`,
  `select pg_temp.lt('lt_g', 'group', 'v');`,
  `select pg_temp.lt('lt_c', 'course', 'v');`,
  `select pg_temp.lt('lt_px', 'private', 'x');`,
  `select pg_temp.lt('lt_py', 'private', 'y');`,
  ...['lt_p', 'lt_off', 'lt_g', 'lt_py'].map((t) => `select pg_temp.teach('c1', '${t}');`),
  `select pg_temp.teach('c2', 'lt_g');`,
  `select pg_temp.teach('c3', 'lt_p');`,
  `select pg_temp.teach('c4', 'lt_c');`,
  `select pg_temp.teach('cx', 'lt_px');`,
  X(`insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
     values ({{v}}::uuid, app.venue_business_date({{v}}::uuid, now()), 'open', {{manager}}::uuid, 0)`),

  // ── DB-07: a started private lesson's place is not cancelled at the desk ──
  E(
    'd7s',
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_p}}, ${at(2)}, null, 'Walk Started', null, 1, 'k-d7s')`,
  ),
  FROM('d7s_lesson', 'd7s', 'lesson_id'),
  FROM('d7s_e', 'd7s', 'enrolment_id'),
  E(
    'd7s_pay',
    'desk',
    `select app.lesson_settle({{d7s_e}}, 'cash', 30000, 30000, 'k-d7s-pay', null)`,
  ),
  X(`update lessons set start_at = now() - interval '30 minutes', end_at = now() + interval '30 minutes'
      where id = {{d7s_lesson}}::uuid`),
  E('d7s_mark', 'desk', `select app.desk_mark_attendance({{d7s_lesson}}, {{d7s_e}}, 'attended')`),
  R('d7s_money_before', `select app.lesson_enrolment_money({{d7s_e}}::uuid)`),
  E('d7s_cancel', 'desk', `select app.desk_cancel_enrolment({{d7s_e}}, 'customer_request')`),
  R(
    'd7s_after',
    `select jsonb_build_object(
       'lesson', (select status from lessons where id = {{d7s_lesson}}::uuid),
       'enrolment', (select status from lesson_enrolments where id = {{d7s_e}}::uuid),
       'attendance', (select status from lesson_attendance
                       where lesson_id = {{d7s_lesson}}::uuid and enrolment_id = {{d7s_e}}::uuid),
       'money', app.lesson_enrolment_money({{d7s_e}}::uuid))`,
  ),
  // Before the start the cancel still works, and the desk money is due back.
  E(
    'd7f',
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_p}}, ${at(3)}, null, 'Walk Future', null, 1, 'k-d7f')`,
  ),
  FROM('d7f_e', 'd7f', 'enrolment_id'),
  E(
    'd7f_pay',
    'desk',
    `select app.lesson_settle({{d7f_e}}, 'cash', 30000, 30000, 'k-d7f-pay', null)`,
  ),
  E('d7f_cancel', 'desk', `select app.desk_cancel_enrolment({{d7f_e}}, 'customer_request')`),
  // A group sign-up keeps the end_at rule: cancelled after the start, before the end.
  E('d7g', 'desk', `select app.desk_create_group({{c2}}, {{lt_g}}, ${at(1)}, 'k-d7g')`),
  FROM('d7g_lesson', 'd7g', 'lesson_id'),
  E(
    'd7g_add',
    'desk',
    `select app.desk_add_student({{d7g_lesson}}, null, null, 'Walk G', null, 'k-d7g-add')`,
  ),
  FROM('d7g_e', 'd7g_add', 'enrolment_id'),
  X(`update lessons set start_at = now() - interval '30 minutes', end_at = now() + interval '30 minutes'
      where id = {{d7g_lesson}}::uuid`),
  E('d7g_cancel', 'desk', `select app.desk_cancel_enrolment({{d7g_e}}, 'customer_request')`),

  // ── DB-08: the helper, and where the creation bodies call it ──
  E('b_ok', null, `select to_jsonb(app.lesson_assert_coach_bookable({{c1}}, {{lt_p}}, 'staff'))`),
  E(
    'b_unlinked',
    null,
    `select to_jsonb(app.lesson_assert_coach_bookable({{c2}}, {{lt_p}}, 'staff'))`,
  ),
  E(
    'b_inactive',
    null,
    `select to_jsonb(app.lesson_assert_coach_bookable({{c1}}, {{lt_off}}, 'staff'))`,
  ),
  X(`update coaches set status = 'paused' where id = {{c3}}::uuid`),
  E(
    'b_paused',
    null,
    `select to_jsonb(app.lesson_assert_coach_bookable({{c3}}, {{lt_p}}, 'coach'))`,
  ),
  X(`update coaches set status = 'retired', retired_at = now() where id = {{c3}}::uuid`),
  E(
    'b_retired_staff',
    null,
    `select to_jsonb(app.lesson_assert_coach_bookable({{c3}}, {{lt_p}}, 'staff'))`,
  ),
  E(
    'b_retired_coach',
    null,
    `select to_jsonb(app.lesson_assert_coach_bookable({{c3}}, {{lt_p}}, 'coach'))`,
  ),
  R(
    'b_order',
    `select jsonb_object_agg(p.proname,
       position('app.lesson_assert_coach_bookable(' in p.prosrc) > position('app.lock_coach(' in p.prosrc)
       and position('app.lock_coach(' in p.prosrc) > 0
       and position('app.lesson_assert_coach_bookable(' in p.prosrc)
           < position('app.lesson_lock_branch_courts(' in p.prosrc))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('desk_book_lesson', 'coach_book_private', 'lesson_group_create_internal',
                          'lesson_course_create_internal')`,
  ),

  // ── DB-10: a staff member coaching where they are not staff, over lapsed holds there ──
  X(
    `update profiles set phone = '+9647700000000', terms_version = '2026-09-23' where id = {{desk}}::uuid`,
  ),
  `select pg_temp.coach('cd', 'desk', 'x');`,
  `select pg_temp.teach('cd', 'lt_px');`,
  LAPSED('xh1', 'x_c1', at(2)),
  LAPSED('xh1b', 'x_c2', at(2)),
  E(
    'x_cb',
    'desk',
    `select app.coach_book_private({{lt_px}}, {{x}}, ${at(2)}, 'Student X', null, 1, 'k-x_cb')`,
  ),
  FROM('x_cb_lesson', 'x_cb', 'lesson_id'),
  ROW_STATUS('xh1_after', 'xh1'),
  LAPSED('xh2', 'x_c1', at(2, 2)),
  LAPSED('xh2b', 'x_c2', at(2, 2)),
  E('x_rs', 'desk', `select app.coach_reschedule_session({{x_cb_lesson}}, ${at(2, 2)})`),
  ROW_STATUS('xh2_after', 'xh2'),
  LAPSED('xh3', 'x_c1', at(3)),
  LAPSED('xh3b', 'x_c2', at(3)),
  E(
    'x_guest',
    'desk',
    `select app.lesson_book_private({{cx}}, {{lt_px}}, ${at(3)}, 1, '{}'::text[], 'desk', 30000, 'k-x_guest')`,
  ),
  ROW_STATUS('xh3_after', 'xh3'),

  // ── DB-11: a closed branch takes no new lesson ──
  X(`update venues set status = 'closed' where id = {{y}}::uuid`),
  E(
    'y_create',
    null,
    `select to_jsonb((app.lesson_create_internal({{c1}}, {{lt_py}}, ${at(5)}, null, null, 30000, false,
                                                 'staff', null, {{desk}}, null,
                                                 app.lesson_lock_branch_courts({{y}}))).id)`,
  ),

  // ── DB-12, DB-14: a course cancelled during session 3 ──
  E(
    'k12',
    'g4',
    `select app.coach_create_course({{lt_c}}, {{v}}, array[${at(1, 3)}, ${at(2, 3)}, ${at(3, 3)}, ${at(4, 3)}], '', '', 'k-k12')`,
  ),
  FROM('k12_id', 'k12', 'course_id'),
  FROM('k12_s1', 'k12', 'sessions,0,lesson_id'),
  FROM('k12_s2', 'k12', 'sessions,1,lesson_id'),
  FROM('k12_s3', 'k12', 'sessions,2,lesson_id'),
  FROM('k12_s4', 'k12', 'sessions,3,lesson_id'),
  E('k12_j', 's1', `select app.course_join({{k12_id}}, 'desk', 80000, 'k-k12_j')`),
  FROM('k12_e', 'k12_j', 'enrolment_id'),
  E('k12_j2', 's2', `select app.course_join({{k12_id}}, 'desk', 80000, 'k-k12_j2')`),
  FROM('k12_e2', 'k12_j2', 'enrolment_id'),
  // Session 1 two days ago, session 2 earlier today, session 3 in progress.
  X(`update lessons set start_at = now() - interval '2 days', end_at = now() - interval '47 hours'
      where id = {{k12_s1}}::uuid`),
  X(`update lessons set start_at = now() - interval '4 hours', end_at = now() - interval '3 hours'
      where id = {{k12_s2}}::uuid`),
  X(`update lessons set start_at = now() - interval '20 minutes', end_at = now() + interval '40 minutes'
      where id = {{k12_s3}}::uuid`),
  // The control: a place the desk cancelled before the course was.
  E('k12_rm2', 'desk', `select app.desk_cancel_enrolment({{k12_e2}}, 'customer_request')`),
  E('k12_cancel', 'g4', `select app.coach_cancel_course({{k12_id}}, 'coach_unavailable')`),
  E('k12_cancel_again', 'g4', `select app.coach_cancel_course({{k12_id}}, 'coach_unavailable')`),
  R(
    'k12_state',
    `select jsonb_build_object(
       'course', (select status from courses where id = {{k12_id}}::uuid),
       'e', (select status || ':' || cancel_kind from lesson_enrolments where id = {{k12_e}}::uuid),
       's3', (select status from lessons where id = {{k12_s3}}::uuid),
       's4', (select status from lessons where id = {{k12_s4}}::uuid))`,
  ),
  E('k12_s3_att', 'desk', `select app.desk_mark_attendance({{k12_s3}}, {{k12_e}}, 'attended')`),
  E('k12_s3_ns', 'g4', `select app.coach_mark_attendance({{k12_s3}}, {{k12_e}}, 'no_show')`),
  E('k12_s3_clear', 'desk', `select app.desk_mark_attendance({{k12_s3}}, {{k12_e}}, 'clear')`),
  E('k12_s2_att', 'desk', `select app.desk_mark_attendance({{k12_s2}}, {{k12_e}}, 'attended')`),
  E('k12_s1_att', 'desk', `select app.desk_mark_attendance({{k12_s1}}, {{k12_e}}, 'attended')`),
  E('k12_s4_att', 'desk', `select app.desk_mark_attendance({{k12_s4}}, {{k12_e}}, 'attended')`),
  E('k12_e2_att', 'desk', `select app.desk_mark_attendance({{k12_s3}}, {{k12_e2}}, 'attended')`),
  R(
    'k12_marks',
    `select jsonb_object_agg(l.session_no, a.status)
       from lesson_attendance a join lessons l on l.id = a.lesson_id
      where a.enrolment_id = {{k12_e}}::uuid`,
  ),

  // ── DB-13: "Is this you?" on a place that was removed ──
  E('l13', 'g1', `select app.coach_create_group({{lt_g}}, {{v}}, ${at(5)}, 'k-l13')`),
  FROM('l13_lesson', 'l13', 'lesson_id'),
  E(
    'a13',
    'g1',
    `select app.coach_add_student({{l13_lesson}}, null, 'Mona', '+964 779 001 2345', 'k-a13')`,
  ),
  FROM('a13_e', 'a13', 'enrolment_id'),
  R(
    'a13_linked',
    `select to_jsonb(guest_id = {{s4}}::uuid and link_confirmed_at is null)
       from lesson_enrolments where id = {{a13_e}}::uuid`,
  ),
  E('a13_rm', 'g1', `select app.coach_remove_student({{a13_e}}, 'other')`),
  E('a13_yes', 's4', `select app.lesson_link_confirm({{a13_e}}, true)`),
  E('a13_no', 's4', `select app.lesson_link_confirm({{a13_e}}, false)`),
  R(
    'a13_after',
    `select to_jsonb(guest_id is null and link_confirmed_at is null)
       from lesson_enrolments where id = {{a13_e}}::uuid`,
  ),
];

describe.skipIf(!docker)('0291 lesson booking guards, one transaction', () => {
  let r: Results;
  beforeAll(() => {
    r = scenario('c291', BODY_291);
  });

  it('DB-07: the desk cannot cancel a started private lesson; before the start it can; a group sign-up keeps end_at', () => {
    expect(data<Json>(r, 'd7s_pay')).toBeTruthy();
    expect(data<Json>(r, 'd7s_mark')).toMatchObject({ attendance: 'attended' });
    expect(code(r, 'd7s_cancel')).toBe('LESSON_NOT_CANCELLABLE:started');
    const after = data<Json>(r, 'd7s_after');
    expect(after).toMatchObject({
      lesson: 'scheduled',
      enrolment: 'booked',
      attendance: 'attended',
    });
    expect(after.money).toEqual(data(r, 'd7s_money_before'));
    expect(after.money).toMatchObject({ desk_paid_iqd: 30000, refund_due_iqd: 0 });

    const fut = data<Json>(r, 'd7f_cancel');
    expect(missingKeys(fut, COACHING_SHAPES.desk_cancel_enrolment)).toEqual([]);
    expect(fut).toMatchObject({
      status: 'cancelled',
      lesson_cancelled: true,
      refund_due_iqd: 30000,
    });

    expect(data<Json>(r, 'd7g_cancel')).toMatchObject({
      status: 'cancelled',
      lesson_cancelled: false,
    });
  });

  it('DB-08: lesson_assert_coach_bookable reads the coach, the link and the type; each creation body calls it after lock_coach', () => {
    expect(data(r, 'b_ok')).toBe(30000);
    expect(code(r, 'b_unlinked')).toBe('LESSON_TYPE_NOT_OFFERED');
    expect(code(r, 'b_inactive')).toBe('LESSON_TYPE_INACTIVE');
    expect(code(r, 'b_paused')).toBe('COACH_INACTIVE');
    expect(code(r, 'b_retired_staff')).toBe('COACH_NOT_FOUND');
    expect(code(r, 'b_retired_coach')).toBe('NOT_A_COACH');
    expect(data(r, 'b_order')).toEqual({
      desk_book_lesson: true,
      coach_book_private: true,
      lesson_group_create_internal: true,
      lesson_course_create_internal: true,
    });
  });

  it('DB-10: a staff member who coaches where they are not staff books, moves and is booked over lapsed holds there', () => {
    expect(data<Json>(r, 'x_cb')).toMatchObject({ duplicate: false });
    expect(data(r, 'xh1_after')).toBe('expired');
    expect(data<Json>(r, 'x_rs')).toMatchObject({ duplicate: false });
    expect(data(r, 'xh2_after')).toBe('expired');
    expect(data<Json>(r, 'x_guest')).toMatchObject({ duplicate: false, status: 'booked' });
    expect(data(r, 'xh3_after')).toBe('expired');
  });

  it('DB-11: lesson_create_internal refuses a branch that is not open', () => {
    expect(code(r, 'y_create')).toBe('COACH_NOT_AT_BRANCH');
  });

  it('DB-12: a course cancelled during session 3 leaves it and an earlier session markable; DB-14: the duplicate carries sessions_cancelled', () => {
    expect(data<Json>(r, 'k12_rm2')).toMatchObject({ status: 'cancelled' });
    expect(data<Json>(r, 'k12_cancel')).toMatchObject({ duplicate: false, sessions_cancelled: 1 });
    const again = data<Json>(r, 'k12_cancel_again');
    expect(missingKeys(again, COACHING_SHAPES.coach_cancel_course)).toEqual([]);
    expect(again).toMatchObject({ duplicate: true, sessions_cancelled: 0 });
    expect(data<Json>(r, 'k12_state')).toEqual({
      course: 'cancelled',
      e: 'cancelled:course_cancelled',
      s3: 'scheduled',
      s4: 'cancelled',
    });
    expect(data<Json>(r, 'k12_s3_att')).toMatchObject({ attendance: 'attended', duplicate: false });
    expect(data<Json>(r, 'k12_s3_ns')).toMatchObject({ attendance: 'no_show', duplicate: false });
    expect(data<Json>(r, 'k12_s3_clear')).toMatchObject({ attendance: null, duplicate: false });
    expect(data<Json>(r, 'k12_s2_att')).toMatchObject({ attendance: 'attended' });
    expect(code(r, 'k12_s1_att')).toBe('INVALID_TRANSITION:marks_closed');
    expect(code(r, 'k12_s4_att')).toBe('INVALID_TRANSITION:not_started');
    expect(code(r, 'k12_e2_att')).toBe('INVALID_TRANSITION:not_booked');
    expect(data(r, 'k12_marks')).toEqual({ '2': 'attended' });
  });

  it('DB-13: "yes" on a removed place is refused; "Not me" still unlinks it', () => {
    expect(data(r, 'a13_linked')).toBe(true);
    expect(data<Json>(r, 'a13_rm')).toMatchObject({ ok: true });
    expect(code(r, 'a13_yes')).toBe('INVALID_TRANSITION:status');
    expect(data<Json>(r, 'a13_no')).toMatchObject({ linked: false, duplicate: false });
    expect(data(r, 'a13_after')).toBe(true);
  });
});
