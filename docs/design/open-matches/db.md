# Open matches: database core (lane DB)

Date: 2026-09-28. Status: **final, binding for the DB lane; nothing built.** Merged from
`drafts/db-2026-09-28.md` and the two reviews (`drafts/review-concurrency-money-2026-09-28.md`,
`drafts/review-decisions-rules-2026-09-28.md`), with every ruling of §1.12 applied. It replaces the
DB draft for building. It does not repeat §0 (decisions) or §1 (names) of
`build-contracts-2026-09-27.md`; it refers to them. Where this file and §1 disagree, §1.12 wins, and
§9 of this file lists every change this file asks §1 to take.

Code facts were checked on `43625f39` (latest migration 0251). `NNNN:line` is a line in
`packages/db/supabase/migrations/2026…NNNN_*.sql`; other paths are from the repo root.

**Before this file is committed**, `packages/db/fixtures/assistant-coverage.json` needs a `docs`
entry for `docs/design/open-matches/db.md` in the same commit (the gate walks the filesystem;
G8b). Suggested: `"excluded: engineering build contract for the open-matches database; not venue
knowledge the owner asks about"`.

## 1. Ground rules

`§0` and `§1.x` always mean `build-contracts-2026-09-27.md`. This file's own sections are §2–§11 and
the three unnumbered ground rules below.

### Ordinals

0249–0251 were taken on 2026-09-28 by `43625f39` (staff page scopes, batch yield, floor orders).
None of them touches a function or table this build re-issues (checked: they define
`add_marketing_request`, `release_notes_for_me`, `protocol_engine_involved`, `production_today`,
`set_batch_yield`, `floor_*`, `place_floor_order`). Every §1.1 ordinal moves up by three. The drafts
and the reviews use the old numbers; this file uses the new ones.

| New | Old (drafts, reviews, §1.12 text) | File | Owner |
| --- | --- | --- | --- |
| 0253 | 0249 | `customer_flags_match_ban` | DB |
| 0254 | 0250 | `booking_payments_ticket_checks` | Money |
| 0255 | 0251 | `outbox_match_kinds` | Guest |
| 0256 | 0253 | `profile_names_gender` | Guest (DB fixes the contract, §4.2) |
| 0257 | 0254 | `match_settings` | DB |
| 0258 | 0255 | `match_tables` | DB (tables incl. the tickets DDL) + Money |
| 0259 | 0256 | `ticket_purchase` | Money |
| 0260 | 0257 | `match_core` | DB (Money's internals are in 0259 and 0262, Guest's in 0261) |
| 0261 | 0258 | `match_guest_rpcs` | DB + Guest (`match_notify`, `match_sync_reminders`, the push fan-out) |
| 0262 | 0259 | `match_desk_money` | DB + Money |
| 0263 | 0260 | `match_reservation_triggers` | DB |
| 0264 | 0261 | `match_account_deletion` | DB |
| 0265 | 0262 | `match_reports` | Money + Ops |

Check the directory again before writing each file (`packages/db/CLAUDE.md`, Migrations). If more
ordinals are taken by then, shift again, keep this order, and use the real ordinal in every
`$<name>_0NNN$` tag.

The `tests/rls-matrix.ts` rows of this build go in **drop 24**: drop 23 is taken by 0250/0251
(`tests/rls-matrix.ts:4271-4297`).

### Every file

- Opens with `set lock_timeout = '3s'; set statement_timeout = '60s';`.
- Functions use `$<name>_0NNN$` tags and are re-issued only from their latest body (the table in
  §9.4 names each one).
- A CHECK or FK added to an **existing** table is `NOT VALID`, then validated inside a `do` block
  guarded on `conname` **and** `conrelid` (the 0241:185-199 shape). CHECKs on a new table are
  written inline in its `create table`, which `check-migrations` treats as free.
- `create index` on the new tables trips `index-not-concurrent`. The waiver goes in the **commit
  message** as `MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables`, and
  `MIGRATION_RISK_ACCEPTED=… node scripts/check-migrations.mjs` is run locally before the push. CI
  reads the waiver only from a PR body (`.github/workflows/ci.yml:144`), and this repo pushes to
  `main` (R34).
- The commit carries `src/types.gen.ts`, both catalogs, and every gate artifact the migration needs
  (R28). §4 lists them per migration under "Gates in this commit".
- Every writing body asserts `set_config('app.venue_id', <the match's branch>, true)` before its
  first write, so `zz_branch_guard` (0230:90) passes a staff caller.
- Online only (DF-11). Nothing here is a queued mutation type.

### What the code forces

- **One live row per court.** `reservations_no_overlap` covers `status in
  ('pending','confirmed','arrived')` (0008:42-45). The match booking is `kind='booking'`, `guest_id`
  NULL, `guest_name 'Open match'`, `source` `'desk'` or `'mobile'` (`reservation_source`, 0002:8).
  `reservation_kind` is `booking|hold|maintenance` (0002:6).
- **A NULL `guest_id` keeps the booking off every guest path**: guest RLS, `cancel_reservation`,
  `my_reservations` and the booking push (0090:143-145) all key on it. Players reach the match only
  through §4.6.
- **Firm** means a live row that is not a hold: `kind in ('booking','maintenance') and status in
  ('pending','confirmed','arrived')` (R22). A hold is live but not firm.
- **The court lock** is `pg_advisory_xact_lock(hashtextextended('app.reservations:court:'||id, 0))`
  (0042:50-58).
- **Hold expiry** is `expire_stale_holds(p_court_id default null, p_period default null)`
  (0242:1495): one `update … where id in (select … order by r.id for update of r)`. With a NULL
  court it reaches every branch.
- **The branch guard refuses a staff writer on another branch's row** unless `app.venue_id` names
  that row's branch (0230:149-166). So a staff body at branch A that expires branch B's holds fails
  with `VENUE_MISMATCH`. Hold expiry inside a match body must be branch-scoped (§2.2).
- **The branch guard's parent lookup** falls back to `select venue_id from public.<parent>`
  (0230:79). A chain-wide parent (`match_tickets`, `match_blocks`, `profiles`, `staff`) is never a
  link pair.
- **Event blocks insert firm rows on several courts with no `lock_court`** (0174:735-755). So any
  lock the reservation trigger waits for can close a cycle with a body that holds every court. The
  bump half of the trigger therefore never waits (§2.3).
- **The lock gate** (`packages/db/scripts/check-lock-order.mjs`) expands every trigger of a written
  table and ignores `WHEN` and `UPDATE OF` (`sequence()`, :149-161). Inserts and updates are not
  locks; only `FOR UPDATE` and `app.lock_court(` are (`events()`, :111-146). Only definer functions granted to
  `anon`/`authenticated` are walked (:166-172). A static replay of the gate over today's migrations
  with the new trigger injected found exactly one new inversion: `deposit_apply`, through
  `deposit_settle_success`'s in-place update (0242:541) textually before its hold expiry (0242:560).
- **`customer_flags`** is chain-wide, PK `(customer_id, type)` (0065:86-93). `set_customer_flags`
  deletes every flag and re-inserts its list (0242:1789) and court_desk may call it.
- **`delete_my_account`** (0077:120) keeps a tombstone profile (:187-192), deletes the guest's flags
  (:226) and refuses staff.
- **`mark_reservation`** (0089:42) allows `no_show` only from `confirmed` after start, and stamps
  `cancelled_at` on `no_show` and `completed` (0089:82-89). It is a status-only writer, exempt from
  the gate's rule 3 (`STATUS_ONLY_RESERVATION_WRITERS`, gate :215).
- **The assistant's `table_read`** is owner-only and reads the whole table (0109,
  `assistant_table_read`), so a `table_read` table exposes every row to the owner, never to staff.

## 2. Locks

### 2.1 The order (the gate's `ORDER`)

```text
day_sessions → match_money_advisory → tabs → orders → order_items → tickets → payments
  → till_shifts → refunds → stock_batches → court_advisory → reservations
  → match_venue_advisory → match_tickets
```

| Key | Taken by | Form |
| --- | --- | --- |
| `match_money_advisory` | `app.lock_match_money(match_id)` | advisory lock on key `'app.matches:money:'` + match id (R19) |
| `court_advisory` | `app.lock_court(court)` (0042) | as today |
| `match_venue_advisory` | `app.lock_match_venue(venue)` | advisory lock on key `'app.matches:venue:'` + branch id |
| `match_tickets` | `select … for update` | always in `id` order within one statement |

Both advisory keys are hashed as 0042 does: `pg_advisory_xact_lock(hashtextextended(<key text>, 0))`.

`matches`, `match_seats` and `match_requests` are never locked `FOR UPDATE`; the branch mutex
serialises every change to them. Two column groups are written outside it on purpose, because no
state reads them: the identity scrub of `delete_my_account` (§4.9) and Money's `written_off_*`
columns (written under the money lock and `match_lock`, R19/D4).

### 2.2 Lock primitives (0260)

| Function | What it takes |
| --- | --- |
| `lock_match_venue(p_venue)` | the branch mutex (blocking) |
| `lock_match_money(p_match_id)` | the match's money lock (blocking) |
| `try_lock_match_venue(p_venue, p_courts default false) → boolean` | `pg_try_advisory_xact_lock` on the mutex key; when `p_courts`, then on every active court key of the branch in `id` order. All or nothing: the attempts run in a subtransaction that the first busy key aborts, which releases every key it took, so false holds nothing; true keeps every key until commit. Never waits. |
| `match_lock_courts(p_venue)` | `app.lock_court` on every active court of the branch, `id` order, one statement |
| `match_expire_holds(p_venue, p_period) → int` | the 0242 `expire_stale_holds` statement with `and r.venue_id = p_venue` added: one statement, `id` order, this branch only |
| `match_lock(p_match_id) → matches` | courts → the booking row `FOR UPDATE` → hold expiry → mutex (R15) |

`match_lock`, step by step:

1. Unlocked read of `venue_id`, `period`. None → `MATCH_NOT_FOUND`.
2. `set_config('app.venue_id', venue, true)`.
3. `match_lock_courts(venue)`.
4. Re-read `reservation_id`. It is stable from here: only a body holding every court of the branch
   attaches one (`match_try_book`). If set, `perform 1 from reservations where id = … for update`.
5. `match_expire_holds(venue, period)`.
6. `lock_match_venue(venue)`.
7. Return a fresh `select * from matches where id = p_match_id`.

`match_expire_holds` is a twin of `expire_stale_holds` because the chain-wide form trips the branch
guard ("What the code forces"). A test pins the twin: for one branch and period, both expire the same rows. Whoever
re-issues `expire_stale_holds` later re-issues the twin in the same file.

### 2.3 Levels

| Level | Sequence | Used by |
| --- | --- | --- |
| **LS** (start) | `match_lock_courts(v)` → `match_expire_holds(v, period)` → `lock_match_venue(v)` | `match_start`, `desk_start_match` |
| **L1** | `lock_match_venue(v)` | `match_request`, `match_withdraw`, `match_decide` (decline), `match_leave`, `match_remove_player`, `match_cancel`, `desk_cancel_match` |
| **L1+M** | `lock_match_money(m)` → `lock_match_venue(v)` | `desk_remove_seat` |
| **L2** | `match_lock(m)` | `match_join`, `match_decide` (approve) |
| **L2+M** | `lock_match_money(m)` → `match_lock(m)` | `desk_add_seat`, `mark_match_seats`, `desk_call_off_short`; Money's `match_seat_write_off` (after its PIN grant) |
| **Trigger A** | `lock_match_venue(v)` (blocking) | cascade from the match's own booking row (§4.8.1) |
| **Trigger B** | `try_lock_match_venue(v)`; on false, defer to the sweep | bump (§4.8.1) |
| **Sweep** | first branch: `match_lock_courts` → `match_expire_holds` → `lock_match_venue`; later branches: `try_lock_match_venue(v, true)`, skip on false, no hold expiry | `match_sweep` |

Only LS, L2 and L2+M bodies, and the sweep's first branch, write `reservations` (the booking insert
of `match_try_book`, and the booking status writes of `mark_match_seats` and
`desk_call_off_short`). Hold expiry always runs before the mutex.

### 2.4 Ticket locks

- A ticket that is `reserved`, `in_use` or `forfeited` is moved only by a body holding the mutex of
  the branch whose match holds it (its request's, its seat's, or its `forfeited_seat_id`'s).
- An `available` ticket is locked only in **one id-ordered statement per body**: `ticket_pick`,
  the attendance corrections of `mark_match_seats` (which lock every available ticket they will
  touch first, in one statement), Money's cash-out (after an unlocked `TICKET_IN_USE` pre-check,
  D17/C15), or `skip locked` by Money's DF-20 refunds.
- `select … where status = 'available' for update` skips a row whose committed status is not
  available without waiting, so a pick never waits on a ticket another body is releasing.
- Every helper asserts that the ticket belongs to the seat or request it moves (R17, §4.5.4).

### 2.5 Lock sequence of every mutating function

The static sequence the gate prints, after the rules of §2.6. `[…]` is a trigger expansion; a
repeated key is dropped; `booking_payments` is unranked (not printed) and is shown only for
clarity.

| Function | Sequence |
| --- | --- |
| `match_start` | `court_advisory → reservations (stale holds) [→ match_venue_advisory → match_tickets] → match_tickets (pick)` |
| `match_join`, `match_decide` (approve) | `court_advisory → reservations (booking row) → reservations (stale holds) [→ match_venue_advisory → match_tickets] → match_tickets (pick) [→ booking insert: match_tickets]` |
| `match_request`, `match_withdraw`, `match_decide` (decline), `match_leave`, `match_remove_player`, `match_cancel` | `match_venue_advisory → match_tickets` |
| `match_post_message`, `match_report`, `match_block`, `match_unblock`, `set_my_gender` | nothing ranked |
| `set_match_settings`, `set_match_ban`, `staff_set_customer_gender`, `resolve_match_report`, `set_customer_flags` | nothing ranked |
| `desk_start_match` | `court_advisory → reservations (stale holds) [→ match_venue_advisory → match_tickets]` (no ticket of its own) |
| `desk_add_seat` | `match_money_advisory → court_advisory → reservations → reservations [→ match_venue_advisory → match_tickets] → match_tickets (a replaced late leaver's ticket)` |
| `desk_remove_seat` | `match_money_advisory → match_venue_advisory → match_tickets` |
| `desk_cancel_match` | `match_venue_advisory → match_tickets` |
| `mark_match_seats`, `desk_call_off_short` | `match_money_advisory → court_advisory → reservations → reservations [→ match_venue_advisory → match_tickets] → match_tickets [→ booking status write: match_tickets]` |
| `mark_reservation` (re-issued) | `reservations (the row) [→ match_venue_advisory → match_tickets]` (status-only writer) |
| `hold_slot`, `staff_create_reservation` (re-issued) | `court_advisory → reservations (expire, that court) [→ match_venue_advisory → match_tickets]` |
| `delete_my_account` (re-issued) | `[reservations scrub → match_venue_advisory → match_tickets] → match_tickets (skip locked, Money) → booking_payments (unranked)`. At runtime the reservations trigger does not fire (its `UPDATE OF` list is not touched). |
| `trg_reservation_match` | A: `match_venue_advisory → match_tickets`; B: `match_tickets` (the try-lock is not emitted) |
| `match_sweep` (service role, walked) | `court_advisory → reservations (stale holds) [→ …] → match_venue_advisory → match_tickets → booking_payments` |
| `deposit_apply` (walked) | `court_advisory → reservations → booking_payments → reservations (stale holds, hoisted by Money) [→ match_venue_advisory → match_tickets] …` |
| Money: `match_seat_settle` (run-time order; the sequences the walker prints for Money's rows are `money.md` §8's) | `day_sessions → match_money_advisory → tabs → payments → till_shifts` |
| Money: `match_link_payment` | `[day_sessions] → match_money_advisory → tabs → payments` |
| Money: `match_seat_write_off` | PIN grant → `match_money_advisory → court_advisory → reservations → reservations → match_venue_advisory` |
| Money: `ticket_cashout`, `tickets_cash_out`, `ticket_refund_deleted`, `ticket_settle_success` | `match_tickets → booking_payments` |

### 2.6 Gate changes (`scripts/check-lock-order.mjs`, in the 0260 commit)

1. `ORDER` (:37-49): insert `'match_money_advisory'` after `'day_sessions'`; append
   `'match_venue_advisory', 'match_tickets'` after `'reservations'`.
2. In `events()` (:111-146): emit `{lock:'match_venue_advisory'}` for `/\bapp\.lock_match_venue\s*\(/gi`
   and `{lock:'match_money_advisory'}` for `/\bapp\.lock_match_money\s*\(/gi`, beside the
   `lock_court` rule, and skip both names in the call list (as :139 does for `lock_court`).
   `pg_try_advisory_xact_lock` is not emitted, which is right: it never waits.
3. **Once per sequence**: after `sequence()` and before compaction (:228), drop every later
   occurrence of `match_venue_advisory` and of `match_money_advisory` in the same sequence. A
   blocking body only ever holds one branch's mutex and one match's money lock, so a repeat is a
   re-grant. Without this, the trigger expanded under any L2 body reads as
   `match_tickets → match_venue_advisory`.
4. **Service-role walk**: append `SERVICE_WALK = ['match_sweep','deposit_apply',
   'ticket_settle_success','ticket_refund_deleted','tickets_cash_out']` to `callable` (:166)
   (contracts §1.4 + R8). Names not yet created are skipped by `byName.has`.
5. `TBL` gains `match_tickets`; the alias regex is anchored after `from|join|update\s+`, so
   `from match_tickets` never matches the KDS `tickets` (G1.5).
6. `packages/db/CLAUDE.md`, RPCs section: the order line becomes the one in §2.1.

The fixture test (R15) is `packages/db/tests/lock-order-matches.test.ts` (stack-gated). It runs the
gate and asserts the printed sequences of `match_join` (lands with 0261) and `deposit_apply` (lands
with 0263, when the trigger exists) equal §2.5.

### 2.7 Why this cannot deadlock

1. **Status-only writers** of a match booking (`cancel_reservation`, `mark_reservation`) hold the
   row and then wait on the mutex (trigger A). L2 bodies lock their booking row before the mutex; L1
   bodies never lock a reservation row; the sweep never locks a booking row. Nothing that holds the
   mutex waits for such a row. `confirm_booking` reaches only trigger B, which never waits.
2. **Trigger B never waits** on the mutex, so writers that skip `lock_court` (event blocks, the
   deposit re-create) cannot close a cycle with an L2 body that holds every court.
3. **Tickets** follow §2.4.
4. **The sweep** waits only on its first branch, before it holds any ticket. Later branches are
   try-locked, and it expires no holds there.
5. **Hold expiry** is one statement per branch in `id` order, the order `tp_hold_sweep` uses, so the
   C12 cycle (court-by-court expiry against the global sweep) is gone.

## 3. State machines

The writer named in each row is the only one for that transition.

### 3.1 Match

