set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0277 coaching_settings — coaching, lane DB (docs/design/coaching/db.md §4.2;
-- build contracts §1.1, §1.2, §1.5, §1.7, R50, R56, R67).
--
--   1. venue_settings (per branch): coaching_enabled (ships false everywhere),
--      lesson_payment_mode (CD-1: desk | online_optional | online_required,
--      default desk), coach_share_bp (CD-5, 0..10000, default 6000, owner
--      only), lesson_prices_public (C-11, default false) and
--      coach_max_open_private (R56, 1..100, default 10). One named CHECK,
--      venue_settings_coaching_rules.
--   2. platform_settings (the chain): lesson_terms_version (R50; NULL = no
--      terms with a lessons section are live yet; set by migration only, as
--      match_terms_version is).
--   3. venue_settings_public (0257) gains coaching_enabled,
--      lesson_payment_mode and lesson_prices_public, appended. Never
--      coach_share_bp, never coach_max_open_private.
--   4. app.coaching_rules(venue): the branch's coaching rules for the coaching
--      bodies; app.lesson_terms_ok(version): accepted terms recent enough for
--      online lesson money. Both internal.
--   5. app.coaching_settings / app.set_coaching_settings: the manager reads,
--      the owner writes, the role checked before the branch (R57). An online
--      payment mode is refused while no lessons terms version is live
--      (ONLINE_PAYMENT_OFF detail terms; C-26, R50, R67): desk-paid lessons
--      can run before that.
--
-- set_venue_details's allowlist (0248) does not learn these keys: they are
-- written only by set_coaching_settings. Switching coaching_enabled off stops
-- new guest and coach bookings; lessons already booked run to their end and
-- coach mode keeps working (R45). coach_share_bp applies to lessons and courses
-- created after a change (CD-5 snapshot).

-- ---------------------------------------------------------------------------
-- 1. The branch's rules
-- ---------------------------------------------------------------------------
alter table venue_settings add column if not exists coaching_enabled       boolean not null default false;
alter table venue_settings add column if not exists lesson_payment_mode    text    not null default 'desk';
alter table venue_settings add column if not exists coach_share_bp         int     not null default 6000;
alter table venue_settings add column if not exists lesson_prices_public   boolean not null default false;
alter table venue_settings add column if not exists coach_max_open_private int     not null default 10;

do $venue_settings_coaching_rules_0277$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'venue_settings_coaching_rules'
                    and conrelid = 'public.venue_settings'::regclass) then
    alter table venue_settings add constraint venue_settings_coaching_rules
      check (lesson_payment_mode in ('desk', 'online_optional', 'online_required')
             and coach_share_bp between 0 and 10000
             and coach_max_open_private between 1 and 100) not valid;
  end if;
end $venue_settings_coaching_rules_0277$;

do $venue_settings_coaching_rules_validate_0277$
begin
  if exists (select 1 from pg_constraint
              where conname = 'venue_settings_coaching_rules'
                and conrelid = 'public.venue_settings'::regclass
                and not convalidated) then
    alter table venue_settings validate constraint venue_settings_coaching_rules;
  end if;
end $venue_settings_coaching_rules_validate_0277$;

comment on column venue_settings.coaching_enabled is
  '0277. Lessons at this branch. False (the default, every branch): no new guest or coach booking, join, add or creation (COACHING_OFF); lessons already booked run to their end; coach mode and the desk keep working (R45, R51). Owner-set via app.set_coaching_settings.';
comment on column venue_settings.lesson_payment_mode is
  '0277. How guests pay for a lesson they book (CD-1): desk (the default), online_optional or online_required (Qi). Bookings made by a coach or the desk are always paid at the desk. An online mode needs platform_settings.lesson_terms_version (C-26, R50). Owner-set via app.set_coaching_settings.';
comment on column venue_settings.coach_share_bp is
  '0277. The coach''s share of collected lesson money less the court share, in basis points (CD-5, C-6): 0..10000, default 6000 (60 %). Snapshotted on every lesson and course at creation. Owner only; never in venue_settings_public.';
comment on column venue_settings.lesson_prices_public is
  '0277. Whether the website''s /coaching page shows lesson prices (C-11). Presentation, not secrecy: the app shows prices to anyone. Default false until the owner agrees. Owner-set via app.set_coaching_settings.';
