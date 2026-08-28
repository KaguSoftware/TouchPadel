# Operator desktop app — audit, 2026-08-28

**Subject:** `apps/operator` (Vite + React + TanStack Router SPA) and `apps/operator-shell`
(Electron main/preload) — together the SOW's "Operator desktop app", the only deliverable
installed on Touch's own hardware.

**Method:** every claim below was read out of the code at the cited line, or run. Nothing is
inferred from the design docs; where a design doc and the code disagree, the code is quoted.
The contract text is `docs/scope/touch-padel-phase1-scope-of-work.txt` and every `L…` reference
points into that file.

**Standing:** report plus a scheduled fix plan. Wave 0 (lint, test harness, CI e2e, this
document) has landed; nothing else has. See §8.

---

## 1. Verdict at a glance

| SOW module | Acceptance test | Desktop status |
|---|---|---|
| 1 Foundations | roles confirmed by a written role test (L225-230) | **Partial** — the role matrix is default-deny and tested, but owner-managed staff accounts (L234) and the audit-log viewer (L241-243) do not exist, and there is no short-lived session on the shared till (L237) |
| 2 Reservation | guest booking appears on the desk calendar; staff create, move, cancel (L290-296) | **Partial** — day view only (L307 requires week), no shorten, no court records admin (L299-300), no closed-dates editor (L319), overrides audited without a reason (L313) |
| 3 Cafe guest | ticket reaches the kitchen screen; waiter call reaches the floor view; tab settles at the till (L353-359) | **Built** — KDS, `WaiterCallsPanel` and till settle all work |
| 4 Cashier & dispatch | a full trading day; day close reconciles cash and card; every discount, void and refund traceable (L434-439) | **Partial** — no refund, no price override, no merge, no split-by-item, no cash-drawer record, no receipt printing; charge-to-booking omits the court price |
| 5 Stock & recipes | physical count → variance report reconciles (L509-514) | **Absent** — `routes/stock.tsx` renders one `<h1>`; no `src/features/stock/` exists |
| 6 Website | site matches the desktop app; reflects a till change without a redeploy (L581-587) | **Built** — the cafe content editors drive the guest site |
| 7 Degraded mode | till keeps trading disconnected; queued items replay exactly once (L659-665) | **Absent on the client**, and it fails silently — see C1 and C2 |

Two further deliverable-level facts: the app **cannot be packaged** (§5), and until today
`pnpm turbo lint` was a no-op for both packages while 89 React components had no unit test of
any kind (§6).

---

## 2. Critical

### C1 — The heartbeat has never worked, and its failure is invisible

`apps/operator-shell/src/main/heartbeat.ts:25` POSTs to `${SUPABASE_URL}/functions/v1/heartbeat`.

**That edge function does not exist.** `packages/db/supabase/config.toml:78-89` registers six
functions — `replay`, `send-push`, `telegram-send`, `telegram-callback`, `analytics-posthog`,
`analytics-insights`. There is no `heartbeat`.

Four independent reasons it could not work even if the endpoint existed:

1. No `Authorization` header (`heartbeat.ts:26-27`), while `app.heartbeat` opens with
   `if not app.is_staff(...) then raise FORBIDDEN`
   (`20260827000026_hardening_fixes.sql:793-795`).
2. No `p_is_till` in the payload. `app.is_degraded()` identifies a till as
   `is_till OR device_id LIKE 'TILL%'` (`…26:770-777`), so today it would be recognised only by
   accident, through the default station id `TILL1` (`station.ts:41`).
3. `heartbeat.ts:22-23` returns early when `process.env.SUPABASE_URL` is unset — which it always
   is in a packaged build, because nothing sets it.
4. `heartbeat.ts:34-37` swallows every error, 404 and 403 included, with no log.

**Consequence.** The only writer of `device_heartbeats` in the entire repository is the test
helper at `e2e/tests/helpers.ts:125`. In production the table stays empty, so `app.is_degraded()`
— `exists(any till row) AND NOT exists(fresh till row)` — is permanently **false**, and every
degraded guard that is already wired live becomes inert: `0008_reservations.sql:66`,
`0015_tabs_orders.sql:492`, `0016_waiter_calls.sql:41`, `0032_telegram.sql:912,1000`,
`0038_concurrency_locks.sql:190`.

That is the contract's most-emphasised safety property — "the app and website are locked out of
near-term writes so nothing can be sold twice" (L723-736), "guest writes are refused server-side
— not hidden in the interface" (L667-668). It does not exist in the shipped product.

