-- FIXTURE — replaceable business data, dev/staging ONLY. Never applied to prod.
--
-- Reserved fixture UUID prefix 'f1f7' (see courts.sql / packages/db/README.md).
-- Suffix namespaces used here (last 12 hex chars):
--   menu_categories            00000000ca01..ca06
--   menu_items                 00000000e001..e030
--   menu_item_variants         0000f0<item2>000<v>      (e.g. item 01 size 1 = 0000f0010001)
--   modifier_groups            00000000d001..d005
--   modifiers                  00000000d<g>0<n>         (e.g. group 1 mod 1 = 00000000d101)
--   menu_item_costs / modifier_reveals / cafe_settings key off the ids above.
--
-- Content: 6 categories / 30 items. Drinks carry two sizes (absolute prices per
-- size, round IQD); food carries a single default 'Regular'. Modifier groups:
-- milk type (incl. oat, +1000), extra shot (+1000, up to 2), sides, plus the
-- 0028 reveal pair (Make it a meal -> Pick a drink). Allergen links reference
-- the SEEDED allergen codes (supabase/seed.sql §3). All categories sit in the
-- seeded 'Standard' 0% tax group.
--
-- Cafe-rebuild extras (0027 / 0028 / 0029 / 0031): every item carries a
-- bilingual 3-word hook; Kahi is highlighted blue, Kunafa brown; Mixed Nuts is
-- sold_out; 12 items have a unit cost in menu_item_costs (the other 18 have NO
-- row — "unknown" on purpose, to exercise margin coverage); Cappuccino, Beef
-- Burger, Kunafa and the Hot Drinks category point at local placeholder photos
-- (scripts/make-placeholders.mjs); cafe_settings turns the featured hero on.
--
-- Apply order: courts.sql -> menu.sql -> tables.sql -> stock.sql
-- (stock.sql attaches recipe_lines to the variant/modifier ids defined here).

begin;

