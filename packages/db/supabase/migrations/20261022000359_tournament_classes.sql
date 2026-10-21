set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0359 tournament_classes — a tournament may be for more than one class
-- (owner, 2026-10-22: "make it so that you can choose more than one class").
-- The desk's plan also stops asking for the years played; 0339's column and
-- its registration check stay for the tournaments that name a bracket.
--
--   1. tournaments.classes text[]: every class the tournament is for, one to
--      three of A, B, C in A-B-C order, backfilled with the one class each
--      tournament had. Never null: tournaments_classes says so, NOT VALID then
--      validated (the migration gate refuses SET NOT NULL, a scan under ACCESS
--      EXCLUSIVE; 0129's way). tournaments.class stays, the first of them
--      (the same CHECK ties the two), so a phone or desk build before this one
--      still reads a class. No client grant (tournaments has none, 0299).
--   2. protocol_check_tournament_plan (latest 0339) takes `classes` (an array,
--      RECORD_INVALID hint classes), or `class` from a desk build before this
--      one, and returns both: classes in A-B-C order and class the first.
--   3. tournament_publish (latest 0339) writes classes and class from the
--      plan (a run checked before this carries one class).
--   4. tournament_register (latest 0339): the guest's level must fit ONE of
--      the classes; the years check is 0339's, unchanged.
--   5. tournaments_public, tournament_public (latest 0339), desk_tournament_detail
--      (latest 0311), assistant_tournaments_summary (latest 0328) and
--      tournament_context (latest 0174) return classes beside class. Labels
--      the desk set, not guest data.

-- ===========================================================================
-- 1. The column
-- ===========================================================================
alter table tournaments add column if not exists classes text[];

update tournaments set classes = array[class] where classes is null;

do $tournaments_classes_0359$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'tournaments_classes'
                    and conrelid = 'public.tournaments'::regclass) then
    alter table tournaments add constraint tournaments_classes
      check (classes is not null
             and cardinality(classes) between 1 and 3
             and classes <@ array['A', 'B', 'C']::text[]
             and classes[1] = class) not valid;
  end if;
end $tournaments_classes_0359$;

do $tournaments_classes_validate_0359$
begin
  if exists (select 1 from pg_constraint
              where conname = 'tournaments_classes'
                and conrelid = 'public.tournaments'::regclass
                and not convalidated) then
    alter table tournaments validate constraint tournaments_classes;
  end if;
end $tournaments_classes_validate_0359$;

comment on column tournaments.classes is
  '0359. Every class the tournament is for (A advanced, B intermediate, C beginners), one to three in A-B-C order, from the plan. tournament_register takes a guest whose level fits any of them. tournaments.class is the first, kept for builds before 0359.';

