-- ===========================================================================
-- 0036 — tab totals correctness (money)
--
-- Forward-only re-creation of app.compute_tab_totals. Same signature, same
-- volatility/security, so every caller (settle_tab, apply_discount,
-- override_price, void_order_item_internal, split_evenly, the day-close views)
-- picks this up with no other change and no grant re-issue.
--
-- Three defects closed:
--
--   #1  Tax was computed on the PRE-discount group subtotal, so a discount
--       never reduced tax. A 50% discount on a 20,000 tab at 10% still billed
--       2,000 tax. Tax now sits on the post-discount base: line-scoped
--       discounts reduce their own group, and the whole-tab discount is spread
--       across groups pro-rata by their post-line-discount subtotal.
--
--   #2  tax_groups.is_active was never consulted anywhere in the codebase, so
--       an "inactive" group still billed. seed.sql ships 'Restaurant 10%' as
--       is_active = false deliberately; before this migration, pointing a
--       category at it silently taxed every tab 10%.
--
--   #3  The discount sum pulled every discount_* adjustment on the tab with no
--       join to order_items and no voided filter, while the subtotal DID
--       exclude voided lines. Discount a 10,000 line, void it, and the guest
--       kept the 5,000 off a tab that no longer contained the discounted item.
--       A line-scoped discount now dies with its line.
--
-- NOT done here, deliberately: no retroactive re-stamp of settled tabs'
-- subtotal/discount/tax/total. Those columns are the accounting record and
-- payments/refunds are append-only by design (payments_ao / refunds_ao); a
-- rewrite would decouple the stamp from the money actually taken. Historical
-- tabs keep the old math. This is a documented cut-over.
-- ===========================================================================

-- Line-scoped discounts are looked up per tab on every totals call.
create index if not exists tab_adjustments_order_item
  on tab_adjustments (order_item_id)
  where order_item_id is not null;

create or replace function app.compute_tab_totals(p_tab_id uuid)
returns table (subtotal_iqd bigint, discount_iqd bigint, tax_iqd bigint, total_iqd bigint)
language plpgsql stable security definer set search_path = public as $totals_0036$
declare
  v_subtotal  bigint;
  v_disc_line bigint;   -- discounts attached to a still-live line
  v_disc_tab  bigint;   -- whole-tab discounts (order_item_id is null)
  v_discount  bigint;   -- capped total, what we report and subtract
  v_tab_alloc bigint;   -- whole-tab portion actually allocatable to tax groups
  v_tax       bigint;
  v_inclusive boolean;
begin
  -- Live lines only: a voided line and a voided order are both out.
  select coalesce(sum(oi.line_total_iqd), 0) into v_subtotal
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  -- FIX #3: a line-scoped discount only counts while its line is live.
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

  -- The whole-tab share of the capped discount. If the cap bit, line discounts
  -- are honoured first and the tab discount absorbs the shortfall, so the
  -- allocation below never exceeds what we actually subtract.
  v_tab_alloc := greatest(least(v_disc_tab, v_discount - least(v_disc_line, v_discount)), 0);

  -- FIX #1 + #2: tax on the post-discount base, active groups only.
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
    -- Spread the whole-tab discount pro-rata over each group's post-line base.
    -- Per-group round() half-up, same convention as the tax rounding below; a
    -- 1-IQD allocation drift moves tax by at most rate_bp/10000 IQD and is
    -- absorbed by that rounding.
    select b.tax_group_id,
           greatest(
             b.after_line
               - round((v_tab_alloc::numeric * b.after_line)
                       / nullif(sum(b.after_line) over (), 0)),
             0) as taxable
      from base b
  )
  select coalesce(sum(round((a.taxable::numeric * tg.rate_bp) / 10000.0)), 0)::bigint
    into v_tax
    from alloc a
    join tax_groups tg on tg.id = a.tax_group_id
   where tg.is_active;

  select tax_inclusive into v_inclusive from venue_settings;

  subtotal_iqd := v_subtotal;
  discount_iqd := v_discount;
  tax_iqd      := v_tax;
  total_iqd    := greatest(
    v_subtotal - v_discount
      + case when coalesce(v_inclusive, false) then 0 else v_tax end,
    0);
  return next;
end $totals_0036$;

comment on function app.compute_tab_totals(uuid) is
  '0036: live-line subtotal; line-scoped discounts die with their line; tax on '
  'the post-discount base (whole-tab discount spread pro-rata across groups), '
  'active tax groups only. tax_inclusive => tax is display-only.';
