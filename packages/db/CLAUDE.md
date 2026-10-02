# packages/db — rules for every change

Schema, RPCs, edge functions and the gates that guard them. Written 2026-09-20 (Phase 2, Milestone 0
item 12) from `PHASE-2-PLAN.md` Part A5 plus the 09-20 code verification; where this file and an
older doc disagree, this file wins. `NNNN` means `supabase/migrations/2026…NNNN_*.sql`; `NNNN:line`
is a line in that file.

## Commits

- No AI co-author trailer of any kind (`Co-Authored-By: Claude …`, Copilot, …). If a harness appends
  one, strip it. Root `CLAUDE.md`.
- Commit and push only when Parsa says "commit" or "push". Never run `git add`, `commit`, `stash`,
  `checkout`, `reset` or `clean` on your own.
- One commit carries the migration, the regenerated `src/types.gen.ts` (CI diffs it:
  `.github/workflows/ci.yml:337-338`), both i18n catalogs (`packages/i18n/src/catalogs/{en,ar}.ts`,
  or a `ws/<lane>.en.ts` + `.ar.ts` pair) and every gate fixture the change touches.

## Migrations

- Ordinal strictly greater than the current max, never a reused one. Latest is `0289`
  (`20261001000289_lesson_account_deletion.sql`; 0273–0289 coaching, Phase 2 milestone 5: lesson
  kind, lesson push kinds, settings, tables, reservation guards, lesson money, coach admin,
  booking, Qi lessons, price-protocol lesson kinds, sweep, statements, reports, account deletion —
  written as 0270–0286 and renumbered +3 at the merge because the wages migrations took 0270–0272,
  so `docs/design/coaching/` still says 0270–0286; 0270–0272 wages: staff_wages, wage_payments,
  staff_attendance, their RPCs, and owner-only deduction approval; 0266–0269 hosted drift, deposit
  match, hold sweep split, principal lock caps; 0253–0265 open matches; 0252 the hold ladder (lapsed holds → waits, suspension, day-close review), written as 0249 on the kemal branch and renumbered at the merge because 0249–0251 were already on hosted; 0249–0251 staff page scopes, batch sizes, floor orders; 0248 the owner's offline-mode switch, off by default; 0247 degraded mode only while a day is open; 0243–0246 Touch Shop as its own desk; 0241–0242 online
  deposits; 0240 the scanned-paper audit fixes; 0236–0239 scanned paper, Milestone 4b; 0228–0235 the multi-venue audit fixes; multi-venue slice 1 = 0122–0139, assistant 0140–0142,
  Touch Shop 0143–0146, then 0147 drop-reservation-players, 0148 customer-directory,
  0149 assistant-cap, 0150 move-not-into-past, 0151 out-of-stock-alert, 0152 my-reservations,
  0153 terms-consent, 0154 analytics-returning-guest, 0155–0157 six new staff roles, 0158–0206
  protocols and the staff phone (change-order line 10), 0207–0227 multi-venue slices 2–4); the next is
  `0290`. **Check the directory, not this line** — it said 0146 while 0147–0149 were already on
  disk, and later 0150 while 0154 was, and a reused ordinal fails `check-migrations.mjs` after the
  file is written.
- `0069` and `0071` are already doubled; `0023`, `0040` and `0101` have no file, so leave the gaps.
  `scripts/check-migrations.mjs` enforces both rules (`migration-duplicate-ordinal`,
  `migration-ordinal-not-max`).
- Open every file with `set lock_timeout = '3s'; set statement_timeout = '60s';`
  (`check-migrations.mjs:247-248,467-483`).
- `add constraint … NOT VALID`, then a separate `VALIDATE CONSTRAINT` inside an idempotent
  `pg_constraint` guard that tests `conname` AND `conrelid = '<table>'::regclass` (`conname` is
  unique per relation, not per database: a same-named constraint elsewhere would skip the add and
  fail the VALIDATE — 0128–0133 were scoped this way after the 09-21 review); a `create index` needs its own migration or
  `MIGRATION-RISK-ACCEPTED: <reason>` in the PR body (`check-migrations.mjs:36,262,282-288`).