| From | To (reason) | When | Writer |
| --- | --- | --- | --- |
| — | `filling` | start with 1–3 seats | `match_start`, `desk_start_match` |
| `filling` | `booked` | 4 carriers after ineligible holders are dropped (R18), and a court offering the length has no live row (a sandbox match books no court) | `match_try_book` (from `match_join`, `match_decide`, `desk_add_seat`, `match_sweep`) |
| `filling` | `awaiting_court` | 4 carriers; every such court has a live row; at least one has only holds (DF-18) | `match_try_book` |
| `filling` | `bumped` (`bumped`) | a firm row leaves no firm-free court; or 4 carriers and none firm-free | trigger B, `match_sweep`, `match_try_book` |
| `filling` | `bumped` (`no_court`) | no active court offers the length any more | `match_sweep` |
| `filling` | `expired` (`deadline`) | `now() ≥ fill_deadline_at` | `match_sweep` |
| `filling` | `cancelled` (`organiser_cancelled`, `staff_cancelled`, `empty`, `venue_closed`) | organiser; desk; nobody left; branch closed or `assert_bookable` fails | `match_cancel`, `desk_cancel_match`, `match_recompute_organiser`, `match_sweep` / `match_try_book` |
| `awaiting_court` | `booked` | the blocking hold lapsed or was released | `match_sweep` → `match_try_book`; also `match_try_book` of another match at the branch (§4.5.3) |
| `awaiting_court` | `bumped` (`bumped`) | the hold confirmed (R22) | trigger B; `match_sweep` backstop |
| `awaiting_court` | `filling` | a carrier left or was removed, or an ineligible holder was dropped (`match_try_book`, or the sweep's step 2) | `match_leave`, `match_remove_player`, `desk_remove_seat`, `match_try_book`, `match_sweep` |
| `awaiting_court` | `expired` (`no_court`) | `now() ≥ start_at` while still waiting | `match_sweep` |
| `awaiting_court` | `cancelled` | organiser, desk, branch closed | as for `filling` |
| `booked` | `played` | booking marked `completed` (trigger A); or `end_at + 3 h` (sandbox: `end_at`) with at least one carrier attended after auto-attend (R37) | trigger A, `match_sweep` |
| `booked` | `no_show` (`all_no_show`) | no carrier is `in` or `attended`, at least one is `no_show` | `mark_match_seats`; `match_sweep` at `end_at + 3 h` when no carrier can be attended |
| `no_show` | `booked` | a `no_show` corrected to `attended` while marks are open | `mark_match_seats` |
| `booked` | `cancelled` (`reservation_cancelled`) | the booking is cancelled | trigger A |
| `booked` | `cancelled` (`called_off_short`) | OM-47, R12 | `desk_call_off_short` |

Terminal: `played`, `no_show` (reversible only as above), `cancelled`, `bumped`, `expired`.
Invariant (R16): no ticket is `in_use` or `reserved` for a seat or request of a terminal match.

### 3.2 Carriers and open numbers (R4, R21)

One definition, shared with Money (`app.match_carriers`, §4.5.3):

- The **carrier** of a `seat_no` is its seat with status `in`, `attended`, `no_show` or `left_late`
  that is not named in `replaces_seat_id` by another seat whose status is one of those four. A
  number with no carrier is **vacant**.
- A number is **open for a guest** (join, approval) when it is vacant or its carrier is `left_late`,
  and `now() < start_at`.
- A number is **open for the desk** (`desk_add_seat`) when it is vacant, or its carrier is
  `left_late`, or (after `start_at`) its carrier is `no_show`, and `now() < end_at`.
- The unique index `(match_id, seat_no) where status in ('in','attended')` is the backstop.
- A match is **short** (R12) when at least one carrier is `no_show`, or is `left_late` after
  `start_at`.

### 3.3 Seat

| From | To (end_reason) | When | Ticket | Writer |
| --- | --- | --- | --- | --- |
| — | `in` | start, join, approval, desk add | locked (desk: none) | `match_start`, `match_join`, `match_decide`, `desk_start_match`, `desk_add_seat` |
| `in` | `left` (`left`, `account_deleted`) | leave, or deletion, while filling or awaiting | released | `match_leave`, `match_drop_ineligible` |
| `in` | `removed` (`removed_by_organiser`) | OM-44, filling or awaiting | released | `match_remove_player` |
| `in` | `removed` (`removed_by_staff`) | desk, filling or awaiting (any reason); booked only `staff_error`/`duplicate` | released | `desk_remove_seat` |
| `in` | `removed` (`banned`) | ban, filling or awaiting | released | `match_drop_ineligible` |
| `in` | `cancelled` (`match_ended`) | the match ends unplayed, or its booking is cancelled | released | `match_end` |
| `in` | `left_late` (`left`, `removed_by_staff`, `account_deleted`) | leave, desk removal (`customer_request`, `conduct`, `other`), or deletion, on a booked match before start | stays `in_use` | `match_leave`, `desk_remove_seat`, `match_sweep` |
| `left_late` | `refilled` (`refilled`) | another seat takes its number | released, or restored to `available` if already forfeited | `match_join`, `match_decide`, `desk_add_seat` |
| `left_late` | (stays) | start passes with no refill | forfeited (a deleted holder's: released, R18) | `match_sweep`, `match_end` |
| `left_late` | `cancelled` (`match_ended`) | the booking is cancelled | released, or restored if forfeited | `match_end` |
| `in` | `attended` | desk mark; booking completed; `end_at + 3 h` | released | `mark_match_seats`, `match_end` |
| `in` | `no_show` | desk mark at or after start | forfeited (deleted holder: released) | `mark_match_seats` |
| `attended` | `no_show` | correction, no payment linked to the seat | its own ticket forfeited if still `available` | `mark_match_seats` |
| `attended` | `in` | undo, match `booked` only (R16) | locked again if still `available` | `mark_match_seats` |
| `no_show` | `attended` | correction, number not re-seated | restored to `available` | `mark_match_seats` |
| `no_show` | `in` | undo, match `booked` only, number not re-seated | restored to `in_use` | `mark_match_seats` |
| `attended`, `no_show` | `cancelled` (`match_ended`) | the booking is cancelled after marks | no-show tickets restored | `match_end` |

A `no_show` replaced by a desk walk-in (R4) keeps its status, its forfeit and its DF-12 count.

### 3.4 Request

| From | To | When | Tickets | Writer |
| --- | --- | --- | --- | --- |
| — | `pending` | ask to join (approve mode) | reserved | `match_request` |
| `pending` | `approved` | organiser approves | reserved → `in_use` on the new seats | `match_decide` |
| `pending` | `declined` | organiser declines | released | `match_decide` |
| `pending` | `withdrawn` | requester withdraws or leaves; account deleted | released | `match_withdraw`, `match_leave`, `match_drop_ineligible` |
| `pending` | `expired` | deadline (filling) or start (booked) passed (code `closed`); match reached 4 carriers (`match_full`) or ended (its `ended_reason`); organiser gone (`organiser_gone`); requester banned (`banned`) | released | `match_sweep`, `match_try_book`, `match_end`, `match_recompute_organiser`, `match_drop_ineligible` |

### 3.5 Ticket

| From | To | When | Helper | Event |
| --- | --- | --- | --- | --- |
| — | `available` | purchase succeeded | Money `ticket_settle_success` | `bought` |
| `available` | `reserved` | request | `ticket_lock` (request only) | `reserved` |
| `reserved` | `in_use` | approval, **its own request only** (R17) | `ticket_lock` (seats + request) | `locked` |
| `reserved` | `available` | decline, withdraw, expiry | `ticket_release` (request) | `released` |
| `available` | `in_use` | start, join; undo of `attended` | `ticket_lock` (seats) | `locked` |
| `in_use` | `available` | leave or removal while filling; unplayed end; attended; refill of a late leaver; venue cancel; a deleted holder at start (R18) | `ticket_release` (seats) | `released` |
| `in_use` | `forfeited` | no-show; unrefilled late leave at start | `ticket_forfeit` | `forfeited` |
| `available` | `forfeited` | `attended → no_show` correction | `ticket_forfeit` | `forfeited` |
| `forfeited` | `available` / `in_use` | undo of a no-show; venue cancel after marks; desk refill of a forfeited late leaver | `ticket_restore` | `restored` |
| `available` | `cashed_out` | manager cash-out; DF-20 | Money `tickets_cash_out` | `cashed_out` |

A ticket owned by a deleted profile is never forfeited: `ticket_forfeit` releases it instead
(R18), and Money's DF-20 refund picks it up.

## 4. Migrations

Each section ends with **Gates in this commit** (R28): the artifacts that land in the same commit
as the SQL. "Matrix" is `packages/db/tests/rls-matrix.ts` (drop 24); "allowlist" is
`fixtures/rpc-allowlist.json` plus `fixtures/rpc-coverage-floor.json` raised with
`--update-floor`; "coverage" is `fixtures/assistant-coverage.json`; "SEC-20" is
`tests/stored-fields.test.ts`; "codes" are the client maps and their catalog keys, EN and AR.

### 4.1 0253 `customer_flags_match_ban` (DB)

```sql
set lock_timeout = '3s'; set statement_timeout = '60s';
alter table customer_flags drop constraint if exists customer_flags_type_check;
alter table customer_flags add constraint customer_flags_type_check
  check (type in ('vip','birthday','payment_note','special_request','deposit_exempt','match_ban')) not valid;
-- then the guarded VALIDATE of 0241:185-199 (conname and conrelid = 'public.customer_flags'::regclass)
```

A `match_ban` row's `label` holds the ban reason code (`conduct`, `no_shows`, `reported`, `other`,
R35). Only `set_match_ban` writes it (§4.7.10); `set_customer_flags` carries it over (§4.7.13).

| Gate | In this commit |
| --- | --- |
| Matrix, allowlist, coverage | none (no new object) |
| SEC-20 | none: `customer_flags` is already declared (`type`, `label`) |
| Codes | none |
| Lock gate | none |
| Other | `check-migrations` locally; `types.gen.ts` unchanged |

### 4.2 0256 `profile_names_gender` (Guest writes; the contract DB relies on)

Guest owns the file. These rules are binding because every match read depends on them (D1: DB's
rules, Guest writes the file; drop Guest's gender rule).

**Columns** on `profiles` (plain `add column if not exists`, nullable, no default): `given_name
text`, `family_name text`, `gender text`, `gender_set_at timestamptz`, `gender_set_by text`.

**CHECKs** (named, NOT VALID, guarded VALIDATE):

| Name | Rule |
| --- | --- |
| `profiles_given_name_len` | `given_name is null or char_length(given_name) between 1 and 39` |
| `profiles_family_name_len` | `family_name is null or char_length(family_name) between 1 and 39` |
| `profiles_name_parts` | `given_name is not null or family_name is null` |
| `profiles_gender_values` | `gender is null or gender in ('female','male')` |
| `profiles_gender_stamp` | `gender`, `gender_set_at` and `gender_set_by` are all null or all set; `gender_set_by in ('guest','staff')` |

**`app.split_person_name(p text) returns text[]`** (immutable, internal; `{given, family}`):

1. Tokens = `regexp_split_to_array(btrim(p), '\s+')`. Empty or NULL gives `{NULL,NULL}`.
2. `n = 1`. If token 1, lowercased with `أ/إ/آ → ا`, is one of `عبد, ابو, abd, abdul, abdel, abdal,
   abu, abou` and a second token exists, `n = 2`. If then token 2 is `al`, `el` or `ال` and a third
   exists, `n = 3` ("Abd al Rahman").
3. `given = left(tokens 1..n joined by ' ', 39)`, rtrimmed; `family = nullif(left(the rest, 39),
   '')`, rtrimmed.

**Trigger `profiles_sync_names`** (`app.trg_profile_names()`, definer): BEFORE INSERT OR UPDATE OF
`full_name, given_name, family_name, deleted_at`, sorting after `profiles_sanitise`. First matching
rule:

1. `deleted_at is not null` → the five new columns become NULL (the tombstone is clean from 0256).
2. `current_setting('app.skip_name_sync', true) = 'on'` → nothing (backfill only).
3. `''` parts become NULL.
4. INSERT without `given_name` → parts := `split_person_name(full_name)`.
5. INSERT with `given_name`, or UPDATE where a part changed → `full_name := concat_ws(' ', given,
   family)`.
6. UPDATE where only `full_name` changed → parts re-split.

No gender rule: only `set_my_gender` and `staff_set_customer_gender` write gender, and they stamp all
three columns.

`trg_sanitise_profile` is re-issued from 0080:130 with `app.safe_line` on both parts; the trigger
becomes `before insert or update of full_name, phone, given_name, family_name`. `handle_new_user`
is re-issued from 0069:204 with the two metadata parts, clamped to 39. The backfill runs under
`set_config('app.skip_name_sync','on', true)` for `deleted_at is null and given_name is null and
full_name <> ''`, taking the metadata parts when they rebuild `full_name` exactly, else the split.

**Grants.** `grant select (given_name, family_name, gender, gender_set_at, gender_set_by) on
profiles to authenticated`; `grant update (given_name, family_name) on profiles to authenticated`.
No update grant on gender.

**`app.set_my_gender(p_gender text) → jsonb`** (authenticated). Refusals in order: `AUTH_REQUIRED`,
`ACCOUNT_REQUIRED` (no profile, or deleted), `INVALID_ARGUMENT` (not `female`/`male`),
`GENDER_ALREADY_SET` (a different value is stored). The same value again returns
`{gender, gender_set_at, duplicate:true}`; a first set writes the three columns (`gender_set_by
'guest'`), audits `profile.gender_set` and returns `{gender, gender_set_at, duplicate:false}` (D36).

What DB reads from 0256: `given_name`, `family_name`, `gender`, `deleted_at`, and
`split_person_name` for typed desk names.

| Gate | In the Guest commit |
| --- | --- |
| Matrix | `set_my_gender`: `ex('execute', {anon:'denied', guest_anon_session:'guarded'})`, args `{p_gender:'x'}` |
| Allowlist | `guarded` + floor |
| Coverage | `set_my_gender` `map:action`; `split_person_name`, `trg_profile_names` `excluded: service_role only — …` |
| SEC-20 | `Category` gains `'Other personal info'` (once, here); `profiles`: `given_name` Name scrub, `family_name` Name scrub, `gender` Other personal info scrub, `gender_set_at`/`gender_set_by` `n`; the deletion proof sets `profiles.gender` |
| SEC-28/29 | one edit to both `FORBIDDEN` lists with all nine patterns (D31): `/given_name/i`, `/family_name/i`, `/\bgender\b/i`, `/share_token/i`, `/organiser_id/i`, `/reporter_id/i`, `/reported_id/i`, `/blocker_id/i`, `/blocked_id/i` |
| Codes | mobile `GENDER_ALREADY_SET` |
| Lock gate | none (profile rows only) |

### 4.3 0257 `match_settings` (DB)

**Columns** (one named CHECK per table, NOT VALID + guarded VALIDATE):

| Table | Column | Default | Bounds |
| --- | --- | --- | --- |
| `venue_settings` | `matches_enabled boolean not null` | `false` | — |
| `venue_settings` | `match_fill_deadline_minutes int not null` | `120` | 60..2880 (`venue_settings_match_rules`) |
| `platform_settings` | `match_ticket_price_iqd bigint not null` | `10000` | 1,000..1,000,000, multiple of 250 (`platform_settings_match_rules`) |
| `platform_settings` | `max_filling_matches_per_guest int not null` | `3` | 1..10 |
| `platform_settings` | `match_terms_version text` | NULL | NULL or the 0153 terms format |

`venue_settings_public` is re-created from 0208:88-107 with `matches_enabled,
match_fill_deadline_minutes` appended at the end (a `create or replace view` can only append).
`match_terms_version` is set by migration only, after a build carrying the new
`CURRENT_TERMS_VERSION` is on phones; it is not in the settings patch.

**`app.match_terms_ok(p_version text) returns boolean`** (stable, internal): false when
`p_version` is NULL; true when `platform_settings.match_terms_version` is NULL; otherwise true when
`p_version` is at least `match_terms_version`, each read as the pair `(split_part(v,'.',1),
coalesce(nullif(split_part(v,'.',2),''),'0')::int)` (a plain text comparison ranks `.10` below
`.9`). `match_eligibility` (§4.5.2) calls it; Money's `ticket_payment_prepare` may call it in
place of its inline copy (`money.md` pins the two with a test).

**`app.accept_terms(p_version)`** re-issued from 0153:70 (its only body; review 2026-09-29): a
version that orders below the one on record, compared as `match_terms_ok` compares, changes nothing
and answers the stored version and time (the stamp never moves onto text the guest did not accept).
Once `match_terms_version` is set, an older build on a second device could otherwise roll the guest
below it, and every match RPC and ticket purchase would refuse `TERMS_REQUIRED`. The same or a newer
version records as before. Same signature and grant. The client half (ask only when the stored
version orders below `CURRENT_TERMS_VERSION`, `packages/core/src/legal/terms.ts` and mobile's
consent check) is not in this file.

**`app.match_settings(p_venue_id uuid default null) → jsonb`** (manager, owner). R33 order:
`FORBIDDEN` unless `app.is_staff('manager','owner')`; then `v := coalesce(p_venue_id,
app.current_venue())`; `FORBIDDEN` unless `is_staff_at(v,'manager','owner')` (the
`deposit_settings` shape, 0242:986-997).

```json
{ "venue_id": "…", "matches_enabled": false, "match_fill_deadline_minutes": 120,
  "earliest_start_minutes": 180, "match_ticket_price_iqd": 10000,
  "max_filling_matches_per_guest": 3, "match_terms_version": null }
```

**`app.set_match_settings(p_patch jsonb, p_venue_id uuid default null) → jsonb`** (owner; the same
guard order with `'owner'`). The whole patch is validated before anything is written; every refusal
is `INVALID_ARGUMENT` with the detail named:

| Case | Detail |
| --- | --- |
| NULL, not an object, or `{}` | `p_patch` |
| a key outside the four below | that key |
| `matches_enabled` not a JSON boolean | `matches_enabled` |
| `match_fill_deadline_minutes` not an integer in 60..2880 (`app.venue_patch_int`, 0104:111) | `match_fill_deadline_minutes` |
| `match_ticket_price_iqd` not an integer in 1000..1000000 or not a multiple of 250 | `match_ticket_price_iqd` |
| `max_filling_matches_per_guest` not an integer in 1..10 | `max_filling_matches_per_guest` |

The first two keys update the branch's `venue_settings` row; the last two update `platform_settings
where id` (the 0248:206-212 form). It asserts `app.venue_id`, audits `venue.match_settings` with
before and after, and returns `match_settings(v)`.

Effects (R10): switching `matches_enabled` off refuses guest starts, joins, requests and approvals
and desk starts (`MATCHES_OFF`); matches already filling or booked carry on (the desk may still add
seats; leave, withdraw, decline and cancel work; the sweep ends them as usual). A new deadline
applies to matches started after it; a new ticket price to purchases after it (DF-21).

| Gate | In this commit |
| --- | --- |
| Matrix | `match_settings` `MANAGER_UP`, args `{p_venue_id: VENUE_A}`; `set_match_settings` `OWNER_ONLY`, args `{p_patch: {}}` |
| Allowlist | both `guarded` + floor |
| Coverage | both `map:action`; `match_terms_ok` `excluded: service_role only — …`; `app.assistant_readable_columns` rows for the five columns and the two view columns (the 0207:103-109 insert, `on conflict do nothing`) |
| SEC-20 | none (no guest link) |
| Codes | none new (`FORBIDDEN`, `INVALID_ARGUMENT` are mapped) |
| Lock gate | none |

### 4.4 0258 `match_tables` (DB, with Money's part in the same file)

Rules for every table: RLS on; `revoke all … from anon, authenticated; grant all … to
service_role` (0241:93-97); no policies. Every read and write goes through a definer body. Branch
tables carry `zz_branch_guard` (0230:188 form) with the pairs named; `venue_id` has no default (every
writer names it from the match). Chain-wide tables (`match_tickets`, `match_ticket_events`,
`match_blocks`) have no `venue_id` and no guard.

**Creation order:** `matches` → `match_requests` → `match_seats` (no ticket FK yet) →
`match_tickets` → `alter table match_seats add constraint match_seats_ticket_fk foreign key
(ticket_id) references match_tickets(id) not valid` + guarded VALIDATE (R34) →
`match_ticket_events` → `match_events` → `match_blocks` → `match_reports` → `match_exclusions` →
guards, append-only triggers, sanitiser, comments, grants → Money's part.

#### 4.4.1 `matches` (branch)

```sql
create table matches (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references venues(id),
  status              text not null default 'filling',
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  period              tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  duration_min        int not null,
  visibility          text not null,
  join_policy         text not null,
  category            text not null,
  price_iqd           iqd not null,
  shares_iqd          bigint[] not null,
  rate_rule_id        uuid references rate_rules(id),
  price_court_id      uuid not null references courts(id),
  fill_deadline_at    timestamptz not null,
  share_token         text not null unique,
  organiser_id        uuid references profiles(id),
  organised_by        text not null,
  created_by_staff_id uuid references staff(id),
  reservation_id      uuid references reservations(id),
  sandbox             boolean not null default false,
  deadline_warned_at  timestamptz,
  ended_at            timestamptz,
  ended_reason        text,
  idempotency_key     text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint matches_status check (status in
    ('filling','awaiting_court','booked','played','no_show','cancelled','bumped','expired')),
  constraint matches_enums check (visibility in ('public','link') and join_policy in ('open','approve')
    and category in ('open','women','men') and organised_by in ('guest','desk')),
  constraint matches_time check (duration_min between 30 and 480
    and end_at - start_at = duration_min * interval '1 minute'),
  constraint matches_shares check (cardinality(shares_iqd) = 4 and shares_iqd[4] >= 0
    and shares_iqd[1] >= shares_iqd[2] and shares_iqd[2] >= shares_iqd[3] and shares_iqd[3] >= shares_iqd[4]
    and shares_iqd[1] - shares_iqd[4] <= 1
    and shares_iqd[1] + shares_iqd[2] + shares_iqd[3] + shares_iqd[4] = price_iqd),
  constraint matches_token check (share_token ~ '^[A-Za-z0-9_-]{22}$'),
  constraint matches_idem check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  constraint matches_deadline check (status <> 'filling' or fill_deadline_at < start_at),
  constraint matches_organiser_policy check (organiser_id is not null or join_policy = 'open'),
  constraint matches_organised_by check ((organised_by = 'desk') = (created_by_staff_id is not null)),
  constraint matches_reservation check (
    (status not in ('filling','awaiting_court') or reservation_id is null)
    and (status not in ('booked','played','no_show') or reservation_id is not null or sandbox)
    and (not sandbox or reservation_id is null)),
  constraint matches_ended check (
    (status in ('played','no_show','cancelled','bumped','expired')) = (ended_at is not null)
    and (status in ('no_show','cancelled','bumped','expired')) = (ended_reason is not null)
    and (status <> 'bumped'  or ended_reason in ('bumped','no_court'))
    and (status <> 'expired' or ended_reason in ('deadline','no_court'))
    and (status <> 'no_show' or ended_reason = 'all_no_show')
    and (status <> 'cancelled' or ended_reason in ('organiser_cancelled','staff_cancelled',
         'reservation_cancelled','called_off_short','empty','venue_closed')))
);
```

`matches_deadline` binds only while filling, so a desk move of a booked match never breaks it.
Indexes: `matches_reservation_key` unique `(reservation_id) where reservation_id is not null`
(also the DF-16 wall's probe, R20); `matches_live (venue_id, start_at) where status in
('filling','awaiting_court','booked')`; `matches_deadline_due (fill_deadline_at) where status =
'filling'`; `matches_organiser (organiser_id) where organiser_id is not null`. Guard:
`('scoped', 'reservations','reservation_id', 'rate_rules','rate_rule_id', 'courts','price_court_id')`.

#### 4.4.2 `match_requests` (branch)

```sql
create table match_requests (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id),
  match_id        uuid not null references matches(id),
  guest_id        uuid not null references profiles(id),
  seats_requested smallint not null check (seats_requested between 1 and 3),
  friend_genders  text[] check (friend_genders is null
                    or (cardinality(friend_genders) = seats_requested - 1
                        and friend_genders <@ array['female','male']::text[])),
  status          text not null default 'pending'
                    check (status in ('pending','approved','declined','withdrawn','expired')),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint match_requests_decided check ((status = 'pending') = (decided_at is null))
);
```

`friend_genders` is NULL in an `open` match and one entry per friend in a gendered one (OM-39).
Indexes: `match_requests_one_pending` unique `(match_id, guest_id) where status = 'pending'`;
`match_requests_guest_pending (guest_id) where status = 'pending'`; `match_requests_match
(match_id, status)`. Guard: `('scoped', 'matches','match_id')`.

#### 4.4.3 `match_seats` (branch)

```sql
create table match_seats (
  id                      uuid primary key default gen_random_uuid(),
  venue_id                uuid not null references venues(id),
  match_id                uuid not null references matches(id),
  seat_no                 smallint not null check (seat_no between 1 and 4),
  kind                    text not null check (kind in ('account','friend','desk')),
  guest_id                uuid references profiles(id),
  guest_name              text check (guest_name is null or char_length(guest_name) between 1 and 80),
  guest_phone             text check (guest_phone is null
                            or coalesce(app.phone_digits(guest_phone), '') ~ '^[0-9]{7,15}$'),
  gender                  text check (gender is null or gender in ('female','male')),
  status                  text not null default 'in' check (status in
                            ('in','left','removed','cancelled','left_late','refilled','attended','no_show')),
  ticket_id               uuid,                        -- FK match_seats_ticket_fk, added after match_tickets
  share_iqd               iqd not null,
  request_id              uuid references match_requests(id),
  replaces_seat_id        uuid references match_seats(id),
  created_by_staff_id     uuid references staff(id),
  vouched                 boolean generated always as (created_by_staff_id is not null) stored,
  joined_at               timestamptz not null default now(),
  ended_at                timestamptz,
  end_reason              text check (end_reason is null or end_reason in
                            ('left','removed_by_organiser','removed_by_staff','match_ended','refilled','banned','account_deleted')),
  marked_by_staff_id      uuid references staff(id),
  marked_at               timestamptz,
  written_off_by_staff_id uuid references staff(id),
  written_off_at          timestamptz,
  write_off_reason        text check (write_off_reason is null or write_off_reason in ('walked_out','staff_error','other')),
  constraint match_seats_kind check (
    (kind in ('account','friend') and guest_id is not null and ticket_id is not null
       and guest_name is null and guest_phone is null and created_by_staff_id is null)
    or (kind = 'desk' and created_by_staff_id is not null and ticket_id is null
       and (guest_id is null or (guest_name is null and guest_phone is null)))),
  constraint match_seats_ended check ((status in ('left','removed','cancelled','left_late','refilled'))
    = (ended_at is not null and end_reason is not null)),
  constraint match_seats_marked check ((status not in ('attended','no_show') or marked_at is not null)
    and (status <> 'in' or marked_at is null)),
  constraint match_seats_write_off check ((written_off_at is null) = (written_off_by_staff_id is null)
    and (written_off_at is null) = (write_off_reason is null))
);
```

`app.phone_digits` is granted to every writing role (0121). Indexes:

- `match_seats_occupying_no` unique `(match_id, seat_no) where status in ('in','attended')` (R4);
- `match_seats_occupying_account` unique `(match_id, guest_id) where kind = 'account' and status in
  ('in','attended','no_show')` (R4);
- `match_seats_ticket_live` unique `(ticket_id) where status in ('in','left_late')`;
- `(match_id)`; `(guest_id, status) where guest_id is not null`; `(request_id) where request_id is
  not null`.

Guard: `('scoped', 'matches','match_id', 'match_requests','request_id', 'match_seats',
'replaces_seat_id')`. Sanitiser: `match_seats_sanitise` BEFORE INSERT OR UPDATE OF `guest_name,
guest_phone` → `app.trg_sanitise_match_seat()`: `nullif(app.safe_line(…), '')` on both (the 0080
shape). It sorts before `zz_branch_guard`.

#### 4.4.4 `match_tickets` (chain-wide; DB owns the DDL, D3/D4)

```sql
create table match_tickets (
  id                  uuid primary key default gen_random_uuid(),
  guest_id            uuid not null references profiles(id),
  status              text not null default 'available'
                        check (status in ('available','reserved','in_use','forfeited','cashed_out')),
  price_iqd           iqd not null check (price_iqd > 0),
  purchase_payment_id uuid not null references booking_payments(id),
  sandbox             boolean not null,                       -- no default: the purchase row's flag (D3)
  request_id          uuid references match_requests(id),
  seat_id             uuid references match_seats(id),
  forfeited_venue_id  uuid references venues(id),
  forfeited_seat_id   uuid references match_seats(id),
  forfeited_at        timestamptz,
  cashed_out_at       timestamptz,
  cashout_payment_id  uuid references booking_payments(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint match_tickets_reserved   check ((status = 'reserved') = (request_id is not null)),
  constraint match_tickets_in_use     check ((status = 'in_use') = (seat_id is not null)),
  constraint match_tickets_forfeited  check ((status = 'forfeited') = (forfeited_at is not null)
    and (forfeited_at is null) = (forfeited_venue_id is null)
    and (forfeited_at is null) = (forfeited_seat_id is null)),
  constraint match_tickets_cashed_out check ((status = 'cashed_out') = (cashed_out_at is not null and cashout_payment_id is not null)),
  constraint match_tickets_cashout_same check (cashout_payment_id is null or cashout_payment_id = purchase_payment_id)  -- R8
);
```

Indexes: `(guest_id, status)`; `(purchase_payment_id)`; unique `(seat_id) where seat_id is not
null`; `(request_id) where request_id is not null`; `(forfeited_venue_id, forfeited_at) where status
= 'forfeited'` (Money). Only Money inserts rows (`available`, event `bought`) and writes
`cashed_out`; every other move goes through §4.5.4.

#### 4.4.5 `match_ticket_events` (chain-wide, append-only)

`id bigint generated always as identity primary key`, `ticket_id uuid not null → match_tickets`,
`guest_id uuid not null → profiles`, `type text not null` in the seven §1.3 values, `venue_id →
venues` (nullable), `match_id → matches`, `seat_id → match_seats`, `request_id → match_requests`,
`payment_id → booking_payments`, `actor_staff_id → staff`, **`code text check (code is null or
char_length(code) <= 40)`** (why it moved), `at timestamptz not null default now()`. Indexes
`(ticket_id, at)`, `(guest_id, at)`, `(type, at)`. Trigger `match_ticket_events_append_only`
BEFORE UPDATE OR DELETE OR TRUNCATE FOR EACH STATEMENT → `app.forbid_mutation()` (0241:128-131).

#### 4.4.6 `match_events` (branch, append-only)

```sql
create table match_events (
  id             bigint generated always as identity primary key,
  venue_id       uuid not null references venues(id),
  match_id       uuid not null references matches(id),
  type           text not null,   -- the 25 §1.3 types, plus 'no_show' (the match reached no_show)
  actor          text not null check (actor in ('guest','staff','system')),
  actor_guest_id uuid references profiles(id),
  actor_staff_id uuid references staff(id),
  seat_id        uuid references match_seats(id),
  request_id     uuid references match_requests(id),
  code           text check (code is null or char_length(code) <= 40),
  data           jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  at             timestamptz not null default now(),
  constraint match_events_actor check (
    (actor = 'guest'  and actor_guest_id is not null and actor_staff_id is null) or
    (actor = 'staff'  and actor_staff_id is not null) or
    (actor = 'system' and actor_guest_id is null and actor_staff_id is null))
);
```

`data` carries ids and counts only; its keys are `seats` (seat ids), `seats_taken`,
`reservation_id`, `court_id`, `refill`, `from_guest_id`, `to_guest_id`, `by_seat_id`, `reopened`.
Indexes `(match_id, at)`, `(venue_id, at)`. Trigger `match_events_append_only` as above. Guard:
`('scoped', 'matches','match_id', 'match_seats','seat_id', 'match_requests','request_id')`.

#### 4.4.7 `match_blocks`, `match_reports`, `match_exclusions`

- **`match_blocks`** (chain-wide): `id uuid pk`, `blocker_id`, `blocked_id` (both `not null →
  profiles`), `created_at`; unique `(blocker_id, blocked_id)`; check `blocker_id <> blocked_id`;
  index `(blocked_id)`. Deleted with either account (§4.9).
- **`match_reports`** (branch): the §1.2 columns; `reporter_id`, `reported_id` `not null →
  profiles`; `reason` in the six §1.3 values; `status` default `'open'` in `open|dismissed|actioned`;
  `reviewed_by → staff`. Checks `reporter_id <> reported_id`; `num_nonnulls(seat_id, request_id) =
  1`; `(status = 'open') = (reviewed_at is null)`; `(reviewed_at is null) = (reviewed_by is null)`.
  Unique `(reporter_id, reported_id, match_id)`. Indexes `(venue_id, status, created_at)`,
  `(reported_id)`, `(created_at)` (the R36 purge). Guard `('scoped', 'matches','match_id',
  'match_seats','seat_id', 'match_requests','request_id')`.
- **`match_exclusions`** (branch): `match_id → matches`, `guest_id → profiles`, `venue_id not null →
  venues`, `reason text not null check (reason in ('removed_by_organiser','removed_by_staff'))`,
  `created_at`; primary key `(match_id, guest_id)`. Guard `('scoped', 'matches','match_id')`.

#### 4.4.8 The profiles sandbox guard (C20): Money's, not in this file

The guard is Money's `profiles_sandbox_tickets` → `app.trg_profile_sandbox_tickets()` in 0259
(`money.md` §5.13, MD-15): a `payment_sandbox` flip is refused `INVALID_TRANSITION` detail
`live_tickets` while the profile holds a ticket in `available`, `reserved` or `in_use`, or a ticket
attempt in `created` or `pending`. Flipping the flag would strand those tickets (unusable, and cashed
out to the wrong Qi environment). No ticket or attempt can exist before 0259, so nothing is lost by
leaving it out of 0258; DB's draft guard `profiles_sandbox_guard` is dropped so there is one.

#### 4.4.9 Money's part of this file (interface)

Money writes, in this file and after the tables above, before any ticket row can exist (§3.4 of the
Money draft, with R2, R7, R15, R23): the `booking_payments` changes (`hold_id`, `reservation_id`,
`venue_id` nullable; `ticket_count`; `booking_payments_anchor` incl. R7; the amount and reason
CHECKs; `booking_payments_one_active_ticket`); `payment_match_seats`; `tabs.court_cap_iqd`; the
0242 hooks scoped to `purpose='deposit'`. Two of those re-issues carry DB-lane requirements:

- `deposit_settle_success`: its hold expiry comes **textually before its first `reservations`
  write** (hoist `expire_stale_holds(r.court_id, …)` above the in-place update, or put the
  `expired` branch before the `pending` one). Without this, `deposit_apply` fails the lock gate from
  0263 on (C1, R15).
- `deposit_refund_manual`: "settled another way" only from `refund_failed`, for tickets and deposits
  (R23).

| Gate | In this commit |
| --- | --- |
| Matrix | for each of the nine tables and Money's `payment_match_seats`: `{kind:'select', name, expect: ex('denied'), drop:24}` and `{kind:'write', name, op:'insert', payload, expect: ex('denied'), drop:24}`, the payload naming a column the table has: `{id: NIL_UUID}` for `matches`, `match_requests`, `match_seats`, `match_tickets`, `match_blocks`, `match_reports`; `{match_id: NIL_UUID}` for `match_events`, `match_exclusions`; `{ticket_id: NIL_UUID}` for `match_ticket_events`; `{payment_id: NIL_UUID}` for `payment_match_seats` |
| Allowlist | none (no granted RPC) |
| Coverage | tables: `matches` and `match_seats` `table_read`, with `app.assistant_readable_columns` rows for `matches(id, venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category, price_iqd, fill_deadline_at, organised_by, sandbox, ended_at, ended_reason, created_at)` and `match_seats(id, venue_id, match_id, seat_no, kind, status, share_iqd, vouched, joined_at, ended_at, end_reason, marked_at, written_off_at, write_off_reason)` (no identity column; `table_read` is owner-only, 0109; R14 would allow names and gender, and none are added: the owner reads them through `customer_record`, which now carries gender); `match_requests`, `match_events`, `match_tickets`, `match_ticket_events`, `match_blocks`, `match_reports`, `match_exclusions` `excluded: player identity, tickets or moderation; the owner reads matches through report_matches and the desk screens`; Money's `payment_match_seats` excluded; function `trg_sanitise_match_seat` `excluded: service_role only — …` (the sandbox guard's entry is Money's, 0259) |
| SEC-20 | `LINK_COLUMNS` gains `organiser_id`, `blocker_id`, `blocked_id`, `reporter_id`, `reported_id`, `actor_guest_id` in one edit (R29); declarations below; `booking_payments.ticket_count: n` (Money, C19); `payment_match_seats` is not declared (no guest link, R29) |
| Codes | none new |
| Lock gate | none (no callable path yet) |
| Other | `match_seats_ticket_fk` NOT VALID + guarded VALIDATE; the index waiver in the commit message; `docs/design/multi-venue/slice-1-2026-09-21.md`: scoped list + `matches`, `match_seats`, `match_requests`, `match_events`, `match_reports`, `match_exclusions`, `payment_match_seats`; global list + `match_tickets`, `match_ticket_events`, `match_blocks`; `deposits.test.ts` stays green unmodified |

SEC-20 declarations (every column not named is `n`):

| Table | Personal columns |
| --- | --- |
| `matches` | `price_iqd`, `shares_iqd`: Purchase history, "what the court sold for, split in four", keep |
| `match_seats` | `guest_name`: Name, "a walk-in the desk seated in an open match; such a seat has no account, so no account deletion reaches it", keep; `guest_phone`: Phone number, same reason, keep; `gender`: Other personal info, "the seat in a women-only or men-only match", scrub; `share_iqd`: Purchase history, "the player's share of the court", keep |
| `match_requests` | `friend_genders`: Other personal info, "genders a player declared for friends in a women-only or men-only match", scrub |
| `match_tickets` | `price_iqd`: Purchase history, "the price paid for the ticket", keep |
| `match_reports` | `reason`: App activity, "a report one player made about another; a moderation record, deleted after 12 months (R36)", keep |
| `match_events`, `match_ticket_events`, `match_blocks`, `match_exclusions` | all `n` (ids, codes and times only) |

The scrubs of `match_seats.gender` and `match_requests.friend_genders` and the deletion of
`match_blocks` rows are written by 0264; the deletion proof that exercises them lands there (§4.9).
No match row can exist before then (matches stay off).

### 4.5 0260 `match_core` (DB)

Every function here is `security definer set search_path = public`, `revoke all … from public,
anon, authenticated`. Coverage: `excluded: service_role only — an internal helper reached by other
RPCs, edge functions or cron, never by a client`.

#### 4.5.1 Locks

The six primitives of §2.2: `lock_match_venue`, `lock_match_money`, `try_lock_match_venue`,
`match_lock_courts`, `match_expire_holds`, `match_lock`.

#### 4.5.2 Eligibility, visibility, names

**`app.match_eligibility(p_profile_id uuid, p_act boolean) returns text`**: NULL, or the first
failing code:

1. `ACCOUNT_REQUIRED`: no profile, or `deleted_at` set.
2. Only when `p_act`: `PHONE_REQUIRED` (`nullif(btrim(phone),'') is null`); `TERMS_REQUIRED` (not
   `match_terms_ok(terms_version)`); `MATCH_BANNED` (a `match_ban` flag); `GENDER_REQUIRED` (OM-28:
   asked at the first match, whatever its category).

**`app.match_guest(p_act boolean) returns profiles`**, the first statement of every guest RPC:
`AUTH_REQUIRED` when `auth.uid()` is NULL; then raise `match_eligibility(auth.uid(), p_act)` when it
is not NULL; return the profile. `p_act` is true when the call takes a seat, makes a request,
starts, or approves. Leaving, withdrawing, declining, cancelling, messages, reports, blocks and
every read use `false`, so a banned player can still leave. Staff are not exempt.

**`app.match_visibility(m matches, p_viewer uuid, p_gender text, p_token text) returns text`**:
`participant`, `public`, `token`, `restricted` or NULL (not visible):

1. The viewer is the organiser, holds a seat in any status, or has a request in any status →
   `participant`.
2. `v_token := p_token is not null and p_token = m.share_token`.
3. `m.sandbox` differs from the viewer's `payment_sandbox` (`false` for anon) → NULL (DF-19).
4. `not v_token and m.visibility <> 'public'` → NULL.
5. The branch is not in `open_venue_ids()` → NULL. Without a token, also NULL unless
   `matches_enabled` and the match is **listable**: `filling` with `now() < fill_deadline_at`, or
   `booked` with a number open for a guest (§3.2).
6. With a viewer: any of these gives `restricted` with a token, NULL without one: the viewer is
   banned; DF-10 (`women` and `p_gender = 'male'`, or `men` and `'female'`; an unset gender sees
   both); a `match_blocks` row either way between the viewer and the organiser or any carrier's
   `guest_id`; the organiser is banned.
7. `token` if `v_token`, else `public`.

**`app.name_initial(p_family text) returns text`** (immutable): trim; strip one leading article
(`آل` or `ال` followed by a space, hyphen or tatweel; an attached `ال` when at least two letters
remain; Latin `al-` or `el-`, or `al`/`el` followed by a space, in any case); return the first
letter, `upper()`d, or NULL. `آلاء` stays whole. "Letter" is an explicit class (`guest.md` §4.5):
Latin A–Z, a–z and U+00C0–U+024F without × and ÷, Arabic U+0621–U+063A, U+0641–U+064A and
U+0671–U+06D3 (tatweel U+0640 excluded). Never `[[:alpha:]]`: it follows the database ctype, and
under a C-like ctype every Arabic initial would come back NULL.

**`app.match_display_name(p_profile_id uuid) returns jsonb`**: a deleted profile →
`{"name": null, "former": true}` (OM-26, "Former player"); otherwise the given name is
`given_name`, else the first word of `full_name`, plus `name_initial(family_name)`:
`{"name": "Ahmed K." | "Ahmed" | null, "former": false}`. A NULL name renders "Player".

**`app.match_seat_label(s match_seats) returns jsonb`**: `account` →
`{seat_id, seat_no, kind, name, former}` from the holder; `friend` → the holder's `name`,
`former`, plus `holder_seat_no` (the holder's carrier account seat); linked `desk` → the customer's
display name; typed `desk` → `split_person_name(guest_name)` shaped the same way, else `name: null`.
No phone, `guest_id` or `full_name` ever leaves it.

#### 4.5.3 Courts, carriers, booking

**`app.match_shares(p_price bigint) returns bigint[]`** (immutable): `floor(p/4)` each, plus 1 on the
first `p % 4` seats; the twin of `splitEvenly` (`packages/core/src/money/split.ts:16`).

**`app.match_court_free_firm(p_venue uuid, p_period tstzrange, p_duration_min int, p_need int
default 1) returns boolean`**: at least `p_need` active courts of the branch whose
`duration_options` contain the length have no **firm** row overlapping. Callers evaluate it in a
statement after taking the mutex, so it sees every booking the previous holder committed.

**`app.match_pick_court(m matches) returns uuid`**: the first active court of the branch offering
the length with **no live row** (holds included) overlapping `m.period`, ordered by: the tapped
court (`price_court_id`) first; then courts whose `price_slot(...)` equals `m.price_iqd`; then that
price ascending (nulls last), `sort_order`, `id`. NULL when none. The caller holds every court lock
and has expired stale holds.

**`app.match_carriers(p_match_id uuid) returns table (seat_no smallint, seat_id uuid, status
text)`** (stable): four rows, one per number, with the carrier of §3.2 or `seat_id` NULL when
vacant. DB's refill, short and mark logic and Money's `match_money` all read it (R21).

**`app.match_marks_open(p_match_id uuid) returns boolean`** (stable): false for a sandbox match or
one that is not `booked`, `played` or `no_show`. Otherwise `d := venue_business_date(venue,
start_at)`; false when `day_sessions` of the branch has `d` in `closing|closed`, or when `d` is
before today's business date and no open session for `d` exists; true otherwise. It is the marks
window, and Money's "a forfeited ticket could still be restored" test (R13).

**`app.match_drop_ineligible(p_match_id uuid) returns int`** (caller holds the mutex; `filling` or
`awaiting_court` only): every `in` seat whose `guest_id` belongs to a deleted profile → `left`
(`account_deleted`), ticket released (code `account_deleted`); to a banned one → `removed`
(`banned`), ticket released (code `banned`). The same holders' pending requests → `withdrawn`
(deleted) or `expired` (code `banned`), tickets released. One `left`/`removed` event per holder.
Then `match_recompute_organiser`. Returns the seats dropped. R18 (C5).

**`app.match_try_book(p_match_id uuid) returns text`** (the caller holds L2, or is the sweep on a
locked branch; returns the status):

1. Re-read the match. Return its status unless `filling` or `awaiting_court`.
2. `match_drop_ineligible`. If the match ended (`empty`), return.
3. Fewer than 4 carriers: an `awaiting_court` match goes back to `filling`; return.
4. `now() ≥ start_at`: return the status (the sweep ends an awaiting match at start).
5. Sandbox: status `booked`, no reservation, event `booked`; go to 11.
6. **Waiting matches first** (R22): when this match is `filling`, first call `match_try_book` on
   every other non-sandbox `awaiting_court` match of the branch whose period overlaps, oldest
   `updated_at` first. (Those calls skip this step, because their status is `awaiting_court`.)
7. `assert_bookable(price_court_id, start_at, end_at)` in a sub-block; on failure
   `match_end(id,'cancelled','venue_closed','system')` and return.
8. `v_court := match_pick_court(m)`. When found: `set_config('app.match_booking', id, true)`;
   `insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_id,
   guest_name, source, rate_rule_id, price_iqd, created_by_staff_id) values (m.venue_id, v_court,
   'booking', 'confirmed', m.start_at, m.end_at, NULL, 'Open match', <'desk' when organised_by =
   'desk', else 'mobile'>, m.rate_rule_id, m.price_iqd, m.created_by_staff_id)` (the stamped price,
   DF-3); reset the GUC to `''`; status `booked`, `reservation_id`; event `booked`
   (`{reservation_id, court_id}`). The insert runs in a sub-block: an `exclusion_violation` can only
   come from a writer that skips the court lock (an event block, 0174) and has just committed, so
   steps 8–10 run once more with a fresh pick; a second violation raises `SLOT_TAKEN`.
9. Else, if `match_court_free_firm(…, 1)` (only holds block): `awaiting_court`, event
   `awaiting_court` when it was `filling` (DF-18).
10. Else `match_end(id,'bumped','bumped','system')`; return `bumped`.
11. Booked or awaiting: pending requests → `expired` (code `match_full`), tickets released.
12. Return the status.

The GUC `app.match_booking` stops the reservation trigger from judging this match against its own
new row; every other overlapping filling match is still judged (it may be bumped).

#### 4.5.4 Tickets

Every helper writes one `match_ticket_events` row per ticket it moves, with `guest_id`,
`venue_id`, `match_id`, `seat_id` or `request_id`, `code`, and `actor_staff_id = auth.uid()` when the
caller is staff. Each asserts ownership before it moves anything (R17): a ticket that does not
match is skipped and not counted.

| Helper | Contract |
| --- | --- |
| `ticket_pick(p_guest_id uuid, p_count int, p_sandbox boolean, p_request_id uuid default null) returns uuid[]` | Without a request: locks, in one `order by id for update` statement, the guest's `available` tickets with `sandbox = p_sandbox`, and returns the `p_count` oldest by `(created_at, id)`; fewer → `NEED_TICKETS` with `detail = {"needed":n,"available":k,"buy":n-k}::text`. With a request: returns that request's `reserved` tickets (all), locked in `id` order. Picking before the seats are inserted lets `match_seats_kind` require `ticket_id`. |
| `ticket_lock(p_ticket_ids uuid[], p_seat_ids uuid[] default null, p_request_id uuid default null) returns int` | Locks the ids in `id` order. With seats (pairwise): moves a ticket to `in_use` on its seat when it is `available`, or `reserved` **with `request_id = p_request_id`**; its `guest_id` must equal the seat's `guest_id`; clears `request_id`; event `locked`. With only a request: `available` → `reserved`; event `reserved`. Returns how many moved; a caller that gets fewer than it asked for raises (the attended-undo maps it to `SEAT_MARK_LOCKED ticket_used`). |
| `ticket_release(p_ticket_ids uuid[], p_code text, p_seat_ids uuid[] default null, p_request_id uuid default null) returns int` | Moves to `available` only a ticket that is `in_use` with `seat_id` = its paired seat, or `reserved` with `request_id = p_request_id`; clears `seat_id`/`request_id`; event `released` with `p_code`. Anything else is skipped, so it is idempotent. One of the two pairings is required (`INVALID_ARGUMENT` otherwise). |
| `ticket_forfeit(p_ticket_id uuid, p_seat_id uuid) returns boolean` | When the owner profile is deleted: behaves as `ticket_release` on that seat with code `account_deleted` and returns false (R18). Otherwise moves to `forfeited` a ticket `in_use` on `p_seat_id`, or `available` with `id = <that seat's ticket_id>` (the attended correction); stamps `forfeited_at`, `forfeited_venue_id` (the seat's branch), `forfeited_seat_id`; clears `seat_id`; event `forfeited`. Already forfeited by this seat → true. `reserved`, or in use by another seat → false. |
| `ticket_restore(p_ticket_id uuid, p_seat_id uuid, p_relock boolean default false) returns boolean` | Only a ticket `forfeited` with `forfeited_seat_id = p_seat_id`, and only while `match_marks_open` of that seat's match is true (the "still restorable" window Money's cash-out waits on, R13, C4): to `in_use` on that seat when `p_relock`, else `available`; clears the three forfeit columns; event `restored`. Else false, and the ticket stays forfeited. |

