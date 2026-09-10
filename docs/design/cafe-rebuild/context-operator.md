# apps/operator — structure map (2026-08-25)

## 1. Routing & role gating
- Code-based `createRoute`, NOT file-based; no routeTree.gen. `src/main.tsx:16-27` assembles
  `rootRoute.addChildren([indexRoute, tillRoute, deskRoute, kdsRoute, stockRoute, adminRoute])`.
  New top-level route = `src/routes/x.tsx` exporting `xRoute`, import + add to array.
- Provider stack (`main.tsx:41-64`): LocaleProvider → ThemeProvider theme="padel" dir → AuthProvider
  → QueryClientProvider (staleTime 10 s, retry 1) → RouterProvider.
- Route shape (`src/routes/kds.tsx:5-13`): `createRoute({getParentRoute: () => rootRoute, path:'/kds',
  component: () => <RequireRole route="/kds"><KdsBoard/></RequireRole>})`.
- `src/lib/auth.tsx`: `ROUTE_ROLES` map (108-114): '/admin' & '/stock' → manager,owner; '/till'
  cashier+; '/kds' prep+; '/desk' court_desk+. `allowedRoutes(role)`, `canAccess(role, route)` —
  UNKNOWN routes default to ALLOWED (125). `RequireRole` in `src/routes/__root.tsx:154-161`. Roles
  from `staff` table (38-46); `supabase.realtime.setAuth(token)` on session change (62).
- Shell `src/routes/__root.tsx`: `NAV` const (12-18) `{to,key}[]` with typed key union
  'till'|'desk'|'kds'|'stock'|'admin'; label `tr(`${key}.title`)`; left sidebar 12rem; language
  toggle + sign out at bottom; sign-in screen inline (83-151).
- Admin sub-nav: `src/routes/admin.tsx:21-53` local `useState` tab strip — `type AdminTab =
  'menu'|'rates'|'hours'|'dayClose'`, tabs array with `tr('op.admin.<x>Tab')`, Buttons, `{tab==='menu'
  && <MenuEditor/>}`. No URL sync. Will overflow with ~13 tabs → group or use `/admin/$section`.

## 2. Data layer
- Reads: `supabase.from(...)` inside `useQuery`. Writes: `appRpc('<name>', {...})` (schema app).
  IPC bridge NOT used for admin writes.
- `src/lib/supabase.ts:14-17` one `createClient<Database>` from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  (fallback local 127.0.0.1:54321).
- `src/lib/appRpc.ts:45-59` `appRpc<T>(fn, args)`; throws `AppRpcError` with `.code` = raised message.
  `AppFunctionName = keyof Database['app']['Functions']` → new RPC needs `pnpm db:types`.
- `src/lib/errors.ts:9-59` `MAPPED_CODES` → `op.errors.<CODE>`; new codes must be added here + both catalogs.
- `src/lib/realtime.ts:27-58` `useBroadcast(...)`, `onEvent(event,payload)` hook for sound.
  No cafe-wide "new order" broadcast — ride `kds`/`ticket_created` or add a trigger.
- `src/lib/idem.ts` `idemKey(type)`, `deviceId()`. `src/ipc/bridge.ts` `window.touch` + browser mock.
- MenuEditor (`src/features/admin/MenuEditor.tsx`): one fat `useQuery(['adminMenu'])` (96-118: 5
  parallel selects: menu_categories, menu_items(+variants, +menu_item_modifier_groups), modifier_groups,
  modifiers, tax_groups); saves via upsert_menu_category (237-244), upsert_menu_item (342-351 —
  never passes p_photo_path → photo wiped), set_item_availability (400-407), upsert_variant
  (444-452), upsert_modifier_group (687-692), upsert_modifier (623-631, 649-654),
  link_item_modifier_group (600-604). `BilingualFields` (62-87): 2-col grid, EN input dir=ltr, AR
  input dir=rtl lang=ar — reuse. `pickName(locale,row)` in `src/lib/i18n.tsx:59-65`. No delete
  (soft is_active), no drag reorder. Feedback = ad-hoc `saved` boolean.
- Suggested items backend exists: `addon_suggestions` + `app.set_addon_suggestions` (SELF_SUGGESTION
  not in MAPPED_CODES).
- Menu tables RPC-only (0013:107-109) → every new admin write = new `app.*` SECURITY DEFINER fn +
  `is_staff('manager','owner')` + `write_audit`.
