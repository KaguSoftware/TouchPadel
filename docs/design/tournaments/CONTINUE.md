# Tournaments: where the build stands, and how to continue it

Phase 2 milestone 7. Planned and approved by Parsa; the plan is
`~/.claude/plans/this-is-from-another-shiny-snowflake.md`; the binding names are
`build-contracts-2026-10-03.md` §1. Authority order for a builder: §0 decisions → §1.12 (the
scaffold review's rulings) → §1.1–§1.11 → the plan.

## Where things stand

| Piece | State |
| --- | --- |
| Decisions | T-1…T-8 and the defaults TD-1…TD-12 in §0 of `build-contracts-2026-10-03.md`. |
| Binding names | §1 of `build-contracts-2026-10-03.md`: the three staged files, the 5 tables, statuses, locks, internals, the 15 client RPCs and their answers, money, the 12 codes and their details, the payload, push, client names. |
| Scaffold review | **Done 2026-10-03** (the plan's 0:00–0:20 step): the §3.4 locks, §3.6 money and §3.2 re-issues read against 0281, 0174, 0263 and 0260 (and 0282–0298 checked for later bodies). Rulings S1–S14 in §1.12: no seventh `compute_tab_totals` column (S1); no add-back in the fee line (S2); money read from payments (S3); `assert_tab_kind_role` passes a tournament tab as café (S4); a tournament tab is never open (S5); reports (S6); refunds take no tournament lock (S7); no lock cycle (S8); the guard trigger meets no other writer (S9); the scope line (S10); degraded and the combined R22 check, and the court check is at 0174:680, not :687 (S11); the push catalogue lands with its copy (S12); the answer additions (S13); the not-payable detail order (S14). |
| Scaffold (step 1) | **Committed on local `main`, not pushed** (`db(tournaments): scaffold …` and `docs(tournaments): …`). Core `packages/core/src/tournaments/` (`types`, `shapes`, `validate`, `score` + tests; `"./tournaments"` export, not in `src/index.ts`); the 12 codes in `ERROR_CODE_KEYS` and `opErrors.tournaments.{en,ar}.ts`; the catalog fragments `tournaments.{common,guest,web}.{en,ar}.ts` assembled by `tournaments.{en,ar}.ts` and mounted in `en.ts` / `ar.ts`, `ws/tournaments.{en,ar}.ts` in `ws/index.ts`, `ws.events.block.conflictKind.match_waiting`, all Arabic DRAFT-AR; `tournamentsCatalog.test.ts`; gate fixtures `rls-matrix.ts` (drop 27: 10 table rules, 15 client RPCs, 3 internals), `rpc-allowlist.json` (2 `publicByDesign`, 13 `guarded`), `stored-fields.test.ts` (`tournament_entries` in `GUEST_DATA`); `assistant-coverage.json` (the two docs `excluded`); the assistant map regenerated for the new catalog lines; `.git/info/exclude` gains `packages/db/.tournaments-staging/`. |
| Provisional types | **Gone.** `packages/db/src/types.gen.ts` was regenerated from the landed migrations on 2026-10-03; the only diff against the provisional file was its PROVISIONAL header, so every client call compiled unchanged. |
| Database (step 2) | **Landed on local `main`, not pushed** (`db(tournaments): migrations 0299-0301 …`, 9448bde5): 0299 `tournaments_schema_money`, 0300 `tournaments_lifecycle`, 0301 `tournaments_play` (dollar tags `_0299`/`_0300`/`_0301`; the staging folder is removed). The three re-issued bodies were checked against their latest (0281 `compute_tab_totals` and `cafe_settled_tabs`, 0174 `block_courts_for_event`): nothing later touched them, and each diff is the stated one. Stack tests `tournaments-{schema,money,lifecycle,play}.test.ts`, `tournament-rounds.test.ts` (the parity test), `lock-order-tournaments.test.ts`; send-push `tournament_update` with its copy and `guest-push.json` (§1.10). |
| Engine | **Merged** (`tour/engine`): `prng`, `americano`, `mexicano`, `regenerate`, `standings` + tests, the five `export *` lines. The engine lane's report of what the engine does beyond the plan (the circle method behind the Americano search, sit-out order, team order, the standings rules the SQL matches) is binding on any change; the parity test holds SQL and core together. |
| Apps | **Merged** in the order web → mobile → operator (`tour/web`, `tour/mob`, `tour/op`; no conflicts). The operator now imports the engine directly (`features/tournaments/engine.ts` is the one seam the logic tests mock); the engine-missing notice and its `ws.tournaments.rounds.engineMissing` line are gone. |
| Landing (step 3) | **Done 2026-10-03, not pushed.** `origin/main` had nothing new (1ad2b3e6), so the ordinals are 0299–0301. Assistant coverage for the 5 tables (excluded: guest identity and entry money), 27 functions (15 client RPCs `map:action`, the internals excluded) and `tp_tournament_sweep` (`map:system`); the two tournament docs stay excluded, as coaching's did; `check:rpc-registry --update-floor` (479/481); `assistant:map` regenerated once; `packages/db/CLAUDE.md` latest ordinal 0301 and the 0299/0300 re-issues; every client call site checked against the `pg_proc` argument lists (all 15 match, none has a default). The operator e2e seeded its event blocks with `source: 'staff'`, which is not a `reservation_source`: now `desk`, as `block_courts_for_event` writes them. |
| Hosted | Nothing yet. Tournaments ship off on every branch (`tournaments_enabled = false`). `deploy.yml` deploys send-push before the migrations, which the outbox CHECK needs. |

## Gates at landing (2026-10-03, local, Docker up)

- Root `pnpm typecheck` (9/9) and `pnpm lint` (9/9; mobile 73 warnings, 0 errors, none in tournament files).
- Root tests: core 1128, i18n 96, web 814, mobile 1980, operator 3246, operator-shell 304 (after
  `native:node`; `native:electron` restored after), court3d 83, all passing. A first web run hit a
  Windows `EBUSY` on vitest's temp cache under the parallel turbo load; alone it passed.
- `pnpm --filter @touch/mobile test:smoke`: 24 suites, 535 tests.
- db: fresh `db reset` + fixtures, the full suite with `TP_REQUIRE_STACK=1`: 201 files, 3323
  passed, 8 skipped (the 7 `phone-otp` cases and the bench baseline, both skipped before this
  milestone); `check:migrations`, `check:locks`, `check:authz`, `check:safeupdate`,
  `check:invariants`, `check:broadcast`, `check:analytics` pass; `deno check` on every function;
  `pnpm db:types` with no diff.
- `pnpm e2e` on a fresh stack: 146 passed, 1 skipped (the assistant case skipped before this
  milestone), both new specs in EN and AR.
- `pnpm security`: every step passes except `security:audit`, which fails on two HIGH advisories
  published upstream with no fixed version (`http-cache-semantics` through electron's
  `@electron/get`, `braces` through jest). The lockfile is unchanged by this milestone, so
  `main` fails the same way; CI's security job will be red until Parsa upgrades or waives them
  (`.security/audit-waivers.json`, a reason, an owner, an expiry). Not done by an agent.

## Review fixes (2026-10-03, local `main`, not pushed)

Two reviews of `1ad2b3e6..9a6f7f28` (the database, then the apps). Every finding was checked
against the code and all ten were confirmed and fixed. 0300 and 0301 were edited in place, since
neither is on hosted.

| # | Where | Fix | Test |
| --- | --- | --- | --- |
| DB-1 (medium) | 0300 `block_courts_for_event` R22 | A requested block is a `match_waiting` conflict only when its own court could book the waiting match (active, offers `duration_min`, no live row over its period), as `match_court_claimed` asks. Before this, while any match waited, no court could be blocked over its period at all. | `tournaments-lifecycle` "refuses a block only on a court that could book the waiting match" |
| DB-2 (medium) | 0301 `desk_tournament_detail` | The guard is `is_staff('cashier','court_desk','manager','owner')` (FORBIDDEN), then scope, then `is_staff_at` (VENUE_MISMATCH), the same roles as `desk_lesson_detail`, because the entries carry names and phones. The `rls-matrix` row changes from `STAFF_ANY` to `CASHIER_DESK_UP`. `desk_tournaments` stays any staff (it carries no personal data). | `tournaments-play` reads: prep and driver get FORBIDDEN |
| DB-3 (low) | 0300 `tournament_sweep` | At the finish, a `closed` tournament with no round drawn is cancelled (`staff`, note "not played"), so its payers are owed back. It is no longer finished. The sweep makes the tick's one cancel in a new step 4, from one call site, so `check:locks` still sees one court-lock run. | `tournaments-lifecycle` sweep (`te`); `tournaments-money` "a closed tournament never played…" |
| DB-4 (low) | 0301 both standings reads | The aggregate orders by `rank, seed_no nulls last, entry_id`, the function's own order. | `tournaments-play` reads: desk order equals `app.tournament_standings`; public `no` order matches |
| OP-1 (medium) | `roundsLogic.ts` `buildFrom`, `courtsInPlay` | Next round and Regenerate draw on the courts the play has used (the desk's Start choice), not on every adopted court. | `roundsLogic.test.ts` "the courts after Start" |
| OP-2 (low) | `RoundsBoard.tsx`, `drawBlocker` | Next and Regenerate are disabled with `ws.tournaments.rounds.needPlayers` or `needCourts` when the engine would refuse. Before this the desk got an unexplained generic error. | `roundsLogic.test.ts` `drawBlocker` |
| MOB-3 (low) | `logic.ts` `tourPlacesOf`, `app/tournaments.tsx`, `app/tournament/[id].tsx` | Once a tournament is no longer open, the list row shows its status, and the detail drops "Places left". | `logic.test.ts` "where the registration stands" |
| OP-4 (low) | `DeskCalendar.tsx` | Only a block its tournament still holds (`isLiveAdoptedBlock`) refuses the drag and opens the tournament. A finished or cancelled tournament's leftover block is the desk's again. | `calendarSource.test.ts` (source text) |
| MOB-5 (low) | `errors.ts`, `app/tournament/[id].tsx` | A withdraw refused past the cut-off reads the new `tournaments.guest.errors.withdrawCutoff` ("…The desk can take you off."). Register keeps `notOpenCutoff`. | `errors.test.ts` |
| WEB-6 (low) | `lib/tournaments.ts` `registrationOpen`, `Events.tsx`, `events/[id]/page.tsx` | "Register in the app" also needs the read's `server_now` to be before `registration_closes_at`. The read's own cache (up to a minute) is the lag that remains. | `tournaments.test.ts`, `Events.test.tsx`, `page.test.tsx` |

The contracts (`build-contracts-2026-10-03.md`: the status and cancel_reason rows, the detail's
roles, the R22 rule) say the same now. The assistant map was regenerated for the changed function
comments.

Gates after the fixes (local, Docker up):

- Root `pnpm typecheck` 9/9 and `pnpm lint` 9/9 (mobile: 73 warnings, 0 errors).
- Tests, one package at a time: core 1128, i18n 96, web 820, mobile 1983, operator 3253,
  operator-shell 304 (`native:node` first, `native:electron` after), court3d 83. The turbo run
  with all packages at once hit the Windows `EBUSY` on vitest's temp cache in mobile again. Run
  on its own, mobile passed.
- `pnpm --filter @touch/mobile test:smoke`: 24 suites, 535 tests.
- db: fresh `db reset` + fixtures, the full suite with `TP_REQUIRE_STACK=1`: 201 files, 3325
  passed, 8 skipped (the same 8 as before). A first run with the JSON reporter alone exited 1
  and wrote a report with only 160 files, so it was thrown away. The rerun with the default
  reporter is the result above.
- `check:migrations`, `locks`, `authz`, `safeupdate`, `invariants`, `broadcast`, `analytics`,
  `rpc-registry`, `assistant-coverage`, `error-codes`, `config-env` and `verify-jwt` all pass.
  `deno check --no-config --node-modules-dir=none */index.ts` passes (deno is not on PATH; it was
  run through the npx `deno` package). `pnpm db:types` gives no diff. `assistant:map --check`
  passes.
- `pnpm security` still fails at `security:audit` on the same two HIGH advisories
  (`http-cache-semantics`, `braces`). Every other step passes when run on its own.
- `pnpm e2e` was not rerun after the fixes.

## Still to do before the push

- Paperwork: `PHASE-2-CHECKLIST.md`, `PHASE-2-PLAN.md`, `HANDOFF.md`, the
  `docs/design/open-matches/db.md:95` fix (event blocks do take `lock_court`, 0174:697-699).
- `pnpm e2e` again after the review fixes (the operator Rounds board and calendar, the phone list and detail, the web CTA changed).
- The audit advisories above. Then the final fetch and merge, the waiting-deploy check, one push,
  and follow `ci.yml`, `deploy.yml` and the Vercel build; on hosted, check the `cron.job` row for
  `tp_tournament_sweep`.

## Moved out of the scaffold (and why)

- **`_shared/guest-push.json`, `send-push-guest.test.ts`, `outbox-kinds.test.ts`** go to DB-B
  (§1.12 S12). The JSON is read by stackless tests on both sides: `send-push-guest.test.ts` wants
  `GUEST_STRINGS` (DB-B's `guestStrings.ts`) to equal its `title_keys`, and the phone's
  `matches/__tests__/pushRoutes.test.ts` wants W-MOB's lists to equal its `kinds` / `routes`.
  Committed in the scaffold, it would turn root `pnpm test` red before any lane wrote a line. The
  exact change is frozen in §1.10. W-MOB's `pushRoutes.test.ts` goes green at the integration merge
  (or with the §1.10 JSON diff applied locally in its worktree, not committed there).
- **The phone's error list**: the phone resolves every code through `ERROR_CODE_KEYS`
  (`mapErrorToKey`), which the scaffold fills. A tournaments-specific phone list with its detail
  sentences (the `features/coaching/errors.ts` shape) lives in W-MOB's own
  `src/features/tournaments/errors.ts` (plan §5.2 feature folder), so the scaffold does not create it.

## How to run it

1. **Lanes** (plan §7, 0:50–3:00) branch from the scaffold commit. Only DB lanes use Docker in
   Phase 1, in turns. Only the integrator changes §1 of the contracts, by one cherry-pick at the
   2:00 checkpoint.
2. **DB landing** (3:00–3:30): `git fetch && git merge origin/main`; number the three files
   `max+1..max+3`; `sed -i 's/_0NNN\$/_<ordinal>$/g'`; move them into `supabase/migrations/`;
   `pnpm db:reset`, `node scripts/db-fixtures.mjs`, the db suite with `TP_REQUIRE_STACK=1`;
   `pnpm db:types`; one commit.
3. **App merges** (3:30–4:00) web → mobile → operator (take the regenerated `types.gen.ts` on any
   conflict); assistant coverage (5 tables, about 25 functions, `tp_tournament_sweep`, 2 routes, the
   docs), `check:rpc-registry --update-floor`, `pnpm --filter @touch/db assistant:map` once; grep the
   client call sites against the `pg_proc` argument lists.
4. **Gates** (4:00–4:50): plan §8 in full; e2e EN + AR; the engine parity test.
5. **Review, paperwork, push** (4:50–5:20): one `code-review` at medium; `PHASE-2-CHECKLIST.md`,
   `PHASE-2-PLAN.md`, `HANDOFF.md`, `packages/db/CLAUDE.md` (latest ordinal), the
   `docs/design/open-matches/db.md:95` fix; the waiting-deploy check; one push; follow the runs.

Commits are authored by Parsa with no co-author trailer (root `CLAUDE.md`).

## Owner and client steps (never run by an agent)

- **Client:** the fee amounts per run; the tax group for entry fees (default untaxed); the prize
  policy; bumping filling open matches when a tournament blocks courts; the public "First I." names
  (a Terms/Privacy line, consent 0153, possibly a `match_terms_version` bump); review of every
  DRAFT-AR string.
- **Parsa:** `tournaments_enabled` at one branch for the trial; the operator tag and the phone
  build after the push.
