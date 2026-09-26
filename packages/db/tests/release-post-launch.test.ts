/**
 * release_post_launch (build-contracts-2026-09-23 §2.10, §2.19, §2.21, §8.2):
 * what happens after a product release.
 *
 *   * the scheduled launch: due, launched with the copied menu path (a wrong
 *     one refused, a retry answered 'launched'), and reverted when the draft
 *     is no longer ready: the run back to active, the launch step reopened in
 *     a new round, the owners told launch_not_ready;
 *   * staff notes on a new item (Q9): any staff member at the venue, the
 *     driver and marketing included, for 30 days from the launch; the reads,
 *     the window, the text rules, the idempotent replay;
 *   * the day-30 review (#54): due at 30 days, saved once, the run done,
 *     review_ready to the owners and the venue's managers and never to the
 *     head chef who started it; release_review is MGMT only, the starter and
 *     the driver and marketing refused;
 *   * the photo purge of runs stopped 90 days ago, any kind;
 *   * the service-role functions refuse every client role, driver and
 *     marketing included; the two tables read nothing for them;
 *   * the two cron jobs exist and the nudges run quietly with nothing due.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * product-release.test.ts harness, plus svc() for a call as service_role).
 * Time is moved by writing the run's and the item's timestamps inside it.
 * Without docker on PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS, SEED_TAX_GROUP_STANDARD, VENUE_A_ID } from './helpers';

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

// ── the in-transaction harness (product-release.test.ts, plus svc()) ───────
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('venue', '${VENUE_A_ID}'), ('tax', '${SEED_TAX_GROUP_STANDARD}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
    v := replace(v, '@@' || r.name || '@@', r.val);
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}|@@[a-z0-9_]+@@' then
    raise exception 'unbound variable in: %', v;
  end if;
  return v;
end $f$;

create function pg_temp.call(p_label text, p_claims jsonb, p_role text, p_sql text) returns void language plpgsql as $f$
declare v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text; v_state text;
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  execute 'set local role ' || p_role;
  begin
    execute v_sql into v_res;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_state = returned_sqlstate;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, ''), 'state', v_state));
  end;
end $f$;

create function pg_temp.t(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_uid text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform pg_temp.call(p_label, jsonb_build_object('sub', v_uid, 'role', 'authenticated'), 'authenticated', p_sql);
end $f$;

create function pg_temp.svc(p_label text, p_sql text) returns void language plpgsql as $f$
begin
  perform pg_temp.call(p_label, jsonb_build_object('role', 'service_role'), 'service_role', p_sql);
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.x(p_sql text) returns void language plpgsql as $f$
begin
  execute pg_temp.sub(p_sql);
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
  values (v, 'rpl-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'RPL ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

create function pg_temp.photo(p_name text, p_who text, p_folder text) returns void language plpgsql as $f$
declare v_uid uuid;
begin
  select val::uuid into v_uid from pg_temp.vars where name = p_who;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  insert into pg_temp.vars values (p_name, app.staff_media_slot('${VENUE_A_ID}', p_folder, 'jpg')->>'path');
end $f$;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
  state?: string;
}
type Results = Record<string, Outcome>;

function scenario(body: string[]): Results {
  const raw = psql(
    `begin;\n${PRELUDE}\n${body.join('\n')}\n` +
      `insert into pg_temp.out(label, res) select '__var_' || name, jsonb_build_object('ok', true, 'data', val) from pg_temp.vars;\n` +
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

const T = (label: string, who: string, sql: string) => `select pg_temp.t('${label}', '${who}', $q$${sql}$q$);`;
const SVC = (label: string, sql: string) => `select pg_temp.svc('${label}', $q$${sql}$q$);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const X = (sql: string) => `select pg_temp.x($q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data${path ? `,${path}` : ''}}' from pg_temp.out where label = '${label}'`);
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const PHOTO = (name: string, who: string, folder: string) => `select pg_temp.photo('${name}', '${who}', '${folder}');`;
const LIVE_SUB = (name: string, run: string, key: string) =>
  KEEP(
    name,
    `select x.id::text from protocol_submissions x join protocol_run_steps s on s.id = x.run_step_id
      where s.run_id = {{${run}}} and s.step_key = '${key}'
        and x.decision is null and x.withdrawn_at is null and x.superseded_at is null`,
  );
const STEPK = (name: string, run: string, key: string) =>
  KEEP(name, `select id::text from protocol_run_steps where run_id = {{${run}}} and step_key = '${key}'`);
const OUTBOX_Q = (label: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                               order by o.id), '[]')
       from notification_outbox o where o.created_at = now()`,
  );

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
function varOf(r: Results, name: string): string {
  const v = r[`__var_${name}`];
  if (v?.ok && typeof v.data === 'string') return v.data;
  throw new Error(`no variable ${name}`);
}

interface Push {
  to: string;
  kind: string;
  payload: { route: string; id: string; title_key: string };
}

const SETUP = [
  MK('hc', 'head_chef'),
  MK('drv', 'driver'),
  MK('mkt', 'marketing'),
  KEEP(
    'cat',
    `insert into menu_categories (name_en, name_ar, tax_group_id, is_active, venue_id, kind)
     values ('RPL desserts', 'حلويات', {{tax}}, true, {{venue}}, 'cafe') returning id::text`,
  ),
  KEEP(
    'flour',
    `insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id)
     values ('purchased', 'RPL flour', 'طحين', 'g', true, {{venue}}) returning id::text`,
  ),
];

/**
 * A release from the head chef's proposal to its launch step: the manager
 * accepts, the head chef tests, the owner covers the price and marketing
 * steps (the owner's own submissions pass at once). Leaves {{<p>run}},
 * {{<p>item}}, {{<p>launch}} and the test photo {{<p>photo}}.
 */
