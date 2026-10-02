/**
 * 0281 lesson_money (docs/design/coaching/money.md §5, §10; build contracts
 * §1.5, §1.7, §1.8, C-6, C-15, C-23, C-31, CM-1…CM-5, CM-15, R27, R28, R36,
 * R44, R62, R71, R75).
 *
 *   1. Desk money (CM-1, §5.10): lesson_settle takes one fresh kind 'lesson' tab
 *      per payment, settled in the same call (D1): every refusal in order, the
 *      replay, the tab and its one payment, nothing in café money; the
 *      LESSON_NOT_PAYABLE details; the no-goods wall (D2: an order, an
 *      adjustment and a moved order refused on a lesson tab, open_tab p_kind
 *      lesson refused); compute_tab_totals' lesson line.
 *   2. Group and course money (D3, D4, D5, R7): a no-show owes nothing and
 *      unmarking makes it payable; lesson_collected; a late course join's price
 *      and the per-session allocation; R36 on app.refund: REFUND_EXCEEDS_DUE
 *      unless lesson_goodwill, and two managers never refund the same due twice.
 *   3. Online money (R1, R3, R4, R8, R10, R28, R62, R75): a free and a late
 *      course leave (C-23, against core's courseLeaveRefund), the refund
 *      started once, a venue cancel of the kept session blocked on Qi and
 *      recorded outside the till (lesson_blocked_refund_record), the coach
 *      cancel of a group refunding a late canceller too, the rest of a course,
 *      an expired place (slot_lost), the reason derived, if_cancelled, sandbox.
 *   4. C-31 (R27, R71): a café, a shop and a lesson refund made on day 2 in a
 *      till shift count on day 2 in close_day, v_day_close_summary and
 *      day_close_shop; day 1's stored figures never move; a refund made with
 *      no shift is still dated by its payment's day, and till_shift_list's
 *      cross-day line carries only that one (TI6 holds); lesson_refunds_due
 *      shows the typed name and phone (R44).
 *   5. Parity with @touch/core: iqd_split = splitEvenly (and match_shares),
 *      lesson_coach_share = lessonCoachShare, course_late_join_price =
 *      courseLateJoinPrice, over awkward amounts.
 *
 * Every case is a rolled-back transaction with rows planted as postgres
 * (tests/coaching-plant.ts): no coaching RPC books a lesson before 0283. After
 * every money-moving step the engine's identities (money.md §10 L3) are read
 * back (assertEngine).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { splitEvenly } from '../../core/src/money/split';
import {
  courseLateJoinPrice,
  courseLeaveRefund,
  lessonCoachShare,
} from '../../core/src/coaching/statement';
import { stackAvailable } from './helpers';
import { KEEP, MK, Q, RES, T, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, data, failed } from './matches-harness';
import { MANAGER_PIN, PLANT_BRANCH as PLANT, ago, at } from './coaching-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;
type Money = {
  due_iqd: number;
  payable: boolean;
  final: boolean;
  desk_paid_iqd: number;
  desk_refunded_iqd: number;
  online_paid_iqd: number;
  online_refunded_iqd: number;
  online_refundable_iqd: number;
  refunded_outside_iqd: number;
  paid_gross_iqd: number;
  net_iqd: number;
  kept_iqd: number;
  real_kept_iqd: number;
  owed_iqd: number;
  refund_due_iqd: number;
  refund_due_online_iqd: number;
  refund_due_desk_iqd: number;
  refund_blocked_iqd: number;
  sandbox: boolean;
  status: string;
  cancel_kind: string | null;
  kind: string;
  if_cancelled: null | Record<
    'guest_free' | 'guest_late',
    { refund_iqd: number; kept_iqd: number }
  >;
  sessions: {
    lesson_id: string;
    session_no: number | null;
    start_at: string;
    status: string;
    share_iqd: number;
    counts: boolean;
    alloc_iqd: number;
  }[];
};

const BASE = [
  SETUP,
  PLANT,
  'select pg_temp.branch();',
  'select pg_temp.staff();',
  'select pg_temp.coaching();',
];
const NIL = '00000000-0000-4000-8000-000000000278';

/** A fresh manager-PIN grant for `who`, without the PIN round trip (matches-money.test.ts). */
const GRANT = (who: string) =>
  X(`insert into app.pin_grants (caller_id, authorizer_id) values ({{${who}}}, {{manager}})`);

/** lesson_settle as SQL. */
const SETTLE = (
  e: string,
  method: string,
  owed: number,
  tendered: number | null,
  key: string | null,
) =>
  `select app.lesson_settle({{${e}}}, '${method}', ${owed}, ${tendered ?? 'null'}, ${key === null ? 'null' : `'${key}'`}, null)`;

/** app.refund as SQL (manager PIN, the grant minted beforehand). */
const REFUND = (
  pay: string,
  amount: number,
  reason: string,
  key: string,
  device: string | null = null,
) =>
  `select app.refund({{${pay}}}, ${amount}, '${MANAGER_PIN}', '${reason}', null, ${device ? `{{${device}}}` : 'null'}, '${key}')`;

/** money.md §10 L3: the engine's identities. */
function assertEngine(m: Money, label = '') {
  expect(m.kept_iqd + m.refund_due_iqd, `${label} kept + refund_due = net`).toBe(m.net_iqd);
  expect(
    m.refund_due_online_iqd + m.refund_due_desk_iqd + m.refund_blocked_iqd,
    `${label} refund split`,
  ).toBe(m.refund_due_iqd);
  expect(m.kept_iqd, `${label} kept ≤ due`).toBeLessThanOrEqual(m.due_iqd);
  expect(m.owed_iqd, `${label} owed ≤ due`).toBeLessThanOrEqual(m.due_iqd);
  expect(m.real_kept_iqd, `${label} real ≤ kept`).toBeLessThanOrEqual(Math.max(m.kept_iqd, 0));
  expect(
    m.sessions.reduce((a, s) => a + s.alloc_iqd, 0),
    `${label} Σ alloc = real_kept`,
  ).toBe(m.real_kept_iqd);
  expect(m.paid_gross_iqd, `${label} gross`).toBe(m.desk_paid_iqd + m.online_paid_iqd);
}
const money = (r: Results, label: string) => {
  const m = data<Money>(r, label);
  assertEngine(m, label);
  return m;
};

// ── 1. desk money, the wall ──────────────────────────────────────────────────

