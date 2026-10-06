/**
 * The lock-order gate after the tournaments migrations (docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.4, §1.12 S8; plan §7 DB-B).
 *
 * The walker ranks only its ORDER list (scripts/lib/lock-order.mjs); the five tournament tables
 * are unranked, so nothing joins ORDER and every tournament body says its order in its header.
 * What is pinned here:
 *
 *   * the walker, pure: releasing blocks is courts then the reservations write (the 0174 pair);
 *     two releases in one body would put the reservations trigger's mutex and tickets before a
 *     second court lock, an inversion. That is why the sweep cancels at most one tournament per
 *     tick and its finish releases nothing (every block has started by ends_at + 6 h);
 *   * the gate over the local stack (stack-gated): it passes; the printed sequences of the
 *     tournament RPCs are the ones §1.4 declares; the sweep is on the service-role walk list.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyse,
  createWalker,
  printedSequence,
  SERVICE_WALK,
} from '../scripts/lib/lock-order.mjs';
import { stackAvailable } from './helpers';
import { dockerReachable } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

// ── synthetic bodies, shaped like the real ones ─────────────────────────────
const lock_court = `begin perform pg_advisory_xact_lock(hashtextextended('app.reservations:court:' || p, 0)); end`;
const lock_match_venue = `begin perform pg_advisory_xact_lock(hashtextextended('app.matches:venue:' || p, 0)); end`;
const ticket_lock = `begin perform 1 from match_tickets where id = any (p) order by id for update; end`;
const trg_reservation_match = `begin perform app.lock_match_venue(v); perform app.ticket_lock(a, b); end`;
// tournament_release_blocks: the courts in court-id order, then the status write.
const tournament_release_blocks = `begin
  for v in select distinct r.court_id from reservations r where r.protocol_run_id = x order by 1
  loop perform app.lock_court(v); end loop;
  for v_res in update reservations r set status = 'cancelled' where r.protocol_run_id = x returning r.*
  loop perform app.write_audit('reservation.cancel'); end loop;
end`;
const BASE = [
  { name: 'lock_court', src: lock_court },
  { name: 'lock_match_venue', src: lock_match_venue },
  { name: 'ticket_lock', src: ticket_lock },
  { name: 'trg_reservation_match', src: trg_reservation_match },
  { name: 'tournament_release_blocks', src: tournament_release_blocks },
];
const TRIGGER = [{ tbl: 'reservations', fn: 'trg_reservation_match' }];

describe('the walker over synthetic tournament catalogs (pure)', () => {
  it('a release is the courts, then the reservations trigger', () => {
    const w = createWalker({ fns: BASE, triggers: TRIGGER });
    expect(printedSequence(w, 'tournament_release_blocks')).toEqual([
      'court_advisory',
      'match_venue_advisory',
      'match_tickets',
    ]);
  });

  it('one release per body is in order; two would invert (why the sweep cancels one per tick)', () => {
    const one = {
      name: 'sweepish',
      src: `begin select 1 from tournaments for update skip locked; perform app.tournament_release_blocks(t); end`,
    };
    const ok = analyse({ fns: [...BASE, one], triggers: TRIGGER, callable: ['sweepish'] });
    expect(ok.violations).toEqual([]);
    const two = {
      name: 'sweepish',
      src: `begin perform app.tournament_release_blocks(t); perform app.tournament_release_blocks(u); end`,
    };
    const bad = analyse({ fns: [...BASE, two], triggers: TRIGGER, callable: ['sweepish'] });
    expect(bad.violations.join('\n')).toMatch(
      /sweepish: takes match_tickets before court_advisory/,
    );
  });

  it('walks the sweep as a service-role path', () => {
    expect(SERVICE_WALK).toContain('tournament_sweep');
  });
});

// ── the gate over the local stack ────────────────────────────────────────────
const SCRIPT = path.resolve(import.meta.dirname, '../scripts/check-lock-order.mjs');

function runGate(show: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, `--show=${show.join(',')}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** The printed sequence of one row, or undefined when the function is not printed. */
function rowOf(out: string, fn: string): string | undefined {
  const line = out
    .split('\n')
    .find((l) => l.trimStart().startsWith(`${fn} `) && l.startsWith('  '));
  return line?.trim().slice(fn.length).trim();
}

describe.skipIf(!docker)('check:locks over the local stack (tournaments)', () => {
  it('passes and prints the §1.4 orders of the tournament RPCs', () => {
    const gate = runGate([
      'tournament_release_blocks',
      'tournament_cancel_internal',
      'tournament_promote_internal',
      'tournament_notify',
      'trg_tournament_block_guard',
    ]);
    expect(gate.code, gate.out).toBe(0);
    expect(gate.out).toContain('no lock-order violations');
    const walked = gate.out.slice(0, gate.out.indexOf('internal sequences'));
    const internal = gate.out.slice(gate.out.indexOf('internal sequences'));
    // Loyalty 0308 (c5): a cancel refunds online money, so the deferred earn/clawback trigger on
    // booking_payments takes loyalty_accounts at commit.
    const RELEASE = 'court_advisory -> match_venue_advisory -> match_tickets -> loyalty_accounts';
    // publish: the courts, then the adopted blocks FOR UPDATE.
    expect(rowOf(walked, 'tournament_publish')).toBe('court_advisory -> reservations');
    // cancel, the finishing score and the sweep's cut-off cancel: the release.
    expect(rowOf(walked, 'tournament_cancel')).toBe(RELEASE);
    expect(rowOf(walked, 'tournament_score')).toBe(RELEASE);
    expect(rowOf(walked, 'tournament_sweep')).toBe(RELEASE);
    // settle: the till only (day_sessions share and the tournament/entry rows are unranked), then,
    // at commit, the deferred loyalty earn trigger on the settled tab (0305).
    expect(rowOf(walked, 'tournament_settle')).toBe('tabs -> loyalty_accounts');
    // block_courts_for_event keeps 0174's order.
    expect(rowOf(walked, 'block_courts_for_event')).toBe(
      'court_advisory -> reservations -> match_venue_advisory -> match_tickets -> loyalty_accounts',
    );
    // Entries, rounds, no-shows and the reads take nothing ranked.
    for (const fn of [
      'tournament_register',
      'tournament_withdraw',
      'tournament_add_entry',
      'tournament_remove_entry',
      'tournament_set_rounds',
      'tournament_mark_no_show',
      'set_tournaments_enabled',
      'desk_tournaments',
      'desk_tournament_detail',
      'tournaments_public',
      'tournament_public',
    ]) {
      expect(rowOf(walked, fn), fn).toBeUndefined();
    }
    expect(rowOf(internal, 'tournament_release_blocks')).toBe(RELEASE);
    expect(rowOf(internal, 'tournament_cancel_internal')).toBe(RELEASE);
    expect(rowOf(internal, 'tournament_promote_internal')).toBe('(no locks)');
    expect(rowOf(internal, 'tournament_notify')).toBe('(no locks)');
    expect(rowOf(internal, 'trg_tournament_block_guard')).toBe('(no locks)');
  });
});