Second order: `close_day` Guard 2 refuses a close while `queue_depth > 0`
(`0020_day_close.sql:58-65`). With no heartbeat row ever written, that guard is inert too.

### C2 — The "one write path" is not implemented; the till cannot trade through an outage

`design-arch.md:114` locks it and `design-delivery.md:87` calls it "the single most important
de-risking decision". Both `apps/operator/src/main.tsx:38` and `src/lib/supabase.ts:4-7` carry a
`TODO(Electron)` admitting it has not happened.

`touch.enqueue` is called **zero times**. The complete set of bridge call sites in the SPA is
three, all `getStation()`: `src/lib/idem.ts:11`, `src/lib/idem.ts:16`,
`src/routes/__root.tsx:45`. Every write is an online PostgREST round-trip through
`src/lib/appRpc.ts:44-63`.

The shell half is equally incomplete. `mutation_queue` has no dequeue anywhere in the repo;
`ack()` is exported at `queue.ts:66` and never called; nothing ever writes `ref_cache` or
`pin_cache`, so `getCachedRef` can only return `undefined`; `queueStatus().degraded` is
hard-coded `false` (`queue.ts:87`); the sync worker is a seven-line comment (`queue.ts:98-104`).

Every clause of L671-689 is therefore unmet: no cached reference data, no durable queue in the
path, no kitchen display continuing from that queue, no flush-before-confirm on the real write
path, no banner with mode and queued count, no day-close block on unsynced items.

**The server half is finished.** `packages/db/supabase/functions/replay/index.ts` (387 lines)
does two-layer idempotency (a `sync_replays` pre-flight plus `app.claim_replay`,
`0049_replay_idempotency.sql:44-92`), returns 409 with a `manager_alerts` row on an exclusion
conflict, and records mapped errors rather than dropping them. It is covered by
`packages/db/tests/replay-idempotency.test.ts`. The client is what is missing.

One blocker for the fix: the envelope shapes disagree. `operator-shell/src/ipc-channels.ts:16-26`
and its hand-maintained mirror `operator/src/ipc/bridge.ts:11-22` both omit `staffId` and
`deviceId`, which `packages/core/src/schemas/mutations.ts:219-228` requires (the schema is
`.strict()`) and without which `replay/index.ts:247` rejects the request.

### C3 — Module 5 has no user interface at all

`apps/operator/src/routes/stock.tsx:14-21` is the whole feature:

```tsx
function StockPlaceholder() {
  const { tr } = useLocale();
  return (<RequireRole route="/stock"><h1>{tr('stock.title')}</h1></RequireRole>);
}
```

There is no `src/features/stock/` directory. `/stock` is nonetheless in `ROUTE_ROLES`
(`lib/auth.tsx:117`) and rendered in the sidebar (`routes/__root.tsx:36`), so every manager and
owner sees a live nav link to a bare heading.

Unreachable from any UI, all already built and tested server-side: `receive_delivery`,
`record_production`, `record_waste`, `write_off_expired`, `start_count`, `finalize_count`,
`flag_expired_batches`, and the views `v_variance_report`, `v_ingredient_on_hand`,
`v_item_cogs`, `v_item_margin`, `v_expiring_soon`, `v_expired`. `manager_alerts` — where the
low-stock and par-level alerts of L546-547 land — has no reader anywhere in the repo.

Module-5 acceptance (L509-514) cannot be demonstrated except by typing SQL.

---

## 3. High

### H1 — No error boundary and no 404 route, in a kiosk with no menu bar

Searching `apps/operator/src` for `ErrorBoundary`, `componentDidCatch`,
`getDerivedStateFromError`, `errorComponent` or `notFoundComponent` returns **nothing**. The
window is created with `kiosk: true` and `autoHideMenuBar: true` for till and KDS stations
(`operator-shell/src/main/index.ts:21-22`).

`index.ts:57` reloads on `render-process-gone`, but a React render throw is not a process crash —
it will not recover. A cashier facing a blank kiosk mid-service has no menu, no address bar and
no way back.

### H2 — Three query cache keys are shared across features with different data

One global `QueryClient` (`main.tsx:40`), `staleTime: 10_000`.

- `['cafeTables']` — `features/till/TillScreen.tsx:633` selects 2 columns where
  `is_active = true`; `features/admin/qr/queries.ts:6` selects 5 columns where
  `is_active = false`. Navigating QR-admin → till serves the till's **new-tab table picker a
  list of inactive tables**.