describe.skipIf(!docker)('0281 lesson_settle and the lesson tab (rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('c278d', [
      ...BASE,
      GUEST('g1'),
      X(`select pg_temp.day('day')`),
      X(`select pg_temp.lesson('l1', 'lt_private', 'c1', ${at(3)})`),
      X(`select pg_temp.enrol('e1', 'l1', '{"name": "Sara Walk-in", "phone": "+9647701234567"}')`),
      Q('m_before', `select pg_temp.money('e1')`),

      // Refusals, in order.
      MK('shop1', 'shop_staff'),
      T('settle_shop', 'shop1', SETTLE('e1', 'cash', 40000, 50000, 'k-shop')),
      T('settle_prep', 'prep', SETTLE('e1', 'cash', 40000, 50000, 'k-prep')),
      T('settle_nokey', 'cashier', SETTLE('e1', 'cash', 40000, 50000, null)),
      T('settle_zero', 'cashier', SETTLE('e1', 'cash', 0, 50000, 'k-zero')),
      T(
        'settle_nil',
        'cashier',
        `select app.lesson_settle('${NIL}', 'cash', 40000, 50000, 'k-nil', null)`,
      ),
      MK('ocash', 'cashier'),
      X(`delete from staff_venues where staff_id = {{ocash}}`),
      X(
        `insert into staff_venues (staff_id, venue_id, role) values ({{ocash}}, {{venue}}, 'cashier')`,
      ),
      T('settle_outsider', 'ocash', SETTLE('e1', 'cash', 40000, 50000, 'k-out')),
      T('settle_drift', 'cashier', SETTLE('e1', 'cash', 39000, 50000, 'k-drift')),
      T('settle_short', 'cashier', SETTLE('e1', 'cash', 40000, 30000, 'k-short')),
      T('settle_card', 'cashier', SETTLE('e1', 'card', 40000, 40000, 'k-card')),

      // Paid: cash 50,000 for 40,000.
      T('settle', 'cashier', SETTLE('e1', 'cash', 40000, 50000, 'k-e1')),
      RES('e1_tab', 'settle', 'tab_id'),
      RES('e1_pay', 'settle', 'payment_id'),
      Q(
        'e1_tab_row',
        `select jsonb_build_object(
          'kind', t.kind, 'status', t.status, 'label', t.label, 'lesson_iqd', t.lesson_iqd, 'total_iqd', t.total_iqd,
          'court_iqd', t.court_iqd, 'subtotal_iqd', t.subtotal_iqd, 'reservation_id', t.reservation_id,
          'table_id', t.table_id, 'court_cap_iqd', t.court_cap_iqd, 'day', t.day_session_id = {{day}},
          'payments', (select jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount_iqd, 'change', p.change_iqd))
                         from payments p where p.tab_id = t.id))
          from tabs t where t.id = {{e1_tab}}`,
      ),
      T('settle_replay', 'cashier', SETTLE('e1', 'cash', 40000, 50000, 'k-e1')),
      T('settle_other', 'desk', SETTLE('e1', 'cash', 40000, 50000, 'k-e1')),
      T('settle_again', 'cashier', SETTLE('e1', 'cash', 40000, 50000, 'k-e1-b')),
      Q('m_after', `select pg_temp.money('e1')`),
      Q(
        'e1_trail',
        `select jsonb_build_object(
          'events', (select jsonb_agg(x.type || ':' || x.actor order by x.id) from lesson_events x where x.enrolment_id = {{e1}}),
          'audit', (select count(*) from audit_log a where a.action = 'lesson.settle' and a.entity_id = {{e1}}::text))`,
      ),

      // LESSON_NOT_PAYABLE, each detail.
      X(`select pg_temp.lesson('l2', 'lt_private', 'c2', ${at(3, 3)}, '{"status": "held"}')`),
      X(`select pg_temp.enrol('e2', 'l2', '{"guest": "g1", "mode": "online", "status": "held"}')`),
      T('np_held', 'cashier', SETTLE('e2', 'cash', 40000, 40000, 'k-np-held')),
      X(`select pg_temp.lesson('l3', 'lt_private', 'c1', ${at(4)})`),
      X(`select pg_temp.enrol('e3', 'l3', '{"status": "cancelled", "cancel_kind": "staff"}')`),
      T('np_cancelled', 'cashier', SETTLE('e3', 'cash', 40000, 40000, 'k-np-cancelled')),
      X(`select pg_temp.lesson('l4', 'lt_private', 'c1', ${at(5)}, '{"status": "cancelled"}')`),
      X(`select pg_temp.enrol('e4', 'l4')`),
      T('np_lesson_cancelled', 'cashier', SETTLE('e4', 'cash', 40000, 40000, 'k-np-lc')),
      X(`select pg_temp.lesson('l5', 'lt_private', 'c2', ${ago(3)})`),
      X(`select pg_temp.enrol('e5', 'l5')`),
      X(`select pg_temp.mark('l5', 'e5', 'no_show')`),
      T('np_no_show', 'cashier', SETTLE('e5', 'cash', 40000, 40000, 'k-np-ns')),

      // The wall: a live lesson tab (planted) takes no goods and no adjustment.
      X(`select pg_temp.lesson('l6', 'lt_private', 'c1', ${at(6)})`),
      X(`select pg_temp.enrol('e6', 'l6')`),
      K(
        'e6_tab',
        `insert into tabs (venue_id, day_session_id, label, kind, lesson_enrolment_id)
                   values ({{v}}, {{day}}, 'Lesson', 'lesson', {{e6}}) returning id`,
      ),
      Q('e6_totals', `select to_jsonb(t) from app.compute_tab_totals({{e6_tab}}) t`),
      E(
        'wall_order',
        null,
        `insert into orders (tab_id, source, venue_id) values ({{e6_tab}}, 'till', {{v}}) returning to_jsonb(id)`,
      ),
      E(
        'wall_adjustment',
        null,
        `insert into tab_adjustments (tab_id, kind, value, amount_iqd, applied_by, authorized_by, reason_code)
                                  values ({{e6_tab}}, 'discount_amount', 1000, 1000, {{manager}}, {{manager}}, 'fixture')
                                  returning to_jsonb(id)`,
      ),
      K(
        'donor',
        `insert into tabs (venue_id, day_session_id, label, kind) values ({{v}}, {{day}}, 'C278 donor', 'cafe')
                  returning id`,
      ),
      K(
        'donor_order',
        `insert into orders (tab_id, source, venue_id) values ({{donor}}, 'till', {{v}}) returning id`,
      ),
      E(
        'wall_move',
        null,
        `update orders set tab_id = {{e6_tab}} where id = {{donor_order}} returning to_jsonb(id)`,
      ),
      Q('donor_totals', `select to_jsonb(t) from app.compute_tab_totals({{donor}}) t`),
      T(
        'open_lesson_kind',
        'cashier',
        `select app.open_tab(null, 'Lesson', null, null, null, 'lesson')`,
      ),
      T('settle_tab_open', 'cashier', SETTLE('e6', 'cash', 40000, 40000, 'k-e6')),

      // Café money never counts a lesson tab.
      K(
        'cafe_tab',
        `insert into tabs (venue_id, day_session_id, label, kind, status, subtotal_iqd, discount_iqd, tax_iqd,
                                       court_iqd, total_iqd, settled_at)
                     values ({{v}}, {{day}}, 'C278 cafe', 'cafe', 'settled', 5000, 0, 0, 0, 5000, now()) returning id`,
      ),
      E(
        'cafe_rows',
        null,
        `select jsonb_build_object(
          'lesson', (select count(*) from app.cafe_settled_tabs(null, null) c where c.tab_id = {{e1_tab}}),
          'cafe', (select count(*) from app.cafe_settled_tabs(null, null) c where c.tab_id = {{cafe_tab}}))`,
      ),
    ]);
  });

  it('the engine before payment: owed is the price, payable, not final', () => {
    const m = money(r, 'm_before');
    expect(m).toMatchObject({
      kind: 'private',
      status: 'booked',
      due_iqd: 40000,
      owed_iqd: 40000,
      payable: true,
      final: false,
      paid_gross_iqd: 0,
      kept_iqd: 0,
      refund_due_iqd: 0,
    });
    expect(m.if_cancelled).toEqual({
      guest_free: expect.objectContaining({ refund_iqd: 0, kept_iqd: 0 }),
      guest_late: expect.objectContaining({ refund_iqd: 0, kept_iqd: 0 }),
    });
  });

  it("refusals in order: FORBIDDEN, INVALID_ARGUMENT, ENROLMENT_NOT_FOUND, LESSON_OWED_CHANGED, the till's tender rules", () => {
    expect(failed(r, 'settle_shop').code).toBe('FORBIDDEN');
    expect(failed(r, 'settle_prep').code).toBe('FORBIDDEN');
    expect(failed(r, 'settle_nokey')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_idempotency_key',
    });
    expect(failed(r, 'settle_zero')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_expected_owed_iqd',
    });
    expect(failed(r, 'settle_nil').code).toBe('ENROLMENT_NOT_FOUND');
    expect(failed(r, 'settle_outsider').code).toBe('ENROLMENT_NOT_FOUND');
    expect(failed(r, 'settle_drift')).toMatchObject({
      code: 'LESSON_OWED_CHANGED',
      detail: 'expected 39000, now 40000',
    });
    expect(failed(r, 'settle_short').code).toBe('TENDER_SHORT');
    expect(failed(r, 'settle_card').code).toBe('TENDER_CARD');
  });

  it('D1: one kind lesson tab, settled, lesson_iqd = total = 40,000, one cash payment with the change', () => {
    expect(data<Json>(r, 'settle')).toMatchObject({
      duplicate: false,
      amount_iqd: 40000,
      change_iqd: 10000,
      method: 'cash',
      owed_iqd: 0,
      status: 'settled',
    });
    expect(data<Json>(r, 'e1_tab_row')).toEqual({
      kind: 'lesson',
      status: 'settled',
      label: 'Lesson',
      lesson_iqd: 40000,
      total_iqd: 40000,
      court_iqd: 0,
      subtotal_iqd: 0,
      reservation_id: null,
      table_id: null,
      court_cap_iqd: null,
      day: true,
      payments: [{ method: 'cash', amount: 40000, change: 10000 }],
    });
    const m = money(r, 'm_after');
    expect(m).toMatchObject({
      desk_paid_iqd: 40000,
      owed_iqd: 0,
      kept_iqd: 40000,
      real_kept_iqd: 40000,
      due_iqd: 40000,
    });
    expect(data(r, 'e1_trail')).toEqual({ events: ['settled:staff'], audit: 1 });
  });

  it("the replay answers duplicate; another caller's key is IDEMPOTENCY_CONFLICT; a new key finds nothing owed", () => {
    const first = data<Json>(r, 'settle');
    expect(data<Json>(r, 'settle_replay')).toMatchObject({
      duplicate: true,
      payment_id: first.payment_id,
    });
    expect(failed(r, 'settle_other').code).toBe('IDEMPOTENCY_CONFLICT');
    expect(failed(r, 'settle_again')).toMatchObject({
      code: 'LESSON_NOT_PAYABLE',
      detail: 'nothing_owed',
    });
  });

  it('LESSON_NOT_PAYABLE: held, cancelled, lesson_cancelled, no_show', () => {
    expect(failed(r, 'np_held')).toMatchObject({ code: 'LESSON_NOT_PAYABLE', detail: 'held' });
    expect(failed(r, 'np_cancelled')).toMatchObject({
      code: 'LESSON_NOT_PAYABLE',
      detail: 'cancelled',
    });
    expect(failed(r, 'np_lesson_cancelled')).toMatchObject({
      code: 'LESSON_NOT_PAYABLE',
      detail: 'lesson_cancelled',
    });
    expect(failed(r, 'np_no_show')).toMatchObject({
      code: 'LESSON_NOT_PAYABLE',
      detail: 'no_show',
    });
  });

  it('D2 the wall: an order, an adjustment and a moved order are refused on a lesson tab; open_tab never makes one', () => {
    for (const l of ['wall_order', 'wall_adjustment', 'wall_move']) {
      expect(failed(r, l), l).toMatchObject({ code: 'LESSON_TAB_NO_GOODS' });
    }
    expect(failed(r, 'open_lesson_kind')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_kind',
    });
    expect(failed(r, 'settle_tab_open')).toMatchObject({
      code: 'LESSON_OWED_CHANGED',
      detail: 'tab_open',
    });
  });

  it('compute_tab_totals: the lesson line on a lesson tab (outside subtotal and tax), 0 on every other tab', () => {
    expect(data<Json>(r, 'e6_totals')).toEqual({
      subtotal_iqd: 0,
      discount_iqd: 0,
      tax_iqd: 0,
      court_iqd: 0,
      total_iqd: 40000,
      lesson_iqd: 40000,
    });
    expect(data<Json>(r, 'donor_totals')).toMatchObject({
      lesson_iqd: 0,
      court_iqd: 0,
      total_iqd: 0,
    });
  });

  it('L5: cafe_settled_tabs leaves a lesson tab out and keeps a café tab', () => {
    expect(data(r, 'cafe_rows')).toEqual({ lesson: 0, cafe: 1 });
  });
});