-- ===========================================================================
-- 2. The plan check (0339)
-- ===========================================================================
create or replace function app.protocol_check_tournament_plan(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_tournament_plan_0359$
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
  v_classes text[];
begin
  select r.* into v_run
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  v_short := v_run.variant = 'type2';

  perform app.tournament_only_keys(p_record,
    case when v_short then array['classes', 'class', 'play_years', 'name_en', 'name_ar', 'ranges', 'capacity', 'notes']
         else array['classes', 'class', 'play_years', 'name_en', 'name_ar', 'format', 'ranges', 'capacity', 'entry_fee_iqd', 'prize',
                    'budget_iqd', 'expected_entries', 'risks', 'notes', 'sponsor'] end,
    null);

  -- 0359: the classes it is for, one to three of A, B, C, none twice, kept
  -- in A-B-C order. A plan from a desk build before 0359 names one class.
  if p_record->'classes' is not null and p_record->'classes' <> 'null'::jsonb then
    if jsonb_typeof(p_record->'classes') <> 'array'
       or jsonb_array_length(p_record->'classes') not between 1 and 3
       or exists (select 1 from jsonb_array_elements(p_record->'classes') x
                   where jsonb_typeof(x) <> 'string' or x #>> '{}' not in ('A', 'B', 'C'))
       or (select count(distinct x) from jsonb_array_elements_text(p_record->'classes') x)
          <> jsonb_array_length(p_record->'classes') then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'classes';
    end if;
    v_classes := array(select x from jsonb_array_elements_text(p_record->'classes') x order by x);
  elsif jsonb_typeof(p_record->'class') = 'string' and p_record->>'class' in ('A', 'B', 'C') then
    v_classes := array[p_record->>'class'];
  else
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'classes';
  end if;
  -- 0339: the playing-years bracket, optional (a plan started before it has
  -- none, and a tournament without one asks nothing about years).
  if p_record->'play_years' is not null and p_record->'play_years' <> 'null'::jsonb
     and (jsonb_typeof(p_record->'play_years') <> 'string'
          or p_record->>'play_years' not in ('under_one', 'one_to_three', 'three_plus')) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'play_years';
  end if;
  v_out := jsonb_build_object(
    'classes', to_jsonb(v_classes),
    -- The first of them, for a reader before 0359 (tournaments.class).
    'class',   v_classes[1],
    'play_years', p_record->>'play_years',
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
end $protocol_check_tournament_plan_0359$;

comment on function app.protocol_check_tournament_plan(uuid, jsonb, text[]) is
  'event_court_blocks (§2.8; 0339 play_years; 0359 classes). Internal check hook: the plan {classes (one to three of A | B | C, distinct; a plan before 0359 names one class instead), play_years? (under_one | one_to_three | three_plus: the players'' years bracket), name_en, name_ar, format (type 1 and 3), ranges: [{court_ids, from, to}] (1-14, active courts at the run''s venue), capacity: {unit, count 2-512}, entry_fee_iqd?, prize?, budget_iqd?, expected_entries?, risks?, notes?, sponsor?}; type 2 takes the short form. SPONSOR_DETAILS_REQUIRED for type 3 without a sponsor; RECORD_INVALID and TEXT_TOO_LONG with the field as hint. Returns the normalised record, carrying classes in A-B-C order and class (the first of them).';

revoke all on function app.protocol_check_tournament_plan(uuid, jsonb, text[]) from public, anon, authenticated;

-- ===========================================================================
-- 3. Publish (0339)
-- ===========================================================================
create or replace function app.tournament_publish(p_run_id uuid, p_settings jsonb, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_publish_0359$
declare
  c_keys constant text[] := array['format', 'category', 'points_target', 'rounds', 'min_entries',
                                  'waitlist_max', 'registration_closes_at', 'prize_en', 'prize_ar'];
  v_run       protocol_runs%rowtype;
  v_s         jsonb := coalesce(p_settings, '{}'::jsonb);
  v_replay    jsonb;
  v_data      jsonb;
  v_key       text;
  v_count     bigint;
  v_max       int;
  v_format    text;
  v_category  text := 'open';
  v_points    int := 24;
  v_rounds    int;
  v_min       int := 4;
  v_wait      int := 8;
  v_n         bigint;
  v_closes    timestamptz;
  v_prize_en  text;
  v_prize_ar  text;
  v_fee       bigint;
  v_court     uuid;
  v_classes   text[];
  v_first     timestamptz;
  v_last      timestamptz;
  v_blocks    jsonb;
  v_unblocked jsonb;
  v_id        uuid;
  v_constraint text;
  v_result    jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  if jsonb_typeof(v_s) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_settings';
  end if;

  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or v_run.kind <> 'tournament'
     or not (v_run.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  if not app.tournament_on(v_run.venue_id) then
    raise exception 'TOURNAMENTS_OFF' using errcode = 'P0001';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'tournament_publish');
  if v_replay is not null then
    return v_replay;
  end if;

  v_data := v_run.data;
  if v_run.status <> 'done' then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'not_done',
      hint = 'only a finished tournament run is published';
  end if;
  if exists (select 1 from tournaments t where t.protocol_run_id = v_run.id) then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'already_published';
  end if;
  -- The unit is matched as a pattern so no body spells the word 0147 swept
  -- out (the 0147 suite reads every function body).
  if coalesce(v_data->'capacity'->>'unit', '') !~ '^player(s)$' then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'capacity_unit',
      hint = 'v1 plays individual entries: the plan''s capacity must count single entries';
  end if;
  begin
    v_count := (v_data->'capacity'->>'count')::bigint;
  exception when others then
    v_count := null;
  end;
  if v_count is null or v_count < 4 then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'capacity_count';
  end if;
  v_max := least(v_count, 64)::int;

  -- The format: type 1 and 3 plans carry it (the settings may only repeat it);
  -- a type 2 plan has none, so the settings must name it.
  if v_run.variant in ('type1', 'type3') then
    v_format := v_data->>'format';
    if v_format is null or v_format not in ('americano', 'mexicano')
       or (v_s->'format' is not null and v_s->'format' <> 'null'::jsonb
           and v_s->>'format' is distinct from v_format) then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'format';
    end if;
  else
    if jsonb_typeof(v_s->'format') is distinct from 'string' or v_s->>'format' not in ('americano', 'mexicano') then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'format';
    end if;
    v_format := v_s->>'format';
  end if;

  -- The fee (T-6): a fee needs the owner's OK on feasibility, on its current
  -- round. protocol_engine_decider with needs_owner_ok admits the owner only
  -- (0164:211) and an auto pass records the submitter (0164:528), so a passing
  -- row decided by an owner is the owner's OK. A type 2 plan has no fee.
  v_fee := case when v_run.variant in ('type1', 'type3')
                then coalesce((v_data->>'entry_fee_iqd')::bigint, 0) else 0 end;
  if v_fee > 0 and not exists (
       select 1
         from protocol_run_steps s
         join protocol_submissions x on x.run_step_id = s.id and x.round = s.round
         join staff st on st.id = x.decided_by
        where s.run_id = v_run.id
          and s.step_key = 'feasibility'
          and s.status = 'passed'
          and s.needs_owner_ok
          and x.withdrawn_at is null
          and x.superseded_at is null
          and x.decision in ('approve', 'auto')
          and st.role = 'owner') then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'fee_not_approved',
      hint = 'an entry fee needs the owner''s OK on the feasibility step';
  end if;

  if not exists (select 1 from reservations r
                  where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
                    and r.status in ('pending', 'confirmed', 'arrived') and r.end_at > now()
                    and app.tournament_plan_has_window(v_data, r.court_id, r.start_at, r.end_at)) then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'no_blocks';
  end if;

  -- The settings (§1.6): every key optional unless marked; an unknown key or a
  -- bad value is settings:<key>.
  select k into v_key from jsonb_object_keys(v_s) k where not (k = any (c_keys)) order by k limit 1;
  if v_key is not null then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:' || v_key;
  end if;
  if v_s->'category' is not null and v_s->'category' <> 'null'::jsonb then
    if jsonb_typeof(v_s->'category') <> 'string' or v_s->>'category' not in ('open', 'women', 'men') then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:category';
    end if;
    v_category := v_s->>'category';
  end if;
  foreach v_key in array array['points_target', 'rounds', 'min_entries', 'waitlist_max'] loop
    begin
      v_n := app.tournament_int(v_s->v_key,
               case v_key when 'points_target' then 8 when 'rounds' then 1 when 'min_entries' then 4 else 0 end,
               case v_key when 'points_target' then 64 when 'rounds' then 30 when 'min_entries' then v_max else 64 end,
               false, v_key);
    exception when others then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:' || v_key;
    end;
    if v_n is not null then
      case v_key
        when 'points_target' then v_points := v_n;
        when 'rounds'        then v_rounds := v_n;
        when 'min_entries'   then v_min := v_n;
        else                      v_wait := v_n;
      end case;
    end if;
  end loop;
  -- Mexicano plays one round at a time to a planned count; an Americano's
  -- length is its first schedule's, so a rounds value is ignored there.
  if v_format = 'mexicano' and v_rounds is null then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:rounds';
  end if;
  if v_format = 'americano' then
    v_rounds := null;
  end if;
  if jsonb_typeof(v_s->'registration_closes_at') is not distinct from 'string' then
    begin
      v_closes := (v_s->>'registration_closes_at')::timestamptz;
    exception when others then
      v_closes := null;
    end;
  end if;
  if v_closes is null or not isfinite(v_closes) or v_closes <= now() then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:registration_closes_at',
      hint = 'registration_closes_at is required: a time after now, no later than the first court block';
  end if;
  foreach v_key in array array['prize_en', 'prize_ar'] loop
    if v_s->v_key is not null and v_s->v_key <> 'null'::jsonb then
      if jsonb_typeof(v_s->v_key) <> 'string'
         or char_length(coalesce(app.safe_line(v_s->>v_key), '')) > 200 then
        raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:' || v_key;
      end if;
      if v_key = 'prize_en' then
        v_prize_en := nullif(btrim(app.safe_line(v_s->>v_key)), '');
      else
        v_prize_ar := nullif(btrim(app.safe_line(v_s->>v_key)), '');
      end if;
    end if;
  end loop;

  -- The courts, in court-id order (0042), then the blocks themselves.
  for v_court in
    select distinct r.court_id
      from reservations r
     where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived') and r.end_at > now()
       and app.tournament_plan_has_window(v_data, r.court_id, r.start_at, r.end_at)
     order by 1
  loop
    perform app.lock_court(v_court);
  end loop;
  perform 1
     from reservations r
    where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
      and r.status in ('pending', 'confirmed', 'arrived') and r.end_at > now()
      and app.tournament_plan_has_window(v_data, r.court_id, r.start_at, r.end_at)
      for update;

  select min(r.start_at), max(r.end_at),
         coalesce(jsonb_agg(jsonb_build_object('reservation_id', r.id, 'court_id', r.court_id,
                                               'start_at', r.start_at, 'end_at', r.end_at)
                            order by r.start_at, r.court_id, r.id), '[]'::jsonb)
    into v_first, v_last, v_blocks
    from reservations r
   where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
     and r.status in ('pending', 'confirmed', 'arrived') and r.end_at > now()
     and app.tournament_plan_has_window(v_data, r.court_id, r.start_at, r.end_at);
  if v_first is null then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'no_blocks';
  end if;
  if v_closes > v_first then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:registration_closes_at',
      hint = 'registration must close no later than the first court block starts';
  end if;

  -- S13: each court and window of the plan that no live block of the run covers.
  select coalesce(jsonb_agg(jsonb_build_object('court_id', c.id::uuid, 'start_at', (g.e->>'from')::timestamptz,
                                               'end_at', (g.e->>'to')::timestamptz)
                            order by (g.e->>'from')::timestamptz, c.id), '[]'::jsonb)
    into v_unblocked
    from jsonb_array_elements(case when jsonb_typeof(v_data->'ranges') = 'array'
                                   then v_data->'ranges' else '[]'::jsonb end) g(e)
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(g.e->'court_ids') = 'array'
                                                      then g.e->'court_ids' else '[]'::jsonb end) c(id)
   where not exists (select 1 from reservations r
                      where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
                        and r.status in ('pending', 'confirmed', 'arrived')
                        and r.court_id::text = c.id
                        and r.start_at = (g.e->>'from')::timestamptz
                        and r.end_at = (g.e->>'to')::timestamptz);

  -- 0359: the plan's classes; a run checked before 0359 carries one class.
  v_classes := case when jsonb_typeof(v_data->'classes') = 'array'
                    then array(select x from jsonb_array_elements_text(v_data->'classes') x order by x)
                    else array[v_data->>'class'] end;

  begin
    insert into tournaments
      (venue_id, protocol_run_id, name_en, name_ar, format, category, class, classes, play_years, points_target, rounds_planned,
       max_entries, min_entries, waitlist_max, entry_fee_iqd, prize_en, prize_ar, starts_at, ends_at,
       registration_closes_at, published_by)
    values
      (v_run.venue_id, v_run.id, v_data->>'name_en', v_data->>'name_ar', v_format, v_category, v_classes[1],
       v_classes, v_data->>'play_years', v_points, v_rounds, v_max, v_min, v_wait, v_fee, v_prize_en, v_prize_ar, v_first, v_last,
       v_closes, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'tournaments_protocol_run_id_key' then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'already_published';
    end if;
    raise;
  end;

  v_result := jsonb_build_object(
    'duplicate',         false,
    'tournament_id',     v_id,
    'status',            'open',
    'starts_at',         v_first,
    'ends_at',           v_last,
    'blocks',            v_blocks,
    'unblocked_windows', v_unblocked);
  perform app.write_audit('tournament.publish', 'tournaments', v_id::text, null,
                          jsonb_build_object('protocol_run_id', v_run.id, 'format', v_format,
                                             'category', v_category, 'max_entries', v_max,
                                             'min_entries', v_min, 'entry_fee_iqd', v_fee,
                                             'starts_at', v_first, 'ends_at', v_last,
                                             'registration_closes_at', v_closes,
                                             'blocks', jsonb_array_length(v_blocks)));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $tournament_publish_0359$;

comment on function app.tournament_publish(uuid, jsonb, text) is
  'Tournaments (M7, T-6, build contracts §1.6, §1.9, S13). Manager or owner at the run''s branch: a done tournament run becomes one tournaments row (names, classes (0359; class is the first of them) and play_years (0339) from the plan, max_entries = least(capacity.count, 64), the fee from the plan, starts_at/ends_at the adopted blocks'' span) adopting the run''s live event blocks on its plan (courts locked in court-id order, then the blocks FOR UPDATE). p_settings: format (type 2 required; type 1/3 must equal the plan''s), category, points_target 8..64, rounds (Mexicano required, 1..30; ignored for Americano), min_entries 4..max, waitlist_max 0..64, registration_closes_at (required, after now, no later than the first block), prize_en, prize_ar (<= 200). FORBIDDEN; INVALID_ARGUMENT (detail p_idempotency_key, p_settings); PROTOCOL_NOT_FOUND; VENUE_MISMATCH; TOURNAMENTS_OFF; a replay returns the stored answer; TOURNAMENT_PUBLISH_REFUSED detail not_done, already_published, capacity_unit, capacity_count, format, fee_not_approved (a fee without the owner''s OK on feasibility), no_blocks, settings:<key>. Audit tournament.publish. Returns {duplicate, tournament_id, status, starts_at, ends_at, blocks [{reservation_id, court_id, start_at, end_at}], unblocked_windows [{court_id, start_at, end_at}]}.';

revoke all on function app.tournament_publish(uuid, jsonb, text) from public, anon;
grant execute on function app.tournament_publish(uuid, jsonb, text) to authenticated;

-- ===========================================================================
-- 4. Register (0339): a level that fits one of the classes
-- ===========================================================================
create or replace function app.tournament_register(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_register_0359$
declare
  v_p      profiles;
  v_t      tournaments%rowtype;
  v_e      tournament_entries%rowtype;
  v_reg    int;
  v_wait   int;
  v_status text;
  v_pos    int;
begin
  -- AUTH, ACCOUNT, PHONE, TERMS, MATCH_BANNED, GENDER_REQUIRED (0260).
  v_p := app.match_guest(true);

  -- 0310 (s0): the branch is checked before the row is locked.
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or not exists (select 1 from venues v where v.id = v_t.venue_id and v.is_active) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.tournament_on(v_t.venue_id) then
    raise exception 'TOURNAMENTS_OFF' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_t.venue_id::text, true);
  select * into v_t from tournaments where id = v_t.id for update;

  select * into v_e from tournament_entries
   where tournament_id = v_t.id and guest_id = v_p.id
     for update;
  if v_e.id is not null and v_e.status in ('registered', 'waitlisted') then
    v_pos := case when v_e.status = 'waitlisted' then
               (select count(*)::int + 1 from tournament_entries w
                 where w.tournament_id = v_t.id and w.status = 'waitlisted'
                   and (w.entered_at, w.id) < (v_e.entered_at, v_e.id)) end;
    return jsonb_build_object('entry_id', v_e.id, 'status', v_e.status, 'waitlist_position', v_pos,
                              'duplicate', true);
  end if;
  if v_t.status <> 'open' or v_e.status is not distinct from 'no_show' then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;
  if now() >= v_t.registration_closes_at then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'cutoff';
  end if;
  if (v_t.category = 'women' and v_p.gender is distinct from 'female')
     or (v_t.category = 'men' and v_p.gender is distinct from 'male') then
    raise exception 'TOURNAMENT_CATEGORY_MISMATCH' using errcode = 'P0001';
  end if;
  -- 0339: who it is for. The level fits one of its classes (0359; advanced A,
  -- intermediate B, beginner or new C); when the tournament names a years bracket, the guest's
  -- years are that bracket (never counts as under_one). An unanswered question
  -- is PROFILE_REQUIRED, so the phone opens the survey; the desk adds anyone.
  if v_p.play_level is null then
    raise exception 'TOURNAMENT_PROFILE_REQUIRED' using errcode = 'P0001', detail = 'level';
  end if;
  if not ((case v_p.play_level when 'advanced' then 'A'
                                when 'intermediate' then 'B' else 'C' end) = any(v_t.classes)) then
    raise exception 'TOURNAMENT_LEVEL_MISMATCH' using errcode = 'P0001', detail = 'level';
  end if;
  if v_t.play_years is not null then
    if v_p.play_years is null then
      raise exception 'TOURNAMENT_PROFILE_REQUIRED' using errcode = 'P0001', detail = 'years';
    end if;
    if v_t.play_years is distinct from (case v_p.play_years when 'never' then 'under_one'
                                                             else v_p.play_years end) then
      raise exception 'TOURNAMENT_LEVEL_MISMATCH' using errcode = 'P0001', detail = 'years';
    end if;
  end if;

  select count(*) filter (where e.status = 'registered'), count(*) filter (where e.status = 'waitlisted')
    into v_reg, v_wait
    from tournament_entries e
   where e.tournament_id = v_t.id;
  if v_reg < v_t.max_entries then
    v_status := 'registered';
  elsif v_wait < v_t.waitlist_max then
    v_status := 'waitlisted';
  else
    raise exception 'TOURNAMENT_FULL' using errcode = 'P0001';
  end if;

  if v_e.id is not null then
    -- A withdrawn guest comes back: the same row, a fresh place in the queue.
    update tournament_entries
       set status = v_status, entered_at = now(), added_by_kind = 'guest', added_by_staff_id = null,
           withdrawn_reason = null, withdrawn_at = null, promoted_at = null, updated_at = now()
     where id = v_e.id
    returning * into v_e;
  else
    insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind)
    values (v_t.venue_id, v_t.id, v_p.id, v_status, 'guest')
    returning * into v_e;
  end if;

  v_pos := case when v_status = 'waitlisted' then v_wait + 1 end;
  perform app.write_audit('tournament.register', 'tournament_entries', v_e.id::text, null,
                          jsonb_build_object('tournament_id', v_t.id, 'status', v_status));
  return jsonb_build_object('entry_id', v_e.id, 'status', v_status, 'waitlist_position', v_pos,
                            'duplicate', false);
end $tournament_register_0359$;

comment on function app.tournament_register(uuid) is
  'Tournaments (M7, T-4, §1.6). Guest: app.match_guest(true) first (AUTH_REQUIRED, ACCOUNT_REQUIRED, PHONE_REQUIRED, TERMS_REQUIRED, MATCH_BANNED, GENDER_REQUIRED); then TOURNAMENT_NOT_FOUND (unknown, or its branch not open to guests), TOURNAMENTS_OFF, a live entry answers duplicate true, TOURNAMENT_NOT_OPEN detail status (not open, or a no-show row) or cutoff (past registration_closes_at), TOURNAMENT_CATEGORY_MISMATCH; 0339: TOURNAMENT_PROFILE_REQUIRED (detail level | years: that play survey question is unanswered), TOURNAMENT_LEVEL_MISMATCH (detail level | years: the level fits none of the classes (0359), or the years are not the tournament''s bracket) (women / men against profiles.gender). registered while fewer than max_entries are, else waitlisted while fewer than waitlist_max are, else TOURNAMENT_FULL; a withdrawn row is re-used with a fresh entered_at. Audit tournament.register. Returns {entry_id, status, waitlist_position, duplicate}.';

revoke all on function app.tournament_register(uuid) from public, anon;
grant execute on function app.tournament_register(uuid) to authenticated;

-- ===========================================================================
-- 5. The reads (0339, 0311, 0328, 0174)
-- ===========================================================================
create or replace function app.tournaments_public(p_venue_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournaments_public_0359$
declare
  v_uid      uuid := auth.uid();
  v_venues   uuid[];
  v_branches jsonb;
  v_rows     jsonb;
begin
  -- Open branches with tournaments on; a named branch that is off, closed or
  -- unknown, or none at all, is {off: true} and nothing else.
  select coalesce(array_agg(v.id order by v.created_at, v.id), '{}'::uuid[])
    into v_venues
    from venues v
    join venue_settings vs on vs.venue_id = v.id
   where v.is_active
     and vs.tournaments_enabled
     and (p_venue_id is null or v.id = p_venue_id);
  if cardinality(v_venues) = 0 then
    return jsonb_build_object('off', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'venue_id', v.id,
           'name_en', v.name_en,
           'name_ar', v.name_ar,
           'timezone', coalesce(vs.timezone, v.timezone))
           order by v.created_at, v.id), '[]'::jsonb)
    into v_branches
    from venues v
    left join venue_settings vs on vs.venue_id = v.id
   where v.id = any (v_venues);

  select coalesce(jsonb_agg(x.j order by x.starts_at, x.id), '[]'::jsonb)
    into v_rows
    from (select t.id, t.starts_at,
                 jsonb_build_object(
                   'id', t.id,
                   'venue_id', t.venue_id,
                   'name_en', t.name_en,
                   'name_ar', t.name_ar,
                   'format', t.format,
                   'category', t.category,
                   'class', t.class,
                   'classes', to_jsonb(t.classes),
                   'play_years', t.play_years,
                   'starts_at', t.starts_at,
                   'ends_at', t.ends_at,
                   'registration_closes_at', t.registration_closes_at,
                   'entry_fee_iqd', t.entry_fee_iqd,
                   'prize_en', t.prize_en,
                   'prize_ar', t.prize_ar,
                   'max_entries', t.max_entries,
                   'places_left', greatest(t.max_entries - c.reg, 0),
                   'waitlist_open', t.status = 'open' and now() < t.registration_closes_at
                                    and c.reg >= t.max_entries and c.wait < t.waitlist_max,
                   'status', t.status,
                   'mine', case when v_uid is null then null else
                             (select jsonb_build_object(
                                       'entry_id', me.id,
                                       'status', me.status,
                                       'waitlist_position',
                                         case when me.status = 'waitlisted' then
                                           (select count(*)::int + 1 from tournament_entries w
                                             where w.tournament_id = t.id and w.status = 'waitlisted'
                                               and (w.entered_at, w.id) < (me.entered_at, me.id)) end)
                                from tournament_entries me
                               where me.tournament_id = t.id and me.guest_id = v_uid) end) as j
            from tournaments t
            cross join lateral (
              select count(*) filter (where e.status = 'registered')::int as reg,
                     count(*) filter (where e.status = 'waitlisted')::int as wait
                from tournament_entries e
               where e.tournament_id = t.id) c
           where t.venue_id = any (v_venues)
             and (t.status in ('open', 'closed', 'running')
                  or (t.status = 'finished' and t.finished_at > now() - interval '7 days'))) x;

  return jsonb_build_object('off', false, 'server_now', now(), 'branches', v_branches, 'tournaments', v_rows);
end $tournaments_public_0359$;

comment on function app.tournaments_public(uuid) is
  'Tournaments (M7, T-8, §1.6, §1.8, review M7; 0339 class, play_years; 0359 classes). Public by design (anon and authenticated; never raises): {off: true} for an unknown, closed or switched-off branch (or, with p_venue_id null, when no open branch runs tournaments); otherwise {off: false, server_now, branches [{venue_id, name_en, name_ar, timezone}], tournaments [{id, venue_id, name_en, name_ar, format, category, class (A advanced | B intermediate | C beginners; 0339; the first of classes since 0359), classes (0359: every class it is for, A-B-C order), play_years (under_one | one_to_three | three_plus | null = any experience; 0339), starts_at, ends_at, registration_closes_at, entry_fee_iqd, prize_en, prize_ar, max_entries, places_left, waitlist_open, status, mine}]} for open, closed and running tournaments and those finished in the last 7 days. mine is the caller''s own entry {entry_id, status, waitlist_position} (with a session), else null. No names, no court ids, no guest data.';

revoke all on function app.tournaments_public(uuid) from public;
grant execute on function app.tournaments_public(uuid) to anon, authenticated;

create or replace function app.tournament_public(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_public_0359$
declare
  v_uid       uuid := auth.uid();
  v_t         tournaments%rowtype;
  v_branch    jsonb;
  v_reg       int;
  v_wait      int;
  v_who       jsonb;
  v_courtno   jsonb;
  v_rounds    jsonb := '[]'::jsonb;
  v_standings jsonb := '[]'::jsonb;
  v_me        jsonb;
  v_entries   jsonb := '[]'::jsonb;
begin
  if p_id is null then
    return jsonb_build_object('missing', true, 'entries', '[]'::jsonb);
  end if;
  select * into v_t from tournaments where id = p_id;
  if not found or not app.tournament_on(v_t.venue_id)
     or (v_t.status = 'cancelled' and v_t.cancelled_at < now() - interval '7 days') then
    return jsonb_build_object('missing', true, 'entries', '[]'::jsonb);
  end if;

  select jsonb_build_object('venue_id', v.id, 'name_en', v.name_en, 'name_ar', v.name_ar,
                            'timezone', coalesce(vs.timezone, v.timezone))
    into v_branch
    from venues v left join venue_settings vs on vs.venue_id = v.id
   where v.id = v_t.venue_id;
  select count(*) filter (where e.status = 'registered')::int, count(*) filter (where e.status = 'waitlisted')::int
    into v_reg, v_wait
    from tournament_entries e
   where e.tournament_id = v_t.id;

  -- 0334: the registered entries in registration order (when each became
  -- registered: a promoted waitlist entry at its promotion), before and after
  -- the schedule exists, for the seating board. The player is the public
  -- shape the rounds use; mine is the caller's own entry (false for anon).
  select coalesce(jsonb_agg(jsonb_build_object(
           'player', jsonb_build_object(
             'name', case when e.added_by_kind = 'staff' and p.terms_version is null then null
                          else d.v->>'name' end,
             'former', coalesce((d.v->>'former')::boolean, false),
             'no', e.seed_no),
           'mine', coalesce(e.guest_id = v_uid, false))
           order by coalesce(e.promoted_at, e.entered_at), e.id), '[]'::jsonb)
    into v_entries
    from tournament_entries e
    left join profiles p on p.id = e.guest_id
    cross join lateral (select app.match_display_name(e.guest_id) as v) d
   where e.tournament_id = v_t.id
     and e.status = 'registered';

  if exists (select 1 from tournament_rounds r where r.tournament_id = v_t.id) then
    -- Every entry that can appear in the schedule or the standings.
    select coalesce(jsonb_object_agg(e.id::text, jsonb_build_object(
             'name', case when e.added_by_kind = 'staff' and p.terms_version is null then null
                          else d.v->>'name' end,
             'former', coalesce((d.v->>'former')::boolean, false),
             'no', e.seed_no)), '{}'::jsonb)
      into v_who
      from tournament_entries e
      left join profiles p on p.id = e.guest_id
      cross join lateral (select app.match_display_name(e.guest_id) as v) d
     where e.tournament_id = v_t.id and e.status <> 'waitlisted';

    select coalesce(jsonb_object_agg(c.id::text, c.n), '{}'::jsonb)
      into v_courtno
      from (select c.id, row_number() over (order by c.sort_order, c.id) as n
              from courts c
             where c.id in (select m.court_id from tournament_matches m where m.tournament_id = v_t.id)) c;

    select coalesce(jsonb_agg(jsonb_build_object(
             'round_no', r.round_no,
             'sit_out', coalesce((select jsonb_agg(v_who->(b.id::text) order by b.ord)
                                    from unnest(r.bye_entry_ids) with ordinality b(id, ord)), '[]'::jsonb),
             'matches', coalesce((select jsonb_agg(jsonb_build_object(
                                           'court_no', (v_courtno->>(m.court_id::text))::int,
                                           'a', jsonb_build_array(v_who->(m.a1::text), v_who->(m.a2::text)),
                                           'b', jsonb_build_array(v_who->(m.b1::text), v_who->(m.b2::text)),
                                           'points_a', m.points_a,
                                           'points_b', m.points_b)
                                           order by (v_courtno->>(m.court_id::text))::int)
                                    from tournament_matches m
                                   where m.round_id = r.id), '[]'::jsonb))
             order by r.round_no), '[]'::jsonb)
      into v_rounds
      from tournament_rounds r
     where r.tournament_id = v_t.id;

    -- The function's own order, as the desk reads it.
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', s.rank,
             'player', v_who->(s.entry_id::text),
             'points_won', s.points_won,
             'diff', s.diff,
             'played', s.played,
             'withdrawn', s.withdrawn)
             order by s.rank, se.seed_no nulls last, s.entry_id), '[]'::jsonb)
      into v_standings
      from app.tournament_standings(v_t.id) s
      left join tournament_entries se on se.id = s.entry_id;
  end if;

  if v_uid is not null then
    select jsonb_build_object(
             'entry_id', e.id,
             'status', e.status,
             'waitlist_position',
               case when e.status = 'waitlisted' then
                 (select count(*)::int + 1 from tournament_entries w
                   where w.tournament_id = e.tournament_id and w.status = 'waitlisted'
                     and (w.entered_at, w.id) < (e.entered_at, e.id)) end,
             'owed_iqd', (app.tournament_entry_money(e.id)->>'owed_iqd')::bigint)
      into v_me
      from tournament_entries e
     where e.tournament_id = v_t.id and e.guest_id = v_uid;
  end if;

  return jsonb_build_object(
    'missing', false,
    'id', v_t.id,
    'venue_id', v_t.venue_id,
    'branch', v_branch,
    'name_en', v_t.name_en,
    'name_ar', v_t.name_ar,
    'format', v_t.format,
    'category', v_t.category,
    'class', v_t.class,
    'classes', to_jsonb(v_t.classes),
    'play_years', v_t.play_years,
    'points_target', v_t.points_target,
    'rounds_planned', v_t.rounds_planned,
    'starts_at', v_t.starts_at,
    'ends_at', v_t.ends_at,
    'registration_closes_at', v_t.registration_closes_at,
    'entry_fee_iqd', v_t.entry_fee_iqd,
    'prize_en', v_t.prize_en,
    'prize_ar', v_t.prize_ar,
    'status', v_t.status,
    'max_entries', v_t.max_entries,
    'entries_count', v_reg,
    'places_left', greatest(v_t.max_entries - v_reg, 0),
    'waitlist_open', v_t.status = 'open' and now() < v_t.registration_closes_at
                     and v_reg >= v_t.max_entries and v_wait < v_t.waitlist_max,
    'server_now', now(),
    'rounds', v_rounds,
    'standings', v_standings,
    'entries', v_entries,
    'me', v_me);
