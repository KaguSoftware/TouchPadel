-- ONE-OFF — collapse the hosted menu to one size per drink.
--
-- The menu no longer sells a drink in more than one size, so seeds/touch-cafe-menu.sql
-- now carries one variant per item. That seed upserts, and an upsert cannot remove
-- what it no longer lists, so a database seeded BEFORE the change still has the
-- MEDIUM/LARGE pairs and still offers a size picker in the item sheet.
--
-- Run this once, in the Supabase SQL editor, against such a database. It is
-- idempotent — running it twice changes nothing the second time — and it only
-- touches ids in this seed's own variant namespace ('f1f7…0000b0…'), so a variant
-- an operator added themselves is left alone.
--
--   1. the second size is deleted, and the survivor keeps its price — the old
--      MEDIUM column, i.e. the size the venue actually serves
--   2. the survivor loses its size name and becomes 'Regular' / 'عادي'
--   3. إيسبريسو is the ONE exception and is not touched: single or double shot
--      is a choice about what goes in the cup, not a cup size
--
-- A size that has already been SOLD is kept: order_items.variant_id has no
-- cascade, and that row is what prices the order history. The report at the end
-- names anything left behind for that reason.

begin;

-- 1. Retire the second size (the LARGE rows).
delete from menu_item_variants v
 where v.id::text like 'f1f70000-0000-4000-8000-0000b0%'
   and v.is_default = false
   and v.item_id <> 'f1f70000-0000-4000-8000-00000000b001'  -- إيسبريسو
   and not exists (select 1 from order_items oi where oi.variant_id = v.id);

-- 2. The size that survives is the one served, so it stops being a named size.
--    Its price is untouched.
update menu_item_variants v
   set name_en = 'Regular', name_ar = 'عادي', sort_order = 1
 where v.id::text like 'f1f70000-0000-4000-8000-0000b0%'
   and v.item_id <> 'f1f70000-0000-4000-8000-00000000b001'  -- إيسبريسو
   -- Only the default. A second size that survived step 1 because it had been
   -- sold must NOT be renamed too, or the item would carry two 'Regular' rows.
   and v.is_default
   and (v.name_en, v.name_ar, v.sort_order) is distinct from ('Regular', 'عادي', 1);

-- 3. إيسبريسو, stated explicitly so this script also repairs a database where
--    the earlier one-size pass already flattened it.
insert into menu_item_variants (id, item_id, name_en, name_ar, price_iqd, is_default, sort_order) values
  ('f1f70000-0000-4000-8000-0000b0001001', 'f1f70000-0000-4000-8000-00000000b001', 'Single', 'مفرد', 2000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0001002', 'f1f70000-0000-4000-8000-00000000b001', 'Double', 'مزدوج', 3000, false, 2)
on conflict (id) do update
  set name_en = excluded.name_en, name_ar = excluded.name_ar,
      price_iqd = excluded.price_iqd, is_default = excluded.is_default,
      sort_order = excluded.sort_order;

commit;

-- Report: every row here is an item that still offers a size choice. إيسبريسو
-- with its 2 is the expected — and only — result. Anything else was already
-- sold in two sizes and has to be retired by hand once those orders are archived.
select i.name_en, i.name_ar, count(*) as sizes,
       string_agg(v.name_en || ' ' || v.price_iqd, ' / ' order by v.sort_order) as offered
  from menu_item_variants v
  join menu_items i on i.id = v.item_id
 where i.id::text like 'f1f70000-0000-4000-8000-00000000b%'
 group by i.id, i.name_en, i.name_ar
having count(*) > 1
 order by i.name_en;