const toLaunch = (p: string) => [
  T(
    `${p}start`,
    'hc',
    `select app.start_protocol('product_release', null, 'Cake ${p}', null, '{}'::jsonb,
       jsonb_build_object('name_en', 'Cake ${p}', 'item_kind', 'dessert',
         'lines', jsonb_build_array(jsonb_build_object('ingredient_id', {{flour}}, 'qty', 100, 'unit', 'g')),
         'sizes', jsonb_build_array(jsonb_build_object('name_en', 'Slice'))),
       '{}'::text[], {{venue}}::uuid, null)`,
  ),
  RES(`${p}run`, `${p}start`, 'run_id'),
  RES(`${p}sub1`, `${p}start`, 'submission_id'),
  T(`${p}accept`, 'manager', `select app.decide_step({{${p}sub1}}::uuid, 'approve', null, null, jsonb_build_object('category_id', {{cat}}))`),
  KEEP(`${p}item`, `select menu_item_id::text from protocol_runs where id = {{${p}run}}`),
  KEEP(`${p}v1`, `select id::text from menu_item_variants where item_id = {{${p}item}} limit 1`),
  STEPK(`${p}test`, `${p}run`, 'test'),
  PHOTO(`${p}photo`, 'hc', 'tests'),
  T(
    `${p}tested`,
    'hc',
    `select app.submit_step({{${p}test}}::uuid,
       jsonb_build_object('servings', jsonb_build_array(jsonb_build_object('variant_id', {{${p}v1}}, 'count', 1))),
       array[{{${p}photo}}])`,
  ),
  LIVE_SUB(`${p}tsub`, `${p}run`, 'test'),
  T(`${p}test_ok`, 'manager', `select app.decide_step({{${p}tsub}}::uuid, 'approve', null, null, '{}'::jsonb)`),
  STEPK(`${p}an`, `${p}run`, 'analysis'),
  T(
    `${p}priced`,
    'owner',
    `select app.submit_step({{${p}an}}::uuid, jsonb_build_object(
       'prices', jsonb_build_array(jsonb_build_object('variant_id', {{${p}v1}}, 'price_iqd', 3500)),
       'name_en', 'Cake ${p}', 'name_ar', 'كعكة'), '{}'::text[])`,
  ),
  STEPK(`${p}mk`, `${p}run`, 'marketing'),
  T(
    `${p}marketed`,
    'owner',
    `select app.submit_step({{${p}mk}}::uuid, jsonb_build_object('highlights_en', 'Soft', 'highlights_ar', 'طرية'), '{}'::text[])`,
  ),
  STEPK(`${p}launch`, `${p}run`, 'launch'),
  KEEP(`${p}menu`, `select 'items/' || {{${p}item}} || '/' || {{${p}run}} || '.jpg'`),
  // What protocol-action's copy leaves in the public menu bucket: a launch
  // now needs it there.
  X(`insert into storage.objects (bucket_id, name) values ('menu-media', {{${p}menu}})`),
];

