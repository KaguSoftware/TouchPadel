/**
 * marketing_content (wave5-addendum-2026-09-25 §2.7, §2.4, §2.0, §6.1;
 * contracts §8.2): marketing sends content for the owners' approval, one
 * immutable version per round; managers see none of it.
 *
 *   * the approval loop: a submit tells each owner; the owner asks for
 *     changes with a reason; version 2 keeps version 1's image and adds one;
 *     version 1 can no longer be decided; version 2 is approved, which is
 *     final; the submitter and the author hear each decision;
 *   * refusals: a decline or changes without a reason, every bad field, an
 *     image of another item, another venue's item or campaign; submit is
 *     marketing's alone, the bar, the desk, the till, the driver and both
 *     wave-5 roles are refused;
 *   * owner-only (V4): a manager is refused every RPC and reads no row of
 *     either table and no image; the owner reads them; marketing reads the
 *     venue's queue through the RPCs only;
 *   * the images read to marketing and the owners, never a manager or a driver;
 *   * coverage: marketing_content has readable-column rows, the versions none.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, items, campaigns, slots,
 * storage rows and content are created inside it and each call runs as
 * `authenticated` with the caller's JWT claims. Nothing is committed. Without
 * docker on PATH the suite skips itself.
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
  values (v, 'mc-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'MC ' || p_name, p_role, true);
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
const OTHER_VENUE = '00000000-0000-4000-8000-00000000f3f3';
/** An inactive venue nobody here works at, with a menu item and a campaign there. */
const OTHER_VENUE_SQL = [
  `insert into venues (id, slug, name_en, name_ar, is_active)
   values ('${OTHER_VENUE}', 'mc-other-venue', 'MC other', 'مكان آخر', false);`,
  // 0230: a category links a tax group of its own branch.
  `insert into tax_groups (venue_id, name_en, name_ar, rate_bp)
   values ('${OTHER_VENUE}', 'far tax', 'ضريبة بعيدة', 0);`,
  KEEP('far_cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
                   values ('MC far', 'بعيد', (select id from tax_groups where venue_id = '${OTHER_VENUE}' limit 1), '${OTHER_VENUE}') returning id::text`),
  KEEP('far_item', `insert into menu_items (category_id, name_en, name_ar, venue_id)
                    values ({{far_cat}}::uuid, 'MC far', 'بعيد', '${OTHER_VENUE}') returning id::text`),
  KEEP('far_campaign', `insert into marketing_campaigns (venue_id, name_en, name_ar, channel, created_by)
                        values ('${OTHER_VENUE}', 'MC far', 'بعيدة', 'guest_site', {{owner}}::uuid) returning id::text`),
];
const HERE = [
  KEEP('cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
               values ('MC cat', 'تصنيف', 'b0000000-0000-4000-8000-000000000001', {{venue}}) returning id::text`),
  KEEP('item', `insert into menu_items (category_id, name_en, name_ar, venue_id)
                values ({{cat}}::uuid, 'MC Rose latte', 'لاتيه الورد', {{venue}}) returning id::text`),
  KEEP('campaign', `insert into marketing_campaigns (venue_id, name_en, name_ar, channel, created_by)
                    values ({{venue}}, 'MC Friday', 'الجمعة', 'guest_site', {{owner}}::uuid) returning id::text`),
];

const submit = (who: string, label: string, extra = '', title = `'Friday reel'`) =>
  T(label, who, `select app.submit_content(${title}, 'instagram', current_date + 3, 'Our rose latte, now on the menu.'${extra})`);
const decide = (who: string, label: string, id: string, version: number, decision: string, note = 'null') =>
  T(label, who, `select app.decide_content({{${id}}}::uuid, ${version}, '${decision}', ${note})`);

interface Version { version: number; body: string; images: string[]; decision: string | null; superseded_at: string | null;
                    decision_note: string | null; submitted_by_name: string; [k: string]: unknown }
interface Detail { content: Record<string, unknown>; versions: Version[]; can_decide: boolean; can_revise: boolean;
                   can_withdraw: boolean }

