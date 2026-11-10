# Loyalty points economy — the studied numbers (2026-11-09)

Majed's brief: "after a fair number of frequent coming, you get a reward that's worth your
time and would make you happy, while at the same time make it make sense for us." This doc
turns that into concrete `loyalty_settings`, tier and reward numbers, derived from the
club's real data, and ends with the DECIDE list. Presented page (same content):
https://claude.ai/artifact/XS2siZgrz2vkWe5LQaMegL

**Revised three times the same day on Majed's direction; this is the standing version.**
The 5% first cut read as "not worth the hustle". The final shape is Majed's: **earn stays
at 1 pt / 1,000 IQD, rewards at menu÷100 (10% felt from points), and the stamp cards ride
on top** — the cards deliver the fast visible wins (free coffee every 5 cups, 10th court
hour free), points are the slower bank for the catalog. Combined felt rate ~25% on a
coffee-heavy basket, ~10% elsewhere. Nothing is applied yet: hosted still carries test
values.

Standing rule it respects (0403, Majed 2026-11-05): points buy things you take — a free
item or a free court hour — never money off like a wallet. `points_off_enabled` stays
false; no `iqd_off` rewards.

## 1. The data this is built on

- Café till exports, June–Oct 2026 (`packages/db/client-data/cafe-pos-2026/`): paid months
  20.3 / 26.3 / 19.7 / 24.6 / ~22.9M IQD; **average café order ≈ 4,000 IQD**.
- Padel desk reports (0348): a court hour ≈ 25–35k, call it **30,000 IQD**.
- Owner cost sheets (`client-data/item-costs-2026-11.md`): drinks COGS 300–2,000, desserts
  350–2,500 — **~32% average COGS on the chosen rewards (68–75% margin)**.
- June–Oct top sellers (by units): water, كبوس, donuts, ice cream, cookies, big orange,
  big mojitos, lazy cake, San Sebastián — the reward list is drawn from these.

## 2. The anchor

- **Earn: 1 point per 1,000 IQD paid** (`iqd_per_point = 1000`) — an average café visit
  lands 4 points. A purchase that rounds to zero points still stamps a card, so no visit
  feels ignored.
- **Rewards are priced at menu value ÷ 100** (1 pt ≈ 100 IQD of menu value).
- Felt give-back from points: **10%** — punch-card parity on the whole catalog — with the
  stamp cards (§7b) stacked on coffee and court. Points real worst case ≈ **3.2% of member
  spend**; breakage and unidentified walk-ins pull points + coffee cards together to
  **~1.5% of café revenue expected (300–500k IQD/month)**.

Earning speed:

| Guest | Per visit | Monthly points |
|---|---|---|
| Café regular, 2×/week, ~4,000 IQD | 4 | ~35 |
| Weekly booker (court 30k on their tab + café) | ~34 | ~145 |
| Core player, books 2×/week | ~34 | ~290 |

## 3. The reward list (proposal)

| Reward | Menu value | Our cost | Points | Café-only regular | Booker |
|---|---|---|---|---|---|
| Free donut | 1,750 | 600 | **18** | ~5 visits (~2 weeks) | days |
| Free cookies | ~2,300 | 1,250 | **25** | ~6 visits | 1 booking nearly covers it |
| Free classic latte | 3,000 | 1,000 | **30** | ~7 visits | 1 booking covers it |
| Free mojito (any, big) | 4,000 | 1,250 | **40** | ~5 weeks | ~1.2 booking weeks |
| Free tiramisu | 4,000 | 1,600 | **40** | ~5 weeks | ~1.2 booking weeks |
| Free fresh orange (big) | 4,000 | 1,250 | **40** | ~5 weeks | ~1.2 booking weeks |
| Free San Sebastián | 5,000 | 1,600 | **50** | ~6 weeks | ~1.5 booking weeks |
| Free frappuccino | 5,000 | 2,000 | **50** | ~6 weeks | ~1.5 booking weeks |
| ~~Free court hour (450 pts)~~ | ~30,000 | a slot, not cash | — | superseded | by the court stamp card (§7b) |

