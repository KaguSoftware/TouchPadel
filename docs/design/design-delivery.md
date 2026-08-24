# Touch Padel Phase 1 — Delivery Sequencing & Risk Plan
**Kagu Web Studio · Build clock started 2026-08-24 (Week 1, Day 1). Build ends Sun 2026-09-20. Review/handover ends Sun 2026-10-04. Store submission deadline: Fri 2026-09-18.**

---

## 0. Track-to-team remap

The scope assumes 4 parallel tracks staffed independently. Actual team is 4 people, one part-time. Remap:

| Scope track | Owner | Notes |
|---|---|---|
| A · Platform & data | **Parsa (lead)** + AI agents | Schema, migrations, RLS, auth, realtime, degraded-mode server side, CI/CD, Electron main process (printing, SQLite queue, LAN KDS server). Runs 2–3 days ahead of everyone, permanently. |
| B · Mobile app (padel) | **FE1** | Sole owner of `apps/mobile` through week 4. Store assets + submission with Parsa. |
| C · Website (cafe guest) | **FE2 (primary)** | `apps/web` weeks 1–3, then shifts weight to operator polish in week 4. |
| D · Desktop till/desk | **FE2 (renderer UI) + Parsa (Electron shell/offline)** | Split: FE2 owns the React SPA screens (till grid, calendar, KDS, stock UI); Parsa owns everything behind the IPC boundary. This is the split that makes a 4-person team fit a 4-track plan. |
| Security (cross-cutting) | **SEC (part-time)** | Weekly gates, not a lane. See §6.3. |

**AI-agent parallelization rule:** agents are safe on anything that is (a) schema-derived and testable (CRUD screens, zod schemas, i18n extraction, seed generators, test suites, migration boilerplate) or (b) isolated behind a stable interface (ESC/POS raster encoder, receipt HTML templates, RTL audits). Agents are **not** left unsupervised on: RLS policies, the reservations exclusion constraint, the write-queue replay logic, token signing, or money arithmetic — Parsa writes or line-reviews those, SEC re-reviews.

**Money rule (fixes the currency question before it bites):** all amounts are `bigint` whole IQD (`amount_iqd`), no decimals anywhere. Bill splits: integer division, remainder assigned to the first split line deterministically; rounding of computed lines (e.g. percentage discounts) to nearest 250 IQD is a venue config (`round_cash_to`), default 250, applied only to the payable total, with the rounding delta stored on the payment row (`rounding_iqd`). `packages/core/src/money.ts` is the only file allowed to do arithmetic on money.

---

## 1. Week-by-week plan (weeks 1–6)

Dependency arrows: `→` means "blocks". The one structural constraint (per the scope) is **Parsa's schema drops block FE deep work** — mitigated by shipping the schema in three drops: **Drop 1 (Day 3): identity/auth/roles + courts + reservations. Drop 2 (Day 8): menu/orders/tabs/tickets + table tokens. Drop 3 (Day 15): stock/ledger/day-close.** FEs build against generated types + seed data from each drop.

### Week 1 · Aug 24–30 — Foundation + shells
| Person | Work | Depends on |
|---|---|---|
| Parsa | Monorepo scaffold, local Supabase, **schema Drop 1**, auth (email+verify+reset), RLS skeleton + 5 roles, CI, seed fixtures (`packages/db/seed/fixtures.ts`), EAS project, printer spec → client, client-input pack → client | — (day-level detail in §2) |
| FE1 | Expo app shell: navigation, auth screens, `packages/i18n` wiring, RTL foundation (`I18nManager`, logical styles), Touch Padel theme tokens | Drop 1 (day 3) for real auth; before that, mocked |
| FE2 | Next.js shell: locale routing (`/en`, `/ar`), RTL via CSS logical properties, `packages/ui` theme-token system (**two palettes: Touch Padel + Touch Cafe**), Vercel deploy pipeline, operator SPA scaffold (Vite) inside Electron shell Parsa provides day 4 | Drop 1 for auth wiring |
| SEC | **Gate 1 (Fri):** review auth flows, RLS skeleton, role matrix, secrets handling in CI | Drop 1 |
| AI agents | Generate zod schemas from Drop 1, i18n message catalogs (en/ar) scaffolding, seed data generator (courts, rates, menu fixtures), Playwright/Vitest harness | Drop 1 |

