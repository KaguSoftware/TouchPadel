# Operator desktop UI — build plan and contracts (2026-09-03)

Implements `touch-padel-desktop-ui-spec.md` on top of the existing `apps/operator` SPA.
Context: `docs/PRODUCT.md`, `docs/DESIGN.md`. This file is the contract every workstream
builds against. Names here are binding; if a workstream must deviate it says so in its report.

## 0. Decisions

- **Five workspaces, one app.** `lib/workspaces.ts` maps a staff role to the workspaces it may
  enter (cashier → cashier; prep → prep; court_desk → courtDesk; manager → manager + courtDesk +
  cashier + prep; owner → owner + manager + courtDesk + cashier + prep). Sign-in lands on the
  role's own workspace. Managers and owners switch workspaces at `/workspaces`. The active
  workspace is station-local (localStorage) and only changes the navigation set; `ROUTE_ROLES`
  and the RPC guards remain the wall.
- **The prep workspace has no navigation.** `WorkspaceShell` renders no rail for `prep`; the
  kitchen display is full-bleed and dark (`--tp-kds-*` tokens).
- **Spec unresolved #1 (waiter calls):** the cashier workspace owns the call queue as a
  persistent region on the till and the open-tabs screen (existing `WaiterCallsPanel`).
- **Spec unresolved #2 (wrapper):** Electron, already chosen (A6). `BillView` keeps
  `window.print()` fallback; thermal printing exists (A7).
- **Spec unresolved #3 (resolution):** desk/till designed for 1366×768 and up; KDS for 1920×1080
  read at 3 m (type ≥ 1.25rem, tile actions ≥ 56px).
- **Existing routes keep their paths** (`/till`, `/desk`, `/kds`, `/stock/*`, `/admin/*`,
  `/analytics`); the e2e suite and bookmarks depend on them. New routes are added beside them.
- **CSV export** is produced client-side from the server's aggregated rows (the repo's existing
  `features/analytics/csv.ts` pattern), a documented deviation from spec §01.
- **Customer creation at the desk** creates a real guest account (auth user + profile) through a
  staff-gated edge function, so the guest can later claim it. Duplicate phone is refused.
- **Promotions** apply server-side as a `tab_adjustments` row (kind discount) with
  `reason_code = 'promotion'` and a `promotion_id`; the single best eligible promotion wins.
  Money arithmetic reuses the existing discount helpers. **Flag for Parsa + SEC review.**
- **Recurring series** create occurrences through the existing `staff_create_reservation` path
  in one transaction; the exclusion constraint remains the guard. **Flag for Parsa review.**

## 1. Routes

