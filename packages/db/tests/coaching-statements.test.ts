/**
 * Coaching, migration 0287 coach_statements (docs/design/coaching/money.md §7, §10 cases S1–S12;
 * build contracts C-6, C-12, C-24, C-25, C-28, CM-7..CM-12, R4, R21, R24, R42, R59, R70, R72, R74).
 *
 * The money is money.md's worked numbers (private 40,000 with court share 10,000; group 15,000 a
 * place with court share 10,000; course 100,001 for 4 sessions with court share 8,000;
 * coach_share_bp 6000), and every line is checked against the @touch/core twins
 * (lessonCoachShare, allocateCourseMoney, courseLateJoinPrice), never against a number typed here.
 *
 *   S1  a month's draft: every line = lessonCoachShare(collected, court share, bp)
 *   S2  an approved month, a goodwill refund after it, the next draft's adjustments
 *   S10 approve, refund, redraft twice: the adjustment appears exactly once (R24); every line has
 *       its lesson
 *   S3  mark paid: PIN (R4), reference required, never a card number (R74), no payments, refunds
 *       or booking_payments row (L10), audit without an amount (C-28), coach.statement_paid queued
 *   S4  void: from draft without a PIN, from approved with one (R70), paid refused; a void month
 *       redrafted; its lessons become adjustments on the next draft
 *   S9  a negative month cannot be marked paid (R59); voided, it is carried forward
 *   S5  one live draft per pair (CM-8): the run refreshes the older draft
 *   S6  stale before a refresh, not after
 *   S12 coach-booked no-shows on the statement detail (C-24, R72)
 *   S7  own statement refused (CM-11) and every can flag false; an invisible statement
 *   S8  my_coach_statements: approved and paid only, lines for a month, a retired coach still reads
 *   S11 the procedure commits per pair: a failing pair leaves the others' drafts (R59)
 *
 * The functions of 0281 (lesson_collected, the engine), 0282 (coach_of_caller) and 0283 (Guest's
 * lesson_notify) are called as they are specified; this suite is their first consumer here.
 */
import { describe, expect, it } from 'vitest';
import { SEED_STAFF_IDS, stackAvailable, VENUE_A_ID } from './helpers';
import {
  dockerReachable,
  KEEP,
  ok,
  psql,
  Q,
  refused,
  scenario,
  T,
  X,
  type Results,
} from './stores-harness';
import { E, GUEST, PLANT } from './coaching-plant';
import {
  allocateCourseMoney,
  courseLateJoinPrice,
  lessonCoachShare,
} from '../../core/src/coaching/statement';
import { COACHING_SHAPES, missingKeys } from '../../core/src/coaching/shapes';

const up = await stackAvailable();
const docker = up && dockerReachable();

const BP = 6000;
const PRIVATE = { price: 40_000, court: 10_000 };
const GROUP = { price: 15_000, court: 10_000 };
const COURSE = { price: 100_001, sessions: 4, court: 8_000 };

type Line = { collected: number; court: number; bp: number; coach: number; adj: boolean };

/** Every line of a statement, by lesson id. */
const LINES = (label: string, st: string) =>
  Q(
    label,
    `select coalesce(jsonb_object_agg(lesson_id::text, jsonb_build_object('collected', collected_iqd,
              'court', court_share_iqd, 'bp', share_bp, 'coach', coach_iqd, 'adj', is_adjustment)), '{}'::jsonb)
              from coach_statement_lines where statement_id = {{${st}}}`,
  );
const STATEMENT = (label: string, st: string) =>
  Q(
    label,
    `select jsonb_build_object('status', status, 'lessons_count', lessons_count, 'collected', collected_iqd,
              'court', court_share_iqd, 'coach', coach_iqd, 'adjustments', adjustments_iqd, 'month', month)
              from coach_statements where id = {{${st}}}`,
  );
const STATEMENT_ID = (name: string, months: number, status = `status <> 'void'`) =>
  KEEP(
    name,
    `select id from coach_statements where coach_id = {{c1}} and venue_id = {{venue}}
                and month = pg_temp.mon(${months}) and ${status}`,
  );
/** A private lesson of c1, completed, at 10:00 local on day `day` of month `months`. */
const PRIVATE_LESSON = (name: string, months: number, day: number) =>
  KEEP(
    name,
    `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
    'status', 'completed', 'completed_at', now(),
    'start_at', pg_temp.at(${months}, ${day}, 10), 'end_at', pg_temp.at(${months}, ${day}, 11)))`,
  );

/** The base of every scenario: the rail's branch, a coach c1 with a push token, the types. */
const BASE = [
  PLANT,
  // The manager's resolved branch (app.current_venue) is venue A for the whole transaction.
  X(`select set_config('app.venue_id', {{venue}}, true)`),
  GUEST('gc'),
  KEEP('c1', `select pg_temp.coach({{gc}})`),
  X(`update profiles set expo_push_token = 'ExponentPushToken[cf284cf284cf284]' where id = {{gc}}`),
  KEEP('lt', `select pg_temp.ltype()`),
  KEEP(
    'lt_group',
    `select pg_temp.ltype('{"kind":"group","name_en":"Group","price_iqd":15000,"max_places":4,
    "min_places":1,"cutoff_hours":1}'::jsonb)`,
  ),
  KEEP(
    'lt_course',
    `select pg_temp.ltype('{"kind":"course","name_en":"Course","price_iqd":100001,"sessions_count":4,
    "court_share_iqd":8000,"max_places":8,"min_places":1,"cutoff_hours":1}'::jsonb)`,
  ),
  KEEP('m3', `select pg_temp.mon(-3)::text`),
  KEEP('m2', `select pg_temp.mon(-2)::text`),
  KEEP('m1', `select pg_temp.mon(-1)::text`),
];

