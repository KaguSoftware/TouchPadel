# TOUCH PADEL — OPERATOR DESKTOP APP
## UI BUILD SPECIFICATION

**Client:** Touch Padel · Iraq
**Supplier:** Kagu Software
**Source:** Scope of Work v2.0 (Phase 1) + System Diagrams v1.0
**Audience:** UI engineer only
**Platform:** Web application inside an Electron or Tauri wrapper · Windows only · installed on the till and desk machines

---

## 00 · HOW TO READ THIS DOCUMENT

This document contains **only** what a UI engineer builds: screens, presentational components, the data each receives, every state each must render, and every event each emits.

It contains **no visual direction** — no layout, spacing, colour, typography, sizing or interaction choreography. Those are yours.

It contains **no application logic**. Authentication, permissions, data fetching, realtime, the reservation exclusion constraint, price calculation, stock deduction, promotion evaluation, day-close arithmetic, the degraded-mode queue and all report aggregation are built by the application engineer and delivered to you as props and callbacks.

**One application, five workspaces.** This is a single build and a single deployment. Each role signs into its own landing screen with its own navigation and its own defaults. You are not building five apps, and you are not building one screen with controls hidden by permission. You are building five purpose-built workspaces on shared components.

**The contract rule:** if a state is listed under a screen, that state must be renderable. A screen that cannot render one of its listed states is incomplete.

---

## 01 · WHAT YOU OWN AND WHAT YOU DO NOT

### You own
- Every screen in section 06
- Every presentational component in section 07
- The five workspace shells and their navigation
- All four async states on every data-backed screen
- Right-to-left correctness on every screen
- All localized rendering through the provided lookup
- Every refusal, empty, conflict and error presentation

### You do not own
| Concern | Delivered to you as |
|---|---|
| Staff authentication and session | `session` object + auth callbacks |
| Permissions | `can.*` boolean map — never inferred from role |
| Data fetching | Resolved props + `status` flags |
| Realtime (tickets, bookings, freed slots) | Re-rendered props; you react, you do not subscribe |
| Booking clash detection | Server-returned conflict list |
| Price and rate resolution | Server-supplied `price` object |
| Promotion evaluation | Server-applied `appliedPromotion` on the bill |
| Tax calculation | Server-supplied `taxLines` |
| Stock deduction and variance | Server-computed figures |
| Day-close reconciliation | Server-computed expected figures |
| Degraded mode and the write queue | `degraded` boolean + `queuedCount` |
| Report aggregation | Fully aggregated result sets |
| Audit log writing | Automatic; you supply the reason code |
| CSV export | `onExport` callback; the file is produced server-side |

If you write a conditional that decides whether an action is *permitted*, stop — that is a missing `can.*` prop.

If you write arithmetic on money, stock or time, stop — that is a missing server field.

---

## 02 · GLOBAL BUILD REQUIREMENTS

**R1 · Bilingual.** All user-facing text through the translation lookup. No literal strings in components.

**R2 · Right-to-left.** Logical properties only. Every screen correct in both directions, including the calendar, the till grid, the kitchen screen and every report table.

**R3 · Bidirectional text.** Latin fragments inside Arabic strings — court names, times, prices, ingredient codes, references — through `BidirectionalTextRenderer`.

**R4 · Formatting.** All numerals, dates, times, durations, quantities and currency through the provided formatters.

**R5 · Bilingual record editing.** Menu items, court names, categories and notifications are stored in both languages in one record and edited side by side. `BilingualFieldPair` is the only way these are edited.

**R6 · Four states.** `loading`, `ready`, `empty`, `error` with retry on every data-backed screen.

**R7 · Reason codes.** Every discount, void, price override, stock adjustment and reservation override requires a reason code before the action fires. `ReasonCodePrompt` is mandatory and cannot be bypassed.

**R8 · PIN gate.** Discounts, price overrides and other sensitive actions sit behind `PinPromptOverlay`. The overlay is presentation; the PIN is verified server-side.

**R9 · Blocked is visible.** A refused action stays present and states its reason. Never hidden.

**R10 · Busy.** Every action control accepts `busy` and is non-actionable while true.

**R11 · Keyboard first.** The till and the kitchen screen are operated by people who are not looking at the screen the whole time. Every action on those two screens must be reachable by keyboard. The rest of the app supports keyboard but is not required to be keyboard-complete.

**R12 · Realtime.** Tickets, bookings and availability change underneath the operator without user action. Never cache domain data locally; render from props.

**R13 · Degraded mode.** `DegradedBanner` is global and renders above every workspace when `degraded` is true, carrying `queuedCount`.

---

## 03 · SHARED PROP TYPES

