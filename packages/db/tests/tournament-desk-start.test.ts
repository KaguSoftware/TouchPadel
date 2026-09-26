/**
 * tournament_desk_start (build-contracts-2026-09-23 §2.11, §8.2; plan #67):
 * the court desk starts a tournament.
 *
 *   * the desk starts type 1 and type 2 runs, and type 3 only with its
 *     sponsor; the desk's plan waits for a manager, who approves it or sends
 *     it back; the desk cannot decide its own plan;
 *   * the plan is assigned to its starter: a plan the owner reopens from
 *     feasibility goes back to the manager who started the run, and on a
 *     desk-started run only that desk member is told and sees it, never every
 *     court desk at the venue;
 *   * a barista, the cashier, the driver and marketing are refused a
 *     tournament start;
 *   * How it works saves a tournament template carrying the new plan actors
 *     and refuses the old ones (PROTOCOL_STEP_FIXED); the seeded templates
 *     and the defs agree;
 *   * a run started before the migration keeps its snapshot.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness), with the real tournament hooks of
 * event_court_blocks. Without docker on PATH the suite skips itself.
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
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('manager_b', '${SEED_STAFF_IDS.manager_b}'), ('cashier', '${SEED_STAFF_IDS.cashier}'),
  ('desk', '${SEED_STAFF_IDS.court_desk}'), ('venue', '${VENUE_A_ID}');
insert into vars values ('tz', coalesce((select timezone from venue_settings limit 1), 'Asia/Baghdad'));

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
  values (v, 'td-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'TD ' || p_name, p_role, true);
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
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const STEPK = (name: string, run: string, key: string) =>
  KEEP(name, `select id::text from protocol_run_steps where run_id = {{${run}}} and step_key = '${key}'`);
const COURT = (name: string) =>
  KEEP(name, `insert into courts (name_en, name_ar, venue_id, sort_order) values ('TD ${name}', 'ملعب', {{venue}}, 90) returning id::text`);
/** Pushes about one run step, in order. */
const PUSHES = (label: string, step: string) =>
  Q(label, `select coalesce(jsonb_agg(jsonb_build_object('to', profile_id, 'key', payload->>'title_key') order by id), '[]')
              from notification_outbox where payload->>'id' = {{${step}}}`);
const TODO = (label: string, who: string) =>
  T(label, who, `select coalesce(jsonb_agg(x->>'run_step_id'), '[]') from jsonb_array_elements(app.my_protocol_work({{venue}})->'todo') x`);

/** A plan on the kept court, the day after tomorrow, 18:00 to 22:00 local. */
function plan(variant: 'type1' | 'type2' | 'type3', sponsor = false): string {
  const range = `jsonb_build_object('court_ids', jsonb_build_array({{court}}),
      'from', ((current_date + 2) + time '18:00') at time zone {{tz}},
      'to', ((current_date + 2) + time '22:00') at time zone {{tz}})`;
  let rec = `jsonb_build_object('class', 'B', 'name_en', 'Friday Open', 'name_ar', 'بطولة الجمعة',
      'ranges', jsonb_build_array(${range}), 'capacity', jsonb_build_object('unit', 'players', 'count', 24))`;
  if (variant !== 'type2') rec += ` || '{"format":"mexicano"}'::jsonb`;
  if (sponsor) rec += ` || '{"sponsor":{"name":"Acme","contact":"0770","contribution_iqd":500000}}'::jsonb`;
  return `(${rec})`;
}
const start = (variant: 'type1' | 'type2' | 'type3', sponsor = false) =>
  `select app.start_protocol('tournament', '${variant}', 'Friday open', null, '{}', ${plan(variant, sponsor)})`;
const FEAS = `'{"staffing":"One referee","income_iqd":200000,"cost_iqd":50000,"risks":"None"}'`;

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
  key: string;
}