function failure(
  r: Results,
  label: string,
): { code: string; detail: string | null; hint: string | null } {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return { code: o!.code!, detail: o!.detail ?? null, hint: o!.hint ?? null };
}

const lineOf = (collected: number, court: number, adj = false): Line => ({
  collected,
  court,
  bp: BP,
  coach: lessonCoachShare(collected, court, BP),
  adj,
});

describe.skipIf(!docker)(
  'coaching 0287: the statement math against the core twins (S1, S2, S10)',
  () => {
    it('a month, its approval, a refund after it, two redrafts: one adjustment per lesson, every line named', () => {
      const lateJoin = courseLateJoinPrice(COURSE.price, COURSE.sessions, 3);
      const session = (n: number, months: number, day: number) =>
        KEEP(
          `k${n}`,
          `select pg_temp.lesson(jsonb_build_object('kind', 'course', 'coach_id', {{c1}},
        'lesson_type_id', {{lt_course}}, 'course_id', {{k}}, 'session_no', ${n}, 'price_iqd', null,
        'court_share_iqd', ${COURSE.court}, 'max_places', 8, 'min_places', 1, 'cutoff_at', pg_temp.at(-2, 10, 9),
        'status', 'completed', 'completed_at', now(),
        'start_at', pg_temp.at(${months}, ${day}, 10), 'end_at', pg_temp.at(${months}, ${day}, 11)))`,
        );
      const r = scenario('cf284-a', [
        ...BASE,
        ...['s1', 's2', 's3', 's4', 's5', 's6'].map(GUEST),
        // D1: a private lesson paid 40,000.
        PRIVATE_LESSON('d1', -2, 3),
        KEEP('d1e', `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{d1}}))`),
        X(`select pg_temp.paid({{d1e}})`),
        // D3: a group session, four places at 15,000, three paid, the fourth a no-show who never paid.
        KEEP(
          'd3',
          `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{c1}},
        'lesson_type_id', {{lt_group}}, 'price_iqd', ${GROUP.price}, 'max_places', 4, 'min_places', 1,
        'cutoff_at', pg_temp.at(-2, 5, 9), 'status', 'completed', 'completed_at', now(),
        'start_at', pg_temp.at(-2, 5, 10), 'end_at', pg_temp.at(-2, 5, 11)))`,
        ),
        ...[1, 2, 3, 4].map((n) =>
          KEEP(
            `d3e${n}`,
            `select pg_temp.genrol({{s${n}}}, jsonb_build_object('lesson_id', {{d3}}, 'price_iqd', ${GROUP.price}))`,
          ),
        ),
        X(`select pg_temp.paid({{d3e1}})`),
        X(`select pg_temp.paid({{d3e2}})`),
        X(`select pg_temp.paid({{d3e3}})`),
        X(`select pg_temp.mark({{d3}}, {{d3e4}}, 'no_show')`),
        // D4: a course, sessions 1-2 last month but one, 3-4 last month; a full member, a late joiner.
        KEEP(
          'k',
          `select pg_temp.ins('courses', jsonb_build_object('venue_id', {{venue}}, 'coach_id', {{c1}},
        'lesson_type_id', {{lt_course}}, 'price_iqd', ${COURSE.price}, 'court_share_iqd', ${COURSE.court},
        'coach_share_bp', ${BP}, 'sessions_count', 4, 'max_places', 8, 'min_places', 1,
        'cutoff_at', pg_temp.at(-2, 10, 9), 'cutoff_checked_at', pg_temp.at(-2, 10, 9),
        'signup_closes_at', pg_temp.at(-1, 10, 10), 'status', 'completed', 'created_by_kind', 'staff',
        'created_by_staff_id', {{desk}}))`,
        ),
        session(1, -2, 10),
        session(2, -2, 17),
        session(3, -1, 3),
        session(4, -1, 10),
        KEEP(
          'ke5',
          `select pg_temp.genrol({{s5}}, jsonb_build_object('course_id', {{k}}, 'price_iqd', ${COURSE.price},
        'first_session_no', 1, 'sessions_covered', 4))`,
        ),
        KEEP('pay5', `select pg_temp.paid({{ke5}})`),
        KEEP(
          'ke6',
          `select pg_temp.genrol({{s6}}, jsonb_build_object('course_id', {{k}}, 'price_iqd', ${lateJoin},
        'first_session_no', 3, 'sessions_covered', 2))`,
        ),
        X(`select pg_temp.paid({{ke6}})`),
        // R2: a private lesson the guest cancelled late; the online money is kept (CM-7).
        KEEP(
          'r2',
          `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
        'status', 'cancelled', 'cancel_reason', 'guest_cancel', 'cancelled_at', pg_temp.at(-2, 19, 10),
        'booked_by_kind', 'guest', 'created_by_profile_id', {{s1}}, 'created_by_staff_id', null,
        'start_at', pg_temp.at(-2, 20, 10), 'end_at', pg_temp.at(-2, 20, 11)))`,
        ),
        KEEP(
          'r2e',
          `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{r2}}, 'status', 'cancelled',
        'cancel_kind', 'guest_late', 'cancelled_at', pg_temp.at(-2, 19, 10)))`,
        ),
        X(`select pg_temp.paid({{r2e}})`),

        // S1: last month but one.
        E(
          'build1',
          `select to_jsonb(app.coach_statement_build({{c1}}, {{venue}}, pg_temp.mon(-2)))`,
        ),
        STATEMENT_ID('st1', -2),
        LINES('lines1', 'st1'),
        STATEMENT('st1row', 'st1'),
        // S2: approved; the chain drafts last month at once.
        T('approve1', 'manager', `select app.coach_statement_approve({{st1}})`),
        STATEMENT_ID('st2', -1, `status = 'draft'`),
        LINES('lines2a', 'st2'),
        // D5: a 10,001 goodwill refund of the full member's payment, after the approval.
        X(`select pg_temp.refunded({{pay5}}, 10001)`),
        T('detail_stale', 'manager', `select app.coach_statement_detail({{st2}})`),
        T('refresh2', 'manager', `select app.coach_statement_refresh({{st2}})`),
        T('refresh3', 'manager', `select app.coach_statement_refresh({{st2}})`),
        LINES('lines2', 'st2'),
        STATEMENT('st2row', 'st2'),
        T('detail2', 'manager', `select app.coach_statement_detail({{st2}})`),
        T('approve2', 'manager', `select app.coach_statement_approve({{st2}})`),
        // S10 / R24: the adjustment of session 1 is on one statement only; every line names its lesson.
        Q(
          'adj_k1',
          `select to_jsonb(count(*)) from coach_statement_lines where lesson_id = {{k1}} and is_adjustment`,
        ),
        Q(
          'named',
          `select to_jsonb(bool_and(ln.lesson_id is not null)) from coach_statement_lines ln
                    join coach_statements s on s.id = ln.statement_id where s.coach_id = {{c1}}`,
        ),
        T('report', 'manager', `select app.report_coach_statements({{m2}}::date)`),
        Q(
          'outbox',
          `select coalesce(jsonb_agg(payload ->> 'title_key' ), '[]'::jsonb)
                     from notification_outbox where profile_id = {{gc}} and kind = 'coach_update'`,
        ),
        Q(
          'audit',
          `select coalesce(jsonb_agg(jsonb_build_object('action', action, 'after', after) order by at), '[]'::jsonb)
                    from audit_log where entity = 'coach_statements' and entity_id in ({{st1}}::text, {{st2}}::text)`,
        ),
        Q(
          'ids',
          `select jsonb_build_object('d1', {{d1}}, 'd3', {{d3}}, 'k1', {{k1}}, 'k2', {{k2}}, 'k3', {{k3}},
                  'k4', {{k4}}, 'r2', {{r2}}, 'st2', {{st2}})`,
        ),
      ]);
      const ids = ok<{
        d1: string;
        d3: string;
        k1: string;
        k2: string;
        k3: string;
        k4: string;
        r2: string;
        st2: string;
      }>(r, 'ids');

      // ── S1: money.md's numbers, through the twins.
      const full = allocateCourseMoney(COURSE.price, 4); // [25001, 25000, 25000, 25000]
      const late = allocateCourseMoney(lateJoin, 2); // sessions 3 and 4
      const lines1 = ok<Record<string, Line>>(r, 'lines1');
      expect(lines1).toEqual({
        [ids.d1]: lineOf(PRIVATE.price, PRIVATE.court),
        [ids.d3]: lineOf(3 * GROUP.price, GROUP.court), // the unpaid no-show adds 0
        [ids.k1]: lineOf(full[0]!, COURSE.court),
        [ids.k2]: lineOf(full[1]!, COURSE.court),
        [ids.r2]: lineOf(PRIVATE.price, PRIVATE.court),
      });
      // The worked figures themselves (money.md §10 S1).
      expect(lines1[ids.d1]!.coach).toBe(18_000);
      expect(lines1[ids.d3]!.coach).toBe(21_000);
      expect(lines1[ids.k1]!.coach).toBe(10_200);
      const st1 = ok<Record<string, unknown>>(r, 'st1row');
      const regular1 = Object.values(lines1);
      expect(st1).toMatchObject({
        status: 'draft',
        lessons_count: 5,
        collected: regular1.reduce((a, l) => a + l.collected, 0),
        court: regular1.reduce((a, l) => a + l.court, 0),
        coach: regular1.reduce((a, l) => a + l.coach, 0),
        adjustments: 0,
      });

      // ── S2: the approval chain drafted last month; then the refund moved September's money.
      const approve1 = ok<Record<string, unknown>>(r, 'approve1');
      expect(approve1).toMatchObject({ status: 'approved', next_statement_id: ids.st2 });
      expect(missingKeys(approve1, COACHING_SHAPES.coach_statement_approve)).toEqual([]);
      expect(ok(r, 'lines2a')).toEqual({
        [ids.k3]: lineOf(full[2]! + late[0]!, COURSE.court),
        [ids.k4]: lineOf(full[3]! + late[1]!, COURSE.court),
      });
      const afterRefund = allocateCourseMoney(COURSE.price - 10_001, 4); // [22500 x 4]
      const adj = (n: 0 | 1): Line => ({
        collected: afterRefund[n]! - full[n]!,
        court: 0,
        bp: BP,
        coach:
          lessonCoachShare(afterRefund[n]!, COURSE.court, BP) -
          lessonCoachShare(full[n]!, COURSE.court, BP),
        adj: true,
      });
      const lines2 = ok<Record<string, Line>>(r, 'lines2');
      expect(lines2).toEqual({
        [ids.k1]: adj(0),
        [ids.k2]: adj(1),
        [ids.k3]: lineOf(afterRefund[2]! + late[0]!, COURSE.court),
        [ids.k4]: lineOf(afterRefund[3]! + late[1]!, COURSE.court),
      });
      // money.md §10 S2: collected -2,501 and -2,500, coach -1,500 each; 47,500 and 23,700 regular.
      expect(lines2[ids.k1]).toMatchObject({ collected: -2_501, coach: -1_500 });
      expect(lines2[ids.k2]).toMatchObject({ collected: -2_500, coach: -1_500 });
      expect(lines2[ids.k3]).toMatchObject({ collected: 47_500, coach: 23_700 });
      expect(ok(r, 'st2row')).toMatchObject({
        lessons_count: 2,
        collected: 95_000,
        court: 16_000,
        coach: 47_400,
        adjustments: -3_000,
      });

      // The detail before the refresh was stale; after it, not.
      expect(ok<Record<string, unknown>>(r, 'detail_stale').stale).toBe(true);
      const detail2 = ok<Record<string, unknown>>(r, 'detail2');
      expect(detail2.stale).toBe(false);
      expect(missingKeys(detail2, COACHING_SHAPES.coach_statement_detail)).toEqual([]);
      expect(detail2.can).toEqual({ refresh: true, approve: true, void: true, mark_paid: false });
      expect(missingKeys(ok(r, 'refresh2'), COACHING_SHAPES.coach_statement_refresh)).toEqual([]);

      // ── S10 / R24.
      expect(ok<number>(r, 'adj_k1')).toBe(1);
      expect(ok<boolean>(r, 'named')).toBe(true);

      // The report (X22) and the pushes (R40): one coach.statement_ready per approval.
      const report = ok<Record<string, unknown>>(r, 'report');
      expect(missingKeys(report, COACHING_SHAPES.report_coach_statements)).toEqual([]);
      expect([...ok<string[]>(r, 'outbox')].sort()).toEqual([
        'coach.statement_ready',
        'coach.statement_ready',
      ]);
      // C-28: no audit row of a statement carries an amount or a reference.
      for (const a of ok<Array<{ action: string; after: Record<string, unknown> }>>(r, 'audit')) {
        expect(
          Object.keys(a.after ?? {}).filter((k) => /_iqd$|reference|reason/.test(k)),
          a.action,
        ).toEqual([]);
      }
    });
  },
);