- `['settings']` — `features/desk/DeskCalendar.tsx:71` selects `timezone, opening_hours,
  closed_dates`; `features/admin/OpeningHoursEditor.tsx:31` selects only two of those. Prime the
  cache from the editor and `DeskCalendar.tsx:95` reads `timezone` as `undefined` and silently
  falls back to a hard-coded constant — the calendar renders in the wrong timezone, with no error.
- `['courts']` — `DeskCalendar.tsx:83` (5 columns including `sort_order`) versus
  `RateRuleEditor.tsx:48` (4 columns). The desk grid's ordering field can vanish from under it.

### H3 — A reorder can silently revert another manager's edit

`features/admin/menu/MenuEditor.tsx:61` and `menu/CategoryEditor.tsx:180` implement the ▲▼
buttons by calling `upsert_menu_item` / `upsert_menu_category` with the **entire row rebuilt
from the local React Query cache** (`itemUpsertArgs`; `photo.ts:32-59` shows the payload carries
`p_name_en/ar`, `p_description_en/ar`, `p_hook_en/ar`, `p_highlight`, `p_is_active`,
`p_tax_group_id`). If a colleague edited that item since this client last fetched, moving it one
position up reverts their edit — no warning, no conflict.

### H4 — Multi-write saves are neither atomic nor resumable

- `features/admin/hero/HeroBuilder.tsx:190` — `for (const write of writes) await
  setSetting.mutateAsync(write);` with no rollback. A mid-loop failure leaves the guest hero
  half-configured.
- `features/admin/qr/QrPage.tsx:91-94` — token rotation in a loop. A failure at table 7 of 20
  leaves **seven printed QR cards dead and thirteen live**, with nothing on screen saying which.

### H5 — Electron: nothing constrains navigation, and `openExternal` takes any string

`operator-shell/src/main/index.ts` has no `will-navigate` or `will-redirect` handler, so a
renderer compromise or a stray `location.href` can navigate the window to arbitrary remote
content **with the preload and its `window.touch` bridge still attached**.

`index.ts:42-45` passes an unvalidated URL straight to `shell.openExternal` — no scheme
allowlist, so `file:`, `smb:` or any registered protocol handler is reachable from the renderer.

`sandbox: false` (`index.ts:33`) is a deliberate, documented choice pending a bundled preload.
All five `ipcMain.handle` callbacks ignore the event object and do no runtime argument
validation; the TypeScript annotations are erased at runtime and the shell has no zod dependency.

The single-instance lock is also broken: `index.ts:13-15` calls `app.quit()` **without
returning**, so module evaluation continues and `app.whenReady()` is still registered — and there
is no `second-instance` handler to focus the existing window.

### H6 — Contract features with a working RPC and no caller

All of these are granted and tested server-side and have **zero call sites** in the operator:

| SOW | Capability | Server side |
|---|---|---|
| L453 | Refunds by a manager role, reversing the stock movement | `app.refund` |
| L450-451 | Price overrides behind an authorised PIN with a reason code | `app.override_price` |
| L444 | Merge tables | `app.merge_tabs` |
| L241-243 | Audit log — actor, action, before/after, reason | `audit_log`, already `grant select` to management at `0005:63-65` |
| L546-547 | Low-stock and par-level alerts | `manager_alerts` |

`components/ui.tsx:304` even describes the PIN modal as "shared by discount / void / **refund**
flows" — the refund consumer was never written. `lib/errors.ts:93` maps `VOID_REQUIRES_REFUND`,
a code no UI can currently produce or resolve.

Split a bill **by item** (L444) has neither an RPC nor a UI; only `app.split_evenly` exists.

### H7 — Charge-to-booking does not add up

`tabs.reservation_id` exists and `NewTabDialog` offers the booking picker, but
`app.compute_tab_totals` never adds the court price. The SOW's "so a group settles courts and
drinks in one payment" (L131, L445-446) produces a bill with the court missing.

---

## 4. Medium

- **M1 — KDS item-ready marks are ephemeral.** `features/kds/KdsBoard.tsx:72` holds them in
  `useState<Set<string>>`. A refresh or a navigation away wipes them mid-service, and nothing
  notifies the floor or the guest as L460 requires. Actual preparation time per ticket (L462) is
  not stored.
