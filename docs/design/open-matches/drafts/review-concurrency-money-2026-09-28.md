> **Adversarial review, 2026-09-28. Lens: concurrency, state machines, money, tickets.** Read-only
> review of the four unmerged lane drafts against `../build-contracts-2026-09-27.md` §0, §1 and §1.12,
> and against the code on `main` (latest migration 0248). Nothing was run against a database.
>
> Short names used below: `db:` = `drafts/db-2026-09-28.md`, `money:` = `drafts/money-2026-09-28.md`,
> `guest:` = `drafts/guest-2026-09-28.md`, `op:` = `drafts/operator-2026-09-28.md`, `contracts:` =
> `build-contracts-2026-09-27.md`, `gate:` = `packages/db/scripts/check-lock-order.mjs`. `NNNN:line`
> is a migration line in `packages/db/supabase/migrations/`.

# Review: concurrency, money and tickets

## Verdict

The core design holds up. These races come out right under the §1.4 order, and I checked each one
against the code:
- two players racing for the last seat or a refill;
- a double tap on Join;
- a bump racing the 4th join, and a confirm racing the 4th join (the `awaiting_court` path);
- two tills booking the last two courts;
- a cash-out racing a join;
- a ticket purchase success racing a join;
- a status-only writer (`cancel_reservation`, `mark_reservation`, `confirm_booking`) holding the
  booking row while an L2 body waits for it;
- the sweep's try-lock across branches.

No ticket can be locked into two seats. The partial unique indexes and `ticket_pick`'s `FOR UPDATE`
stop it.

The drafts are **not buildable as written**, for two reasons:
1. **C1.** The lock-order gate goes red on every L2 body and on `deposit_apply`. The gate expands
   `trg_reservation_match` under `expire_stale_holds`, whatever the trigger's `WHEN` says.
2. **C2.** An attendance undo on a `played` match leaves a ticket `in_use` for ever. The operator's
   Undo button reaches this in one click.

Eight more defects are major. Each one either loses money, double-refunds it, strands a ticket, or
breaks a DF/OM promise. Most of the fixes are a few lines in the contract.

## Defects

### C1. Blocker. `check:locks` fails on every L2 body and on `deposit_apply`

**Where.** db §2.8.1 `app.match_lock` (db:650-656), db §2.7 gate changes (db:622-633); money
§3.4.4 / §3.5.3 (`deposit_settle_success` re-issued in 0255, walked through `deposit_apply`).

**How the gate reads it.**
- The gate expands every trigger of a written table and ignores `WHEN` (gate:74-86, :157-161).
- `expire_stale_holds` holds `FOR UPDATE of r` and writes `reservations` in one statement
  (0242:1502-1516), so the gate expands `trg_reservation_match` under it. That emits
  `match_venue_advisory` and then `match_tickets` (`match_end` → `ticket_release`).
- `match_lock` runs `match_lock_courts` (lock the courts, then `expire_stale_holds`) and only then
  step 3, `perform 1 from reservations … for update`. The static sequence is therefore
  `court_advisory → reservations → match_venue_advisory → match_tickets → reservations`.
- Rule 1 (gate:231-239) flags `match_tickets` before `reservations`.

**Who fails.** `match_join`, `match_decide`, `desk_add_seat`, `mark_match_seats`,
`desk_call_off_short` and `match_seat_write_off` all go through `match_lock`.
`deposit_settle_success` has the same shape: an in-place `update reservations` (0242:541, which
expands the trigger), then, in the other branch, `expire_stale_holds` (0242:560, a `reservations`
FOR UPDATE). §1.4 asks the walker to cover `deposit_apply`, so that fails too. The "once per
sequence" rule for the mutex (db:626-628) does not help: the inversion is tickets before
reservations.

At runtime this is a false positive. It still turns CI red on the first push, which root
`CLAUDE.md` forbids.

**Fix.**
- `match_lock` order becomes: courts in id order, then the booking row FOR UPDATE, then
  `expire_stale_holds`, then `lock_match_venue`. This is the order `move_reservation` already uses
  (0150:73-79 lock, :128 expire).
