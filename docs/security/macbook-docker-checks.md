# What was verified with Docker on the MacBook — 2026-09-07

**Author** Kemal · **Branch** `kemal` · **Repo HEAD at time of run** `22ce202`
**Purpose** A colleague ran, or will run, the same checks on **Docker Desktop**. This file records
what was run **here**, on a different container runtime, with the exact numbers each check
produced — so the two runs can be diffed rather than described to each other.

> **Why this file exists.** Every check below had **never been executed** before this run: the
> repository had no container runtime available, so `supabase start` had never come up and every
> box that depended on it had been ticked on the strength of reading the code. Running them found
> **two of those boxes were false** (§4). That is the reason to compare runs rather than trust a
> tick — and the reason a second run on a different runtime is worth doing at all.

---

## 1 · The runtime used here, and how it differs

**This was NOT Docker Desktop.** OrbStack was installed on 2026-09-07 because no container
runtime was present on this machine. It is a drop-in replacement — same `docker` CLI, same
socket protocol, same images — but it is a different Linux VM and a different file-sharing
layer, so it is exactly the kind of difference worth ruling out.

| | This machine |
|---|---|
| Host OS | macOS 26.5.2, `Darwin arm64` (Apple Silicon) |
| Container runtime | **OrbStack 2.2.3** (`c83556b`) — *not* Docker Desktop |
| Docker CLI / Engine | 29.4.0 / 29.4.0 |
| Docker context | `orbstack` → `unix:///Users/kemal/.orbstack/run/docker.sock` |
| Docker Compose | v5.1.2 |
| Node | v24.11.1 |
| pnpm | 9.15.9 |
| Supabase CLI | **v2.115.0** (v2.116.0 was available and deliberately not taken mid-run) |

**Check these three first if your numbers differ from mine**: the Supabase CLI version, the
container image tags in §2, and your CPU architecture. Everything here ran on `aarch64`; an
Intel Mac pulls different image digests for the same tags.

### Container image tags that came up

All ten healthy, uptime 2h at the time of writing:

```
supabase_db_touchpadel            public.ecr.aws/supabase/postgres:17.6.1.159
supabase_auth_touchpadel          public.ecr.aws/supabase/gotrue:v2.195.0
supabase_rest_touchpadel          public.ecr.aws/supabase/postgrest:v16.1
supabase_realtime_touchpadel      public.ecr.aws/supabase/realtime:v2.129.0
supabase_storage_touchpadel       public.ecr.aws/supabase/storage-api:v1.69.11
supabase_edge_runtime_touchpadel  public.ecr.aws/supabase/edge-runtime:v1.74.3
supabase_kong_touchpadel          public.ecr.aws/supabase/kong:2.8.1
supabase_pg_meta_touchpadel       public.ecr.aws/supabase/postgres-meta:v0.98.0
supabase_studio_touchpadel        public.ecr.aws/supabase/studio:2026.08.17-sha-0c1da8f
supabase_inbucket_touchpadel      public.ecr.aws/supabase/mailpit:v1.30.2
```

⚠ **The container names are lower-cased**: `supabase_db_touchpadel`, not
`supabase_db_TouchPadel`. `docker exec supabase_db_TouchPadel …` fails with *"No such container"*
even though the project directory is `TouchPadel`. Worth knowing before you conclude the stack
did not start.

---

## 2 · How to reproduce this run

```sh
pnpm i
pnpm db:start          # supabase start — brings up the ten containers above
pnpm db:reset          # applies all 76 migrations + seed
pnpm db:fixtures       # ⚠ NOT optional — see the note below
```

⚠ **`pnpm db:fixtures` is an unstated prerequisite of the e2e suite.** `db:reset` alone leaves no
fixture cafe tables, so `generate_table_token` returns `TABLE_NOT_FOUND` and the whole header
suite fails for a reason that has nothing to do with security. It is not in the README quickstart.

### Database state after `db:reset`

| | Value here |
|---|---|
| Postgres | `PostgreSQL 17.6 on aarch64-unknown-linux-gnu, gcc 15.2.0` |
| Migration files on disk | **76** |
| Rows in `supabase_migrations.schema_migrations` | **76** |
| Migration head | `20260907000076` |
| `btree_gist` schema | **`extensions`** (relocated by 0069 — was `public`) |
| `reservations_no_overlap` | **present** after the relocation |

Those last two are the post-condition of migration 0069 and are the thing to compare most
carefully — see §4.

---

## 3 · Every check that was run, and its result

Run at HEAD `22ce202`. **Compare the numbers, not just the pass/fail** — several of these are
counters that drift as the repo grows, and a differing count is more informative than a
differing verdict.

