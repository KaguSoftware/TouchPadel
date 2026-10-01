/**
 * 0277 lesson_reservation_guards (docs/design/coaching/db.md §4.5; build
 * contracts §1.8, R1, R7, R25, R35, R37, R64, R73): a lesson's court row is
 * taught to the reservation bodies.
 *
 *   1. A lesson is firm: match_court_free_firm, match_quote, desk_open_matches
 *      and desk_match_detail count it; the reservation trigger fires on a lesson
 *      insert (a filling match left with no firm-free court is bumped) and on a
 *      held lesson's hold turning into kind 'lesson'; court_availability shows a
 *      lesson as a booking and a held lesson as a hold.
 *   2. A lesson's court hold is not an orphan (R25): neither expire_stale_holds
 *      nor its twin match_expire_holds expires it before its TTL, both expire it
 *      after, and an open lesson payment keeps it (the deposit skip).
 *   3. LESSON_VIA_COACHING, each detail: cancel, mark, extend, create, tab,
 *      confirm and move (court and time); an unknown id still answers
 *      RESERVATION_NOT_FOUND; a guest gets FORBIDDEN (no leak); the row is left
 *      as it was. The offline queue (replay) dispatches these same RPCs as the
 *      queuing staff member (db.md §4.5.4), so a replayed envelope meets the
 *      same refusal.
 *   4. close_branch: live lessons are bookings to come (BRANCH_HAS_BOOKINGS,
 *      the count), then R37's coaching money (detail coaching_money): a lesson
 *      refund due at the till, an undrafted month of statement lessons, a draft
 *      or approved statement; a branch with none of them closes.
 *
 * Rows are planted as postgres in rolled-back transactions (tests/coaching-plant.ts):
 * no coaching RPC creates a lesson before 0280. close_branch's money test
 * reaches Money's 0278 (lesson_money_open, lesson_settle, app.refund).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { KEEP, Q, RES, T, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, data, failed } from './matches-harness';
import { MANAGER_PIN, PLANT_BRANCH as PLANT, ago, at } from './coaching-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const BASE = [
  SETUP,
  PLANT,
  'select pg_temp.branch();',
  'select pg_temp.staff();',
  'select pg_temp.coaching();',
];

/** A fresh manager-PIN grant for `who` (verify_manager_pin's row), without the PIN round trip. */
const GRANT = (who: string) =>
  X(`insert into app.pin_grants (caller_id, authorizer_id) values ({{${who}}}, {{manager}})`);

const NIL = '00000000-0000-4000-8000-000000000277';

// ── 1. firm, masked, the trigger ─────────────────────────────────────────────