end $tournament_public_0359$;

comment on function app.tournament_public(uuid) is
  'Tournaments (M7, T-8, §1.8, review M8; 0311 c27; 0334 entries; 0339 class, play_years; 0359 classes). Public by design (anon and authenticated; never raises): {missing: true, entries: []} for an unknown id, a branch closed or switched off, or a tournament cancelled more than 7 days ago; otherwise {missing: false, id, venue_id, branch {venue_id, name_en, name_ar, timezone}, name_en, name_ar, format, category, class (the first of classes), classes (0359), play_years, points_target, rounds_planned, starts_at, ends_at, registration_closes_at, entry_fee_iqd, prize_en, prize_ar, status, max_entries, entries_count (registered), places_left, waitlist_open, server_now, rounds [{round_no, sit_out [player], matches [{court_no, a [player, player], b [player, player], points_a, points_b}]}], standings [{rank, player, points_won, diff, played, withdrawn (0311: left the play; ranked after every registered entry)}], entries [{player, mine}] (0334: the registered entries in registration order, promoted_at for a promoted waitlist entry else entered_at, then id; present before and after the schedule exists; mine is the caller''s own entry, false for anon), me {entry_id, status, waitlist_position, owed_iqd} (the caller''s own entry, with a session) | null}. A player is {name ("First I." via app.match_display_name, null for a desk-added profile with no accepted terms), former (a deleted account), no (seed_no)}; rounds and standings are empty until a schedule exists (entries is not: 0334, the seating board names the registered entries before the draw; no is null until seeds are given), and the waitlist is never named. court_no is an ordinal; no court id, guest id, phone or full name.';

