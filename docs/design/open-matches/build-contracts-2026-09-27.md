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
section and lists it under "Additions to §1"; the merge folds it back here.

### 1.1 Migrations

Every file opens with `set lock_timeout = '3s'; set statement_timeout = '60s';`, re-issues functions
from their latest body, uses `$<name>_0NNN$` tags, and ships `types.gen.ts` and both catalogs in the
same commit. Indexes on the new (empty) tables: `MIGRATION-RISK-ACCEPTED` in the PR body.

| Ordinal | File | Owner lane | What |
| --- | --- | --- | --- |
| 0249 | `customer_flags_match_ban` | DB | CHECK widening only: `+ 'match_ban'` |
| 0250 | `booking_payments_ticket_checks` | Money | CHECK widening only: `purpose` + `'ticket'`; `refund_reason` + `'ticket_cashout'`, `'account_deleted'` |
| 0251 | `outbox_match_kinds` | Guest | CHECK widening only: `+ 'match_update','match_reminder','match_message'`. After `send-push` is deployed with the guest family |
| 0252 | `profile_names_gender` | Guest | profile columns, sync + sanitiser triggers, backfill, `handle_new_user`, `set_my_gender` |
| 0253 | `match_settings` | DB | settings columns, `venue_settings_public`, `match_settings` / `set_match_settings` |
| 0254 | `match_tables` | DB + Money | every table of §1.2; `booking_payments` anchor; `tabs.court_cap_iqd`; the 0242 hooks scoped to `purpose='deposit'` (same file, before any ticket row can exist) |
| 0255 | `ticket_purchase` | Money | `ticket_payment_prepare`, ticket branch in `deposit_apply`, `deposit_status` purpose-aware, `my_tickets`, cash-out |
| 0256 | `match_core` | DB | internal functions (§1.5) |
| 0257 | `match_guest_rpcs` | DB | guest reads and writes (§1.6) |
| 0258 | `match_desk_money` | DB + Money | staff RPCs (§1.7), seat money, re-issues (§1.8) |
| 0259 | `match_reservation_triggers` | DB | bump + cascade triggers, `match_sweep`, cron `tp_match_sweep` |
| 0260 | `match_account_deletion` | DB | `delete_my_account` re-issued once, from 0077, carrying 0252's name/gender scrub |
| 0261 | `match_reports` | Money + Ops | `day_close_online`, `report_courts` matches block, `reports_figures` keys, `unpaid_played_bookings` |

### 1.2 Tables and columns

All branch tables: `venue_id uuid not null references venues`, the `zz_branch_guard` trigger with the
link pairs named, RLS on, no insert/update/delete grant (writes only through definer RPCs), staff
select policies in the 0234 form where a direct read is wanted.

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
Unique occupying `(match_id, seat_no)` and `(match_id, guest_id) where kind='account'` over the
occupying statuses `in`, `attended`, `no_show`.

**`match_requests`** (branch). `id`, `venue_id`, `match_id`, `guest_id`, `seats_requested` (1..3),
`friend_genders text[]`, `status`, `decided_at`, `created_at`. Unique `(match_id, guest_id) where
status='pending'`. Its tickets are the `match_tickets` rows whose `request_id` points at it.

**`match_events`** (branch, append-only via `app.forbid_mutation()`). `id bigint identity`,
`venue_id`, `match_id`, `type`, `actor` (`guest`|`staff`|`system`), `actor_guest_id`,
`actor_staff_id`, `seat_id`, `request_id`, `code` (≤ 40), `data jsonb` (ids and counts only), `at`.

**`match_tickets`** (chain-wide, no `venue_id`, no guard; like `customer_flags`). `id`, `guest_id`
→ profiles, `status`, `price_iqd`, `purchase_payment_id` → booking_payments, `sandbox`,
`request_id`, `seat_id`, `forfeited_venue_id`, `forfeited_seat_id`, `forfeited_at`,
`cashed_out_at`, `cashout_payment_id`, `created_at`, `updated_at`. CHECKs: `reserved ⇔ request_id
not null`, `in_use ⇔ seat_id not null`, `forfeited ⇒ forfeited_at, forfeited_venue_id`.

**`match_ticket_events`** (chain-wide, append-only). `id bigint identity`, `ticket_id`, `guest_id`,
`type`, `venue_id` (nullable), `match_id`, `seat_id`, `request_id`, `payment_id`, `actor_staff_id`,
`at`.

**`match_blocks`** (chain-wide). `id`, `blocker_id`, `blocked_id`, `created_at`; unique pair;
`blocker_id <> blocked_id`.

