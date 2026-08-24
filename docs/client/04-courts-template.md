# Courts & Rates Template / قالب الملاعب والأسعار

Needed **Week 1** — without it, the booking system cannot be configured or tested (SOW
section 11). Fill in `04-courts-template.csv` plus the questions below.

مطلوب في **الأسبوع الأول** — بدونه لا يمكن إعداد نظام الحجز أو اختباره.

## Per court / لكل ملعب

| Column | Meaning / المعنى | Example |
|---|---|---|
| `court_name_en` / `court_name_ar` | Court name / اسم الملعب | `Court 1` / `ملعب ١` |
| `indoor_outdoor` | `indoor` or `outdoor` / داخلي أم خارجي | `indoor` |
| `duration_options_min` | Bookable durations in minutes, separated by `;` / مدد الحجز بالدقائق | `60;90;120` |

## Rate rules — one row per price rule / قواعد الأسعار

Prices can differ by day of week, time window and duration. One row per rule:

| Column | Meaning / المعنى | Example |
|---|---|---|
| `days` | Days this rule covers: `Mon;Tue;...` or `all` / الأيام | `Fri;Sat` |
| `window_start` / `window_end` | Time window, 24h clock / الفترة الزمنية | `17:00` / `23:00` |
| `duration_min` | Which duration this price is for / المدة | `90` |
| `price_iqd` | Price, whole IQD / السعر بالدينار | `45000` |

Whole dinars only — `45000` means 45,000 IQD. Every hour a court is open must be covered by
some rule; tell us what the default (off-peak) price is.

## Also confirm in writing / أكدوا كتابياً أيضاً

1. **Opening hours** per day of week (e.g. Sat–Thu 09:00–24:00, Fri 13:00–24:00).
   ساعات العمل لكل يوم.
2. **Closed days** — weekly closures and known holiday closures. أيام الإغلاق.
3. **Cancellation window** — how long before the start a guest can cancel a booking
   (e.g. free cancellation up to 6 hours before; after that, no cancellation).
   مهلة الإلغاء قبل موعد الحجز.