revoke all on function app.tournament_public(uuid) from public;
grant execute on function app.tournament_public(uuid) to anon, authenticated;

create or replace function app.desk_tournament_detail(p_tournament_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $desk_tournament_detail_0359$
declare
  v_t         tournaments%rowtype;
  v_tz        text;
  v_entries   jsonb;
  v_courts    jsonb;
  v_rounds    jsonb;
  v_standings jsonb;
  v_desk      boolean;
  v_mgmt      boolean;
  v_till      boolean;
begin
  -- The role first (R57): the entries carry every guest's name and phone.
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or not (v_t.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  select coalesce(vs.timezone, v.timezone) into v_tz
    from venues v left join venue_settings vs on vs.venue_id = v.id
   where v.id = v_t.venue_id;
  v_desk := app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner');
  v_mgmt := app.is_staff_at(v_t.venue_id, 'manager', 'owner');
  v_till := app.is_staff_at(v_t.venue_id, 'cashier', 'court_desk', 'manager', 'owner');

  -- Registered by seed (then entered_at), the waitlist in its order, then the rest.
  select coalesce(jsonb_agg(x.j order by x.k1, x.k2, x.k3, x.id), '[]'::jsonb)
    into v_entries
    from (select e.id,
                 case e.status when 'registered' then 0 when 'waitlisted' then 1 when 'no_show' then 2 else 3 end as k1,
                 coalesce(e.seed_no, 32767) as k2,
                 e.entered_at as k3,
                 jsonb_build_object(
                   'entry_id', e.id,
                   'guest_id', e.guest_id,
                   'full_name', p.full_name,
                   'phone', p.phone,
                   'status', e.status,
                   'seed_no', e.seed_no,
                   'waitlist_position',
                     case when e.status = 'waitlisted' then
                       (select count(*)::int + 1 from tournament_entries w
                         where w.tournament_id = e.tournament_id and w.status = 'waitlisted'
                           and (w.entered_at, w.id) < (e.entered_at, e.id)) end,
                   'added_by_kind', e.added_by_kind,
                   'owed_iqd', (m.money->>'owed_iqd')::bigint,
                   'net_paid_iqd', (m.money->>'net_iqd')::bigint,
                   'refund_due_iqd', (m.money->>'refund_due_iqd')::bigint,
                   'substitute_for', e.substitute_for,
                   -- 0310 (c9): the payments a refund is made against.
                   'payments', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'payment_id',     py.id,
                              'tab_id',         tb.id,
                              'method',         py.method,
                              'amount_iqd',     py.amount_iqd,
                              'refunded_iqd',   coalesce(rf.refunded, 0),
                              'refundable_iqd', py.amount_iqd - coalesce(rf.refunded, 0),
                              'created_at',     py.created_at) order by py.created_at, py.id)
                       from tabs tb
                       join payments py on py.tab_id = tb.id
                       left join lateral (select sum(x.amount_iqd)::bigint as refunded
                                            from refunds x where x.payment_id = py.id) rf on true
                      where tb.tournament_entry_id = e.id and tb.kind = 'tournament'
                        and tb.status = 'settled' and tb.merged_into_tab_id is null), '[]'::jsonb)) as j
            from tournament_entries e
            left join profiles p on p.id = e.guest_id
            cross join lateral (select app.tournament_entry_money(e.id) as money) m
           where e.tournament_id = v_t.id) x;

  -- The courts of the run's live adopted blocks.
  select coalesce(jsonb_agg(jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar,
                                               'sort_order', c.sort_order)
                            order by c.sort_order, c.id), '[]'::jsonb)
    into v_courts
    from courts c
   where c.id in (select r.court_id from reservations r
                   where r.protocol_run_id = v_t.protocol_run_id and r.block_purpose = 'event'
                     and r.status in ('pending', 'confirmed', 'arrived'));

  select coalesce(jsonb_agg(jsonb_build_object(
           'round_no', r.round_no,
           'sit_out', to_jsonb(r.bye_entry_ids),
           'matches', coalesce((select jsonb_agg(jsonb_build_object(
                                         'match_id', m.id,
                                         'court_id', m.court_id,
                                         'a', jsonb_build_array(m.a1, m.a2),
                                         'b', jsonb_build_array(m.b1, m.b2),
                                         'points_a', m.points_a,
                                         'points_b', m.points_b,
                                         'revision', m.revision,
                                         'corrections', greatest((select count(*) from tournament_score_events s
                                                                   where s.match_id = m.id) - 1, 0))
                                         order by c.sort_order, c.id)
                                  from tournament_matches m
                                  join courts c on c.id = m.court_id
                                 where m.round_id = r.id), '[]'::jsonb))
           order by r.round_no), '[]'::jsonb)
    into v_rounds
    from tournament_rounds r
   where r.tournament_id = v_t.id;

  -- In the function's own order: a tie on rank goes by seed, then entry id.
  select coalesce(jsonb_agg(to_jsonb(s) order by s.rank, se.seed_no nulls last, s.entry_id), '[]'::jsonb)
    into v_standings
    from app.tournament_standings(v_t.id) s
    left join tournament_entries se on se.id = s.entry_id;

  return jsonb_build_object(
    'id', v_t.id,
    'venue_id', v_t.venue_id,
    'protocol_run_id', v_t.protocol_run_id,
    'name_en', v_t.name_en,
    'name_ar', v_t.name_ar,
    'format', v_t.format,
    'category', v_t.category,
    'class', v_t.class,
    'classes', to_jsonb(v_t.classes),
    'points_target', v_t.points_target,
    'rounds_planned', v_t.rounds_planned,
    'max_entries', v_t.max_entries,
    'min_entries', v_t.min_entries,
    'waitlist_max', v_t.waitlist_max,
    'entry_fee_iqd', v_t.entry_fee_iqd,
    'prize_en', v_t.prize_en,
    'prize_ar', v_t.prize_ar,
    'starts_at', v_t.starts_at,
    'ends_at', v_t.ends_at,
    'registration_closes_at', v_t.registration_closes_at,
    'status', v_t.status,
    'cancel_reason', v_t.cancel_reason,
    'revision', v_t.revision,
    'closed_at', v_t.closed_at,
    'finished_at', v_t.finished_at,
    'cancelled_at', v_t.cancelled_at,
    'sweep_errors', v_t.sweep_errors,
    'timezone', v_tz,
    'server_now', now(),
    'entries', v_entries,
    'courts', v_courts,
    'rounds', v_rounds,
    'standings', v_standings,
    'can', jsonb_build_object(
      'add', v_desk and v_t.status in ('open', 'closed'),
      'set_rounds', v_desk and v_t.status in ('closed', 'running'),
      -- 0311 (c35): the server's rule. After the finish a score is a
      -- manager's, within 48 hours of finished_at.
      'score', (v_desk and v_t.status = 'running')
               or (v_mgmt and v_t.status = 'finished'
                   and now() <= coalesce(v_t.finished_at, v_t.ends_at) + interval '48 hours'),
      'cancel', v_mgmt and v_t.status in ('open', 'closed', 'running'),
      'close', v_desk and v_t.status = 'open' and (v_mgmt or now() >= v_t.registration_closes_at),
      'finish', v_mgmt and v_t.status = 'running',
      'settle', v_till and v_t.status <> 'cancelled'));