describe.skipIf(!docker)('coaching 0287: mark paid and void (S3, S4)', () => {
  it('PIN, reference, card guard, no till money; void from draft and approved; a void month redrafted', () => {
    const r = scenario('cf284-b', [
      ...BASE,
      GUEST('s1'),
      PRIVATE_LESSON('b1', -3, 5),
      KEEP('b1e', `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{b1}}))`),
      X(`select pg_temp.paid({{b1e}})`),
      PRIVATE_LESSON('b2', -2, 5),
      KEEP('b2e', `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{b2}}))`),
      X(`select pg_temp.paid({{b2e}})`),
      E('build', `select to_jsonb(app.coach_statement_build({{c1}}, {{venue}}, pg_temp.mon(-3)))`),
      STATEMENT_ID('st1', -3),
      T('approve', 'manager', `select app.coach_statement_approve({{st1}})`),
      STATEMENT_ID('st2', -2, `status = 'draft'`),
      Q(
        'money_before',
        `select jsonb_build_object('payments', (select count(*) from payments),
                           'refunds', (select count(*) from refunds), 'bp', (select count(*) from booking_payments))`,
      ),
      // S3: mark paid.
      // Other suites' committed grants for the shared seed manager age out in this transaction.
      X(
        `update app.pin_grants set created_at = now() - interval '1 day' where caller_id = {{manager}} and consumed_at is null`,
      ),
      T(
        'paid_nogrant',
        'manager',
        `select app.coach_statement_mark_paid({{st1}}, 'TRX-1', '380517', null)`,
      ),
      T(
        'paid_blank',
        'manager',
        `select app.coach_statement_mark_paid({{st1}}, '   ', '380517', null)`,
      ),
      T(
        'paid_card',
        'manager',
        `select app.coach_statement_mark_paid({{st1}}, '4111 1111 1111 1111', '380517', null)`,
      ),
      T(
        'paid_draft',
        'manager',
        `select app.coach_statement_mark_paid({{st2}}, 'TRX-0', '380517', null)`,
      ),
      X(`select pg_temp.grant_pin({{manager}})`),
      T(
        'paid',
        'manager',
        `select app.coach_statement_mark_paid({{st1}}, 'TRX-1', '380517', null)`,
      ),
      T(
        'paid_again',
        'manager',
        `select app.coach_statement_mark_paid({{st1}}, 'TRX-2', '380517', null)`,
      ),
      Q(
        'money_after',
        `select jsonb_build_object('payments', (select count(*) from payments),
                          'refunds', (select count(*) from refunds), 'bp', (select count(*) from booking_payments))`,
      ),
      Q(
        'st1_paid',
        `select jsonb_build_object('status', status, 'paid_reference', paid_reference,
                       'paid_by', paid_by) from coach_statements where id = {{st1}}`,
      ),
      Q(
        'audit_paid',
        `select after from audit_log where action = 'coach.statement_paid' and entity_id = {{st1}}::text`,
      ),
      Q(
        'authorizer',
        `select to_jsonb(authorizer_id) from audit_log
                         where action = 'coach.statement_paid' and entity_id = {{st1}}::text`,
      ),
      // S4: void.
      T('void_paid', 'manager', `select app.coach_statement_void({{st1}}, 'mistake', null, null)`),
      T('void_blank', 'manager', `select app.coach_statement_void({{st2}}, '  ', null, null)`),
      T(
        'void_digits',
        'manager',
        `select app.coach_statement_void({{st2}}, 'card 4111-1111-1111-1111', null, null)`,
      ),
      T(
        'void_draft',
        'manager',
        `select app.coach_statement_void({{st2}}, 'wrong month', null, null)`,
      ),
      T('void_again', 'manager', `select app.coach_statement_void({{st2}}, 'again', null, null)`),
      T('refresh_void', 'manager', `select app.coach_statement_refresh({{st2}})`),
      STATEMENT_ID('st2b', -2, `status = 'draft'`),
      T('approve2b', 'manager', `select app.coach_statement_approve({{st2b}})`),
      // Other suites' committed grants for the shared seed manager age out in this transaction.
      X(
        `update app.pin_grants set created_at = now() - interval '1 day' where caller_id = {{manager}} and consumed_at is null`,
      ),
      T(
        'void_nogrant',
        'manager',
        `select app.coach_statement_void({{st2b}}, 'recount', '380517', null)`,
      ),
      X(`select pg_temp.grant_pin({{manager}})`),
      T(
        'void_approved',
        'manager',
        `select app.coach_statement_void({{st2b}}, 'recount', '380517', null)`,
      ),
      // The voided month's lesson is an adjustment of last month's draft.
      E('build3', `select to_jsonb(app.coach_statement_build({{c1}}, {{venue}}, pg_temp.mon(-1)))`),
      STATEMENT_ID('st3', -1),
      LINES('lines3', 'st3'),
      Q(
        'outbox',
        `select coalesce(jsonb_agg(payload ->> 'title_key' ), '[]'::jsonb)
                     from notification_outbox where profile_id = {{gc}} and kind = 'coach_update'`,
      ),
      Q(
        'ids',
        `select jsonb_build_object('b1', {{b1}}, 'b2', {{b2}}, 'st2', {{st2}}, 'st2b', {{st2b}},
                  'manager', {{manager}})`,
      ),
    ]);
    const ids = ok<{ b1: string; b2: string; st2: string; st2b: string; manager: string }>(
      r,
      'ids',
    );
    expect(refused(r, 'paid_nogrant')).toBe('PIN_GRANT_REQUIRED');
    expect(refused(r, 'paid_blank')).toBe('STATEMENT_REFERENCE_REQUIRED');
    expect(failure(r, 'paid_card')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_reference',
      hint: 'digits',
    });
    expect(failure(r, 'paid_draft')).toMatchObject({
      code: 'STATEMENT_NOT_APPROVED',
      detail: 'draft',
    });
    const paid = ok<Record<string, unknown>>(r, 'paid');
    expect(paid).toMatchObject({
      duplicate: false,
      status: 'paid',
      total_iqd: lessonCoachShare(40_000, 10_000, BP),
    });
    expect(missingKeys(paid, COACHING_SHAPES.coach_statement_mark_paid)).toEqual([]);
    expect(ok(r, 'paid_again')).toMatchObject({ duplicate: true, paid_reference: 'TRX-1' });
    // L10: marking paid moves no till or online money.
    expect(ok(r, 'money_after')).toEqual(ok(r, 'money_before'));
    expect(ok(r, 'st1_paid')).toMatchObject({
      status: 'paid',
      paid_reference: 'TRX-1',
      paid_by: ids.manager,
    });
    const auditPaid = ok<Record<string, unknown>>(r, 'audit_paid');
    expect(Object.keys(auditPaid).sort()).toEqual(['coach_id', 'month', 'statement_id', 'status']);
    expect(ok(r, 'authorizer')).toBe(ids.manager);

    expect(failure(r, 'void_paid')).toMatchObject({ code: 'INVALID_TRANSITION', detail: 'paid' });
    expect(refused(r, 'void_blank')).toBe('REASON_REQUIRED');
    expect(failure(r, 'void_digits')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_reason',
      hint: 'digits',
    });
    expect(ok(r, 'void_draft')).toMatchObject({ duplicate: false, status: 'void' });
    expect(ok(r, 'void_again')).toMatchObject({ duplicate: true, status: 'void' });
    expect(ok(r, 'refresh_void')).toMatchObject({
      status: 'draft',
      created: true,
      statement_id: ids.st2b,
    });
    expect(ids.st2b).not.toBe(ids.st2);
    ok(r, 'approve2b');
    expect(refused(r, 'void_nogrant')).toBe('PIN_GRANT_REQUIRED');
    expect(ok(r, 'void_approved')).toMatchObject({ duplicate: false, status: 'void' });
    // The void month's lesson rolls into the next draft as an adjustment (CM-10).
    expect(ok(r, 'lines3')).toEqual({ [ids.b2]: lineOf(40_000, 10_000, true) });
    expect([...ok<string[]>(r, 'outbox')].sort()).toEqual([
      'coach.statement_paid',
      'coach.statement_ready',
      'coach.statement_ready',
    ]);
  });

  it('S9: a negative month cannot be marked paid; voided, it is carried forward (R59)', () => {
    const r = scenario('cf284-c', [
      ...BASE,
      GUEST('s1'),
      PRIVATE_LESSON('n1', -3, 5),
      KEEP('n1e', `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{n1}}))`),
      KEEP('pay', `select pg_temp.paid({{n1e}})`),
      E('build', `select to_jsonb(app.coach_statement_build({{c1}}, {{venue}}, pg_temp.mon(-3)))`),
      STATEMENT_ID('st1', -3),
      T('approve', 'manager', `select app.coach_statement_approve({{st1}})`),
      X(`select pg_temp.grant_pin({{manager}})`),
      T(
        'paid',
        'manager',
        `select app.coach_statement_mark_paid({{st1}}, 'TRX-9', '380517', null)`,
      ),
      // A full goodwill refund after the month was paid.
      X(`select pg_temp.refunded({{pay}}, 40000)`),
      E('build2', `select to_jsonb(app.coach_statement_build({{c1}}, {{venue}}, pg_temp.mon(-2)))`),
      STATEMENT_ID('st2', -2),
      STATEMENT('st2row', 'st2'),
      T('approve2', 'manager', `select app.coach_statement_approve({{st2}})`),
      X(`select pg_temp.grant_pin({{manager}})`),
      T(
        'paid2',
        'manager',
        `select app.coach_statement_mark_paid({{st2}}, 'TRX-10', '380517', null)`,
      ),
      Q(
        'grant_kept',
        // This transaction's own grants only (created_at = its now()), not other suites'.
        `select to_jsonb(count(*)) from app.pin_grants where caller_id = {{manager}} and consumed_at is null
            and created_at = now()`,
      ),
      T('detail2', 'manager', `select app.coach_statement_detail({{st2}})`),
      T(
        'void2',
        'manager',
        `select app.coach_statement_void({{st2}}, 'refund after payment', '380517', null)`,
      ),
      E('build3', `select to_jsonb(app.coach_statement_build({{c1}}, {{venue}}, pg_temp.mon(-1)))`),
      STATEMENT_ID('st3', -1),
      STATEMENT('st3row', 'st3'),
    ]);
    const share = lessonCoachShare(40_000, 10_000, BP);
    ok(r, 'paid');
    expect(ok(r, 'st2row')).toMatchObject({ lessons_count: 0, coach: 0, adjustments: -share });
    expect(failure(r, 'paid2')).toMatchObject({
      code: 'STATEMENT_NOT_APPROVED',
      detail: 'negative',
    });
    // Refused before the grant was spent.
    expect(ok<number>(r, 'grant_kept')).toBe(1);
    expect(ok<{ can: { mark_paid: boolean } }>(r, 'detail2').can.mark_paid).toBe(false);
    ok(r, 'void2');
    expect(ok(r, 'st3row')).toMatchObject({ lessons_count: 0, adjustments: -share });
  });
});

