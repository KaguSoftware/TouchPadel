/**
 * Online lesson refunds through the real writes (plan "Coaching: make it bulletproof" TG-02 and
 * TG-10; money.md §6; build contracts R3, R4, R26, R28, C-23). Every place here is paid the way a
 * guest pays: the RPC books it held, lesson_payment_prepare starts the attempt (what the
 * lesson-begin edge function runs) and deposit_apply records the bank's SUCCESS (the webhook's
 * body). In rolled-back transactions (coaching-core-harness.ts):
 *
 *   * TG-02: the sweep cancels an under-filled group and an under-filled course and starts their
 *     refunds (refund_pending, reason under_filled, the whole price; the cancel starts them, so
 *     the refunds_started backstop is not read); a real coach_cancel_lesson refunds the booked
 *     place and, in its second loop, the place a guest left late and paid for (coach_cancel);
 *     coach_cancel_course and a retirement after session 2 refund what allocateCourseMoney gives
 *     sessions 3 and 4;
 *   * TG-10, "cancelled while the bank was thinking": the attempt begins, the place is cancelled
 *     (the guest's own cancel, the desk's lesson cancel, a group place), then SUCCESS: the payment
 *     is refund_pending, reason slot_lost, for the whole amount; the place stays cancelled, no
 *     live court row is left and no paid_online event is written.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { allocateCourseMoney } from '../../core/src/coaching/statement';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { at, data, E, FROM, R, SETUP } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/** lesson-begin's database half for `enrolment` of `guest`, then the bank's SUCCESS of `amount`. */
const BEGIN = (label: string, guest: string, enrolment: string) => [
  E(
    `${label}_begin`,
    null,
    `select app.lesson_payment_prepare({{${guest}}}::uuid, {{${enrolment}}}::uuid, 'en', 'fake')`,
  ),
  FROM(`${label}_rq`, `${label}_begin`, 'request_id'),
  FROM(`${label}_pay`, `${label}_begin`, 'id'),
];
const SUCCESS = (label: string, amount: number) =>
  E(
    `${label}_bank`,
    null,
    `select app.deposit_apply({{${label}_rq}}::uuid, null, 'SUCCESS', ${amount}, 'IQD', false, 'webhook', true,
                              '{}'::jsonb)`,
  );
const PAID = (label: string, guest: string, enrolment: string, amount: number) => [
  ...BEGIN(label, guest, enrolment),
  SUCCESS(label, amount),
];
const PAYMENT = (label: string) =>
  R(
    `${label}_payment`,
    `select jsonb_build_object('status', status, 'reason', refund_reason, 'amount', refund_amount_iqd)
       from booking_payments where id = {{${label}_pay}}::uuid`,
  );
const ENROL = (label: string, enrolment: string) =>
  R(
    label,
    `select jsonb_build_object('status', e.status, 'cancel_kind', e.cancel_kind,
              'paid_online', exists (select 1 from lesson_events ev
                                      where ev.enrolment_id = e.id and ev.type = 'paid_online'))
       from lesson_enrolments e where e.id = {{${enrolment}}}::uuid`,
  );
const LIVE_COURT = (label: string, lesson: string) =>
  R(
    label,
    `select to_jsonb(count(*)) from reservations
      where lesson_id = {{${lesson}}}::uuid and status in ('pending', 'confirmed', 'arrived')`,
  );
const LESSON_STATUS = (label: string, lesson: string) =>
  R(label, `select to_jsonb(status) from lessons where id = {{${lesson}}}::uuid`);

const COURSE_PRICE = 100001;
const FIXTURES = [
  SETUP,
  `select pg_temp.branch('v');`,
  `select pg_temp.online('v');`,
  X(`update venue_settings set cancellation_window_hours = 12 where venue_id = {{v}}::uuid`),
  `select pg_temp.guest('g1');`,
  `select pg_temp.guest('g2');`,
  ...['s1', 's2', 's3', 's4', 's5', 's6'].map((g) => `select pg_temp.guest('${g}');`),
  `select pg_temp.coach('c1', 'g1', 'v');`,
  `select pg_temp.coach('c2', 'g2', 'v');`,
  `select pg_temp.lt('lt_p', 'private', 'v');`,
  `select pg_temp.lt('lt_g', 'group', 'v');`,
  `select pg_temp.lt('lt_c', 'course', 'v', '{"price_iqd": ${COURSE_PRICE}}');`,
  ...['c1', 'c2'].flatMap((c) =>
    ['lt_p', 'lt_g', 'lt_c'].map((t) => `select pg_temp.teach('${c}', '${t}');`),
  ),
];

