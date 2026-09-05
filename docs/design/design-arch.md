I have everything I need from the scope and diagrams. Here is the system architecture plan.

---

# Touch Padel Phase 1 — System Architecture Plan

Supplier: Kagu Web Studio · Fixed stack per signed SoW v1.0 · Build weeks 2026-08-24 → 2026-09-20, review through 2026-10-04.

---

## 1. Monorepo Layout

```
touchpadel/
├── pnpm-workspace.yaml
├── turbo.json
├── package.json                      # private, engines: node >=20, packageManager: pnpm@9
├── tsconfig.base.json                # strict, moduleResolution: bundler, paths for @touch/*
├── .npmrc                            # node-linker=hoisted (needed for Expo + electron-builder)
├── eslint.config.mjs                 # flat config, shared; per-app overrides via files globs
├── .prettierrc.json                  # single shared config, no per-app overrides
├── .github/workflows/                # ci.yml, mobile-eas.yml, operator-release.yml, db-migrate.yml
├── apps/
│   ├── mobile/                       # Expo SDK 52+, expo-router, padel booking ONLY
│   │   ├── app/                      # expo-router file routes
│   │   ├── app.config.ts             # reads EXPO_PUBLIC_* from env per EAS profile
│   │   └── eas.json                  # profiles: development, staging, production
│   ├── web/                          # Next.js 15 App Router on Vercel
│   │   ├── app/[locale]/(public)/    # venue pages, menu (read-only)
│   │   ├── app/[locale]/t/[token]/   # cafe table-bound ordering experience (Touch Cafe theme)
│   │   ├── middleware.ts             # locale negotiation + table-token cookie exchange
│   │   └── next.config.ts
│   ├── operator/                     # Vite + React SPA (renderer payload for Electron)
│   │   ├── src/routes/               # TanStack Router file-based routes
│   │   ├── src/features/{till,desk,kds,stock,admin,dayclose}/
│   │   ├── src/ipc/                  # typed bridge client (see §2)
│   │   └── vite.config.ts
│   └── operator-shell/               # Electron main + preload (electron-builder lives here)
│       ├── src/main/                 # main process: queue, LAN server, printing, updater, kiosk
│       ├── src/preload/              # contextBridge, typed IPC surface
│       ├── electron-builder.yml
│       └── package.json              # the ONLY package with electron/better-sqlite3 deps
├── packages/
│   ├── db/                           # @touch/db
│   │   ├── supabase/config.toml
│   │   ├── supabase/migrations/      # NNNN_name.sql — the only source of schema truth
│   │   ├── supabase/functions/       # edge functions: heartbeat-monitor, table-token, replay
│   │   ├── seed/                     # seed.sql + fixtures/*.ts (courts, menu, recipes — see §7)
│   │   └── src/types.gen.ts          # supabase gen types output, committed
│   ├── core/                         # @touch/core — pure TS, zero platform deps
│   │   ├── src/money.ts              # integer IQD, split/rounding rules
│   │   ├── src/pricing/              # rate-rule resolution
│   │   ├── src/schemas/              # zod schemas: orders, reservations, queue mutations
│   │   ├── src/queue/                # mutation envelope types + idempotency key helpers
│   │   └── src/status/               # order/ticket/reservation state machines
│   ├── ui/                           # @touch/ui — shared web components (web + operator only)
│   │   └── src/theme/                # tokens: padel palette + cafe palette (CSS vars)
│   ├── i18n/                         # @touch/i18n — message catalogs en/ar, ICU, RTL helpers
│   └── config/                       # @touch/config — shared tsconfig fragments, eslint presets
└── tools/
    └── concurrency-tests/            # contractual booking-collision suite (vitest + pg client)
```

**pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tools/*"
```

**turbo.json** (key pipeline)

```json
{
  "tasks": {
    "gen:types": { "cache": true, "inputs": ["supabase/migrations/**"], "outputs": ["src/types.gen.ts"] },
    "build": { "dependsOn": ["^build", "@touch/db#gen:types"], "outputs": ["dist/**", ".next/**"] },
    "typecheck": { "dependsOn": ["@touch/db#gen:types"] },
    "test": { "dependsOn": ["@touch/db#gen:types"] },
    "test:concurrency": { "cache": false },
    "lint": {}
  }
}
```

**tsconfig strategy:** `tsconfig.base.json` with `strict: true`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. Packages use TS project references and export raw `.ts` via `exports` + `tsx`-friendly bundler resolution — apps compile packages themselves (no build step for internal packages; keeps 4-week velocity). `apps/mobile` extends `expo/tsconfig.base`; `operator-shell` has ONE tsconfig covering both `main` and `preload` (CommonJS, node types) — plus, since 2026-08-28, a `tsconfig.test.json` that exists only because the build project sets `rootDir: src` / `outDir: dist` and test files must not be emitted into the packaged output.

**Team mapping (SoW tracks → this team):**
- Track A (platform/data/degraded/queue/LAN/printing) → **user + AI agents** (weeks 1–4).
- Track B (mobile) → **Frontend dev 1**.
- Track C (web/cafe) → **Frontend dev 2**.
- Track D (operator UI) → **both frontend devs share** after their shells land in week 1–2 (desk calendar → dev 1, till/KDS → dev 2); user owns the Electron shell.
- **Security reviewer**: standing reviews at end of week 1 (RLS policy suite + table-token design), week 3 (PIN escalation + audit log + queue replay), week 4 (pre-handover pass; also owns the `security-review` of the anonymous cafe RLS).

---

## 2. Operator App Architecture

The SoW calls it "a wrapper around the same web application" — contractually the *application UI* is shared, but architecturally it is a **locally-bundled SPA** (Vite build shipped inside the Electron package, loaded from `file://`/`app://` protocol, never from a URL). This is what makes Module 7 possible: the UI boots with zero network.

### 2.1 Process split

**Main process (`operator-shell/src/main/`)** owns everything durable and hardware-facing:
- `queue/` — SQLite durable write queue (better-sqlite3, WAL mode)
- `sync/` — replay engine + reference-data cache refresher
- `lan/` — WebSocket server for KDS fallback (§2.5)
- `print/` — ESC/POS raster pipeline (§6)
- `heartbeat/` — POSTs to edge function every 10 s (§3)
- `kiosk/` — window policy, single-instance lock, auto-update
- `station.ts` — station identity: `station_id` (e.g. `TILL1`, `DESK1`, `KDS1`) from `station.json` written by the installer; role of the machine, not the human

**Renderer (the `apps/operator` SPA)** is pure UI + Supabase client for *reads and realtime only*. **All writes that must survive an outage go through IPC to the main-process queue — even when online.** One write path, exercised every day, so degraded mode is not a separate code path that rots.

**Preload bridge** (`contextBridge.exposeInMainWorld('touch', …)`), typed from `@touch/core/schemas`:

```ts
interface TouchBridge {
  enqueue(m: MutationEnvelope): Promise<{ localId: string; state: 'queued' }>;
  onQueueUpdate(cb: (s: QueueStatus) => void): Unsub;     // depth, degraded flag, conflicts
  onLanTicket(cb: (t: KitchenTicket) => void): Unsub;     // KDS fallback feed
  getCachedRef<K extends RefKey>(key: K): Promise<RefData[K]>;
  print(job: PrintJob): Promise<PrintResult>;
  unlockPin(pin: string): Promise<{ staffId: string; role: Role; grantToken: string } | null>;
  getStation(): StationInfo;
}
```

SPA framework: **Vite + React + TanStack Router** (file-based, typed search params — useful for `?tab=`, `?date=` in till/calendar) + TanStack Query for reads. No Next.js in the operator: no server, no SSR, deterministic offline boot.

### 2.2 SQLite durable queue

DB at `app.getPath('userData')/queue.db`, `journal_mode=WAL`, `synchronous=FULL` (flush-before-confirm is contractual).

```sql
CREATE TABLE mutation_queue (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,   -- replay order
  local_id       TEXT NOT NULL UNIQUE,                -- '{station_id}-{ulid}' e.g. 'TILL1-01J5X...'
  idempotency_key TEXT NOT NULL UNIQUE,               -- '{station_id}:{mutation_type}:{ulid}'
  mutation_type  TEXT NOT NULL,                       -- 'order.create' | 'order.add_items' | 'ticket.status' | 'payment.record' | 'reservation.create' | ...
  payload        TEXT NOT NULL,                       -- JSON, zod-validated before insert
  created_at     TEXT NOT NULL,                       -- station clock, informational
  state          TEXT NOT NULL DEFAULT 'pending',     -- pending|inflight|acked|conflict|failed
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  server_result  TEXT                                 -- JSON echo (server ids, timestamps) on ack
);
CREATE TABLE ref_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE pin_cache (staff_id TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, role TEXT NOT NULL, updated_at TEXT NOT NULL); -- argon2 hashes, refreshed online, enables PIN unlock during outage
```

**Write protocol:** renderer `enqueue()` → main validates against zod schema → `INSERT` + transaction commit (WAL fsync) → **only then** resolve IPC promise → UI confirms → sync loop attempts upload immediately when online.

**Replay protocol:** on reconnect, upload strictly by `seq`, one at a time, to edge function `POST /functions/v1/replay` with body `{ idempotency_key, mutation_type, payload, station_id }`. Server keeps `processed_mutations(idempotency_key primary key, result jsonb, processed_at)`; duplicate key → return stored result, 200. Reservation replays that hit the EXCLUDE constraint return `409 conflict` → row state `conflict`, surfaced in the operator UI for the desk to resolve manually (per SoW "the one honest limit"). Stock driven negative settles server-side and raises a manager flag — never blocks replay. Day close is refused while `state IN ('pending','inflight','conflict')` rows exist.

**Local IDs in payloads:** client-generated entity ids are ULIDs prefixed with station (`TILL1-…`) so two stations can't collide; server stores them in a `client_ref` column and assigns canonical UUIDs + `server timestamps`. All FK references inside a queued batch use `client_ref`.

### 2.3 Cached reference data

Cached in `ref_cache` (not renderer memory) so a restart mid-outage still works. Keys: `menu` (categories/items/sizes/modifiers/i18n/availability), `prices`, `recipes` (for local grey-out heuristics only; consumption is server-side), `courts`, `tables`, `tax_config`, `staff_pins` (hashes), `reservations:today+tomorrow`, `open_tabs`. Refresh triggers: on boot, on realtime change events for those tables, and a 5-minute failsafe poll. `fetched_at` shown in the degraded banner ("trading from data as of 14:02").

### 2.4 KDS deployment + LAN fallback

The KDS machine runs the **same Electron build** with `station.json: { station_id: "KDS1", mode: "kds", till_host: "192.168.1.10" }` — one installer, one codebase (SoW: "one application, role-based views").

Normal operation: KDS subscribes to Supabase Realtime for tickets. Fallback subsystem in the **till's** main process:

- **Protocol:** WebSocket server, `ws://<till>:47810`, JSON frames `{ type: 'ticket.new'|'ticket.snapshot'|'status.update', seq, data }`. Till pushes every kitchen-bound mutation it enqueues; KDS sends `status.update` (item ready / ticket complete) frames back, which the till enqueues into *its* SQLite queue on the KDS's behalf (single-writer preserved — only the till machine owns the durable queue).
- **Discovery:** static IP in `station.json` (venue LAN, 2 machines — mDNS/bonjour is a nice-to-have, static IP is the week-3 install reality; spec the till's DHCP reservation in the hardware document).
- **Security:** pre-shared key generated at install, stored in both `station.json` files; WS handshake `Authorization: Bearer <psk>`; server binds to LAN interface only. Threat model is a venue LAN — PSK + non-routable bind is proportionate; the security reviewer signs off.
- **Failover logic on KDS:** connect the LAN socket *always* (it's cheap); render from Supabase Realtime while healthy; when heartbeat state says degraded (or Supabase socket drops >15 s), switch source to LAN feed, request `ticket.snapshot` to resync. On recovery, Realtime resumes and dedupes by ticket `client_ref`.

### 2.5 Kiosk behavior

- `app.requestSingleInstanceLock()`; `autoHideMenuBar`, `kiosk: true` on till/KDS, frame off; `closable: false` except via manager PIN → `Quit to desktop` menu action.
- Launch on boot: electron-builder NSIS `runAfterFinish` + `HKCU\...\Run` registry entry set by a first-run step; `app.setLoginItemSettings` as belt-and-braces.
- Crash recovery: `webContents` `render-process-gone` → reload; main-process crash → NSSM-free approach: a tiny watchdog via Windows Task Scheduler task "restart if not running" (documented in runbook).
- **Auto-update:** electron-updater against GitHub Releases, `autoDownload: true`, but `quitAndInstall` only when: queue empty, no open day, and between 03:00–06:00 or manager-initiated. Never mid-trading.

---

## 3. Heartbeat & Degraded Mode — End to End

**Tables (migration `NNNN_degraded_mode.sql`):**

```sql
CREATE TABLE venue_status (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),        -- singleton
  mode text NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal','degraded')),
  last_heartbeat_at timestamptz,
  degraded_since timestamptz,
  protected_horizon interval NOT NULL DEFAULT '48 hours'   -- configurable, per SoW "today and tomorrow"
);
CREATE TABLE degraded_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration interval GENERATED ALWAYS AS (ended_at - started_at) STORED,
  queued_items_replayed int,
  conflicts int DEFAULT 0
);
```

**Till-driven, server-enforced:**
1. Till main process POSTs `heartbeat` edge function every **10 s** (`station_id`, queue depth, app version). Function updates `venue_status.last_heartbeat_at` and, if mode was `degraded`, flips to `normal` and closes the open `degraded_periods` row.
2. **Detection is server-side**: a `pg_cron` job every 15 s (or the heartbeat function evaluated lazily — chosen: **`pg_cron` every 15 s** so it fires even with zero traffic): if `now() - last_heartbeat_at > 30s` and mode = normal → set `degraded`, open a `degraded_periods` row.
3. **Guest write refusal is in the database, not the UI**: the `create_reservation(...)` and `create_cafe_order(...)` SECURITY DEFINER functions (the only write paths RLS grants to guests) begin with:
   ```sql
   IF (SELECT mode FROM venue_status) = 'degraded'
      AND p_start_at < now() + (SELECT protected_horizon FROM venue_status)
   THEN RAISE EXCEPTION 'venue_degraded' USING ERRCODE = 'P0DEG'; END IF;
   ```
   Cafe orders/waiter calls: blocked entirely while degraded. Reservations: blocked only inside the horizon — a booking for next Saturday proceeds.
4. Clients map `P0DEG` to the contractual UX: mobile shows the venue phone number; web tells the guest to see a member of staff; both keep read views alive.
5. **Recovery:** first successful heartbeat flips mode back *but* guest writes for the horizon stay refused until the till reports `queue_depth = 0` in its heartbeat (add `writes_unlocked_at`) — prevents a guest booking racing an unreplayed offline booking. The replay conflict path (§2.2) covers the residual seconds-wide window; the SoW explicitly does not claim zero.

---

## 4. Auth & Session Architecture

| Client | Identity | Mechanism |
|---|---|---|
| Mobile | Guest account | Supabase email+password, email verify, refresh tokens in `expo-secure-store` |
| Web (public) | Anonymous or optional guest sign-in | Supabase anonymous sign-in when a table token is presented; optional email sign-in attaches orders |
| Web (cafe table) | **Anonymous table session** | See below |
| Operator | Staff account + PIN escalation | See below |

**Cafe anonymous table session:** guest scans QR → `GET /t/{table_token}` → Next.js middleware verifies token signature (§6.2), calls `supabase.auth.signInAnonymously()`, then edge function `table-token` **stamps the table binding into the anonymous session** via `auth.admin.updateUserById` app_metadata: `{ table_id, table_session_exp }`. RLS then authorizes without trusting client input:

```sql
-- orders: anonymous guest may insert only for their bound table, via the RPC; may read own orders
CREATE POLICY guest_read_own_orders ON orders FOR SELECT
  USING (created_by = auth.uid()
     AND table_id = (auth.jwt() -> 'app_metadata' ->> 'table_id')::uuid
     AND (auth.jwt() -> 'app_metadata' ->> 'table_session_exp')::timestamptz > now());
```
Order creation and waiter call go through SECURITY DEFINER RPCs (`create_cafe_order`, `raise_waiter_call`) that re-check binding expiry, degraded mode, and per-table rate limits (waiter calls: max 1 open call per table per reason). Binding expiry = configurable inactivity window stored on `tables.session_ttl` (default 3 h); the token itself also expires (§6.2). Anonymous session cookie is Supabase's standard `sb-*` cookie via `@supabase/ssr`.

**Staff on shared tills:** the *machine* signs in once with a station Supabase account (role `station`, near-zero table grants — reads of menu/tickets only, realtime). Every **write** carries a human: staff enter their PIN → main process verifies against `pin_cache` (argon2id) → issues a short-lived local grant (renderer state, 5 min idle timeout for cashier actions). The queued mutation payload includes `staff_id` + a `pin_proof` (HMAC over idempotency_key with a per-staff server-shared secret rotated when PIN changes); the replay function verifies proof server-side and stamps `actor_id` — so an audit-log actor can't be forged by a compromised renderer, and PIN unlock still works offline. **Sensitive actions** (discount, void, price override, refund, reservation override, stock adjustment) additionally require a fresh PIN entry (no idle grant) and a `reason_code`, and the RPCs write `audit_log(actor_id, action, entity, before jsonb, after jsonb, reason_code, station_id, at)` — `audit_log` has INSERT-only RLS, no UPDATE/DELETE policies for anyone, including managers.

**Roles:** `staff_members(id, auth_user_id, display_name, role text CHECK (role IN ('cashier','prep','court_desk','manager','owner')), pin_hash, active)`. Role checks in RLS via a `current_staff_role()` helper; hierarchy encoded in a lookup, not in string comparisons. Owner manages staff via operator admin screens (owner-only policies).

---

## 5. Realtime Channel Design

One venue, low fan-out — bias to **postgres_changes** (simple, RLS-enforced) except where RLS rows aren't visible to the subscriber.

| Event | Mechanism | Channel/filter | Subscriber auth |
|---|---|---|---|
| New/updated kitchen tickets | postgres_changes on `order_tickets` | `station` role has SELECT on tickets | operator (KDS, till) |
| Guest order status | **broadcast** from `order_status_broadcast()` trigger → channel `table:{table_id}` | private channel; Realtime authorization policy checks `app_metadata.table_id` | web guest |
| Waiter calls | postgres_changes on `waiter_calls` | staff-only SELECT | operator floor view |
| Freed/held court slots | broadcast → channel `availability:{date}` (payload: court_id, range, state) | public read; no PII in payload | mobile, operator desk |
| Menu/availability edits | postgres_changes on `menu_items`, `item_availability` | anon SELECT already granted | web, operator ref-cache |
| Venue mode changes | postgres_changes on `venue_status` | anon SELECT (single row, no secrets) | all three clients |

Guest order status uses broadcast because the guest's RLS view is scoped to `created_by = auth.uid()` yet status flips are written by staff — broadcast from a trigger avoids fragile RLS-on-replication edge cases and leaks nothing (payload: order client_ref + status only). Freed slots use broadcast because holds/blocks rows aren't guest-visible but their *absence* is what the grid needs.

---

## 6. Printing Pipeline & QR Table Tokens

### 6.1 Arabic thermal receipts (raster)

Pipeline lives entirely in the Electron **main** process:
1. Renderer sends `PrintJob` (structured bill data, not markup) over IPC.
2. Main renders `receipt.html` (Frutiger LT Arabic embedded as woff2, CSS logical properties, width fixed to printer dots — 576 px for 80 mm/203 dpi, 384 px for 58 mm) in a **hidden offscreen BrowserWindow** → `webContents.printToPDF`? No — `capturePage()` → PNG. Chromium does the Arabic shaping/bidi; the printer never sees text.
3. PNG → 1-bit dither (`sharp` threshold) → ESC/POS `GS v 0` raster command via `node-thermal-printer`/raw socket or USB (`escpos-usb`).
4. Print jobs are queued in SQLite too (`print_queue`), so a paper-out doesn't lose a bill; reprint from till UI.

**Week-1 deliverable to client (add to chase list): printer spec** — 80 mm ESC/POS thermal, 203 dpi, USB **and** Ethernet interfaces, `GS v 0` raster support, Windows driver optional (we write raw). Named acceptable models: Epson TM-T20III, Xprinter XP-80C class. Cash drawer RJ11 kick via printer (drawer-open pulse `ESC p` — SoW records drawer *opening record*, not control, but the pulse is free if the drawer is printer-connected).

### 6.2 QR table token

- Format: `https://<domain>/t/{token}` where token = **compact JWS (ES256)**, claims `{ tid: <table_uuid>, ver: <rotation int>, iat }`. No expiry in the *printed* token (a printed card can't refresh); expiry is enforced by comparing `ver` to `tables.token_version` and by the session-binding TTL (§4).
- Rotation: manager bumps `tables.token_version` in operator admin → old QR verifies signature but fails `ver` check → "ask staff for the new code". Reissue print-ready artwork (a `qr-artwork` script in `packages/db/seed` renders SVG/PDF per table in Touch Cafe branding).
- Signing key: ES256 private key held only in the `table-token` edge function secrets; public key baked into web middleware for stateless verification. Verification also confirms the table exists + is active before minting the anonymous binding.

### 6.3 Money

`@touch/core/money.ts`: `type IQD = number & brand` — **integer whole dinars everywhere** (DB columns `bigint`, never numeric-with-scale). Bill splits: largest-remainder allocation so parts sum exactly to the total; cash rounding rule configurable to nearest 250 IQD (`round_cash_to` in `venue_settings`, default 250, display the rounding line on the bill). Percentage discounts and tax round half-up to 1 IQD per line, recomputed at bill level with a reconciliation adjustment line if needed.

---

## 7. Supabase Local Dev, Link-Later, Env & Types

**Now (no client project yet):** `supabase init` in `packages/db`; everyone runs `pnpm db:start` (`supabase start` — Docker), `pnpm db:reset` (`supabase db reset` = migrations + `seed/seed.sql`). **All schema changes are migration files, no dashboard edits ever.** Staging: a Kagu-owned Supabase project provisioned week 1, migrated by CI.

**Link-later (client hands over project, week 2–3 target):** `supabase link --project-ref <touch-prod-ref>` → `supabase db push` → rotate all env secrets → run `seed/prod-baseline.sql` (settings + roles only, no fixtures). Because nothing exists outside migrations, this is a one-hour operation.

**Seed/fixture strategy with hard swap point:** `packages/db/seed/fixtures/` holds realistic invented data — 4 courts (2 indoor/2 outdoor) with rate rules, a ~40-item cafe menu with sizes/modifiers/Arabic names, ~60 ingredients with measured-looking recipes, 12 tables. Every fixture row carries `is_fixture = true`. The **swap point** is a single command `pnpm db:swap-client-data` that deletes `is_fixture` rows and loads `client-data/*.csv` (templates issued to Touch in week 1). Build never blocks on the client; acceptance testing runs on real data the moment it lands.

**Client-chase checklist (issue 2026-08-25):** court list/hours/rates/cancellation policy; currency+tax confirmation (assume IQD — get it in writing); branding assets; full menu (template CSV); domain + DNS access; funded Supabase account; EN/AR copy (wk 2); table numbering/floor plan (wk 2); **measured recipes** (template, wk 2 — flagged as the phase's largest risk per SoW); ingredient list (wk 2); staff list (wk 3); hardware per our spec incl. printer + UPS + till static IP (wk 3); weekly Mustafa demo slot.

**Type generation:** `pnpm --filter @touch/db gen:types` → `supabase gen types typescript --local > src/types.gen.ts`, **committed**; CI job regenerates and fails on diff (schema/types drift breaks the build, per SoW). `@touch/core` re-exports narrowed row types.

**Env management:**

| App | Local | Staging | Prod |
|---|---|---|---|
| web | `.env.local` (supabase start URLs) | Vercel env (preview) | Vercel env (production) — client Supabase |
| mobile | `.env` via `app.config.ts` | `eas.json` staging profile env | production profile env |
| operator | `station.json` + build-time `import.meta.env` | staging release channel | prod release channel |
| db/functions | `supabase/functions/.env` | dashboard secrets | dashboard secrets |

Only `EXPO_PUBLIC_`/`NEXT_PUBLIC_`/`VITE_` anon keys and public OAuth client identifiers ship to clients; service-role key exists solely in edge function secrets and CI (`db-migrate.yml`). An `env.ts` zod-validated loader in each app fails fast on missing vars.

**Mobile public env, per profile** (`apps/mobile/.env.example` documents the local shape; `eas.json` carries the staging/production values):

| Var | What it is | Unset ⇒ |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase project URL + anon key — public by design, RLS is the protection | `src/lib/supabase.ts` surfaces a config error (never a module-scope throw) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google **Web** OAuth client id (social sign-in, vendor addition 2026-09-01). Passed to the native SDK and also the `aud` of Android id tokens; listed first in Supabase → Auth → Providers → Google → Client IDs | Google button hidden |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google **iOS** OAuth client id; its reversal is the iOS URL scheme the config plugin needs (derived in `app.config.ts`, no third var); listed second in Supabase | Google button hidden; `expo start` / `expo export` warn and skip the plugin; an **EAS build fails at config time** |

Both Google values are **public identifiers, not secrets** (the Web client *secret* stays in the Google Cloud console and is unused by the native id-token flow — `API.md` §9). Apple needs no env: the bundle id is its client id, and the button is hidden in Expo Go on Android because Apple is iOS-only by decision.

---

## 8. CI/CD Sketch (GitHub Actions)

- **`ci.yml`** (every PR): pnpm install → `turbo lint typecheck test build` → spin `supabase start` in the runner → `turbo test:concurrency` (the contractual suite: N parallel `create_reservation` calls at one slot, assert exactly 1 success; runs on every PR, not just release).
- **`db-migrate.yml`**: on merge to `main`, `supabase db push` to staging; manual `workflow_dispatch` with environment approval for prod (client project once linked).
- **web**: Vercel Git integration — preview per PR (the SoW's "preview deployment per change" for Mustafa), production on `main`. Staging env vars on previews.
- **`mobile-eas.yml`**: PR → `eas update` to a preview channel (Expo Dev Client); tag `mobile-v*` → `eas build --profile production --auto-submit` both stores (Kagu accounts per SoW). OTA (`eas update`) for copy/JS fixes during weeks 5–6.
- **`operator-release.yml`** (as shipped 2026-09-05): tag `operator-v*` → `prepare` (version from the tag; which secrets exist) → `windows` (windows-latest: renderer with hosted env baked in, esbuild bundle, `electron-builder --win nsis --publish always`) → optional `macos` (only when Apple secrets exist). Publishes to the PUBLIC repo `KaguSoftware/touchpadel-releases`, which is both the staff download host (`/download` on the guest site links to `…/releases/latest/download/Touch-Padel-Operator-Setup.exe`) and the electron-updater feed. Signing is conditional on secrets — Azure Trusted Signing or a PFX (`apps/operator-shell/electron-builder.config.cjs`); unsigned until the owner sources one (`docs/client/operator-download-2026-09-05.md`). One update channel (`latest`); the `beta` channel idea was dropped — a staging till is a second station on the hosted project, not a second feed.
- Error tracking: Sentry (Kagu account) on web ordering path, mobile, and operator main+renderer; uptime check on `heartbeat` function and the booking API path (contractual monitoring line item).

---

## Sequencing (this team, 4 weeks)

- **W1 (user+agents):** monorepo scaffold, migrations for auth/roles/RLS/i18n content model, `venue_status` + heartbeat, reservations table with `btree_gist` EXCLUDE + concurrency suite green, CI, staging, printer spec + client templates issued. **FE1:** Expo shell, auth, RTL. **FE2:** Next shell, locale routing, theme tokens (both palettes).
- **W2 (user):** menu/recipe/order schema, RPCs (`create_reservation`, `create_cafe_order`), realtime channels, table-token function, Electron shell + IPC bridge + SQLite queue skeleton. **FE1:** availability grid, slot holds. **FE2:** menu render, token binding; both start operator routes (desk calendar / till grid).
- **W3 (user):** replay function + idempotency, degraded lockout end-to-end, PIN escalation + audit RPCs, printing pipeline, day-close model. **FE1:** booking E2E, push, then desk calendar ops. **FE2:** basket/ordering/waiter call/status, then cashier tabs/splits/KDS. **Security reviewer:** RLS + PIN + replay review.
- **W4:** stock module (user: ledger/FEFO/variance SQL; FE devs: stock UI), LAN KDS fallback, kiosk hardening, store submission, disconnection drill, load test. Fallback per SoW priority order: batch expiry gives way first, then queue polish slips into review weeks.

### Critical Files for Implementation
- `packages/db/supabase/migrations/0001_foundations.sql` (roles, staff, RLS helpers, audit_log)
- `packages/db/supabase/migrations/0002_reservations.sql` (EXCLUDE USING gist, holds, rate rules)
- `apps/operator-shell/src/main/queue.ts` — SQLite durable queue. **NOT a replay engine**: as
  of 2026-08-28 it stores and reports, and there is no dequeue, no sync worker and no caller.
  `touch.enqueue` has zero call sites in the SPA. See
  `docs/design/operator-audit-2026-08-28.md` C2 for what is actually there and what building the
  replay half requires (starting with `staffId`/`deviceId`, which the envelope omits and
  `functions/replay/index.ts` rejects the request without).
- `packages/core/src/schemas/mutations.ts` (mutation envelope, idempotency keys — shared by queue, replay function, tests)
- `packages/db/supabase/functions/replay/index.ts` (idempotent replay endpoint + `processed_mutations`)