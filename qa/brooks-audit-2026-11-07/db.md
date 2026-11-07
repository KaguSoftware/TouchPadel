# Brooks-Lint Review

**Mode:** Tech Debt Assessment
**Scope:** lane `db`. `packages/db`: `src/` (non-generated), `scripts/` (7.5k lines), `supabase/functions/` (26 edge functions plus `_shared`, 24.3k lines), the structure and harness of `tests/` (287 files; not every test was read), `bench/`, `fixtures/`. Migrations (399 files, 203,575 lines) were not read file by file. They were analysed as the **current schema**: a read-only scratch script (`scratchpad/audit/latest.mjs`) found the latest body of each of the 1,345 `app.*` functions, using both `create function` spellings, as CLAUDE.md says to.
**Health Score:** 26/100

The edge-function layer is well factored around `_shared/http.ts`, `supabase.ts` and `auth.ts`. The debt sits in the current schema: the same decision is written out many times. Role sets, branch timezone, hold liveness and closed value lists are literals inside immutable function bodies. One of those duplications is a live authorization bug: a second job lets staff get around the shop-only rules.

---

## Findings

### 🔴 Critical

**R3 Knowledge Duplication — A second job lets staff get around the shop-only restriction in 7 RPCs (Critical) [genuine bug]**
Symptom: Since 0345, `app.is_staff` counts `staff.extra_roles` (`20261016000345_staff_access.sql:100-107`, `s.role = any(roles) or s.extra_roles && roles`). `app.staff_role()` still returns the main role only (CLAUDE.md:347-348). Seven latest bodies let `shop_staff` in through `is_staff(...)`, then limit shop staff to the shop by testing `app.staff_role() = 'shop_staff'`:
- `upsert_menu_item`: `20260927000246_shop_products.sql:127` gate, `:132` limit. The manager release rules at `:157,:166` key on `staff_role() = 'manager'`.
- `upsert_variant`: `…0246_shop_products.sql:214` / `:221`
- `receive_delivery`: `20260927000245_shop_store.sql:303` / `:313`
- `start_count`: `…0245_shop_store.sql:367` / `:377`
- `record_waste`: `…0245_shop_store.sql:1256` / `:1277`
- `finalize_count`: `…0245_shop_store.sql:1394` / `:1406`
- `discard_count`: `…0245_shop_store.sql:1534` / `:1545`

Take a person whose main job is cashier, barista, chef, waiter, driver, marketing or court_desk, with `shop_staff` as a second job (`SECOND_JOB_ROLES` allows that: `packages/core/src/staff/access.ts:29-38`). That person passes the gate. Their `staff_role()` is not `shop_staff`, so none of the shop limits apply, and they are not `manager`, so none of the manager limits apply either. They can edit café menu items and switch them on without the release protocol, and count, receive into or write off the café and bakery stores. Neither job grants that on its own. 0383 fixed the opposite case, where a second job was locked out (`20261101000383_second_jobs.sql:1-40`). This case, where a limit fails open, was never re-issued. The phone path encodes the same rule correctly: `app.stock_may_count_at`. `tests/second-jobs.test.ts:112,125` asserts that a cashier with a shop second job may **not** count the café (`stock_pick_list('count','cafe')` → FORBIDDEN). The operator's `start_count(p_location => 'cafe')` lets the same person do it.
Source: Pragmatic Programmer — DRY; Evans — Ubiquitous Language. "Which jobs does this caller hold" has two meanings, `is_staff` and `staff_role()`, inside one body.
Consequence: The server-side authorization check fails open for every staff member who holds `shop_staff` as a second job. Menu and stock integrity lose the release-protocol and store limits that CLAUDE.md treats as the source of truth. The other 87 latest bodies that still branch on `staff_role()` (94 in total) have not been checked for the same flaw.
Remedy: Write a new migration that re-issues the 7 bodies from their latest text. Replace each `app.staff_role() = 'shop_staff'` limit with "shop staff is the caller's **only** route in": `not app.is_staff('manager','owner')` for the menu pair, and `app.stock_may_count_at(app.my_staff_roles(), loc)` / `stock_may_log_at` for the store bodies. Add `cashier+shop_staff` cases to `tests/second-jobs.test.ts` for each of the 7 RPCs. Then sweep the other 87 `staff_role()` bodies with the same question: does it narrow a role that a second job can add?
Fix-Class: Residual. It is a new migration that changes the behaviour of 7 client RPCs on hosted, and it needs new stack tests.
Priority: Pain×Spread = 3×2 = 6
Intent: accidental

