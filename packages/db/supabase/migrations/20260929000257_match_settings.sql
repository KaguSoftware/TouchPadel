set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0257 match_settings — open matches, lane DB (docs/design/open-matches/db.md
-- §4.3, build contracts §1.2, §1.5, §1.7).
--
--   1. venue_settings (per branch): matches_enabled (ships false everywhere,
--      R10) and match_fill_deadline_minutes (OM-22, 60..2880, default 120).
--   2. platform_settings (the chain): match_ticket_price_iqd (OM-46, 1,000..
--      1,000,000 in steps of 250, default 10,000), max_filling_matches_per_guest
--      (OM-37, 1..10, default 3) and match_terms_version (NULL = any accepted
--      terms version; set by migration only, once a build carrying the new
--      CURRENT_TERMS_VERSION is on phones).
--   3. venue_settings_public (0208) gains the two branch columns, appended.
--   4. app.match_terms_ok(version): has the guest accepted terms recent enough
--      for open matches; app.accept_terms re-issued from 0153 so an older
--      version never replaces a newer one on record.
--   5. app.match_settings / app.set_match_settings: the manager reads, the
--      owner writes, the role checked before the branch is resolved (R33).
--
-- Switching matches_enabled off stops new starts and joins of new players;
-- matches already filling or booked carry on (R10). A new deadline applies to
-- matches started after it; a new ticket price to purchases after it (DF-21).

-- ---------------------------------------------------------------------------
-- 1. The branch's rules
-- ---------------------------------------------------------------------------
alter table venue_settings add column if not exists matches_enabled boolean not null default false;
alter table venue_settings add column if not exists match_fill_deadline_minutes int not null default 120;

do $venue_settings_match_rules_0257$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'venue_settings_match_rules'
                    and conrelid = 'public.venue_settings'::regclass) then
    alter table venue_settings add constraint venue_settings_match_rules
      check (match_fill_deadline_minutes between 60 and 2880) not valid;
  end if;
end $venue_settings_match_rules_0257$;

do $venue_settings_match_rules_validate_0257$
begin
  if exists (select 1 from pg_constraint
              where conname = 'venue_settings_match_rules'
                and conrelid = 'public.venue_settings'::regclass
                and not convalidated) then
    alter table venue_settings validate constraint venue_settings_match_rules;
  end if;
end $venue_settings_match_rules_validate_0257$;

comment on column venue_settings.matches_enabled is
  '0257. Open matches at this branch. False (the default, every branch): no new match starts and no new player joins; matches already filling or booked carry on (R10). Owner-set via app.set_match_settings.';
comment on column venue_settings.match_fill_deadline_minutes is
  '0257. An open match must fill this many minutes before its start (OM-22), 60..2880, default 120. A match can start only at least this plus 60 minutes ahead (OM-43). Applies to matches started after a change. Owner-set via app.set_match_settings.';

-- ---------------------------------------------------------------------------
-- 2. The chain's rules
-- ---------------------------------------------------------------------------
alter table platform_settings add column if not exists match_ticket_price_iqd bigint not null default 10000;
alter table platform_settings add column if not exists max_filling_matches_per_guest int not null default 3;
alter table platform_settings add column if not exists match_terms_version text;