describe.skipIf(!docker)('coaching 0287: drafting rules and the detail (S5, S6, S12, S7)', () => {
  it('one live draft per pair; stale until refreshed; coach-booked no-shows listed', () => {
    const r = scenario('cf284-d', [
      ...BASE,
      GUEST('s1'),
      PRIVATE_LESSON('a1', -2, 4),
      KEEP('a1e', `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{a1}}))`),
      X(`select pg_temp.paid({{a1e}})`),
      PRIVATE_LESSON('a2', -1, 4),
      KEEP('a2e', `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{a2}}))`),
      // A coach-booked private lesson last month whose typed student never came nor paid (C-24).
      KEEP(
        'a3',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
        'status', 'completed', 'completed_at', now(), 'booked_by_kind', 'coach',
        'created_by_profile_id', {{gc}}, 'created_by_staff_id', null,
        'start_at', pg_temp.at(-1, 6, 10), 'end_at', pg_temp.at(-1, 6, 11)))`,
      ),
      KEEP('a3e', `select pg_temp.cenrol({{gc}}, jsonb_build_object('lesson_id', {{a3}}))`),
      X(`select pg_temp.mark({{a3}}, {{a3e}}, 'no_show')`),
      E('build', `select to_jsonb(app.coach_statement_build({{c1}}, {{venue}}, pg_temp.mon(-2)))`),
      // S5: the run for last month refreshes the older live draft instead.
      E(
        'blocked',
        `select to_jsonb(app.coach_statement_build({{c1}}, {{venue}}, pg_temp.mon(-1)))`,
      ),
      E(
        'run',
        `select to_jsonb(app.coach_statement_draft_one({{c1}}, {{venue}}, pg_temp.mon(-1)))`,
      ),
      Q(
        'months',
        `select coalesce(jsonb_agg(jsonb_build_object('month', month, 'status', status,
                     'refreshed', refreshed_at is not null) order by month), '[]'::jsonb)
                     from coach_statements where coach_id = {{c1}}`,
      ),
      STATEMENT_ID('st1', -2),
      T('approve', 'manager', `select app.coach_statement_approve({{st1}})`),
      STATEMENT_ID('st2', -1, `status = 'draft'`),
      // S6: money moves on a drafted lesson -> stale; a refresh -> not.
      T('fresh', 'manager', `select app.coach_statement_detail({{st2}})`),
      X(`select pg_temp.paid({{a2e}})`),
      T('stale', 'manager', `select app.coach_statement_detail({{st2}})`),
      T('refresh', 'manager', `select app.coach_statement_refresh({{st2}})`),
      T('after', 'manager', `select app.coach_statement_detail({{st2}})`),
      Q('ids', `select jsonb_build_object('a2', {{a2}}, 'a3', {{a3}})`),
    ]);
    const ids = ok<{ a2: string; a3: string }>(r, 'ids');
    expect(ok(r, 'blocked')).toBeNull();
    expect(ok(r, 'run')).toBe(true);
    const months = ok<Array<{ status: string; refreshed: boolean }>>(r, 'months');
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({ status: 'draft', refreshed: true });
    expect(ok(r, 'approve')).toMatchObject({ status: 'approved' });

    expect(ok<Record<string, unknown>>(r, 'fresh').stale).toBe(false);
    expect(ok<Record<string, unknown>>(r, 'stale').stale).toBe(true);
    const after = ok<Record<string, unknown>>(r, 'after');
    expect(after.stale).toBe(false);
    const lines = after.lines as Array<Record<string, unknown>>;
    expect(lines.find((l) => l.lesson_id === ids.a2)).toMatchObject({
      collected_iqd: 40_000,
      coach_iqd: lessonCoachShare(40_000, 10_000, BP),
      is_adjustment: false,
    });
    // S12: the coach-booked no-show is a line with nothing collected, and listed (R72).
    expect(lines.find((l) => l.lesson_id === ids.a3)).toMatchObject({
      collected_iqd: 0,
      coach_iqd: 0,
      no_shows: 1,
      is_adjustment: false,
    });
    expect(after.coach_booked_no_shows).toEqual([
      { lesson_id: ids.a3, start_at: expect.any(String), student_label: 'Typed Student' },
    ]);
  });

  it('S7: a manager never acts on their own statement; an invisible statement is INVALID_ARGUMENT', () => {
    const r = scenario('cf284-e', [
      ...BASE,
      // A manager who also coaches (C-27), with a lesson last month.
      `select pg_temp.mk('mgr_coach', 'manager');`,
      KEEP('c_own', `select pg_temp.coach({{mgr_coach}})`),
      KEEP(
        'own_l',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{c_own}}, 'lesson_type_id', {{lt}},
        'status', 'completed', 'completed_at', now(),
        'start_at', pg_temp.at(-2, 8, 10), 'end_at', pg_temp.at(-2, 8, 11)))`,
      ),
      E(
        'build',
        `select to_jsonb(app.coach_statement_build({{c_own}}, {{venue}}, pg_temp.mon(-2)))`,
      ),
      KEEP(
        'own_st',
        `select id from coach_statements where coach_id = {{c_own}} and month = pg_temp.mon(-2)`,
      ),
      T('own_approve', 'mgr_coach', `select app.coach_statement_approve({{own_st}})`),
      T('own_detail', 'mgr_coach', `select app.coach_statement_detail({{own_st}})`),
      T('other_approve', 'manager', `select app.coach_statement_approve({{own_st}})`),
      // A statement at a branch the manager cannot see.
      KEEP(
        'far_st',
        `select pg_temp.ins('coach_statements', jsonb_build_object('coach_id', {{c1}},
        'venue_id', {{other_venue}}, 'month', pg_temp.mon(-2)))`,
      ),
      T('far_detail', 'manager', `select app.coach_statement_detail({{far_st}})`),
      T('far_void', 'manager', `select app.coach_statement_void({{far_st}}, 'x', null, null)`),
      T('cashier', 'cashier', `select app.coach_statement_detail({{own_st}})`),
    ]);
    expect(failure(r, 'own_approve')).toMatchObject({ code: 'FORBIDDEN', detail: 'own_statement' });
    expect(ok<Record<string, unknown>>(r, 'own_detail').can).toEqual({
      refresh: false,
      approve: false,
      void: false,
      mark_paid: false,
    });
    expect(ok(r, 'other_approve')).toMatchObject({ status: 'approved' });
    expect(failure(r, 'far_detail')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_statement_id',
    });
    expect(failure(r, 'far_void')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_statement_id',
    });
    expect(refused(r, 'cashier')).toBe('FORBIDDEN');
  });
});

