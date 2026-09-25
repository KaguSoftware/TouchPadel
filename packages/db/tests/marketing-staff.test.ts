/**
 * marketing_staff (build-contracts-2026-09-23 §2.17, §8.2): the marketing
 * role's campaign drafts and its own take.
 *
 *   * suggest_campaign writes a draft with one name copied into the other
 *     language; a missing channel is BAD_CHANNEL, never a 23502 (§8.2); the
 *     images are the caller's campaigns slots; the item and run are the
 *     venue's; a new draft is idempotent by key;
 *   * the suggester changes their own draft until the owner saves or
 *     schedules it (CAMPAIGN_DRAFT_LOCKED); anyone else's draft, or an owner's
 *     campaign, answers CAMPAIGN_NOT_FOUND;
 *   * my_campaign_drafts is the suggester's own, with no audience, promotion
 *     or performance; marketing_suggestions is the owner's;
 *   * add_marketing_note is marketing's own take on an item, a run or a
 *     campaign of the venue, with its photos; MGMT and marketing read the
 *     notes on a subject, marketing its own list;
 *   * the driver, the bar and kitchen family and every other role are refused;
 *     only MGMT reads marketing_notes and marketing_campaigns directly (§8.2
 *     denials).
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, a menu item, a protocol run
 * and upload slots are created inside it and each call runs as
 * `authenticated` with the caller's JWT claims. Nothing is committed. Without
 * docker on PATH the suite skips itself.
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

const OTHER_VENUE = '00000000-0000-4000-8000-00000000c4c4';

// ── the in-transaction harness (as protocols-engine-flow.test.ts) ──────────
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('prep', '${SEED_STAFF_IDS.prep}'), ('venue', '${VENUE_A_ID}'), ('other_venue', '${OTHER_VENUE}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

create function pg_temp.t(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
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
  values (v, 'mk-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'MK ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- A menu item at the venue and one at a venue nobody here works at.
insert into venues (id, slug, name_en, name_ar, is_active)
values ('${OTHER_VENUE}', 'mk-other-venue', 'MK other', 'مكان آخر', false);
with c as (insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
           values ('MK drinks', 'مشروبات', '${SEED_TAX_GROUP_STANDARD}', '${VENUE_A_ID}') returning id),
     i as (insert into menu_items (category_id, name_en, name_ar, venue_id)
           select id, 'MK Rose latte', 'لاتيه الورد', '${VENUE_A_ID}' from c returning id)
insert into vars select 'item', id::text from i;
with c as (insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
           values ('MK far', 'بعيد', '${SEED_TAX_GROUP_STANDARD}', '${OTHER_VENUE}') returning id),
     i as (insert into menu_items (category_id, name_en, name_ar, venue_id)
           select id, 'MK far item', 'بعيد', '${OTHER_VENUE}' from c returning id)
insert into vars select 'far_item', id::text from i;
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

const T = (label: string, who: string, sql: string) => `select pg_temp.t('${label}', '${who}', $q$${sql}$q$);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
/** An upload slot of `who` in `folder`, kept as `name`. */
const SLOT = (name: string, who: string, folder: string) => [
  T(`slot_${name}`, who, `select app.staff_media_slot({{venue}}, '${folder}', 'jpg')`),
  RES(name, `slot_${name}`, 'path'),
];
/** A product-release run at the venue started by `who` (written as postgres). */
const RUN = (name: string, who: string) =>
  KEEP(name, `insert into protocol_runs (venue_id, template_id, template_version, kind, title_en, started_by)
              select t.venue_id, t.id, t.version, 'product_release', 'MK launch run', {{${who}}}::uuid
                from protocol_templates t where t.venue_id = {{venue}} and t.kind = 'product_release'
              returning id::text`);

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

/** suggest_campaign with named arguments; `args` is the SQL of the named list. */
const suggest = (args: string) => `select app.suggest_campaign(${args})`;

interface Draft {
  id: string;
  name_en: string;
  name_ar: string;
  channel: string;
  status: string;
  body_en: string;
  note: string | null;
  images: string[];
  run_id: string | null;
  menu_item_id: string | null;
  suggested_at: string;
  editable: boolean;
}

