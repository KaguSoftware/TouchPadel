# Rules that live in no table

Read by `packages/db/scripts/build-assistant-map.mjs` (plan §3.2): every `##`
section becomes one `rule` chunk, and the whole file goes into the compact
prefix the model sees on every turn. Each section states one rule the venue
runs on and names the migration or document that decided it. Write the rule the
way the code enforces it, not the way we wish it worked.

## The assistant is read-only

The assistant can read and explain but never change anything: every tool it calls goes through `app.assistant_run_tool` (migration 0109), a STABLE function that runs inside a read-only transaction under the owner's own session, dispatches only the fixed catalog of read RPCs, and has no branch that writes (plan §2.2, §7.1). When the owner asks for a change, the assistant says which page and which button does it and stops there.

## Owner only

Only the owner role may open the assistant or call `app.assistant_run_tool`; managers, cashiers, prep and desk staff are refused with FORBIDDEN (contract decision 5, migration 0109). Answers therefore may include everything the owner can see in the app, and nothing the owner cannot.

## Roles come from the staff row, not the token

A person's role is whatever their active `staff` row says at the moment of the call: `app.staff_role()` and `app.is_staff(...)` (migration 0003) look the row up on every statement, never a JWT claim, so a role change by the owner takes effect on the next request without a new sign-in, and a deactivated account loses every screen at once. Guests hold the same `authenticated` role as staff, which is why every RPC guards itself on its first line.

## Money is integer IQD

Every money column is a `bigint` through the domains `iqd` (never negative) and `iqd_signed` (deltas and variances) from migration 0002; there are no decimals, no floats and no fractional dinars on a bill, a report line or a day close. The one exception is the internal `unit_cost_iqd numeric(14,4)` on stock (cost per gram), which is rounded to whole dinars the moment it reaches a figure (design-data.md §2).

## Cash rounding is off

