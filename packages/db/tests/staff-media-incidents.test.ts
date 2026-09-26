/**
 * staff_media_incidents (wave5-addendum-2026-09-25 §2.4, §6.1): the incidents
 * photo folder, and who reads a marketing content item's images.
 *
 *   * a slot is minted in incidents by any role, the driver and marketing
 *     included, and still in the nine folders of 0170; an incidents path
 *     passes the table's CHECKs and the path helpers, which still answer
 *     false / NULL on a menu-media name (`items/…`); menu-media still works
 *     for staff and guests;
 *   * app.is_staff_media_path keeps its form (M1): language sql, immutable,
 *     no SET clause, granted to anon, authenticated and service_role;
 *   * the client twins name the same ten folders: @touch/core PHOTO_FOLDERS
 *     and protocol-action's STAFF_MEDIA_PATH_RE;
 *   * an incident's photo reads to its uploader and MGMT only: not another
 *     court desk account, a cashier, the driver or marketing; and nobody
 *     deletes it through storage (staff_media_delete), while MGMT still
 *     delete the other folders' photos;
 *   * a content item's image reads to its uploader, marketing and the owners
 *     at the venue, and not to a manager (V4), a driver or a cashier (with a
 *     stand-in marketing_content table when P's marketing_content is not
 *     applied; marketing-content.test.ts carries the real flow).
 *
 * HOW. Every database scenario is ONE psql transaction that is rolled back
 * (the protocols-engine-flow.test.ts harness): staff, slots and storage rows
 * are created inside it and each read runs as `authenticated` with the
 * caller's JWT claims, as PostgREST and the storage API run them. The
 * menu-media case goes through the storage API and removes its object.
 * Without docker on PATH the database cases skip themselves.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTO_FOLDERS } from '../../core/src/protocols/types';
import { STAFF_MEDIA_PATH_RE } from '../supabase/functions/protocol-action/logic.ts';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

// ── the in-transaction harness (as protocols-engine-flow.test.ts) ──────────
// t() runs one statement as a staff member (as `authenticated`); as() runs it
// as the definer's caller (postgres, with the JWT claims set) for internal
// functions; q() reads as postgres; keep() stores a value; mk() makes an auth
// user + staff row (the 0123 trigger files a non-owner at venue A).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('venue', '${VENUE_A_ID}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

create function pg_temp.run(p_label text, p_who text, p_sql text, p_role text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if p_role is not null then execute 'set local role ' || p_role; end if;
  begin
    execute v_sql into v_res;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, '')));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'smi-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SMI ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- A photo: a slot minted by p_who in p_folder, and its storage object.
create function pg_temp.photo(p_name text, p_who text, p_folder text) returns void language plpgsql as $f$
declare v_uid uuid; v_path text;
begin
  select val::uuid into v_uid from pg_temp.vars where name = p_who;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_path := app.staff_media_slot('${VENUE_A_ID}', p_folder, 'jpg')->>'path';
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('staff-media', v_path, v_uid, v_uid::text);
  insert into pg_temp.vars values (p_name, v_path);
end $f$;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
}
type Results = Record<string, Outcome>;

function scenario(body: string[]): Results {
  const raw = psql(
    `begin;\n${PRELUDE}\n${body.join('\n')}\n` +
      `select label || E'\\t' || res::text from pg_temp.out order by seq;\nrollback;\n`,
  );
  const results: Results = {};
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    results[line.slice(0, tab)] = JSON.parse(line.slice(tab + 1)) as Outcome;
  }
  return results;
}

const T = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, 'authenticated');`;
const AS = (label: string, who: string, sql: string) => `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, null);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const PHOTO = (name: string, who: string, folder: string) => `select pg_temp.photo('${name}', '${who}', '${folder}');`;
const CLAIM = (label: string, who: string, photo: string, folder: string, usedBy: string) =>
  AS(label, who, `select to_jsonb(true) from (select app.claim_staff_media(array[{{${photo}}}], {{venue}}, array['${folder}'], ${usedBy})) x`);
/** Through the staff_media_read storage policy, as the reader. */
const SEES = (label: string, who: string, photo: string) =>
  T(label, who, `select to_jsonb(count(*) = 1) from storage.objects where bucket_id = 'staff-media' and name = {{${photo}}}`);