describe.skipIf(!docker)('coaching 0287: my_coach_statements (S8; C-25, CM-12, R45)', () => {
  it('approved and paid only, lines for a month, never another coach; a retired coach still reads', () => {
    const r = scenario('cf284-f', [
      ...BASE,
      GUEST('s1'),
      GUEST('stranger'),
      PRIVATE_LESSON('m1l', -3, 5),
      KEEP('m1e', `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{m1l}}))`),
      X(`select pg_temp.paid({{m1e}})`),
      PRIVATE_LESSON('m2l', -2, 5),
      PRIVATE_LESSON('m3l', -1, 5),
      E('build', `select to_jsonb(app.coach_statement_build({{c1}}, {{venue}}, pg_temp.mon(-3)))`),
      STATEMENT_ID('st1', -3),
      T('approve1', 'manager', `select app.coach_statement_approve({{st1}})`),
      STATEMENT_ID('st2', -2, `status = 'draft'`),
      X(`select pg_temp.grant_pin({{manager}})`),
      T(
        'paid1',
        'manager',
        `select app.coach_statement_mark_paid({{st1}}, 'TRX-8', '380517', null)`,
      ),
      T('mine', 'gc', `select app.my_coach_statements(null)`),
      T('mine_month', 'gc', `select app.my_coach_statements({{m3}}::date)`),
      T('mine_draft_month', 'gc', `select app.my_coach_statements({{m2}}::date)`),
      T('stranger', 'stranger', `select app.my_coach_statements(null)`),
      X(`update coaches set status = 'retired', retired_at = now() where id = {{c1}}`),
      T('retired', 'gc', `select app.my_coach_statements(null)`),
    ]);
    ok(r, 'paid1');
    const mine = ok<Record<string, unknown>>(r, 'mine');
    expect(missingKeys(mine, COACHING_SHAPES.my_coach_statements)).toEqual([]);
    const statements = mine.statements as Array<Record<string, unknown>>;
    expect(statements.map((s) => s.status)).toEqual(['paid']);
    expect(statements[0]).not.toHaveProperty('lines');
    expect(statements[0]).toMatchObject({
      total_iqd: lessonCoachShare(40_000, 10_000, BP),
      share_bp: BP,
    });
    expect((mine.months as string[]).length).toBe(1);
    expect(mine.current_month).toEqual([
      expect.objectContaining({ venue_id: expect.any(String), estimate: true }),
    ]);

    const month = ok<Record<string, unknown>>(r, 'mine_month');
    const lines = (month.statements as Array<Record<string, unknown>>)[0]!.lines as unknown[];
    expect(lines).toHaveLength(1);
    expect(missingKeys(month, COACHING_SHAPES.my_coach_statements)).toEqual([]);
    // CM-12: a draft month shows nothing.
    expect(ok<Record<string, unknown>>(r, 'mine_draft_month').statements).toEqual([]);
    expect(refused(r, 'stranger')).toBe('NOT_A_COACH');
    // C-25: retired, still reads approved and paid; no estimate.
    const retired = ok<Record<string, unknown>>(r, 'retired');
    expect((retired.statements as unknown[]).length).toBe(1);
    expect(retired.current_month).toEqual([]);
  });
});

