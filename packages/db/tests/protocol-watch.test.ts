/**
 * protocol_watch (0363) — the owner's protocol status pushes, their on/off
 * setting, and the deciders' reminder of an approval still waiting.
 *
 *   * a step that passes tells every owner with updates on, never the one who
 *     decided it; an owner who turns updates off hears nothing more;
 *   * a run going live, scheduled, done, stopped or withdrawn tells the
 *     owners once; a release from live to done (the day-30 review) and a step
 *     that finishes its run send nothing extra; an owner already told about
 *     the run in the same transaction is skipped;
 *   * app.protocol_remind_sweep reminds the deciders 3 hours after a
 *     submission, then every 24 hours, never at night in the branch's
 *     timezone, never the sender, and never once it is decided;
 *   * app.my_push_prefs / app.set_my_push_prefs are the owner's alone.
 *
 * HOW. As protocols-engine-flow.test.ts: every scenario is ONE psql
 * transaction that is rolled back, each call made as `authenticated` with the
 * caller's claims. The watch triggers are deferred to commit, so FLUSH fires
 * them where a commit would (SET CONSTRAINTS ALL IMMEDIATE), with the last
 * caller's claims still set, as PostgREST's transaction has them. NEXT_TX then
 * ages the outbox rows so far, because the "already told in this
 * transaction" check reads created_at = now(), which a single test
 * transaction never moves. Without docker on PATH the suite skips itself.
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

const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('venue', '${VENUE_A_ID}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then
    raise exception 'unbound variable in: %', v;
  end if;
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
  values (v, 'pw-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'PW ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- The kinds' hooks other lanes applied to the shared stack are dropped, so a
-- built-in step takes the generic {note} record and a run finishes 'done'.
do $d$ declare r record; begin
  for r in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app'
              and p.proname ~ '^protocol_(start|check|submit|pass|finish|stop)_(product_release|tournament|hiring|price_promo)'
  loop execute 'drop function ' || r.sig; end loop;
end $d$;
-- A start hook is what makes a kind startable (PROTOCOL_NOT_READY without).
create function app.protocol_start_product_release(p_run_id uuid, p_data jsonb) returns jsonb
  language sql as $h$ select '{}'::jsonb $h$;
create function app.protocol_start_hiring(p_run_id uuid, p_data jsonb) returns jsonb
  language sql as $h$ select '{}'::jsonb $h$;
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
/** A statement as postgres with no caller (a fixture write, a cron run). */
const X = (sql: string) =>
  `select set_config('request.jwt.claims', '', true); select pg_temp.x($q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const STEP = (name: string, run: string, position: number) =>
  KEEP(name, `select id::text from protocol_run_steps where run_id = {{${run}}} and position = ${position}`);
/** Where the transaction would commit: the deferred watch triggers fire. */
const FLUSH = 'set constraints all immediate; set constraints all deferred;';
/** Commit, then a new transaction: what is queued so far is no longer "this transaction's". */
const NEXT_TX = `${FLUSH} update notification_outbox set created_at = created_at - interval '1 minute' where created_at = now();`;
const PUSHES = (label: string, run: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                               order by o.id), '[]')
       from notification_outbox o
      where o.payload->>'id' in (select s.id::text from protocol_run_steps s where s.run_id = {{${run}}}
                                 union all select {{${run}}}::text)`,
  );
/** A timezone whose local hour now is in [lo, hi]. */
const TZ_AT = (lo: number, hi: number) =>
  `(select name from pg_timezone_names
     where extract(hour from now() at time zone name) between ${lo} and ${hi}
       and name like '%/%'
     order by name limit 1)`;

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
function id(r: Results, name: string): string {
  return ok<string>(r, `id_${name}`);
}
const IDS = (...names: string[]) => names.map((n) => Q(`id_${n}`, `select to_jsonb({{${n}}}::text)`));

interface Push {
  to: string;
  kind: string;
  payload: { route: string; id: string; title_key: string; params: Record<string, unknown> };
}
const to = (pushes: Push[], key: string, target?: string) =>
  pushes
    .filter((p) => p.payload.title_key === key && (target === undefined || p.payload.id === target))
    .map((p) => p.to);