```
Session       { staffId, name, roles[], activeRole, can, pinRequired }
Permissions   { can.takePayment, can.discount, can.override, can.void,
                can.refund, can.adjustStock, can.closeDay, can.editMenu,
                can.editRates, can.editPromotions, can.manageStaff,
                can.viewReports, can.viewFinancials }
Role          'courtDesk' | 'cashier' | 'prep' | 'manager' | 'owner'

Court         { id, name{en,ar}, description{en,ar}, outdoor, photoUrl, durations[] }
Reservation   { id, courtId, customer, startsAt, endsAt, status, price,
                rateRuleId, seriesId, notes, paymentStatus, source }
ResStatus     'held'|'confirmed'|'arrived'|'completed'|'cancelled'|'noShow'|'expired'
Series        { id, pattern, startsAt, endsAt, occurrences[], courtId }
Conflict      { date, courtId, existingReservationId, resolvable }
Block         { id, courtId, startsAt, endsAt, reason }
RateRule      { id, weekdays[], fromTime, toTime, courtIds[], price, peak }

Customer      { id, name, phone, email, language, flags[], counts }
CustomerFlag  { type, label }
Note          { id, scope: 'customer'|'booking', body, author, createdAt, editedAt }
Promotion     { id, name{en,ar}, type, value, startsAt, endsAt, weekdays[],
                hourWindow, scope, limits, publicCode, enabled }

MenuItem      { id, name{en,ar}, description{en,ar}, categoryId, photoUrl,
                variants[], modifiers[], flags[], available, blockedByStock }
Variant       { id, name{en,ar}, price }
Modifier      { id, name{en,ar}, priceDelta, group }

Tab           { id, label, tableId, courtId, customer, lines[], totals,
                status, openedAt, openedBy }
TabLine       { id, menuItemId, variantId, modifiers[], qty, unitPrice,
                lineTotal, status, sentAt }
Totals        { gross, discountTotal, taxLines[], net, paid, due }
AppliedPromo  { promotionId, name, amount }
Payment       { id, method: 'cash'|'card', amount, change, takenBy, takenAt }

Ticket        { id, source: 'web'|'till', tableLabel, courtLabel, lines[],
                receivedAt, targetAt, ageSeconds, state }
TicketState   'new' | 'preparing' | 'ready' | 'complete'

Ingredient    { id, name{en,ar}, unit, packSize, cost, supplier, shelfLifeDays,
                onHand, parLevel, yieldPct, wasteAllowance }
Recipe        { menuItemId, variantId, lines[], subRecipeRefs[] }
RecipeLine    { ingredientId, qty, unit }
StockBatch    { id, ingredientId, qty, receivedAt, expiresAt, cost }
StockMovement { id, batchId, qty, reason, actor, at, sourceRef }
Variance      { ingredientId, theoretical, counted, delta, movements[] }

DayClose      { openingFloat, expectedCash, countedCash, cashVariance,
                cardExpected, cardEntered, discounts[], voids[], refunds[],
                waste[], openTabs[], closable, blockedReason }

ReportResult  { rows[], columns[], totals, comparison, filters, drillable }
Comparison    { previousPeriod, sameLastYear, changeAbs, changePct }

AuditEntry    { id, actor, action, before, after, reasonCode, at }
AsyncStatus   'loading' | 'ready' | 'empty' | 'error'
```

---

## 04 · WORKSPACE MAP

Each role signs into its own landing screen. A person may hold more than one role and switch between workspaces.

| Role | Lands on | Workspace contains |
|---|---|---|
| Court desk | Today's Board | Bookings, availability, arrivals, customer search, create/edit/cancel, series, booking notes, payment status |
| Cashier | The Till | Item grid, open tabs by table and court, web orders arriving, court and cafe bills, payment, promotions, refunds, cash drawer, shift |
| Prep | The Pass | Kitchen display only — no navigation |
| Manager | Operations Overview | All of the above plus stock, counts, staff activity, discounts, voids, refunds, day close, reports, operational controls |
| Owner | Management Panel | All of the above plus the advanced panel, financial overview, exports, users, permissions, system settings |

**Navigation rule:** the prep workspace has no navigation at all. It is a wall-mounted screen and there must be nothing to get lost in. Every other workspace has its own navigation set — do not build one shared navigation and filter it.

---

## 05 · APPLICATION SHELL

**AppBootScreen** — Covers boot while session, permissions, venue config and cached reference data resolve. States: `loading` · `error` with retry. Events: `onRetry`.

**StaffSignInScreen** — Signs a staff member in. Fields: email · password. States: `ready` · `busy` · `error` (invalid credentials, disabled account, network). Events: `onSubmit`.

**WorkspaceSwitcherScreen** — Presented when a staff account holds more than one role, and reachable thereafter. Data: `session.roles`, `activeRole`. States: `ready`. Events: `onSelectWorkspace(role)`.

**SessionLockScreen** — Sessions on shared till machines are short-lived. Covers the workspace when the session times out, without losing in-progress screen state. Data: `staffName`, `busy`, `error`. Events: `onUnlock(credentials)` · `onSwitchUser`.

**WorkspaceShell** — Hosts a workspace's navigation, the global banner region and the routed screen. Data: `activeRole`, `navItems`, `degraded`, `queuedCount`, `session`. Note: prep receives no `navItems` and must render none.

---

## 06 · SCREENS

---
### COURT DESK WORKSPACE
---

### 06.1 · TodaysBoardScreen
**Purpose** The court desk's landing screen — everything happening today without navigating.
**Data in** `status`, `reservations: Reservation[]`, `courts`, `liveAvailability`, `arrivals`, `degraded`
**States** `loading` · `ready` · `empty` (no bookings today) · `error`
**Events out** `onSelectReservation(id)` · `onCreateBooking` · `onSearchCustomer` · `onOpenCalendar` · `onMarkArrived(id)` · `onRetry`
**Must render** Today's bookings with court, time, customer, status and payment status at a glance; live court availability; arrivals and their status.

### 06.2 · ReservationCalendarScreen
**Purpose** The day and week calendar across all courts. The primary working surface of the desk.
**Data in** `status`, `view: 'day'|'week'`, `date`, `courts`, `reservations`, `blocks`, `openingHours`, `closedDays`, `busy`
**States** `loading` · `ready` · `closed` (venue closed that day) · `error` · `moveBusy` · `moveConflict`
**Events out** `onChangeView` · `onChangeDate` · `onSelectSlot(courtId, startsAt)` · `onSelectReservation(id)` · `onMoveReservation(id, courtId, startsAt)` · `onResizeReservation(id, endsAt)` · `onCreateBlock` · `onRetry`
**Requirements** Re-renders on realtime change — app bookings appear here the moment a guest confirms. A move or resize that the server rejects must render the conflict, not silently revert.

### 06.3 · BookingCreateScreen
**Purpose** Creates a booking for a walk-in, with or without a linked guest account.
**Data in** `courts`, `date`, `slot`, `durations`, `price`, `customer`, `busy`, `error`, `conflict`
**States** `ready` · `busy` · `conflict` (slot taken — write rejected) · `error`
**Events out** `onAttachCustomer(id)` · `onCreateCustomer` · `onChangeSlot` · `onChangeDuration` · `onSubmit` · `onCancel`
**Note** A booking may be created without a linked customer. Do not require one.