// ── 2. group and course money, R36 ───────────────────────────────────────────

describe.skipIf(!docker)(
  '0281 group and course money, desk refunds of lesson money (rolled back)',
  () => {
    let r: Results;
    const D = (d: number) => `(date_trunc('hour', now()) + interval '${d} days')`;

    beforeAll(() => {
      r = scenario('c278g', [
        ...BASE,
        X(`select pg_temp.day('day')`),

        // D3: a group that started two hours ago, four places of 15,000.
        X(`select pg_temp.lesson('grp', 'lt_group', 'c1', ${ago(2)})`),
        ...['ga', 'gb', 'gx', 'gd'].map((n) => X(`select pg_temp.enrol('${n}', 'grp')`)),
        ...['ga', 'gb', 'gx'].map((n) =>
          T(`settle_${n}`, 'cashier', SETTLE(n, 'cash', 15000, 15000, `k-${n}`)),
        ),
        X(`select pg_temp.mark('grp', 'gd', 'no_show')`),
        Q('gd_no_show', `select pg_temp.money('gd')`),
        T('gd_settle', 'cashier', SETTLE('gd', 'cash', 15000, 15000, 'k-gd')),
        Q(
          'grp_collected',
          `select jsonb_build_object('collected', app.lesson_collected({{grp}}),
                                                  'coach', app.lesson_coach_share(app.lesson_collected({{grp}}), 10000, 6000))`,
        ),
        X(`delete from lesson_attendance where lesson_id = {{grp}} and enrolment_id = {{gd}}`),
        Q('gd_unmarked', `select pg_temp.money('gd')`),

        // D4: a course of four weekly sessions; a full member and a late joiner from session 3.
        X(`select pg_temp.course('k', 'lt_course', array[${D(2)}, ${D(9)}, ${D(16)}, ${D(23)}])`),
        X(`select pg_temp.enrol('kf', 'k')`),
        X(`select pg_temp.enrol('kj', 'k', '{"first": 3}')`),
        Q(
          'kj_row',
          `select jsonb_build_object('price', price_iqd, 'first', first_session_no, 'covered', sessions_covered)
                     from lesson_enrolments where id = {{kj}}`,
        ),
        T('settle_kf', 'cashier', SETTLE('kf', 'cash', 100001, 100001, 'k-kf')),
        RES('kf_pay', 'settle_kf', 'payment_id'),
        T('settle_kj', 'cashier', SETTLE('kj', 'card', 50000, null, 'k-kj')),
        Q('kf_paid', `select pg_temp.money('kf')`),
        Q(
          'collected',
          `select jsonb_build_object('s1', app.lesson_collected({{k_s1}}), 's3', app.lesson_collected({{k_s3}}))`,
        ),

        // D5: nothing is due back, so a lesson_refund is refused; lesson_goodwill gives it anyway.
        GRANT('manager'),
        T('gw_due', 'manager', REFUND('kf_pay', 10001, 'lesson_refund', 'k-gw-1')),
        T('gw', 'manager', REFUND('kf_pay', 10001, 'lesson_goodwill', 'k-gw-2')),
        Q('kf_goodwill', `select pg_temp.money('kf')`),

        // R7: the rest of a desk-paid course cancelled after session 2; two managers, one due.
        X(`select pg_temp.course('k2', 'lt_course',
           array[${D(-14)} + interval '1 hour', ${D(-7)} + interval '1 hour', ${D(7)} + interval '1 hour',
                 ${D(14)} + interval '1 hour'], '{"status": "running"}')`),
        X(`select pg_temp.enrol('ky', 'k2')`),
        T('settle_ky', 'cashier', SETTLE('ky', 'cash', 100001, 100001, 'k-ky')),
        RES('ky_pay', 'settle_ky', 'payment_id'),
        X(`select pg_temp.cancel_lesson('k2_s3', 'staff_cancel')`),
        X(`select pg_temp.cancel_lesson('k2_s4', 'staff_cancel')`),
        X(
          `update courses set status = 'cancelled', cancel_reason = 'staff_cancel', cancelled_at = now() where id = {{k2}}`,
        ),
        X(`select pg_temp.cancel_enrol('ky', 'course_cancelled')`),
        Q('ky_due', `select pg_temp.money('ky')`),
        MK('mgr2', 'manager'),
        X(
          `insert into staff_venues (staff_id, venue_id, role) values ({{mgr2}}, {{v}}, 'manager') on conflict do nothing`,
        ),
        GRANT('manager'),
        GRANT('mgr2'),
        T('ky_refund_a', 'manager', REFUND('ky_pay', 50000, 'lesson_refund', 'k-ky-a')),
        T('ky_refund_b', 'mgr2', REFUND('ky_pay', 50000, 'lesson_refund', 'k-ky-b')),
        Q('ky_after', `select pg_temp.money('ky')`),
        Q('ky_refunds', `select count(*) from refunds where payment_id = {{ky_pay}}`),
      ]);
    });

    it('D3: a no-show owes nothing (LESSON_NOT_PAYABLE no_show); unmarking makes 15,000 owed again', () => {
      expect(money(r, 'gd_no_show')).toMatchObject({
        owed_iqd: 0,
        payable: false,
        due_iqd: 15000,
        kept_iqd: 0,
      });
      expect(failed(r, 'gd_settle')).toMatchObject({
        code: 'LESSON_NOT_PAYABLE',
        detail: 'no_show',
      });
      expect(money(r, 'gd_unmarked')).toMatchObject({ owed_iqd: 15000, payable: true });
    });

    it('D3: the group collected 45,000; the coach earns floor(6000 × (45,000 − 10,000) / 10000)', () => {
      expect(data(r, 'grp_collected')).toEqual({
        collected: 45000,
        coach: lessonCoachShare(45000, 10000, 6000),
      });
      expect(lessonCoachShare(45000, 10000, 6000)).toBe(21000);
    });

    it('D4: the late join is course_late_join_price(100001, 4, 3); shares and allocation per session', () => {
      expect(data(r, 'kj_row')).toEqual({
        price: courseLateJoinPrice(100001, 4, 3),
        first: 3,
        covered: 2,
      });
      expect(courseLateJoinPrice(100001, 4, 3)).toBe(50000);
      const m = money(r, 'kf_paid');
      expect(m.sessions.map((s) => s.share_iqd)).toEqual(splitEvenly(100001, 4));
      expect(m.sessions.map((s) => s.alloc_iqd)).toEqual([25001, 25000, 25000, 25000]);
      expect(data(r, 'collected')).toEqual({ s1: 25001, s3: 50000 });
    });

    it('D5 (R36): REFUND_EXCEEDS_DUE (due 0) for lesson_refund; lesson_goodwill refunds; owed stays 0 (gross, CM-2)', () => {
      expect(failed(r, 'gw_due')).toMatchObject({ code: 'REFUND_EXCEEDS_DUE', detail: 'due 0' });
      expect(data<Json>(r, 'gw').amount_iqd).toBe(10001);
      const m = money(r, 'kf_goodwill');
      expect(m).toMatchObject({ net_iqd: 90000, kept_iqd: 90000, owed_iqd: 0, refund_due_iqd: 0 });
      expect(m.sessions.map((s) => s.alloc_iqd)).toEqual([22500, 22500, 22500, 22500]);
    });

    it('R7: 50,000 due back after the rest of the course; the first manager refunds it, the second is refused', () => {
      expect(money(r, 'ky_due')).toMatchObject({
        due_iqd: 50001,
        refund_due_desk_iqd: 50000,
        refund_due_online_iqd: 0,
      });
      expect(data<Json>(r, 'ky_refund_a').amount_iqd).toBe(50000);
      expect(failed(r, 'ky_refund_b')).toMatchObject({
        code: 'REFUND_EXCEEDS_DUE',
        detail: 'due 0',
      });
      expect(money(r, 'ky_after')).toMatchObject({
        refund_due_iqd: 0,
        kept_iqd: 50001,
        desk_refunded_iqd: 50000,
      });
      expect(Number(data(r, 'ky_refunds'))).toBe(1);
    });
  },
);