- In Money's 0255 re-issue of `deposit_settle_success`, hoist
  `expire_stale_holds(r.court_id, period)` above the in-place update. It is a no-op for a hold
  whose payment is open (0242:1509-1513).
- Add a gate fixture test that prints the sequence for `match_join` and `deposit_apply`.

### C2. Blocker. An undo on a `played` (or partly `no_show`) match strands a ticket `in_use` for ever

**Where.** db §2.10.8 (db:1351 allows `booked`, `played`, `no_show`; table db:1360-1367); op §5.9
(op:275-276, "Undo while `match.marks_open`").

**Scenario.**
1. 22:30: the desk completes the booking, or the sweep auto-attends at end + 3 h. Every seat becomes
   `attended`, every ticket is released, and the match is `played` (db:1539-1541, :1611-1613).
2. 22:40: the desk presses Undo on Ali's row. `p_attendance = 'in'` runs
   `ticket_lock([T],[seat])`, so T goes back to `in_use`.
3. Nothing ever releases T again:
   - Part A runs only while the match is `booked` (db:1533-1534);
   - sweep step 8 runs only for `booked` (db:1611);
   - the booking is already `completed`.

`no_show → in` does the same through `ticket_restore(T, seat)`.

**Outcome.** Ali loses T silently. His whole purchase can never be cashed out (`TICKET_IN_USE`,
MD-4, money:36) and never refunded under DF-20. `guest_tickets` shows an "in a match" ticket for a
finished game.

**Fix.** In `mark_match_seats`:
- `in` (undo) is valid only while the match is `booked`;
- on `played`, allow only `attended ↔ no_show`;
- on an all-`no_show` match, the undo first returns the match to `booked` (as db:1374 already does).

The operator hides Undo-to-`in` unless `match.status = 'booked'`. Add an invariant test: "no ticket
is `in_use` on a seat of a terminal match".

### C3. Major. An attended-undo can take a ticket another request has reserved

**Where.** db §2.8.4 `ticket_lock` (db:771-778) moves "`available` **or `reserved`** → `in_use`" for
any seat and clears `request_id`. The undo calls `ticket_lock(array[ticket], array[seat])` (db:1365).
R9 (contracts:377) refuses only a ticket "locked elsewhere".

**Scenario.**
1. Sara's seat is marked `attended` and T is released.
2. Sara asks to join an approve-mode match at another branch. T becomes `reserved`
   (request R, 1 seat).
3. The desk undoes her `attended`. T moves to `in_use` on the old seat and `request_id` is cleared.
4. R is still `pending` with zero reserved tickets.
5. On approval, `ticket_pick(…, request_id)` returns "all of them", which is none. The seat insert
   fails `match_seats_kind` (ticket_id NULL) with a raw 23514. R is stuck until it expires, and
   Sara's organiser sees an unmapped error.

**Fix.**
- `ticket_lock` moves `reserved → in_use` only when `request_id = p_request_id`.
- Without `p_request_id` it accepts `available` only.
- `ticket_release`, `ticket_forfeit` and `ticket_restore` take `(ticket, seat|request)` and assert
  `seat_id` or `request_id` ownership before moving anything.

### C4. Major. A restore after the purchase was refunded leaves an unrefundable live ticket, and can stall DF-20 for everyone

**Where.** money MD-4 (money:36), §3.7.1-§3.7.4 (money:370-427); db §2.6.4 restore rows (db:588),
§2.10.5 (db:1299-1301).

**Scenario.**
1. Purchase X holds three tickets. T1 is forfeited at 21:10 (no-show). T2 and T3 are available.
2. 21:30: a manager cashes X out. That is allowed (nothing is `reserved` or `in_use`). T2 and T3
   become `cashed_out` and X goes to `refund_pending`.
3. 21:40: the desk corrects T1's seat to `attended`, so T1 is restored to `available`.
   Two other paths reach the same point: cancelling the booking restores no-show tickets (db:805),
   and a desk refill after start restores a forfeited late leaver's ticket.

**Outcome.**
- T1 is live on a refunded purchase. `deposit_begin_refund` needs `succeeded` (0242:182-184), so
  it can never be refunded.