### 06.4 · BookingDetailScreen
**Purpose** One reservation, and every staff action available against it.
**Data in** `reservation`, `customer`, `notes`, `can`, `busy`, `error`
**States** `loading` · `ready` · `busy` · `error` · `overrideRefused`
**Events out** `onMove` · `onShorten` · `onExtend` · `onCancel` · `onMarkArrived` · `onMarkCompleted` · `onMarkNoShow` · `onAddNote` · `onChargeCafeOrder` · `onViewSeries`
**Requirements** Every override — move, shorten, extend, cancel, status change — routes through `ReasonCodePrompt` before the callback fires. The actor and reason are written to the audit log automatically; you supply the reason.

### 06.5 · RecurringSeriesCreateScreen
**Purpose** Creates a whole booking series in one action.
**Data in** `courts`, `patternDraft`, `conflicts: Conflict[]`, `previewOccurrences`, `busy`, `error`
**Pattern inputs** weekly · fortnightly · chosen set of weekdays; time window; number of weeks or an end date; no limit on how far ahead
**States** `ready` · `checking` (clash check in flight) · `conflictsFound` · `busy` · `error`
**Events out** `onChangePattern` · `onCheckClashes` · `onResolveConflict(date, 'skip'|'moveCourt', courtId)` · `onSubmit` · `onCancel`
**Requirements** Clashes anywhere in the series are shown **before** the series is created, with the choice to skip those dates or place them on another court. The screen must not permit submission while unresolved conflicts remain.

### 06.6 · SeriesDetailScreen
**Purpose** Views and edits an existing series.
**Data in** `series`, `occurrences`, `busy`, `error`
**States** `loading` · `ready` · `busy` · `error`
**Events out** `onEditOccurrence(id)` · `onCancelOccurrence(id)` · `onEditSeries` · `onCancelSeries`
**Requirements** Every edit or cancel must make the scope explicit — **one occurrence** or **the whole series**. Occurrences already played are never affected and must render as untouchable.

### 06.7 · CourtBlockScreen
**Purpose** Blocks court time for maintenance or a private event.
**Data in** `courts`, `slot`, `conflicts`, `busy`, `error`
**States** `ready` · `busy` · `conflict` · `error`
**Events out** `onSubmit({ courtId, startsAt, endsAt, reason })` · `onCancel`
**Note** A block occupies the same reservation table as a booking. A clash is a rejected write, not a warning.

### 06.8 · CustomerSearchScreen
**Purpose** Finds a customer at the desk in seconds.
**Data in** `query`, `results`, `status`, `busy`
**States** `idle` · `searching` · `ready` · `empty` (no match, offers create) · `error`
**Events out** `onQueryChange` · `onSelectCustomer(id)` · `onCreateCustomer` · `onAttachToBooking(id)` · `onAttachToTab(id)`
**Requirements** One search box matching on phone number, name or email, including partial entries. Results update as the operator types. Matching tolerance for spacing and for Arabic or Latin spellings is server-side — you render what comes back.

### 06.9 · CustomerRecordScreen
**Purpose** The history behind a customer and the staff-only notes on them.
**Data in** `customer`, `bookingHistory`, `upcomingBookings`, `cancellationCounts`, `noShowCounts`, `cafeOrders`, `series`, `notes`, `can`, `busy`
**States** `loading` · `ready` · `error`
**Events out** `onEditContact` · `onAddCustomerNote` · `onEditNote(id)` · `onSelectBooking(id)` · `onAttachToBooking` · `onAttachToTab`
**Requirements** Notes are **staff-visible only** — never rendered on any guest-facing surface and never on a printed bill. Each note carries its author and time, and edits are recorded. Customer flags (VIP, birthday, payment note, special request) must surface wherever the customer appears, not only here.

### 06.10 · CustomerCreateScreen
**Purpose** Creates a record at the desk for a walk-in with no account.
**Data in** `busy`, `error`
**Fields** name · phone · email · preferred language
**States** `ready` · `busy` · `error` (including duplicate phone)
**Events out** `onSubmit` · `onCancel`

---
### CASHIER WORKSPACE
---

### 06.11 · TillScreen
**Purpose** The cashier's landing screen and the fastest surface in the application.
**Data in** `status`, `categories`, `menuItems`, `activeTab`, `openTabs`, `can`, `degraded`, `busy`
**States** `loading` · `ready` · `noActiveTab` · `error` · `busy`
**Events out** `onSelectCategory` · `onAddItem(itemId, variantId, modifiers, qty)` · `onSelectTab(id)` · `onOpenNewTab` · `onSendToKitchen` · `onGoToPayment` · `onOpenDrawer`
**Requirements** Category and item grid built for speed, keyboard-first with touch supported. Items greyed out automatically when a required ingredient is out of stock (`blockedByStock`) and when marked unavailable by staff (`available: false`) — these are two distinct states and must render distinguishably. Every action reachable by keyboard.

### 06.12 · OpenTabsScreen
**Purpose** Every tab currently open on the floor.
**Data in** `status`, `tabs`, `filter: 'table'|'court'|'name'`
**States** `loading` · `ready` · `empty` · `error`
**Events out** `onSelectTab(id)` · `onChangeFilter` · `onMergeTables` · `onOpenTab`
**Note** Tabs open by table, by court or by name. Cafe orders arriving from the website appear here as tabs against their bound table.

### 06.13 · TabDetailScreen
**Purpose** One tab, its lines, and everything done to it before payment.
**Data in** `tab`, `totals`, `appliedPromotions`, `can`, `busy`, `error`
**States** `loading` · `ready` · `busy` · `error` · `voidRefused`
**Events out** `onEditLine(id)` · `onRemoveLine(id)` · `onChangeQty` · `onSendToKitchen` · `onVoidLine(id)` · `onApplyDiscount` · `onOverridePrice` · `onApplyPromotion` · `onChargeToBooking` · `onSplit` · `onGoToPayment`
**Requirements**
- A tab may be edited freely **before** sending. After sending, a void is recorded as **waste**, never deleted — the screen must make that distinction explicit before the void fires.
- Discounts and price overrides route through `PinPromptOverlay` then `ReasonCodePrompt`.
- Where two promotions could apply, the server applies the **single best** one. Render what came back; never stack on the client.

