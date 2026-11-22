-- 0448 desk_made_accounts — every customer a desk writes down is a customer
-- record (Majed, 2026-11-21: "any customer that does anything, even if they
-- don't have the mobile app, they are added to our customer database").
--
-- Until now only the Customers page made an account (desk-customer-create,
-- 0065): a booking, an open-match seat, a lesson place or a cafe order taken
-- with a typed name and number stayed a name on that one row. The operator now
-- sends every typed name + number through desk-customer-create first (its
-- `ifExists: 'return'` mode: the account holding the number, or a new one),
-- and the row is written against that account. Two things here make it work:
--
--   1. app.desk_register_customer, re-issued from
--      20261024000368_customer_facts.sql:819 verbatim, except its actor guard:
--      court desk, manager, owner, AND cashier and shop assistant, a second
--      job counting like the main one (it read staff.role alone, so a cashier
--      with the court desk as a second job was refused, the 0404 mistake).
--      Still service role only; the edge function names who may ask for what.
--
--   2. app.phone_sign_up_status, re-issued from
--      20261113000414_phone_sign_up_status.sql:55 verbatim, plus one answer:
--      'desk', when a desk walk-in nobody has signed in to holds the number
--      (app.profile_is_desk_walkin, never staff or a coach: exactly what
--      app.phone_claim_internal will merge in). The phone's Sign in screen,
--      told "no account uses this number" by GoTrue, asks this and on 'desk'
--      opens Create account with the number filled in; the code that confirms
--      the number claims the desk's record with its bookings, bills and points
--      (0307; never the desk's typed name or gender, c21). 'taken' is tested
--      first and wins. A phone build before this reads 'desk' as 'unknown' and
--      goes on as before. Same throttle, same anon grant: like 'taken', the
--      answer says only that one typed number is known to the club.
--
--   3. A NAME WITH NO NUMBER is a customer too (Majed, the same day: "whenever
--      somebody doesn't write a number, they just write a name, it saves that
--      name with their purchase as a customer with an incomplete account").
--      app.desk_register_customer takes a NULL or blank phone and registers
--      the name alone: no phone, no key, audited customer.draft. The new
--      service-role app.desk_complete_customer(customer, phone, actor) adds the
--      number later (from the picked customer or the customer's record), which
--      turns the record into an ordinary desk walk-in: keyed, findable by the
--      number, claimable from the phone. Two people with one first name are
--      two records; nothing is ever matched by name.
--
--   4. app.customer_search and app.customer_directory sort a customer saved by
--      name alone after the ones with a number (their ORDER BY only).
--
-- No table, no column, no index; one new service-role function.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.desk_register_customer
-- ---------------------------------------------------------------------------
create or replace function app.desk_register_customer(
  p_customer_id    uuid,
  p_full_name      text,
  p_phone          text,
  p_preferred_lang text,
  p_actor_id       uuid,
  p_gender         text default null,
  p_age_band       text default null,
  p_play_level     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $desk_register_customer_0448$
declare
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_phone  text := btrim(coalesce(p_phone, ''));
  v_digits text := app.phone_digits(p_phone);
  v_canon  text := app.phone_canon(p_phone);
  v_lang   text := coalesce(p_preferred_lang, 'en');
  v_actor  staff%rowtype;
  v_dup    uuid;
  v_row    profiles%rowtype;
begin
  select * into v_actor from staff where id = p_actor_id and is_active;
  -- 0448: every desk that takes a customer's name and number makes the
  -- account, the cafe till and the shop desk included, and a second job
  -- counts like the main one (0345; the bar team holds cashier since 0446).
  if not found
     or not ((v_actor.role || v_actor.extra_roles)
             && array['court_desk','manager','owner','cashier','shop_staff']::staff_role[]) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'NAME_LENGTH' using errcode = 'P0001',
      hint = 'full name must be 1-80 characters';
  end if;
  -- 0448: a name with no number is still a customer (below); a number, when
  -- one is given, must be one.
  if v_phone <> '' and (v_digits is null or length(v_digits) < 7 or length(v_digits) > 15) then
    raise exception 'INVALID_PHONE' using errcode = 'P0001',
      hint = '7-15 digits';
  end if;
  if v_lang not in ('en','ar') then
    raise exception 'INVALID_LANG' using errcode = 'P0001';
  end if;
  -- 0353: the desk says whether the customer is a woman or a man.
  if p_gender is not null and p_gender not in ('female', 'male') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_gender';
  end if;
  -- 0368: and, when the customer says so, their age band and their own level.
  if p_age_band is not null and p_age_band not in ('u18', '18_24', '25_34', '35_44', '45_54', '55_plus') then
    raise exception 'INVALID_AGE_BAND' using errcode = 'P0001', detail = 'p_age_band';
  end if;
  if p_play_level is not null and p_play_level not in ('new', 'beginner', 'intermediate', 'advanced') then
    raise exception 'INVALID_PLAY_PROFILE' using errcode = 'P0001', detail = 'p_play_level';
  end if;
  if not exists (select 1 from auth.users where id = p_customer_id) then
    raise exception 'AUTH_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 0448: NAME ONLY. The desk wrote down a name and no number: the person is
  -- a customer all the same, INCOMPLETE until a number is added
  -- (app.desk_complete_customer). No number means no key: nothing to collide
  -- with, nothing a phone can claim yet. Audited customer.draft, so the
  -- completion can tell the desk's own unfinished record from any other
  -- profile without a phone (a Google or Apple account that never gave one).
  if v_phone = '' then
    insert into profiles (id, full_name, phone, preferred_lang, gender, gender_set_at, gender_set_by,
                          age_band, age_band_set_at, play_level, play_survey_at)
    values (p_customer_id, v_name, null, v_lang, p_gender,
            case when p_gender is not null then now() end,
            case when p_gender is not null then 'staff' end,
            p_age_band,
            case when p_age_band is not null then now() end,
            p_play_level,
            case when p_play_level is not null then now() end)
    on conflict (id) do update
      set full_name      = excluded.full_name,
          preferred_lang = excluded.preferred_lang
    returning * into v_row;

    insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
    values (p_actor_id, v_actor.role::text, 'customer.draft', 'profiles', p_customer_id::text, null,
            jsonb_build_object('full_name', v_row.full_name, 'preferred_lang', v_row.preferred_lang,
                               'source', 'desk', 'incomplete', true));

    return jsonb_build_object('id', v_row.id, 'full_name', v_row.full_name,
                              'phone', v_row.phone, 'preferred_lang', v_row.preferred_lang,
                              'gender', v_row.gender, 'age_band', v_row.age_band,
                              'play_level', v_row.play_level, 'incomplete', true);
  end if;

  -- Re-check under the write: the edge function's pre-check and this call are
  -- two round trips, and two desks can type the same walk-in at once. 0307
  -- (c1): only a keyed holder (a verified owner, a desk walk-in) is a
  -- duplicate; a guest who only typed the number blocks nobody.
  select p.id into v_dup
    from profiles p
   where p.id <> p_customer_id
     and p.phone_key = v_canon
     and p.deleted_at is null
   limit 1;
  if v_dup is not null then
    raise exception 'DUPLICATE_PHONE' using errcode = 'P0001',
      detail = v_dup::text;
  end if;

  -- 0307: the desk vouches for this number, so zz_phone_key keys it
  -- (app.profile_is_desk_walkin) before the audit row below exists.
  perform set_config('app.desk_walkin', p_customer_id::text, true);

  -- The 0058 trigger normally created this row from user_metadata already;
  -- the upsert makes the outcome the same either way. A holder that keyed the
  -- number since the re-check (zz_phone_key then stores this row keyless, or
  -- the unique index refuses it) is the same duplicate.
  begin
    insert into profiles (id, full_name, phone, preferred_lang, gender, gender_set_at, gender_set_by,
                          age_band, age_band_set_at, play_level, play_survey_at)
    values (p_customer_id, v_name, v_phone, v_lang, p_gender,
            case when p_gender is not null then now() end,
            case when p_gender is not null then 'staff' end,
            p_age_band,
            case when p_age_band is not null then now() end,
            p_play_level,
            case when p_play_level is not null then now() end)
    on conflict (id) do update
      set full_name      = excluded.full_name,
          phone          = excluded.phone,
          preferred_lang = excluded.preferred_lang,
          gender         = coalesce(excluded.gender, profiles.gender),
          gender_set_at  = case when excluded.gender is not null then excluded.gender_set_at
                                else profiles.gender_set_at end,
          gender_set_by  = case when excluded.gender is not null then excluded.gender_set_by
                                else profiles.gender_set_by end,
          -- 0368: a band or a level given at the desk fills a hole, and
          -- never overwrites what the customer answered themselves.
          age_band       = coalesce(profiles.age_band, excluded.age_band),
          age_band_set_at = case when profiles.age_band is null and excluded.age_band is not null
                                 then excluded.age_band_set_at else profiles.age_band_set_at end,
          play_level     = coalesce(profiles.play_level, excluded.play_level),
          play_survey_at = coalesce(profiles.play_survey_at, excluded.play_survey_at)
    returning * into v_row;
  exception when unique_violation then
    v_row.phone_key := null;
  end;

  perform set_config('app.desk_walkin', '', true);

  if v_row.phone_key is distinct from v_canon then
    select p.id into v_dup
      from profiles p
     where p.id <> p_customer_id and p.phone_key = v_canon and p.deleted_at is null
     limit 1;
    raise exception 'DUPLICATE_PHONE' using errcode = 'P0001',
      detail = coalesce(v_dup::text, '');
  end if;

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_actor_id, v_actor.role::text, 'customer.create', 'profiles', p_customer_id::text, null,
          jsonb_build_object('full_name', v_row.full_name, 'phone', v_row.phone,
                             'preferred_lang', v_row.preferred_lang, 'source', 'desk',
                             'gender_set', v_row.gender is not null,
                             'age_band_set', v_row.age_band is not null,
                             'level_set', v_row.play_level is not null));

  return jsonb_build_object('id', v_row.id, 'full_name', v_row.full_name,
                            'phone', v_row.phone, 'preferred_lang', v_row.preferred_lang,
                            'gender', v_row.gender, 'age_band', v_row.age_band,
                            'play_level', v_row.play_level);
end $desk_register_customer_0448$;


comment on function app.desk_register_customer(uuid, text, text, text, uuid, text, text, text) is
  '0065, 0307, 0353, 0368, 0448. Service role (desk-customer-create). Registers a desk walk-in''s profile for an auth user the edge function just made: FORBIDDEN unless p_actor_id is active staff holding court_desk, manager, owner, cashier or shop_staff as the main role or a second job (0448: every desk that writes a customer down makes the account); NAME_LENGTH (1-80), INVALID_PHONE (a number given must have 7-15 digits; NULL or blank registers the name alone as an INCOMPLETE customer: no phone, no key, audited customer.draft, returned with incomplete true, completed later by app.desk_complete_customer), INVALID_LANG, INVALID_ARGUMENT detail p_gender (female | male, or NULL: a booking, seat, lesson or order taken with only a name and a number), INVALID_AGE_BAND detail p_age_band, INVALID_PLAY_PROFILE detail p_play_level (both 0368), AUTH_USER_NOT_FOUND, DUPLICATE_PHONE (detail the keyed holder). The desk vouches for the number (app.desk_walkin), a given gender is stamped gender_set_by staff, and a band or level given only fills a hole — never over what the customer answered themselves. Audits customer.create (gender_set, age_band_set, level_set; never a value). Returns {id, full_name, phone, preferred_lang, gender, age_band, play_level}.';

revoke all on function app.desk_register_customer(uuid, text, text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function app.desk_register_customer(uuid, text, text, text, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.phone_sign_up_status
-- ---------------------------------------------------------------------------
create or replace function app.phone_sign_up_status(p_phone text)
returns text
language plpgsql volatile security definer
set search_path = app, public, pg_temp
as $phone_sign_up_status_0448$
declare
  v_digits  text := app.phone_digits(p_phone);
  v_headers jsonb;
  v_addr    text;
  v_caller  text;
  v_cap     int;
  v_canon   text;
begin
  -- 00 is the international access prefix, the same as a leading +.
  if v_digits like '00%' then
    v_digits := substr(v_digits, 3);
  end if;
  if v_digits is null or length(v_digits) < 6 or length(v_digits) > 15 then
    return 'unknown';
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_addr := nullif(trim(v_headers ->> 'cf-connecting-ip'), '');
  v_caller := case when v_addr is null then 'none' else md5(v_addr) end;
  v_cap := case when v_addr is null then 300 else 20 end;

  delete from app.phone_sign_up_lookups
   where created_at < now() - interval '1 hour';

  if (select count(*) from app.phone_sign_up_lookups l
       where l.caller = v_caller
         and l.created_at > now() - interval '10 minutes') >= v_cap then
    return 'unknown';
  end if;

  insert into app.phone_sign_up_lookups (caller) values (v_caller);

  if exists (
    select 1
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.phone = v_digits
       and p.deleted_at is null
       and coalesce(trim(p.phone), '') <> ''
       and coalesce(trim(p.full_name), '') <> ''
       and p.gender is not null
  ) then
    return 'taken';
  end if;

  -- 0448: a desk already took this person's name and number, and nobody has
  -- signed in to that account yet. The phone's Sign in then opens Create
  -- account with the number filled in; the code that confirms it claims the
  -- desk's record (app.phone_claim_internal, the same test as here).
  v_canon := app.phone_canon(v_digits);
  if v_canon is not null and exists (
    select 1
      from public.profiles p
     where p.phone_key = v_canon
       and p.deleted_at is null
       and app.profile_is_desk_walkin(p.id, v_canon)
       and not exists (select 1 from public.staff s where s.id = p.id)
       and not exists (select 1 from public.coaches c where c.profile_id = p.id)
  ) then
    return 'desk';
  end if;
  return 'free';
end $phone_sign_up_status_0448$;


comment on function app.phone_sign_up_status(text) is
  '0414, 0448: before a sign-up or sign-in code, what the club knows about one typed number: taken (a whole account owns it) | desk (0448: a desk wrote this customer down and nobody has signed in to that record; the code will claim it) | free | unknown (unreadable or throttled: 20 per caller per 10 min, 300 shared without an address). Anon by design; never raises.';

revoke all on function app.phone_sign_up_status(text) from public;
grant execute on function app.phone_sign_up_status(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.desk_complete_customer: the number that completes a name-only customer
-- ---------------------------------------------------------------------------
create or replace function app.desk_complete_customer(
  p_customer_id uuid,
  p_phone       text,
  p_actor_id    uuid
) returns jsonb
language plpgsql security definer set search_path = public as $desk_complete_customer_0448$
declare
  v_phone  text := btrim(coalesce(p_phone, ''));
  v_digits text := app.phone_digits(p_phone);
  v_canon  text := app.phone_canon(p_phone);
  v_actor  staff%rowtype;
  v_dup    uuid;
  v_row    profiles%rowtype;
begin
  select * into v_actor from staff where id = p_actor_id and is_active;
  if not found
     or not ((v_actor.role || v_actor.extra_roles)
             && array['court_desk','manager','owner','cashier','shop_staff']::staff_role[]) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_digits is null or length(v_digits) < 7 or length(v_digits) > 15 then
    raise exception 'INVALID_PHONE' using errcode = 'P0001',
      hint = '7-15 digits';
  end if;

  -- Only the desk's own unfinished record: saved by name alone (customer.draft),
  -- still without a number, never signed in to, and no staff member or coach.
  select * into v_row from profiles where id = p_customer_id and deleted_at is null for update;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(v_row.phone, '')), '') is not null
     or not exists (select 1 from audit_log a
                     where a.entity = 'profiles' and a.entity_id = p_customer_id::text
                       and a.action = 'customer.draft')
     or exists (select 1 from auth.users u where u.id = p_customer_id and u.last_sign_in_at is not null)
     or exists (select 1 from staff s where s.id = p_customer_id)
     or exists (select 1 from coaches c where c.profile_id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_INCOMPLETE' using errcode = 'P0001';
  end if;

  -- The number already has its customer (a verified owner or a desk walk-in):
  -- the desk uses that one. Named in the detail.
  select p.id into v_dup
    from profiles p
   where p.id <> p_customer_id and p.phone_key = v_canon and p.deleted_at is null
   limit 1;
  if v_dup is not null then
    raise exception 'DUPLICATE_PHONE' using errcode = 'P0001', detail = v_dup::text;
  end if;

  -- The desk vouches for this number now, exactly as desk_register_customer
  -- does: zz_phone_key keys it while the flag stands, and the customer.create
  -- row below is the lasting proof app.profile_is_desk_walkin reads.
  perform set_config('app.desk_walkin', p_customer_id::text, true);
  begin
    update profiles set phone = v_phone where id = p_customer_id returning * into v_row;
  exception when unique_violation then
    v_row.phone_key := null;
  end;
  perform set_config('app.desk_walkin', '', true);

  if v_row.phone_key is distinct from v_canon then
    select p.id into v_dup
      from profiles p
     where p.id <> p_customer_id and p.phone_key = v_canon and p.deleted_at is null
     limit 1;
    raise exception 'DUPLICATE_PHONE' using errcode = 'P0001', detail = coalesce(v_dup::text, '');
  end if;

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_actor_id, v_actor.role::text, 'customer.create', 'profiles', p_customer_id::text,
          jsonb_build_object('phone', null),
          jsonb_build_object('full_name', v_row.full_name, 'phone', v_row.phone,
                             'preferred_lang', v_row.preferred_lang, 'source', 'desk',
                             'completed', true));

  return jsonb_build_object('id', v_row.id, 'full_name', v_row.full_name,
                            'phone', v_row.phone, 'preferred_lang', v_row.preferred_lang,
                            'gender', v_row.gender);
end $desk_complete_customer_0448$;

comment on function app.desk_complete_customer(uuid, text, uuid) is
  '0448. Service role (desk-customer-create). Adds the number to a customer the desk saved by name alone, which makes it a full desk walk-in the phone can claim (0307): FORBIDDEN unless p_actor_id is active staff holding court_desk, manager, owner, cashier or shop_staff (a second job counts); INVALID_PHONE (7-15 digits); CUSTOMER_NOT_FOUND; CUSTOMER_NOT_INCOMPLETE unless the profile is the desk''s own unfinished record (a customer.draft audit row, still no phone, never signed in to, no staff member or coach); DUPLICATE_PHONE (detail the keyed holder) when the number already has its customer. The desk vouches for the number (app.desk_walkin) and the customer.create audit row (completed true) is the proof app.profile_is_desk_walkin reads. Returns {id, full_name, phone, preferred_lang, gender}.';

revoke all on function app.desk_complete_customer(uuid, text, uuid) from public, anon, authenticated;
grant execute on function app.desk_complete_customer(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. app.customer_search and app.customer_directory, re-issued from
--    20260929000262_match_desk_money.sql verbatim except their ORDER BY: a
--    customer saved by name alone sorts after the ones with a number. Names
--    without numbers arrive from every desk now (the till's orders included),
--    and "Ali" must still find the Ali the desk can call; the directory's cap
--    drops the name-only ones first, as it already drops the nameless.
-- ---------------------------------------------------------------------------
create or replace function app.customer_search(p_query text, p_limit int default 12)
returns setof jsonb
language plpgsql stable security definer set search_path = public as $customer_search_0448$
declare
  v_query  text := btrim(coalesce(p_query, ''));
  v_name   text;
  v_digits text;
  v_email  text;
  v_limit  int  := least(greatest(coalesce(p_limit, 12), 1), 50);
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- One character matches half the venue; the screen's `idle` state covers it.
  if length(v_query) < 2 then
    return;
  end if;

  v_name   := app.like_escape(replace(app.search_norm(v_query), ' ', ''));
  v_digits := app.phone_digits(v_query);
  v_email  := app.like_escape(lower(v_query));

  return query
    select jsonb_build_object(
             'id',             p.id,
             'full_name',      p.full_name,
             'phone',          p.phone,
             'email',          u.email,
             'preferred_lang', p.preferred_lang,
             'gender',         p.gender,
             'flags',          app.customer_flags_json(p.id),
             'counts',         app.customer_counts(p.id))
      from profiles p
      left join auth.users u on u.id = p.id
     where p.deleted_at is null                          -- 0077: not a tombstone
       and ((v_name <> ''
             and replace(app.search_norm(p.full_name), ' ', '') like '%' || v_name || '%')
        or (v_digits is not null and length(v_digits) >= 3
            and app.phone_digits(p.phone) like '%' || v_digits || '%')
        or ((position('@' in v_query) > 0 or length(v_query) >= 3)
            and u.email is not null and lower(u.email) like '%' || v_email || '%'))
     order by
       -- prefix hits first, then substring hits, then by name
       case
         when v_name <> '' and replace(app.search_norm(p.full_name), ' ', '') like v_name || '%' then 0
         when v_digits is not null and app.phone_digits(p.phone) like v_digits || '%' then 1
         else 2
       end,
       -- 0448: a customer with a number before one saved by name alone, so a
       -- common first name still finds the people the desk can call.
       (nullif(btrim(coalesce(p.phone, '')), '') is null),
       p.full_name,
       p.created_at desc
     limit v_limit;
end $customer_search_0448$;

comment on function app.customer_search(text, int) is
  '0065, 0262, 0448. Court desk, cashier, manager, owner: live customers matching a name, phone digits or email (two characters at least), each {id, full_name, phone, email, preferred_lang, gender, flags, counts}; prefix hits first, then (0448) customers with a number before those saved by name alone, then by name; p_limit clamped to 1..50.';

revoke all on function app.customer_search(text, int) from public, anon, authenticated;
grant execute on function app.customer_search(text, int) to authenticated;

create or replace function app.customer_directory(p_limit int default 5000)
returns jsonb
language plpgsql stable security definer set search_path = public as $customer_directory_0448$
declare
  v_limit int := least(greatest(coalesce(p_limit, 5000), 1), 5000);
  v_total bigint;
  v_rows  jsonb;
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select count(*) into v_total
    from profiles p
   where p.deleted_at is null
     and not exists (select 1 from staff s where s.id = p.id and s.is_active);

  with page as (
    select p.id, p.full_name, p.phone
      from profiles p
     where p.deleted_at is null
       and not exists (select 1 from staff s where s.id = p.id and s.is_active)
     -- a nameless account last, as the screen lists it, so the cap drops those first;
     -- 0448: then the customers saved by name alone (no number), for the same reason
     order by (btrim(coalesce(p.full_name, '')) = ''),
              (nullif(btrim(coalesce(p.phone, '')), '') is null),
              p.full_name, p.created_at desc
     limit v_limit
  ),
  counts as (
    select r.guest_id,
           count(*) filter (where r.kind = 'booking'
                              and r.status in ('pending','confirmed','arrived','completed')) as bookings,
           count(*) filter (where r.kind = 'booking' and r.status = 'cancelled')          as cancellations,
           count(*) filter (where r.kind = 'booking' and r.status = 'no_show')            as no_shows
      from reservations r
      join page on page.id = r.guest_id
     group by r.guest_id
  ),
  -- 0262: no_show seats of non-sandbox open matches, as customer_counts counts them.
  seat_no_shows as (
    select ms.guest_id, count(*) as no_shows
      from match_seats ms
      join matches m on m.id = ms.match_id and not m.sandbox
      join page on page.id = ms.guest_id
     where ms.status = 'no_show'
     group by ms.guest_id
  ),
  flags as (
    select f.customer_id,
           jsonb_agg(jsonb_build_object('type', f.type, 'label', f.label) order by f.type) as flags
      from customer_flags f
      join page on page.id = f.customer_id
     group by f.customer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        page.id,
           'full_name', page.full_name,
           'phone',     page.phone,
           'email',     u.email,
           'flags',     coalesce(fl.flags, '[]'::jsonb),
           'counts',    jsonb_build_object(
                          'bookings',      coalesce(c.bookings, 0),
                          'cancellations', coalesce(c.cancellations, 0),
                          'noShows',       coalesce(c.no_shows, 0) + coalesce(sn.no_shows, 0)))
           order by page.full_name), '[]'::jsonb)
    into v_rows
    from page
    left join auth.users u     on u.id = page.id
    left join counts c         on c.guest_id = page.id
    left join seat_no_shows sn on sn.guest_id = page.id
    left join flags fl         on fl.customer_id = page.id;

  return jsonb_build_object(
    'rows',      v_rows,
    'total',     v_total,
    'truncated', v_total > v_limit);
end $customer_directory_0448$;

comment on function app.customer_directory(int) is
  '0262 = the 0148 directory (every live non-staff customer, name order, {rows, total, truncated}, p_limit clamped to 1..5000) with counts.noShows adding the customer''s no_show seats in non-sandbox open matches, as customer_counts does (DF-12, DF-15). 0448: within the cap, nameless accounts last and customers saved by name alone (no number) after the ones with a number, so the cap drops those first. Court desk, cashier, manager, owner.';

revoke all on function app.customer_directory(int) from public, anon, authenticated;
grant execute on function app.customer_directory(int) to authenticated;
