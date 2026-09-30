# Open matches: operator contract (§5, final)

Date: 2026-09-28. Status: **binding for the operator lane of the open-matches build.** It replaces
`drafts/operator-2026-09-28.md`, with the §1.12 rulings (R1–R38) and every operator fix and
disagreement pick of `drafts/review-concurrency-money-2026-09-28.md` (C…, D… in its table) and
`drafts/review-decisions-rules-2026-09-28.md` (G…, §4, §5 D…) applied. Order of authority:
`build-contracts-2026-09-27.md` §0, §1 and §1.12, then this file. Where a DB or Money draft names a
payload key differently from this file, R31 makes the pick below binding and the DB or Money
builder follows it.

`op/` is `apps/operator/src/`. `NNNN:line` is a migration line; `path:line` was read on `43625f39`.
Migrations are named by file name, not ordinal. `0249`, `0250` and `0251` were taken on 2026-09-28
by `staff_page_scopes`, `batch_yield` and `floor_orders` (commit `43625f39`), so the milestone runs
`0253`–`0265`; §1.1 now carries those ordinals.

## 5.1 Ground rules

- **Every match write is a direct `appRpc('<name>', …)` with the literal RPC name** (DF-11). No
  queued mutation type, so the six-copy rule (`apps/operator/CLAUDE.md`, "Writes") is untouched. No
  `depositRpc`-style wrapper (`op/features/deposits/depositApi.ts:22`): the assistant map finds
  operator callers with `(?:appRpc|\.rpc)\(\s*'name'` (`packages/db/scripts/build-assistant-map.mjs:516`).
- **Idempotency.** A non-idempotent write sends `p_idempotency_key` minted once per dialog as
  `` `match.<action>:${crypto.randomUUID()}` `` in a `useRef`, and re-minted after a success (the
  `CourtBlock.tsx:296,320` precedent). `match_seat_settle` and `match_link_payment` always get one;
  Money refuses a null key there (C16).
- **The server is the wall.** Screen-level buttons follow `CAPABILITY_ROLES` (§5.3). Row-level
  buttons follow the `can` objects of `desk_match_detail`. No inline role comparison.
- **No money is computed on a staff screen.** The client only sums the server's `take_iqd` over the
  seats picked for one payment; the server re-checks that sum (`SEAT_OWED_CHANGED`).
- **Clock mirrors use `server_now`** from the payload the screen is showing, never the station
  clock alone (before-start rules, deadlines).
- **Every string is a catalog key**, EN and DRAFT-AR (R38, §5.21). Numbers go through
  `formatNumber`/`formatIQD` (Latin digits in both languages, `packages/i18n/src/formatting.ts:174`),
  names inside sentences through `isolate()`, counts, `3/4` and `+1` through `isolateLtr()`
  (`packages/i18n/src/bidi.ts:20,30`), counted phrases through `pluralForm` (§5.21).

## 5.2 What the decisions force on the staff side

| Decision | Staff side |
| --- | --- |
| OM-12, OM-13 | A filling match has no reservation, so no court column shows it. It shows in the Today group (§5.9), the calendar strip (§5.8) and its own screen (§5.12). A firm booking of the last firm-free court bumps it; the new-booking dialog warns (client mirror) and the server decides. |
| R22 | An `awaiting_court` match keeps its court. A desk create on that court is refused `SLOT_TAKEN`; the dialog says why (§5.10). |
| OM-45, OM-47, R12, R39 | Attendance is per seat. `attended`: the ticket comes back and the player owes their full share. `no_show`: the ticket is lost and the share is written off. Call-off needs every carrier seat marked and the match short: at least one `no_show`, or a late leaver nobody replaced (R39). |
| R4, R21 | After the start, a walk-in may take a no-show's seat number (desk refill). A no-show whose number was re-seated can no longer be undone. |
| R9, R16, R37 | Undo (`in`) only while the match is `booked`. On `played`, only corrections between `attended` and `no_show`. Unmarked seats become `attended` when the booking completes or at `end_at + 3 h`. |
| R1 | Write-off: the desk starts it, a manager's PIN authorises it. |
| R13 | Cash-out waits while a ticket of that purchase is reserved, in use, or lost on a day still open; the refusal says until when. |
| R20, DF-16 | Café lines never go on a match booking: the desk and the till hide the entry points and the server refuses `MATCH_BOOKING_NO_CAFE`. |
| R23 | "Settled another way" only from `refund_failed`, for tickets and deposits alike. |
| R35 | A ban reason is a fixed code with an optional note. |
| OM-26 | Staff see full names and phones, plus what players see ("Players see: Sara K."). |
| OM-39 | In a women's or men's match each row shows the seat's gender and who declared it. |
| DF-4 | A move or extend re-prices the booking; shares stay stamped; the difference is a booking-level line. |
| DF-11 | Every match write is online only; the booking-level bill still takes money offline and is assigned to players later. |
| DF-12, DF-15 | The record's no-show count includes seat no-shows; a friend seat's no-show counts on the holder. |
| R10 | Matches off stops new starts and new players; matches already filling or booked carry on and the desk can still add seats. |

## 5.3 Capabilities, routes, search params

`CAPABILITY_ROLES` (`op/lib/auth.tsx:388`) gains the six §1.11 names, with R1 applied:

| Capability | Roles | Gates |
| --- | --- | --- |
| `runMatches` | court_desk, manager, owner | start, add, remove, cancel, marks, call-off, invite link, gender correction, the record's Tickets panel and Matches list (`guest_tickets` has these roles) |
| `takeSeatPayment` | cashier, court_desk, manager, owner | Take share, Take several, Assign. Never `permissionsFor().takeCourtPayment` (`auth.tsx:587`), which includes shop_staff. |
| `writeOffSeat` | court_desk, manager, owner | Write off (the manager PIN authorises, R1) |
| `cashOutTickets` | manager, owner | Cash out |
| `banFromMatches` | manager, owner | Ban and Lift on the record |
| `reviewMatchReports` | manager, owner | the Ops reports queue |

**Route.** `/desk/matches/$id` has no `ROUTE_ROLES` key: it inherits `/desk` by longest prefix
(`auth.tsx:345-362`), as `/desk/bookings/$id` does (`routes/desk/_children.ts:92`). So it needs no
`WORKSPACES`, `SUB_ROUTES` or `assistant-coverage.json` route entry (the coverage gate reads only
`ROUTE_ROLES` and `SUB_ROUTES`, `check-assistant-coverage.mjs:76`). This is the written exception to
`apps/operator/CLAUDE.md` "Roles and routes" (G8d). No rail item: matches live inside the desk.

`op/routes/desk/_children.ts`:
- `matchDetailRoute`: path `matches/$id`, `guarded('/desk', MatchDetail)`, lazy,
  `validateSearch` → `{ customer?: uuid }` (a customer handed back from search or create opens Add
  player with that customer picked);
- `validateCalendarSearch` (`:42-47`) also accepts `kind: 'match'` (with `customer`);
- `validateCustomerSearch` (`:29-36`) accepts `attach: 'match'` with `match: uuid`; the copy of that
  validator in `CustomerSearch.tsx:43-53` follows. Attach returns to
  `/desk/matches/$id?customer=<id>`;
- `customers/new` becomes `customerCreateRoute` with `validateSearch` → `{ attach?: 'match',
  match?: uuid }`; `CustomerCreate.tsx:77` returns to `/desk/matches/$id?customer=<new id>` when
  `attach=match`, else to the record as today.

## 5.4 Query keys, refresh, invalidation, live updates

**`QK.deskMatches`** (`op/lib/queryKeys.ts`), one family so one root refreshes every match read:

| Key | RPC | Refresh |
| --- | --- | --- |
| `all: ['deskMatches']` | root | — |
| `open(fromIso, toIso)` | `desk_open_matches` | 30 s, `keepPreviousData` |
| `states(sortedIds)` | `desk_match_states` | 60 s, `retry: false`, `keepPreviousData`; disabled with no ids |
| `one(matchId)` | `desk_match_detail` | 20 s, `keepPreviousData` |
| `tickets(customerId)` | `guest_tickets` | on mount and focus |
| `reports(branchId)` | `match_reports_open` | 60 s |
| `settings(branchId)` | `match_settings` | on mount |

Feature-private, as their screens already do: DayClose `['dayCloseOnline', day?.id ?? 'open']`
(60 s); the Matches view `['reports', 'report_matches', args]` (the `useComparedReport` key shape,
`ReportParts.tsx:483`).

**After each write** the caller invalidates:

| Write | Keys |
| --- | --- |
| start, add, remove, cancel, marks, call-off | `QK.deskMatches.all`, `invalidateReservations(qc)`, `QK.reservation.all`, `QK.bookingBill.all`, `QK.bookingBillStates.all` |
| seat settle, link, write-off | `QK.deskMatches.all`, `QK.bookingBill.all`, `QK.bookingBillStates.all`, `QK.day` |
| ban, gender | `QK.deskMatches.all`, `['customer', customerId]` |
| cash-out | `QK.deskMatches.tickets(customerId)`, `['customer', customerId]`, `['depositAttention']` |
| resolve report | `QK.deskMatches.reports(branch)`, `['customer', reportedId]` |
| settings | `QK.deskMatches.all` (the envelope of `desk_open_matches` carries the settings) |

**`RESULT_INVALIDATIONS`** (`op/lib/queueResults.ts:26-46`) adds `QK.deskMatches.all` to
`reservation.create`, `reservation.update` (a booking can bump; a cancel or move cascades),
`tab.open`, `tab.settle`, `payment.record`, `tab.cancel`, `tab.settle_zero` and `payment.refund`
(unassigned money and seat owed move with them). `queueResults.test.ts` keeps passing: the family
root is a registry root.

**Live updates.** No new realtime topic. `useTradingNight.ts:145-150` adds `QK.deskMatches.all` to
its `invalidateKeys`; `MatchDetail` subscribes itself with the same `useBroadcast({ topic: 'courts',
isPrivate: true, events: ['slot_changed'], invalidateKeys: [QK.deskMatches.all] })`
(`lib/realtime.ts` shares one channel per topic). `slot_changed` fires when a match books and when a
booking bumps one, because both write `reservations` (0224:145-185). Joins and requests write no
reservation; the polls above carry them.

## 5.5 Offline and failure stance (DF-11)

**Reach.** New `op/lib/stationReach.tsx`: `StationReachProvider` and `useStationReach(): {
reachable: boolean }`, mounted in `routes/__root.tsx` beside `ShiftProvider` (`:431`) from the same
heartbeat state: `reachable = venue === null || venue.error == null`. It fails open before the first
beat and outside the shell, as the shift gate does (`ShiftProvider offline={venue?.error != null}`).

**`RPC_MISSING`.** `toAppRpcError` (`op/lib/appRpc.ts:39`) maps a PostgREST `PGRST202` (function not
in the schema cache) to code `RPC_MISSING`, renderer-minted like `PIN_OWN`. A match read that meets
it renders nothing (the station talks to a server without matches), never "needs a connection".

| Situation | Behaviour |
| --- | --- |
| Offline: any match write (start, add, remove, cancel, mark, undo, call-off, take share, assign, write-off, ban, gender, cash-out, report decision, settings) | Disabled, `disabledReason` "Needs a connection: open matches work online only" / "يلزم الاتصال: المباريات المفتوحة تعمل عبر الإنترنت فقط" |
| Match reads while mounted | Last data kept (`keepPreviousData`) with a muted "Last updated {time}" line / "آخر تحديث {time}" |
| A match read that fails first time (network) | A `refused` presenter with `wifiOff`, the line "Open matches can't be shown without a connection" / "تعذّر عرض المباريات المفتوحة دون اتصال", and Retry. Nothing disappears silently. |
| A match read that fails `RPC_MISSING` | The match UI is absent, as if matches were off |
| Calendar and Today board | Work from the cached day (`useTradingNight.ts:112-134`). No chip or strip without a read; a match block still reads "Open match" through `isMatchLiteral`. |
| Booking-level bill | Fully usable through the queued `tab.open`/`tab.settle`. The money is unassigned; once online, the Players footer offers Assign. |
| No-show on a match booking | Hidden whenever the booking is known or detected as a match. A replayed booking-level no-show is refused `MATCH_MARK_SEATS` (re-issued `mark_reservation`) and surfaces through `QueueFailureToasts`; invalidation rolls the optimistic row back. |

## 5.6 Reads this lane consumes (R31 picks)

Parsers are pure and defensive (the `reportPayloads.ts` `num()`/`str()`/`obj()`/`list()` style): a
missing key renders "—", never a made-up zero.

### 5.6.1 `desk_open_matches(p_from, p_to)` → envelope (concurrency D12, rules §5 D18)

Called with the trading night's `dayStart`/`dayEnd` (`useTradingNight.ts:110`, window ≤ 3 days).

```json
{ "matches_enabled": true, "fill_deadline_minutes": 120, "earliest_start_minutes": 180,
  "ticket_price_iqd": 10000, "server_now": "…",
  "matches": [{ "match_id","venue_id","status","start_at","end_at","duration_min","category",
                "join_policy","visibility","seats_taken","seats_left","requests_pending",
                "fill_deadline_at","organised_by",
                "organiser": {"customer_id","full_name","phone"} | null,
                "price_iqd","shares_iqd","courts_free_firm","courts_total" }] }
```

Rows: non-sandbox matches of the branch in scope with status `filling`, `awaiting_court`, or
`booked` with an open seat number, and `start_at` in the window. The envelope exists because
court_desk cannot call `match_settings`. `earliest_start_minutes` = deadline + 60 (OM-43).

### 5.6.2 `desk_match_states(p_reservation_ids)` → object keyed by reservation id (rules §5 D19)

`{match_id, status, category, label, organiser_customer_id, seats_in, seats_attended,
seats_no_show, seats_unmarked, seats_left_late, open_seats}`, only for match bookings the caller can
see. `label` = the organiser's full name, else the first desk seat's typed name, else null. Money
comes from `booking_bill_states` (`seats_owing`, `seats_paid`, `money.md` §6.7), which the board
already reads.

### 5.6.3 `desk_match_detail(p_match_id)` (rules §5 D20: this list is the contract; DB builds it)

