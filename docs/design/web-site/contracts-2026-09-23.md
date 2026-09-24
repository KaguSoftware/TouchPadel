# touch-padel.com — the Touch Padel site: brief + build contracts

**Date:** 2026-09-23 · **Owner call:** Parsa, confirmed in session ("go ahead").
**Governs:** apps/web: the new landing page at `/{locale}`, the café menu's move to
`/{locale}/menu`, the table QR landing on `/menu`, the site shell around the legal pages,
SEO/metadata/icons. **Design rules:** `docs/brand/touch-padel-style-reference.md` (brand),
the impeccable skill's brand register (craft discipline), `docs/brand/customer-brand-report-2026-09-23.md`
(what the customer sees today and what is wrong with it). When this file and a lane's
instinct disagree, this file wins; when this file and the brand reference disagree, the
brand reference wins and this file is wrong — say so.

---

## 0 · REVISION B (2026-09-23, later the same day) — supersedes §1's page structure

**Owner feedback on the first build:** "this entire website is presenting the app, I didn't ask
you for that, I asked you for a customer facing website." The first build made the APP the
subject (hero action "Book in the app", a four-step app walkthrough, store badges as the payoff).
Revision B makes **the club** the subject. Interview answers (owner, 2026-09-23):

| Topic | Answer |
|---|---|
| What the page is for | **Discover the club** (a brand showcase; the action is "come play / come visit") |
| How people book today | **WhatsApp, a phone call, or walking in**. The app is not in the stores yet |
| Sections wanted | Courts & experience · Coaching & lessons · Events & tournaments · Touch Cafe · Location & contact · First visit FAQ. **Not** prices, **not** a gallery |
| Imagery | **Stock photos for now** — licensed padel action in the brand's night-court style, clearly swappable for Touch's own photos later (credits file). The 3D court stays as brand art |
| Coaching | **Offered today**, nothing specific to promise (no levels/format/coach names) |
| Events | **Coming soon** — "join the list on WhatsApp" |
| The app | **A short section**, not the story |
| Location | "darra karbela" → **Durrat Karbala (درّة كربلاء), Karbala** — spelling to be confirmed by the owner |
| Facts | Rackets and balls **can be rented**; there are **lockers**. Unknown and therefore absent: what to wear, minimum age, changing rooms/showers, social handles, court features beyond "indoor", a verified phone |
| Kept from the first build | the routing (menu at `/menu`, QR → `/menu`), legal pages in the site shell, header/footer, night default + light mode, tokens, fonts, icons and share images |

**Page B, top to bottom:**
1. **Header** — lockup · The club · Lessons · Café menu · Visit · EN/عربي · theme · green **Book a court** (WhatsApp).
2. **Hero** — full-bleed night-court action PHOTO (stock) with the two-weight "TOUCH IS / A LIFESTYLE";
   lead "A padel club and café in Durrat Karbala. Two indoor courts, open every day {hours}.";
   **Book on WhatsApp** (green) + **Call the desk**; open-now pill.