| Path | Roles | Screen (spec §) | Owner |
|---|---|---|---|
| `/` | all | redirect to workspace home | shell |
| `/workspaces` | manager, owner | 05 WorkspaceSwitcherScreen | shell |
| `/desk/today` | court_desk, manager, owner | 06.1 TodaysBoardScreen | desk |
| `/desk` | court_desk, manager, owner | 06.2 ReservationCalendarScreen (+06.3/06.4/06.7 dialogs) | desk |
| `/desk/bookings/$id` | court_desk, manager, owner | 06.4 BookingDetailScreen | desk |
| `/desk/series/new` | court_desk, manager, owner | 06.5 RecurringSeriesCreateScreen | desk |
| `/desk/series/$id` | court_desk, manager, owner | 06.6 SeriesDetailScreen | desk |
| `/desk/block` | court_desk, manager, owner | 06.7 CourtBlockScreen | desk |
| `/desk/customers` | court_desk, cashier, manager, owner | 06.8 CustomerSearchScreen | desk |
| `/desk/customers/new` | court_desk, manager, owner | 06.10 CustomerCreateScreen | desk |
| `/desk/customers/$id` | court_desk, cashier, manager, owner | 06.9 CustomerRecordScreen | desk |
| `/till` | cashier, manager, owner | 06.11 TillScreen (+06.13–06.18 panels) | cashier |
| `/till/tabs` | cashier, manager, owner | 06.12 OpenTabsScreen | cashier |
| `/till/drawer` | cashier, manager, owner | 06.19 CashDrawerScreen | cashier |
| `/kds` | prep, manager, owner | 06.20 KitchenDisplayScreen | prep |
| `/ops` | manager, owner | 06.21 OperationsOverviewScreen | manager |
| `/admin/day-close` | manager, owner | 06.22 | manager |
| `/admin/menu`, `/admin/categories`, `/admin/addons`, `/admin/suggested` | manager, owner | 06.23/06.24 | manager |
| `/admin/rates` | manager, owner | 06.25 | manager |
| `/admin/promotions`, `/admin/promotions/$id` | manager, owner | 06.26/06.27 | manager |
| `/stock/*` | manager, owner | 06.28–06.37 | manager |
| `/admin/audit` | manager, owner | 06.38 | manager |
| `/panel` | owner | 06.39 ManagementPanelScreen | owner |
| `/reports/revenue` | owner | 06.40 | owner |
| `/reports/courts`, `/reports/cafe`, `/reports/stock`, `/reports/staff` | manager, owner | 06.41–06.44 | owner |
| `/analytics` | owner | cafe engagement analytics (existing) | owner |
| `/admin/staff` | owner | 06.45/06.46 | owner |
| `/admin/courts` | manager, owner | 06.47 | owner |
| `/admin/qr` | manager, owner | 06.48 TableAdminScreen | owner |
| `/admin/settings`, `/admin/hours` | manager, owner (currency/tax owner) | 06.49 VenueSettingsScreen | owner |
| `/admin/hero`, `/admin/telegram` | as today | guest-site content (out of spec, kept) | — |

## 2. Workspace navigation sets (`lib/workspaces.ts`)

- **courtDesk**: Today `/desk/today` · Calendar `/desk` · Customers `/desk/customers` · New series `/desk/series/new` · Block court `/desk/block`
- **cashier**: Till `/till` · Open tabs `/till/tabs` · Customers `/desk/customers` · Cash drawer `/till/drawer`
- **prep**: none
- **manager**: Overview `/ops` · Bookings `/desk` · Tills `/till/tabs` · Day close `/admin/day-close` · Menu `/admin/menu` · Rates `/admin/rates` · Promotions `/admin/promotions` · Stock `/stock` · Reports `/reports/courts` · Audit log `/admin/audit`
- **owner**: Management panel `/panel` · Reports `/reports/revenue` · Analytics `/analytics` · Staff `/admin/staff` · Courts `/admin/courts` · Tables `/admin/qr` · Venue settings `/admin/settings` · Everything in manager (secondary group)

## 3. Permissions (`can.*`)

`lib/auth.tsx` exports `permissionsFor(role): Permissions` with the spec's booleans:
takePayment (cashier+), discount (cashier+ with manager PIN), override, void, refund (manager+),
adjustStock (manager+), closeDay (manager+), editMenu, editRates, editPromotions (manager+),
manageStaff (owner), viewReports (manager+), viewFinancials (owner). Screens render
`PermissionRefusedNotice` for refused actions; they never hide them.

## 4. Backend contracts (migrations 0065–0068, all `app.*`, SECURITY DEFINER, audited)

### 0065 customers (`customer_notes`, `customer_flags`) — owner: DB-A
- `customer_search(p_query text, p_limit int default 12)` → `setof jsonb`
  `{id, full_name, phone, email, preferred_lang, flags:[{type,label}], counts:{bookings,cancellations,noShows}}`.
  Matches name (ilike, both scripts), phone (digits-only normalised, partial), email (ilike).
  Roles: court_desk, cashier, manager, owner.
- `customer_record(p_customer_id uuid)` → jsonb `{customer, flags, counts, upcoming:[...], history:[...], cafeOrders:[...], notes:[...], series:[...]}`.
- `add_customer_note(p_customer_id, p_body)` → note id; `edit_customer_note(p_note_id, p_body)`;
  `set_customer_flags(p_customer_id, p_flags jsonb)`. Notes carry author + created_at + edited_at/edited_by. Staff-only RLS; never granted to guests.
