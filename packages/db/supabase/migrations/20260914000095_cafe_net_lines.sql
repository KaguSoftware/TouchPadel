-- 0095_cafe_net_lines — ONE definition per cafe number.
--
-- The Management > Analytics critique of 2026-09-14 found that the cafe tab,
-- the Reports screen and the AI layer each defined "cafe revenue" their own
-- way: analytics_daily_sales summed payments minus refunds by payment day
-- (court fees included since 0053, so Cafe + Courts double-counted every
-- linked booking); item revenue was gross of every tab discount, promotion
-- and refund; margins used TODAY's cost for 90 days of history. This
-- migration states the money basis once and gives every consumer the same
-- two helpers to read it from.
--
-- MONEY BASIS (applies to every cafe money figure from here on)
--   clock        tabs.settled_at, bucketed by app.business_date. A tab's money
--                belongs to the business day it was settled on, and so do its
--                refunds, whenever they happen. Activity COUNTS (orders,
--                visits, waiter calls, guest/till orders) keep their own
--                event clocks (placed_at / raised_at).
--   per settled tab (merged donors excluded — merge_tabs voids them):
--     goods      = subtotal_iqd − discount_iqd          (the stamped values)
--     cafe_gross = total_iqd − court_iqd                 (0053/0068 rule)
--     refunds    = Σ refunds via payments.tab_id
--     cafe_net   = cafe_gross − refunds
--   per line     app.cafe_net_lines allocates the tab's discount and its
--                refunds down to lines so that, per tab,
--                  Σ net_iqd = goods − refunds
--                (tested identity; it holds whenever refunds do not exceed
--                the goods, i.e. unless a court fee is refunded — court-fee
--                refunds are not modelled and are a known limitation).
--   cost         order_items.cost_iqd, snapshotted when the line is added
--                (NULL = unknown, never 0), backfilled once from today's cost.
--
-- WHAT
--   1. order_items.cost_iqd + backfill; app.add_order_items snapshots it;
--      app.set_item_cost backfills NULL snapshots the FIRST time an item gets
--      a cost (the same decision the migration backfill makes, applied
--      forward, so has_cost does not stay false for months).
--   2. Indexes on tabs(settled_at) and tabs(reservation_id).
--   3. app.cafe_settled_tabs(ts_from, ts_to)  — THE cafe-revenue helper.
--   4. app.cafe_net_lines(tab_ids)            — THE allocation engine.
--   5. app.analytics_sales_lines: DROP + CREATE (returns-table change), same
--      signature; settled basis now means "tabs settled in the window".
--   6. analytics_sold_items / best_sellers / price_bands / item_margins /
--      hourly rebuilt on net figures; analytics_daily_sales rebuilt on the
--      helpers. analytics_promo stays GROSS by design: it answers "what did
--      the promo give away", which is a list-vs-paid question that tab-level
--      discounts and refunds would only blur. analytics_bought_together is a
--      behaviour count and is untouched.
--
-- Non-concurrent indexes: MIGRATION-RISK-ACCEPTED: single-venue tables of
-- thousands of rows; the build takes milliseconds.
--
-- covered by tests/analytics.test.ts, tests/reports.test.ts (0096),
-- tests/analytics-courts.test.ts (0097)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. order_items.cost_iqd — the unit cost at the moment the line was added.
-- ---------------------------------------------------------------------------
alter table order_items add column if not exists cost_iqd bigint;

comment on column order_items.cost_iqd is
  '0095: unit cost snapshot taken by app.add_order_items when the line was added (menu_item_costs first, v_item_cogs as the fallback). NULL = unknown, never 0. Rows older than 0095 were backfilled from the cost current at migration time.';

-- Backfill: the owner-entered cost first, the recipe cost as the fallback.
update order_items oi
   set cost_iqd = c.cost_iqd
  from menu_item_costs c
 where c.item_id = oi.menu_item_id
   and oi.cost_iqd is null;

update order_items oi
   set cost_iqd = round(vc.cogs_iqd)::bigint
  from v_item_cogs vc
 where vc.variant_id = oi.variant_id
   and vc.cogs_iqd is not null
   and oi.cost_iqd is null;

-- Cost of a variant right now: owner cost first, recipe cost second, NULL when
-- neither exists. The one lookup add_order_items and set_item_cost share.
create or replace function app.current_unit_cost(p_item_id uuid, p_variant_id uuid)
returns bigint
language sql stable security definer set search_path = public as $fn_current_unit_cost_0095$
  select coalesce(
           (select c.cost_iqd::bigint from menu_item_costs c where c.item_id = p_item_id),
           (select round(vc.cogs_iqd)::bigint from v_item_cogs vc where vc.variant_id = p_variant_id))
$fn_current_unit_cost_0095$;

