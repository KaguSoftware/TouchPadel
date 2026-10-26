/**
 * 0370 open_matches_pay_at_desk: open matches without online payment.
 * platform_settings.match_payment_mode = 'desk' means a player takes a seat
 * with no ticket (the desk collects the share on arrival); 'tickets' (default)
 * is the unchanged prepaid model.
 *
 * Rolled-back scenario at a branch made inside the transaction, calling the
 * RPCs as the guest, in the same harness as matches-lifecycle: a start and a
 * join to four with no ticket bought, a leave while filling, a late leave and
 * its refill, approve mode, and that 'tickets' mode still refuses a guest with
 * an empty wallet.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { Q, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, START, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const JOIN = (m: string, friends = '[]') => `select app.match_join({{${m}}}, '${friends}'::jsonb, null)`;
const REQUEST = (m: string) => `select app.match_request({{${m}}}, '[]'::jsonb, null)`;
const LEAVE = (m: string) => `select app.match_leave({{${m}}}, null)`;
const KEPT = (name: string, label: string, path: string) =>
  K(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);

describe.skipIf(!docker)('open matches, pay at the desk (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m370', [
      SETUP,
      `select pg_temp.branch();`,
      GUEST('g1'), GUEST('g2'), GUEST('g3'), GUEST('g4'), GUEST('g5'), GUEST('g6'),

      // Online payments live and tickets mode (the default): an empty wallet is refused, as before.
      X(`update platform_settings set online_payments_live = true where id`),
      E('tickets_mode', 'g1', START({ key: 'k-t0' })),

      // 0371: with online payments off, the stored mode is 'tickets' and the desk still takes the seat.
      X(`update platform_settings set online_payments_live = false where id`),
      Q('offline_pays_at_desk', `select to_jsonb(app.match_pay_at_desk())`),
      X(`update platform_settings set match_payment_mode = 'desk' where id`),
      E('quote', 'g1', `select app.match_quote({{v}}, {{c1}}, ${at(3)}, 90)`),

      // A start with a friend and three joins, no ticket anywhere.
      E('start', 'g1', START({ friends: '[{}]', key: 'k-d1' })),
      KEPT('m1', 'start', 'match_id'),
      E('j2', 'g2', JOIN('m1')),
      Q('state_filling', `select pg_temp.state('m1')`),
      E('leave_filling', 'g2', LEAVE('m1')),
      E('j2_again', 'g2', JOIN('m1')),
      E('j3', 'g3', JOIN('m1')),
      Q('state_booked', `select pg_temp.state('m1')`),

      // A late leave on the booked match and its refill.
      E('late_leave', 'g2', LEAVE('m1')),
      E('refill', 'g4', JOIN('m1')),
      Q('state_refilled', `select pg_temp.state('m1')`),
      Q('tickets_total', `select to_jsonb(count(*)) from match_tickets k join pg_temp.guests g on g.id = k.guest_id`),

      // Approve mode: the request reserves nothing, the approval seats.
      E('start_approve', 'g5', START({ when: at(5), policy: 'approve', key: 'k-d2' })),
      KEPT('m2', 'start_approve', 'match_id'),
      E('request', 'g6', REQUEST('m2')),
      KEPT('q', 'request', 'request_id'),
      E('approve', 'g5', `select app.match_decide({{q}}, true)`),
      Q('state_approved', `select pg_temp.state('m2')`),
      Q('ledger', `select pg_temp.ledger()`),
    ]);
  });

  it('keeps the prepaid model in tickets mode', () => {
    expect(failed(r, 'tickets_mode').code).toBe('NEED_TICKETS');
  });

  it('pays at the desk while online payments are off, whatever the stored mode', () => {
    expect(data(r, 'offline_pays_at_desk')).toBe(true);
  });

  it('starts and joins with no ticket, and the seats carry none', () => {
    const s = data<Json>(r, 'start');
    expect(s).toMatchObject({ duplicate: false, status: 'filling' });
    expect((s.seats as Json[]).map((x) => [x.seat_no, x.kind])).toEqual([[1, 'account'], [2, 'friend']]);
    const filling = data<Json>(r, 'state_filling') as { seats: Json[] };
    expect(filling.seats.map((x) => x.ticket)).toEqual([null, null, null]);
    expect(data<Json>(r, 'state_booked')).toMatchObject({ match: { status: 'booked' } });
    expect(data<number>(r, 'tickets_total') as unknown).toBe(0);
  });

  it('leaves while filling, late-leaves and refills with no ticket to move', () => {
    expect(data<Json>(r, 'leave_filling')).toBeDefined();
    expect(data<Json>(r, 'j2_again')).toBeDefined();
    expect(data<Json>(r, 'late_leave')).toBeDefined();
    const st = data<Json>(r, 'state_refilled') as { seats: Json[] };
    expect(st.seats.some((x) => x.status === 'refilled')).toBe(true);
    expect(st.seats.filter((x) => x.status === 'in')).toHaveLength(4);
  });

  it('approve mode seats the requester without a ticket', () => {
    expect(data<Json>(r, 'request')).toMatchObject({ status: 'pending' });
    expect(data<Json>(r, 'approve')).toBeDefined();
    const st = data<Json>(r, 'state_approved') as { seats: Json[] };
    expect(st.seats.filter((x) => x.status === 'in')).toHaveLength(2);
    expect(data<unknown[]>(r, 'ledger') as unknown).toEqual([]);
  });
});
