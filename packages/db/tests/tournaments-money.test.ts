/**
 * tournaments_schema_money, the money (docs/design/tournaments/build-contracts-2026-10-03.md §1.7,
 * §1.12 S1–S7, S14):
 *
 *   * tournament_settle: the refusals in their order (role, arguments, scope, the open day, the
 *     entry's own status, a cancelled tournament, nothing owed, the owed figure moved), one fresh
 *     kind 'tournament' tab settled in the same call for the fee, cash with change and card, the
 *     replay, and a second settle finding nothing owed;
 *   * the till line (S1, S2): compute_tab_totals keeps six columns, the fee is in total_iqd only
 *     (lesson_iqd 0, untaxed), and re-totalling the settled tab gives back its own fee;
 *   * app.tournament_entry_money: its keys, money read from payments and refunds (S3), refund_due
 *     after a withdrawal and after a cancel, a refund through app.refund lowering it;
 *   * cafe_settled_tabs leaves the tab out (S6); shop_staff never takes entry money (S4).
 *
 * Every case is one rolled-back psql transaction (stores-harness); without docker the suite skips.
 */
import { describe, expect, it } from 'vitest';
import { TOURNAMENT_SHAPES, tourMissingKeys } from '../../core/src/tournaments';
import { DEV_PINS, stackAvailable } from './helpers';
import { GUEST } from './matches-harness';
import { dockerReachable, KEEP, MK, Q, scenario, T, X } from './stores-harness';
import { answer, KEY, PUBLISH, refusal, RUN, TOUR_BRANCH, TOUR_SETUP } from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

const FEE = 25000;
const NIL = '00000000-0000-4000-8000-000000000000';

/** tournament_settle as SQL. */
const SETTLE = (
  e: string,
  method: 'cash' | 'card',
  owed: number,
  tendered: number | null,
  key = KEY('s'),
) =>
  `select app.tournament_settle({{${e}}}, '${method}', ${owed}, ${tendered ?? 'null'}, ${key}, null)`;

/** A published tournament with a fee the owner approved, four registered entries, an open day. */
const BASE = [
  TOUR_SETUP,
  ...TOUR_BRANCH,
  RUN('r1', { fee: FEE, count: 4 }),
  ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 2 }),
  `select pg_temp.field('t1', 4, 'p');`,
  GUEST('w1'),
  T('w1_reg', 'w1', `select app.tournament_register({{t1}})`),
  KEEP('w1_e', `select id::text from tournament_entries where guest_id = {{w1}}::uuid`),
];