`venue_settings.cash_rounding_iqd` defaults to 1, which means no rounding (migration 0006, resolved override #1): a cash bill is charged exactly and `change_iqd` is exactly tendered minus amount. The knob exists for the venue to turn on later; today no figure has been rounded to 250 IQD.

## Prices are snapshotted by the server

Every order line's price is copied from the menu tables at the moment the order is created, by `app.create_guest_order` and `app.till_add_items` (migration 0015); clients never send a price. A later menu edit changes future orders only, and a rate rule saved on /admin/rates affects only new bookings.

## Payments, refunds, audit rows, stock movements and replays are append-only

`payments`, `refunds`, `audit_log`, `stock_movements` and `sync_replays` can only be inserted into, never updated or deleted, enforced twice: clients hold no UPDATE or DELETE grant, and a trigger (`app.forbid_mutation`, migration 0003, attached in 0005, 0015, 0018 and 0021) refuses the statement even for table owners (design-data.md §3.4). A wrong payment is corrected by a refund row, a wrong stock figure by a count adjustment movement, never by editing history.

## A discount, void, refund or price override needs a manager PIN and a reason

The money-adjustment RPCs (`apply_discount`, `override_price`, `void_after_send`, `refund`) take a PIN and a reason code, verify the PIN with `app.verify_manager_pin` (manager or owner PINs only, migration 0015), and record who applied and who authorised in the row and in the audit log. An invalid PIN is returned rather than raised so the five-failure lockout can engage (migration 0011); since 0105 every role may hold a PIN, but a cashier's PIN still cannot approve money.

## The business day starts at 04:00, not midnight

A row belongs to the business day given by `app.business_date(at)` (migration 0034): the venue's local wall clock shifted back by `cafe_settings.analytics_business_day_start_hour` (default 4, owner-editable on /admin/settings → Day & service), so a 01:30 sale belongs to the previous evening. Every report, analytics figure, break allowance and the panel bucket by this function; nothing reimplements it.

## Which timestamp puts a row in a day

Reports and the panel (migration 0068) bucket each source by one timestamp: reservations by `start_at` (whatever the status), settled tabs by `settled_at`, orders by `placed_at`, payments and refunds by their own `created_at`, adjustments by `created_at`, voids by the audit row's time, waste by the stock movement's time, and day closes by `closed_at`. A booking made today for next week counts next week.

## Revenue is padel plus cafe net of refunds

Since migration 0099 one number is revenue everywhere: padel revenue (`reservations.price_iqd` of bookings in status confirmed, arrived or completed) plus cafe net (settled tabs' `total_iqd - court_iqd`, minus refunds). "Cafe revenue" on its own stays gross of refunds, and average order value divides the gross cafe by orders. A tab charged to a booking carries the court on its total (migration 0053), so the court is never counted twice.

## Sales basis: settled is money, served is activity

Item-level analytics take a basis (migration 0034): `settled` counts lines of tabs in status settled and reconciles with payments (the default the pages use); `served` also counts served orders on tabs not yet paid, for "today so far". Voided lines and voided orders are never counted on either basis, and `analytics_excluded_item_ids` is applied to item rankings only, never to money totals — revenue is revenue.

## Comparison bases

The panel and `report_compare` (migrations 0068, 0103) compare with `previousPeriod` (the same number of days immediately before the range) or `sameLastYear` (the same dates one year earlier); the analytics pages use `prev` (the period before), `4w` (four weeks earlier) and `52w` (a year earlier) from `packages/core/src/analytics/range.ts`. Change is current minus previous, and a percentage change is shown only when the previous value is above zero; a key that is itself a percentage changes in points.

## Evidence floors for analytics claims

A figure is stated only when it rests on enough evidence (`packages/core/src/analytics/insightsContract.ts`): a rate is shown as a percentage only on at least 20 booked slots (otherwise "n of N"), a heat-map cell needs 4 open days, guest mix needs 15 identities, a cafe attach rate needs 10 live bookings, an ending cluster (cancellations, no-shows) needs 8 endings, and a cafe item claim needs 5 units sold or 5 views. Below the floor the assistant says the evidence is thin instead of quoting the number.

## Day close: open tabs and unsynced tills block it, unpaid bookings warn

`app.close_day` (migration 0020) refuses while any tab is open (DAY_OPEN_TABS) or any till still reports a non-empty replay queue (DAY_UNSYNCED); expected cash is the opening float plus cash payments minus cash refunds, and the variance against the counted drawer is stamped on the `day_sessions` row and never recomputed. Since migration 0106 the desk's cash and card are summed into the same close, and bookings played but not paid warn through `app.unpaid_played_bookings` without blocking.

## One live tab per booking; the court fee on a tab is what is still owed

Since migration 0106 a booking can have only one open or awaiting-payment tab (BOOKING_TAB_OPEN), and the court fee that tab carries is `app.court_fee_remaining`, the part of the booking price not yet paid, so a move or extension after payment charges only the difference and a cancelled or no-show booking charges nothing. `settle_tab` takes the total the clerk saw and raises TOTAL_CHANGED if the bill moved underneath them; a tab that owes nothing is closed with `app.settle_zero_tab`.

## The desk takes court payment into its own cash box

Court-desk staff may open, settle, merge and cancel tabs and record drawer openings (migration 0106) but cannot read `payments`, `refunds` or `tab_adjustments`; the desk gets its money figures from `app.booking_bill` and `app.booking_bill_states`, so no screen does money arithmetic. Refunds stay with managers and owners behind a PIN.

## Breaks are counted per business day; cover is recorded, not signed in

A break (migration 0105) starts and ends with the person's own PIN, counts against `cafe_settings.break_allowance_minutes` (default 60) per business day, and is never cut short — a break that runs over is recorded with the overrun. While they are away another person assigned to the station in `station_staff` (or any manager or owner) can cover by entering their PIN; the machine's session stays the first person's, and the cover is written on the `staff_breaks` row and in the audit log, not minted as a login.

## Staff requests are decided once

A staff request (leave, shift swap, wage advance, record correction; migration 0072) is immutable once submitted apart from the owner's decision block; staff withdraw rather than edit, and an approve or decline on /observation/requests is final (a decline needs a reason).

## Promotions and campaigns are never deleted

Promotions (migration 0067) are switched off, never deleted, and their redemptions are replaced rather than edited; a marketing campaign (migration 0073) moves through its statuses only through `app.set_campaign_status`, and its result is the promotion's redemptions inside the campaign window — a campaign without a promotion is "Not measurable".

## Stock: the movements ledger is the truth, batches are the index

`stock_movements` (migration 0018) is the only record of what came in and went out; `stock_batches` is a FEFO index (first expiry, first out) consumed by `app.consume_fefo` when orders are sent, and on-hand figures are sums of movements. A count (`finalize_count`, migration 0019) writes adjustment movements for the differences rather than overwriting a quantity, and an expired batch is written off through a PIN-gated RPC.

## Every write leaves an audit row

Every mutating RPC calls `app.write_audit` (migration 0005) with an action string such as `tab.settle`, `reservation.move`, `order_item.void` or `staff.pin_set`, the entity, the actor, the reason code where one was required, and before/after values; /admin/audit reads it and the assistant's `audit_page` tool reads it with before/after reduced to the changed keys. A row without a reason on an action that required one is a finding, not a formatting quirk.

## Numbers in an answer come from a tool this turn

The assistant states a figure only when a tool returned it in the current turn, cites the tool, and prefers the aggregate RPC the page itself renders (`panel_headline`, `report_*`, `analytics_*`) over adding up rows, so its number and the page's number share the same business-day and basis rules (plan §7.2). A figure it cannot source is left out, and a figure under an evidence floor is described, not quoted.