- Edge function `desk-customer-create` (service role; verifies caller is court_desk/manager/owner)
  body `{fullName, phone, email?, preferredLang}` → `{id}`; errors `DUPLICATE_PHONE`, `DUPLICATE_EMAIL`, `INVALID_PHONE`.
- Flag types: `vip | birthday | payment_note | special_request`.

### 0066 series (`reservation_series`, `reservations.series_id`) — owner: DB-B
- `preview_series(p_court_id, p_pattern 'weekly'|'fortnightly'|'weekdays', p_weekdays int[] (0=Sun), p_start_time time, p_duration_min int, p_starts_on date, p_ends_on date)` → jsonb `{occurrences:[{date, startsAt, endsAt, conflict:{existingReservationId, resolvable, alternativeCourtIds:[]} | null}]}`. Read-only, no lock.
- `create_series(p_court_id, p_pattern, p_weekdays, p_start_time, p_duration_min, p_starts_on, p_ends_on, p_guest_id, p_guest_name, p_guest_phone, p_notes, p_resolutions jsonb [{date, action:'skip'|'moveCourt', courtId}], p_idempotency_key, p_device_id)` → `{seriesId, created:[ids], skipped:[dates]}`; whole thing one transaction; unresolved conflict → `SERIES_UNRESOLVED_CONFLICTS`.
- `series_detail(p_series_id)` → `{series, occurrences:[{...reservation, played:boolean}]}`.
- `cancel_series(p_series_id, p_scope 'future'|'all', p_reason_code)`; played occurrences (end_at < now()) are never touched. Single occurrence edits use the existing reservation RPCs.

### 0067 promotions (`promotions`, `promotion_redemptions`, `tab_adjustments.promotion_id`) — owner: DB-C
- Columns: name_en/ar, type `percent|amount`, value int, starts_at, ends_at, weekdays int[], hour_from/hour_to time, scope jsonb `{courtIds:[],categoryIds:[],itemIds:[]}` (empty = whole bill), limits jsonb `{total, perCustomer, minSpendIqd}`, auto bool, public_code text unique, code_single_use bool, enabled bool.
- `upsert_promotion(p_id?, ...)`, `set_promotion_enabled(p_id, p_enabled)`, `generate_promo_code(p_id)` → code.
- `eligible_promotions(p_tab_id, p_code default null)` → jsonb `[{promotionId, name_en, name_ar, amountIqd}]` sorted best first.
- `apply_best_promotion(p_tab_id, p_code default null, p_idempotency_key, p_device_id)` → `{promotionId, amountIqd}` or `NO_ELIGIBLE_PROMOTION`. Replaces any earlier promotion adjustment on the tab (one promotion per tab).
- Roles: manager/owner edit; cashier+ apply. No delete anywhere.

### 0068 reports and overviews — owner: DB-D (read-only, jsonb)
- `ops_overview()` → `{bookings:{today,arrived,upcoming,noShows}, cafe:{openTabs,ticketsQueued,ticketsLate,waiterCallsOpen}, stock:{low,belowPar,expiringSoon,expired,lastCountAt}, staffActivity:[{staffId,name,ordersTaken,bookingsCreated}], exceptions:{discounts,voids,refunds (count+amount today)}, dayClose:{open,businessDate,openedAt,blockingTabs,queued}}`.
- `panel_headline(p_from date, p_to date, p_compare 'previousPeriod'|'sameLastYear'|'none')` → `{figures:[{key,value,previous,changeAbs,changePct}]}` keys: revenue, padelRevenue, cafeRevenue, cash, card, bookings, orders, avgOrderValue, discounts, refunds, waste.
- `report_revenue(p_from,p_to,p_group 'day'|'week'|'month', p_filters jsonb)` → `{columns:[...], rows:[...], totals:{...}, comparison}`; likewise `report_courts`, `report_cafe`, `report_stock`, `report_staff_activity`.
- `report_drill(p_figure text, p_key text, p_from, p_to)` → `{transactions:[...]}`.
- Roles: `panel_headline`, `report_revenue` owner only; others manager + owner.