### 🟡 Warning

**R3 Knowledge Duplication — Role sets are inline literals in 448 guarded bodies, 29 distinct sets, often written twice per body (Warning)**
Symptom: The guard helpers are shared (`app.is_staff`, `app.is_staff_at`). The role sets they take are not. Across the latest bodies: `('manager','owner')` ×173, `('court_desk','manager','owner')` ×52, `(cashier,court_desk,manager,owner,shop_staff)` ×21, and so on, 29 distinct sets in all. 224 bodies repeat the same literal list in `is_staff(...)` and then `is_staff_at(v_venue, ...)`, for example `20261101000383_second_jobs.sql:790` + `:795`, `:931` + `:935`. `stock_pick_list` writes the log, move and count sets of three other RPCs again (`…0383:1048-1050`, `:1055`). `packages/core/src/staff/stores.ts:46-55` writes the same sets a third time (`LOG_ROLES`, `COUNT_ROLES`, `MOVE_ROLES`, `STOCK_VIEW_ROLES`), and no test compares core to SQL (grep of `tests/` for these names: 0 hits). CLAUDE.md:439-442 records the cost: copying an older body "brings a five-role guard with it and locks the 0155 roles out", which is why 0156 had to re-issue about ten RPCs when roles were added.
Source: Fowler — Shotgun Surgery; Pragmatic Programmer — DRY.
Consequence: Adding a role or changing who may log stock means re-issuing every body that carries that literal. Core and SQL can drift without notice, which is the route by which the Critical above arose.
Remedy: Write a new migration with named role groups, for example `app.role_group('stock_log') returns staff_role[]` (or `app.is_in_group(venue, 'stock_log')`), as one table or function. Move bodies over as they are next re-issued. Add a parity test that compares `role_group` rows to the core constants, in the style of `staff-roles-parity.test.ts`.
Fix-Class: Residual. It changes the schema over hundreds of bodies. Only the parity test is Extended-Safe.
Priority: 2×3 = 6
Intent: accidental

**R2 Change Propagation — Closed value lists live inside immutable function bodies, so each new value needs a full re-issue (Warning)**
Symptom: `app.notify_staff` has been defined 11 times. The definitions are 0160 staff_push, 0169 staff_push_keys, 0193 staff_push_keys_wave5, 0261, 0308, 0313, 0322, 0323, 0333, 0362 and 0363. After 0160, each one exists mainly to add push title keys. The list is the `c_title_keys` constant at `20261022000363_protocol_watch.sql:95-112`. The same pattern recurs in `profile_merge_columns` ×8 (a `values` table in a function, `20261105000403_loyalty_rewards_only.sql:1364-1420`), `cafe_setting_specs` ×5 (`20261021000355_shop_sale_rewards.sql:60`), `assistant_run_tool` ×5 (`20261020000354_venue_files.sql:685`, 229 lines) and `set_staff_access` with its CHECK ×3 (`20261022000362_marketing_plan.sql:981`).
Source: Fowler — Divergent Change; Hunt & Thomas — Orthogonality.
Consequence: Adding a push kind or a setting means copying a 60–230-line body verbatim into a new migration (CLAUDE.md:432-436), plus the JSON and string twins. Each copy is a chance to resurrect an old body, the 0115→0119 failure. Tests do guard the lists (`tests/staff-push-keys.test.ts`, `tests/account-merge.test.ts:128-143`), so the cost is labour, not silent drift.
Remedy: For the next re-issue of each, move the list into a table seeded by the migration (`app.staff_push_title_keys`, `app.cafe_setting_spec`) and have the body read it. A new value then becomes an `insert` migration. The existing parity tests read the table.
Fix-Class: Residual (schema change).
Priority: 2×2 = 4
Intent: intentional (closed lists by design, test-guarded), but with no plan to reduce the re-issue cost

