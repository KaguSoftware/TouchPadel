# Touch Cafe guest web app (apps/web) — implementation plan (designed 2026-08-25)

Scope: the guest-facing slice only. Assumes the DB slice (`db-slice.md`) lands first; contract in §6.0
(reconciled against the DB slice: names below follow `db-slice.md` where they differ from the original
draft — `modifier_reveals` table (a modifier may reveal several groups, depth 1), `cafe_settings_public`
is a key/value view, `highlight` is `'none'|'blue'|'brown'`, sold-out arrives as `ITEM_UNAVAILABLE`,
non-revealed modifiers as `MODIFIER_INVALID`, discount helper is `applyPctDiscountIqd` in
`@touch/core`).

## 0. Key decisions

| Topic | Decision | Why |
|---|---|---|
| Routing file | Rename `apps/web/middleware.ts` → `apps/web/proxy.ts` (`export function proxy`) | Next 16 deprecates the `middleware` convention (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`); codemod `npx @next/codemod@canary middleware-to-proxy .` |
| Default locale | `ar`; `Accept-Language` first supported wins; optional `tp-locale` cookie (set by the switcher) beats the header | Owner decision; cookie so a guest who chose English keeps it on a re-scan of the locale-less printed URL |
| Token → cookie exchange in proxy | **Not now.** Keep client-side `signInAnonymously` + `open_table_session` in the background; the menu is server-rendered before that | The HMAC secret lives only in `app.secrets`/Vault; anonymous auth must happen in the browser anyway to get the `sb-*` cookie RLS/realtime rely on. The "blank until RPC" seam is solved by SSR of the menu |
| Server vs client | Menu + settings server-rendered (ISR 60 s + `unstable_cache` tag `menu`); table binding, basket, orders, realtime, analytics client-only | Instant paint + SEO for `/{locale}`; `/t/{token}` is dynamic per param but shares the cached read model |
| Styling | Keep the inline CSS-string approach; split into per-feature `*.css.ts` modules concatenated into `cafeCss`; add a vitest regex guard for physical properties | No build step in `@touch/ui`, inline `<style>` = zero render-blocking CSS request, Tailwind would add a toolchain plus physical utilities the ESLint guard cannot see |
| Images | `next/image` with `remotePatterns` for the Supabase public bucket, `qualities: [40, 75]`, `minimumCacheTTL` 30 d; `unoptimized` fallback for the `http://127.0.0.1:54321` local stack | Vercel optimizer does resize/WebP; `qualities` is mandatory in Next 16 when passing non-default quality |
| PostHog | `posthog-js`, lazy `import()` on idle, no autocapture, no session recording, `persistence: 'localStorage'`, one kill switch | Must no-op without key |
| Service worker | No. Manifest only + `OfflineBanner` | App is useless offline; SW would serve stale prices/menus and stale JS across deploys |
| Featured discount | Applies to the **variant base price only**, half-up to 1 IQD, modifiers not discounted; TS mirrors SQL integer formula via `applyPctDiscountIqd` | Must match `add_order_items` snapshot exactly (parity test) |

## 1. Routing

| URL (browser) | Proxy action | Rendered by | Rendering | Index |
|---|---|---|---|---|
| `/` | 307 redirect → `/{negotiated}` | — | — | canonical is `/ar` |
| `/{locale}` | pass | `app/[locale]/page.tsx` (NEW: the cafe app, no table) | static + ISR `revalidate = 60`; `generateStaticParams` en/ar | yes |
| `/{locale}/menu` | — | `next.config.ts` `redirects()`: `/:locale(en|ar)/menu` → `/:locale` (308) | — | alias only |
| `/t/{token}` (printed) | **rewrite** → `/{negotiated}/t/{token}` (URL stays verbatim) | `app/[locale]/t/[token]/page.tsx` (MODIFY) | dynamic (param) but menu/settings from the shared cache | noindex |
| `/{locale}/t/{token}` | pass | same | same | noindex |
| anything else without locale | 307 redirect to `/{locale}{path}` | — | — | — |
| `/manifest.webmanifest`, `/robots.txt` | excluded by matcher | `app/manifest.ts`, `app/robots.ts` | static | — |

Proxy (`apps/web/proxy.ts`): keep the current matcher; `DEFAULT_LOCALE='ar'`; precedence = path
prefix → `tp-locale` cookie → `Accept-Language` → `ar`. `src/lib/locales.ts`: `DEFAULT_LOCALE='ar'`,
`asLocale(v) => v === 'en' ? 'en' : 'ar'`.

Files — DELETE: `app/[locale]/(public)/layout.tsx`, `(public)/page.tsx`, `(public)/menu/page.tsx`,
`(public)/menu/MenuLive.tsx`. NEW: `app/[locale]/page.tsx`, `app/[locale]/t/[token]/loading.tsx`,
`app/[locale]/error.tsx`, `app/[locale]/not-found.tsx`. MODIFY `app/[locale]/layout.tsx`
(`data-theme="cafe"` on `<html>`, font `<link>`s + preload of Montserrat 700/800, inline
`${themeCss}\n${cafeCss}`, `generateViewport()` → `{ themeColor: cafePalette['--tp-accent'],
viewportFit: 'cover', width: 'device-width', initialScale: 1 }`, metadata "Touch Cafe — Menu", icons
`/brand/cafe/*`, OG image, `alternates.languages` en/ar + `x-default: /ar`). MODIFY `app/manifest.ts`
(name "Touch Cafe", `lang: 'ar'`, `dir: 'auto'`, `start_url: '/'`, standalone, cafe icons 192/512 any
+ 512 maskable, `background_color: --tp-bg`, `theme_color: --tp-accent`). Icons: source
`packages/ui/src/brand/cafe-mark.svg` rendered by a Playwright-based script into
`apps/web/public/brand/cafe/{favicon.svg, icon-192.png, icon-512.png, icon-512-maskable.png,
apple-icon-180.png, og-1200x630.png}`; padel PNGs stay. Swap point: overwrite the SVG when Touch
supplies the official mark.

Page composition: both pages do
```
const [menuResult, settings] = await Promise.all([getCachedMenu(), getCachedCafeSettings()]);
return <CafeApp locale token={token|null} initialMenu={menuResult.categories} menuStatus={menuResult.status /* ok|empty|error */} settings={settings} />;
```
`CafeApp` renders the full menu from props in the SSR HTML, starts `useTableSession` only when `token`
is set, keeps "Send to waiter"/bell disabled/QR-required until `bound`. `menuStatus !== 'ok'` renders
`MenuUnavailable` (never a silent blank) with a client-side retry.

## 2. Components (all under `apps/web/src/components/cafe/`, one folder per component)

```
CafeApp.tsx                         'use client' orchestrator (~250 lines): owns sheet/overlay state only
├─ analytics/AnalyticsProvider.tsx  (src/lib/analytics) mounted here only
├─ OfflineBanner/                   navigator.onLine + online/offline events; role=status
├─ TopBar/TopBar.tsx                blue bar + white swoosh SVG band beneath
│   ├─ brand/Wordmark.tsx           "T" <BeanMark/> "uch" "C" "afe" + smile path; tones onLight|onBlue|onBrown; SWAP POINT
│   ├─ TopBar/TableChip.tsx         none | binding | bound "Table T3" | invalid/expired (tap → re-scan sheet)
│   ├─ TopBar/LocaleSwitcher.tsx    <a> full navigation; rewrites leading /en|/ar or prefixes locale-less /t/…; preserves search; sets tp-locale cookie
│   └─ TopBar/BasketButton.tsx      count chip + total; opens BasketSheet
├─ .tp-app__scroll (ref → useScrollSpy, useHeroCollapse; overflow-anchor:none; overscroll-behavior:contain)
│   ├─ Hero/Hero.tsx                modes none|media|featured; collapse via grid-template-rows 1fr→0fr on [data-collapsed]
│   │   ├─ Hero/HeroBrand.tsx       blue panel, ALL-CAPS 800 headline, white outline-bean pattern 8 %, white swoosh, hours · "{n} items"
│   │   ├─ Hero/HeroMedia.tsx       image (next/image fill) or <video autoplay muted loop playsinline poster> (reduced-motion → poster)
│   │   └─ Hero/HeroFeatured.tsx    item photo card + badge pill + brown marquee + struck price/−N%; tap → open item (source 'featured')
│   ├─ <div data-hero-sentinel/>
│   ├─ CategoryPills/               sticky; thumb rail; [data-compact] collapses thumbs (300 ms); active = blue fill; mask-image fade to inline-end
│   ├─ OrdersStrip/                 only when live orders exist: "Preparing · 2 orders" pill → OrdersSheet
│   ├─ MenuStage/                   sections per category; photo band + ALL-CAPS name + "N items" + chevron; collapsible via grid rows
│   │   └─ MenuCard/                photo 7rem sq, name, hook line (uppercase .18em), description clamp-2, allergen chips, price / struck+discounted;
│   │                               [data-highlight=blue|brown] tint + inset ring; [data-sold-out] stamp; [data-unavailable] greyed; warms sheet image
│   ├─ MenuUnavailable/             explicit empty/error state + retry
│   └─ Footer/                      brown: hours (today bold), phone tel: (dir=ltr), pay-at-desk, "Developed by Kagu"; IntersectionObserver → footerVisible
├─ ScrollTopFab/                    inset-inline-end; visible when scrolled && !footerVisible && no sheet
├─ WaiterButton/WaiterButton.tsx    bell FAB inset-inline-start above the ticker; cooldown badge m:ss; hidden when bellEnabled=false / sheet open / footer; no table → QrRequiredSheet
│   └─ WaiterButton/WaiterSheet.tsx phases idle|sending|done|failed; 4 reasons 2×2; degraded refusal; done auto-closes 2.5 s; buzz()
├─ BellTutorial/                    once per sessionStorage 'tp-bell-tutorial-seen'; only when bound && bellEnabled && no overlay; JS-measured spotlight; SVG arrow draw; 6 s
├─ ItemSheet/ItemSheet.tsx          bottom sheet max-block-size 92dvh; drag-to-close armed on header only (useSheetDrag)
│   ├─ ItemSheet/ImageLayers.tsx    blurred w=16 → Loader → full-res fade-in; expand glyph → Lightbox
│   ├─ ItemSheet/Lightbox.tsx       pinch 1–5×, double-tap 2.5×, pan clamp, drag-to-dismiss >100 px
│   ├─ sticky name header, hook + description, allergen chips
│   ├─ ItemSheet/VariantPicker.tsx
│   ├─ ItemSheet/ModifierGroup.tsx  Required chip; radio/checkbox; nested REVEALED groups indented (border-inline-start 2px brown/40); deselect parent clears children
│   ├─ ItemSheet/SuggestionsRail.tsx "Goes well with" tiles → close + open suggested (source 'suggested')
│   └─ notes (280, counter), qty 1–99, price row (struck base when discounted), CTA; disabled when sold out / group violated; stamp slams in 300 ms
├─ BasketSheet/                     lines (name · variant, "Group: choice" sub-lines, italic note), qty −/+, remove; order note 200; subtotal, "Featured −N%" line, total;
│                                   pay-at-desk notice; degraded warn; CTA "Send to waiter" (bound) / opens QrRequiredSheet (no table); sending overlay; empty state
├─ OrdersPanel/OrdersSheet.tsx      live orders expanded (3-step bar), served >10 min under "Earlier", voided muted "Cancelled — please ask staff"
├─ QrRequiredSheet/                 QrIllustration SVG + copy; reason-aware (order vs waiter)
├─ Toast/                           bottom-centred pill, 1.7 s info / 4 s error, role=status
├─ Ticker/                          bottom marquee strip (h 2rem), phrases from settings (ticker_{locale}) or i18n fallbacks; --tp-dir-sign
└─ brand/{BeanMark, Swoosh, BeanPattern, Loader}   Loader = BeanMark pulse + rotating arc ring (xs|sm|md|lg, onLight|onDark)
```

Existing files: `CafeApp.tsx`, `ItemSheet.tsx`, `BasketSheet.tsx`, `WaiterSheet.tsx`, `OrdersPanel.tsx`
→ REPLACED by the folders above (logic reused); `src/lib/menu.ts`, `src/lib/cafe/basket.ts` (+test),
`src/lib/appRpc.ts`, `src/lib/locales.ts` → MODIFY; `src/lib/supabase/*` KEEP; `src/styles/app-css.ts`
→ REPLACED by `src/styles/cafe/index.ts` (+ modules); `middleware.ts` → `proxy.ts`.

### Hooks (`apps/web/src/hooks/cafe/`)
```ts
useSupabase(): BrowserSupabase | null
useTableSession(token: string | null): { state: 'none'|'binding'|'bound'|'invalid'|'expired'|'error';
  session: { sessionId; tableId; tableNumber; expiresAt; bellEnabled } | null; retry(); markExpired(); touched() }
  // module-scope bootCache kept (StrictMode); only 'bound' stays cached; touched() re-reads expires_at + re-arms
useMenu(initial, settings, supabase): { menu; status; settings; itemsById; featured; refresh() }
  // subscribes 'menu' topic (menu_changed | settings_changed) → debounced 500 ms refresh(); also on 'online' + visibility when stale > 60 s
useBasket(tableId: string | null, featured): { lines; note; count; subtotal; discountTotal; total; add; remove; setQty; setNote; clear;
  idemKey: { current(); reset() }; reconcile(menu) }   // storage key tp-basket-{tableId ?? 'walkin'}; walk-in draft merges on bind
useSessionChannel(sessionId | null, { onOrderStatus; onWaiterCallStatus })   // ONE private channel `session:{id}`, realtime.setAuth() first
useOrders(session, channel): { orders; live; earlier; reload() }
useWaiterCall(session, cooldownSeconds, channel): { phase; call: { callId; status } | null; cooldownLeftMs; raise(reason) }
  // cooldown persisted tp-waiter-{tableId}; ALREADY_NOTIFIED/CALL_COOLDOWN ⇒ info toast; 60 s safety poll while a call is open
useVenueMode(supabase): { degraded }          // 30 s poll of app.venue_mode, paused while hidden
useScrollSpy(scrollRef, ids): { activeId; jumpTo(id) }   // 800 ms auto-scroll guard, centres the pill
useHeroCollapse(scrollRef, sentinelRef): boolean
useSheetDrag(headerRef, onClose, { threshold: 80, intent: 8 }): { style }   // pointer events, touch-action:none on header only
useOnline(): boolean
useItemDwell(item, onAbandon)                  // analytics dwell
```
Overlay state (`sheetItem`, `basketOpen`, `waiterOpen`, `ordersOpen`, `qrRequired: {reason}|null`,
`lightbox`) lives in `CafeApp`; presentational components take data + callbacks only.

## 3. Styling & brand

`apps/web/src/styles/cafe/{base,tokens-bridge,layout,topbar,hero,pills,stage,card,sheet,basket,waiter,
orders,tutorial,ticker,footer,motion}.css.ts`, `index.ts` exports `cafeCss`. Rules: logical properties
only; colours only via `var(--tp-*)`; one breakpoint `@media (min-width: 640px)` (centred 44rem column,
bean pattern gutters); z-index only via `--tp-z-*`. Guard `src/styles/cafe/cafe-css.test.ts` fails on
`margin-left|margin-right|padding-left|padding-right|border-(top|bottom)-(left|right)|[^-]left:|[^-]right:|text-align:\s*(left|right)`
and raw hex outside `tokens-bridge`. Marquee: `translate: calc(var(--tp-dir-sign) * -33.333%) 0`,
`--tp-dir-sign: 1`, `[dir='rtl'] { --tp-dir-sign: -1 }`.

Visual language (brand pages p04–p09, p11, p14, p15): page `--tp-bg` white; cards `--tp-surface`;
TopBar/Hero-none solid Touch Blue with a white swoosh band (SVG, `preserveAspectRatio="none"`);
prices, bean, smile, ticker strip, footer = Coffee Brown; CTAs, active pill, links = Blue; highlight
tints blue/brown at 10 % + 3 px inset ring. Type: headlines Montserrat 800 ALL-CAPS `line-height .95`
tracking `.02em`; eyebrow/hook 11 px uppercase `.18em`; body IBM Plex Sans Arabic-first stack; AR
headlines Plex Arabic 700. Motion (`motion.css.ts`): `tp-slide-up 250ms`, `tp-fade-in`, `tp-stamp-slam
400ms`, `tp-tick var(--tp-ticker-dur) linear infinite`, `tp-bean-pulse 1.6s`, `tp-spin-ring 1.2s`,
`tp-arrow-draw 900ms`, `tp-float 1.8s`; hero/section collapse via `grid-template-rows`;
`prefers-reduced-motion` → durations `1ms`, marquee static, video → poster. a11y/UX: `:focus-visible`
3 px accent outline; `input, textarea, select { font-size: max(16px, 1rem) }`; safe areas
(`padding-block-end: calc(var(--tp-ticker-h) + env(safe-area-inset-bottom))`); `inert` on the shell
while a sheet is open; sheet header `touch-action: none`.

Tokens to add (`packages/ui/src/tokens/cafeBrand.ts`, merged into the cafe block of `theme.ts`; shared
semantic ones also added to `padelPalette`): `--tp-warn-bg #FBEFC9`, `--tp-warn-fg #6B4E00`,
`--tp-warn-border #E8CF7A`, `--tp-error-bg #FBE1DF`, `--tp-error-border #EAB5B0`, `--tp-success
#2E7D32`, `--tp-success-bg #E4F2E5`, `--tp-backdrop rgba(43,26,14,.55)`; `--tp-cafe-blue-deep #274B85`,
`--tp-cafe-blue-tint #E8EEF8`, `--tp-cafe-brown-tint #F1E7DD`, `--tp-cafe-cream #F8F5F1`,
`--tp-cafe-swoosh` (data-URI), `--tp-cafe-beans-brown`, `--tp-cafe-beans-white` (40×48 tile),
`--tp-dir-sign 1`; radii `--tp-radius-xs .4rem`, `-sm .6rem`, `-md 1rem`, `-lg 1.25rem`, `-sheet
1.5rem`, `-pill 999px`; shadows `--tp-shadow-card`, `--tp-shadow-sheet`, `--tp-shadow-fab`; type scale
`--tp-fs-xs .72rem` … `--tp-fs-xl 1.5rem`, `--tp-fs-display clamp(1.75rem, 7vw, 2.5rem)`,
`--tp-lh-tight .95`, `--tp-tracking-caps .02em`, `--tp-tracking-eyebrow .18em`, `--tp-fw-display 800`;
layout/motion `--tp-topbar-h 3.5rem`, `--tp-ticker-h 2rem`, `--tp-space-1…6`, `--tp-ease-out
cubic-bezier(.2,.8,.2,1)`, `--tp-dur-fast 150ms`, `--tp-dur-base 250ms`, `--tp-dur-slow 400ms`,
`--tp-ticker-dur 22s`, `--tp-z-sticky 10 / -topbar 20 / -fab 30 / -sheet 40 / -tutorial 50 / -lightbox
60 / -toast 70 / -offline 80`.

## 4. i18n

`packages/i18n/src/catalogs/{en,ar}.ts`. Drop the `landing` namespace (`landing.days.*` →
`cafe.days.*`); `seo.siteTitle` → "Touch Cafe — Menu" / "تتش كافيه — القائمة". New `cafe.*` keys
(EN / AR): `hero.line1` "COFFEE CRAFTED" / "قهوة مصنوعة"; `hero.line2` "WITH PASSION" / "بشغف";
`hero.itemsCount` "{count} items" / "{count} صنفًا"; `hero.openToday` "Open today {from}–{to}" / "مفتوح
اليوم {from}–{to}"; `hero.closedToday`; `hero.featured` "Featured" / "مميز"; `hero.discountBadge`;
`ticker.fallback1..3` ("Specialty coffee" / "قهوة مختصة", "Fresh pastries" / "معجنات طازجة", "Order from
your table" / "اطلب من طاولتك"); `soldOut` "Sold out" / "نفد"; `soldOutCta` "Sold out today" / "نفد
اليوم"; `unavailableShort`; `revealsHint` "More choices" / "خيارات إضافية"; `chooseOne`;
`sendToWaiter` "Send to waiter" / "أرسل إلى النادل"; `sendingToWaiter`; `sentToWaiter` "Sent — a waiter
has your order." / "تم الإرسال — النادل استلم طلبك."; `orderNote` "Note for the waiter" / "ملاحظة
للنادل"; `orderNotePlaceholder`; `featuredDiscount` "Featured offer −{pct}%" / "عرض مميز −{pct}%";
`browseMenu`; `basketEmptyTitle`; `qrRequired.title` "Scan the QR on your table" / "امسح رمز QR على
طاولتك"; `qrRequired.bodyOrder`; `qrRequired.bodyWaiter`; `qrRequired.keepBasket`;
`bellTutorial.eyebrow` "Need something?" / "تحتاج شيئًا؟"; `bellTutorial.title` "Tap the bell to call a
waiter" / "اضغط الجرس لاستدعاء النادل"; `bellTutorial.dismiss`; `bellDisabled` "Please see a member of
staff at the counter." / "يرجى مراجعة الموظفين عند الكاونتر."; `waiterSending`; `waiterOnTheWay` "On
the way" / "في الطريق"; `waiterDone` "Done" / "تم"; `waiterFailed`; `waiterCooldown` "Available again in
{time}" / "متاح مجددًا بعد {time}"; `offline`; `orders.liveOne`, `orders.liveMany`, `orders.earlier`,
`orders.cancelledHint`, `orders.emptyTitle`; `menuUnavailable.title/body`; `tableChipBinding`;
`footer.hours/phone/developedBy/closed`; `days.*`; `lightbox.close`; `expandPhoto`; `scrollTop`;
`notesCounter`; `priceChanged`; `removedUnavailable`; `localeSwitch`. Bidi: `isolate()` for Latin
tokens inside Arabic sentences; mixed fragments as `<bdi>`; `formatIQD` Latin digits; phone `dir=ltr`;
wordmark `lang="en"`; locale link carries target `lang`/`dir`.

## 5. Analytics client (`apps/web/src/lib/analytics/`)

`posthog.ts`: `initAnalytics(locale)` returns immediately when `!NEXT_PUBLIC_POSTHOG_KEY` or
`localStorage['tp-analytics'] === 'off'` (`?analytics=off` writes it); lazy `await
import('posthog-js')` on `requestIdleCallback` (2 s fallback); options `api_host:
NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'`, `autocapture: false`,
`disable_session_recording: true`, `capture_pageview: true`, `capture_pageleave: true`,
`person_profiles: 'identified_only'` (never identify), `persistence: 'localStorage'`; `register({
locale, has_table, table_number? })` re-registered on bind. `AnalyticsProvider.tsx` mounted only
inside `CafeApp`. `track.ts` `capture()` swallows errors, no-ops until loaded.

| Event | Properties | Fired from |
|---|---|---|
| `item_viewed` | `item_id, item_name, category_id, price_iqd, discount_pct, source: 'list'|'featured'|'suggested', has_photo` | opening ItemSheet |
| `item_view_abandoned` | `item_id, item_name, dwell_ms` | close without add and dwell ≥ 5000 ms; also `visibilitychange→hidden` with sendBeacon |
| `item_added_to_basket` | `item_id, item_name, variant_id, price_iqd, qty, modifiers_count, has_note, discount_pct` | ItemSheet CTA |
| `item_removed_from_basket` | `item_id, item_name, qty` | BasketSheet |
| `category_selected` | `category_id, category_name_en` | CategoryPills tap |
| `basket_opened` | `item_count, total_iqd, has_table` | BasketButton |
| `featured_item_clicked` | `item_id` | HeroFeatured |
| `suggested_item_clicked` | `item_id, from_item_id` | SuggestionsRail |
| `waiter_called` | `kind: 'order'|'bill'|'water'|'assistance', source: 'fab'` | WaiterSheet after RPC success |
| `order_submitted` | `order_id, total_iqd, subtotal_iqd, discount_total_iqd, item_count, line_count, has_note` | after `create_guest_order` success |
| `order_failed` | `error_type` | RPC error |
| `qr_required_shown` | `action: 'order'|'waiter'` | QrRequiredSheet |

## 6. Data flow

### 6.0 DB contract (from `db-slice.md`)
`menu_items.hook_en/hook_ar`, `highlight ('none'|'blue'|'brown')`, `sold_out`, `photo_path`,
`photo_blur`; `menu_categories.photo_path/photo_blur`; `modifier_reveals(modifier_id, group_id,
sort_order)`; public bucket `menu-media`; view `cafe_settings_public(key, value)` with keys
`hero_mode, hero_media_path, hero_media_kind, featured_item_id, featured_label_en/_ar,
featured_badge_en/_ar, featured_discount_pct, ticker_en, ticker_ar, bell_tutorial_enabled`;
hours/phone/cooldown from `venue_settings_public`; `open_table_session` returns `bell_enabled`;
broadcast `menu` fires `menu_changed`/`settings_changed` for every menu table + public settings;
`session:{id}` gets `waiter_call_status {call_id, status, …}`; `add_order_items` applies the featured
discount as `(list*(100-pct)+50)/100` and rejects modifiers from non-revealed groups with
`MODIFIER_INVALID`; new codes `BELL_DISABLED`; sold-out → `ITEM_UNAVAILABLE`.

### 6.1 `src/lib/menu.ts` (MODIFY) + `src/lib/menu.server.ts` (NEW) + `src/lib/media.ts` (NEW)
Types: `MenuModifier.reveals: MenuModifierGroup[]` (resolved from `modifier_reveals`, depth 1);
`MenuItem` gains `hook_en/ar`, `highlight`, `sold_out`, `photo_url`, `photo_blur`, `discountPct`
(decorated from settings); `MenuCategory.photo_url`. Pure helpers for tests: `resolveReveals`,
`decorateFeatured(menu, settings)`, `activeGroups(item, chosen)`. `publicMediaUrl(path)` =
`${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/menu-media/${encoded}`. `fetchCafeSettings`
folds `cafe_settings_public` rows into a typed object with defaults (`hero_mode: 'none'`).
`menu.server.ts`: `getCachedMenu = unstable_cache(() => fetchMenu(createStaticSupabase()).then(ok).catch(err), ['cafe-menu'], { tags: ['menu'], revalidate: 60 })`
(+ settings). Client refresh on broadcast calls `fetchMenu` directly (bypasses the server cache).
`next.config.ts`: `images.remotePatterns` for `https://lczijabnorujcgmbuqlw.supabase.co/storage/v1/object/public/menu-media/**`,
`https://*.supabase.co/...`, `http://127.0.0.1:54321/...`; `images.qualities: [40, 75]`,
`imageSizes: [16, 64, 96, 128, 256, 384]`, `minimumCacheTTL: 2592000`; `redirects()` for `/menu`.

### 6.2 `src/lib/cafe/basket.ts` (MODIFY)
`BasketLine.discount_pct`, `BasketLine.list_unit_price_iqd`; `lineTotal = mulIqd(addIqd(
applyPctDiscountIqd(unit, pct), Σ mods), qty)`; `basketSubtotal`, `basketDiscountTotal`;
`activeGroups(item, chosen)` = linked groups ∪ groups revealed by chosen modifiers;
`violatedGroup(activeGroups(...), chosen)`; `buildLine` validates every chosen modifier against the
active set; `subtreeModifierIds(item, modifierId)`; `toOrderPayload` unchanged; draft v2 key
`tp-basket-{tableId ?? 'walkin'}` `{ v: 2, lines, note, idemKey }`, `loadDraft` migrates v1,
`mergeDrafts(walkin, table)` on bind; `reconcile(menu)` drops lines whose item is not orderable /
variant vanished (toast `removedUnavailable`), re-snapshots prices/discount (toast `priceChanged`).

### 6.3 Realtime + refresh
`useMenu` subscribes once to `menu` (`setAuth()` first), debounces 500 ms, refetches menu + settings,
then `useBasket.reconcile`. `useSessionChannel` owns the single `session:{id}` channel and dispatches
`order_status` → `useOrders`, `waiter_call_status` → `useWaiterCall` (replaces the 20 s poll; 60 s
safety poll while a call is open).

### 6.4 Submit
`create_guest_order({ p_items, p_idempotency_key })` with `idemKey.current()` persisted in the draft;
success → `idemKey.reset()`, clear, toast `sentToWaiter`, `order_submitted`, `session.touched()`,
`orders.reload()`. Error mapping (`appRpc.ts`): add `BELL_DISABLED → cafe.bellDisabled`; on
`ITEM_UNAVAILABLE|VARIANT_NOT_FOUND|MODIFIER_*` also `useMenu.refresh()` + `reconcile`;
`SESSION_EXPIRED → markExpired()`; `DEGRADED_LOCKOUT → degraded=true`.

## 7. PWA / offline
Manifest only; no service worker. `OfflineBanner` from `useOnline()`; while offline CTAs disabled with
the offline copy, waiter FAB dimmed, `useMenu` refetches on `online`.

## 8. Tests
Unit (vitest, node env): `basket.test.ts` (discount parity table `1250×15% → 1063`, `999×10% → 899`,
0 % identity, modifiers undiscounted, `activeGroups`/`violatedGroup` with reveals, `buildLine` rejects
non-revealed, `subtreeModifierIds`, draft migration, `mergeDrafts`, `reconcile`); `menu.test.ts`
(`resolveReveals`, `decorateFeatured`, `publicMediaUrl` encoding of Arabic filenames);
`analytics/track.test.ts` (no-op without key; dwell threshold; kill switch); `hooks/cafe/*.test.ts`
(pure reducers: waiter phases + cooldown `m:ss`, `ordersPartition`, `scrollSpyPick`,
`hrefForLocale`); `styles/cafe/cafe-css.test.ts` guard.
Playwright: `cafe-root.spec.ts` (empty `accept-language` → `/ar`, `html[lang=ar][dir=rtl]`, SSR body
contains "كابتشينو", `en-US` → `/en`, `/en/menu` → 308, add Cappuccino → Send → QrRequiredSheet, bell →
QrRequiredSheet, no horizontal scroll) replacing `public-menu.spec.ts`; `cafe-journey.spec.ts`
rewrite (verbatim `/t/{token}` URL, menu heading before the table chip binds, Cappuccino + Large + Oat
Milk + revealed group pick, featured discount line, Send → Received → Preparing/Ready live → bell →
Water → "On the way" ≤ 5 s after `ack_waiter_call` → resolve → "Done" → cooldown → second call copy;
AR twin); `cafe-menu-live.spec.ts` (sold-out stamp via broadcast); `cafe-rtl-layout.spec.ts` @ar
(hero modes, pills, sheet, footer — no horizontal scroll). `e2e/tests/helpers.ts`: `setCafeSetting`,
`setItemSoldOut`. Playwright note: use `extraHTTPHeaders: { 'accept-language': '' }` for the
default-locale test. Lighthouse on the Vercel preview: LCP < 2.5 s on Slow 4G.

## 9. Delivery waves
| Wave | Files | Verify |
|---|---|---|
| Foundation | tokens `cafeBrand.ts`, `palette.ts`, `theme.ts`, `index.ts`, `brand/cafe-mark.svg`, icon script; `proxy.ts` (−`middleware.ts`), `locales.ts`, `next.config.ts`, layout/page/`t/[token]`/loading/error/not-found, manifest, `public/brand/cafe/*`, `styles/cafe/*`, `components/cafe/brand/*`, delete `(public)/*`; temporary `CafeApp` shim rendering the SSR menu | typecheck; vitest css guard; e2e cafe-root SSR/locale/redirect |
| Data + libs | `menu.ts`, `menu.server.ts`, `media.ts`, `cafe/basket.ts` (+test), `appRpc.ts`, catalogs EN+AR | typecheck; vitest; i18n parity |
| Hooks + core UI | `hooks/cafe/*` (+tests), `CafeApp`, TopBar, Hero, CategoryPills, MenuStage, MenuCard, ItemSheet, BasketSheet, QrRequiredSheet, Toast, OfflineBanner, Ticker, Footer, ScrollTopFab, MenuUnavailable | typecheck; vitest; e2e cafe-root + cafe-journey (order half) + cafe-rtl-layout |
| Waiter + orders + tutorial | WaiterButton/WaiterSheet, BellTutorial, OrdersStrip, OrdersSheet, `useSessionChannel`, `useWaiterCall`, `useOrders` | e2e cafe-journey full, cafe-menu-live |
| Analytics + polish | `src/lib/analytics/*`, `posthog-js` dep, haptics, manifest/icons final, owner checklist | vitest; e2e asserts no `*.posthog.com` requests without key |
| QA | RTL pass on real phones, Lighthouse, axe (optional), HANDOFF | full gate |

Vercel env: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_POSTHOG_KEY` (blank for now),
`NEXT_PUBLIC_POSTHOG_HOST` (`https://eu.i.posthog.com`).

## Risks
Next 16: `middleware`→`proxy`; `params`/`searchParams` are Promises; `themeColor`/`viewport` only via
`generateViewport`; `images.qualities` required; `router.refresh()` would return the cached entry →
client refetch on broadcast; `[locale]/page.tsx` must not read cookies/headers (keeps ISR);
`[token]` route dynamic → `loading.tsx`; StrictMode double-runs effects → idempotent subscriptions +
`bootCache`. RTL: swoosh as a background of a logical box (mirror with `scale(-1,1)` under `[dir=rtl]`
only if needed); marquee via `--tp-dir-sign`; tutorial spotlight from JS-measured FAB rect; `mask-image`
fades `to inline-end`. iOS: drag armed on header only; `92dvh` with `85vh` fallback. Storage URLs cached
30 d → always versioned paths. PostHog idle-loaded; drop events before init. Featured discount drift →
`reconcile` + server wins. Fonts: Plex Arabic has no 800 → AR headlines 700. Empty/failed menu must
never render blank.