describe.skipIf(!docker)('0277 a lesson is firm, masked and counted (rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('c277f', [
      ...BASE,
      GUEST('g1'),
      KEEP('p3', `select tstzrange(${at(3)}, ${at(3)} + interval '90 minutes', '[)')::text`),

      // a. The counts at one period: free, then a booking on c2, then a lesson on c1.
      Q(
        'firm_free',
        `select jsonb_build_object(
          'one', app.match_court_free_firm({{v}}, {{p3}}::tstzrange, 90, 1),
          'two', app.match_court_free_firm({{v}}, {{p3}}::tstzrange, 90, 2))`,
      ),
      X(`select pg_temp.res('c2', ${at(3)}, 90)`),
      Q(
        'firm_booking',
        `select jsonb_build_object(
          'one', app.match_court_free_firm({{v}}, {{p3}}::tstzrange, 90, 1),
          'two', app.match_court_free_firm({{v}}, {{p3}}::tstzrange, 90, 2))`,
      ),
      E('quote_before', 'g1', `select app.match_quote({{v}}, {{c1}}, ${at(3)}, 90)`),
      X(`select pg_temp.lesson('l1', 'lt_private', 'c1', ${at(3)}, '{"dur": 90}')`),
      Q(
        'firm_lesson',
        `select jsonb_build_object(
          'one', app.match_court_free_firm({{v}}, {{p3}}::tstzrange, 90, 1))`,
      ),
      E('quote_after', 'g1', `select app.match_quote({{v}}, {{c1}}, ${at(3)}, 90)`),

      // b. court_availability: a lesson reads as a booking, a held lesson as a hold.
      X(`select pg_temp.lesson('l2', 'lt_private', 'c2', ${at(3, 6)}, '{"status": "held"}')`),
      Q(
        'avail',
        `select jsonb_build_object(
          'lesson', (select ca.kind from court_availability ca where ca.court_id = {{c1}} and ca.start_at = ${at(3)}),
          'held', (select ca.kind from court_availability ca where ca.court_id = {{c2}} and ca.start_at = ${at(3, 6)}),
          'row_kinds', (select jsonb_agg(x.kind order by x.kind) from reservations x
                         where x.id in ({{l1_res}}, {{l2_res}})),
          'columns', (select jsonb_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
                        from pg_attribute a
                       where a.attrelid = 'public.court_availability'::regclass and a.attnum > 0
                         and not a.attisdropped))`,
      ),

      // c. desk_open_matches counts a lesson as firm (no bump: one court stays free).
      K('m5', `select pg_temp.m(jsonb_build_object('start_at', ${at(5)}))`),
      T(
        'open_before',
        'desk',
        `select app.desk_open_matches(${at(5)} - interval '1 hour', ${at(5)} + interval '1 hour')`,
      ),
      X(`select pg_temp.lesson('l5', 'lt_private', 'c1', ${at(5)}, '{"dur": 90}')`),
      T(
        'open_after',
        'desk',
        `select app.desk_open_matches(${at(5)} - interval '1 hour', ${at(5)} + interval '1 hour')`,
      ),
      Q('m5_status', `select to_jsonb(status) from matches where id = {{m5}}`),
      Q('m5_id', `select to_jsonb({{m5}}::text)`),

      // d. The trigger on a lesson insert: c2 booked, then a lesson takes c1, the
      //    last firm-free court: the filling match is bumped.
      K('m6', `select pg_temp.m(jsonb_build_object('start_at', ${at(6)}))`),
      X(`select pg_temp.res('c2', ${at(6)}, 90)`),
      T('detail_before', 'desk', `select app.desk_match_detail({{m6}})`),
      X(`select pg_temp.lesson('l6', 'lt_private', 'c1', ${at(6)}, '{"dur": 90}')`),
      Q('m6_status', `select to_jsonb(status) from matches where id = {{m6}}`),
      T('detail_after', 'desk', `select app.desk_match_detail({{m6}})`),

      // e. The trigger on a held lesson's success: the hold is not firm (no
      //    bump); Money turns it into kind 'lesson' in place, and the match goes.
      K('m7', `select pg_temp.m(jsonb_build_object('start_at', ${at(7)}))`),
      X(`select pg_temp.res('c2', ${at(7)}, 90)`),
      X(
        `select pg_temp.lesson('l7', 'lt_private', 'c1', ${at(7)}, '{"dur": 90, "status": "held"}')`,
      ),
      Q('m7_held', `select to_jsonb(status) from matches where id = {{m7}}`),
      X(`update lessons set status = 'scheduled', hold_expires_at = null where id = {{l7}}`),
      X(
        `update reservations set kind = 'lesson', status = 'confirmed', hold_expires_at = null where id = {{l7_res}}`,
      ),
      Q('m7_paid', `select to_jsonb(status) from matches where id = {{m7}}`),

      Q(
        'trigger_def',
        `select to_jsonb(pg_get_triggerdef(t.oid)) from pg_trigger t
                         where t.tgname = 'reservations_match' and t.tgrelid = 'public.reservations'::regclass`,
      ),
    ]);
  });

  it('match_court_free_firm counts a live lesson as firm (a hold never was)', () => {
    expect(data(r, 'firm_free')).toEqual({ one: true, two: true });
    expect(data(r, 'firm_booking')).toEqual({ one: true, two: false });
    expect(data(r, 'firm_lesson')).toEqual({ one: false });
  });

  it('match_quote: one firm-free court before the lesson, none after (SLOT_TAKEN)', () => {
    expect(data<Json>(r, 'quote_before').courts_free).toBe(1);
    const after = data<Json>(r, 'quote_after');
    expect(after.courts_free).toBe(0);
    expect(after.refusal).toBe('SLOT_TAKEN');
  });

  it('court_availability masks a lesson as a booking and a held lesson as a hold; same columns', () => {
    const a = data<Json>(r, 'avail');
    expect(a.lesson).toBe('booking');
    expect(a.held).toBe('hold');
    expect(a.row_kinds).toEqual(['hold', 'lesson']);
    expect(a.columns).toEqual([
      'court_id:uuid',
      'start_at:timestamp with time zone',
      'end_at:timestamp with time zone',
      'kind:reservation_kind',
    ]);
  });

  it('desk_open_matches: courts_free_firm drops by one for a lesson; the match keeps filling', () => {
    const m5 = data<string>(r, 'm5_id');
    const free = (label: string) =>
      data<{ matches: { match_id: string; courts_free_firm: number }[] }>(r, label).matches.find(
        (m) => m.match_id === m5,
      )?.courts_free_firm;
    expect(free('open_before')).toBe(2);
    expect(free('open_after')).toBe(1);
    expect(data(r, 'm5_status')).toBe('filling');
  });

  it('the trigger fires on a lesson insert: the last firm-free court taken bumps the filling match', () => {
    expect((data<Json>(r, 'detail_before').match as Json).courts_free_firm).toBe(1);
    expect(data(r, 'm6_status')).toBe('bumped');
    expect((data<Json>(r, 'detail_after').match as Json).courts_free_firm).toBe(0);
  });

  it("the trigger fires when a held lesson's hold becomes kind 'lesson' (Money's success), not before", () => {
    expect(data(r, 'm7_held')).toBe('filling');
    expect(data(r, 'm7_paid')).toBe('bumped');
    const def = String(data(r, 'trigger_def'));
    expect(def).toContain('WHEN');
    expect(def).toContain("'booking'::reservation_kind");
    expect(def).toContain("'maintenance'::reservation_kind");
    expect(def).toContain("'lesson'::reservation_kind");
  });
});

