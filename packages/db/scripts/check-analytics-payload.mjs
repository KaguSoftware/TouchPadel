/**
 * Analytics payload gate — SEC-29.
 *
 * The owner's insights screen gathers `app.analytics_*` output and POSTs it to
 * `analytics-insights`, which forwards it to Groq — a third-party LLM provider,
 * outside this system and outside the venue's country. Whatever those functions
 * return LEAVES.
 *
 * So the question is not whether the analytics are owner-only (they are —
 * app.analytics_guard is is_staff('owner')). It is what is IN them. A guest id,
 * a phone or a name in an aggregate is a guest record sent to a processor the
 * privacy notice does not cover and the guest never agreed to.
 *
 * Today none of them return one — these are sales aggregates over items, hours
 * and price bands. This gate exists because the natural next feature is "show me
 * my regulars", and the natural way to build it is to add customer_id to an
 * existing analytics function, which is a privacy decision that would otherwise
 * arrive as an ordinary product commit.
 *
 * Usage:  node scripts/check-analytics-payload.mjs
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

/**
 * Identity, as a JSON KEY the function emits. Matched against the keys of
 * jsonb_build_object and against `returns table` column names.
 *
 * `name` alone is allowed: `item_name`, `category_name` and `day_name` are the
 * substance of a sales report. What must never appear is a key naming a PERSON
 * or carrying a handle back to one.
 */
const FORBIDDEN = [
  /guest_id/i, /guest_name/i, /guest_phone/i,
  /customer_id/i, /customer_name/i, /customer_phone/i,
  /profile_id/i, /auth_user_id/i, /\bphone\b/i, /email/i, /full_name/i,
  /\buser_id\b/i, /session_id/i, /device_id/i,
];

/**
 * CLIENT-CALLABLE ONLY, and the distinction is the whole correctness of this
 * gate. `app.analytics_sales_lines` returns `guest_session_id` — it is the
 * detail table the aggregates are built FROM, and it is granted to nobody
 * (verified: EXECUTE to neither `anon` nor `authenticated`). Its identifiers
 * never leave the database because no client can call it.
 *
 * Scanning it anyway made the gate fail on a correct schema on its first run,
 * which is the fastest way to teach people to delete a gate. What leaves is what
 * a client can RETRIEVE, so that is what is judged.
 */
const fns = JSON.parse(
  psql(`select coalesce(json_agg(json_build_object(
           'name', p.proname,
           'src',  p.prosrc,
           'args', pg_get_function_arguments(p.oid),
           'ret',  pg_get_function_result(p.oid))), '[]')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app'
           and (p.proname like 'analytics!_%' escape '!'
             or p.proname like 'panel!_%' escape '!'
             or p.proname like 'report!_%' escape '!')
           and (has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('authenticated', p.oid, 'EXECUTE'));`).trim(),
);

const findings = [];

for (const f of fns) {
  // Keys the function BUILDS into its result, plus any declared OUT columns.
  const keys = new Set();
  for (const m of f.src.matchAll(/'([a-z0-9_]+)'\s*,/gi)) keys.add(m[1]);
  for (const m of (f.ret ?? '').matchAll(/([a-z0-9_]+)\s+[a-z]/gi)) keys.add(m[1]);

  for (const key of keys) {
    const hit = FORBIDDEN.find((r) => r.test(key));
    if (hit) findings.push({ fn: f.name, key });
  }
}

console.log('Analytics payload gate — SEC-29');
console.log(`  client-callable analytics/report/panel fns    ${fns.length}`);
console.log('  destination                                  Groq (third-party LLM), via analytics-insights');

if (fns.length === 0) {
  console.error('\nFAIL  scanned nothing — the naming convention or the schema moved.');
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\nFAIL  ${findings.length} guest identifier(s) in an analytics payload:\n`);
  for (const f of findings) console.error(`  app.${f.fn}  ->  '${f.key}'`);
  console.error('\nThese payloads are POSTed to a third-party LLM provider outside the venue.');
  console.error('Aggregate the figure without the identifier, or keep the feature inside the database.');
  process.exit(1);
}

console.log('\nPASS  no guest identifier is emitted by any analytics, report or panel function.');