// ── 3. online money ─────────────────────────────────────────────────────────

describe.skipIf(!docker)(
  '0281 online lesson money: lesson_refund_start, C-23, blocked refunds (R75) (rolled back)',
  () => {
    let r: Results;
    const B = (d: number, h: number) =>
      `(date_trunc('hour', now()) + interval '${d} days ${h} hours')`;

    beforeAll(() => {
      r = scenario('c278o', [
        ...BASE,
        ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'].map((g) => GUEST(g)),
        X(`select pg_temp.day('day')`),
        Q(
          'g1_profile',
          `select jsonb_build_object('full_name', full_name, 'phone', phone) from profiles where id = {{g1}}`,
        ),

        // A running course: session 1 a week ago, 2 in six hours, 3 and 4 weekly after.
        X(`select pg_temp.course('o', 'lt_course', array[${B(-7, 6)}, ${B(0, 6)}, ${B(7, 6)}, ${B(14, 6)}],
                               '{"status": "running"}')`),
        X(`select pg_temp.enrol('o1', 'o', '{"guest": "g1", "mode": "online"}')`),
        X(`select pg_temp.online('o1_pay', 'o1', 100001)`),
        X(`select pg_temp.enrol('o2', 'o', '{"guest": "g2", "mode": "online"}')`),
        X(`select pg_temp.online('o2_pay', 'o2', 100001)`),
        Q('o1_preview', `select pg_temp.money('o1')`),

        // R8: o2 leaves free: the begun session is kept, 75,000 goes back.
        X(`select pg_temp.cancel_enrol('o2', 'guest_free')`),
        E('o2_refund', null, `select to_jsonb(app.lesson_refund_start({{o2}}, null))`),
        Q(
          'o2_row',
          `select jsonb_build_object('status', status, 'reason', refund_reason, 'amount', refund_amount_iqd)
                     from booking_payments where id = {{o2_pay}}`,
        ),

        // C-23, R62: o1 leaves late, a minute ago, six hours before session 2.
        X(`select pg_temp.cancel_enrol('o1', 'guest_late', now() - interval '1 minute')`),
        Q('o1_left', `select pg_temp.money('o1')`),
        Q('o1_left_at', `select to_jsonb(cancelled_at) from lesson_enrolments where id = {{o1}}`),
        E('o1_refund', 'g1', `select to_jsonb(app.lesson_refund_start({{o1}}, null))`),
        Q(
          'o1_row',
          `select jsonb_build_object('status', status, 'reason', refund_reason, 'amount', refund_amount_iqd)
                     from booking_payments where id = {{o1_pay}}`,
        ),
        E('o1_refund_again', null, `select to_jsonb(app.lesson_refund_start({{o1}}, null))`),
        Q('o1_kept', `select pg_temp.money('o1')`),

        // The venue cancels the rest before session 2: its share has no refund left on the row.
        X(`select pg_temp.cancel_lesson('o_s2', 'staff_cancel')`),
        X(`select pg_temp.cancel_lesson('o_s3', 'staff_cancel')`),
        X(`select pg_temp.cancel_lesson('o_s4', 'staff_cancel')`),
        X(
          `update courses set status = 'cancelled', cancel_reason = 'staff_cancel', cancelled_at = now() where id = {{o}}`,
        ),
        Q('o1_blocked', `select pg_temp.money('o1')`),
        E('o1_refund_blocked', null, `select to_jsonb(app.lesson_refund_start({{o1}}, null))`),
        T('due', 'manager', `select app.lesson_refunds_due({{v}})`),

        // R75: recorded as handed back outside the till, behind a manager PIN.
        T(
          'blk_digits',
          'manager',
          `select app.lesson_blocked_refund_record({{o1}}, 25000, '4111 1111-1111 1111', '${MANAGER_PIN}', null)`,
        ),
        // Grants other suites left for the shared seed manager (committed, within the TTL) age out
        // inside this rolled-back transaction, so the call below has none to consume.
        X(
          `update app.pin_grants set created_at = now() - interval '1 day' where caller_id = {{manager}} and consumed_at is null`,
        ),
        T(
          'blk_nogrant',
          'manager',
          `select app.lesson_blocked_refund_record({{o1}}, 25000, 'ZC-1001', '${MANAGER_PIN}', null)`,
        ),
        T(
          'blk_cashier',
          'cashier',
          `select app.lesson_blocked_refund_record({{o1}}, 25000, 'ZC-1001', '${MANAGER_PIN}', null)`,
        ),
        GRANT('manager'),
        T(
          'blk_over',
          'manager',
          `select app.lesson_blocked_refund_record({{o1}}, 30000, 'ZC-1001', '${MANAGER_PIN}', null)`,
        ),
        T(
          'blk',
          'manager',
          `select app.lesson_blocked_refund_record({{o1}}, 25000, 'ZC-1001', '${MANAGER_PIN}', null)`,
        ),
        Q('o1_outside', `select pg_temp.money('o1')`),
        T('due_after', 'manager', `select app.lesson_refunds_due({{v}})`),
        Q(
          'o1_trail',
          `select jsonb_agg(x.type || ':' || coalesce(x.code, '') || ':' || x.actor order by x.id)
                       from lesson_events x where x.enrolment_id = {{o1}}`,
        ),
        Q(
          'o1_audit',
          `select jsonb_agg(a.after -> 'reference') from audit_log a
                      where a.action = 'lesson.refund_outside' and a.entity_id = {{o1}}::text`,
        ),

        // R3: the coach cancels a group: two online places, a desk place and an
        // earlier late canceller who paid online.
        X(`select pg_temp.lesson('grp', 'lt_group', 'c2', ${at(4)})`),
        X(`select pg_temp.enrol('q1', 'grp', '{"guest": "g3", "mode": "online"}')`),
        X(`select pg_temp.online('q1_pay', 'q1', 15000)`),
        X(`select pg_temp.enrol('q2', 'grp', '{"guest": "g4", "mode": "online"}')`),
        X(`select pg_temp.online('q2_pay', 'q2', 15000)`),
        X(`select pg_temp.enrol('q3', 'grp')`),
        T('settle_q3', 'cashier', SETTLE('q3', 'cash', 15000, 15000, 'k-q3')),
        X(`select pg_temp.enrol('q4', 'grp', '{"guest": "g5", "mode": "online", "status": "cancelled",
                                            "cancel_kind": "guest_late"}')`),
        X(
          `update lesson_enrolments set cancelled_at = now() - interval '1 hour' where id = {{q4}}`,
        ),
        X(`select pg_temp.online('q4_pay', 'q4', 15000)`),
        Q('q4_before', `select pg_temp.money('q4')`),
        X(`select pg_temp.cancel_lesson('grp', 'coach_cancel')`),
        ...['q1', 'q2', 'q3'].map((q) => X(`select pg_temp.cancel_enrol('${q}', 'coach')`)),
        E(
          'q_refunds',
          'gc',
          `select jsonb_build_object(
          'q1', app.lesson_refund_start({{q1}}, null), 'q2', app.lesson_refund_start({{q2}}, null),
          'q3', app.lesson_refund_start({{q3}}, null), 'q4', app.lesson_refund_start({{q4}}, null))`,
        ),
        Q(
          'q_rows',
          `select jsonb_object_agg(k, jsonb_build_object('status', bp.status, 'reason', bp.refund_reason,
                                                                  'amount', bp.refund_amount_iqd))
                     from (values ('q1', {{q1_pay}}::uuid), ('q2', {{q2_pay}}::uuid), ('q4', {{q4_pay}}::uuid)) x(k, id)
                     join booking_payments bp on bp.id = x.id`,
        ),
        Q('q3_money', `select pg_temp.money('q3')`),
        Q(
          'q_actor',
          `select jsonb_agg(distinct x.actor) from lesson_events x
                      where x.type = 'refunded' and x.enrolment_id in ({{q1}}, {{q2}}, {{q4}})`,
        ),

        // R4: the rest of an online course cancelled (the coach retired) after two of four sessions.
        X(`select pg_temp.course('k2', 'lt_course', array[${B(-14, 1)}, ${B(-7, 1)}, ${B(7, 1)}, ${B(14, 1)}],
                               '{"status": "running"}')`),
        X(`select pg_temp.enrol('r1', 'k2', '{"guest": "g6", "mode": "online"}')`),
        X(`select pg_temp.online('r1_pay', 'r1', 100001)`),
        X(`select pg_temp.cancel_lesson('k2_s3', 'coach_retired')`),
        X(`select pg_temp.cancel_lesson('k2_s4', 'coach_retired')`),
        X(
          `update courses set status = 'cancelled', cancel_reason = 'coach_retired', cancelled_at = now() where id = {{k2}}`,
        ),
        X(`select pg_temp.cancel_enrol('r1', 'course_cancelled')`),
        E('r1_refund', null, `select to_jsonb(app.lesson_refund_start({{r1}}, null))`),
        E('r1_again', null, `select to_jsonb(app.lesson_refund_start({{r1}}, null))`),
        Q(
          'r1_row',
          `select jsonb_build_object('status', status, 'reason', refund_reason, 'amount', refund_amount_iqd)
                     from booking_payments where id = {{r1_pay}}`,
        ),
        Q('r1_money', `select pg_temp.money('r1')`),

        // An expired place whose payment succeeded late: slot_lost, the whole row.
        X(`select pg_temp.lesson('lx', 'lt_private', 'c2', ${at(6)}, '{"status": "held"}')`),
        X(
          `select pg_temp.enrol('x1', 'lx', '{"guest": "g7", "mode": "online", "status": "expired"}')`,
        ),
        X(`select pg_temp.online('x1_pay', 'x1', 40000)`),
        E('x1_bad_reason', null, `select to_jsonb(app.lesson_refund_start({{x1}}, 'banana'))`),
        E('x1_refund', null, `select to_jsonb(app.lesson_refund_start({{x1}}, null))`),
        Q(
          'x1_row',
          `select jsonb_build_object('status', status, 'reason', refund_reason, 'amount', refund_amount_iqd)
                     from booking_payments where id = {{x1_pay}}`,
        ),
        Q('x1_money', `select pg_temp.money('x1')`),

        // R10: if_cancelled of a booked online private lesson; CM-15: a sandbox one counts 0.
        X(`select pg_temp.lesson('lp', 'lt_private', 'c1', ${at(5)})`),
        X(`select pg_temp.enrol('p1', 'lp', '{"guest": "g1", "mode": "online"}')`),
        X(`select pg_temp.online('p1_pay', 'p1', 40000)`),
        Q('p1_money', `select pg_temp.money('p1')`),
        X(`select pg_temp.lesson('ls', 'lt_private', 'c2', ${at(5, 3)})`),
        X(`select pg_temp.enrol('s1', 'ls', '{"guest": "g2", "mode": "online"}')`),
        X(`select pg_temp.online('s1_pay', 's1', 40000, '{"sandbox": true}')`),
        Q('s1_money', `select pg_temp.money('s1')`),
        Q('ls_collected', `select to_jsonb(app.lesson_collected({{ls}}))`),
      ]);
    });

    it('the preview of a cancel now: guest_free refunds all but the begun session, guest_late keeps the next one too', () => {
      const m = money(r, 'o1_preview');
      expect(m.sessions.map((s) => s.share_iqd)).toEqual([25001, 25000, 25000, 25000]);
      expect(m.if_cancelled).toEqual({
        guest_free: expect.objectContaining({ refund_iqd: 75000, kept_iqd: 25001 }),
        guest_late: expect.objectContaining({ refund_iqd: 50000, kept_iqd: 50001 }),
      });
    });

    it('R8: a free leave refunds 75,000 at once, guest_cancel', () => {
      expect(data(r, 'o2_refund')).toBe(1);
      expect(data(r, 'o2_row')).toEqual({
        status: 'refund_pending',
        reason: 'guest_cancel',
        amount: 75000,
      });
    });

    it('C-23, R62: a late leave keeps the begun and the next session, refunds the rest once (= core courseLeaveRefund)', () => {
      const before = money(r, 'o1_left');
      // A late leave is not final while a covered session is still to come (CM-5).
      expect(before).toMatchObject({ due_iqd: 50001, refund_due_online_iqd: 50000, final: false });
      const leftAt = new Date(data<string>(r, 'o1_left_at'));
      const twin = courseLeaveRefund(
        before.sessions.map((s) => ({
          shareIqd: s.share_iqd,
          startAt: new Date(s.start_at),
          cancelledAt: null,
        })),
        leftAt,
        12,
      );
      expect(twin).toBe(50000);
      expect(data(r, 'o1_refund')).toBe(1);
      expect(data(r, 'o1_row')).toEqual({
        status: 'refund_pending',
        reason: 'guest_cancel',
        amount: twin,
      });
      expect(data(r, 'o1_refund_again')).toBe(0);
      expect(money(r, 'o1_kept')).toMatchObject({
        due_iqd: 50001,
        kept_iqd: 50001,
        refund_due_iqd: 0,
        online_refunded_iqd: 50000,
      });
    });

    it('CM-5, R75: the venue cancels the kept session: 25,000 blocked, listed, recorded outside the till', () => {
      expect(money(r, 'o1_blocked')).toMatchObject({
        due_iqd: 25001,
        refund_blocked_iqd: 25000,
        refund_due_online_iqd: 0,
        refund_due_desk_iqd: 0,
      });
      expect(data(r, 'o1_refund_blocked')).toBe(0);
      const due = data<{ total_iqd: number; items: Json[] }>(r, 'due');
      const item = due.items.find(
        (i) => i.enrolment_id === data<Json>(r, 'o1_blocked').enrolment_id,
      )!;
      const profile = data<Json>(r, 'g1_profile');
      expect(item).toMatchObject({
        kind: 'course',
        lesson_id: null,
        online_blocked_iqd: 25000,
        refund_due_desk_iqd: 0,
        refund_due_iqd: 25000,
        cancel_kind: 'guest_late',
        label: profile.full_name,
        phone: profile.phone,
        payments: [],
      });
      expect(due.total_iqd).toBeGreaterThanOrEqual(25000);

      expect(failed(r, 'blk_digits')).toMatchObject({
        code: 'INVALID_ARGUMENT',
        detail: 'p_reference',
        hint: 'digits',
      });
      expect(failed(r, 'blk_nogrant').code).toBe('PIN_GRANT_REQUIRED');
      expect(failed(r, 'blk_cashier').code).toBe('FORBIDDEN');
      expect(failed(r, 'blk_over')).toMatchObject({
        code: 'REFUND_EXCEEDS_DUE',
        detail: 'due 25000',
      });
      expect(data<Json>(r, 'blk')).toMatchObject({
        amount_iqd: 25000,
        refunded_outside_iqd: 25000,
        online_blocked_iqd: 0,
      });
      expect(money(r, 'o1_outside')).toMatchObject({
        refund_blocked_iqd: 0,
        refunded_outside_iqd: 25000,
        net_iqd: 25001,
        kept_iqd: 25001,
      });
      const after = data<{ items: Json[] }>(r, 'due_after');
      expect(after.items.map((i) => i.enrolment_id)).not.toContain(item.enrolment_id);
      expect(data(r, 'o1_trail')).toEqual([
        'refunded:guest_cancel:guest',
        'refunded:outside:staff',
      ]);
      expect(data(r, 'o1_audit')).toEqual(['ZC-1001']);
    });

    it('R3, R28: a coach cancel refunds every online place, the earlier late canceller too, coach_cancel; desk money is due', () => {
      expect(money(r, 'q4_before')).toMatchObject({ kept_iqd: 15000, refund_due_iqd: 0 });
      expect(data(r, 'q_refunds')).toEqual({ q1: 1, q2: 1, q3: 0, q4: 1 });
      expect(data(r, 'q_rows')).toEqual({
        q1: { status: 'refund_pending', reason: 'coach_cancel', amount: 15000 },
        q2: { status: 'refund_pending', reason: 'coach_cancel', amount: 15000 },
        q4: { status: 'refund_pending', reason: 'coach_cancel', amount: 15000 },
      });
      expect(money(r, 'q3_money')).toMatchObject({
        refund_due_desk_iqd: 15000,
        refund_due_online_iqd: 0,
      });
      expect(data(r, 'q_actor')).toEqual(['coach']);
    });

    it('R4: the rest of a course (coach retired) refunds sessions 3–4 in one partial refund, coach_cancel; once', () => {
      expect(data(r, 'r1_refund')).toBe(1);
      expect(data(r, 'r1_again')).toBe(0);
      expect(data(r, 'r1_row')).toEqual({
        status: 'refund_pending',
        reason: 'coach_cancel',
        amount: 50000,
      });
      const m = money(r, 'r1_money');
      expect(m).toMatchObject({ due_iqd: 50001, kept_iqd: 50001, refund_due_iqd: 0, final: true });
      expect(m.sessions.map((s) => s.alloc_iqd)).toEqual([25001, 25000, 0, 0]);
    });

    it('an expired place paid late is refunded whole as slot_lost; p_reason outside the vocabularies is refused', () => {
      expect(failed(r, 'x1_bad_reason')).toMatchObject({
        code: 'INVALID_ARGUMENT',
        detail: 'p_reason',
      });
      expect(data(r, 'x1_refund')).toBe(1);
      expect(data(r, 'x1_row')).toEqual({
        status: 'refund_pending',
        reason: 'slot_lost',
        amount: 40000,
      });
      expect(money(r, 'x1_money')).toMatchObject({
        online_paid_iqd: 0,
        net_iqd: 0,
        kept_iqd: 0,
        refund_due_iqd: 0,
      });
    });

    it('R10: if_cancelled of a booked online private lesson; CM-15: sandbox money is kept but counts 0', () => {
      const p = money(r, 'p1_money');
      expect(p.if_cancelled).toEqual({
        guest_free: expect.objectContaining({ refund_iqd: 40000, kept_iqd: 0 }),
        guest_late: expect.objectContaining({ refund_iqd: 0, kept_iqd: 40000 }),
      });
      expect(money(r, 's1_money')).toMatchObject({
        kept_iqd: 40000,
        real_kept_iqd: 0,
        sandbox: true,
      });
      expect(data(r, 'ls_collected')).toBe(0);
    });
  },
);