- A second cash-out returns `duplicate:true` (money:380-381) and hides the problem.
- If the owner deletes their account, `ticket_refund_deleted` picks X ("≥ 1 available, none
  locked"), raises `PAYMENT_STATE`, logs a warning and retries every 30 s.
- It works in id order, at most 50 per call (money:414-417). Fifty such purchases starve every
  later DF-20 refund in the chain for good.
- Money invariant 13 (money:800-802) is broken.

**Fix.**
- Cash-out and `ticket_refund_deleted` also refuse, or skip, a purchase with a `forfeited` ticket
  that can still be restored: its match is `booked`, or its seat's business day is still open (the
  `SEAT_MARK_LOCKED day_closed` test).
- `ticket_refund_deleted` also skips purchases not in `succeeded`, so they never enter its queue.
- Amend invariant 13.

### C5. Major. Deleted and banned holders still count at the 4th seat, so the court is booked for a ghost

**Where.** db §2.11.4 (db:1507-1514: DF-20 is done by the sweep), §2.10.10 (bans are also done by
the sweep), `match_try_book` step 1 (db:733-735) counts every occupying seat.

**Scenario.**
1. Omar (seat 2 of a filling 3/4 match) deletes his account at 19:00:05.
2. At 19:00:12, before the next sweep, Lina joins. `match_try_book` books the court with Omar's
   seat.
3. The sweep then turns Omar's seat `left_late` (db:1608). At 21:00 his ticket is forfeited.

DF-20 (contracts:88) promised that a filling match is left and the ticket refunded. The three real
players are booked with a ghost and owe for an empty seat until someone refills it. A banned player
in the same window keeps a booked seat (db:1421, "booked seats are left to the desk"), which defeats
the ban.

**Fix.** Under L2 in `match_try_book`, before counting, apply sweep step 6 to this match: deleted
holders leave (`account_deleted`, tickets released) and banned holders are removed (`banned`). Book
only if 4 carriers remain. It is the same venue's mutex, so the lock order is unchanged.

### C6. Major. The seat-money writers are not serialised, so a seat can be over-linked and marks can race payments

**Where.** money §3.8.3 (money:549-552 claims the live-tab index serialises "two desks");
§3.8.4 (money:568-570, :575-576). contracts §1.4:226-227 says "read match rows without a lock".

**Scenario.**
1. Seat 2 owes 10,000. Desk A runs `match_link_payment(P1, [{seat2, 10000}])`, which locks P1's
   settled tab only.
2. At the same time desk B runs `match_seat_settle([seat2], cash, 10000)`, which opens a fresh tab.
3. The two share no lock. Both checks (`AMOUNT_OVER_SEAT` and the owed re-read) pass on the
   pre-commit state.
4. Seat 2 ends with 20,000 linked, breaking Money invariant 6 (money:782-783). The surplus quietly
   becomes `U` and credits seat 4 (MD-9).

Two links from two payments to one seat race the same way. A mark (L2) or a call-off racing a
settle is caught only after the fact.

**Fix.**
- Add a per-match advisory `app.lock_match_money(match_id)`, keyed `'app.matches:money:'||id`.
- Rank it in gate `ORDER` between `day_sessions` and `tabs`.
- Take it first in `match_seat_settle` (after the day lock), `match_link_payment`,
  `match_seat_write_off`, `mark_match_seats`, `desk_call_off_short`, `desk_remove_seat` and
  `desk_add_seat`, then read owed and links after it. This is legal: nothing takes it after `tabs`
  or after `court_advisory`.
- Do not use the venue mutex for this. `settle_tab` re-locks `tabs` (0244:357), so the gate would
  read `match_venue_advisory → tabs`.

### C7. Major. DF-16 is not enforced on the server (MD-10), so a café tab on a match booking bills the café guest for the players' shares and blocks every seat payment

**Where.** money MD-10 (money:42), §3.8.7 (money:615-618); op open question 2 (op:759-763).

**Scenario.** A cashier's `NewTabDialog`, or a merge, puts a café order on the match booking. Two
paths get there:
- `open_tab(p_reservation_id)` accepts any live booking (0244:70-190);
- `merge_tabs` explicitly allows a merge *into* a booking tab (0244:1055-1060) and moves the orders
  (:1079).

**Outcome.**
- The tab's court line is `court_fee_remaining`, which is every owing share (0211:246). A 3,000 IQD
  coffee comes out as a 33,000 IQD bill.
