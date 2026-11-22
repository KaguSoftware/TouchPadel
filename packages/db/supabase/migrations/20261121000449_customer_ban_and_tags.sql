-- ===========================================================================
-- 0449 — customer ban and customer tags with a rule (Majed, 2026-11-21).
--
-- The ask: "in customers tab, it's easy to block somebody from doing anything
-- on the system. Basically a full ban. And also make it easy to put a tag.
-- Something like this guy gets 15% across everything ... those tags that we
-- have already, but I want those to actually enforce a rule. That operator
-- would set up."
--
-- 1. THE BAN. A customer_flags row of type 'ban' (label = the reason), the
--    same table as the open-match ban (match_ban, 0253), so it shows wherever
--    flags already show: the search, the picker, the booking, the calendar,
--    the match and lesson rosters. Written only by app.set_customer_ban
--    (court desk, manager, owner; a reason is required; audited
--    customer.ban). Never on active staff (CUSTOMER_IS_STAFF).
--    What it does, from the next statement:
--      * the phone app and the website: app.pre_request refuses every API
--        request from the banned account (CUSTOMER_BANNED), reads included;
--        the account is also banned in auth (banned_until infinity) and
--        signed out, so a new sign-in or a desk-made account's first sign-in
--        is refused too. Lifting the ban clears both.
--      * every desk, till and service-role writer: a guard trigger refuses a
--        new booking (reservations.guest_id), open-match seat or request,
--        lesson place, tournament entry, and a café or shop bill
--        (tabs.customer_id) naming the banned customer (CUSTOMER_BANNED,
--        detail the table). Putting the customer on a nameless row (NULL ->
--        banned) is refused the same way; moving rows between two accounts (a
--        merge) is not. A bill for one of their bookings (tabs.reservation_id)
--        stays open to the desk, so a game already played can still be paid.
--      * what they already hold stays as it is (bookings, seats, places, open
--        bills, points): the ban dialog shows how many bookings and seats are
--        still coming so the desk can cancel them by hand.
--      * an account merge carries the ban to the account kept, including a
--        walk-in claim, which otherwise moves no flags (c21).
--
-- 2. TAGS. The club's own list of tags (customer_tags: a name and an optional
--    rule), put on customers (customer_tag_members). The rule is a percent off
--    café and shop goods and/or a percent off the court fee, applied exactly
--    where the customer's own standing discount (0342) applies: the whole
--    café/shop bill, and the court fee of their plain bookings (not open-match
--    seats, lessons or tournaments). The customer's own discount wins on the
--    part it sets; a part it does not set comes from their tag with the
--    biggest percent for that part. A tag discount is authorised on the bill
--    and in day close by the person who put the tag on the customer (the 0342
--    rule: the configuration is the authorisation).
--      * manager, owner: create, rename, change the rule of, or delete a tag
--        (app.save_customer_tag, app.delete_customer_tag). A manager who
--        carries the tag cannot change its rule (SELF_DISCOUNT).
--      * court desk, cashier, shop assistant, manager, owner (the 0342
--        discount roles): put tags on and off a customer
--        (app.set_customer_tags); nobody puts a tag with a rule on themselves
--        (SELF_DISCOUNT).
--      * app.customer_ban_and_tags reads it all for the record: the ban, the
--        customer's tags, the catalogue, the discount the bills will apply
--        and what is still coming.
--    The seam is one internal, app.customer_standing_discount(customer, part),
--    which the three readers of customer_discounts on a bill now call
--    (customer_tab_discount_plan, apply_customer_court_discount,
--    bill_customer_discount); bill_customer_discount's 'standing' is the
--    effective discount (app.customer_effective_discount_json) so the bill
--    dialog sees a tag's discount coming like an own one.
--
-- New: tables customer_tags, customer_tag_members; RPCs set_customer_ban,
-- customer_ban_and_tags, save_customer_tag, delete_customer_tag,
-- set_customer_tags; internals customer_banned, customer_standing_discount,
-- customer_effective_discount_json, customer_tags_json,
-- trg_customer_ban_guard, trg_merge_carry_ban, trg_customer_tag_member_repoint,
-- trg_profile_tags_tombstone. Re-issued: set_customer_flags (0262),
-- customer_tab_discount_plan (0342), apply_customer_court_discount (0430),
-- bill_customer_discount (0403), pre_request (0398), profile_merge_columns
-- (0445). Constraints widened: customer_flags type + 'ban',
-- reservation_court_discounts reason + 'tag'.
--
-- covered by packages/db/tests/customer-ban-tags.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Constraints
-- ---------------------------------------------------------------------------
do $customer_ban_constraints_0449$
begin
  if exists (select 1 from pg_constraint
              where conname = 'customer_flags_type_check' and conrelid = 'public.customer_flags'::regclass
                and pg_get_constraintdef(oid) not like '%''ban''%') then
    alter table customer_flags drop constraint customer_flags_type_check;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'customer_flags_type_check' and conrelid = 'public.customer_flags'::regclass) then
    alter table customer_flags add constraint customer_flags_type_check
      check (type in ('vip', 'birthday', 'payment_note', 'special_request', 'deposit_exempt',
                      'match_ban', 'ban')) not valid;
  end if;

  if exists (select 1 from pg_constraint
              where conname = 'reservation_court_discounts_reason' and conrelid = 'public.reservation_court_discounts'::regclass
                and pg_get_constraintdef(oid) not like '%''tag''%') then
    alter table reservation_court_discounts drop constraint reservation_court_discounts_reason;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'reservation_court_discounts_reason' and conrelid = 'public.reservation_court_discounts'::regclass) then
    alter table reservation_court_discounts add constraint reservation_court_discounts_reason
      check (reason in ('sponsored', 'family', 'coach', 'staff', 'other', 'tag')) not valid;
  end if;
end $customer_ban_constraints_0449$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- The club's tags. Chain-wide, like customer_flags and customer_discounts.
create table if not exists customer_tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  cafe_bp    int,
  court_bp   int,
  created_by uuid not null references staff(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references staff(id),
  updated_at timestamptz not null default now(),
  constraint customer_tags_name check (length(btrim(name)) between 1 and 40 and name = btrim(name)),
  constraint customer_tags_cafe check (cafe_bp is null or cafe_bp between 1 and 10000),
  constraint customer_tags_court check (court_bp is null or court_bp between 1 and 10000)
);

comment on table customer_tags is
  '0449. The club''s customer tags, chain-wide: a name (1..40, unique ignoring case, kept by app.save_customer_tag) and an optional rule, cafe_bp (basis points off café and shop goods) and court_bp (off the court fee of plain bookings). Written only by app.save_customer_tag / app.delete_customer_tag (manager, owner); read through app.customer_ban_and_tags. No client grant.';

alter table customer_tags enable row level security;

-- Who carries which tag. set_by authorises the tag's discount on a bill.
create table if not exists customer_tag_members (
  customer_id uuid not null references profiles(id) on delete cascade,
  tag_id      uuid not null references customer_tags(id) on delete cascade,
  set_by      uuid not null references staff(id),
  set_at      timestamptz not null default now(),
  primary key (customer_id, tag_id)
);

comment on table customer_tag_members is
  '0449. One row per tag a customer carries. set_by is who put it on them, and authorises the tag''s discount on their bills (authorized_by). Written only by app.set_customer_tags; an account merge re-points it (a tag keep already carries stays on the drop and goes with its tombstone); a deleted account loses its rows. No client grant.';

alter table customer_tag_members enable row level security;

-- A merge re-points customer_id (profile_merge_columns 'repoint'): a tag the
-- kept account already carries is left on the drop instead of colliding.
create or replace function app.trg_customer_tag_member_repoint() returns trigger
language plpgsql security definer set search_path = public as $trg_customer_tag_member_repoint_0449$
begin
  if exists (select 1 from customer_tag_members m
              where m.customer_id = new.customer_id and m.tag_id = new.tag_id) then
    return null;
  end if;
  return new;
end $trg_customer_tag_member_repoint_0449$;

revoke all on function app.trg_customer_tag_member_repoint() from public, anon, authenticated;

comment on function app.trg_customer_tag_member_repoint() is
  '0449. BEFORE UPDATE OF customer_id on customer_tag_members: skips the update when the new customer already carries the tag (the merge''s generic re-point never collides on the key).';

drop trigger if exists customer_tag_members_repoint on customer_tag_members;
create trigger customer_tag_members_repoint
  before update of customer_id on customer_tag_members
  for each row
  when (new.customer_id is distinct from old.customer_id)
  execute function app.trg_customer_tag_member_repoint();

-- A deleted account (delete_my_account tombstones the profile) loses its tags.
create or replace function app.trg_profile_tags_tombstone() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_tags_tombstone_0449$
begin
  delete from customer_tag_members where customer_id = new.id;
  return null;
end $trg_profile_tags_tombstone_0449$;