revoke all on function app.current_unit_cost(uuid, uuid) from public, anon, authenticated;
grant execute on function app.current_unit_cost(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 1b. app.add_order_items — 0041 body verbatim + the cost snapshot. This is
--     the single line inserter (create_guest_order and till_add_items both
--     call it), so one line here covers every order.
-- ---------------------------------------------------------------------------
create or replace function app.add_order_items(p_order_id uuid, p_items jsonb)
returns bigint
language plpgsql security definer set search_path = public as $add_0095$
declare
  v_item      jsonb;
  v_mod       jsonb;
  v_variant   menu_item_variants%rowtype;
  v_mi        menu_items%rowtype;
  v_modifier  modifiers%rowtype;
  v_qty       int;
  v_mqty      int;
  v_list      bigint;
  v_unit      bigint;
  v_mods      bigint;
  v_line      bigint;
  v_cost      bigint;
  v_oi_id     uuid;
  v_total     bigint := 0;
  v_hero_mode text;
  v_feat      uuid;
  v_pct       int;
  v_featured  boolean;
  v_chosen    uuid[];
  v_active    uuid[];
  v_bad_mod   uuid;
  v_bad_group uuid;
  v_today     date;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  v_today := app.business_date(now());         -- 0041: once per order, not per line

  -- Featured promo state (0029 settings), read ONCE per call so every line of
  -- this order sees the same promo — a mid-order settings change cannot split
  -- one order across two prices.
  v_hero_mode := app.cafe_setting_text('hero_mode');
  begin
    v_feat := nullif(nullif(app.cafe_setting_text('featured_item_id'), ''), 'null')::uuid;
  exception when invalid_text_representation then
    v_feat := null;                            -- a malformed setting must never block ordering
  end;
  v_pct := coalesce(app.cafe_setting_int('featured_discount_pct'), 0);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(v_item->>'qty', '')::int, 1);
    if v_qty < 1 or v_qty > 99 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;

    select * into v_variant from menu_item_variants
     where id = (v_item->>'variant_id')::uuid;
    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001',
        detail = v_item->>'variant_id';
    end if;

    select * into v_mi from menu_items where id = v_variant.item_id;
    if not v_mi.is_active
       or v_mi.unavailable_on = v_today                    -- 0041: was current_date
       or v_mi.sold_out
       or not exists (select 1 from menu_categories c where c.id = v_mi.category_id and c.is_active) then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001',
        detail = v_mi.id::text;
    end if;

    v_list := v_variant.price_iqd;             -- SNAPSHOT: server price, never client-supplied
    -- 0095: SNAPSHOT the unit cost too, so margins read the cost of the day
    -- the line was sold, not the cost of the day the report is opened.
    v_cost := app.current_unit_cost(v_mi.id, v_variant.id);
    v_featured := coalesce(v_hero_mode = 'featured' and v_feat = v_mi.id and v_pct > 0, false);
    if v_featured then
      v_unit := app.apply_pct_discount(v_list, v_pct);
    else
      v_unit := v_list;
    end if;
    v_mods := 0;

    insert into order_items (order_id, menu_item_id, variant_id, qty,
                             list_price_iqd, unit_price_iqd, line_total_iqd, notes,
                             discount_pct, discount_source, cost_iqd)
    values (p_order_id, v_mi.id, v_variant.id, v_qty,
            v_list, v_unit, 0, nullif(v_item->>'notes', ''),
            case when v_featured then v_pct else 0 end,
            case when v_featured then 'featured' else null end,
            v_cost)
    returning id into v_oi_id;

    for v_mod in select * from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb)) loop
      v_mqty := coalesce(nullif(v_mod->>'qty', '')::int, 1);
      if v_mqty < 1 or v_mqty > 9 then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;

      -- Existence + is_active here; whether its group is linked OR revealed for
      -- this line is decided below, once every choice of the line is known.
      select m.* into v_modifier
        from modifiers m
       where m.id = (v_mod->>'modifier_id')::uuid and m.is_active;
      if not found then
        raise exception 'MODIFIER_INVALID' using errcode = 'P0001',
          detail = v_mod->>'modifier_id';
      end if;

      insert into order_item_modifiers (order_item_id, modifier_id, qty, price_delta_iqd)
      values (v_oi_id, v_modifier.id, v_mqty, v_modifier.price_delta_iqd);
      -- PK (order_item_id, modifier_id) raises on a duplicate modifier in the payload.

      v_mods := v_mods + v_modifier.price_delta_iqd * v_mqty;
    end loop;

    -- Active groups for this line (0028): linked groups UNION groups revealed
    -- by a chosen modifier whose own group is linked (depth is 1 by invariant).
    select coalesce(array_agg(oim.modifier_id), '{}'::uuid[]) into v_chosen
      from order_item_modifiers oim
     where oim.order_item_id = v_oi_id;
    v_active := array(select ag from app.item_active_groups(v_mi.id, v_chosen) as ag);

    -- Any chosen modifier outside the active set is invalid for this line.
    select m.id into v_bad_mod
      from order_item_modifiers oim
      join modifiers m on m.id = oim.modifier_id
     where oim.order_item_id = v_oi_id
       and m.group_id <> all (v_active)
     order by m.sort_order, m.id
     limit 1;
    if v_bad_mod is not null then
      raise exception 'MODIFIER_INVALID' using errcode = 'P0001',
        detail = v_bad_mod::text,
        hint = 'modifier group is neither linked to the item nor revealed by a chosen option';
    end if;

    -- min/max per ACTIVE group (distinct choices count; a doubled modifier is one choice).
    select g.id into v_bad_group
      from modifier_groups g
      left join lateral (
        select count(*) as chosen
          from order_item_modifiers oim
          join modifiers m2 on m2.id = oim.modifier_id
         where oim.order_item_id = v_oi_id and m2.group_id = g.id
      ) c on true
     where g.id = any (v_active)
       and (c.chosen < g.min_select or c.chosen > g.max_select)
     order by g.id
     limit 1;
    if v_bad_group is not null then
      raise exception 'MODIFIER_SELECTION' using errcode = 'P0001',
        detail = v_bad_group::text,
        hint = 'modifier choices violate a group min/max';
    end if;

    v_line := (v_unit + v_mods) * v_qty;
    update order_items set line_total_iqd = v_line where id = v_oi_id;
    v_total := v_total + v_line;
  end loop;

  return v_total;
end $add_0095$;

