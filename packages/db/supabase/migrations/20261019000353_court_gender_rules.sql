-- 0353_court_gender_rules — Majed, 2026-10-19: some courts are kept for women
-- at set times, and some hours are women-only on every court. A gender is a
-- must for every account.
--
-- WHAT CHANGES.
--   * public.court_gender_rules: the "Gender hours" card, shaped like the rate
--     card (0007): a name, one court or every court (court_id NULL), weekdays,
--     a clock window, optional dates, on/off, and the gender the window is
--     kept for (female | male, the values of profiles.gender). A window whose
--     end is at or before its start runs past midnight into the next day and
--     belongs to the day it starts on ("Fri 22:00-02:00" is Friday night).
--     Guests read the active rows of open branches (the phone greys a kept
--     slot, as it prices one from rate_rules); staff read their branches'.
--     Written only through app.upsert_court_gender_rule; switched off, never
--     deleted (as rates). zz_branch_guard with the court as its link.
--   * app.slot_gender_rules(p_venue_id, p_court_id, p_start_at, p_end_at):
--     internal. The genders of the active rules a period touches, sorted, or
--     NULL. p_court_id NULL means any court of the branch (an open match
--     before it has a court). Any overlap counts: a 90-minute booking from
--     15:30 touches a window from 16:00.
--   * reservations_gender_guard (BEFORE INSERT OR UPDATE OF court_id,
--     start_at, end_at, guest_id, kind): a booking or hold with a guest
--     account, on a kept slot, needs that guest's gender to be the kept one:
--     GENDER_REQUIRED when the account has none, SLOT_GENDER_RESTRICTED
--     (detail: the kept gender, or "both" when two rules disagree) when it is
--     the other. Every path that writes such a row is covered at once: the
--     phone's hold, the desk's create, move and extend, series. A desk
--     booking with only a typed name (no guest account), an open match's
--     booking (no guest account), a lesson and maintenance pass: the desk
--     sees the kept window on its calendar. Status changes never re-judge a
--     row (a rule added later does not stop a booking from being marked
--     arrived).
--   * matches_gender_guard (BEFORE INSERT OR UPDATE OF category, start_at,
--     end_at, venue_id): an open match whose time touches a kept window at
--     its branch, on any court, must be that gender's match (women | men):
--     SLOT_GENDER_RESTRICTED otherwise. A match takes its court late
--     (app.match_pick_court), so it is judged against every court of the
--     branch. Sandbox matches pass.
--   * app.upsert_court_gender_rule: manager or owner at the rule's branch
--     (not a price, so no protocol). Audited gender_rule.create / .update.
--   * app.desk_register_customer re-issued from 20261006000307 verbatim, plus
--     p_gender (default NULL, so the deployed desk-customer-create keeps
--     working until the new one lands): stamped gender_set_by staff. The
--     operator asks for it on every new customer.
set lock_timeout = '3s'; set statement_timeout = '60s';

-- ===========================================================================
-- 1. The table
-- ===========================================================================

create table if not exists court_gender_rules (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null default app.current_venue() references venues(id),
  name         text not null,
  gender       text not null,
  court_id     uuid references courts(id),
  days_of_week int[] not null,
  start_time   time not null,
  end_time     time not null,
  valid_from   date,
  valid_to     date,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint court_gender_rules_name_chk check (char_length(btrim(name)) between 1 and 80),
  constraint court_gender_rules_gender_chk check (gender in ('female', 'male')),
  constraint court_gender_rules_days_chk check (
    cardinality(days_of_week) between 1 and 7 and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]),
  constraint court_gender_rules_window_chk check (start_time <> end_time),
  constraint court_gender_rules_dates_chk check (
    valid_from is null or valid_to is null or valid_from <= valid_to)
);

comment on table court_gender_rules is
  'court_gender_rules (0353): the Gender hours card. A court, or every court (court_id NULL), kept for women or men on some weekdays in a clock window, optionally between two dates. A booking or hold with a guest account on a kept slot needs that guest''s gender (reservations_gender_guard), and an open match touching a kept window at its branch must be that gender''s match (matches_gender_guard). Guests read the active rows of open branches; staff read their branches''. Written only by app.upsert_court_gender_rule; switched off, never deleted.';
