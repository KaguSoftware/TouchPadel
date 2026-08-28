-- ---------------------------------------------------------------------------
-- 0053 — the three cashier clauses that needed schema, not just a screen.
--
--   L131 + L445-446  "Charge a cafe order to a court booking so a group settles
--                    courts and drinks in ONE payment." `tabs.reservation_id`
--                    has existed since 0015 and the till's new-tab dialog has
--                    always offered the booking picker — but
--                    `compute_tab_totals` never added the court price, so the
--                    "one payment" promise produced a bill with the court
--                    missing. The group paid for their drinks and walked.
--
--   L444             "Split a bill BY ITEM or evenly." Only `split_evenly`
--                    existed. Splitting by item is the case a group of friends
--                    actually asks for.
--
--   L449             "Change calculation and a cash drawer opening record."
--                    Change was computed; the drawer record did not exist.
--                    Hardware control is explicitly excluded (L474-475) — this
--                    is the RECORD, which is what reconciles at day close.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. tabs.court_iqd — the court fee stamped onto a settled tab.
--
--    Separate from subtotal_iqd on purpose. subtotal_iqd is goods, and it is
--    the base `apply_discount` computes a percentage against (0037): folding
--    court time into it would silently let "10% off the drinks" discount the
--    court as well, which nobody asked for and nobody would notice.
-- ---------------------------------------------------------------------------
alter table tabs add column if not exists court_iqd bigint not null default 0;

comment on column tabs.court_iqd is
  '0053: court fee for a tab charged to a booking (SOW L131). Excluded from '
  'subtotal_iqd so percentage discounts apply to goods only; included in total_iqd.';

-- ---------------------------------------------------------------------------
-- 2. app.compute_tab_totals — now returns court_iqd and includes it in the
--    total.
--
--    DROP + CREATE rather than REPLACE: an OUT-parameter list cannot be changed
--    in place. Callers resolve by name at runtime, and every one of them either
--    selects into a `record` or names a column that still exists.
--
--    The court fee is counted when the tab is linked to a reservation that is
--    still a real booking. A cancelled, expired or no-show reservation charges
--    nothing — otherwise cancelling a booking after ordering drinks would leave
--    the court on the bill.
--
--    There is deliberately no separate "reservation paid" flag: the SOW's model
--    is that a guest reserves and pays at the desk, so a settled tab carrying
--    that reservation_id IS the record of the court being paid for.
-- ---------------------------------------------------------------------------
drop function if exists app.compute_tab_totals(uuid);
create function app.compute_tab_totals(p_tab_id uuid)
returns table (
  subtotal_iqd bigint,
  discount_iqd bigint,
  tax_iqd      bigint,
  court_iqd    bigint,
  total_iqd    bigint
)
language plpgsql stable security definer set search_path = public as $totals_0053$
declare
  v_subtotal  bigint;
  v_disc_line bigint;   -- discounts attached to a still-live line
  v_disc_tab  bigint;   -- whole-tab discounts (order_item_id is null)
  v_discount  bigint;   -- capped total, what we report and subtract
  v_tab_alloc bigint;   -- whole-tab portion actually allocatable to tax groups
  v_tax       bigint;
  v_court     bigint;
  v_inclusive boolean;
