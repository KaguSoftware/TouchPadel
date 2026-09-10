# Menu Template / قالب القائمة

Fill in `02-menu-template.csv` — one row per **item + size** combination. Send it back as
CSV or Excel; we import it directly, nothing is retyped by hand.

املأوا ملف `02-menu-template.csv` — صف واحد لكل منتج + حجم. أرسلوه كملف CSV أو Excel.

## Rules / القواعد

- **Every text field needs BOTH English and Arabic.** Empty Arabic = the app shows English
  in the Arabic interface, which will fail acceptance.
  كل حقل نصي يحتاج الإنجليزية والعربية معاً.
- **Prices are whole Iraqi dinars.** `7000` means 7,000 IQD. No decimals, no thousands
  separators, no currency symbol.
  الأسعار بالدينار العراقي كأرقام صحيحة فقط: `7000` تعني ٧٠٠٠ دينار.
- An item with one size still gets one row — put `Regular` / `عادي` as the size.
- Modifiers (extras, options): list the **group** (e.g. "Milk" / "الحليب"), each **option**
  (e.g. "Oat milk" / "حليب الشوفان"), and the **price delta** in IQD (`0` if free,
  `1000` if it adds 1,000 IQD). One modifier option per row is fine — repeat the item columns.
- **Allergens**: list from: gluten, dairy, eggs, nuts, peanuts, sesame, soy, fish, shellfish —
  comma-separated. Leave empty if none.
  مسببات الحساسية: غلوتين، ألبان، بيض، مكسرات، فول سوداني، سمسم، صويا، سمك، محار.

## Columns / الأعمدة

| Column | Meaning / المعنى | Example |
|---|---|---|
| `category_en` / `category_ar` | Menu section / القسم | `Hot Drinks` / `مشروبات ساخنة` |
| `item_en` / `item_ar` | Item name / اسم المنتج | `Cappuccino` / `كابتشينو` |
| `description_en` / `description_ar` | Short description (optional) / وصف قصير | `Double shot, steamed milk` |
| `size_en` / `size_ar` | Size name / الحجم | `Large` / `كبير` |
| `price_iqd` | Price, whole IQD / السعر بالدينار | `7000` |
| `modifier_group_en` / `modifier_group_ar` | Option group (optional) / مجموعة الخيارات | `Milk` / `الحليب` |
| `modifier_option_en` / `modifier_option_ar` | Option name / الخيار | `Oat milk` / `حليب الشوفان` |
| `modifier_price_delta_iqd` | Added cost, whole IQD (0 = free) / السعر الإضافي | `1000` |
| `allergens` | Comma-separated list / مسببات الحساسية | `dairy` |