### 06.14 · PaymentScreen
**Purpose** Records payment at the desk. Cash and card.
**Data in** `tab`, `totals`, `taxLines`, `can`, `busy`, `error`
**States** `ready` · `busy` · `error` · `partiallyPaid` · `settled`
**Events out** `onTakeCash(amount)` · `onTakeCard(amount)` · `onCalculateChange` · `onPrintBill` · `onShowBillOnScreen` · `onComplete`
**Requirements** The card terminal operates independently of this system — the card amount is **recorded**, not processed. There is no card integration and no payment SDK. Change calculation and a cash drawer opening record are both part of this screen. Tax renders as a separate line on the bill.

### 06.15 · SplitBillScreen
**Purpose** Splits one bill by item or evenly.
**Data in** `tab`, `splitMode: 'item'|'even'`, `splits[]`, `busy`, `error`
**States** `ready` · `busy` · `error` · `unallocated` (items remain unassigned)
**Events out** `onChangeMode` · `onAssignLine(lineId, splitIndex)` · `onChangeSplitCount` · `onConfirmSplit` · `onCancel`

### 06.16 · MergeTablesScreen
**Purpose** Merges two or more tabs into one.
**Data in** `tabs`, `selected`, `busy`, `error`
**States** `ready` · `busy` · `error`
**Events out** `onSelectTabs` · `onConfirmMerge` · `onCancel`

### 06.17 · ChargeToBookingScreen
**Purpose** Charges a cafe order to a court booking so a group settles courts and drinks in one payment.
**Data in** `tab`, `todaysBookings`, `selectedBooking`, `busy`, `error`
**States** `ready` · `searching` · `ready` · `busy` · `error`
**Events out** `onSearchBooking` · `onSelectBooking(id)` · `onConfirm` · `onCancel`

### 06.18 · RefundScreen
**Purpose** Refunds a settled bill. Manager role only.
**Data in** `tab`, `payments`, `can.refund`, `busy`, `error`
**States** `ready` · `refused` (insufficient permission) · `busy` · `error`
**Events out** `onSelectLines` · `onSubmitRefund` (via PIN + reason) · `onCancel`
**Note** A refund reverses the stock movement. Render that consequence before the action fires.

### 06.19 · CashDrawerScreen
**Purpose** Opening float and the drawer's activity during the shift.
**Data in** `openingFloat`, `drawerEvents`, `can`, `busy`
**States** `ready` · `busy` · `error`
**Events out** `onSetOpeningFloat(amount)` · `onOpenDrawer(reason)` · `onGoToDayClose`

---
### PREP WORKSPACE
---

### 06.20 · KitchenDisplayScreen
**Purpose** The screen the kitchen works from. The only screen in the prep workspace.
**Data in** `status`, `tickets: Ticket[]`, `degraded`
**States** `loading` · `ready` · `empty` (no active tickets) · `error`
**Events out** `onMarkItemReady(ticketId, lineId)` · `onMarkTicketComplete(ticketId)`
**Requirements**
- Live ticket list with age, items, modifiers, and table or court number.
- Tickets from the guest website and from the till appear in **one list, in arrival order**, each tagged with where it came from.
- A ticket changes appearance as it passes its target time — the state transition is supplied as `ticket.state` and `ageSeconds` against `targetAt`; you render it.
- Full screen, high contrast, readable across a kitchen, **no navigation of any kind**.
- Continues rendering from the local queue during degraded mode so food still reaches the pass.
- New tickets arrive by realtime. There is no refresh control and no polling.

---
### MANAGER WORKSPACE
---

### 06.21 · OperationsOverviewScreen
**Purpose** The manager's landing screen.
**Data in** `status`, `bookingsSummary`, `cafeSummary`, `stockAlerts`, `staffActivity`, `exceptions`, `dayCloseState`, `degraded`
**States** `loading` · `ready` · `error`
**Events out** `onOpenBookings` · `onOpenTills` · `onOpenStock` · `onOpenDayClose` · `onOpenReports` · `onOpenAuditLog`
**Must render** Bookings and cafe operations at a glance, stock and count status, staff activity, discounts, voids and refunds, and the route to day close.

### 06.22 · DayCloseScreen
**Purpose** Closes the trading day and reconciles it.
**Data in** `dayClose: DayClose`, `openTabs`, `queuedCount`, `busy`, `error`
**States** `loading` · `ready` · `blockedByOpenTabs` · `blockedByUnsyncedQueue` · `busy` · `error` · `closed`
**Events out** `onEnterCountedCash(amount)` · `onEnterCardBatchTotal(amount)` · `onViewOpenTab(id)` · `onConfirmClose` · `onExport`
**Requirements**
- The day **cannot** be closed while a tab is still open on the floor. Render the blocking tabs and route to them.
- The day **cannot** be closed while unsynced queued items remain. Render the count.
- Expected cash against counted cash with the variance stated.
- Card total entered for reconciliation against the terminal batch.
- Summary of discounts, voids, refunds and waste with the authoriser named against each.

### 06.23 · MenuEditorScreen
**Purpose** The menu, edited once and live everywhere — the till, the website and the kitchen all read it.
**Data in** `status`, `categories`, `items`, `can.editMenu`, `busy`
**States** `loading` · `ready` · `empty` · `error`
**Events out** `onCreateCategory` · `onEditCategory(id)` · `onReorder` · `onCreateItem` · `onEditItem(id)` · `onToggleAvailability(id)`
**Note** Marking an item unavailable restores it automatically the next day. Render that this is temporary, not a deletion.

### 06.24 · MenuItemEditorScreen
**Purpose** One menu item and everything attached to it.
**Data in** `item`, `categories`, `ingredients`, `busy`, `error`
**Editable** name and description (bilingual, side by side) · category · photograph · price · availability · sizes and variants each with its own price · modifiers and options with price differences · allergen and dietary flags · add-on suggestions attached to the item
**States** `ready` · `busy` · `error` · `dirty`
**Events out** `onSave` · `onDiscard` · `onAddVariant` · `onAddModifier` · `onSetFlags` · `onSetAddOns` · `onEditRecipe`
**Requirements** Every bilingual field uses `BilingualFieldPair`. `blockedByStock` renders as a read-only state with the blocking ingredient named — it is not a toggle.