- Re-issue a function only from its latest body, verbatim:
  `grep -n "function app.<name>(" supabase/migrations/*.sql | tail -1`. **Both spellings count**:
  a plain `create function` (0049 `apply_discount`, `override_price`, `record_waste`; 0097
  `upsert_court`) is as much "the latest body" as `create or replace function`. Searching for the
  long form only is how 0115 re-issued two RPCs at an arity 0049 had dropped and created stray
  overloads (fixed by 0119). The latest file is often not the obvious one: `is_degraded()` 0137
  and `is_degraded(uuid)` 0139, `set_opening_hours` 0052, `apply_discount` and `override_price`
  0119, `staff_create_reservation` 0147, `cafe_setting_specs` 0105, `set_staff_role` 0157; 0156
  holds `heartbeat`, `verify_manager_pin`, `verify_own_pin`, `consume_pin_grant`, `break_status`,
  `start_break`, `end_break`, `cover_station`, `set_ticket_status` and `set_order_item_ready`
  (copying an older body back brings a five-role guard with it and locks the 0155 roles out).
  0257 (match settings) holds `accept_terms` (0153 is no longer the latest; an older version never
  replaces a newer one on record). 0262 (open matches at the desk) holds `court_fee_remaining`, `compute_tab_totals`,
  `booking_bill`, `booking_bill_states`, `mark_reservation`, `set_customer_flags`,
  `customer_counts`, `customer_record`, `customer_search` and `customer_directory`.
  0263 (the reservation trigger and the match sweep) holds `hold_slot` (0252's hold-ladder body
  plus R22) and `staff_create_reservation`; `release_hold` and `expire_stale_holds` stay 0252's
  (0260's `match_expire_holds` twin settles no strike: the guest's next hold or `tp_hold_sweep` does). 0264 holds `delete_my_account` (0077 is no longer the latest; the
  body scrubs the open-match rows and calls `ticket_refund_deleted` before the audit row, with no
  match lock, R25). 0265 (open-match reports) holds `reports_figures` and `report_courts` (0219 is
  no longer the latest), `panel_headline` (0096) and `unpaid_played_bookings` (0231).
  0270 (wages tables) holds `cafe_setting_specs` (0105 is no longer the latest). 0272 holds
  `propose_deduction`, `decide_deduction`, `cancel_deduction`, `deductions_page` and
  `deductions_month` (0197 is no longer the latest; decide is the owner's alone and takes
  `app.lock_wage` before the row lock). Coaching holds: 0280 `cancel_reservation`,
  `close_branch`, `confirm_booking`, `desk_match_detail`, `desk_open_matches`,
  `expire_stale_holds`, `extend_reservation`, `mark_reservation`, `match_court_free_firm`,
  `match_expire_holds`, `match_quote`, `move_reservation`, `open_tab`, `staff_create_reservation`;
  0281 `cafe_settled_tabs`, `close_day`, `compute_tab_totals`, `day_close_shop`, `ops_overview`,
  `refund`, `settle_tab`, `till_shift_list`, `trg_match_booking_no_cafe`; 0282
  `storage_path_in_use`; 0284 `deposit_apply`, `deposit_attention`, `deposit_refund_apply`,
  `deposit_refund_request`, `deposit_status`, `deposits_due_for_reconcile`; 0285 the six
  price/promo protocol hooks; 0286 `hold_strikes_settle`; 0288 `analytics_courts_summary`,
  `day_close_online`, `panel_headline`, `report_courts`, `report_revenue`, `reports_figures`;
  0289 `delete_my_account`.
- Signature change: `drop function` by exact signature, recreate, re-issue
  `revoke … from public, anon` and `grant execute … to authenticated`. The registry gate replays
  GRANT/REVOKE/DROP in file order (`scripts/check-rpc-registry.mjs`), so a missing re-grant shows
  up there — and it forgets a name's grants on ANY drop, so re-grant even when the new signature
  already existed.
- No accidental overloads: the same gate replays every `create [or replace] function app.X(...)`
  and `drop function app.X(...)` (`scripts/lib/fn-signatures.mjs`) and fails when a name ends with
  two signatures unless `fixtures/rpc-overloads.json` says so (`business_date`, `is_degraded`,
  `llm_record_usage`, `venue_mode` since 0137). `tests/rpc-overloads.test.ts` proves
  the same list against `pg_proc` when Docker is up.