describe.skipIf(!docker)('marketing staff (rolled-back transactions)', () => {
  it('marketing suggests drafts it may change until the owner picks them up', () => {
    const r = scenario([
      MK('mkt', 'marketing'), MK('mkt2', 'marketing'), MK('hc', 'head_chef'), MK('drv', 'driver'),
      RUN('run', 'hc'),
      ...SLOT('img1', 'mkt', 'campaigns'), ...SLOT('img2', 'mkt', 'campaigns'),
      ...SLOT('img_other', 'mkt2', 'campaigns'), ...SLOT('img_notes', 'mkt', 'marketing'),

      T('new', 'mkt', suggest(`p_venue_id => {{venue}}, p_name_en => '  Rose week  ', p_channel => 'telegram',
        p_starts_at => now() + interval '2 days', p_ends_at => now() + interval '9 days',
        p_body_en => 'Rose latte all week', p_images => array[{{img1}}, {{img2}}, {{img1}}],
        p_run_id => {{run}}::uuid, p_menu_item_id => {{item}}::uuid, p_note => 'For the launch',
        p_idempotency_key => 'MK-KEY-1'`)),
      T('new_replay', 'mkt', suggest(`p_venue_id => {{venue}}, p_name_en => 'Rose week', p_channel => 'telegram',
        p_idempotency_key => 'MK-KEY-1'`)),
      RES('draft', 'new', 'id'),
      Q('row', `select jsonb_build_object('name_en', name_en, 'name_ar', name_ar, 'status', status, 'venue', venue_id,
                  'created_by', created_by, 'suggested_by', suggested_by, 'same_time', updated_at = suggested_at,
                  'images', images, 'run', protocol_run_id, 'item', menu_item_id, 'note', suggestion_note,
                  'audience', audience_id, 'promotion', promotion_id)
                  from marketing_campaigns where id = {{draft}}::uuid`),
      Q('claimed', `select jsonb_agg(used_by order by path) from staff_media_uploads where path in ({{img1}}, {{img2}})`),
      T('arabic_only', 'mkt', suggest(`p_name_ar => 'أسبوع الورد', p_channel => 'in_venue'`)),

      // §8.2: one name and no channel is BAD_CHANNEL, never a raw 23502.
      T('no_channel', 'mkt', suggest(`p_name_en => 'Rose week'`)),
      T('bad_channel', 'mkt', suggest(`p_name_en => 'Rose week', p_channel => 'sms'`)),
      T('no_name', 'mkt', suggest(`p_name_en => '  ', p_name_ar => null, p_channel => 'telegram'`)),
      T('long_name', 'mkt', suggest(`p_name_en => repeat('n', 121), p_channel => 'telegram'`)),
      T('range', 'mkt', suggest(`p_name_en => 'x', p_channel => 'telegram', p_starts_at => now(),
                                 p_ends_at => now() - interval '1 hour'`)),
      T('far_item', 'mkt', suggest(`p_name_en => 'x', p_channel => 'telegram', p_menu_item_id => {{far_item}}::uuid`)),
      T('no_run', 'mkt', suggest(`p_name_en => 'x', p_channel => 'telegram',
                                  p_run_id => '00000000-0000-4000-8000-000000000000'`)),
      T('seven_images', 'mkt', suggest(`p_name_en => 'x', p_channel => 'telegram',
                                        p_images => array['a','b','c','d','e','f','g']`)),
      T('foreign_image', 'mkt', suggest(`p_name_en => 'x', p_channel => 'telegram', p_images => array[{{img_other}}]`)),
      T('wrong_folder', 'mkt', suggest(`p_name_en => 'x', p_channel => 'telegram', p_images => array[{{img_notes}}]`)),
      T('long_note', 'mkt', suggest(`p_name_en => 'x', p_channel => 'telegram', p_note => repeat('n', 2001)`)),
      ...(['hc', 'drv', 'manager', 'owner', 'cashier', 'desk', 'prep'] as const).map((who) =>
        T(`suggest_${who}`, who, suggest(`p_name_en => 'x', p_channel => 'telegram'`))),

      // The suggester's change keeps the draft theirs; nobody else's.
      T('edit', 'mkt', suggest(`p_id => {{draft}}::uuid, p_name_en => 'Rose fortnight', p_name_ar => 'أسبوعا الورد',
        p_channel => 'telegram', p_body_en => 'Two weeks', p_images => array[{{img2}}]`)),
      T('edit_mkt2', 'mkt2', suggest(`p_id => {{draft}}::uuid, p_name_en => 'Mine now', p_channel => 'telegram'`)),
      T('owner_campaign', 'owner', `select to_jsonb(app.save_marketing_campaign(null, 'Owner promo', 'عرض', 'in_venue'))`),
      KEEP('owner_campaign_id', `select res #>> '{data}' from pg_temp.out where label = 'owner_campaign'`),
      T('edit_owners', 'mkt', suggest(`p_id => {{owner_campaign_id}}::uuid, p_name_en => 'x', p_channel => 'telegram'`)),
      T('edit_missing', 'mkt', suggest(`p_id => '00000000-0000-4000-8000-000000000000', p_name_en => 'x',
                                        p_channel => 'telegram'`)),
      T('drafts_before', 'mkt', `select app.my_campaign_drafts({{venue}})`),

      // The owner picks the first draft up later: saved, so locked.
      Q('earlier', `with x as (update marketing_campaigns set suggested_at = suggested_at - interval '1 minute',
                                   updated_at = updated_at - interval '1 minute'
                     where suggested_by is not null and created_at = now() returning 1)
                    select to_jsonb(count(*)) from x`),
      T('owner_saves', 'owner', `select to_jsonb(app.save_marketing_campaign({{draft}}::uuid, 'Rose fortnight',
                                   'أسبوعا الورد', 'telegram'))`),
      T('edit_locked', 'mkt', suggest(`p_id => {{draft}}::uuid, p_name_en => 'Too late', p_channel => 'telegram'`)),
      // ... and the second is scheduled: no longer a draft.
      RES('arabic_draft', 'arabic_only', 'id'),
      T('schedule', 'owner', `select app.set_campaign_status({{arabic_draft}}::uuid, 'scheduled')`),
      Q('set_start', `with x as (update marketing_campaigns set starts_at = now() + interval '1 day'
                        where id = {{arabic_draft}}::uuid returning 1) select to_jsonb(count(*)) from x`),
      T('schedule2', 'owner', `select app.set_campaign_status({{arabic_draft}}::uuid, 'scheduled')`),
      T('edit_scheduled', 'mkt', suggest(`p_id => {{arabic_draft}}::uuid, p_name_ar => 'x', p_channel => 'in_venue'`)),
      T('drafts_after', 'mkt', `select app.my_campaign_drafts()`),
      T('drafts_mkt2', 'mkt2', `select app.my_campaign_drafts({{venue}})`),
      T('drafts_mgr', 'manager', `select app.my_campaign_drafts({{venue}})`),
      T('suggestions', 'owner', `select app.marketing_suggestions({{venue}})`),
      T('suggestions_mgr', 'manager', `select app.marketing_suggestions({{venue}})`),
      T('suggestions_mkt', 'mkt', `select app.marketing_suggestions({{venue}})`),
      T('read_campaigns_mkt', 'mkt', `select count(*)::text::jsonb from marketing_campaigns`),
      T('read_campaigns_drv', 'drv', `select count(*)::text::jsonb from marketing_campaigns`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'after', a.after) order by a.id)
                    from audit_log a where a.entity = 'marketing_campaigns' and a.entity_id = {{draft}}`),
    ]);

    const id = ok<{ id: string }>(r, 'new').id;
    expect(ok<Record<string, unknown>>(r, 'new_replay')).toEqual({ id, duplicate: true });
    expect(ok<Record<string, unknown>>(r, 'row')).toMatchObject({
      name_en: 'Rose week', name_ar: 'Rose week', status: 'draft', venue: VENUE_A_ID,
      created_by: expect.any(String), same_time: true, note: 'For the launch',
      audience: null, promotion: null,
    });
    const row = ok<Record<string, unknown>>(r, 'row');
    expect(row.suggested_by).toBe(row.created_by);
    // Once each, in the order given.
    expect((row.images as string[]).length).toBe(2);
    expect(ok<string[]>(r, 'claimed')).toEqual([`marketing_campaign:${id}`, `marketing_campaign:${id}`]);
    expect(ok<{ id: string }>(r, 'arabic_only').id).toMatch(/^[0-9a-f-]{36}$/);

    expect(refused(r, 'no_channel')).toBe('BAD_CHANNEL');
    expect(refused(r, 'bad_channel')).toBe('BAD_CHANNEL');
    expect(refused(r, 'no_name')).toBe('TEXT_REQUIRED:name');
    expect(refused(r, 'long_name')).toBe('TEXT_TOO_LONG:name');
    expect(refused(r, 'range')).toBe('INVALID_RANGE');
    expect(refused(r, 'far_item')).toBe('REF_NOT_FOUND:menu_item_id');
    expect(refused(r, 'no_run')).toBe('REF_NOT_FOUND:run_id');
    expect(refused(r, 'seven_images')).toBe('INVALID_ARGUMENT:images');
    expect(refused(r, 'foreign_image')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'wrong_folder')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'long_note')).toBe('TEXT_TOO_LONG:note');
    for (const who of ['hc', 'drv', 'manager', 'owner', 'cashier', 'desk', 'prep']) {
      expect(refused(r, `suggest_${who}`), who).toBe('FORBIDDEN');
    }

    expect(ok<{ id: string }>(r, 'edit').id).toBe(id);
    expect(refused(r, 'edit_mkt2')).toBe('CAMPAIGN_NOT_FOUND');
    expect(refused(r, 'edit_owners')).toBe('CAMPAIGN_NOT_FOUND');
    expect(refused(r, 'edit_missing')).toBe('CAMPAIGN_NOT_FOUND');
    const before = ok<{ drafts: Draft[] }>(r, 'drafts_before').drafts;
    expect(before.find((d) => d.id === id)).toMatchObject({
      name_en: 'Rose fortnight', name_ar: 'أسبوعا الورد', body_en: 'Two weeks', channel: 'telegram', status: 'draft',
      images: [expect.stringMatching(/\/campaigns\//)], run_id: null, menu_item_id: null, editable: true,
    });
    expect(Object.keys(before[0]!).sort()).toEqual([
      'body_ar', 'body_en', 'channel', 'editable', 'ends_at', 'id', 'images', 'menu_item_id', 'name_ar', 'name_en',
      'note', 'run_id', 'starts_at', 'status', 'suggested_at',
    ]);

    ok(r, 'owner_saves');
    expect(refused(r, 'edit_locked')).toBe('CAMPAIGN_DRAFT_LOCKED');
    expect(refused(r, 'schedule')).toBe('START_REQUIRED');
    ok(r, 'schedule2');
    expect(refused(r, 'edit_scheduled')).toBe('CAMPAIGN_DRAFT_LOCKED');
    const after = ok<{ drafts: Draft[] }>(r, 'drafts_after').drafts;
    expect(after.map((d) => [d.status, d.editable]).sort()).toEqual([['draft', false], ['scheduled', false]]);
    expect(ok<{ drafts: Draft[] }>(r, 'drafts_mkt2').drafts).toEqual([]);
    expect(refused(r, 'drafts_mgr')).toBe('FORBIDDEN');

    type Suggestion = { campaign_id: string; suggested_by_name: string; suggestion_note: string | null };
    const mine = ok<{ drafts: Suggestion[] }>(r, 'suggestions').drafts.filter((s) => s.suggested_by_name === 'MK mkt');
    expect(mine.map((s) => s.campaign_id).sort()).toEqual([id, ok<{ id: string }>(r, 'arabic_only').id].sort());
    expect(refused(r, 'suggestions_mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'suggestions_mkt')).toBe('FORBIDDEN');
    expect(ok<number>(r, 'read_campaigns_mkt')).toBe(0);
    expect(ok<number>(r, 'read_campaigns_drv')).toBe(0);
    const audit = ok<Array<{ action: string; after: Record<string, unknown> }>>(r, 'audit');
    expect(audit.filter((a) => a.action === 'marketing.campaign.suggest').map((a) => a.after)).toEqual([
      { status: 'draft', channel: 'telegram', images: 2, edit: false },
      { status: 'draft', channel: 'telegram', images: 1, edit: true },
    ]);
  });

  it('marketing writes its own take on an item, a run or a campaign; MGMT and marketing read it', () => {
    const r = scenario([
      MK('mkt', 'marketing'), MK('mkt2', 'marketing'), MK('hc', 'head_chef'), MK('drv', 'driver'),
      RUN('run', 'hc'),
      ...SLOT('photo', 'mkt', 'marketing'), ...SLOT('photo_campaigns', 'mkt', 'campaigns'),
      T('campaign', 'mkt', suggest(`p_name_en => 'Rose week', p_channel => 'guest_site'`)),
      RES('campaign_id', 'campaign', 'id'),

      T('on_item', 'mkt', `select app.add_marketing_note({{venue}}, 'item', {{item}}::uuid,
                             '  Photographs well in daylight  ', array[{{photo}}], 'MK-NOTE-1')`),
      T('on_item_replay', 'mkt', `select app.add_marketing_note({{venue}}, 'item', {{item}}::uuid,
                                    'Photographs well in daylight', array[{{photo}}], 'MK-NOTE-1')`),
      T('on_run', 'mkt', `select app.add_marketing_note(null, 'run', {{run}}::uuid, 'Launch on a Thursday')`),
      T('on_campaign', 'mkt2', `select app.add_marketing_note({{venue}}, 'campaign', {{campaign_id}}::uuid, 'Needs a reel')`),
      RES('note', 'on_item', 'id'),
      Q('claimed', `select to_jsonb(used_by) from staff_media_uploads where path = {{photo}}`),

      T('bad_kind', 'mkt', `select app.add_marketing_note({{venue}}, 'guest', {{item}}::uuid, 'x')`),
      T('no_subject', 'mkt', `select app.add_marketing_note({{venue}}, 'run', '00000000-0000-4000-8000-000000000000', 'x')`),
      T('far_item', 'mkt', `select app.add_marketing_note({{venue}}, 'item', {{far_item}}::uuid, 'x')`),
      T('blank', 'mkt', `select app.add_marketing_note({{venue}}, 'item', {{item}}::uuid, '   ')`),
      T('long', 'mkt', `select app.add_marketing_note({{venue}}, 'item', {{item}}::uuid, repeat('b', 2001))`),
      T('seven', 'mkt', `select app.add_marketing_note({{venue}}, 'item', {{item}}::uuid, 'x',
                           array['a','b','c','d','e','f','g'])`),
      T('wrong_folder', 'mkt', `select app.add_marketing_note({{venue}}, 'item', {{item}}::uuid, 'x',
                                  array[{{photo_campaigns}}])`),
      ...(['hc', 'drv', 'manager', 'owner', 'cashier'] as const).map((who) =>
        T(`add_${who}`, who, `select app.add_marketing_note({{venue}}, 'item', {{item}}::uuid, 'x')`)),

      ...(['manager', 'owner', 'mkt2'] as const).map((who) =>
        T(`for_${who}`, who, `select app.marketing_notes_for('item', {{item}}::uuid)`)),
      T('for_run', 'manager', `select app.marketing_notes_for('run', {{run}}::uuid)`),
      T('for_campaign', 'owner', `select app.marketing_notes_for('campaign', {{campaign_id}}::uuid)`),
      ...(['hc', 'drv', 'cashier'] as const).map((who) =>
        T(`for_${who}`, who, `select app.marketing_notes_for('item', {{item}}::uuid)`)),
      T('for_bad_kind', 'manager', `select app.marketing_notes_for('guest', {{item}}::uuid)`),
      T('for_missing', 'manager', `select app.marketing_notes_for('item', '00000000-0000-4000-8000-000000000000')`),
      T('for_far', 'mkt', `select app.marketing_notes_for('item', {{far_item}}::uuid)`),

      T('mine', 'mkt', `select app.my_marketing_notes({{venue}})`),
      T('mine_mkt2', 'mkt2', `select app.my_marketing_notes()`),
      T('mine_mgr', 'manager', `select app.my_marketing_notes({{venue}})`),
      T('mine_drv', 'drv', `select app.my_marketing_notes({{venue}})`),
      ...(['mkt', 'drv', 'hc', 'manager'] as const).map((who) =>
        T(`read_${who}`, who, `select count(*)::text::jsonb from marketing_notes`)),
      Q('audit', `select jsonb_agg(a.after) from audit_log a where a.action = 'marketing.note.add' and a.entity_id = {{note}}`),
    ]);

    const noteId = ok<{ id: string }>(r, 'on_item').id;
    expect(ok<Record<string, unknown>>(r, 'on_item_replay')).toEqual({ id: noteId, duplicate: true });
    ok(r, 'on_run');
    ok(r, 'on_campaign');
    expect(ok<string>(r, 'claimed')).toBe(`marketing_note:${noteId}`);

    expect(refused(r, 'bad_kind')).toBe('INVALID_ARGUMENT:subject_kind');
    expect(refused(r, 'no_subject')).toBe('REF_NOT_FOUND:subject_id');
    expect(refused(r, 'far_item')).toBe('REF_NOT_FOUND:subject_id');
    expect(refused(r, 'blank')).toBe('TEXT_REQUIRED:body');
    expect(refused(r, 'long')).toBe('TEXT_TOO_LONG:body');
    expect(refused(r, 'seven')).toBe('INVALID_ARGUMENT:photos');
    expect(refused(r, 'wrong_folder')).toBe('PHOTO_PATH_INVALID');
    for (const who of ['hc', 'drv', 'manager', 'owner', 'cashier']) {
      expect(refused(r, `add_${who}`), who).toBe('FORBIDDEN');
    }

    type Note = { id: string; author_name: string; body: string; photos: string[] };
    for (const who of ['manager', 'owner', 'mkt2']) {
      const notes = ok<{ notes: Note[] }>(r, `for_${who}`).notes;
      expect(notes.map((n) => [n.author_name, n.body, n.photos.length]), who)
        .toEqual([['MK mkt', 'Photographs well in daylight', 1]]);
    }
    expect(ok<{ notes: Note[] }>(r, 'for_run').notes.map((n) => n.body)).toEqual(['Launch on a Thursday']);
    expect(ok<{ notes: Note[] }>(r, 'for_campaign').notes.map((n) => n.author_name)).toEqual(['MK mkt2']);
    for (const who of ['hc', 'drv', 'cashier']) expect(refused(r, `for_${who}`), who).toBe('FORBIDDEN');
    expect(refused(r, 'for_bad_kind')).toBe('INVALID_ARGUMENT:subject_kind');
    expect(refused(r, 'for_missing')).toBe('REF_NOT_FOUND:subject_id');
    expect(refused(r, 'for_far')).toBe('REF_NOT_FOUND:subject_id');

    type Mine = { subject_kind: string; subject_name_en: string; subject_name_ar: string; body: string };
    const mine = ok<{ notes: Mine[] }>(r, 'mine').notes;
    expect(mine.map((n) => [n.subject_kind, n.subject_name_en, n.subject_name_ar]).sort()).toEqual([
      ['item', 'MK Rose latte', 'لاتيه الورد'],
      ['run', 'MK launch run', 'MK launch run'],
    ]);
    expect(ok<{ notes: Mine[] }>(r, 'mine_mkt2').notes.map((n) => [n.subject_kind, n.subject_name_en]))
      .toEqual([['campaign', 'Rose week']]);
    expect(refused(r, 'mine_mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'mine_drv')).toBe('FORBIDDEN');
    for (const who of ['mkt', 'drv', 'hc']) expect(ok<number>(r, `read_${who}`), who).toBe(0);
    expect(ok<number>(r, 'read_manager')).toBeGreaterThanOrEqual(3);
    // Audited with ids and counts, never the text.
    expect(ok<unknown[]>(r, 'audit')).toEqual([{ subject_kind: 'item', subject_id: expect.any(String), photos: 1 }]);
  });
});
