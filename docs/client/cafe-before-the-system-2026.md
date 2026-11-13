# The café before the system: sales, costs, margins and what was decided (2026)

What the club knows about its café from before the system went live on 8 November 2026,
gathered with the owner (Majed) between 9 and 13 November 2026. Every figure says where it
comes from. Three kinds of source are kept apart:

- **The old till.** The café ran on a Morabaa till from 2 June to 31 October 2026. Its
  printed reports are the record. Figures marked "old till" are sums of rows it printed.
- **The owner's word.** Costs and a few monthly figures the owner stated in chat. They are
  his estimates, not documents.
- **Our working.** Margins, targets, proposed prices and the loyalty plan. Analysis and
  proposals, not decisions, unless the line says the owner decided it.

The club is in Karbala (Durrat Karbala residential complex). The brand on the menu is
"Just One Touch".

## Where the data lives

| What | Where |
| --- | --- |
| The old till's sales, by day and hour | table `legacy_cafe_hours`, view `legacy_cafe_days` |
| What sold, by day, product and price | table `legacy_cafe_item_days` |
| Our product grouping and the owner's costs | table `legacy_cafe_products` |
| The same days inside the live figures | Analytics > Café, and the management panel's café figures |
| The till's own view (months, groups, products) | Analytics > Café, section "Before the system" |
| The padel desk's monthly reports, June to September | tables `legacy_reports`, `legacy_report_figures` |
| The original PDF exports and how they were read | `packages/db/client-data/cafe-pos-2026/` |

The old till's days are already inside the café revenue shown on Analytics and the
management panel. Never add them a second time.

## What the old till's reports cover

- 2 June to 31 October 2026: 147 trading days. 1 June has no rows (the till most likely
  started on 2 June). 30 June is in no report. The café was closed on 25 and 26 June and on
  3 and 4 August (Ashura and Arbaeen fall on those dates; an inference, the reports do not
  say).
- Two kinds of report: orders (one row per order, with discount and money received) and
  items (one row per item line). Orders reports exist for 2 June to 29 September except
  31 July and 31 August. For 31 July, 31 August, 30 September and all of October only the
  items report exists, so **discounts are unknown for those 34 days** and their sales count
  in full.
- The reports give no cash or card split, no refunds and no waste. Every order is recorded
  against "cash customer": the old till identified nobody.
- A day is the till's own calendar day, not the 04:00 business day the system uses.

## Sales by month (old till)

Sales before order discounts, IQD.

| Month | Trading days | Sales | Discounts | Taken | Orders |
| --- | --- | --- | --- | --- | --- |
| June (from the 2nd, 30th missing) | 26 | 20,946,500 | 612,000 | 20,334,510 | 4,122 |
| July | 31 | 27,401,500 | 403,893 | 26,997,618 | 6,814 |
| August | 29 | 20,813,500 | 387,614 | 20,425,889 | 5,607 |
| September | 30 | 26,307,000 | 568,386 | 25,738,641 | 7,064 |
| October | 31 | 23,386,500 | not known | 23,386,500 | 5,240 |
| All five months | 147 | 118,855,000 | 1,971,893 known | 116,883,158 | 28,847 |

- Discounts ran at about 2.1% of sales in the months that have them, on 4.4% of orders,
  at three rates: 15%, 30% and 50%.
- The average order is about 4,000 IQD, but the typical order is 2,000: a quarter of orders
  are 1,000 or less (mostly water), a quarter 5,000 or more, one in ten 10,000 or more.
- Thursday is the busiest day, then Friday and Wednesday; Sunday is the quietest. About 89%
  of the money is taken between 15:00 and 22:00, peaking 17:00 to 20:00.
- This is a summer record. Hot coffee and tea were already rising in October, so winter
  will look different.

## What sold (old till, item sales before discounts)

The grouping is ours, read from the product names.

