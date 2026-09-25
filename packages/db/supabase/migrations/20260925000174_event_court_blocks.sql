-- 0174 event_court_blocks — a tournament's courts: the court desk blocks them as
-- events, the tournament hooks the engine calls, and event hours as their own
-- line in court analytics and the courts report.
--
-- Feature: protocols and the staff phone, lane F
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.11, §2.8, §2.18, §2.22;
-- plan Q5, #46, #55).
-- Depends on: protocols_engine_rpcs (A: the engine that calls the hooks below,
-- app.protocol_engine_actor, app.protocol_engine_text). event_block_run_index
-- (F) indexes the new run column in its own file; tournament_desk_start (F)
-- lets the court desk start a run.
-- Re-issues (§2.18): app.analytics_open_minutes (0097, dropped by its exact
-- signature and recreated with event_minutes), app.analytics_courts_summary
-- and app.analytics_courts_cafe (0147), app.report_courts (0097). Each body is
-- the latest one verbatim, plus the event figure.
-- Re-runnable: add column if not exists, guarded constraint work, on conflict
-- do nothing, create or replace, drop function if exists.
--
-- AN EVENT BLOCK is a maintenance reservation with block_purpose = 'event' and
-- the run that asked for it, so the calendar, the exclusion constraint and the
-- desk's move and cancel paths treat it as they treat any block, and its notes
-- carry the tournament's English name for desks that only read notes.
-- "Maintenance" now means kind = 'maintenance' and block_purpose is distinct
-- from 'event': an event hour is open capacity the venue chose to fill, so
-- analytics keeps it in open minutes and reports it beside them as
-- event_minutes, never as occupied or closed. A block lives as long as the
-- plan names its court and window: a plan sent back and moved cancels the
-- blocks it no longer names when it passes, a stop cancels the rest, and the
-- courts step counts only blocks of the plan that passed.
--
-- WHO READS. The plan is a 'mgmt' record. The court desk (courts) and
-- marketing (marketing) read what their step needs through tournament_context:
-- names, class, format, capacity, the ranges and the blocks, never a fee,
-- prize, budget, sponsor or income. tournament_feasibility (MGMT) counts the
-- bookings and guests in the way.
--
-- covered by packages/db/tests/event-court-blocks.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. reservations: the event columns. No backfill: every existing block stays
--    maintenance. Constraints NOT VALID, then validated in a guarded block.
-- ---------------------------------------------------------------------------
alter table reservations add column if not exists block_purpose   text;
alter table reservations add column if not exists protocol_run_id uuid;

do $reservation_event_cols_0174$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_block_purpose_chk'
                    and conrelid = 'public.reservations'::regclass) then
    alter table reservations
      add constraint reservations_block_purpose_chk
      check (block_purpose is null or block_purpose = 'event') not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_protocol_run_id_fkey'
                    and conrelid = 'public.reservations'::regclass) then
    alter table reservations
      add constraint reservations_protocol_run_id_fkey
      foreign key (protocol_run_id) references protocol_runs(id) on delete set null not valid;
  end if;
end $reservation_event_cols_0174$;

do $reservation_event_validate_0174$
begin
  if exists (select 1 from pg_constraint
              where conname = 'reservations_block_purpose_chk'
                and conrelid = 'public.reservations'::regclass and not convalidated) then
    alter table reservations validate constraint reservations_block_purpose_chk;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'reservations_protocol_run_id_fkey'
                and conrelid = 'public.reservations'::regclass and not convalidated) then
    alter table reservations validate constraint reservations_protocol_run_id_fkey;
  end if;
end $reservation_event_validate_0174$;

comment on column reservations.block_purpose is
  'event_court_blocks (§2.11): ''event'' on a maintenance block a tournament asked for (app.block_courts_for_event); NULL on every other row. Analytics counts an event block as open time and reports it as event_minutes; only a block that is not an event is subtracted from open time.';
comment on column reservations.protocol_run_id is
  'event_court_blocks (§2.11): the tournament run an event block belongs to; its stop cancels the run''s future blocks. NULL on every other row.';

