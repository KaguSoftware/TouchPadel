# Loyalty points economy (2026-11-09, second pass 2026-11-10)

Majed's brief: "after a fair number of frequent coming, you get a reward that's worth your
time and would make you happy, while at the same time make it make sense for us."

This is the second pass. The first was written on 2026-11-09 across several revisions; on
2026-11-10 every number was re-derived from the till exports and every claim about the
system was checked against the migrations. Majed's decisions are kept as he made them.
What changed is listed in section 10. Presented page:
https://claude.ai/artifact/XS2siZgrz2vkWe5LQaMegL

Nothing here is applied. Hosted still carries test loyalty values.

## 1. Decided by Majed (2026-11-05 and 2026-11-09)

- Points buy things you take (a free item, a free court hour), never money off.
  `points_off_enabled` stays false; no `iqd_off` rewards. (0403)
- Earn **1 point per 1,000 IQD paid**.
- Rewards cost **menu price ÷ 100** in points, so points give back 10% in menu value.
- Stamp cards ride on top of points: a coffee card and a court card.
- Court card: **8 paid, played hours, the 9th is free**; the free hour cannot be used on
  Friday or Saturday; it replaces a court hour in the points catalogue.
- A plain espresso shot does not stamp the coffee card.
- The place is sold as one experience: court players should end up in the café and café
  guests on a court.

## 2. What the data says (`packages/db/client-data/cafe-pos-2026/`)

- Café gross per calendar month: June 20.9M (one day missing), July 27.4M, August 20.8M,
  September 26.3M, October 23.4M IQD. Discounts take about 2% off.
- **The average order is 4,039 IQD; the typical order is 2,000.** A quarter of orders are
  1,000 or less (mostly water). A made-to-order drink costs 4,000 to 5,000, so a guest who
  buys one drink a visit spends about 4,000 to 4,500.
- **Coffee is a small part of this café.** Share of gross: desserts and food 25%, fresh
  juice 19%, smoothies/milkshakes/slush 16%, mojitos 11%, all coffee 14% (iced 7.7%, hot
  4.4%, espresso shots 1.7%), water 7%. This is a June-to-October record; hot coffee was
  already climbing in October.
- Thursday is the café's busiest day, then Friday and Wednesday. Saturday is level with
  Monday.
- The old till already gave discounts on 4.4% of orders, at 15%, 30% and 50%, worth about
  490,000 IQD a month.
- Padel desk reports (0348): July 9.18M IQD over 263 completed bookings, about 35,000
  each; August about 5.09M over 203, about 25,000 each. **The real court price is not in
  the repo** (the only rates are dev fixtures), so every court figure below uses 30,000
  an hour as a stand-in.

## 3. How points behave in the system (checked in the migrations)

- Points per settled tab = floor(money paid × tier multiplier ÷ 1,000). One floor per
  tab, multiplier first. Money paid is net of discounts and refunds; a free item or free
  hour earns nothing. (0305 `loyalty_points_for`, 0308 `trg_loyalty_earn`)
- The court fee on a booking's tab earns for whoever the tab's customer is. Online
  booking payments earn separately.
- At 1 point per 1,000, 94% of the money earns points; 24% of orders (those under 1,000)
  earn none. At 1 per 500 it would be 98.6% and 10.5%.
- A tier is decided by points earned in the last rolling 12 months, counted after the
  multiplier. Spending points does not lower it. (0376 `loyalty_recompute`)
- Expiry wipes the whole balance after N months with no loyalty activity of any kind;
  any earn or redemption restarts the clock. (0402 `loyalty_nightly_one`)
- `min_redeem_points` and `point_value_iqd` only matter for money-off redemption, which is
  off. They need no value.
- An item reward frees one exact menu size. "Any mojito" is one reward row per flavour.
- A court-hour reward exists (0403) with no day-of-week rule.

## 4. How fast points arrive

| Guest | Per visit | A month |
|---|---|---|
| One made-to-order drink a visit, twice a week | 4 | about 35 |
| Buys the table's round (10,000), twice a week | 10 | about 85 |
| Books a court once a week, plus a drink | about 34 | about 145 |
| Books twice a week | about 34 | about 290 |

Court rows assume 30,000 an hour on the booker's tab.

## 5. Rewards (proposal, rebuilt from real sales)

Three filters: people already buy it, the club keeps most of its price, and its cost is
known. Units are June to October.

