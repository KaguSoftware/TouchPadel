/**
 * marketing_requests (build-contracts-2026-09-23 §2.24.11, §2.21, §2.22,
 * §8.2): staff ask marketing for something, marketing answers, and marketing
 * reads its campaigns' reach in counts only.
 *
 *   * a cashier, a driver and a barista each ask (marketing_request_new
 *     reaches marketing at the venue); marketing is refused; the text, date,
 *     item and photo checks refuse bad input; a retry under one key is one
 *     request;
 *   * marketing answers done or declined; the asker sees the answer and gets
 *     marketing_request_answered; a second answer, or a withdraw after it, is
 *     SUBMISSION_DECIDED; only the asker withdraws;
 *   * a caller who is neither marketing nor MGMT is refused the page and the
 *     answer; a request's photo reads to the asker, marketing and MGMT only;
 *   * marketing_campaign_results carries no key ending in _iqd and none
 *     starting with revenue or discount, refuses the bar and kitchen roles,
 *     the driver and the desk, and never shows another venue's campaign;
 *   * the driver and marketing read no row of the table (§8.2).
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, requests, campaigns, slots
 * and storage rows are created inside it and each call runs as
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
  values (v, 'mr-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'MR ' || p_name, p_role, true);
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
const OTHER_VENUE = '00000000-0000-4000-8000-00000000c3c3';
/** An inactive venue nobody here works at, and a campaign there. */
const OTHER_VENUE_SQL = `insert into venues (id, slug, name_en, name_ar, is_active)
  values ('${OTHER_VENUE}', 'mr-other-venue', 'MR other', 'مكان آخر', false);
  -- 0230: a category links a tax group of its own branch.
  insert into tax_groups (venue_id, name_en, name_ar, rate_bp)
  values ('${OTHER_VENUE}', 'far tax', 'ضريبة بعيدة', 0);`;

const ask = (who: string, label: string, title: string, body: string, extra = '') =>
  T(label, who, `select app.add_marketing_request(${title}, ${body}${extra})`);
const answer = (who: string, label: string, id: string, outcome: string, text: string) =>
  T(label, who, `select app.answer_marketing_request({{${id}}}, ${outcome}, ${text})`);

/** Keys that would carry money, at any depth. */
function moneyKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/_iqd$|^cost|^supplier|^revenue|^discount/i.test(k) ? [`${path}.${k}`] : []),
      ...moneyKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

interface Req {
  id: string;
  title: string;
  body: string;
  want_by: string | null;
  menu_item_id: string | null;
  item_name_en: string | null;
  photos: string[];
  status: string;
  answer: string | null;
  answered_by_name: string | null;
  requested_by_name?: string;
  requested_by_role?: string;
}