comment on column court_gender_rules.id is 'The rule.';
comment on column court_gender_rules.venue_id is 'The branch the rule belongs to.';
comment on column court_gender_rules.name is 'Staff-facing name, 1 to 80 characters ("Ladies'' mornings").';
comment on column court_gender_rules.gender is 'Who the window is kept for: female or male (the values of profiles.gender).';
comment on column court_gender_rules.court_id is 'The court kept, or NULL for every court of the branch.';
comment on column court_gender_rules.days_of_week is 'The weekdays the window starts on, 0 = Sunday to 6 = Saturday, venue-local.';
comment on column court_gender_rules.start_time is 'Venue-local start of the window.';
comment on column court_gender_rules.end_time is 'Venue-local end of the window. At or before start_time: the window runs past midnight into the next day.';
comment on column court_gender_rules.valid_from is 'First day the rule applies (the day a window starts on), or NULL for no start.';
comment on column court_gender_rules.valid_to is 'Last day the rule applies (the day a window starts on), or NULL for no end.';
comment on column court_gender_rules.is_active is 'Off rules keep nobody out; they stay for history.';
comment on column court_gender_rules.created_at is 'When the rule was made.';
comment on column court_gender_rules.updated_at is 'The last save.';

alter table court_gender_rules enable row level security;
revoke all on court_gender_rules from anon, authenticated;

drop policy if exists court_gender_rules_read on court_gender_rules;
create policy court_gender_rules_read on court_gender_rules as permissive for select to anon, authenticated
  using ((is_active
          and (select app.staff_role()) is null
          and venue_id = any((select app.open_venue_ids())::uuid[]))
      or ((select app.staff_role()) is not null
          and venue_id = any((select app.visible_venue_ids())::uuid[])));

grant select on court_gender_rules to anon, authenticated;
grant all on court_gender_rules to service_role;

drop trigger if exists zz_branch_guard on public.court_gender_rules;
create trigger zz_branch_guard before insert or update or delete on public.court_gender_rules
  for each row execute function app.trg_branch_guard('scoped', 'courts', 'court_id');

-- The owner assistant may read it (table_read), as 0109 seeds any table.
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       'table',
       true,
       c.data_type,
       c.ordinal_position,
       col_description('public.court_gender_rules'::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name = 'court_gender_rules'
on conflict (table_name, column_name) do nothing;

-- ===========================================================================
-- 2. app.slot_gender_rules — which genders a period is kept for
-- ===========================================================================
-- A window belongs to the local day it starts on, so the days from the one
-- before the period's first local day (an overnight window from the evening
-- before) to its last are tried. date + time is a local wall-clock timestamp.
create or replace function app.slot_gender_rules(
  p_venue_id uuid,
  p_court_id uuid,
  p_start_at timestamptz,
  p_end_at   timestamptz
) returns text[]
language plpgsql stable security definer set search_path = public as $slot_gender_rules_0353$
declare
  v_venue uuid := p_venue_id;
  v_tz    text;
  v_ls    timestamp;
  v_le    timestamp;
  v_out   text[];
begin
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    return null;
  end if;
  if v_venue is null and p_court_id is not null then
    select c.venue_id into v_venue from courts c where c.id = p_court_id;
  end if;
  if v_venue is null then
    return null;
  end if;
  select vs.timezone into v_tz from venue_settings vs where vs.venue_id = v_venue;
  v_ls := p_start_at at time zone coalesce(v_tz, 'Asia/Baghdad');
  v_le := p_end_at   at time zone coalesce(v_tz, 'Asia/Baghdad');

  select array_agg(distinct r.gender order by r.gender) into v_out
    from court_gender_rules r
   cross join lateral generate_series(v_ls::date - 1, (v_le - interval '1 microsecond')::date,
                                      interval '1 day') g(d)
   where r.is_active
     and r.venue_id = v_venue
     and (p_court_id is null or r.court_id is null or r.court_id = p_court_id)
     and extract(dow from g.d)::int = any (r.days_of_week)
     and (r.valid_from is null or g.d::date >= r.valid_from)
     and (r.valid_to   is null or g.d::date <= r.valid_to)
     and g.d::date + r.start_time < v_le
     and g.d::date + r.end_time
         + case when r.end_time <= r.start_time then interval '1 day' else interval '0' end > v_ls;

  return v_out;