/**
 * S11 (R59): the procedure commits after each pair, so it cannot run inside the scenario's
 * transaction. It runs committed, for a month 30 months back that no other suite touches (every
 * other pair finds nothing to draft there), and cleans up after itself.
 */
describe.skipIf(!docker)('coaching 0287: procedure coach_statements_draft (S11)', () => {
  it('is a security-invoker procedure with no SET clause, granted to no client', () => {
    const out =
      psql(`select json_build_object('kind', p.prokind, 'definer', p.prosecdef, 'config', p.proconfig,
                        'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
                        'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'app' and p.proname = 'coach_statements_draft';`);
    expect(JSON.parse(out)).toEqual({
      kind: 'p',
      definer: false,
      config: null,
      anon: false,
      authenticated: false,
    });
  });

  it('a failing pair never undoes the others: their drafts are committed', () => {
    const tag = `cf284proc${Date.now()}`;
    const cleanup = `
      delete from coach_statement_lines where statement_id in (
        select s.id from coach_statements s join coaches c on c.id = s.coach_id
          join auth.users u on u.id = c.profile_id where u.email like '${tag}-%');
      delete from coach_statements where coach_id in (
        select c.id from coaches c join auth.users u on u.id = c.profile_id where u.email like '${tag}-%');
      delete from lessons where coach_id in (
        select c.id from coaches c join auth.users u on u.id = c.profile_id where u.email like '${tag}-%');
      delete from coach_branches where coach_id in (
        select c.id from coaches c join auth.users u on u.id = c.profile_id where u.email like '${tag}-%');
      delete from coaches where profile_id in (select u.id from auth.users u where u.email like '${tag}-%');
      delete from lesson_types where name_en = '${tag}';
      delete from auth.users where email like '${tag}-%';`;
    try {
      const out = psql(`
        set request.jwt.claims = '';
        create temp table cf (k text primary key, v text);
        with u as (insert into auth.users (id, email, raw_user_meta_data, aud, role)
                   select gen_random_uuid(), '${tag}-' || n, '{}'::jsonb, 'authenticated', 'authenticated'
                     from unnest(array['a', 'b']) n returning id, email)
        insert into cf select right(email, 1), id::text from u;
        with c as (insert into coaches (profile_id, display_name_en, display_name_ar, public_accepted_at)
                   select v::uuid, 'Proc ' || k, 'مدرّب ' || k, now() from cf where k in ('a', 'b')
                   returning id, profile_id)
        insert into cf select 'c' || cf.k, c.id::text from c join cf on cf.v = c.profile_id::text;
        insert into coach_branches (coach_id, venue_id)
          select v::uuid, '${VENUE_A_ID}' from cf where k in ('ca', 'cb');
        with t as (insert into lesson_types (venue_id, kind, name_en, name_ar, duration_min, price_iqd,
                     court_share_iqd, max_places, min_places, launched_at, is_active)
                   values ('${VENUE_A_ID}', 'private', '${tag}', 'حصة', 60, 40000, 10000, 1, 1, now(), true)
                   returning id)
        insert into cf select 'lt', id::text from t;
        insert into cf
          select 'month', ((date_trunc('month', (now() at time zone v.timezone)::date) - interval '30 months')::date)::text
            from venues v where v.id = '${VENUE_A_ID}';
        insert into cf
          select 'tz', v.timezone from venues v where v.id = '${VENUE_A_ID}';
        -- coach a: an ordinary lesson; coach b: a lesson whose share_bp the twin refuses
        -- (lesson_coach_share raises INVALID_ARGUMENT), so its build raises.
        insert into lessons (venue_id, coach_id, lesson_type_id, kind, start_at, end_at, price_iqd, court_share_iqd,
                             coach_share_bp, max_places, min_places, status, completed_at, booked_by_kind,
                             created_by_staff_id)
        select '${VENUE_A_ID}', c.v::uuid, (select v::uuid from cf where k = 'lt'), 'private',
               ((select v::date from cf where k = 'month') + 4)::timestamp at time zone (select v from cf where k = 'tz'),
               ((select v::date from cf where k = 'month') + 4)::timestamp at time zone (select v from cf where k = 'tz')
                 + interval '1 hour',
               40000, 10000, case c.k when 'ca' then 6000 else 20000 end, 1, 1, 'completed', now(), 'staff',
               '${SEED_STAFF_IDS.court_desk}'
          from cf c where c.k in ('ca', 'cb');
        -- CALL takes no subquery argument: read the month into a psql variable first.
        select v as cf_month from cf where k = 'month' \\gset
        call app.coach_statements_draft(:'cf_month'::date);
        select json_build_object(
                 'a', (select count(*) from coach_statements s where s.coach_id = (select v::uuid from cf where k = 'ca')),
                 'b', (select count(*) from coach_statements s where s.coach_id = (select v::uuid from cf where k = 'cb')));
      `);
      const last = out
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .pop()!;
      expect(JSON.parse(last)).toEqual({ a: 1, b: 0 });
    } finally {
      psql(cleanup);
    }
  });
});