revoke all on function app.trg_profile_tags_tombstone() from public, anon, authenticated;

comment on function app.trg_profile_tags_tombstone() is
  '0449. AFTER UPDATE OF deleted_at on profiles, when an account is deleted: its customer_tag_members rows go.';

drop trigger if exists profiles_tags_tombstone on profiles;
create trigger profiles_tags_tombstone
  after update of deleted_at on profiles
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function app.trg_profile_tags_tombstone();

-- ---------------------------------------------------------------------------
-- 3. Internals
-- ---------------------------------------------------------------------------

create or replace function app.customer_banned(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public as $customer_banned_0449$
  select p_customer_id is not null
     and exists (select 1 from customer_flags f where f.customer_id = p_customer_id and f.type = 'ban')
$customer_banned_0449$;

revoke all on function app.customer_banned(uuid) from public, anon, authenticated;

comment on function app.customer_banned(uuid) is
  '0449. Internal: true when the customer carries the full ban (customer_flags type ban).';

-- The standing discount one part of a bill gets: the customer's own
-- (customer_discounts) when it sets that part, else the tag they carry with
-- the biggest percent for it (ties by name), shaped as a customer_discounts
-- row: kind percent, reason 'tag', note the tag's name, set_by who put the
-- tag on them. No row when neither gives one.
create or replace function app.customer_standing_discount(p_customer_id uuid, p_part text)
returns setof customer_discounts
language plpgsql stable security definer set search_path = public as $customer_standing_discount_0449$
declare
  v_own customer_discounts%rowtype;
  v_out customer_discounts%rowtype;
  v_tag record;
begin
  if p_customer_id is null or p_part not in ('cafe', 'court') then
    return;
  end if;
  select * into v_own from customer_discounts d where d.customer_id = p_customer_id;
  if found and ((p_part = 'cafe' and v_own.cafe_kind is not null)
                or (p_part = 'court' and v_own.court_kind is not null)) then
    return next v_own;
    return;
  end if;

  select t.name, m.set_by, m.set_at,
         case when p_part = 'cafe' then t.cafe_bp else t.court_bp end as bp
    into v_tag
    from customer_tag_members m
    join customer_tags t on t.id = m.tag_id
   where m.customer_id = p_customer_id
     and (case when p_part = 'cafe' then t.cafe_bp else t.court_bp end) is not null
   order by 4 desc, t.name
   limit 1;
  if not found then
    return;
  end if;

  v_out.customer_id := p_customer_id;
  if p_part = 'cafe' then
    v_out.cafe_kind := 'percent';
    v_out.cafe_value := v_tag.bp;
  else
    v_out.court_kind := 'percent';
    v_out.court_value := v_tag.bp;
  end if;
  v_out.reason := 'tag';
  v_out.note := v_tag.name;
  v_out.set_by := v_tag.set_by;
  v_out.set_at := v_tag.set_at;
  return next v_out;
end $customer_standing_discount_0449$;

revoke all on function app.customer_standing_discount(uuid, text) from public, anon, authenticated;

comment on function app.customer_standing_discount(uuid, text) is
  '0449. Internal: the standing discount p_part (cafe | court) of a bill gets: the customer''s own customer_discounts row when it sets that part, else a row built from the tag they carry with the biggest percent for that part (kind percent, reason tag, note the tag name, set_by who put the tag on, set_at then); no row when neither gives one. customer_tab_discount_plan, apply_customer_court_discount and bill_customer_discount read it.';

-- customer_discount_json's shape for what the bills will actually apply: each
-- part as {kind, value, tag} (tag = the tag''s name when a tag gives it).
-- reason/note/set_by/set_at are the own discount's when there is one, else
-- the tag's (reason 'tag'). NULL when no part applies.
create or replace function app.customer_effective_discount_json(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_effective_discount_json_0449$
declare
  v_own   jsonb := app.customer_discount_json(p_customer_id);
  v_cafe  customer_discounts%rowtype;
  v_court customer_discounts%rowtype;
  v_from  customer_discounts%rowtype;
  v_base  jsonb;
begin
  select * into v_cafe from app.customer_standing_discount(p_customer_id, 'cafe');
  select * into v_court from app.customer_standing_discount(p_customer_id, 'court');
  if v_cafe.customer_id is null and v_court.customer_id is null then
    return null;
  end if;
  if v_own is not null then
    v_base := v_own;
  else
    v_from := case when v_cafe.customer_id is not null then v_cafe else v_court end;
    v_base := jsonb_build_object(
      'reason', 'tag',
      'note',   v_from.note,
      'set_by', (select jsonb_build_object('id', s.id, 'name', s.display_name) from staff s where s.id = v_from.set_by),
      'set_at', v_from.set_at);
  end if;
  return v_base || jsonb_build_object(
    'cafe',  case when v_cafe.cafe_kind is null then null
                  else jsonb_build_object('kind', v_cafe.cafe_kind, 'value', v_cafe.cafe_value,
                                          'tag', case when v_cafe.reason = 'tag' then v_cafe.note end) end,
    'court', case when v_court.court_kind is null then null
                  else jsonb_build_object('kind', v_court.court_kind, 'value', v_court.court_value,
                                          'tag', case when v_court.reason = 'tag' then v_court.note end) end);
end $customer_effective_discount_json_0449$;

revoke all on function app.customer_effective_discount_json(uuid) from public, anon, authenticated;

comment on function app.customer_effective_discount_json(uuid) is
  '0449. Internal: the discount the customer''s bills apply, own and tags together, in customer_discount_json''s shape: cafe and court each {kind, value, tag} (tag = the tag''s name when a tag gives that part, else NULL), reason/note/set_by/set_at the own discount''s when they have one, else the tag''s (reason tag, note its name). NULL when nothing applies.';

create or replace function app.customer_tags_json(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = public as $customer_tags_json_0449$
  select coalesce(
           (select jsonb_agg(jsonb_build_object(
                               'id',       t.id,
                               'name',     t.name,
                               'cafe_bp',  t.cafe_bp,
                               'court_bp', t.court_bp,
                               'set_by',   jsonb_build_object('id', s.id, 'name', s.display_name),
                               'set_at',   m.set_at)
                             order by lower(t.name))
              from customer_tag_members m
              join customer_tags t on t.id = m.tag_id
              left join staff s on s.id = m.set_by
             where m.customer_id = p_customer_id),
           '[]'::jsonb)
$customer_tags_json_0449$;

revoke all on function app.customer_tags_json(uuid) from public, anon, authenticated;

comment on function app.customer_tags_json(uuid) is
  '0449. Internal: the tags a customer carries, [{id, name, cafe_bp, court_bp, set_by: {id, name}, set_at}] by name; [] for none.';

-- ---------------------------------------------------------------------------
-- 4. The ban
-- ---------------------------------------------------------------------------

create or replace function app.set_customer_ban(p_customer_id uuid, p_banned boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_customer_ban_0449$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_was    customer_flags%rowtype;
  v_had    boolean;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_banned is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_banned';
  end if;
  if not exists (select 1 from profiles where id = p_customer_id and deleted_at is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_banned and v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if length(coalesce(v_reason, '')) > 120 then
    raise exception 'LABEL_LENGTH' using errcode = 'P0001', hint = 'a ban reason is at most 120 characters';
  end if;
  if p_banned and exists (select 1 from staff s where s.id = p_customer_id and s.is_active) then
    raise exception 'CUSTOMER_IS_STAFF' using errcode = 'P0001',
      hint = 'a staff member is switched off in Staff, not banned';
  end if;

  select * into v_was from customer_flags f where f.customer_id = p_customer_id and f.type = 'ban';
  v_had := found;

  if p_banned then
    if v_had and v_was.label is not distinct from v_reason then
      return jsonb_build_object('customer_id', p_customer_id, 'banned', true, 'duplicate', true);
    end if;
    insert into customer_flags (customer_id, type, label, created_by)
    values (p_customer_id, 'ban', v_reason, auth.uid())
    on conflict (customer_id, type) do update
      set label = excluded.label, created_by = excluded.created_by, created_at = now();
    -- Sign-in refused and every session ended (refresh tokens cascade). The
    -- flag is what the API checks; this only closes the door earlier.
    update auth.users set banned_until = 'infinity', updated_at = now()
     where id = p_customer_id and banned_until is distinct from 'infinity';
    delete from auth.sessions where user_id = p_customer_id;
  else
    if not v_had then
      return jsonb_build_object('customer_id', p_customer_id, 'banned', false, 'duplicate', true);
    end if;
    delete from customer_flags where customer_id = p_customer_id and type = 'ban';
    update auth.users set banned_until = null, updated_at = now()
     where id = p_customer_id and banned_until = 'infinity';
  end if;

  perform app.write_audit('customer.ban', 'customer_flags', p_customer_id::text,
                          jsonb_build_object('banned', v_had, 'reason', v_was.label),
                          jsonb_build_object('banned', p_banned,
                                             'reason', case when p_banned then v_reason
                                                            else coalesce(v_reason, v_was.label) end));
  return jsonb_build_object('customer_id', p_customer_id, 'banned', p_banned, 'duplicate', false);
end $set_customer_ban_0449$;

revoke all on function app.set_customer_ban(uuid, boolean, text) from public, anon;
grant execute on function app.set_customer_ban(uuid, boolean, text) to authenticated;

comment on function app.set_customer_ban(uuid, boolean, text) is
  '0449. Court desk, manager, owner: bans the customer from everything (p_banned true; p_reason required, at most 120, stored as the ban flag''s label) or lifts the ban (p_reason optional, audit only). A ban also bans the auth account (banned_until infinity) and ends its sessions; lifting clears that. CUSTOMER_NOT_FOUND (missing or deleted), REASON_REQUIRED, LABEL_LENGTH, CUSTOMER_IS_STAFF (an active staff member), INVALID_ARGUMENT (p_banned NULL); the same state answers duplicate true and writes nothing. Audit customer.ban {banned, reason}. The only writer of a ban flag. Returns {customer_id, banned, duplicate}.';

-- The guard on every table a customer's new activity lands in. tg_argv[0] is
-- the customer column. A new row naming a banned customer, or a nameless row
-- given one, is refused; a row moved from one account to another (a merge)
-- is not, nor a bill for one of their bookings.
create or replace function app.trg_customer_ban_guard() returns trigger
language plpgsql security definer set search_path = public as $trg_customer_ban_guard_0449$
declare
  v_new jsonb := to_jsonb(new);
  v_id  uuid;
begin
  v_id := (v_new ->> tg_argv[0])::uuid;
  if v_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(old) ->> tg_argv[0]) is not null then
    return new;
  end if;
  if tg_table_name = 'tabs' and (v_new ->> 'reservation_id') is not null then
    return new;
  end if;
  if exists (select 1 from customer_flags f where f.customer_id = v_id and f.type = 'ban') then
    raise exception 'CUSTOMER_BANNED' using errcode = 'P0001', detail = tg_table_name,
      hint = 'the club banned this customer';
  end if;
  return new;
end $trg_customer_ban_guard_0449$;

revoke all on function app.trg_customer_ban_guard() from public, anon, authenticated;

comment on function app.trg_customer_ban_guard() is
  '0449. BEFORE INSERT OR UPDATE OF <customer column> (tg_argv[0]) on reservations, match_seats, match_requests, lesson_enrolments, tournament_entries and tabs: CUSTOMER_BANNED (detail the table) when the row names a customer carrying the ban and is new, or was nameless (NULL) before. A re-point from another account (a merge) passes, and so does a tab with a reservation_id (the bill of a booking already made).';

drop trigger if exists customer_ban_guard on reservations;
create trigger customer_ban_guard before insert or update of guest_id on reservations
  for each row execute function app.trg_customer_ban_guard('guest_id');
drop trigger if exists customer_ban_guard on match_seats;
create trigger customer_ban_guard before insert or update of guest_id on match_seats
  for each row execute function app.trg_customer_ban_guard('guest_id');
drop trigger if exists customer_ban_guard on match_requests;
create trigger customer_ban_guard before insert or update of guest_id on match_requests
  for each row execute function app.trg_customer_ban_guard('guest_id');
drop trigger if exists customer_ban_guard on lesson_enrolments;
create trigger customer_ban_guard before insert or update of guest_id on lesson_enrolments
  for each row execute function app.trg_customer_ban_guard('guest_id');
drop trigger if exists customer_ban_guard on tournament_entries;
create trigger customer_ban_guard before insert or update of guest_id on tournament_entries
  for each row execute function app.trg_customer_ban_guard('guest_id');
drop trigger if exists customer_ban_guard on tabs;
create trigger customer_ban_guard before insert or update of customer_id on tabs
  for each row execute function app.trg_customer_ban_guard('customer_id');

-- A merge carries the ban to the account kept: a walk-in claim moves no flags
-- (c21) and a plain merge keeps keep's flag on a clash, so the ban is copied
-- here from whichever side still holds it.
create or replace function app.trg_merge_carry_ban() returns trigger
language plpgsql security definer set search_path = public as $trg_merge_carry_ban_0449$
begin
  insert into customer_flags (customer_id, type, label, created_by, created_at)
  select new.keep_id, 'ban', f.label, f.created_by, f.created_at
    from customer_flags f
   where f.customer_id = new.drop_id and f.type = 'ban'
  on conflict (customer_id, type) do nothing;
  return null;
end $trg_merge_carry_ban_0449$;

revoke all on function app.trg_merge_carry_ban() from public, anon, authenticated;

comment on function app.trg_merge_carry_ban() is
  '0449. AFTER INSERT on app.profile_merges for a merge that happened (not walkin_claim_failed or phone_reclaimed): when the drop still carries the ban, the kept account gets it too (same label and author). The API then refuses the kept account (pre_request) as it refused the drop.';

drop trigger if exists profile_merges_carry_ban on app.profile_merges;
create trigger profile_merges_carry_ban
  after insert on app.profile_merges
  for each row
  when (new.reason not in ('walkin_claim_failed', 'phone_reclaimed'))
  execute function app.trg_merge_carry_ban();

-- ---------------------------------------------------------------------------
-- 5. The record's read, and the tags
-- ---------------------------------------------------------------------------

create or replace function app.customer_ban_and_tags(p_customer_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_ban_and_tags_0449$
declare
  v_catalog jsonb;
  v_ban     jsonb := null;
  v_coming  jsonb := null;
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
                    'id',       t.id,
                    'name',     t.name,
                    'cafe_bp',  t.cafe_bp,
                    'court_bp', t.court_bp,
                    'members',  (select count(*) from customer_tag_members m
                                  join profiles p on p.id = m.customer_id and p.deleted_at is null
                                 where m.tag_id = t.id))
                  order by lower(t.name)), '[]'::jsonb)
    into v_catalog
    from customer_tags t;

  if p_customer_id is null then
    return jsonb_build_object('catalog', v_catalog,
                              'can_manage', app.is_staff('manager', 'owner'));
  end if;
  if not exists (select 1 from profiles where id = p_customer_id and deleted_at is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select jsonb_build_object('reason', f.label,
                            'by', case when s.id is null then null
                                       else jsonb_build_object('id', s.id, 'name', s.display_name) end,
                            'at', f.created_at)
    into v_ban
    from customer_flags f
    left join staff s on s.id = f.created_by
   where f.customer_id = p_customer_id and f.type = 'ban';

  select jsonb_build_object(
           'bookings', (select count(*) from reservations r
                         where r.guest_id = p_customer_id and r.kind = 'booking'
                           and r.start_at >= now() and r.status in ('pending', 'confirmed', 'arrived')),
           'seats',    (select count(*) from match_seats ms
                          join matches m on m.id = ms.match_id
                         where ms.guest_id = p_customer_id and ms.ended_at is null
                           and m.status in ('filling', 'awaiting_court', 'booked')
                           and m.start_at >= now() and not m.sandbox))
    into v_coming;

  return jsonb_build_object(
    'customer_id', p_customer_id,
    'ban',         v_ban,
    'tags',        app.customer_tags_json(p_customer_id),
    'effective',   app.customer_effective_discount_json(p_customer_id),
    'coming',      v_coming,
    'is_staff',    exists (select 1 from staff s where s.id = p_customer_id and s.is_active),
    'catalog',     v_catalog,
    'can_manage',  app.is_staff('manager', 'owner'));
end $customer_ban_and_tags_0449$;

revoke all on function app.customer_ban_and_tags(uuid) from public, anon;
grant execute on function app.customer_ban_and_tags(uuid) to authenticated;

comment on function app.customer_ban_and_tags(uuid) is
  '0449. Court desk, cashier, shop assistant, manager, owner. With p_customer_id NULL: {catalog, can_manage}. Else {customer_id, ban: {reason, by: {id, name} | null, at} | null, tags: customer_tags_json, effective: customer_effective_discount_json | null, coming: {bookings (plain bookings still to come), seats (open-match seats still to come)}, is_staff, catalog: [{id, name, cafe_bp, court_bp, members}] by name, can_manage (manager or owner)}. CUSTOMER_NOT_FOUND for a missing or deleted profile.';

create or replace function app.save_customer_tag(
  p_tag_id   uuid default null,
  p_name     text default null,
  p_cafe_bp  int  default null,
  p_court_bp int  default null
) returns jsonb
language plpgsql security definer set search_path = public as $save_customer_tag_0449$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_before customer_tags%rowtype;
  v_row    customer_tags%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if length(v_name) = 0 or length(v_name) > 40 then
    raise exception 'NAME_LENGTH' using errcode = 'P0001', hint = 'a tag name is 1-40 characters';
  end if;
  if (p_cafe_bp is not null and p_cafe_bp not between 1 and 10000)
     or (p_court_bp is not null and p_court_bp not between 1 and 10000) then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', hint = 'a tag percent is 0.01-100 (1-10000 basis points)';
  end if;
  if exists (select 1 from customer_tags t
              where lower(t.name) = lower(v_name) and t.id is distinct from p_tag_id) then
    raise exception 'TAG_NAME_TAKEN' using errcode = 'P0001';
  end if;

  if p_tag_id is null then
    insert into customer_tags (name, cafe_bp, court_bp, created_by, updated_by)
    values (v_name, p_cafe_bp, p_court_bp, auth.uid(), auth.uid())
    returning * into v_row;
    perform app.write_audit('customer_tag.create', 'customer_tags', v_row.id::text, null,
                            jsonb_build_object('name', v_row.name, 'cafe_bp', v_row.cafe_bp, 'court_bp', v_row.court_bp));
  else
    select * into v_before from customer_tags where id = p_tag_id for update;
    if not found then
      raise exception 'TAG_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- Nobody below the owner changes the discount of a tag they carry.
    if (v_before.cafe_bp is distinct from p_cafe_bp or v_before.court_bp is distinct from p_court_bp)
       and not app.is_staff('owner')
       and exists (select 1 from customer_tag_members m where m.tag_id = p_tag_id and m.customer_id = auth.uid()) then
      raise exception 'SELF_DISCOUNT' using errcode = 'P0001';
    end if;
    update customer_tags
       set name = v_name, cafe_bp = p_cafe_bp, court_bp = p_court_bp,
           updated_by = auth.uid(), updated_at = now()
     where id = p_tag_id
     returning * into v_row;
    if (v_before.name, v_before.cafe_bp, v_before.court_bp) is distinct from (v_row.name, v_row.cafe_bp, v_row.court_bp) then
      perform app.write_audit('customer_tag.update', 'customer_tags', v_row.id::text,
                              jsonb_build_object('name', v_before.name, 'cafe_bp', v_before.cafe_bp, 'court_bp', v_before.court_bp),
                              jsonb_build_object('name', v_row.name, 'cafe_bp', v_row.cafe_bp, 'court_bp', v_row.court_bp));
    end if;
  end if;

  return jsonb_build_object('id', v_row.id, 'name', v_row.name,
                            'cafe_bp', v_row.cafe_bp, 'court_bp', v_row.court_bp);
end $save_customer_tag_0449$;

revoke all on function app.save_customer_tag(uuid, text, int, int) from public, anon;
grant execute on function app.save_customer_tag(uuid, text, int, int) to authenticated;

comment on function app.save_customer_tag(uuid, text, int, int) is
  '0449. Manager, owner: creates a tag (p_tag_id NULL) or renames it and sets its rule. p_name 1..40 (NAME_LENGTH), unique ignoring case (TAG_NAME_TAKEN); p_cafe_bp / p_court_bp basis points 1..10000 or NULL for none (INVALID_VALUE). TAG_NOT_FOUND; SELF_DISCOUNT when a manager changes the rule of a tag they carry. Open bills of its members pick a new rule up on their next refresh; closed bills keep theirs. Audit customer_tag.create / customer_tag.update. Returns {id, name, cafe_bp, court_bp}.';

create or replace function app.delete_customer_tag(p_tag_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $delete_customer_tag_0449$
declare
  v_row customer_tags%rowtype;
  v_n   int;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from customer_tags where id = p_tag_id for update;
  if not found then
    raise exception 'TAG_NOT_FOUND' using errcode = 'P0001';
  end if;
  select count(*) into v_n from customer_tag_members where tag_id = p_tag_id;
  delete from customer_tags where id = p_tag_id;   -- its members cascade
  perform app.write_audit('customer_tag.delete', 'customer_tags', p_tag_id::text,
                          jsonb_build_object('name', v_row.name, 'cafe_bp', v_row.cafe_bp,
                                             'court_bp', v_row.court_bp, 'members', v_n),
                          null);
  return jsonb_build_object('id', p_tag_id, 'members', v_n);
end $delete_customer_tag_0449$;

revoke all on function app.delete_customer_tag(uuid) from public, anon;
grant execute on function app.delete_customer_tag(uuid) to authenticated;

comment on function app.delete_customer_tag(uuid) is
  '0449. Manager, owner: deletes a tag and takes it off everyone who carried it. TAG_NOT_FOUND. Audit customer_tag.delete {name, cafe_bp, court_bp, members}. Returns {id, members}.';

create or replace function app.set_customer_tags(p_customer_id uuid, p_tag_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $set_customer_tags_0449$
declare
  v_ids    uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_tag_ids, '{}'::uuid[])) x where x is not null), '{}'::uuid[]);
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles where id = p_customer_id and deleted_at is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from customer_tags t where t.id = x)) then
    raise exception 'TAG_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Nobody gives themselves a discount (0342's rule), through a tag either.
  if p_customer_id = auth.uid()
     and exists (select 1 from customer_tags t
                  where t.id = any (v_ids)
                    and (t.cafe_bp is not null or t.court_bp is not null)
                    and not exists (select 1 from customer_tag_members m
                                     where m.customer_id = p_customer_id and m.tag_id = t.id)) then
    raise exception 'SELF_DISCOUNT' using errcode = 'P0001';
  end if;

  v_before := app.customer_tags_json(p_customer_id);
  delete from customer_tag_members where customer_id = p_customer_id and not (tag_id = any (v_ids));
  insert into customer_tag_members (customer_id, tag_id, set_by)
  select p_customer_id, x, auth.uid() from unnest(v_ids) x
  on conflict (customer_id, tag_id) do nothing;
  v_after := app.customer_tags_json(p_customer_id);

  if v_before is distinct from v_after then
    perform app.write_audit('customer.tags_set', 'customer_tag_members', p_customer_id::text,
                            (select coalesce(jsonb_agg(e->'name'), '[]'::jsonb) from jsonb_array_elements(v_before) e),
                            (select coalesce(jsonb_agg(e->'name'), '[]'::jsonb) from jsonb_array_elements(v_after) e));
  end if;
  return jsonb_build_object('customer_id', p_customer_id, 'tags', v_after,
                            'effective', app.customer_effective_discount_json(p_customer_id));
