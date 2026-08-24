# Touch Padel — Handoff

> Read this first when starting a fresh chat. Companions: `docs/scope/` (signed SOW + diagrams),
> `docs/design/` (architecture · data model · delivery · critique), the approved plan at
> `~/.claude/plans/read-the-pdfs-in-mutable-perlis.md`.

## Working style
- **Git: NO AI co-author trailers, ever. Commits are authored by Parsa alone.** Pushing to
  GitHub (`KaguSoftware/TouchPadel`, private) is pre-authorized.
- Plan mode for direction-setting work; owner approves before build.
- Owner (Parsa) works with AI agents heavily; 2 frontend devs (FE1 mobile, FE2 web/operator) and a
  part-time security reviewer (SEC) join. AI agents are safe on schema-derived/testable work;
  **RLS, the reservations exclusion constraint, replay logic, token signing, and money arithmetic
  are line-reviewed by Parsa and re-reviewed by SEC.**
- Fixture data is only ever replaced via seed/import scripts (`packages/db/`), never hand-entered —
  see the scope ledger below.
- Keep this file and the memory index (`~/.claude/.../memory/MEMORY.md`) in lockstep.

## What this is
Phase 1 for **Touch Padel** (padel venue + cafe, Iraq; client approver: Mustafa). Kagu Web Studio
builds: guest mobile app (React Native + Expo — padel booking ONLY), public website (Next.js on
Vercel — carries the whole cafe QR-ordering experience), Windows operator app (Electron — till,
desk calendar, KDS, stock, admin), all on one Supabase Postgres with RLS. Bilingual EN/AR full RTL.
Desk payment only. Degraded offline mode (till keeps trading through outages). The signed SOW in
`docs/scope/` is the contract — anything not written there is out of scope.

**The clock is running**: signed + paid; week 1 = 2026-08-24→30; build ends 2026-09-20; store
submission Wed 2026-09-16 (hard stop Fri 09-18); review/handover ends 2026-10-04.

## Stack & environment
- pnpm + Turborepo monorepo; TypeScript strict; Node ≥22 (supabase-js needs native WebSocket);
  packages scoped `@touch/*`; React 19 workspace-wide.
- Apps: `apps/mobile` (Expo SDK 53, expo-router) · `apps/web` (**Next 16.3** App Router, Vercel) ·
  `apps/operator` (Vite + React + TanStack Router SPA) · `apps/operator-shell` (Electron main/
  preload — SQLite queue, LAN KDS server, ESC/POS printing, heartbeat, kiosk — still skeleton).
- DB: Supabase CLI + Docker locally (`supabase start`); schema-first migrations 0001–0026 in
  `packages/db/supabase/migrations/` (design in `docs/design/design-data.md`; the SQL files are
  now the ground truth). Hosted = the client's long-term project, linked at `packages/db`.
- Money: integer IQD (`bigint` domains), largest-remainder splits, no bill rounding by default.
- Dev OS: Windows 11 (Docker Desktop + WSL2 required). e2e: Playwright at `e2e/` (`pnpm e2e`).

## Conventions
- All schema changes are migration files — no dashboard edits, ever.
- All operator writes go through IPC → SQLite queue → replay (single write path, online too).
- Writes to business tables are RPC-only (`SECURITY DEFINER` in schema `app`); RLS is the backstop.
- Bilingual content = paired `_en` / `_ar` columns (not jsonb). CSS logical properties only
  (lint-enforced); every demo runs once in Arabic.
- Fonts: brand faces are **Next Art** (Latin) + **Frutiger LT Arabic** — commercial, files not yet
  in hand; free stand-ins live behind tokens in `packages/ui` (one-line swap later).
- **Mobile native-feel rule (owner, 2026-08-24):** if it can look/behave native in React Native, it
  must — bottom tabs via expo-router `Tabs`, native stack with platform back gestures/transitions,
  platform pickers/switches/action sheets. No web-styled custom nav in `apps/mobile`.
