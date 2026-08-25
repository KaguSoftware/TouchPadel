# Touch Cafe rebuild — owner decisions (2026-08-25) + brand facts

## Goal
Rebuild the cafe QR-menu section of TouchPadel to feature-parity with the reference project
UpperDeck (clone at `<scratchpad>/upperdeck`, specs in `upperdeck-backend-spec.md` and
`upperdeck-frontend-spec.md`), but ON TOP OF the existing TouchPadel schema/tests, with Touch Cafe
branding, plus "send basket to waiters via Telegram" ordering (no payment).

## Decisions (all confirmed by owner via AskUserQuestion)
1. **Backend**: PORT UpperDeck's features onto our schema (keep migrations 0001–0026, RPC-only
   writes, RLS, 289 tests, e2e). Do NOT replace with UpperDeck's JSONB-orders schema.
2. **Admin home**: EVERYTHING in the operator desktop app (`apps/operator`, Vite+React+TanStack
   Router, Electron shell). No web `/admin`. This includes: menu/categories/addons editor upgrades,
   hero builder, item+category photos, addon reveals, suggested items, QR print page + per-table
   bell toggle, Telegram settings (+ test message), settings, users/roles (already staff table),
   analytics dashboard.
3. **Send basket** = persist order in DB (tab/order/ticket like today → KDS, till, stock, analytics)
   AND post a Telegram message with inline buttons; button taps write back to order status.
