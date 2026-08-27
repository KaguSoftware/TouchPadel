-- ===========================================================================
-- 0045 — inclusive tax is EXTRACTED, not omitted
--
--   #21  venue_settings.tax_inclusive means the menu price already contains
--        the tax. compute_tab_totals computed the tax with the EXCLUSIVE
--        formula either way -- base * rate_bp / 10000 -- and, when inclusive,
--        simply declined to add it to the total. The total came out right, so
--        nothing failed; but the tax FIGURE was overstated. A 10% group under
--        inclusive pricing reported 10% of the gross (1,000 on 10,000) rather
--        than the 9.0909% actually embedded in it (909). That figure is not
--        cosmetic: it is stamped onto tabs.tax_iqd at settle, rolled into
--        v_day_close_summary, and read back by the analytics layer.
--
--        The correct extraction is base * rate_bp / (10000 + rate_bp), and it
--        appeared nowhere in the repo -- not in SQL, not in packages/core, not
--        in TillScreen.tsx, which mirrors the same "display-only" treatment.
--
--        DORMANT WHEN THIS LANDS, for two independent reasons: tax_inclusive
--        is false, and the only ACTIVE tax group is Standard at rate_bp = 0
--        (seed.sql ships Restaurant 10% inactive). Both are one UPDATE away
--        from being live, and flipping either is a plausible configuration
--        change rather than a code change -- which is exactly why this is
--        worth fixing before it can be switched on.
--
--        No settled tab is re-stamped; historical rows keep the old figure.
--        With tax_inclusive = false the emitted maths is byte-identical to
--        0036, so this is a no-op for the current configuration.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.compute_tab_totals(p_tab_id uuid)
 RETURNS TABLE(subtotal_iqd bigint, discount_iqd bigint, tax_iqd bigint, total_iqd bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select coalesce(tax_inclusive, false) into v_inclusive from venue_settings;

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
  -- 0045: the rate is applied one of two ways.
  --   exclusive - tax sits ON TOP of the price:  base * rate/10000
  --   inclusive - the price already CONTAINS it: base * rate/(10000+rate)
  -- Before 0045 only the exclusive form existed and the inclusive branch just
  -- declined to ADD it, so a 10% group reported 10% of the gross instead of
  -- the 9.0909% actually embedded. The total was right; the tax line was not.
  select coalesce(sum(
           case when v_inclusive
                then round((a.taxable::numeric * tg.rate_bp) / (10000.0 + tg.rate_bp))
                else round((a.taxable::numeric * tg.rate_bp) / 10000.0)
           end), 0)::bigint
    into v_tax
    from alloc a
    join tax_groups tg on tg.id = a.tax_group_id
   where tg.is_active;



  subtotal_iqd := v_subtotal;
  discount_iqd := v_discount;
  tax_iqd      := v_tax;
  total_iqd    := greatest(
    v_subtotal - v_discount
      + case when coalesce(v_inclusive, false) then 0 else v_tax end,
    0);
  return next;
end $function$;