- The live tab blocks `match_seat_settle` (`BOOKING_TAB_OPEN`) and `match_link_payment`
  (`tab_has_orders`) for all four players.
- `close_day` then refuses `DAY_OPEN_TABS` (0216:158-162) until someone pays that inflated bill.

**Fix.** Put a server wall in the shape of `trg_order_items_shop_guard` (0244:1093-1127). A
`BEFORE INSERT OR UPDATE OF tab_id ON orders` trigger (and the same on `tab_adjustments`) refuses
`MATCH_BOOKING_NO_CAFE` when `exists (select 1 from matches where reservation_id =
tab.reservation_id)`. That is one probe of `matches_reservation_key`. No hot RPC is re-issued, and
the empty court-only tab of the offline path stays allowed.

### C8. Major. R4 (a walk-in in a no-show's place) is not implemented by DB and breaks three things once it is

**Where.** db:210 (the unique index still covers `no_show`); refill logic db:959-963 and
db:1299-1301 ("the latest *ended* seat", "open seat numbers"); call-off `not_short` db:1392-1393;
op Conflicts 2 (op:734-743); contracts R4:372.

**What breaks.**
1. Under DB's rules a `no_show` number is never "open". The operator's "Add walk-in in Omar's
   place" always answers `MATCH_FULL`.
2. Once it is implemented, undoing the replaced no-show (`no_show → attended` or `in`) makes two
   `in`/`attended` rows on one `seat_no`. The result is a raw 23505 or, if the index is dropped, an
   attended seat that owes nothing: Money's carrier rule (money:452-454) skips a replaced seat.
3. `desk_call_off_short` treats a replaced `no_show` as "short" and lets the desk call off a match
   with four people present.

**Fix.**
- One definition, shared with Money's carrier rule: a `seat_no` is *open* when it has no carrier.
  After start, a `no_show` with no replacement counts as open for the desk only.
- Refuse an undo of a replaced no-show with `SEAT_MARK_LOCKED` detail `replaced`.
- "Short" means at least one `seat_no` whose carrier is `no_show` or unrefilled `left_late`.

### C9. Major. `awaiting_court` can be starved by fresh holds, so DF-18's "booked when the hold lapses" is not guaranteed

**Where.** db §2.12.1 `WHEN (new.kind in ('booking','maintenance'))` (db:1523); db §2.15 #4
(db:1763).

**Scenario.**
1. H1 lapses. `tp_hold_sweep`, or any writer's `expire_stale_holds`, expires it. Hold writes never
   fire the trigger.
2. Within the ≤ 30 s before `match_sweep` runs, a guest's `hold_slot` (0225:175-178) takes H2 on
   that court. `hold_slot` knows nothing of awaiting matches, and the grid shows the court as free.
3. H2 confirms, which bumps a match that had four players and was waiting for exactly that court.
   This can repeat until start.

Separately, a `kind='booking', status='pending'` row counts as "non-firm" (db:749-750). It never
lapses, so the match waits until `start_at` and then expires as `no_court`.

**Fix.**
- `hold_slot` and `staff_create_reservation` refuse `SLOT_TAKEN` when the new row would take the
  last non-live court of an overlapping `awaiting_court` match. Check under their court lock; a
  plain read is enough because the sweep is the backstop. The guest grid hides that court.
- Firm means every live row except `kind='hold'`.

### C10. Major. "Settled another way" on a ticket purchase in `refund_pending` can refund twice

**Where.** money §3.4.4 `deposit_refund_manual` row (money:182) accepts `refund_pending` for
tickets. The 0242 body does the same for deposits (0242:1241).

**Scenario.**
1. A cash-out sets `refund_pending`.
2. The reconciler has already claimed the row and sent Qi the refund with `refund_request_id`
   (0242:780-798).
3. A manager presses "Settled another way" and hands over cash. The row becomes `refunded`.
4. Qi completes the card refund. `deposit_refund_apply` sees `status <> 'refund_pending'` and
   records nothing (0242:876-878).

The guest is paid twice, and nothing in the system shows the second payment.

