-- ===========================================================================
-- 0190 — Touch's real ingredients and recipes replace the example stock data.
--
-- DATA, NOT SCHEMA. Generated from packages/db/client-data/recipes-2026-09-25.json, which is
-- transcribed from the kitchen's Arabic text kept verbatim beside it
-- (recipes-2026-09-25.ar.txt; English in recipes-2026-09-25.en.txt). Every id, name and
-- quantity below comes from that JSON; its "from" fields quote the Arabic each number came
-- from. Client data rides the migration path for the same reason as 0056: nothing else
-- reaches the hosted project. Ingredient ids are fixed:
-- uuid5(uuid5(NAMESPACE_URL, 'https://touch-padel.com/stock/ingredients'), key).
--
-- OWNER DECISIONS, 2026-09-25 (Majed). This is a deliberate exception to HANDOFF's
-- "additive migrations only":
--   * every ingredient row on the database was an example: remove them all, retail rows
--     included, with everything tied to them;
--   * remove them fully rather than switching them off;
--   * load the ingredients and every ready recipe together, now.
--
-- WHAT GOES. Every ingredient that exists when this runs, and with it: its stock movements,
-- batches, count lines (and counts left empty), delivery lines (and deliveries left empty),
-- recipe lines, every recipe change request, and every negative_stock, low_stock and
-- expiring_soon alert. No example stock is left in stock or cost reports; the audit trail
-- keeps its history. Shopping items and purchase lines are money and request history, so
-- they are KEPT: they lose the ingredient link and keep their own label, or take the
-- ingredient's name when they have none (their CHECK wants one or the other). Purchases
-- keep everything except the link to a delivery that no longer exists.
-- Removing the retail rows ends stock tracking for shop products: with no retail line a
-- shop product is always orderable and its sales consume nothing, until retail rows are
-- created again.
-- ROLLBACK. DB Migrate snapshots stock_movements (with the other ledgers) as a 7-day
-- artifact before it pushes. Nothing else deleted here is kept anywhere.
--
-- LOCKS. Every stock table this touches is locked up front, in the order the writers take
-- them (purchases -> counts -> deliveries -> batches -> movements -> recipes -> ingredients),
-- so a busy till or goods-in makes this fail cleanly within lock_timeout (3 s) instead of
-- deadlocking. A failed run changes nothing; dispatch DB Migrate again once it is quiet.
--
-- THE APPEND-ONLY GUARD COMES OFF FOR ONE STATEMENT. stock_movements_ao (0018:49) raises on
-- any DELETE. It is disabled for the single DELETE below and re-enabled on the next line, in
-- the same transaction (the CLI wraps a migration in one): a failure anywhere rolls the whole
-- file back with the trigger still attached. Precedents: 0114:41-48 and 0127.
--
-- WHAT COMES IN. 63 purchased ingredients and 12 batch-made (prepared) items at the
-- menu's own venue. 8 batch recipes (47 lines, per ONE unit of output: qty / batch
-- yield to 3 decimals) and 28 menu-size recipes (63 lines). Rainbow cake, Milk cake,
-- Muffin and Chocolate ice cream load switched off: nothing on the menu uses them yet.
-- Held back (38 menu recipes): the ones with a missing number or ingredient, or waiting on
-- the hot/iced decision (Q04). Some LOADED recipes still rest on readings the JSON asks the
-- kitchen to confirm (vanilla ice cream in the milkshakes and frappuccinos, Q23; the flavour
-- sauces, Q24; iced Flat White made like hot, Q32); a later migration corrects any that the
-- answers change.
--
-- GO-LIVE EFFECT (owner accepted). A menu item with a recipe shows as blocked by stock at
-- the till and greyed on the website while a bought ingredient it uses has 0 on hand. A
-- batch-made item at 0 is looked through to its own ingredients, so desserts and ice-cream
-- drinks become sellable once the raws are in even with no batch recorded; a chef records
-- each batch before service, or those sales overdraw the batch item at no cost. Receive
-- opening stock through Receive delivery with real unit costs, not through a stock count.
-- A line added to an order before its ingredients have a cost records 0 and keeps it.
-- Do not receive passion fruit, coconut, peanuts or liquid cream until Q06, Q28 and Q17
-- are answered: the first delivery fixes an ingredient's unit.
-- A sale made before this lands and refunded after it restocks by the NEW recipe.
--
-- ONLY WHERE THE REAL MENU IS. The recipes hang off the sizes seeded by
-- seeds/touch-cafe-menu.sql (checked against the live menu 2026-09-25: all 72 items and 73
-- sizes, same ids). A database without that menu (CI, a fresh local reset: the menu is loaded
-- by `pnpm db:menu`, after migrations) is left untouched with a notice, so the dev and test
-- fixtures survive; a dev stack that does have the real menu needs `pnpm db:fixtures` again
-- afterwards. A database with only PART of those sizes, or with them at more than one venue,
-- stops the migration.
--
-- AFTER THE PUSH, CHECK (required: the no-menu branch would also go green):
--   the DB Migrate log shows no "0190: the real menu ... is not on this database" notice;
--   select tgenabled from pg_trigger where tgname = 'stock_movements_ao';     -- 'O'
--   select kind, is_active, count(*) from ingredients group by 1, 2;
--     -- purchased/t 63, prepared/t 8, prepared/f 4
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

