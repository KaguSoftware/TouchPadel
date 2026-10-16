set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0342 — standing customer discounts (Majed, 2026-10-16).
--
-- The ask: people the club looks after (sponsored players, relatives,
-- coaches, staff) get their own price. The desk sets it once on the
-- customer's record, or at the close of a bill, and from then on every bill
-- of theirs carries it. Never behind a manager PIN.
--
-- Majed's calls (2026-10-16):
--   * two separate discounts per customer: one on café/shop goods, one on the
--     court fee of their bookings; either may be absent;
--   * each is a percent (stored as basis points, as apply_discount stores it)
--     or a fixed IQD amount off each bill (café) or each booking (court);
--   * any till or desk staff may set, change or remove it (court_desk,
--     cashier, shop_staff, manager, owner), with no PIN. What stands in for
--     the PIN: every change is audited with who and why, the record shows
--     who set it, nobody may set or give one to themselves (SELF_DISCOUNT),
--     and a discount applied from a standing one is authorised, on the bill
--     and in day close, by the person who set it (the promotions rule, 0067:
--     the configuration is the authorisation).
--
-- Café/shop goods: the discount is a whole-tab tab_adjustments row with
-- reason_code 'customer_discount' (from the standing one) or
-- 'customer_discount_once' (given at the bill for this bill only). It is a
-- share of what is left after every other discount on the tab, so it stacks
-- after a manager discount or a promotion and never takes the goods below 0.
-- A percent is worked out again whenever the bill changes: the operator calls
-- app.apply_customer_discount with no kind, which refreshes the row (or adds
-- it, or drops it when the customer no longer has one).
--
-- Court fee: a booking's court price stays what the rate rules charged
-- (reservations.price_iqd, which a move or an extend recomputes). The
-- discount is a row in reservation_court_discounts (kind, value) and
-- app.court_fee_discount derives its IQD from the price as it is now, so it
-- follows a move or an extend. app.court_fee_remaining subtracts it, so every
-- reader of "what this booking still owes" (the desk bill, the till's court
-- line, day close's unpaid list, reports' owed figures, the guest's own
-- booking) sees the discounted fee with no other change. Plain bookings
-- only: an open match prices its seats itself (COURT_DISCOUNT_NOT_ALLOWED).
-- Once a bill of the booking has settled with the discount in place it is
-- fixed (COURT_BILL_CLOSED), so a closed bill can never start owing again.
--
-- "Remove from this bill" waives the standing discount for that bill only
-- (customer_discount_waivers), so the automatic refresh on any station leaves
-- it at full price; giving a discount there again lifts the waiver.
--
-- New: tables customer_discounts, reservation_court_discounts,
-- customer_discount_waivers; RPCs
-- customer_discount, set_customer_discount, apply_customer_discount,
-- apply_customer_court_discount, bill_customer_discount; internals
-- customer_discount_json, court_fee_discount, customer_tab_discount_plan,
-- booking_discount_customer, court_discount_closed and the profiles trigger
-- profiles_discount_tombstone. Re-issued: court_fee_remaining (0262 is no
-- longer the latest; one term added).
--
-- covered by packages/db/tests/customer-discounts.test.ts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- One row per customer with a standing discount. Chain-wide, like
-- customer_flags: a sponsored player is sponsored at every branch.
create table if not exists customer_discounts (
  customer_id uuid primary key references profiles(id) on delete cascade,
  cafe_kind   text,
  cafe_value  int,
  court_kind  text,
  court_value int,
  reason      text not null,
  note        text,
  set_by      uuid not null references staff(id),
  set_at      timestamptz not null default now(),
  constraint customer_discounts_cafe_kind check (cafe_kind is null or cafe_kind in ('percent', 'amount')),
  constraint customer_discounts_court_kind check (court_kind is null or court_kind in ('percent', 'amount')),
  constraint customer_discounts_cafe_pair check ((cafe_kind is null) = (cafe_value is null)),
  constraint customer_discounts_court_pair check ((court_kind is null) = (court_value is null)),
  constraint customer_discounts_some check (cafe_kind is not null or court_kind is not null),
  constraint customer_discounts_cafe_value check (
    cafe_value is null
    or (cafe_kind = 'percent' and cafe_value between 1 and 10000)
    or (cafe_kind = 'amount' and cafe_value between 1 and 100000000)),
  constraint customer_discounts_court_value check (
    court_value is null
    or (court_kind = 'percent' and court_value between 1 and 10000)
    or (court_kind = 'amount' and court_value between 1 and 100000000)),
  constraint customer_discounts_reason check (reason in ('sponsored', 'family', 'coach', 'staff', 'other')),
  constraint customer_discounts_note check (note is null or length(note) between 1 and 120)
);