```text
match:  { id, venue_id, status, ended_reason, start_at, end_at, duration_min, category,
          join_policy, visibility, price_iqd, shares_iqd[4], fill_deadline_at, share_token,
          organised_by, organiser_seat_id,
          organiser: {customer_id, full_name, phone, flags[]} | null,
          reservation_id, reservation_status, court_id, court_name_en, court_name_ar, sandbox,
          courts_free_firm, courts_total, started, marks_open, server_now,
          can: { add_seat, cancel, call_off } }
seats:  [{ seat_id, seat_no, kind, status, end_reason, carrying,
           customer_id,              -- account: the player; friend: the holder; desk: linked customer or null
           full_name,                -- own name when known (account, linked or typed desk); null for a friend
                                     --   seat and a nameless desk extra
           display_name,             -- what players see ("Sara K.", "Former player")
           phone,                    -- account/linked: profile phone; typed desk: guest_phone; friend: null
           holder_seat_id, holder_name, companion_no,  -- friend seats, and nameless desk extras
                                     --   (holder = the seat 1 they were started with); companion_no 1..2
           gender, gender_source,    -- gender_source: 'guest' | 'holder' | 'desk' | null
           vouched, flags[], is_organiser, joined_at, ended_at, marked_at, marked_by_name,
           replaces_seat_id, replaced_by_seat_id,
           ticket: { ticket_id, status } | null,            -- null for desk seats
           write_off_reason,
           money: { share_iqd, paid_desk_iqd, credit_iqd, owed_iqd, written_off_iqd,
                    write_off, open_iqd, take_iqd } | null, -- Money's match_money seat row; null while filling;
                                     --   take_iqd = what Take share collects (owed, or a manual write-off)
           can: { mark_attended, mark_no_show, unmark, remove_reasons[], take_share, write_off,
                  replace } }]
requests: [{ request_id, customer_id, full_name, phone, flags[], seats_requested,
             friend_genders[], games_played, no_shows, created_at }]
money:  { phase, price_iqd, booking_price_iqd, price_delta_iqd, paid_iqd, live_tab_paid_iqd,
          desk_paid_iqd, unassigned_iqd, delta_owed_iqd, owed_iqd, written_off_iqd, open_iqd, over_iqd,
          vacant: [{ seat_no, open_iqd, written_off_iqd }],
          unassigned: [{ payment_id, tab_id, tab_live, method, amount_iqd, unassigned_iqd,
                         created_at }] } | null                -- null while no reservation
events: [{ at, type, actor, actor_name, seat_no, code }]      -- the last 50, newest first
```

Rules the server applies to `can` (the operator only mirrors them for offline and capability):
- `match.can.add_seat`: `filling` before its deadline with a free number; or `booked` until `end_at`
  with a number open for the desk (a vacant number, a `left_late` carrier, or after the start a
  `no_show` carrier not yet re-seated, R4/R21, `db.md` §3.2). Not for `awaiting_court` or a sandbox
  match.
- `match.can.cancel`: `filling` or `awaiting_court`.
- `match.can.call_off`: R12, R39: booked, started, day open, no carrier still `in`, the match short
  (a `no_show` carrier, or an unrefilled `left_late` carrier, who counts as absent after the start),
  at least one carrier `attended`.
- `seat.can.unmark`: R16: match `booked`, day open (`marks_open`), the ticket not locked elsewhere
  (R9), the number not re-seated (R21).
- `seat.can.mark_no_show`: at or after the start; on an `attended` seat only if its released ticket
  is still `available` and the seat has no payment links (C18, detail `paid`).
- `seat.can.remove_reasons[]`: the desk remove reasons the caller may use now (§5.13.8).
- `seat.can.take_share`: booked or played, booking live, `money.take_iqd > 0` (so a seat with a
  manual write-off can still be collected, MD-11).
- `seat.can.write_off`: after the start, `booked` or `played` (C22), seat `in` or `attended`, owes,
  not written off.
- `seat.can.replace`: after the start, the seat a `no_show` carrier not yet re-seated, before
  `end_at`.
- A sandbox match: every `can` false.
`money.unassigned[]` lists each payment on the booking's tabs (settled, or live and court-only)
whose amount less refunds is not fully linked to seats; court_desk cannot read `payments`, so this
is the only way the desk sees them (D11: Money's names, fed from `match_money`).

### 5.6.4 The other reads

| RPC (owner lane) | Called from | Keys read |
| --- | --- | --- |
| `guest_tickets(p_customer_id)` (Money, D5/D9) | record Tickets panel | `price_iqd, available, reserved, in_use, tickets[]: {id, status, price_iqd, sandbox, bought_at, match: {match_id, start_at, venue_id} \| null, forfeited_at, cashed_out_at}, purchases[]: {payment_id, request_id, status, ticket_count, unit_price_iqd, amount_iqd, bought_at, refund_reason, refund_amount_iqd, refunded_at, sandbox, cashout: {allowed, reason, tickets, amount_iqd, until_at}}, pending, server_now`. `cashout.reason` ∈ `null`, `in_use`, `reserved`, `restorable`, `none_unused`, `not_succeeded`, `done`. `forfeited` and `cashed_out` are Money's top-level counts (`tickets[]` holds only the live and the last 50 ended tickets, so it cannot be counted). |
| `match_settings(p_venue_id)` (DB) | settings panel | `venue_id, matches_enabled, match_fill_deadline_minutes, earliest_start_minutes, match_ticket_price_iqd, max_filling_matches_per_guest` |
| `match_reports_open(p_venue_id)` (DB, §5 D24 pick) | Ops | `[{report_id, reason, created_at, match: {id, start_at, category, status, reservation_id}, reported: {customer_id, full_name, phone, flags[], banned, reports_90d, no_shows}, reporter: {customer_id, full_name}}]`, oldest first |
| `day_close_online(p_day_session_id)` (Money, D10/D21) | day close | `business_date, deposits{received_iqd, received_count, refunded_iqd, refunded_count, forfeited_iqd, forfeited_count, refunds_waiting_iqd, refunds_waiting_count}, tickets_here{forfeited_iqd, forfeited_count, restored_count, cashouts_iqd, cashouts_count}, tickets_chain{sold_iqd, sold_tickets, purchases, refunded_iqd, refunded_tickets, refunds_waiting_iqd, refunds_waiting_count, liability_iqd, liability_tickets}, matches{bookings, price_iqd, desk_paid_iqd, written_off_iqd, owed_iqd, called_off, no_show_seats}, sandbox_excluded{deposits, tickets}` |
| `unpaid_played_bookings` (Money re-issue) | day close | adds `match_id, owed_by_seats_iqd, delta_owed_iqd, seats_owing[]: {seat_no, label, owed_iqd}` |
| `booking_bill` (Money re-issue) | CourtBillPanel | `court_written_off_iqd`, `match: null \| {id, status, phase, price_iqd, booking_price_iqd, price_delta_iqd, unassigned_iqd, delta_owed_iqd, owed_iqd, written_off_iqd, open_iqd, over_iqd}`, `seats[]` (with `label`, `ticket`, `write_off_reason`), `settled_tabs[].payments[].seats[]: {seat_no, amount_iqd}` |
| `booking_bill_states` (Money re-issue) | board, calendar | adds `match_id, court_written_off_iqd, seats_owing, seats_paid` |
| `customer_record`, `customer_search`, `customer_counts` (DB re-issues) | record, pickers | `customer.gender`, `customer.gender_set_by`; `counts.matchesPlayed`, `counts.matchNoShows`, `counts.lateLeaves`; `matches[]: {match_id, venue_id, start_at, status, category, seat_status, kind}` (the last 20); search rows gain `gender` |
| `report_courts` `matches` block (Money) | Courts report | `{bookings, bookedIqd, deskPaidIqd, writtenOffIqd, noShowSeats, calledOffShort, ticketForfeitsIqd}` |
| `report_matches(p_from, p_to, p_filters)` (Money, §5 D22) | Courts report, Matches view | `totals{started, booked, played, bumped, expired, cancelled, calledOffShort, allNoShow, fillRatePct, seatsFilled, accountSeats, friendSeats, deskSeats, attendedSeats, noShowSeats, leftLateSeats, refilledSeats, bookedIqd, deskPaidIqd, writtenOffIqd, ticketForfeitsIqd, sandboxExcluded}, byDay[]: {date, started, booked, bookedIqd, writtenOffIqd, noShowSeats}` |
| `panel_headline` (Money re-issue) | Management panel | the seven new keys `onlineDeposits, depositForfeits, ticketSales, ticketRefunds, ticketForfeits, ticketLiability, matchWrittenOff` |
| `deposit_attention` (Money re-issue) | Ops online refunds | items gain `purpose, ticket_count, customer_id` |

## 5.7 Writes this lane calls

| RPC | Sent from | Args the operator sends | Result keys read | Refusals handled in place |
| --- | --- | --- | --- | --- |
| `desk_start_match` | Start dialog | all §1.7 args; `p_court_id` = the tapped court; `p_gender` = `female`/`male` for `women`/`men`, else null; `p_venue_id` null; key | `match_id, price_iqd, shares_iqd` → navigate to `/desk/matches/$id` | `MATCH_TOO_LATE` (detail minutes → earliest time), `MATCH_SLOT_FULL` (list the overlapping matches with Add player), `MATCHES_OFF`, `MATCH_GENDER_MISMATCH`, `MATCH_BANNED`, `CUSTOMER_NOT_FOUND`, `SLOT_TAKEN` |
| `desk_add_seat` | Add player dialog | §1.7 args; `p_gender` as above for a typed or undeclared player; key | `seat_no, match_status, reservation_id` | `MATCH_FULL`, `MATCH_GENDER_MISMATCH`, `MATCH_BANNED`, `MATCH_ALREADY_IN`, `MATCH_NOT_FILLING`, `CUSTOMER_NOT_FOUND` (field errors in the dialog) |
| `desk_remove_seat` | Players panel | `p_seat_id`, `p_reason` (§5.13.8 form) | `match_status, ticket` | `SEAT_NOT_FOUND` (refetch), `INVALID_TRANSITION` (details), `FORBIDDEN` `manager_required` |
| `desk_cancel_match` | match screen | `p_match_id`, `p_reason` (desk cancel reason, same form) | `status` | `MATCH_NOT_FILLING` ("cancel the booking instead", with Open booking) |
| `mark_match_seats` | Players panel | `p_seat_ids` (one seat, or every `in` carrier for "Mark all arrived"), `p_attendance` ∈ `attended`, `no_show`, `in` | `match_status, reservation_status, seats[]` | `SEAT_NOT_STARTED`, `SEAT_MARK_LOCKED` (details), `INVALID_TRANSITION` |
| `desk_call_off_short` | Call-off dialog | `p_match_id` | `status, attended, no_show` | `MATCH_MARK_SEATS`, `MATCH_NOT_STARTED`, `INVALID_TRANSITION` `not_short`/`nobody_came`, `SEAT_MARK_LOCKED` `day_closed` |
| `match_seat_settle` | Take share pane | `p_seat_ids` (seat order), `p_method`, `p_expected_owed_iqd` (Σ picked `money.take_iqd`), `p_tendered_iqd` (cash), `p_amount_iqd` (a part payment of one seat only), key, `p_device_id = deviceId()` (`op/lib/idem.ts:32`) | `duplicate, payment_id, amount_iqd, change_iqd, seats[]: {seat_id, seat_no, applied_iqd, owed_iqd}` | `SEAT_OWED_CHANGED`, `NOTHING_OWED`, `BOOKING_TAB_OPEN`, `NO_OPEN_DAY`, `TENDER_SHORT`, `INVALID_AMOUNT` |
| `match_link_payment` | Assign dialog | `p_payment_id`, `p_allocations` `[{seat_id, amount_iqd}]`, or `[]` for "Keep on the booking" on a live court-only tab (§5.13.6), key | `links, unassigned_iqd, tab_closed` | `AMOUNT_OVER_SEAT`, `PAYMENT_OVER_ALLOCATED`, `PAYMENT_NOT_ON_MATCH`, `NOTHING_OWED`, `PAYMENT_STATE` (details) |
| `match_seat_write_off` | Players panel | `p_seat_id`, `p_reason` ∈ `walked_out`, `staff_error`, `other`, `p_pin`, `p_device_id = deviceId()` (R1) | `duplicate` | `PIN_INVALID`, `PIN_LOCKED`, `PIN_GRANT_REQUIRED`, `SEAT_NOT_STARTED`, `NOTHING_OWED` |
| `set_match_ban` | record | `p_customer_id`, `p_banned`, `p_reason` (ban: §5.13.8 form over the ban codes; lift: null) | `banned` | `REASON_REQUIRED`, `CUSTOMER_NOT_FOUND` |
| `staff_set_customer_gender` | record | `p_customer_id`, `p_gender` ∈ `female`, `male` | `gender, gender_set_by` | — |
| `resolve_match_report` | Ops | `p_report_id`, `p_outcome` ∈ `dismissed`, `banned` | `status, banned` | `REPORT_CLOSED` (refetch; "Someone already dealt with this report") |
| `ticket_cashout` | record | `p_customer_id`, `p_purchase_payment_id` | `duplicate, tickets_cashed_out, refund_amount_iqd, status` | `TICKET_IN_USE` (detail = the JSON text `{reason, count, until_at}`, `reason` ∈ `in_use`, `reserved`, `restorable`), `NO_UNUSED_TICKETS`, `PAYMENT_STATE` |
| `set_match_settings` | settings panel | `p_patch` (changed keys only), `p_venue_id = currentBranchId()` | the settings | `INVALID_ARGUMENT` (detail = key → that field) |

Every other refusal renders beside its control (`ErrorText`) or as a refusal presenter through
`errorToMessageKey`, plus the detail keys of §5.20. A rule refusal never reverts silently.

## 5.8 Calendar (`op/features/desk/DeskCalendar.tsx`)

**Label.** A match booking has `guest_id` NULL and `guest_name` `'Open match'` (the DB literal), so
`guestNameOf` (`deskLogic.ts:24`) would print the English literal. The block name (`DeskCalendar.tsx:1124`)
becomes `bookingLabel(r, state)`:
- a state from `desk_match_states` → `state.label`, or "Open match" when null;
- no state, and `isMatchLiteral(r)` (`guest_id === null && guest_name === MATCH_RESERVATION_NAME`) →
  "Open match";
- otherwise `guestNameOf(r)` as today.

e2e still finds blocks by name (`DeskCalendar.tsx:37-39`, `e2e/tests/operator-journey.spec.ts:99`):
walk-in blocks are unchanged, and a match block's accessible name holds the organiser's name once the
state has loaded. The comment at `:37-39` says so.

**Seat chip** (`op/features/matches/SeatChip.tsx`), after the name:
- drawn in the block's own ink (`border: 1px solid currentColor`, transparent ground, `users` icon
  12 px): no new colour token, so no blue-mode value; tone stays `reservationTone`
  (`deskStatus.tsx:62`); a match is never a colour;
- text `seatChipOf(state)`: before any mark `isolateLtr('3/4')` (4 − `open_seats`); once marking
  starts, label-and-figure pairs "Here 2 · Missing 1" / "حضور 2 · غياب 1";
- `aria-label`/`title`: "Open match · 3 of 4 players" / "مباراة مفتوحة · 3 من 4 لاعبين".

**Strip** (`op/features/matches/OpenMatchesStrip.tsx`), day view only, mounted after the book-for
strip (`DeskCalendar.tsx:803-831`). One chip per `filling`/`awaiting_court` match of the night, sorted
by start, each a link to `/desk/matches/$id`:
- "21:00–22:30 · Women · 3/4 · closes 19:00" / "21:00–22:30 · للسيدات · 3/4 · تُغلق 19:00";
- awaiting: "… · 4/4 · waiting for a court" / "… · 4/4 · بانتظار ملعب" (warn tone).
Hidden when there are none or matches are off. A failed read shows one muted line (§5.5).

**Actions dialog** (`ReservationActionsDialog.tsx`) gains `match?: MatchState` (or detects
`isMatchLiteral`): title through `bookingLabel` (`:124`), the chip in `titleAfter` (`:134`), No-show
(`:255-259`) hidden, and a **Players** button to `/desk/bookings/$id`. Move, extend and cancel stay,
with the consequence lines of §5.14.

