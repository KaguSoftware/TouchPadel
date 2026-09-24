# Operator pages — one sentence each

Read by `packages/db/scripts/build-assistant-map.mjs` (plan §3.2). One bullet per
route: `- /route — <what the page is for and what its main buttons do>`. The
generator refuses to run when a route in `ROUTE_ROLES`, `SUB_ROUTES` or a rail
item in `lib/workspaces.ts` has no line here, so adding a page means adding a
sentence. Write what the code does; button names are the English catalog
labels. Roles, workspace and section are derived by the generator, not written
here.

## Entry

- / — No screen of its own: it shows the boot screen until the staff row loads, then redirects to /workspaces when the account holds several workspaces and none is stored on this station, otherwise to the role's home (/till, /kds, /desk/today, /ops, /panel or /tasks).
- /workspaces — The "Choose a workspace" switcher, shown when an account holds more than one role; each workspace tile is a button that makes that workspace active and opens its home, with a "You are here" badge on the current one.

## Till (cashier)

- /till — The cashier's till: a search box, category strip and item grid feed a basket whose "Send to kitchen" posts the order (order.add_items → app.till_add_items), the active tab panel's "Cash" and "Card" buttons open the payment pane (tab.settle → app.settle_tab), and "New tab" (F6) opens a tab.
- /till/tabs — The "Open tabs" board listing every tab on the floor with its age and running total; "Open tab" starts a new one, a row's "Open" jumps to the till with that tab selected, "Merge" combines two tabs (app.merge_tabs), and "Remove" cancels an empty tab (app.cancel_tab).
- /till/drawer — The "Cash drawer" screen showing the opening float and today's drawer activity; "Open drawer" asks for a reason code and records the opening with app.record_drawer_open, and managers also see "Go to day close".

## Court desk

- /desk — The desk calendar: a courts × half-hour grid for one day or a month heat view, where pressing a free slot opens the booking dialog (reservation.create → app.staff_create_reservation) and dragging a booking moves it (reservation.update → app.move_reservation); "New series" and "Block court" lead to their own screens.
- /desk/today — The "Today" board of arrivals, courts in play now and every booking today; "Mark arrived" writes app.mark_reservation, "New booking" and "Book this court" open the create-booking dialog, "Find customer" goes to /desk/customers, and "Take payment" opens the booking's bill.
- /desk/customers — Customer search that queries app.customer_search as you type; each result offers "Book" and "Open", "Create customer" goes to the new-customer form, and in attach mode "Attach to booking" or "Attach to tab" hands the chosen customer back to the caller.
- /desk/customers/new — The "New customer" form (full name, phone, optional email, preferred language); "Create customer" calls the staff-gated desk-customer-create edge function, which creates a real guest account, and opens the new record, while "Cancel" returns to search.
- /desk/series/new — The "New series" screen for a repeating booking; "Check clashes" previews every date with app.preview_series, each clash is resolved with "Skip this date" or "Move to another court", and "Create series" writes the plan through app.create_series.
- /desk/block — The "Block court" form (court, date, from, to, reason); its "Block court" button creates a maintenance reservation (reservation.create), shows a conflict notice when the window is already taken, then offers "Open calendar" and "Block another".

## Kitchen

- /kds — The kitchen display board: its live tickets, and those completed in the last two minutes, are read through app.kitchen_board with their lines, add-ons, notes and ready marks and no prices; per-ticket "Start", "Ready" and "Complete" buttons move the ticket through its statuses (ticket.status → app.set_ticket_status), ticking one item calls app.set_order_item_ready, and "Leave kitchen display" appears only for staff who hold another workspace.

## Team (driver, marketing)

- /tasks — "My tasks", the driver's and marketing's landing screen and the team workspace's one rail row; nothing can be assigned yet, so it shows only the empty state saying what will appear here once assigned (purchases and checklists for a driver, marketing tasks and checklists for marketing), with no buttons and no data read.

## Operations (manager)

- /ops — The manager's "Today" screen, refreshed from app.ops_overview every 30 seconds: a "Needs you now" list with "Open the day", "Answer calls", "See which" and "Review expired"; courts, cafe and stock cards with "Open bookings", "Open tabs" and "Open stock"; the day-close steps ending in "Go to day close"; exceptions, staff activity, and "Refresh".

## Management (owner)