comment on table customer_discounts is
  '0342. A customer''s standing discount, chain-wide: cafe_kind/cafe_value on café and shop goods (whole bill), court_kind/court_value on the court fee of their bookings; kind percent (value in basis points, 1..10000) or amount (IQD off each bill or booking). reason sponsored | family | coach | staff | other, optional note. Written only by app.set_customer_discount (court_desk, cashier, shop_staff, manager, owner; no PIN); read through app.customer_discount and app.bill_customer_discount. No client grant.';

alter table customer_discounts enable row level security;

-- The court part of a discount, per booking. kind/value are copied from the
-- standing discount (standing = true) or given at the bill for this booking
-- only (standing = false); the IQD is derived from the booking's price as it
-- is now (app.court_fee_discount), never stored.
create table if not exists reservation_court_discounts (
  reservation_id uuid primary key references reservations(id) on delete cascade,
  customer_id    uuid references profiles(id) on delete set null,
  kind           text not null,
  value          int not null,
  reason         text not null,
  standing       boolean not null,
  applied_by     uuid not null references staff(id),
  authorized_by  uuid not null references staff(id),
  created_at     timestamptz not null default now(),
  constraint reservation_court_discounts_kind check (kind in ('percent', 'amount')),
  constraint reservation_court_discounts_value check (
    (kind = 'percent' and value between 1 and 10000)
    or (kind = 'amount' and value between 1 and 100000000)),
  constraint reservation_court_discounts_reason check (reason in ('sponsored', 'family', 'coach', 'staff', 'other'))
);

comment on table reservation_court_discounts is
  '0342. The court-fee discount of one booking: kind percent (basis points) or amount (IQD), standing (copied from the customer''s customer_discounts row) or not (given at the bill for this booking only), applied_by the caller, authorized_by the person who set the standing discount (else the caller). app.court_fee_discount derives the IQD from the booking''s price as it is now; app.court_fee_remaining subtracts it. Written only by app.apply_customer_court_discount. No client grant.';

alter table reservation_court_discounts enable row level security;

drop trigger if exists zz_branch_guard on public.reservation_court_discounts;
create trigger zz_branch_guard before insert or update or delete on public.reservation_court_discounts
  for each row execute function app.trg_branch_guard('child', 'reservations', 'reservation_id');

