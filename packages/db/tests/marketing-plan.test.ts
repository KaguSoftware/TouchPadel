/**
 * marketing_plan (0362): marketing's month content plan, the owner's decision
 * on it, and each approved idea's result as a content item (0199).
 *
 *   * the loop: marketing adds a weekly idea (three days in one call) and a
 *     one-off; the owner cannot decide a draft; marketing sends it and the
 *     owners hear it; nothing can be edited while it waits; marketing takes it
 *     back and sends again; the owner approves dropping one idea and the whole
 *     marketing team hears it; a new idea puts the plan back to draft and the
 *     owner asks for changes with no note (0361: the owner never needs one);
 *   * results: a content item for an approved idea shows on the plan; a second
 *     live one is refused; a dropped idea takes none; an approved idea with a
 *     live result cannot be cancelled, one without can;
 *   * settling: removing the last proposed idea of a decided plan approves it
 *     again;
 *   * refusals: bad fields, a past day, two months at once; managers, the
 *     till and the desk are refused every RPC and read no row; the owner
 *     cannot write ideas.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * marketing-content.test.ts harness). Without docker on PATH the suite skips
 * itself.
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
  values (v, 'mp-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'MP ' || p_name, p_role, true);
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

/** Next month's first day at the branch, so every day used is ahead of today. */
const MONTH = `{{month}}::date`;
/** Kept as postgres first: app.venue_business_date is not a client function. */
const DATES = [
  KEEP('month', `select (date_trunc('month', app.venue_business_date({{venue}})) + interval '1 month')::date::text`),
  KEEP('yesterday', `select (app.venue_business_date({{venue}}) - 1)::text`),
];
const DAY = (n: number) => `(${MONTH} + ${n})`;
const add = (who: string, label: string, days: string, title = `'Friday reel'`, extra = '') =>
  T(label, who, `select app.save_plan_idea(null, array[${days}]::date[], ${title}, 'reel', 'instagram', 'Night padel, slow motion'${extra})`);
const plan = (who: string, label: string) => T(label, who, `select app.marketing_plan(${MONTH})`);
const pushes = (label: string, key: string) =>
  Q(label, `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload) order by o.profile_id), '[]'::jsonb)
              from notification_outbox o where o.created_at = now() and o.payload->>'title_key' = '${key}'`);

interface Idea { id: string; day: string; title: string; status: string; drop_note: string | null;
                 result: { id: string; status: string; version: number } | null; [k: string]: unknown }
interface Plan { month: string; plan: { id: string; status: string; decision_note: string | null; sent_by_name: string | null } | null;
                 ideas: Idea[]; waiting_months: string[]; can_edit: boolean; can_send: boolean; can_take_back: boolean;
                 can_decide: boolean }