**Book-for strip, `kind=match`.** `/desk?customer=<id>&kind=match` (the record's "Start an open
match") reads "Starting an open match for {name}: pick a free time" / "بدء مباراة مفتوحة باسم
{name}: يُرجى اختيار وقت متاح"; a free slot then opens the Start dialog directly with the court,
time and customer.

## 5.9 Today board (`op/features/desk/TodaysBoard.tsx`)

**Group "Open matches needing players"** (`op/features/matches/NeedsPlayersPanel.tsx`), after
`courtsPanel` in both layouts (`:171`, `:189`). Rows from `needsPlayersRows(open, serverNow)`, by
start. Filling and awaiting matches, plus booked ones with an open seat:

| Part | EN | AR |
| --- | --- | --- |
| Time and category | "21:00–22:30" + badge Open / Women / Men | badge للجميع / للسيدات / للرجال |
| Fill (label and figure) | "Players 3 of 4" · "Requests 1" (when > 0) | "اللاعبون 3 من 4" · "الطلبات 1" |
| Deadline | "Closes 19:00" (warn under 30 min) | "تُغلق 19:00" |
| Tags | "Ask to join", "Link only", "Last court free" (warn, `courts_free_firm = 1`), "Waiting for a court" (warn), "Booked · a seat is free" | "بطلب انضمام"، "بالرابط فقط"، "آخر ملعب متاح"، "بانتظار ملعب"، "محجوزة · مقعد شاغر" |
| Organiser | full name, else "Open match" | الاسم، وإلا "مباراة مفتوحة" |
| Actions | **Add player** (opens Add player on that match; hidden for awaiting), **Open** | **إضافة لاعب**، **فتح** |

Header action **Start an open match** / **بدء مباراة مفتوحة** (`runMatches`, matches on). States:
- matches off, none listed: the group is hidden;
- matches off, some listed (R10): the rows, and the line "Open matches are switched off here.
  Matches already started carry on." / "المباريات المفتوحة متوقفة هنا، وتستمر المباريات التي بدأت.";
- matches on, none tonight: "No open matches tonight" / "لا مباريات مفتوحة الليلة" and the button;
- failed read: §5.5; `RPC_MISSING`: hidden.

**Booking rows.** `TodaysBoardScreen` (`:692`) calls `useMatchStates(bookingIds)` next to
`useBookingBillStates` (`:714`) and passes `matchStates` down:
- `guestLabel` (`:246`) and the `CourtsNow` tiles use `bookingLabel`;
- `BoardRow` (`:607`) and `ArrivalRow` (`:382`) show the chip after the name;
- on a match booking **Mark arrived** (`:465`, `:678`) becomes **Players** / **اللاعبون**, which
  opens the booking;
- a "Played, not paid" row of a match adds "Players owing: 2" / "لاعبون لم يدفعوا: 2" from
  `booking_bill_states.seats_owing`.

`TodaysBoardView` gains the props `openMatches`, `openMatchesStatus`, `matchStates`,
`onAddPlayer`, `onOpenMatch`, `onStartMatch`, and stays pure presentation.

## 5.10 New booking dialog (`op/features/desk/CreateReservationDialog.tsx`)

**Open match kind.** `CreateKind` (`:44`) gains `match`; the segment (`:237-245`) shows "Open match"
/ "مباراة مفتوحة" when `runMatches` and matches are on; offline it is disabled with the §5.5 reason.
Choosing it closes this dialog and opens the Start dialog (§5.11) with the court, start and picked
customer carried over. The queued `reservation.create` path and the e2e selectors are untouched.

**Bump warning (client mirror).** New prop `openMatches?: readonly OpenMatch[]`, passed by both
callers (`DeskCalendar.tsx:1308`, `TodaysBoard.tsx:812`) from the same `useOpenMatches` read. For a
draft (court C, period P, kind `booking` or `maintenance`), `matchesBumpedBy(openMatches,
night.reservations, courts, draft)` returns each `filling` match M that overlaps P, where
`M.courts_free_firm = 1`, C offers `M.duration_min` (`duration_options`), and C has no firm row
overlapping M in the night's rows. Firm = every live row (`pending`, `confirmed`, `arrived`) whose
kind is not `hold` (R22). Then:
- a warn `MessagePresenter` above the price, one line per match: "Booking this court cancels the
  open match at {time} ({players} in). Their tickets go back to them." / "حجز هذا الملعب يلغي
  المباراة المفتوحة في {time} (فيها {players})، وتعود التذاكر إلى أصحابها.";
- Create stays enabled (OM-13: the booking wins);
- after an online create the caller refetches `QK.deskMatches.open` and, for each warned match no
  longer listed, toasts "Court booked. The open match at {time} was cancelled and its players have
  their tickets back." / "حُجز الملعب. أُلغيت المباراة المفتوحة في {time} وعادت التذاكر إلى
  لاعبيها." A queued create toasts only the existing "queued" line; the server decides at replay.

**A court kept for a waiting match (R22).** When an `awaiting_court` match overlaps P, an info line:
"A court at this time is kept for the open match at {time}: its four players are waiting for it." /
"أحد ملاعب هذا الوقت محجوز للمباراة المفتوحة في {time}: لاعبوها الأربعة بانتظاره." If the create is
refused `SLOT_TAKEN` while such a match overlaps, the refusal reads "This court is kept for the open
match at {time}. Pick another court or time." / "هذا الملعب محجوز للمباراة المفتوحة في {time}.
يُرجى اختيار ملعب أو وقت آخر."

## 5.11 Starting a match (`op/features/matches/StartMatchDialog.tsx`)

Opened from the new-booking dialog, the Today group, the calendar in `kind=match` mode and the
record. Pure rules in `startMatchLogic.ts`.

| Field | Values | Rule and copy |
| --- | --- | --- |
| Organiser | `CustomerPicker`, or typed name and phone mirrored from the search (`nameFromQuery`/`phoneFromQuery`, `deskLogic.ts:323,329`) | one of the two (`GUEST_REQUIRED`). A picked customer with a `match_ban` flag disables Start: "Banned from open matches" / "ممنوع من المباريات المفتوحة". |
| Coming with | 0, 1, 2 (`p_extra_seats`) | seats read "{name} +1", "+2" (`isolateLtr`) |
| Category | Open · Women · Men / للجميع · للسيدات · للرجال | Women/Men: "Every player in this match is a woman." / "المباراة للسيدات فقط." and "Every player in this match is a man." / "المباراة للرجال فقط." A linked customer whose declared gender is the other one disables Start, with a link to their record. |
| Join | Anyone joins at once · Players ask to join / الانضمام فوري · بطلب انضمام | "Ask" needs a linked customer (someone with the app answers requests); disabled otherwise: "Only a customer with the app can approve players" / "لا يوافق على اللاعبين إلا زبون لديه التطبيق" |
| Who can find it | Listed at the branch · Only with the link / معروضة في الفرع · بالرابط فقط | — |
| Court, start, length | the night's rows and the tapped court's `duration_options` (DF-2) | OM-43 mirror against `server_now`: `start ≥ now + earliest_start_minutes`. Otherwise Start is disabled: "Too close to the start for an open match: the earliest is {time}. Book the court instead." / "الموعد قريب جدًا لبدء مباراة مفتوحة: أقرب موعد ممكن {time}. يمكن حجز الملعب بدلًا من ذلك." |
| Price line | `app.price_slot` on the tapped court (as `CreateReservationDialog.tsx:151`), shares by core `splitEvenly` (`packages/core/src/money/split.ts:16`) | "Court {price} · each player pays {share} at the desk. Players who join in the app use one ticket each; desk players need none." / "الملعب {price} · حصة كل لاعب {share} تُدفع في الاستقبال. من ينضم عبر التطبيق يستخدم تذكرة واحدة، ولا يحتاج لاعبو الاستقبال إلى تذاكر." |

**Start** / **بدء المباراة** calls `desk_start_match` and navigates to `/desk/matches/$id` with the
toast "Open match started. Share the link or add players." / "بدأت المباراة المفتوحة. يمكن مشاركة
الرابط أو إضافة لاعبين." The price shown is a preview from the same function the server stamps
with (DF-3); if the stamped `price_iqd` differs, the toast instead reads "Open match started. The
court price is now {price}; each player pays {share}." / "بدأت المباراة المفتوحة. سعر الملعب الآن
{price}، وحصة كل لاعب {share}." No `p_quoted_price_iqd` is added (§4.2 item 9 of the rules review).

## 5.12 Match screen (`/desk/matches/$id`, `op/features/matches/MatchDetail.tsx`)

For every status. A booked match shows the same Players panel as its booking.

| Part | Content |
| --- | --- |
| Header | eyebrow "Open match" / "مباراة مفتوحة"; title "21:00–22:30 · Women"; subtitle: status badge, "Closes 19:00", join and visibility tags, court name when booked. Actions: **Copy invite link** / **نسخ رابط الدعوة**, **Cancel match** / **إلغاء المباراة** (`can.cancel`), **Open booking** / **فتح الحجز** (when `reservation_id`). |
| Banner | by status, §5.12.1 |
| Players | `MatchPlayersPanel` (§5.13). While filling: four numbered slots; an empty one reads "Open seat" / "مقعد شاغر" with **Add player** when `can.add_seat`. |
| Requests | approve matches only; read-only rows: name, phone, flags, "Seats 2", "Games 12", "No-shows 1" / "المقاعد 2"، "المباريات 12"، "الغياب 1", asked at. Lead: "The organiser answers requests in the app." / "يردّ المنظّم على الطلبات من التطبيق." |
| Invite link | `resolveGuestSiteUrl(import.meta.env.VITE_GUEST_SITE_URL, import.meta.env.PROD)` (`op/features/admin/qr/qrCardGeometry.ts:136`) + `/m/` + `share_token`, `dir="ltr"`. Copy toasts "Link copied" / "نُسخ الرابط". Link-only: "Only people with this link can find it." / "لا يصل إليها إلا من لديه الرابط." |
| History | `events`, one sentence per type (§5.12.2) with the actor and seat number |
| Sandbox | a sandbox match (App Review) shows "Test match: not a real booking. Nothing here can be changed." / "مباراة تجريبية وليست حجزًا حقيقيًا، ولا يمكن تعديل شيء فيها." and no controls |
| Not found | `MATCH_NOT_FOUND`: `EmptyState` "That open match isn't at this branch." / "هذه المباراة المفتوحة ليست في هذا الفرع." with Back to Today |

**Cancel match**: `ReasonCodePrompt` with the desk cancel reasons (`customer_request`,
`court_needed`, `staff_error`, `duplicate`, `other`); body "Cancels the match for everyone in it.
Tickets go back to the players; nobody is charged." / "يلغي ذلك المباراة لجميع لاعبيها، وتعود
التذاكر إليهم دون أي رسوم."

### 5.12.1 Banner and ended sentences

| Status / reason | EN | AR |
| --- | --- | --- |
| `filling` | "Players 3 of 4 · needs {players} more by {time}" | "اللاعبون 3 من 4 · ينقصها {players} قبل {time}" |
| `awaiting_court` | "All four are in. The last free court is held by a guest who is paying: if they book it, this match is cancelled; if the hold runs out, the match books by itself." | "اكتمل اللاعبون الأربعة. آخر ملعب متاح محجوز مؤقتًا لزبون يُتمّ الدفع: إن أكّد حجزه أُلغيت هذه المباراة، وإن انتهت المهلة حُجز الملعب للمباراة تلقائيًا." |
| `booked` | "Booked on {court}" | "محجوزة على {court}" |
| `played` | "Played" | "لُعبت" |
| `no_show` / `all_no_show` | "Nobody came. Every ticket in it was lost." | "لم يحضر أحد، وفُقدت كل تذاكرها." |
| `cancelled` / `organiser_cancelled` | "Cancelled by the organiser. Tickets went back." | "ألغاها المنظّم وعادت التذاكر." |
| `cancelled` / `staff_cancelled` | "Cancelled at the desk. Tickets went back." | "أُلغيت من الاستقبال وعادت التذاكر." |
| `cancelled` / `reservation_cancelled` | "The booking was cancelled. Tickets went back; no-show tickets were given back too." | "أُلغي الحجز وعادت التذاكر، بما فيها تذاكر الغائبين." |
| `cancelled` / `called_off_short` | "Called off: a player was missing. Players who came kept their tickets." | "أُلغيت لنقص لاعب، واحتفظ الحاضرون بتذاكرهم." |
| `cancelled` / `empty` | "Everyone left before it filled." | "غادر الجميع قبل اكتمالها." |
| `cancelled` / `venue_closed` | "The branch is closed at that time. Tickets went back." | "الفرع مغلق في ذلك الوقت، وعادت التذاكر." |
| `bumped` / `bumped` | "A booking took the last free court. Tickets went back." | "حجز آخر أخذ آخر ملعب متاح، وعادت التذاكر." |
| `bumped` / `no_court` | "No court offers this length any more. Tickets went back." | "لم يعد أي ملعب يتيح هذه المدة، وعادت التذاكر." |
| `expired` / `deadline` | "Not full by the deadline. Tickets went back." | "لم تكتمل قبل انتهاء المهلة، وعادت التذاكر." |
| `expired` / `no_court` | "Four players, but no court came free. Tickets went back." | "اكتمل اللاعبون الأربعة ولم يتوفر ملعب، وعادت التذاكر." |
| unknown | the raw status, neutral | — |

### 5.12.2 History sentences (`ws.matches.events.<type>`, "· {actor}" appended; system → "automatic" / "تلقائي")

| Type | EN | AR |
| --- | --- | --- |
| `started` | Match started | بدء المباراة |
| `requested` | Asked to join | طلب انضمام |
| `approved` | Request approved | قبول طلب |
| `declined` | Request declined | رفض طلب |
| `withdrawn` | Request withdrawn | سحب طلب |
| `request_expired` | Request expired | انتهاء مهلة طلب |
| `joined` | Seat {seat} taken | شغل المقعد {seat} |
| `left` | Seat {seat} left | مغادرة المقعد {seat} |
| `left_late` | Seat {seat} left after booking | مغادرة المقعد {seat} بعد الحجز |
| `refilled` | Seat {seat} taken again | شغل المقعد {seat} من جديد |
| `removed` | Seat {seat} removed ({reason}) | إزالة المقعد {seat} ({reason}) |
| `organiser_changed` | Organiser changed | تغيير المنظّم |
| `awaiting_court` | Four in, waiting for a court | اكتمال العدد بانتظار ملعب |
| `booked` | Court booked | حجز الملعب |
| `bumped` | Cancelled by a booking | إلغاء بسبب حجز |
| `expired` | Deadline passed | انتهاء المهلة |
| `cancelled` | Match cancelled | إلغاء المباراة |
| `moved` | Booking moved | نقل الحجز |
| `deadline_warning` | Deadline reminder sent | إرسال تذكير بالمهلة |
| `message` | Quick message ({code}) | رسالة سريعة ({code}) |
| `seat_attended` | Seat {seat} marked arrived | تسجيل حضور المقعد {seat} |
| `seat_no_show` | Seat {seat} marked no-show | تسجيل غياب المقعد {seat} |
| `seat_unmarked` | Seat {seat} mark undone | التراجع عن تسجيل المقعد {seat} |
| `called_off_short` | Called off, a player missing | إلغاء لنقص لاعب |
| `played` | Played | انتهاء اللعب |
| `no_show` | Nobody came | غياب الجميع |

An unknown type renders its raw word.

## 5.13 Players panel (`op/features/matches/MatchPlayersPanel.tsx`)

Rendered on the match screen and, for a match booking, on booking detail: full width and first in
the grid (`BookingDetail.tsx:283`, `gridColumn: '1 / -1'`). One row per seat number 1..4 (its
carrier, or an open seat), then ended seats (left, refilled, removed, cancelled) under "Earlier in
this match" / "سابقًا في هذه المباراة".

### 5.13.1 Row

- Kind badge: App / Friend / Desk — تطبيق / مرافق / استقبال.
- Name: `full_name`; a friend or nameless desk extra reads `{isolate(holder_name)}
  {isolateLtr('+' + companion_no)}`; a nameless row with no holder reads "Desk player {seat}" /
  "لاعب استقبال {seat}".
- Phone `dir="ltr"`; `CustomerFlagBadge`s; "Organiser" / "المنظّم" (women: "المنظّمة") tag;
  **Open customer** / **فتح ملف الزبون** when `customer_id`.
- Hint "Players see: {display_name}" / "الاسم الظاهر للاعبين: {display_name}".
- Women's or men's match (OM-39): "Plays as: Woman" / "الفئة: سيدة", "Man" / "رجل", with the source:
  "declared by the guest" / "بتصريح الزبون", "declared by {holder}" / "بتصريح {holder}", "vouched at
  the desk" / "بتأكيد الاستقبال".
- Ticket chip and the money line (§5.13.2); the row's buttons (§5.13.3–§5.13.9).

### 5.13.2 Seat lines (`seatLineOf(seat, match, serverNow)`, pure; every figure is the server's)

Third-person lines have a feminine Arabic key (`…F`) used when the category is `women`
(`byCategory(category, key)`, the guest lane's rule). EN repeats the text so parity holds.

| Seat | Ticket chip EN / AR | Line EN | Line AR (m / f) |
| --- | --- | --- | --- |
| filling, `account` | Ticket in use / تذكرة قيد الاستخدام | "From the app · share {share}, paid at the desk" | "من التطبيق · الحصة {share} تُدفع في الاستقبال" |
| filling, `friend` | On {holder}'s ticket / على تذكرة {holder} | "Share {share}, paid at the desk" | "الحصة {share} تُدفع في الاستقبال" |
| filling, `desk` | No ticket / بلا تذكرة | "From the desk · share {share}, paid on the night" | "من الاستقبال · الحصة {share} تُدفع يوم المباراة" |
| booked, `in`, before start | Ticket in use | "Share {share}, paid at the desk" | "الحصة {share} تُدفع في الاستقبال" |
| booked, `in`, after start | Ticket in use | "Not marked yet" | "لم يُسجَّل بعد" |
| `attended`, owes | Ticket back / عادت التذكرة | "Came · owes {owed}" | "حضر · عليه {owed}" / "حضرت · عليها {owed}" |
| `attended`, paid | Ticket back | "Came · paid {paid}" | "حضر · دفع {paid}" / "حضرت · دفعت {paid}" |
| `attended`, written off | Ticket back | "Came · {amount} written off ({reason})" | "حضر · شُطب {amount} ({reason})" / "حضرت · شُطب {amount} ({reason})" |
| `no_show` | Ticket lost / فُقدت التذكرة | "Didn't come · share written off" | "لم يحضر · شُطبت الحصة" / "لم تحضر · شُطبت الحصة" |
| `no_show`, re-seated | Ticket lost | "Didn't come · {name} took the seat" | "لم يحضر · أخذ {name} المقعد" / "لم تحضر · أخذت {name} المقعد" |
| `left_late`, before start | Ticket held / التذكرة محجوزة | "Left after booking · the ticket is held until someone takes the seat, and lost at the start if nobody does" | "غادر بعد الحجز · تبقى التذكرة محجوزة إلى أن يشغل أحد المقعد، وتُفقد عند البدء إن لم يشغله أحد" / "غادرت …" |
| `left_late`, after start | Ticket lost | "Left late and nobody took the seat" | "غادر متأخرًا ولم يشغل أحد المقعد" / "غادرت متأخرةً ولم يشغل أحد المقعد" |
| `refilled` | Ticket back | "Left · {name} took the seat" | "غادر · شغل {name} المقعد" / "غادرت · شغلت {name} المقعد" |
| `removed` | Ticket back | "Removed ({reason})" | "أُزيل من المباراة ({reason})" / "أُزيلت من المباراة ({reason})" |
| `left` | Ticket back | "Left before booking" | "غادر قبل الحجز" / "غادرت قبل الحجز" |
| `cancelled` (match ended) | Ticket back (or Ticket lost when `ticket.status = forfeited`) | "Match ended" | "انتهت المباراة" |
| after call-off, `attended` | Ticket back | "Called off · nothing to pay" | "أُلغيت المباراة · لا مبلغ مستحق" |
| open seat, filling | — | "Open seat" | "مقعد شاغر" |
| open seat, booked, before start | — | "Open seat · share {share} not yet taken" | "مقعد شاغر · لم تُؤخذ الحصة {share} بعد" |
| open seat, after start | — | "Empty seat · share written off" | "مقعد فارغ · شُطبت الحصة" |

Desk seats show "No ticket" in place of the chip. An unknown status renders neutral with the raw
word, as `BookingStatusIndicator` does.

### 5.13.3 Attendance

- **Arrived** / **تسجيل الحضور** (`can.mark_attended`) and **No-show** / **تسجيل الغياب**
  (`can.mark_no_show`), one click each, optimistic on `QK.deskMatches.one(id)` (the
  `ReservationActionsDialog.tsx:96-111` pattern) and rolled back on any refusal.
- Before the start No-show is disabled with "A no-show can be marked once the game starts" / "لا
  يُسجَّل الغياب قبل بدء المباراة" (mirror of `SEAT_NOT_STARTED`, against `server_now`).
- **Undo** / **تراجع** on a marked row while `can.unmark` (R9, R16: `p_attendance = 'in'`, only while
  `booked`).
- Corrections: an `attended` row offers **Mark no-show instead** / **تسجيل غياب بدلًا من ذلك**
  (`can.mark_no_show`); a `no_show` row offers **Mark arrived instead** / **تسجيل حضور بدلًا من
  ذلك** (`can.mark_attended`). On `played` these corrections are all there is.
- Footer **Mark all arrived** / **تسجيل حضور الجميع**: every `in` carrier with
  `can.mark_attended`, one call.
- Footer line after the start while any carrier is `in`: "Unmarked players count as arrived when the
  booking is completed, or three hours after it ends." / "يُعدّ من لم يُسجَّل حاضرًا عند إكمال
  الحجز، أو بعد ثلاث ساعات من نهايته." (R37)

### 5.13.4 Take share (`takeSeatPayment`, `seat.can.take_share`)

Opens the till's `PaymentPane` (`op/features/till/PaymentPane.tsx:68`), which gains two optional
props: `subtitle` ("{name}'s share" / "حصة {name}") and `allowPartial` (default true). `due` = the
seat's `money.take_iqd` (its `owed_iqd`, or the share a manager wrote off, which taking it clears,
MD-11). The shift gate works unchanged. On success: toast "Took {amount} for
{name}." / "استُلم {amount} عن {name}." plus "Change {change}" / "الباقي {change}" for cash.

### 5.13.5 Several shares in one payment

Footer toggle **Take several** / **استلام عدة حصص** turns the rows with `can.take_share` into checkboxes; the button reads
"Take {shares} · {amount}" / "استلام {shares} · {amount}" (`shares` a plural phrase, §5.21). A holder
with owing friend seats also gets "Take {name}'s group · {amount}" / "استلام حصص مجموعة {name} ·
{amount}". `due` = Σ picked `take_iqd`, `allowPartial={false}`, seats sent in seat order (the server
spreads the money in that order).

