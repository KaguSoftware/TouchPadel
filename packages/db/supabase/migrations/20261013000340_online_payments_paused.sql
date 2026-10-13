set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0340 online_payments_paused — the store build ships without online payment
-- and open matches (the Qi provider is delayed). The backend makes it
-- impossible to switch on online deposits, online lesson payment or open
-- matches from the desk app until a later migration flips the platform flag.

alter table platform_settings add column if not exists online_payments_live boolean not null default false;

comment on column platform_settings.online_payments_live is
  '0340. Lock on online deposits, online lesson payment and open matches. No RPC or UI sets it; only a migration flips it, when the Qi provider is live. While false, set_deposit_settings refuses a mode other than off, set_coaching_settings refuses an online lesson_payment_mode and set_match_settings refuses matches_enabled = true (ONLINE_PAYMENTS_PAUSED).';

-- Switch every branch off, audited like the owner's own change (system actor).
do $paused_0340$
declare
  r        record;
  v_before jsonb;
  v_after  jsonb;
begin
  for r in
    select venue_id, deposit_mode, lesson_payment_mode, matches_enabled
      from venue_settings
     where deposit_mode <> 'off' or lesson_payment_mode <> 'desk' or matches_enabled
  loop
    v_before := jsonb_build_object('deposit_mode', r.deposit_mode,
                                   'lesson_payment_mode', r.lesson_payment_mode,
                                   'matches_enabled', r.matches_enabled);
    v_after  := jsonb_build_object('deposit_mode', 'off',
                                   'lesson_payment_mode', 'desk',
                                   'matches_enabled', false);
    update venue_settings
       set deposit_mode = 'off', lesson_payment_mode = 'desk', matches_enabled = false
     where venue_id = r.venue_id;
    insert into audit_log (actor_role, action, entity, entity_id, before, after, venue_id)
    values ('system', 'venue.online_payments_paused', 'venue_settings', r.venue_id::text,
            v_before, v_after, r.venue_id);
  end loop;
end $paused_0340$;

-- Read the lock (the operator hides its settings panels on false).
create or replace function app.online_payments_live()
returns boolean
language sql stable security definer set search_path = public as $online_payments_live_0340$
  select coalesce((select online_payments_live from platform_settings limit 1), false);
$online_payments_live_0340$;

comment on function app.online_payments_live() is
  '0340. Any signed-in caller: whether platform_settings.online_payments_live is true (false when there is no row). A harmless boolean.';

revoke all on function app.online_payments_live() from public, anon;
grant execute on function app.online_payments_live() to authenticated;