end $slot_gender_rules_0353$;

comment on function app.slot_gender_rules(uuid, uuid, timestamptz, timestamptz) is
  '0353. Internal. The genders (sorted: female, male) of the active court_gender_rules a period touches at a branch, or NULL when none does. p_court_id NULL means any court of the branch; p_venue_id NULL takes the court''s branch. Venue-local; a window belongs to the day it starts on and runs past midnight when its end is at or before its start; any overlap counts.';

revoke all on function app.slot_gender_rules(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ===========================================================================
-- 3. The booking guard
-- ===========================================================================
create or replace function app.trg_reservation_gender_guard() returns trigger
language plpgsql security definer set search_path = public as $trg_reservation_gender_guard_0353$
declare
  v_rules  text[];
  v_gender text;
begin
  if new.kind not in ('booking', 'hold')
     or new.status in ('cancelled', 'expired', 'no_show', 'completed')
     or new.guest_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.court_id = old.court_id and new.start_at = old.start_at and new.end_at = old.end_at
     and new.guest_id is not distinct from old.guest_id and new.kind = old.kind then
    return new;
  end if;

  v_rules := app.slot_gender_rules(new.venue_id, new.court_id, new.start_at, new.end_at);
  if v_rules is null then
    return new;
  end if;

  select p.gender into v_gender from profiles p where p.id = new.guest_id;
  if v_gender is null then
    raise exception 'GENDER_REQUIRED' using errcode = 'P0001',
      detail = case when cardinality(v_rules) = 1 then v_rules[1] else 'both' end;
  end if;
  if not (v_rules <@ array[v_gender]) then
    raise exception 'SLOT_GENDER_RESTRICTED' using errcode = 'P0001',
      detail = case when cardinality(v_rules) = 1 then v_rules[1] else 'both' end;
  end if;
  return new;
end $trg_reservation_gender_guard_0353$;

comment on function app.trg_reservation_gender_guard() is
  '0353. BEFORE INSERT OR UPDATE OF court_id, start_at, end_at, guest_id, kind on reservations. A live booking or hold with a guest account on a slot app.slot_gender_rules keeps: GENDER_REQUIRED when the account has no gender, SLOT_GENDER_RESTRICTED when it has the other (detail: female, male, or both when two rules disagree). No guest account (a typed desk name, an open match''s booking), a lesson or maintenance, or an update that moves nothing: passes.';

revoke all on function app.trg_reservation_gender_guard() from public, anon, authenticated;

drop trigger if exists reservations_gender_guard on public.reservations;
create trigger reservations_gender_guard
  before insert or update of court_id, start_at, end_at, guest_id, kind on public.reservations
  for each row execute function app.trg_reservation_gender_guard();

-- ===========================================================================
-- 4. The open-match guard
-- ===========================================================================
create or replace function app.trg_match_gender_guard() returns trigger
language plpgsql security definer set search_path = public as $trg_match_gender_guard_0353$
declare
  v_rules text[];
  v_need  text;
begin
  if new.sandbox or new.status not in ('filling', 'awaiting_court', 'booked') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.category = old.category and new.start_at = old.start_at
     and new.end_at = old.end_at and new.venue_id = old.venue_id then
    return new;
  end if;

  v_rules := app.slot_gender_rules(new.venue_id, null, new.start_at, new.end_at);
  if v_rules is null then
    return new;
  end if;
  v_need := case when v_rules = array['female'] then 'women'
                 when v_rules = array['male'] then 'men' end;
  if v_need is null or new.category <> v_need then
    raise exception 'SLOT_GENDER_RESTRICTED' using errcode = 'P0001',
      detail = case when cardinality(v_rules) = 1 then v_rules[1] else 'both' end;
  end if;
  return new;
end $trg_match_gender_guard_0353$;

comment on function app.trg_match_gender_guard() is
  '0353. BEFORE INSERT OR UPDATE OF category, start_at, end_at, venue_id on matches. A live, non-sandbox open match whose time touches a court_gender_rules window at its branch, on any court, must be that gender''s match (female: women, male: men): SLOT_GENDER_RESTRICTED otherwise (detail: female, male, or both).';

revoke all on function app.trg_match_gender_guard() from public, anon, authenticated;

drop trigger if exists matches_gender_guard on public.matches;
create trigger matches_gender_guard
  before insert or update of category, start_at, end_at, venue_id on public.matches
  for each row execute function app.trg_match_gender_guard();

-- ===========================================================================
-- 5. app.upsert_court_gender_rule
-- ===========================================================================
create or replace function app.upsert_court_gender_rule(
  p_name         text,
  p_gender       text,
  p_days_of_week int[],
  p_start_time   time,
  p_end_time     time,
  p_id           uuid default null,
  p_court_id     uuid default null,
  p_valid_from   date default null,
  p_valid_to     date default null,
  p_is_active    boolean default true,
  p_venue_id     uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $upsert_court_gender_rule_0353$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_venue  uuid;
  v_court  courts%rowtype;
  v_before court_gender_rules%rowtype;
  v_row    court_gender_rules%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if char_length(v_name) not between 1 and 80 then
    raise exception 'NAME_LENGTH' using errcode = 'P0001', hint = 'name: 1-80 characters';
  end if;
  if p_gender is null or p_gender not in ('female', 'male') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_gender';
  end if;
  if p_days_of_week is null or cardinality(p_days_of_week) = 0
     or exists (select 1 from unnest(p_days_of_week) d where d is null or d < 0 or d > 6) then
    raise exception 'INVALID_DAYS' using errcode = 'P0001',
      hint = 'days_of_week: 0=Sun..6=Sat, at least one';
  end if;
  if p_start_time is null or p_end_time is null or p_start_time = p_end_time then
    raise exception 'INVALID_TIME_RANGE' using errcode = 'P0001',
      hint = 'start and end must differ; an end at or before the start runs past midnight';
  end if;
  if p_valid_from is not null and p_valid_to is not null and p_valid_from > p_valid_to then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_valid_to';
  end if;

  if p_id is not null then
    select * into v_before from court_gender_rules where id = p_id for update;
    if not found then
      raise exception 'RULE_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_venue := v_before.venue_id;
  end if;

  if p_court_id is not null then
    select * into v_court from courts where id = p_court_id;
    if not found then
      raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_venue is not null and v_court.venue_id <> v_venue then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    v_venue := coalesce(v_venue, v_court.venue_id);
  end if;
  if p_venue_id is not null and v_venue is not null and p_venue_id <> v_venue then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  v_venue := coalesce(v_venue, p_venue_id, app.current_venue());

  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_id is null then
    insert into court_gender_rules (venue_id, name, gender, court_id, days_of_week, start_time,
                                    end_time, valid_from, valid_to, is_active)
    values (v_venue, v_name, p_gender, p_court_id,
            (select array_agg(distinct d order by d) from unnest(p_days_of_week) d),
            p_start_time, p_end_time, p_valid_from, p_valid_to, coalesce(p_is_active, true))
    returning * into v_row;
  else
    update court_gender_rules
       set name = v_name, gender = p_gender, court_id = p_court_id,
           days_of_week = (select array_agg(distinct d order by d) from unnest(p_days_of_week) d),
           start_time = p_start_time, end_time = p_end_time,
           valid_from = p_valid_from, valid_to = p_valid_to,
           is_active = coalesce(p_is_active, true), updated_at = now()
     where id = p_id
     returning * into v_row;
  end if;

  perform app.write_audit(
    case when p_id is null then 'gender_rule.create' else 'gender_rule.update' end,
    'court_gender_rules', v_row.id::text,
    case when p_id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_row));

  return v_row.id;
end $upsert_court_gender_rule_0353$;

comment on function app.upsert_court_gender_rule(text, text, int[], time, time, uuid, uuid, date, date, boolean, uuid) is
  '0353. Manager or owner (FORBIDDEN otherwise) at the rule''s branch (VENUE_MISMATCH otherwise: the edited rule''s, else the court''s, else p_venue_id, else app.current_venue()). Creates a Gender hours rule (p_id NULL) or replaces one wholesale. Refusals: NAME_LENGTH (1-80), INVALID_ARGUMENT detail p_gender (female | male) or p_valid_to (before p_valid_from), INVALID_DAYS (0-6, at least one), INVALID_TIME_RANGE (start = end; an end before the start runs past midnight), RULE_NOT_FOUND, COURT_NOT_FOUND, VENUE_MISMATCH (a court of another branch). Switch a rule off with p_is_active false; there is no delete. Bookings already made are not touched. Audited gender_rule.create / gender_rule.update. Returns the rule id.';

revoke all on function app.upsert_court_gender_rule(text, text, int[], time, time, uuid, uuid, date, date, boolean, uuid) from public, anon;
grant execute on function app.upsert_court_gender_rule(text, text, int[], time, time, uuid, uuid, date, date, boolean, uuid) to authenticated;

-- ===========================================================================
-- 6. app.desk_register_customer: re-issued from
--    20261006000307_identity_hardening.sql:1252 verbatim, plus p_gender.
-- ===========================================================================
drop function if exists app.desk_register_customer(uuid, text, text, text, uuid);

create or replace function app.desk_register_customer(
  p_customer_id    uuid,
  p_full_name      text,
  p_phone          text,
  p_preferred_lang text,
  p_actor_id       uuid,
  p_gender         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $desk_register_customer_0353$
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
  if not found or v_actor.role not in ('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'NAME_LENGTH' using errcode = 'P0001',
      hint = 'full name must be 1-80 characters';
  end if;
  if v_digits is null or length(v_digits) < 7 or length(v_digits) > 15 then
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
  if not exists (select 1 from auth.users where id = p_customer_id) then
    raise exception 'AUTH_USER_NOT_FOUND' using errcode = 'P0001';
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
    insert into profiles (id, full_name, phone, preferred_lang, gender, gender_set_at, gender_set_by)
    values (p_customer_id, v_name, v_phone, v_lang, p_gender,
            case when p_gender is not null then now() end,
            case when p_gender is not null then 'staff' end)
    on conflict (id) do update
      set full_name      = excluded.full_name,
          phone          = excluded.phone,
          preferred_lang = excluded.preferred_lang,
          gender         = coalesce(excluded.gender, profiles.gender),
          gender_set_at  = case when excluded.gender is not null then excluded.gender_set_at
                                else profiles.gender_set_at end,
          gender_set_by  = case when excluded.gender is not null then excluded.gender_set_by
                                else profiles.gender_set_by end
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
                             'gender_set', v_row.gender is not null));

  return jsonb_build_object('id', v_row.id, 'full_name', v_row.full_name,
                            'phone', v_row.phone, 'preferred_lang', v_row.preferred_lang,
                            'gender', v_row.gender);
end $desk_register_customer_0353$;

comment on function app.desk_register_customer(uuid, text, text, text, uuid, text) is
  '0065, 0307, 0353. Service role (desk-customer-create). Registers a desk walk-in''s profile for an auth user the edge function just made: FORBIDDEN unless p_actor_id is an active court_desk, manager or owner; NAME_LENGTH (1-80), INVALID_PHONE (7-15 digits), INVALID_LANG, INVALID_ARGUMENT detail p_gender (female | male, or NULL from a desk build before 0353), AUTH_USER_NOT_FOUND, DUPLICATE_PHONE (detail the keyed holder). The desk vouches for the number (app.desk_walkin), and a given gender is stamped gender_set_by staff. Audits customer.create (gender_set, never the value). Returns {id, full_name, phone, preferred_lang, gender}.';

revoke all on function app.desk_register_customer(uuid, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function app.desk_register_customer(uuid, text, text, text, uuid, text) to service_role;