begin
  -- Live lines only: a voided line and a voided order are both out.
  select coalesce(sum(oi.line_total_iqd), 0) into v_subtotal
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  -- A line-scoped discount only counts while its line is live (0036 fix #3).
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
  -- price_override adjustments already changed the line totals themselves.

  v_discount := least(v_disc_line + v_disc_tab, v_subtotal);

  v_tab_alloc := greatest(least(v_disc_tab, v_discount - least(v_disc_line, v_discount)), 0);

  -- 0053: the court fee, when this tab is charged to a live booking.
  -- 'pending' is excluded: a hold is not a sale.
  select coalesce(r.price_iqd, 0) into v_court
    from tabs t
    join reservations r on r.id = t.reservation_id
   where t.id = p_tab_id
     and r.kind = 'booking'
     and r.status in ('confirmed','arrived','completed');
  v_court := coalesce(v_court, 0);

  -- Tax on the post-discount base, active groups only (0036 fixes #1/#2).
  -- Court time is not a menu item and belongs to no tax group, so it is
  -- untaxed by construction — the SOW's tax is "per item group" (L454-455).
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
  -- 0045: inclusive tax is EXTRACTED from the gross, not computed as if it
  -- were added on top.
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
end $totals_0053$;

revoke all on function app.compute_tab_totals(uuid) from public, anon, authenticated;
-- Definer callers (settle_tab, split_*) run as the owner and do not need this.
-- The service role does: the DB suites and any future edge function read the
-- live totals directly, and DROP + CREATE reset the default PUBLIC grant they
-- used to inherit.
grant execute on function app.compute_tab_totals(uuid) to service_role;

comment on function app.compute_tab_totals(uuid) is
  '0053: adds court_iqd for a tab charged to a live booking (SOW L131). Court '
  'time is outside subtotal_iqd (so percentage discounts apply to goods only) '
  'and outside the tax base (tax is per item group, L454-455).';

-- ---------------------------------------------------------------------------
-- 3. app.split_by_item — SOW L444, "split a bill by item or evenly".
--
--    Takes the assignment the cashier made on screen: an array of groups, each
--    an array of order_item ids. Returns one amount per group.
--
--    Every live line must be assigned exactly once. Partial coverage is refused
--    rather than quietly returning parts that do not sum to the bill — the
--    whole purpose of the call is that the parts add up.
--
--    Discount, tax and the court fee are allocated pro-rata by each group's
--    share of the subtotal, with the LARGEST REMAINDER going to the earliest
--    groups, so the amounts sum exactly to total_iqd. Same discipline as
--    app.split_evenly and @touch/core splitEvenly.
-- ---------------------------------------------------------------------------
create or replace function app.split_by_item(p_tab_id uuid, p_groups jsonb)
returns bigint[]
language plpgsql stable security definer set search_path = public as $split_item$
declare
  v_tab       tabs%rowtype;
  v_totals    record;
  v_n         int;
  v_assigned  int;
  v_live      int;
  v_dupes     int;
  v_orphans   int;
  v_amounts   bigint[];
  v_sum       bigint := 0;
  v_remainder bigint;
  i           int;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
    raise exception 'INVALID_SPLIT' using errcode = 'P0001',
      hint = 'expected an array of groups, each an array of order_item ids';
  end if;
  v_n := jsonb_array_length(p_groups);
  if v_n < 2 or v_n > 50 then
    raise exception 'INVALID_SPLIT_COUNT' using errcode = 'P0001',
      hint = 'a split has between 2 and 50 parts';
  end if;

  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The assignment, flattened once. A CTE rather than a temp table: this
  -- function is STABLE, and a temp table would also need a WHERE-less DELETE,
  -- which safeupdate refuses on every PostgREST connection (see 0052 and
  -- scripts/check-safe-update.mjs — the guard caught exactly that here).
  with assign as (
    select (elem #>> '{}')::uuid as order_item_id, g.ord - 1 as grp
      from jsonb_array_elements(p_groups) with ordinality as g(items, ord),
           jsonb_array_elements(g.items) as elem
  )
  select count(*),
         (select count(*) from (select order_item_id from assign
                                 group by order_item_id having count(*) > 1) d),
         (select count(*) from assign a
           where not exists (
             select 1 from order_items oi
             join orders o on o.id = oi.order_id
              where oi.id = a.order_item_id and o.tab_id = p_tab_id
                and o.status <> 'voided' and not oi.voided))
    into v_assigned, v_dupes, v_orphans
    from assign;

  if v_dupes > 0 then
    raise exception 'ITEM_ASSIGNED_TWICE' using errcode = 'P0001';
  end if;
  if v_orphans > 0 then
    raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001';
  end if;

  select count(*) into v_live
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  -- Partial coverage is refused rather than quietly returning parts that do
  -- not sum to the bill: the whole point of the call is that they add up.
  if v_assigned <> v_live then
    raise exception 'SPLIT_INCOMPLETE' using errcode = 'P0001',
      detail = format('%s of %s live items assigned', v_assigned, v_live);
  end if;

  select * into v_totals from app.compute_tab_totals(p_tab_id);

  -- Each group's floor share of the whole bill, by its portion of the goods
  -- subtotal. A zero subtotal (everything discounted away, or a court-only
  -- tab) splits evenly instead of dividing by zero.
  with assign as (
    select (elem #>> '{}')::uuid as order_item_id, g.ord - 1 as grp
      from jsonb_array_elements(p_groups) with ordinality as g(items, ord),
           jsonb_array_elements(g.items) as elem
  ),
  per_group as (
    select a.grp, coalesce(sum(oi.line_total_iqd), 0) as grp_subtotal
      from assign a
      join order_items oi on oi.id = a.order_item_id
     group by a.grp
  ),
  filled as (
    select g.ord - 1 as grp, coalesce(pg.grp_subtotal, 0) as grp_subtotal
      from jsonb_array_elements(p_groups) with ordinality as g(items, ord)
      left join per_group pg on pg.grp = g.ord - 1
  ),
  shares as (
    -- The window has to resolve BEFORE the aggregate: array_agg over a window
    -- expression is a grouping error (42803), not a subtlety worth being clever
    -- about.
    select f.grp,
           floor(
             case when sum(f.grp_subtotal) over () > 0
                  then v_totals.total_iqd::numeric * f.grp_subtotal / sum(f.grp_subtotal) over ()
                  else v_totals.total_iqd::numeric / v_n
             end
           )::bigint as share
      from filled f
  )
  select array_agg(s.share order by s.grp) into v_amounts from shares s;

  -- Largest remainder: the rounding shortfall goes to the earliest groups, so
  -- the parts sum EXACTLY to the bill. Same discipline as app.split_evenly.
  select coalesce(sum(x), 0) into v_sum from unnest(v_amounts) x;
  v_remainder := v_totals.total_iqd - v_sum;
  i := 1;
  while v_remainder > 0 and i <= v_n loop
    v_amounts[i] := v_amounts[i] + 1;
    v_remainder := v_remainder - 1;
    i := i + 1;
  end loop;

  return v_amounts;
end $split_item$;

revoke all on function app.split_by_item(uuid, jsonb) from public, anon;
grant execute on function app.split_by_item(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.record_drawer_open — SOW L449, "a cash drawer opening record".
--
--    Hardware control is explicitly OUT of scope (L474-475): the drawer is
--    opened by hand or by the printer's own pulse. What the contract asks for
--    is the RECORD, because an unexplained drawer opening between sales is the
--    thing a day-close reconciliation exists to surface.
--
--    Written straight to the audit log — it is an actor, an action, a reason
--    and a device, which is exactly what that table is for, and it is
--    append-only for everyone including managers (0005).
-- ---------------------------------------------------------------------------
create or replace function app.record_drawer_open(
  p_reason_code text,
  p_device_id   text default null,
  p_tab_id      uuid default null
) returns void
language plpgsql security definer set search_path = public as $drawer$
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'an opening with no sale attached needs a stated reason';
  end if;

  -- app.current_open_day() returns a scalar uuid, or null outside a day.
  -- A drawer opened with no day open is exactly the event worth recording, so
  -- it is logged against 'none' rather than refused.
  perform app.write_audit('drawer.open', 'day_sessions',
                          coalesce(app.current_open_day()::text, 'none'),
                          null,
                          jsonb_build_object('tab_id', p_tab_id),
                          p_reason_code, null, p_device_id);
end $drawer$;

revoke all on function app.record_drawer_open(text, text, uuid) from public, anon;
grant execute on function app.record_drawer_open(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.settle_tab — stamps court_iqd alongside the rest.
--
--    Reproduced verbatim from the live 0044 definition with ONE line added, so
--    the money path is not re-typed by hand. Without it `tabs` would carry a
--    breakdown that is short by the court fee while total_iqd already includes
--    it, and the settled bill would not reconcile against itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.settle_tab(p_tab_id uuid, p_method payment_method, p_tendered_iqd bigint DEFAULT NULL::bigint, p_amount_iqd bigint DEFAULT NULL::bigint, p_idempotency_key text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tab      tabs%rowtype;
  v_totals   record;
  v_paid     bigint;
  v_due      bigint;
  v_amount   bigint;
  v_change   bigint;
  v_payment  payments%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
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

  -- Compute once; re-stamp (identical inputs => identical stamp) so a
  -- split-payment sequence keeps one consistent bill.
  select * into v_totals from app.compute_tab_totals(p_tab_id);
  update tabs
     set subtotal_iqd = v_totals.subtotal_iqd,
         discount_iqd = v_totals.discount_iqd,
         tax_iqd      = v_totals.tax_iqd,
         -- 0053: the court fee for a tab charged to a booking. Stamped
         -- alongside the rest so the settled breakdown reconciles to the total
         -- rather than being short by the court.
         court_iqd    = v_totals.court_iqd,
         total_iqd    = v_totals.total_iqd
   where id = p_tab_id
   returning * into v_tab;

  -- Paid NET of refunds (0026): a refunded payment no longer counts toward the
  -- bill, so the refund-then-void unwind path can settle the remainder instead
  -- of dead-ending on ALREADY_PAID. Shared helper since 0037.
  v_paid := app.tab_net_paid(p_tab_id);
  v_due := v_tab.total_iqd - v_paid;
  if v_due <= 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
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
    v_change := p_tendered_iqd - v_amount;     -- exact: cash_rounding_iqd default 1 = off
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
    'tax_iqd', v_tab.tax_iqd, 'total_iqd', v_tab.total_iqd,
    'amount_iqd', v_amount, 'change_iqd', v_change,
    'remaining_iqd', greatest(v_tab.total_iqd - v_paid - v_amount, 0));
end $function$;