do $platform_settings_match_rules_0257$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'platform_settings_match_rules'
                    and conrelid = 'public.platform_settings'::regclass) then
    alter table platform_settings add constraint platform_settings_match_rules
      check (match_ticket_price_iqd between 1000 and 1000000
             and match_ticket_price_iqd % 250 = 0
             and max_filling_matches_per_guest between 1 and 10
             and (match_terms_version is null
                  or match_terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$')) not valid;
  end if;
end $platform_settings_match_rules_0257$;

do $platform_settings_match_rules_validate_0257$
begin
  if exists (select 1 from pg_constraint
              where conname = 'platform_settings_match_rules'
                and conrelid = 'public.platform_settings'::regclass
                and not convalidated) then
    alter table platform_settings validate constraint platform_settings_match_rules;
  end if;
end $platform_settings_match_rules_validate_0257$;

comment on column platform_settings.match_ticket_price_iqd is
  '0257. The price of one open-match ticket, chain-wide (OM-46): 1,000..1,000,000 IQD in steps of 250, default 10,000. A change applies to purchases after it, never to tickets already bought (DF-21). Owner-set via app.set_match_settings.';
comment on column platform_settings.max_filling_matches_per_guest is
  '0257. How many filling open matches one guest may be in at once, chain-wide (OM-37), 1..10, default 3. Owner-set via app.set_match_settings.';
comment on column platform_settings.match_terms_version is
  '0257. The oldest accepted terms version that allows open matches (the 0153 format); NULL = any accepted version. Set by migration only, after a build carrying that CURRENT_TERMS_VERSION is on phones.';

-- ---------------------------------------------------------------------------
-- 3. venue_settings_public: re-created from
--    20260926000208_venue_settings_per_venue.sql:88 with the two branch
--    columns appended (create or replace can only append).
-- ---------------------------------------------------------------------------
create or replace view venue_settings_public with (security_invoker = off) as
select vs.venue_name,
       vs.currency,
       vs.timezone,
       vs.opening_hours,
       vs.closed_dates,
       vs.protected_horizon_hours,
       vs.cancellation_window_hours,
       vs.table_token_ttl_minutes,
       vs.phone,
       vs.max_booking_horizon_days,
       vs.venue_id,
       v.slug       as venue_slug,
       v.name_en    as venue_name_en,
       v.name_ar    as venue_name_ar,
       v.address_en,
       v.address_ar,
       v.map_url,
       vs.matches_enabled,
       vs.match_fill_deadline_minutes
  from venue_settings vs
  join venues v on v.id = vs.venue_id and v.is_active;

grant select on venue_settings_public to anon, authenticated;

comment on view venue_settings_public is
  '0006/0048, per branch since 0208, open matches since 0257. The guest-safe settings of every active branch, with its id, slug, names and address, and whether it runs open matches and their fill deadline. The ONLY settings surface for anon.';

-- The assistant's table_read allowlist (0109:94) learns the five columns and
-- the two view columns, after the view has them: the 0207 statement, limited
-- to them (ON CONFLICT DO NOTHING adds only what is new).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       c.data_type <> 'jsonb',
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   and ((c.table_name in ('venue_settings', 'venue_settings_public')
         and c.column_name in ('matches_enabled', 'match_fill_deadline_minutes'))
     or (c.table_name = 'platform_settings'
         and c.column_name in ('match_ticket_price_iqd', 'max_filling_matches_per_guest',
                               'match_terms_version')))
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. app.match_terms_ok — accepted terms recent enough for open matches
-- ---------------------------------------------------------------------------
-- False without an accepted version; true while match_terms_version is NULL;
-- otherwise the accepted version must be at least match_terms_version, each
-- read as (date, revision): a plain text comparison ranks ".10" below ".9".
-- SQL with a SET clause, so it is never inlined into a client's plan.
create or replace function app.match_terms_ok(p_version text) returns boolean
language sql stable set search_path = public as $match_terms_ok_0257$
  select case
    when p_version is null then false
    else coalesce(
      (select ps.match_terms_version is null
              or (split_part(p_version, '.', 1),
                  coalesce(nullif(split_part(p_version, '.', 2), ''), '0')::int)
                 >= (split_part(ps.match_terms_version, '.', 1),
                     coalesce(nullif(split_part(ps.match_terms_version, '.', 2), ''), '0')::int)
         from platform_settings ps
        where ps.id),
      true)
  end;
$match_terms_ok_0257$;

comment on function app.match_terms_ok(text) is
  '0257. True when terms version p_version (the guest''s profiles.terms_version) allows open matches: false for NULL, true while platform_settings.match_terms_version is NULL, else p_version >= it compared as (date, revision). Internal: match_eligibility (0260) and ticket_payment_prepare (0259).';

revoke all on function app.match_terms_ok(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4b. app.accept_terms — re-issued from 0153:70 (its only body): never back
-- ---------------------------------------------------------------------------
-- Once match_terms_version is set, an older build on a second device that
-- accepts its own older version would roll the guest below it, and every match
-- RPC and ticket purchase would refuse TERMS_REQUIRED until the newer device
-- accepts again. A version below the stored one (compared as match_terms_ok
-- compares, (date, revision)) now leaves both columns as they are and answers
-- them: the stamp is never moved onto text the guest did not accept. The same
-- or a newer version records as before.
create or replace function app.accept_terms(p_version text default null)
returns jsonb
language plpgsql security definer set search_path = public as $accept_terms_0257$
declare
  v_uid    uuid := auth.uid();
  v_at     timestamptz;
  v_stored text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- An anonymous café session has no profile (0004 skips is_anonymous), and a
  -- deleted account is a tombstone: neither has anyone to bind to the terms.
  if not exists (select 1 from profiles where id = v_uid and deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  if p_version is null
     or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$' then
    raise exception 'VERSION_INVALID' using errcode = 'P0001';
  end if;

  -- 0257: an older version than the one on record changes nothing.
  select p.terms_version, p.terms_accepted_at into v_stored, v_at from profiles p where p.id = v_uid;
  if v_stored is not null
     and (split_part(p_version, '.', 1), coalesce(nullif(split_part(p_version, '.', 2), ''), '0')::int)
         < (split_part(v_stored, '.', 1), coalesce(nullif(split_part(v_stored, '.', 2), ''), '0')::int) then
    return jsonb_build_object('terms_version', v_stored, 'terms_accepted_at', v_at);
  end if;

  update profiles
     set terms_version     = p_version,
         terms_accepted_at = now()
   where id = v_uid
  returning terms_accepted_at into v_at;

  return jsonb_build_object('terms_version', p_version, 'terms_accepted_at', v_at);
end $accept_terms_0257$;

comment on function app.accept_terms(text) is
  'Records that the calling account accepted Terms/Privacy version p_version, stamped with the server clock. Refuses an anonymous café session and a deleted account (ACCOUNT_REQUIRED) and a malformed version (VERSION_INVALID). 0257: a version below the one on record (compared as (date, revision), as app.match_terms_ok does) changes nothing and answers the stored version and time, so an older build cannot roll a guest back below platform_settings.match_terms_version. The only write path to profiles.terms_version / terms_accepted_at.';

revoke all on function app.accept_terms(text) from public, anon;
grant execute on function app.accept_terms(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reading and writing the settings
-- ---------------------------------------------------------------------------
create or replace function app.match_settings(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $match_settings_0257$
declare
  v_venue uuid;
  v_out   jsonb;
begin
  -- R33: the role first, then the branch.
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'venue_id',                      vs.venue_id,
           'matches_enabled',               vs.matches_enabled,
           'match_fill_deadline_minutes',   vs.match_fill_deadline_minutes,
           'earliest_start_minutes',        vs.match_fill_deadline_minutes + 60,
           'match_ticket_price_iqd',        ps.match_ticket_price_iqd,
           'max_filling_matches_per_guest', ps.max_filling_matches_per_guest,
           'match_terms_version',           ps.match_terms_version)
    into v_out
    from venue_settings vs
   cross join platform_settings ps
   where vs.venue_id = v_venue
     and ps.id;
  if v_out is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;
  return v_out;
end $match_settings_0257$;

comment on function app.match_settings(uuid) is
  '0257. Manager and owner: the open-match rules of one branch (matches_enabled, match_fill_deadline_minutes, earliest_start_minutes = deadline + 60) and of the chain (match_ticket_price_iqd, max_filling_matches_per_guest, match_terms_version). The role is checked before the branch is resolved (R33); p_venue_id defaults to the caller''s resolved branch.';

revoke all on function app.match_settings(uuid) from public, anon;
grant execute on function app.match_settings(uuid) to authenticated;

create or replace function app.set_match_settings(p_patch jsonb, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_match_settings_0257$
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
end $set_match_settings_0257$;

comment on function app.set_match_settings(jsonb, uuid) is
  '0257. Owner only: patch the open-match rules. Keys: matches_enabled (boolean) and match_fill_deadline_minutes (60..2880) for the branch p_venue_id (default: the caller''s resolved branch); match_ticket_price_iqd (1,000..1,000,000, a multiple of 250) and max_filling_matches_per_guest (1..10) for the chain. Every refusal is INVALID_ARGUMENT naming the key (p_patch for an empty or non-object patch); nothing is written unless the whole patch is valid. Audited as venue.match_settings; returns app.match_settings.';

revoke all on function app.set_match_settings(jsonb, uuid) from public, anon;
grant execute on function app.set_match_settings(jsonb, uuid) to authenticated;
