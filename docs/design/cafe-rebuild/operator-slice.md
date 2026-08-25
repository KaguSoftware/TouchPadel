I have everything I need. Here is the implementation plan.

---

# Operator desktop app slice — implementation plan (Touch Cafe rebuild)

Repo: `c:\Users\p.mansouri\Desktop\kagu software\TouchPadel` · app: `apps/operator` (Vite 6 + React 19 + TanStack Router 1.95 code-based routes + React Query 5) inside `apps/operator-shell` (Electron 33).

Binding owner decisions honoured: everything admin + analytics lives here; KDS/WaiterCallsPanel get sound + stale alarms; QR = A6 branded cards + bell toggle; analytics = PostHog via edge proxy + till sales + Groq via edge fn with rejections; light theme; logical CSS only; every screen in Arabic.

Cross-slice contract assumptions (DB slice designed in parallel) are marked **[DB-CONTRACT]** so the two plans can be reconciled.

---

## 0. Findings in the current code that shape the plan

| Finding | File | Consequence |
|---|---|---|
| `canAccess()` returns `true` for any route not in `ROUTE_ROLES` | `apps/operator/src/lib/auth.tsx:122-126` | Must become longest-prefix match + default DENY before adding `/admin/*` and `/analytics` |
| `NAV` key union is `'till'|'desk'|'kds'|'stock'|'admin'` and labels come from `tr(\`${key}.title\`)` | `apps/operator/src/routes/__root.tsx:12-18` | Add `'analytics'` + catalog `analytics: { title }` next to `admin: { title }` (`packages/i18n/src/catalogs/en.ts:71-75`) |
| Admin is a local `useState` tab strip, no URL | `apps/operator/src/routes/admin.tsx:21-53` | Replace with layout route + child routes |
| `upsert_menu_item` call never passes `p_photo_path` → photo wiped on every save | `apps/operator/src/features/admin/MenuEditor.tsx:342-351` | Photo must be saved through the dedicated `set_item_photo` RPC **and** `p_photo_path` must be passed on upsert (fixed upsert per DB slice) |
| `useBroadcast` exposes no channel status and never re-subscribes | `apps/operator/src/lib/realtime.ts:41-57` | Extend (backward compatible) with status + jittered reconnect |
| KDS `useBroadcast` has no `onEvent`; ticket chime hooks in there | `apps/operator/src/features/kds/KdsBoard.tsx:90-95` | Add `onEvent` for `ticket_created` |
| `floor` subscription lives in `TillScreen`, not `WaiterCallsPanel` | `apps/operator/src/features/till/TillScreen.tsx:210-215` | Chime is triggered from TillScreen's subscription `onEvent`, panel only renders escalation |
| Inline styles only, no global CSS, no `@keyframes`, no `@media print` | `apps/operator/src/components/ui.tsx`, `index.html` | Add one `GlobalStyles` component (mounted in `__root`) carrying the pulse keyframes + print rules |
| Vitest includes only `src/**/*.test.ts`, env `node` | `apps/operator/vitest.config.ts` | Pure-function tests only; component tests are out (see §9) |
| `packages/core` exports `./*` → `./src/*.ts`, zero runtime deps except zod/ulid | `packages/core/package.json` | Analytics modules go under `packages/core/src/analytics/*` and are importable as `@touch/core/analytics/range` |
| Electron `webPreferences` has no `autoplayPolicy`; prod loads `file://…/operator/dist/index.html`; `sandbox:false`, `contextIsolation:true` | `apps/operator-shell/src/main/index.ts:27-34, 43` | `window.print()` works; audio needs arming or the autoplay policy flag; assets must be relative (`base:'./'` already) |
| `qrPath()` and card geometry are pure | `packages/db/scripts/qr-artwork.mjs:91-158` | Port verbatim to a TS module + React SVG component |
| Env only declares `VITE_SUPABASE_URL/ANON_KEY` | `apps/operator/src/vite-env.d.ts` | Add `VITE_GUEST_SITE_URL` (printed QR origin); nothing for PostHog/Groq (proxied) |

---

## 1. Navigation

### 1.1 Route tree (code-based, `apps/operator/src/main.tsx`)

```
rootRoute
├─ indexRoute            '/'                 (existing redirect)
├─ tillRoute / deskRoute / kdsRoute / stockRoute   (unchanged)
├─ adminRoute            '/admin'            LAYOUT: <RequireRole route="/admin"><AdminShell><Outlet/></AdminShell></RequireRole>
│   ├─ adminIndexRoute   '/'  → <Navigate to="/admin/menu" replace/>
│   ├─ '/menu'  '/categories'  '/addons'  '/suggested'  '/hero'  '/qr'
│   ├─ '/telegram'  '/settings'  '/staff'
│   └─ '/rates'  '/hours'  '/day-close'      (existing editors, moved out of the tab strip)
└─ analyticsRoute        '/analytics'        validateSearch → AnalyticsSearch
```

Explicit child routes (not `$section`) so `<Link to="/admin/qr">` is typed and each section can be `lazyRouteComponent(() => import('../features/admin/qr/QrPage'))` — the analytics bundle (Recharts) must not load on a till/KDS station. Files: `apps/operator/src/routes/admin.tsx` (layout + children array + `AdminShell`), `apps/operator/src/routes/admin/*.tsx` one file per section, `apps/operator/src/routes/analytics.tsx`.

### 1.2 Route / nav table

| Path | Roles | Sidebar | Sub-nav label key | Component |
|---|---|---|---|---|
| `/admin` (layout) | manager, owner | `admin.title` | — | `AdminShell` (left sub-nav 11rem, `Outlet`) |
| `/admin/menu` | manager, owner | — | `op.adminNav.menu` | `features/admin/menu/MenuEditor` |
| `/admin/categories` | manager, owner | — | `op.adminNav.categories` | `features/admin/menu/CategoryEditor` |
| `/admin/addons` | manager, owner | — | `op.adminNav.addons` | `features/admin/addons/AddonsPage` |
| `/admin/suggested` | manager, owner | — | `op.adminNav.suggested` | `features/admin/suggested/SuggestedEditor` |
| `/admin/hero` | manager, owner | — | `op.adminNav.hero` | `features/admin/hero/HeroBuilder` |
| `/admin/qr` | manager, owner (rotate = owner) | — | `op.adminNav.qr` | `features/admin/qr/QrPage` |
| `/admin/telegram` | **owner** | — | `op.adminNav.telegram` | `features/admin/telegram/TelegramSettings` |
| `/admin/settings` | manager, owner (analytics prefs owner-only inside) | — | `op.adminNav.settings` | `features/admin/settings/CafeSettings` |
| `/admin/staff` | owner | — | `op.adminNav.staff` | read-only list (note only, §3h) |
| `/admin/rates`, `/admin/hours`, `/admin/day-close` | manager, owner | — | existing `op.admin.*Tab` keys | existing editors |
| `/analytics` | **owner** | `analytics.title` | zone jump-nav (in-page) | `features/analytics/AnalyticsPage` |

Decision — `/analytics` is owner-only (UpperDeck parity: it exposes item costs/margins and each "recheck" bills Groq). The edge functions accept owner|manager JWT per the DB slice, so extending to managers later is a one-line `ROUTE_ROLES` change plus removing the sidebar filter.

Sub-nav groups (visual headers only, not routes): **Menu** (menu, categories, addons, suggested) · **Guest app** (hero, qr) · **Operations** (rates, hours, day-close) · **System** (telegram, settings, staff). Sub-nav items are `<Link activeProps>` so URL and highlight stay in sync; forbidden sections are hidden by role and additionally guarded in each child route via `RequireRole route="/admin/telegram"`.

### 1.3 `lib/auth.tsx` changes

```ts
export const ROUTE_ROLES: Record<string, readonly StaffRole[]> = {
  '/till': [...], '/desk': [...], '/kds': [...], '/stock': [...],
  '/admin': ['manager', 'owner'],
  '/admin/telegram': ['owner'],
  '/admin/staff': ['owner'],
  '/analytics': ['owner'],
};
// longest-prefix match; unknown → DENY (fixes the default-allow hole)
export function canAccess(role: StaffRole | undefined, route: string): boolean
// top-level entries only (no second '/'), used by NAV filtering
export function allowedRoutes(role: StaffRole): string[]
// new: sub-routes of a prefix the role may see (drives AdminShell sub-nav)
export function allowedSubRoutes(role: StaffRole, prefix: '/admin'): string[]
```
Add a `lib/auth.test.ts` (pure) asserting: unknown route denied; `/admin/telegram` denied for manager; `/admin/menu` allowed for manager via prefix; `/analytics` owner only.

