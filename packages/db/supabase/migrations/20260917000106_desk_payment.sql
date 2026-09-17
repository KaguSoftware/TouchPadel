-- ===========================================================================
-- 0106 — the court desk takes court payment.
--
-- The ask (owner, 2026-09-17): the court desk takes payment for a court
-- booking, including the cafe orders charged to that booking, and nothing in
-- the money path may leave the day unclosable, charge a court twice, or lose
-- money when a booking changes after it was paid.
--
-- THE MODEL DOES NOT CHANGE. A settled tab carrying `tabs.reservation_id` is
-- still the record of a paid court (0053); reports still count padel revenue
-- from reservations and cafe revenue as settled total − court_iqd. What changes
-- is that the model is made hole-free, and the desk is allowed to use it.
--
-- ---------------------------------------------------------------------------
-- DEFECTS THIS CLOSES (each reproduced against 0053/0084/0100)
-- ---------------------------------------------------------------------------
--
--  D1  open_tab accepted a second tab on the same booking, and
--      compute_tab_totals charged the FULL court fee on each. Two clerks, or a
--      drinks tab opened after the court was paid, billed the court twice.
--      -> tabs_one_live_per_reservation + BOOKING_TAB_OPEN, and the court fee
--         on a tab is now what is still OWED on the booking
--         (app.court_fee_remaining), not its full price.
--
--  D2  A booking tab whose guest never came (no_show / cancelled) charges no
--      court. With nothing else on it settle_tab raised ALREADY_PAID and
--      cancel_tab raised TAB_NOT_EMPTY 'reservation' — the tab could never
--      leave 'open', and close_day refuses while a tab is open. The same dead
--      end held for a tab whose every line was voided, and for a part-paid tab
--      whose booking was then cancelled.
--      -> cancel_tab refuses the booking branch only while a court fee is
--         still owed; app.settle_zero_tab closes a tab that owes nothing, and
--         names the refund first when more was paid than is now owed.
--
--  D3  extend / move re-price a booking (0048). After the court was paid the
--      difference could not be collected: the settled tab refuses, and a new
--      tab charged the full price again. -> court_fee_remaining charges only
--      the difference on the next tab.
--
--  D4  A price change between the clerk reading the bill and pressing Pay was
--      silent — card is recorded, not processed, so the terminal and the
--      system disagreed until day close. -> settle_tab takes the total the
--      clerk saw (p_expected_total_iqd) and raises TOTAL_CHANGED.
--
-- ---------------------------------------------------------------------------
-- ROLES
-- ---------------------------------------------------------------------------
--
-- court_desk joins cashier/manager/owner on open_tab, settle_tab, merge_tabs,
-- cancel_tab and record_drawer_open, and may read day_sessions (so the desk can
-- say "the trading day is not open" instead of failing). The desk is NOT given
-- payments / refunds / tab_adjustments reads: it gets money through the two
-- server-computed read RPCs below, so no screen does money arithmetic
-- (PRODUCT.md L44). Refunds stay manager/owner behind a PIN.
--
-- The cashier may now read the bookings a tab can be charged to — any booking
-- that already has a tab, or one starting within a day either side of now — so
-- the till can open a tab "by court" (SOW L443). Nothing wider.
--
-- ---------------------------------------------------------------------------
-- DAY CLOSE
-- ---------------------------------------------------------------------------
--
-- The desk keeps its own cash box, so v_day_close_summary gains the cash and
-- card taken by court-desk staff (appended columns; the expected cash figure is
-- unchanged and still includes them). Bookings played but not paid WARN at
-- close (app.unpaid_played_bookings) — they do not block it: a guest the
-- manager let go unpaid must not hold the whole close hostage.
--
-- LOCKING. Nothing here locks `reservations`, so lock-order rule 3 (lock_court
-- first) is not engaged, and settle does not serialise against desk moves. A
-- move that lands between a bill being read and settled is caught by
-- TOTAL_CHANGED; one that lands after is collectable (or refundable) because
-- court_fee_remaining is derived from what was stamped, not remembered.
--
-- covered by packages/db/tests/desk-payment.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. One live tab per booking.
--
-- Pre-flight first: if a database already holds two live tabs on one booking
-- (D1 was reachable), the index build would fail with a bare 23505. Name them
-- instead, so whoever pushes knows exactly which tabs to settle or merge.
-- ---------------------------------------------------------------------------
do $preflight_0106$
declare
  v_dupes text;
begin
  select string_agg(reservation_id::text, ', ')
    into v_dupes
    from (select reservation_id
            from tabs
           where reservation_id is not null
             and status in ('open','awaiting_payment')
           group by reservation_id
          having count(*) > 1) d;
  if v_dupes is not null then
    raise exception 'DUPLICATE_LIVE_BOOKING_TABS'
      using errcode = 'P0001',
            detail  = v_dupes,
            hint    = 'settle or merge the extra open tabs on these bookings, then re-run the migration';
  end if;
end $preflight_0106$;

-- tabs is a few thousand rows and this is a partial index over the open ones:
-- the SHARE lock is held for milliseconds. CONCURRENTLY cannot run inside the
-- per-migration transaction. MIGRATION-RISK-ACCEPTED in the PR body.
-- Merged donors are 'void', so they fall outside the predicate on their own.
create unique index if not exists tabs_one_live_per_reservation
  on tabs (reservation_id)
  where reservation_id is not null and status in ('open','awaiting_payment');

