# Touch Padel — What We Need From You / ما نحتاجه منكم

The build is four weeks. Every item below is client-side, and the contract (Scope of Work,
section 11) is explicit: **a week's delay here is a week off the end.**

مدة البناء أربعة أسابيع فقط. كل بند أدناه من جهة العميل، وأي تأخير أسبوع هنا يعني أسبوعاً أقل في النهاية.

> **Status 2026-08-30** (after intake pack 2, 16/21): answered — items 1, 2 (Mustafa), 3-partial
> (courts + hours + cancellation ✓, **rates still missing**), 4 ✓, 5 (sent via WhatsApp — not yet
> in the build), 7 (domain chosen: `touch-padel.com`, recovery in progress), 8 ✓, 14-partial
> (printer arrived, UPS in hand; model unverified), 15 ✓ (training agreed), PITR → **decided:
> daily backups only** (see below). Still open: rates, menu (6), copy (9), floor (10), recipes
> (11), ingredients (12), staff (13), fonts, static IP (we handle at install). Current chase
> list: `07-outstanding-2026-08-30.md`.

## Contract items (SOW section 11)

| # | Item / البند | Needed by | Consequence if late (per SOW) |
|---|---|---|---|
| 1 | Down payment / الدفعة الأولى | Before start | The four-week build begins on receipt, not before |
| 2 | Named approver available weekly / موافق معتمد متاح أسبوعياً | Throughout | Phase acceptance cannot be signed |
| 3 | Court list, hours, rates, cancellation policy / قائمة الملاعب، الأوقات، الأسعار، سياسة الإلغاء | **Week 1** | Module 2 (booking) cannot be configured or tested |
| 4 | Trading currency and tax decision / قرار العملة والضريبة | **Week 1** | Till and reporting cannot be finalised |
| 5 | Branding assets — logo, colours, photography / أصول العلامة التجارية | **Week 1** | Interfaces ship in placeholder styling |
| 6 | Full menu with prices, sizes and modifiers / القائمة الكاملة بالأسعار والأحجام والإضافات | **Week 1** | Track C has nothing to render; the website slips |
| 7 | Domain registered, with DNS access / النطاق مسجل مع صلاحية DNS | **Week 1** | The website cannot go live on Touch's domain |
| 8 | Supabase account funded in Touch's name / حساب Supabase ممول باسم Touch | **Week 1** | Production cannot be provisioned; the system stays on development limits |
| 9 | English and Arabic copy for all content / النصوص بالإنجليزية والعربية | Week 2 | The Arabic build cannot be accepted |
| 10 | Table numbering and floor layout / ترقيم الطاولات ومخطط الأرضية | Week 2 | QR artwork cannot be issued |
| 11 | Measured recipes per product / وصفات مقاسة لكل منتج | Week 2 | Module 5 cannot be delivered — **the single largest risk in this phase** |
| 12 | Ingredients — pack size, cost, supplier, shelf life / المكونات — حجم العبوة، الكلفة، المورد، مدة الصلاحية | Week 2 | Margin reporting and batch expiry are unusable |
| 13 | Staff list with intended roles / قائمة الموظفين وأدوارهم | Week 3 | Accounts cannot be created for training |
| 14 | Hardware in place — till, kitchen screen, printer, network / الأجهزة في مكانها | Week 3 | Installation and testing cannot proceed |
| 15 | Staff available for training / الموظفون متاحون للتدريب | Week 5 | Handover is incomplete |

## Additional items (practical, same deadlines)

| Item / البند | Needed by | Why |
|---|---|---|
| **Font license files**: Next Art (Latin) + Frutiger LT Arabic — the actual licensed font files, not screenshots / ملفات ترخيص الخطوط | Week 1 | Brand fonts cannot ship without the licensed files; until then we build with free stand-ins and swap later |
| **Printer purchase confirmation** — model per `01-printer-spec.md` / تأكيد شراء الطابعة | Week 1 (order), Week 3 (installed) | Receipt and kitchen printing cannot be tested on real hardware otherwise |
| **Till machine static IP / DHCP reservation** on the venue network / عنوان IP ثابت لجهاز الكاشير | Week 3 | The kitchen screen finds the till over the local network by address; if the address changes, kitchen tickets stop |
| **Supabase region**: create the project in **Frankfurt (eu-central-1)** / منطقة Supabase: فرانكفورت | Week 1 (with item 8) | Closest well-supported region to Iraq; changing region later means a migration |
| **PITR sign-off** (see below) / موافقة على كلفة الاسترجاع الزمني | Week 1 | Cost decision — needs your written OK |

## Point-in-time recovery (PITR) — cost note

The Scope of Work promises point-in-time database recovery. On Supabase, PITR is a **paid
add-on on top of the ~$25/mo Pro plan** (roughly $100/mo at the entry tier, billed by Supabase
to Touch's account like the rest of the database service). Two honest options:

1. **PITR on** — restore the database to any minute in the last 7 days. Recommended once real
   trading data exists.
2. **Daily backups only** (included in Pro) — restore to the previous day at worst.

Please confirm in writing which option Touch funds. This is a Supabase cost, not a Kagu fee
(SOW: only Supabase and the domain are billed to Touch).

يرجى التأكيد كتابياً أي الخيارين تعتمدون: الاسترجاع الزمني الكامل (إضافة مدفوعة) أم النسخ الاحتياطي اليومي فقط.

> **Decided 2026-08-30: option 2 — daily backups only** (owner decision, superseding the pack's
> "pitr" answer). Written acknowledgment of the SOW deviation requested in
> `07-outstanding-2026-08-30.md` §4.