### 3.1 · Database gates — `pnpm --filter @touch/db <script>`

| Check | Result | Numbers it printed |
|---|---|---|
| `check:locks` | **PASS** | — |
| `check:authz` | **PASS** | probes all **139** RPCs as a live anonymous guest |
| `check:safeupdate` | **PASS** | — |
| `check:migrations` | **PASS** | scoped to files changed vs the merge base |
| `check:invariants` | **PASS** | `views 12 total · 8 security_invoker=on · 4 owner-rights`<br>`definer fns 215 total · 215 with a pinned search_path` |
| `check:rpc-registry` | **PASS** | `public by design 20 · guarded 119` (**139** total)<br>67 RPCs still have no rls-matrix rule — reported, not a failure |

### 3.2 · Repo security scripts — `node scripts/security/<script>`

| Check | Result | Note |
|---|---|---|
| `check-public-env-names.mjs` | **PASS** | |
| `check-history-secrets.mjs` | **PASS** | |
| `check-dependency-audit.mjs` | **PASS** | waivers in `.security/audit-waivers.json` all unexpired |
| `check-data-hygiene.mjs` | **PASS** | |
| `check-web-security.mjs` | **PASS** | ⚠ this gate was **fixed** during this run — see §4 |
| `check-artifact-secrets.mjs --only=web` | **PASS** | |
| `check-artifact-secrets.mjs --only=mobile` | **PASS** | |
| `check-artifact-secrets.mjs --only=desktop` | **NOT RUN** | needs `pnpm --filter @touch/operator-shell dist:dir`, an Electron package build. **The one gap in this run.** CI covers it in the operator-shell job. |

⚠ Running the script **bare** (`node scripts/security/check-artifact-secrets.mjs`) fails with
*"1 of 3 clients were not built"*. That is correct behaviour, not a defect — CI invokes it three
times with `--only=<client>` inside the job that built that client. Do not read the bare failure
as a finding.

### 3.3 · Build, lint, typecheck, unit tests

| Command | Result |
|---|---|
| `pnpm fonts:check` | **PASS** |
| `pnpm turbo lint typecheck test` | **19/19 tasks pass** |
| `pnpm turbo build` | **4/4 pass** — web, operator, operator-shell, mobile |
| `pnpm --filter @touch/db test` | **594 passed / 594**, 35 test files, ~30s |
| `pnpm --filter @touch/operator-shell typecheck && … test` | **PASS** |
| `pnpm --filter @touch/operator-shell check:electron` | **PASS** |

`pnpm --filter @touch/web lint` reports **0 errors, 3 warnings**. All three are pre-existing
`react-hooks/exhaustive-deps` warnings in `CafeApp.tsx`, `ItemSheet/drag.ts` and
`useCafeActions.ts`. CI does not pass `--max-warnings 0`, so they do not fail the build.

### 3.4 · End-to-end — `pnpm e2e`

**48 passed / 48**, both locales (`chromium-en` + `chromium-ar`), ~2.3 minutes.

⚠ The webServer runs **`next dev`**, not a production build. Two assertions in
`e2e/tests/web-security-headers.spec.ts` are therefore gated behind `E2E_PROD_BUILD=1` and
**did not execute in this run** — the absence of `unsafe-eval`, and the inline-script nonce.
`next dev` needs eval for HMR and injects un-nonced overlay scripts, so they cannot pass there.
**Nothing sets that flag anywhere today, including CI.** Open item, tracked in
`security-general.md` §10.

Benign log noise you will also see, unrelated to any check:
`upstream image response failed for …/menu-media/items/…/01HZZ.webp 400`.

---

## 4 · What this run FOUND — the reason to compare

Four boxes had been ticked without ever being executed. Running them proved **two were false**.
If your run disagrees with any of the following, that is a real finding and not a runtime
difference.

### 4.1 · Migration 0069 was broken and had never run anywhere

Its post-check named **`app.reservations`**. That table is in `public` — the `app` schema holds
functions, and its only tables are `secrets`, `rpc_replays`, `pin_attempts`, `sms_limits`,
`sms_sends`. `'app.reservations'::regclass` raised **42P01**, the migration aborted, and
`supabase start` failed outright at 0069 — **no stack at all**, and 0070/0071 never applied.

It would have failed **identically on the hosted project**, inside the gated `db-migrate.yml`
window, on the client's live database.

Fixed in place: correct schema, plus `to_regclass` so a missing relation reports which invariant
could not be checked rather than dying on a raw catalog error. The migration had never run
anywhere, so nothing had to be rewritten.

**If your stack comes up at all, you have the fix.** The pre-fix behaviour is total failure at
`supabase start`, not a warning.