-- ---------------------------------------------------------------------------
-- 2. What the court has been billed, and what is still owed.
--
-- "Billed" is the court_iqd STAMPED on the booking's settled tabs. Refunds are
-- deliberately not netted in: a payment carries no court/goods split, so a
-- refund cannot honestly be attributed to the court. A cancelled or no-show
-- booking owes nothing whatever was paid, and what may be owed back is
-- reported separately (booking_bill.court_refund_due_iqd) for a manager.
-- Internal: no client grant, like app.tab_net_paid.
-- ---------------------------------------------------------------------------
create or replace function app.court_fee_paid(p_reservation_id uuid, p_exclude_tab_id uuid default null)
returns bigint
language sql stable security definer set search_path = public as $court_fee_paid_0106$
  select coalesce(sum(t.court_iqd), 0)::bigint
    from tabs t
   where t.reservation_id = p_reservation_id
     and t.status = 'settled'
     and t.merged_into_tab_id is null
     and t.id is distinct from p_exclude_tab_id
$court_fee_paid_0106$;

create or replace function app.court_fee_remaining(p_reservation_id uuid, p_exclude_tab_id uuid default null)
returns bigint
language sql stable security definer set search_path = public as $court_fee_remaining_0106$
  select coalesce((
    select greatest(r.price_iqd - app.court_fee_paid(r.id, p_exclude_tab_id), 0)::bigint
      from reservations r
     where r.id = p_reservation_id
       and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.price_iqd is not null
  ), 0)::bigint
$court_fee_remaining_0106$;

revoke all on function app.court_fee_paid(uuid, uuid) from public, anon, authenticated;
revoke all on function app.court_fee_remaining(uuid, uuid) from public, anon, authenticated;

comment on function app.court_fee_remaining(uuid, uuid) is
  '0106. The court fee still owed on a booking: price_iqd minus the court_iqd stamped on its OTHER settled tabs, floored at 0; 0 unless the booking is confirmed/arrived/completed. The basis of the court line on every tab (compute_tab_totals). Internal.';

-- ---------------------------------------------------------------------------
-- 3. compute_tab_totals — the 0053 body; the court line is now what is owed.
--
-- The tab being computed is EXCLUDED from "already billed", so a settled tab
-- recomputes to its own court and a second tab sees the first one's.
-- ---------------------------------------------------------------------------
create or replace function app.compute_tab_totals(p_tab_id uuid)
returns table (
  subtotal_iqd bigint,
  discount_iqd bigint,
  tax_iqd      bigint,
  court_iqd    bigint,
  total_iqd    bigint
)
language plpgsql stable security definer set search_path = public as $totals_0106$
declare
  v_subtotal  bigint;
  v_disc_line bigint;
  v_disc_tab  bigint;
  v_discount  bigint;
  v_tab_alloc bigint;
  v_tax       bigint;
  v_court     bigint;
  v_inclusive boolean;
begin
  select coalesce(sum(oi.line_total_iqd), 0) into v_subtotal
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_line
    from tab_adjustments a
    join order_items oi on oi.id = a.order_item_id
    join orders o on o.id = oi.order_id
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and o.tab_id = p_tab_id
     and o.status <> 'voided'
     and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_tab
    from tab_adjustments a
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and a.order_item_id is null;

  v_discount := least(v_disc_line + v_disc_tab, v_subtotal);

  v_tab_alloc := greatest(least(v_disc_tab, v_discount - least(v_disc_line, v_discount)), 0);

  -- 0106: the court fee still OWED on the booking this tab is charged to (D1,
  -- D3). 'pending' holds, cancelled, expired and no-show bookings owe nothing.
  select app.court_fee_remaining(t.reservation_id, t.id) into v_court
    from tabs t
   where t.id = p_tab_id
     and t.reservation_id is not null;
  v_court := coalesce(v_court, 0);

  with grp as (
    select mc.tax_group_id, sum(oi.line_total_iqd) as grp_subtotal
      from order_items oi
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
     group by mc.tax_group_id
  ),
  line_disc as (
    select mc.tax_group_id, sum(a.amount_iqd) as amt
      from tab_adjustments a
      join order_items oi     on oi.id = a.order_item_id and not oi.voided
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where a.tab_id = p_tab_id
       and a.kind in ('discount_percent','discount_amount')
       and o.tab_id = p_tab_id
       and o.status <> 'voided'
     group by mc.tax_group_id
  ),
  base as (
    select g.tax_group_id,
           greatest(g.grp_subtotal - coalesce(ld.amt, 0), 0) as after_line
      from grp g
      left join line_disc ld on ld.tax_group_id = g.tax_group_id
  ),
  alloc as (
    select b.tax_group_id,
           greatest(
             b.after_line
               - round((v_tab_alloc::numeric * b.after_line)
                       / nullif(sum(b.after_line) over (), 0)),
             0) as taxable
      from base b
  )
  select coalesce(sum(
           case when coalesce((select vs.tax_inclusive from venue_settings vs), false)
                then round((a.taxable::numeric * tg.rate_bp) / (10000.0 + tg.rate_bp))
                else round((a.taxable::numeric * tg.rate_bp) / 10000.0)
           end), 0)::bigint
    into v_tax
    from alloc a
    join tax_groups tg on tg.id = a.tax_group_id
   where tg.is_active;

  select tax_inclusive into v_inclusive from venue_settings;

  subtotal_iqd := v_subtotal;
  discount_iqd := v_discount;
  tax_iqd      := v_tax;
  court_iqd    := v_court;
  total_iqd    := greatest(
    v_subtotal - v_discount
      + case when coalesce(v_inclusive, false) then 0 else v_tax end,
    0) + v_court;
  return next;
end $totals_0106$;