3. **The club** (`#club`) — "PURE GAME, / PERFECT TOUCH."; body; four points (indoor · hours · rackets
   & balls to rent · lockers); the **live 3D court** (Lane A's `CourtStage`) as the "two courts"
   visual with **Book a court** riding its net (→ WhatsApp); a photo of a court may join it.
4. **Lessons** (`#lessons`) — photo + "NEW TO PADEL? / START HERE." + **Ask about lessons** (WhatsApp, pre-filled).
5. **Events** — the PLAY / SMASH / WIN poster as a **coming soon** announcement + **Join the list** (WhatsApp, pre-filled).
6. **Touch Cafe** — photo + "BEFORE THE GAME. / AFTER IT." + live categories + **Open the menu**.
7. **The app** — ONE compact band: "Booking in the app. Soon." + one redrawn app screen + coming-soon store buttons.
   (Heading reworded in the 2026-09-24 fix pass: WhatsApp and a call already book from a phone.
   The redrawn screen is an example: weekday names only, no "Today", no real dates, 24-hour times.)
8. **First visit** (`#faq`) — native `<details>` questions: book · pay · racket rental · lockers · beginners · cancel · hours.
9. **Visit** (`#visit`) — "FIND US / IN KARBALA."; address; **Open in Google Maps** (link out, no iframe:
   CSP has no frame-src); live hours; WhatsApp · Call · "or just walk in"; Instagram only if configured.
10. **Footer** — as before plus address + WhatsApp.

**Contact plumbing:** every WhatsApp/Call button is built from the ONE venue phone in
`venue_settings_public` (today the unverified +995 number — fixing it in the operator app fixes every
button). `wa.me/<international digits>?text=<site.whatsapp.* pre-fill>`; `tel:` the same number. No
phone → the buttons fall back to **Plan your visit** (`#visit`). Optional env: `NEXT_PUBLIC_MAPS_URL`
(default: a Google Maps search for درّة كربلاء، كربلاء), `NEXT_PUBLIC_INSTAGRAM_URL` (https + instagram.com
only, else hidden). JSON-LD gains the address (Durrat Karbala, Karbala, IQ); still no telephone.

**Fix pass (2026-09-24), where this file changed:** an address under a locale that matches
no page is caught by `app/[locale]/[...rest]/page.tsx` (it throws `notFound()`), and its own
`not-found.tsx` renders the 404 in the full site shell; `app/[locale]/not-found.tsx` is the
light segment fallback (lost sheet + bare frame, no site sheet, no client components), because
Next serialises it into every route's payload, the menu's included. The café sheet moved out of
the root layout into the café's own pages (`CafeStyles`). The events poster is a black block
of its own with the bands running off all four of its edges, and the announcement sits under it
on the band ground. Window order and the focus ring are restated in §5.

**Photos:** `apps/web/src/assets/photos/{hero,club,lessons,cafe,events}.jpg` (static imports → `next/image`
with intrinsic size + blur placeholder); alt text in `site.photos.*`; credits + licences in
`docs/design/web-site/photo-credits.md`. Stock must be **padel** (glass walls, mesh, solid
perforated rackets) — never tennis — and must never be captioned or described as Touch's venue.
Copy: `site.*` was rewritten for Revision B (both languages); the old app-walkthrough keys are gone.

---

Maps of the codebase this was planned from (read the one for your lane before you start):
`/private/tmp/claude-501/-Users-majedahdab-Desktop-All-repos-TouchPadel/752bca41-d7dc-4a2f-95cc-d2eedae28538/scratchpad/maps/`
`routing.md` · `data.md` · `style.md` · `court3d.md` · `next16.md` · `tests.md`.

---

## 1 · The confirmed brief

**What it is.** Touch Padel's front door: the first thing a stranger sees from a search, a
WhatsApp link or Google's OAuth consent screen (which lists `/en` as the app's home page, so the
landing MUST describe the app and link the privacy policy). It says "premium padel club" in one
screen, pushes the app, and hands café guests to the menu.

**The one action:** understand Touch Padel, then **book in the app**. Second: **open the café menu**.

**Direction.**
- **Night is the default** for every first visit (owner: "night court for sure"): the app's
  blue mode drenched — `#172C4F / #1C355E / #224072 / #3360AB` — black poster bands, Padel Green
  as the spark. Scene: *a player in Iraq at 10pm on their phone, deciding with the group chat
  where to play tonight.*
- **Light mode exists** (owner: "there should also be a light mode"): the app's light palette
  (`#F3F5F9` ground, `#1B2C47` ink) with full-bleed Touch Blue blocks carrying 30–60 % of the
  page. The court stays blue in both. A sun/moon toggle in the header, remembered in the
  `tp-site-mode` cookie, rendered on the server, so no flash.
