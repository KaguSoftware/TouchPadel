# Café POS exports from before the system (Morabaa)

Eight PDF exports from the café's old till, Morabaa (شركة المربع للحلول البرمجية,
www.morabaa.com), received from the club over WhatsApp on 2026-10-09/10 — the same delivery
that brought the padel Word reports (`../padel-monthly-2026/`). Archived here verbatim on
2026-11-09; `originals/SHA256SUMS` holds each file's hash. Two exports per month, June to
September 2026:

| File | What it is | Pages | Rows |
|---|---|---|---|
| `2026-0N-orders.pdf` | تقارير مبيعات — one row per order: timestamps, cashier, customer, order type, table, item count, amount, discount, paid, remaining | 413 / 667 / 541 / 681 | 4,122 / 6,665 / 5,403 / 6,806 orders |
| `2026-0N-items.pdf` | تقارير مبيعات مفصلة — one row per line item: product name, unit price, quantity, line total, order no, timestamp | 396 / 607 / 471 / 605 | 6,333 / 9,708 / 7,525 / 9,680 lines |

They are text PDFs, not scans: `pdftotext -layout` extracts every row cleanly (the Arabic
comes out as presentation-form glyphs, so grep for the `|` separators or digits, not for
composed Arabic strings). Row counts above were verified against the till's own sequence
numbers — they match exactly.

## The till's own totals (printed on each orders file's last page, IQD)

| Month | Orders | Gross (المبلغ الكلي) | Discounts (الخصم الكلي) | Paid (المبلغ المدفوع الكلي) |
|---|---|---|---|---|
| June 2026 | 4,122 | 20,946,500 | 611,995 | 20,334,505 |
| July 2026 | 6,665 | 26,678,750 | 403,888 | 26,274,863 |
| August 2026 | 5,403 | 20,050,250 | 387,613 | 19,662,638 |
| September 2026 | 6,806 | 25,205,000 | 568,373 | 24,636,628 |

Remaining (المبلغ المتبقي الكلي) is 0 in every month. The items files print no totals line.
Nothing here is computed by us; the four totals rows are the till's own print.

## Owner-stated context (Majed, 2026-11-09 — estimates, not in any document)

These figures complete the picture but are the owner's word, not till or report data. Keep
them labelled as such wherever they are used; never store them beside the "exactly as
written" data as if a document said them:

- Padel-gear shop sales average ≈ 1,000,000 IQD a month.
- Padel stock on hand is worth ≈ 10,000,000 IQD.
- Women's hours are **not** in Hussein's padel reports; worth ≈ 500,000 IQD a month extra.
- Operational cost ≈ 15,000,000 IQD a month.

## The combined items export (`2026-07-02-to-10-31-items.pdf`)

Received 2026-11-09 as `تقرير مفصل من شهر 6 الئ شهر 11.pdf` (exported from the till that
same evening; 2,209 pages, 35,339 item lines). **Despite its name it holds no June**: the
data runs 2026-07-02 07:41 to 2026-10-31 20:59, and nothing for 1–7 November (the club's
last old-till days before go-live on the 8th). Its value is **October 2026**, which the
monthly files above do not cover. Parsed per month (our sums of its السعر الكلي lines, not
a till print — the items reports print no totals):

| Month | Item lines | ~Orders | Items gross (IQD) |
|---|---|---|---|
| July (from the 2nd) | 9,645 | 6,608 | 26,530,250 |
| August | 7,806 | 5,607 | 20,813,500 |
| September | 10,071 | 7,064 | 26,307,000 |
| **October** | **7,817** | **5,240** | **23,386,500** |

Reconciliation caveat: for the overlapping months these sums sit within 1–4% of the orders
files' till-printed gross (July −148k, explained by the missing July 1; August +763k;
September +1,102k) and the monthly items files' line counts differ by a few hundred rows.
The two exports were taken a month apart with — evidently — slightly different range or
status filters, and the reports do not say which. Where the figures disagree, the
till-printed totals in the table above remain the quoted numbers; October, which has no
monthly file, is quoted from this export with that caveat.

## Not ingested

Unlike the padel reports (migration 0331/0348), nothing from these files is in the database
yet. The 0331 schema cannot take them as-is: its `department` CHECK admits only `padel` and
its shape is one monthly summary per row, where this data is per-order and per-item. Landing
it means its own tables (or a widened schema) plus a generated data migration in 0348's
style: a structured JSON derived from the PDFs, a test proving the JSON against the PDFs,
and `on conflict do nothing` inserts. Waiting on the owner's decision.
