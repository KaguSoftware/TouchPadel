/**
 * The lock-order gate after open matches (0260; docs/design/open-matches/db.md
 * §2.5–§2.7, build contracts §1.4, R8, R15, R19).
 *
 * Two halves:
 *   * the walker (scripts/lib/lock-order.mjs) over synthetic catalogs, pure,
 *     always runs: the two advisory keys, the once-per-sequence rule, the
 *     service-role walk list, match_tickets never read as the KDS `tickets`,
 *     a locking sub-select closed by its parenthesis, and the R15 shapes
 *     (match_lock's order; the deposit hoist) with the 0263 trigger stood in;
 *   * the gate over the local stack (stack-gated): it passes, prints the
 *     declared order of §2.1, walks Money's service-role paths, and prints the
 *     sequences of the 0260 internals that every later body is built from.
 *
 * The guest RPCs of 0261 and the desk and seat-money RPCs of 0262 are printed
 * as db.md §2.5 and money.md §8 declare them (match_join is the R15 fixture
 * row of §2.6). 0263 adds the reservation trigger: deposit_apply (the R15
 * fixture row of §2.6), the sweep and every reservations writer print their
 * §2.5 sequences. 0265's day close card and reports take no lock at all.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyse, createWalker, oncePerSequence, ORDER, printedSequence, SERVICE_WALK } from '../scripts/lib/lock-order.mjs';
import { dockerReachable } from './stores-harness';
import { stackAvailable } from './helpers';

const up = await stackAvailable();
const docker = up && dockerReachable();

/** The order of db.md §2.1 / contracts §1.4, verbatim; coach_advisory since coaching_tables (coaching db.md §2.1). */
const DECLARED = [
  'day_sessions', 'match_money_advisory', 'coach_advisory', 'tabs', 'orders', 'order_items', 'tickets', 'payments',
  'till_shifts', 'refunds', 'stock_batches', 'court_advisory', 'reservations', 'match_venue_advisory', 'match_tickets',
];

// ── synthetic bodies, shaped like the real ones ─────────────────────────────
const lock_court = `begin perform pg_advisory_xact_lock(hashtextextended('app.reservations:court:' || p, 0)); end`;
const lock_match_venue = `begin perform pg_advisory_xact_lock(hashtextextended('app.matches:venue:' || p, 0)); end`;
const lock_match_money = `begin perform pg_advisory_xact_lock(hashtextextended('app.matches:money:' || p, 0)); end`;
const try_lock_match_venue = `begin if not pg_try_advisory_xact_lock(hashtextextended('app.matches:venue:' || p, 0)) then return false; end if; return true; end`;
const match_lock_courts = `begin for v in select c.id from courts c order by c.id loop perform app.lock_court(v.id); end loop; end`;
const match_expire_holds = `begin update reservations set status = 'expired'
  where id in (select r.id from reservations r where r.kind = 'hold' order by r.id for update of r); end`;
const match_lock = `begin
  select venue_id into v from matches where id = p;
  perform app.match_lock_courts(v);
  perform 1 from reservations where id = r for update;
  perform app.match_expire_holds(v, x);
  perform app.lock_match_venue(v);
end`;
const ticket_pick = `begin
  select array_agg(x.id) into v from (select k.id from match_tickets k where k.guest_id = p order by k.id for update) x;
end`;
const ticket_lock = `begin perform 1 from match_tickets where id = any (p) order by id for update;
  update match_tickets set status = 'in_use' where id = t; end`;
// 0263's trigger, part A: the mutex, then the tickets it moves.
const trg_reservation_match = `begin perform app.lock_match_venue(v); perform app.ticket_lock(a, b); end`;

const BASE = [
  { name: 'lock_court', src: lock_court },
  { name: 'lock_match_venue', src: lock_match_venue },
  { name: 'lock_match_money', src: lock_match_money },
  { name: 'try_lock_match_venue', src: try_lock_match_venue },
  { name: 'match_lock_courts', src: match_lock_courts },
  { name: 'match_expire_holds', src: match_expire_holds },
  { name: 'match_lock', src: match_lock },
  { name: 'ticket_pick', src: ticket_pick },
  { name: 'ticket_lock', src: ticket_lock },
];

