# Touch Padel: the whole repo, and the Phase 2 scope

Written 2026-09-19 at `main` @ `3d70643` (clean tree, `two` fully merged). Sources: three Opus audits (backend, frontends, contract/ops) plus direct verification against migrations, edge functions, apps, the live deployment and the signed SOW. Every claim below was checked against code, not against `HANDOFF.md`, which is six days and ~4,000 diff lines stale and misstates several security items (see A3, O8).

**Status 2026-09-20: approved and building.** Change-control is agreed; the build runs on `main`, Parsa + agents only, criticals first. The section below is the live status; Parts A–D are the 09-19 audit and stand as written except where the status section corrects them. The full decision record and per-milestone design now live in `~/.claude/plans/i-got-this-scope-binary-piglet.md` (Parsa's machine); where it and this file disagree, that file wins.

## Status 2026-09-20 — what changed, what is built, what is left

### Decisions since 09-19

- **Scope is nine items; item 10 (AI analysis) is dropped.** Majed's owner assistant (migrations 0108–0113, three edge functions, operator drawer, pushed 09-20 21:21) stays on `main` **gated and unbilled**: off while `ANTHROPIC_API_KEY` is unset and `venue_settings.llm_daily_request_limit = 0`. It was built single-venue; milestone 1 gives it the venue axis.
- **Payment = Qi Card**, hosted page first. Majed's design `docs/design/payments/qi-deposit-plan-2026-09-20.md` ("nothing built") is adopted as the payment model with `venue_id` and a `purpose` column widened to deposit / balance / seat / tournament / lesson. It replaces C1's `payment_intents` sketch, which violated the lock-order gate. Deposit defaults: 50 %, floor 10,000 IQD, forfeit inside the window and on no-show, launch `optional`. Credentials pending from Qi.
- **Milestone order:** 0 criticals → 1 multi-venue → 2 payment → 3 Customer 360 + loyalty (with web sign-in at checkout) → 4 shop + AI receipts → 5 coaching → 6 open matches → tournaments.
- Second venue opening soon, seeded as a copy of venue 1; everything per venue with copy-from-venue-1. Coaches are guests with a coach record (phone-app coach mode, no staff role); 60 % of the fee net of the court share, monthly statement, payout outside the till. Loyalty 1 pt / 1,000 IQD in every domain, redeemed as a `tab_adjustments` kind (never a payment method) plus a rewards catalogue; three tiers over rolling 12 months, goods discount only in v1. Matches: 4 seats, equal split, host covers empty seats, first name + last initial shown. Tournaments: individuals enter, desk records scores, standings per event by polling. Shop: hybrid model (menu items in `kind = 'shop'` categories + a `retail` ingredient kind). Receipts: manager confirms, 20 USD/month cap. Customer 360: LTV net of refunds; managers see contact details. S12 (Quit without PIN) accepted. C3: queue `refund`, `cancel_tab`, `settle_zero_tab`, `void_after_send`; the rest stays online-only. Same legal entity, one Qi merchant. **PITR and a staging project before the multi-venue push** (reverses the 08-30 decision). Arabic drafted by agents, client reviews, AR e2e must pass. TestFlight + Play internal testing per milestone.

### Corrections to Parts A–C found by the 09-20 code verification

`0092` is `reservation_players` (one smallint column), not series — series is `0066`. There is no station registry (`station_staff` is break cover); multi-venue must build one. 66 public tables, not 45; the backfill must disable the five `forbid_mutation` triggers; five global UNIQUE constraints collide at branch two. `check:authz` runs in the CI db job, not in `pnpm security` (which has no stack). The mutation contract has five copies (add `apps/operator-shell/src/main/ipc-validate.ts` and `queueResults.ts`). Push kinds need a CHECK migration plus copy in `functions/send-push` and the function deployed first. Every enum widening is its own migration. `llm_usage` stays global. The loyalty and shop designs in C5/C6 needed reshaping (points as a payment method would touch 61 filters; retail as a separate tree forks eight stock functions); the adopted shapes are in the decisions above.

### Milestone 0 (criticals) — built 2026-09-20, all gates green, pushed

| Part B item | State |
| --- | --- |
| 1 hosted state, PITR, staging project | **owner, open** |
| 2 rotate seed staff accounts and PINs | **owner, open** — must land before 0115 reaches hosted (weak pre-0078 PINs are refused there) |
| 3 replay: C1 lost mutations, S2 PIN leak, S5 `log_replay`, C4 parity | done — `0114`, `_shared/http.ts` retryable classes, `_shared/redact.ts`, `_shared/mutation-types.json` + boot guard, worker treats duplicate-of-conflict as conflict |
| 4 S3 PIN lockout on money RPCs | done — `0115`: single-use grant minted by `verify_manager_pin`, consumed by the five money RPCs (`PIN_GRANT_REQUIRED` without one); weak-PIN refusal; `appRpc`, replay and the test helper verify first; two operator gates that accepted any PIN online fixed |
| 5 S4 release gate, workflow permissions, S9 CLI pin + ledger dump | code done — `environment: release` on publish, `permissions: contents: read` ×6, CLI 2.116.0, dump = five public ledgers; **owner half open** (`docs/client/release-gate-2026-09-20.md`) |
| 6 mobile S6 + email sign-in restored | done — deep-link tokens branch gone, reset form only after an in-session recovery, Phone \| Email on sign-in/sign-up/forgot; **owner:** Supabase Auth email settings and redirect allow-list |
| 7 C2 `retire_device` + thresholds + screen | done — `0118`, Settings → Venue details "Offline mode" + Devices panel |
| 8 S7 profile CHECKs, S8 web CSP, S9 workflows, S10/S11 OTP config | S7 `0116`, S8 (matcher, `requireLocale()`, token route handler) and S9 done; **S10 open** |
| 9 C3 queued money ops, `refund` idempotency key, `stock.waste` | **open** |
| 10 ordinal gate rules, S13 one allowlist, `QK` keys | done (`check:authz` already in the CI db job) |
| 11 web/mobile jsdom smoke tests, `testID`s, `packages/db/bench` | **open** |
| 12 rules files, HANDOFF reconciliation, scope addendum, deviation records | rules files done (`packages/db`, `apps/operator`, `apps/mobile`, `apps/web` `CLAUDE.md`); **rest open** |
| C5 quote = charge | done — `0117`: hold stamps price, `PRICE_CHANGED` at confirm, mobile maps it |

Also done: registry gate replays GRANT/REVOKE/DROP; data-hygiene gate requires digit boundaries; assistant map regenerated; `types.gen.ts` hand-patched for `retire_device`, `consume_pin_grant`, `pin_grant_ttl` minus `log_replay` (regenerate with Docker). DB integration suites (`pin-grants`, `booking-quote`, `retire-device`) are CI-only until Docker runs. **Next migration ordinal: 0119.**

### What is left, by milestone

- **0** items 9, 11, the docs remainder of 12, S10, and the owner steps above. About one third of the milestone.
- **1 multi-venue** (6–7 weeks): `venues`, `venue_id` on every scoped parent table with the trigger-aware backfill, `stations` registry replacing the client-asserted station id, `staff_venues`, `platform_settings` split off `venue_settings`, composite uniques, per-venue degraded mode with zero-arg overloads kept, realtime topics per venue, the seven `.single()` client reads converted, owner venue switcher, mobile venue picker, web default venue, venue axis on the assistant tools, matrix principals per venue, two-venue fixture, rehearsal on staging.
- **2 payment** (3–4 weeks + Qi lead time): Majed's design with `venue_id` + widened `purpose`, `booking_payments` after `reservations` in the lock order, `court_fee_paid` nets online amounts, `expo-web-browser`, `/pay/return` + `/pay/status` + `+not-found`, web return page, four edge functions + fake provider, bulk refund RPC, day-close and report columns, go-live gates.
- **3 customers + loyalty** (6–7 weeks): `tabs.customer_id`, session re-key RPC, web sign-in (phone OTP + Google + Apple), `customer_identities`, `customer_metrics` table, `customer_360` role-shaped, SEC-29 predicate for `customer_%`, loyalty tables and hooks, `loyalty_redeem` adjustment kind, tier promotions on goods, clawback in `refund`.
- **4 shop + receipts** (5–6 weeks): `ingredient_kind` + `movement_type` enum migrations, shop categories without kitchen tickets, `retail_variants`, `suppliers`, receipt tables + private bucket + signed upload URL, phone camera page, `receipt-parse` edge function on the existing meter, `pg_trgm` matching, `confirm_receipt` with an idempotent `receive_delivery`.
- **5 coaching** (4–5 weeks): `reservation_kind` + `lesson`, coach tables, generic `event_participants`, `lock_coach`, settlements, phone-app coach mode, lessons masked in `court_availability`.
- **6 matches → tournaments** (8–9 weeks): matches on `event_participants`, `lock_match`, definer read RPCs, seat money into `court_fee_paid`, tournament scheduling modules in `packages/core`, atomic multi-court block, entries and standings, reports.

### Done so far, as a share of the programme

| Measure | Value |
| --- | --- |
| Milestone 0 (criticals) | about 65 % |
| The nine Phase 2 scope items, delivered to the client | 0 % |
| Whole programme by effort (38 agent-weeks mid-estimate; M0 two-thirds done + Qi design) | about 6 % |

---

## Context

Phase 1 (signed SOW in `docs/scope/`) is a padel venue + cafe system for Touch Padel, Iraq: guest mobile app (Expo, padel booking only), public website (Next.js, the whole cafe QR ordering experience), Windows operator app (Electron: till, desk calendar, KDS, stock, admin), one Supabase Postgres with RLS. Bilingual EN/AR, full RTL, integer IQD, desk payment only, degraded mode. Build window 2026-08-24 to 2026-09-20; review/handover to 2026-10-04.

The client now wants ten more things. Items 1 to 8 are, word for word, the SOW's own "OUT OF SCOPE, LATER PHASES" list (SOW L140-154). Items 9 and 10 are new AI features. This is not an extension; it is a second product larger than Phase 1, and the SOW's change-control clause (L956-963) says it must be written up with fee and dates before work begins. Parsa has confirmed nothing is signed yet and wants it presented as milestones, each accepted and paid.

This file has five parts: **A** the repo as it is (strengths, issues, delivered-vs-promised, rules); **B** what must happen before Phase 2 starts; **C** the ten scope items, how each is built, and the milestone plan; **C+** the performance baseline and benchmark; **D** the decision record and what is still open.

---

## Part A: the repo today

### A1. Shape

| Path | What | Size |
| --- | --- | --- |
| `packages/db` | 106 migrations (0001 to 0107; 0023 and 0101 unused), 286 `app.*` definer functions, 12 edge functions, 56 test files, 8 CI gate scripts, seed/fixtures/client-data tiers | 36k LOC |
| `packages/core` | money (integer IQD, largest-remainder splits), idempotency, time (two-window trading nights), pricing twin, analytics modules, mutation schemas | 10k LOC |
| `packages/ui` | tokens (palette, typography, cafe brand, operator, operatorBlue), Lama Sans fonts, `themeCss` generator. No components. No test script | 1.3k LOC |
| `packages/i18n` | ~4,950 keys per locale, EN/AR at exact parity, enforced at compile time and at runtime including placeholder sets | 12.8k LOC |
| `packages/config` | shared ESLint preset incl. the RTL logical-properties guard, consumed by all 8 packages | 200 LOC |
| `apps/web` | Next 16 App Router on Vercel. Root is the Touch Cafe guest app. Four browser RPCs total. Arabic default | 12.7k LOC |
| `apps/operator` | Vite + React 19 + TanStack Router SPA. Five workspaces (courtDesk, cashier, prep, manager, owner). Till, desk, KDS, stock, admin, analytics, reports, ops, marketing, breaks, 3D floor (gated) | 85k LOC |
| `apps/operator-shell` | Electron 33 main/preload: fsynced SQLite queue, sync worker, LAN KDS over PSK websocket, ESC/POS raster printing, auto-update, kiosk, IPC validation | 7.8k LOC |
| `apps/mobile` | Expo SDK 57, expo-router. Phone + password sign-in (email removed 09-15), Apple, Google. hold_slot → confirm_booking → release/cancel. Push wired. Account deletion with Apple revoke | 38.6k LOC |
| `e2e` | Playwright, 8 specs, 48 tests, EN + AR | 2.5k LOC |

Contributors: Parsa 189 commits, Sait 144, Majed 120, Kemal 94, Ameen 16. Since 09-15 nearly all commits are Majed/Sait/Kemal on `two`.

### A2. What is genuinely well done

Verified properties, not compliments.

**Backend**

- 286/286 SECURITY DEFINER functions pin `search_path`; a CI invariant locks it.
- RLS on all 57 public tables and the 5 `app`-schema tables; policies are select-only; the only client-writable columns in the system are four on `profiles`. Append-only tables get absent grants plus a `forbid_mutation` trigger.
- Every business write is an `app.*` RPC. `anon` reaches 14 functions, 13 reads; the one write needs a verified HMAC table token.
- Booking path: role guard → caller-scoped idempotency → cheap rejects → `app.lock_court` advisory lock → lazy hold expiry → `price_slot` → insert under the GiST exclusion constraint → audit. Cross-court moves lock in `least/greatest` order and raise a retryable `40001` if the row moved. Three independent idempotency layers (unique columns, `app.rpc_replays` claim rows, `sync_replays`).
- Money: two domains only (`iqd`, `iqd_signed`), no numeric or float anywhere on money; SQL/TS twins are bit-for-bit (`apply_pct_discount`). `compute_tab_totals` does per-tax-group, post-discount, pro-rata, tax-inclusive correctly.
- CI gates that exist because a specific bug shipped: lock-order walker over `pg_proc` statement by statement; `safeupdate` detector; RPC registry that ratchets coverage (157/160); migration-order gate with non-waivable version findings; broadcast and analytics payload gates; quiet-error gate; secrets scanned in built bundles.
- Migration discipline: `NOT VALID` then `VALIDATE`, idempotent constraint guards, lock/statement timeouts, pre-flight queries that name offending rows, explicit drop-by-signature and re-grant after a signature change. The post-mortems in 0042, 0048, 0049, 0071, 0089, 0106 are exemplary.
- Edge functions declare `verify_jwt` per function with reasons; the two `false` ones carry real crypto (constant-time secret compare; Standard-Webhooks HMAC with timestamp tolerance, fail-closed). Account-creating functions roll back the auth user on RPC failure. LLM spend is capped and the cap counts failures.

**Frontends**

- Operator authz: default-deny longest-prefix `ROUTE_ROLES`, a capability matrix, `permissionsFor(role)`, and a three-state role resolver (`active | revoked | unknown`) where `unknown` is a no-op so a wifi blip cannot evict a trading cashier and `revoked` tears down Realtime channels.
- The single write path is real: 85 `mutate()` call sites, one `touch.enqueue` seam, fsync before the IPC promise resolves, strict-sequence worker, `inflight` re-send on boot, encrypted payloads, offline PIN cache that fails closed.
- Web: table-token cookie exchange implemented twice on purpose (proxy and page), nonce CSP with strict-dynamic, one private realtime channel per session, honest `MenuStatus` union so a failed read is never a blank menu, PostHog with no autocapture/recording/identify and a kill switch.
- Mobile: per-intent idempotency keys, release-on-unmount for holds, `isTransportError` as the only path to "no connection" copy, SecureStore chunking, cache persisted to AsyncStorage, trading-night grid, native tabs per platform, Google SDK isolated behind one file with a test that fails if a second importer appears.
- Shared: i18n parity enforced twice; RTL guard self-tested and its own past failure documented inside the rule; code-splitting where it matters.

**Ops**

- `ci.yml`: gitleaks over full history, env-name and data-hygiene gates, dependency audit with expiring waivers, Electron ABI proof on Windows, Expo bundle check, clean local Supabase run with RLS/lock/concurrency tests, e2e in EN and AR.
- Operator release pipeline works end to end (draft release → builders → publish; ABI proof; `ws` bundled). 13 tags, latest `operator-v0.2.13`.
- Comments record decisions, measurements and dates rather than restating code.

### A3. Issues, ranked

Each has file evidence; `NNNN:line` refers to `packages/db/supabase/migrations/…` unless another root is given.

#### Security

| # | Issue | Evidence | Fix shape |
| --- | --- | --- | --- |
| S1 | **Dev seed staff accounts with a repo-committed shared password are live on the hosted project** (Parsa confirmed 09-19). Owner access = every guest's name and phone, refunds, minting hidden owners. Pre-0078 short PINs still verify. | `seed.sql:5-12,109-165`; `tests/helpers.ts:20`; `scripts/create-operator-owner.mjs:24-25` | Owner-run: deactivate the five `@dev.touch.local` staff (0081 deactivation revokes refresh tokens; a password reset alone does not), create the real owner, rotate all PINs, repoint `telegram_staff`. Report-only verify query first. |
| S2 | **Replay writes raw manager PINs into a manager-readable table.** Adjustment payloads carry `pin` by design; replay records the whole payload into `sync_replays.conflict_detail` on every failed attempt. | `functions/replay/index.ts:396-402,423-429`; `0021:319,325` | Strip `pin` before `record()`; migration to purge existing rows. |
| S3 | **PIN lockout never engages through money RPCs.** `verify_manager_pin` records the attempt and returns null; callers raise, which rolls the `pin_attempts` row back. Six-digit PIN brute-forceable from any cashier session, no audit row. | `0086:192`; `0049:154-156`; `0044:201-203`; `0032:621-623` | Return a typed failure instead of raising, or commit the attempt in a separate call. Migration. |
| S4 | **Till release pipeline has no gate.** Any `operator-v*` tag ships an unsigned build that auto-installs on every till in 6 h, published with Parsa's gh token carrying `admin:org`. Unchanged since 09-07; four releases since the finding. | `.github/workflows/operator-release.yml` (no `environment:`); `docs/client/operator-download-2026-09-05.md:28` | `environment: release` with required reviewer; fine-grained PAT scoped to the releases repo; tag ruleset; CODEOWNERS on the workflow. |
| S5 | **`app.log_replay` is client-callable and can poison the replay dedupe ledger.** Granted to `authenticated`, zero production callers (two tests), inserts arbitrary `idempotency_key` rows that replay then treats as "already handled". | `0021:155,343`; `functions/replay/index.ts:288-296` | Revoke from `authenticated`; tests call it as service role. |
| S6 | **Mobile deep link accepts raw tokens (login CSRF)** and **reset-password sets a password for any signed-in session.** | `apps/mobile/src/features/auth/deepLink.ts:81-85`; `app/reset-password.tsx:43` | Delete the tokens branch; render the reset form only after a recovery `exchangeCodeForSession` in this app session; enable "Secure password change". Before any store build. |
| S7 | **Guest-writable `profiles` columns have no length or format CHECK.** Multi-megabyte names render in desk search, Telegram and push; the 0059 phone-required guard is satisfied by `x`; `expo_push_token` is guest-writable. | `0004:8-15,161`; `0080:69-77` | CHECK constraints (`full_name` 1..80, `phone` canonical via `app.phone_canon`), or replace the column grant with an RPC. |
| S8 | **Web CSP is skipped on paths the proxy matcher excludes** (`/api/t`, `/x.y/t` render the table page with no CSP). Stale Google Fonts allowances in CSP. | `apps/web/proxy.ts:157`; `src/lib/security/headers.ts:152-153` | `dynamicParams = false`; matcher excludes only real static paths; drop the fonts origins. |
| S9 | **`db-migrate.yml` dumps the `app` schema** (table-token secret fallback, `sms_sends` phone numbers, `pin_attempts`) to a 30-day artifact. Four production workflows run an unpinned Supabase CLI with the DB password; five have no `permissions:`. | `.github/workflows/db-migrate.yml:159-161`; `functions-deploy.yml:41`; `db-ops.yml:49`; `db-drift.yml:48` | Point the dump at public ledger tables; pin the CLI; add `permissions: contents: read`. Delete existing artifacts (owner). |
| S10 | **`config.toml` carries a committed test-OTP pair** and was `config push`ed once; the activation doc tells the owner to reuse it on hosted. | `packages/db/supabase/config.toml:108-111`; `docs/client/phone-otp-activation.md:67` | Env-substitute the pair; never config-push to the live ref; uncommitted reviewer pair. |
| S11 | `sms_limits.allowed_prefixes` on hosted is `'{""}'` (empty prefix matches every number), per commit `74372b7`. SMS provider `log` fallback logs full numbers and codes when `SUPABASE_ENV` is unset. | `functions/_shared/sms/index.ts:47-55`; `log.ts:16` | Set the Iraq prefix on hosted; fail closed on a misconfigured provider. |
| S12 | Till: guest names/phones in plaintext in `queue.db` `ref_cache`; renderer persists the staff session in localStorage; no CSP or permission handler in the renderer; Quit-to-desktop takes no PIN (deliberate, undecided). | `apps/operator-shell/src/main/queue.ts:424-427`; `apps/operator/src/lib/supabase.ts:47`; `index.html` | Patch 2 items. Decision needed on Quit. |
| S13 | Registry mislabels: `heartbeat` and `log_replay` listed `publicByDesign` but role-guarded; the allowlist exists in two places that already differ. `app.expire_stale_holds` callable by any guest (resource use only). | `fixtures/rpc-allowlist.json`; `scripts/check-rpc-authz.mjs:38-65`; `0008:698-699` | Reconcile to one source. |
| S14 | Three commits carry a Claude co-author trailer (Kemal, 09-07: `4666bd2`, `9a8bba5`, `22ce202`). Report only per `CLAUDE.md`. | `git log` | Owner decides. |

#### Correctness

| # | Issue | Evidence | Fix shape |
| --- | --- | --- | --- |
| C1 | **Replay + sync worker silently lose a till mutation on any transient error.** Any non-exclusion RPC error is recorded as a permanent `sync_replays` conflict row and returned as 500; the worker retries; the retry finds the row and returns 200 `duplicate`; the worker acks. A `40001`, `55P03`, `57014` or pool exhaustion on a queued settle or discount is lost money reported as done. | `functions/replay/index.ts:288-296,421-436`; `functions/_shared/http.ts:34-36,76`; `apps/operator-shell/src/main/sync-worker.ts:142-145,156` | Replay: classify retryable vs terminal before recording, never record retryables. Worker: never ack a `prior_result: 'conflict'`. Test both. |
| C2 | **Degraded mode is a global kill switch with no in-product off switch.** One `device_heartbeats` row keyed by a client-supplied id; `is_till` sticky; `TILL%` name makes a till; no RPC retires a row; `heartbeat_stale_seconds` and `protected_horizon_hours` are not writable. Fired against production three times in dev. | `0107:53-63`; `0021:56-68`; `0104:25-26,62` | Owner-gated `app.retire_device(device_id)`; thresholds in settings; a screen. |
| C3 | **Till money ops bypass the durable queue and lack idempotency:** `refund` (no key parameter at all), `merge_tabs`, `settle_zero_tab`, `cancel_tab`, `record_drawer_open`, `void_after_send`, `open_day`/`close_day`. `stock.waste` is a wired queue type with zero callers; the waste screen calls `record_waste` direct without key or device id. | `apps/operator/src/features/till/ManagerActions.tsx:94,356`; `AddCafeBillDialog.tsx:110`; `ChargeToBookingDialog.tsx:74`; `CourtBillPanel.tsx:155-156`; `features/stock/WasteAndProduction.tsx:77`; `types.gen.ts:831+` | Decide which ops may be online-only, write it in the scope ledger; register the rest as mutation types; add `p_idempotency_key` to `refund`. |
| C4 | **The two halves of the write path are mirrored by comments, not a test.** `DIRECT_RPC` in the operator claims to mirror `MUTATION_RPCS` in replay; replay's map is not exported and no test compares them. Browser mode is where all tests run; Electron is where money flows. | `apps/operator/src/lib/mutate.ts:48-50`; `functions/replay/index.ts:41`; `mutate.test.ts:18` | Export the map; fixture-payload parity test. |
| C5 | **Quote ≠ charge on the guest path.** `hold_slot` returns a price but stores neither `price_iqd` nor `rate_rule_id`; `confirm_booking` re-resolves. No `PRICE_CHANGED`. | `0048:344-353`; `0092:545-563` | Stamp the quote on the hold; confirm compares and raises `PRICE_CHANGED`. |
| C6 | `price_slot` prices from `start_at` only (a slot straddling a rate boundary bills the start rate); nothing snaps `start_at` to a grid server-side. | `0007:47-66`; `packages/core/src/pricing/rateRules.ts:87-100` | Decide the semantic; enforce grid alignment in `assert_bookable`. |
| C7 | `packages/core/money/tax.ts` no longer describes the server (single-rate, pre-discount); unused today. `price_slot` keeps a dead overnight-wrapping branch. `hold_ttl_seconds` has no table CHECK. | `tax.ts`; `0007:60-61`; `0104:62` | Delete or align. |
| C8 | Padel revenue in reports is booked, not collected; 0106 surfaces the gap only as a day-close warning. | `0068:22-24`; `0106:67` | Named "uncollected" line. |
| C9 | Migration ordinal collisions (`0069` ×2, `0071` ×2) and a file whose header calls itself `0058`; the gate checks versions, not ordinals. This class caused the six-day hosted stall. | `check-migrations.mjs:146-215`; `20260903000060_release_hold.sql` | Two gate rules. |
| C10 | Web `useCafeActions` callbacks are recreated every render (dependency on a fresh object literal), defeating the memoisation they exist for; the channel hook works around it with a ref. | `apps/web/src/components/cafe/CafeApp.tsx:108`; `useCafeActions.ts:53,61,179,200,216` | Memoise the deps object. |
| C11 | **The guest menu root is dynamic, not ISR.** `page.tsx` declares `revalidate = 60` and forbids reading headers; the locale layout reads `headers()` for the CSP nonce, so the whole `[locale]` tree renders per request. Measured live: `X-Vercel-Cache: MISS`, `no-store`, TTFB ~0.4 s. | `apps/web/app/[locale]/page.tsx:10-12`; `app/[locale]/layout.tsx:89` | Hash-based CSP for the static menu with the nonce layout only under `/t`, or accept dynamic and rewrite the comment. See C+. |

#### Contract and operations

| # | Issue | Evidence |
| --- | --- | --- |
| O1 | **Hosted is probably 17 migrations behind** (last recorded 89/89 on 09-12; local head 0107). Operator 0.2.11 to 0.2.13 call `start_break`/`end_break` (0105) and read `staff_breaks`. Third recurrence. Parsa: "not sure". | `docs/client/hosted-catchup-2026-09-12.md:61-66`; `apps/operator/src/features/breaks/BreakProvider.tsx:85,94` |
| O2 | **Guest email sign-in was removed on 2026-09-15**; the SOW M1 acceptance names email sign-up/verify/reset and excludes phone OTP. No change-control record. Parsa's decision 09-19: restore email next to phone. | `apps/mobile/app/sign-in.tsx:30`; `src/features/auth/api.ts:44,80` |
| O3 | Store submission: every ASC build is 0.1.0; no Play record. Deferred by agreement (Parsa 09-19). | `docs/store/app-store-submission.md:10-11` |
| O4 | Promised, not delivered: two environments (one project, named "staging", is production); error tracking and uptime monitoring (seams only, no Sentry anywhere); PITR (declined, unacknowledged in writing); Arabic runbook, staff guide, recorded training; the domain (`touch-padel.com` parked, unanswered); the 16-step disconnection drill; a physical print on a printer whose model is unknown and for which only Ethernet transport exists; the "written role test" artefact; the W4 load test at twice peak. | `db-migrate.yml:31,55,195`; `apps/mobile/src/lib/telemetry.ts:11-13`; `HANDOFF.md:1612-1618,1629`; `docs/drill-runbook.md` |
| O5 | Client inputs still missing: rate rules (every real-court booking fails `NO_RATE`), menu, recipes/ingredients (M5 acceptance impossible), staff list, floor numbering (no QR cards), printer model, brand files and font licences, phone number (`00995…` reads as Georgia), closed-date confirmations. Chase doc is dated 08-30. | `docs/client/07-outstanding-2026-08-30.md` |
| O6 | Built but contractually excluded, mostly unrecorded: analytics panel + AI insights, reports, marketing campaigns, promotions, series bookings, staff breaks (widened PINs to every role), Telegram, social sign-in, phone OTP, 3D floor (gated `HELD_FOR_PHASE_2`), blue mode/kiosk. About a third of the last two weeks. | `0067`, `0072-0073`, `0092`, `0105`; `apps/operator/src/features/{analytics,reports,marketing,breaks,floor}` |
| O7 | Handover: Expo project on Parsa's personal account, Google Cloud on `parsaxavier@gmail.com`, Vercel/PostHog/GitHub under Kagu identities; SOW L1001 requires Touch to hold every account at acceptance. Supabase CLI on the dev machine logged in as the wrong account. | `apps/mobile/app.config.ts:171`; `API.md` §8 |
| O8 | `HANDOFF.md` lists as open five booking criticals that are fixed (0048, 0071), says `check:locks` cannot see advisory locks (it can), says `compute_tab_totals` lacks the court fee (fixed 0053/0106), and gives two contradictory hosted states. Last dated entry Day 25 (09-13). | `HANDOFF.md:1731-1752,1636,2010,2013` |
| O9 | Stale Dependabot branches; `packages/db/1h,` zero-byte artifact; stale untracked root `eas.json`; `eas.json` staging profile still placeholders; Electron 33 waivers expire 2026-10-15. | `git branch -a`; `.security/audit-waivers.json` |

#### Code quality

| # | Issue | Evidence |
| --- | --- | --- |
| Q1 | **Zero component tests on web (56 `.tsx`) and mobile (53 `.tsx`)**; mobile has zero `testID`s. The operator solved this on 08-28 (`environmentMatchGlobs` jsdom); never carried over. | `apps/web/vitest.config.ts`; `apps/mobile/vitest.config.ts` |
| Q2 | Operator `__root.tsx` is 1,903 LOC, untested, touched by every recent commit; 17 other screens over 440 LOC with no sibling test (~11k LOC incl. desk calendar and day close). | `apps/operator/src/routes/__root.tsx` |
| Q3 | Two overlapping component libraries (`kit.tsx` 1,994 + `ui.tsx` 976) with duplicated PIN prompts, reason prompts and segmented controls. | `components/ui.tsx:650,669,820`; `components/kit.tsx:1494,1552,1797` |
| Q4 | Query-key registry covers 5 of ~40 keys; `['reservations']` + `['reservationsMonth']` hand-invalidated as a pair in 9 places. Four inline role comparisons remain against the matrix's own rule. | `lib/queries.ts:39-50`; `__root.tsx:636,1078`; `features/breaks/BreakRailControl.tsx:33`; `features/till/tillData.ts:350` |
| Q5 | ~5,000 LOC of three.js (mobile `Court3D` 1,421 + `courtTransition` 3,539; operator `floorScene` 924 + `rally` 673) on two `three` versions (0.160 vs 0.184), conceptually forked. Mobile Hermes bundles are 7 MB per platform. | `apps/mobile/src/components/Court3D.tsx`; `apps/operator/src/features/floor/` |
| Q6 | 2,238 inline `style={{}}` objects in the operator; `packages/ui` has no test script so token drift is caught by nothing (and the palette has already drifted once per `docs/DESIGN.md`); dead `operatorChartColors`; 50 `as unknown as` in the operator. | `packages/ui/src/tokens/operator.ts:288` |
| Q7 | Function-definition sprawl: `mark_reservation` in 6 migrations, `verify_manager_pin` in 7; "latest body" requires ordering files. `seed.sql` mirrors 0056 by comment only. | migrations |
| Q8 | `apps/web/CLAUDE.md` is one line (`@AGENTS.md`) pointing at Next's auto-generated file; root `CLAUDE.md` claims it holds Next rules. | `apps/web/CLAUDE.md` |

### A4. Delivered vs promised (compact)

| SOW module | Status | Gaps that block the module's acceptance test |
| --- | --- | --- |
| M1 Foundations | partial | Email sign-in removed (restoring); no two environments; no error tracking/uptime; PITR declined unacknowledged; written role test not produced |
| M2 Padel reservation | partial | Rate rules empty (`NO_RATE`); "Touch has taken real bookings" not true; push unproven on device; quote≠charge (C5) |
| M3 Cafe guest | partial | Optional sign-in at checkout never built (now pulled into the loyalty milestone); QR cards cannot print (domain + floor numbering) |
| M4 Cashier & dispatch | partial | PIN lockout defect (S3); physical print never run; printer model unknown; "full trading day" not run |
| M5 Stock & recipes | partial | Code complete incl. FEFO and e2e acceptance; data empty so the variance reconciliation is impossible |
| M6 Website | partial | Not on Touch's domain; no error tracking; official logo not in build; font licence unreconciled; root not actually cached (C11) |
| M7 Degraded mode | partial | Code complete; drill never run on hardware; venue phone wrong; no retire-device (C2) |
| D1 Mobile store | not done | Deferred by agreement |
| D2 Operator installer | done | Unsigned; pipeline ungated (S4) |
| D5/D6 Handover | not done | Accounts on personal identities; English-only runbooks; no training |

### A5. Rules every change must obey (gate-enforced)

- **Migrations**: version strictly greater than every file on `main` (next ordinal `0119` as of 2026-09-20; `0069` and `0071` are already doubled and `0023`/`0040`/`0101` are holes, never reuse or fill; `check-migrations.mjs` now enforces both); `set lock_timeout='3s'; set statement_timeout='60s'`; `NOT VALID` then separate `VALIDATE` inside an idempotent `pg_constraint` guard; new index → own migration or `MIGRATION-RISK-ACCEPTED`; re-issuing a function → copy the latest body verbatim (`grep -l "function app.<name>" *.sql | tail -1`); signature change → `drop function` by exact signature, recreate, re-issue `revoke … from public, anon` + `grant execute … to authenticated`.
- **Tables**: `iqd`/`iqd_signed` for money; `_en`/`_ar` for guest-visible text; `enable row level security` (by hand for `app` schema); select-only policies; guest-writable text gets a sanitiser trigger plus a length CHECK.
- **RPCs**: SECURITY DEFINER, `search_path`, revoke/grant, dollar tag `$name_0NNN$`, guard as first statement, `P0001` machine codes with `MAPPED_CODES` entries on the client, no WHERE-less writes, `app.lock_court` before any reservation write, lock order `day_sessions → tabs → orders → order_items → tickets → payments → refunds → stock_batches → court_advisory → reservations`, registry entry with ≥10-char reason + `rls-matrix.ts` rule (ratchet 157/160), `app.claim_replay` for non-idempotent money writes.
- **Offline mutation**: `MUTATION_TYPES` (core) + `DIRECT_RPC` (operator) + `MUTATION_RPCS` (replay) + `ipc-validate` + `queueResults` + `dayCloseLogic`. No secrets in payloads.
- **Operator**: `ROUTE_ROLES` default-deny + `SUB_ROUTES` + `WORKSPACES` rail; never `staff.role ===`; `QK` registry for shared keys; lane i18n catalogs under `catalogs/ws/`; `var(--tp-*)` with a blue-mode answer; `.test.tsx` under jsdom; grep `kit.tsx` and `ui.tsx` before adding a primitive.
- **Web**: `app/[locale]/…`; `appRpc` + `RPC_ERROR_KEYS`; one realtime channel; `*.css.ts` logical-only; SSR status unions.
- **Mobile**: key families; per-intent idempotency keys; `isTransportError`; native-feel rule; node-only pure tests; env in `app.config.ts` + all three `eas.json` profiles.
- **Deploy**: migrations to hosted before any client build; `supabase`/`eas`/`expo` never from the repo root; regenerate `types.gen.ts` in the same commit; both i18n catalogs in the same commit.
- **LLM code** (new in Phase 2): official `@anthropic-ai/sdk` in the Deno edge functions, model `claude-opus-5` unless Parsa names another, spend metered in `llm_usage`, the model never computes a number the page did not already have, no guest identity in any prompt (SEC-29).

---

## Part B: before Phase 2 starts (the criticals pass)

Ordered. Items marked **owner** need Parsa's credentials or dashboard; the rest are code.

1. **owner** Verify hosted: `cd packages/db && npx supabase login && npx supabase migration list --linked`. If pending, `db push` from the same folder. Never accept the CLI's `migration repair --status reverted` offer. (O1)
2. **owner** Rotate S1: report-only query listing `@dev.touch.local` staff and their `is_active`; deactivate via `staff-admin` (revokes tokens), create the real owner, reset every PIN, repoint `telegram_staff`, delete the `create-operator-owner.mjs` default credentials. Outside service hours.
3. Replay path PR: C1 (retryable vs terminal + worker never acks a prior conflict), S2 (strip `pin`; purge migration), S5 (revoke `log_replay`), C4 (export `MUTATION_RPCS`, parity test).
4. S3 PIN lockout migration (typed failure, weak-PIN reject at verify).
5. S4 release gate + **owner** token swap and tag ruleset; then cut `operator-v0.2.14` with the LAN KDS hardening from the 09-13 audit (per-socket `error` listener, `maxPayload`).
6. Mobile S6 (deep link, reset-password) + restore guest email sign-up/sign-in/verify/reset next to phone (O2). Email guests must still pass `PHONE_REQUIRED` at confirm via complete-profile.
7. C2 `retire_device` + thresholds in settings + owner screen.
8. S7 profile CHECKs; S8 web CSP; S9 workflow hygiene (**owner** deletes existing artifacts); S10/S11 OTP config.
9. C3 decision and registration of the online-only ops; `WasteAndProduction` → `mutate('stock.waste')`; `refund` gains a key.
10. Reconcile `HANDOFF.md` against A3/O8, add days 26 to 31, fix the file map. Reconcile the RPC allowlist to one source (S13). Add the two ordinal gate rules (C9).
11. Test foundations Phase 2 depends on: jsdom + one smoke render per screen for web and mobile, `testID`s on mobile (Q1); the benchmark suite baseline (C+).
12. Change-control paperwork for Phase 1 deviations (email/phone auth, PITR, analytics additions) so Phase 2 does not start on an unsettled Phase 1.

Rough size: 3 weeks of Parsa + agents, with owner actions interleaved.

---

## Part C: the ten new items, how each is built, and the milestone plan

Each item: what the SOW said, what exists, decisions (resolved ones are stated as facts), data model, backend, surfaces, security, dependencies, rough size. Sizes are agent-weeks with Parsa reviewing; order of magnitude, not a quote.

### C0. Multi-venue (item 8): the architecture milestone, first

**Decided (Parsa, 09-19):** a real second branch with shared guests; one owner over all branches, managers per branch, one stock location per branch. So: model V, one Supabase project, `venue_id` everywhere; no `stock_locations`.

**Why first.** There is no `venue_id`, `location_id` or `branch_id` anywhere in 106 migrations. `venue_settings` is a boolean-PK singleton. `staff.role` is venue-less. Degraded mode, heartbeats, day sessions, opening hours, rate rules, tables, KDS topics, stock ledger and every RPC assume one venue. Every other item needs to know which venue a row belongs to; building them first and retrofitting would mean touching them all twice.

**Data model.** `venues` (id, name `_en/_ar`, timezone, phone, address, is_active). `venue_id not null references venues` on every venue-scoped table (courts, rate_rules, reservations and series, cafe_tables, guest_sessions, day_sessions, tabs, orders, tickets, waiter_calls, payments, refunds, ingredients, recipe_lines, deliveries, stock_batches, stock_movements, stock_counts, manager_alerts, device_heartbeats, degraded_periods, staff_breaks, station_staff, telegram_chats, analytics tables, marketing sends; roughly 45 tables). `venue_settings` becomes one row per venue (PK → `venue_id`). `staff_venues(staff_id, venue_id, role)` replaces the single `staff.role` for managers and below; the owner role stays global. Global (no venue): `profiles`, `staff` identity, `promotions` (optionally scoped by rule), loyalty, Customer 360, `audit_log` (carries `venue_id` as a column), `telegram_staff`.

**Backend.** `app.current_venue()` derived from the station (`station_staff`) for operator sessions and from the table token or the chosen court for guest paths; never from a bare client argument on guest writes. `app.is_staff(role...)` gains a venue-aware overload `app.is_staff_at(venue, roles...)`. RLS predicates on staff reads add `venue_id = any(app.staff_venue_ids())`. Every scoped RPC re-issued family by family (booking, cafe, stock, staff, telegram, analytics, reports) copying the latest body verbatim, dropping by signature, re-granting. Degraded mode, heartbeat, `is_degraded(venue)`, day close and opening hours become per venue. Backfill: everything existing gets the first venue's id under `NOT VALID` → `VALIDATE`; composite indexes `(venue_id, …)` on every hot query.

**Surfaces.** Operator: venue bound at station setup; owner gets a venue switcher in the rail; management screens show a venue filter; analytics and reports gain a venue axis and a consolidated "all venues" view for the owner. Mobile: venue picker before the court grid (remembered), per-venue hours, rates and phone in degraded copy. Web: the table token carries the table, which carries the venue; venue name on the page.

**Gates.** `rls-matrix.ts` gets a venue axis (staff at venue A must not read venue B); `check:authz` probes cross-venue; e2e two-venue fixture; the benchmark suite re-run (C+).

**Size.** 5 to 6 weeks. Push to hosted rehearsed first against a restored daily backup (there is no PITR).

### C1. Online payment (item 1)

**Decided:** first milestone is court bookings only; provider not chosen (client owns onboarding, starts in parallel); deposit/refund/no-show policy is the client's decision, so all three are modelled as venue settings with "full amount, refundable outside the cancellation window" as the default.

**Exists:** `payments` is tab-scoped, desk-only; `refunds` reverse stock; `tabs.reservation_id`; 0106 desk payment. No intents, no webhooks, no provider secrets.

**Data model.** `payment_intents` (venue, kind enum booking/seat/tournament/lesson, subject id, amount `iqd`, provider text, provider_ref, status enum created/pending/succeeded/failed/refunded/expired, idempotency_key, guest id, created_at, expires_at), `payment_events` append-only (intent, provider payload, signature verdict, received_at), `online_refunds`. `reservations` gains `payment_status` (unpaid/pending/paid/refunded) and `paid_iqd`. `payments` gains `method = 'online'` and `intent_id` so day close and reports see one ledger. Venue settings: `online_pay_mode` (off/optional/required), `deposit_pct`, `refund_inside_window`, `no_show_charge`.

**Backend.** `create_payment_intent` (guest; guard first; re-prices under `lock_court`; refuses if degraded; idempotent). Edge function `payments-webhook` (`verify_jwt=false`; per-provider adapter module in `_shared/payments/<provider>.ts` with HMAC verify, constant-time, fail-closed; idempotent on provider_ref; calls `app.settle_payment_intent` as service role, which flips the reservation to confirmed-paid under `lock_court` and writes a `payments` row). `expire_payment_intents` cron. `refund_online` behind manager PIN reusing the refund path. A paid booking is protected from `mark_reservation` resale (extends the 0089 temporal guard).

**Surfaces.** Mobile: pay step between review and success, pending state polling the intent, receipt in booking detail, refund status. Operator: intent status on the booking, "online" column at day close, refund action. Web: none.

**Security.** Webhook secret in function secrets; replay protection on provider events; amount never trusted from the client; `payment_events` in no view or broadcast; hosted provider pages only so card data never touches the system.

**Depends on.** C0; Part B item 3 (replay) if the desk records online payments offline. **Size.** 3 to 4 weeks plus provider lead time.

### C2. Coaching, courses, coach schedules, commission settlement (item 2)

**Decided:** coach surface (operator role vs phone view) not decided; data model is surface-neutral; commission basis, settlement period and lesson types are open (D-Q9, D-Q10).

**Exists:** `staff_role` has no coach; `reservation_kind` is booking/hold/maintenance; rate rules per court; staff breaks give a per-person availability shape; `series` (0092) gives recurring-slot machinery for courses.

**Data model.** `coaches` (venue list, linked `staff.id` or `profiles.id`, bio `_en/_ar`, photo, is_active), `coach_availability` (weekly windows + dated exceptions), `lesson_types` (kind private/group/course, duration, capacity, price `iqd`, commission rule), `lessons` (coach, court reservation FK with `kind = 'lesson'`, lesson_type, capacity, status), `lesson_enrolments` (guest, lesson, payment intent or tab line, status), `courses` (named sequence of lessons), `commission_rules` (percent/fixed/tiered, versioned), `coach_settlements` + `coach_settlement_lines` append-only (period, computed, approved_by, paid_at).

**Backend.** Second exclusion constraint on `lessons` (`coach_id with =, period with &&`) taken together with `app.lock_court`; coach lock added to the lock-order gate after `court_advisory`. RPCs: `book_lesson` (guest), `desk_create_lesson`, `enrol`, `cancel_enrolment` (policy window), `compute_settlement(period)` (deterministic; integer largest-remainder for shared group commissions; twin in `@touch/core` with parity tests), `approve_settlement`, `mark_settlement_paid`. Audit on every override.

**Surfaces.** Mobile: coaches, lesson types, availability grid per coach (reuse the trading-night grid), enrol, my lessons. Operator: coaches admin, availability editor (reuse the `OpeningHoursEditor` shape), lessons on the desk calendar as a distinct kind and colour, settlements under Financial. If coaches get logins: a sixth `coach` role and workspace (own lessons and own settlements only). If they get a phone view: a coach mode in the mobile app behind a coach flag.

**Depends on.** C0; C1 for paid lessons. **Size.** 4 to 5 weeks.

### C3. Open matches and seat splitting (item 3)

**Decided:** no player levels in v1; matches are open to anyone; join policy is host approval to compensate; seat payment online via C1 intents (`kind = 'seat'`) or at the desk per player.

**Data model.** `matches` (reservation FK, host, visibility, seats_total default 4, seat_price `iqd` by largest remainder over the reservation price, join_policy approve/open, status open/full/cancelled/played), `match_seats` (match, guest, status requested/confirmed/cancelled/no_show, payment ref, joined_at), `match_events` append-only.

**Backend.** `open_match` (host owns a confirmed reservation), `request_seat`/`approve_seat`/`leave_seat` under a per-match advisory lock, `close_match`, `expire_unfilled_matches` cron with the venue's policy (host pays the rest / cancel / venue absorbs, a venue setting), push on each transition via `notification_outbox`, public read view that never exposes phones.

**Surfaces.** Mobile: open matches list and detail, join, my matches, host controls. Operator: matches on the booking detail, desk seat payment, per-seat no-show. **Size.** 3 weeks.

### C4. Tournaments and leagues (item 4)

**Decided:** all three formats, Americano/Mexicano first, then knockout, then leagues.

**Data model.** `tournaments` (venue, format, dates, courts, fee, capacity, status), `tournament_entries` (player or pair, payment intent `kind = 'tournament'`), `tournament_rounds`, `tournament_matches` (reservation FK per scheduled match with `kind = 'tournament'`, teams, score, status), `standings` materialised per round; `leagues` as tournaments with weekly rounds and box groups.

**Backend.** Pure scheduling modules in `@touch/core` (`americano.ts`, `mexicano.ts`, `knockout.ts` with seeding and byes, `league.ts` with boxes and promotion/relegation), each with exhaustive tests before any UI. `create_tournament` reserves the court blocks atomically under the court locks (reuse `series`; refuse if any slot is taken). `register`, `generate_round`, `record_score` (desk; audit), `compute_standings`. Cancellation cascades release courts.

**Surfaces.** Mobile: browse, register, my tournaments, live standings. Operator: tournament admin, round/bracket view, score entry, court allocation on the desk calendar. Web: optional public standings page. **Size.** 5 weeks across the three formats.

### C5. Touch Shop retail and pro-shop inventory (item 5)

**Decided:** operator-side only; no guest front, no online shop, no rentals. Stock management plus selling retail on the till tab.

**Exists:** `ingredients` + `stock_batches` + `stock_movements` FEFO ledger; `deliveries`; till grid sells `menu_items`; margins screen. No `suppliers` table.

**Data model.** `products` (venue, name `_en/_ar`, brand, category, photo, is_active), `product_variants` (size/colour, sku, barcode unique per venue, price `iqd`, cost `iqd`), retail stock as `stock_movements` rows against `product_variant_id` (nullable second FK with a CHECK that exactly one of ingredient/variant is set; batches optional), `suppliers` (name, phone, aliases; shared with C9), `deliveries` extended to retail lines.

**Backend.** `upsert_product`/`upsert_variant`, `receive_retail_delivery`, `add_retail_line` to a tab (decrements at settle through the existing consumption hook), `retail_return` (manager PIN, restocks, audit), retail margin in `report_revenue` and analytics. Barcode scanner input is keyboard wedge, no driver.

**Surfaces.** Operator only: products admin, a "Shop" grid beside the cafe grid in the till, barcode field, retail views on `OnHand`, `CountScreen`, `VarianceReport` with a kind filter. **Size.** 2.5 weeks.

### C6. Loyalty points, rewards and tiers (item 6)

**Decided:** earn on spend across all domains including the cafe with sign-in at checkout. This pulls the never-built SOW M3 "optional sign-in" into this milestone: the web gets the same phone/email/Apple/Google sign-in as mobile, the anonymous guest session links to the profile on sign-in (`guest_sessions.profile_id`), and `settle_tab` earns for the linked profile. Cafe analytics stay anonymous.

**Exists:** `promotions` (0067) with scope, limits, `public_code`, redemptions; marketing audiences as live rules; anonymous cafe sessions.

**Data model.** `loyalty_accounts` (profile, tier, cached balance), `loyalty_ledger` append-only (account, delta, reason enum earn/redeem/expire/adjust, source table + id, venue, actor), `loyalty_rules` (per domain earn rate, versioned), `tiers` (thresholds over rolling 12-month spend, benefits as promotion FKs), `rewards` catalogue, `reward_redemptions`. Balance is always `sum(ledger)`; the cached column is trigger-maintained with a nightly reconciliation.

**Backend.** Earn hooks inside the same transaction as the money write at `settle_tab`, paid `confirm_booking`, lesson enrolment, match play, shop sale; idempotent on the source id. `redeem_points` as `payments.method = 'points'` with `tab_adjustments` parity; `recompute_tier` nightly; `adjust_points` (manager PIN, reason, audit). Tier benefits are promotions so the existing pricing path applies them.

**Surfaces.** Mobile: balance, tier, history, rewards. Web cafe: sign in at checkout (new auth surface on web, PKCE, session cookie scoped to the site, no service role), balance on the page. Operator: loyalty on the customer record, redeem at the till, adjustments, tier and rule admin. **Size.** 3 to 4 weeks including the web sign-in.

### C7. Customer 360 (item 7)

**Exists:** `customer_record`, `customer_search`, `customer_notes`, `customer_flags` (0065); `find_customer_by_phone`; marketing audiences; `delete_my_account` tombstone (0077); walk-ins as `guest_name`/`guest_phone` without a profile; ~130 anonymous cafe users on hosted.

**Data model.** `customer_identities` (profile ↔ phone/email/apple/google/walk-in claim, verified_at, source), `customer_metrics` materialised per customer per venue (first/last seen, bookings, cafe_iqd, shop_iqd, lessons, matches, refunds_iqd, ltv_iqd, no_shows) refreshed nightly plus incremental on settle/confirm, `customer_timeline` view over reservations, tabs, lessons, matches, loyalty, notes.

**Backend.** `claim_walkin_by_phone` as an owner-gated RPC replacing the runbook script; `customer_360(id)` role-shaped (fewer keys for lower roles, guard first); `customer_timeline(id, cursor)`; `recompute_customer_metrics`; `delete_my_account` extended to tombstone identities and metrics; SEC-29 gate extended so only aggregates reach the model.

**Surfaces.** Operator: the customer screen becomes a 360 (header, LTV tiles, timeline, notes/flags, loyalty, segments), search by any identity, owner-only top-customers report with the venue axis. **Size.** 2.5 weeks.

### C8. Multi-venue and multi-location stock (item 8)

Covered by C0. One stock location per branch (decided), so nothing beyond `venue_id` on the stock tables.

### C9. AI receipt scanning into goods-in (item 9)

**Decided:** staff photograph the receipt on a phone page opened from a QR shown on the till (one-time upload token). Provider: Claude via the official SDK. The client pays with their own API key; we ship the meter and a conservative default cap.

**Data model.** `supplier_receipts` (venue, storage path in a private `receipts` bucket with strict mime/size limits, uploaded_by, status uploaded/parsed/confirmed/rejected, model, tokens, parse json), `supplier_receipt_lines` (parsed name, qty, unit, unit_cost `iqd`, expiry if printed, matched `ingredient_id` or `product_variant_id`, confidence, confirmed), `suppliers` (shared with C5), `ingredient_aliases` (supplier wording → item, learned from confirmations), `upload_tokens` (one-time, short TTL, bound to a receipt row).

**Backend.** RPC `create_receipt_upload_token` (staff; returns the QR payload). Web page `/staff/receipt/[token]` (upload only, no auth beyond the token, expires). Edge function `receipt-parse` (service role; staff JWT or the token; `@anthropic-ai/sdk`, `claude-opus-5`, the image as a base64 image block, structured output for the lines with amounts as integers; spend recorded in `llm_usage` in a `finally`; post-model gate: every unit cost must be a number visible on the receipt or the line is flagged). `app.match_receipt_lines` (alias table → trigram on `_en/_ar` names → unmatched). `app.confirm_receipt` (creates the `deliveries` row and lines through the existing goods-in RPC so consumption, expiry and variance keep working; writes aliases; audit). Nothing enters the ledger without a human confirming. Image retention policy (90 days default).

**Surfaces.** Operator: receive screen gains "scan a receipt" → QR → review table with match dropdowns and confidence chips → confirm. Phone page: one purpose, bilingual, expires. **Size.** 2 weeks.

### C10. New AI analysis system (item 10)

**Decided:** four deliverables: (i) ask-your-data chat for the owner, (ii) forecasting, (iii) cross-domain insights over Customer 360 with owner digests on Telegram, (iv) a client-demonstrated feature Parsa will describe later (placeholder). Provider: Claude via the official SDK; the existing Groq insights function migrates. Client pays with their own key; meter and default cap shipped.

**Shape.** Numbers stay deterministic in SQL and `@touch/core`; the model selects and rewords, never computes (the current principle, kept). (i) A registry of parameterised, role-gated analytics RPCs; the model maps a question to a registry entry and parameters via tool use; the answer is rendered from real rows with the existing citation gate; conversation state per owner; rate-limited; Arabic and English. (ii) Deterministic forecasts in `@touch/core` (bookings per court and hour, covers, stock needs from recipe consumption trends) with confidence bands; the model writes the narrative only. (iii) Scopes extended from `cafe | courts` to `customers | coaching | shop | matches` as those milestones land; scheduled digests through the existing Telegram outbox. (iv) TBD.

**Backend.** `analytics-chat` edge function (owner-only, service role, `@anthropic-ai/sdk`, `claude-opus-5`, tool definitions generated from the RPC registry, `strict: true` schemas, spend in `llm_usage`), `forecasts` table refreshed nightly, `insight_digests` schedule per venue. **Surfaces.** Operator: a chat panel under the management rail, forecast cards on the courts and stock screens, digest settings. **Size.** 4 to 6 weeks, split: (ii) can start after C0, (i) after C7, (iii) last.

### Cross-cutting

- Every item adds mobile UI; the mobile app has zero component tests. Part B item 11 is a prerequisite.
- Every item adds roles or capabilities → `staff_role`/`staff_venues`, `ROUTE_ROLES`, `permissionsFor`, `rls-matrix.ts` rows, the written role test.
- Every item adds i18n keys in both catalogs and lane files.
- Every milestone's migrations reach hosted before any client build; the C0 push is rehearsed against a restored backup.
- Every money-bearing item (1, 2, 3, 4, 5, 6) is line-reviewed by Parsa and SEC.
- SEC-28 (broadcast) and SEC-29 (identity to LLM) gates extend to each new table.

### Milestone plan (each accepted and paid; each with an e2e acceptance script, a hosted push, and a written sign-off)

| # | Milestone | Contains | Depends on | Size (agent-weeks) |
| --- | --- | --- | --- | --- |
| 0 | Phase 1 close-out | Part B (+ C5) | | 3 — about two thirds done 2026-09-20 |
| 1 | Multi-venue | C0 + stations registry + settings split + assistant venue axis | 0 | 6 to 7 |
| 2 | Online payment | Qi deposit design + `venue_id` + widened `purpose` | 1; Qi credentials for go-live | 3 to 4 |
| 3 | Customers and loyalty | C7 → C6 incl. web sign-in at checkout, `tabs.customer_id` | 1 | 6 to 7 |
| 4 | Shop and receipts | C5 (hybrid) + `suppliers` → C9 | 1 | 5 to 6 |
| 5 | Coaching | C2, phone-app coach mode, generic participants | 1, 2 | 4 to 5 |
| 6 | Matches and tournaments | C3 → C4 (Americano/Mexicano, knockout, leagues) | 1, 2, 5 | 8 to 9 |

Item 10 (AI analysis, the former milestone 7) is dropped as of 2026-09-20; the built owner assistant stays gated and unbilled. Sequential total: roughly 35 to 41 agent-weeks; about 2.5 are done (revised order and sizes decided 2026-09-20, see the status section at the top).

---

## Part C+: performance baseline and benchmark

### Measured 2026-09-19 (from the dev machine, not from Iraq; read-only GETs)

| What | Result | Note |
| --- | --- | --- |
| Web `/ar`, `/en` (warm, 2 runs each) | TTFB 0.36 to 0.48 s, total 0.54 to 0.59 s, 47 KB brotli | `X-Vercel-Cache: MISS`, `Cache-Control: no-store`. The root declares ISR 60 but the locale layout reads `headers()` for the CSP nonce, forcing the whole tree dynamic (C11). Every guest scan is a server render. |
| Web `/ar/t` without cookie | 503 ms to the redirect | Proxy path. |
| Web CSS | 71,449 chars inlined in every HTML response | Fine for a one-page menu; wrong once support/privacy/download share the layout. |
| Supabase REST round trip | 245 ms cold, 18 to 19 ms warm | From this machine; latency from Iraq to the project region is unmeasured. |
| Operator `dist` | 3.0 MB; `index` 1.21 MB, analytics chunk 476 KB, till 178 KB | Built 09-16, before the three.js floor landed; `floorScene.ts` + three 0.184 are statically imported from `ObservationHome.tsx:45`. Rebuild and re-measure. |
| Web static | 1.7 MB `.next/static` | |
| Mobile Hermes bundles | 7.1 MB Android, 7.0 MB iOS | three 0.160 + `Court3D` + `courtTransition` (~5k LOC) inside the booking app. |
| Not measurable here | booking RPC latency, replay drain time, KDS broadcast latency, mobile cold start, till boot | Need the Docker stack or hardware. |

### Benchmark suite (built in Part B item 11, run nightly in CI and on demand; baseline JSON committed so a regression is a diff)

| Area | Test | Target | Why |
| --- | --- | --- | --- |
| Booking | `hold_slot` + `confirm_booking` p50/p95 at 1, 10, 50 concurrent callers on one court and across 4 courts (pgbench-style, 12-month fixture) | p95 < 150 ms per RPC; losers get `SLOT_TAKEN`, never `40P01` | The contract's #1 promise; advisory-lock cost under contention is unmeasured |
| Cafe | `create_guest_order` with 10 lines and 3 modifiers; `compute_tab_totals` on a 40-line tab | p95 < 150 ms | Runs on every send |
| Analytics | `analytics_courts_*`, `analytics_hourly`, `report_revenue` on 12 months × 2 venues | p95 < 500 ms | Grows with venues and Customer 360 |
| Replay | Drain 500 queued mutations on reconnect through `sync-worker` → `replay` | < 60 s; exactly-once by row count | SOW M7 acceptance; also the C1 lost-mutation regression |
| Realtime | Guest order → KDS ticket; LAN KDS bump → till | p95 < 2 s cloud; < 200 ms LAN | Kitchen dispatch |
| Web | Lighthouse mobile on `/ar` and `/ar/t` (4G throttle); TTFB | LCP < 2.5 s; TTFB < 200 ms at the edge | Requires fixing C11 |
| Mobile | Cold start to first grid paint (mid-range Android, warm cache); hold → confirm; bundle size | < 2 s; < 1 s; ≤ 4 MB per platform | three.js is the lever |
| Operator | Boot to sign-in on till hardware; till grid first paint; `dist` with the floor chunk lazy | < 3 s; < 500 ms; index ≤ 900 KB | Kiosk boots daily; never measured on the real machine |
| Load | Twice peak: 2 venues × (peak bookings + cafe orders + KDS) for 10 min | Error rate < 0.1 %; p95s hold | SOW W4 promise never done |
| Multi-venue | Re-run the DB timing suite after `venue_id`; every hot query has a `(venue_id, …)` composite index; RLS predicate cost | No regression > 10 % | The venue predicate lands on every staff read |
| LLM | `receipt-parse` and `analytics-chat` latency and cost per call | p95 < 15 s receipt, < 8 s chat; cost per call logged | Client pays their own key; the meter must be honest |

Tooling: `packages/db/bench/` with SQL scripts and a Node runner writing p50/p95 JSON; Lighthouse CI for web; a Playwright timing spec for the operator; a threshold on the existing Expo bundle-size CI step.

---

## Part D: decision record and what is still open

### Decided by Parsa (2026-09-19)

| Topic | Decision |
| --- | --- |
| Order of work | Close the criticals first (Part B), then Phase 2 |
| Who builds | Parsa + Claude agents, directly on `main`; Majed, Sait and Kemal pause |
| Commercial | Nothing signed yet; present as milestones, each accepted and paid |
| Hosted DB state | Unknown; Parsa runs `migration list --linked` from `packages/db` |
| Seed staff accounts | Still live on hosted; top of Part B |
| Store submission | Deferred by agreement; out of Part B |
| Guest auth | Restore email sign-up/sign-in/verify/reset next to phone OTP in the guest app |
| Multi-venue | Real second branch, shared guests; one owner over all, managers per branch, one stock location per branch → model V, one project |
| Payment | Provider not chosen; court bookings only first; deposit/refund/no-show policy is the client's, modelled as settings with full-amount default |
| AI provider | Claude via the official SDK for vision and analysis; existing Groq function migrates; client pays with their own key; meter + default cap |
| AI analysis meaning | Chat over the data, forecasting, cross-domain insights with Telegram digests, plus a client-demonstrated feature to be described later |
| Receipts | Phone page opened from a QR on the till |
| Coaches | Surface undecided; model neutral; decide at milestone 5 start |
| Player levels | None in v1 |
| Tournaments | All formats; Americano/Mexicano first |
| Shop | Operator-side stock management and till sales only; no guest front |
| Loyalty | Earn on spend across all domains including the cafe with sign-in at checkout |

| Where this document lives | Repo root as `PHASE-2-PLAN.md` (copied 2026-09-20); working copy also in ~/.claude/plans |
| Coaching commission | A milestone 5 conversation with the client; rules stay versioned in the model |

### Still open

- D-Q14b The specific AI feature the client showed (Parsa will describe).
- Payment provider name (client).
- S12 Quit-to-desktop without PIN: sign off or restore.
- C3 (A3) which till operations are allowed to be online-only.
- O4/O5 Phase 1 client inputs and acceptance demonstrations: who owns the delay record.
- Lesson kinds (private, group, course) and coach surface: milestone 5.

---

## Verification (for when building starts)

- `pnpm turbo lint typecheck test` green; `pnpm --filter @touch/db test` green including `rls-matrix` with the venue axis; `pnpm security` green; `pnpm e2e` EN + AR green with a two-venue fixture.
- `npx supabase migration list --linked` shows 0 pending before every client build.
- Replay parity test (C4) and the lost-mutation regression test (C1) exist and pass.
- The benchmark suite runs nightly with committed baselines; a milestone is not accepted if it regresses a target.
- Each milestone gets its own acceptance script in `e2e/` before it is demonstrated to Mustafa, following the Module 5 precedent.