**`SEAT_OWED_CHANGED`**: refetch the detail, keep the pane open with the new due and the line "What
this player owes changed to {amount}. Check before taking it." / "تغيّر المستحق على هذا اللاعب إلى
{amount}. يُرجى التحقق قبل الاستلام." When the new due is 0 the pane closes: "Nothing left to take for
this seat." / "لم يبقَ ما يُستلم عن هذا المقعد." (the `TOTAL_CHANGED` precedent,
`CourtBillPanel.tsx:179`).

**`BOOKING_TAB_OPEN`**: the booking has a live bill with money on it (taken offline, or with the
bill's own Cash/Card). The pane closes with "This booking has a bill open with money on it. Assign
that money to players first, then take the rest here." / "على هذا الحجز فاتورة مفتوحة فيها مبلغ
مدفوع. يلزم توزيع ذلك المبلغ على اللاعبين أولًا، ثم استلام الباقي من هنا." and the Assign dialog
opens on that payment (Assign closes a live court-only tab at what was paid, `money.md` §6.5).

### 5.13.6 Assign (`takeSeatPayment`, when `money.unassigned` is not empty)

Footer line "Taken at the desk without a player: {amount} · Assign" / "مبلغ مستلم دون تحديد لاعب:
{amount} · توزيع". The dialog (`op/features/matches/AssignPaymentDialog.tsx`) lists owing seats with
amount boxes pre-filled in seat order up to each seat's owed, per unassigned payment. Save calls
`match_link_payment` once per payment. For a payment on a **live** court-only tab it also offers
**Keep on the booking** / **إبقاؤه على الحجز** (`p_allocations = []`), which closes the tab at what
was paid and leaves the amount on the booking, for a DF-4 price rise or money the desk cannot
attribute (C22). Refusals: `AMOUNT_OVER_SEAT` and `PAYMENT_OVER_ALLOCATED` on the field.

### 5.13.7 Write off (`writeOffSeat`, `seat.can.write_off`; R1)

`PinReasonModal` (`op/components/ui.tsx:867`) with `reasons={['walked_out', 'staff_error',
'other']}`. Title "Write off {name}'s share" / "شطب حصة {name}"; body "The booking stops owing
{amount}, and reports show it as written off. A manager's PIN authorises this." / "يسقط عن الحجز
مبلغ {amount}، ويظهر في التقارير مشطوبًا. يلزم رمز مدير لإتمام ذلك." `appRpc` proves the PIN first
because `PIN_GATED_RPCS` lists the RPC (§5.25). A write-off has no undo button; it is cleared only
by taking the share: the row keeps **Take share** (`can.take_share`, `take_iqd` = the written-off
amount), and the settle clears the write-off in the same call (MD-11).

### 5.13.8 Remove, and the reason argument form

`ReasonCodePrompt` with exactly `seat.can.remove_reasons`. Consequence line by state:
- filling: "Their ticket goes back. Removed for conduct, they can't rejoin this match." / "تعود
  التذكرة. ومن أُزيل لسوء السلوك لا يمكنه العودة إلى هذه المباراة.";
- booked, `customer_request`/`conduct`/`other`: "Counts as leaving late: the ticket is held until
  someone takes the seat, and lost at the start if nobody does." / "تُحسب مغادرة متأخرة: تبقى التذكرة
  محجوزة إلى أن يشغل أحد المقعد، وتُفقد عند البدء إن لم يشغله أحد.";
- booked, `staff_error`/`duplicate` (offered by the server to manager and owner only): "Their ticket
  goes back. Nothing counts against them." / "تعود التذكرة، ولا يُحتسب شيء على اللاعب.";
- an account seat with friend seats adds "Their friends' seats go too." / "وتُزال مقاعد مرافقيه
  أيضًا." (women: "مرافقاتها").

**Reason argument form (decided here, binding on DB).** Every match RPC that takes a fixed reason
code (`desk_remove_seat`, `desk_cancel_match`, `set_match_ban`) accepts `p_reason` as `<code>` or
`<code>: <note>`, the house form every `ReasonCodePrompt` caller sends (`kit.tsx:1678`,
`BookingDetail.tsx:190`). The server validates the code before the first `': '`, stores only the code
on the row, the event and the `customer_flags.label`, keeps the whole text in the audit row (R35's
optional note), and caps the note at 200 characters. `match_seat_write_off` takes the bare code.

### 5.13.9 Add player and walk-in replacement

**Add player** (footer, `match.can.add_seat`) opens `op/features/matches/AddSeatDialog.tsx`:
- `CustomerPicker` with the typed-query mirror, the typed name and phone, and **Create customer** →
  `/desk/customers/new?attach=match&match=<id>`;
- a picked customer with `match_ban` disables Add: "Banned from open matches";
- in a women's or men's match, a linked customer whose declared gender is the other one disables Add
  with a link to their record; an undeclared one is sent with the category's gender, and the dialog
  says "Seated as a woman (vouched at the desk)." / "يُضاف إلى فئة السيدات بتأكيد الاستقبال." (men:
  "يُضاف إلى فئة الرجال بتأكيد الاستقبال.");
- on a booked match the title reads "Add a player in a free seat" / "إضافة لاعب في مقعد شاغر", with
  "They owe the seat's share of {share}." / "وعليه حصة المقعد {share}.";
- success toasts: "{name} is in." / "أُضيف {name}."; at four: "Four in: booked on {court}." / "اكتمل
  العدد: حُجز {court}." or "Four in: waiting for a court." / "اكتمل العدد: بانتظار ملعب.".

**Walk-in in a no-show's place (R4, R21).** A `no_show` row with `can.replace` reads "Seat free for
a walk-in" / "المقعد متاح لزبون عابر". It offers **Add player here** / **إضافة لاعب هنا** only when it
is the match's single open number (the server fills the lowest open number; with two, only the
footer button shows). The no-show keeps its row, forfeit and DF-12 count.

### 5.13.10 Call off short (R12)

A danger button in the footer after the start while the match is `booked` and short: some carrier
is `no_show`, or is a late leaver nobody replaced (who counts as absent after the start, R39):
- disabled while any carrier is unmarked: "Mark every player first ({players} not marked)" / "يلزم
  تسجيل كل اللاعبين أولًا (بلا تسجيل: {players})";
- enabled when `match.can.call_off`.

Confirmation (`op/features/matches/CallOffDialog.tsx`, `ConfirmDialog kind="danger"
requireChoice`), names joined as `DayClose.tsx:397` does; "Didn't come" lists the `no_show` carriers
and the unreplaced late leavers:

> **Call off this match?**
> Came: Sara Karim, Ali Hasan, Noor Salem. Didn't come: Omar Khalid. Calling off cancels the
> booking and nobody pays for the court. The players who came keep their tickets; the ticket of
> anyone who didn't come is lost. This can't be undone.
> *(when `money.desk_paid_iqd > 0`)* {amount} was already taken at the desk for this match. After calling
> off, a manager refunds it at the till.
>
> [Keep playing] [Call off the match]