describe.skipIf(!docker)('tournament_desk_start: the court desk starts a tournament', () => {
  it('the desk starts type 1 and type 2, type 3 with its sponsor; its plan waits for a manager', () => {
    const r = scenario([
      MK('desk2', 'court_desk'),
      MK('barista', 'barista'),
      MK('driver', 'driver'),
      MK('mk', 'marketing'),
      COURT('court'),
      T('t1', 'desk', start('type1')),
      RES('run1', 't1', 'run_id'),
      RES('sub1', 't1', 'submission_id'),
      STEPK('p1', 'run1', 'plan'),
      Q('plan1', `select jsonb_build_object('status', status, 'assigned_to', assigned_to, 'actors', actor_roles)
                    from protocol_run_steps where id = {{p1}}`),
      PUSHES('pushes1', 'p1'),
      T('t2', 'desk', start('type2')),
      RES('run2', 't2', 'run_id'),
      RES('sub2', 't2', 'submission_id'),
      STEPK('p2', 'run2', 'plan'),
      T('t3_nosponsor', 'desk', start('type3')),
      T('t3', 'desk', start('type3', true)),

      // The desk (and another desk) cannot decide the plan.
      T('desk_decides', 'desk', `select app.decide_step({{sub1}}, 'approve')`),
      T('desk2_decides', 'desk2', `select app.decide_step({{sub1}}, 'approve')`),
      T('mgr_to_decide', 'manager', `select coalesce(jsonb_agg(x->>'submission_id'), '[]') from jsonb_array_elements(app.my_protocol_work({{venue}})->'to_decide') x`),
      T('approve', 'manager', `select app.decide_step({{sub1}}, 'approve')`),
      Q('run1_after', `select jsonb_build_object('data_name', data->>'name_en',
                         'steps', (select jsonb_object_agg(step_key, status) from protocol_run_steps where run_id = {{run1}}))
                         from protocol_runs where id = {{run1}}`),

      // Type 2 sent back: back to the desk that started it, and only to it.
      T('back2', 'manager_b', `select app.decide_step({{sub2}}, 'send_back', 'Pick a later hour')`),
      TODO('desk_todo', 'desk'),
      TODO('desk2_todo', 'desk2'),
      PUSHES('pushes2', 'p2'),
      Q('desk2_id', `select to_jsonb({{desk2}}::text)`),
      T('desk2_submit', 'desk2', `select app.submit_step({{p2}}, ${plan('type2')})`),
      T('desk_resubmit', 'desk', `select app.submit_step({{p2}}, ${plan('type2')})`),

      // Who may not start one.
      T('barista_t', 'barista', start('type1')),
      T('cashier_t', 'cashier', start('type1')),
      T('driver_t', 'driver', start('type1')),
      T('mk_t', 'mk', start('type1')),
      // The desk's other kinds are still refused.
      T('desk_hiring', 'desk', `select app.start_protocol('hiring', null, 'x', null, '{}', '{}')`),
      T('desk_release', 'desk', `select app.start_protocol('product_release', null, 'x', null, '{}', '{}')`),
      T('desk_price', 'desk', `select app.start_protocol('price_promo', null, 'x', null, '{}', '{}')`),
    ]);

    expect(ok(r, 't1')).toMatchObject({ auto: false, status: 'active' });
    expect(ok(r, 'plan1')).toEqual({ status: 'submitted', assigned_to: SEED_STAFF_IDS.court_desk, actors: ['manager', 'court_desk'] });
    // The plan waits on the venue's managers, not on the owner and not on a desk.
    const decided = ok<Push[]>(r, 'pushes1').filter((p) => p.key === 'step_submitted').map((p) => p.to).sort();
    expect(decided).toEqual([SEED_STAFF_IDS.manager, SEED_STAFF_IDS.manager_b].sort());
    expect(ok(r, 't2')).toMatchObject({ auto: false });
    expect(refused(r, 't3_nosponsor')).toBe('SPONSOR_DETAILS_REQUIRED:sponsor');
    expect(ok(r, 't3')).toMatchObject({ auto: false });

    expect(refused(r, 'desk_decides')).toBe('NOT_DECIDER');
    expect(refused(r, 'desk2_decides')).toBe('NOT_DECIDER');
    expect(ok<string[]>(r, 'mgr_to_decide')).toContain(ok<{ submission_id: string }>(r, 't1').submission_id);
    expect(ok(r, 'approve')).toMatchObject({ decision: 'approve' });
    expect(ok(r, 'run1_after')).toEqual({
      data_name: 'Friday Open',
      steps: { plan: 'passed', feasibility: 'open', marketing: 'waiting', courts: 'waiting', ready: 'waiting' },
    });

    expect(ok(r, 'back2')).toMatchObject({ decision: 'send_back', step_status: 'open' });
    const p2 = ok<{ first_step_id: string }>(r, 't2').first_step_id;
    expect(ok<string[]>(r, 'desk_todo')).toContain(p2);
    expect(ok<string[]>(r, 'desk2_todo')).not.toContain(p2);
    const pushes2 = ok<Push[]>(r, 'pushes2');
    expect(pushes2.filter((p) => p.key === 'step_sent_back').map((p) => p.to)).toEqual([SEED_STAFF_IDS.court_desk]);
    expect(pushes2.map((p) => p.to)).not.toContain(ok<string>(r, 'desk2_id'));
    expect(refused(r, 'desk2_submit')).toBe('NOT_STEP_ACTOR');
    expect(ok(r, 'desk_resubmit')).toMatchObject({ auto: false });

    for (const label of ['barista_t', 'cashier_t', 'driver_t', 'mk_t', 'desk_hiring', 'desk_release', 'desk_price']) {
      expect(refused(r, label), label).toBe('FORBIDDEN');
    }
  });

  it('the plan is assigned to its starter: a reopened plan goes back to them, never to every desk', () => {
    const r = scenario([
      MK('desk2', 'court_desk'),
      COURT('court'),
      // A manager's run: the plan passes on its own, the owner sends feasibility back to it.
      T('m_start', 'manager', start('type1')),
      RES('mrun', 'm_start', 'run_id'),
      STEPK('m_plan', 'mrun', 'plan'),
      STEPK('m_feas', 'mrun', 'feasibility'),
      T('m_feas', 'manager', `select app.submit_step({{m_feas}}, ${FEAS})`),
      RES('m_sub', 'm_feas', 'submission_id'),
      T('m_back', 'owner', `select app.decide_step({{m_sub}}, 'send_back', 'Costs are too high', {{m_plan}}::uuid)`),
      Q('m_plan_state', `select jsonb_build_object('status', status, 'round', round, 'assigned_to', assigned_to)
                           from protocol_run_steps where id = {{m_plan}}`),
      PUSHES('m_pushes', 'm_plan'),
      TODO('m_desk_todo', 'desk'),
      TODO('m_desk2_todo', 'desk2'),
      TODO('m_mgr_todo', 'manager'),
      TODO('m_mgr_b_todo', 'manager_b'),
      Q('m_plan_id', `select to_jsonb({{m_plan}}::text)`),
      Q('desk2_id', `select to_jsonb({{desk2}}::text)`),

      // A desk's run: approved, then sent back from feasibility by the owner.
      T('d_start', 'desk', start('type1')),
      RES('drun', 'd_start', 'run_id'),
      RES('d_sub1', 'd_start', 'submission_id'),
      STEPK('d_plan', 'drun', 'plan'),
      STEPK('d_feas', 'drun', 'feasibility'),
      T('d_approve', 'manager', `select app.decide_step({{d_sub1}}, 'approve')`),
      T('d_feas', 'manager', `select app.submit_step({{d_feas}}, ${FEAS})`),
      RES('d_sub2', 'd_feas', 'submission_id'),
      T('d_back', 'owner', `select app.decide_step({{d_sub2}}, 'send_back', 'Pick another weekend', {{d_plan}}::uuid)`),
      PUSHES('d_pushes', 'd_plan'),
      TODO('d_desk_todo', 'desk'),
      TODO('d_desk2_todo', 'desk2'),
      TODO('d_mgr_todo', 'manager'),
      // A manager still covers it.
      T('d_mgr_cover', 'manager', `select app.submit_step({{d_plan}}, ${plan('type1')})`),
    ]);

    expect(ok(r, 'm_start')).toMatchObject({ auto: true });
    expect(ok(r, 'm_back')).toMatchObject({ decision: 'send_back' });
    expect(ok(r, 'm_plan_state')).toEqual({ status: 'open', round: 2, assigned_to: SEED_STAFF_IDS.manager });
    // Only the manager who started it hears the plan reopen, and only they see it in To do.
    const mOpen = ok<Push[]>(r, 'm_pushes').filter((p) => p.key === 'step_open').map((p) => p.to);
    expect(mOpen).toEqual([SEED_STAFF_IDS.manager]);
    const mPlanId = ok<string>(r, 'm_plan_id');
    expect(ok<string[]>(r, 'm_mgr_todo')).toContain(mPlanId);
    for (const label of ['m_desk_todo', 'm_desk2_todo', 'm_mgr_b_todo']) {
      expect(ok<string[]>(r, label), label).not.toContain(mPlanId);
    }

    expect(ok(r, 'd_back')).toMatchObject({ decision: 'send_back' });
    const dOpen = ok<Push[]>(r, 'd_pushes').filter((p) => p.key === 'step_open').map((p) => p.to);
    expect(dOpen).toEqual([SEED_STAFF_IDS.court_desk]);
    expect(ok<Push[]>(r, 'd_pushes').map((p) => p.to)).not.toContain(ok<string>(r, 'desk2_id'));
    const dPlan = ok<{ first_step_id: string }>(r, 'd_start').first_step_id;
    expect(ok<string[]>(r, 'd_desk_todo')).toContain(dPlan);
    expect(ok<string[]>(r, 'd_desk2_todo')).not.toContain(dPlan);
    expect(ok<string[]>(r, 'd_mgr_todo')).not.toContain(dPlan);
    expect(ok(r, 'd_mgr_cover')).toMatchObject({ auto: true });
  });

  it('How it works saves the new plan actors and refuses the old; the defs and templates agree', () => {
    const steps = (planActors: string[]) =>
      JSON.stringify([
        { step_key: 'plan', name_en: 'Plan', name_ar: 'الخطة', needs_owner_ok: false, actor_roles: planActors },
        { step_key: 'feasibility', name_en: 'Feasibility', name_ar: 'دراسة الجدوى', needs_owner_ok: true },
        { step_key: 'marketing', name_en: 'Marketing', name_ar: 'التسويق', needs_owner_ok: false },
        { step_key: 'courts', name_en: 'Courts', name_ar: 'حجز الملاعب', needs_owner_ok: false },
        { step_key: 'ready', name_en: 'Ready', name_ar: 'الجاهزية', needs_owner_ok: false },
      ]);
    const r = scenario([
      KEEP('tpl', `select id::text from protocol_templates where venue_id = {{venue}} and kind = 'tournament' and variant = 'type1'`),
      KEEP('ver', `select version::text from protocol_templates where id = {{tpl}}`),
      T('old', 'owner', `select app.save_protocol_template({{tpl}}, {{ver}}::int, 'Tournament, type 1', 'بطولة، النوع 1', '${steps(['manager'])}'::jsonb)`),
      T('new', 'owner', `select app.save_protocol_template({{tpl}}, {{ver}}::int, 'Tournament, type 1', 'بطولة، النوع 1', '${steps(['court_desk', 'manager'])}'::jsonb)`),
      Q('rows', `select jsonb_object_agg(t.variant, s.actor_roles) from protocol_template_steps s
                   join protocol_templates t on t.id = s.template_id
                  where t.venue_id = {{venue}} and t.kind = 'tournament' and s.step_key = 'plan'`),
      Q('defs', `select jsonb_object_agg(v, (select d from jsonb_array_elements(app.protocol_step_defs('tournament', v)) d
                                             where d->>'step_key' = 'plan'))
                   from unnest(array['type1', 'type2', 'type3']) v`),
    ]);

    expect(refused(r, 'old')).toBe('PROTOCOL_STEP_FIXED:actor_roles');
    expect(ok(r, 'new')).toMatchObject({ version: expect.any(Number) });
    expect(ok(r, 'rows')).toEqual({
      type1: ['manager', 'court_desk'], type2: ['manager', 'court_desk'], type3: ['manager', 'court_desk'],
    });
    for (const d of Object.values(ok<Record<string, Record<string, unknown>>>(r, 'defs'))) {
      expect(d).toMatchObject({ actor_roles: ['manager', 'court_desk'], assign_to_starter: true, needs_owner_ok: false, fixed: 'first' });
    }
  });

  it('a run started before the migration keeps its snapshot', () => {
    const r = scenario([
      COURT('court'),
      T('start', 'manager', start('type1')),
      RES('run', 'start', 'run_id'),
      STEPK('s_plan', 'run', 'plan'),
      STEPK('s_feas', 'run', 'feasibility'),
      // The snapshot a run started before tournament_desk_start holds.
      Q('old_snapshot', `update protocol_run_steps set actor_roles = '{manager}', assigned_to = null
                          where id = {{s_plan}} returning to_jsonb(actor_roles)`),
      T('feas', 'manager', `select app.submit_step({{s_feas}}, ${FEAS})`),
      RES('sub', 'feas', 'submission_id'),
      T('back', 'owner', `select app.decide_step({{sub}}, 'send_back', 'Not this month', {{s_plan}}::uuid)`),
      Q('plan', `select jsonb_build_object('status', status, 'actors', actor_roles, 'assigned_to', assigned_to)
                   from protocol_run_steps where id = {{s_plan}}`),
      PUSHES('pushes', 's_plan'),
      TODO('desk_todo', 'desk'),
      TODO('mgr_b_todo', 'manager_b'),
      T('desk_submit', 'desk', `select app.submit_step({{s_plan}}, ${plan('type1')})`),
    ]);

    expect(ok(r, 'plan')).toEqual({ status: 'open', actors: ['manager'], assigned_to: null });
    // Unassigned, as before: every manager hears of it and sees it; no desk.
    const opened = ok<Push[]>(r, 'pushes').filter((p) => p.key === 'step_open').map((p) => p.to).sort();
    expect(opened).toEqual([SEED_STAFF_IDS.manager, SEED_STAFF_IDS.manager_b].sort());
    const planId = ok<{ first_step_id: string }>(r, 'start').first_step_id;
    expect(ok<string[]>(r, 'mgr_b_todo')).toContain(planId);
    expect(ok<string[]>(r, 'desk_todo')).not.toContain(planId);
    expect(refused(r, 'desk_submit')).toBe('NOT_STEP_ACTOR');
  });
});
