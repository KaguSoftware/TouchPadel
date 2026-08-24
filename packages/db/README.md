# @touch/db

Schema-first database package for Touch Padel Phase 1. **The only source of schema truth
is `supabase/migrations/`** — no dashboard edits, ever. Canonical design:
`docs/design/design-data.md` (19-migration plan; this package currently ships Drop 1,
migrations 0001–0008).

## Layout

```
supabase/config.toml         local stack config (anonymous sign-ins ON; pg_cron required)
supabase/migrations/         20260824000001..08 — extensions, enums/domains, app schema,
                             profiles/staff/PINs, audit_log, settings/tax, courts/rates,
                             reservations (exclusion constraint + booking RPCs)
supabase/seed.sql            environment-invariant reference data (settings, tax groups,
                             allergens, one dev staff account per role)
fixtures/courts.sql          REPLACEABLE fixture business data (4 courts + rate rules)
src/index.ts                 package entry; idempotency-key/client-ref helpers
src/types.gen.ts             generated types (placeholder until Docker runs)
tests/concurrency.test.ts    CONTRACTUAL booking concurrency suite (§6.1 cases 1–7)
tests/rls-matrix.ts          declarative role matrix (the written role-test deliverable)
tests/rls-matrix.test.ts     matrix runner over 8 real principals
```

## Commands

Devs run the Supabase CLI via the workspace devDependency (no global install).
Docker Desktop + WSL2 required.

```sh
pnpm --filter @touch/db db:start      # supabase start
pnpm --filter @touch/db db:reset      # migrations + seed.sql
pnpm --filter @touch/db db:types      # regenerate src/types.gen.ts (COMMIT the result)
pnpm --filter @touch/db db:fixtures   # apply fixtures/ via psql (dev/staging only)
pnpm --filter @touch/db test          # vitest (skips itself if the stack is down)
pnpm --filter @touch/db test:concurrency
```

`db:fixtures` shells out to `psql` against `postgresql://postgres:postgres@127.0.0.1:54322/postgres`;
if `psql` is not on PATH, `supabase db reset` then paste `fixtures/courts.sql` into
Studio's SQL editor (local only) or run it through any Postgres client.

### Dev credentials (local/staging only)

Seeded by `seed.sql` — password `touch-dev-password` for all:
`owner@dev.touch.local` (PIN 111111), `manager@dev.touch.local` (PIN 222222),
`cashier@dev.touch.local`, `prep@dev.touch.local`, `desk@dev.touch.local` (court_desk).

## Fixture swap procedure (client data lands → week 5 or earlier)

Fixture rows are **clearly marked**: every fixture UUID starts with the reserved prefix
`f1f7` and lives only in `fixtures/*.sql`. Nothing outside `fixtures/` may reference an
`f1f7` UUID — that is the hard swap point.

1. On **staging first**: delete fixture domains in dependency order (children before
   parents), e.g. for courts:
   `delete from rate_rule_prices where rule_id::text like 'f1f7%';`
   `delete from rate_rules where id::text like 'f1f7%';`
   `delete from courts where id::text like 'f1f7%';`
   (refuse the swap if any live reservation references a fixture court — resolve those first).
2. Run the client-data import scripts (`scripts/import-courts.ts`, `import-menu.ts`,
   `import-recipes.ts` — land with Drops 2/3; CSV templates are the ones issued to Touch
   in week 1/2).
3. Re-run the test suites against staging; then repeat on production.

Never hand-enter client data; the swap is only ever seed/import scripts.

## Link-later procedure (Touch's Supabase project, week 5)

Nothing in any migration references a project ref, storage URL, or environment, so:

```sh
supabase link --project-ref <touch-prod-ref>
supabase db push                      # applies all migrations in order
# then apply seed-equivalent PROD baseline: venue_settings values, tax groups,
# real staff accounts via the Auth admin API (NOT seed.sql's dev users), owner sets
# PINs via app.set_staff_pin.
```

**Vault secret (critical):** the table-QR HMAC secret `table_token_secret`
(created with migration 0010) must be set in Touch's project **Vault** to the same value
as staging at handover, or every printed QR dies. Enable **pg_cron** on the hosted
project before pushing 0017. Rotate JWT secret → re-issue table tokens (budgeted W5).

## Tests

- `tests/concurrency.test.ts` — the contractual acceptance suite (design-data.md §6.1
  cases 1–7): 20-way hold races, hold-vs-desk, adjacent half-open ranges, expired-hold
  contention, confirm-vs-expire, extend-vs-create, maintenance-vs-booking, plus
  idempotency-key replay at the reservations layer. Cases 8 (sync replay) and 9 (FEFO)
  land with Drops 2/3.
- `tests/rls-matrix.ts` — declarative `{surface} × {operation} × {principal}` matrix
  covering the Drop-1 surface for 8 principals; later drops **append** entries (tagged
  `drop: 2|3`) without restructuring. Exportable to markdown for client sign-off.

Both suites read `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
(defaulting to `supabase start` local values) and skip cleanly when no stack is up.

## Resolved overrides (win over design-data.md where they disagree)

1. Even splits = exact integer **largest-remainder** (`packages/core`); no 250-IQD
   rounding — `venue_settings.cash_rounding_iqd` defaults to **1** (off).
2. Idempotency keys `"{station}:{mutation_type}:{ulid}"`; client refs `"{station}-{ulid}"`
   (reservations carry both `idempotency_key` and `client_ref` columns).
3. Reservation kinds: `booking | hold | maintenance`.
4. Realtime = broadcast-from-database on `kds` / `session:{id}` / `courts` / `floor` /
   `menu` (migration 0018).
5. Heartbeat: till POSTs every 10s; stale threshold `heartbeat_stale_seconds` (45);
   degraded enforcement is INLINE in guest write RPCs (`app.is_degraded()` is a stub
   returning false until 0017 — the call sites are already wired).
6. PIN: online server-side `crypt()` check; no per-staff HMAC pin-proof machinery.
7. Cut: cash-drawer kick, auto-update scheduling machinery, >1-level sub-recipe nesting
   (cycle guard stays), 250-rounding default.