- Brands: Padel 2026 identity (green #A5D06F / blue #3360AB) on app/site/operator; Touch Cafe
  identity (blue + brown #603813) on the QR-menu/ordering pages.

## Current status (2026-08-24, end of day 1 — both sessions)
- **All 14 turbo tasks green: 289 unit/integration tests + 8/8 Playwright e2e** (cafe QR journey
  with live-broadcast status, operator journeys, public menu — each passing in English AND Arabic
  RTL). Fresh `supabase db reset --local` applies migrations 0001–0026 + seed cleanly; fixtures
  (`pnpm db:fixtures`) load the sample venue.
- **Hosted Supabase** (ref `lczijabnorujcgmbuqlw`, Frankfurt — **THE CLIENT'S long-term project**,
  owner-confirmed): migrations 0001–0026 applied, seeded, anonymous sign-ins on (rate limit
  300/hr — revisit SEC gate 5). Additive migrations only, NEVER destructive ops there; local
  Docker is where things break. W5 "handover" = account/billing transfer, secrets custody, SMTP,
  dev-account rotation — no project migration. Keys: root `.env.local` (master incl. service-role)
  + per-app `.env*`; db tests default to LOCAL (`packages/db/.env.remote` holds hosted creds for
  deliberate runs).
- **Security bugs found by our own suites and fixed** (pattern: amend original migration in place
  AND ship a follow-up migration): `is_staff()` NULL guard bypass (0010) · PIN lockout rollback
  (0011) · pgcrypto schema qualification (0009) · service_role grants on local stacks (0012) ·
  menu-availability view function grants (0025) · PIN brute-force via device-id rotation, booking
  writes ignoring opening hours/closed dates, unpriced staff bookings, missing audit reasons,
  void-after-payment deadlock, degraded-detection device-naming fragility (all 0026).
- **Docker Desktop installed** (user-scope `%LOCALAPPDATA%\Programs\DockerDesktop` — stale shells
  need a PATH prefix or a reboot).
- **Client input form SENT to Touch 2026-08-24** (based on `docs/client/` pack) — awaiting returns;
  chase at call #1 (Fri 2026-08-28).
- **Apple Developer + Play Console both verified in good standing 2026-08-24** — risk R3 (Play
  new-account tester rule) cleared.

## File map (key files)
- `docs/scope/touch-padel-phase1-scope-of-work.pdf` — the signed contract (17pp; .txt extract alongside).
- `docs/design/design-data.md` — canonical schema: 19 migrations, DDL, RLS matrix, FEFO, tests.
- `docs/design/design-arch.md` — monorepo, Electron/queue/LAN-KDS/printing/degraded-mode design.
- `docs/design/design-delivery.md` — week-by-week plan, client-chase checklist, risk register, drill script.
- `docs/design/design-critique.md` — pre-build cross-review; `docs/design/sow-gap-review-2026-08-24.md`
  — post-build SOW-vs-code sweep (roadmap item 4 is its digest).
- `docs/client/` — client-facing pack (input checklist, CSV templates, printer spec) — SENT 2026-08-24.
- `packages/db/tests/` — contractual suites (concurrency, rls-matrix, cafe-flow, degraded, hardening).
- `e2e/` — Playwright config + specs (cafe journey, operator journeys, public menu; EN + AR).

## Roadmap / next steps
1. ✔ DONE Day 1 AM: scaffold · Drop 1 · contractual suites green both envs · CI · shells · client
   pack sent · Docker working.
2. ✔ DONE Day 1 PM (the "maximal autonomous build" session): **database complete for all 7 SOW
   modules** (migrations 0001–0026, local + hosted) · fixture venue (30-item bilingual menu with
   full recipes/batches, 12 tables, 4 courts) · functional flows in all three apps (mobile booking,
   web QR cafe, operator desk/KDS/till/admin) · **Playwright e2e 8/8 incl. live-broadcast status +
   full Arabic RTL passes** · replay + send-push edge functions (written, not yet deployed) ·
   adversarial SOW sweep + hardening (PIN brute-force rekey, booking-hours guard, replay map fixes,
   audit reasons, void-deadlock guard) · 289 unit/integration tests + 8 e2e green.
3. **← ACTIVE — Week-1 remainder / user actions:** EAS login + dev builds on phones (FE1 takes
   mobile from here — native-feel rule above) · Vercel link + first deploy · deploy edge functions
   (`supabase functions deploy replay send-push` + cron for send-push) · SEC Gate 1 (Fri, review
   the two found-and-fixed security bugs + 0019-hardening checklist) · Mustafa call #1 Fri
   2026-08-28 (IQD in writing, chase form returns, demo: e2e cafe journey + booking).
4. Week 2+ (from the critic's gap list, mapped to the delivery plan): stock UI (module 5 — DB done,
   `stock.tsx` is a placeholder) · staff-admin RPC+UI (owner role, module 1 acceptance) · court
   records admin + photos rendering · week calendar view + shorten/move-duration · split-by-item +
   refund/merge/override UIs · audit-log viewer + manager-alerts reader · QR artwork UI (script
   exists) · Sentry wiring · short-lived till sessions · Electron queue wiring (single write path)
   + LAN KDS · printing pipeline. Store submission Wed 2026-09-16.

## Deliberately partial — grows later (scope ledger)
| Area | What ships now | Intended full shape | Grows in |
|---|---|---|---|
| Business data | Fixture courts/menu/recipes/tables (reserved UUID prefix) | Client's real data via CSV import scripts | W5 (or when client delivers) |
| Fonts | IBM Plex Sans Arabic + free Latin behind tokens | Licensed Next Art + Frutiger LT Arabic | When Touch supplies files/licenses |
| Payments | Desk only (cash/card recorded; terminal separate) | Online payment | Later phase (SOW) |
| Offline | Degraded mode: till queue + LAN KDS | Full offline local DB | Later phase (SOW) |
| Batch expiry UI | First candidate to slip to W5 per SOW priority order | Full expiry UI | W5 if squeezed |

## Gotchas / open issues
- **The hosted Supabase project is the client's future production.** Before real trading starts:
  rotate/remove the seeded dev staff accounts and PINs, revisit the 300/hr anonymous rate limit,
  transfer billing/ownership to Touch (SEC gate 5 checklist). Until then it doubles as our shared
  staging — additive changes only. Hosted has schema 0001–0026 + seed **+ fixtures (loaded
  2026-08-24 via `supabase db query --linked`; test residue cleaned same day — 4 courts remain)**.
- **Vercel production menu was empty (2026-08-24, root-caused):** the dashboard env var
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` was pasted with a second line glued on
  (`...OJFGZdCDSUPABASE_URL=https://...` — verified verbatim in the served client bundle), so every
  Supabase request 401'd and the menu page's try/catch rendered empty. DB itself verified fine (all
  4 menu queries return data with both the anon JWT and the clean publishable key). Fix = edit that
  one var to end at `...OJFGZdCD`, redeploy **without build cache** (NEXT_PUBLIC_* is inlined at
  build). Same mangling existed in root `.env.local` (fixed 2026-08-24). Also recommended: delete
  `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ANON_KEY` from Vercel — the web app never reads them.
  Lesson: the "(FIXTURE)" footer address is a hardcoded i18n string, NOT proof of DB connectivity.
- Migration numbering: **0023 intentionally unused** (reserved gap; 0024 = push outbox). Not a
  lost file.
- **KDS item-level ready marks are local component state only** (whole-ticket status is real) —
  SOW L460 wants item marks notifying floor+guest; scheduled with the KDS polish pass.
- Charge-to-booking: tab links to reservation (picker in NewTabDialog ✔) but `compute_tab_totals`
  does **not yet add the court price** to the bill — the "one payment" SOW promise needs that in
  the till drop (W3).
- Full critic report (SOW-vs-code sweep, 2026-08-24): `docs/design/sow-gap-review-2026-08-24.md`;
  roadmap item 4 above is its digest.
- e2e runs locally only (`pnpm e2e`; needs local stack + both dev servers; CI job stub is a
  comment block in ci.yml — enable later).
- **Client inputs: NONE received yet** (courts, rates, menu, recipes, domain, Supabase, fonts,
  branding assets beyond PDFs). Chase pack is Day-1 deliverable; recipes are the SOW's own #1 risk.
- **Currency**: building IQD-only per owner decision — get Mustafa's written confirmation at call
  #1 (2026-08-28). Dual currency = change request (SOW §10).
- **SOW promises PITR; Supabase PITR is a paid add-on** beyond the quoted "$25/mo" — cost gap must
  be raised with the client in the week-1 pack.
- **Apple/Play accounts**: enrollment + Play new-account 12-tester/14-day rule NOT yet verified
  (Day-1 item — needs the owner to check dashboards; write a Claude-Chrome prompt when doing this).
- Brand PDFs at repo root are 257MB/66MB — gitignored (`/*.pdf`), local-only; do not force-add.
- The two padel brand decks differ (2024 vs 2026): **2026 (`touch full brand2.pdf`) governs.**
- Table-token Vault secret must be set to the same value on Touch's project at W5 handover or
  every printed QR dies (see plan "Resolved design calls").

## Running it
Nothing runs yet. Once scaffolded: `pnpm i` · `pnpm db:start` (supabase via Docker) · `pnpm db:reset` ·
`pnpm dev` per app · `pnpm turbo lint typecheck test` · concurrency suite: `pnpm --filter @touch/db test:concurrency`.
