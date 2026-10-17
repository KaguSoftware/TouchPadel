# Financial: every action, screen by screen

Management › **Financial** — *Money in, money out, and whether the cash agrees*. Part of the
[management actions inventory](README.md), which also covers the rail, who can
open what, and the problems this crawl turned up.

Snapshot of the operator app's **working tree on 2026-10-16**, uncommitted work
from parallel sessions included. Read from the code, not clicked through:
labels are the English catalog's words, writes name the `app.*` RPC (or queued
mutation) they call, and refusal codes come from the latest migration that
defines each function. If a screen changes, this file is stale for that screen.

| Screen (rail order) | Bullets |
|---|---|
| Overview — `/financial` | 40 |
| Reports — `/reports/revenue` (tabs: `/reports/revenue`, `/reports/courts`, `/reports/cafe`) | 88 |
| Cash drawer — `/till/drawer` | 114 |
| Safe — `/safe` | 69 |
| Day close — `/admin/day-close` | 119 |
| Wages — `/wages` | 73 |
| Late and early (Attendance) — `/attendance` | 27 |
| Rewards — `/rewards` | 14 |
| Coach pay — `/reports/coaches` | 89 |
| Rates — `/admin/rates` | 24 |
| Menu prices (rail row) + Menu tab strip — `/admin/menu` · `/admin/categories` · `/admin/addons` · `/admin/suggested` | 10 |
| Menu items — `/admin/menu` | 131 |
| Categories — `/admin/categories` | 23 |
| Add-ons — `/admin/addons` | 76 |
| Suggested items — `/admin/suggested` | 15 |
| **Total** | **912** |

---

## Overview — `/financial`
The Financial section's landing page. It shows this month's revenue and money taken, whether the cash agreed at recent day closes, and online refunds that need a person. Below that is one card per Financial screen.

*Who:* owner only (`ROUTE_ROLES['/financial'] = ['owner']`). Anyone else sees "Not allowed for your role: Opening this screen needs the Owner role. The control stays here so you can see what is available; ask someone with that role to do it." and a **Go to my home screen** link. In-screen gates:
- The Wages card's "Due now" line needs `manageWages` (owner).
- The Coach pay card's line needs `settleCoaches` (manager, owner).
- The card grid prints only the rows `canAccess` allows, so the owner sees all nine.
- The deposit RPCs allow manager and owner.

*Source:* `apps/operator/src/features/financial/FinancialHome.tsx`, `components/SectionHome.tsx`, `features/deposits/DepositAttentionPanel.tsx` (+ `depositApi.ts`, `depositAttentionLogic.ts`), `components/kit.tsx` (Panel, AsyncStateWrapper, ViewMore), `components/ConfirmDialog.tsx`, `lib/appRpc.ts` (PIN gate).

*Header:* the title "Financial". It has no controls and no manual refresh: every panel re-reads on its own every 60 s.

**This month so far** (`app.panel_headline`, this business month, `p_compare: 'none'`. These are the same figures the management panel shows.)
*Read-only:* two groups. **Earned** holds Revenue, with the hint "Court bookings played or due, plus cafe sales after refunds." **Taken in payments** holds Cash and Card, with the hint "Cash and card received, less refunds…". A figure the server did not send reads "—". Tiles do not click.
- **Open the management panel** (ghost button, ↗) navigates to `/panel`.
- **Try again** appears only in the error state ("This could not be loaded." / "You may be offline. The last known data is shown where available.") and re-runs `app.panel_headline`.

**Cash at recent day closes** (the last 7 closed `day_sessions`, newest first)
*Read-only lead:* "The day is open since {time}. Its cash is counted when it closes.", or "No day is open right now.", or (while loading) "What the drawer should have held, against what was counted." Each row shows the business date, "Expected {IQD} · Counted {IQD}", and then one of "Matches" (green), "Short by {amount}" (red), "Over by {amount}" (amber) or "Not counted". Rows do not click.
- **Go to day close** (ghost button, ↗) navigates to `/admin/day-close`.
- **View more ({n})** / **Show less** shows or hides the rows past the first 3 (up to 7).
- **Try again** appears in the error state and re-reads `day_sessions`.
- *Empty state:* "No day has been closed yet." (no button).

**Online refunds needing attention** (`app.deposit_attention` for the rail branch, every 60 s)
*Shown when:* at least one row waits, or online deposits are switched on (`app.deposit_settings`, `deposit_mode` ≠ off). A club that never turned deposits on sees no panel.

*Order:* worst first: failed refunds, then paid deposits whose booking is gone, then slow refunds, oldest first within each.

*Lead:* "Deposits guests paid online that could not be refunded on their own. Try again, or record it once the guest has been paid back another way."

*Row (read-only):*
- Title: the guest name, "Guest with no name", "Ticket refund · {n tickets} · {name}" (open-match tickets, with the badge "Any branch can settle this") or "Lesson refund · {name}".
- Phone, then court · start time, and the amount.
- Status badge: "Refund failed", "Paid, booking not on" or "Refund not confirmed", with a hint line.
- Facts: "Why: {reason}", "Refund asked for {time}" or "Paid {time}", and "Tried {n} times".

All writes here are direct online calls. They are not queued, and they are not disabled when offline.
- **Test** badge (hover) shows the tooltip "A test payment. No real money moved." It appears on sandbox rows only.
- **Try again** (refresh icon) appears only on "Refund failed" rows. It calls RPC `app.deposit_refund_retry(p_payment_id)` and re-sends the refund to Qi Card. There is no confirm and no PIN. On success the toast reads "Refund sent to Qi Card again.". Errors stay on the row: "You do not have permission for that." (FORBIDDEN), "That payment could not be found.", "This belongs to another branch. Switch to that branch to do this." (VENUE_MISMATCH) and "This payment has changed since you opened it. The list now shows where it is." (PAYMENT_STATE). The list re-reads after success or failure.
- **Refund to guest** (undo icon) appears only on "Paid, booking not on" rows and opens a confirm:
  - Title "Refund {amount} to {name}?", body "The deposit goes back to the card the guest paid with. This cannot be undone." The dialog has no X; Esc and the backdrop cancel.
  - **Cancel** closes the confirm. It is disabled while sending.
  - **Refund** (danger button) calls RPC `app.deposit_refund_request(p_payment_id)`, which refunds the whole deposit. On success the toast reads "Refund sent to Qi Card.". On failure the confirm closes and the error shows on the row. A lesson payment whose lesson is still on reads "This lesson is still on. Cancel the sign-up from the lesson's screen; its refund follows." Other errors: PAYMENT_STATE, VENUE_MISMATCH, PAYMENT_NOT_FOUND, FORBIDDEN.
- **Settled another way** (ghost button, lock icon) appears only on "Refund failed" rows, never on slow ones. It opens a dialog titled "Settled another way" with the subtitle "{amount} to {name}. Say how the guest was paid back; this closes the refund.":
  - **How was it settled?** is a required textarea of up to 500 characters, with the hint "For example: paid back in cash at the desk on Saturday."
  - **PIN** is a password field that takes digits only, 6 at most, with the hint "A manager PIN authorises this." Enter submits.
  - **Cancel** closes the dialog. It is disabled while sending.
  - **Mark as settled** (primary, lock icon) stays disabled until the note is non-empty and the PIN has at least 4 digits. The disabled reason reads "Say how it was settled and enter a PIN". The call is PIN-gated: `appRpc` first proves the PIN with `app.verify_manager_pin`, then calls `app.deposit_refund_manual(p_payment_id, p_pin, p_note, p_device_id)`, which closes the refund by hand. On success the toast reads "Refund marked as settled.". On failure the PIN is cleared and the error shows in the dialog: "Incorrect PIN.", "Too many wrong PINs — locked for a few minutes.", "A reason is required." (REASON_REQUIRED), PAYMENT_STATE, VENUE_MISMATCH or PAYMENT_NOT_FOUND.
  - **X**, Esc and the backdrop close the dialog, except while sending.
- **Open lesson** (↗) appears on lesson-payment rows and navigates to `/desk/lessons/$id`.
- **Open customer** (↗) appears on ticket and lesson rows that have a payer and navigates to `/desk/customers/$id`.
- **View more ({n})** / **Show less** shows or hides the rows past the first 3.
- **Try again** appears in the error state and re-reads `app.deposit_attention`.
- *Empty state:* "Nothing waiting. Every online refund has gone through." (no button).

**Everything in Financial** (screen cards). Each whole card is a link. The cards follow rail order, and the hidden Late and early / `/attendance` row gets no card.
- **Reports** opens `/reports/revenue`. Card copy: "Revenue, court income and cafe sales over any period — one tab each, with drill-through and CSV export."
- **Cash drawer** opens `/till/drawer`. Card copy: "Every time the drawer opened and why…"
- **Safe** opens `/safe`. Card copy: "The main cash: pay a cost in three taps…". Live line: "In the safe {IQD}" (`app.main_cash_overview`, every 60 s, hidden until loaded).
- **Day close** opens `/admin/day-close`. Card copy: "Expected against counted, and the variance on each closed day."
- **Wages** opens `/wages`. Card copy: "Each person's salary and pay day…". Live line: "Due now {n}" (`app.wages_due`, every 60 s, owner only).
- **Rewards** opens `/rewards`. Card copy: "Bonuses and prizes for orders placed in a month…"
- **Coach pay** opens `/reports/coaches`. Card copy: "Monthly coach statements: approve and mark paid". Live line: "To approve {n} · To pay {n}" (drafts and approved statements from `app.report_coach_statements` for the latest month). It shows only when either count is above 0, and not when the server lacks the RPC.
- **Rates** opens `/admin/rates`. Card copy: "What an hour on a court costs, by day and time…"
- **Menu prices** opens `/admin/menu`. Card copy: "Cafe prices. A change here moves tomorrow's cafe revenue, not today's."

---

## Reports — `/reports/revenue` (tabs: `/reports/revenue`, `/reports/courts`, `/reports/cafe`)
The money reports. You pick a period and see what was earned, how the courts and the cafe did, and one breakdown at a time. Breakdowns are sortable, rows drill through to their transactions, and the table exports as a spreadsheet.

*Who:*
- `/reports/*` is manager and owner. `/reports/revenue` is owner only (the route guard), and the screen re-checks `viewFinancials` (owner) and would say "Not allowed for your role: Viewing revenue needs the Owner role…".
- `/reports` on its own redirects to `/reports/courts`.
- Inside the owner's **Financial** section the tab strip offers Revenue · Courts · Cafe. Staff activity and Stock value live in Observe and Stock and get no strip there.
- In the manager's Records section the strip offers Courts · Cafe · Staff activity. An owner who switched to the Manager workspace also sees Revenue.
- The owner can block a manager from the "reports" area (0345), and the screen then says "The owner has closed this page for you. Ask them if you need it."
- Branch scope is owner only.

*Source:* `routes/reports.tsx`, `routes/reports/_children.ts`, `features/reports/RevenueReport.tsx`, `CourtsReport.tsx`, `CafeReport.tsx`, `ReportParts.tsx`, `ReportFilterBar.tsx`, `ReportTabs.tsx`, `DrillDialog.tsx`, `ReportBranchScope.tsx`, `FigureGroup.tsx`, `reportFile.ts`, `features/analytics/exportTables.ts`, `components/kit.tsx` (DateRangeControl, ComparisonControl, ExportButton, DataTable, HeadlineFigure).

All three tabs are read-only: none of them calls a write RPC. Each re-reads on its own every 2 minutes.

**Branch scope** (top of every `/reports/*` page, from the layout route)
- **Branch** is a segmented control for the owner only. It shows when the business has more than one branch or any closed branch (the closed list comes from the `venues` table, status closed). Options:
  - the rail branch's name (the default);
  - **All branches** (only when there is more than one open branch);
  - **{name} (closed)** for each closed branch.

  Changing it re-fetches every reports, analytics and panel query with the new scope (the `x-venue-scope` header). "All branches" adds the note "All branches are shown on {name}'s clock and business day." Leaving the reports pages puts the scope back to one branch.