### 06.25 · RatesEditorScreen
**Purpose** Court rate rules by weekday, time window and court.
**Data in** `rateRules`, `courts`, `busy`, `error`, `overlapWarnings`
**States** `loading` · `ready` · `empty` · `busy` · `error` · `overlap`
**Events out** `onCreateRule` · `onEditRule(id)` · `onDeleteRule(id)` · `onSetPeak`
**Note** Each booking stores the rule that priced it. Changing a rule never changes a historical price — make that non-destructive nature evident.

### 06.26 · PromotionsListScreen
**Purpose** Every promotion, active and inactive.
**Data in** `status`, `promotions`, `can.editPromotions`
**States** `loading` · `ready` · `empty` · `error`
**Events out** `onCreate` · `onEdit(id)` · `onToggleEnabled(id)`
**Note** Promotions are enabled and disabled without deleting, keeping history intact. There is no delete.

### 06.27 · PromotionEditorScreen
**Purpose** One configurable promotion.
**Data in** `promotion`, `courts`, `menuCategories`, `menuItems`, `busy`, `error`
**Editable** name (bilingual) · percentage or fixed amount · start and end dates with automatic expiry · restricted weekdays · restricted hour windows · restricted to specific courts, or to cafe items and categories · usage limits (total redemptions, per customer, minimum spend) · applied automatically or selected by staff · public code, shared or single-use, with its own limits and expiry · enabled state
**States** `ready` · `busy` · `error` · `dirty`
**Events out** `onSave` · `onDiscard` · `onGenerateCode`
**Note** Where two promotions could apply to the same bill, the system applies the single best. There is no stacking configuration in this phase — do not build one.

### 06.28 · StockOverviewScreen
**Purpose** The manager's stock landing.
**Data in** `status`, `lowStock`, `belowPar`, `expiringSoon`, `expired`, `stockValue`, `lastCount`
**States** `loading` · `ready` · `empty` · `error`
**Events out** `onOpenIngredients` · `onOpenGoodsReceived` · `onOpenWaste` · `onOpenCount` · `onOpenVariance` · `onOpenExpiry`

### 06.29 · IngredientsScreen
**Purpose** Every ingredient the venue holds.
**Data in** `status`, `ingredients`, `filter`
**States** `loading` · `ready` · `empty` · `error`
**Events out** `onCreate` · `onEdit(id)` · `onSearch` · `onFilter`

### 06.30 · IngredientEditorScreen
**Purpose** One ingredient record.
**Data in** `ingredient`, `suppliers`, `busy`, `error`
**Editable** name (bilingual) · unit · pack size · cost · supplier · shelf life · par level · usable yield percentage · waste allowance per unit
**States** `ready` · `busy` · `error` · `dirty`
**Events out** `onSave` · `onDiscard`
**Note** On-hand quantity is **not editable here**. Stock is an append-only ledger and changes only through goods-in, consumption, waste or a physical count. Render on-hand as read-only.

### 06.31 · RecipeEditorScreen
**Purpose** The bill of materials for a menu item — what makes stock fall as orders are made.
**Data in** `menuItem`, `variants`, `recipe`, `ingredients`, `subRecipes`, `busy`, `error`
**Editable** quantity per ingredient · per-size quantities (not a multiplier) · modifier-aware lines (oat milk deducts oat milk; a double shot deducts twice the coffee) · sub-recipe references
**States** `ready` · `busy` · `error` · `dirty` · `incomplete` (variants without quantities)
**Events out** `onAddLine` · `onRemoveLine` · `onChangeQty` · `onSelectVariant` · `onAddModifierRule` · `onAddSubRecipe` · `onSave`
**Requirements** Each size carries its own quantities. The screen must make an unfilled variant visible — a partially specified recipe produces variance noise and is the single largest cause of the module failing.

### 06.32 · SubRecipeEditorScreen
**Purpose** A syrup or sauce batch produced once and consumed by many products.
**Data in** `subRecipe`, `ingredients`, `busy`, `error`
**Editable** name (bilingual) · yield quantity and unit · ingredient lines
**States** `ready` · `busy` · `error` · `dirty`
**Events out** `onSave` · `onDiscard` · `onRecordProduction(qty)`

### 06.33 · GoodsReceivedScreen
**Purpose** Records a delivery into stock, with expiry captured per batch.
**Data in** `delivery`, `ingredients`, `suppliers`, `busy`, `error`
**Per line** ingredient · quantity ordered · quantity received (short-delivery capture) · unit cost · **expiry date per received batch**
**States** `ready` · `busy` · `error` · `dirty` · `shortDelivery`
**Events out** `onAddLine` · `onRemoveLine` · `onSetExpiry` · `onSetReceivedQty` · `onSubmit`
**Requirements** Expiry is captured or calculated from the ingredient's shelf life at goods-in. One ingredient may be held as several batches with different expiry dates at once — the screen must never collapse them into a single quantity.

### 06.34 · WasteEntryScreen
**Purpose** Records waste with a reason.
**Data in** `ingredients`, `menuItems`, `reasons`, `busy`, `error`
**Reasons** spill · spoilage · void after send · expired write-off
**States** `ready` · `busy` · `error`
**Events out** `onAddEntry` · `onSubmit`
**Note** Expired stock is written off with its **own** reason code, kept separate from spillage and spoilage in the variance report. The reason list is not interchangeable.

### 06.35 · PhysicalCountScreen
**Purpose** Entry of a physical count. The only route by which an adjustment is permitted.
**Data in** `countSession`, `ingredients`, `busy`, `error`
**States** `ready` · `inProgress` · `busy` · `error` · `submitted`
**Events out** `onStartCount` · `onEnterCount(ingredientId, qty)` · `onSaveDraft` · `onSubmitCount`
**Requirements** Per-ingredient count entry. On-hand figures are visible or hidden per your judgement, but an adjustment can be produced no other way — there is no editable stock number anywhere in this application.

