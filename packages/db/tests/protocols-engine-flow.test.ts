/**
 * protocols_engine_rpcs (build-contracts-2026-09-23 §2.7, §2.8, §8.2) — the
 * engine's moves, end to end.
 *
 *   * a product release from a head chef's proposal to the owner's launch:
 *     the manager's accept (with its decision data), the test assigned to
 *     the proposer, a send-back to itself that keeps the photo, a send-back
 *     from the price step to the test (history kept, later steps reset, the
 *     approved test's photo sent again), the owner's fixed OK on the price
 *     step, a terminal step that waits for every other, and the finish
 *     hook's run status;
 *   * a send-back resets what waits for its target, whatever the template's
 *     order (the price step sent back leaves an approved marketing step
 *     alone, in the default and the swapped order), and approved photos go
 *     again on every reset step;
 *   * photos follow the run: the staff-media read policy shows a photo to
 *     exactly those the engine's reads show it to (a hiring run's owner-added
 *     step stays MGMT's), receipts and campaign images to their uploader and
 *     MGMT, a marketing note's to marketing;
 *   * automatic passes for the manager and the owner, withdraw of a step and
 *     of a run, CANNOT_DECIDE_OWN, the start guards and titles;
 *   * a tournament: skip of the optional step, a scheduled finish and
 *     cancel_schedule, stop_protocol, and a stop decision;
 *   * How it works: the dependency rule, the fixed steps and OK (#58), and a
 *     template row written around the RPC still snapshotting the owner's OK;
 *   * the owner's per-run edits and ticks, and an owner-added step, never
 *     below a step that has already started;
 *   * the two transition tables, the reason CHECKs at the table, the missing
 *     start hook, and the default templates of a new venue.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back: staff are
 * created inside it, every kind hook other lanes may have applied to the
 * shared stack (E, F) is dropped inside it and replaced by logging test
 * hooks, and each call runs as `authenticated` with the caller's JWT claims,
 * as PostgREST runs it. Nothing is committed, so nothing is cleaned up and no
 * other lane's objects are touched outside the transaction. Without docker on
 * PATH the suite skips itself.
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

// ── the in-transaction harness ──────────────────────────────────────────────
// vars:    named values; {{name}} in a statement becomes its quoted literal,
//          @@name@@ its raw text (inside a JSON literal).
// t():     one call as a staff member (role authenticated + claims), its
//          result or its error recorded under a label.
// q()/qe(): a read (or an expected failure) as postgres, recorded the same way.
// keep():  a value into vars.
// mk():    an auth user and a staff row with a role (the 0123 trigger files a
//          non-owner at venue A).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
create temp table hook_log (seq serial, hook text, args jsonb);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('manager_b', '${SEED_STAFF_IDS.manager_b}'), ('cashier', '${SEED_STAFF_IDS.cashier}'),
  ('desk', '${SEED_STAFF_IDS.court_desk}'), ('venue', '${VENUE_A_ID}');

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

create function pg_temp.t(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text; v_state text;
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
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_state = returned_sqlstate;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, ''), 'state', v_state));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.qe(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_msg text; v_state text; v_con text;
begin
  begin
    execute pg_temp.sub(p_sql);
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate, v_con = constraint_name;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'state', v_state, 'constraint', nullif(v_con, '')));
  end;
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
  values (v, 'pe-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'PE ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

do $d$ declare r record; begin
  for r in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app'
              and p.proname ~ '^protocol_(start|check|submit|pass|finish|stop)_(product_release|tournament|hiring|price_promo)'
  loop execute 'drop function ' || r.sig; end loop;
end $d$;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
  state?: string;
  constraint?: string | null;
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
const QE = (label: string, sql: string) => `select pg_temp.qe('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const STEP = (name: string, run: string, position: number) =>
  KEEP(name, `select id::text from protocol_run_steps where run_id = {{${run}}} and position = ${position}`);
const STEPK = (name: string, run: string, key: string) =>
  KEEP(name, `select id::text from protocol_run_steps where run_id = {{${run}}} and step_key = '${key}'`);

/** Logging test hooks, created inside the scenario's transaction. */
const log = (hook: string, args: string) =>
  `insert into pg_temp.hook_log(hook, args) values ('${hook}', ${args});`;
const HOOK = {
  start: (kind: string) =>
    `create function app.protocol_start_${kind}(p_run_id uuid, p_data jsonb) returns jsonb language plpgsql as $h$
     begin ${log(`start_${kind}`, "jsonb_build_object('data', p_data)")} return '{}'::jsonb; end $h$;`,
  pass: (kind: string, key: string, extra = '') =>
    `create function app.protocol_pass_${kind}_${key}(p_step uuid, p_sub uuid, p_data jsonb) returns void language plpgsql as $h$
     begin ${log(`pass_${key}`, "jsonb_build_object('data', p_data, 'sub', p_sub)")} ${extra} end $h$;`,
  submit: (kind: string, key: string) =>
    `create function app.protocol_submit_${kind}_${key}(p_sub uuid) returns void language plpgsql as $h$
     begin ${log(`submit_${key}`, "jsonb_build_object('sub', p_sub)")} end $h$;`,
  finish: (kind: string, status: string) =>
    `create function app.protocol_finish_${kind}(p_run_id uuid) returns text language plpgsql as $h$
     begin ${log(`finish_${kind}`, "jsonb_build_object('run', p_run_id)")} return '${status}'; end $h$;`,
  stop: (kind: string) =>
    `create function app.protocol_stop_${kind}(p_run_id uuid) returns void language plpgsql as $h$
     begin ${log(`stop_${kind}`, "jsonb_build_object('run', p_run_id)")} end $h$;`,
};