**R2 Change Propagation — The "who holds the latest body" ledger in packages/db/CLAUDE.md is hand-kept and already stale (Warning)**
Symptom: 1,345 functions, 2,257 definitions, and 196 functions defined 3 or more times (`notify_staff` 11; `hold_slot`, `staff_create_reservation`, `verify_manager_pin`, `is_degraded` 10 each). CLAUDE.md carries about 86 "holds" statements naming the latest file. Spot checks found stale entries:
- `CLAUDE.md:447` says 0263 holds `hold_slot`. The real latest is `20261001000269_principal_lock_caps.sql:56`.
- `CLAUDE.md:440` says 0156 holds `verify_manager_pin` and `heartbeat`. The real latest bodies are `20260926000231_branch_scoped_reads.sql:828` and `20261101000397_retired_station_beat.sql:35`.
- `CLAUDE.md:109` says "Latest is `0376`" and `:418` says "the next is `0373`", while `20261105000403` exists.

`scripts/lib/fn-signatures.mjs` already replays every definition in file order. It just doesn't emit the result.
Source: Ousterhout — Information Leakage; Pragmatic Programmer — DRY. A fact the code can compute is kept by hand.
Consequence: Someone who trusts the ledger re-issues an old body, which is the exact failure the verbatim rule exists to prevent (0115 → stray overloads, fixed by 0119). The file is 949 lines and grows with every migration.
Remedy: Add a script, for example `scripts/latest-bodies.mjs` built on `fn-signatures.mjs`, that writes `fixtures/latest-bodies.json` (name → file:line, arity). CI diffs it like `db:types`. Replace the prose ledger with a pointer to the fixture, and keep only the *why* notes.
Fix-Class: Extended-Safe. A new script, fixture, CI step and a CLAUDE.md edit: at most 5 files, no exported symbol.
Priority: 2×3 = 6
Intent: accidental

**R3 Knowledge Duplication — Four SQL lexers and five "latest body" finders; the migration gate's copy misses digit-bearing dollar tags (Warning) [genuine bug]**
Symptom: `scripts/check-migrations.mjs:509` recognises a body only by `/^\$[A-Za-z_]*\$/`. The repo convention is `$<name>_<NNNN>$`, for example `$override_0049$`, and that regex never matches a tag with digits. Running the gate's own `statements()` over the migrations: **312 files** have their function bodies broken up into **24,081 pseudo-statements**, against the function's own doc at `:449-452` ("Without the dollar-quote handling every `create function` body would be shredded"). The copy in `scripts/lib/fn-signatures.mjs:72` has the right regex (`^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$`), and its comment at `:26-27` says "Same scan as check-migrations.mjs statements()". A third lexer is in `scripts/drift-filter.mjs:48-57` and a fourth in `scripts/build-assistant-map.mjs:305`. The "latest body of app.X" finder exists in `tests/coaching-source.ts:22` and is written again in `tests/delete-my-account-latest.test.ts:17`, `tests/sweeps-report.test.ts:72-76` and `tests/assistant-catalog.test.ts:40-44`. `tests/coaching-online.test.ts:70-74` pins one file and matches `create or replace` only, the spelling CLAUDE.md:432-436 says is not enough.
Source: Fowler — Duplicate Code; Pragmatic Programmer — DRY.
Consequence: The rules that check DDL inside new migrations (`index-not-concurrent`, `drop-column`, `column-type-change`, `not-null-direct`) currently also scan plpgsql body text. That gives false positives today, and false negatives if a body ever unbalances a quote (an E-string, for example). Fixing one lexer leaves the other three as they were.
Remedy: Fix the regex in `check-migrations.mjs:509` now (Safe). Then export a single `statements()` / `latestBody()` from `scripts/lib/` and import it from `check-migrations`, `drift-filter`, `build-assistant-map` and the four tests.
Fix-Class: Safe for the one-line regex fix. Consolidation is Extended-Safe, in batches of 5 files or fewer.
Priority: 1×3 = 3
Intent: accidental