**Fix.** Ticket rows accept `refund_failed` only. That is Qi's refusal, or ten unanswered attempts
(0242:914-915). Deposits should get the same restriction; flag it as a follow-up on 0242.

### C11. Minor. Call-off auto-attends unmarked seats, so an absent player keeps their ticket

**Where.** db §2.10.9 write 3 (db:1401); OM-47 (contracts:62) says "the no-show loses their ticket
either way".

**Scenario.** Two players are missing. The desk marked one as `no_show` and left the other
unmarked, then pressed call-off. The unmarked absent player becomes `attended`, their ticket is
released, and their no-show is never counted (DF-12).

**Fix.** Refuse with `MATCH_MARK_SEATS` while any carrier is unmarked. The operator already expects
this (op:101, :327).

### C12. Minor. Hold expiry takes row locks court by court, which can deadlock with `tp_hold_sweep`

**Where.** db `match_lock_courts` (db:646-648) calls `expire_stale_holds(court)` once per court,
and the sweep's first venue does the same over a wide range (db:1585-1586). `tp_hold_sweep`
(0021:306) locks every stale hold of the chain in global id order (0242:1502-1516).

**Scenario.** Stale holds 50 and 90 sit on court 1 and stale hold 10 on court 2. L2 locks 50, 90,
then 10. The cron locks 10, then 50. That is a 40P01, and the victim may be a guest's join. 0042's
"they queue instead of deadlocking" holds only for single-court callers, and every L2 body is now a
multi-court caller.

**Fix.** Expire all of the branch's courts for the period in one id-ordered statement:
`… where r.court_id = any(v_courts) … order by r.id for update of r`.

### C13. Minor. A double tap on start can answer `MATCH_SLOT_FULL` or `NEED_TICKETS` instead of `duplicate`

**Where.** db §2.9.2 checks the key at step 2 (db:888-890), before `[lock]` at step 15 (db:910).
`desk_start_match` works the same way.

**Scenario.** Tap 2 waits on the court locks while tap 1 commits. Tap 2 then counts tap 1's match
in OM-42 and fails its own `ticket_pick`. The phone shows an error for a match that exists.

**Fix.** Re-check `idempotency_key` right after `lock_match_venue`.

### C14. Minor. Part B loops over matches it found before taking the mutex

**Where.** db:1553-1558.

**Scenario.** `confirm_booking` and `deposit_settle_success` hold no court lock, or only one. A
`match_start` can therefore commit between Part B's unlocked pre-check and its mutex. The new match
is not bumped until the next sweep, and its organiser sees it filling for up to 30 s.

**Fix.** Re-select the candidates inside the post-mutex statement.

### C15. Minor. Cash-out's ticket locks can deadlock, and one player may hold overlapping seats

**Where.** money:379 locks *all* tickets of the purchase, whatever their status. Ticket locks inside
one body come in batches (the join's own pick, then the bump's release in the trigger), not in one
global id order.

**Scenario.** A player holds seats in two overlapping matches at one branch; nothing refuses this.
The join of match 1 bumps match 2, which releases that player's ticket T1. A cash-out of the same
purchase holds T1 and waits on T2, which the join already picked. That is a 40P01.

Separately, overlapping seats guarantee one forfeited ticket.

**Fix.**
- Cash-out checks `TICKET_IN_USE` with an unlocked read, then locks only the `available` rows (as
  db:590-592 says).
- Refuse a second occupying seat per `guest_id` whose period overlaps, at start, join and approve
  (reuse `MATCH_ALREADY_IN`, or add `MATCH_TIME_CLASH`). Desk seats are exempt.

### C16. Minor. Money writes accept a missing idempotency key

**Where.** `match_seat_settle` and `match_link_payment` both declare `p_idempotency_key default null`
(contracts:287-288).

**Scenario.** A retry after a lost response takes a second payment (settle) or links twice, up to
the caps (link).

**Fix.** Refuse `INVALID_ARGUMENT` when the key is null, as the operator always sends one
(op:22-24).

### C17. Minor. The order of writes in the all-no-show path, and its undo, is underspecified

**Where.** db:1369-1376.

**Problems.**
- "Written before any ticket work" can be read as "update the booking before `match_end`". Part A
  would then raise `MATCH_MARK_SEATS` on the legitimate path (db:1538).