describe.skipIf(!docker)('marketing_content (rolled-back transactions)', () => {
  it('runs the loop: submit, changes, a second version, approval; each side hears it', () => {
    const r = scenario([
      ...HERE,
      MK('mkt', 'marketing'), MK('mkt2', 'marketing'),
      PHOTO('i1', 'mkt', 'campaigns'), PHOTO('i2', 'mkt2', 'campaigns'),
      submit('mkt', 's', `, p_images => array[{{i1}}], p_media_link => 'https://drive.example/reel.mp4',
                         p_note => 'Draft one', p_menu_item_id => {{item}}::uuid, p_campaign_id => {{campaign}}::uuid`),
      RES('c', 's', 'id'),
      Q('submitted_push', `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)), '[]'::jsonb)
                             from notification_outbox o
                            where o.created_at = now() and o.payload->>'title_key' = 'content_submitted'`),
      decide('owner', 'changes_bare', 'c', 1, 'changes'),
      decide('owner', 'changes', 'c', 1, 'changes', `'Brighter photo, please'`),
      Q('changes_push', `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'payload', o.payload)), '[]'::jsonb)
                           from notification_outbox o
                          where o.created_at = now() and o.payload->>'title_key' = 'content_changes'`),
      T('revise_mkt2', 'mkt2', `select app.revise_content({{c}}::uuid, 'Our rose latte, brighter.', array[{{i1}}, {{i2}}],
                                                          p_title => 'Friday reel v2')`),
      decide('owner', 'decide_v1', 'c', 1, 'approve'),
      T('detail_mid', 'mkt', `select app.content_detail({{c}}::uuid)`),
      decide('owner', 'approve_v2', 'c', 2, 'approve'),
      Q('approved_push', `select coalesce(jsonb_agg(o.profile_id order by o.profile_id), '[]'::jsonb)
                            from notification_outbox o
                           where o.created_at = now() and o.payload->>'title_key' = 'content_approved'`),
      T('revise_after', 'mkt', `select app.revise_content({{c}}::uuid, 'One more')`),
      T('withdraw_after', 'mkt', `select app.withdraw_content({{c}}::uuid)`),
      decide('owner', 'decide_again', 'c', 2, 'decline', `'x'`),
      T('detail_end', 'owner', `select app.content_detail({{c}}::uuid)`),
      T('page_approved', 'mkt2', `select app.content_page({{venue}}, 'approved')`),
      Q('claimed', `select jsonb_object_agg(path, used_by) from staff_media_uploads where path in ({{i1}}, {{i2}})`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', action, 'before', before, 'after', after) order by id)
                    from audit_log where entity = 'marketing_content' and entity_id = {{c}}`),
      Q('who', `select jsonb_build_object('mkt', {{mkt}}, 'mkt2', {{mkt2}}, 'owner', {{owner}}, 'manager', {{manager}},
                                          'c', {{c}}, 'i1', {{i1}}, 'i2', {{i2}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    expect(ok(r, 's')).toEqual({ id: who.c, version: 1, status: 'waiting' });
    const sub = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'submitted_push');
    expect(sub.map((p) => p.to)).toContain(who.owner);
    expect(sub.map((p) => p.to)).not.toContain(who.manager);
    expect(sub.find((p) => p.to === who.owner)).toEqual({
      to: who.owner, kind: 'staff_decide',
      payload: { route: 'staff', id: null, title_key: 'content_submitted', params: { name: 'MC mkt', title: 'Friday reel' },
                 dedupe: `content:${who.c}` },
    });
    expect(refused(r, 'changes_bare')).toBe('REASON_REQUIRED');
    expect(ok<{ status: string }>(r, 'changes').status).toBe('changes');
    const changes = ok<Array<{ to: string; payload: Record<string, unknown> }>>(r, 'changes_push');
    expect(changes.map((p) => p.to)).toEqual([who.mkt]);
    expect(changes[0]!.payload).toMatchObject({ title_key: 'content_changes', params: { title: 'Friday reel' } });
    expect(ok(r, 'revise_mkt2')).toEqual({ id: who.c, version: 2, status: 'waiting' });
    expect(refused(r, 'decide_v1')).toBe('SUBMISSION_DECIDED');

    const mid = ok<Detail>(r, 'detail_mid');
    expect(mid.content).toMatchObject({ title: 'Friday reel v2', status: 'waiting', current_version: 2,
                                        item_name_en: 'MC Rose latte', campaign_name_en: 'MC Friday', author_name: 'MC mkt' });
    expect(mid.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(mid.versions[0]).toMatchObject({ images: [who.i1, who.i2], decision: null, superseded_at: null,
                                            submitted_by_name: 'MC mkt2' });
    expect(mid.versions[1]).toMatchObject({ images: [who.i1], decision: 'changes', decision_note: 'Brighter photo, please',
                                            media_link: 'https://drive.example/reel.mp4', note: 'Draft one' });
    expect(mid).toMatchObject({ can_decide: false, can_revise: true, can_withdraw: true });

    expect(ok<{ status: string; version: number }>(r, 'approve_v2')).toMatchObject({ status: 'approved', version: 2 });
    // The version's submitter and the author, once each.
    expect(ok<string[]>(r, 'approved_push')).toEqual([who.mkt, who.mkt2].sort());
    expect(refused(r, 'revise_after')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'withdraw_after')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'decide_again')).toBe('SUBMISSION_DECIDED');
    const end = ok<Detail>(r, 'detail_end');
    expect(end.content).toMatchObject({ status: 'approved', decided_by_name: 'Dev Owner' });
    expect(end).toMatchObject({ can_decide: false, can_revise: false, can_withdraw: false });
    const page = ok<{ content: Array<Record<string, unknown>> }>(r, 'page_approved').content.find((c) => c.id === who.c)!;
    expect(page).toMatchObject({ title: 'Friday reel v2', current_version: 2, cover_image: who.i1, author_name: 'MC mkt',
                                 item_name_en: 'MC Rose latte', campaign_name_ar: 'الجمعة' });
    expect(ok(r, 'claimed')).toEqual({ [who.i1!]: `marketing_content:${who.c}`, [who.i2!]: `marketing_content:${who.c}` });
    expect(ok(r, 'audit')).toEqual([
      { action: 'marketing.content.submit', before: null, after: { status: 'waiting', version: 1, channel: 'instagram', images: 1 } },
      { action: 'marketing.content.changes', before: { status: 'waiting', version: 1 }, after: { status: 'changes', version: 1 } },
      { action: 'marketing.content.revise', before: null, after: { version: 2, status: 'waiting' } },
      { action: 'marketing.content.approve', before: { status: 'waiting', version: 2 }, after: { status: 'approved', version: 2 } },
    ]);
  });

  it('refuses bad input, other items’ images, other venues and every role but marketing', () => {
    const r = scenario([
      ...OTHER_VENUE_SQL,
      ...HERE,
      MK('mkt', 'marketing'), MK('mkt2', 'marketing'),
      ...(['barista', 'driver', 'assistant_barista', 'waiter', 'head_chef'] as const).map((role) => MK(role, role)),
      PHOTO('mine', 'mkt', 'campaigns'), PHOTO('theirs', 'mkt2', 'campaigns'), PHOTO('steps', 'mkt', 'steps'),
      submit('mkt2', 'other_item', `, p_images => array[{{theirs}}]`), RES('other_item', 'other_item', 'id'),
      submit('mkt', 'no_title', '', `'  '`),
      submit('mkt', 'long_title', '', `repeat('t', 121)`),
      T('bad_channel', 'mkt', `select app.submit_content('x', 'myspace', current_date + 1, 'y')`),
      T('past', 'mkt', `select app.submit_content('x', 'instagram', current_date - 2, 'y')`),
      T('no_body', 'mkt', `select app.submit_content('x', 'instagram', current_date + 1, '')`),
      T('long_body', 'mkt', `select app.submit_content('x', 'instagram', current_date + 1, repeat('b', 4001))`),
      submit('mkt', 'long_note', `, p_note => repeat('n', 1001)`),
      submit('mkt', 'http', `, p_media_link => 'http://example.com/reel'`),
      submit('mkt', 'spaces', `, p_media_link => 'https://example.com/a reel'`),
      submit('mkt', 'eleven', `, p_images => array['a','b','c','d','e','f','g','h','i','j','k']`),
      submit('mkt', 'their_image', `, p_images => array[{{theirs}}]`),
      submit('mkt', 'wrong_folder', `, p_images => array[{{steps}}]`),
      submit('mkt', 'far_item', `, p_menu_item_id => {{far_item}}::uuid`),
      submit('mkt', 'far_campaign', `, p_campaign_id => {{far_campaign}}::uuid`),
      submit('mkt', 'far_venue', `, p_venue_id => '${OTHER_VENUE}'`),
      submit('mkt', 'k1', `, p_idempotency_key => 'MC-KEY-1'`),
      submit('mkt', 'k2', `, p_idempotency_key => 'MC-KEY-1'`),
      // mkt2's image belongs to mkt2's item: not to be taken into another.
      T('revise_theirs', 'mkt', `select app.revise_content({{other_item}}::uuid, 'v2', array[{{theirs}}])`),
      T('revise_bad', 'mkt', `select app.revise_content({{other_item}}::uuid, 'v3', p_channel => 'myspace')`),
      T('revise_missing', 'mkt', `select app.revise_content(gen_random_uuid(), 'x')`),
      ...(['barista', 'driver', 'assistant_barista', 'waiter', 'head_chef', 'cashier', 'desk', 'manager', 'owner'] as const)
        .map((w) => submit(w, `sub_${w}`)),
      decide('owner', 'bad_decision', 'other_item', 2, 'maybe'),
      decide('owner', 'wrong_version', 'other_item', 3, 'approve'),
      decide('owner', 'decline_bare', 'other_item', 2, 'decline', `'  '`),
      decide('owner', 'long_reason', 'other_item', 2, 'decline', `repeat('r', 1001)`),
      decide('owner', 'decline', 'other_item', 2, 'decline', `'Not our style'`),
      Q('declined_push', `select coalesce(jsonb_agg(o.profile_id order by o.profile_id), '[]'::jsonb) from notification_outbox o
                           where o.created_at = now() and o.payload->>'title_key' = 'content_declined'`),
      T('withdraw_declined', 'mkt2', `select app.withdraw_content({{other_item}}::uuid)`),
      Q('who', `select jsonb_build_object('mkt', {{mkt}}, 'mkt2', {{mkt2}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    expect(refused(r, 'no_title')).toBe('TEXT_REQUIRED:title');
    expect(refused(r, 'long_title')).toBe('TEXT_TOO_LONG:title');
    expect(refused(r, 'bad_channel')).toBe('INVALID_ARGUMENT:channel');
    expect(refused(r, 'past')).toBe('INVALID_ARGUMENT:planned_for');
    expect(refused(r, 'no_body')).toBe('TEXT_REQUIRED:body');
    expect(refused(r, 'long_body')).toBe('TEXT_TOO_LONG:body');
    expect(refused(r, 'long_note')).toBe('TEXT_TOO_LONG:note');
    expect(refused(r, 'http')).toBe('INVALID_ARGUMENT:media_link');
    expect(refused(r, 'spaces')).toBe('INVALID_ARGUMENT:media_link');
    expect(refused(r, 'eleven')).toBe('INVALID_ARGUMENT:images');
    expect(refused(r, 'their_image')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'wrong_folder')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'far_item')).toBe('ITEM_NOT_FOUND');
    expect(refused(r, 'far_campaign')).toBe('CAMPAIGN_NOT_FOUND');
    expect(refused(r, 'far_venue')).toBe('FORBIDDEN');
    expect(ok(r, 'k2')).toEqual({ ...ok<object>(r, 'k1'), duplicate: true });
    // The same item's image passes a revise, whoever uploaded it.
    expect(ok<{ version: number }>(r, 'revise_theirs').version).toBe(2);
    expect(refused(r, 'revise_bad')).toBe('INVALID_ARGUMENT:channel');
    expect(refused(r, 'revise_missing')).toBe('REF_NOT_FOUND:id');
    for (const w of ['barista', 'driver', 'assistant_barista', 'waiter', 'head_chef', 'cashier', 'desk', 'manager', 'owner']) {
      expect(refused(r, `sub_${w}`), w).toBe('FORBIDDEN');
    }
    expect(refused(r, 'bad_decision')).toBe('INVALID_ARGUMENT:decision');
    expect(refused(r, 'wrong_version')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'decline_bare')).toBe('REASON_REQUIRED');
    expect(refused(r, 'long_reason')).toBe('TEXT_TOO_LONG:note');
    expect(ok<{ status: string }>(r, 'decline').status).toBe('declined');
    // Version 2 was mkt's, the item mkt2's: both hear it.
    expect(ok<string[]>(r, 'declined_push')).toEqual([who.mkt, who.mkt2].sort());
    expect(refused(r, 'withdraw_declined')).toBe('SUBMISSION_DECIDED');
  });

  it('keeps managers out: no RPC, no row, no image; the owner reads it all; marketing through the RPCs', () => {
    const r = scenario([
      MK('mkt', 'marketing'), MK('mkt2', 'marketing'), MK('drv', 'driver'), MK('mgr2', 'manager'),
      PHOTO('img', 'mkt', 'campaigns'),
      submit('mkt', 's', `, p_images => array[{{img}}]`), RES('c', 's', 'id'),
      submit('mkt', 's2', '', `'Second post'`), RES('c2', 's2', 'id'),
      T('withdraw_other', 'drv', `select app.withdraw_content({{c2}}::uuid)`),
      T('withdraw', 'mkt2', `select app.withdraw_content({{c2}}::uuid)`),
      T('withdraw_again', 'mkt', `select app.withdraw_content({{c2}}::uuid)`),
      ...(['manager', 'mgr2', 'drv', 'cashier', 'desk'] as const).flatMap((w) => [
        decide(w, `decide_${w}`, 'c', 1, 'approve'),
        T(`page_${w}`, w, `select app.content_page({{venue}})`),
        T(`detail_${w}`, w, `select app.content_detail({{c}}::uuid)`),
        T(`revise_${w}`, w, `select app.revise_content({{c}}::uuid, 'x')`),
        T(`read_${w}`, w, `select to_jsonb(count(*)) from marketing_content`),
        T(`read_v_${w}`, w, `select to_jsonb(count(*)) from marketing_content_versions`),
      ]),
      decide('mkt2', 'decide_mkt2', 'c', 1, 'approve'),
      T('read_mkt', 'mkt', `select to_jsonb(count(*)) from marketing_content`),
      T('read_owner', 'owner', `select to_jsonb(count(*)) from marketing_content where id = {{c}}::uuid`),
      T('read_v_owner', 'owner', `select to_jsonb(count(*)) from marketing_content_versions where content_id = {{c}}::uuid`),
      T('page_mkt', 'mkt2', `select app.content_page({{venue}}, 'all')`),
      T('page_owner', 'owner', `select app.content_page({{venue}})`),
      T('page_closed', 'owner', `select app.content_page({{venue}}, 'closed')`),
      T('page_bad', 'mkt', `select app.content_page({{venue}}, 'mine')`),
      T('detail_owner', 'owner', `select app.content_detail({{c}}::uuid)`),
      T('detail_mkt2', 'mkt2', `select app.content_detail({{c}}::uuid)`),
      ...(['mkt', 'mkt2', 'owner', 'manager', 'mgr2', 'drv', 'cashier'] as const).map((w) => SEES(`sees_${w}`, w, 'img')),
      Q('columns', `select jsonb_object_agg(t, n) from (
                      select t, (select count(*) from app.assistant_readable_columns a where a.table_name = t) as n
                        from unnest(array['marketing_content', 'marketing_content_versions']) t) x`),
      Q('who', `select jsonb_build_object('c', {{c}}, 'c2', {{c2}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    expect(refused(r, 'withdraw_other')).toBe('FORBIDDEN');
    expect(ok(r, 'withdraw')).toEqual({ status: 'withdrawn' });
    expect(refused(r, 'withdraw_again')).toBe('SUBMISSION_DECIDED');
    for (const w of ['manager', 'mgr2', 'drv', 'cashier', 'desk']) {
      for (const fn of ['decide', 'page', 'detail', 'revise']) expect(refused(r, `${fn}_${w}`), `${fn} ${w}`).toBe('FORBIDDEN');
      expect(ok<number>(r, `read_${w}`), w).toBe(0);
      expect(ok<number>(r, `read_v_${w}`), w).toBe(0);
    }
    expect(refused(r, 'decide_mkt2')).toBe('FORBIDDEN');
    expect(ok<number>(r, 'read_mkt')).toBe(0);
    expect(ok<number>(r, 'read_owner')).toBe(1);
    expect(ok<number>(r, 'read_v_owner')).toBe(1);
    type Page = { content: Array<Record<string, unknown>>; waiting_count: number; total: number };
    const all = ok<Page>(r, 'page_mkt');
    expect(all.content.map((c) => c.id)).toEqual(expect.arrayContaining([who.c, who.c2]));
    expect(ok<Page>(r, 'page_owner').content.every((c) => c.status === 'waiting')).toBe(true);
    expect(ok<Page>(r, 'page_owner').waiting_count).toBe(ok<Page>(r, 'page_owner').total);
    expect(ok<Page>(r, 'page_closed').content.find((c) => c.id === who.c2)).toMatchObject({ status: 'withdrawn' });
    expect(refused(r, 'page_bad')).toBe('INVALID_ARGUMENT:filter');
    expect(ok<Detail>(r, 'detail_owner')).toMatchObject({ can_decide: true, can_revise: false, can_withdraw: false });
    expect(ok<Detail>(r, 'detail_mkt2')).toMatchObject({ can_decide: false, can_revise: true, can_withdraw: true });
    for (const w of ['mkt', 'mkt2', 'owner']) expect(ok<boolean>(r, `sees_${w}`), w).toBe(true);
    for (const w of ['manager', 'mgr2', 'drv', 'cashier']) expect(ok<boolean>(r, `sees_${w}`), w).toBe(false);
    const cols = ok<Record<string, number>>(r, 'columns');
    expect(cols.marketing_content).toBeGreaterThan(0);
    expect(cols.marketing_content_versions).toBe(0);
  });
});