// ── TG-02 ────────────────────────────────────────────────────────────────

describe.skipIf(!docker)(
  'online refunds through the real cancels and the sweep (TG-02, rolled back)',
  () => {
    let r: Results;
    const course = (label: string, coach: string, day: number) => [
      E(
        label,
        'desk',
        `select app.desk_create_course({{${coach}}}, {{lt_c}},
         array[${at(day)}, ${at(day + 1)}, ${at(day + 2)}, ${at(day + 3)}]::timestamptz[], '', '', 'k-${label}')`,
      ),
      FROM(`${label}_id`, label, 'course_id'),
    ];
    /** Sessions 1 and 2 of a course given (started two and one days ago), the course running. */
    const AFTER_SESSION_2 = (course: string) =>
      X(`update lessons
          set start_at = now() - make_interval(days => 3 - session_no),
              end_at = now() - make_interval(days => 3 - session_no) + interval '1 hour',
              cutoff_at = now() - interval '3 days',
              status = 'completed', completed_at = now() - make_interval(days => 3 - session_no) + interval '1 hour'
        where course_id = {{${course}}}::uuid and session_no <= 2;
       update lessons set cutoff_at = now() - interval '3 days'
        where course_id = {{${course}}}::uuid and session_no > 2;
       update courses set status = 'running', cutoff_at = now() - interval '3 days', cutoff_checked_at = now()
        where id = {{${course}}}::uuid`);

    beforeAll(() => {
      r = scenario('ctg02', [
        ...FIXTURES,

        // (a) Under-filled: a group of min 2 and a course of min 2, one paid place each, cut-off passed.
        E('uf_g', 'desk', `select app.desk_create_group({{c1}}, {{lt_g}}, ${at(1, 6)}, 'k-uf_g')`),
        FROM('uf_g_id', 'uf_g', 'lesson_id'),
        E('uf_g_join', 's1', `select app.lesson_join({{uf_g_id}}, 'online', 15000, 'k-uf_g_join')`),
        FROM('uf_g_e', 'uf_g_join', 'enrolment_id'),
        ...PAID('ufg', 's1', 'uf_g_e', 15000),
        ...course('uf_k', 'c2', 2),
        E(
          'uf_k_join',
          's2',
          `select app.course_join({{uf_k_id}}, 'online', ${COURSE_PRICE}, 'k-uf_k_join')`,
        ),
        FROM('uf_k_e', 'uf_k_join', 'enrolment_id'),
        ...PAID('ufk', 's2', 'uf_k_e', COURSE_PRICE),
        X(
          `update lessons set cutoff_at = now() - interval '1 minute' where id = {{uf_g_id}}::uuid`,
        ),
        X(`update courses set cutoff_at = now() - interval '1 minute' where id = {{uf_k_id}}::uuid;
         update lessons set cutoff_at = now() - interval '1 minute' where course_id = {{uf_k_id}}::uuid`),
        E('sweep', null, `select app.lesson_sweep()`),
        PAYMENT('ufg'),
        PAYMENT('ufk'),
        ENROL('uf_g_after', 'uf_g_e'),
        ENROL('uf_k_after', 'uf_k_e'),

        // (b) A coach cancel: s3 booked and paid; s4 paid, then left late (kept); both refunded.
        E('cc_g', 'desk', `select app.desk_create_group({{c1}}, {{lt_g}}, ${at(0, 5)}, 'k-cc_g')`),
        FROM('cc_g_id', 'cc_g', 'lesson_id'),
        E('cc_s3', 's3', `select app.lesson_join({{cc_g_id}}, 'online', 15000, 'k-cc_s3')`),
        FROM('cc_s3_e', 'cc_s3', 'enrolment_id'),
        ...PAID('ccs3', 's3', 'cc_s3_e', 15000),
        E('cc_s4', 's4', `select app.lesson_join({{cc_g_id}}, 'online', 15000, 'k-cc_s4')`),
        FROM('cc_s4_e', 'cc_s4', 'enrolment_id'),
        ...PAID('ccs4', 's4', 'cc_s4_e', 15000),
        E('cc_s4_leave', 's4', `select app.lesson_cancel_mine({{cc_s4_e}})`),
        PAYMENT('ccs4'),
        R(
          'ccs4_before',
          `select to_jsonb(status) from booking_payments where id = {{ccs4_pay}}::uuid`,
        ),
        E('cc_cancel', 'g1', `select app.coach_cancel_lesson({{cc_g_id}}, 'coach_unavailable')`),
        R(
          'cc_payments',
          `select jsonb_object_agg(k, jsonb_build_object('status', status, 'reason', refund_reason,
                                                       'amount', refund_amount_iqd))
           from (values ('s3', {{ccs3_pay}}::uuid), ('s4', {{ccs4_pay}}::uuid)) x(k, id)
           join booking_payments bp on bp.id = x.id`,
        ),

        // (c) After session 2: a coach's course cancel and a retirement, sessions 3-4 refunded.
        ...course('kc', 'c1', 4),
        E(
          'kc_join',
          's5',
          `select app.course_join({{kc_id}}, 'online', ${COURSE_PRICE}, 'k-kc_join')`,
        ),
        FROM('kc_e', 'kc_join', 'enrolment_id'),
        ...PAID('kc', 's5', 'kc_e', COURSE_PRICE),
        ...course('kr', 'c2', 9),
        E(
          'kr_join',
          's6',
          `select app.course_join({{kr_id}}, 'online', ${COURSE_PRICE}, 'k-kr_join')`,
        ),
        FROM('kr_e', 'kr_join', 'enrolment_id'),
        ...PAID('kr', 's6', 'kr_e', COURSE_PRICE),
        AFTER_SESSION_2('kc_id'),
        AFTER_SESSION_2('kr_id'),
        E('kc_cancel', 'g1', `select app.coach_cancel_course({{kc_id}}, 'coach_unavailable')`),
        E(
          'kr_retire',
          'manager',
          `select app.set_coach_status({{c2}}, 'retired', 'left the club')`,
        ),
        PAYMENT('kc'),
        PAYMENT('kr'),
      ]);
    });

    it('the places were paid online', () => {
      for (const p of ['ufg', 'ufk', 'ccs3', 'ccs4', 'kc', 'kr'])
        expect(data<Json>(r, `${p}_bank`), p).toMatchObject({ matched: true, status: 'succeeded' });
    });

    it('the sweep cancels the under-filled group and course and starts their refunds', () => {
      const sweep = data<Record<string, number>>(r, 'sweep');
      expect(sweep.under_filled).toBeGreaterThanOrEqual(1);
      expect(sweep.courses_under_filled).toBeGreaterThanOrEqual(1);
      // The cancel inside the sweep starts each refund itself; refunds_started counts only the
      // DB-40 backstop (db.md §4.9 phase 3), which runs table-wide, so it is not read here.
      expect(data(r, 'ufg_payment')).toEqual({
        status: 'refund_pending',
        reason: 'under_filled',
        amount: 15000,
      });
      expect(data(r, 'ufk_payment')).toEqual({
        status: 'refund_pending',
        reason: 'under_filled',
        amount: COURSE_PRICE,
      });
      expect(data(r, 'uf_g_after')).toMatchObject({
        status: 'cancelled',
        cancel_kind: 'under_filled',
      });
      // db.md §3.3: a course place ends course_cancelled; the course's cancel_reason says why.
      expect(data(r, 'uf_k_after')).toMatchObject({
        status: 'cancelled',
        cancel_kind: 'course_cancelled',
      });
    });

    it("a coach's cancel refunds the booked place and the one a guest left late and paid for", () => {
      expect(data<Json>(r, 'cc_s4_leave')).toMatchObject({ cancel_kind: 'guest_late' });
      // Left late: the money is kept until the coach cancels.
      expect(data(r, 'ccs4_before')).toBe('succeeded');
      data(r, 'cc_cancel');
      expect(data(r, 'cc_payments')).toEqual({
        s3: { status: 'refund_pending', reason: 'coach_cancel', amount: 15000 },
        s4: { status: 'refund_pending', reason: 'coach_cancel', amount: 15000 },
      });
    });

    it('a course cancelled by its coach, or by a retirement, after session 2 refunds sessions 3 and 4', () => {
      const rest = allocateCourseMoney(COURSE_PRICE, 4)
        .slice(2)
        .reduce((a, b) => a + b, 0);
      data(r, 'kc_cancel');
      data(r, 'kr_retire');
      expect(data(r, 'kc_payment')).toEqual({
        status: 'refund_pending',
        reason: 'coach_cancel',
        amount: rest,
      });
      expect(data(r, 'kr_payment')).toEqual({
        status: 'refund_pending',
        reason: 'coach_cancel',
        amount: rest,
      });
    });
  },
);

