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

- Ordinal strictly greater than the current max, never a reused one. Latest is `0114`
  (`20260920000114_replay_pin_purge_drop_log_replay.sql`); the next is `0115`.
- `0069` and `0071` are already doubled; `0023`, `0040` and `0101` have no file, so leave the gaps.
  `scripts/check-migrations.mjs` checks versions today; the ordinal rules land with Milestone 0
  item 10.
- Open every file with `set lock_timeout = '3s'; set statement_timeout = '60s';`
  (`check-migrations.mjs:247-248,467-483`).
- `add constraint … NOT VALID`, then a separate `VALIDATE CONSTRAINT` inside an idempotent
  `pg_constraint` guard; a `create index` needs its own migration or
  `MIGRATION-RISK-ACCEPTED: <reason>` in the PR body (`check-migrations.mjs:36,262,282-288`).
- Re-issue a function only from its latest body, verbatim:
  `grep -l "function app.<name>" supabase/migrations/*.sql | tail -1`. The latest file is often not
  the obvious one: `is_degraded` 0026, `heartbeat` 0107, `set_opening_hours` 0052,
  `verify_manager_pin` 0086, `staff_create_reservation` 0092, `cafe_setting_specs` 0105.
- Signature change: `drop function` by exact signature, recreate, re-issue
  `revoke … from public, anon` and `grant execute … to authenticated`. The registry gate replays
  GRANT/REVOKE/DROP in file order (`scripts/check-rpc-registry.mjs:45-62`), so a missing re-grant
  shows up there.
- Enum widening (`alter type … add value`) is its own migration file, landing strictly before the
  file that uses the value. No migration does this yet; do not put the first one beside its first
  use.
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
- Guest-readable knobs go on `venue_settings` through the `app.set_venue_details` allowlist (0104)
  and `venue_settings_public`; everything else in the `cafe_settings` registry
  (`app.cafe_setting_specs`, latest 0105).

## RPCs

- `security definer`, `set search_path`, `revoke … from public, anon`,
  `grant execute … to authenticated`; dollar tag `$<name>_0NNN$` (as `$confirm_booking_0092$`); the
  role or venue guard is the first statement.
- Errors are `raise exception 'CODE'` (P0001). Every new code gets a client mapping in the same
  commit: `MAPPED_CODES` (`apps/operator/src/lib/errors.ts:10`), `RPC_ERROR_KEYS`
  (`apps/web/src/lib/appRpc.ts:21`) or `CODE_TO_KEY`
  (`apps/mobile/src/features/booking/errors.ts:12`), with both catalogs.
- No WHERE-less write (`scripts/check-safe-update.mjs`). `app.lock_court` (0042) before any
  reservation write. Lock order
  `day_sessions → tabs → orders → order_items → tickets → payments → refunds → stock_batches → court_advisory → reservations`
  (`scripts/check-lock-order.mjs`).
- A non-idempotent money write takes `p_idempotency_key` and calls `app.claim_replay` (0049).
- Registry: every granted function is covered in `tests/rls-matrix.ts` or listed `publicByDesign` in
  `fixtures/rpc-allowlist.json` with a reason of at least 10 characters
  (`check-rpc-registry.mjs:94-95`). The floor in `fixtures/rpc-coverage-floor.json` (164/167 on
  2026-09-20) only rises, via `--update-floor`.
- `scripts/check-rpc-authz.mjs` keeps its own `PUBLIC_BY_DESIGN` set (`:38`); it runs in the CI db
  job after `supabase start` and is not yet in `pnpm security` (Milestone 0 item 10 wires it in and
  reconciles the two lists).

## Offline mutation contract

- A queued mutation type lives in five code copies: `packages/core/src/schemas/mutations.ts:17`
  (`MUTATION_TYPES`), `apps/operator/src/lib/mutate.ts:75` (`DIRECT_RPC`),
  `supabase/functions/replay/index.ts:49` (`MUTATION_RPCS`),
  `apps/operator-shell/src/main/ipc-validate.ts:61` (`MUTATION_TYPES`) and
  `apps/operator/src/lib/queueResults.ts` (keys to invalidate).
- The one list is `supabase/functions/_shared/mutation-types.json`: replay asserts against it at
  boot (`replay/index.ts:237-240`) and `apps/operator/src/lib/mutate.test.ts` compares `DIRECT_RPC`.
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