end $set_customer_tags_0449$;

revoke all on function app.set_customer_tags(uuid, uuid[]) from public, anon;
grant execute on function app.set_customer_tags(uuid, uuid[]) to authenticated;

comment on function app.set_customer_tags(uuid, uuid[]) is
  '0449. Court desk, cashier, shop assistant, manager, owner: the customer carries exactly p_tag_ids from now on (replace-all; a tag they already carry keeps who put it on and when). CUSTOMER_NOT_FOUND, TAG_NOT_FOUND, SELF_DISCOUNT (adding a tag with a rule to the caller''s own profile). Audit customer.tags_set with the tag names before and after. Returns {customer_id, tags: customer_tags_json, effective: customer_effective_discount_json | null}.';

-- ---------------------------------------------------------------------------
-- 6. Re-issued functions
-- ---------------------------------------------------------------------------
-- set_customer_flags: re-issued from 20260929000262_match_desk_money.sql:3307.
-- The full ban is kept out like the match ban: refused as an element, spared by the delete.
create or replace function app.set_customer_flags(p_customer_id uuid, p_flags jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_customer_flags_0449$
declare
  v_flags  jsonb := coalesce(p_flags, '[]'::jsonb);
  v_flag   jsonb;
  v_type   text;
  v_label  text;
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_flags) <> 'array' then
    raise exception 'INVALID_FLAGS' using errcode = 'P0001',
      hint = 'p_flags is an array of {type, label}';
  end if;
  if not exists (select 1 from profiles where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Validate everything before touching the table: a refused call leaves the
  -- previous flags exactly as they were.
  for v_flag in select * from jsonb_array_elements(v_flags) loop
    v_type := v_flag->>'type';
    -- 0262 (R35): the ban has its own RPC, reason code and audit.
    if v_type = 'match_ban' then
      raise exception 'INVALID_FLAG' using errcode = 'P0001',
        detail = 'match_ban',
        hint = 'use set_match_ban';
    end if;
    -- 0449: so has the full ban.
    if v_type = 'ban' then
      raise exception 'INVALID_FLAG' using errcode = 'P0001',
        detail = 'ban',
        hint = 'use set_customer_ban';
    end if;
    if v_type is null or v_type not in ('vip','birthday','payment_note','special_request','deposit_exempt') then
      raise exception 'INVALID_FLAG' using errcode = 'P0001',
        detail = coalesce(v_type, 'null'),
        hint = 'type is vip | birthday | payment_note | special_request | deposit_exempt';
    end if;
    if length(coalesce(v_flag->>'label', '')) > 120 then
      raise exception 'LABEL_LENGTH' using errcode = 'P0001',
        hint = 'a flag label is at most 120 characters';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_flags))
     <> (select count(distinct f->>'type') from jsonb_array_elements(v_flags) f) then
    raise exception 'DUPLICATE_FLAG' using errcode = 'P0001',
      hint = 'each flag type may appear once';
  end if;

  v_before := app.customer_flags_json(p_customer_id);

  -- 0262: every flag but a match_ban, which only set_match_ban lifts; 0449:
  -- nor the full ban, which only set_customer_ban lifts.
  delete from customer_flags where customer_id = p_customer_id and type not in ('match_ban', 'ban');

  for v_flag in select * from jsonb_array_elements(v_flags) loop
    v_label := nullif(btrim(coalesce(v_flag->>'label', '')), '');
    insert into customer_flags (customer_id, type, label, created_by)
    values (p_customer_id, v_flag->>'type', v_label, auth.uid());
  end loop;

  v_after := app.customer_flags_json(p_customer_id);

  if v_before is distinct from v_after then
    perform app.write_audit('customer.flags_set', 'customer_flags', p_customer_id::text,
                            v_before, v_after);
  end if;

  return v_after;
