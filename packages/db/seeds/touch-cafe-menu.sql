-- SEED — the REAL Touch Cafe menu, exactly as the approved menu design states it.
--
-- This is PRODUCTION business data, not a dev fixture: it is the menu Touch
-- actually sells. It lives in seeds/ rather than fixtures/ and is NOT loaded by
-- `pnpm db:fixtures`, because fixtures/menu.sql is what the e2e suite and the
-- stock recipes are written against (the real menu has no modifier groups, so
-- it cannot stand in for the demo one there).
--
--   Apply it with:  pnpm --filter @touch/db db:menu
--   Requires migration 0054 (menu_items.serve_temp / menu_categories.serve_temp).
--
-- Source of truth: apps/web/public/brand/Touch Cafe Menu Final (standalone).html
-- (13 sections / 72 items), with ONE change of substance: Touch sells drinks in
-- one size, so every item is priced at a single 'Regular' size rather than the
-- design's MEDIUM/LARGE pair. The price kept is the size the venue actually
-- serves — the design's grey MEDIUM column. That is why the menu prints no size
-- headers and one price per row (see MenuCard/rowPrice.ts), and why the sheet
-- shows no size picker.
--
-- إيسبريسو is the single exception: single or double shot is a real choice
-- about what is served, not a cup size, so it keeps both and is the ONLY item
-- whose sheet offers a picker.
--
-- Reserved UUID prefix 'f1f7' (see packages/db/README.md). Suffix namespaces
-- used here (last 12 hex chars) are all NEW — no overlap with fixtures/menu.sql:
--   menu_categories     00000000cb01..cb13
--   menu_items          00000000b001..b072
--   menu_item_variants  0000b0<item3><variant3>
--
-- serve_temp carries the design's حار / بارد chips: on the CATEGORY where the
-- design badges a whole section, on the ITEM where it tags single rows.
--
-- Re-runnable: every insert upserts on id, so fixing a price is a one-line edit
-- and a re-apply.
--
-- NOTE: the final statement deactivates the six demo categories from
-- fixtures/menu.sql so a stack carrying both shows only the real menu. On a dev
-- machine that is what retires the demo data the e2e suite asserts against —
-- reload fixtures (`pnpm --filter @touch/db db:fixtures`) to bring it back.

begin;

-- ---------------------------------------------------------------------------
-- Categories (tax group = seeded Standard 0%)
-- ---------------------------------------------------------------------------
insert into menu_categories (id, name_en, name_ar, tax_group_id, sort_order, is_active, serve_temp) values
  ('f1f70000-0000-4000-8000-00000000cb01', 'Coffee', 'قهوة', 'b0000000-0000-4000-8000-000000000001', 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000cb02', 'Smoothie', 'سموذي', 'b0000000-0000-4000-8000-000000000001', 2, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000cb03', 'Tea', 'شاي', 'b0000000-0000-4000-8000-000000000001', 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000cb04', 'Fresh Juice', 'عصائر منعشة', 'b0000000-0000-4000-8000-000000000001', 4, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000cb05', 'Frappuccino', 'فراباچينو', 'b0000000-0000-4000-8000-000000000001', 5, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000cb06', 'Cocktail', 'كوكتيل', 'b0000000-0000-4000-8000-000000000001', 6, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000cb07', 'Milkshake', 'ميلك شيك', 'b0000000-0000-4000-8000-000000000001', 7, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000cb08', 'Milk Drinks', 'مشتقات الحليب', 'b0000000-0000-4000-8000-000000000001', 8, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000cb09', 'Desserts', 'حلويات', 'b0000000-0000-4000-8000-000000000001', 9, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000cb10', 'Signature', 'مشروباتنا', 'b0000000-0000-4000-8000-000000000001', 10, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000cb11', 'Mojito', 'موهيتو', 'b0000000-0000-4000-8000-000000000001', 11, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000cb12', 'Healthy', 'صحي', 'b0000000-0000-4000-8000-000000000001', 12, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000cb13', 'Specialty Coffee', 'قهوة مختصة', 'b0000000-0000-4000-8000-000000000001', 13, true, 'none')