comment on column venue_settings.coach_max_open_private is
  '0277. How many upcoming coach-booked private lessons one coach may hold at this branch (C-24, R56): 1..100, default 10 (COACH_ADD_LIMIT detail live). Owner-set via app.set_coaching_settings.';

-- ---------------------------------------------------------------------------
-- 2. The chain's rule: the lessons terms version (R50)
-- ---------------------------------------------------------------------------
alter table platform_settings add column if not exists lesson_terms_version text;

do $platform_settings_lesson_terms_0277$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'platform_settings_lesson_terms'
                    and conrelid = 'public.platform_settings'::regclass) then
    alter table platform_settings add constraint platform_settings_lesson_terms
      check (lesson_terms_version is null
             or lesson_terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$') not valid;
  end if;
end $platform_settings_lesson_terms_0277$;

do $platform_settings_lesson_terms_validate_0277$
begin
  if exists (select 1 from pg_constraint
              where conname = 'platform_settings_lesson_terms'
                and conrelid = 'public.platform_settings'::regclass
                and not convalidated) then
    alter table platform_settings validate constraint platform_settings_lesson_terms;
  end if;
end $platform_settings_lesson_terms_validate_0277$;

comment on column platform_settings.lesson_terms_version is
  '0277. The oldest accepted terms version (the 0153 format) whose Terms and Privacy carry the lessons section (R50). NULL (the default) = none is live yet: online lesson payment cannot be switched on (ONLINE_PAYMENT_OFF detail terms) and the online booking paths answer TERMS_REQUIRED; desk-paid lessons run. Set by migration only, once a build carrying that CURRENT_TERMS_VERSION is on phones (the match_terms_version precedent).';

-- ---------------------------------------------------------------------------
-- 3. venue_settings_public: re-created from
--    20260929000257_match_settings.sql:99 with the three coaching columns
--    appended (create or replace can only append). Never coach_share_bp or
--    coach_max_open_private.
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
       vs.match_fill_deadline_minutes,
       vs.coaching_enabled,
       vs.lesson_payment_mode,
       vs.lesson_prices_public
  from venue_settings vs
  join venues v on v.id = vs.venue_id and v.is_active;

grant select on venue_settings_public to anon, authenticated;

comment on view venue_settings_public is
  '0006/0048, per branch since 0208, open matches since 0257, coaching since 0277. The guest-safe settings of every active branch, with its id, slug, names and address, whether it runs open matches and their fill deadline, and whether it offers lessons, how they are paid and whether the website shows their prices. The ONLY settings surface for anon.';

-- The assistant's table_read allowlist (0109:94) learns the five branch
-- columns, the three view columns and the chain's terms version, after the
-- view has them: the 0257 statement, limited to them (ON CONFLICT DO NOTHING
-- adds only what is new).
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
   and ((c.table_name = 'venue_settings'
         and c.column_name in ('coaching_enabled', 'lesson_payment_mode', 'coach_share_bp',
                               'lesson_prices_public', 'coach_max_open_private'))
     or (c.table_name = 'venue_settings_public'
         and c.column_name in ('coaching_enabled', 'lesson_payment_mode', 'lesson_prices_public'))
     or (c.table_name = 'platform_settings'
         and c.column_name = 'lesson_terms_version'))
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Internal helpers
-- ---------------------------------------------------------------------------
-- The branch's coaching rules, for every coaching body (and Money's): one read
-- of its venue_settings row. NULL when the branch has none.
create or replace function app.coaching_rules(p_venue uuid) returns jsonb
language sql stable set search_path = public as $coaching_rules_0277$
  select jsonb_build_object(
           'venue_id',                  vs.venue_id,
           'coaching_enabled',          vs.coaching_enabled,
           'lesson_payment_mode',       vs.lesson_payment_mode,
           'coach_share_bp',            vs.coach_share_bp,
           'lesson_prices_public',      vs.lesson_prices_public,
           'coach_max_open_private',    vs.coach_max_open_private,
           'cancellation_window_hours', vs.cancellation_window_hours,
           'deposit_window_seconds',    vs.deposit_window_seconds,
           'max_booking_horizon_days',  vs.max_booking_horizon_days,
           'protected_horizon_hours',   vs.protected_horizon_hours,
           'timezone',                  vs.timezone)
    from venue_settings vs
   where vs.venue_id = p_venue;
$coaching_rules_0277$;