- No key/value settings table; `venue_settings` fixed columns; `cafe_tables` has no bell flag.

## 3. UI kit `src/components/ui.tsx` (280 L, inline styles)
Exports: `card` (CSSProperties), `inputStyle`, `Button {children,onClick,kind:'default'|'primary'|
'danger'|'ghost',disabled,type,style}`, `Field {label,children,style}`, `Modal {title,onClose,
children,wide}`, `ErrorText {error}`, `AmountPad`, `REASON_CODES`/`ReasonCode`, `PinReasonModal`.
NO toast, NO confirm dialog, NO spinner/skeleton, NO Sheet/Tabs/Select/Table/file input/image.
Theming: `ThemeProvider` from @touch/ui sets data-theme/dir/lang on <html>; operator hardcodes
theme="padel"; tokens as CSS vars `--tp-*`. CSS logical properties rule (packages/config/src/eslint.js
37-70) — operator has no eslint config/lint script today but the rule applies.

## 4. i18n `src/lib/i18n.tsx`
`LocaleProvider` (29-50) locale en|ar in useState, localStorage 'touch-operator-locale';
`useLocale()` → `{locale, dir, tr, toggleLocale}`; binary toggle only. `MessageKey` compile-time
union from en catalog; add every string to `packages/i18n/src/catalogs/en.ts` AND `ar.ts`. Operator
keys under `op:` (en.ts 237-539): op.admin 406-411, op.menu 412-443, op.rates, op.hours, op.dayClose,
op.errors 492+. Module titles at en.ts 71-75 (`till/desk/kds/stock/admin: {title}`). Interpolation
`{brace}`; `formatIQD`, `isolate()`.

## 5. Dependencies
operator: @supabase/supabase-js ^2.47, @tanstack/react-query ^5.62, @tanstack/react-router ^1.95,
@touch/* workspace, react 19.0.0; dev: vite ^6, vitest ^2.1.8, @vitejs/plugin-react.
Monorepo: recharts NO; qrcode ^1.5.4 only as packages/db devDependency; browser-image-compression NO;
posthog NO; sharp not installed. `packages/db/scripts/qr-artwork.mjs` `qrPath()` (91-101) ports to
renderer verbatim; card geometry 105×148 mm, viewBox 0 0 420 592, QR box 224 px, quiet zone 4.

## 6. Electron shell
Preload exposes `touch.{enqueue,onQueueUpdate,onLanTicket,getCachedRef,print,unlockPin,getStation}`;
contextIsolation true, nodeIntegration false, sandbox false → `window.print()` and `window.open()`
work (Chromium print preview). `IPC.print` is a stub (receipt/kitchen/reprint kinds; ESC/POS later).
Kiosk only for till/kds stations in prod; admin typically on desk. Audio: nothing exists; HTML5
Audio works but autoplay policy → needs user gesture or `webPreferences.autoplayPolicy:
'no-user-gesture-required'` in `apps/operator-shell/src/main/index.ts:27-34`; assets must be bundled
(base64 or import) because prod loads from file://.

## 7. Vite / tsconfig / env
`vite.config.ts`: plugins [react()], `base:'./'`, port 5174 strict. No aliases. tsconfig no paths.
Env: only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` declared in `src/vite-env.d.ts:3-6` — add
new vars there. Supabase config.toml: storage enabled, no buckets, no storage policies.

## 8. Tests
`vitest.config.ts`: include `src/**/*.test.ts` (.ts only), environment node, alias @touch/db. Pure
function tests only (`features/kds/ageColor.test.ts`, `features/till/change.test.ts`,
`lib/errors.test.ts` — asserts key resolves in both catalogs and ar ≠ en). Turbo test/typecheck
dependsOn ^build.

## Gaps shaping the plan
1. No settings surface for any new feature → migration 0027+ (settings k/v or columns, telegram,
   bell flag, hero, reveals, photos, cost, analytics tables) + db:types.
2. Every admin write = new RPC + MAPPED_CODES + catalogs.
3. New deps: recharts, qrcode (or port qrPath), browser-image-compression (or canvas.toBlob).
4. Build primitives once: ToastProvider/useToast, ConfirmDialog, Spinner/Skeleton, FileDropzone, Tabs.
5. Fix upsert_menu_item photo wipe first.
6. Admin tab strip won't survive 13 tabs → grouped sub-nav or `/admin/$section`; `canAccess`
   defaults unknown routes to allowed.
