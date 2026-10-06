/**
 * 0310 tournaments_money_lifecycle: the review fixes of the tournament money and lifecycle (plan
 * ~/.claude/plans/go-over-the-backend-partitioned-metcalfe.md §0310), one case per finding:
 *
 *   * c9  a sweep cancel of an under-filled tournament with paid entries keeps it on the desk list
 *         (refund_due_iqd) at any date; tournament_refunds_due lists each payer with its payments,
 *         and the detail gives each entry its payments;
 *   * c10 a paid entry that withdrew and came back onto the waitlist of a full field is due its
 *         money back once registration closes;
 *   * c41 app.refund on a tournament tab refunds at most refund_due_iqd unless the reason is
 *         tournament_goodwill;
 *   * c40 close_branch refuses a live tournament and entry money still due back;
 *   * c24 tournament_close: the desk closes past the cut-off, a manager early, never under-filled;
 *   * c25 a desk add while running is refused (TOURNAMENT_NOT_OPEN detail running);
 *   * c28/c29 tournament_finish ends a running tournament at its last complete round and frees
 *         its courts, the running block included;
 *   * c39 one failing sweep cancel no longer starves the next under-filled tournament;
 *   * s0  the tournament RPCs check the branch before they lock the row.
 *
 * Every case is one rolled-back psql transaction (stores-harness); without docker the suite skips.
 */
import { describe, expect, it } from 'vitest';
import { TOURNAMENT_SHAPES, tourMissingKeys } from '../../core/src/tournaments';
import { DEV_PINS, stackAvailable } from './helpers';
import { GUEST } from './matches-harness';
import { dockerReachable, KEEP, Q, scenario, T, X } from './stores-harness';
import {
  answer,
  KEY,
  PUBLISH,
  refusal,
  ROUNDS,
  RUN,
  TOUR_BRANCH,
  TOUR_SETUP,
} from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

const FEE = 25000;

const SETTLE = (e: string) =>
  `select app.tournament_settle({{${e}}}, 'cash', ${FEE}, ${FEE}, ${KEY('s')}, null)`;
const GRANT = X(
  `insert into app.pin_grants (caller_id, authorizer_id) values ({{manager}}, {{manager}})`,
);
const REFUND = (pay: string, amount: number, reason: string) =>
  `select app.refund({{${pay}}}, ${amount}, '${DEV_PINS.manager}', '${reason}', null, null, ${KEY('rf')})`;
const PAY_ID = (name: string, label: string) =>
  KEEP(name, `select res #>> '{data,payment_id}' from pg_temp.out where label = '${label}'`);
/** Past the cut-off, still before the start (tournaments_times). */
const PAST_CUTOFF = (tour: string) =>
  X(
    `update tournaments set registration_closes_at = now() - interval '1 minute' where id = {{${tour}}}::uuid`,
  );

