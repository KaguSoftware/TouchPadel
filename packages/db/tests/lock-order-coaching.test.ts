/**
 * The lock-order gate after coaching_tables (docs/design/coaching/db.md §2.5;
 * build contracts §1.4, R6, R33, R64, D-25).
 *
 * Two halves:
 *   * the walker (scripts/lib/lock-order.mjs) over synthetic catalogs, pure,
 *     always runs: app.lock_coach emits coach_advisory once per sequence, the
 *     try-lock twin never prints, a level B body (coach -> courts -> its court
 *     row -> the reservation trigger) is in order, courts before the coach is
 *     an inversion, and a reservations row taken FOR UPDATE ... SKIP LOCKED
 *     is not a lock (it never waits) while a plain FOR UPDATE on it still is
 *     and a skip-locked match_tickets row still prints;
 *   * the gate over the local stack (stack-gated): it passes, prints the
 *     declared order with coach_advisory after match_money_advisory, and
 *     prints the two coaching_tables primitives as taking nothing ranked of their own.
 *
 * The printed sequences of the coaching RPCs (db.md §2.5's stack list:
 * lesson_book_private, the cancels, lesson_sweep, deposit_apply's lesson arm)
 * join this file in the commits that create them (coaching_admin onward).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyse,
  createWalker,
  ORDER,
  printedSequence,
  SERVICE_WALK,
} from '../scripts/lib/lock-order.mjs';
import { dockerReachable } from './stores-harness';
import { stackAvailable } from './helpers';

const up = await stackAvailable();
const docker = up && dockerReachable();

// ── synthetic bodies, shaped like the real ones ─────────────────────────────
const lock_coach = `begin if p is not null then perform pg_advisory_xact_lock(hashtextextended('app.coaches:' || p::text, 0)); end if; end`;
const try_lock_coach = `begin return pg_try_advisory_xact_lock(hashtextextended('app.coaches:' || p::text, 0)); end`;
const lock_court = `begin perform pg_advisory_xact_lock(hashtextextended('app.reservations:court:' || p, 0)); end`;
const lock_match_venue = `begin perform pg_advisory_xact_lock(hashtextextended('app.matches:venue:' || p, 0)); end`;
const lesson_lock_branch_courts = `begin for v in select c.id from courts c where c.venue_id = p and c.is_active order by c.id
  loop perform app.lock_court(v.id); end loop; end`;
const match_expire_holds = `begin update reservations set status = 'expired'
  where id in (select r.id from reservations r where r.kind = 'hold' order by r.id for update of r); end`;
const ticket_lock = `begin perform 1 from match_tickets where id = any (p) order by id for update;
  update match_tickets set status = 'in_use' where id = t; end`;
// 0263's trigger, part A: the mutex, then the tickets it moves (never for a lesson row at run time).
const trg_reservation_match = `begin perform app.lock_match_venue(v); perform app.ticket_lock(a, b); end`;
// R25 / R64: the one statement that ends a held lesson's court hold. It never waits.
const lesson_court_release = `begin
  update reservations set status = 'expired'
   where id in (select id from reservations
                 where lesson_id = p and kind = 'hold' and status = 'pending'
                 for update skip locked);
end`;

const BASE = [
  { name: 'lock_coach', src: lock_coach },
  { name: 'try_lock_coach', src: try_lock_coach },
  { name: 'lock_court', src: lock_court },
  { name: 'lock_match_venue', src: lock_match_venue },
  { name: 'lesson_lock_branch_courts', src: lesson_lock_branch_courts },
  { name: 'match_expire_holds', src: match_expire_holds },
  { name: 'ticket_lock', src: ticket_lock },
  { name: 'trg_reservation_match', src: trg_reservation_match },
  { name: 'lesson_court_release', src: lesson_court_release },
];
const TRIGGER = [{ tbl: 'reservations', fn: 'trg_reservation_match' }];

const LEVEL_B =
  'coach_advisory -> court_advisory -> reservations -> match_venue_advisory -> match_tickets';

describe('the walker over synthetic coaching catalogs (pure)', () => {
  it('ranks coach_advisory right after match_money_advisory and before tabs', () => {
    expect(ORDER.indexOf('coach_advisory')).toBe(ORDER.indexOf('match_money_advisory') + 1);
    expect(ORDER.indexOf('coach_advisory')).toBe(ORDER.indexOf('tabs') - 1);
    expect(SERVICE_WALK).toEqual(
      expect.arrayContaining([
        'lesson_sweep',
        'lesson_settle_success',
        'lesson_payment_prepare',
        'coach_statements_draft',
      ]),
    );
  });

  it('a call to app.lock_coach is coach_advisory, and only its first one in a sequence counts', () => {
    const fns = [
      ...BASE,
      { name: 'once', src: 'begin perform app.lock_coach(c); end' },
      {
        name: 'twice',
        src: 'begin perform app.lock_coach(c); select 1 from tabs where id = t for update; perform app.lock_coach(c); end',
      },
    ];
    const w = createWalker({ fns, triggers: [] });
    expect(printedSequence(w, 'once')).toEqual(['coach_advisory']);
    // The raw walk sees both calls; the printed one keeps the first (a re-grant is not a new lock).
    expect(w.sequence('twice')).toEqual(['coach_advisory', 'tabs', 'coach_advisory']);
    expect(printedSequence(w, 'twice')).toEqual(['coach_advisory', 'tabs']);
    expect(analyse({ fns, triggers: [], callable: ['twice'] }).violations).toEqual([]);
  });

  it('never emits app.try_lock_coach: it never waits', () => {
    const fns = [
      ...BASE,
      { name: 'sweepish', src: 'begin if not app.try_lock_coach(c) then return; end if; end' },
    ];
    const w = createWalker({ fns, triggers: [] });
    expect(printedSequence(w, 'try_lock_coach')).toEqual([]);
    expect(printedSequence(w, 'sweepish')).toEqual([]);
  });

  it('level B (a booking): coach -> every court -> its court row and the stale holds -> the trigger, in order', () => {
    const book = `begin
      perform app.lock_coach(c);
      v := app.lesson_lock_branch_courts(b);
      perform app.match_expire_holds(b, x);
      insert into reservations (id, kind, lesson_id) values (r, 'lesson', l);
    end`;
    const fns = [...BASE, { name: 'lesson_book_private', src: book }];
    const out = analyse({ fns, triggers: TRIGGER, callable: ['lesson_book_private'] });
    expect(out.violations).toEqual([]);
    expect(out.rows).toEqual([{ fn: 'lesson_book_private', seq: LEVEL_B.split(' -> ') }]);
  });

  it('a court key taken before the coach is an inversion', () => {
    const fns = [
      ...BASE,
      { name: 'wrong', src: 'begin perform app.lock_court(c); perform app.lock_coach(k); end' },
      {
        name: 'tab_first',
        src: 'begin select 1 from tabs where id = t for update; perform app.lock_coach(k); end',
      },
    ];
    const out = analyse({ fns, triggers: [], callable: ['wrong', 'tab_first'] });
    expect(out.violations.join('\n')).toMatch(/wrong: takes court_advisory before coach_advisory/);
    expect(out.violations.join('\n')).toMatch(/tab_first: takes tabs before coach_advisory/);
  });

  it('a reservations row taken FOR UPDATE ... SKIP LOCKED is not a lock; a plain FOR UPDATE on it still is', () => {
    const fns = [
      ...BASE,
      {
        name: 'skip',
        src: 'begin perform 1 from reservations r where r.lesson_id = l for update skip locked; end',
      },
      {
        name: 'skip_of',
        src: 'begin perform 1 from reservations r where r.lesson_id = l for update of r skip locked; end',
      },
      {
        name: 'plain',
        src: 'begin perform 1 from reservations r where r.lesson_id = l for update; end',
      },
      {
        name: 'plain_of',
        src: 'begin perform 1 from reservations r where r.lesson_id = l for update of r; end',
      },
      // Only reservations: a skip-locked match_tickets row prints as before (0264).
      {
        name: 'tickets_skip',
        src: 'begin select 1 from match_tickets k where k.guest_id = g for update skip locked; end',
      },
    ];
    const w = createWalker({ fns, triggers: [] });
    expect(printedSequence(w, 'skip')).toEqual([]);
    expect(printedSequence(w, 'skip_of')).toEqual([]);
    expect(printedSequence(w, 'plain')).toEqual(['reservations']);
    expect(printedSequence(w, 'plain_of')).toEqual(['reservations']);
    expect(printedSequence(w, 'tickets_skip')).toEqual(['match_tickets']);
  });

  it('level C (a cancel): coach, then status-only writes and the skip-locked hold release, no court key, no violation', () => {
    // The status update still expands the reservation trigger (the walker ignores WHEN): at run
    // time part B returns at once for a row leaving the live set (db.md §2.5).
    const cancel = `begin
      perform app.lock_coach(c);
      update lessons set status = 'cancelled' where id = l;
      update reservations set status = 'cancelled' where lesson_id = l and kind = 'lesson' and status in ('pending', 'confirmed', 'arrived');
      perform app.lesson_court_release(l);
    end`;
    // Reaching the release twice (a course's sessions) is not a Rule 1 inversion either.
    const twice = `begin perform app.lock_coach(c); perform app.lesson_court_release(a); perform app.lesson_court_release(b); end`;
    const fns = [
      ...BASE,
      { name: 'coach_cancel_lesson', src: cancel },
      { name: 'course_cancelish', src: twice },
    ];
    const out = analyse({
      fns,
      triggers: TRIGGER,
      callable: ['coach_cancel_lesson', 'course_cancelish'],
    });
    expect(out.violations).toEqual([]);
    expect(out.rows).toEqual([
      {
        fn: 'coach_cancel_lesson',
        seq: ['coach_advisory', 'match_venue_advisory', 'match_tickets'],
      },
      { fn: 'course_cancelish', seq: ['coach_advisory', 'match_venue_advisory', 'match_tickets'] },
    ]);
  });

  it('without the skip-locked rule the same cancel would break Rules 1 and 3 (the reason for the rule)', () => {
    const plainRelease = lesson_court_release.replace('for update skip locked', 'for update');
    const fns = [
      ...BASE.filter((f) => f.name !== 'lesson_court_release'),
      { name: 'lesson_court_release', src: plainRelease },
      {
        name: 'course_cancelish',
        src: 'begin perform app.lock_coach(c); perform app.lesson_court_release(a); perform app.lesson_court_release(b); end',
      },
    ];
    const out = analyse({ fns, triggers: TRIGGER, callable: ['course_cancelish'] });
    const text = out.violations.join('\n');
    expect(text).toMatch(
      /course_cancelish: locks reservations without ever calling app\.lock_court\(\)/,
    );
    expect(text).toMatch(/course_cancelish: takes match_tickets before reservations/);
  });

  it('walks a coaching service-role name once it exists, and skips it until then', () => {
    expect(analyse({ fns: BASE, triggers: [], callable: [] }).walked).toEqual([]);
    const fns = [
      ...BASE,
      {
        name: 'lesson_sweep',
        src: 'begin perform app.lock_coach(c); if app.try_lock_coach(d) then null; end if; end',
      },
    ];
    const out = analyse({ fns, triggers: [], callable: [] });
    expect(out.walked).toEqual(['lesson_sweep']);
    expect(out.rows).toEqual([{ fn: 'lesson_sweep', seq: ['coach_advisory'] }]);
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

describe.skipIf(!docker)('check:locks over the local stack (coaching_tables)', () => {
  it('passes, ranks coach_advisory after match_money_advisory, and prints the two primitives as lock-free', () => {
    const gate = runGate(['lock_coach', 'try_lock_coach']);
    expect(gate.code, gate.out).toBe(0);
    expect(gate.out).toContain(`declared order: ${ORDER.join(' > ')}`);
    expect(gate.out).toContain('match_money_advisory > coach_advisory > tabs');
    expect(gate.out).toContain('no lock-order violations');
    const internal = gate.out.slice(gate.out.indexOf('internal sequences'));
    // The advisory call is the lock; its own body (pg_advisory_xact_lock) and
    // the try-lock twin print nothing.
    expect(rowOf(internal, 'lock_coach')).toBe('(no locks)');
    expect(rowOf(internal, 'try_lock_coach')).toBe('(no locks)');
    // Neither is client-callable, so neither is walked as a row of its own.
    const walkedRows = gate.out.slice(0, gate.out.indexOf('internal sequences'));
    expect(rowOf(walkedRows, 'lock_coach')).toBeUndefined();
    expect(rowOf(walkedRows, 'try_lock_coach')).toBeUndefined();
  });
});