- Enum widening (`alter type … add value`) is its own migration file, landing strictly before the
  file that uses the value. Precedents: 0143 (`ingredient_kind` `retail`, first used by 0144) and
  0155 (six `staff_role` values, first used by 0156).
- New push kind: `notification_outbox.kind` is a closed CHECK (`0024:22`, re-issued by
  `0075:36-58`, latest `0274`, which added `lesson_update`, `lesson_reminder`, `coach_update`);
  widen it by migration and add EN/AR copy: a booking kind to
  `STRINGS` in `supabase/functions/send-push/index.ts:48`; a staff kind to `staffStrings.ts` and
  `_shared/staff-push.json`; the guest kinds of open matches take their copy from
  `send-push/guestStrings.ts` and `_shared/guest-push.json`, not `STRINGS`.
  `tests/outbox-kinds.test.ts` holds the CHECK to the three lists. A new staff title key also
  joins `app.notify_staff`'s `c_title_keys` (latest `0261`, which appended `match_report_new`) in
  the same commit, and a guest title key `app.match_notify`'s `c_keys` (`0261`) or, for a
  lesson or coach key, `app.lesson_notify`'s `c_keys` (`0283`; every lesson push is queued by the
  `lesson_events_notify` trigger except the two statement keys); the stack tests
  (`staff-push.test.ts`, `guest-push.test.ts`, `lesson-push.test.ts`) compare each with its JSON.
- `send-push` deploys before the migration: `.github/workflows/deploy.yml` (started by a green CI
  run on `main`, or `workflow_dispatch`) deploys `send-push`, then pushes the migrations, then
  deploys every other function. An unknown kind is terminal in send-push
  (`send-push/index.ts:173`).
- Migrations reach hosted (`deploy.yml`) before any client build that calls them. Never accept
  `migration repair --status reverted`.
- Every edge function's `verify_jwt` is fixed in `fixtures/verify-jwt.json`; `check:verify-jwt`
  holds `config.toml` to it (in `pnpm security`) and `deploy.yml` holds the hosted project to it.
  A new function needs its entry and its `[functions.<name>]` block in the same commit.

## Tables

- Money is integer IQD through the `iqd` / `iqd_signed` domains (`0002:26-27`); guest-visible text
  is `_en` + `_ar`, both `NOT NULL` (`CONTRIBUTING.md`).
- `enable row level security` on every new table (by hand for schema `app`); select-only policies;
  guest-writable text gets a sanitiser trigger (`app.safe_line`, 0080) and a length CHECK.
- A function named in a CHECK constraint, a generated column or a non-definer trigger runs as the
  WRITING role, so grant it to every role that writes the table: anon, authenticated AND
  service_role (edge functions, seeds, tests). 0116 granted `app.phone_digits` to the two client
  roles only and every service-role UPDATE on `profiles` failed until 0121.
- Append rules for the table to `tests/rls-matrix.ts` (data only; `tests/rls-matrix.test.ts` runs it
  against 8 principals). Never restructure that file.
- A table that holds guest data is declared in `GUEST_DATA` (`tests/stored-fields.test.ts:86`,
  SEC-20); the test fails on an undeclared table and prints the store data-safety form from the
  declaration.
- SEC-28 (`scripts/check-broadcast-payloads.mjs`) and SEC-29 (`scripts/check-analytics-payload.mjs`)
  each carry a `FORBIDDEN` list; extend it when a new column can reach a broadcast or analytics
  payload.
- Every new table, view, granted RPC, route, edge function, cron job and doc needs an entry in
  `fixtures/assistant-coverage.json`; `check:assistant-coverage` re-derives the inventory from the
  code and fails on a missing key (`scripts/check-assistant-coverage.mjs`, in `pnpm security`). A
  `table_read` table also gets `app.assistant_readable_columns` rows (`0109:94`).