### 06.36 · VarianceReportScreen
**Purpose** Theoretical against counted, by ingredient and period, with the movements behind it.
**Data in** `status`, `variances: Variance[]`, `period`, `filters`
**States** `loading` · `ready` · `empty` · `error`
**Events out** `onChangePeriod` · `onFilter` · `onDrillToMovements(ingredientId)` · `onExport`
**Requirements** Every variance opens down to the movements behind it in one click — the order, delivery or waste entry that caused it.

### 06.37 · ExpiryScreen
**Purpose** Expiring-soon and expired stock.
**Data in** `status`, `expiringSoon`, `expired`, `window`
**States** `loading` · `ready` · `empty` · `error`
**Events out** `onChangeWindow(days)` · `onWriteOff(batchId)` · `onExport`
**Note** Consumption deducts first-expiring-first. Batches render individually with their own expiry dates, never as one pile.

### 06.38 · AuditLogScreen
**Purpose** The append-only record of every sensitive action.
**Data in** `status`, `entries: AuditEntry[]`, `filters`
**States** `loading` · `ready` · `empty` · `error`
**Events out** `onFilterByPerson` · `onFilterByActionType` · `onChangePeriod` · `onExport`
**Requirements** Renders actor, action, before and after values, and the reason code. Read-only in every case — the log cannot be edited or deleted from this screen or any other.

---
### OWNER WORKSPACE
---

### 06.39 · ManagementPanelScreen
**Purpose** The owner's landing screen — the whole business in one place.
**Data in** `status`, `headlineFigures`, `period`, `comparison`, `degraded`
**States** `loading` · `ready` · `empty` (period has no trading) · `error`
**Events out** `onChangePeriod` · `onSetComparison` · `onOpenReport(key)` · `onDrillThrough(figure)` · `onExport`
**Requirements** Every headline figure opens down to the individual transactions that produced it. Nothing on this screen is estimated and nothing is editable — the panel reports, it does not write.

### 06.40 · RevenueReportScreen
**Purpose** Revenue and payment reporting.
**Data in** `status`, `result: ReportResult`, `filters`, `comparison`
**Reports** revenue by day, week and month · padel and cafe separately and combined · cash against card · discounts, voids and refunds with the authoriser · tax collected by rate
**States** `loading` · `ready` · `empty` · `error`
**Events out** `onChangeFilters` · `onSetComparison` · `onDrillThrough(row)` · `onExport`

### 06.41 · CourtsReportScreen
**Purpose** Court performance reporting.
**Reports** occupancy and utilisation by court and by hour · revenue per court and per available hour · booking volumes and trend over time · cancellations and no-shows with rates · peak against off-peak split
**Data, states and events** as 06.40

### 06.42 · CafeReportScreen
**Purpose** Cafe performance reporting.
**Reports** order count and average order value · best-selling products and categories by volume and by revenue · cost of goods, gross profit and margin per item and overall · waste by reason · preparation times by station
**Data, states and events** as 06.40

### 06.43 · StockReportScreen
**Purpose** Stock reporting.
**Reports** stock value on hand · variance, theoretical against counted · low-stock and below-par items · expiring-soon and expired items · consumption by ingredient over a period
**Data, states and events** as 06.40

### 06.44 · StaffActivityReportScreen
**Purpose** Staff activity and exceptions.
**Reports** orders taken and bookings created per staff member · discounts, voids and refunds applied with their reasons · waiter-call response times · cash variance at day close attributed to whoever closed · audit-log view filtered to one person or one action type
**Data, states and events** as 06.40
**Requirement** This is reported as **activity and exceptions**, not productivity scoring and not a league table. Figures render against shift context — a quiet Tuesday and a full Saturday are not comparable. There is no ranking, no score and no leaderboard anywhere on this screen.

### 06.45 · StaffAdminScreen
**Purpose** Staff accounts and role administration. Owner only.
**Data in** `status`, `staff`, `roles`, `can.manageStaff`
**States** `loading` · `ready` · `empty` · `error` · `refused`
**Events out** `onCreateStaff` · `onEditStaff(id)` · `onDisableStaff(id)` · `onAssignRoles(id, roles)` · `onResetPin(id)`
**Note** A person may hold more than one role. Roles are the five listed and no others — additional roles are a change request.

### 06.46 · StaffAccountEditorScreen
**Purpose** One staff account.
**Data in** `staffMember`, `roles`, `busy`, `error`
**Editable** name · email · assigned roles · PIN reset · enabled state
**States** `ready` · `busy` · `error` · `dirty`
**Events out** `onSave` · `onDiscard`

### 06.47 · CourtAdminScreen
**Purpose** Court records.
**Data in** `courts`, `busy`, `error`
**Editable** name (bilingual) · indoor or outdoor · description (bilingual) · photograph · duration options per court
**States** `loading` · `ready` · `busy` · `error` · `dirty`
**Events out** `onCreate` · `onEdit(id)` · `onSave` · `onUploadPhoto`

### 06.48 · TableAdminScreen
**Purpose** Tables, their signed tokens, and the printed QR artwork.
**Data in** `tables`, `tokens`, `busy`, `error`
**States** `loading` · `ready` · `empty` · `busy` · `error`
**Events out** `onCreateTable` · `onEditTable(id)` · `onRotateToken(id)` · `onGenerateArtwork(id)` · `onGenerateAllArtwork`
**Requirements** Tokens are rotatable per table so a photographed code can be retired — the screen must make plain that rotating a token invalidates the printed code in the room. Print-ready artwork is produced for every table in Touch's branding.

### 06.49 · VenueSettingsScreen
**Purpose** System configuration. Owner only.
**Data in** `venueConfig`, `busy`, `error`, `can`
**Editable** opening hours and closed days · trading currency (set at setup) · tax rate per item group · cancellation window and no-show handling · slot hold duration · protected-horizon length · venue contact details
**States** `loading` · `ready` · `busy` · `error` · `dirty`
**Events out** `onSave` · `onDiscard`
**Note** One trading currency only. There is no dual-currency configuration in this phase — do not build the field.