DRAFT-AR (verbal nouns, no imperative, R38):
> **إلغاء المباراة لنقص لاعب؟**
> الحاضرون: {came}. الغائبون: {missing}. يُلغى بذلك حجز الملعب ولا يدفع أحد ثمنه. يحتفظ الحاضرون
> بتذاكرهم، وتُفقد تذكرة كل غائب. لا يمكن التراجع عن ذلك.
> سبق استلام {amount} لهذه المباراة في الاستقبال. بعد الإلغاء، يردّه مدير عند الصندوق.
>
> [متابعة اللعب] [إلغاء المباراة]

Women: "الحاضرات"، "الغائبات"، "تذكرة كل غائبة".

**Footer line (DF-4)**: "Price changed after booking: {delta}. It is on the bill, not on a player."
/ "تغيّر السعر بعد الحجز: {delta}. الفرق على الفاتورة لا على اللاعبين." when `price_delta_iqd ≠ 0`.

## 5.14 Booking detail and the bill on a match booking

**`BookingDetail.tsx`**, when `desk_match_states` names the booking (or `isMatchLiteral`):
- eyebrow "Open match" (`:233`); title "Open match · {label}"; the Customer row links the organiser
  (`organiser_customer_id`); the Contact row (`:305`) is dropped (phones are per seat);
- the Players panel is first, full width;
- **No-show** (`:405-415`) hidden; `MATCH_MARK_SEATS` joins `OVERRIDE_REFUSAL_CODES`
  (`deskLogic.ts:259`) so a refusal renders as a rule;
- **Charge on till** (`:253`) hidden (DF-16);
- the cancel prompt adds "Cancels the open match for all its players. Their tickets go back." /
  "يلغي ذلك المباراة المفتوحة لجميع لاعبيها وتعود تذاكرهم."; move and extend add "Shares stay as
  they are; any price difference goes on the bill." / "تبقى الحصص كما هي، ويُضاف أي فرق في السعر
  إلى الفاتورة.";
- `invalidate()` (`:108-116`) adds `QK.deskMatches.all`.

**`CourtBillPanel.tsx`** stays the booking-level truth:
- `bill.match` with money owed: `matchBillSentence(bill)` → "Players owe {amount} between them. Take
  each share under Players; money taken here stays unassigned until you assign it." / "على
  اللاعبين {amount} مجتمعين. تُستلم كل حصة من قسم اللاعبين، ويبقى المبلغ المستلم هنا دون توزيع إلى
  أن يُوزَّع.";
- `BillRow`s: "Written off" / "مشطوب" (`court_written_off_iqd > 0`), "Price changed after booking"
  / "تغيّر السعر بعد الحجز" (`price_delta_iqd ≠ 0`), "Not assigned to players yet" / "لم يُوزَّع على
  اللاعبين بعد" (`unassigned_iqd > 0`);
- each settled payment line with links adds "Seats 1, 2" / "المقعدان 1 و2" from `payments[].seats`
  (label-and-list form: "Seats: 1, 2" / "المقاعد: 1، 2");
- **Add cafe bill** (`:326`) hidden (DF-16); Cash and Card stay (the offline path and DF-4);
- `invalidate()` (`:123`) adds `QK.deskMatches.all`.
`deskPaymentLogic.ts` gains the `match`, `seats` and `court_written_off_iqd` fields on `BookingBill`
and a pure `matchBillSentence(bill)`; `panelStateOf` (`:121`) is unchanged.

**The till's booking picker (DF-16).** `useTodaysOpenReservations` (`op/features/till/NewTabDialog.tsx:35`)
selects `guest_id` as well and drops rows where `isMatchLiteral(r)`, so neither "Charge to booking"
nor the new-tab picker lists a match booking. The server wall is R20; `MATCH_BOOKING_NO_CAFE`
reaches the till through `QueueFailureToasts` if a stale build tries.

## 5.15 Customer record (`op/features/desk/customers/CustomerRecord.tsx`)

| Part | Content | Gate |
| --- | --- | --- |
| Counts (`:112-115`) | "No-shows 3 (open matches 1)" / "الغياب 3 (منها في المباريات المفتوحة 1)" from `counts.noShows` and `counts.matchNoShows` (DF-12, DF-15); "Open matches played 7" / "المباريات المفتوحة التي لعبها 7"; "Late leaves 1" / "مغادرات متأخرة 1" | — |
| Plays as | "Woman · set by the guest" / "سيدة · بتحديد الزبون", "Man · set at the desk" / "رجل · بتحديد الاستقبال", "Not set" / "غير محدّد", with **Change** / **تغيير** (two choices, `staff_set_customer_gender`) and the lead "This decides which women's or men's matches they see and can join." / "يحدّد ذلك مباريات السيدات أو الرجال التي تظهر لهذا الزبون ويمكنه الانضمام إليها." | `runMatches` |
| Tickets (`op/features/desk/customers/TicketsPanel.tsx`) | label-and-figure rows: Available / متاحة, Held for a request / محجوزة لطلب, In a match / في مباراة, Lost / مفقودة, Cashed out / مستردّة; "Tickets work at every branch." / "التذاكر صالحة في كل الفروع."; purchases with date, count, price paid, a "Test" badge for sandbox, and the refund state: "Refund requested" / "طُلب الاسترداد", "Refund failed: see Online refunds on Ops" / "تعذّر الاسترداد: يُرجى مراجعة الاستردادات الإلكترونية في العمليات", "Refunded {date}" / "رُدّ المبلغ في {date}"; "Payment in progress" / "دفع قيد الإتمام" from `pending` | `runMatches` |
| Cash out | per purchase, §5.15.1 | `cashOutTickets` |
| Ban | header badge `match_ban` through `CustomerFlagBadge`; **Ban from open matches** / **منع من المباريات المفتوحة** and **Lift ban** / **رفع المنع**, §5.15.2 | `banFromMatches` |
| Open matches | upcoming and recent from `matches[]`: time, category, seat status; a row at this branch opens `/desk/matches/$id`; a row at another branch shows its branch name and no link | `runMatches` |
| Start an open match | header button → `/desk?customer=<id>&kind=match` | `runMatches` |

`FLAG_TYPES` (`:24`) keeps its five types, so `FlagsEditor` never lists or sends `match_ban`; the
re-issued `set_customer_flags` carries the stored ban over. `CustomerFlagType` (`op/components/kit.tsx:517`)
gains `match_ban` with `FLAG_META` `{ tone: 'danger', icon: 'ban' }`; for that type the badge
translates `label` (a ban code) through `ws.kit.flags.matchBanReason.<code>` instead of printing it
(§4.2 item 5 of the rules review): "Banned from open matches · Reported by players" / "ممنوع من
المباريات المفتوحة · بلاغات من لاعبين".

### 5.15.1 Cash out (R13)

From `purchases[].cashout`:
- `allowed`: **Cash out {tickets} · {amount}** / **استرداد {tickets} · {amount}** → confirm "Refund
  {tickets} ({amount}) to the card they were bought with? They leave the wallet now, and Qi sends the
  money back to the card." / "ردّ {tickets} ({amount}) إلى البطاقة التي اشتُريت بها؟ تُسحب من
  المحفظة الآن، وتعيد Qi المبلغ إلى البطاقة." → `ticket_cashout`; toast "Refund requested." / "طُلب
  الاسترداد.";
- `in_use`: disabled, "A ticket from this purchase is in a match until {time}. Cash out after that."
  / "إحدى تذاكر هذه الدفعة في مباراة حتى {time}، ويمكن الاسترداد بعد ذلك.";
- `reserved`: disabled, "A ticket from this purchase is held for a request until {time}." / "إحدى
  تذاكر هذه الدفعة محجوزة لطلب انضمام حتى {time}.";
- `restorable`: disabled, "A ticket from this purchase was lost today and can still be given back
  until the day is closed. Cash out after day close." / "فُقدت اليوم إحدى تذاكر هذه الدفعة، ويمكن
  إعادتها حتى إغلاق اليوم. يمكن الاسترداد بعد إغلاق اليوم.";
- `none_unused`, `not_succeeded`, `done`: no button; the refund state line.
The same three sentences render a `TICKET_IN_USE` refusal from its detail (§5.20).

### 5.15.2 Ban (R35) and gender

**Ban**: `ReasonCodePrompt` with `reasonCodes={['conduct', 'no_shows', 'reported', 'other']}` and the
new `noteMode="optional"` (a note field under every code, required for `other`; §5.25), sending the
§5.13.8 form. Body "Applies at every branch: no new matches, joins or requests. Seats in matches
still filling are released and their tickets come back; booked games stay." / "يسري المنع في كل
الفروع: لا بدء لمباريات جديدة ولا انضمام ولا طلبات. تُلغى مقاعد هذا الزبون في المباريات غير
المكتملة وتعود تذاكرها، وتبقى المباريات المحجوزة كما هي." **Lift ban**: `ConfirmDialog` "Lift the ban
on open matches?" / "رفع المنع من المباريات المفتوحة؟", `p_reason` null.

**Change gender**: two-choice dialog (`op/features/desk/customers/GenderDialog.tsx`); seats already
taken keep the gender stamped when they were taken.

## 5.16 Match settings (`op/features/admin/settings/MatchSettingsPanel.tsx`)

In Venue details: owner `afterRules={<><DepositSettingsPanel canEdit /><MatchSettingsPanel canEdit
/></>}` (`VenueDetailsTab.tsx:92`); manager `<MatchSettingsPanel canEdit={false} />` after
`DepositSettingsPanel` (`:126`). The gate is the existing `can(role, 'editVenueDetails')` (`:60`). Own
draft and own Save, like `DepositSettingsPanel`. Pure rules in `matchSettingsLogic.ts` (draft,
patch of changed keys, field errors, server key → field).

| Field | Scope label | Bounds | Copy EN / AR |
| --- | --- | --- | --- |
| Open matches at this branch (`matches_enabled`) | This branch / هذا الفرع | boolean | Off: "Nobody can start a new open match here and no new players can join. Matches already started carry on." / "لا يمكن بدء مباراة مفتوحة جديدة هنا ولا انضمام لاعبين جدد، وتستمر المباريات التي بدأت." |
| Fill deadline (`match_fill_deadline_minutes`) | This branch | 60..2880 min | "A match not full this long before it starts is cancelled, and its tickets go back. A match can only be started for a time at least this long, plus one hour, from now." / "تُلغى المباراة التي لم تكتمل قبل موعدها بهذه المدة، وتعود تذاكرها. ولا تبدأ مباراة إلا لموعد يبعد هذه المدة وساعةً إضافية على الأقل." |
| Ticket price (`match_ticket_price_iqd`) | All branches / كل الفروع | 1,000..1,000,000, multiple of 250 | "Tickets already bought keep the price paid; a cash-out returns what was paid." / "تحتفظ التذاكر المشتراة بسعرها، ويُردّ عند الاسترداد المبلغ المدفوع." |
| Filling matches per player (`max_filling_matches_per_guest`) | All branches | 1..10 | "How many open matches one player can have filling at once." / "عدد المباريات غير المكتملة المسموح للاعب الواحد في وقت واحد." |

"All branches" fields sit under the lead "Changing these changes them at every branch." / "يسري
تغيير هذه الإعدادات على كل الفروع." A manager sees `Facts` rows and "Only the owner can change these."
/ "يغيّر هذه الإعدادات المالك فقط." `INVALID_ARGUMENT` with a key in its detail lands on that field.

## 5.17 Ops: reports queue and online refunds

**Reports queue** (`op/features/ops/MatchReportsPanel.tsx`), mounted `hideWhenEmpty` after
`DepositAttentionPanel` (`op/features/ops/OperationsOverview.tsx:184`), gated `reviewMatchReports`.
Title "Player reports" / "بلاغات اللاعبين". A row: the reason (`ws.matches.ops.reason.<reason>`,
§5.21), when, the match (time, category, status, **Open match**), the reported player (full name,
phone, flags, "Reports in 90 days 2" / "البلاغات خلال 90 يومًا 2", "No-shows 1" / "الغياب 1",
**Open customer**), the reporter's name. Actions:
- **Close report** / **إغلاق البلاغ** (`dismissed`), one click, toast "Report closed." / "أُغلق
  البلاغ.";
- **Ban** / **منع** (hidden when `reported.banned`): `ConfirmDialog kind="danger"` "Ban {name} from
  open matches at every branch? The reason recorded is: Reported by players." / "منع {name} من
  المباريات المفتوحة في كل الفروع؟ السبب المسجّل: بلاغات من لاعبين." → `banned`.
Managers learn of a new report from the staff push `match_report_new` (R5), which opens the staff
phone's home; the queue is here. No rail badge in v1 (`lib/workspaces.ts` badges are a closed union).

**Online refunds** (`op/features/deposits/DepositAttentionPanel.tsx`, `depositAttentionLogic.ts`):
- R23: `attentionActions(row).settle` becomes `row.status === 'refund_failed'` only, for deposits
  and tickets; a `refund_pending` row shows "Qi hasn't answered yet. It is retried on its own and
  moves here as failed if it keeps failing." / "لم تردّ Qi بعد. تُعاد المحاولة تلقائيًا، وتظهر هنا
  متعذّرة إن استمر الفشل." and no button;
- ticket rows (`purpose = 'ticket'`, no reservation): "Ticket refund · {tickets} · {name}" /
  "استرداد تذاكر · {tickets} · {name}", the tag "Any branch can settle this" / "يمكن لأي فرع
  معالجته" (§4.4 item 4 of the rules review), and **Open customer** (`customer_id`);