-- The owner assistant reads reservations (table_read); the two new columns
-- join its allowlist (the 0144 statement, limited to these two columns).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       'table',
       true,
       c.data_type,
       c.ordinal_position,
       col_description('public.reservations'::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name = 'reservations'
   and c.column_name in ('block_purpose', 'protocol_run_id')
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Record helpers for the tournament check hooks. Internal. A field is
--    absent or JSON null when it is not given; the hint is the field the
--    form marks (validate.ts in @touch/core names the same ones).
-- ---------------------------------------------------------------------------

-- A text field: trimmed, NULL when blank; RECORD_INVALID when it is not a
-- string or is required and blank; TEXT_TOO_LONG past the cap.
create or replace function app.tournament_text(p_value jsonb, p_cap int, p_required boolean, p_hint text)
returns text
language plpgsql immutable set search_path = public as $tournament_text_0174$
declare
  v text;
begin
  if p_value is not null and p_value <> 'null'::jsonb then
    if jsonb_typeof(p_value) <> 'string' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    v := app.protocol_engine_text(p_value #>> '{}', p_cap, p_hint);
  end if;
  if v is null and p_required then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return v;
end $tournament_text_0174$;

comment on function app.tournament_text(jsonb, int, boolean, text) is
  'event_court_blocks (§2.8). Internal: a tournament record''s text field, trimmed and NULL when blank; RECORD_INVALID (hint p_hint) when not a string or required and blank, TEXT_TOO_LONG past p_cap.';

revoke all on function app.tournament_text(jsonb, int, boolean, text) from public, anon, authenticated;

-- A whole number within [p_min, p_max] (either bound may be NULL).
create or replace function app.tournament_int(p_value jsonb, p_min bigint, p_max bigint, p_required boolean, p_hint text)
returns bigint
language plpgsql immutable set search_path = public as $tournament_int_0174$
declare
  v numeric;
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_required then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'number' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  v := (p_value #>> '{}')::numeric;
  if v <> trunc(v) or abs(v) > 9007199254740991
     or (p_min is not null and v < p_min) or (p_max is not null and v > p_max) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return v::bigint;
end $tournament_int_0174$;

comment on function app.tournament_int(jsonb, bigint, bigint, boolean, text) is
  'event_court_blocks (§2.8). Internal: a tournament record''s whole-number field within [p_min, p_max]; RECORD_INVALID (hint p_hint) when not an integer in range, or required and absent.';

revoke all on function app.tournament_int(jsonb, bigint, bigint, boolean, text) from public, anon, authenticated;

-- RECORD_INVALID naming the first key of p_record (with a value) that the
-- step does not take.
create or replace function app.tournament_only_keys(p_record jsonb, p_allowed text[], p_hint text)
returns void
language plpgsql immutable set search_path = public as $tournament_only_keys_0174$
declare
  v_bad text;
begin
  select e.k into v_bad
    from jsonb_each(p_record) as e(k, v)
   where e.v <> 'null'::jsonb and not (e.k = any(p_allowed))
   order by e.k
   limit 1;
  if v_bad is not null then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = coalesce(p_hint, v_bad);
  end if;
end $tournament_only_keys_0174$;

comment on function app.tournament_only_keys(jsonb, text[], text) is
  'event_court_blocks (§2.8). Internal: RECORD_INVALID when p_record carries a key outside p_allowed with a non-null value; the hint is p_hint, or that key when p_hint is NULL.';

revoke all on function app.tournament_only_keys(jsonb, text[], text) from public, anon, authenticated;

-- An {en, ar} line (a marketing hero or ticker): both, each within the cap.
create or replace function app.tournament_line(p_value jsonb, p_cap int, p_hint text)
returns jsonb
language plpgsql immutable set search_path = public as $tournament_line_0174$
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  perform app.tournament_only_keys(p_value, array['en', 'ar'], p_hint);
  return jsonb_build_object('en', app.tournament_text(p_value->'en', p_cap, true, p_hint || '.en'),
                            'ar', app.tournament_text(p_value->'ar', p_cap, true, p_hint || '.ar'));
end $tournament_line_0174$;

comment on function app.tournament_line(jsonb, int, text) is
  'event_court_blocks (§2.8). Internal: an optional {en, ar} line, both required and within p_cap (hints <p_hint>.en and <p_hint>.ar); NULL when absent.';

revoke all on function app.tournament_line(jsonb, int, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The tournament hooks (§2.7, §2.8). Internal, called by the engine in the
--    caller's transaction.
-- ---------------------------------------------------------------------------

-- The kind is ready. A tournament keeps nothing at start (data {}); the plan
-- becomes the run's data when it passes.
create or replace function app.protocol_start_tournament(p_run_id uuid, p_data jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_start_tournament_0174$
begin
  if p_data is not null and p_data <> '{}'::jsonb then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'data';
  end if;
  return '{}'::jsonb;
end $protocol_start_tournament_0174$;

comment on function app.protocol_start_tournament(uuid, jsonb) is
  'event_court_blocks (§2.7). Internal start hook: marks tournaments ready; takes data {} (RECORD_INVALID hint data otherwise) and keeps nothing.';

revoke all on function app.protocol_start_tournament(uuid, jsonb) from public, anon, authenticated;

-- The plan (§2.8). Type 2 is the short form: class, names, ranges, capacity,
-- notes. Type 1 and 3 add the format (required) and the planning figures;
-- type 3 needs its sponsor or client (SPONSOR_DETAILS_REQUIRED), so a type 3
-- start without one is refused. Every court of a range is an active court at
-- the run's venue. Figures are planning only.
create or replace function app.protocol_check_tournament_plan(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_tournament_plan_0174$
declare
  v_run     protocol_runs%rowtype;
  v_short   boolean;
  v_out     jsonb;
  v_ranges  jsonb := '[]'::jsonb;
  v_el      jsonb;
  v_ids     uuid[];
  v_from    timestamptz;
  v_to      timestamptz;
  v_cap     jsonb;
  v_prize   jsonb;
  v_sp      jsonb;
begin
  select r.* into v_run
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  v_short := v_run.variant = 'type2';

  perform app.tournament_only_keys(p_record,
    case when v_short then array['class', 'name_en', 'name_ar', 'ranges', 'capacity', 'notes']
         else array['class', 'name_en', 'name_ar', 'format', 'ranges', 'capacity', 'entry_fee_iqd', 'prize',
                    'budget_iqd', 'expected_entries', 'risks', 'notes', 'sponsor'] end,
    null);

  if jsonb_typeof(p_record->'class') is distinct from 'string' or p_record->>'class' not in ('A', 'B', 'C') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'class';
  end if;
  v_out := jsonb_build_object(
    'class',   p_record->>'class',
    'name_en', app.tournament_text(p_record->'name_en', 80, true, 'name_en'),
    'name_ar', app.tournament_text(p_record->'name_ar', 80, true, 'name_ar'));

  if not v_short then
    if jsonb_typeof(p_record->'format') is distinct from 'string'
       or p_record->>'format' not in ('americano', 'mexicano', 'knockout', 'league') then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'format';
    end if;
    v_out := v_out || jsonb_build_object('format', p_record->>'format');
  end if;

  -- The ranges: 1 to 14, each a set of courts and a window.
  if jsonb_typeof(p_record->'ranges') is distinct from 'array'
     or jsonb_array_length(p_record->'ranges') not between 1 and 14 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'ranges';
  end if;
  for v_el in select e from jsonb_array_elements(p_record->'ranges') e loop
    if jsonb_typeof(v_el) <> 'object'
       or jsonb_typeof(v_el->'court_ids') is distinct from 'array'
       or jsonb_array_length(v_el->'court_ids') = 0
       or exists (select 1 from jsonb_array_elements(v_el->'court_ids') x where jsonb_typeof(x) <> 'string')
       or jsonb_typeof(v_el->'from') is distinct from 'string'
       or jsonb_typeof(v_el->'to') is distinct from 'string' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'ranges';
    end if;
    perform app.tournament_only_keys(v_el, array['court_ids', 'from', 'to'], 'ranges');
    begin
      v_ids  := array(select x::uuid from jsonb_array_elements_text(v_el->'court_ids') x);
      v_from := (v_el->>'from')::timestamptz;
      v_to   := (v_el->>'to')::timestamptz;
    exception when others then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'ranges';
    end;
    if not isfinite(v_from) or not isfinite(v_to) or v_to <= v_from
       or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
       or (select count(*) from courts c
            where c.id = any(v_ids) and c.venue_id = v_run.venue_id and c.is_active) <> cardinality(v_ids) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'ranges';
    end if;
    v_ranges := v_ranges || jsonb_build_array(jsonb_build_object(
      'court_ids', to_jsonb(v_ids), 'from', to_jsonb(v_from), 'to', to_jsonb(v_to)));
  end loop;
  v_out := v_out || jsonb_build_object('ranges', v_ranges);

  -- The unit counts per player or per pair. It is matched as a pattern so the
  -- body never spells the reservations column 0147 dropped: the 0147 test
  -- sweeps every function body for that word.
  v_cap := p_record->'capacity';
  if jsonb_typeof(v_cap) is distinct from 'object'
     or jsonb_typeof(v_cap->'unit') is distinct from 'string' or v_cap->>'unit' !~ '^(player|pair)s$' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'capacity';
  end if;
  perform app.tournament_only_keys(v_cap, array['unit', 'count'], 'capacity');
  v_out := v_out || jsonb_build_object('capacity', jsonb_build_object(
    'unit', v_cap->>'unit', 'count', app.tournament_int(v_cap->'count', 2, 512, true, 'capacity')));

  if not v_short then
    v_out := v_out || jsonb_build_object(
      'entry_fee_iqd',    app.tournament_int(p_record->'entry_fee_iqd', 0, null, false, 'entry_fee_iqd'),
      'budget_iqd',       app.tournament_int(p_record->'budget_iqd', 0, null, false, 'budget_iqd'),
      'expected_entries', app.tournament_int(p_record->'expected_entries', 0, null, false, 'expected_entries'),
      'risks',            app.tournament_text(p_record->'risks', 2000, false, 'risks'));

    v_prize := p_record->'prize';
    if v_prize is not null and v_prize <> 'null'::jsonb then
      if jsonb_typeof(v_prize) <> 'object' then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'prize';
      end if;
      perform app.tournament_only_keys(v_prize, array['text', 'iqd'], 'prize');
      v_out := v_out || jsonb_build_object('prize', jsonb_strip_nulls(jsonb_build_object(
        'text', app.tournament_text(v_prize->'text', 2000, false, 'prize.text'),
        'iqd',  app.tournament_int(v_prize->'iqd', 0, null, false, 'prize.iqd'))));
    end if;

    -- The sponsor or client: required for type 3, allowed on type 1.
    v_sp := p_record->'sponsor';
    if v_sp is null or v_sp = 'null'::jsonb then
      if v_run.variant = 'type3' then
        raise exception 'SPONSOR_DETAILS_REQUIRED' using errcode = 'P0001', hint = 'sponsor';
      end if;
    else
      if jsonb_typeof(v_sp) <> 'object' then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'sponsor';
      end if;
      perform app.tournament_only_keys(v_sp, array['name', 'contact', 'contribution_iqd', 'branding', 'invoice'], 'sponsor');
      if v_sp ? 'invoice' and jsonb_typeof(v_sp->'invoice') not in ('boolean', 'null') then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'sponsor.invoice';
      end if;
      v_out := v_out || jsonb_build_object('sponsor', jsonb_strip_nulls(jsonb_build_object(
        'name',             app.tournament_text(v_sp->'name', 80, true, 'sponsor.name'),
        'contact',          app.tournament_text(v_sp->'contact', 80, true, 'sponsor.contact'),
        'contribution_iqd', app.tournament_int(v_sp->'contribution_iqd', 0, null, true, 'sponsor.contribution_iqd'),
        'branding',         app.tournament_text(v_sp->'branding', 2000, false, 'sponsor.branding'),
        'invoice',          v_sp->'invoice')));
    end if;
  end if;

  v_out := v_out || jsonb_build_object('notes', app.tournament_text(p_record->'notes', 2000, false, 'notes'));
  return jsonb_strip_nulls(v_out);
end $protocol_check_tournament_plan_0174$;

comment on function app.protocol_check_tournament_plan(uuid, jsonb, text[]) is
  'event_court_blocks (§2.8). Internal check hook: the plan {class, name_en, name_ar, format (type 1 and 3), ranges: [{court_ids, from, to}] (1-14, active courts at the run''s venue), capacity: {unit, count 2-512}, entry_fee_iqd?, prize?, budget_iqd?, expected_entries?, risks?, notes?, sponsor?}; type 2 takes the short form. SPONSOR_DETAILS_REQUIRED for type 3 without a sponsor; RECORD_INVALID and TEXT_TOO_LONG with the field as hint. Returns the normalised record.';

revoke all on function app.protocol_check_tournament_plan(uuid, jsonb, text[]) from public, anon, authenticated;

create or replace function app.protocol_check_tournament_feasibility(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_tournament_feasibility_0174$
begin
  perform app.tournament_only_keys(p_record, array['staffing', 'income_iqd', 'cost_iqd', 'risks', 'notes'], null);
  return jsonb_strip_nulls(jsonb_build_object(
    'staffing',   app.tournament_text(p_record->'staffing', 2000, true, 'staffing'),
    'income_iqd', app.tournament_int(p_record->'income_iqd', 0, null, true, 'income_iqd'),
    'cost_iqd',   app.tournament_int(p_record->'cost_iqd', 0, null, true, 'cost_iqd'),
    'risks',      app.tournament_text(p_record->'risks', 2000, true, 'risks'),
    'notes',      app.tournament_text(p_record->'notes', 2000, false, 'notes')));
end $protocol_check_tournament_feasibility_0174$;

comment on function app.protocol_check_tournament_feasibility(uuid, jsonb, text[]) is
  'event_court_blocks (§2.8). Internal check hook: feasibility {staffing, income_iqd >= 0, cost_iqd >= 0, risks, notes?}. RECORD_INVALID and TEXT_TOO_LONG with the field as hint.';

revoke all on function app.protocol_check_tournament_feasibility(uuid, jsonb, text[]) from public, anon, authenticated;

-- Marketing, as release marketing (§2.8): the campaign it names, when it
-- names one, is a campaign at the run's venue.
create or replace function app.protocol_check_tournament_marketing(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_tournament_marketing_0174$
declare
  v_venue    uuid;
  v_campaign uuid;
begin
  select r.venue_id into v_venue
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  perform app.tournament_only_keys(p_record,
    array['highlights_en', 'highlights_ar', 'hero', 'ticker', 'campaign_id', 'notes'], null);

  if p_record->'campaign_id' is not null and p_record->'campaign_id' <> 'null'::jsonb then
    begin
      v_campaign := (p_record->>'campaign_id')::uuid;
    exception when others then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'campaign_id';
    end;
    if jsonb_typeof(p_record->'campaign_id') <> 'string'
       or not exists (select 1 from marketing_campaigns c where c.id = v_campaign and c.venue_id = v_venue) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'campaign_id';
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'highlights_en', app.tournament_text(p_record->'highlights_en', 300, true, 'highlights_en'),
    'highlights_ar', app.tournament_text(p_record->'highlights_ar', 300, true, 'highlights_ar'),
    'hero',          app.tournament_line(p_record->'hero', 80, 'hero'),
    'ticker',        app.tournament_line(p_record->'ticker', 120, 'ticker'),
    'campaign_id',   v_campaign,
    'notes',         app.tournament_text(p_record->'notes', 2000, false, 'notes')));
end $protocol_check_tournament_marketing_0174$;

comment on function app.protocol_check_tournament_marketing(uuid, jsonb, text[]) is
  'event_court_blocks (§2.8). Internal check hook: marketing {highlights_en, highlights_ar (<= 300), hero?: {en, ar} (<= 80), ticker?: {en, ar} (<= 120), campaign_id? (a campaign at the run''s venue), notes?}. RECORD_INVALID and TEXT_TOO_LONG with the field as hint.';

revoke all on function app.protocol_check_tournament_marketing(uuid, jsonb, text[]) from public, anon, authenticated;

-- Courts: the event blocks the desk made for this run, still live, each of a
-- court and window of the plan as it passed (a block of an earlier plan is
-- never counted as done).
create or replace function app.protocol_check_tournament_courts(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_tournament_courts_0174$
declare
  v_run_id uuid;
  v_data   jsonb;
  v_ids    uuid[];
begin
  select s.run_id, r.data into v_run_id, v_data
    from protocol_run_steps s
    join protocol_runs r on r.id = s.run_id
   where s.id = p_run_step_id;
  perform app.tournament_only_keys(p_record, array['reservation_ids', 'moved_note'], null);

  if jsonb_typeof(p_record->'reservation_ids') is distinct from 'array'
     or jsonb_array_length(p_record->'reservation_ids') = 0
     or exists (select 1 from jsonb_array_elements(p_record->'reservation_ids') x where jsonb_typeof(x) <> 'string') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'reservation_ids';
  end if;
  begin
    v_ids := array(select x::uuid from jsonb_array_elements_text(p_record->'reservation_ids') x);
  exception when others then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'reservation_ids';
  end;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or (select count(*) from reservations r
          where r.id = any(v_ids)
            and r.protocol_run_id = v_run_id
            and r.block_purpose = 'event'
            and r.status in ('pending', 'confirmed', 'arrived')
            and app.tournament_plan_has_window(v_data, r.court_id, r.start_at, r.end_at)) <> cardinality(v_ids) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'reservation_ids';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'reservation_ids', to_jsonb(v_ids),
    'moved_note',      app.tournament_text(p_record->'moved_note', 2000, false, 'moved_note')));
end $protocol_check_tournament_courts_0174$;

comment on function app.protocol_check_tournament_courts(uuid, jsonb, text[]) is
  'event_court_blocks (§2.8). Internal check hook: courts {reservation_ids (at least one, distinct, each a live event block of this run on a court and window of its passed plan), moved_note?}. RECORD_INVALID hint reservation_ids.';

revoke all on function app.protocol_check_tournament_courts(uuid, jsonb, text[]) from public, anon, authenticated;

create or replace function app.protocol_check_tournament_ready(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_tournament_ready_0174$
begin
  perform app.tournament_only_keys(p_record, array['notes'], null);
  return jsonb_strip_nulls(jsonb_build_object(
    'notes', app.tournament_text(p_record->'notes', 2000, false, 'notes')));
end $protocol_check_tournament_ready_0174$;

comment on function app.protocol_check_tournament_ready(uuid, jsonb, text[]) is
  'event_court_blocks (§2.8). Internal check hook: ready {notes?}; the checklist is ticked on the step itself.';

revoke all on function app.protocol_check_tournament_ready(uuid, jsonb, text[]) from public, anon, authenticated;

-- True when a plan record names this court and exactly this window in one
-- of its ranges: the one test of "a block of this plan". Internal.
create or replace function app.tournament_plan_has_window(p_plan jsonb, p_court_id uuid, p_from timestamptz, p_to timestamptz)
returns boolean
language sql stable security definer set search_path = public as $tournament_plan_has_window_0174$
  select exists (
    select 1
      from jsonb_array_elements(case when jsonb_typeof(p_plan->'ranges') = 'array'
                                     then p_plan->'ranges' else '[]'::jsonb end) g(e)
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(g.e->'court_ids') = 'array'
                                                        then g.e->'court_ids' else '[]'::jsonb end) c(id)
     where c.id = p_court_id::text
       and (g.e->>'from')::timestamptz = p_from
       and (g.e->>'to')::timestamptz = p_to)
$tournament_plan_has_window_0174$;

comment on function app.tournament_plan_has_window(jsonb, uuid, timestamptz, timestamptz) is
  'event_court_blocks (§2.11). Internal: whether a normalised tournament plan record names p_court_id in a range whose window is exactly [p_from, p_to).';

revoke all on function app.tournament_plan_has_window(jsonb, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- The plan passed (approved, or the manager's own): it becomes the run's
-- data, which tournament_context and tournament_feasibility read. A plan sent
-- back and moved gives back the courts it no longer needs: every event block
-- of the run that has not started and is on no court and window of the new
-- plan is cancelled, courts locked first, as a stop does. The desk then
-- blocks the new windows, with no conflict against the old ones.
create or replace function app.protocol_pass_tournament_plan(p_run_step_id uuid, p_submission_id uuid, p_decision_data jsonb)
returns void
language plpgsql security definer set search_path = public as $protocol_pass_tournament_plan_0174$
declare
  v_run_id uuid;
  v_plan   jsonb;
  v_court  uuid;
  v_res    reservations%rowtype;
begin
  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  select x.record into v_plan from protocol_submissions x where x.id = p_submission_id;
  update protocol_runs r set data = v_plan where r.id = v_run_id;

  for v_court in
    select distinct r.court_id
      from reservations r
     where r.protocol_run_id = v_run_id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived') and r.start_at > now()
       and not app.tournament_plan_has_window(v_plan, r.court_id, r.start_at, r.end_at)
     order by 1
  loop
    perform app.lock_court(v_court);
  end loop;

  for v_res in
    update reservations r
       set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff',
           cancellation_reason = 'Tournament moved'
     where r.protocol_run_id = v_run_id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived') and r.start_at > now()
       and not app.tournament_plan_has_window(v_plan, r.court_id, r.start_at, r.end_at)
    returning r.*
  loop
    perform app.write_audit('reservation.cancel', 'reservations', v_res.id::text,
      jsonb_build_object('status', 'confirmed'),
      jsonb_build_object('status', 'cancelled', 'protocol_run_id', v_run_id));
  end loop;
end $protocol_pass_tournament_plan_0174$;

comment on function app.protocol_pass_tournament_plan(uuid, uuid, jsonb) is
  'event_court_blocks (§2.11). Internal pass hook: the passed plan record becomes the run''s data, and the run''s event blocks that have not started and are on no court and window of it are cancelled (courts locked in court-id order first; audit reservation.cancel per block).';

revoke all on function app.protocol_pass_tournament_plan(uuid, uuid, jsonb) from public, anon, authenticated;

-- A stopped or withdrawn tournament gives its courts back: every event block
-- of the run that has not started is cancelled, courts locked first.
create or replace function app.protocol_stop_tournament(p_run_id uuid)
returns void
language plpgsql security definer set search_path = public as $protocol_stop_tournament_0174$
declare
  v_court uuid;
  v_res   reservations%rowtype;
begin
  for v_court in
    select distinct r.court_id
      from reservations r
     where r.protocol_run_id = p_run_id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived') and r.start_at > now()
     order by 1
  loop
    perform app.lock_court(v_court);
  end loop;

  for v_res in
    update reservations r
       set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff',
           cancellation_reason = 'Tournament stopped'
     where r.protocol_run_id = p_run_id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived') and r.start_at > now()
    returning r.*
  loop
    perform app.write_audit('reservation.cancel', 'reservations', v_res.id::text,
      jsonb_build_object('status', 'confirmed'),
      jsonb_build_object('status', 'cancelled', 'protocol_run_id', p_run_id));
  end loop;
end $protocol_stop_tournament_0174$;

comment on function app.protocol_stop_tournament(uuid) is
  'event_court_blocks (§2.11). Internal stop hook: cancels the run''s event blocks that have not started (courts locked in court-id order first); audit reservation.cancel per block.';

revoke all on function app.protocol_stop_tournament(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.block_courts_for_event — the court desk (or MGMT covering) blocks a
--    tournament's courts while its courts step is open. Every court is locked
--    in court-id order first; with any live reservation in the way nothing is
--    written and the conflicts come back to be moved through the normal move
--    and cancel path. A block of this run with the same court and window is
--    already there and is returned, so asking again after a move is safe.
--    A conflict answer is kept under the key as well, so the form mints a
--    new key after any answer.
-- ---------------------------------------------------------------------------
create or replace function app.block_courts_for_event(
  p_run_id          uuid,
  p_blocks          jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $block_courts_for_event_0174$
declare
  v_run       protocol_runs%rowtype;
  v_step      protocol_run_steps%rowtype;
  v_replay    jsonb;
  v_el        jsonb;
  v_court     uuid;
  v_from      timestamptz;
  v_to        timestamptz;
  v_blocks    jsonb := '[]'::jsonb;
  v_conflicts jsonb;
  v_blocked   jsonb := '[]'::jsonb;
  v_b         record;
  v_id        uuid;
  v_notes     text;
  v_result    jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) or v_run.kind <> 'tournament' then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_run.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'block_courts_for_event');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_step from protocol_run_steps where run_id = v_run.id and step_key = 'courts' for update;
  if v_run.status <> 'active' or not found or v_step.status <> 'open' then
    raise exception 'STEP_NOT_OPEN' using errcode = 'P0001';
  end if;

  -- The blocks: 1 to 60 of {court_id, start_at, end_at}, each ending after it
  -- starts, on a court of the run's venue, none overlapping another of the
  -- same court in this request.
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) not between 1 and 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
  end if;
  for v_el in select e from jsonb_array_elements(p_blocks) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
    end if;
    begin
      v_court := (v_el->>'court_id')::uuid;
      v_from  := (v_el->>'start_at')::timestamptz;
      v_to    := (v_el->>'end_at')::timestamptz;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
    end;
    if v_court is null or v_from is null or v_to is null or not isfinite(v_from) or not isfinite(v_to) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
    end if;
    if v_to <= v_from then
      raise exception 'BLOCK_RANGE_INVALID' using errcode = 'P0001';
    end if;
    if not exists (select 1 from courts c where c.id = v_court and c.venue_id = v_run.venue_id) then
      raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'court_id', v_court, 'start_at', v_from, 'end_at', v_to));
  end loop;
  if exists (select 1
               from jsonb_array_elements(v_blocks) with ordinality a(e, i)
               join jsonb_array_elements(v_blocks) with ordinality b(e, j)
                 on a.i < b.j and a.e->>'court_id' = b.e->>'court_id'
              where tstzrange((a.e->>'start_at')::timestamptz, (a.e->>'end_at')::timestamptz, '[)')
                 && tstzrange((b.e->>'start_at')::timestamptz, (b.e->>'end_at')::timestamptz, '[)')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
  end if;

  -- Serialise with every other writer of these courts (0042), in court-id
  -- order, then clear stale holds in the windows.
  for v_court in select distinct (e->>'court_id')::uuid from jsonb_array_elements(v_blocks) e order by 1 loop
    perform app.lock_court(v_court);
  end loop;
  for v_b in
    select (e->>'court_id')::uuid as court_id, (e->>'start_at')::timestamptz as start_at,
           (e->>'end_at')::timestamptz as end_at
      from jsonb_array_elements(v_blocks) e
  loop
    perform app.expire_stale_holds(v_b.court_id, tstzrange(v_b.start_at, v_b.end_at, '[)'));
  end loop;

  -- What is in the way: any live reservation overlapping a block, except this
  -- run's own block of exactly that court and window.
  select coalesce(jsonb_agg(jsonb_build_object(
           'court_id', r.court_id, 'start_at', r.start_at, 'end_at', r.end_at,
           'reservation_id', r.id, 'kind', r.kind, 'status', r.status)
         order by r.start_at, r.court_id, r.id), '[]'::jsonb)
    into v_conflicts
    from reservations r
   where r.status in ('pending', 'confirmed', 'arrived')
     and exists (select 1
                   from jsonb_array_elements(v_blocks) e
                  where (e->>'court_id')::uuid = r.court_id
                    and r.period && tstzrange((e->>'start_at')::timestamptz, (e->>'end_at')::timestamptz, '[)')
                    and not (r.protocol_run_id is not distinct from v_run.id
                             and r.block_purpose is not distinct from 'event'
                             and r.start_at = (e->>'start_at')::timestamptz
                             and r.end_at = (e->>'end_at')::timestamptz));

  if jsonb_array_length(v_conflicts) > 0 then
    v_result := jsonb_build_object('blocked', '[]'::jsonb, 'conflicts', v_conflicts);
    perform app.finish_replay(p_idempotency_key, v_result);
    return v_result;
  end if;

  -- Older desks read notes: the tournament's English name, else the title.
  v_notes := left(coalesce(nullif(btrim(v_run.data->>'name_en'), ''), nullif(btrim(v_run.title_en), ''),
                           v_run.title_ar), 200);
  for v_b in
    select (e->>'court_id')::uuid as court_id, (e->>'start_at')::timestamptz as start_at,
           (e->>'end_at')::timestamptz as end_at
      from jsonb_array_elements(v_blocks) e
     order by 1, 2
  loop
    select r.id into v_id
      from reservations r
     where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
       and r.court_id = v_b.court_id and r.start_at = v_b.start_at and r.end_at = v_b.end_at
       and r.status in ('pending', 'confirmed', 'arrived');
    if not found then
      begin
        insert into reservations
          (court_id, kind, status, start_at, end_at, created_by_staff_id, source, notes,
           venue_id, block_purpose, protocol_run_id)
        values
          (v_b.court_id, 'maintenance', 'confirmed', v_b.start_at, v_b.end_at, auth.uid(), 'desk', v_notes,
           v_run.venue_id, 'event', v_run.id)
        returning id into v_id;
      exception when exclusion_violation then
        raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
      end;
      perform app.write_audit('reservation.event_block', 'reservations', v_id::text, null,
        jsonb_build_object('protocol_run_id', v_run.id, 'court_id', v_b.court_id,
                           'start_at', v_b.start_at, 'end_at', v_b.end_at));
    end if;
    v_blocked := v_blocked || jsonb_build_array(jsonb_build_object(
      'reservation_id', v_id, 'court_id', v_b.court_id, 'start_at', v_b.start_at, 'end_at', v_b.end_at));
  end loop;

  v_result := jsonb_build_object('blocked', v_blocked, 'conflicts', '[]'::jsonb);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $block_courts_for_event_0174$;

comment on function app.block_courts_for_event(uuid, jsonb, text) is
  'event_court_blocks (§2.11). The court desk or MGMT at the run''s venue, while the tournament''s courts step is open: blocks p_blocks [{court_id, start_at, end_at}] (1-60) as event blocks (maintenance, block_purpose event, protocol_run_id, notes = the tournament''s English name), every court locked in court-id order first. Returns {blocked: [{reservation_id, court_id, start_at, end_at}], conflicts: [{court_id, start_at, end_at, reservation_id, kind, status}]}; with any conflict nothing is written and blocked is empty. A block of this run with the same court and window is returned, not written again. PROTOCOL_NOT_FOUND, STEP_NOT_OPEN, INVALID_ARGUMENT (hint blocks), BLOCK_RANGE_INVALID, COURT_NOT_FOUND, SLOT_TAKEN (a race past the check). Idempotent on p_idempotency_key. Audit reservation.event_block.';

revoke all on function app.block_courts_for_event(uuid, jsonb, text) from public, anon;
grant execute on function app.block_courts_for_event(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The narrow reads: what the courts and marketing steps need from the
--    plan (tournament_context), and MGMT's count of what is in the way
--    (tournament_feasibility).
-- ---------------------------------------------------------------------------
create or replace function app.tournament_context(p_run_step_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_context_0174$
declare
  v_step protocol_run_steps%rowtype;
  v_run  protocol_runs%rowtype;
  v_data jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_step from protocol_run_steps where id = p_run_step_id;
  select * into v_run from protocol_runs where id = v_step.run_id;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) or v_run.kind <> 'tournament' then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_run.venue_id, 'manager', 'owner')
     and not (v_step.step_key in ('courts', 'marketing')
              and app.protocol_engine_actor(v_run.venue_id, v_step.actor_roles, v_step.assigned_to, false)) then
    raise exception 'NOT_STEP_ACTOR' using errcode = 'P0001';
  end if;

  v_data := v_run.data;
  return jsonb_build_object(
    'name_en',  v_data->>'name_en',
    'name_ar',  v_data->>'name_ar',
    'class',    v_data->>'class',
    'format',   v_data->>'format',
    'capacity', v_data->'capacity',
    'ranges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'court_ids',   g.e->'court_ids',
               'court_names', coalesce((
                 select jsonb_agg(jsonb_build_object('en', c.name_en, 'ar', c.name_ar) order by x.o)
                   from jsonb_array_elements_text(g.e->'court_ids') with ordinality as x(id, o)
                   left join courts c on c.id::text = x.id), '[]'::jsonb),
               'from', g.e->'from',
               'to',   g.e->'to')
             order by g.o)
        from jsonb_array_elements(case when jsonb_typeof(v_data->'ranges') = 'array'
                                       then v_data->'ranges' else '[]'::jsonb end) with ordinality as g(e, o)),
      '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reservation_id', r.id, 'court_id', r.court_id, 'start_at', r.start_at, 'end_at', r.end_at)
             order by r.start_at, r.court_id, r.id)
        from reservations r
       where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
         and r.status in ('pending', 'confirmed', 'arrived')), '[]'::jsonb));
