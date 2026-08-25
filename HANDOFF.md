# Touch Padel — Handoff

> Read this first when starting a fresh chat. Companions: `docs/scope/` (signed SOW + diagrams),
> `docs/design/` (architecture · data model · delivery · critique), **`docs/design/cafe-rebuild/`**
> (the current slice: db/web/operator design + the UpperDeck reference spec + owner decisions), and
> the approved plans at `~/.claude/plans/read-the-pdfs-in-mutable-perlis.md` (platform) and
> `~/.claude/plans/this-system-has-three-cuddly-moon.md` (cafe rebuild).

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
## Current status (2026-08-25, day 2 — the Touch Cafe rebuild)

**Day 1 (2026-08-24)** delivered the whole platform foundation: migrations 0001–0026 on both the
local Docker stack and the client's hosted project, fixture venue, functional flows in all three
apps, 289 unit/integration tests + 8 Playwright e2e (EN + AR), CI, client pack sent.

**Day 2 is the cafe rebuild** — the QR-menu section rebuilt to feature parity with the reference
project `KaguSoftware/UpperDeck` (Telegram ordering + analytics + hero/photos/reveals + operator
admin), on top of our own schema and the Touch Cafe brand. The approved plan is
`~/.claude/plans/this-system-has-three-cuddly-moon.md`; the design pack is committed at
`docs/design/cafe-rebuild/`.

Landed and verified (committed):
- **DB: migrations 0027–0035** — menu extensions (`hook_en/ar`, `highlight`, `sold_out`,
  `photo_blur`, category photos, `menu_item_costs`), modifier **reveals** (depth-1 invariant +
  `app.item_active_groups`), `cafe_settings` key/value registry + `cafe_settings_public` view,
  server-side **featured discount** in `add_order_items` (+ `list_price_iqd`/`discount_pct`),
  `cafe_tables.bell_enabled` + QR-token RPC + `menu-media` storage bucket, **Telegram** outbox /
  actions ledger / claim / apply-action / state-machine refactor, guest-visible `waiter_call_status`
  broadcast + wider `menu_changed`, **analytics** RPCs + LLM tables + `normalize_finding`.
- **DB tests: 214/214 green** (`pnpm --filter @touch/db test`) — new `cafe-menu-ext` (14),
  `telegram` (13), `analytics` (12), `telegram-render` (16), `insights-text-parity` (1), RLS matrix
  now 128 rows. The suites found and fixed a real **Telegram double-send** bug (0035).
- **Edge functions**: `telegram-send`, `telegram-callback` (secret-token webhook, idempotent
  button write-back, message edit), `analytics-posthog` (batch HogQL proxy, 16 named queries),
  `analytics-insights` (Groq, five scan angles, degraded templated fallback) + `_shared/telegram.ts`,
  `_shared/auth.ts`, `SETUP-telegram.md`.
- **`@touch/core`**: `applyPctDiscountIqd` (SQL parity-tested) + 12 pure analytics modules
  (range, business day, confidence, compare, menu matrix, menu position, price bands, basket,
  overview, patterns, insightsText, exclusions) — 227 tests.
- **Operator app**: `/admin` layout + URL-synced child routes with default-deny role matching;
  primitives (toast, confirm, switch, tabs, image field + webp compression, money/percent inputs);
  menu family (items with photo/hook/highlight/sold-out/cost, categories, add-ons + reveals editor,
  suggested); hero builder + ticker + live preview; **A6 QR cards** with per-table bell toggle and
  print; Telegram settings + outbox viewer + test message; cafe settings; staff list; **KDS/floor
  sound + stale alarms** with a reconnecting realtime pill. 125 operator tests.
- **Web foundation**: `middleware.ts` → `proxy.ts`, **Arabic default**, site root is the cafe app,
  padel landing dropped, `/t/{token}` still rewritten verbatim, **SSR menu** (ISR 60) so the page
  never blanks, Touch Cafe tokens/styles/icons + brand components, guest analytics client.

In flight when this was written (three agents): guest UI shell + hooks, the item/basket/QR sheets,
and the operator analytics dashboard UI. e2e specs for the new journeys are the last step.