**Shared frame** (Revenue, Courts, Cafe)
*Header:* the eyebrow "Reports", the title (the tab's name) and the subtitle (the period, "1 Oct 2026 – 16 Oct 2026"). With a comparison on, the subtitle reads "{period}, compared with {previous}".
- **Revenue** / **Courts** / **Cafe** tabs: each tab is a bordered button that navigates to its route. Keyboard: Arrow Right and Arrow Left (mirrored in Arabic), Home and End move to a tab and open it. The strip is hidden when fewer than 2 tabs apply.
- **Export** (header button, file icon) downloads the table as `.xlsx`. The file name is `<report>_<from>_<to>[_filter-…]`, for example `revenue_2026-10-01_2026-10-16_group-day_pay-cash`. Hover tooltip: "Downloads the table on screen, every row, as a spreadsheet file." It is disabled while loading, when the period is empty and on error. It runs in the browser with no server call.
- **Period** dropdown with presets: Today, Yesterday, This week, Last week, This month (the default, counted from the venue's business day), Last month, Last 30 days. "Custom" shows, disabled, when the dates match no preset. The dropdown is disabled while the first read loads.
- **From** and **To** date inputs: typing a date shows **Apply**.
- **Apply** sets the typed range. It is disabled when From is after To or while loading.
- **Compare with** dropdown: No comparison (the default), Previous period, Same period last year. With a comparison on, the report is read through `app.report_compare`. Each comparable tile then shows a +/− change with its % ("No earlier data" when there is none), and rises in Discounts, Voids, Refunds, Cancellations and No-shows read as bad.
- **Sort** by column header (every report table, every column): click it, or Enter/Space on the focused header. The first click sorts numbers biggest-first and names or dates A–Z or oldest-first. Clicking again reverses. The header shows "Sorted ascending" or "Sorted descending".
- **View more ({n})** / **Show less** appears under tables capped at 3 rows. The court tables, By category, Waste and By lesson type always show every row. Export always takes every row.
- **Hover a truncated name** (court, item, category, coach, lesson type, drill "What") to see the full text as a tooltip.
- **Try again** appears in the error state ("This could not be loaded." / "You may be offline…") and re-runs the report RPC.
- Empty-period call to action: **Last 30 days**, or **Last month** when the period is already the last 30 days. It sets the period.

**Revenue tab — `/reports/revenue`** (`app.report_revenue`: `p_from`, `p_to`, `p_group`, `p_filters {paymentMethod, staffId}`)
*Filters row:*
- **Paid by** dropdown: Cash and card (default), Cash, Card. A filter adds the note "Only {Cash/Card} payments and the cafe tabs paid with them. Bookings have no payment method, so padel is not narrowed." Drill-throughs ignore it and say "This list includes every payment method."
- **Staff member** dropdown: Everyone (default), then every staff member from `app.list_staff`, removed staff included. A choice adds the note "Only what {name} recorded: bookings they made, orders they placed, payments they took, and the discounts, voids and refunds they gave." It scopes drill-throughs too (`staff:<id>`).
- **Compare with**, as in the shared frame.

*Figures:* there are four groups (Earned, Money taken, Given away, Tax), each with a hint.
- Clickable tiles show ↗ and the tooltip "Transactions behind this figure", only when the server sent a value. Clicking opens the drill dialog for the whole period:
  - **Revenue** (`revenue`)
  - **Padel** (`padelRevenue`, hint "Bookings: {n}")
  - **Cafe** (`cafeNet`, hint "Orders: {n}")
  - **Cash**
  - **Card**
  - **Discounts**
  - **Voids**
  - **Refunds**
- Not clickable: **Lessons**, **Owed to coaches** (hint "Coaches' share of lesson money, paid outside the till") and **Tax**.

*Breakdown:*
- **Show** segmented control: Earned (default) / Money taken / Given away / Tax. It changes the table's columns and the lead sentence.
  - Earned: Day, Padel, Cafe, [Lessons], Revenue, Bookings, Orders.
  - Money taken: Day, Cash, Card.
  - Given away: Day, Discounts, Voids, Refunds.
  - Tax: Day, Cafe sales, Tax.
- **Group by** segmented control: Day (default) / Week / Month. It re-reads the rows (`p_group`), and the first column becomes Day, "Week starting" or Month. The figures above do not change.
- Hint above the table (except on Tax): "Click a row to see the transactions behind it."
- **Row click** (or Enter/Space on a focused row) in Earned, Money taken or Given away opens the drill dialog for that day, week or month, cut to the period on screen. The dialog is titled by the breakdown, with a figure switch: Earned has Revenue / Padel / Cafe, Money taken has Cash / Card, and Given away has Discounts / Voids / Refunds. Tax rows do not open.
- *Notes under the table* ("Reading the table") explain Revenue, Bookings, Voids and Cafe sales. They are read-only.
- Export always takes every revenue column, whichever breakdown is on screen: Padel, Cafe, [Lessons, Owed to coaches], Revenue, Cafe sales, Cash, Card, Discounts, Voids, Refunds, Tax, Bookings, Orders.
- *Empty state:* "No sales, bookings or payments in this period" / "Try a longer period." with **Last 30 days** (or **Last month**).

**Courts tab — `/reports/courts`** (`app.report_courts`, `p_filters {courtId}`)
*Filters row (court views):*
- **Court** dropdown: All courts (default), then each active court. It is hidden on the Open matches and Lessons views.
- **Compare with**, as in the shared frame.

*Figures (not clickable):* Bookings kept ("Not counting cancellations and no-shows"), Hours booked, Occupancy ("Of {h} open court hours", plus ". Lesson time counts as booked." once lessons exist), Court revenue, Cancellations, No-shows and Event hours. Event hours appears only when a tournament held a court in the period.

*Breakdown:* **Show** segmented control: By court (default) / Cancellations / Peak times / By start time / By day. **Open matches** is added when the server sends report_courts' `matches` block, and **Lessons** when it sends the `lessons` block.
- **By court:** columns Court (with a "Retired" badge on inactive courts), Bookings, Hours booked, [Lesson hours], [Event hours], Occupancy, Revenue and Per open hour. Every court shows. **Row click** opens the drill dialog "{court} · {period}" with figure Bookings (`court:<id>`).
- **Cancellations:** columns Court, Bookings, Cancelled, Cancelled %, No-shows and No-show %. **Row click** opens the drill dialog with the switch **Cancelled** / **No-shows**. With none in the period it shows "No cancellations or no-shows in this period." and nothing to click.
- **Peak times:** columns Court, Peak and Off-peak. **Row click** opens the drill dialog with Bookings.
- **By start time:** a read-only bar list ("{hh}:00" with a count). With no bookings it shows "No bookings in this period."
- **By day:** columns Day, Bookings and Revenue. **Row click** opens the drill dialog "Bookings" for that one day, scoped to the court filter if one is set. With no rows it shows "No bookings in this period."
- **Open matches** (also reads `app.report_matches`):
  - **Category** dropdown: All categories / Open / Women / Men.
  - **Joining** dropdown: Any / Anyone joins at once / Players ask to join.
  - **Compare with** is shown but disabled, and the note reads "Comparison isn't available for open matches yet."
  - Read-only: the band (Match bookings, Court price booked, Paid at the desk, Written off, No-show seats, Called off short, Lost tickets at this branch), and the Matches and Seats lists.
  - The **By day** table is sortable and capped at 3 with View more. Its rows do not open.
  - Empty: "No open matches in this period."; "Test matches are left out." when it applies.
- **Lessons** (also reads `app.report_lessons`):
  - **Compare with** is disabled, with the note "Comparison isn't available for lessons yet." There is no court filter.
  - Read-only: the band (Lessons, Court hours, Collected, Court share, Owed to coaches), and the "How the lessons went" and Money lists.
  - **Export By coach**, **Export By lesson type** and **Export By day** (ghost buttons) each download that one table as a one-sheet `.xlsx`.
  - The tables By coach (capped), By lesson type (all rows) and By day (capped) are sortable. Their rows do not open.
  - Empty: "No lessons in this period."
- **Export** (header) depends on the view:
  - court views: every court column plus "Available hours" (and "Event minutes");
  - By start time: Hour / Bookings;
  - By day: the day table;
  - Open matches: its By day table;
  - Lessons: one workbook with three sheets (By coach, By lesson type, By day).
- *Empty state:* "No bookings in this period" / "Nothing was booked, cancelled or missed on any court. Try a longer period." with **Last 30 days** (or **Last month**).

**Cafe tab — `/reports/cafe`** (`app.report_cafe`, `p_filters {categoryId}`)
*Filters row:*
- **Category** dropdown: All categories (default), then each menu category.
- **Compare with**, as in the shared frame.

*Figures (not clickable):* Cafe revenue ("After discounts and refunds"), Orders, Average order, Items sold, Gross profit ("Margin {m}", or "Margin {m}, on the {with} of {total} items with a cost") and Average prep time ("9 in 10 ready within {p90}").

*Breakdown:* **Show** segmented control: Best sellers (default) / Cost & profit / By category / Waste.
- **Best sellers:** columns Item, Category, Sold, Orders and Revenue (capped at 3, with View more). **Row click** opens the drill dialog with that item's sold lines (`item:<id>`, no figure switch).
- **Cost & profit:** columns Item, Revenue, Cost, Gross profit and Margin. **Row click** works the same way as on Best sellers.
- **By category:** columns Category, Items, Sold, Revenue, Cost, Gross profit and Margin. Every row shows. Rows do not open.
- **Waste:** columns Reason, Times recorded and Cost. Every row shows, and rows do not open. The category filter does not apply here.
  - **See each write-off** (↗) sits beside the Show switch when there is waste. It opens the drill dialog "Waste" (figure `waste`) for the period.
  - With no waste it shows "Nothing was written off in this period."
- With no items, Best sellers and Cost & profit show "Nothing was sold in this period".
- **Export** (header) depends on the view: By category exports the category table, Waste the waste table, and Best sellers or Cost & profit the items with their sales and cost columns.
- *Empty state:* "Nothing was sold in this period" / "Try a longer period, or another category." with **Last 30 days** (or **Last month**).

**Drill dialog** (opened from any of the three tabs; `app.report_drill(p_figure, p_key, p_from, p_to)`)
*Title:* "{what} · {date or from – to}". The table has the columns When / What / By / Amount. It is not sortable and scrolls inside the dialog.
- **Show** segmented control appears only when the drill carries several figures. It switches the figure and re-reads.
- **Hover the What cell** to see the full description, for example "Booking · Court 2".
- **Try again** appears in the error state and re-reads.
- **Close** (footer button), **X**, Esc or the backdrop closes the dialog.
- *Read-only notes:* "This list includes every payment method." (when the Paid by filter is on), "The latest 500 are listed." (at the cap), and the empty state "No transactions in this range."

---

## Cash drawer — `/till/drawer`
The page for the cash drawer. A cashier uses it to record opening the drawer by hand and to start or end their own till shift. A manager or owner uses it to read every till and desk shift for a business day, and the open day's drawer log.

*Who:* cashier, manager, owner. The route key is `/till` (ROUTE_ROLES), guarded by `RequireRole('/till')`. Rails: the cashier workspace row "Cash drawer"; the owner's Management › Financial row "Cash drawer". The manager rail has no row for it. A manager reaches it by URL or from the cashier workspace via the workspace picker. In-screen gates:
- `can.viewDrawerLog` (manager, owner) switches between the two views below.
- `can.closeDay` (manager, owner) shows the "Day close" link.
- The till-shift card follows the shell's ShiftProvider. It shows only for a shift holder (`takeCourtPayment`: cashier, court_desk, shop_staff, manager, owner) on a station that has a drawer (till, desk or shop mode). Managers and owners are never asked to hold a shift (`payOnOthersShift`).
- The same screen also renders at `/shop/drawer` for the shop assistant. That route is out of scope here.

*Source:* apps/operator/src/features/till/CashDrawer.tsx, till/drawerReasons.ts, tillShift/DrawerShift.tsx (YourShift), tillShift/TillShiftPanel.tsx, tillShift/ShiftDialog.tsx, tillShift/DrawerDay.tsx, tillShift/drawerDayLogic.ts, tillShift/ShiftRows.tsx (DifferenceWords, shiftNotes), tillShift/api.ts, tillShift/tillShiftLogic.ts, tillShift/ShiftProvider.tsx, tillShift/ShiftRailControl.tsx, tillShift/LeaveShiftDialog.tsx, tillShift/LockLeaveGuard.tsx, components/kit.tsx (ReasonCodePrompt), components/ui.tsx (AmountPad, Modal).

**Cashier view (no drawer log): header and load states**
- **Cash drawer** (page title), with the subtitle "Day opened {time}" while a business day is open. Read-only.
- **Drawer opening recorded.** A success banner that appears after a recorded opening. It clears the next time "Open drawer" is pressed.
- **Try again** — shows only when the open-day read (`QK.day`) fails, under "This could not be loaded." and "You may be offline. The last known data is shown where available." It re-fetches the open day.
- Empty state when no day is open: "No business day is open, so there is no float." with "A manager opens the day (and sets the float) from Day close." There is no button. The shift card and "Open drawer" are hidden.
- Error line under the page (red, role=alert) for a failed drawer recording. It shows only while the reason dialog is closed.

**Cashier view: "Your shift" card (YourShift; one of four states)**
- *My shift is open here.* The panel is titled "Your shift" and is read-only: "Started at {time}", "Started with {IQD}", "Payments {n}", "Refunds {n}", "Drawer opened by hand {n}", and the note "The expected amount shows when you end your shift and count the drawer."
  - **End my shift** (small button, lock icon) replaces the card with the inline close flow. See "Close a shift" below; Cancel there returns to the card.
- *Someone else's shift is open on this till.* A muted panel: "{name}'s shift is open on this till" and "Since {time}. Close it with a manager's PIN to start yours."
  - **Close {name}'s shift** (lock icon) opens the inline close flow, which needs a manager's PIN.
- *No shift open, and the payment gate wants one.* The inline start panel (TillShiftPanel → ShiftDialog inline, entry `gate`) takes the card's place. Its subtitle is "Start your shift before the first payment." See "Start a shift" below. If the gate's reason is "your shift is open on another till", the panel instead reads "Your shift is open on {station}" and "End it there, then start one here.", with no button.
- *No shift open, gate not blocking.* This happens when the page is offline, the status read failed, there is no day, or sales are still queued. Fallback panel: "No shift is open on this till" and "Start your shift before you take payment."
  - **Start my shift** opens the start dialog as a modal (ShiftProvider `openStart`). It is disabled with a tooltip "The day is not open yet" when no day is open, or "Your shift is open on {station}" when the shift is elsewhere.
- Nothing is drawn while the shift status is unknown or loading, at a station with no drawer, or outside the shell.

**Cashier view: open the drawer by hand**
- **Open drawer** (large button, drawer icon). It is primary unless the shift start panel is showing. It sits under the hint "Open the drawer by hand, then record why here." and opens the "Open the drawer" dialog. It is only shown while a day is open.

**"Open the drawer" dialog (ReasonCodePrompt; the cashier, manager and owner views share it)**
- Title "Open the drawer". The lead repeats "Open the drawer by hand, then record why here." The dialog has no X button. Esc closes it when not busy; a backdrop click does not close it.
- **Why?** A radio list with one choice: **Customer request** (the default), **Staff error**, or **Other**.
  - **What is the reason?** A text field that appears only for "Other". Placeholder "Write the reason", 200 characters at most. It is required.
- **Cancel** closes the dialog. It is disabled while saving.
- **Continue** calls RPC `app.record_drawer_open(p_reason_code, p_device_id, p_tab_id = null)`. The reason is sent as `customer_request`, `staff_error` or `other: <text>`.
  - The call is online only (direct appRpc, not queued) and needs no PIN.
  - It writes an audit row `drawer.open` against the open day. That row feeds the drawer log and the shift's "Drawer opened by hand" count.
  - On success the dialog closes, "Drawer opening recorded." appears, and the drawer log refreshes.
  - The button is disabled with the tooltip "Write the reason to continue" when "Other" has no text.
  - Errors shown in the dialog: FORBIDDEN "You do not have permission for that."; VENUE_MISMATCH "This belongs to another branch. Switch to that branch to do this."; REASON_REQUIRED "A reason is required."; offline "No connection. Check your internet and try again."

**Start a shift (ShiftDialog start, opened inline on the page or as a modal from "Start my shift")**
- Title "Start my shift". Read-only lines:
  - The handover: "{name} left {amount} in the drawer at {time}." or "You left {amount} in the drawer at {time}.".
  - Cash outside a shift since then: "Since then, {amount} was taken here with no shift open." or "… was paid out here …".
  - The day's first till shift: "The day opened with {amount} in the drawer.".
  - The desk's first shift: "Count the cash in the desk's box to start.".
- Refusal banners shown before the server is asked:
  - "The day is not open yet. A manager opens it on Day close."
  - "Sales made here are still waiting to send. Start once they are sent."
  - "Your shift is still open on {station}. End it there first."
  - "{name}'s shift is still open here."
- The question "Is {amount} in the drawer now?":
  - **That's right** (check icon; autofocused in the modal) starts the shift with the prefilled amount. It calls `app.heartbeat` first (best effort), then RPC `app.open_till_shift(p_opening_float_iqd, p_device_id, p_note, p_idempotency_key)`. It is disabled while a refusal shows or there is nothing to prefill.
  - **I counted a different amount** switches to the count form.
- Count form:
  - **Cash in the drawer now** (money field; hint "Everything in the drawer, float included."; at most 999,999,999,999). Blank means nothing entered.
  - Amount keypad: **1–9**, **000**, **0**, **Delete** (⌫), **Clear**. Typing digits, Backspace and Enter work while the keypad has focus; Enter starts the shift.
  - **Note** (optional; hint "What you found, if it is not what was handed over."; 500 characters at most). Not shown for the desk's first count.
  - **Back** returns to the question. On the desk's first count this button is **Cancel** instead.
  - **Start my shift** (play icon) calls `app.open_till_shift` with the typed amount. It is disabled while blank or refused.
- The start is online only and needs no PIN. Success toasts: "Shift started.", "Shift started with {amount} more than was handed over." or "Shift started with {amount} less than was handed over.". The start panel then goes away.
- Errors: TILL_SHIFT_ALREADY_OPEN "You already have a till shift open. End it before you start another."; TILL_SHIFT_STATION_BUSY "Someone else's shift is still open on this till. It has to be counted and closed first."; TILL_SHIFT_UNSYNCED "This till still has sales waiting to send. Try again once they are sent."; TILL_SHIFT_WRONG_STATION "Start and end a till shift at the till itself, signed in there."; NO_OPEN_DAY "No business day is open."; INVALID_FLOAT "Invalid opening float."; TEXT_TOO_LONG. A state refusal also re-reads the station status.
- Modal only: the **X** and Esc dismiss it. Inline on the page there is nothing to dismiss.

**Gate on the page: someone else's shift (ShiftDialog gate, inline)**
- Title "{name}'s shift is still open", lead "Count {name}'s drawer and close the shift with a manager's PIN, then start yours."
  - **Close {name}'s shift** (primary, lock icon) opens the close flow with a manager's PIN. Cancel inside that flow returns here.
  - After a close succeeds: **Start my shift** (play icon) goes to the start panel.

**Close a shift (ShiftDialog close: End my shift / Close {name}'s shift)**
- Title "End my shift" or "Close {name}'s shift".
- Step 1, the count. This is a blind count: no expected figure is shown. Lead: "Count all the cash in the drawer, float included. The difference shows once the count is signed."
  - **Cash in the drawer** (money field, at most 999,999,999,999) and the amount keypad (**1–9**, **000**, **0**, **Delete**, **Clear**; Enter confirms the count).
  - **Note** (optional, 500 characters at most).
  - **Cancel** goes back to the card or flow.
  - **Next** (chevron) is disabled until a count is typed. 0 counts as a count.
- Step 2, sign. The text reads "Your PIN signs a count of {amount}." or "A manager's PIN signs a count of {amount}.". The info line "You have no PIN yet, so a manager signs this count." shows when the cashier has no PIN (read through `app.has_own_pin`).
  - **Your PIN** or **Manager's PIN**: a password field, digits only, 12 at most.
  - **Use a manager's PIN instead** or **Use my PIN** (ghost button). Offered only on one's own shift when the person has a PIN.
  - **Change the count** goes back to step 1 and clears the PIN.
  - **End my shift** (own) or **Close the shift** (someone else's) has a lock icon. Enter submits too. It is disabled until the PIN has 6 digits.
    - Own PIN: `app.heartbeat`, then RPC `app.close_till_shift(p_till_shift_id, p_counted_iqd, p_pin, p_device_id, p_note, p_idempotency_key)`.
    - Manager PIN: `app.heartbeat`, then `app.verify_manager_pin`, then `app.close_till_shift_for(...)`.
    - Online only.
    - Errors: PIN_INVALID "Incorrect PIN." (the PIN field clears); PIN_LOCKED "Too many wrong PINs — locked for a few minutes."; NO_PIN_SET switches to the manager's PIN automatically; TILL_SHIFT_CLOSED "This shift is already closed. Refresh to see the latest."; TILL_SHIFT_NOT_FOUND; TILL_SHIFT_NOT_YOURS "This is someone else's shift. Closing it needs a manager's PIN."; TILL_SHIFT_UNSYNCED; TILL_SHIFT_WRONG_STATION; INVALID_COUNT "Invalid counted amount."; NO_OPEN_DAY.
- Step 3, the result. Title "Shift closed", then:
  - The outcome: "The drawer matches", "Short by {amount}" or "Over by {amount}".
  - The figures: "Started with", "Cash taken", "Cash refunded", "Expected in the drawer", "Counted".
  - "{amount} stays in the drawer for the next shift." and "Signed with {name}'s PIN." when a manager signed.
  - Own shift: **Stay signed in** closes the result; **Sign out** (logOut icon) closes it and signs out. Someone else's shift: **Done**. From the gate: **Start my shift**.

**Manager / owner view: header and messages**
- **Cash drawer** (title) with the subtitle "Day opened {time}" while a day is open.
- **Drawer opening recorded.** A success banner after a recording.
- An error line under the header for a failed recording.
- An info banner when no day is open: "No business day is open, so there is no float. A manager opens the day (and sets the float) from Day close."

**Manager / owner view: day stepper and actions (DrawerDay)**
- **Previous day** (back chevron icon button) steps one business day back. It is disabled until the first read lands. It calls RPC `app.till_shift_list(p_from = p_to = that date)`.
- Day name heading, for example "Thursday 15 October 2026". Read-only. The first view is the open day, otherwise the latest day with shifts, using `app.till_shift_list` with no dates.
- **Next day** (forward chevron) is disabled on the latest day. Stepping onto the latest day returns to live mode.
- **Latest day** (ghost) shows only after stepping back and jumps to the latest day.
- **Day close** (link styled as a button, lock icon) navigates to `/admin/day-close`. Only for `can.closeDay`.
- **Open drawer** (primary, drawer icon) opens the "Open the drawer" dialog above. It is disabled with the tooltip "No business day is open, so there is no float." when no day is open. It records against the open day whichever day the stepper shows.
- Load error: "This could not be loaded." with **Try again**, which re-fetches the shift list. The page auto-refreshes every 30 s.

**Manager / owner view: figures (read-only)**
- "Opening float" with the hint "Set by the manager when the day was opened.". Only on the open day.
- "Cash taken", with the hint "Cash refunded: {IQD}" when there were refunds.
- "Card taken".
- "Counted at shift ends", with the hint "{counted} of {total} shifts counted". Shows — when nothing was counted.
- "Difference": "Short by / Over by {amount}" or "The drawer matches", with the hint "Still open: {n}".

**Manager / owner view: "Shifts" table (read-only, one row per shift, every till and the desk at the branch)**
- Columns:
  - **Person**: name; the station id; "Payments n · Refunds n · Drawer opened by hand n"; notes such as "At handover: {amount} more/less than handed over", "Manager's PIN: {name}" and "Note: {close note}".
  - **Time**: "{start}–{end}", or "Since {time}" while open.
  - **Started with**, **Cash taken**, **Cash refunded**, **Expected in the drawer**, **Counted at the end**.
  - **Difference**: an "Open" badge, "Ended with the day, not counted", "Short by / Over by {amount}", "The drawer matches", or —.
- There is no row click and no sort.
- Empty state: "No shifts on this day."
- Footnote "Taken with no shift open: {taken} in cash, {refunded} refunded." when such money exists.

**Manager / owner view: "Drawer activity today" panel (only while the stepper shows the open day)**
- Header counts "Cash payments: {n} · Opened by hand: {n}".
- Table columns: **Time**; **What**, which reads "Cash payment" over the tab ("Table 4", a booking or an open match) or "Drawer opened" over the reason ("Customer request", "Other — {text}"); **Paid in**; **Change given**; **Recorded by**, which is a name for a payment and a role for a hand opening.
  - Hovering a truncated **What** or **Recorded by** cell shows the full text as a tooltip.
- Empty state: "No drawer activity yet today." / "Cash payments and manual openings will appear here."
- Error: **Try again** re-fetches.
- Reads `audit_log` (`drawer.open` since the day opened) and the open day's cash `payments`. Auto-refresh every 30 s.

**Shell controls present on this page (till or desk station; ShiftRailControl, ShiftProvider)**
- Rail **Start my shift** (drawer icon) opens the start dialog modal. It is disabled with the caption "The day is not open yet" or "Your shift is open on {station}".
- Rail **End my shift**, captioned "My shift · since {time}", opens the close dialog for one's own shift.
- Rail **Close this shift**, captioned "{name}'s shift · since {time}", opens the close dialog with a manager's PIN. The manager or owner sees this when someone's shift is open at the station.
- Rail **Sign out** while one's own shift is open opens the "Your shift is still open" dialog (LeaveShiftDialog). Body: "Count the drawer and end your shift before you sign out. If you sign out now, it stays open here until a manager closes it."
  - **Cancel**.
  - **Sign out anyway** signs out and leaves the shift open.
  - **End my shift** (primary, autofocused) runs the close flow; its result step offers only **Sign out**.
- Idle lock **Switch user** with one's own shift open (LockLeaveGuard). It shows "{name}'s shift is still open here. Signed out, it stays open until a manager closes it."
  - **Back**.
  - **Sign out anyway** (danger).
- Not rendered on this screen: ShiftReport (it lives on the Staff activity report) and the per-row "Close {name}'s shift" of ShiftRows (no screen here passes it).

---

## Safe — `/safe`
The branch's main cash, the safe. On this page a manager or owner logs every cost paid from the safe or by bank transfer, moves cash in and out, counts the safe, and reads the month's costs and every movement with the balance after it.

*Who:* manager, owner (ROUTE_ROLES `/safe`). Rails: the owner's Management › Financial row "Safe" and the manager's Run the day row "Safe". Linked from Day close's hand-in panel. In-screen differences:
- The owner (`is_owner` from `app.main_cash_overview`) also sees the "Wages" link.
- A manager sees "A staff member" instead of the person on wage and advance rows.
- The server limits every write to manager and owner (FORBIDDEN otherwise).
- There is no branch picker on the page: it is the current branch.

*Source:* apps/operator/src/features/safe/SafePage.tsx, safe/api.ts, safe/safeLogic.ts, components/kit.tsx (SegmentedControl, ViewMore/useListCap).

**Header**
- **Safe** (title), lead "The main cash. Log every cost paid out of it and every move of cash in or out, and the balance keeps itself." Read-only.

**Balance (read-only)**
- "In the safe" with the balance. The amount is red when below zero.
- "Today: {in} in, {out} out".
- The last count: "Counted {date time} by {name}, it matched", "… {amount} short" or "… {amount} over"; or "Not counted yet. Count it once to start from a real figure.".
- The warning "Below zero: something was paid that never came in. Count the safe to set it right." when the balance is negative.

**Form mode switch**
- **What are you logging?**, a segmented control: **Pay** (banknote icon), **Move cash** (repeat icon), **Count** (scale icon). Each switches the form below.

**Pay form**
- **How much**: a money field, blank allowed, at most 1,000,000,000.
- **What for**: chips **Shopping**, **Supplier**, **Rent**, **Bills**, **Repairs**, **Marketing**, **Other**. Required.
- **Paid to**: optional text, placeholder "Shop, person or company", 80 characters at most. It autocompletes names typed before for the chosen category, newest first (the server keeps 180 days, up to 40 names).
- **Paid from**: a segmented control, **Safe** (the default) or **Bank transfer**. Bank adds the hint "Listed with the costs. The safe does not change."
- **Note**: optional text, placeholder "Optional", 300 characters at most.
- The warning "The safe shows {balance}. This payment takes it below zero. Log it anyway if the money left." shows when paying from the safe more than the balance. It is a warning, not a block.
- **Pay** / **Pay {amount} from the safe** / **Log {amount} paid by bank** (large primary, check icon; Enter in any field submits). It calls RPC `app.main_cash_pay(p_amount_iqd, p_category, p_payee, p_paid_from, p_note, p_idempotency_key)`.
  - Online only, no PIN, no confirm step.
  - It adds a payment row. From the safe it lowers the balance; by bank it is listed with the costs only.
  - Toasts: "Paid {amount} from the safe." / "Logged {amount} paid by bank.". The form resets but keeps "Paid from", and the focus returns to the amount.
  - Disabled tooltips: "Type the amount first.", "Choose what it was for.", "Keep the name under 80 characters.", "Keep the note under 300 characters.".
  - Errors: FORBIDDEN; INVALID_ARGUMENT "Invalid input — check the values and try again."; TEXT_TOO_LONG "That text is too long."; offline "No connection…".
- The note "Wages, advances and coach pay are paid from their own pages, so each is counted once." comes with two links:
  - **Wages** (↗) navigates to `/wages`. Owner only.
  - **Coach pay** (↗) navigates to `/reports/coaches`.

**Move cash form**
- **Which way**: a segmented control, **Into the safe** (the default) or **Out of the safe**.
- **From** (into) or **To** (out): chips **Café till**, **Court desk** (only when the branch has a desk station), **Shop desk** (only when it has a shop station), **Bank**, **Owner**. Required.
- **How much**: a money field, at most 1,000,000,000.
- **Note**: optional, placeholder "Optional", 300 characters at most.
- **Move** / **Move {amount} into the safe** / **Move {amount} out of the safe** (large primary; Enter submits). It calls RPC `app.main_cash_move(p_kind, p_amount_iqd, p_box, p_note, p_idempotency_key)`.
  - p_kind is one of: hand_in (drawer → safe), to_drawer (float out), owner_in, owner_out, bank_in, bank_out.
  - Online only, no PIN, no confirm step.
  - Toast "Moved {amount}.". The form resets but keeps the direction.
  - Disabled tooltips: "Choose where the cash comes from." / "Choose where the cash goes.", "Type the amount first.", "Keep the note under 300 characters.".
  - Errors: FORBIDDEN, INVALID_ARGUMENT, TEXT_TOO_LONG.

**Count form**
- Lead "Count the cash in the safe and type the total. The balance becomes what you counted, and any difference stays in the list." "The safe should hold {balance}" is read-only.
- **You counted**: a money field, at most 1,000,000,000.
- **Note**: optional, 300 characters at most.
- **Save the count** (large primary; Enter submits) calls RPC `app.main_cash_count(p_counted_iqd, p_expected_iqd = the balance shown, p_note, p_idempotency_key)`.
  - It sets the balance to the count and logs the difference as a count row.
  - Toasts: "Counted. The safe matches." / "Counted. {amount} short. The balance is now what you counted." / "Counted. {amount} over. …".
  - It is disabled with the tooltip "Type what you counted." while blank. It is also disabled until the overview has loaded.
  - Errors: MAIN_CASH_CHANGED "The safe changed while you were counting. Check the new figure and count again." (the figures refresh); INVALID_ARGUMENT; TEXT_TOO_LONG; FORBIDDEN.

**Month stepper (drives the costs and the ledger)**
- **Previous month** (ghost chevron icon button) steps back a month. It is disabled while loading. It calls RPC `app.main_cash_overview(p_month)`.
- Month heading, for example "October 2026". Read-only.
- **Next month** is disabled on the current month. Reaching the current month returns to live mode (`main_cash_overview` with no month). The forms always log to today, whatever month is shown.
- Load error: "This could not be loaded." with "You may be offline…" and **Try again**, which re-fetches. Auto-refresh every 60 s.

**"Where the money went" (the month's costs; read-only)**
- Header total "{amount} this month".
- One row per category (Shopping, Supplier, Rent, Bills, Repairs, Marketing, Other, Wages, Wage advance, Coach pay): "{n} payments", "· {amount} by bank" when any was paid by bank, the total, and a share bar.
- **View more ({n})** / **Show less** shows when there are more than 3 categories.
- Empty: "No costs logged this month."

**"Every movement" (ledger)**
- **Show**: a small segmented control, **All** / **Payments** / **Moves and counts**. It filters the list on the client.
- Each row (read-only):
  - The date and time.
  - The title, one of: "{category} · {payee}" or "{category} · A staff member"; "In from the café till / court desk / shop desk"; "Float out to the …"; "The owner put cash in"; "The owner took cash out"; "Taken from the bank"; "Paid into the bank"; "Counted {amount}".
  - The meta line: "Paid from the safe", "Paid by bank" or "at day close" · the note · "by {name}".
  - The signed amount (+ green, − or muted) and "Balance {amount}".
  - A voided row is crossed out with "Taken back by {name}: {reason}".
  - Wage, advance and coach-pay rows say "Undo it on the {Wages / Coach pay} page and the safe follows." and have no button.
- **Take back** (ghost, undo icon; accessible name "Take back {title}") shows only on live rows logged on this page or at day close. It opens the take-back dialog.
- **View more ({n})** / **Show less** shows when there are more than 3 rows.
- Empty: "Nothing logged this month" / "Pay a cost or move cash and it shows here, with the balance after it."

**Dialog "Take back this entry?"**
- Body "It stays in the list, crossed out, and stops counting toward the balance."
- **Why**: a required text field, autofocused, placeholder "For example: logged twice", 300 characters at most.
- **Keep it** closes the dialog. It is disabled while saving. The X and Esc also close it when not saving.
- **Take back** (danger, undo icon) is disabled until a reason is typed. It calls RPC `app.main_cash_void(p_id, p_reason)`.
  - The row stays listed, voided, and no longer counts in the balance. Voiding a day-close hand-in lets that box be handed in again.
  - Toast "Taken back.".
  - Errors: MAIN_CASH_LINKED "This payment belongs to a wage, an advance or a coach payment. Undo it on that page and the safe follows."; REASON_REQUIRED "A reason is required."; INVALID_TRANSITION "That status change is not allowed." (already voided); REF_NOT_FOUND; TEXT_TOO_LONG; FORBIDDEN.

---

## Day close — `/admin/day-close`
The page where a manager or owner opens the business day with a float. Later in the day they settle what blocks the close, count the drawer, read the card terminal, close the day, and hand each drawer's cash to the safe.

*Who:* manager, owner. The route key is `/admin` (ROUTE_ROLES), guarded by `guarded('/admin/day-close')`. Rails: the owner's Management › Financial row "Day close" and the manager's Run the day row "Day close". Linked from Cash drawer "Day close", the Ops overview and Financial home. In-screen gates:
- `can.closeDay` (manager, owner) for Open the day, Close the day, Dismiss and the hand-in panel. A role without it would see "Not allowed for your role: {action} needs the Manager role…", but the route already restricts the page to manager and owner.
- `decideHoldStanding` (manager, owner) for Lift and Ban.

*Source:* apps/operator/src/features/admin/DayClose.tsx, dayCloseLogic.ts, DayCloseOnline.tsx, HandInToSafe.tsx, handInLogic.ts, features/shop/DayCloseShop.tsx, features/holds/HoldStandingPanels.tsx (HoldReviewsPanel), tillShift/ShiftRows.tsx, ops/opsLogic.ts (auditDrillHref, tillTabHref), components/ConfirmDialog.tsx, components/ui.tsx (AmountPad), components/kit.tsx (ExportButton).

**While loading**
- "Day close" with "Loading…". There are no actions.

**No open day: "Open the day"**
- Header "Open the day", lead "No business day is open, so the till cannot take orders. Count the float in the drawer, then open the day." A failed day read shows its error line here.
- **Cash float in the drawer (IQD)**: a text field, digits only, starting at 0.
- Amount keypad: **1–9**, **000**, **0**, **Delete**, **Clear**. Clear sets 0. Enter on the keypad opens the day.
- **Open the day** (large primary, sun icon) calls RPC `app.open_day(p_opening_float_iqd, p_device_id)`.
  - Online only, no PIN, no confirm step.
  - It creates today's `day_sessions` row with the float and writes the audit row `day.open`. The page then switches to the close steps.
  - If today's business date already has a day, the server returns it as a duplicate instead of opening a new one.
  - Errors: PREVIOUS_DAY_OPEN "Close the previous day before opening a new one."; VENUE_CLOSED "This branch is closed."; INVALID_FLOAT "Invalid opening float."; FORBIDDEN.
  - The button is disabled when the role lacks `closeDay`; "Not allowed for your role" shows above it.
- **Last close** panel (read-only): "Business day {date}" with "Matches", "Short by {amount}" or "Over by {amount}"; or "No day has been closed yet.". Hidden while loading or on error.
- **Hand cash to the safe** panel (pending mode). It shows only when the last closed day still has a drawer box with net cash and no hand-in. See "Hand cash to the safe" below.

**Open day: header**
- Title "Day close", subtitle "Business day {date} · open since {time} · float {IQD}".
- **Export** (fileText icon; tooltip "Export the day's figures") downloads `day-close-{date}.xlsx`, built client-side. The "Day close" sheet holds the figures, the till-shift rows, cash outside a shift and the cross-day refunds. The "Adjustments" sheet holds every discount and override. The button is disabled until the day summary or the close result has loaded, and it also works before the close.

**"Close the day" steps panel (left column)**
- A status badge: "Ready to close", "Open tabs left" or "Waiting to sync".
- **Step 1 "Settle or void every open tab"**. Status "No open tabs" or "{n} still open". Hint "Open each one at the till and take the payment or void it. This list updates by itself." The list refreshes every 30 s.
  - Each row shows the tab name ("Table {n}", the guest or booking name, "Open match", or "Tab without a name") and a status badge ("Open" or "Awaiting payment").
  - **Open at the till** (receipt icon, ↗) navigates to `/till?tab={tabId}`, the till with that tab selected.
  - **Open booking** (calendar icon, ↗) navigates to `/desk/bookings/{reservationId}`. Only on a tab that is a booking's bill.
- **Step 2 "Let this station finish syncing"**. Status "Everything is synced" or "{n} waiting". This step shows only on the desktop shell; in a browser the queue is always empty. The hint reads: "Anything waiting or sending will sync by itself once the station is online. Anything the server refused will never sync: check that tab at the till, then dismiss it here with a manager PIN."
  - Each row shows the write kind (Order, Kitchen ticket, Payment, Booking, Waiter call, Waste record, New tab, Discount, Refund, Voided line, Tab removal, Bill closed at zero, Change) and its state: "Waiting to send", "Sending", "Conflict — resolve at the desk" or "Failed — will not retry", plus the server's error message.
  - **Dismiss** (x icon) shows only on conflict or failed rows and opens the dismiss dialog. It is disabled without `closeDay`.
- **Step 3 "Count the cash in the drawer"**. Status "Counted" once a value is entered.
  - Read-only: "Opening float", "Cash taken today", and "Cash taken at the court desk" (hint "Already in the cash taken today. It is in the court desk's cash box, so count that box too."), the last only when the desk took cash.
  - **Counted cash (IQD)**: a money field. Blank means not counted. Hint "Everything in the drawer, float included. The expected amount and any difference are worked out when the day closes." At most 999,999,999,999.
  - Amount keypad: **1–9**, **000**, **0**, **Delete**, **Clear**. Clear returns the field to blank. Enter does nothing here.
- **Step 4 "Enter the card terminal total"**. Status "Optional" while blank.
  - Read-only: "Card taken today", and "Card taken at the court desk" (hint "Already in the card taken today.").
  - **Card terminal total (IQD)**: a money field with the hint "The total on the terminal's end-of-day slip. Leave it blank if nobody paid by card." A 0 is a real reading.
- **Step 5 "Till shifts"** (warning only, never blocks the close). Status "{n} still open", "No shifts" or "All closed".
  - Hint when open: "Closing the day ends an open shift without a count. Ask its holder to end it at the till, or close it there with a manager's PIN."
  - Shift rows (read-only): name, station, time or "Since {time}", and the outcome ("Open", "Ended with the day, not counted", "Short by / Over by {amount}", "The drawer matches"). Below that, "Expected now" or "Expected in the drawer", "Counted", "Started with", and notes ("At handover: …", "Manager's PIN: {name}").
  - "Taken outside a shift" (lead "At a station while no shift was open there. The next handover at that station counts it."): per-station lines with "Cash taken", "Cash refunded" and "Card taken".
  - The cross-day line: "Refunds made on this day for earlier days' payments: {amount} in cash. The day's expected cash leaves them out." or "… They count in this day's expected cash.".
  - **Try again** (refresh icon) shows when the shift read (`app.till_shift_list`) fails and re-fetches it.
- **Step 6 "Close the day"**:
  - **Closing notes**: a free-text field, optional. Hint "Optional. Anything the owner should know about today's count."
  - **Close the day** (large, lock icon) opens a confirm dialog.
    - It is the danger style when ready. It is disabled with a single tooltip naming the blocking step: "Settle or void the open tabs first (step 1).", "Wait for this station to finish syncing (step 2)." or "Enter the counted cash first (step 3)."
    - It is also disabled without `closeDay`, in which case "Not allowed for your role" shows.
    - Unpaid bookings, unfinished checklists, open shifts, shop figures, online money and hold reviews never block it.

**Confirm dialog "Close business day {date}?" (useConfirm)**
- Body: "Counted cash: {IQD}. Card terminal: {IQD or "not entered"}. This cannot be undone, and the till cannot take orders until the next day is opened."
- **Cancel** closes the dialog and does nothing.
- **Close the day** (danger) sends a fresh heartbeat first (`app.heartbeat` with the current queue depth, best effort), then RPC `app.close_day(p_cash_counted_iqd, p_card_batch_iqd, p_notes, p_device_id)`.
  - Online only, no PIN.
  - Server-side it ends every open till shift uncounted and stamps the expected, counted and variance figures for cash and card. It writes the audit row `day.close`.
  - Errors appear under step 6: DAY_OPEN_TABS "Open tabs remain — settle or void them before closing the day."; DAY_UNSYNCED "A till still has queued offline writes — let it finish syncing."; NO_OPEN_DAY "No business day is open."; INVALID_COUNT "Invalid counted amount."; VENUE_MISMATCH; FORBIDDEN; offline "No connection…".

**Dialog "Dismiss a change the server refused"**
- Lead: "The server refused this change and trying again will not help. Dismissing it stops it holding up the day close. What it carried — an order, a payment — is NOT recorded, so check the tab at the till first." Then "{write kind} · {state}".
- **Manager PIN**: a password field, digits only, autofocused.
- **Cancel**.
- **Dismiss** (danger) is disabled until the PIN has 4 digits.
  - Online, it calls RPC `app.verify_manager_pin(p_pin, p_device_id)`. Offline, it falls back to the shell's cached PIN check.
  - It then calls the shell IPC `touch.resolveQueueRow`. The row is kept locally as resolved, with who and when.
  - Errors: PIN_INVALID "Incorrect PIN."; PIN_LOCKED "Too many wrong PINs — locked for a few minutes."; QUEUE_ROW_NOT_RESOLVABLE "This write cannot be dismissed: it is still travelling or has already synced."
  - X and Esc dismiss the dialog when not busy.

**After a successful close (left column)**
- Panel "Business day {date} is closed" with a "Day closed" badge and the lead "These are the final figures, worked out by the server." Read-only figures: "Cash expected", "Cash counted", "Difference" (Matches / Short by / Over by), "Card expected", "Card terminal".
- **Open the next day** (sun icon) clears the local count, batch and notes, and returns to the "Open the day" form. It makes no RPC. It is primary unless cash is still waiting to go to the safe.
- The **Hand cash to the safe** panel (closed mode) appears for that day. See below.

**Hand cash to the safe (HandInToSafe; closed mode after a close, pending mode beside "Open the day")**
- Title "Hand cash to the safe". The lead depends on the state:
  - "Each drawer's cash from this day goes to the safe. The opening float stays in the drawer."
  - "Business day {date} is closed, but its cash has not reached the safe yet." (pending mode)
  - "This day's cash is in the safe."
  - "What stayed in a drawer can be handed in later from the Safe page."
- Loading skeleton. On error: "The drawers could not be loaded." with **Try again**, which re-runs `app.main_cash_day_boxes`.
- "No cash to hand in for this day." when no box took cash.
- One row per box ("Café till", "Court desk", "Shop desk"), with "Took {amount} in cash", "Took {amount} in cash, less {refunds} refunded" or "No cash taken".
  - **{box}: cash to the safe**: a money field per open box. It starts at the box's net cash (never below 0). Blank means 0. At most 1,000,000,000.
    - The warning "More than this drawer took. The extra comes out of the float." shows when the amount exceeds the net.
  - A done row shows "Handed in {amount}" (check icon). A box left at 0 shows "Kept in the drawer".
- **Move {total} to the safe** (large, banknote icon; primary in closed mode) calls RPC `app.main_cash_hand_in_day(p_day_session_id, p_boxes [{box, amount_iqd}], p_idempotency_key)`.
  - Online only, no PIN, no confirm step.
  - It creates one safe ledger entry per box ("In from the café till … at day close") and raises the safe balance.
  - Toast: "Moved {amount} to the safe."
  - It is disabled with the tooltip "Every amount is 0, so there is nothing to move."
  - Errors: MAIN_CASH_HANDED_IN "This drawer was already handed in to the safe for that day. Take that entry back on the Safe page to redo it."; INVALID_ARGUMENT; REF_NOT_FOUND; FORBIDDEN.
- **Not now** (ghost) collapses the panel to "Not handed in. You can do it from the Safe page."
- **Open the Safe page** (↗) navigates to `/safe`. It shows on the collapsed panel and on a done panel where a box was kept.

**Day's record (right column; the first five panels show only before the close)**
- **"Played today, not paid"** (warning; shown only when there are rows or an error). Badge "{n} not paid". Lead "These bookings were played but their court fee was not taken. You can still close the day."
  - Each row: the guest name, "Open match · {label}" or "Guest without a name"; the time · court; the seats owing, "Seat {n} · {name} · {amount}"; and "Still owed {IQD}".
  - **Open booking** (↗) navigates to `/desk/bookings/{id}`.
  - Error: **Try again** re-runs `app.unpaid_played_bookings`. Auto-refresh every 60 s.
- **"Checklists not finished"** (warning; shown only when there are lists or an error). Badge "{n} open". Lead "Nobody ticked these lines on the day you are closing. You can still close it."
  - Each row (read-only): "{list} · {person or role}", an "Overdue" badge, "{done} of {total} done", and the first three unticked lines plus "+{n} more".
  - Error: **Try again** re-runs `app.checklist_day_state`.
- **"Touch Shop"** (read-only; hidden on a day with no shop activity). Lead "The shop's own money today and its drawer. It is part of the venue's close below."
  - Figures: "Shop sales" with Cash, Card and Other lines, "Refunds", "Net", and "Paid sales: {n}".
  - A refused banner "Unfinished shop sales: {n}" with "The day cannot close while a shop sale is unpaid. Take the payment at the shop desk first."
  - "Shop drawer": "{staff} · {station} · Open since {time}" or "Counted {counted}, expected {expected}"; or "No shop drawer was opened today."
  - An error line with no retry. Uses `app.day_close_shop`.
- **"Money outside the drawer"** (read-only; hidden when every figure is zero). Lead "Online payments and open-match figures for this day. For information only: none of it is part of the drawer count." Each row has a count and an amount. Groups:
  - "Online deposits, this branch": Received / Refunded / Kept for no-shows / Refunds waiting.
  - "Match tickets at this branch": Lost at this branch (revenue) / Cashed out here.
  - "Match tickets, all branches": Sold / Refunded / Refunds waiting / Unused, owed to players.
  - "Open-match bookings today": Bookings / Court price / Paid at the desk / Written off / Still owed / Called off / No-show seats.
  - "Lessons today": Paid online / Refunded online / Online refunds waiting / Kept for late cancels and no-shows / Paid at the desk / Refunded at the desk… / Lessons held and not paid / Refunds due at the desk / Owed to coaches….
  - "Test payments left out" (muted).
  - Error: **Try again** re-runs `app.day_close_online`.
- **"Suspended for letting court holds run out"** (hidden when empty). Badge "{n} to decide". The lead explains the 7-day app suspension. Each row shows the guest name, phone, a status badge ("Suspended until {time}", "Waiting until {time}", "Warned: a hold ran out recently" or "Banned from holding courts in the app") and "Holds run out lately: {n}".
  - **Lift**, or **Lift the ban** on a banned guest (undo icon), calls RPC `app.hold_standing_decide(p_standing_id, 'lift')`. Toast "Lifted. The guest can hold courts again." Only with `decideHoldStanding`; hidden when the status is clear.
  - **Ban for good** (ghost, ban icon) opens the confirm "Ban {name} from holding courts in the app?". Body: "They will not be able to hold a court in the app again, on this account or on any account that verifies the same phone number. A manager or the owner can lift the ban later from the customer record."
    - **Cancel**.
    - **Ban** (danger) calls `app.hold_standing_decide(…, 'ban')`. Toast "Guest banned from holding courts in the app." Hidden when already banned.
  - Errors: HOLD_STANDING_NOT_FOUND "This guest's record has changed or is gone. Refresh the list."; FORBIDDEN.
  - Error state: **Try again** re-runs `app.hold_reviews`.
- **"Discounts, voids, refunds and waste"** (lead "This business day so far. Each line opens those entries in the audit log."). Clickable rows with a chevron:
  - **Discounts and price overrides** ({n} recorded) navigates to `/admin/audit?q=discount.apply`.
  - **Voided lines** ({n} recorded) navigates to `/admin/audit?q=order_item.void`.
  - **Refunds** ({n} recorded) navigates to `/admin/audit?q=payment.refund`.
  - **Waste** navigates to `/admin/audit?q=stock.record_waste`.
  - "PINs entered by" lists names or "Nobody yet". Read-only.
- **"Each discount and price override"** (read-only table; lead "Every one needed a manager PIN."). Columns:
  - Time.
  - What: "{n}% off", "Amount off", "Price override" or "Adjustment", over "whole bill" or "one item".
  - Amount.
  - Reason: a reason label or "Promotion".
  - Who: the applier, plus "PIN: {name}" when someone else entered the PIN.
  - Empty: "No discounts or price overrides this business day."

---

## Wages — `/wages`
The owner's page for each person's monthly salary and pay day, what comes off it (approved deductions, lateness) and what is added (reward bonuses), advances, and marking each month paid.

*Who:* owner only (`ROUTE_ROLES['/wages'] = ['owner']`; capability `manageWages: ['owner']`). Every RPC here re-checks owner-at-branch server-side (`FORBIDDEN` otherwise). No PIN anywhere on the page. Every write is an online `appRpc` call (not queued); nothing works offline. Money about named people never reaches the owner assistant. *Source:* `apps/operator/src/features/wages/WagesPage.tsx`, `SetWageDialog.tsx`, `MarkPaidDialog.tsx`, `UndoPaidDialog.tsx`, `AdvanceDialog.tsx`, `PaidFromField.tsx`, `BonusList.tsx`, `DueWhenText.tsx`, `WagesDueCard.tsx`, `wagesLogic.ts`, `api.ts`; `features/deductions/DeductionDialogs.tsx` (DecideDialog), `features/deductions/ProposeDeduction.tsx`; `routes/wages.tsx`.

**Ways in**
- **Wages** (Financial rail row, banknote icon) — opens `/wages`. Shows a count pill = wages due now or overdue (`app.wages_due` count, same read as the page's Due now strip, refreshed every 60 s).
- **Open Wages** (ghost button on the **Wages due** card on the Management panel `/panel`) — navigates to `/wages`. The card lists up to 3 due wages (name, month, status badge, due-when text, still-owed amount) with **View more (n)** / **Show less**; hidden when nothing is due or on a read error.
- **Wages** link on the Safe page (`/safe`) — navigates to `/wages`.
- **Wages** (header link on Rewards) — navigates to `/wages`.

**Header**
- **Late and early** (ghost button, arrow icon) — navigates to `/attendance`.
- **All deductions** (ghost button, arrow icon) — navigates to `/deductions`.

**Due now panel** (shown only when `app.wages_due` count > 0; every unpaid month whose pay day is within the reminder window or past, earliest first, earlier months included)
- Lead line (read-only): "Wages whose pay day is within {days} days or has passed. Each stays here until you mark it paid."
- Each row shows (read-only): name, month, "Pay day {date}", due-when text ("N days overdue" red / "due today" amber / "due in N days" grey), the still-owed amount (server's `owed_iqd`, red when below zero) and, under it, "{amount} advanced" when an advance was given.
- **Mark paid** (primary, per row) — opens the **Mark paid dialog** for that person and month (works for months other than the one shown below; the dialog's figures follow each refetch).
- **View more (n)** / **Show less** — expands/collapses the list beyond the first 3 rows.

**Deductions to approve panel** (shown only when there are waiting proposals the owner may decide: first page of 50 from `app.deductions_page` filter `waiting`, rows with `canDecide`; refreshed every 60 s)
- Lead (read-only): "A head or a manager proposed these. Once approved, a deduction comes off that person's next unpaid wage."
- Each row shows (read-only): amount, person name, role, the reason, "Proposed by {name}".
- **Approve** (primary, per row) — opens the **Decide dialog** in approve mode.
- **Decline** (per row) — opens the **Decide dialog** in decline mode.
- **View more (n)** / **Show less** — expands/collapses beyond 3 rows.

**No salary yet panel** (shown only when someone active at the branch has no rate on record)
- Lead (read-only): "These people have no salary on record at this branch. Set one so their pay day reminds you."
- **Set salary** (per name) — opens the **Set salary dialog** for that person.
- **View more (n)** / **Show less** — expands/collapses beyond 3 names.

**Reminder control**
- **Remind me this many days before each pay day** (number box, digits only, clamped 0–14; hint "From 0 to 14. The Wages badge and the panel card count a wage from then until you mark it paid.") — edits the draft; disabled while saving.
- **Save** (primary, appears only once the value differs from the saved one; disabled until settings have loaded) — writes `wage_reminder_days` through `app.set_cafe_settings` (owner-level setting). Toast "Reminder saved."; the due list, badge and every month's statuses refetch. Errors: shown in a red line under the control (server message, e.g. "You do not have permission for that.", network "No connection. Check your internet and try again."); the cached settings roll back.

**Month stepper**
- **Previous month** (chevron button, aria "Previous month") — shows the month before (no lower bound; disabled only while the current month is unknown).
- Month heading (read-only; "Loading…" until known).
- **Next month** (chevron button, aria "Next month") — steps forward; disabled once the shown month is next month (the furthest month `mark_wage_paid` accepts).
- **This month** (ghost, appears only when not on the current month) — jumps back to the branch's current business month.

**Month totals** (read-only figures, all the server's sums): Salaries · Deductions · Lateness · Bonuses (only when the server sent a total) · Net · Advances and Still to pay (only when an advance was given this month) · Paid.

**Deduct from a wage (inline panel, opened by a row's Deduct)** — renders under the totals, above the table; owner's entry is recorded approved at once (`ownerRecordsAtOnce`).
- Title "Deduct from a wage"; lead "Recorded at once: it comes off their next unpaid wage. The person is told, and never who entered it."
- **Person** (dropdown, required; prefilled with the row's person; options from `app.deduction_targets`, "Name · Role"; placeholder "Choose a person" / "Loading…"; disabled when nobody is offered, hint "There is nobody you can propose a deduction for.") — Errors: "Fill this in."; server `FORBIDDEN` (staff_id) → "You cannot propose a deduction for this person. Choose someone from the list."; a load failure shows the read error under it.
- **Amount** (money box, required, digits only, keystrokes above 2,000,000 rejected; hint "1 IQD to 2,000,000 IQD.") — Error: "Enter an amount from {min} to {max}."; server `INVALID_AMOUNT` → "Invalid amount."
- **When it happened** (date picker, required; defaults to the business day; limited to the 60 days up to it; hint "Within the last 60 days.") — Error: "Pick a day within the last 60 days."
- **Reason** (text area, required, max 500; hint "The person reads this once the deduction is approved.") — Errors: "Fill this in.", "Keep it to 500 characters."; server `TEXT_REQUIRED`/`TEXT_TOO_LONG` → "That text is too long."
- **Cancel** (ghost) — closes the panel, nothing sent.
- **Deduct from wage** (primary, submit; Enter in a field submits) — `app.propose_deduction` with an idempotency key kept for a retry of the same values. Toast "Deduction recorded."; panel closes; wages and deductions refetch. Other errors in a red line (generic/network).

**Month table** (one row per person; 3 rows then **View more (n)** / **Show less**; the expanded row is highlighted)
- Columns (read-only): **Person** (name, role, "No longer at this branch" when they left) · **Salary** ("Not set", or "Not due: no work here this month" for a bonus-only month, or the amount; "From {month}" when the rate started that month; "{amount} from {month}" in blue for a scheduled next rate) · **Pay day** ("Day N", the due date, due-when text when due/overdue) · **Deductions** (amount, "N deductions", "N waiting" in amber) · **Lateness** (amount, "N days over the limit") · **Bonuses** (amount, "N bonuses", "N prizes to hand over") · **Net** (amount, red with "Below zero: nothing is paid and nothing carries over." when negative; "Advanced {amount}" and "Still owed {amount}" or amber "Advanced {amount} more than earned" when advances exist) · **Status** (badge: No salary / Not paid here / Upcoming / Due / Overdue / Paid; "Paid by {name}, {time}"; "From the safe" / "By bank transfer"; "Payment undone by {name}, {time}").
- **Mark paid** (primary, per row) — shown when status is Upcoming, Due or Overdue, or No salary / Not paid here with a reward bonus > 0. Opens the **Mark paid dialog**.
- **Give advance** (per row) — shown when status is Upcoming/Due/Overdue, not a bonus-only month, still owed > 0, and the month is last month, this month or next month. Opens the **Give advance dialog**.
- **Undo payment** (ghost, per row) — shown when the month's payment is Paid. Opens the **Undo payment dialog**.
- **Set salary** (per row) — shown while the person is still at the branch. Opens the **Set salary dialog**.
- **Deduct** (ghost, per row) — shown while the person is still at the branch. Opens the inline **Deduct from a wage** panel prefilled with that person (replaces any open one).
- **Details** / **Hide details** (ghost, chevron, per row) — toggles the **Person details panel** under the table for that row (one person at a time).
- Loading: table skeleton. Empty: "Nobody to pay at this branch" / "Everyone active at this branch except the owner shows here." (no button). Error: "This could not be loaded." + server message + "You may be offline. The last known data is shown where available." + **Try again** (refetches the month).

**Person details panel** (title "{name}, {month}")
- **Approved deductions** list (date, reason, amount) or "No approved deductions this month." — read-only.
- **Late and early days** list (date, "{late} min late, {early} min early · {n} min allowed", note, penalty amount) or "No late or early days this month." — read-only.
- **Rewards reached** list ("{month}: {orders}, {amount}", "… {prize} (hand over)", "… {amount} and {prize} (hand over)") or "No rewards are added to this month." — read-only.
- **Advances given** list (when, "From the safe"/"By bank transfer", note, "Given by {name}", amount) or "No advances this month."
  - **Undo** (ghost, per advance; shown only while the month is not paid) — opens the **Take back advance dialog**.

**Set salary dialog** (`app.set_staff_wage`; title "Set {name}'s salary"; X / Esc / backdrop close, blocked while saving)
- "Now {amount}, paid on day {day}." (shown when a rate exists; read-only).
- **Monthly salary** (money box, required; prefilled with the current salary; keystrokes above 100,000,000 rejected; hint "From 0 IQD to 100,000,000 IQD. 0 means this person is not paid at this branch.") — Errors: "Enter an amount from {min} to {max}."; server `INVALID_AMOUNT` → "Invalid amount."
- **Pay day** (dropdown "Day 1" … "Day 31", required; placeholder "Choose a day"; hint "In a shorter month, it is paid on the last day." for days 29–31) — Error: "Pick a day from 1 to 31." (also for server `INVALID_ARGUMENT` pay_day).
- **Starting** (dropdown: "The next pay day" (default, server picks) or this month and the 3 months after it; hint "A month already paid keeps the salary it was paid at.") — Error: server `INVALID_ARGUMENT` month → "Pick a month after the last one paid, within a year from now."
- **Cancel** — closes without saving.
- **Save salary** (primary) — validates, then saves. Toast "Salary saved."; dialog closes; wages and deductions refetch. Errors: `FORBIDDEN` (staff_id) → "This person is no longer active at this branch."; other refusals in a red line. Editing any field clears a server error.

**Mark paid dialog** (`app.mark_wage_paid`; title "Mark {name}'s wage paid?", subtitle "{month}, pay day {date}")
- Breakdown (read-only): Salary (· "Not due: no work here this month") · Deductions (· "N deductions") · Lateness (· "N days over the limit") · Bonuses (· "N bonuses") · **Net** (red when below zero) · Advances already given (· "N advances", shown as minus, only when advances exist) · **Amount to pay** / **To pay now**.
- **Rewards in this wage** list (only when the month carries rewards; prizes marked "(hand over)").
- Notices (read-only): below zero "Deductions and lateness come to more than the salary and bonuses. Nothing is paid, and nothing carries over to next month."; covered "The advances already covered this month. Marking it paid closes the month."; over-advanced "More was advanced than this month comes to. Nothing more is paid, and nothing carries over."; waiting "{N deductions} still waiting: approve or decline them first, or they will count next month."; always "Once paid, the month is closed: …".
- **Paid from** (segmented control **Safe** (default) / **Bank transfer**; only when the amount to pay > 0; hint "The money comes out of the safe." / "Nothing comes out of the safe.") — chooses where the money comes from.
- **Cancel** — closes without paying.
- **Mark paid** (primary, check icon) — sends the net and amount it showed (`p_expected_net_iqd`, `p_expected_paid_iqd`), paid-from and one idempotency key per dialog (a retry never pays twice). Records the payment, freezes the month, and from the Safe takes the amount out of the main cash (Bank records it and moves nothing). Toast "Paid {amount} from the safe." / "Paid {amount} by bank transfer." / "Wage marked paid." (nothing to hand over); dialog closes; wages, deductions and the Safe refetch. Errors (red line, dialog stays): `WAGE_CHANGED` "This wage changed while you were looking at it. Check the new figures and confirm again." (figures refresh behind it; confirm again); `WAGE_ALREADY_PAID` "That month's wage is already marked paid, so it can no longer change. Undo the payment first if it was a mistake." (Mark paid is then disabled); `WAGE_NOT_SET` "This person has no salary for that month. Set their salary first."; `INVALID_ARGUMENT` (month/paid_from), `FORBIDDEN`.

**Undo payment dialog** (`app.undo_wage_paid`; title "Undo this payment?")
- Body (read-only): "{name}'s wage for {month}, {amount}. The month opens again and adds up afresh." + "The {amount} goes back into the safe." when it was paid from the safe.
- **Reason** (text area, required, max 1000; hint "Kept with the payment.") — Errors: "A reason is required.", "That text is too long."
- **Keep it** — closes, nothing changes.
- **Undo payment** (red, set apart) — reopens the month; a safe payment goes back into the safe. Toast "Payment undone."; wages, deductions (and the Safe when from the safe) refetch. Errors: `REF_NOT_FOUND` "The referenced record no longer exists.", `INVALID_TRANSITION` "That status change is not allowed.", `REASON_REQUIRED`, `TEXT_TOO_LONG`, `FORBIDDEN` (stale ones refresh the page behind the message).

**Give advance dialog** (`app.give_wage_advance`; title "Give {name} an advance", subtitle the month; the amount box takes focus)
- **Amount** (money box, required; hint "Up to {owed} still owed this month"; follows a refetch while open) — Errors: "Enter an amount.", "Enter an amount above 0.", "At most {amount}: that is what is still owed this month."
- **Paid from** (segmented **Safe** (default) / **Bank transfer**, with the same hints as above).
- **Note** (text box, optional, max 300; Enter submits) — Error: "Keep it to 300 characters."
- **Cancel** — closes.
- **Give {amount}** / **Give advance** (primary; label shows the typed amount) — one idempotency key per dialog. Records the advance (from the safe it leaves the main cash). Toast "Advance given. {name} is still owed {amount}."; wages and Safe refetch. Errors: `WAGE_ADVANCE_TOO_LARGE` → "That is more than {name} is still owed this month. The most you can give now is {amount}." (page refetches); `WAGE_ALREADY_PAID`, `WAGE_NOT_SET`, `INVALID_ARGUMENT` "Invalid input — check the values and try again.", `TEXT_TOO_LONG`, `FORBIDDEN`.

**Take back advance dialog** (`app.undo_wage_advance`; title "Take back this advance?")
- Body (read-only): "{amount} given to {name} on {date}. It no longer comes off the wage." + "The money goes back into the safe." for a safe advance.
- **Reason** (text area, required, max 1000; hint "Kept with the advance.") — Errors: "A reason is required.", "That text is too long."
- **Keep it** — closes.
- **Take back advance** (red) — Toast "Advance taken back."; wages and Safe refetch. Errors: `WAGE_ALREADY_PAID` (month paid meanwhile), `REF_NOT_FOUND`, `INVALID_TRANSITION`, `REASON_REQUIRED`, `TEXT_TOO_LONG`, `FORBIDDEN`.

**Decide dialog** (shared with `/deductions`; `app.decide_deduction`)
- Title "Approve this deduction?" / "Decline this deduction?"; body "{amount} off {name}'s pay. It comes off their next unpaid wage, and {name} is told." / "… {name} never sees a declined deduction."; the proposal's reason quoted (read-only).
- **Note** (approve, optional) / **Reason** (decline, required) — text area max 1000, hint "The person who proposed it reads this." Errors: "A reason is required.", "That text is too long."
- **Cancel** — closes.
- **Approve deduction** (primary) / **Decline deduction** (red) — Toast "Deduction approved." / "Deduction declined."; deductions and wages refetch. Errors: `SUBMISSION_DECIDED` "This was already decided or withdrawn. Refresh to see the latest." / `REF_NOT_FOUND` / `INVALID_TRANSITION` (list refetches); `CANNOT_DECIDE_OWN` "You cannot decide something you sent or that is about you."; `REASON_REQUIRED`; `TEXT_TOO_LONG`.

**Every dialog:** X (aria "Close"), Esc and a backdrop click close it; all three are blocked while its write is in flight.

---

## Late and early (Attendance) — `/attendance`
Where late arrivals and early leaves are recorded per person and day, under the branch's rule that turns a day over the limit into a wage penalty.

*Who:* manager and owner (`ROUTE_ROLES['/attendance'] = ['manager','owner']`). The owner reaches it from **Wages ▸ Late and early** (a hidden Financial row, so the Financial rail stays lit); a manager has a **Late and early** row in their own rail's **Run the day** group. A manager never sees or records a day about themselves; nobody records for an owner (server). No PIN; every write online `appRpc`. *Source:* `apps/operator/src/features/attendance/AttendancePage.tsx`, `attendanceLogic.ts`, `api.ts`; `routes/attendance.tsx`.

**Header**
- **Record a day** (primary, plus icon; hidden while the form is open) — opens the **Record form** empty (person blank, day = business today, 0 / 0 minutes).

**The rule panel**
- Summary line (read-only): "A day costs {amount} when late and early minutes together are more than {minutes}." or "No penalty: the rule is off."
- **Minutes allowed** (number box, clamped 0–720; hint "Late and early minutes together, from 0 to 720.") — disabled until settings load / while saving.
- **Cost of a day over the limit** (money box, keystrokes above 2,000,000 rejected; hint "0 turns the rule off.").
- Notes (read-only): "Days already recorded keep the rule they were recorded under." · "The owner sees these on the Wages page."
- **Save rule** (primary; appears only when either value changed; Enter in a field submits) — writes `attendance_grace_minutes` and `attendance_penalty_iqd` together via `app.set_cafe_settings` (manager-level settings). Toast "Rule saved."; the month and the live verdict refetch. Validation: "Enter 0 to 720 minutes and a cost from 0 to 2,000,000 IQD." (e.g. cost left empty). Server errors in a red line; cached settings roll back.

**Record form** (inline panel; title "Record a late or early day" or, from Edit, "Change a recorded day")
- **Person** (dropdown, required; "Name · Role" from the month's `staff` list; placeholder "Choose a person"; locked when editing; hint "There is nobody you can record a day for." when the list is empty) — Errors: "Fill this in."; server `FORBIDDEN` (staff_id) → "You cannot record a day for this person. Choose someone from the list."
- **Day** (date picker, required; the 60 days up to the business day; locked when editing; hint "Within the last 60 days.") — Error: "Pick a day within the last 60 days."
- **Minutes late** (number box 0–720) and **Minutes left early** (number box 0–720) — Errors: "Enter 0 to 720 minutes."; both 0 → "Enter minutes late, minutes left early, or both."
- Live verdict (read-only, recomputed as you type, from the month's rule): "Over the limit: costs {amount}" (red) / "Within the limit" / "No penalty: the rule is off".
- **Note** (text area, optional, max 300) — Error: "Keep it to 300 characters."
- Replace warning (read-only, new entries only): "This replaces the {date} already recorded for {name}." when that person already has that day in the loaded month.
- **Cancel** (ghost) — closes the form.
- **Save day** (primary, submit) — `app.record_attendance` (recording a day already recorded replaces it). Toast "Day recorded."; form closes; attendance and wages refetch. Errors: field-level as above (`INVALID_ARGUMENT` date / late_minutes / early_leave_minutes / minutes, `TEXT_TOO_LONG` note); otherwise a red line, e.g. `WAGE_ALREADY_PAID` "That month's wage is already marked paid, so it can no longer change…", `FORBIDDEN` "You do not have permission for that." Editing a field clears a server error.

**Month stepper**
- **Previous month** (chevron, aria "Previous month") — no lower bound.
- Month heading (read-only).
- **Next month** (chevron, aria "Next month") — disabled on the current month (no day is recorded ahead).
- **This month** (ghost, only when not on the current month) — jumps back.

**Month figures** (read-only): Days recorded · Days over the limit · Comes off wages.

**People list** (one panel per person with days this month; 3 people then **View more (n)** / **Show less**)
- Panel title: name, role; the person's month penalty total on the right (read-only).
- Day rows (3 then **View more (n)** / **Show less** per person): **Day** (date, note, "Recorded by {name}") · **Late** ("{n} min" or —) · **Left early** · **Costs** (amount or "No penalty"; amber "Comes off {month}'s wage" when the day's own month was already paid).
- **Edit** (ghost, per unlocked day; disabled while a clear runs) — opens the Record form in edit mode with that day's values (person and day locked); replaces any open form.
- **Clear** (ghost, trash, per unlocked day; disabled while a clear runs) — opens the **Clear confirm**.
- **Wage paid** (lock badge on a locked day, in place of Edit/Clear) — hover shows "This month's wage is paid, so this day can no longer change."
- Loading: skeleton. Empty: "No late or early days in {month}" / "Record a day above when someone arrives late or leaves early." (no button). Error: server message + **Try again** (refetches).

**Clear confirm** (danger confirm dialog; Cancel focused; Esc / backdrop cancel)
- Title "Clear this day?"; body "{name}, {date}. It leaves their wage."
- **Keep it** — closes, nothing changes.
- **Clear day** (red) — `app.clear_attendance`. Toast "Day cleared."; attendance and wages refetch. Errors (red line above the list): `WAGE_ALREADY_PAID` or `REF_NOT_FOUND` "The referenced record no longer exists." (both refresh the page), `FORBIDDEN`.

---

## Rewards — `/rewards`
The owner's standing rewards per person (a bonus, a prize, or both for reaching a number of orders placed in a business month), with each person's count this month and last.

*Who:* owner only (`ROUTE_ROLES['/rewards'] = ['owner']`; `app.staff_rewards_board`, `set_staff_reward`, `end_staff_reward` are owner-only). Lists waiters, cashiers and managers at the branch by name. No PIN; online `appRpc` only. *Source:* `apps/operator/src/features/rewards/RewardsPage.tsx`, `rewardsLogic.ts`, `api.ts`; `routes/rewards.tsx`.

**Header**
- **Wages** (ghost button, arrow icon) — navigates to `/wages`.

**Month line** (read-only): the business month ("Rewards" on a read error, "Loading…" before) and "{n} days left" / "last day". The board refetches every 60 s.

**People table** (3 people then **View more (n)** / **Show less**; the person whose form is open is highlighted)
- Columns (read-only): **Person** (name, role) · **This month** ("N orders", voided excluded) · **Last month** ("N orders") · **Rewards** ("No rewards set." or, per reward lowest target first: "At {N orders}", the bonus amount, the prize, then a green **Reached** badge or "{N orders} to go").
- **Remove** (ghost, trash, per reward; aria "Remove the reward at {orders} for {name}"; spins while that removal runs) — opens the **Remove confirm**.
- **Add reward** (plus, per person; shown while they have fewer than 5 rewards) — opens the **Add reward form** for that person above the table (replaces any open form). At 5 rewards the cell reads "Up to 5 rewards each: remove one to add another." instead.
- Loading: skeleton. Empty: "Nobody to reward at this branch" / "Waiters, cashiers and managers active at this branch show here." Error: "This could not be loaded." + message + offline hint + **Try again**.

**Add reward form** (inline panel "Add a reward for {name}")
- **Orders in a month** (text box, required, digits only, at most 6 digits; hint "From 1 to 100,000.") — Error: "Enter a number of orders from 1 to 100,000." (also server `REWARD_INVALID` target).
- **Bonus** (money box, optional; keystrokes above 10,000,000 rejected; hint "Up to 10,000,000. Leave it empty for a prize only.") — Error: "Enter a bonus up to 10,000,000."
- **Prize** (text box, optional, max 80; hint "Up to 80 characters, for example dinner for two.") — Error: "Keep it to 80 characters."
- Neither bonus nor prize → "Enter a bonus, a prize, or both." (also server `REWARD_INVALID` empty).
- **Cancel** (ghost) — closes the form.
- **Save reward** (primary, submit) — `app.set_staff_reward` (branch from the rail's scope). Toast "Reward saved."; form closes; board refetches. Errors (red line; the board refetches): `REWARD_TARGET_TAKEN` "This person already has a reward at that target."; `REWARD_LIMIT` "A person can have up to 5 rewards."; `REWARD_STAFF_INVALID` "Rewards are for waiters, cashiers and managers at this branch."; `FORBIDDEN`. Editing a field clears a server error. If the person drops off the board after a refetch, the form closes.

**Remove confirm** (danger confirm dialog)
- Title "Remove this reward?"; body "{name} will no longer see the reward at {orders}. This month still counts: if they reach it by the end of the month, it is still earned."
- **Keep it** — closes.
- **Remove reward** (red) — `app.end_staff_reward`. Toast "Reward removed."; board refetches. Errors (red line above the table): `REF_NOT_FOUND` (board refetches), `FORBIDDEN`.

---

## Coach pay — `/reports/coaches`
Each coach's monthly pay statement at each branch. A manager or owner reviews a statement, recounts it, approves it, marks it paid with a reference and a manager PIN, voids it or redrafts it. A panel above shows what coaches have earned so far this month.

*Who:*
- Route: manager and owner (it inherits `/reports`, guarded by `guarded('/reports', …)`). A manager the owner blocked from "reports" sees "The owner has closed this page for you…". Anyone else sees "Not allowed for your role…" and **Go to my home screen**.
- In-screen gate `settleCoaches` (manager, owner) for Recount, Approve, Void, Redraft and Mark paid.
- Per statement, the server's `can` flags from `app.coach_statement_detail` (refresh / approve / void / mark_paid). All four are false on the signed-in person's own statement (CM-11).
- Only rows of the rail branch open. Under "All branches" the other branches' rows are read-only (R21).
- Every statement write is online-only: a direct `appRpc`, never queued, and disabled when the station's heartbeat failed.

*Source:* `features/reports/coaches/CoachStatements.tsx`, `CoachesThisMonth.tsx`, `StatementDialog.tsx`, `MarkPaidDialog.tsx`, `VoidStatementDialog.tsx`, `statementsLogic.ts`, `statementKeys.ts`, `liveLogic.ts`, `features/coaching/useCoaching.ts`, `LessonReadNotice.tsx`, `lessonLogic.ts` (coachingErrorText), `components/kit.tsx` (PinPromptOverlay), DB `20261001000287_coach_statements.sql`, `…0293_coach_statements_fixes.sql`, `…0344_wage_advances.sql`.

*Header:* the title "Coach pay" and the lead "Each coach's monthly statement: what was collected for their lessons, less the court share, and their share of the rest. The money is handed over outside the till." This page has no report tab strip and no Export button.

**Branch scope** works as on Reports (owner, multi-branch: rail branch / All branches / closed branches). It re-reads the statements list.

**Coaches · {month} so far** (panel; the same `app.report_coach_statements` read for the current month, its `live` rows; every 60 s)
*Hidden when:* the month is not known yet, the read failed, or the server has no RPC.

*Read-only content:*
- The lead "What each coach has earned from lessons already taught this month…".
- A band: Coaches earn ("Last month: {amount}"), Court keeps, Lessons taught ("Private n · Group n · Course n"), and Average per lesson ("Coaches: {n}").
- The line "Most: {coach}, {percent}% of coach pay".
- The table Coach (with the branch line under All branches), Lessons, Collected, Court share, Earns so far, Share (a bar with %) and Statement ("Not drafted yet", or a Draft / Approved / Paid / Void badge).
- Empty: "No lessons taught yet this month."

There are no row clicks and no sorting here.

**Month stepper**
- **Previous month** (‹ icon button) moves one month back by setting `?month=YYYY-MM-01` (replace navigation, so a reload keeps it). It is disabled until a month is known. There is no lower bound.
- **Next month** (› icon button) moves one month forward. It is disabled on the default month, the latest month statements are drafted for (the month before the current one). Stepping onto that month drops `?month`.
- **Latest month** (ghost button) shows only when you are on an older month and returns to the default month.
- *Heading:* the month's name, for example "September 2026".

**Read states**
- With the server missing the RPC: "Coaching needs a server update that isn't there yet." (no button).
- When the first read fails: "Lessons can't be shown without a connection" with **Try again**, which re-reads `app.report_coach_statements`.
- When the shown data is stale (offline, or a re-read failed): the muted line "Last updated {time}".

**The month in figures** (read-only band): Collected, Court share, Coach's share, Adjustments (signed), To pay, "Approved, not paid", and Paid.

**Statements table** (the rail branch)
*Columns:* Coach, [Branch: only under All branches], Lessons, Collected, Court share, Coach's share, Adjustments, To pay and Status. The status badge is Draft (neutral), Approved (blue), Paid (green) or Void (dimmed). *Order:* drafts first, then approved, paid and void, then by coach name. Not sortable, no cap.
- **Row click** (or Enter/Space on a focused row) opens the **Statement dialog**.
- *Empty state:* "Statements are drafted on the 1st for the month before." on the latest month, or "No statements for {month}." on an older one. Neither has a button.

**Other branches table** (only under All branches)
*Same columns.* Each coach cell carries "Switch to {branch} to approve or pay." Rows do not click.

**Not drafted** (muted lines under the tables, read-only): "{coach}: not drafted yet", "{coach}: waits for an older month's draft" or "{coach}: waits for the {month} draft".

**Statement dialog** (`app.coach_statement_detail`, re-read on every open)
*Title:* "{coach} · {month}" plus the status badge.

*Read-only content:*
- Figures: Lessons, Collected, Court share, Coach's share, Adjustments, To pay.
- History lines: "Approved {date} by {name}", "Paid {date} by {name} · Ref {reference}" and "Voided {date}: {reason}". Dates are in the branch's timezone.
- Messages:
  - "This is your own statement. Another manager or the owner approves and pays it." (own statement: no buttons)
  - "Lessons changed since this draft was counted. Recount to include them." (a stale draft)
  - "This statement is below zero ({amount}). Void it; the next statement carries it." (a negative approved statement)
- Loading shows a skeleton.
- A failed read shows "Lessons can't be shown without a connection" with **Try again**.
- When the statement is gone, the dialog says "This statement can't be shown. It may have been redrafted."

*Controls:*
- **Lessons on this statement** table, with the columns Date, Lesson (an "Adjustment" badge marks adjustment lines), Sign-ups, Attended, No-shows, Collected, Court share, Share and To the coach.
  - **Row click** (or Enter/Space on a focused row) leaves Coach pay for the desk lesson screen, `/desk/lessons/$id`. It only works when the line has a lesson.
  - **Hover the Adjustment badge** for the tooltip "This lesson was on an approved statement; its money changed since."
  - With no lines it shows "No lessons on this statement."
- **Booked by the coach, the student didn't come** list: each **{date} · {student or Walk-in}** button (↗) navigates to `/desk/lessons/$id`.
- **X**, Esc and the backdrop close the dialog, but not while an action is running.
- *Footer actions:* which ones show depends on the status, `settleCoaches`, the server's `can` flags and the rail branch. Every action is disabled offline, with the reason "Needs a connection: lessons work online only". Refusals show inside the dialog as the coaching line for the error.
  - **Recount** (draft only; refresh icon). Hover tooltip: "Recounts from the lessons collected so far." It calls RPC `app.coach_statement_refresh(p_statement_id)`, which rebuilds the draft in place from today's figures. There is no confirm and no PIN. On success the toast reads "Recounted." Errors:
    - "This statement isn't a draft any more." (STATEMENT_NOT_DRAFT)
    - "This belongs to another branch. Switch to that branch to do this." (VENUE_MISMATCH)
    - "This is your own statement…" (FORBIDDEN own_statement)
    - "You do not have permission for that."
  - **Approve** (draft only; primary, check icon) opens a confirm:
    - Title "Approve {coach}'s statement for {month}?", body "It can't change after this, except by voiding it."
    - **Cancel** closes the confirm (as do Esc and the backdrop, except while busy).
    - **Approve** calls RPC `app.coach_statement_approve(p_statement_id)`, with no PIN. The statement becomes approved, its lines freeze, an audit row (`coach.statement_approved`) is written and the coach gets a "statement ready" push. The next complete month's draft is then built if possible. On success the toast reads "Statement approved." Errors (the confirm closes and the error shows in the dialog): STATEMENT_NOT_DRAFT "This statement isn't a draft any more.", VENUE_MISMATCH and own statement.
  - **Void** (draft, no PIN; approved, with PIN; ghost button, ban icon) opens the **Void statement** dialog below.
  - **Mark paid** (approved only; primary, banknote icon) opens the **Mark paid** dialog below. When To pay is below zero the button stays visible but disabled, with the reason "This statement is below zero ({amount}). Void it; the next statement carries it."
  - **Redraft** (void only; repeat icon). Hover tooltip: "Drafts this month again from its lessons." It calls RPC `app.coach_statement_refresh(p_statement_id)`.
    - If a new draft is created, the dialog switches to it and the toast reads "Drafted again."
    - If nothing was created, the info toast reads "Nothing to draft: this month's lessons were settled on a later statement."
    - Errors: "This coach already has a draft for that month. Open it instead." (STATEMENT_NOT_DRAFT live_draft), "This statement isn't a draft any more." (an approved or paid statement exists for the month), VENUE_MISMATCH and own statement.
  - **Paid** statements have no actions.
  - **No actions** are shown, with no explanation, for a role without `settleCoaches`. Another branch's statement cannot be opened at all.

**Mark paid dialog** (sub-dialog of the statement)
*Title* "Mark paid", subtitle "{amount} to {coach}", body "Records that the money was handed over. Nothing is taken from the drawer."
- **Payment reference** (text, required, hint "Receipt or transfer number, or a note on how it was paid. Never a card or account number."; autofocus). Enter does the same as Continue. Its checks run when Continue is pressed:
  - empty: "Enter the payment reference."
  - over 80 characters: "At most 80 characters." (the input stops at 100)
  - 12 or more digits in a run, across spaces, hyphens or dots: "A card or account number can't go here. Use a receipt or transfer number."
- **Paid from** segmented control: **Safe** (the default; hint "The money comes out of the safe.") or **Bank transfer** (hint "Nothing comes out of the safe.").
- **Cancel** closes the dialog (disabled while sending). X, Esc and the backdrop also close it, except while busy.
- **Continue** (primary, lock icon) validates the reference, then opens the PIN prompt. It is disabled offline, with the reason "Needs a connection: lessons work online only".
- **PIN prompt "Manager authorisation"** reads "Enter a manager PIN to mark {amount} paid to {coach}."
  - **PIN** field: password, digits only, 4 to 6 digits; Enter submits once 4 digits are typed.
  - **Cancel** returns to the form.
  - **Authorise** is disabled below 4 digits. It calls `app.verify_manager_pin` first, then RPC `app.coach_statement_mark_paid(p_statement_id, p_reference, p_pin, p_device_id, p_paid_from)`. The statement becomes paid with the reference. A main-cash entry is recorded: from Safe it takes the amount out of the safe; from Bank it is logged with no change to the safe. An audit row `coach.statement_paid` is written and the coach gets a push. No till money moves. On success the toast reads "Marked paid." An already-paid statement answers as a duplicate and is treated as success.
  - PIN refusals stay on the prompt and clear the PIN: "Incorrect PIN.", "Too many wrong PINs — locked for a few minutes." and "Manager authorisation expired — enter the PIN again."
  - Any other refusal closes the prompt and shows on the form:
    - "That PIN belongs to this statement's coach. Another manager or the owner enters theirs."
    - "Enter the payment reference."
    - the card-number line
    - "The statement has to be approved before it is marked paid." or the below-zero line
    - VENUE_MISMATCH
    - own statement

**Void statement dialog** (sub-dialog of the statement)
*Title* "Void statement", subtitle "{amount} to {coach}", body "A voided statement is redrafted from the lessons next time statements are drafted." An approved statement also shows "Cash may already have been handed over for an approved statement. Voiding it needs a manager PIN, and the next statement counts these lessons again."
- **Reason** (textarea, required, autofocus). Its checks run when Void statement is pressed:
  - empty: "Enter a reason."
  - over 200 characters: "At most 200 characters." (the input stops at 220)
  - a card or account number: the card-number line
- **Cancel** closes the dialog (disabled while sending). X, Esc and the backdrop also close it, except while busy.
- **Void statement** (danger button; ban icon for a draft, lock icon for an approved statement) is disabled offline, with the reason "Needs a connection: lessons work online only".
  - **Draft:** it sends RPC `app.coach_statement_void(p_statement_id, p_reason)` at once, with no PIN.
  - **Approved:** it opens the PIN prompt "Enter a manager PIN to void {coach}'s approved statement." (**PIN** / **Cancel** / **Authorise**, as above). It then calls `verify_manager_pin` and `app.coach_statement_void(p_statement_id, p_reason, p_pin, p_device_id)`.
  - If a draft was approved by someone else meanwhile, the server answers PIN_GRANT_REQUIRED. The statement is re-read and the PIN prompt opens with the typed reason kept.
  - Effect: the statement becomes void with the reason and an audit row `coach.statement_voided` is written. The next drafting carries its lessons as adjustments. An already-void statement answers as a duplicate and is treated as success. On success the toast reads "Statement voided."
  - PIN refusals stay on the prompt: "Incorrect PIN.", the locked line and the expired line.
  - Other refusals show on the form and re-read the statement:
    - "A paid statement can't be voided." (INVALID_TRANSITION paid)
    - "A reason is required."
    - the card-number line
    - "That PIN belongs to this statement's coach…"
    - VENUE_MISMATCH
    - own statement

---

## Rates — `/admin/rates`
The court rate card: rules by court, weekday, time window and priority, each pricing one or more booking durations.

*Who:* manager and owner can open it (`/admin` prefix → `['manager','owner']`). Owner: Financial rail row **Rates**. Manager: **Rates** row in their own rail's **Setup** group; also reached from Branches setup (`courts_and_rates` link). Only the owner saves (`can.editRates`: owner; `app.upsert_rate_rule` refuses a manager with `PRICE_VIA_PROTOCOL`). A manager who may start a price change and open `/protocols` (`startProtocolPriceChange`) proposes instead; one blocked from `/protocols` gets a disabled **New rule** with the "Not allowed for your role" notice. No PIN; online. *Source:* `apps/operator/src/features/admin/RateRuleEditor.tsx`, `rateRuleLogic.ts`, `promotions/PriceChangeStart.tsx`, `promotions/priceChange.ts`; `routes/admin/rates.tsx`.

**Header** (title "Court rates"; lead "What a court booking costs, by day and time. A change applies to new bookings only; past bookings keep the price they were made at.")
- **New rule** (owner; primary, plus) — opens an empty **Rule form** beside the table (all courts, every day, 09:00–23:00, priority 0, active).
- **Propose a new rate** (manager; primary, plus, arrow) — navigates to `/protocols` with `start=price_promo&change=rate` (a price or promo change).
- Manager note (read-only, lock icon): "The owner approves court rates. Propose a new rate or a change here and follow it in Protocols."
- Fallback (a manager who cannot reach Protocols): **New rule** disabled + "Not allowed for your role: New rule needs the Owner role. The control stays here so you can see what is available; ask someone with that role to do it."

**Rules that tie panel** (shown only when two rules tie: same time, same courts, same priority)
- Title: count + "Rules that tie"; lead "Each pair covers the same time on the same courts with the same priority, so nothing decides which price a booking gets. Open one of them and change its priority so it wins."
- **{rule name}** links (both rules of each pair) — open that rule's form.
- "first on {day}" (read-only).
- **Show all {count} pairs** / **Show fewer** — when more than 5 pairs.

**Rules table** (active rules only by default; ordered by priority, highest first)
- Columns (read-only): **Rule** (name, grey **Off** badge for switched-off, amber **Ties** badge) · **Court** ("All courts" or the court) · **Days** ("Every day", or runs like "Sun–Thu") · **Time** ("09:00–23:00") · **Prices** ("{minutes} min · {price}" per duration) · **Priority**.
- **Row click** (or Enter/Space on a focused row) — opens that rule's **Rule form** (editable for the owner, read-only for a manager); the row is highlighted.
- "When rules cover the same time, a rule for one court beats an all-courts rule, then the higher priority wins." (read-only).
- **Show switched-off rules ({count})** / **Hide switched-off rules** (ghost; only when some rules are off) — toggles them into the table.
- Loading: skeleton. Empty: "No rate rules yet." / "Without a rule no slot can be priced. Add one covering every court, every day, all opening hours first, then add peak rules on top." with the header's button as its call to action (**New rule** or **Propose a new rate**). Error: "This could not be loaded." + message + offline hint + **Try again**.

**Rule form** (side panel "New rule" / "Edit rule"; **Off** badge on a switched-off rule)
- Tie warnings (read-only, one per tie): "Ties with {name} ({day}). Change the priority so one of them wins."
- **Rule name** (text, required).
- **Court** (dropdown: "All courts" + each active court).
- **Days of week** (seven toggle buttons **Sun** **Mon** **Tue** **Wed** **Thu** **Fri** **Sat**; pressed = included).
- **Start** / **End** (time pickers).
- **Priority** (number; hint "Higher wins when this rule and another cover the same time on the same court."; non-numbers become 0).
- **Valid from** / **Valid to** (date pickers; hint "Blank means open-ended.").
- **Prices per duration** (hint "Whole IQD per duration. Leave a duration blank to not price it under this rule."): one money box per duration, **"{minutes} min price (IQD)"** for 60, 90, 120 and every duration any court offers; blank or 0 = not priced.
- **Active** (switch) — switching off keeps the rule for history but prices nothing.
- Owner footer: note "Saving changes the price of new bookings only. Past bookings keep their price." · **Cancel** (closes) · **Save** (primary) — disabled with a hover reason until filled: "Fill in both names first." (no name), "Choose at least one weekday.", "Enter a price for at least one duration." Save calls `app.upsert_rate_rule` (creates or updates; replaces the rule's prices wholesale). Toast "Rule saved."; form closes; rules refetch. Errors (red line in the form): `INVALID_TIME_RANGE` "Start must be before end. Split a rule that runs past midnight into two."; `INVALID_DAYS` "Pick at least one day of the week."; `INVALID_PRICES` "Prices must be whole IQD amounts per duration."; `INVALID_DURATION` "That duration is not offered on this court."; `COURT_NOT_FOUND` "Court not found."; `RULE_NOT_FOUND` "That rate rule no longer exists. Refresh the page."; `PRICE_VIA_PROTOCOL`; `FORBIDDEN`.
- Manager footer (an existing rule; every field disabled): **Close** · **Change this rate** (primary, arrow) — navigates to `/protocols` with `start=price_promo&change=rate&rule=<id>`.

---

## Menu prices (rail row) + Menu tab strip — `/admin/menu` · `/admin/categories` · `/admin/addons` · `/admin/suggested`
These are the ways into the café menu editor and its three sibling tabs, plus the rules that apply on all four tabs.
*Who:* owner and manager. None of the four routes has its own `ROUTE_ROLES` key, so each resolves to `/admin` = `['manager','owner']`. A manager whose owner unticked the "admin" area (0345 blocked pages) is kept out. Inside the screens, `can.editMenu` (= manager or owner) gates the write controls, so both roles get them. What differs between owner and manager comes from `editLaunchedPrices` (owner only here), `launchDirectly` (owner only here), `startProtocolRelease` (manager + owner) and `startProtocolPriceChange` + access to `/protocols` (manager + owner). *Source:* `lib/workspaces.ts` (OWNER_FINANCIAL, MANAGER_SETUP, MENU_FAMILY), `routes/admin.tsx`, `routes/admin/{menu,categories,addons,suggested}.tsx`, `routes/__root.tsx` RequireRole, `lib/auth.tsx`.

**Rail**
- **Menu prices**: owner's Management › Financial rail row (Financial overview card copy: "Cafe prices. A change here moves tomorrow’s cafe revenue, not today’s."). Navigates to `/admin/menu`. The row stays lit on `/admin/categories`, `/admin/addons` and `/admin/suggested` too (`alsoActive`).
- **Menu**: the manager's Setup-section row (manager workspace). Same destination, same lit rule.

**Tab strip** (nav labelled "Admin"; shown when at least 2 tabs are visible, which is always the case for manager and owner)
- **Menu items** → `/admin/menu`
- **Categories** → `/admin/categories`
- **Add-ons** → `/admin/addons`
- **Suggested items** → `/admin/suggested`

**Route refusal** (anyone else who reaches the URL)
- Card saying "Not allowed for your role: Opening this screen needs the manager role. …", or for a blocked manager "The owner has closed this page for you. Ask them if you need it." It also has a **Go to my home screen** link → that person's home route.

**Cross-cutting behaviour**
- **Unsaved-changes guard**: applies while the Item form or the Category form has unsaved edits. Leaving by rail, tab strip, browser back, **Open the release**, **Edit groups in Add-ons**, **Propose a new item** or another in-page selection opens a dialog: "You have unsaved changes. Leave anyway?". The choices are **Cancel** (focused; stay) and **Confirm** (red; leave and drop the edits). Reloading or closing the window gets the browser's own "leave site?" prompt. The Add-ons and Suggested tabs have no guard: switching group or item there silently drops edits.
- How writes behave: every write is a direct online `app.*` RPC through `appRpc`, with a 15 s deadline. There is no offline queue and no PIN. Each write is audited server-side. Success shows the toast "Saved.". A failure shows the code's catalogue line as a toast (offline: "No connection. Check your internet and try again."). New rows go to the station's current branch (`venue_id` defaults to `app.current_venue()`). None of these screens has a branch picker.
- Nothing on these tabs can be deleted or archived: items, categories, sizes, groups and options. "Archive" means switching off **Active** (item), **Shown on the till and the guest menu** (category) or an option's active switch.

---

## Menu items — `/admin/menu`
This is where café categories, items, photos, prices, availability and the add-on groups offered on each item are kept; Touch Shop sections and products are filtered out (they live at `/shop/products`).
*Who:* manager, owner. Owner vs manager:
- **New item vs Propose a new item:** the owner creates items here. A manager gets **Propose a new item** instead, which leads to `/protocols`. This holds in every category, because only café categories are listed.
- **Price locks:** on an item that is or was on sale, a manager sees size prices as figures plus **Change the price**. The owner edits them directly.
- **Active switch:** on a never-launched draft it is locked for a manager and free for the owner. On an item still in release it is locked for both.
*Source:* `features/admin/menu/MenuEditor.tsx`, `ItemForm.tsx`, `VariantsEditor.tsx`, `ItemModifierGroups.tsx`, `CategoryEditor.tsx` (CategoryForm), `FormBar.tsx`, `chips.tsx`, `menuLogic.ts`, `availability.ts`, `photo.ts`, `useAdminMenu.ts`, `promotions/PriceChangeStart.tsx`, `components/ImageField.tsx`, `components/Switch.tsx`, `components/inputs.tsx`.

**Header** (title "Menu items"; subtitle "What the till, the guest menu and the kitchen sell. A change shows everywhere as soon as it is saved.")
- **New category** (plus icon): opens a blank Category form in the right-hand pane. Guarded by the unsaved prompt. Disabled without editMenu.
- **New item** (primary; owner, or anyone with `launchDirectly`): opens a blank Item form for the selected category. If there is no category it is disabled, with the tooltip "Create a category first; items live inside categories.".
- **Propose a new item** (primary; manager, because a café category without `launchDirectly` gets it): navigates to `/protocols?start=product_release`, which starts a product release. Nothing is written here. Disabled without `startProtocolRelease`. A hint line sits under the header: "New café items go through a product release, and the owner launches them."
- (In practice nobody sees this) "Not allowed for your role: New item needs the manager role…": the notice shown when `can.editMenu` is false.

**Load / empty states**
- **Try again** (on the error card "This could not be loaded." + the error line + "You may be offline. The last known data is shown where available."): refetches the menu.
- **New category** (on the empty state "No categories yet." / "Create a category first; items live inside categories."): opens the blank Category form in place of the empty state.

**"Items without a cost" notice** (shown when at least 1 active item has no cost row, or while the filter is on; it shows the count plus "Items without a cost" and "Profit reports cannot count these until a cost is entered." / "Every active item has a cost.")
- **Show them** (search icon): lists only active items with no cost, from every category. Closes the open editor and turns reordering off. Guarded by the unsaved prompt.
- **Show all items** (x icon): turns that filter off and goes back to the category view.

**Categories column** (Panel "Categories"; wide layout, 1040 px and up)
- **Category row** (each category name): selects that category's items. It also closes the editor, clears the search and turns off the no-cost filter. Guarded. A hidden category is muted and shows an eye-off icon with the tooltip "Hidden".
- **Edit category** (pencil icon per row; tooltip "Edit category"; aria "Edit category: <name>"): opens that category's form in the right-hand pane. Guarded. Disabled without editMenu.

**Narrow layout** (under 1040 px; replaces the column)
- **Category** dropdown (hidden categories read "<name> (Hidden)"; arrow keys, type-ahead, Enter, Esc): does the same as a category row click.
- **Edit category** (pencil icon button, no text; tooltip "Edit category"): opens the selected category's form.

**Item list**
- **Search items in every category** (search box): case-insensitive match on the English or Arabic name across all categories. Each row then shows its category name, and reordering is off. **Esc** or the **Clear** (x) button empties it.
- Info line (read-only), one of three sentences:
  - "Use the arrows to set the order guests see in this category."
  - "Showing matches from every category. Clear the search to change the order."
  - "Showing items without a cost from every category. Show all items to change the order."
  - In search or no-cost mode the line also shows "N of M".
- Inline error if the stock-availability read fails. That data re-polls every 60 s.
- **Item row** (click, or Enter/Space when focused; table "Items", columns Item · Price (IQD) · Sold out · arrows): opens that item's form on the right. In search or no-cost mode it also switches the selected category to the item's own. Guarded. The selected row is highlighted.
  - Read-only parts of each row:
    - thumbnail (faded when the item is inactive)
    - highlight dot (blue/green)
    - badges: "In release" or "Inactive", "Sold out", "Off today", "Blocked by stock"
    - default price
    - margin chip: "{pct}% margin". Green at 60 % or more, amber at 35 % or more, red below that. Grey "No cost" when there is no cost.
- **Sold out** switch per row (aria "Sold out: <name>"): calls `app.set_item_sold_out(p_item_id, p_sold_out)`.
  - Optimistic: it flips at once. On failure it reverts and shows an error toast. There is no success toast.
  - Disabled without editMenu.
  - Errors: FORBIDDEN "You do not have permission for that.", ITEM_NOT_FOUND "Item not found.", INVALID_SOLD_OUT.
- **Move up** / **Move down** (arrow pair per row; tooltips "Move up"/"Move down"; plain category view only): calls `app.reorder_menu_items(p_ids)` with the category's complete new order. Only `sort_order` changes.
  - Optimistic, then refetches. Toast "Saved.".
  - Disabled at the top/bottom edge, while a move is pending, or without editMenu.
  - Errors: DUPLICATE_ID "The new sort order lists something twice. Refresh and try again.", ITEM_NOT_FOUND, FORBIDDEN.
- **New item** (owner) / **Propose a new item** (manager), small buttons in the empty-category state ("No items in this category yet."; owner also sees "Add the first item; it appears on the till and the website as soon as it is saved."). They do the same as the header buttons.
- **Clear filters** (in the empty result "No items match the search."): clears the search box.
- (No-cost view with nothing left: "Every active item has a cost." No action.)
- Right-hand pane with nothing open: "Choose an item to edit it, or add a new one." No action.

**Item form — header bar** (title = item name or "New item"; meta = category · "Default price: <IQD>" · margin chip; "Unsaved changes" badge while dirty)
- **Discard changes** (only while dirty): resets every form field and the cost draft to the stored values. No confirmation and no write.
- **Save** (primary, check icon): calls `app.upsert_menu_item` with:
  - `p_id`, `p_category_id`
  - `p_name_en/ar`, trimmed
  - `p_description_en/ar` (blank → null)
  - `p_sort_order`: unchanged, or the end of the category for a new item
  - `p_is_active`, `p_hook_en/ar`, `p_highlight`
  - After that:
    - New item: `app.set_item_photo` for a held photo, and `app.set_item_cost` if a cost was typed.
    - Existing item: `app.set_item_cost` if the cost changed.
  - Then toast "Saved." and the item stays selected.
  - Disabled when:
    - nothing changed
    - either name is empty (tooltip "Fill in both names first.")
    - only one flavour line is filled (tooltip "Enter the flavour line in both languages, or leave both empty.")
    - no editMenu
  - Errors are shown inline under the bar and as a toast:
    - ITEM_VIA_RELEASE "New menu items start as “Propose a new item”, and the owner launches them." (manager switching on a café draft)
    - ITEM_IN_RELEASE "This item is still a new-item draft. Its prices come from its release, and it goes on sale when it is launched." (anyone switching on an item still in release)
    - HOOK_PAIR_MISMATCH
    - HOOK_TOO_LONG "The flavour line must be 60 characters or fewer."
    - INVALID_HIGHLIGHT
    - CATEGORY_NOT_FOUND "Category not found."
    - ITEM_NOT_FOUND
    - INVALID_COST
    - INVALID_PHOTO_PATH
    - FORBIDDEN
- **Open the release** (↗; in the "In release: <run title>" notice, which also says "Its prices come from the release, and it goes on sale when the owner launches it."; shown when the item's product-release run is not live or done): navigates to `/protocols?run=<runId>`. Guarded.

**Item form — Details** (Panel "Details")
- **Name** (English and Arabic text boxes, required, at most 80 characters each). Part of Save.
- **Description** (English and Arabic text areas, optional, at most 400). Part of Save; a blank one is stored as null.
- **Flavour line** (English and Arabic, at most 60; both languages or neither). If only one is filled, the inline red error is "Enter the flavour line in both languages, or leave both empty.". Hint: "Up to 60 characters, both languages or neither. Example: sweet · crisp · bold.". Part of Save.

**Item form — Photo and highlight**
- **Photo** drop zone ("Drag a file here or click to choose one"; click, Enter or Space opens the file picker; drag-and-drop works too).
  - Accepts JPEG, PNG, WebP, GIF or AVIF up to 10 MB. The file is compressed to WebP (at most 1200 px) and uploaded to Storage bucket `menu-media`, folder `items/<itemId>`.
  - On a saved item it saves at once via `app.set_item_photo(p_item_id, p_photo_path)`, toast "Saved.", and the old file is deleted. On failure the preview reverts and the new upload is deleted.
  - On a new item the upload is held until the first Save. Leaving without saving deletes it.
  - Errors: "File is too large (max 10 MB).", "That file is not a supported image.", "Upload failed.", INVALID_PHOTO_PATH "That photo path is not allowed.", PHOTO_BLUR_TOO_LONG, FORBIDDEN.
  - Hint: "Square, up to 1200 px. Saved as WebP.". Disabled while a photo save is running.
- **Upload** / **Replace** (ghost button under the zone): opens the same file picker.
- **Remove** (only when there is a photo): opens a dialog "Remove this photo?" with **Cancel** and **Remove** (red). Confirming clears the photo: an immediate `set_item_photo(null)` on a saved item, held until Save on a new one.
- **Highlight** (radio pills **None** / **Blue** / **Green**; Green is stored as `brown`): the colour mark on the guest menu. Part of Save.

**Item form — Cost and status**
- **Cost (IQD)** (digits only, Arabic-Indic digits accepted, the formatted IQD shown beside it; blank = unknown, never 0). Hint: "Leave blank if you do not know it. Profit reports skip items without a cost."
  - Saved item: on leaving the box (blur) it calls `app.set_item_cost(p_item_id, p_cost_iqd)`, toast "Saved.". On error it reverts (INVALID_COST "Cost must be a whole IQD amount of 0 or more, or left blank.", ITEM_NOT_FOUND, FORBIDDEN).
  - New item: sent with Save.
- **Active** switch. Part of Save. Hint: "Switched off, the item is hidden from the till and the guest menu."
  - Locked (disabled), with the reason in place of the hint:
    - Item still in release (everyone): "Goes on sale when the owner launches its release."
    - Never-launched café draft, manager: "Goes on sale when the owner launches it."
  - A shop-only lock ("Saved hidden until the owner approves its price." + **Put on sale** ↗ → `/protocols?start=price_promo&change=shop_launch&item=<id>`) exists in the code but cannot be reached here, because shop products are filtered out of this editor.

**Item form — Availability** (saved items only; a new item shows "Save the item to manage sizes, add-ons and availability.")
- Read-only status line, one of:
  - "Guests can order this now."
  - "Guests cannot order this: the item is switched off."
  - "…: it is sold out."
  - "Guests cannot order this today: it is off for today."
  - "…: an ingredient is out of stock."
- **Sold out** switch (red; hint "Stays off until someone switches it back on."): calls `app.set_item_sold_out`. Optimistic; on error it reverts and shows a toast. No success toast. Disabled without editMenu.
- **Take off for today** (clock icon; hint "Takes it off until tomorrow, then it comes back on its own."): calls `app.set_item_availability(p_item_id, p_available=false)`, which stamps `unavailable_on` with the business date. Toast "Saved.". Errors: FORBIDDEN, ITEM_NOT_FOUND.
- **Put back on now** (shown instead, next to "Off today — back on <date>."): calls `app.set_item_availability(p_available=true)` and clears the date. Toast "Saved.".
- "Blocked by stock" block (read-only):
  - Badges "Blocked by stock" and "Set by stock — not a toggle".
  - Text: "The kitchen is out of an ingredient this item needs, … it clears when stock is received or counted.", followed by "Out of stock: <ingredients>" or "The blocking ingredient could not be named from this station. Check On hand under Stock."
  - No action.

**Item form — Sizes and prices** (saved items only; columns Size · Price (IQD) · Default)
- **Price (IQD)** box per size: editable unless prices are locked, in which case the stored figure shows as text. Size names are shown as text and are never editable here, for anyone.
- **Default** radio per size (aria "Default: <size>"; one per item; hint "The default size is the one the till and the guest menu pick first." when there are 2 or more sizes): marks the row as changed. It works even when prices are locked.
- **Save** (per row, only on a row whose price changed or that became the default): calls `app.upsert_variant` with:
  - `p_id`, `p_item_id`
  - the stored names
  - `p_price_iqd` (the stored price when locked)
  - `p_is_default`, `p_sort_order`
  - The server clears the old default. Toast "Saved.".
  - Errors:
    - PRICE_VIA_PROTOCOL with hint name → "Renaming a size or an option that is on sale goes through “Change the price”, with the owner’s OK."
    - PRICE_VIA_PROTOCOL → "Prices, size and add-on names, promotions, … change through a price or promotion change in Protocols." (a manager pricing a launched item from a stale screen)
    - ITEM_IN_RELEASE, INVALID_PRICE "Invalid price.", VARIANT_NOT_FOUND "Size not found.", ITEM_NOT_FOUND, FORBIDDEN
- **New size** (plus; hidden when prices are locked; disabled while a draft is open): opens a draft row:
  - **Name (English)** (text)
  - **Name (Arabic)** (text, RTL)
  - **Price (IQD)** (money; blank = 0)
  - **Cancel**: closes the draft.
  - **Save**: calls `app.upsert_variant` for a new size. The first size becomes the default; others go to the end. Disabled until both names are filled. The tooltip "Fill in both names first." shows once one name is typed. Same error list as row Save, plus ITEM_IN_RELEASE / PRICE_VIA_PROTOCOL for a new size on a locked item.
- **Change the price** (↗; manager on an item that is or was on sale, i.e. launched or active; replaces New size): navigates to `/protocols?start=price_promo&change=price&item=<id>`. Note shown: "This item is on sale, so its sizes’ prices and names change through Change the price, with the owner’s OK." Only rendered when the person may start a price change and open `/protocols`. Guarded.
- Item still in release (everyone): prices show as figures, with no New size and no Change the price. Note: "The release’s price step sets these prices." Default can still be changed.
- Empty: "No sizes yet. Add one so the item has a price."

**Item form — Add-on choices** (saved items only)
- **Edit groups in Add-ons** (↗, ghost): navigates to `/admin/addons`. Guarded.
- **Offered on this item** switch per add-on group (aria "Offered on this item: <group>"; the row shows the group name, its rule such as "Optional · choose up to 2" / "Required · choose 1" / "Required · choose 1 to 3", and its active options with "(+IQD)" extras, or "No options in this group yet."): calls `app.link_item_modifier_group(p_item_id, p_group_id, p_linked)`. Toast "Saved.".
  - Optimistic; on error it reverts and shows a toast.
  - A manager's link that makes guests pay more (PRICE_VIA_PROTOCOL hint required_addon) is refused with "This would make guests pay more: a paid option they would have to pick, or a free one taken away. Only the owner makes this change.".
  - Other errors: GROUP_NOT_FOUND "Modifier group not found.", ITEM_NOT_FOUND, FORBIDDEN.
  - Disabled without editMenu.
- **Show other groups** / **Hide other groups** (chevron; shown when some groups are not on the item): expands or collapses the list of groups not offered, each with the same switch.
- Read-only texts: "Switch on the add-on groups guests choose from on this item." · "No add-on groups are offered on this item yet." · "No add-on groups exist yet. Create them in Add-ons."

**Category form in the right-hand pane** (opened by **New category** or **Edit category**): exactly the form described under `/admin/categories` below (Cancel, Save, Name EN/AR, Tax group, Shown switch, Category photo Upload/Replace/Remove). After Save the saved category is selected, and the search and no-cost filter are cleared.

---

## Categories — `/admin/categories`
This tab lists the menu's sections in till and guest-menu order, so you can reorder them and edit each one's name, tax group, visibility and photo. Café sections only.
*Who:* manager, owner. Same controls for both: every write is gated by `can.editMenu` (both roles). *Source:* `features/admin/menu/CategoryEditor.tsx` (CategoryEditor, CategoryForm, useCategoryReorder), `FormBar.tsx`, `photo.ts`, `components/ImageField.tsx`.

**Header** (title "Categories"; subtitle "The sections of the menu, in the order the till and the guest menu show them.")
- **New category** (primary, plus): opens a blank Category form on the right. Guarded by the unsaved prompt. Disabled without editMenu.

**Load / empty states**
- **Try again** (error card): refetches.
- Empty: "No categories yet." / "Create the first category; menu items live inside categories." There is no button in the empty state; use the header's New category.
- Right-hand pane with nothing open: "Choose a category to edit it, or add a new one."

**Table** (columns Category · Items · Status · Order · ›)
- **Category row** (click, or Enter/Space): opens that category's form on the right. Guarded. The selected row is highlighted and its name shown in bold. A long name is truncated, with the full name as a tooltip. Read-only cells: thumbnail, item count, "Shown" or a "Hidden" badge.
- **Move up** / **Move down** (Order column; tooltips "Move up"/"Move down"): calls `app.reorder_menu_categories(p_ids)` with the complete new order. Only `sort_order` changes. Optimistic, toast "Saved.". Disabled at the edges, while pending, or without editMenu. Errors: DUPLICATE_ID "The new sort order lists something twice. Refresh and try again.", CATEGORY_NOT_FOUND, FORBIDDEN.

**Category form** (header: name or "New category"; meta "Edit category · Items in this category: N"; "Unsaved changes" badge)
- **Cancel** (ghost): closes the form. If there are changes it first asks "You have unsaved changes. Leave anyway?" (Cancel / Confirm). For a new category it also deletes a photo that was already uploaded.
- **Save** (primary, check): calls `app.upsert_menu_category(p_id, p_name_en, p_name_ar, p_tax_group_id, p_sort_order, p_is_active)`.
  - Existing categories keep their order. A new one is saved at sort_order 0, so it sits at the top next to the current first category and the two are ordered by English name.
  - For a new category with a held photo it then calls `app.set_category_photo`.
  - Toast "Saved.", and the saved category stays selected.
  - Disabled when nothing changed, a name is missing (tooltip "Fill in both names first."), there is no tax group, or no editMenu.
  - Errors are shown inline and as a toast: TAX_GROUP_NOT_FOUND "That tax group no longer exists. Choose another.", CATEGORY_NOT_FOUND, INVALID_PHOTO_PATH, FORBIDDEN.
- **Name** (English and Arabic, required, at most 80). Part of Save.
- **Tax group** (dropdown of tax groups; hint "Sets the tax on every item in this category."). Part of Save.
- **Shown on the till and the guest menu** switch (hint "Switched off, the category is hidden and nothing in it can be ordered."). Part of Save. Switching it off is the archive; there is no delete.
- **Category photo** drop zone (click, Enter/Space or drag-and-drop; "Drag a file here or click to choose one"; hint "Wide (16 by 9), shown at the top of the category on the guest menu.").
  - Image up to 10 MB, compressed to WebP and uploaded to `menu-media/categories/<id>`.
  - Saved category: immediate `app.set_category_photo(p_category_id, p_photo_path)`, toast "Saved.", old file deleted. On error it reverts.
  - New category: held until Save.
  - Errors: "File is too large (max 10 MB).", "That file is not a supported image.", "Upload failed.", INVALID_PHOTO_PATH, PHOTO_BLUR_TOO_LONG, CATEGORY_NOT_FOUND, FORBIDDEN.
- **Upload** / **Replace**: opens the file picker.
- **Remove**: opens a dialog "Remove this photo?" with **Cancel** and **Remove**. Confirming clears the photo (immediate `set_category_photo(null)` on a saved category).

---

## Add-ons — `/admin/addons`
This tab edits the choice groups guests make on an item (milk, extra shot…), each group's options and extra charges, the items that offer each group, and the sub-groups an option reveals.
*Who:* manager, owner.
- What gates what: Group-editor writes are gated by `can.editMenu` (both roles). The option rows and the reveals panel have no in-screen role gate.
- Option rows, manager (no `editLaunchedPrices`/`launchDirectly`):
  - A launched option's price is locked.
  - A launched paid option's names are locked.
  - A new paid option is saved hidden; **Put on sale** sends its price to the owner.
  - Any change that makes guests pay more is refused (required_addon).
- Option rows, owner: nothing is locked.

*Source:* `features/admin/addons/AddonsPage.tsx`, `GroupEditor.tsx`, `OptionsEditor.tsx`, `RevealsEditor.tsx`, `ChoiceLimits.tsx`, `addonsLogic.ts`, `useAddons.ts`, `promotions/PriceChangeStart.tsx`.

**Header** (title "Add-ons"; subtitle "The choices a guest makes on an item, such as milk type or an extra shot. A sub-group is asked only after a guest picks a certain option, …")
- **Try again** (error card): refetches.

**Left column: "Item groups" panel** (groups linked to at least 1 item)
- **New group** (plus): opens a blank group editor on the right (title "New group"). Disabled without editMenu.
- **Group row** (name, rule such as "Optional · choose up to 2", and "Options N · Items M"; chevron): opens that group's editor and its options on the right. Not guarded: unsaved group edits are dropped.
- Empty: "None".

**Left column: "Sub-groups" panel** (hint "Not linked to any item. An option in another group reveals it.")
- **New sub-group** (plus): opens a blank sub-group editor (title "New sub-group", without the items list). Disabled without editMenu.
- **Sub-group row** (name, rule, "Options N · Asked after: <option names>" or "Options N · No option asks for it yet"): opens its editor and options.
- Empty: "None".
- Right-hand pane with nothing selected: "Choose a group to edit it, or add a new one."

**Group editor** (Panel titled with the group name, "New group" or "New sub-group"; "Unsaved changes" badge)
- **Name** (English and Arabic, required, at most 80).
- **How many can a guest choose?**:
  - **At least** [number, 0 or more] and **At most** [number, 1 or more].
  - A live sentence: "Optional · choose up to {max}" / "Required · choose {count}" / "Required · choose {min} to {max}".
  - Inline errors: "“At least” must be 0 or more." / "“At most” must be 1 or more." / "“At least” cannot be more than “at most”.".
- **Offered on these items** checklist. Shown for a new group and for every existing group, sub-groups included, so ticking an item here turns a sub-group into an item group.
  - Counter "Selected: N".
  - **Search items…** box (Esc or **Clear** empties it). Items that already offer the group are listed first.
  - One **checkbox per item**. Inactive items are muted with an "Inactive" badge. The list includes shop products, because it reads `menu_items` unfiltered.
  - "No items match the search." when nothing matches.
- **Cancel** (new group or sub-group only): closes the editor without writing.
- **Discard changes** (existing group, only while dirty): resets name, limits and item ticks.
- **Save** (primary, check): calls `app.upsert_modifier_group(p_id, p_name_en, p_name_ar, p_min_select, p_max_select)`, then one `app.link_item_modifier_group(p_item_id, p_group_id, p_linked)` per item ticked or unticked.
  - The calls run in sequence, so a failure part-way can leave some links saved.
  - Toast "Saved.". A new group becomes the selection.
  - Disabled when nothing changed, a name is missing (tooltip "Fill in both names first."), the limits are invalid, or no editMenu.
  - Errors:
    - A manager's change that makes a paid choice compulsory (PRICE_VIA_PROTOCOL hint required_addon) shows a lock note and a toast: "This would make guests pay more: a paid option they would have to pick, or a free one taken away. Only the owner makes this change."
    - Otherwise an inline error + toast: INVALID_SELECT_RANGE "The minimum number of choices cannot be more than the maximum, and the maximum must be at least 1.", GROUP_NOT_FOUND, ITEM_NOT_FOUND, FORBIDDEN.

**Options card** ("Options"; only for an existing selected group)
- Manager only, read-only lock note: "Prices of options on sale, and the names of paid ones, change through “Change the price”, with the owner’s OK. A new paid option is saved hidden, and “Put on sale” sends its price to the owner. A free option goes on at once."
- **New option** (disabled while a draft is open): opens a draft row:
  - **Name (English)** (text)
  - **Name (Arabic)** (text, RTL)
  - **Extra charge (IQD)** (money, blank = 0)
  - **Cancel**: closes the draft.
  - **Save**: calls `app.upsert_modifier(p_group_id, p_name_en, p_name_ar, p_price_delta_iqd, p_sort_order = end, p_is_active)`.
    - A manager's paid option is saved with `p_is_active = false`, and the note "Saved hidden. “Put on sale” then sends its price to the owner." is shown. A free option, or any option the owner adds, is saved on.
    - Disabled until both names are filled, and while saving.
    - Toast "Saved.". Errors are as for the option row's Save.
- "None" when the group has no options.
- Per option row (columns Name (English) · Name (Arabic) · Extra charge (IQD)):
  - **Name (English)** / **Name (Arabic)** text boxes. For a manager on a launched paid option they become plain text with the tooltip "This option is on sale, so its name changes through “Change the price”, with the owner’s OK."
  - **Extra charge (IQD)** money box. Disabled for a manager on a launched option (launched_at set, or currently on).
  - **Change the price** (ghost ↗; manager on a launched option; aria "Change the price: <name>"): navigates to `/protocols?start=price_promo&change=addon_price&addon=<id>`.
  - **Active** switch (aria "Active: <name>"): calls `app.upsert_modifier` with the stored row and `p_is_active` flipped.
    - Optimistic; on error it reverts and shows a toast. No success toast.
    - Disabled for a manager on a paid option that was never on sale.
    - Errors: the required_addon line above, LAUNCH_VIA_PROTOCOL "Save it hidden, … It goes on sale when the owner approves its price in a price change.", MODIFIER_NOT_FOUND, FORBIDDEN.
  - **Put on sale** (↗; manager on a paid option never on sale; aria "Put on sale: <name>"): navigates to `/protocols?start=price_promo&change=addon_price&addon=<id>`.
  - **Move up** / **Move down**: calls `app.reorder_modifiers(p_ids)` with the group's complete order. Only `sort_order` changes. Optimistic, toast "Saved.". Disabled at the edges or while pending. Errors: DUPLICATE_ID, MODIFIER_NOT_FOUND, FORBIDDEN.
  - **Reveals (N)** (chevron toggle; aria-expanded): opens or closes this option's Reveals panel. Only one is open at a time.
  - **Save** (enabled when the names or charge changed and both names are filled): calls `app.upsert_modifier` with the full row. Locked names are sent back as stored.
    - Toast "Saved.".
    - Errors:
      - required_addon → "This would make guests pay more…"
      - PRICE_VIA_PROTOCOL with hint name → "Renaming a size or an option that is on sale goes through “Change the price”, with the owner’s OK."
      - PRICE_VIA_PROTOCOL (a launched option's price, manager)
      - LAUNCH_VIA_PROTOCOL
      - INVALID_PRICE, GROUP_NOT_FOUND, MODIFIER_NOT_FOUND, FORBIDDEN

**Reveals panel** (per option; "Reveals", "Sub-groups shown when this option is picked.")
- Read-only line when this option's own group is itself revealed by another option: "Sub-groups can only nest one level deep.". In that case nothing can be added.
- **Checkbox** on a chosen sub-group (ticked; unticking takes it out of the draft list).
- **Move up** / **Move down** on chosen sub-groups. Changes the order in the draft only (local).
- **Checkbox** on an eligible sub-group (unticked; shown as "<name> (min–max)"): adds it to the end of the draft list. Eligible means: linked to no item, not this option's own group, and not a group whose options already reveal.
- "No sub-groups yet. Create one to reveal it here." when there is none to choose.
- **+ New sub-group** (ghost; disabled when the nesting rule applies): opens an inline form:
  - **Name (English)** / **Name (Arabic)** (at most 80)
  - **Min / max choices** (two number boxes, aria "Min choices"/"Max choices")
  - **Cancel**
  - **Save**: calls `app.upsert_modifier_group(...)`, then `app.set_modifier_reveals(p_modifier_id, p_group_ids = current list + new)`. Toast "Saved.". Disabled until both names are filled and the limits are valid; no error text is shown for bad limits. Errors: required_addon line, INVALID_SELECT_RANGE, REVEAL_DEPTH, FORBIDDEN.
- **Remove** (ghost; only when the option has saved reveals): opens the dialog "Clear every revealed sub-group for this option?" with **Cancel** and **Confirm**. Confirming calls `app.set_modifier_reveals(p_group_ids = [])`.
- **Save** (primary; enabled when the list or its order changed): calls `app.set_modifier_reveals(p_modifier_id, p_group_ids)`, which replaces the whole ordered list. Toast "Saved.". Errors: required_addon line, REVEAL_SELF "An option cannot reveal its own group.", REVEAL_DEPTH "Sub-groups can only nest one level deep.", GROUP_NOT_FOUND, MODIFIER_NOT_FOUND, FORBIDDEN.

---

## Suggested items — `/admin/suggested`
This tab picks, for each item, up to 6 other items guests see under "Goes well with" when they open it on the guest menu.
*Who:* manager, owner. Same controls for both (gated by `can.editMenu`). *Source:* `features/admin/suggested/SuggestedEditor.tsx`, `suggestedLogic.ts`, `addons/addonsLogic.ts` (moveInList).

**Header** (title "Suggested items"; subtitle "Guests see these under “Goes well with” when they open an item on the guest menu.")
- **Try again** (error card): refetches.

**Left: "Pick an item" panel**
- **Category** dropdown (all `menu_categories`, including Touch Shop sections, because the query is unfiltered; arrow keys, type-ahead): lists that category's items and clears the item selection. Not guarded: an unsaved suggestion list is dropped.
- **Item row** (name, muted when inactive; "Suggestions: N" or "No suggestions for this item yet."; a "Not on the menu" badge when inactive; chevron): opens its suggestion list on the right. Not guarded.
- Empty: "No items in this category."
- Right-hand pane with nothing selected: "Choose an item to pick what goes well with it."

**Right: "<item> · Goes well with" panel** (counter "Chosen: N of 6")
- **Move up** / **Move down** per chosen item (numbered list): reorders the draft list locally. Disabled at the edges or without editMenu.
- **Remove** (x, per chosen item): takes it out of the draft list. Disabled without editMenu.
- "No suggestions for this item yet." when the list is empty.
- **Add suggestion** search box (placeholder "Search items…"; disabled without editMenu). Typing shows up to 8 matching active items, never the item itself and never one already chosen. Replaced, once 6 are chosen, by the info line "All 6 places are used. Remove one to add another."
- **+ <item name>** (one button per search match): appends that item to the draft list and clears the search.
- **Discard changes** (ghost; enabled when the list changed): puts back the saved list.
- **Save** (primary, check): calls `app.set_addon_suggestions(p_item_id, p_suggested_item_ids)`, which replaces the whole ordered list. Toast "Saved.".
  - Disabled when nothing changed (tooltip "Nothing has changed yet."), while saving, or without editMenu.
  - Errors: SELF_SUGGESTION "An item cannot suggest itself.", ITEM_NOT_FOUND, FORBIDDEN, a duplicate in the list (23505) "That already exists. Check the details and try again.".
  - The cap of 6 is enforced only in the client; the server has no cap.