| Group | Share of item sales | Units |
| --- | --- | --- |
| Desserts and food | 25.4% | 12,694 |
| Fresh juices | 19.4% | 5,645 |
| Smoothies, milkshakes and slush | 15.7% | 4,779 |
| Mojitos | 11.3% | 3,415 |
| Iced coffee | 7.7% | 2,109 |
| Water and ice | 6.7% | 31,647 |
| Hot coffee | 4.4% | 1,386 |
| Tea, chocolate and hibiscus | 4.0% | 2,108 |
| Other | 3.6% | 3,748 |
| Espresso shots | 1.7% | 726 |

Coffee of every kind is under 14% of sales. Water alone is about 30,000 bottles. The best
sellers by money: water, large orange juice, cookies, donuts, ice cream, San Sebastián
cheesecake, the 1,000 IQD item printed as كبوس (unclear what it is), blue mojito, mosaic
(lazy) cake, strawberry mojito.

## What each item costs the club (the owner's word, 9 November 2026)

One unit's cost in IQD. The owner's sheet names no sizes, so one cost stands for every
size.

- Desserts: rainbow cake 625, milk cake 750, San Sebastián 1,600, muffin 500, donut 600,
  mosaic (lazy) cake 2,500, cookies 1,250, stuffed cookies 1,750, carrot cake 1,000,
  brownies 2,000, tiramisu 1,600, English cake 350.
- Coffee and tea: espresso single 300, espresso double 540, americano (hot or iced) 750,
  flat white 1,000, cortado 1,000, Turkish coffee 1,000, hazelnut coffee 1,000, karak tea
  1,000, lemon tea 1,000, classic hot latte 1,000, caramel or mocha latte 1,500, hazelnut,
  vanilla or cookies latte 1,750, hot chocolate 1,300, pistachio macchiato 2,000.
- Cold drinks: mojito (every flavour, Red Bull too) 1,250, smoothie (mango, strawberry,
  peach, pineapple) 1,250, passion fruit smoothie 1,500, orange juice 1,250, strawberry
  juice 1,300, mango juice 1,500, lemon juice 1,250, polo 1,300, green apple 750, orange
  and carrot 1,500, milkshake 1,600, frappuccino 2,000.
- **No cost given yet:** watermelon juice, the immunity shot, Spanish latte, ice cream,
  slush, sweet cake, cheesecake, V60, cold brew, hibiscus, Iraqi tea, the item printed as
  كبوس, water, and the house drinks (Touch Blue, Touch Special, Court Energy, Padel Fresh).
- Worth checking with the owner: karak tea costs 1,000 and sells for 2,000, and lemon tea
  costs 1,000 and sells for 1,500. Either those teas are the thinnest items on the menu or
  the two costs are mistyped.

## Margins (our working, on the old till's sales)

"Kept" means the menu price less the item's own cost. It does not include wages, rent or
anything else.

- A cost is known for 61% of item sales. On those, the café kept **64%** of the price.
- By group, on the costed items: smoothies about 73%, coffee 70%, fresh juices 68%, mojitos
  68%, milkshakes 67%, frappuccino 59%, desserts 54%, tea and hot chocolate 50%.
- Three best-selling desserts keep under half: cookies 38%, mosaic (lazy) cake 38%,
  brownies 43% (stuffed cookies 42%). The gap to the rest of the menu is worth roughly
  530,000 IQD a month.
- The whole café probably keeps 14 to 16 million IQD a month after ingredients, if the
  items with no cost keep between 50% and 75%.
- Open question for the owner: does his 15 million a month running cost already include
  the café's ingredients? The answer moves the bottom line by 7 to 10 million a month.

## Target margins and proposed prices (proposed on 10 November 2026, NOT approved, NOT applied)

Targets we set: coffee 75%, fresh juices, mojitos, smoothies and milkshakes 70%, desserts
60%, the whole café 70% (it is 64% now). What cafés generally aim for: drink ingredients at
15 to 25% of the price, fresh juices 20 to 30%, smoothies 25 to 35%, a whole café 28 to
35%. No Karbala café publishes prices online, so the check that matters is to visit three
nearby cafés and note their latte, fresh juice and mojito prices.