// ── 2. a lesson's court hold is no orphan (R25) ──────────────────────────────

describe.skipIf(!docker)(
  '0277 expire_stale_holds and match_expire_holds keep a lesson hold until its TTL (rolled back)',
  () => {
    let r: Results;

    beforeAll(() => {
      r = scenario('c277h', [
        ...BASE,
        GUEST('g1'),
        KEEP('ph', `select tstzrange(${at(4)}, ${at(4)} + interval '60 minutes', '[)')::text`),
        X(`select pg_temp.lesson('lh', 'lt_private', 'c1', ${at(4)}, '{"status": "held"}')`),
        X(
          `select pg_temp.enrol('eh', 'lh', '{"guest": "g1", "mode": "online", "status": "held"}')`,
        ),

        // Within its TTL: neither form touches it (guest_id is NULL, lesson_id set).
        E(
          'twin_live_match',
          null,
          `select to_jsonb(app.match_expire_holds({{v}}, {{ph}}::tstzrange))`,
        ),
        E(
          'twin_live_chain',
          null,
          `select to_jsonb(app.expire_stale_holds(null, {{ph}}::tstzrange))`,
        ),
        Q('live_status', `select to_jsonb(status) from reservations where id = {{lh_res}}`),

        // Past its TTL with a payment still open: the deposit skip keeps it.
        X(
          `update reservations set hold_expires_at = now() - interval '1 minute' where id = {{lh_res}}`,
        ),
        X(
          `select pg_temp.online('ph_pay', 'eh', 40000, '{"status": "pending", "hold": "lh_res"}')`,
        ),
        E(
          'twin_paying_match',
          null,
          `select to_jsonb(app.match_expire_holds({{v}}, {{ph}}::tstzrange))`,
        ),
        E(
          'twin_paying_chain',
          null,
          `select to_jsonb(app.expire_stale_holds(null, {{ph}}::tstzrange))`,
        ),
        Q('paying_status', `select to_jsonb(status) from reservations where id = {{lh_res}}`),

        // The payment's grace over: both forms expire it by TTL, the same row.
        X(
          `update booking_payments set deadline_at = now() - interval '11 minutes' where id = {{ph_pay}}`,
        ),
        E(
          'twin_stale_match',
          null,
          `select to_jsonb(app.match_expire_holds({{v}}, {{ph}}::tstzrange))`,
        ),
        Q('stale_match_status', `select to_jsonb(status) from reservations where id = {{lh_res}}`),
        X(`update reservations set status = 'pending' where id = {{lh_res}}`),
        E(
          'twin_stale_chain',
          null,
          `select to_jsonb(app.expire_stale_holds(null, {{ph}}::tstzrange))`,
        ),
        Q('stale_chain_status', `select to_jsonb(status) from reservations where id = {{lh_res}}`),

        // A guest's own hold beside it is expired exactly as before.
        K('gh', `select pg_temp.res('c2', ${at(4)}, 60, 'hold', 'pending', 'g1')`),
        X(
          `update reservations set hold_expires_at = now() - interval '1 minute' where id = {{gh}}`,
        ),
        E('guest_hold', null, `select to_jsonb(app.match_expire_holds({{v}}, {{ph}}::tstzrange))`),
        Q('guest_hold_status', `select to_jsonb(status) from reservations where id = {{gh}}`),
      ]);
    });

    it('a live lesson hold (guest_id NULL, lesson_id set) is never expired as an orphan', () => {
      expect(data(r, 'twin_live_match')).toBe(0);
      expect(data(r, 'twin_live_chain')).toBe(0);
      expect(data(r, 'live_status')).toBe('pending');
    });

    it('a lapsed lesson hold with its payment still open is kept, as a deposit hold is', () => {
      expect(data(r, 'twin_paying_match')).toBe(0);
      expect(data(r, 'twin_paying_chain')).toBe(0);
      expect(data(r, 'paying_status')).toBe('pending');
    });

    it('past the grace both twins expire it by TTL', () => {
      expect(data(r, 'twin_stale_match')).toBe(1);
      expect(data(r, 'stale_match_status')).toBe('expired');
      expect(Number(data(r, 'twin_stale_chain'))).toBeGreaterThanOrEqual(1);
      expect(data(r, 'stale_chain_status')).toBe('expired');
      expect(data(r, 'guest_hold')).toBe(1);
      expect(data(r, 'guest_hold_status')).toBe('expired');
    });
  },
);