| Reward | Sold | Price | Cost | Cost share | Points |
|---|---|---|---|---|---|
| Donut | 2,606 | 1,750 | 600 | 34% | 18 |
| Carrot cake | 212 | 3,500 | 1,000 | 29% | 35 |
| Fresh orange, large | 1,517 | 4,000 | 1,250 | 31% | 40 |
| Mojito, large (one row per flavour) | 2,846 | 4,000 | 1,250 | 31% | 40 |
| Tiramisu | 266 | 4,000 | 1,600 | 40% | 40 |
| Fresh strawberry, large | 698 | 4,500 | 1,300 | 29% | 45 |
| Milkshake, large (one row per flavour) | 1,426 | 5,000 | 1,600 | 32% | 50 |
| Smoothie, large (one row per flavour) | 781 | 5,000 | 1,250 to 1,500 | 25 to 30% | 50 |
| San Sebastián | 802 | 5,000 | 1,600 | 32% | 50 |

A one-drink regular reaches the donut in about two weeks and a 40-point drink in about
five; a weekly booker reaches a 40-point drink in about nine days.

Left out on purpose: cookies and lazy cake (the club keeps only 38% of their price),
brownies (43%), water, and anything without a cost. The first pass listed a classic hot
latte and a frappuccino; they sold 80 and 126 in five months, so they are gone. Iced
Spanish latte (851 sold, the best-selling coffee) and ice cream (2,776 sold) belong on the
list once the owner gives their costs.

## 6. Tiers (proposal, refitted)

The first pass set Silver at 300 points and called it two months of café visits. At 35
points a month it is closer to nine. Refitted so each tier is reachable by the guest it is
meant for:

| Tier | Points in 12 months | Earn multiplier | Who reaches it |
|---|---|---|---|
| Classic | 0 | ×1.00 | everyone |
| Silver | 100 | ×1.10 | a one-drink regular in about 3 months; a weekly booker in 3 weeks |
| Gold | 600 | ×1.25 | a weekly booker in about 4 months |
| Black | 2,000 | ×1.50 | a twice-a-week booker in about 6 months |

Multipliers are smaller than the first pass's ×1.25 / ×1.5 / ×2. They are the most
expensive setting in the program, because they raise the give-back on exactly the members
who spend the most; Starbucks' own tiers run 1 / 1.2 / 1.7.

## 7. Stamp cards

Neither card exists in the system. Both need a migration (card definitions, a counter per
member, the free item at the Nth), a progress display on the desk and the phone, and a
weekday rule for the court card.

**Court card (decided): 8 paid hours, the 9th free, not on Friday or Saturday.** That is
12.5% of a booker's court spend. With 200 to 285 completed bookings a month it tops out
near 35 free hours a month.

Two things to settle:

- Until the card is built, a court-hour reward in the points catalogue at 240 points does
  nearly the same job today (8 hours at 30,000 earn 240 points), without the weekday rule.
- The café's busy days are Thursday and Friday, not Saturday. If the courts follow the
  café, the blackout that protects paid hours is Thursday and Friday. The new system now
  records court occupancy by day; check it before fixing the days.

**Coffee card (decided in principle; shape open).** The first pass proposed 5 paid cups,
the 6th free, with 2 stamps given at the start. Measured against the till:

| Card | Reaches | Free a month at most | Felt give-back |
|---|---|---|---|
| Coffee only, espresso shots excluded, 5 then free | 700 cups a month, 12% of sales | 140 cups | 20% of coffee |
| Any made-to-order drink, 5 then free | 3,200 drinks a month, 57% of sales | 645 drinks | 20% of drinks |
| Any made-to-order drink, 8 then free | the same 3,200 | 400 drinks | 12.5% of drinks |

A coffee-only card touches one sale in eight. The drink this café's regulars come back for
is a juice, a mojito or a milkshake. Recommendation: **one rule for the whole club, "buy
8, the 9th is on us", on any made-to-order drink and on court hours**, shown as 10 slots
with 2 already stamped. Costa, the nearest real example, gives one free drink per 10 and
raised that from 8. Majed's espresso rule carries over as "water, tea, espresso shots and
ice do not stamp".

## 8. One experience: what exists today and what needs building