do $touch_recipes_0190$
declare
  v_sizes uuid[] := array[
    'f1f70000-0000-4000-8000-0000b0001001',
    'f1f70000-0000-4000-8000-0000b0001002',
    'f1f70000-0000-4000-8000-0000b0002001',
    'f1f70000-0000-4000-8000-0000b0009001',
    'f1f70000-0000-4000-8000-0000b0010001',
    'f1f70000-0000-4000-8000-0000b0013001',
    'f1f70000-0000-4000-8000-0000b0019001',
    'f1f70000-0000-4000-8000-0000b0020001',
    'f1f70000-0000-4000-8000-0000b0022001',
    'f1f70000-0000-4000-8000-0000b0023001',
    'f1f70000-0000-4000-8000-0000b0030001',
    'f1f70000-0000-4000-8000-0000b0031001',
    'f1f70000-0000-4000-8000-0000b0033001',
    'f1f70000-0000-4000-8000-0000b0037001',
    'f1f70000-0000-4000-8000-0000b0038001',
    'f1f70000-0000-4000-8000-0000b0039001',
    'f1f70000-0000-4000-8000-0000b0044001',
    'f1f70000-0000-4000-8000-0000b0046001',
    'f1f70000-0000-4000-8000-0000b0049001',
    'f1f70000-0000-4000-8000-0000b0050001',
    'f1f70000-0000-4000-8000-0000b0053001',
    'f1f70000-0000-4000-8000-0000b0054001',
    'f1f70000-0000-4000-8000-0000b0057001',
    'f1f70000-0000-4000-8000-0000b0058001',
    'f1f70000-0000-4000-8000-0000b0059001',
    'f1f70000-0000-4000-8000-0000b0060001',
    'f1f70000-0000-4000-8000-0000b0068001',
    'f1f70000-0000-4000-8000-0000b0070001'
  ]::uuid[];
  v_found int;
  v_venue uuid;
  v_n     int;