---

## 07 · PRESENTATIONAL COMPONENTS

### Calendar & reservations
**ReservationCalendarGrid** — Courts against time for a day or week. Props: `courts`, `reservations`, `blocks`, `openingHours`, `view`, `date`, `direction`. Emits `onSelectSlot`, `onSelectReservation`, `onMove`, `onResize`.
**ReservationBlock** — One reservation on the grid. Props: `reservation`, `draggable`, `busy`. Renders customer, time, status, payment status and series membership.
**MaintenanceBlockItem** — A block on the grid. Props: `block`.
**CourtColumnHeader** — Props: `court`, `availabilityToday`.
**TimeAxis** — Props: `openingHours`, `interval`, `direction`.
**SeriesPatternBuilder** — Props: `pattern`, `courts`. Emits `onChange`. Weekly, fortnightly or a chosen set of weekdays; number of weeks or an end date.
**ClashPreviewList** — Props: `conflicts`, `courts`. Emits `onResolve(date, action, courtId)`. Skip that date or place it on another court.
**BookingStatusIndicator** — Props: `status`. Seven statuses, all handled.
**PaymentStatusIndicator** — Props: `paymentStatus`.

### Till & tabs
**CategoryGrid** — Props: `categories`, `activeId`. Emits `onSelect`.
**MenuItemGrid** — Props: `items`, `categoryId`. Emits `onSelect`. Renders `available: false` and `blockedByStock` as distinct states.
**MenuItemTile** — Props: `item`, `disabled`, `disabledReason`.
**ModifierPicker** — Props: `modifiers`, `variants`, `selected`. Emits `onChange`. Renders each modifier's price difference.
**TabLineList** — Props: `lines`, `editable`. Emits `onEditLine`, `onRemoveLine`, `onChangeQty`, `onVoidLine`.
**TabTotals** — Props: `totals`, `appliedPromotions`, `taxLines`. Renders gross, discounts, tax separately, net and amount due.
**AppliedPromotionRow** — Props: `promotion`, `amount`. Read-only; the server chose it.
**NumericKeypad** — Props: `value`, `mode: 'qty'|'amount'`. Emits `onChange`, `onConfirm`. Keyboard-operable.
**ChangeDueDisplay** — Props: `due`, `tendered`, `change`.
**BillPreview** — Props: `tab`, `totals`, `language`. Emits `onPrint`. Note: staff notes never appear on a bill.

### Kitchen
**TicketList** — Props: `tickets`, `direction`. Single list, arrival order, all sources.
**TicketCard** — Props: `ticket`, `ageSeconds`, `targetAt`. Renders age, items, modifiers, table or court number, and its source tag. Emits `onMarkItemReady`, `onMarkComplete`.
**TicketAgeIndicator** — Props: `ageSeconds`, `targetAt`, `state`. Changes as the ticket passes its target time.

### Stock
**IngredientTable** — Props: `ingredients`, `filters`. Emits `onSelect`, `onSort`.
**RecipeLineEditor** — Props: `lines`, `ingredients`, `unit`. Emits `onAdd`, `onRemove`, `onChangeQty`.
**VariantQuantityMatrix** — Props: `variants`, `lines`. Per-size quantities, never a multiplier. Renders unfilled variants as incomplete.
**ModifierConsumptionRule** — Props: `modifier`, `ingredientId`, `qty`. Emits `onChange`.
**BatchList** — Props: `batches`. Renders each batch with its own quantity and expiry. Never collapses.
**ExpiryIndicator** — Props: `expiresAt`, `window`.
**GoodsInLineEditor** — Props: `line`, `ingredients`. Emits `onChange`. Includes ordered against received and expiry per batch.
**VarianceRow** — Props: `variance`. Emits `onDrill`.
**StockLevelIndicator** — Props: `onHand`, `parLevel`.

### Reporting
**ReportTable** — Props: `result`, `drillable`, `direction`. Emits `onDrill(row)`, `onSort`.
**ReportFilterBar** — Props: `filters`, `courts`, `categories`, `staff`, `paymentMethods`. Emits `onChange`. Filter by court, category, staff member and payment method.
**DateRangeControl** — Props: `period`, `presets`. Emits `onChange`. Includes custom ranges.
**ComparisonControl** — Props: `mode: 'previousPeriod'|'sameLastYear'|'none'`. Emits `onChange`.
**ComparisonDelta** — Props: `changeAbs`, `changePct`. Renders both change and percentage.
**HeadlineFigure** — Props: `label`, `value`, `comparison`, `drillable`. Emits `onDrill`.
**DrillThroughPanel** — Props: `transactions`, `status`. The individual transactions behind a figure.
**ExportButton** — Props: `busy`, `scope`. Emits `onExport`. CSV, UTF-8, current filter and date range.

### Customers
**CustomerSearchField** — Props: `query`, `busy`. Emits `onChange`. Matches on phone, name or email including partials.
**CustomerResultRow** — Props: `customer`, `flags`. Emits `onSelect`.
**CustomerFlagBadge** — Props: `flag`. VIP, birthday, payment note, special request. Surfaces wherever the customer appears.
**NoteList** — Props: `notes`, `scope`. Emits `onAdd`, `onEdit`. Staff-visible only.
**NoteEntry** — Props: `note`. Renders author, time and whether it was edited.

### Governance
**PinPromptOverlay** — Props: `action`, `busy`, `error`. Emits `onSubmit(pin)`, `onCancel`. Presentation only; verification is server-side.
**ReasonCodePrompt** — Props: `reasonCodes`, `action`, `busy`. Emits `onSubmit(code, note)`, `onCancel`. Mandatory on discounts, voids, price overrides, stock adjustments and reservation overrides.
**AuditEntryRow** — Props: `entry`. Renders actor, action, before and after, reason code.
**PermissionRefusedNotice** — Props: `action`, `requiredRole`. The control stays visible and states why it is refused.