- **Anchors:** (1) the 2026 deck's posters — PLAY / SMASH / WIN on black, YOUR GAME / YOUR
  CHALLENGE, the PURE GAME / PERFECT TOUCH roll-ups with green court-line bands
  (`docs/brand/full-brand2.pdf` pp. 3, 9, 12, 13, 18); (2) the app's own Book screen (the live
  court, green CTA riding the net, pattern bands); (3) Apple product pages where the 3D object is
  the protagonist and the scroll drives the camera.
- **Inverse test:** a competitor's padel site = stock hero photo + three feature cards + price
  table + gallery + map. We ship none of those.
- **Imagery:** the app's live 3D court (WebGL) + brand art (court-line pattern, swoosh, ball,
  stacked poster type) + the app's own screens redrawn in HTML. **No stock photos, no invented
  photos.** Photo slots can be added later without a redesign.

**Page, top to bottom (one idea per fold, long scroll):**
1. **Header** — vector lockup (swoosh green→white on dark grounds, green→blue on light), links:
   Café menu · EN/عربي · theme toggle · a small **Get the app** button. Transparent over the hero,
   solid `--tp-site-header-bg` after scrolling. Never glass.
2. **Hero** — "TOUCH IS / **A LIFESTYLE**" (heavy line green), start-aligned; lead with live
   hours; green **BOOK IN THE APP** (→ `#app`) + secondary **Café menu** (→ `/menu`);
   "● Open now" pill computed client-side on Baghdad time. The live 3D court at the inline end
   (below on phones), rallying; scrolling past pitches the camera from top-down toward the app's
   40° angle. The green CTA may ride the court's net like the app's "Check availability".
3. **Poster band** — PLAY / SMASH / WIN, stacked, enormous, black ground, green bands, middle
   word green.
4. **#app "Your game in four touches"** — four steps with vignettes rebuilt from the app's real
   UI (day chips; the time grid with "2 courts free"; the held-slot countdown; the pay-at-desk
   confirmation with a REF). A green swoosh path draws itself step to step as you scroll. Ends
   in the **coming-soon store buttons**, the live free-cancellation line, "Arabic and English".
5. **Venue** — "PURE GAME, / **PERFECT TOUCH.**" and confirmed facts only (2 indoor courts; open
   every day with live hours; reserve in app, pay at desk; free cancellation; Arabic and English).
   Not a card grid, not a big-number stat row.
6. **Touch Cafe hand-off** — the café mark (blue + green, no brown), "Before the game. / After
   it.", live café category names, **Open the menu**.
7. **Closing band** — "YOUR GAME, / **YOUR CHALLENGE.**" + both CTAs.
8. **Footer** — lockup + tagline; hours (live); front-desk phone (live, from settings; omitted
   when absent); Menu · Support · Privacy · Terms · Delete account · language; © year Touch
   Padel; a small "Developed by Kagu" (moved here from the menu footer).

**Every state is designed:** no WebGL / weak device / Save-Data → animated flat SVG court;
reduced motion → court at its rest frame, no scroll camera, no reveals; no JS → complete page
with a static court; venue read fails → hours line and open pill disappear (use the `*NoHours`
copy); no phone → omitted; store URLs unset → coming-soon buttons (not links, `aria-disabled`,
no Apple/Google marks); store URLs set → official badges; Arabic → full RTL, natural-case
headlines, `--tp-site-lh-display-ar`, canvas and pattern NOT mirrored, squiggle and directional
icons mirrored.

**Motion:** "a ball in play". Load: headline lines rise and fade in, staggered
(`--tp-site-stagger`); the court canvas fades in over 260 ms on its first frame. Sections reveal
once as they enter. The swoosh path draws with scroll. `--tp-site-ease-out`, no bounce,
transform/opacity/clip-path/stroke-dashoffset only. Everything collapses under
`prefers-reduced-motion`.

**Out (owner answer "leave out for now"):** address, map, social links, prices, court names,
durations, photos. The unverified +995 phone is rendered only through venue settings (fixing
the setting fixes every page) and is never a headline CTA or in JSON-LD.

---