end $tournament_context_0174$;

comment on function app.tournament_context(uuid) is
  'event_court_blocks (§2.11). The actor of a tournament''s courts or marketing step who may act on it, or MGMT at the venue: {name_en, name_ar, class, format, capacity, ranges: [{court_ids, court_names: [{en, ar}], from, to}], blocked: [{reservation_id, court_id, start_at, end_at}]} from the run''s passed plan and its live event blocks. No fee, prize, budget, sponsor or income. PROTOCOL_NOT_FOUND, NOT_STEP_ACTOR.';

revoke all on function app.tournament_context(uuid) from public, anon;
grant execute on function app.tournament_context(uuid) to authenticated;

-- Per court of each range: the live bookings in the window and the guests who
-- hold them. The plan is the run's data once it passed, else its latest
-- submission (MGMT reads that record anyway).
create or replace function app.tournament_feasibility(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_feasibility_0174$
declare
  v_run  protocol_runs%rowtype;
  v_plan jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) or v_run.kind <> 'tournament'
     or not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_plan := case when jsonb_typeof(v_run.data->'ranges') = 'array' then v_run.data
                 else (select x.record
                         from protocol_submissions x
                         join protocol_run_steps s on s.id = x.run_step_id
                        where s.run_id = v_run.id and s.step_key = 'plan'
                          and x.withdrawn_at is null and x.superseded_at is null
                        order by x.submitted_at desc, x.id
                        limit 1) end;

  return jsonb_build_object('ranges', coalesce((
    select jsonb_agg(jsonb_build_object(
             'court_id',      c.id,
             'court_name_en', c.name_en,
             'court_name_ar', c.name_ar,
             'from',          g.e->'from',
             'to',            g.e->'to',
             'bookings',      (select count(*)
                                 from reservations r
                                where r.court_id = c.id and r.kind = 'booking'
                                  and r.status in ('pending', 'confirmed', 'arrived')
                                  and r.period && tstzrange((g.e->>'from')::timestamptz, (g.e->>'to')::timestamptz, '[)')),
             'guests',        (select count(distinct coalesce(r.guest_id::text, nullif(btrim(r.guest_phone), ''), r.id::text))
                                 from reservations r
                                where r.court_id = c.id and r.kind = 'booking'
                                  and r.status in ('pending', 'confirmed', 'arrived')
                                  and r.period && tstzrange((g.e->>'from')::timestamptz, (g.e->>'to')::timestamptz, '[)')))
           order by g.o, x.o)
      from jsonb_array_elements(case when jsonb_typeof(v_plan->'ranges') = 'array'
                                     then v_plan->'ranges' else '[]'::jsonb end) with ordinality as g(e, o)
      cross join lateral jsonb_array_elements_text(g.e->'court_ids') with ordinality as x(id, o)
      join courts c on c.id::text = x.id), '[]'::jsonb));