- The undo must also null `cancelled_at` and `cancellation_reason`, which 0089:84-90 stamps on
  `no_show`.

**Fix.** Spell out the order: seats, then `match_end`, then the booking, then tickets.

### C18. Minor. `attended → no_show` on a seat that has already paid

**Where.** db:1364.

**Scenario.** The ticket is forfeited and the payment stays linked. The player pays and loses the
ticket, and no refund prompt appears because the booking is still live.

**Fix.** Refuse with `SEAT_MARK_LOCKED` detail `paid` while the seat has links, or require a till
refund first.

### C19. Minor. The SEC-20 gate goes red on a new `booking_payments` column

**Where.** `booking_payments.ticket_count` (money:76) is not declared in `GUEST_DATA`
(`packages/db/tests/stored-fields.test.ts:158-169`).

**What breaks.** "matches the live column set of every declared table exactly" (:276) fails.

**Fix.** Add `ticket_count: n`. Neither DB §2.14 nor Money §3.14 lists it.

### C20. Minor. Sandbox leaks

- `desk_add_seat` and `desk_match_detail` do not refuse a sandbox match; only the lists filter it.
- `deposit_attention` shows sandbox ticket refunds at every branch (money:180).
- Flipping `profiles.payment_sandbox` strands that profile's tickets: they are unusable, and
  cash-out goes to the wrong Qi environment.

**Fix.** Refuse sandbox matches in the desk writes, filter sandbox rows out of the attention list,
and block the flip while the profile holds live tickets.

### C21. Minor. The sweep's try-lock can hold part of a branch for the whole run

**Where.** db:1587-1589.

**Scenario.** The try-lock succeeds on courts 1-2 and fails on court 3. It cannot release courts
1-2 (xact advisory locks), so they stay held until the sweep commits, blocking bookings at a branch
it is skipping.

**Fix.** Try the mutex key first, then the courts in id order. Also keep the sweep short: the 200
match cap applies across all venues.

### C22. Minor. Seat-money details

- `match_seat_write_off` answers `MATCH_NOT_BOOKED` on `played`. After the auto-attend it must
  allow `played`, as `match_seat_settle` does (money:526).
- DF-4: a price-rise `delta_owed` can only be collected by leaving a live normal tab. Closing that
  tab needs `match_link_payment` with at least one seat allocation (money:560). Allow
  `p_allocations = []` to close a court-only tab as a booking-level payment.

## Disagreements between drafts, and with §1