## 2 · Foundation already in the tree (done before the lanes start — do not redo)

| What | Where |
|---|---|
| Site tokens: light = `padelPalette` + `siteLightVars`; night = `siteNightVars` under `[data-theme='padel'][data-mode='night']`; scale/motion/space/z = `siteScaleVars` (`--tp-site-*`) | `packages/ui/src/tokens/site.ts`, `palette.ts`, emitted by `packages/ui/src/theme.ts` into `themeCss` |
| All site copy, EN + AR | `packages/i18n/src/catalogs/site.en.ts` / `site.ar.ts` → `site.*` keys |
| `seo.siteTitle` = Touch Padel, `seo.siteDescription`, `seo.menuDescription` corrected | `en.ts` / `ar.ts` |

Token vocabulary a site stylesheet may use: the shared semantic names (`--tp-bg`, `--tp-fg`,
`--tp-surface`, `--tp-accent(-contrast)`, `--tp-accent-2(-contrast)`, `--tp-muted-fg`,
`--tp-border`, `--tp-danger`, `--tp-brand-*`, the status vars) and every `--tp-site-*` in
`site.ts`. **Never** the cafe scale (`--tp-fs-*`, `--tp-radius-*`, `--tp-space-*`, `--tp-cafe-*`)
or operator-only tokens inside a site subtree. Missing a token? Lane B adds it to `site.ts`
(both modes) — nobody else edits that file.

---

## 3 · Lanes and file ownership (disjoint — touch only your files)

All lanes share one working tree with other sessions. **Never** run `git add / commit / stash /
checkout / reset / clean`. Never delete a file you did not create, except where this table says so.

### Lane A — the 3D court on the web
Owns: `apps/web/src/features/court3d/**` (new), `apps/web/package.json` (add `three` 0.160.0,
dev `@types/three` 0.160.0) and the `pnpm-lock.yaml` change that follows from `pnpm install`.
- Copy the plain three.js modules from `apps/mobile/src/features/courtTransition/` (+
  `apps/mobile/src/theme/brandPattern.ts` only if needed) with the operator-style header
  `// COPIED from apps/mobile/… — keep byte-identical except WEB: lines`, plus their node tests.
