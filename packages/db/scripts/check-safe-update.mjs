/**
 * safeupdate invariant check for schema `app`.
 *
 * Supabase loads the `safeupdate` extension on PostgREST connections, so an
 * UPDATE or DELETE with no WHERE clause is refused there:
 *
 *     ERROR: UPDATE requires a WHERE clause
 *
 * SECURITY DEFINER does not help. The guard is a session-level hook on the
 * statement, not a privilege check, so it fires inside a definer function body
 * exactly as it does at the top level.
 *
 * That is how `app.set_opening_hours` (0013) and `app.set_waiter_call_cooldown`
 * (0031) shipped BROKEN and stayed broken. Both did a bare
 * `update venue_settings set ...`, and both were unreachable from any client
 * for their entire life:
 *
 *   * SOW L319, "Opening hours and closed days" — /admin/hours rendered, the
 *     save button worked, the write was refused every time, and the venue's
 *     trading hours could not be changed from the product at all.
 *   * The waiter-call cooldown control had the same story since the cafe
 *     rebuild.
 *
 * Neither was caught by the DB suites, because those call through the SERVICE
 * ROLE, where safeupdate is not loaded — the tests took the one path where the
 * bug does not exist. It took an e2e that pressed the button to surface it.
 *
 * Relying on "an e2e presses every button" is not a plan, so the invariant is
 * checked structurally, in the same spirit as check-lock-order.mjs and
 * check-rpc-authz.mjs.
 *
 * Why a script and not a vitest case: the tests speak PostgREST, which cannot
 * read pg_proc. This reads the catalog directly through the stack's own
 * container.
 *
 * Usage:  node scripts/check-safe-update.mjs      (exit 1 on any violation)
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psqlJson(sql) {
  const out = execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
  return JSON.parse(out.trim() || '[]');
}

/**
 * Every function in schema `app`, with its body, as one JSON document — a
 * plpgsql body is multi-line, so any row-per-line format would shred it.
 *
 * Triggers are included deliberately: a trigger body runs inside the caller's
 * session, so a bare UPDATE there fails on a client write just the same.
 */
const rows = psqlJson(`
  select coalesce(json_agg(json_build_object('name', p.proname, 'src', p.prosrc)
                           order by p.proname), '[]'::json)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
`);

/**
 * Strip what must not be scanned:
 *   - line and block comments (a commented-out UPDATE is not code);
 *   - single-quoted literals (an error `hint` may legitimately say "UPDATE …").
 * Dollar-quoted bodies are already unwrapped by prosrc.
 */
function strip(src) {
  return src
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Only STATEMENT-initial UPDATE/DELETE counts. Two SQL constructs contain the
 * word and are not statements:
 *   - `select … for update [skip locked]`  — a row-locking clause;
 *   - `insert … on conflict do update set` — an upsert clause, whose target is
 *     the conflicting row and which safeupdate does not object to.
 * Both are excluded by requiring a statement boundary before the verb.
 */
const STATEMENT = /(^|;|\bbegin\b|\bthen\b|\belse\b|\bloop\b)\s*(update|delete\s+from)\s+([a-z_][a-z0-9_.]*)\b([\s\S]*?)(?=;|$)/gi;

const violations = [];
for (const { name, src } of rows) {
  const body = strip(src);
  for (const m of body.matchAll(STATEMENT)) {
    const [, , verb, table, tail] = m;
    if (/\bwhere\b/i.test(tail)) continue;
    violations.push({
      fn: name,
      statement: `${verb.toLowerCase().replace(/\s+/g, ' ')} ${table}`,
      snippet: m[0].trim().slice(0, 140).replace(/\s+/g, ' '),
    });
  }
}

console.log(`scanned ${rows.length} functions in schema app for WHERE-less UPDATE/DELETE`);

if (violations.length === 0) {
  console.log('\nno WHERE-less writes');
  process.exit(0);
}

console.error(
  `\n${violations.length} WHERE-less write(s) — these are refused on every client call:`,
);
for (const v of violations) {
  console.error(`  ${v.fn.padEnd(32)} ${v.statement}`);
  console.error(`      ${v.snippet}…`);
}
console.error(
  '\nSupabase loads `safeupdate` on PostgREST connections, so these raise\n' +
    '"UPDATE requires a WHERE clause" for every real caller, and SECURITY DEFINER\n' +
    'does not exempt them. Add a WHERE — for the singleton settings tables that is\n' +
    '`where id`.',
);
process.exit(1);