- **Venues (0122–0138, milestone 1 slice 1).** Every venue-scoped table carries `venue_id`
  (`docs/design/multi-venue/slice-1-2026-09-21.md` has the three lists: scoped, FK-derived,
  global). A new scoped insert either names `venue_id` or relies on the column default,
  `app.current_venue()`, which resolves station → the caller's only `staff_venues` row → the
  single active venue and otherwise raises `VENUE_REQUIRED` — it never guesses. Cron- and
  service-written tables (`audit_log`, `degraded_periods`, `manager_alerts`, `telegram_*`,
  `analytics_*`) default to `app.current_venue_or_default()` instead. A function referenced by a
  column default, an RLS policy or a CHECK runs as the writing or reading role, so it is granted
  to `anon`, `authenticated` AND `service_role` (the 0116→0121 lesson, repeated at 0125). Staff
  read policies carry `venue_id = any(app.staff_venue_ids())`; the owner is global (no
  `staff_venues` rows, sees every active venue). `venues` rows are written by migration only in
  slice 1: a second ACTIVE venue on hosted before slice 3 makes every guest insert raise
  `VENUE_REQUIRED`. A `service_role` insert while two venues are active must pass `venue_id`
  (`tests/multi-venue.test.ts` builds and deactivates its own venue B for that reason). Never
  read `venue_settings` unqualified: it is **one row per venue since 0208** (unique index on
  `venue_id`; the boolean `id` is deprecated, always true and no longer unique). Read the row of
  the branch the court, table, session, order or tab belongs to (`where venue_id = …`).
  `cafe_settings` is keyed `(venue_id, key)` since 0209: pass the branch to
  `app.cafe_setting*(key, venue)` whenever the body knows it. The chain's own settings (currency,
  the LLM budget and price list, the per-guest hold cap) are in the `platform_settings` singleton
  (0207). `promotions.venue_id` is nullable on purpose: NULL means every branch (0212).
  Since slice 3–4 (0215–0227): a body that creates rows for a thing (tab, court, payment, batch…)
  looks up that thing's venue, refuses another branch's caller with `VENUE_MISMATCH` and asserts
  `set_config('app.venue_id', …)` so every default-based insert downstream lands there (0217
  pattern). A staff read policy's venue axis is `venue_id = any((select app.visible_venue_ids())::uuid[])`
  (0226), never `app.staff_venue_ids()`: visibility follows the branch in scope (the operator's
  `x-station-id` / `x-venue-scope` headers, read by `app.resolve_venue`). A report reads
  `venue_id = any(v_rv)` with `v_rv := app.report_venues()` (0219). `venues.status` is
  preparing/open/closed; `is_active` means open (guests), staff see every branch not closed.
  `any((select f())::uuid[])` needs the cast: `any((select f()))` compares against the ROW.
  Since the audit (0228–0235, `docs/design/multi-venue/audit-2026-09-26.md`):
  - `app.resolve_venue` never swaps branches: a station or `app.venue_id` naming a closed branch
    answers NULL, a scope header the caller may not use answers NULL, and staff with no open branch
    (not the owner) answer NULL. The station header outranks `x-venue-scope` in BOTH
    `resolve_venue` and `visible_venue_ids`. `app.is_staff_at` is false for a closed branch, owner
    included. The owner still READS a closed branch (`app.readable_venue_ids`, scope header).
  - **Every branch table and child table carries the `zz_branch_guard` trigger** (0230,
    `app.trg_branch_guard`): a row's links must name rows of its own branch (everyone), and a staff
    writer must be `is_staff_at` the row's branch unless a definer body asserted it
    (`app.venue_id`) or it is their own guest row. A new branch table (or a child of one) gets the
    trigger in the migration that creates it, with its link pairs; a test fixture that writes as
    postgres clears `request.jwt.claims` first (`tests/stores-harness.ts`).
  - A heartbeat never registers or revives a station (0229, decision A1): a machine is registered in
    Settings > Stations (`app.register_station`); a test registers its station with
    `registerTestStation` (`tests/helpers.ts`) before it beats. `DEV1` is seeded.
  - A policy calls `app.is_staff(...)` / `app.staff_role()` inside `(select …)` (0234), like
    `visible_venue_ids`: one evaluation per statement.