// ── TG-10 ────────────────────────────────────────────────────────────────

describe.skipIf(!docker)('cancelled while the bank was thinking (TG-10, rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('ctg10', [
      ...FIXTURES,
      // The guest's own cancel of a held private lesson.
      E(
        'm',
        's1',
        `select app.lesson_book_private({{c1}}, {{lt_p}}, ${at(2)}, 1, '{}'::text[], 'online', 30000, 'k-m')`,
      ),
      FROM('m_l', 'm', 'lesson_id'),
      FROM('m_e', 'm', 'enrolment_id'),
      ...BEGIN('m', 's1', 'm_e'),
      E('m_cancel', 's1', `select app.lesson_cancel_mine({{m_e}})`),
      SUCCESS('m', 30000),
      PAYMENT('m'),
      ENROL('m_after', 'm_e'),
      LESSON_STATUS('m_lesson', 'm_l'),
      LIVE_COURT('m_court', 'm_l'),
      // The desk cancels the held lesson.
      E(
        'd',
        's2',
        `select app.lesson_book_private({{c2}}, {{lt_p}}, ${at(2)}, 1, '{}'::text[], 'online', 30000, 'k-d')`,
      ),
      FROM('d_l', 'd', 'lesson_id'),
      FROM('d_e', 'd', 'enrolment_id'),
      ...BEGIN('d', 's2', 'd_e'),
      E('d_cancel', 'desk', `select app.desk_cancel_lesson({{d_l}}, 'staff_error')`),
      SUCCESS('d', 30000),
      PAYMENT('d'),
      ENROL('d_after', 'd_e'),
      LESSON_STATUS('d_lesson', 'd_l'),
      LIVE_COURT('d_court', 'd_l'),
      // A group place, given up by its guest.
      E('grp', 'desk', `select app.desk_create_group({{c1}}, {{lt_g}}, ${at(3)}, 'k-grp')`),
      FROM('grp_l', 'grp', 'lesson_id'),
      E('g', 's3', `select app.lesson_join({{grp_l}}, 'online', 15000, 'k-g')`),
      FROM('g_e', 'g', 'enrolment_id'),
      ...BEGIN('g', 's3', 'g_e'),
      E('g_cancel', 's3', `select app.lesson_cancel_mine({{g_e}})`),
      SUCCESS('g', 15000),
      PAYMENT('g'),
      ENROL('g_after', 'g_e'),
      LESSON_STATUS('g_lesson', 'grp_l'),
    ]);
  });

  it('each place was held and its attempt began before the cancel', () => {
    for (const p of ['m', 'd', 'g']) {
      expect(data<Json>(r, p), p).toMatchObject({ status: 'held' });
      expect(data<Json>(r, `${p}_begin`), p).toMatchObject({ purpose: 'lesson', reused: false });
    }
    for (const p of ['m_cancel', 'd_cancel', 'g_cancel']) data(r, p);
  });

  it('the late SUCCESS is refunded whole as slot_lost; the place stays cancelled, unpaid, with no court', () => {
    expect(data(r, 'm_payment')).toEqual({
      status: 'refund_pending',
      reason: 'slot_lost',
      amount: 30000,
    });
    expect(data(r, 'd_payment')).toEqual({
      status: 'refund_pending',
      reason: 'slot_lost',
      amount: 30000,
    });
    expect(data(r, 'g_payment')).toEqual({
      status: 'refund_pending',
      reason: 'slot_lost',
      amount: 15000,
    });
    for (const p of ['m', 'd', 'g'])
      expect(data<Json>(r, `${p}_after`), p).toMatchObject({
        status: 'cancelled',
        paid_online: false,
      });
    expect(data(r, 'm_lesson')).toBe('cancelled');
    expect(data(r, 'd_lesson')).toBe('cancelled');
    expect(data(r, 'm_court')).toBe(0);
    expect(data(r, 'd_court')).toBe(0);
    // A group session lives on without the place.
    expect(data(r, 'g_lesson')).toBe('scheduled');
  });
});
