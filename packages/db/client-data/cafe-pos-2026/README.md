# Café POS exports from before the system (Morabaa)

Nine PDF exports from the café's old till, Morabaa (شركة المربع للحلول البرمجية,
www.morabaa.com). Eight arrived over WhatsApp on 2026-10-09/10 with the padel Word reports
(`../padel-monthly-2026/`); the ninth, a longer items export, arrived on 2026-11-09.
`originals/SHA256SUMS` holds each file's hash. **The PDFs themselves are not in git**
(`*.pdf` is gitignored); they exist on the machine that archived them, and the hashes let
anyone prove a copy is the same file.

Second pass, 2026-11-10: every figure below was re-derived from the PDFs and checked
against the till's own printed totals. It replaces the first write-up, which had the
coverage dates wrong (see "What the files cover").

## The files

| File | What it is | Rows |
|---|---|---|
| `2026-0N-orders.pdf` (June to September) | تقارير مبيعات: one row per order with the time, cashier, order type, table, item count, amount, discount and amount received. The last page prints the totals. | 4,122 / 6,665 / 5,403 / 6,806 |
| `2026-0N-items.pdf` (June to September) | تقارير مبيعات مفصلة: one row per line item with the product, unit price, quantity, line total, ticket number and time. No totals line. | 6,333 / 9,708 / 7,525 / 9,680 |
| `2026-07-02-to-10-31-items.pdf` | The same items report over a longer range. Received as `تقرير مفصل من شهر 6 الئ شهر 11.pdf`; despite the name it holds 2 July to 31 October. | 35,339 |

They are text PDFs, not scans. `pdftotext -layout` gives one row per line; split on runs of
two or more spaces after removing the bidi control characters. Two things break a naive
parse: a long product name can run straight into the row number with no gap, and one
product name contains a double space. Arabic comes out as presentation forms, so normalise
with NFKC before comparing names.

## What the files cover

The "monthly" exports are **not full months**. Each stops a day early:

| File set | Days it holds | Trading days |
|---|---|---|
| June | 2 to 29 June | 26 |
| July | 1 to 30 July | 30 |
| August | 1 to 30 August | 28 |
| September | 1 to 29 September | 29 |

The longer export holds the days they miss (31 July, 31 August, 30 September) and all of
October. **30 June is in no file.** 1 June has no rows either; the till's row numbers start
at 43 on 2 June, so that is most likely the till's first day. Four other days have no rows
at all: 25 and 26 June, and 3 and 4 August. Those dates fall on Ashura and Arbaeen in 2026,
so the club was probably closed; that is an inference, the files do not say.

## How well the files agree

- **Orders files against the till's printed totals:** the sum of every order's amount
  equals the printed المبلغ الكلي exactly in all four months. Discounts and received
  amounts differ from the print by 1 to 13 IQD a month, which is the till rounding
  percentage discounts.
- **Items files against orders files, day by day:** August and September agree exactly on
  every day. July differs on one day (7 July, 13,250 IQD). June's items file is 827,250 IQD
  short of its orders file, mostly on 2 to 4 June, the till's first days. For June the
  orders file is the better figure.
- **Longer export against the monthly items files:** identical row for row wherever they
  overlap. The only rows the longer export adds inside a month are the missing last day
  and one to three late rows on the day the monthly export was cut.

## The figures

The till's own print, for the days each orders file holds (IQD):

| Days | Orders | Gross | Discounts | Received |
|---|---|---|---|---|
| 2 to 29 June | 4,122 | 20,946,500 | 611,995 | 20,334,505 |
| 1 to 30 July | 6,665 | 26,678,750 | 403,888 | 26,274,863 |
| 1 to 30 August | 5,403 | 20,050,250 | 387,613 | 19,662,638 |
| 1 to 29 September | 6,806 | 25,205,000 | 568,373 | 24,636,628 |

Whole calendar months, gross before order discounts, built by adding the missing days from
the longer export. These are our sums, not a till print:

| Month | Gross | Trading days | Per trading day | Note |
|---|---|---|---|---|
| June | 20,946,500 | 26 | 805,600 | 30 June missing, so the true month is higher |
| July | 27,401,500 | 31 | 883,900 | |
| August | 20,813,500 | 29 | 717,700 | closed 3 and 4 August |
| September | 26,307,000 | 30 | 876,900 | |
| October | 23,386,500 | 31 | 754,400 | items export only: no discount figure exists |

Discounts ran at 2.1% of gross over the four months that have them, so received money is
about 98% of each gross figure.

## What the orders look like (22,996 orders, 2 June to 29 September)

- Every order is recorded against "زبون نقدي" (cash customer). The old till identified
  nobody.
- 99.2% are صالة (hall); 185 are سفري (takeaway), nearly all in June. Two users rang
  everything: مها 87%, admin 13%. One order in five carries a table number.
- **The average order is 4,039 IQD but the typical one is half that:** median 2,000, a
  quarter at 1,000 or less, a quarter at 5,000 or more, one in ten at 10,000 or more.
  Orders under 1,000 IQD are 24% of orders and 2.5% of the money.
- 4.4% of orders carry a discount, worth 1,971,893 IQD in total. They cluster at three
  rates: 15% (395 orders), 50% (339 orders, 1,003,875 IQD) and 30% (200 orders).
- Thursday is the busiest day (944,000 a day on average), then Friday (869,000) and
  Wednesday (826,000). Saturday (769,000) is level with Monday; Sunday is the quietest
  (705,000). 89% of the money is taken between 15:00 and 22:00, peaking 17:00 to 20:00.

## What sells (item lines, 2 June to 31 October)

`items-2026-06-02-to-10-31.csv` lists all 169 product names with units, gross and the
prices charged. By share of gross:

| Group | Share | Units |
|---|---|---|
| Desserts and food | 25.3% | 12,420 |
| Fresh juices | 19.4% | 5,655 |
| Smoothies, milkshakes, slush | 15.5% | 4,729 |
| Mojitos | 11.3% | 3,415 |
| Iced coffee | 7.7% | 2,109 |
| Water and ice | 6.7% | 31,638 |
| Hot coffee | 4.4% | 1,391 |
| Tea, hot chocolate, hibiscus | 4.0% | 2,108 |
| Espresso shots | 1.7% | 726 |
| Other | 3.9% | 4,066 |

Water alone is 30,354 bottles. Coffee of every kind is 13.8% of gross. This is a summer
record (June to October in Karbala); hot coffee and tea were already rising in October
(413 hot coffees against about 260 in each earlier month), so winter will look different.

## Open questions about completeness

- About 5% of ticket numbers never appear in the orders files, in single skips. Cancelled
  or voided tickets would explain it; the files do not say.
- The till's internal order counter advances about 1.8 for every order listed. Whether
  that is edits and re-saves, or orders the export leaves out, is unknown. Ask whoever
  ran the export which filters were set.
- No export covers 30 June or 1 to 7 November.

## Owner-stated context (Majed, 2026-11-09: estimates, not in any document)

Keep these labelled as the owner's word wherever they are used:

- Padel-gear shop sales average about 1,000,000 IQD a month.
- Padel stock on hand is worth about 10,000,000 IQD.
- Women's hours are **not** in Hussein's padel reports; worth about 500,000 IQD a month.
- Operational cost is about 15,000,000 IQD a month.

## Not ingested

Nothing from these files is in the database. The 0331 schema cannot take them as it is:
its `department` CHECK admits only `padel` and it stores one monthly summary per row,
where this is per-order and per-item data. Landing it means its own tables plus a
generated data migration in 0348's style. Waiting on the owner's decision.