// ── 4. C-31: a refund counts on the day it is made ───────────────────────────

describe.skipIf(!docker)(
  '0281 C-31: refunds on day 2 of day-1 payments (café, shop, lesson) (rolled back)',
  () => {
    let r: Results;

    beforeAll(() => {
      r = scenario('c278c', [
        ...BASE,
        X(`select pg_temp.day('day1', 1, 0)`),
        X(`select pg_temp.lesson('l1', 'lt_private', 'c1', ${at(3)})`),
        X(
          `select pg_temp.enrol('e1', 'l1', '{"name": "Rana Walk-in", "phone": "+9647709876543"}')`,
        ),
        T('settle', 'cashier', SETTLE('e1', 'cash', 40000, 40000, 'k-c31-e1')),
        RES('e1_pay', 'settle', 'payment_id'),
        GRANT('manager'),
        T('not_due', 'manager', REFUND('e1_pay', 1000, 'lesson_refund', 'k-c31-r0')),

        // Café and shop sales of day 1 (planted: the till suites cover selling).
        K(
          'cafe_tab',
          `insert into tabs (venue_id, day_session_id, label, kind, status, subtotal_iqd, discount_iqd, tax_iqd,
                                       court_iqd, total_iqd, settled_at)
                     values ({{v}}, {{day1}}, 'C278 cafe', 'cafe', 'settled', 35000, 0, 0, 0, 35000, now()) returning id`,
        ),
        K(
          'cafe_pay',
          `insert into payments (venue_id, tab_id, day_session_id, method, amount_iqd, recorded_by)
                     values ({{v}}, {{cafe_tab}}, {{day1}}, 'cash', 25000, {{cashier}}) returning id`,
        ),
        K(
          'cafe_pay2',
          `insert into payments (venue_id, tab_id, day_session_id, method, amount_iqd, recorded_by)
                      values ({{v}}, {{cafe_tab}}, {{day1}}, 'cash', 10000, {{cashier}}) returning id`,
        ),
        K(
          'shop_tab',
          `insert into tabs (venue_id, day_session_id, label, kind, status, subtotal_iqd, discount_iqd, tax_iqd,
                                       court_iqd, total_iqd, settled_at)
                     values ({{v}}, {{day1}}, 'C278 shop', 'shop', 'settled', 8000, 0, 0, 0, 8000, now()) returning id`,
        ),
        K(
          'shop_pay',
          `insert into payments (venue_id, tab_id, day_session_id, method, amount_iqd, recorded_by)
                     values ({{v}}, {{shop_tab}}, {{day1}}, 'cash', 8000, {{cashier}}) returning id`,
        ),
        T('close1', 'manager', `select app.close_day(83000, null, null, null, {{v}})`),
        Q(
          'day1_stored',
          `select jsonb_build_object('cash', cash_expected_iqd, 'card', card_expected_iqd, 'status', status)
                          from day_sessions where id = {{day1}}`,
        ),

        // Day 2: a till shift at a registered station.
        // venue_business_date is internal (no client grant): the date is read as postgres first.
        KEEP('bd2', `select app.venue_business_date({{v}}, now())::text`),
        T('open2', 'manager', `select app.open_day(100000, {{bd2}}::date, null, {{v}})`),
        RES('day2', 'open2', 'day_session_id'),
        KEEP(
          'st',
          `insert into stations (id, venue_id, is_till, mode)
                  values ('C278-' || upper(substr(md5(random()::text), 1, 12)), {{v}}, true, 'till') returning id`,
        ),
        MK('holder', 'cashier'),
        X(
          `insert into staff_venues (staff_id, venue_id, role) values ({{holder}}, {{v}}, 'cashier') on conflict do nothing`,
        ),
        KEEP(
          'shift',
          `insert into till_shifts (venue_id, day_session_id, station_id, staff_id, opening_float_iqd)
                     values ({{v}}, {{day2}}, {{st}}, {{holder}}, 100000) returning id`,
        ),

        // The lesson cancelled by the desk: 40,000 due back (R44: the typed name and phone).
        X(`select pg_temp.cancel_lesson('l1', 'staff_cancel')`),
        X(`select pg_temp.cancel_enrol('e1', 'staff')`),
        T('due', 'manager', `select app.lesson_refunds_due({{v}})`),

        // Four refunds on day 2: three in the shift, one with no device (outside a shift).
        GRANT('manager'),
        GRANT('manager'),
        GRANT('manager'),
        GRANT('manager'),
        T('r_lesson', 'manager', REFUND('e1_pay', 40000, 'lesson_refund', 'k-c31-r1', 'st')),
        T('r_cafe', 'manager', REFUND('cafe_pay', 25000, 'customer_return', 'k-c31-r2', 'st')),
        T('r_shop', 'manager', REFUND('shop_pay', 8000, 'retail_return', 'k-c31-r3', 'st')),
        T('r_outside', 'manager', REFUND('cafe_pay2', 5000, 'customer_return', 'k-c31-r4')),
        Q(
          'stamps',
          `select jsonb_object_agg(rf.reason_code || ':' || rf.amount_iqd, rf.till_shift_id = {{shift}})
                     from refunds rf
                     join payments p on p.id = rf.payment_id
                    where p.tab_id in ({{cafe_tab}}, {{shop_tab}}) or p.id = {{e1_pay}}`,
        ),
        Q(
          'summary_open',
          `select jsonb_object_agg(case when s.day_session_id = {{day1}} then 'day1' else 'day2' end,
                                                 jsonb_build_object('refunds', s.refunds_iqd, 'count', s.refund_count,
                                                                    'cash', s.cash_payments_iqd))
                           from v_day_close_summary s where s.day_session_id in ({{day1}}, {{day2}})`,
        ),
        T('shop1', 'manager', `select app.day_close_shop({{day1}})`),
        T('shop2', 'manager', `select app.day_close_shop({{day2}})`),

        // Day 2 closes on its own refunds: 100,000 − 40,000 − 25,000 − 8,000.
        T('close2', 'manager', `select app.close_day(27000, null, null, null, {{v}})`),
        Q(
          'days_after',
          `select jsonb_object_agg(case when d.id = {{day1}} then 'day1' else 'day2' end,
                                               jsonb_build_object('cash', d.cash_expected_iqd, 'variance', d.cash_variance_iqd,
                                                                  'card', d.card_expected_iqd))
                         from day_sessions d where d.id in ({{day1}}, {{day2}})`,
        ),
        Q(
          'summary_closed',
          `select jsonb_object_agg(case when s.day_session_id = {{day1}} then 'day1' else 'day2' end,
                                                   jsonb_build_object('refunds', s.refunds_iqd, 'count', s.refund_count))
                             from v_day_close_summary s where s.day_session_id in ({{day1}}, {{day2}})`,
        ),
        // One transaction has one now(): spread the two days around it so the refund made
        // with no shift is dated by the open day at its created_at (till_shift_list's rule).
        X(`update day_sessions set opened_at = now() - interval '2 days', closed_at = now() - interval '1 day'
          where id = {{day1}}`),
        X(`update day_sessions set opened_at = now() - interval '1 hour', closed_at = now() + interval '1 hour'
          where id = {{day2}}`),
        T(
          'list',
          'manager',
          `select app.till_shift_list((select business_date from day_sessions where id = {{day1}}),
                                                       (select business_date from day_sessions where id = {{day2}}),
                                                       null, null, {{v}})`,
        ),
        Q(
          'ids',
          `select jsonb_build_object('day1', {{day1}}, 'day2', {{day2}}, 'e1', {{e1}}, 'e1_pay', {{e1_pay}})`,
        ),
        Q('e1_money', `select pg_temp.money('e1')`),
      ]);
    });

    it('R36 before the cancel: nothing is due, so a lesson_refund is REFUND_EXCEEDS_DUE (due 0)', () => {
      expect(failed(r, 'not_due')).toMatchObject({ code: 'REFUND_EXCEEDS_DUE', detail: 'due 0' });
    });

    it('day 1 closes on its own takings: 83,000 expected, nothing refunded yet', () => {
      expect(data<Json>(r, 'close1')).toMatchObject({
        cash_expected_iqd: 83000,
        cash_variance_iqd: 0,
      });
    });

    it('R44: lesson_refunds_due shows the desk-typed name and phone and the payment to refund', () => {
      const ids = data<Json>(r, 'ids');
      const item = data<{ items: Json[] }>(r, 'due').items.find((i) => i.enrolment_id === ids.e1)!;
      expect(item).toMatchObject({
        label: 'Rana Walk-in',
        phone: '+9647709876543',
        refund_due_desk_iqd: 40000,
        online_blocked_iqd: 0,
        kind: 'private',
        cancel_kind: 'staff',
      });
      expect(item.payments).toEqual([
        expect.objectContaining({
          payment_id: ids.e1_pay,
          method: 'cash',
          amount_iqd: 40000,
          refunded_iqd: 0,
          refundable_iqd: 40000,
        }),
      ]);
    });

    it('the refunds made in the shift carry it; the one with no device does not', () => {
      expect(data(r, 'stamps')).toEqual({
        'lesson_refund:40000': true,
        'customer_return:25000': true,
        'retail_return:8000': true,
        'customer_return:5000': null,
      });
    });

    it("C-31 (R27): v_day_close_summary dates the shift refunds by day 2; the outside one stays on its payment's day", () => {
      expect(data(r, 'summary_open')).toEqual({
        day1: { refunds: 5000, count: 1, cash: 83000 },
        day2: { refunds: 73000, count: 3, cash: 0 },
      });
      expect(data(r, 'summary_closed')).toEqual({
        day1: { refunds: 5000, count: 1 },
        day2: { refunds: 73000, count: 3 },
      });
    });

    it('C-31 (R71): day_close_shop counts the shop refund on day 2, its sale on day 1', () => {
      expect(data<Json>(r, 'shop1')).toMatchObject({
        sales_iqd: 8000,
        refunds_iqd: 0,
        net_iqd: 8000,
      });
      expect(data<Json>(r, 'shop2')).toMatchObject({
        sales_iqd: 0,
        refunds_iqd: 8000,
        net_iqd: -8000,
      });
    });

    it("C-31 (R27): day 2 closes on its own refunds; day 1's stored figures never move", () => {
      expect(data<Json>(r, 'close2')).toMatchObject({
        cash_expected_iqd: 27000,
        cash_variance_iqd: 0,
        shifts_closed_with_day: 1,
      });
      expect(data(r, 'days_after')).toEqual({
        day1: { cash: 83000, variance: 0, card: 0 },
        day2: { cash: 27000, variance: 0, card: 0 },
      });
      expect(data(r, 'day1_stored')).toMatchObject({ cash: 83000, status: 'closed' });
      expect(money(r, 'e1_money')).toMatchObject({
        refund_due_iqd: 0,
        desk_refunded_iqd: 40000,
        kept_iqd: 0,
      });
    });

    it('till_shift_list: the cross-day line carries only the refund made with no shift; TI6 holds on both days', () => {
      const ids = data<Json>(r, 'ids');
      type Row = Record<string, number | string | null>;
      const list = data<{ shifts: Row[]; outside: Row[]; cross_day: Row[] }>(r, 'list');
      const summary = data<Record<'day1' | 'day2', { refunds: number }>>(r, 'summary_closed');
      for (const [name, id] of [
        ['day1', ids.day1],
        ['day2', ids.day2],
      ] as const) {
        const cross = list.cross_day.find((c) => c.day_session_id === id)!;
        const S = (rows: Row[], key: string) =>
          rows.filter((x) => x.day_session_id === id).reduce((a, x) => a + Number(x[key] ?? 0), 0);
        const made =
          S(list.shifts, 'cash_refunds_iqd') +
          S(list.shifts, 'card_refunds_iqd') +
          S(list.outside, 'cash_refunds_iqd') +
          S(list.outside, 'card_refunds_iqd');
        expect(made, name).toBe(
          summary[name].refunds +
            Number(cross.earlier_days_cash_refunds_iqd) +
            Number(cross.earlier_days_card_refunds_iqd) -
            Number(cross.later_cash_refunds_iqd) -
            Number(cross.later_card_refunds_iqd),
        );
      }
      const day1 = list.cross_day.find((c) => c.day_session_id === ids.day1)!;
      const day2 = list.cross_day.find((c) => c.day_session_id === ids.day2)!;
      expect(day1).toMatchObject({
        earlier_days_cash_refunds_iqd: 0,
        later_cash_refunds_iqd: 5000,
      });
      expect(day2).toMatchObject({
        earlier_days_cash_refunds_iqd: 5000,
        later_cash_refunds_iqd: 0,
      });
    });
  },
);