end $set_customer_flags_0449$;

comment on function app.set_customer_flags(uuid, jsonb) is
  '0262 = the 0242 body (0065 plus deposit_exempt) with the ban kept out: the desk replaces a customer''s flags with p_flags ([{type, label}], types vip, birthday, payment_note, special_request, deposit_exempt; labels at most 120). A match_ban element is INVALID_FLAG detail match_ban (set_match_ban writes bans), and the delete spares a stored match_ban, so a flag edit or an older build never lifts one. Validates everything before writing; audit customer.flags_set when something changed. Returns customer_flags_json.';

revoke all on function app.set_customer_flags(uuid, jsonb) from public, anon, authenticated;
grant execute on function app.set_customer_flags(uuid, jsonb) to authenticated;

comment on function app.set_customer_flags(uuid, jsonb) is
  '0262, 0449 = the 0242 body (0065 plus deposit_exempt) with both bans kept out: the desk replaces a customer''s flags with p_flags ([{type, label}], types vip, birthday, payment_note, special_request, deposit_exempt; labels at most 120). A match_ban or ban element is INVALID_FLAG (detail the type; set_match_ban and set_customer_ban write those), and the delete spares a stored match_ban and ban, so a flag edit or an older build never lifts one. Validates everything before writing; audit customer.flags_set when something changed. Returns customer_flags_json.';