comment on function app.coaching_rules(uuid) is
  '0277. Internal. The coaching rules of one branch, from its venue_settings row: venue_id, coaching_enabled, lesson_payment_mode, coach_share_bp, lesson_prices_public, coach_max_open_private, cancellation_window_hours, deposit_window_seconds, max_booking_horizon_days, protected_horizon_hours, timezone. NULL when the branch has no settings row. Read by every coaching body and by Money''s lesson bodies.';

revoke all on function app.coaching_rules(uuid) from public, anon, authenticated;

-- False without an accepted version and while lesson_terms_version is NULL
-- (unlike match_terms_ok, which is true while its version is NULL: online
-- lesson money needs terms that name lessons, R50); otherwise the accepted
-- version must be at least lesson_terms_version, each read as (date,
-- revision): a plain text comparison ranks ".10" below ".9".
create or replace function app.lesson_terms_ok(p_version text) returns boolean
language sql stable set search_path = public as $lesson_terms_ok_0277$
  select case
    when p_version is null then false
    else coalesce(
      (select ps.lesson_terms_version is not null
              and (split_part(p_version, '.', 1),
                   coalesce(nullif(split_part(p_version, '.', 2), ''), '0')::int)
                  >= (split_part(ps.lesson_terms_version, '.', 1),
                      coalesce(nullif(split_part(ps.lesson_terms_version, '.', 2), ''), '0')::int)
         from platform_settings ps
        where ps.id),
      false)
  end;
$lesson_terms_ok_0277$;

comment on function app.lesson_terms_ok(text) is
  '0277. Internal (R50). True when terms version p_version (the guest''s profiles.terms_version) allows online lesson money: false for NULL and while platform_settings.lesson_terms_version is NULL, else p_version >= it compared as (date, revision). Read by the online lesson booking paths (lesson_guest(true), 0283) and lesson-begin''s prepare (0284).';

revoke all on function app.lesson_terms_ok(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reading and writing the settings
-- ---------------------------------------------------------------------------
create or replace function app.coaching_settings(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $coaching_settings_0277$
declare
  v_venue uuid;
  v_out   jsonb;
  v_terms boolean;
begin
  -- R57: the role first, then the branch.
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_out := app.coaching_rules(v_venue);
  if v_out is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;
  -- R67 / D-27: online lesson payment is available once a lessons terms
  -- version is live; a missing Qi provider is lesson-begin's answer
  -- (PROVIDER_UNAVAILABLE), not this one.
  select ps.lesson_terms_version is not null into v_terms from platform_settings ps where ps.id;
  v_terms := coalesce(v_terms, false);
  return v_out || jsonb_build_object('online_payments_available', v_terms,
                                     'lesson_terms_ready', v_terms);
end $coaching_settings_0277$;

comment on function app.coaching_settings(uuid) is
  '0277. Manager and owner: the coaching rules of one branch (app.coaching_rules: coaching_enabled, lesson_payment_mode, coach_share_bp, lesson_prices_public, coach_max_open_private and the booking rules coaching reads) plus online_payments_available and lesson_terms_ready, both true once platform_settings.lesson_terms_version is set (R50, R67). The role is checked before the branch is resolved (R57); p_venue_id defaults to the caller''s resolved branch. A manager reads coach_share_bp (they approve statements); only the owner writes it.';

revoke all on function app.coaching_settings(uuid) from public, anon;
grant execute on function app.coaching_settings(uuid) to authenticated;

create or replace function app.set_coaching_settings(p_venue_id uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $set_coaching_settings_0277$
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
end $set_coaching_settings_0277$;

comment on function app.set_coaching_settings(uuid, jsonb) is
  '0277. Owner only: patch the coaching rules of branch p_venue_id (default: the caller''s resolved branch). Keys: coaching_enabled (boolean), lesson_payment_mode (desk | online_optional | online_required), coach_share_bp (0..10000), coach_max_open_private (1..100), lesson_prices_public (boolean). Every shape refusal is INVALID_ARGUMENT naming the key (p_patch for an empty or non-object patch); nothing is written unless the whole patch is valid. A resulting online mode while no lessons terms version is live is ONLINE_PAYMENT_OFF detail terms (C-26, R50, R67). Audited as venue.coaching_settings; returns app.coaching_settings.';

revoke all on function app.set_coaching_settings(uuid, jsonb) from public, anon;
grant execute on function app.set_coaching_settings(uuid, jsonb) to authenticated;
