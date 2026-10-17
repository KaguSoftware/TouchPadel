# Observe: every action, screen by screen

Management › **Observe** — *The floor now, the pattern behind it, and what is waiting on you*. Part of the
[management actions inventory](README.md), which also covers the rail, who can
open what, and the problems this crawl turned up.

Snapshot of the operator app's **working tree on 2026-10-16**, uncommitted work
from parallel sessions included. Read from the code, not clicked through:
labels are the English catalog's words, writes name the `app.*` RPC (or queued
mutation) they call, and refusal codes come from the latest migration that
defines each function. If a screen changes, this file is stale for that screen.

| Screen (rail order) | Bullets |
|---|---|
| Overview — `/observation` | 116 |
| Bookings — `/observation/courts` | 31 |
| Tills — `/observation/tills` | 20 |
| Staff activity — `/reports/staff` | 27 |
| Activity monitor — `/observation/activity` | 12 |
| Requests — `/observation/requests` | 24 |
| Pay deductions — `/deductions` | 58 |
| Protocols — `/protocols` | 165 |
| Suggestions — `/suggestions` | 10 |
| Incidents — `/incidents` | 97 |
| Marketing — `/marketing` | 115 |
| Audit log — `/admin/audit` | 31 |
| Promotions (hidden row, opened from Marketing) — `/admin/promotions` | 24 |
| Promotion editor — `/admin/promotions/$id` (`$id` = `new` for a new one) | 50 |
| Telegram (hidden row, opened from Marketing) — `/admin/telegram` | 62 |
| **Total** | **842** |

---

## Overview — `/observation`
The owner's landing screen for Observe: what needs a decision right now, what the floor is doing (figures plus the live 3D plan), and a card for every other Observe screen.

*Who:* `owner` only (`ROUTE_ROLES['/observation']`; route guarded by `RequireRole route="/observation"`). An owner who opens `/ops` while NOT in the Operations workspace is redirected here (`replace`). In-screen gates: Needs-you rows "Deductions to decide" and "Posts to approve" need `decideDeductions` / `decideContent` (owner); "Incidents to review" needs `reviewIncidents`; "Lesson refunds due" needs coaching `refund` (manager, owner) and a server with coaching; "Player reports" needs `reviewMatchReports` and a server with open matches; marketing / protocols / suggestions rows and card figures only load when `canAccess` the matching route. *Source:* `features/observation/ObservationHome.tsx`, `components/SectionHome.tsx`, `features/ops/OperationsOverview.tsx` (`FloorNow`, `useFloorNowHeading`), `features/ops/NeedsYou.tsx`, `features/ops/TodaySections.tsx`, `features/ops/opsLogic.ts`, `features/deposits/DepositAttentionPanel.tsx`, `features/ops/MatchReportsPanel.tsx`, `features/ops/LessonRefundsDuePanel.tsx`, `features/coaching/LessonRefundsDue.tsx`, `features/coaching/BlockedRefundDialog.tsx`, `features/till/ManagerActions.tsx` (`RefundDialog`), `features/floor/LiveFloor.tsx`, `features/floor/floorScene.ts`.

> Code state: the `/ops` body this page embeds was being rebuilt by a parallel session while this was written (files `OperationsOverview.tsx`, `NeedsYou.tsx`, `TodaySections.tsx` changed 23:00–23:06 on 2026-10-16, uncommitted). This list follows that working tree. `docs/design/operator-ui/ops-today-inventory.md` describes the OLD layout (11-row list starting with "The day is not open", separate Online refunds / Player reports / Lesson refunds panels, Courts/Cafe/Stock cards, "Closing the day" three steps, exceptions card) and no longer matches the code.

**Header**
- **Title "Observe"** — static. Subtitle is the business day: "{Weekday}, {date} · open since {time}" when a day is open, "{Weekday}, {date}" when no day is open (from `ops_overview`).
- **"Updated {time}"** — read-only, when `ops_overview` was last read.
- **Refresh** (button, refresh icon) — re-reads `app.ops_overview` now (invalidates `['opsOverview']`); spins while re-fetching. Does NOT refresh the floor plan, the requests/marketing/suggestions counts or the queues. Auto: `ops_overview` every 30 s and on realtime broadcasts `floor`, `courts`, `kds`.

**Page states (whole floor body)**
- Loading → skeleton. 
- **Try again** (error state: "This could not be loaded." / "You may be offline. The last known data is shown where available.") — re-reads `ops_overview`.

**Banner: the day is not open** (only when no business day is open)
- **Open the day** (primary button) — navigates to `/admin/day-close`. Text: "The day isn't open" / "The till can't take payments until you open the day with the cash float."

