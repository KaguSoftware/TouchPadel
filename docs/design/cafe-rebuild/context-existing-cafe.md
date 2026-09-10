# TouchPadel — existing cafe implementation map (as of 2026-08-25, commit b916d3d)

Monorepo root: `c:\Users\p.mansouri\Desktop\kagu software\TouchPadel`. pnpm 9 + turbo. Apps:
`apps/web` (Next 16.3 App Router, Vercel), `apps/operator` (Vite+React SPA), `apps/operator-shell`
(Electron), `apps/mobile` (Expo — padel only). Packages: `@touch/db`, `@touch/core`, `@touch/ui`,
`@touch/i18n`, `@touch/config`.

## 1. WEB APP (`apps/web`)
Routes under `app/[locale]`:
- `layout.tsx` — only `<html>`; `lang`, `dir`, `data-theme="padel"`; Google Fonts Montserrat + IBM
  Plex Sans Arabic; inlines `themeCss` + `appCss` (from `src/styles/app-css.ts`, one template string,
  BEM-ish `tp-*` classes, logical properties only, NO animations, no dark mode, 1 breakpoint 640px).
- `(public)/layout.tsx` — padel chrome (header logo, nav to /menu, locale toggle, footer).
- `(public)/page.tsx` — venue landing (ISR 300, `fetchVenuePublic`). TO BE DROPPED.
- `(public)/menu/page.tsx` — read-only menu (ISR 60, `fetchMenu(createStaticSupabase())`), plus
  `MenuLive.tsx` client island subscribing to broadcast topic `menu` / `menu_changed` → router.refresh.
- `t/[token]/page.tsx` — server shell rendering `<CafeApp locale token/>`; robots noindex.
- `manifest.ts` (PWA manifest using cafePalette), `robots.ts` (disallows /t/), `middleware.ts`
  (accept-language locale negotiation, default `en`; `/t/{token}` is REWRITTEN not redirected so the
  printed URL stays verbatim; TODO comment about cookie exchange never implemented).
