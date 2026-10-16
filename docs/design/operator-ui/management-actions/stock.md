# Stock: every action, screen by screen

Management › **Stock** — *On hand, deliveries, waste, counts and what the shelves are worth*. Part of the
[management actions inventory](README.md), which also covers the rail, who can
open what, and the problems this crawl turned up.

Snapshot of the operator app's **working tree on 2026-10-16**, uncommitted work
from parallel sessions included. Read from the code, not clicked through:
labels are the English catalog's words, writes name the `app.*` RPC (or queued
mutation) they call, and refusal codes come from the latest migration that
defines each function. If a screen changes, this file is stale for that screen.

| Screen (rail order) | Bullets |
|---|---|
| Stock shell (all six screens) | 7 |
| On hand — `/stock` | 35 |
| Alerts — `/stock/alerts` | 17 |
| Expiry — `/stock/expiry` | 17 |
| Goods in — `/stock/receive` | 81 |
| Move stock — `/stock/moves` | 18 |
| Waste & production — `/stock/waste` | 20 |
| Stock count — `/stock/counts` | 34 |
| Count differences — `/stock/variance` | 22 |
| Ingredients — `/stock/ingredients` | 32 |
| Recipes — `/stock/recipes` | 25 |
| Margins — `/stock/margins` | 13 |
| Stock value — `/reports/stock` | 27 |
| Shop (Stock rail row) — `/shop` | 9 |
| Sell — `/shop` | 97 |
| Cash drawer — `/shop/drawer` | 23 |
| Shop stock — `/shop/stock` | 25 |
| Goods in — `/shop/receive` | 24 |
| Stock count — `/shop/counts` | 21 |
| Products — `/shop/products` | 63 |
| Suppliers — `/shop/suppliers` | 16 |
| Supplier price watch (background, no screen of its own) | 7 |
| **Total** | **633** |

---

## Stock shell (all six screens)
How the Stock section frames these screens, for both owner and manager.

*Who:* manager, owner. *Source:* `routes/stock.tsx`, `routes/stock/_children.ts`, `lib/workspaces.ts` (STOCK, STOCK_SECTION), `lib/auth.tsx`.

**Rail (Stock section)**
- **On hand**, **Alerts**, **Expiry** — plain rows → `/stock`, `/stock/alerts`, `/stock/expiry`.
- **Stock in and out** dropdown — expands/collapses; holds **Goods in**, **Move stock**, **Waste & production**; opens itself when one of its screens is showing. (The same rail also carries the Counting and Recipes and costs dropdowns, Stock value and Shop, inventoried elsewhere.)
- Owner: the Stock section button on the Management rail. Manager: the **Stock** row in Run the day opens this rail.

**Stock sub-nav (fallback only)**
- When the current rail does not already list the Stock rows, a sub-nav "Stock" is drawn beside the page with groups **Every day** (On hand, Goods in, Move stock, Waste & production, Expiry, Alerts), **Count and check** (Stock count [badge with phone counts waiting], Count differences, Margins), **Setup** (Ingredients, Recipes); each item navigates to its route. Under the owner's and the manager's Stock rail it is hidden, so in practice they do not see it.

**Shared behaviour**
- Every stock read refreshes on its own; there is no manual refresh button except the **Try again** buttons on failed reads.
- No branch picker, date picker, print, copy, barcode scan or keyboard shortcut exists on these six screens; data and writes follow the branch chosen in the shell.
- The same On hand, Goods in and Waste components also serve the Touch Shop desk (`/shop/...`, shop scope) with shop-only stock and fewer controls; that variant is not covered here.

---

## On hand — `/stock`
The Stock module's landing screen: what needs attention on the shelves right now, then a searchable table of every café/bakery ingredient with its stock level, and each ingredient's full movement history.

*Who:* route `/stock` = manager, owner (ROUTE_ROLES; every `/stock/*` child inherits it, each child wrapped in `RequireRole route="/stock"`). A person whose second job opens it gets it too; a person the owner blocked from the `stock` area (0345) sees "The owner has closed this page for you. Ask them if you need it." instead; anyone else sees the permission-refused notice ("Opening this screen" needs manager) plus the link **Go to my home screen**. No in-screen capability gates and no owner/manager differences on this page. Data is the current branch's (no branch picker on the page). *Source:* `features/stock/OnHand.tsx`, `LedgerDrawer.tsx`, `stockUi.tsx` (AttentionList, Footnote), `stockLogic.ts`, `storeLogic.ts`, `stockKeys.ts`; shell `routes/stock.tsx`.

**Getting here**
- **On hand** (rail row, Stock section; first row) — opens `/stock`. Owner: Stock section button on the Management rail. Manager: the **Stock** row under Run the day opens the same Stock rail. This row also stays highlighted for any `/stock/...` path without its own row.
- Deep link `/stock?filter=out|low|belowPar|countNeeded` — opens the table already narrowed (used by Today's tiles and by Alerts' "See what is out / See what is low"). Unknown values open "All". The filter is read once on load; changing it later does not rewrite the URL.

**Page header**
- Subtitle (read-only): "Stock worth {IQD}" (from `app.report_stock`) · "Last counted {date}" or "Never counted". A figure that failed to load is left out.
- **Record a delivery** (primary, box icon) — navigates to `/stock/receive`.
- **Record waste** (ban icon) — navigates to `/stock/waste`.
- **Count stock** / **Continue the count** (scale icon; the second label when any manager count is open at either store) — navigates to `/stock/counts`.

**Loading / error / empty (whole page)**
- Loading: table skeleton.
- Error reading `v_ingredient_on_hand`: "This could not be loaded." + error text + "You may be offline. The last known data is shown where available." + **Try again** (refetches the on-hand read).
- No active café/bakery ingredients at all: empty state "No ingredients yet" / "Add the ingredients you buy and prepare, then record the first delivery." + **Add ingredients** (primary, plus icon) → navigates to `/stock/ingredients`.

**Needs attention panel** (rows appear only when their count is above 0; each shows the count, a title, a one-line hint and one button). When every count is 0 it shows one green line: "Nothing needs attention. No ingredient is running low and nothing has expired."
- **Out of stock** → **Show which** — sets the table filter to Out of stock, clears the search, resets Store to Both stores, scrolls the table into view.
- **Running low** → **Show which** — same, filter Running low.
- **Expired batches on the shelf** → **Open expiry** — navigates to `/stock/expiry`.
- **Sold past what was on record** → **Show which** — same as above, filter Count needed.
- **Below par** → **Show which** — same, filter Below par.
- **Expiring soon** → **Open expiry** — navigates to `/stock/expiry`.
- **Counts from the phone to apply** → **Open counts** — navigates to `/stock/counts`.
- **Staff additions with no cost** → **Open Goods in** — navigates to `/stock/receive` (where the "Added by staff, no cost" panel is).
- **Alerts not yet dismissed** → **Open alerts** — navigates to `/stock/alerts`.
- All counts refresh every 60 s.

**Table toolbar**
- **Show** segmented control: **All** · **Out of stock** · **Running low** · **Below par** · **Count needed** — narrows the table (level filters are exclusive; Count needed cuts across them).
- **Search ingredients** search box — case-insensitive match on the English or Arabic name. **Esc** clears it; the **Clear** (×) button inside the box clears it.
- **Store** segmented control: **Both stores** · **Cafe store** · **Bakery store** — shown only once the bakery store holds any stock. Picking a store never hides rows: the On hand column becomes "In the cafe store"/"In the bakery store" with "Both stores {qty}" under it, and what that store holds is listed first.
- Result count (read-only): "{shown} of {total}".