// ── 3. LESSON_VIA_COACHING ───────────────────────────────────────────────────

describe.skipIf(!docker)(
  '0277 LESSON_VIA_COACHING: a lesson is changed only through the coaching RPCs (rolled back)',
  () => {
    let r: Results;

    beforeAll(() => {
      r = scenario('c277v', [
        ...BASE,
        GUEST('g1'),
        X(`select pg_temp.day('day')`),
        X(`select pg_temp.lesson('lv', 'lt_private', 'c1', ${at(3)})`),
        X(`select pg_temp.lesson('lw', 'lt_private', 'c2', ${at(3, 3)}, '{"status": "held"}')`),
        X(`select pg_temp.lesson('lp', 'lt_private', 'c2', ${ago(1)})`),
        Q(
          'before',
          `select to_jsonb(x) - 'created_at' from reservations x where x.id = {{lv_res}}`,
        ),

        T('cancel', 'desk', `select app.cancel_reservation({{lv_res}}, 'customer_request')`),
        T('cancel_guest', 'g1', `select app.cancel_reservation({{lv_res}}, null)`),
        T('cancel_unknown', 'desk', `select app.cancel_reservation('${NIL}', null)`),
        T('mark_arrived', 'desk', `select app.mark_reservation({{lv_res}}, 'arrived')`),
        T('mark_completed', 'desk', `select app.mark_reservation({{lp_res}}, 'completed')`),
        T('mark_no_show', 'desk', `select app.mark_reservation({{lp_res}}, 'no_show')`),
        T(
          'extend',
          'desk',
          `select app.extend_reservation({{lv_res}}, ${at(3)} + interval '90 minutes', 'staff_op')`,
        ),
        T(
          'create',
          'desk',
          `select app.staff_create_reservation({{c1}}, 'lesson', ${at(9)}, ${at(9)} + interval '60 minutes')`,
        ),
        T(
          'create_range',
          'desk',
          `select app.staff_create_reservation({{c1}}, 'lesson', ${at(9)}, ${at(9)})`,
        ),
        T('tab', 'cashier', `select app.open_tab(null, null, {{lv_res}}, null, null)`),
        T('tab_kind', 'cashier', `select app.open_tab(null, 'Lesson', null, null, null, 'lesson')`),
        T('confirm', 'desk', `select app.confirm_booking({{lw_res}})`),
        T('confirm_guest', 'g1', `select app.confirm_booking({{lw_res}})`),
        T(
          'move_court',
          'desk',
          `select app.move_reservation({{lv_res}}, {{c2}}, null, null, 'staff_op')`,
        ),
        T(
          'move_time',
          'desk',
          `select app.move_reservation({{lv_res}}, null, ${at(8)}, ${at(8)} + interval '60 minutes', 'staff_op')`,
        ),
        T(
          'move_range',
          'desk',
          `select app.move_reservation({{lv_res}}, null, ${at(8)}, ${at(8)}, 'staff_op')`,
        ),
        Q('after', `select to_jsonb(x) - 'created_at' from reservations x where x.id = {{lv_res}}`),

        // A plain booking is untouched by the guard.
        K('plain', `select pg_temp.res('c1', ${at(10)}, 60)`),
        T('plain_cancel', 'desk', `select app.cancel_reservation({{plain}}, 'customer_request')`),
      ]);
    });

    const lvc = (label: string, detail: string) => {
      const f = failed(r, label);
      expect(f.code, label).toBe('LESSON_VIA_COACHING');
      expect(f.detail, label).toBe(detail);
    };

    it('cancel_reservation: staff get LESSON_VIA_COACHING cancel; a guest gets FORBIDDEN; an unknown id RESERVATION_NOT_FOUND', () => {
      lvc('cancel', 'cancel');
      expect(failed(r, 'cancel_guest').code).toBe('FORBIDDEN');
      expect(failed(r, 'cancel_unknown').code).toBe('RESERVATION_NOT_FOUND');
    });

    it('mark_reservation refuses every status on a lesson row (mark)', () => {
      lvc('mark_arrived', 'mark');
      lvc('mark_completed', 'mark');
      lvc('mark_no_show', 'mark');
    });

    it('extend_reservation (extend) and staff_create_reservation p_kind lesson (create), before INVALID_RANGE', () => {
      lvc('extend', 'extend');
      lvc('create', 'create');
      lvc('create_range', 'create');
    });

    it('open_tab on a lesson row (tab); p_kind lesson stays INVALID_ARGUMENT', () => {
      lvc('tab', 'tab');
      const k = failed(r, 'tab_kind');
      expect(k.code).toBe('INVALID_ARGUMENT');
      expect(k.detail).toBe('p_kind');
    });

    it("confirm_booking on a held lesson's hold: staff get confirm (R35), a guest FORBIDDEN", () => {
      lvc('confirm', 'confirm');
      expect(failed(r, 'confirm_guest').code).toBe('FORBIDDEN');
    });

    it('move_reservation refuses a lesson whatever the court and times (move), after INVALID_RANGE (R7)', () => {
      lvc('move_court', 'move');
      lvc('move_time', 'move');
      expect(failed(r, 'move_range').code).toBe('INVALID_RANGE');
    });

    it('the lesson row is left exactly as it was; a plain booking is untouched by the guard', () => {
      expect(data(r, 'after')).toEqual(data(r, 'before'));
      expect(data<Json>(r, 'plain_cancel').status).toBe('cancelled');
    });
  },
);