Why this list: proven demand (top sellers only — a reward nobody orders changes nobody's
behaviour), high margin (each returns 1.8–3.2 IQD of felt value per dinar of cost; mojito
and fresh orange at 3.2× anchor the 40-pt band), and ladder shape (first win inside a
week, steady 40–50 band, one aspirational prize).

Why the court hour is 450 and not the 300 parity price: it is the only reward with real
capacity cost. 1.5× over parity keeps it ~13% of a booker's court spend (vs 20% café),
aims it at the 2×/week core, and keeps "play enough, play free" honest. Each redemption
represents 225,000 IQD of recorded spend; 0403 guards it (plain booking, once per
booking, used whole).

Deliberately not rewards: water (noise), lazy cake (worst margin), ice cream until it has
a COGS.

## 4. Tiers (12-month points, `earn_multiplier`)

| Tier | Threshold | Multiplier |
|---|---|---|
| Classic | 0 | ×1.00 |
| Silver | 300 | ×1.25 |
| Gold | 1,200 | ×1.50 |
| Black | 3,000 | ×2.00 |

Multipliers are the cheapest incentive: they cost nothing until the guest actually comes
back and spends. Thresholds map to the same personas as before (Silver ≈ 2 months of café
regularity, Gold ≈ the weekly booker's first year, Black ≈ the 2×/week core). A Black
member earns a free mojito every ~2–3 café visits.

## 5. Settings summary (what `set_loyalty_settings` gets)

- `enabled = true` when Majed says go
- `iqd_per_point = 1000`
- `point_value_iqd = 100` (documentation value; `points_off_enabled` stays **false**)
- `min_redeem_points = 18`
- all five `earn_*` switches on (shop ≈ 1M IQD/month, gear buyers are the committed players)
- `inactivity_expiry_months = 12`

## 6. Exposure

Points absolute worst case (every café dinar earned by a member, every point redeemed):
~800k IQD on a 25M café month (~3.2%); the coffee card adds its own bounded ~7% of the
coffee category. Expected for points + coffee cards with unidentified walk-ins and
20–40% breakage: **300–500k IQD/month, ~1.5% of café revenue**. One extra café visit ≈ 3,000 IQD
contribution — a reward pays for itself if it causes a single one. Court exposure is
bounded by the 450 price and 0403's rules.

## 7b. The stamp layer (added later on 2026-11-09, Majed's idea, research-backed)

On top of points, two stamp cards — the only two habits we most want to build:

- **Coffee card:** coffee drinks stamp it, but a plain espresso shot (single or double)
  does NOT count (Majed, 2026-11-09; shots still earn points). 7 slots shown with 2
  already stamped, so 5 paid cups fill it — **every 6th coffee free**. The 2 endowed
  stamps are the Kivetz endowed-progress effect (completion ~34% vs ~19% without) and
  replace a welcome bonus; each new card re-endows them, killing the post-reward dip.
  Cost: one free cup (COGS 300–1,750) per 5 paid ≈ ~7% real on the coffee category.
- **Court card (Majed, 2026-11-09): 8 paid, played hours → the 9th free**, and the free
  hour is **redeemable on weekdays only — never Friday or Saturday** (stamps are earned
  any day; only the redemption is weekday-bound, so peak capacity stays paid). This
  REPLACES the 450-pt court reward — one promise ("play 8, the 9th is on us"), no
  double-dipping with points. 12.5% felt on court spend, paid in weekday capacity;
  ~every 4 weeks for a 2×/week player.

Why stamps on top of points: Kivetz's café field study — purchases accelerate 2.4× as a
stamp card fills (12 days between stamps 1–2 → 5 days between 9–10); a visible
single-product progress bar drives frequency in a way points cannot. Combined ceiling on
café spend ≈ 26% felt / ~8% real; court spend pays only the card's 10%.

Chain benchmarks checked (2026-11-09, web research): Starbucks 1 star/$, redemptions
25–400 stars ≈ ~5% felt steered to high-margin items, ~$200M/yr breakage; old Gold
(300 stars → status card + free any-drink per 125) beloved, killed 2019 to backlash,
tiers reinstated 2026 — status is cheap and loved. McDonald's 100 pts/$, first freebie at
1,500 pts (~3–4 visits, costs cents), Big Mac 7,000 — felt ~5%, real ~2%, biggest win =
identification. Costa Club runs Majed's exact mechanic as its whole program: 1 bean per
drink, 10 beans = any free drink.

**Build note:** stamps are new machinery — one migration (card definitions, per-member
counters, auto-grant at N, zz_branch_guard), desk + phone progress UI, i18n. The points
config can ship first; cards follow.

## 7c. One experience — the cross-sell bridges (2026-11-09, Majed: "more people
reserving courts going to the café, more café people reserving courts")

Court → café: (1) **after-match double points** — a café tab on a played booking's
business day earns ×2 (small build: the earn trigger already sees the tab's booking
link); (2) the booking confirmation + desk receipt say what the court fee just earned
("30 points — a free mojito is 40"); (3) a "match round" bundle the desk offers while
settling the court fee (pure marketing).

Café → court: (4) **Silver's tier promotion = half off your first booking ever** — the
`loyalty_tiers.promotion_id` hook exists; a café regular reaches Silver in ~2 months and
gets one cheap, one-time reason to try a court — the strongest converter here;
(5) a **weekday court-hour taster returns to the points catalog at 250 pts** (same
weekday guard as the court card; bookers ignore it because their stamp card is 3×
faster, so it reaches exactly the café-heavy crowd it is for); (6) open-match seats
marketed on café table cards and the screen.

KPI: **cross-active members** (booking + café tab within 90 days), plus café tabs
attached to bookings, and first bookings by café-first members. 0369 customer analytics
and the interest tags carry the raw material; baseline in month one.

New DECIDEs: after-match ×2 window (business day vs 2 hours); Silver first-booking promo
size (50%?); confirm the 250-pt weekday taster.

## 7. The return math

- A point costs ~32 IQD if fully redeemed (100 felt × ~32% COGS) against 1,000 IQD of
  recorded spend behind it.
- We pay in our own high-margin inventory, at our prices, after the spend is banked, and
  only to identified guests — converting the old till's anonymous "زبون نقدي" traffic
  into named customers.
- Tuning direction is one-way: if redemption costs run hot, **new rewards are repriced
  upward; earned points are never devalued** — that is how programs die.
- **Watch after launch: redemption rate.** Under ~15% means rewards are priced too high;
  an unredeemed program retains nobody.

## 8. DECIDE (Majed)

1. ~~Court card length~~ **DECIDED 2026-11-09: 8 paid → 9th free, weekday redemption
   only (no Friday/Saturday), replaces the court points reward.**
2. **Confirm the reward list** — each item reward binds to an exact `menu_variant_id`
   (which mojito sizes, which juice sizes).
3. **Ice cream** — natural ~15-pt reward, but its COGS is missing from the cost sheets.
4. **Coffee card: confirm the full drink list.** 7 slots / 2 pre-stamped / espresso
   shots excluded — decided. Open: which drinks stamp (latte family, cappuccino, Turkish,
   karak? iced coffees? hot chocolate?).
5. **Tier perks beyond multipliers** — a standing promotion can attach to Gold/Black.
6. **When to flip `enabled`** — everything can load while off; test values replaced first.

## 9. Apply (after DECIDE)

One config pass: `set_loyalty_settings`, `upsert_loyalty_tier` ×4,
`upsert_loyalty_reward` ×8 (court hour moves to the stamp card) with variant ids resolved
from the live menu. Off until the owner enables it. The stamp layer needs its own
migration + UI before it can load.