revoke all on function app.compute_tab_totals(uuid) from public, anon, authenticated;
grant execute on function app.compute_tab_totals(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. open_tab — 0084 + court_desk + one live tab per booking.
-- ---------------------------------------------------------------------------
create or replace function app.open_tab(
  p_table_id        uuid default null,
  p_label           text default null,
  p_reservation_id  uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $opentab_0106$
declare
  v_day        uuid;
  v_row        tabs%rowtype;
  v_label      text := nullif(btrim(p_label), '');
  v_status     reservation_status;
  v_live       uuid;
  v_constraint text;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_row from tabs where idempotency_key = p_idempotency_key;
    if found then
      if v_row.opened_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another tab';
      end if;
      return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
    end if;
  end if;

  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  if p_table_id is not null and not exists (select 1 from cafe_tables where id = p_table_id and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_reservation_id is not null then
    select status into v_status from reservations where id = p_reservation_id;
    if not found then
      raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- 0106: a booking that has ended without being played owes nothing; a tab
    -- opened against it is a mistake the day close would have to clean up.
    if v_status in ('cancelled','no_show','expired') then
      raise exception 'RESERVATION_NOT_LIVE' using errcode = 'P0001', detail = v_status::text;
    end if;
    -- 0106 (D1): friendly refusal. NOT serialised — two concurrent opens both
    -- pass it; tabs_one_live_per_reservation is the guard, mapped below.
    select id into v_live from tabs
     where reservation_id = p_reservation_id
       and status in ('open','awaiting_payment')
     limit 1;
    if v_live is not null then
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = v_live::text,
        hint = 'this booking already has an open bill; add to that one';
    end if;
  end if;
  if p_table_id is null and p_reservation_id is null then
    raise exception 'TAB_ANCHOR_REQUIRED' using errcode = 'P0001',
      hint = 'a tab needs a table or a reservation; a name alone is not an anchor';
  end if;

  begin
    insert into tabs (day_session_id, table_id, reservation_id, label,
                      opened_by_staff_id, device_id, idempotency_key)
    values (v_day, p_table_id, p_reservation_id, v_label,
            auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'tabs_one_live_per_reservation' then
      select id into v_live from tabs
       where reservation_id = p_reservation_id
         and status in ('open','awaiting_payment')
       limit 1;
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = coalesce(v_live::text, ''),
        hint = 'this booking already has an open bill; add to that one';
    end if;
    if p_idempotency_key is not null then
      select * into v_row from tabs where idempotency_key = p_idempotency_key;
      if found then
        if v_row.opened_by_staff_id is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another tab';
        end if;
        return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
      end if;
    end if;
    raise;
  end;

  return jsonb_build_object('duplicate', false, 'tab_id', v_row.id);
end $opentab_0106$;

comment on function app.open_tab(uuid, text, uuid, text, text) is
  '0106 (0084). Opens a staff tab (cashier, court_desk, manager, owner). The anchor is a seat — p_table_id or p_reservation_id. A booking takes at most one live tab (BOOKING_TAB_OPEN, detail = that tab id) and an ended booking none (RESERVATION_NOT_LIVE).';

-- ---------------------------------------------------------------------------
-- 5. settle_tab — 0053 + court_desk + the total the clerk saw.
--
-- The 6-argument function is DROPPED, not left beside this one: PostgREST
-- resolves by argument names, and two candidates accepting the same body make
-- every call ambiguous. Queued envelopes call by name without the new key and
-- resolve to this one through its default.
-- ---------------------------------------------------------------------------
drop function if exists app.settle_tab(uuid, payment_method, bigint, bigint, text, text);

create or replace function app.settle_tab(
  p_tab_id             uuid,
  p_method             payment_method,
  p_tendered_iqd       bigint default null,
  p_amount_iqd         bigint default null,
  p_idempotency_key    text   default null,
  p_device_id          text   default null,
  p_expected_total_iqd bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $settle_0106$
declare
  v_tab      tabs%rowtype;
  v_totals   record;
  v_paid     bigint;
  v_due      bigint;
  v_amount   bigint;
  v_change   bigint;
  v_payment  payments%rowtype;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_payment from payments where idempotency_key = p_idempotency_key;
    if found then
      if v_payment.recorded_by is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another payment';
      end if;
      select * into v_tab from tabs where id = v_payment.tab_id;
      return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
        'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
    end if;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  select * into v_totals from app.compute_tab_totals(p_tab_id);

  -- 0106 (D4): the bill moved under the clerk (a line added, a booking
  -- extended). Refused BEFORE the stamp, so the row is left exactly as it was.
  if p_expected_total_iqd is not null and p_expected_total_iqd <> v_totals.total_iqd then
    raise exception 'TOTAL_CHANGED' using errcode = 'P0001',
      detail = format('expected %s, now %s', p_expected_total_iqd, v_totals.total_iqd),
      hint = 'the bill changed since it was shown; read it again before taking payment';
  end if;

  update tabs
     set subtotal_iqd = v_totals.subtotal_iqd,
         discount_iqd = v_totals.discount_iqd,
         tax_iqd      = v_totals.tax_iqd,
         court_iqd    = v_totals.court_iqd,
         total_iqd    = v_totals.total_iqd
   where id = p_tab_id
   returning * into v_tab;

  v_paid := app.tab_net_paid(p_tab_id);
  v_due := v_tab.total_iqd - v_paid;
  if v_due <= 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001',
      hint = 'nothing is owed on this tab; close it with app.settle_zero_tab';
  end if;

  v_amount := coalesce(p_amount_iqd, v_due);
  if v_amount < 1 or v_amount > v_due then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001',
      detail = format('due %s, got %s', v_due, v_amount);
  end if;

  if p_method = 'cash' then
    if p_tendered_iqd is null or p_tendered_iqd < v_amount then
      raise exception 'TENDER_SHORT' using errcode = 'P0001';
    end if;
    v_change := p_tendered_iqd - v_amount;
  else
    if p_tendered_iqd is not null then
      raise exception 'TENDER_CARD' using errcode = 'P0001',
        hint = 'tendered/change are cash-only fields';
    end if;
    v_change := null;
  end if;

  begin
    insert into payments (tab_id, day_session_id, method, amount_iqd, tendered_iqd,
                          change_iqd, recorded_by, device_id, idempotency_key)
    values (p_tab_id, v_tab.day_session_id, p_method, v_amount, p_tendered_iqd,
            v_change, auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_payment;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_payment from payments where idempotency_key = p_idempotency_key;
      if found then
        if v_payment.recorded_by is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another payment';
        end if;
        return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
          'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
      end if;
    end if;
    raise;
  end;

  if v_paid + v_amount >= v_tab.total_iqd then
    update tabs set status = 'settled', settled_at = now()
     where id = p_tab_id returning * into v_tab;
    perform app.write_audit('tab.settle', 'tabs', v_tab.id::text,
                            null, to_jsonb(v_tab), null, null, p_device_id);
  else
    update tabs set status = 'awaiting_payment'
     where id = p_tab_id returning * into v_tab;
  end if;

  return jsonb_build_object('duplicate', false, 'payment_id', v_payment.id,
    'tab_id', v_tab.id, 'status', v_tab.status,
    'subtotal_iqd', v_tab.subtotal_iqd, 'discount_iqd', v_tab.discount_iqd,
    'tax_iqd', v_tab.tax_iqd, 'court_iqd', v_tab.court_iqd, 'total_iqd', v_tab.total_iqd,
    'amount_iqd', v_amount, 'change_iqd', v_change,
    'remaining_iqd', greatest(v_tab.total_iqd - v_paid - v_amount, 0));
end $settle_0106$;

revoke all on function app.settle_tab(uuid, payment_method, bigint, bigint, text, text, bigint) from public, anon;
grant execute on function app.settle_tab(uuid, payment_method, bigint, bigint, text, text, bigint) to authenticated;

comment on function app.settle_tab(uuid, payment_method, bigint, bigint, text, text, bigint) is
  '0106 (0053). Records one payment against a tab (cashier, court_desk, manager, owner); part payments leave it awaiting_payment. p_expected_total_iqd, when given, must equal the recomputed total or TOTAL_CHANGED is raised before anything is written.';

-- ---------------------------------------------------------------------------
-- 6. settle_zero_tab — close a tab that owes nothing (D2).
--
-- Separate from settle_tab on purpose: settle_tab's contract is "record a
-- payment" (method, tender, a payments row that replay dedupes on); a close
-- with no money moving has none of those. It needs a reason, because a tab
-- closed at zero is exactly what a day-close reviewer asks about.
-- ---------------------------------------------------------------------------
create or replace function app.settle_zero_tab(
  p_tab_id      uuid,
  p_reason_code text,
  p_device_id   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $settle_zero_0106$
declare
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_totals record;
  v_paid   bigint;
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- Lock order (0038/0044): day_sessions -> tabs.
  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001', detail = v_tab.status::text;
  end if;
  if v_tab.day_session_id <> v_day then
    raise exception 'TAB_DAY_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_paid := app.tab_net_paid(p_tab_id);

  if v_totals.total_iqd > v_paid then
    raise exception 'NOT_ZERO' using errcode = 'P0001',
      detail = (v_totals.total_iqd - v_paid)::text,
      hint = 'money is still owed on this tab; take payment instead';
  end if;
  if v_paid > v_totals.total_iqd then
    raise exception 'REFUND_DUE' using errcode = 'P0001',
      detail = (v_paid - v_totals.total_iqd)::text,
      hint = 'more was paid than is now owed; a manager refunds the difference first';
  end if;
  if not exists (select 1 from orders where tab_id = v_tab.id)
     and not exists (select 1 from payments where tab_id = v_tab.id)
     and not exists (select 1 from tab_adjustments where tab_id = v_tab.id) then
    raise exception 'TAB_EMPTY' using errcode = 'P0001',
      hint = 'nothing was ever on this tab; remove it with app.cancel_tab';
  end if;

  update tabs
     set subtotal_iqd = v_totals.subtotal_iqd,
         discount_iqd = v_totals.discount_iqd,
         tax_iqd      = v_totals.tax_iqd,
         court_iqd    = v_totals.court_iqd,
         total_iqd    = v_totals.total_iqd,
         status       = 'settled',
         settled_at   = now()
   where id = v_tab.id
   returning * into v_tab;

  perform app.write_audit('tab.settle', 'tabs', v_tab.id::text,
                          null, to_jsonb(v_tab) || jsonb_build_object('zero_close', true),
                          v_reason, null, p_device_id);

  return jsonb_build_object('tab_id', v_tab.id, 'status', v_tab.status,
                            'total_iqd', v_tab.total_iqd, 'paid_iqd', v_paid);
end $settle_zero_0106$;

revoke all on function app.settle_zero_tab(uuid, text, text) from public, anon;
grant execute on function app.settle_zero_tab(uuid, text, text) to authenticated;

comment on function app.settle_zero_tab(uuid, text, text) is
  '0106. Closes an open/awaiting tab that owes nothing (total = net paid) as settled, with a reason, and no payments row. NOT_ZERO when money is owed, REFUND_DUE (detail = amount) when more was paid than is owed, TAB_EMPTY when nothing was ever on it (use cancel_tab). Audited as tab.settle with zero_close.';

-- ---------------------------------------------------------------------------
-- 7. cancel_tab — 0100 + court_desk; the booking branch refuses only while a
--    court fee is still owed (D2: a no-show's empty tab can now go).
-- ---------------------------------------------------------------------------
create or replace function app.cancel_tab(p_tab_id uuid, p_reason_code text default null)
returns jsonb
language plpgsql security definer set search_path = public as $cancel_0106$
declare
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_before jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001',
      detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001', detail = v_tab.status;
  end if;
  if v_tab.day_session_id <> v_day then
    raise exception 'TAB_DAY_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (select 1 from orders where tab_id = v_tab.id) then
    raise exception 'TAB_NOT_EMPTY' using errcode = 'P0001', detail = 'orders',
      hint = 'settle or void the orders on this tab first';
  end if;
  if exists (select 1 from payments where tab_id = v_tab.id) then
    raise exception 'TAB_NOT_EMPTY' using errcode = 'P0001', detail = 'payments',
      hint = 'this tab has been paid against; refund it before it can go';
  end if;
  if exists (select 1 from tab_adjustments where tab_id = v_tab.id) then
    raise exception 'TAB_NOT_EMPTY' using errcode = 'P0001', detail = 'adjustments';
  end if;
  -- 0106: only while the booking still owes its court fee on this tab. A
  -- cancelled / no-show booking, or one whose court was paid on another tab,
  -- owes nothing here, and refusing left the tab open until day close failed.
  if v_tab.reservation_id is not null
     and app.court_fee_remaining(v_tab.reservation_id, v_tab.id) > 0 then
    raise exception 'TAB_NOT_EMPTY' using errcode = 'P0001', detail = 'reservation',
      hint = 'the booking''s court fee is owed on this tab';
  end if;

  v_before := to_jsonb(v_tab);

  update tabs
     set status = 'void', subtotal_iqd = 0, tax_iqd = 0, discount_iqd = 0, total_iqd = 0
   where id = v_tab.id
   returning * into v_tab;

  perform app.write_audit('tab.cancel', 'tabs', v_tab.id::text,
                          v_before, to_jsonb(v_tab), v_reason);

  return jsonb_build_object('tab_id', v_tab.id, 'status', v_tab.status);
end $cancel_0106$;

comment on function app.cancel_tab(uuid, text) is
  '0106 (0100). Voids an OPEN tab with no orders, payments or adjustments, and no court fee still owed on its booking (cashier, court_desk, manager, owner). p_reason_code is mandatory. Raises TAB_NOT_EMPTY (detail names which) when there is anything to reconcile. Audited as tab.cancel.';

-- ---------------------------------------------------------------------------
-- 8. merge_tabs — 0067 + court_desk + a booking tab never merges away.
--
-- merge_tabs does not carry reservation_id to the survivor. Merging a booking
-- tab INTO a table tab voided the booking tab and silently dropped the court
-- fee from the bill the guest was about to pay.
-- ---------------------------------------------------------------------------
create or replace function app.merge_tabs(
  p_donor_tab_id    uuid,
  p_survivor_tab_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $merge_0106$
declare
  v_donor    tabs%rowtype;
  v_survivor tabs%rowtype;
  v_before   jsonb;
  v_first    uuid;
  v_second   uuid;
  v_old_red  promotion_redemptions%rowtype;
  v_old_adj  tab_adjustments%rowtype;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_donor_tab_id = p_survivor_tab_id then
    raise exception 'MERGE_SELF' using errcode = 'P0001';
  end if;

  v_first  := least(p_donor_tab_id, p_survivor_tab_id);
  v_second := greatest(p_donor_tab_id, p_survivor_tab_id);
  perform 1 from tabs where id = v_first for update;
  perform 1 from tabs where id = v_second for update;

  select * into v_donor from tabs where id = p_donor_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001', detail = p_donor_tab_id::text;
  end if;
  select * into v_survivor from tabs where id = p_survivor_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001', detail = p_survivor_tab_id::text;
  end if;

  if v_donor.status <> 'open' or v_survivor.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_donor.day_session_id <> v_survivor.day_session_id then
    raise exception 'TAB_DAY_MISMATCH' using errcode = 'P0001';
  end if;
  if exists (select 1 from payments where tab_id = v_donor.id) then
    raise exception 'DONOR_HAS_PAYMENTS' using errcode = 'P0001',
      hint = 'settle or refund the donor tab first';
  end if;
  -- 0106: the court fee rides on the booking tab. Merge the other way.
  if v_donor.reservation_id is not null
     and v_donor.reservation_id is distinct from v_survivor.reservation_id then
    raise exception 'BOOKING_TAB_DONOR' using errcode = 'P0001',
      hint = 'a booking''s bill cannot be merged into another bill; merge the other bill into it';
  end if;

  v_before := to_jsonb(v_donor);

  select * into v_old_red from promotion_redemptions where tab_id = v_donor.id;
  if found then
    select * into v_old_adj from tab_adjustments where id = v_old_red.adjustment_id;
    delete from promotion_redemptions where id = v_old_red.id;
    delete from tab_adjustments where tab_id = v_donor.id and promotion_id is not null;
    perform app.write_audit('promotion.drop_on_merge', 'tab_adjustments', v_old_adj.id::text,
                            to_jsonb(v_old_adj) || jsonb_build_object('redemption', to_jsonb(v_old_red)),
                            null, 'promotion', v_old_adj.authorized_by, null);
  end if;

  update orders set tab_id = v_survivor.id where tab_id = v_donor.id;
  update tab_adjustments set tab_id = v_survivor.id where tab_id = v_donor.id;

  update tabs
     set status = 'void', merged_into_tab_id = v_survivor.id,
         subtotal_iqd = 0, tax_iqd = 0, discount_iqd = 0, total_iqd = 0
   where id = v_donor.id
   returning * into v_donor;

  perform app.write_audit('tab.merge', 'tabs', v_donor.id::text,
                          v_before, to_jsonb(v_donor));

  return jsonb_build_object('donor_tab_id', v_donor.id,
                            'survivor_tab_id', v_survivor.id);
end $merge_0106$;

-- ---------------------------------------------------------------------------
-- 9. record_drawer_open — 0053 + court_desk (the desk has its own cash box).
-- ---------------------------------------------------------------------------
create or replace function app.record_drawer_open(
  p_reason_code text,
  p_device_id   text default null,
  p_tab_id      uuid default null
) returns void
language plpgsql security definer set search_path = public as $drawer_0106$
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'an opening with no sale attached needs a stated reason';
  end if;

  perform app.write_audit('drawer.open', 'day_sessions',
                          coalesce(app.current_open_day()::text, 'none'),
                          null,
                          jsonb_build_object('tab_id', p_tab_id),
                          p_reason_code, null, p_device_id);
end $drawer_0106$;

-- ---------------------------------------------------------------------------
-- 10. The bill for one booking — every money figure the desk shows.
-- ---------------------------------------------------------------------------
create or replace function app.booking_bill(p_reservation_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $booking_bill_0106$
declare
  v_res        reservations%rowtype;
  v_court      courts%rowtype;
  v_live       boolean;
  v_day_open   boolean;
  v_tab        tabs%rowtype;
  v_totals     record;
  v_paid_net   bigint;
  v_live_json  jsonb := null;
  v_court_paid bigint;
  v_remaining  bigint;
  v_refunds    bigint;
  v_refund_due bigint;
  v_settled    jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_res from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_court from courts where id = v_res.court_id;

  v_live := v_res.kind = 'booking' and v_res.status in ('confirmed','arrived','completed');
  v_day_open := exists (select 1 from day_sessions where status = 'open');

  select * into v_tab from tabs
   where reservation_id = v_res.id and status in ('open','awaiting_payment')
   limit 1;
  if found then
    select * into v_totals from app.compute_tab_totals(v_tab.id);
    v_paid_net := app.tab_net_paid(v_tab.id);
    v_live_json := jsonb_build_object(
      'id',              v_tab.id,
      'status',          v_tab.status,
      'day_session_id',  v_tab.day_session_id,
      'subtotal_iqd',    v_totals.subtotal_iqd,
      'discount_iqd',    v_totals.discount_iqd,
      'tax_iqd',         v_totals.tax_iqd,
      'court_iqd',       v_totals.court_iqd,
      'total_iqd',       v_totals.total_iqd,
      'paid_iqd',        v_paid_net,
      'due_iqd',         greatest(v_totals.total_iqd - v_paid_net, 0),
      'over_paid_iqd',   greatest(v_paid_net - v_totals.total_iqd, 0),
      -- Units, not rows: two coffees on one line are two items to the guest.
      'item_count',      (select coalesce(sum(oi.qty), 0) from order_items oi join orders o on o.id = oi.order_id
                           where o.tab_id = v_tab.id and o.status <> 'voided' and not oi.voided),
      'has_orders',      exists (select 1 from orders where tab_id = v_tab.id),
      'has_payments',    exists (select 1 from payments where tab_id = v_tab.id),
      'has_adjustments', exists (select 1 from tab_adjustments where tab_id = v_tab.id));
  end if;

  v_court_paid := app.court_fee_paid(v_res.id, null);
  v_remaining  := app.court_fee_remaining(v_res.id, null);

  select coalesce(sum(rf.amount_iqd), 0) into v_refunds
    from refunds rf
    join payments p on p.id = rf.payment_id
    join tabs t on t.id = p.tab_id
   where t.reservation_id = v_res.id and t.status = 'settled' and t.merged_into_tab_id is null;

  -- Display only ("may be owed back"): what the settled tabs billed for the
  -- court beyond what the booking now costs, less anything already refunded
  -- on those tabs. A refund carries no court/goods split, so this is a prompt
  -- for a manager, never a figure anything else is computed from.
  v_refund_due := greatest(
    v_court_paid - (case when v_live then coalesce(v_res.price_iqd, 0) else 0 end) - v_refunds,
    0);

  select coalesce(jsonb_agg(jsonb_build_object(
           'tab_id',      t.id,
           'settled_at',  t.settled_at,
           'court_iqd',   t.court_iqd,
           'total_iqd',   t.total_iqd,
           'refunds_iqd', (select coalesce(sum(rf.amount_iqd), 0) from refunds rf
                             join payments p2 on p2.id = rf.payment_id where p2.tab_id = t.id),
           'payments',    (select coalesce(jsonb_agg(jsonb_build_object(
                                     'id',               p.id,
                                     'method',           p.method,
                                     'amount_iqd',       p.amount_iqd,
                                     'tendered_iqd',     p.tendered_iqd,
                                     'change_iqd',       p.change_iqd,
                                     'created_at',       p.created_at,
                                     'recorded_by_name', s.display_name) order by p.created_at), '[]'::jsonb)
                             from payments p left join staff s on s.id = p.recorded_by
                            where p.tab_id = t.id)
         ) order by t.settled_at), '[]'::jsonb)
    into v_settled
    from tabs t
   where t.reservation_id = v_res.id and t.status = 'settled' and t.merged_into_tab_id is null;

  return jsonb_build_object(
    'reservation', jsonb_build_object(
       'id',            v_res.id,
       'kind',          v_res.kind,
       'status',        v_res.status,
       'price_iqd',     v_res.price_iqd,
       'guest_name',    v_res.guest_name,
       'start_at',      v_res.start_at,
       'end_at',        v_res.end_at,
       'court_id',      v_res.court_id,
       'court_name_en', v_court.name_en,
       'court_name_ar', v_court.name_ar),
    'live',                 v_live,
    'day_open',             v_day_open,
    'live_tab',             v_live_json,
    'court_paid_iqd',       v_court_paid,
    'court_remaining_iqd',  v_remaining,
    'court_refund_due_iqd', v_refund_due,
    'settled_tabs',         v_settled);
end $booking_bill_0106$;

revoke all on function app.booking_bill(uuid) from public, anon;
grant execute on function app.booking_bill(uuid) to authenticated;

comment on function app.booking_bill(uuid) is
  '0106. Every money figure for one booking (cashier, court_desk, manager, owner): its live tab with server totals and due, the court fee billed and still owed, what may be owed back, and the settled tabs with their payments. The desk renders this; it computes nothing.';

-- ---------------------------------------------------------------------------
-- 11. Bill states for many bookings — the board's payment column.
--
--   none         nothing charged, and either nothing owed or not yet charged
--                (owed_iqd says which)
--   open         a live tab, nothing paid on it yet
--   partly_paid  a live tab with a part payment
--   dead_open    a live tab that owes nothing and has not been paid over —
--                "close the bill"
--   paid         no live tab, court fee fully billed on settled tabs
--   owed         no live tab, court was paid once and the price has since gone
--                up (or a settled tab never carried it)
--   refund_due   more was paid than is now owed
-- ---------------------------------------------------------------------------
create or replace function app.booking_bill_states(p_reservation_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $booking_bill_states_0106$
declare
  v_out jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_reservation_ids, 1), 0) > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'at most 500 bookings per call';
  end if;

  with ids as (
    select distinct unnest(coalesce(p_reservation_ids, '{}'::uuid[])) as id
  ),
  base as (
    select r.id,
           (r.kind = 'booking' and r.status in ('confirmed','arrived','completed')) as live,
           coalesce(r.price_iqd, 0) as price,
           app.court_fee_paid(r.id, null) as court_paid,
           app.court_fee_remaining(r.id, null) as remaining,
           (select t.id from tabs t
             where t.reservation_id = r.id and t.status in ('open','awaiting_payment')
             limit 1) as live_tab_id,
           (select coalesce(sum(rf.amount_iqd), 0) from refunds rf
              join payments p on p.id = rf.payment_id
              join tabs t on t.id = p.tab_id
             where t.reservation_id = r.id and t.status = 'settled' and t.merged_into_tab_id is null) as refunds
      from ids
      join reservations r on r.id = ids.id
  ),
  tabbed as (
    select b.*,
           tt.total_iqd as tab_total,
           case when b.live_tab_id is null then 0 else app.tab_net_paid(b.live_tab_id) end as tab_paid,
           greatest(b.court_paid - case when b.live then b.price else 0 end - b.refunds, 0) as refund_due
      from base b
      left join lateral (select * from app.compute_tab_totals(b.live_tab_id)) tt on b.live_tab_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'reservation_id',       x.id,
           'state',
             case
               when x.live_tab_id is not null then
                 case
                   when x.tab_paid > coalesce(x.tab_total, 0) then 'refund_due'
                   when coalesce(x.tab_total, 0) - x.tab_paid <= 0 then 'dead_open'
                   when x.tab_paid > 0 then 'partly_paid'
                   else 'open'
                 end
               when x.refund_due > 0 then 'refund_due'
               when x.live and x.remaining > 0 and x.court_paid > 0 then 'owed'
               when x.court_paid > 0 and x.remaining = 0 then 'paid'
               else 'none'
             end,
           'live_tab_id',          x.live_tab_id,
           'due_iqd',
             case when x.live_tab_id is not null
                  then greatest(coalesce(x.tab_total, 0) - x.tab_paid, 0)
                  else x.remaining end,
           'court_paid_iqd',       x.court_paid,
           'court_remaining_iqd',  x.remaining,
           'court_refund_due_iqd',
             case when x.live_tab_id is not null and x.tab_paid > coalesce(x.tab_total, 0)
                  then x.tab_paid - coalesce(x.tab_total, 0)
                  else x.refund_due end)), '[]'::jsonb)
    into v_out
    from tabbed x;

  return v_out;
end $booking_bill_states_0106$;

revoke all on function app.booking_bill_states(uuid[]) from public, anon;
grant execute on function app.booking_bill_states(uuid[]) to authenticated;

comment on function app.booking_bill_states(uuid[]) is
  '0106. One payment state per booking (none | open | partly_paid | dead_open | paid | owed | refund_due) with due, billed, owed and owed-back figures. At most 500 ids. Cashier, court_desk, manager, owner.';

-- ---------------------------------------------------------------------------
-- 12. Reads.
-- ---------------------------------------------------------------------------

-- The desk reads the day row so it can say "the trading day is not open".
drop policy if exists day_sessions_staff_read on day_sessions;
create policy day_sessions_staff_read on day_sessions for select to authenticated
  using (app.is_staff('cashier','court_desk','manager','owner'));

-- The till charges tabs to bookings (SOW L443/L445). The cashier sees the
-- bookings that already carry a tab, and those starting within a day either
-- side of now — enough to pick tonight's booking, nothing like the calendar.
--
-- The tab test is an inline EXISTS, not a revoked definer helper: every
-- policy on a table is planned for every caller, so a guest reading their own
-- booking would need EXECUTE on the helper (check:authz caught exactly that).
-- The cashier already reads every tab (tabs_staff_read), so the nested policy
-- is a pass-through, and for anyone else is_staff() is false first.
drop policy if exists reservations_cashier_read on reservations;
create policy reservations_cashier_read on reservations for select to authenticated
  using (
    app.is_staff('cashier')
    and ((start_at >= now() - interval '1 day' and start_at < now() + interval '1 day')
         or exists (select 1 from tabs t where t.reservation_id = reservations.id))
  );

-- ---------------------------------------------------------------------------
-- 13. Day close: the desk's cash box, and the bookings played but not paid.
-- ---------------------------------------------------------------------------

-- 0020 view, columns unchanged and in order; two appended. Taken BY court-desk
-- staff: the desk keeps its own box, and the person is what the payment row
-- records. expected cash (close_day) still counts every cash payment.
create or replace view v_day_close_summary with (security_invoker = on) as
select d.id as day_session_id,
       d.business_date, d.status, d.opened_at, d.closed_at,
       d.opening_float_iqd,
       d.cash_expected_iqd, d.cash_counted_iqd, d.cash_variance_iqd,
       d.card_expected_iqd, d.card_terminal_batch_iqd,
       pay.cash_payments_iqd, pay.card_payments_iqd,
       ref.refunds_iqd, ref.refund_count,
       adj.discounts_iqd, adj.adjustment_count, adj.authorizer_names,
       vv.voided_lines_iqd, vv.voided_line_count,
       w.waste_cost_iqd,
       d.notes,
       desk.desk_cash_iqd, desk.desk_card_iqd
  from day_sessions d
  left join lateral (
    select coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0) as cash_payments_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0) as card_payments_iqd
      from payments p where p.day_session_id = d.id
  ) pay on true
  left join lateral (
    select coalesce(sum(r.amount_iqd), 0) as refunds_iqd, count(r.id) as refund_count
      from refunds r join payments p on p.id = r.payment_id
     where p.day_session_id = d.id
  ) ref on true
  left join lateral (
    select coalesce(sum(a.amount_iqd), 0) as discounts_iqd,
           count(a.id)                    as adjustment_count,
           array_remove(array_agg(distinct s.display_name), null) as authorizer_names
      from tab_adjustments a
      join tabs t on t.id = a.tab_id
      left join staff s on s.id = a.authorized_by
     where t.day_session_id = d.id
  ) adj on true
  left join lateral (
    select coalesce(sum(oi.line_total_iqd), 0) as voided_lines_iqd,
           count(oi.id)                        as voided_line_count
      from order_items oi
      join orders o on o.id = oi.order_id
      join tabs t on t.id = o.tab_id
     where t.day_session_id = d.id and oi.voided
  ) vv on true
  left join lateral (
    select coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0)))::bigint, 0) as waste_cost_iqd
      from stock_movements sm
     where sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= d.opened_at
       and sm.at <= coalesce(d.closed_at, now())
  ) w on true
  left join lateral (
    select coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0) as desk_cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0) as desk_card_iqd
      from payments p
      join staff s on s.id = p.recorded_by
     where p.day_session_id = d.id and s.role = 'court_desk'
  ) desk on true;

