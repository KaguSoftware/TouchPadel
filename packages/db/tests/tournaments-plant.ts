/**
 * The tournaments plant (docs/design/tournaments/build-contracts-2026-10-03.md; plan §7, DB-A): the
 * ONE planting module of the tournament suites (tournaments-schema, -money, -play, -lifecycle,
 * lock-order-tournaments, tournament-rounds .test.ts).
 *
 * Every case is one rolled-back psql transaction (stores-harness `scenario`), loading `TOUR_SETUP`
 * first: the open-match harness (matches-harness SETUP: its branch, guests who may play, planted
 * matches) plus what a tournament needs on top of it:
 *
 * - `pg_temp.tbranch()`: SETUP's branch with four courts (c1..c4), tournaments switched on, the
 *   seeded desk, cashier and manager working there, and its protocol templates.
 * - `pg_temp.run(name, p)`: a protocol run of kind tournament planted as postgres in the state the
 *   protocol leaves it (no RPC reaches `done` from here in one step): the plan as the run's data,
 *   a passed feasibility step that needs the owner's OK and holds the owner's approval, and the
 *   desk's live event blocks on every court of the plan's one range. `p` overrides: variant
 *   (type1), format (americano), fee (0), unit, count (16), courts (c1..c4), owner_ok (true),
 *   status (done), days (3: the range opens at 15:00 UTC three days on, for 4 hours), blocks
 *   (true).
 * - `pg_temp.field(tour, n, prefix)`: n guests (prefix1..prefixN) registered in the tournament in
 *   order, planted as postgres (entries prefix1_e..prefixN_e).
 * - `pg_temp.close(tour)`: what the sweep's cut-off does for a tournament with enough entries
 *   (closed, seeds 1..N by entered_at), without running the sweep over the whole database.
 * - `pg_temp.simple_rounds(tour, from, n)`: a valid §1.10 payload (no fairness: a rotation of the
 *   seeded list, groups of four on the lowest courts, the rest sitting out).
 * - `pg_temp.score_round(tour, round, points_a)`: every unscored match of a round scored through
 *   app.tournament_score as the desk, points_a against points_target - points_a.
 * - `pg_temp.day(name)`: an open day at the branch.
 *
 * Planted rows are written as postgres with the JWT claims cleared (0230: a fixture write, not a
 * staff write); every RPC under test runs as `authenticated` with the caller's claims (`T`).
 */
import { expect } from 'vitest';
import { SETUP } from './matches-harness';
import { KEEP, T, type Results } from './stores-harness';