**`match_reports`** (branch). `id`, `venue_id`, `match_id`, `reporter_id`, `reported_id`,
`seat_id`, `request_id`, `reason`, `status`, `reviewed_by`, `reviewed_at`, `created_at`. Unique
`(reporter_id, reported_id, match_id)`.

**`match_exclusions`** (branch). `match_id`, `guest_id`, `venue_id`, `reason`, `created_at`;
primary key `(match_id, guest_id)`.

**`payment_match_seats`** (branch, append-only). `payment_id` → payments, `match_seat_id`,
`venue_id`, `amount_iqd` (> 0), `linked_by` → staff, `created_at`; primary key `(payment_id,
match_seat_id)`.

**Changed tables.**
- `profiles`: `given_name`, `family_name` (each 1..39 / ≤ 39, so `concat_ws` ≤ 80), `gender`,
  `gender_set_at`, `gender_set_by` (`guest`|`staff`).
- `customer_flags.type`: + `match_ban`.
- `booking_payments`: `purpose` in (`deposit`, `ticket`); `hold_id` and `reservation_id` nullable;
  `ticket_count smallint`; constraint `booking_payments_anchor`: deposit ⇒ hold and reservation set,
  `ticket_count` null; ticket ⇒ hold and reservation null, `ticket_count` 1..3. The existing
  `booking_payments_one_active` index (on `hold_id`) never matches a ticket row.
