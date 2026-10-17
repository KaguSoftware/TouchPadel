# Management rebuild: design brief (2026-10-16)

The shaped brief for rebuilding Management's **Financial, Observe, Stock and Setup** sections, and
the manager's Operations rail that opens the same pages, from zero. Written in the "you are
Majed" UX role with /impeccable (product register; `docs/PRODUCT.md`, `docs/DESIGN.md`).
Nothing is built until Majed confirms this brief.

The contract for "nothing lost" is the action inventory in
[management-actions/](management-actions/README.md): 62 screens, 3,139 bullets. Every action in it
survives the rebuild. Only where it lives inside its section, and how the page around it looks,
change.

## Majed's calls (2026-10-16)

- **Pain:** the same thing in many places; not knowing where a page is; crowded pages.
  (Words were not named as a problem: names change only where pages are grouped.)
- **Scope:** the structure and every page, for the owner and the manager.
- **Features:** all kept. Nothing moves between sections.
- **Inside a section:** pages may regroup. Pages doing one job merge, hidden pages get a visible
  way in, each section's home becomes a real summary, and twins in two sections link both ways.

## 1. Summary

Management today has 43 rail rows behind four section buttons, 4 dropdowns, 7 hidden rows and a
second copy of one page, and home pages that repeat the rail as cards. The rebuild gives each section a short rail
of **page families**: one row per job, with the family's pages as tabs under the page title. Then
every page is rebuilt on one shared anatomy, so a page always reads the same way: title,
tabs, one primary action, a scope bar in a fixed order, what needs you, then one list whose
records open beside it.

### What the screens show today (61 routes captured on the local stack, 2026-10-16)

- **Pages fall off their own section.** `/admin/hours` drops the Setup rail and shows
  Management's top level; `/attendance`, `/admin/promotions`, `/admin/telegram` and `/setup` light
  no row; Telegram shows Setup's tab strip (Home screen, Tables & QR, Telegram) under the Observe
  rail.
- **The rail overflows.** With the dropdowns open, 84 px of Observe and 222 px of Stock fall below
  a 900 px laptop screen.
- **The homes repeat the rail.** Financial's overview is a nested card ("Earned" holding a
  "Revenue" card) above nine identical link cards with coloured top stripes.
- **The Observe overview repeats other sections.** "Before you close" is Day close, "Stock to
  watch" is Stock's alerts, "So far today" is money. It is the manager's Today body, reused.
- **"Venue settings" opens on opening hours;** the venue's own details are the fourth tab, under
  thirteen other panels.
- **Bugs seen:** on 14 routes the rail marks two rows as the current page; Loyalty's switch is
  drawn off beside "Loyalty is on"; the shop's Cash drawer showed the café drawer's day on a
  browser station (to check).

## 2. Primary user action

**Find the page for a job in one look, and on that page see the one thing to do first.**

## 3. Design direction

- **Scene:** the owner on a laptop at home after closing, reading the day's money and answering
  what the team sent up; the manager at the office PC under bright light, in and out of stock
  and cash pages in two-minute visits between trips to the floor. Light paper by default
  (DESIGN.md), blue mode as the station's choice.
- **Colour:** Restrained, as DESIGN.md: tinted neutrals, Touch Blue for the primary action,
  selection and focus only; status colours only with a label. No new tokens, no new fonts.
- **Anchors:** Stripe Dashboard (money: balance, payouts, transactions; a calm table with the
  record opening beside it), Linear (one inbox for everything waiting; list with a side peek;
  keyboard first), Shopify admin (inventory per location with a location switch; settings as a
  grouped index with search).
- No native image generation in this harness, so no visual probes: the brief and the current
  screenshots are the reference.

## 4. Scope

Production code, every page, owner and manager, built in waves (section 11) with a stop for
Majed after each wave. UI only: the same server calls sit behind the same buttons.

## 5. The new structure

A **family** is one rail row. Its pages are tabs under the page title. Every tab keeps its
current URL, so phone pushes, Today tiles, the assistant's page links and bookmarks keep
working. The rail lights the family's row on every one of its tabs. No dropdowns, no hidden rows.
A tab you may not open is not printed.

### Financial (owner): 10 rows + 1 hidden → 6 rows

| Row | Tabs (existing URLs) |
|---|---|
| **Overview** | `/financial` |
| **Reports** | Revenue · Courts · Café |
| **Cash** | Day close · Safe · Cash drawer |
| **Pay** | Wages · Late and early · Rewards · Coach pay |
| **Court prices** | `/admin/rates` (was "Rates") |
| **Menu prices** | Items · Categories · Add-ons · Suggested |

Late and early stops hiding inside Wages. The three places money is physically counted sit
together. Coach pay sits with the other pay, and Setup › Coaches links to it.

### Observe (owner): 7 rows + a 5-row dropdown + 5 hidden → 8 rows