### 4.2 · No web security header was shipping

`STATIC_SECURITY_HEADERS` and `TABLE_ROUTE_HEADERS` were written in
`apps/web/src/lib/security/headers.ts`, exported, and **imported into `next.config.ts` where
nothing used them**. `headers()` returned a single font `Cache-Control` rule. So no HSTS, no
nosniff, no X-Frame-Options, no Referrer-Policy, no Permissions-Policy, no COOP, and no
`no-referrer` on the table route. Measured with `curl`, not inferred.

Three controls should have caught it and each missed differently:

1. `pnpm --filter @touch/web lint` **did** report `'STATIC_SECURITY_HEADERS' is defined but never
   used` — and was not re-run after the box was ticked.
2. `check-web-security.mjs` grepped `next.config.ts` for the constant **name**. An unused import
   satisfied it. The gate was green over zero shipped headers. **Now fixed** to look inside the
   body of the returned array, and negative-tested: reverting to a bare import fails it.
3. The e2e asserting headers on a live response had never executed — no container runtime.

**To confirm on your machine:** `curl -sI http://localhost:3000/en | grep -i strict-transport`.

### 4.3 · Migration 0075 had silently reverted the SEC-11 temporal guard

`mark_reservation` must refuse `no_show`/`completed` before `start_at`. 0071 added that; 0075
re-issued the function without it. Restored in **`20260907000076_no_show_temporal_guard.sql`**,
which merges 0075's `cancelled_at`/`cancellation_reason` stamping with 0071's guard — written as
a new migration rather than by editing a committed one.

### 4.4 · `Cache-Control: no-store` does not hold on the rendered table page

Measured, not assumed. `no-store` reaches the browser on `/t/{token}` — a middleware redirect,
where the proxy owns the response — but **not** on the rendered `/{locale}/t`, where Next stamps
its own `no-cache, must-revalidate` and wins over both `headers()` and `NextResponse.next()`.

A cache may therefore **store** that page provided it revalidates. The session is gated by the
HttpOnly cookie rather than by the cache, so this is defence-in-depth rather than access control
— but the earlier claim *"`Cache-Control: no-store` … verified on the live route"* was **not
true** and is corrected in `security-layer-1.md`.

### 4.5 · One stale e2e assertion, fixed

`cafe-journey.spec.ts:56` asserted `/t/{token}` stays verbatim in the address bar. Commit
`91cf0dc` added `exchangeTableToken` to `proxy.ts`, which 307s to the token-less `/{locale}/t`
with a `Set-Cookie`, and did not update the spec. The assertion is now the inverse — the token
must **not** survive in the URL — matching `web-security-headers.spec.ts:114`.

---

## 5 · Where this run is incomplete

Say so rather than let a green table imply otherwise:

- **`check-artifact-secrets --only=desktop` never ran here.** Needs an Electron package build.
- **`E2E_PROD_BUILD=1` never ran anywhere.** The `unsafe-eval` and inline-nonce assertions have
  not executed on any machine. CI must run the header suite against `next build && next start`.
- **Everything here is the LOCAL stack.** The hosted project is not at the migration head, so
  every green result above describes a database the venue does not use — see
  `layer-1-rules-and-decisions.md` §6, which requires a named risk owner, a time outside service,
  and D1 resolved before that changes.
- `gitleaks` was **not** re-run locally; it lives in the CI `secrets` job with a pinned 8.30.1
  binary and `fetch-depth: 0`.

---

## 6 · What to do if your numbers differ

| Symptom | Most likely cause |
|---|---|
| Stack fails to start at 0069 | You are before the 0069 fix — pull. |
| Different definer-function or view counts | Different migration head. Compare `select max(version) from supabase_migrations.schema_migrations` first. |
| Different RPC totals (139 / 20 / 119) | Same — new migrations grant new RPCs. The count is *supposed* to move; what must not move is a **drop** in coverage. |
| DB tests fail on the exclusion constraint | Fixtures left behind from an earlier run. The DB persists between runs; several suites clean up by name prefix. `pnpm db:reset && pnpm db:fixtures`. |
| e2e `TABLE_NOT_FOUND` | `pnpm db:fixtures` not run. |
| Header assertions fail | Check `next.config.ts` `headers()` actually **returns** the constants (§4.2). |
| `docker exec supabase_db_TouchPadel` → no such container | Name is lower-case: `supabase_db_touchpadel`. |
| Port 3000 in use by an old dev server | `lsof -ti:3000 \| xargs kill -9` |

Anything not in that table is worth raising rather than working around — a difference between two
container runtimes on the same commit is itself a finding.

---

*Kagu Web Studio · Touch Padel Phase 1 · 2026-09-07*