function ok<T>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as T;
}
function refused(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return o!.hint ? `${o!.code}:${o!.hint}` : o!.code!;
}

const OLD_FOLDERS = ['proposals', 'tests', 'steps', 'marketing', 'campaigns', 'receipts', 'checklists', 'teachings', 'requests'];
const FOLDERS = [...OLD_FOLDERS, 'incidents'];

describe('staff_media_incidents: the client twins', () => {
  it('@touch/core PHOTO_FOLDERS and protocol-action name the ten folders', () => {
    expect([...PHOTO_FOLDERS]).toEqual(FOLDERS);
    const photo = `${VENUE_A_ID}/incidents/44444444-4444-4444-8444-444444444444.jpg`;
    expect(STAFF_MEDIA_PATH_RE.test(photo)).toBe(true);
    expect(STAFF_MEDIA_PATH_RE.test(photo.replace('incidents', 'selfies'))).toBe(false);
  });
});

describe.skipIf(!docker)('staff_media_incidents (rolled-back transactions)', () => {
  it('mints an incidents slot for any role, and still the nine old folders; the CHECKs and helpers take it', () => {
    const r = scenario([
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      ...FOLDERS.map((f) => T(`slot_${f}`, 'drv', `select app.staff_media_slot({{venue}}, '${f}', 'jpg')`)),
      T('slot_mkt', 'mkt', `select app.staff_media_slot({{venue}}, 'incidents', 'webp')`),
      T('slot_desk', 'desk', `select app.staff_media_slot({{venue}}, 'incidents', 'png')`),
      T('slot_bad', 'drv', `select app.staff_media_slot({{venue}}, 'selfies', 'jpg')`),
      Q('path', `select jsonb_build_object(
           'is_path', app.is_staff_media_path('${VENUE_A_ID}/incidents/' || gen_random_uuid() || '.webp'),
           'folder', app.staff_media_folder('${VENUE_A_ID}/incidents/' || gen_random_uuid() || '.webp'),
           'venue', app.staff_media_venue('${VENUE_A_ID}/incidents/' || gen_random_uuid() || '.webp'))`),
      Q('menu_names', `select jsonb_build_object(
           'is_path', app.is_staff_media_path('items/abc/photo.webp'),
           'folder', app.staff_media_folder('items/abc/photo.webp'),
           'venue', app.staff_media_venue('items/abc/photo.webp'),
           'selfies', app.is_staff_media_path('${VENUE_A_ID}/selfies/' || gen_random_uuid() || '.jpg'),
           'null', app.is_staff_media_path(null))`),
      // The table's CHECKs, written out without the helpers.
      Q('check_ok', `with x as (insert into staff_media_uploads (path, venue_id, folder, uploader)
                       values ('${VENUE_A_ID}/incidents/' || gen_random_uuid() || '.jpg', {{venue}}, 'incidents', {{manager}}::uuid)
                       returning 1) select to_jsonb(count(*)) from x`),
      Q('constraints', `select jsonb_object_agg(conname, jsonb_build_object('valid', convalidated,
                           'incidents', pg_get_constraintdef(oid) like '%incidents%'))
                          from pg_constraint
                         where conrelid = 'public.staff_media_uploads'::regclass
                           and conname in ('staff_media_uploads_folder_check', 'staff_media_uploads_path_chk')`),
      // The folder CHECK's list, for the @touch/core twin.
      Q('folder_list', `select to_jsonb(array(select m[1] from regexp_matches(
                           pg_get_constraintdef((select oid from pg_constraint
                                                  where conrelid = 'public.staff_media_uploads'::regclass
                                                    and conname = 'staff_media_uploads_folder_check')),
                           '''([a-z]+)''', 'g') as m))`),
    ]);
    for (const f of FOLDERS) {
      const path = ok<{ path: string }>(r, `slot_${f}`).path;
      expect(path, f).toMatch(new RegExp(`^${VENUE_A_ID}/${f}/[0-9a-f-]{36}\\.jpg$`));
    }
    expect(ok<{ path: string }>(r, 'slot_mkt').path).toMatch(/\/incidents\/[0-9a-f-]{36}\.webp$/);
    expect(ok<{ path: string }>(r, 'slot_desk').path).toMatch(/\/incidents\/[0-9a-f-]{36}\.png$/);
    expect(refused(r, 'slot_bad')).toBe('INVALID_ARGUMENT:folder');
    expect(ok(r, 'path')).toEqual({ is_path: true, folder: 'incidents', venue: VENUE_A_ID });
    expect(ok(r, 'menu_names')).toEqual({ is_path: false, folder: null, venue: null, selfies: false, null: false });
    expect(ok<number>(r, 'check_ok')).toBe(1);
    expect(ok(r, 'constraints')).toEqual({
      staff_media_uploads_folder_check: { valid: true, incidents: true },
      staff_media_uploads_path_chk: { valid: true, incidents: true },
    });
    expect(ok<string[]>(r, 'folder_list')).toEqual([...PHOTO_FOLDERS]);
  });

  it('refuses an incidents row that disagrees with its path', () => {
    expect(() =>
      psql(`begin;
        insert into staff_media_uploads (path, venue_id, folder, uploader)
        values ('${VENUE_A_ID}/incidents/' || gen_random_uuid() || '.jpg', '${VENUE_A_ID}', 'receipts',
                '${SEED_STAFF_IDS.manager}');
        rollback;`),
    ).toThrow(/staff_media_uploads_path_chk/);
  });

  it('keeps app.is_staff_media_path a plain immutable sql helper for the API roles (M1)', () => {
    const r = scenario([
      Q('form', `select jsonb_build_object(
           'lang', l.lanname, 'volatile', p.provolatile, 'config', p.proconfig, 'definer', p.prosecdef,
           'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
           'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'))
         from pg_proc p join pg_language l on l.oid = p.prolang
        where p.oid = 'app.is_staff_media_path(text)'::regprocedure`),
    ]);
    expect(ok(r, 'form')).toEqual({
      lang: 'sql', volatile: 'i', config: null, definer: false,
      anon: true, authenticated: true, service_role: true,
    });
  });

  it('shows an incident’s photo to its uploader and MGMT only', () => {
    const r = scenario([
      MK('desk2', 'court_desk'),
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      MK('ab', 'assistant_barista'),
      PHOTO('p', 'desk', 'incidents'),
      // incident_reports may not exist yet: the default rule answers either way.
      CLAIM('claim', 'desk', 'p', 'incidents', `'incident:' || gen_random_uuid()`),
      ...(['desk', 'manager', 'owner', 'desk2', 'cashier', 'drv', 'mkt', 'ab'] as const).map((who) =>
        SEES(`sees_${who}`, who, 'p')),
    ]);
    ok(r, 'claim');
    for (const who of ['desk', 'manager', 'owner']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(true);
    for (const who of ['desk2', 'cashier', 'drv', 'mkt', 'ab']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(false);
  });

  it('lets nobody delete an incident’s photo through storage; MGMT still delete other staff photos', () => {
    const GONE = (label: string, who: string, photo: string) =>
      T(label, who, `with d as (delete from storage.objects where bucket_id = 'staff-media' and name = {{${photo}}} returning 1)
                     select to_jsonb(count(*)) from d`);
    const r = scenario([
      MK('mgr_named', 'manager'),
      PHOTO('p', 'desk', 'incidents'),
      CLAIM('claim', 'desk', 'p', 'incidents', `'incident:' || gen_random_uuid()`),
      PHOTO('loose', 'desk', 'incidents'),
      PHOTO('req', 'cashier', 'requests'),
      // What the storage API sets before its own DELETE.
      `select set_config('storage.allow_delete_query', 'true', true);`,
      GONE('by_manager', 'manager', 'p'),
      GONE('by_named_manager', 'mgr_named', 'p'),
      GONE('by_owner', 'owner', 'p'),
      GONE('by_uploader', 'desk', 'p'),
      GONE('loose_by_manager', 'manager', 'loose'),
      GONE('req_by_manager', 'manager', 'req'),
      Q('left', `select jsonb_build_object(
                   'p', exists (select 1 from storage.objects where bucket_id = 'staff-media' and name = {{p}}),
                   'loose', exists (select 1 from storage.objects where bucket_id = 'staff-media' and name = {{loose}}),
                   'req', exists (select 1 from storage.objects where bucket_id = 'staff-media' and name = {{req}}))`),
    ]);
    ok(r, 'claim');
    // A filed report's photo goes only by the owner's redaction or the
    // purge, both through the service role.
    for (const l of ['by_manager', 'by_named_manager', 'by_owner', 'by_uploader', 'loose_by_manager']) {
      expect(ok<number>(r, l), l).toBe(0);
    }
    expect(ok<number>(r, 'req_by_manager')).toBe(1);
    expect(ok(r, 'left')).toEqual({ p: true, loose: true, req: false });
  });

  it('shows a content item’s image to its uploader, marketing and the owners, never a manager', () => {
    const r = scenario([
      // P's marketing_content creates the table; until it is applied, a
      // stand-in with the columns the rule reads and the insert below names.
      `create table if not exists public.marketing_content (
         id uuid primary key default gen_random_uuid(), venue_id uuid not null, author_id uuid not null,
         title text not null, channel text not null, planned_for date not null);`,
      MK('mkt', 'marketing'),
      MK('mkt2', 'marketing'),
      MK('drv', 'driver'),
      MK('hb', 'head_barista'),
      KEEP('content', `insert into marketing_content (venue_id, author_id, title, channel, planned_for)
                       values ({{venue}}, {{mkt}}::uuid, 'SMI post', 'instagram', current_date + 3) returning id::text`),
      PHOTO('img', 'mkt', 'campaigns'),
      CLAIM('claim', 'mkt', 'img', 'campaigns', `'marketing_content:' || {{content}}`),
      // A claim naming a content row that does not exist reads to its uploader alone.
      PHOTO('orphan', 'mkt', 'campaigns'),
      CLAIM('claim_orphan', 'mkt', 'orphan', 'campaigns', `'marketing_content:' || gen_random_uuid()`),
      ...(['mkt', 'mkt2', 'owner', 'manager', 'drv', 'cashier', 'hb'] as const).flatMap((who) => [
        SEES(`sees_${who}`, who, 'img'),
        SEES(`orphan_${who}`, who, 'orphan'),
      ]),
    ]);
    ok(r, 'claim');
    ok(r, 'claim_orphan');
    for (const who of ['mkt', 'mkt2', 'owner']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(true);
    for (const who of ['manager', 'drv', 'cashier', 'hb']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(false);
    expect(ok<boolean>(r, 'orphan_mkt')).toBe(true);
    for (const who of ['mkt2', 'owner', 'manager', 'drv', 'cashier', 'hb']) {
      expect(ok<boolean>(r, `orphan_${who}`), who).toBe(false);
    }
  });
});

describe.skipIf(!up)('staff_media_incidents: menu-media is untouched', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let desk: SupabaseClient;
  let guest: SupabaseClient;
  let storageUp = false;
  const made: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    desk = await signedInClient(SEED_STAFF.court_desk);
    guest = await anonymousSessionClient();
    const bucket = await svc.storage.getBucket('menu-media').catch(() => ({ data: null, error: { message: 'x' } }));
    storageUp = !bucket.error && !!bucket.data;
  });

  afterAll(async () => {
    if (made.length) await svc.storage.from('menu-media').remove(made);
    for (const c of [manager, desk, guest]) await c?.auth.signOut();
  });

  it('lets staff upload and read menu photos, and guests read them', async (ctx) => {
    if (!storageUp) return ctx.skip();
    const path = `items/staff-media-incidents-probe/${Date.now()}.webp`;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
    const put = await manager.storage.from('menu-media').upload(path, bytes, { contentType: 'image/webp', upsert: true });
    expect(put.error, put.error?.message).toBeNull();
    made.push(path);
    for (const c of [manager, desk, guest]) {
      const dl = await c.storage.from('menu-media').download(path);
      expect(dl.error, 'menu-media read').toBeNull();
    }
  });
});
