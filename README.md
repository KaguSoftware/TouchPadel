# Touch Padel

The venue system for Touch Padel, a padel club with a cafe in Iraq: a guest booking app, a
public website with QR cafe ordering, and a Windows operator app for the staff (till, court
desk, kitchen screen, stock, admin), all on one Supabase Postgres. Bilingual EN/AR with full
RTL. Money is integer IQD everywhere. The signed SOW in `docs/scope/` is the contract.

Live site: **https://www.touch-padel.com** (the bare `touch-padel.com` redirects there). It
is also the address printed on the table QR cards and linked from the app's privacy and
support pages.

## The system at a glance

```
  Guests                                   Staff (at the venue)
  ──────                                   ────────────────────
  Mobile app          Website              Operator app (Windows)
  apps/mobile         apps/web             apps/operator  inside  apps/operator-shell
  Expo / RN           Next.js, Vercel      Vite + React SPA       Electron: offline queue,
  book courts         menu, QR table       till · desk · KDS ·    LAN kitchen screen,
                      ordering             stock · admin ·        receipt printing,
                                           reports · assistant    auto-update
       │                   │                      │                    │
       └───────────────────┴──────────┬───────────┴────────────────────┘
                                      ▼
                        Supabase (packages/db)
                        Postgres: tables + RLS + app.* RPCs   ← every business write
                        Realtime: broadcast topics            → screens refresh
                        Edge functions: replay, SMS/OTP, push,
                        Telegram, AI assistant, analytics
```

How it hangs together:

- **Writes are RPCs.** Every business write (open a tab, settle, book, void) is an `app.*`
  Postgres function. It checks the role, validates, and writes in one transaction. Row-level
  security is the backstop, not the interface. Clients may read tables directly.
- **The server owns the numbers.** Totals, tax, court fees and prices are computed in SQL.
  The apps show a mirror of those figures for speed, and the server re-stamps them when it
  writes.
- **The till survives the internet going down.** In Electron, writes go to a durable SQLite
  queue with idempotency keys. The `replay` edge function applies them in order on reconnect.
  A write that is only queued is shown as "saved on this station", never as done.
- **Screens stay live through broadcast.** Tables publish on topics (`courts`, `floor`,
  `kds`, `menu`). A screen subscribes, treats each message as a signal to refetch, and polls as
  a safety net.
- **Time is venue time.** The venue trades 09:00 → 02:00 in `Asia/Baghdad`, so the
  00:00–02:00 tail belongs to the night before. Dates come from the venue's timezone and
  business day, never from the station's clock.

## Project tree

```
apps/
  mobile/            Guest app (Expo Router). app/ = screens, src/features = booking, auth, profile
  web/               Public site (www.touch-padel.com). app/[locale]/ = home, download, support,
                     t/ (QR table ordering)
  operator/          Staff SPA
    src/features/    one folder per area: till, desk, kds, floor, stock, admin, reports,
                     analytics, assistant, observation, financial, …
    src/lib/         the plumbing every screen uses: appRpc, mutate (offline queue), realtime,
                     auth + roles, query keys, edge calls
    src/components/  kit.tsx / ui.tsx: the shared UI primitives (Modal, fields, tables)
    src/routes/      route tree and role gates
  operator-shell/    Electron main process: queue.ts + sync-worker.ts (offline writes),
                     lan-kds-* (kitchen screen over LAN), print/ (ESC/POS), updater.ts
packages/
  db/                Everything database
    supabase/migrations/   the schema, numbered 0001… (the only way the schema changes)
    supabase/functions/    edge functions (Deno)
    src/types.gen.ts       generated TypeScript types for the schema
    tests/                 RLS, RPC and concurrency tests against a local Supabase
    fixtures/ seeds/       dev data, and the assistant's generated page map
  core/              Pure domain logic shared by all apps: money, pricing, availability,
                     time zones, phone numbers, mutation schemas
  i18n/              EN/AR catalogs (catalogs/ws/<lane>.en.ts + .ar.ts), formatting, RTL helpers
  ui/                Design tokens and theme (colours as var(--tp-*))
  config/            Shared tsconfig / eslint / prettier presets
e2e/                 Playwright journeys (operator + web, EN and AR)
docs/                Scope (SOW), design and architecture, security, runbooks, brand
scripts/             One-off admin and security scripts
```

