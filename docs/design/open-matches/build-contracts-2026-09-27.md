# Open matches: build contracts

Date: 2026-09-27. Status: **design, approved by Parsa the same day; nothing built.** This file is
binding for every lane of the open-matches build. Where it and the planning record disagree, this
file wins. The planning record (11 rounds of questions, decisions OM-1…OM-48 and defaults
DF-1…DF-21) was copied into §0 below; the working copy is
`~/.claude/plans/lets-plan-the-open-stateless-sphinx.md`.

It supersedes `PHASE-2-PLAN.md` §C3 (host-owned booking, `event_participants`, equal split with the
host covering empty seats), the milestone-6 line of `PHASE-2-CHECKLIST.md`, and the mobile spec's
do-not-build line for open matches (`docs/design/mobile-ui/touch-padel-mobile-ui-spec.md:507`).

Parsa, 2026-09-27: *"the system waits for four people to book … as soon as four people book the
session it … marks it as booked … if a group of four people go for a full booking it overrides the
three people"*, then: *"each person buys a ticket for an open match … if … some person doesn't show
up, they lose their ticket. But whoever did show up … can keep their ticket and … join another open
match."*

## 0. The product and the decisions

### 0.1 In one paragraph

A guest starts an **open match** on a free time at a branch; no court is held. Every seat is taken
with a reusable **open-match ticket** (bought once by Qi Card, priced about one seat, locked while
in a match, back in the wallet after play, lost only on a no-show). While filling, a normal booking
of the last free court for that time bumps the match and every ticket comes back. The 4th seat
books the court in the same transaction. At the desk everyone who shows pays their full share
(price ÷ 4); a no-show loses their ticket; when someone is missing the rest choose to play or call
it off. No card refunds except a manager cash-out of unused tickets.

### 0.2 Decisions

| # | Decision |
| --- | --- |
| OM-3 | Visibility per match: `public` (listed at the branch) or `link` (unguessable token). |
| OM-4 | Join policy per match: `open` (instant) or `approve` (the organiser approves). |
| OM-7, OM-38 | Category per match, fixed at start: `open`, `women`, `men`. No mixed. |
| OM-12, OM-19 | Waits-for-four is the only kind of open match: started on a free slot, a real booking at 4/4. |
| OM-13 | A filling match holds no court. A firm booking of the last free court bumps it. Booked is firm. |
| OM-16 | No player levels in v1. |
| OM-17 | Preset quick messages only (`on_my_way`, `running_late`, `cant_make_it`, `bring_balls`). |
| OM-20 | Up to 3 seats per player (friends without the app); the 4th seat is always someone else's. |
| OM-22 | Fill deadline: branch setting, default 120 minutes before start. |
| OM-25 | No new tab: Book sheet choice, slot chips, a list from the sheet, matches in My Reservations. |
| OM-26 | Players see "First I."; `given_name`/`family_name` stored; a deleted account is "Former player". |
| OM-27 | Report (fixed reasons) + block + manager ban (`customer_flags` type `match_ban`). |
| OM-28 | Gender (`female`/`male`) asked once at the first match; staff can correct it. |
| OM-29, OM-30 | Desk: start for a customer, add a walk-in (no ticket), remove, cancel filling, attendance per seat, the Today group. |
| OM-31 | No person is named on a lock screen. |
| OM-32 | Universal links + web invite page; public with the 1.0 store release; branch switch. |
| OM-33 | Own milestone, built next, own tables; tournaments later. |
| OM-34 | The organiser leaves a filling match → the longest-standing account holder takes over; nobody left → closed. |
| OM-36 | Eligibility: account, phone, accepted terms, not banned. |
| OM-37 | At most 3 filling matches per player (chain-wide setting). |
| OM-39 | Friend seats in gendered matches carry the gender the player declares; the desk can check. |
| OM-41 | The organiser sees a requester's games played at Touch and no-show count. |
| OM-42 | Filling matches overlapping a time ≤ courts free (of firm rows) for that time. |
| OM-43 | Start only if `start_at ≥ now() + fill deadline + 60 min`. |
| OM-44 | The organiser can remove a player while filling: ticket back, no rejoin of that match. |
| OM-45 | Reusable ticket: locked while in a match, released after play, forfeited on no-show or on a late leave that nobody refills. Players pay the full share at the desk. |
| OM-46 | Ticket price ≈ one seat: one chain-wide owner setting (default 10,000 IQD). |
| OM-47 | Short one: the players who came choose at the desk to play (pay shares; the desk may add a walk-in) or to call it off (pay nothing, keep tickets). The no-show loses their ticket either way. |
| OM-48 | Cash-back only at the desk on request (manager). Tickets never expire. |

Reshaped: OM-11 (a refilled late leaver gets their ticket back), OM-14, OM-18, OM-23, OM-24, OM-35
(the ticket is reserved with the request; approval seats at once). Superseded: OM-1, 2, 5, 6, 8, 9,
10, 15, 21, OM-40 (DF-14), and "mixed".

### 0.3 Defaults (taken; Parsa may reverse any)

| # | Default |
| --- | --- |
| DF-1 | The list shows the branch picked in the app; a link opens its own branch and never changes the stored one. |
| DF-2 | Match lengths are the normal slot lengths of the branch's courts. |
| DF-3 | The price is stamped at start from `app.price_slot` on the tapped court (quote = charge, `PRICE_CHANGED`). Shares: exact largest-remainder split, Σ = price. |
| DF-4 | A desk move or extend of a booked match re-prices the booking as today; the difference is a booking-level line on the bill. |
| DF-5 | Pushes per §1.9. |
| DF-9 | The web invite page shows no names. |
| DF-10 | Women-only hidden from declared men, men-only from declared women; an unset gender sees both and is asked inline; blocks and bans filtered. |
| DF-11 | Every match write is online-only (HANDOFF scope ledger row). |
| DF-12 | Seat no-shows count in the customer's no-show total. |
| DF-14 | OM-40 dropped: every no-show already loses a ticket worth about a seat. |
| DF-15 | A friend seat's no-show counts on the holder, whose ticket backed it. |
| DF-16 | Café orders by match players go on their own café bill, never on the match booking. |
| DF-17 | App Store UGC answer becomes Yes; terms re-accepted at 1.0. |
| DF-18 | Only holds block the last court at the 4th seat → `awaiting_court`, booked when the hold lapses, bumped if it confirms. |
| DF-19 | Tickets bought on a sandbox (App Review) profile only work in sandbox matches, and sandbox matches never book a real court. |
| DF-20 | Deleting an account leaves filling matches, treats booked seats as late leaves, and refunds unused tickets (one Qi refund per purchase). |
| DF-21 | A price change never touches tickets already bought; cash-out returns the price paid. |

## 1. Names (binding on every lane)

Nothing below may be renamed in a lane section. A lane that needs something new adds it in its own
section and lists it under "Additions to §1"; the merge folds it back here. Folded on 2026-09-28
from `db.md` §9, `money.md` §14, `guest.md` §4.30 and `operator.md` "Additions to §1".

### 1.1 Migrations

Every file opens with `set lock_timeout = '3s'; set statement_timeout = '60s';`, re-issues functions
from their latest body, uses `$<name>_0NNN$` tags with its real ordinal, and ships `types.gen.ts`,
both catalogs and every gate artifact it needs in the same commit (R28). A CHECK or FK on an existing
table is `NOT VALID` plus a validate guarded on `conname` and `conrelid`. Indexes on the new (empty)
tables: `MIGRATION-RISK-ACCEPTED` in the commit message, with `check-migrations` run locally first
(R34). 0249–0251 were taken by `43625f39`, so every ordinal moved up by three; check the directory
before writing each file and shift again, keeping this order, if more have landed. Matrix rows go in
`tests/rls-matrix.ts` drop 24.