**R3 Knowledge Duplication — The hold-liveness predicate (is the court taken?) exists in three bodies with no parity test (Warning)**
Symptom: `app.hold_is_live` (`20261002000294_coaching_reads.sql:62-71`) restates the WHERE of `expire_stale_holds` (`20261002000291_lesson_booking_guards.sql:277-285`) and `match_expire_holds` (`…0291:313-321`). The only guard is a comment: "whoever changes their WHERE changes this in the same file" (`…0294:59-61`; CLAUDE.md:489-490). A grep of `tests/` for `hold_is_live` finds 0 hits.
Source: Pragmatic Programmer — DRY; Fowler — Duplicate Code.
Consequence: A change to the hold rules (TTL, the payment grace window, orphans) that misses one copy makes `coach_slots` / `tournament_feasibility` disagree with the sweep about whether a court is free. Booking availability then contradicts itself.
Remedy: Add a source-text parity test now, using `latestBody` to extract and compare the three predicates. Next time the sweep pair is re-issued, have them call `app.hold_is_live(r)` only if the plan cost is acceptable. A `security definer` SQL helper is not inlinable (see `tests/sql-helpers-not-inlinable.test.ts`).
Fix-Class: Extended-Safe for the test. Residual for the migration.
Priority: 2×1 = 2
Intent: accidental (a documented twin with no enforcement)

**R3 Knowledge Duplication — A branch's timezone is resolved four different ways (Warning)**
Symptom: There are two columns. 0122 declared `venue_settings` the source of truth and said "nothing reads them off venues yet" (`20260921000122_venues.sql:23-27`). Today the latest bodies read `venues.timezone` in 33 cases (e.g. `20261101000383_second_jobs.sql:1143`, `20261101000388_report_exports.sql:70`), `venue_settings.timezone` in 21 (e.g. `20261022000364_ranks_leaderboard.sql:205`), and `coalesce(vs.timezone, v.timezone)` in others (`20261101000390_closed_days_and_tournament_confirm.sql:328`). 37 of them hardcode the `'Asia/Baghdad'` fallback, and no helper function exists. The edge functions add two more sources:
- `platform_settings.timezone`, chain-wide: `assistant-chat/index.ts:465-469`, `assistant-job/index.ts:195-200`, `assistant-component/index.ts:216,236`.
- A hardcoded `'Asia/Baghdad'`: `analytics-posthog/index.ts:44,548`, `assistant-index/index.ts:40,84`, `send-push/index.ts:142-144`. `formatWhen` there carries the comment "venue timezone (venue_settings.timezone)", even though the same handler resolves `venue.timezone` at `:434`.

Source: Evans — Ubiquitous Language; Pragmatic Programmer — DRY.
Consequence: A second branch in another timezone, or an edit to one of the two columns, gives different business days in reports, the assistant, PostHog analytics and booking pushes. `create_branch` writes both columns (`20261008000323_checklist_schedules.sql:1778,1785`), but nothing keeps them in step afterwards.
Remedy: Write a new migration adding `app.venue_tz(p_venue uuid)` with one source of truth and one fallback, plus a trigger or a drop that settles the duplicate column. Edge functions read the branch's timezone through one `_shared` helper (`branchTimezone(client, venueId)`) and never through a constant.
Fix-Class: Residual. It spans schema and edge functions.
Priority: 2×3 = 6
Intent: intentional at 0122 ("until slice 2"); the payback never happened, so it is treated as accidental

**R1 Cognitive Overload — God handlers in the edge layer (Warning)**
Symptom:
- `supabase/functions/assistant-chat/index.ts` has 1,701 lines. The `Deno.serve` handler alone runs from `:1121` to `:1701` (580 lines). The same file also holds conversation persistence (`maxSeq`, `insertMessage` `:330-363`), six tool dispatchers (`:493-819`), prompt budgeting (`:820-884`), the re-check (`:946-1049`) and answer reuse (`:1050`). Nesting reaches depth 6 (`:589`).
- `analytics-insights/index.ts` has 1,007 lines: prompts, payload trimming, its own Groq client (`:287-333`) and the handler (`:909`).
- `send-push/index.ts` is one 360-line handler (`:194-555`) with nesting depth 7 (`:318`).
- `assistant-component` has 750 lines, `assistant-job` 692 and `replay` 669.