describe('the walker over synthetic catalogs (pure)', () => {
  it('declares the order of db.md §2.1', () => {
    expect(ORDER).toEqual(DECLARED);
    expect(SERVICE_WALK).toEqual([
      'match_sweep', 'deposit_apply', 'ticket_settle_success', 'ticket_refund_deleted', 'tickets_cash_out', 'expire_stale_holds',
      // Coaching (coaching_tables, R33): walked once each exists.
      'lesson_sweep', 'lesson_settle_success', 'lesson_payment_prepare', 'coach_statements_draft',
    ]);
  });

  it('match_lock (R15): courts -> the booking row -> hold expiry -> the mutex', () => {
    const w = createWalker({ fns: BASE, triggers: [] });
    expect(printedSequence(w, 'match_lock')).toEqual(['court_advisory', 'reservations', 'match_venue_advisory']);
    // L2+M: the money lock first.
    const w2 = createWalker({
      fns: [...BASE, { name: 'mark_match_seats', src: 'begin perform app.lock_match_money(m); perform app.match_lock(m); end' }],
      triggers: [],
    });
    expect(printedSequence(w2, 'mark_match_seats')).toEqual([
      'match_money_advisory', 'court_advisory', 'reservations', 'match_venue_advisory',
    ]);
  });

  it('never emits a try-lock: it never waits', () => {
    const w = createWalker({ fns: BASE, triggers: [] });
    expect(printedSequence(w, 'try_lock_match_venue')).toEqual([]);
    const w2 = createWalker({
      fns: [...BASE, { name: 'bump', src: 'begin if not app.try_lock_match_venue(v) then return; end if; perform app.ticket_lock(a, b); end' }],
      triggers: [],
    });
    expect(printedSequence(w2, 'bump')).toEqual(['match_tickets']);
  });

  it('counts each advisory key once per sequence (db.md §2.6 rule 3)', () => {
    // An L2 body books a court: the reservation trigger takes the mutex again,
    // then tickets; the body then locks tickets itself. Without the rule the
    // sequence reads match_tickets -> match_venue_advisory.
    const fns = [
      ...BASE,
      { name: 'trg_reservation_match', src: trg_reservation_match },
      {
        name: 'match_join',
        src: `begin perform app.match_lock(m); v := app.ticket_pick(g, 1, false);
              insert into reservations (id) values (x); perform app.lock_match_venue(v); end`,
      },
    ];
    const triggers = [{ tbl: 'reservations', fn: 'trg_reservation_match' }];
    const w = createWalker({ fns, triggers });
    const raw = w.sequence('match_join');
    expect(raw.filter((t) => t === 'match_venue_advisory').length).toBeGreaterThan(1);
    expect(printedSequence(w, 'match_join')).toEqual([
      'court_advisory', 'reservations', 'match_venue_advisory', 'match_tickets',
    ]);
    expect(oncePerSequence(['match_money_advisory', 'tabs', 'match_money_advisory'])).toEqual(['match_money_advisory', 'tabs']);
    const out = analyse({ fns, triggers, callable: ['match_join'] });
    expect(out.violations).toEqual([]);
  });

  it('reads `from match_tickets` as match_tickets, never as the KDS tickets', () => {
    const fns = [
      { name: 'kds', src: 'begin select 1 from tickets t where t.id = p for update of t; end' },
      { name: 'pick', src: 'begin select 1 from match_tickets t where t.id = p for update of t; update match_tickets set status = x where id = p; end' },
      { name: 'trg_ticket_consume', src: 'begin select 1 from stock_batches b where b.id = p for update; end' },
    ];
    // A write to the KDS tickets table fires its trigger; one to match_tickets must not.
    const triggers = [{ tbl: 'tickets', fn: 'trg_ticket_consume' }];
    const w = createWalker({ fns, triggers });
    expect(printedSequence(w, 'kds')).toEqual(['tickets']);
    expect(printedSequence(w, 'pick')).toEqual(['match_tickets']);
  });

  it('sees a locking sub-select closed by its parenthesis (`for update) x`)', () => {
    const w = createWalker({ fns: BASE, triggers: [] });
    expect(printedSequence(w, 'ticket_pick')).toEqual(['match_tickets']);
  });

  it('walks the service-role list, and skips a name that does not exist yet', () => {
    const fns = [
      ...BASE,
      { name: 'ticket_refund_deleted', src: 'begin select 1 from match_tickets where x for update skip locked; end' },
    ];
    const out = analyse({ fns, triggers: [], callable: [] });
    expect(out.walked).toEqual(['ticket_refund_deleted']);
    expect(out.rows).toEqual([{ fn: 'ticket_refund_deleted', seq: ['match_tickets'] }]);
  });

  it('R15 / C1: a reservations write before the hold expiry inverts once the trigger exists; the hoist passes', () => {
    const trigger = [{ tbl: 'reservations', fn: 'trg_reservation_match' }];
    const common = [
      ...BASE,
      { name: 'trg_reservation_match', src: trg_reservation_match },
      { name: 'expire_stale_holds', src: match_expire_holds },
    ];
    // The 0242 shape: an in-place update of the booking, then the hold expiry.
    const before = `begin perform app.lock_court(c); perform 1 from reservations where id = h for update;
      update reservations set kind = 'booking' where id = h; perform app.expire_stale_holds(c, p); end`;
    // 0258's hoist: the hold expiry before the first reservations write.
    const hoisted = `begin perform app.lock_court(c); perform 1 from reservations where id = h for update;
      perform app.expire_stale_holds(c, p); update reservations set kind = 'booking' where id = h; end`;
    const bad = analyse({ fns: [...common, { name: 'deposit_settle_success', src: before }], triggers: trigger, callable: ['deposit_settle_success'] });
    const good = analyse({ fns: [...common, { name: 'deposit_settle_success', src: hoisted }], triggers: trigger, callable: ['deposit_settle_success'] });
    // The expiry after the mutex+tickets re-takes reservations: an inversion.
    expect(bad.violations.join('\n')).toMatch(/deposit_settle_success: takes match_tickets before reservations/);
    expect(good.violations).toEqual([]);
    // 0268: expire_stale_holds is on the service-role walk (the cron) now that no client may call it.
    expect(good.rows).toEqual([
      { fn: 'deposit_settle_success', seq: ['court_advisory', 'reservations', 'match_venue_advisory', 'match_tickets'] },
      { fn: 'expire_stale_holds', seq: ['reservations', 'match_venue_advisory', 'match_tickets'] },
    ]);
  });

  it('still catches an inversion across the new ranks', () => {
    const fns = [
      ...BASE,
      { name: 'wrong', src: 'begin perform app.lock_match_venue(v); perform app.match_lock_courts(v); end' },
      { name: 'money_late', src: 'begin select 1 from tabs where id = t for update; perform app.lock_match_money(m); end' },
    ];
    const out = analyse({ fns, triggers: [], callable: ['wrong', 'money_late'] });
    expect(out.violations.join('\n')).toMatch(/wrong: takes match_venue_advisory before court_advisory/);
    expect(out.violations.join('\n')).toMatch(/money_late: takes tabs before match_money_advisory/);
  });
});