const launchNow = (label: string, p: string) =>
  T(
    label,
    'owner',
    `select app.submit_step({{${p}launch}}::uuid,
       jsonb_build_object('when', 'now', 'photo_path', {{${p}photo}}, 'menu_photo_path', {{${p}menu}}))`,
  );
const launchOn = (label: string, p: string) =>
  T(
    label,
    'owner',
    `select app.submit_step({{${p}launch}}::uuid,
       jsonb_build_object('when', 'date', 'at', now() + interval '1 day', 'photo_path', {{${p}photo}}))`,
  );

describe.skipIf(!docker)('release_post_launch (rolled-back transactions)', () => {
  it('launches a scheduled release when its date comes, and reverts one that is no longer ready', () => {
    const r = scenario([
      ...SETUP,
      ...toLaunch('a_'),
      launchOn('a_on', 'a_'),
      ...toLaunch('b_'),
      launchOn('b_on', 'b_'),
      Q('a_state', `select jsonb_build_object('status', status, 'scheduled', scheduled_for is not null) from protocol_runs where id = {{a_run}}`),
      // Not due yet, then due.
      SVC('due_before', `select app.release_due_launches(10)`),
      X(`update protocol_runs set scheduled_for = now() - interval '1 minute' where id in ({{a_run}}::uuid, {{b_run}}::uuid)`),
      SVC('due', `select app.release_due_launches(10)`),
      // The copy's path is the only one accepted.
      SVC('a_wrong', `select to_jsonb(app.release_launch_scheduled({{a_run}}::uuid, 'items/' || {{a_item}} || '/other.jpg'))`),
      SVC('a_launch', `select to_jsonb(app.release_launch_scheduled({{a_run}}::uuid, {{a_menu}}))`),
      SVC('a_again', `select to_jsonb(app.release_launch_scheduled({{a_run}}::uuid, {{a_menu}}))`),
      Q(
        'a_after',
        `select jsonb_build_object('run', r.status, 'live', r.live_at is not null, 'active', mi.is_active,
                                   'launched', mi.launched_at is not null, 'photo', mi.photo_path)
           from protocol_runs r join menu_items mi on mi.id = r.menu_item_id where r.id = {{a_run}}`,
      ),
      // b's recipe went missing since it was scheduled: not ready on the date.
      X(`delete from recipe_lines where variant_id in (select id from menu_item_variants where item_id = {{b_item}}::uuid)`),
      SVC('b_launch', `select to_jsonb(app.release_launch_scheduled({{b_run}}::uuid, {{b_menu}}))`),
      Q(
        'b_after',
        `select jsonb_build_object(
           'run', (select jsonb_build_object('status', status, 'scheduled_for', scheduled_for) from protocol_runs where id = {{b_run}}),
           'launch', (select jsonb_build_object('status', status, 'round', round) from protocol_run_steps where id = {{b_launch}}),
           'item', (select is_active from menu_items where id = {{b_item}}))`,
      ),
      SVC('due_after', `select app.release_due_launches(10)`),
      OUTBOX_Q('pushes'),
      Q(
        'audit',
        `select jsonb_agg(jsonb_build_object('action', action, 'after', after) order by id) from audit_log
          where at = now() and entity_id = {{b_run}} and action = 'protocol.unschedule'`,
      ),
    ]);

    ok(r, 'a_on');
    expect(ok(r, 'a_state')).toEqual({ status: 'scheduled', scheduled: true });
    const runA = varOf(r, 'a_run');
    const runB = varOf(r, 'b_run');
    const ids = (label: string) => ok<Array<{ run_id: string }>>(r, label).map((d) => d.run_id);
    expect(ids('due_before')).not.toContain(runA);
    const due = ok<Array<{ run_id: string; menu_item_id: string; photo_path: string }>>(r, 'due');
    expect(due.find((d) => d.run_id === runA)).toEqual({
      run_id: runA,
      venue_id: VENUE_A_ID,
      menu_item_id: varOf(r, 'a_item'),
      photo_path: varOf(r, 'a_photo'),
    });
    expect(ids('due')).toContain(runB);

    expect(refused(r, 'a_wrong')).toBe('RECORD_INVALID:menu_photo_path');
    expect(ok(r, 'a_launch')).toBe('launched');
    expect(ok(r, 'a_again')).toBe('launched');
    expect(ok(r, 'a_after')).toEqual({ run: 'live', live: true, active: true, launched: true, photo: varOf(r, 'a_menu') });

    expect(ok(r, 'b_launch')).toBe('reverted');
    expect(ok(r, 'b_after')).toEqual({ run: { status: 'active', scheduled_for: null }, launch: { status: 'open', round: 2 }, item: false });
    expect(ids('due_after')).not.toContain(runA);
    expect(ids('due_after')).not.toContain(runB);

    const pushes = ok<Push[]>(r, 'pushes');
    expect(pushes.filter((p) => p.payload.title_key === 'launch_not_ready').map((p) => p.to)).toEqual([SEED_STAFF_IDS.owner]);
    expect(pushes.filter((p) => p.payload.title_key === 'run_live' && p.payload.id === runA).map((p) => p.to)).toEqual([varOf(r, 'hc')]);
    expect(ok<Array<{ after: { status: string; not_ready: string } }>>(r, 'audit')[0]!.after).toMatchObject({
      status: 'active',
      not_ready: 'recipe',
    });
  });

  it('takes staff notes on a new item for 30 days, from every role', () => {
    const r = scenario([
      ...SETUP,
      ...toLaunch('a_'),
      launchNow('a_now', 'a_'),
      KEEP('plain', `select id::text from menu_items where release_run_id is null and venue_id = {{venue}}::uuid limit 1`),
      T('n_cashier', 'cashier', `select app.add_release_note({{a_item}}::uuid, 'Guests ask for it warm', null)`),
      T('n_drv', 'drv', `select app.add_release_note({{a_item}}::uuid, 'Sold out by noon', null)`),
      T('n_mkt', 'mkt', `select app.add_release_note({{a_item}}::uuid, 'Photographs well', null)`),
      T('n_key1', 'desk', `select app.add_release_note({{a_item}}::uuid, 'Asked twice at the desk', 'TEST1:note:K1')`),
      T('n_key2', 'desk', `select app.add_release_note({{a_item}}::uuid, 'Asked twice at the desk', 'TEST1:note:K1')`),
      T('n_blank', 'cashier', `select app.add_release_note({{a_item}}::uuid, '   ', null)`),
      T('n_long', 'cashier', `select app.add_release_note({{a_item}}::uuid, repeat('x', 2001), null)`),
      T('n_plain', 'cashier', `select app.add_release_note({{plain}}::uuid, 'Not a release', null)`),
      T('for_me', 'cashier', `select app.release_notes_for_me({{venue}}::uuid)`),
      T('for_item', 'drv', `select app.release_notes_for_item({{a_item}}::uuid)`),
      T('plain_item', 'drv', `select app.release_notes_for_item({{plain}}::uuid)`),
      // Day 31: the window has closed.
      X(`update menu_items set launched_at = now() - interval '31 days' where id = {{a_item}}::uuid`),
      T('n_late', 'cashier', `select app.add_release_note({{a_item}}::uuid, 'Late', null)`),
      T('for_item_late', 'cashier', `select app.release_notes_for_item({{a_item}}::uuid)`),
      T('for_me_late', 'cashier', `select app.release_notes_for_me({{venue}}::uuid)`),
      // The tables: MGMT only.
      T('tbl_notes_drv', 'drv', `select to_jsonb(count(*)) from release_notes`),
      T('tbl_notes_mkt', 'mkt', `select to_jsonb(count(*)) from release_notes`),
      T('tbl_notes_mgr', 'manager', `select to_jsonb(count(*)) from release_notes where menu_item_id = {{a_item}}::uuid`),
    ]);
    const item = varOf(r, 'a_item');

    ok(r, 'a_now');
    ok(r, 'n_cashier');
    ok(r, 'n_drv');
    ok(r, 'n_mkt');
    const first = ok<{ id: string }>(r, 'n_key1');
    expect(ok<{ id: string; duplicate: boolean }>(r, 'n_key2')).toEqual({ id: first.id, duplicate: true });
    expect(refused(r, 'n_blank')).toBe('TEXT_REQUIRED:body');
    expect(refused(r, 'n_long')).toBe('TEXT_TOO_LONG:body');
    expect(refused(r, 'n_plain')).toBe('ITEM_NOT_FOUND');

    const mine = ok<{ items: Array<{ menu_item_id: string; notes: number; my_notes: number; run_id: string }> }>(r, 'for_me');
    expect(mine.items.find((i) => i.menu_item_id === item)).toMatchObject({ notes: 4, my_notes: 1, run_id: varOf(r, 'a_run') });
    const notes = ok<{ item: { open: boolean }; notes: Array<{ body: string; author_name: string; mine: boolean }> }>(r, 'for_item');
    expect(notes.item.open).toBe(true);
    expect(notes.notes).toHaveLength(4);
    expect(notes.notes.filter((n) => n.mine).map((n) => n.body)).toEqual(['Sold out by noon']);
    expect(refused(r, 'plain_item')).toBe('ITEM_NOT_FOUND');

    expect(refused(r, 'n_late')).toBe('NOTE_WINDOW_CLOSED');
    expect(ok<{ item: { open: boolean } }>(r, 'for_item_late').item.open).toBe(false);
    expect(ok<{ items: Array<{ menu_item_id: string }> }>(r, 'for_me_late').items.map((i) => i.menu_item_id)).not.toContain(item);

    expect(ok(r, 'tbl_notes_drv')).toBe(0);
    expect(ok(r, 'tbl_notes_mkt')).toBe(0);
    expect(ok(r, 'tbl_notes_mgr')).toBe(4);
  });

  it('writes the day-30 review for managers and owners only, and tells them alone', () => {
    const r = scenario([
      ...SETUP,
      ...toLaunch('a_'),
      launchNow('a_now', 'a_'),
      SVC('due_early', `select app.release_due_reviews(50)`),
      X(`update protocol_runs set live_at = now() - interval '31 days' where id = {{a_run}}::uuid`),
      SVC('due', `select app.release_due_reviews(50)`),
      SVC('input', `select app.release_review_input({{a_run}}::uuid)`),
      ...['hc', 'cashier', 'drv', 'mkt', 'manager'].map((who) => T(`review_${who}_before`, who, `select app.release_review({{a_run}}::uuid)`)),
      SVC('bad_status', `select app.release_review_save({{a_run}}::uuid, '{}'::jsonb, null, 'nice', null)`),
      SVC('failed', `select app.release_review_save({{a_run}}::uuid, '{"units": 0}'::jsonb, null, 'failed', null)`),
      SVC('due_after_failed', `select app.release_due_reviews(50)`),
      SVC(
        'save',
        `select app.release_review_save({{a_run}}::uuid, '{"units": 12}'::jsonb,
           jsonb_build_object('en', 'Sold well.', 'ar', 'بيع جيداً.'), 'written', 'claude-opus-5')`,
      ),
      SVC('due_after', `select app.release_due_reviews(50)`),
      Q('run', `select jsonb_build_object('status', status, 'finished', finished_at is not null) from protocol_runs where id = {{a_run}}`),
      ...['hc', 'cashier', 'drv', 'mkt', 'manager', 'owner'].map((who) => T(`review_${who}`, who, `select app.release_review({{a_run}}::uuid)`)),
      T('review_unknown', 'manager', `select app.release_review(gen_random_uuid())`),
      OUTBOX_Q('pushes'),
      T('tbl_drv', 'drv', `select to_jsonb(count(*)) from release_reviews`),
      T('tbl_mkt', 'mkt', `select to_jsonb(count(*)) from release_reviews`),
      T('tbl_mgr', 'manager', `select to_jsonb(count(*)) from release_reviews where run_id = {{a_run}}::uuid`),
      // The starter sees the run done, with no figures: the run detail has
      // no review in it.
      T('detail_hc', 'hc', `select app.protocol_run_detail({{a_run}}::uuid)`),
    ]);
    const run = varOf(r, 'a_run');
    const ids = (label: string) => ok<Array<{ run_id: string }>>(r, label).map((d) => d.run_id);

    expect(ids('due_early')).not.toContain(run);
    expect(ids('due')).toContain(run);
    const input = ok<{ numbers: Record<string, unknown>; notes: unknown[]; marketing_take: unknown[] }>(r, 'input');
    expect(Object.keys(input.numbers).sort()).toEqual(
      ['bought_with', 'category_share_pct', 'days_sold', 'from', 'margin_iqd', 'margin_pct', 'revenue_iqd', 'to', 'units'].sort(),
    );

    for (const who of ['hc', 'cashier', 'drv', 'mkt']) expect(refused(r, `review_${who}_before`), who).toBe('FORBIDDEN');
    expect(ok(r, 'review_manager_before')).toBeNull();
    expect(refused(r, 'bad_status')).toBe('INVALID_ARGUMENT:status');
    expect(ok<{ run_status: string }>(r, 'failed').run_status).toBe('live');
    expect(ids('due_after_failed')).toContain(run);
    expect(ok<{ run_status: string }>(r, 'save').run_status).toBe('done');
    expect(ids('due_after')).not.toContain(run);
    expect(ok(r, 'run')).toEqual({ status: 'done', finished: true });

    for (const who of ['hc', 'cashier', 'drv', 'mkt']) expect(refused(r, `review_${who}`), who).toBe('FORBIDDEN');
    for (const who of ['manager', 'owner']) {
      expect(ok(r, `review_${who}`), who).toMatchObject({
        status: 'written',
        numbers: { units: 12 },
        write_up: { en: 'Sold well.', ar: 'بيع جيداً.' },
        model: 'claude-opus-5',
      });
    }
    expect(refused(r, 'review_unknown')).toBe('PROTOCOL_NOT_FOUND');

    // review_ready: the owners and the venue's managers, never the head chef
    // who started the run (#54).
    const ready = ok<Push[]>(r, 'pushes').filter((p) => p.payload.title_key === 'review_ready' && p.payload.id === run);
    const to = ready.map((p) => p.to);
    expect(to).toEqual(expect.arrayContaining([SEED_STAFF_IDS.owner, SEED_STAFF_IDS.manager]));
    expect(to).not.toContain(varOf(r, 'hc'));
    expect(ready.every((p) => p.kind === 'staff_info' && p.payload.route === 'staff-run')).toBe(true);

    expect(ok(r, 'tbl_drv')).toBe(0);
    expect(ok(r, 'tbl_mkt')).toBe(0);
    expect(ok(r, 'tbl_mgr')).toBe(1);
    const detail = ok<{ run: { status: string } }>(r, 'detail_hc');
    expect(detail.run.status).toBe('done');
    expect(JSON.stringify(detail)).not.toContain('Sold well.');
  });

  it('purges the photos of runs stopped 90 days ago, and keeps its functions from every client', () => {
    const r = scenario([
      ...SETUP,
      ...toLaunch('a_'),
      T('stop', 'manager', `select app.stop_protocol({{a_run}}::uuid, 'Changed our minds')`),
      SVC('purge_early', `select app.protocol_photo_purge_due(50)`),
      X(`update protocol_runs set finished_at = now() - interval '91 days' where id = {{a_run}}::uuid`),
      SVC('purge_due', `select app.protocol_photo_purge_due(50)`),
      SVC('purged', `select app.protocol_photos_purged({{a_run}}::uuid)`),
      SVC('purge_after', `select app.protocol_photo_purge_due(50)`),
      // Every service-role function refuses every client role.
      ...['drv', 'mkt', 'owner'].flatMap((who) => [
        T(`${who}_due`, who, `select app.release_due_launches(10)`),
        T(`${who}_sched`, who, `select to_jsonb(app.release_launch_scheduled({{a_run}}::uuid, 'items/x.jpg'))`),
        T(`${who}_reviews`, who, `select app.release_due_reviews(5)`),
        T(`${who}_input`, who, `select app.release_review_input({{a_run}}::uuid)`),
        T(`${who}_save`, who, `select app.release_review_save({{a_run}}::uuid, '{}'::jsonb, null, 'failed', null)`),
        T(`${who}_purge`, who, `select app.protocol_photo_purge_due(5)`),
        T(`${who}_purged`, who, `select app.protocol_photos_purged({{a_run}}::uuid)`),
        T(`${who}_photos`, who, `select to_jsonb(app.release_run_photos({{a_run}}::uuid))`),
      ]),
      // With nothing due, the nudges post nothing and never raise.
      Q('nudges', `select to_jsonb(true) from (select app.protocol_tick_nudge(), app.release_review_nudge()) n`),
    ]);
    const run = varOf(r, 'a_run');
    ok(r, 'stop');
    const due = (label: string) => ok<Array<{ run_id: string; paths: string[] }>>(r, label);
    expect(due('purge_early').map((d) => d.run_id)).not.toContain(run);
    expect(due('purge_due').find((d) => d.run_id === run)).toEqual({ run_id: run, paths: [varOf(r, 'a_photo')] });
    ok(r, 'purged');
    expect(due('purge_after').map((d) => d.run_id)).not.toContain(run);
    for (const who of ['drv', 'mkt', 'owner']) {
      for (const fn of ['due', 'sched', 'reviews', 'input', 'save', 'purge', 'purged', 'photos']) {
        const o = r[`${who}_${fn}`]!;
        expect(o.ok, `${who}_${fn}`).toBe(false);
        expect(o.state, `${who}_${fn}`).toBe('42501');
      }
    }
    expect(ok(r, 'nudges')).toBe(true);
  });
});

describe.skipIf(!docker)('release_post_launch cron jobs', () => {
  it('schedules the protocol tick every 5 minutes and the review daily', () => {
    const rows = psql(
      `select jobname || ' ' || schedule || ' ' || command from cron.job
        where jobname in ('tp_protocol_tick', 'tp_release_review') order by jobname`,
    ).split('\n');
    expect(rows).toEqual([
      'tp_protocol_tick */5 * * * * select app.protocol_tick_nudge();',
      'tp_release_review 20 4 * * * select app.release_review_nudge();',
    ]);
  });
});