Source: Fowler — Long Method; McConnell — Code Complete ch. 7.
Consequence: These are the costliest paths (LLM spend, the replay of offline money). Each change means reading 600–1,700 lines, and the handlers can't be unit-tested apart from Deno and Supabase. The parts that were extracted (`_shared/assistant/turn.ts`, `protocol-action/logic.ts`, `*-begin/logic.ts`) show the pattern already works here.
Remedy: Split as `protocol-action` and `ticket-begin` already do. Move the tool dispatchers into `assistant-chat/dispatch.ts` and persistence into `_shared/assistant/conversation.ts`. Give `send-push` a `kinds/` table of per-kind renderers, and keep each handler under about 100 lines of orchestration.
Fix-Class: Extended-Safe. Edge functions export no public symbols. Do it in passes of 5 files or fewer with the db suite green.
Priority: 2×2 = 4
Intent: accidental

**R1 Cognitive Overload — God functions in the current schema, multiplied by the verbatim re-issue rule (Warning)**
Symptom: 189 latest `app.*` bodies are over 100 lines, and 39 are over 200. The largest: `merge_profiles_internal` 568 (`20261024000368_customer_facts.sql:1010`), `lesson_sweep` 428 (`20261101000402_sweeps_report.sql:420`), `match_sweep` 366 (`…0402:46`), `loyalty_redeem` 346 (`20261105000403_loyalty_rewards_only.sql:760`), `marketing_insights` 335 (`20261024000369_customer_analytics.sql:341`), `price_promo_numbers` 326 (`20261001000285_price_promo_lessons.sql:1141`), `delete_my_account` 315 (`20261005000306_loyalty_promotions.sql:341`), `create_branch` 306 (`20261008000323_checklist_schedules.sql:1715`) and `report_drill` 303 (`20261101000388_report_exports.sql:18`).
Source: Fowler — Long Method; Ousterhout — Strategic vs Tactical Programming.
Consequence: Because a re-issue copies the whole body, a one-line change to `delete_my_account` (5 definitions) or `merge_profiles_internal` (5) produces a 300–570-line migration that reviewers cannot diff against its predecessor. 0402 had to re-issue six such bodies just to add monitoring calls.
Remedy: Next time one of these is re-issued, extract its stable sub-steps into small internal `app.` helpers (as `app.court_hour_value` and `app.hold_is_live` already do), so later changes re-issue the helper rather than the giant.
Fix-Class: Residual (new migrations).
Priority: 2×2 = 4
Intent: accidental

**R3 Knowledge Duplication — The assistant edge functions re-implement shared helpers (Warning)**
Symptom:
- `errorText` exists three times with drift: `_shared/assistant/turn.ts:157` (Clean only), `assistant-job/index.ts:114` (adds ProviderError) and `assistant-component/index.ts:298` (adds PostgrestError, which is what `_shared/http.ts:164 errorMessage` already does, with another separator).
- `venueTimezone` / timezone lookup exists 3–4 times (`assistant-chat:465`, `assistant-job:195`, `assistant-component:216,236`), and `DEFAULT_TZ` 4 times (`assistant-chat:240`, `assistant-job:64`, `assistant-component:58`, `send-push:76`).
- There are three Groq HTTP clients: `_shared/assistant/providerGroq.ts:95` with `retryAfterMs` at `:66`; `assistant-free/index.ts:86-117`, which copies that `retryAfterMs` regex as `retryAfter`; and `analytics-insights/index.ts:70,287-333`, with its own `GROQ_URL` next to `_shared/assistant/groqWire.ts:16`.

Source: Fowler — Duplicate Code; Alternative Classes with Different Interfaces.
Consequence: A change in Groq's rate-limit wording or URL, or a new Postgrest error shape, has to be fixed in up to three places, and logs differ by function.
Remedy: Export one `errorText` from `_shared/http.ts` that handles all four shapes. Put `branchTimezone()` in `_shared` (see the timezone finding). Have `assistant-free` and `analytics-insights` call `providerGroq`, or at least `groqWire.GROQ_URL` + `retryAfterMs`.
Fix-Class: Extended-Safe (at most 5 edge files per pass, no public API).
Priority: 1×2 = 2
Intent: accidental