end $tournament_feasibility_0174$;

comment on function app.tournament_feasibility(uuid) is
  'event_court_blocks (§2.11). MGMT at the run''s venue: {ranges: [{court_id, court_name_en, court_name_ar, from, to, bookings, guests}]}, one row per court of each plan range, with the live bookings overlapping the window and the distinct guests holding them. PROTOCOL_NOT_FOUND.';

revoke all on function app.tournament_feasibility(uuid) from public, anon;
grant execute on function app.tournament_feasibility(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.analytics_open_minutes — the 0097 body with events split out:
--    only a block that is not an event is subtracted; an event block's part
--    of the open hour stays open and is also counted as event_minutes (Q5).
--    Dropped by its exact signature (the result type changes) and re-granted
--    to service_role only.
-- ---------------------------------------------------------------------------
drop function if exists app.analytics_open_minutes(timestamptz, timestamptz, text, int, uuid);

create or replace function app.analytics_open_minutes(
  p_ts_from    timestamptz,
  p_ts_to      timestamptz,
  p_tz         text,
  p_start_hour int,
  p_court_id   uuid default null
) returns table (court_id uuid, dow int, hour int, open_minutes bigint, open_days int, event_minutes int)
language sql stable security definer set search_path = public as $analytics_open_minutes_0174$
  with hours as (
    select gs as h
      from generate_series(date_trunc('hour', p_ts_from at time zone p_tz),
                           p_ts_to at time zone p_tz,
                           interval '1 hour') gs
     where gs < (p_ts_to at time zone p_tz)),
  cells as (
    -- One row per (hour, opening window) with the open part of the hour as a
    -- local [os, oe) interval.
    select h.h,
           h.h::date                                             as d,
           (h.h - make_interval(hours => p_start_hour))::date    as bd,
           extract(hour from h.h)::int                           as hour,
           h.h::date + make_interval(secs => greatest(extract(epoch from h.h::time), extract(epoch from (w ->> 0)::interval))) as os,
           h.h::date + make_interval(secs => least(extract(epoch from h.h::time) + 3600, extract(epoch from (w ->> 1)::interval)))  as oe
      from hours h
      cross join venue_settings vs
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(vs.opening_hours -> lower(to_char(h.h, 'Dy'))) = 'array'
             then vs.opening_hours -> lower(to_char(h.h, 'Dy'))
             else '[]'::jsonb end) w
     where not (h.h::date = any (coalesce(vs.closed_dates, '{}')))),
  open_cells as (
    select c.h, c.d, c.bd, c.hour, c.os, c.oe
      from cells c
     where c.oe > c.os),
  court_cells as (
    select ct.id as court_id, oc.h, oc.d, oc.bd, oc.hour, oc.os, oc.oe
      from open_cells oc
      cross join courts ct
     where (p_court_id is null or ct.id = p_court_id)
       and (ct.is_active or ct.active_to is not null)
       and (ct.active_from is null or oc.d >= ct.active_from)
       and (ct.active_to   is null or oc.d <= ct.active_to)),
  maint as (
    -- One pass over the blocks: maintenance that is not an event is closed
    -- time; an event block is open time the venue gave to a tournament.
    select cc.court_id, cc.h, cc.os,
           sum(extract(epoch from (least(cc.oe, r.end_at at time zone p_tz) - greatest(cc.os, r.start_at at time zone p_tz))))
             filter (where r.block_purpose is distinct from 'event') as secs,
           sum(extract(epoch from (least(cc.oe, r.end_at at time zone p_tz) - greatest(cc.os, r.start_at at time zone p_tz))))
             filter (where r.block_purpose = 'event') as ev_secs
      from court_cells cc
      join reservations r
        on r.court_id = cc.court_id
       and r.kind = 'maintenance'
       and r.status not in ('cancelled','expired')
       and (r.start_at at time zone p_tz) < cc.oe
       and (r.end_at   at time zone p_tz) > cc.os
     group by cc.court_id, cc.h, cc.os),
  net as (
    select cc.court_id, cc.bd, cc.hour,
           greatest(extract(epoch from (cc.oe - cc.os)) - coalesce(m.secs, 0), 0) / 60 as mins,
           least(coalesce(m.ev_secs, 0), greatest(extract(epoch from (cc.oe - cc.os)) - coalesce(m.secs, 0), 0)) / 60 as ev_mins
      from court_cells cc
      left join maint m on m.court_id = cc.court_id and m.h = cc.h and m.os = cc.os)
  select n.court_id,
         extract(dow from n.bd)::int                           as dow,
         n.hour,
         round(sum(n.mins))::bigint                            as open_minutes,
         count(distinct n.bd) filter (where n.mins > 0)::int   as open_days,
         round(sum(n.ev_mins))::int                            as event_minutes
    from net n
   group by n.court_id, extract(dow from n.bd), n.hour
  having sum(n.mins) > 0