A body that moves more than one `available` ticket locks them all first in one `id`-ordered
statement (§2.4).

#### 4.5.5 Ending, organiser, events, counts

**`app.match_end(p_match_id uuid, p_status text, p_reason text, p_actor text) returns boolean`**
(the caller holds the mutex; false and no change when the match is already terminal). It is the one
place that finishes seats, tickets and requests for a terminal status:

| From → to (reason) | Seats and tickets |
| --- | --- |
| `filling`/`awaiting_court` → `cancelled`/`bumped`/`expired` | `in` → `cancelled` (`match_ended`), tickets released (code = reason) |
| `booked` → `cancelled` (`reservation_cancelled`) | `in`, `attended`, `no_show`, `left_late` → `cancelled` (`match_ended`); `in` tickets released; `no_show` tickets restored to `available`; `left_late` tickets released, or restored if forfeited (a restore only while `match_marks_open`, §4.5.4). The venue cancelled, so nobody loses a ticket inside the marks window. |
| `booked` → `cancelled` (`called_off_short`) | statuses unchanged (no carrier is still `in`, R12); unrefilled `left_late` tickets still `in_use` → `ticket_forfeit` |
| `booked` → `played` (`p_reason` NULL) | `in` carriers → `attended` (`marked_at now()`, `marked_by_staff_id` the caller when staff), tickets released (code `auto`), event `seat_attended` (code `auto`) each; unrefilled `left_late` tickets → `ticket_forfeit` (R37) |
| `booked` → `no_show` (`all_no_show`) | unrefilled `left_late` tickets → `ticket_forfeit` |