export const TOUR_SETUP =
  SETUP +
  String.raw`
create function pg_temp.tbranch() returns void language plpgsql as $f$
declare v uuid; c3 uuid; c4 uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.branch();
  v := pg_temp.var('v')::uuid;
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (v, 'M260 court 3', 'ملعب ٣', '{60,90,120}', 3, true) returning id into c3;
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (v, 'M260 court 4', 'ملعب ٤', '{60,90,120}', 4, true) returning id into c4;
  insert into pg_temp.vars values ('c3', c3::text), ('c4', c4::text);
  update venue_settings set tournaments_enabled = true where venue_id = v;
  insert into staff_venues (staff_id, venue_id, role)
  select s.id, v, s.role
    from staff s
   where s.id in (pg_temp.var('desk')::uuid, pg_temp.var('cashier')::uuid, pg_temp.var('manager')::uuid)
  on conflict do nothing;
  insert into protocol_templates (venue_id, kind, variant, name_en, name_ar, version)
  select v, 'tournament', x, 'Tournament ' || x, 'بطولة ' || x, 1
    from unnest(array['type1', 'type2', 'type3']) x;
end $f$;

create function pg_temp.run(p_name text, p jsonb default '{}') returns uuid language plpgsql as $f$
declare
  v        uuid := pg_temp.var('v')::uuid;
  v_var    text := coalesce(p->>'variant', 'type1');
  v_from   timestamptz := date_trunc('day', now()) + make_interval(days => coalesce((p->>'days')::int, 3), hours => 15);
  v_to     timestamptz := v_from + interval '4 hours';
  v_courts uuid[];
  v_data   jsonb;
  v_status text := coalesce(p->>'status', 'done');
  v_run    uuid;
  v_step   uuid;
  v_c      uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  v_courts := array(select pg_temp.var(x)::uuid
                      from jsonb_array_elements_text(coalesce(p->'courts', '["c1","c2","c3","c4"]')) x);
  v_data := jsonb_build_object(
    'class', 'A', 'name_en', 'Summer Cup', 'name_ar', 'كأس الصيف',
    'ranges', jsonb_build_array(jsonb_build_object('court_ids', to_jsonb(v_courts), 'from', v_from, 'to', v_to)),
    'capacity', jsonb_build_object('unit', coalesce(p->>'unit', 'player' || 's'),
                                   'count', coalesce((p->>'count')::int, 16)));
  if v_var <> 'type2' then
    v_data := v_data || jsonb_build_object('format', coalesce(p->>'format', 'americano'),
                                           'entry_fee_iqd', coalesce((p->>'fee')::bigint, 0));
  end if;
  insert into protocol_runs (venue_id, template_id, template_version, kind, variant, title_en, status,
                             started_by, finished_at, data)
  values (v, (select t.id from protocol_templates t where t.venue_id = v and t.kind = 'tournament'
                                                     and t.variant = v_var),
          1, 'tournament', v_var, 'Summer cup', v_status, pg_temp.var('manager')::uuid,
          case when v_status in ('done', 'stopped', 'withdrawn') then now() end, v_data)
  returning id into v_run;
  if v_var <> 'type2' then
    insert into protocol_run_steps (run_id, position, step_key, name_en, name_ar, actor_roles, needs_owner_ok,
                                    optional, status, round, opened_at, passed_at)
    values (v_run, 2, 'feasibility', 'Feasibility', 'الجدوى', '{manager}', true, false, 'passed', 1, now(), now())
    returning id into v_step;
    insert into protocol_submissions (run_step_id, run_id, round, submitted_by, record, decided_by, decided_at,
                                      decision)
    values (v_step, v_run, 1, pg_temp.var('manager')::uuid, '{}'::jsonb,
            case when coalesce((p->>'owner_ok')::boolean, true) then pg_temp.var('owner')::uuid
                 else pg_temp.var('desk')::uuid end,
            now(), 'approve');
  end if;
  if coalesce((p->>'blocks')::boolean, true) then
    foreach v_c in array v_courts loop
      insert into reservations (court_id, kind, status, start_at, end_at, created_by_staff_id, source, notes,
                                venue_id, block_purpose, protocol_run_id)
      values (v_c, 'maintenance', 'confirmed', v_from, v_to, pg_temp.var('desk')::uuid, 'desk', 'Summer Cup',
              v, 'event', v_run);
    end loop;
  end if;
  insert into pg_temp.vars values (p_name, v_run::text), (p_name || '_from', v_from::text), (p_name || '_to', v_to::text)
  on conflict (name) do update set val = excluded.val;
  return v_run;
end $f$;

create function pg_temp.field(p_tour text, n int, p_prefix text) returns void language plpgsql as $f$
declare i int; g uuid; e uuid; t tournaments%rowtype;
begin
  perform set_config('request.jwt.claims', '', true);
  select * into t from tournaments where id = pg_temp.var(p_tour)::uuid;
  for i in 1 .. n loop
    g := pg_temp.guest(p_prefix || i, jsonb_build_object('given', 'Player' || i, 'family', 'Fam' || i,
                                                         'gender', 'male'));
    insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind, entered_at)
    values (t.venue_id, t.id, g, 'registered', 'guest', clock_timestamp())
    returning id into e;
    insert into pg_temp.vars values (p_prefix || i || '_e', e::text) on conflict (name) do update set val = excluded.val;
  end loop;
end $f$;

create function pg_temp.close(p_tour text) returns void language plpgsql as $f$
declare v_t uuid := pg_temp.var(p_tour)::uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  update tournaments set status = 'closed', closed_at = now() where id = v_t;
  update tournament_entries e set seed_no = s.n
    from (select x.id, row_number() over (order by x.entered_at, x.id) as n
            from tournament_entries x where x.tournament_id = v_t and x.status = 'registered') s
   where e.id = s.id;
end $f$;

create function pg_temp.simple_rounds(p_tour text, p_from int, p_n int) returns jsonb language plpgsql as $f$
declare
  v_t      tournaments%rowtype;
  v_ids    uuid[];
  v_courts uuid[];
  v_c      int;
  v_k      int;
  v_ord    uuid[];
  v_rounds jsonb := '[]'::jsonb;
  v_m      jsonb;
  j        int;
  n        int;
begin
  select * into v_t from tournaments where id = pg_temp.var(p_tour)::uuid;
  v_ids := array(select e.id from tournament_entries e where e.tournament_id = v_t.id and e.status = 'registered'
                  order by e.seed_no nulls last, e.entered_at, e.id);
  v_courts := array(select c.id from courts c
                     where c.id in (select r.court_id from reservations r
                                     where r.protocol_run_id = v_t.protocol_run_id and r.block_purpose = 'event'
                                       and r.status in ('pending', 'confirmed', 'arrived'))
                     order by c.sort_order, c.id);
  n := cardinality(v_ids);
  v_c := least(cardinality(v_courts), n / 4);
  for v_k in p_from .. p_from + p_n - 1 loop
    v_ord := array(select v_ids[1 + ((i - 1 + v_k - 1) % n)] from generate_series(1, n) i);
    v_m := '[]'::jsonb;
    for j in 1 .. v_c loop
      v_m := v_m || jsonb_build_array(jsonb_build_object(
        'court_id', v_courts[j],
        'a', jsonb_build_array(v_ord[4 * j - 3], v_ord[4 * j - 2]),
        'b', jsonb_build_array(v_ord[4 * j - 1], v_ord[4 * j])));
    end loop;
    v_rounds := v_rounds || jsonb_build_array(jsonb_build_object(
      'round_no', v_k, 'matches', v_m, 'sit_out', to_jsonb(v_ord[4 * v_c + 1 : n])));
  end loop;
  return jsonb_build_object('engine', 'tp-tour-1', 'format', v_t.format, 'based_on_revision', v_t.revision,
                            'from_round', p_from, 'rounds', v_rounds);
end $f$;

create function pg_temp.score_round(p_tour text, p_round int, p_a int) returns int language plpgsql as $f$
declare v_t tournaments%rowtype; m record; n int := 0;
begin
  select * into v_t from tournaments where id = pg_temp.var(p_tour)::uuid;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.var('desk'), 'role', 'authenticated')::text, true);
  for m in select x.id, x.revision from tournament_matches x
            where x.tournament_id = v_t.id and x.round_no = p_round and x.points_a is null
            order by x.court_id loop
    perform app.tournament_score(m.id, p_a::smallint, (v_t.points_target - p_a)::smallint, m.revision, null);
    n := n + 1;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return n;
end $f$;

create function pg_temp.day(p_name text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
  values (pg_temp.var('v')::uuid, app.venue_business_date(pg_temp.var('v')::uuid, now()), 'open',
          pg_temp.var('manager')::uuid, 0)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;
`;

