-- 0082_cafe_abuse_limits — SEC-25. The café ordering limits Security Layer §6.2
-- asks for and the database did not have.
--
-- WHAT EXISTED BEFORE. Exactly three rate limits in the whole schema: the PIN
-- lockout (5 failures / 5 min / caller), the waiter-call cooldown, and
-- send_test_push's one-per-minute. Guest ORDERING — the surface any passer-by
-- reaches by scanning a QR card taped to a table — had none.
--
-- WHAT THAT ALLOWS. A guest session is cheap: scan, anonymous sign-in, order.
-- Nothing stopped a script holding one session from submitting orders in a
-- loop. The damage is not a database problem, it is a KITCHEN problem — a
-- hundred tickets print, the prep screen fills with work nobody ordered, and the
-- staff cannot tell the real tickets from the noise while it is happening. It is
-- also a stock problem: every ticket decrements ingredients.
--
-- WHY TRIGGERS RATHER THAN EDITING create_guest_order. That function is long and
-- carries the degraded guard, the idempotency replay, the day lock and the tab
-- resolution. 0076 is the standing lesson about re-issuing a body to add one
-- line — `create or replace` replaces all of it, and 0075 silently reverted
-- 0071's guard exactly that way. A BEFORE trigger adds the rule without
-- rewriting anything, and it covers every path into the table rather than the
-- one function that exists today.
--
-- DELIBERATELY NOT DONE HERE: the per-IP limit. Postgres never sees the client
-- IP — it sees PostgREST. That belongs in front of the site (SEC-25's other box)
-- and pretending to solve it here would be worse than leaving it open.
--
-- covered by packages/db/tests/cafe-abuse-limits.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The limits, beside every other operational limit.
-- ---------------------------------------------------------------------------
alter table venue_settings
  add column if not exists guest_orders_per_minute int not null default 6;
alter table venue_settings
  add column if not exists guest_items_per_order int not null default 40;
alter table venue_settings
  add column if not exists tab_confirm_threshold_iqd bigint not null default 150000;

comment on column venue_settings.guest_orders_per_minute is
  '0082/SEC-25. Orders one guest table session may submit per rolling minute. 6 is generous for a real table — a group ordering in waves — and far below what a script does. 0 disables guest ordering entirely.';
comment on column venue_settings.guest_items_per_order is
  '0082/SEC-25. Line items in a single guest order. 40 covers a large table; it stops one request queueing hundreds of tickets.';
comment on column venue_settings.tab_confirm_threshold_iqd is
  '0082/SEC-25. Tab value above which the TILL asks staff to confirm before adding more. Advisory: read by the operator UI, not enforced here — a genuine large tab must never be blocked by the database mid-service.';

-- ---------------------------------------------------------------------------
-- 2. Orders per minute, per guest session.
-- ---------------------------------------------------------------------------
create or replace function app.trg_guest_order_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $trg_guest_order_rate_limit_0082$
declare
  v_limit  int;
  v_recent int;
begin
  -- Staff-created orders are not rate-limited: a busy till legitimately fires
  -- faster than any guest, and the actor there is identified and audited.
  if new.guest_session_id is null then
    return new;
  end if;

  select guest_orders_per_minute into v_limit from venue_settings limit 1;
  if v_limit is null then
    return new;                                  -- no settings row: do not invent a limit
  end if;

  select count(*) into v_recent
    from orders
   where guest_session_id = new.guest_session_id
     and placed_at > now() - interval '1 minute';

  if v_recent >= v_limit then
    raise exception 'TOO_MANY_ORDERS' using errcode = 'P0001',
      detail = format('%s orders in the last minute, limit %s', v_recent, v_limit),
      hint = 'please wait a moment, or ask a member of staff';
  end if;

  return new;
end $trg_guest_order_rate_limit_0082$;

revoke all on function app.trg_guest_order_rate_limit() from public, anon, authenticated;

drop trigger if exists orders_guest_rate_limit on orders;
create trigger orders_guest_rate_limit
  before insert on orders
  for each row execute function app.trg_guest_order_rate_limit();

-- ---------------------------------------------------------------------------
-- 3. Items per order, for guest orders.
-- ---------------------------------------------------------------------------
create or replace function app.trg_guest_order_item_cap() returns trigger
language plpgsql security definer set search_path = public as $trg_guest_order_item_cap_0082$
declare
  v_limit   int;
  v_session uuid;
  v_count   int;
begin
  select o.guest_session_id into v_session from orders o where o.id = new.order_id;
  if v_session is null then
    return new;                                  -- staff order, or no parent yet
  end if;

  select guest_items_per_order into v_limit from venue_settings limit 1;
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count from order_items where order_id = new.order_id;

  if v_count >= v_limit then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001',
      detail = format('%s items already on this order, limit %s', v_count, v_limit),
      hint = 'split it across orders, or ask a member of staff';
  end if;

  return new;
end $trg_guest_order_item_cap_0082$;

revoke all on function app.trg_guest_order_item_cap() from public, anon, authenticated;

drop trigger if exists order_items_guest_cap on order_items;
create trigger order_items_guest_cap
  before insert on order_items
  for each row execute function app.trg_guest_order_item_cap();