// ── the gate over the local stack ────────────────────────────────────────────
const SCRIPT = path.resolve(import.meta.dirname, '../scripts/check-lock-order.mjs');
const INTERNALS = [
  'match_lock', 'match_lock_courts', 'match_expire_holds', 'try_lock_match_venue', 'lock_match_venue', 'lock_match_money',
  'ticket_pick', 'ticket_lock', 'ticket_release', 'ticket_forfeit', 'ticket_restore',
  'match_try_book', 'match_end', 'match_drop_ineligible', 'match_recompute_organiser',
  'trg_reservation_match', 'match_court_claimed',
];

function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, `--show=${INTERNALS.join(',')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** The printed sequence of one row, or undefined when the function is not printed. */
function rowOf(out: string, fn: string): string | undefined {
  const line = out.split('\n').find((l) => l.trimStart().startsWith(`${fn} `) && l.startsWith('  '));
  return line?.trim().slice(fn.length).trim();
}

describe.skipIf(!docker)('check:locks over the local stack (0260, 0261, 0262, 0263, 0265)', () => {
  let gate: { code: number; out: string };

  it('passes and prints the declared order of db.md §2.1', () => {
    gate = runGate();
    expect(gate.code, gate.out).toBe(0);
    expect(gate.out).toContain(`declared order: ${DECLARED.join(' > ')}`);
    expect(gate.out).toContain('no lock-order violations');
  });

  it("walks Money's service-role paths (R8): tickets only, after the deposit locks", () => {
    gate ??= runGate();
    // 0284 (R33): a lesson row's coach first, then the courts, the rows, the trigger.
    expect(rowOf(gate.out, 'deposit_apply')).toBe('coach_advisory -> court_advisory -> reservations -> match_venue_advisory -> match_tickets');
    for (const fn of ['ticket_settle_success', 'ticket_refund_deleted', 'tickets_cash_out']) {
      expect(rowOf(gate.out, fn), fn).toBe('match_tickets');
    }
  });

  it('prints the 0260 internals in the order every later body builds on (§2.2, §2.4)', () => {
    gate ??= runGate();
    const internal = gate.out.slice(gate.out.indexOf('internal sequences'));
    // 0263: match_expire_holds' update expands the reservation trigger.
    expect(rowOf(internal, 'match_lock')).toBe('court_advisory -> reservations -> match_venue_advisory -> match_tickets');
    expect(rowOf(internal, 'match_lock_courts')).toBe('court_advisory');
    expect(rowOf(internal, 'match_expire_holds')).toBe('reservations -> match_venue_advisory -> match_tickets');
    expect(rowOf(internal, 'lock_match_venue')).toBe('(no locks)');
    expect(rowOf(internal, 'lock_match_money')).toBe('(no locks)');
    expect(rowOf(internal, 'try_lock_match_venue')).toBe('(no locks)');
    for (const fn of ['ticket_pick', 'ticket_lock', 'ticket_release', 'ticket_forfeit', 'ticket_restore',
                      'match_end', 'match_drop_ineligible', 'match_recompute_organiser']) {
      expect(rowOf(internal, fn), fn).toBe('match_tickets');
    }
    // The booking insert expands the reservation trigger (0263). Internal and never walked: every
    // caller already holds L2 or the sweep's lock, so the trigger's mutex is a re-grant there.
    expect(rowOf(internal, 'match_try_book')).toBe('match_tickets -> match_venue_advisory -> match_tickets');
  });

  it('0261: match_join prints courts -> its booking row and the stale holds -> the mutex -> tickets (§2.5, R15)', () => {
    gate ??= runGate();
    expect(rowOf(gate.out, 'match_join')).toBe('court_advisory -> reservations -> match_venue_advisory -> match_tickets');
  });

  it('0261: every guest write prints its §2.5 level (LS and L2 through the courts, L1 the mutex alone)', () => {
    gate ??= runGate();
    const L2 = 'court_advisory -> reservations -> match_venue_advisory -> match_tickets';
    const L1 = 'match_venue_advisory -> match_tickets';
    // match_decide: its approve branch (L2) is written before its decline (L1).
    for (const fn of ['match_start', 'match_decide']) expect(rowOf(gate.out, fn), fn).toBe(L2);
    for (const fn of ['match_request', 'match_withdraw', 'match_leave', 'match_remove_player', 'match_cancel']) {
      expect(rowOf(gate.out, fn), fn).toBe(L1);
    }
    // Reads, messages, reports and blocks take nothing ranked.
    for (const fn of ['match_quote', 'open_matches', 'match_detail', 'my_matches', 'my_match_blocks', 'match_slots',
                      'match_invite', 'match_post_message', 'match_report', 'match_block', 'match_unblock']) {
      expect(rowOf(gate.out, fn), fn).toBeUndefined();
    }
  });

  it('0262: the desk writes print their §2.5 level, the money lock first where seat money can move (R19)', () => {
    gate ??= runGate();
    const L2M = 'match_money_advisory -> court_advisory -> reservations -> match_venue_advisory -> match_tickets';
    for (const fn of ['desk_add_seat', 'mark_match_seats', 'desk_call_off_short']) expect(rowOf(gate.out, fn), fn).toBe(L2M);
    expect(rowOf(gate.out, 'desk_remove_seat')).toBe('match_money_advisory -> match_venue_advisory -> match_tickets');
    expect(rowOf(gate.out, 'desk_cancel_match')).toBe('match_venue_advisory -> match_tickets');
    // A desk start seats walk-ins and nameless extras: no ticket of its own; since 0263 its
    // stale-hold expiry expands the reservation trigger (db.md §2.5).
    expect(rowOf(gate.out, 'desk_start_match')).toBe('court_advisory -> reservations -> match_venue_advisory -> match_tickets');
    // Money's writers (money.md §8): Take share and Assign reach the till's tabs
    // under the money lock; the write-off reads the match under match_lock.
    for (const fn of ['match_seat_settle', 'match_link_payment']) {
      expect(rowOf(gate.out, fn), fn).toBe('match_money_advisory -> tabs');
    }
    // Since 0263 the stale-hold expiry under match_lock expands the reservation trigger.
    expect(rowOf(gate.out, 'match_seat_write_off'))
      .toBe('match_money_advisory -> court_advisory -> reservations -> match_venue_advisory -> match_tickets');
    // A status-only writer (the gate's rule 3): the row, then the trigger's part A (0263).
    expect(rowOf(gate.out, 'mark_reservation')).toBe('reservations -> match_venue_advisory -> match_tickets');
    for (const fn of ['desk_open_matches', 'desk_match_states', 'desk_match_detail', 'set_match_ban',
                      'staff_set_customer_gender', 'match_reports_open', 'resolve_match_report']) {
      expect(rowOf(gate.out, fn), fn).toBeUndefined();
    }
  });

  it('0263, 0284: deposit_apply prints the coach -> courts -> its rows -> the mutex -> tickets with the reservation trigger (R15, R33)', () => {
    gate ??= runGate();
    expect(rowOf(gate.out, 'deposit_apply')).toBe(
      'coach_advisory -> court_advisory -> reservations -> match_venue_advisory -> match_tickets',
    );
  });

  it('0263: the sweep and every reservations writer print in order with the trigger expanded (§2.5)', () => {
    gate ??= runGate();
    const LS = 'court_advisory -> reservations -> match_venue_advisory -> match_tickets';
    for (const fn of ['match_sweep', 'hold_slot', 'staff_create_reservation', 'move_reservation', 'extend_reservation',
                      'create_series', 'block_courts_for_event']) {
      expect(rowOf(gate.out, fn), fn).toBe(LS);
    }
    // Status-only writers (the gate's rule 3 exemption): the row, then the trigger's part A.
    for (const fn of ['cancel_reservation', 'cancel_series', 'confirm_booking', 'mark_reservation', 'release_hold',
                      'expire_stale_holds']) {
      expect(rowOf(gate.out, fn), fn).toBe('reservations -> match_venue_advisory -> match_tickets');
    }
    // delete_my_account's reservations scrub expands the trigger statically; at run time it
    // touches none of the watched columns, so the trigger never fires there (db.md §2.5).
    // 0264's ticket_refund_deleted adds only match_tickets (skip locked): no match or court
    // lock (R25).
    expect(rowOf(gate.out, 'delete_my_account')).toBe('match_venue_advisory -> match_tickets');
    const internal = gate.out.slice(gate.out.indexOf('internal sequences'));
    // Part A waits for the mutex, part B only try-locks it (never emitted).
    expect(rowOf(internal, 'trg_reservation_match')).toBe('match_venue_advisory -> match_tickets');
    expect(rowOf(internal, 'match_court_claimed')).toBe('(no locks)');
  });

  it('0265: the day close card and the reports only read (money.md §8)', () => {
    gate ??= runGate();
    for (const fn of ['day_close_online', 'report_matches', 'report_courts', 'panel_headline', 'unpaid_played_bookings']) {
      expect(rowOf(gate.out, fn), fn).toBeUndefined();
    }
  });
});
