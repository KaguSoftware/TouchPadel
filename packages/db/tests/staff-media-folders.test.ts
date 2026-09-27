/**
 * staff_media_folders (build-contracts-2026-09-23 §2.24.2, §2.1): three more
 * work-photo folders, the bar and kitchen teams, and who reads the photos of
 * the role spec's records.
 *
 *   * a slot is minted in checklists, teachings and requests, and still in
 *     the six folders of 0159; a new-folder path passes the table's CHECKs and
 *     app.is_staff_media_path; the helpers still answer false / NULL on a
 *     menu-media name (`items/…`), and menu-media still works for staff;
 *   * app.staff_team and app.staff_team_head map the four bar and kitchen
 *     roles, and nothing else, and are no client's to call;
 *   * a checklist_item: photo is readable, through the storage policy, by its
 *     uploader, MGMT and the holders of the list's role, and by no one else:
 *     not the driver, marketing, the head of the team or a cashier;
 *   * a photo claimed under a kind whose row does not exist (release_idea:,
 *     teaching:, marketing_request:) reads as the uploader's and MGMT's only;
 *   * an idea's photo reads to its team's head, and moves to the propose step
 *     of the release started from that idea, and to nothing else (with a
 *     stand-in release_ideas table when E's product_release is not applied;
 *     E's product-release.test.ts carries the real flow).
 *
 * HOW. Every database scenario is ONE psql transaction that is rolled back
 * (the protocols-engine-flow.test.ts harness): staff, lists, slots, runs and
 * storage rows are created inside it and each read runs as `authenticated`
 * with the caller's JWT claims, as PostgREST and the storage API run them.
 * The menu-media case goes through the storage API and removes its object.
 * Without docker on PATH the database cases skip themselves.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
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
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('venue', '${VENUE_A_ID}');

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
  values (v, 'smf-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SMF ' || p_name, p_role, true);
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

// incidents since staff_media_incidents (wave5-addendum §2.4; its own file
// is tests/staff-media-incidents.test.ts).
const FOLDERS = [
  'proposals', 'tests', 'steps', 'marketing', 'campaigns', 'receipts', 'checklists', 'teachings', 'requests',
  'incidents',
];
const NEW_FOLDERS = ['checklists', 'teachings', 'requests'];

describe.skipIf(!docker)('staff_media_folders (rolled-back transactions)', () => {
  it('mints a slot in the three new folders and the six old ones; the grammar and CHECKs take them', () => {
    const r = scenario([
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      ...FOLDERS.map((f) => T(`slot_${f}`, 'drv', `select app.staff_media_slot({{venue}}, '${f}', 'jpg')`)),
      T('slot_mkt', 'mkt', `select app.staff_media_slot({{venue}}, 'requests', 'png')`),
      T('slot_bad', 'drv', `select app.staff_media_slot({{venue}}, 'selfies', 'jpg')`),
      ...NEW_FOLDERS.map((f) =>
        Q(`path_${f}`, `select jsonb_build_object(
             'is_path', app.is_staff_media_path(${`'${VENUE_A_ID}/${f}/'`} || gen_random_uuid() || '.webp'),
             'folder', app.staff_media_folder(${`'${VENUE_A_ID}/${f}/'`} || gen_random_uuid() || '.webp'),
             'venue', app.staff_media_venue(${`'${VENUE_A_ID}/${f}/'`} || gen_random_uuid() || '.webp'))`)),
      Q('menu_names', `select jsonb_build_object(
           'is_path', app.is_staff_media_path('items/abc/photo.webp'),
           'folder', app.staff_media_folder('items/abc/photo.webp'),
           'venue', app.staff_media_venue('items/abc/photo.webp'),
           'selfies', app.is_staff_media_path('${VENUE_A_ID}/selfies/' || gen_random_uuid() || '.jpg'),
           'null', app.is_staff_media_path(null))`),
      // The table's CHECKs, written out without the helpers: a new folder
      // passes, a folder that disagrees with the path does not.
      Q('check_ok', `with x as (insert into staff_media_uploads (path, venue_id, folder, uploader)
                       values ('${VENUE_A_ID}/teachings/' || gen_random_uuid() || '.jpg', {{venue}}, 'teachings', {{manager}}::uuid)
                       returning 1) select to_jsonb(count(*)) from x`),
      Q('constraints', `select jsonb_object_agg(conname, convalidated) from pg_constraint
                         where conrelid = 'public.staff_media_uploads'::regclass
                           and conname in ('staff_media_uploads_folder_check', 'staff_media_uploads_path_chk')`),
    ]);
    for (const f of FOLDERS) {
      const path = ok<{ path: string; bucket: string }>(r, `slot_${f}`).path;
      expect(path, f).toMatch(new RegExp(`^${VENUE_A_ID}/${f}/[0-9a-f-]{36}\\.jpg$`));
    }
    expect(ok<{ path: string }>(r, 'slot_mkt').path).toMatch(/\/requests\/[0-9a-f-]{36}\.png$/);
    expect(refused(r, 'slot_bad')).toBe('INVALID_ARGUMENT:folder');
    for (const f of NEW_FOLDERS) {
      expect(ok(r, `path_${f}`), f).toEqual({ is_path: true, folder: f, venue: VENUE_A_ID });
    }
    expect(ok(r, 'menu_names')).toEqual({ is_path: false, folder: null, venue: null, selfies: false, null: false });
    expect(ok<number>(r, 'check_ok')).toBe(1);
    expect(ok(r, 'constraints')).toEqual({ staff_media_uploads_folder_check: true, staff_media_uploads_path_chk: true });
  });

  it('refuses a new-folder row that disagrees with its path', () => {
    expect(() =>
      psql(`begin;
        insert into staff_media_uploads (path, venue_id, folder, uploader)
        values ('${VENUE_A_ID}/teachings/' || gen_random_uuid() || '.jpg', '${VENUE_A_ID}', 'requests',
                '${SEED_STAFF_IDS.manager}');
        rollback;`),
    ).toThrow(/staff_media_uploads_path_chk/);
    expect(() =>
      psql(`begin;
        insert into staff_media_uploads (path, venue_id, folder, uploader)
        values ('${VENUE_A_ID}/selfies/' || gen_random_uuid() || '.jpg', '${VENUE_A_ID}', 'selfies',
                '${SEED_STAFF_IDS.manager}');
        rollback;`),
    ).toThrow(/staff_media_uploads_(folder_check|path_chk)/);
  });

  it('maps the teams, and keeps the two helpers from every client', () => {
    const r = scenario([
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      MK('hb', 'head_barista'),
      Q('teams', `select jsonb_object_agg(r::text, jsonb_build_object('team', app.staff_team(r), 'head',
                     app.staff_team_head(app.staff_team(r))))
                    from unnest(enum_range(null::staff_role)) r`),
      Q('heads', `select jsonb_build_object('bar', app.staff_team_head('bar'), 'kitchen', app.staff_team_head('kitchen'),
                                            'court', app.staff_team_head('court'), 'none', app.staff_team_head(null))`),
      ...(['drv', 'mkt', 'hb', 'manager'] as const).flatMap((who) => [
        T(`team_${who}`, who, `select to_jsonb(app.staff_team('barista'))`),
        T(`head_${who}`, who, `select to_jsonb(app.staff_team_head('bar'))`),
      ]),
    ]);
    const teams = ok<Record<string, { team: string | null; head: string | null }>>(r, 'teams');
    expect(teams).toMatchObject({
      head_barista: { team: 'bar', head: 'head_barista' },
      barista: { team: 'bar', head: 'head_barista' },
      head_chef: { team: 'kitchen', head: 'head_chef' },
      chef: { team: 'kitchen', head: 'head_chef' },
    });
    for (const role of ['cashier', 'prep', 'court_desk', 'manager', 'owner', 'driver', 'marketing']) {
      expect(teams[role], role).toEqual({ team: null, head: null });
    }
    expect(ok(r, 'heads')).toEqual({ bar: 'head_barista', kitchen: 'head_chef', court: null, none: null });
    for (const who of ['drv', 'mkt', 'hb', 'manager']) {
      expect(refused(r, `team_${who}`), who).toMatch(/permission denied/);
      expect(refused(r, `head_${who}`), who).toMatch(/permission denied/);
    }
  });

  it('shows a checklist tick’s photo to the list’s role, MGMT and the uploader only', () => {
    const r = scenario([
      // No lists at all, whatever another session committed: removed inside
      // the transaction, so the rollback puts them back.
      `delete from checklist_run_items; delete from checklist_runs;
       delete from checklist_template_items; delete from checklist_templates;`,
      MK('bar1', 'barista'),
      MK('bar2', 'barista'),
      MK('hb', 'head_barista'),
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      T('tpl', 'owner', `select app.save_checklist_template({{venue}}, 'barista', 'close', 0, 'Bar closing', 'إغلاق البار',
                          '[{"text_en":"Photo of the clean bar","text_ar":"صورة البار نظيفًا"}]'::jsonb)`),
      T('today', 'bar1', `select app.my_checklists_today({{venue}})`),
      KEEP('item', `select res #>> '{data,lists,0,items,0,id}' from pg_temp.out where label = 'today'`),
      PHOTO('tick_photo', 'bar1', 'checklists'),
      CLAIM('claim', 'bar1', 'tick_photo', 'checklists', `'checklist_item:' || {{item}}`),
      ...(['bar1', 'bar2', 'manager', 'owner', 'hb', 'drv', 'mkt', 'cashier'] as const).map((who) =>
        SEES(`sees_${who}`, who, 'tick_photo')),
      ...(['bar2', 'drv', 'mkt'] as const).map((who) =>
        T(`fn_${who}`, who, `select to_jsonb(app.staff_media_visible({{tick_photo}}))`)),
    ]);
    ok(r, 'claim');
    for (const who of ['bar1', 'bar2', 'manager', 'owner']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(true);
    for (const who of ['hb', 'drv', 'mkt', 'cashier']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(false);
    expect(ok<boolean>(r, 'fn_bar2')).toBe(true);
    expect(ok<boolean>(r, 'fn_drv')).toBe(false);
    expect(ok<boolean>(r, 'fn_mkt')).toBe(false);
  });

  it('keeps a photo claimed under a kind whose row does not exist to its uploader and MGMT', () => {
    const kinds = ['release_idea', 'teaching', 'marketing_request'];
    const r = scenario([
      MK('hb', 'head_barista'),
      MK('bar', 'barista'),
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      ...kinds.flatMap((k, i) => [
        PHOTO(`p${i}`, 'bar', i === 0 ? 'proposals' : i === 1 ? 'teachings' : 'requests'),
        CLAIM(`claim${i}`, 'bar', `p${i}`, i === 0 ? 'proposals' : i === 1 ? 'teachings' : 'requests',
              `'${k}:' || gen_random_uuid()`),
        ...(['bar', 'manager', 'owner', 'hb', 'drv', 'mkt', 'cashier'] as const).map((who) =>
          SEES(`sees${i}_${who}`, who, `p${i}`)),
      ]),
    ]);
    kinds.forEach((k, i) => {
      ok(r, `claim${i}`);
      for (const who of ['bar', 'manager', 'owner']) expect(ok<boolean>(r, `sees${i}_${who}`), `${k} ${who}`).toBe(true);
      for (const who of ['hb', 'drv', 'mkt', 'cashier']) {
        expect(ok<boolean>(r, `sees${i}_${who}`), `${k} ${who}`).toBe(false);
      }
    });
  });

  it('shows an idea’s photo to its team’s head, and moves it only to the propose step of its own release', () => {
    // E's product_release creates release_ideas; until it is applied, a
    // stand-in with the columns the two rules read (§2.9).
    const r = scenario([
      `create table if not exists public.release_ideas (
         id uuid primary key default gen_random_uuid(), venue_id uuid not null, team text not null,
         author_id uuid not null, record jsonb not null, photos text[] not null default '{}',
         status text not null default 'waiting', run_id uuid);`,
      MK('bar', 'barista'),
      MK('hb', 'head_barista'),
      MK('hc', 'head_chef'),
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      PHOTO('idea_photo', 'bar', 'proposals'),
      KEEP('idea', `insert into release_ideas (venue_id, team, author_id, record, photos)
                    values ({{venue}}, 'bar', {{bar}}::uuid, '{}'::jsonb, array[{{idea_photo}}]) returning id::text`),
      KEEP('other_idea', `insert into release_ideas (venue_id, team, author_id, record)
                          values ({{venue}}, 'bar', {{bar}}::uuid, '{}'::jsonb) returning id::text`),
      CLAIM('claim_idea', 'bar', 'idea_photo', 'proposals', `'release_idea:' || {{idea}}`),
      ...(['bar', 'hb', 'manager', 'owner', 'hc', 'drv', 'mkt'] as const).map((who) =>
        SEES(`sees_${who}`, who, 'idea_photo')),

      // Runs written straight to the tables: the one started from the idea,
      // and another naming a different idea.
      KEEP('tpl', `select id::text from protocol_templates where venue_id = {{venue}} and kind = 'product_release'`),
      KEEP('run', `insert into protocol_runs (venue_id, template_id, template_version, kind, title_en, started_by, data)
                   values ({{venue}}, {{tpl}}::uuid, 1, 'product_release', 'Rose latte', {{hb}}::uuid,
                           jsonb_build_object('idea_id', {{idea}})) returning id::text`),
      KEEP('run2', `insert into protocol_runs (venue_id, template_id, template_version, kind, title_en, started_by, data)
                    values ({{venue}}, {{tpl}}::uuid, 1, 'product_release', 'Other', {{hb}}::uuid,
                            jsonb_build_object('idea_id', {{other_idea}})) returning id::text`),
      ...(['run', 'run2'] as const).flatMap((run) => [
        KEEP(`${run}_propose`, `insert into protocol_run_steps (run_id, position, step_key, name_en, name_ar, actor_roles,
                                  needs_owner_ok, optional, status)
                                values ({{${run}}}::uuid, 1, 'propose', 'Propose', 'اقتراح', '{head_barista}', false, false, 'open')
                                returning id::text`),
        KEEP(`${run}_test`, `insert into protocol_run_steps (run_id, position, step_key, name_en, name_ar, actor_roles,
                               needs_owner_ok, optional)
                             values ({{${run}}}::uuid, 2, 'test', 'Test', 'تجربة', '{head_barista}', false, false)
                             returning id::text`),
      ]),
      KEEP('sub_other_run', `insert into protocol_submissions (run_step_id, run_id, round, submitted_by, record)
                             values ({{run2_propose}}::uuid, {{run2}}::uuid, 1, {{hb}}::uuid, '{}') returning id::text`),
      KEEP('sub_test_step', `insert into protocol_submissions (run_step_id, run_id, round, submitted_by, record)
                             values ({{run_test}}::uuid, {{run}}::uuid, 1, {{hb}}::uuid, '{}') returning id::text`),
      KEEP('sub', `insert into protocol_submissions (run_step_id, run_id, round, submitted_by, record, photos)
                   values ({{run_propose}}::uuid, {{run}}::uuid, 1, {{hb}}::uuid, '{}', array[{{idea_photo}}])
                   returning id::text`),
      CLAIM('to_other_run', 'hb', 'idea_photo', 'proposals', `'protocol_submission:' || {{sub_other_run}}`),
      CLAIM('to_test_step', 'hb', 'idea_photo', 'proposals', `'protocol_submission:' || {{sub_test_step}}`),
      CLAIM('to_note', 'hb', 'idea_photo', 'proposals', `'marketing_note:' || gen_random_uuid()`),
      CLAIM('to_propose', 'hb', 'idea_photo', 'proposals', `'protocol_submission:' || {{sub}}`),
      Q('used_by', `select to_jsonb(used_by = 'protocol_submission:' || {{sub}}) from staff_media_uploads
                     where path = {{idea_photo}}`),
      Q('idea_keeps', `select to_jsonb({{idea_photo}} = any(photos)) from release_ideas where id = {{idea}}::uuid`),
    ]);
    ok(r, 'claim_idea');
    for (const who of ['bar', 'hb', 'manager', 'owner']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(true);
    for (const who of ['hc', 'drv', 'mkt']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(false);
    expect(refused(r, 'to_other_run')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'to_test_step')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'to_note')).toBe('PHOTO_PATH_INVALID');
    ok(r, 'to_propose');
    expect(ok<boolean>(r, 'used_by')).toBe(true);
    expect(ok<boolean>(r, 'idea_keeps')).toBe(true);
  });
});

describe.skipIf(!up)('staff_media_folders: menu-media is untouched', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let guest: SupabaseClient;
  let storageUp = false;
  const made: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    guest = await anonymousSessionClient();
    const bucket = await svc.storage.getBucket('menu-media').catch(() => ({ data: null, error: { message: 'x' } }));
    storageUp = !bucket.error && !!bucket.data;
  });

  afterAll(async () => {
    if (made.length) await svc.storage.from('menu-media').remove(made);
    for (const c of [manager, cashier, guest]) await c?.auth.signOut();
  });

  it('lets staff upload and read menu photos, and guests read them', async (ctx) => {
    if (!storageUp) return ctx.skip();
    const path = `items/staff-media-folders-probe/${Date.now()}.webp`;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
    const put = await manager.storage.from('menu-media').upload(path, bytes, { contentType: 'image/webp', upsert: true });
    expect(put.error, put.error?.message).toBeNull();
    made.push(path);
    for (const c of [manager, cashier, guest]) {
      const dl = await c.storage.from('menu-media').download(path);
      expect(dl.error, 'menu-media read').toBeNull();
    }
  });
});