begin
  select count(*) into v_found from menu_item_variants where id = any(v_sizes);
  if v_found = 0 then
    raise notice '0190: the real menu (seeds/touch-cafe-menu.sql) is not on this database; ingredients and recipes left as they are';
    return;
  end if;
  if v_found <> cardinality(v_sizes) then
    raise exception '0190: only % of % recipe sizes exist; the menu differs from seeds/touch-cafe-menu.sql',
      v_found, cardinality(v_sizes);
  end if;
  select min(mi.venue_id::text)::uuid, count(distinct mi.venue_id) into v_venue, v_n
    from menu_item_variants v join menu_items mi on mi.id = v.item_id
   where v.id = any(v_sizes);
  if v_n <> 1 then
    raise exception '0190: the recipe sizes sit at % venues; expected exactly one', v_n;
  end if;

  lock table purchases, purchase_lines, shopping_items, stock_counts, stock_count_lines,
             deliveries, delivery_lines, stock_batches, stock_movements, manager_alerts,
             recipe_change_requests, recipe_lines, ingredients
    in exclusive mode;

  -- -------------------------------------------------------------------------
  -- 1. The examples go, with everything tied to them.
  -- -------------------------------------------------------------------------
  create temp table _examples on commit drop as
    select id, name_en from ingredients;

  alter table stock_movements disable trigger stock_movements_ao;
  delete from stock_movements where ingredient_id in (select id from _examples);
  alter table stock_movements enable trigger stock_movements_ao;

  delete from stock_batches where ingredient_id in (select id from _examples);

  delete from stock_count_lines where ingredient_id in (select id from _examples);
  delete from stock_counts c
   where not exists (select 1 from stock_count_lines l where l.count_id = c.id);

  delete from delivery_lines where ingredient_id in (select id from _examples);
  update purchases p set delivery_id = null
   where p.delivery_id in (select d.id from deliveries d
                            where not exists (select 1 from delivery_lines l where l.delivery_id = d.id));
  delete from deliveries d
   where not exists (select 1 from delivery_lines l where l.delivery_id = d.id);

  update shopping_items s
     set label = left(coalesce(nullif(btrim(s.label), ''), e.name_en), 80), ingredient_id = null
    from _examples e
   where s.ingredient_id = e.id;
  update purchase_lines pl
     set label = left(coalesce(nullif(btrim(pl.label), ''), e.name_en), 80), ingredient_id = null
    from _examples e
   where pl.ingredient_id = e.id;

  delete from recipe_change_requests where target in ('variant', 'output');
  delete from recipe_lines
   where ingredient_id in (select id from _examples) or output_ingredient_id in (select id from _examples);
  delete from manager_alerts where kind in ('negative_stock', 'low_stock', 'expiring_soon');

  delete from ingredients where id in (select id from _examples);

  -- -------------------------------------------------------------------------
  -- 2. Touch's ingredients and batch-made items (fixed ids from the JSON).
  -- -------------------------------------------------------------------------
  insert into ingredients (id, kind, name_en, name_ar, unit, is_active, venue_id)
  select v.id::uuid, v.kind::ingredient_kind, v.name_en, v.name_ar, v.unit::stock_unit, v.is_active, v_venue
    from (values
    ('cc44830d-6114-556d-b3ce-fcf095e22a0f', 'purchased', 'Flour', 'طحين', 'g', true),
    ('e3420129-d129-5eb8-b43f-9f9165375699', 'purchased', 'White sugar', 'سكر أبيض', 'g', true),
    ('b07da026-caa9-501c-9119-fcc729864a2e', 'purchased', 'Brown sugar', 'سكر أسمر', 'g', true),
    ('04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 'purchased', 'Milk', 'حليب', 'ml', true),
    ('a9949857-aedc-581c-ad6f-f6cf7d5cd392', 'purchased', 'Cake improver', 'محسن كيك', 'g', true),
    ('38e52981-875f-5a29-a4b9-bd501f17a210', 'purchased', 'Pastry cream powder (crème pâtissière)', 'كريم باتيسير', 'g', true),
    ('ecff0312-c1ea-5bbf-b484-8bbbb245e506', 'purchased', 'Eggs', 'بيض', 'pc', true),
    ('8438e980-c19f-5c47-9438-10d49b208774', 'purchased', 'Baking powder', 'بيكنك باودر', 'g', true),
    ('9e026bb0-37c5-59cd-b034-7070826f70fc', 'purchased', 'Vanilla', 'فانيلا', 'g', true),
    ('96920b08-bf9b-543c-b7bd-839158a4702d', 'purchased', 'Cocoa powder', 'كاكاو بودرة', 'g', true),
    ('85de1405-799c-5d92-83cd-6094e3961656', 'purchased', 'Butter', 'زبدة', 'g', true),
    ('8469b576-e828-52ad-af67-6cd9d960a2c2', 'purchased', 'Belgian chocolate', 'شوكولا بلجيكي', 'g', true),
    ('b9af43a8-b899-53d3-999e-4e26f1376e7a', 'purchased', 'Belgian dark chocolate', 'شوكولا بلجيكي دارك', 'g', true),
    ('e0ced9b1-a36f-5abc-bfa5-c209f156fc95', 'purchased', 'Dark chocolate', 'شوكولا دارك', 'g', true),
    ('52a15a70-104a-5efa-a606-16f76402d867', 'purchased', 'Blonde chocolate', 'شوكولا شقرة', 'g', true),
    ('0dc193d6-9234-5dd6-9edb-588aecc0c893', 'purchased', 'Cream cheese', 'كريم تشيز', 'g', true),
    ('3ca7715c-f557-5bde-8164-03fc9832e533', 'purchased', 'Bega cream cheese', 'جبن بيغا', 'g', true),
    ('5f21d315-c13b-5966-a9fa-589be883a2d9', 'purchased', 'Wili cheese', 'جبن ويلي', 'g', true),
    ('98b69ded-34cb-5bee-b7fc-12619c2830c0', 'purchased', 'Corn starch', 'نشا', 'g', true),
    ('150d7364-4ad5-5733-86bb-c77648b61802', 'purchased', 'Liquid cream (pack)', 'كريمة سائلة (علبة)', 'pc', true),
    ('860791f5-85e1-50ce-84e4-daddb2e55e71', 'purchased', 'Baking soda', 'صودا (بيكربونات)', 'g', true),
    ('b4203683-4d35-541d-b8f4-0c7951136021', 'purchased', 'Yeast', 'خميرة', 'g', true),
    ('02b871c3-14fd-567d-90b0-c8124591fd30', 'purchased', 'Espresso beans', 'بن إسبريسو', 'g', true),
    ('8d50a3ef-40dd-5c6e-9b87-22bdb99f6329', 'purchased', 'Turkish coffee (ground)', 'بن تركي', 'g', true),
    ('e55fc649-917d-5aa4-87d0-10ffa0e48d38', 'purchased', 'Karak tea (dry)', 'شاي كرك (ناشف)', 'g', true),
    ('2220ca63-efe3-536f-95a3-65c9e67b4fcf', 'purchased', 'Lemon tea (dry)', 'شاي ليمون (ناشف)', 'g', true),
    ('febddf62-cb78-59f3-a23e-1173c7077866', 'purchased', 'Dried hibiscus', 'كجرات (كركديه)', 'g', true),
    ('355fee57-f8b6-5164-b7a7-aed985e07b12', 'purchased', 'Lemon', 'ليمون', 'pc', true),
    ('30262671-0333-5fe0-acff-7a69f0946d63', 'purchased', 'Red berry syrup', 'سيروب توت أحمر', 'ml', true),
    ('352073ec-2519-52e3-b8e3-da06ee7bdd1b', 'purchased', 'Passion fruit', 'باشن فروت', 'ml', true),
    ('20025951-d659-5695-afc3-f975d7400909', 'purchased', 'Spanish latte sauce', 'صوص سبانش', 'ml', true),
    ('9aee161a-5ad7-5549-b537-30d9f6bdf28d', 'purchased', 'Mocha sauce', 'صوص موكا', 'ml', true),
    ('3659fdf2-736a-5edf-9a23-3b287b85e1ff', 'purchased', 'Caramel sauce', 'صوص كراميل', 'ml', true),
    ('a5c94334-91d6-5431-9782-a6fa21480b68', 'purchased', 'Vanilla sauce', 'صوص فانيلا', 'ml', true),
    ('dfad096e-ad22-53a3-b844-bffaed8dd5ea', 'purchased', 'Hazelnut sauce', 'صوص بندق', 'ml', true),
    ('581c0400-8636-574f-a4b9-a7a510664803', 'purchased', 'Chocolate sauce', 'صوص شوكولا', 'ml', true),
    ('197cc2e7-0846-5e54-a947-020c418f4613', 'purchased', 'White chocolate sauce', 'صوص شوكولا بيضاء', 'ml', true),
    ('432081d1-474d-520c-a3df-72ed7fac29ce', 'purchased', 'Strawberry sauce', 'صوص فراولة', 'ml', true),
    ('c2b7be04-8332-52fe-bb1a-06ff16d52d7c', 'purchased', 'Lotus sauce', 'صوص لوتس', 'ml', true),
    ('665ad14d-d8ef-5e00-a42d-6054a3fe44f6', 'purchased', 'Pistachio sauce', 'صوص بستاشيو', 'ml', true),
    ('9d8bb645-4f1a-5e76-971b-87204d94f69c', 'purchased', 'Nutella sauce', 'صوص نوتيلا', 'ml', true),
    ('dd3c3b5b-b928-558c-b687-249d7428d1ac', 'purchased', 'Peach sauce', 'صوص خوخ', 'ml', true),
    ('f528771b-3248-58a6-b5c5-dff55b842bb5', 'purchased', 'Mango sauce', 'صوص منكا', 'ml', true),
    ('638c3b11-11ce-5b79-8d12-f1b5e959f72b', 'purchased', 'Pineapple sauce', 'صوص أناناس', 'ml', true),
    ('ffa966ca-bfa5-5586-af83-d9328f8592e6', 'purchased', 'Blue syrup', 'سيروب بلو', 'ml', true),
    ('73291e9d-a9f4-598d-b9f0-65bcb6e511ee', 'purchased', 'Blueberry syrup', 'سيروب بلو بيري', 'ml', true),
    ('abe794b6-d086-5158-bd64-e1e89fe788ee', 'purchased', 'Ice cream powder', 'باودر آيس كريم', 'g', true),
    ('504d3454-f26e-53a2-ac97-ba75aeddca9b', 'purchased', 'Orange', 'برتقال', 'pc', true),
    ('3b1ef6cf-2460-55f1-a5ab-807b26223eeb', 'purchased', 'Strawberries', 'فراولة', 'g', true),
    ('13e77b00-1bde-536a-ba26-f62c9c905a6b', 'purchased', 'Mango', 'منكا', 'g', true),
    ('273af7b7-8ab7-5536-bcf9-8d381d265dc2', 'purchased', 'Pineapple', 'أناناس', 'g', true),
    ('0532f4c7-7832-5172-b013-4d7880f27d81', 'purchased', 'Peach', 'خوخ', 'g', true),
    ('0064529d-5b4c-5835-b98a-64fa1e3d4786', 'purchased', 'Banana', 'موز', 'pc', true),
    ('564659ac-cc55-5f0d-91e9-f7ca918a26be', 'purchased', 'Green apple', 'تفاح أخضر', 'pc', true),
    ('e0d84674-3861-5493-9834-0ada19bb3e41', 'purchased', 'Carrot', 'جزر', 'pc', true),
    ('67fa3e51-6a68-5f7f-a58d-8e0344a7d84f', 'purchased', 'Mint leaves', 'ورق نعناع', 'pc', true),
    ('2935e71f-56bb-59dc-aac3-a05fe7bc16ef', 'purchased', 'Dates', 'تمر', 'pc', true),
    ('98c5cf6d-3535-5b64-ba95-e734c0ed8ce7', 'purchased', 'Peanuts', 'فول سوداني', 'g', true),
    ('84905bd3-500b-5e9e-b69e-a13daf6d82b3', 'purchased', 'Honey', 'عسل', 'g', true),
    ('4edf8d96-cdec-5f88-9277-f22cbbb03380', 'purchased', 'Coconut', 'جوز الهند', 'g', true),
    ('45607610-4fd4-559d-a592-225de1356473', 'purchased', 'Fresh blueberries', 'بلو بيري فرش', 'g', true),
    ('9ff1c117-c81e-50e4-b3b0-bc248cb9eeab', 'purchased', 'Sprite (can)', 'سبرايت (قوطية)', 'pc', true),
    ('d7ba1fbf-75bf-53a7-ba66-34c7b19fab4e', 'purchased', 'Red Bull (can)', 'ريد بول (قوطية)', 'pc', true),
    ('a0a97013-8dd7-5c99-9a16-5db6fc274ad4', 'prepared', 'Rainbow cake (piece)', 'رينبو (قطعة)', 'pc', false),
    ('ba416edf-c87f-59ed-a6df-9b06e2e2d92c', 'prepared', 'Milk cake (piece)', 'كيك حليب (قطعة)', 'pc', false),
    ('42c15c9e-e3be-5b6c-a8ed-7dde46e1fbf3', 'prepared', 'Lazy cake (piece)', 'ليزي كيك (قطعة)', 'pc', true),
    ('6521f51e-2deb-5035-bd6d-371d7950af03', 'prepared', 'San Sebastian cheesecake (piece)', 'سان سباستيان (قطعة)', 'pc', true),
    ('29ce7a4f-699b-52f9-a74e-7b1e63677c47', 'prepared', 'Cookie (piece)', 'كوكيز (قطعة)', 'pc', true),
    ('cbb5d86d-575f-5c88-80bb-34d9ea441f08', 'prepared', 'Muffin (piece)', 'مافن (قطعة)', 'pc', false),
    ('b388a551-9092-5469-a5c5-1ae0e9c7d69e', 'prepared', 'Brownie (cup)', 'براونيز (كاسة)', 'pc', true),
    ('f5f4d298-1595-529a-8e3e-b76dc351a6da', 'prepared', 'Donut (piece)', 'دونات (قطعة)', 'pc', true),
    ('a47f57f0-484e-57df-ab52-6d0983b9ebc8', 'prepared', 'Hibiscus base with passion fruit', 'خلطة كجرات مع باشن فروت', 'ml', true),
    ('008a8a19-19d1-51a4-afc5-e38fbab09c0a', 'prepared', 'Hibiscus base', 'خلطة كجرات', 'ml', true),
    ('24e433d4-dfe5-5f47-8cb9-029d60a58f7b', 'prepared', 'Vanilla ice cream', 'آيس كريم فانيلا', 'g', true),
    ('55b92a66-e3d7-50ff-b7c1-a72bca748e5d', 'prepared', 'Chocolate ice cream', 'آيس كريم شوكولا', 'g', false)
    ) as v(id, kind, name_en, name_ar, unit, is_active);

  -- -------------------------------------------------------------------------
  -- 3. Batch recipes: what ONE unit of each batch-made item takes.
  -- -------------------------------------------------------------------------
  insert into recipe_lines (output_ingredient_id, ingredient_id, qty)
  select v.output_id::uuid, v.ingredient_id::uuid, v.qty
    from (values
    -- Rainbow cake (piece): one batch makes 32 pc
    ('a0a97013-8dd7-5c99-9a16-5db6fc274ad4', 'cc44830d-6114-556d-b3ce-fcf095e22a0f', 17.188),  -- Flour: 550 g / 32
    ('a0a97013-8dd7-5c99-9a16-5db6fc274ad4', 'e3420129-d129-5eb8-b43f-9f9165375699', 17.188),  -- White sugar: 550 g / 32
    ('a0a97013-8dd7-5c99-9a16-5db6fc274ad4', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 15.625),  -- Milk: 500 ml / 32
    ('a0a97013-8dd7-5c99-9a16-5db6fc274ad4', 'a9949857-aedc-581c-ad6f-f6cf7d5cd392', 7.813),  -- Cake improver: 250 g / 32
    ('a0a97013-8dd7-5c99-9a16-5db6fc274ad4', '38e52981-875f-5a29-a4b9-bd501f17a210', 3.125),  -- Pastry cream powder (crème pâtissière): 100 g / 32
    ('a0a97013-8dd7-5c99-9a16-5db6fc274ad4', 'ecff0312-c1ea-5bbf-b484-8bbbb245e506', 1.25),  -- Eggs: 40 pc / 32
    -- Milk cake (piece): one batch makes 16 pc
    ('ba416edf-c87f-59ed-a6df-9b06e2e2d92c', 'e3420129-d129-5eb8-b43f-9f9165375699', 9.375),  -- White sugar: 150 g / 16
    ('ba416edf-c87f-59ed-a6df-9b06e2e2d92c', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 9.375),  -- Milk: 150 ml / 16
    ('ba416edf-c87f-59ed-a6df-9b06e2e2d92c', 'a9949857-aedc-581c-ad6f-f6cf7d5cd392', 4.375),  -- Cake improver: 70 g / 16
    ('ba416edf-c87f-59ed-a6df-9b06e2e2d92c', 'cc44830d-6114-556d-b3ce-fcf095e22a0f', 10.625),  -- Flour: 170 g / 16
    ('ba416edf-c87f-59ed-a6df-9b06e2e2d92c', '8438e980-c19f-5c47-9438-10d49b208774', 1.563),  -- Baking powder: 25 g / 16
    ('ba416edf-c87f-59ed-a6df-9b06e2e2d92c', '38e52981-875f-5a29-a4b9-bd501f17a210', 4.375),  -- Pastry cream powder (crème pâtissière): 70 g / 16
    ('ba416edf-c87f-59ed-a6df-9b06e2e2d92c', 'ecff0312-c1ea-5bbf-b484-8bbbb245e506', 0.75),  -- Eggs: 12 pc / 16
    ('ba416edf-c87f-59ed-a6df-9b06e2e2d92c', '9e026bb0-37c5-59cd-b034-7070826f70fc', 0.313),  -- Vanilla: 5 g / 16
    -- San Sebastian cheesecake (piece): one batch makes 30 pc
    ('6521f51e-2deb-5035-bd6d-371d7950af03', '0dc193d6-9234-5dd6-9edb-588aecc0c893', 100),  -- Cream cheese: 3000 g / 30
    ('6521f51e-2deb-5035-bd6d-371d7950af03', '3ca7715c-f557-5bde-8164-03fc9832e533', 66.667),  -- Bega cream cheese: 2000 g / 30
    ('6521f51e-2deb-5035-bd6d-371d7950af03', '5f21d315-c13b-5966-a9fa-589be883a2d9', 33.333),  -- Wili cheese: 1000 g / 30
    ('6521f51e-2deb-5035-bd6d-371d7950af03', 'e3420129-d129-5eb8-b43f-9f9165375699', 23.333),  -- White sugar: 700 g / 30
    ('6521f51e-2deb-5035-bd6d-371d7950af03', '98b69ded-34cb-5bee-b7fc-12619c2830c0', 6.667),  -- Corn starch: 200 g / 30
    ('6521f51e-2deb-5035-bd6d-371d7950af03', '150d7364-4ad5-5733-86bb-c77648b61802', 0.1),  -- Liquid cream (pack): 3 pc / 30
    ('6521f51e-2deb-5035-bd6d-371d7950af03', 'ecff0312-c1ea-5bbf-b484-8bbbb245e506', 0.833),  -- Eggs: 25 pc / 30
    ('6521f51e-2deb-5035-bd6d-371d7950af03', '9e026bb0-37c5-59cd-b034-7070826f70fc', 0.333),  -- Vanilla: 10 g / 30
    -- Cookie (piece): one batch makes 30 pc
    ('29ce7a4f-699b-52f9-a74e-7b1e63677c47', '85de1405-799c-5d92-83cd-6094e3961656', 13.333),  -- Butter: 400 g / 30
    ('29ce7a4f-699b-52f9-a74e-7b1e63677c47', 'ecff0312-c1ea-5bbf-b484-8bbbb245e506', 0.133),  -- Eggs: 4 pc / 30
    ('29ce7a4f-699b-52f9-a74e-7b1e63677c47', 'cc44830d-6114-556d-b3ce-fcf095e22a0f', 21.667),  -- Flour: 650 g / 30
    ('29ce7a4f-699b-52f9-a74e-7b1e63677c47', 'e3420129-d129-5eb8-b43f-9f9165375699', 4),  -- White sugar: 120 g / 30
    ('29ce7a4f-699b-52f9-a74e-7b1e63677c47', 'b07da026-caa9-501c-9119-fcc729864a2e', 8.667),  -- Brown sugar: 260 g / 30
    ('29ce7a4f-699b-52f9-a74e-7b1e63677c47', '9e026bb0-37c5-59cd-b034-7070826f70fc', 0.167),  -- Vanilla: 5 g / 30
    ('29ce7a4f-699b-52f9-a74e-7b1e63677c47', '860791f5-85e1-50ce-84e4-daddb2e55e71', 0.2),  -- Baking soda: 6 g / 30
    ('29ce7a4f-699b-52f9-a74e-7b1e63677c47', '98b69ded-34cb-5bee-b7fc-12619c2830c0', 0.667),  -- Corn starch: 20 g / 30
    -- Brownie (cup): one batch makes 35 pc
    ('b388a551-9092-5469-a5c5-1ae0e9c7d69e', 'ecff0312-c1ea-5bbf-b484-8bbbb245e506', 0.429),  -- Eggs: 15 pc / 35
    ('b388a551-9092-5469-a5c5-1ae0e9c7d69e', 'b07da026-caa9-501c-9119-fcc729864a2e', 21.429),  -- Brown sugar: 750 g / 35
    ('b388a551-9092-5469-a5c5-1ae0e9c7d69e', 'e3420129-d129-5eb8-b43f-9f9165375699', 17.143),  -- White sugar: 600 g / 35
    ('b388a551-9092-5469-a5c5-1ae0e9c7d69e', 'b9af43a8-b899-53d3-999e-4e26f1376e7a', 28.571),  -- Belgian dark chocolate: 1000 g / 35
    ('b388a551-9092-5469-a5c5-1ae0e9c7d69e', '85de1405-799c-5d92-83cd-6094e3961656', 14.286),  -- Butter: 500 g / 35
    ('b388a551-9092-5469-a5c5-1ae0e9c7d69e', 'cc44830d-6114-556d-b3ce-fcf095e22a0f', 14.286),  -- Flour: 500 g / 35
    ('b388a551-9092-5469-a5c5-1ae0e9c7d69e', '96920b08-bf9b-543c-b7bd-839158a4702d', 5.714),  -- Cocoa powder: 200 g / 35
    ('b388a551-9092-5469-a5c5-1ae0e9c7d69e', '8438e980-c19f-5c47-9438-10d49b208774', 0.343),  -- Baking powder: 12 g / 35
    -- Donut (piece): one batch makes 15 pc
    ('f5f4d298-1595-529a-8e3e-b76dc351a6da', 'cc44830d-6114-556d-b3ce-fcf095e22a0f', 33.333),  -- Flour: 500 g / 15
    ('f5f4d298-1595-529a-8e3e-b76dc351a6da', 'e3420129-d129-5eb8-b43f-9f9165375699', 5),  -- White sugar: 75 g / 15
    ('f5f4d298-1595-529a-8e3e-b76dc351a6da', 'ecff0312-c1ea-5bbf-b484-8bbbb245e506', 0.267),  -- Eggs: 4 pc / 15
    ('f5f4d298-1595-529a-8e3e-b76dc351a6da', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 10),  -- Milk: 150 ml / 15
    ('f5f4d298-1595-529a-8e3e-b76dc351a6da', 'b4203683-4d35-541d-b8f4-0c7951136021', 0.667),  -- Yeast: 10 g / 15
    ('f5f4d298-1595-529a-8e3e-b76dc351a6da', '85de1405-799c-5d92-83cd-6094e3961656', 3.333),  -- Butter: 50 g / 15
    -- Vanilla ice cream: one batch makes 2000 g
    ('24e433d4-dfe5-5f47-8cb9-029d60a58f7b', 'abe794b6-d086-5158-bd64-e1e89fe788ee', 0.25),  -- Ice cream powder: 500 g / 2000
    -- Chocolate ice cream: one batch makes 2075 g
    ('55b92a66-e3d7-50ff-b7c1-a72bca748e5d', 'abe794b6-d086-5158-bd64-e1e89fe788ee', 0.241),  -- Ice cream powder: 500 g / 2075
    ('55b92a66-e3d7-50ff-b7c1-a72bca748e5d', '581c0400-8636-574f-a4b9-a7a510664803', 0.036)  -- Chocolate sauce: 75 ml / 2075
    ) as v(output_id, ingredient_id, qty);

  -- -------------------------------------------------------------------------
  -- 4. Menu recipes: what one sale of each size takes.
  -- -------------------------------------------------------------------------
  insert into recipe_lines (variant_id, ingredient_id, qty)
  select v.variant_id::uuid, v.ingredient_id::uuid, v.qty
    from (values
    -- Coffee / Espresso (Single)
    ('f1f70000-0000-4000-8000-0000b0001001', '02b871c3-14fd-567d-90b0-c8124591fd30', 10),  -- Espresso beans 10 g
    -- Coffee / Espresso (Double)
    ('f1f70000-0000-4000-8000-0000b0001002', '02b871c3-14fd-567d-90b0-c8124591fd30', 18),  -- Espresso beans 18 g
    -- Coffee / Americano (Regular)
    ('f1f70000-0000-4000-8000-0000b0002001', '02b871c3-14fd-567d-90b0-c8124591fd30', 10),  -- Espresso beans 10 g
    -- Coffee / Cortado (Regular)
    ('f1f70000-0000-4000-8000-0000b0009001', '02b871c3-14fd-567d-90b0-c8124591fd30', 20),  -- Espresso beans 20 g
    ('f1f70000-0000-4000-8000-0000b0009001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 50),  -- Milk 50 ml
    -- Coffee / Flat White (Regular)
    ('f1f70000-0000-4000-8000-0000b0010001', '02b871c3-14fd-567d-90b0-c8124591fd30', 20),  -- Espresso beans 20 g
    ('f1f70000-0000-4000-8000-0000b0010001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 110),  -- Milk 110 ml
    -- Tea / Karak Tea (Regular)
    ('f1f70000-0000-4000-8000-0000b0020001', 'e55fc649-917d-5aa4-87d0-10ffa0e48d38', 30),  -- Karak tea (dry) 30 g
    ('f1f70000-0000-4000-8000-0000b0020001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 150),  -- Milk 150 ml
    -- Tea / Lemon Tea (Regular)
    ('f1f70000-0000-4000-8000-0000b0019001', '2220ca63-efe3-536f-95a3-65c9e67b4fcf', 30),  -- Lemon tea (dry) 30 g
    -- Milkshake / Strawberry (Regular)
    ('f1f70000-0000-4000-8000-0000b0037001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 150),  -- Milk 150 ml
    ('f1f70000-0000-4000-8000-0000b0037001', '24e433d4-dfe5-5f47-8cb9-029d60a58f7b', 175),  -- Vanilla ice cream 175 g
    ('f1f70000-0000-4000-8000-0000b0037001', '432081d1-474d-520c-a3df-72ed7fac29ce', 35),  -- Strawberry sauce 35 ml
    -- Milkshake / Lotus (Regular)
    ('f1f70000-0000-4000-8000-0000b0038001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 150),  -- Milk 150 ml
    ('f1f70000-0000-4000-8000-0000b0038001', '24e433d4-dfe5-5f47-8cb9-029d60a58f7b', 175),  -- Vanilla ice cream 175 g
    ('f1f70000-0000-4000-8000-0000b0038001', 'c2b7be04-8332-52fe-bb1a-06ff16d52d7c', 35),  -- Lotus sauce 35 ml
    -- Milkshake / Pistachio (Regular)
    ('f1f70000-0000-4000-8000-0000b0039001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 150),  -- Milk 150 ml
    ('f1f70000-0000-4000-8000-0000b0039001', '24e433d4-dfe5-5f47-8cb9-029d60a58f7b', 175),  -- Vanilla ice cream 175 g
    ('f1f70000-0000-4000-8000-0000b0039001', '665ad14d-d8ef-5e00-a42d-6054a3fe44f6', 35),  -- Pistachio sauce 35 ml
    -- Frappuccino / Caramel (Regular)
    ('f1f70000-0000-4000-8000-0000b0030001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 150),  -- Milk 150 ml
    ('f1f70000-0000-4000-8000-0000b0030001', '24e433d4-dfe5-5f47-8cb9-029d60a58f7b', 175),  -- Vanilla ice cream 175 g
    ('f1f70000-0000-4000-8000-0000b0030001', '3659fdf2-736a-5edf-9a23-3b287b85e1ff', 35),  -- Caramel sauce 35 ml
    ('f1f70000-0000-4000-8000-0000b0030001', '02b871c3-14fd-567d-90b0-c8124591fd30', 10),  -- Espresso beans 10 g
    -- Frappuccino / White Chocolate (Regular)
    ('f1f70000-0000-4000-8000-0000b0031001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 150),  -- Milk 150 ml
    ('f1f70000-0000-4000-8000-0000b0031001', '24e433d4-dfe5-5f47-8cb9-029d60a58f7b', 175),  -- Vanilla ice cream 175 g
    ('f1f70000-0000-4000-8000-0000b0031001', '197cc2e7-0846-5e54-a947-020c418f4613', 35),  -- White chocolate sauce 35 ml
    ('f1f70000-0000-4000-8000-0000b0031001', '02b871c3-14fd-567d-90b0-c8124591fd30', 10),  -- Espresso beans 10 g
    -- Cocktail / Taj Blue (Regular)
    ('f1f70000-0000-4000-8000-0000b0033001', '0064529d-5b4c-5835-b98a-64fa1e3d4786', 0.5),  -- Banana 0.5 pc
    ('f1f70000-0000-4000-8000-0000b0033001', '273af7b7-8ab7-5536-bcf9-8d381d265dc2', 75),  -- Pineapple 75 g
    ('f1f70000-0000-4000-8000-0000b0033001', 'ffa966ca-bfa5-5586-af83-d9328f8592e6', 25),  -- Blue syrup 25 ml
    -- Fresh Juice / Orange (Regular)
    ('f1f70000-0000-4000-8000-0000b0022001', '504d3454-f26e-53a2-ac97-ba75aeddca9b', 3),  -- Orange 3 pc
    -- Fresh Juice / Strawberry (Regular)
    ('f1f70000-0000-4000-8000-0000b0023001', '3b1ef6cf-2460-55f1-a5ab-807b26223eeb', 250),  -- Strawberries 250 g
    -- Smoothie / Passion Fruit (Regular)
    ('f1f70000-0000-4000-8000-0000b0013001', '352073ec-2519-52e3-b8e3-da06ee7bdd1b', 50),  -- Passion fruit 50 ml
    -- Healthy / Green Apple (Regular)
    ('f1f70000-0000-4000-8000-0000b0068001', '564659ac-cc55-5f0d-91e9-f7ca918a26be', 1.5),  -- Green apple 1.5 pc
    -- Healthy / Orange & Carrot (Regular)
    ('f1f70000-0000-4000-8000-0000b0070001', '504d3454-f26e-53a2-ac97-ba75aeddca9b', 2),  -- Orange 2 pc
    ('f1f70000-0000-4000-8000-0000b0070001', 'e0d84674-3861-5493-9834-0ada19bb3e41', 1.5),  -- Carrot 1.5 pc
    -- Milk Drinks / Banana & Nutella Milk (Regular)
    ('f1f70000-0000-4000-8000-0000b0044001', '0064529d-5b4c-5835-b98a-64fa1e3d4786', 0.5),  -- Banana 0.5 pc
    ('f1f70000-0000-4000-8000-0000b0044001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 150),  -- Milk 150 ml
    ('f1f70000-0000-4000-8000-0000b0044001', '9d8bb645-4f1a-5e76-971b-87204d94f69c', 35),  -- Nutella sauce 35 ml
    -- Milk Drinks / Banana Milk (Regular)
    ('f1f70000-0000-4000-8000-0000b0046001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 150),  -- Milk 150 ml
    ('f1f70000-0000-4000-8000-0000b0046001', '0064529d-5b4c-5835-b98a-64fa1e3d4786', 0.5),  -- Banana 0.5 pc
    -- Signature / Court Energy (Regular)
    ('f1f70000-0000-4000-8000-0000b0057001', '98c5cf6d-3535-5b64-ba95-e734c0ed8ce7', 15),  -- Peanuts 15 g
    ('f1f70000-0000-4000-8000-0000b0057001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 100),  -- Milk 100 ml
    ('f1f70000-0000-4000-8000-0000b0057001', '84905bd3-500b-5e9e-b69e-a13daf6d82b3', 10),  -- Honey 10 g
    ('f1f70000-0000-4000-8000-0000b0057001', '2935e71f-56bb-59dc-aac3-a05fe7bc16ef', 2),  -- Dates 2 pc
    ('f1f70000-0000-4000-8000-0000b0057001', '0064529d-5b4c-5835-b98a-64fa1e3d4786', 0.5),  -- Banana 0.5 pc
    -- Signature / Taj Special (Regular)
    ('f1f70000-0000-4000-8000-0000b0058001', '4edf8d96-cdec-5f88-9277-f22cbbb03380', 5),  -- Coconut 5 g
    ('f1f70000-0000-4000-8000-0000b0058001', '45607610-4fd4-559d-a592-225de1356473', 25),  -- Fresh blueberries 25 g
    ('f1f70000-0000-4000-8000-0000b0058001', '73291e9d-a9f4-598d-b9f0-65bcb6e511ee', 10),  -- Blueberry syrup 10 ml
    ('f1f70000-0000-4000-8000-0000b0058001', '24e433d4-dfe5-5f47-8cb9-029d60a58f7b', 100),  -- Vanilla ice cream 100 g
    ('f1f70000-0000-4000-8000-0000b0058001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 120),  -- Milk 120 ml
    -- Signature / Padel Fresh (Regular)
    ('f1f70000-0000-4000-8000-0000b0060001', '3b1ef6cf-2460-55f1-a5ab-807b26223eeb', 100),  -- Strawberries 100 g
    ('f1f70000-0000-4000-8000-0000b0060001', '0064529d-5b4c-5835-b98a-64fa1e3d4786', 0.5),  -- Banana 0.5 pc
    ('f1f70000-0000-4000-8000-0000b0060001', '273af7b7-8ab7-5536-bcf9-8d381d265dc2', 50),  -- Pineapple 50 g
    ('f1f70000-0000-4000-8000-0000b0060001', '13e77b00-1bde-536a-ba26-f62c9c905a6b', 75),  -- Mango 75 g
    ('f1f70000-0000-4000-8000-0000b0060001', '24e433d4-dfe5-5f47-8cb9-029d60a58f7b', 25),  -- Vanilla ice cream 25 g
    -- Signature / Pistachino Macchiato (Regular)
    ('f1f70000-0000-4000-8000-0000b0059001', '02b871c3-14fd-567d-90b0-c8124591fd30', 10),  -- Espresso beans 10 g
    ('f1f70000-0000-4000-8000-0000b0059001', '04ffec2a-a38a-5f0c-8b12-9beb42dfe10b', 150),  -- Milk 150 ml
    ('f1f70000-0000-4000-8000-0000b0059001', '665ad14d-d8ef-5e00-a42d-6054a3fe44f6', 60),  -- Pistachio sauce 60 ml
    -- Desserts / Donut (Regular)
    ('f1f70000-0000-4000-8000-0000b0049001', 'f5f4d298-1595-529a-8e3e-b76dc351a6da', 1),  -- Donut (piece) 1 pc
    -- Desserts / Cookies (Regular)
    ('f1f70000-0000-4000-8000-0000b0050001', '29ce7a4f-699b-52f9-a74e-7b1e63677c47', 1),  -- Cookie (piece) 1 pc
    -- Desserts / San Sebastian (Regular)
    ('f1f70000-0000-4000-8000-0000b0053001', '6521f51e-2deb-5035-bd6d-371d7950af03', 1),  -- San Sebastian cheesecake (piece) 1 pc
    -- Desserts / Brownies (Regular)
    ('f1f70000-0000-4000-8000-0000b0054001', 'b388a551-9092-5469-a5c5-1ae0e9c7d69e', 1)  -- Brownie (cup) 1 pc
    ) as v(variant_id, ingredient_id, qty);

  -- -------------------------------------------------------------------------
  -- 5. Prove it.
  -- -------------------------------------------------------------------------
  select count(*) into v_n from ingredients;
  if v_n <> 75 then
    raise exception '0190: expected 75 ingredients, found %', v_n;
  end if;
  select count(*) into v_n from recipe_lines where output_ingredient_id is not null;
  if v_n <> 47 then
    raise exception '0190: expected 47 batch recipe lines, found %', v_n;
  end if;
  select count(*) into v_n from recipe_lines where variant_id is not null;
  if v_n <> 63 then
    raise exception '0190: expected 63 menu recipe lines, found %', v_n;
  end if;
  select count(*) into v_n from recipe_lines where modifier_id is not null;
  if v_n <> 0 then
    raise exception '0190: % add-on recipe lines survived', v_n;
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'stock_movements_ao' and tgrelid = 'stock_movements'::regclass
                    and tgenabled = 'O') then
    raise exception '0190: stock_movements_ao is not enabled';
  end if;
end $touch_recipes_0190$;