end $desk_tournament_detail_0359$;

comment on function app.desk_tournament_detail(uuid) is
  'Tournaments (M7, §1.8; 0310; 0311 c35; 0359 classes, every class it is for). The cashier, the court desk, managers and the owner (the entries carry names and phones): FORBIDDEN; TOURNAMENT_NOT_FOUND (unknown or outside the visible branches); VENUE_MISMATCH (not one of those roles at its branch). The tournament''s fields and revision, sweep_errors (0310: failed sweep cancels), timezone, server_now; entries [{entry_id, guest_id, full_name, phone, status, seed_no, waitlist_position, added_by_kind, owed_iqd, net_paid_iqd, refund_due_iqd, substitute_for, payments [{payment_id, tab_id, method, amount_iqd, refunded_iqd, refundable_iqd, created_at}] (0310)}] (registered by seed, the waitlist in order, then the rest); courts [{court_id, name_en, name_ar, sort_order}] of the live adopted blocks; rounds [{round_no, sit_out [entry], matches [{match_id, court_id, a [entry, entry], b [entry, entry], points_a, points_b, revision, corrections}]}]; standings (app.tournament_standings); can {add (open or closed; 0310: not running), set_rounds, score (0311: the court desk while running; a manager on a finished tournament within 48 hours of finished_at), cancel, close (0310: open, past the cut-off or a manager), finish (0310: a manager, running), settle} for the caller''s role and the status.';

