/**
 * Lock-order invariant check for schema `app`.
 *
 * Migration 0038 declared a binding order for the tab money path and 0044
 * extended it downward through stock:
 *
 *     day_sessions -> tabs -> orders -> order_items -> tickets
 *                  -> payments -> refunds -> stock_batches
 *
 * Wave 5 (till_shifts) put till_shifts between payments and refunds: the stamp
 * trigger on payments and refunds takes the open shift FOR SHARE, close_day
 * takes the day's shifts FOR UPDATE after the day, and a shift close takes its
 * row alone. This script sees FOR UPDATE only, so the trigger's SHARE is
 * covered by the race test in tests/till-shifts.test.ts.
 *
 * Open matches (0260, docs/design/open-matches/db.md §2) added three ranks:
 * match_money_advisory (app.lock_match_money, R19) right after day_sessions,
 * and match_venue_advisory (app.lock_match_venue, the branch mutex) then
 * match_tickets after reservations. Each advisory key counts once per
 * sequence, and the service-role functions of contracts §1.4 (R8) are walked
 * too. The full order and the rules live in scripts/lib/lock-order.mjs.
 *
 * Coaching (coaching_tables, docs/design/coaching/db.md §2; build contracts §1.4, R6,
 * R33, R64) added the coach mutex, coach_advisory (app.lock_coach), right
 * after match_money_advisory and before tabs, counted once per sequence; its
 * try-lock twin is never printed. A reservations row taken FOR UPDATE ... SKIP
 * LOCKED never waits, so it is not a lock here either (the statement that
 * expires a held lesson's court hold); every other skip locked still prints.
 * The service-role walk adds lesson_sweep, lesson_settle_success,
 * lesson_payment_prepare and coach_statements_draft once each exists.
 *
 * Two 0043 defects were both violations of exactly this rule — override_price
 * took order_items before tabs (a reproducible deadlock against void_after_send),
 * and refund took payments without ever taking tabs (so app.tab_net_paid, which
 * every REQUIRES_REFUND guard and settle_tab's settled-vs-awaiting decision read
 * under the tab lock, could move mid-transaction). Neither was catchable by a
 * race test: after correct serialization the legitimate interleavings and the
 * buggy one reach identical end states, and `now()` is transaction-start time so
 * timestamps cannot order commits either. The invariant is structural, so the
 * guard is structural.
 *
 * Why a script and not a vitest case: the tests speak PostgREST, which cannot
 * read pg_proc. This reads the catalog directly through the stack's own
 * container, which is named the same locally and in CI (config.toml project_id).
 * The walker itself is pure (scripts/lib/lock-order.mjs) and has its own
 * fixture test (tests/lock-order-matches.test.ts).
 *
 * Usage:  node scripts/check-lock-order.mjs                  (exit 1 on any violation)
 *         node scripts/check-lock-order.mjs --show=a,b       (also print the sequences
 *                                                             of internal functions a, b)
 */
import { execFileSync } from 'node:child_process';
import { analyse } from './lib/lock-order.mjs';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

const fns = JSON.parse(
  psql(`select coalesce(json_agg(json_build_object('name', p.proname, 'src', p.prosrc)), '[]')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app';`).trim(),
);

const triggers = JSON.parse(
  psql(`select coalesce(json_agg(json_build_object('tbl', c.relname, 'fn', p.proname)), '[]')
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_proc p on p.oid = t.tgfoid
          join pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'public';`).trim(),
);

const callable = psql(
  `select string_agg(distinct p.proname, ',') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'));`,
).trim().split(',').filter(Boolean).sort();

const showArg = process.argv.find((a) => a.startsWith('--show='));
const show = showArg ? showArg.slice('--show='.length).split(',').map((s) => s.trim()).filter(Boolean) : [];

const { order, rows, violations, shown } = analyse({ fns, triggers, callable, show });

console.log('declared order: ' + order.join(' > ') + '\n');
console.log('lock sequences (client-callable and the service-role walk list, transitive through helpers and triggers):');
console.log(rows.map((r) => `  ${r.fn.padEnd(26)} ${r.seq.join(' -> ')}`).join('\n'));
if (shown.length) {
  console.log('\ninternal sequences (--show):');
  console.log(
    shown
      .map((r) => `  ${r.fn.padEnd(26)} ${r.found ? r.seq.join(' -> ') || '(no locks)' : '(no such function)'}`)
      .join('\n'),
  );
}

if (violations.length) {
  console.error('\nLOCK ORDER VIOLATIONS (' + violations.length + '):');
  console.error(violations.join('\n'));
  console.error(
    '\nFix both shapes the same way: resolve the tab (or parent row) through an\n' +
      'UNLOCKED read, then take the locks top-down in the declared order before\n' +
      'the first write. See migration 0044 for two worked examples.',
  );
  process.exit(1);
}
console.log('\nno lock-order violations');