| # | Point | Positions | Pick |
| --- | --- | --- | --- |
| D1 | Who leaves matches on account deletion | Money: `delete_my_account` leaves the filling matches, then refunds, and takes court → reservations → mutex (money:420, :761). DB: no match lock; the sweep does it (db:1507-1514). | **DB.** Money's version takes courts and mutexes at several branches in one transaction, which is the cross-branch cycle DB Conflicts 6 describes. `delete_my_account` may still call `ticket_refund_deleted(v_uid)` (tickets → purchase row only). Add the C5 fix. Correct money:761. |
| D2 | Refund helper names | DB `ticket_refund_purchase(p_payment_id, p_reason)` (db:1637-1642) vs Money `tickets_cash_out` + `ticket_refund_deleted` | **Money** (R8 names them). |
| D3 | `match_tickets` / `match_ticket_events` DDL written twice | db:283-330 vs money:108-141: the forfeit CHECK is ⇔ plus seat vs ⇒; `cashed_out` needs `cashout_payment_id` only in Money; unique `(seat_id)` only in DB; `code` column only in DB; `sandbox` default | **DB's DDL**, plus Money's `match_tickets_cashed_out` (with `cashout_payment_id`), Money's `(forfeited_venue_id, forfeited_at)` and `(type, at)` indexes, and `sandbox not null` with no default. |
| D4 | Write-off locking | DB: `written_off_*` written outside the mutex (db:611-613). Money: under `match_lock` (money:589). | **Money**, plus the C6 money key. |
| D5 | Write-off roles | Money §3.8.5 and op:446 say manager/owner | **R1**: court_desk, manager, owner with a manager PIN grant. |
| D6 | Undo value | DB `unmarked` (db:1344) vs op `in` (op:100) | **`in`** (R9). |
| D7 | Call-off preconditions | DB auto-attends unmarked seats and counts `left_late` as short (db:1392-1401). Op: every seat marked, at least one `no_show`, `MATCH_MARK_SEATS` otherwise (op:101, :327). | **Op's rule**, with "short" as defined in C8. |
| D8 | Unique occupying `(match_id, seat_no)` | DB includes `no_show` (db:210) | **R4** (`in`, `attended`), with the C8 fixes. |
| D9 | `guest_tickets` owner and shape | DB 0259 `refundable` (db:1451-1460); Money 0256 via `ticket_wallet`, with `cashout{allowed, reason, tickets, amount_iqd}` (money:339-343); op reads `unused, cashable, refund_status` (op:57) | **Money** owns it; op adapts. |
| D10 | `day_close_online` shape | Money: `deposits`, `tickets_here`, `tickets_chain`, `matches` (money:668-679). Op: `tickets`, `unused_tickets`, `refunds_waiting` (op:60). | **Money**; op adapts. |
| D11 | Unassigned desk money | Money `booking_bill.match.unassigned_iqd`. Op: `unassigned_desk_iqd` (op:64) and `desk_match_detail.money.unassigned[]`, a list of payments (op:83-84, needed because court_desk cannot read `payments`). No draft produces the list. | **Money's names.** DB adds `money.unassigned[]` to `desk_match_detail`, fed from `match_money`. |
| D12 | `desk_open_matches` shape | DB: an array (db:1201-1206). Op: an object with `matches_enabled`, `fill_deadline_minutes`, `ticket_price_iqd` (op:55). | **Op's object** (court_desk cannot call `match_settings`). |
| D13 | `me.refusal = NEED_TICKETS` | DB yes (db:1148-1150); Guest never (guest:111) | **Guest**: tickets travel through `tickets_available` / `tickets_needed`. |
| D14 | `my_tickets` shape | Money (money:324-333) vs Guest (guest:122-130: top-level `sandbox`, `purchase_payment_id`, `match.status`) | **Money's**, plus Guest's three fields. |
| D15 | `deposit_status.deposit_mode` for a ticket | Money `null`; Guest `'off'` (guest:151) | **`null`**; Guest's parser falls back as it already does. |
| D16 | DF-16 wall | Money MD-10: UI only. Op: asks for a server refusal (op:759-763). | **Server wall** (C7). |
| D17 | Cash-out locks | db:590-592: cash-out takes only `available` rows. money:379: all tickets of the purchase. | **DB's wording**, with an unlocked `TICKET_IN_USE` pre-check (C15). |

## Top 12 fixes, ranked

1. **C2.** Undo to `in` only while the match is `booked`. The operator hides Undo on played matches.
   Add the invariant "no `in_use` ticket on a terminal match".
2. **C1.** `match_lock`: courts → booking row → expire → mutex. Hoist the expiry in
   `deposit_settle_success`. Add a gate fixture test.
3. **C4.** Cash-out and DF-20 wait while any forfeited ticket of the purchase can still be restored.
   `ticket_refund_deleted` skips non-`succeeded` purchases so the 50-per-call queue cannot jam.
4. **C10.** "Settled another way" accepts only `refund_failed` for tickets (and, later, for
   deposits).
5. **C5.** `match_try_book` drops deleted and banned holders before counting to four.
6. **C3.** `ticket_lock` moves `reserved` only for its own request. The ticket helpers assert
   seat or request ownership.
7. **C6.** A per-match money advisory lock, ranked between `day_sessions` and `tabs`, taken by every
   writer that changes what a seat owes.
8. **C7.** A DF-16 server wall as an `orders` / `tab_adjustments` trigger in the shop-guard shape.
9. **C8.** R4 end to end: open seat = no carrier; refuse the undo of a replaced no-show;
   carrier-based "short".
10. **C9.** Awaiting matches keep their court: `hold_slot` and staff creates refuse the last
    non-live court; firm = every live row except holds.
11. **C11 / D7.** Call-off refuses while any carrier is unmarked.
12. **C12 + C13.** A single-statement branch-wide hold expiry; re-check the start idempotency key
    under the mutex.