-- ---------------------------------------------------------------------------
-- Categories (tax group = seeded Standard 0%)
-- ---------------------------------------------------------------------------
insert into menu_categories (id, name_en, name_ar, tax_group_id, sort_order, is_active) values
  ('f1f70000-0000-4000-8000-00000000ca01', 'Hot Drinks',  'مشروبات ساخنة',      'b0000000-0000-4000-8000-000000000001', 1, true),
  ('f1f70000-0000-4000-8000-00000000ca02', 'Cold Drinks', 'مشروبات باردة',      'b0000000-0000-4000-8000-000000000001', 2, true),
  ('f1f70000-0000-4000-8000-00000000ca03', 'Breakfast',   'الفطور',             'b0000000-0000-4000-8000-000000000001', 3, true),
  ('f1f70000-0000-4000-8000-00000000ca04', 'Mains',       'الأطباق الرئيسية',   'b0000000-0000-4000-8000-000000000001', 4, true),
  ('f1f70000-0000-4000-8000-00000000ca05', 'Desserts',    'الحلويات',           'b0000000-0000-4000-8000-000000000001', 5, true),
  ('f1f70000-0000-4000-8000-00000000ca06', 'Snacks',      'وجبات خفيفة',        'b0000000-0000-4000-8000-000000000001', 6, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------
insert into menu_items (id, category_id, name_en, name_ar, description_en, description_ar,
                        hook_en, hook_ar, highlight, sold_out, sort_order, is_active) values
  -- Hot drinks
  ('f1f70000-0000-4000-8000-00000000e001', 'f1f70000-0000-4000-8000-00000000ca01', 'Espresso', 'إسبريسو',
   'A concentrated shot of freshly roasted beans', 'جرعة قهوة مركزة من حبوب محمصة طازجة',
   'bold · short · roasted', 'قوي · قصير · محمّص', 'none', false, 1, true),
  ('f1f70000-0000-4000-8000-00000000e002', 'f1f70000-0000-4000-8000-00000000ca01', 'Cappuccino', 'كابتشينو',
   'Espresso with steamed milk and thick foam', 'إسبريسو مع حليب مبخّر ورغوة كثيفة',
   'creamy · foamy · warm', 'كريمي · رغوي · دافئ', 'none', false, 2, true),
  ('f1f70000-0000-4000-8000-00000000e003', 'f1f70000-0000-4000-8000-00000000ca01', 'Latte', 'لاتيه',
   'Espresso with steamed milk and a soft touch of foam', 'إسبريسو مع حليب مبخّر ولمسة رغوة ناعمة',
   'smooth · milky · mellow', 'ناعم · حليبي · هادئ', 'none', false, 3, true),
  ('f1f70000-0000-4000-8000-00000000e004', 'f1f70000-0000-4000-8000-00000000ca01', 'Turkish Coffee', 'قهوة تركية',
   'Finely ground coffee slowly brewed, served with cardamom', 'قهوة مطحونة ناعماً تُغلى على مهل وتقدَّم مع الهيل',
   'thick · dark · cardamom', 'كثيف · داكن · بالهيل', 'none', false, 4, true),
  ('f1f70000-0000-4000-8000-00000000e005', 'f1f70000-0000-4000-8000-00000000ca01', 'Karak Tea', 'شاي كرك',
   'Tea simmered with milk and cardamom', 'شاي مغلي بالحليب والهيل على الطريقة الخليجية',
   'spiced · milky · sweet', 'متبّل · حليبي · حلو', 'none', false, 5, true),
  ('f1f70000-0000-4000-8000-00000000e006', 'f1f70000-0000-4000-8000-00000000ca01', 'Hot Chocolate', 'شوكولاتة ساخنة',
   'Rich cocoa with steamed milk', 'كاكاو غني بالحليب المبخّر',
   'rich · cocoa · cosy', 'غني · كاكاو · دافئ', 'none', false, 6, true),
  -- Cold drinks
  ('f1f70000-0000-4000-8000-00000000e007', 'f1f70000-0000-4000-8000-00000000ca02', 'Iced Latte', 'لاتيه مثلج',
   'Espresso over cold milk and ice', 'إسبريسو مع حليب بارد وثلج',
   'cold · smooth · refreshing', 'بارد · ناعم · منعش', 'none', false, 1, true),
  ('f1f70000-0000-4000-8000-00000000e008', 'f1f70000-0000-4000-8000-00000000ca02', 'Iced Spanish Latte', 'لاتيه إسباني مثلج',
   'Espresso with sweetened milk over ice', 'إسبريسو مع حليب محلّى وثلج',
   'sweet · creamy · iced', 'حلو · كريمي · مثلج', 'none', false, 2, true),
  ('f1f70000-0000-4000-8000-00000000e009', 'f1f70000-0000-4000-8000-00000000ca02', 'Fresh Orange Juice', 'عصير برتقال طازج',
   'Freshly squeezed oranges, nothing added', 'برتقال معصور طازجاً دون إضافات',
   'fresh · zesty · squeezed', 'طازج · منعش · معصور', 'none', false, 3, true),
  ('f1f70000-0000-4000-8000-00000000e010', 'f1f70000-0000-4000-8000-00000000ca02', 'Lemon & Mint', 'ليمون ونعناع',
   'Fresh lemon juice blended with mint leaves', 'عصير ليمون طازج مخفوق مع أوراق النعناع',
   'tangy · cool · minty', 'حامض · بارد · بالنعناع', 'none', false, 4, true),
  ('f1f70000-0000-4000-8000-00000000e011', 'f1f70000-0000-4000-8000-00000000ca02', 'Strawberry Smoothie', 'سموذي فراولة',
   'Fresh strawberries blended with yogurt', 'فراولة طازجة مخفوقة مع اللبن',
   'fruity · thick · creamy', 'فاكهي · كثيف · كريمي', 'none', false, 5, true),
  ('f1f70000-0000-4000-8000-00000000e012', 'f1f70000-0000-4000-8000-00000000ca02', 'Mineral Water', 'مياه معدنية',
   'Natural mineral water', 'مياه معدنية طبيعية',
   'pure · still · chilled', 'نقي · طبيعي · مبرّد', 'none', false, 6, true),
  -- Breakfast
  ('f1f70000-0000-4000-8000-00000000e013', 'f1f70000-0000-4000-8000-00000000ca03', 'Eggs with Sujuk', 'بيض مع سجق',
   'Fried eggs with spicy sujuk, served with toast', 'بيض مقلي مع سجق حار يقدَّم مع خبز التوست',
   'spicy · hearty · filling', 'حار · دسم · مشبع', 'none', false, 1, true),
  ('f1f70000-0000-4000-8000-00000000e014', 'f1f70000-0000-4000-8000-00000000ca03', 'Halloumi Toast', 'توست حلوم',
   'Grilled halloumi between buttered toast', 'جبنة حلوم مشوية بين شرائح توست بالزبدة',
   'grilled · salty · golden', 'مشوي · مالح · ذهبي', 'none', false, 2, true),
  ('f1f70000-0000-4000-8000-00000000e015', 'f1f70000-0000-4000-8000-00000000ca03', 'Foul Medames', 'فول مدمس',
   'Fava beans stewed with olive oil, lemon and garlic', 'فول مطبوخ بزيت الزيتون والليمون والثوم',
   'warm · garlicky · classic', 'دافئ · بالثوم · تقليدي', 'none', false, 3, true),
  ('f1f70000-0000-4000-8000-00000000e016', 'f1f70000-0000-4000-8000-00000000ca03', 'Omelette', 'أومليت',
   'Whisked eggs cooked in butter, served with toast', 'بيض مخفوق مطبوخ بالزبدة يقدَّم مع التوست',
   'fluffy · buttery · simple', 'هشّ · بالزبدة · بسيط', 'none', false, 4, true),
  ('f1f70000-0000-4000-8000-00000000e017', 'f1f70000-0000-4000-8000-00000000ca03', 'Kahi with Geymar', 'كاهي وقيمر',
   'Crispy kahi with fresh geymar and syrup — a true Baghdadi breakfast', 'كاهي مقرمش مع قيمر طازج وشيرة — فطور بغدادي أصيل',
   'crispy · sweet · Baghdadi', 'مقرمش · حلو · بغدادي', 'blue', false, 5, true),
  -- Mains
  ('f1f70000-0000-4000-8000-00000000e018', 'f1f70000-0000-4000-8000-00000000ca04', 'Chicken Club Sandwich', 'ساندويتش كلوب دجاج',
   'Layers of grilled chicken, lettuce and mayonnaise', 'طبقات من الدجاج المشوي والخس والمايونيز',
   'stacked · grilled · fresh', 'طبقات · مشوي · طازج', 'none', false, 1, true),
  ('f1f70000-0000-4000-8000-00000000e019', 'f1f70000-0000-4000-8000-00000000ca04', 'Beef Burger', 'برغر لحم',
   'Grilled beef patty with cheddar and pickles in a fresh bun', 'قرص لحم مشوي مع جبنة شيدر ومخلل في خبز طازج',
   'juicy · cheesy · grilled', 'عصاري · بالجبنة · مشوي', 'none', false, 2, true),
  ('f1f70000-0000-4000-8000-00000000e020', 'f1f70000-0000-4000-8000-00000000ca04', 'Margherita Pizza', 'بيتزا مارغريتا',
   'Tomato sauce and mozzarella on fresh dough', 'صلصة طماطم وجبنة موزاريلا على عجينة طازجة',
   'thin · cheesy · classic', 'رقيق · بالجبنة · كلاسيكي', 'none', false, 3, true),
  ('f1f70000-0000-4000-8000-00000000e021', 'f1f70000-0000-4000-8000-00000000ca04', 'Chicken Caesar Salad', 'سلطة سيزر بالدجاج',
   'Romaine lettuce with grilled chicken and parmesan', 'خس روماني مع دجاج مشوي وجبنة بارميزان',
   'crisp · light · parmesan', 'مقرمش · خفيف · بارميزان', 'none', false, 4, true),
  ('f1f70000-0000-4000-8000-00000000e022', 'f1f70000-0000-4000-8000-00000000ca04', 'Chicken Alfredo Pasta', 'باستا ألفريدو بالدجاج',
   'Pasta in cream sauce with chicken and parmesan', 'معكرونة بصلصة الكريمة مع الدجاج والبارميزان',
   'creamy · rich · filling', 'كريمي · غني · مشبع', 'none', false, 5, true),
  -- Desserts
  ('f1f70000-0000-4000-8000-00000000e023', 'f1f70000-0000-4000-8000-00000000ca05', 'Kunafa', 'كنافة',
   'Hot cheese kunafa soaked in syrup', 'كنافة ساخنة بالجبنة تُسقى بالشيرة',
   'hot · syrupy · cheesy', 'ساخنة · بالشيرة · بالجبنة', 'brown', false, 1, true),
  ('f1f70000-0000-4000-8000-00000000e024', 'f1f70000-0000-4000-8000-00000000ca05', 'Cheesecake', 'تشيز كيك',
   'Creamy cheesecake on a crunchy base', 'قطعة تشيز كيك كريمية على قاعدة مقرمشة',
   'creamy · smooth · crunchy', 'كريمي · ناعم · مقرمش', 'none', false, 2, true),
  ('f1f70000-0000-4000-8000-00000000e025', 'f1f70000-0000-4000-8000-00000000ca05', 'Chocolate Brownie', 'براوني شوكولاتة',
   'Rich dark chocolate brownie', 'براوني غني بالشوكولاتة الداكنة',
   'dark · fudgy · rich', 'داكن · طري · غني', 'none', false, 3, true),
  ('f1f70000-0000-4000-8000-00000000e026', 'f1f70000-0000-4000-8000-00000000ca05', 'Fruit Salad', 'سلطة فواكه',
   'A mix of fresh seasonal fruits', 'تشكيلة فواكه موسمية طازجة',
   'fresh · seasonal · light', 'طازج · موسمي · خفيف', 'none', false, 4, true),
  -- Snacks
  ('f1f70000-0000-4000-8000-00000000e027', 'f1f70000-0000-4000-8000-00000000ca06', 'French Fries', 'بطاطا مقلية',
   'Crispy fries served hot', 'بطاطا مقرمشة تقدَّم ساخنة',
   'crispy · hot · salted', 'مقرمشة · ساخنة · مملّحة', 'none', false, 1, true),
  ('f1f70000-0000-4000-8000-00000000e028', 'f1f70000-0000-4000-8000-00000000ca06', 'Chicken Tenders', 'أصابع دجاج',
   'Crispy chicken tenders with garlic sauce', 'أصابع دجاج مقرمشة مع صوص الثوم',
   'crunchy · golden · garlicky', 'مقرمشة · ذهبية · بالثوم', 'none', false, 2, true),
  ('f1f70000-0000-4000-8000-00000000e029', 'f1f70000-0000-4000-8000-00000000ca06', 'Nachos', 'ناتشوز',
   'Tortilla chips with melted cheddar and salsa', 'رقائق تورتيا مع جبنة شيدر ذائبة وصلصة',
   'cheesy · crunchy · salsa', 'بالجبنة · مقرمش · صلصة', 'none', false, 3, true),
  ('f1f70000-0000-4000-8000-00000000e030', 'f1f70000-0000-4000-8000-00000000ca06', 'Mixed Nuts', 'مكسرات مشكلة',
   'A mix of roasted nuts', 'تشكيلة مكسرات محمصة',
   'roasted · salty · crunchy', 'محمّصة · مالحة · مقرمشة', 'none', true, 4, true)
on conflict (id) do update
  set hook_en   = excluded.hook_en,
      hook_ar   = excluded.hook_ar,
      highlight = excluded.highlight,
      sold_out  = excluded.sold_out;

-- ---------------------------------------------------------------------------
-- Photos (0027) — 3 items + the Hot Drinks category point at LOCAL placeholders
-- written by scripts/make-placeholders.mjs under supabase/buckets/menu-media/
-- (seeded into the `menu-media` bucket through config.toml `objects_path`).
-- photo_blur is a 4x4 brand-blue PNG data-URI (`make-placeholders.mjs --blur`),
-- well under the 400-char cap. Plain updates: idempotent, and they also apply
-- to an already-loaded database.
-- ---------------------------------------------------------------------------
with blur(uri) as (
  select 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAG0lEQVR42mMwTlgNRwzGCatzJl/LmXwNGweOADsiFj0cLfufAAAAAElFTkSuQmCC'
), photos(item_id, path) as (values
  ('f1f70000-0000-4000-8000-00000000e002', 'items/f1f70000-0000-4000-8000-00000000e002/fixture.png'), -- cappuccino
  ('f1f70000-0000-4000-8000-00000000e019', 'items/f1f70000-0000-4000-8000-00000000e019/fixture.png'), -- beef burger
  ('f1f70000-0000-4000-8000-00000000e023', 'items/f1f70000-0000-4000-8000-00000000e023/fixture.png')  -- kunafa
)
update menu_items mi
   set photo_path = p.path, photo_blur = blur.uri
  from photos p, blur
 where mi.id = p.item_id::uuid;

update menu_categories
   set photo_path = 'categories/f1f70000-0000-4000-8000-00000000ca01/fixture.png',
       photo_blur = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAG0lEQVR42mMwTlgNRwzGCatzJl/LmXwNGweOADsiFj0cLfufAAAAAElFTkSuQmCC'
 where id = 'f1f70000-0000-4000-8000-00000000ca01';

-- ---------------------------------------------------------------------------
-- Variants — drinks: Regular/Large with absolute round-IQD prices (water:
-- Small/Large bottle); food: a single default 'Regular'.
-- ---------------------------------------------------------------------------
insert into menu_item_variants (id, item_id, name_en, name_ar, price_iqd, is_default, sort_order) values
  ('f1f70000-0000-4000-8000-0000f0010001', 'f1f70000-0000-4000-8000-00000000e001', 'Regular', 'عادي',  3000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0010002', 'f1f70000-0000-4000-8000-00000000e001', 'Large',   'كبير',  4000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0020001', 'f1f70000-0000-4000-8000-00000000e002', 'Regular', 'عادي',  4000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0020002', 'f1f70000-0000-4000-8000-00000000e002', 'Large',   'كبير',  5000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0030001', 'f1f70000-0000-4000-8000-00000000e003', 'Regular', 'عادي',  4000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0030002', 'f1f70000-0000-4000-8000-00000000e003', 'Large',   'كبير',  5000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0040001', 'f1f70000-0000-4000-8000-00000000e004', 'Regular', 'عادي',  3000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0040002', 'f1f70000-0000-4000-8000-00000000e004', 'Large',   'كبير',  4000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0050001', 'f1f70000-0000-4000-8000-00000000e005', 'Regular', 'عادي',  2000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0050002', 'f1f70000-0000-4000-8000-00000000e005', 'Large',   'كبير',  3000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0060001', 'f1f70000-0000-4000-8000-00000000e006', 'Regular', 'عادي',  4000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0060002', 'f1f70000-0000-4000-8000-00000000e006', 'Large',   'كبير',  5000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0070001', 'f1f70000-0000-4000-8000-00000000e007', 'Regular', 'عادي',  5000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0070002', 'f1f70000-0000-4000-8000-00000000e007', 'Large',   'كبير',  6000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0080001', 'f1f70000-0000-4000-8000-00000000e008', 'Regular', 'عادي',  6000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0080002', 'f1f70000-0000-4000-8000-00000000e008', 'Large',   'كبير',  7000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0090001', 'f1f70000-0000-4000-8000-00000000e009', 'Regular', 'عادي',  5000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0090002', 'f1f70000-0000-4000-8000-00000000e009', 'Large',   'كبير',  7000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0100001', 'f1f70000-0000-4000-8000-00000000e010', 'Regular', 'عادي',  4000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0100002', 'f1f70000-0000-4000-8000-00000000e010', 'Large',   'كبير',  6000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0110001', 'f1f70000-0000-4000-8000-00000000e011', 'Regular', 'عادي',  6000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0110002', 'f1f70000-0000-4000-8000-00000000e011', 'Large',   'كبير',  8000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0120001', 'f1f70000-0000-4000-8000-00000000e012', 'Small',   'صغير',  1000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0120002', 'f1f70000-0000-4000-8000-00000000e012', 'Large',   'كبير',  2000, false, 2),
  ('f1f70000-0000-4000-8000-0000f0130001', 'f1f70000-0000-4000-8000-00000000e013', 'Regular', 'عادي',  7000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0140001', 'f1f70000-0000-4000-8000-00000000e014', 'Regular', 'عادي',  6000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0150001', 'f1f70000-0000-4000-8000-00000000e015', 'Regular', 'عادي',  5000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0160001', 'f1f70000-0000-4000-8000-00000000e016', 'Regular', 'عادي',  6000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0170001', 'f1f70000-0000-4000-8000-00000000e017', 'Regular', 'عادي',  8000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0180001', 'f1f70000-0000-4000-8000-00000000e018', 'Regular', 'عادي',  9000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0190001', 'f1f70000-0000-4000-8000-00000000e019', 'Regular', 'عادي', 10000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0200001', 'f1f70000-0000-4000-8000-00000000e020', 'Regular', 'عادي', 12000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0210001', 'f1f70000-0000-4000-8000-00000000e021', 'Regular', 'عادي',  9000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0220001', 'f1f70000-0000-4000-8000-00000000e022', 'Regular', 'عادي', 11000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0230001', 'f1f70000-0000-4000-8000-00000000e023', 'Regular', 'عادي',  6000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0240001', 'f1f70000-0000-4000-8000-00000000e024', 'Regular', 'عادي',  7000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0250001', 'f1f70000-0000-4000-8000-00000000e025', 'Regular', 'عادي',  6000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0260001', 'f1f70000-0000-4000-8000-00000000e026', 'Regular', 'عادي',  5000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0270001', 'f1f70000-0000-4000-8000-00000000e027', 'Regular', 'عادي',  4000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0280001', 'f1f70000-0000-4000-8000-00000000e028', 'Regular', 'عادي',  8000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0290001', 'f1f70000-0000-4000-8000-00000000e029', 'Regular', 'عادي',  7000, true,  1),
  ('f1f70000-0000-4000-8000-0000f0300001', 'f1f70000-0000-4000-8000-00000000e030', 'Regular', 'عادي',  5000, true,  1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Unit costs (0027 menu_item_costs, manager|owner-only) — 12 of 30 items. The
-- other 18 deliberately have NO row: a missing cost means "unknown" and must
-- surface as reduced coverage in margin analytics, never as a zero.
-- ---------------------------------------------------------------------------
insert into menu_item_costs (item_id, cost_iqd) values
  ('f1f70000-0000-4000-8000-00000000e001',  700), -- espresso
  ('f1f70000-0000-4000-8000-00000000e002', 1100), -- cappuccino
  ('f1f70000-0000-4000-8000-00000000e003', 1200), -- latte
  ('f1f70000-0000-4000-8000-00000000e005',  400), -- karak tea
  ('f1f70000-0000-4000-8000-00000000e007', 1300), -- iced latte
  ('f1f70000-0000-4000-8000-00000000e009', 1500), -- fresh orange juice
  ('f1f70000-0000-4000-8000-00000000e018', 3800), -- chicken club sandwich
  ('f1f70000-0000-4000-8000-00000000e019', 4500), -- beef burger
  ('f1f70000-0000-4000-8000-00000000e020', 3500), -- margherita pizza
  ('f1f70000-0000-4000-8000-00000000e023', 2200), -- kunafa
  ('f1f70000-0000-4000-8000-00000000e024', 1800), -- cheesecake
  ('f1f70000-0000-4000-8000-00000000e027',  900)  -- french fries
on conflict (item_id) do nothing;

-- ---------------------------------------------------------------------------
-- Modifier groups + modifiers (price deltas in round IQD)
-- ---------------------------------------------------------------------------
insert into modifier_groups (id, name_en, name_ar, min_select, max_select) values
  ('f1f70000-0000-4000-8000-00000000d001', 'Milk Type',  'نوع الحليب',     0, 1),
  ('f1f70000-0000-4000-8000-00000000d002', 'Extra Shot', 'جرعة إضافية',    0, 2),
  ('f1f70000-0000-4000-8000-00000000d003', 'Sides',      'إضافات جانبية',  0, 3),
  -- Reveal pair (0028): d004 is linked to burger/club; d005 is reached ONLY by
  -- choosing d401 (never linked to an item), so its min_select=1 applies only then.
  ('f1f70000-0000-4000-8000-00000000d004', 'Make it a meal', 'اجعلها وجبة',  0, 1),
  ('f1f70000-0000-4000-8000-00000000d005', 'Pick a drink',   'اختر مشروبك',  1, 1)
on conflict (id) do nothing;

insert into modifiers (id, group_id, name_en, name_ar, price_delta_iqd, sort_order, is_active) values
  ('f1f70000-0000-4000-8000-00000000d101', 'f1f70000-0000-4000-8000-00000000d001', 'Whole Milk',     'حليب كامل الدسم',       0, 1, true),
  ('f1f70000-0000-4000-8000-00000000d102', 'f1f70000-0000-4000-8000-00000000d001', 'Skimmed Milk',   'حليب خالي الدسم',       0, 2, true),
  ('f1f70000-0000-4000-8000-00000000d103', 'f1f70000-0000-4000-8000-00000000d001', 'Oat Milk',       'حليب شوفان',         1000, 3, true),
  ('f1f70000-0000-4000-8000-00000000d201', 'f1f70000-0000-4000-8000-00000000d002', 'Extra Espresso Shot', 'جرعة إسبريسو إضافية', 1000, 1, true),
  ('f1f70000-0000-4000-8000-00000000d301', 'f1f70000-0000-4000-8000-00000000d003', 'Extra Cheese',   'جبنة إضافية',        1500, 1, true),
  ('f1f70000-0000-4000-8000-00000000d302', 'f1f70000-0000-4000-8000-00000000d003', 'Garlic Sauce',   'صوص ثوم',             500, 2, true),
  ('f1f70000-0000-4000-8000-00000000d303', 'f1f70000-0000-4000-8000-00000000d003', 'Pickles',        'مخلل',                500, 3, true),
  ('f1f70000-0000-4000-8000-00000000d401', 'f1f70000-0000-4000-8000-00000000d004', 'Meal upgrade',   'ترقية لوجبة',        3000, 1, true),
  ('f1f70000-0000-4000-8000-00000000d501', 'f1f70000-0000-4000-8000-00000000d005', 'Cola',           'كولا',                  0, 1, true),
  ('f1f70000-0000-4000-8000-00000000d502', 'f1f70000-0000-4000-8000-00000000d005', 'Water',          'ماء',                   0, 2, true),
  ('f1f70000-0000-4000-8000-00000000d503', 'f1f70000-0000-4000-8000-00000000d005', 'Iced tea',       'شاي مثلج',            500, 3, true)
on conflict (id) do nothing;

-- Item <-> modifier group links
insert into menu_item_modifier_groups (item_id, group_id, sort_order) values
  -- Milk type on milk-based coffees / hot chocolate
  ('f1f70000-0000-4000-8000-00000000e002', 'f1f70000-0000-4000-8000-00000000d001', 1),
  ('f1f70000-0000-4000-8000-00000000e003', 'f1f70000-0000-4000-8000-00000000d001', 1),
  ('f1f70000-0000-4000-8000-00000000e006', 'f1f70000-0000-4000-8000-00000000d001', 1),
  ('f1f70000-0000-4000-8000-00000000e007', 'f1f70000-0000-4000-8000-00000000d001', 1),
  ('f1f70000-0000-4000-8000-00000000e008', 'f1f70000-0000-4000-8000-00000000d001', 1),
  -- Extra shot on espresso-based drinks
  ('f1f70000-0000-4000-8000-00000000e001', 'f1f70000-0000-4000-8000-00000000d002', 2),
  ('f1f70000-0000-4000-8000-00000000e002', 'f1f70000-0000-4000-8000-00000000d002', 2),
  ('f1f70000-0000-4000-8000-00000000e003', 'f1f70000-0000-4000-8000-00000000d002', 2),
  ('f1f70000-0000-4000-8000-00000000e007', 'f1f70000-0000-4000-8000-00000000d002', 2),
  ('f1f70000-0000-4000-8000-00000000e008', 'f1f70000-0000-4000-8000-00000000d002', 2),
  -- Sides on savoury items
  ('f1f70000-0000-4000-8000-00000000e018', 'f1f70000-0000-4000-8000-00000000d003', 1),
  ('f1f70000-0000-4000-8000-00000000e019', 'f1f70000-0000-4000-8000-00000000d003', 1),
  ('f1f70000-0000-4000-8000-00000000e027', 'f1f70000-0000-4000-8000-00000000d003', 1),
  ('f1f70000-0000-4000-8000-00000000e028', 'f1f70000-0000-4000-8000-00000000d003', 1),
  ('f1f70000-0000-4000-8000-00000000e029', 'f1f70000-0000-4000-8000-00000000d003', 1),
  -- Make it a meal on club / burger (d005 is intentionally absent here)
  ('f1f70000-0000-4000-8000-00000000e018', 'f1f70000-0000-4000-8000-00000000d004', 2),
  ('f1f70000-0000-4000-8000-00000000e019', 'f1f70000-0000-4000-8000-00000000d004', 2)
on conflict do nothing;

-- Modifier reveals (0028): picking "Meal upgrade" (d401) reveals "Pick a drink"
-- (d005). Depth is 1 by design — d005's own modifiers reveal nothing.
insert into modifier_reveals (modifier_id, group_id, sort_order) values
  ('f1f70000-0000-4000-8000-00000000d401', 'f1f70000-0000-4000-8000-00000000d005', 0)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Allergen links — allergens are SEEDED by code (supabase/seed.sql §3), so we
-- resolve ids by code rather than hardcoding non-fixture uuids.
-- ---------------------------------------------------------------------------
insert into menu_item_allergens (item_id, allergen_id)
select v.item_id::uuid, a.id
  from (values
    ('f1f70000-0000-4000-8000-00000000e002', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e003', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e005', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e006', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e007', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e008', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e009', 'vegan'),
    ('f1f70000-0000-4000-8000-00000000e010', 'vegan'),
    ('f1f70000-0000-4000-8000-00000000e011', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e013', 'eggs'),
    ('f1f70000-0000-4000-8000-00000000e013', 'spicy'),
    ('f1f70000-0000-4000-8000-00000000e013', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e014', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e014', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e015', 'vegan'),
    ('f1f70000-0000-4000-8000-00000000e016', 'eggs'),
    ('f1f70000-0000-4000-8000-00000000e016', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e017', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e017', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e018', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e019', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e019', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e020', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e020', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e020', 'vegetarian'),
    ('f1f70000-0000-4000-8000-00000000e021', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e021', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e022', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e022', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e023', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e023', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e024', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e024', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e024', 'eggs'),
    ('f1f70000-0000-4000-8000-00000000e025', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e025', 'eggs'),
    ('f1f70000-0000-4000-8000-00000000e026', 'vegan'),
    ('f1f70000-0000-4000-8000-00000000e027', 'vegan'),
    ('f1f70000-0000-4000-8000-00000000e029', 'dairy'),
    ('f1f70000-0000-4000-8000-00000000e029', 'gluten'),
    ('f1f70000-0000-4000-8000-00000000e030', 'nuts')
  ) as v(item_id, code)
  join allergens a on a.code = v.code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Addon suggestions (upsell): 8 links
-- ---------------------------------------------------------------------------
insert into addon_suggestions (item_id, suggested_item_id, sort_order) values
  ('f1f70000-0000-4000-8000-00000000e001', 'f1f70000-0000-4000-8000-00000000e012', 1), -- espresso -> water
  ('f1f70000-0000-4000-8000-00000000e002', 'f1f70000-0000-4000-8000-00000000e025', 1), -- cappuccino -> brownie
  ('f1f70000-0000-4000-8000-00000000e017', 'f1f70000-0000-4000-8000-00000000e005', 1), -- kahi -> karak tea
  ('f1f70000-0000-4000-8000-00000000e018', 'f1f70000-0000-4000-8000-00000000e027', 1), -- club -> fries
  ('f1f70000-0000-4000-8000-00000000e019', 'f1f70000-0000-4000-8000-00000000e027', 1), -- burger -> fries
  ('f1f70000-0000-4000-8000-00000000e019', 'f1f70000-0000-4000-8000-00000000e012', 2), -- burger -> water
  ('f1f70000-0000-4000-8000-00000000e020', 'f1f70000-0000-4000-8000-00000000e010', 1), -- pizza -> lemon & mint
  ('f1f70000-0000-4000-8000-00000000e023', 'f1f70000-0000-4000-8000-00000000e004', 1), -- kunafa -> turkish coffee
  ('f1f70000-0000-4000-8000-00000000e028', 'f1f70000-0000-4000-8000-00000000e027', 1)  -- tenders -> fries
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- cafe_settings overrides (0029 seeds every key with its registry default via
-- `on conflict do nothing`; the fixture switches the hero to "featured" Kahi at
-- 15% off — 8000 -> 6800 — and fills the ticker). Values are jsonb literals.
-- The e2e suite orders Cappuccino, which the discount does not touch.
-- ---------------------------------------------------------------------------
insert into cafe_settings (key, value, is_public) values
  ('hero_mode',             '"featured"',                                    true),
  ('featured_item_id',      '"f1f70000-0000-4000-8000-00000000e017"',      true), -- kahi with geymar
  ('featured_label_en',     '"A true Baghdadi breakfast"',                   true),
  ('featured_label_ar',     '"فطور بغدادي أصيل"',                            true),
  ('featured_badge_en',     '"New"',                                         true),
  ('featured_badge_ar',     '"جديد"',                                        true),
  ('featured_discount_pct', '15',                                            true),
  ('ticker_en',             '["Fresh beans roasted weekly","Pay at the desk","Free Wi-Fi: touchcafe"]', true),
  ('ticker_ar',             '["حبوب طازجة تُحمّص أسبوعيًا","الدفع عند الكاشير","واي فاي مجاني: touchcafe"]', true)
on conflict (key) do update set value = excluded.value;

commit;