create or replace function app.set_deposit_settings(p_patch jsonb, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_deposit_settings_0340$
declare
  v_allowed text[] := array['deposit_mode', 'deposit_percent_bp', 'deposit_min_iqd', 'deposit_max_iqd',
                            'deposit_window_seconds', 'deposit_forfeit_no_show'];
  v_venue  uuid;
  v_key    text;
  v_before jsonb;
  v_after  jsonb;
  v_int    int;
  v_min    bigint;
  v_max    bigint;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0340: while the platform lock is closed, a deposit mode other than off is refused.
  if p_patch ? 'deposit_mode' and (p_patch->>'deposit_mode') in ('optional', 'required')
     and not coalesce((select online_payments_live from platform_settings limit 1), false) then
    raise exception 'ONLINE_PAYMENTS_PAUSED' using errcode = 'P0001';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;

  v_before := app.deposit_settings(v_venue);

  -- Validate everything before writing anything.
  if p_patch ? 'deposit_mode'
     and coalesce(p_patch->>'deposit_mode', '') not in ('off', 'optional', 'required') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_mode';
  end if;
  if p_patch ? 'deposit_percent_bp' then
    v_int := app.venue_patch_int(p_patch, 'deposit_percent_bp', 100, 10000);
  end if;
  if p_patch ? 'deposit_window_seconds' then
    v_int := app.venue_patch_int(p_patch, 'deposit_window_seconds', 120, 1800);
  end if;
  if p_patch ? 'deposit_forfeit_no_show'
     and jsonb_typeof(p_patch->'deposit_forfeit_no_show') <> 'boolean' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_forfeit_no_show';
  end if;
  if p_patch ? 'deposit_min_iqd' then
    if jsonb_typeof(p_patch->'deposit_min_iqd') <> 'number'
       or (p_patch->>'deposit_min_iqd')::numeric <> trunc((p_patch->>'deposit_min_iqd')::numeric)
       or (p_patch->>'deposit_min_iqd')::numeric not between 0 and 10000000 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_min_iqd';
    end if;
  end if;
  if p_patch ? 'deposit_max_iqd' and jsonb_typeof(p_patch->'deposit_max_iqd') <> 'null' then
    if jsonb_typeof(p_patch->'deposit_max_iqd') <> 'number'
       or (p_patch->>'deposit_max_iqd')::numeric <> trunc((p_patch->>'deposit_max_iqd')::numeric)
       or (p_patch->>'deposit_max_iqd')::numeric not between 1 and 10000000 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_max_iqd';
    end if;
  end if;
  v_min := coalesce((p_patch->>'deposit_min_iqd')::bigint, (v_before->>'deposit_min_iqd')::bigint);
  v_max := case when p_patch ? 'deposit_max_iqd' then (p_patch->>'deposit_max_iqd')::bigint
                else (v_before->>'deposit_max_iqd')::bigint end;
  if v_max is not null and v_max < v_min then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_max_iqd',
      hint = 'the maximum is below the minimum';
  end if;

  perform set_config('app.venue_id', v_venue::text, true);

  update venue_settings
     set deposit_mode            = case when p_patch ? 'deposit_mode' then p_patch->>'deposit_mode' else deposit_mode end,
         deposit_percent_bp      = case when p_patch ? 'deposit_percent_bp'
                                        then (p_patch->>'deposit_percent_bp')::int else deposit_percent_bp end,
         deposit_min_iqd         = v_min,
         deposit_max_iqd         = v_max,
         deposit_window_seconds  = case when p_patch ? 'deposit_window_seconds'
                                        then (p_patch->>'deposit_window_seconds')::int else deposit_window_seconds end,
         deposit_forfeit_no_show = case when p_patch ? 'deposit_forfeit_no_show'
                                        then (p_patch->>'deposit_forfeit_no_show')::boolean else deposit_forfeit_no_show end
   where venue_id = v_venue;

  v_after := app.deposit_settings(v_venue);
  if v_before is distinct from v_after then
    perform app.write_audit('venue.deposit_settings', 'venue_settings', v_venue::text, v_before, v_after);
  end if;
  return v_after;
end $set_deposit_settings_0340$;

revoke all on function app.set_deposit_settings(jsonb, uuid) from public, anon;
grant execute on function app.set_deposit_settings(jsonb, uuid) to authenticated;

create or replace function app.set_match_settings(p_patch jsonb, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_match_settings_0340$
declare
  v_allowed text[] := array['matches_enabled', 'match_fill_deadline_minutes',
                            'match_ticket_price_iqd', 'max_filling_matches_per_guest'];
  v_venue  uuid;
  v_key    text;
  v_int    int;
  v_before jsonb;
  v_after  jsonb;
begin
  -- R33: the role first, then the branch.
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0340: while the platform lock is closed, matches_enabled = true is refused.
  if p_patch ? 'matches_enabled' and p_patch->'matches_enabled' = 'true'::jsonb
     and not coalesce((select online_payments_live from platform_settings limit 1), false) then
    raise exception 'ONLINE_PAYMENTS_PAUSED' using errcode = 'P0001';
  end if;

  -- The whole patch is checked before anything is written.
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  if p_patch ? 'matches_enabled' and jsonb_typeof(p_patch->'matches_enabled') <> 'boolean' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'matches_enabled';
  end if;
  if p_patch ? 'match_fill_deadline_minutes' then
    v_int := app.venue_patch_int(p_patch, 'match_fill_deadline_minutes', 60, 2880);
  end if;
  if p_patch ? 'match_ticket_price_iqd' then
    v_int := app.venue_patch_int(p_patch, 'match_ticket_price_iqd', 1000, 1000000);
    if v_int % 250 <> 0 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'match_ticket_price_iqd',
        hint = 'a multiple of 250';
    end if;
  end if;
  if p_patch ? 'max_filling_matches_per_guest' then
    v_int := app.venue_patch_int(p_patch, 'max_filling_matches_per_guest', 1, 10);
  end if;

  v_before := app.match_settings(v_venue);

  perform set_config('app.venue_id', v_venue::text, true);

  if p_patch ? 'matches_enabled' or p_patch ? 'match_fill_deadline_minutes' then
    update venue_settings
       set matches_enabled             = case when p_patch ? 'matches_enabled'
                                              then (p_patch->>'matches_enabled')::boolean
                                              else matches_enabled end,
           match_fill_deadline_minutes = case when p_patch ? 'match_fill_deadline_minutes'
                                              then (p_patch->>'match_fill_deadline_minutes')::int
                                              else match_fill_deadline_minutes end
     where venue_id = v_venue;
  end if;

  -- The ticket price and the per-guest cap are the chain's (0207 form).
  if p_patch ? 'match_ticket_price_iqd' or p_patch ? 'max_filling_matches_per_guest' then
    update platform_settings
       set match_ticket_price_iqd        = case when p_patch ? 'match_ticket_price_iqd'
                                                then (p_patch->>'match_ticket_price_iqd')::bigint
                                                else match_ticket_price_iqd end,
           max_filling_matches_per_guest = case when p_patch ? 'max_filling_matches_per_guest'
                                                then (p_patch->>'max_filling_matches_per_guest')::int
                                                else max_filling_matches_per_guest end,
           updated_at                    = now()
     where id;
  end if;

  v_after := app.match_settings(v_venue);
  if v_before is distinct from v_after then
    perform app.write_audit('venue.match_settings', 'venue_settings', v_venue::text, v_before, v_after);
  end if;
  return v_after;
end $set_match_settings_0340$;

revoke all on function app.set_match_settings(jsonb, uuid) from public, anon;
grant execute on function app.set_match_settings(jsonb, uuid) to authenticated;

create or replace function app.set_coaching_settings(p_venue_id uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $set_coaching_settings_0340$
declare
  v_allowed text[] := array['coaching_enabled', 'lesson_payment_mode', 'coach_share_bp',
                            'coach_max_open_private', 'lesson_prices_public'];
  v_venue  uuid;
  v_key    text;
  v_int    int;
  v_mode   text;
  v_before jsonb;
  v_after  jsonb;
begin
  -- R57: the role first, then the branch.
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0340: while the platform lock is closed, an online lesson_payment_mode is refused.
  if p_patch ? 'lesson_payment_mode' and (p_patch->>'lesson_payment_mode') in ('online_optional', 'online_required')
     and not coalesce((select online_payments_live from platform_settings limit 1), false) then
    raise exception 'ONLINE_PAYMENTS_PAUSED' using errcode = 'P0001';
  end if;

  -- The whole patch is checked before anything is written.
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  if p_patch ? 'coaching_enabled' and jsonb_typeof(p_patch->'coaching_enabled') <> 'boolean' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'coaching_enabled';
  end if;
  if p_patch ? 'lesson_prices_public' and jsonb_typeof(p_patch->'lesson_prices_public') <> 'boolean' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'lesson_prices_public';
  end if;
  if p_patch ? 'lesson_payment_mode'
     and (jsonb_typeof(p_patch->'lesson_payment_mode') <> 'string'
          or (p_patch->>'lesson_payment_mode') not in ('desk', 'online_optional', 'online_required')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'lesson_payment_mode';
  end if;
  if p_patch ? 'coach_share_bp' then
    v_int := app.venue_patch_int(p_patch, 'coach_share_bp', 0, 10000);
  end if;
  if p_patch ? 'coach_max_open_private' then
    v_int := app.venue_patch_int(p_patch, 'coach_max_open_private', 1, 100);
  end if;

  v_before := app.coaching_settings(v_venue);

  -- R50 / R67 (C-26): an online mode only once the lessons terms are live.
  v_mode := coalesce(p_patch->>'lesson_payment_mode', v_before->>'lesson_payment_mode');
  if v_mode <> 'desk' and not coalesce((v_before->>'online_payments_available')::boolean, false) then
    raise exception 'ONLINE_PAYMENT_OFF' using errcode = 'P0001', detail = 'terms';
  end if;

  perform set_config('app.venue_id', v_venue::text, true);

  update venue_settings
     set coaching_enabled       = case when p_patch ? 'coaching_enabled'
                                       then (p_patch->>'coaching_enabled')::boolean
                                       else coaching_enabled end,
         lesson_payment_mode    = case when p_patch ? 'lesson_payment_mode'
                                       then p_patch->>'lesson_payment_mode'
                                       else lesson_payment_mode end,
         coach_share_bp         = case when p_patch ? 'coach_share_bp'
                                       then (p_patch->>'coach_share_bp')::int
                                       else coach_share_bp end,
         coach_max_open_private = case when p_patch ? 'coach_max_open_private'
                                       then (p_patch->>'coach_max_open_private')::int
                                       else coach_max_open_private end,
         lesson_prices_public   = case when p_patch ? 'lesson_prices_public'
                                       then (p_patch->>'lesson_prices_public')::boolean
                                       else lesson_prices_public end
   where venue_id = v_venue;

  v_after := app.coaching_settings(v_venue);
  if v_before is distinct from v_after then
    perform app.write_audit('venue.coaching_settings', 'venue_settings', v_venue::text, v_before, v_after);
  end if;
  return v_after;
end $set_coaching_settings_0340$;

revoke all on function app.set_coaching_settings(uuid, jsonb) from public, anon;
grant execute on function app.set_coaching_settings(uuid, jsonb) to authenticated;
