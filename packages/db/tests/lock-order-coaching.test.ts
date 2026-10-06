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
 * lesson_online_payment (0284, R33, R34, R64): deposit_apply's lesson arm takes
 * the coach, the branch's courts and the hold row before the payment row, and
 * expires stale holds skip-locked after the deposit arm's settle call (whose
 * expiry is the body's one waiting reservations lock); R33 read literally (a
 * waiting match_expire_holds in the lesson arm) is the inversion shown here.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyse,
  createWalker,
  ONCE_PER_SEQUENCE,
  ORDER,
  printedSequence,
  SERVICE_WALK,
  SHARE_RANKED,
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
/** 0291 (DB-11): level B with the branch row's key share after the courts (lesson_lock_branch_courts). */
const LEVEL_B_BRANCH =
  'coach_advisory -> court_advisory -> venues -> reservations -> match_venue_advisory -> match_tickets';

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

  it("0284 deposit_apply's lesson arm: coach -> courts -> rows -> payment row; the stale holds skip-locked after the deposit settle (R33, R34, R64)", () => {
    // 0258's deposit_settle_success: its one waiting hold expiry above its first write (R15).
    const deposit_settle_success = `begin
      perform app.expire_stale_holds(c, x);
      update reservations set kind = 'booking', status = 'confirmed' where id = h;
    end`;
    // 0284: no lock of its own; the hold becomes the lesson's row in place, or a re-picked row.
    const lesson_settle_success = `begin
      update reservations set kind = 'lesson', status = 'confirmed' where id = h;
      insert into reservations (id, kind, lesson_id) values (r, 'lesson', l);
    end`;
    const deposit_apply = `begin
      if v.purpose = 'lesson' then perform app.lock_coach(k); end if;
      if v.purpose = 'deposit' then perform app.lock_court(c);
      elsif v.hold_id is not null then a := app.lesson_lock_branch_courts(b); end if;
      if v.purpose = 'deposit' then perform 1 from reservations where id in (r, h) order by id for update;
      elsif v.hold_id is not null then perform 1 from reservations where id = h for update; end if;
      select * into v from booking_payments where id = p for update;
      if v.purpose = 'deposit' then n := app.deposit_settle_success(p);
      elsif v.purpose = 'lesson' then
        update reservations set status = 'expired'
         where id in (select x.id from reservations x where x.kind = 'hold' order by x.id for update of x skip locked);
        n := app.lesson_settle_success(p, a);
      end if;
    end`;
    const fns = (apply: string) => [
      ...BASE,
      { name: 'expire_stale_holds', src: match_expire_holds },
      { name: 'deposit_settle_success', src: deposit_settle_success },
      { name: 'lesson_settle_success', src: lesson_settle_success },
      { name: 'deposit_apply', src: apply },
    ];
    // deposit_apply and lesson_settle_success are on the service-role walk.
    const out = analyse({ fns: fns(deposit_apply), triggers: TRIGGER, callable: [] });
    expect(out.violations).toEqual([]);
    expect(out.rows.find((r) => r.fn === 'deposit_apply')?.seq).toEqual(LEVEL_B.split(' -> '));
    expect(out.rows.find((r) => r.fn === 'lesson_settle_success')?.seq).toEqual([
      'match_venue_advisory',
      'match_tickets',
    ]);

    // R33 read literally: a waiting match_expire_holds in the lesson arm before the payment row.
    // With deposit_settle_success's own waiting expiry later in the text, the body reads
    // match_tickets -> reservations, whichever expiry comes first.
    const literal = deposit_apply
      .replace(
        'perform 1 from reservations where id = h for update; end if;',
        'perform 1 from reservations where id = h for update; perform app.match_expire_holds(b, x); end if;',
      )
      .replace(
        /update reservations set status = 'expired'\s+where id in \(select x\.id from reservations x where x\.kind = 'hold' order by x\.id for update of x skip locked\);\s+/,
        '',
      );
    expect(literal).toContain('app.match_expire_holds(b, x)');
    expect(literal).not.toContain('skip locked');
    const bad = analyse({ fns: fns(literal), triggers: TRIGGER, callable: [] });
    expect(bad.violations.join('\n')).toMatch(
      /deposit_apply: takes match_tickets before reservations/,
    );
  });
});