**Table** (columns Ingredient [with "Prepared" marker], On hand [with "Cafe store {qty} · Bakery store {qty}" under it when the bakery holds some], Par, Status ["OK", or a badge Out of stock / Running low / Below par / Count needed, plus "records say {qty}" when the shelf and the ledger disagree], History)
- **Row click** (or **Enter**/**Space** on a focused row) — opens the History drawer for that ingredient.
- **History** (ghost button, file icon, per row) — opens the same History drawer.
- Narrowed to nothing by the Show filter alone: "Nothing is out of stock." / "Nothing is running low." / "Nothing is below par." / "Every ingredient matches its records." (no button; pick **All** to get out).
- Narrowed to nothing by a search: "Nothing matches those filters." + **Clear filters** — resets Show to All, empties the search and resets Store to Both stores.

**Footnote under the table**
- Text "Stock goes up with deliveries and down with sales, waste and write-offs. Nobody types a stock number: if a shelf does not match, count it and the count corrects it." + **Count stock** / **Continue the count** (ghost) — navigates to `/stock/counts`.

**History drawer** (modal "History: {ingredient}"; subtitle "On hand now: {qty}. Everything that changed it, newest first."; read-only ledger from `stock_movements`, 50 per page, always re-read on open)
- Columns: When, What happened (movement in words; "More than was on record" under a sale line with no batch), Change (+/−, coloured), Store, Cost per {unit}, By, Note (a move reads "To the bakery store"/"From the cafe store" etc.; other reason codes printed as stored).
- **Open the product release** (ghost button in Note, only on a "Used in a product test" row) — closes the drawer and navigates to `/protocols?run=<id>` (protocols route: manager, owner).
- **Newer** (chevron) — previous page of 50; disabled on the first page.
- **Older** (chevron) — next page of 50; disabled when the page came back with fewer than 50.
- Close: **×** (aria "Close") in the header, **Esc**, or a click on the backdrop.
- Error: "This could not be loaded." + **Try again** (refetch). Empty: "Nothing has changed this ingredient’s stock yet."

**Background**
- Every read on the page (on hand, summary, alert count, last count, unfinished counts, per-store split, needs-cost count) refetches every 60 s; no write happens on this page.

---

## Alerts — `/stock/alerts`
The to-do list of stock warnings the system raised, grouped by what they mean, each group with the screen that fixes it and a way to dismiss.

*Who:* manager, owner (route `/stock`; same blocked/refused behaviour as On hand). `app.acknowledge_alert` itself allows manager, owner only. No owner/manager differences. *Source:* `features/stock/AlertsPanel.tsx`, `stockLogic.ts` (alertKind, ALERT_ORDER).

**Getting here**
- **Alerts** (rail row, Stock section, second row) — opens `/stock/alerts`. Also reached from On hand's **Open alerts**.

**Page header**
- Title "Alerts", subtitle "Warnings the system raised about stock. Dismissing hides an alert; it does not change stock." No header buttons.

**Loading / error / empty**
- Error reading `manager_alerts`: "This could not be loaded." + **Try again** (refetch).
- No undismissed alerts: "No alerts" / "Alerts appear here when stock runs low or out, sells past its record, or is about to expire."
- Alerts of a kind this build does not know: a line "Some alerts are of a kind this screen does not know yet." (no action).
- List auto-refreshes every 60 s.

**Alert groups** (in this order, only groups with alerts: Sold past what was on record · Out of stock · Expired · Running low · Expiring soon · Offline sale not applied). Each group panel shows its title, a count badge and a hint sentence.
- **Dismiss all** (ghost, check icon; only when the group has more than one alert) — dismisses every alert in the group, including ones hidden behind View more. Calls `app.acknowledge_alert(p_alert_id)` once per alert, in sequence. Optimistic: the rows vanish at once; on failure the list is restored and an error toast shows (e.g. "This alert was already dealt with, or it is gone. Refresh the list." / "You do not have permission for that."). No confirmation. Online-only (direct RPC). Refreshes the alert list and On hand's alert count.
- Group action button (one per group, opens where it is resolved):
  - Sold past what was on record → **Count stock** — navigates to `/stock/counts`.
  - Out of stock → **See what is out** — navigates to `/stock?filter=out`.
  - Expired → **Open expiry** — navigates to `/stock/expiry`.
  - Running low → **See what is low** — navigates to `/stock?filter=low`.
  - Expiring soon → **Open expiry** — navigates to `/stock/expiry`.
  - Offline sale not applied → no button (hint: "Check that station’s recent orders with the cashier.").
- Group table rows (read-only text): Ingredient name (or "Unknown ingredient") with a sentence from the alert ("{onHand} left, reorder point {threshold}", "Nothing left on the shelf", "{qty} sold beyond the record, at the cafe store", "{qty}, expires {date}", "{qty}, expired {date}", "Station {station}"); Raised (date/time). Rows are not clickable.
- **Dismiss** (ghost, check icon, per row) — dismisses that one alert via `app.acknowledge_alert`; shows a spinner while it runs; same optimistic/rollback/toast behaviour as Dismiss all.
- **View more ({n})** / **Show less** (per group) — the group lists 3 alerts, then reveals or folds the rest.

---

## Expiry — `/stock/expiry`
Expired and soon-to-expire batches, one row per batch with its store and worth, where an expired batch is written off with a manager PIN.

*Who:* manager, owner (route `/stock`). In-screen gate: **Write off** needs `can.adjustStock` (manager, owner, shop_staff) — both owner and manager have it, so no difference here; without it the button is disabled and the hint reads "Ask a manager to write these off." Server: `app.write_off_expired` allows cashier, manager, owner and needs a manager PIN proved first (`app.verify_manager_pin`). *Source:* `features/stock/Expiry.tsx`, `components/ui.tsx` (PinReasonModal), `features/analytics/exportTables.ts`.

**Getting here**
- **Expiry** (rail row, Stock section, third row) — opens `/stock/expiry`. Also from On hand (**Open expiry**), Alerts (**Open expiry**) and Waste & production's footnote.

**Page header**
- Subtitle: "Batches that have expired, or expire within {days} days." (venue's expiring-soon window) or "Batches that have expired, or expire soon."
- **Export** (file icon; tooltip "Current filters and dates") — downloads an Excel workbook `expiry-<YYYY-MM-DD>.xlsx`, one sheet "Expiry", columns Ingredient, Left, Unit, Expiry date, Worth, State (Expired / Expiring soon), Store; every batch, not only the 3 shown. Disabled when both lists are empty. Client-side only.

**Loading / error**
- Error reading `app.report_stock`: "This could not be loaded." + **Try again** (refetch).

**"Expired: throw out and write off" panel**
- Empty: "Nothing on the shelf has expired."
- Hint: "Writing off removes the whole batch from stock. It needs a manager PIN." (or "Ask a manager to write these off." without adjustStock).
- Table (read-only cells): Ingredient, Store, Left, Worth, Expired ({date} + badge "yesterday"/"{n} days ago").
- **Write off** (danger, ban icon, per row) — opens the write-off dialog for that batch. Disabled while another write-off is running or without adjustStock.
- **View more ({n})** / **Show less** — 3 batches, then the rest.

**Write-off dialog** ("Write off {ingredient}"; body "{qty}, expired {date}. This removes it from stock.")
- **Reason** select — one option only: **Expired**.
- **Manager PIN** box — password field, digits only (anything else is stripped), max 6.
- **Confirm** (primary) — disabled until the PIN has at least 4 digits. Calls `app.verify_manager_pin` then `app.write_off_expired(p_batch_id, p_pin, p_reason_code='expired')` (direct, online-only): writes an `expired_writeoff` movement for the whole remaining batch, audit-logged. Success: toast "{ingredient} written off.", dialog closes, every stock read refreshes. Errors shown in the dialog: "Incorrect PIN.", "Too many wrong PINs — locked for a few minutes.", "Manager authorisation expired — enter the PIN again.", "Batch not found.", "Nothing is left in this batch to write off.", "This belongs to another branch. Switch to that branch to do this.", "You do not have permission for that."
- **Cancel** — closes the dialog (also **×**, **Esc**, backdrop); clears any error. Disabled while the write-off runs.

**"Expiring soon: use first" panel**
- Empty: "Nothing expires in the next few days."
- Hint: "Sales already take the batch that expires first. Use these before opening new stock."
- Table (read-only): Ingredient, Store, Left, Worth, Expires ({date} + badge "today"/"tomorrow"/"in {n} days"). No row action.
- **View more ({n})** / **Show less**.

---

## Goods in — `/stock/receive`
Record a supplier delivery by hand like an invoice, and work through what is waiting to be received: scanned receipts, the driver's purchases, and stock staff added on the phone without a cost.

*Who:* manager, owner (route `/stock`). No owner/manager differences. Server roles: `app.receive_delivery` manager, owner, shop_staff; `app.receive_purchase`, `app.acknowledge_purchase_line`, `app.price_logged_stock`, `app.confirm_receipt`, `app.reject_receipt`, `app.receipts_to_review`, `app.purchases_to_receive`, `app.receipt_detail` manager, owner; `app.create_receipt` driver, manager, owner. Everything on this page is online-only (no queued mutation type). *Source:* `features/stock/ReceiveDelivery.tsx`, `SupplierField.tsx`, `StaffLogs.tsx`, `DriverPurchases.tsx`, `receipts/ReceiptsPanel.tsx`, `receipts/ReceiptReview.tsx`, `decimalInput.ts`, `stockLogic.ts`, `storeLogic.ts`, `stockUi.tsx` (StorePicker, StoreCountedNotice).

**Getting here**
- **Goods in** (rail row inside the **Stock in and out** dropdown of the Stock section; the dropdown opens itself on this screen) — opens `/stock/receive`. Also from On hand (**Record a delivery**, **Open Goods in**), Move stock's empty state.
- `/stock/receive?receipt=<id>` opens the scanned-receipt check view; `/stock/receive?purchase=<id>` opens the driver-purchase view (a purchase wins if both). Any malformed id falls back to the ordinary form.

**Page header**
- Subtitle "Enter what arrived. Stock goes up as soon as you record it."
- **Scan a receipt** (soft, receipt icon) — opens the computer's file picker (JPEG, PNG or WebP). The photo is compressed to WebP (≤2560 px), a slot is minted (`app.staff_media_slot`, folder receipts), uploaded to staff media storage, then filed with `app.create_receipt(p_source='operator', idempotency key)`. Success: toast "Receipt saved", the page opens that receipt's check view (`/stock/receive?receipt=<id>`), and the `receipt-scan` edge function is asked to read it in the background. While running the label is "Uploading…". Errors under the button: "That file is not a photo. Use a JPEG, PNG or WebP picture.", "That photo is over 5 MB.", or the server/network error (e.g. "A photo did not upload properly. Take or choose it again.").

**"Waiting to receive" chips** (a row of toggle chips above the form; one panel open at a time; each chip only shows when it has something or its read failed; counts refresh every 60 s)
- **Scanned receipts {n}** — toggles the Scanned receipts panel below.
- **Bought by the driver {n}** — toggles the driver's purchases panel below.
- **Added by staff, no cost {n}** — toggles the Added by staff panel below (shown while any staff addition exists in the window, costed or not; the number is lines still needing a cost).
- Clicking an open chip again closes its panel.

**Scanned receipts panel** (inside the chip)
- Lead "Photograph a supplier’s receipt, check what was read against the photo, then put it into stock." or "No receipts waiting. Scan one here, or from the staff phone."
- Badge "{n} to check" (receipts not still reading). Read error shown as text (no retry button; it refreshes every 60 s, every 4 s while one is reading).
- Each row (read-only): supplier name read (or status), "{uploader} · {time}", "Lines matched: {m} of {n}", status badge (Waiting / Reading… / Ready to check / Could not read), total read.
- **Check** (soft, per row) — navigates to `/stock/receive?receipt=<id>` (the check view below).
- **View more ({n})** / **Show less**.
- (No Scan button inside the panel here: it is in the page header.)

**Bought by the driver panel** (inside the chip)
- Badge "{n} to receive"; lead "The driver recorded these at the shop. Open one to check what arrived and put it into stock."
- Each row (read-only): "{driver} · {shop or Shop not given}", "{time} · Items: {n}", "Delivered {time} by {name}" / "Delivery not confirmed yet", amount paid.
- **Receive** (soft, per row) — navigates to `/stock/receive?purchase=<id>` (the purchase view below).
- **View more ({n})** / **Show less**.
- Read failed with nothing listed: error text + **Try again** (refetch).

**Added by staff panel** (inside the chip; staff additions from the phone over the last 14 days, plus older ones still needing a cost)
- When every addition already has a cost, it is one line: "Added by staff · Every addition of the last 14 days has a cost." + **Show the ones already costed ({n})** — expands to the full card.
- Full card: badge "Need a cost: {n}"; lead sentence; lines needing a cost listed first. Each addition: "{name}, {when}" and its store; each line: ingredient, quantity, and either the badge "Needs a cost" or "{cost} per {unit}" with its source ("Estimated from the last delivery" / "Estimated from the pack price" / "Set by a manager").
- **Set cost** (soft; on a line with no cost) / **Change cost** (ghost; on a costed line) — opens the inline cost editor on that line (opening another line's editor moves it there; typed value is lost).
  - **Cost for** segmented: **One {unit}** · **One pack of {size}** — only when the ingredient has a pack size; a pack price is divided by the pack size.
  - **Cost (IQD)** (or **Cost per {unit} (IQD)** without a pack size), required, auto-focused; keystroke filter: digits only (Arabic/Persian digits converted), one decimal point, max 10 digits. Validation: "Enter a cost of 0 or more." **Enter** saves, **Esc** cancels.
  - **Save cost** (primary) — disabled until the cost is valid. Calls `app.price_logged_stock(p_delivery_id, p_lines=[{delivery_line_id, unit_cost_iqd}])`: revalues only what is still on the shelf (the line, its batch and moved copies). Success toast "Cost saved. What is still on the shelf now carries it."; every stock read refreshes. Errors inline (e.g. "Invalid input — check the values and try again.", "The referenced record no longer exists.", "You do not have permission for that.").
  - **Cancel** — closes the editor.
  - Note under it: "Saving changes the cost of what is still on the shelf. What was already used keeps the estimate."
- **View more ({n})** / **Show less** (additions list).
- **Show the ones already costed ({n})** / **Hide the ones already costed** — toggles costed additions in or out of the list.
- Read failed with nothing listed: error text + **Try again**.

**"What arrived" form — head**
- **Supplier** (optional) combobox — type any name, or pick from the venue's active suppliers in the list that opens under the box (narrows as you type, names starting with the text first; placeholder "Type a name or pick from the list"; max 80 chars). Keyboard: **↓/↑** open and move, **Enter** picks, **Esc** closes. A typed name not on the list shows "Not on the list: “{name}” is saved as typed."; a typed name matching a supplier exactly is linked to that supplier when the box is left. Choosing the first ingredient fills the supplier from that ingredient's supplier if the box is empty.
- **Put it in** segmented: **Cafe store** (default) · **Bakery store** — the store the delivery goes into.
- **Notes** (optional) text box, placeholder "e.g. invoice number".
- When a manager's count is open at the chosen store: refusal "A count of the cafe store is open. Nothing can go into it until that count is finished or discarded." + **Open the count** (ghost) → navigates to `/stock/counts`; Record delivery is then held.
- Ingredient list failed to load: error text + **Try again** (refetch ingredients).

**"What arrived" form — line table** (one row per invoice line; columns #, Ingredient*, Received*, Ordered, Cost per unit*, Expiry date, Line total; the table scrolls sideways inside its box on a narrow window; a short line is tinted)
- **Ingredient** select (required) — "Choose…" then every active *purchased* ingredient (prepared items and shop stock are not listed). Type-ahead, arrow keys, Home/End, Enter/Space, Esc. Choosing fills the cost box from the pack price when it is still empty. Error "Choose the ingredient." on a started line with none.
- **Received** (required; the ingredient's unit printed after the box) — number filter as above. Error "Enter how much arrived." when blank or ≤ 0.
- **Ordered** (optional) — number. Error "Enter a number, or leave it blank."; hint "Short by {qty}" when received < ordered.
- **Cost per {unit} (IQD)** (required; "/ {unit}" after the box; hint "Pack of {size}: {price}") — number. Error "Enter the cost." when blank or negative.
- **Expiry date** (optional) date picker — past dates greyed out (min = venue's today); a typed past date shows "The expiry date cannot be in the past." Hint: "Blank: {n} days from today" (ingredient's shelf life) or "Blank: no expiry date".
- Line total (read-only, received × cost).
- **×** remove line (ghost icon; tooltip/aria "Remove line {n}") — removes the row; disabled when it is the only row.
- **Add another ingredient** (plus icon) — appends a blank row.
- A completely blank row is ignored, not an error.

**Form foot** (sticks to the bottom of the window)
- Read-only: "Choose an ingredient, then enter how much arrived and what it cost." (nothing started) or "Lines: {n}", badge "Short: {n}" + "Some lines arrived short. Only what was received goes into stock."; "Delivery total" in IQD.
- **Record delivery** (primary, box icon) — disabled until at least one started line, no line problems, and the store is not being counted (then the tooltip says "Held until that count is finished or discarded."). Calls `app.receive_delivery(p_lines[{ingredient_id, qty_expected, qty_received, unit_cost_iqd, expiry_date}], p_supplier_name | p_supplier_id, p_notes, p_idempotency_key, p_location)` — one delivery, one batch per line, each with its own expiry. The idempotency key is kept across retries (a double click or retry books once) and renewed after a success. Success: toast "Delivery recorded. Stock is updated.", form clears (lines, supplier, notes), every stock read refreshes. Errors under the foot: "That store is being counted right now. Try again when the count is finished." (also re-reads counts so the notice appears), "Add at least one stock line first.", "A line has a quantity or cost that is not a number above zero. Check the lines.", "Supplier not found.", "Ingredient not found…", "Invalid input — check the values and try again.", "You do not have permission for that."

**Under the form**
- "Recorded deliveries show on" + **On hand** (ghost) → navigates to `/stock`.

**Receive what the driver bought — `/stock/receive?purchase=<id>`**
- **Back to Goods in** (ghost, header) → `/stock/receive`.
- Loading skeleton. Read failed: error + **Try again** (refetch) + **Back to Goods in**. Purchase no longer waiting: "This purchase is not waiting to be received" / "Someone may have received it already…" + **Back to Goods in**.
- **Purchase details** panel (read-only list: Bought by, Where, When, Paid, Delivery "Delivered {time} by {name}" / "Delivery not confirmed yet").
  - **See the receipt** (receipt icon; when the driver attached a photo) — opens the "Receipt" photo dialog; clicking the photo opens it full size in a new browser tab; close with **×**, **Esc** or backdrop. Otherwise the text "No receipt photo".
- **Into stock** panel (when the purchase has stock lines). Each line shows "Bought {qty} · Paid {amount}, {cost} per {unit}".
  - **Received ({unit})** (required; prefilled with what was bought) — number filter. Error "Enter a number, 0 or more."; hints "Short by {qty}" / "More than was bought".
  - **Expiry date** (optional) date picker, min today; hint "Blank: {n} days from today" / "Blank: no expiry date"; past date error "The expiry date cannot be in the past."
  - A line whose ingredient was switched off after purchase is listed here with the note "This ingredient was switched off after it was bought…" and **Mark checked** (see below); it holds the receive.
  - **Put it in** segmented **Cafe store** (default) · **Bakery store** — Bakery is disabled with "Shop stock stays in the cafe store, so the bakery store is off while a shop product is on the list." when a shop line is on the purchase.
  - Store-being-counted refusal + **Open the count** → `/stock/counts`.
  - **Supplier** (optional) combobox (as on the form); hint "Blank: filed under the shop, {shop}."
  - **Receive into stock** (primary) — disabled with reason: "Mark the switched-off lines checked first." / "Fix the amounts marked in red first." / "Held until that count is finished or discarded." / the shop-stays-in-cafe sentence; also while a Mark checked is running. Calls `app.receive_purchase(p_purchase_id, p_lines[{purchase_line_id, qty_received, expiry_date}], p_supplier_id | p_supplier_name, p_idempotency_key, p_location)` — books every stock line as one delivery and marks the purchase in the same transaction; cost per unit = paid ÷ bought. Success toast "Received. Stock is updated."; returns to Goods in if nothing else on the purchase needs checking. Errors: "An ingredient on this purchase was switched off. Mark that line checked, then receive the rest." (re-reads the purchase), store being counted (re-reads counts), "This purchase was already received.", "That purchase could not be found.", "Invalid quantity.", "Supplier not found.", "That text is too long."
- **Not for stock** panel (cleaning supplies etc.; lead "Mark each one checked once you have seen it.") — each line shows name, quantity · price.
  - **Mark checked** (check icon, per line) — calls `app.acknowledge_purchase_line(p_line_id)`; for a switched-off stock line a confirmation first: "Mark {name} checked?" / "It will not go into stock, and this cannot be undone." with **Cancel** / **Mark checked**. Success toast "Marked checked."; the last pending line returns to Goods in. Error shown under that line ("This purchase was already received.", "That purchase could not be found.", …). Other Mark checked buttons are disabled while one runs.
- **Already done** panel (read-only; lines with badge Received / Checked).

**Check a scanned receipt — `/stock/receive?receipt=<id>`**
- **Back to Goods in** (ghost, header) → `/stock/receive`.
- Loading skeleton. Read failed: error + **Try again**. Receipt already confirmed, set aside or not found: "This receipt is done" / "It was put into stock or set aside already." + **Back to Goods in**.
- **Receipt photo** panel — the photo (click opens it full size in a new browser tab); caption "The receipt names: {name} · Dated {date}".
- **What arrived** panel:
  - **Read again** (ghost, refresh icon) — asks the `receipt-scan` edge function to read the photo again; replaces the lines when it lands. Disabled while busy or a reading runs. Refusals shown: "This paper was read three times already. Type the lines from the photo.", "You have asked for the most readings allowed today…", "This receipt is being read right now. Try again in a minute.", "This receipt was already put into stock or set aside.", "Someone else read or set aside this paper meanwhile. Refresh to see it.", or a network error.
  - While reading: "Reading the receipt. This can take up to a minute." (form hidden; polls every 3 s, up to the server's 3 minutes). Stuck reading: "The reading stopped answering. Read again, set it aside, or type the lines from the photo."
  - A new reading arrived while editing: "A new reading arrived while you were editing." + **Use the new reading** (replaces the lines) / **Keep my edits**.
  - Reading failure line from the stored error (e.g. "No AI is connected to read receipts yet. Type the lines from the photo.", "This month’s AI budget is spent…", "The AI took too long to answer. Try Read again.", etc.).
  - Ingredients/suppliers failed to load: error + **Try again** (refetches both).
  - **Put it in** segmented **Cafe store** (default) · **Bakery store** — Bakery disabled with the shop-stays-in-cafe reason while a shop line is on the form (choosing Bakery also drops shop products from the ingredient list). Store-being-counted refusal + **Open the count** → `/stock/counts`.
  - Each line card: read strip (read-only: "On the receipt" wording, "Qty {qty} {unit}", line total, match badge Matched / Matched from an earlier receipt / Check this match / No match: pick the ingredient, or remove the line / Picked by hand, "→ {ingredient} ({unit})", warning "Counted as packs of {size} {unit}: check the quantity", flags such as "Quantity × price is not the line total", "Hard to read: check it against the photo", "A very small amount: probably written in thousands…").
    - **Ingredient** select — "Choose…" then purchased ingredients and shop stock (prefixed "Café stock · …" / "Shop stock · …" when shop stock exists). Picking one on a read line recomputes quantity and cost from the receipt in that ingredient's unit (a typed expiry is kept); on a typed line it prefills cost from the pack price.
    - **×** remove line ("Remove line {n}") — removes the line (any line can be removed here, e.g. a delivery fee).
    - **Received ({unit})** (required), **Ordered ({unit})** (optional; "Short by {qty}"), **Cost per {unit} (IQD)** (required; "Pack of {size}: {price}"), **Expiry date** (optional, min today) — same filters and errors as the Goods in form.
  - **Add a line** (plus icon) — appends a blank line.
  - Total check (read-only): "These lines come to {drafted}." or, when more than 1 IQD per line off the printed total, "These lines come to {drafted}; the receipt says {printed}."
  - **Supplier** (optional) combobox — prefilled from the matched supplier or the name read.
  - **Set aside** (ghost, ban icon) — confirmation "Set this receipt aside?" / "Nothing goes into stock. Use this for a photo that is not a supplier receipt, or one that was already entered." with **Cancel** / **Set aside** (danger). Calls `app.reject_receipt(p_id, p_reason=null)`; toast "Receipt set aside"; back to Goods in. Never held by a reading. Errors: "This receipt was already put into stock or set aside." (re-reads it), "That receipt could not be found."
  - **Put into stock** (primary, box icon) — disabled while reading, while any line has a problem, or with reason "Add at least one stock line first." / "Held until that count is finished or discarded." / shop-stays-in-cafe. Calls `app.confirm_receipt(p_id, p_lines, p_supplier_id | p_supplier_name, p_location, p_idempotency_key)` — books one delivery and teaches the wording to the matcher. Success toast "Receipt put into stock"; back to Goods in. On failure a fresh key is minted; errors: store being counted (re-reads counts), "This receipt was already put into stock or set aside." (re-reads), "This receipt is being read right now…", "Add at least one stock line first.", "Supplier not found.", "That text is too long."

---

## Move stock — `/stock/moves`
Record stock carried between the cafe store and the bakery store (including the first day's opening move), and see the last 30 days of moves.

*Who:* manager, owner (route `/stock`). Server `app.transfer_stock` allows waiter, manager, owner. No owner/manager differences. Online-only. *Source:* `features/stock/MoveStock.tsx`, `storeLogic.ts` (directions, moveLineProblem, movePayload), `decimalInput.ts`.

**Getting here**
- **Move stock** (rail row inside the **Stock in and out** dropdown) — opens `/stock/moves`.

**Page header**
- Subtitle "Record stock carried from one store to the other. The venue’s total and its value stay the same." No buttons.
- First-day call-out (only when the venue has never recorded a move; read-only): "First day with two stores" / "Everything on record starts in the cafe store. Before the bakery’s first count, record what already sits on the bakery shelf as one move from the cafe store to the bakery store."

**"What you moved" form**
- **Direction** segmented: **Cafe store to bakery store** (default) · **Bakery store to cafe store** — one control, so the two stores can never be the same; changing it clears any error and re-lists what the source store holds.
- Count refusal (when a manager's count is open at either store): "Moves wait while {the cafe store} is being counted. Finish or discard that count first." + **Open the count** (ghost) → navigates to `/stock/counts`.
- Read failed (ingredients or per-store split): error text + **Try again** (refetches the failed read).
- Nothing at the source store: "Nothing is on record in the cafe store" (or bakery) / "Stock arrives through Goods in, production and staff on the phone. Record it there first." + **Open Goods in** → navigates to `/stock/receive`. (The line editor is hidden.)
- Per line:
  - **Ingredient** select (no required marker but needed) — "Choose…" then every active non-shop ingredient the source store holds (a line keeps its ingredient's name if the direction was flipped). Changing it resets the unit to the base unit. Errors: "Choose what you moved." / "Already on another line. Put it on one line."
  - **×** remove line (tooltip/aria "Remove line {n}") — disabled when it is the only line.
  - **Quantity ({unit})** / **Quantity** (required) — number filter (digits, one point, max 10 digits, Arabic digits converted). Hint "On record here: {qty}". Errors: "Enter how much, above zero." / "More than the cafe store shows ({qty}). Move what it shows, or count it first." (also shown with the server's figure when the server refuses the line).
  - **Unit** segmented: **{unit}** · **Packs of {size}** — only when the ingredient has a pack size.
- **Add another ingredient** (plus icon) — appends a line.
- Direction echo (read-only) beside the button once a line is started.
- **Move stock** (primary, repeat icon) — disabled until at least one started line, no line problems, no count open at either store and the per-store split has loaded; tooltip "Held until that count is finished or discarded." or "Choose what you moved and how much." Calls `app.transfer_stock(p_from, p_to, p_lines[{ingredient_id, qty, unit?:'pack'}], p_idempotency_key)` — splits the source store's batches first-expiring-first into the other store with the same expiry and cost. The key is reused for a retry of identical lines and renewed after an edit or a success. Success toast "Moved into the bakery store." / "Moved into the cafe store."; lines reset; every stock read refreshes. Errors: "That store shows less than you are moving…" (marks the line, re-reads), "That store is being counted right now…" (re-reads counts), "Ingredient not found…", "Invalid quantity.", "Invalid input — check the values and try again." (e.g. shop stock), "You do not have permission for that."

**Recent moves panel** (read-only; last 30 days, up to 100, from here and the waiter's phone; scrolls inside the panel; refreshes every 60 s)
- Columns When, Direction, What moved ("{ingredient} {qty} · …"), By. Rows are not clickable.
- Empty: "No moves in the last 30 days" / "Moves recorded here or on the phone show up here."
- Error: "This could not be loaded." + **Try again** (refetch).

---

## Waste & production — `/stock/waste`
Record café/bakery stock that was thrown away (spill or spoilage), record a batch made in the kitchen, and see what was made today.

*Who:* manager, owner (route `/stock`). Server: `app.record_waste` cashier, manager, owner, shop_staff; `app.record_production` manager, owner; `app.production_log_today` head_chef, chef, manager, owner. No owner/manager differences. *Source:* `features/stock/WasteAndProduction.tsx`, `madeTodayLogic.ts`, `lib/mutate.ts` (`stock.waste`), `decimalInput.ts`, `stockUi.tsx` (StorePicker, Footnote).

**Getting here**
- **Waste & production** (rail row inside the **Stock in and out** dropdown) — opens `/stock/waste`. Also On hand's **Record waste**.

**Page header**
- Subtitle "Record stock that was thrown away, or a batch of something you made in the kitchen." No buttons.

**Record waste panel**
- Ingredient list failed to load: error text + **Try again** (refetch).
- **Taken from** segmented: **Cafe store** (default) · **Bakery store** — the store the waste comes out of; changes the on-hand hint.
- **Ingredient** select (required) — "Choose…" then every active purchased and prepared ingredient (no shop stock). Hint "In the cafe store: {qty}" / "In the bakery store: {qty}".
- **Quantity ({unit})** / **Quantity** (required) — number filter. Error "Enter a number above zero."
- **What happened** select (required): **Spill: dropped or spilled** (default) · **Spoilage: went bad before its date**.
- **Note** (required) text box, max 300 chars, placeholder "e.g. dropped a tray of milk", hint "Say briefly what happened."
- **Record waste** (primary, ban icon) — disabled until ingredient, quantity > 0 and a note; tooltip "Choose an ingredient, enter a quantity and add a note." Sends `mutate('stock.waste', {ingredientId, qty, movementType, reasonCode, location})` → `app.record_waste(p_ingredient_id, p_qty, p_movement_type, p_reason_code, p_idempotency_key, p_device_id, p_location)`, consuming the store's batches first-expiring-first. On the station app it always rides the durable offline queue (works offline): toast "Waste recorded." when the server answered within 8 s, else "Waste saved on this station. Stock updates when the connection is back."; in a plain browser it calls the RPC directly. Quantity and note clear; ingredient, kind and store stay. Errors under the form: "Choose spill or spoilage as the kind of waste.", "A reason is required.", "This belongs to another branch…", "Invalid input…", "Invalid quantity.", "You do not have permission for that."
- Footnote "Items voided after sending are recorded by the till. Expired batches are written off on" + **Expiry** (ghost) → navigates to `/stock/expiry`.

**Record production panel**
- Lead "Made a batch of something, like a sauce? Enter how much you made. What went into it comes off stock by its recipe."
- Ingredient list failed: error + **Try again**.
- No prepared items: "No prepared items yet. Mark an ingredient as made in the kitchen, then give it a recipe." + **Ingredients** → navigates to `/stock/ingredients`.
- **Made in** segmented: **Cafe store** · **Bakery store** (default) — hint "Its ingredients come out of this store first, then the other one. The batch goes into this store."
- **Prepared item** select (required) — "Choose…" then active prepared items. Hint "In the bakery store: {qty}" / cafe.
- **Amount made ({unit})** / **Amount made** (required) — number filter; error "Enter a number above zero."
- **Record production** (primary, flame icon) — disabled until an item and amount > 0; tooltip "Choose a prepared item and enter how much you made." Calls `app.record_production(p_ingredient_id, p_qty, p_location)` directly (online-only, no idempotency key): consumes the recipe's components first-expiring-first and mints the prepared batch at computed cost. Success toast "Production recorded. It cost {cost} per {unit}."; amount clears; every stock read (and Made today) refreshes. Errors: "This item has no recipe yet. Ask a manager to add one.", "Only prepared items can be made here.", "Invalid quantity.", "This belongs to another branch…", "You do not have permission for that."

**Made today panel** (read-only; every batch recorded this business day here or on the kitchen's phones, via `app.production_log_today`; refreshes every 60 s)
- Columns Time, Item, Made, Who. Rows not clickable.
- **View more ({n})** / **Show less** — 3 rows, then the rest.
- Empty: "Nothing made yet today." Read failed: error + **Try again**.

---

## Stock count — `/stock/counts`
This is the only place stock is corrected: a manager counts one store's shelves blind and finishes the count. It is also where a manager reviews and applies or discards counts the kitchen sent from the phone.

*Who:* manager, owner (`ROUTE_ROLES['/stock']`; `/stock/counts` has no key of its own, so it resolves to `/stock`; route guard `guarded('/stock', …)`). The owner can block a manager's `stock` area (Staff Access, 0345), and the page then refuses. In-screen gate: `can.adjustStock` (manager, owner, shop_staff). On `/stock` this is always true, because only manager and owner get in. It disables Start, the count inputs, Discard, Finish and Apply, and the hover reason is "Only a manager or owner can count stock." The owner and the manager see the same screen. The server allows manager, owner and shop_staff, and refuses shop_staff anything outside the shop store. *Source:* `features/stock/CountScreen.tsx`, `stockUi.tsx` (Footnote, useStoreName), `stockKeys.ts`, `storeLogic.ts`, `stockLogic.ts` (`countEntryState`, `matchesName`), `routes/stock.tsx` (badge).

**Getting here / badge**
- **Rail › Stock section › "Counting" dropdown › Stock count** — opens `/stock/counts`. Badge = number of phone counts waiting, from `stock_counts` where `source='phone'` and not finalized (`routes/__root.tsx`). The closed dropdown shows the badge too.
- **Sub-nav "Count and check › Stock count"** (only rendered when the active rail has no Stock section, for example a manager working from another workspace) — same target. Badge shows the number waiting, with the accessible label "{count} counts from the phone to apply". Refreshes every 60 s.

**Page header**
- Title "Stock count", subtitle "Count what is on the shelves. Where your number differs from the records, stock is corrected to your number." Read only.

**Counts from the phone** (panel shown only when ≥1 phone count is waiting for the Cafe or Bakery store; polls every 60 s)
- Panel title "Counts from the phone", badge "Waiting: {n}", lead "Counted blind on the phone. Stock changes only when you apply one." Read only.
- Each waiting count row shows the store name ("Cafe store" / "Bakery store") and "{name}, {when}" (who sent it, and when).
- **Review** / **Hide** (chevron toggle per row) — expands or collapses that count's review panel. Only one is open at a time. When exactly one count is waiting, it opens already expanded.
- **View more ({n})** / **Show less** — appears when more than 3 counts are waiting. Shows the rest in place.
- Inside an expanded count (`PhoneCountReview`):
  - Loading shows a skeleton. On error: the error line plus **Try again** (refetches the count lines).
  - Table columns: Ingredient ("Unknown ingredient" if the name can't be resolved) · Records said · **Counted** (editable) · Difference.
  - **Counted** input, one per line (decimal, LTR, unit shown after it) — prefilled with the phone's number. The manager can correct it. Blank, negative or non-numeric input turns the border red (aria-invalid), and Difference shows "—". Disabled while busy or without `adjustStock`.
  - **Difference** (live as you type) — "Matched", or a signed quantity ("−40 pcs") with "missing" or "extra" under it. Read only. Never shows money.
  - Footnote: "Records said is what the records showed when the count was sent."
  - **Discard** (trash icon, red text) → confirm "Discard this count?" / "{name} counted {store}. Stock does not change, and the count would need doing again." → **Discard count** (red) / **Cancel**. Calls RPC `app.discard_count(p_count_id)` (online, direct `appRpc`, no PIN). On success: toast "Count discarded. Stock is unchanged.", the panel collapses and stock queries refresh. Errors appear inline: FORBIDDEN "You do not have permission for that.", COUNT_NOT_FOUND "Count not found.", COUNT_FINALIZED "This count is already finalized.", and the network line.
  - **Apply count** (primary, check icon) → confirm "Apply this count?" / "Stock in {store} is corrected to these {count} numbers. Anything not on this count stays as recorded. This cannot be undone." → **Apply count** / **Cancel**. Calls RPC `app.finalize_count(p_count_id, p_lines=[every line with its counted_qty])`. This writes `count_adjustment` movements (shortage taken FIFO from batches; a surplus goes into the newest batch or a new one) and stamps the count finished. On success: toast "Count applied. Here is what it found." and the page **navigates to `/stock/variance`**. Disabled when any line is invalid, there are no lines, or `adjustStock` is missing; the hover reason is "Fix the boxes marked in red first: {count}." Errors appear inline: COUNT_FINALIZED, COUNT_LINE_NOT_FOUND "That ingredient is not part of this count.", INVALID_LINE "A line has a quantity or cost that is not a number above zero…", FORBIDDEN, and the network line.
  - Toast **Close** (X) dismisses a toast early (same for every toast below).

**Store tabs** ("Store to count"; Stock module shows two stores)
- **Cafe store** / **Bakery store** tabs — pick which store's count you see or start. A tab reads "{Store} · Counting" while a manager's count is open there. Arrow keys (direction-aware), Home and End move between tabs. Switching remounts the store panel, which resets search, filter and the recorded-amounts toggle; the typed draft is kept.

**Before a count (no open count at this store)**
- Panel "How a count works" with three read-only steps: 1 "Start the count" ("The app notes what the records say right now."), 2 "Count each ingredient" ("…The recorded amount stays hidden…kept on this station as you go."), 3 "Finish" ("Stock is corrected to your numbers, and Count differences shows what was missing or extra.").
- **Start count** (primary, scale icon) — RPC `app.start_count(p_location = store)`. It snapshots what the records say for every active ingredient at that store and opens the count. While it is open, deliveries and moves into that store are refused (STORE_BEING_COUNTED). On success the panel switches to the counting table (no toast). Disabled when a phone count is waiting for this store (hover and a warning line under the button: "A count from the phone is waiting for {the cafe store}. Apply or discard it first.") or without `adjustStock`. Errors appear inline: COUNT_IN_PROGRESS "A count is already in progress — finalize it first.", FORBIDDEN, and the network line.
- "Last count finished {date}" or "Never counted" (for this store). Read only.
- **Count differences** (ghost, ↗) — shown only when this store has a finished count. Navigates to `/stock/variance`.
- Loading shows a skeleton. Error: "This could not be loaded." + "You may be offline…" + **Try again** (refetches the open count).

**While counting (an operator count is open at this store)**
- Progress line: "Started {time} · {entered} of {total} entered". Read only.
- **All / Not entered / Entered** (segmented, "Show") — narrows the lines to all, to those still blank or invalid, or to those with a valid number.
- **Search ingredients** (search box) — filters by English or Arabic name. **Clear** (X in the box) or Esc clears it.
- "{shown} of {total}" result count. Read only.
- **Show recorded amounts** / **Hide recorded amounts** (eye toggle, aria-pressed) — adds or removes the "Records say" column (the snapshot figure). Counting is blind by default.
- Table columns: Ingredient · (Records say) · **Counted**.
  - **Counted** input per ingredient (decimal, LTR, unit after it, accessible name = the ingredient) — what you see on the shelf. Each keystroke autosaves to this station's localStorage (`touch-operator-count-<countId>`), so a reload or crash keeps it. A negative or non-numeric value gets a red border. Blank means "not counted, stays as recorded". Disabled while busy or without `adjustStock`.
- Filtered to nothing: "Nothing matches those filters." + **Clear filters** (clears search and sets the filter back to All).
- Footnote: "Leave blank what you did not count. It stays as recorded."
- **Discard this count** (trash, red text) → confirm "Discard this count?" / "Stock does not change and the numbers entered are lost. Deliveries and moves into {the bakery store} can go ahead again." → **Discard count** (red) / **Cancel**. Calls RPC `app.discard_count(p_count_id)`, clears the local draft, toasts "Count discarded. Stock is unchanged." and the screen returns to the Start panel. Disabled while busy or without `adjustStock`. Errors appear inline under the footnote.
- **Finish count** (primary, check) → confirm "Finish the count?" / "You entered {n} ingredients. Their stock will be corrected to your numbers. This cannot be undone." (or, with nothing entered: "You have not entered any numbers, so nothing will change. The count will still be closed.") → **Finish count** / **Cancel**. Calls RPC `app.finalize_count(p_count_id, p_lines = only the lines with a valid number)`, deletes the local draft, toasts "Count finished. Here is what it found." and **navigates to `/stock/variance`**. Disabled when any box is invalid ("Fix the boxes marked in red first: {count}.") or without `adjustStock`. Errors appear inline: COUNT_FINALIZED, COUNT_NOT_FOUND, COUNT_LINE_NOT_FOUND, INVALID_LINE, FORBIDDEN, and the network line.
- Every confirm dialog in this screen also closes with Esc, a backdrop click or its X, which all mean Cancel.

---

## Count differences — `/stock/variance`
For one finished count, this page shows what the records said against what was counted per ingredient, and what explains the gap, with each ingredient's movements one click away. It is read only.

*Who:* manager, owner (`ROUTE_ROLES['/stock']`; the `stock` area can be blocked per manager). No in-screen capability gates. The owner and the manager see the same page. *Source:* `features/stock/VarianceReport.tsx`, `LedgerDrawer.tsx`, `stockUi.tsx` (KindFilter, useStoreName), `features/analytics/exportTables.ts`.

**Getting here**
- **Rail › Stock › "Counting" › Count differences**. Also reached from Stock count after Finish or Apply, from the "Count differences" button on the Stock count start panel, and from On hand.

**Page header**
- Title "Count differences", subtitle "What each count found against what the records said, and where stock went in between."
- **Export** (file icon; tooltip "Current filters and dates") — downloads `count-differences-<YYYY-MM-DD>.xlsx`. It holds every row the current Show and Café/Shop choice lets through (not just the 3 drawn). Columns: Ingredient, Unit, Records said, Counted, Difference, Sold, Expected waste, Recorded waste, Voided after sending, Expired, Product tests, Store, Moved. Arabic exports are laid out right to left. Disabled when no rows are listed.

**Empty, loading and error states**
- No finished counts at all: "No finished counts yet" / "Count your stock to see what went missing and why." + **Count stock** (primary) → navigates to `/stock/counts`.
- Error: "This could not be loaded." + **Try again** (refetches both the count list and the rows).
- Loading shows a table skeleton.

**Toolbar**
- **Count finished** (select, accessible name "Choose a count") — the last 30 finished counts, newest first, labelled "{Store}, {date time}" (e.g. "Bakery store, 26 Sep 14:02"; shop-store counts appear too, as "Shop store, …"). The newest is chosen by default. Changing it reloads the rows for that count.
- **Only differences / All ingredients** (segmented, "Show") — the default lists only ingredients whose difference is not zero.
- **All / Café / Shop** (segmented, "Café or shop stock") — shown only when the chosen count contains shop (retail) stock. Narrows the rows by kind.
- "{shown} of {total}" result count. Read only.

**Summary line**
- "Ingredients that differed: {differed} of {total}" or "Every ingredient matched the records.", followed by " · Covers {from} to {to}" (or "Covers everything up to {to}" for the first count). Read only.

**Table** (3 rows, then View more)
- Columns, read only: Ingredient · Records said · Counted · Difference ("Matched", or a signed quantity with "missing" (red) or "extra") · Sold · Expected waste · Recorded waste · Voided after sending · Expired · Product tests · Moved (signed, with "in" or "out") · [History].
- **History** (ghost button, file icon, one per row) — opens the ingredient's **History drawer**, limited to that count's period movements (`movement_ids`).
- **View more ({n})** / **Show less** — shows the remaining rows in place.
- "Only differences" with nothing differing: "Every ingredient matched the records." + **All ingredients** (switches Show to All).
- No row click and no column sorting.

**History drawer** (`LedgerDrawer`, modal, xl)
- Title "History: {ingredient}", subtitle "What changed this ingredient's stock between this count and the one before."
- Table columns (read only, scrolls inside the dialog): When · What happened (Delivery, Made in the kitchen, Sold, Used to make a prepared item, Spill, Spoilage, Voided after sending, Expired written off, Count correction, Returned by a refund, Used in a product test, Moved between stores; "More than was on record" under a sale line that ran past the batches) · Change (signed, green or red) · Store · Cost per {unit} · By (staff name) · Note.
- **Open the product release** (ghost button in Note, on product-test lines) — closes the drawer and navigates to `/protocols?run=<runId>`. That page is manager and owner only.
- Note for a move: "To the bakery store" / "From the cafe store" etc. Other lines show the raw reason code or "—".
- Empty: "Nothing has changed this ingredient's stock yet." Error: **Try again** (refetch).
- **Close** (footer), **X** (header), Esc and a backdrop click all close it. There are no Newer/Older paging buttons in this period mode.

---

## Ingredients — `/stock/ingredients`
This page is the master list of everything the café buys or makes (unit, supplier, pack size and price, stock levels, recipe maths), where ingredients are added, edited and switched off.

*Who:* manager, owner (route). Server: `app.upsert_ingredient` is manager and owner only. There are no in-screen capability gates, and the owner and the manager see the same page. Touch Shop stock rows (kind `retail`) are left out; they are managed with their product on the shop desk. *Source:* `features/stock/IngredientsAdmin.tsx`, `IngredientForm.tsx`, `stockUi.tsx`, `stockLogic.ts`, `components/inputs.tsx` (BilingualFields), `components/Switch.tsx`.

**Getting here**
- **Rail › Stock › "Recipes and costs" dropdown › Ingredients**.

**Page header**
- Title "Ingredients", subtitle "Everything the venue buys or makes, with its unit, supplier, price and stock levels."
- **New ingredient** (primary, plus) — opens the ingredient dialog empty.

**Empty, loading and error states**
- No ingredients: "No ingredients yet" / "Add the first ingredient. Its unit and type can be changed until stock has been recorded for it." + **New ingredient**.
- Error: **Try again** (refetch). Loading shows a table skeleton.

**Toolbar**
- **Search ingredients** (search box; matches the English or Arabic name) — **Clear** (X) or Esc empties it.
- **Show the {count} not in use** (switch) — shown only when some ingredients are switched off. Adds them to the list.
- "{shown} of {total}" result count.

**Table**
- Columns: Ingredient (name, "Prepared" marker for kitchen-made, "Not in use" badge) · Supplier (truncated; hover shows the full name) · Pack (size + pack price) · On hand · Par · [Edit].
- **Edit** (ghost, note icon, one per row) — opens the dialog for that ingredient.
- **Row click**, or Enter/Space on a focused row — opens the same dialog.
- Filtered to nothing: "Nothing matches those filters." + **Clear filters** (clears search and turns "not in use" off).

**Ingredient dialog** (`IngredientForm`, modal lg) — title "New ingredient" or "Edit {name}"
- Subtitle when editing: "On hand: {qty}. Stock is never typed in. If it is wrong," + **Count stock** (ghost) → navigates to `/stock/counts`. This leaves without the unsaved-changes check.
- Section "What it is":
  - **Name (English)**, **Name (Arabic)** (text, required) — Save stays disabled with "Fill in both names first." until both are filled. The server trims them (NAME_REQUIRED "Both the English and Arabic names are required.").
  - **Measured in** (select: Grams (g) / Millilitres (ml) / Pieces (pcs); default Grams) — disabled with "Locked: this ingredient already has stock history." once any stock movement exists. The server answers UNIT_LOCKED "The unit is locked — the ledger already holds quantities in it."
  - **Type** (select: Bought from a supplier / Made in the kitchen (has its own recipe)) — locked the same way (server KIND_LOCKED). A kitchen-made item then appears under Recipes › Prepared items.
- Section "Buying it":
  - **Supplier** (optional free text; the screen does not use the supplier records).
  - **Shelf life (days)** (optional, numeric) — hint "Sets the expiry date when a delivery has none."; shows "Enter a number." if it isn't one. A decimal is refused by the server ("Something was sent in the wrong format. Refresh and try again.").
  - **Pack size ({unit})** (optional, decimal) — "Enter a number." if it isn't one; server INVALID_PACK "Pack size must be greater than zero." for 0 or less.
  - **Pack price (IQD)** (optional, numeric) — hint "Prefills the cost when a delivery is recorded."; server INVALID_COST "Cost must be a whole IQD amount of 0 or more, or left blank." for a negative; a decimal is refused as wrong format.
- Section "How much to keep":
  - **Par ({unit})** (optional) — hint "The amount you like to keep. Under this shows as Below par."; "Enter a number." if it isn't one.
  - **Reorder point ({unit})** (optional) — hint "At or under this shows as Running low and raises an alert."; errors "Enter a number." and "The reorder point cannot be above par. Lower it or raise par to save." Negative values are not blocked on screen.
- Section "Recipe maths":
  - **Usable after prep (%)** (default 100) — hint "100 if nothing is trimmed or peeled off."; error "Enter a number above 0 and up to 100." (server INVALID_YIELD).
  - **Expected waste (%)** (default 0) — hint "Normal loss, so counts do not show it as missing."; "Enter a number." only. A value above 100 or below 0 is refused by the server (INVALID_WASTE_ALLOWANCE "Waste allowance must be between 0 and 100.").
- **In use** (switch) + "Turn off to hide it from deliveries, recipes and counts." — this is how an ingredient is archived or restored. It is saved with Save.
- **Save** (primary, check) — RPC `app.upsert_ingredient(p_id or null, names, unit, kind, pack size, pack price, supplier, shelf life, yield %, waste %, par, reorder point, is_active)` (online, direct, no PIN, audited `stock.ingredient.create`/`update`). On success: toast "Saved.", the dialog closes and stock lists refresh. Disabled when names are missing, a field is marked red, or (when editing) nothing changed ("Change something to save."). Server errors appear under the form: the codes above, plus FORBIDDEN, INGREDIENT_NOT_FOUND, VENUE_MISMATCH and the network line. While saving, Esc, the X, the backdrop and Cancel are all inert.
- **Cancel** (footer), **X** (header), Esc — with unsaved changes they ask "You have unsaved changes" / "Everything you changed here will be lost. Are you sure you want to close?" → **Keep editing** / **Discard changes** (red, paired). A backdrop click on that prompt shakes it instead of answering. With no changes they close straight away.
- Backdrop click on the dialog itself — same as Cancel (asks first if there are unsaved changes).

---

## Recipes — `/stock/recipes`
This page sets what goes into each menu item size, add-on and kitchen-made (prepared) item. Selling one then takes its recipe off stock. It leads with what has no recipe yet.

*Who:* manager, owner (route). Server: `app.set_recipe` and `app.set_batch_yield` are manager and owner only. There are no in-screen capability gates, and the owner and the manager see the same page. A head's recipe *change request* is decided elsewhere (`decideRecipeChanges`, owner); it is not on this page. *Source:* `features/stock/RecipeEditor.tsx`, `stockUi.tsx` (AttentionList), `stockKeys.ts`.

**Getting here**
- **Rail › Stock › "Recipes and costs" › Recipes**. Also from the Margins empty state.

**Page header**
- Title "Recipes", subtitle "What goes into each item. When it sells, its recipe comes off stock."

**Kind switch**
- **Menu items / Add-ons / Prepared items** (segmented) — changes which list is shown and resets Show and search. A hint line under it: "Each size has its own recipe." / "Taken on top of the item it is ordered with. A double shot takes the coffee twice." / "What goes into a batch you make in the kitchen, like a sauce." Lists hold sizes of active menu items, active add-ons, and active prepared ingredients.

**Empty, loading and error states**
- Empty per kind: "No menu items yet." / "No add-ons yet." / "No prepared items yet. Mark an ingredient as made in the kitchen under Ingredients." No button.
- Error: **Try again** (refetches the list and all recipe lines). Loading shows a skeleton.

**Attention panel**
- "{n} · No recipe yet" + hint ("Selling these takes nothing off stock, so counts will show their ingredients as missing." / "Ordering these takes nothing extra off stock." / "Making a batch of these takes nothing off stock.") + **Show which** (↗) → sets Show to "No recipe". With none missing: "Everything here has a recipe."

**Toolbar**
- **All / No recipe / Has a recipe** (segmented, "Show").
- **Search** (search box; matches the item and size name in the current language) — **Clear** (X) or Esc.
- "{shown} of {total}" result count.

**Table** (dense)
- Columns: Item and size / Add-on / Prepared item (name, size muted) · Recipe ("No recipe" warn badge, or "Ingredients: {n}") · [action].
- **Add recipe** (plus) for an entry with no lines, **Edit** (note icon) for one with lines — opens the recipe dialog.
- **Row click**, or Enter/Space on a focused row — opens the recipe dialog.
- Filtered to nothing: "Nothing matches those filters." + **Clear filters** (Show to All and empty search).

**Recipe dialog** (modal lg) — title "Recipe: {item · size}", subtitle "Amounts for one serving." / "Amounts for one add-on." / "Amounts to make one {unit}."
- **Sizes:** row (menu items with more than one size) — the current size is a highlighted badge. **{Other size}** buttons (marked "· No recipe" when that size has none) switch the dialog to that size. With unsaved changes they ask first ("You have unsaved changes" → **Keep editing** / **Discard changes**).
- With no lines: "No ingredients yet" + the kind's hint.
- Per line:
  - **Ingredient** (select: "Choose…" + every active ingredient by name; a prepared item cannot pick itself).
  - **Amount ({unit})** (decimal, LTR; the label shows the chosen ingredient's unit, otherwise "Amount") — red border when a number ≤ 0 or not a number is typed.
  - **Remove line {n}** (X icon button, also as tooltip) — deletes the line from the draft.
- **Add ingredient** (plus) — appends an empty line.
- Validation line: "Every line needs an ingredient and an amount above zero. Fill it in or remove it." A completely empty line is ignored on save. The same ingredient may be added twice (nothing blocks it).
- **One batch makes ({unit})** (Prepared items only; decimal, optional) — hint "When a chef records a batch on the phone, this amount is filled in. Leave it empty if there is no usual batch size."; error "Enter an amount above zero, or leave it empty." (must be >0 and <1e9).
- **Save recipe** (primary, check) — if the lines changed: RPC `app.set_recipe(p_target 'variant'|'modifier'|'output', p_target_id, p_lines [{ingredient_id, qty}])`, an atomic replace (an empty list clears the recipe). If the batch size changed: RPC `app.set_batch_yield(p_ingredient_id, p_batch_yield or null)`. Both are online, direct and audited, with no PIN. On success: toast "Recipe saved.", the dialog closes and the lists refresh. Disabled when nothing changed ("Change something to save."), a line is incomplete, or the batch is invalid. Server errors appear inline: RECIPE_CYCLE "That would make a sub-recipe contain itself (or nest too deep).", INVALID_QTY "Invalid quantity.", INGREDIENT_NOT_FOUND, VARIANT_NOT_FOUND "Size not found.", MODIFIER_NOT_FOUND "Modifier not found.", NOT_PREPARED, VENUE_MISMATCH, FORBIDDEN, and the network line.
- **Cancel** (footer) — with unsaved changes asks "You have unsaved changes" → **Keep editing** / **Discard changes** (a backdrop click on the prompt = Keep editing). Otherwise it closes.
- **X**, Esc, backdrop click — close the dialog, and with unsaved changes ask the same question *after* the dialog has faded (see note in reply).

---

## Margins — `/stock/margins`
This page shows what each menu item size costs to make against its price, at the latest delivery prices, and picks out the items that sell at a loss or on a thin margin. It is read only.

*Who:* manager, owner (route). No in-screen gates, and the owner and the manager see the same page. Data: view `v_item_margin`; sizes without a recipe are not listed. *Source:* `features/stock/Margins.tsx`, `stockLogic.ts` (`marginFlag`, `sortMargins`, `THIN_MARGIN_PERCENT = 30`), `stockUi.tsx`.

**Getting here**
- **Rail › Stock › "Recipes and costs" › Margins**.

**Page header**
- Title "Margins", subtitle "What each menu item costs to make against its price, at the latest delivery prices. Items with no recipe are not listed."

**Empty, loading and error states**
- No costed items: "No costed items yet" / "Give menu items a recipe to see what they cost to make." + **Recipes** (primary, ↗) → navigates to `/stock/recipes`.
- Error: **Try again** (refetch). Loading shows a table skeleton.

**Panel "Items that earn too little"**
- "{n} · Sell at a loss" (red) — "They cost more to make than they sell for. Raise the price or change the recipe." + **Show which** → sets the filter to Loss.
- "{n} · Margin under 30%" (amber) — "They make little per sale. Check their price and recipe." + **Show which** → sets the filter to Thin.
- With neither: "Every item makes at least 30% margin."

**Toolbar**
- **All / Loss / Thin** (segmented, "Show").
- **Search items** (search box; matches English and Arabic item and size names) — **Clear** (X) or Esc.
- **Sort by** (select): Margin %, lowest first (default) · Margin %, highest first · Margin, lowest first · Margin, highest first · Price, highest first · Price, lowest first · Cost to make, highest first · Cost to make, lowest first · Name, A to Z. Items with no margin % always sort last.
- "{shown} of {total}" result count.

**Table**
- Columns, read only: Item (name + size) · Price · Cost to make · Margin (red when negative) · Margin % (with a "Loss" or "Thin" badge). No row click, no header sorting, no export.
- Filtered to nothing: "Nothing matches those filters." + **Clear filters** (resets Show to All, empties search, sorts back to Margin %, lowest first).

---

## Stock value — `/reports/stock`
This read-only report answers what is on the shelves worth and what needs attention: out of stock, running low, below par, expiring, expired, what was used in the period, and the period's count differences.

*Who:* manager, owner (`ROUTE_ROLES['/reports']`; the child is `guarded('/reports', …)`; the `reports` area can be blocked per manager). No in-screen capability gates. **Owner only:** the Branch picker (multi-branch or closed-branch history). The report strip (Revenue / Courts / …) is not drawn here for either role, because Stock value is alone in the Stock section (`ReportTabs` hides itself under 2 tabs). *Source:* `features/reports/StockReport.tsx`, `ReportParts.tsx` (ReportFrame, ViewSwitch, ReportTable, ColumnNotes, TableHint, exportTable), `ReportBranchScope.tsx`, `ReportTabs.tsx`, `components/kit.tsx` (DateRangeControl, ExportButton, HeadlineFigure), `features/ops/opsLogic.ts` (`STOCK_HREF`). DrillDialog and ReportFilterBar are not used by this report.

**Getting here**
- **Rail › Stock › Stock value** (a plain row, outside the dropdowns).

**Branch scope** (owner only; above the page; shown only when the owner has more than one branch or any closed branch)
- **Branch** (segmented): **{current branch}** (default) · **All branches** (when >1 branch) · **{name} (closed)** per closed branch. It changes which branch(es) `report_stock` reads (the `x-venue-scope` header) and reloads every report query. Under "All branches" a note reads "All branches are shown on {name}'s clock and business day." Leaving the reports pages resets it.

**Page header**
- Eyebrow "Reports", title "Stock", subtitle = the period ("1 Oct 2026 – 16 Oct 2026", or one day).
- **Export** (file icon; tooltip "Downloads the table on screen, every row, as a spreadsheet file.") — downloads `stock_<from>_<to>_view-<view>.xlsx` of the list currently shown (all rows, not just the 3 drawn). Bare quantities with a separate Unit column. The Count differences export adds a "Counted at" time column and follows the "Only counts that differ" checkbox. Disabled until the report has loaded.

**Period**
- **Period** preset select: Today · Yesterday · This week · Last week · This month (default, counted from the venue's business day) · Last month · Last 30 days · Custom (not selectable; shown when the dates were typed).
- **From** / **To** date fields — typing sets a draft.
- **Apply** (appears once a date was changed; disabled when From is after To) — applies the typed dates.
- Period controls are disabled during the first load. Only "Used" and "Count differences" depend on the period; the rest is "now". The report refreshes itself every 2 minutes.

**Headline figures** (read only, not clickable)
- "On the shelves" (IQD, hint "Right now, at what the stock cost") · "Out of stock" (count) · "Running low" · "Below par" · "Expiring soon" · "Expired". Each turns red or amber when above zero.

**Show switch**
- **Show** (segmented): Out of stock · Running low · Below par · Expiring soon · Expired · Used · Count differences. A lead sentence under it explains the list (e.g. "Ingredients under the amount you aim to keep, biggest shortfall first.").
- **Only counts that differ** (checkbox, Count differences view only, shown when the period has any count rows; on by default) — hides lines with a zero difference.
- **Open in inventory** (↗; Out of stock / Running low / Below par) → navigates to `/stock?filter=out` / `?filter=low` / `?filter=belowPar` (On hand, pre-filtered).
- **Open expiry list** (↗; Expiring soon / Expired) → navigates to `/stock/expiry`.
- **Open stock counts** (↗; Count differences) → navigates to `/stock/counts`.
- (The Used view has no open button.)
- Note above the "now" lists: "Right now. The period above does not change this list."

**Tables** (dense; 3 rows, then **View more ({n})** / **Show less**; no row click)
- Every column header is a **sort button**. The first click sorts numbers biggest first and text A→Z; clicking again reverses. The Ingredient column truncates, and hovering shows the full name.
- Out of stock: Ingredient · On hand · Par.
- Running low: Ingredient · On hand · Alert level · Par.
- Below par: Ingredient · On hand · Par · Short by.
- Expiring soon: Ingredient · Store · Quantity · Use by · Days left · Value.
- Expired: Ingredient · Store · Quantity · Use by · Days past · Value.
- Used: Ingredient · Used · Cost.
- Count differences: Counted (date and time) · Ingredient · Store · Expected · Found · Difference · Product tests · Moved (signed).
- Empty per view: "Nothing is out of stock." / "Nothing is running low." / "Everything is at or above par." / "Nothing expires soon." / "No expired stock on the shelves." / "No stock was used in this period." / "No stock counts were finished in this period." / "Every count in this period matched." (when the checkbox hides everything; untick it to see all).
- "Reading the table" notes under the table (read only), for example "Par is the amount you aim to keep in stock.", "At the alert level an ingredient shows as running low.", "Expected is what deliveries, sales, waste and production say should be there. Below zero means less was found."

**Loading and error states**
- Loading shows a report skeleton. Error: "This could not be loaded." + "You may be offline…" + **Try again** (refetch).

---

## Shop (Stock rail row) — `/shop`
This row on the Stock section's rail is the way into the Touch Shop desk, the shop's own workspace with its till, drawer, stock store, products and suppliers.
*Who:* The row is in `STOCK` (lib/workspaces.ts), which shows on the owner's Management rail (Stock section) and the manager's Operations rail (Stock section, opened from its row). Route `/shop` and every child: `ROUTE_ROLES['/shop']` = shop_staff, manager, owner. Longest-prefix match; a person whose page the owner blocked (0345) gets "The owner has closed this page for you. Ask them if you need it." A role outside the list gets the refusal card (PermissionRefusedNotice "Opening this screen" + the role it needs) and the link **Go to my home screen**. shop_staff lands on `/shop` as home (homeRoute) and holds only the `shop` workspace. *Source:* lib/workspaces.ts (STOCK, SHOP), routes/shop.tsx, routes/shop/_children.ts, lib/auth.tsx.
**The row**
- **Shop** (tag icon) — navigates to `/shop` (the Sell page). `workspaceForRoute('/shop…')` = `shop`, so the rail turns into the Touch Shop workspace ("Touch Shop", lead "The shop till, its drawer, stock and products"). Managers and owners have `shop` in workspacesForRole, so they get the same rail as the shop assistant.
**The Touch Shop rail (one row per child route, in this order; each just navigates)**
- **Sell** (grid icon, exact match) → `/shop`.
- **Cash drawer** (drawer icon) → `/shop/drawer`.
- **Shop stock** (package icon) → `/shop/stock`.
- **Goods in** (box icon) → `/shop/receive`.
- **Stock count** (scale icon) → `/shop/counts`.
- **Products** (tag icon) → `/shop/products`.
- **Suppliers** (users icon) → `/shop/suppliers`.
- (The rest of the shell, such as the workspace switcher, Go on break, the till shift row (Start my shift / My shift · since {time} / End my shift / Close {name}'s shift), the guide and Sign out, is the shell's and is covered there. The guide has a Touch Shop section whose links point at these same routes.)

---

## Sell — `/shop`
This is the shop till: scan or tap products into a basket, then take Cash or Card on the spot and print a receipt. Every sale is its own 'shop' tab.
*Who:* shop_staff, manager, owner (route). In-screen: **Member** and the member step need `attachMember` (cashier, shop_staff, court_desk, manager, owner), so every /shop role has them. **Customer discount** uses the same set (`canDiscount` = attachMember) and needs a server with 0342. The payment's shift gate holds back shop_staff (in SHIFT = `permissions.takeCourtPayment`) on a station with a drawer (mode till/desk/shop). manager/owner (`payOnOthersShift`) are never gated and get a banner instead. *Source:* features/shop/ShopTill.tsx, shopTillLogic.ts, features/till/PaymentPane.tsx, BillView.tsx, barcodeWedge.ts, NewTabDialog.tsx (openTabOn), features/loyalty/MemberAttach.tsx, features/discounts/BillDiscountDialog.tsx + DiscountEditor.tsx + useCustomerDiscount.ts, features/tillShift/ShiftDialog.tsx, components/ui.tsx (AmountPad).
**Header**
- Title "Sell", lead "Scan a barcode or tap a product. Every sale is paid here, on the spot." (read only).
**Products panel (left)**
- **Empty state**: shows "No shop products yet" / "Add the shop’s products under Products. They appear here to sell." when the cached till menu has no shop sizes. Its one action:
  - **Open Products** (primary) → navigates to `/shop/products`.
- **Search box** (large; placeholder "Search by name, SKU or barcode…") — filters the tiles client side by English or Arabic name, size name, SKU or barcode (substring match). No server call.
  - **Clear** (x icon inside the box, shown once there is text) — empties the search.
  - **Esc** in the box — empties the search.
- **Section filter buttons** (a row of toggle buttons, aria-pressed): **All**, then one button per active shop section (menu_categories.kind = 'shop', is_active, in sort order) — narrows the tiles to that section. Client only.
- **Product tile** (one per size; shows the name, or "Product · Size" when the product has several sizes, plus the price) — click adds one to the basket (`addToBasket`; a size already in the basket goes up by 1). Disabled when the item is not orderable (sold out or unavailable today, shown greyed with "Out of stock") or while a sale is being rung up (busy). Clicking also clears the "not found" notice.
- **Barcode scan (USB keyboard-wedge scanner, anywhere on the page)** — a burst of 6 or more code characters `[0-9A-Za-z-]`, each within 50 ms of the last and ended by Enter, is read as a scan (BarcodeWedge in 'filter' mode, so nothing is held back). It is ignored while any modal is open, while busy, paying, the receipt is up, the member step is up or the member dialog is open.
  - If the code matches a size's barcode exactly, or its SKU ignoring case → that size goes into the basket +1 and the search box (which the scanner typed into on its way) is cleared.
  - No match → refused notice "No product has the code {code}." above the tiles.
  - If the code is a member card (TP-… token, `isMemberScan`) → the search is cleared and the member dialog opens pre-filled and looks the code up at once (see **Member** below).
**Sale (basket) panel (right)**
- Empty: "Scan or tap a product to start a sale."
- Per basket line (name, line amount at the shelf price, quantity):
  - **−** (minus icon; aria "One less {name}") — quantity −1. At 0 the line is removed. Disabled while busy.
  - **+** (plus icon; aria "One more {name}") — quantity +1. Disabled while busy.
  - **×** (x icon; aria "Remove {name}") — removes the line. Disabled while busy.
- **Total** — the basket at menu prices (read only), with "{count} items · At the shelf price. The receipt shows what was charged."
- **Member** (userPlus icon) — opens the "Add a member to this bill" dialog. Disabled while busy. The member is only HELD for the next sale here; nothing is written yet.
  - Dialog "Add a member to this bill", lead "Scan the QR on their member card, or type the phone number they tell you."
    - Field **Member QR or phone number** (placeholder "Scan, or type 07…", max 40). **Enter** submits, and a scanner's Enter does the same. Validation: "That isn't a member code or a phone number. Scan again, or type the whole number."
    - **Find member** (primary, search icon) → RPC `app.loyalty_identify` (online only). Disabled when the box is empty, or when the station cannot reach the server, with the reason "Adding a member needs a connection." Errors: e.g. MEMBER_NOT_FOUND "No account has that member code or phone number."
    - **Cancel** / X (Close) / Esc / backdrop — close without a member. Not closable while busy.
  - Once a member is held, a member chip shows their name (or "Member"), "Tier {tier}", masked phone and "{points} points", with the note "The member is added when you take payment."
    - **Remove** (ghost, x icon) — drops the held member. Client only, no RPC.
- **Cash** (primary, large) — rings the basket up as one sale and opens the Cash payment. Disabled while the basket is empty.
- **Card** (primary, large) — the same, but opens the Card payment.
  - What either press writes, in order:
    1. `tab.open` through the durable queue (`mutate` → `app.open_tab`, `p_kind: 'shop'`, label = the time it was rung up as HH:MM:SS). Offline it is queued on disk and becomes a local offline tab.
    2. `order.add_items` with `shop: true` (queued; → `app.till_add_items`). Offline the lines are kept on the local tab.
    3. Online only: it re-reads the tab (`fetchTabDetail`), so the server's total (tax, rounding) is what is charged.
    4. The basket is emptied.
    5. If a member was held and the tab is a server tab, `app.set_tab_customer` attaches them (online only) and the **Member on this sale** step opens. A refusal (for example a staff member, PIN_GRANT_REQUIRED "Manager authorisation expired — enter the PIN again.") leaves the sale without the member: the error shows in the payment pane, and the shop till offers no PIN dialog for it. Offline the held member is dropped silently.
    6. Otherwise the payment pane opens.
  - Errors before payment (e.g. NO_OPEN_DAY "No business day is open.", TAB_KIND_MISMATCH "Shop items and café items never go on the same bill.", TAB_KIND_FORBIDDEN) show under the buttons.
- **Clear sale** (ghost; shown when the basket has lines) — the browser's native confirm "Clear this sale? Nothing has been charged yet.": **OK** empties the basket, **Cancel** keeps it. Client only. Disabled while busy.
**Unfinished sales panel** (shown when there is an open or awaiting-payment shop tab other than the one being paid; read from `tabs` kind='shop', refreshed every 30 s)
- Lead "Rung up but not paid. Take the payment, or ask a manager to remove the lines." The shop till itself has no remove or void.
- Per sale (its label, the time it was rung up):
  - **Take payment** — reads what the tab still owes (`fetchTabDetail`, total minus payments) and opens the payment pane, always in **Cash** mode. There is no Card choice for a resumed sale on this screen.
- **View more ({count})** / **Show less** — shows the list past 3 rows (useListCap).
**Member on this sale** (modal after Cash/Card when a member is attached; subtitle = the sale's label)
- Shows "Total" (what is still owed, re-read live), a "Customer discount" row (· the discount's label, minus amount) when one is on, and "Café at full price on this bill" when the standing café discount was waived on this bill.
- **Automatic (no press)**: when the member has a standing café/shop discount that the bill does not carry yet, or a percent no longer fits, the bill is refreshed once per state with `app.apply_customer_discount` (mode refresh). It is silent; a refusal leaves the bill as it was. Needs a discount role and 0342.
- Member block (MemberAttach, online only; every button is off with "Adding a member needs a connection." when the station is offline):
  - **Use points** (primary, star icon) — opens "Use points". Disabled when the balance is 0 ("No points to use yet."), when loyalty is off ("Loyalty is switched off. The member is on the bill, but points are not earned or used."), or offline.
    - Lead "{name} has {points} points."
    - Field **Points to use**, prefilled with the most that fit, hint "Up to {points} points fit what is left to pay." Errors: "No points to use yet." / "Nothing is left to pay on this bill." / "At least {min} points are used at a time." / "More than the {points} points the member has."
    - **Manager PIN** field (only when the card was not scanned just now; hint "The member’s card was not scanned just now. Scan it again, or a manager enters their PIN."; needs at least 4 digits) → `app.verify_manager_pin`, then the redemption spends that grant.
    - Line "Takes {amount} off the bill." / "The server works out the amount and never takes more than is left to pay."
    - **Use {points} points** (primary; Enter also confirms) → `app.loyalty_redeem` with points (the member token or the PIN grant). On success the block says "{points} points took {amount} off the bill." A refused token falls back to asking for the PIN.
    - **Cancel** / X / Esc.
  - **Rewards** (ticket icon) — opens "Rewards" ("{name} has {points} points."). Disabled when loyalty is off or offline.
    - With no reward list readable (the shop assistant, since rewards are management's read): "Rewards are listed for managers. Use points instead, or ask a manager."; with an empty list: "No rewards are on offer."
    - **Manager PIN** field (same rule as above).
    - Per reward (name, "{points} points" · "{amount} off" or "An item from the menu"): **Use** → `app.loyalty_redeem` with that reward. Disabled with "Not enough points" when the balance is short. Done: "Reward used: {amount} off the bill."
    - **Close**.
  - **Remove** (ghost, x icon) → `app.set_tab_customer(null)`: takes the member off the sale.
  - "Points used on this bill" list ("{points} points · {amount} off" / "Reward · {amount} off"), each row with **Undo** (undo icon) → `app.loyalty_unredeem`, then "Points given back to the member." **View more ({count})** / **Show less** past 3 rows.
- **Customer discount** (user icon; shown when the bill has a customer, the role may discount and the server has 0342) — opens the dialog "Customer discount" (subtitle = the customer's name). No manager PIN.
  - "On their record: {reason · parts}" when they have a standing discount.
  - Part **Café and shop**: segmented **None** / **%** / **IQD**, then the amount box (placeholder "e.g. 20" or "e.g. 5000"; unit "%" or "IQD off each bill"). Errors: "Enter how much." / "Enter a percent from 1 to 100." / "Enter an amount of at least 1 IQD." / "Set a discount on the café, the court fee, or both." (A shop sale has no court part.)
  - **Reason** chips (a radio group): **Sponsored**, **Family**, **Coach**, **Staff**, **Other**. Error "Choose a reason."
  - **Note** (shown only while Keep is ticked; placeholder "e.g. Plays for the club team"; max 120, error "Keep the note to 120 characters.").
  - Checkbox **Keep for {name} on every bill** (ticked by default). Hint "Saved on their record: every bill of theirs gets it from now on." or "This bill only. Their record stays as it is."
  - **Apply** (primary): ticked → `app.set_customer_discount`, then `app.apply_customer_discount` (standing), toast "Saved for {name}. Every bill of theirs gets it."; unticked → `app.apply_customer_discount` (part, or none to waive), toast "Discount added to this bill." A bill refusal (e.g. DISCOUNT_REQUIRES_REFUND) comes as an extra info toast. Disabled offline: "Discounts need a connection."
  - **Remove from this bill** (ghost, x icon; only when a discount is on the bill) → `app.apply_customer_discount` (none); toast "Discount taken off this bill."
  - **Cancel** / X / Esc. When the customer is the signed-in staff member: "This is your own bill. A colleague has to give you a discount." with only **Close**.
- **Take payment** (footer, primary) — re-reads what is owed (points may have come off) and opens the payment pane with the method chosen before. Closing the modal (X, Esc, backdrop) does the same. It cannot be closed while busy.
**Payment pane** (modal; the till's PaymentPane)
- **Shift gate first** (shop_staff, on a station with a drawer, gate not failing open):
  - No shift here → "Start my shift", subtitle "Start your shift to take payment.", plus the handover line ("{name} left {amount} in the drawer at {time}." / "You left …" / "The day opened with {amount} in the drawer." and "Since then, {amount} was taken/paid out here with no shift open.").
    - **That’s right** (primary, autofocus) → `app.heartbeat` (best effort) then `app.open_till_shift` with the prefilled float. Toast "Shift started." / "Shift started with {amount} more/less than was handed over." The pane then turns into the tender by itself.
    - **I counted a different amount** → opens the count: **Cash in the drawer now** (money input; hint "Everything in the drawer, float included.") + keypad, **Note** (optional, max 500; hint "What you found, if it is not what was handed over."), **Back**, **Start my shift** (primary).
    - Refusals shown on the panel: "The day is not open yet. A manager opens it on Day close." / "Sales made here are still waiting to send. Start once they are sent." / "Your shift is still open on {station}. End it there first." / "{name}’s shift is still open here."
  - Someone else's shift open → "{name}’s shift is still open", "Count {name}’s drawer and close the shift with a manager’s PIN, then start yours."
    - **Cancel**.
    - **Close {name}’s shift** → the close flow:
      - Count step: **Cash in the drawer** (money input + keypad), **Note** (optional), **Cancel** / **Next**.
      - Sign step: **Manager’s PIN** (password, digits), **Change the count**, **Close the shift** → `app.verify_manager_pin` then `app.close_till_shift_for`.
      - Result: "The drawer matches" / "Short by …" / "Over by …", the figures, then **Cancel** / **Start my shift**.
  - My shift open on another station → "Your shift is open on {station}", "End it there, then start one here." with **Done**.
  - manager/owner instead see a banner at the top of the tender: "This payment goes into {name}’s drawer." or "No shift is open here, so this payment is counted outside a shift."
- **Cash** pane (title "Cash"):
  - "To pay" + the amount due.
  - **Part payment** switch → shows the **This payment** amount box (digits only, capped at what is due) and "Of {amount} still owed on this tab."
  - **Tendered** box (autofocus, digits only). **Enter** records the payment.
  - Quick tender buttons (group "Amount handed over"): **Exact amount**, then up to 3 round sums by the 5,000 / 10,000 / 25,000 / 50,000 notes — each sets Tendered.
  - Keypad: **1**–**9**, **000**, **0**, **Delete** (backspace icon), **Clear**. Keyboard digits, Backspace and Enter work on the focused keypad.
  - Change line "Change to give {amount}" / "Still short {amount}".
  - **Record payment** (primary, banknote icon). Disabled with: "Enter an amount to record." / "Enter what the guest handed over." / "The tendered amount does not cover what is due."
  - **Cancel** / X / Esc / backdrop — closes the pane. The sale stays open and is listed under Unfinished sales.
- **Card** pane (title "Card"):
  - "To pay", the **Part payment** switch + **This payment** box, and the note "Take the payment on the card machine, then record the amount it approved."
  - **Record payment** (primary, card icon; disabled with "Enter an amount to record.").
  - **Cancel**.
- What **Record payment** writes: `tab.settle` through the queue (→ `app.settle_tab`, with p_expected_total_iqd = the due shown, tendered for cash, amount for a part payment).
  - A part payment keeps the pane open with the new remainder.
  - TOTAL_CHANGED: the pane reloads the due and shows "The bill changed while you were paying. Check the new total and try again."
  - An offline (local) sale queues `tab.settle` by its tab key. The server charges its own full due when it replays it, so a typed part amount is not sent.
- Not dismissible while busy.
**After payment**
- Online sale with its server bill → (if cash change > 0) a status banner "Change: {amount}" at the top, plus the receipt modal "Bill": "Touch Padel", "Touch Shop · {label}", the time, the lines (qty × name (size), with modifiers), Subtotal, Discount, Tax / Tax (included), Total, the payments ("Cash −…" / "Card −…"), "Still to pay" (when something is left), and "Thank you for your visit."
  - It **auto-prints once** as it opens: in the Electron shell `touch.print({kind:'receipt'})` to the thermal printer, otherwise (or when that fails) the browser's print.
  - **Print** (primary) — prints it again, the same way.
  - **Close** / X / Esc — ends it; the next sale starts.
- Queued offline (or the bill could not be read) → modal "Paid" with "Saved on this PC. It goes through when the connection is back." (or the read error) and **Next sale** (primary) / X. Nothing prints.

---

## Cash drawer — `/shop/drawer`
This is the shop PC's drawer page: the shop assistant's shift card and "Open drawer"; managers and owners get the day's shifts and the drawer log. It is the café's CashDrawerScreen reused (another crawler lists it in detail); below is what applies or differs on the shop desk.
*Who:* shop_staff, manager, owner (route). In-screen: `viewDrawerLog` (manager, owner) decides the full page against the one-button page. `closeDay` (manager, owner) shows the Day close link. The shift card follows SHIFT (`takeCourtPayment`, which includes shop_staff), and the station's mode `shop` has a drawer. *Source:* features/till/CashDrawer.tsx, features/tillShift/DrawerShift.tsx (YourShift), DrawerDay.tsx, TillShiftPanel.tsx, ShiftDialog.tsx, components/kit.tsx (ReasonCodePrompt), features/shop/DayCloseShop.tsx.
**shop_staff's page** (no log)
- Title "Cash drawer", subtitle "Day opened {time}". With no day open: "No business day is open, so there is no float." / "A manager opens the day (and sets the float) from Day close."
- Error loading the day → **Try again**.
- **Your shift** card when the shop assistant holds this station's shift (Opened at, Float, Payments, Refunds, Drawer opened by hand; "The expected amount shows when you end your shift and count the drawer."):
  - **End my shift** (lock icon) → the inline close: **Cash in the drawer** + keypad + **Note**, **Cancel** / **Next**; then **Your PIN** (or the manager's when they have none: "You have no PIN yet, so a manager signs this count."), **Use a manager’s PIN instead** / **Use my PIN**, **Change the count**, **End my shift** (→ `app.close_till_shift` with own PIN, or `app.verify_manager_pin` + `app.close_till_shift_for`); the result ("The drawer matches" / "Short by" / "Over by", figures, "{amount} stays in the drawer for the next shift.") with **Stay signed in** / **Sign out**.
- Someone else's shift on this PC → "{name}’s shift is open on this till" / "Since {time}. Close it with a manager’s PIN to start yours." + **Close {name}’s shift** (the inline close with a manager's PIN).
- No shift → the inline start panel (**That’s right** / **I counted a different amount** → count, **Note**, **Back**, **Start my shift**). If the gate fails open, a fallback card "No shift is open on this till" / "Start your shift before you take payment." with **Start my shift** (disabled with "The day is not open yet" or "Your shift is open on {station}").
- **Open drawer** (large; primary once a shift is open) → the reason prompt "Open the drawer":
  - **Why?** radio chips: **Customer request**, **Staff error**, **Other**.
  - **Other** asks "What is the reason?" (placeholder "Write the reason", max 200, required: "Write the reason to continue").
  - **Continue** → `app.record_drawer_open` (p_tab_id null, this device). Success: "Drawer opening recorded."
  - **Cancel** / Esc / backdrop (no X).
**manager / owner page**
- The same title and subtitle. The day view (DrawerDay) shows every till's, the desk's and the shop's shifts, not the shop's alone:
  - **Previous day** / **Next day** / **Latest day** stepper.
  - Headline figures (Opening float, Cash in, Card, Counted at shift ends, Difference).
  - The "Shifts" table, plus "Taken with no shift open: …".
- **Day close** (link-button, lock icon) → `/admin/day-close`.
- **Open drawer** (primary; disabled with "No business day is open, so there is no float." when no day is open) → the same reason prompt and RPC.
- "Drawer activity today" table: every cash payment of the open day, venue-wide (not filtered to the shop), and every hand opening, with counts "Cash payments: {n} · Opened by hand: {n}". **Try again** on error.
- No shift card: managers and owners are never asked to hold a shift.
**Shop-specific: the day close's "Touch Shop" block** (rendered on `/admin/day-close` before the close, manager/owner; read only; `app.day_close_shop`, refreshed every 60 s; hidden on a day the shop neither sold nor opened its drawer)
- Shows "The shop’s own money today and its drawer. It is part of the venue’s close below.", then Shop sales, its Cash / Card / Other, Refunds, Net, and "Paid sales: {count}".
- "Unfinished shop sales: {count}" + "The day cannot close while a shop sale is unpaid. Take the payment at the shop desk first." The way out is **Take payment** under Unfinished sales on `/shop`.
- "Shop drawer": per shift "name · station · Open since {time}" or "Counted {counted}, expected {expected}"; "No shop drawer was opened today."
- A read error shows the error, with no retry button.

---

## Shop stock — `/shop/stock`
This is the shop store's on-hand list: shop sizes only, what needs attention, and each item's history. It reuses the café's On hand screen (features/stock/OnHand.tsx) inside `StockScopeProvider scope="shop"`.
*Who:* shop_staff, manager, owner (route). The shop scope switches off the stock value, expiry, alerts and no-cost reads (management's), and the Waste button. *Source:* features/shop/ShopStockPages.tsx (ShopStock), features/stock/OnHand.tsx, stockUi.tsx (AttentionList), LedgerDrawer.tsx.
**Header**
- Title "On hand" (the rail says "Shop stock"). Subtitle: "Last counted {date}" / "Never counted" (no "Stock worth" here).
- **Record a delivery** (primary, box icon) → `/shop/receive`.
- **Count stock** / **Continue the count** (scale icon; "Continue" while any operator count is open) → `/shop/counts`.
- (No **Record waste**: the shop desk does not write stock off.)
**Needs attention panel** (only rows with a count above 0; otherwise "Nothing needs attention. No ingredient is running low and nothing has expired.")
- **Out of stock** · **Show which** → sets the table filter to Out of stock, clears the search and scrolls to the table.
- **Running low** · **Show which** → filter Running low.
- **Sold past what was on record** · **Show which** → filter Count needed.
- **Below par** · **Show which** → filter Below par.
- **Counts from the phone to apply** · **Open counts** → `/shop/counts`. (The count is not filtered to the shop store; see the notes at the end.)
- (Expired batches, Expiring soon, Alerts not yet dismissed and Staff additions with no cost are switched off in the shop scope.)
**Table**
- Segmented **Show** filter: **All** / **Out of stock** / **Running low** / **Below par** / **Count needed**. Client side; `?filter=out|low|belowPar|countNeeded` opens it pre-set.
- Search box "Search ingredients" (+ **Clear**, Esc). Matches the name.
- "{shown} of {total}" result count.
- (No **Store** segmented control: it shows only for the café's two stores.)
- Columns: Ingredient (the shop size's stock row), On hand (qty + unit), Par, Status ("OK" or a badge, + "records say {qty}" when a count is needed).
- **History** (per row, fileText icon) → opens the history modal.
- **Row click** / Enter / Space on a row → opens the same history modal.
  - Modal "History: {name}" ("On hand now: {qty}. Everything that changed it, newest first."); columns When / What happened / Change / Store / Cost per {unit} / By / Note.
  - **Newer** / **Older** page through 50 rows at a time.
  - **Open the product release** (only on a product_test movement) → `/protocols?run=…` (manager/owner only).
  - **Close** / X / Esc.
- Filtered to nothing → "Nothing matches those filters." with **Clear filters** (resets the filter and the search), or e.g. "Nothing is out of stock." when only the filter narrows it.
- Footnote "Stock goes up with deliveries and down with sales, waste and write-offs. Nobody types a stock number: …" + **Count stock** / **Continue the count** → `/shop/counts`.
**States**
- Empty (no active retail stock row) → "No shop stock yet" / "Add the shop’s products under Products. Each size keeps its own stock here." + **Open Products** (tag icon) → `/shop/products`.
- Error → "This could not be loaded." + **Try again**.

---

## Goods in — `/shop/receive`
This page records a supplier delivery into the shop store, one line per shop size. It reuses the café's Goods in (features/stock/ReceiveDelivery.tsx) in the shop scope.
*Who:* shop_staff, manager, owner (route). No in-screen gate; `app.receive_delivery` re-checks. *Source:* features/shop/ShopStockPages.tsx (ShopReceive), features/stock/ReceiveDelivery.tsx, SupplierField.tsx, stockUi.tsx (StoreCountedNotice), stockLogic.ts (lineProblem), decimalInput.ts.
**Header**
- Title "Goods in", lead "Enter what arrived. Stock goes up as soon as you record it."
- (No **Scan receipt** button and no "Waiting to receive" row of scanned receipts, driver's purchases or staff additions: those are the café's.)
**"What arrived" panel: the head**
- **Supplier** (optional; one combobox): type any name, or pick from the active suppliers.
  - The list opens on focus or click and narrows as you type. ↑/↓ move, Enter picks, Esc closes; a mouse press picks.
  - A typed name that matches a supplier exactly is linked to it on blur. An unknown name shows "Not on the list: “{name}” is saved as typed."
  - Picking the first line's product fills the supplier from that product's supplier when the box is empty.
- (No **Put it in** store picker: the shop scope has one store, the shop store.)
- **Notes** (optional, placeholder "e.g. invoice number").
- If a manager's count of the shop store is open: refused notice "A count of the shop store is open. Nothing can go into it until that count is finished or discarded." + **Open the count** → `/shop/counts`.
- Product list failed to load → the error + **Try again** (refresh icon).
**Lines table** (#, Ingredient*, Received*, Ordered, Cost per {unit} (IQD)*, Expiry date, Line total)
- **Ingredient** select: "Choose…", then every active retail stock row, shown as "Shop stock · {name}". Choosing one fills the cost from the pack price when the cost box is empty, with the hint "Pack of {size}: {price}". Error "Choose the ingredient."
- **Received** (decimal-only keystrokes, unit after it). Error "Enter how much arrived."
- **Ordered** (optional). Error "Enter a number, or leave it blank." When Received < Ordered it shows "Short by {qty}" and the row is tinted.
- **Cost per {unit} (IQD)**. Error "Enter the cost."
- **Expiry date** (date picker, past days disabled). Hint "Blank: {days} days from today" / "Blank: no expiry date". Error "The expiry date cannot be in the past."
- **Remove line {n}** (x icon per row; disabled when only one line).
- **Add another ingredient** (plus icon) — adds a blank line.
**Foot (sticky)**
- "Choose an ingredient, then enter how much arrived and what it cost." or "Lines: {n}", plus "Short: {n}" + "Some lines arrived short. Only what was received goes into stock."
- "Delivery total" (sum of the line totals).
- **Record delivery** (primary, box icon) → `app.receive_delivery` (p_location 'shop', supplier id or typed name, notes, one idempotency key per delivery so a double tap books once; online only).
  - Disabled until there is at least one started line, no line problem, and the store is not being counted ("Held until that count is finished or discarded.").
  - Toast "Delivery recorded. Stock is updated." and the form resets.
  - STORE_BEING_COUNTED ("That store is being counted right now. …") re-reads the counts.
- Under the panel: "Recorded deliveries show on" + **On hand** (arrowUpRight) → navigates to `/stock`, the café's On hand and not the shop's (see the notes at the end).

---

## Stock count — `/shop/counts`
This page counts the shop store blind, finishes or discards the count, and applies counts sent from the phone. It reuses features/stock/CountScreen.tsx in the shop scope (one store, so no store tabs).
*Who:* shop_staff, manager, owner (route). In-screen: `permissions.adjustStock` (manager, owner, shop_staff) enables Start, the count boxes, Finish, Discard and Apply. Others would see "Only a manager or owner can count stock.", but no other role reaches /shop. *Source:* features/shop/ShopStockPages.tsx (ShopCounts), features/stock/CountScreen.tsx, components/ConfirmDialog.tsx.
**Header**
- Title "Stock count", lead "Count what is on the shelves. Where your number differs from the records, stock is corrected to your number."
**Counts from the phone panel** (only when a phone count of the SHOP store waits; "Waiting: {n}")
- Per count ("Shop store", "{name}, {when}"): **Review** / **Hide** toggles its lines (it opens by itself when there is only one).
  - Lines: Ingredient / Records said / **Counted** (editable decimal box with unit; red when invalid) / Difference ("Matched" or ± qty "missing" / "extra").
  - **Try again** if the lines fail to load.
  - **Discard** (trash icon, red) → confirm "Discard this count?" ("{name} counted the shop store. Stock does not change, and the count would need doing again.") **Discard count** / **Cancel** → `app.discard_count`; toast "Count discarded. Stock is unchanged."
  - **Apply count** (primary; disabled with "Fix the boxes marked in red first: {n}.") → confirm "Apply this count?" ("Stock in the shop store is corrected to these {n} numbers. …") **Apply count** / **Cancel** → `app.finalize_count`; toast "Count applied. Here is what it found."; then navigates to `/stock/variance`.
- **View more ({count})** / **Show less** past 3.
**No count open: "How a count works"** (steps 1–3: "Start the count" / "Count each ingredient" / "Finish", with hints)
- **Start count** (primary, scale icon) → `app.start_count` (p_location 'shop'). Disabled when a phone count waits for the shop store: "A count from the phone is waiting for the shop store. Apply or discard it first."
- "Last count finished {date}" / "Never counted".
- **Count differences** (ghost, arrowUpRight; only after a finished count) → `/stock/variance`.
- Error → **Try again**.
**Count open**
- "Started {time} · {entered} of {total} entered".
- Segmented filter: **All** / **Not entered** / **Entered**.
- Search "Search ingredients" (+ **Clear**, Esc).
- "{shown} of {total}".
- **Show recorded amounts** / **Hide recorded amounts** (eye toggle) — adds or removes the "Records say" column.
- **Counted** box per line (decimal, unit after it; red border when invalid) — saved as you type to this station's localStorage per count id.
- "Nothing matches those filters." + **Clear filters**.
- Footnote "Leave blank what you did not count. It stays as recorded."
- **Discard this count** (trash icon, red) → confirm "Discard this count?" ("Stock does not change and the numbers entered are lost. Deliveries and moves into the shop store can go ahead again.") **Discard count** / **Cancel** → `app.discard_count`; toast "Count discarded. Stock is unchanged."
- **Finish count** (primary, check icon; disabled with "Fix the boxes marked in red first: {n}.") → confirm "Finish the count?" ("You entered {n} ingredients. Their stock will be corrected to your numbers. This cannot be undone." / "You have not entered any numbers, so nothing will change. The count will still be closed.") **Finish count** / **Cancel** → `app.finalize_count` (entered lines only); toast "Count finished. Here is what it found."; then navigates to `/stock/variance`.

---

## Products — `/shop/products`
This page is the shop's catalogue, one row per size: sections, products, sizes with SKU, barcode, price, cost, low-stock level and supplier. It also holds the supplier price watch with "Apply new price".
*Who:* shop_staff, manager, owner (route). In-screen: `editLaunchedPrices` + `launchDirectly` (owner, shop_staff) mean no price lock and a new product goes on sale at once. A manager has neither: prices and names of an on-sale product are locked, a new product is saved hidden, and the manager gets **Put on sale** / **Change the price**, which only render for someone with `startProtocolPriceChange` who can open `/protocols` (manager, owner). *Source:* features/stock/products/ProductsAdmin.tsx, productsLogic.ts, features/shop/ShopSectionDialog.tsx, features/shop/priceWatch/PriceWatchUi.tsx, priceWatchLogic.ts, priceWatchData.ts, features/admin/promotions/PriceChangeStart.tsx.
**Header**
- Title "Shop products" (the rail says "Products"), lead "Everything the shop sells, one row per size: its SKU, barcode, price and what is on the shelf."
- Manager only: lock note "Prices of products on sale change through “Change the price”, with the owner’s OK. A new product is saved hidden: add its sizes and prices, then “Put on sale” sends it to the owner."
- **New section** (plus icon) → the "New section" dialog.
  - Lead "Rackets, balls, accessories: the sections the shop till is grouped by."
  - **Name (English)** (required, max 80, autofocus).
  - **Name (Arabic)** (required, max 80).
  - **Tax group** select (required; defaults to the first tax group; read from `tax_groups`).
  - **Save section** (primary; disabled until both names and a tax group are set) → `app.upsert_shop_category` (always kind 'shop'). Toast "Section saved."; refreshes products and the till menu.
  - **Cancel** / X / Esc / backdrop.
  - Errors show under the form, including a tax-group read error.
- **New product** (primary, plus icon; disabled with "Make a shop section in the menu first." while there is no section) → the size form in New product mode.
**Supplier price changes panel** (only when some size's last supplier price differs from its own)
- Lead "The shop desk PC read a different price on these suppliers’ pages. Apply it to sell at the supplier’s price."
- Each alert shows "Product · Size", "Changed {time}" / "Read {time}", "Checked {time}: {error}" when the latest read failed, and "Shop {price} → Supplier {price}". Newest change first.
  - **Apply new price** (primary, check icon; aria "Apply new price: {name}"; owner / shop_staff, or a manager on a not-yet-launched product) → opens that size's Edit form with the supplier's price filled in (hint "Supplier’s new price filled in (was {old}). Save to apply."). Save then applies it.
  - Price locked (a manager on an on-sale product): "The owner or the shop staff apply a supplier’s price." + **Change the price** (arrowUpRight) → `/protocols?start=price_promo&change=price&item={product}`.
**List**
- Search "Search by name, SKU or barcode…" (+ **Clear**, Esc): product or size name in either script, SKU, barcode.
- "{shown} of {total}".
- Columns:
  - Product: the name and the size; badges "Hidden" (not on sale), "Supplier price: {price}" (warn), and "Supplier link not read" (warn; its tooltip on hover is the read error, e.g. "No price found on this page.").
  - SKU, Barcode, Price (IQD).
  - On hand: qty in pieces, or the "Not tracked" badge for a size made in the menu editor.
  - Supplier.
- Row actions:
  - **Put on sale** (ghost, arrowUpRight; manager, a product never on sale) → `/protocols?start=price_promo&change=shop_launch&item={product}`.
  - **Add size** (ghost, plus icon; shown when the price is not locked) → the size form in Add size mode.
  - **Change the price** (ghost, arrowUpRight; manager, a product on sale; replaces Add size) → `/protocols?start=price_promo&change=price&item={product}`.
  - **Edit** (ghost, note icon) → the size form in Edit mode.
- **Row click** / Enter / Space → the size form in Edit mode.
- Filtered to nothing → "Nothing matches those filters." + **Clear filters**.
**States**
- No shop section yet → "No shop section yet" / "Make the first section, then add products to it." + **New section**.
- Sections but no product → "No products yet" / "Add the first product; each size gets its own barcode and its own stock." + **New product**.
- Loading skeleton.
- Error "This could not be loaded." + **Try again**.
**Size form** (modal, large; title "New product" / "New size of {name}" / "Edit {product · size}")
- Subtitle: "A new product is saved hidden. Add its sizes and prices, then press “Put on sale”: …" (manager, New product), or "This size was made in the menu editor and has no stock of its own yet. Saving it here starts tracking it." (Edit of a not-tracked size).
- New product only:
  - **Shop section** select (every shop section, inactive ones included).
  - **Product name (English)** / **Product name (Arabic)**.
- **Size (English)** / **Size (Arabic)**: prefilled "One size" / "مقاس واحد" for a new product. Error (as the Save reason) "Enter the size in both languages."
  - Manager + on sale: shown read only with a lock icon. Renaming goes through Change the price.
- Manager + on sale: note "This product is on sale, so its sizes’ prices and names change through “Change the price”, with the owner’s OK. Everything else here is yours to edit."
  - **Change the price** (arrowUpRight) — asks the unsaved-changes question first, then → `/protocols?start=price_promo&change=price&item=…`.
- **Price (IQD)** — required, a whole number up to 12 digits. Error "The price is a whole number of IQD." Read only with a lock for a manager on an on-sale product.
- **Cost per piece (IQD)** (optional; hint "Used until the first delivery records a real cost."). Error "The cost is a whole number of IQD."
- **SKU** (optional). Error "Letters, digits and . _ / - only, no spaces." (1–64). Server: SKU_TAKEN "That SKU is already on another product."
- **Barcode** (optional; hint "Scan it into this box, or type the number under the bars."). Error "4 to 64 digits or letters." Server: BARCODE_TAKEN "That barcode is already on another product."
- **Warn when fewer than** (optional; hint "Pieces left before it counts as running low."). Error "Enter a number."
- **Supplier** select: "No supplier" + the active suppliers.
- **Supplier link** (optional url, placeholder "https://"; hint "Paste the link to this size’s page on the supplier’s website. The shop desk PC checks it every hour and lets the owner and the shop staff know when the price changes.").
  - Errors: "The link must start with https://" / "This link is too long (2,000 characters at most)." / "This is not a product page link. Copy it from the browser’s address bar." / "Use the supplier’s public web page, not a local address." Server: SUPPLIER_URL_INVALID shows the same "not a product page link" line under the field.
  - Status of the stored link: "Not checked yet. The shop desk PC reads it within the hour." / "Checked {time}. Price read: {price}." / "Checked {time}: {reason}" + "Last price read: {price} ({time})."
  - Clearing a stored link removes the watch.
- **Save** (primary, check icon). Disabled reasons: "Fill in both names first." (new product names or section missing) / the first field problem / the link problem / "Change something to save."
  - New product → `app.upsert_menu_item` (p_is_active false for a manager), then `app.upsert_retail_variant` (default size).
  - Add size → `app.upsert_retail_variant` (sort order after this size).
  - Edit → `app.upsert_retail_variant` only when the size itself changed (or it was not tracked).
  - Then `app.set_shop_price_watch` when the link changed. If that fails on an Edit, the form stays open; on a new product or size the form closes and the error comes as a toast.
  - Toast "Saved." or (manager, new product) "Saved hidden. “Put on sale” then sends its price to the owner." Refreshes stock, menu and admin menu.
  - Refusals: PRICE_VIA_PROTOCOL with a name hint → "Renaming a size or an option that is on sale goes through “Change the price”, with the owner’s OK."; LAUNCH_VIA_PROTOCOL; others via ErrorText.
- **Cancel** / X / Esc / backdrop. In Edit mode with unsaved edits, it first asks "You have unsaved changes" / "Everything you changed here will be lost. Are you sure you want to close?":
  - **Discard changes** (danger).
  - **Keep editing** (focused; a backdrop click only shakes the dialog).
- Not dismissible while saving.
- Not on this page: switching a product on or off, deleting a product, size or section, and renaming or reordering sections. A "Hidden" product stays hidden here unless a manager's Put on sale is approved.

---

## Suppliers — `/shop/suppliers`
This page lists who the venue buys from; suppliers are picked on Goods in and on a shop size. It is shared with the café, one list.
*Who:* shop_staff, manager, owner (route). No in-screen gate. *Source:* features/stock/products/SuppliersAdmin.tsx.
**Header**
- Title "Suppliers", lead "Who the venue buys from. Picked on goods in and on shop products."
- **New supplier** (primary, plus icon) → the supplier form (new).
**List**
- Search "Search suppliers…" (+ **Clear**, Esc): matches name or phone.
- "{shown} of {total}".
- Columns: Name (+ "Not in use" badge when inactive), Phone, Notes (truncated; hover shows the full note).
- **Edit** (ghost, note icon, per row) → the supplier form.
- **Row click** / Enter / Space → the supplier form.
- Filtered to nothing → "Nothing matches those filters." + **Clear filters**.
**States**
- Empty → "No suppliers yet" / "Add the companies you buy from, so deliveries and products can name them." + **New supplier**.
- Error → **Try again**.
**Supplier form** (modal "New supplier" / "Edit supplier")
- **Name** (autofocus, max 120; Save is disabled with "Enter a name." while blank).
- **Phone** (optional, tel, max 32).
- **Notes** (optional, max 500).
- **In use** switch (on by default; switching it off retires the supplier from the pickers; there is no delete).
- **Save** (primary, check icon) → `app.upsert_supplier`. Toast "Saved."; refreshes stock lists. Refusal SUPPLIER_EXISTS "A supplier with that name already exists." (the server also treats "Al-Rafidain" and "al rafidain" as the same name).
- **Cancel** / X / Esc / backdrop. There is no unsaved-changes check.

---

## Supplier price watch (background, no screen of its own)
On the shop desk PC, the app reads each supplier link and reports the price. The only thing anyone sees is a toast; the results show on Products.
*Who:* runs only on a registered station in mode `shop` with someone signed in who may open `/shop` (shop_staff, manager, owner). *Source:* features/shop/priceWatch/PriceWatchCrawler.tsx (mounted in routes/__root.tsx), crawlPass.ts, priceWatchLogic.ts.
- **Automatic pass** (no press): about 20 s after sign-in, then hourly. It reads each due link (never read, or read more than 30 min ago) through the shell (`touch.fetchSupplierPage`, public https only), 3 s apart, and reports each with `app.record_shop_supplier_price`. The server stores the price and pushes the owner and the shop staff on a change; the person signed in here gets no push. It is skipped while offline.
- **Toast** "A supplier changed a price. Open Products to apply it." / "{count} supplier prices changed. Open Products to apply them." (info, no button) on whatever page is open, after a pass that left a new price to apply.

---
Notes found while crawling (worth a look):
- Shop staff are sent to café pages they cannot open: **Finish count** and **Apply count** go to `/stock/variance`, as does the **Count differences** link on the Stock count page, and Goods in's **On hand** link goes to `/stock`. Shop staff are not in `ROUTE_ROLES['/stock']`, so they land on the refusal card. Managers and owners land on the café pages, leaving the shop rail.
- A resumed **Unfinished sale** always opens the Cash pane, so the shop till cannot take one by card.
- The shop till's member attach has no PIN path: a staff-member customer's PIN_GRANT_REQUIRED just shows as an error in the payment pane, and the sale goes on without the member.
- On Shop stock, "Counts from the phone to apply" counts phone counts for every store, and "Continue the count" and "Last counted" also look at every store, while `/shop/counts` lists only the shop store's.
- Copy mismatches: "New product" is disabled with "Make a shop section in the menu first." although sections are now made on this page (**New section**). Page titles differ from the rail: "On hand" vs "Shop stock", and "Shop products" vs "Products". The shop's stock pages say "Ingredient" and "Search ingredients" for shop products.