revoke all on function app.add_order_items(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1c. app.set_item_cost — 0027 body + backfill of NULL snapshots the FIRST
--     time an item is given a cost. Later cost changes never touch history:
--     a line sold under the old cost keeps it.
-- ---------------------------------------------------------------------------
create or replace function app.set_item_cost(
  p_item_id  uuid,
  p_cost_iqd bigint
) returns void
language plpgsql security definer set search_path = public as $fn_set_item_cost_0095$
declare
  v_before jsonb;
  v_row    menu_item_costs%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_cost_iqd is not null and p_cost_iqd < 0 then
    raise exception 'INVALID_COST' using errcode = 'P0001';
  end if;
  if not exists (select 1 from menu_items where id = p_item_id) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  select to_jsonb(c) into v_before from menu_item_costs c where c.item_id = p_item_id for update;

  if p_cost_iqd is null then
    delete from menu_item_costs where item_id = p_item_id;
    perform app.write_audit('menu.item.cost', 'menu_item_costs', p_item_id::text,
                            v_before, null);
  else
    insert into menu_item_costs (item_id, cost_iqd, updated_at, updated_by)
    values (p_item_id, p_cost_iqd, now(), auth.uid())
    on conflict (item_id) do update
      set cost_iqd = excluded.cost_iqd, updated_at = now(), updated_by = auth.uid()
    returning * into v_row;
    -- 0095: a first cost fills the lines that had none (same rule as the
    -- migration backfill). A CHANGED cost leaves history alone.
    if v_before is null then
      update order_items oi
         set cost_iqd = p_cost_iqd
       where oi.menu_item_id = p_item_id
         and oi.cost_iqd is null;
    end if;
    perform app.write_audit('menu.item.cost', 'menu_item_costs', p_item_id::text,
                            v_before, to_jsonb(v_row));
  end if;
end $fn_set_item_cost_0095$;

revoke all on function app.set_item_cost(uuid, bigint) from public, anon;
grant execute on function app.set_item_cost(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Indexes — the settle-day window and the reservation link.
--    MIGRATION-RISK-ACCEPTED: single-venue tables of thousands of rows.
-- ---------------------------------------------------------------------------
create index if not exists tabs_settled_at_idx on tabs (settled_at) where status = 'settled';
create index if not exists tabs_reservation_idx on tabs (reservation_id) where reservation_id is not null;

-- ---------------------------------------------------------------------------
-- 3. app.cafe_settled_tabs — THE shared cafe-revenue helper. One row per
--    settled, non-merged tab settled in [p_ts_from, p_ts_to); NULL bounds
--    mean unbounded (the courts join reads a booking's tab whenever it was
--    settled). Service role only.
-- ---------------------------------------------------------------------------
create or replace function app.cafe_settled_tabs(
  p_ts_from timestamptz default null,
  p_ts_to   timestamptz default null
) returns table (
  tab_id          uuid,
  settled_at      timestamptz,
  reservation_id  uuid,
  subtotal_iqd    bigint,
  discount_iqd    bigint,
  tax_iqd         bigint,
  court_iqd       bigint,
  total_iqd       bigint,
  goods_iqd       bigint,
  cafe_gross_iqd  bigint,
  refunds_iqd     bigint,
  cafe_net_iqd    bigint
) language sql stable security definer set search_path = public as $fn_cafe_settled_tabs_0095$
  select t.id,
         t.settled_at,
         t.reservation_id,
         coalesce(t.subtotal_iqd, 0)::bigint,
         coalesce(t.discount_iqd, 0)::bigint,
         coalesce(t.tax_iqd, 0)::bigint,
         coalesce(t.court_iqd, 0)::bigint,
         coalesce(t.total_iqd, 0)::bigint,
         (coalesce(t.subtotal_iqd, 0) - coalesce(t.discount_iqd, 0))::bigint             as goods_iqd,
         (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0))::bigint                   as cafe_gross_iqd,
         coalesce(r.refunds_iqd, 0)::bigint                                              as refunds_iqd,
         (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0) - coalesce(r.refunds_iqd, 0))::bigint as cafe_net_iqd
    from tabs t
    left join lateral (
      select sum(rf.amount_iqd) as refunds_iqd
        from refunds rf
        join payments p on p.id = rf.payment_id
       where p.tab_id = t.id
    ) r on true
   where t.status = 'settled'
     and t.merged_into_tab_id is null
     and t.settled_at is not null
     and (p_ts_from is null or t.settled_at >= p_ts_from)
     and (p_ts_to   is null or t.settled_at <  p_ts_to)
$fn_cafe_settled_tabs_0095$;