- **M2 — No closed-dates editor.** `OpeningHoursEditor.tsx:38` reads `closed_dates` and
  `DeskCalendar.tsx:125` honours it, but nothing in the app can write it (L319).
- **M3 — Reservation overrides are audited without a reason.** `move_reservation`,
  `extend_reservation` and `mark_reservation` write audit rows with no reason code, against L313
  ("Every override written to the audit log with actor and reason"). Only cancel takes one.
  `set_staff_pin` writes no audit row at all.
- **M4 — Silent localhost fallback.** `lib/supabase.ts:10-15` falls back to `127.0.0.1:54321`
  plus the well-known demo anon JWT when `VITE_SUPABASE_URL` is unset. A packaged build with a
  missing variable boots pointed at localhost and merely looks "offline".
- **M5 — Guarding renders a paragraph instead of redirecting.** `RequireRole`
  (`routes/__root.tsx:176-183`) runs inside `component`, not `beforeLoad`, so a cashier typing
  `/analytics` downloads the entire Recharts chunk before being told no. Two further role checks
  live outside the matrix as inline `staff?.role === 'owner'` (`settings/CafeSettings.tsx:43`,
  `qr/QrPage.tsx:38`), against L185's "one place to change a permission".
- **M6 — No polling fallback on `['reservations']` and `['tabs']`.** Tickets, waiter calls, the
  Telegram outbox and analytics all have one; the desk grid and the till's tab list go stale
  until a manual refresh if a broadcast is missed.
- **M7 — The covers multiplier disagrees with itself.** The same `localStorage` key is declared
  twice: `settings/CafeSettings.tsx:17` defaults to 1, `analytics/useAnalyticsData.ts:59`
  defaults to 2. Until the owner touches the setting once, the settings page says ×1 while the
  dashboard computes ×2. `VENUE_TZ` is likewise re-declared at `useAnalyticsData.ts:55` instead
  of imported from `@touch/i18n`.
- **M8 — Stale scaffolding that now misleads.** `lib/rpcNames.ts` claims the generated types do
  not carry these names; all 16 are present in `packages/db/src/types.gen.ts`, and 15 of the 16
  constants are unused. `lib/settings.ts:141` keeps a `.from('cafe_settings' as never)` cast for
  the same non-reason. `components/ComingSoon.tsx` has zero importers.
  `lib/analyticsApi.ts:179,181` defines two RPC wrappers nothing calls.
- **M9 — `lib/idem.ts:10` is not a ULID.** It is `crypto.randomUUID()` hex-sliced to 26
  characters: not time-ordered, not monotonic. Harmless as a nonce, wrong the moment anything
  sorts by it. `@touch/core` already exports `makeIdempotencyKey` and `makeClientRef`.
- **M10 — LAN KDS is a listener with nothing to say.** `lan-kds-server.ts:36-41` is `void raw`;
  `broadcastTicket` is a TODO at `:48-49`, and the server object is discarded at the call site
  (`index.ts:98`). `IPC.lanTicket` has a preload subscriber (`preload/index.ts:27-31`) and no
  sender anywhere. The PSK is compared with `!==` (not constant-time) and the server binds
  `0.0.0.0`.

---

## 5. It cannot be packaged today

`apps/operator-shell/package.json` — the `dist` script is `echo TODO: electron-builder --win
nsis …`. Running it prints a string and exits 0.

- `electron-builder` is not a dependency of any package in the repo.
- No icon of any kind exists under `apps/operator-shell`.
- No signing configuration. `electron-builder.yml:20-25` has `publish:` commented out, so there
  is no auto-update feed either.
- **The renderer is not bundled.** `electron-builder.yml:7-11` ships `dist/**` only, with the
  `extraResources` block for `apps/operator/dist` commented out — while production load is
  `win.loadFile(path.join(__dirname, '../../../operator/dist/index.html'))` (`index.ts:53`), a
  monorepo-relative sibling path that does not exist inside a packaged app. A packaged build
  opens a blank window.
- `better-sqlite3` is a native addon. The compiled artifact present was fetched by
  `prebuild-install` against **Node 22**, and Electron 33 embeds a different ABI. There is no
  `@electron/rebuild`, no `postinstall`, and no `npmRebuild` configuration anywhere.
- `.github/workflows/operator-release.yml`, referenced from `package.json` and
  `electron-builder.yml:1-2`, does not exist.
- `closable: true` with a `TODO(W4)` (`index.ts:26`), so the kiosk is closable; and
  `electron-builder.yml:17-18` claims `app.setLoginItemSettings` is called "as belt-and-braces" —
  that call does not exist in the source, so the app does not launch on boot.

