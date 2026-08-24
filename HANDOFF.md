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
- pnpm + Turborepo monorepo; TypeScript strict everywhere; packages scoped `@touch/*`.
- Apps: `apps/mobile` (Expo SDK 52+, expo-router) · `apps/web` (Next.js 15 App Router) ·
  `apps/operator` (Vite + React + TanStack Router SPA) · `apps/operator-shell` (Electron main/
  preload — SQLite queue, LAN KDS server, ESC/POS printing, heartbeat, kiosk).
- DB: Supabase CLI + Docker locally (`supabase start`); schema-first migrations in
  `packages/db/supabase/migrations/` (19-file plan in `docs/design/design-data.md` — canonical).
  **No client Supabase project yet** — Kagu staging until W5, then `supabase link` + `db push`.
- Money: integer IQD (`bigint` domains), largest-remainder splits, no bill rounding by default.
- Dev OS: Windows 11 (Docker Desktop + WSL2 required).

## Conventions
- All schema changes are migration files — no dashboard edits, ever.
- All operator writes go through IPC → SQLite queue → replay (single write path, online too).
- Writes to business tables are RPC-only (`SECURITY DEFINER` in schema `app`); RLS is the backstop.
- Bilingual content = paired `_en` / `_ar` columns (not jsonb). CSS logical properties only
  (lint-enforced); every demo runs once in Arabic.
- Fonts: brand faces are **Next Art** (Latin) + **Frutiger LT Arabic** — commercial, files not yet
  in hand; free stand-ins live behind tokens in `packages/ui` (one-line swap later).
- Brands: Padel 2026 identity (green #A5D06F / blue #3360AB) on app/site/operator; Touch Cafe
  identity (blue + brown #603813) on the QR-menu/ordering pages.

## Current status (2026-08-24)
- Scope + diagrams read and assessed; 4-agent design workflow produced `docs/design/*` (reviewed,
  contradictions resolved in the approved plan — the plan's "Resolved design calls" table governs
  where docs disagree).
- Plan approved. Repo initialized; docs committed. **No application code exists yet.**
- Nothing verified against a running stack yet (Docker/supabase start not confirmed on this
  machine).

## File map (key files)
- `docs/scope/touch-padel-phase1-scope-of-work.pdf` — the signed contract (17pp; .txt extract alongside).
- `docs/design/design-data.md` — canonical schema: 19 migrations, DDL, RLS matrix, FEFO, tests.
- `docs/design/design-arch.md` — monorepo, Electron/queue/LAN-KDS/printing/degraded-mode design.
- `docs/design/design-delivery.md` — week-by-week plan, client-chase checklist, risk register, drill script.
- `docs/design/design-critique.md` — cross-review; its gap list became plan work items.
- `docs/client/` — client-facing pack (input checklist, CSV templates, printer spec) — being drafted.

## Roadmap / next steps
1. **← ACTIVE** Step 0–5 of the plan: repo pushed · Docker/supabase verified · monorepo scaffold ·
   migrations 0001–0008 + fixtures + generated types + concurrency suite · CI + app shells ·
   client pack drafted.
2. Week-1 day plan (D2–D5): Drop 1 migrations → auth e2e → CI/EAS → staging + SEC Gate 1 +
   Mustafa call #1 (Fri 2026-08-28: confirm IQD in writing; chase courts/menu/domain/fonts).
3. Weeks 2–4 per `docs/design/design-delivery.md`; store submission Wed 2026-09-16.

## Deliberately partial — grows later (scope ledger)
| Area | What ships now | Intended full shape | Grows in |
|---|---|---|---|
| Business data | Fixture courts/menu/recipes/tables (reserved UUID prefix) | Client's real data via CSV import scripts | W5 (or when client delivers) |
| Fonts | IBM Plex Sans Arabic + free Latin behind tokens | Licensed Next Art + Frutiger LT Arabic | When Touch supplies files/licenses |
| Payments | Desk only (cash/card recorded; terminal separate) | Online payment | Later phase (SOW) |
| Offline | Degraded mode: till queue + LAN KDS | Full offline local DB | Later phase (SOW) |
| Batch expiry UI | First candidate to slip to W5 per SOW priority order | Full expiry UI | W5 if squeezed |

## Gotchas / open issues
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