### Bilingual & formatting
**BilingualFieldPair** — Props: `valueEn`, `valueAr`, `label`, `error`. Emits `onChange`. The only route for editing a bilingual record.
**LocalizedRecordText** — Props: `record{en,ar}`, `activeLanguage`. Falls back to the other language when empty.
**BidirectionalTextRenderer** — Props: `parts[]`.
**LocaleNumberFormatter · LocaleDateTimeFormatter · CurrencyFormatter · QuantityFormatter** — All display of numbers, dates, money and stock quantities routes through these.

### Shell & state
**WorkspaceNav** — Props: `items`, `activeKey`, `role`. Emits `onNavigate`. Not rendered for prep.
**DegradedBanner** — Props: `degraded`, `queuedCount`. Global, above every workspace. States the mode and the queued count.
**AsyncStateWrapper** — Props: `status`, `onRetry`, `emptyContent`, `errorContent`.
**ConfirmationDialog** — Props: `title`, `body`, `confirmLabel`, `busy`. Emits `onConfirm`, `onDismiss`.
**MessagePresenter** — Props: `message`, `tone: 'success'|'refused'|'error'`.
**ConflictNotice** — Props: `conflict`. Emits `onResolve`. A rejected write, not a warning.
**DataTable** — Props: `columns`, `rows`, `sort`, `direction`, `emptyContent`. The base table under stock, audit and reporting screens.
**SearchField · FilterControl · Pagination** — Standard list controls.

---

## 08 · STRING INVENTORY

English and Arabic required for all. Copy supplied by Touch (Scope §14, week 2). Build against keys, never literals.

Groups: `auth.*` · `workspace.*` · `calendar.*` · `booking.*` · `booking.status.*` · `series.*` · `conflict.*` · `customer.*` · `notes.*` · `till.*` · `tab.*` · `payment.*` · `kitchen.*` · `dayClose.*` · `menu.*` · `rates.*` · `promotions.*` · `stock.*` · `stock.reason.*` · `variance.*` · `expiry.*` · `reports.*` · `audit.*` · `staff.*` · `tables.*` · `settings.*` · `degraded.*` · `reasonCode.*` · `errors.*` · `common.*`

Every `reasonCode` and every `blockedReason` returned by the application layer must have a matching entry.

---

## 09 · ASSET DEPENDENCIES

| Asset | Source | Reference |
|---|---|---|
| Logo, colour palette, brand assets | Touch, week 1 | §14 — placeholder styling if late |
| Court photographs | Touch, via Supabase storage | §04 |
| Menu item photographs | Touch, week 1 | §06 |
| QR artwork template | Touch branding | §06 — print-ready, per table |
| Thermal printer bill layout | Kagu spec | §07 — Arabic bills render as an image, not characters |
| English and Arabic copy | Touch, week 2 | §14 |

**On the Arabic bill:** where the bill language is Arabic it is composed and sent to the thermal printer as a **rendered image**, not as characters, because low-cost thermal printers cannot shape Arabic. `BillPreview` must be renderable to an image at printer width. Confirm the width with the application engineer before building it.

---

## 10 · DEFINITION OF DONE, PER SCREEN

1. Every listed state renders, including refusals, conflicts and empties.
2. Correct in both LTR and RTL, with no mirrored stylesheet.
3. Correct in both languages, including where a translation is missing.
4. No literal user-facing string in the file.
5. No date, number, quantity or price formatted outside the provided formatters.
6. No conditional decides whether an action is permitted — permissions arrive as `can.*`.
7. No arithmetic on money, stock or time.
8. Every action control respects `busy`.
9. Re-renders correctly when props change with no user action.
10. Till and kitchen screens: every action reachable by keyboard.
11. Every sensitive action routes through `ReasonCodePrompt`, and where required `PinPromptOverlay`, before its callback fires.

Points 6, 7 and 9 are the ones that get missed. The calendar, the tabs list and the kitchen screen all change underneath the operator constantly.

---

## 11 · OUT OF SCOPE — DO NOT BUILD

Card terminal integration · automated cash drawer hardware control · printed kitchen tickets (the kitchen works from the screen) · a second till or second preparation station · staff performance scoring, productivity ranking or league tables · accounting system integration · fiscal or government-registered receipt devices · purchase orders and supplier ordering workflow · supplier price history and cost drift · suggested order quantities · transfers between locations · retail or pro-shop stock · automated reordering · supplier lot numbers and recall tracing · multi-venue and multi-location stock · dual-currency handling · a third interface language · per-user customisation or draggable dashboard layouts · additional roles beyond the five · separate installers per role · Customer 360, lifetime value or cross-domain segments · loyalty points, rewards and tiers · marketing email or SMS campaigns · household or family account linking · editing data from the management panel · scheduled or emailed reports · forecasting and predictive analytics · user-built custom reports · full offline operation from a local on-premises database · behavioural analytics instrumentation · staff shift scheduling or time clock.

---

## 12 · UNRESOLVED — CONFIRM BEFORE BUILDING

**1 · Waiter call surfacing.** The scope specifies one-tap waiter call from the guest's phone, rate-limited per table, moving through raised, acknowledged and resolved, each stamped with who acted and when. It states the call reaches "the floor view" — but the module 9 workspace table does not name a floor view, and waiter-call response times appear in staff reporting. Confirm which workspace owns the call queue (cashier is the likely answer) and whether it is a screen or a persistent region. Nothing above builds it, because the document does not say where it lives.

**2 · Wrapper choice.** Electron or Tauri is confirmed in week 1 against thermal-printer support. The scope states the application inside is identical either way, so this should not affect you — but confirm before building `BillPreview`, since print invocation differs between them.

**3 · Till screen resolution.** The scope specifies one till station and one preparation station but names no hardware. The kitchen screen is wall-mounted and read across a room; the till is operated at arm's length. These are different design problems. Get the actual screen sizes from Touch before starting either.

---

*Touch Padel · Phase 1 · Operator Desktop App · UI Build Specification*