-- "Not on this bill": the desk took the customer's standing discount off one
-- bill (a tab's café part) or one booking (its court part). A refresh then
-- leaves that bill at full price, on every station; giving a discount at the
-- bill again (p_kind 'standing' or a one-off) lifts the waiver.
create table if not exists customer_discount_waivers (
  id             uuid primary key default gen_random_uuid(),
  tab_id         uuid unique references tabs(id) on delete cascade,
  reservation_id uuid unique references reservations(id) on delete cascade,
  waived_by      uuid not null references staff(id),
  created_at     timestamptz not null default now(),
  constraint customer_discount_waivers_one check ((tab_id is null) <> (reservation_id is null))
);

comment on table customer_discount_waivers is
  '0342. One row per bill the customer''s standing discount was taken off: tab_id (the café part of that tab) or reservation_id (the court part of that booking). A refresh (apply_customer_discount / apply_customer_court_discount with no kind) skips the standing discount there; p_kind standing or a one-off deletes the row. Written only by those two RPCs. No client grant.';

alter table customer_discount_waivers enable row level security;

drop trigger if exists zz_branch_guard on public.customer_discount_waivers;
create trigger zz_branch_guard before insert or update or delete on public.customer_discount_waivers
  for each row execute function app.trg_branch_guard('child', 'tabs', 'tab_id', 'reservations', 'reservation_id');

-- A deleted account (delete_my_account tombstones the profile, so the cascade
-- never fires) loses its standing discount and its note with it. A booking's
-- court discount is part of the money trail and stays, like a promotion
-- redemption.
create or replace function app.trg_profile_discount_tombstone() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_discount_tombstone_0342$
begin
  delete from customer_discounts where customer_id = new.id;
  return null;
end $trg_profile_discount_tombstone_0342$;

revoke all on function app.trg_profile_discount_tombstone() from public, anon, authenticated;

comment on function app.trg_profile_discount_tombstone() is
  '0342. AFTER UPDATE OF deleted_at on profiles, when an account is deleted: its customer_discounts row goes (SEC-20, onDelete row).';

drop trigger if exists profiles_discount_tombstone on profiles;
create trigger profiles_discount_tombstone
  after update of deleted_at on profiles
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function app.trg_profile_discount_tombstone();

-- ---------------------------------------------------------------------------
-- 2. Internals
-- ---------------------------------------------------------------------------

create or replace function app.customer_discount_json(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = public as $customer_discount_json_0342$
  select jsonb_build_object(
           'cafe',   case when d.cafe_kind is null then null
                          else jsonb_build_object('kind', d.cafe_kind, 'value', d.cafe_value) end,
           'court',  case when d.court_kind is null then null
                          else jsonb_build_object('kind', d.court_kind, 'value', d.court_value) end,
           'reason', d.reason,
           'note',   d.note,
           'set_by', jsonb_build_object('id', s.id, 'name', s.display_name),
           'set_at', d.set_at)
    from customer_discounts d
    left join staff s on s.id = d.set_by
   where d.customer_id = p_customer_id
$customer_discount_json_0342$;

revoke all on function app.customer_discount_json(uuid) from public, anon, authenticated;

comment on function app.customer_discount_json(uuid) is
  '0342. Internal: the customer''s standing discount as {cafe: {kind, value} | null, court: {kind, value} | null, reason, note, set_by: {id, name}, set_at}, or NULL when they have none.';

-- The court discount of a booking in IQD at its price now: a percent of
-- price_iqd, or the amount (at most the price). 0 with no row or no price.
create or replace function app.court_fee_discount(p_reservation_id uuid) returns bigint
language sql stable security definer set search_path = public as $court_fee_discount_0342$
  select coalesce((
    select case when d.kind = 'percent'
                then round((r.price_iqd::numeric * d.value) / 10000.0)::bigint
                else least(d.value::bigint, r.price_iqd) end
      from reservation_court_discounts d
      join reservations r on r.id = d.reservation_id
     where d.reservation_id = p_reservation_id
       and r.price_iqd is not null
  ), 0)::bigint
$court_fee_discount_0342$;

revoke all on function app.court_fee_discount(uuid) from public, anon, authenticated;

comment on function app.court_fee_discount(uuid) is
  '0342. Internal: the booking''s court discount in IQD at its price now (reservation_court_discounts: a percent of price_iqd rounded, or the amount capped at the price); 0 with no row. court_fee_remaining subtracts it.';

-- court_fee_remaining: re-issued from 20260929000262_match_desk_money.sql:390.
-- One term added: the booking's court discount is owed by nobody.
create or replace function app.court_fee_remaining(p_reservation_id uuid, p_exclude_tab_id uuid default null)
returns bigint
language sql stable security definer set search_path = public as $court_fee_remaining_0342$
  select coalesce((
    select greatest(r.price_iqd - app.court_fee_paid(r.id, p_exclude_tab_id)
                                - app.court_fee_written_off(r.id, p_exclude_tab_id)
                                - app.court_fee_discount(r.id), 0)::bigint
      from reservations r
     where r.id = p_reservation_id
       and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.price_iqd is not null
  ), 0)::bigint
$court_fee_remaining_0342$;

revoke all on function app.court_fee_remaining(uuid, uuid) from public, anon, authenticated;

comment on function app.court_fee_remaining(uuid, uuid) is
  '0106, 0262, 0342. The court fee still owed on a booking: price_iqd minus the court_iqd stamped on its OTHER settled tabs (and its online deposit) minus the open-match shares written off (court_fee_written_off) minus its customer court discount (court_fee_discount, 0342), floored at 0; 0 unless the booking is confirmed/arrived/completed. The basis of the court line on every tab (compute_tab_totals). Internal.';

-- What the customer discount on a tab should be right now (the refresh rule
-- of apply_customer_discount with no kind, and bill_customer_discount's
-- needs_refresh). A one-off already on the tab keeps its kind and value; else
-- the customer's standing café discount; else none. The IQD is a share of
-- the goods left after every other discount on the tab.
create or replace function app.customer_tab_discount_plan(p_tab_id uuid, p_customer_id uuid)
returns table (
  kind          text,
  value         int,
  reason_code   text,
  authorized_by uuid,
  amount_iqd    bigint,
  base_iqd      bigint
)
language plpgsql stable security definer set search_path = public as $customer_tab_discount_plan_0342$
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
    select * into v_cd from customer_discounts d where d.customer_id = p_customer_id;
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
end $customer_tab_discount_plan_0342$;

revoke all on function app.customer_tab_discount_plan(uuid, uuid) from public, anon, authenticated;

comment on function app.customer_tab_discount_plan(uuid, uuid) is
  '0342. Internal: what the customer discount on a tab should be now: a one-off already on it (customer_discount_once) keeps its kind and value, else the customer''s standing café discount unless the tab waived it (customer_discount_waivers), else none (kind NULL, amount 0). amount_iqd is a percent of, or the amount capped at, base_iqd: the live goods less every other discount that counts on the tab.';

-- Who a booking's discount belongs to: the booking's guest, else the
-- customer of its live tab (app.tab_customer).
create or replace function app.booking_discount_customer(p_reservation_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $booking_discount_customer_0342$
declare
  v uuid;
begin
  select p.id into v
    from reservations r
    join profiles p on p.id = r.guest_id and p.deleted_at is null
   where r.id = p_reservation_id;
  if v is not null then
    return v;
  end if;
  select app.tab_customer(t.id) into v
    from tabs t
   where t.reservation_id = p_reservation_id
     and t.status in ('open', 'awaiting_payment')
     and t.merged_into_tab_id is null
   order by t.opened_at
   limit 1;
  return v;
end $booking_discount_customer_0342$;

revoke all on function app.booking_discount_customer(uuid) from public, anon, authenticated;

comment on function app.booking_discount_customer(uuid) is
  '0342. Internal: the customer a booking''s court discount belongs to: its guest (not deleted), else app.tab_customer of its oldest live tab; NULL when neither names one.';

-- True once a bill of the booking settled while its court discount stood:
-- the discount is then part of a closed bill and stays as it is.
create or replace function app.court_discount_closed(p_reservation_id uuid) returns boolean
language sql stable security definer set search_path = public as $court_discount_closed_0342$
  select exists (
    select 1
      from reservation_court_discounts d
      join tabs t on t.reservation_id = d.reservation_id
     where d.reservation_id = p_reservation_id
       and t.status = 'settled'
       and t.merged_into_tab_id is null
       and t.settled_at >= d.created_at)
$court_discount_closed_0342$;

revoke all on function app.court_discount_closed(uuid) from public, anon, authenticated;

comment on function app.court_discount_closed(uuid) is
  '0342. Internal: true when a bill of the booking settled at or after its court discount was applied; the discount is then fixed (COURT_BILL_CLOSED).';

-- ---------------------------------------------------------------------------
-- 3. The customer's standing discount
-- ---------------------------------------------------------------------------

create or replace function app.customer_discount(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_discount_0342$
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles where id = p_customer_id and deleted_at is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  return jsonb_build_object('customer_id', p_customer_id,
                            'discount', app.customer_discount_json(p_customer_id));
end $customer_discount_0342$;

revoke all on function app.customer_discount(uuid) from public, anon;
grant execute on function app.customer_discount(uuid) to authenticated;

comment on function app.customer_discount(uuid) is
  '0342. court_desk, cashier, shop_staff, manager, owner: {customer_id, discount: customer_discount_json | null}. CUSTOMER_NOT_FOUND for a missing or deleted profile.';

create or replace function app.set_customer_discount(
  p_customer_id uuid,
  p_cafe_kind   text default null,
  p_cafe_value  int  default null,
  p_court_kind  text default null,
  p_court_value int  default null,
  p_reason      text default null,
  p_note        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_customer_discount_0342$
declare
  v_cafe_kind  text := nullif(btrim(coalesce(p_cafe_kind, '')), '');
  v_court_kind text := nullif(btrim(coalesce(p_court_kind, '')), '');
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_before     jsonb;
  v_after      jsonb;
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles where id = p_customer_id and deleted_at is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_customer_id = auth.uid() then
    raise exception 'SELF_DISCOUNT' using errcode = 'P0001';
  end if;

  -- Validate everything before writing: a refused call leaves the discount
  -- exactly as it was.
  if v_cafe_kind is not null and v_cafe_kind not in ('percent', 'amount') then
    raise exception 'INVALID_KIND' using errcode = 'P0001', detail = v_cafe_kind,
      hint = 'percent | amount';
  end if;
  if v_court_kind is not null and v_court_kind not in ('percent', 'amount') then
    raise exception 'INVALID_KIND' using errcode = 'P0001', detail = v_court_kind,
      hint = 'percent | amount';
  end if;
  if (v_cafe_kind = 'percent' and (p_cafe_value is null or p_cafe_value not between 1 and 10000))
     or (v_cafe_kind = 'amount' and (p_cafe_value is null or p_cafe_value not between 1 and 100000000))
     or (v_court_kind = 'percent' and (p_court_value is null or p_court_value not between 1 and 10000))
     or (v_court_kind = 'amount' and (p_court_value is null or p_court_value not between 1 and 100000000)) then
    raise exception 'INVALID_VALUE' using errcode = 'P0001',
      hint = 'a percent is basis points 1..10000; an amount is IQD 1..100000000';
  end if;

  v_before := app.customer_discount_json(p_customer_id);

  if v_cafe_kind is null and v_court_kind is null then
    delete from customer_discounts where customer_id = p_customer_id;
    if v_before is not null then
      perform app.write_audit('customer.discount_clear', 'customer_discounts', p_customer_id::text,
                              v_before, null);
    end if;
    return null;
  end if;

  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if v_reason not in ('sponsored', 'family', 'coach', 'staff', 'other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_reason,
      hint = 'reason is sponsored | family | coach | staff | other';
  end if;
  if length(coalesce(v_note, '')) > 120 then
    raise exception 'LABEL_LENGTH' using errcode = 'P0001',
      hint = 'a note is at most 120 characters';
  end if;

  insert into customer_discounts (customer_id, cafe_kind, cafe_value, court_kind, court_value,
                                  reason, note, set_by, set_at)
  values (p_customer_id, v_cafe_kind, case when v_cafe_kind is null then null else p_cafe_value end,
          v_court_kind, case when v_court_kind is null then null else p_court_value end,
          v_reason, v_note, auth.uid(), now())
  on conflict (customer_id) do update
     set cafe_kind = excluded.cafe_kind, cafe_value = excluded.cafe_value,
         court_kind = excluded.court_kind, court_value = excluded.court_value,
         reason = excluded.reason, note = excluded.note,
         set_by = excluded.set_by, set_at = excluded.set_at;

  v_after := app.customer_discount_json(p_customer_id);
  perform app.write_audit('customer.discount_set', 'customer_discounts', p_customer_id::text,
                          v_before, v_after, v_reason);
  return v_after;
end $set_customer_discount_0342$;

revoke all on function app.set_customer_discount(uuid, text, int, text, int, text, text) from public, anon;
grant execute on function app.set_customer_discount(uuid, text, int, text, int, text, text) to authenticated;

comment on function app.set_customer_discount(uuid, text, int, text, int, text, text) is
  '0342. court_desk, cashier, shop_staff, manager, owner, no PIN: sets the customer''s standing discount (café: p_cafe_kind percent | amount with p_cafe_value basis points 1..10000 or IQD; court: the same with p_court_*; either may be NULL), p_reason sponsored | family | coach | staff | other (REASON_REQUIRED, INVALID_ARGUMENT), p_note at most 120 (LABEL_LENGTH). Both kinds NULL removes it (audit customer.discount_clear, returns NULL). CUSTOMER_NOT_FOUND, SELF_DISCOUNT (the caller''s own profile), INVALID_KIND, INVALID_VALUE. Audit customer.discount_set with before and after. Bills already closed keep what they had; open bills pick the change up on their next refresh (apply_customer_discount, apply_customer_court_discount). Returns customer_discount_json.';

-- ---------------------------------------------------------------------------
-- 4. Café and shop goods: the tab's customer discount
-- ---------------------------------------------------------------------------

-- p_kind NULL: refresh the tab's customer discount (a one-off keeps its kind
--              and value; else the customer's standing one; else it goes).
-- p_kind 'none': take it off this bill.
-- p_kind 'percent' | 'amount': give it on this bill only (p_value, p_reason).
create or replace function app.apply_customer_discount(
  p_tab_id    uuid,
  p_kind      text default null,
  p_value     int  default null,
  p_reason    text default null,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_customer_discount_0342$
declare
  v_venue    uuid;
  v_tab      tabs%rowtype;
  v_kind     text := nullif(btrim(coalesce(p_kind, '')), '');
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_customer uuid;
  v_plan     record;
  v_old      tab_adjustments%rowtype;
  v_old_n    int;
  v_adj      tab_adjustments%rowtype;
  v_target_kind  text;
  v_target_value int;
  v_target_code  text;
  v_target_auth  uuid;
  v_amount   bigint;
  v_paid     bigint;
  v_total    bigint;
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
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

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.assert_tab_kind_role(v_tab.kind);
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status not in ('open', 'awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_customer := app.tab_customer(p_tab_id);
  if v_kind in ('percent', 'amount') then
    if v_customer is null then
      raise exception 'NO_CUSTOMER' using errcode = 'P0001';
    end if;
    if v_customer = auth.uid() then
      raise exception 'SELF_DISCOUNT' using errcode = 'P0001';
    end if;
  end if;

  select count(*) into v_old_n
    from tab_adjustments a
   where a.tab_id = p_tab_id and a.order_item_id is null
     and a.reason_code in ('customer_discount', 'customer_discount_once');
  select * into v_old
    from tab_adjustments a
   where a.tab_id = p_tab_id and a.order_item_id is null
     and a.reason_code in ('customer_discount', 'customer_discount_once')
   order by a.created_at desc
   limit 1;

  if v_kind is not null then
    -- Anything but a refresh decides this bill afresh: the waiver goes, and
    -- 'none' writes a new one below.
    delete from customer_discount_waivers where tab_id = p_tab_id;
  end if;
  if v_kind = 'standing' then
    -- The customer's standing discount, replacing a one-off on the bill.
    delete from tab_adjustments
     where tab_id = p_tab_id and order_item_id is null and reason_code = 'customer_discount_once';
  end if;

  if v_kind is null or v_kind = 'standing' then
    select * into v_plan from app.customer_tab_discount_plan(p_tab_id, v_customer);
    v_target_kind  := v_plan.kind;
    v_target_value := v_plan.value;
    v_target_code  := v_plan.reason_code;
    v_target_auth  := v_plan.authorized_by;
    v_amount       := coalesce(v_plan.amount_iqd, 0);
  elsif v_kind = 'none' then
    v_target_kind := null;
    v_amount := 0;
    insert into customer_discount_waivers (tab_id, waived_by) values (p_tab_id, auth.uid());
  else
    -- A one-off replaces whatever customer discount the tab had: plan it as
    -- if none were there.
    delete from tab_adjustments
     where tab_id = p_tab_id and order_item_id is null
       and reason_code in ('customer_discount', 'customer_discount_once');
    select * into v_plan from app.customer_tab_discount_plan(p_tab_id, null);
    v_target_kind  := v_kind;
    v_target_value := p_value;
    v_target_code  := 'customer_discount_once';
    v_target_auth  := auth.uid();
    v_amount := case when v_kind = 'percent' then round((v_plan.base_iqd::numeric * p_value) / 10000.0)::bigint
                     else least(p_value::bigint, v_plan.base_iqd) end;
  end if;

  -- Unchanged: the one row there already says exactly this.
  if (v_kind is null or v_kind = 'standing') and v_old_n = 1 and v_target_kind is not null and v_amount > 0
     and v_old.reason_code = v_target_code
     and v_old.kind = (case when v_target_kind = 'percent' then 'discount_percent' else 'discount_amount' end)::adjustment_kind
     and v_old.value = v_target_value
     and v_old.amount_iqd = v_amount then
    return jsonb_build_object('applied', true, 'unchanged', true, 'adjustment_id', v_old.id,
      'kind', v_target_kind, 'value', v_target_value, 'amount_iqd', v_amount,
      'standing', v_target_code = 'customer_discount', 'customer_id', v_customer);
  end if;

  if v_target_kind is null or v_amount <= 0 then
    delete from tab_adjustments
     where tab_id = p_tab_id and order_item_id is null
       and reason_code in ('customer_discount', 'customer_discount_once');
    if v_old_n > 0 then
      perform app.write_audit('customer_discount.remove', 'tab_adjustments', v_old.id::text,
                              to_jsonb(v_old), null, coalesce(v_reason, v_old.reason_code), null, p_device_id);
    end if;
    return jsonb_build_object('applied', false, 'unchanged', v_old_n = 0, 'adjustment_id', null,
      'kind', v_target_kind, 'value', v_target_value, 'amount_iqd', 0,
      'standing', v_target_code = 'customer_discount', 'customer_id', v_customer);
  end if;

  -- A subtransaction: when the guard below refuses a refresh, the delete
  -- and the insert roll back and the refusal is answered as data, so a
  -- bill's automatic refresh never shows anyone an error.
  begin
    delete from tab_adjustments
     where tab_id = p_tab_id and order_item_id is null
       and reason_code in ('customer_discount', 'customer_discount_once');
    insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                                 applied_by, authorized_by, reason_code)
    values (p_tab_id, null,
            (case when v_target_kind = 'percent' then 'discount_percent' else 'discount_amount' end)::adjustment_kind,
            v_target_value, v_amount, auth.uid(), v_target_auth, v_target_code)
    returning * into v_adj;

    -- DISCOUNT-AFTER-PAYMENT GUARD (0037), the apply_discount shape.
    v_paid := app.tab_net_paid(p_tab_id);
    if v_paid > 0 then
      select t.total_iqd into v_total from app.compute_tab_totals(p_tab_id) t;
      if v_total < v_paid then
        raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
          detail = format('paid %s, post-discount total %s', v_paid, v_total),
          hint = 'refund the difference via app.refund before discounting';
      end if;
    end if;
  exception when sqlstate 'P0001' then
    if v_kind is null and sqlerrm = 'DISCOUNT_REQUIRES_REFUND' then
      return jsonb_build_object('applied', v_old_n > 0, 'unchanged', true, 'refused', 'DISCOUNT_REQUIRES_REFUND',
        'customer_id', v_customer);
    end if;
    raise;
  end;

  perform app.write_audit('customer_discount.apply', 'tab_adjustments', v_adj.id::text,
                          case when v_old_n > 0 then to_jsonb(v_old) end, to_jsonb(v_adj),
                          coalesce(v_reason, v_target_code), v_target_auth, p_device_id);

  return jsonb_build_object('applied', true, 'unchanged', false, 'adjustment_id', v_adj.id,
    'kind', v_target_kind, 'value', v_target_value, 'amount_iqd', v_amount,
    'standing', v_target_code = 'customer_discount', 'customer_id', v_customer);
end $apply_customer_discount_0342$;

revoke all on function app.apply_customer_discount(uuid, text, int, text, text) from public, anon;
grant execute on function app.apply_customer_discount(uuid, text, int, text, text) to authenticated;

comment on function app.apply_customer_discount(uuid, text, int, text, text) is
  '0342. court_desk, cashier, shop_staff, manager, owner at the tab''s branch, the tab''s kind for the role (TAB_KIND_FORBIDDEN), no PIN. The customer discount on an open or awaiting_payment tab (TAB_NOT_FOUND, TAB_MERGED, TAB_NOT_OPEN), one whole-tab tab_adjustments row: p_kind NULL refreshes it (customer_tab_discount_plan: a one-off keeps its kind and value, else the tab customer''s standing café discount unless this tab waived it, reason_code customer_discount, authorized_by its setter; else it goes); ''standing'' lifts the waiver and puts the standing discount on in place of a one-off; ''none'' takes it off and waives the standing discount for this bill (customer_discount_waivers); ''percent'' | ''amount'' with p_value (basis points or IQD, INVALID_VALUE) and p_reason (REASON_REQUIRED, INVALID_ARGUMENT) gives it on this bill only (customer_discount_once, authorized_by the caller; NO_CUSTOMER without a tab customer, SELF_DISCOUNT on the caller''s own bill). The IQD is a share of the goods left after every other discount; 0 writes no row. State-idempotent: a refresh that changes nothing writes nothing ({unchanged: true}). 0037 guard (DISCOUNT_REQUIRES_REFUND). Audit customer_discount.apply / customer_discount.remove. Returns {applied, unchanged, adjustment_id, kind, value, amount_iqd, standing, customer_id}.';

-- ---------------------------------------------------------------------------
-- 5. Court fee: the booking's customer discount
-- ---------------------------------------------------------------------------

create or replace function app.apply_customer_court_discount(
  p_reservation_id uuid,
  p_kind      text default null,
  p_value     int  default null,
  p_reason    text default null,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_customer_court_discount_0342$
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
      select * into v_cd from customer_discounts d where d.customer_id = v_customer;
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
                                     - app.court_fee_written_off(v_res.id, null), 0);
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
end $apply_customer_court_discount_0342$;

revoke all on function app.apply_customer_court_discount(uuid, text, int, text, text) from public, anon;
grant execute on function app.apply_customer_court_discount(uuid, text, int, text, text) to authenticated;

comment on function app.apply_customer_court_discount(uuid, text, int, text, text) is
  '0342. court_desk, cashier, manager, owner at the booking''s branch (RESERVATION_NOT_FOUND, VENUE_MISMATCH), no PIN. The court-fee discount of a confirmed, arrived or completed plain booking with a price (COURT_DISCOUNT_NOT_ALLOWED detail not_a_live_booking | match). p_kind NULL refreshes it (a one-off keeps its kind and value, else the booking customer''s standing court discount unless this booking waived it, else it goes) and answers every refusal as data ({applied, unchanged: true, refused}); ''standing'' lifts the waiver and puts the standing discount on in place of a one-off; ''none'' takes it off and waives the standing discount for this booking (customer_discount_waivers); ''percent'' | ''amount'' with p_value and p_reason gives it on this booking only (NO_CUSTOMER, SELF_DISCOUNT). The customer is the booking''s guest, else its live tab''s customer. Fixed once a bill of the booking settled with it in place (COURT_BILL_CLOSED). COURT_FEE_PAID when the fee is already paid; DISCOUNT_REQUIRES_REFUND when the discount is more than is still owed. Locks the court (lock_court) then the booking row. Audit court_discount.apply / court_discount.remove. Returns {applied, unchanged, kind, value, amount_iqd, standing, customer_id, remaining_iqd}.';

-- ---------------------------------------------------------------------------
-- 6. The bill's view: what the customer has and what the bill carries
-- ---------------------------------------------------------------------------

create or replace function app.bill_customer_discount(
  p_tab_id         uuid default null,
  p_reservation_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $bill_customer_discount_0342$
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
    select * into v_cd from customer_discounts d where d.customer_id = v_customer;
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
                                         - app.court_fee_written_off(v_res.id, null), 0);
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
    'standing',              case when v_customer is null then null else app.customer_discount_json(v_customer) end,
    'cafe',                  v_cafe,
    'court',                 v_court,
    'cafe_needs_refresh',    v_cafe_refresh,
    'court_needs_refresh',   v_court_refresh,
    'cafe_waived',           v_cafe_waived,
    'court_waived',          v_court_waived,
    'court_allowed',         coalesce(v_live, false));
end $bill_customer_discount_0342$;

revoke all on function app.bill_customer_discount(uuid, uuid) from public, anon;
grant execute on function app.bill_customer_discount(uuid, uuid) to authenticated;

comment on function app.bill_customer_discount(uuid, uuid) is
  '0342. court_desk, cashier, shop_staff, manager, owner at the bill''s branch: the customer discount state of a bill (a tab, a booking, or a tab and its booking; INVALID_ARGUMENT with neither, TAB_NOT_FOUND, RESERVATION_NOT_FOUND, VENUE_MISMATCH). {customer: {id, name} | null (tab_customer, else the booking''s), standing: customer_discount_json | null, cafe: {adjustment_id, kind, value, amount_iqd, standing} | null, court: {kind, value, amount_iqd, standing, reason, closed} | null, cafe_needs_refresh, court_needs_refresh (apply_customer_discount / apply_customer_court_discount with no kind would change something), cafe_waived, court_waived (the standing discount was taken off this bill: customer_discount_waivers), court_allowed (a live plain booking with a price, no match)}.';
