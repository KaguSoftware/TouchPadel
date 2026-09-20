# Owner assistant — build contracts between lanes (2026-09-20)

Companion to `owner-assistant-plan-2026-09-20.md`. The plan says what; this
says the exact shapes each lane produces and consumes so four people can build
in parallel without meeting. Every contract here is binding until someone edits
this file.

## Decisions taken (the plan's DECIDE list, recommended options unless noted)

| # | Decision |
|---|---|
| 1 | Prices live in the database: `venue_settings.llm_pricing jsonb` keyed by model, four rates in USD micros per million tokens. `llm_cost_micros_per_mtok` stays as the fallback. |
| 2 | No `sql_read` in v1. |
| 3 | Embedding seam with providers `voyage`, `openai`, `local`, `none`. **Owner call 2026-09-20: `local`** — Supabase's built-in gte-small (384 dims zero-padded to 1024; English; Arabic queries fall back to the full-text half of the fused ranking). Verified in the edge runtime: transformers.js cannot register an ONNX backend there (npm and web builds both fail) and `Supabase.ai.Session` accepts no other model name, so a multilingual model (reference: `intfloat/multilingual-e5-small`, the smallest strong Arabic-capable open model) is not integratable until Supabase ships it or the indexer moves off the edge. The runtime bills ~60 ms CPU per text against a 2 s budget, so a request embeds at most 8 texts (`LOCAL_MAX_TEXTS`) and the map's 2,532 vectors are precomputed by `scripts/assistant-index-map.mjs` with the same model in Node (cosine 1.0000 against the runtime's vector) and posted with the chunks. |
| 4 | **Owner call 2026-09-20, later the same day: the free Groq tier for a short period** (migration 0116: `openai/gpt-oss-120b` priced at Groq's list rates and set as the venue default; `functions/_shared/assistant/providerGroq.ts` + `groqWire.ts` behind the same `Provider` interface; the vendor follows the model id — `claude-*` → Anthropic with `ANTHROPIC_API_KEY`, anything else → Groq with `GROQ_API_KEY`). On Groq: no batch jobs, token counts are prompt/completion only (Groq's automatic prefix cache is reported as cache reads), the compact map stays out of the prompt (8k-token per-request budget on the free tier) and only the scoped tools are sent. Live findings on the free tier (2026-09-20 evening): the per-request budget is 8k tokens, so the first turn keeps context packs under `packBudget` (1,500 estimated tokens, smallest first; the courts pack alone is ~8k and had made one request 20k); Groq's 429 hint can read "try again in 30ms" while the minute is still full, so the adapter waits at least 3 s and retries up to three times; gpt-oss-120b tended to answer where-is questions with "context is off" although no tool refused, so the chat retries once through the operator channel with the search results attached (`FALSE_REFUSAL_RE` in assistant-chat); the built-in embedding session is created once per worker (a new session per `search` cost ~5.8 s each). **Moving back is two lines**: set `ANTHROPIC_API_KEY` and `select app.assistant_set_default_model('claude-opus-5')` (or the usage page). Before that: the owner chooses Opus 5 or Sonnet 5 per chat, with a venue default (migration 0114: `assistant_conversations.model`, `venue_settings.llm_default_model`, RPCs `assistant_models` / `assistant_set_model` / `assistant_set_default_model`; a model must have rates in `llm_pricing`). `ANTHROPIC_MODEL` is only the fallback when nothing is set; adaptive thinking, effort `medium`, streaming, 1 h cache TTL on the frozen prefix, server-side `fallbacks: "default"`. The insights card stays on Groq for now. |
| 5 | Owner-only. |
| 6 | Phones and emails pseudonymised before any vendor; names allowed; audit `before`/`after` summarised to changed keys. |
| 7 | Conversations kept, archive via RPC. |
| 8 | Batch mode offered for jobs. v1 ships the estimate for both modes, runs `live` jobs, and submits `batch` jobs (poll on a cron tick). |
| 9 | Design docs indexed (`docs/**`, excludable by name in the coverage fixture). |
| 10 | Re-check button on an answer: **built** (`POST assistant-chat {recheck:{message_id}}` re-runs the stored tool calls as the owner with no model and no tokens; `gate.numbers` is the baseline; `_shared/assistant/recheck.ts` diffs). |
| 11 | Terse answers by default; "explain" is a follow-up. |
| 12–13 | Analytics components and pinning (§2.8, §4.4, §5.4): **built** (migration 0115, `assistant-component` function, six built-ins on both analytics tabs, nightly pre-warm at 03:30 venue time, `Pin to Analytics` on chat answers). |
| 14 | Default scopes: `howto` only. |

## Shared module

`packages/core/src/assistant/tools.ts` is the catalog. `packages/db/supabase/functions/_shared/assistant/tools.ts` must be a byte-identical copy (a parity test in `packages/db/tests/assistant-catalog.test.ts` reads both). Lane C copies it; nobody else edits either copy without editing both.

Names in the catalog: `ASSISTANT_TOOLS`, `ASSISTANT_SCOPES`, `ASSISTANT_PRESETS`, `DEFAULT_SCOPES`, `SCOPE_CHUNK_KINDS`, `scopeForRoute`, `toolsForScopes`, `isToolAllowed`, `toolInputSchema`, `wireTools`, `validateToolInput`, `rpcArgs`, `DISPATCHED_RPCS`, `COUNTABLE_TOOL_NAMES`, `LIST_ROW_CAP` (500), `MAX_TOOL_ROUNDS` (8).

## Lane A · database (migrations 0108–0112)

Files: `packages/db/supabase/migrations/2026092000010{8..12}_*.sql`, `packages/db/tests/assistant-*.test.ts`, `packages/db/fixtures/rpc-allowlist.json` (add every newly GRANTed function under `guarded` with an owner reason).

Conventions every migration follows (read two recent ones first, e.g. 0105 and 0079): header comment naming the plan section; `set lock_timeout = '3s'; set statement_timeout = '60s';`; `security definer set search_path = public`; guards raise `FORBIDDEN` with `errcode = 'P0001'`; `revoke all … from public, anon, authenticated` then grant exactly what is client-callable; `comment on` every table, column and function (the map generator reads them); new views `with (security_invoker = on)`; no `create index` without a stated reason (the migration gate flags plain `create index` on a fresh table as acceptable only when the table is new and empty — say so in a comment).

### 0108 tables

```
assistant_conversations (id uuid pk default gen_random_uuid(), owner_id uuid not null references staff(id),
  title text, scopes text[] not null default '{howto}', range jsonb, handles jsonb not null default '{}',
  tokens jsonb not null default '{}', created_at timestamptz default now(), updated_at, archived_at)
assistant_messages (id uuid pk, conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  seq int not null, role text not null check (role in ('user','assistant')), content jsonb not null,
  sources jsonb not null default '[]', gate jsonb, tokens jsonb not null default '{}', created_at,
  unique (conversation_id, seq))
assistant_calls (id bigint generated always as identity pk, message_id uuid not null references assistant_messages(id) on delete cascade,
  call_no int not null, model text not null, input_tokens bigint default 0, cache_write_tokens bigint default 0,
  cache_read_tokens bigint default 0, output_tokens bigint default 0, cost_micros bigint default 0, ms int, stop_reason text, created_at)
assistant_jobs (id uuid pk, conversation_id uuid, message_id uuid, status text check (status in
  ('estimated','accepted','running','reducing','done','failed','cancelled','over_estimate')),
  plan jsonb not null, estimate jsonb not null, mode text check (mode in ('live','batch')),
  chunks_total int, chunks_done int default 0, tokens jsonb default '{}', result jsonb, error text, batch_id text,
  created_at, started_at, finished_at)
```

`handles` on the conversation: `{ "r1": "<uuid>", "c2": "<uuid>", ... }` plus `"_next": { "r": 2, "c": 3 }` — the edge function owns the format; the DB stores it.

RLS: `enable row level security` on all four; `select` and `insert` for `app.is_staff('owner')`; `update` on `assistant_conversations` for the owner (title, scopes, range, handles, tokens, updated_at) — the UI updates scopes directly; no `update`/`delete` on messages and calls; jobs written by service role only (edge) and read by owner. Grant `select, insert` (and `update` on conversations) on the tables to `authenticated`.

RPCs (granted to authenticated, owner-guarded): `app.assistant_archive_conversation(p_id uuid)`; `app.assistant_set_scopes(p_id uuid, p_scopes text[], p_range jsonb)` (validates scopes against the list in §Scopes below, returns the row); both audit nothing (assistant tables are not business ledgers).

Realtime: add `assistant_jobs` and `assistant_calls` to `supabase_realtime` publication if the repo uses postgres_changes anywhere; otherwise skip and note it (the UI polls at 2 s while a job runs).

### 0109 dispatcher, count, list RPCs, readable columns

`app.assistant_readable_columns (table_name text, column_name text, kind text check (kind in ('table','view')), is_default boolean not null default true, note text, primary key (table_name, column_name))`. Seeded in the migration from `information_schema.columns` for every table and view in `public` EXCEPT: columns named `pin_hash`, `expo_push_token`, anything matching `%token%`, `%secret%`, `password%`, `%_hash`; the tables `assistant_*` are included; `llm_usage` included. `is_default = false` for `before`, `after`, `payload`, `idempotency_key`, `device_id`, `client_ref`, `photo_path`, `photo_blur`, and any `jsonb` column — they are readable when asked for by name, not by default. Owner may `select` it (it feeds `describe`).

`app.assistant_run_tool(p_tool text, p_args jsonb) returns jsonb` — `language plpgsql STABLE security definer set search_path = public`. Body, in order: `if not app.is_staff('owner') then raise FORBIDDEN`; `perform set_config('statement_timeout', '8000', true)`; `case p_tool` over exactly `DISPATCHED_RPCS` from the catalog (the **rpc** names, e.g. `panel_headline`, `assistant_payments_list`); each branch calls the function with named args pulled by `p_args ->> 'p_x'` and cast (dates `::date`, uuids `::uuid`, ints `::int`, jsonb `p_args -> 'p_filters'`, text[] via `array(select jsonb_array_elements_text(p_args -> 'p_columns'))`); `else raise exception 'ASSISTANT_UNKNOWN_TOOL'`. Return `jsonb_build_object('tool', p_tool, 'data', v_result, 'row_count', v_count, 'truncated', v_truncated)` where `row_count` is the length of the array the tool's `rows_path` points at when known (list tools return it themselves) or null. For set-returning RPCs (`list_staff`, `customer_search`, `price_slot`) aggregate with `jsonb_agg`.

The read-only property: STABLE means PostgREST wraps the call in a read-only transaction. Do NOT rely only on that — as the very first statement after the guard run `perform set_config('transaction_read_only', 'on', true)` so a direct `select app.assistant_run_tool(...)` from any client is read-only too. Test (`assistant-wall.test.ts`): create, with the service role, `app.assistant_test_mutator()` that inserts into a scratch table and a temporary extra branch is NOT possible (the case list is fixed) — so instead test the wall directly: `select app.assistant_run_tool('list_staff', '{}')` works, and a planted `app.assistant_run_tool_probe()` STABLE definer function that calls `set_config('transaction_read_only','on',true)` then attempts an insert must fail with `25006 read-only transaction`. Also assert that every `DISPATCHED_RPCS` name returns a result (not `ASSISTANT_UNKNOWN_TOOL`) when called with minimal valid args on the seeded stack, and that an unknown name raises `ASSISTANT_UNKNOWN_TOOL`.

`app.assistant_count(p_tool text, p_args jsonb) returns bigint` — same guard and read-only setting; for each countable tool (`COUNTABLE_TOOL_NAMES`) calls the list RPC with `p_count_only := true` and returns its `total`; else raises `ASSISTANT_NOT_COUNTABLE`.

New internal RPCs (`security definer`, owner-guarded, **not granted** to any client role — the dispatcher reaches them as definer; they are therefore not registry entries):

| function | returns |
|---|---|
| `assistant_bookings_list(p_from date, p_to date, p_court_id uuid, p_status text, p_customer_id uuid, p_limit int, p_offset int, p_count_only bool default false)` | `{rows:[{id, court_id, court_name_en, court_name_ar, kind, status, start_at, end_at, guest_id, guest_name, guest_phone, players, price_iqd, source, series_id, created_by_staff_id, created_at, cancelled_at, cancellation_reason}], total}` — kind = booking only; range on `app.business_date(start_at)`; order start_at |
| `assistant_tabs_list(p_from date, p_to date, p_status text, p_limit, p_offset, p_count_only)` | `{rows:[{id, day_session_id, business_date, status, table_id, table_label, reservation_id, label, opened_by_staff_id, opened_by_name, subtotal_iqd, tax_iqd, discount_iqd, court_iqd, total_iqd, opened_at, settled_at}], total}` |
| `assistant_payments_list(p_from date, p_to date, p_method text, p_limit, p_offset, p_count_only)` | `{rows:[{id, tab_id, day_session_id, method, amount_iqd, tendered_iqd, change_iqd, recorded_by, recorded_by_name, created_at, refunded_iqd}], total}` |
| `assistant_break_history(p_from date, p_to date, p_staff_id uuid, p_limit, p_offset, p_count_only)` | `{rows:[{id, staff_id, staff_name, station_id, business_date, started_at, ended_at, minutes, covered_by, covered_by_name}], total}` |
| `assistant_audit_page(p_from timestamptz, p_to timestamptz, p_actor_id uuid, p_action_prefix text, p_text text, p_limit, p_offset, p_count_only)` | same row shape as `app.audit_log_page` plus `changed_keys text[]` and WITHOUT `before`/`after` bodies; `p_text` matches `audit_log.search_text @@ websearch_to_tsquery('simple', p_text)` |
| `assistant_settings_read()` | `{venue: <venue_settings row minus nothing>, cafe: {key: value}, tax_groups: [...]}` |
| `assistant_courts_and_rates()` | `{courts:[...], rate_rules:[{..., prices:[{duration_min, price_iqd}]}]}` |
| `assistant_system_status()` | `{venue_mode, is_degraded, day_session: {...}|null, heartbeats:[{device_id, last_seen_at, stale}], outbox: {push_pending, telegram_queued, index_queued}, cron: [{jobname, last_run, status}] (from cron.job_run_details when the schema exists, else [])}` |
| `assistant_table_read(p_table text, p_columns text[], p_filters jsonb, p_order text, p_limit int, p_offset int, p_count_only bool)` | `{rows:[...], total, columns:[...]}` — every identifier validated against `assistant_readable_columns` BEFORE `format('%I')`; filters: `{"col": scalar}` = eq, `{"col": {"eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"in"|"is_null": v}}`; order `"col"` or `"col desc"`; limit clamped 1..500 |
| `assistant_stock_view(p_view text, p_limit, p_offset)` | `{rows, total}` over `v_ingredient_on_hand`, `v_variance_report`, `v_item_margin`, `v_expiring_soon`, `v_expired` by the short names `on_hand`, `variance`, `item_margin`, `expiring_soon`, `expired` |

`audit_log.search_text tsvector generated always as (to_tsvector('simple', coalesce(action,'') || ' ' || coalesce(entity,'') || ' ' || coalesce(entity_id,'') || ' ' || coalesce(reason_code,'') || ' ' || coalesce(array_to_string(akeys-ish of before/after)))) stored` — jsonb key extraction inside a generated column must be immutable: use a small `immutable` helper `app.jsonb_top_keys_text(jsonb)` and GIN index it. This is an ALTER on a live append-only table: adding a generated stored column rewrites the table — state the risk in the header comment (`MIGRATION-RISK-ACCEPTED: audit_log search column, one-time rewrite, run off-hours`).

### 0110 pgvector, chunks, search, queue, triggers, nudge, cron

`create extension if not exists vector with schema extensions;` (Supabase puts extensions in `extensions`; local has `vector` available, 0.8.2). `assistant_chunks` as in plan §2.4 with `embedding extensions.vector(1024)` nullable, `tsv` generated, unique `(kind, ref, lang)`, HNSW index on embedding (`vector_cosine_ops`) and GIN on `tsv` — new empty table, plain indexes are fine, say so.

`app.assistant_search(p_query text, p_embedding extensions.vector(1024), p_kinds text[], p_limit int default 12) returns jsonb` — owner-guarded, STABLE; RRF (k = 60) over top-50 by cosine (skipped when `p_embedding is null`) and top-50 by `ts_rank(tsv, websearch_to_tsquery('simple', p_query))`; filter by `p_kinds` when not null; returns `[{id, kind, ref, lang, title, snippet (first 300 chars of body), route, score, source_updated_at}]`. Granted to `authenticated`.

`assistant_index_queue` per plan §2.5; `app.claim_due_index(p_limit int default 50)` service-role only, same lease as `claim_due_notifications` (60 s); `app.assistant_index_nudge()` posts to `functions_base_url || '/assistant-index'` like `push_nudge`; triggers `AFTER INSERT OR UPDATE OR DELETE` on `customer_notes`, `staff_requests`, `manager_alerts`, `analytics_insights`, `analytics_insight_rejections`, `menu_items`, `promotions` enqueue `(kind, ref, op)` with kind from the table (`note`, `request`, `alert`, `finding`, `rejection`, `menu_item`, `promotion`), the whole body inside `begin … exception when others then null; end`. Cron `tp_assistant_index_sweep` every minute (same pg_cron guard as telegram), `tp_assistant_index_prune` deletes claimed rows older than 7 days.

Service-role RPCs for the index function: `app.assistant_chunk_source(p_kind text, p_ref text) returns jsonb` (the cleaned-by-projection row for one source: only the columns the plan lists per kind; NULL when deleted), `app.assistant_upsert_chunk(p jsonb)` and `app.assistant_delete_chunk(p_kind, p_ref)`, `app.assistant_index_fail(p_id bigint, p_error text)`, `app.assistant_index_done(p_ids bigint[])`.

### 0111 usage by kind, pricing, assistant_usage

`llm_usage` gains `cache_write_tokens bigint not null default 0`, `cache_read_tokens bigint not null default 0`. `venue_settings.llm_pricing jsonb not null default '{}'` with a comment giving the shape `{"claude-opus-5": {"input": 5000000, "cache_write": 6250000, "cache_read": 500000, "output": 25000000}}` (micros per MTok). Seed the default row with that Opus 5 entry AND `claude-sonnet-5` (`2000000 / 2500000 / 200000 / 10000000`) so the cap prices correctly from day one. Raise `llm_monthly_cost_cap_micros` default? No — leave; the settings page shows it.

`app.llm_record_usage(p_model text, p_input bigint, p_cache_write bigint, p_cache_read bigint, p_output bigint, p_model_calls int, p_surface text default 'assistant') returns bigint` (the cost in micros it recorded) — prices from `llm_pricing -> p_model`, falling back to `llm_cost_micros_per_mtok` blended over all four counts; adds to today's `llm_usage` row. Service role only. The old 3-arg overload stays.

`app.llm_price_micros(p_model text, p_input bigint, p_cache_write bigint, p_cache_read bigint, p_output bigint) returns bigint` — STABLE, the pricing arithmetic on its own, granted to authenticated (owner-guarded) so the UI's `priceFor` can ask the database instead of duplicating rates. Also owner-readable: `app.assistant_pricing() returns jsonb` (the map + fallback) — or fold it into `assistant_usage`.

`app.assistant_usage(p_from date, p_to date) returns jsonb` — owner-guarded, STABLE: `{days:[{usage_date, requests, model_calls, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_micros}], month: {...same sums for the current month}, cap: {daily_limit, monthly_cap_micros, month_cost_micros}, pricing: llm_pricing, fallback_micros_per_mtok}`. Granted to authenticated.

### 0112 jobs helpers

`app.assistant_job_transition(p_id uuid, p_status text, p_patch jsonb) returns assistant_jobs` — service role only; enforces the state machine (`estimated→accepted→running→{reducing→done | over_estimate→running | failed | cancelled}`; `estimated→cancelled`; `accepted→cancelled`); raises `INVALID_TRANSITION`. `app.assistant_job_cancel(p_id uuid)` owner-callable (granted), moves any non-terminal state to `cancelled`.

Tests: `assistant-wall.test.ts`, `assistant-rls.test.ts` (guest, cashier, manager denied; owner allowed on the four tables and every granted RPC), `assistant-catalog.test.ts` (every `DISPATCHED_RPCS` dispatches; parity of the two tools.ts copies), `assistant-search.test.ts` (plant one page chunk in EN and one in AR through the service role, search each with `p_embedding` null, expect it back; triggers enqueue on `customer_notes` insert and never fail the parent write even after `drop table assistant_index_queue` in a savepoint — simulate by renaming the table for the test then renaming back), `assistant-usage.test.ts` (pricing by kind rolls up; fallback when model absent), `assistant-jobs.test.ts` (transitions). Follow `llm-spend-cap.test.ts` for the harness and cleanup.

After migrating locally: `pnpm --filter @touch/db exec supabase migration up` (NOT `db reset` — the tree is shared), then `pnpm db:types`, commit `types.gen.ts` together with the migrations. Run `check:rpc-registry`, `check:authz`, `check:safeupdate`, `check:invariants`, `check:locks`.

## Lane B · map, coverage, measurements

Files: `packages/db/scripts/build-assistant-map.mjs`, `packages/db/scripts/check-assistant-coverage.mjs`, `packages/db/scripts/measure-assistant-tokens.mjs`, `packages/db/fixtures/assistant-map.json` (generated, committed), `packages/db/fixtures/assistant-coverage.json`, `docs/design/assistant/pages.md`, `docs/design/assistant/rules.md`, `packages/db/tests/assistant-map.test.ts`, and the two `package.json` scripts `assistant:map`, `check:assistant-coverage` in `packages/db`, plus `check:assistant-coverage` appended to the root `security` chain.

`assistant-map.json` shape: `{ generated_from: "<git sha>", chunks: [{ kind, ref, lang: "en"|"ar", title, body, route }] }` — `kind` from the plan's list (`page`, `nav`, `rpc`, `action`, `table`, `column`, `setting`, `enum`, `label`, `rule`, `system`, `doc`). Sources: `ROUTE_ROLES` + `SUB_ROUTES` (`apps/operator/src/lib/auth.tsx`, regex-parse), `workspaces.ts` rail items and their `ws.shell.nav.*` labels in both catalogs, `pages.md` (one line per route: `- /admin/day-close — Close the trading day: count the drawer, …`; the generator FAILS if a route lacks a line), the catalog `ASSISTANT_TOOLS` (`rpc` chunks), every `grant execute on function app.X` in migrations whose name is NOT in the catalog (`action` chunks: signature from the `create or replace function` text, the comment, the guard line found by regex, the pages calling it via `appRpc('X'` grep over `apps/operator/src`), `comment on table/column` statements (`table`, `column`, `setting` for `venue_settings.*` and `cafe_settings` keys from `apps/operator/src/lib/settings.ts`), `create type … as enum` in `20260824000002_enums_domains.sql` (`enum`), `op.*`/`ws.*` catalog strings (`label`, attributed to the catalog file), `rules.md` (`rule`, one per `##` section), `functions/*/index.ts` headers + `cron.schedule` names (`system`), `docs/**/*.md` split by `##` (`doc`, capped at 2,000 chars per chunk). Arabic variants: `lang: "ar"` only where an Arabic label exists (nav, label, enum descriptions if you write them); otherwise one `en` chunk.

Compact prefix: also emit `packages/db/fixtures/assistant-map-compact.md` (pages with routes and roles, the rules, the tool names one per line) — Lane C embeds this file's text into the system prompt; keep it under 20k tokens (roughly 60 KB) and print its byte size at the end of the run.

`assistant-coverage.json`: `{ tables: {name: "tool:x" | "table_read" | "excluded: reason"}, views: {...}, functions: {name: "tool:x" | "map:action" | "excluded: reason"}, routes: {route: "map:page"}, edge_functions: {...: "map:system"}, cron_jobs: {...}, docs: {path: "index:doc" | "excluded: reason"} }`. The check re-derives every inventory from the code (tables/views from `create table`/`create view` in migrations; functions from grants; routes from `ROUTE_ROLES` + `SUB_ROUTES`; edge functions from `functions/*/`; cron jobs from `cron.schedule('name'`; docs from the tree) and fails on any missing or extra key, on a business table marked `excluded` without a reason, on a `tool:` not in the catalog, and — when the local stack is up — on any `assistant_readable_columns` table_name absent from the fixture. Wire it into `pnpm security`.

`measure-assistant-tokens.mjs`: with `ANTHROPIC_API_KEY` set, runs each list tool through `app.assistant_run_tool` as the seeded owner on the local stack, cleans the result with `_shared/assistant/clean.ts` (import it; it is pure), calls `count_tokens` on the cleaned text and on the compact map, and prints a `tokens_per_row` table plus a patch suggestion for `tools.ts`. Without a key it prints the byte-based estimate (bytes / 4) and says so. Do not edit tools.ts automatically.

Test `assistant-map.test.ts`: regenerating the map in memory equals the committed fixture (staleness), and every route has a sentence.

## Lane C · edge functions

Files: `packages/db/supabase/functions/_shared/assistant/{tools,clean,handles,gate,prompt,provider,embed,estimate,sse,scopes,map}.ts`, `functions/assistant-chat/index.ts`, `functions/assistant-index/index.ts`, `functions/assistant-job/index.ts`, `config.toml` rows (all `verify_jwt = true`), `.env.example` block, tests `packages/db/tests/assistant-clean.test.ts`, `assistant-gate.test.ts`, `assistant-estimate.test.ts`, `assistant-sse.test.ts`, `assistant-clean-door.test.ts` (grep test).

Pure modules (no `Deno`, no `npm:` imports) so vitest imports them: `tools.ts` (the copy), `clean.ts`, `handles.ts`, `gate.ts`, `estimate.ts`, `sse.ts`, `scopes.ts`, `prompt.ts` (system prompt builder taking the compact map text as an argument), `embed.ts` (provider selection + fetch bodies, given `fetch` and an env getter like `sms/index.ts`). Deno-only: `provider.ts` (the Anthropic SDK via `npm:@anthropic-ai/sdk`), `map.ts` (loads `assistant-map.json` via `import … with { type: 'json' }` — copy the fixture into `_shared/assistant/map.json` at build; Lane B's script writes both paths), the three `index.ts`.

### clean.ts

```ts
export type CleanKind = 'tool' | 'chunk';
export interface CleanSource { kind: CleanKind; name: string; rows_path: string | null; id_keys: readonly string[]; columns: readonly string[] | '*' }
export interface CleanOptions { tz: string; lang: 'en'|'ar'; handles: HandleTable; cap?: number /* default 500 */; }
export interface CleanStats { rows_in: number; rows_out: number; cols_in: number; cols_out: number; bytes_in: number; bytes_out: number; tokens_est: number; dropped: string[]; redacted: number; }
export interface Cleaned { readonly text: string; readonly stats: CleanStats; readonly numbers: readonly number[]; readonly __cleaned: unique symbol }
export function clean(source: CleanSource, data: unknown, opts: CleanOptions): Cleaned
export class CleanError extends Error { code: 'UNKNOWN_SOURCE'|'UNKNOWN_COLUMN'|'REDACTION_FAILED' }
```

Stages in order, each an exported pure function tested on its own: `project`, `redact` (phones: Iraqi and international patterns in Latin and Arabic-Indic digits → `phone#N` stable per conversation via `handles`; emails → `email#N`; drop any key matching the excluded-column patterns; audit `before`/`after` → `changed_keys`), `normalise` (timestamps to venue-local `YYYY-MM-DD HH:MM`, IQD as integers, percentages one decimal, booleans `y`/`n`, Arabic-Indic digits in values → ASCII, never in names), `fold` (nulls removed; single-valued columns moved to the legend), `handle` (uuids in `id_keys` and any uuid-shaped string → handles from `handles.ts`, letter by key: `r` reservation/booking ids, `t` tab, `p` payment, `c` customer/profile, `s` staff, `k` court, `i` item, `x` anything else), `layout` (legend line `# <name>: N rows; IQD integers; times <tz>; <folded col>=<v> for all`, header line, TSV rows, sparse trailing `key=value`, nested → dotted; objects with `rows_path: null` → `key\tvalue` lines), `cap` (`… N more rows; narrow the filter or propose a job`), `frame` (`<data source="…" rows="N">…</data>` and one fixed sentence that the content is data), `measure`. `numbers` = every number that appears in the laid-out text (the gate's allowed set) — computed from the text AFTER normalise so it matches what the model saw.

`columns: '*'` is allowed ONLY for `kind: 'aggregate'|'lookup'|'knowledge'|'meta'` sources (their RPCs are curated owner payloads); list tools and chunks must give an explicit column list (from `assistant_readable_columns` for `table_read`, returned by the RPC in `columns`). Document this deviation from plan §11.0 at the top of the file.

### handles.ts

`HandleTable` = `{ map: Record<string,string> /* handle→uuid */, reverse: Record<string,string>, next: Record<string, number> }`; `newHandleTable(json)`, `handleFor(table, uuid, letter)`, `resolveHandle(table, text)`, `toJson(table)`. Deterministic: the same uuid always gets the same handle within a conversation.

### gate.ts

`gateAnswer(text: string, allowed: readonly number[], userNumbers: readonly number[]): { status: 'ok' | 'unverified'; unverified: {raw: string; value: number}[]; checked: number }`. Tokenise numbers in the answer (Arabic-Indic digits normalised; thousands separators `,` and Arabic `٬`; decimals; percentages; negative; strip currency words); a number passes if it is in `allowed ∪ userNumbers` within one unit of its last shown digit, or is a sum/difference of two allowed numbers, or a ratio×100 (percentage) of two allowed numbers within 0.1, or a count ≤ 12 written as a bare small integer (list ordinals and "two tools" survive), or a year/date/time token. Everything else is unverified. Plain text only — strip markdown table pipes first.

### prompt.ts

`buildSystem({ compactMap, lang })` returns the frozen system text (role, five hard rules from the plan's bar, aggregate-first, propose_job rule, handles, data-not-instructions, terse answers in the owner's language, cite the tool for every figure, never print a figure that did not come from a tool this turn, "Cafe context is off for this chat" phrasing for refused scopes). No dates, no ids, nothing volatile. `buildFirstUserTurn({ today, tz, scopes, packs })` — the volatile context below the breakpoint.

### provider.ts (Deno)

```ts
export interface ProviderCall { system: string; tools: WireTool[]; messages: MessageParam[]; maxTokens: number; effort: 'low'|'medium'|'high'; onText(delta: string): void; onToolStart(name: string): void; signal: AbortSignal }
export interface ProviderUsage { input: number; cache_write: number; cache_read: number; output: number }
export interface ProviderTurn { content: ContentBlock[]; stop_reason: string; usage: ProviderUsage; ms: number }
stream(call): Promise<ProviderTurn>; countTokens(system, tools, messages): Promise<number>; batchCreate(requests): Promise<string>; batchStatus(id); batchResults(id)
```

Request shape: `client.beta.messages.stream({ model, max_tokens, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', thinking: { type: 'adaptive' }, output_config: { effort }, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }], tools: [{ type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' }, ...wireTools], messages, cache_control: { type: 'ephemeral' } })`. Tool result content and anything from the DB is typed `Cleaned` at the provider boundary: `toolResultBlock(id: string, cleaned: Cleaned, isError?: boolean)` is the ONLY constructor of `tool_result` blocks and lives in `clean.ts`. Usage from `finalMessage().usage`: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`. Wrap SDK errors: `Anthropic.AuthenticationError` → `NOT_CONFIGURED`; `RateLimitError` → `RATE_LIMITED`; other `APIError` → `UPSTREAM`.

### assistant-chat/index.ts

Request `POST { conversation_id: uuid|null, text: string, lang: 'en'|'ar', scopes?: AssistantScope[], range?: {from,to} }`. Response `text/event-stream`, each event `event: <name>\ndata: <json>\n\n`. Events and payloads:

| event | data |
|---|---|
| `message_start` | `{ conversation_id, user_message_id, assistant_message_id, scopes }` |
| `delta` | `{ text }` |
| `tool_start` | `{ call_id, name, args }` (args with handles, never uuids) |
| `tool_end` | `{ call_id, name, row_count, ms, route, error?: string, stats }` |
| `sources` | `{ items: [{ call_id, name, args, row_count, ms, route, stats, error? }], scopes }` |
| `gate` | `{ status, unverified, checked, retried: boolean }` |
| `usage` | `{ input, cache_write, cache_read, output, cost_micros, calls, model }` |
| `job_estimate` | see Lane C estimate.ts → `JobEstimate` |
| `done` | `{ message_id, stop_reason }` |
| `error` | `{ code, message }` codes: `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_CONFIGURED`, `LLM_DAILY_QUOTA`, `LLM_MONTHLY_CAP`, `RATE_LIMITED`, `UPSTREAM`, `TIMEOUT`, `INVALID_REQUEST` |

Before streaming starts, auth failures and quota refusals are plain JSON responses with the right status (401/403/429/503) exactly like `analytics-insights`, so `streamEdge` can reuse `statusToEdgeCode`. Flow per plan §4.1: `requireStaffRole(['owner'])` → `app.llm_begin_request()` (service) → load/create conversation (service; owner_id = caller) → insert user message (seq = max+1) → build request (system with compact map from `map.ts`; first user turn = date, tz, scopes, packs; tail = last 30 messages' stored content blocks verbatim; new text) → loop ≤ 8 rounds: stream; on `tool_use` blocks: validate input (`validateToolInput`), check scope (`isToolAllowed`; refused → `is_error` result `Scope "<scope>" is off for this chat`), resolve handles (`resolveHandle`), dispatch via the JWT-bound client (`createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') } } })`).schema('app').rpc('assistant_run_tool', { p_tool: spec.rpc, p_args }) — knowledge tools run in the function (`search` → embed the query then `assistant_search` as the owner with kinds ∩ scope kinds; `describe`/`page_lookup` → `map.ts`; `usage` → `assistant_usage`); every result → `clean()` → `toolResultBlock`; a list tool whose result `total > 500` with no explicit `limit` → `is_error` "more than 500 rows; call propose_job"; `propose_job` → compute estimate (`estimate.ts` + `assistant_count` as owner + `countTokens` for the first chunk when a key is present) → insert `assistant_jobs` row `estimated` → emit `job_estimate` → end the turn. After the final text: `gateAnswer(text, numbersFromAllCleaned, numbersInUserText)`; on `unverified` once: append a `{role:'system', content: 'These figures are not in this turn\'s tool results: …. Restate the answer using only figures you were given, or say you do not have them.'}` message and stream one more turn; then persist: assistant message (content blocks verbatim, `sources`, `gate`, `tokens`), one `assistant_calls` row per model call (priced via `app.llm_price_micros`), `app.llm_record_usage(model, …)` once with sums, update conversation `handles`, `tokens`, `updated_at`, title (first 60 chars of the first user text). Self-abort at 50 s: end the stream with `error {code:'TIMEOUT'}` after persisting what exists. No `ANTHROPIC_API_KEY` → 503 `{code:'NOT_CONFIGURED'}` before any DB write except the user message is NOT inserted either.

Context packs for the first user turn: for each scope in `scopes` run its pack tools (money: `panel_headline(range, 'previousPeriod')`; cafe: `analytics_best_sellers(range, 5)` + `report_cafe`; courts: `analytics_courts_summary`; stock: `stock_view('expiring_soon', 20)` + `stock_view('on_hand', 50)`; staff: `staff_requests_page('pending')`; marketing: `analytics_promo`; settings: `settings_read`; system: `system_status`; others none) with `range` defaulting to the last 7 business days, cleaned; report each pack's `tokens_est` in `message_start` as `packs: [{scope, tokens_est}]` so the UI can print `≈ 1.2k tokens` next to each checkbox (the UI asks for sizes by POSTing `{ conversation_id: null, text: '', scopes, range, dry_run: true }` → JSON `{ packs }`, no model call, no `llm_begin_request`).

### assistant-index/index.ts

Service-role caller (`isServiceRoleRequest`) OR owner session for `{mode:'map'}`. `{}` → drain: `claim_due_index(50)`; for each row `assistant_chunk_source` → `clean({kind:'chunk', name: kind, …})` → `embed([text], lang)` (skip when provider `none`) → `assistant_upsert_chunk`; failures → `assistant_index_fail`. `{mode:'map'}` → load `map.json`, clean, embed in batches of 32, upsert all `map:*` kinds, delete stale refs of those kinds not in the map. Returns `{ processed, failed, ms }`.

### assistant-job/index.ts

`POST {action:'accept', job_id, mode}` (owner) → `assistant_job_transition(accepted)` then `running`, then runs inline for `live` (each chunk: `llm_begin_request`, `assistant_run_tool` as the owner with `limit: chunk_rows, offset`, clean, one model call with a fixed extraction prompt returning JSON, store into `tokens`/`chunks_done`; stop with `over_estimate` if `tokens.total > estimate.total × 1.25`; after the last chunk `reducing` → one model call merging the objects → insert an assistant message in the conversation with `sources: [{job_id}]` → `done`); for `batch` → `batchCreate` with `custom_id = job:<id>:<chunk>` → store `batch_id` → return; `POST {action:'tick'}` (service role, cron `tp_assistant_job_tick` every minute) → for every `running` batch job poll status; when ended collect results by `custom_id`, reduce, finish. `POST {action:'cancel', job_id}` (owner) → `assistant_job_cancel` and cancel the batch when `batch_id` is set. The live path must finish inside the function's wall clock: cap live jobs at 40 chunks; larger → the estimate card offers batch only.

### estimate.ts

```ts
export interface JobPlan { question: string; calls: {tool: string; args: Record<string, unknown>}[]; extract?: string; reduce?: string; aggregate_alternative?: {calls: …} | null }
export interface JobEstimate { job_id: string; rows: number; chunks: number; per_tool: {tool: string; rows: number; chunk_rows: number; tokens_per_row: number; measured: boolean}[]; tokens: { input: number; cache_read: number; output: number; total: number }; tokens_high: {…} /* +15 % */; modes: { aggregate: {calls, tokens_est} | null; live: { allowed: boolean; reason?: string } ; batch: { allowed: true } }; assumptions: string[]; first_chunk_exact: number | null }
export function estimateJob(plan, counts: Record<string /*tool*/, number>, catalog): Omit<JobEstimate,'job_id'|'first_chunk_exact'>
```

Constants: `CHUNK_PROMPT_TOKENS = 1200`, `CHUNK_OUTPUT_TOKENS = 400`, `REDUCE_PROMPT_TOKENS = 800`, `REDUCE_OUTPUT_TOKENS = 1500` — named, exported, and listed in `assumptions`.

## Lane D · operator app

Files: `apps/operator/src/features/assistant/**`, `apps/operator/src/lib/edge.ts` (add `streamEdge` and the three names to `EdgeFunctionName`), `apps/operator/src/lib/assistantPricing.ts`, `apps/operator/src/lib/auth.tsx` (`'/assistant': ['owner']`), `apps/operator/src/lib/workspaces.ts` (`OWNER_PRIMARY` gets `{ to: '/assistant', labelKey: 'assistant', icon: 'spark' }`; add `'assistant'` to the `labelKey` union), `apps/operator/src/routes/assistant.tsx` + `routes/assistant/_children.ts` (`/assistant`, `/assistant/$id`, `/assistant/usage`), `main.tsx` registration, `__root.tsx` (rail footer button that opens the drawer, owner only, `Cmd/Ctrl+K` shortcut; the drawer itself mounted once in the shell), i18n `ws.owner.assistant.*` in `owner.en.ts` and `owner.ar.ts` (Arabic parity is enforced by the type), `ws.shell.nav.assistant` in `shell.en.ts`/`shell.ar.ts`.

`streamEdge(fn, body, { onEvent(name, data), signal })`: same auth header and error mapping as `callEdge`; non-2xx → parse JSON body → throw `EdgeError` via `statusToEdgeCode`; 2xx → read `res.body` with `TextDecoder`, split on `\n\n`, parse `event:`/`data:` lines (a pure `parseSseChunk(buffer) → {events, rest}` in `features/assistant/sse.ts` with a unit test). Never caches.

Data reads go straight through `supabase.from('assistant_conversations')`/`assistant_messages`/`assistant_jobs` under RLS with TanStack Query keys `['assistant','conversations']`, `['assistant','messages',id]`, `['assistant','job',id]`, `['assistant','usage',from,to]` (the last via `appRpc('assistant_usage')`). Scope changes: `appRpc('assistant_set_scopes', …)`; archive: `appRpc('assistant_archive_conversation')`; job accept/cancel: `callEdge('assistant-job', …, { ttlMs: 0 })`.

Components (plan §5.2): `AssistantDrawer` (a right-side sheet, RTL-aware via logical properties, mounted in `__root.tsx`, holds the current conversation id in `sessionStorage`), `AssistantPage` (list + thread), `ConversationList`, `Thread`, `Composer` (textarea, "Ask" button says it is billed via the `askBilled` hint, Enter sends, Shift+Enter newline), `Message` (user/assistant; renders paragraphs, simple lists and pipe tables; marks unverified figures with `UnverifiedMark`), `Sources` (one row per tool call: name, args as text, `row_count`, `ms`, a `Link` to `route` carrying `?from=&to=` when the args had a range), `UsageMeter` (this message / this chat / today / month, four kinds, priced with `priceFor`), `ScopeStrip` (checkboxes with pack sizes, three presets, total), `JobEstimateCard` (three ways, price on each button, "Not now"), `JobProgress` (polls the job row at 2 s while non-terminal), `UsagePage` (day table for the month, month totals, cap, pricing table).

`assistantPricing.ts`: `priceFor({model, input, cache_write, cache_read, output}, pricing: PricingMap, fallbackMicrosPerMtok): number /* micros */` pure, plus `formatUsd(micros)`; `pricing` comes from `assistant_usage().pricing`.

Copy rules: buttons say what they do and what is billed; an unverified figure is a labelled mark with a sentence; a degraded search is a plain note; "Cafe context is off for this chat" → one-tap "Turn on Cafe". Everything in both languages.

Tests: `sse.test.ts`, `assistantPricing.test.ts`, `Message.test.tsx` (unverified mark rendered), `ScopeStrip.test.tsx` (preset toggles), `edge.test.ts` additions for `streamEdge`.

## Environment

`.env.example` additions: `ANTHROPIC_API_KEY=`, `ANTHROPIC_MODEL=claude-opus-5`, `EMBEDDING_PROVIDER=none` (`voyage` | `openai` | `local` | `none`), `VOYAGE_API_KEY=`, `OPENAI_API_KEY=`. `config.toml`: `[functions.assistant-chat] verify_jwt = true`, `[functions.assistant-index] verify_jwt = true`, `[functions.assistant-job] verify_jwt = true`.

## Verification each lane runs before reporting

Lane A: `supabase migration up` on the local stack, `pnpm db:types`, `pnpm --filter @touch/db test -- tests/assistant-*.test.ts`, the five `check:*` scripts. Lane B: `node scripts/build-assistant-map.mjs && node scripts/check-assistant-coverage.mjs`, `pnpm --filter @touch/db test -- tests/assistant-map.test.ts`. Lane C: `pnpm --filter @touch/db test -- tests/assistant-clean* tests/assistant-gate* tests/assistant-estimate* tests/assistant-sse*`, and a Deno-free typecheck of the pure modules through the db package's `tsc --noEmit` (they are under `supabase/functions`, which tsconfig does not include — add a `tests/assistant-typecheck.ts` that imports every pure module so `pnpm --filter @touch/db typecheck` covers them). Lane D: `pnpm --filter @touch/operator typecheck && pnpm --filter @touch/operator lint && pnpm --filter @touch/operator test`, `pnpm --filter @touch/i18n typecheck test`.