**R3 Knowledge Duplication — Test harness copied into 64 files (Warning)**
Symptom: 64 test files define their own `psql()`, 42 their own `scenario()` and 41 their own `ok<T>()`, for example `tests/monitoring.test.ts:29,89,115` and `tests/checklists.test.ts:48,160,181`. Only 6 import the shared `tests/psql-scenario.ts:14`. The copies have drifted: 50 use `-qAt` and 12 use `-At`, 4 add `-X`, and 17 omit `maxBuffer`, so they fall back to Node's 1 MB default against 64 MB elsewhere.
Source: Fowler — Duplicate Code; Meszaros — Test Utility Method.
Consequence: Changing the container name, the psql flags or the result shape means 64 edits. The 17 without `maxBuffer` can fail on large result sets for reasons unrelated to the test.
Remedy: Move the remaining suites onto `psql-scenario.ts`, adding `scenario`, `ok` and `Results` there, a few files per change.
Fix-Class: Extended-Safe (test-only, 5 files or fewer per pass).
Priority: 2×2 = 4
Intent: accidental

**R2 Change Propagation — The assistant-map builder hardcodes the operator's route layout and has fallen behind (Warning)**
Symptom: `scripts/build-assistant-map.mjs:548-558` (`FEATURE_ROUTE`), `:598-612` (`LABEL_ROUTE_HINTS`) and `:613-618` (`CATALOG_FILE_ROUTE`) are hand maps from operator feature folders to routes. 25 of the 41 folders in `apps/operator/src/features/` are missing, among them `wages`, `safe`, `files`, `loyalty`, `tournaments`, `protocols` and `rewards`, and RPCs are called from several of them (e.g. `features/wages/MarkPaidDialog.tsx`). `routeOfFile` returns `null` for an unmapped folder (`:588-592`), so those RPCs' action chunks get `route: null` and no "(pages …)" line (`:952,959,964`).
Source: Ousterhout — Information Leakage; Fowler — Shotgun Surgery.
Consequence: Every new operator feature needs an edit to a db script, and nothing fails when it is forgotten. The assistant can't send the owner to the page for a growing share of RPCs.
Remedy: Derive the route from `apps/operator/src/routes/` and the folder name, or fail the build (as `check-assistant-coverage` does for other gaps) when a feature folder that calls an RPC has no route.
Fix-Class: Extended-Safe (one script plus its test).
Priority: 1×2 = 2
Intent: accidental

### 🟢 Suggestion

**R4 Accidental Complexity — `@touch/db` runtime exports nobody imports (Suggestion)**
Symptom: `packages/db/src/index.ts:14-23` exports `IDEMPOTENCY_KEY_PATTERN`, `CLIENT_REF_PATTERN`, `makeIdempotencyKey(station, type, ulid)` and `makeClientRef(station, ulid)`. Dead-code gate: `git grep -w IDEMPOTENCY_KEY_PATTERN` and `-w CLIENT_REF_PATTERN` outside this file and the generated `assistant-map.json` return 0 hits. `git grep "@touch/db['/]"` shows no runtime import, only aliases in `apps/operator/vitest.config.ts:21` and `apps/web/next.config.ts:45`. The two `make*` names have callers, but they all import core's versions, which have different signatures (`packages/core/src/schemas/mutations.ts:184,193`; e.g. `apps/operator/src/lib/idem.ts:7-12`).
Source: Fowler — Speculative Generality / Duplicate Code.
Consequence: There are two definitions of the idempotency-key format, and one of them has drifted to a different signature. A newcomer importing from `@touch/db` gets the wrong one.
Remedy: Remove the four runtime exports and leave `@touch/db` as types only, as its own header says ("re-exports the generated Database types").
Fix-Class: Residual by rule, because it removes exported symbols. In practice it is low risk, since no importer exists.
Priority: 1×1 = 1
Intent: accidental

**R4 Accidental Complexity — A tracked zero-byte stray file `packages/db/1h,` (Suggestion)**
Symptom: `git ls-files "packages/db/1h,"` lists it. It was added by commit `124387a7` ("test") next to a migration edit. It is already flagged as a mistake in `PHASE-2-PLAN.md:262` (O9) and `docs/security/HANDOFF-security.md:279`. No code refers to it, and the only textual mentions are those docs and their copy in `fixtures/assistant-map.json`.
Source: Fowler — Dead Code.
Consequence: Noise. It has been carried as a known open item since September.
Remedy: `git rm "packages/db/1h,"`, then regenerate the assistant map, which quotes the doc.
Fix-Class: Safe.
Priority: 1×1 = 1
Intent: accidental