- /panel — The owner's read-only landing screen: app.panel_headline fills an "Earned" and "Taken in payments" band plus padel, cafe and losses figure rows for a chosen range and comparison, each figure opening its transactions through app.report_drill; "Export CSV" writes the window, every figure and every drill transaction to one file, and buttons open the Courts, Cafe, Revenue, Stock and Staff reports.
- /analytics — A layout that validates the shared search params (range, custom dates, compare basis, court) and redirects to /analytics/courts, carrying the search along; the Courts and Cafe tabs switch between the two analytics screens.
- /analytics/courts — Owner-only Courts analytics: Summary, What stands out, When courts are busy, Courts compared, Cancellations and no-shows, How people book, Guests, and Court players at the cafe, fed by app.analytics_courts_summary, _demand, _endings, _guests and _cafe for the period and its comparison window; the bar sets range, compare basis and court, "Export" saves the figures, and tiles drill into transactions.
- /analytics/cafe — Owner-only Cafe analytics: Summary, What stands out, Menu, Sales and the guest menu, and Busy times, fed by app.analytics_daily_sales, _sold_items, _best_sellers, _bought_together, _item_margins, _price_bands, _promo, _menu_snapshot and _hourly plus PostHog guest data; the bar carries period, compare and the "Business day" and "Excluded items" settings, "Export" saves the figures, and the AI card's "Ask for findings" and "Check they still hold" call the insights function and save its results.

## Financial section

- /financial — The Financial section's landing screen: a "This month so far" card from app.panel_headline (earned, cash, card) beside "Cash at recent day closes" read from day_sessions; "Open the management panel" goes to /panel, "Go to day close" to /admin/day-close, and the cards below open the section's screens.
- /reports — A layout with no content of its own that redirects to /reports/courts; the tab strip (Revenue, Courts, Cafe, Stock, Staff activity) shows the reports the current role and Management section may open.
- /reports/revenue — The owner-only revenue report (app.report_revenue, or app.report_compare when a comparison is chosen): headline figures grouped as Earned, Money taken, Given away and Tax, a day, week or month breakdown with the "Show" views Earned, Money taken, Given away and Tax, staff and payment-method filters, "Export", and pressing a figure or row opens its transactions through app.report_drill.
- /reports/courts — The courts report (app.report_courts, or app.report_compare): totals for bookings, booked hours, occupancy, court revenue, cancellations and no-shows with the "Show" views By court, Cancellations, Peak times, By start time and By day, a court filter and "Export"; a court or day row drills its bookings through app.report_drill.
- /reports/cafe — The cafe report (app.report_cafe, or app.report_compare): revenue, orders, average order, items sold, gross profit and margin and prep time with the "Show" views Best sellers, Cost & profit, By category and Waste, a "See waste" button that lists every write-off in the period, "Export", and item rows that drill their sold lines through app.report_drill.
- /reports/stock — The stock value report (app.report_stock): headline stock value plus counts for running low, below par, expiring soon and expired, with the "Show" views Running low, Below par, Expiring soon, Expired, Used and Count differences (with an "Only differences" toggle); each list has a button opening the matching /stock screen, plus "Export".
- /reports/staff — The staff activity report (app.report_staff_activity): one row per person with the "Show" views Activity, "Discounts, voids & refunds", Waiter calls and Day closes, a staff filter and "Export"; each row's "Audit" opens /admin/audit for that person, and rows drill their transactions through app.report_drill.
- /admin/day-close — The day-close screen: when no trading day is open it shows an opening-float field and "Open day" (app.open_day); otherwise it walks the steps (settle open tabs, wait for tills to sync, count the cash, enter the card batch) and "Close day" calls app.close_day, with "Export CSV" for the day's figures; unpaid played bookings warn but do not block.

## Observe section

