/**
 * event_court_blocks (build-contracts-2026-09-23 §2.11, §8.2): a tournament's
 * courts, and event hours as their own line in court analytics.
 *
 *   * the court desk blocks a tournament's courts only while its courts step
 *     is open; a live booking in the way writes nothing and comes back as a
 *     conflict; once it is moved every block lands once (a replay and a
 *     second ask return the same rows); the blocks are maintenance rows
 *     marked as the run's event, with the tournament's name for older desks;
 *   * tournament_context gives the court desk and marketing the plan's names,
 *     ranges and blocks and no money; tournament_feasibility is MGMT's;
 *   * the courts step takes the run's own live blocks of the passed plan
 *     only; a plan sent back and moved cancels the blocks it no longer names,
 *     so a shifted window blocks with no conflict against the old one; a stop
 *     cancels the blocks that have not started;
 *   * event minutes stay open capacity and appear as event_minutes in
 *     analytics_courts_summary, analytics_courts_cafe and report_courts,
 *     while a plain maintenance block is still closed time;
 *   * the plan check: the three variants, the sponsor, the ranges, and the
 *     other steps' records;
 *   * the driver and marketing (§8.2): no block, no feasibility, no courts
 *     context, no analytics or report, no tournament start.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, courts and bookings are
 * created inside it and each call runs as `authenticated` with the caller's
 * JWT claims, as PostgREST runs it. The tournament hooks are the real ones
 * this migration adds. Without docker on PATH the suite skips itself.
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

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'ev-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'EV ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- The venue's timezone, for the local instants below.
insert into vars values ('tz', coalesce((select timezone from venue_settings limit 1), 'Asia/Baghdad'));
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
const COURT = (name: string, active = true) =>
  KEEP(name, `insert into courts (name_en, name_ar, venue_id, sort_order, is_active)
              values ('EV ${name}', 'ملعب ${name}', {{venue}}, 90, ${active}) returning id::text`);
const LIVE_SUB = (name: string, step: string) =>
  KEEP(name, `select id::text from protocol_submissions where run_step_id = {{${step}}}
               and decision is null and withdrawn_at is null and superseded_at is null`);

/** A venue-local instant on a kept day, as SQL (plain SQL: the call runs as authenticated). */
const AT = (day: string, time: string) => `((({{${day}}})::date + time '${time}') at time zone {{tz}})`;

/** A plan record as SQL (type 1 / 3 carry the format and the figures). */
function plan(opts: {
  courts: string[];
  day: string;
  from?: string;
  to?: string;
  variant?: 'type1' | 'type2' | 'type3';
  sponsor?: boolean;
  extra?: string;
}): string {
  const v = opts.variant ?? 'type1';
  const courts = opts.courts.map((c) => `{{${c}}}`).join(', ');
  const range = `jsonb_build_object('court_ids', jsonb_build_array(${courts}),
      'from', ${AT(opts.day, opts.from ?? '18:00')},
      'to', ${AT(opts.day, opts.to ?? '22:00')})`;
  const base = `jsonb_build_object('class', 'A', 'name_en', 'Summer Cup', 'name_ar', 'كأس الصيف',
      'ranges', jsonb_build_array(${range}), 'capacity', jsonb_build_object('unit', 'pairs', 'count', 16))`;
  const full =
    v === 'type2'
      ? base
      : `${base} || jsonb_build_object('format', 'americano', 'entry_fee_iqd', 25000,
          'prize', jsonb_build_object('text', 'Trophy', 'iqd', 500000), 'budget_iqd', 300000, 'risks', 'Rain')`;
  const sponsor = opts.sponsor
    ? ` || jsonb_build_object('sponsor', jsonb_build_object('name', 'Acme', 'contact', '0770 000 0000', 'contribution_iqd', 1000000))`
    : '';
  return `(${full}${sponsor}${opts.extra ?? ''})`;
}
const start = (variant: 'type1' | 'type2' | 'type3', record: string, title = 'Summer cup') =>
  `select app.start_protocol('tournament', '${variant}', '${title}', null, '{}', ${record})`;
/** p_blocks: [court, day, from, to] each. */
const blocks = (list: Array<[string, string, string, string]>) =>
  `jsonb_build_array(${list
    .map(
      ([c, d, f, t]) =>
        `jsonb_build_object('court_id', {{${c}}}, 'start_at', ${AT(d, f)}, 'end_at', ${AT(d, t)})`,
    )
    .join(', ')})`;

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

/** Every key of a JSON value, at any depth. */
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
}