/** The branch (see `pg_temp.tbranch`). */
export const TOUR_BRANCH = [`select pg_temp.tbranch();`];

/** A run planted done (see `pg_temp.run`); `p` is its JSON overrides. */
export const RUN = (name: string, p: Record<string, unknown> = {}) =>
  `select pg_temp.run('${name}', '${JSON.stringify(p)}'::jsonb);`;

/** registration_closes_at one hour before the run's range opens (a valid cut-off). */
export const CLOSES = (run: string) => `((({{${run}_from}})::timestamptz) - interval '1 hour')`;

/** Settings for a publish, as SQL: the JSON `s` plus the cut-off of `run`. */
export const SETTINGS = (run: string, s: Record<string, unknown> = {}) =>
  `('${JSON.stringify(s)}'::jsonb || jsonb_build_object('registration_closes_at', ${CLOSES(run)}))`;

let keySeq = 0;
/** A fresh idempotency key. */
export const KEY = (tag: string) =>
  `'${tag}-${Date.now().toString(36)}-${(keySeq++).toString(36)}'`;

/** Publish `run` as the manager, keep the tournament id as `tour`. */
export const PUBLISH = (
  label: string,
  run: string,
  tour: string,
  s: Record<string, unknown> = {},
) => [
  T(
    label,
    'manager',
    `select app.tournament_publish({{${run}}}, ${SETTINGS(run, s)}, ${KEY(label)})`,
  ),
  KEEP(tour, `select res #>> '{data,tournament_id}' from pg_temp.out where label = '${label}'`),
];

/** set_rounds as `who` with pg_temp.simple_rounds (built as postgres: the caller reads no table). */
export const ROUNDS = (label: string, tour: string, from: number, n: number, who = 'desk') => [
  KEEP(`${label}_p`, `select pg_temp.simple_rounds('${tour}', ${from}, ${n})::text`),
  T(
    label,
    who,
    `select app.tournament_set_rounds({{${tour}}}, {{${label}_p}}::jsonb, ${KEY(label)})`,
  ),
];

/** A refusal as CODE, or CODE:detail when the raise carried one (§1.9 details ride `detail`). */
export function refusal(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail: ${JSON.stringify(o!.data)}`).toBe(false);
  return o!.detail ? `${o!.code}:${o!.detail}` : o!.code!;
}

/** The answer of a call that must succeed. */
export function answer<T = Record<string, unknown>>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as T;
}
