/**
 * hiring (build-contracts-2026-09-23 §2.12, §8.2): the hiring protocol's
 * candidates and their deletion.
 *
 *   * the whole run: the position (the owner's OK), the candidates while the
 *     interviews step is open, the pick (the owner's OK), and the owner adding
 *     the account; the new account ends at the run's venue only, the run is
 *     done, and neither a push, an audit payload nor a step record carries a
 *     candidate's name or phone;
 *   * the candidate form and the records refuse what does not fit, and the
 *     add_staff check refuses an account made before the run, a retired role
 *     and a role the position did not name;
 *   * the purge (time-shifted): candidates deleted, and on their run every
 *     decision note, skip note and the stop reason overwritten with the
 *     marker, an owner-added step's note removed, a run not yet due left
 *     alone; hiring_candidates then says the list was deleted;
 *   * candidates never reach the owner assistant: no readable-columns row and
 *     no index trigger;
 *   * the driver and marketing (§8.2), like every non-MGMT role: no row of
 *     hiring_candidates, none of its RPCs, no hiring start.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff and runs are created inside
 * it and each call runs as `authenticated` with the caller's JWT claims, as
 * PostgREST runs it. The hiring hooks are the real ones this migration adds.
 * Without docker on PATH the suite skips itself.
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
// {{name}} in a statement becomes the quoted value of a var; t() runs one
// call as a staff member and records its result or error; q() reads (or
// writes) as postgres; keep() stores a value; mk() makes an auth user + staff
// row (the 0123 trigger files a non-owner at venue A).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('manager_b', '${SEED_STAFF_IDS.manager_b}'), ('cashier', '${SEED_STAFF_IDS.cashier}'),
  ('desk', '${SEED_STAFF_IDS.court_desk}'), ('venue', '${VENUE_A_ID}');

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

-- p_later: the account is made a second after the transaction started, as an
-- account the owner creates after the run began would be (now() is the
-- transaction's start, the run's started_at).
create function pg_temp.mk(p_name text, p_role staff_role, p_later boolean default false) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'hr-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active, created_at)
  values (v, 'HR ' || p_name, p_role, true, now() + case when p_later then interval '1 second' else interval '0' end);
  insert into pg_temp.vars values (p_name, v::text);
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

const T = (label: string, who: string, sql: string) => `select pg_temp.t('${label}', '${who}', $q$${sql}$q$);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const MK = (name: string, role: string, later = false) => `select pg_temp.mk('${name}', '${role}', ${later});`;
const STEPK = (name: string, run: string, key: string) =>
  KEEP(name, `select id::text from protocol_run_steps where run_id = {{${run}}} and step_key = '${key}'`);
const LIVE_SUB = (name: string, step: string) =>
  KEEP(name, `select id::text from protocol_submissions where run_step_id = {{${step}}}
               and decision is null and withdrawn_at is null and superseded_at is null`);

const POSITION = `'{"role":"cashier","why":"Evenings are short one till","hours":"Thu to Sat, 18:00 to 02:00","start_date":"2026-11-01","pay_min_iqd":600000,"pay_max_iqd":750000}'`;
const START = (title = 'Evening cashier') => `select app.start_protocol('hiring', null, '${title}', null, '{}', ${POSITION})`;
const CANDIDATE = (name: string, phone: string, extra = '') =>
  `jsonb_build_object('candidate_name', '${name}', 'candidate_phone', '${phone}', 'brief', 'Calm at the till'${extra})`;

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

interface Candidate {
  id: string;
  candidate_name: string;
  candidate_phone: string;
  brief: string;
  interview_at: string | null;
  picked: boolean;
  pick_reason: string | null;
}

describe.skipIf(!docker)('hiring: candidates, the pick, the new account and the 90-day deletion', () => {
  it('runs from the position to the new account; candidates stay out of pushes, audits and records', () => {
    const r = scenario([
      MK('driver', 'driver'),
      MK('mk', 'marketing'),
      MK('early_hire', 'cashier'),
      T('start', 'manager', START()),
      RES('run', 'start', 'run_id'),
      RES('sub1', 'start', 'submission_id'),
      STEPK('s_int', 'run', 'interviews'),
      STEPK('s_add', 'run', 'add_staff'),
      T('too_early', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Ali Hassan', '0770 123 4567')})`),
      T('pos_ok', 'owner', `select app.decide_step({{sub1}}, 'approve')`),

      // The candidate form.
      T('c1', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Ali Hassan', '0770 123 4567', ", 'interview_at', now() + interval '2 days'")}, null, 'hr:c1')`),
      RES('c1', 'c1', 'id'),
      T('c1_replay', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Ali Hassan', '0770 123 4567')}, null, 'hr:c1')`),
      T('c2', 'owner', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Sara Kareem', '+964 780 555 0101', ", 'picked', true, 'pick_reason', 'Knows the till'")})`),
      RES('c2', 'c2', 'id'),
      T('c3', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Omar Ali', '0750 111 2222')})`),
      RES('c3', 'c3', 'id'),
      // The form sends every field: a save replaces the candidate.
      T('pick_c1', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Ali Hassan', '0770 123 4567', ", 'interview_at', now() + interval '2 days', 'picked', true")}, {{c1}})`),
      // Inside one transaction every created_at is the same instant: order by name.
      Q('picks', `select jsonb_agg(picked order by candidate_name) from hiring_candidates where run_id = {{run}}`),
      T('del_c3', 'manager', `select to_jsonb('deleted'::text) from (select app.delete_hiring_candidate({{c3}})) d`),
      T('del_again', 'manager', `select to_jsonb('deleted'::text) from (select app.delete_hiring_candidate({{c3}})) d`),
      T('no_name', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE(' ', '0770')})`),
      T('long_name', 'manager', `select app.save_hiring_candidate({{run}}, jsonb_build_object('candidate_name', repeat('a', 81), 'candidate_phone', '0770'))`),
      T('bad_phone', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Zaid', 'call me')})`),
      T('long_phone', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Zaid', '0770 000 0000 0000 0000 0000 0000 0000')})`),
      T('long_brief', 'manager', `select app.save_hiring_candidate({{run}}, jsonb_build_object('candidate_name', 'Zaid', 'candidate_phone', '0770', 'brief', repeat('b', 1001)))`),
      T('bad_when', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Zaid', '0770', ", 'interview_at', 'soon'")})`),
      T('stray', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Zaid', '0770', ", 'national_id', '123'")})`),
      T('unknown_id', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Zaid', '0770')}, gen_random_uuid())`),

      // Who reads the candidates.
      T('read_mgr', 'manager', `select app.hiring_candidates({{run}})`),
      T('read_owner', 'owner', `select app.hiring_candidates({{run}})`),
      T('read_cashier', 'cashier', `select app.hiring_candidates({{run}})`),
      T('read_desk', 'desk', `select app.hiring_candidates({{run}})`),
      T('read_driver', 'driver', `select app.hiring_candidates({{run}})`),
      T('read_mk', 'mk', `select app.hiring_candidates({{run}})`),
      T('read_nil', 'manager', `select app.hiring_candidates('00000000-0000-4000-8000-000000000000')`),
      T('table_mgr', 'manager', `select to_jsonb(count(*)) from hiring_candidates where run_id = {{run}}`),
      T('table_cashier', 'cashier', `select to_jsonb(count(*)) from hiring_candidates`),
      T('table_driver', 'driver', `select to_jsonb(count(*)) from hiring_candidates`),
      T('table_mk', 'mk', `select to_jsonb(count(*)) from hiring_candidates`),
      T('write_mgr', 'manager', `insert into hiring_candidates (venue_id, run_id, candidate_name, candidate_phone, created_by)
                                  values ({{venue}}, {{run}}, 'x', '1', {{manager}}) returning to_jsonb(id)`),
      T('save_driver', 'driver', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Zaid', '0770')})`),
      T('save_mk', 'mk', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Zaid', '0770')})`),
      T('save_desk', 'desk', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Zaid', '0770')})`),
      T('del_driver', 'driver', `select to_jsonb('deleted'::text) from (select app.delete_hiring_candidate({{c1}})) d`),
      T('del_mk', 'mk', `select to_jsonb('deleted'::text) from (select app.delete_hiring_candidate({{c1}})) d`),
      T('start_driver', 'driver', START()),
      T('start_mk', 'mk', START()),
      T('start_desk', 'desk', START()),
      T('start_hc', 'cashier', START()),

      // The pick: ids of this run's candidates only.
      T('int_none', 'manager', `select app.submit_step({{s_int}}, '{"candidate_ids":[],"picked_id":null}')`),
      T('int_foreign', 'manager', `select app.submit_step({{s_int}}, jsonb_build_object('candidate_ids', jsonb_build_array({{c1}}, gen_random_uuid()), 'picked_id', {{c1}}))`),
      T('int_pick', 'manager', `select app.submit_step({{s_int}}, jsonb_build_object('candidate_ids', jsonb_build_array({{c1}}), 'picked_id', {{c2}}))`),
      T('int', 'manager', `select app.submit_step({{s_int}}, jsonb_build_object('candidate_ids', jsonb_build_array({{c1}}, {{c2}}), 'picked_id', {{c2}}))`),
      LIVE_SUB('sub_int', 's_int'),
      T('save_submitted', 'manager', `select app.save_hiring_candidate({{run}}, ${CANDIDATE('Zaid', '0770')})`),
      T('del_submitted', 'manager', `select to_jsonb('deleted'::text) from (select app.delete_hiring_candidate({{c1}})) d`),
      T('int_ok', 'owner', `select app.decide_step({{sub_int}}, 'approve')`),
      Q('after_pick', `select jsonb_agg(jsonb_build_object('id', id, 'picked', picked, 'decided', decided_at is not null,
                                                          'days', extract(day from purge_after - decided_at))
                                        order by candidate_name)
                         from hiring_candidates where run_id = {{run}}`),

      // The owner adds the account.
      MK('barista_hire', 'barista', true),
      MK('prep_hire', 'prep', true),
      MK('hire', 'cashier', true),
      T('add_early', 'owner', `select app.submit_step({{s_add}}, jsonb_build_object('staff_id', {{early_hire}}))`),
      T('add_role', 'owner', `select app.submit_step({{s_add}}, jsonb_build_object('staff_id', {{barista_hire}}))`),
      T('add_prep', 'owner', `select app.submit_step({{s_add}}, jsonb_build_object('staff_id', {{prep_hire}}))`),
      T('add_nobody', 'owner', `select app.submit_step({{s_add}}, '{"staff_id":"not-an-id"}')`),
      T('add_mgr', 'manager', `select app.submit_step({{s_add}}, jsonb_build_object('staff_id', {{hire}}))`),
      // The account was filed at the default venue and somewhere else too; the pass files it at the run's venue only.
      KEEP('venue_x', `insert into venues (slug, name_en, name_ar, is_active) values ('hr-x-' || substr(md5(random()::text), 1, 6), 'HR test', 'اختبار', false)
                       returning id::text`),
      Q('file_x', `insert into staff_venues (staff_id, venue_id, role) values ({{hire}}, {{venue_x}}, 'cashier') returning to_jsonb(venue_id)`),
      T('add', 'owner', `select app.submit_step({{s_add}}, jsonb_build_object('staff_id', {{hire}}))`),
      Q('venues', `select jsonb_agg(venue_id order by venue_id) from staff_venues where staff_id = {{hire}}`),
      Q('run_after', `select jsonb_build_object('status', status, 'finished', finished_at is not null) from protocol_runs where id = {{run}}`),

      // What left the database about this run.
      Q('pushes', `select coalesce(jsonb_agg(payload), '[]') from notification_outbox
                    where payload->>'id' in (select id::text from protocol_run_steps where run_id = {{run}} union all select {{run}}::text)`),
      Q('audits', `select coalesce(jsonb_agg(jsonb_build_object('action', action, 'before', before, 'after', after)), '[]')
                     from audit_log where entity_id = {{run}}::text`),
      Q('records', `select coalesce(jsonb_agg(record), '[]') from protocol_submissions where run_id = {{run}}`),
      Q('readable', `select to_jsonb(count(*)) from app.assistant_readable_columns where table_name = 'hiring_candidates'`),
      Q('triggers', `select coalesce(jsonb_agg(tgname), '[]') from pg_trigger where tgrelid = 'public.hiring_candidates'::regclass and not tgisinternal`),
    ]);

    expect(refused(r, 'too_early')).toBe('STEP_NOT_OPEN');
    expect(ok(r, 'pos_ok')).toMatchObject({ decision: 'approve' });

    expect(ok(r, 'c1_replay')).toMatchObject({ id: ok<{ id: string }>(r, 'c1').id, duplicate: true });
    // Picking Ali unmarked Sara: one pick per run (Ali, Omar, Sara).
    expect(ok(r, 'picks')).toEqual([true, false, false]);
    expect(ok(r, 'del_c3')).toBe('deleted');
    expect(refused(r, 'del_again')).toBe('CANDIDATE_NOT_FOUND');
    expect(refused(r, 'no_name')).toBe('RECORD_INVALID:candidate_name');
    expect(refused(r, 'long_name')).toBe('TEXT_TOO_LONG:candidate_name');
    expect(refused(r, 'bad_phone')).toBe('RECORD_INVALID:candidate_phone');
    expect(refused(r, 'long_phone')).toBe('TEXT_TOO_LONG:candidate_phone');
    expect(refused(r, 'long_brief')).toBe('TEXT_TOO_LONG:brief');
    expect(refused(r, 'bad_when')).toBe('RECORD_INVALID:interview_at');
    expect(refused(r, 'stray')).toBe('RECORD_INVALID:national_id');
    expect(refused(r, 'unknown_id')).toBe('CANDIDATE_NOT_FOUND');

    const list = ok<{ candidates: Candidate[]; purged: boolean }>(r, 'read_mgr');
    expect(list.purged).toBe(false);
    const byName = [...list.candidates].sort((a, b) => a.candidate_name.localeCompare(b.candidate_name));
    expect(byName.map((c) => [c.candidate_name, c.candidate_phone, c.picked])).toEqual([
      ['Ali Hassan', '0770 123 4567', true],
      ['Sara Kareem', '+964 780 555 0101', false],
    ]);
    expect(byName[0]!.interview_at).not.toBeNull();
    expect(ok(r, 'read_owner')).toEqual(list);
    for (const who of ['read_cashier', 'read_desk', 'read_driver', 'read_mk']) expect(refused(r, who), who).toBe('FORBIDDEN');
    expect(refused(r, 'read_nil')).toBe('PROTOCOL_NOT_FOUND');
    expect(ok(r, 'table_mgr')).toBe(2);
    for (const who of ['table_cashier', 'table_driver', 'table_mk']) expect(ok(r, who), who).toBe(0);
    expect(refused(r, 'write_mgr')).toMatch(/permission denied/);
    for (const who of ['save_driver', 'save_mk', 'save_desk', 'del_driver', 'del_mk', 'start_driver', 'start_mk', 'start_desk', 'start_hc']) {
      expect(refused(r, who), who).toBe('FORBIDDEN');
    }

    expect(refused(r, 'int_none')).toBe('RECORD_INVALID:candidate_ids');
    expect(refused(r, 'int_foreign')).toBe('RECORD_INVALID:candidate_ids');
    expect(refused(r, 'int_pick')).toBe('RECORD_INVALID:picked_id');
    expect(ok(r, 'int')).toMatchObject({ auto: false });
    expect(refused(r, 'save_submitted')).toBe('STEP_NOT_OPEN');
    expect(refused(r, 'del_submitted')).toBe('STEP_NOT_OPEN');
    // The approved record decides the pick (Sara), and the 90 days start.
    expect(ok(r, 'after_pick')).toEqual([
      { id: ok<{ id: string }>(r, 'c1').id, picked: false, decided: true, days: 90 },
      { id: ok<{ id: string }>(r, 'c2').id, picked: true, decided: true, days: 90 },
    ]);

    expect(refused(r, 'add_early')).toBe('RECORD_INVALID:staff_id');
    expect(refused(r, 'add_role')).toBe('HIRE_ROLE_MISMATCH:staff_id');
    expect(refused(r, 'add_prep')).toBe('ROLE_RETIRED:staff_id');
    expect(refused(r, 'add_nobody')).toBe('RECORD_INVALID:staff_id');
    // add_staff is the owner's: a manager may not cover it.
    expect(refused(r, 'add_mgr')).toBe('NOT_STEP_ACTOR');
    expect(ok(r, 'add')).toMatchObject({ auto: true, run_status: 'done' });
    expect(ok(r, 'venues')).toEqual([VENUE_A_ID]);
    expect(ok(r, 'run_after')).toEqual({ status: 'done', finished: true });

    // Nothing that leaves or stays in the history names a candidate.
    const leaked = JSON.stringify([ok(r, 'pushes'), ok(r, 'audits'), ok(r, 'records')]);
    for (const s of ['Ali Hassan', 'Sara Kareem', 'Omar Ali', '0770 123 4567', '555 0101', 'Knows the till', 'Calm at the till']) {
      expect(leaked, s).not.toContain(s);
    }
    // The hiring push carries no run title either (§2.21).
    for (const p of ok<Array<{ params: Record<string, unknown> }>>(r, 'pushes')) expect(p.params.title).toBeUndefined();
    const actions = ok<Array<{ action: string }>>(r, 'audits').map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining([
      'protocol.hiring.candidate_save', 'protocol.hiring.candidate_delete', 'protocol.hiring.complete',
    ]));
    expect(ok(r, 'readable')).toBe(0);
    expect(ok(r, 'triggers')).toEqual([]);
  });

  it('the purge: candidates deleted after 90 days, and every note a name could hide in overwritten', () => {
    const r = scenario([
      // Run A: sent back, an owner-added step skipped, stopped at the interviews.
      T('start', 'manager', START('Barista for October')),
      RES('run', 'start', 'run_id'),
      RES('sub1', 'start', 'submission_id'),
      STEPK('s_pos', 'run', 'open_position'),
      STEPK('s_int', 'run', 'interviews'),
      T('back', 'owner', `select app.decide_step({{sub1}}, 'send_back', 'Ali Hassan already asked; write the hours out')`),
      T('again', 'manager', `select app.submit_step({{s_pos}}, ${POSITION})`),
      LIVE_SUB('sub2', 's_pos'),
      T('pos_ok', 'owner', `select app.decide_step({{sub2}}, 'approve', 'Fine')`),
      T('c1', 'manager', `select app.save_hiring_candidate({{run}}, jsonb_build_object('candidate_name', 'Ali Hassan', 'candidate_phone', '0770 123 4567'))`),
      T('c2', 'manager', `select app.save_hiring_candidate({{run}}, jsonb_build_object('candidate_name', 'Sara Kareem', 'candidate_phone', '0780 555 0101'))`),
      T('extra', 'owner', `select app.add_run_step({{run}}, {{s_int}}, '{"name_en":"Reference call","name_ar":"اتصال مرجعي","actor_roles":["manager"],"needs_owner_ok":false,"optional":true,"items":[]}')`),
      RES('s_extra', 'extra', 'id'),
      T('skip', 'owner', `select app.skip_step({{s_extra}}, 'Sara Kareem gave no referee')`),
      // An owner-added step's note, as a withdrawn submission would leave it.
      Q('step_note', `insert into protocol_submissions (run_step_id, run_id, round, submitted_by, record, withdrawn_at)
                      values ({{s_extra}}, {{run}}, 1, {{manager}}, '{"note":"Called Ali Hassan twice"}', now()) returning to_jsonb(id)`),
      T('int', 'manager', `select app.submit_step({{s_int}}, (select jsonb_build_object('candidate_ids', jsonb_agg(id), 'picked_id', min(id::text))
                                                                   from hiring_candidates where run_id = {{run}}))`),
      LIVE_SUB('sub_int', 's_int'),
      T('stop', 'owner', `select app.decide_step({{sub_int}}, 'stop', 'Ali Hassan took another job')`),
      Q('stopped', `select jsonb_agg(jsonb_build_object('decided', decided_at is not null, 'days', extract(day from purge_after - now())))
                      from hiring_candidates where run_id = {{run}}`),

      // Run B: candidates not yet due.
      T('start_b', 'manager', START('Driver')),
      RES('run_b', 'start_b', 'run_id'),
      RES('sub_b', 'start_b', 'submission_id'),
      T('pos_b', 'owner', `select app.decide_step({{sub_b}}, 'approve')`),
      T('cb', 'manager', `select app.save_hiring_candidate({{run_b}}, jsonb_build_object('candidate_name', 'Hadi Salim', 'candidate_phone', '0771 000 1111'))`),

      // Ninety days on for run A only.
      Q('shift', `update hiring_candidates set purge_after = now() - interval '1 second' where run_id = {{run}} returning to_jsonb(id)`),
      Q('purge', `select app.hiring_purge_due()`),
      Q('purge_again', `select app.hiring_purge_due()`),
      Q('left_a', `select to_jsonb(count(*)) from hiring_candidates where run_id = {{run}}`),
      Q('left_b', `select to_jsonb(count(*)) from hiring_candidates where run_id = {{run_b}}`),
      Q('notes', `select jsonb_agg(decision_note order by submitted_at, id) filter (where decision_note is not null)
                    from protocol_submissions where run_id = {{run}}`),
      Q('skip_note', `select to_jsonb(skip_note) from protocol_run_steps where id = {{s_extra}}`),
      Q('stop_reason', `select to_jsonb(stop_reason) from protocol_runs where id = {{run}}`),
      Q('owner_step_record', `select jsonb_agg(record) from protocol_submissions where run_step_id = {{s_extra}}`),
      Q('purge_audit', `select jsonb_agg(after) from audit_log where action = 'protocol.hiring.purge' and entity_id = {{run}}::text`),
      T('read_a', 'manager', `select app.hiring_candidates({{run}})`),
      T('read_b', 'manager', `select app.hiring_candidates({{run_b}})`),
      Q('b_untouched', `select jsonb_agg(decision_note) filter (where decision_note is not null) from protocol_submissions where run_id = {{run_b}}`),
      T('client_purge', 'owner', `select app.hiring_purge_due()`),
    ]);

    expect(ok(r, 'back')).toMatchObject({ decision: 'send_back' });
    expect(ok(r, 'skip')).toMatchObject({ step_status: 'skipped' });
    expect(ok(r, 'stop')).toMatchObject({ run_status: 'stopped' });
    // The stop starts the 90 days for candidates that had none.
    expect(ok(r, 'stopped')).toEqual([{ decided: true, days: 90 }, { decided: true, days: 90 }]);

    expect(ok(r, 'purge')).toEqual({ candidates: 2, runs: 1 });
    expect(ok(r, 'purge_again')).toEqual({ candidates: 0, runs: 0 });
    expect(ok(r, 'left_a')).toBe(0);
    expect(ok(r, 'left_b')).toBe(1);
    const marker = '[deleted after 90 days]';
    expect(ok(r, 'notes')).toEqual([marker, marker, marker]);
    expect(ok(r, 'skip_note')).toBe(marker);
    expect(ok(r, 'stop_reason')).toBe(marker);
    expect(ok(r, 'owner_step_record')).toEqual([{}]);
    const audit = ok<Array<Record<string, number>>>(r, 'purge_audit');
    expect(audit).toEqual([{ candidates: 2, decision_notes: 3, skip_notes: 1, stop_reason: 1, step_notes: 1 }]);
    expect(ok(r, 'read_a')).toEqual({ candidates: [], purged: true });
    expect(ok<{ purged: boolean; candidates: unknown[] }>(r, 'read_b')).toMatchObject({ purged: false });
    expect(ok<{ candidates: unknown[] }>(r, 'read_b').candidates).toHaveLength(1);
    expect(ok(r, 'b_untouched')).toBeNull();
    expect(refused(r, 'client_purge')).toMatch(/permission denied/);
  });
});