interface Block {
  reservation_id: string;
  court_id: string;
  start_at: string;
  end_at: string;
}
interface BlockResult {
  blocked: Block[];
  conflicts: Array<{ reservation_id: string; court_id: string; kind: string; status: string }>;
  duplicate?: boolean;
}
interface Context {
  name_en: string;
  name_ar: string;
  class: string;
  format: string | null;
  capacity: { unit: string; count: number };
  ranges: Array<{ court_ids: string[]; court_names: Array<{ en: string; ar: string }>; from: string; to: string }>;
  blocked: Block[];
}

describe.skipIf(!docker)('event_court_blocks: blocking courts for a tournament', () => {
  it('blocks only while the courts step is open; a conflict writes nothing; moved, every block lands once', () => {
    const two: Array<[string, string, string, string]> = [
      ['court', 'day', '18:00', '22:00'],
      ['court2', 'day', '18:00', '22:00'],
    ];
    const r = scenario([
      MK('driver', 'driver'),
      MK('mk', 'marketing'),
      KEEP('day', `select (current_date + 90)::text`),
      COURT('court'),
      COURT('court2'),
      // A guest's booking in the way on the first court.
      KEEP('booking', `insert into reservations (court_id, kind, status, start_at, end_at, guest_name, source, venue_id, created_by_staff_id)
                       values ({{court}}, 'booking', 'confirmed', ${AT('day', '19:00')}, ${AT('day', '20:00')},
                               'EV guest', 'desk', {{venue}}, {{desk}}) returning id::text`),
      T('start', 'manager', start('type1', plan({ courts: ['court', 'court2'], day: 'day' }))),
      RES('run', 'start', 'run_id'),
      STEPK('s_plan', 'run', 'plan'),
      STEPK('s_feas', 'run', 'feasibility'),
      STEPK('s_courts', 'run', 'courts'),
      STEPK('s_mkt', 'run', 'marketing'),
      T('early', 'desk', `select app.block_courts_for_event({{run}}, ${blocks(two)})`),
      T('feas', 'manager', `select app.submit_step({{s_feas}}, '{"staffing":"Two referees","income_iqd":400000,"cost_iqd":150000,"risks":"Rain"}')`),
      RES('sub_feas', 'feas', 'submission_id'),
      T('feas_ok', 'owner', `select app.decide_step({{sub_feas}}, 'approve')`),

      // The reads each role gets.
      T('feasibility', 'manager', `select app.tournament_feasibility({{run}})`),
      T('feasibility_desk', 'desk', `select app.tournament_feasibility({{run}})`),
      T('feasibility_driver', 'driver', `select app.tournament_feasibility({{run}})`),
      T('feasibility_mk', 'mk', `select app.tournament_feasibility({{run}})`),
      T('ctx_desk', 'desk', `select app.tournament_context({{s_courts}})`),
      T('ctx_mk', 'mk', `select app.tournament_context({{s_mkt}})`),
      T('ctx_owner_plan', 'owner', `select app.tournament_context({{s_plan}})`),
      T('ctx_mk_courts', 'mk', `select app.tournament_context({{s_courts}})`),
      T('ctx_desk_plan', 'desk', `select app.tournament_context({{s_plan}})`),
      T('ctx_cashier', 'cashier', `select app.tournament_context({{s_courts}})`),
      T('ctx_driver', 'driver', `select app.tournament_context({{s_courts}})`),
      T('ctx_nil', 'desk', `select app.tournament_context('00000000-0000-4000-8000-000000000000')`),

      // Refusals before anything is written.
      T('bad_range', 'desk', `select app.block_courts_for_event({{run}}, ${blocks([['court', 'day', '22:00', '18:00']])})`),
      T('bad_court', 'desk', `select app.block_courts_for_event({{run}}, jsonb_build_array(jsonb_build_object(
                                'court_id', gen_random_uuid(), 'start_at', now() + interval '1 day', 'end_at', now() + interval '2 days')))`),
      T('bad_shape', 'desk', `select app.block_courts_for_event({{run}}, '[]'::jsonb)`),
      T('overlap', 'desk', `select app.block_courts_for_event({{run}}, ${blocks([['court', 'day', '18:00', '20:00'], ['court', 'day', '19:00', '21:00']])})`),
      T('cashier_block', 'cashier', `select app.block_courts_for_event({{run}}, ${blocks(two)})`),
      T('driver_block', 'driver', `select app.block_courts_for_event({{run}}, ${blocks(two)})`),
      T('mk_block', 'mk', `select app.block_courts_for_event({{run}}, ${blocks(two)})`),
      T('nil_run', 'desk', `select app.block_courts_for_event('00000000-0000-4000-8000-000000000000', ${blocks(two)})`),

      // The booking is in the way: nothing is written.
      T('conflict', 'desk', `select app.block_courts_for_event({{run}}, ${blocks(two)}, 'ev:k1')`),
      Q('written_after_conflict', `select to_jsonb(count(*)) from reservations where protocol_run_id = {{run}}`),
      // The desk moves the booking a day on, through the normal path.
      Q('move', `update reservations set start_at = start_at + interval '1 day', end_at = end_at + interval '1 day'
                  where id = {{booking}} returning to_jsonb(id)`),
      T('blocked', 'desk', `select app.block_courts_for_event({{run}}, ${blocks(two)}, 'ev:k2')`),
      T('replay', 'desk', `select app.block_courts_for_event({{run}}, ${blocks(two)}, 'ev:k2')`),
      T('again', 'manager', `select app.block_courts_for_event({{run}}, ${blocks(two)}, 'ev:k3')`),
      Q('rows', `select jsonb_agg(jsonb_build_object('kind', kind, 'status', status, 'purpose', block_purpose,
                                                    'notes', notes, 'venue', venue_id, 'source', source,
                                                    'by', created_by_staff_id) order by court_id)
                   from reservations where protocol_run_id = {{run}}`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'reservation.event_block'
                    and entity_id in (select id::text from reservations where protocol_run_id = {{run}})`),
      T('ctx_after', 'desk', `select app.tournament_context({{s_courts}})`),
      Q('driver_rows', `select to_jsonb(count(*)) from reservations where protocol_run_id = {{run}}`),

      // The courts step takes the run's own live blocks only.
      T('courts_bad', 'desk', `select app.submit_step({{s_courts}}, jsonb_build_object('reservation_ids', jsonb_build_array({{booking}})))`),
      T('courts_dup', 'desk', `select app.submit_step({{s_courts}}, (select jsonb_build_object('reservation_ids',
                                  jsonb_build_array(min(id::text), min(id::text))) from reservations where protocol_run_id = {{run}}))`),
      T('courts', 'desk', `select app.submit_step({{s_courts}}, (select jsonb_build_object('reservation_ids', jsonb_agg(id),
                              'moved_note', 'Moved one booking a day on') from reservations where protocol_run_id = {{run}}))`),

      // A stop gives the courts back.
      T('stop', 'manager', `select app.stop_protocol({{run}}, 'Rained off')`),
      Q('after_stop', `select jsonb_agg(status order by court_id) from reservations where protocol_run_id = {{run}}`),
      Q('stop_audit', `select to_jsonb(count(*)) from audit_log where action = 'reservation.cancel'
                         and entity_id in (select id::text from reservations where protocol_run_id = {{run}})`),
    ]);

    expect(refused(r, 'early')).toBe('STEP_NOT_OPEN');
    expect(ok(r, 'feas_ok')).toMatchObject({ decision: 'approve' });

    // tournament_feasibility: the booking in the way, per court of the range.
    const feas = ok<{ ranges: Array<{ court_id: string; court_name_en: string; bookings: number; guests: number }> }>(r, 'feasibility');
    expect(feas.ranges).toHaveLength(2);
    expect(feas.ranges.map((x) => [x.court_name_en, x.bookings, x.guests])).toEqual([
      ['EV court', 1, 1],
      ['EV court2', 0, 0],
    ]);
    for (const who of ['feasibility_desk', 'feasibility_driver', 'feasibility_mk']) expect(refused(r, who), who).toBe('FORBIDDEN');

    // tournament_context: names, ranges and blocks, never money.
    const ctx = ok<Context>(r, 'ctx_desk');
    expect(ctx).toMatchObject({ name_en: 'Summer Cup', name_ar: 'كأس الصيف', class: 'A', format: 'americano' });
    expect(ctx.capacity).toEqual({ unit: 'pairs', count: 16 });
    expect(ctx.ranges).toHaveLength(1);
    expect(ctx.ranges[0]!.court_names).toEqual([
      { en: 'EV court', ar: 'ملعب court' },
      { en: 'EV court2', ar: 'ملعب court2' },
    ]);
    expect(ctx.blocked).toEqual([]);
    for (const label of ['ctx_desk', 'ctx_mk', 'ctx_owner_plan']) {
      const keys = keysOf(ok(r, label));
      expect(keys.filter((k) => /_iqd$|^(prize|budget|sponsor|income|cost|entry_fee|risks|notes)/.test(k)), label).toEqual([]);
    }
    for (const label of ['ctx_mk_courts', 'ctx_desk_plan', 'ctx_cashier', 'ctx_driver']) {
      expect(refused(r, label), label).toBe('NOT_STEP_ACTOR');
    }
    expect(refused(r, 'ctx_nil')).toBe('PROTOCOL_NOT_FOUND');

    expect(refused(r, 'bad_range')).toBe('BLOCK_RANGE_INVALID');
    expect(refused(r, 'bad_court')).toBe('COURT_NOT_FOUND');
    expect(refused(r, 'bad_shape')).toBe('INVALID_ARGUMENT:blocks');
    expect(refused(r, 'overlap')).toBe('INVALID_ARGUMENT:blocks');
    for (const who of ['cashier_block', 'driver_block', 'mk_block']) expect(refused(r, who), who).toBe('FORBIDDEN');
    expect(refused(r, 'nil_run')).toBe('PROTOCOL_NOT_FOUND');

    // The conflict: listed, nothing written.
    const conflict = ok<BlockResult>(r, 'conflict');
    expect(conflict.blocked).toEqual([]);
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.conflicts[0]).toMatchObject({ kind: 'booking', status: 'confirmed' });
    expect(ok(r, 'written_after_conflict')).toBe(0);

    // Moved: both blocks land; a replay returns the same answer, and a second
    // ask (new key) finds the same rows instead of writing them again.
    const blocked = ok<BlockResult>(r, 'blocked');
    expect(blocked.conflicts).toEqual([]);
    expect(blocked.blocked).toHaveLength(2);
    const replay = ok<BlockResult>(r, 'replay');
    expect(replay.duplicate).toBe(true);
    expect(replay.blocked.map((b) => b.reservation_id).sort()).toEqual(blocked.blocked.map((b) => b.reservation_id).sort());
    const again = ok<BlockResult>(r, 'again');
    expect(again.blocked.map((b) => b.reservation_id).sort()).toEqual(blocked.blocked.map((b) => b.reservation_id).sort());
    const rows = ok<Array<Record<string, unknown>>>(r, 'rows');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: 'maintenance', status: 'confirmed', purpose: 'event', notes: 'Summer Cup',
        venue: VENUE_A_ID, source: 'desk', by: SEED_STAFF_IDS.court_desk,
      });
    }
    expect(ok(r, 'audit')).toBe(2);
    expect(ok<Context>(r, 'ctx_after').blocked).toHaveLength(2);

    expect(refused(r, 'courts_bad')).toBe('RECORD_INVALID:reservation_ids');
    expect(refused(r, 'courts_dup')).toBe('RECORD_INVALID:reservation_ids');
    expect(ok(r, 'courts')).toMatchObject({ auto: false, step_status: 'submitted' });

    // The stop cancels the blocks that have not started.
    expect(ok(r, 'stop')).toEqual({ run_status: 'stopped' });
    expect(ok(r, 'after_stop')).toEqual(['cancelled', 'cancelled']);
    expect(ok(r, 'stop_audit')).toBe(2);
  });

  it('a plan sent back and moved gives back its old blocks; the courts step counts only the passed plan’s', () => {
    const live = `(select jsonb_build_object('reservation_ids', coalesce(jsonb_agg(id), '[]'::jsonb)) from reservations
                    where protocol_run_id = {{run}} and status in ('pending', 'confirmed', 'arrived'))`;
    const r = scenario([
      KEEP('day', `select (current_date + 95)::text`),
      KEEP('day2', `select (current_date + 96)::text`),
      COURT('court'),
      // Type 2: the manager's plan passes at once and the courts step opens.
      T('start', 'manager', start('type2', plan({ courts: ['court'], day: 'day', variant: 'type2' }))),
      RES('run', 'start', 'run_id'),
      STEPK('s_plan', 'run', 'plan'),
      STEPK('s_courts', 'run', 'courts'),
      T('block1', 'desk', `select app.block_courts_for_event({{run}}, ${blocks([['court', 'day', '18:00', '22:00']])})`),
      RES('old', 'block1', 'blocked,0,reservation_id'),
      T('courts1', 'desk', `select app.submit_step({{s_courts}}, ${live})`),
      LIVE_SUB('sub_c1', 's_courts'),
      // Moved a day on: the day-one block goes back to guests.
      T('back1', 'manager', `select app.decide_step({{sub_c1}}, 'send_back', 'A day later', {{s_plan}}::uuid)`),
      T('plan2', 'manager', `select app.submit_step({{s_plan}}, ${plan({ courts: ['court'], day: 'day2', variant: 'type2' })})`),
      Q('after_move', `select jsonb_agg(jsonb_build_object('status', status, 'reason', cancellation_reason)) from reservations
                         where protocol_run_id = {{run}}`),
      T('ctx_moved', 'desk', `select app.tournament_context({{s_courts}})`),
      T('courts_old', 'desk', `select app.submit_step({{s_courts}}, jsonb_build_object('reservation_ids', jsonb_build_array({{old}})))`),
      T('block2', 'desk', `select app.block_courts_for_event({{run}}, ${blocks([['court', 'day2', '18:00', '22:00']])})`),
      T('courts2', 'desk', `select app.submit_step({{s_courts}}, ${live})`),
      LIVE_SUB('sub_c2', 's_courts'),
      // An hour earlier on the same day: the plan's pass frees 18–22, so the
      // desk blocks 17–21 with no conflict against the run's own block.
      T('back2', 'manager', `select app.decide_step({{sub_c2}}, 'send_back', 'An hour earlier', {{s_plan}}::uuid)`),
      T('plan3', 'manager', `select app.submit_step({{s_plan}}, ${plan({ courts: ['court'], day: 'day2', from: '17:00', to: '21:00', variant: 'type2' })})`),
      T('block3', 'desk', `select app.block_courts_for_event({{run}}, ${blocks([['court', 'day2', '17:00', '21:00']])})`),
      T('courts3', 'desk', `select app.submit_step({{s_courts}}, ${live})`),
      Q('final', `select jsonb_agg(jsonb_build_object('status', status,
                                                     'from', to_char(start_at at time zone {{tz}}, 'MM-DD HH24:MI'))
                                   order by start_at)
                    from reservations where protocol_run_id = {{run}}`),
      Q('cancel_audit', `select to_jsonb(count(*)) from audit_log where action = 'reservation.cancel'
                           and entity_id in (select id::text from reservations where protocol_run_id = {{run}})`),
      Q('d1', `select to_jsonb(to_char({{day}}::date, 'MM-DD'))`),
      Q('d2', `select to_jsonb(to_char({{day2}}::date, 'MM-DD'))`),
    ]);

    ok(r, 'block1');
    expect(ok(r, 'courts1')).toMatchObject({ step_status: 'submitted' });
    expect(ok(r, 'back1')).toMatchObject({ decision: 'send_back' });
    expect(ok(r, 'plan2')).toMatchObject({ auto: true });
    expect(ok(r, 'after_move')).toEqual([{ status: 'cancelled', reason: 'Tournament moved' }]);
    expect(ok<Context>(r, 'ctx_moved').blocked).toEqual([]);
    expect(refused(r, 'courts_old')).toBe('RECORD_INVALID:reservation_ids');
    expect(ok<BlockResult>(r, 'block2').blocked).toHaveLength(1);
    ok(r, 'courts2');
    ok(r, 'back2');
    ok(r, 'plan3');
    const shifted = ok<BlockResult>(r, 'block3');
    expect(shifted.conflicts).toEqual([]);
    expect(shifted.blocked).toHaveLength(1);
    expect(ok(r, 'courts3')).toMatchObject({ step_status: 'submitted' });
    const d1 = ok<string>(r, 'd1');
    const d2 = ok<string>(r, 'd2');
    expect(ok(r, 'final')).toEqual([
      { status: 'cancelled', from: `${d1} 18:00` },
      { status: 'confirmed', from: `${d2} 17:00` },
      { status: 'cancelled', from: `${d2} 18:00` },
    ]);
    expect(ok(r, 'cancel_audit')).toBe(2);
  });

  it('event minutes stay open capacity and appear in all three outputs; maintenance is still closed time', () => {
    const r = scenario([
      MK('driver', 'driver'),
      MK('mk', 'marketing'),
      KEEP('day', `select (current_date + 120)::text`),
      COURT('court'),
      T('before', 'owner', `select app.analytics_courts_summary({{day}}::date, {{day}}::date, {{court}}::uuid)`),
      T('before_cafe', 'owner', `select app.analytics_courts_cafe({{day}}::date, {{day}}::date, {{court}}::uuid)`),
      T('before_report', 'manager', `select app.report_courts({{day}}::date, {{day}}::date, jsonb_build_object('courtId', {{court}}))`),
      // Two hours given to a tournament, one hour of plain maintenance.
      Q('event', `insert into reservations (court_id, kind, status, start_at, end_at, source, venue_id, block_purpose, notes)
                  values ({{court}}, 'maintenance', 'confirmed', ${AT('day', '18:00')}, ${AT('day', '20:00')},
                          'desk', {{venue}}, 'event', 'Summer Cup') returning to_jsonb(id)`),
      Q('maint', `insert into reservations (court_id, kind, status, start_at, end_at, source, venue_id, notes)
                  values ({{court}}, 'maintenance', 'confirmed', ${AT('day', '12:00')}, ${AT('day', '13:00')},
                          'desk', {{venue}}, 'Net repair') returning to_jsonb(id)`),
      T('after', 'owner', `select app.analytics_courts_summary({{day}}::date, {{day}}::date, {{court}}::uuid)`),
      T('after_all', 'owner', `select app.analytics_courts_summary({{day}}::date, {{day}}::date)`),
      T('after_cafe', 'owner', `select app.analytics_courts_cafe({{day}}::date, {{day}}::date, {{court}}::uuid)`),
      T('after_report', 'manager', `select app.report_courts({{day}}::date, {{day}}::date, jsonb_build_object('courtId', {{court}}))`),
      Q('helper', `select jsonb_build_object('open', sum(open_minutes), 'events', sum(event_minutes))
                     from app.analytics_open_minutes(${AT('day', '04:00')}, ${AT('day', '04:00')} + interval '1 day',
                                                     {{tz}}, 4, {{court}}::uuid)`),
      T('helper_client', 'owner', `select to_jsonb(count(*)) from app.analytics_open_minutes(now(), now() + interval '1 day', 'Asia/Baghdad', 4, null)`),
      T('driver_summary', 'driver', `select app.analytics_courts_summary({{day}}::date, {{day}}::date)`),
      T('mk_summary', 'mk', `select app.analytics_courts_summary({{day}}::date, {{day}}::date)`),
      T('driver_report', 'driver', `select app.report_courts({{day}}::date, {{day}}::date)`),
      T('mk_report', 'mk', `select app.report_courts({{day}}::date, {{day}}::date)`),
      T('mk_cafe', 'mk', `select app.analytics_courts_cafe({{day}}::date, {{day}}::date)`),
    ]);

    type Summary = { open_minutes: number; event_minutes: number; kpis: Record<string, unknown>; per_court: Array<{ open_minutes: number }> };
    const before = ok<Summary>(r, 'before');
    const after = ok<Summary>(r, 'after');
    expect(before.event_minutes).toBe(0);
    expect(before.open_minutes).toBeGreaterThan(180);
    // The event hours stay open time; only the maintenance hour closes the court.
    expect(after.open_minutes).toBe(before.open_minutes - 60);
    expect(after.event_minutes).toBe(120);
    expect(after.per_court[0]!.open_minutes).toBe(after.open_minutes);
    expect(ok<Summary>(r, 'after_all').event_minutes).toBeGreaterThanOrEqual(120);
    expect(ok(r, 'helper')).toEqual({ open: before.open_minutes - 60, events: 120 });
    expect(refused(r, 'helper_client')).toMatch(/permission denied/);

    type Cafe = { event_minutes: number; attach: { open_minutes: number } };
    expect(ok<Cafe>(r, 'before_cafe').event_minutes).toBe(0);
    expect(ok<Cafe>(r, 'after_cafe').event_minutes).toBe(120);
    expect(ok<Cafe>(r, 'after_cafe').attach.open_minutes).toBe(ok<Cafe>(r, 'before_cafe').attach.open_minutes - 60);

    type Report = {
      columns: Array<{ key: string }>;
      rows: Array<{ availableMinutes: number; eventMinutes: number }>;
      totals: { availableMinutes: number; eventMinutes: number };
    };
    const rb = ok<Report>(r, 'before_report');
    const ra = ok<Report>(r, 'after_report');
    expect(rb.rows[0]!.eventMinutes).toBe(0);
    expect(ra.rows[0]).toMatchObject({ availableMinutes: rb.rows[0]!.availableMinutes - 60, eventMinutes: 120 });
    expect(ra.totals).toMatchObject({ availableMinutes: rb.totals.availableMinutes - 60, eventMinutes: 120 });
    const keys = ra.columns.map((c) => c.key);
    expect(keys.indexOf('eventMinutes')).toBe(keys.indexOf('availableMinutes') + 1);

    for (const label of ['driver_summary', 'mk_summary', 'driver_report', 'mk_report', 'mk_cafe']) {
      expect(refused(r, label), label).toBe('FORBIDDEN');
    }
  });

  it('the plan check: the three variants, the sponsor, the ranges, and the other steps’ records', () => {
    const t1 = (extra: string) => start('type1', plan({ courts: ['court'], day: 'day', extra }));
    const r = scenario([
      MK('mk', 'marketing'),
      MK('driver', 'driver'),
      KEEP('day', `select (current_date + 100)::text`),
      COURT('court'),
      COURT('off', false),
      T('t3_nosponsor', 'manager', start('type3', plan({ courts: ['court'], day: 'day', variant: 'type3' }))),
      T('t3', 'manager', start('type3', plan({ courts: ['court'], day: 'day', variant: 'type3', sponsor: true }))),
      RES('run3', 't3', 'run_id'),
      Q('t3_data', `select data from protocol_runs where id = {{run3}}`),
      T('t2_format', 'manager', start('type2', plan({ courts: ['court'], day: 'day', variant: 'type2', extra: ` || '{"format":"league"}'::jsonb` }))),
      T('t2', 'manager', start('type2', plan({ courts: ['court'], day: 'day', variant: 'type2' }))),
      T('t2_null_format', 'manager', start('type2', plan({ courts: ['court'], day: 'day', variant: 'type2', extra: ` || '{"format":null}'::jsonb` }))),
      T('t1_no_format', 'manager', start('type1', `(${plan({ courts: ['court'], day: 'day' })} - 'format')`)),
      T('bad_class', 'manager', t1(` || '{"class":"D"}'::jsonb`)),
      T('bad_order', 'manager', start('type1', plan({ courts: ['court'], day: 'day', from: '22:00', to: '18:00' }))),
      T('bad_court', 'manager', t1(` || jsonb_build_object('ranges', jsonb_build_array(jsonb_build_object('court_ids',
                                   jsonb_build_array(gen_random_uuid()), 'from', now() + interval '1 day', 'to', now() + interval '2 days')))`)),
      T('off_court', 'manager', start('type1', plan({ courts: ['off'], day: 'day' }))),
      T('dup_court', 'manager', start('type1', plan({ courts: ['court', 'court'], day: 'day' }))),
      T('no_ranges', 'manager', t1(` || '{"ranges":[]}'::jsonb`)),
      T('bad_capacity', 'manager', t1(` || '{"capacity":{"unit":"pairs","count":1}}'::jsonb`)),
      T('long_name', 'manager', t1(` || jsonb_build_object('name_en', repeat('a', 81))`)),
      T('no_name', 'manager', t1(` || '{"name_ar":"  "}'::jsonb`)),
      T('bad_fee', 'manager', t1(` || '{"entry_fee_iqd":-5}'::jsonb`)),
      T('frac_fee', 'manager', t1(` || '{"entry_fee_iqd":2.5}'::jsonb`)),
      T('bad_sponsor', 'manager', start('type3', `(${plan({ courts: ['court'], day: 'day', variant: 'type3' })} || '{"sponsor":{"contact":"x","contribution_iqd":1}}'::jsonb)`)),
      T('stray', 'manager', t1(` || '{"wifi_password":"hunter2"}'::jsonb`)),
      T('data', 'manager', `select app.start_protocol('tournament', 'type1', 'x', null, '{"x":1}', ${plan({ courts: ['court'], day: 'day' })})`),
      T('mk_start', 'mk', start('type1', plan({ courts: ['court'], day: 'day' }))),
      T('driver_start', 'driver', start('type1', plan({ courts: ['court'], day: 'day' }))),

      // The type 3 run: feasibility and marketing records.
      STEPK('s_feas', 'run3', 'feasibility'),
      STEPK('s_mkt', 'run3', 'marketing'),
      T('feas_neg', 'manager', `select app.submit_step({{s_feas}}, '{"staffing":"x","income_iqd":-1,"cost_iqd":0,"risks":"x"}')`),
      T('feas_no_risks', 'manager', `select app.submit_step({{s_feas}}, '{"staffing":"x","income_iqd":1,"cost_iqd":0}')`),
      T('feas', 'manager', `select app.submit_step({{s_feas}}, '{"staffing":"Two referees","income_iqd":900000,"cost_iqd":200000,"risks":"Rain","notes":null}')`),
      RES('sub_feas', 'feas', 'submission_id'),
      T('feas_ok', 'owner', `select app.decide_step({{sub_feas}}, 'approve')`),
      T('mkt_long', 'mk', `select app.submit_step({{s_mkt}}, jsonb_build_object('highlights_en', repeat('a', 301), 'highlights_ar', 'x'))`),
      T('mkt_campaign', 'mk', `select app.submit_step({{s_mkt}}, jsonb_build_object('highlights_en', 'x', 'highlights_ar', 'x', 'campaign_id', gen_random_uuid()))`),
      T('mkt_hero', 'mk', `select app.submit_step({{s_mkt}}, '{"highlights_en":"x","highlights_ar":"x","hero":{"en":"Cup night"}}')`),
      T('mkt', 'mk', `select app.submit_step({{s_mkt}}, '{"highlights_en":"Sixteen pairs","highlights_ar":"ستة عشر زوجاً","hero":{"en":"Cup night","ar":"ليلة الكأس"},"notes":"Posters at the desk"}')`),
      LIVE_SUB('sub_mkt', 's_mkt'),
      Q('mkt_record', `select record from protocol_submissions where id = {{sub_mkt}}`),
    ]);

    expect(refused(r, 't3_nosponsor')).toBe('SPONSOR_DETAILS_REQUIRED:sponsor');
    expect(ok(r, 't3')).toMatchObject({ auto: true, status: 'active' });
    const data = ok<Record<string, unknown>>(r, 't3_data');
    expect(data).toMatchObject({
      class: 'A', name_en: 'Summer Cup', format: 'americano', entry_fee_iqd: 25000, budget_iqd: 300000,
      prize: { text: 'Trophy', iqd: 500000 }, capacity: { unit: 'pairs', count: 16 },
      sponsor: { name: 'Acme', contact: '0770 000 0000', contribution_iqd: 1000000 },
    });
    // The ranges come back as instants, the courts as ids.
    const range = (data.ranges as Array<{ from: string; to: string; court_ids: string[] }>)[0]!;
    expect(Date.parse(range.to) - Date.parse(range.from)).toBe(4 * 3600_000);
    expect(range.court_ids).toHaveLength(1);

    expect(refused(r, 't2_format')).toBe('RECORD_INVALID:format');
    expect(ok(r, 't2')).toMatchObject({ auto: true });
    expect(ok(r, 't2_null_format')).toMatchObject({ auto: true });
    expect(refused(r, 't1_no_format')).toBe('RECORD_INVALID:format');
    expect(refused(r, 'bad_class')).toBe('RECORD_INVALID:class');
    for (const label of ['bad_order', 'bad_court', 'off_court', 'dup_court', 'no_ranges']) {
      expect(refused(r, label), label).toBe('RECORD_INVALID:ranges');
    }
    expect(refused(r, 'bad_capacity')).toBe('RECORD_INVALID:capacity');
    expect(refused(r, 'long_name')).toBe('TEXT_TOO_LONG:name_en');
    expect(refused(r, 'no_name')).toBe('RECORD_INVALID:name_ar');
    expect(refused(r, 'bad_fee')).toBe('RECORD_INVALID:entry_fee_iqd');
    expect(refused(r, 'frac_fee')).toBe('RECORD_INVALID:entry_fee_iqd');
    expect(refused(r, 'bad_sponsor')).toBe('RECORD_INVALID:sponsor.name');
    expect(refused(r, 'stray')).toBe('RECORD_INVALID:wifi_password');
    expect(refused(r, 'data')).toBe('RECORD_INVALID:data');
    expect(refused(r, 'mk_start')).toBe('FORBIDDEN');
    expect(refused(r, 'driver_start')).toBe('FORBIDDEN');

    expect(refused(r, 'feas_neg')).toBe('RECORD_INVALID:income_iqd');
    expect(refused(r, 'feas_no_risks')).toBe('RECORD_INVALID:risks');
    expect(ok(r, 'feas')).toMatchObject({ auto: false });
    expect(refused(r, 'mkt_long')).toBe('TEXT_TOO_LONG:highlights_en');
    expect(refused(r, 'mkt_campaign')).toBe('RECORD_INVALID:campaign_id');
    expect(refused(r, 'mkt_hero')).toBe('RECORD_INVALID:hero.ar');
    expect(ok(r, 'mkt')).toMatchObject({ auto: false, step_status: 'submitted' });
    expect(ok(r, 'mkt_record')).toEqual({
      highlights_en: 'Sixteen pairs', highlights_ar: 'ستة عشر زوجاً',
      hero: { en: 'Cup night', ar: 'ليلة الكأس' }, notes: 'Posters at the desk',
    });
  });
});