describe.skipIf(!docker)('marketing_requests (rolled-back transactions)', () => {
  it('any role but marketing asks; the checks refuse bad input; marketing is told', () => {
    const r = scenario([
      OTHER_VENUE_SQL,
      MK('bar', 'barista'), MK('drv', 'driver'), MK('mkt', 'marketing'), MK('mkt2', 'marketing'),
      KEEP('cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
                   values ('MR cat', 'تصنيف', 'b0000000-0000-4000-8000-000000000001', {{venue}}) returning id::text`),
      KEEP('item', `insert into menu_items (category_id, name_en, name_ar, venue_id)
                    values ({{cat}}::uuid, 'MR Rose latte', 'لاتيه الورد', {{venue}}) returning id::text`),
      KEEP('far_cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
                       values ('MR far', 'بعيد', (select id from tax_groups where venue_id = '${OTHER_VENUE}' limit 1), '${OTHER_VENUE}') returning id::text`),
      KEEP('far_item', `insert into menu_items (category_id, name_en, name_ar, venue_id)
                        values ({{far_cat}}::uuid, 'MR far', 'بعيد', '${OTHER_VENUE}') returning id::text`),
      PHOTO('p1', 'bar', 'requests'),
      PHOTO('p_steps', 'bar', 'steps'),
      PHOTO('p_drv', 'drv', 'requests'),
      ask('cashier', 'a_cashier', `'  Poster for the new menu  '`, `'A1 poster, both languages.'`,
          `, p_want_by => current_date + 7, p_venue_id => {{venue}}`),
      ask('drv', 'a_drv', `'Van sticker'`, `'Our logo on the van.'`),
      ask('bar', 'a_bar', `'Rose latte post'`, `'A reel of the new latte.'`,
          `, p_menu_item_id => {{item}}::uuid, p_photos => array[{{p1}}, {{p1}}]`),
      Q('push', `select jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                                   order by o.payload->>'id', o.profile_id)
                   from notification_outbox o
                  where o.created_at = now() and o.payload->>'title_key' = 'marketing_request_new'
                    and o.profile_id in ({{mkt}}::uuid, {{mkt2}}::uuid, {{bar}}::uuid, {{cashier}}::uuid)`),
      ask('mkt', 'a_mkt', `'x'`, `'y'`),
      ask('bar', 'no_title', `' '`, `'y'`),
      ask('bar', 'no_body', `'x'`, `''`),
      ask('bar', 'long_title', `repeat('t', 121)`, `'y'`),
      ask('bar', 'long_body', `'x'`, `repeat('b', 2001)`),
      ask('bar', 'past', `'x'`, `'y'`, `, p_want_by => current_date - 3`),
      ask('bar', 'far_item', `'x'`, `'y'`, `, p_menu_item_id => {{far_item}}::uuid`),
      ask('bar', 'too_many', `'x'`, `'y'`, `, p_photos => array['a','b','c','d','e']`),
      ask('bar', 'wrong_folder', `'x'`, `'y'`, `, p_photos => array[{{p_steps}}]`),
      ask('bar', 'foreign_photo', `'x'`, `'y'`, `, p_photos => array[{{p_drv}}]`),
      ask('bar', 'other_venue', `'x'`, `'y'`, `, p_venue_id => '${OTHER_VENUE}'`),
      ask('bar', 'replay1', `'Replay'`, `'Once.'`, `, p_idempotency_key => 'MR-KEY-1'`),
      ask('bar', 'replay2', `'Replay'`, `'Once.'`, `, p_idempotency_key => 'MR-KEY-1'`),
      Q('replay_rows', `select to_jsonb(count(*)) from marketing_requests where title = 'Replay'`),
      RES('bar_req', 'a_bar', 'id'),
      Q('claimed', `select to_jsonb(used_by) from staff_media_uploads where path = {{p1}}`),
      T('mine_bar', 'bar', `select app.my_marketing_requests({{venue}})`),
      T('mine_cashier', 'cashier', `select app.my_marketing_requests()`),
      T('mine_mkt', 'mkt', `select app.my_marketing_requests({{venue}})`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'after', a.after))
                    from audit_log a where a.entity = 'marketing_request' and a.entity_id = {{bar_req}}`),
      // §8.2: the table is MGMT's.
      ...(['drv', 'mkt', 'bar', 'manager'] as const).map((who) =>
        T(`read_${who}`, who, `select to_jsonb(count(*)) from marketing_requests`)),
    ]);
    const ids = ['a_cashier', 'a_drv', 'a_bar'].map((l) => ok<{ id: string }>(r, l).id);
    const push = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'push');
    // Both marketing accounts, for each of the three; no one else.
    expect(push.filter((p) => ids.includes(p.payload.id as string))).toHaveLength(6);
    expect(push.every((p) => p.kind === 'staff_task')).toBe(true);
    const barPush = push.find((p) => p.payload.id === ids[2])!;
    expect(barPush.payload).toEqual({ route: 'staff', id: ids[2], title_key: 'marketing_request_new',
                                      params: { name: 'MR bar', title: 'Rose latte post' } });
    expect(refused(r, 'a_mkt')).toBe('FORBIDDEN');
    expect(refused(r, 'no_title')).toBe('TEXT_REQUIRED:title');
    expect(refused(r, 'no_body')).toBe('TEXT_REQUIRED:body');
    expect(refused(r, 'long_title')).toBe('TEXT_TOO_LONG:title');
    expect(refused(r, 'long_body')).toBe('TEXT_TOO_LONG:body');
    expect(refused(r, 'past')).toBe('INVALID_ARGUMENT:want_by');
    expect(refused(r, 'far_item')).toBe('ITEM_NOT_FOUND');
    expect(refused(r, 'too_many')).toBe('INVALID_ARGUMENT:photos');
    expect(refused(r, 'wrong_folder')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'foreign_photo')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'other_venue')).toBe('FORBIDDEN');
    expect(ok<{ id: string; duplicate: boolean }>(r, 'replay2'))
      .toEqual({ id: ok<{ id: string }>(r, 'replay1').id, duplicate: true });
    expect(ok<number>(r, 'replay_rows')).toBe(1);
    expect(ok<string>(r, 'claimed')).toBe(`marketing_request:${ids[2]}`);

    const mine = ok<{ requests: Req[] }>(r, 'mine_bar').requests;
    expect(mine.map((q) => q.title).sort()).toEqual(['Replay', 'Rose latte post']);
    expect(mine.find((q) => q.title === 'Rose latte post')).toMatchObject({ body: 'A reel of the new latte.', want_by: null, item_name_en: 'MR Rose latte',
                                    photos: [expect.stringMatching(/\/requests\//)], status: 'open', answer: null });
    expect(ok<{ requests: Req[] }>(r, 'mine_cashier').requests.map((q) => q.title)).toContain('Poster for the new menu');
    expect(refused(r, 'mine_mkt')).toBe('FORBIDDEN');
    const audit = ok<Array<{ action: string; after: Record<string, unknown> }>>(r, 'audit');
    expect(audit).toEqual([{ action: 'marketing.request.add',
                             after: { status: 'open', menu_item_id: expect.any(String), photos: 1 } }]);
    for (const who of ['drv', 'mkt', 'bar']) expect(ok<number>(r, `read_${who}`), who).toBe(0);
    expect(ok<number>(r, 'read_manager')).toBeGreaterThan(0);
  });

  it('marketing answers, the asker hears; decided requests stay decided; only the asker withdraws', () => {
    const r = scenario([
      OTHER_VENUE_SQL,
      MK('bar', 'barista'), MK('drv', 'driver'), MK('mkt', 'marketing'), MK('hc', 'head_chef'),
      ask('bar', 'q1', `'Rose latte post'`, `'A reel.'`),
      ask('drv', 'q2', `'Van sticker'`, `'Our logo.'`),
      ask('cashier', 'q3', `'Menu board'`, `'New prices board.'`),
      RES('q1', 'q1', 'id'), RES('q2', 'q2', 'id'), RES('q3', 'q3', 'id'),
      answer('bar', 'ans_bar', 'q1', `'done'`, `'x'`),
      answer('drv', 'ans_drv', 'q1', `'done'`, `'x'`),
      answer('manager', 'ans_mgr', 'q1', `'done'`, `'x'`),
      answer('hc', 'ans_hc', 'q1', `'done'`, `'x'`),
      answer('mkt', 'ans_bad', 'q1', `'maybe'`, `'x'`),
      answer('mkt', 'ans_empty', 'q1', `'done'`, `'  '`),
      answer('mkt', 'ans_long', 'q1', `'done'`, `repeat('a', 2001)`),
      answer('mkt', 'ans_missing', 'q1', `'done'`, `'x'`).replace(`{{q1}}`, `gen_random_uuid()`),
      answer('mkt', 'ans1', 'q1', `'done'`, `'  Posted on Friday.  '`),
      Q('answered_push', `select jsonb_agg(jsonb_build_object('to', o.profile_id, 'payload', o.payload))
                            from notification_outbox o
                           where o.created_at = now() and o.payload->>'title_key' = 'marketing_request_answered'`),
      answer('mkt', 'ans_again', 'q1', `'declined'`, `'No.'`),
      T('wd_after', 'bar', `select app.withdraw_marketing_request({{q1}})`),
      T('wd_other', 'bar', `select app.withdraw_marketing_request({{q2}})`),
      T('wd_mkt', 'mkt', `select app.withdraw_marketing_request({{q2}})`),
      T('wd_own', 'drv', `select app.withdraw_marketing_request({{q2}})`),
      T('wd_again', 'drv', `select app.withdraw_marketing_request({{q2}})`),
      answer('mkt', 'ans_withdrawn', 'q2', `'done'`, `'x'`),
      answer('mkt', 'decline', 'q3', `'declined'`, `'Not this month.'`),
      T('mine_bar', 'bar', `select app.my_marketing_requests({{venue}})`),
      ...(['mkt', 'manager', 'owner'] as const).map((who) =>
        T(`page_${who}`, who, `select app.marketing_requests_page({{venue}}, 'all')`)),
      T('page_open', 'mkt', `select app.marketing_requests_page({{venue}})`),
      T('page_answered', 'mkt', `select app.marketing_requests_page({{venue}}, 'answered')`),
      T('page_bad', 'mkt', `select app.marketing_requests_page({{venue}}, 'mine')`),
      ...(['bar', 'drv', 'hc', 'cashier', 'desk', 'prep'] as const).map((who) =>
        T(`page_${who}`, who, `select app.marketing_requests_page({{venue}})`)),
      Q('audit', `select jsonb_agg(a.action order by a.action) from audit_log a
                   where a.entity = 'marketing_request' and a.entity_id in ({{q1}}, {{q2}}, {{q3}})`),
    ]);
    for (const l of ['ans_bar', 'ans_drv', 'ans_mgr', 'ans_hc']) expect(refused(r, l), l).toBe('FORBIDDEN');
    expect(refused(r, 'ans_bad')).toBe('INVALID_ARGUMENT:outcome');
    expect(refused(r, 'ans_empty')).toBe('TEXT_REQUIRED:answer');
    expect(refused(r, 'ans_long')).toBe('TEXT_TOO_LONG:answer');
    expect(refused(r, 'ans_missing')).toBe('REF_NOT_FOUND:id');
    expect(ok<{ status: string; answered_at: string }>(r, 'ans1').status).toBe('done');
    const push = ok<Array<{ to: string; payload: Record<string, unknown> }>>(r, 'answered_push');
    expect(push).toHaveLength(1);
    expect(push[0]!.payload).toEqual({ route: 'staff', id: ok<{ id: string }>(r, 'q1').id,
                                       title_key: 'marketing_request_answered', params: { title: 'Rose latte post' } });
    expect(refused(r, 'ans_again')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'wd_after')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'wd_other')).toBe('FORBIDDEN');
    expect(refused(r, 'wd_mkt')).toBe('FORBIDDEN');
    expect(ok(r, 'wd_own')).toEqual({ status: 'withdrawn' });
    expect(refused(r, 'wd_again')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'ans_withdrawn')).toBe('SUBMISSION_DECIDED');
    expect(ok<{ status: string }>(r, 'decline').status).toBe('declined');

    const mine = ok<{ requests: Req[] }>(r, 'mine_bar').requests.find((q) => q.title === 'Rose latte post')!;
    expect(mine).toMatchObject({ status: 'done', answer: 'Posted on Friday.', answered_by_name: 'MR mkt' });
    type Page = { requests: Req[]; open_count: number; total: number };
    for (const who of ['mkt', 'manager', 'owner']) {
      const page = ok<Page>(r, `page_${who}`);
      const q = page.requests.find((x) => x.title === 'Menu board')!;
      expect(q, who).toMatchObject({ status: 'declined', requested_by_name: 'Dev Cashier', requested_by_role: 'cashier' });
    }
    expect(ok<Page>(r, 'page_open').requests.every((q) => q.status === 'open')).toBe(true);
    expect(ok<Page>(r, 'page_answered').requests.map((q) => q.status).sort()).toEqual(
      expect.arrayContaining(['declined', 'done']));
    expect(ok<Page>(r, 'page_answered').requests.some((q) => q.status === 'withdrawn')).toBe(false);
    expect(ok<Page>(r, 'page_open').open_count).toBe(ok<Page>(r, 'page_open').total);
    expect(refused(r, 'page_bad')).toBe('INVALID_ARGUMENT:filter');
    for (const who of ['bar', 'drv', 'hc', 'cashier', 'desk', 'prep']) {
      expect(refused(r, `page_${who}`), who).toBe('FORBIDDEN');
    }
    expect(ok<string[]>(r, 'audit')).toEqual([
      'marketing.request.add', 'marketing.request.add', 'marketing.request.add',
      'marketing.request.answer', 'marketing.request.answer', 'marketing.request.withdraw',
    ]);
  });

  it('shows a request’s photo to the asker, marketing and MGMT only', () => {
    const r = scenario([
      MK('bar', 'barista'), MK('bar2', 'barista'), MK('drv', 'driver'), MK('mkt', 'marketing'),
      PHOTO('p1', 'bar', 'requests'),
      ask('bar', 'q', `'Rose latte post'`, `'A reel.'`, `, p_photos => array[{{p1}}]`),
      ...(['bar', 'mkt', 'manager', 'owner', 'bar2', 'drv', 'cashier'] as const).map((who) => SEES(`sees_${who}`, who, 'p1')),
    ]);
    ok(r, 'q');
    for (const who of ['bar', 'mkt', 'manager', 'owner']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(true);
    for (const who of ['bar2', 'drv', 'cashier']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(false);
  });

  it('gives marketing and MGMT the venue’s campaigns in counts only, and no one else', () => {
    const r = scenario([
      OTHER_VENUE_SQL,
      MK('mkt', 'marketing'), MK('drv', 'driver'),
      ...(['head_barista', 'barista', 'head_chef', 'chef'] as const).map((role) => MK(role, role)),
      KEEP('promo', `insert into promotions (name_en, name_ar, type, value, created_by, enabled)
                     values ('MR promo', 'عرض', 'percent', 10, {{owner}}::uuid, false) returning id::text`),
      KEEP('c_promo', `insert into marketing_campaigns (venue_id, name_en, name_ar, channel, status, starts_at,
                                                          promotion_id, created_by, created_at)
                       values ({{venue}}, 'MR with promo', 'حملة', 'in_venue', 'live', now() - interval '2 days',
                               {{promo}}::uuid, {{owner}}::uuid, now() - interval '2 days') returning id::text`),
      KEEP('c_plain', `insert into marketing_campaigns (venue_id, name_en, name_ar, channel, created_by, suggested_by)
                       values ({{venue}}, 'MR plain', 'حملة بسيطة', 'guest_site', {{owner}}::uuid, {{mkt}}::uuid)
                       returning id::text`),
      KEEP('c_far', `insert into marketing_campaigns (venue_id, name_en, name_ar, channel, created_by)
                     values ('${OTHER_VENUE}', 'MR far', 'بعيدة', 'guest_site', {{owner}}::uuid) returning id::text`),
      `insert into marketing_sends (campaign_id, recipients, delivered, failed)
       select val::uuid, 40, 37, 3 from pg_temp.vars where name = 'c_promo';`,
      `insert into marketing_sends (campaign_id, recipients, delivered, failed)
       select val::uuid, 10, 10, 0 from pg_temp.vars where name = 'c_promo';`,
      ...(['mkt', 'manager', 'owner'] as const).map((who) =>
        T(`res_${who}`, who, `select app.marketing_campaign_results({{venue}}, 100)`)),
      ...(['head_barista', 'barista', 'head_chef', 'chef', 'drv', 'desk', 'cashier', 'prep'] as const).map((who) =>
        T(`res_${who}`, who, `select app.marketing_campaign_results({{venue}})`)),
      T('res_far', 'mkt', `select app.marketing_campaign_results('${OTHER_VENUE}')`),
    ]);
    type Res = { campaigns: Array<Record<string, unknown>> };
    for (const who of ['mkt', 'manager', 'owner']) {
      const res = ok<Res>(r, `res_${who}`);
      expect(moneyKeys(res), who).toEqual([]);
      const names = res.campaigns.map((c) => c.name_en);
      expect(names, who).toEqual(expect.arrayContaining(['MR with promo', 'MR plain']));
      expect(names, who).not.toContain('MR far');
      const promo = res.campaigns.find((c) => c.name_en === 'MR with promo')!;
      expect(promo).toMatchObject({ channel: 'in_venue', status: 'live', sends: 50, delivered: 47, failed: 3,
                                    attributable: true, redemptions: 0, suggested_by_me: false });
      expect(Object.keys(promo).sort()).toEqual(['attributable', 'campaign_id', 'channel', 'delivered', 'ends_at',
        'failed', 'last_sent_at', 'name_ar', 'name_en', 'redemptions', 'sends', 'starts_at', 'status',
        'suggested_by_me']);
      const plain = res.campaigns.find((c) => c.name_en === 'MR plain')!;
      expect(plain).toMatchObject({ sends: 0, attributable: false, redemptions: null,
                                    suggested_by_me: who === 'mkt' });
    }
    for (const who of ['head_barista', 'barista', 'head_chef', 'chef', 'drv', 'desk', 'cashier', 'prep']) {
      expect(refused(r, `res_${who}`), who).toBe('FORBIDDEN');
    }
    expect(refused(r, 'res_far')).toBe('FORBIDDEN');
  });
});