---

## 6. What the gate was actually checking, before today

- **`pnpm turbo lint` was a green no-op.** No package but `apps/mobile` defined a `lint` script
  and no `eslint.config.*` existed outside it — while `packages/config/src/eslint.js` shipped a
  complete preset **including the RTL logical-properties guard** the conventions claim is
  enforced. The operator is the surface where that rule matters most: it is 100% inline styles.
- **No React component could be tested.** `apps/operator/vitest.config.ts` included only
  `src/**/*.test.ts` under `environment: 'node'`, with no jsdom and no testing-library in
  `package.json`. 19 test files, 125 cases, all pure functions — and **zero** covering the
  1,162-line `TillScreen`, the 728-line `DeskCalendar`, the KDS, day close, the twelve admin
  editors or the forty analytics components. `features/analytics/derive.ts` (360 lines) is
  untested while the thinner `shape.ts` beside it is tested.
- **`apps/operator-shell` had no `test` script at all**, so `turbo test` skipped the SQLite
  durability layer in silence.
- **The Playwright suite was not in CI.** The e2e job in `.github/workflows/ci.yml` was commented
  out, so the only thing exercising any operator component ran when someone remembered to run it
  locally.

---

## 7. What is solid — do not re-audit

- **Role gating is default-deny and proven.** `lib/auth.tsx:150-166` resolves by longest prefix on
  segment boundaries and returns `false` for an unmatched route; `lib/auth.test.ts` covers the
  deny cases explicitly. The default-allow hole recorded in `context-operator.md` is closed.
- **Write discipline holds.** Zero `.insert()`, `.update()`, `.upsert()` or `.delete()` calls on
  business tables anywhere in the app — every write is an `app.*` RPC through `lib/appRpc.ts`,
  with `AppRpcError` carrying the server code into a 100-plus entry bilingual mapping
  (`lib/errors.ts`).
- **The manager-PIN brute force is fixed.** `verify_manager_pin` now counts failures per
  **caller** across all their device ids (`0046_pin_oracle.sql:58-71`) and refuses non-staff
  before any bcrypt work. The device-rotation oracle from the day-1 gap review is closed.
- **The unsettleable-tab dead end is fixed** — `settle_tab` no longer dead-ends on
  `ALREADY_PAID` (`0038_concurrency_locks.sql:504-505`).
- **Realtime is well built.** `lib/realtime.ts` reconnects with jitter and surfaces a three-state
  status through `ConnectionPill`; KDS alarms, stale pulses and the floor chime are tested pure
  functions.
- **The durability pragmas are real.** `queue.ts:16-17` sets `journal_mode = WAL` and
  `synchronous = FULL`, and the IPC promise resolves only after the synchronous insert returns.
  The storage layer is right; it is the machinery around it that is missing.

---

## 8. Landed on 2026-08-28 (Wave 0)

- `apps/operator/eslint.config.mjs` and `apps/operator-shell/eslint.config.mjs`, plus a `lint`
  script in each. The RTL guard now runs on the operator and **the existing code is clean** — one
  unused import was the only finding across 73 source files. The operator config also forbids
  importing `electron` or `fs` in the renderer; the shell config forbids empty catch blocks,
  which is the shape that hid C1 for four days.
- `apps/operator` gains jsdom and `@testing-library/react`. `vitest.config.ts` now includes
  `*.test.tsx` and pays for jsdom only on files that actually render, so the 125 existing pure
  tests keep their 2.3-second runtime. First component test: `src/components/Switch.test.tsx`
  (6 cases) — the shared optimistic toggle behind sold-out, item availability, the per-table
  waiter bell and the Telegram enable flag, including the revert-on-error path that had no
  coverage anywhere.
- `apps/operator-shell` gains a `test` script, a vitest config with an `electron` stub, and
  `src/main/queue.test.ts` (14 cases) asserting WAL, `synchronous = FULL`, idempotency-key and
  local-id uniqueness, `seq` ordering, and depth/conflict accounting — plus two tests that pin
  the **known gaps** (`degraded` hard-coded false, `ref_cache` never populated) so the Wave 3 fix
  has something to flip.
- The Playwright job is enabled in CI, EN and AR, with trace upload on failure.
- Gate: `pnpm turbo lint typecheck test` — **18/18 tasks green**, where three of those eighteen
  did not previously exist.