## 5. File ownership (parallel workstreams must stay inside their lanes)

| Lane | Owns |
|---|---|
| shell (done first) | `packages/ui/**`, `apps/operator/src/components/**`, `lib/auth.tsx`, `lib/workspaces.ts`, `routes/__root.tsx`, `main.tsx`, all `routes/*` skeletons, `packages/i18n/src/catalogs/{en,ar}.ts` wiring |
| desk | `features/desk/**`, `routes/desk/**`, `catalogs/ws/courtDesk.{en,ar}.ts` |
| cashier | `features/till/**`, `routes/till/**`, `catalogs/ws/cashier.{en,ar}.ts` |
| prep | `features/kds/**`, `catalogs/ws/prep.{en,ar}.ts` |
| manager | `features/ops/**`, `features/admin/promotions/**`, `features/admin/DayClose.tsx`, `features/admin/menu/**`, `features/admin/RateRuleEditor.tsx`, `features/stock/**`, `features/admin/audit/**`, `catalogs/ws/manager.{en,ar}.ts` |
| owner | `features/panel/**`, `features/reports/**`, `features/admin/settings/**`, `features/admin/OpeningHoursEditor.tsx`, `features/admin/staff/**`, `features/admin/courts/**`, `features/admin/qr/**`, `routes/reports/**`, `catalogs/ws/owner.{en,ar}.ts`, `catalogs/ws/reports.{en,ar}.ts` |
| DB-A/B/C/D | one migration each (0065/0066/0067/0068) + its test file + `desk-customer-create` edge fn (A) |

Shared primitives are imported from `components/ui` and `components/kit`; a lane that needs a
new primitive builds it inside its own folder and names it in the report for promotion later.

## 6. Definition of done (spec §10) per lane
Every listed state renders; both directions; both languages; no literal user strings; formatters
only; no permission conditional (use `can.*`); no money/stock/time arithmetic; `busy` on every
action; re-renders on prop change; till + kitchen keyboard-complete; sensitive actions through
`ReasonCodePrompt` (+ `PinPromptOverlay` where required). Gate: `pnpm --filter @touch/operator
lint typecheck test` green, plus `packages/i18n` typecheck (Arabic parity is type-enforced).

## 7. Status (end of day, 2026-09-03)

Delivered by nine lanes; integrated; whole-repo gate green (`turbo lint typecheck test` 18/18,
DB 467, operator 464). Full lane reports (files, deviations, review line numbers) are in the
session transcript; the durable facts are in HANDOFF.md "Day 15".

| Lane | Delivered | Deviations worth knowing |
|---|---|---|
| shell | theme, kit, icons, rail, switcher, lock, boot, sign-in, routes | admin sub-nav reduced to two family strips (menu, guest site); everything else is a rail link |
| DB-A 0065 | notes, flags, search, record, `desk-customer-create` | duplicate phone on a canonical number; staff profiles appear in search |
| DB-B 0066 | series table + 4 RPCs | courts pre-locked in id order; `cancel_series` in the lock script's status-only set; extra idempotency column |
| DB-C 0067 | promotions + 5 RPCs, `merge_tabs` re-created | `TAB_NOT_OPEN` strict; `perCustomer` needs an identified guest; extra error codes |
| DB-D 0068 | 9 read RPCs | cafe revenue = settled total − court fee; voids from audit rows; peak = highest-priced rule |
| desk | 10 screens | no drag-resize; notes read-only; attach-customer hands the id back in the URL |
| cashier | till modules, open tabs, drawer | payment stays a dialog; running total = tested client mirror until settled |
| prep | dark keyboard-complete board | `⚠` glyph kept for an e2e anchor |
| manager | ops overview, day close, promotions, menu, rates, audit, 11 stock screens | expected cash not shown before close; rates overlap is display-only |
| owner | panel, 5 reports, venue settings, staff, courts, tables | report args per 0068 signatures; comparison on report rows not rendered |

Line review owed (Parsa + SEC): 0066 and 0067, see HANDOFF Day 15.
e2e at close: `pnpm e2e` **42/42** (EN + AR).