-- customer_tab_discount_plan: re-issued from 20261016000342_customer_discounts.sql:247.
-- One line: the standing café discount comes from app.customer_standing_discount.
create or replace function app.customer_tab_discount_plan(p_tab_id uuid, p_customer_id uuid)
returns table (
  kind          text,
  value         int,
  reason_code   text,
  authorized_by uuid,
  amount_iqd    bigint,
  base_iqd      bigint
)
language plpgsql stable security definer set search_path = public as $customer_tab_discount_plan_0449$
declare
  v_once  tab_adjustments%rowtype;
  v_cd    customer_discounts%rowtype;
  v_sub   bigint;
  v_other bigint;
  v_base  bigint;
begin
  select coalesce(sum(oi.line_total_iqd), 0) into v_sub
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  -- Every other discount that counts on the tab (compute_tab_totals' rule: a
  -- line discount only while its line is live, a whole-tab one always).
  select coalesce(sum(a.amount_iqd), 0) into v_other
    from tab_adjustments a
    left join order_items oi on oi.id = a.order_item_id
    left join orders o on o.id = oi.order_id
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent', 'discount_amount')
     and a.reason_code not in ('customer_discount', 'customer_discount_once')
     and (a.order_item_id is null
          or (o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided));
  v_base := greatest(v_sub - v_other, 0);

  select * into v_once
    from tab_adjustments a
   where a.tab_id = p_tab_id and a.order_item_id is null
     and a.reason_code = 'customer_discount_once'
   order by a.created_at desc
   limit 1;
  if found then
    kind := case when v_once.kind = 'discount_percent' then 'percent' else 'amount' end;
    value := v_once.value;
    reason_code := 'customer_discount_once';
    authorized_by := v_once.authorized_by;
  elsif p_customer_id is not null
        and not exists (select 1 from customer_discount_waivers w where w.tab_id = p_tab_id) then
    -- 0449: the customer's own café discount, else their best tag's.
    select * into v_cd from app.customer_standing_discount(p_customer_id, 'cafe');
    if found and v_cd.cafe_kind is not null then
      kind := v_cd.cafe_kind;
      value := v_cd.cafe_value;
      reason_code := 'customer_discount';
      authorized_by := v_cd.set_by;
    end if;
  end if;

  base_iqd := v_base;
  amount_iqd := case when kind = 'percent' then round((v_base::numeric * value) / 10000.0)::bigint
                     when kind = 'amount' then least(value::bigint, v_base)
                     else 0 end;
  return next;
end $customer_tab_discount_plan_0449$;

revoke all on function app.customer_tab_discount_plan(uuid, uuid) from public, anon, authenticated;

comment on function app.customer_tab_discount_plan(uuid, uuid) is
  '0342, 0449. Internal: what the customer discount on a tab should be now: a one-off already on it (customer_discount_once) keeps its kind and value, else the customer''s standing café discount (app.customer_standing_discount: their own, else their best tag''s, authorised by whoever put the tag on) unless the tab waived it (customer_discount_waivers), else none (kind NULL, amount 0). amount_iqd is a percent of, or the amount capped at, base_iqd: the live goods less every other discount that counts on the tab.';