| Row | Tabs |
|---|---|
| **Overview** | `/observation`: the live floor, what waits on you, today so far |
| **Bookings** | `/observation/courts` |
| **Tills** | `/observation/tills` |
| **Staff** | Who's on now (`/observation/activity`) · What they did (`/reports/staff`) |
| **From the team** | Waiting on you (new: one list of everything waiting) · Requests · Pay deductions · Incidents · Suggestions |
| **Protocols** | `/protocols` |
| **Marketing** | Campaigns · Promotions · Telegram |
| **Audit log** | `/admin/audit` |

Five inboxes become one family whose first tab is a single list of everything waiting on you
(requests, deductions to decide, incidents to review, new suggestions, protocol steps, posts to
approve). Each item is handled in a side panel, exactly as its own page handles it today; the
other tabs keep each page's full views. Promotions and Telegram stop hiding inside Marketing. The
overview's drill-throughs open the same read-only detail panel as the boards, with the "Open in
Court desk / Cashier" button, instead of landing on a workstation screen under the Observe rail.

### Stock (owner and manager): 13 rows, 8 of them in 3 dropdowns → 5 rows

| Row | Tabs |
|---|---|
| **On hand** | Stock · Alerts · Expiry · Value (`/reports/stock`) |
| **In and out** | Goods in · Moves · Waste & production |
| **Counts** | Count · Differences |
| **Recipes and costs** | Ingredients · Recipes · Margins |
| **Shop** | the Touch Shop desk, as today |

Store-scoped tabs get a **Café / Shop** switch for management, so the shop's stock, deliveries
and counts are read beside the café's instead of in a second copy of the same pages. The shop
desk keeps its own rail for shop staff, with the store fixed to Shop.

### Setup (owner): 8 rows + a hidden overview + a second hours page → 9 rows

| Row | Tabs |
|---|---|
| **Overview** | `/setup`: what is not set up yet, and **Find a setting** |
| **Staff** | `/admin/staff` |
| **Coaches** | Coaches · Lesson types · Hours · Lesson rules\* |
| **Courts** | Courts · Booking rules\* · Online deposit\* · Open matches\* · Tournaments\* |
| **Venue** | Details\* · Opening hours · Business day\* · Analytics\* |
| **Branches** | `/admin/branches` |
| **Guest app** | Guest site · Tables & QR |
| **Loyalty** | Points · Tiers · Rewards |
| **Devices** | Stations\* · Devices\* · Kitchen screens\* · Offline mode\* |

\* A panel that today sits inside "Venue settings" (14 unrelated panels on one page) or on the
hidden Setup overview. Opening hours exists twice today (a settings tab and `/admin/hours`); it
becomes one tab.

### Operations (manager): same families, filtered by role

| Section | Rows |
|---|---|
| **Today** | `/ops` (unchanged here; another session is rebuilding its body) |
| **Run the day** (10 → 7) | Bookings · Open tabs · Stock › · **Cash** (Day close · Safe · Cash drawer) · Protocols · **From the team** (Pay deductions · Incidents · Suggestions) · Late and early |
| **Records** | Reports (Courts · Café · Staff activity) · Coach pay · Audit log |
| **Setup** | Menu · Court prices · Coaches · Promotions |

The manager's Cash drawer, reachable today only by address, gets a tab.

### Everywhere: Go to (Ctrl+K)

One search box that jumps to any page, tab or settings panel the person may open, in English or
Arabic ("deposit", "hours", "late", "telegram"). New navigation, not a new feature; see open
question 2.

## 6. The page anatomy (every page)

1. **One page, one job.** The title is the row or tab name; the family's tabs sit under it. No
   lead paragraph that restates the title.
2. **One primary action** at the top end, at most one secondary beside it. Everything else sits
   on the row or in the side panel of the thing it acts on.
3. **One scope bar, one order:** period → branch or store → filters → search; view switch and
   Export at the far end. The eye learns it once.
4. **"Needs you" lines only when something on this page waits:** one line per kind, with the
   button that handles it. No stat cards, no grids of link cards.
5. **One list (or one board) per page.** Clicking a record opens it in a **side panel** at the end
   edge: its details and every action on it (edit, approve, void, pay). "New …" opens the same
   panel empty. Modals stay only for confirmations, PINs and the day-close count.
6. **Figures:** only the few that answer the page's question, from the server, in one row at the
   top of the body. Never computed in the UI.
7. **Every state:** loading skeleton; empty that names the next action; error with Try again;
   offline (writes disabled, saying why); refused (saying why).

## 7. Section homes

- **Financial overview:** this month so far; the cash (last closes agreed or not, in the safe);
  coming due (wages due now, coach statements to approve or pay); needs you (online refunds,
  shifts short or over). Every line links to the tab where it is handled. The nine link cards
  go; their live lines become these sections.
