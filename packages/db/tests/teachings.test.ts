/**
 * teachings (build-contracts-2026-09-23 §2.24.3, §2.21, §2.22, §8.2): what the
 * head barista and the head chef teach their team.
 *
 *   * a head writes for their own team and is refused the other; MGMT writes
 *     for either and must name it; the barista, the chef and everyone outside
 *     the two teams are refused;
 *   * the bar reads the bar's teachings and not the kitchen's, the kitchen the
 *     reverse, MGMT both; cashier, court desk, driver, marketing and prep read
 *     none, through the RPC or the table;
 *   * the author and MGMT edit and archive, another head may not; an archived
 *     teaching leaves the list and its photo leaves the team's reads;
 *   * a new teaching pushes teaching_new to its team only, never the author;
 *     an edit pushes nothing; the audit rows carry no text.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, teachings, slots and storage
 * rows are created inside it and each call runs as `authenticated` with the
 * caller's JWT claims. Nothing is committed. Without docker on PATH the suite
 * skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

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
  ('prep', '${SEED_STAFF_IDS.prep}'), ('venue', '${VENUE_A_ID}');

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
  values (v, 'tea-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'TEA ' || p_name, p_role, true);
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
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const PHOTO = (name: string, who: string, folder: string) => `select pg_temp.photo('${name}', '${who}', '${folder}');`;
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

const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
/** This transaction's pushes of one title key, to whom. */
const PUSHES = (label: string, titleKey: string) =>
  Q(label, `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                                      order by o.profile_id), '[]')
              from notification_outbox o
             where o.created_at = now() and o.payload->>'title_key' = '${titleKey}'`);

const save = (title: string, body: string, extra = '') =>
  `select app.save_teaching(${title}, ${body}${extra})`;

interface Teaching {
  id: string;
  team: string;
  title: string;
  body: string;
  photos: string[];
  author_name: string;
  mine: boolean;
  editable: boolean;
}
type List = { teachings: Teaching[]; total: number };
interface Push {
  to: string;
  kind: string;
  payload: Record<string, unknown>;
}

const TEAM_ROLES = ['hb', 'bar', 'hc', 'chef'] as const;
const OUTSIDERS = ['cashier', 'desk', 'drv', 'mkt', 'prep'] as const;