| Ordinal | File | Owner lane | What |
| --- | --- | --- | --- |
| 0253 | `customer_flags_match_ban` | DB | CHECK widening only: `+ 'match_ban'` (the flag's `label` holds the R35 ban code) |
| 0254 | `booking_payments_ticket_checks` | Money | CHECK widening only: `purpose` + `'ticket'`; `refund_reason` + `'ticket_cashout'`, `'account_deleted'` |
| 0255 | `outbox_match_kinds` | Guest | CHECK widening only: `+ 'match_update','match_reminder','match_message'`. After `send-push` is deployed with the guest family (push A, §6.1) |
| 0256 | `profile_names_gender` | Guest (on DB's contract, `db.md` §4.2) | profile columns, `split_person_name`, sync + sanitiser triggers, backfill, `handle_new_user`, `set_my_gender`; creates the mobile `matches` catalog pair; R6's two map entries |
| 0257 | `match_settings` | DB | settings columns, `venue_settings_public`, `match_terms_ok`, `match_settings` / `set_match_settings` |
| 0258 | `match_tables` | DB + Money | every table of §1.2 (DB writes the tickets DDL); Money's `booking_payments` changes and anchor, `payment_match_seats`, `tabs.court_cap_iqd`; the 0242 hooks scoped to `purpose='deposit'` with the R15 hoist and R23 (same file, before any ticket row can exist; never split) |
| 0259 | `ticket_purchase` | Money | `ticket_payment_prepare`, ticket branch in `deposit_apply`, `ticket_settle_success`, `deposit_status` purpose-aware, `deposit_refund_apply`, `my_tickets`, `guest_tickets`, cash-out, DF-20 refunds, the profiles sandbox-flip guard; creates the operator `opErrors.matches` pair |
| 0260 | `match_core` | DB | internal functions (§1.5), lock primitives and the lock-gate edit (§1.4). Money's internals are in 0259 and 0262, Guest's in 0261 |
| 0261 | `match_guest_rpcs` | DB + Guest | guest reads and writes (§1.6); `notify_staff` re-issued with `match_report_new` (R43); Guest's `match_notify`, `match_sync_reminders` and the two push fan-out triggers (R26) |
| 0262 | `match_desk_money` | DB + Money | staff RPCs (§1.7), seat money (`match_money`, `match_seat_money`, `court_fee_written_off`, settle, link, write-off), the DF-16 wall (R20), re-issues (§1.8) |
| 0263 | `match_reservation_triggers` | DB | bump + cascade trigger, `match_court_claimed` with `hold_slot` and `staff_create_reservation` re-issued (R22), `match_sweep`, cron `tp_match_sweep` |
| 0264 | `match_account_deletion` | DB | `delete_my_account` re-issued once, from 0077, carrying 0256's name/gender scrub; calls `ticket_refund_deleted` last (R25) |
| 0265 | `match_reports` | Money + Ops | `day_close_online`, `report_courts` matches block, `reports_figures` and `panel_headline` keys, `unpaid_played_bookings`, `report_matches` |

### 1.2 Tables and columns

All branch tables: `venue_id uuid not null references venues`, the `zz_branch_guard` trigger with the
link pairs named, RLS on, no insert/update/delete grant (writes only through definer RPCs), staff
select policies in the 0234 form where a direct read is wanted. In v1 none is: every new table is
`revoke all … from anon, authenticated` with no policy, and every read goes through a definer RPC
(`db.md` §4.4).

**`matches`** (branch). `id`, `venue_id`, `status`, `start_at`, `end_at`, `period` (generated
`tstzrange [)`), `duration_min`, `visibility`, `join_policy`, `category`, `price_iqd` (iqd),
`shares_iqd bigint[4]` (Σ = price), `rate_rule_id`, `price_court_id` (the court the price came
from), `fill_deadline_at`, `share_token` (text unique, `^[A-Za-z0-9_-]{22}$`), `organiser_id` →
profiles (nullable), `organised_by` (`guest`|`desk`), `created_by_staff_id`, `reservation_id` →
reservations (unique where not null), `sandbox` boolean, `deadline_warned_at`, `ended_at`,
`ended_reason`, `idempotency_key` unique, `created_at`, `updated_at`.
Guard link pairs: `reservations/reservation_id`, `rate_rules/rate_rule_id`, `courts/price_court_id`.

**`match_seats`** (branch). `id`, `venue_id`, `match_id`, `seat_no` (1..4), `kind`, `guest_id`
(account: the player; friend: the holder; desk: NULL or a linked customer), `guest_name`,
`guest_phone` (desk typed seats only, sanitised, ≤ 80 / phone format), `gender` (`female`|`male`|
null), `status`, `ticket_id` → match_tickets (NULL for desk seats), `share_iqd`, `request_id`,
`replaces_seat_id`, `created_by_staff_id`, `vouched` (generated: `created_by_staff_id is not null`),
`joined_at`, `ended_at`, `end_reason`, `marked_by_staff_id`, `marked_at`, `written_off_by_staff_id`,
`written_off_at`, `write_off_reason`.
Unique `(match_id, seat_no) where status in ('in','attended')` (R4); unique `(match_id, guest_id)
where kind='account' and status in ('in','attended','no_show')`; unique `(ticket_id) where status in
('in','left_late')`. FK `match_seats_ticket_fk` added NOT VALID after `match_tickets` (R34). A
refilled seat ends with `end_reason 'refilled'`.

**`match_requests`** (branch). `id`, `venue_id`, `match_id`, `guest_id`, `seats_requested` (1..3),
`friend_genders text[]`, `status`, `decided_at`, `created_at`. Unique `(match_id, guest_id) where
status='pending'`. Its tickets are the `match_tickets` rows whose `request_id` points at it.

**`match_events`** (branch, append-only via `app.forbid_mutation()`). `id bigint identity`,
`venue_id`, `match_id`, `type`, `actor` (`guest`|`staff`|`system`), `actor_guest_id`,
`actor_staff_id`, `seat_id`, `request_id`, `code` (≤ 40), `data jsonb` (ids and counts only), `at`.

**`match_tickets`** (chain-wide, no `venue_id`, no guard; like `customer_flags`). `id`, `guest_id`
→ profiles, `status`, `price_iqd`, `purchase_payment_id` → booking_payments, `sandbox`,
`request_id`, `seat_id`, `forfeited_venue_id`, `forfeited_seat_id`, `forfeited_at`,
`cashed_out_at`, `cashout_payment_id`, `created_at`, `updated_at`. DB owns the DDL (R31). `sandbox
not null` with no default (it copies the purchase row). CHECKs: `reserved ⇔ request_id not null`,
`in_use ⇔ seat_id not null`, `forfeited ⇔ forfeited_at` with the three forfeit columns set together,
`match_tickets_cashed_out` (`cashed_out ⇔ cashed_out_at and cashout_payment_id`),
`match_tickets_cashout_same` (`cashout_payment_id = purchase_payment_id`, R8). Only Money inserts
rows and writes `cashed_out`.

**`match_ticket_events`** (chain-wide, append-only). `id bigint identity`, `ticket_id`, `guest_id`,
`type`, `venue_id` (nullable), `match_id`, `seat_id`, `request_id`, `payment_id`, `actor_staff_id`,
`code` (≤ 40, why it moved), `at`.

**`match_blocks`** (chain-wide). `id`, `blocker_id`, `blocked_id`, `created_at`; unique pair;
`blocker_id <> blocked_id`.

**`match_reports`** (branch). `id`, `venue_id`, `match_id`, `reporter_id`, `reported_id`,
`seat_id`, `request_id`, `reason`, `status`, `reviewed_by`, `reviewed_at`, `created_at`. Unique
`(reporter_id, reported_id, match_id)`; index `(created_at)` for the 12-month purge (R36).

**`match_exclusions`** (branch). `match_id`, `guest_id`, `venue_id`, `reason` (`removed_by_organiser`
| `removed_by_staff`), `created_at`; primary key `(match_id, guest_id)`.

**`payment_match_seats`** (branch, append-only). `payment_id` → payments, `match_seat_id`,
`venue_id`, `amount_iqd` (> 0), `linked_by` → staff, `created_at`; primary key `(payment_id,
match_seat_id)`.

**Changed tables.**
- `profiles`: `given_name`, `family_name` (each 1..39 / ≤ 39, so `concat_ws` ≤ 80), `gender`,
  `gender_set_at`, `gender_set_by` (`guest`|`staff`), all three gender columns set together;
  triggers `profiles_sync_names` (0256) and `profiles_sandbox_tickets` (0259: a `payment_sandbox`
  flip is refused `INVALID_TRANSITION` `live_tickets` while the profile holds a live ticket or ticket
  attempt).
- `customer_flags.type`: + `match_ban`; its `label` is the ban code (R35), written only by
  `set_match_ban` and carried over by `set_customer_flags`.
- `booking_payments`: `purpose` in (`deposit`, `ticket`); `hold_id`, `reservation_id` and `venue_id`
  nullable (R7); `ticket_count smallint`; constraint `booking_payments_anchor`: deposit ⇒ hold,
  reservation and venue set, `ticket_count` null; ticket ⇒ hold, reservation and venue null,
  `ticket_count` 1..3. Also `booking_payments_ticket_amount` (`amount = ticket_count ×
  quoted_price_iqd`), `booking_payments_reason_by_purpose`, and the unique partial index
  `booking_payments_one_active_ticket` (one live attempt per guest). The existing
  `booking_payments_one_active` index (on `hold_id`) never matches a ticket row.
- `tabs.court_cap_iqd iqd null` (`tabs_court_cap_positive`): when set, the tab's court line is
  `least(court_cap_iqd, court_fee_remaining(...))`. Written only as R2 says.
- `orders`, `tab_adjustments`: the R20 guard triggers (`MATCH_BOOKING_NO_CAFE`).
- `reservations`: trigger `reservations_match` (0263), after insert or update of `kind, status,
  court_id, start_at, end_at` when the row is a booking or maintenance. A match booking has
  `guest_id` NULL and `guest_name` exactly `'Open match'`.
- `venue_settings`: `matches_enabled boolean not null default false`,
  `match_fill_deadline_minutes int not null default 120` (60..2880).
- `platform_settings`: `match_ticket_price_iqd bigint not null default 10000` (1,000..1,000,000,
  multiple of 250), `max_filling_matches_per_guest int not null default 3` (1..10),
  `match_terms_version text` (null = any accepted version).
- GUCs: `app.match_booking` (set by `match_try_book`, read by that trigger), `app.skip_name_sync`
  (the 0256 backfill).

### 1.3 Status vocabularies

| Column | Values |
| --- | --- |
| `matches.status` | `filling`, `awaiting_court`, `booked`, `played`, `no_show`, `cancelled`, `bumped`, `expired` |
| `matches.ended_reason` | `organiser_cancelled`, `staff_cancelled`, `reservation_cancelled`, `called_off_short`, `bumped`, `deadline`, `empty`, `venue_closed`, `no_court`, `all_no_show` |
| `match_seats.kind` | `account`, `friend`, `desk` |
| `match_seats.status` | `in`, `left`, `removed`, `cancelled`, `left_late`, `refilled`, `attended`, `no_show` |
| `match_seats.end_reason` | `left`, `removed_by_organiser`, `removed_by_staff`, `match_ended`, `refilled`, `banned`, `account_deleted` |
| `match_requests.status` | `pending`, `approved`, `declined`, `withdrawn`, `expired` |
| `match_tickets.status` | `available`, `reserved`, `in_use`, `forfeited`, `cashed_out` |
| `match_ticket_events.type` | `bought`, `reserved`, `locked`, `released`, `forfeited`, `restored`, `cashed_out` |
| `match_events.type` | `started`, `requested`, `approved`, `declined`, `withdrawn`, `request_expired`, `joined`, `left`, `left_late`, `refilled`, `removed`, `organiser_changed`, `awaiting_court`, `booked`, `bumped`, `expired`, `cancelled`, `moved`, `deadline_warning`, `message`, `seat_attended`, `seat_no_show`, `seat_unmarked`, `called_off_short`, `played`, `no_show` (the match reached `no_show`) |
| `request_expired` event codes | `match_full`, `organiser_gone`, `closed` (past its cutoff), `banned`, `tickets_missing`, or the match's `ended_reason` |
| `match_reports.reason` | `offensive_name`, `abusive_behaviour`, `harassment`, `unsafe_play`, `no_show`, `other` |
| `match_reports.status` | `open`, `dismissed`, `actioned` |
| desk remove reasons | `customer_request`, `conduct`, `staff_error`, `duplicate`, `other` |
| desk cancel reasons | `customer_request`, `court_needed`, `staff_error`, `duplicate`, `other` |
| write-off reasons | `walked_out`, `staff_error`, `other` |
| ban reasons (R35) | `conduct`, `no_shows`, `reported`, `other` |
| organiser cancel reasons | `not_enough_players`, `plans_changed`, `other` |

Desk remove, desk cancel and ban reasons are sent as `<code>` or `<code>: <note>` (R42).

**Carriers** (R4, R21; `app.match_carriers`, shared by DB and Money): the carrier of a `seat_no` is
its seat with status `in`, `attended`, `no_show` or `left_late` that no other such seat replaces
(`replaces_seat_id`); a number with no carrier is vacant. A `left_late` seat is open for a refill but
its ticket stays locked until refilled (released) or start (forfeited; a deleted holder's is
released, R18). A match is **short** (R12, R39) when a carrier is `no_show`, or is `left_late` after
the start.

### 1.4 Locks (the order `check-lock-order.mjs` enforces; `ORDER` gains three entries)

```text
day_sessions
  → match_money_advisory (app.lock_match_money(match): 'app.matches:money:'||id, R19)
  → tabs → orders → order_items → tickets → payments → till_shifts → refunds → stock_batches
  → court_advisory (every active court of the branch, id order; app.lock_court)
  → reservations (the match's own booking FOR UPDATE; then branch-scoped hold expiry,
                  app.match_expire_holds)
  → match_venue_advisory (app.lock_match_venue(venue): 'app.matches:venue:'||id)
  → match_tickets (FOR UPDATE, id order)
```

Both advisory keys are hashed as 0042 does (`pg_advisory_xact_lock(hashtextextended(key, 0))`).
The levels each body takes are `db.md` §2.3; the printed sequences are `db.md` §2.5 and `money.md` §8.

- `matches`, `match_seats`, `match_requests` are never locked FOR UPDATE; the venue mutex
  serialises every change to them.
- `match_lock` takes courts → the booking row → hold expiry → the mutex (R15). Hold expiry always
  runs before the mutex, one statement per branch in `id` order.
- Every writer that changes what a seat owes takes the money lock first (R19): Money's settle, link
  and write-off, and DB's marks, call-off, desk add and desk remove. Desk money otherwise keeps the
  0106 order and reads match rows without a lock; drift is caught by `SEAT_OWED_CHANGED`.
- The bump half of the reservation trigger only try-locks the mutex and defers to the sweep; the
  sweep blocks on its first branch only and try-locks the rest.
- The walker learns `app.lock_match_venue` and `app.lock_match_money` beside `app.lock_court`,
  emits each advisory key once per sequence, and also walks the service-role functions
  `match_sweep`, `deposit_apply`, `ticket_settle_success`, `ticket_refund_deleted`,
  `tickets_cash_out` (R8). `booking_payments` stays out of `ORDER`.

### 1.5 Internal functions (revoked from public, anon, authenticated; by file)

**0256 (Guest):** `split_person_name(text) returns text[]`; `trg_profile_names()` (trigger
`profiles_sync_names`).

**0257 (DB):** `match_terms_ok(text) returns boolean`.

**0258 (DB):** `trg_sanitise_match_seat()` (trigger `match_seats_sanitise`).

**0259 (Money):** `ticket_settle_success(uuid) returns text`, `tickets_cash_out(uuid, text, uuid)
returns jsonb` (the one writer of `cashed_out`), `ticket_refund_deleted(uuid default null) returns
int` (DF-20), `ticket_wallet(uuid, boolean) returns jsonb`, `ticket_cashout_block(uuid) returns
jsonb`, `trg_profile_sandbox_tickets()` (trigger `profiles_sandbox_tickets`).

**0260 (DB):**

- locks: `lock_match_venue(uuid)`, `lock_match_money(uuid)`, `try_lock_match_venue(uuid, boolean
  default false) returns boolean`, `match_lock_courts(uuid)`, `match_expire_holds(uuid, tstzrange)
  returns int` (the branch-scoped twin of `expire_stale_holds`), `match_lock(uuid) returns matches`;
- people: `match_eligibility(uuid, boolean) returns text`, `match_guest(boolean) returns profiles`,
  `match_visibility(matches, uuid, text, text) returns text`, `name_initial(text) returns text` (an
  explicit Latin and Arabic letter class, never `[[:alpha:]]`), `match_display_name(uuid) returns
  jsonb`, `match_seat_label(match_seats) returns jsonb`;
- courts and seats: `match_shares(bigint) returns bigint[]` (twin of core `splitEvenly`),
  `match_court_free_firm(uuid, tstzrange, int, int default 1) returns boolean`,
  `match_pick_court(matches) returns uuid`, `match_carriers(uuid) returns table(seat_no smallint,
  seat_id uuid, status text)` (the one carrier rule, read by Money too), `match_marks_open(uuid)
  returns boolean` (the marks window, and Money's "still restorable" test, R13),
  `match_drop_ineligible(uuid) returns int`, `match_try_book(uuid) returns text`;
- tickets: `ticket_pick(uuid, int, boolean, uuid default null) returns uuid[]`,
  `ticket_lock(uuid[], uuid[] default null, uuid default null) returns int`,
  `ticket_release(p_ticket_ids uuid[], p_code text, p_seat_ids uuid[] default null, p_request_id
  uuid default null) returns int` (was `(uuid[], text)`: the pairing is R17's ownership check),
  `ticket_forfeit(uuid, uuid) returns boolean`, `ticket_restore(uuid, uuid, boolean default false)
  returns boolean`;
- ending and counts: `match_end(uuid, text, text, text) returns boolean`,
  `match_recompute_organiser(uuid) returns boolean`, `match_event(uuid, uuid, text, text, uuid
  default null, uuid default null, text default null, jsonb default '{}') returns bigint`,
  `guest_games_played(uuid) returns int`, `guest_match_no_shows(uuid) returns int`.

**0261 (Guest):** `match_notify(p_match_id uuid, p_recipients uuid[], p_title_key text, p_params
jsonb default '{}', p_actor uuid default null, p_scheduled_for timestamptz default null, p_dedupe text
default null) returns int`; `match_sync_reminders(uuid) returns void`; the push triggers
`trg_match_event_push()` (trigger `match_events_push`, AFTER INSERT on `match_events`) and
`trg_match_ticket_event_push()` (trigger `match_ticket_events_push`, AFTER INSERT on
`match_ticket_events` WHEN `type = 'forfeited'`). The two triggers are the only callers of
`match_sync_reminders`; DB never calls either function (R26).

**0262 (Money):** `match_money(uuid, uuid) returns jsonb` (the one money engine),
`match_seat_money(uuid) returns table(...)` (its seat rows), `court_fee_written_off(uuid, uuid default
null) returns bigint`, `trg_match_booking_no_cafe()` (triggers `orders_match_booking_no_cafe`,
`tab_adjustments_match_booking_no_cafe`, R20).

**0263 (DB):** `trg_reservation_match()` (trigger `reservations_match`), `match_court_claimed(uuid,
tstzrange) returns boolean` (R22), `match_sweep(uuid default null) returns jsonb` (service role).

**0265 (Money):** `ticket_money_figures(timestamptz, timestamptz, uuid[]) returns jsonb`.

### 1.6 Guest RPCs (0256, 0259, 0261; `authenticated`; the first statement refuses a non-profile)

| RPC | Args |
| --- | --- |
| `match_quote` | `p_venue_id uuid, p_court_id uuid, p_start_at timestamptz, p_duration_min int` |
| `open_matches` | `p_venue_id uuid, p_from timestamptz, p_to timestamptz` |
| `match_detail` | `p_match_id uuid default null, p_token text default null` |
| `my_matches` | `p_scope text default 'upcoming'` |
| `my_tickets` | none |
| `my_match_blocks` | none |
| `match_start` | `p_venue_id uuid, p_court_id uuid, p_start_at timestamptz, p_duration_min int, p_category text, p_visibility text, p_join_policy text, p_friends jsonb default '[]', p_quoted_price_iqd bigint default null, p_idempotency_key text default null` |
| `match_join` | `p_match_id uuid, p_friends jsonb default '[]', p_token text default null` |
| `match_request` | `p_match_id uuid, p_friends jsonb default '[]', p_token text default null` |
| `match_withdraw` | `p_request_id uuid` |
| `match_decide` | `p_request_id uuid, p_approve boolean` |
| `match_leave` | `p_match_id uuid, p_seat_ids uuid[] default null` |
| `match_remove_player` | `p_match_id uuid, p_seat_id uuid` |
| `match_cancel` | `p_match_id uuid, p_reason text default null` |
| `match_post_message` | `p_match_id uuid, p_code text` |
| `match_report` | `p_match_id uuid, p_reason text, p_seat_id uuid default null, p_request_id uuid default null, p_block boolean default false` |
| `match_block` | `p_match_id uuid, p_seat_id uuid default null, p_request_id uuid default null` |
| `match_unblock` | `p_block_id uuid` |
| `set_my_gender` | `p_gender text` |

Anon **and** authenticated, `publicByDesign`, no names or ids: `match_slots(p_venue_id uuid, p_from
timestamptz, p_to timestamptz)`, `match_invite(p_token text)`.

Service role only (edge `ticket-begin`): `ticket_payment_prepare(p_guest_id uuid, p_count int,
p_locale text, p_provider text)`. Edge `ticket-begin`: `POST {count, locale}`; a refusal body is
`{error, detail?}`.

- `match_start` refuses a NULL `p_idempotency_key` (`INVALID_ARGUMENT`; signature unchanged) and
  checks the key again under the mutex (R24).
- `set_my_gender` returns `{gender, gender_set_at, duplicate}`; refusals in order `AUTH_REQUIRED`,
  `ACCOUNT_REQUIRED`, `INVALID_ARGUMENT`, `GENDER_ALREADY_SET`.
- A player may not hold carrier seats in two overlapping live matches: `MATCH_TIME_CLASH` at start,
  join, request and approval (R41).
- Guest read windows are capped at 16 days (R27). Read shapes are `guest.md` §4.3 = `db.md` §4.6.12
  (R31): `match_detail` has a restricted shape marked `restricted: true`; `match_quote.refusal` and
  `me.refusal` never carry `NEED_TICKETS`; `my_tickets` is `money.md` §5.7.

### 1.7 Staff RPCs (0257, 0259, 0262, 0265; `authenticated` + role guard; branch via `is_staff_at`)

| RPC | Args | Roles |
| --- | --- | --- |
| `match_settings` | `p_venue_id uuid default null` | manager, owner |
| `set_match_settings` | `p_patch jsonb, p_venue_id uuid default null` | owner |
| `desk_open_matches` | `p_from timestamptz, p_to timestamptz` | court_desk, manager, owner |
| `desk_match_states` | `p_reservation_ids uuid[]` | court_desk, manager, owner |
| `desk_match_detail` | `p_match_id uuid` | court_desk, manager, owner |
| `desk_start_match` | `p_start_at timestamptz, p_duration_min int, p_category text, p_visibility text, p_join_policy text, p_customer_id uuid default null, p_guest_name text default null, p_guest_phone text default null, p_gender text default null, p_extra_seats int default 0, p_court_id uuid default null, p_venue_id uuid default null, p_idempotency_key text default null` | court_desk, manager, owner |
| `desk_add_seat` | `p_match_id uuid, p_customer_id uuid default null, p_guest_name text default null, p_guest_phone text default null, p_gender text default null, p_idempotency_key text default null` | court_desk, manager, owner |
| `desk_remove_seat` | `p_seat_id uuid, p_reason text` | court_desk, manager, owner (`staff_error`/`duplicate` after booking: manager, owner) |
| `desk_cancel_match` | `p_match_id uuid, p_reason text` | court_desk, manager, owner |
| `mark_match_seats` | `p_seat_ids uuid[], p_attendance text` | court_desk, manager, owner |
| `desk_call_off_short` | `p_match_id uuid` | court_desk, manager, owner |
| `match_seat_settle` | `p_seat_ids uuid[], p_method payment_method, p_expected_owed_iqd bigint, p_tendered_iqd bigint default null, p_amount_iqd bigint default null, p_idempotency_key text default null, p_device_id text default null` | cashier, court_desk, manager, owner |
| `match_link_payment` | `p_payment_id uuid, p_allocations jsonb, p_idempotency_key text default null` | cashier, court_desk, manager, owner |
| `match_seat_write_off` | `p_seat_id uuid, p_reason text, p_pin text, p_device_id text default null` (a manager PIN grant, `PIN_GATED_RPCS`, R1) | court_desk, manager, owner |
| `set_match_ban` | `p_customer_id uuid, p_banned boolean, p_reason text` | manager, owner |
| `staff_set_customer_gender` | `p_customer_id uuid, p_gender text` | court_desk, manager, owner |
| `match_reports_open` | `p_venue_id uuid default null` | manager, owner |
| `resolve_match_report` | `p_report_id uuid, p_outcome text` (`dismissed`\|`banned`) | manager, owner |
| `guest_tickets` | `p_customer_id uuid` | court_desk, manager, owner |
| `ticket_cashout` | `p_customer_id uuid, p_purchase_payment_id uuid` | manager, owner |
| `day_close_online` | `p_day_session_id uuid default null` | manager, owner |
| `report_matches` | `p_from date, p_to date, p_filters jsonb default '{}'` | reports guard |

- `desk_start_match` and `desk_add_seat` refuse a NULL `p_idempotency_key`; so do
  `match_seat_settle` and `match_link_payment` (signatures unchanged).
- `match_seat_settle`: `p_expected_owed_iqd` is Σ `take_iqd` of the selected seats (a seat with a
  manual write-off can still be collected, and collecting clears the write-off, MD-11).
  `match_link_payment`: `p_allocations` may be `[]`, which only closes a live court-only tab at what
  was paid.
- `desk_remove_seat`, `desk_cancel_match` and `set_match_ban` take the R42 reason form.
- Staff reads and writes treat a sandbox match as not found. Desk seats are exempt from
  `MATCH_TIME_CLASH` and OM-37.
- Read shapes are `operator.md` §5.6 (DB builds `desk_open_matches`, `desk_match_states`,
  `desk_match_detail`; Money's names win in their money blocks, R31) and Money's shapes for
  `guest_tickets`, `booking_bill`, `booking_bill_states`, `unpaid_played_bookings`,
  `day_close_online`, `report_matches` and the report keys (`money.md` §14).

### 1.8 Re-issued functions (one owner each; each re-issued once, from its latest body)

| Function | Latest | Owner | Change |
| --- | --- | --- | --- |
| `trg_reservation_deposit`, `deposit_settle_success`, `deposits_due_for_reconcile`, `deposit_attention`, `deposit_refund_request`, `deposit_refund_manual`, `deposit_refund_retry`, `my_reservations`, `deposit_net_paid` | 0242 | Money (0258) | scoped to `purpose='deposit'`; `deposit_settle_success` expires holds before its first reservations write (R15); `deposit_attention` LEFT join and payer from the payment row; `deposit_refund_manual` also settles a ticket cash-out, from `refund_failed` only for both purposes (R23); `deposit_refund_retry` and `_manual` skip the branch check and locks for a chain ticket row |
| `deposit_apply`, `deposit_status`, `deposit_refund_apply` | 0242 | Money (0259) | ticket branch; purpose-aware status; ticket refund push `tickets_refunded` via `match_notify` (kind `match_update`, route `tickets`) |
| `court_fee_remaining`, `compute_tab_totals`, `booking_bill`, `booking_bill_states` | 0106/0211/0242 | Money (0262) | nets written-off shares; court cap; `match`, `seats[]`, `court_written_off_iqd`; `booking_bill`'s online list scoped to deposits |
| `mark_reservation` | 0089 | DB (0262) | refuses `no_show` on a match booking with `MATCH_MARK_SEATS` |
| `set_customer_flags`, `customer_counts`, `customer_record`, `customer_search`, `customer_directory` | 0242/0065/0077/0148 | DB (0262) | `match_ban` written only by `set_match_ban` and carried over; seat no-shows counted; gender; matches |
| `trg_sanitise_profile`, `handle_new_user` | 0080/0069 | Guest (0256) | name parts |
| `notify_staff` | 0193 | DB (0261) | `c_title_keys` + `match_report_new`, last (R5 as amended by R43) |
| `hold_slot`, `staff_create_reservation` | 0252/0217 | DB (0263) | `match_court_claimed` → `SLOT_TAKEN` detail `match_waiting` (R22) |
| `delete_my_account` | 0077 | DB (0264) | names/gender scrub + seats + requests + blocks; `ticket_refund_deleted` last, no match lock (R25) |
| `venue_settings_public` | 0208 | DB (0257) | `matches_enabled`, `match_fill_deadline_minutes` |
| `report_courts`, `reports_figures`, `unpaid_played_bookings`, `panel_headline` | 0219/0231/0096 | Money + Ops (0265) | matches block; online and ticket figures; match fields; the seven new keys at the end of `panel_headline`'s list |

`expire_stale_holds` is not re-issued; whoever re-issues it later re-issues its twin
`match_expire_holds` in the same file.

### 1.9 Push family (guest, templated; `_shared/guest-push.json`)

Kinds: `match_update`, `match_reminder`, `match_message`. Payload `{route, id, title_key, params,
dedupe?}`: route `'match'` with the match id, or `'tickets'` with `id` null (R3); params keys ⊆
`seats_taken`, `seats_total`, `minutes`. No names, no money. Title keys (each mapped to its kind in
`guest-push.json`, R3):

`request_new`, `request_expired`, `player_joined`, `player_left`, `request_approved`,
`request_declined`, `match_booked`, `match_waiting_court`, `deadline_warning`, `match_cancelled`,
`match_bumped`, `match_expired`, `match_moved`, `reminder_3h`, `organiser_handover`, `seat_removed`,
`seat_refilled`, `ticket_forfeited`, `tickets_refunded`, `msg_on_my_way`, `msg_running_late`,
`msg_cant_make_it`, `msg_bring_balls`.

Guest's triggers (0261) turn `match_events` and forfeited `match_ticket_events` into pushes by the
table of `guest.md` §4.6.3: `request_expired` is pushed only for the codes `match_full`,
`organiser_gone` and `closed`; a `no_court` ending pushes `match_cancelled`; `started`, `withdrawn`,
seat marks, `played`, `called_off_short` and a restored ticket push nothing (GD-3).
`tickets_refunded` is queued by Money's `deposit_refund_apply` through `match_notify`.

Staff: one `notify_staff` title key `match_report_new`, to the branch's managers and owners, payload
`{route:'staff', id: <report id>, title_key, params:{}}`, in `_shared/staff-push.json` and
`send-push/staffStrings.ts`. Those, the test and the `notify_staff` re-issue ship in the 0261
commit (R43).

### 1.10 Error codes

Guest (mobile `CODE_TO_KEY` in `apps/mobile/src/features/booking/errors.ts`, literal entries):
`MATCHES_OFF`, `MATCH_NOT_FOUND`, `MATCH_CLOSED`, `MATCH_FULL`, `MATCH_SLOT_FULL`, `MATCH_TOO_LATE`,
`MATCH_LIMIT_REACHED`, `MATCH_SEAT_LIMIT`, `MATCH_APPROVAL_REQUIRED`, `MATCH_NOT_APPROVAL`,
`MATCH_ALREADY_IN`, `MATCH_GENDER_MISMATCH`, `MATCH_UNAVAILABLE`, `MATCH_BANNED`, `MATCH_BOOKED`,
`NOT_ORGANISER`, `NEED_TICKETS`, `GENDER_REQUIRED`, `GENDER_ALREADY_SET`, `TERMS_REQUIRED`,
`REQUEST_NOT_FOUND`, `REQUEST_CLOSED`, `REQUESTER_INELIGIBLE`, `REQUEST_LIMIT`, `SEAT_NOT_FOUND`,
`SEAT_HOLDER_REQUIRED`, `SEAT_STARTED`, `REPORT_TARGET_INVALID`, `BLOCK_TARGET_INVALID`,
`TICKET_COUNT_INVALID`, `MATCH_TIME_CLASH` (R41; `matches.errors.timeClash`). Reused:
`AUTH_REQUIRED`, `ACCOUNT_REQUIRED`, `PHONE_REQUIRED`, `COURT_NOT_FOUND`, `SLOT_TAKEN`,
`PRICE_CHANGED`, `DEGRADED_LOCKOUT`, `SLOT_IN_PAST`, `CLOSED_DATE`, `OUTSIDE_HOURS`,
`BEYOND_HORIZON`, `NO_RATE`, `INVALID_DURATION`, `IDEMPOTENCY_CONFLICT`, `TOO_MANY_ATTEMPTS`,
`PAYMENT_NOT_FOUND`, `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `INVALID_ARGUMENT`; R6 adds the
`RATE_LIMITED` and `RETRY_LATER` entries. Keys and copy: `guest.md` §4.22 (`matches.errors.*`, with
the detail keys `tooLateAt`, `walletLimit`, `needTicketsCount`, `updateApp`).

Staff (operator `MAPPED_CODES`): `MATCHES_OFF`, `MATCH_NOT_FOUND`, `MATCH_NOT_FILLING`,
`MATCH_NOT_BOOKED`, `MATCH_NOT_STARTED`, `MATCH_FULL`, `MATCH_TOO_LATE`, `MATCH_SLOT_FULL`,
`MATCH_GENDER_MISMATCH`, `MATCH_SEAT_LIMIT`, `MATCH_BANNED`, `MATCH_MARK_SEATS`, `SEAT_NOT_FOUND`,
`SEAT_NOT_STARTED`, `SEAT_MARK_LOCKED`, `SEAT_OWED_CHANGED`, `NOTHING_OWED`,
`PAYMENT_NOT_ON_MATCH`, `AMOUNT_OVER_SEAT`, `PAYMENT_OVER_ALLOCATED`, `REPORT_NOT_FOUND`,
`REPORT_CLOSED`, `NO_UNUSED_TICKETS`, `MATCH_ALREADY_IN`, `TICKET_IN_USE`, `CUSTOMER_NOT_FOUND`
(R11), `MATCH_BOOKING_NO_CAFE` (R20), and `RPC_MISSING` (renderer-minted from PostgREST
`PGRST202`, operator only). `MATCH_MARK_SEATS` is also an override refusal. Reused: `FORBIDDEN`,
`VENUE_MISMATCH`, `REASON_REQUIRED`, `INVALID_TRANSITION`, `GUEST_REQUIRED`, `SLOT_TAKEN`,
`PAYMENT_NOT_FOUND`, `PAYMENT_STATE`, `PIN_GRANT_REQUIRED`, `PIN_INVALID`, `PIN_LOCKED`,
`INVALID_ARGUMENT`, `BOOKING_TAB_OPEN`, `NO_OPEN_DAY`, `TENDER_SHORT`, `INVALID_AMOUNT`,
`COURT_NOT_FOUND`, `INVALID_DURATION`, `CLOSED_DATE`, `OUTSIDE_HOURS`, `NO_RATE`,
`IDEMPOTENCY_CONFLICT`, `DAY_NOT_FOUND`. `MATCH_TIME_CLASH` has no staff entry: no desk call raises
it. Copy: `operator.md` §5.20.

Edge `ticket-begin`: `BAD_REQUEST`, `PROVIDER_UNAVAILABLE`, `RETRY_LATER` plus the SQL codes, in a
body `{error, detail?}`.

**Details** (PostgREST `details`, or the edge body's `detail`):

| Code | Detail |
| --- | --- |
| `NEED_TICKETS` | `{"needed","available","buy"}` as text |
| `MATCH_TOO_LATE` | minutes (the fill deadline + 60) |
| `MATCH_LIMIT_REACHED` · `MATCH_SLOT_FULL` · `REQUEST_LIMIT` | the cap · the overlapping count · `5` |
| `REQUESTER_INELIGIBLE` | the code the requester now fails (incl. `MATCH_TIME_CLASH`) |
| `MATCH_GENDER_MISMATCH` | `friend` (guest) or `p_gender` (desk) |
| `PRICE_CHANGED` | `{"quoted_iqd","current_iqd"}` |
| `TICKET_COUNT_INVALID` | `p_count` or `wallet_limit` |
| `TICKET_IN_USE` | JSON text `{reason: in_use\|reserved\|restorable, count, until_at}` |
| `SEAT_MARK_LOCKED` | `day_closed`, `ticket_used`, `court_reused`, `replaced`, `paid`, `match_ended` |
| `INVALID_TRANSITION` | `marked`, `ended`, `match_ended`, `use_attendance`, `not_carrier`, `not_short`, `nobody_came`; `live_tickets` (the sandbox-flip guard) |
| `FORBIDDEN` | `manager_required` |
| `PAYMENT_STATE` | `ticket`, `over_paid`, `empty`, or the payment's status |
| `INVALID_ARGUMENT` | the argument or settings key; `p_idempotency_key`, `p_allocations`, `already_linked`, `p_reason` (a note over 200) |
| `SLOT_TAKEN` | `match_waiting` (R22) |
| `SEAT_OWED_CHANGED` · `NOTHING_OWED` · `BOOKING_TAB_OPEN` | `expected X, now Y` · the seat id · the tab id |

### 1.11 Client names

- Mobile routes: `matches` (`matches`), `match/[id]` (`match-detail`), `match-new`, `m/[token]`
  (`match-link`), `match-report`, `blocked-players`, `tickets`; `+native-intent.ts`. Query-key root
  `['match']` (tickets under `['match','tickets']`), never persisted: `matchKeys` in
  `apps/mobile/src/features/matches/keys.ts` with its mutation names (`guest.md` §4.23); idempotency
  prefix `MOBILE:match.start:`. i18n catalog pair `matches.en.ts` / `matches.ar.ts`.
- Mobile code: `src/features/matches/` (`api`, `hooks`, `logic`, `state`, `links`, `pendingJoin`,
  `continuation`, `tickets`, `pushRoutes`, `errors`); `features/booking/pendingIntent.ts`;
  `PendingPayment.purpose` and `.after` (the ticket continuation); `DepositEdgeError.detail`;
  `rpcErrorDetail`; components `SeatGrid`, `RequestRow`, `QuickMessageBar`, `GenderAsk`,
  `MatchRow`, `MatchEntryRow`, `MatchRulesCard`, `MatchRestrictedCard`, `MatchPoster`,
  `nativeChoice`; `siteUrl()` exported from `src/lib/legal.ts`.
- Shared: `packages/i18n/src/plural.ts` (`pluralForm`, `countPhrase`), used by the phone and the
  operator.
- Push: `_shared/guest-push.json`, `send-push/guestStrings.ts`.
- Operator: route `/desk/matches/$id` (inherits `/desk`; no `ROUTE_ROLES` key); capabilities
  `runMatches`, `banFromMatches`, `reviewMatchReports`, `takeSeatPayment`, `writeOffSeat`,
  `cashOutTickets`; query keys `QK.deskMatches.{all, open, states, one, tickets, reports,
  settings}`; lane catalog `ws.matches` (+ `opErrors.matches`); `lib/stationReach.tsx`
  (`StationReachProvider`, `useStationReach`); `MATCH_RESERVATION_NAME = 'Open match'` (the DB
  literal); `MATCH_REASON_CODES`; `PaymentPane` props `subtitle`, `allowPartial`;
  `ReasonCodePrompt` prop `noteMode`; icons `link`, `ticket`; `op.reasons.{conduct, court_needed,
  walked_out, no_shows, reported}`; search params `/desk?kind=match`, `/desk/matches/$id?customer=`,
  `/desk/customers?attach=match&match=`, `/desk/customers/new?attach=match&match=`; assistant map
  `FEATURE_ROUTE.matches` and `CATALOG_FILE_ROUTE.matches` = `'/desk'`.
- Web: `app/[locale]/m/[token]/page.tsx`, `src/lib/site/matchInvite{,.server}.ts`, strings
  `matches.web.*`; `LINK_PATHS` gains `/m/*`, `/en/m/*`, `/ar/m/*`.
- Edge: `ticket-begin` (new, `verify_jwt = true`).
- Cron: `tp_match_sweep` (30 s with the per-minute fallback of 0242).
- Scripts: `scripts/create-review-account.mjs --sandbox`.

### 1.12 Merge rulings (2026-09-28; they amend §1.1–§1.11 and win over any lane section)

| # | Ruling |
| --- | --- |
| R1 | `match_seat_write_off(p_seat_id uuid, p_reason text, p_pin text, p_device_id text default null)`: roles court_desk, manager, owner; a **manager PIN grant** authorises it (the till's `apply_discount` model: `verify_manager_pin` mints, the RPC spends with `consume_pin_grant(p_device_id)`). `PIN_GATED_RPCS` (`packages/core/src/schemas/mutations.ts`) gains it. Capability `writeOffSeat`: court_desk, manager, owner. |
| R2 | `tabs.court_cap_iqd` is set by `match_seat_settle` on the tab it settles (a fresh tab, or an adopted empty live tab) and by `match_link_payment` when it closes a live court-only tab at what was paid on it. |
| R3 | Push payload `route` is `'match'` or `'tickets'` (`id` null, used only by `tickets_refunded`). Title keys gain `request_expired` and `match_moved`. `guest-push.json` maps each key to its kind: `reminder_3h` → `match_reminder`, `msg_*` → `match_message`, every other key → `match_update`. |
| R4 | The unique occupying `(match_id, seat_no)` index covers `in` and `attended` only (a walk-in may take a no-show's seat number after start, `replaces_seat_id` = the no-show seat); `(match_id, guest_id)` for account seats keeps `in`, `attended`, `no_show`. |
| R5 | §1.8 gains `notify_staff` (latest 0193, owner DB, 0261): `c_title_keys` + `match_report_new`; `_shared/staff-push.json` and `send-push/staffStrings.ts` gain it; `send-push` ships in its own push before any migration that can queue a new key or kind. |
| R6 | Mobile `REQUEST_NOT_FOUND` keeps one `CODE_TO_KEY` entry, re-pointed to a neutral `errors.requestGone`; `RATE_LIMITED` gains a `CODE_TO_KEY` entry (`errors.tooManyRequests`); `RETRY_LATER` maps to `deposit.errors.providerUnavailable`. |
| R7 | `booking_payments.venue_id` becomes nullable: `booking_payments_anchor` adds deposit ⇒ `venue_id` not null, ticket ⇒ `venue_id` null (tickets are chain-wide). |
| R8 | The lock-order walker also covers `ticket_refund_deleted` and `tickets_cash_out`. `match_tickets.cashout_payment_id` always equals `purchase_payment_id`; nobody reads it as another payment. |
| R9 | `mark_match_seats.p_attendance` ∈ `attended`, `no_show`, `in` (undo); an undo of `attended` whose ticket is already locked elsewhere is refused `SEAT_MARK_LOCKED`. Unmarked seats become `attended` when the booking completes. |
| R10 | Switching `matches_enabled` off stops new starts and joins of new players; filling and booked matches carry on. |
| R11 | Staff also map `MATCH_ALREADY_IN`, `TICKET_IN_USE`, `CUSTOMER_NOT_FOUND`. Client error maps and their catalog keys are written by the DB build step together with the SQL that raises them. |

**Rulings after the two reviews (2026-09-28).** R12–R14 are Parsa's answers. The rest resolve review
findings: `C1`… = `drafts/review-concurrency-money-2026-09-28.md`, `G1`…/`D1`… = `drafts/review-decisions-rules-2026-09-28.md`.

| # | Ruling |
| --- | --- |
| R12 | (Parsa) **Call-off needs every carrier seat marked first**; otherwise `MATCH_MARK_SEATS`. "Short" means at least one carrier seat is `no_show` after any R4 refill. (C11, D7) |
| R13 | (Parsa) **Cash-out waits while any ticket of that purchase is reserved or in use** (`TICKET_IN_USE`, detail = until when), and also while a forfeited ticket of that purchase could still be restored (its business day is open). It is one Qi refund for all of the purchase's unused tickets. DF-20 follows the same rule; `ticket_refund_deleted` skips purchases that are not `succeeded`, so its queue cannot jam. (C4, D17) |
| R14 | (Parsa) **The owner's assistant may see players' names and gender, as the owner does in the app.** `assistant_readable_columns` may include them. The privacy policy names the assistant's AI provider as a processor of names and gender when the assistant is on. The SEC-29 analytics-insights gate is unchanged. |
| R15 | **Lock order in `match_lock`:** courts (id order) → the match's booking row FOR UPDATE → `expire_stale_holds` (one statement, branch-wide) → `lock_match_venue`. The re-issued `deposit_settle_success` runs its hold expiry first. Add a `check:locks` fixture test for both. (C1, G1, C12) |
| R16 | **Attendance undo only while the match is `booked`.** Never on `played` or `no_show`. Invariant: no `in_use` ticket on a terminal match. (C2) |
| R17 | `ticket_lock` takes a `reserved` ticket only for its own request. Every ticket helper asserts that the ticket belongs to the seat or request it moves. (C3) |
| R18 | `match_try_book` drops deleted and banned holders' seats before counting to four. A deleted holder's ticket is refunded (DF-20), never forfeited. (C5) |
| R19 | **Seat money has its own lock:** `app.lock_match_money(match)`, ranked after `day_sessions` and before `tabs`, taken by every writer that changes what a seat owes (`match_seat_settle`, `match_link_payment`, `match_seat_write_off`, marks). (C6, D4) |
| R20 | **DF-16 is enforced on the server:** a guard trigger on `orders` and `tab_adjustments` (the shop-guard shape, 0244) refuses café lines on a match booking's tab with `MATCH_BOOKING_NO_CAFE` (staff code). (C7, D16) |
| R21 | R4 end to end: an open seat number is one with no carrier; the undo of a no-show whose number was re-seated is refused `SEAT_MARK_LOCKED`; "short" is computed over carriers. (C8, D8) |
| R22 | **An `awaiting_court` match keeps its court:** `hold_slot` and staff creates refuse the last non-live court while a match waits for it. "Firm" means every live row except holds. The wait ends when the blocking hold lapses (book) or confirms (bump), so at most the hold TTL. (C9, Q4) |
| R23 | **"Settled another way" only from `refund_failed`**, for tickets and, in the same re-issue of `deposit_refund_manual`, for deposits. This closes a double-pay hole that exists in the deposit code today. (C10) |
| R24 | The start idempotency key is checked again under the mutex. (C13) |
| R25 | Account deletion: `delete_my_account` takes no match locks and calls only `ticket_refund_deleted`; the sweep leaves the matches. (D1) |
| R26 | **The guest push fan-out belongs to lane Guest, in 0261:** an AFTER INSERT trigger on `match_events` and on `match_ticket_events` (`forfeited`) calls `match_notify`; the callers of `match_sync_reminders` are named there; `tickets_refunded` also goes through `match_notify`. (G, D26–D27) |
| R27 | Guest read windows (`match_slots`, `open_matches`) are capped at 16 days. (D11) |
| R28 | **Gates travel with each migration.** Its `rls-matrix.ts` rows, allowlist and coverage-floor update, assistant coverage entries, SEC-20 declarations, error-code mappings and catalog keys land in the same step. CONTINUE step 2g is dissolved into 2a–2f. (G3a) |
| R29 | SEC-20: `payment_match_seats` is not declared (no guest link); the six new `LINK_COLUMNS` go in one edit; walk-in name and phone are declared as they really are; `friend_genders` is declared and scrubbed; the deletion proof covers gender, seats, requests and blocks. (G5) |
| R30 | Assistant coverage: every created function gets an entry, including Money's six internals and Guest's two. The contract doc stays `index:doc`, so the map is regenerated with each contract edit. (G8) |
| R31 | **Read contracts:** the pick column of both reviews' disagreement tables is binding (concurrency D1–D17; rules §5). Notably: `desk_open_matches` returns an envelope; `desk_match_detail` carries `can` and `money.unassigned[]`; `open_matches` returns no names; the tickets DDL is owned by DB; `guest_tickets` is owned by Money. |
| R32 | Guest dead ends are closed: a restricted link viewer gets a proper screen; a linked desk seat has a state; a desk removal reads "Removed by the venue"; `no_court` has copy. (§4.1) |
| R33 | `match_settings` and `match_reports_open` check the role before resolving the venue. (G4) |
| R34 | The index waiver goes in the commit message; `check-migrations` runs locally before any migration push; `match_seats_ticket_fk` is added NOT VALID. (G2) |
| R35 | The ban reason is a fixed code (`conduct`, `no_shows`, `reported`, `other`), with an optional note kept in the audit row. (Q3) |
| R36 | Match reports are kept 12 months, then deleted by the sweep; the privacy text says so. (Q5) |
| R37 | Unmarked carrier seats become `attended` when the booking completes, or at `end_at` + 3 h through the sweep. (Q4) |
| R38 | Staff Arabic: numbers through `formatNumber` (and tests that expect what the code produces); verbal nouns instead of imperatives such as "ألغِ"; plural forms for counted phrases; `isolateLtr` on "+1". (G9, §4.3) |
| R39 | (Parsa confirmed 2026-09-28) (lane merge) After the start, an unrefilled `left_late` carrier counts as absent: a match with one is **short** and can be called off. (db D-3; settles `operator.md`'s owner question 1) |
| R40 | (Parsa confirmed 2026-09-28) (lane merge) Bans are chain-wide, as `customer_flags` is: a manager or owner at any branch bans and lifts for every branch. (settles `operator.md`'s owner question 2) |
| R41 | (lane merge) A player may not hold carrier seats in two overlapping live matches (`filling`, `awaiting_court`, `booked`): `MATCH_TIME_CLASH` at start, join, request, and approval (as the `REQUESTER_INELIGIBLE` detail). Desk seats are exempt. (db D-7, C15) |
| R42 | (lane merge) `desk_remove_seat`, `desk_cancel_match` and `set_match_ban` take `p_reason` as `<code>` or `<code>: <note>` (note ≤ 200). Only the code is stored on rows, events and the flag label; the whole text goes in the audit row. `match_seat_write_off` takes the bare code. (db D-9, `operator.md` §5.13.8) |
| R43 | (lane merge) R5 amended: the staff key `match_report_new` (its `staff-push.json` entry, `staffStrings.ts` copy and test) ships in the same commit as the `notify_staff` re-issue (0261, push D), not in push A. Safe because no report can exist while `matches_enabled` is false, and it goes on only after push D's `functions-deploy` run is green. (`guest.md` §4.7.5) |

Owner questions carried to the end of the build (not blocking): headline revenue with written-off shares; who bears Qi fees on a cash-out; cash handed back by "settled another way" leaving no till movement (as for deposits today); tax on seat money.

## 2. Database core (lane DB)

The final contract is [`db.md`](db.md): binding for lane DB under §1 (§1.12 wins where they differ).
It merges `drafts/db-2026-09-28.md` with both reviews and R1–R43, and replaces the draft for
building: locks, state machines, every DB migration with the gate artifacts of its commit, the
interfaces with the other lanes, situations, tests and known limits. Its §9 changes to §1 are
folded into §1 above.

## 3. Money and tickets (lane Money)

The final contract is [`money.md`](money.md): binding for lane Money under §1 (§1.12 wins where
they differ). It merges `drafts/money-2026-09-28.md` with both reviews and R1–R43, and replaces the
draft for building: where every dinar lives, the ticket purchase and ledger, cash-out and DF-20,
seat money and its engine, the DF-16 wall, reports, invariants, tests and known limits. Its §14
changes to §1 are folded into §1 above.

## 4. Guest app, web, push, links, legal (lane Guest)

The final contract is [`guest.md`](guest.md) (numbered §4.0–§4.31): binding for lane Guest under §1
(§1.12 wins where they differ). It merges `drafts/guest-2026-09-28.md` with both reviews and R1–R43,
and replaces the draft for building: 0255, 0256, Guest's part of 0261, `send-push`, every guest
screen, the web invite page, links, i18n, legal and store copy, tests and known limits. Its §4.30
changes to §1 are folded into §1 above.

## 5. Operator (lane Operator)

The final contract is [`operator.md`](operator.md) (numbered §5.1–§5.27): binding for lane Operator
under §1 (§1.12 wins where they differ). It merges `drafts/operator-2026-09-28.md` with both reviews
and R1–R43, and replaces the draft for building: capabilities, reads and writes, every desk surface,
errors, i18n, tests, e2e and known limits. Its "Additions to §1" are folded into §1 above.

## 6. Rollout, tests, known limits

The build order and the resume steps are in [`CONTINUE.md`](CONTINUE.md). Sources: `guest.md` §4.8,
`money.md` §12, `db.md` §4 and `operator.md` §5.26.

### 6.1 Landing order

Root `CLAUDE.md` governs every push: the gates first, every run watched to green, pushes batched,
never an AI co-author. Parsa pushes; the harness never deploys to hosted.

| Push | Contents | After | Check |
| --- | --- | --- | --- |
| **A** (functions) | `guest-push.json`, `guestStrings.ts`, the `send-push` guest branch, `send-push-guest.test.ts`; Money's `_shared/deposits.ts` type change and `createAtGateway` extraction may ride. No staff key (R43), no `ticket-begin` | — | `functions-deploy.yml` green |
| **B** | 0253, 0254, 0255 (CHECK widenings) and `outbox-kinds.test.ts` | A deployed (a stale `send-push` fails an unknown kind for good) | `db-migrate.yml` green, 0 pending |
| **C** | 0256 with its gates, the mobile `matches` catalog pair, R6 | B hosted | as B |
| **C2** | the phone's names plumbing (JS only: OTA or the next build) | C hosted (an earlier build that selects `given_name` breaks every profile read) | smoke EN + AR |
| **D** | 0257–0265, one commit per file with its gates (R28), `types.gen.ts` and the index waiver in the commit message (R34); 0258 never split; 0259, 0260 and 0261 in the same push (`match_notify` binds late); the 0261 commit carries the staff key (R43); `matches_enabled` false everywhere | C hosted | `db-migrate.yml` and `functions-deploy.yml` green (0262's `_shared/mutation-types.json` edit starts the latter); `cron.job` has `tp_match_sweep` |
| **E** (functions) | `ticket-begin`, `config.toml` `verify_jwt = true`, its coverage entry and provider test | 0259 hosted | `functions-deploy.yml` green |
| Operator | commits (a)–(f) of `operator.md` §5.26, then the tag | 0262 and 0265 hosted | operator gates and `pnpm e2e`; an older server shows no match UI (`RPC_MISSING`) |
| **F** (web, docs) | `/[locale]/m/[token]`, `LINK_PATHS`, the store docs (not the legal catalogs); Vercel `APPLE_TEAM_ID` set first | `match_invite` hosted (D) | the Vercel build green; the AASA lists `/m/*`, `/en/m/*`, `/ar/m/*` |
| **G** (native) | every guest screen, `intentFilters`, `EXPO_PUBLIC_LINK_DOMAIN` ×3, `+native-intent.ts`; Parsa runs the production `eas build` | D, E and F live | the device checks of `guest.md` §4.27 |
| trial | `matches_enabled` on at one branch; sandbox review profiles | G on TestFlight | — |
| **1.0** | the legal catalogs, the web terms section and `CURRENT_TERMS_VERSION` in one commit; the store build; then, by migration, `match_terms_version` once that build is on phones; store answers, URLs, Android fingerprints | — | — |

`matches_enabled` stays false until the whole milestone is live, so no ticket can be bought and no
match started before then. Before real money: the ASK QI items (`docs/client/qi-card-activation.md`
A8).

### 6.2 Tests

| Lane | Files |
| --- | --- |
| DB | `packages/db/tests/`: `matches-lifecycle`, `matches-tickets`, `matches-bump` (incl. the two-connection bump), `matches-cascade`, `matches-desk`, `matches-sweep`, `matches-privacy`, `lock-order-matches` (R15); extended `match-shares` parity, `account-deletion`, `stored-fields`, `customers`, `booking-integrity`, `rls-matrix` drop 24, `helpers` (`createTestMatch`, `grantTestTickets`); the gates `check:locks`, `authz`, `rpc-registry`, `assistant-coverage`, `broadcast`, `analytics`, `migrations`, `safeupdate`, `error-codes`, and `db:types` with no diff |
| Money | `tickets.test.ts` (0259), `match-money.test.ts` (0262, 0265), `deposits.test.ts` (the R23 edit only), `desk-payment.test.ts` unmodified, `reports.test.ts`, `payments-provider.test.ts` (`ticket-begin`); `assertMatchMoney` and `assertTicketLedger` (invariants M1–M12, T1–T12) after every case of these and of DB's match suites |
| Guest | `outbox-kinds`, `profile-names`, `guest-push`, `send-push-guest`, `send-push-staff` (db tests); mobile vitest (`features/matches/__tests__`, the deposit, push, error and query-default suites), the smoke walk with seven new routes (`test:smoke`), `plural.test.ts`; web `m/[token]/page.test.tsx`, `matchInvite.test.ts`, `proxy.test.ts`, the applinks case, `site-css`; the device checks |
| Operator | node tests of the pure modules (`matchLogic`, `startMatchLogic`, `assignLogic`, `matchSettingsLogic`, `matchReportsLogic`, `ticketsLogic` and the edited logic files); jsdom (`MatchPlayersPanel`, `AddSeatDialog`, `StartMatchDialog`, `MatchDetail`, `AssignPaymentDialog`, `TicketsPanel`, `MatchSettingsPanel`, `MatchReportsPanel` and the existing suites); e2e `operator-matches.spec.ts`, EN and AR |

### 6.3 Known limits

- The booking literal `'Open match'` is English wherever a screen skips `bookingLabel` (staff phone
  lists, Telegram summaries, report drill rows, `unpaid_played_bookings.guest_name`).
- The guest grid and the desk grid do not mark a court kept for an `awaiting_court` match; a tap or a
  create there gets `SLOT_TAKEN` (at most for the hold's TTL).
- Moves, extends, event blocks and the deposit re-create are not refused on a waiting match's court;
  they bump it (only `hold_slot` and staff creates are guarded, R22).
- Bump warnings exist only in the desk's new-booking dialog: a move, a drag, a series, a block or a
  tournament's event blocks can bump a filling match with no warning.
- A bump deferred by a busy mutex waits for the next sweep run (about 30 s); a loaded branch can be
  skipped for several runs.
- An all-absent booked match (every carrier a late leaver) is ended `no_show` by the sweep; its
  booking keeps its status and its money nets to zero.
- On a `played` match, corrections change seats and tickets, not the match status.
- A family name that starts with a non-article `ال` (`الياس`) loses it in the initial; email-local
  names show as they are.
- Walk-in names and phones typed by the desk are kept; typed walk-ins build no customer history.
- Desk seats are exempt from the time-clash and OM-37 checks: the desk vouches.
- Qi's refund time limit may refuse a late cash-out or DF-20 refund; it lands in `refund_failed`
  for a manager to settle by hand.
- A refund stuck in `refund_pending` can be settled by hand only after it turns `refund_failed` (up
  to ten reconciler attempts, R23).
- Cash-out waits for a purchase's tickets to come back and for the day of any fresh forfeit to close.
- The credit pool credits in a fixed order; a wrong Assign link cannot be undone, it only mislabels
  who paid.
- A live court-only tab on a match booking blocks day close until it is paid or assigned.
- A restored forfeit leaves every past period's forfeit figure.
- A cashier holds `takeSeatPayment` but no cashier screen shows seats.
- No discount or promotion on a match booking (R20); a write-off has no undo except collecting.
- The invite preview is a static image; the web page cannot tell a gone match from one that never
  existed (no oracle, by design).
- Android links open the web page until the Play fingerprints are set; a staging build answers
  `MATCH_NOT_FOUND` to a production link.
- Seat joins reach the Book chips on the 60 s poll; builds older than push G open nothing for a match
  push.
- No rail badge for open player reports.