- /observation — The Observe section's landing screen: a "Waiting on you" list built from app.staff_requests_page and app.marketing_overview with "Answer requests" and "Review campaigns", the Live floor 3D plan, and screen cards fed by app.ops_overview.
- /observation/courts — A view-only "Bookings" board for a chosen day or month: a figure strip, one card per court right now, the night in two-hour rows and a month heat calendar, all read from reservations; "Refresh" re-reads, and pressing a booking opens a read-only panel whose only button is "Open in Court desk".
- /observation/tills — A view-only "Tills" board of the cafe floor for one business day: running, settled, voided and waiter-call figures, occupied and free tables, and lists of open, settled and void tabs read from tabs; "Refresh" re-reads, and a tab opens a read-only panel whose only button is "Open in Cashier".
- /observation/requests — The owner's decision queue for leave, shift swaps, wage advances and record corrections from app.staff_requests_page, filtered by Awaiting decision, Decided or All; "Approve" and "Decline" open a dialog that calls app.decide_staff_request (a decline needs a reason), and a decision is final.
- /marketing — The owner's campaign list from app.marketing_overview showing status, window, audience and what each campaign brought in (or "Not measurable"); "New campaign" and "Edit campaign" save through app.save_marketing_campaign, per-row "Schedule", "Set live" and "End" confirm then call app.set_campaign_status, "New audience" writes app.save_marketing_audience, and "Open promotions" and "Open Telegram" link out.
- /admin/audit — The read-only "Audit log": who did what and why, with period, search, area and actor filters and a "missing reason" toggle; the buttons only refresh, clear filters, expand a row's before and after values, or export CSV.

## Stock section

- /stock — "On hand", the stock landing screen: a "Needs attention" list (running low, expired, sold past records, below par, expiring soon, open alerts) whose buttons are "Show which", "Open expiry" and "Open alerts", a searchable on-hand table from v_ingredient_on_hand and app.report_stock, header buttons "Record a delivery", "Record waste" and "Count stock" (or "Continue the count"), and a per-row "History" ledger drawer.
- /stock/ingredients — Ingredient master data (unit, supplier, pack size and price, shelf life, par, reorder point, yield, expected waste) from the ingredients table; "New ingredient" and per-row "Edit" open a dialog whose "Save" writes app.upsert_ingredient, and on-hand is a read-only figure linking to "Count stock".
- /stock/receive — "Goods in": one delivery per submit with supplier and notes and per-line ingredient, received and ordered quantities, cost per unit and batch expiry; "Add another ingredient" adds a line and "Record delivery" posts the whole delivery through app.receive_delivery.
- /stock/waste — "Waste & production", two forms side by side: "Record waste" (ingredient, quantity, Spill or Spoilage, a required note) writes app.record_waste, and "Record production" (prepared item, amount made) writes app.record_production, which consumes the components by recipe and reports the batch cost.
- /stock/recipes — Recipes tabbed by Menu items, Add-ons and Prepared items with an All or No-recipe filter; "Add" or "Edit" opens a dialog where "Add an ingredient" adds lines and "Save" replaces the whole recipe atomically through app.set_recipe.
- /stock/counts — "Stock count": "Start count" opens a count (app.start_count), a blind-entry table follows (drafts saved locally, with a "Show recorded amounts" toggle), and "Finish count" confirms and calls app.finalize_count, then opens Count differences.
- /stock/variance — "Count differences" for a chosen finished count from v_variance_report, defaulting to "Only differences" with a toggle to "All ingredients", with columns Records said, Counted, Difference, Sold, Expected waste, Recorded waste, Voids and Expired; each row has "History" and the header has "Export".
- /stock/margins — Margins per menu item from v_item_margin: an "Items that earn too little" panel with "Show which" for "Sell at a loss" and "Margin under 30%", over a searchable Price, Cost to make, Margin and Margin % table; read-only, and the empty state links to Recipes.
- /stock/alerts — Stock alerts from manager_alerts grouped by kind (sold past what was on record, expired, running low, expiring soon, offline sale not applied), each group with "Dismiss all" and each row with "Dismiss" (app.acknowledge_alert) and a jump such as "Count stock", "Open expiry" or "See what is low".
- /stock/products — "Shop products": one row per size of every Touch Shop product (a menu item in a shop section) with SKU, barcode, price, on hand and supplier; "New product" writes app.upsert_menu_item then app.upsert_retail_variant, "Add size" and "Edit" write app.upsert_retail_variant, which keeps each size's own stock row (unit pc) in step.
- /stock/suppliers — "Suppliers": who the venue buys from (name, phone, notes, in use), picked on goods in and on shop products; "New supplier" and "Edit" write app.upsert_supplier, which refuses a second live supplier with the same spelling.
- /stock/expiry — Expiry, from app.report_stock: an "Expired: throw out and write off" panel and an "Expiring soon: use first" panel listing batches with quantity left, worth and date; "Write off" opens a manager-PIN and reason dialog that calls app.write_off_expired, and the header has "Export".

## Setup section and admin