**Needs you** (wide column, first) — one to-do list; header shows a grey count pill with the number of rows; icon turns to a tick when clear. Row = coloured count block (red = danger, amber = warn), title, hint, one action. Order fixed (by who is waiting, never by count): the floor's rows, then the owner's own rows.
- Clear state: "Nothing needs you right now." (green). Loading with no rows yet: skeleton.
- **Answer calls** — row "Tables calling for a waiter" (amber) / "Guests are asking for a waiter or the bill." → navigates to `/till/tabs`. Shows when open waiter calls > 0.
- **"Tell the kitchen"** (plain text, no button) — row "Kitchen orders running late" (red) / "They are past the time the kitchen aims for. The kitchen screen shows which." Nothing to press.
- **Review refunds** (toggle, chevron down/up, `aria-expanded`) — row "Online refunds needing attention" / "Guests paid online and the money has not gone back to them yet." Count = `app.deposit_attention` rows for the rail branch; red if any refund failed or a paid booking is off, amber if all are only slow. Opens the queue IN PLACE under the row (see "Online refunds queue" below); press again to fold.
- **Review lesson refunds** (toggle) — row "Lesson refunds due" / "{amount} paid at the desk for lessons that were cancelled or left." (or without amount). Amber. Opens "Lesson refunds queue" in place. Conditions: coaching `refund` capability and coaching present on the server.
- **Review reports** (toggle) — row "Player reports" / "Players reported someone they played with. Close each report or ban the player." Amber. Opens "Player reports queue" in place. Conditions: `reviewMatchReports` and open matches present.
- **See expired** — row "Expired stock on the shelf" (red) / "Write it off so nobody uses it and the stock figures stay true." → `/stock/expiry`.
- **See which** — row "Ingredients running low" (amber) / "Dishes that use them can sell out during service." → `/stock?filter=low`.
- **Receive goods** — row "Driver's purchases to receive" / "Bought and on the way. Receive them so they are counted in stock." → `/stock/receive` (count from `app.purchases_to_receive`).
- **Open Day close** — row "Till shifts closed short or over today" / "Each difference is on Day close, with who counted it and who signed." → `/admin/day-close` (count from `app.till_shift_list`, today's shifts with a non-zero difference).
- **Open protocols** — row "Protocol steps waiting on you" / "A decision or a task in a new item, a tournament, a hire or a price change." → `/protocols?filter=waiting` (`app.protocols_waiting_count`, to decide + to do).
- **Decide deductions** — row "Deductions to decide" / "A head or a manager proposed taking money off someone's pay." → `/deductions`. Owner only (`decideDeductions`).
- **Review incidents** — row "Incidents to review" / "Someone reported an incident. The reporter waits for your note." → `/incidents`.
- **Review posts** — row "Posts to approve" / "Marketing sent content for your approval." → `/marketing`. Owner only (`decideContent`).
- **Answer requests** — owner row "Staff requests waiting for your answer" / "Leave, swaps, advances and corrections stay on hold until you approve or decline them." → `/observation/requests` (count = pending from `app.staff_requests_page`, polled 60 s). Amber.
- **Read suggestions** — owner row "New suggestions from staff" / "Read them and mark them seen; the author sees that you did." → `/suggestions`. Only if the viewer can open `/suggestions`.
- **Review campaigns** — owner row "Campaigns past their start date that are not live" / "Nothing moves a campaign on by itself. Set it live, or move it back to draft." → `/marketing` (from `app.marketing_overview`).
- **Review campaigns** — owner row "Live campaigns past their last day" / "End them, so the list shows only what is really running." → `/marketing`.
- **Try again** — failed-check row "Some of this list didn't load, so it may be missing something." (wifi-off icon) — re-runs every failed read (protocols, purchases, people-record counts, till shifts, deposits, reports, lessons, staff requests, marketing, suggestions). Always shown beside the rows, never folded under View more.
- **View more ({count})** / **Show less** — only 3 rows show; this unfolds/folds the rest.

**Online refunds queue** (opened in place under "Review refunds"; one entry per `deposit_attention` row, worst first; 3 then View more)
- Row read-only content: guest name or "Guest with no name" (ticket rows "Ticket refund · {tickets} · {name}" + badge "Any branch can settle this"; lesson rows "Lesson refund · {name}"), phone, **Test** badge with hover "A test payment. No real money moved.", court · start time, amount, kind badge (Refund failed / Refund not confirmed / Paid, booking not on) with hint, facts "Why: {reason}" · "Refund asked for {time}" or "Paid {time}" · "Tried {n} times".
- **Try again** (refund failed rows only) — `app.deposit_refund_retry` → toast "Refund sent to Qi Card again."; list + booking bill re-read. Online only (direct RPC). Errors: shown on the row, list re-reads.
- **Refund to guest** (paid-but-booking-not-on rows only) — opens confirm "Refund {amount} to {name}?" / "The deposit goes back to the card the guest paid with. This cannot be undone."
  - **Cancel** — closes.
  - **Refund** (danger) — `app.deposit_refund_request` (whole deposit, no partial) → toast "Refund sent to Qi Card." Errors: shown in the dialog/row (lesson rows use coaching wording, e.g. lesson still on); list re-reads.
- **Settled another way** (refund failed rows only; ghost, lock icon) — opens dialog "Settled another way" / "{amount} to {name}. Say how the guest was paid back; this closes the refund."
  - **How was it settled?** (textarea, required, max 500 chars; hint "For example: paid back in cash at the desk on Saturday.")
  - **PIN** (password, digits only, 4–6; hint "A manager PIN authorises this."; Enter submits)
  - **Cancel** — closes (blocked while busy).
  - **Mark as settled** (primary, lock) — disabled until note + ≥4-digit PIN ("Say how it was settled and enter a PIN"). PIN proved by `verify_manager_pin`, then `app.deposit_refund_manual` with this device id → toast "Refund marked as settled." Errors shown in the dialog; a refused PIN clears the PIN field. Online only.
- No action on "Refund not confirmed" rows (hint "Qi hasn't answered yet. It is retried on its own and moves here as failed if it keeps failing.").
- **Open lesson** (lesson rows) → `/desk/lessons/{lessonId}`.
- **Open customer** (ticket and lesson rows) → `/desk/customers/{customerId}`.
- **Try again** (queue read failed) — re-reads `deposit_attention`.
- **View more ({count})** / **Show less**.

**Lesson refunds queue** (opened in place under "Review lesson refunds"; `app.lesson_refunds_due`, oldest lesson first; 3 then View more)
- Row read-only: student label, phone, lesson time, lesson kind badge, coach, per payment "Paid {amount} by {cash/card}" · "Refunded so far {amount}", "Due {amount}", "Left the course: due for the sessions still to come".
- **Open lesson** → `/desk/lessons/{lessonId}`.
- **Refund** (danger, one per payment with money left) — opens the till Refund dialog "Refund":
  - Info: "Lesson money paid at the desk: at most what is due back ({amount}), unless it is a goodwill refund."
  - **Refund which payment** (select: "Cash · {amount}" / "Card · {amount}")
  - **Amount to refund** (numeric; hint "At most {amount}."; starts at the cap)
  - **Goodwill: refund more than is due** (switch) — lifts the cap to what is left on the payment; switching off pulls the amount back under the due.
  - **Cancel** — closes.
  - **Refund** (danger) — disabled when amount is 0 or over the cap ("At most {amount}."). Opens PIN step "Refund": **Reason** (select, only "Lesson refund", or "Goodwill refund" with goodwill on), **Manager PIN** (4–6 digits), **Cancel**, **Confirm** → queued `payment.refund` (durable queue, works offline; PIN proved at replay). Toast "Refund recorded." or "Refund saved. It goes through once the station is back online." Errors: shown in the dialog; `REFUND_EXCEEDS_DUE` re-reads the list.
- Online-blocked line "Online refund needs attention: {amount}" (only when an online share could not be refunded by Qi):
  - **Online refunds** (ghost) — opens the "Online refunds needing attention" row of Needs you, unfolds View more if it is past row 3, and scrolls to it. If that row is not present nothing visible happens.
  - **Record the handback** — opens "Record money handed back" (subtitle: the student label; info "Qi takes one refund per payment, so this share was handed back … nothing leaves the drawer through this record."):
    - **Amount handed back** (money input; starts at the blocked amount; hint "At most {amount}."; errors "Enter an amount." / "At most {amount} is owed back online on this sign-up.")
    - **Reference** (text, 1–80 chars; hint "A receipt or transfer number, up to 80 characters."; errors on leaving the field: "Enter a reference." / "A reference is at most 80 characters." / "A card or account number can't go here. Use a receipt or transfer number."; server refusal of the reference shows here too)
    - **Cancel** — closes.
    - **Record** (primary, lock) — disabled offline ("Needs a connection: lessons work online only") or while invalid. Opens PIN prompt "Manager authorisation" / "Enter a manager PIN to record this handback.": **PIN** (4–6 digits, Enter submits), **Cancel**, **Authorise** → `app.lesson_blocked_refund_record` (idempotency key per amount+reference, device id) → toast "Handback recorded." Wrong/locked PIN shows in the PIN prompt; other errors close it and show in the dialog.
- **Try again** (read failed: "Lessons can't be shown without a connection").
- **View more ({count})** / **Show less**.

**Player reports queue** (opened in place under "Review reports"; `app.match_reports_open`, oldest first; 3 then View more)
- Row read-only: reason badge (Offensive name / Abusive behaviour / Harassment / Unsafe play / No-show / Other), "Reported {time}", reported player name or "Former player", phone, customer flag badges (hover shows the flag), "Reports in 90 days {n} · No-shows {n}", "Reported by {name}", match line (time · Open/Women/Men · status).
- **Open customer** → `/desk/customers/{id}` (when the player is known).
- **Open match** → `/desk/matches/{id}`.
- **Close report** — `app.resolve_match_report(outcome 'dismissed')` → toast "Report closed." Disabled offline ("Needs a connection: open matches work online only"). If someone already handled it (`REPORT_CLOSED` / `REPORT_NOT_FOUND`): error toast + list re-reads; other errors shown on the row.
- **Ban** (danger; only when the player is known and not already banned) — confirm "Ban {name} from open matches at every branch?" / "The reason recorded is: Reported by players."
  - **Cancel** — closes.
  - **Ban** — `app.resolve_match_report(outcome 'banned')` (chain-wide open-match ban) → toast "Banned from open matches." Same offline and refusal rules.
- **Try again** (read failed: "Open matches can't be shown without a connection").
- **View more ({count})** / **Show less**.

**On the floor now** (wide column) — read-only figures from `ops_overview`; no figure row is clickable.
- **Calendar** (header link of "Courts") → `/desk` (court desk calendar; Observe rail keeps a hidden row for it). Figures: Booked today, Arrived, Still to come, "Next up" ("{time} · {court} · {guest}" or "No more arrivals today").
- **Open tabs** (header link of "Café") → `/till/tabs`. Figures: Open tabs, Orders today.
- "Kitchen" group: Waiting, Being made — no link.

**Live floor** (3D plan, wide column under "On the floor now") — `useLiveFloor`: courts, reservations, tables, tabs, staff, stations, heartbeats, breaks; re-read every 30 s and on `floor` / `courts` broadcasts.
- Header: "Updated {time}" and connection pill (**Live / Connecting… / Disconnected**, hover "Connection") — read-only. (The "Bookings board" / "Tills board" buttons are OFF on this page.)
- Counts beside the plan (read-only): "Courts in play {n} of {total}", "Tables occupied {n} of {total}", "Staff at a station {n}", "On break {n}" (only when >0); note "Courts/Tables not on this plan {n} … The plan draws the venue as built…" when some are not drawn; legend (In play / occupied, Booked nobody there yet, Free, Customers, Tab open, Awaiting payment, Staff at a station, Staff on break).
- **Hover a court / table / room** — pointer cursor + tooltip: court name, status (In play / Booked, nobody there yet / Free), guest, "Until {time}", "{guest} has arrived, plays at {time}" or "Next guest has arrived, plays at {time}", "Next booking {time}"; table "Table {n}", Tab open / Awaiting payment / Free, guest, "Since {time}"; room (Reception, Vitamin bar, Kitchen, Office, Meeting room, Cafe floor) with each person: name, At a station / On break, "Covering for {name}" or "Station {station}", "Since {time}", or "Nobody here right now".
- **Click a court / table / room** (a press that moves ≤4 px) — camera flies close to it; "Show whole floor" appears. Nothing opens; no navigation.
- **Drag on the plan** — rotates (orbits) the view; pan is off; tilt is limited (cannot go under the floor). Shows "Show whole floor".
- **Mouse wheel / trackpad scroll over the plan (incl. its overlay buttons)** — zooms between closest and whole floor; the page does not scroll while the pointer is on the plan; Ctrl+wheel (pinch) is ignored by the plan.
- **Closer** (zoom-in icon button) — zooms one step in.
- **Zoom** (vertical slider) — drags the zoom from whole floor (bottom) to closest (top); keyboard arrows/Home/End work on it.
- **Further** (zoom-out icon button) — zooms one step out, never past the whole floor.
- **Show whole floor** (button, top start corner; only after the view has moved) — flies back to the whole-floor view and hides itself.
- **Full screen** (frame icon, top end corner) — plan fills the window; hint changes to "…Esc leaves full screen."
- **Exit full screen** (frame-exit icon, top row in full screen) / **Esc** — back to the inline plan.
- No-WebGL fallback: "This computer cannot draw the 3D plan. The counts above are still live." (no controls).
- **Try again** (floor read failed) — re-reads the floor snapshot.

**Who worked today** (wide column, last) — "What each person recorded today. A record of the shift, not a ranking."
- Table Name (truncated; hover shows the full name), Role, Orders, Bookings, Payments ("—" if not reported). No sorting, no row click.
- **View more ({count})** / **Show less** — 3 people, then the rest.
- Empty: "Nobody has recorded anything yet today."

**Before you close** (narrow column; only while a day is open) — status badge Ready to close / Open tabs left / Waiting to sync.
- Check 1 "Every tab is settled" or "{n} tabs are still open" + "Take the payment or void each one at the till."
  - **Table {n}** / guest name / tab label / "Reservation" (up to 3 buttons, receipt icon) → `/till?tab={tabId}`.
  - **+{n} more** → `/till/tabs` (when more than 3 tabs block).
- Check 2 "This station has sent everything" or "{n} changes waiting to send" + "They go as soon as this station is back online." (this station's offline queue) — read-only.
- **Go to Day close** (primary when ready, else default) → `/admin/day-close`. The page itself never closes the day.

**Stock to watch** (narrow column)
- **Stock** (header link) → `/stock`.
- **Below the level you keep** (row) → `/stock?filter=belowPar`.
- **Expiring soon** (row) → `/stock/expiry`.
- **Alerts to check** (row; only when the server reports the figure) → `/stock/alerts`.
- **Last stock count** (row; date-time or "Never") → `/stock/counts`.

**So far today** (narrow column)
- **Reports** (header link) → `/reports/courts`.
- **Audit log** (header link) → `/admin/audit`.
- **Discounts** (row; amount + "None/Once/Twice/{n} times") → `/admin/audit?q=discount.apply`.
- **Voided items** (row) → `/admin/audit?q=order_item.void`.
- **Refunds** (row) → `/admin/audit?q=payment.refund`.
- **Waste** (row; only when the server sends it) → `/admin/audit?q=stock.record_waste`.
- No-shows, Cancelled bookings — read-only rows, not clickable.

**Everything in Observe** (section cards; one link card per Observe rail row the viewer may open, rail order; each card = icon, name, description, optional live line)
- **Bookings** card → `/observation/courts`. "Which courts are in play and which are free, the night in two-hour rows, and a month shaded by how busy each day was." Live line "Booked today {n}".
- **Tills** card → `/observation/tills`. "Which tables are occupied, what the open tabs are carrying, and what was settled — day by day." Live line "Open tabs {n}".
- **Staff activity** card → `/reports/staff`. "Who worked, what they authorised and where the discretion was used."
- **Activity monitor** card → `/observation/activity`. Description renders the raw key `ws.owner.observationHome.cards.activityMonitor` (catalog entry missing).
- **Requests** card → `/observation/requests`. "Leave, shift swaps, advances and record corrections waiting on your confirmation."
- **Pay deductions** card → `/deductions`. "Proposals to take money off someone's pay…" Live line "Waiting {n}".
- **Protocols** card → `/protocols`. "New items, tournaments, hiring and price changes…" Live line "Waiting on you {n}".
- **Suggestions** card → `/suggestions`. "What the team suggests from the staff phone, signed, to read and mark seen." Live line "New {n}".
- **Incidents** card → `/incidents`. "Accidents, injuries, fights and damage reported by staff…" Live line "To review {n}".
- **Marketing** card → `/marketing`. "Campaigns, who they reached and what they returned." Live line "Live campaigns {n}".
- **Audit log** card → `/admin/audit`. "The full trail. Where you go when one of the screens above raises a question."

---

---

## Bookings — `/observation/courts`
A view-only reading of the courts: the night's figures, what each court is doing now, the night in two-hour rows, bookings that did not happen, and a month heat calendar; every change is a "go to Court desk" away.

*Who:* `owner` only (`/observation` prefix; `guarded('/observation/courts')`). Nothing on the page writes. The detail panel's go-button shows only when the station may enter the Court desk workspace (owner: yes). *Source:* `features/observation/courts/CourtsObserve.tsx`, `features/observation/ObserveDateBar.tsx`, `features/observation/DetailPanel.tsx`, `features/observation/observeLogic.ts`, `features/desk/calendar/MonthHeatCalendar.tsx`, `features/desk/calendar/ZoomStage.tsx`, `features/desk/useTradingNight.ts`.

**Header**
- Title "Bookings", subtitle "View only. Open a booking to act on it at the court desk."
- "Updated {time}" — read-only (reservations read; auto every 60 s and on the `courts` broadcast `slot_changed`).
- **Refresh** (ghost) — re-reads the night's reservations and the month counts.

**Date and zoom bar** (shared with Tills)
- **‹** (button; tooltip "Previous day (← key) (←)" in day view, "Previous month (←)" in month view) — one day / one month back.
- **Date** field (date input) — jump to any date.
- **›** (button; tooltip "Next day (→ key) (→)" / "Next month (→)") — one day / month forward.
- **Today** — back to tonight's trading date (at 00:40 that is still last night); disabled when already there.
- Weekday (day view) or "Month Year" (month view) — read-only label.
- **Month** (zoom-out icon; tooltip "Zoom out to the month (M)") — switches to the month heat calendar. In month view the same button reads **Day** (zoom-in icon; tooltip "Zoom back into the day (D)") and returns to the day.
- Keyboard: **←/→** move date (mirrored in Arabic), **D** day view, **M** month view. Ignored while typing in a field, with Cmd/Ctrl/Alt held, or while the detail panel is open.

**Day view — figures** (read-only tiles; day's own trading night)
- Booked ("{hours} h of court time"), Turned up, Still to come (today/future only), No-shows (red when >0), Cancelled, Court value booked ("Bookings that stand, at their booked price").

**Day view — Courts right now** (today only) — header "{inPlay} of {total} in play".
- **Court card** (busy court: In play / Held / Blocked / "In a lesson", "{guest or lesson} · until {time}") — opens the detail panel for that reservation.
- **Court card** (free court with a later booking: "Free", "{guest} · next at {time}") — opens the detail panel for that next booking.
- Cards without a target (nothing to open) are not clickable.
- **View more ({count})** / **Show less** — 3 cards, then the rest (busy first).
- "Free for the rest of the night: {court names} +{n} more" — read-only line.

**Day view — Schedule** (two-hour rows; legend Confirmed / Awaiting confirmation / Arrived / Played / No-show / Hold / Maintenance / Lesson; red now-line on today)
- Court column headers — hover shows the full court name.
- **Booking / lesson / hold / maintenance block** (button; label "{name} · {time range}") — opens the detail panel. Taller blocks also show status badge and price. Board scrolls sideways when there are many courts.
- Closed day: "The venue is closed on this day." (no blocks).

**Day view — Did not happen** (only when there are any) — "Cancelled, expired and no-show bookings for this day."
- **Row** (name or "Walk-in", court · time, status badge, chevron) — opens the detail panel.
- **View more ({count})** / **Show less**.

**Month view — heat calendar**
- **Day square** (each day of the grid incl. greyed days of neighbouring months; hover/label "{date} · {n} bookings" or "· Closed") — sets that date and zooms back to the day view.
- Legend "Fewer … More", "Shaded against the busiest day of the month.", "Busiest: {date} · {n} bookings" — read-only.
- **Try again** (month read failed).

**Detail panel** (side sheet; one booking; eyebrow "Booking" / "Maintenance block" / "Hold" / "Lesson")
- Content (read-only): title (guest/"Walk-in", maintenance note, "Hold", or lesson name), status badge or lesson badge + places chip (hover shows places), Court, Date, Time, Length "{n} min", Price and Phone (bookings), lesson "Places {taken} of {total}" and pay state, Notes, "Cafe tab" section (each linked tab: status + total or "Open — running total"; or "No cafe tab is charged to this booking.").
- Footer "View only. Changes are made in the workspace that does the work."
- **Open in Court desk** (primary) — switches the station to the Court desk workspace and opens `/desk/bookings/{id}` (booking) or `/desk` (hold / maintenance).
- **Open lesson** (primary; lesson rows) — switches to Court desk and opens `/desk/lessons/{lessonId}` (or `/desk/bookings/{id}` when the lesson id is not loaded yet, which forwards).
- **Close** (X button) / **Esc** / **click outside** — slides the panel shut; focus returns to what opened it. Tab is trapped inside the panel.

**Page states**
- **Try again** (day read failed: settings, courts or reservations) — re-reads all three.
- No active courts: "Nothing here yet."

---

---

## Tills — `/observation/tills`
A view-only reading of the cafe by business day: what open tabs carry, what was settled or voided, which tables are occupied, every tab of the day, and a month heat calendar; any change is a "go to Cashier" away.

*Who:* `owner` only (`/observation` prefix; `guarded('/observation/tills')`). No writes. The panel's go-button shows when the station may enter the Cashier workspace (owner: yes). *Source:* `features/observation/tills/TillsObserve.tsx`, `ObserveDateBar.tsx`, `DetailPanel.tsx`, `observeLogic.ts`, `features/desk/calendar/MonthHeatCalendar.tsx`.

**Header**
- Title "Tills", subtitle "View only. Open a tab to act on it at the till."
- "Updated {time}" — read-only (day's tabs re-read every 30 s and on the `floor` broadcast).
- **Refresh** (ghost) — re-reads the day's tabs, open tabs, waiter calls and month counts.

**Date and zoom bar** — same controls as Bookings: **‹**, **Date** field, **›**, **Today** (= the open session's business date; disabled when there), **Month** / **Day** zoom button, keys **←/→**, **D**, **M** (off while the panel is open or typing).

**Day view — figures** (read-only)
- On the floor (running total of open tabs; hint "Waiting to pay: {n}" or "Running total of the open tabs"), Settled ("Tabs settled: {n}"), Void, Waiter calls (today only; amber when >0; "Guests waiting for staff").

**Day view — Tables right now** (today only, when tables exist) — header "{occupied} of {total} occupied".
- **Table card** ("Table {n}", running total, tab age or "{n} tabs") — opens the detail panel for that table's FIRST open tab (other tabs at the same table are reached from the Open tabs list).
- **View more ({count})** / **Show less** — 3 occupied tables, then the rest.
- "No table is occupied." / "Free tables: {numbers} +{n} more" — read-only.

**Day view — Open tabs** (header count)
- **Tab row** (Tab name with "Awaiting payment" when so, court · guest; Source Till/Web order; Opened age + time; Total — grey while running) — opens the detail panel. Enter/Space on a focused row also opens it.
- **View more ({count})** / **Show less**.
- Empty: "No tab is open."

**Day view — Settled and void** (header count)
- **Tab row** (Tab, Status, Source, Opened, Closed, Total) — opens the detail panel (click or Enter/Space).
- **View more ({count})** / **Show less**.
- Empty: "No tab has been closed on this day."

**Month view — heat calendar**
- **Day square** ("{date} · {n} tabs") — picks that business day and zooms to the day view. (No "Closed" marking on this board.)
- **Try again** (month read failed).

**Detail panel** (side sheet; eyebrow "Tab")
- Content (read-only): tab name, status, Where, Source, Opened, Closed; "Items" (qty × item · variant, modifiers, "voided" struck through, line totals; or "Nothing has been ordered."); "Court booking" (court fee on this tab); "Totals" (Subtotal, Discount, Total, Paid; "Running total — the server stamps the final figure when the tab is settled."); "Payments" (Cash/Card amounts or "No payment yet.").
- **Try again** (tab detail read failed).
- **Open in Cashier** (primary) — switches the station to the Cashier workspace and opens `/till?tab={id}`.
- **Close** (X) / **Esc** / **click outside** — closes; focus returns.

**Page states**
- **Try again** (day's tabs read failed).

---

---

## Staff activity — `/reports/staff`
A per-person record of what each staff member recorded in a period and where discretion (discounts, voids, refunds) was used, listed by name and never ranked, plus day closes and till shifts.

*Who:* `manager`, `owner` (`ROUTE_ROLES['/reports']`; `guarded('/reports')`). Owner's Management rail shows it under Observe. Branch scope picker only for an owner with more than one branch or a closed branch. Report tabs strip: hidden for an owner inside Management (Observe owns only this report); shown in the Operations workspace (manager: Courts, Cafe, Staff activity; owner there: also Revenue). *Source:* `features/reports/StaffActivityReport.tsx`, `ReportParts.tsx`, `ReportFilterBar.tsx`, `ReportTabs.tsx`, `ReportBranchScope.tsx`, `DrillDialog.tsx`, `features/tillShift/ShiftReport.tsx`, `components/kit.tsx` (`DateRangeControl`, `ExportButton`).

**Above the page (reports layout)**
- **Branch** (segmented: rail branch name / **All branches** / **{name} (closed)** per closed branch) — owner only, multi-branch or closed branches. Changes the report scope (`x-venue-scope`) and re-reads every report query. "All branches" adds "All branches are shown on {name}'s clock and business day." Scope resets when leaving reports.

**Header**
- Eyebrow "Reports", title "Staff activity", subtitle = the period ("1 Oct 2026 – 16 Oct 2026" or one day).
- **Export** (button; hover "Downloads the table on screen, every row, as a spreadsheet file.") — downloads an .xlsx of the current breakdown, every row (not just the 3 shown), named `staff-activity_{from}_{to}_view-{view}[_staff-{id}]`; Discounts view adds count columns; Day closes and Till shifts export their own tables (Till shifts uses the already-loaded shift list). Disabled until the report has loaded with rows.
- **Report tabs** (Revenue / Courts / Cafe / Stock / Staff activity, only those allowed and in the current section; hidden when fewer than 2) — click navigates to `/reports/revenue|courts|cafe|stock|staff`; ←/→ (mirrored in Arabic), Home, End move between them.

**Filters**
- **Period** — preset select: Today, Yesterday, This week, Last week, This month (default), Last month, Last 30 days; "Custom" shows (not selectable) when dates were typed. Presets count from the venue's business day. Disabled during the first load.
- **From** / **To** (date fields) — edit a custom range.
- **Apply** (appears when From/To differ from the current period) — applies the range; disabled when From is after To.
- **Staff member** (select: **Everyone** + every staff account incl. removed people, from `app.list_staff`) — narrows the report (and the Till shifts view) to one person.

**Body**
- Info note: "What each person recorded, beside the days they were active. Listed by name, not ranked…"
- **Show** (segmented): **Activity** / **Discounts, voids & refunds** / **Waiter calls** / **Day closes** / **Till shifts** — switches the breakdown; a lead sentence under it explains each.
- "Click a row to see the transactions behind it." (Activity, Discounts, Waiter calls views).
- **Activity** table: Person (name, role, "Former staff" badge), Days active, Orders taken, Most in a day, Bookings made, Payments taken, Audit log. Not sortable.
- **Discounts, voids & refunds** table: Person, Days active, Discounts, Voids, Refunds (amount with "×{count}" under), Audit log.
- **Waiter calls** table: Person, Days active, Calls answered, Average time to answer, Audit log.
- **Person row** (click or Enter/Space; Activity, Discounts, Waiter calls views) — opens the drill dialog for that person over the period (`app.report_drill`, scope `staff:{id}`).
- **Audit log** (ghost button on each person row; label "Audit log for {name}") → `/admin/audit?actor={staffId}` (does not open the drill).
- **Day closes** table: Business day, Closed by, Cash difference ("Matched" in green, or amount: red when short, amber when over). Rows not clickable. Empty: "No day was closed in this period."
- **Till shifts** table (`app.till_shift_list`, max 62 days): Day, Person, Station, Time ("Since {time}" if open), Started with, Expected in the drawer, Counted, Difference (exact/short/over words, "Open", or "Ended with the day, not counted"). Not clickable, not sortable. Longer period: "Till shifts show for up to 62 days at a time. Pick a shorter period." Empty: "No till shifts in this period." **Try again** on read error.
- **View more ({count})** / **Show less** — every table shows 3 rows first.
- "Reading the table" notes (Activity: days active, most in a day; Discounts: "The small figure under an amount is how many times."; Day closes: cash difference meaning).
- Auto refresh every 120 s.

**Drill dialog** ("{person} · {range}")
- **Show** (segmented; Discounts view only): **Discounts** / **Voids** / **Refunds** — switches the transactions listed (`report_drill` with that figure and `p_key staff:{id}`).
- Table When / What (kind · description; hover shows full text) / By / Amount; "The latest 500 are listed." at the cap; empty "No transactions in this range."
- **Try again** (drill read failed).
- **Close** (footer) / X / Esc / click outside — closes.

**Page states**
- Loading skeleton; **Try again** on error ("This could not be loaded.").
- Empty report: "No staff to report on" / "No one has a staff account yet." with **Last 30 days** (or **Last month** when already on last 30 days) — switches the period.

---

---

## Activity monitor — `/observation/activity`
The owner's live board of who is using the operator and the mobile app right now: status, last seen, last action and current screen for each person, side by side per app, never ranked.

*Who:* `owner` only (`/observation` prefix; `guarded('/observation/activity')`; server `app.staff_activity_board` refuses anyone but owner with FORBIDDEN). No writes. *Source:* `features/observation/activity/ActivityMonitor.tsx`, `activityLogic.ts`.

**Header**
- Title "Activity monitor", subtitle "Who is using the operator and the mobile app now, when each person was last seen, and the last thing they did."
- "Updated {time}" — read-only. Board auto re-reads every 30 s and when the window regains focus; "x min ago" texts tick every 15 s on the server's clock.
- **Refresh** (ghost) — re-reads `app.staff_activity_board`.

**Summary and filter**
- "Online now: {n} on the operator, {n} on the mobile app." — read-only.
- **Show** (segmented): **Everyone** / **Online now** (online on either app) / **Not seen today** (not seen on either app this venue-day) — filters the rows client-side.
- Filtered to nothing: "Nothing matches those filters." with **Clear filters** — resets to Everyone.

**Table** (one row per person, server's name order; not sortable, rows not clickable)
- Person: name, role, "On break" badge.
- Operator / Mobile app cells: status badge Online / Away / Offline / Signed out / Never used — **hover** the badge shows "Device {device} · v{version}"; "Last seen {just now / n min ago / n hours ago / yesterday / n days ago}" — **hover** shows the exact date-time; last action in the Audit log's words "{action}, {time}" (or "No actions yet") — **hover** shows the exact date-time; "Screen: {rail name or path}" when online/away — **hover** shows the raw path.
- **Audit log** (ghost button per row; label "Audit log for {name}") → `/admin/audit?actor={staffId}`.
- **View more ({count})** / **Show less** — 3 people, then the rest.

**Page states**
- Loading; **Try again** on error.
- Empty: "No staff at this branch yet" / "People appear here once they are added on the Staff page."

---

## Requests — `/observation/requests`
This is where the owner answers the leave, shift-swap, wage-advance and record-correction requests that staff send from the phone. Each answer is final and the requester is told.

*Who:* the owner only. The route has no key of its own, so the `/observation` prefix applies (`ROUTE_ROLES['/observation'] = ['owner']`). A manager cannot open it and does not get the rail row. The server agrees: `app.decide_staff_request` raises FORBIDDEN unless the caller is the owner, and `app.staff_requests_page` lets management read the whole venue while everyone else reads only their own. The in-screen gate is `canDecide(row, staff.id)`: a row gets buttons only while it is pending and was not sent by the viewer. There is no CAPABILITY_ROLES entry. *Source:* `apps/operator/src/features/observation/StaffRequests.tsx`, `requestTypes.ts`, `routes/observation/_children.ts`. *Also reached from:* the "Waiting on you" row on the Observe overview (`/observation`), which opens here when anything is pending.

**Rail (Observe section)**
- **From the team** (dropdown title row): opens or folds the dropdown. It opens by itself while one of its pages is the current screen. Its rows are Requests, Pay deductions, Protocols, Suggestions and Incidents. While it is folded, the title row shows the sum of the row counts.
- **Requests** (bell icon, no count): goes to `/observation/requests`.

**Header**
- Title "Staff requests". Subtitle: "Leave, shift swaps, wage advances and record corrections your team has asked for." Neither is interactive.

**Toolbar**
- **Awaiting decision** segment (the default). Shows pending requests: `app.staff_requests_page(p_status:'pending', p_limit:200, p_offset:0)`. When anything is pending, an amber pill on the segment shows the venue's pending count, whichever segment is selected.
- **Decided** segment: the same RPC with `p_status:null`, filtered in the browser to rows that are not pending (approved, declined, withdrawn).
- **All** segment: the same RPC with `p_status:null`, every row.
- **"{shown} of {total}"** (read only, at the toolbar's end): appears only when the server holds more than the 200 rows loaded, and never on Decided.
- Auto-refresh: the list refetches every 60 s. There is no manual refresh control.

**List** (a table with columns Who, Asking for, Detail, Submitted, Status, and an actions column)
- The rows are read only and cannot be clicked. Who shows the name and role. Asking for shows Leave, Shift swap, Wage advance or Record correction. Detail shows "{from} to {to}", a single date, or the IQD amount for an advance, with the requester's note under it. Submitted shows a date. Status shows a badge (Awaiting decision, Approved, Declined or Withdrawn), "By {name} on {date}" and the decision note.
- **Approve** (row button, primary): opens the approve dialog. Shown only when the row is pending and was not sent by the viewer. Otherwise the cell is empty: nothing is shown disabled.
- **Decline** (row button, ghost): opens the decline dialog. Same conditions as Approve.
- **View more ({count})** / **Show less**: the list shows 3 rows, then this button unfolds the rest in place and folds them back. It appears only when more than 3 rows exist.
- Error state: "This could not be loaded.", the error text, and "You may be offline. The last known data is shown where available." **Try again** refetches the list.
- Empty state. Awaiting decision: "Nothing awaiting a decision" with "New requests from your team appear here." Decided and All: "No requests" with "When someone asks for leave, a swap, an advance or a correction, it lands here." Neither has a call to action.
- Loading: a table skeleton.

**Approve dialog** ("Approve this request?")
- Body: "{name} asked for {kind}. Approving is recorded against your name and cannot be undone."
- **Note (optional)**: a free-text box with no length limit in the form.
- **Approve**: calls `app.decide_staff_request(p_id, p_approve:true, p_note: the note or null)`. This is online only, a direct RPC with no queue and no PIN. On success it shows the toast "Request approved", closes, and refetches the queue. The server sends the requester a push (staff_decided / request_approved). Errors appear inside the dialog: REQUEST_NOT_PENDING ("That request has already been answered. Reload to see the decision."), REQUEST_NOT_FOUND ("That request no longer exists. Reload the queue."), CANNOT_DECIDE_OWN ("You cannot decide something you sent or that is about you."), and FORBIDDEN ("You do not have permission for that.").
- **Cancel**: closes and clears any error. It is disabled while the decision is sending.
- **X (Close)**, Esc, or a click on the backdrop: closes. This dialog does not set `dismissible`, so these still work while the decision is sending.

**Decline dialog** ("Decline this request?")
- Body: "{name} asked for {kind}. A declined request has to say why — the person will read this."
- **Reason for declining** (required): validated when the box loses focus and when Decline is pressed. Blank shows "A reason is required."
- **Decline** (red): blocked while the reason is blank. Otherwise it calls `app.decide_staff_request(p_approve:false, p_note: the reason)`. On success it shows the toast "Request declined" and sends the requester a push (request_rejected). The server errors are the same as Approve, plus REASON_REQUIRED.
- **Cancel**, **X (Close)**, Esc and the backdrop: as in the Approve dialog.

---

---

## Pay deductions — `/deductions`
This page is where a manager proposes taking money off someone's pay and where the owner, the only one who decides, approves, declines or cancels those deductions. It also shows what comes off each person's pay in a month.

*Who:* the manager and the owner (`ROUTE_ROLES['/deductions']`). Since 0345 the owner can block the page for a person through the `deductions` access area. Capability gates:
- `proposeDeductions` (head_barista, head_chef, manager, owner) shows the header button.
- `decideDeductions` (owner) turns the form into "Deduct from a wage", where the owner's entry is approved at once, and turns on the rail count.
- `cancelDeductions` (owner) controls Cancel in the Month tab.

Row buttons follow the server's flags `can_decide`, `can_withdraw` and `can_cancel`, which since 0272 are only ever true for the owner, except `can_withdraw`. A deduction against the viewer never appears.

*Source:* `features/deductions/DeductionsPage.tsx`, `DeductionsMonth.tsx`, `DeductionDialogs.tsx`, `ProposeDeduction.tsx`, `deductionsLogic.ts`, `api.ts`.

*Rail:* For the owner it is the **Pay deductions** row in Observe › From the team, with a count of the deductions the owner can decide. For the manager it is the **Pay deductions** row in the Run the day section, with no count. *Also reached from:* the **Pay deductions** link on Wages (`/wages`, owner), the Observe overview row "Deductions to decide" › "Decide deductions", and the matching row in /ops "Needs you now" (owner only).

**Header**
- Title "Pay deductions". The subtitle is a lead paragraph and is not interactive.
- **Propose a deduction** (manager) or **Deduct from a wage** (owner), a primary button with a + icon: opens the inline form under the header. The button is hidden while the form is open.

**Inline form.** The manager sees "Propose a deduction" with the lead "The owner approves it under Wages…". The owner sees "Deduct from a wage" with the lead "Recorded at once: it comes off their next unpaid wage. The person is told, and never who entered it."
- **Person** (required): a dropdown with the placeholder "Choose a person" ("Loading…" while it loads). Each option reads "{name} · {role}". The options come from `app.deduction_targets`: every active non-owner at the venue except the proposer. The dropdown is disabled when nobody qualifies, with the hint "There is nobody you can propose a deduction for." A load error is shown under it.
- **Amount** (required): a whole-number IQD box that takes digits only. A keystroke above 2,000,000 is rejected, and the formatted IQD shows beside the box. The hint is "{min} to {max}." (IQD 1 to IQD 2,000,000). Validation: "Enter an amount from {min} to {max}." Server: INVALID_AMOUNT ("Invalid amount.").
- **When it happened** (required): a native date box that defaults to the venue's business day. It is bounded from 60 days back up to today, with the hint "Within the last 60 days." Validation: "Pick a day within the last 60 days." The server hint `date` gives the same message.
- **Reason** (required): a textarea, at most 500 characters. The hint is "The person reads this once the deduction is approved." Validation: "Fill this in." or "Keep it to 500 characters." Server: TEXT_TOO_LONG ("That text is too long.").
- The validation messages appear only after the first Send press. Editing any field clears a server error.
- **Send for approval** (manager) or **Deduct from wage** (owner), the submit button. Pressing Enter in a field also submits. It calls `app.propose_deduction(p_staff_id, p_amount_iqd, p_date, p_reason, p_idempotency_key)`. The key is reused when the same proposal is retried and renewed by any edit. This is online only, with no PIN.
  - Manager: the deduction is created waiting, with the toast "Sent to the owner for approval." The owner gets a push (deduction_proposed, with the proposer's name).
  - Owner: the deduction is recorded approved into the person's first unpaid month, with the toast "Deduction recorded." The person gets a push (deduction_recorded, no amount), and the Wages reads refetch.
  - On success the form closes and the lists refetch.
  - FORBIDDEN with the hint staff_id shows "You cannot propose a deduction for this person. Choose someone from the list." Any other error is shown above the buttons.
- **Cancel** (ghost): closes the form and drops the draft. It is disabled while sending.

**Tabs** (a segmented control labelled "Show deductions")
- **Waiting** or **Waiting ({count})** (the default). The count is the waiting deductions the viewer can decide, so it is effectively owner only; a manager always sees plain "Waiting". It reads `app.deductions_page(p_filter:'waiting', p_limit:50, p_offset)`, which refetches every 60 s.
- **Month**: the month view (below).
- **All**: `app.deductions_page(p_filter:'all', …)`, which adds a Status column.

**Waiting and All list** (a table with columns Person, Amount, Happened, Reason, Proposed by, Status on All only, and an actions column)
- The rows are read only and cannot be clicked. Happened shows the date with "Counts in {month}", or, in amber with a clock icon, "Happened earlier, counts in {month}". Proposed by shows the name, role and proposal time. On All, Status shows the badge (Waiting, Approved, Declined, Withdrawn or Cancelled), "{name}, {time}" for whoever decided, "Note: {note}", "Cancelled by {name}, {time}" and "Reason: {reason}".
- **Approve** (row, primary, ✓): opens the Approve dialog. Shown when the row is waiting and `can_decide` is true, which only happens for the owner.
- **Decline** (row, ✗): opens the Decline dialog. Same condition as Approve.
- **Withdraw** (row, ghost, undo icon), under the muted line "You proposed this. The owner decides it.": opens the Withdraw confirm. Shown on a waiting row the viewer proposed (`can_withdraw`). In practice this is a manager's own proposal, because the owner's entries are approved at once.
- **"Waiting for the owner"**: a muted, non-interactive line on any other waiting row, which is what a manager sees on a head's proposal.
- **Cancel deduction** (row, ghost, ban icon): opens the Cancel dialog. Shown on an approved row with `can_cancel`: the owner, while that month's wage is not yet paid. It can appear on the All tab.
- **Previous page** / **Next page** (arrow buttons) with "Page {page} of {count}": shown only with more than 50 rows. Each arrow is disabled at its end.
- Error state: "This could not be loaded." with **Try again**.
- Empty Waiting: "Nothing waiting" with "When a head or a manager proposes a deduction, it waits here for the owner to decide." Empty All: "No deductions yet" with "Heads propose deductions from their phones. You can add one here too." Neither has a call-to-action button.

**Month tab**
- **Previous month** (‹, icon button): steps back a month and reads `app.deductions_month(p_month)`. It is disabled until the current month has loaded.
- **Next month** (›, icon button): steps forward. It is disabled at the current business month, so it never passes it.
- The month heading (for example "October 2026") is read only.
- **This month** (ghost): jumps back to the current month. Shown only when another month is displayed.
- Totals (read only): "Approved ({count})" with an IQD sum. In the current month only, "Waiting for the owner ({count})" with an IQD sum, shown when anything is waiting.
- Person row, a whole-row button: expands or folds that person's deductions (aria-expanded, chevron). The row shows the name, role, the badges "Left the team" and "Wage paid", the approved IQD with "{n} approved · {n} waiting", or "{n} waiting", or "Nothing approved".
  - Each expanded deduction shows the amount (struck through if cancelled), the date, "Happened in {month}" in amber when relevant, the reason, "Proposed by {name} · Approved by {name}, {time}", and a status badge.
  - **Cancel deduction** (ghost, per approved deduction): opens the Cancel dialog. Owner only (`cancelDeductions`), and only when the person's wage for that month is not paid.
  - Muted line "This month’s wage is paid, so its deductions can no longer be cancelled.": owner only, on a person whose wage is paid.
- Error state: the error text with **Try again** (refresh icon) to refetch.
- Empty state: "No deductions in {month}" with "A deduction counts in the person’s first unpaid month from the day it is approved."
- The current month refetches every 60 s. A month picked with the arrows does not auto-refresh.

**Approve dialog** ("Approve this deduction?"; owner)
- Body: "{amount} off {name}’s pay. It comes off their next unpaid wage, and {name} is told." The proposer's reason is quoted below.
- **Note** (optional): at most 1000 characters. The hint is "The person who proposed it reads this." Too long shows "That text is too long."
- **Approve deduction** (primary): calls `app.decide_deduction(p_id, p_approve:true, p_note)`. This is online only. It shows the toast "Deduction approved.", and the deduction and Wages lists refetch. Pushes go to the proposer (deduction_approved) and to the person (deduction_recorded, no amount). Errors appear inside the dialog: SUBMISSION_DECIDED ("This was already decided or withdrawn. Refresh to see the latest."), REF_NOT_FOUND ("The referenced record no longer exists."), CANNOT_DECIDE_OWN, and FORBIDDEN. A stale refusal refetches the list behind the dialog.
- **Cancel**, **X (Close)**, Esc and the backdrop: close the dialog. None of them work while it is sending.

**Decline dialog** ("Decline this deduction?"; owner)
- Body: "{amount} off {name}’s pay. {name} never sees a declined deduction." The proposer's reason is quoted.
- **Reason** (required): at most 1000 characters. The hint is "The person who proposed it reads this." Blank shows "A reason is required." after the press.
- **Decline deduction** (red): calls `app.decide_deduction(p_approve:false, p_note)`. It shows the toast "Deduction declined." and sends the proposer a push (deduction_declined). The errors are the same as Approve, plus REASON_REQUIRED.
- **Cancel**, **X (Close)**, Esc and the backdrop: as in the Approve dialog.

**Withdraw confirm** ("Withdraw your proposal?"; the proposer)
- Body: "{amount} off {name}’s pay. Nobody will decide it." The error, if any, is shown inside.
- **Withdraw proposal** (red, set apart from Keep it): calls `app.withdraw_deduction(p_id)`. This is online only and sends no push. It shows the toast "Proposal withdrawn." SUBMISSION_DECIDED shows its message and refetches. FORBIDDEN means the proposal is not the viewer's.
- **Keep it**, Esc and the backdrop: cancel and clear the error. There is no X.

**Cancel-deduction dialog** ("Cancel this deduction?"; owner)
- Body: "{amount} off {name}’s pay. It stays on record as cancelled and leaves every total. {name} sees it as cancelled."
- **Reason** (required): at most 1000 characters. The hint is "Kept with the deduction. The person does not see it." Validation: "A reason is required." or "That text is too long."
- **Cancel deduction** (red, set apart): calls `app.cancel_deduction(p_id, p_reason)`. This is online only and sends no push. It shows the toast "Deduction cancelled.", and the lists and Wages refetch.
  - WAGE_ALREADY_PAID shows "That month’s wage is already marked paid, so it can no longer change. Undo the payment first if it was a mistake." and the list refetches.
  - INVALID_TRANSITION shows "That status change is not allowed." and the list refetches.
  - The other errors are CANNOT_DECIDE_OWN and REASON_REQUIRED.
- **Keep it**, **X (Close)**, Esc and the backdrop: close the dialog. None of them work while it is sending.

---

---

## Protocols — `/protocols`

This is where management starts the four multi-step protocols (a new menu item, a tournament, a hiring, a price or promo change), works and decides the steps waiting on them, reads every run, and keeps an eye on the day's checklists and the heads' recipe-change requests.

*Who:* `ROUTE_ROLES['/protocols'] = ['manager', 'owner']` (longest-prefix match; a page the owner blocked on the Access list stays shut, 0345). Owner reaches it from Observe › **From the team ▾** › **Protocols** (rail row with the "waiting on you" count, `app.protocols_waiting_count`). The manager has it as a rail row of their own. Capability gates inside the screen (`CAPABILITY_ROLES`): `editProtocols` = owner (How it works, per-run checklist edits, add a step to one run); `editChecklists` = owner (write/edit/archive checklists); `decideRecipeChanges` = owner (approve/decline recipe changes; manager reads only); `publishTournaments` = manager + owner; `titleRunsInBoth` = owner (both title languages required); `decideSteps` = manager + owner and `decideOwnerOkSteps` = owner (used only to word forms; every step/run button follows the engine's `can` answer, and the RPCs check again). Nothing on this page is PIN-gated and nothing is queued offline: every write is a direct online RPC (`appRpc`, 15 s deadline) or one edge call, and each successful protocol write refreshes the whole `['protocols']` tree (cards, lists, open run/step, rail badge). Reads refetch every 60 s and on focus (no realtime).

*Source:* `apps/operator/src/features/protocols/` (ProtocolsPage.tsx, StartSheet.tsx, RunSheet.tsx, RunEdits.tsx, StepPanel.tsx, StepForm.tsx, StepContext.tsx, DecisionDialog.tsx, CandidatesPanel.tsx, RecordView.tsx, PhotoField.tsx, HowItWorks.tsx, search.ts, api.ts, protocolLogic.ts), `features/tournaments/start/TournamentStartSheet.tsx`, `features/tournaments/PublishDialog.tsx`, `features/checklists/{ChecklistsCard,ChecklistsSheet,ChecklistEditor,StaffPhoto}.tsx`, `features/roleExtras/{Ideas,RecipeChanges}.tsx`, field lists `packages/core/src/protocols/{steps,validate}.ts`, words `packages/i18n/src/catalogs/ws/protocols.en.ts`, `work.en.ts`, `opErrors.protocols.en.ts`.

**URL state (every sheet lives in the address; browser Back closes it)**
- **`?start=<kind>`** — opens the start form for `product_release | tournament | hiring | price_promo`. Extra prefills: `&variant=type1|type2|type3`; `&change=<one of 11 change kinds>` with `&item= | &addon= | &promotion= | &rule=` (links from the menu editor, Stock › Products, Add-ons, Promotions, Rates, hero builder) or `&lessonType=&coach=` (from Setup › Coaches); `&idea=<uuid>` (a team idea). Closing the form drops all of them.
- **`?run=<uuid>`** (optionally `&step=<uuid>`) — opens that run's sheet on that step (links from pushes, Goods in, /tasks, Staff, Desk › Block courts, etc.).
- **`?step=<uuid>`** alone — opens one step in its own dialog (StepSheet; same panel as in a run sheet).
- **`?filter=waiting|active|finished`** — which run list shows (default Waiting on you).
- **`?recipeChange=<uuid>`** — opens that recipe-change request.
- A malformed param is silently dropped (the plain page shows, never an error).

**Page header**
- Title **Protocols**, lead "Start a new item, a tournament, a hiring or a price change, and decide the steps waiting on you." (read-only).

**Protocol cards (four, one row): New item · Tournament · Hiring · Price or promo change**
Each card shows its lead line, "{count} running", "{count} waiting on you", and (if any) "{count} finished in the last 30 days" (`app.protocols_overview`; while loading "Loading…"). A failed overview read shows an error line under the cards (no retry button; it refetches every minute).
- **{count} waiting on you** (underlined link, only when count > 0) — switches the run list below to **Waiting on you** (`?filter=waiting`).
- **How it works** (settings icon; owner only, `editProtocols`) — opens the How it works sheet for that kind (see below). Disabled when the kind has no template at the venue.
- **Start** (play icon; screen readers "Start: {kind}") — opens the start form (`?start=<kind>`). Shown to manager and owner on all four cards.
- **{count} ideas from the team** (New item card only; spark icon; shown only while ideas wait, `app.release_ideas_to_review`) — with one idea it opens that idea's sheet directly; with more it opens the **Ideas from the team** dialog (see "Ideas from the team").

**Checklists card** (shared with day close; `app.checklist_day_state` + `app.checklist_board` for today, refetch 60 s)
- Read-only content: "{done} of {total} lists finished today" or "Every list is finished today."; up to 5 list rows (name, who, repeat, "Due {time}", "Overdue" tag, "{done} of {total}" / "Finished", progress bar); "+{count} more" (plain text, not clickable); "Unsaved changes" badge while an edit draft is held.
- **See today** — opens the Checklists sheet on its **Today** tab (manager and owner).
- **Edit the lists** (settings icon; owner only, `editChecklists`; hidden when there are no lists and no unsaved draft) — opens the sheet on **Edit the lists**.
- **Write a list** (empty-state button "No lists to tick today"; owner only) — opens the sheet on **Edit the lists**. Manager's empty state reads "The owner writes the lists…" with no button.
- **Try again** (refresh icon; only when the card's read failed) — refetches.
- (Staff tick lists on the phone; nothing is ticked here.)

**Recipe changes card** (`QK.recipeChangesWaiting`, refetch 60 s)
- Header badge "{count} waiting" (read-only). Empty: "No recipe change is waiting."
- **A waiting request row** ("{item} · {size}", "{name} asked, {time}", "Changed since it was sent" tag when stale) — opens that request's sheet (`?recipeChange=<id>`). Row is a button (Enter/Space).
- **View more ({count}) / Show less** — the card lists 3 then expands.
- **See every request** (arrow icon) — opens the **Recipe changes** list dialog.
- **Try again** (only on a failed read) — refetches.

**Run list (below the cards)** (`app.protocol_runs_page`, 25 per page, refetch 60 s)
- **Segmented filter: Waiting on you (with a count pill) · In progress · Finished** — switches the list (`?filter=`), resets to page 1. "Finished" = done, stopped or withdrawn.
- **Kind dropdown: Every kind · New item · Tournament · Hiring · Price or promo change** — filters by kind, resets to page 1 (not kept in the URL).
- **A run row** (columns Protocol [title + kind · type], Where it is [current steps · step status], Started by [name + date], Status [run status badge + "Waiting on you" badge]) — click, or Enter/Space on the focused row, opens the run sheet (`?run=<id>`). Long cells show their full text as a hover title.
- **Previous page / Next page** (chevrons; "Page {page} of {count}") — only when more than 25 runs.
- Empty states (no action): "Nothing is waiting on you", "Nothing in progress — Start one from the cards above.", "Nothing finished yet".
- Error state: "This could not be loaded." + "You may be offline…" + **Try again** (refetch).

---

### Start form — generic (New item, Hiring, Price or promo change)
Modal "Start: {kind}" (lead = the card's lead). Close: X, Esc, backdrop, or **Cancel** (all disabled while sending). RPC on Start: `app.start_protocol` (`p_kind`, titles, `p_first_record` = step 1's record, `p_photos`, `p_data` = `{idea_id}` from an idea, idempotency key). The form waits for the venue template read (Start disabled until then) so it knows who decides step 1.
- Info lines: "You decide this first step, so it passes as soon as you start." or "Starting sends this first step for a decision." (from the template's "Needs my OK" on step 1).
- From an idea: info banner "From {name}'s idea ({team}, {date}). Its photos come with it. Change anything before you start." (record and photos prefilled); if the idea is gone: "That idea is no longer waiting: it was started, declined or withdrawn."
- **What changes** dropdown (Price or promo only; shown when the person may pick more than one; manager and owner get all 11): Change item prices · Put a shop product on sale · Change add-on prices · Propose a promotion · Change a promotion · Switch a promotion on · Change or add a court rate · Change the featured-item discount · Change a lesson price · Put a lesson type on sale · Change a coach's lesson price. Switching re-prefills the target figures (keeps Why / What we expect).
- **Title (English)** / **Title (Arabic)** (max 140 typed, 120 counted). Owner: both required (TEXT_BOTH_LANGUAGES_REQUIRED "Fill in both English and Arabic."); manager: one is enough (TEXT_REQUIRED "Write something first."); over cap "That text is too long.". New item: both optional ("Left blank, it takes the name below.").
- Step-1 heading ("The proposal" / "The open position") and its record form — see the step forms below: New item › Proposal; Hiring › Open position; Price or promo › Proposal.
- **Photos** (New item only, 0–6) — see "Photos field".
- **Start** (play icon) — validates client-side first ("Check the marked fields." + per-field marks), then calls `start_protocol`. Success: toast "Started." or "Started. Your first step passed at once."; the form closes and the new run's sheet opens (`?run=<id>`); ideas list refreshes. Errors (shown under the form, a hinted field gets marked): RECORD_INVALID, TEXT_TOO_LONG, TEXT_REQUIRED, TEXT_BOTH_LANGUAGES_REQUIRED, PHOTO_PATH_INVALID, PROTOCOL_NOT_FOUND, PROTOCOL_NOT_READY, FORBIDDEN, PRICE_TARGET_CHANGED, idea errors (REF_NOT_FOUND, SUBMISSION_DECIDED).

### Start form — Tournament ("Start: Tournament" section sheet)
Large modal with a section menu (left) and the open section (right). Lead "Fill any section in any order." Close: **X** ("Close"), Esc, backdrop, or **Cancel** (on the first section); all disabled while sending. Same RPC `app.start_protocol` (`p_kind tournament`, `p_variant`, titles = the names, record = the plan). Title is the tournament name.
- **Section menu buttons** (jump to a section): Type · Name · Courts & time · Players & money (type 2: "Players") · Risks & notes (type 2: "Notes") · Sponsor (type 3 only). Each shows a tick when filled, its number, a note (type name, "A · Americano", "{n} slots", "Optional"), or "!" + "Needs a look" when flagged after a failed check. Progress box "{done} of {total} done".
- **Footer back button** (labelled with the previous section's name, or **Cancel** on the first) and **next button** (labelled with the next section's name); on the last section **Start the plan**.
- *Type* — three cards: **Type 1** (Club) "A club tournament: plan, feasibility with the owner's OK, marketing and courts."; **Type 2** (Community) "A community tournament: a short plan, and the manager decides."; **Type 3** (Sponsor or client) "For a sponsor or client: the sponsor's details are needed to start." Picking one clears flagged issues; type 2 drops Format and the money fields; type 3 adds Sponsor.
- *Name* — **Name in English** (required), **Name in Arabic** (required); **Class** radio cards: Class A (Advanced), Class B (Intermediate), Class C (Beginners); **Years played** radio cards: Less than a year / 1 to 3 years / More than 3 years (required, 0339); **Format** radio cards (type 1/3 only, required): Americano / Mexicano ("Runs in the app"), Knockout / League ("Plan only"). Radio groups: one Tab stop; Arrow keys (direction-aware), Home, End move and pick.
- *Courts & time* — **Previous day** (disabled on/before tonight's trading date) · **Day** date picker (no earlier than today) · **Next day**; legend Picked / Already booked; hint "Drag across the hours to pick a slot. Change the day to add another one."; **timeline grid** (courts × hours): press-and-drag across hours to pick, or starting on a picked hour to clear; Enter/Space toggles the focused hour; Arrow keys/Home/End move focus; booked hours are not pickable and show a hover card ("Already booked", booking kind · guest / block reason, time); past hours not pickable (a past pick can still be cleared). Closed day: "The venue is closed that day. Pick another day."; loading "Loading the courts…". **Picked slots** list: click a slot card → jumps the timeline to that day; **× (Remove {slot})** → removes the slot. Error "ranges" shown under the grid.
- *Players & money* — **Counted in** cards: Players ("Americano and Mexicano: each player enters alone.") / Pairs ("Knockout and league: a pair enters together."); **How many** (required, 2–512, digits only, Arabic digits folded); type 1/3 also **Expected entries**, **Entry fee**, **Prize, in words**, **Prize money**, **Budget** (all optional).
- *Risks & notes* — **Risks** (type 1/3), **Notes** (optional).
- *Sponsor* (type 3) — **Name** (required), **Contact** (required), **Contribution** (required), **Branding** (optional), checkbox **Needs an invoice**. Missing sponsor → SPONSOR_DETAILS_REQUIRED "Add the sponsor or client details before starting this tournament."
- **Start the plan** — validates (`validateStart`); on problems shows "Some sections need a look. They are marked in the menu." and jumps to the first flagged section; then `start_protocol`. Success: toast "Started." / "Started. Your first step passed at once." and the run sheet opens. Server refusal with a hint flags the section.

---

### Run sheet (`?run=`)
Modal (xl) titled with the run's title (or kind), status badge (In progress / Scheduled / Launched / Finished / Stopped / Withdrawn), subtitle kind · type · "Started by {name} on {date}". Close: X, Esc, backdrop. Load error: **Try again**. Dates line: "Goes ahead on {date}" (scheduled), "Launched on {date}", "Finished on {date}".
- **Publish as tournament** (trophy; done tournament runs, manager + owner `publishTournaments`) — opens Publish dialog (below).
- **Cancel the date** (undo icon; when `can.cancel_schedule`: a scheduled launch or apply, for whoever may act on the last step) — `app.cancel_schedule`, no confirm; toast "The date is cancelled. The last step is open again."
- **Withdraw this protocol** (when `can.withdraw_run`: the starter, before any decision incl. an automatic pass) — confirm "Withdraw this protocol?" / "Nobody has decided anything on it yet. It ends here and cannot be picked up again." → **Withdraw** (danger) or **Cancel**; `app.withdraw_protocol`; toast "Withdrawn." Errors FORBIDDEN, INVALID_TRANSITION.
- **Stop this protocol** (ban icon; when `can.stop`: management) — opens reason prompt "Stop this protocol?" ("Every step stops and nothing more happens. A new item that has not launched is removed. Everyone involved reads your reason."): **Reason** textarea (required "A reason is required.", ≤1000 "That text is too long.", hint "The person who sent it reads this.") → **Stop this protocol** (danger) or **Cancel**; `app.stop_protocol`; toast "Stopped."
- **Step list** (left, numbered): each step button shows name, step status (Not open yet / To do / Waiting for a decision / Done / Skipped / Stopped), "Round {n}" when >1, "Added by the owner" for owner-added steps. Click → shows that step on the right (`?step=`). Default step: the first open/sent one, else the last that moved.
- **Checklist ({count})** / **Add a checklist** (note icon; under the selected step; owner only, when `can.edit_items` and the step is not yet finished) — opens "Checklist: {step}" dialog (see "Per-run edits").
- **Add a step to this protocol** (plus; owner only, `can.add_step`, and only while there is a legal place: the last step still waiting) — opens "Add a step" dialog.
- Run-level errors show under the action row (mapped codes).
- New item runs also show under the step list (read-only): **Marketing's take** (`app.marketing_notes_for` on the run and on the item; "Marketing has not written anything on this yet."), after launch **Notes from the team** (`app.release_notes_for_item`; "No notes yet. Staff add them in the first 30 days after the launch.") and **Day-30 review** (`app.release_review`; "{units} sold on {days} days · {revenue} · margin {margin}%", written summary, "Written 30 days after the launch.", "Too few sales to say much yet.", "The summary could not be written…"). Note photos are thumbnails → photo viewer.

### Step panel (right side of a run sheet; also the `?step=` dialog "Step")
Header: step name, status badge, "Round {n}", "Needs the owner's OK", "Optional"; "For {name}" (assigned) or "Done by: {roles}"; decider line "The owner decides" / "A manager decides" / "Passes when the owner sends it"; "Opens after: {steps}" for a waiting step. Load error: **Try again**.
- **Context block** (read-only, server decides who may read; see each step).
- **Checklist** (when the step has lines): **checkbox per line** (the whole line is the label) — ticks/unticks via `app.tick_run_item` (enabled only when `can.tick` = may act on the open step; one tick in flight per line); shows "{name}, {date}" once ticked. Errors under the list (STEP_NOT_OPEN, NOT_STEP_ACTOR).
- **Your part** form (when `can.submit`: the assigned person, else a holder of the step's roles; a manager may cover any step whose doers are not the owner, the owner may cover any step) — notes: "Filled in from what was sent before. Change what needs changing." (resubmission prefilled from the last round incl. photos), "You are covering this step for {roles}.", "You decide this step, so it passes as soon as you send it." Then the step's fields (below), Photos where the step takes them, and the send button: **Send** (`app.submit_step`), **Launch now / Launch on a date** (New item launch, edge `protocol-action` action `launch`), **Apply now / Apply on a date** (price apply). Client validation first ("Check the marked fields."); success toast "Sent." or "Sent and passed: you decide this step."; errors under the form and on the hinted field (RECORD_INVALID "Missing or not valid.", TEXT_TOO_LONG "Too long.", STEP_NOT_OPEN, PROTOCOL_CLOSED, NOT_STEP_ACTOR, PHOTO_PATH_INVALID, UPLOAD_LIMIT, PRICE_TARGET_CHANGED and its lesson variants, RELEASE_NOT_READY, …).
- Two steps are sent from another screen (no form): see Tournament › Courts and Hiring › Add the staff member.
- "This step is for {roles}." (open step the viewer may not do) and "Sent. {decider}." (sent, waiting on someone else) — read-only.
- **What was sent** (history, by round): each submission card "{name}, {date}" + state (Waiting for a decision / Approved / Passed automatically / Sent back / Stopped / Withdrawn / Replaced), the record read back in words, photo thumbnails (click → viewer), decision line "{decision} by {name}, {date} · sent back to {step}", decision note, "Skipped by {name}: {note}", "Only managers and the owner see what was sent here." for hidden records. Read-only apart from photo viewing.
- **Decide** (check icon; when `can.decide_submission_id`: a decider of this step and never one's own submission) — opens the Decision dialog.
- **Withdraw what I sent** (undo; when `can.withdraw_submission_id`: your own undecided submission) — `app.withdraw_step`, no confirm; toast "Withdrawn. You can send it again." Errors FORBIDDEN, SUBMISSION_DECIDED.
- **Skip this step** (when `can.skip`: an optional step, by its decider) — reason prompt "Skip "{step}"?" ("This step is optional. The steps after it open without it."): **Reason** (required, ≤1000) → **Skip** or **Cancel**; `app.skip_step`; toast "Skipped." Errors STEP_NOT_OPTIONAL, STEP_CLOSED, NOT_DECIDER, REASON_REQUIRED.

### Decision dialog ("Decide: {step}")
"Sent by {name}, {date}." RPC `app.decide_step` (`p_decision`, `p_note`, `p_send_back_to`, `p_data`). Close: X/Esc/backdrop/**Cancel** (disabled while sending).
- **Your decision** segmented: **Approve** ("The step is done and the steps after it open.") · **Send back for changes** ("The work goes back with your reason, and the steps that follow it wait again.") · **Stop** ("The whole protocol stops. This cannot be undone.").
- **Menu category for the new item** dropdown (only approving a New item proposal; required; placeholder "Choose…"; hint "Its draft is filed here, switched off, until the launch."; prefilled with the proposer's choice) — "Missing or not valid." if empty.
- **Send it back to** dropdown (Send back, when more than one target: "{step} (this step)" or an earlier finished step; hint "This step, or a finished step before it.").
- **Note** (optional on Approve) / **Reason** (required on Send back and Stop; "A reason is required."; ≤1000 "That text is too long."); hint "The person who sent it reads this."
- "You approve or send back. The figures are not changed here." (approving New item price or Price/promo figures).
- **Approve** / **Send back** / **Stop the protocol** (danger) — sends; toast "Approved." / "Sent back." / "Stopped."; dialog closes. Errors: NOT_DECIDER, CANNOT_DECIDE_OWN, SUBMISSION_DECIDED "This was already decided or withdrawn. Refresh to see the latest.", SEND_BACK_TARGET_INVALID, REASON_REQUIRED, PROTOCOL_CLOSED, pass-hook codes (e.g. PRICE_TARGET_CHANGED, HIRE_ROLE_MISMATCH).

### Per-run edits (owner only, `editProtocols`; this run only — "Only this protocol. How it works stays as it is.")
- **Checklist: {step}** dialog (`app.edit_run_items`): per line **Line {n} (English)** / **Line {n} (Arabic)** inputs, **Move up / Move down**, **× Remove line {n}**; **Add a line** (max 12; "At most 12 lines."); "No lines." when empty. Validation on Save: "Fill in both English and Arabic.", "Too long." (200). **Save** → toast "The checklist is saved."; **Cancel**. Kept lines keep their ticks. Errors STEP_CLOSED, LIST_TOO_LONG, TEXT_BOTH_LANGUAGES_REQUIRED.
- **Add a step** dialog (`app.add_run_step`): **After** dropdown (hint "Only where nothing after it has started yet."; defaults to the last legal place), **Step name (English)** / **Step name (Arabic)** (both required, "Fill in both English and Arabic."), **Done by** role toggle buttons (Cashier, Waiter, Court desk, Shop assistant, Manager, Head barista, Barista, Assistant barista, Head chef, Chef assistant, Driver, Marketing; at least one, "Pick who does this step."; default Manager), switch **Needs my OK**, switch **Optional**, **Checklist** (same line editor). **Add the step** → toast "The step is added."; **Cancel**. Errors PROTOCOL_CLOSED, PROTOCOL_ORDER_INVALID, INVALID_ROLE, LIST_TOO_LONG.

---

### Step forms, by protocol and step (fields come from `@touch/core/protocols` stepForm; labels from `ws.protocols.fields`)
Common controls: text boxes; long-text areas; a choice of ≤4 options is a segmented control, more (or Role) is a dropdown with "Choose…"; money boxes (IQD); number boxes (digits only); date pickers; date-and-time pickers; time pickers; switches for yes/no; list editors with **Add** and **× Remove row {n}**; optional fields/groups marked "Optional". An optional group (hero line, ticker line, prize, limits, sponsor) only needs its members once used.

**New item (product_release)** — steps: Proposal → Test → Price → Marketing → Launch.
- *Proposal* (`propose`; done by Head barista / Head chef, started by management; photos 0–6 "proposals"; decided by a manager unless the template turns on the owner's OK):
  - **Name (English)** / **Name (Arabic)** (≤60; at least one required).
  - **Kind** segmented: Drink / Dessert / Food (required).
  - **Recipe** (hint "Pick what is stocked. Type what is not stocked yet."; 1–30 lines): per line **Ingredient** dropdown (stocked ingredients from `app.staff_ingredient_options`, plus **Not stocked yet (type it)**), when typed **Not stocked yet: what is it?** box, **Amount** (>0), **Unit** segmented g / ml / pieces, **× Remove row {n}**; **Add an ingredient**.
  - **Sizes** (1–4): **Size (English)** / **Size (Arabic)** (one of them), **Add**, **× Remove row {n}**.
  - **Who is it for?**, **Inspiration**, **A link** ("Starts with https://", ≤300), **Notes** (all optional).
  - **Menu category** dropdown (only when the sender decides this step, i.e. it passes at once; then required; hint "The draft item is filed here, switched off, until the launch.").
- *Test* (`test`; assigned to the run's starter; photos 1–6 required "tests"): context "The recipe to make" (each size's stocked lines, no cost; "No stocked ingredients on this size yet."). **Servings made** (hint "How many of each size you made. The ingredients come out of stock as a product test."): one **number box per size** (1–50; 0/blank drops it; at least one); **Notes**. ("The sizes show once the draft item exists." when none.)
- *Price* (`analysis`; manager; always needs the owner's OK): context "What each size costs to make" (management only; "Not known", "Not in stock yet, so not costed: {lines}"). **Prices** table (Size / Now / New price) with a **money box per size** (every size must be priced, >0); **Name (English)** / **Name (Arabic)** (required, ≤60); **Notes**.
- *Marketing* (`marketing`; Marketing role; owner's OK on by default; photos 0–6): **What to say about it (English)** (required, ≤300, hint "What makes it worth trying, in a sentence or two.") / **(Arabic)** (required); **Hero line** group: Hero line (English) / (Arabic) (≤80); **Ticker line** group: Ticker line (English) / (Arabic) (≤120); **Campaign** dropdown (No campaign + draft/scheduled/live campaigns; hidden when none readable); **Notes**.
- *Launch* (`launch`; the owner's own step, passes when sent): context "Ready to launch?" (management: Names in English and Arabic / A price for every size / A photo / A recipe / A menu category ✓/✗, warnings "No allergens noted", "Served hot or cold is not set", Ready / Not ready yet). **When** segmented Now / On a date; **Date and time** (only "On a date"; future, ≤90 days); **Menu photo** picker (hint "The photo the menu shows: one sent with the test or with marketing's step."): click a thumbnail **Use photo {n}** to choose it (required; "No photo was sent with the test or marketing's step. Send one there first."). **Launch now** / **Launch on a date** → edge function `protocol-action` (`action: launch`). Error RELEASE_NOT_READY "Not ready to launch: check names, prices, photo, recipe and category." A dated launch makes the run Scheduled (→ **Cancel the date** on the run sheet).

**Tournament** — Type 1/3: Plan → Feasibility → Marketing (optional) → Courts → Ready check; Type 2: Plan → Marketing (optional) → Courts → Ready check, every OK off.
- *Plan* (`plan`; manager or court desk, assigned to the starter; started via the tournament start sheet; when sent back it is re-sent with the generic form): **Class** segmented A/B/C; **Years played** segmented (Less than a year / 1 to 3 years / More than 3 years); **Name (English)** / **Name (Arabic)** (required); **Format** segmented Americano/Mexicano/Knockout/League (type 1/3, required); **Courts and times** (hint "When and where the courts are blocked for the tournament."; 1–14 rows): per row **court chips** (toggle each court), **From** / **To** date-and-time (To after From), **× Remove row {n}**; **Add courts and times**; **Capacity** group: **Counted in** Players/Pairs, **How many** (2–512); type 1/3 also **Entry fee**, **Prize** group (**What they win**, **Prize money**), **Budget**, **Expected entries**, **Risks**, **Notes**, **Sponsor or client** group (hint "Needed for a type 3 tournament."): Name, Contact, Contribution (required within), Branding, switch **Needs an invoice**. Type 3 without sponsor → SPONSOR_DETAILS_REQUIRED.
- *Feasibility* (`feasibility`; manager; owner's OK on): context "Bookings in the way" ("{court}, {when}: {bookings} bookings, {guests} guests[, {lessons} lessons, {students} students]"; "The plan names no courts yet."). **Staffing** (required), **Expected income** (required), **Expected cost** (required), **Risks** (required), **Notes**.
- *Marketing* (`marketing`; Marketing role; optional → **Skip this step** by its decider; photos 0–6): context "The plan: {name}" (class · format · capacity, court ranges, "Blocks made so far: {count}"); same fields as New item › Marketing.
- *Courts* (`courts`; court desk; a manager or the owner may cover): context "The plan: {name}". No form: "The courts are blocked on the desk calendar, and this step is sent from there with the blocks." + **Block the courts** (arrow) → navigates to `/desk/block?run=<run>&step=<step>` (the desk sends the step with the blocks). Disabled with "Only the court desk and management open the desk." for anyone who cannot open `/desk`.
- *Ready check* (`ready`; manager; last step; photos 0–6 "steps"): **Notes**.
- After the run is done: **Publish as tournament** (run sheet).

**Hiring** — Open position → Interviews → Add the staff member.
- *Open position* (`open_position`; manager; owner's OK on → a manager's start waits for the owner, the owner's passes at once): **Role** dropdown (Cashier, Waiter, Court desk, Shop assistant, Manager, Head barista, Barista, Assistant barista, Head chef, Chef assistant, Driver, Marketing; required); **Why we need someone** (required, hint "What is not getting done today."); **Days and hours** (required, ≤300, hint "The days and hours of the job."); **Start date** (required); **Pay from** / **Pay up to** (optional).
- *Interviews* (`interviews`; manager; owner's OK on): **Candidates** panel (management only; "Names and phone numbers stay here and are deleted 90 days after the decision. The step itself keeps no name."; after the purge "The candidates were deleted 90 days after the decision."). Editable while the viewer may send the step:
  - **Pick** (check icon, on an unpicked candidate) — `app.save_hiring_candidate` with picked = true (shows "Picked" badge).
  - **Remove** (trash) — `app.delete_hiring_candidate` (no confirm).
  - **Add a candidate** form: **Name** (required, ≤80), **Phone** (required, ≤32), **Interview** date-and-time (optional), **Notes** (optional, hint "What stood out. No personal details beyond the job.") → **Add candidate** (`app.save_hiring_candidate`, new id); "Missing or not valid." on empty name/phone. Errors CANDIDATE_NOT_FOUND etc.
  - The form has no typed fields; status line "Sends {count} candidates, with {name} picked…" / "Add the candidates you interviewed, then pick one." / "Pick the candidate you want to hire first." **Send** is disabled (with that reason as tooltip) until a candidate is picked; sends `{candidate_ids, picked_id}` via `app.submit_step`.
- *Add the staff member* (`add_staff`; the owner's own step): no form: "Add the new person on the Staff page. The form opens filled in from this hiring, and the step is sent with the new account." + **Add the staff member** (arrow) → `/admin/staff?hire=<step>`. Disabled for non-owners with "Only the owner adds staff." Error HIRE_ROLE_MISMATCH lands there.

**Price or promo change (price_promo)** — Proposal → Figures (`numbers`) → Announce (optional) → Apply.
- *Proposal* (`propose`; manager or Marketing; passes at once for management unless the template turns on the owner's OK). Target fields first, then **Why** (required) and **What we expect** (required, hint "What should change, and how we will know."). **What changes** is fixed once started (dropdown disabled on resubmission). By change kind:
  - *Change item prices*: **Item** dropdown (items; shop ones "· Shop"; picking one fills today's prices); **Prices** table (hint "Change only the sizes whose price changes."; Size / Now / New price) with a money box per size and per row **Rename** / **Keep the name** → inline **New name (English)** / **New name (Arabic)** (hint "A new name keeps this size's recipe and, unless you change it here, its price."); **New sizes** list (New size (English) / (Arabic), Price; max 4; Add / × Remove row); at least one price, new size or rename. "Pick the item first." until an item is chosen.
  - *Put a shop product on sale*: **Item**; **Prices** (every size, ≥1).
  - *Change add-on prices*: **Add-ons** table: a checkbox per add-on ("{group} · {name}") to include it, Now, **New price** money box (when ticked), **Rename / Keep the name** for add-ons on sale (hint "A new name keeps this option's price unless you change it here."); at least one price or rename.
  - *Propose a promotion*: **Promotion** group: Promotion name (English)/(Arabic) (required); **Discount** segmented Percent off / Amount off; **Discount value** (≥1; percent ≤99); **Starts** / **Ends** (Ends after Starts); **Days** weekday toggles Sun–Sat (none = every day); **From** / **To** hours (both or neither, not equal); **Applies to** (hint "Nothing picked: it applies to everything."): chip pickers **Courts**, **Menu categories**, **Items**; **Limits** group: Uses in total, Uses per guest, Minimum spend; switch **Applies by itself**; **Code** (hint "4 to 16 letters or digits. Leave it blank for a promotion that applies by itself.") with **Make a code** (refresh icon, fills a random code); switch **Each code works once**.
  - *Change a promotion*: **Promotion** dropdown (existing; "· off" when disabled; picking prefills) + the same Promotion group.
  - *Switch a promotion on*: **Promotion** dropdown only.
  - *Change or add a court rate*: **Court rate** dropdown (optional; "A new court rate" or an existing rule "· court · off"; picking prefills) + **Court rate** group: **Name** (required), **Court** dropdown (Every court / a court), **Days** weekday toggles (≥1), **From** / **To** times (To after From), **Prices by booking length** (rows "{n} min" + money box + "Remove {n} min"; new row: **Length in minutes** box + **Add a length** (enabled for 15–480 in steps of 5, not already present; max 12); hint "A price for each booking length, 15 to 480 minutes in steps of 5."), **Priority**, **Valid from**, **Valid until**, switch **Switched on**.
  - *Change the featured-item discount*: **Item**; **Discount (%)** (0–99, hint "0 switches the discount off.").
  - *Change a lesson price*: **Lesson type** dropdown ("{name} · {kind} {length}", "· off"); **Price**; **Court share per session**; line "Now: price {price} · court share {share}"; at least one figure.
  - *Put a lesson type on sale*: **Lesson type** (drafts, "· Draft"); **Price** and **Court share per session** required.
  - *Change a coach's lesson price*: **Coach** dropdown; **Lesson type** (the coach's types; "Pick the coach first." until then); **Price**; line "Now: price {price}" / "Now: the lesson type's price, {price}" and hint "Left empty, the coach's own price is removed and the lesson type's price applies."
  - "Nothing can be changed this way right now." when a target list is empty.
- *Figures* (`numbers`; manager; always needs the owner's OK): context "The figures" (management only: per size Now / New / Cost / Margin now / Margin after / Sold (30 days), add-ons, "New names" renames with prices, promotion / rate / featured / lesson lines, basis note). **Recommendation** segmented Go ahead / Change the figures / Drop it (required). Only with "Change the figures": the proposal's own figure fields (prices table incl. new sizes; add-on table (fixed rows); **Discount value**; **Prices by booking length**; **Discount (%)**; lesson **Price** / **Court share per session** — only those the proposal carries). **Note**.
- *Announce* (`announce`; Marketing; optional → can be skipped by its decider; photos 0–6): **Campaign** dropdown (No campaign / campaigns), **Hero line** group, **Ticker line** group, **Notes**.
- *Apply* (`apply`; manager; last): context "The figures". **When** Now / On a date; **Date and time** (on a date; future). **Apply now** / **Apply on a date** (`app.submit_step`). PRICE_TARGET_CHANGED "This change no longer matches what was approved… Start a new change." (lesson variants: "This lesson type changed after the proposal…", "This coach's price or lessons changed after the proposal…"). A dated apply makes the run Scheduled (→ **Cancel the date**).

**Owner-added step (any protocol)** — done by the roles the owner chose: **Note** (optional) and Photos 0–6 ("steps"); **Send**.

### Photos field (start form and step forms)
- Count line "{count} of up to {max}" or "{count} · {min} to {max} needed" (red when invalid).
- **Add photos** (plus) — opens the file picker (JPG/PNG/WebP, several at once, up to the room left); each file is re-encoded to WebP (location data dropped), a slot is minted (`app.staff_media_slot`) and it uploads to the private `staff-media` bucket; button reads "Uploading…" meanwhile. Errors: "Only JPG, PNG or WebP photos.", "That photo is too big, even after shrinking it.", upload errors.
- **Thumbnail (Open photo {n})** — opens the photo viewer.
- **× Remove photo {n}** — drops it from the form (not from storage).
- Photo viewer (any thumbnail on the page: history, notes, ideas): modal with the photo large; **clicking the photo opens it in a new browser tab** (10-minute signed link); close X/Esc/backdrop. Thumbnail tooltip "This photo could not be opened." on failure.

### How it works (owner only; template editor per kind)
Modal "How it works: {kind}" ("The steps every new one follows. Running protocols keep the steps they started with.").
- **Tournament type segmented: Type 1 / Type 2 (community) / Type 3 (sponsor or client)** (tournament only) — switches template; each type's draft is kept while the sheet is open.
- "Last saved by {name}, {date} (version {n})"; "Unsaved changes" badge.
- **Name (English)** / **Name (Arabic)** (required, ≤120).
- Per step card "{n}. {name}" with badge Built in / Your step, "Always first" / "Always last":
  - **Move up / Move down** — only where the order rules still hold (first first, last last, after what it depends on).
  - **Remove step {n}** (trash; own steps only).
  - **Step name (English)** / **Step name (Arabic)** (required, ≤120).
  - Built-in: "Done by {roles} · Optional" (fixed). Own step: **Done by** role toggles (12 hireable roles; ≥1, "Pick who does this step.").
  - Switch **Needs my OK** — or fixed text "Always needs your OK" (price steps) / "You do this step" (owner's own steps).
  - Switch **Optional** (own steps; "An optional step can be skipped, with a reason.").
  - **Checklist ({count})** expand/collapse — line editor (Line {n} (English)/(Arabic), Move up/down, × Remove line {n}, **Add a line**, max 12, "That list is too long.").
- **Add a step of your own** (inserted above the last step; max 20 "At most 20 steps.").
- **Discard changes** (when dirty) — back to the saved version.
- **Save** (check; disabled with "Nothing has changed yet." when clean) — validates ("Check the marked fields.", "That order is not possible…"), then confirm "Save how it works?" / "Running protocols keep their steps. New ones use this." → **Save** or **Cancel**; `app.save_protocol_template` (expected version); toast "Saved. New protocols use it." Errors TEMPLATE_CHANGED (then **Load the latest** reloads the template), PROTOCOL_STEP_FIXED, PROTOCOL_ORDER_INVALID, INVALID_ROLE, LIST_TOO_LONG, TEXT_BOTH_LANGUAGES_REQUIRED.
- Closing with unsaved changes (X/Esc/backdrop) → confirm "Leave without saving?" / "Your changes to how it works are not saved yet." → **Leave without saving** (danger) or **Cancel**.
- Load error **Try again**; "This protocol has no template at this venue."

### Publish as tournament (done tournament run; manager + owner)
Modal "Publish the tournament" ("Guests can register in the app once it is published. The name, fee and courts come from the plan."). Read-only facts: Name · class · years, Entry fee ("Set in the plan. It can't change once published."), Players "Up to {count} players", Courts. Blockers (Publish disabled): "The plan counts pairs…", "The plan has room for fewer than 4 players.", "Americano and Mexicano are the formats a tournament plays."
- **Format** segmented Americano / Mexicano (the plan's own format is fixed for type 1/3; type 2 picks).
- **Who may enter** segmented Open / Women / Men.
- **Points per game** (8–64; "Both sides together score exactly this many points.").
- **Rounds** (Mexicano only, 1–30).
- **Minimum players** (4–plan capacity); **Waitlist places** (0–64).
- **Registration closes** date + time (not past, before the first court block).
- **Prize (English)** / **Prize (Arabic)** (≤200).
- **Publish** — `app.tournament_publish`; disabled offline ("Tournament changes need a connection."); errors per field ("Fill this in.", "Between {min} and {max}.", …) and refusals (fee_not_approved, already_published, no_blocks, settings). Success: "Tournament published." with "{count} planned windows have no court block…" and **Open tournament** (→ `/desk/tournaments/<id>`) or **Close**. **Cancel** closes.

---

### Ideas from the team (New item card)
- **Ideas from the team** dialog (more than one idea): idea rows ("{name}" or "Untitled idea", "{author}, {team}, {time}", photo-count pill) — click a row → the idea's sheet in its place. Close X/Esc/backdrop.
- **Idea sheet** (title = idea name): details (Kind, Sizes, Who it is for, Inspiration, **Link** (opens in a new tab), Notes), Recipe lines, photo thumbnails (any → viewer of all photos), "Starting it carries these photos into the proposal."
  - **Close** — back to the list (if others wait) or closed.
  - **Decline** (x) — shows **Why it is declined** textarea (required, ≤1000, "Its author reads this.") with **Back** and **Decline the idea** (danger; disabled while empty) → `app.decline_release_idea`; toast "Declined. Its author will see why."
  - **Start as a new item** (plus) — closes and opens the New item start form prefilled from the idea (`?start=product_release&idea=<id>`); the start sends `p_data = {idea_id}`.

### Recipe changes (card, list dialog and request sheet)
- **Recipe changes** list dialog: **Show requests** segmented Waiting / Decided / All (`app.recipe_changes_page`, 100); rows ("{item} · {size}", "{name} asked, {time}", status Waiting for the owner / Approved / Declined / Withdrawn) → open the request sheet. Empty: "No recipe change is waiting" / "None decided yet" / "No recipe changes yet". Error **Try again**.
- **Request sheet** (title item · size, status badge): "{name} asked, {time} · A menu item's recipe / A prepared item's recipe"; stale warning "This recipe was changed after the request was sent, so approving it would undo that change. Decline it and ask for a new request."; "Their note"; table Ingredient / Now / After the change with Same/Changed/Added/Removed tags; decided line and decline reason.
  - Owner only (`decideRecipeChanges`) on a waiting request: **Close**; **Decline** (x) → **Why it is declined** (required, ≤1000, "The head who asked reads this.") with **Back** / **Decline the request** (danger; disabled while empty) → `app.decide_recipe_change` (approve = false); **Approve** (check; disabled when stale) → `app.decide_recipe_change` (approve = true; writes the recipe). Toasts "Approved. The recipe now reads as the request asked." / "Declined." Error RECIPE_CHANGED "The recipe changed after this request was sent. Ask for a new change."
  - Manager: no buttons; "Only the owner approves or declines a recipe change."
  - Close X/Esc/backdrop clears `?recipeChange=`.

### Checklists sheet (from the Checklists card)
Modal "Checklists"; owner sees tabs **Today** / **Edit the lists**; manager sees Today only. Load error **Try again**.
- *Today* (read-only; "Each list shows who it is for and who ticked each line, and when. Lists are ticked on the phone."): per list name + plan summary; per copy whose / "Due {time}" / Overdue / "{done} of {total}" or Finished; each line ✓ with "{name} · {time}", "Needs a photo", the line's note. "No copy of this list is open today." / "No lists yet."
  - **Photo thumbnail (See the photo: {line} / Hide the photo: {line})** — expands/collapses the ticked line's photo under it (one at a time); the expanded photo is a link that opens it in a new tab.
- *Edit the lists* (owner):
  - **New list** (plus; "· Unsaved changes" when a new draft waits) — opens a blank editor.
  - **A list button** (name, who, repeat or "Unsaved changes") — opens that list in the editor. Drafts of every list are kept while the page is open.
  - Editor: **Name (English)** / **Name (Arabic)** (required, ≤120; "Write it in both English and Arabic.", "At most {max} characters.").
  - **Who does it** segmented A role / Named people. A role: **Role** dropdown ("Choose a role"; 12 hireable roles + Owner; "Choose a role.") and switch **Everyone does their own copy** ("Off: one shared list that anyone in the role can tick."). Named people: **People** pick list with checkboxes (search box "Search by name" from 7 people; "Nobody matches."; "Chosen: {count}"; people who left marked "No longer at this branch"; "Choose at least one person.", "At most 50 people."); away warning "No longer at this branch: {names}. Take them off to save." + **Take them off**. Staff list from `app.checklist_staff_options`.
  - **Repeats** segmented Every day / Chosen weekdays / Once a month / Twice a month; weekday toggles Sunday…Saturday ("Choose at least one day."); **Date** / **Date 1** / **Date 2** dropdowns (1–28, Last day; "Choose two different dates."; hint on month repeats).
  - **Due** segmented Before opening / Before closing / By a set time; **Time** (by a set time; "Enter a time.").
  - **Lines** ("{count} of 30", "Needs a photo: {count}"): per line **Line {n}, English** / **Line {n}, Arabic**, switch **Needs a photo**, **Move up / Move down**, **× Remove line {n}**; **Add a line** (max 30; "A list holds at most 30 lines."). Summary sentence; "This list already has a copy open, so that copy keeps its old lines…" when applicable.
  - **Archive the list** (saved lists) → confirm "Archive "{name}"?" / "It goes off every phone at once, copies open today included…" → **Archive the list** (danger) or **Cancel**; `app.archive_checklist`; toast "List archived."
  - **Discard changes** (when dirty).
  - **Save the list** (check; disabled "Nothing has changed yet." when clean) — "Fix the boxes marked in red first." on invalid; `app.save_checklist` (expected version); toast "List saved." Errors TEMPLATE_CHANGED (→ **Load the latest**), ASSIGNEE_NOT_AT_BRANCH, CHECKLIST_NOT_FOUND.

### Global behaviours on this page
- Every dialog closes with its X ("Close"), Esc or a backdrop click (not while a write is in flight).
- Buttons with a disabled reason show it as a tooltip on hover/focus (e.g. interviews Send, How it works Save, Block the courts, Add the staff member, Publish offline).
- Toasts confirm every successful write; refusals use the shared error catalogue (`op.errors.<CODE>`), e.g. PROTOCOL_CLOSED "This protocol is finished or stopped, so it cannot change.", STEP_NOT_OPEN "This step is not open yet.", NOT_STEP_ACTOR "This step is for someone else.", NOT_DECIDER "Someone else decides this step.", UPLOAD_LIMIT "Too many photos in a short time. Try again in a few minutes."

---

## Suggestions — `/suggestions`
This page is the staff suggestion box. Staff post signed suggestions from the phone, and management reads them here and marks them seen, which the author can see.

*Who:* the manager and the owner (`ROUTE_ROLES['/suggestions']`). The page can be blocked per person through the `suggestions` access area (0345). There is no capability gate inside the page, so the owner and the manager see the same screen. The server checks are `app.suggestions_page` and `app.mark_suggestion_seen`, both management at the venue. There is no reply, no photo and no push. *Source:* `features/roleExtras/SuggestionsPage.tsx`, `roleExtrasLogic.ts`, `api.ts`, `keys.ts`.

*Rail:* For the owner it is the **Suggestions** row in Observe › From the team. For the manager it is the **Suggestions** row in Run the day. Both rows carry the count of new suggestions. *Also reached from:* the Observe overview row "New suggestions from staff" › "Read suggestions".

**Header**
- Title "Suggestions". Subtitle: "Sent from the staff phone and signed, so you can follow one up. Marking one seen tells its author." Neither is interactive.

**Filter** (a segmented control labelled "Show suggestions"; changing it resets to page 1)
- **New** or **New ({count})** (the default): `app.suggestions_page(p_filter:'new', p_limit:50, p_offset)`.
- **Seen**: `p_filter:'seen'`.
- **All**: `p_filter:'all'`.
- Every list refetches every 60 s.

**List** (one card per suggestion: the author's name, or "Someone no longer on staff", the role, the date and time, and the body as typed)
- **Mark as seen** (✓, per card): calls `app.mark_suggestion_seen(p_id)`. This is online only. It shows the toast "Marked as seen." and refetches every suggestions read, including the rail count. The button shows a spinner on that card while it works. Shown on New and on All for cards not yet seen. On All, such a card also carries the amber badge "Not seen yet". A failure is shown above the list (REF_NOT_FOUND or FORBIDDEN). Marking again keeps the first mark, and it is not audited.
- A seen card shows a green badge with "Seen by {name}, {time}" or "Seen {time}". The badge is read only and the card has no button.
- **Previous page** / **Next page** with "Page {page} of {count}": shown only with more than 50 suggestions.
- Error state: "This could not be loaded." with **Try again**.
- Empty states. New: "No new suggestions" with "Staff post suggestions from the phone. The new ones land here." Seen: "None marked seen yet." All: "No suggestions yet."

---

---

## Incidents — `/incidents`
This page is where accidents, injuries, fights and damage are reported and reviewed. Management reviews every report with a note the reporter reads, and the owner can redact one. At the desk and the till the same route is the person's own "My reports" page.

*Who:* court_desk, cashier, manager and owner (`ROUTE_ROLES['/incidents']`). The page can be blocked per person through the `incidents` access area (0345). Which page loads depends on `can(staff,'reviewIncidents')`: the manager and the owner get the **review queue**, and the court desk and the cashier get **My reports**. Capability gates:
- `reportIncidents` (court_desk, cashier, manager, owner): "Report an incident".
- `reviewIncidents` (manager, owner): the queue and the rail count.
- `redactIncidents` (owner): Redact. The row's `can_redact` also controls it.

Row buttons follow the server's `can_review` (management, never on their own report) and `can_redact` (owner).

*Source:* `features/incidents/IncidentsPage.tsx`, `IncidentSheet.tsx`, `MyIncidentModal.tsx`, `ReportIncidentForm.tsx`, `incidentsLogic.ts`, `api.ts`, `features/tasks/PhotoField.tsx`, `features/checklists/StaffPhoto.tsx`.

*Rail:*
- Owner: the **Incidents** row in Observe › From the team.
- Manager: the **Incidents** row in Run the day.
- Desk and till: the **Incidents** row on their own rail.
- Only management's row carries a count (open reports the viewer can review).

*Also reached from:* the Observe overview and /ops rows "Incidents to review" › "Review incidents", and the "Go there" link in the desk and till workspace guides.

### Management view (manager, owner): the review queue
**Header**
- Title "Incidents". Subtitle: "Reports from the desk, the till and staff phones. Review each one with a note the reporter reads."
- **Report an incident** (primary, +): opens the report dialog (see "Report an incident dialog" below).

**Filter** (a segmented control labelled "Show reports"; changing it resets to page 1)
- **To review** or **To review ({count})** (the default): `app.incidents_page(p_filter:'open', p_limit:50, p_offset)`, oldest first. The count leaves out the viewer's own reports.
- **Reviewed**: `p_filter:'reviewed'`, newest first.
- **All**: `p_filter:'all'`.
- Every list refetches every 60 s.

**Table** (columns What kind, When, Report, Reported by, Photos, Status, and a button column)
- What kind shows the kind with the place, the court name and "where exactly". Report shows the description clamped to 2 lines, or "This report’s text was deleted." when redacted. Reported by shows the name and role. Photos shows an image icon and a count, or "—". Status shows the Open or Reviewed badge, the reviewer's name, and "Text deleted" when redacted.
- **Row click**, or Enter or Space on a focused row: opens the incident sheet.
- **Review** (primary, row button): opens the sheet. Shown when the report is open and the viewer can review it.
- **Open** (row button): opens the sheet. Shown for reviewed reports and for the viewer's own open report.
- **Previous page** / **Next page** with "Page {page} of {count}": shown only with more than 50 rows.
- Error state: "This could not be loaded." with **Try again**.
- Empty states. To review: "Nothing to review" with "When someone reports an incident, it waits here until a manager reviews it." Reviewed: "No reviewed reports yet." All: "No incidents reported."

**Incident sheet** (a large dialog titled "{Kind} · {place}", with a status badge beside the title)
- Read-only facts:
  - Happened (date and time).
  - Reported by (name · role, and the time it was reported).
  - What happened, or the italic "This report’s text was deleted."
  - Who was involved (hidden when it is empty or the report is redacted).
- **Photos ({count})**: each photo is a link that opens the full-size image in a new window. Photos load through 10-minute signed URLs, showing "Opening the photo…" while loading and "This photo could not be opened." on failure. A redacted report shows "The photos are deleted at the next cleanup." instead.
- Review section:
  - Reviewed: "Reviewed by {name}, {time}" and the note.
  - Open and reviewable: the **Review note** field (required), at most 1000 characters, with the hint "The reporter sees this note." Validation after the press: "Write a note for the reporter." or "That text is too long."
  - Open but the viewer's own report: "You reported this. Another manager or the owner reviews it." For the owner's own report: "You reported this. A manager reviews it."
- **Mark reviewed** (primary, ✓): shown when the report is open and `can_review`. It calls `app.review_incident(p_id, p_note)`. This is online only. It shows the toast "Marked reviewed. {name} can read your note.", closes, and refetches every incidents read. The reporter gets a push (incident_reviewed, kind only). SUBMISSION_DECIDED ("This was already decided or withdrawn. Refresh to see the latest.") and REF_NOT_FOUND show inside the sheet and refetch. The other errors are CANNOT_DECIDE_OWN and TEXT_REQUIRED/TEXT_TOO_LONG.
- **Redact** (eye-off icon), **owner only**: shown when `can_redact` is true and the report is not already redacted. It switches the sheet to redact mode, which shows a red notice: "Redacting deletes what happened, who was involved, where exactly and the review note, now. The photos are deleted at the next cleanup. The kind, the place and the times stay. This cannot be undone."
  - **Redact report** (red, set apart): calls `app.redact_incident(p_id)`. This is online only, stores no reason, and cannot be undone. The photos are purged on the next cleanup tick. It shows the toast "Report redacted.", closes, and refetches.
  - **Keep it**: leaves redact mode and returns to the sheet.
- **Close** (footer), **X (Close)**, Esc and the backdrop: close the sheet. None of them work while a review or a redaction is sending.

### Desk and till view (court_desk, cashier): My reports
**Header**
- Title "My reports". Subtitle: "What you reported, and the manager’s note once it is reviewed."
- **Report an incident** (large primary, +): opens the report dialog.

**Filter** (a segmented control labelled "Show reports"; shown once there is at least one report)
- **All · {n}** (the default), **To review · {n}**, **Reviewed · {n}**: filter in the browser over `app.my_incidents(p_limit:30)`, which refetches every 60 s. The labels are the shared ones, so a reporter's open reports are under "To review".

**Report cards** (3 shown, then View more)
- **Card** (the whole card is one button): opens that report in the read-only report dialog. The card shows the kind band, the time and date, and the place (court name or place word). Hovering the time shows the tooltip "Happened {date time}". The card ends with a status strip, "Reviewed by {name}" in green or "Waiting for a manager" in amber, and the foot line "Click for more details ›".
- **View more ({count})** / **Show less**: unfolds or folds the cards beyond 3.
- No cards in the filter: muted text. All: "No incidents reported". To review: "Nothing to review". Reviewed: "No reviewed reports yet".
- No reports at all: a panel with "No reports yet" and "You have not reported anything. What you send shows here, with the manager’s note once it is reviewed." It has no button; the header button is the way in.
- Error: the error text with **Try again** (refresh icon). Loading: a skeleton.

**Read-only report dialog** (MyIncidentModal; there is no X)
- A larger version of the card's band (kind and place). Three fact tiles: Happened (time and date), Where exactly, and Photos (count or "—"). Then What happened, or "This report’s text was deleted." Then Who was involved, when there is one.
- **Photos**: each photo is a link that opens the full-size image in a new window. A redacted report shows "The photos are deleted at the next cleanup."
- Review block. Reviewed: "Reviewed by {name}" with the time, and "Manager’s review" with the note. Otherwise: "Waiting for a manager. Their note shows here once they review it."
- **Close** (a red button), Esc and the backdrop: close the dialog. Nothing can be edited.

### Report an incident dialog (both views; `reportIncidents`)
This is a four-step wizard: What kind → What happened → Where & when → Review. A side menu lists the steps, and a footer names the step before and the step after.

**Side menu and chrome**
- Lead "A manager reviews every report." The progress line reads "{done} of 3 done", with a bar.
- **Step buttons** (What kind, What happened, Where & when, Review): jump to a step.
  - Going back always works.
  - Going forward works only when every earlier step is done. Otherwise the dialog stays on the first unfinished step and flags what it lacks.
  - A done step shows a tick, then its answer: the kind name, "Written", or "{place} · {time}".
  - A step with a flagged gap shows "!" and "Needs a look".
- "Step {n} of 4" under the step title (read only).
- **X (Close)** button in the header, Esc, and the backdrop: close the dialog and discard the draft without asking. None of them work while sending.
- A red message box above the footer lists what the open step is missing.

**Step 1: What kind** (required)
- Five kind cards. Each is a toggle; picking one replaces the previous choice.
  - **Injury**: "Someone got hurt."
  - **Fight**: "An argument or a fight."
  - **Damage**: "Something broke."
  - **Accident**: "A fall, a slip, a collision."
  - **Other**: "Anything else."
- Missing: "Please select the type of incident."
- Footer: **Cancel** (closes the dialog) and **What happened** (next step).

**Step 2: What happened**
- Privacy line, read only: "Write only what is needed. Do not add phone numbers."
- **What happened** (required): a textarea that grows as you type, at most 2000 characters. Missing: "Please describe what happened." Too long: "Keep it to {limit} characters."
- **Who was involved** (optional): a growing textarea, at most 1000 characters. The hint is "Staff, guests or others, as briefly as you can."
- **Photos** (optional), shown with the counter "{n} / 6" and the hint "Up to 6 photos, JPG, PNG or WebP."
  - **Add photos** (+): opens the computer's file picker (JPG, PNG or WebP; several at once while more than one slot is left). Each file is shrunk to WebP and then uploaded: `app.staff_media_slot(p_folder:'incidents', p_ext:'webp')` followed by a storage upload to the `staff-media` bucket. The button reads "Uploading…" while it works and disappears at 6 photos.
  - Upload refusals: "That file is not a JPG, PNG or WebP photo this computer can open.", "That photo is too big, even after shrinking it.", and any upload error, for example UPLOAD_LIMIT.
  - **Thumbnail** (click): opens the photo viewer, a dialog titled "Photos" with each photo full size. Each photo there is a link to the full image in a new window. The viewer closes with X, Esc or the backdrop.
  - **× Remove photo {n}** (on the thumbnail's corner; its tooltip says the same): takes the photo out of the report. It is disabled while uploading or sending.
- Footer: **What kind** (back) and **Where & when** (next).

**Step 3: Where & when**
- **When** (required), hint "Up to 7 days ago.". Four time cards: **Now**, **15 min ago** and **1 hour ago**, each showing the clock time it means, and **Pick a time**.
  - **Pick a time** reveals a date-and-time box, also labelled "Pick a time", bounded from 7 days back to 10 minutes ahead.
  - Missing: "Please select when the incident occurred." Out of range: "Pick a time in the last 7 days."
- **Where** (required): five place cards, **Court**, **Cafe**, **Shop**, **Outside** and **Other**. Picking a place other than Court clears the court. Missing: "Please select where the incident occurred."
- **Which court** (required, shown only for Court): one card per active court (court icon and name), or "Loading…" while they load. A load error is shown under it. Missing: "Please select the court."
- **Where exactly** (optional): a text box with the placeholder "By the entrance", at most 120 characters.
  - Pressing Enter here may send the report straight away when no date-and-time box is open. This follows from the browser's implicit form submission; see the note in the hand-off.
- Footer: **What happened** (back) and **Review** (next).

**Step 4: Review**
- Lead "Check the report before you send it." Answer rows: What kind, What happened, Who was involved, Where & when (place · where exactly · date · time), and Photos (thumbnails).
- **Change** (one per row; its accessible name is "Change {what}"): opens the step that holds that answer.
- **Photo thumbnail**: opens the photo viewer, titled "Photos ({count})".
- Footer: **Where & when** (back) and **Send report** (primary, ✓).
- **Send report** checks every step first. If something is missing it flags the gaps and opens the first step that has one. Otherwise it calls `app.submit_incident(p_kind, p_occurred_at, p_place, p_description, p_court_id, p_place_detail, p_people_involved, p_photos, p_idempotency_key)`.
  - The key is reused on a retry and renewed by an edit. This is online only, with no PIN.
  - On success the dialog closes, then the toast "Report sent. A manager will review it." appears, and every incidents read refetches. Management at the venue gets a push (incident_reported, with the reporter's name and the kind).
  - A refusal that names a field opens that field's step with the matching message:
    - "Pick what kind of incident it was."
    - "Pick a time in the last 7 days."
    - "Pick where it happened."
    - "That court is not at this venue any more. Pick another."
    - "That is too long."
    - "Write what happened, in up to 2,000 characters."
    - "A photo did not upload properly. Remove it and add it again."
  - Any other error is shown on the open step.

---

## Marketing — `/marketing`
This page is where the owner sees marketing's posts waiting for approval, runs campaigns (who they reach and what they brought in), reads staff requests to marketing, and manages audiences.

*Who:* owner only (`ROUTE_ROLES['/marketing'] = ['owner']`). A manager or anyone else who opens the URL gets the guard card instead: "Not allowed for your role", plus a **Go to my home screen** link, or "The owner has closed this page for you. Ask them if you need it." when the page is blocked (0345). Every write RPC re-checks `app.is_staff('owner')`. Only the owner decides content (`decideContent`); managers never see content (§8 Q14). There is no in-screen branch picker; reads and writes follow the rail's branch through the request headers. *Source:* `apps/operator/src/features/marketing/MarketingPanel.tsx`, `features/content/ContentSection.tsx`, `features/content/ContentSheet.tsx`, `features/checklists/StaffPhoto.tsx` (PhotoViewer), `features/marketing/marketingTypes.ts`, `marketingStaffLogic.ts`, `components/kit.tsx`.

**How you get here**
- **Marketing** (Observe rail row, spark icon) — opens `/marketing`. Its badge counts marketing's posts waiting for the owner (`QK.contentWaiting`, `app.content_page` waiting count).
- **Review posts** ("Posts to approve" card on the Observe overview, and the `/ops` "content" alert row) — opens `/marketing`.
- The hidden Observe rows **Promotions** (`/admin/promotions`) and **Telegram** (`/admin/telegram`) are reached only from this page's header buttons. They keep the Observe rail lit while open.

**Page header**
- **Open promotions** (ghost, ↗ icon) — navigates to `/admin/promotions`.
- **Open Telegram** (ghost, ↗ icon) — navigates to `/admin/telegram`.
- **New campaign** (primary, + icon) — opens the "New campaign" dialog (see Campaign editor).

**Content for approval panel** (top of the page; `ContentApprovalPanel`)
- Header badge **"{count} waiting"** — read-only. Shown when posts are waiting.
- Lead text: "Posts marketing wants to publish. Approve one, or send it back with a reason; you never edit the text." — read-only.
- **Show content** segmented control (filters; picking one resets to page 1; reads `app.content_page` with `p_filter`, 50 per page, auto-refreshes every 60 s):
  - **Waiting** / **Waiting ({count})** (the default; oldest first; shares the rail badge's read).
  - **Changes asked**.
  - **Approved**.
  - **Closed** (declined or withdrawn).
  - **All**.
- Empty messages per filter (read-only): "Nothing waiting for approval." / "No post is waiting for changes." / "No approved posts yet." / "No declined or withdrawn posts." / "No posts sent yet."
- Error state: error text plus a **Try again** button, which re-fetches.
- Loading: a skeleton.
- **Post row** (whole row is a button; shows cover thumbnail, title, channel · "for {date}" · "by {name}" · "version {n}", "Sent {time}", status badge Waiting / Changes asked / Approved / Declined / Withdrawn) — click opens the **content sheet** for that post.
- **Pagination** (appears when a filter has more than 50 posts): "Page {page} of {count}", **Previous page** (◀ icon button), **Next page** (▶ icon button).

**Content sheet** (modal, size xl; opened from a post row; reads `app.content_detail`)
- Title = the post title; status badge beside it; subtitle "Instagram · for {date} · by {name}". Channels: Instagram, TikTok, Facebook, Snapchat, WhatsApp, Telegram, Guest site, In the venue, Print, Other.
- **X** (aria "Close"), **Esc** and a **backdrop click** close the sheet. None of the three works while a decision is being sent (`dismissible={!busy}`).
- Load error: error text plus **Try again**. Loading: a skeleton.
- Line "About {item} · Campaign: {name}" (read-only, when the post points at a menu item or campaign).
- **Newest version block** (read-only): "Version {n}", "Sent by {name}, {time}", decision badge (Approved / Changes asked / Declined) or "Replaced before a decision", a decided-by box "{name}, {time}" with the owner's reason, then **Caption**, **Images ({count})**, **Link** and **Note from marketing**.
  - **Image tile** (each image) — a link that opens the full-size signed photo in a new browser tab (10-minute signed URL). It shows "Opening the photo…" while loading and "This photo could not be opened." on error.
  - **Copy link** — copies the reel or design link to the clipboard. Toast "Link copied.", or "Could not copy. Select the link and copy it." The link is never opened in the app. The link text itself is select-all on click.
- **Earlier versions ({count})** — one row per earlier version (Version n, decision badge, time, chevron). Click toggles it open or closed (`aria-expanded`) to show that version's block (caption, images, link, note, decision box).
- Read-only note, shown when you cannot decide a waiting post: "You sent this post, so another owner decides it."
- Inline error line (`ErrorText`) for a failed decision.
- **Footer, read mode** (owner):
  - **Close** — closes the sheet.
  - **Ask for changes** (undo icon) — switches to the "changes" reason mode. Shown only when `can_decide` (owner, post waiting, not your own post or version).
  - **Decline** (x icon) — switches to the "decline" reason mode. Same condition.
  - **Approve version {n}** (primary, check icon) — calls `app.decide_content(p_id, p_version, 'approve', null)` at once, with no confirm. Approval is final. Toast "Approved. {name} is told." The sheet closes and every content list refreshes. Same condition.
  - **Withdraw** (ban icon) — shown only when `can_withdraw`. That flag is marketing's, so an owner sees it only if they also hold marketing as a second job (0345). It opens withdraw mode: a "The owner stops seeing this post, and it cannot come back…" notice, then **Keep it** and **Withdraw post** (danger) → `app.withdraw_content`, toast "Post withdrawn."
- **Ask for changes mode**:
  - **What should change** textarea (required, autofocus, max 1000 characters, hint "{name} reads this."). Validation on confirm: empty gives "A reason is required."; over 1000 gives "That text is too long."
  - **Back** — returns to read mode and clears the error.
  - **Ask for changes** (primary) — `app.decide_content(…, 'changes', note)`. Toast "Changes asked. {name} is told." The sheet closes.
- **Decline mode**:
  - **Why it is declined** textarea (same rules as above).
  - **Back**.
  - **Decline post** (danger, pushed to the far edge) — `app.decide_content(…, 'decline', note)`. Final. Toast "Declined. {name} is told."
- Decision errors are shown inline: SUBMISSION_DECIDED ("This was already decided or withdrawn. Refresh to see the latest.", after which the sheet re-reads), CANNOT_DECIDE_OWN ("You cannot decide something you sent or that is about you."), REASON_REQUIRED, TEXT_TOO_LONG, REF_NOT_FOUND, FORBIDDEN. Writes are online only (appRpc); there is no PIN. Each decision is audited as `marketing.content.approve|changes|decline`.

**Campaign filter toolbar** (shown only when at least one campaign exists)
- **Show campaigns** segmented control, each option with its count:
  - **All**.
  - **Live**.
  - **Scheduled**.
  - **Draft**.
  - **From marketing** (only when marketing has suggested at least one campaign; it lists those campaigns).
  - **Finished** (ended or cancelled).
- End-of-toolbar badge "New from marketing: {count}" — read-only. It counts drafts marketing suggested.

**Campaigns table** (`app.marketing_overview`, auto-refreshes every 60 s; three rows, then View more)
- Columns (read-only): **Campaign** (name; channel Telegram / Guest site / In venue; "Hands out: {promotion}" or "No promotion attached"), **Status** (badge, plus a warning "Its start date has passed" or "Its last day has passed"), **Runs** ("{from} – {to}" / "From {date}" / —), **Audience** ("Everyone" or the audience name; "Guests now: {count}"), **Sent** (count plus "Failed: {count}", or "Not sent"), **What it brought in** (revenue, "Times used: {count}", "Discount given: {amount}"; or "Not measurable" + "No promotion attached").
  - **Hover tooltips**: the result cell shows "Settled total of the tabs its promotion was used on." or "This campaign hands out no promotion, so nothing links a sale back to it. Attach a promotion to measure it." Truncated cells show their full text as a title tooltip.
- "From marketing" marks inside the Campaign cell (for suggested drafts): a badge "From {name}" / "From marketing", and "Note: {note}" (read-only).
  - **Photos ({count})** (ghost, eye icon) — opens a photo viewer titled "Photos from marketing" (see Photo viewer).
- Row actions, by status (the status machine is draft → scheduled → live → ended; cancelled can be reached from draft, scheduled or live; ended and cancelled rows have no actions):
  - **Schedule** (draft row, small primary) — `app.set_campaign_status(p_id, 'scheduled')` immediately, with no confirm. Toast "Campaign is now: Scheduled".
  - **Set live** (scheduled row) — opens the confirm "Set this campaign live?": "“{name}” will show as running and can no longer be edited. The app does not send the message for you — post it on {channel} yourself."
  - **End** (live row) — opens the confirm "End this campaign?": "“{name}” moves to finished campaigns. This cannot be undone."
  - **Edit campaign** (ghost; draft and scheduled rows only) — opens the Campaign editor prefilled.
  - **Back to draft** (icon-only undo button, aria-label "Back to draft"; scheduled rows) — `set_campaign_status(…, 'draft')` immediately, with no confirm.
  - **Cancel campaign** (icon-only red ban button; draft, scheduled and live rows) — opens the confirm "Cancel this campaign?": "“{name}” is cancelled and cannot be restarted. What it already recorded stays on record."
  - Status-move errors (toast): BAD_TRANSITION "A campaign cannot move to that state from where it is now.", BODY_REQUIRED "Write the message in both languages before this campaign goes out." (any non-In-venue channel leaving draft without both messages), START_REQUIRED "Give the campaign a start date before it goes out.", CAMPAIGN_NOT_FOUND "That campaign no longer exists. Reload the page.", FORBIDDEN. Each move is audited as `marketing.campaign_status`. Online only.
- **View more ({count})** / **Show less** — expands or collapses the list beyond three rows.
- Empty (no campaigns at all): "No campaigns yet", body "A campaign ties an audience, a message and a promotion together…", and a **New campaign** button that opens the editor.
- Filter matched nothing: "No campaigns in this list." + **Clear filters** — sets the filter back to All.
- Load error: "This could not be loaded." + error text + the offline hint + **Try again** (re-fetches).

**Status-move confirm dialog** (for Set live, End and Cancel campaign)
- **Keep it as it is** (ghost) — closes without changing anything. Disabled while sending.
- **Set live** / **End** / **Cancel campaign** (the last is danger red) — calls `app.set_campaign_status` with the new status. On success the dialog closes and a toast shows "Campaign is now: {status}".
- **X** / **Esc** / **backdrop** — close the dialog.

**Requests to marketing panel** (`app.marketing_requests_page`, 50 per read, auto-refreshes every 60 s; read-only, because answering is marketing's job on the phone)
- Header badge "{count} waiting" — read-only.
- Lead: "Staff ask marketing for something from their phones… This list is for reading only."
- **Which requests** segmented control (small):
  - **Waiting** (the default).
  - **Answered**.
  - **All**.
- Each request (read-only): title, status badge (Waiting for marketing / Done / Declined / Withdrawn), who asked · role · when · "About {item}", "Wanted by {date}" or "Wanted by {date}, now past" (amber), the body, and the answer box "Answer from {name} · {time}" with the answer text.
  - **Photos ({count})** (ghost, eye icon) — opens the photo viewer titled "Photos: {title}".
- **View more ({count})** / **Show less**.
- "Showing {shown} of {total}." — read-only. Shown once every loaded row is on screen and more exist on the server.
- Empty messages per filter: "Nothing is waiting for marketing." / "Marketing has not answered a request yet." / "Nobody has asked marketing for anything yet."
- Error: error text + **Try again** (re-fetches). Loading: "Loading…".

**Audiences panel** (shown once the overview has loaded)
- **New audience** (+ icon, panel header) — opens the "New audience" dialog.
- Lead: "Who a campaign goes to…" or "No audiences yet. A campaign without one goes to every guest." (read-only).
- Each audience row (read-only): name, rule summary ("Every guest", or "Bookings: at least {n} · Played within {n} days · Uses English / Uses Arabic · Has a phone number · Gets app notifications"), and "Matches now: {count}".
  - **Edit audience** (ghost) — opens the Audience editor prefilled.
- There is no delete for audiences, and none for campaigns.

**Campaign editor** (modal, wide; title "New campaign" / "Edit campaign")
- Fields:
  - **Name (English)** (required, LTR). The error "Enter the name in both languages." appears after the first Save press.
  - **Name (Arabic)** (required, RTL). Same error.
  - **Channel** (required select): Telegram (the default) / Guest site / In venue.
  - **Audience** (select): Everyone (none) / each saved audience.
  - **Promotion handed out** (select): "None — reach only" / every promotion, including ones that are off or ended. The hint "This campaign hands out no promotion, so nothing links a sale back to it. Attach a promotion to measure it." shows while None is selected.
  - **Starts** (date). This is the venue's calendar day, saved as that day's venue midnight.
  - **Last day** (date; cannot be earlier than Starts). The error "The last day cannot be before the start." appears live. Saved as the venue midnight after that day.
  - **Message (English)** (textarea, LTR). Hint "Both messages are needed before the campaign can be scheduled." unless the channel is In venue.
  - **Message (Arabic)** (textarea, RTL).
  - When editing, the saved message is read first (`marketing_campaigns.body_en/ar`). While it loads you see "Loading the saved message…", both message boxes are disabled, and Save is disabled. A read failure shows its error.
- **Cancel** (ghost) — closes the dialog, discarding edits with no "discard?" prompt. Disabled while saving.
- **Save** (primary) — validates (both names present, last day not before start). It then calls `app.save_marketing_campaign(p_id|null, p_name_en, p_name_ar, p_channel, p_audience_id, p_promotion_id, p_starts_at, p_ends_at, p_body_en, p_body_ar)`. On success the dialog closes, a toast shows "Campaign saved", and the overview refreshes. Server errors appear inline: NAME_REQUIRED "Both the English and Arabic names are required.", BAD_CHANNEL "Choose a channel.", CAMPAIGN_LOCKED "This campaign has already gone out and can no longer be edited.", CAMPAIGN_NOT_FOUND, FORBIDDEN. Audited as `marketing.campaign_save`. Online only.
- **X** / **Esc** / **backdrop** — close the dialog with no unsaved-changes guard.

**Audience editor** (modal, wide; "New audience" / "Edit audience"). An audience is a rule that is re-counted live, never a stored list.
- Fields:
  - **Name (English)** (required).
  - **Name (Arabic)** (required). Error for either: "Enter the name in both languages." (after Save).
  - **At least this many bookings** (optional, numeric; hint "Leave empty for no limit."). The error "Enter a whole number of 1 or more." appears live.
  - **Played within this many days** (optional, numeric; same hint and error).
  - **Language** (select): Any language / English / Arabic.
  - **Has a phone number** (checkbox).
  - **Can receive app notifications** (checkbox).
- **Cancel** — closes the dialog.
- **Save** — `app.save_marketing_audience(p_id|null, p_name_en, p_name_ar, p_rule {minBookings?, lastSeenDays?, lang?, hasPhone?, hasPush?})`. Toast "Audience saved". Inline errors: NAME_REQUIRED, BAD_RULE "That audience rule is not valid.", AUDIENCE_NOT_FOUND "That audience no longer exists.", FORBIDDEN. Audited as `marketing.audience_save`.
- **X** / **Esc** / **backdrop** — close the dialog.

**Photo viewer** (modal; from "Photos ({count})" on a suggested draft or on a request)
- Each photo is a link that opens the full-size signed image in a new browser tab ("Photo {n}" alt; "Opening the photo…" / "This photo could not be opened.").
- **X** / **Esc** / **backdrop** — close the viewer.

---

---

## Audit log — `/admin/audit`
This page is a read-only log of every sensitive action: who did it, when, what changed (before and after), the reason, and the station. The log cannot be edited or deleted anywhere.

*Who:* manager and owner (`ROUTE_ROLES['/admin'] = ['manager','owner']`; `/admin/audit` has no entry of its own). The manager reaches it from the Records rail group ("Audit log"), the owner from the Observe rail ("Audit log"). Server: `app.audit_log_page` runs `app.reports_guard`, and the `audit_log` table fallback is limited by RLS to manager and owner. There is no in-screen capability gate, so owner and manager see the same screen. The request carries the report branch scope (`REPORT_RPC` matches `audit_log_page`), but there is no in-screen branch picker; the rail branch, or a report scope set elsewhere, applies. *Source:* `apps/operator/src/features/admin/audit/AuditLog.tsx`, `auditLogic.ts`, `components/kit.tsx` (DateRangeControl, SearchField, FilterChips, ExportButton, ViewMore), `features/analytics/exportTables.ts`.

**How you get here**
- **Audit log** rail row (Observe for the owner; Records for the manager).
- From Staff activity (`/reports/staff`) and the Activity monitor (`/observation/activity`), a person's "open audit" action opens `/admin/audit?actor=<staff id>`, which pre-fills the **Who** filter.
- From overview exception rows, `?q=<action code>` pre-fills the search. `?period=<today|yesterday|thisWeek|lastWeek|thisMonth|last30>` pre-sets the period; the default is Last 30 days.

**Page header**
- Badge **Read-only** (lock icon) — read-only.
- **Export** (file icon; tooltip "Current filters and dates"; disabled when no rows are visible) — downloads an `.xlsx` workbook named `audit-log-<from>-<to>.xlsx` with the currently filtered rows. There is one spreadsheet row per changed field. Columns: Date, Time, Who, Role, Authorised by, What happened, Record, Field changed, Was, Became, Reason, Station, Action code, Record type, Record id. The sheet runs right to left in Arabic, and technical fields are included. The export is client-side and no RPC is called.
- **Refresh** (refresh icon; spinner while re-fetching) — re-reads the log page.

**Period toolbar**
- Label "Period" (read-only).
- **Preset select** (aria "Period"): **Today**, **Yesterday**, **This week**, **Last week**, **This month**, **Last 30 days**, and **Custom** (shown, disabled, when the dates were typed by hand). Picking a preset applies it at once and re-queries. Presets count from the venue's business day.
- **From** date field.
- **To** date field.
- **Apply** (appears only once From or To has been edited; disabled when From is after To) — applies the typed range and re-queries.

**Filter toolbar**
- **Search** field (placeholder "What happened, name, reason…"). It filters the loaded page client-side across the action words, the person's name, the record name and the stored codes (action, entity, id, reason, station, role). Typing an exact known action code (for example `payment.refund`) sends it to the server as an action-prefix filter instead. **Esc** clears the field, and so does the **Clear** (x) button inside it.
- **Area** select (server-side filter by action family): **All areas**, then the known areas, sorted by code: Guest accounts, Analytics, Daily checklists, Courts, Customers, Business day, Discounts, Cash drawer, Incident reports, Marketing, Menu, Voids, Refunds, Price changes, Promotions, Protocols, Driver’s purchases, Court rates, Bookings, Repeat bookings, Settings, Shopping list, Staff, Staff requests, Stock, Tabs, Tables, Table QR security, Teachings, Telegram. Any new area found in the data is listed by its raw code.
- **Who** select (server-side): **Anyone**, then every staff member by name, then any other actor seen in the rows. It matches the person who acted OR the person who authorised with a PIN.
- **Missing a reason ({count})** toggle button (alert icon; pressed state is highlighted). It shows only rows whose action requires a reason but has none. Those actions are: discount given, item void, booking price override, price override, refund, stock adjustment, stock waste, booking cancel, move, extend and mark.

**Active filter chips** (shown when any filter is on)
- **Search: {value}** ×.
- **Area: {value}** ×.
- **Person: {value}** ×.
- **Missing reason only** ×.
- Each × (aria "Remove filter: {label}") removes that one filter.
- **Clear all** — resets every filter. The period is kept.

**Arrived-from-a-link note** (when opened with `?q=` and the search still holds that value)
- "Showing only: {what}" + **Show everything** — clears the search.

**Results**
- Staff-names load error (`ErrorText`) — read-only.
- Info note when the page is capped at 200: "Showing the latest {shown} of {total} in this period. Narrow the period or the filters to reach older entries." or "Showing the latest {shown} in this period…" — read-only.
- Table columns (read-only): **When** (time, date, "Station {name}"), **Who** (name, or System / Guest / "Someone no longer on staff"; "PIN: {name}" when someone else authorised), **What happened** (the action in words with the record's name; an unknown action shows "Area · code"), **Reason** (the reason in words; a red "none recorded" badge when a required reason is missing; otherwise —).
- **Changes ({count})** / **Hide** (per row, chevron; shown when the entry has any before/after data) — expands or collapses a second row with a **Field / Before / After** table. Yes/No and dates are shown in words, and technical id fields are hidden. Notes: "Record ids and other technical fields are left out here. The export includes them." or "Only technical fields changed. Export to see them."
- **View more ({count})** / **Show less** — the list shows three entries first.
- Empty period: "Nothing matches those filters." (no action).
- Filters matched nothing: "Nothing matches those filters." + **Clear filters** (resets all filters).
- Load error: "This could not be loaded." + error + offline hint + **Try again**.
- The screen has no writes, no PIN, and no auto-refresh on window focus. Rows stay until **Refresh** or a filter change.

---

---

## Promotions (hidden row, opened from Marketing) — `/admin/promotions`
This page lists every promotion, active or not, with what it does and when. The owner switches promotions on or off and opens the editor; a manager proposes changes instead. Nothing is ever deleted.

*Who:* manager and owner (`/admin` prefix). Owner: hidden Observe row, reached from Marketing's **Open promotions**. Manager: the Setup rail row "Promotions". In-screen gates:
- `permissions.editPromotions` = owner only.
- `usePriceChangeStart()` requires `can(staff,'startProtocolPriceChange')` (marketing, manager, owner) AND `canAccess('/protocols')`. A manager is therefore a "proposer".
- Server: `upsert_promotion` and `generate_promo_code` refuse a manager with PRICE_VIA_PROTOCOL. `set_promotion_enabled` lets a manager switch a promotion off but not on.
- Edge case: a manager whose `/protocols` page is blocked (0345) gets a disabled **New promotion** and the "needs the Owner role" notice instead of the propose buttons.

*Source:* `apps/operator/src/features/admin/promotions/PromotionsList.tsx`, `PriceChangeStart.tsx`, `promotionLogic.ts`, `promotionsApi.ts`, `components/Switch.tsx`, `routes/admin/promotions.tsx`.

**Page header**
- Owner: **New promotion** (primary, + icon) — navigates to `/admin/promotions/new`.
- Manager: **Propose a promotion** (primary, + icon, ↗) — navigates to `/protocols?start=price_promo&change=promotion` (starts a price or promo change).
- Manager note (info, lock icon): "The owner approves new promotions, changes to them and switching one back on: propose these here and follow them in Protocols. You can still switch a promotion off."
- Fallback when neither applies: a disabled **New promotion** with the notice "Not allowed for your role — New promotion needs the Owner role…".

**Toolbar**
- **Show** segmented control with counts; it writes `?show=` to the URL (replace), so Back from the editor keeps the filter:
  - **All**.
  - **Live**.
  - **Starting later**.
  - **Off**.
  - **Ended**.
- **Search by name or code** field — filters by English name, Arabic name or public code. **Esc** clears it, as does the **Clear** (x) button.
- "{shown} of {total}" result count — read-only. Shown only while a search is typed.

**Table** (sorted live first, then starting later, off, ended; then by name)
- Columns (read-only): **Name**, **Discount** ("{n}%" or an IQD amount), **When** (dates · weekdays · hours, or "Any day, any time"), **Applies to** (how: "Code {code} · single use" / "Needs a code, none yet" in amber; scope: "All cafe items" / "Courts: n · Categories: n · Items: n"), **Status**, and a chevron.
- **Row click** (or **Enter** / **Space** on a focused row) — opens `/admin/promotions/<id>`. A click that starts on the switch or a button inside the row does not open the editor.
- **On/off switch** (per row; aria "On or off: {name}") — `app.set_promotion_enabled(p_id, p_enabled)`. It flips optimistically, reverts on error and shows an error toast, then refreshes the list. It has no confirm. Owner: both directions. Manager: can switch off; the switch is disabled on a row that is already off, and the server refuses a manager's switch-on with PRICE_VIA_PROTOCOL. Errors: PROMOTION_NOT_FOUND "That promotion could not be found.", INVALID_VALUE, FORBIDDEN. Audited as `promotion.set_enabled`. Online only.
- Status word beside the switch (read-only): "Live" / "Starts {date}" / "Ended {date}" / "Off".
- Manager only, on an Off row that has not ended: **Switch on** (ghost, ↗; aria "Switch on: {name}") — navigates to `/protocols?start=price_promo&change=promotion_enable&promotion=<id>`.
- Empty (no promotions): "No promotions yet." + body "Create one to offer a percentage or fixed amount off…" + the same header button (New promotion or Propose a promotion).
- Nothing matches: "No promotion matches." + **Clear filters** — clears the search and sets the filter to All.
- Load error: "This could not be loaded." + **Try again**.

---

## Promotion editor — `/admin/promotions/$id` (`$id` = `new` for a new one)
This page holds one promotion's full set-up: what it offers, when, what it applies to, its limits, and how it reaches a bill.

*Who:* same as the list (`guarded('/admin/promotions')`). Owner: full edit. Manager: read-only form plus propose buttons. A manager on `/new` sees only the header and propose button; the form is hidden. *Source:* `apps/operator/src/features/admin/promotions/PromotionEditor.tsx`, `promotionLogic.ts`, `PriceChangeStart.tsx`, `components/inputs.tsx`, `components/ConfirmDialog`.

**States**
- Loading: a spinner.
- Not found: "This promotion could not be found." (no action).
- Load error: "This could not be loaded." + **Try again**.

**Header**
- Eyebrow "Promotions"; title = the promotion name, or "New promotion".
- Badge "Unsaved changes" (when the draft differs from the saved version) or the lifecycle badge "Live / Starts {date} / Ended {date} / Off" — read-only.
- **Back** — navigates to `/admin/promotions`. If there are unsaved changes, a confirm opens first (see Leave guard).
- Owner:
  - **Discard changes** (ghost; enabled only when there are unsaved changes) — resets the form to the last saved version.
  - **Save** (primary, check icon; disabled when nothing changed or a field is invalid; the tooltip gives the reason: "Enter a discount to save." / "Set a percent from 1 to 99 to save." / "Move the start to today or later to save." / "Move the end to today or later to save." / "Fix the dates to save." / "Fix the hours to save.") — calls `app.upsert_promotion(p_id, p_name_en, p_name_ar, p_type, p_value, p_starts_at (venue midnight), p_ends_at (last ms of end day), p_weekdays, p_hour_from, p_hour_to, p_scope {courtIds, categoryIds, itemIds}, p_limits {total, perCustomer, minSpendIqd, tierMin if set}, p_auto, p_public_code, p_code_single_use, p_enabled)`. Toast "Promotion saved.", and the list refreshes. For a new promotion it replaces the URL with `/admin/promotions/<newId>`. Errors appear inline at the bottom of "How it is applied": NAME_REQUIRED, INVALID_VALUE "Invalid value.", INVALID_RANGE, INVALID_WEEKDAYS "Those days of the week are not valid. Pick each day once.", CODE_TAKEN "That promo code is already used by another promotion.", PROMOTION_NOT_FOUND, PRICE_VIA_PROTOCOL, FORBIDDEN. Audited as `promotion.upsert`. Online only. There is no delete.
- Manager:
  - **Switch on** (↗; only on an existing Off promotion that has not ended) — navigates to `/protocols?start=price_promo&change=promotion_enable&promotion=<id>`.
  - **Change this promotion** (primary, ↗) — navigates to `/protocols?start=price_promo&change=promotion_edit&promotion=<id>`.
  - **Propose a promotion** (on `/new`) — navigates to `/protocols?start=price_promo&change=promotion`.
- Summary sentence (read-only, rebuilt live), for example "10% off everything from the cafe · Fri, Sat · 16:00–19:00 · Bills of … or more · Total uses: n · Uses per guest: n · Code …".
- Manager note: "Only the owner edits a promotion directly. Propose a change and the owner approves it in Protocols." or, on new, "A new promotion starts as a proposal in Protocols, and the owner approves it."

**What it offers** panel
- **Name** — bilingual pair: **English** and **Arabic** inputs (required). After you leave the field, an empty name shows "Enter both the English and the Arabic name."
- **Type** segmented control: **Percentage off** / **Fixed amount off**. Switching to percent clamps the value to 1–99.
- **Percent** (percent input, 1–99) or **Amount (IQD)** (money input). Errors after leaving: "Enter a value greater than zero." / "Percent must be between 1 and 99."

**When it applies** panel
- **Starts** (date; the earliest allowed day is today, or the saved start if that is earlier). Error after leaving: "The start cannot be in the past."
- **Ends** (date; the earliest allowed day is today or the start; hint "Leave blank for no end. It stops by itself after this day."). Errors: "The end cannot be in the past." / "The end must be on or after the start."
- Ended notice (read-only, when expired and unchanged): "Ended on {date}. It no longer applies to any bill."
- **Weekdays** toggle buttons: **Sun**, **Mon**, **Tue**, **Wed**, **Thu**, **Fri**, **Sat**, each pressed or not. Hint: "None selected means every day."
- **Hours** — **From** (time) – **To** (time). Hint: "Leave both blank for the whole day. An end earlier than the start runs past midnight." Error after leaving: "Set both times, and make them different."

**What it applies to** panel (hint: "Choose nothing to discount every cafe item on the bill. Court fees are never discounted.")
- **Courts** chip picker (hint "Only bills for bookings on these courts qualify."). Each court is a toggle chip (check icon when chosen); the legend shows "· Chosen: {n}". With no courts it shows "None".
- **Menu categories** chip picker — toggle chips. With more than 16 categories it switches to search mode (as for items).
- **Menu items** chip picker (active items plus any already chosen). It is in search mode when there are more than 16:
  - Chosen chips are shown first; click one to remove it.
  - Search field (aria "Menu items: Search…"; Esc or × clears it).
  - "Type a name to find one and add it."
  - Up to 24 result chips; click one to add it.
  - "Showing the first 24. Keep typing to narrow it down."
  - "Nothing matches that search."
- Read-only (manager) with nothing chosen: "None chosen".

**Limits** panel (hint: "Blank means no limit. With a per-guest limit, a bill with no named guest does not get this promotion.")
- **Total uses** (digits only; blank = no limit).
- **Uses per guest** (digits only).
- **Minimum bill (IQD)** (money input; may be blank).
- The loyalty tier minimum (`tierMin`) has no field here but is kept through an edit.

**How it is applied** panel
- Segmented control: **Automatically** / **Only with a code** (tag icon). Hint: "Any bill that qualifies gets it when staff apply a promotion at the till." / "The guest gives the code and staff type it at the till."
- Code area (shown when code-only or a code exists):
  - "Code" with the code badge, or "No code yet."
  - **Generate code** (owner only; refresh icon; disabled on a new, unsaved promotion or while there are unsaved changes, tooltip "Save the promotion first, then generate a code.") — `app.generate_promo_code(p_id)`. The server stores the code on the row immediately, without a Save. The list refreshes. Errors inline: CODE_GENERATION_FAILED "A new code could not be made. Try again.", PROMOTION_NOT_FOUND, PRICE_VIA_PROTOCOL. Audited as `promotion.generate_code`.
  - Warning (code-only with no code): "Without a code this promotion can never apply."
  - **Each code works once** switch (part of the draft; saved with Save).
- **Switched on** switch (part of the draft). Hint: "Off means it never applies. Switching it off keeps its history; nothing is deleted."
- Info: "If several promotions fit one bill, only the one that takes the most off applies."
- Inline error line for Save and Generate failures.

**Leave guard**
- Any in-app navigation away with unsaved changes (Back, a rail row, a link) opens a confirm: "You have unsaved changes" / "Everything you changed here will be lost. Are you sure you want to close?"
  - **Keep editing** (focused by default; Enter and Esc keep you on the page).
  - **Discard changes** (danger, paired beside it) — leaves the page.
- Closing or reloading the window with unsaved changes triggers the browser's own "leave site?" prompt (`beforeunload`).

---

---

## Telegram (hidden row, opened from Marketing) — `/admin/telegram`
This page sets up the staff Telegram group notifications (on/off, which group, language), shows whether they work, sends a test, controls who may tap the message buttons, diagnoses problems, and lists the last sent messages.

*Who:* owner only (`ROUTE_ROLES['/admin/telegram'] = ['owner']`). A manager gets the guard card. The owner reaches it from Marketing's **Open Telegram**, the Setup home's Telegram card, or the Branches page's Telegram link. Server: `telegram_send_test`, `retry_telegram_outbox`, `set_telegram_staff` and the `telegram-diagnose` edge function are owner-only. `set_cafe_setting` lets a manager or owner through, but the telegram keys are owner-only. The group and settings are per branch (0212); Diagnose sends `venue_id` = the rail's branch. *Source:* `apps/operator/src/features/admin/telegram/TelegramSettings.tsx`, `DetectedGroups.tsx`, `ButtonPeople.tsx`, `DiagnosePanel.tsx`, `OutboxList.tsx`, `chatId.ts`, `telegramStatus.ts`, `diagnoseTypes.ts`, `lib/settings.ts`, `routes/admin.tsx`.

**Guest app strip** (above the page, `/admin` layout sub-nav, "Guest app" family)
- **Home screen** — navigates to `/admin/hero`.
- **Tables & QR** — navigates to `/admin/qr`.
- **Telegram** — the current page.

**Header and tabs**
- Title "Telegram"; lead "Staff get a message in their Telegram group for every new order and waiter call…" (read-only).
- Tabs (arrow keys, Home and End move between them):
  - **Set up** (the default).
  - **Sent messages**.
- Loading: a skeleton until the settings load.

**Set up tab — "Are staff being notified?" panel**
- Health sentence plus hint (read-only), one of seven states: "Notifications are off." / "No staff group is chosen." / "Nothing has been sent yet." / "The last message did not arrive." / "Messages are not going out." / "A message is on its way." / "Working."
- Fact rows (read-only):
  - **Staff group**: None chosen / "The example number, not a real group" / the group name / the raw id.
  - **Last message**: status chip Waiting / Delivered / Failed / Not sent, plus the time; or "Nothing sent yet".
  - **Last button tap**: the time, or "None yet". Hint: "When a tap on a message button last reached this app."
- **Send test message** (bell icon; primary when the state is untested; disabled until notifications are on and a group is saved, tooltip "Switch notifications on and choose the staff group first."; disabled while a test is running, tooltip "A test message is already on its way.") — calls `app.telegram_send_test()`, which queues an outbox row. The page then polls that `telegram_outbox` row every 2 s for up to 20 s:
  - While waiting: a spinner and "Waiting for Telegram to confirm…".
  - On delivered: a status chip and the toast "Test message delivered."
  - On failed or skipped: a chip and the toast "The test message did not arrive."
  - After 20 s with no answer: "No confirmation yet. Look under Sent messages in a minute."
  - If Telegram gave a reason: a red badge "Problem: {error}".
  - Errors (toast): TELEGRAM_NOT_CONFIGURED "Telegram is not configured — add the group chat ID first.", FORBIDDEN.
- **Sent messages** (ghost, file icon) — switches to the Sent messages tab.

**Set up tab — "Settings" group**
- **Send notifications to Telegram** switch (hint "On: new orders and waiter calls are posted to the staff group. Off: nothing is sent.") — `app.set_cafe_setting('telegram_enabled', bool)`. Optimistic; reverts and shows an error toast on failure. No confirm.
- **Staff group** row (lead "Groups the bot has been added to. Pick the one your staff use."):
  - Detected groups list (`telegram_chats`, up to 20, auto-refreshes every 5 s). Each row (read-only): the name or "Unnamed group", "Bot is in this group" / "Bot was removed", "seen {when}", "ID {chat id}".
    - **Use this group** (on a group the bot can post to and that is not already in use; disabled while saving) — `app.set_cafe_setting('telegram_chat_id', id)`. Toast "Saved."
    - Badge **In use** (the current group) or **Bot removed** — read-only.
    - Empty: "No groups yet" + "In Telegram, add the bot to your staff group…".
    - Error: "This could not be loaded." + **Try again**.
  - **How to add the bot to your group** (expandable details) — shows five steps (read-only).
  - **Enter the group chat ID by hand** (expandable details; it opens by itself while the typed id is unsaved or invalid):
    - **Group chat ID** input (numeric, LTR; hint "A long number, usually starting with -100."). It converts Arabic-Indic digits and strips spaces. The live error "A group chat ID is 5 to 20 digits, and may start with a minus sign." shows when the value is not empty and not `-?\d{5,20}`.
    - **Save** (appears only when the value differs from the saved one; disabled while invalid, tooltip "A group chat ID is a long number, usually starting with -100.", or while saving) — `app.set_cafe_setting('telegram_chat_id', value | null)`. An empty value clears the group. Toast "Saved." Errors appear as a toast.
    - **Enter** in the field saves, when the value changed and is valid or empty.
- **Message language** select (hint "Messages are written in this language, whatever language staff use in this app."): **Arabic** / **English** — `app.set_cafe_setting('telegram_lang', 'ar'|'en')`. An error shows as a toast.

**Set up tab — "Who can use the message buttons" panel** (`telegram_staff`, `staff` and the last 500 `telegram_actions`; auto-refreshes every 60 s)
- Lead (read-only). A load failure shows the badge "This list could not be loaded."
- **Tried to tap, but not allowed** section (only when there are refused tappers; lead "Choose which staff member each person is, then allow them."). One card per Telegram user:
  - Read-only: Telegram name / @username, and "Last tried {when}".
  - **Staff member** select: "Choose…" / each active staff member as "Name · Role".
  - **Can void items** switch (local to the card until Allow is pressed).
  - **Allow** (primary, check icon; disabled until a staff member is chosen, tooltip "Choose which staff member this is first.") — `app.set_telegram_staff(p_tg_user_id, p_staff_id, p_label, p_can_void, p_is_active=true)`. Toast "Saved." Errors: TG_USER_REQUIRED, STAFF_NOT_FOUND "This staff member no longer exists.", FORBIDDEN.
  - **View more ({count})** / **Show less** — the section shows three cards first.
- **Allowed** section — one row per allowed person:
  - Read-only: staff name, "On Telegram: {name}", and the warning badge "Staff account has no access" when that staff account is inactive.
  - **Can void items** switch — `app.set_telegram_staff(…, p_can_void=next, p_is_active=true)`. Toast "Saved."
  - **Remove** (ghost, x icon) — `app.set_telegram_staff(…, p_is_active=false)` immediately, with no confirm. Toast "Saved."
  - Empty: "Nobody is allowed yet, so every tap is refused." (+ "Ask staff to tap a button under a message in the group…" when nobody has tried).
  - Hint: "Voiding an item from Telegram is like a manager PIN: only switch it on for people who may approve voids."
- **Add someone who has not tapped yet** (expandable details):
  - **Telegram user ID** (digits only; hint "A number. The person can get it from a bot such as @userinfobot."). The error "A Telegram user ID is 5 to 15 digits." shows live.
  - **Staff member** select.
  - **Can void items** switch.
  - **Allow** (disabled until the id is valid and a staff member is chosen; tooltip gives the reason) — `app.set_telegram_staff(…, p_label=null, p_is_active=true)`. The form then resets. Toast "Saved."

**Set up tab — "Find the problem" group** (lead: "Asks Telegram whether the bot, the staff group and the link back to this app are set up correctly. Nothing is posted in the group.")
- **Run a check** / **Check again** (search icon; busy while running) — calls the edge function `telegram-diagnose` with `{action:'diagnose', venue_id}`. Errors show as a toast.
- Result badges (read-only): "Everything checks out." or "Needs attention: {count}".
- Check list (problems first, then skipped, then passed). Each row has a status badge (ok / warn / fail / skip) and a sentence. The checks are: **Bot key**, **The bot**, **Saved settings**, **Staff group**, **Bot in the group**, **Button taps**, **Recent messages**, **Who may tap buttons**. An unknown answer reads "Telegram answered in a way this app does not recognise ({code})."
  - **Use the new ID** (primary; shown when a check reports a new chat id, i.e. the group migrated) — saves `telegram_chat_id` through `set_cafe_setting` (toast "Saved."), then runs the check again.
  - **Reconnect button taps** (refresh icon; on the Button taps check when its code is WEBHOOK_MISSING, WEBHOOK_WRONG_URL, WEBHOOK_UPDATES or WEBHOOK_DELIVERY_ERROR) — calls the edge `telegram-diagnose` with `{action:'register_webhook'}`. Toast "Button taps reconnected.", then the check runs again. Errors show as a toast.

**Sent messages tab** (`telegram_outbox`, the last 20, newest first, auto-refreshes every 10 s)
- Lead: "The last 20 messages, newest first. A message that failed can be sent again." (read-only).
- Table columns (read-only): **Message** (New order / Waiter call / Test message / raw kind), **Status** (Waiting / Delivered / Failed / Not sent), **Group** (name or id; truncated with a hover title), **Created**, **Delivered**, **Tries**, **Problem** (truncated with a hover title).
- **Send again** (ghost, refresh icon; only on Failed or Not sent rows; disabled while one is sending) — `app.retry_telegram_outbox(p_id)`. It re-queues the message to the saved group. Toast "Queued for sending." Errors as a toast: OUTBOX_NOT_FOUND "Outbox message not found.", FORBIDDEN.
- Empty: "Nothing sent yet." + "Send a test message from the Set up tab to check everything is connected."
- Error: "This could not be loaded." + **Try again**.