// ── 5. parity with @touch/core ───────────────────────────────────────────────

describe.skipIf(!docker)('0281 the arithmetic twins against @touch/core (rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('c278p', [
      SETUP,
      Q(
        'split',
        `select jsonb_agg(jsonb_build_array(t, n, to_jsonb(app.iqd_split(t, n))))
                    from generate_series(1, 52) n
                    cross join lateral unnest(array[0, 1, n - 1, n, n + 1, 99999, 100001]::bigint[]) t`,
      ),
      Q(
        'shares4',
        `select jsonb_agg(jsonb_build_array(p, to_jsonb(app.match_shares(p)), to_jsonb(app.iqd_split(p, 4))))
                      from unnest(array[0, 1, 3, 40000, 40001, 99999]::bigint[]) p`,
      ),
      Q(
        'share',
        `select jsonb_agg(jsonb_build_array(c, s, bp, app.lesson_coach_share(c, s, bp)))
                    from unnest(array[0, 1, 9999, 10000, 10001, 17001, 40000, 45000, 100001]::bigint[]) c
                    cross join unnest(array[0, 8000, 10000]::bigint[]) s
                    cross join unnest(array[0, 1, 5999, 6000, 10000]) bp`,
      ),
      Q(
        'late',
        `select jsonb_agg(jsonb_build_array(p, n, f, app.course_late_join_price(p, n, f)))
                   from unnest(array[4, 99999, 100001, 160000]::bigint[]) p
                   cross join unnest(array[2, 4, 7, 8, 52]) n
                   cross join lateral generate_series(1, n + 1) f
                  where p >= n`,
      ),
      E('split_neg', null, `select to_jsonb(app.iqd_split(-1, 2))`),
      E('split_zero', null, `select to_jsonb(app.iqd_split(5, 0))`),
      E('share_bp', null, `select to_jsonb(app.lesson_coach_share(1, 0, 10001))`),
      E('share_neg', null, `select to_jsonb(app.lesson_coach_share(-1, 0, 6000))`),
      E('late_zero', null, `select to_jsonb(app.course_late_join_price(100, 4, 0))`),
      Q(
        'nulls',
        `select jsonb_build_object('split', app.iqd_split(null, 2) is null,
                                            'share', app.lesson_coach_share(null, 0, 1) is null,
                                            'late', app.course_late_join_price(100, null, 1) is null)`,
      ),
    ]);
  });

  it('L1: iqd_split = splitEvenly for every awkward amount and n in 1..52; match_shares(p) = iqd_split(p, 4)', () => {
    const rows = data<[number, number, number[]][]>(r, 'split');
    expect(rows.length).toBe(52 * 7);
    for (const [t, n, got] of rows) expect(got, `${t}/${n}`).toEqual(splitEvenly(t, n));
    for (const [p, shares, split] of data<[number, number[], number[]][]>(r, 'shares4')) {
      expect(shares, String(p)).toEqual(split);
    }
  });

  it('lesson_coach_share = lessonCoachShare; course_late_join_price = courseLateJoinPrice', () => {
    for (const [c, s, bp, got] of data<[number, number, number, number][]>(r, 'share')) {
      expect(got, `${c}/${s}/${bp}`).toBe(lessonCoachShare(c, s, bp));
    }
    for (const [p, n, f, got] of data<[number, number, number, number][]>(r, 'late')) {
      expect(got, `${p}/${n}/${f}`).toBe(courseLateJoinPrice(p, n, f));
    }
  });

  it('refusals and NULLs: INVALID_ARGUMENT with the argument as detail; NULL in, NULL out', () => {
    expect(failed(r, 'split_neg')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_total' });
    expect(failed(r, 'split_zero')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_n' });
    expect(failed(r, 'share_bp')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_share_bp' });
    expect(failed(r, 'share_neg')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_collected',
    });
    expect(failed(r, 'late_zero')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_first_session_no',
    });
    expect(data(r, 'nulls')).toEqual({ split: true, share: true, late: true });
  });
});