describe.skipIf(!docker)('teachings (rolled-back transactions)', () => {
  it('a head writes for their own team, MGMT for either; the team reads its own; the push reaches the team', () => {
    const r = scenario([
      MK('hb', 'head_barista'), MK('bar', 'barista'), MK('hc', 'head_chef'), MK('chef', 'chef'),
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      T('hb_new', 'hb', save(`'  Milk texture  '`, `'Stretch to 60 degrees, then stop.'`, `, p_venue_id => {{venue}}`)),
      PUSHES('push_new', 'teaching_new'),
      T('hb_kitchen', 'hb', save(`'x'`, `'y'`, `, p_team => 'kitchen', p_venue_id => {{venue}}`)),
      T('hb_bar_named', 'hb', save(`'Grind size'`, `'Finer for the new beans.'`, `, p_team => 'bar'`)),
      T('hc_new', 'hc', save(`'Brownie bake'`, `'22 minutes, not 25.'`, `, p_venue_id => {{venue}}`)),
      T('mgr_no_team', 'manager', save(`'x'`, `'y'`, `, p_venue_id => {{venue}}`)),
      T('mgr_bad_team', 'manager', save(`'x'`, `'y'`, `, p_team => 'court', p_venue_id => {{venue}}`)),
      T('mgr_kitchen', 'manager', save(`'Allergens'`, `'Label every nut tray.'`, `, p_team => 'kitchen', p_venue_id => {{venue}}`)),
      T('owner_bar', 'owner', save(`'Opening'`, `'Grinder on first.'`, `, p_team => 'bar', p_venue_id => {{venue}}`)),
      T('replay1', 'hb', save(`'Replay'`, `'Once.'`, `, p_idempotency_key => 'TEACH-KEY-1'`)),
      T('replay2', 'hb', save(`'Replay'`, `'Once.'`, `, p_idempotency_key => 'TEACH-KEY-1'`)),
      Q('replay_rows', `select to_jsonb(count(*)) from teachings where title = 'Replay'`),
      T('no_title', 'hb', save(`'   '`, `'y'`)),
      T('no_body', 'hb', save(`'x'`, `null`)),
      T('long_title', 'hb', save(`repeat('t', 121)`, `'y'`)),
      T('long_body', 'hb', save(`'x'`, `repeat('b', 4001)`)),
      T('other_venue', 'hb', save(`'x'`, `'y'`, `, p_venue_id => '00000000-0000-4000-8000-00000000fade'`)),
      ...(['bar', 'chef', ...OUTSIDERS] as const).map((who) => T(`new_${who}`, who, save(`'x'`, `'y'`, `, p_team => 'bar'`))),

      ...[...TEAM_ROLES, 'manager', 'owner'].map((who) => T(`list_${who}`, who, `select app.teachings_for_me({{venue}})`)),
      T('list_mgr_bar', 'manager', `select app.teachings_for_me({{venue}}, 'bar')`),
      T('list_bar_kitchen', 'bar', `select app.teachings_for_me({{venue}}, 'kitchen')`),
      T('list_bar_bar', 'bar', `select app.teachings_for_me({{venue}}, 'bar', 1, 0)`),
      T('list_bad_team', 'manager', `select app.teachings_for_me({{venue}}, 'court')`),
      ...OUTSIDERS.map((who) => T(`list_${who}`, who, `select app.teachings_for_me({{venue}})`)),
      // §8.2: the table itself is MGMT's.
      ...(['bar', 'hb', 'drv', 'mkt', 'manager'] as const).map((who) =>
        T(`read_${who}`, who, `select to_jsonb(count(*)) from teachings`)),
    ]);

    const first = ok<{ id: string }>(r, 'hb_new').id;
    const pushes = ok<Push[]>(r, 'push_new').filter((p) => p.payload.id === first);
    expect(pushes.length).toBeGreaterThan(0);
    for (const p of pushes) {
      expect(p.kind).toBe('staff_info');
      expect(p.payload).toEqual({ route: 'staff', id: first, title_key: 'teaching_new',
                                  params: { name: 'TEA hb', title: 'Milk texture' }, dedupe: expect.stringMatching(/^teaching:/) });
    }
    expect(refused(r, 'hb_kitchen')).toBe('FORBIDDEN');
    ok(r, 'hb_bar_named');
    ok(r, 'hc_new');
    expect(refused(r, 'mgr_no_team')).toBe('INVALID_ARGUMENT:team');
    expect(refused(r, 'mgr_bad_team')).toBe('INVALID_ARGUMENT:team');
    ok(r, 'mgr_kitchen');
    ok(r, 'owner_bar');
    expect(ok<{ id: string; duplicate: boolean }>(r, 'replay2'))
      .toEqual({ id: ok<{ id: string }>(r, 'replay1').id, duplicate: true });
    expect(ok<number>(r, 'replay_rows')).toBe(1);
    expect(refused(r, 'no_title')).toBe('TEXT_REQUIRED:title');
    expect(refused(r, 'no_body')).toBe('TEXT_REQUIRED:body');
    expect(refused(r, 'long_title')).toBe('TEXT_TOO_LONG:title');
    expect(refused(r, 'long_body')).toBe('TEXT_TOO_LONG:body');
    expect(refused(r, 'other_venue')).toBe('FORBIDDEN');
    for (const who of ['bar', 'chef', ...OUTSIDERS]) expect(refused(r, `new_${who}`), who).toBe('FORBIDDEN');

    const titles = (who: string) => ok<List>(r, `list_${who}`).teachings.map((t) => t.title);
    for (const who of ['hb', 'bar']) {
      expect(titles(who), who).toEqual(expect.arrayContaining(['Milk texture', 'Grind size', 'Opening', 'Replay']));
      expect(titles(who), who).not.toContain('Brownie bake');
      expect(titles(who), who).not.toContain('Allergens');
    }
    for (const who of ['hc', 'chef']) {
      expect(titles(who), who).toEqual(expect.arrayContaining(['Brownie bake', 'Allergens']));
      expect(titles(who), who).not.toContain('Milk texture');
    }
    for (const who of ['manager', 'owner']) {
      expect(titles(who), who).toEqual(expect.arrayContaining(['Milk texture', 'Brownie bake', 'Allergens', 'Opening']));
    }
    const mine = ok<List>(r, 'list_hb').teachings.find((t) => t.id === first)!;
    expect(mine).toMatchObject({ team: 'bar', title: 'Milk texture', body: 'Stretch to 60 degrees, then stop.',
                                 photos: [], author_name: 'TEA hb', mine: true, editable: true });
    expect(ok<List>(r, 'list_bar').teachings.find((t) => t.id === first))
      .toMatchObject({ mine: false, editable: false });
    expect(ok<List>(r, 'list_manager').teachings.find((t) => t.id === first))
      .toMatchObject({ mine: false, editable: true });
    expect(ok<List>(r, 'list_mgr_bar').teachings.every((t) => t.team === 'bar')).toBe(true);
    expect(refused(r, 'list_bar_kitchen')).toBe('FORBIDDEN');
    const paged = ok<List>(r, 'list_bar_bar');
    expect(paged.teachings).toHaveLength(1);
    expect(paged.total).toBe(ok<List>(r, 'list_bar').total);
    expect(refused(r, 'list_bad_team')).toBe('INVALID_ARGUMENT:team');
    for (const who of OUTSIDERS) expect(refused(r, `list_${who}`), who).toBe('FORBIDDEN');
    for (const who of ['bar', 'hb', 'drv', 'mkt']) expect(ok<number>(r, `read_${who}`), who).toBe(0);
    expect(ok<number>(r, `read_manager`)).toBeGreaterThan(0);
  });

  it('sends teaching_new to the team only, never to the author or the other team', () => {
    const r = scenario([
      MK('hb', 'head_barista'), MK('bar', 'barista'), MK('hc', 'head_chef'), MK('chef', 'chef'),
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      T('new', 'hb', save(`'Milk texture'`, `'60 degrees.'`, `, p_venue_id => {{venue}}`)),
      RES('t', 'new', 'id'),
      Q('to', `select jsonb_object_agg(v.name, exists (select 1 from notification_outbox o
                  where o.created_at = now() and o.payload->>'title_key' = 'teaching_new'
                    and o.payload->>'id' = {{t}} and o.profile_id = v.val::uuid))
                 from pg_temp.vars v where v.name in ('hb','bar','hc','chef','drv','mkt','manager','owner')`),
      Q('before_edit', `select to_jsonb(count(*)) from notification_outbox o
                         where o.created_at = now() and o.payload->>'title_key' = 'teaching_new'`),
      T('edit', 'hb', save(`'Milk texture'`, `'65 degrees.'`, `, p_id => {{t}}`)),
      Q('after_edit', `select to_jsonb(count(*)) from notification_outbox o
                        where o.created_at = now() and o.payload->>'title_key' = 'teaching_new'`),
    ]);
    expect(ok(r, 'to')).toEqual({ hb: false, bar: true, hc: false, chef: false, drv: false, mkt: false,
                                  manager: false, owner: false });
    ok(r, 'edit');
    // An edit tells no one.
    expect(ok<number>(r, 'after_edit')).toBe(ok<number>(r, 'before_edit'));
  });

  it('the author and MGMT edit and archive; another head may not; an archived teaching and its photo leave the team', () => {
    const r = scenario([
      MK('hb', 'head_barista'), MK('hb2', 'head_barista'), MK('bar', 'barista'), MK('chef', 'chef'),
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      PHOTO('p1', 'hb', 'teachings'),
      PHOTO('p_steps', 'hb', 'steps'),
      PHOTO('p_other', 'bar', 'teachings'),
      T('new', 'hb', save(`'Milk texture'`, `'60 degrees.'`, `, p_photos => array[{{p1}}, {{p1}}], p_venue_id => {{venue}}`)),
      RES('t', 'new', 'id'),
      Q('claimed', `select to_jsonb(used_by) from staff_media_uploads where path = {{p1}}`),
      T('wrong_folder', 'hb', save(`'x'`, `'y'`, `, p_photos => array[{{p_steps}}], p_venue_id => {{venue}}`)),
      T('foreign_photo', 'hb', save(`'x'`, `'y'`, `, p_photos => array[{{p_other}}], p_venue_id => {{venue}}`)),
      T('too_many', 'hb', save(`'x'`, `'y'`, `, p_photos => array['a','b','c','d','e','f','g'], p_venue_id => {{venue}}`)),
      ...(['bar', 'chef', 'hb2', 'drv', 'mkt', 'manager'] as const).map((who) => SEES(`sees_${who}`, who, 'p1')),

      T('edit_author', 'hb', save(`'Milk texture'`, `'65 degrees.'`, `, p_id => {{t}}, p_photos => array[{{p1}}]`)),
      T('edit_mgr', 'manager', save(`'Milk texture (v2)'`, `'65 degrees.'`, `, p_id => {{t}}`)),
      T('edit_team', 'manager', save(`'x'`, `'y'`, `, p_id => {{t}}, p_team => 'kitchen'`)),
      T('edit_other_head', 'hb2', save(`'x'`, `'y'`, `, p_id => {{t}}`)),
      T('edit_barista', 'bar', save(`'x'`, `'y'`, `, p_id => {{t}}`)),
      T('edit_drv', 'drv', save(`'x'`, `'y'`, `, p_id => {{t}}`)),
      T('edit_missing', 'hb', save(`'x'`, `'y'`, `, p_id => gen_random_uuid()`)),
      T('arch_other_head', 'hb2', `select to_jsonb(true) from (select app.archive_teaching({{t}})) x`),
      T('arch_mkt', 'mkt', `select to_jsonb(true) from (select app.archive_teaching({{t}})) x`),
      T('arch_drv', 'drv', `select to_jsonb(true) from (select app.archive_teaching({{t}})) x`),
      T('arch', 'hb', `select to_jsonb(true) from (select app.archive_teaching({{t}})) x`),
      T('arch_again', 'manager', `select to_jsonb(true) from (select app.archive_teaching({{t}})) x`),
      T('edit_archived', 'hb', save(`'x'`, `'y'`, `, p_id => {{t}}`)),
      T('list_after', 'bar', `select app.teachings_for_me({{venue}})`),
      ...(['bar', 'hb', 'manager'] as const).map((who) => SEES(`after_${who}`, who, 'p1')),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'after', a.after) order by a.at, a.id)
                    from audit_log a where a.entity = 'teaching' and a.entity_id = {{t}}`),
    ]);
    ok(r, 'new');
    expect(ok<string>(r, 'claimed')).toBe(`teaching:${ok<{ id: string }>(r, 'new').id}`);
    expect(refused(r, 'wrong_folder')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'foreign_photo')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'too_many')).toBe('INVALID_ARGUMENT:photos');
    // A current teaching's photo: its team (the head who wrote it is the
    // uploader) and MGMT; not the kitchen, not a driver or marketing.
    expect(ok<boolean>(r, 'sees_bar')).toBe(true);
    expect(ok<boolean>(r, 'sees_hb2')).toBe(true);
    expect(ok<boolean>(r, 'sees_manager')).toBe(true);
    for (const who of ['chef', 'drv', 'mkt']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(false);

    ok(r, 'edit_author');
    ok(r, 'edit_mgr');
    expect(refused(r, 'edit_team')).toBe('INVALID_ARGUMENT:team');
    for (const who of ['edit_other_head', 'edit_barista', 'edit_drv', 'arch_other_head', 'arch_mkt', 'arch_drv']) {
      expect(refused(r, who), who).toBe('FORBIDDEN');
    }
    expect(refused(r, 'edit_missing')).toBe('REF_NOT_FOUND:id');
    ok(r, 'arch');
    expect(refused(r, 'arch_again')).toBe('REF_NOT_FOUND:id');
    expect(refused(r, 'edit_archived')).toBe('REF_NOT_FOUND:id');
    expect(ok<List>(r, 'list_after').teachings.map((t) => t.id)).not.toContain(ok<{ id: string }>(r, 'new').id);
    expect(ok<boolean>(r, 'after_bar')).toBe(false);
    expect(ok<boolean>(r, 'after_hb')).toBe(true);
    expect(ok<boolean>(r, 'after_manager')).toBe(true);
    // Ids and counts only: never the title or the body.
    const audit = ok<Array<{ action: string; after: Record<string, unknown> }>>(r, 'audit');
    expect(audit.map((a) => a.action)).toEqual(['teaching.save', 'teaching.save', 'teaching.save', 'teaching.archive']);
    expect(audit[0]!.after).toEqual({ team: 'bar', photos: 1, edit: false });
    expect(JSON.stringify(audit)).not.toMatch(/Milk|degrees/);
  });
});
