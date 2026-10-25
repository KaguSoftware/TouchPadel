/**
 * The fixture of the customers lane (0368 customer_facts, 0369 customer_analytics;
 * docs/design/customers/contracts-2026-10-24.md). Both suites run one rolled-back psql
 * transaction per case through stores-harness, on top of the open-matches SETUP.
 */
import { expect } from 'vitest';
import { SETUP } from './matches-harness';
import { KEEP, Q, X, type Results } from './stores-harness';

/**
 * On top of SETUP: a court desk and a court of this run's own, a coach whose account is a guest,
 * and two makers — cf_bk (a confirmed one-hour booking at a given hour of the branch's day) and
 * cf_gr (a confirmed desk game result, N days ago, between four named players).
 */
export const CF = String.raw`
insert into pg_temp.vars values ('_cf', substr(md5(random()::text), 1, 5));
select pg_temp.mk('cf_desk', 'court_desk');
update pg_temp.vars set val = (select v.val from pg_temp.vars v where v.name = 'cf_desk') where name = 'desk';

create function pg_temp.cf_court() returns void language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (pg_temp.var('venue')::uuid, 'CF court ' || pg_temp.var('_cf'), 'ملعب العملاء', '{60,90,120}', 991, true)
  returning id into v;
  insert into pg_temp.vars values ('court', v::text);
end $f$;

-- A guest, kept under its name, with a claimed level, an age band and a gender.
-- p_gender '-' leaves the harness default (female); 'none' clears it, so a guest
-- the club knows nothing about can be built too.
create function pg_temp.cf_guest(p_name text, p_level text default null, p_band text default null,
                                 p_gender text default '-')
returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  v := pg_temp.guest(p_name);
  update profiles
     set play_level      = p_level,
         play_survey_at  = case when p_level is null then null else now() end,
         age_band        = p_band,
         age_band_set_at = case when p_band is null then null else now() end,
         gender          = case p_gender when '-' then gender when 'none' then null else p_gender end,
         gender_set_at   = case p_gender when '-' then gender_set_at when 'none' then null else now() end,
         gender_set_by   = case p_gender when '-' then gender_set_by when 'none' then null else 'guest' end
   where id = v;
  return v;
end $f$;

-- The caller's own coaches row (a coach is a guest account, not staff).
create function pg_temp.cf_coach(p_guest text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into coaches (profile_id, display_name_en, display_name_ar)
  values (pg_temp.var(p_guest)::uuid, 'CF coach ' || pg_temp.var('_cf'), 'مدرّب العملاء');
end $f$;

-- A confirmed booking of <guest> on the p_dow (0 Sunday .. 6 Saturday) of the week p_weeks_ago,
-- at p_hour branch time. The weekday is explicit so the day-part and weekend words are judged on
-- the same days whatever day the suite runs.
create function pg_temp.cf_bk(p_guest text, p_weeks_ago int, p_hour int, p_dow int default 3)
returns void language plpgsql as $f$
declare v_date date; v_at timestamptz;
begin
  perform set_config('request.jwt.claims', '', true);
  v_date := current_date - make_interval(weeks => p_weeks_ago);
  v_date := v_date - ((extract(dow from v_date)::int - p_dow + 7) % 7);
  v_at   := (v_date::timestamp + make_interval(hours => p_hour)) at time zone 'Asia/Baghdad';
  perform pg_temp.res('court', v_at, 60, 'booking', 'confirmed', p_guest);
end $f$;

-- One confirmed desk result: side A (a1, a2) against side B (b1, b2), p_days_ago days back.
create function pg_temp.cf_gr(p_a1 text, p_a2 text, p_b1 text, p_b2 text, p_winner text, p_days_ago int)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into game_results (venue_id, source, status, a1, a2, b1, b2, winner, played_at, reported_by,
                            decided_by, decided_at)
  values (pg_temp.var('venue')::uuid, 'desk', 'confirmed',
          pg_temp.var(p_a1)::uuid, pg_temp.var(p_a2)::uuid, pg_temp.var(p_b1)::uuid, pg_temp.var(p_b2)::uuid,
          p_winner, now() - make_interval(days => p_days_ago), pg_temp.var('desk')::uuid,
          pg_temp.var('desk')::uuid, now())
  returning id into v;
  return v;
end $f$;

-- The seven 0368 columns of a kept profile, as the tombstone and the merge are judged on.
create function pg_temp.cf_facts(p_who text) returns jsonb language sql as $f$
  select jsonb_build_object('band', p.age_band, 'band_at', p.age_band_set_at is not null,
                            'claimed', p.play_level, 'confirmed', p.level_confirmed,
                            'confirmed_at', p.level_confirmed_at is not null,
                            'by_desk', p.level_confirmed_by = pg_temp.var('desk')::uuid,
                            'role', p.level_confirmed_role, 'note', p.level_note,
                            'effective', app.effective_play_level(p.level_confirmed, p.play_level))
    from profiles p where p.id = pg_temp.var(p_who)::uuid
$f$;
`;

export const BASE = [SETUP, CF, `select pg_temp.cf_court();`];
export const CG = (name: string, level: string | null = null, band: string | null = null,
                  gender: 'female' | 'male' | 'none' | '-' = '-') =>
  `select pg_temp.cf_guest('${name}', ${level ? `'${level}'` : 'null'}, ${band ? `'${band}'` : 'null'}, '${gender}');`;
export const BK = (guest: string, weeksAgo: number, hour: number, dow = 3) =>
  `select pg_temp.cf_bk('${guest}', ${weeksAgo}, ${hour}, ${dow});`;
export const GR = (a1: string, a2: string, b1: string, b2: string, winner: 'a' | 'b' | 'draw', daysAgo = 10) =>
  `select pg_temp.cf_gr('${a1}', '${a2}', '${b1}', '${b2}', '${winner}', ${daysAgo});`;
export const FACTS = (label: string, who: string) => Q(label, `select pg_temp.cf_facts('${who}')`);
export const SUGGEST = (label: string, who: string) =>
  Q(label, `select app.level_suggested({{${who}}}::uuid)`);
export const TAGS = (label: string, who: string, days = 180) =>
  Q(
    label,
    `select to_jsonb(coalesce((select t.tags from app.customer_interest_tags(
       array[{{venue}}::uuid], array[{{${who}}}::uuid], now() - interval '${days} days', now()) t limit 1),
       '{}'::text[]))`,
  );


/**
 * A branch of this case's own, with the owner's analytics pointed at it
 * (`x-venue-scope: all:<id>`), so an analytics read sees ONLY what this case
 * planted. `app.analytics_customers` counts every guest who played at the
 * analysed branch, so measuring venue A would measure whatever else the suite
 * committed in parallel — the figures here have to be the fixture's alone.
 *
 * It rewrites the `venue` variable, so every maker above (the court, the
 * bookings, the results) plants into it.
 */
export const OWN_BRANCH: string[] = [
  KEEP(
    'venue',
    `insert into venues (slug, name_en, name_ar, status, is_active)
     values ('cf-' || substr(md5(random()::text), 1, 8), 'CF branch', 'فرع العملاء', 'open', true)
     returning id::text`,
  ),
  X(`select set_config('request.headers', json_build_object('x-venue-scope', 'all:' || {{venue}})::text, true)`),
];

/** The data of a recorded call, with its refusal printed when it failed. */
export function out<T>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''}`).toBe(true);
  return o!.data as T;
}

/** The code of a call that was expected to fail. */
export function code(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail: ${JSON.stringify(o!.data)}`).toBe(false);
  return o!.code!;
}