- `RefundReason` (`depositApi.ts:55`) gains `ticket_cashout` ("Tickets cashed out" / "استرداد
  تذاكر") and `account_deleted` ("Account deleted" / "حذف الحساب").

## 5.18 Day close (`op/features/admin/DayClose.tsx`)

**"Money outside the drawer"** / **"أموال خارج الصندوق"** (`op/features/admin/DayCloseOnline.tsx`),
mounted `{!closeResult && <DayCloseOnline />}` beside `DayCloseShop` (`:724`). Information only: it
never blocks and never enters the cash count. Hidden when every figure is zero.

| Group | Rows (label and figure; counts and money) |
| --- | --- |
| Online deposits, this branch / العربون الإلكتروني، هذا الفرع | Received · Refunded · Kept for no-shows · Refunds waiting / المستلم · المردود · المحتجز لعدم الحضور · استردادات قيد الانتظار |
| Match tickets at this branch / تذاكر المباريات في هذا الفرع | Lost at this branch (revenue) · Cashed out here / المفقودة في هذا الفرع (إيراد) · المستردّة هنا |
| Match tickets, all branches / تذاكر المباريات، كل الفروع | Sold · Refunded · Refunds waiting · Unused, owed to players / المباعة · المردودة · استردادات قيد الانتظار · غير المستخدمة (مستحقة للاعبين) |
| Open-match bookings today / حجوزات المباريات المفتوحة اليوم | Bookings · Court price · Paid at the desk · Written off · Still owed · Called off · No-show seats / الحجوزات · سعر الملاعب · المدفوع في الاستقبال · المشطوب · المتبقي · الملغاة لنقص لاعب · مقاعد الغياب |
| Test payments left out / دفعات تجريبية مستبعدة | shown muted only when non-zero |

**Played, not paid** (`UnpaidPlayed`, `:829`): `UnpaidPlayedBooking` (`dayCloseLogic.ts:331`) gains
optional `match_id`, `owed_by_seats_iqd`, `delta_owed_iqd`, `seats_owing`. A match row reads "Open
match · {label}" / "مباراة مفتوحة · {label}" and lists "Seat 2 · Ali Hasan · 10,000" / "المقعد 2 ·
Ali Hasan · 10,000" per owing seat. A booking whose only gap is written-off shares no longer appears,
because `court_fee_remaining` nets them (`money.md` §6.3).

## 5.19 Reports

**Courts report** (`op/features/reports/CourtsReport.tsx`):
- `readCourts` (`reportPayloads.ts:161`) reads the optional `matches` block; `VIEWS` (`:69`) gains
  `matches`, offered when the payload carries the block (the server supports it);
- the Matches view: a band from `report_courts.matches` (bookings, booked, paid at the desk, written
  off, no-show seats, called off, lost tickets at this branch) and, from `report_matches` for the
  same period with its own filters (category, join policy; the court filter hides), the counts
  (started, booked, played, bumped, expired, cancelled, called off, all no-show, fill rate, seats by
  app / friend / desk, attended / no-show / late-leave / refilled seats) and a By day table. "Compare
  with" is disabled in this view: "Comparison isn't available for open matches yet." / "المقارنة غير
  متاحة للمباريات المفتوحة بعد." (`report_compare` knows three reports, `ReportParts.tsx:476`).
  Empty period: "No open matches in this period." / "لا مباريات مفتوحة في هذه الفترة.";
- `report_matches` matches `REPORT_RPC` (`op/lib/venueScope.ts:61`), so the owner's "All branches"
  scope works with no change. Lead: `ws.reports.courts.lead.matches`; view label
  `ws.reports.courts.views.matches` "Open matches" / "المباريات المفتوحة".

**Management panel (owner)** (`op/features/panel/figures.ts`, `ManagementPanel.tsx`), so the seven
new `panel_headline` keys are shown somewhere (§4.4 item 3 of the rules review, owner named here):
`FIGURE_KEYS` gains `onlineDeposits`, `depositForfeits`, `ticketSales`, `ticketRefunds`,
`ticketForfeits`, `ticketLiability`, `matchWrittenOff` in a new group `online`, rendered as its own
Panel "Online money and open matches" / "الأموال الإلكترونية والمباريات المفتوحة" and hidden when none
came back. `ticketSales`, `ticketRefunds` and `ticketLiability` carry the hint "All branches" / "كل
الفروع". `ticketRefunds` and `matchWrittenOff` are `invert: true` (a rise is bad); the other five are
not. Reports opened: `/reports/courts` for the match and ticket keys, `/reports/revenue` for the
deposit keys. Labels under `ws.owner.panel.figures.*`.
The headline itself is unchanged (owner question carried in §1.12).

## 5.20 Errors

**`MAPPED_CODES`** (`op/lib/errors.ts:10`) and `op.errors.*` in `opErrors.matches.en.ts` /
`.ar.ts` (spread into `op.errors` beside `opErrorsProtocolsEn`, `en.ts:2028`, and
`opErrorsProtocolsAr`, `ar.ts:1900`). Per R11 and R28, each row lands in the migration step that first
raises the code, in the wording below; `RPC_MISSING` lands with the operator step. `errors.test.ts`
keeps asserting both catalogs; `CUSTOMER_NOT_FOUND` leaves `fixtures/error-codes-unmapped.json:23`
through `check-error-codes.mjs --update` in the same commit.

| Code | EN | AR |
| --- | --- | --- |
| `MATCHES_OFF` | Open matches are switched off at this branch. | المباريات المفتوحة متوقفة في هذا الفرع. |
| `MATCH_NOT_FOUND` | That open match isn't at this branch any more. | هذه المباراة المفتوحة لم تعد في هذا الفرع. |
| `MATCH_NOT_FILLING` | This match isn't filling any more. A booked match is changed from its booking. | لم تعد هذه المباراة قيد الاكتمال. تُعدَّل المباراة المحجوزة من صفحة حجزها. |
| `MATCH_NOT_BOOKED` | This match has no court booked. | لا ملعب محجوز لهذه المباراة. |
| `MATCH_NOT_STARTED` | The game hasn't started yet. | لم تبدأ المباراة بعد. |
| `MATCH_FULL` | No seat is free in this match. | لا مقعد شاغر في هذه المباراة. |
| `MATCH_TOO_LATE` | Too close to the start for an open match. Book the court instead. | الموعد قريب جدًا لبدء مباراة مفتوحة، ويمكن حجز الملعب بدلًا منها. |
| `MATCH_SLOT_FULL` | Enough open matches are already filling at that time. Add the players to one of them. | في هذا الموعد ما يكفي من المباريات المفتوحة قيد الاكتمال. يمكن إضافة اللاعبين إلى إحداها. |
| `MATCH_GENDER_MISMATCH` | This player doesn't fit this match's category. | هذا اللاعب لا يناسب فئة هذه المباراة. |
| `MATCH_SEAT_LIMIT` | One player can hold at most three seats. | لا يحق للاعب الواحد أكثر من ثلاثة مقاعد. |
| `MATCH_BANNED` | This customer is banned from open matches. | هذا الزبون ممنوع من المباريات المفتوحة. |
| `MATCH_MARK_SEATS` | Open matches are marked player by player, under Players. | يُسجَّل الحضور في المباريات المفتوحة لكل لاعب على حدة، من قسم اللاعبين. |
| `MATCH_ALREADY_IN` | This customer is already in this match. | هذا الزبون موجود في المباراة أصلًا. |
| `MATCH_BOOKING_NO_CAFE` | Café orders don't go on an open match's booking. Open a separate café bill. | لا تُضاف طلبات المقهى إلى حجز مباراة مفتوحة. يُرجى فتح فاتورة مقهى منفصلة. |
| `SEAT_NOT_FOUND` | That seat changed. The list has been refreshed. | تغيّر هذا المقعد، وحُدّثت القائمة. |
| `SEAT_NOT_STARTED` | A no-show can be marked once the game starts. | لا يُسجَّل الغياب قبل بدء المباراة. |
| `SEAT_MARK_LOCKED` | This mark can't be changed any more. | لم يعد تعديل هذا التسجيل ممكنًا. |
| `SEAT_OWED_CHANGED` | What this player owes just changed. Check the new amount. | تغيّر المستحق على هذا اللاعب للتو. يُرجى مراجعة المبلغ الجديد. |
| `NOTHING_OWED` | Nothing is owed for this seat. | لا مبلغ مستحق على هذا المقعد. |
| `PAYMENT_NOT_ON_MATCH` | That payment isn't on this match's booking. | هذه الدفعة ليست على حجز هذه المباراة. |
| `AMOUNT_OVER_SEAT` | That's more than this player owes. | المبلغ أكبر مما على هذا اللاعب. |
| `PAYMENT_OVER_ALLOCATED` | That's more than the payment has left to assign. | المبلغ أكبر من المتبقي من الدفعة للتوزيع. |
| `REPORT_NOT_FOUND` | That report isn't there any more. | هذا البلاغ لم يعد موجودًا. |
| `REPORT_CLOSED` | Someone already dealt with this report. | سبقت معالجة هذا البلاغ. |
| `NO_UNUSED_TICKETS` | No unused tickets are left on that purchase. | لم تبقَ في هذه الدفعة تذاكر غير مستخدمة. |
| `TICKET_IN_USE` | A ticket from this purchase is still in use. Cash out once it comes back. | إحدى تذاكر هذه الدفعة ما زالت قيد الاستخدام. يمكن الاسترداد بعد عودتها. |
| `CUSTOMER_NOT_FOUND` | That customer can't be found. | تعذّر العثور على هذا الزبون. |
| `RPC_MISSING` | This needs a server update that isn't there yet. | يتطلب هذا تحديثًا للخادم لم يصل بعد. |

Already mapped and reused: `FORBIDDEN`, `VENUE_MISMATCH`, `REASON_REQUIRED`, `INVALID_TRANSITION`,
`GUEST_REQUIRED`, `SLOT_TAKEN`, `PAYMENT_NOT_FOUND`, `PAYMENT_STATE`, `PIN_GRANT_REQUIRED`,
`PIN_INVALID`, `PIN_LOCKED`, `INVALID_ARGUMENT`, `BOOKING_TAB_OPEN`, `NO_OPEN_DAY`, `TENDER_SHORT`,
`INVALID_AMOUNT`, `COURT_NOT_FOUND`, `INVALID_DURATION`, `CLOSED_DATE`, `OUTSIDE_HOURS`, `NO_RATE`,
`IDEMPOTENCY_CONFLICT`, `DAY_NOT_FOUND`.

**Details** (`AppRpcError.details`, `appRpc.ts:19`) read by the pure `matchErrorKey(error)` in
`matchLogic.ts`, which returns a `ws.matches.errors.*` key when it knows the detail and falls back to
`errorToMessageKey`:

| Code · detail | EN | AR |
| --- | --- | --- |
| `SEAT_MARK_LOCKED` · `day_closed` | The day of this game is closed, so its marks are final. | أُغلق يوم هذه المباراة، فأصبح التسجيل نهائيًا. |
| · `ticket_used` | The ticket that came back has already been used in another match. | استُخدمت التذكرة التي عادت في مباراة أخرى. |
| · `court_reused` | The court was booked again after this match closed. | حُجز الملعب مجددًا بعد إغلاق هذه المباراة. |
| · `replaced` | Someone has taken this seat since, so the no-show stays. | شغل أحدهم هذا المقعد بعد ذلك، فيبقى الغياب مسجّلًا. |
| · `paid` | This player has paid. Refund the payment at the till before marking a no-show. | دفع هذا اللاعب. يلزم ردّ المبلغ عند الصندوق قبل تسجيل الغياب. |
| · `match_ended` | This match has ended, so a mark can only be switched between arrived and no-show. | انتهت هذه المباراة، فلا يمكن إلا التبديل بين تسجيل الحضور وتسجيل الغياب. |
| `INVALID_TRANSITION` · `marked` | Undo the mark first. | يلزم التراجع عن التسجيل أولًا. |
| · `not_carrier` | This player no longer holds a seat in the match. | لم يعد لهذا اللاعب مقعد في المباراة. |
| · `use_attendance` | After the start, use Arrived or No-show. | بعد بدء المباراة، يُستخدم تسجيل الحضور أو الغياب. |
| · `not_short` | Nobody is missing, so the match can't be called off. | لا غائب في المباراة، فلا يمكن إلغاؤها لنقص لاعب. |
| · `nobody_came` | Nobody came. Mark everyone as no-show instead. | لم يحضر أحد. يُسجَّل غياب الجميع بدلًا من الإلغاء. |
| · `match_ended` | This match has ended. | انتهت هذه المباراة. |
| · `ended` | This player has already left the match. | غادر هذا اللاعب المباراة سابقًا. |
| `FORBIDDEN` · `manager_required` | After booking, only a manager removes a seat for a staff error or a duplicate. | بعد الحجز، لا يزيل مقعدًا بسبب خطأ من الموظف أو تكرار إلا المدير. |
| `PAYMENT_STATE` · `empty` | Nothing has been paid on this bill yet. Take the shares under Players instead. | لم يُدفع شيء على هذه الفاتورة بعد. تُستلم الحصص من قسم اللاعبين بدلًا من ذلك. |
| · `over_paid` | More was paid on this bill than the booking now owes. A manager refunds the difference at the till. | دُفع على هذه الفاتورة أكثر مما يستحقه الحجز الآن، ويردّ مدير الفرق عند الصندوق. |
| · `ticket` | Ticket purchases are refunded only by a cash-out. | لا تُسترد مشتريات التذاكر إلا بالاسترداد من ملف الزبون. |
| `INVALID_ARGUMENT` · `already_linked` | This payment is already assigned to that player. | هذه الدفعة موزّعة على هذا اللاعب مسبقًا. |
| `SLOT_TAKEN` · `match_waiting` | the §5.10 sentence: "This court is kept for the open match at {time}. …" | — |
| `TICKET_IN_USE` · JSON `{reason, count, until_at}` | the §5.15.1 sentence for `reason` (`in_use`, `reserved`, `restorable`), with `until_at` | — |
| `MATCH_TOO_LATE` · minutes | the §5.11 sentence with `now + minutes` | — |
| `INVALID_ARGUMENT` · a settings key | the field's own error | — |

## 5.21 i18n

**Catalogs** (`packages/i18n/src/catalogs/`):
- new lane pair `ws/matches.en.ts` + `ws/matches.ar.ts` (`DeepMessages<typeof matchesEn>`),
  registered in `ws/index.ts` (created in the build's scaffolding step). Groups, named so the
  assistant map's `LABEL_ROUTE_HINTS` (`build-assistant-map.mjs:545`) routes them: `common`
  (openMatch, category, join, visibility, status, endedReason, ticket, kind), `count` (plurals),
  `chip`, `calendar`, `today`, `create` (new-booking additions), `start`, `detail`, `events`,
  `players`, `seat` (lines, `…F` keys), `take`, `assign`, `writeOff`, `callOff`, `add`, `remove`,
  `customers` (record: counts, plays as, tickets, cash-out, ban), `settings`, `ops` (reports queue,
  reasons, online-refund additions), `dayClose`, `reports`, `errors` (detail keys), `offline`;
- new `opErrors.matches.en.ts` + `.ar.ts` (§5.20);
- small keys in existing lanes: `ws.kit.flags.match_ban` and `ws.kit.flags.matchBanReason.{conduct,
  no_shows, reported, other}` (`ws/kit.en.ts:70`); `ws.reports.courts.views.matches` and
  `.lead.matches` (`ws/reports.en.ts:147`); `ws.owner.panel.figures.<seven keys>` (`ws/owner.en.ts:28`);
  `op.reasons.conduct`, `court_needed`, `walked_out`, `no_shows`, `reported` (`en.ts:1167`, `ar.ts:1057`).

**Terms (DRAFT-AR, client review):** open match مباراة مفتوحة; ticket تذكرة; share الحصة; organiser
المنظّم / المنظّمة; walk-in زبون عابر (as today, `ws/courtDesk.ar.ts:40`); arrived تسجيل الحضور and
no-show تسجيل الغياب on buttons (the desk's house forms are تسجيل الوصول / تسجيل عدم الحضور for a
whole booking; seats use الحضور/الغياب so the two never read alike); written off مشطوب; cash out
استرداد; the venue النادي, the desk الاستقبال, the till الصندوق.

**Reason labels:** `conduct` "Conduct" / "سوء السلوك"; `court_needed` "Court needed" / "الملعب
مطلوب"; `walked_out` "Left without paying" / "مغادرة دون دفع"; `no_shows` "Repeated no-shows" / "تكرار
الغياب"; `reported` "Reported by players" / "بلاغات من لاعبين". Report reasons (`ws.matches.ops.reason`):
offensive name / اسم مسيء; abusive behaviour / سلوك مسيء; harassment / مضايقة; unsafe play / لعب غير
آمن; no-show / عدم حضور; other / أخرى.

**Common labels:** category Open / Women / Men → للجميع / للسيدات / للرجال; status filling "Needs
players" / "قيد الاكتمال", awaiting_court "Waiting for a court" / "بانتظار ملعب", booked "Booked" /
"محجوزة", played "Played" / "لُعبت", no_show "Nobody came" / "لم يحضر أحد", cancelled "Cancelled" /
"ملغاة", bumped "Cancelled by a booking" / "أُلغيت بسبب حجز", expired "Not filled" / "لم تكتمل".

**Plurals** (R38, G9b): `t()` has none; counted phrases go through `pluralForm(n, locale)` from
`packages/i18n/src/plural.ts` (the guest lane's CLDR helper, created in scaffolding) with keys
`ws.matches.count.<noun>.{zero,one,two,few,many,other}` (EN repeats `one`/`other`):

| Noun | AR one · two · few · many · other · zero |
| --- | --- |
| `players` | لاعب واحد · لاعبان · {count} لاعبين · {count} لاعبًا · {count} لاعب · لا لاعبين |
| `playersF` | لاعبة واحدة · لاعبتان · {count} لاعبات · {count} لاعبة · {count} لاعبة · لا لاعبات |
| `shares` | حصة واحدة · حصتان · {count} حصص · {count} حصة · {count} حصة · لا حصص |
| `tickets` | تذكرة واحدة · تذكرتان · {count} تذاكر · {count} تذكرة · {count} تذكرة · لا تذاكر |
| `seats` | مقعد واحد · مقعدان · {count} مقاعد · {count} مقعدًا · {count} مقعد · لا مقاعد |

Everything else uses the house label-and-figure form ("Players 3 of 4", "Requests 1").

**Arabic rules (R38):** Latin digits through `formatNumber`/`formatIQD`, and tests expect what the code
produces; buttons are verbal nouns (إلغاء، تسجيل، استلام، توزيع، شطب، إضافة), never imperatives such as
"ألغِ"; staff are addressed without gendered verbs (يلزم، يُرجى، يمكن + noun, passives); a player in
the third person follows the match category (`women` → feminine keys); `isolateLtr` on "+1", "3/4"
and counts; `isolate` on names. Every Arabic string of this lane is marked DRAFT-AR in a comment
block at the top of `ws/matches.ar.ts` and `opErrors.matches.ar.ts`.

## 5.22 Pure logic and tests

**Pure modules with node tests** (`*.test.ts`):

| Module | Functions |
| --- | --- |
| `op/features/matches/matchLogic.ts` | `MATCH_RESERVATION_NAME` (`'Open match'`, equal to the DB literal), `isMatchLiteral`, `bookingLabel`, `seatChipOf`, `seatLabelOf`, `seatLineOf`, `ticketChipOf`, `seatActionsOf(seat, match, reachable, caps)`, `owingPick(seats, ids)`, `groupOwingByHolder`, `needsPlayersRows`, `matchesBumpedBy`, `awaitingCourtOverlap`, `callOffState` (enabled / needs marks / not short), `callOffNames`, `inviteUrl`, `endedSentenceKey`, `eventKey`, `matchErrorKey`, `byCategory` |
| `op/features/matches/startMatchLogic.ts` | `startDraftErrors` (OM-43 mirror, organiser required, ask-to-join needs a linked customer, category against declared gender, ban), `startArgs` |
| `op/features/matches/assignLogic.ts` | pre-fill in seat order, per-seat and per-payment caps, "keep on the booking" eligibility |
| `op/features/admin/settings/matchSettingsLogic.ts` | draft, patch, field errors, server key → field |
| `op/features/ops/matchReportsLogic.ts` | row order, reason keys, ban visibility |
| `op/features/desk/customers/ticketsLogic.ts` | wallet rows, cash-out state and its sentence from `cashout.reason`/`until_at`, `TICKET_IN_USE` detail parse |
| `op/features/deposits/depositAttentionLogic.ts` (edit) | R23 `settle` only on `refund_failed`; ticket-row kind |
| `op/features/desk/payment/deskPaymentLogic.ts` (edit) | `matchBillSentence`, the new bill fields |
| `op/features/admin/dayCloseLogic.ts` (edit) | `onlineMoneyOf`, match unpaid rows |
| `op/features/reports/reportPayloads.ts` (edit) | `readCourts` matches block, `readMatchesReport` |
| `op/features/panel/figures.ts` (edit) | the `online` group |
| `op/lib/appRpc.ts` (edit) | `PGRST202` → `RPC_MISSING` |

Cases that must exist: `matchesBumpedBy` with two courts (one firm → warns; a hold on the other → no
warning; a pending booking is firm; touching ends; a court not selling the length); `seatLineOf` for
every row of §5.13.2, both categories, and an unknown status; `seatActionsOf` before and after the
start, offline, without each capability, and on `played` (no Undo); `callOffState` with an unmarked
carrier (needs marks), only an unreplaced `left_late` missing (short, R39), and a re-seated no-show;
`bookingLabel` with and without a state; `matchErrorKey` for every detail row; `ticketsLogic` for each
`cashout.reason`; `queueResults.test.ts` registry keys; `deskLogic.test.ts` (`REASON_CODES` untouched,
`MATCH_MARK_SEATS` an override refusal); `auth.test.ts` (the six capabilities, `writeOffSeat` includes
court_desk); `errors.test.ts` (both catalogs); `appRpc.test.ts` (`RPC_MISSING`); `figures.test.ts`.

**jsdom** (`*.test.tsx`): `op/features/matches/MatchPlayersPanel.test.tsx` (four rows; optimistic
Arrived and Undo; No-show disabled before the start; Undo absent on `played`; Take share opens the Cash
pane with due = `take_iqd`, also on a written-off row; Take several sums; `SEAT_OWED_CHANGED` refetches and keeps the pane;
`BOOKING_TAB_OPEN` opens Assign; write-off sends `p_pin` and `p_device_id`; call-off disabled with an
unmarked seat and naming who came; offline disables every control with the reason; AR render
`dir="rtl"` with Latin digits and feminine lines in a women's match), `AddSeatDialog.test.tsx`,
`StartMatchDialog.test.tsx`, `MatchDetail.test.tsx` (every banner, sandbox, not found),
`AssignPaymentDialog.test.tsx`, `op/features/desk/customers/TicketsPanel.test.tsx` (cash-out gating and
the three waiting sentences), `op/features/admin/settings/MatchSettingsPanel.test.tsx` (owner, manager,
`INVALID_ARGUMENT` on a field), `op/features/ops/MatchReportsPanel.test.tsx` (`hideWhenEmpty`, ban
hidden when banned); and the existing `desk/TodaysBoard.test.tsx` (group rows, off-with-matches line,
empty line, offline line, Players on a match booking), `desk/deskDialogs.test.tsx` (Open match kind,
bump warning, kept-court notice, no No-show on a match), `desk/payment/CourtBillPanel.test.tsx`
(match sentence, written-off row, no Add cafe bill), `admin/DayClose.test.tsx` (online card, match
unpaid row), `reports/CourtsReport.test.tsx` (Matches view, compare disabled),
`deposits/DepositPanels.test.tsx` (ticket row, no Settle on `refund_pending`),
`panel/ManagementPanel.test.tsx` (the online group).

## 5.23 e2e (`e2e/tests/operator-matches.spec.ts`, EN and AR projects, `e2e/playwright.config.ts:52-65`)

Setup (`beforeAll`): `ensureTillFresh`, `ensureOpenDay`, `enableMatches` on the fixture branch,
`cleanE2eMatches`. `afterAll` switches matches off again. Match times are tomorrow (OM-43 needs the
deadline plus an hour of lead, and CI's clock is unknown), so the journeys use the calendar strip and
the match screen, not the Today group. Desk names carry no digits (`sanitizeName` strips them,
`operator-journey.spec.ts:43-46`).

| # | Journey |
| --- | --- |
| 1 | court_desk: calendar › tomorrow, press a free slot, choose Open match, start one for a typed walk-in ("Playwright Match Alpha"), land on the match screen; add "Bravo", "Charlie", "Delta" from the open seats; the fourth toasts "Four in: booked on …"; the calendar block found by "Playwright Match Alpha" shows `4/4`; Open booking shows four Players rows and no No-show button. |
| 2 | A seeded booked match started 30 minutes ago (seat 1 a ticket-backed guest, seats 2–4 desk): court_desk marks 1–3 Arrived and 4 No-show; seat 1 reads "Ticket back", seat 4 "Didn't come · share written off"; Undo is offered on seat 2; Take share (cash) on seat 1, Take several on 2 and 3; the bill reads paid; the booking has no No-show button. |
| 3 | Call-off: a seeded started match (two guest seats, two desk seats). With one seat unmarked the button says "Mark every player first"; after marking three Arrived and one guest No-show, the confirmation names who came and who didn't; confirm → the booking reads cancelled; service check: the present guest's ticket is `available`, the no-show's `forfeited`. |
| 4 | Bump: a seeded filling match tomorrow at a time where Indoor Court 1 has a desk booking; the strip lists it; a new booking on Indoor Court 2 at that time shows the warning, then the "was cancelled" toast; the strip no longer lists it. |
| 5 | Owner edits the fill deadline and the ticket price (the "All branches" lead is visible); the manager sees them read-only. A seeded report: the manager bans from Ops; the record shows "Banned from open matches · Reported by players"; court_desk sees the badge and no Lift. The manager cashes out a guest's unused tickets and sees "Refund requested". |
| 6 | `@ar`: journeys 1 and 2 condensed in Arabic: the Arabic labels of §5.13, `dir="rtl"`, `4/4` in Latin digits. |

Helpers in `e2e/tests/helpers.ts` (service role unless said; fixture writes as `operator-journey.spec.ts:69-76`):
- `enableMatches(svc, { deadlineMinutes? })`: the owner client calls `set_match_settings`
  (`matches_enabled`, and the deadline when given);
- `seedMatchPlayers(svc, n, { gender })`: guest accounts `e2e-match-<letter>@dev.touch.local`
  through `svc.auth.admin.createUser` (reused on rerun), with phone, given and family names,
  accepted terms and gender set on the profile;
- `grantTickets(svc, guestId, count)`: `ticket_payment_prepare` → `deposit_mark_created` →
  `deposit_apply('SUCCESS')`, the `packages/db/tests/deposits.test.ts:71-103` sequence; no edge
  function and no CI change (`PAYMENTS_PROVIDER` stays unset in CI);
- `seedFillingMatch(opts)` and `seedBookedMatch(opts)` through the real guest (`match_start`,
  `match_join`) and desk (`desk_add_seat`) RPCs;
- `backdateBookedMatch(svc, matchId, minutesAgo)`: moves the booking's `start_at`/`end_at` (the
  reservation trigger copies the times to the match), since OM-43 forbids starting in the past;
- `seedMatchReport(reporterClient, matchId, seatId)` through `match_report`;
- `cleanE2eMatches(svc)`: cancels leftover e2e matches (filling: `desk_cancel_match` as the desk;
  booked: cancel the reservation, which cascades) found by the e2e names and accounts.

## 5.24 Assistant map, docs, HANDOFF

- `packages/db/scripts/build-assistant-map.mjs`: `FEATURE_ROUTE` (`:501`) gains `matches: '/desk'`;
  `CATALOG_FILE_ROUTE` (`:554`) gains `matches: '/desk'`. The panels that live on other pages sit in
  their host feature folders (§5.25), so `routeOfFile` routes their RPC callers correctly.
- `docs/design/assistant/pages.md`, each sentence extended with what the code does:
  - `/desk` (`:24`): "… The booking dialog's Open match kind opens the Start an open match dialog
    (app.desk_start_match); match bookings show the organiser's name and a seat chip (app.desk_match_states);
    a strip lists the night's filling open matches; booking a court warns when it would cancel an open
    match.";
  - `/desk/today` (`:25`): "… An 'Open matches needing players' group lists the night's open matches
    (app.desk_open_matches) with Add player (app.desk_add_seat), Open and Start an open match; on a
    match booking, Players replaces Mark arrived.";
  - `/desk/customers` (`:26`) and `/desk/customers/new` (`:27`): "… and in attach mode 'Attach to
    match' hands the customer back to the open match.";
  - `/ops` (`:41`): "… A 'Player reports' queue (app.match_reports_open) offers Close report and Ban
    (app.resolve_match_report); online refunds include ticket cash-outs.";
  - `/reports/courts` (`:55`): "… An Open matches view reads app.report_matches.";
  - `/admin/day-close` (`:59`): "… A 'Money outside the drawer' card (app.day_close_online) shows
    deposits and match tickets; unpaid open-match bookings list their owing seats.";
  - `/admin/settings` (`:114`): "… Venue details also holds the online deposit and open-match panels
    (app.set_match_settings; ticket price and the per-player limit apply to every branch).";
  - `/panel`: "… an Online money and open matches group.";
  - new line: "- /desk/matches/$id — One open match: its status, the invite link (Copy invite link),
    Cancel match (app.desk_cancel_match), the Players panel (app.mark_match_seats, Take share through
    app.match_seat_settle, Assign through app.match_link_payment, Write off with a manager PIN through
    app.match_seat_write_off, Remove through app.desk_remove_seat, Call off through
    app.desk_call_off_short) and the match history." (pages.md may add routes, `:685`).
- `docs/design/assistant/rules.md`, three new sections (each names its source):
  - "## A filling open match holds no court": it holds no reservation; a firm booking (every live row
    except a hold) of the last free court for its time cancels it and every ticket goes back; at four
    players the court is booked in the same transaction, or the match waits while a paying guest's
    hold is on the last court (open-matches contracts §0, R22).
  - "## Open-match tickets are a bond, not a prepayment": bought online at a chain-wide price, they
    are not court money; a player who comes gets the ticket back and pays a full share at the desk; a
    no-show or an unrefilled late leave loses it, and a lost ticket is revenue of that branch; unused
    tickets are owed to players (liability) and are cashed out only by a manager, for the whole
    purchase once nothing of it is in play (OM-45, OM-48, R13).
  - "## Open-match seats are marked and paid per player": a match booking is never marked no-show
    as a whole (MATCH_MARK_SEATS); unmarked seats count as arrived at completion or three hours after
    the end; a no-show's share is written off and `court_fee_remaining` nets it; a walk-out's share is
    written off only with a manager PIN; a match called off short cancels the booking and nobody pays
    (OM-47, R1, R12, R37).
  The existing "A discount, void, refund or price override needs a manager PIN and a reason" section
  adds "and a seat write-off".
- Tool catalog: the `report_courts` description mentions the `matches` block, in both byte-identical
  copies (`packages/core/src/assistant/tools.ts:431` and
  `packages/db/supabase/functions/_shared/assistant/tools.ts`), in the operator commit.
- Coverage keys (`packages/db/fixtures/assistant-coverage.json`) ship with each migration (R28, R30);
  this lane adds none (no new route).
- Regenerate with `pnpm --filter @touch/db assistant:map` in the operator commit (new `ws.matches`
  strings and the docs make the map stale): `packages/db/fixtures/assistant-map.json`,
  `packages/db/supabase/functions/_shared/assistant/map.json` (which also starts
  `functions-deploy.yml`), `packages/db/fixtures/assistant-map-compact.md`.
- `HANDOFF.md` scope ledger, one row for the milestone after "Till online-only ops" (`:2216`), D25:
  `| Open matches online-only (DF-11) | Every match write is a direct appRpc call, never a queued
  type: desk_start_match, desk_add_seat, desk_remove_seat, desk_cancel_match, mark_match_seats,
  desk_call_off_short, match_seat_settle, match_link_payment, match_seat_write_off, set_match_ban,
  staff_set_customer_gender, resolve_match_report, ticket_cashout, set_match_settings, and every guest
  match and ticket RPC. Offline, a match booking's bill takes money through the queued tab.open and
  tab.settle, and Assign links it to players once online (open-matches operator contract §5.5) |
  Queued seat marks and seat payments | Later phase |`.

## 5.25 Files touched

New, `apps/operator/src/`:
- `features/matches/`: `useMatches.ts` (`useOpenMatches`, `useMatchStates`, `useMatchDetail`,
  `useGuestTickets`, `useMatchReports`, `useMatchSettings`), `matchLogic.ts` (+ test),
  `startMatchLogic.ts` (+ test), `assignLogic.ts` (+ test), `SeatChip.tsx`, `OpenMatchesStrip.tsx`,
  `NeedsPlayersPanel.tsx`, `StartMatchDialog.tsx` (+ test), `MatchDetail.tsx` (+ test),
  `MatchPlayersPanel.tsx` (+ test), `AddSeatDialog.tsx` (+ test), `AssignPaymentDialog.tsx` (+ test),
  `CallOffDialog.tsx`;
- `features/desk/customers/`: `TicketsPanel.tsx` (+ test), `ticketsLogic.ts` (+ test),
  `GenderDialog.tsx`;
- `features/admin/settings/`: `MatchSettingsPanel.tsx` (+ test), `matchSettingsLogic.ts` (+ test);
- `features/ops/`: `MatchReportsPanel.tsx` (+ test), `matchReportsLogic.ts` (+ test);
- `features/admin/DayCloseOnline.tsx`;
- `lib/stationReach.tsx`.

Edited, `apps/operator/src/`:
- desk: `features/desk/DeskCalendar.tsx`, `TodaysBoard.tsx` (+ test), `BookingDetail.tsx`,
  `ReservationActionsDialog.tsx`, `CreateReservationDialog.tsx`, `deskDialogs.test.tsx`, `deskLogic.ts`
  (+ test), `useTradingNight.ts`;
- desk money: `features/desk/payment/CourtBillPanel.tsx` (+ test), `deskPaymentLogic.ts` (+ test);
- customers: `features/desk/customers/CustomerRecord.tsx`, `CustomerSearch.tsx`, `CustomerCreate.tsx`,
  `CustomerPicker.tsx` (`PickedCustomer.gender`), `features/desk/deskTypes.ts` (record fields);
- till: `features/till/PaymentPane.tsx` (`subtitle`, `allowPartial`), `features/till/NewTabDialog.tsx`
  (`guest_id`, drop match bookings);
- deposits: `features/deposits/DepositAttentionPanel.tsx`, `depositAttentionLogic.ts` (+ test),
  `depositApi.ts` (row fields, refund reasons), `DepositPanels.test.tsx`;
- other features: `features/admin/settings/VenueDetailsTab.tsx`, `features/ops/OperationsOverview.tsx`,
  `features/admin/DayClose.tsx` (+ test), `features/admin/dayCloseLogic.ts` (+ test),
  `features/reports/CourtsReport.tsx` (+ test), `features/reports/reportPayloads.ts` (+ test),
  `features/panel/figures.ts` (+ test), `features/panel/ManagementPanel.tsx` (+ test);
- components: `components/kit.tsx` (`CustomerFlagType` + `match_ban`, the ban-reason badge label,
  `ReasonCodePrompt` prop `noteMode?: 'other' | 'optional'`, default `'other'` = today's behaviour),
  `components/ui.tsx` (`MATCH_REASON_CODES = ['conduct', 'court_needed', 'walked_out', 'no_shows',
  'reported']`; `ReasonCode` becomes the union with `REASON_CODES`, which does not grow, because it is
  the default list of every prompt that passes none, `ManagerActions.tsx`), `components/icons.tsx`
  (`link`, `ticket`);
- lib: `lib/auth.tsx` (+ test), `lib/errors.ts` (`RPC_MISSING`; the match codes arrive with the
  migrations), `lib/appRpc.ts` (+ test), `lib/queryKeys.ts`, `lib/queueResults.ts` (+ test);
- routes: `routes/__root.tsx`, `routes/desk/_children.ts`.

Elsewhere:
- `packages/i18n/src/catalogs/ws/matches.en.ts`, `ws/matches.ar.ts` (new), `ws/index.ts`,
  `ws/kit.en.ts`, `ws/kit.ar.ts`, `ws/reports.en.ts`, `ws/reports.ar.ts`, `ws/owner.en.ts`,
  `ws/owner.ar.ts`, `en.ts`, `ar.ts` (`op.reasons`, `op.errors.RPC_MISSING`);
  `opErrors.matches.en.ts`, `opErrors.matches.ar.ts` (created by the DB step, R11);
- `e2e/tests/operator-matches.spec.ts` (new), `e2e/tests/helpers.ts`;
- `packages/db/scripts/build-assistant-map.mjs`, the three map files, `docs/design/assistant/pages.md`,
  `docs/design/assistant/rules.md`, both `tools.ts` copies, `HANDOFF.md`.

Written by other lanes, relied on here: `PIN_GATED_RPCS` + `match_seat_write_off` in all three
copies (`packages/core/src/schemas/mutations.ts:49`, `_shared/mutation-types.json` `pinGatedRpcs`,
`packages/db/tests/helpers.ts:162`), with the migration that creates the RPC (G13); the
`MAPPED_CODES` rows and `opErrors.matches.*` of §5.20 with the SQL that raises them (R11);
`packages/i18n/src/plural.ts` (scaffolding).

Not touched: `lib/workspaces.ts`, `lib/queries.ts` (the desk learns `matches_enabled` from
`desk_open_matches`, so a build never selects a column the server may not have yet),
`lib/venueScope.ts`, the six mutation-type copies, `apps/operator-shell`, `.github/workflows/ci.yml`.

## 5.26 Build order and release

1. After the DB steps have produced `types.gen.ts` with every §1.7 RPC, and the scaffolding step has
   mounted `ws/matches.*` and `plural.ts`.
2. Operator commits, each with its catalogs and tests green: (a) lib (`QK.deskMatches`,
   capabilities, `stationReach`, `RPC_MISSING`), `matchLogic` and the hooks; (b) match screen and
   Players panel, Take share, Assign, write-off, call-off; (c) calendar, Today board, new-booking
   dialog, Start dialog, booking detail and bill, till picker; (d) record, settings, Ops, online
   refunds, day close, reports, panel; (e) assistant docs, tool text, map regeneration, HANDOFF row;
   (f) e2e EN + AR.
3. Gates per `apps/operator/CLAUDE.md` "Tests": `pnpm --filter @touch/operator typecheck`, `lint`,
   `test`; root `pnpm typecheck`, `lint`, `test`, `security`; `pnpm e2e`.
4. The operator tag is released only after `match_desk_money` and `match_reports` are on hosted
   (`money.md` §12). A build that meets an older server shows no match UI (`RPC_MISSING`), so an early station
   update is harmless. `matches_enabled` stays off until the whole milestone is live.

## 5.27 Known limits

- Bump warnings exist only in the new-booking dialog. A move, a drag, a series, a block
  (`CourtBlock.tsx`) or a tournament's event blocks can bump a match with no warning; the strip and
  the Today group refresh on `slot_changed`.
- The grid does not mark the court an `awaiting_court` match is kept for; the desk learns it from the
  info line and the `SLOT_TAKEN` refusal (§5.10), for at most the hold's TTL.
- A cashier holds `takeSeatPayment` but no cashier screen shows seats (`/desk` excludes the cashier,
  `auth.tsx:226`); a cashier takes money on the booking-level bill and a desk user assigns it.
- A write-off has no separate undo (MD-11): only taking the share clears it.
- Typed walk-ins build no customer history.
- The English `'Open match'` literal still reaches screens that read `reservations.guest_name` directly
  without `bookingLabel` (the staff phone's lists, Telegram summaries, report drill rows); the
  operator's own screens translate it.
- No rail badge for open player reports.

## Additions to §1 (nothing in §1 is renamed; no §1 signature changes)

1. **Read contracts (R31):** `desk_open_matches` is the envelope of §5.6.1 (with `server_now` and
   `earliest_start_minutes`); `desk_match_states` is §5.6.2; `desk_match_detail` is §5.6.3, including
   `server_now`, `marks_open`, `reservation_status`, `carrying`, `holder_seat_id`, `companion_no`,
   `gender_source`, `replaced_by_seat_id`, `money.vacant[]` and `money.unassigned[]` (with `tab_live`);
   `customer_record.matches[]` rows carry `venue_id` and `category`.
2. **Reason argument form:** `desk_remove_seat`, `desk_cancel_match` and `set_match_ban` accept
   `p_reason` as `<code>` or `<code>: <note>` (note ≤ 200, audit only; the row, event and flag label
   keep the code). Signatures unchanged.
3. **`match_link_payment`** accepts `p_allocations = []` only to close a live court-only tab at what
   was paid ("Keep on the booking", C22). Signature unchanged.
4. **Cash-out waiting state (R13):** `guest_tickets.purchases[].cashout.reason` gains `reserved` and
   `restorable`, and `cashout.until_at` (timestamptz or null); `ticket_cashout`'s `TICKET_IN_USE`
   detail is Money's JSON text `{reason, count, until_at}` (`money.md` §5.8).
5. **Staff codes:** operator `MAPPED_CODES` gains `MATCH_BOOKING_NO_CAFE` (R20's code) and the
   renderer-minted `RPC_MISSING` (PostgREST `PGRST202`), beside §1.10's list and R11's three.
   Detail values the operator reads: `SEAT_MARK_LOCKED` `day_closed | ticket_used | court_reused |
   replaced | paid | match_ended`; `INVALID_TRANSITION` `marked | use_attendance | not_short |
   nobody_came | match_ended | ended | not_carrier`; `FORBIDDEN` `manager_required`;
   `PAYMENT_STATE` `ticket | over_paid | empty`; `INVALID_ARGUMENT` `already_linked`; `SLOT_TAKEN`
   `match_waiting`; `TICKET_IN_USE` JSON; `MATCH_TOO_LATE` minutes.
6. **Operator client names (§1.11):** `QK.deskMatches.{all, open, states, one, tickets, reports,
   settings}`; `lib/stationReach.tsx` (`StationReachProvider`, `useStationReach`);
   `MATCH_RESERVATION_NAME = 'Open match'` (must equal the DB literal); `MATCH_REASON_CODES`;
   `PaymentPane` props `subtitle`, `allowPartial`; `ReasonCodePrompt` prop `noteMode`; icons `link`,
   `ticket`; catalog groups of §5.21; `op.reasons.{conduct, court_needed, walked_out, no_shows,
   reported}`.
7. **Search params:** `/desk?kind=match`; `/desk/matches/$id?customer=`;
   `/desk/customers?attach=match&match=`; `/desk/customers/new?attach=match&match=`.
8. **Assistant:** `FEATURE_ROUTE.matches` and `CATALOG_FILE_ROUTE.matches` = `'/desk'`.
9. **CI:** none. The draft's `PAYMENTS_PROVIDER=fake` is dropped; e2e tickets come from the
   service-role purchase path.
10. **Fact for the DB merge:** §1.1 ordinals renumbered from `0253` (done; see the header).

## Resolved from the draft

| Draft item | Resolution |
| --- | --- |
| Conflict 1, open question 1 (write-off roles and PIN) | R1: court_desk, manager, owner; manager PIN grant; `p_pin`, `p_device_id`. |
| Conflict 2 (walk-in in a no-show's place) | R4, R21; §5.13.9. |
| Conflict 3 (`notify_staff`) | R5 (DB). |
| Open question 2 (DF-16 wall) | R20 server trigger; the desk and the till hide the entry points (§5.14). |
| Open question 3 (open booking tab) | Money refuses `BOOKING_TAB_OPEN` unless the live tab is empty; the pane sends the desk to Assign, which closes a live court-only tab (§5.13.5). |
| Open question 4 (matches off) | R10; §5.9, §5.16 copy. |
| Open question 5 (undo after reuse) | R9 `SEAT_MARK_LOCKED` `ticket_used`; R16 undo only while booked. |
| Open question 6 (unmarked at completion) | R9, R37; footer line §5.13.3. |
| Open question 7 (phone landing, rail badge) | Staff phone home; no badge in v1 (§5.17, §5.27). |
| Undo value | `in` (R9; D6). |
| Call-off rule | R12; button disabled until every carrier is marked (§5.13.10). |
| `desk_open_matches`, `desk_match_detail`, `desk_match_states` shapes | R31 picks, §5.6. |
| `guest_tickets`, `day_close_online`, reports, `booking_bill` shapes | Money's shapes (D5, D10, D22, D23); §5.6.4. |
| `match_reports_open` keys | DB's (`reports_90d`, `no_shows`, `banned`). |
| Ban note | R35 codes + optional note via the reason form (§5.13.8, §5.15.2). |
| Arabic digits | Latin (G9a); the jsdom case asserts Latin digits. |
| Counted phrases | `pluralForm` (G9b); §5.21. |
| "ألغِ", "تُخسر" | Verbal nouns; "وتُفقد تذكرة كل غائب" (§5.13.10). |
| "+1" in RTL | `isolateLtr` (§5.13.1). |
| Seat gender not on the row | Shown in gendered matches with its source (§5.13.1). |
| Desk start price | Preview from `price_slot`; the stamped price is announced if it differs (§5.11). |
| `TICKET_IN_USE`, `CUSTOMER_NOT_FOUND`, `MATCH_ALREADY_IN` | Mapped (R11). |
| Ticket figures nobody showed | Management panel `online` group (§5.19). |
| Chain-wide refund at every branch | "Any branch can settle this" tag (§5.17). |
| PGRST202 read as offline | `RPC_MISSING` (§5.5). |
| Panels under `features/matches/` routed to `/desk` by the map | Host feature folders (§5.25). |

## Owner questions (staff-facing, not blocking the build)

1. **Call-off when the only missing player left late.** Settled at the merge by R39 (db D-3): after
   the start an unrefilled late leaver counts as absent, so such a match is short and can be called
   off (§5.6.3, §5.13.10). Parsa may reverse it; until then it is built that way.
2. **A ban by any branch's manager applies at every branch.** Settled at the merge by R40: bans are
   chain-wide (`customer_flags` is chain-wide), and a manager at any branch may ban and lift. Parsa
   may reverse it; the ban copy already says "at every branch".

The owner questions already carried in §1.12 (headline revenue with written-off shares, Qi fees on a
cash-out, "settled another way" leaving no till movement, tax on seat money) are unchanged.