-- apply_customer_court_discount: re-issued from 20261115000430_audit_fixes.sql:279.
-- One line: the standing court discount comes from app.customer_standing_discount.
create or replace function app.apply_customer_court_discount(
  p_reservation_id uuid,
  p_kind      text default null,
  p_value     int  default null,
  p_reason    text default null,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_customer_court_discount_0449$
declare
  v_res      reservations%rowtype;
  v_kind     text := nullif(btrim(coalesce(p_kind, '')), '');
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_customer uuid;
  v_cd       customer_discounts%rowtype;
  v_old      reservation_court_discounts%rowtype;
  v_has_old  boolean;
  v_waived   boolean;
  v_row      reservation_court_discounts%rowtype;
  v_t_kind   text;
  v_t_value  int;
  v_t_reason text;
  v_t_stand  boolean;
  v_t_auth   uuid;
  v_owed     bigint;
  v_amount   bigint;
begin
  if not app.is_staff('court_desk', 'cashier', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_kind is not null and v_kind not in ('standing', 'none', 'percent', 'amount') then
    raise exception 'INVALID_KIND' using errcode = 'P0001', detail = v_kind,
      hint = 'NULL (refresh) | standing | none | percent | amount';
  end if;
  if v_kind in ('percent', 'amount') then
    if (v_kind = 'percent' and (p_value is null or p_value not between 1 and 10000))
       or (v_kind = 'amount' and (p_value is null or p_value not between 1 and 100000000)) then
      raise exception 'INVALID_VALUE' using errcode = 'P0001',
        hint = 'a percent is basis points 1..10000; an amount is IQD 1..100000000';
    end if;
    if v_reason is null then
      raise exception 'REASON_REQUIRED' using errcode = 'P0001';
    end if;
    if v_reason not in ('sponsored', 'family', 'coach', 'staff', 'other') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_reason;
    end if;
  end if;

  select * into v_res from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_res.venue_id, 'court_desk', 'cashier', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_res.venue_id::text, true);

  -- 0430: the booking's live bill first (tabs before court_advisory, the
  -- documented order). settle_tab locks only the tab, so without this a
  -- discount and a settle of the same bill passed each other: the bill
  -- settled at the full fee and the discount row was still written. Now the
  -- discount waits for the settle and then sees the fee paid.
  perform 1 from tabs t
   where t.reservation_id = p_reservation_id
     and t.status in ('open', 'awaiting_payment')
     and t.merged_into_tab_id is null
     for update;

  -- The court, then the booking row (0042's order): two discount writes on
  -- one booking queue here, and nothing else is locked after it.
  perform app.lock_court(v_res.court_id);
  select * into v_res from reservations where id = p_reservation_id for update;

  if v_res.kind <> 'booking' or v_res.status not in ('confirmed', 'arrived', 'completed')
     or v_res.price_iqd is null then
    if v_kind is null then
      return jsonb_build_object('applied', false, 'unchanged', true, 'refused', 'COURT_DISCOUNT_NOT_ALLOWED');
    end if;
    raise exception 'COURT_DISCOUNT_NOT_ALLOWED' using errcode = 'P0001', detail = 'not_a_live_booking';
  end if;
  if exists (select 1 from matches m where m.reservation_id = v_res.id) then
    if v_kind is null then
      return jsonb_build_object('applied', false, 'unchanged', true, 'refused', 'COURT_DISCOUNT_NOT_ALLOWED');
    end if;
    raise exception 'COURT_DISCOUNT_NOT_ALLOWED' using errcode = 'P0001', detail = 'match';
  end if;

  v_customer := app.booking_discount_customer(v_res.id);
  if v_kind in ('percent', 'amount') then
    if v_customer is null then
      raise exception 'NO_CUSTOMER' using errcode = 'P0001';
    end if;
    if v_customer = auth.uid() then
      raise exception 'SELF_DISCOUNT' using errcode = 'P0001';
    end if;
  end if;

  select * into v_old from reservation_court_discounts where reservation_id = v_res.id;
  v_has_old := found;

  v_waived := exists (select 1 from customer_discount_waivers w where w.reservation_id = v_res.id);

  -- The target.
  if v_kind is null or v_kind = 'standing' then
    if v_kind is null and v_has_old and not v_old.standing then
      v_t_kind := v_old.kind; v_t_value := v_old.value; v_t_reason := v_old.reason;
      v_t_stand := false; v_t_auth := v_old.authorized_by;
    elsif v_customer is not null and (v_kind = 'standing' or not v_waived) then
      -- 0449: the customer's own court discount, else their best tag's.
      select * into v_cd from app.customer_standing_discount(v_customer, 'court');
      if found and v_cd.court_kind is not null then
        v_t_kind := v_cd.court_kind; v_t_value := v_cd.court_value; v_t_reason := v_cd.reason;
        v_t_stand := true; v_t_auth := v_cd.set_by;
      end if;
    end if;
  elsif v_kind in ('percent', 'amount') then
    v_t_kind := v_kind; v_t_value := p_value; v_t_reason := v_reason;
    v_t_stand := false; v_t_auth := auth.uid();
  end if;

  -- Anything but a refresh decides this booking afresh: the waiver goes, and
  -- 'none' writes a new one.
  if v_kind is not null then
    delete from customer_discount_waivers where reservation_id = v_res.id;
    if v_kind = 'none' then
      insert into customer_discount_waivers (reservation_id, waived_by) values (v_res.id, auth.uid());
    end if;
  end if;

  if v_has_old and v_old.kind is not distinct from v_t_kind and v_old.value is not distinct from v_t_value
     and v_old.standing is not distinct from v_t_stand and v_old.reason is not distinct from v_t_reason then
    return jsonb_build_object('applied', true, 'unchanged', true, 'kind', v_old.kind, 'value', v_old.value,
      'amount_iqd', app.court_fee_discount(v_res.id), 'standing', v_old.standing,
      'customer_id', v_customer, 'remaining_iqd', app.court_fee_remaining(v_res.id, null));
  end if;
  if not v_has_old and v_t_kind is null then
    return jsonb_build_object('applied', false, 'unchanged', true, 'kind', null, 'value', null,
      'amount_iqd', 0, 'standing', null, 'customer_id', v_customer,
      'remaining_iqd', app.court_fee_remaining(v_res.id, null));
  end if;

  -- A discount a settled bill already counted stays as it is.
  if v_has_old and app.court_discount_closed(v_res.id) then
    if v_kind is null then
      return jsonb_build_object('applied', true, 'unchanged', true, 'kind', v_old.kind, 'value', v_old.value,
        'amount_iqd', app.court_fee_discount(v_res.id), 'standing', v_old.standing,
        'customer_id', v_customer, 'remaining_iqd', app.court_fee_remaining(v_res.id, null),
        'closed', true);
    end if;
    raise exception 'COURT_BILL_CLOSED' using errcode = 'P0001';
  end if;

  -- What the booking owes before any discount: price less what was paid.
  v_owed := greatest(v_res.price_iqd - app.court_fee_paid(v_res.id, null)
                                     - app.court_fee_written_off(v_res.id, null)
                                     - app.court_reward_iqd(v_res.id), 0);   -- 0403: a free court hour
  if v_t_kind is not null then
    v_amount := case when v_t_kind = 'percent' then round((v_res.price_iqd::numeric * v_t_value) / 10000.0)::bigint
                     else least(v_t_value::bigint, v_res.price_iqd) end;
    if v_owed = 0 then
      if v_kind is null then
        return jsonb_build_object('applied', v_has_old, 'unchanged', true, 'refused', 'COURT_FEE_PAID');
      end if;
      raise exception 'COURT_FEE_PAID' using errcode = 'P0001';
    end if;
    if v_amount > v_owed then
      if v_kind is null then
        return jsonb_build_object('applied', v_has_old, 'unchanged', true, 'refused', 'DISCOUNT_REQUIRES_REFUND');
      end if;
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('owed %s, discount %s', v_owed, v_amount),
        hint = 'more of the court fee was paid than the discount leaves owed';
    end if;
  end if;

  if v_t_kind is null then
    delete from reservation_court_discounts where reservation_id = v_res.id;
    perform app.write_audit('court_discount.remove', 'reservation_court_discounts', v_res.id::text,
                            to_jsonb(v_old), null, coalesce(v_reason, v_old.reason), null, p_device_id);
    return jsonb_build_object('applied', false, 'unchanged', false, 'kind', null, 'value', null,
      'amount_iqd', 0, 'standing', null, 'customer_id', v_customer,
      'remaining_iqd', app.court_fee_remaining(v_res.id, null));
  end if;

  -- A subtransaction, as in apply_customer_discount: a live bill of the
  -- booking that has taken more than its new total refuses the discount
  -- (the 0037 guard), as data for a refresh.
  begin
    delete from reservation_court_discounts where reservation_id = v_res.id;
    insert into reservation_court_discounts (reservation_id, customer_id, kind, value, reason, standing,
                                             applied_by, authorized_by)
    values (v_res.id, v_customer, v_t_kind, v_t_value, v_t_reason, v_t_stand, auth.uid(), v_t_auth)
    returning * into v_row;

    if exists (select 1
                 from tabs t
                where t.reservation_id = v_res.id
                  and t.status in ('open', 'awaiting_payment')
                  and t.merged_into_tab_id is null
                  and app.tab_net_paid(t.id) > (select x.total_iqd from app.compute_tab_totals(t.id) x)) then
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        hint = 'the open bill of this booking has taken more than it would be after the discount';
    end if;
  exception when sqlstate 'P0001' then
    if v_kind is null and sqlerrm = 'DISCOUNT_REQUIRES_REFUND' then
      return jsonb_build_object('applied', v_has_old, 'unchanged', true, 'refused', 'DISCOUNT_REQUIRES_REFUND');
    end if;
    raise;
  end;

  perform app.write_audit('court_discount.apply', 'reservation_court_discounts', v_res.id::text,
                          case when v_has_old then to_jsonb(v_old) end,
                          to_jsonb(v_row) || jsonb_build_object('amount_iqd', v_amount),
                          v_t_reason, v_t_auth, p_device_id);

  return jsonb_build_object('applied', true, 'unchanged', false, 'kind', v_t_kind, 'value', v_t_value,
    'amount_iqd', v_amount, 'standing', v_t_stand, 'customer_id', v_customer,
    'remaining_iqd', app.court_fee_remaining(v_res.id, null));
end $apply_customer_court_discount_0449$;

revoke all on function app.apply_customer_court_discount(uuid, text, int, text, text) from public, anon;
grant execute on function app.apply_customer_court_discount(uuid, text, int, text, text) to authenticated;

comment on function app.apply_customer_court_discount(uuid, text, int, text, text) is
  '0449 (the standing court discount is the customer''s own, else their best tag''s: reason tag, authorised by whoever put the tag on). 0342, 0403, 0430 (the booking''s live bill locked first, so a concurrent settle_tab and this never pass each other). court_desk, cashier, manager, owner at the booking''s branch (RESERVATION_NOT_FOUND, VENUE_MISMATCH), no PIN. The court-fee discount of a confirmed, arrived or completed plain booking with a price (COURT_DISCOUNT_NOT_ALLOWED detail not_a_live_booking | match). p_kind NULL refreshes it (a one-off keeps its kind and value, else the booking customer''s standing court discount unless this booking waived it, else it goes) and answers every refusal as data ({applied, unchanged: true, refused}); ''standing'' lifts the waiver and puts the standing discount on in place of a one-off; ''none'' takes it off and waives the standing discount for this booking (customer_discount_waivers); ''percent'' | ''amount'' with p_value and p_reason gives it on this booking only (NO_CUSTOMER, SELF_DISCOUNT). The customer is the booking''s guest, else its live tab''s customer. Fixed once a bill of the booking settled with it in place (COURT_BILL_CLOSED). COURT_FEE_PAID when the fee is already paid; DISCOUNT_REQUIRES_REFUND when the discount is more than is still owed (0403: a free court hour from loyalty, reservation_loyalty_rewards, counts as already covered). Locks the court (lock_court) then the booking row. Audit court_discount.apply / court_discount.remove. Returns {applied, unchanged, kind, value, amount_iqd, standing, customer_id, remaining_iqd}.';

-- bill_customer_discount: re-issued from 20261105000403_loyalty_rewards_only.sql:455.
-- The standing court discount comes from app.customer_standing_discount, and
-- 'standing' is the effective discount (own and tags together).
create or replace function app.bill_customer_discount(
  p_tab_id         uuid default null,
  p_reservation_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $bill_customer_discount_0449$
declare
  v_tab      tabs%rowtype;
  v_res      reservations%rowtype;
  v_has_tab  boolean := false;
  v_has_res  boolean := false;
  v_venue    uuid;
  v_customer uuid;
  v_name     text;
  v_cafe     jsonb := null;
  v_court    jsonb := null;
  v_plan     record;
  v_adj      tab_adjustments%rowtype;
  v_cafe_refresh  boolean := false;
  v_court_refresh boolean := false;
  v_cd       customer_discounts%rowtype;
  v_rcd      reservation_court_discounts%rowtype;
  v_owed     bigint;
  v_amount   bigint;
  v_live     boolean;
  v_cafe_waived  boolean := false;
  v_court_waived boolean := false;
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_tab_id is null and p_reservation_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'pass p_tab_id or p_reservation_id';
  end if;

  if p_tab_id is not null then
    select * into v_tab from tabs where id = p_tab_id;
    if not found then
      raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_has_tab := true;
    v_venue := v_tab.venue_id;
  end if;
  if coalesce(p_reservation_id, v_tab.reservation_id) is not null then
    select * into v_res from reservations where id = coalesce(p_reservation_id, v_tab.reservation_id);
    if not found then
      raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_has_res := true;
    v_venue := coalesce(v_venue, v_res.venue_id);
  end if;
  if not app.is_staff_at(v_venue, 'court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  v_customer := case when v_has_tab then app.tab_customer(v_tab.id)
                     else app.booking_discount_customer(v_res.id) end;
  if v_customer is null and v_has_res then
    v_customer := app.booking_discount_customer(v_res.id);
  end if;
  select p.full_name into v_name from profiles p where p.id = v_customer;
  if v_customer is not null then
    -- 0449: the customer's own court discount, else their best tag's.
    select * into v_cd from app.customer_standing_discount(v_customer, 'court');
  end if;

  if v_has_tab then
    v_cafe_waived := exists (select 1 from customer_discount_waivers w where w.tab_id = v_tab.id);
    select * into v_adj
      from tab_adjustments a
     where a.tab_id = v_tab.id and a.order_item_id is null
       and a.reason_code in ('customer_discount', 'customer_discount_once')
     order by a.created_at desc
     limit 1;
    if found then
      v_cafe := jsonb_build_object(
        'adjustment_id', v_adj.id,
        'kind',          case when v_adj.kind = 'discount_percent' then 'percent' else 'amount' end,
        'value',         v_adj.value,
        'amount_iqd',    v_adj.amount_iqd,
        'standing',      v_adj.reason_code = 'customer_discount');
    end if;
    if v_tab.status in ('open', 'awaiting_payment') and v_tab.merged_into_tab_id is null then
      select * into v_plan from app.customer_tab_discount_plan(v_tab.id, v_customer);
      v_cafe_refresh :=
        case when v_adj.id is null then coalesce(v_plan.amount_iqd, 0) > 0
             else v_plan.kind is null
                  or v_adj.reason_code is distinct from v_plan.reason_code
                  or v_adj.value is distinct from v_plan.value
                  or v_adj.amount_iqd is distinct from v_plan.amount_iqd
                  or (case when v_adj.kind = 'discount_percent' then 'percent' else 'amount' end) is distinct from v_plan.kind
        end;
    end if;
  end if;

  if v_has_res then
    select * into v_rcd from reservation_court_discounts where reservation_id = v_res.id;
    if found then
      v_court := jsonb_build_object(
        'kind',       v_rcd.kind,
        'value',      v_rcd.value,
        'amount_iqd', app.court_fee_discount(v_res.id),
        'standing',   v_rcd.standing,
        'reason',     v_rcd.reason,
        'closed',     app.court_discount_closed(v_res.id));
    end if;
    v_live := v_res.kind = 'booking' and v_res.status in ('confirmed', 'arrived', 'completed')
              and v_res.price_iqd is not null
              and not exists (select 1 from matches m where m.reservation_id = v_res.id);
    -- The refresh would change something: the standing court discount is not
    -- on the booking yet (or a different one is), the bill is not closed, and
    -- it fits in what is still owed.
    v_court_waived := exists (select 1 from customer_discount_waivers w where w.reservation_id = v_res.id);
    if v_live and v_cd.court_kind is not null and not v_court_waived
       and (v_rcd.reservation_id is null
            or (v_rcd.standing and (v_rcd.kind is distinct from v_cd.court_kind
                                    or v_rcd.value is distinct from v_cd.court_value
                                    or v_rcd.reason is distinct from v_cd.reason)))
       and not app.court_discount_closed(v_res.id) then
      v_owed := greatest(v_res.price_iqd - app.court_fee_paid(v_res.id, null)
                                         - app.court_fee_written_off(v_res.id, null)
                                         - app.court_reward_iqd(v_res.id), 0);   -- 0403
      v_amount := case when v_cd.court_kind = 'percent'
                       then round((v_res.price_iqd::numeric * v_cd.court_value) / 10000.0)::bigint
                       else least(v_cd.court_value::bigint, v_res.price_iqd) end;
      v_court_refresh := v_owed > 0 and v_amount <= v_owed;
    elsif v_live and v_rcd.reservation_id is not null and v_rcd.standing and v_cd.court_kind is null
          and not app.court_discount_closed(v_res.id) then
      v_court_refresh := true;   -- the standing discount was removed: the refresh drops it
    end if;
  end if;

  return jsonb_build_object(
    'customer',              case when v_customer is null then null
                                  else jsonb_build_object('id', v_customer, 'name', v_name) end,
    -- 0449: what the bill gets on its own, own discount and tags together.
    'standing',              case when v_customer is null then null else app.customer_effective_discount_json(v_customer) end,
    'cafe',                  v_cafe,
    'court',                 v_court,
    'cafe_needs_refresh',    v_cafe_refresh,
    'court_needs_refresh',   v_court_refresh,
    'cafe_waived',           v_cafe_waived,
    'court_waived',          v_court_waived,
    'court_allowed',         coalesce(v_live, false));
end $bill_customer_discount_0449$;

revoke all on function app.bill_customer_discount(uuid, uuid) from public, anon;
grant execute on function app.bill_customer_discount(uuid, uuid) to authenticated;

comment on function app.bill_customer_discount(uuid, uuid) is
  '0449 (standing is app.customer_effective_discount_json: own discount and tags together, each part with its tag name; the court refresh judges the effective court part). 0342, 0403. court_desk, cashier, shop_staff, manager, owner at the bill''s branch: the customer discount state of a bill (a tab, a booking, or a tab and its booking; INVALID_ARGUMENT with neither, TAB_NOT_FOUND, RESERVATION_NOT_FOUND, VENUE_MISMATCH). {customer: {id, name} | null (tab_customer, else the booking''s), standing: customer_discount_json | null, cafe: {adjustment_id, kind, value, amount_iqd, standing} | null, court: {kind, value, amount_iqd, standing, reason, closed} | null, cafe_needs_refresh, court_needs_refresh (apply_customer_discount / apply_customer_court_discount with no kind would change something), cafe_waived, court_waived (the standing discount was taken off this bill: customer_discount_waivers), court_allowed (a live plain booking with a price, no match)}.';

-- pre_request: re-issued from 20261101000398_retired_station_wall.sql:28.
-- One block added: a banned customer's every request is refused.
create or replace function app.pre_request() returns void
language plpgsql stable security definer set search_path = public as $pre_request_0449$
declare
  v_path    text;
  v_rpc     text;
  v_no      boolean := false;
  v_retired text;
  v_method  text;
  v_banned  boolean := false;
begin
  v_path := current_setting('request.path', true);

  -- 0398 (F-49): a retired station loses everything but its way back. Checked
  -- for any caller with a JWT; a fault here lets the request through, like
  -- the rest of the hook (the client lockout and replay's own check stand).
  if auth.uid() is not null then
    begin
      v_retired := app.request_station_retired();
    exception when others then
      v_retired := null;
    end;
    if v_retired is not null then
      v_method := upper(coalesce(current_setting('request.method', true), 'GET'));
      if v_path is not null and left(v_path, 5) = '/rpc/' then
        if not (split_part(substr(v_path, 6), '/', 1) = any (app.retired_station_rpcs())) then
          raise exception 'STATION_RETIRED' using errcode = 'P0001', detail = v_retired,
            hint = 'register this station again in Settings > Stations';
        end if;
      elsif v_method in ('POST', 'PATCH', 'PUT', 'DELETE') then
        raise exception 'STATION_RETIRED' using errcode = 'P0001', detail = v_retired,
          hint = 'register this station again in Settings > Stations';
      end if;
    end if;
  end if;

  -- 0449: a customer the club banned gets nothing at all: no read, no write,
  -- no call, whatever the path. A fault here lets the request through (the
  -- tables' own ban guards still refuse a new booking, seat, place or bill).
  if auth.uid() is not null then
    begin
      v_banned := app.customer_banned(auth.uid()) and app.staff_role() is null;
    exception when others then
      v_banned := false;
    end;
    if v_banned then
      raise exception 'CUSTOMER_BANNED' using errcode = 'P0001',
        hint = 'the club banned this account';
    end if;
  end if;

  if v_path is null or left(v_path, 5) <> '/rpc/' or auth.uid() is null then
    return;
  end if;
  v_rpc := split_part(substr(v_path, 6), '/', 1);
  begin
    v_no := app.area_blocked_rpc(v_rpc);
  exception when others then
    -- Never take the API down for the hook's own fault: the RPC's role and
    -- branch guards still stand.
    v_no := false;
  end;
  if v_no then
    raise exception 'AREA_BLOCKED' using errcode = 'P0001', detail = v_rpc,
      hint = 'the owner blocked this page for this person (Staff > Access)';
  end if;
end $pre_request_0449$;

comment on function app.pre_request() is
  '0384 (F-16), 0398 (F-49), 0449. PostgREST pre-request hook (authenticator pgrst.db_pre_request): refuses every /rpc/ call but app.retired_station_rpcs() and every table write from a retired station (STATION_RETIRED, detail the station id); refuses every request of any path from a customer carrying the full ban who is not active staff (CUSTOMER_BANNED); refuses /rpc/<name> with AREA_BLOCKED (detail <name>) when app.area_blocked_rpc(<name>) is true. Does nothing for guests and service-role calls; a fault inside it lets the request through.';

revoke all on function app.pre_request() from public;
grant execute on function app.pre_request() to anon, authenticated, service_role;

-- profile_merge_columns: re-issued from 20261116000445_loyalty_card_gifts.sql.
-- One row added: customer_tag_members.customer_id (repoint).
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0449$
  select * from (values
    ( 10, 'public', 'tabs',                  'customer_id',           'repoint'),
    ( 20, 'public', 'reservations',          'guest_id',              'repoint'),
    ( 30, 'public', 'reservation_series',    'guest_id',              'repoint'),
    ( 40, 'public', 'guest_sessions',        'linked_profile_id',     'repoint'),
    ( 50, 'public', 'customer_notes',        'customer_id',           'repoint'),
    ( 60, 'public', 'promotion_redemptions', 'customer_id',           'repoint'),
    ( 70, 'public', 'matches',               'organiser_id',          'repoint'),
    ( 80, 'public', 'match_events',          'actor_guest_id',        'repoint'),
    ( 90, 'public', 'coaches',               'profile_id',            'repoint'),
    (100, 'public', 'courses',               'created_by_profile_id', 'repoint'),
    (110, 'public', 'lessons',               'created_by_profile_id', 'repoint'),
    (130, 'public', 'lesson_attendance',     'marked_by_profile_id',  'repoint'),
    (140, 'public', 'lesson_strikes',        'guest_id',              'repoint'),
    (150, 'public', 'lesson_events',         'actor_profile_id',      'repoint'),
    (160, 'public', 'loyalty_ledger',        'profile_id',            'repoint'),
    (170, 'public', 'match_ticket_events',   'guest_id',              'repoint'),
    (180, 'public', 'match_tickets',         'guest_id',              'repoint'),
    (190, 'public', 'notification_outbox',   'profile_id',            'repoint'),
    (200, 'public', 'reservation_court_discounts', 'customer_id',     'repoint'),
    (210, 'public', 'game_results',          'a1',                    'repoint'),
    (211, 'public', 'game_results',          'a2',                    'repoint'),
    (212, 'public', 'game_results',          'b1',                    'repoint'),
    (213, 'public', 'game_results',          'b2',                    'repoint'),
    (220, 'public', 'ranks_ledger',          'profile_id',            'repoint'),
    (230, 'public', 'profiles',              'level_confirmed_by',    'repoint'),
    (240, 'public', 'reservation_loyalty_rewards', 'profile_id',      'repoint'),   -- 0403
    (250, 'public', 'loyalty_reward_vouchers', 'profile_id',          'repoint'),   -- 0415
    (252, 'public', 'loyalty_stamps',        'profile_id',            'repoint'),   -- 0445
    (254, 'public', 'loyalty_perk_lines',    'profile_id',            'repoint'),   -- 0445
    (256, 'public', 'reservation_card_gifts', 'profile_id',           'repoint'),   -- 0445
    (258, 'public', 'customer_tag_members',  'customer_id',           'repoint'),   -- 0449 (a duplicate stays on the drop)
    (300, 'public', 'customer_flags',        'customer_id',           'rule'),
    (310, 'public', 'booking_payments',      'guest_id',              'rule'),
    (320, 'public', 'hold_standing',         'guest_id',              'rule'),
    (330, 'public', 'match_requests',        'guest_id',              'rule'),
    (340, 'public', 'match_seats',           'guest_id',              'rule'),
    (350, 'public', 'match_exclusions',      'guest_id',              'rule'),
    (360, 'public', 'match_blocks',          'blocker_id',            'rule'),
    (361, 'public', 'match_blocks',          'blocked_id',            'rule'),
    (370, 'public', 'match_reports',         'reporter_id',           'rule'),
    (371, 'public', 'match_reports',         'reported_id',           'rule'),
    (380, 'public', 'lesson_enrolments',     'guest_id',              'rule'),
    (381, 'public', 'lesson_enrolments',     'booked_by_profile_id',  'rule'),
    (390, 'public', 'tournament_entries',    'guest_id',              'rule'),
    (400, 'public', 'loyalty_cards',         'profile_id',            'rule'),
    (410, 'public', 'loyalty_accounts',      'profile_id',            'rule'),
    (420, 'public', 'username_holds',        'profile_id',            'drop_only'),
    (425, 'public', 'loyalty_reward_claims', 'profile_id',            'drop_only'),   -- 0445 Redeem in the app
    (426, 'public', 'loyalty_deal_vouchers', 'profile_id',            'drop_only'),   -- 0445 a deal's own QR
    (430, 'public', 'frame_grants',          'profile_id',            'rule'),
    (440, 'public', 'customer_discounts',    'customer_id',           'rule'),
    (500, 'auth',   'identities',            'user_id',               'auth'),
    (510, 'auth',   'sessions',              'user_id',               'signout'),
    (520, 'auth',   'one_time_tokens',       'user_id',               'signout'),
    (530, 'auth',   'mfa_factors',           'user_id',               'drop_only'),
    (540, 'auth',   'oauth_authorizations',  'user_id',               'drop_only'),
    (550, 'auth',   'oauth_consents',        'user_id',               'drop_only'),
    (560, 'auth',   'webauthn_credentials',  'user_id',               'drop_only'),
    (570, 'auth',   'webauthn_challenges',   'user_id',               'drop_only'),
    (600, 'public', 'staff',                 'id',                    'refuse'),
    (700, 'app',    'profile_merges',        'keep_id',               'record')
  ) as t (ord, sch, tbl, col, how)
  order by 1;
$profile_merge_columns_0449$;

comment on function app.profile_merge_columns() is
  '0449: customer_tag_members.customer_id (repoint; a tag keep already carries stays on the drop). 0303, 0307, username_holds since 0314, frame_grants since 0320, customer_discounts and reservation_court_discounts since 0347, game_results and ranks_ledger since 0364, profiles.level_confirmed_by since 0368, reservation_loyalty_rewards.profile_id since 0403, loyalty_reward_vouchers.profile_id since 0415, loyalty_stamps, loyalty_perk_lines and reservation_card_gifts.profile_id since 0445 (repoint; loyalty_reward_claims.profile_id and loyalty_deal_vouchers.profile_id drop_only: a pending Redeem press or a 15-minute deal code goes with the dropped account). Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint.';
revoke all on function app.profile_merge_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The pages the new RPCs belong to (0384's map): the customer record.
-- ---------------------------------------------------------------------------
insert into app.access_area_rpcs (area, rpc) values
  ('customers', 'set_customer_ban'), ('customers', 'customer_ban_and_tags'),
  ('customers', 'set_customer_tags'), ('customers', 'save_customer_tag'),
  ('customers', 'delete_customer_tag')
on conflict do nothing;