describe('0291 (DB-11): the branch row FOR KEY SHARE is ranked (pure)', () => {
  it('ranks venues after court_advisory and before reservations, once per sequence', () => {
    expect(ORDER.indexOf('venues')).toBe(ORDER.indexOf('court_advisory') + 1);
    expect(ORDER.indexOf('venues')).toBe(ORDER.indexOf('reservations') - 1);
    expect(ONCE_PER_SEQUENCE.has('venues')).toBe(true);
    expect([...SHARE_RANKED]).toEqual(['venues']);
  });

  it('a share lock prints only on a SHARE_RANKED table; FOR UPDATE on venues prints too', () => {
    const fns = [
      {
        name: 'ks',
        src: `begin perform 1 from venues where id = v and status = 'open' for key share; end`,
      },
      { name: 'sh', src: 'begin perform 1 from venues v where v.id = x for share of v; end' },
      { name: 'upd', src: 'begin select * into r from venues where id = v for update; end' },
      // Any other share lock stays invisible, as before 0291.
      { name: 'tabs_share', src: 'begin perform 1 from tabs where id = t for share; end' },
      {
        name: 'shifts_ks',
        src: 'begin perform 1 from till_shifts s where s.id = t for key share; end',
      },
    ];
    const w = createWalker({ fns, triggers: [] });
    expect(printedSequence(w, 'ks')).toEqual(['venues']);
    expect(printedSequence(w, 'sh')).toEqual(['venues']);
    expect(printedSequence(w, 'upd')).toEqual(['venues']);
    expect(printedSequence(w, 'tabs_share')).toEqual([]);
    expect(printedSequence(w, 'shifts_ks')).toEqual([]);
  });

  it('level B with the key share in the court helper and again in the insert is in order; only in the insert it inverts', () => {
    const courts = `begin for v in select c.id from courts c where c.venue_id = p and c.is_active order by c.id
      loop perform app.lock_court(v.id); end loop;
      perform 1 from venues where id = p for key share; end`;
    const create = `begin
      perform 1 from venues where id = b and status = 'open' for key share;
      insert into reservations (id, kind, lesson_id) values (r, 'lesson', l);
    end`;
    const book = `begin
      perform app.lock_coach(c);
      v := app.lesson_lock_branch_courts(b);
      perform app.match_expire_holds(b, x);
      perform app.lesson_create_internal(b);
    end`;
    const catalog = (helper: string) => [
      ...BASE.filter((f) => f.name !== 'lesson_lock_branch_courts'),
      { name: 'lesson_lock_branch_courts', src: helper },
      { name: 'lesson_create_internal', src: create },
      { name: 'lesson_book_private', src: book },
    ];
    // The stale-hold update expands into the trigger's mutex and tickets before the insert.
    const exp = { fns: catalog(courts), triggers: TRIGGER, callable: ['lesson_book_private'] };
    const ok = analyse(exp);
    expect(ok.violations).toEqual([]);
    expect(ok.rows).toEqual([{ fn: 'lesson_book_private', seq: LEVEL_B_BRANCH.split(' -> ') }]);

    const bad = analyse({ ...exp, fns: catalog(lesson_lock_branch_courts) });
    expect(bad.violations.join('\n')).toMatch(
      /lesson_book_private: takes match_tickets before venues/,
    );
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

  it('0281: the desk lesson payment and the lesson refund take the coach mutex before the till', () => {
    const gate = runGate([]);
    expect(gate.code, gate.out).toBe(0);
    const walkedRows = gate.out.slice(0, gate.out.indexOf('internal sequences'));
    // Loyalty (0305): settling the lesson's tab fires the deferred earn trigger, walked at commit
    // (after every lock the body took), so loyalty_accounts, ranked last, ends the sequence.
    expect(rowOf(walkedRows, 'lesson_settle')).toBe('coach_advisory -> tabs -> loyalty_accounts');
    expect(rowOf(walkedRows, 'refund')?.startsWith('coach_advisory -> tabs -> payments')).toBe(
      true,
    );
    expect(rowOf(walkedRows, 'lesson_blocked_refund_record')).toBe('coach_advisory');
    expect(rowOf(walkedRows, 'lesson_refunds_due')).toBeUndefined();
  });

  it('0282, 0283: bookings take the coach, every court, then the rows; cancels the coach and status writes only (db.md §2.5)', () => {
    const gate = runGate([]);
    expect(gate.code, gate.out).toBe(0);
    const walkedRows = gate.out.slice(0, gate.out.indexOf('internal sequences'));
    for (const fn of [
      'lesson_book_private',
      'coach_book_private',
      'desk_book_lesson',
      'coach_create_group',
      'desk_create_group',
      'coach_create_course',
      'desk_create_course',
      'coach_reschedule_session',
      'desk_reschedule_session',
      'desk_move_lesson_court',
    ]) {
      // 0291 (DB-11): lesson_lock_branch_courts takes the branch row's key share after the courts.
      expect(rowOf(walkedRows, fn), fn).toBe(LEVEL_B_BRANCH);
    }
    for (const fn of [
      'lesson_join',
      'course_join',
      'coach_add_student',
      'desk_add_student',
      'set_coach_hours',
    ]) {
      expect(rowOf(walkedRows, fn), fn).toBe('coach_advisory');
    }
    for (const fn of [
      'lesson_cancel_mine',
      'coach_remove_student',
      'coach_cancel_lesson',
      'coach_cancel_course',
      'desk_cancel_enrolment',
      'desk_cancel_lesson',
      'desk_cancel_course',
      'set_coach_status',
      'lesson_sweep',
    ]) {
      expect(rowOf(walkedRows, fn), fn).toBe(
        'coach_advisory -> match_venue_advisory -> match_tickets',
      );
    }
  });

  it("0284: deposit_apply's lesson arm, the success and the prepare print in order (R33, money.md §9)", () => {
    const gate = runGate(['lesson_hold_expire']);
    expect(gate.code, gate.out).toBe(0);
    const walkedRows = gate.out.slice(0, gate.out.indexOf('internal sequences'));
    // 0291 (DB-11): the lesson arm's lesson_lock_branch_courts takes the branch row too.
    expect(rowOf(walkedRows, 'deposit_apply')).toBe(LEVEL_B_BRANCH);
    expect(rowOf(walkedRows, 'lesson_settle_success')).toBe(
      'match_venue_advisory -> match_tickets',
    );
    expect(rowOf(walkedRows, 'lesson_payment_prepare')).toBe(LEVEL_B);
    // Internal, not walked: status writes and the skip-locked hold release only.
    const internal = gate.out.slice(gate.out.indexOf('internal sequences'));
    expect(rowOf(internal, 'lesson_hold_expire')).toBe('match_venue_advisory -> match_tickets');
  });

  it('0287: the statement writes and the monthly draft take the coach mutex only', () => {
    const gate = runGate([]);
    expect(gate.code, gate.out).toBe(0);
    const walkedRows = gate.out.slice(0, gate.out.indexOf('internal sequences'));
    for (const fn of [
      'coach_statement_refresh',
      'coach_statement_approve',
      'coach_statement_void',
      'coach_statement_mark_paid',
      'coach_statements_draft',
    ]) {
      expect(rowOf(walkedRows, fn), fn).toBe('coach_advisory');
    }
  });

  it('0290: the coach admin writers take the coach mutex only; a coach_price apply takes it before the type row', () => {
    const gate = runGate(['price_promo_apply_internal', 'coach_hours_write', 'coach_time_off_add']);
    expect(gate.code, gate.out).toBe(0);
    const walkedRows = gate.out.slice(0, gate.out.indexOf('internal sequences'));
    for (const fn of [
      'coach_promote',
      'coach_update',
      'set_coach_branches',
      'set_coach_lesson_types',
      'set_coach_price',
      'set_coach_hours',
      'set_my_coach_hours',
      'add_coach_time_off',
      'add_my_time_off',
    ]) {
      expect(rowOf(walkedRows, fn), fn).toBe('coach_advisory');
    }
    // The deletion locks the coach ROW (unranked), never the coach mutex (db.md §2.4 rule 7).
    expect(rowOf(walkedRows, 'delete_my_account')).toBe('match_venue_advisory -> match_tickets');
    const internal = gate.out.slice(gate.out.indexOf('internal sequences'));
    // 0309 ranks promotions (after tabs): a promotion change's apply locks its row after the mutex.
    expect(rowOf(internal, 'price_promo_apply_internal')).toBe('coach_advisory -> promotions');
    expect(rowOf(internal, 'coach_hours_write')).toBe('coach_advisory');
    expect(rowOf(internal, 'coach_time_off_add')).toBe('coach_advisory');
  });

  it('0291: the branch row after the courts in every lesson booking; the branch lifecycle takes only it', () => {
    const gate = runGate([
      'lesson_lock_branch_courts',
      'lesson_create_internal',
      'lesson_assert_coach_bookable',
      'match_expire_holds',
    ]);
    expect(gate.code, gate.out).toBe(0);
    expect(gate.out).toContain('stock_batches > court_advisory > venues > reservations');
    const walkedRows = gate.out.slice(0, gate.out.indexOf('internal sequences'));
    expect(rowOf(walkedRows, 'close_branch')).toBe('venues');
    expect(rowOf(walkedRows, 'open_branch')).toBe('venues');
    const internal = gate.out.slice(gate.out.indexOf('internal sequences'));
    expect(rowOf(internal, 'lesson_lock_branch_courts')).toBe('court_advisory -> venues');
    // Alone, the insert's key share comes before its court row and the trigger it fires.
    expect(rowOf(internal, 'lesson_create_internal')).toBe(
      'venues -> match_venue_advisory -> match_tickets',
    );
    expect(rowOf(internal, 'lesson_assert_coach_bookable')).toBe('(no locks)');
    expect(rowOf(internal, 'match_expire_holds')).toBe(
      'reservations -> match_venue_advisory -> match_tickets',
    );
  });
});