`__root.tsx`: `NAV` key union becomes `'till'|'desk'|'kds'|'stock'|'admin'|'analytics'`; add `{ to: '/analytics', key: 'analytics' }`; wrap `<nav data-no-print>`; mount `<GlobalStyles/>` (keyframes + print rules); mount `<ToastProvider>` (see §2) inside `RootShell` above `<Outlet/>`.

---

## 2. UI primitives (add once)

Keep inline styles, `--tp-*` tokens, logical properties. Split into small files under `apps/operator/src/components/` (keep `ui.tsx` exports intact; re-export new ones from it for one import path).

| Primitive | File | Props / API | Notes |
|---|---|---|---|
| `ToastProvider`, `useToast()` | `components/toast.tsx` | `toast.ok(msg: string)`, `toast.err(err: unknown \| string)`, `toast.info(msg)`; each auto-dismisses after 3 000 ms; max 3 stacked; fixed `insetBlockEnd/insetInlineEnd 1rem`; `role="status"` (ok/info) / `role="alert"` (err) | `err(unknown)` runs `errorToMessageKey` so every RPC/edge failure is one call |
| `ConfirmDialog` | `components/ConfirmDialog.tsx` | `{ open, title, body?, confirmLabel, kind?: 'danger'\|'primary', busy?, onConfirm, onCancel }`; autofocus on Cancel for `danger` (Confirm otherwise); Esc → `onCancel`; click-outside → cancel; traps focus | Built on existing `Modal`; add `onKeyDown` Esc handling to `Modal` itself (benefits all modals) |
| `useConfirm()` | same file | `const confirm = useConfirm(); if (await confirm({title, kind:'danger'})) …` | Promise wrapper to avoid boolean state in every screen |
| `Spinner` | `components/ui.tsx` | `{ size?: 'xs'\|'sm'\|'md', label? }` inline SVG circle with `@keyframes tpSpin` from `GlobalStyles` | |
| `Skeleton` | `components/ui.tsx` | `{ lines?: number, blockSize?: string }` shimmer blocks | Analytics cards + admin lists while loading |
| `SubNav` | `components/SubNav.tsx` | `{ groups: { label: string; items: { to: string; label: string }[] }[] }` | Vertical, uses router `Link activeProps` |
| `Tabs` | `components/ui.tsx` | `{ value, onChange, items: {id,label}[] }` `role="tablist"` | For in-section tabs (addons: Groups / Reveals; telegram: Settings / Outbox) |
| `Select` | `components/ui.tsx` | `{ value, onChange, options: {value,label,disabled?}[], placeholder?, style? }` | Thin wrapper over `<select style={inputStyle}>` |
| `Switch` | `components/Switch.tsx` | `{ checked, onChange: (next) => Promise<void> \| void, label, busy?, disabled?, tone?: 'accent'\|'danger' }` `role="switch" aria-checked`; internally: optimistic flip → await → on throw revert + `toast.err` | Used for sold-out, bell, availability, is_active, highlight? (no, radio) |
| `useOptimisticToggle` | same file | `(current: boolean, mutate: (next) => Promise<unknown>, invalidate: QueryKey[])` | React Query `onMutate/onError/onSettled` snapshot-rollback helper; Switch uses it |
| `ImageField` | `components/ImageField.tsx` | `{ value: string \| null (storage path), onChange: (path: string \| null) => void, folder: 'items'\|'categories'\|'hero', accept?: 'image'\|'image+video', maxMb?: number (default 10 input), aspect?: '1:1'\|'16:9', label }` — shows preview via `publicUrl(path)`, "Replace" / "Remove"; drag-and-drop + click; progress state | Upload = `lib/storage.ts` |
| `lib/image.ts` | | `compressToWebp(file, {maxPx: 1200, maxBytes: 512_000}): Promise<Blob>` using `createImageBitmap` → `<canvas>` → `canvas.toBlob('image/webp', q)` with a quality step-down loop (0.85 → 0.5) until ≤ maxBytes; GIF/HEIC fall back to png→webp; videos pass through untouched (size-checked) | Chromium (Electron + Chrome) encodes WebP natively → no `browser-image-compression` dep. Keep the dep name in a comment as the fallback if a non-Chromium runtime ever appears |
| `lib/storage.ts` | | `uploadMedia(folder, blob, ext): Promise<string>` → path `${folder}/${crypto.randomUUID()}.${ext}` to bucket `menu-media`, `{ cacheControl: '2592000', contentType, upsert: false }`; `publicUrl(path): string` via `supabase.storage.from('menu-media').getPublicUrl`; `removeMedia(path)` (best-effort, never blocks a save) | **[DB-CONTRACT]** bucket `menu-media` public-read, staff write |
| `MoneyInput` | `components/inputs.tsx` | `{ value: number \| null, onChange(next: number \| null), allowEmpty?, min?: 0 }` integer IQD, `dir="ltr" inputMode="numeric"`, strips non-digits, shows `formatIQD` hint beside; `null` when blank and `allowEmpty` | Blank ≠ 0 is the cost rule |
| `PercentInput` | same | `{ value, onChange, min:0, max:99 }` integer | discount % |
| `BilingualFields` | same (moved from MenuEditor) | as today + `multiline?: boolean`, `maxLength?`, `placeholderEn/Ar` | EN input `dir=ltr`, AR `dir=rtl lang=ar` |
| `SortButtons` | same | `{ onUp, onDown, disabledUp, disabledDown }` ▲▼ ghost buttons | Categories, options, suggested, ticker phrases (no drag lib) |
| `GlobalStyles` | `components/GlobalStyles.tsx` | renders one `<style>`: `@keyframes tpPulse`, `@keyframes tpSpin`, `@media print { [data-no-print]{display:none!important} body{background:#fff} }`, `@page { size: A6 portrait; margin: 0 }` scoped by `body[data-print="a6"]` | Only global CSS in the app |

---

## 3. Admin sections

Common conventions for every section:
- Reads: `useQuery` + `supabase.from(...)`; writes: `appRpc(...)` in `useMutation`; on success `toast.ok(tr('op.toast.saved'))` + invalidate; on error `toast.err(e)` (and inline `ErrorText` for forms).
- Every write is a `SECURITY DEFINER app.*` fn with `write_audit` — the UI expects nothing extra; the audit expectation column below says what the audit row should carry so the DB slice can verify.
- Menu-affecting writes must fire the `menu` broadcast so guest phones refresh; **[DB-CONTRACT]** extend the 0022 trigger set to categories, modifiers, reveals, suggestions, `cafe_settings` hero/ticker keys (today only `menu_items`/`menu_item_variants` fire).
- Dirty-form guard: `useBlocker` from TanStack Router on unsaved item forms (`op.common.unsavedPrompt`).

### 3a. Menu items + categories

Split `features/admin/MenuEditor.tsx` (705 L) into `features/admin/menu/`: `MenuEditor.tsx` (3-pane layout, keeps `['adminMenu']` fat query but adds `photo_path, hook_en, hook_ar, highlight, sold_out, cost_iqd` + `menu_categories.photo_path`), `ItemForm.tsx`, `VariantsEditor.tsx`, `ItemModifierGroups.tsx` (link/unlink only — group *editing* moves to Addons), `CategoryEditor.tsx` (also mounted at `/admin/categories`), `useAdminMenu.ts` (query + typed rows + `refresh`).

| Field | Control | Validation | RPC / column | Optimistic | Audit expectation |
|---|---|---|---|---|---|
| Name EN/AR | `BilingualFields` | both non-empty, ≤ 80 | `upsert_menu_item(p_name_en/ar)` | no (form save) | `upsert_menu_item` row with item id |
| Description EN/AR | `BilingualFields multiline` | ≤ 400 | `p_description_en/ar` | no | — |
| Hook EN/AR (flavour line) | `BilingualFields` placeholder "sweet · crisp · bold" | ≤ 60 each; both-or-none | **[DB-CONTRACT]** `p_hook_en/ar` on `upsert_menu_item` | no | — |
| Photo | `ImageField folder="items" aspect="1:1"` | webp ≤ 0.5 MB / 1200 px | `set_item_photo(p_item_id, p_photo_path)` fired immediately on upload/remove (not on form save) **and** `p_photo_path` passed on upsert so the photo-wipe path is closed both ways | yes (preview immediate, rollback on failure) | `set_item_photo` audit with old→new path |
| Highlight | 3 swatches radio none / blue (`--tp-brand-blue`) / brown (`--tp-brand-brown`) | enum | `p_highlight: 'none'\|'blue'\|'brown'` | no | — |
| Sold out | `Switch tone="danger"` in item list row **and** form | — | **[DB-CONTRACT]** `set_item_sold_out(p_item_id, p_sold_out)` — separate from 86 (`set_item_availability` = today only) | yes (list row) | audit `set_item_sold_out` |
| Off today (86) | existing button, relabelled with the date it auto-restores | — | `set_item_availability` | yes | existing |
| Cost IQD | `MoneyInput allowEmpty` + margin chip: `(price − cost)/price %` colour-banded ≥ 60 % accent-2 / ≥ 35 % amber / else danger; "no cost" grey chip when null; price = default variant | integer ≥ 0 or null; never coerce blank to 0 | `p_cost_iqd` (nullable) | no | — |
| Sort order | number + `SortButtons` in the item list (swap with neighbour, two `upsert_menu_item` calls) | int | `p_sort_order` | list reorder optimistic | — |
| Active | checkbox | — | `p_is_active` | no | — |
| Header subtitle | "N items without cost — needed for profit analytics" (`op.menu.noCostCount`) | | computed | | |