In every case pending requests → `expired` (code = reason, or `match_ended`), tickets released. Then
`status`, `ended_at`, `ended_reason` (NULL for `played`), `updated_at`, and one event whose type is
`p_status` (`cancelled`, `bumped`, `expired`, `played`, `no_show`), except `called_off_short`, whose
event type is `called_off_short`. `code = p_reason`.

**`app.match_recompute_organiser(p_match_id uuid) returns boolean`** (filling, awaiting or booked):

1. `organised_by = 'desk'` and `organiser_id` NULL: nothing.
2. The organiser still holds a carrier (`account`, or a `desk` seat linked to them): nothing.
3. Otherwise the holder of the carrier `account` seat with the earliest `joined_at` (seat id breaks
   ties) becomes organiser; event `organiser_changed` `{from_guest_id, to_guest_id}`.
4. No account carrier but carriers remain (desk walk-ins): `organiser_id := NULL`, `join_policy :=
   'open'`, pending requests expire (code `organiser_gone`); event `organiser_changed` with
   `to_guest_id: null`.
5. No carrier at all: a filling or awaiting match → `match_end(…,'cancelled','empty','system')`; a
   booked match stays for the desk.

**`app.match_event(p_match_id uuid, p_venue_id uuid, p_type text, p_actor text, p_seat_id uuid
default null, p_request_id uuid default null, p_code text default null, p_data jsonb default '{}')
returns bigint`**: actor ids from `auth.uid()`; `'staff'` with a caller who is not a `staff` row
degrades to `'system'` (a service path that cancels with `cancelled_by 'staff'` must not trip
`match_events_actor`).

**`app.guest_games_played(p uuid) returns int`**: `attended` seats with `guest_id = p` and kind
`account` or `desk`, in non-sandbox matches not `cancelled`, plus `booking` reservations with
`guest_id = p` and status `arrived|completed` (OM-41).

**`app.guest_match_no_shows(p uuid) returns int`**: `no_show` seats with `guest_id = p` in
non-sandbox matches (friend seats count on the holder, DF-15; linked desk seats count), plus
`booking` reservations with `guest_id = p` and status `no_show`. The same number
`customer_counts.noShows` shows (DF-12).

#### 4.5.6 Other lanes' internals (not in this file)

0260 has one author, DB. The internals the drafts put here live with their callers:

| Function | Author, file | What DB needs from it |
| --- | --- | --- |
| `match_money(p_match_id uuid, p_exclude_tab_id uuid) returns jsonb` | Money, 0262 (`money.md` §6.2) | reads `match_carriers`; its top level and `unassigned[]` (`{payment_id, tab_id, tab_live, method, amount_iqd, unassigned_iqd, created_at}`) become `desk_match_detail.money`, and its `kind: 'vacant'` seat rows become `money.vacant[]` (D11, D20) |
| `match_seat_money(uuid) returns table(...)`, `court_fee_written_off(uuid, uuid default null) returns bigint` | Money, 0262 (`money.md` §6.3) | per-seat rows for `desk_match_detail` |
| `match_notify(p_match_id uuid, p_recipients uuid[], p_title_key text, p_params jsonb default '{}', p_actor uuid default null, p_scheduled_for timestamptz default null, p_dedupe text default null) returns int` | Guest, 0261 (`guest.md` §4.6.1) | nothing: DB never calls it (§5.2) |
| `match_sync_reminders(p_match_id uuid) returns void` | Guest, 0261 (`guest.md` §4.6.2) | nothing: DB never calls it (§5.2) |

| Gate | In this commit |
| --- | --- |
| Matrix, allowlist | none (nothing granted) |
| Coverage | every DB function above (R30), `excluded: service_role only — …`; Money's and Guest's entries travel with 0262 and 0261 |
| SEC-20 | none |
| Codes | first raised here: mobile `GENDER_REQUIRED` (`matches.errors.genderRequired`), `MATCH_NOT_FOUND` (`matches.errors.notFound`), `NEED_TICKETS` (`matches.errors.needTickets`). Already mapped: `AUTH_REQUIRED`, `ACCOUNT_REQUIRED`, `PHONE_REQUIRED`, `SLOT_TAKEN`, `INVALID_ARGUMENT`; `TERMS_REQUIRED`, `MATCH_BANNED`, `MATCHES_OFF` mapped by Money's 0259. The `matches.en.ts`/`matches.ar.ts` pair exists from Guest's 0256 commit (`guest.md` §4.5); the copy is `guest.md` §4.22 |
| Lock gate | every change of §2.6; the `packages/db/CLAUDE.md` order line |
| Tests | `match-shares` parity with `splitEvenly`; `match_carriers`; `match_expire_holds` against `expire_stale_holds`; `name_initial` (incl. an Arabic initial under the explicit letter class); `match_visibility` (§7) |

### 4.6 0261 `match_guest_rpcs` (DB, with Guest's `match_notify`, `match_sync_reminders` and push fan-out)

Rules for every guest RPC:

- `security definer`, `revoke … from public, anon`, `grant execute … to authenticated`
  (`match_slots` and `match_invite` also to `anon`).
- The first statement is `match_guest(…)`. A nil or unknown id answers its own not-found before any
  business `FORBIDDEN` (the matrix counts `FORBIDDEN` as "guarded").
- Start, join, request and approve call `assert_not_degraded_for(start_at, venue)` (0210:111);
  leave, withdraw, decline, remove and cancel do not.
- Refusals are listed in the order checked. `[lock]` marks where the lock is taken; the rows after
  it are re-checked under the lock with the same codes.