- Exports (contract):
  - `CourtStage` — `'use client'`. Props: `{ label: string; className?: string; scrollLinked?:
    boolean; children?: ReactNode }`. Fills its parent box (the parent sets size/aspect). Renders
    the SVG fallback in SSR and until the canvas's first frame, then fades the canvas in (260 ms).
    Transparent canvas (no pattern backdrop — Lane B paints the pattern behind it in CSS/SVG).
    `children` render in an overlay layer centred on the projected **net tape** (updated on resize
    and every animated frame; for the SVG, the net's known position) — this is where Lane B puts
    the hero CTA, like the app. `role="img"` + `aria-label={label}` on the visual layer; the
    overlay children stay interactive and in tab order.
  - `CourtIllustration` — server-safe SVG port of `apps/mobile/src/components/CourtIllustration.tsx`
    with CSS keyframes (ball, shadow, racket sway), colours only via `var(--tp-site-court-*)`.
  - `courtCss` — a string exported from `apps/web/src/features/court3d/court.css.ts` holding every
    rule the court needs (Lane B's `SiteStyles` inlines it). Same CSS rules as §5.
- Behaviour: dynamic `import()` of three after mount (never in the first-load chunk); WebGL
  probe with try/catch; tier: `lite` on `navigator.connection.saveData`, `deviceMemory < 4`,
  `hardwareConcurrency <= 4` or coarse pointer + small screen, else `full`; loop only while
  intersecting (IntersectionObserver) and `document.visibilityState === 'visible'`; DPR capped
  2 (full) / 1.5 (lite); ResizeObserver; `webglcontextlost/restored`; full dispose (strict mode
  mounts twice); fix the per-frame ball spin to be time-based on the web (WEB: line);
  reduced motion → rest frame (`t = 0`, no trail), no scroll link, `renderOnce` on resize;
  `scrollLinked` → progress p from the stage's own rect (0 while its top is in the upper third of
  the viewport, easing to ~0.75 as it scrolls out) through `pitchEase`. No `window` scroll
  listener work outside rAF.
- Verify visually yourself (esbuild harness in the scratchpad + Playwright screenshots) at
  390×844, 768×1024, 1440×900, both grounds (`#172C4F` and `#F3F5F9`).

### Lane B — the site: shell, brand pieces, landing, legal shell, 404/error
Owns (new unless noted):
- `apps/web/src/components/site/**` — `SiteShell`, `SiteStyles`, `SiteHeader`, `SiteFooter`,
  `ThemeToggle` (client), `StoreButtons`, `OpenNowPill` (client), `Reveal`/reveal observer
  (client), `brand/{BrandLockup, BrandBall, CourtPattern, TitleSquiggle, CafeMark, brandPattern.ts}`.
- `apps/web/src/components/landing/**` — the sections.
- `apps/web/src/styles/site/**` — the site stylesheet family + its guard test
  `site-css.test.ts` (a copy of `cafe-css.test.ts`'s rules, also run over `courtCss`).
- `apps/web/src/lib/site/**` — `mode.ts` (`SITE_MODE_COOKIE = 'tp-site-mode'`,
  `type SiteMode = 'night' | 'light'`, `parseSiteMode()` defaulting to `'night'`),
  `mode.server.ts` (`getSiteMode()` via `cookies()`), `stores.ts` (`getStoreLinks()` from
  `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_PLAY_STORE_URL`, validated https URLs on
  `apps.apple.com` / `play.google.com`, else null), JSON-LD builder.
- `apps/web/app/[locale]/page.tsx` + `page.test.tsx` (**replaced**: the landing; the old menu
  test moves to Lane C's `menu/page.test.tsx`).
- `apps/web/app/[locale]/{privacy,terms,support,delete-account}/page.tsx` (wrap in `SiteShell`,
  pass mode) and `apps/web/src/components/legal/LegalDocument.tsx` + `apps/web/src/styles/cafe/legal.css.ts`
  (restyle into the site family: remove it from `cafeCssModules` and delete the module — the one
  permitted cross-edit into `src/styles/cafe/index.ts` is removing `legal`).
- `apps/web/app/[locale]/not-found.tsx`, `error.tsx` + their tests (site-branded, links home + menu).
  Since the 2026-09-24 fix pass also `app/[locale]/[...rest]/{page,not-found}.tsx` (see §0).
- `packages/i18n/src/catalogs/site.en.ts` / `site.ar.ts` (add keys if needed, both files) and
  `packages/ui/src/tokens/site.ts` (add tokens if needed, both modes).
- `e2e/tests/site-landing.spec.ts` (new): EN + AR, night default, toggle persists across reload
  and into a legal page, header/footer links resolve, `#app` anchor, JSON-LD nonce, no
  horizontal scroll at 360 px, court fallback when WebGL is disabled.
Lane B composes Lane A's `CourtStage` (and inlines `courtCss`) and references Lane D's asset
paths (§4). Until Lane A lands, import it anyway — the contract is fixed.

### Lane C — routing, the menu move, metadata, SEO
Owns: `apps/web/proxy.ts` + `proxy.test.ts`, `apps/web/next.config.ts`,
`apps/web/app/[locale]/layout.tsx`, `app/[locale]/menu/page.tsx` + `page.test.tsx` (new; the old
root page test moves here), `app/[locale]/t/page.tsx` + test (becomes a redirect to `/menu`),
`app/[locale]/t/[token]/route.ts`, `app/manifest.ts`, `app/robots.ts`, `app/sitemap.ts` (new),
`src/components/cafe/TopBar/LocaleSwitcher.tsx`, `src/components/cafe/Footer/Footer.tsx` +
`src/styles/cafe/footer.css.ts` (add a quiet legal/home link row using `site.footer.*` keys;
remove "Developed by Kagu" from the menu), `src/components/cafe/CafeApp.tsx` (comments only),
`src/lib/menu.server.ts` (comments only; may add `currency` to the select if useful),
`scripts/security/check-web-security.mjs`, `apps/web/CLAUDE.md` + `docs/design/cafe-rebuild/web-slice.md`
(doc lines about the root), and every existing `e2e/tests/cafe-*.spec.ts` / `web-security-headers.spec.ts`
URL that assumed the menu at `/{locale}` or the session at `/{locale}/t`.
Required behaviour (details in `maps/routing.md` §9):
- `/{locale}/menu` = `CafeApp` with the `tp-table` cookie honoured (walk-in when absent);
  `no-store, no-cache, must-revalidate, private` + `Referrer-Policy: no-referrer` on it (config
  headers AND the proxy override, measured on `next build && next start`); robots noindex? **No**
  — the menu is indexable (it is public content); the token never enters its URL.
- `/t/{token}` and `/{locale}/t/{token}` → 307 `/{locale}/menu` + cookie (proxy and route handler).
- `/{locale}/t` → 307 `/{locale}/menu` in the proxy (CSP on the hop).
- Delete the `/:locale/menu → /:locale` permanent redirect (verified live: `max-age=0,
  must-revalidate`, so browsers did not cache it).
- Layout defaults become Touch Padel: title `{ default: seo.siteTitle, template: '%s · Touch Padel' }`
  (the menu uses `title.absolute` = `site.seo.menuTitle`), description `seo.siteDescription`,
  `applicationName` Touch Padel, site icons + manifest + OG from §4, `alternates` removed from the
  layout (each page sets its own canonical + hreflang). Layout keeps `data-theme="cafe"` on
  `<html>` (the site subtree re-scopes). Do not add another `headers()`/`cookies()` read to the layout.
- The menu page sets its own metadata: cafe icons, cafe OG (§4), canonical `/{locale}/menu`,
  hreflang en/ar/x-default → `/xx/menu`, `themeColor` `#3360AB` via its own `generateViewport`.
- Manifest: name/short_name "Touch Padel", site icons, `theme_color` `#172C4F`,
  `background_color` `#172C4F`, `start_url` `/`, plus a `shortcuts` entry for the café menu.
- `robots.ts`: disallow `/t/`, `/en/t`, `/ar/t` (no trailing slash too); add `sitemap`.
  `sitemap.ts`: `/en`, `/ar`, `/xx/menu`, the four legal pages ×2, with hreflang alternates.
- `LocaleSwitcher` SSR default href → `/${other}/menu` (the token branch too).

### Lane D — brand assets
Owns: `apps/web/public/brand/site/**` (new), `apps/web/public/brand/stores/**` (new),
`apps/web/public/brand/cafe/**` (regenerate: no brown), `packages/ui/src/brand/**` (fix
`cafe-mark.svg` to blue + green), `packages/ui/scripts/**` (a reproducible
`render-site-assets.mjs` next to `render-cafe-icons.mjs`), and moving
`apps/web/public/brand/Touch Cafe Menu Final (standalone).html` to
`docs/brand/cafe/touch-cafe-menu-final-standalone.html` (it must stop being publicly served).
Render with Playwright's cached Chromium from HTML/SVG templates built from the real vectors
(`apps/operator/src/components/brand.tsx` paths, `apps/mobile/src/theme/brandPattern.ts`), the
real font (`packages/ui/fonts/lama`). Official store badges: download the official artwork
(Apple marketing tools SVG, Google Play badge PNG, EN + AR) — if a download is not possible,
say so and leave the live-badge state to render text buttons; never redraw a store badge.

---

## 4 · Asset paths (Lane D produces, Lanes B/C reference — fixed names)

| Asset | Path |
|---|---|
| Site favicon (ball mark on Touch Blue) | `/brand/site/favicon.svg` |
| Site PNG icons | `/brand/site/icon-192.png`, `/brand/site/icon-512.png`, `/brand/site/icon-512-maskable.png`, `/brand/site/apple-icon-180.png` |
| Site share image, per locale (1200×630) | `/brand/site/og-touch-padel-en.png`, `/brand/site/og-touch-padel-ar.png` |
| Café icons (regenerated, same names) | `/brand/cafe/favicon.svg`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-icon-180.png` |
| Café share image (new name, blue + green) | `/brand/cafe/og-touch-cafe-1200x630.png` |
| Café mark for the landing (vector) | Lane B draws `CafeMark` from `packages/ui/src/brand/cafe-mark.svg` geometry |
| Store badges (official) | `/brand/stores/app-store-en.svg`, `/brand/stores/app-store-ar.svg`, `/brand/stores/google-play-en.png`, `/brand/stores/google-play-ar.png` |

---

## 5 · Rules every lane follows

- **Brand:** only the five colours and their exact shades (+ status red/amber, + three.js scene
  hex inside Lane A's copied modules). The swoosh gradient fills the swoosh and nothing else. No
  gradient text, no glass/blur panels, no neon glows, no emoji, no side-stripe borders, no
  identical icon-heading-text card grids, no hero-metric stat rows. Green means go / live / the ball.
- **CSS:** template strings in `*.css.ts`, logical properties only, colours only via
  `var(--tp-*)` (raw values only in a `tokens-bridge` module), `z-index` only via
  `var(--tp-site-z-*)`, animate transform / opacity / clip-path / stroke-dashoffset only,
  a `prefers-reduced-motion` block in every animating module.
- **Type:** Lama Sans via `--tp-font-*` only. Latin display: 900, uppercase via CSS,
  `--tp-site-track-display`, `--tp-site-lh-display`. `[dir='rtl']`: no uppercase, no tracking,
  `--tp-site-lh-display-ar`. Numbers tabular. Body ≥ 17px, measure ≤ `--tp-site-measure`.
- **Copy:** every string from the catalogs; a single time is bidi-isolated (`isolateLtr`), and a
  WINDOW isolates each time on its own with the en dash between them left in the sentence's
  direction (`lib/site/hours.ts` `formatWindow`, 2026-09-24), so Arabic reads the start time
  first, on the right; the site, the legal pages and the café footer all print windows through
  it. Counted nouns go through `lib/site/plural.ts` (Arabic plural forms). Dates/numbers
  through `@touch/i18n` formatters. No em dashes in new copy.
- **A11y:** semantic landmarks, one `h1`, a skip link, visible focus (a 2px `--tp-site-ring`
  3px off the element, the ground showing through the gap; the unused `--tp-site-ring-gap`
  token was removed 2026-09-24), targets ≥ `--tp-site-touch`, contrast ≥ 4.5:1 body / 3:1 large, decorative
  art `aria-hidden`, status never by colour alone.
- **Security:** plain `<a>` for cross-page links (no prefetch of the cookie-reading menu);
  any `<script>` (JSON-LD) carries the request nonce from `x-nonce`; no third-party origins
  (CSP: img/connect/frame are self + Supabase only).
- **Next 16:** read `node_modules/next/dist/docs/` for any API you use (`maps/next16.md` has the
  summary). Pages are dynamic (nonce CSP); do not claim ISR.
- **Shared tree:** one `next dev` runs for everyone on **http://localhost:3101** against the local
  Supabase stack — do not start, stop or `next build` it. `tsc` over the whole app may show other
  lanes' in-progress errors; fix only your own files and say which errors are not yours.
- **Tests you run:** `pnpm --filter @touch/web exec vitest run <your files>`,
  `pnpm --filter @touch/web exec eslint <your paths>`, `pnpm --filter @touch/web typecheck`
  (read only your errors). Integration (full suites, e2e, `next build`, `security:web`) is run
  after all lanes land.
- **Report back:** files created/changed, what you verified and how (with screenshot paths if
  any), anything you could not do, and every place you deviated from this file and why.