- `tabs.court_cap_iqd iqd null`: when set, the tab's court line is `least(court_cap_iqd,
  court_fee_remaining(...))`. Set only by `match_seat_settle` on a fresh tab.
- `venue_settings`: `matches_enabled boolean not null default false`,
  `match_fill_deadline_minutes int not null default 120` (60..2880).
- `platform_settings`: `match_ticket_price_iqd bigint not null default 10000` (1,000..1,000,000,
  multiple of 250), `max_filling_matches_per_guest int not null default 3` (1..10),
  `match_terms_version text` (null = any accepted version).

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
| `match_events.type` | `started`, `requested`, `approved`, `declined`, `withdrawn`, `request_expired`, `joined`, `left`, `left_late`, `refilled`, `removed`, `organiser_changed`, `awaiting_court`, `booked`, `bumped`, `expired`, `cancelled`, `moved`, `deadline_warning`, `message`, `seat_attended`, `seat_no_show`, `seat_unmarked`, `called_off_short`, `played` |
| `match_reports.reason` | `offensive_name`, `abusive_behaviour`, `harassment`, `unsafe_play`, `no_show`, `other` |
| `match_reports.status` | `open`, `dismissed`, `actioned` |
| desk remove reasons | `customer_request`, `conduct`, `staff_error`, `duplicate`, `other` |
| desk cancel reasons | `customer_request`, `court_needed`, `staff_error`, `duplicate`, `other` |
| write-off reasons | `walked_out`, `staff_error`, `other` |
| organiser cancel reasons | `not_enough_players`, `plans_changed`, `other` |

Occupying seat statuses: `in`, `attended`, `no_show`. A `left_late` seat is open for a refill but
its ticket stays locked until refilled (released) or start (forfeited).

### 1.4 Locks (the order `check-lock-order.mjs` enforces; `ORDER` gains the two new entries)

```
court_advisory (every active court of the branch, id order; app.lock_court)
  → reservations (app.expire_stale_holds; the match's own booking FOR UPDATE)
  → match_venue_advisory (app.lock_match_venue(venue): pg_advisory_xact_lock on 'app.matches:venue:'||id)
  → match_tickets (FOR UPDATE, id order)
```

- `matches`, `match_seats`, `match_requests` are never locked FOR UPDATE; the venue mutex
  serialises every change to them.
- Hold expiry always runs before the mutex.
- Desk money keeps the 0106 order `day_sessions → tabs → payments → till_shifts` and reads match
  rows without a lock; drift is caught by `SEAT_OWED_CHANGED`.
- The walker learns `app.lock_match_venue` beside `app.lock_court`, and also walks service-role
  functions (`match_sweep`, `deposit_apply`, `ticket_settle_success`).

### 1.5 Internal functions (0256; revoked from public, anon, authenticated)

`lock_match_venue(uuid)`, `match_lock(uuid) returns matches`, `match_guest(boolean) returns
profiles`, `match_visibility(matches, uuid, text, text) returns text`, `match_display_name(uuid)
returns jsonb`, `match_shares(bigint) returns bigint[]` (twin of core `splitEvenly`),
`match_pick_court(...)`, `match_court_free_firm(...) returns boolean`, `match_try_book(uuid)`,
`match_end(uuid, text, text, text)`, `match_recompute_organiser(uuid)`, `match_event(...)`,
`ticket_lock(uuid[], ...)`, `ticket_release(uuid[], text)`, `ticket_forfeit(uuid, uuid)`,
`guest_games_played(uuid) returns int`, `guest_match_no_shows(uuid) returns int`,
`match_seat_money(uuid) returns table(...)`, `court_fee_written_off(uuid, uuid) returns bigint`.

### 1.6 Guest RPCs (0255, 0257; `authenticated`; the first statement refuses a non-profile)

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
p_locale text, p_provider text)`.

### 1.7 Staff RPCs (0253, 0255, 0258; `authenticated` + role guard; branch via `is_staff_at`)

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
| `match_seat_write_off` | `p_seat_id uuid, p_reason text` (PIN-gated, `PIN_GATED_RPCS`) | manager, owner |
| `set_match_ban` | `p_customer_id uuid, p_banned boolean, p_reason text` | manager, owner |
| `staff_set_customer_gender` | `p_customer_id uuid, p_gender text` | court_desk, manager, owner |
| `match_reports_open` | `p_venue_id uuid default null` | manager, owner |
| `resolve_match_report` | `p_report_id uuid, p_outcome text` (`dismissed`\|`banned`) | manager, owner |
| `guest_tickets` | `p_customer_id uuid` | court_desk, manager, owner |
| `ticket_cashout` | `p_customer_id uuid, p_purchase_payment_id uuid` | manager, owner |
| `day_close_online` | `p_day_session_id uuid default null` | manager, owner |
| `report_matches` | `p_from date, p_to date, p_filters jsonb default '{}'` | reports guard |

### 1.8 Re-issued functions (one owner each; each re-issued once, from its latest body)

| Function | Latest | Owner | Change |
| --- | --- | --- | --- |
| `trg_reservation_deposit`, `deposit_settle_success`, `deposits_due_for_reconcile`, `deposit_attention`, `deposit_refund_request`, `deposit_refund_manual`, `my_reservations`, `deposit_net_paid` | 0242 | Money (0254) | scoped to `purpose='deposit'`; `deposit_attention` LEFT join and payer from the payment row; `deposit_refund_manual` also settles a ticket cash-out |
| `deposit_apply`, `deposit_status`, `deposit_refund_apply` | 0242 | Money (0255) | ticket branch; purpose-aware status; ticket refund push via `match_update` |
| `court_fee_remaining`, `compute_tab_totals`, `booking_bill`, `booking_bill_states` | 0106/0211/0242 | Money (0258) | nets written-off shares; court cap; `match`, `seats[]`, `court_written_off_iqd` |
| `mark_reservation` | 0089 | DB (0258) | refuses `no_show` on a match booking with `MATCH_MARK_SEATS` |
| `set_customer_flags`, `customer_counts`, `customer_record`, `customer_search`, `customer_directory` | 0242/0065/0077/0148 | DB (0258) | `match_ban` written only by `set_match_ban` and carried over; seat no-shows counted; gender; matches |
| `trg_sanitise_profile`, `handle_new_user` | 0080/0069 | Guest (0252) | name parts |
| `delete_my_account` | 0077 | DB (0260) | names/gender scrub + seats + requests + blocks + ticket refunds |
| `venue_settings_public` | 0208 | DB (0253) | `matches_enabled`, `match_fill_deadline_minutes` |
| `report_courts`, `reports_figures`, `unpaid_played_bookings` | 0219/0231 | Money + Ops (0261) | matches block; online and ticket figures; match fields |

### 1.9 Push family (guest, templated; `_shared/guest-push.json`)

Kinds: `match_update`, `match_reminder`, `match_message`. Payload `{route:'match', id, title_key,
params}`; params keys ⊆ `seats_taken`, `seats_total`, `minutes`. No names, no money. Title keys:

`request_new`, `player_joined`, `player_left`, `request_approved`, `request_declined`,
`match_booked`, `match_waiting_court`, `deadline_warning`, `match_cancelled`, `match_bumped`,
`match_expired`, `reminder_3h`, `organiser_handover`, `seat_removed`, `seat_refilled`,
`ticket_forfeited`, `tickets_refunded`, `msg_on_my_way`, `msg_running_late`, `msg_cant_make_it`,
`msg_bring_balls`.

Staff: one `notify_staff` title key `match_report_new` (managers at the branch), in
`_shared/staff-push.json`.

### 1.10 Error codes

Guest (mobile `CODE_TO_KEY` in `apps/mobile/src/features/booking/errors.ts`, literal entries):
`MATCHES_OFF`, `MATCH_NOT_FOUND`, `MATCH_CLOSED`, `MATCH_FULL`, `MATCH_SLOT_FULL`, `MATCH_TOO_LATE`,
`MATCH_LIMIT_REACHED`, `MATCH_SEAT_LIMIT`, `MATCH_APPROVAL_REQUIRED`, `MATCH_NOT_APPROVAL`,
`MATCH_ALREADY_IN`, `MATCH_GENDER_MISMATCH`, `MATCH_UNAVAILABLE`, `MATCH_BANNED`, `MATCH_BOOKED`,
`NOT_ORGANISER`, `NEED_TICKETS`, `GENDER_REQUIRED`, `GENDER_ALREADY_SET`, `TERMS_REQUIRED`,
`REQUEST_NOT_FOUND`, `REQUEST_CLOSED`, `REQUESTER_INELIGIBLE`, `REQUEST_LIMIT`, `SEAT_NOT_FOUND`,
`SEAT_HOLDER_REQUIRED`, `SEAT_STARTED`, `REPORT_TARGET_INVALID`, `BLOCK_TARGET_INVALID`,
`TICKET_COUNT_INVALID`. Reused: `ACCOUNT_REQUIRED`, `PHONE_REQUIRED`, `SLOT_TAKEN`,
`PRICE_CHANGED`, `DEGRADED_LOCKOUT`, `SLOT_IN_PAST`, `CLOSED_DATE`, `OUTSIDE_HOURS`,
`BEYOND_HORIZON`, `NO_RATE`, `INVALID_DURATION`, `IDEMPOTENCY_CONFLICT`, `TOO_MANY_ATTEMPTS`,
`PAYMENT_NOT_FOUND`, `RATE_LIMITED`, `INVALID_ARGUMENT`.

Staff (operator `MAPPED_CODES`): `MATCHES_OFF`, `MATCH_NOT_FOUND`, `MATCH_NOT_FILLING`,
`MATCH_NOT_BOOKED`, `MATCH_NOT_STARTED`, `MATCH_FULL`, `MATCH_TOO_LATE`, `MATCH_SLOT_FULL`,
`MATCH_GENDER_MISMATCH`, `MATCH_SEAT_LIMIT`, `MATCH_BANNED`, `MATCH_MARK_SEATS`, `SEAT_NOT_FOUND`,
`SEAT_NOT_STARTED`, `SEAT_MARK_LOCKED`, `SEAT_OWED_CHANGED`, `NOTHING_OWED`,
`PAYMENT_NOT_ON_MATCH`, `AMOUNT_OVER_SEAT`, `PAYMENT_OVER_ALLOCATED`, `REPORT_NOT_FOUND`,
`REPORT_CLOSED`, `NO_UNUSED_TICKETS`. Reused: `FORBIDDEN`, `VENUE_MISMATCH`, `REASON_REQUIRED`,
`INVALID_TRANSITION`, `GUEST_REQUIRED`, `SLOT_TAKEN`, `PAYMENT_NOT_FOUND`, `PAYMENT_STATE`,
`PIN_GRANT_REQUIRED`, `INVALID_ARGUMENT`.

Edge `ticket-begin`: `BAD_REQUEST`, `PROVIDER_UNAVAILABLE`, `RETRY_LATER` plus the SQL codes.

### 1.11 Client names

- Mobile routes: `matches` (`matches`), `match/[id]` (`match-detail`), `match-new`, `m/[token]`
  (`match-link`), `match-report`, `blocked-players`, `tickets`; `+native-intent.ts`. Query-key root
  `['match']` (tickets under `['match','tickets']`), never persisted. i18n catalog pair
  `matches.en.ts` / `matches.ar.ts`.
- Operator: route `/desk/matches/$id`; capabilities `runMatches`, `banFromMatches`,
  `reviewMatchReports`, `takeSeatPayment`, `writeOffSeat`, `cashOutTickets`; query keys
  `QK.deskMatches`; lane catalog `ws.matches` (+ `opErrors.matches`).
- Web: `app/[locale]/m/[token]/page.tsx`; `LINK_PATHS` gains `/m/*`, `/en/m/*`, `/ar/m/*`.
- Edge: `ticket-begin` (new, `verify_jwt = true`).
- Cron: `tp_match_sweep` (30 s with the per-minute fallback of 0242).

### 1.12 Merge rulings (2026-09-28; they amend §1.1–§1.11 and win over any lane section)

| # | Ruling |
| --- | --- |
| R1 | `match_seat_write_off(p_seat_id uuid, p_reason text, p_pin text, p_device_id text default null)`: roles court_desk, manager, owner; a **manager PIN grant** authorises it (the till's `apply_discount` model: `verify_manager_pin` mints, the RPC spends with `consume_pin_grant(p_device_id)`). `PIN_GATED_RPCS` (`packages/core/src/schemas/mutations.ts`) gains it. Capability `writeOffSeat`: court_desk, manager, owner. |
| R2 | `tabs.court_cap_iqd` is set by `match_seat_settle` on the tab it settles (a fresh tab, or an adopted empty live tab) and by `match_link_payment` when it closes a live court-only tab at what was paid on it. |
| R3 | Push payload `route` is `'match'` or `'tickets'` (`id` null, used only by `tickets_refunded`). Title keys gain `request_expired` and `match_moved`. `guest-push.json` maps each key to its kind: `reminder_3h` → `match_reminder`, `msg_*` → `match_message`, every other key → `match_update`. |
| R4 | The unique occupying `(match_id, seat_no)` index covers `in` and `attended` only (a walk-in may take a no-show's seat number after start, `replaces_seat_id` = the no-show seat); `(match_id, guest_id)` for account seats keeps `in`, `attended`, `no_show`. |
| R5 | §1.8 gains `notify_staff` (latest 0193, owner DB, 0257): `c_title_keys` + `match_report_new`; `_shared/staff-push.json` and `send-push/staffStrings.ts` gain it; `send-push` ships in its own push before any migration that can queue a new key or kind. |
| R6 | Mobile `REQUEST_NOT_FOUND` keeps one `CODE_TO_KEY` entry, re-pointed to a neutral `errors.requestGone`; `RATE_LIMITED` gains a `CODE_TO_KEY` entry (`errors.tooManyRequests`); `RETRY_LATER` maps to `deposit.errors.providerUnavailable`. |
| R7 | `booking_payments.venue_id` becomes nullable: `booking_payments_anchor` adds deposit ⇒ `venue_id` not null, ticket ⇒ `venue_id` null (tickets are chain-wide). |
| R8 | The lock-order walker also covers `ticket_refund_deleted` and `tickets_cash_out`. `match_tickets.cashout_payment_id` always equals `purchase_payment_id`; nobody reads it as another payment. |
| R9 | `mark_match_seats.p_attendance` ∈ `attended`, `no_show`, `in` (undo); an undo of `attended` whose ticket is already locked elsewhere is refused `SEAT_MARK_LOCKED`. Unmarked seats become `attended` when the booking completes. |
| R10 | Switching `matches_enabled` off stops new starts and joins of new players; filling and booked matches carry on. |
| R11 | Staff also map `MATCH_ALREADY_IN`, `TICKET_IN_USE`, `CUSTOMER_NOT_FOUND`. Client error maps and their catalog keys are written by the DB build step together with the SQL that raises them. |

Owner questions carried to the end of the build (not blocking): headline revenue with written-off shares; who bears Qi fees on a cash-out; cash handed back by "settled another way" leaving no till movement (as for deposits today); tax on seat money.

## 2. Database core (lane DB)

Draft written 2026-09-28, not yet merged here and not yet reviewed:
[`drafts/db-2026-09-28.md`](drafts/db-2026-09-28.md). The merge folds it into this section, with §1.12 applied.

## 3. Money and tickets (lane Money)

Draft written 2026-09-28, not yet merged here and not yet reviewed:
[`drafts/money-2026-09-28.md`](drafts/money-2026-09-28.md). The merge folds it into this section, with §1.12 applied.

## 4. Guest app, web, push, links, legal (lane Guest)

Draft written 2026-09-28, not yet merged here and not yet reviewed:
[`drafts/guest-2026-09-28.md`](drafts/guest-2026-09-28.md). The merge folds it into this section, with §1.12 applied.

## 5. Operator (lane Operator)

Draft written 2026-09-28, not yet merged here and not yet reviewed:
[`drafts/operator-2026-09-28.md`](drafts/operator-2026-09-28.md). The merge folds it into this section, with §1.12 applied.

## 6. Rollout, tests, known limits

To be written at the merge. The build order and the resume steps are in
[`CONTINUE.md`](CONTINUE.md).