grant select on v_day_close_summary to authenticated;

-- Bookings of the day that were played (arrived, completed, or confirmed and
-- already over) and still owe their court fee. A warning at close, not a block.
create or replace function app.unpaid_played_bookings(p_day_session_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $unpaid_played_0106$
declare
  v_day day_sessions%rowtype;
  v_out jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_day_session_id is null then
    select * into v_day from day_sessions where status in ('open','closing') order by opened_at desc limit 1;
  else
    select * into v_day from day_sessions where id = p_day_session_id;
  end if;
  if not found then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'reservation_id', r.id,
           'guest_name',     r.guest_name,
           'status',         r.status,
           'start_at',       r.start_at,
           'end_at',         r.end_at,
           'court_name_en',  c.name_en,
           'court_name_ar',  c.name_ar,
           'price_iqd',      r.price_iqd,
           'remaining_iqd',  app.court_fee_remaining(r.id, null),
           'live_tab_id',    (select t.id from tabs t where t.reservation_id = r.id
                                and t.status in ('open','awaiting_payment') limit 1))
         order by r.start_at), '[]'::jsonb)
    into v_out
    from reservations r
    join courts c on c.id = r.court_id
   where r.kind = 'booking'
     and app.business_date(r.start_at) = v_day.business_date
     and (r.status in ('arrived','completed') or (r.status = 'confirmed' and r.end_at <= now()))
     and app.court_fee_remaining(r.id, null) > 0;

  return v_out;
end $unpaid_played_0106$;

revoke all on function app.unpaid_played_bookings(uuid) from public, anon;
grant execute on function app.unpaid_played_bookings(uuid) to authenticated;

comment on function app.unpaid_played_bookings(uuid) is
  '0106. Manager/owner. The bookings of a day session (default: the open one) that were played — arrived, completed, or confirmed and over — and still owe their court fee. Day close lists them as a warning; it does not refuse.';
