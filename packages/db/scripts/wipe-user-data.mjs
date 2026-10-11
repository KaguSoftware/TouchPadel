#!/usr/bin/env node
/**
 * Erases every piece of data collected from users and keeps the setup (Majed
 * 2026-10-11: "all the collected data from users, so don't erase menu items or
 * courts etc"). What is kept and what is erased is fixtures/wipe-user-data.json,
 * one line per table; this script refuses to run while any table of schemas
 * public and app is missing from it.
 *
 * DRY RUN BY DEFAULT. The whole wipe runs inside one transaction, is checked
 * (every wiped table empty except the kept profiles, every kept table the same
 * size), the before/after counts are printed, and the transaction is ROLLED
 * BACK. Only --execute commits, and then empties the storage buckets.
 *
 *   node scripts/wipe-user-data.mjs                         dry run, local stack
 *   node scripts/wipe-user-data.mjs --keep-email=a@b.c      also keep that login
 *   DATABASE_URL=… node scripts/wipe-user-data.mjs --hosted  dry run on hosted
 *   DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… WIPE_CONFIRM=<db host> \
 *     node scripts/wipe-user-data.mjs --hosted --execute     the real thing
 *
 * How. The append-only ledgers (payments, refunds, audit_log, stock_movements…)
 * refuse DELETE by trigger, so the wiped tables' user triggers are disabled for
 * the length of the transaction (foreign keys stay enforced: they are system
 * triggers) and re-enabled before it ends. Rows are deleted children first.
 * Links from kept rows to wiped rows are cleared first (links_cleared). Kept:
 * the profiles and logins of staff and coaches (a coach row needs its profile)
 * and of any --keep-email / --keep-id. The assistant's index drops the chunks
 * built from wiped tables. Storage: menu-media stays; avatars keeps only the
 * kept profiles' photos; staff-media is emptied.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plan = JSON.parse(readFileSync(join(root, 'fixtures', 'wipe-user-data.json'), 'utf8'));

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const hosted = args.includes('--hosted');
const keepEmails = args.filter((a) => a.startsWith('--keep-email=')).map((a) => a.slice(13).toLowerCase());
const keepIds = args.filter((a) => a.startsWith('--keep-id=')).map((a) => a.slice(10));
const unknown = args.filter((a) => !['--execute', '--hosted'].includes(a) && !a.startsWith('--keep-email=') && !a.startsWith('--keep-id='));
if (unknown.length) {
  console.error(`[wipe] unknown argument(s): ${unknown.join(' ')}`);
  process.exit(2);
}
for (const id of keepIds) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`--keep-id is not a uuid: ${id}`);
}
for (const e of keepEmails) {
  if (!/^[^\s'@]+@[^\s'@]+$/.test(e)) throw new Error(`--keep-email is not an email: ${e}`);
}

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DB_URL = process.env.DATABASE_URL ?? LOCAL_URL;
const dbHost = new URL(DB_URL).hostname;
const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(dbHost);
if (!isLocal && !hosted) {
  console.error(`[wipe] refusing: ${dbHost} is not the local stack. Pass --hosted to run against it.`);
  process.exit(2);
}
if (execute && !isLocal && process.env.WIPE_CONFIRM !== dbHost) {
  console.error(`[wipe] refusing to COMMIT on ${dbHost}: set WIPE_CONFIRM=${dbHost} to confirm.`);
  process.exit(2);
}

// psql if installed; otherwise the one inside the local Supabase container,
// which reaches the local database on its own port and a hosted one by URL.
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
const havePsql = spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0;
function psqlArgs() {
  if (havePsql) return ['psql', [DB_URL]];
  // Inside the container the local database listens on 5432, not the published 54322.
  const url = isLocal ? Object.assign(new URL(DB_URL), { hostname: '127.0.0.1', port: '5432' }).toString() : DB_URL;
  return ['docker', ['exec', '-i', CONTAINER, 'psql', url]];
}
function runSql(sql, { quiet } = { quiet: false }) {
  const [cmd, base] = psqlArgs();
  return execFileSync(cmd, [...base, '-v', 'ON_ERROR_STOP=1', ...(quiet ? ['-qAt'] : ['-q'])], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------------------
// 1. The catalog: every table, and every foreign key between them.
// ---------------------------------------------------------------------------
const catalog = JSON.parse(runSql(`
select json_build_object(
  'tables', (select json_agg(case when n.nspname = 'public' then c.relname else n.nspname || '.' || c.relname end order by 1)
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relkind in ('r', 'p') and n.nspname in ('public', 'app')),
  'fks', (select json_agg(json_build_object(
                   'child', case when cn.nspname = 'public' then cc.relname else cn.nspname || '.' || cc.relname end,
                   'parent', case when pn.nspname = 'public' then pc.relname else pn.nspname || '.' || pc.relname end,
                   'columns', (select json_agg(a.attname order by a.attnum) from pg_attribute a
                                where a.attrelid = k.conrelid and a.attnum = any(k.conkey)),
                   'on_delete', k.confdeltype))
            from pg_constraint k
            join pg_class cc on cc.oid = k.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
            join pg_class pc on pc.oid = k.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
           where k.contype = 'f' and cn.nspname in ('public', 'app') and pn.nspname in ('public', 'app'))
);`, { quiet: true }));

const keep = new Set(Object.keys(plan.keep));
const wipe = new Set(Object.keys(plan.wipe));
const tables = new Set(catalog.tables);
const problems = [];
for (const t of tables) if (!keep.has(t) && !wipe.has(t)) problems.push(`table ${t} is in neither list of fixtures/wipe-user-data.json`);
// A listed table that does not exist yet (a migration not applied here) or any more is harmless.
for (const t of [...keep, ...wipe]) if (!tables.has(t)) console.warn(`[wipe] note: ${t} is listed but not in this database; skipped`);
for (const t of [...keep]) if (!tables.has(t)) keep.delete(t);
for (const t of [...wipe]) if (!tables.has(t)) wipe.delete(t);
for (const t of keep) if (wipe.has(t)) problems.push(`table ${t} is in both lists`);

// A kept row may point at a wiped table only where that link is cleared first
// (links_cleared) or where the wiped table keeps the rows it points at (a
// coach's profile).
const cleared = new Set(Object.keys(plan.links_cleared));
for (const fk of catalog.fks) {
  if (!keep.has(fk.child) || !wipe.has(fk.parent)) continue;
  const key = `${fk.child}.${fk.columns.join(',')}`;
  const handled = cleared.has(key) || (fk.child === 'coaches' && fk.parent === 'profiles' && key === 'coaches.profile_id');
  if (!handled) problems.push(`kept ${key} points at wiped ${fk.parent}: decide how to handle it before wiping`);
}
if (problems.length) {
  console.error(`[wipe] refusing to run:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. The delete order: a table goes once every wiped table pointing at it has.
//    Tables that point at each other in a loop (a booking and its match, a
//    lesson and its booking…) go together in ONE statement: a NO ACTION foreign
//    key is checked at the end of the statement, so the loop never trips it.
//    A RESTRICT key inside a loop would, so it stops the script.
// ---------------------------------------------------------------------------
const edges = new Map([...wipe].map((t) => [t, new Set()])); // child -> parents
for (const fk of catalog.fks) {
  if (wipe.has(fk.child) && wipe.has(fk.parent) && fk.child !== fk.parent) edges.get(fk.child).add(fk.parent);
}
// Tarjan's strongly connected components.
const index = new Map(); const low = new Map(); const stack = []; const onStack = new Set(); const comps = [];
let counter = 0;
function strong(v) {
  index.set(v, counter); low.set(v, counter); counter++; stack.push(v); onStack.add(v);
  for (const w of edges.get(v)) {
    if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    const comp = [];
    let w;
    do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
    comps.push(comp.sort());
  }
}
for (const t of [...wipe].sort()) if (!index.has(t)) strong(t);
const compOf = new Map(comps.flatMap((c, i) => c.map((t) => [t, i])));
for (const fk of catalog.fks) {
  if (wipe.has(fk.child) && wipe.has(fk.parent) && fk.child !== fk.parent && fk.on_delete === 'r'
      && compOf.get(fk.child) === compOf.get(fk.parent)) {
    console.error(`[wipe] ${fk.child}.${fk.columns.join(',')} -> ${fk.parent} is RESTRICT inside a loop; it cannot be wiped in one statement`);
    process.exit(1);
  }
}
// Order the components children first: a component goes once every component
// pointing at it has.
const compParents = comps.map(() => new Set());
for (const [child, parents] of edges) for (const p of parents) {
  if (compOf.get(child) !== compOf.get(p)) compParents[compOf.get(child)].add(compOf.get(p));
}
const compChildren = comps.map(() => new Set());
compParents.forEach((ps, c) => ps.forEach((p) => compChildren[p].add(c)));
const steps = [];
const doneComp = new Set();
while (steps.length < comps.length) {
  const ready = comps.map((_, i) => i).filter((i) => !doneComp.has(i) && [...compChildren[i]].every((c) => doneComp.has(c)));
  for (const i of ready) { steps.push(comps[i]); doneComp.add(i); }
}
const order = steps.flat();

// ---------------------------------------------------------------------------
// 3. The transaction.
// ---------------------------------------------------------------------------
const q = (t) => t.split('.').map((p) => `"${p}"`).join('.');
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const all = [...catalog.tables].sort();
const kinds = plan.chunk_kinds_wiped.map(lit).join(', ');
const deleteOne = (t) => (t === 'profiles'
  ? 'delete from profiles where id not in (select id from _wipe_keep_ids)'
  : `delete from ${q(t)}`);
function deleteStep(comp) {
  if (comp.length === 1) return `${deleteOne(comp[0])};`;
  const [last, ...rest] = comp;
  return `-- one statement for a loop: ${comp.join(', ')}\nwith ${rest.map((t, i) => `d${i} as (${deleteOne(t)} returning 1)`).join(',\n     ')}\n${deleteOne(last)};`;
}

const sql = `
begin;
set local lock_timeout = '15s';
set local statement_timeout = 0;

create temp table _wipe_keep_ids (id uuid primary key) on commit drop;
insert into _wipe_keep_ids
  select id from staff
  union select profile_id from coaches
  union select id from auth.users where lower(email) = any(array[${keepEmails.map(lit).join(', ')}]::text[])
  union select unnest(array[${keepIds.map(lit).join(', ')}]::uuid[])
on conflict do nothing;

create temp table _wipe_counts (tbl text primary key, side text not null, before bigint not null, after bigint) on commit drop;
${all.map((t) => `insert into _wipe_counts values (${lit(t)}, ${lit(keep.has(t) ? 'keep' : 'wipe')}, (select count(*) from ${q(t)}), null);`).join('\n')}
insert into _wipe_counts values ('auth.users', 'auth', (select count(*) from auth.users), null);

-- the storage objects that go (reported here; removed through the Storage API after a commit)
create temp table _wipe_objects on commit drop as
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'staff-media'
      or (o.bucket_id = 'avatars'
          and not exists (select 1 from profiles p join _wipe_keep_ids k on k.id = p.id
                           where p.avatar_path is not null and p.avatar_path = o.name));

${order.map((t) => `alter table ${q(t)} disable trigger user;`).join('\n')}

${Object.keys(plan.links_cleared).map((k) => { const [t, c] = k.split('.'); return `update ${q(t)} set "${c}" = null where "${c}" is not null;`; }).join('\n')}

${steps.map(deleteStep).join('\n')}

delete from assistant_chunks where kind in (${kinds});
delete from assistant_index_queue where kind in (${kinds});

delete from auth.users u where not exists (select 1 from _wipe_keep_ids k where k.id = u.id);
do $wipe_auth_log$
begin
  delete from auth.audit_log_entries;
exception when insufficient_privilege then
  raise notice 'auth.audit_log_entries: no privilege, left as is';
end $wipe_auth_log$;

${order.map((t) => `alter table ${q(t)} enable trigger user;`).join('\n')}

${all.map((t) => `update _wipe_counts set after = (select count(*) from ${q(t)}) where tbl = ${lit(t)};`).join('\n')}
update _wipe_counts set after = (select count(*) from auth.users) where tbl = 'auth.users';

do $wipe_check$
declare
  v_bad text;
begin
  select string_agg(tbl || ' ' || before || '->' || after, ', ') into v_bad
    from _wipe_counts
   where (side = 'wipe' and tbl <> 'profiles' and after <> 0)
      or (side = 'wipe' and tbl = 'profiles' and after <> (select count(*) from profiles p join _wipe_keep_ids k on k.id = p.id))
      or (side = 'keep' and tbl not in ('assistant_chunks', 'assistant_index_queue') and after <> before);
  if v_bad is not null then
    raise exception 'WIPE_CHECK_FAILED: %', v_bad;
  end if;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where not t.tgisinternal and t.tgenabled = 'D'
                and c.relnamespace in ('public'::regnamespace, 'app'::regnamespace)) then
    raise exception 'WIPE_CHECK_FAILED: a trigger is still disabled';
  end if;
end $wipe_check$;

-- The wipe is the first line of the new audit log: what went, in counts only.
insert into audit_log (action, entity, entity_id, venue_id, after)
select 'data.wipe_user_data', 'database', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       (select id from venues order by (id = 'c0000000-0000-4000-8000-000000000001') desc, id limit 1),
       jsonb_build_object('erased', jsonb_object_agg(tbl, before - after) filter (where before <> after),
                          'kept_logins', (select count(*) from auth.users))
  from _wipe_counts;

\\echo
\\echo '== erased (rows before -> after) =='
select rpad(tbl, 34) || lpad(before::text, 9) || ' -> ' || after from _wipe_counts where side in ('wipe', 'auth') and before > 0 order by tbl;
\\echo
\\echo '== kept, unchanged (rows) =='
select rpad(tbl, 34) || lpad(before::text, 9) || case when after <> before then ' -> ' || after else '' end from _wipe_counts where side = 'keep' and before > 0 order by tbl;
\\echo
\\echo '== logins kept (staff, coaches, --keep-email/--keep-id) =='
select coalesce(s.display_name, '(no staff row)') || ' | ' || coalesce(s.role::text, 'coach/guest') || ' | ' || coalesce(u.email, u.phone, '') from auth.users u left join staff s on s.id = u.id order by 1;
\\echo
\\echo '== storage objects that go =='
select bucket_id || ': ' || count(*) from _wipe_objects group by bucket_id order by 1;
\\echo '== totals =='
select 'erased rows: ' || sum(before - after) filter (where side in ('wipe', 'auth')) || ', kept tables: ' || count(*) filter (where side = 'keep') || ', wiped tables: ' || count(*) filter (where side = 'wipe') from _wipe_counts;
${execute ? 'create temp table _wipe_objects_out on commit preserve rows as select * from _wipe_objects;\ncommit;\n\\echo COMMITTED' : 'rollback;\n\\echo DRY RUN: rolled back, nothing changed. Pass --execute to commit.'}
${execute ? "\\echo OBJECTS\nselect coalesce(json_agg(json_build_object('bucket', bucket_id, 'name', name)), '[]') from _wipe_objects_out;" : ''}
`;

console.log(`[wipe] ${execute ? 'EXECUTE' : 'dry run'} on ${dbHost}: ${keep.size} tables kept, ${wipe.size} wiped`);
let out;
try {
  out = runSql(sql, { quiet: true });
} catch (e) {
  console.error(`[wipe] failed, nothing changed (the transaction rolled back): ${e.message.split('\n')[0]}`);
  process.exit(1);
}
const [report, objectsJson] = out.split('\nOBJECTS\n');
console.log(report.trimEnd());

// ---------------------------------------------------------------------------
// 4. Storage, after a commit only: the Storage API (SQL may not delete objects).
// ---------------------------------------------------------------------------
if (execute) {
  const objects = JSON.parse((objectsJson ?? '[]').trim() || '[]');
  const base = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (objects.length && !key) {
    console.error(`[wipe] the database is wiped, but ${objects.length} storage object(s) are left: set SUPABASE_SERVICE_ROLE_KEY and run again (it is idempotent).`);
    process.exit(1);
  }
  const byBucket = new Map();
  for (const o of objects) byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.name]);
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const res = await fetch(`${base}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: names.slice(i, i + 100) }),
      });
      if (!res.ok) {
        console.error(`[wipe] storage ${bucket}: ${res.status} ${await res.text()}`);
        process.exit(1);
      }
    }
    console.log(`[wipe] storage ${bucket}: removed ${names.length} object(s)`);
  }
}
