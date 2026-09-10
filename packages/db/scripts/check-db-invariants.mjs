/**
 * Database invariant regression locks — Security Layer 1, Block 2 (SEC-04).
 *
 * Two properties that are TRUE TODAY and must never quietly stop being true.
 * Neither of these gates fixes anything; both exist so the next migration
 * cannot forget, because both failure modes are invisible in review:
 *
 *   VIEWS.  A view without `security_invoker = on` runs with its OWNER's
 *           rights, so it reads straight past the RLS policies of the caller.
 *           A view added to expose "just a couple of columns" becomes a hole in
 *           every policy underneath it, and the diff that does it looks exactly
 *           like a view that is fine. Four views are deliberately owner-rights
 *           audited projections; they are named below, and anything NEW that is
 *           invoker-off fails.
 *
 *   SEARCH_PATH.  A SECURITY DEFINER function without a pinned search_path
 *           resolves unqualified names using the CALLER's search_path. A guest
 *           who can create objects in a schema on that path can shadow a table
 *           or an operator and have privileged code run against their own —
 *           the classic Postgres privilege-escalation shape. Coverage is
 *           159/159 today with zero offenders, so this passes on the first run.
 *
 * Reads the catalog through the stack's own container, same as
 * check-lock-order.mjs and check-safe-update.mjs.
 *
 * Usage:  node scripts/check-db-invariants.mjs      (exit 1 on any violation)
 */
import { execFileSync } from 'node:child_process';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

/**
 * Views that run with OWNER rights ON PURPOSE — each is a deliberately narrow,
 * audited projection that must be readable BEFORE the caller has any identity,
 * which is precisely what RLS on the base table would prevent.
 *
 * Adding a name here is a security decision: it asserts that this view's own
 * WHERE clause is the complete access control for every row it can return.
 */
const AUDITED_OWNER_RIGHTS_VIEWS = new Set([
  // The guest menu must render before anyone signs in.
  'venue_settings_public',
  'cafe_settings_public',
  'menu_item_availability',
  // The booking surface needs free/busy for a court without exposing whose
  // reservation occupies it.
  'court_availability',
]);

const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim();

function query(sql) {
  try {
    return psql(sql);
  } catch (err) {
    console.error('FAIL  could not reach the local Supabase database.');
    console.error(`      container: ${CONTAINER}`);
    console.error('      Start the stack first:  pnpm db:start');
    console.error('');
    console.error(String(err.stderr ?? err.message).split('\n').slice(0, 3).join('\n'));
    process.exit(1);
  }
}

// ── views ─────────────────────────────────────────────────────────────────────
// reloptions carries security_invoker for views; null means "not set" = OFF.
const viewRows = query(`
  select n.nspname || '.' || c.relname || '|' ||
         case when array_to_string(c.reloptions, ',') like '%security_invoker=on%'
              then 'on' else 'off' end
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('v','m')
     and n.nspname in ('app','public')
   order by 1;
`);

const views = viewRows
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [qualified, mode] = l.split('|');
    const name = qualified.split('.').pop();
    return { qualified, name, invoker: mode === 'on' };
  });

const invokerOff = views.filter((v) => !v.invoker);
const unexpectedOff = invokerOff.filter((v) => !AUDITED_OWNER_RIGHTS_VIEWS.has(v.name));
// A view that leaves the allowlist should leave the allowlist file too.
const staleAllowlist = [...AUDITED_OWNER_RIGHTS_VIEWS].filter(
  (n) => !invokerOff.some((v) => v.name === n),
);

// ── security definer search_path ──────────────────────────────────────────────
const definerRows = query(`
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname in ('app','public')
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
        where cfg like 'search_path=%'
     )
   order by 1;
`);
const unpinned = definerRows.split('\n').filter(Boolean);

const definerCount = Number(
  query(`
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef and n.nspname in ('app','public');
`),
);

// ── report ────────────────────────────────────────────────────────────────────
console.log('Database invariant locks\n');
console.log(
  `  views          ${views.length} total · ${views.length - invokerOff.length} security_invoker=on · ` +
    `${invokerOff.length} owner-rights`,
);
console.log(
  `  definer fns    ${definerCount} total · ${definerCount - unpinned.length} with a pinned search_path`,
);
console.log('');

const problems = [];

if (unexpectedOff.length > 0) {
  problems.push(
    `${unexpectedOff.length} view(s) run with OWNER rights and are not on the audited allowlist:\n` +
      unexpectedOff.map((v) => `        ${v.qualified}`).join('\n') +
      '\n\n' +
      '      Such a view reads past the RLS policies of whoever queries it. If that is\n' +
      "      deliberate, add its name to AUDITED_OWNER_RIGHTS_VIEWS in this script — that\n" +
      "      edit asserts the view's own WHERE clause is the complete access control for\n" +
      '      every row it can return. Otherwise:  alter view … set (security_invoker = on);',
  );
}

if (unpinned.length > 0) {
  problems.push(
    `${unpinned.length} SECURITY DEFINER function(s) have no pinned search_path:\n` +
      unpinned.map((f) => `        ${f}`).join('\n') +
      '\n\n' +
      "      Unqualified names inside these resolve using the CALLER's search_path, so a\n" +
      '      caller who can create objects on that path can shadow a table or an operator\n' +
      '      and have privileged code run against theirs instead.\n' +
      '      FIX: add  set search_path = public  to the function definition.',
  );
}

if (staleAllowlist.length > 0) {
  console.log('Stale allowlist entries — these views are no longer owner-rights:');
  for (const n of staleAllowlist) console.log(`        ${n}`);
  console.log('  (harmless, but remove them so the list keeps meaning something.)\n');
}

if (problems.length === 0) {
  console.log('PASS  every view is security_invoker=on except the four audited projections,');
  console.log('      and every SECURITY DEFINER function pins its search_path.');
  process.exit(0);
}

for (const p of problems) console.error(`FAIL  ${p}\n`);
process.exit(1);