describe.skipIf(!docker)('marketing_plan (rolled-back transactions)', () => {
  it('runs the month: add, send, take back, approve with a drop, new ideas, changes', () => {
    const r = scenario([
      ...DATES,
      MK('mkt', 'marketing'), MK('mkt2', 'marketing'),
      add('mkt', 'weekly', `${DAY(0)}, ${DAY(7)}, ${DAY(14)}`),
      add('mkt', 'poster', DAY(3), `'Iced latte offer'`),
      RES('p', 'weekly', 'plan_id'),
      KEEP('w1', `select (res #>> '{data,ids,0}') from pg_temp.out where label = 'weekly'`),
      KEEP('w2', `select (res #>> '{data,ids,1}') from pg_temp.out where label = 'weekly'`),
      KEEP('w3', `select (res #>> '{data,ids,2}') from pg_temp.out where label = 'weekly'`),
      KEEP('poster', `select (res #>> '{data,ids,0}') from pg_temp.out where label = 'poster'`),
      plan('mkt', 'draft_mkt'),
      plan('owner', 'draft_owner'),
      T('decide_draft', 'owner', `select app.decide_marketing_plan({{p}}::uuid, 'approve')`),
      T('send', 'mkt', `select app.send_marketing_plan(${MONTH})`),
      pushes('sent_push', 'plan_submitted'),
      T('edit_waiting', 'mkt', `select app.save_plan_idea({{poster}}::uuid, array[${DAY(4)}]::date[], 'Iced latte offer')`),
      add('mkt2', 'add_waiting', DAY(5)),
      T('remove_waiting', 'mkt', `select app.remove_plan_idea({{poster}}::uuid)`),
      T('send_twice', 'mkt', `select app.send_marketing_plan(${MONTH})`),
      plan('owner', 'waiting_owner'),
      T('take_back', 'mkt', `select app.take_back_marketing_plan(${MONTH})`),
      T('edit', 'mkt', `select app.save_plan_idea({{poster}}::uuid, array[${DAY(4)}]::date[], 'Iced latte, two for one', 'poster', 'instagram', null)`),
      T('send_again', 'mkt2', `select app.send_marketing_plan(${MONTH})`),
      T('drop_foreign', 'owner', `select app.decide_marketing_plan({{p}}::uuid, 'approve', null, array[gen_random_uuid()])`),
      T('drop_on_changes', 'owner', `select app.decide_marketing_plan({{p}}::uuid, 'changes', null, array[{{w3}}::uuid])`),
      T('approve', 'owner', `select app.decide_marketing_plan({{p}}::uuid, 'approve', 'Skip the third week', array[{{w3}}::uuid])`),
      pushes('approved_push', 'plan_approved'),
      T('decide_again', 'owner', `select app.decide_marketing_plan({{p}}::uuid, 'approve')`),
      plan('mkt', 'approved_mkt'),
      T('edit_approved', 'mkt', `select app.save_plan_idea({{w1}}::uuid, array[${DAY(1)}]::date[], 'Moved')`),
      add('mkt', 'extra', DAY(20), `'Tournament teaser'`),
      T('send_extra', 'mkt', `select app.send_marketing_plan(${MONTH})`),
      T('changes', 'owner', `select app.decide_marketing_plan({{p}}::uuid, 'changes')`),
      pushes('changes_push', 'plan_changes'),
      plan('mkt', 'changes_mkt'),
      Q('audit', `select jsonb_agg(action order by id) from audit_log where entity = 'marketing_plans' and entity_id = {{p}}`),
      Q('who', `select jsonb_build_object('mkt', {{mkt}}, 'mkt2', {{mkt2}}, 'owner', {{owner}}, 'manager', {{manager}},
                                          'p', {{p}}, 'w1', {{w1}}, 'w3', {{w3}}, 'poster', {{poster}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');

    const draft = ok<Plan>(r, 'draft_mkt');
    expect(draft.plan?.status).toBe('draft');
    expect(draft.ideas.map((i) => i.title)).toEqual(['Friday reel', 'Iced latte offer', 'Friday reel', 'Friday reel']);
    expect(draft.ideas.every((i) => i.status === 'proposed' && i.result === null)).toBe(true);
    expect(draft).toMatchObject({ can_edit: true, can_send: true, can_take_back: false, can_decide: false });
    expect(ok<Plan>(r, 'draft_owner')).toMatchObject({ can_edit: false, can_send: false, can_decide: false });
    expect(refused(r, 'decide_draft')).toBe('SUBMISSION_DECIDED');

    expect(ok(r, 'send')).toEqual({ status: 'waiting', ideas: 4 });
    const sent = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'sent_push');
    expect(sent.map((p) => p.to)).toContain(who.owner);
    expect(sent.map((p) => p.to)).not.toContain(who.manager);
    expect(sent.find((p) => p.to === who.owner)).toMatchObject({
      kind: 'staff_decide',
      payload: { route: 'staff', title_key: 'plan_submitted', params: { name: 'MP mkt' }, dedupe: `plan:${who.p}` },
    });
    expect(refused(r, 'edit_waiting')).toBe('PLAN_WAITING');
    expect(refused(r, 'add_waiting')).toBe('PLAN_WAITING');
    expect(refused(r, 'remove_waiting')).toBe('PLAN_WAITING');
    expect(refused(r, 'send_twice')).toBe('SUBMISSION_DECIDED');
    const waiting = ok<Plan>(r, 'waiting_owner');
    expect(waiting).toMatchObject({ can_decide: true, can_edit: false });
    expect(waiting.waiting_months).toEqual([waiting.month]);

    expect(ok(r, 'take_back')).toEqual({ status: 'draft' });
    expect(ok<{ ids: string[] }>(r, 'edit').ids).toEqual([who.poster]);
    expect(ok(r, 'send_again')).toEqual({ status: 'waiting', ideas: 4 });
    expect(refused(r, 'drop_foreign')).toBe('INVALID_ARGUMENT:drop');
    expect(refused(r, 'drop_on_changes')).toBe('INVALID_ARGUMENT:drop');
    expect(ok(r, 'approve')).toEqual({ status: 'approved', approved: 3, dropped: 1 });
    const approved = ok<Array<{ to: string }>>(r, 'approved_push').map((p) => p.to);
    expect(approved).toEqual(expect.arrayContaining([who.mkt, who.mkt2]));
    expect(approved).not.toContain(who.owner);
    expect(refused(r, 'decide_again')).toBe('SUBMISSION_DECIDED');

    const after = ok<Plan>(r, 'approved_mkt');
    expect(after.plan).toMatchObject({ status: 'approved', decision_note: 'Skip the third week' });
    const byId = new Map(after.ideas.map((i) => [i.id, i]));
    expect(byId.get(who.w1)?.status).toBe('approved');
    expect(byId.get(who.poster)).toMatchObject({ status: 'approved', title: 'Iced latte, two for one' });
    expect(byId.get(who.w3)).toMatchObject({ status: 'dropped', drop_note: 'Skip the third week' });
    expect(refused(r, 'edit_approved')).toBe('IDEA_LOCKED');

    expect(ok<{ plan_status: string }>(r, 'extra').plan_status).toBe('draft');
    expect(ok(r, 'send_extra')).toEqual({ status: 'waiting', ideas: 1 });
    // The owner never needs a reason (0361).
    expect(ok(r, 'changes')).toEqual({ status: 'changes', approved: 0, dropped: 0 });
    expect(ok<Array<{ payload: Record<string, unknown> }>>(r, 'changes_push')[0]?.payload).toMatchObject({ title_key: 'plan_changes' });
    const changed = ok<Plan>(r, 'changes_mkt');
    expect(changed).toMatchObject({ can_edit: true, can_send: true });
    expect(changed.ideas.filter((i) => i.status === 'approved')).toHaveLength(3);

    expect(ok<string[]>(r, 'audit')).toEqual([
      'marketing.plan.idea_add', 'marketing.plan.idea_add', 'marketing.plan.send', 'marketing.plan.take_back',
      'marketing.plan.send', 'marketing.plan.approve', 'marketing.plan.idea_add', 'marketing.plan.send',
      'marketing.plan.changes',
    ]);
  });

  it('links a result to an approved idea, once, and settles the plan', () => {
    const r = scenario([
      ...DATES,
      MK('mkt', 'marketing'),
      add('mkt', 'a', `${DAY(2)}, ${DAY(9)}`),
      RES('p', 'a', 'plan_id'),
      KEEP('i1', `select (res #>> '{data,ids,0}') from pg_temp.out where label = 'a'`),
      KEEP('i2', `select (res #>> '{data,ids,1}') from pg_temp.out where label = 'a'`),
      add('mkt', 'b', DAY(11), `'Story poll'`),
      KEEP('i3', `select (res #>> '{data,ids,0}') from pg_temp.out where label = 'b'`),
      T('send', 'mkt', `select app.send_marketing_plan(${MONTH})`),
      T('approve', 'owner', `select app.decide_marketing_plan({{p}}::uuid, 'approve', null, array[{{i3}}::uuid])`),
      T('result', 'mkt', `select app.submit_content('Friday reel', 'instagram', ${DAY(2)}, 'Caption',
                            p_media_link => 'https://drive.google.com/file/d/abc/view', p_idea_id => {{i1}}::uuid)`),
      RES('c', 'result', 'id'),
      T('result_twice', 'mkt', `select app.submit_content('Friday reel', 'instagram', ${DAY(2)}, 'Caption', p_idea_id => {{i1}}::uuid)`),
      T('result_dropped', 'mkt', `select app.submit_content('Story poll', 'instagram', ${DAY(2)}, 'Caption', p_idea_id => {{i3}}::uuid)`),
      T('result_unknown', 'mkt', `select app.submit_content('x', 'instagram', ${DAY(2)}, 'Caption', p_idea_id => gen_random_uuid())`),
      T('cancel_live', 'mkt', `select app.remove_plan_idea({{i1}}::uuid)`),
      plan('owner', 'with_result'),
      T('declined', 'owner', `select app.decide_content({{c}}::uuid, 1, 'decline', 'Too dark')`),
      T('result_after_decline', 'mkt', `select app.submit_content('Friday reel', 'instagram', ${DAY(2)}, 'Brighter', p_idea_id => {{i1}}::uuid)`),
      T('cancel', 'mkt', `select app.remove_plan_idea({{i2}}::uuid)`),
      // A new idea, then removed: the decided plan goes back to approved.
      add('mkt', 'c', DAY(15), `'Coach tip'`),
      KEEP('i4', `select (res #>> '{data,ids,0}') from pg_temp.out where label = 'c'`),
      T('remove_new', 'mkt', `select app.remove_plan_idea({{i4}}::uuid)`),
      plan('mkt', 'end'),
      Q('who', `select jsonb_build_object('c', {{c}}, 'i1', {{i1}}, 'i2', {{i2}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    expect(ok(r, 'approve')).toEqual({ status: 'approved', approved: 2, dropped: 1 });
    expect(refused(r, 'result_twice')).toBe('IDEA_HAS_RESULT');
    expect(refused(r, 'result_dropped')).toBe('IDEA_LOCKED');
    expect(refused(r, 'result_unknown')).toBe('REF_NOT_FOUND:idea');
    expect(refused(r, 'cancel_live')).toBe('IDEA_LOCKED');
    const withResult = ok<Plan>(r, 'with_result').ideas.find((i) => i.id === who.i1);
    expect(withResult?.result).toMatchObject({ id: who.c, status: 'waiting', version: 1 });
    expect(ok<{ status: string }>(r, 'declined').status).toBe('declined');
    expect(ok<{ status: string }>(r, 'result_after_decline').status).toBe('waiting');
    expect(ok(r, 'cancel')).toEqual({ status: 'cancelled', plan_status: 'approved' });
    expect(ok<{ plan_status: string }>(r, 'c').plan_status).toBe('draft');
    expect(ok(r, 'remove_new')).toEqual({ status: 'removed', plan_status: 'approved' });
    const end = ok<Plan>(r, 'end');
    expect(end.plan?.status).toBe('approved');
    expect(end.ideas.find((i) => i.id === who.i1)?.result?.id).not.toBe(who.c);
    expect(end.ideas.find((i) => i.id === who.i2)?.status).toBe('cancelled');
  });

  it('refuses bad fields, other roles and the owner writing', () => {
    const r = scenario([
      ...DATES,
      MK('mkt', 'marketing'),
      add('mkt', 'blank', DAY(1), `'  '`),
      add('mkt', 'long', DAY(1), `repeat('x', 121)`),
      T('kind', 'mkt', `select app.save_plan_idea(null, array[${DAY(1)}]::date[], 'x', 'billboard')`),
      T('channel', 'mkt', `select app.save_plan_idea(null, array[${DAY(1)}]::date[], 'x', 'post', 'myspace')`),
      T('details', 'mkt', `select app.save_plan_idea(null, array[${DAY(1)}]::date[], 'x', 'post', 'instagram', repeat('y', 2001))`),
      T('past', 'mkt', `select app.save_plan_idea(null, array[{{yesterday}}::date]::date[], 'x')`),
      T('two_months', 'mkt', `select app.save_plan_idea(null, array[${DAY(1)}, (${MONTH} + interval '1 month')::date]::date[], 'x')`),
      T('no_days', 'mkt', `select app.save_plan_idea(null, '{}'::date[], 'x')`),
      T('send_empty', 'mkt', `select app.send_marketing_plan(${MONTH})`),
      add('mkt', 'ok', DAY(1)),
      RES('p', 'ok', 'plan_id'),
      KEEP('i', `select (res #>> '{data,ids,0}') from pg_temp.out where label = 'ok'`),
      T('edit_many', 'mkt', `select app.save_plan_idea({{i}}::uuid, array[${DAY(1)}, ${DAY(2)}]::date[], 'x')`),
      add('owner', 'owner_add', DAY(1)),
      add('manager', 'manager_add', DAY(1)),
      add('cashier', 'cashier_add', DAY(1)),
      plan('manager', 'manager_read'),
      plan('desk', 'desk_read'),
      T('manager_remove', 'manager', `select app.remove_plan_idea({{i}}::uuid)`),
      T('owner_remove', 'owner', `select app.remove_plan_idea({{i}}::uuid)`),
      T('manager_send', 'manager', `select app.send_marketing_plan(${MONTH})`),
      T('send', 'mkt', `select app.send_marketing_plan(${MONTH})`),
      T('manager_decide', 'manager', `select app.decide_marketing_plan({{p}}::uuid, 'approve')`),
      T('mkt_decide', 'mkt', `select app.decide_marketing_plan({{p}}::uuid, 'approve')`),
      T('bad_decision', 'owner', `select app.decide_marketing_plan({{p}}::uuid, 'decline')`),
      T('long_note', 'owner', `select app.decide_marketing_plan({{p}}::uuid, 'changes', repeat('n', 1001))`),
      T('manager_rows', 'manager', `select to_jsonb((select count(*) from marketing_plans) + (select count(*) from marketing_plan_ideas))`),
      T('mkt_rows', 'mkt', `select to_jsonb((select count(*) from marketing_plans) + (select count(*) from marketing_plan_ideas))`),
      T('owner_rows', 'owner', `select to_jsonb((select count(*) from marketing_plans where id = {{p}}) + (select count(*) from marketing_plan_ideas where plan_id = {{p}}))`),
      T('owner_insert', 'owner', `insert into marketing_plans (venue_id, month) values ({{venue}}, ${MONTH}) returning to_jsonb(id)`),
    ]);
    expect(refused(r, 'blank')).toBe('TEXT_REQUIRED:title');
    expect(refused(r, 'long')).toBe('TEXT_TOO_LONG:title');
    expect(refused(r, 'kind')).toBe('INVALID_ARGUMENT:kind');
    expect(refused(r, 'channel')).toBe('INVALID_ARGUMENT:channel');
    expect(refused(r, 'details')).toBe('TEXT_TOO_LONG:details');
    expect(refused(r, 'past')).toBe('INVALID_ARGUMENT:day_past');
    expect(refused(r, 'two_months')).toBe('INVALID_ARGUMENT:days');
    expect(refused(r, 'no_days')).toBe('INVALID_ARGUMENT:days');
    expect(refused(r, 'send_empty')).toBe('PLAN_EMPTY');
    expect(refused(r, 'edit_many')).toBe('INVALID_ARGUMENT:days');
    for (const label of ['owner_add', 'manager_add', 'cashier_add', 'manager_read', 'desk_read', 'manager_remove',
                         'owner_remove', 'manager_send', 'manager_decide', 'mkt_decide']) {
      expect(refused(r, label), label).toBe('FORBIDDEN');
    }
    expect(refused(r, 'bad_decision')).toBe('INVALID_ARGUMENT:decision');
    expect(refused(r, 'long_note')).toBe('TEXT_TOO_LONG:note');
    expect(ok(r, 'manager_rows')).toBe(0);
    expect(ok(r, 'mkt_rows')).toBe(0);
    expect(ok(r, 'owner_rows')).toBe(2);
    expect(r['owner_insert']?.ok).toBe(false);
  });
});