- /setup — The Setup section's landing screen: a "Worth checking" panel flags a broken Telegram link, managers or owners without a PIN, a single owner account, and active accounts still on the retired Kitchen role (update every station first, then move each one to Barista or Chef), each with a jump button ("Open Telegram", "Set PINs", "Go to Staff"), above cards opening the Setup screens.
- /admin — A layout with no content of its own: it draws the section tab strip for the Menu and Guest-app families and its index redirects to /admin/menu.
- /admin/menu — The "Menu items" editor listing categories and their items with sold-out switches; "New category" and "New item" open forms that save through app.upsert_menu_category and app.upsert_menu_item, the arrows reorder with app.reorder_menu_items, and the switch calls app.set_item_sold_out.
- /admin/categories — The "Categories" screen for the menu sections' order, photo, tax group and shown or hidden switch; "New category" or a row opens the form whose "Save" calls app.upsert_menu_category, and the order arrows call app.reorder_menu_categories.
- /admin/addons — The "Add-ons" screen listing item groups and sub-groups of guest choices; "New group" and "New sub-group" open an editor that saves with app.upsert_modifier_group and app.link_item_modifier_group, options save through app.upsert_modifier, and reveals through app.set_modifier_reveals.
- /admin/suggested — The "Suggested items" screen picking the "Goes well with" list shown under an item on the guest menu; add or "Remove" suggestions up to the cap, then "Save" (or "Discard changes") writes app.set_addon_suggestions.
- /admin/hero — The "Guest site home screen" builder choosing what sits above the guest menu ("Menu only", "Photo or video" or "Featured item"), the ticker lines and the bell tutorial switch; "Save" writes the cafe settings in one call (app.set_cafe_settings) and "Discard changes" reverts.
- /admin/qr — The "Tables & QR" screen listing cafe tables with zone, seats and a waiter-bell switch (app.set_table_bell); "Add table" and a row edit a table (app.upsert_cafe_table), "Print all cards" and "Print this card" print A6 QR cards, and "Replace" or "Replace every QR code" rotate tokens with app.rotate_table_token.
- /admin/courts — The "Courts" admin listing bookable courts in calendar order; "Add court" and "Edit" open a panel with names, photo, indoor or outdoor, booking lengths and an open switch saved by app.upsert_court, with "Switch off" (app.delete_court) and order arrows (app.reorder_courts).
- /admin/rates — The "Court rates" screen listing rate rules by court, days, time window, prices and priority; "New rule" or a row opens the editor whose "Save" calls app.upsert_rate_rule and affects only new bookings, and a toggle shows or hides switched-off rules.
- /admin/hours — The "Opening hours" page setting each day's open and close times and the closed dates; "Save" calls app.set_opening_hours, and the same editor is the first tab of /admin/settings.
- /admin/promotions — The "Promotions" list with a lifecycle filter, a search box and a per-row on/off switch (app.set_promotion_enabled); "New promotion" or a row opens the promotion editor whose "Save" calls app.upsert_promotion, and nothing is ever deleted.
- /admin/telegram — The "Telegram" settings with "Set up" and "Sent messages" tabs: connection health from the telegram-diagnose function, "Send test message" (app.telegram_send_test), the group chat id and message language saved as cafe settings, and the people who may press the bot's buttons set with app.set_telegram_staff.
- /admin/settings — "Venue settings" in four tabs: Opening hours (app.set_opening_hours), Day & service (business-day start hour, waiter-call wait via app.set_waiter_call_cooldown, idle lock), Analytics (owner-only exclusions and engagement floor) and Venue details (name, phone, timezone through app.set_venue_details).
- /admin/staff — The owner's "Staff" screen listing accounts with role, PIN and status; "Add staff member" creates an account through the staff-admin edge function, "Manage" opens an editor (app.rename_staff, set_staff_role, set_staff_active, set_staff_pin, clear_staff_pin, set_station_staff for cover), and the breaks panel's "Save" writes break_allowance_minutes. Kitchen (prep) is retired: it is not offered for a new account or a role change (kitchen staff are Head barista, Barista, Head chef or Chef), and an account still on it shows a "Retired" badge and keeps working until it is moved.
- /assistant — The owner assistant: a full page with the list of chats, the thread, the context checkboxes with their pack sizes, and the usage meter; "Ask" sends a question (billed), "Stop" ends a streaming answer, "Run this job" accepts an estimate, and every answer lists the tools it read with a link to the page that shows the same numbers.
- /assistant/usage — What the assistant has cost: tokens by kind (input, cache write, cache read, output) and cost per day for the month, month-to-date against the cap, and the price table each model is billed from.