$analytics_open_minutes_0174$;

comment on function app.analytics_open_minutes(timestamptz, timestamptz, text, int, uuid) is
  'event_court_blocks (§2.11), from 0097. Service role only: per (court, business dow, local hour) over [p_ts_from, p_ts_to), the open minutes (opening windows of that calendar day, closed dates skipped, courts inside their active window, minus maintenance that is not an event), the open business days, and event_minutes, the part of those open minutes an event block holds (it stays open capacity).';

revoke all on function app.analytics_open_minutes(timestamptz, timestamptz, text, int, uuid) from public, anon, authenticated;
grant execute on function app.analytics_open_minutes(timestamptz, timestamptz, text, int, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. app.analytics_courts_summary — 0147 body verbatim plus event_minutes
--    beside open_minutes (the court filter applies to both).
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_summary(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_summary_0174$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           r.start_at at time zone v_b.tz                                            as s_local,
           r.end_at at time zone v_b.tz                                              as e_local,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)                     as d,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status in ('confirmed','arrived','completed')                           as live,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  holds as (
    select extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
     where r.kind = 'hold' and r.status = 'expired' and r.source = 'mobile'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, o.dow, o.hour, o.open_minutes, o.open_days, o.event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id),
  court_open as (
    select oc.court_id, sum(oc.open_minutes)::bigint as open_minutes, sum(oc.event_minutes)::bigint as event_minutes
      from oc group by oc.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(co.open_minutes, 0)::bigint                           as open_minutes,
           coalesce(co.event_minutes, 0)::bigint                          as event_minutes,
           count(b.id) filter (where b.live)                              as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint         as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint    as revenue_iqd,
           count(b.id) filter (where b.cancelled)                         as cancellations,
           count(b.id) filter (where b.no_show)                           as no_shows,
           count(b.id) filter (where b.live and b.source = 'mobile')      as mobile_bookings,
           count(b.id) filter (where b.live and b.source = 'desk')        as desk_bookings,
           avg(b.mins) filter (where b.live)                              as avg_duration_min
      from courts_in c
      left join court_open co on co.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, co.open_minutes, co.event_minutes),
  tot as (
    select count(*)::int                                   as courts_count,
           coalesce(sum(pc.bookings), 0)::bigint           as bookings,
           coalesce(sum(pc.booked_minutes), 0)::bigint     as booked_minutes,
           coalesce(sum(pc.revenue_iqd), 0)::bigint        as revenue_iqd,
           coalesce(sum(pc.cancellations), 0)::bigint      as cancellations,
           coalesce(sum(pc.no_shows), 0)::bigint           as no_shows,
           coalesce(sum(pc.mobile_bookings), 0)::bigint    as mobile_bookings,
           coalesce(sum(pc.desk_bookings), 0)::bigint      as desk_bookings,
           coalesce(sum(pc.open_minutes), 0)::bigint       as open_minutes,
           coalesce(sum(pc.event_minutes), 0)::bigint      as event_minutes
      from per_court pc),
  days as (
    select gs::date as d
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') gs),
  by_day as (
    select d.d,
           coalesce((select case when jsonb_typeof(vs.opening_hours -> lower(to_char(d.d, 'Dy'))) = 'array'
                                  then jsonb_array_length(vs.opening_hours -> lower(to_char(d.d, 'Dy')))
                                  else 0 end = 0
                            or d.d = any (coalesce(vs.closed_dates, '{}'))
                       from venue_settings vs limit 1), true)         as closed,
           count(b.id) filter (where b.live)                           as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint      as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as revenue_iqd,
           count(b.id) filter (where b.cancelled)                      as cancellations,
           count(b.id) filter (where b.no_show)                        as no_shows
      from days d
      left join b on b.d = d.d
     group by d.d),
  split as (
    select extract(dow from (gs - make_interval(hours => v_b.start_hour))::date)::int as dow,
           extract(hour from gs)::int                                                 as hour,
           sum(extract(epoch from (least(b.e_local, gs + interval '1 hour') - greatest(b.s_local, gs))) / 60) as booked_minutes
      from b
      cross join lateral generate_series(date_trunc('hour', b.s_local), b.e_local, interval '1 hour') gs
     where b.live and gs < b.e_local
     group by 1, 2),
  starts as (
    select b.dow, b.hour,
           count(*) filter (where b.live)                               as bookings,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint  as revenue_iqd,
           count(*) filter (where b.cancelled)                          as cancellations,
           count(*) filter (where b.no_show)                            as no_shows
      from b
     group by b.dow, b.hour),
  hold_cells as (
    select h.dow, h.hour, count(*) as holds_expired from holds h group by h.dow, h.hour),
  open_cells as (
    -- VENUE-WIDE: every court in courts_in, summed per cell.
    select oc.dow, oc.hour, sum(oc.open_minutes)::bigint as open_minutes, max(oc.open_days)::int as open_days
      from oc
     group by oc.dow, oc.hour),
  keys as (
    select oc.dow, oc.hour from open_cells oc
    union select sp.dow, sp.hour from split sp
    union select st.dow, st.hour from starts st
    union select hc.dow, hc.hour from hold_cells hc),
  heat as (
    select k.dow, k.hour,
           coalesce(oc.open_minutes, 0)::bigint            as open_minutes,
           coalesce(oc.open_days, 0)                       as open_days,
           coalesce(round(sp.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(st.bookings, 0)                        as bookings,
           coalesce(st.revenue_iqd, 0)                     as revenue_iqd,
           coalesce(st.cancellations, 0)                   as cancellations,
           coalesce(st.no_shows, 0)                        as no_shows,
           coalesce(hc.holds_expired, 0)                   as holds_expired
      from keys k
      left join open_cells oc on oc.dow = k.dow and oc.hour = k.hour
      left join split sp      on sp.dow = k.dow and sp.hour = k.hour
      left join starts st     on st.dow = k.dow and st.hour = k.hour
      left join hold_cells hc on hc.dow = k.dow and hc.hour = k.hour)
  select jsonb_build_object(
    'range',         jsonb_build_object('from', p_from, 'to', p_to),
    'courts_count',  t.courts_count,
    'open_minutes',  t.open_minutes,
    'event_minutes', t.event_minutes,
    'kpis', jsonb_build_object(
      'bookings',                  t.bookings,
      'booked_minutes',            t.booked_minutes,
      'occupancy_pct',             case when t.open_minutes > 0 then round(t.booked_minutes * 100.0 / t.open_minutes, 1) end,
      'revenue_iqd',               t.revenue_iqd,
      'rev_per_open_hour_iqd',     case when t.open_minutes > 0 then round(t.revenue_iqd * 60.0 / t.open_minutes)::bigint end,
      'price_per_booked_hour_iqd', case when t.booked_minutes > 0 then round(t.revenue_iqd * 60.0 / t.booked_minutes)::bigint end,
      'cancellations',             t.cancellations,
      'no_shows',                  t.no_shows,
      'booked_total',              t.bookings + t.cancellations + t.no_shows,
      'cancellation_rate_pct',     case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.cancellations * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'no_show_rate_pct',          case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.no_shows * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'mobile_bookings',           t.mobile_bookings,
      'desk_bookings',             t.desk_bookings,
      'holds_expired',             (select count(*) from holds),
      'booking_days',              (select count(distinct b.d) from b where b.live)),
    'per_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',              pc.id,
               'name_en',               pc.name_en,
               'name_ar',               pc.name_ar,
               'is_active',             pc.is_active,
               'bookings',              pc.bookings,
               'booked_minutes',        pc.booked_minutes,
               'open_minutes',          pc.open_minutes,
               'occupancy_pct',         case when pc.open_minutes > 0 then round(pc.booked_minutes * 100.0 / pc.open_minutes, 1) end,
               'revenue_iqd',           pc.revenue_iqd,
               'rev_per_open_hour_iqd', case when pc.open_minutes > 0 then round(pc.revenue_iqd * 60.0 / pc.open_minutes)::bigint end,
               'cancellations',         pc.cancellations,
               'no_shows',              pc.no_shows,
               'booked_total',          pc.bookings + pc.cancellations + pc.no_shows,
               'cancellation_rate_pct', case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'no_show_rate_pct',      case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'mobile_bookings',       pc.mobile_bookings,
               'desk_bookings',         pc.desk_bookings,
               'avg_duration_min',      round(pc.avg_duration_min, 1)
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'business_date',  x.d,
               'closed',         x.closed,
               'bookings',       x.bookings,
               'booked_minutes', x.booked_minutes,
               'revenue_iqd',    x.revenue_iqd,
               'cancellations',  x.cancellations,
               'no_shows',       x.no_shows
             ) order by x.d), '[]'::jsonb)
        from by_day x),
    'heatmap', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'dow',            h.dow,
               'hour',           h.hour,
               'open_minutes',   h.open_minutes,
               'open_days',      h.open_days,
               'booked_minutes', h.booked_minutes,
               'bookings',       h.bookings,
               'revenue_iqd',    h.revenue_iqd,
               'cancellations',  h.cancellations,
               'no_shows',       h.no_shows,
               'holds_expired',  h.holds_expired
             ) order by h.dow, h.hour), '[]'::jsonb)
        from heat h))
    into v_out
    from tot t;

  return v_out;