**R3 Knowledge Duplication — The DB-target safety guard is copied into 3 loader scripts, and psql plumbing into 10 (Suggestion)**
Symptom: `hasPsql` and `isLocalTarget` appear byte-identical in `scripts/db-client.mjs:28-40`, `scripts/db-menu.mjs:14-33` and `scripts/db-fixtures.mjs:27-46`. `CONTAINER` with a local `psql()` is redefined in 10 scripts (e.g. `check-lock-order.mjs:55-57`, `check-safe-update.mjs:40-42`, `wipe-user-data.mjs:71-79`). Side note: `new URL(...).hostname` for an IPv6 URL is `[::1]`, so the `'::1'` branch never matches. That fails closed, so it is safe, but it is dead.
Source: Pragmatic Programmer — DRY.
Consequence: The guard against loading the wrong database is a safety rule. A fix to one copy, such as recognising `[::1]`, will not reach the other two.
Remedy: Add `scripts/lib/pg.mjs` exporting `hasPsql`, `isLocalTarget`, `CONTAINER` and `psql()`, and import it from each script.
Fix-Class: Extended-Safe (at most 5 scripts per pass).
Priority: 1×1 = 1
Intent: accidental

**R6 Domain Model Distortion — The send-push booking strings claim a source of truth that doesn't exist (Suggestion)**
Symptom: `supabase/functions/send-push/index.ts:78-81` says "SOURCE OF TRUTH: packages/i18n … keep in sync with the `push.*` keys there". `packages/i18n/src` has no `booking_confirmed` key; the only `push:` blocks there are the tournament guest catalogs. "Your game is in 3 hours" exists only in this file.
Source: Evans — Ubiquitous Language. The documented model does not match the code.
Consequence: Someone editing push copy in i18n changes nothing, and someone reading the edge function thinks a parity check exists when it doesn't.
Remedy: Either fix the comment to say this file owns the copy, or move the strings into `_shared/guest-push.json` like the other guest kinds, which are test-guarded (`tests/send-push-guest.test.ts:222-250`).
Fix-Class: Safe (comment) / Extended-Safe (move).
Priority: 1×1 = 1
Intent: accidental

---

## Summary

The most important action is the Critical: re-issue the 7 shop-narrowing RPCs so that a second job cannot get around the shop-only limits. After that, sweep the other 87 bodies that still read `staff_role()`. The structural trend is one root cause showing up again and again. Every decision written as a literal inside an immutable function body (role sets, timezone, hold liveness, closed lists) multiplies with each re-issue, and the hand-kept ledger meant to track those re-issues is already wrong. Named role groups, a `venue_tz` helper, list tables and a generated latest-bodies fixture would stop the growth.

---

## Top offenders

| File / body | Lines | What's tangled |
|---|---|---|
| `supabase/functions/assistant-chat/index.ts` | 1,701 | A 580-line handler plus persistence, 6 tool dispatchers, budgeting, re-check and reuse in one file |
| `tests/helpers.ts` | 1,736 | 61 exports: clients, café, venue-B, match, ticket and station plants, plus SQL money checks, all in one module |
| `scripts/build-assistant-map.mjs` | 1,174 | Migration parser (4th lexer), schema inventory, hardcoded operator route maps, chunking and rendering |
| `supabase/functions/analytics-insights/index.ts` | 1,007 | Prompts, payload trimming, its own Groq client, judge flow and handler |
| `supabase/functions/assistant-component/index.ts` | 750 | Its own `errorText`, timezone lookup ×2, generation, cache, prewarm |
| `supabase/functions/assistant-job/index.ts` | 692 | Its own `errorText` and `venueTimezone`; the `Book` class mixes bookkeeping with runs |
| `supabase/functions/replay/index.ts` | 669 | Its own staff check (documented), queue replay and conflict judging |
| `scripts/check-migrations.mjs` | 663 | Its own lexer with the dollar-tag bug |
| `supabase/functions/send-push/index.ts` | 555 | A 360-line handler, nesting depth 7, inline booking strings, hardcoded timezone |
| `app.merge_profiles_internal` (`…0368:1010`) | 568-line body | The whole account merge in one function, defined 5 times |
| `app.lesson_sweep` / `app.match_sweep` (`…0402`) | 428 / 366 | Cron bodies re-issued whole to add monitoring calls |
| `app.notify_staff` (`…0363:86`) | 72-line body, 11 defs | A closed title-key list inside the body |