revoke all on function app.desk_tournament_detail(uuid) from public, anon;
grant execute on function app.desk_tournament_detail(uuid) to authenticated;

create or replace function app.assistant_tournaments_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_tournaments_summary_0359$
declare
  v_rv    uuid[];
  v_today date;
  v_rows  jsonb;
  v_tot   jsonb;
  v_last  jsonb;
  v_next  jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  v_rv := app.report_venues();
  v_today := app.business_date(now());

  with t as (
    select t.*, v.name_en as branch,
           (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status = 'registered') as registered,
           (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status = 'waitlisted') as waitlisted,
           (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status = 'no_show')    as no_shows,
           (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status = 'withdrawn')  as withdrawn
      from tournaments t
      join venues v on v.id = t.venue_id
     where t.venue_id = any(v_rv)
       and app.business_date(t.starts_at) between p_from and p_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           t.id,
           'name',         t.name_en,
           'branch',       t.branch,
           'status',       t.status,
           'format',       t.format,
           'category',     t.category,
           'class',        t.class,
           'classes',      to_jsonb(t.classes),
           'startDate',    app.business_date(t.starts_at),
           'endDate',      app.business_date(t.ends_at),
           'entryFeeIqd',  t.entry_fee_iqd,
           'maxEntries',   t.max_entries,
           'minEntries',   t.min_entries,
           'registered',   t.registered,
           'waitlisted',   t.waitlisted,
           'noShows',      t.no_shows,
           'withdrawn',    t.withdrawn) order by t.starts_at), '[]'::jsonb),
         jsonb_build_object(
           'tournaments', count(*),
           'finished',    count(*) filter (where t.status = 'finished'),
           'cancelled',   count(*) filter (where t.status = 'cancelled'),
           'registered',  coalesce(sum(t.registered), 0),
           'noShows',     coalesce(sum(t.no_shows), 0),
           'places',      coalesce(sum(t.max_entries) filter (where t.status <> 'cancelled'), 0))
    into v_rows, v_tot
    from t;

  -- Distinct entrants across the range, and how many had entered a tournament before it.
  v_tot := v_tot || (
    select jsonb_build_object(
             'distinctPlayers', count(distinct e.guest_id),
             'returningPlayers', count(distinct e.guest_id) filter (where exists (
                select 1 from tournament_entries p join tournaments pt on pt.id = p.tournament_id
                 where p.guest_id = e.guest_id and p.status in ('registered', 'no_show')
                   and pt.status <> 'cancelled' and app.business_date(pt.starts_at) < p_from)))
      from tournament_entries e
      join tournaments t on t.id = e.tournament_id
     where t.venue_id = any(v_rv)
       and t.status <> 'cancelled'
       and e.status in ('registered', 'no_show')
       and app.business_date(t.starts_at) between p_from and p_to);

  select jsonb_build_object('name', t.name_en, 'branch', v.name_en,
                            'finishedDate', app.business_date(t.finished_at),
                            'daysSince', v_today - app.business_date(t.finished_at))
    into v_last
    from tournaments t join venues v on v.id = t.venue_id
   where t.venue_id = any(v_rv) and t.status = 'finished' and t.finished_at is not null
   order by t.finished_at desc
   limit 1;

  select jsonb_build_object('name', t.name_en, 'branch', v.name_en, 'status', t.status,
                            'startDate', app.business_date(t.starts_at),
                            'daysUntil', app.business_date(t.starts_at) - v_today)
    into v_next
    from tournaments t join venues v on v.id = t.venue_id
   where t.venue_id = any(v_rv) and t.status in ('open', 'closed', 'running') and t.ends_at >= now()
   order by t.starts_at
   limit 1;

  return jsonb_build_object(
    'period',         jsonb_build_object('from', p_from, 'to', p_to),
    'totals',         v_tot,
    'lastFinished',   v_last,
    'nextScheduled',  v_next,
    'tournaments',    v_rows);