end $analytics_courts_summary_0174$;

comment on function app.analytics_courts_summary(date, date, uuid) is
  'event_court_blocks (§2.11), from 0147. Owner only: the courts summary for a business-day range (optionally one court): open_minutes (event hours included) and event_minutes (the part of them event blocks hold), KPIs, per-court rows, by-day rows and the dow x hour heatmap.';

revoke all on function app.analytics_courts_summary(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_summary(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.analytics_courts_cafe — 0147 body verbatim plus event_minutes at
--    the top, the event part of attach.open_minutes.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_cafe(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_cafe_0174$
declare
  v_b     record;
  v_ex    uuid[];
  v_out   jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_ex    := app.analytics_excluded();

  with
  b as (
    select r.id, r.court_id, r.start_at, r.end_at,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order
      from courts c
     where (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, sum(o.open_minutes)::bigint as open_minutes, sum(o.event_minutes)::bigint as event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id
     group by o.court_id),
  lt as (
    select t.id as tab_id, t.reservation_id, t.status
      from tabs t
      join b on b.id = t.reservation_id
     where t.status <> 'void' and t.merged_into_tab_id is null),
  lm as (
    select s.tab_id, s.reservation_id, s.cafe_gross_iqd, s.refunds_iqd, s.cafe_net_iqd
      from app.cafe_settled_tabs(null, null) s
      join b on b.id = s.reservation_id),
  per_b as (
    select b.*,
           exists (select 1 from lt where lt.reservation_id = b.id)                                   as linked,
           exists (select 1 from lm where lm.reservation_id = b.id)                                   as settled,
           (select coalesce(sum(lm.cafe_net_iqd), 0)   from lm where lm.reservation_id = b.id)::bigint as cafe_iqd,
           (select coalesce(sum(lm.cafe_gross_iqd), 0) from lm where lm.reservation_id = b.id)::bigint as cafe_gross_iqd,
           (select coalesce(sum(lm.refunds_iqd), 0)    from lm where lm.reservation_id = b.id)::bigint as refunds_iqd
      from b),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order,
           coalesce(oc.open_minutes, 0)::bigint          as open_minutes,
           coalesce(oc.event_minutes, 0)::bigint         as event_minutes,
           count(p.id)                                   as live_bookings,
           count(p.id) filter (where p.linked)           as linked_bookings,
           count(p.id) filter (where p.settled)          as settled_linked,
           coalesce(sum(p.cafe_iqd), 0)::bigint          as cafe_iqd,
           coalesce(sum(p.cafe_gross_iqd), 0)::bigint    as cafe_gross_iqd,
           coalesce(sum(p.refunds_iqd), 0)::bigint       as refunds_iqd,
           coalesce(sum(p.price_iqd), 0)::bigint         as court_iqd,
           coalesce(sum(p.mins), 0)::bigint              as booked_minutes
      from courts_in c
      left join oc on oc.court_id = c.id
      left join per_b p on p.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, oc.open_minutes, oc.event_minutes),
  tot as (
    select coalesce(sum(pc.live_bookings), 0)::bigint    as live_bookings,
           coalesce(sum(pc.linked_bookings), 0)::bigint  as linked_bookings,
           coalesce(sum(pc.settled_linked), 0)::bigint   as settled_linked,
           coalesce(sum(pc.cafe_iqd), 0)::bigint         as cafe_iqd,
           coalesce(sum(pc.cafe_gross_iqd), 0)::bigint   as cafe_gross_iqd,
           coalesce(sum(pc.refunds_iqd), 0)::bigint      as refunds_iqd,
           coalesce(sum(pc.court_iqd), 0)::bigint        as court_iqd,
           coalesce(sum(pc.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(sum(pc.open_minutes), 0)::bigint     as open_minutes,
           coalesce(sum(pc.event_minutes), 0)::bigint    as event_minutes
      from per_court pc),
  nl as (
    select * from app.cafe_net_lines((select coalesce(array_agg(lt.tab_id), '{}'::uuid[]) from lt))),
  lo as (
    select o.id as order_id, o.placed_at, p.court_id, p.start_at, p.end_at
      from orders o
      join lt on lt.tab_id = o.tab_id
      join per_b p on p.id = lt.reservation_id
     where o.status <> 'voided'),
  li as (
    select lo.court_id, lo.order_id, nl.menu_item_id,
           (nl.qty - nl.refund_qty) as qty, nl.net_iqd
      from nl
      join lo on lo.order_id = nl.order_id
     where nl.menu_item_id <> all (v_ex)),
  ao as (
    select o.id as order_id
      from orders o
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'),
  ai as (
    select oi.menu_item_id, oi.order_id
      from order_items oi
      join ao on ao.order_id = oi.order_id
     where not oi.voided and oi.menu_item_id <> all (v_ex)),
  top_items as (
    select x.*, row_number() over (partition by x.court_id order by x.qty desc, x.revenue_iqd desc, x.item_id) as rn
      from (select li.court_id, li.menu_item_id as item_id,
                   sum(li.qty)::bigint             as qty,
                   sum(li.net_iqd)::bigint         as revenue_iqd,
                   count(distinct li.order_id)     as linked_orders
              from li group by li.court_id, li.menu_item_id) x),
  items as (
    select coalesce(l.item_id, a.item_id) as item_id, coalesce(l.n, 0) as linked_n, coalesce(a.n, 0) as all_n
      from (select li.menu_item_id as item_id, count(distinct li.order_id) as n from li group by li.menu_item_id) l
      full join (select ai.menu_item_id as item_id, count(distinct ai.order_id) as n from ai group by ai.menu_item_id) a
             on a.item_id = l.item_id),
  timing as (
    select lo.order_id,
           extract(epoch from (lo.placed_at - lo.start_at)) / 60 as offset_min,
           case when lo.placed_at < lo.start_at - interval '30 minutes'            then 'before_30plus'
                when lo.placed_at < lo.start_at                                    then 'before_0_30'
                when lo.placed_at < lo.start_at + (lo.end_at - lo.start_at) / 2    then 'first_half'
                when lo.placed_at < lo.end_at                                      then 'second_half'
                when lo.placed_at < lo.end_at + interval '30 minutes'              then 'after_0_30'
                else 'after_30plus' end as bucket,
           (select coalesce(sum(nl.net_iqd), 0) from nl where nl.order_id = lo.order_id)::bigint as revenue_iqd
      from lo),
  timing_keys as (
    select k.bucket, k.ord
      from (values ('before_30plus', 1), ('before_0_30', 2), ('first_half', 3),
                   ('second_half', 4), ('after_0_30', 5), ('after_30plus', 6)) k(bucket, ord))
  select jsonb_build_object(
    'event_minutes', t.event_minutes,
    'attach', jsonb_build_object(
      'live_bookings',                t.live_bookings,
      'linked_bookings',              t.linked_bookings,
      'attach_pct',                   case when t.live_bookings > 0 then round(t.linked_bookings * 100.0 / t.live_bookings, 1) end,
      'settled_linked',               t.settled_linked,
      'cafe_iqd',                     t.cafe_iqd,
      'cafe_gross_iqd',               t.cafe_gross_iqd,
      'refunds_iqd',                  t.refunds_iqd,
      'cafe_per_linked_iqd',          case when t.settled_linked > 0 then round(t.cafe_iqd * 1.0 / t.settled_linked)::bigint end,
      'cafe_per_booking_iqd',         case when t.live_bookings > 0 then round(t.cafe_iqd * 1.0 / t.live_bookings)::bigint end,
      'court_iqd',                    t.court_iqd,
      'booked_minutes',               t.booked_minutes,
      'open_minutes',                 t.open_minutes,
      'combined_per_booked_hour_iqd', case when t.booked_minutes > 0 then round((t.court_iqd + t.cafe_iqd) * 60.0 / t.booked_minutes)::bigint end,
      'combined_per_open_hour_iqd',   case when t.open_minutes > 0 then round((t.court_iqd + t.cafe_iqd) * 60.0 / t.open_minutes)::bigint end),
    'per_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',                     pc.id,
               'name_en',                      pc.name_en,
               'name_ar',                      pc.name_ar,
               'live_bookings',                pc.live_bookings,
               'linked_bookings',              pc.linked_bookings,
               'attach_pct',                   case when pc.live_bookings > 0 then round(pc.linked_bookings * 100.0 / pc.live_bookings, 1) end,
               'settled_linked',               pc.settled_linked,
               'cafe_iqd',                     pc.cafe_iqd,
               'cafe_gross_iqd',               pc.cafe_gross_iqd,
               'refunds_iqd',                  pc.refunds_iqd,
               'cafe_per_linked_iqd',          case when pc.settled_linked > 0 then round(pc.cafe_iqd * 1.0 / pc.settled_linked)::bigint end,
               'cafe_per_booking_iqd',         case when pc.live_bookings > 0 then round(pc.cafe_iqd * 1.0 / pc.live_bookings)::bigint end,
               'court_iqd',                    pc.court_iqd,
               'booked_minutes',               pc.booked_minutes,
               'open_minutes',                 pc.open_minutes,
               'combined_per_booked_hour_iqd', case when pc.booked_minutes > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / pc.booked_minutes)::bigint end,
               'combined_per_open_hour_iqd',   case when pc.open_minutes > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / pc.open_minutes)::bigint end
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'top_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',                ti.court_id,
               'item_id',                 ti.item_id,
               'name_en',                 mi.name_en,
               'name_ar',                 mi.name_ar,
               'qty',                     ti.qty,
               'revenue_iqd',             ti.revenue_iqd,
               'linked_orders_with_item', ti.linked_orders
             ) order by ti.court_id, ti.rn), '[]'::jsonb)
        from top_items ti
        join menu_items mi on mi.id = ti.item_id
       where ti.rn <= 5),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'item_id',                 i.item_id,
               'name_en',                 mi.name_en,
               'name_ar',                 mi.name_ar,
               'linked_orders_with_item', i.linked_n,
               'all_orders_with_item',    i.all_n
             ) order by i.linked_n desc, i.all_n desc, mi.name_en, i.item_id), '[]'::jsonb)
        from items i
        join menu_items mi on mi.id = i.item_id),
    'linked_orders_total', (select count(*) from lo),
    'all_orders_total',    (select count(*) from ao),
    'order_timing', jsonb_build_object(
      'median_offset_min', (select round(percentile_cont(0.5) within group (order by tm.offset_min::double precision))::int from timing tm),
      'buckets', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',      k.bucket,
                 'orders',      coalesce(x.n, 0),
                 'revenue_iqd', coalesce(x.rev, 0)
               ) order by k.ord)
          from timing_keys k
          left join (select tm.bucket, count(*) as n, sum(tm.revenue_iqd)::bigint as rev from timing tm group by tm.bucket) x
                 on x.bucket = k.bucket)),
    'attach_cells', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'dow',             x.dow,
               'hour',            x.hour,
               'live_bookings',   x.n,
               'linked_bookings', x.linked
             ) order by x.dow, x.hour), '[]'::jsonb)
        from (select p.dow, p.hour, count(*) as n, count(*) filter (where p.linked) as linked
                from per_b p group by p.dow, p.hour) x),
    'by_duration', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'duration_min', x.mins,
               'bookings',     x.n,
               'linked',       x.linked,
               'cafe_iqd',     x.cafe_iqd
             ) order by x.mins), '[]'::jsonb)
        from (select p.mins, count(*) as n, count(*) filter (where p.linked) as linked,
                     coalesce(sum(p.cafe_iqd), 0)::bigint as cafe_iqd
                from per_b p group by p.mins) x))
    into v_out
    from tot t;

  return v_out;
