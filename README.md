# Touch Padel — Phase 1

Monorepo for the Touch Padel venue system (padel courts + cafe, Iraq): guest booking app,
public website with QR cafe ordering, and a Windows operator app (till / desk / kitchen /
stock / admin) on one Supabase Postgres. Bilingual EN/AR, full RTL. Money is integer IQD
everywhere. The signed SOW in `docs/scope/` is the contract.

## Layout

| Path                  | Package                 | What it is                                                              |
| --------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `apps/mobile`         | `@touch/mobile`         | Guest app, React Native + Expo (padel booking only)                     |
| `apps/web`            | `@touch/web`            | Public site + cafe QR ordering, Next.js on Vercel                       |
| `apps/operator`       | `@touch/operator`       | Operator SPA (till, calendar, KDS, stock, admin), Vite + React          |
| `apps/operator-shell` | `@touch/operator-shell` | Electron shell: SQLite queue, LAN KDS, ESC/POS printing, auto-update    |
| `packages/db`         | `@touch/db`             | Supabase migrations, generated types, seeds, DB tests and safety checks |
| `packages/core`       | `@touch/core`           | Shared domain logic (money, splits, idempotency, time)                  |
| `packages/ui`         | `@touch/ui`             | Shared UI tokens/components (logical properties only)                   |
| `packages/i18n`       | `@touch/i18n`           | EN/AR messages and locale utilities                                     |
| `packages/config`     | `@touch/config`         | Shared tsconfig/eslint/prettier presets                                 |

## Quickstart

Prereqs: Node 22+, pnpm 9 (`corepack enable` picks up the pinned version), Docker Desktop
(for local Supabase). Windows setup details are in `CONTRIBUTING.md`.

```sh
pnpm i
pnpm db:start                    # local Supabase via Docker
pnpm db:reset                    # apply migrations + seed fixtures
pnpm dev                         # turbo dev for everything
pnpm --filter @touch/web dev     # or a single app
pnpm turbo lint typecheck test
pnpm e2e:install && pnpm e2e     # optional: Playwright browser tests
```

## Environment

Each app reads its own env file. Copy the example, fill in values, never commit the result
(`.gitignore` blocks every `.env*` except `.env.example`).

| Example                      | Copy to                    | Read by                        |
| ---------------------------- | -------------------------- | ------------------------------ |
| `apps/web/.env.example`      | `apps/web/.env.local`      | Next.js (`NEXT_PUBLIC_*`)      |
| `apps/mobile/.env.example`   | `apps/mobile/.env`         | Expo (`EXPO_PUBLIC_*`)         |
| `apps/operator/.env.example` | `apps/operator/.env.local` | Vite (`VITE_*`)                |
| `packages/db/.env.example`   | `packages/db/.env`         | dotenv in DB tests and scripts |

`NEXT_PUBLIC_`, `EXPO_PUBLIC_` and `VITE_` values are inlined into shipped client bundles,
so nothing secret may sit behind those names. `pnpm security:env-names` enforces this in CI.
The service-role key lives only in `packages/db/.env` and GitHub Environment secrets.

## Scripts (repo root)

| Group    | Scripts                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Turbo    | `build`, `dev`, `lint`, `typecheck`, `test`                                                                                                                              |
| Database | `db:start`, `db:stop`, `db:reset`, `db:types`, `db:fixtures`, `db:clear-dev-till`                                                                                        |
| Quality  | `format`, `fonts:sync`, `fonts:check`, `e2e`, `e2e:install`                                                                                                              |
| Security | `security` runs every Docker-free CI secrets gate in one go; or `security:env-names`, `security:history`, `security:audit`, `security:data`, `security:web` individually |

Run `supabase` CLI commands from `packages/db`, not the repo root. Never run `eas` or `expo`
from the root either; the real config lives in `apps/mobile/`.

## CI and release

Workflows live in `.github/workflows/`:

- `ci.yml` runs on every PR and push to main: secret and hygiene gates, lint/typecheck/test/build,
  an Electron ABI smoke on Windows, an Expo bundle check, and a clean local Supabase run with
  migration, RLS, lock-order and concurrency tests.
- `db-drift.yml` diffs the hosted project against the migration head nightly (02:00 Baghdad).
- `db-migrate.yml` pushes migrations to staging on `workflow_dispatch` or when a main push touches
  `packages/db/supabase/migrations/**`, behind the `staging` GitHub Environment.
- `operator-release.yml` builds and signs the Electron installer on `operator-v*` tags and publishes
  it to the public `KaguSoftware/touchpadel-releases` repo.

## Conventions

- Schema changes are migrations only. No Supabase dashboard edits.
- Writes go through RPCs; row-level security is the backstop, not the interface.
- Bilingual columns come in `_en` / `_ar` pairs.
- Money is integer IQD. No floats, no currency conversion in the client.
- CSS uses logical properties (`margin-inline-start`, not `margin-left`) so RTL is free.
- Commits are authored by the human doing the work, with no AI co-author trailers (see `CLAUDE.md`).

`HANDOFF.md` holds the full set, plus the current state and known gotchas.

## Read next

- `HANDOFF.md` — current state, conventions, gotchas. Read first in any new session.
- `CONTRIBUTING.md` — workflow rules and Windows setup.
- `docs/install-runbook.md` — on-site install steps for the operator machine.
- `docs/design/` — architecture, canonical data model, delivery plan.
- `docs/security/` — security layer decisions and runbooks.
- `docs/client/` — client-facing input pack (checklists, CSV templates).
- `docs/brand/lama-sans/README.md` — the brand family: what ships, what was cut, adding a weight.
