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

## Edge functions (`supabase/functions/`)

`send-push` (outbox sender for Expo notifications, migration 0024) and `replay`
(idempotent replay endpoint for the till's durable queue, design-arch §2.2), plus
`_shared/` helpers. Nothing here runs at build time — deploy explicitly:

```sh
cd packages/db
pnpm exec supabase functions deploy send-push replay   # hosted (linked project)
pnpm exec supabase functions serve                     # local, against supabase start
```

Secrets: both functions use only the platform-injected `SUPABASE_URL` /
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — no `supabase secrets set` needed.

### Cron for send-push

The sender is pull-based: nothing sends until something invokes it. Schedule it
every minute (Dashboard → Integrations → Cron, or SQL with pg_cron + pg_net):

```sql
select cron.schedule('send-push-outbox', '* * * * *', $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'service_role_key')),
    body    := '{}'::jsonb)
$$);
```

Store the service-role key in Vault as `service_role_key` first (never inline it
in cron SQL — `cron.job` is readable). The function rejects any caller that is
not the service role, retries failed rows each run, caps at 5 attempts, and
clears dead Expo tokens (`DeviceNotRegistered`) from `profiles`.

### Replay endpoint

`POST /functions/v1/replay` with a **staff session JWT** and body
`{ idempotency_key, mutation_type, payload, station_id, staff_id }`.
Duplicate key → stored result, 200. Exclusion conflict → 409 + `sync_replays`
conflict row + `manager_alerts('replay_conflict')`. The mutation_type → RPC map
in `functions/replay/index.ts` mirrors `packages/core/src/schemas/mutations.ts`
— extend both together. Drop-2/3 entries are name-mapped ahead of their
migrations and return 501 `RPC_NOT_DEPLOYED` until those RPCs land.

## QR artwork (`scripts/qr-artwork.mjs`)

Print-ready A6 SVG card per active `cafe_table` (Touch Cafe branding, huge table
number, QR of `${SITE_URL}/t/<token>` signed by `app.generate_table_token`):

```sh
# needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ SITE_URL for real prints)
pnpm --filter @touch/db qr:artwork      # writes packages/db/artwork/table-*.svg
```

`artwork/` is generated output — keep it gitignored. Token rotation
(`cafe_tables.token_version` bump) invalidates printed cards: re-run + reprint.

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

### Analytics functions (`analytics-posthog`, `analytics-insights`)

Owner-only proxies (staff JWT, `role = 'owner'`, `_shared/auth.ts requireStaffRole`)
so the PostHog personal key and the Groq key never reach the operator. Both are
stateless: the operator gathers `app.analytics_*` data, posts it, and persists
results itself through `save_analytics_insights` / `save_analytics_patterns`.
Errors follow `apps/operator/src/lib/edge.ts statusToEdgeCode`: 401 `AUTH_REQUIRED`,
403 `FORBIDDEN`, 400 `INVALID_REQUEST`, 502 `{error:'UPSTREAM'}`.

**`POST /functions/v1/analytics-posthog`** — batch of named HogQL templates (the
client never sends HogQL):

```jsonc
{ "queries": [{ "name": "daily_engagement", "from": "2026-08-01", "to": "2026-08-25", "params": { "limit": 80 } }],
  "business_day_start_hour": 4 }
// -> { configured: true, floor: "2026-08-01" | null, results: { daily_engagement: { columns: [...], rows: [[...]] } } }
```

Names: `ping, daily_engagement, top_viewed_items, top_carted_items, abandoned_by_dwell,
funnel, basket_to_call, locale_split, table_activity, week_heatmap, peak_hours,
promo_engagement, item_views_with_price, session_stats, category_popularity,
locale_preferences`. Dates are business days (`Asia/Baghdad` shifted back by
`business_day_start_hour`); span ≤ 400 days; only `params.limit` is accepted.
Without `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` the answer is
`200 {configured:false, floor:null, results:{}}`. 30 s in-memory cache per
`(name, from, to, hour, params)`, 3 attempts on 5xx, per-query failures come back
as `{columns:[], rows:[], error}` without failing the batch.

**`POST /functions/v1/analytics-insights`** — Groq findings / pattern judge:

```jsonc
{ "mode": "insights" | "patterns" | "revalidate" | "replace_rejected", "lang": "ar" | "en",
  "range_from": "2026-08-01", "range_to": "2026-08-25", "compare_basis": "prev" | "4w" | "52w",
  "data": { "kpis": {}, "daily": [], "best_sellers": [], "margins": {}, "bought_together": [],
            "price_bands": [], "promo": {}, "engagement": {}, "prior_insights": [], "rejections": [],
            "patterns": [], "basis": { "salesDays": 20, "weekdayCounts": [] }, "excluded_names": [] } }
// -> { degraded: false, model: "openai/gpt-oss-120b",
//      insights: [{ text, kind, subjects, metrics, confidence, status }], resolved?: [], patterns?: [] }
```

`data.*` are the raw jsonb results of the 0034 RPCs. Post-model gates reuse
`_shared/insightsText.ts` (a byte copy of `packages/core/src/analytics/insightsText.ts`,
guarded by `tests/insights-text-parity.test.ts`): owner rejections via
`normalizeFinding` (twin of `app.normalize_finding`), thin-sample claims when
`data.basis` is given, excluded-item mentions, then ranked by money cited and
capped at 8. Without `GROQ_API_KEY` → `200 {degraded:true, model:null}` with
templated sentences (best seller, thinnest-margin costed item, top pair, promo,
busiest day); `patterns` mode then phrases `data.patterns[].fallbackText`.
Groq 429 / 5xx / 25 s budget → `502 {error:'UPSTREAM'}`.

Secrets (`pnpm exec supabase secrets set …`; template in `supabase/functions/.env.example`):

| Secret | Function | Default |
|---|---|---|
| `POSTHOG_PERSONAL_API_KEY` | analytics-posthog | unset → `configured:false` |
| `POSTHOG_PROJECT_ID` | analytics-posthog | unset → `configured:false` |
| `POSTHOG_HOST` | analytics-posthog | `https://eu.posthog.com` |
| `POSTHOG_ENGAGEMENT_FLOOR` | analytics-posthog | unset (no clipping) |
| `GROQ_API_KEY` | analytics-insights | unset → `degraded:true` |
| `GROQ_MODEL` | analytics-insights | `openai/gpt-oss-120b` |
| `GROQ_JUDGE_MODEL` | analytics-insights | `llama-3.1-8b-instant` |

Local smoke test:

```sh
pnpm exec supabase functions serve --env-file supabase/functions/.env.example
curl -s -X POST http://127.0.0.1:54321/functions/v1/analytics-posthog -d '{}'   # 401 without a JWT
curl -s -X POST http://127.0.0.1:54321/functions/v1/analytics-posthog \
  -H "Authorization: Bearer <owner JWT>" -H "Content-Type: application/json" \
  -d '{"queries":[{"name":"ping","from":"2026-08-01","to":"2026-08-25"}]}'      # {configured:false,...}
```

### Telegram functions (`telegram-send`, `telegram-callback`)

Staff-group notifications for guest orders and waiter calls (migration 0032):
`create_guest_order` / `raise_waiter_call` / `telegram_send_test` enqueue a render
snapshot into `telegram_outbox`; the sender posts it with inline buttons; taps come
back through the webhook and drive the KDS via `app.telegram_apply_action`. Owner
setup walkthrough: `supabase/functions/SETUP-telegram.md`. Pure rendering lives in
`_shared/telegram.ts` (templates unit-tested by `tests/telegram-render.test.ts`).

| Function | Auth | Does |
|---|---|---|
| `POST /functions/v1/telegram-send` | service-role key (`verify_jwt = true`); called by `app.telegram_nudge` (pg_net) and cron | `app.claim_due_telegram(50)` → `sendMessage` (HTML + keyboard) → stamps `sent` / `queued`+`scheduled_for` (429 `retry_after`, transient backoff `min(5s·2^attempts, 5min)`) / `failed` (other 4xx, or attempts ≥ 8) / `skipped` (`NOT_CONFIGURED` when the token is unset). Returns `{configured, claimed, sent, failed, skipped}`. |
| `POST /functions/v1/telegram-callback` | `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET` (`verify_jwt = false`; unset → 401) | `callback_query` → `app.telegram_apply_action` → `answerCallbackQuery` toast → `editMessageText` (original outbox `text` + status footer, reduced keyboard) → stamps `cafe_settings.telegram_last_callback_at`. Always HTTP 200 (`{ok:false}` on internal errors) so Telegram never re-delivers. |

Secrets (`pnpm exec supabase secrets set …`; template in `supabase/functions/.env.example`):

| Secret | Function | Default |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | telegram-send, telegram-callback | unset → rows `skipped`, `{configured:false}` |
| `TELEGRAM_WEBHOOK_SECRET` | telegram-callback | unset → every webhook call is 401 |

Cron / Vault: migration 0032 schedules `tp_telegram_sweep` (pg_cron, every 10 s;
per-minute on pg_cron < 1.5) which calls `app.telegram_nudge()`; the nudge POSTs to
the sender only when a due row exists, using two Vault secrets you create once —
`service_role_key` (the service-role JWT) and `functions_base_url`
(`https://<ref>.supabase.co/functions/v1`). Without them only the sweep runs and
no HTTP is issued, so messages wait in the outbox; without `pg_net` the same. The
chat id, enable flag and language (`telegram_chat_id`, `telegram_enabled`,
`telegram_lang`) are `cafe_settings` keys written by the owner from the operator app.