- Guest-readable knobs go on `venue_settings` through the `app.set_venue_details` allowlist (0104,
  per branch with `p_venue_id` since 0208) and `venue_settings_public` (one row per active branch);
  everything else in the `cafe_settings` registry (`app.cafe_setting_specs`, latest 0105). Design
  notes: `docs/design/multi-venue/slice-1-2026-09-21.md`, `slice-2-2026-09-26.md`,
  `slice-3-4-2026-09-26.md`, `audit-2026-09-26.md`.

## RPCs

- `security definer`, `set search_path`, `revoke … from public, anon`,
  `grant execute … to authenticated`; dollar tag `$<name>_0NNN$` (as `$confirm_booking_0092$`); the
  role or venue guard is the first statement.
- A guard that means "any active staff" is `if app.staff_role() is null then raise …` in a function
  and `app.staff_role() is not null` in a policy (the 0072 form), never a list of every role. 0156
  converted the old five-role lists, so a new role needs no re-issue; a guard for a subset (kitchen,
  till, money, stock) still names its roles.
- Errors are `raise exception 'CODE'` (P0001). Every new code gets its line in the one error
  catalogue, `ERROR_CODE_KEYS` in `packages/i18n/src/errors.ts`, EN and AR, in the same commit
  (`check:error-codes` fails otherwise); the operator's `MAPPED_CODES`, the web's `rpcErrorKey` and
  the phone's `mapErrorToKey` all resolve through it, with per-app wording only as overrides
  (`WEB_OVERRIDES`, `MOBILE_OVERRIDES`).
- No WHERE-less write (`scripts/check-safe-update.mjs`). `app.lock_court` (0042) before any
  reservation write. Lock order
  `day_sessions → match_money_advisory → coach_advisory → tabs → orders → order_items → tickets → payments → till_shifts → refunds → stock_batches → court_advisory → reservations → match_venue_advisory → match_tickets`
  (`coach_advisory` since coaching, `app.lock_coach`, once per sequence; a `FOR UPDATE … SKIP
  LOCKED` on reservations never waits and is not ranked, like `pg_try_advisory_xact_lock`)
  (`scripts/check-lock-order.mjs`, walker in `scripts/lib/lock-order.mjs`; `till_shifts` since
  wave 5, whose stamp trigger takes the open shift FOR SHARE on every payment and refund insert;
  the three open-match ranks since 0260: `app.lock_match_money`, the branch mutex
  `app.lock_match_venue`, and `match_tickets` rows in id order, each advisory key counted once per
  sequence, and the service-role paths of `docs/design/open-matches/db.md` §2.6 walked too).
- Every insert or kind/status/court/time update of a booking or maintenance row fires
  `reservations_match` (0263): a match's own booking cascades to the match (cancel, complete,
  move; a booking-level no-show is `MATCH_MARK_SEATS`, so a body that ends a match with its
  booking ends the match first), and a newly firm row bumps the branch's filling and waiting
  matches it leaves with no firm-free court (try-lock only; the sweep `tp_match_sweep`, every
  30 s, is the backstop). The walker expands it under every reservations writer. A hold or desk
  create on a court a waiting match still needs is `SLOT_TAKEN` detail `match_waiting` (R22),
  except while the branch is degraded inside the protected horizon (the sweep does not book the
  match there, so the desk may take the court and the new row bumps it).
- A non-idempotent money write takes `p_idempotency_key` and calls `app.claim_replay` (0049).
- Open-match seat money (0262) is derived by `app.match_money`, never stored; every writer that
  changes what a seat owes takes `app.lock_match_money` first. A match booking's tab carries court
  money only: `orders` and `tab_adjustments` refuse a row on it (`MATCH_BOOKING_NO_CAFE`, R20). The
  desk's open-match RPCs treat a sandbox match, or one outside `app.visible_venue_ids()`, as not
  found, and take `p_reason` as `<code>` or `<code>: <note>` (R42).
- Ticket money reaches a report only through `app.ticket_money_figures` (0265, MD-16: sales,
  refunds and the liability chain-wide, forfeits, restores and cash-outs by branch); ticket and
  deposit money never enters `revenue`, `cash` or `card`, and a sandbox row adds 0 to every figure.