revoke all on function app.cafe_settled_tabs(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function app.cafe_settled_tabs(timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. app.cafe_net_lines — the allocation engine, per live line of the given
--    tabs. Mirrors app.compute_tab_totals (0053):
--      line_discount  = the line's own adjustments, capped at its gross
--      tab_discount   = the whole-tab discount, allocated pro-rata by each
--                       line's post-line-discount amount, largest remainder
--                       (the split_by_item discipline) so the parts sum
--                       EXACTLY. On a settled tab the total to allocate is
--                       derived from the STAMPED goods, so Σ (gross − line −
--                       tab) = subtotal_iqd − discount_iqd to the dinar; on
--                       an open tab it is the adjustment rows themselves.
--      refund_iqd     = itemised refunds (refund_items) allocated across the
--                       refund's own lines by refunded units × unit net,
--                       blanket refunds across every line by net, both by
--                       largest remainder; capped at the line's net.
--      refund_qty     = itemised units only (a blanket refund returns money,
--                       not stock)
--      net_iqd        = gross − line_discount − tab_discount − refund_iqd
--      cost_total_iqd = cost_iqd × (qty − refund_qty), NULL without a snapshot
--    Service role only.
-- ---------------------------------------------------------------------------
create or replace function app.cafe_net_lines(p_tab_ids uuid[])
returns table (
  tab_id            uuid,
  order_id          uuid,
  order_item_id     uuid,
  menu_item_id      uuid,
  variant_id        uuid,
  qty               int,
  gross_iqd         bigint,
  line_discount_iqd bigint,
  tab_discount_iqd  bigint,
  refund_qty        int,
  refund_iqd        bigint,
  net_iqd           bigint,
  cost_iqd          bigint,
  cost_total_iqd    bigint
) language sql stable security definer set search_path = public as $fn_cafe_net_lines_0095$
  with
  lines as (
    select o.tab_id, o.id as order_id, oi.id as order_item_id, oi.menu_item_id, oi.variant_id, oi.qty,
           oi.line_total_iqd::bigint as gross, oi.cost_iqd
      from orders o
      join order_items oi on oi.order_id = o.id
     where o.tab_id = any (p_tab_ids)
       and o.status <> 'voided'
       and not oi.voided),
  ld as (
    select a.order_item_id, sum(a.amount_iqd)::bigint as amt
      from tab_adjustments a
     where a.tab_id = any (p_tab_ids)
       and a.order_item_id is not null
       and a.kind in ('discount_percent','discount_amount')
     group by a.order_item_id),
  l1 as (
    select l.*,
           least(coalesce(ld.amt, 0), l.gross)           as line_disc,
           l.gross - least(coalesce(ld.amt, 0), l.gross) as after_line
      from lines l
      left join ld on ld.order_item_id = l.order_item_id),
  sums as (
    select l1.tab_id, sum(l1.after_line)::bigint as after_sum from l1 group by l1.tab_id),
  wholetab as (
    select a.tab_id, sum(a.amount_iqd)::bigint as amt
      from tab_adjustments a
     where a.tab_id = any (p_tab_ids)
       and a.order_item_id is null
       and a.kind in ('discount_percent','discount_amount')
     group by a.tab_id),
  tabd as (
    select t.id as tab_id,
           coalesce(s.after_sum, 0) as after_sum,
           least(
             case when t.status = 'settled' and t.subtotal_iqd is not null
                  then greatest(coalesce(s.after_sum, 0) - (coalesce(t.subtotal_iqd, 0) - coalesce(t.discount_iqd, 0)), 0)
                  else coalesce(w.amt, 0) end,
             coalesce(s.after_sum, 0))::bigint as alloc
      from tabs t
      left join sums s     on s.tab_id = t.id
      left join wholetab w on w.tab_id = t.id
     where t.id = any (p_tab_ids)),
  l2 as (
    select l1.*, td.alloc,
           case when td.after_sum > 0 then floor(td.alloc::numeric * l1.after_line / td.after_sum) else 0 end::bigint as tab_floor,
           case when td.after_sum > 0 then (td.alloc::numeric * l1.after_line / td.after_sum) - floor(td.alloc::numeric * l1.after_line / td.after_sum) else 0 end as tab_frac
      from l1
      join tabd td on td.tab_id = l1.tab_id),
  l3 as (
    select l2.*,
           (l2.tab_floor
            + case when row_number() over (partition by l2.tab_id order by l2.tab_frac desc, l2.order_item_id)
                        <= l2.alloc - sum(l2.tab_floor) over (partition by l2.tab_id)
                   then 1 else 0 end)::bigint as tab_disc
      from l2),
  l4 as (
    select l3.*, (l3.after_line - l3.tab_disc)::bigint as pre from l3),
  rf as (
    select r.id as refund_id, p.tab_id, r.amount_iqd::bigint as amount,
           exists (select 1 from refund_items ri where ri.refund_id = r.id) as itemised
      from refunds r
      join payments p on p.id = r.payment_id
     where p.tab_id = any (p_tab_ids)),
  rw as (
    select rf.refund_id, rf.tab_id, rf.amount, l4.order_item_id,
           case when rf.itemised
                then least(ri.qty, l4.qty)::numeric * l4.pre / nullif(l4.qty, 0)
                else l4.pre::numeric end as w,
           case when rf.itemised then least(ri.qty, l4.qty) else 0 end as rqty
      from rf
      join l4 on l4.tab_id = rf.tab_id
      left join refund_items ri on ri.refund_id = rf.refund_id and ri.order_item_id = l4.order_item_id
     where (not rf.itemised) or ri.order_item_id is not null),
  rw2 as (
    select rw.*,
           coalesce(sum(rw.w) over (partition by rw.refund_id), 0) as wsum,
           count(*) over (partition by rw.refund_id)               as n
      from rw),
  rw3 as (
    -- A refund whose lines net to nothing (everything discounted away) splits evenly.
    select rw2.refund_id, rw2.order_item_id, rw2.amount, rw2.rqty,
           case when rw2.wsum > 0 then rw2.w / rw2.wsum else 1.0 / rw2.n end as share
      from rw2),
  rw4 as (
    select rw3.*,
           floor(rw3.amount * rw3.share)::bigint                     as rfloor,
           rw3.amount * rw3.share - floor(rw3.amount * rw3.share)    as rfrac
      from rw3),
  rw5 as (
    select rw4.order_item_id, rw4.rqty,
           rw4.rfloor
           + case when row_number() over (partition by rw4.refund_id order by rw4.rfrac desc, rw4.order_item_id)
                       <= rw4.amount - sum(rw4.rfloor) over (partition by rw4.refund_id)
                  then 1 else 0 end as ralloc
      from rw4),
  ragg as (
    select rw5.order_item_id, sum(rw5.ralloc)::bigint as refund_amt, sum(rw5.rqty)::int as refund_qty
      from rw5 group by rw5.order_item_id)
  select l4.tab_id, l4.order_id, l4.order_item_id, l4.menu_item_id, l4.variant_id, l4.qty,
         l4.gross,
         l4.line_disc::bigint,
         l4.tab_disc,
         least(coalesce(ra.refund_qty, 0), l4.qty)::int                  as refund_qty,
         least(coalesce(ra.refund_amt, 0), l4.pre)::bigint               as refund_iqd,
         (l4.pre - least(coalesce(ra.refund_amt, 0), l4.pre))::bigint    as net_iqd,
         l4.cost_iqd,
         case when l4.cost_iqd is not null
              then (l4.cost_iqd * (l4.qty - least(coalesce(ra.refund_qty, 0), l4.qty)))::bigint end as cost_total_iqd
    from l4
    left join ragg ra on ra.order_item_id = l4.order_item_id
$fn_cafe_net_lines_0095$;

revoke all on function app.cafe_net_lines(uuid[]) from public, anon, authenticated;
grant execute on function app.cafe_net_lines(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.analytics_sales_lines — DROP + CREATE (the returns table grows).
--    Same signature. Basis:
--      'settled'  lines of tabs SETTLED in the window (money clock); their
--                 business day is the settle day
--      'served'   lines of orders PLACED in the window whose order is served
--                 or whose tab is settled (live "today so far"); business day
--                 of placed_at
--      'all'      every non-voided line of an order placed in the window
--                 (behaviour, not money; bought_together / promo)
--    Money columns come from app.cafe_net_lines; the promo gap columns keep
--    their 0034 meaning (list − paid on featured lines).
-- ---------------------------------------------------------------------------
drop function if exists app.analytics_sales_lines(text, timestamptz, timestamptz, text, int);

create function app.analytics_sales_lines(
  p_basis      text,
  p_ts_from    timestamptz,
  p_ts_to      timestamptz,
  p_tz         text,
  p_start_hour int
) returns table (
  business_date     date,
  order_id          uuid,
  tab_id            uuid,
  guest_session_id  uuid,
  source            order_source,
  placed_at         timestamptz,
  settled_at        timestamptz,
  order_item_id     uuid,
  menu_item_id      uuid,
  variant_id        uuid,
  qty               int,
  net_qty           int,
  list_price_iqd    bigint,
  unit_price_iqd    bigint,
  line_total_iqd    bigint,
  list_line_iqd     bigint,
  discount_line_iqd bigint,
  discount_source   text,
  line_adj_iqd      bigint,
  tab_adj_iqd       bigint,
  refund_qty        int,
  refund_iqd        bigint,
  net_line_iqd      bigint,
  cost_iqd          bigint,
  cost_total_iqd    bigint
) language sql stable security definer set search_path = public as $fn_analytics_sales_lines_0095$
  with
  picked_tabs as (
    select t.id as tab_id, t.settled_at
      from tabs t
     where p_basis = 'settled'
       and t.status = 'settled'
       and t.merged_into_tab_id is null
       and t.settled_at >= p_ts_from and t.settled_at < p_ts_to
    union
    select o.tab_id, t.settled_at
      from orders o
      join tabs t on t.id = o.tab_id
     where p_basis in ('served', 'all')
       and o.placed_at >= p_ts_from and o.placed_at < p_ts_to
       and o.status <> 'voided'
       and case p_basis
             when 'served' then (o.status = 'served' or t.status = 'settled')
             else true
           end),
  nl as (
    select * from app.cafe_net_lines((select coalesce(array_agg(pt.tab_id), '{}'::uuid[]) from picked_tabs pt)))
  select case when p_basis = 'settled'
              then app.business_date(pt.settled_at, p_tz, p_start_hour)
              else app.business_date(o.placed_at, p_tz, p_start_hour) end,
         o.id, o.tab_id, o.guest_session_id, o.source, o.placed_at, pt.settled_at,
         oi.id, oi.menu_item_id, oi.variant_id, oi.qty,
         (oi.qty - nl.refund_qty)::int,
         coalesce(oi.list_price_iqd, oi.unit_price_iqd)::bigint,
         oi.unit_price_iqd::bigint,
         oi.line_total_iqd::bigint,
         (oi.line_total_iqd + g.promo_gap)::bigint,
         g.promo_gap::bigint,
         oi.discount_source,
         nl.line_discount_iqd,
         nl.tab_discount_iqd,
         nl.refund_qty,
         nl.refund_iqd,
         nl.net_iqd,
         nl.cost_iqd,
         nl.cost_total_iqd
    from picked_tabs pt
    join orders o       on o.tab_id = pt.tab_id
    join order_items oi on oi.order_id = o.id
    join nl             on nl.order_item_id = oi.id
    cross join lateral (
      select case
               when oi.discount_pct > 0 and oi.list_price_iqd is not null
               then (oi.list_price_iqd
                     - (oi.list_price_iqd * (100 - oi.discount_pct) + 50) / 100) * oi.qty
               else 0
             end as promo_gap
    ) g
   where o.status <> 'voided'
     and not oi.voided
     -- On the event bases only the orders in the window count; on the settle
     -- basis every line of the settled tab belongs to its settle day.
     and (p_basis = 'settled'
          or (o.placed_at >= p_ts_from and o.placed_at < p_ts_to
              and case p_basis
                    when 'served' then (o.status = 'served' or exists (select 1 from tabs t where t.id = o.tab_id and t.status = 'settled'))
                    when 'all'    then true
                    else false
                  end))
$fn_analytics_sales_lines_0095$;

revoke all on function app.analytics_sales_lines(text, timestamptz, timestamptz, text, int) from public, anon, authenticated;
grant execute on function app.analytics_sales_lines(text, timestamptz, timestamptz, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The 0034 consumers, on net figures.
-- ---------------------------------------------------------------------------

-- 6.1 analytics_daily_sales — one row per business day with ANY activity.
--     Money = the settled-tab helper on the SETTLE day; counts keep their
--     event clocks. Keys:
--       revenue_iqd        cafe net (the key is kept; the meaning is now net)
--       cafe_gross_iqd     total − court fee
--       cafe_net_iqd       cafe_gross − refunds
--       goods_iqd          subtotal − discount
--       court_fees_iqd     Σ court_iqd (court money on cafe tabs, for reconciliation)
--       refunds_iqd        Σ refunds of the tabs settled that day
--       item_refunds_iqd   the part of those refunds that landed on lines
--       discount_iqd       Σ stamped tabs.discount_iqd
--       promo_discount_iqd featured-promo gap on settled lines
--       cash_iqd/card_iqd  payments of the tabs settled that day, minus their
--                          refunds, by method: cash + card = gross + court − refunds
--       items_qty          units net of itemised refunds
create or replace function app.analytics_daily_sales(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_daily_sales_0095$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  st as (
    select app.business_date(s.settled_at, v_b.tz, v_b.start_hour) as d, s.*
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s),
  money as (
    select st.d,
           count(*)                                as tabs_settled,
           sum(st.cafe_gross_iqd)::bigint          as cafe_gross_iqd,
           sum(st.cafe_net_iqd)::bigint            as cafe_net_iqd,
           sum(st.goods_iqd)::bigint               as goods_iqd,
           sum(st.court_iqd)::bigint               as court_fees_iqd,
           sum(st.refunds_iqd)::bigint             as refunds_iqd,
           sum(st.discount_iqd)::bigint            as discount_iqd,
           sum(st.tax_iqd)::bigint                 as tax_iqd
      from st
     group by st.d),
  pay as (
    -- Refunds are summed per payment FIRST: a payment with two refund rows
    -- must not be counted twice.
    select st.d,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint   as cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint   as card_iqd,
           coalesce(sum(r.refunded) filter (where p.method = 'cash'), 0)::bigint     as cash_ref_iqd,
           coalesce(sum(r.refunded) filter (where p.method = 'card'), 0)::bigint     as card_ref_iqd
      from st
      join payments p on p.tab_id = st.tab_id
      left join lateral (select sum(rf.amount_iqd) as refunded from refunds rf where rf.payment_id = p.id) r on true
     group by st.d),
  lines as (
    select l.business_date as d,
           sum(l.net_qty)::bigint             as items_qty,
           sum(l.refund_iqd)::bigint          as item_refunds_iqd,
           sum(l.discount_line_iqd)::bigint   as promo_discount_iqd
      from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
     group by l.business_date),
  ord as (
    select app.business_date(o.placed_at, v_b.tz, v_b.start_hour) as d,
           count(*)                                              as orders,
           count(*) filter (where o.source = 'guest_web')        as guest_orders,
           count(*) filter (where o.source = 'till')             as till_orders,
           count(distinct o.tab_id)                              as visits
      from orders o
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
     group by 1),
  calls as (
    select app.business_date(w.raised_at, v_b.tz, v_b.start_hour) as d,
           count(*) as waiter_calls
      from waiter_calls w
     where w.raised_at >= v_b.ts_from and w.raised_at < v_b.ts_to
     group by 1),
  days as (
    select d from money
    union select d from ord
    union select d from calls)
  select coalesce(jsonb_agg(jsonb_build_object(
           'business_date',      days.d,
           'revenue_iqd',        coalesce(money.cafe_net_iqd, 0),
           'cafe_gross_iqd',     coalesce(money.cafe_gross_iqd, 0),
           'cafe_net_iqd',       coalesce(money.cafe_net_iqd, 0),
           'goods_iqd',          coalesce(money.goods_iqd, 0),
           'court_fees_iqd',     coalesce(money.court_fees_iqd, 0),
           'refunds_iqd',        coalesce(money.refunds_iqd, 0),
           'item_refunds_iqd',   coalesce(lines.item_refunds_iqd, 0),
           'promo_discount_iqd', coalesce(lines.promo_discount_iqd, 0),
           'cash_iqd',           coalesce(pay.cash_iqd, 0) - coalesce(pay.cash_ref_iqd, 0),
           'card_iqd',           coalesce(pay.card_iqd, 0) - coalesce(pay.card_ref_iqd, 0),
           'tabs_settled',       coalesce(money.tabs_settled, 0),
           'orders',             coalesce(ord.orders, 0),
           'items_qty',          coalesce(lines.items_qty, 0),
           'discount_iqd',       coalesce(money.discount_iqd, 0),
           'tax_iqd',            coalesce(money.tax_iqd, 0),
           'visits',             coalesce(ord.visits, 0),
           'guest_orders',       coalesce(ord.guest_orders, 0),
           'till_orders',        coalesce(ord.till_orders, 0),
           'waiter_calls',       coalesce(calls.waiter_calls, 0)
         ) order by days.d), '[]'::jsonb)
    into v_out
    from days
    left join money on money.d = days.d
    left join pay   on pay.d   = days.d
    left join lines on lines.d = days.d
    left join ord   on ord.d   = days.d
    left join calls on calls.d = days.d;

  return v_out;
end $fn_analytics_daily_sales_0095$;

-- 6.2 analytics_sold_items — day × item, NET: qty net of itemised refunds,
--     revenue after every discount and refund. discount_iqd = promo gap +
--     allocated tab/line adjustments; list_revenue = revenue + discount + refund.
create or replace function app.analytics_sold_items(
  p_from  date,
  p_to    date,
  p_basis text default 'settled'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_sold_items_0095$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  perform app.analytics_assert_basis(p_basis);
  v_ex := app.analytics_excluded();

  select coalesce(jsonb_agg(jsonb_build_object(
           'business_date',    s.business_date,
           'menu_item_id',     s.menu_item_id,
           'name_en',          mi.name_en,
           'name_ar',          mi.name_ar,
           'category_id',      mi.category_id,
           'qty',              s.qty,
           'revenue_iqd',      s.revenue_iqd,
           'list_revenue_iqd', s.list_revenue_iqd,
           'discount_iqd',     s.discount_iqd,
           'refund_iqd',       s.refund_iqd
         ) order by s.business_date, s.qty desc, s.revenue_iqd desc, mi.name_en), '[]'::jsonb)
    into v_out
    from (
      select l.business_date, l.menu_item_id,
             sum(l.net_qty)::bigint                                                  as qty,
             sum(l.net_line_iqd)::bigint                                             as revenue_iqd,
             sum(l.list_line_iqd)::bigint                                            as list_revenue_iqd,
             sum(l.discount_line_iqd + l.line_adj_iqd + l.tab_adj_iqd)::bigint       as discount_iqd,
             sum(l.refund_iqd)::bigint                                               as refund_iqd
        from app.analytics_sales_lines(p_basis, v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
       where l.menu_item_id <> all (v_ex)
       group by l.business_date, l.menu_item_id
    ) s
    join menu_items mi on mi.id = s.menu_item_id;

  return v_out;
end $fn_analytics_sold_items_0095$;

-- 6.3 analytics_best_sellers — top p_limit items by NET units.
create or replace function app.analytics_best_sellers(
  p_from  date,
  p_to    date,
  p_limit int  default 20,
  p_basis text default 'settled'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_best_sellers_0095$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  perform app.analytics_assert_basis(p_basis);
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_limit', hint = 'p_limit must be between 1 and 500';
  end if;
  v_ex := app.analytics_excluded();

  with
  agg as (
    select l.menu_item_id,
           sum(l.net_qty)::bigint       as qty,
           sum(l.net_line_iqd)::bigint  as revenue_iqd,
           count(distinct l.order_id)   as orders
      from app.analytics_sales_lines(p_basis, v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
     where l.menu_item_id <> all (v_ex)
     group by l.menu_item_id),
  tot as (
    select coalesce(sum(agg.qty), 0)::bigint as total_qty from agg),
  top as (
    select agg.menu_item_id, agg.qty, agg.revenue_iqd, agg.orders,
           mi.name_en, mi.name_ar, mi.category_id
      from agg
      join menu_items mi on mi.id = agg.menu_item_id
     order by agg.qty desc, agg.revenue_iqd desc, mi.name_en, agg.menu_item_id
     limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object(
           'menu_item_id', top.menu_item_id,
           'name_en',      top.name_en,
           'name_ar',      top.name_ar,
           'category_id',  top.category_id,
           'qty',          top.qty,
           'revenue_iqd',  top.revenue_iqd,
           'share_pct',    case when tot.total_qty > 0
                                then round(top.qty * 100.0 / tot.total_qty, 1)
                                else 0 end,
           'orders',       top.orders
         ) order by top.qty desc, top.revenue_iqd desc, top.name_en, top.menu_item_id), '[]'::jsonb)
    into v_out
    from top
    cross join tot;

  return v_out;
end $fn_analytics_best_sellers_0095$;

-- 6.4 analytics_item_margins — NET revenue vs the cost SNAPSHOTTED on each
--     line (cost_basis 'line_snapshot'). has_cost is true only when every
--     kept unit of the item carries a snapshot; cost_iqd is then the average
--     unit cost of those units, cost_total_iqd their sum, margin = revenue −
--     cost_total. costed_qty says how many units carried a snapshot, so a
--     partially costed item is visible rather than guessed.
create or replace function app.analytics_item_margins(
  p_from  date,
  p_to    date,
  p_basis text default 'settled'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_item_margins_0095$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  perform app.analytics_assert_basis(p_basis);
  v_ex := app.analytics_excluded();

  with
  agg as (
    select l.menu_item_id,
           sum(l.net_qty)::bigint                                                  as qty,
           sum(l.net_line_iqd)::bigint                                             as revenue_iqd,
           sum(l.net_qty) filter (where l.cost_iqd is not null)::bigint            as costed_qty,
           sum(l.cost_total_iqd) filter (where l.cost_iqd is not null)::bigint     as cost_total_iqd,
           bool_and(l.cost_iqd is not null)                                        as has_cost
      from app.analytics_sales_lines(p_basis, v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
     where l.menu_item_id <> all (v_ex)
     group by l.menu_item_id),
  j as (
    select agg.menu_item_id, mi.name_en, mi.name_ar, mi.category_id,
           agg.qty, agg.revenue_iqd, agg.has_cost, coalesce(agg.costed_qty, 0) as costed_qty,
           case when agg.has_cost then agg.cost_total_iqd end                                       as cost_total_iqd,
           case when agg.has_cost and agg.qty > 0 then round(agg.cost_total_iqd::numeric / agg.qty)::bigint end as cost_iqd,
           case when agg.has_cost then (agg.revenue_iqd - agg.cost_total_iqd)::bigint end            as margin_iqd
      from agg
      join menu_items mi on mi.id = agg.menu_item_id),
  cov as (
    select count(*)::int                                                                  as items_total,
           count(*) filter (where j.has_cost)::int                                        as items_with_cost,
           coalesce(sum(j.revenue_iqd), 0)::bigint                                        as rev_total,
           coalesce(sum(j.revenue_iqd) filter (where j.has_cost), 0)::bigint              as rev_with_cost
      from j)
  select jsonb_build_object(
           'basis',      p_basis,
           'cost_basis', 'line_snapshot',
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'menu_item_id',   j.menu_item_id,
                      'name_en',        j.name_en,
                      'name_ar',        j.name_ar,
                      'category_id',    j.category_id,
                      'qty',            j.qty,
                      'costed_qty',     j.costed_qty,
                      'revenue_iqd',    j.revenue_iqd,
                      'avg_price_iqd',  case when j.qty > 0
                                             then round(j.revenue_iqd::numeric / j.qty)::bigint end,
                      'cost_iqd',       j.cost_iqd,
                      'cost_total_iqd', j.cost_total_iqd,
                      'margin_iqd',     j.margin_iqd,
                      'margin_pct',     case when j.has_cost and j.revenue_iqd > 0
                                             then round(j.margin_iqd * 100.0 / j.revenue_iqd, 1) end,
                      'has_cost',       j.has_cost
                    ) order by j.margin_iqd desc nulls last, j.revenue_iqd desc, j.name_en)
               from j), '[]'::jsonb),
           'coverage', (
             select jsonb_build_object(
                      'revenue_with_cost_pct', case when cov.rev_total > 0
                                                    then round(cov.rev_with_cost * 100.0 / cov.rev_total, 1)
                                                    else 0 end,
                      'items_with_cost',       cov.items_with_cost,
                      'items_total',           cov.items_total)
               from cov))
    into v_out;

  return v_out;
end $fn_analytics_item_margins_0095$;

-- 6.5 analytics_price_bands — units / revenue by default-variant list
--     price, NET of refunds and discounts.
create or replace function app.analytics_price_bands(
  p_from  date,
  p_to    date,
  p_basis text default 'settled'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_price_bands_0095$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  perform app.analytics_assert_basis(p_basis);
  v_ex := app.analytics_excluded();

  with
  dv as (
    select distinct on (v.item_id) v.item_id, v.price_iqd
      from menu_item_variants v
     order by v.item_id, v.is_default desc, v.sort_order, v.id),
  agg as (
    select l.menu_item_id,
           sum(l.net_qty)::bigint       as qty,
           sum(l.net_line_iqd)::bigint  as revenue_iqd
      from app.analytics_sales_lines(p_basis, v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
     where l.menu_item_id <> all (v_ex)
     group by l.menu_item_id),
  banded as (
    select case when dv.price_iqd < 3000  then 'lt3000'
                when dv.price_iqd < 6000  then '3000_5999'
                when dv.price_iqd < 10000 then '6000_9999'
                else 'gte10000' end as band,
           agg.menu_item_id, agg.qty, agg.revenue_iqd
      from agg
      join dv on dv.item_id = agg.menu_item_id),
  bands as (
    select b.band, b.ord
      from (values ('lt3000', 1), ('3000_5999', 2), ('6000_9999', 3), ('gte10000', 4)) as b(band, ord)),
  rolled as (
    select bands.band, bands.ord,
           coalesce(jsonb_agg(banded.menu_item_id order by banded.qty desc, banded.menu_item_id)
                      filter (where banded.menu_item_id is not null), '[]'::jsonb) as items,
           coalesce(sum(banded.qty), 0)::bigint         as qty,
           coalesce(sum(banded.revenue_iqd), 0)::bigint as revenue_iqd
      from bands
      left join banded on banded.band = bands.band
     group by bands.band, bands.ord)
  select coalesce(jsonb_agg(jsonb_build_object(
           'band',        rolled.band,
           'items',       rolled.items,
           'qty',         rolled.qty,
           'revenue_iqd', rolled.revenue_iqd
         ) order by rolled.ord), '[]'::jsonb)
    into v_out
    from rolled;

  return v_out;
end $fn_analytics_price_bands_0095$;

-- 6.6 analytics_hourly — orders / net units / net revenue by (dow, hour) on
--     the SETTLED basis. dow = the business weekday of the ORDER's placed_at
--     (0 = Sunday), hour = its venue-local clock hour: the chart asks "when
--     do people order", the money is what those orders finally netted.
create or replace function app.analytics_hourly(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_hourly_0095$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  select coalesce(jsonb_agg(jsonb_build_object(
           'dow',         x.dow,
           'hour',        x.hour,
           'orders',      x.orders,
           'qty',         x.qty,
           'revenue_iqd', x.revenue_iqd
         ) order by x.dow, x.hour), '[]'::jsonb)
    into v_out
    from (
      select extract(dow from app.business_date(l.placed_at, v_b.tz, v_b.start_hour))::int as dow,
             extract(hour from (l.placed_at at time zone v_b.tz))::int                      as hour,
             count(distinct l.order_id)                                                     as orders,
             coalesce(sum(l.net_qty), 0)::bigint                                            as qty,
             coalesce(sum(l.net_line_iqd), 0)::bigint                                       as revenue_iqd
        from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
       group by 1, 2
    ) x;

  return v_out;
end $fn_analytics_hourly_0095$;

-- ---------------------------------------------------------------------------
-- 7. Grants restated (create or replace keeps them; the belt costs nothing).
-- ---------------------------------------------------------------------------
revoke all on function app.analytics_daily_sales(date, date) from public, anon;
grant execute on function app.analytics_daily_sales(date, date) to authenticated;

revoke all on function app.analytics_sold_items(date, date, text) from public, anon;
grant execute on function app.analytics_sold_items(date, date, text) to authenticated;

revoke all on function app.analytics_best_sellers(date, date, int, text) from public, anon;
grant execute on function app.analytics_best_sellers(date, date, int, text) to authenticated;

revoke all on function app.analytics_item_margins(date, date, text) from public, anon;
grant execute on function app.analytics_item_margins(date, date, text) to authenticated;

revoke all on function app.analytics_price_bands(date, date, text) from public, anon;
grant execute on function app.analytics_price_bands(date, date, text) to authenticated;

revoke all on function app.analytics_hourly(date, date) from public, anon;
grant execute on function app.analytics_hourly(date, date) to authenticated;
