# Touch Padel — Phase 1

Monorepo for the Touch Padel venue system (padel courts + cafe, Iraq): guest booking app,
public website with QR cafe ordering, and a Windows operator app (till / desk / kitchen /
stock / admin) on one Supabase Postgres. Bilingual EN/AR, full RTL. Money is integer IQD
everywhere. The signed SOW in `docs/scope/` is the contract.

## Layout

| Path | Package | What it is |
|---|---|---|
| `apps/mobile` | — | Guest app, React Native + Expo (padel booking only) |
| `apps/web` | — | Public site + cafe QR ordering, Next.js on Vercel |
| `apps/operator` | — | Operator SPA (till, calendar, KDS, stock, admin), Vite + React |
| `apps/operator-shell` | — | Electron shell: SQLite queue, LAN KDS, ESC/POS printing |
| `packages/db` | `@touch/db` | Supabase migrations, generated types, seeds, DB tests |
| `packages/core` | `@touch/core` | Shared domain logic (money, splits, idempotency, time) |
| `packages/ui` | `@touch/ui` | Shared UI tokens/components (logical properties only) |
| `packages/i18n` | `@touch/i18n` | EN/AR messages and locale utilities |
| `packages/config` | `@touch/config` | Shared tsconfig/eslint/prettier presets |

## Quickstart

Prereqs: Node 20+, pnpm 9, Docker Desktop (for local Supabase).

```sh
pnpm i
pnpm db:start     # local Supabase via Docker
pnpm db:reset     # apply migrations + seed fixtures
pnpm dev          # turbo dev (or filter: pnpm --filter <app> dev)
pnpm turbo lint typecheck test
```

## Read next

- `HANDOFF.md` — current state, conventions, gotchas. Read first in any new session.
- `CONTRIBUTING.md` — workflow rules.
- `docs/design/` — architecture, canonical data model, delivery plan.
- `docs/client/` — client-facing input pack (checklists, CSV templates).