describe.skipIf(!docker)('tournament_settle (§1.7, S1, S4, S5, S14)', () => {
  it('refuses in order; settles one fresh tournament tab for the fee; replays; then nothing is owed', () => {
    const r = scenario('tm-settle', [
      ...BASE,
      MK('shop', 'shop_staff'),
      T('prep', 'prep', SETTLE('p1_e', 'cash', FEE, FEE)),
      T('shop', 'shop', SETTLE('p1_e', 'cash', FEE, FEE)),
      T(
        'no_entry',
        'cashier',
        `select app.tournament_settle(null, 'cash', ${FEE}, ${FEE}, ${KEY('a')}, null)`,
      ),
      T('no_owed', 'cashier', SETTLE('p1_e', 'cash', 0, FEE)),
      T(
        'no_key',
        'cashier',
        `select app.tournament_settle({{p1_e}}, 'cash', ${FEE}, ${FEE}, null, null)`,
      ),
      T(
        'nil',
        'cashier',
        `select app.tournament_settle('${NIL}', 'cash', ${FEE}, ${FEE}, ${KEY('n')}, null)`,
      ),
      T('no_day', 'cashier', SETTLE('p1_e', 'cash', FEE, FEE)),
      `select pg_temp.day('day1');`,
      T('waitlisted', 'cashier', SETTLE('w1_e', 'cash', FEE, FEE)),
      T('changed', 'cashier', SETTLE('p1_e', 'cash', FEE - 1, FEE)),
      T('short', 'cashier', SETTLE('p1_e', 'cash', FEE, FEE - 1)),
      T('card_tender', 'cashier', SETTLE('p1_e', 'card', FEE, FEE)),
      KEEP('k1', `select 'tm-settle-k1-' || gen_random_uuid()`),
      T(
        'cash',
        'cashier',
        `select app.tournament_settle({{p1_e}}, 'cash', ${FEE}, 30000, {{k1}}, null)`,
      ),
      T(
        'replay',
        'cashier',
        `select app.tournament_settle({{p1_e}}, 'cash', ${FEE}, 30000, {{k1}}, null)`,
      ),
      T('again', 'cashier', SETTLE('p1_e', 'cash', FEE, FEE)),
      T('card', 'desk', SETTLE('p2_e', 'card', FEE, null)),
      Q(
        'tab',
        `select jsonb_build_object('kind', t.kind, 'label', t.label, 'status', t.status, 'total', t.total_iqd,
                     'lesson', t.lesson_iqd, 'tax', t.tax_iqd, 'court', t.court_iqd, 'day', t.day_session_id = {{day1}}::uuid,
                     'entry', t.tournament_entry_id = {{p1_e}}::uuid, 'reservation', t.reservation_id,
                     'payments', (select jsonb_agg(jsonb_build_object('amount', p.amount_iqd, 'change', p.change_iqd,
                                                                       'method', p.method)) from payments p where p.tab_id = t.id))
                   from tabs t where t.tournament_entry_id = {{p1_e}}::uuid`,
      ),
      // S2: the settled tab re-totals to its own fee; S1: six columns.
      Q(
        'retotal',
        `select to_jsonb(x) from app.compute_tab_totals(
                      (select id from tabs where tournament_entry_id = {{p1_e}}::uuid)) x`,
      ),
      Q('money', `select app.tournament_entry_money({{p1_e}}::uuid)`),
      Q(
        'money_excl',
        `select app.tournament_entry_money({{p1_e}}::uuid,
                         (select id from tabs where tournament_entry_id = {{p1_e}}::uuid))`,
      ),
      Q(
        'cafe',
        `select to_jsonb(count(*)) from app.cafe_settled_tabs(null, null) c
                  where c.tab_id in (select id from tabs where kind = 'tournament')`,
      ),
      Q(
        'audit',
        `select to_jsonb(count(*)) from audit_log where action = 'tournament.settle' and entity_id = {{p1_e}}`,
      ),
      // A withdrawn entry, a no-show and a cancelled tournament are not payable.
      X(`update tournament_entries set status = 'withdrawn', withdrawn_reason = 'staff', withdrawn_at = now()
          where id = {{p3_e}}::uuid`),
      T('withdrawn', 'cashier', SETTLE('p3_e', 'cash', FEE, FEE)),
      X(
        `update tournament_entries set status = 'no_show', no_show_at = now() where id = {{p4_e}}::uuid`,
      ),
      T('no_show', 'cashier', SETTLE('p4_e', 'cash', FEE, FEE)),
    ]);
    expect(refusal(r, 'prep')).toBe('FORBIDDEN');
    expect(refusal(r, 'shop')).toBe('FORBIDDEN');
    expect(refusal(r, 'no_entry')).toBe('INVALID_ARGUMENT:p_entry_id');
    expect(refusal(r, 'no_owed')).toBe('INVALID_ARGUMENT:p_expected_owed_iqd');
    expect(refusal(r, 'no_key')).toBe('INVALID_ARGUMENT:p_idempotency_key');
    expect(refusal(r, 'nil')).toBe('TOURNAMENT_ENTRY_NOT_FOUND');
    expect(refusal(r, 'no_day')).toBe('NO_OPEN_DAY');
    expect(refusal(r, 'waitlisted')).toBe('TOURNAMENT_NOT_PAYABLE:waitlisted');
    expect(refusal(r, 'changed')).toBe(`TOURNAMENT_OWED_CHANGED:expected ${FEE - 1}, now ${FEE}`);
    expect(refusal(r, 'short')).toBe('TENDER_SHORT');
    expect(refusal(r, 'card_tender')).toBe('TENDER_CARD');

    const cash = answer(r, 'cash');
    expect(tourMissingKeys(cash, TOURNAMENT_SHAPES.tournament_settle)).toEqual([]);
    expect(cash).toMatchObject({
      duplicate: false,
      amount_iqd: FEE,
      change_iqd: 5000,
      method: 'cash',
      owed_iqd: 0,
      status: 'settled',
    });
    expect(answer(r, 'replay')).toMatchObject({ duplicate: true, payment_id: cash.payment_id });
    expect(refusal(r, 'again')).toBe('TOURNAMENT_NOT_PAYABLE:nothing_owed');
    expect(answer(r, 'card')).toMatchObject({ amount_iqd: FEE, change_iqd: null, method: 'card' });

    expect(answer(r, 'tab')).toEqual({
      kind: 'tournament',
      label: 'Tournament',
      status: 'settled',
      total: FEE,
      lesson: 0,
      tax: 0,
      court: 0,
      day: true,
      entry: true,
      reservation: null,
      payments: [{ amount: FEE, change: 5000, method: 'cash' }],
    });
    const retotal = answer<Record<string, number>>(r, 'retotal');
    expect(Object.keys(retotal).sort()).toEqual(
      ['court_iqd', 'discount_iqd', 'lesson_iqd', 'subtotal_iqd', 'tax_iqd', 'total_iqd'].sort(),
    );
    expect(retotal).toMatchObject({ total_iqd: FEE, lesson_iqd: 0, tax_iqd: 0, subtotal_iqd: 0 });

    const money = answer(r, 'money');
    expect(tourMissingKeys(money, TOURNAMENT_SHAPES.tournament_entry_money)).toEqual([]);
    expect(money).toMatchObject({
      fee_iqd: FEE,
      desk_paid_iqd: FEE,
      desk_refunded_iqd: 0,
      online_paid_iqd: 0,
      net_iqd: FEE,
      payable: true,
      owed_iqd: 0,
      refund_due_iqd: 0,
    });
    expect(answer(r, 'money_excl')).toMatchObject({ desk_paid_iqd: 0, owed_iqd: FEE });
    expect(answer(r, 'cafe')).toBe(0);
    expect(answer(r, 'audit')).toBe(1);
    expect(refusal(r, 'withdrawn')).toBe('TOURNAMENT_NOT_PAYABLE:withdrawn');
    expect(refusal(r, 'no_show')).toBe('TOURNAMENT_NOT_PAYABLE:no_show');
  });

  it('a paid entry is due its money back after a withdrawal and after a cancel; app.refund lowers it', () => {
    const r = scenario('tm-refund', [
      ...BASE,
      `select pg_temp.day('day1');`,
      T('pay1', 'cashier', SETTLE('p1_e', 'cash', FEE, FEE)),
      T('pay2', 'cashier', SETTLE('p2_e', 'cash', FEE, FEE)),
      // p1 is taken off by the desk: what it paid is due back.
      T('rm', 'desk', `select app.tournament_remove_entry({{p1_e}}, 'cannot come')`),
      Q('m1', `select app.tournament_entry_money({{p1_e}}::uuid)`),
      // A refund at the till for part of it.
      KEEP('pay1_id', `select res #>> '{data,payment_id}' from pg_temp.out where label = 'pay1'`),
      X(`insert into app.pin_grants (caller_id, authorizer_id) values ({{manager}}, {{manager}})`),
      T(
        'refund',
        'manager',
        `select app.refund({{pay1_id}}, 10000, '${DEV_PINS.manager}', 'tournament_refund', null, null, ${KEY('rf')})`,
      ),
      Q('m1_after', `select app.tournament_entry_money({{p1_e}}::uuid)`),
      // The tournament is cancelled: p2's fee is due back and listed.
      T('cancel', 'manager', `select app.tournament_cancel({{t1}}, 'Venue closed')`),
      Q('m2', `select app.tournament_entry_money({{p2_e}}::uuid)`),
      T('settle_cancelled', 'cashier', SETTLE('p3_e', 'cash', FEE, FEE)),
    ]);
    expect(answer(r, 'rm')).toMatchObject({ status: 'withdrawn', refund_due_iqd: FEE });
    expect(answer(r, 'm1')).toMatchObject({
      entry_status: 'withdrawn',
      payable: false,
      owed_iqd: 0,
      net_iqd: FEE,
      refund_due_iqd: FEE,
    });
    expect(answer(r, 'refund')).toBeTruthy();
    expect(answer(r, 'm1_after')).toMatchObject({
      desk_refunded_iqd: 10000,
      net_iqd: FEE - 10000,
      refund_due_iqd: FEE - 10000,
    });
    const cancel = answer<{ refunds_due: Array<{ entry_id: string; net_paid_iqd: number }> }>(
      r,
      'cancel',
    );
    expect(cancel.refunds_due.map((x) => x.net_paid_iqd).sort()).toEqual([FEE - 10000, FEE].sort());
    expect(answer(r, 'm2')).toMatchObject({
      tournament_status: 'cancelled',
      payable: false,
      owed_iqd: 0,
      refund_due_iqd: FEE,
    });
    expect(refusal(r, 'settle_cancelled')).toBe('TOURNAMENT_NOT_PAYABLE:cancelled');
  });

  it('a closed tournament never played is cancelled by the sweep at the finish, so its payers are owed back', () => {
    const r = scenario('tm-unplayed', [
      ...BASE,
      `select pg_temp.day('day1');`,
      T('pay1', 'cashier', SETTLE('p1_e', 'cash', FEE, FEE)),
      `select pg_temp.close('t1');`,
      // No round is ever drawn (rain); the finish comes six hours after the end.
      X(`update tournaments set starts_at = now() - interval '2 days', ends_at = now() - interval '7 hours',
                                registration_closes_at = now() - interval '3 days'
          where id = {{t1}}::uuid`),
      Q('sweep', `select app.tournament_sweep()`),
      Q('status', `select to_jsonb(status) from tournaments where id = {{t1}}::uuid`),
      Q('m1', `select app.tournament_entry_money({{p1_e}}::uuid)`),
      Q('m2', `select app.tournament_entry_money({{p2_e}}::uuid)`),
      Q(
        'audit',
        `select a.after->'refunds_due' from audit_log a
          where a.action = 'tournament.cancel' and a.entity_id = {{t1}}`,
      ),
    ]);
    expect(answer(r, 'sweep')).toMatchObject({ cancelled: 1, finished: 0, errors: 0 });
    expect(answer(r, 'status')).toBe('cancelled');
    expect(answer(r, 'm1')).toMatchObject({
      tournament_status: 'cancelled',
      payable: false,
      owed_iqd: 0,
      refund_due_iqd: FEE,
    });
    expect(answer(r, 'm2')).toMatchObject({ owed_iqd: 0, refund_due_iqd: 0 });
    expect(answer<Array<{ net_paid_iqd: number }>>(r, 'audit')).toEqual([
      expect.objectContaining({ net_paid_iqd: FEE }),
    ]);
  });
});