end $assistant_tournaments_summary_0359$;

comment on function app.assistant_tournaments_summary(date, date) is
  '0328 (0359: classes, every class a tournament is for). Owner-only, read-only, reached through app.assistant_run_tool (tool tournaments_summary). Tournaments starting in the range at the branches in scope (app.report_venues) with entries by status against the cap, totals with distinct and returning players, and the last finished and next scheduled tournament whatever the range. No guest identity.';

revoke all on function app.assistant_tournaments_summary(date, date) from public, anon, authenticated;

create or replace function app.tournament_context(p_run_step_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_context_0359$
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
    -- 0359: every class of the plan; a plan checked before it has one class.
    'classes',  case when jsonb_typeof(v_data->'classes') = 'array' then v_data->'classes'
                     when v_data->>'class' is not null then jsonb_build_array(v_data->>'class') end,
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
end $tournament_context_0359$;

comment on function app.tournament_context(uuid) is
  'event_court_blocks (§2.11; 0359 classes, every class of the plan). The actor of a tournament''s courts or marketing step who may act on it, or MGMT at the venue: {name_en, name_ar, class, format, capacity, ranges: [{court_ids, court_names: [{en, ar}], from, to}], blocked: [{reservation_id, court_id, start_at, end_at}]} from the run''s passed plan and its live event blocks. No fee, prize, budget, sponsor or income. PROTOCOL_NOT_FOUND, NOT_STEP_ACTOR.';

revoke all on function app.tournament_context(uuid) from public, anon;
grant execute on function app.tournament_context(uuid) to authenticated;
