# Recipes & Ingredients Template / قالب الوصفات والمكونات

**The contract names this the single largest risk of the whole phase.** Stock tracking, margin
reporting and batch expiry all depend on it. Without measured recipes, Module 5 cannot be
delivered.

**العقد يسمي هذا البند أكبر خطر في المرحلة كلها.** بدون وصفات مقاسة لا يمكن تسليم نظام المخزون.

## The one rule: MEASURED quantities / القاعدة الوحيدة: كميات مقاسة

Every recipe line needs a **number and a unit**, weighed or measured in the kitchen — not
estimated from memory at a desk.

- Good / صحيح: `Espresso beans, 18, g` · `Milk, 220, ml` · `Tortilla, 1, pc`
- Useless / غير مقبول: "a scoop", "some milk", "a handful" / "ملعقة"، "قليل من الحليب"

Units allowed: **g** (grams / غرام), **ml** (millilitres / ملليلتر), **pc** (pieces / قطعة).
Nothing else. If the kitchen has no scale, buying a $10 kitchen scale this week is the
cheapest fix in the entire project.

## Fill in `03-recipes-template.csv` — three sheets

### Sheet 1: `RECIPES` — one row per product + size + ingredient

| Column | Meaning | Example |
|---|---|---|
| `item_en` / `item_ar` | Product (must match the menu file) | `Cappuccino` / `كابتشينو` |
| `size_en` | Size (must match the menu file) | `Large` |
| `ingredient_or_subrecipe` | Ingredient name — or a sub-recipe name from Sheet 2 | `Espresso beans` |
| `quantity` | Number only | `18` |
| `unit` | `g`, `ml`, or `pc` | `g` |

### Sheet 2: `SUB-RECIPES` — things you prepare in batches and use inside other recipes

E.g. garlic sauce, syrup, dough. Same columns as Sheet 1, but the first column is the
sub-recipe name and the rows are what goes into **one batch**, plus one row stating the batch
yield (e.g. `YIELD, 1000, ml`). Sub-recipes may contain only raw ingredients — a sub-recipe
inside another sub-recipe is not supported in this phase.

### Sheet 3: `INGREDIENTS` — one row per raw ingredient you buy

| Column | Meaning / المعنى | Example |
|---|---|---|
| `name_en` / `name_ar` | Ingredient name / اسم المكون | `Espresso beans` / `حبوب إسبريسو` |
| `pack_size` | Size of one purchased pack, with unit / حجم العبوة | `1000 g` |
| `pack_cost_iqd` | Cost of one pack, whole IQD / كلفة العبوة بالدينار | `25000` |
| `supplier` | Who you buy it from / المورد | `Al-Rasheed Foods` |
| `shelf_life_days` | Days it keeps after opening/delivery / مدة الصلاحية بالأيام | `90` |

Pack size + pack cost is how the system computes the real cost of every drink and dish sold.
Shelf life drives the expiry warnings on stock batches.