const HOOKS_Q = Q(
  'hooks',
  `select coalesce(jsonb_agg(jsonb_build_object('hook', hook, 'args', args) order by seq), '[]') from pg_temp.hook_log`,
);
const OUTBOX_Q = (label: string, run: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                               order by o.id), '[]')
       from notification_outbox o
      where o.payload->>'id' in (select s.id::text from protocol_run_steps s where s.run_id = {{${run}}}
                                 union all select {{${run}}}::text)`,
  );
const STEPS_Q = (label: string, run: string) =>
  Q(
    label,
    `select jsonb_agg(jsonb_build_object('position', position, 'key', step_key, 'status', status, 'round', round,
                                         'ok', needs_owner_ok, 'assigned_to', assigned_to) order by position)
       from protocol_run_steps where run_id = {{${run}}}`,
  );

// ── result accessors ────────────────────────────────────────────────────────
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

interface Push {
  to: string;
  kind: string;
  payload: { route: string; id: string; title_key: string; params: Record<string, unknown> };
}
interface StepState {
  position: number;
  key: string | null;
  status: string;
  round: number;
  ok: boolean;
  assigned_to: string | null;
}
interface Submission {
  id: string;
  round: number;
  record: Record<string, unknown> | null;
  photos: string[];
  decision: string | null;
  decision_note: string | null;
  superseded_at: string | null;
  withdrawn_at: string | null;
  send_back_to: string | null;
}
interface StepRow {
  id: string;
  step_key: string | null;
  status: string;
  round: number;
  items: Array<{ id: string; text_en: string; done_by: string | null }>;
  submissions: Submission[];
}
interface Can {
  submit: boolean;
  withdraw_submission_id: string | null;
  decide_submission_id: string | null;
  send_back_targets: string[];
  skip: boolean;
  tick: boolean;
  edit_items: boolean;
  add_step: boolean;
  stop: boolean;
  withdraw_run: boolean;
  cancel_schedule: boolean;
}
interface RunDetail {
  run: { id: string; status: string; started_by: string; data: Record<string, unknown> | null; waiting_on_me: boolean };
  steps: StepRow[];
  can: Can;
}
interface Work {
  todo: Array<{ run_step_id: string }>;
  waiting: Array<{ submission_id: string }>;
  decided: Array<{ submission_id: string; decision: string }>;
  to_decide: Array<{ submission_id: string; needs_owner_ok: boolean }>;
  counts: { todo: number; waiting: number; to_decide: number };
}
interface Moved {
  submission_id?: string;
  auto?: boolean;
  step_status: string;
  run_status?: string;
  opened_step_ids?: string[];
}

const pushesFor = (pushes: Push[], id: string, titleKey: string) =>
  pushes.filter((p) => p.payload.id === id && p.payload.title_key === titleKey).map((p) => p.to);

describe.skipIf(!docker)('protocols engine flows (rolled-back transactions)', () => {
  it('a product release runs from the head chef’s proposal to the owner’s launch', () => {
    const r = scenario([
      MK('hc', 'head_chef'),
      MK('hb', 'head_barista'),
      MK('mk', 'marketing'),
      MK('chef', 'chef'),
      MK('drv', 'driver'),
      HOOK.start('product_release'),
      // A check hook that names its field: its code reaches the caller, and
      // its normalised record is what the row and the pass hook get.
      `create function app.protocol_check_product_release_propose(p_step uuid, p_record jsonb, p_photos text[])
       returns jsonb language plpgsql as $h$
       begin
         if coalesce(p_record->>'name_en', '') = '' then
           raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'name_en';
         end if;
         return p_record || jsonb_build_object('checked', true);
       end $h$;`,
      HOOK.pass('product_release', 'propose'),
      HOOK.submit('product_release', 'test'),
      HOOK.finish('product_release', 'live'),

      T('start_norecord', 'hc', `select app.start_protocol('product_release', null, 'Rose latte')`),
      T('start_hookcode', 'hc', `select app.start_protocol('product_release', null, 'Rose latte', null, '{}', '{"note":"x"}')`),
      T('start', 'hc', `select app.start_protocol('product_release', null, 'Rose latte', null, '{}',
                          '{"name_en":"Rose latte"}', '{}', null, 'pe-flow-start-1')`),
      T('start_replay', 'hc', `select app.start_protocol('product_release', null, 'Rose latte', null, '{}',
                          '{"name_en":"Rose latte"}', '{}', null, 'pe-flow-start-1')`),
      RES('run', 'start', 'run_id'),
      STEP('s1', 'run', 1),
      STEP('s2', 'run', 2),
      STEP('s3', 'run', 3),
      STEP('s4', 'run', 4),
      STEP('s5', 'run', 5),
      RES('sub1', 'start', 'submission_id'),
      Q('runs_count', `select to_jsonb(count(*)) from protocol_runs where started_by = {{hc}}`),
      STEPS_Q('steps_start', 'run'),

      // Who sees it.
      T('hc_detail', 'hc', `select app.protocol_run_detail({{run}})`),
      T('hb_detail', 'hb', `select app.protocol_run_detail({{run}})`),
      T('mk_detail', 'mk', `select app.protocol_run_detail({{run}})`),
      T('chef_detail', 'chef', `select app.protocol_run_detail({{run}})`),
      T('drv_step', 'drv', `select app.protocol_step_detail({{s1}})`),
      T('mgr_work', 'manager', `select app.my_protocol_work(null)`),
      T('owner_work', 'owner', `select app.my_protocol_work(null)`),

      // The manager accepts, with the category as decision data.
      T('hb_decide', 'hb', `select app.decide_step({{sub1}}, 'approve')`),
      T('approve_propose', 'manager', `select app.decide_step({{sub1}}, 'approve', null, null, '{"category_id":"cat-probe"}')`),

      // The test is the proposer's, with at least one photo.
      T('hb_test', 'hb', `select app.submit_step({{s2}}, '{"note":"x"}')`),
      T('slot1', 'hc', `select app.staff_media_slot({{venue}}, 'tests', 'jpg')`),
      RES('p1', 'slot1', 'path'),
      T('test_nophoto', 'hc', `select app.submit_step({{s2}}, '{"note":"first"}')`),
      T('test_badkey', 'hc', `select app.submit_step({{s2}}, '{"servings":2}', array[{{p1}}])`),
      T('test1', 'hc', `select app.submit_step({{s2}}, '{"note":"first"}', array[{{p1}}], 'pe-flow-test-1')`),
      T('test1_replay', 'hc', `select app.submit_step({{s2}}, '{"note":"first"}', array[{{p1}}], 'pe-flow-test-1')`),
      RES('sub2a', 'test1', 'submission_id'),
      Q('slot_after_1', `select to_jsonb(used_by) from staff_media_uploads where path = {{p1}}`),

      // Sent back to itself: a new round keeps the photo.
      T('sendback_noreason', 'manager', `select app.decide_step({{sub2a}}, 'send_back')`),
      T('sendback_self', 'manager', `select app.decide_step({{sub2a}}, 'send_back', 'More milk, please')`),
      T('test2', 'hc', `select app.submit_step({{s2}}, '{"note":"second"}', array[{{p1}}])`),
      RES('sub2b', 'test2', 'submission_id'),
      Q('slot_after_2', `select to_jsonb(used_by) from staff_media_uploads where path = {{p1}}`),
      T('approve_test', 'manager', `select app.decide_step({{sub2b}}, 'approve')`),

      // Price (fixed OK, mgmt record) and marketing (OK on) in parallel.
      T('analysis1', 'manager', `select app.submit_step({{s3}}, '{"note":"5000 a cup"}')`),
      RES('sub3a', 'analysis1', 'submission_id'),
      T('marketing1', 'mk', `select app.submit_step({{s4}}, '{"note":"hero line"}')`),
      RES('sub4a', 'marketing1', 'submission_id'),
      T('hc_step3', 'hc', `select app.protocol_step_detail({{s3}})`),
      T('mk_detail2', 'mk', `select app.protocol_run_detail({{run}})`),
      T('mgr_decide_price', 'manager', `select app.decide_step({{sub3a}}, 'approve')`),
      T('owner_work2', 'owner', `select app.my_protocol_work(null)`),
      T('owner_step3', 'owner', `select app.protocol_step_detail({{s3}})`),

      // The owner sends the price back to the test: history kept, later steps reset.
      T('badtarget', 'owner', `select app.decide_step({{sub3a}}, 'send_back', 'no', {{s5}})`),
      T('sendback_test', 'owner', `select app.decide_step({{sub3a}}, 'send_back', 'Test it again with less sugar', {{s2}})`),
      STEPS_Q('steps_after_sendback', 'run'),
      Q('sub4a_after', `select to_jsonb(s) from protocol_submissions s where id = {{sub4a}}`),
      T('withdraw_superseded', 'mk', `select app.withdraw_step({{sub4a}})`),
      // The photo of round 2's approved test goes again with round 3.
      T('test3', 'hc', `select app.submit_step({{s2}}, '{"note":"third"}', array[{{p1}}])`),
      RES('sub2c', 'test3', 'submission_id'),
      Q('slot_after_3', `select to_jsonb(used_by) from staff_media_uploads where path = {{p1}}`),
      T('approve_test3', 'manager', `select app.decide_step({{sub2c}}, 'approve')`),
      T('analysis2', 'manager', `select app.submit_step({{s3}}, '{"note":"6000 a cup"}')`),
      RES('sub3b', 'analysis2', 'submission_id'),
      T('marketing2', 'mk', `select app.submit_step({{s4}}, '{"note":"hero line 2"}')`),
      RES('sub4b', 'marketing2', 'submission_id'),
      T('launch_early', 'owner', `select app.submit_step({{s5}}, '{}')`),
      T('ok_price', 'owner', `select app.decide_step({{sub3b}}, 'approve')`),
      T('ok_marketing', 'owner', `select app.decide_step({{sub4b}}, 'approve')`),

      // Launch: the owner's alone, and it passes on submit.
      T('mgr_launch', 'manager', `select app.submit_step({{s5}}, '{}')`),
      T('launch', 'owner', `select app.submit_step({{s5}}, '{}')`),
      Q('run_final', `select jsonb_build_object('status', status, 'live_at', live_at, 'finished_at', finished_at)
                        from protocol_runs where id = {{run}}`),
      Q('s2_history', `select jsonb_agg(jsonb_build_object('round', round, 'decision', decision) order by submitted_at)
                         from protocol_submissions where run_step_id = {{s2}}`),
      Q('audit', `select jsonb_agg(action order by id) from audit_log where entity_id = {{run}}::text`),
      T('withdraw_after', 'hc', `select app.withdraw_protocol({{run}})`),
      OUTBOX_Q('pushes', 'run'),
      HOOKS_Q,
    ]);

    const v = (name: string) => r[name];
    expect(refused(r, 'start_norecord')).toBe('RECORD_INVALID:record');
    expect(refused(r, 'start_hookcode')).toBe('RECORD_INVALID:name_en');
    const start = ok<{ run_id: string; status: string; auto: boolean; first_step_id: string }>(r, 'start');
    expect(start.status).toBe('active');
    expect(start.auto).toBe(false);
    const replay = ok<{ run_id: string; duplicate: boolean }>(r, 'start_replay');
    expect(replay.run_id).toBe(start.run_id);
    expect(replay.duplicate).toBe(true);
    expect(ok<number>(r, 'runs_count')).toBe(1);

    const steps = ok<StepState[]>(r, 'steps_start');
    expect(steps.map((s) => [s.key, s.status])).toEqual([
      ['propose', 'submitted'], ['test', 'waiting'], ['analysis', 'waiting'],
      ['marketing', 'waiting'], ['launch', 'waiting'],
    ]);
    // The test is the proposer's; the price step takes the owner's OK from the def.
    const hcId = ok<RunDetail>(r, 'hc_detail').run.started_by;
    expect(steps[1]!.assigned_to).toBe(hcId);
    expect(steps[2]!.ok).toBe(true);

    // Involvement: the proposer, another head (propose actor), marketing
    // (marketing actor); not a chef, not the driver.
    const hcDetail = ok<RunDetail>(r, 'hc_detail');
    expect(hcDetail.can.withdraw_run).toBe(true);
    expect(hcDetail.run.data).toEqual({});
    expect(hcDetail.steps[0]!.submissions[0]!.record).toEqual({ name_en: 'Rose latte', checked: true });
    expect(v('hb_detail')!.ok).toBe(true);
    expect(v('mk_detail')!.ok).toBe(true);
    expect(refused(r, 'chef_detail')).toBe('PROTOCOL_NOT_FOUND');
    expect(refused(r, 'drv_step')).toBe('PROTOCOL_NOT_FOUND');
    const sub1 = ok<{ submission_id: string }>(r, 'start').submission_id;
    expect(ok<Work>(r, 'mgr_work').to_decide.map((w) => w.submission_id)).toContain(sub1);
    // A manager at the venue decides an OK-off step, so it does not wait on the owner.
    expect(ok<Work>(r, 'owner_work').to_decide.map((w) => w.submission_id)).not.toContain(sub1);

    expect(refused(r, 'hb_decide')).toBe('NOT_DECIDER');
    expect(ok<Moved>(r, 'approve_propose')).toMatchObject({ decision: 'approve', step_status: 'passed', run_status: 'active' });
    expect(ok<Moved>(r, 'approve_propose').opened_step_ids).toEqual([hcDetail.steps[1]!.id]);

    expect(refused(r, 'hb_test')).toBe('NOT_STEP_ACTOR');
    expect(refused(r, 'test_nophoto')).toBe('RECORD_INVALID:photos');
    expect(refused(r, 'test_badkey')).toBe('RECORD_INVALID:servings');
    const test1 = ok<Moved>(r, 'test1');
    expect(test1.auto).toBe(false);
    const test1Replay = ok<Moved & { duplicate: boolean }>(r, 'test1_replay');
    expect(test1Replay.duplicate).toBe(true);
    expect(test1Replay.submission_id).toBe(test1.submission_id);
    expect(ok<string>(r, 'slot_after_1')).toBe(`protocol_submission:${test1.submission_id}`);

    expect(refused(r, 'sendback_noreason')).toBe('REASON_REQUIRED');
    expect(ok<Moved>(r, 'sendback_self')).toMatchObject({ step_status: 'open', run_status: 'active' });
    const test2 = ok<Moved>(r, 'test2');
    // The re-claim: the sent-back submission's photo now belongs to the new one.
    expect(ok<string>(r, 'slot_after_2')).toBe(`protocol_submission:${test2.submission_id}`);
    expect(ok<Moved>(r, 'approve_test').opened_step_ids).toHaveLength(2);

    // The price step goes to the owner, even from the manager.
    expect(ok<Moved>(r, 'analysis1').auto).toBe(false);
    expect(refused(r, 'mgr_decide_price')).toBe('NOT_DECIDER');
    const ownerWork2 = ok<Work>(r, 'owner_work2');
    expect(ownerWork2.to_decide.map((w) => w.submission_id)).toEqual(
      expect.arrayContaining([ok<Moved>(r, 'analysis1').submission_id, ok<Moved>(r, 'marketing1').submission_id]),
    );
    // A mgmt step's record: hidden from the starter and from marketing, not the owner.
    const hcStep3 = ok<{ step: StepRow; run: { data: unknown } }>(r, 'hc_step3');
    expect(hcStep3.step.submissions[0]!.record).toBeNull();
    expect(hcStep3.run.data).toEqual({});
    const mkDetail2 = ok<RunDetail>(r, 'mk_detail2');
    expect(mkDetail2.run.data).toBeNull();
    expect(mkDetail2.steps[2]!.submissions[0]!.record).toBeNull();
    expect(mkDetail2.steps[0]!.submissions[0]!.record).not.toBeNull();
    const ownerStep3 = ok<{ step: StepRow; can: Can }>(r, 'owner_step3');
    expect(ownerStep3.step.submissions[0]!.record).toEqual({ note: '5000 a cup' });
    expect(ownerStep3.can.decide_submission_id).toBe(ok<Moved>(r, 'analysis1').submission_id);
    expect(ownerStep3.can.send_back_targets).toHaveLength(3); // propose, test, and the step itself

    expect(refused(r, 'badtarget')).toBe('SEND_BACK_TARGET_INVALID');
    expect(ok<Moved>(r, 'sendback_test')).toMatchObject({ decision: 'send_back', step_status: 'waiting' });
    const after = ok<StepState[]>(r, 'steps_after_sendback');
    expect(after.map((s) => [s.key, s.status, s.round])).toEqual([
      ['propose', 'passed', 1], ['test', 'open', 3], ['analysis', 'waiting', 2],
      ['marketing', 'waiting', 1], ['launch', 'waiting', 1],
    ]);
    const sub4a = ok<Submission>(r, 'sub4a_after');
    expect(sub4a.superseded_at).not.toBeNull();
    expect(sub4a.decision).toBeNull();
    expect(refused(r, 'withdraw_superseded')).toBe('SUBMISSION_DECIDED');
    // Re-claimed from an approved submission of an earlier round (§2.3).
    expect(ok<string>(r, 'slot_after_3')).toBe(`protocol_submission:${ok<Moved>(r, 'test3').submission_id}`);

    expect(ok<Moved>(r, 'approve_test3').opened_step_ids).toHaveLength(2);
    expect(refused(r, 'launch_early')).toBe('STEP_NOT_OPEN');
    // Launch waits for both parallel steps.
    expect(ok<Moved>(r, 'ok_price').opened_step_ids).toEqual([]);
    expect(ok<Moved>(r, 'ok_marketing').opened_step_ids).toHaveLength(1);
    expect(refused(r, 'mgr_launch')).toBe('NOT_STEP_ACTOR');
    expect(ok<Moved>(r, 'launch')).toMatchObject({ auto: true, step_status: 'passed', run_status: 'live' });
    const final = ok<{ status: string; live_at: string | null; finished_at: string | null }>(r, 'run_final');
    expect(final.status).toBe('live');
    expect(final.live_at).not.toBeNull();
    expect(final.finished_at).toBeNull();
    expect(ok<Array<{ round: number; decision: string }>>(r, 's2_history')).toEqual([
      { round: 1, decision: 'send_back' }, { round: 2, decision: 'approve' }, { round: 3, decision: 'approve' },
    ]);
    expect(refused(r, 'withdraw_after')).toBe('INVALID_TRANSITION');

    const audit = ok<string[]>(r, 'audit');
    expect(audit[0]).toBe('protocol.start');
    expect(audit.filter((a) => a === 'protocol.submit')).toHaveLength(9);
    expect(audit.filter((a) => a === 'protocol.auto')).toHaveLength(1);
    expect(audit.filter((a) => a === 'protocol.decide')).toHaveLength(7);

    // Hooks: the pass hook got the decider's data; the submit hook ran once
    // per test round (never for a replay); the finish hook said live.
    const hooks = ok<Array<{ hook: string; args: { data?: unknown } }>>(r, 'hooks');
    expect(hooks.filter((h) => h.hook === 'start_product_release')).toHaveLength(1);
    expect(hooks.find((h) => h.hook === 'pass_propose')!.args.data).toEqual({ category_id: 'cat-probe' });
    expect(hooks.filter((h) => h.hook === 'submit_test')).toHaveLength(3);
    expect(hooks.filter((h) => h.hook === 'finish_product_release')).toHaveLength(1);

    // Pushes in the §2.21 shape: the managers decide the proposal, the test
    // opens for its assignee only, the price waits on the owners, launch
    // opens for the owners; nobody hears about their own act.
    const pushes = ok<Push[]>(r, 'pushes');
    const s1 = hcDetail.steps[0]!.id;
    const s2 = hcDetail.steps[1]!.id;
    const s3 = hcDetail.steps[2]!.id;
    const s5 = hcDetail.steps[4]!.id;
    expect(pushesFor(pushes, s1, 'step_submitted')).toEqual(
      expect.arrayContaining([SEED_STAFF_IDS.manager, SEED_STAFF_IDS.manager_b]),
    );
    expect(pushesFor(pushes, s1, 'step_submitted')).not.toContain(SEED_STAFF_IDS.owner);
    expect(new Set(pushesFor(pushes, s2, 'step_open'))).toEqual(new Set([hcId]));
    expect(pushesFor(pushes, s3, 'step_submitted')).toContain(SEED_STAFF_IDS.owner);
    expect(pushesFor(pushes, s3, 'step_submitted')).not.toContain(SEED_STAFF_IDS.manager);
    // Launch opened on the owner's own approval: its actors are the owners, and
    // the caller is never told about their own act.
    expect(pushesFor(pushes, s5, 'step_open')).not.toContain(SEED_STAFF_IDS.owner);
    expect(pushesFor(pushes, s5, 'step_open')).not.toContain(SEED_STAFF_IDS.manager);
    expect(pushesFor(pushes, s2, 'step_sent_back')).toContain(hcId);
    for (const p of pushes) {
      expect(Object.keys(p.payload).sort()).toEqual(['id', 'params', 'route', 'title_key']);
      expect(p.payload.route).toBe('staff-step');
      expect(p.payload.params).toMatchObject({ title: 'Rose latte' });
      expect(Object.keys(p.payload.params).every((k) => k === 'step' || k === 'title')).toBe(true);
    }
  });

  it('automatic passes, withdrawals, CANNOT_DECIDE_OWN and the start guards', () => {
    const r = scenario([
      MK('hc', 'head_chef'),
      MK('mk', 'marketing'),
      MK('barista', 'barista'),
      HOOK.start('product_release'),
      HOOK.start('price_promo'),
      HOOK.start('hiring'),
      HOOK.stop('product_release'),

      T('bad_kind', 'manager', `select app.start_protocol('nope', null, 'x', null, '{}', '{}')`),
      T('bad_variant', 'manager', `select app.start_protocol('tournament', null, 'x', null, '{}', '{}')`),
      T('bad_variant2', 'manager', `select app.start_protocol('hiring', 'type1', 'x', null, '{}', '{}')`),
      T('barista_start', 'barista', `select app.start_protocol('product_release', null, 'x', null, '{}', '{}')`),
      T('mk_tournament', 'mk', `select app.start_protocol('tournament', 'type1', 'x', null, '{}', '{}')`),
      T('mk_release', 'mk', `select app.start_protocol('product_release', null, 'x', null, '{}', '{}')`),
      T('cashier_start', 'cashier', `select app.start_protocol('price_promo', null, 'x', null, '{}', '{}')`),
      T('no_title', 'hc', `select app.start_protocol('product_release', null, null, '   ', '{}', '{}')`),
      T('long_title', 'hc', `select app.start_protocol('product_release', null, repeat('a', 121), null, '{}', '{}')`),
      T('owner_one_title', 'owner', `select app.start_protocol('price_promo', null, 'Only English', null, '{}', '{}')`),

      // The owner's own step passes on submit (Q12), both titles typed.
      T('owner_start', 'owner', `select app.start_protocol('price_promo', null, 'Coffee price', 'سعر القهوة', '{}', '{"note":"go"}')`),
      RES('run_o', 'owner_start', 'run_id'),
      STEPS_Q('steps_o', 'run_o'),
      // The manager's own proposal passes too (#9).
      T('mgr_start', 'manager', `select app.start_protocol('product_release', null, 'Manager item', null, '{}', '{"note":"cat"}')`),
      RES('run_m', 'mgr_start', 'run_id'),
      STEPS_Q('steps_m', 'run_m'),
      Q('mgr_sub', `select to_jsonb(s) from protocol_submissions s join protocol_run_steps st on st.id = s.run_step_id
                     where st.run_id = {{run_m}} and st.position = 1`),
      T('mgr_withdraw_run', 'manager', `select app.withdraw_protocol({{run_m}})`),
      // A hiring run: OK on, so the manager's proposal waits for the owner;
      // its push leaves the title out.
      T('hire_start', 'manager', `select app.start_protocol('hiring', null, 'Barista for October', null, '{}', '{}')`),
      RES('run_hire', 'hire_start', 'run_id'),
      OUTBOX_Q('hire_pushes', 'run_hire'),

      // Withdraw a step, then the run.
      T('hc_start', 'hc', `select app.start_protocol('product_release', null, 'HC item', null, '{}', '{"note":"a"}')`),
      RES('run_h', 'hc_start', 'run_id'),
      RES('sub_h', 'hc_start', 'submission_id'),
      STEP('h1', 'run_h', 1),
      T('mk_withdraw_other', 'mk', `select app.withdraw_step({{sub_h}})`),
      T('hc_withdraw', 'hc', `select app.withdraw_step({{sub_h}})`),
      T('hc_withdraw_again', 'hc', `select app.withdraw_step({{sub_h}})`),
      T('hc_detail_open', 'hc', `select app.protocol_step_detail({{h1}})`),
      T('hc_resubmit', 'hc', `select app.submit_step({{h1}}, '{"note":"b"}')`),
      RES('sub_h2', 'hc_resubmit', 'submission_id'),
      T('mk_withdraw_run', 'mk', `select app.withdraw_protocol({{run_h}})`),
      T('hc_withdraw_run', 'hc', `select app.withdraw_protocol({{run_h}})`),
      Q('withdrawn', `select jsonb_build_object(
                        'run', (select status from protocol_runs where id = {{run_h}}),
                        'finished', (select finished_at is not null from protocol_runs where id = {{run_h}}),
                        'sub', (select withdrawn_at is not null from protocol_submissions where id = {{sub_h2}}),
                        'step', (select status from protocol_run_steps where id = {{h1}}))`),
      T('decide_closed', 'manager', `select app.decide_step({{sub_h2}}, 'approve')`),

      // CANNOT_DECIDE_OWN: the proposer becomes a manager before the decision.
      T('hc_start2', 'hc', `select app.start_protocol('product_release', null, 'HC item two', null, '{}', '{"note":"c"}')`),
      RES('sub_c', 'hc_start2', 'submission_id'),
      Q('promote', `update staff set role = 'manager' where id = {{hc}} returning to_jsonb(role)`),
      T('own_decision', 'hc', `select app.decide_step({{sub_c}}, 'approve')`),
      HOOKS_Q,
    ]);

    expect(refused(r, 'bad_kind')).toBe('INVALID_ARGUMENT:kind');
    expect(refused(r, 'bad_variant')).toBe('INVALID_ARGUMENT:variant');
    expect(refused(r, 'bad_variant2')).toBe('INVALID_ARGUMENT:variant');
    expect(refused(r, 'barista_start')).toBe('FORBIDDEN');
    expect(refused(r, 'mk_tournament')).toBe('FORBIDDEN');
    expect(refused(r, 'mk_release')).toBe('FORBIDDEN');
    expect(refused(r, 'cashier_start')).toBe('FORBIDDEN');
    expect(refused(r, 'no_title')).toBe('TEXT_REQUIRED:title');
    expect(refused(r, 'long_title')).toBe('TEXT_TOO_LONG:title');
    expect(refused(r, 'owner_one_title')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:title');

    expect(ok<Moved>(r, 'owner_start').auto).toBe(true);
    expect(ok<StepState[]>(r, 'steps_o').map((s) => s.status)).toEqual(['passed', 'open', 'waiting', 'waiting']);
    expect(ok<Moved>(r, 'mgr_start').auto).toBe(true);
    const stepsM = ok<StepState[]>(r, 'steps_m');
    expect(stepsM.map((s) => s.status)).toEqual(['passed', 'open', 'waiting', 'waiting', 'waiting']);
    expect(stepsM[1]!.assigned_to).toBe(SEED_STAFF_IDS.manager);
    const mgrSub = ok<{ decision: string; decided_by: string; submitted_by: string }>(r, 'mgr_sub');
    expect(mgrSub.decision).toBe('auto');
    expect(mgrSub.decided_by).toBe(mgrSub.submitted_by);
    expect(refused(r, 'mgr_withdraw_run')).toBe('INVALID_TRANSITION');

    expect(ok<Moved>(r, 'hire_start').auto).toBe(false);
    const hirePushes = ok<Push[]>(r, 'hire_pushes');
    expect(hirePushes.length).toBeGreaterThan(0);
    for (const p of hirePushes) {
      expect(p.payload.title_key).toBe('step_submitted');
      expect(p.payload.params).not.toHaveProperty('title');
      expect(p.payload.params).toHaveProperty('step');
    }
    expect(hirePushes.map((p) => p.to)).toContain(SEED_STAFF_IDS.owner);

    expect(refused(r, 'mk_withdraw_other')).toBe('FORBIDDEN');
    expect(ok<Moved>(r, 'hc_withdraw').step_status).toBe('open');
    expect(refused(r, 'hc_withdraw_again')).toBe('SUBMISSION_DECIDED');
    const openDetail = ok<{ step: StepRow; can: Can }>(r, 'hc_detail_open');
    expect(openDetail.step.status).toBe('open');
    expect(openDetail.can.submit).toBe(true);
    expect(openDetail.step.submissions[0]!.withdrawn_at).not.toBeNull();
    expect(refused(r, 'mk_withdraw_run')).toBe('FORBIDDEN');
    expect(ok<{ run_status: string }>(r, 'hc_withdraw_run').run_status).toBe('withdrawn');
    expect(ok<Record<string, unknown>>(r, 'withdrawn')).toEqual({ run: 'withdrawn', finished: true, sub: true, step: 'open' });
    expect(refused(r, 'decide_closed')).toBe('PROTOCOL_CLOSED');
    expect(ok<Array<{ hook: string }>>(r, 'hooks').filter((h) => h.hook === 'stop_product_release')).toHaveLength(1);

    expect(ok<string>(r, 'promote')).toBe('manager');
    expect(refused(r, 'own_decision')).toBe('CANNOT_DECIDE_OWN');
  });

  it('a send-back resets what waits for its target, whatever the order, and approved photos go again', () => {
    const rel = RELEASE_STEPS;
    const submit = (label: string, who: string, step: string, note: string, photo?: string) =>
      T(label, who, `select app.submit_step({{${step}}}, '{"note":"${note}"}'${photo ? `, array[{{${photo}}}]` : ''})`);
    const decide = (label: string, who: string, sub: string, how: string) =>
      T(label, who, `select app.decide_step({{${sub}}}, ${how})`);
    const r = scenario([
      MK('hc', 'head_chef'),
      MK('mk', 'marketing'),
      HOOK.start('product_release'),

      // A: the default order, price (3) below marketing (4).
      T('a_start', 'hc', `select app.start_protocol('product_release', null, 'Order A', null, '{}', '{"note":"x"}')`),
      RES('a_run', 'a_start', 'run_id'),
      RES('a_sub1', 'a_start', 'submission_id'),
      STEPK('a_test', 'a_run', 'test'),
      STEPK('a_price', 'a_run', 'analysis'),
      STEPK('a_mkt', 'a_run', 'marketing'),
      Q('a_mkt_id', `select to_jsonb({{a_mkt}}::text)`),
      decide('a_ok1', 'manager', 'a_sub1', `'approve'`),
      T('a_slot_t', 'hc', `select app.staff_media_slot({{venue}}, 'tests', 'jpg')`),
      RES('a_pt', 'a_slot_t', 'path'),
      submit('a_test1', 'hc', 'a_test', 't1', 'a_pt'),
      RES('a_subt1', 'a_test1', 'submission_id'),
      decide('a_ok2', 'manager', 'a_subt1', `'approve'`),
      T('a_slot_m', 'mk', `select app.staff_media_slot({{venue}}, 'marketing', 'jpg')`),
      RES('a_pm', 'a_slot_m', 'path'),
      submit('a_mkt1', 'mk', 'a_mkt', 'm1', 'a_pm'),
      RES('a_subm1', 'a_mkt1', 'submission_id'),
      decide('a_ok_m', 'owner', 'a_subm1', `'approve'`),
      submit('a_price1', 'manager', 'a_price', 'p1'),
      RES('a_subp1', 'a_price1', 'submission_id'),
      // The price sent back to itself: marketing does not wait for it.
      decide('a_back_self', 'owner', 'a_subp1', `'send_back', 'Too high'`),
      STEPS_Q('a_steps1', 'a_run'),
      submit('a_price2', 'manager', 'a_price', 'p2'),
      RES('a_subp2', 'a_price2', 'submission_id'),
      // The price sent back to the test: both steps after the test wait again.
      decide('a_back_test', 'owner', 'a_subp2', `'send_back', 'Taste it again', {{a_test}}`),
      STEPS_Q('a_steps2', 'a_run'),
      submit('a_test2', 'hc', 'a_test', 't2', 'a_pt'),
      RES('a_subt2', 'a_test2', 'submission_id'),
      decide('a_ok3', 'manager', 'a_subt2', `'approve'`),
      submit('a_mkt2', 'mk', 'a_mkt', 'm2', 'a_pm'),
      RES('a_subm2', 'a_mkt2', 'submission_id'),
      submit('a_price3', 'manager', 'a_price', 'p3'),
      RES('a_subp3', 'a_price3', 'submission_id'),
      decide('a_ok_p', 'owner', 'a_subp3', `'approve'`),
      // Marketing sent back to the price step it does not wait for: the
      // price reopens, and marketing reopens at once.
      decide('a_back_price', 'owner', 'a_subm2', `'send_back', 'Wait for the new price', {{a_price}}`),
      STEPS_Q('a_steps3', 'a_run'),
      submit('a_mkt3', 'mk', 'a_mkt', 'm3', 'a_pm'),
      Q('a_pm_used', `select to_jsonb(used_by) from staff_media_uploads where path = {{a_pm}}`),

      // B: the same run with marketing (3) below the price (4).
      KEEP('tpl_rel', `select id::text from protocol_templates where venue_id = {{venue}} and kind = 'product_release'`),
      KEEP('v_rel', `select version::text from protocol_templates where id = {{tpl_rel}}`),
      T('b_save', 'owner', `select app.save_protocol_template({{tpl_rel}}, @@v_rel@@, 'New item', 'صنف جديد',
                              '${JSON.stringify([rel[0], rel[1], rel[3], rel[2], rel[4]])}'::jsonb)`),
      T('b_start', 'hc', `select app.start_protocol('product_release', null, 'Order B', null, '{}', '{"note":"x"}')`),
      RES('b_run', 'b_start', 'run_id'),
      RES('b_sub1', 'b_start', 'submission_id'),
      STEPK('b_test', 'b_run', 'test'),
      STEPK('b_price', 'b_run', 'analysis'),
      STEPK('b_mkt', 'b_run', 'marketing'),
      decide('b_ok1', 'manager', 'b_sub1', `'approve'`),
      T('b_slot_t', 'hc', `select app.staff_media_slot({{venue}}, 'tests', 'jpg')`),
      RES('b_pt', 'b_slot_t', 'path'),
      submit('b_test1', 'hc', 'b_test', 't1', 'b_pt'),
      RES('b_subt1', 'b_test1', 'submission_id'),
      decide('b_ok2', 'manager', 'b_subt1', `'approve'`),
      submit('b_mkt1', 'mk', 'b_mkt', 'm1'),
      RES('b_subm1', 'b_mkt1', 'submission_id'),
      decide('b_ok_m', 'owner', 'b_subm1', `'approve'`),
      submit('b_price1', 'manager', 'b_price', 'p1'),
      RES('b_subp1', 'b_price1', 'submission_id'),
      decide('b_back_self', 'owner', 'b_subp1', `'send_back', 'Too high'`),
      STEPS_Q('b_steps1', 'b_run'),
    ]);

    const byKey = (label: string) =>
      Object.fromEntries(ok<StepState[]>(r, label).map((s) => [s.key, `${s.status}:${s.round}`]));
    for (const label of ['a_ok1', 'a_test1', 'a_ok2', 'a_mkt1', 'a_ok_m', 'a_price1']) ok(r, label);
    expect(ok<Moved>(r, 'a_back_self')).toMatchObject({ step_status: 'open', opened_step_ids: [] });
    expect(byKey('a_steps1')).toEqual({
      propose: 'passed:1', test: 'passed:1', analysis: 'open:2', marketing: 'passed:1', launch: 'waiting:1',
    });
    ok(r, 'a_price2');
    expect(ok<Moved>(r, 'a_back_test').step_status).toBe('waiting');
    expect(byKey('a_steps2')).toEqual({
      propose: 'passed:1', test: 'open:2', analysis: 'waiting:3', marketing: 'waiting:2', launch: 'waiting:1',
    });
    // The approved round-1 photos go again (§2.3 re-claim across rounds).
    ok(r, 'a_test2');
    expect(ok<Moved>(r, 'a_ok3').opened_step_ids).toHaveLength(2);
    ok(r, 'a_mkt2');
    expect(ok<Moved>(r, 'a_ok_p').opened_step_ids).toEqual([]);
    const backPrice = ok<Moved>(r, 'a_back_price');
    expect(backPrice.step_status).toBe('open');
    expect(backPrice.opened_step_ids).toEqual([ok<string>(r, 'a_mkt_id')]);
    expect(byKey('a_steps3')).toEqual({
      propose: 'passed:1', test: 'passed:2', analysis: 'open:4', marketing: 'open:3', launch: 'waiting:1',
    });
    expect(ok<string>(r, 'a_pm_used')).toBe(`protocol_submission:${ok<Moved>(r, 'a_mkt3').submission_id}`);

    // The swapped order undoes the same: marketing keeps its approval.
    ok(r, 'b_save');
    for (const label of ['b_ok1', 'b_test1', 'b_ok2', 'b_mkt1', 'b_ok_m', 'b_price1', 'b_back_self']) ok(r, label);
    expect(ok<StepState[]>(r, 'b_steps1').map((s) => s.key)).toEqual(['propose', 'test', 'marketing', 'analysis', 'launch']);
    expect(byKey('b_steps1')).toEqual(byKey('a_steps1'));
  });

  it('photos follow the run: storage shows a photo to exactly those the engine shows it to', () => {
    // What a signed URL or a listing sees: storage.objects under the
    // staff_media_read policy, as the caller. Objects are written as postgres
    // (the upload itself is staff-media.test.ts's).
    const SEE = (label: string, who: string, path: string) =>
      T(label, who, `select to_jsonb(exists (select 1 from storage.objects
                                              where bucket_id = 'staff-media' and name = {{${path}}}))`);
    const OBJ = (path: string, who: string) =>
      Q(`obj_${path}`, `insert into storage.objects (bucket_id, name, owner, owner_id)
                        values ('staff-media', {{${path}}}, {{${who}}}::uuid, {{${who}}}) returning to_jsonb(true)`);
    const VIS = (label: string, who: string, path: string) =>
      T(label, who, `select to_jsonb(app.staff_media_visible({{${path}}}))`);
    // claim_staff_media is internal: run as postgres with the uploader's claims.
    const CLAIM = (path: string, who: string, folder: string, kind: string) => [
      Q(`as_${path}`, `select to_jsonb(set_config('request.jwt.claims',
                         jsonb_build_object('sub', {{${who}}}, 'role', 'authenticated')::text, true))`),
      Q(`claim_${path}`, `select to_jsonb(app.claim_staff_media(array[{{${path}}}], {{venue}}::uuid,
                                                                array['${folder}'], '${kind}:' || gen_random_uuid())::text)`),
    ];
    const SLOT = (label: string, who: string, folder: string, name: string) => [
      T(label, who, `select app.staff_media_slot({{venue}}, '${folder}', 'jpg')`),
      RES(name, label, 'path'),
    ];
    const WHO = ['hc', 'hb', 'mk', 'mk2', 'chef', 'drv', 'cashier', 'manager', 'owner'] as const;
    const r = scenario([
      MK('hc', 'head_chef'),
      MK('hb', 'head_barista'),
      MK('mk', 'marketing'),
      MK('mk2', 'marketing'),
      MK('chef', 'chef'),
      MK('drv', 'driver'),
      HOOK.start('product_release'),
      HOOK.start('hiring'),

      // A release at its test: a 'run' step, so everyone involved sees it.
      T('start', 'hc', `select app.start_protocol('product_release', null, 'Photo item', null, '{}', '{"note":"x"}')`),
      RES('run', 'start', 'run_id'),
      RES('sub1', 'start', 'submission_id'),
      STEP('s2', 'run', 2),
      T('ok1', 'manager', `select app.decide_step({{sub1}}, 'approve')`),
      ...SLOT('slot_test', 'hc', 'tests', 'p_test'),
      T('test', 'hc', `select app.submit_step({{s2}}, '{"note":"t"}', array[{{p_test}}])`),
      OBJ('p_test', 'hc'),
      ...WHO.map((w) => SEE(`see_test_${w}`, w, 'p_test')),

      // A hiring run: the owner's own step for the driver is a 'mgmt' step,
      // like every hiring step. The owner sends its photo.
      T('h_start', 'manager', `select app.start_protocol('hiring', null, 'Driver for October', null, '{}', '{}')`),
      RES('h_run', 'h_start', 'run_id'),
      RES('h_sub1', 'h_start', 'submission_id'),
      STEP('h1', 'h_run', 1),
      T('h_add', 'owner', `select app.add_run_step({{h_run}}, {{h1}},
                             '{"name_en":"ID check","name_ar":"التحقق من الهوية","actor_roles":["driver"]}')`),
      RES('h_own', 'h_add', 'id'),
      T('h_ok1', 'owner', `select app.decide_step({{h_sub1}}, 'approve')`),
      ...SLOT('slot_hire', 'owner', 'steps', 'p_hire'),
      T('h_own_send', 'owner', `select app.submit_step({{h_own}}, '{"note":"seen"}', array[{{p_hire}}])`),
      OBJ('p_hire', 'owner'),
      T('h_drv_step', 'drv', `select app.protocol_step_detail({{h_own}})`),
      ...(['owner', 'manager', 'drv', 'hb'] as const).map((w) => SEE(`see_hire_${w}`, w, 'p_hire')),

      // A marketing note's photo, a receipt, a campaign draft's image, and a
      // slot nothing has claimed.
      ...SLOT('slot_note', 'mk', 'marketing', 'p_note'),
      ...CLAIM('p_note', 'mk', 'marketing', 'marketing_note'),
      ...SLOT('slot_rcpt', 'drv', 'receipts', 'p_rcpt'),
      ...CLAIM('p_rcpt', 'drv', 'receipts', 'purchase'),
      ...SLOT('slot_camp', 'mk', 'campaigns', 'p_camp'),
      ...CLAIM('p_camp', 'mk', 'campaigns', 'marketing_campaign'),
      ...SLOT('slot_un', 'chef', 'proposals', 'p_un'),
      ...(['p_note', 'p_rcpt', 'p_camp', 'p_un'] as const).flatMap((p) =>
        WHO.map((w) => VIS(`vis_${p}_${w}`, w, p))),
      T('vis_menu', 'manager', `select to_jsonb(app.staff_media_visible('items/x/y.jpg'))`),
    ]);

    const sees = (prefix: string, whos: readonly string[]) =>
      Object.fromEntries(whos.map((w) => [w, ok<boolean>(r, `${prefix}_${w}`)]));
    ok(r, 'test');
    // Involved in the release: the proposer, the other head (propose's
    // actor), marketing (its step's actor). Not the chef or the driver.
    expect(sees('see_test', WHO)).toEqual({
      hc: true, hb: true, mk: true, mk2: true, chef: false, drv: false, cashier: false, manager: true, owner: true,
    });

    ok(r, 'h_add');
    expect(ok<Moved>(r, 'h_own_send').auto).toBe(true);
    // The driver is involved (an actor of the owner's step) and the engine
    // hides the photo from them; storage does too.
    const drvStep = ok<{ step: StepRow }>(r, 'h_drv_step');
    expect(drvStep.step.submissions[0]!.photos).toEqual([]);
    expect(sees('see_hire', ['owner', 'manager', 'drv', 'hb'])).toEqual({
      owner: true, manager: true, drv: false, hb: false,
    });

    for (const p of ['p_note', 'p_rcpt', 'p_camp']) ok(r, `claim_${p}`);
    expect(sees('vis_p_note', WHO)).toEqual({
      hc: false, hb: false, mk: true, mk2: true, chef: false, drv: false, cashier: false, manager: true, owner: true,
    });
    expect(sees('vis_p_rcpt', WHO)).toEqual({
      hc: false, hb: false, mk: false, mk2: false, chef: false, drv: true, cashier: false, manager: true, owner: true,
    });
    expect(sees('vis_p_camp', WHO)).toEqual({
      hc: false, hb: false, mk: true, mk2: false, chef: false, drv: false, cashier: false, manager: true, owner: true,
    });
    expect(sees('vis_p_un', WHO)).toEqual({
      hc: false, hb: false, mk: false, mk2: false, chef: true, drv: false, cashier: false, manager: true, owner: true,
    });
    expect(ok<boolean>(r, 'vis_menu')).toBe(false);
  });

  it('a tournament: skip, a scheduled finish, cancel_schedule, stop_protocol and a stop decision', () => {
    const r = scenario([
      MK('mk', 'marketing'),
      HOOK.start('tournament'),
      HOOK.pass('tournament', 'ready',
        `update protocol_runs set scheduled_for = now() + interval '1 day'
          where id = (select run_id from protocol_run_steps where id = p_step);`),
      HOOK.finish('tournament', 'scheduled'),
      HOOK.stop('tournament'),

      T('start', 'manager', `select app.start_protocol('tournament', 'type1', 'Summer cup', null, '{}', '{"note":"plan"}')`),
      RES('run', 'start', 'run_id'),
      STEP('s2', 'run', 2),
      STEP('s3', 'run', 3),
      STEP('s4', 'run', 4),
      STEP('s5', 'run', 5),
      STEP('s1', 'run', 1),
      STEPS_Q('steps_start', 'run'),
      T('feas', 'manager', `select app.submit_step({{s2}}, '{"note":"it works"}')`),
      RES('sub2', 'feas', 'submission_id'),
      T('feas_ok', 'owner', `select app.decide_step({{sub2}}, 'approve')`),

      T('skip_desk', 'desk', `select app.skip_step({{s3}}, 'no')`),
      T('skip_noreason', 'manager', `select app.skip_step({{s3}}, '  ')`),
      T('skip_courts', 'manager', `select app.skip_step({{s4}}, 'x')`),
      T('skip_marketing', 'manager', `select app.skip_step({{s3}}, 'No campaign this time')`),
      T('skip_again', 'manager', `select app.skip_step({{s3}}, 'again')`),
      T('mk_step3', 'mk', `select app.protocol_step_detail({{s3}})`),

      T('courts', 'desk', `select app.submit_step({{s4}}, '{"note":"blocked"}')`),
      RES('sub4', 'courts', 'submission_id'),
      T('desk_decides', 'desk', `select app.decide_step({{sub4}}, 'approve')`),
      T('courts_ok', 'manager', `select app.decide_step({{sub4}}, 'approve')`),
      T('desk_plan', 'desk', `select app.protocol_step_detail({{s1}})`),
      T('desk_run', 'desk', `select app.protocol_run_detail({{run}})`),

      T('ready', 'manager', `select app.submit_step({{s5}}, '{"note":"all set"}')`),
      Q('scheduled', `select jsonb_build_object('status', status, 'scheduled_for', scheduled_for is not null)
                        from protocol_runs where id = {{run}}`),
      T('mgr_run', 'manager', `select app.protocol_run_detail({{run}})`),
      T('desk_cancel', 'desk', `select app.cancel_schedule({{run}})`),
      T('cancel', 'manager', `select app.cancel_schedule({{run}})`),
      STEPS_Q('steps_cancelled', 'run'),
      T('cancel_again', 'manager', `select app.cancel_schedule({{run}})`),

      T('desk_stop', 'desk', `select app.stop_protocol({{run}}, 'x')`),
      T('stop_noreason', 'manager', `select app.stop_protocol({{run}}, '')`),
      T('stop', 'manager', `select app.stop_protocol({{run}}, 'Rained off')`),
      T('stop_again', 'manager', `select app.stop_protocol({{run}}, 'again')`),
      T('submit_closed', 'owner', `select app.submit_step({{s5}}, '{}')`),
      Q('stopped', `select jsonb_build_object('status', status, 'reason', stop_reason, 'finished', finished_at is not null)
                      from protocol_runs where id = {{run}}`),
      OUTBOX_Q('pushes', 'run'),

      // A stop decision on a type 2 (no feasibility; every OK off).
      T('start2', 'manager', `select app.start_protocol('tournament', 'type2', 'Friday social', null, '{}', '{}')`),
      RES('run2', 'start2', 'run_id'),
      STEPS_Q('steps2', 'run2'),
      STEP('t3', 'run2', 3),
      T('courts2', 'desk', `select app.submit_step({{t3}}, '{}')`),
      RES('sub_t3', 'courts2', 'submission_id'),
      T('stop_nonote', 'manager', `select app.decide_step({{sub_t3}}, 'stop')`),
      T('stop_decision', 'manager', `select app.decide_step({{sub_t3}}, 'stop', 'Venue closed that day')`),
      Q('stopped2', `select jsonb_build_object('run', status, 'reason', stop_reason) from protocol_runs where id = {{run2}}`),
      OUTBOX_Q('pushes2', 'run2'),
      HOOKS_Q,
    ]);

    expect(ok<Moved>(r, 'start').auto).toBe(true);
    expect(ok<StepState[]>(r, 'steps_start').map((s) => [s.key, s.status, s.ok])).toEqual([
      ['plan', 'passed', false], ['feasibility', 'open', true], ['marketing', 'waiting', false],
      ['courts', 'waiting', false], ['ready', 'waiting', false],
    ]);
    expect(ok<Moved>(r, 'feas').auto).toBe(false);
    expect(ok<Moved>(r, 'feas_ok').opened_step_ids).toHaveLength(2);

    expect(refused(r, 'skip_desk')).toBe('NOT_DECIDER');
    expect(refused(r, 'skip_noreason')).toBe('REASON_REQUIRED');
    expect(refused(r, 'skip_courts')).toBe('STEP_NOT_OPTIONAL');
    expect(ok<Moved>(r, 'skip_marketing')).toMatchObject({ step_status: 'skipped', opened_step_ids: [] });
    expect(refused(r, 'skip_again')).toBe('STEP_CLOSED');
    const mkStep3 = ok<{ step: { skip_note: string; skipped_by_name: string } }>(r, 'mk_step3');
    expect(mkStep3.step.skip_note).toBe('No campaign this time');

    expect(ok<Moved>(r, 'courts').auto).toBe(false);
    expect(refused(r, 'desk_decides')).toBe('NOT_DECIDER');
    // Courts passed and marketing skipped: the terminal step opens.
    expect(ok<Moved>(r, 'courts_ok').opened_step_ids).toHaveLength(1);
    // The court desk is involved but reads no plan (a mgmt record) and no data.
    const deskPlan = ok<{ step: StepRow; run: { data: unknown } }>(r, 'desk_plan');
    expect(deskPlan.step.submissions[0]!.record).toBeNull();
    expect(deskPlan.run.data).toBeNull();
    expect(ok<RunDetail>(r, 'desk_run').can.stop).toBe(false);

    expect(ok<Moved>(r, 'ready')).toMatchObject({ auto: true, run_status: 'scheduled' });
    expect(ok<Record<string, unknown>>(r, 'scheduled')).toEqual({ status: 'scheduled', scheduled_for: true });
    const mgrRun = ok<RunDetail>(r, 'mgr_run');
    expect(mgrRun.can.cancel_schedule).toBe(true);
    expect(mgrRun.can.stop).toBe(true);
    expect(refused(r, 'desk_cancel')).toBe('NOT_STEP_ACTOR');
    expect(ok<{ run_status: string; reopened_step_id: string }>(r, 'cancel').run_status).toBe('active');
    expect(ok<StepState[]>(r, 'steps_cancelled')[4]).toMatchObject({ key: 'ready', status: 'open', round: 2 });
    expect(refused(r, 'cancel_again')).toBe('INVALID_TRANSITION');

    expect(refused(r, 'desk_stop')).toBe('FORBIDDEN');
    expect(refused(r, 'stop_noreason')).toBe('REASON_REQUIRED');
    expect(ok<{ run_status: string }>(r, 'stop').run_status).toBe('stopped');
    expect(refused(r, 'stop_again')).toBe('PROTOCOL_CLOSED');
    expect(refused(r, 'submit_closed')).toBe('PROTOCOL_CLOSED');
    expect(ok<Record<string, unknown>>(r, 'stopped')).toEqual({ status: 'stopped', reason: 'Rained off', finished: true });
    const pushes = ok<Push[]>(r, 'pushes');
    const runId = ok<{ run_id: string }>(r, 'start').run_id;
    const stopped = pushes.filter((p) => p.payload.title_key === 'run_stopped');
    expect(stopped.every((p) => p.payload.route === 'staff-run' && p.payload.id === runId)).toBe(true);
    // The ready step was open: the other manager hears; the caller does not.
    expect(stopped.map((p) => p.to)).toContain(SEED_STAFF_IDS.manager_b);
    expect(stopped.map((p) => p.to)).not.toContain(SEED_STAFF_IDS.manager);
    // The court desk heard its step open, the marketing user theirs.
    expect(pushes.some((p) => p.payload.title_key === 'step_open' && p.to === SEED_STAFF_IDS.court_desk)).toBe(true);

    expect(ok<StepState[]>(r, 'steps2').map((s) => [s.key, s.status])).toEqual([
      ['plan', 'passed'], ['marketing', 'open'], ['courts', 'open'], ['ready', 'waiting'],
    ]);
    expect(refused(r, 'stop_nonote')).toBe('REASON_REQUIRED');
    expect(ok<Moved>(r, 'stop_decision')).toMatchObject({ step_status: 'stopped', run_status: 'stopped' });
    expect(ok<Record<string, unknown>>(r, 'stopped2')).toEqual({ run: 'stopped', reason: 'Venue closed that day' });
    expect(ok<Push[]>(r, 'pushes2').some((p) => p.payload.title_key === 'step_stopped' && p.to === SEED_STAFF_IDS.court_desk)).toBe(true);
    expect(ok<Array<{ hook: string }>>(r, 'hooks').filter((h) => h.hook === 'stop_tournament')).toHaveLength(2);
  });

  it('How it works: dependencies, the fixed steps and OK, and a snapshot that takes the fixed OK from the def', () => {
    const tplSave = (who: string, label: string, tpl: string, steps: unknown, version = '@@v_rel@@') =>
      T(label, who, `select app.save_protocol_template({{${tpl}}}, ${version}, 'New item', 'صنف جديد',
                       '${JSON.stringify(steps)}'::jsonb)`);
    const rel = RELEASE_STEPS;
    const own = { step_key: null, name_en: 'Taste panel', name_ar: 'لجنة التذوق', actor_roles: ['chef', 'barista'],
                  needs_owner_ok: false, optional: true, items: [{ text_en: 'Three tasters', text_ar: 'ثلاثة متذوقين' }] };
    const withStep = (i: number, patch: Record<string, unknown>) => rel.map((s, j) => (j === i ? { ...s, ...patch } : s));
    const r = scenario([
      MK('hc', 'head_chef'),
      MK('chef', 'chef'),
      HOOK.start('product_release'),
      HOOK.start('price_promo'),
      KEEP('tpl_rel', `select id::text from protocol_templates where venue_id = {{venue}} and kind = 'product_release'`),
      KEEP('v_rel', `select version::text from protocol_templates where id = {{tpl_rel}}`),
      KEEP('tpl_pp', `select id::text from protocol_templates where venue_id = {{venue}} and kind = 'price_promo'`),
      KEEP('v_pp', `select version::text from protocol_templates where id = {{tpl_pp}}`),
      KEEP('tpl_hire', `select id::text from protocol_templates where venue_id = {{venue}} and kind = 'hiring'`),
      KEEP('v_hire', `select version::text from protocol_templates where id = {{tpl_hire}}`),
      KEEP('tpl_t1', `select id::text from protocol_templates where venue_id = {{venue}} and kind = 'tournament' and variant = 'type1'`),
      KEEP('v_t1', `select version::text from protocol_templates where id = {{tpl_t1}}`),

      T('detail_mgr', 'manager', `select app.protocol_template_detail({{tpl_rel}})`),
      T('detail_cashier', 'cashier', `select app.protocol_template_detail({{tpl_rel}})`),
      tplSave('manager', 'save_mgr', 'tpl_rel', rel),
      tplSave('owner', 'stale', 'tpl_rel', rel, '@@v_rel@@ - 1'),
      T('noname', 'owner', `select app.save_protocol_template({{tpl_rel}}, @@v_rel@@, 'New item', ' ', '[]'::jsonb)`),
      tplSave('owner', 'analysis_off', 'tpl_rel', withStep(2, { needs_owner_ok: false })),
      tplSave('owner', 'launch_on', 'tpl_rel', withStep(4, { needs_owner_ok: true })),
      tplSave('owner', 'missing', 'tpl_rel', rel.filter((s) => s.step_key !== 'marketing')),
      tplSave('owner', 'unknown', 'tpl_rel', [...rel.slice(0, 4), { ...own, step_key: 'bogus' }, rel[4]]),
      tplSave('owner', 'duplicate', 'tpl_rel', [...rel.slice(0, 2), rel[1], ...rel.slice(2)]),
      tplSave('owner', 'actors', 'tpl_rel', withStep(1, { actor_roles: ['chef'] })),
      tplSave('owner', 'optional', 'tpl_rel', withStep(3, { optional: true })),
      tplSave('owner', 'first', 'tpl_rel', [own, ...rel]),
      tplSave('owner', 'last', 'tpl_rel', [...rel, own]),
      tplSave('owner', 'dep', 'tpl_rel', [rel[0], rel[3], rel[1], rel[2], rel[4]]),
      tplSave('owner', 'role_owner', 'tpl_rel', [...rel.slice(0, 2), { ...own, actor_roles: ['owner'] }, ...rel.slice(2)]),
      tplSave('owner', 'role_prep', 'tpl_rel', [...rel.slice(0, 2), { ...own, actor_roles: ['prep'] }, ...rel.slice(2)]),
      tplSave('owner', 'role_empty', 'tpl_rel', [...rel.slice(0, 2), { ...own, actor_roles: [] }, ...rel.slice(2)]),
      tplSave('owner', 'too_many_steps', 'tpl_rel',
        [...rel.slice(0, 4), ...Array.from({ length: 16 }, (_, i) => ({ ...own, name_en: `Extra ${i}` })), rel[4]]),
      tplSave('owner', 'too_many_items', 'tpl_rel',
        withStep(1, { items: Array.from({ length: 13 }, (_, i) => ({ text_en: `Line ${i}`, text_ar: `سطر ${i}` })) })),
      tplSave('owner', 'item_one_lang', 'tpl_rel', withStep(1, { items: [{ text_en: 'Only English', text_ar: '' }] })),
      tplSave('owner', 'step_one_lang', 'tpl_rel', withStep(2, { name_ar: '' })),
      T('pp_numbers_off', 'owner', `select app.save_protocol_template({{tpl_pp}}, @@v_pp@@, 'Price or promo change',
        'تغيير سعر أو عرض', '${JSON.stringify(PRICE_PROMO_STEPS.map((s) => (s.step_key === 'numbers' ? { ...s, needs_owner_ok: false } : s)))}'::jsonb)`),
      T('hire_add_staff_on', 'owner', `select app.save_protocol_template({{tpl_hire}}, @@v_hire@@, 'Hiring', 'توظيف',
        '${JSON.stringify(HIRING_STEPS.map((s) => (s.step_key === 'add_staff' ? { ...s, needs_owner_ok: true } : s)))}'::jsonb)`),
      // Allowed: marketing and courts swap, and feasibility's OK is the owner's to flip.
      T('t1_swap', 'owner', `select app.save_protocol_template({{tpl_t1}}, @@v_t1@@, 'Tournament, type 1', 'بطولة، النوع 1',
        '${JSON.stringify([T1_STEPS[0], { ...T1_STEPS[1], needs_owner_ok: false }, T1_STEPS[3], T1_STEPS[2], T1_STEPS[4]])}'::jsonb)`),

      // A rename and a checklist on the fixed-OK price step, an owner step,
      // and the price and marketing steps swapped.
      tplSave('owner', 'save_ok', 'tpl_rel', [
        rel[0], rel[1], own, rel[3],
        { ...rel[2], name_en: 'Pricing', name_ar: 'التسعير النهائي',
          items: [{ text_en: 'Check the cost', text_ar: 'راجع الكلفة' }, { text_en: 'Compare', text_ar: 'قارن' }] },
        rel[4],
      ]),
      tplSave('owner', 'stale_after', 'tpl_rel', rel),
      T('detail_after', 'owner', `select app.protocol_template_detail({{tpl_rel}})`),
      Q('audit_tpl', `select jsonb_agg(action order by id) from audit_log where entity_id = {{tpl_rel}}::text`),

      // A new run snapshots the saved template; the owner step waits for the
      // steps below it, and the built-in steps above wait for it.
      T('start', 'hc', `select app.start_protocol('product_release', null, 'Snapshot item', null, '{}', '{"note":"x"}')`),
      RES('run', 'start', 'run_id'),
      Q('snap', `select jsonb_build_object(
                   'version', (select template_version from protocol_runs where id = {{run}}),
                   'steps', (select jsonb_agg(jsonb_build_object('key', s.step_key, 'name', s.name_en, 'ok', s.needs_owner_ok,
                                                'optional', s.optional, 'actors', s.actor_roles,
                                                'items', (select count(*) from protocol_run_items i where i.run_step_id = s.id))
                                              order by s.position)
                               from protocol_run_steps s where s.run_id = {{run}}))`),
      RES('sub1', 'start', 'submission_id'),
      STEP('s2', 'run', 2),
      STEP('s3', 'run', 3),
      T('approve1', 'manager', `select app.decide_step({{sub1}}, 'approve')`),
      T('slot', 'hc', `select app.staff_media_slot({{venue}}, 'tests', 'webp')`),
      RES('p1', 'slot', 'path'),
      T('test', 'hc', `select app.submit_step({{s2}}, '{}', array[{{p1}}])`),
      RES('sub2', 'test', 'submission_id'),
      T('approve2', 'manager', `select app.decide_step({{sub2}}, 'approve')`),
      T('panel', 'chef', `select app.submit_step({{s3}}, '{"note":"Too sweet for two of three"}')`),
      RES('sub3', 'panel', 'submission_id'),
      T('approve3', 'manager', `select app.decide_step({{sub3}}, 'approve')`),

      // A template row written around save_protocol_template cannot switch the
      // owner's OK off the price steps: the run takes it from the def (#58).
      Q('bypass', `update protocol_template_steps set needs_owner_ok = false
                    where step_key in ('analysis', 'numbers')
                      and template_id in ({{tpl_rel}}, {{tpl_pp}}) returning to_jsonb(true)`),
      T('mgr_rel', 'manager', `select app.start_protocol('product_release', null, 'Bypass item', null, '{}', '{"note":"x"}')`),
      RES('run_b', 'mgr_rel', 'run_id'),
      T('mgr_pp', 'manager', `select app.start_protocol('price_promo', null, 'Bypass price', null, '{}', '{"note":"x"}')`),
      RES('run_p', 'mgr_pp', 'run_id'),
      Q('fixed_ok', `select jsonb_object_agg(s.step_key, s.needs_owner_ok) from protocol_run_steps s
                      where s.run_id in ({{run_b}}, {{run_p}}) and s.step_key in ('analysis', 'numbers')`),
      STEP('pn', 'run_p', 2),
      T('numbers', 'manager', `select app.submit_step({{pn}}, '{"note":"go"}')`),
      T('owner_work', 'owner', `select app.my_protocol_work(null)`),
    ]);

    const detail = ok<{ steps: Array<{ step_key: string | null }>; defs: Array<{ step_key: string }> }>(r, 'detail_mgr');
    expect(detail.defs.map((d) => d.step_key)).toEqual(['propose', 'test', 'analysis', 'marketing', 'launch']);
    expect(refused(r, 'detail_cashier')).toBe('FORBIDDEN');
    expect(refused(r, 'save_mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'stale')).toBe('TEMPLATE_CHANGED');
    expect(refused(r, 'noname')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:name');
    expect(refused(r, 'analysis_off')).toBe('PROTOCOL_STEP_FIXED:needs_owner_ok');
    expect(refused(r, 'launch_on')).toBe('PROTOCOL_STEP_FIXED:needs_owner_ok');
    expect(refused(r, 'missing')).toBe('PROTOCOL_STEP_FIXED:step_key');
    expect(refused(r, 'unknown')).toBe('PROTOCOL_STEP_FIXED:step_key');
    expect(refused(r, 'duplicate')).toBe('PROTOCOL_STEP_FIXED:step_key');
    expect(refused(r, 'actors')).toBe('PROTOCOL_STEP_FIXED:actor_roles');
    expect(refused(r, 'optional')).toBe('PROTOCOL_STEP_FIXED:optional');
    expect(refused(r, 'first')).toBe('PROTOCOL_ORDER_INVALID:propose');
    expect(refused(r, 'last')).toBe('PROTOCOL_ORDER_INVALID:launch');
    expect(refused(r, 'dep')).toBe('PROTOCOL_ORDER_INVALID:marketing');
    expect(refused(r, 'role_owner')).toBe('INVALID_ROLE:actor_roles');
    expect(refused(r, 'role_prep')).toBe('INVALID_ROLE:actor_roles');
    expect(refused(r, 'role_empty')).toBe('INVALID_ROLE:actor_roles');
    expect(refused(r, 'too_many_steps')).toBe('LIST_TOO_LONG:steps');
    expect(refused(r, 'too_many_items')).toBe('LIST_TOO_LONG:items');
    expect(refused(r, 'item_one_lang')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:items');
    expect(refused(r, 'step_one_lang')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:steps');
    expect(refused(r, 'pp_numbers_off')).toBe('PROTOCOL_STEP_FIXED:needs_owner_ok');
    expect(refused(r, 'hire_add_staff_on')).toBe('PROTOCOL_STEP_FIXED:needs_owner_ok');
    ok(r, 't1_swap');

    const saved = ok<{ template_id: string; version: number }>(r, 'save_ok');
    expect(refused(r, 'stale_after')).toBe('TEMPLATE_CHANGED');
    const after = ok<{
      template: { version: number; updated_by_name: string };
      steps: Array<{ step_key: string | null; name_en: string; needs_owner_ok: boolean; items: unknown[] }>;
    }>(r, 'detail_after');
    expect(after.template.version).toBe(saved.version);
    expect(after.steps.map((s) => s.step_key)).toEqual(['propose', 'test', null, 'marketing', 'analysis', 'launch']);
    expect(after.steps[4]).toMatchObject({ name_en: 'Pricing', needs_owner_ok: true });
    expect(after.steps[4]!.items).toHaveLength(2);
    expect(ok<string[]>(r, 'audit_tpl')).toEqual(['protocol.template.save']);

    const snap = ok<{ version: number; steps: Array<Record<string, unknown>> }>(r, 'snap');
    expect(snap.version).toBe(saved.version);
    expect(snap.steps.map((s) => [s.key, s.name, s.items])).toEqual([
      ['propose', 'Proposal', 0], ['test', 'Test', 0], [null, 'Taste panel', 1],
      ['marketing', 'Marketing', 0], ['analysis', 'Pricing', 2], ['launch', 'Launch', 0],
    ]);
    expect(snap.steps[2]).toMatchObject({ optional: true, ok: false, actors: ['chef', 'barista'] });
    // Test opens alone; the owner step waits for the test; marketing and the
    // price step wait for the owner step below them.
    expect(ok<Moved>(r, 'approve1').opened_step_ids).toHaveLength(1);
    expect(ok<Moved>(r, 'approve2').opened_step_ids).toHaveLength(1);
    expect(ok<Moved>(r, 'panel').auto).toBe(false);
    expect(ok<Moved>(r, 'approve3').opened_step_ids).toHaveLength(2);

    expect(ok<Record<string, boolean>>(r, 'fixed_ok')).toEqual({ analysis: true, numbers: true });
    expect(ok<Moved>(r, 'numbers').auto).toBe(false);
    expect(ok<Work>(r, 'owner_work').to_decide.map((w) => w.needs_owner_ok)).toContain(true);
  });

  it('the owner’s per-run edits, ticks, and an owner-added step', () => {
    const r = scenario([
      MK('hc', 'head_chef'),
      MK('hb', 'head_barista'),
      MK('mk', 'marketing'),
      HOOK.start('product_release'),
      T('start', 'hc', `select app.start_protocol('product_release', null, 'Edited item', null, '{}', '{"note":"x"}')`),
      RES('run', 'start', 'run_id'),
      RES('sub1', 'start', 'submission_id'),
      STEP('s1', 'run', 1),
      STEP('s2', 'run', 2),
      STEP('s3', 'run', 3),
      STEP('s5', 'run', 5),
      T('approve1', 'manager', `select app.decide_step({{sub1}}, 'approve')`),

      T('edit_mgr', 'manager', `select app.edit_run_items({{s2}}, '[{"text_en":"a","text_ar":"أ"}]')`),
      T('edit', 'owner', `select app.edit_run_items({{s2}}, '[{"text_en":"Clean the jug","text_ar":"نظّف الإبريق"},
                                                            {"text_en":"Weigh it","text_ar":"زِنه"}]')`),
      RES('item1', 'edit', 'items,0,id'),
      RES('item2', 'edit', 'items,1,id'),
      T('tick_hb', 'hb', `select app.tick_run_item({{item1}}, true)`),
      T('tick', 'hc', `select app.tick_run_item({{item1}}, true)`),
      T('tick_again', 'hc', `select app.tick_run_item({{item1}}, true)`),
      T('edit_keep', 'owner', `select app.edit_run_items({{s2}},
                                 '[{"id":"@@item1@@","text_en":"Clean the jug well","text_ar":"نظّف الإبريق جيدًا"},
                                   {"id":null,"text_en":"Label it","text_ar":"ضع الملصق"}]')`),
      Q('items_after', `select jsonb_agg(jsonb_build_object('id', id, 'text', text_en, 'done', done_by is not null) order by position)
                          from protocol_run_items where run_step_id = {{s2}}`),
      T('edit_long', 'owner', `select app.edit_run_items({{s2}}, (select jsonb_agg(jsonb_build_object('text_en', 'x' || g, 'text_ar', 'س' || g))
                                                                   from generate_series(1, 13) g))`),
      T('edit_badid', 'owner', `select app.edit_run_items({{s2}}, '[{"id":"@@sub1@@","text_en":"x","text_ar":"س"}]')`),
      T('edit_closed', 'owner', `select app.edit_run_items({{s1}}, '[]')`),
      T('edit_waiting', 'owner', `select app.edit_run_items({{s3}}, '[{"text_en":"Cost it","text_ar":"احسب الكلفة"}]')`),
      RES('item3', 'edit_waiting', 'items,0,id'),
      T('tick_waiting', 'manager', `select app.tick_run_item({{item3}}, true)`),

      T('add_mgr', 'manager', `select app.add_run_step({{run}}, {{s2}}, '{"name_en":"x","name_ar":"س","actor_roles":["marketing"]}')`),
      T('add_after_last', 'owner', `select app.add_run_step({{run}}, {{s5}}, '{"name_en":"x","name_ar":"س","actor_roles":["marketing"]}')`),
      T('add_badrole', 'owner', `select app.add_run_step({{run}}, {{s2}}, '{"name_en":"x","name_ar":"س","actor_roles":["owner"]}')`),
      T('add_one_lang', 'owner', `select app.add_run_step({{run}}, {{s2}}, '{"name_en":"x","name_ar":"","actor_roles":["marketing"]}')`),
      // Below the open test: the test would not wait for it.
      T('add_below_open', 'owner', `select app.add_run_step({{run}}, {{s1}}, '{"name_en":"x","name_ar":"س","actor_roles":["marketing"]}')`),
      T('add', 'owner', `select app.add_run_step({{run}}, {{s2}}, '{"name_en":"Photo shoot","name_ar":"جلسة تصوير",
                           "actor_roles":["marketing"],"needs_owner_ok":false,"optional":false,
                           "items":[{"text_en":"Three angles","text_ar":"ثلاث زوايا"}]}')`),
      RES('own', 'add', 'id'),
      STEPS_Q('steps_added', 'run'),
      T('slot', 'hc', `select app.staff_media_slot({{venue}}, 'tests', 'jpg')`),
      RES('p1', 'slot', 'path'),
      T('test', 'hc', `select app.submit_step({{s2}}, '{"note":"done"}', array[{{p1}}])`),
      RES('sub2', 'test', 'submission_id'),
      T('approve2', 'manager', `select app.decide_step({{sub2}}, 'approve')`),

      T('own_badrec', 'mk', `select app.submit_step({{own}}, '{"x":1}')`),
      T('own_long', 'mk', `select app.submit_step({{own}}, jsonb_build_object('note', repeat('a', 2001)))`),
      T('slot_tests', 'mk', `select app.staff_media_slot({{venue}}, 'tests', 'jpg')`),
      RES('p_wrong', 'slot_tests', 'path'),
      T('own_wrong_folder', 'mk', `select app.submit_step({{own}}, '{"note":"x"}', array[{{p_wrong}}])`),
      T('slot_steps', 'mk', `select app.staff_media_slot({{venue}}, 'steps', 'jpg')`),
      RES('p_steps', 'slot_steps', 'path'),
      T('hc_steal', 'hc', `select app.submit_step({{own}}, '{"note":"x"}', array[{{p_steps}}])`),
      T('own_ok', 'mk', `select app.submit_step({{own}}, '{"note":"  Shot at noon  "}', array[{{p_steps}}, {{p_steps}}])`),
      Q('own_sub', `select jsonb_build_object('record', record, 'photos', photos) from protocol_submissions
                     where run_step_id = {{own}}`),
      RES('sub_own', 'own_ok', 'submission_id'),
      T('approve_own', 'manager', `select app.decide_step({{sub_own}}, 'approve')`),
      Q('audit', `select jsonb_agg(action order by id) from audit_log
                   where entity_id = {{run}}::text and action like 'protocol.run.%'`),

      // The price and marketing steps are open now: a step below them is
      // refused (the lowest step in the way is the passed owner step), one
      // right below the launch is not.
      T('add_late_low', 'owner', `select app.add_run_step({{run}}, {{s2}}, '{"name_en":"Allergen check",
                                    "name_ar":"فحص مسببات الحساسية","actor_roles":["head_chef"],"needs_owner_ok":true}')`),
      STEP('s_mk', 'run', 5),
      T('add_late_top', 'owner', `select app.add_run_step({{run}}, {{s_mk}}, '{"name_en":"Final tasting",
                                    "name_ar":"التذوق الأخير","actor_roles":["head_chef"]}')`),
      STEPS_Q('steps_late', 'run'),
    ]);

    expect(refused(r, 'edit_mgr')).toBe('FORBIDDEN');
    expect(ok<StepRow>(r, 'edit').items.map((i) => i.text_en)).toEqual(['Clean the jug', 'Weigh it']);
    expect(refused(r, 'tick_hb')).toBe('NOT_STEP_ACTOR');
    const tick = ok<{ done_by: string; done_at: string }>(r, 'tick');
    expect(tick.done_by).not.toBeNull();
    expect(ok<{ done_at: string }>(r, 'tick_again').done_at).toBe(tick.done_at);
    // The kept line keeps its tick; the one left out goes; the new one is open.
    const items = ok<Array<{ id: string; text: string; done: boolean }>>(r, 'items_after');
    expect(items.map((i) => [i.text, i.done])).toEqual([['Clean the jug well', true], ['Label it', false]]);
    expect(refused(r, 'edit_long')).toBe('LIST_TOO_LONG:items');
    expect(refused(r, 'edit_badid')).toBe('INVALID_ARGUMENT:items');
    expect(refused(r, 'edit_closed')).toBe('STEP_CLOSED');
    ok(r, 'edit_waiting');
    expect(refused(r, 'tick_waiting')).toBe('STEP_NOT_OPEN');

    expect(refused(r, 'add_mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'add_after_last')).toBe('PROTOCOL_ORDER_INVALID');
    expect(refused(r, 'add_badrole')).toBe('INVALID_ROLE:actor_roles');
    expect(refused(r, 'add_one_lang')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:name');
    expect(refused(r, 'add_below_open')).toBe(`PROTOCOL_ORDER_INVALID:${ok<StepRow>(r, 'edit').id}`);
    const added = ok<StepRow & { position: number }>(r, 'add');
    expect(added).toMatchObject({ step_key: null, status: 'waiting', position: 3 });
    expect(added.items).toHaveLength(1);
    expect(ok<StepState[]>(r, 'steps_added').map((s) => [s.key, s.status])).toEqual([
      ['propose', 'passed'], ['test', 'open'], [null, 'waiting'],
      ['analysis', 'waiting'], ['marketing', 'waiting'], ['launch', 'waiting'],
    ]);
    // After the test only the owner step opens; the built-in steps above wait for it.
    expect(ok<Moved>(r, 'approve2').opened_step_ids).toEqual([ok<StepRow>(r, 'add').id]);

    expect(refused(r, 'own_badrec')).toBe('RECORD_INVALID:x');
    expect(refused(r, 'own_long')).toBe('TEXT_TOO_LONG:note');
    expect(refused(r, 'own_wrong_folder')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'hc_steal')).toBe('NOT_STEP_ACTOR');
    expect(ok<Moved>(r, 'own_ok').auto).toBe(false);
    const ownSub = ok<{ record: unknown; photos: string[] }>(r, 'own_sub');
    expect(ownSub.record).toEqual({ note: 'Shot at noon' });
    expect(ownSub.photos).toHaveLength(1);
    expect(ok<Moved>(r, 'approve_own').opened_step_ids).toHaveLength(2);
    expect(ok<string[]>(r, 'audit')).toEqual([
      'protocol.run.edit_items', 'protocol.run.edit_items', 'protocol.run.edit_items', 'protocol.run.add_step',
    ]);

    expect(refused(r, 'add_late_low')).toBe(`PROTOCOL_ORDER_INVALID:${added.id}`);
    expect(ok<StepRow & { position: number }>(r, 'add_late_top')).toMatchObject({ status: 'waiting', position: 6 });
    expect(ok<StepState[]>(r, 'steps_late').map((s) => [s.key, s.status])).toEqual([
      ['propose', 'passed'], ['test', 'passed'], [null, 'passed'], ['analysis', 'open'],
      ['marketing', 'open'], [null, 'waiting'], ['launch', 'waiting'],
    ]);
  });

  it('the transition tables, the reason CHECKs at the table, and a kind with no start hook', () => {
    const states = `array['waiting','open','submitted','passed','skipped','stopped']`;
    const runStates = `array['active','scheduled','live','done','stopped','withdrawn']`;
    const r = scenario([
      Q('step_moves', `select jsonb_agg(f || '>' || t order by f, t)
                         from unnest(${states}) f, unnest(${states}) t where app.protocol_step_allowed(f, t)`),
      Q('run_moves', `select jsonb_agg(f || '>' || t order by f, t)
                        from unnest(${runStates}) f, unnest(${runStates}) t where app.protocol_run_allowed(f, t)`),
      T('not_ready', 'manager', `select app.start_protocol('hiring', null, 'Barista', null, '{}', '{}')`),
      T('not_ready_count', 'manager', `select to_jsonb(count(*)) from protocol_runs where title_en = 'Barista'`),
      HOOK.start('hiring'),
      T('start', 'manager', `select app.start_protocol('hiring', null, 'Barista', null, '{}', '{}')`),
      RES('run', 'start', 'run_id'),
      RES('sub', 'start', 'submission_id'),
      STEP('s2', 'run', 2),
      QE('stop_reason_null', `update protocol_runs set status = 'stopped', finished_at = now(), stop_reason = null where id = {{run}}`),
      QE('stop_reason_blank', `update protocol_runs set status = 'stopped', finished_at = now(), stop_reason = '  ' where id = {{run}}`),
      QE('finished_missing', `update protocol_runs set status = 'done' where id = {{run}}`),
      QE('title_blank', `update protocol_runs set title_en = ' ', title_ar = null where id = {{run}}`),
      QE('skip_note_null', `update protocol_run_steps set status = 'skipped', skipped_by = {{manager}}, skipped_at = now(),
                             skip_note = null where id = {{s2}}`),
      QE('send_back_note_null', `update protocol_submissions set decision = 'send_back', decided_by = {{owner}},
                                  decided_at = now(), decision_note = null where id = {{sub}}`),
      QE('stop_note_null', `update protocol_submissions set decision = 'stop', decided_by = {{owner}},
                             decided_at = now(), decision_note = null where id = {{sub}}`),
      QE('own_approve', `update protocol_submissions set decision = 'approve', decided_by = submitted_by,
                          decided_at = now() where id = {{sub}}`),
      QE('two_ends', `update protocol_submissions set withdrawn_at = now(), superseded_at = now() where id = {{sub}}`),
      QE('auto_ok', `update protocol_submissions set decision = 'auto', decided_by = submitted_by,
                      decided_at = now() where id = {{sub}}`),
    ]);

    expect(ok<string[]>(r, 'step_moves')).toEqual([
      'open>skipped', 'open>submitted', 'open>waiting',
      'passed>open', 'passed>waiting',
      'submitted>open', 'submitted>passed', 'submitted>stopped', 'submitted>waiting',
      'waiting>open', 'waiting>skipped',
    ]);
    expect(ok<string[]>(r, 'run_moves')).toEqual([
      'active>done', 'active>live', 'active>scheduled', 'active>stopped', 'active>withdrawn',
      'live>done',
      'scheduled>active', 'scheduled>done', 'scheduled>live', 'scheduled>stopped',
    ]);
    expect(refused(r, 'not_ready')).toBe('PROTOCOL_NOT_READY');
    expect(ok<number>(r, 'not_ready_count')).toBe(0);
    ok(r, 'start');
    const check = (label: string) => {
      const o = r[label]!;
      expect(o.ok, label).toBe(false);
      expect(o.state, label).toBe('23514');
      return o.constraint;
    };
    expect(check('stop_reason_null')).toBe('protocol_runs_stop_reason_chk');
    expect(check('stop_reason_blank')).toBe('protocol_runs_stop_reason_chk');
    expect(check('finished_missing')).toBe('protocol_runs_finished_chk');
    expect(check('title_blank')).toBe('protocol_runs_title_chk');
    expect(check('skip_note_null')).toBe('protocol_run_steps_skip_chk');
    expect(check('send_back_note_null')).toBe('protocol_submissions_reason_chk');
    expect(check('stop_note_null')).toBe('protocol_submissions_reason_chk');
    expect(check('own_approve')).toBe('protocol_submissions_decider_chk');
    expect(check('two_ends')).toBe('protocol_submissions_one_end_chk');
    expect(r.auto_ok!.ok).toBe(true);
  });

  it('a new venue gets the four kinds’ default templates from the defs, once', () => {
    const r = scenario([
      KEEP('v2', `insert into venues (id, slug, name_en, name_ar, timezone, is_active)
                  values (gen_random_uuid(), 'pe-seed-' || left(md5(random()::text), 8), 'PE seed', 'بذرة', 'Asia/Baghdad', false)
                  returning id::text`),
      Q('seed1', `select to_jsonb(app.protocol_seed_venue({{v2}}::uuid) is null)`),
      Q('seed2', `select to_jsonb(app.protocol_seed_venue({{v2}}::uuid) is null)`),
      Q('templates', `select jsonb_agg(jsonb_build_object('kind', t.kind, 'variant', t.variant, 'version', t.version,
                         'steps', (select jsonb_agg(jsonb_build_object('key', s.step_key, 'ok', s.needs_owner_ok,
                                                      'optional', s.optional, 'actors', s.actor_roles,
                                                      'items', (select count(*) from protocol_template_items i where i.step_id = s.id))
                                                    order by s.position)
                                    from protocol_template_steps s where s.template_id = t.id))
                       order by t.kind, t.variant)
                     from protocol_templates t where t.venue_id = {{v2}}`),
      Q('defs', `select jsonb_object_agg(k.kind || coalesce('/' || k.variant, ''), app.protocol_step_defs(k.kind, k.variant))
                   from (values ('product_release', null), ('tournament', 'type1'), ('tournament', 'type2'),
                                ('tournament', 'type3'), ('hiring', null), ('price_promo', null)) k(kind, variant)`),
      Q('defs_unknown', `select jsonb_build_array(app.protocol_step_defs('nope', null), app.protocol_step_defs('tournament', null),
                                                  app.protocol_step_defs('hiring', 'type1'))`),
    ]);

    type Def = {
      step_key: string; actor_roles: string[]; needs_owner_ok: boolean; ok_fixed: boolean; optional: boolean;
      after: string[]; fixed: string | null; photo_folder: string | null; photos_min: number; photos_max: number;
      record_visibility: string; assign_to_starter: boolean;
    };
    const defs = ok<Record<string, Def[]>>(r, 'defs');
    const keys = (k: string) => defs[k]!.map((d) => d.step_key);
    expect(keys('product_release')).toEqual(['propose', 'test', 'analysis', 'marketing', 'launch']);
    expect(keys('tournament/type1')).toEqual(['plan', 'feasibility', 'marketing', 'courts', 'ready']);
    expect(keys('tournament/type3')).toEqual(keys('tournament/type1'));
    expect(keys('tournament/type2')).toEqual(['plan', 'marketing', 'courts', 'ready']);
    expect(keys('hiring')).toEqual(['open_position', 'interviews', 'add_staff']);
    expect(keys('price_promo')).toEqual(['propose', 'numbers', 'announce', 'apply']);
    const all = Object.entries(defs).flatMap(([k, ds]) => ds.map((d) => ({ k, ...d })));
    // #58: the OK is fixed on the two price steps (on) and the two owner steps.
    expect(all.filter((d) => d.ok_fixed).map((d) => `${d.k}.${d.step_key}:${d.needs_owner_ok}`).sort()).toEqual([
      'hiring.add_staff:false', 'price_promo.numbers:true', 'product_release.analysis:true', 'product_release.launch:false',
    ]);
    // Type 2 has no owner OK anywhere (Q3).
    expect(defs['tournament/type2']!.every((d) => !d.needs_owner_ok)).toBe(true);
    expect(all.filter((d) => d.optional).map((d) => `${d.k}.${d.step_key}`).sort()).toEqual([
      'price_promo.announce', 'tournament/type1.marketing', 'tournament/type2.marketing', 'tournament/type3.marketing',
    ]);
    expect(all.filter((d) => d.record_visibility === 'mgmt').map((d) => `${d.k}.${d.step_key}`).sort()).toEqual([
      'hiring.add_staff', 'hiring.interviews', 'hiring.open_position', 'price_promo.numbers', 'product_release.analysis',
      'tournament/type1.feasibility', 'tournament/type1.plan', 'tournament/type2.plan',
      'tournament/type3.feasibility', 'tournament/type3.plan',
    ]);
    expect(defs.product_release!.find((d) => d.step_key === 'test')).toMatchObject({
      assign_to_starter: true, photo_folder: 'tests', photos_min: 1, photos_max: 6, after: ['propose'],
    });
    expect(defs.product_release!.find((d) => d.step_key === 'launch')).toMatchObject({
      actor_roles: ['owner'], after: ['analysis', 'marketing'], fixed: 'last',
    });
    for (const ds of Object.values(defs)) {
      expect(ds[0]!.fixed).toBe('first');
      expect(ds[ds.length - 1]!.fixed).toBe('last');
      expect(ds.slice(1, -1).every((d) => d.fixed === null)).toBe(true);
    }
    expect(ok<unknown[]>(r, 'defs_unknown')).toEqual([null, null, null]);

    const templates = ok<Array<{ kind: string; variant: string | null; version: number;
      steps: Array<{ key: string; ok: boolean; optional: boolean; actors: string[]; items: number }> }>>(r, 'templates');
    expect(templates.map((t) => `${t.kind}/${t.variant ?? ''}`)).toEqual([
      'hiring/', 'price_promo/', 'product_release/', 'tournament/type1', 'tournament/type2', 'tournament/type3',
    ]);
    for (const t of templates) {
      const d = defs[t.variant ? `${t.kind}/${t.variant}` : t.kind]!;
      expect(t.version).toBe(1);
      expect(t.steps.map((s) => [s.key, s.ok, s.optional, s.actors, s.items])).toEqual(
        d.map((x) => [x.step_key, x.needs_owner_ok, x.optional, x.actor_roles, 0]),
      );
    }
  });
});