- **Observe overview:** the live floor; what waits on you (the top three, then "Open From the
  team"); today so far. For the owner, "Before you close" and "Stock to watch" stop repeating
  here: they are the Financial overview's cash lines and Stock's Needs-you lines. The manager's
  Today keeps them, because it is the manager's one page for the whole shift.
- **Stock:** lands on On hand › Stock, with "Needs you" lines (alerts, phone counts waiting,
  expiring soon) linking to their tabs.
- **Setup overview:** what is not set up yet (today's health checks), and Find a setting.

## 8. Interaction model

- Tabs are links with their own URLs; Back works; arrow keys move between tabs (flipped in Arabic).
- Old URLs that merge (for example `/admin/hours`) redirect to their new tab.
- The side panel opens beside the list, which stays visible and keeps its scroll. Its record is
  in the URL (`?id=`), so a link can open it. Esc and X close it; unsaved changes ask first.
- Nothing a click causes animates (DESIGN.md motion rule).
- Ctrl+K opens Go to anywhere in these sections.

## 9. Guardrails (repo rules win)

- UI only: no migration, no RPC change. Merged views read the RPCs the old pages read.
- Majed's standing rules: lists stop at 3 with View more (catalogues and Day close exempt);
  Observe's boards stay view-only with the "Open in …" button; money, stock and time are the
  server's; English and Arabic, both directions, logical CSS only; tokens only.
- Copy bugs the crawl found are fixed when their page is rebuilt (raw key on the Activity monitor
  card, doubled key hints, "Never seen", "Fill in both names first.", and the rest in the
  inventory README).
- Shared working tree: files are claimed by name; files with another session's uncommitted
  changes (the `/ops` body, kit.tsx's period picker) are coordinated, not overwritten.
- A new route (the From the team list) gets its assistant-coverage entry; the assistant map is
  regenerated in a clean worktree at commit.

## 10. References for the build

`spatial-design.md`, `typography.md`, `interaction-design.md`, `ux-writing.md`,
`cognitive-load.md`, `layout.md`, `harden.md`, and `critique.md` with `heuristics-scoring.md` for
the review after each wave. Arabic copy through the `arabic-writing` skill.

## 11. Build waves

| Wave | What | Stop for Majed with |
|---|---|---|
| 0 Foundations | Family registry + rails (owner, manager), family tabs, side panel, page header and scope bar, Needs-you line, Go to | rails in EN, AR and blue mode |
| 1 Homes | Financial, Observe and Setup overviews, From the team list, Stock's Needs-you lines | screenshots of each home |
| 2 Financial | 15 page-tabs | screenshots + nothing-lost check |
| 3 Observe | 13 page-tabs | same |
| 4 Stock + Shop | about 19 page-tabs | same |
| 5 Setup | about 24 page-tabs | same |

Each wave runs as lanes that own named files and catalogue blocks, each loading /impeccable, each
checked in the running app (local stack, EN + AR + blue mode) with typecheck, lint and tests, and
then re-crawled against the inventory to prove every action survived. Nothing is committed
unless Majed asks.

## 12. Open questions (Majed's call)

1. **Manager pages with no way in.** A manager can open Courts, Tables & QR, Venue settings,
   Opening hours and Guest site by typing the address, but no row leads there. Give the
   manager's Setup rows for them, or close them to managers? Until you say: left as today.
2. **Go to (Ctrl+K):** in or out? Until you say: in.

## 13. Progress

**Waves 0 and 1, built 2026-10-17 (uncommitted).**

- Rails and families in `apps/operator/src/lib/workspaces.ts` (rows with `tabs`, named
  `readonly NavTab[]` lists), for the owner and the manager. No dropdowns; hidden rows only for
  the Observe overview's drill-throughs.
- The family heading (`components/FamilyTabs.tsx`): on a family page, `PageHeader` shows the
  family as the eyebrow, the tab's name as the title and the tabs under it, through
  `PageFamilyContext` (kit.tsx). A view inside a tab's page that is not the tab passes
  `ownTitle` (Goods in's receipt and purchase views). The report switcher, the /admin strip,
  the stock sub-nav, the Venue settings tabs and the Coaches tabs are gone.
- Venue settings split into pages (`features/admin/settings/SettingsPages.tsx`,
  `routes/admin/settings.tsx`); the lesson rules are Coaches' fourth tab (`?tab=rules`); the
  kitchen screen pairing moved from /setup to Devices › Kitchen screens (still owner-only).
- Go to: **Ctrl+G**, not Ctrl+K, which already opens the assistant. G is the Go To key of Office
  and VS Code. The rail's first row opens it too.
- Homes: Financial (needs you, this month so far, the cash, coming due; no cards, no tiles in
  tinted cards), Observe (FloorNow's `observe` variant, no cards), Setup (worth checking, find a
  setting, at a glance).
- The assistant map reads tabs; its compact prefix stays under the byte target by naming
  locations as "Section › Row › Tab" and clipping page sentences at 780 characters (was 850).

**Moved:** the "Waiting on you" list goes to Wave 3, where the From the team pages get their side
panels, so each item's panel is built once and used in both. The side panel and the Needs-you
line are built with their first pages (Waves 2 and 3), not ahead of them.

**Next:** Wave 2, the Financial pages.