// ── 4. close_branch (R37) ────────────────────────────────────────────────────

describe.skipIf(!docker)(
  '0277 close_branch: live lessons and coaching money (R37) (rolled back)',
  () => {
    let r: Results;

    beforeAll(() => {
      r = scenario('c277c', [
        ...BASE,
        GUEST('g1'),
        // A lesson next week, its student paid at the desk.
        X(`select pg_temp.day('day')`),
        X(`select pg_temp.lesson('l1', 'lt_private', 'c1', ${at(7)})`),
        X(
          `select pg_temp.enrol('e1', 'l1', '{"name": "Huda Walk-in", "phone": "+9647705550001"}')`,
        ),
        T(
          'settle',
          'cashier',
          `select app.lesson_settle({{e1}}, 'cash', 40000, 40000, 'k-c277c-settle', null)`,
        ),
        RES('e1_pay', 'settle', 'payment_id'),
        // A lesson taught last month (completed), no statement drafted for it.
        X(
          `select pg_temp.lesson('l0', 'lt_private', 'c1', date_trunc('month', now()) - interval '10 days', '{"status": "completed"}')`,
        ),
        X(
          `update day_sessions set status = 'closed', closed_at = now(), closed_by = {{manager}} where id = {{day}}`,
        ),

        T('close_live', 'owner', `select to_jsonb(app.close_branch({{v}}))`),

        // Last month's lesson covered by a paid statement; the lesson of next week
        // cancelled by the desk: its paid student is owed 40,000 at the till, and
        // that alone keeps the branch open.
        K(
          'st',
          `insert into coach_statements (coach_id, venue_id, month, status, approved_at, approved_by, paid_at,
                                             paid_by, paid_reference)
               values ({{coach}}, {{v}}, (date_trunc('month', now()) - interval '1 month')::date, 'paid', now(),
                       {{manager}}, now(), {{manager}}, 'TRF-0277') returning id`,
        ),
        X(`select pg_temp.cancel_lesson('l1', 'staff_cancel')`),
        X(`select pg_temp.cancel_enrol('e1', 'staff')`),
        Q('due_desk', `select pg_temp.money('e1') -> 'refund_due_desk_iqd'`),
        Q('open_refund_due', `select to_jsonb(app.lesson_money_open({{v}}))`),
        T('close_refund_due', 'owner', `select to_jsonb(app.close_branch({{v}}))`),

        // Refunded at the till (the day open again for it), the day closed: nothing left.
        X(
          `update day_sessions set status = 'open', closed_at = null, closed_by = null where id = {{day}}`,
        ),
        GRANT('manager'),
        T(
          'refund',
          'manager',
          `select app.refund({{e1_pay}}, 40000, '${MANAGER_PIN}', 'lesson_refund', null, null, 'k-c277c-refund')`,
        ),
        X(
          `update day_sessions set status = 'closed', closed_at = now(), closed_by = {{manager}} where id = {{day}}`,
        ),
        Q('open_settled', `select to_jsonb(app.lesson_money_open({{v}}))`),

        // The statement back to draft, then approved: open; voided: last month's
        // lesson is undrafted again: open.
        X(`update coach_statements set status = 'draft' where id = {{st}}`),
        T('close_draft', 'owner', `select to_jsonb(app.close_branch({{v}}))`),
        X(`update coach_statements set status = 'approved' where id = {{st}}`),
        T('close_approved', 'owner', `select to_jsonb(app.close_branch({{v}}))`),
        X(`update coach_statements set status = 'void', voided_at = now(), voided_by = {{manager}},
                                     void_reason = 'redraft' where id = {{st}}`),
        Q('open_undrafted', `select to_jsonb(app.lesson_money_open({{v}}))`),
        T('close_undrafted', 'owner', `select to_jsonb(app.close_branch({{v}}))`),

        // A new statement for that month, paid: the branch closes.
        X(`insert into coach_statements (coach_id, venue_id, month, status, approved_at, approved_by, paid_at, paid_by,
                                       paid_reference)
         values ({{coach}}, {{v}}, (date_trunc('month', now()) - interval '1 month')::date, 'paid', now(), {{manager}},
                 now(), {{manager}}, 'TRF-0277-B')`),
        Q('open_none', `select to_jsonb(app.lesson_money_open({{v}}))`),
        T('close', 'owner', `select to_jsonb(app.close_branch({{v}}))`),
      ]);
    });

    it('a lesson still to come is a booking to come: BRANCH_HAS_BOOKINGS with the count', () => {
      const f = failed(r, 'close_live');
      expect(f.code).toBe('BRANCH_HAS_BOOKINGS');
      expect(f.detail).toBe('1');
      expect(f.hint).toContain('lessons');
    });

    it('R37: lesson money due back at the till alone keeps the branch open (coaching_money)', () => {
      expect(data(r, 'due_desk')).toBe(40000);
      expect(data(r, 'open_refund_due')).toBe(true);
      const f = failed(r, 'close_refund_due');
      expect(f.code).toBe('BRANCH_HAS_BOOKINGS');
      expect(f.detail).toBe('coaching_money');
      expect(data<Json>(r, 'refund').amount_iqd).toBe(40000);
      expect(data(r, 'open_settled')).toBe(false);
    });

    it('R37: a draft or approved statement, then a month of statement lessons with no live statement, keep it open', () => {
      expect(failed(r, 'close_draft').detail).toBe('coaching_money');
      expect(failed(r, 'close_approved').detail).toBe('coaching_money');
      expect(data(r, 'open_undrafted')).toBe(true);
      expect(failed(r, 'close_undrafted').detail).toBe('coaching_money');
    });

    it('with every statement paid and every refund made the branch closes', () => {
      expect(data(r, 'open_none')).toBe(false);
      expect(data<Json>(r, 'close').status).toBe('closed');
    });
  },
);