end $analytics_courts_cafe_0174$;

comment on function app.analytics_courts_cafe(date, date, uuid) is
  'event_court_blocks (§2.11), from 0147. Owner only: court players at the cafe for a business-day range (optionally one court): attach, per-court rows, top items, order timing, attach cells and durations; event_minutes at the top is the part of attach.open_minutes that event blocks hold.';

revoke all on function app.analytics_courts_cafe(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_cafe(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.report_courts — 0097 body verbatim plus eventMinutes per court and
--    in the totals, and its column beside available minutes (#55: the
--    courts report keeps its Events line).
-- ---------------------------------------------------------------------------
create or replace function app.report_courts(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_courts_0174$
declare
  v_b       record;
  v_court   uuid;
  v_rows    jsonb;
  v_totals  jsonb;
  v_by_hour jsonb;
  v_trend   jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'courtId' and jsonb_typeof(p_filters -> 'courtId') <> 'null' then
    begin
      v_court := (p_filters ->> 'courtId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'courtId';
    end;
  end if;

  with
  b as (
    select r.id, r.court_id, r.status, r.start_at, r.end_at,
           coalesce(r.price_iqd, 0)::bigint                                   as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int            as mins,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)              as d,
           extract(hour from (r.start_at at time zone v_b.tz))::int           as hour,
           r.status in ('confirmed','arrived','completed')                    as live,
           rp.price_iqd                                                       as rule_price,
           (select max(p2.price_iqd)
              from rate_rules rr
              join rate_rule_prices p2 on p2.rule_id = rr.id
             where rr.is_active
               and (rr.court_id is null or rr.court_id = r.court_id)
               and p2.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int) as max_price
      from reservations r
      left join rate_rule_prices rp
             on rp.rule_id = r.rate_rule_id
            and rp.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int
     where r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (v_court is null or r.court_id = v_court)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where (v_court is null or c.id = v_court)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, sum(o.open_minutes)::bigint as open_minutes, sum(o.event_minutes)::bigint as event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, v_court) o
      join courts_in ci on ci.id = o.court_id
     group by o.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(oc.open_minutes, 0)::bigint                                as avail,
           coalesce(oc.event_minutes, 0)::bigint                               as event_minutes,
           count(b.id) filter (where b.live)                                   as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint              as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint         as revenue_iqd,
           count(b.id) filter (where b.status = 'cancelled')                   as cancellations,
           count(b.id) filter (where b.status = 'no_show')                     as no_shows,
           count(b.id) filter (where b.live and b.rule_price is not null
                                 and b.max_price is not null and b.rule_price >= b.max_price) as peak,
           count(b.id) filter (where b.live and not (b.rule_price is not null
                                 and b.max_price is not null and b.rule_price >= b.max_price)) as off_peak
      from courts_in c
      left join oc on oc.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, oc.open_minutes, oc.event_minutes)
  select coalesce(jsonb_agg(jsonb_build_object(
           'courtId',                    pc.id,
           'courtNameEn',                pc.name_en,
           'courtNameAr',                pc.name_ar,
           'isActive',                   pc.is_active,
           'bookings',                   pc.bookings,
           'bookedMinutes',              pc.booked_minutes,
           'availableMinutes',           pc.avail,
           'eventMinutes',               pc.event_minutes,
           'occupancyPct',               case when pc.avail > 0 then round(pc.booked_minutes * 100.0 / pc.avail, 1) end,
           'revenueIqd',                 pc.revenue_iqd,
           'revenuePerAvailableHourIqd', case when pc.avail > 0 then round(pc.revenue_iqd * 60.0 / pc.avail)::bigint end,
           'cancellations',              pc.cancellations,
           'noShows',                    pc.no_shows,
           'cancellationRatePct',        case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                              then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
           'noShowRatePct',              case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                              then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
           'peakBookings',               pc.peak,
           'offPeakBookings',            pc.off_peak
         ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb),
         jsonb_build_object(
           'bookings',         coalesce(sum(pc.bookings), 0)::bigint,
           'bookedMinutes',    coalesce(sum(pc.booked_minutes), 0)::bigint,
           'availableMinutes', coalesce(sum(pc.avail), 0)::bigint,
           'eventMinutes',     coalesce(sum(pc.event_minutes), 0)::bigint,
           'occupancyPct',     case when coalesce(sum(pc.avail), 0) > 0
                                    then round(coalesce(sum(pc.booked_minutes), 0) * 100.0 / sum(pc.avail), 1) end,
           'revenueIqd',       coalesce(sum(pc.revenue_iqd), 0)::bigint,
           'cancellations',    coalesce(sum(pc.cancellations), 0)::bigint,
           'noShows',          coalesce(sum(pc.no_shows), 0)::bigint,
           'peakBookings',     coalesce(sum(pc.peak), 0)::bigint,
           'offPeakBookings',  coalesce(sum(pc.off_peak), 0)::bigint)
    into v_rows, v_totals
    from per_court pc;

  -- byHour: every venue-local hour 0..23 (a chart wants the full axis).
  select jsonb_agg(jsonb_build_object('hour', h.hour, 'bookings', coalesce(x.n, 0)) order by h.hour)
    into v_by_hour
    from generate_series(0, 23) as h(hour)
    left join (
      select extract(hour from (r.start_at at time zone v_b.tz))::int as hour, count(*) as n
        from reservations r
       where r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (v_court is null or r.court_id = v_court)
       group by 1) x on x.hour = h.hour;

  -- trend: one entry per business day that had a live booking.
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', x.d, 'bookings', x.n, 'revenueIqd', x.rev) order by x.d), '[]'::jsonb)
    into v_trend
    from (
      select app.business_date(r.start_at, v_b.tz, v_b.start_hour) as d,
             count(*)                                             as n,
             coalesce(sum(r.price_iqd), 0)::bigint                as rev
        from reservations r
       where r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (v_court is null or r.court_id = v_court)
       group by 1) x;

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','courtNameEn',                'labelEn','Court',               'labelAr','الملعب',                 'kind','text'),
      jsonb_build_object('key','bookings',                   'labelEn','Bookings',            'labelAr','الحجوزات',               'kind','count'),
      jsonb_build_object('key','bookedMinutes',              'labelEn','Booked minutes',      'labelAr','الدقائق المحجوزة',       'kind','count'),
      jsonb_build_object('key','availableMinutes',           'labelEn','Available minutes',   'labelAr','الدقائق المتاحة',        'kind','count'),
      jsonb_build_object('key','eventMinutes',               'labelEn','Event minutes',       'labelAr','دقائق الفعاليات',        'kind','count'),
      jsonb_build_object('key','occupancyPct',               'labelEn','Occupancy',           'labelAr','الإشغال',                'kind','pct'),
      jsonb_build_object('key','revenueIqd',                 'labelEn','Revenue',             'labelAr','الإيراد',                'kind','money'),
      jsonb_build_object('key','revenuePerAvailableHourIqd', 'labelEn','Revenue / open hour', 'labelAr','الإيراد لكل ساعة متاحة', 'kind','money'),
      jsonb_build_object('key','cancellations',              'labelEn','Cancellations',       'labelAr','الإلغاءات',              'kind','count'),
      jsonb_build_object('key','noShows',                    'labelEn','No-shows',            'labelAr','عدم الحضور',             'kind','count'),
      jsonb_build_object('key','cancellationRatePct',        'labelEn','Cancellation rate',   'labelAr','نسبة الإلغاء',           'kind','pct'),
      jsonb_build_object('key','noShowRatePct',              'labelEn','No-show rate',        'labelAr','نسبة عدم الحضور',        'kind','pct'),
      jsonb_build_object('key','peakBookings',               'labelEn','Peak',                'labelAr','وقت الذروة',             'kind','count'),
      jsonb_build_object('key','offPeakBookings',            'labelEn','Off-peak',            'labelAr','خارج الذروة',            'kind','count')),
    'rows',       v_rows,
    'totals',     v_totals,
    'byHour',     coalesce(v_by_hour, '[]'::jsonb),
    'trend',      v_trend,
    'comparison', null);
end $report_courts_0174$;

comment on function app.report_courts(date, date, jsonb) is
  'event_court_blocks (§2.11), from 0097. MGMT: the courts report for a business-day range (p_filters.courtId narrows to one court): per-court rows and totals with availableMinutes (event hours included) and eventMinutes (the part event blocks hold), byHour and the daily trend.';

revoke all on function app.report_courts(date, date, jsonb) from public, anon;
grant execute on function app.report_courts(date, date, jsonb) to authenticated;