Item list rows: thumbnail 40 px (or placeholder), name, chips (sold-out, 86, highlight dot), price of default variant, margin chip, sold-out `Switch`. Client-side search box across names EN/AR.

Category editor: name EN/AR, tax group, photo (`ImageField folder="categories" aspect="16:9"` → **[DB-CONTRACT]** `set_category_photo`), active, `SortButtons` (swap `sort_order` with neighbour via two `upsert_menu_category` calls, optimistic). No delete (soft `is_active`), matching today.

### 3b. Add-ons (groups, options, reveals)

`features/admin/addons/`: `AddonsPage.tsx` (two lists: **Item groups** = groups linked to ≥ 1 item; **Sub-groups** = groups with zero `menu_item_modifier_groups` links, i.e. reveal-only), `GroupEditor.tsx`, `OptionsEditor.tsx`, `RevealsEditor.tsx`, `useAddons.ts` (query: `modifier_groups`, `modifiers`, `menu_item_modifier_groups`, `modifier_reveals`, `menu_items(id,name_en,name_ar)`).

| Element | Data | Controls | RPC | Validation |
|---|---|---|---|---|
| Group | `modifier_groups` | name EN/AR, min/max, "linked items" multi-checklist (searchable) | `upsert_modifier_group`, `link_item_modifier_group` per changed item (diff old vs new set) | `0 ≤ min ≤ max`, `max ≥ 1`; name both locales |
| Option | `modifiers` | name EN/AR, price delta (`MoneyInput`), active `Switch`, `SortButtons` | `upsert_modifier` (swap sort_order with neighbour on reorder) | delta ≥ 0 |
| Reveals per option | **[DB-CONTRACT]** `modifier_reveals(modifier_id, revealed_group_id, sort_order)` | checklist of sub-groups (groups not linked to any item, excluding the option's own group and any group that reveals back to it — cycle guard client-side, server authoritative) + `SortButtons` for order | `set_modifier_reveals(p_modifier_id, p_group_ids uuid[])` — replace-all semantics | server codes `REVEAL_CYCLE`, `REVEAL_NOT_SUBGROUP` |
| Create sub-group inline | button "New sub-group" from the reveals panel | name EN/AR, min/max | `upsert_modifier_group` then auto-add to the option's reveals | |

Optimistic: only the option active `Switch`; everything else form-save with toast.

### 3c. Suggested items

`features/admin/suggested/SuggestedEditor.tsx`: left = item picker (category → item), right = ordered list of suggested items (search-add from all active items, `SortButtons`, remove). Save = `set_addon_suggestions(p_item_id, p_suggested_ids uuid[])` (existing; whole-list replace). Validation: no self (server `SELF_SUGGESTION` → add to `MAPPED_CODES`), max 6 (UI cap), distinct. Data: `addon_suggestions` for the selected item.

### 3d. Hero builder

`features/admin/hero/`: `HeroBuilder.tsx`, `HeroPreview.tsx` (a 390-px-wide phone-frame mock of the guest hero, `data-theme="cafe"` wrapper so it uses cafe tokens), `TickerEditor.tsx`. Data: `useCafeSettings()` (`lib/settings.ts`, query `cafe_settings` k/v → typed object with defaults; mutation `set_cafe_setting(p_key, p_value)`; batch = sequential calls in one mutation, or **[DB-CONTRACT]** `set_cafe_settings(jsonb)` if provided).

| Setting key | Control | Validation | Preview |
|---|---|---|---|
| `hero_mode` | 3-button toggle none / media / featured; all panels stay mounted (hidden) so switching never loses draft values | enum | switches preview variant |
| `hero_media_path` | `ImageField folder="hero" accept="image+video"`; image → webp 1600 px / 0.8 MB; video mp4/webm ≤ **8 MB** (constant `HERO_VIDEO_MAX_MB`), no transcoding | required when mode=media | `<img>` / muted looping `<video>` |
| `featured_item_id` | `Select` of active items (grouped by category) | required when mode=featured | live thumbnail (item photo or placeholder), name in current locale, price with discount struck |
| `featured_label_en/ar` (marquee) | `BilingualFields` | ≤ 200 | scrolling marquee line |
| `featured_badge_en/ar` | `BilingualFields` | ≤ 60 | pill |
| `featured_discount_pct` | `PercentInput` 0–99 | int | struck price + discounted price via `@touch/core` money (`applyPercent`, integer IQD, no float) |
| `ticker_phrases` (JSON `{en:string,ar:string}[]`) | `TickerEditor`: list of bilingual rows, add/remove, `SortButtons`, max 10 × 80 chars | non-empty both locales per row | ticker strip in preview |

Save button writes only changed keys; toast; hero/ticker writes trigger the `menu` broadcast **[DB-CONTRACT]**.

### 3e. QR page

`features/admin/qr/`: `qrCard.ts` (pure: `qrPath(url): {d,size}` via `QRCode.create(url,{errorCorrectionLevel:'M'})`, `cardLayout(tableNumber)` returning the A6 geometry = viewBox 420×592, `qrBox 224`, `qrX 98`, `qrY 258`, quiet 4, `numSize` 96/72/52 by digit count), `QrCard.tsx` (React SVG port of `renderCard()` lines 122-156 — same palette constants from `cafePalette` in `@touch/ui`; text via `<text>` nodes; Arabic strings from the catalog instead of numeric entities; brand wordmark swap point: `<TouchCafeWordmark/>` placeholder component), `QrPage.tsx`.

- Data: `appRpc('table_qr_tokens')` **[DB-CONTRACT]** → `{ table_id, table_number, zone, token_version, bell_enabled, token }[]` (manager|owner; audited as `read_table_tokens`). URL = `${import.meta.env.VITE_GUEST_SITE_URL}/t/${token}`; if the env var is unset show a blocking notice `op.qr.noSiteUrl` (never print localhost cards).
- Screen grid: `repeat(auto-fill, minmax(14rem, 1fr))`; each cell = `<QrCard>` scaled to fit + below it (`data-no-print`) a `Switch` "Waiter bell" → `set_table_bell(p_table_id, p_enabled)` optimistic, plus `v{token_version}`.
- Print: button `op.qr.print` → sets `document.body.dataset.print='a6'`, `await` one frame, `window.print()`, then clears. Print CSS (in `GlobalStyles`): `@page { size: A6 portrait; margin: 0 }`, `.qr-card { break-after: page; inline-size: 105mm; block-size: 148mm }`, nav/sub-nav/buttons hidden. Electron: Chromium print preview opens; kiosk stations are not where admin runs, but the "Back" button remains visible on screen (not printed) so a kiosk user is never trapped.
- Rotate tokens (owner only): button → `ConfirmDialog kind="danger"` copy explains printed cards die → `rotate_table_token(p_table_id)` per table (existing), or "rotate all" loop with progress; toast; refetch.
- Test: `qrCard.test.ts` — `qrPath` emits `M{x} {y}h1v1h-1z` squares, module count matches `size²`, geometry constants (`qrX===98`, `numSize` thresholds), deterministic for a fixed URL.

### 3f. Telegram (owner)

`features/admin/telegram/`: `TelegramSettings.tsx`, `OutboxList.tsx`.

| Element | Data / RPC | Notes |
|---|---|---|
| `telegram_chat_id` | `set_cafe_setting` | text, `dir=ltr`, must match `^-?\d{5,20}$`; helper text + "How to find it" `<details>` reproducing the SETUP steps (BotFather → add bot to group → `getUpdates` → negative id) and a link to `docs/…/telegram-setup.md` opened via `window.open` (Electron opens external browser via `shell.openExternal` — needs a `setWindowOpenHandler` in main; add) |
| `telegram_lang` | `Select` ar / en / both | default `ar` |
| Bot configured? | `cafe_settings.telegram_bot_configured` (set by the edge fn / secret presence) **[DB-CONTRACT]** or inferred from outbox success | badge |
| Send test message | button → **[DB-CONTRACT]** `enqueue_telegram_test()` returns outbox id → poll that row every 2 s for 20 s → status chip queued / sent / failed(last_error) | disabled if chat id empty |
| Outbox viewer | `telegram_outbox` select last 20 (`kind, status, attempts, last_error, created_at, sent_at`), refetch 10 s; Retry → **[DB-CONTRACT]** `retry_telegram_outbox(p_id)` | |
| Webhook health hint | static checklist + "last button write-back at" from `cafe_settings.telegram_last_callback_at` if present | no secrets shown |

### 3g. Settings

`features/admin/settings/CafeSettings.tsx` — cards:

| Setting | Control | Storage |
|---|---|---|
| Business day start hour | `Select` [0,4,5,6,7,8] with label "00:00 (calendar day)" etc. + explanatory line | `cafe_settings.analytics_business_day_start` via `set_cafe_setting`; owner only |
| Waiter-call cooldown (s) | number 30–600 | `venue_settings.waiter_call_cooldown_seconds` — **[DB-CONTRACT]** needs `set_venue_setting`/`update_venue_settings` RPC; if absent render read-only with hint |
| Analytics excluded items | `ExcludedItemsPicker`: searchable checklist of all menu items (by id, not name — we have ids) | `cafe_settings.analytics_excluded_item_ids` JSON `uuid[]`; owner only |
| Auto-exclude off-menu | **skipped** (no POS import; every sold item is a menu item by construction) | — |
| Covers multiplier | `Select` [1, 1.1, 1.25, 1.5, 1.75, 2] | `localStorage['tp-analytics-covers-mult']` (per-station, as UpperDeck) — also exposed in the analytics control deck |
| Engagement floor date | read-only date (set once when PostHog goes live) | `cafe_settings.analytics_engagement_floor` **[DB-CONTRACT]** |

### 3h. Staff — note only

`staff` table already exists; a read-only `/admin/staff` list (display_name, role, is_active) is trivial (one `useQuery`) and helps the owner see who has access. Invites/role changes stay in the Supabase dashboard for this slice (needs service role → out of scope).

---

## 4. KDS + waiter-call enhancements

### 4.1 Audio (`apps/operator/src/lib/audio.ts`)

- No asset files: chimes are synthesised with WebAudio (`AudioContext` + two `OscillatorNode` notes, ~350 ms; distinct patterns `ticket` (E5→G5), `call` (A5 ×2), `alarm` (C5 ×3, louder)). Zero `file://` concerns, zero bundle weight. A real `mp3` can be swapped in later via `import url from './chime.mp3?url'` (Vite `base:'./'` keeps it relative; raise `build.assetsInlineLimit` if inlining is preferred).
- `useAudioArming()` → `{ armed, arm() }`: `arm()` creates/resumes the `AudioContext` inside the click handler and plays a near-silent tick; persisted in memory only (arming is per window). `armed` is also `true` immediately when `navigator.userAgent` includes `Electron` **and** the shell sets `autoplayPolicy` (see 4.5) — detect by attempting `ctx.resume()` on mount and checking `ctx.state === 'running'`.
- "Start shift" banner (`op.kds.startShift`) sits at the top of KDS and Till until armed; on stations with the Electron flag it never shows.

### 4.2 KDS state machine (`features/kds/alarms.ts`, pure + tested)

```
Audio:   disarmed --arm()/electron-policy--> armed
Ticket:  (queued, age<90s) FRESH --age≥90s--> STALE --status≠queued--> CLEARED
Unseen:  0 --ticket_created && (document.hidden || !focused)--> n+1 --focus/visibilitychange visible--> 0
```

`reconcile(tickets, nowMs, prev: AlarmState): { next: AlarmState, effects: Effect[] }` where `Effect = {type:'chime'} | {type:'alarm'} | {type:'startAlarmTimer', ticketId} | {type:'stopAlarmTimer', ticketId}`. Constants `STALE_SECS = 90`, `STALE_REPEAT_MS = 30_000`, `RECONCILE_MS = 10_000`. Rules mirror UpperDeck §3.5: on `ticket_created` broadcast → chime (if armed) + unseen++; reconcile runs on every tickets change **and** every 10 s so a ticket can cross 90 s with no realtime traffic; each stale ticket owns one repeating 30 s alarm timer until it leaves `queued`; banner "⚠ N tickets need attention" (`op.kds.staleBanner`); stale cards get `animation: tpPulse 1.2s infinite` + danger border; `document.title = unseen ? \`(${unseen}) ${tr('kds.title')} · Touch\` : \`${tr('kds.title')} · Touch\``.

`useKdsAlarms(tickets, armed)` hook wires the machine to `setInterval`/`setTimeout` and `useBroadcast({ onEvent })`. Tests in `alarms.test.ts`: fresh→stale at 90 s, timer start/stop effects, no double timers, cleared on status change, unseen reset.

### 4.3 Reconnect indicator (`lib/realtime.ts`)

Backward-compatible extension: `useBroadcast(options): { status: 'connecting'|'live'|'disconnected' }`; add `onStatus?`; inside `channel.subscribe((status) => …)`: `SUBSCRIBED → live`, `CHANNEL_ERROR|TIMED_OUT|CLOSED → disconnected` + jittered re-subscribe every 4 000–7 000 ms (`removeChannel` + recreate) while disconnected and still mounted. `ConnectionPill` component (`components/ui.tsx`) shows Connecting… / Live / Disconnected with the polling safety-net note. Mounted in KDS header and the till floor rail.

### 4.4 WaiterCallsPanel

- TillScreen's existing `floor` subscription gains `onEvent: (e, p) => p.status === 'raised' && chime('call')` (armed gate).
- Panel: age escalation — `< 2 min` muted, `2–5 min` amber (`#E8A317` as in `ageColor.ts`), `≥ 5 min` danger + pulse; raised (un-acked) calls older than 5 min re-alarm every 60 s (same machine, `STALE_SECS=300`, `REPEAT=60_000`, shared `alarms.ts` parameterised).
- Source badge: waiter calls are always guest → show table + a small "QR" chip; KDS already shows `sourceGuest/sourceTill` — render as coloured chip (accent for QR, muted for till).
- Keep `ack_waiter_call` / `resolve_waiter_call` untouched.

### 4.5 Electron (`apps/operator-shell/src/main/index.ts`)

- `webPreferences.autoplayPolicy: 'no-user-gesture-required'` (Electron ≥ 12; still valid on 33) — removes the arming step on stations; the renderer keeps the arming path for browser dev/e2e.
- `win.webContents.setWindowOpenHandler(({url}) => { shell.openExternal(url); return {action:'deny'} })` for the Telegram setup doc link.
- Nothing else: `window.print()` already works (`sandbox:false`, contextIsolation on); no Node in renderer; all assets relative.

---

## 5. Analytics app (`apps/operator/src/features/analytics/*`)

### 5.1 Structure

```
features/analytics/
  AnalyticsPage.tsx        route component; reads validated search; composes hooks; renders control deck + zones
  search.ts                AnalyticsSearch type + validateSearch (hand parser; no zod in operator)
  useAnalyticsData.ts      useQueries over SQL RPCs + edge queries → AnalyticsData (mirrors UpperDeck AnalyticsData, ids not names)
  ControlDeck.tsx          presets / custom dates / ComparePicker / BusinessDayPicker / CoversMultiplier / AutoRefresh / ExcludedItems button
  ZoneNav.tsx, Zone.tsx    sticky jump-nav with IntersectionObserver scroll-spy (desktop: always shown in the deck, right side)
  cards/  Kpi.tsx OverviewCard.tsx AiInsightsCard.tsx PatternsCard.tsx MenuMatrixCard.tsx PositionCard.tsx ConversionTable.tsx
          TopProfit.tsx HiddenGems.tsx Momentum.tsx BoughtTogether.tsx PromoPerformance.tsx LocalePrefs.tsx
  charts/ ChartCard.tsx colors.ts SalesVsEngagementChart.tsx HBarChart.tsx AbandonedViewsChart.tsx FunnelBars.tsx
          ConversionBars.tsx WeekHeatmap.tsx PeakHoursChart.tsx
  csv.ts                   toCsv (comma-separated, BOM, Latin digits — Excel en/ar both open it; no Turkish decimal comma)
  format.ts                money/number/compact/date formatters bound to locale + Latin digits (`ar-IQ-u-nu-latn`)
```

Search params (`routes/analytics.tsx`): `validateSearch: (raw): AnalyticsSearch => ({ range: preset|'custom' (default '30d'), from?, to? (yyyy-mm-dd), cmp?: 'prev'|'4w'|'52w' })`; navigation via `navigate({ search: (prev) => ({...prev, range}) })`. Range resolution happens in the component with `resolveRange(search, { todayISO: businessTodayISO(new Date(), startHour, VENUE_TZ) })` from core — the business-day start hour comes from `useCafeSettings()` and is loaded **before** any analytics query is enabled (`enabled: settings.isSuccess`).

Auto-refresh: options off/1/2/5 min in `localStorage['tp-analytics-refresh']`; countdown pill; pauses while `document.hidden`; disabled when `!isLiveRange(range)`. Implementation = `refetchInterval` on the queries + `queryClient.invalidateQueries({queryKey:['analytics']})`.

### 5.2 Data sources (our side)

| Source | What | Notes |
|---|---|---|
| SQL RPCs `app.analytics_*` (owner|manager) **[DB-CONTRACT]** | `analytics_daily_sales(p_from,p_to,p_start_hour)` → `{date, revenue_iqd, orders, tabs, guest_orders}`; `analytics_sold_items_by_day(p_from,p_to,p_start_hour)` → `{item_id, name_en, name_ar, category_id, date, qty, revenue_iqd}`; `analytics_best_sellers(p_from,p_to,p_start_hour,p_limit)`; `analytics_bought_together(p_from,p_to,p_start_hour,p_limit)` → `{a_item_id, b_item_id, a_name_*, b_name_*, count, confidence_pct, orders}`; `analytics_item_costs()` → `{item_id, name_*, category_id, sort_order, default_price_iqd, cost_iqd}`; `analytics_waiter_calls_daily(...)` → `{date, calls}` | Revenue = non-voided `order_items.line_total_iqd` on non-void tabs, bucketed by business day in `Asia/Baghdad` shifted by `p_start_hour`. Gross of tab-level discounts; the KPI card says "item sales (before tab discounts)" — reconcile with DB slice whether to expose net via payments |
| Edge `analytics-posthog` | HogQL named queries (below) | `configured:false` → engagement cards show the not-configured notice; sales-only mode still renders |
| Edge `analytics-insights` | Groq findings / patterns judge / rejections | `configured:false` → patterns fall back to templated sentences (core), insights card shows "AI not configured" |
| Supabase selects | `analytics_insights`, `analytics_patterns`, `analytics_insight_rejections` (owner RLS) | stored sets seed the cards on mount |
| `cafe_settings` | business day start, excluded item ids, engagement floor, hero mode | via `useCafeSettings()` |

Join key everywhere = **`item_id`** (PostHog events carry `item_id`; `order_items.menu_item_id`). This removes UpperDeck's whole name-canonicalisation layer (`clean-sales`, `menu-match`, aliases, Turkish suffixes) — none of it is ported.

### 5.3 Card matrix

| Zone | Card | Data source | Core module (pure TS) | Render |
|---|---|---|---|---|
| Deck | Missing-days banner | `analytics_daily_sales` dates | `range.salesCoverage(range, datesWithSales)`; reworded "N days with no sales recorded (closed?)"; mutes sales deltas when `< RELIABLE_COVERAGE` | inline notice |
| 01 Pulse | Sales IQD (+ delta vs compare) | `analytics_daily_sales` both windows | `compare.pctDelta` | `Kpi` |
| 01 | Covers `~` (estimate) / Tabs | tabs count from `analytics_daily_sales`; visits × covers multiplier | `overview` input | `Kpi estimated` |
| 01 | Per person IQD | sales in engagement window ÷ estimated covers | `range.engagementWindow` | `Kpi` |
| 01 | Unique visits | PostHog `session_stats` | — | `Kpi` |
| 01 | Menu views | PostHog `engagement_funnel` (Views step) | — | `Kpi` |
| 01 | Median session | PostHog `session_stats.medianSeconds` | `format.duration` | `Kpi` |
| 01 | Waiter calls | `analytics_waiter_calls_daily` (**DB truth**, not PostHog) | — | `Kpi` |
| 01 | Basket → call/order % | PostHog `basket_to_call` (basket_opened → waiter_called|order_submitted) | — | `Kpi` |
| 02 AI | Overview (deterministic) | everything above | `overview.buildOverview(input, locale)` | `OverviewCard` tone chip + 3 groups |
| 02 | AI insights | edge `analytics-insights {action:'load'|'recheck'}` + stored rows | `insightsText.{normalizeFinding, rankFindings, dropRejectedFindings, dropLowConfidenceClaims}` (client re-applies rejections on stored sets) | list; ✕ "Don't want findings like this" → `ConfirmDialog` with optional reason textarea (replaces `window.prompt`) → `{action:'reject'}`; shows `describeBasis`, thin-period warning, history `<details>` |
| 02 | Patterns | edge `{action:'patterns'}` (edge mines + judges) — **fallback**: when edge not configured, client runs `patterns.minePatterns()` locally over already-loaded data and shows `fallbackText` | `patterns` (miner), `confidence` | cards with kind chip + confidence chip + sample label |
| 03 Menu | Menu-engineering matrix | `analytics_sold_items_by_day` totals + `analytics_item_costs` | `menuMatrix.buildMenuEngineering(sold, costs, {popularityRule:0.7, reliableCoverage:0.6})` | 2×2 grid, coverage % line, "N sold items have no cost → link to /admin/menu" |
| 03 | Position card | sold totals + `analytics_item_costs` (`sort_order`, `category_id`) | `menuPosition.analyzeMenuPosition(slots, sold, {positionAsOf})` incl. `spearman`, `spearmanP` | category tiles + expanded ladder with rank-gap markers; copy says "related", never causal |
| 03 | Conversion table | PostHog `top_viewed_items` + `top_carted_items` (deep pool 80) + sold totals | `compare.buildItemConversion(views, carts, sold)`; `saleRatio` | sortable/searchable table, "Least sold first", CSV export, collapse at 15 |
| 03 | Top profit | matrix items | `menuMatrix` | list |
| 03 | Hidden gems | conversion rows | `compare.hiddenGems(rows)` (no food predicate — optional excluded categories later) | list |
| 03 | Momentum | PostHog `top_viewed_items` current + previous window | `compare.itemMomentum(cur, prev, engNow, engPrev)` | rising / fading |
| 03 | Bought together | `analytics_bought_together` (SQL does the pair tally) | `basket.rankPairs()` only if the SQL returns raw co-occurrence | list with confidence % |
| 03 | Promo performance | PostHog `promo_engagement` + `cafe_settings.hero_mode` + `addon_suggestions` count | `promo.buildPromoPerformance` | featured / suggested clicks, sessions, follow-through % |
| 04 Sales | Sales vs engagement | `analytics_daily_sales` + PostHog `daily_engagement` + waiter calls daily | `compare.salesVsEngagement(sales, engagement)` (`revenue:null` gap days) | Recharts `ComposedChart` bars + 2 lines, dual axis |
| 04 | Best sellers | `analytics_best_sellers` | — | `HBarChart` |
| 04 | Looked-not-bought | PostHog `abandoned_views_by_day` + sold-by-day | `compare.abandonedViewsNet(byDay, soldByDay)` (day-level suppression) | stacked bars by dwell bucket + legend text |
| 04 | Table activity | PostHog `table_activity` | — | `HBarChart` |
| 04 | Engagement funnel | PostHog `engagement_funnel` | — | hand-rolled `FunnelBars` |
| 04 | Price-band conversion | PostHog `item_views_with_price` + sold totals + item prices | `priceBands.buildPriceBands(views, sold, prices, {edges:[5_000, 10_000]})`, capped at 100 % + "sold without a view" chip | `ConversionBars` with expandable items |
| 04 | Category popularity | PostHog `category_popularity` (category_id) → names from `adminMenu` categories in locale | — | `HBarChart` |
| 05 Time | Locale preferences | PostHog `locale_preferences` (ar/en) | — | `LocalePrefs` |
| 05 | Week heatmap | PostHog `week_heatmap` (day × hour, business-day shifted) | — | CSS-grid heatmap, sequential blue ramp, busiest cell brown |
| 05 | Peak hours | PostHog `peak_hours` | — | `PeakHoursChart` 24 bars, peak in brown |

### 5.4 Charts

- Dependency: `recharts ^3` in `apps/operator/package.json` (only import from analytics files; route is lazy so till/KDS never load it).
- `charts/colors.ts`: literals mirrored from `cafePalette` (`BLUE #3360AB`, `BROWN #603813`, `INK #2B1A0E`, `MUTED #6B5D4E`, `GRID #E0D8CE`) with a comment pointing at `packages/ui/src/tokens/palette.ts` (Recharts cannot read CSS vars). Series: sales = blue, views = brown, calls = muted; heatmap ramp = white → blue, peak = brown.
- RTL: chart containers are wrapped in `<div dir="ltr">` (axes keep numeric left-to-right); category tick labels render Arabic fine inside SVG; tooltips/legend use `tr()` strings and `dir` from locale on the tooltip content wrapper. Numbers via `format.ts` (Latin digits both locales, consistent with `formatIQD`).
- Desktop only: fixed heights (220–320 px), `minInlineSize: 1024px` on the page wrapper; no `useIsMobile`.
- States per card: `Skeleton` while any of its queries load; `Empty note` when data empty; "PostHog not configured" notice once in zone 01 and an inline muted line on each engagement card; error → `ErrorText` + retry button.

---

## 6. Edge-function clients (`apps/operator/src/lib/edge.ts`)

```ts
export type EdgeFunctionName = 'analytics-posthog' | 'analytics-insights';
export class EdgeError extends Error { status: number; code: 'NOT_CONFIGURED'|'FORBIDDEN'|'AUTH_REQUIRED'|'UPSTREAM'|'RATE_LIMITED'|'UNKNOWN' }
export async function callEdge<Req, Res>(fn: EdgeFunctionName, body: Req, opts?: { cacheKey?: string; ttlMs?: number; signal?: AbortSignal }): Promise<Res>
```
- URL `${import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/functions/v1/${fn}`; headers `Authorization: Bearer ${session.access_token}` (from `supabase.auth.getSession()`), `apikey: anon`, `Content-Type: application/json`.
- 30 s in-memory cache keyed by `cacheKey ?? fn + stableStringify(body)`; only successful responses cached; `invalidateEdgeCache(prefix)` for "recheck".
- Status→code map: 401 AUTH_REQUIRED, 403 FORBIDDEN, 429 RATE_LIMITED, 503 with `{code:'NOT_CONFIGURED'}` NOT_CONFIGURED, 502/5xx UPSTREAM; one retry on 5xx.
- `lib/errors.ts`: `errorToMessageKey` gains `if (error instanceof EdgeError) return \`op.errors.EDGE_${error.code}\``; codes added to catalogs.

Typed API (`lib/analyticsApi.ts`):
```ts
export type PosthogQueryName = 'top_viewed_items'|'top_carted_items'|'abandoned_views_by_day'|'table_activity'|'basket_to_call'|'category_popularity'|'locale_split'|'engagement_funnel'|'session_stats'|'daily_engagement'|'item_views_with_price'|'week_heatmap'|'promo_engagement'|'locale_preferences'|'peak_hours';
export interface PosthogQuery { name: PosthogQueryName; from: string; to: string; businessDayStart: number; limit?: number }
export interface PosthogBatchRequest { queries: PosthogQuery[] }
export interface PosthogBatchResponse { configured: boolean; floor: string | null; results: Record<PosthogQueryName, unknown[]> }
export function posthogQueries(qs: PosthogQuery[]): Promise<PosthogBatchResponse>   // ONE round-trip per dashboard load

export type InsightsRequest =
  | { action: 'load' | 'recheck'; range: DateRange; cmp: CompareBasis; locale: Locale }
  | { action: 'patterns'; mode: 'load' | 'rescan'; range: DateRange; locale: Locale }
  | { action: 'reject'; text: string; reason?: string; range: DateRange; cmp: CompareBasis; locale: Locale };
export type InsightsResponse =
  | { ok: true; configured: boolean; findings: { text: string; isNew: boolean }[]; resolved: string[]; basis: DataBasis; replaced?: boolean }
  | { ok: true; configured: boolean; patterns: PatternItem[] }
  | { ok: false; reason: string; retryable: boolean };
```
**[DB-CONTRACT]** the edge fn does the data pull + Groq call + persistence server-side (owner JWT); it must accept `locale` and store findings per `(range_from, range_to, compare_basis, locale)` — Arabic-first UI means an `ar` finding set is the default. Rejections persist before any model call.

---

## 7. i18n — new key groups (EN + AR both required; `Messages` type enforces parity)

Module title: `analytics: { title: 'Analytics' / 'التحليلات' }` beside `admin.title` (en.ts:75).

| Group | Keys (EN) — AR must be written natively | 
|---|---|
| `op.adminNav` | menu · categories · addons · suggested · hero · qr · telegram · settings · staff · rates · hours · dayClose · groupMenu "Menu" · groupGuest "Guest app" · groupOps "Operations" · groupSystem "System" (AR: القائمة · الفئات · الإضافات · المقترحات · واجهة البداية · رموز QR للطاولات · تيليغرام · الإعدادات · الموظفون · الأسعار · ساعات العمل · إغلاق اليوم) |
| `op.common` (+) | unsavedPrompt · search · remove · replace · upload · uploading · dragHere · moveUp · moveDown · connecting · live · disconnected · retry · notConfigured · copy · print · back · yes · no |
| `op.toast` | saved (تم الحفظ) · removed · uploadFailed · tooLarge {mb} · invalidImage · rotated · enqueued · offline |
| `op.confirm` | title · rotateTokens · rotateTokensBody · deleteOption · removePhoto · clearReveals |
| `op.menu` (+) | hookEn · hookAr · hookPlaceholder · highlight · highlightNone · highlightBlue · highlightBrown · soldOut · soldOutShort · offToday {date} · cost · costHint "blank = unknown, never 0" · margin {pct} · noCost · noCostCount {count} · photo · photoHint · search · defaultPrice · reorder |
| `op.categories` | title · photo · photoHint · active · reorder |
| `op.addons` | groups · subGroups · subGroupsHint · newGroup · newSubGroup · linkedItems · options · newOption · reveals · revealsHint · noSubGroups · minMax · required · delta · active |
| `op.suggested` | title · pickItem · suggestions · add · max {count} · none · selfHint |
| `op.hero` | title · mode · modeNone/Media/Featured (+ …Hint ×3) · media · mediaHint {mb} · video · featuredItem · label · badge · discount · ticker · tickerHint · addPhrase · preview · previewTable |
| `op.qr` | title · subtitle {count} · print · printHint · bell · bellOn · bellOff · rotate · rotateAll · version {v} · scanLine "Scan to see the menu & order" (AR from qr-artwork: امسح الرمز لعرض القائمة والطلب) · tableWord "TABLE" / "طاولة" · noSiteUrl · brandLine "Scan · Order · Relax" |
| `op.telegram` | title · chatId · chatIdHint · howToFind · steps.1…5 · lang · langAr/En/Both · sendTest · testSent · testFailed · outbox · status.queued/sent/failed · attempts {n} · retry · lastError · webhook · webhookHint · botConfigured · botMissing |
| `op.settings` | title · businessDay · businessDayHint · calendarDay · hour {hour} · cooldown · cooldownHint · excludedItems · excludedHint · coversMult · coversMultHint · engagementFloor |
| `op.kds` (+) | startShift · startShiftHint · staleBanner {count} · stale · newTicket · unseen {count} · connection |
| `op.floor` (+) | escalated · overdue {minutes} · sourceGuest |
| `analytics.*` (new top-level namespace, ~180 keys) | `deck.*` (today/7d/30d/90d/custom/apply/from/to/compare/prev/4w/52w/compareHint.*/businessDay/refresh/refreshOff/min {n}/excluded/covers) · `zones.pulse/ai/menu/sales/time` (+desc) · `kpi.*` (sales/salesNote/covers/estimated/perPerson/visits/views/median/calls/basketToCall/vs {range}/mutedReason) · `notices.*` (noPosthog/noAi/floor {date}/businessDayLine/thinPeriod/coverage {missing}) · `overview.*` (tones, strengths/push/watch, headline templates) · `insights.*` (generate/recheck/retry/checking/reject/rejectPrompt/rejectReason/rejected/noReplacement/history/basis/resolved/ongoing/new) · `patterns.*` (kinds ×5, confidence ×3, rescan, sample labels `days {n}`/`coOrders {n}`/`weekdays {n} {day}`/`views {n}`, templates per family used by `fallbackText`) · `matrix.*` (quadrants + actions ×4, coverage, noCost, setup link) · `position.*` (verdict lines top/bottom/none, strength ×4, buried/squatters, asOf, assumption) · `conversion.*` (columns, sources "Menu (QR) · viewers" / "Till · all guests", leastSold, csv, howToRead, showAll) · `cards.*` (topProfit/hiddenGems/momentum/rising/fading/notComparable/boughtTogether/withX {pct}/promo/featured/suggested/followThrough/locale/heatmap/peakHours/bestSellers/lookedNotBought/dwell buckets ×3/tableActivity/funnel/priceBands/bands ×3/categoryPop) · `weekdays.*` (Mon…Sun) · `empty.*` per card |
| `op.errors` (+) | `SELF_SUGGESTION` · `REVEAL_CYCLE` · `REVEAL_NOT_SUBGROUP` · `INVALID_SETTING` · `SETTING_NOT_FOUND` · `INVALID_HIGHLIGHT` · `INVALID_COST` · `INVALID_PHOTO_PATH` · `TELEGRAM_NOT_CONFIGURED` · `OUTBOX_NOT_FOUND` · `INVALID_CHAT_ID` · `INVALID_HOUR` · `EDGE_NOT_CONFIGURED` · `EDGE_FORBIDDEN` · `EDGE_AUTH_REQUIRED` · `EDGE_UPSTREAM` · `EDGE_RATE_LIMITED` · `EDGE_UNKNOWN` — e.g. EN "Analytics service is not configured yet." / AR "خدمة التحليلات غير مُعدّة بعد." ; `REVEAL_CYCLE` EN "A sub-group cannot reveal a group that leads back to itself." / AR "لا يمكن لمجموعة فرعية أن تكشف مجموعة تعود إليها." |

All new codes go into `MAPPED_CODES` (`lib/errors.ts`) and `errors.test.ts` asserts each resolves in both catalogs with `ar ≠ en`. **[DB-CONTRACT]** the final code list must be copied from the DB slice's migrations.

---

## 8. Env / type plumbing

- `apps/operator/src/vite-env.d.ts`: add `readonly VITE_GUEST_SITE_URL?: string` (origin printed into QR cards, e.g. `https://touchcafe.iq`). Nothing for PostHog/Groq (proxied; keys never reach the renderer).
- `apps/operator/package.json` deps: `recharts ^3`, `qrcode ^1.5.4`; dev: `@types/qrcode`. No `browser-image-compression`, no `posthog-js`, no zod (hand parsers).
- `AppFunctionName = keyof Database['app']['Functions']` — every new RPC name compiles only after the DB slice lands and `pnpm db:types` regenerates `packages/db/src/types.gen.ts`; UI waves that call new RPCs therefore depend on that commit. Until then, RPC names live in one `lib/rpcNames.ts` const map so a rename is one edit.
- `packages/core/src/index.ts`: `export * from './analytics'` (barrel) — keep `insightsText.ts` import-free so the Deno edge function can `import` it by relative `.ts` path.
- Electron: `autoplayPolicy` + `setWindowOpenHandler` in `apps/operator-shell/src/main/index.ts`.

---

## 9. Core package modules (`packages/core/src/analytics/`) — signatures

All pure, no I/O, locale-aware copy through a `Copy` object passed in (not `tr()` — core must not depend on `@touch/i18n`; the operator adapts `tr` into the `Copy` shape). Money = integer IQD. TZ = `Asia/Baghdad` passed explicitly (`VENUE_TZ`). Tests beside each file, IQD fixtures.

```ts
// range.ts
export type DateRange = { from: string; to: string };
export type RangePreset = 'today'|'7d'|'30d'|'90d'|'custom';
export type CompareBasis = 'prev'|'4w'|'52w';
export const RELIABLE_COVERAGE = 0.9;
export function businessTodayISO(now: Date, startHour: number, tz: string): string;      // uses Intl en-CA in tz
export function isLiveRange(range: DateRange, todayISO: string): boolean;
export function datesInRange(range: DateRange): string[];
export function rangeLength(range: DateRange): number;
export function previousRange(range: DateRange): DateRange;
export function shiftRange(range: DateRange, days: number): DateRange;
export function resolveRange(params: {range?: string; from?: string; to?: string}, todayISO: string): { preset: RangePreset; range: DateRange };
export function resolveCompare(cmp: string | undefined, range: DateRange): { basis: CompareBasis; range: DateRange };   // 28 / 364-day weekday-aligned
export type SalesCoverage = { days: number; daysWithData: number; missing: string[]; ratio: number };
export function salesCoverage(range: DateRange, datesWithData: Iterable<string>): SalesCoverage;
export type EngagementWindow = { from: string; to: string; days: number; clipped: boolean; empty: boolean };
export function engagementWindow(range: DateRange, floorISO: string | null): EngagementWindow;

// businessDay.ts
export const BUSINESS_DAY_START_OPTIONS = [0,4,5,6,7,8] as const;
export function normalizeBusinessDayStart(v: unknown): number;          // 0..12 else 0
export function businessDayOf(instant: Date, startHour: number, tz: string): string;   // yyyy-mm-dd (uses core/time localParts)

// confidence.ts
export type DataBasis = { rangeDays; salesDays; weekdayCounts: {day: number; days: number}[]; sessions; engagementDays; itemsWithSales };
export const MIN_WEEKDAY_DAYS = 4, MIN_TREND_DAYS = 7, THIN_PERIOD_DAYS = 10;
export function buildDataBasis(input: { range: DateRange; salesDates: string[]; sessions: number; engagementDays: number; itemsWithSales: number }): DataBasis;
export function isThinPeriod(b: DataBasis): boolean;
export function thinWeekdays(b: DataBasis): number[];                       // JS weekday indexes; UI maps to names

// compare.ts   (id-keyed; no name canonicalisation)
export type ItemRef = { id: string; nameEn: string; nameAr: string };
export type ItemConversion = ItemRef & { views: number; carts: number; sold: number; convPct: number };
export function buildItemConversion(views: {id; count}[], carts: {id; count}[], sold: {id; qty}[], names: Map<string, ItemRef>, limit?: number): ItemConversion[];
export function saleRatio(sold: number, views: number): { kind: 'none'|'zero'|'lt'|'ratio'; value?: number };   // UI formats
export function abandonedViewsNet(byDay: AbandonedViewDay[], soldByDay: {id; date; qty}[], limit?: number): AbandonedView[];
export function hiddenGems(rows: ItemConversion[], limit?: number): HiddenGem[];
export function itemMomentum(cur: {id;count}[], prev: {id;count}[], engNow: EngagementWindow, engPrev: EngagementWindow, names, limit?): MomentumResult;
export function salesVsEngagement(sales: {date; revenueIqd; tabs}[], eng: {date; views; waiterCalls}[]): { date; revenue: number|null; views; waiterCalls }[];
export function pctDelta(cur: number, prev: number): number | null;

// menuMatrix.ts
export type MenuQuadrant = 'star'|'plowhorse'|'puzzle'|'dog';
export const RELIABLE_COST_COVERAGE = 0.6;
export function buildMenuEngineering(sold: {id; qty; revenueIqd}[], items: {id; nameEn; nameAr; defaultPriceIqd; costIqd: number|null}[], opts?: {popularityRule?: 0.7}): MenuEngineering;   // unitPrice = revenue/qty else list price; null cost → excluded, coverage reported
export function menuEngineeringForModel(me: MenuEngineering, limit?: number): MenuEngineeringForModel | null;

// menuPosition.ts
export function spearman(xs: number[], ys: number[]): number;
export function spearmanP(rho: number, n: number): number;
export function buildMenuSlots(items: {id; nameEn; nameAr; categoryId; categoryNameEn; categoryNameAr; sortOrder; priceIqd}[]): MenuSlot[];   // rank within category
export function analyzeMenuPosition(slots: MenuSlot[], sold: {id; qty; revenueIqd}[], positionAsOf: string): MenuPositionAnalysis;

// priceBands.ts
export const PRICE_BAND_EDGES_IQD = [5_000, 10_000] as const;
export function bandOf(priceIqd: number, edges?): 0|1|2;
export function buildPriceBands(views: {id; priceIqd; views}[], sold: {id; qty; revenueIqd}[], prices: Map<string, number>, keep: (id) => boolean): PriceBandSales[];

// basket.ts
export function rankPairs(raw: {a; b; count; aCount; bCount}[], limit?): ItemPair[];    // confidence from rarer side; count ≥ 2

// overview.ts
export function buildOverview(input: OverviewInput, copy: OverviewCopy): Overview;   // MOVE=5, MIN_VIEWS=5; profit lines lead when hasData

// patterns.ts  (miner; inputs pre-aggregated by the caller)
export type PatternKind = 'co-move'|'basket'|'time'|'segment'|'margin';
export function minePatterns(input: PatternsInput, level: 0|1|2, copy: PatternsCopy): PatternCandidate[];   // busy-day share control; sample tiers; fallbackText from copy templates
export const MAX_PATTERN_LEVEL = 3;

// insightsText.ts  (NO imports — shared with the Deno edge fn by relative path)
export const normalizeFinding = (s: string) => string;                     // lowercase, strip punctuation/ws, Arabic tatweel + diacritics removed, Latin digits
export function findingImpact(text: string): number;                       // largest IQD amount cited (accepts "12,500" and "12٬500")
export function rankFindings(findings: string[], limit?: number): string[];
export function dropRejectedFindings(findings: string[], rejectedKeys: Set<string>): { kept: string[]; dropped: string[] };
export function dropLowConfidenceClaims(findings: string[], basis: DataBasis, weekdayNames: {en: string[]; ar: string[]}): string[];
export function dropExcludedMentions(findings: string[], excludedNames: string[]): string[];

// exclusions.ts
export function makeKeepFilter(excludedIds: Set<string>): (id: string) => boolean;
export function exclusionSignature(excludedIds: Iterable<string>): string;
```

Not ported (by decision): `clean-sales`, `menu-match`, `import-review`, `parse-pos`, `food`, `sales.ts` (SQL replaces), `posthog.ts` (edge fn), `insights.ts` Groq calls (edge fn).

---

## 10. Tests

| Layer | Add | Command |
|---|---|---|
| `packages/core` vitest | `analytics/*.test.ts`: range (presets around a 06:00 business day at 01:30 Baghdad; 28/364 shifts land on same weekday; coverage), businessDay, confidence, compare (id join sums duplicates; gap days null; momentum non-comparable when windows differ), menuMatrix (null cost excluded, coverage ratio, weighted margin axis, losing-money flag, IQD integers), menuPosition (spearman known vectors, p-value monotone, within-category ranks), priceBands (IQD edges, cap 100 %, surplus chip), basket, overview (tone selection, profit lines lead), patterns (busy-day share control kills a pure-volume pair; low tier labelled not dropped), insightsText (normalise Arabic digits/diacritics; rank by IQD amount; rejections filter) | `pnpm --filter @touch/core test` |
| operator vitest | `lib/auth.test.ts` (canAccess prefix/deny), `features/kds/alarms.test.ts`, `features/admin/qr/qrCard.test.ts`, `lib/edge.test.ts` (status→code, cache TTL with fake timers), `lib/errors.test.ts` (+ new codes, `EdgeError` mapping), `features/analytics/search.test.ts` (validateSearch), `features/analytics/csv.test.ts` | `pnpm --filter @touch/operator test` |
| Component tests | **Not added** — would need jsdom + testing-library + a new vitest env split; the cost/benefit is poor for inline-styled forms. Rely on `tsc --noEmit` + Playwright | — |
| i18n parity | `Messages` type already fails typecheck on missing AR keys | `pnpm --filter @touch/i18n typecheck` |
| e2e `e2e/tests/operator-journey.spec.ts` (+ `@ar` twin for nav labels) | (a) manager: `/admin/hero` set featured item + label → `cafe_settings` row via service client; guest `/t/{token}` shows the marquee text. (b) manager: toggle sold-out on "Cappuccino" → guest menu shows the sold-out stamp and `create_guest_order` returns `ITEM_UNAVAILABLE`; toggle back. (c) `/admin/qr` renders 12 `svg[data-qr-card]` and each `<path>` non-empty; bell switch persists `cafe_tables.bell_enabled`. (d) owner: `/admin/telegram` send test → `telegram_outbox` has a `kind='test'` row (no bot configured → status stays queued/failed, UI shows it). (e) owner: `/analytics?range=7d` renders zone headings and the "PostHog not configured" notice; sales KPI shows a formatted IQD amount after the cafe-journey order. (f) prep: KDS shows Start shift; after a guest order the ticket card exists; after 90 s (test injects `created_at` − 100 s via service client) the stale banner appears | `pnpm e2e -- --grep "operator"` |

---

## 11. Delivery waves (disjoint file sets) + verification

| Wave | Scope | Files (all under `apps/operator/src` unless noted) | Depends on | Verify |
|---|---|---|---|---|
| **W0 Foundations** | deps; `GlobalStyles`; toast; ConfirmDialog; Spinner/Skeleton/Tabs/Select/Switch/SortButtons; inputs (`BilingualFields` moved); `ImageField` + `lib/image.ts` + `lib/storage.ts`; `lib/edge.ts`; `lib/settings.ts`; `lib/rpcNames.ts`; `auth.tsx` prefix-deny + tests; routing skeleton (`routes/admin.tsx` layout + children rendering existing editors, `routes/analytics.tsx` placeholder, `__root.tsx` NAV); `vite-env.d.ts`; `errors.ts` EdgeError; catalog groups `op.adminNav/common/toast/confirm/errors` | `package.json`, `components/*`, `lib/*`, `routes/*`, `packages/i18n/src/catalogs/{en,ar}.ts` | none (DB-independent) | `pnpm --filter @touch/operator typecheck && test`; `pnpm --filter @touch/i18n typecheck`; manual: `/admin/menu` URL-synced, forbidden `/admin/telegram` for manager |
| **W1 Core analytics** (parallel with W0–W3) | `packages/core/src/analytics/*` + tests + barrel | `packages/core/**` | none | `pnpm --filter @touch/core typecheck && test` |
| **W2 Menu family** | `features/admin/menu/*`, `features/admin/addons/*`, `features/admin/suggested/*`; catalog `op.menu/categories/addons/suggested` | those dirs | DB slice RPCs + `pnpm db:types` | operator typecheck/test; e2e (b) |
| **W3 Guest-app + system admin** | `features/admin/hero/*`, `qr/*` (+`qrCard.test.ts`), `telegram/*`, `settings/*`, `staff/*`; `operator-shell/main/index.ts` (`setWindowOpenHandler`); catalog `op.hero/qr/telegram/settings` | those dirs | DB slice (`cafe_settings`, `table_qr_tokens`, bell, outbox) | e2e (a)(c)(d); manual print preview A6 |
| **W4 KDS + floor** | `lib/audio.ts`, `lib/realtime.ts` status/reconnect, `features/kds/{alarms.ts,alarms.test.ts,useKdsAlarms.ts,KdsBoard.tsx}`, `features/till/{WaiterCallsPanel.tsx}` + 6-line `TillScreen.tsx` `onEvent` hook, `ConnectionPill`; `operator-shell` `autoplayPolicy`; catalog `op.kds/floor` | those files | none (existing RPCs/broadcasts) | operator test (alarms); `pnpm --filter @touch/operator-shell typecheck`; e2e (f); manual: two windows, guest order → chime |
| **W5 Analytics UI** | `features/analytics/**`, `lib/analyticsApi.ts`, `routes/analytics.tsx` real component; catalog `analytics.*`, `op.errors.EDGE_*` | those files | W0, W1, DB slice `analytics_*` RPCs + edge functions deployed (or `configured:false` path) | typecheck/test; e2e (e); manual AR pass on every zone |
| **W6 Hardening** | e2e specs, `docs/` operator setup notes (Telegram chat id, `VITE_GUEST_SITE_URL`), HANDOFF update | `e2e/tests/*`, docs | all | `pnpm typecheck && pnpm test && pnpm e2e` |

Full gate: `pnpm typecheck` (turbo, includes db types drift) · `pnpm test` · `pnpm e2e`.

---

## 12. Risks and open contract items

1. **DB/edge contract drift** — every **[DB-CONTRACT]** above (RPC names/arg shapes, `cafe_settings` keys, error codes, `locale` on insight tables, `menu` broadcast coverage, gross vs net sales) must be reconciled with the DB slice before W2/W3/W5 start; `lib/rpcNames.ts` localises renames.
2. **`AppFunctionName` typing** blocks compilation until `types.gen.ts` is regenerated — sequence W2+ after the DB migration commit.
3. **Autoplay**: browser dev/e2e still needs the Start-shift gesture; Electron flag removes it on stations. Test both paths.
4. **Print fidelity**: Chromium honours `@page size: A6` only when the user leaves "Default" paper in the dialog; document in `op.qr.printHint`. Fonts on cards are the generic sans stack until brand fonts land (swap point kept).
5. **Recharts bundle** (~150 KB gz) — lazy route keeps it off till/KDS; verify with `vite build` chunk report.
6. **PostHog absent at launch** (decision 11) — the whole analytics page must render in sales-only mode; e2e (e) enforces it.
7. **Groq/locale**: bilingual findings double model calls if both locales are generated; recommend generating in the requesting locale only and storing per locale.
8. **Covers are estimates** (no POS covers) — always shown with `~` and the multiplier control; never fed into deltas.
9. **Position analysis assumption** (sort_order is "now") — stated on the card; no position history table.
10. **Image compression via canvas** drops EXIF orientation on some JPEGs; `createImageBitmap(file, { imageOrientation: 'from-image' })` handles it in Chromium — keep that option.
11. **Global `<style>`** introduces the only non-inline CSS; keep it to keyframes + print rules to preserve the "inline + logical properties" convention.

---

### Critical Files for Implementation
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\apps\operator\src\lib\auth.tsx` — `ROUTE_ROLES` prefix matching + default-deny; gates every new section
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\apps\operator\src\routes\admin.tsx` — becomes the admin layout route with sub-nav + child routes (replaces the tab strip)
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\apps\operator\src\components\ui.tsx` — primitive kit extension (toast/confirm/switch/image field split alongside it)
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\apps\operator\src\lib\realtime.ts` — channel status + reconnect + `onEvent` used by KDS chime and stale alarms
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\packages\core\src\analytics\` (new) — ported pure analytics modules shared by the operator UI, tests and the insights edge function