| Bridge | Today, no build | Needs a build |
|---|---|---|
| Court to café | A café promotion limited to tabs attached to a court booking (`scope.courtIds`), with weekdays and hours, e.g. 15% off the café bill after a match. Tier-only café promotions (`limits.tierMin`). | Double points on a café tab linked to a played booking (earn has no bonus window; the tab's `reservation_id` is there to read). A line on the booking confirmation and receipt saying what the court fee earned. |
| Café to court | Desk staff can give a one-off court discount by hand (`apply_customer_court_discount`). A court-hour reward can sit in the points catalogue. | An automatic "first booking" offer: promotions cannot discount a court fee and nothing detects a first booking. A weekday rule on the court-hour reward. |

The first pass said `loyalty_tiers.promotion_id` could attach "half off your first
booking" to Silver. That column is deprecated, always null and read by nothing (0309).

Measure it with one number: members who have both a booking and a café tab inside 90
days. The customer analytics (0369) already holds the pieces.

## 9. What it costs

A reward's cost depends on what the member would have done without it. If the free drink
is one they would not otherwise have had, it costs its ingredients (about 31% of menu
price). If it replaces a drink they would have paid for, it costs the whole price. The
truth is between, so both are shown. Monthly, on July-like revenue (café 27M, court 9M,
shop 1M):

| Part | Assumptions | Menu value given | Cost if all extra | Cost if all replaced |
|---|---|---|---|---|
| Points | every booker identified, 40% of café money identified, 60% of points spent, tiers as in section 6 | about 1.3M | about 0.4M | about 1.3M |
| Court card | half of the cards completed | about 0.5M | about 0 on empty weekday hours | about 0.5M |
| Drinks card, 8 then free | 40% identified, 70% completed | about 0.47M | about 0.15M | about 0.47M |
| **Total** | | **about 2.3M** | **about 0.55M** | **about 2.3M** |

That is 1.5% to 6% of roughly 37M revenue. The ceiling, if every dinar came from a
top-tier member and every point and card were used, is about 7M to 8M of menu value a
month. The program pays for itself if it lifts members' spending by more than it gives
away, which at these settings means a lift of a few percent.

The first pass put the cost at 300,000 to 500,000 a month. It counted café money only,
left out the points earned on court fees, the multipliers and the court card, and priced
every reward at its ingredients.

Two things the first numbers did not have: the share of café money that will be
identified, and how many points get spent. Both are assumptions until the live system has
a month of data.

## 10. What the second pass corrected

- The "monthly" till files each stop a day early; real months are higher than first
  reported, and the files agree with each other exactly (the first pass blamed "different
  export filters").
- "Average order 4,000" hid a typical order of 2,000.
- The reward list held items almost nobody buys and a wrong cookie price; rebuilt from
  the full item ranking.
- Silver was nine months away for a café regular, not two; tiers refitted.
- `promotion_id` does not do what the plan said; promotions cannot touch court fees.
- `min_redeem_points` has no effect on rewards.
- The cost estimate was too low by a wide margin (section 9).
- Research: the "2.4 times faster" stamp-card figure came from a blog, not the paper, and
  is dropped. Kivetz, Urminsky and Zheng (2006) found café card holders buy more often as
  the card fills, and that a 12-stamp card with 2 bonus stamps is finished faster than a
  plain 10-stamp card. The 34% against 19% completion figure is Nunes and Drèze's car-wash
  study (2006), not Kivetz. McDonald's gives back roughly 8 to 15% in menu value by our
  estimate, not the 5% first written.
- Rounding at 1 point per 1,000 loses 6% of the money, not the larger share the first
  pass argued when it pushed for 500.

## 11. DECIDE (Majed)

1. **The real court price per hour** (by day or time if it varies). Every court number
   here stands on a 30,000 placeholder.
2. **Card scope and length:** coffee only, or any made-to-order drink; 5 then free, or 8
   then free like the courts.
3. **Free court hour blackout days:** Friday and Saturday as decided, or the days the
   courts are actually full.
4. **Tiers:** 100 / 600 / 2,000 at ×1.1 / ×1.25 / ×1.5, or richer multipliers.
5. **The reward list**, and which flavours get a row.
6. **Costs still missing:** iced Spanish latte, ice cream, sweet cake, cheesecake,
   watermelon, slush; and whether karak and lemon tea really cost 1,000.
7. **A court-hour reward at 240 points now**, until the court card is built.
8. **Which bridges to build**, and when to switch the program on.

## 12. Apply (after DECIDE)

With no build: `set_loyalty_settings` (enabled, 1,000 per point, earn switches on, expiry
12 months), four tiers, the item rewards with their menu sizes, and any café promotions
from section 8. The cards, the weekday rule, the after-match bonus and an automatic
first-booking offer each need their own migration and screens.