- Supabase clients: `src/lib/supabase/static.ts` (cookie-free), `client.ts` (`createBrowserClient` +
  non-throwing `tryCreateBrowserSupabase`), `server.ts` (unused by cafe), `env.ts` (accepts
  NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
- `src/lib/menu.ts` `fetchMenu(client)`: 4 parallel queries (menu_categories active; menu_items
  active with nested variants, allergens, modifier groups→modifiers; `menu_item_availability` view →
  orderable map; addon_suggestions) → `MenuCategory[] → MenuItem[]`. `photo_path` fetched, typed,
  NEVER rendered. `fetchVenuePublic` reads `venue_settings_public` view.
- `src/lib/appRpc.ts`: `appRpc(client, fn, args)` = `client.schema('app').rpc`; `RPC_ERROR_KEYS`
  maps raised codes (TOKEN_INVALID, SESSION_EXPIRED, DEGRADED_LOCKOUT, CAFE_CLOSED, EMPTY_ORDER,
  ITEM_UNAVAILABLE, VARIANT_NOT_FOUND, MODIFIER_INVALID, MODIFIER_SELECTION, INVALID_QTY,
  ALREADY_NOTIFIED, CALL_COOLDOWN, FORBIDDEN…) → i18n keys.
- `src/lib/cafe/basket.ts`: pure client basket; `BasketLine` (key, itemId, variantId, qty, notes,
  modifiers[], display snapshots, unit_price_iqd); `lineTotal` mirrors SQL `add_order_items`;
  `violatedGroup(groups, chosen)`; `buildLine` validates; `toOrderPayload` → ids+qty only, NO prices;
  localStorage draft `tp-basket-{tableId}`. Tests in `basket.test.ts`.
- Components `src/components/cafe/`:
  - `CafeApp.tsx` (582 L, ONE client component): boot = `auth.getSession()` → `signInAnonymously()`
    → `appRpc('open_table_session',{p_token})` → `{session_id, table_id, table_number, expires_at}`;
    module-scope `bootCache` Map to survive StrictMode double-mount; phases connecting/invalid/expired/
    error/ready; expiry timer re-armed after every write (`refreshExpiry` reads guest_sessions);
    `fetchMenu` after ready; category pill tabs + one active category; degraded polling
    `appRpc('venue_mode')` every 30 s (banner + submit disabled); `loadOrders()` selects orders +
    order_items for the session; realtime broadcast `session:{sessionId}` private channel, event
    `order_status` `{order_id,status}`; waiter call status POLLED every 20 s (floor topic is
    staff-only); submit = `create_guest_order({p_items, p_idempotency_key})` with one idempotency key
    per attempt batch; call waiter = `raise_waiter_call({p_reason})` (order|bill|water|assistance),
    ALREADY_NOTIFIED / CALL_COOLDOWN shown as info toasts; chrome = sticky topbar "Touch Cafe" +
    table label + locale link, pay-at-desk notice bar, fixed bottom basket bar. `data-theme="cafe"`
    on the wrapper div.
  - `ItemSheet.tsx` — bottom sheet dialog: size radios, modifier groups (radio if max_select=1 else
    checkbox, min/max hint, required), live price preview, "goes well with" chips, notes textarea
    (280), qty 1–99, CTA disabled while a group is violated.
  - `BasketSheet.tsx` — lines, remove, total, degraded warn, pay-at-desk notice, submit.
  - `WaiterSheet.tsx` — 2×2 reason buttons; degraded refusal.
  - `OrdersPanel.tsx` — one card per order; 3-step progress sent→preparing→ready (served fills all;
    voided hides); status words Received/Preparing/Ready/Delivered/Cancelled.
- i18n: `src/lib/locales.ts` (`LOCALES=['en','ar']`, `DEFAULT_LOCALE='en'`, `asLocale`,
  `otherLocale`); `packages/i18n` hand-rolled: `t(locale,key,params)`, `MessageKey` = typed dotted
  paths from `catalogs/en.ts` (ar.ts must mirror), `formatIQD` (throws on non-integer; Latin digits in
  both locales), `formatDate/Time/Number`, `VENUE_TZ='Asia/Baghdad'`, `isolate()` bidi wrap,
  `dirAttr`, `isRtl`. Catalog namespaces: common, auth, courts, operator, till, desk, kds, stock,
  admin, booking, settings, cafe (49 keys), landing, seo, errors, degraded, op.
- RTL = `dir="rtl"` + `[dir='rtl'] { font-family: var(--tp-font-arabic) }` only.

## 2. DATABASE (`packages/db/supabase/migrations`, 0001–0026, no 0023)
Enums (0002): tab_status(open, awaiting_payment, settled, void); order_source(guest_web, till);
order_status(sent, preparing, ready, served, voided); ticket_status(queued, preparing, ready,
completed, voided); waiter_call_reason(order, bill, water, assistance); waiter_call_status(raised,
acknowledged, resolved). Domains `iqd` (bigint ≥0), `iqd_signed`.

0013_menu: `menu_categories(id, name_en, name_ar, tax_group_id, sort_order, is_active)`;
`menu_items(id, category_id, name_en/ar, description_en/ar, photo_path, is_active, unavailable_on
date, sort_order)`; `menu_item_variants(id, item_id, name_en/ar, price_iqd, is_default, sort_order)`
(absolute price per size); `modifier_groups(id, name_en/ar, min_select, max_select)` (GLOBAL,
reusable); `modifiers(id, group_id, name_en/ar, price_delta_iqd, sort_order, is_active)`;
`menu_item_modifier_groups(item_id, group_id, sort_order)`; `allergens(id, code, label_en/ar)`;
`menu_item_allergens`; `addon_suggestions(item_id, suggested_item_id, sort_order)`. View
`menu_item_availability(item_id, orderable)` (stock-aware; 0025 wraps it in `app.menu_availability()`
definer fn granted to anon+authenticated). Menu tables: NO direct write grants — admin RPCs
`upsert_menu_category`, `upsert_menu_item(... p_photo_path default null — UPDATE branch sets
photo_path unconditionally → MenuEditor never passes it → photo wiped on every save: BUG)`,
`upsert_variant`, `upsert_modifier_group`, `upsert_modifier`, `set_item_availability` (86 = sets
unavailable_on = current_date, auto-restores), `link_item_modifier_group`,
`set_addon_suggestions(p_item_id, uuid[])` (raises SELF_SUGGESTION), `set_opening_hours`,
`upsert_rate_rule`. All manager|owner + `write_audit`.

0014_tables_sessions: `cafe_tables(id, table_number unique, zone, capacity, token_version, is_active)`
— NO bell flag; `guest_sessions(id, table_id, auth_user_id, linked_profile_id, created_at,
last_activity_at, expires_at, closed_at)`; `app.secrets`. Token = `b64url("{table_id}.{version}.
{hmac_sha256}")`, never stored; secret from Vault → app.secrets → bootstrap. RPCs:
`generate_table_token(p_table_id)` (manager/owner… actually owner-only per 0014:118 comment),
`verify_table_token` (NULL on any failure), **`open_table_session(p_token)` = the ONLY anon-executable
fn** (requires auth.uid(), refresh if same table, close+insert if moved; returns jsonb), internal
`touch_guest_session()` (slides expires_at = now()+ttl, raises SESSION_EXPIRED), `is_own_session`,
`rotate_table_token` (owner, audited). `venue_settings` (0006) singleton with fixed columns
(table_token_ttl_minutes 90, waiter_call_cooldown_seconds 120, heartbeat_stale_seconds 45,
tax_inclusive, cash_rounding_iqd, phone (0026), opening hours, closed_dates…) + definer view
`venue_settings_public`. NO key/value settings table exists.

0015_tabs_orders: `day_sessions`, `tabs(day_session_id, status, table_id, reservation_id, label,
opened_by_staff_id null⇒guest, merged_into_tab_id, totals, idempotency_key)`, `orders(tab_id,
source, guest_session_id, placed_by_staff_id, status default 'sent', placed_at, device_id,
idempotency_key, check (source='guest_web') = (guest_session_id is not null))`, `order_items
(menu_item_id, variant_id, qty, unit_price_iqd SNAPSHOT, line_total_iqd, notes, voided,
void_reason_code, ready_at)`, `order_item_modifiers(order_item_id, modifier_id PK, qty 1–9,
price_delta_iqd snapshot)`, `tickets` (1:1 with order; status queued…; target_seconds 600;
timestamps; actual_prep_seconds), `tab_adjustments`, `payments`/`refunds` append-only. RPCs:
internal `add_order_items(p_order_id, p_items)` (server-side price snapshot; validates
variant/item/86/category active, modifiers belong to a group linked to THIS item, per-group
min/max distinct count), `compute_tab_totals`, **`create_guest_order(p_items, p_idempotency_key,
p_device_id)`** (degraded guard → touch_guest_session → idempotency short-circuit → CAFE_CLOSED if no
open day → find/insert today's open tab for the table → insert order source guest_web status sent →
add_order_items → insert ticket queued; returns {order_id, tab_id, ticket_id, status}),
`till_add_items`, `set_ticket_status(p_ticket_id, p_status, p_device_id)` (prep/cashier/manager/
owner; queued→preparing, queued|preparing→ready, ready→completed; mirrors to orders.status
preparing/ready/served), `settle_tab`, `apply_discount`, `void_after_send` (PIN+reason), `merge_tabs`,
`split_evenly`, `refund`. Payload shape for p_items: `[{variant_id, qty, notes?, modifiers:[{modifier_id, qty}]}]`.

0016_waiter_calls: `waiter_calls(id, table_id, guest_session_id, reason, status default raised,
raised_at, acknowledged_at/_by, resolved_at/_by)`; partial unique `waiter_calls_one_open
(table_id) where status='raised'` + soft cooldown. RPCs `raise_waiter_call(p_reason)` (degraded
guard, touch_guest_session, CALL_COOLDOWN, ALREADY_NOTIFIED; returns {call_id,status,raised_at}),
`ack_waiter_call(p_call_id)`, `resolve_waiter_call(p_call_id)` (cashier/manager/owner; stamps who/when).

0021_degraded_sync: `is_degraded()`, `venue_mode()` (anon+authenticated), device_heartbeats, sync_replays.
0022_realtime: broadcast-from-database via triggers calling `realtime.send(..., private:=true)` wrapped
in exception guards. Topics: `kds` (ticket_created, ticket_status; prep/cashier/manager/owner),
`session:{guest_session_id}` (order_status; the session's own auth user while live), `floor`
(waiter_call {call_id, table_id, reason, status, raised_at}; staff only — guests poll), `courts`,
`menu` (menu_changed {table,id,op}; anon+authenticated; fires on menu_items + menu_item_variants only).
0024_push_outbox: `notification_outbox(id, profile_id, kind, payload, scheduled_for, sent_at,
attempts, last_error)` — booking kinds only; `app.claim_due_notifications(limit)` service-role;
edge fn `functions/send-push` posts to Expo push, cron every minute. Pattern reusable for Telegram.
Edge fns: `functions/replay`, `functions/send-push`, `functions/_shared/{http,supabase}.ts`.
Config: `supabase/config.toml` exposes schemas public, app; anonymous sign-ins on (300/hr); storage
enabled 50MiB but NO buckets declared, no storage policies anywhere.

RLS for guests: menu tables SELECT active rows; cafe_tables NO guest read (table number comes from
open_table_session); guest_sessions own rows; tabs/orders/order_items/tickets/waiter_calls via
`app.is_own_session` / `order_is_callers` / `tab_is_callers`; payments never. Clients SELECT only.
Every error = `raise exception '<CODE>' using errcode='P0001'` — the code IS the message.

Fixtures `packages/db/fixtures/menu.sql`: 6 categories × 30 bilingual items (uuid prefix f1f7),
variants Regular/Large, 3 modifier groups (Milk Type 0–1, Extra Shot 0–2, Sides 0–3), 41 allergen
links, 9 addon_suggestions, NO photo_path. `tables.sql`: 12 tables T1–T12. `stock.sql`.
Script `packages/db/scripts/qr-artwork.mjs`: A6 SVG cards (105×148 mm, viewBox 420×592) with
Touch Cafe palette, `qrPath()` renders modules into one `<path>`; needs service role (calls
generate_table_token); output `packages/db/artwork/` (not committed).

## 3. OPERATOR (`apps/operator`) — cafe consumers
`src/lib/realtime.ts` `useBroadcast({topic,isPrivate,events,enabled,onEvent,invalidateKeys})` (cache-bust
hint; data reloads from tables). `features/kds/KdsBoard.tsx` (250 L): fetch tickets queued/preparing/
ready (+completed last 2 min), refetch 30 s, `useBroadcast({topic:'kds'})`, age colours
(`ageColor.ts`), item checkboxes LOCAL only, buttons Start/Ready/Complete → `set_ticket_status`.
`features/till/TillScreen.tsx` (1158 L): subscribes `menu` and `floor`; till_add_items, settle_tab,
apply_discount, void_after_send; renders `WaiterCallsPanel.tsx` (raised/acknowledged list, refetch 60 s,
Ack/Resolve buttons, 30 s age ticker). `features/admin/MenuEditor.tsx` (see context-operator.md).

## 4. Telegram / analytics / webhooks: ABSENT everywhere (only Expo push for bookings; Sentry absent).

## 5. `packages/ui` tokens
`palette.ts`: `padelPalette` and `cafePalette` sharing semantic token names (`--tp-bg`, `--tp-fg`,
`--tp-surface`, `--tp-accent`, `--tp-accent-contrast`, `--tp-accent-2`, `--tp-accent-2-contrast`,
`--tp-muted`, `--tp-muted-fg`, `--tp-border`, `--tp-danger`, `--tp-danger-contrast`); cafe: bg
#FFFFFF, fg #2B1A0E, surface #F8F5F1, accent #3360AB, accent-2 #603813, muted #C9BFB4, muted-fg
#6B5D4E, border #E0D8CE. `typography.ts`: `--tp-font-display` Montserrat…, `--tp-font-arabic` IBM
Plex Sans Arabic…, `--tp-font-body` = arabic stack, `--tp-font-mono`; "BRAND FONTS NOT YET IN HAND
— SWAP POINT". `theme.ts`: generates `themeCss` (`:root[data-theme=x], [data-theme=x]`), exports
`THEME_STYLE_ID`. `ThemeProvider.tsx` (client; used by operator, not web). NO components in @touch/ui.

## 6. e2e (`e2e/tests/`)
`cafe-journey.spec.ts`: EN — mint token for T3 (helpers: ensureTillFresh, ensureOpenDay,
clearWaiterCalls, voidOpenTabsForTable, mintTableToken), goto `/en/t/{token}`, Hot Drinks →
Cappuccino → Large + Oat Milk → Add → Basket → Place order → "Received" → prep client sets preparing
→ page flips via broadcast → Ready → Call a waiter → Water → banner → second call cooldown copy →
owner resolves → banner clears within 45 s. AR — RTL attrs, Arabic brand "تتش كافيه", table T4,
Arabic category/item/sheet strings. `public-menu.spec.ts`: 390×844 viewport, landing + /menu in EN
and AR, assertNoHorizontalScroll. `packages/db/tests/cafe-flow.test.ts`: 8 contractual DB tests.

## 7. Conventions (README/CONTRIBUTING)
Migrations only; `pnpm db:types` + commit types.gen.ts (CI fails on drift); money only in
packages/core; operator writes via RPC (IPC queue for till later); CSS logical properties (lint);
test every screen in Arabic; `_en`/`_ar` NOT NULL; secrets never in repo; decision hierarchy
design-data.md > design-arch.md > design-delivery.md; HANDOFF "Resolved design calls" wins.

## Known seams / bugs to fix in this rebuild
1. photo_path never rendered; no storage bucket; `upsert_menu_item` wipes photo on save.
2. `/t/[token]` ships zero server-rendered content (blank until anon sign-in + RPC).
3. Waiter-call resolution is a 20 s poll (floor topic staff-only) — add guest-visible broadcast on
   `session:{id}` (e.g. event `waiter_call_status`) or extend policy.
4. Degraded mode is a 30 s poll of venue_mode().
5. CafeApp is one 582-line component; no error boundary, no loading UI; no motion; hardcoded banner
   hex colours in app-css.ts.
6. `menu` broadcast fires only on menu_items/variants (not categories/modifiers/suggestions/hero).
7. OrdersPanel lists every session order forever above the tabs.
8. Vercel incident lesson: an empty menu must never render silently — show an explicit "menu
   unavailable" state.