describe.skipIf(!docker)('protocol watch (rolled-back transactions)', () => {
  it('a step that passes tells every owner with updates on, never the decider; off means off', () => {
    const r = scenario([
      MK('hc', 'head_chef'),
      MK('o2', 'owner'),
      MK('o3', 'owner'),
      ...IDS('owner', 'manager', 'hc', 'o2', 'o3'),

      // A release proposal waits on the manager; nothing passes yet.
      T('start', 'hc', `select app.start_protocol('product_release', null, 'Rose latte', null, '{}', '{"note":"idea"}')`),
      RES('run', 'start', 'run_id'),
      RES('sub1', 'start', 'submission_id'),
      STEP('s1', 'run', 1),
      ...IDS('run', 's1'),
      NEXT_TX,
      T('approve', 'manager', `select app.decide_step({{sub1}}, 'approve')`),
      FLUSH,
      PUSHES('release', 'run'),
      NEXT_TX,

      // o2 turns updates off.
      T('o2_read_default', 'o2', `select app.my_push_prefs()`),
      T('o2_off', 'o2', `select app.set_my_push_prefs(false)`),
      T('o2_read_off', 'o2', `select app.my_push_prefs()`),

      // A hiring run: the opening needs the owner's OK; the seed owner gives it.
      T('hire', 'manager', `select app.start_protocol('hiring', null, 'Barista for November', null, '{}', '{}')`),
      RES('hrun', 'hire', 'run_id'),
      RES('hsub', 'hire', 'submission_id'),
      STEP('h1', 'hrun', 1),
      ...IDS('h1'),
      NEXT_TX,
      T('ok_opening', 'owner', `select app.decide_step({{hsub}}, 'approve')`),
      FLUSH,
      PUSHES('hiring', 'hrun'),
    ]);

    ok(r, 'approve');
    const release = ok<Push[]>(r, 'release');
    const passed = to(release, 'step_passed', id(r, 's1'));
    expect(passed).toEqual(expect.arrayContaining([id(r, 'owner'), id(r, 'o2'), id(r, 'o3')]));
    expect(passed).not.toContain(id(r, 'manager'));
    expect(passed).not.toContain(id(r, 'hc'));
    expect(new Set(passed).size).toBe(passed.length);
    const one = release.find((p) => p.payload.title_key === 'step_passed')!;
    expect(one.kind).toBe('staff_info');
    expect(one.payload.route).toBe('staff-step');
    expect(one.payload.params.title).toBe('Rose latte');
    expect(one.payload.params.step).toMatchObject({ en: expect.any(String), ar: expect.any(String) });
    // The run carries on: no run news.
    expect(release.filter((p) => p.payload.title_key.startsWith('run_'))).toEqual([]);

    expect(ok(r, 'o2_read_default')).toEqual({ protocol_updates: true });
    expect(ok(r, 'o2_off')).toEqual({ protocol_updates: false });
    expect(ok(r, 'o2_read_off')).toEqual({ protocol_updates: false });

    ok(r, 'ok_opening');
    const hiring = ok<Push[]>(r, 'hiring');
    const hpassed = to(hiring, 'step_passed', id(r, 'h1'));
    expect(hpassed).toContain(id(r, 'o3'));
    expect(hpassed).not.toContain(id(r, 'o2')); // turned off
    expect(hpassed).not.toContain(id(r, 'owner')); // the decider
    // A hiring run's title never reaches a lock screen.
    const h = hiring.find((p) => p.payload.title_key === 'step_passed')!;
    expect(h.payload.params.title).toBeUndefined();
  });

  it('run news: scheduled, live, done, stopped, withdrawn, once each; nothing for a review or a finishing step', () => {
    const start = (n: string) => [
      T(`start_${n}`, 'hc', `select app.start_protocol('product_release', null, 'Run ${n}', null, '{}', '{"note":"x"}')`),
      RES(n, `start_${n}`, 'run_id'),
      ...IDS(n),
    ];
    const r = scenario([
      MK('hc', 'head_chef'),
      MK('o3', 'owner'),
      ...IDS('owner', 'o3'),
      ...start('r1'),
      ...start('r2'),
      ...start('r3'),
      ...start('r4'),
      ...start('r5'),
      ...start('r6'),
      ...start('r7'),
      STEP('r7s1', 'r7', 1),
      ...IDS('r7s1'),
      NEXT_TX,

      // r1: scheduled, then live, then done (its day-30 review).
      X(`update protocol_runs set status = 'scheduled', scheduled_for = now() + interval '1 day' where id = {{r1}}`),
      NEXT_TX,
      X(`update protocol_runs set status = 'live', live_at = now() where id = {{r1}}`),
      NEXT_TX,
      X(`update protocol_runs set status = 'done', finished_at = now() where id = {{r1}}`),
      NEXT_TX,
      // r2 stopped, r3 withdrawn, r4 done.
      X(`update protocol_runs set status = 'stopped', stop_reason = 'Not this season', finished_at = now() where id = {{r2}}`),
      X(`update protocol_runs set status = 'withdrawn', finished_at = now() where id = {{r3}}`),
      X(`update protocol_runs set status = 'done', finished_at = now() where id = {{r4}}`),
      NEXT_TX,
      // r5: the owner was already told about r5 in this transaction.
      X(`select app.notify_staff(array[{{owner}}]::uuid[], 'staff_info',
           jsonb_build_object('route', 'staff-run', 'id', {{r5}}::text, 'title_key', 'review_ready', 'params', '{}'::jsonb))`),
      X(`update protocol_runs set status = 'done', finished_at = now() where id = {{r5}}`),
      NEXT_TX,
      // r6: scheduled and back to active in one transaction: nothing to tell.
      X(`update protocol_runs set status = 'scheduled', scheduled_for = now() + interval '1 day' where id = {{r6}}`),
      X(`update protocol_runs set status = 'active', scheduled_for = null where id = {{r6}}`),
      NEXT_TX,
      // r7: its step passes and the run finishes in one transaction: the run's news only.
      X(`update protocol_run_steps set status = 'passed', passed_at = now() where id = {{r7s1}}`),
      X(`update protocol_runs set status = 'done', finished_at = now() where id = {{r7}}`),
      FLUSH,
      ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map((n) => PUSHES(n, n)),
    ]);

    const keys = (n: string, who: string) =>
      ok<Push[]>(r, n)
        .filter((p) => p.to === id(r, who) && p.payload.title_key !== 'step_submitted')
        .map((p) => p.payload.title_key);
    for (const who of ['owner', 'o3']) {
      expect(keys('r1', who), who).toEqual(['run_scheduled', 'run_live']);
      expect(keys('r2', who), who).toEqual(['run_stopped']);
      expect(keys('r3', who), who).toEqual(['run_withdrawn']);
      expect(keys('r4', who), who).toEqual(['run_done']);
      expect(keys('r6', who), who).toEqual([]);
      expect(keys('r7', who), who).toEqual(['run_done']);
    }
    // r5: the owner had review_ready already; o3 gets the news.
    expect(keys('r5', 'owner')).toEqual(['review_ready']);
    expect(keys('r5', 'o3')).toEqual(['run_done']);
    const done = ok<Push[]>(r, 'r4').find((p) => p.payload.title_key === 'run_done')!;
    expect(done.kind).toBe('staff_info');
    expect(done.payload).toMatchObject({ route: 'staff-run', id: id(r, 'r4'), params: { title: 'Run r4' } });
  });

  it('reminds the deciders 3 hours after a submission, then daily, by day only, never the sender', () => {
    const SWEEP = X(`select app.protocol_remind_sweep()`);
    const COUNT = (label: string) =>
      Q(label, `select coalesce(jsonb_agg(o.profile_id order by o.id), '[]') from notification_outbox o
                 where o.payload->>'title_key' = 'decision_waiting' and o.payload->>'id' = {{s1}}::text`);
    const r = scenario([
      MK('hc', 'head_chef'),
      ...IDS('owner', 'manager', 'hc'),
      X(`update venues set timezone = ${TZ_AT(11, 19)} where id = {{venue}}`),
      T('start', 'hc', `select app.start_protocol('product_release', null, 'Rose latte', null, '{}', '{"note":"idea"}')`),
      RES('run', 'start', 'run_id'),
      RES('sub1', 'start', 'submission_id'),
      STEP('s1', 'run', 1),
      ...IDS('s1'),

      X(`update protocol_submissions set submitted_at = now() - interval '2 hours' where id = {{sub1}}`),
      SWEEP,
      COUNT('at_2h'),
      X(`update protocol_submissions set submitted_at = now() - interval '4 hours' where id = {{sub1}}`),
      SWEEP,
      COUNT('at_4h'),
      Q('stamped', `select to_jsonb(reminded_at is not null) from protocol_submissions where id = {{sub1}}`),
      SWEEP,
      COUNT('again_at_once'),
      // A day later, at night in the branch: it waits.
      X(`update protocol_submissions set reminded_at = now() - interval '25 hours' where id = {{sub1}}`),
      X(`update venues set timezone = ${TZ_AT(1, 6)} where id = {{venue}}`),
      SWEEP,
      COUNT('at_night'),
      // In the morning it goes.
      X(`update venues set timezone = ${TZ_AT(11, 19)} where id = {{venue}}`),
      SWEEP,
      COUNT('next_day'),
      // Decided: no more.
      T('approve', 'manager', `select app.decide_step({{sub1}}, 'approve')`),
      X(`update protocol_submissions set reminded_at = now() - interval '25 hours' where id = {{sub1}}`),
      SWEEP,
      COUNT('decided'),
      Q('push', `select to_jsonb(o) from notification_outbox o
                  where o.payload->>'title_key' = 'decision_waiting' and o.payload->>'id' = {{s1}}::text limit 1`),
      T('client_call', 'owner', `select to_jsonb(app.protocol_remind_sweep())`),
    ]);

    expect(ok<string[]>(r, 'at_2h')).toEqual([]);
    const first = ok<string[]>(r, 'at_4h');
    expect(first).toContain(id(r, 'manager'));
    expect(first).not.toContain(id(r, 'hc')); // the sender
    expect(first).not.toContain(id(r, 'owner')); // the branch has a manager
    expect(ok(r, 'stamped')).toBe(true);
    expect(ok<string[]>(r, 'again_at_once')).toEqual(first);
    expect(ok<string[]>(r, 'at_night')).toEqual(first);
    expect(ok<string[]>(r, 'next_day')).toEqual([...first, ...first]);
    ok(r, 'approve');
    expect(ok<string[]>(r, 'decided')).toEqual([...first, ...first]);
    const push = ok<{ kind: string; payload: Push['payload'] }>(r, 'push');
    expect(push.kind).toBe('staff_decide');
    expect(push.payload).toMatchObject({ route: 'staff-step', title_key: 'decision_waiting', params: { title: 'Rose latte' } });
    expect(refused(r, 'client_call')).toMatch(/permission denied/);
  });

  it('the setting is the owner’s alone', () => {
    const r = scenario([
      MK('hc', 'head_chef'),
      T('mgr_read', 'manager', `select app.my_push_prefs()`),
      T('mgr_set', 'manager', `select app.set_my_push_prefs(false)`),
      T('hc_set', 'hc', `select app.set_my_push_prefs(false)`),
      T('owner_null', 'owner', `select app.set_my_push_prefs(null)`),
      T('owner_off', 'owner', `select app.set_my_push_prefs(false)`),
      T('owner_on', 'owner', `select app.set_my_push_prefs(true)`),
      T('owner_read', 'owner', `select app.my_push_prefs()`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'staff.push_prefs' and entity_id = {{owner}}::text and at = now()`),
      T('table_read', 'owner', `select to_jsonb(count(*)) from staff_push_prefs`),
    ]);
    expect(refused(r, 'mgr_read')).toBe('FORBIDDEN');
    expect(refused(r, 'mgr_set')).toBe('FORBIDDEN');
    expect(refused(r, 'hc_set')).toBe('FORBIDDEN');
    expect(refused(r, 'owner_null')).toBe('INVALID_ARGUMENT:protocol_updates');
    expect(ok(r, 'owner_off')).toEqual({ protocol_updates: false });
    expect(ok(r, 'owner_on')).toEqual({ protocol_updates: true });
    expect(ok(r, 'owner_read')).toEqual({ protocol_updates: true });
    expect(ok(r, 'audit')).toBe(2);
    expect(refused(r, 'table_read')).toMatch(/permission denied/);
  });
});