on conflict (id) do update
  set name_en = excluded.name_en, name_ar = excluded.name_ar,
      sort_order = excluded.sort_order, is_active = excluded.is_active,
      serve_temp = excluded.serve_temp;

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------
insert into menu_items (id, category_id, name_en, name_ar, description_en, description_ar,
                        sort_order, is_active, serve_temp) values
  ('f1f70000-0000-4000-8000-00000000b001', 'f1f70000-0000-4000-8000-00000000cb01', 'Espresso', 'إيسبريسو', null, null, 1, true, 'hot'),
  ('f1f70000-0000-4000-8000-00000000b002', 'f1f70000-0000-4000-8000-00000000cb01', 'Americano', 'أميريكانو', null, null, 2, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b003', 'f1f70000-0000-4000-8000-00000000cb01', 'Latte', 'لاتيه', null, null, 3, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b004', 'f1f70000-0000-4000-8000-00000000cb01', 'Spanish Latte', 'سبانش لاتيه', null, null, 4, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b005', 'f1f70000-0000-4000-8000-00000000cb01', 'Mocha Latte', 'موكا لاتيه', null, null, 5, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b006', 'f1f70000-0000-4000-8000-00000000cb01', 'Caramel Latte', 'كراميل لاتيه', null, null, 6, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b007', 'f1f70000-0000-4000-8000-00000000cb01', 'Vanilla Latte', 'فانيلا لاتيه', null, null, 7, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b008', 'f1f70000-0000-4000-8000-00000000cb01', 'Hazelnut Latte', 'لاتيه بالبندق', null, null, 8, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b009', 'f1f70000-0000-4000-8000-00000000cb01', 'Cortado', 'كورتادو', null, null, 9, true, 'hot'),
  ('f1f70000-0000-4000-8000-00000000b010', 'f1f70000-0000-4000-8000-00000000cb01', 'Flat White', 'فلات وايت', null, null, 10, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b011', 'f1f70000-0000-4000-8000-00000000cb01', 'Turkish Coffee', 'قهوة تركية', 'Plain · Medium · Hazelnut', 'سادة - وسط - بندق', 11, true, 'hot'),
  ('f1f70000-0000-4000-8000-00000000b012', 'f1f70000-0000-4000-8000-00000000cb02', 'Pineapple', 'أناناس', null, null, 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b013', 'f1f70000-0000-4000-8000-00000000cb02', 'Passion Fruit', 'باشن فروت', null, null, 2, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b014', 'f1f70000-0000-4000-8000-00000000cb02', 'Strawberry', 'فراولة', null, null, 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b015', 'f1f70000-0000-4000-8000-00000000cb02', 'Peach', 'خوخ', null, null, 4, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b016', 'f1f70000-0000-4000-8000-00000000cb02', 'Mango', 'مانغا', null, null, 5, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b017', 'f1f70000-0000-4000-8000-00000000cb02', 'Mixed', 'مكس', 'Customer''s choice', 'حسب رغبة الزبون', 6, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b018', 'f1f70000-0000-4000-8000-00000000cb03', 'Iraqi Tea', 'شاي عراقي', null, null, 1, true, 'hot'),
  ('f1f70000-0000-4000-8000-00000000b019', 'f1f70000-0000-4000-8000-00000000cb03', 'Lemon Tea', 'شاي بالليمون', null, null, 2, true, 'hot'),
  ('f1f70000-0000-4000-8000-00000000b020', 'f1f70000-0000-4000-8000-00000000cb03', 'Karak Tea', 'شاي كرك', null, null, 3, true, 'hot'),
  ('f1f70000-0000-4000-8000-00000000b021', 'f1f70000-0000-4000-8000-00000000cb03', 'Hibiscus Tea', 'شاي كركدية', null, null, 4, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b022', 'f1f70000-0000-4000-8000-00000000cb04', 'Orange', 'برتقال', null, null, 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b023', 'f1f70000-0000-4000-8000-00000000cb04', 'Strawberry', 'فراولة', null, null, 2, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b024', 'f1f70000-0000-4000-8000-00000000cb04', 'Lemonade', 'عصير ليمون', null, null, 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b025', 'f1f70000-0000-4000-8000-00000000cb04', 'Watermelon', 'بطيخ', null, null, 4, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b026', 'f1f70000-0000-4000-8000-00000000cb04', 'Mango', 'مانغا', null, null, 5, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b027', 'f1f70000-0000-4000-8000-00000000cb04', 'Bolo', 'بولو', null, null, 6, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b028', 'f1f70000-0000-4000-8000-00000000cb05', 'Chocolate', 'شوكولاتة', null, null, 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b029', 'f1f70000-0000-4000-8000-00000000cb05', 'Oreo', 'اوريو', null, null, 2, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b030', 'f1f70000-0000-4000-8000-00000000cb05', 'Caramel', 'كراميل', null, null, 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b031', 'f1f70000-0000-4000-8000-00000000cb05', 'White Chocolate', 'شوكلاتة بيضاء', null, null, 4, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b032', 'f1f70000-0000-4000-8000-00000000cb05', 'Classic', 'كلاسيك', null, null, 5, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b033', 'f1f70000-0000-4000-8000-00000000cb06', 'Taj Blue', 'تاج بلو', null, null, 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b034', 'f1f70000-0000-4000-8000-00000000cb06', 'Fruit', 'فواكه', null, null, 2, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b035', 'f1f70000-0000-4000-8000-00000000cb06', 'Pina Colada', 'بينا كولادا', null, null, 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b036', 'f1f70000-0000-4000-8000-00000000cb07', 'Banana', 'موز', null, null, 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b037', 'f1f70000-0000-4000-8000-00000000cb07', 'Strawberry', 'فراولة', null, null, 2, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b038', 'f1f70000-0000-4000-8000-00000000cb07', 'Lotus', 'لوتس', null, null, 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b039', 'f1f70000-0000-4000-8000-00000000cb07', 'Pistachio', 'بستاشيو', null, null, 4, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b040', 'f1f70000-0000-4000-8000-00000000cb07', 'Snickers', 'سنيكرز', null, null, 5, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b041', 'f1f70000-0000-4000-8000-00000000cb07', 'Kit Kat', 'كت كات', null, null, 6, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b042', 'f1f70000-0000-4000-8000-00000000cb07', 'Kinder', 'كندر', null, null, 7, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b043', 'f1f70000-0000-4000-8000-00000000cb07', 'Chocolate', 'شوكلاتة', null, null, 8, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b044', 'f1f70000-0000-4000-8000-00000000cb08', 'Banana & Nutella Milk', 'حليب موز ونوتيلا', null, null, 1, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000b045', 'f1f70000-0000-4000-8000-00000000cb08', 'Strawberry Milk', 'حليب فراولة', null, null, 2, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000b046', 'f1f70000-0000-4000-8000-00000000cb08', 'Banana Milk', 'حليب موز', null, null, 3, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000b047', 'f1f70000-0000-4000-8000-00000000cb08', 'Hot Chocolate', 'شوكلاتة ساخنة', null, null, 4, true, 'hot'),
  ('f1f70000-0000-4000-8000-00000000b048', 'f1f70000-0000-4000-8000-00000000cb08', 'Iced Chocolate', 'شوكلاتة مثلجة', null, null, 5, true, 'cold'),
  ('f1f70000-0000-4000-8000-00000000b049', 'f1f70000-0000-4000-8000-00000000cb09', 'Donut', 'دونات', null, null, 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b050', 'f1f70000-0000-4000-8000-00000000cb09', 'Cookies', 'كوكيز', null, null, 2, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b051', 'f1f70000-0000-4000-8000-00000000cb09', 'Cheesecake', 'تشيز كيك', null, null, 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b052', 'f1f70000-0000-4000-8000-00000000cb09', 'Mosaic Cake', 'موزايك كيك', null, null, 4, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b053', 'f1f70000-0000-4000-8000-00000000cb09', 'San Sebastian', 'سان سباسيتان', null, null, 5, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b054', 'f1f70000-0000-4000-8000-00000000cb09', 'Brownies', 'براونيز', null, null, 6, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b055', 'f1f70000-0000-4000-8000-00000000cb09', 'Tiramisu', 'تيراميسو', null, null, 7, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b056', 'f1f70000-0000-4000-8000-00000000cb09', 'Carrot Cake', 'كيك جزر', null, null, 8, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b057', 'f1f70000-0000-4000-8000-00000000cb10', 'Court Energy', 'كورت اينرجي', null, null, 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b058', 'f1f70000-0000-4000-8000-00000000cb10', 'Taj Special', 'تاج سبيشل', null, null, 2, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b059', 'f1f70000-0000-4000-8000-00000000cb10', 'Pistachino Macchiato', 'بستاشينو ماكياتو', null, null, 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b060', 'f1f70000-0000-4000-8000-00000000cb10', 'Padel Fresh', 'بادل فرش', null, null, 4, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b061', 'f1f70000-0000-4000-8000-00000000cb11', 'Strawberry', 'فراولة', null, null, 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b062', 'f1f70000-0000-4000-8000-00000000cb11', 'Pomegranate & Blackberry', 'رمان - توت اسود', null, null, 2, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b063', 'f1f70000-0000-4000-8000-00000000cb11', 'Blue', 'ازرق', null, null, 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b064', 'f1f70000-0000-4000-8000-00000000cb11', 'Blueberry', 'توت ازرق', null, null, 4, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b065', 'f1f70000-0000-4000-8000-00000000cb11', 'Lemon & Mint', 'ليمون - نعناع', null, null, 5, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b066', 'f1f70000-0000-4000-8000-00000000cb11', 'Pineapple', 'أناناس', null, null, 6, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b067', 'f1f70000-0000-4000-8000-00000000cb12', 'Immunity Shot', 'شوت المناعة', null, null, 1, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b068', 'f1f70000-0000-4000-8000-00000000cb12', 'Green Apple', 'تفاح اخضر', null, null, 2, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b069', 'f1f70000-0000-4000-8000-00000000cb12', 'Protein', 'بروتين', null, null, 3, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b070', 'f1f70000-0000-4000-8000-00000000cb12', 'Orange & Carrot', 'برتقال - جزر', null, null, 4, true, 'none'),
  ('f1f70000-0000-4000-8000-00000000b071', 'f1f70000-0000-4000-8000-00000000cb13', 'V60', 'V60', null, null, 1, true, 'both'),
  ('f1f70000-0000-4000-8000-00000000b072', 'f1f70000-0000-4000-8000-00000000cb13', 'Cold Brew', 'كولد برو', null, null, 2, true, 'cold')
on conflict (id) do update
  set category_id = excluded.category_id, name_en = excluded.name_en, name_ar = excluded.name_ar,
      description_en = excluded.description_en, description_ar = excluded.description_ar,
      sort_order = excluded.sort_order, is_active = excluded.is_active,
      serve_temp = excluded.serve_temp;

-- ---------------------------------------------------------------------------
-- Variants — ONE per item.
--
-- Touch does not sell a drink in more than one size, so every item is priced
-- at a single unnamed size ('Regular' / 'عادي') — which is why the menu prints
-- no size headers, one price per row, and no size picker in the sheet. The
-- price kept is the one the design set for the size the venue actually serves
-- (the old MEDIUM column).
--
-- إيسبريسو is the ONE exception, with two rows: a single and a double shot is
-- a choice about what goes in the cup, not a cup size. Its row prints the
-- Single price and its sheet is the only one that asks.
--
-- Variant ids are unchanged, so re-applying this seed over an earlier one
-- reprices and renames in place rather than orphaning rows.
-- ---------------------------------------------------------------------------
insert into menu_item_variants (id, item_id, name_en, name_ar, price_iqd, is_default, sort_order) values
  -- إيسبريسو is the ONE item with a size choice: a single or a double shot.
  ('f1f70000-0000-4000-8000-0000b0001001', 'f1f70000-0000-4000-8000-00000000b001', 'Single', 'مفرد', 2000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0001002', 'f1f70000-0000-4000-8000-00000000b001', 'Double', 'مزدوج', 3000, false, 2),
  ('f1f70000-0000-4000-8000-0000b0002001', 'f1f70000-0000-4000-8000-00000000b002', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0003001', 'f1f70000-0000-4000-8000-00000000b003', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0004001', 'f1f70000-0000-4000-8000-00000000b004', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0005001', 'f1f70000-0000-4000-8000-00000000b005', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0006001', 'f1f70000-0000-4000-8000-00000000b006', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0007001', 'f1f70000-0000-4000-8000-00000000b007', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0008001', 'f1f70000-0000-4000-8000-00000000b008', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0009001', 'f1f70000-0000-4000-8000-00000000b009', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0010001', 'f1f70000-0000-4000-8000-00000000b010', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0011001', 'f1f70000-0000-4000-8000-00000000b011', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0012001', 'f1f70000-0000-4000-8000-00000000b012', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0013001', 'f1f70000-0000-4000-8000-00000000b013', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0014001', 'f1f70000-0000-4000-8000-00000000b014', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0015001', 'f1f70000-0000-4000-8000-00000000b015', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0016001', 'f1f70000-0000-4000-8000-00000000b016', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0017001', 'f1f70000-0000-4000-8000-00000000b017', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0018001', 'f1f70000-0000-4000-8000-00000000b018', 'Regular', 'عادي', 1000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0019001', 'f1f70000-0000-4000-8000-00000000b019', 'Regular', 'عادي', 1500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0020001', 'f1f70000-0000-4000-8000-00000000b020', 'Regular', 'عادي', 2000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0021001', 'f1f70000-0000-4000-8000-00000000b021', 'Regular', 'عادي', 4500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0022001', 'f1f70000-0000-4000-8000-00000000b022', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0023001', 'f1f70000-0000-4000-8000-00000000b023', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0024001', 'f1f70000-0000-4000-8000-00000000b024', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0025001', 'f1f70000-0000-4000-8000-00000000b025', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0026001', 'f1f70000-0000-4000-8000-00000000b026', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0027001', 'f1f70000-0000-4000-8000-00000000b027', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0028001', 'f1f70000-0000-4000-8000-00000000b028', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0029001', 'f1f70000-0000-4000-8000-00000000b029', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0030001', 'f1f70000-0000-4000-8000-00000000b030', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0031001', 'f1f70000-0000-4000-8000-00000000b031', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0032001', 'f1f70000-0000-4000-8000-00000000b032', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0033001', 'f1f70000-0000-4000-8000-00000000b033', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0034001', 'f1f70000-0000-4000-8000-00000000b034', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0035001', 'f1f70000-0000-4000-8000-00000000b035', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0036001', 'f1f70000-0000-4000-8000-00000000b036', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0037001', 'f1f70000-0000-4000-8000-00000000b037', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0038001', 'f1f70000-0000-4000-8000-00000000b038', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0039001', 'f1f70000-0000-4000-8000-00000000b039', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0040001', 'f1f70000-0000-4000-8000-00000000b040', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0041001', 'f1f70000-0000-4000-8000-00000000b041', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0042001', 'f1f70000-0000-4000-8000-00000000b042', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0043001', 'f1f70000-0000-4000-8000-00000000b043', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0044001', 'f1f70000-0000-4000-8000-00000000b044', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0045001', 'f1f70000-0000-4000-8000-00000000b045', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0046001', 'f1f70000-0000-4000-8000-00000000b046', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0047001', 'f1f70000-0000-4000-8000-00000000b047', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0048001', 'f1f70000-0000-4000-8000-00000000b048', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0049001', 'f1f70000-0000-4000-8000-00000000b049', 'Regular', 'عادي', 1750, true, 1),
  ('f1f70000-0000-4000-8000-0000b0050001', 'f1f70000-0000-4000-8000-00000000b050', 'Regular', 'عادي', 2000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0051001', 'f1f70000-0000-4000-8000-00000000b051', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0052001', 'f1f70000-0000-4000-8000-00000000b052', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0053001', 'f1f70000-0000-4000-8000-00000000b053', 'Regular', 'عادي', 5000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0054001', 'f1f70000-0000-4000-8000-00000000b054', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0055001', 'f1f70000-0000-4000-8000-00000000b055', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0056001', 'f1f70000-0000-4000-8000-00000000b056', 'Regular', 'عادي', 4000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0057001', 'f1f70000-0000-4000-8000-00000000b057', 'Regular', 'عادي', 5000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0058001', 'f1f70000-0000-4000-8000-00000000b058', 'Regular', 'عادي', 5000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0059001', 'f1f70000-0000-4000-8000-00000000b059', 'Regular', 'عادي', 5000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0060001', 'f1f70000-0000-4000-8000-00000000b060', 'Regular', 'عادي', 5000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0061001', 'f1f70000-0000-4000-8000-00000000b061', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0062001', 'f1f70000-0000-4000-8000-00000000b062', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0063001', 'f1f70000-0000-4000-8000-00000000b063', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0064001', 'f1f70000-0000-4000-8000-00000000b064', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0065001', 'f1f70000-0000-4000-8000-00000000b065', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0066001', 'f1f70000-0000-4000-8000-00000000b066', 'Regular', 'عادي', 3500, true, 1),
  ('f1f70000-0000-4000-8000-0000b0067001', 'f1f70000-0000-4000-8000-00000000b067', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0068001', 'f1f70000-0000-4000-8000-00000000b068', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0069001', 'f1f70000-0000-4000-8000-00000000b069', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0070001', 'f1f70000-0000-4000-8000-00000000b070', 'Regular', 'عادي', 3000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0071001', 'f1f70000-0000-4000-8000-00000000b071', 'Regular', 'عادي', 5000, true, 1),
  ('f1f70000-0000-4000-8000-0000b0072001', 'f1f70000-0000-4000-8000-00000000b072', 'Regular', 'عادي', 5000, true, 1)
on conflict (id) do update
  set item_id = excluded.item_id, name_en = excluded.name_en, name_ar = excluded.name_ar,
      price_iqd = excluded.price_iqd, is_default = excluded.is_default,
      sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Retire the second size.
--
-- An earlier run of this seed priced most items MEDIUM + LARGE. The upsert
-- above cannot remove what it no longer lists, so the LARGE rows have to go
-- explicitly or the sheet would still offer a size choice this menu no longer
-- sells. Only ids in this seed's own variant namespace are touched (an
-- operator's own variant is theirs to remove), and only while nothing has been
-- sold as that size — order_items.variant_id has no cascade, and a sold size
-- must keep its row so the order history it prices stays readable. Its
-- recipes, which do cascade, go with it. Anything that survives is reported.
-- ---------------------------------------------------------------------------
delete from menu_item_variants v
 where v.id::text like 'f1f70000-0000-4000-8000-0000b0%'
   and v.id::text not like '%001'
   and v.id <> 'f1f70000-0000-4000-8000-0000b0001002'  -- إيسبريسو's Double: a real choice, not a size
   and not exists (select 1 from order_items oi where oi.variant_id = v.id);

do $$
declare stuck int;
begin
  select count(*) into stuck
    from menu_item_variants v
   where v.id::text like 'f1f70000-0000-4000-8000-0000b0%'
     and v.id::text not like '%001'
     and v.id <> 'f1f70000-0000-4000-8000-0000b0001002';
  if stuck > 0 then
    raise warning
      'touch-cafe-menu: % retired size(s) kept — already sold, so they still price order history. Retire them by hand once those orders are archived.',
      stuck;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Retire the demo menu: the real menu above is the one guests see.
-- ---------------------------------------------------------------------------
update menu_categories set is_active = false
 where id in (
   'f1f70000-0000-4000-8000-00000000ca01','f1f70000-0000-4000-8000-00000000ca02',
   'f1f70000-0000-4000-8000-00000000ca03','f1f70000-0000-4000-8000-00000000ca04',
   'f1f70000-0000-4000-8000-00000000ca05','f1f70000-0000-4000-8000-00000000ca06');

commit;
