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

- Ordinal strictly greater than the current max, never a reused one. Latest is `0157`
  (`20260923000157_staff_money_reads_and_prep_retired.sql`; multi-venue slice 1 = 0122–0139, assistant 0140–0142,
  Touch Shop 0143–0146, then 0147 drop-reservation-players, 0148 customer-directory,
  0149 assistant-cap, 0150 move-not-into-past, 0151 out-of-stock-alert, 0152 my-reservations,
  0153 terms-consent, 0154 analytics-returning-guest, 0155–0157 six new staff roles); the next is
  `0158`. **Check the directory, not this line** — it said 0146 while 0147–0149 were already on
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
  `0075:36-58`); widen it by migration and add EN/AR copy to `STRINGS` in
  `supabase/functions/send-push/index.ts:48`.
- Deploy `send-push` first (`.github/workflows/functions-deploy.yml`, on push to `main` or
  `workflow_dispatch`), then land the migration: an unknown kind is terminal there
  (`send-push/index.ts:173`).
- Migrations reach hosted (`.github/workflows/db-migrate.yml`) before any client build that calls
  them. Never accept `migration repair --status reverted`.

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
  read `venue_settings` unqualified in new code: it is one row through slice 1 and will not be
  after slice 2.
- Guest-readable knobs go on `venue_settings` through the `app.set_venue_details` allowlist (0104)
  and `venue_settings_public`; everything else in the `cafe_settings` registry
  (`app.cafe_setting_specs`, latest 0105). `venue_settings` is still a single row (boolean PK)
  through milestone 1 slice 1; it gained `venue_id` in 0126 but nothing may assume one row after
  slice 2.

## RPCs

- `security definer`, `set search_path`, `revoke … from public, anon`,
  `grant execute … to authenticated`; dollar tag `$<name>_0NNN$` (as `$confirm_booking_0092$`); the
  role or venue guard is the first statement.
- A guard that means "any active staff" is `if app.staff_role() is null then raise …` in a function
  and `app.staff_role() is not null` in a policy (the 0072 form), never a list of every role. 0156
  converted the old five-role lists, so a new role needs no re-issue; a guard for a subset (kitchen,
  till, money, stock) still names its roles.
- Errors are `raise exception 'CODE'` (P0001). Every new code gets a client mapping in the same
  commit: `MAPPED_CODES` (`apps/operator/src/lib/errors.ts:10`), `RPC_ERROR_KEYS`
  (`apps/web/src/lib/appRpc.ts:21`) or `CODE_TO_KEY`
  (`apps/mobile/src/features/booking/errors.ts:12`), with both catalogs.
- No WHERE-less write (`scripts/check-safe-update.mjs`). `app.lock_court` (0042) before any
  reservation write. Lock order
  `day_sessions → tabs → orders → order_items → tickets → payments → till_shifts → refunds → stock_batches → court_advisory → reservations`
  (`scripts/check-lock-order.mjs`; `till_shifts` since wave 5, whose stamp trigger takes the open
  shift FOR SHARE on every payment and refund insert).
- A non-idempotent money write takes `p_idempotency_key` and calls `app.claim_replay` (0049).
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
- LLM code uses `npm:@anthropic-ai/sdk`, model `claude-opus-5` unless Parsa names another, meters
  spend through `app.llm_record_usage` (0079, 0111), puts no guest identity in a prompt (SEC-29) and
  never computes a number the page did not already have.
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
  rows and `storage.objects` policies exist, because schedules and storage policies are best-effort
  DO blocks (0021, 0031).
