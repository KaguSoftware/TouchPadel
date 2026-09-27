-- 0181 staff_stock_view — stock by quantity, never by money, for the head roles
-- and the court desk.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.5; plan #68).
-- Depends on: nothing.
-- Re-runnable: create or replace.
--
-- WHO SEES WHAT. Active ingredients at the venue, by kind:
--   head_barista, head_chef  purchased and prepared: the cafe's stock.
--                            Ingredients carry no bar or kitchen column, so
--                            both heads read the same list (PROPOSAL; a split
--                            needs a new column and the owner tagging every
--                            ingredient);
--   court_desk               retail: the Touch Shop's stock, each row with the
--                            shop product and size it backs (found through
--                            that size's recipe line, 0145);
--   manager, owner           all three.
-- Barista, chef, cashier, driver, marketing and prep are refused: logging and
-- controlling stock are parked (§0 P5), and a read for them waits for that
-- answer.
--
-- NO MONEY. No pack or batch cost, no price, no supplier, no delivery, and no
-- key ending in _iqd. pack_size is a size. The figures are production_today's
-- (0167): on_hand is the sum of stock_batches.qty_remaining, and below_par is
-- strictly below par, so the head chef's Stock page and the chef tiers' "What
-- to make today" agree when stock sits exactly at par.
--
-- covered by packages/db/tests/staff-stock-view.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.staff_stock_view(
  p_venue_id uuid default null,
  p_kind     text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $staff_stock_view_0181$
declare
  v_venue uuid;
  v_role  staff_role := app.staff_role();
  v_kinds text[];
  v_items jsonb;
begin
  if not app.is_staff('head_barista','head_chef','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','court_desk','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_kinds := case
               when v_role in ('manager','owner')          then array['purchased','prepared','retail']
               when v_role in ('head_barista','head_chef') then array['purchased','prepared']
               when v_role = 'court_desk'                  then array['retail']
             end;
  if p_kind is not null then
    if p_kind not in ('purchased','prepared','retail') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
    end if;
    if not (p_kind = any(v_kinds)) then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'kind';
    end if;
    v_kinds := array[p_kind];
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredient_id',       x.id,
           'kind',                x.kind,
           'name_en',             x.name_en,
           'name_ar',             x.name_ar,
           'unit',                x.unit,
           'pack_size',           x.pack_size,
           'on_hand',             x.on_hand,
           'par_level',           x.par_level,
           'low_stock_threshold', x.low_stock_threshold,
           'low',                 x.low,
           'below_par',           x.below_par,
           'next_expiry',         x.next_expiry,
           'product',             x.product)
         order by x.low desc, lower(x.name_en), x.id), '[]'::jsonb)
    into v_items
    from (select i.id, i.kind::text as kind, i.name_en, i.name_ar, i.unit::text as unit, i.pack_size,
                 oh.on_hand, i.par_level, i.low_stock_threshold,
                 (i.low_stock_threshold is not null and oh.on_hand <= i.low_stock_threshold) as low,
                 (i.par_level is not null and oh.on_hand < i.par_level) as below_par,
                 oh.next_expiry,
                 pr.product
            from ingredients i
            cross join lateral (
              select coalesce(sum(b.qty_remaining), 0) as on_hand,
                     min(b.expiry_date) as next_expiry
                from stock_batches b
               where b.ingredient_id = i.id and b.qty_remaining > 0) oh
            -- A retail ingredient backs one shop size, through its recipe line.
            left join lateral (
              select jsonb_build_object('menu_item_id', mi.id,
                                        'name_en',      mi.name_en,
                                        'name_ar',      mi.name_ar,
                                        'size_name_en', v.name_en,
                                        'size_name_ar', v.name_ar) as product
                from recipe_lines rl
                join menu_item_variants v on v.id = rl.variant_id
                join menu_items mi on mi.id = v.item_id
               where i.kind = 'retail' and rl.ingredient_id = i.id
               order by rl.id
               limit 1) pr on true
           where i.venue_id = v_venue
             and i.is_active
             and i.kind::text = any(v_kinds)) x;

  return jsonb_build_object('as_of', now(), 'items', v_items);
end $staff_stock_view_0181$;

comment on function app.staff_stock_view(uuid, text) is
  'staff_stock_view (§2.24.5, #68). The head barista and head chef (purchased and prepared), the court desk (retail, with the shop product and size each row backs) and MGMT (all three) at the venue: {as_of, items: [{ingredient_id, kind, name_en, name_ar, unit, pack_size, on_hand, par_level, low_stock_threshold, low, below_par, next_expiry, product}]}, active ingredients, low first, then by name. on_hand is the sum of stock_batches.qty_remaining; low is on_hand at or under the threshold; below_par is strictly under par. No cost, price, supplier or delivery. FORBIDDEN for anyone else and (hint kind) for a kind outside the caller''s; INVALID_ARGUMENT (hint kind) for an unknown kind.';

revoke all on function app.staff_stock_view(uuid, text) from public, anon;
grant execute on function app.staff_stock_view(uuid, text) to authenticated;