## Looks bad but is fine

- **The `StaffRole` union is copied into `_shared/auth.ts:22-41`** (Deno cannot import core). `tests/staff-roles-parity.test.ts` compares every copy and the enum.
- **`_shared/insightsContract.ts`, `insightsText.ts` and `_shared/assistant/tools.ts` are byte copies of core.** Parity tests cover them (`insights-text-parity.test.ts`, `assistant-catalog.test.ts`), as CLAUDE.md:323-324 requires.
- **`tests/rls-matrix.ts` (7,670 lines)** is declarative data, the sign-off matrix (header `:1-9`). Its size is what it is for.
- **Edge-function plumbing is not duplicated:**
  - All 26 functions use `handle()`; CORS is set once (`_shared/http.ts:210-254`); there is no bespoke CORS anywhere.
  - Clients come only from `createServiceClient` / `callerClient` (`_shared/supabase.ts`).
  - Staff auth is `requireStaffRole`, backed by the pure, tested `judgeStaffAccess` (`_shared/staffAccess.ts`).
  - Error shaping goes through `json` / `mapPgError` / `pgErrorBody`.
  - `deposit-begin`, `lesson-begin` and `ticket-begin` share `_shared/deposits.ts`, with a `logic.ts` each.
- **RPC permission checks are shared helpers, not copied logic.** `app.is_staff`, `is_staff_at`, `analytics_guard` and `reports_guard` are used everywhere. Only the role *sets* are literals (Warning above).
- **`profile_merge_columns` being re-issued 8 times** is a burden, but drift is impossible: the FK-coverage test (`tests/account-merge.test.ts:128-143`) fails on any unlisted profile FK.
- **Migration count, immutability, the verbatim re-issue rule, the timeout preamble and the NOT VALID / VALIDATE dance** are CLAUDE.md rules, not debt.
- **Lowercase `{error:'forbidden'}`** in `send-push:197`, `telegram-send:95` and `assistant-job:614`: these endpoints are service-role / cron only, and the operator maps by status (`auth.ts:8-12`).
- **`replay` keeps its own staff check** (`replay/index.ts:40-47`). It is documented: it checks two people, the caller and the PIN holder.
- **`bench/`** is wired to scripts and to `.github/workflows/bench.yml`.
- **The UUID regex in `_shared/assistant/tools.ts:1127`** belongs to the byte copy of core.

## Debt Summary

| Risk | Findings | Avg Priority | Classification | Intent |
|------|----------|-------------|----------------|--------|
| Cognitive Overload      | 2 | 4.0 | Scheduled | accidental |
| Change Propagation      | 3 | 4.0 | Scheduled | mixed (closed lists intentional; ledger and route maps accidental) |
| Knowledge Duplication   | 8 | 3.8 | Scheduled (contains the Critical bug, P=6) | accidental |
| Accidental Complexity   | 2 | 1.0 | Monitored | accidental |
| Dependency Disorder     | 0 | — | — | — |
| Domain Model Distortion | 1 | 1.0 | Monitored | accidental |

**Recommended focus:** Knowledge Duplication in the current schema: second-job narrowing (the Critical), role groups, branch timezone, hold liveness. Then Change Propagation: a generated latest-bodies fixture in place of the hand ledger, and list tables in place of list constants.

**Health Score (balanced):** 100 − 15 (1 Critical) − 55 (11 Warning) − 4 (4 Suggestion) = **26/100**

Limitations: no gate was run (read-only audit). The Critical was established by reading the latest bodies and the 0383 test expectations, not by running it on the stack. `_shared/assistant/clean.ts` (850), `turn.ts`, `turnPolicy.ts` and `replay/index.ts` were outlined, not read in full.