Proposed changes (IQD, medium / large where there are two sizes). Everything not listed
stays as it is.

| Item | Now | Proposed |
| --- | --- | --- |
| Vanilla or hazelnut latte | 4,000 / 5,000 | 4,500 / 5,500 |
| Cortado, flat white, Turkish coffee | 3,000 | 3,500 |
| Pistachio macchiato (large) | 5,000 | 5,500 |
| Karak tea | 2,000 | 2,500 |
| Lemon tea | 1,500 | 2,000 |
| Hot chocolate | 3,000 / 3,500 | 3,500 / 4,000 |
| Orange juice, lemonade, orange and carrot | 3,000 / 4,000 | 3,500 / 4,500 |
| Mango juice | 3,500 / 4,500 | 4,000 / 5,000 |
| Mojito, every flavour | 3,500 / 4,000 | 4,000 / 4,500 |
| Milkshake, every flavour | 4,000 / 5,000 | 4,500 / 5,500 |
| Frappuccino, if any stay | 4,000 / 5,000 | 5,000 / 6,000 |
| Cookies | 2,000 | 2,500 |
| Stuffed cookies | 3,000 | 3,500 |
| Mosaic (lazy) cake | 4,000 | 5,000 |
| Brownies | 3,500 | 4,000 |

- These take the costed items from 64% to about 67% kept and add up to about 1.4 million
  IQD a month if nobody stops buying. That is a ceiling, not a forecast.
- Suggested order: first desserts and teas (about 600,000 a month, low risk); then the
  small lines (about 170,000); last mojitos, orange juice and milkshakes (about 610,000,
  the most money and the least room: the rise stops paying if 13 to 15% of buyers leave).
- The last three points to 70% have to come from what cookies, mosaic cake and brownies
  cost to buy or make, not from price.

## Menu lines suggested for removal (our suggestion, not decided)

Thirteen of the 72 menu lines brought in 1.7% of sales over the five months: Court Energy,
the immunity shot, piña colada, the banana, Snickers and KitKat milkshakes, protein, all
five frappuccinos, and the pineapple smoothie. Also discussed: Touch Special (suggested
cut), Touch Blue (one more push before deciding), hot chocolate (keep: a winter item
measured in summer).

## Other figures the owner stated (9 November 2026, estimates)

- The padel gear shop sells about 1,000,000 IQD a month.
- Padel stock on hand is worth about 10,000,000 IQD.
- Women's hours are not in the padel desk's monthly reports; they bring about 500,000 IQD
  a month.
- Running the club costs about 15,000,000 IQD a month.
- Padel elsewhere in Iraq charges about 40,000 IQD an hour (Baghdad, Duhok). The desk's
  own reports work out to 25,000 to 35,000 per booking.

## The loyalty plan (a plan; the live rules are the loyalty settings in the system)

Decided by the owner:

- Points buy things you take, never money off.
- One point for every 1,000 IQD paid.
- A reward costs its menu price divided by 100, so about 10% comes back.
- Stamp cards on top of points. The court card: eight paid hours, the ninth is free, not
  on Friday or Saturday, and it replaces the court hour in the points list.
- A plain espresso shot does not stamp a drinks card.
- The club is sold as one experience: court guests should use the café and café guests
  should book courts.

Proposed and still waiting for his answer: nine rewards from real sales (a donut at 18
points up to a milkshake, smoothie or San Sebastián at 50); tiers Silver from 100 points,
Gold from 600, Black from 2,000, earning 1.1, 1.25 and 1.5 times the points; a second card
giving the ninth made-to-order drink free; a court hour for 240 points until the cards are
built. The stamp cards do not exist in the system yet. Expected cost: between 0.55 and 2.3
million IQD a month in menu value. The full working is in
`docs/design/loyalty/points-economy-2026-11-09.md`.
