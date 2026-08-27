/**
 * Lock-order invariant check for schema `app`.
 *
 * Migration 0038 declared a binding order for the tab money path and 0044
 * extended it downward through stock:
 *
 *     day_sessions -> tabs -> orders -> order_items -> tickets
 *                  -> payments -> refunds -> stock_batches
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
 *
 * Usage:  node scripts/check-lock-order.mjs        (exit 1 on any violation)
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

/** The declared total order. Adding a table here is a deliberate act. */
const ORDER = [
  'day_sessions',
  'tabs',
  'orders',
  'order_items',
  'tickets',
  'payments',
  'refunds',
  'stock_batches',
  'reservations',
];
const rank = (t) => ORDER.indexOf(t);
const TBL = ORDER.join('|');

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
const byName = new Map();
for (const f of fns) {
  const prev = byName.get(f.name);
  if (!prev || f.src.length > prev.length) byName.set(f.name, f.src);
}

// Triggers matter: trg_refund_restock and trg_ticket_consume take stock_batches
// locks without ever appearing as a call in the RPC body.
const triggers = JSON.parse(
  psql(`select coalesce(json_agg(json_build_object('tbl', c.relname, 'fn', p.proname)), '[]')
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_proc p on p.oid = t.tgfoid
          join pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'public';`).trim(),
);
const trgByTable = new Map();
for (const t of triggers) {
  if (!trgByTable.has(t.tbl)) trgByTable.set(t.tbl, []);
  trgByTable.get(t.tbl).push(t.fn);
}
const WRITABLE = [...new Set([...trgByTable.keys(), ...ORDER])].join('|');

/** alias -> table for one statement, so `FOR UPDATE OF t` resolves correctly. */
function aliases(stmt) {
  const m = new Map();
  const re = new RegExp(
    String.raw`\b(?:from|join|update)\s+(${TBL})\b(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?`,
    'gi',
  );
  const kw = ['where','set','on','for','join','left','inner','using','order','group','returning','into','values','limit'];
  for (const mm of stmt.matchAll(re)) {
    const tbl = mm[1].toLowerCase();
    const al = mm[2]?.toLowerCase();
    if (al && !kw.includes(al)) m.set(al, tbl);
    m.set(tbl, tbl);
  }
  return m;
}

/**
 * Ordered lock/call/write events of one body. Statement-by-statement: a regex
 * allowed to span statements both invents locks (matching a later FOR UPDATE
 * against an earlier unlocked read) and swallows real ones.
 */
function events(src) {
  const out = [];
  for (const stmt of src.split(';')) {
    const lockM = /\bfor\s+(?:no\s+key\s+)?update(\s+of\s+([a-z_,\s]+?))?(?=\s|$)/i.exec(stmt);
    if (lockM) {
      const al = aliases(stmt);
      if (lockM[2]) {
        for (const a of lockM[2].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
          const t = al.get(a);
          if (t) out.push({ lock: t });
        }
      } else {
        // A bare FOR UPDATE locks every base relation in the FROM list.
        for (const t of new Set([...al.values()])) out.push({ lock: t });
      }
    }
    for (const m of stmt.matchAll(/\bapp\.([a-z_][a-z0-9_]*)\s*\(/gi)) out.push({ call: m[1].toLowerCase() });
    const wr = new RegExp(String.raw`\b(?:insert\s+into|update|delete\s+from)\s+(${WRITABLE})\b`, 'gi');
    for (const m of stmt.matchAll(wr)) out.push({ write: m[1].toLowerCase() });
  }
  return out;
}

/** Full lock sequence, expanding helper calls and trigger bodies in place. */
function sequence(name, stack = []) {
  if (stack.includes(name)) return []; // recursion guard
  const src = byName.get(name);
  if (!src) return [];
  const seq = [];
  for (const ev of events(src)) {
    if (ev.lock) seq.push(ev.lock);
    else if (ev.call && byName.has(ev.call)) seq.push(...sequence(ev.call, [...stack, name]));
    else if (ev.write) {
      for (const fn of trgByTable.get(ev.write) ?? []) {
        if (byName.has(fn)) seq.push(...sequence(fn, [...stack, name]));
      }
    }
  }
  return seq;
}

const callable = psql(
  `select string_agg(distinct p.proname, ',') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'));`,
).trim().split(',').filter(Boolean).sort();

/**
 * Every table app.tab_net_paid() reads. Anything that writes one of these
 * changes a tab's balance, and settle_tab plus all three REQUIRES_REFUND
 * guards read that balance while holding `tabs ... for update` on the
 * assumption it cannot move. So writing these REQUIRES holding the tab lock —
 * this is rule 2, and it is what catches a missing lock rather than an
 * inverted one. 0043's app.refund wrote refunds while holding only payments.
 */
const BALANCE_TABLES = ['payments', 'refunds'];

/** Ordered locks AND balance-writes, so rule 2 can see which came first. */
function timeline(name, stack = []) {
  if (stack.includes(name)) return [];
  const src = byName.get(name);
  if (!src) return [];
  const out = [];
  for (const ev of events(src)) {
    if (ev.lock) out.push({ lock: ev.lock });
    else if (ev.call && byName.has(ev.call)) out.push(...timeline(ev.call, [...stack, name]));
    else if (ev.write) {
      if (BALANCE_TABLES.includes(ev.write)) out.push({ balanceWrite: ev.write });
      for (const fn of trgByTable.get(ev.write) ?? []) {
        if (byName.has(fn)) out.push(...timeline(fn, [...stack, name]));
      }
    }
  }
  return out;
}

const violations = [];
const rows = [];
for (const fn of callable) {
  const seq = sequence(fn);
  const compact = seq.filter((t, i) => i === 0 || t !== seq[i - 1]);

  // Rule 1 — no inversion of the declared order.
  for (let i = 1; i < compact.length; i++) {
    if (rank(compact[i - 1]) > rank(compact[i])) {
      violations.push(
        `  ${fn}: takes ${compact[i - 1]} before ${compact[i]}\n` +
          `      full sequence: ${compact.join(' -> ')}\n` +
          `      -> inverted order; two such functions deadlock (40P01) under contention.`,
      );
    }
  }

  // Rule 2 — a balance write requires the tab lock, taken beforehand.
  const tl = timeline(fn);
  const firstTabLock = tl.findIndex((e) => e.lock === 'tabs');
  const firstBalance = tl.findIndex((e) => e.balanceWrite);
  if (firstBalance >= 0 && (firstTabLock < 0 || firstTabLock > firstBalance)) {
    violations.push(
      `  ${fn}: writes ${tl[firstBalance].balanceWrite} ` +
        (firstTabLock < 0 ? 'without ever locking tabs' : 'before locking tabs') +
        `\n      -> app.tab_net_paid() can then move under settle_tab and under every\n` +
        `         REQUIRES_REFUND guard, all of which read it holding the tab lock.`,
    );
  }

  if (compact.length) rows.push(`  ${fn.padEnd(26)} ${compact.join(' -> ')}`);
}

console.log('declared order: ' + ORDER.join(' > ') + '\n');
console.log('lock sequences (client-callable, transitive through helpers and triggers):');
console.log(rows.join('\n'));

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