- Registry: every granted function is covered in `tests/rls-matrix.ts` or listed `publicByDesign` in
  `fixtures/rpc-allowlist.json` with a reason of at least 10 characters
  (`check-rpc-registry.mjs:94-95`). The floor in `fixtures/rpc-coverage-floor.json` (164/167 on
  2026-09-20) only rises, via `--update-floor`.
- `scripts/check-rpc-authz.mjs` reads `fixtures/rpc-allowlist.json` (one list, since Milestone 0
  item 10); it needs a running stack, so it runs in the CI db job after `supabase start` and must
  NOT join `pnpm security`, which runs stackless.

## Offline mutation contract

- A queued mutation type lives in six code copies, appended in the SAME order in each (the shell's
  test compares arrays): `packages/core/src/schemas/mutations.ts` (`MUTATION_TYPES` + payload
  schema + envelope variant), `apps/operator/src/lib/mutate.ts` (`DIRECT_RPC`),
  `supabase/functions/replay/index.ts` (`MUTATION_RPCS`),
  `apps/operator-shell/src/main/ipc-validate.ts` (`MUTATION_TYPES`),
  `apps/operator/src/lib/queueResults.ts` (`RESULT_INVALIDATIONS`) and
  `apps/operator/src/features/admin/dayCloseLogic.ts` (`QUEUE_WRITE_KEY`).
- The one list is `supabase/functions/_shared/mutation-types.json`: replay asserts against it at
  boot and `apps/operator/src/lib/mutate.test.ts` compares `DIRECT_RPC`. Since 0120 the queued
  types are `order.create`, `order.add_items`, `ticket.status`, `payment.record`,
  `reservation.create`, `reservation.update`, `waiter_call.action`, `stock.waste`, `tab.open`,
  `tab.settle`, `adjustment.apply`, `tab.cancel`, `tab.settle_zero`, `payment.refund`,
  `order_item.void`; `merge_tabs`, `record_drawer_open`, `open_day`, `close_day` stay online-only
  by decision (scope ledger row in `HANDOFF.md`). A state-idempotent RPC (`set_ticket_status`,
  `void_after_send`) takes no key; every other money write takes `p_idempotency_key` +
  `app.claim_replay`.
- `PIN_GATED_RPCS` (three copies: `packages/core/src/schemas/mutations.ts`,
  `_shared/mutation-types.json` `pinGatedRpcs`, `tests/helpers.ts`) gained `match_seat_write_off`
  in 0262 (online only, never queued).
- Payloads never carry a price (`mutations.ts:13-14`). Secrets that must not persist (a manager
  `pin`) are stripped by `redactSecrets` (`_shared/redact.ts`) before any record or echo; a new
  secret field is added there, not handled ad hoc.
- Retryable Postgres errors (40001, 55P03, 57014, 53300, 53400) map to 503 `RETRY_LATER` and are
  never recorded as conflicts (`_shared/http.ts:71-84`; `tests/replay-transport.test.ts`).

## Edge functions

- Staff-only functions call `requireStaffRole` (`_shared/auth.ts:23`); service writes use
  `createServiceClient` (`_shared/supabase.ts:16`). Deno cannot import `packages/core`: shared data
  is JSON under `_shared/` or a byte-identical copy checked by a test
  (`tests/assistant-catalog.test.ts:56` for `assistant/tools.ts`).
- Every handler goes through `_shared/http.ts` (2026-10-01): `Deno.serve(handle(name, …))`,
  `readJsonBody` with a byte cap, `fetchWithTimeout` for every outbound call, `errorResponse` /
  `pgErrorBody` / `logError` so a caller never sees raw database, vendor or exception text (keep
  the `error` code and status), `isUuid`, `constantTimeEqual`; the caller-JWT client is
  `callerClient` (`_shared/supabase.ts`). A write whose failure means a duplicate side effect
  (an outbox `sent` stamp) logs loudly with the row id. CI type-checks every entry
  (`ci.yml` job `edge-functions`); locally, from this package:
  `DENO_NO_PACKAGE_JSON=1 npx --yes deno@2.5.6 check --no-config --node-modules-dir=none supabase/functions/*/index.ts`.