- Friends are `p_friends = [{"gender": "female"|"male"|null}]`, 0–2 entries (OM-20: the 4th seat is
  always someone else's). In a `women` or `men` match each friend's gender must be the category's.
- **Time clash** (C15): a player may not hold carrier seats in two live matches (`filling`,
  `awaiting_court`, `booked`) whose periods overlap. `MATCH_TIME_CLASH` at start, join, request and
  approval (as `REQUESTER_INELIGIBLE` detail). Desk seats are exempt.

#### 4.6.1 `match_quote(p_venue_id, p_court_id, p_start_at, p_duration_min) → jsonb`

`match_guest(false)`. Refusals: `INVALID_ARGUMENT` (a NULL argument), `COURT_NOT_FOUND` (the court is
not active at `p_venue_id`, or the branch is not open), `INVALID_DURATION`. Nothing is locked or
written. Every other refusal `match_start` would raise from its unlocked checks comes back in
`refusal`, the first of: `MATCHES_OFF`, `BEYOND_HORIZON`, `CLOSED_DATE`, `OUTSIDE_HOURS`,
`SLOT_IN_PAST`, `MATCH_TOO_LATE`, `NO_RATE`, `PHONE_REQUIRED`, `TERMS_REQUIRED`, `MATCH_BANNED`,
`MATCH_LIMIT_REACHED`, `MATCH_TIME_CLASH`, `SLOT_TAKEN`, `MATCH_SLOT_FULL` (unlocked counts). Never
`GENDER_REQUIRED` or `NEED_TICKETS`: the phone handles both inline (D13).

```json
{ "enabled": true, "duration_min": 90, "price_iqd": 40000, "shares_iqd": [10000,10000,10000,10000],
  "fill_deadline_at": "…", "earliest_start_at": "…", "categories": ["open","women"],
  "my_gender": "female", "tickets_available": 1, "ticket_price_iqd": 10000,
  "seats_max": 3, "filling_at_time": 1, "courts_free": 2, "refusal": null }
```

`price_iqd` and `shares_iqd` are NULL on `NO_RATE`. `categories` is `open` plus the caller's
gender, or all three when it is unset (the start then asks). `tickets_available` counts the
caller's available tickets with their own sandbox flag.

#### 4.6.2 `match_start(...)` (§1.6 args) → jsonb

Refusals:

1. `match_guest(true)`: `AUTH_REQUIRED`, `ACCOUNT_REQUIRED`, `PHONE_REQUIRED`, `TERMS_REQUIRED`,
   `MATCH_BANNED`, `GENDER_REQUIRED`.
2. `INVALID_ARGUMENT` (detail = the argument): a NULL required argument, **including
   `p_idempotency_key`**; an enum outside its list; `p_friends` not of that shape; a NULL friend
   gender in a gendered category; `p_quoted_price_iqd` NULL or negative.
3. Idempotency: a match with this key and `organiser_id` = the caller returns the same JSON with
   `duplicate:true`; the key under anyone else is `IDEMPOTENCY_CONFLICT` (the `hold_slot` pattern,
   0225:96-110; a lost unique race is caught the same way).
4. `MATCH_SEAT_LIMIT`: more than 2 friends.
5. `COURT_NOT_FOUND`: the court is not active at `p_venue_id`, or the branch is not in
   `open_venue_ids()`.
6. `MATCHES_OFF`.
7. `INVALID_DURATION`: not in the court's `duration_options`.
8. `BEYOND_HORIZON` (`max_booking_horizon_days`).
9. `CLOSED_DATE`, `OUTSIDE_HOURS` (`assert_bookable`).
10. `SLOT_IN_PAST`.
11. `MATCH_TOO_LATE` when `p_start_at < now() + (match_fill_deadline_minutes + 60) minutes` (OM-43);
    detail = that number of minutes.
12. `DEGRADED_LOCKOUT`.
13. `MATCH_GENDER_MISMATCH`: the caller's or a friend's gender against a gendered category (detail
    `friend` for a friend).
14. `MATCH_LIMIT_REACHED` (OM-37): the caller already holds an `in` account seat in
    `max_filling_matches_per_guest` matches that are `filling` or `awaiting_court`; detail = the cap.
    Counted unlocked, the accepted `HOLD_QUOTA_EXCEEDED` shape.
15. `MATCH_TIME_CLASH` (`app.match_time_clash`, 0261: a carrier seat, §3.2, in another live
    match over the period; a late leaver clashes until the refill).
16. `[lock]` LS: `match_lock_courts(v)`, `match_expire_holds(v, period)`, `lock_match_venue(v)`.
17. Idempotency again, under the mutex (R24): `duplicate:true` or `IDEMPOTENCY_CONFLICT`.
18. `SLOT_TAKEN`: no firm-free court offers the length (`match_court_free_firm(…, 1)` false).
19. `MATCH_SLOT_FULL` (OM-42): `n` = non-sandbox `filling`/`awaiting_court` matches of the branch
    overlapping the period; refused unless `match_court_free_firm(…, n + 1)`; detail = `n`. A sandbox
    start is neither counted nor checked.
20. `NO_RATE`: `price_slot(p_court_id, …)` finds no rule.
21. `PRICE_CHANGED` when the price differs from `p_quoted_price_iqd`; detail
    `{"quoted_iqd","current_iqd"}` (quote = charge, DF-3).
22. `NEED_TICKETS` from `ticket_pick(caller, 1 + friends, caller.payment_sandbox)`.
23. `MATCH_TIME_CLASH` again (review 2026-09-29): the mutex is per branch, so the same guest's start
    or join at another branch may have passed its own step 15 meanwhile. `ticket_pick` locks every
    available ticket of the guest, so that write has committed by now and the check sees its seats.

Writes: the match (`filling`, organiser = caller, `organised_by 'guest'`, `sandbox` = the caller's
`payment_sandbox`, `price_court_id = p_court_id`, `shares_iqd = match_shares(price)`,
`fill_deadline_at = start − deadline`, `share_token = translate(rtrim(encode(
extensions.gen_random_bytes(16),'base64'),'='),'+/','-_')`); seat 1 `account` (gender from the
profile), seats 2.. `friend` (gender as declared), each `share_iqd = shares_iqd[seat_no]` and its
picked `ticket_id`; `ticket_lock(ids, seat_ids)`; event `started` (`{seats, seats_taken}`).

```json
{ "duplicate": false, "match_id": "…", "status": "filling", "share_token": "…",
  "seats": [{"seat_id":"…","seat_no":1,"kind":"account"}],
  "price_iqd": 40000, "shares_iqd": [10000,10000,10000,10000],
  "fill_deadline_at": "…", "tickets_locked": 1, "tickets_available": 0 }
```

#### 4.6.3 `match_join(p_match_id, p_friends, p_token) → jsonb` (instant, OM-4)

Refusals:

1. `match_guest(true)`.
2. `INVALID_ARGUMENT` (`p_match_id` NULL, `p_friends` shape).
3. `MATCH_SEAT_LIMIT`.
4. `MATCH_NOT_FOUND`: unknown, or `match_visibility` NULL (a sandbox mismatch lands here).
5. `MATCHES_OFF`.
6. `MATCH_APPROVAL_REQUIRED`: `join_policy = 'approve'`.
7. The caller holds a carrier (`account`, or a linked `desk` seat): `duplicate:true` with the current
   seats when their count equals `1 + friends`, else `MATCH_ALREADY_IN`. A `left_late` carrier counts
   (a late leaver holds their number until a refill) but is never a replay: only `in`/`attended`
   seats are counted against `1 + friends`, so a late leaver's tap is `MATCH_ALREADY_IN`
   (`match_detail`'s `can.join`/`can.request` are false for them too).
8. `MATCH_UNAVAILABLE`: a block either way with the organiser or a carrier's holder, an exclusion
   (OM-44), or a banned organiser. It does not say which.
9. `MATCH_GENDER_MISMATCH` (caller or a friend).
10. `MATCH_CLOSED`: terminal, or `filling` past `fill_deadline_at`, or `booked` at or after
    `start_at`. `MATCH_FULL`: `awaiting_court`; `filling` with fewer free numbers than `1 + friends`;
    `booked` with fewer numbers open for a guest (§3.2).
11. `MATCH_LIMIT_REACHED` (only when the match is `filling`; a refill is exempt).
12. `MATCH_TIME_CLASH`.
13. `DEGRADED_LOCKOUT`.
14. `[lock]` L2; re-check 7 and 10.
15. `NEED_TICKETS` (`ticket_pick(caller, 1 + friends, m.sandbox)`).
16. 12 again (review 2026-09-29), as `match_start` 23: after the pick the same guest's write at another
    branch has committed and is seen.

Writes:

- A filling match: the seats take the lowest free numbers.
- A booked match (refill): the seats take the open numbers in ascending order; `replaces_seat_id`
  is the number's `left_late` carrier, or the latest ended seat on a vacant number. A `left_late`
  carrier becomes `refilled` (`refilled`) and its ticket is released (code `refilled`); event
  `refilled` (`{by_seat_id}`) per replaced seat. (A guest refill happens before start, so the
  ticket is never forfeited yet; the desk's after-start case is §4.7.5.)
- `ticket_lock`; event `joined` (`{seats, seats_taken, refill}`).
- A refill of the organiser's own `left_late` number: `match_recompute_organiser` after `joined`
  (OM-34; the late-leaving organiser keeps the part only while the number is theirs). The same in
  `match_decide` (approve) and `desk_add_seat`.
- A filling match reaching 4 carriers: `match_try_book`.
- A `unique_violation` backstop maps to `MATCH_ALREADY_IN`.

```json
{ "duplicate": false, "match_id": "…", "match_status": "filling|awaiting_court|booked|bumped",
  "refill": false, "seats": [{"seat_id":"…","seat_no":3,"kind":"account"}],
  "tickets_locked": 1, "tickets_available": 0 }
```

#### 4.6.4 `match_request(p_match_id, p_friends, p_token) → jsonb` (approve mode, OM-35)

Refusals: 1 `match_guest(true)`; 2 `INVALID_ARGUMENT`; 3 `MATCH_SEAT_LIMIT`; 4 `MATCH_NOT_FOUND`;
5 `MATCHES_OFF`; 6 `MATCH_NOT_APPROVAL` (`join_policy = 'open'`); 7 `MATCH_ALREADY_IN`; 8 the
caller's pending request exists → returned with `duplicate:true`; 9 `MATCH_UNAVAILABLE`;
10 `MATCH_GENDER_MISMATCH`; 11 `MATCH_CLOSED` / `MATCH_FULL` (as join, at request time);
12 `MATCH_LIMIT_REACHED` (filling only); 13 `MATCH_TIME_CLASH`; 14 `REQUEST_LIMIT`: 5 pending
requests across matches, detail `5`; 15 `DEGRADED_LOCKOUT`; 16 `[lock]` L1, re-check 7, 8, 11;
17 `NEED_TICKETS` (`ticket_pick(caller, 1 + friends, m.sandbox)`).

Writes the request (`friend_genders` NULL in an `open` match), `ticket_lock(ids, null,
request_id)` (reserved) and event `requested` (`{seats}`). Returns `{duplicate, request_id,
status:'pending', seats_requested, tickets_reserved}`.

#### 4.6.5 `match_withdraw(p_request_id) → jsonb`

`match_guest(false)` → `INVALID_ARGUMENT` → `REQUEST_NOT_FOUND` (not the caller's; unknown and
someone else's read the same) → already `withdrawn` → `duplicate:true` → `REQUEST_CLOSED`
(approved, declined, expired) → `[lock]` L1, re-check → `withdrawn`, `decided_at`, tickets released
(`ticket_release(ids, 'withdrawn', null, request_id)`), event `withdrawn`. Returns `{request_id,
status:'withdrawn', duplicate, tickets_released}`.

#### 4.6.6 `match_decide(p_request_id, p_approve) → jsonb`

Refusals:

1. `match_guest(false)`.
2. `INVALID_ARGUMENT` (a NULL argument).
3. `REQUEST_NOT_FOUND`: unknown, or the caller is not a participant of its match.
4. `NOT_ORGANISER`: a participant who is not the organiser (after a handover, say).
5. Already `approved` with `p_approve`, or `declined` without it → `duplicate:true`.
6. `REQUEST_CLOSED`.
7. Decline: `[lock]` L1, re-check 4 and 6, then `declined`, tickets released (code `declined`),
   event `declined`.
8. Approve:
   - `MATCHES_OFF` (R10);
   - `MATCH_CLOSED` / `MATCH_FULL` (free or open numbers < `seats_requested`);
   - `REQUESTER_INELIGIBLE`, detail = the first code the requester now fails:
     `match_eligibility(requester, true)` (`ACCOUNT_REQUIRED`, `PHONE_REQUIRED`, `TERMS_REQUIRED`,
     `MATCH_BANNED`, `GENDER_REQUIRED`), then `MATCH_GENDER_MISMATCH`, `MATCH_UNAVAILABLE` (a block
     or exclusion since), `MATCH_ALREADY_IN`, `MATCH_LIMIT_REACHED`, `MATCH_TIME_CLASH`. The request
     stays pending; the organiser can decline it;
   - `DEGRADED_LOCKOUT`;
   - `[lock]` L2; re-check 4, 6, the numbers and eligibility;
   - `ticket_pick(requester, n, m.sandbox, request_id)` returns the request's reserved tickets.
     Fewer than `n` (drift) → the request is expired (code `tickets_missing`) and the call answers
     `REQUEST_CLOSED`;
   - seats as in join (refill rules included), `ticket_lock(ids, seat_ids, request_id)`, request
     `approved`, events `approved` and `joined`, `match_try_book` at 4.

Returns `{request_id, status, duplicate, seats[], match_status, tickets_released}`.

#### 4.6.7 `match_leave(p_match_id, p_seat_ids) → jsonb`

`p_seat_ids` NULL means every `in` seat of the caller (account, friend, linked desk) plus their
pending request.

Refusals: 1 `match_guest(false)`; 2 `INVALID_ARGUMENT`; 3 `MATCH_NOT_FOUND` (unknown, or not a
participant); 4 `SEAT_NOT_FOUND` (an id that is not one of the caller's `in` seats here);
5 `MATCH_CLOSED` (terminal); 6 `SEAT_STARTED` (`booked` and `now() ≥ start_at`);
7 `SEAT_HOLDER_REQUIRED` (the subset leaves the account seat but keeps friends); 8 `[lock]` L1,
re-check. Nothing left to leave → `duplicate:true`.

Writes: `filling`/`awaiting_court` → seats `left` (`left`), tickets released (code `left`), an
awaiting match back to `filling`, event `left` (`{seats, seats_taken}`); `booked` before start →
seats `left_late` (`left`), tickets stay `in_use`, event `left_late`. The pending request is
withdrawn. Then `match_recompute_organiser`. Returns `{match_id, match_status, left:[{seat_id,
status}], request_withdrawn, organiser_changed, tickets_released, tickets_locked}`.

#### 4.6.8 `match_remove_player(p_match_id, p_seat_id) → jsonb` (OM-44)

Refusals: 1 `match_guest(false)`; 2 `INVALID_ARGUMENT`; 3 `MATCH_NOT_FOUND` (not a participant);
4 `NOT_ORGANISER`; 5 `SEAT_NOT_FOUND` (not an `in` account or friend seat of another holder here;
the organiser's own seats and desk seats are out of reach); 6 `MATCH_BOOKED`; 7 `MATCH_CLOSED`;
8 `[lock]` L1, re-check 4.

Writes: the seat, plus the holder's friend seats when it is the account seat → `removed`
(`removed_by_organiser`); tickets released; a `match_exclusions` row (`removed_by_organiser`) when the
account seat goes; an awaiting match back to `filling`; event `removed` (code
`removed_by_organiser`, `{seats}`). Returns `{match_id, match_status, removed:[seat_id],
tickets_released}`.

#### 4.6.9 `match_cancel(p_match_id, p_reason) → jsonb`

`match_guest(false)` → `INVALID_ARGUMENT` (`p_reason` not NULL and outside the organiser reasons)
→ `MATCH_NOT_FOUND` → `NOT_ORGANISER` → already `cancelled`/`organiser_cancelled` →
`duplicate:true` → `MATCH_BOOKED` → `MATCH_CLOSED` → `[lock]` L1, re-check →
`match_end(id,'cancelled','organiser_cancelled','guest')`; `write_audit('match.cancel', 'matches',
id, null, {status}, p_reason)`. Returns `{match_id, status:'cancelled', duplicate}`.

#### 4.6.10 `match_post_message(p_match_id, p_code) → jsonb`

`match_guest(false)` → `INVALID_ARGUMENT` (code not one of `on_my_way`, `running_late`,
`cant_make_it`, `bring_balls`) → `MATCH_NOT_FOUND` (not a participant) → `FORBIDDEN` (no carrier seat
and not the organiser) → `MATCH_CLOSED` (status not `filling|awaiting_court|booked`, or `now() ≥
end_at`). The same code from the same guest within 10 minutes → `duplicate:true`. More than 12
messages by the guest in this match → `RATE_LIMITED`. No lock. Event `message` (`code`). Returns
`{event_id, duplicate}`.

#### 4.6.11 `match_report`, `match_block`, `match_unblock`

`match_report(p_match_id, p_reason, p_seat_id, p_request_id, p_block)`: `match_guest(false)` →
`INVALID_ARGUMENT` (reason outside §1.3; `p_block` NULL) → `REPORT_TARGET_INVALID` → a duplicate
`(reporter, reported, match)` → `duplicate:true` → `RATE_LIMITED` (more than 10 reports by the
caller in 24 h). `REPORT_TARGET_INVALID` covers: not exactly one of `p_seat_id`/`p_request_id`; a
target outside this match; the caller not a participant; a target whose `guest_id` is NULL (a typed
desk seat) or is the caller; a request target when the caller is not the organiser. A friend seat
reports its holder. The report is inserted `open`; with `p_block` a block is added too (a duplicate
is fine). The branch's managers and owners are told through `notify_staff(<their ids,
app.staff_ids_with_roles (0160:63)>, 'staff_info', {route:'staff', id: report_id,
title_key:'match_report_new', params:{}}, 'match_report:' || report_id)` inside
`begin … exception when others then null` (0193; `id` is an allowed payload key, `guest.md` §4.7.5).
Returns `{report_id, duplicate, blocked}`.

`match_block(p_match_id, p_seat_id, p_request_id)`: the same target rules with
`BLOCK_TARGET_INVALID`; a duplicate pair → `duplicate:true`. A block removes nobody from a match
they already share; it hides future matches (§4.5.2 step 6) and refuses future joins, requests and
approvals between the two. Returns `{block_id, duplicate}`.

`match_unblock(p_block_id)`: `match_guest(false)` → `INVALID_ARGUMENT` → deletes the caller's own
block → `{unblocked: true|false}`.

#### 4.6.12 Reads

All are `match_guest(false)`. Names come only from `match_display_name`/`match_seat_label`; a phone
never appears. The picks of D11–D17 (rules review) are applied.

**`open_matches(p_venue_id, p_from, p_to)`**: `INVALID_ARGUMENT` for a NULL, `p_to ≤ p_from`, or a
window over 16 days (R27). A closed or unknown branch gives an empty list; a banned caller gets
`banned: true` and an empty list. Rows: visibility `public` or `participant`, listable, by
`start_at`, except a match the caller was removed from (`match_exclusions`, OM-44: `guest.md`
§4.15 gives excluded no list row; `match_detail` still shows it with `me.excluded`). **No names**
(D14).

```json
{ "banned": false,
  "matches": [{ "match_id","start_at","end_at","duration_min","category","join_policy","status",
                "seats_taken","seats_left","refill","fill_deadline_at","share_iqd",
                "mine": "seated|requested|null" }] }
```

**`match_detail(p_match_id, p_token)`**: `INVALID_ARGUMENT` when both are NULL; `MATCH_NOT_FOUND`
when unknown or visibility NULL. The union of both drafts (D15):

```jsonc
{ "id","venue_id","status","ended_reason","start_at","end_at","duration_min","category",
  "visibility","join_policy","price_iqd","shares_iqd","fill_deadline_at",
  "seats_taken","seats_left","seats_total": 4,"court_id": null /* booked only */,
  "organiser": { "name","former","is_me" } | null,
  "seats": [{ "seat_id","seat_no","kind","status","name","former","holder_seat_no",
              "is_me","is_mine","share_iqd","open",
              "can": { "remove","report","block" } }],    /* carriers; an open left_late has open: true, name: null */
  "me": { "role": "organiser|player|requester|removed|viewer",
          "seats": [{ "seat_id","seat_no","kind","status","end_reason","share_iqd","request_id","ticket_status" }],
          "request": { "request_id","status","seats_requested" } | null,
          "excluded": false,
          "can": { "join","request","withdraw","leave","cancel","remove","decide","message","report","block","share" },
          "refusal": null | "<CODE>",                         /* never NEED_TICKETS or a ticket code */
          "tickets_available": 1, "tickets_needed": 0,
          "leave_outcome": "release|locked_until_refill|none" },
  "requests": [{ "request_id","name","former","seats_requested","friend_genders",
                 "games_played","no_shows","created_at" }],   /* organiser only; pending */
  "messages": [{ "code","seat_no","name","former","is_me","at" }], /* carrier holders and the organiser; last 20 */
  "share_token": null | "…",                                  /* organiser and seated players */
  "server_now": "…" }
```

- The shape is `guest.md` §4.3's (D15, the union); fields beyond it (`seats_left` and the
  restricted card's `duration_min`, `venue`, `timezone`) are extras the phone may ignore.
- `seats[].can` answers for the viewer: `remove` (organiser, filling or awaiting, another holder's
  account or friend seat), `report` and `block` (an account is behind the seat and it is not the
  viewer's); a typed desk seat is false on all three.
- `me.seats` includes the caller's linked desk seats (`kind 'desk'`, `ticket_status` NULL) (R32).
- `me.refusal` is the first code a join or request would raise from its unlocked checks, ticket
  shortage aside (`GENDER_REQUIRED` drives the inline ask, DF-10). `me.tickets_needed` = the tickets
  to buy for one seat (`max(0, 1 − tickets_available)`) for a viewer or requester, else 0.
- `requests[].games_played` and `no_shows` come from §4.5.5 (OM-41).
- A **restricted** viewer (R32) gets only the card the link screen renders, with no ids and no
  names: `{restricted: true, status, start_at, end_at, duration_min, category, join_policy,
  seats_left, venue:{name_en, name_ar}, timezone, me:{refusal}, server_now}`.

**`my_matches(p_scope default 'upcoming')`**: `INVALID_ARGUMENT` unless `upcoming|past`. Rows are
matches where the caller has a seat (any kind, linked desk seats included) or a request, in any
status. `upcoming` = status `filling|awaiting_court|booked` with `end_at > now()`, plus anything
ended in the last 24 h; `past` = the rest; limit 100.

```json
[{ "match_id","venue_id","status","ended_reason","start_at","end_at","duration_min","category",
   "join_policy","visibility","seats_taken","court_id","fill_deadline_at","is_organiser",
   "my_role": "organiser|player|requester|removed",
   "my_seats": [{ "seat_id","seat_no","kind","status","end_reason","share_iqd","request_id","ticket_status" }],
   "request": { "request_id","status","seats_requested","decided_at" } | null,
   "my_tickets": { "locked": 1, "released": 0, "forfeited": 0 } }]
```

**`my_match_blocks()`** → `[{block_id, name, former, created_at}]`.

**`match_slots(p_venue_id, p_from, p_to)`** (anon and authenticated, `publicByDesign`): no guard;
`INVALID_ARGUMENT` on a NULL or a window over 16 days (R27). Rows: public, listable, non-sandbox
matches at an open branch with matches on; signed-in callers with a profile also get the §4.5.2
step-6 filters, the exclusion filter (as `open_matches`) and their own sandbox flag. Each row `{start_at, end_at, duration_min, category,
join_policy, seats_left, mine}`; `mine` is false for anon (D13). No ids, names or money.

**`match_invite(p_token)`** (anon and authenticated, `publicByDesign`): `{status:'open'|'full'|
'closed', start_at, end_at, timezone, category, join_policy, seats_left, venue:{name_en,
name_ar}}` (D12). A NULL, malformed, unknown or sandbox token, a closed branch, or matches switched
off answers `{"status":"closed"}` and nothing else, so it is no oracle (DF-9). `full` =
`awaiting_court`, or `booked` with no number open for a guest before start.

`my_tickets` and `guest_tickets` are Money's (0259, D5/D9).

#### 4.6.13 `notify_staff` re-issued (DB, R5)

From 0193:38, verbatim, with `'match_report_new'` appended last to `c_title_keys` (0193:46-56;
`tests/staff-push.test.ts` checks the order). `_shared/staff-push.json`,
`send-push/staffStrings.ts` and `tests/send-push-staff.test.ts` gain the key **in this same commit**
(push D), not in push A: R5 as amended by `guest.md` §4.7.5 (R43), because the stack test compares
the JSON with this re-issue and a push A carrying the key would turn CI red until push D. It is safe
on hosted: no report can be filed before a match exists, and `matches_enabled` stays false until
push D's `functions-deploy` run is green.

#### 4.6.14 Guest's part of this file (interface, R26)

Guest writes, at the top of this file and before DB's guest RPCs (`guest.md` §4.6): the functions
`match_notify` and `match_sync_reminders`; an AFTER INSERT trigger on `match_events` that turns
event rows into `match_notify` calls and calls `match_sync_reminders` for the event types that can
change a reminder; and an AFTER INSERT trigger on `match_ticket_events` `WHEN (new.type =
'forfeited')` for `ticket_forfeited`. DB's promise to those triggers is in §5.2.

| Gate | In this commit |
| --- | --- |
| Matrix | `ex('execute', {anon:'denied', guest_anon_session:'guarded'})` with nil ids (the `hold_slot` row form) for `match_quote`, `open_matches`, `match_detail`, `my_matches`, `my_match_blocks`, `match_start`, `match_join`, `match_request`, `match_withdraw`, `match_decide`, `match_leave`, `match_remove_player`, `match_cancel`, `match_post_message`, `match_report`, `match_block`, `match_unblock`; `SELF_ANON_OK` for `match_slots`, `match_invite` |
| Allowlist | the 17 in `guarded`; `publicByDesign`: `match_slots` ("open matches: anon grid counts at an open branch, no ids, names or money (DF-9)"), `match_invite` ("open matches: web invite by an unguessable 22-character token; status, time, category and branch name only (DF-9)"); floor |
| Coverage | the 19 RPCs `map:action`; Guest's `match_notify`, `match_sync_reminders` and trigger functions `excluded: service_role only — …` |
| SEC-20 | none |
| Codes | mobile `CODE_TO_KEY` + `matches.errors.*` (Guest's copy, `guest.md` §4.22): `MATCH_CLOSED`, `MATCH_FULL`, `MATCH_SLOT_FULL`, `MATCH_TOO_LATE`, `MATCH_LIMIT_REACHED`, `MATCH_SEAT_LIMIT`, `MATCH_APPROVAL_REQUIRED`, `MATCH_NOT_APPROVAL`, `MATCH_ALREADY_IN`, `MATCH_GENDER_MISMATCH`, `MATCH_UNAVAILABLE`, `MATCH_BOOKED`, `MATCH_TIME_CLASH` (new, §9; `matches.errors.timeClash`), `NOT_ORGANISER`, `REQUEST_CLOSED`, `REQUESTER_INELIGIBLE`, `REQUEST_LIMIT`, `SEAT_NOT_FOUND`, `SEAT_HOLDER_REQUIRED`, `SEAT_STARTED`, `REPORT_TARGET_INVALID`, `BLOCK_TARGET_INVALID`. R6 (`REQUEST_NOT_FOUND` → `errors.requestGone`, `RATE_LIMITED` → `errors.tooManyRequests` with `check-error-codes --update`, G7a) is already done by Guest's 0256 commit |
| Lock gate | `lock-order-matches.test.ts` asserts `match_join`'s sequence |
| Push | `match_report_new` in `c_title_keys`, with `_shared/staff-push.json`, `staffStrings.ts` and `send-push-staff.test.ts` in the same commit (§4.6.13, R43) |

### 4.7 0262 `match_desk_money` (DB, with Money's seat money)

Rules for every staff RPC:

- The role guard is the first statement (`FORBIDDEN`); roles are §1.7's (+R1); "desk" is
  court_desk, manager, owner.
- A match outside `app.visible_venue_ids()`, **or a sandbox match**, is `MATCH_NOT_FOUND` (or
  `SEAT_NOT_FOUND` for a seat) (C20).
- A write the caller can see but is not `is_staff_at` → `VENUE_MISMATCH`; then
  `set_config('app.venue_id', …)` (the 0217 pattern).
- Audited writes use `app.write_audit` (0005:33).

#### 4.7.1 `desk_open_matches(p_from, p_to)` (desk) → envelope (D12, D18)

`INVALID_ARGUMENT` for a NULL, `p_to ≤ p_from` or a window over 3 days. The branch in scope is
`app.resolve_venue()`; when it is NULL (the owner's "All branches"), rows cover
`visible_venue_ids()` and the branch settings are NULL. Rows: non-sandbox matches with status
`filling`/`awaiting_court`, or `booked` with a number open for the desk and `now() < end_at`,
`start_at` in the window. The shape is the operator's (`operator.md` §5.6.1):

```json
{ "matches_enabled": true, "fill_deadline_minutes": 120, "earliest_start_minutes": 180,
  "ticket_price_iqd": 10000, "server_now": "…",
  "matches": [{ "match_id","venue_id","status","start_at","end_at","duration_min","category",
                "join_policy","visibility","seats_taken","seats_left","requests_pending",
                "fill_deadline_at","organised_by",
                "organiser": {"customer_id","full_name","phone"} | null,
                "price_iqd","shares_iqd","courts_free_firm","courts_total" }] }
```

#### 4.7.2 `desk_match_states(p_reservation_ids uuid[])` (desk)

`INVALID_ARGUMENT` above 500 ids. An object keyed by reservation id, only for match bookings the
caller can see (the `booking_bill_states` batch shape, 0106:949):
`{match_id, status, category, label, organiser_customer_id, seats_in, seats_attended,
seats_no_show, seats_unmarked, seats_left_late, open_seats}` (D19; `seats_unmarked` = `in` carriers
after the start). `label` is the organiser's `full_name`, else the
first desk seat's typed name, else NULL. Money figures stay in `booking_bill_states`
(`seats_owing`, Money).

#### 4.7.3 `desk_match_detail(p_match_id)` (desk)

`MATCH_NOT_FOUND`, otherwise the shape of `operator.md` §5.6.3, which is the contract (D20); DB
builds it:

```text
match:  { id, venue_id, status, ended_reason, start_at, end_at, duration_min, category,
          join_policy, visibility, price_iqd, shares_iqd[4], fill_deadline_at, share_token,
          organised_by, organiser_seat_id,
          organiser: {customer_id, full_name, phone, flags[]} | null,
          reservation_id, reservation_status, court_id, court_name_en, court_name_ar, sandbox,
          courts_free_firm, courts_total, started, marks_open, server_now,
          can: { add_seat, cancel, call_off } }
seats:  [{ seat_id, seat_no, kind, status, end_reason, carrying,
           customer_id, full_name, display_name, phone,
           holder_seat_id, holder_name, companion_no,
           gender, gender_source,                      -- 'guest' | 'holder' | 'desk' | null
           vouched, flags[], is_organiser, joined_at, ended_at, marked_at, marked_by_name,
           replaces_seat_id, replaced_by_seat_id,
           ticket: { ticket_id, status } | null,       -- null for desk seats
           write_off_reason,
           money: { share_iqd, paid_desk_iqd, credit_iqd, owed_iqd, written_off_iqd,
                    write_off, open_iqd, take_iqd } | null,  -- Money's seat row; null while filling
           can: { mark_attended, mark_no_show, unmark, remove_reasons[], take_share, write_off,
                  replace } }]
requests: [{ request_id, customer_id, full_name, phone, flags[], seats_requested,
             friend_genders[], games_played, no_shows, created_at }]
money:  { phase, price_iqd, booking_price_iqd, price_delta_iqd, paid_iqd, live_tab_paid_iqd,
          desk_paid_iqd, unassigned_iqd, delta_owed_iqd, owed_iqd, written_off_iqd, open_iqd,
          over_iqd,
          vacant: [{ seat_no, open_iqd, written_off_iqd }],
          unassigned: [{ payment_id, tab_id, tab_live, method, amount_iqd, unassigned_iqd,
                         created_at }] } | null        -- null while there is no reservation
events: [{ at, type, actor, actor_name, seat_no, code }]  -- the last 50, newest first
```

- `seats` holds every seat of the match: the carriers by `seat_no` first, then the ended seats.
  `carrying` is true on a carrier (§3.2); `replaced_by_seat_id` is set on a seat another seat
  replaced (a re-seated `no_show`, a refilled late leaver).
- `customer_id` is the player (account), the holder (friend) or the linked customer (desk).
  `full_name` and `phone` are the seat's own (profile, or typed walk-in); NULL for a friend seat
  and for a nameless desk extra, which carry `holder_seat_id`, `holder_name` and `companion_no`
  (1..2) instead. `display_name` is what players see. `gender` is the seat's, and
  `gender_source` says who declared it (OM-39: the desk can check).
- `seats[].money` is Money's `match_seat_money` row; `money` is `match_money(id, null)`'s top
  level with its `unassigned[]` (D11; court_desk cannot read `payments`), and `vacant[]` is built
  from its `kind: 'vacant'` seat rows. Money's names win in this block (D11).
- `courts_free_firm` counts firm-free courts offering the length; `started` = `now() ≥
  start_at`; `marks_open` = `match_marks_open(id)`.

The `can` flags (the server's word; the operator mirrors them only for offline and capability):

| Flag | True when |
| --- | --- |
| `match.can.add_seat` | `filling` before its deadline with a free number, or `booked` with a number open for the desk and `now() < end_at` (§3.2) |
| `match.can.cancel` | `filling` or `awaiting_court` |
| `match.can.call_off` | `booked`, `now() ≥ start_at`, `marks_open`, no `in` carrier, short (§3.2: a `no_show` carrier, or an unrefilled `left_late` carrier after start, §8 D-3), at least one `attended` carrier |
| `seat.can.mark_attended` | match `booked`/`played`/`no_show`, `marks_open`, the seat a carrier `in` or a `no_show` not re-seated |
| `seat.can.mark_no_show` | match `booked`/`played`, `now() ≥ start_at`, `marks_open`, carrier `in`, or `attended` whose released ticket is still `available`; no payment linked to the seat (C18) |
| `seat.can.unmark` | match `booked` (R16), `marks_open`, `attended` whose ticket is not locked elsewhere (R9), or a `no_show` not re-seated (R21) |
| `seat.can.remove_reasons` | `filling`/`awaiting_court` and `in`: all five desk reasons; `booked` before start and `in`: `customer_request`, `conduct`, `other`, plus `staff_error`, `duplicate` for a manager or owner; `booked` after start and `in`: `staff_error`, `duplicate` for a manager or owner; otherwise `[]` |
| `seat.can.take_share` | match `booked`/`played`, the booking live, the seat's `money.take_iqd > 0` (Money: a manual write-off can still be collected, MD-11) |
| `seat.can.write_off` | R1 roles (the PIN is proved at call time), match `booked`/`played` (C22), `now() ≥ start_at`, carrier `in`/`attended`, owes, not written off |
| `seat.can.replace` | match `booked`, after the start, the seat a `no_show` carrier (not re-seated), `now() < end_at`. `desk_add_seat` fills the lowest open number, so the operator offers "Add player here" only when this is the single open number (`operator.md` §5.13.9) |

#### 4.7.4 `desk_start_match(...)` (§1.7 args, desk)

Refusals:

1. `FORBIDDEN`.
2. `VENUE_MISMATCH`: `v := coalesce(p_venue_id, <p_court_id's branch>, app.current_venue())` is not
   `is_staff_at`.
3. `INVALID_ARGUMENT`: NULL time, length or `p_idempotency_key`; an enum; `p_gender`; the
   `p_guest_phone` format; `p_join_policy = 'approve'` without `p_customer_id` (detail
   `p_join_policy`: approve needs an account organiser).
4. Idempotency on `matches.idempotency_key` scoped to `created_by_staff_id` → `duplicate:true` /
   `IDEMPOTENCY_CONFLICT`.
5. `MATCH_SEAT_LIMIT`: `p_extra_seats` outside 0..2.
6. `GUEST_REQUIRED`: neither a customer nor a name.
7. `CUSTOMER_NOT_FOUND`: unknown or deleted customer.
8. `MATCH_BANNED`.
9. `MATCHES_OFF`.
10. `COURT_NOT_FOUND`: `p_court_id` not active at `v`. With `p_court_id` NULL the price court is the
    first active court by `sort_order, id` offering the length (`INVALID_DURATION` if none).
11. `INVALID_DURATION`.
12. `CLOSED_DATE` / `OUTSIDE_HOURS`.
13. `MATCH_TOO_LATE` (OM-43; covers the past too).
14. `MATCH_GENDER_MISMATCH` (detail `p_gender`): in a gendered category, a linked customer's declared
    gender, or `p_gender` for a typed customer, an undeclared customer and the extra seats, must be
    the category's.
15. `[lock]` LS.
16. Idempotency again (R24).
17. `SLOT_TAKEN`.
18. `MATCH_SLOT_FULL`.
19. `NO_RATE`.

No horizon, degraded, OM-37 or time-clash check: the desk is online and vouches. Writes: the match
(`filling`, `organised_by 'desk'`, `created_by_staff_id` = caller, `organiser_id` = the customer or
NULL, `sandbox false`); seat 1 `desk`, linked (`guest_id`, gender from the profile or `p_gender`) or
typed (`guest_name`, `guest_phone`, `p_gender`); `p_extra_seats` more nameless `desk` seats with
`p_gender`; no tickets; event `started` (staff); audit `match.desk_start`. Returns `{duplicate,
match_id, status, share_token, seats[], price_iqd, shares_iqd, fill_deadline_at}`; the desk shows
the server's price, not its own (§4.2 item 9 of the rules review).

#### 4.7.5 `desk_add_seat(...)` (§1.7 args, desk)

Refusals:

1. `FORBIDDEN`.
2. `MATCH_NOT_FOUND`.
3. `VENUE_MISMATCH`.
4. `INVALID_ARGUMENT` (incl. a NULL `p_idempotency_key`).
5. `claim_replay(p_idempotency_key, 'desk_add_seat')` (0049:68) → `duplicate` /
   `IDEMPOTENCY_CONFLICT`.
6. `GUEST_REQUIRED`.
7. `CUSTOMER_NOT_FOUND`.
8. `MATCH_BANNED`.
9. `MATCH_ALREADY_IN`: the customer already holds a carrier here.
10. `MATCH_GENDER_MISMATCH`.
11. `MATCH_NOT_FILLING`: terminal; `filling` past its deadline; `booked` at or after `end_at`.
12. `MATCH_FULL`: `awaiting_court`, or no number open for the desk.
13. `[lock]` L2+M; re-check 9, 11, 12.

Writes a `desk` seat on the lowest free number (filling) or the lowest number open for the desk
(booked, §3.2). On a booked match (R4, R21): a `left_late` carrier becomes `refilled` and its
ticket is released, or restored when the start already forfeited it; a `no_show` carrier after
start keeps its status and forfeit (the walk-in takes its number, `replaces_seat_id` = it). Event
`joined` (staff) and `refilled` where one applies; `match_try_book` at 4; audit
`match.desk_add_seat`; `finish_replay`. `MATCHES_OFF` does not apply (R10). Returns `{duplicate,
seat_id, seat_no, match_status, replaced_seat_id, reservation_id}`.

#### 4.7.6 `desk_remove_seat(p_seat_id, p_reason)` (desk; §1.7 roles for the booked cases)

**Reason form** (`operator.md` §5.13.8, binding here): `desk_remove_seat`, `desk_cancel_match` and
`set_match_ban` accept `p_reason` as `<code>` or `<code>: <note>`. The server validates the code
before the first `': '`, stores only the code on the row, the event and the flag label, keeps the
whole text in the audit row (R35's optional note), and refuses a note over 200 characters
(`INVALID_ARGUMENT` detail `p_reason`). Signatures stay as §1.7.

Refusals:

1. `FORBIDDEN`.
2. `REASON_REQUIRED`: the code is not a desk remove reason.
3. `SEAT_NOT_FOUND`.
4. `VENUE_MISMATCH`.
5. The seat already ended by staff with the same outcome → `duplicate:true`.
6. `INVALID_TRANSITION`, detail `marked` (`attended`/`no_show`: undo the mark first), `ended` (any
   other non-`in` status), `match_ended` (terminal match), `use_attendance` (booked, after start,
   reason not `staff_error`/`duplicate`).
7. `FORBIDDEN` detail `manager_required`: `staff_error`/`duplicate` on a booked match by court_desk.
8. `[lock]` L1+M; re-check.

| Match | Reason | Seat | Ticket | Share (Money) |
| --- | --- | --- | --- | --- |
| filling / awaiting | any | `removed` (`removed_by_staff`); `conduct` adds an exclusion | released | none |
| booked, before start | `customer_request`, `conduct`, `other` | `left_late` (`removed_by_staff`); `conduct` adds an exclusion | stays locked; forfeited at start unless refilled | open until refilled, then the refill's |
| booked, any time | `staff_error`, `duplicate` (manager, owner) | `removed` (`removed_by_staff`) | released | vacant: written off after start unless refilled |

An `account` seat takes the holder's friend seats with it. Then an awaiting match returns to
`filling`, `match_recompute_organiser`, event `removed` (code = reason), audit
`match.desk_remove_seat`. Returns `{duplicate, removed:[{seat_id,status}], match_status,
ticket:'released'|'locked_until_refill'|'none'}`.

#### 4.7.7 `desk_cancel_match(p_match_id, p_reason)` (desk)

`FORBIDDEN` → `REASON_REQUIRED` (the code is not a desk cancel reason) → `MATCH_NOT_FOUND` →
`VENUE_MISMATCH` → already `cancelled`/`staff_cancelled` → `duplicate:true` → `MATCH_NOT_FILLING` (booked: cancel the booking
and the trigger follows; terminal) → `[lock]` L1 → `match_end(id,'cancelled','staff_cancelled',
'staff')`; audit `match.desk_cancel` (reason). Returns `{match_id, status:'cancelled', duplicate}`.

#### 4.7.8 `mark_match_seats(p_seat_ids, p_attendance)` (desk)

`p_attendance` is `attended`, `no_show` or `in` (the undo, R9).

Refusals:

1. `FORBIDDEN`.
2. `INVALID_ARGUMENT`: a bad `p_attendance`; 0 or more than 4 ids; a duplicate id; seats of more than
   one match.
3. `SEAT_NOT_FOUND`.
4. `VENUE_MISMATCH`.
5. `MATCH_NOT_BOOKED`: the match is not `booked`, `played` or `no_show`.
6. `INVALID_TRANSITION` detail `not_carrier`: a seat is `left_late`, `refilled`, `removed`, `left`
   or `cancelled`.
7. `SEAT_MARK_LOCKED` detail `replaced`: a `no_show` whose number was re-seated (R21), to `attended`
   or `in`.
8. `SEAT_MARK_LOCKED` detail `match_ended`: `in` (undo) on a match that is not `booked` (R16).
9. `SEAT_NOT_STARTED`: `no_show` before `start_at`.
10. `SEAT_MARK_LOCKED` detail `paid`: `no_show` on a seat with payment links (C18).
11. `SEAT_MARK_LOCKED` detail `day_closed`: `match_marks_open` is false.
12. `[lock]` L2+M; re-check 5–11; lock every `available` ticket the call will touch in one
    `id`-ordered statement; then per seat (a seat already in the target state is a no-op):

| From → to | Ticket (account and friend seats) | Refusal when it cannot |
| --- | --- | --- |
| `in` → `attended` | `ticket_release` (code `attended`) | — |
| `in` → `no_show` | `ticket_forfeit` | — |
| `attended` → `no_show` | `ticket_forfeit` of the seat's own ticket if it is `available`; already forfeited by this seat: nothing | `SEAT_MARK_LOCKED` `ticket_used` when that ticket is now reserved or in use elsewhere |
| `attended` → `in` | `ticket_lock([T],[seat])` | `SEAT_MARK_LOCKED` `ticket_used` |
| `no_show` → `attended` | `ticket_restore(T, seat)` | — |
| `no_show` → `in` | `ticket_restore(T, seat, true)` | — |

Then, in this order (C17): the seats' `marked_at`/`marked_by_staff_id` (cleared on `in`); the match;
the booking. Under the booking row lock that `match_lock` already holds:

- The first `attended` while the booking is `confirmed` → booking `arrived`.
- No carrier `in` or `attended` and at least one `no_show`, on a `booked` match →
  `match_end(…,'no_show','all_no_show','staff')`, then the booking → `no_show`, `cancelled_at =
  now()`, `cancellation_reason 'all_no_show'` (a direct update; `mark_reservation` refuses it).
- A correction out of an all-no-show match → the match back to `booked` (`ended_at`,
  `ended_reason` NULL), then the booking → `arrived`, `cancelled_at` and `cancellation_reason` NULL.
  The row re-enters the exclusion set: a court re-sold since raises `exclusion_violation` →
  `SEAT_MARK_LOCKED` detail `court_reused`.
- A `played` match stays `played` whatever the corrections.

Events `seat_attended` / `seat_no_show` / `seat_unmarked` (`{reopened: true}` on a reopening);
audit `match.mark_seats`. Returns `{match_id, match_status, reservation_status, seats:[{seat_id,
status, ticket_status}]}`.

#### 4.7.9 `desk_call_off_short(p_match_id)` (desk, OM-47, R12)

Refusals:

1. `FORBIDDEN`.
2. `MATCH_NOT_FOUND`.
3. `VENUE_MISMATCH`.
4. Already `cancelled` (`called_off_short`) → `duplicate:true`.
5. `MATCH_NOT_BOOKED`.
6. `MATCH_NOT_STARTED` (`now() < start_at`).
7. `SEAT_MARK_LOCKED` detail `day_closed`.
8. `MATCH_MARK_SEATS`: a carrier is still `in` (every markable carrier must be marked, R12).
9. `INVALID_TRANSITION` detail `not_short`: no carrier is `no_show`, and none is `left_late` (after
   start, a `left_late` carrier counts as absent: it cannot be marked and its ticket is already
   forfeited, §8 D-3).
10. `INVALID_TRANSITION` detail `nobody_came`: no carrier is `attended`.
11. `[lock]` L2+M; re-check.

Writes, in order: `match_end(…,'cancelled','called_off_short','staff')` (it forfeits unrefilled
late leavers' tickets and expires requests); the booking → `cancelled`, `cancelled_by 'staff'`,
`cancellation_reason 'called_off_short'`, `cancelled_at` (a direct update under the row lock; the
trigger finds the match terminal); audit `match.call_off_short`. Attended tickets were released at
their mark and no-show tickets forfeited at theirs. Nothing is owed (the booking is not live);
money already taken is Money's refund-due line. Returns `{match_id, status:'cancelled',
reservation_status:'cancelled', attended, no_show}`.

#### 4.7.10 `set_match_ban(p_customer_id, p_banned, p_reason)` (manager, owner)

`FORBIDDEN` → `INVALID_ARGUMENT` (`p_banned` NULL; a note over 200 characters) →
`CUSTOMER_NOT_FOUND` (unknown or deleted) → `REASON_REQUIRED` (a ban whose reason is not `conduct`,
`no_shows`, `reported` or `other`, R35; the §4.7.6 reason form) → the same state →
`duplicate:true`. A ban inserts `customer_flags(customer_id, 'match_ban', label = <the code>,
created_by = caller)`; a lift deletes it (reason optional). Audit `customer.match_ban` with
`{banned, reason}` and the whole reason text (the note lives only in the audit row). No match lock: from the next statement `match_guest(true)` and every approval
refuse; `match_try_book` drops the player's seats before counting (R18); the sweep removes their
filling seats and expires their requests; booked seats are left to the desk. The ban is chain-wide,
as `customer_flags` is (§1.2). Returns `customer_flags_json(p_customer_id)` plus `{banned}`.

#### 4.7.11 `staff_set_customer_gender(p_customer_id, p_gender)` (desk)

`FORBIDDEN` → `INVALID_ARGUMENT` (not `female`, `male` or NULL) → `CUSTOMER_NOT_FOUND` → the same
value → `duplicate:true`. Writes `gender`, `gender_set_at`, `gender_set_by 'staff'` (all NULL when
cleared); audit `customer.gender_set` without the value, as `set_my_gender` (0256): before
`{gender_set_by, had_gender}`, after `{gender_set_by, cleared}`, because `audit_log` is append-only and
outlives an account deletion (R29). Seats keep the gender stamped when they were taken. Returns
`{customer_id, gender, gender_set_by, duplicate}`.

#### 4.7.12 `match_reports_open(p_venue_id)`, `resolve_match_report(p_report_id, p_outcome)` (manager, owner)

`match_reports_open`: R33 order (`is_staff('manager','owner')` first, then the venue, then
`is_staff_at`). Open reports of the branch, oldest first (D24):

```json
[{ "report_id","reason","created_at",
   "match": {"id","start_at","category","status","reservation_id"},
   "reported": {"customer_id","full_name","phone","flags","banned","reports_90d","no_shows"},
   "reporter": {"customer_id","full_name"} }]
```

`resolve_match_report`: `FORBIDDEN` → `INVALID_ARGUMENT` (not `dismissed|banned`) →
`REPORT_NOT_FOUND` (unknown or outside visible branches) → `VENUE_MISMATCH` → the same outcome again
→ `duplicate:true` → `REPORT_CLOSED`. `dismissed` → status `dismissed`; `banned` → `actioned` plus
the §4.7.10 ban with reason `reported`. Stamps `reviewed_by`, `reviewed_at`; audit
`match.report_resolve`. Returns `{report_id, status, duplicate, banned}`.

#### 4.7.13 Re-issues (DB)

| Function | From | Change |
| --- | --- | --- |
| `mark_reservation` | 0089:42 | same signature. After `RESERVATION_NOT_FOUND`, before the transition check: `p_status = 'no_show'` on a reservation that is any match's `reservation_id` → `MATCH_MARK_SEATS`, whatever the match's status (an offline `reservation.update` replay can never forfeit four people in one click). `arrived` and `completed` stay allowed; `completed` fires trigger A. |
| `set_customer_flags` | 0242:1746 | the validation loop refuses a `match_ban` element (`INVALID_FLAG` detail `match_ban`, hint "use set_match_ban"); the delete becomes `… and type <> 'match_ban'`, so a desk flag edit or an older build can never lift a ban |
| `customer_counts` | 0065:170 | `noShows` adds non-sandbox `no_show` seats with `guest_id = p` (DF-12, DF-15); gains `matchesPlayed` (distinct non-cancelled matches with an `attended` account or desk seat), `matchNoShows`, `lateLeaves` (unrefilled `left_late` seats) |
| `customer_directory` | 0148:42 | its inline no-show count adds the same seat term |
| `customer_record` | 0065:272 | `customer` gains `gender`, `gender_set_by`; adds `matches` (last 20: `{match_id, reservation_id, venue_id, status, start_at, end_at, category, seat_status, kind}`). Tickets stay in Money's `guest_tickets`. The ban shows through `flags`. |
| `customer_search` | 0077:317 | each row gains `gender` |

All return `jsonb` or `setof jsonb`, so `create or replace` keeps them single-signature.

#### 4.7.14 Money's part of this file (interface)

The engine `match_money` with `match_seat_money` and `court_fee_written_off` (created here, not in
0260, §4.5.6; `desk_match_detail` above reads them),
`match_seat_settle`, `match_link_payment`, `match_seat_write_off` (R1 signature and roles), the
re-issues of `court_fee_remaining`, `compute_tab_totals`, `booking_bill`, `booking_bill_states` (its
rows limited to the branches in `app.visible_venue_ids()`, as `desk_match_states` and `booking_bill`'s
`VENUE_MISMATCH`: review 2026-09-29), and
the DF-16 wall (R20: a guard trigger on `orders` and `tab_adjustments` that probes
`matches_reservation_key` and refuses `MATCH_BOOKING_NO_CAFE`). Each money writer takes
`lock_match_money` in the §2.1 rank and reads `match_carriers` for its seat rules.

| Gate | In this commit |
| --- | --- |
| Matrix | inline `ex('guarded', {anon:'denied', court_desk:'execute', manager:'execute', owner:'execute'})` (the `mark_reservation` row form) with nil ids for `desk_open_matches`, `desk_match_states`, `desk_match_detail`, `desk_start_match`, `desk_add_seat`, `desk_remove_seat`, `desk_cancel_match`, `mark_match_seats`, `desk_call_off_short`, `staff_set_customer_gender`; `MANAGER_UP` for `set_match_ban`, `match_reports_open` (args `{p_venue_id: VENUE_A}`), `resolve_match_report`; Money's three rows |
| Allowlist | the 13 in `guarded` (+ Money's 3); floor |
| Coverage | the 13 `map:action` |
| SEC-20 | none |
| Codes | operator `MAPPED_CODES` + `op.errors.*` in `opErrors.matches.en/ar.ts` (created by Money's 0259): `MATCHES_OFF`, `MATCH_NOT_FOUND`, `MATCH_NOT_FILLING`, `MATCH_NOT_BOOKED`, `MATCH_NOT_STARTED`, `MATCH_FULL`, `MATCH_TOO_LATE`, `MATCH_SLOT_FULL`, `MATCH_GENDER_MISMATCH`, `MATCH_SEAT_LIMIT`, `MATCH_BANNED`, `MATCH_MARK_SEATS`, `MATCH_ALREADY_IN`, `SEAT_NOT_FOUND`, `SEAT_NOT_STARTED`, `SEAT_MARK_LOCKED`, `REPORT_NOT_FOUND`, `REPORT_CLOSED`, plus Money's. One key per detail the panels show: `SEAT_MARK_LOCKED` `day_closed`, `ticket_used`, `court_reused`, `replaced`, `paid`, `match_ended`; `INVALID_TRANSITION` `marked`, `ended`, `match_ended`, `use_attendance`, `not_carrier`, `not_short`, `nobody_came`; `FORBIDDEN` `manager_required` (G7c). `MATCH_MARK_SEATS` joins the operator's `OVERRIDE_REFUSAL_CODES` |
| Lock gate | the walker prints the §2.5 sequences for the new bodies |

### 4.8 0263 `match_reservation_triggers` (DB)

#### 4.8.1 `app.trg_reservation_match()`, trigger `reservations_match`

```sql
create trigger reservations_match
  after insert or update of kind, status, court_id, start_at, end_at on reservations
  for each row when (new.kind in ('booking','maintenance'))
  execute function app.trg_reservation_match();
```

One trigger for both jobs, so the gate expands one body per reservation write. The `WHEN` keeps
every hold write out at runtime. The body saves `app.venue_id`, sets it to `new.venue_id` before any
match write (a staff member confirming their own hold passes the guard), and restores it on every
exit.

**Part A, cascade** (UPDATE only; errors propagate, so a desk cancel either cascades or fails with a
mapped code, never half-done):

1. `select … from matches where reservation_id = new.id` (unique index). None → Part B.
2. `lock_match_venue(new.venue_id)` (blocking); re-read. Status not `booked` → Part B (call-off,
   all-no-show and sandbox already wrote the match).
3. Status changed:
   - → `cancelled`: `match_end(id, 'cancelled', 'reservation_cancelled', <actor>)`, the actor being
     `'staff'` when `new.cancelled_by = 'staff'`, else `'system'`.
   - → `no_show`: raise `MATCH_MARK_SEATS` (the legitimate path ends the match first).
   - → `completed`: `match_end(id,'played',null, …)` (auto-attend, R37).
   - → `arrived`, `confirmed`: nothing.
4. `court_id`, `start_at` or `end_at` changed: copy `start_at`, `end_at`, `duration_min` to the
   match; event `moved` (`{court_id}`). The shares stay stamped (DF-4).

**Part B, bump** (never waits; swallowed; the sweep is the backstop):

1. Return unless the row is **newly firm or moved**: INSERT, or `old.kind` differs, or `old.status`
   was not live, or `court_id`/`start_at`/`end_at` changed; and `new.status in
   ('pending','confirmed','arrived')`. Holds never bump (OM-13).
2. Cheap unlocked pre-check: a non-sandbox match at `new.venue_id`, status
   `filling|awaiting_court`, `period && new.period`, `id <> nullif(current_setting('app.match_booking',
   true),'')::uuid`. None → return.
3. `begin`: `if not try_lock_match_venue(new.venue_id) then raise warning 'match bump deferred';
   return;` Then, in a **new statement** (a fresh snapshot, C14), loop over the candidates re-selected
   under the mutex, `id` order: `if not match_court_free_firm(m.venue_id, m.period, m.duration_min, 1)
   then match_end(m.id,'bumped','bumped','system')`. `exception when others then raise warning
   'match bump deferred: %', sqlerrm`.

Coverage: desk bookings, blocks and series; event blocks; guest confirms (a hold becoming a booking
bumps an awaiting match whose court it held, R22); the deposit confirm and re-create; moves and
extends into the period; another match's booking. Two filling matches with one firm-free court:
neither is bumped until one books; then the other is. When the mutex is busy (another body at the
branch holds it), the bump waits for the next sweep run; a join in between that reaches four is
bumped by `match_try_book` itself.

#### 4.8.2 R22: a waiting match keeps its court

**`app.match_court_claimed(p_court_id uuid, p_period tstzrange) returns boolean`** (stable,
internal): true when the court's branch has a non-sandbox `awaiting_court` match `M` with `M.period
&& p_period`, whose length the court offers, and the number of that branch's active courts that
offer `M`'s length and have **no live row** over `M.period` (this court included) is at most the
number of `awaiting_court` matches overlapping `M.period`. A plain read is enough: the sweep is the
backstop. As built (0263, D-13): the court itself must be one `M` could still book (active, offers
`M`'s length, no live row over `M.period`). A waiting match the sweep will not book (its branch
`is_degraded` with `M.start_at` inside `protected_horizon_hours`, sweep step 6) neither claims a court
nor counts among the waiting matches: offline the desk books there, and Part B bumps `M` when no
firm-free court is left (review 2026-09-29).

Re-issued with one check each, right after their `expire_stale_holds` call and before the insert:

| Function | From | Check |
| --- | --- | --- |
| `hold_slot` | 0252:420 (lock :559, expire :562, insert :575; the hold ladder since the 2026-09-29 sync, before it 0225:62) | `match_court_claimed(p_court_id, v_period)` → `SLOT_TAKEN` detail `match_waiting` |
| `staff_create_reservation` | 0217:1367 (lock :1438, expire :1440) | the same, for every kind it creates (series go through it) |

Both keep their signatures, grants and the rest of their bodies verbatim. Moves, extends, event
blocks and the deposit re-create are not guarded; they bump the waiting match through Part B
(§10).

#### 4.8.3 `app.match_sweep(p_venue_id uuid default null) returns jsonb` (service role)

**Phase 1, find work (no locks).** Branches (all branches, or `p_venue_id`) with any of:

- an `awaiting_court` match;
- a `filling` match past its deadline, or inside its warning window (`fill_deadline_at − 30 min`)
  and not yet warned;
- a `filling`/`awaiting_court` match with a deleted or banned holder, or that no longer fits (branch
  not active, `assert_bookable` fails, no active court offers the length, no firm-free court);
- a pending request past its cutoff (filling: deadline; booked: start) or on an ended match;
- a `booked` match before start with a carrier held by a deleted profile;
- a `booked` match at or past `start_at` with an unrefilled `left_late` carrier whose ticket is
  `in_use`;
- a `booked` match past `end_at + 3 h` (sandbox: `end_at`).

The list starts at a rotating offset, `floor(extract(epoch from now())/30)::int % count`, so no
branch is always last.

**Phase 2, per branch.** The first branch locks by blocking: `match_lock_courts(v)` →
`match_expire_holds(v, <the span of its due filling and awaiting matches>)` (none when it has only
booked work: the bounds are tested, `tstzrange(NULL, NULL)` being unbounded) → `lock_match_venue(v)`.
Every later branch: `try_lock_match_venue(v, true)` (the mutex first, then the courts, C21; all or
nothing); false → skipped this run (`venues_skipped`), holding nothing there; no hold expiry there. Then per match, each in its own `begin … exception when
others then v_errors := v_errors + 1; raise warning …; end`, at most 200 matches per run across all
branches:

1. **Requests**: pending past the cutoff (code `closed`), or on an ended match (code = its
   `ended_reason`) → `expired`, `decided_at = now()`, tickets released, event `request_expired`.
2. **Ineligible holders**, filling/awaiting: `match_drop_ineligible`; an awaiting match left with
   fewer than four carriers goes back to `filling` (as `match_try_book` step 3; step 6 may not run
   offline). Booked before start: a
   deleted holder's carriers → `left_late` (`account_deleted`); their tickets are released at start,
   never forfeited (R18). A banned holder's booked seats are left to the desk.
3. **Fit backstop**, filling/awaiting: branch not active or `assert_bookable` fails →
   `cancelled` (`venue_closed`); no active court offers the length → `bumped` (`no_court`); no
   firm-free court → `bumped` (`bumped`).
4. **Deadline**: `filling` and `now() ≥ fill_deadline_at` → `expired` (`deadline`).
5. **Warning**: `filling`, inside the window, `deadline_warned_at` NULL → event `deadline_warning`
   (`{seats_taken}`), stamp.
6. **Awaiting**: `now() ≥ start_at` → `expired` (`no_court`); else, unless `is_degraded(v)` with the
   start inside the protected horizon, `match_try_book`.
7. **Start**: `booked`, `now() ≥ start_at`: every unrefilled `left_late` carrier whose ticket is
   `in_use` → `ticket_forfeit` (code `late_leave`; a deleted holder's is released).
8. **End**: `booked`, `now() ≥ end_at + 3 h` (sandbox: `end_at`): when at least one carrier is `in`
   or `attended` → `match_end(…,'played',null,'system')` (auto-attend, R37); else →
   `match_end(…,'no_show','all_no_show','system')`. The booking row is never written by the sweep.

**Phase 3, chain-wide** (only when `p_venue_id` is NULL, D-14), each step in its own exception block: Money's
`ticket_refund_deleted(null)` (DF-20; it skips purchases that are not `succeeded`, have a ticket
`reserved`/`in_use`, or a forfeited ticket still restorable by `match_marks_open`, R13); then
`delete from match_reports where created_at < now() - interval '12 months'` (R36).

Every step selects only rows that still need the change, and every change is one-way or a stamp,
so a second run in the same second does nothing. Returns:

```json
{ "venues_swept":1,"venues_skipped":0,"booked":0,"awaiting_expired":0,"bumped":0,"expired":0,
  "cancelled":0,"warned":0,"requests_expired":0,"left_deleted":0,"removed_banned":0,
  "forfeited":0,"played":0,"no_show":0,"refunds_started":0,"reports_purged":0,"errors":0 }
```

#### 4.8.4 Cron `tp_match_sweep`

`'30 seconds'` with the per-minute fallback, in the guarded `do` block of 0242:1811-1822; command
`select app.match_sweep();`. After the hosted push, check that `cron.job` has the row
(`packages/db/CLAUDE.md`, "After a hosted push").

| Gate | In this commit |
| --- | --- |
| Matrix, allowlist | none new (`hold_slot` and `staff_create_reservation` keep their rows and grants; `match_sweep` is service role) |
| Coverage | `trg_reservation_match`, `match_court_claimed`, `match_sweep` `excluded: service_role only — …`; cron `tp_match_sweep` `map:system` |
| SEC-20 | none |
| Codes | `SLOT_TAKEN` (mapped on both clients); the operator's detail sentence for `match_waiting` ("an open match with four players is waiting for this court") |
| Lock gate | the walker now expands the trigger under every `reservations` writer; the static replay found only `deposit_apply`, fixed by Money's hoist in 0258; `lock-order-matches.test.ts` adds the `deposit_apply` assertion; `match_sweep` is walked |
| Other | `check:safeupdate` (every UPDATE and DELETE above has a WHERE); two-connection test (§7) |

### 4.9 0264 `match_account_deletion` (DB)

`delete_my_account` re-issued once, from 0077:120, verbatim plus, before the audit row (R25):

- the profile UPDATE (0077:187-192) also nulls `given_name`, `family_name`, `gender`,
  `gender_set_at`, `gender_set_by` (the 0256 trigger does it too; explicit here);
- `update match_seats set guest_name = null, guest_phone = null, gender = null where guest_id =
  v_uid` (outside the mutex, §2.1);
- `update match_requests set friend_genders = null where guest_id = v_uid` (R29);
- `delete from match_blocks where blocker_id = v_uid or blocked_id = v_uid`;
- the audit `after` gains `match_seats_scrubbed`, `match_requests_scrubbed`, `match_blocks_deleted`;
- last, `begin perform app.ticket_refund_deleted(v_uid); exception when others then raise warning
  …; end` (Money; D3): it refunds each succeeded purchase with no ticket reserved, in use or still
  restorable. A deletion never fails on a refund; the sweep retries.

The body takes no match lock and no court lock (R25, D1). Kept on purpose, pointing at the
tombstone: `match_reports` (until the R36 purge), `match_events`, `match_tickets`,
`match_ticket_events`, `match_exclusions`. The sweep finishes DF-20: it leaves the filling seats
(tickets released), turns booked seats before start into late leaves whose tickets are released at
start (R18), withdraws the requests, and refunds each purchase once it is free.

As built (0264, D-15, D-16): the refund call sits after the three match statements, before the
audit row and the `auth.users` delete; the scrubs touch only rows that still hold a value. The
`notification_outbox` delete (0077's, before the match scrubs there) moves after the three match
statements (review 2026-09-29): a mutex holder ending a match writes its seats, then deletes that
match's reminders through the `match_events` push trigger (`match_sync_reminders`), so the deletion
takes seats before outbox rows too and cannot close a 40P01 cycle with it. A seat-against-seat
inversion (a player holding two seats of one match that `match_end` updates in a different row order)
is not ruled out by this order and is left to the deadlock detector (one side retries). Open
(0263's sweep, not this body): `match_drop_ineligible` acts on filling and waiting matches only, so
a deleted player's pending request on a **booked** match stays pending until the start, then
expires `closed` (step 1), and its purchase is refunded by the next chain-wide run.

| Gate | In this commit |
| --- | --- |
| Matrix, allowlist, coverage | unchanged (same signature) |
| SEC-20 | the deletion proof (R29, G5e) also creates a linked match seat with `gender` set, a pending request with `friend_genders`, and a block each way; it asserts `match_seats.gender` and `match_requests.friend_genders` are NULL after deletion; the `'row'` list gains `['match_blocks','blocker_id']` and `['match_blocks','blocked_id']` |
| Codes | none new |
| Lock gate | the walker prints the §2.5 sequence |

## 5. Interfaces with the other lanes

### 5.1 Money

**DB calls in Money:** `match_money` and `match_seat_money` (`desk_match_detail`);
`ticket_refund_deleted` (the sweep's Phase 3; `delete_my_account`).

**Money calls in DB:** `lock_match_money`; `match_lock` (write-off); `match_carriers` (one carrier
rule, R21); `match_marks_open` (the "still restorable" test of cash-out and DF-20, R13);
`match_terms_ok` (optional, see §4.3). Money reads `matches` and `match_seats` without locks;
drift surfaces as `SEAT_OWED_CHANGED`.

**Money relies on these seat states:**

| Carrier state | Owes at the desk | Written off |
| --- | --- | --- |
| `in` or `attended` (booked or played) | the full `share_iqd` | — |
| `no_show` (not replaced) | nothing | `share_iqd` |
| `left_late`, before start | nothing yet (open) | — |
| `left_late`, after start | nothing | `share_iqd` |
| vacant number, after start | nothing | `share_iqd` |
| any seat of a `cancelled` (incl. `called_off_short`), `bumped` or `expired` match | nothing | — |
| any seat of a sandbox match | nothing, never in a figure | — |

The booking's `price_iqd` equals `matches.price_iqd` and Σ `shares_iqd` at booking; a later
difference is DF-4's booking line.

**The tickets table (DB's DDL, D3):** Money inserts rows (`available`, with `sandbox` = the
purchase row's flag, event `bought`) and writes `cashed_out` with `cashout_payment_id =
purchase_payment_id` (CHECK). Cash-out and DF-20 lock only `available` rows after an unlocked
`TICKET_IN_USE` pre-check (D17, C15); DF-20 uses `skip locked` and skips purchases that are not
`succeeded` (R13).

**Required of Money's 0258 re-issues:** the hold-expiry hoist in `deposit_settle_success` (R15)
and the `refund_failed`-only rule in `deposit_refund_manual` (R23).

### 5.2 Guest

- **0256** is Guest's file on DB's contract (§4.2).
- **0261** carries Guest's `match_notify` and `match_sync_reminders` bodies and the two AFTER
  INSERT triggers that call them (R26, `guest.md` §4.6); the D28 placement of the bodies in 0260 is
  dropped, and nothing in 0260 depends on them.
- **DB never calls `match_notify` or `match_sync_reminders`.** The Guest trigger on `match_events`
  is their only caller for match events; it calls `match_sync_reminders` on the event types its
  table marks "resync" (`guest.md` §4.6.3: `joined`, `left`, `left_late`, `removed`, `refilled`,
  `booked`, `moved` and every terminal type, `called_off_short` included). This is how "the
  callers of `match_sync_reminders` are named there" (R26) is met; it replaces the D27 wording that
  had DB call it.
- **What DB promises the trigger:** one `match_events` row per transition of §3, written in the
  same transaction as the change, with `actor` and its ids, `seat_id` (the account seat, or the one
  seat), `request_id`, `code`, and `data` holding `seats`, `seats_taken` and the other §4.4.6 keys;
  one `match_ticket_events` row per ticket move. Types without a push (`seat_attended`, `played`,
  `seat_unmarked`, `called_off_short`, `withdrawn`) are still written.
- **Read shapes** are §4.6.12, with the D11–D17 picks applied.

### 5.3 Operator

- Reads and `can` flags: §4.7.1–4.7.3, in the shapes of `operator.md` §5.6 (D12, D18–D20); codes
  and details: §4.7.14's table; the reason form: §4.7.6.
- The booking's `guest_name` literal is exactly `'Open match'` (`MATCH_RESERVATION_NAME`).
- Bumps happen in a trigger; the operator learns of them from `desk_open_matches` and the
  `slot_changed` broadcast (0224).
- `match_seat_write_off` (Money) follows R1; `can.write_off` in §4.7.3 matches it.

## 6. Situations we must survive

| # | Situation | What happens |
| --- | --- | --- |
| 1 | The 3rd and 4th joiners of a 2/4 match tap in the same second | Both take `match_lock`. The first takes seat 3; the second takes seat 4 and books. The unique `(match_id, seat_no)` index is the backstop. |
| 2 | Two players race for the last seat (4th, or a booked refill) | Serialised by the courts and the mutex; the loser's re-check under the lock → `MATCH_FULL`. No ticket moves for them. |
| 3 | A group books the last free court while the match is at 3/4 | Trigger B bumps it: tickets released, requests expired. |
| 4 | A hold is on the last court when the 4th joins | `awaiting_court` (DF-18). The hold confirms → trigger B bumps it. The hold lapses → the next sweep books it. |
| 5 | A fresh hold tries to take the court a waiting match needs | `hold_slot` refuses `SLOT_TAKEN` (`match_waiting`) (R22, C9). |
| 6 | A hold lands on the last court while the match is at 3/4 | Nothing: holds never bump (OM-13). |
| 7 | Two tills book courts A and B (the last two) at once | Both triggers try the mutex. The one that gets it re-selects in a new statement; if it sees the other's booking committed, it bumps. Otherwise the second is deferred and the next sweep bumps. Exactly one bump, never two (`match_end` is a no-op on a terminal match). A two-connection test covers it. |
| 8 | The desk books the last court while the 4th player is joining | Whoever holds the court locks first wins. Desk first: the join re-reads under L2 and books nothing (bumped or `MATCH_CLOSED`). Join first: the match is booked, and the desk gets `SLOT_TAKEN` only on that same court. |
| 9 | An event block (no court lock) inserts on a court while a 4th join holds every court | Trigger B only try-locks the mutex, so it never waits on the join; the join may wait on the block's uncommitted row. No cycle. The bump, if due, comes from the sweep. |
| 10 | Two filling matches, one free court | OM-42 refuses the second start. If courts were lost later, the first to fill books and trigger B bumps the other. |
| 11 | A match is waiting when another reaches four at the same branch and time | `match_try_book` serves the waiting one first (R22). |
| 12 | The organiser cancels while the 4th joins | The mutex orders them: `MATCH_CLOSED` for the join, or `MATCH_BOOKED` for the cancel. |
| 13 | Approval at deadline − 1 s while the sweep expires the match | Both take the branch locks; the approval checks the deadline under the lock. |
| 14 | A requester withdraws while the organiser approves | The mutex orders them; the loser gets `REQUEST_CLOSED`; the reserved tickets move once. |
| 15 | The desk undoes Sara's `attended` after her ticket was reserved for a request elsewhere | `ticket_lock` takes a reserved ticket only for its own request → `SEAT_MARK_LOCKED ticket_used`; her request is untouched (R17, C3). |
| 16 | Undo pressed on a `played` match | `SEAT_MARK_LOCKED match_ended`. Corrections `attended ↔ no_show` stay possible while the day is open; no ticket is ever `in_use` on a terminal match (R16, C2). |
| 17 | An approve-mode match fills through desk seats | `match_try_book` expires every pending request and releases their tickets. |
| 18 | A player leaves a booked match and it is refilled online | `left_late` → `refilled`; the leaver's ticket is released in the refill's transaction (OM-11). |
| 19 | A late leaver's ticket was forfeited at start, then the desk seats a walk-in in that place | `desk_add_seat` restores it (`restored`); the leaver loses nothing. |
| 20 | Nobody comes for seat 2; the desk marks no-show and seats a walk-in there | R4: the walk-in takes number 2 (`replaces_seat_id` = the no-show). The no-show keeps its forfeit and count; its undo is refused `SEAT_MARK_LOCKED replaced` (R21, C8). |
| 21 | A booking-level no-show from the old dialog, replayed offline | `mark_reservation` → `MATCH_MARK_SEATS`; no ticket moves. |
| 22 | The desk marks a no-show, then corrects it to attended the same day | `ticket_restore`. |
| 23 | The desk marks attended, the player spends the ticket elsewhere, then the desk tries no-show | `SEAT_MARK_LOCKED ticket_used`. |
| 24 | A seat that already paid is marked no-show | `SEAT_MARK_LOCKED paid`: refund at the till first (C18). |
| 25 | All four seats are marked no-show | Match `no_show`, booking `no_show`. A correction the same day reopens both, unless the court was re-sold (`court_reused`). |
| 26 | Call-off pressed with one seat unmarked | `MATCH_MARK_SEATS` (R12, C11). |
| 27 | Three came, one left late and nobody took the seat | Short: the desk may call off (the late leaver's ticket is forfeited by `match_end`) or play. |
| 28 | The desk cancels a booked match's reservation | Trigger A: `cancelled` (`reservation_cancelled`); `in` tickets released, no-show tickets restored, late leavers' released or restored. A failure aborts the cancel. |
| 29 | The desk moves a booked match earlier than its old fill deadline | Times copied; `matches_deadline` binds only while filling. |
| 30 | The desk moves another booking into a filling match's period | Trigger B bumps the match if no firm-free court is left. |
| 31 | A deposit webhook re-creates a swept hold as a booking on the last court | Trigger B bumps, or defers to the sweep; the webhook succeeds either way. `deposit_apply` passes the lock gate because Money hoisted its hold expiry. |
| 32 | The sweep holds branch V while the desk's `cancel_reservation` holds a booked match's row | The sweep never locks a booking row; the cancel's trigger waits for the mutex and then commits. |
| 33 | The sweep, done with branch A, reaches branch B while a join at B holds B's courts | B is try-locked, fails, and is skipped this run. |
| 34 | L2 expires holds on two courts while `tp_hold_sweep` runs | One statement per branch in `id` order, the cron's order: they queue, no 40P01 (C12). |
| 35 | A staff member at branch A joins a match at A while branch B has stale holds in the same period | Hold expiry is branch-scoped, so the guard never sees B's rows. |
| 36 | Omar deletes his account at 19:00:05; Lina takes the 4th seat at 19:00:12 | `match_try_book` drops Omar's seats first (R18, C5): 3/4, still filling; his ticket is released and later refunded. |
| 37 | A player deletes their account while in two filling matches and one booked match | Names scrubbed at once. Each branch's sweep leaves the filling seats and turns the booked seat into a late leave; its ticket is released at start, not forfeited (R18). Each purchase is refunded once it is free (R13). |
| 38 | A manager bans a player with seats in filling matches | `MATCH_BANNED` from the next call; `match_try_book` and the sweep drop the seats; requests expire. Booked seats are left to the desk; a desk flag edit keeps the ban. |
| 39 | The organiser leaves a filling match | Handover to the earliest account carrier. Only walk-ins left → organiser NULL, policy `open`, requests expired. Nobody left → `cancelled` (`empty`). |
| 40 | The organiser removes a player, who opens the link again | Tickets released; the exclusion makes the join `MATCH_UNAVAILABLE`; the player sees the match as `removed`. |
| 41 | A player tries to join two overlapping matches | The second is refused `MATCH_TIME_CLASH` (C15). |
| 42 | A double tap on Start | The second waits on the courts, then finds the key under the mutex → `duplicate:true` (R24, C13). |
| 43 | The App Review account fills a sandbox match to 4/4 | `booked` with no reservation; auto-attended at `end_at`; invisible to staff and to real users (DF-19). Its profile's sandbox flag cannot be flipped while it holds tickets (C20). |
| 44 | A rate rule changes between quote and start | `PRICE_CHANGED` with both figures. |
| 45 | A start 2 h 30 before play with a 120-minute deadline | `MATCH_TOO_LATE` (detail 180). |
| 46 | The till goes stale with offline mode on | Guest start, join, request and approve inside the protected horizon → `DEGRADED_LOCKOUT`; leave, withdraw and cancel work; the sweep does not book a waiting match there. |
| 47 | The owner switches matches off while two matches fill | No new starts, joins, requests or approvals; the desk may still add seats; the matches run to their end (R10). |
| 48 | A court is deactivated, or a closed date is added | The sweep bumps (`no_court`) or cancels (`venue_closed`); tickets released. |
| 49 | A player with one ticket joins with a friend | `NEED_TICKETS` detail `{"needed":2,"available":1,"buy":1}`; nothing written. |
| 50 | A manager cashes out tickets while the same player joins | The pick locks `available` rows in `id` order; cash-out, after its unlocked pre-check, does the same. One wins; the other gets `NEED_TICKETS` or `TICKET_IN_USE`. |
| 51 | Two desk clerks mark the same seat | L2+M serialises them; the second is a no-op or the next transition. |
| 52 | A staff member confirms their own hold in the app | The trigger asserts `app.venue_id`, so the guard passes. |

## 7. Tests (`packages/db/tests`)

| File | Covers |
| --- | --- |
| `matches-lifecycle.test.ts` | start → join to 4 → booked (`guest_id` NULL, 'Open match', the stamped price); awaiting then booked by the sweep, bumped on confirm; a waiting match served first; deadline expiry; handover, desk-only organiser NULL, `empty`; OM-37, OM-20, `SEAT_HOLDER_REQUIRED`, `MATCH_TIME_CLASH`; approve, decline, withdraw and expiry with ticket counts; leave while filling versus booked; refills online and at the desk, before and after start; OM-44; OM-42; OM-43; `PRICE_CHANGED`; `NEED_TICKETS` detail; idempotency with a double tap |
| `matches-tickets.test.ts` | every §3.5 row; the CHECKs; FIFO pick and sandbox isolation; R17 (a reserved ticket moves only for its request; release, forfeit and restore skip a mismatched pair); R18 (a deleted owner's ticket is released, not forfeited); a cash-out racing a join; the invariant "no ticket `in_use` or `reserved` on a terminal match", asserted after every case |
| `matches-bump.test.ts` | A booked → no bump, B booked → bump; hold, confirm, deposit re-create; event block; series; move into the period; two matches, one court; R22 refusals in `hold_slot` and `staff_create_reservation`; the concurrent two-till bump (two connections, exactly one bump after at most one sweep) |
| `matches-cascade.test.ts` | cancel of a booked match (marks restored); completed → auto-attend and forfeits; move; `MATCH_MARK_SEATS`; all-no-show and its reopening, `court_reused`; call-off: R12 refusal, a `left_late` counting as short, `nobody_came` |
| `matches-desk.test.ts` | start for a walk-in and for a customer; add the 4th → booked; a walk-in on a `left_late` number and on a `no_show` number (lowest open number); the removal table; the mark table incl. `ticket_used`, `replaced`, `paid`, `match_ended`, `day_closed`; the `can` flags; `VENUE_MISMATCH`; `MATCH_NOT_FOUND` across branches and for sandbox matches |
| `matches-sweep.test.ts` | each step; idempotency (two runs); a try-locked branch skipped; DF-20 with a mixed purchase; the 12-month report purge |
| `matches-privacy.test.ts` | no phone, `full_name`, `family_name` or other people's `guest_id` in any guest read; "Former player"; DF-10 incl. an unset gender; token versus public; the restricted card; blocks; the invite carries no names or ids; `open_matches` carries no names; `name_initial` (`آل ياسين`, `الربيعي`, `آلاء`, `Al-Rubaie`, `Émile`, an Arabic initial never NULL) |
| `lock-order-matches.test.ts` | the gate's printed sequences for `match_join` and `deposit_apply` (R15) |
| `profile-names.test.ts` (Guest) | the split rules (`عبد`, `أبو`, `Abd al`, one word, an 80-character name, `''`); sync both ways; tombstone; `handle_new_user`; backfill; `set_my_gender` (`guest.md` §4.5) |
| Extended | `match-shares` parity with `splitEvenly`; `match_expire_holds` against `expire_stale_holds`; `account-deletion.test.ts`; `stored-fields.test.ts`; `customers.test.ts` (counts, ban carry-over); `booking-integrity.test.ts` (the match booking passes every reservations CHECK); `helpers.ts` gains `createTestMatch` and `grantTestTickets` |
| Gates | `check:locks`, `check:authz`, `check:rpc-registry`, `check:assistant-coverage`, `check:broadcast`, `check:analytics`, `check:migrations`, `check:safeupdate`, `check:error-codes`; `db:types` with no diff |

## 8. Decisions recorded

### 8.1 The draft's "Conflicts with §1"

| # | Conflict | Decision |
| --- | --- | --- |
| 1 | 0256 ownership | Guest writes the file to DB's rules (D1); §4.2 is the contract. |
| 2 | `notify_staff` had no owner | DB re-issues it in 0261 (R5). |
| 3 | No file owned the push fan-out | Guest, in 0261 (R26); DB calls neither Guest function (§5.2). |
| 4 | `ticket_lock` could not both pick and lock | `ticket_pick` picks first; `ticket_lock` moves (§4.5.4). |
| 5 | The mutex re-taken inside L2 bodies | The gate emits each advisory key once per sequence (§2.6). |
| 6 | The sweep across branches | Blocking on the first branch only; try-locks after, mutex first (C21); no hold expiry there. |

### 8.2 The draft's open technical questions

| # | Question | Decision |
| --- | --- | --- |
| 1 | When `awaiting_court` ends | When the blocking hold lapses (book) or confirms (bump), and at `start_at` at the latest (`expired`, `no_court`). Fresh holds and staff creates cannot take the waiting court (R22). |
| 2 | Auto-attend at `end_at + 3 h` | Yes (R37). |
| 3 | Corrections after a ticket was reused | Refused, `SEAT_MARK_LOCKED ticket_used`; no other ticket is taken instead. |
| 4 | A chain-wide ban | Chain-wide, because §1.2 keeps it in `customer_flags`. |
| 5 | Name rules | As §4.2 and `name_initial`; the known limits are in §10; the prefix list goes to client review with the Arabic copy. |
| 6 | Anti-abuse constants | 5 pending requests, 12 messages per guest per match, one duplicate message per 10 minutes, 10 reports a day, 16-day guest windows (R27), 3-day desk windows, 200 matches per sweep run. Constants, not settings. |
| 7 | Removal after start | Only `staff_error`/`duplicate` (manager, owner); everything else is an attendance mark. |
| 8 | Refill windows | Guest until `start_at`; desk until `end_at`. |
| 9 | `match_invite` oracle | None: every miss answers `closed`. |
| 10 | Sweep fairness | Rotating start; skips are counted in `venues_skipped`. |
| 11 | Gender store category | `'Other personal info'`; the store forms are Guest's. |

### 8.3 Decisions this merge adds

| # | Decision | Why |
| --- | --- | --- |
| D-1 | Branch-scoped hold expiry (`match_expire_holds`) | The chain-wide `expire_stale_holds(null, …)` would trip `VENUE_MISMATCH` for a staff caller ("What the code forces"). |
| D-2 | Trigger B try-locks the mutex and defers to the sweep | Event blocks and the deposit re-create write firm rows without the court lock; a blocking mutex there could deadlock with an L2 body ("What the code forces"; situation 9). Part A stays blocking because a cascade must be atomic. |
| D-3 | After start, an unrefilled `left_late` carrier counts as absent for call-off | It cannot be marked, its ticket is already forfeited, and OM-47 plainly treats three players as short. Consistent with C8 and D7, which R12 cites. |
| D-4 | `match_end` finishes every terminal transition | One place resolves seats, tickets and requests, which makes the R16 invariant testable. |
| D-5 | `ticket_forfeit` releases a deleted owner's ticket | R18 in one place, whatever path marks the seat. |
| D-6 | Waiting matches are served first | R22's intent: a newer match must not take the court a waiting match is owed. |
| D-7 | Time clash refused for players (C15) | Two overlapping seats guarantee a forfeit. New guest code `MATCH_TIME_CLASH`. |
| D-8 | Idempotency keys required on `match_start`, `desk_start_match`, `desk_add_seat` | C16's reasoning applies to every non-idempotent write; the clients always send one. |
| D-9 | Reason form `<code>` or `<code>: <note>` on `desk_remove_seat`, `desk_cancel_match`, `set_match_ban`; `desk_add_seat` fills the lowest open number | Taken from `operator.md` (§5.13.8, §5.13.9): R35's note and "a walk-in in Omar's place" need no new argument, so §1.7's signatures stay. |
| D-10 | Staff never see sandbox matches | Closes the C20 leak on the desk writes. |
| D-11 | The profiles sandbox guard, built by Money (`profiles_sandbox_tickets`, 0259, `money.md` §5.13); DB's draft guard is dropped | Closes the C20 stranding of tickets; one guard, the one that also covers a live ticket attempt. |
| D-12 | Guest refills and leaves do not take the money lock | The states they change are either not payable (open shares) or re-checked by Money's owed read. |
| D-13 | `match_court_claimed` is true only for a court the waiting match could itself still book (active, offers its length, no live row over its period) (0263) | A court with a live row over part of the waiting match's period cannot serve it, so a hold on its free part takes nothing the match is owed; refusing it would only turn a legitimate booking away. This is R22's "last non-live court" read literally. |
| D-14 | `match_sweep`'s Phase 3 (DF-20 refunds, the R36 purge) runs only on a chain-wide call (`p_venue_id` NULL, what the cron sends) (0263) | A branch-scoped call (a manual rerun, a test) never refunds or purges other branches' guests and reports. |
| D-15 | `delete_my_account` calls `ticket_refund_deleted` after the three match statements and before the audit row and the `auth.users` delete (0264) | §4.9's "last" and `money.md` §5.11's "after the tombstone and every reservations write" both hold, and `auth.uid()` still resolves for the `deposit.refund_request` audit rows `deposit_begin_refund` writes as the player. |
| D-16 | The seat and request scrubs touch only rows that still hold a value; the audit counts are rows actually scrubbed (0264) | The same data effect as a bare `where guest_id = v_uid`, without row-locking a player's finished seats outside the mutex for nothing. |

### 8.4 Review fixes applied here

| Fix | Where |
| --- | --- |
| C1 / G1 / R15 | §2.2 `match_lock`, §4.4.9 hoist, §2.6 fixture test |
| C2 / R16 | §4.7.8 refusal 8; invariant in §3.1 and §7 |
| C3 / R17 | §4.5.4 |
| C4 / R13 | `match_marks_open` for Money (§5.1); DF-20 skips (§4.8.3) |
| C5 / R18 | `match_drop_ineligible`, `match_try_book` step 2, `ticket_forfeit` |
| C6 / R19 | `lock_match_money`, levels L1+M and L2+M |
| C7 / R20 | Money (§4.7.14); `matches_reservation_key` is its probe |
| C8 / R4 / R21 | §3.2, §4.4.3 indexes, §4.7.5, §4.7.8 |
| C9 / R22 | §4.8.2; firm = live and not a hold |
| C10 / R23 | Money (§4.4.9) |
| C11 / R12 | §4.7.9 |
| C12 | `match_expire_holds` |
| C13 / R24 | step 17 of §4.6.2; step 16 of §4.7.4 |
| C14 | §4.8.1, Part B step 3 |
| C15 | §2.4; `MATCH_TIME_CLASH` |
| C16 | D-8 |
| C17 | §4.7.8 ordering |
| C18 | `SEAT_MARK_LOCKED paid` |
| C19 | §4.4.9 gate row |
| C20 | D-10, D-11 |
| C21 | §4.8.3 |
| G2 / R34 | "Every file"; `match_seats_ticket_fk` NOT VALID |
| G3 / R28 | the gate tables of §4 |
| G4 / R33 | §4.3, §4.7.12 |
| G5 / R29 | §4.4.9 SEC-20; §4.9 proof |
| G6 / D31 | §4.2 gate row |
| G7 / R11 | the codes rows of §4 |
| G8 / R30 | the coverage rows of §4; the note at the top |

## 9. Changes this file asks §1 to take

### 9.1 Names and signatures (the only ones)

1. **§1.1**: the ordinals move up by three ("Ordinals" above). Authors: 0260 is DB only (Money's
   internals moved to 0259/0262, `money.md` §14; Guest's `match_notify` and `match_sync_reminders`
   to 0261, `guest.md` §4.30); 0261 is DB + Guest; 0263 also re-issues `hold_slot` and
   `staff_create_reservation`.
2. **§1.5 `ticket_release`**: `ticket_release(p_ticket_ids uuid[], p_code text, p_seat_ids uuid[]
   default null, p_request_id uuid default null) returns int` (was `(uuid[], text)`), for R17's
   ownership check.
3. **§1.10 guest codes**: + `MATCH_TIME_CLASH` (D-7).
4. **§1.8**: + `hold_slot` (latest 0252 since the sync, DB, 0263) and `staff_create_reservation` (latest 0217, DB,
   0263), each gaining the R22 check.

### 9.2 Additions (new names, no rename)

- **§1.2**: `match_ticket_events.code text` (≤ 40); `match_tickets` CHECKs `forfeited ⇔
  forfeited_at`, the three forfeit columns set together, `cashout_payment_id = purchase_payment_id`
  (R8), `sandbox not null` with no default (D3); `match_seats` unique `(ticket_id) where status in
  ('in','left_late')`; `match_seats.end_reason` `refilled` is set on a refilled seat; index
  `match_reports (created_at)`. (The `profiles` sandbox-flip guard is Money's
  `profiles_sandbox_tickets`, 0259.)
- **§1.3**: `match_events.type` + `no_show` (the match reaching `no_show`). Codes on a
  `request_expired` event: `match_full`, `organiser_gone`, `closed`, `banned`, `tickets_missing`,
  or the match's `ended_reason` (§3.4). Refusal details:
  `SEAT_MARK_LOCKED` `day_closed|ticket_used|court_reused|replaced|paid|match_ended`;
  `INVALID_TRANSITION` `marked|ended|match_ended|use_attendance|not_carrier|not_short|nobody_came`;
  `FORBIDDEN` `manager_required`; `SLOT_TAKEN` `match_waiting`; `REQUESTER_INELIGIBLE` = the
  failing code; `NEED_TICKETS` = `{"needed","available","buy"}`; `MATCH_TOO_LATE` = minutes.
- **§1.5**: `lock_match_money(uuid)`, `try_lock_match_venue(uuid, boolean default false) returns
  boolean`, `match_lock_courts(uuid)`, `match_expire_holds(uuid, tstzrange) returns int`,
  `match_eligibility(uuid, boolean) returns text`, `name_initial(text) returns text`,
  `match_seat_label(match_seats) returns jsonb`, `match_carriers(uuid) returns table(seat_no
  smallint, seat_id uuid, status text)`, `match_marks_open(uuid) returns boolean`,
  `match_drop_ineligible(uuid) returns int`, `ticket_pick(uuid, int, boolean, uuid default null)
  returns uuid[]`, `ticket_restore(uuid, uuid, boolean default false) returns boolean`; fixed
  signatures for the `...` of §1.5: `match_pick_court(matches) returns uuid`,
  `match_court_free_firm(uuid, tstzrange, int, int default 1) returns boolean`,
  `match_try_book(uuid) returns text`, `match_end(uuid, text, text, text) returns boolean`,
  `match_recompute_organiser(uuid) returns boolean`, `ticket_lock(uuid[], uuid[] default null, uuid
  default null) returns int`, `ticket_forfeit(uuid, uuid) returns boolean`, `match_event(uuid, uuid,
  text, text, uuid default null, uuid default null, text default null, jsonb default '{}') returns
  bigint`. In 0257: `match_terms_ok(text) returns boolean`. In 0258: `trg_sanitise_match_seat()`.
  In 0263: `trg_reservation_match()` (trigger `reservations_match`),
  `match_sweep(uuid default null) returns jsonb`, `match_court_claimed(uuid, tstzrange) returns
  boolean`. In 0256 (Guest): `split_person_name(text) returns text[]`, `trg_profile_names()`
  (trigger `profiles_sync_names`).
- **GUCs**: `app.match_booking` (set by `match_try_book`, read by the trigger); `app.skip_name_sync`
  (the 0256 backfill).
- **Matrix**: drop 24.

### 9.3 Behaviour §1 should record

- The lock order of §2.1 (R19's rank included) and the once-per-sequence rule.
- Guest RPCs require `p_idempotency_key` on `match_start`; desk writes require it on
  `desk_start_match` and `desk_add_seat` (signatures unchanged, D-8).
- Staff reads and writes treat a sandbox match as not found (D-10).
- The reason form of D-9 on `desk_remove_seat`, `desk_cancel_match` and `set_match_ban`.

### 9.4 Latest bodies to re-issue from

| Function | Latest | Migration |
| --- | --- | --- |
| `venue_settings_public` (view) | 0208:88 | 0257 |
| `notify_staff` | 0193:38 | 0261 |
| `mark_reservation` | 0089:42 | 0262 |
| `set_customer_flags` | 0242:1746 | 0262 |
| `customer_counts`, `customer_record` | 0065:170, 0065:272 | 0262 |
| `customer_search` | 0077:317 | 0262 |
| `customer_directory` | 0148:42 | 0262 |
| `hold_slot` | 0252:420 | 0263 |
| `staff_create_reservation` | 0217:1367 | 0263 |
| `delete_my_account` | 0077:120 | 0264 |

Check each again with `grep -n "function app.<name>(" supabase/migrations/*.sql | tail -1` before
writing (`packages/db/CLAUDE.md`).

## 10. Known limits

- The booking literal `'Open match'` is English. Staff surfaces that do not go through the
  operator's `bookingLabel` (staff phone lists, Telegram summaries, report drill rows,
  `unpaid_played_bookings.guest_name`) show it in English.
- The guest grid still shows a waiting match's court as free; a tap there gets `SLOT_TAKEN`.
- Moves, extends, event blocks and the deposit re-create are not refused on a waiting match's court;
  they bump it (only `hold_slot` and staff creates are guarded, R22).
- A bump deferred by a busy mutex waits for the next sweep run (at most about 30 s).
- An all-absent booked match (every carrier a late leaver) is ended `no_show` by the sweep, and its
  booking row keeps its status for the desk; its money nets to zero.
- On a `played` match, corrections change seats and tickets but not the match status.
- Name rules: a family name that starts with a non-article `ال` (`الياس`) loses it in the initial;
  email-local names (0069) show as they are.
- A branch under load can be skipped by the sweep for several runs.
- Walk-in names and phones typed by the desk are kept, as for walk-in reservations today.
- Desk seats are exempt from the time-clash and OM-37 checks: the desk vouches.

## 11. Owner questions

None from this lane. Every question the draft and the reviews raised is either answered by §1.12
(R12, R13, R14, R22, R35, R36, R37) or technical and decided in §8. The owner questions carried in
§1.12 (headline revenue with written-off shares, Qi fees on a cash-out, cash from "settled another
way", tax on seat money) are Money's.