// The default step lists as How it works sends them (§2.8).
const RELEASE_STEPS = [
  { step_key: 'propose', name_en: 'Proposal', name_ar: 'الاقتراح', needs_owner_ok: false, items: [] as unknown[] },
  { step_key: 'test', name_en: 'Test', name_ar: 'التجربة', needs_owner_ok: false, items: [] as unknown[] },
  { step_key: 'analysis', name_en: 'Price', name_ar: 'التسعير', needs_owner_ok: true, items: [] as unknown[] },
  { step_key: 'marketing', name_en: 'Marketing', name_ar: 'التسويق', needs_owner_ok: true, items: [] as unknown[] },
  { step_key: 'launch', name_en: 'Launch', name_ar: 'الإطلاق', needs_owner_ok: false, items: [] as unknown[] },
] as Array<Record<string, unknown>>;
const PRICE_PROMO_STEPS = [
  { step_key: 'propose', name_en: 'Proposal', name_ar: 'الاقتراح', needs_owner_ok: false },
  { step_key: 'numbers', name_en: 'Numbers', name_ar: 'الأرقام', needs_owner_ok: true },
  { step_key: 'announce', name_en: 'Announce', name_ar: 'الإعلان', needs_owner_ok: false },
  { step_key: 'apply', name_en: 'Apply', name_ar: 'التطبيق', needs_owner_ok: false },
] as Array<Record<string, unknown>>;
const HIRING_STEPS = [
  { step_key: 'open_position', name_en: 'Open position', name_ar: 'فتح الوظيفة', needs_owner_ok: true },
  { step_key: 'interviews', name_en: 'Interviews and pick', name_ar: 'المقابلات والاختيار', needs_owner_ok: true },
  { step_key: 'add_staff', name_en: 'Add staff', name_ar: 'إضافة الموظف', needs_owner_ok: false },
] as Array<Record<string, unknown>>;
const T1_STEPS = [
  { step_key: 'plan', name_en: 'Plan', name_ar: 'الخطة', needs_owner_ok: false },
  { step_key: 'feasibility', name_en: 'Feasibility', name_ar: 'دراسة الجدوى', needs_owner_ok: true },
  { step_key: 'marketing', name_en: 'Marketing', name_ar: 'التسويق', needs_owner_ok: false },
  { step_key: 'courts', name_en: 'Courts', name_ar: 'حجز الملاعب', needs_owner_ok: false },
  { step_key: 'ready', name_en: 'Ready', name_ar: 'الجاهزية', needs_owner_ok: false },
] as Array<Record<string, unknown>>;