## File map (key files)
- `docs/design/cafe-rebuild/` — **the cafe rebuild design pack**: `db-slice.md`, `web-slice.md`,
  `operator-slice.md`, `upperdeck-spec.md` (the reference project's full spec), `decisions.md`
  (owner decisions, binding), `context-existing-cafe.md`, `context-operator.md`.
- `docs/brand/cafe/p01–16.png` — the Touch Cafe brand deck, rendered (blue #3360AB / brown #603813).
- `docs/scope/touch-padel-phase1-scope-of-work.pdf` — the signed contract (17pp; .txt alongside).
- `docs/design/design-data.md` · `design-arch.md` · `design-delivery.md` · `design-critique.md` ·
  `sow-gap-review-2026-08-24.md`.
- `docs/client/` — client-facing pack (input checklist, CSV templates, printer spec) — SENT 2026-08-24.
- `packages/db/supabase/migrations/` — 0001–0026 (platform) + **0027–0035 (cafe rebuild)**.
- `packages/db/supabase/functions/` — `replay`, `send-push`, `telegram-send`, `telegram-callback`,
  `analytics-posthog`, `analytics-insights`, `_shared/`, `SETUP-telegram.md`.
- `packages/db/tests/` — contractual suites (concurrency, rls-matrix, cafe-flow, degraded,
  hardening, cafe-menu-ext, telegram, analytics, + two pure suites).
- `packages/core/src/analytics/` — pure analytics modules shared by the operator and the edge fn.
- `apps/web/src/{components/cafe,hooks/cafe,styles/cafe,lib}` — the guest cafe app.
- `apps/operator/src/features/{admin,analytics,kds,till}` — operator surfaces.
- `e2e/` — Playwright config + specs (EN + AR).

## Roadmap / next steps
1. ✔ DONE Day 1: platform foundation (see above).
2. ✔ DONE Day 2 waves 0–6, 9–12: design pack, DB 0027–0035 + tests, edge functions, core analytics,
   operator foundations + admin sections + KDS alarms, web foundation + data layer + i18n.
3. **← ACTIVE — finish the cafe slice**: guest UI (shell/hooks + sheets), operator analytics
   dashboard UI, then **e2e specs** (`cafe-root`, rewritten `cafe-journey` incl. reveals + featured
   discount + broadcast waiter status, `cafe-menu-live`, `cafe-rtl-layout`, operator journeys) and a
   full `pnpm turbo lint typecheck test` + `pnpm e2e` gate.
4. **Owner setup** (nothing exists yet — everything degrades gracefully until then): Telegram bot +
   staff group + webhook secret; PostHog EU project; Groq key; the real domain in
   `NEXT_PUBLIC_SITE_URL` / `VITE_GUEST_SITE_URL`; the official Touch Cafe logo files. Checklist in
   `packages/db/supabase/functions/SETUP-telegram.md` and plan §5.
5. **Hosted rollout**: `supabase db push` (0027–0035 are additive), `supabase secrets set`,
   `functions deploy`, Vault (`service_role_key`, `functions_base_url`) + `pg_net`/`pg_cron`,
   `setWebhook`, Vercel env + redeploy without build cache.
6. Then back to the pre-cafe roadmap: stock UI, staff-admin RPC+UI, court records admin, week
   calendar view, split-by-item/refund/override UIs, audit-log viewer, Sentry, short-lived till
   sessions, Electron queue wiring + LAN KDS, printing pipeline. Store submission Wed 2026-09-16.

## Deliberately partial — grows later (scope ledger)
| Area | What ships now | Intended full shape | Grows in |
|---|---|---|---|
| Business data | Fixture courts/menu/recipes/tables (reserved UUID prefix `f1f7`) | Client's real data via CSV import scripts | W5 (or when client delivers) |
| Fonts | Montserrat + IBM Plex Sans Arabic behind tokens | Licensed Next Art + Frutiger LT Arabic | When Touch supplies files/licenses |
| Touch Cafe logo | Recreated as an inline SVG wordmark + `packages/ui/src/brand/cafe-mark.svg` (SWAP POINT comments) | The official supplied artwork | When Touch supplies it |
| Telegram / PostHog / Groq | Code complete; **no accounts yet** — every path no-ops or degrades | Live bot group, EU PostHog project, Groq key | Owner setup (roadmap 4) |
| Analytics | Vendor-added (SOW excludes it) — sales side from our till data, engagement via PostHog | Same, once PostHog is live | Owner setup |
| Payments | Desk only (cash/card recorded; terminal separate) | Online payment | Later phase (SOW) |
| Offline | Degraded mode: till queue + LAN KDS | Full offline local DB | Later phase (SOW) |
| Staff admin | Read-only `/admin/staff` list | Invite/role management (needs service role) | Later |

## Gotchas / open issues
- **Analytics + PostHog are OUT of the signed SOW** (scope lines 148–150, 410). They are shipped as
  a vendor addition on the owner's instruction — never let acceptance hinge on them.
- **Local test flakiness is a connection-pool symptom, not a code bug.** If DB suites fail with
  `Timed out acquiring connection from connection pool`, a dev server / Playwright session leaked
  PostgREST connections: `docker restart supabase_rest_touchpadel supabase_realtime_touchpadel`,
  then re-run (214/214 green). Don't chase it in the SQL.
- **Migration 0035 fixed a real Telegram double-send**: `claim_due_telegram` bumped `attempts` but
  left `scheduled_for`, so the pg_net nudge and the 10 s cron sweep could claim the same row twice.
  Claims now push `scheduled_for` forward with a backoff.
- **`upsert_menu_item` no longer takes a photo argument** (0027). Photos, sold-out and cost each
  have their own RPC (`set_item_photo`, `set_item_sold_out`, `set_item_cost`) so the day-1
  photo-wipe bug cannot recur.
- **Item costs live in `menu_item_costs`**, not on `menu_items` — a column grant would have leaked
  margins to guests or broken every `select *`.
- **`packages/db/supabase/buckets/menu-media/` must contain only real images.** An empty
  `.gitkeep` is seeded as `text/plain` and the bucket's mime allow-list rejects it, failing
  `supabase db reset`.
- **The hosted Supabase project is the client's future production.** Additive migrations only;
  rotate the seeded dev staff accounts/PINs and revisit the 300/hr anonymous rate limit before
  launch. Hosted currently has 0001–0026 — **0027–0035 are NOT pushed yet** (roadmap 5).
- **Vercel production menu was empty (2026-08-24, root-caused):** the dashboard env var
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` had a second line glued on, so every request 401'd.
  Fix = one clean var + redeploy **without build cache** (NEXT_PUBLIC_* is inlined at build).
  `apps/web/.env.local` still points at staging, which lacks 0027+ — pass local env inline when
  running the web app against the local stack.
- Migration numbering: **0023 intentionally unused** (0024 = push outbox). Not a lost file.
- **KDS item-level ready marks are local component state only** (whole-ticket status is real).
- Charge-to-booking: `compute_tab_totals` still does **not** add the court price to the bill —
  the "one payment" SOW promise needs that in the till drop (W3).
- **Client inputs: NONE received yet** (courts, rates, menu, recipes, domain, fonts, branding
  assets beyond PDFs). Recipes are the SOW's own #1 risk.
- **Currency**: IQD-only per owner decision — get Mustafa's written confirmation at call #1.
- **SOW promises PITR; Supabase PITR is a paid add-on** beyond the quoted "$25/mo".
- Brand PDFs at repo root are 257MB/66MB — gitignored (`/*.pdf`), local-only. The rendered cafe
  deck lives at `docs/brand/cafe/`. The two padel decks differ: **2026 governs**.
- Table-token Vault secret must be set to the same value on Touch's project at W5 handover or every
  printed QR dies.

## Running it
- `pnpm i` · `cd packages/db && pnpm exec supabase start` · `pnpm exec supabase db reset --local` ·
  `pnpm run db:fixtures` (loads through the DB container when `psql` is absent) · `pnpm run db:types`.
- `pnpm turbo lint typecheck test` — the full gate. `pnpm --filter @touch/db test` needs the local
  stack. `pnpm e2e` needs the stack plus both dev servers.
- Web against the LOCAL stack: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon from supabase status> pnpm --filter @touch/web dev`.
- Operator: `pnpm --filter @touch/operator dev` (port 5174). Edge functions:
  `cd packages/db && pnpm exec supabase functions serve --env-file supabase/functions/.env`.