4. **Telegram recipients**: ONE staff group chat (chat_id stored in settings, editable in operator).
5. **Analytics — ALL FOUR** chosen despite SOW exclusion (owner's call; note SOW lines 148–150, 410):
   a. PostHog guest tracking (item_viewed, item_view_abandoned, item_added_to_basket,
      item_removed_from_basket, category_selected, basket_opened, waiter_called, featured_item_clicked,
      suggested_item_clicked, order_submitted, order_failed) — guest app only, never staff.
   b. Engagement dashboard (views, carts, abandoned by dwell bucket, week heatmap, funnel, locale
      split, table activity, peak hours) — PostHog HogQL via an edge-function proxy (personal API key
      never in the renderer), rendered with Recharts in the operator app.
   c. Sales-vs-menu analytics FROM OUR TILL DATA (no Excel/POS import): best sellers, views→sold
      conversion, price bands, menu-engineering matrix (needs `menu_items.cost_iqd`), hidden gems,
      momentum, bought-together (from order_items), sales-vs-engagement daily series.
   d. AI insights + patterns (Groq, edge function; deterministic pattern miner + LLM phrasing;
      owner rejections table) — degrade gracefully to templated sentences without GROQ_API_KEY.
6. **Telegram format**: Arabic-first labels, bilingual item names per line
   ("2× كابتشينو / Cappuccino · كبير · حليب شوفان"), notes quoted, HTML-escaped. Order buttons:
   ✅ شوهد (→ ticket preparing) · 🍽 تم التقديم (→ served) · ❌ إلغاء (→ void, manager-audited).
7. **No-QR browsing**: YES — one unified menu app. `/menu`-style browsing without a table works
   (basket too); "send" and "call waiter" open a "scan the QR on your table" sheet.
8. **Guest UX features ported (ALL)**: hero builder (none / media image-or-video / featured item
   with marquee, badge, % discount applied in basket); item + category photos with blurred
   placeholder + pinch-zoom lightbox; addon "reveals" (option opens nested group), hook/flavour
   lines (hook_en/ar), highlight tint, sold-out stamp; bell tutorial, haptics, ticker strip,
   offline banner, first-scan coach mark. SKIP the coupon/newsletter funnel.
9. **Site root** `/` (touch domain) = the cafe menu app directly; **Arabic default locale**.
   The padel landing page is DROPPED entirely for now (cafe footer has hours + phone only).
10. **Fonts**: Montserrat (Latin) + IBM Plex Sans Arabic, as today, behind the existing tokens.
11. **Accounts**: NONE exist yet (no Telegram bot, no staff group, no PostHog, no Groq). Build with
    placeholders/env vars; everything must no-op gracefully when unset; the plan must include a
    written setup checklist for the owner.
12. **Priority**: cafe slice first, now — roadmap item 4 waits.
13. **Waiter-call Telegram messages**: WITH inline buttons ✅ أنا قادم (acknowledge) · ✔️ تم
    (resolve) writing back to `waiter_calls` (who + when), buttons removed after tap.
14. **Orders board**: NO new screen — enhance existing KDS (new-ticket sound, 90 s stale pulse +
    repeating alarm, "start shift" audio arming, unread count in title) and the till WaiterCallsPanel
    (chime). Guest orders already appear on both.
15. **QR print**: branded A6 table cards (port `packages/db/scripts/qr-artwork.mjs` to an operator
    print route, `window.print` + `@media print`) + per-table waiter-bell toggle.
16. Light theme only (brand deck is light). Keep CSS logical properties rule. Bilingual EN/AR with
    full RTL; every screen verified in Arabic.

## Standing project rules (from HANDOFF.md / CONTRIBUTING.md)
- All schema changes are migration files in `packages/db/supabase/migrations/` (continue at
  `20260825000027_*.sql`; 0023 is an intentional gap). Then `pnpm db:types`, commit `types.gen.ts`.
- Writes to business tables are RPC-only (`SECURITY DEFINER` in schema `app`, `app.is_staff(...)`
  gate, `app.write_audit(...)`), RLS is the backstop. Clients get SELECT only.
- Money is integer IQD (`bigint` domain `iqd`); only `packages/core/src/money` does arithmetic.
- Bilingual content = paired `_en`/`_ar` NOT NULL columns.
- Commits authored by the owner alone, no AI trailers. Hosted Supabase `lczijabnorujcgmbuqlw` is
  the client's production: additive migrations only.
- Fixture data only via `packages/db/fixtures/*.sql` (reserved UUID prefix `f1f7`).
- e2e Playwright at `e2e/`, EN + AR passes.

## Touch Cafe brand (from `brand Ff.pdf`, BOLDSCOPE; rendered pages at `<scratchpad>/brand-cafe/p01–16.png`)
- Colours: Touch Blue `#3360AB` (RGB 51,96,171), Coffee Brown `#603813` (RGB 96,56,19), White.
  Existing `cafePalette` in `packages/ui/src/tokens/palette.ts` already encodes these + warm
  neutrals (`--tp-surface #F8F5F1`, `--tp-border #E0D8CE`, `--tp-fg #2B1A0E`, `--tp-muted-fg #6B5D4E`).
- Wordmark "Touch Cafe": blue geometric sans (Montserrat-like, bold); the "o" in Touch is a brown
  coffee bean; a brown "smile" swoosh underlines from the bean to the "C" of Cafe. Variants: blue on
  white, white on blue, white on brown. Logo assets: only padel PNGs exist in `docs/brand/`; the
  cafe wordmark must be recreated as an inline SVG (bean + smile) or supplied by Touch — plan for
  an SVG component with a "replace with supplied asset" swap point.
- Motifs: big white curved "swoosh" bands over solid blue; thin white concentric arcs on blue
  (welcome slide); coffee-bean repeat pattern (brown beans on white; white outline beans on blue);
  headline typography = ALL-CAPS extra-bold, tight leading, blue on white / white on blue; body copy
  small, centered; posters use blue background with white headline and product/people photos.
- Applications shown: menu board ("MENU / TOUCH CAFE" header on a blue swoosh with QR), cup, bag,
  receipt, business card, polo shirt, digital signage — consistent blue + white with brown accents.
- Tone: modern, friendly, clean; "Touch Cafe is a modern café that offers a relaxing atmosphere and
  a unique coffee experience…" (English boilerplate on every poster).
- `  5cm.pdf` = padel sticker icons (racket, bag, court) — NOT cafe; ignore for the cafe app.
- `touch full brand2.pdf` = padel 2026 identity (green #A5D06F / blue #3360AB, Next Art + Frutiger
  Arabic) — governs mobile/operator, not the cafe app.