**End-of-week demo:** sign up, verify, sign in on all three clients; language toggle mirrors layout; roles table shown; seeded court list renders in mobile.

### Week 2 · Aug 31 – Sep 6 — Reservations end-to-end + cafe read path
| Person | Work | Depends on |
|---|---|---|
| Parsa | **Reservations hardening**: `EXCLUDE USING gist (court_id WITH =, during WITH &&)` on `reservations` (kinds: `booking/hold/block`), hold TTL expiry (pg_cron sweep + `expires_at` filter in reads), **concurrency test suite** (contractual), pricing engine in `packages/core/src/pricing.ts` with `rate_rule_id` stored per booking; **schema Drop 2**; signed table-token design (JWT, `kid` per table, rotation) + anonymous RLS policies; Realtime channel plan (postgres_changes on `orders`,`waiter_calls`,`reservations` w/ RLS; broadcast only for KDS LAN fallback later) | Drop 1 |
| FE1 | Court browsing, day availability grid with live prices, slot-hold flow (create hold → confirm → booking), realtime freed-slot updates | Drop 1 + pricing engine |
| FE2 | Web: menu rendering from live data (bilingual, sizes/modifiers/allergens), table-token binding page (`/t/[token]`); Operator: staff sign-in, role routing, **PIN overlay for sensitive actions**, desk calendar read view | Drop 2 (day 8) |
| SEC | **Gate 2 (Fri):** table-token signing scheme, anonymous RLS policies (can a guest at table 4 read table 9's orders? prove not), hold-expiry abuse (hold spam rate limit) | Token design |
| AI agents | Concurrency test cases, RTL snapshot tests, menu fixture data (40-item realistic cafe menu w/ modifiers, en+ar), calendar grid component | Drop 2 |

**Demo:** guest books on mobile → appears on desk calendar live; two simultaneous bookings on one slot → exactly one succeeds (run the test live); QR scan opens bound menu in Arabic.

### Week 3 · Sep 7–13 — Trading: till, KDS, ordering, degraded lockout
| Person | Work | Depends on |
|---|---|---|
| Parsa | **Schema Drop 3** (stock/ledger/day-close/audit-log-complete); heartbeat + server-side degraded lockout (`venue_state` table, Edge Function or `pg_cron` marks degraded, RLS policy refuses guest writes inside protected horizon); **printing pipeline v1** (HTML → `node-canvas`/offscreen BrowserWindow → PNG → ESC/POS `GS v 0` raster via `node-escpos`/serial in Electron main, Arabic test receipt on the real printer the moment it arrives); order → stock deduction trigger (recipe explosion, modifier-aware, FEFO batch pick) | Drop 2 |
| FE1 | Booking end-to-end polish, Expo Push (confirm/reminder/cancel), cancellation policy UI, guest booking list; start store listing assets | Week 2 booking flow |
| FE2 | Operator: **till** (item grid, tabs by table/court/name, modifiers, splits by item/even, charge-to-booking, discounts/voids behind PIN, change calc), **KDS screen** (ticket list, age colors, ready/complete); Web: basket → order → live status, waiter call | Drop 2/3 |
| SEC | **Gate 3 (Fri):** audit log completeness (actor/before/after/reason on discounts, voids, overrides, stock adj), PIN flow (rate limiting, hash storage, no PIN in audit payloads), degraded-lockout server-side enforcement (prove UI-only bypass fails) | Drop 3 |
| AI agents | Receipt HTML templates (en/ar), day-close report queries, waiter-call rate limiter, stock fixture recipes (measured, realistic — the **stand-in for the client's recipes**) | Drop 3 |

**Demo:** full cafe order lifecycle: web order → KDS → ready → status on guest page → settle at till → stock ledger shows deduction. Pull the network cable: app refuses a near-term booking with the venue phone number shown.

### Week 4 · Sep 14–20 — Offline queue, LAN KDS, stock UI, **SUBMIT**
| Person | Work | Depends on |
|---|---|---|
| Parsa | **Offline subsystem** (the week's centerpiece, design in §1.1 below): SQLite write queue in Electron main (`better-sqlite3`, WAL, flush-before-confirm), device-prefixed ULIDs + idempotency keys, ordered replay worker, **LAN KDS server** (WebSocket server in till's Electron main on static IP `:8433`, KDS Electron app falls back to it when Supabase Realtime heartbeat fails); load test 2× peak; backups + PITR verification on staging; **EAS submit with FE1 (target Wed Sep 16, hard stop Fri Sep 18)** | Drop 3, week-3 heartbeat |
| FE1 | Store assets, privacy policy page (on `apps/web`), app review notes + demo account, **submission Wed–Fri**; then bug triage from internal TestFlight | All mobile features frozen Tue Sep 15 |
| FE2 | Operator: stock screens (ingredients, recipes editor, goods-in with batch expiry, counts entry, variance report, low-stock/grey-out), day-close screen (float, counted vs expected, card batch entry, blocks on open tabs/unsynced queue); Web: venue info pages, metadata, PWA install, domain go-live (**if DNS received**) | Drop 3, Parsa's queue API (IPC contract frozen Mon Sep 14) |
| SEC | **Gate 4 (Thu, pre-submission):** full RLS policy pass on every table, idempotent-replay review (double-charge attempt), mobile build secrets audit, dependency audit | Queue implementation |
| AI agents | Variance/COGS report queries, disconnection drill automation script, staff runbook first draft (en/ar), store screenshots via Expo | Stock UI |

**Demo (acceptance-shaped):** full trading day rehearsal + **disconnection drill v1** (§6.2) + day close reconciles.

### Week 5 · Sep 21–27 — Review buffer, part 1
- Store review response (both stores); rejection → fix → resubmit same day.
- Finish anything cut under the priority order (batch expiry UI is first candidate).
- **Client data swap** (see §3 swap point): real courts/rates/menu/recipes loaded via seed scripts against production; placeholder branding replaced.
- Client Supabase handover: `supabase link` to Touch's project, `supabase db push`, storage migration, staging kept on Kagu's org.
- Disconnection drill v2 on real venue hardware (till, KDS machine, printer, UPS). Hardware install support (Touch installs, Kagu remote-guides).
- SEC: penetration-style pass on production URLs; token rotation drill (retire one table's QR, verify old token dead).

### Week 6 · Sep 28 – Oct 4 — Review buffer, part 2 / handover
- Staff training by role, recorded, en/ar. Runbook + staff guide delivered.
- Restore rehearsal (PITR restore to scratch project, documented).
- Repository transfer to Touch's Git account; account-ownership checklist.
- Acceptance walkthrough with Mustafa against the seven module tests; written sign-off; balance invoice.

### 1.1 Offline/LAN subsystem (so week 4 isn't underestimated — design it now, build it then)
- `apps/operator/src/main/queue.ts`: every mutating IPC call writes `{id: '<deviceId>_<ulid>', op, payload, idempotency_key, created_at}` to SQLite **and fsyncs before the renderer gets its ack**. Renderer never talks to Supabase directly for writes; always through IPC → queue → sync worker. Online, the worker drains in ~instantly, so there is **one write path** exercised all day, not a rarely-tested offline branch. This is the single most important de-risking decision.
- Replay: server RPC `apply_queued_write(idempotency_key, op, payload)` — `insert … on conflict (idempotency_key) do nothing`, server timestamps, stock settles server-side, negative stock raises `manager_alerts` row.
- LAN KDS: till main process always runs `ws://<till-static-ip>:8433` broadcasting ticket events sourced from the queue. KDS app subscribes to Supabase Realtime **and** the LAN socket; it renders whichever heartbeat is alive (LAN wins during degraded). Static IP configured in KDS settings screen (skip mDNS — Windows mDNS is flaky; a static IP on the venue LAN is one line in the runbook). Reference-data cache: hourly snapshot of menu/prices/recipes/courts/tables/today's reservations into SQLite (`cache_*` tables).

---

## 2. Week-1 critical path, day by day (Mon Aug 24 – Fri Aug 28)

| Day | Parsa (critical path) | FE1 / FE2 | Output gate |
|---|---|---|---|
| **Day 1 (Mon, today)** | `pnpm dlx create-turbo@latest`; workspaces `apps/{mobile,web,operator}` `packages/{db,core,ui,i18n}`; `supabase init && supabase start` (verify Docker Desktop + WSL2 works on all three Windows dev machines **today** — see risk R6); repo on GitHub, branch protection. **Admin (cannot slip):** check Apple Developer Program enrollment status + Google Play Console account standing under Kagu — confirm Apple membership not lapsed, confirm Play account is an established org account (new accounts trigger the 12-tester/14-day closed-testing rule → would kill the week-4 submission); `eas init` for the project. **Send client-input request pack to Mustafa (the §3 checklist, as a document) + recipe template + printer spec draft.** | Devs onboard: clone, `pnpm i`, `supabase start` green on their machines; FE1 `npx create-expo-app`-into-workspace, FE2 `create-next-app` + Vite operator scaffold | Everyone runs the monorepo locally |
| **Day 2 (Tue)** | Schema Drop 1 migrations: `0001_extensions.sql` (btree_gist, pg_cron), `0002_identity.sql` (`profiles`, `staff_members`, `role` enum, `staff_pins`), `0003_courts.sql` (`courts`, `rate_rules`, `venue_config`), `0004_reservations.sql` (**EXCLUDE constraint in from day 2**), `0005_audit.sql` (`audit_log`, append-only via revoked UPDATE/DELETE). `supabase gen types typescript --local > packages/db/src/types.ts` wired into build | FE1: auth screens vs mocks; FE2: theme tokens (both palettes) + locale routing | Drop 1 migrations merged; types generated |
| **Day 3 (Wed)** | Auth working: email verify + reset (local Inbucket), RLS skeleton per role, seed script `pnpm --filter db seed` (4 courts, rates, 5 staff, 40-item menu placeholder). **Printer spec finalized and issued to client** (58/80 mm decision → spec: 80 mm, ESC/POS, `GS v 0` raster support, USB + Ethernet, e.g. Xprinter XP-80C class; ask for confirmation + purchase this week) | FEs wire real auth against local Supabase | Drop 1 usable by FEs |
| **Day 4 (Thu)** | CI: GitHub Actions — typecheck/test/lint via turbo; migration check job (`supabase db reset` in CI); Vercel preview deploys; EAS build profiles (`development`, `preview`, `production`) + first dev-client builds for FE1. Electron shell handed to FE2 (electron-vite, auto-launch, kiosk-ish window, IPC skeleton) | FE1 installs dev client on devices; FE2 operator SPA boots inside Electron | Green CI on main; dev builds on phones |
| **Day 5 (Fri)** | Staging Supabase project (Kagu's org) + `db push`; error tracking (Sentry) on booking/ordering paths; pg_cron hold-expiry sweep; write §6.2 drill script v0. **SEC Gate 1.** **Weekly Mustafa call #1:** demo auth+RTL, walk the input checklist, confirm currency=IQD single-currency in writing, chase court list/rates | Demo prep | Week-1 demo done; input pack acknowledged by client in writing |

---

## 3. Client-chase checklist (scope §11 → owner, deadline, fallback)

**Chasing owner: Parsa on the weekly Mustafa call + a standing mid-week WhatsApp nudge; every item below is in the Day-1 request pack with its consequence quoted from the signed scope.** Hard swap point: **fixture data is replaced by client data only via seed scripts in `packages/db/seed/`, never hand-entered** — so the swap in week 5 (or earlier) is one command per dataset.

| Input (scope §11) | Chase by | Fallback if late (mapped to scope's priority order) |
|---|---|---|
| Named approver weekly (Mustafa) | Call #1, Fri Aug 28 | None acceptable — escalate in writing; acceptance risk is client-side per scope |
| Court list, hours, rates, cancellation policy | Fri Aug 28 (W1) | Seed: 4 courts (2 indoor/2 outdoor), 60/90-min slots, peak 17:00–23:00. Swap = `seed/courts.ts`. Priority #1 unaffected — model is data-driven |
| **Trading currency + tax decision** | **Fri Aug 28 (W1), in writing** | Proceed IQD-integer, tax 0% default with per-item-group rate configurable. Dual currency = change request (pre-agreed in scope §10) — do not build speculatively |
| Branding assets (logo, photos) | Fri Aug 28 (W1) | Ship on 2026 identity tokens already specified (#A5D06F/#3360AB etc.) + placeholder photography; scope explicitly allows "interfaces ship in placeholder styling" |
| Full menu (prices, sizes, modifiers) | Fri Aug 28 (W1) | 40-item bilingual fixture menu. Swap = `seed/menu.ts`. Website ships on fixtures; real menu is data entry the client's manager can do in the operator app in W5 |
| Domain + DNS access | Fri Aug 28 (W1) | Ship on `touchpadel.vercel.app`; domain cutover is a 1-hour W5 task. App-store listing URLs use vercel domain if needed |
| Supabase account funded, Touch's name | Fri Sep 4 (W2) | Build proceeds on Kagu staging; handover = `supabase link && supabase db push` + storage copy in W5. See risk R7 |
| EN/AR copy for all content | Fri Sep 4 (W2) | AI-drafted Arabic reviewed by a native speaker Kagu arranges; flagged "provisional pending Touch review" — Arabic acceptance is client-gated per scope |
| Table numbering + floor layout | Fri Sep 4 (W2) | Seed tables T1–T12; QR artwork generated per token so re-numbering is a reprint, not a rebuild |
| **Measured recipes per product** | **Fri Sep 4 (W2) — the scope's #1 risk** | **Escalation ladder:** template sent Day 1 → reminder call #1 → W2 call: offer a 2-hour guided session with the kitchen lead to fill it live → if absent Fri Sep 4, invoke scope's own priority order in writing: Module 5 moves to weeks 5–6, batch expiry gives way first, recipe-level consumption stays. Meanwhile build/test entirely on measured fixture recipes so the module is code-complete and only data-late |
| Ingredients (pack size, cost, supplier, shelf life) | Fri Sep 4 (W2) | Fixture ingredient catalog; margin report labeled "fixture costs" until swap |
| Staff list + roles | Fri Sep 11 (W3) | Create role-named training accounts (cashier1, prep1…); rename in W5 |
| **Hardware: till PC, KDS PC, printer (per Kagu spec), network, UPS, static IP for till** | **Printer ordered by Fri Aug 28; all in place Fri Sep 11 (W3)** | Kagu buys an identical spec printer locally for dev regardless (Day 3 spec). If venue hardware late: drill runs on Kagu hardware in W4, on-site validation slides to W5 |
| Staff available for training | W5 | Recorded videos substitute partially; live training compressed into W6 |

---

## 4. Risk register (top 10)

| # | Risk | L | I | Mitigation | Early-warning signal |
|---|---|---|---|---|---|
| R1 | **Measured recipes arrive late/never** (scope's own #1) | High | High | Fixture recipes make Module 5 code-complete without client data; escalation ladder in §3; scope pre-authorizes deferral to W5–6 with batch expiry cut first — invoke it in writing, don't absorb | Recipe template not returned by end of W2 call (Sep 4) |
| R2 | **Store rejection burns the buffer** | Med | High | Submit **Wed Sep 16**, 2 days inside deadline; pre-empt known rejection causes: demo account in review notes, no IAP anywhere near real-world goods, account-deletion flow in-app (Apple 5.1.1(v)), privacy labels done in W3 not W4; acceptance is contractually "on submission" | Apple review > 72 h, or any "metadata rejected" on first pass |
| R3 | **Play Console new-account 12-tester/14-day rule blocks production release** | Med | High | Verified **Day 1**. If Kagu's account is affected: start closed testing with 12 testers in **week 2** (dev builds count), so the 14-day clock finishes before W4; or use an established Kagu org account | Day-1 console check shows personal/new account status |
| R4 | **Dual-currency surprise** (venue actually takes USD at counter) | Med | Med | Force written IQD confirmation at call #1; integer-IQD design with `round_cash_to` keeps a display-only USD rate cheap; true dual-currency till = quoted change request per scope §10 — quote same day, defer to W5+ | Mustafa hesitates on the currency question, or menu arrives priced in USD |
| R5 | **KDS LAN + offline queue underestimated** (scope said "wrapper"; it isn't) | High | High | Single-write-path architecture (§1.1) means the queue is exercised all day online — offline is the same code with a slow drain, not a separate mode; static IP not mDNS; queue design frozen in W1, built by Parsa only, IPC contract frozen Mon Sep 14; drill rehearsed W4 not W5 | Queue not draining idempotently in the W3 Friday smoke test; FE2 blocked on IPC contract after Sep 14 |
| R6 | **Docker/Supabase-on-Windows dev friction** (WSL2, port clashes, AV slowness) | Med | Med | Day-1 gate: all 3 machines run `supabase start` before any code; fallback = one shared Kagu-hosted dev Supabase project (schema still migration-first, so nothing changes structurally); document WSL2 setup in `CONTRIBUTING.md` | Any dev >2 h on Docker Day 1 |
| R7 | **Client Supabase handover mid-build** (org/project mechanics) | Med | Med | Never build on a client project mid-phase. Kagu staging until W5; handover = client creates org+project, invites Kagu as admin, `supabase link --project-ref` + `db push` + config (auth SMTP, JWT secret rotation → **re-issue table-QR tokens after JWT secret changes**, budgeted in W5) | Client Supabase still unfunded at W3 call |
| R8 | **RTL rework late** (mirroring bolted on in W4) | Med | Med | RTL is week-1 foundation in all three apps (logical properties only, lint rule banning `left/right` physical props via `eslint-plugin-react-native` + stylelint); every weekly demo runs once in Arabic; AI-agent RTL snapshot tests from W2 | A W2+ demo screen that was never shown in Arabic |
| R9 | **Arabic thermal printing fails on real hardware** (raster width, codepage, driver, cutter) | Med | High | Spec issued Day 3; Kagu buys the identical printer for the dev bench in W1; pipeline renders raster (no font/shaping dependence on printer); test receipt on real hardware in W3, not at install | Printer purchase unconfirmed by Fri Aug 28 |
| R10 | **Font licensing** (Frutiger LT Arabic is a commercial Monotype face; Next Art likewise) | Med | Low-Med | Ask Touch Day 1 whether they hold licenses (brand identity implies their agency bought them). If not: quote webfont/app-embedding license cost to Touch (their brand, their license) with fallback stack ready — IBM Plex Sans Arabic (OFL) + a geometric Latin (e.g. Montserrat) behind the same token, one-line swap in `packages/ui/src/tokens/typography.ts` | No license file received by Fri Aug 28 |

---

## 5. Verification gates

### 5.1 Per-module acceptance → weekly Mustafa demo scripts
| Module | Contractual acceptance | Demo script (which call) |
|---|---|---|
| 1 Foundations | Register/verify/sign-in/language on 3 clients; role matrix by written test | **Call #1 (Aug 28):** live sign-up on Mustafa's phone; flip to Arabic on all three clients; show cashier login that cannot open stock |
| 2 Reservation | App booking appears on desk; staff CRUD; concurrency suite passes; real bookings taken | **Call #2 (Sep 4):** Mustafa books from his phone → calendar updates live; run `pnpm --filter db test:concurrency` on screen (20 parallel requests, 1 success); move + cancel with audit entries shown |
| 3 Cafe guest | No-app QR order → kitchen → status → waiter call → tab settles | **Call #3 (Sep 11):** Mustafa scans a printed QR, orders in Arabic; ticket on KDS; mark ready → his page updates; waiter call raised/resolved; settle at till |
| 4 Cashier/dispatch | Full trading day; day close reconciles; every discount/void traceable | **Call #4 (Sep 18):** scripted 30-minute mini trading day: 3 tabs, split bill, PIN discount, void-after-send → waste, charge cafe order to a court booking, close day with counted cash + card batch |
| 5 Stock | Count → variance reconciles; every movement traceable | **Call #4 + W5:** goods-in with expiry, sell 10 items, count, variance report, click through to movements; COGS per item (fixture or real costs) |
| 6 Website | Live on domain, bilingual, till change reflected without redeploy, end-to-end order | **Call #3/#4:** grey out an item at the till → gone from the site in seconds |
| 7 Degraded | Drill below | **Call #4 (abridged) + W5 on-site (full)** |

### 5.2 Disconnection drill script (Module 7 — run W4 rehearsal, W5 on venue hardware)
1. Normal trading: open 2 tabs, send 2 tickets; note queue drains to 0.
2. **Pull the till's WAN** (router upstream, not LAN — KDS↔till LAN stays up).
3. Within heartbeat window (≤30 s): server marks venue degraded; mobile app refuses a booking for tonight with venue phone number; website blocks ordering with "see a member of staff"; a booking for next Saturday still succeeds.
4. Till: banner shows degraded + queued count. Take 3 more orders incl. modifiers; **tickets appear on the separate KDS machine via LAN socket**.
5. **Kill till power mid-order** (after confirm). Reboot: confirmed items intact in queue (fsync proof), unconfirmed absent.
6. Reconnect WAN: queue replays; Supabase rows show exactly one copy of each (idempotency keys checked by script `packages/db/test/replay-audit.ts`); stock deducted once; degraded period logged with start/end/duration.
7. Attempt day close **before** replay finishes → blocked; after drain → close succeeds, totals reconcile.
8. Edge assertion: a mobile booking placed inside the heartbeat gap collides on replay → desk sees a conflict surfaced, not an overwrite.

### 5.3 Security review checkpoints (SEC, part-time)
| Gate | When | Reviews |
|---|---|---|
| 1 | Fri Aug 28 | Auth config (email verification enforced, password policy), RLS skeleton default-deny, role enum + grants, CI secret hygiene, repo access |
| 2 | Fri Sep 4 | Table-token signing (alg, expiry, rotation, `kid`), anonymous RLS (cross-table read/write attempts scripted), hold-spam rate limits, mobile session storage |
| 3 | Fri Sep 11 | Audit log append-only (UPDATE/DELETE revoked at DB level), PIN hashing + lockout, degraded lockout enforced server-side (bypass attempt via direct PostgREST call), waiter-call rate limiting |
| 4 | Thu Sep 17 (pre-submission) | Full RLS pass per table × role (matrix doc), replay idempotency abuse (replayed key with mutated payload), Electron hardening (contextIsolation, no nodeIntegration in renderer, IPC input validation), dependency + secrets audit of the store build |
| 5 | W5 | Production config on Touch's Supabase (JWT secret rotated, service key custody, backups on), token re-issue after rotation, restore-rehearsal observer |

---

## 6. Store-submission cutline — what MUST be true by Fri Sep 18 (target Wed Sep 16)

**In the submitted binary (mobile = padel only):** email auth + verification + reset + **account deletion**; profile (name/phone/language); EN/AR full RTL; court browse, day grid with live prices, slot hold, booking, cancellation per policy, booking list; push notifications (confirm/reminder/cancel); degraded-mode refusal message; Sentry; production Supabase URL (Kagu staging acceptable if Touch's project isn't live — swappable via EAS env without resubmission only if planned as remote config, otherwise submit against staging and update OTA-safe pieces later — decide Mon Sep 14).
**Around the binary:** privacy policy URL live on `apps/web`; store listings EN+AR, screenshots both languages; Apple privacy labels + Google Data Safety; review notes with working demo account seeded with a future booking; content rating done; **no cafe traces, no payment traces in the app**.
**Explicitly NOT required for the cutline** (scope-backed): stock module completeness, batch expiry, day-close polish, desk-side offline queue (heartbeat lockout **is** required — it protects the booking path the app ships), Touch's domain, real menu/recipes.
**Contractual note to restate on Call #4:** acceptance of the mobile app is on submission of a working build; store approval timing is Apple/Google's.

---

### Critical Files for Implementation
- C:/Users/p.mansouri/Desktop/kagu software/TouchPadel/packages/db/supabase/migrations/0004_reservations.sql (EXCLUDE constraint, hold TTL — the contractual integrity core)
- C:/Users/p.mansouri/Desktop/kagu software/TouchPadel/apps/operator/src/main/queue.ts (SQLite durable write queue + idempotent replay — single write path)
- C:/Users/p.mansouri/Desktop/kagu software/TouchPadel/apps/operator/src/main/lan-kds-server.ts (WebSocket LAN fallback feeding the prep station)
- C:/Users/p.mansouri/Desktop/kagu software/TouchPadel/packages/core/src/money.ts (integer-IQD arithmetic, split/rounding rules)
- C:/Users/p.mansouri/Desktop/kagu software/TouchPadel/packages/db/seed/fixtures.ts (fixture courts/menu/recipes — the client-data hard swap point)