Each app and `packages/db` has its own `CLAUDE.md` with the rules for working in it. Read the
one for the package you are changing.

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

The operator-shell tests need `better-sqlite3` built for Node. If about 47 shell tests fail
with a `NODE_MODULE_VERSION` error, run `pnpm --filter @touch/operator-shell native:node`.

## Environment

Each app reads its own env file. Copy the example, fill in values, never commit the result
(`.gitignore` blocks every `.env*` except `.env.example`).

| Example | Copy to | Read by |
|---|---|---|
| `apps/web/.env.example` | `apps/web/.env.local` | Next.js (`NEXT_PUBLIC_*`) |
| `apps/mobile/.env.example` | `apps/mobile/.env` | Expo (`EXPO_PUBLIC_*`) |
| `apps/operator/.env.example` | `apps/operator/.env.local` | Vite (`VITE_*`) |
| `packages/db/.env.example` | `packages/db/.env` | dotenv in DB tests and scripts |

`NEXT_PUBLIC_`, `EXPO_PUBLIC_` and `VITE_` values are inlined into shipped client bundles,
so nothing secret may sit behind those names. `pnpm security:env-names` enforces this in CI.
The service-role key lives only in `packages/db/.env` and GitHub Environment secrets.

## Scripts (repo root)

| Group | Scripts |
|---|---|
| Turbo | `build`, `dev`, `lint`, `typecheck`, `test` |
| Database | `db:start`, `db:stop`, `db:reset`, `db:types`, `db:fixtures`, `db:clear-dev-till` |
| Quality | `format`, `fonts:sync`, `fonts:check`, `e2e`, `e2e:install` |
| Security | `security` runs every Docker-free CI secrets gate in one go; or `security:env-names`, `security:history`, `security:audit`, `security:data`, `security:web` individually |

Run `supabase` CLI commands from `packages/db`, not the repo root. Never run `eas` or `expo`
from the root either; the real config lives in `apps/mobile/`. Don't run `pnpm format` across
the whole repo; format only the files you touched.

## CI and release

Workflows live in `.github/workflows/`:

- `ci.yml` runs on every PR and push to main: secret and hygiene gates, lint/typecheck/test/build,
  an Electron ABI smoke on Windows, an Expo bundle check, a clean local Supabase run with
  migration, RLS, lock-order and concurrency tests, and the Playwright suite.
- `db-drift.yml` diffs the hosted project against the migration head nightly (02:00 Baghdad).
- `db-migrate.yml` pushes migrations to staging on `workflow_dispatch` or when a main push touches
  `packages/db/supabase/migrations/**`, behind the `staging` GitHub Environment.
- `operator-release.yml` builds and signs the Electron installer on `operator-v*` tags and publishes
  it to the public `KaguSoftware/touchpadel-releases` repo.

Every push to `main` is also a Vercel production build of the website. Commit as often as you
like, but push in batches.

## Conventions

- Schema changes are migrations only. No Supabase dashboard edits.
- Writes go through RPCs; row-level security is the backstop, not the interface.
- Bilingual columns come in `_en` / `_ar` pairs; UI strings come in `.en.ts` / `.ar.ts` pairs.
- Money is integer IQD. No floats, no currency conversion in the client.
- CSS uses logical properties (`margin-inline-start`, not `margin-left`) so RTL is free.
- Commits are authored by the human doing the work, with no AI co-author trailers (see `CLAUDE.md`).

`HANDOFF.md` holds the full set, plus the current state and known gotchas.

## Read next

- `HANDOFF.md`: current state, conventions and gotchas. Read it first in any new session.
- `CONTRIBUTING.md`: workflow rules and Windows setup.
- `API.md`: the RPC and edge-function surface.
- `docs/design/`: architecture, the canonical data model and the delivery plan.
- `docs/security/`: security-layer decisions and runbooks.
- `docs/install-runbook.md`: on-site install steps for the operator machine.
- `docs/client/`: the client-facing input pack (checklists, CSV templates).
- `docs/brand/lama-sans/README.md`: the brand typeface — what ships, what was cut, and how to
  add a weight.