describe.skipIf(!docker)('0310 money (c9, c10, c41)', () => {
  it('c9: a sweep cancel with paid entries stays on the desk list and in tournament_refunds_due', () => {
    const r = scenario('tml-c9', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { fee: FEE, count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { min_entries: 8 }),
      `select pg_temp.field('t1', 6, 'p');`,
      `select pg_temp.day('day1');`,
      T('pay1', 'cashier', SETTLE('p1_e')),
      T('pay2', 'cashier', SETTLE('p2_e')),
      PAST_CUTOFF('t1'),
      Q('sweep', `select app.tournament_sweep()`),
      // A window far from the tournament's dates and its cancel: only the money keeps it listed.
      T(
        'list',
        'desk',
        `select app.desk_tournaments({{v}}, now() + interval '20 days', now() + interval '30 days')`,
      ),
      T('due', 'manager', `select app.tournament_refunds_due({{v}})`),
      T('due_desk', 'desk', `select app.tournament_refunds_due({{v}})`),
      T('detail', 'manager', `select app.desk_tournament_detail({{t1}})`),
    ]);
    expect(answer(r, 'sweep')).toMatchObject({ cancelled: 1, errors: 0 });
    expect(tourMissingKeys(answer(r, 'list'), TOURNAMENT_SHAPES.desk_tournaments)).toEqual([]);
    expect(tourMissingKeys(answer(r, 'due'), TOURNAMENT_SHAPES.tournament_refunds_due)).toEqual([]);
    expect(tourMissingKeys(answer(r, 'detail'), TOURNAMENT_SHAPES.desk_tournament_detail)).toEqual(
      [],
    );
    const list = answer<{
      tournaments: Array<{ id: string; status: string; refund_due_iqd: number }>;
    }>(r, 'list');
    expect(list.tournaments).toEqual([
      expect.objectContaining({ status: 'cancelled', refund_due_iqd: 2 * FEE }),
    ]);
    const due = answer<{
      total_iqd: number;
      items: Array<{
        refund_due_iqd: number;
        full_name: string;
        payments: Array<Record<string, unknown>>;
      }>;
    }>(r, 'due');
    expect(due.total_iqd).toBe(2 * FEE);
    expect(due.items).toHaveLength(2);
    for (const it of due.items) {
      expect(it.refund_due_iqd).toBe(FEE);
      expect(it.payments).toEqual([
        expect.objectContaining({ amount_iqd: FEE, refunded_iqd: 0, refundable_iqd: FEE }),
      ]);
    }
    expect(refusal(r, 'due_desk')).toBe('FORBIDDEN');
    const detail = answer<{
      entries: Array<{ payments: Array<{ payment_id: string; tab_id: string }> }>;
    }>(r, 'detail');
    expect(detail.entries.filter((e) => e.payments.length === 1)).toHaveLength(2);
  });

  it('c10: a paid entry back on the waitlist of a full field is due its money once registration closes', () => {
    const r = scenario('tml-c10', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { fee: FEE, count: 4 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 2 }),
      `select pg_temp.field('t1', 4, 'p');`,
      GUEST('w1'),
      T('w1_reg', 'w1', `select app.tournament_register({{t1}})`),
      `select pg_temp.day('day1');`,
      T('pay1', 'cashier', SETTLE('p1_e')),
      // p1 is taken off (w1 takes the place), then comes back: the field is full.
      T('rm', 'desk', `select app.tournament_remove_entry({{p1_e}}, 'cannot come')`),
      KEEP('p1_g', `select guest_id::text from tournament_entries where id = {{p1_e}}::uuid`),
      T('back', 'desk', `select app.tournament_add_entry({{t1}}, {{p1_g}})`),
      Q('open', `select app.tournament_entry_money({{p1_e}}::uuid)`),
      `select pg_temp.close('t1');`,
      Q('closed', `select app.tournament_entry_money({{p1_e}}::uuid)`),
    ]);
    expect(answer(r, 'back')).toMatchObject({ status: 'waitlisted' });
    expect(answer(r, 'open')).toMatchObject({ net_iqd: FEE, owed_iqd: 0, refund_due_iqd: 0 });
    expect(answer(r, 'closed')).toMatchObject({
      entry_status: 'waitlisted',
      net_iqd: FEE,
      owed_iqd: 0,
      refund_due_iqd: FEE,
    });
  });

  it('c41: a tournament refund is capped at refund_due_iqd unless the reason is tournament_goodwill', () => {
    const r = scenario('tml-c41', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { fee: FEE, count: 4 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 4, 'p');`,
      `select pg_temp.day('day1');`,
      T('pay1', 'cashier', SETTLE('p1_e')),
      T('pay2', 'cashier', SETTLE('p2_e')),
      PAY_ID('pay1_id', 'pay1'),
      PAY_ID('pay2_id', 'pay2'),
      // p2 is registered: nothing is due back.
      GRANT,
      T('registered', 'manager', REFUND('pay2_id', 1000, 'tournament_refund')),
      GRANT,
      T('goodwill', 'manager', REFUND('pay2_id', 1000, 'tournament_goodwill')),
      // p1 withdraws: its fee is due, and no more.
      T('rm', 'desk', `select app.tournament_remove_entry({{p1_e}}, 'cannot come')`),
      GRANT,
      T('part', 'manager', REFUND('pay1_id', 10000, 'tournament_refund')),
      GRANT,
      T('rest', 'manager', REFUND('pay1_id', FEE - 10000, 'tournament_refund')),
      Q('m1', `select app.tournament_entry_money({{p1_e}}::uuid)`),
      // p3 paid and did not come: a no-show's fee is kept.
      T('pay3', 'cashier', SETTLE('p3_e')),
      PAY_ID('pay3_id', 'pay3'),
      X(
        `update tournament_entries set status = 'no_show', no_show_at = now() where id = {{p3_e}}::uuid`,
      ),
      GRANT,
      T('no_show', 'manager', REFUND('pay3_id', FEE, 'tournament_refund')),
    ]);
    expect(refusal(r, 'registered')).toBe('REFUND_EXCEEDS_DUE:due 0');
    expect(answer(r, 'goodwill')).toMatchObject({ amount_iqd: 1000 });
    expect(answer(r, 'part')).toMatchObject({ amount_iqd: 10000 });
    expect(answer(r, 'rest')).toMatchObject({ amount_iqd: FEE - 10000 });
    expect(answer(r, 'm1')).toMatchObject({ net_iqd: 0, refund_due_iqd: 0 });
    expect(refusal(r, 'no_show')).toBe('REFUND_EXCEEDS_DUE:due 0');
  });
});

describe.skipIf(!docker)('0310 lifecycle (c40, c24, c25, c28, c29, c39, s0)', () => {
  it('c40: close_branch refuses a live tournament, then entry money still due back', () => {
    const r = scenario('tml-c40', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { fee: FEE, count: 4 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 4, 'p');`,
      `select pg_temp.day('day1');`,
      T('pay1', 'cashier', SETTLE('p1_e')),
      X(`update day_sessions set status = 'closed', closed_at = now() where id = {{day1}}::uuid`),
      T('live', 'owner', `select app.close_branch({{v}})`),
      T('cancel', 'manager', `select app.tournament_cancel({{t1}}, 'rain')`),
      T('money', 'owner', `select app.close_branch({{v}})`),
    ]);
    expect(refusal(r, 'live')).toBe('BRANCH_HAS_BOOKINGS:tournaments');
    expect(answer(r, 'cancel')).toMatchObject({ status: 'cancelled' });
    expect(refusal(r, 'money')).toBe('BRANCH_HAS_BOOKINGS:tournament_money');
  });

  it('c24: tournament_close closes past the cut-off (desk) or early (manager), never under-filled', () => {
    const r = scenario('tml-c24', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { min_entries: 4 }),
      `select pg_temp.field('t1', 3, 'p');`,
      T('early_desk', 'desk', `select app.tournament_close({{t1}})`),
      T('under', 'manager', `select app.tournament_close({{t1}})`),
      `select pg_temp.field('t1', 1, 'q');`,
      PAST_CUTOFF('t1'),
      T('cashier', 'cashier', `select app.tournament_close({{t1}})`),
      T('close', 'desk', `select app.tournament_close({{t1}})`),
      T('again', 'desk', `select app.tournament_close({{t1}})`),
      Q(
        'seeds',
        `select jsonb_agg(seed_no order by seed_no) from tournament_entries where tournament_id = {{t1}}::uuid`,
      ),
      ...ROUNDS('rounds', 't1', 1, 1),
    ]);
    expect(refusal(r, 'early_desk')).toBe('FORBIDDEN:early_close');
    expect(refusal(r, 'under')).toBe('TOURNAMENT_UNDER_FILLED:3/4');
    expect(refusal(r, 'cashier')).toBe('FORBIDDEN');
    expect(answer(r, 'close')).toMatchObject({ status: 'closed', duplicate: false, registered: 4 });
    expect(tourMissingKeys(answer(r, 'close'), TOURNAMENT_SHAPES.tournament_close)).toEqual([]);
    expect(tourMissingKeys(answer(r, 'again'), TOURNAMENT_SHAPES.tournament_close)).toEqual([]);
    expect(answer(r, 'again')).toMatchObject({ status: 'closed', duplicate: true });
    expect(answer(r, 'seeds')).toEqual([1, 2, 3, 4]);
    expect(answer(r, 'rounds')).toMatchObject({ status: 'running' });
  });

  it('c25: a desk add while the tournament is running is refused', () => {
    const r = scenario('tml-c25', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 7, 'p');`,
      `select pg_temp.close('t1');`,
      ...ROUNDS('rounds', 't1', 1, 2),
      GUEST('walkin'),
      T('add', 'desk', `select app.tournament_add_entry({{t1}}, {{walkin}})`),
      T('detail', 'desk', `select app.desk_tournament_detail({{t1}})`),
    ]);
    expect(answer(r, 'rounds')).toMatchObject({ status: 'running' });
    expect(refusal(r, 'add')).toBe('TOURNAMENT_NOT_OPEN:running');
    expect(answer<{ can: Record<string, boolean> }>(r, 'detail').can).toMatchObject({ add: false });
  });

  it('c28/c29: tournament_finish ends at the last complete round and frees its courts, the running block too', () => {
    const r = scenario('tml-c28', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 8, 'p');`,
      `select pg_temp.close('t1');`,
      ...ROUNDS('rounds', 't1', 1, 3),
      T('not_played', 'manager', `select app.tournament_finish({{t1}}, 'out of time')`),
      Q('r1_scored', `select to_jsonb(pg_temp.score_round('t1', 1, 12))`),
      // One match of round 2 scored: round 2 has begun.
      X(`select set_config('request.jwt.claims', '', true)`),
      KEEP(
        'm2',
        `select id::text from tournament_matches where tournament_id = {{t1}}::uuid and round_no = 2
          order by court_id limit 1`,
      ),
      KEEP('m2_rev', `select revision::text from tournament_matches where id = {{m2}}::uuid`),
      T(
        'score_m2',
        'desk',
        `select app.tournament_score({{m2}}, 12::smallint, 12::smallint, {{m2_rev}}, null)`,
      ),
      T('partial', 'manager', `select app.tournament_finish({{t1}}, 'out of time')`),
      // The rest of round 2 scored; round 3 untouched.
      Q('r2_scored', `select to_jsonb(pg_temp.score_round('t1', 2, 12))`),
      // The evening's blocks are running now (moved as postgres, past the guard).
      X(`alter table reservations disable trigger reservations_tournament_guard`),
      X(`update reservations set start_at = now() - interval '1 hour', end_at = now() + interval '2 hours'
          where protocol_run_id = {{r1}}::uuid and block_purpose = 'event'`),
      X(`alter table reservations enable trigger reservations_tournament_guard`),
      T('desk', 'desk', `select app.tournament_finish({{t1}}, 'out of time')`),
      T('no_reason', 'manager', `select app.tournament_finish({{t1}}, ' ')`),
      T('finish', 'manager', `select app.tournament_finish({{t1}}, 'out of time')`),
      T('again', 'manager', `select app.tournament_finish({{t1}}, 'out of time')`),
      Q(
        'blocks',
        `select jsonb_agg(jsonb_build_object('status', status, 'ended', end_at <= now()))
           from reservations where protocol_run_id = {{r1}}::uuid and block_purpose = 'event'`,
      ),
      // The shortened blocks' audit keeps the end_at before the cut.
      Q(
        'shorten_audit',
        `select jsonb_agg(jsonb_build_object(
                  'before_later', (a.before->>'end_at')::timestamptz > (a.after->>'end_at')::timestamptz))
           from audit_log a
           join reservations r on r.id::text = a.entity_id
          where a.action = 'reservation.shorten' and r.protocol_run_id = {{r1}}::uuid`,
      ),
      Q(
        'rounds_left',
        `select jsonb_agg(round_no order by round_no) from tournament_rounds where tournament_id = {{t1}}::uuid`,
      ),
    ]);
    expect(refusal(r, 'not_played')).toBe('TOURNAMENT_FINISH_REFUSED:not_played');
    expect(answer(r, 'score_m2')).toBeTruthy();
    expect(refusal(r, 'partial')).toBe('TOURNAMENT_FINISH_REFUSED:partial_round');
    expect(refusal(r, 'desk')).toBe('FORBIDDEN');
    expect(refusal(r, 'no_reason')).toBe('REASON_REQUIRED');
    expect(answer(r, 'finish')).toMatchObject({
      status: 'finished',
      rounds_planned: 2,
      removed_from_round: 3,
      blocks_released: 4,
    });
    expect(tourMissingKeys(answer(r, 'finish'), TOURNAMENT_SHAPES.tournament_finish)).toEqual([]);
    expect(refusal(r, 'again')).toBe('TOURNAMENT_NOT_OPEN:status');
    expect(answer(r, 'shorten_audit')).toEqual(Array(4).fill({ before_later: true }));
    expect(answer(r, 'blocks')).toEqual(Array(4).fill({ status: 'confirmed', ended: true }));
    expect(answer(r, 'rounds_left')).toEqual([1, 2]);
  });

  it("c39: a cancel that keeps failing no longer holds the sweep's one cancel a tick", () => {
    const r = scenario('tml-c39', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('ra', { days: 3 }),
      RUN('rb', { days: 5 }),
      ...PUBLISH('pub_a', 'ra', 'ta'),
      ...PUBLISH('pub_b', 'rb', 'tb'),
      // Both under-filled past the cut-off; A's cut-off is the earlier.
      X(
        `update tournaments set registration_closes_at = now() - interval '2 minutes' where id = {{ta}}::uuid`,
      ),
      PAST_CUTOFF('tb'),
      X(`create function public.tml_c39_fail() returns trigger language plpgsql as $f$
          begin
            if new.status = 'cancelled' and new.id = (select val::uuid from pg_temp.vars where name = 'ta') then
              raise exception 'tml_c39 forced failure';
            end if;
            return new;
          end $f$`),
      X(
        `create trigger tml_c39_fail before update on tournaments for each row execute function public.tml_c39_fail()`,
      ),
      Q('tick1', `select app.tournament_sweep()`),
      Q('tick2', `select app.tournament_sweep()`),
      Q(
        'state',
        `select jsonb_object_agg(case when id = {{ta}}::uuid then 'a' else 'b' end,
                                 jsonb_build_object('status', status, 'errors', sweep_errors))
           from tournaments where id in ({{ta}}::uuid, {{tb}}::uuid)`,
      ),
    ]);
    expect(answer(r, 'tick1')).toMatchObject({ cancelled: 0, errors: 1 });
    expect(answer(r, 'tick2')).toMatchObject({ cancelled: 1, errors: 0 });
    expect(answer(r, 'state')).toEqual({
      a: { status: 'open', errors: 1 },
      b: { status: 'cancelled', errors: 0 },
    });
  });

  it('s0: the tournament RPCs check the branch before they lock the tournament row', () => {
    const r = scenario('tml-s0', [
      Q(
        'order',
        `select jsonb_object_agg(p.proname,
                  position('for update' in p.prosrc) > greatest(position('VENUE_MISMATCH' in p.prosrc),
                                                                position('TOURNAMENTS_OFF' in p.prosrc)))
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'
            and p.proname in ('tournament_cancel', 'tournament_register', 'tournament_add_entry',
                              'tournament_set_rounds')`,
      ),
    ]);
    expect(answer(r, 'order')).toEqual({
      tournament_cancel: true,
      tournament_register: true,
      tournament_add_entry: true,
      tournament_set_rounds: true,
    });
  });
});