- LLM code uses `npm:@anthropic-ai/sdk`, model `claude-opus-5` unless Parsa names another, meters
  spend through `app.llm_record_usage` (0079, 0111), puts no guest identity in a prompt (SEC-29) and
  never computes a number the page did not already have.
- **Scanned paper (0236–0239) is the exception on the model:** `receipt-scan` reads supplier
  receipts and waiters' order slips through ONE vendor-free adapter,
  `_shared/receipts/connect.ts`, the only file that may name a vendor, its key or its host
  (`tests/receipt-scan.test.ts` enforces it). `RECEIPT_READER=fake` is the stand-in for local, CI
  and e2e. The model never writes stock or an order: a person confirms (`confirm_receipt`,
  `send_order_slip`).
  Since 0240 a reading holds a lease (`reading_token`, passed back to `*_store_reading` /
  `*_fail_reading`), `app.scan_sweep_stale` ends one older than three minutes (cron
  `tp_scan_sweep`), and `scan_reads` caps readings (3 per paper, 100 a day per person below
  MGMT). `RECEIPT_READER=fake` is refused unless `SUPABASE_URL` is a local stack or
  `ALLOW_FAKE_READER=1`. Any real reader must pass `tests/receipt-reader-conformance.ts`.
- `scripts/check-error-codes.mjs` (in root `pnpm security`): a code a migration raises is mapped
  by a client, or it is on `fixtures/error-codes-unmapped.json`, which only shrinks.
- Secrets come from `supabase secrets set`, never the repo or `config.toml`. `supabase`, `eas` and
  `expo` run from their package directory, never the repo root.
- **Never run `supabase config push`.** `config.toml` describes the LOCAL stack; hosted auth is
  dashboard-managed (`docs/client/phone-otp-activation.md`). One push on 2026-08-24 overwrote it and
  carried the then-committed test-OTP pair to the client's project
  (`docs/security/security-audit-2026-09-13.md:191`, M8). `[auth.sms.test_otp]` now carries
  `env(SUPABASE_AUTH_SMS_TEST_OTP_CODE)` and never a literal — locally from `packages/db/.env`, in
  CI from the repository variable. Two gates fail the build on a regression:
  `scripts/check-config-env.mjs` (in `db:start` with `--require-values`, static in `pnpm security`
  as `check:config-env`) and `scripts/security/check-no-config-push.mjs` (root
  `pnpm security:config-push`). The hosted store-review account is a different thing entirely:
  `scripts/create-review-account.mjs` provisions a phone-confirmed guest on the hosted project with
  a run-time-generated number and password, printed once and never committed, so the reviewer signs
  in with phone + password and needs no code at all. If a hosted test-OTP pair is still wanted, the
  owner picks a fresh one per review in the dashboard and deletes it after the decision — never a
  value from this repo.

## Verify before you report

- `pnpm --filter @touch/db typecheck`, `lint`, `test`, `check:migrations`, `check:rpc-registry`,
  `check:assistant-coverage`; root `pnpm security` runs the last two. Stack-dependent test files
  `skipIf` when the stack is down; the pure ones (`replay-transport`, `assistant-*`, `insights-*`,
  `telegram-render`) always run.
- Needs Docker (`pnpm db:start` in this package): `db:reset`, `db:types` (regenerates
  `src/types.gen.ts`), `check:locks`, `check:authz`, `check:safeupdate`, `check:invariants`,
  `check:broadcast`, `check:analytics`, and every `tests/*.test.ts` gated on `stackAvailable()`.
  Without Docker, say so; the CI db job (`ci.yml`) is the gate of record.
- Windows, local: `apps/operator-shell` tests need `pnpm --filter @touch/operator-shell native:node`
  first (better-sqlite3 ABI) and `native:electron` after, before any `dist`.
  `tests/sms-provider.test.ts` path failures are local noise.
- After a hosted push: `npx supabase migration list --linked` shows 0 pending; assert `cron.job`
  rows (`tp_match_sweep` since 0263) and `storage.objects` policies exist, because schedules and storage policies are best-effort
  DO blocks (0021, 0031).
