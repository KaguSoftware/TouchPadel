# Touch Padel: the brand as the customer sees it

**Date:** 2026-09-23
**Scope:** the guest side only: the iPhone/Android app, the public website (www.touch-padel.com), the
table QR menu, the store listing and the brand assets. The staff app, stock, recipes and back office
are out of scope except where they leak onto a customer screen.
**Method:** read the brand decks' distilled rules (`docs/brand/touch-padel-style-reference.md`), the
token files, every guest screen and page in `apps/mobile` and `apps/web`, the i18n catalogs, the store
material, and the live site as served today. I did not run the app on a phone. Anything marked
*by eye* is an estimate, not a measurement.

---

## 0 · The short version

**What the business is.** Touch Padel is a single-venue padel club with its own café, Touch Cafe,
in Iraq, on Baghdad time. It has **two courts** and is open **every day 09:00 → 02:00**, so it is a
night-play venue. Courts are booked in the app and **paid at the desk**; nothing is paid online yet.
The café is ordered from a QR code on the table with no app and no account. Phase 2 turns it into
a platform: a second branch, Qi Card deposits, loyalty tiers, coaching, open matches, tournaments
and a pro shop.

**What it wants to look like.** It wants to be a premium sports club with the mood of *night-session
padel under floodlights*: deep blue court, lime-green ball, white lines, black around it. It should
feel athletic, confident, direct and precise. The tagline is **TOUCH IS A LIFESTYLE**.

**How close it gets.**

| Surface | Verdict |
|---|---|
| **Brand system** (palette, type, logo, pattern, rules) | **Excellent.** Tighter than most funded startups: a closed five-colour palette, one typeface for both scripts, exact vector logo, exact pattern geometry, contrast-checked pairings, and written rules for everything. |
| **Mobile app** | **Strong, with a few visible chips.** The 3D animated court, the "serve" boot animation, Liquid Glass on iOS and the held-slot countdown feel expensive. It is let down by no photography, a static success moment, no haptics, text-drawn "!" icons and a couple of Arabic and copy slips. |
| **Website** | **The weakest brand moment.** The domain opens on the **café menu**, titled "Touch Cafe — Menu". There is nothing about padel: no courts, no booking, no app download, no location, no photos. The link preview shared on WhatsApp shows a **retired brown coffee bean**. |
| **Store listing** | **Honest but flat.** "Book a padel court in seconds… That is the whole app." It never mentions the 3D court, the lifestyle or anything premium. |
| **Trust details** | **Needs fixing before launch.** The venue phone shown everywhere is a **Georgian (+995) number** flagged unverified since 30 August. Legal pages still print `[FILL: …]`. "Developed by Kagu" sits on the guest menu. |

**The one-line diagnosis:** *the design system is premium, the product experience is mostly premium,
and the public-facing front door and the content (photos, words, contact details) are not there yet.*

---

## 1 · The business, read from the product

| Fact | Where it shows |
|---|---|
| **Padel club with a café**, one venue | README; the app is padel-only and the website is café-only (a contract rule: "a guest will not install an app to order a coffee") |
| **Iraq, Baghdad time** | `Asia/Baghdad` business day; the menu copy hints at "A true Baghdadi breakfast". The city is **not stated on any customer page**. |
| **Two courts** | Seed data and the support page ("book one of the two padel courts… 60-minute slots"). The app never lets you pick one: "your court is assigned at the desk". |
| **Open 09:00 → 02:00 every day** | "Open now · 09:00–02:00" on the app, the hours table on the site. The app sells a "trading night", so a 01:00 slot belongs to the evening before. |
| **Pay at the desk, no online payment** | Repeated on almost every booking screen, the café basket and the store listing. Qi Card deposits are planned for Phase 2. |
| **Money in whole IQD** | Café prices from 1,000 IQD (Iraqi tea) and 2,000 (espresso) up to about 4,000 (smoothies). Court rates **are not configured yet**, so every real booking is currently refused with "no rate" (Phase 2 change order §7). |
| **Arabic-first market** | The site defaults to `/ar`. Everything ships in Arabic and English, with full right-to-left layout. |
| **Where it's heading** | Phase 2: multi-venue, Qi Card deposits, loyalty tiers, coaching, open matches and tournaments (Americano/Mexicano), Touch Shop. Each one adds new guest screens the brand has to carry. |

**The customer, as the product imagines them:** a player who books ahead and plays in the evening
or late at night, often with the same group, and who wants to know whether something is free before
driving over. They sit in the café before or after the game. They are Arabic-first, on a phone, and
used to WhatsApp rather than email; the sign-in code arrives "on WhatsApp — or by SMS".

---

## 2 · Brand identity

### 2.1 The idea

- **Positioning:** "a modern padel court brand delivering a premium playing experience… precision,
  flow, and the true touch of the game." (2026 deck)
- **Tagline:** TOUCH IS A LIFESTYLE
- **Five voice words**, drawn on the seams of a ball in the deck: **Energetic · Precise · Professional ·
  Dynamic · Creative.**
- **Mood:** night-session padel under floodlights.
- **Explicitly not:** playful or cartoonish, pastel, corporate grey, luxury gold, "tech startup"
  purple gradients, glassmorphism, neon cyberpunk.

### 2.2 The logo

This is a clever lockup and the strongest single brand asset.

- **Wordmark:** "T·uch ·adel" in a heavy geometric sans, Touch Blue.
- **The ball** replaces the "o": green with white seams. It is the brand's atom and works on its own
  down to 14 px.
- **The swoosh** starts as the ball's trajectory, runs under "uch", then **loops up to draw the "P"**.
  It is the only gradient in the whole system (green → blue).
- Six approved colour versions, clear-space and minimum-size rules, and the vector paths are the
  deck's own curves, not a redraw.

**Touch Cafe** is a sub-brand on the same construction: the "o" becomes a **coffee bean** and the swoosh
becomes a **smile** hooking into the "C". The deck draws it in brown. **Brown is officially retired**;
the café now uses the same blue and green as padel. Parts of the web assets have not caught up (§8).

### 2.3 Motifs

| Motif | What it is | Where it appears for customers |
|---|---|---|
| **Court-line pattern** | 11 thick green bands crossing at sharp angles, like court lines seen from above. Recovered exactly from the deck. | Behind the app's Book screen (as a thin ~5 px texture), on the "Next up" booking card, and inside the 3D scene |
| **Title squiggle** | A short green hand-drawn stroke under every app page title | Every app page title; it mirrors in Arabic |
| **The ball** | Green with two white seams | Welcome (huge, ghosted, bleeding off the edge), empty states, the "book your next game" card, the boot animation |
| **The swoosh** | The logo's loop used large as a graphic | In the rules, but barely used on guest surfaces |
| **Bean pattern / smile band** | Café texture, beans at −28° | OG image; the web components (`BeanPattern`, `Swoosh`) are built but **unused** |
| **3D court** | Blue turf, lime glass and cage, white lines, four oversized rackets rallying, ball with a motion trail | The app's home screen. **This is the brand's signature customer moment.** |

---

## 3 · Tone and boldness

### 3.1 Two voices on purpose

The brand deliberately runs **two voices**:

1. **Marketing voice (loud).** Big, uppercase, two-weight headlines: *YOUR GAME / YOUR CHALLENGE*,
   *PLAY · SMASH · WIN*, *WHERE EVERY SWING COUNTS*, *PURE GAME, PERFECT TOUCH*. It lives in the decks,
   posters and social media.
2. **Product voice (plain).** Short, warm, honest, verbs first, every refusal explains itself.
   "Your court is waiting." · "Slot held for you." · "Someone at the desk got there first." ·
   "Ordering here is not payment — please settle your bill at the desk."

The product voice is **very good**. It is calm, kind, never salesy, and it explains every "no".
Arabic is written natively (تتش بادل, ملعبك بانتظارك), not machine-translated.

**The gap:** the loud marketing voice almost never reaches a customer's screen. The app gets one
line of it ("YOUR COURT IS WAITING." on Welcome). The website gets "JUST ONE TOUCH" on the café menu.
The store listing gets none: "Book a padel court in seconds… That is the whole app." The
*lifestyle* half of "Touch is a lifestyle" is currently invisible to customers.

### 3.2 How loud each surface is

| Surface | Intended | Actual | Notes |
|---|---|---|---|
| Posters, social, merch | 🔊🔊🔊 | not in repo | Decks show cut-out athletes, black/blue fields, green bands |
| App splash, boot, welcome, success | 🔊🔊🔊 | 🔊🔊🔊 splash/boot/welcome ✅ · 🔊🔊 success | Success is full navy with a green check, but **static**: no motion, no haptic |
| App booking flow | 🔊🔊 confident | 🔊🔊🔊 on Book, 🔊🔊 after | The 3D court is louder than planned, which is a good thing |
| Website | 🔊🔊 padel | 🔊🔊 **café**, 🔈 padel | The padel brand is effectively absent |
| Café QR menu | 🔊🔊 | 🔊🔊 ✅ | Tinted blue/green bands, outlined category words, line art |
| Store listing | 🔊🔊🔊 (it's an ad) | 🔈 | Utilitarian copy, screenshots are HTML recreations |

**Boldness in one sentence:** bold, blocky, uppercase 900-weight titles on calm, rounded, generous
screens. Loud at the doors (splash, welcome, success, the court) and quiet in the rooms (lists,
forms, settings). That is the right pattern for a premium sports brand.

---

## 4 · Colour and ratios

### 4.1 The palette is closed at five

Owner decision, 2026-09-05. Every other colour must be an exact lightness shade of one of these,
or a functional status red/amber.

| Colour | HEX | Role |
|---|---|---|
| **Touch Blue** | `#3360AB` | The court, the brand ground, primary actions, links, focus |
| **Padel Green** | `#A5D06F` | The ball, the spark, the big "go" button, *live / available / success* |
| **Brand Gray** | `#BCBDBF` | Secondary text on dark, quiet fields |
| **Black** | `#000000` | Photo and poster grounds, ink on green |
| **White** | `#FFFFFF` | Paper, type on blue, court lines |

Retired colours: teal `#1FA79A`, coffee brown `#603813`, the drifted blues and greens `#2456B4`,
`#7FB05A` and `#3057A3`, and the old navy `#0D1830`.

### 4.2 Intended proportions

| Colour | Share | Rule |
|---|---|---|
| Blue | **Dominant** on brand surfaces; **< 10 %** on data screens | Ground + primary action |
| Green | **5–15 %** | "Green is a word, not a decoration": it means go, live, available, success, the ball |
| White | Large | Paper and lines |
| Black | Large in marketing; text only in product | |
| Gray | Small | |

### 4.3 What the screens actually do (by eye)

| Screen | Blue | Green | White / light | Reads as |
|---|---|---|---|---|
| App splash | ~95 % | ball only | logo | Pure brand |
| App Welcome | ~90 % (3-step blue gradient 168°: `#274982 → #3360AB → #2D5495`) | squiggle + green "Create account" ≈ 5 % | logo, type, white button | Loud, correct |
| App Book, light theme | court ≈ 50–60 % of the viewport | pattern texture + lime CTA + squiggle ≈ 8–12 % | `#F3F5F9` ground | Exactly on the intended ratio |
| App Book, blue mode | ≈ 90 % (blue ground + court) | ≈ 10 % | lines, type | "The brand at night"; closest to the floodlit mood |
| App Success | navy ≈ 95 % | check + ref ≈ 5 % | type | Correct |
| Café menu | ≈ 15–20 % (bands, footer arch, header) | active pill, hooks, green bands ≈ 5–8 % | ≈ 70 % | Clean and bright; the green bands are partly decorative, a mild stretch of "green is a word" |

### 4.4 Theme palettes

- **App light:** ground `#F3F5F9`, cards `#FFFFFF`, ink `#1B2C47` (14:1), muted `#5A6D8C`, interactive `#3360AB`.
- **App dark = "blue mode":** not a grey dark mode. Every blue is an exact shade of `#3360AB`:
  page `#172C4F`, ground `#1C355E`, card `#224072`, ink white, muted = brand gray, and the
  accent flips to **white** because blue can't carry blue text.
- **Brand constants in both themes:** CTA `#A5D06F` with **black** ink; success navy `#172C4F`.
- **Website/café:** white page, ink `#162A4B`, blue bands `#EFF3FA`, sky `#7D9FD8`, green tint `#F5FAF0`,
  page ground `#EAEAEB` around a 430 px column. **Light only**, with no dark mode.

### 4.5 Contrast pairings (checked)

| Pair | Ratio | Use |
|---|---|---|
| White on Touch Blue | 6.17:1 | ✅ body + buttons |
| **Black on Padel Green** | 11.85:1 | ✅ **the** CTA pairing |
| Navy ink on green | 8.08:1 | ✅ pills |
| Green on Touch Blue | 3.48:1 | ⚠️ large text, icons, lines only |
| **White on green** | 1.77:1 | ❌ never |

---

## 5 · Typography and proportions

- **One family for both scripts: Lama Sans.** Arabic and Latin are in the same files, so the typeface
  never changes when the language does. That is rare and premium. Weights 400–900 are shipped
  (Poppins, Montserrat and Cairo are retired).
- **Signature title:** weight **900**, UPPERCASE, tight tracking, line-height 1.05, with the green
  squiggle underneath. Arabic keeps the weight but drops caps and tracking and gets a taller line (×1.45).
- **Scale ratios:**
  - **App:** page title 26 / body 14 ≈ **1.9×**; Welcome 34 ≈ **2.4×**; labels 11 / 800 caps / +0.1em;
    buttons 12–14 / 800 caps.
  - **Web café:** hero 44 / row name 21 ≈ **2.1×**; display `clamp(1.75rem, 7vw, 2.5rem)`; eyebrow tracking 0.18em.
- **Numbers are tabular** everywhere (prices, times, countdowns).
- **Shape:** guest surfaces are **soft and rounded** (button 14, card 16, sheet 20, pill 99); staff
  tools are tighter (6–10). Elevation comes from a border first, with shadows tinted blue, never grey.
- **Spacing:** 16 pt gutter on mobile; the café is one 430 px column centred on any screen size.

---

## 6 · Front-end stack (what renders what)

### 6.1 Mobile app: one codebase, deliberately *native-feeling*

The owner's rule (2026-08-24): use platform tabs, the native stack with back gestures, platform
pickers, switches and sheets. **No web-styled custom navigation.**

| Layer | Tech |
|---|---|
| Framework | **Expo SDK 57**, React Native 0.86.3, React 19.2, **expo-router** (file routes) |
| Navigation, **iOS** | **NativeTabs**: a real `UITabBar`, **Liquid Glass on iOS 26**, minimises on scroll, **SF Symbols** (`calendar`, `figure.tennis`, `person.crop.circle`). Native stack headers with Liquid Glass. |
| Navigation, **Android** | Custom expo-router `Tabs`: flat 95 % tint, uppercase labels, custom SVG icons, green active dot. No Jetpack Compose. |
| Native SwiftUI | `@expo/ui/swift-ui`: the iOS country picker is a real SwiftUI sheet and list |
| Native dialogs | **Every confirm and alert is `Alert.alert`** (the system dialog) |
| Glass and blur | `expo-glass-effect` (iOS 26 `GlassView` on the "Pick a time" capsule), `expo-blur` (booking sheet, open-now pill) |
| 3D | **three.js 0.160 on expo-gl** for the live court, with a "lite" mode for weak phones and an SVG fallback |
| Vector art | `react-native-svg` (pattern, icons, squiggle, ball) |
| Gradients | `expo-linear-gradient` (Welcome only) |
| Motion | React Native `Animated` (native driver). **No Reanimated. No expo-haptics, so no haptics at all.** |
| Auth | Phone + password with a WhatsApp/SMS code, email + password, **Sign in with Apple** (native button), **Google** (Nitro module) |
| Data | Supabase, TanStack Query with offline-persisted cache |
| Other | expo-notifications (push), expo-localization, expo-font (Lama Sans), expo-updates (over-the-air updates) |
| Custom-drawn widgets | Segmented control, day chips, time cells, toast, skeletons, 6-box code input, Android country sheet, Google button |

**The effect:** on an iPhone the app feels like an Apple-made app wearing Touch's colours. On
Android it feels more custom. That's fine, but the two platforms now look noticeably different,
and the Android build deserves its own design review.

### 6.2 Website

| Layer | Tech |
|---|---|
| Framework | **Next.js 16.3**, React 19.2, on Vercel |
| UI library | **None.** Hand-written CSS in template strings, tokens only, logical properties (automatic RTL) |
| Images | `next/image`; photos only from the Supabase `menu-media` bucket (currently empty of real photography) |
| Fonts | Self-hosted Lama Sans woff2 (400/700/800 preloaded) |
| Live updates | Supabase Realtime, one private channel per table session (order status, waiter acknowledgement) |
| Haptics | Web Vibration API: works on Android, silently does nothing on iPhone |
| Analytics | PostHog (EU): privacy-light, no autocapture, no session recording |
| PWA | Manifest "Touch Cafe"; no service worker (by design) |
| Theme | Light only |

### 6.3 Shared

`@touch/ui` (tokens), `@touch/i18n` (EN/AR catalogs, formatters, bidi isolation), `@touch/core`
(prices, time zones, phone numbers). The staff app is Vite + React inside Electron; customers never see it.

---

## 7 · UX flows and use cases

### 7.1 Use case A: "I want to play tonight" (app, signed in)

**4 taps to a booking.**

1. Open app → brief **"serve" boot animation**: the ball pops out of "Touch", spins, turns green and
   drops back in with a ripple (~1 s).
2. **Book** tab (the default, middle tab): the live 3D court is rallying and a lime **CHECK AVAILABILITY**
   button sits on the net. *Tap 1.*
3. The camera swings from top-down to a 40° angle, the court lifts, and a frosted sheet rises with 7 day
   chips (today preselected), a duration switch and a two-column time grid showing prices and
   "2 courts free" / "1 court left". *(Optional: change day or duration.)*
4. Tap a time. *Tap 2.* The slot is **held for you** instantly and Review opens: a navy card with a live
   mm:ss countdown and a green bar that turns coral below 25 %.
5. **RESERVE COURT** *(tap 3)* → native confirm *(tap 4)* → **Success**: full navy, green check,
   "COURT RESERVED", REF code, "View booking" / "Done".

**Good:** quick, honest (the timer, "someone at the desk got there first"), no court choice to
agonise over, and a clear explanation that payment happens at the desk.
**Weak:** the payoff moment (Success) has no animation or haptic, after an intro that has both.

### 7.2 Use case B: "Just looking" (app, not signed in)

There is **no forced sign-in and no onboarding carousel**: you land on the court and can browse
availability. Tapping a time saves it and opens **Welcome** ("YOUR COURT IS WAITING."). After sign-up
and verification the app **re-holds that exact slot** and drops you on Review. This is excellent
conversion design.

### 7.3 Use case C: "What have I booked?" / cancel

Bookings tab → a **"Next up" hero card** with the court pattern and a countdown chip ("In 3 h"), then
Upcoming / Played / Cancelled on a timeline rail. Cancelling lives only in booking detail, behind a
native confirm. Outside the free-cancellation window (default 4 h) the button becomes **Call the venue**.

### 7.4 Use case D: "Coffee at the table" (web, via QR)

**4 taps from menu to order sent.**

1. Scan the table QR → the menu is already on screen; a chip goes "Linking table…" → "Table 3".
   The first time, a coach mark points at the waiter bell.
2. Scroll-spy category pills (the active one turns green), tinted section bands with outlined
   words (COFFEE, SMOOTHIE, TEA, FRESH JUICE, FRAPPUCCINO, COCKTAIL, MILKSHAKE, MILK DRINKS,
   DESSERTS, SIGNATURE, MOJITO, HEALTHY, SPECIALTY COFFEE) and line illustrations.
3. Tap an item *(1)* → bottom sheet with size, modifiers, "Goes well with", "Notes for the kitchen"
   and a live price.
4. **Add to order** *(2)* → toast + basket pill updates → open basket *(3)* → **Send to waiter** *(4)* →
   "Sent — a waiter has your order."
5. Live status pill → Received → Preparing → Ready → Delivered, in realtime.
6. **Bell** (2 taps): Take my order / The bill / Water / Something else → "A member of staff is on their way."

**Good:** zero install, zero account, realtime feedback and a calm bell that also asks for the bill.
**Weak:** **no food photography** (every item shows its category icon), **prices without a currency
symbol** in the list rows, and the status strip reads "Preparing" even when the order is Ready.

### 7.5 Use case E: "I heard about Touch Padel, let me look it up" ← **the broken one**

A friend says "Touch Padel". You google it or type touch-padel.com, or tap a shared link on WhatsApp.

- You land on **"Touch Cafe — Menu"**, in Arabic by default.
- There are no courts, no booking, **no App Store / Google Play buttons**, no address or map and no photos.
- The WhatsApp/Instagram preview card is **"Touch Cafe · MENU"** with the **retired brown bean**.
- The site's padel description (`seo.siteDescription`: "Padel courts and a specialty cafe in Iraq.
  Book a court in the app…") **exists in the code but is used nowhere**.

For a venue that wants to be seen as *the* premium padel club, the domain currently tells a stranger
that it is a coffee shop.

### 7.6 Use case F: "Arabic app on an English phone"

The app switches fully to Arabic and flips right-to-left instantly, without a restart. However,
**system alerts follow the phone's language**: confirm dialogs and the iOS country picker appear in
English, left-to-right, in the middle of an Arabic app. This is known and documented in the code.

### 7.7 States and refusals

This is an area where the product is genuinely premium. Every screen has loading (skeletons),
empty ("No bookings yet… Book your next game →"), error (with "Try again"), offline and "venue
offline" states. Refused actions stay visible and explain why, for example: "Venue connection lost.
Booking for today & tomorrow is desk-only for now. Call …".

---

## 8 · Findings: what holds the premium line and what breaks it

### 8.1 Premium today ✅

1. **The 3D court on the home screen:** live rally, brand-coloured cage, camera move into the booking
   sheet. Nothing generic about it.
2. **The boot "serve" animation**, built from the real logo.
3. **Palette discipline:** five colours, exact shades, "blue mode" as the brand at night instead of a grey dark mode.
4. **One typeface for Arabic and English.** Arabic is a first-class language, not a translation layer.
5. **iOS-native feel:** Liquid Glass tabs, SF Symbols, SwiftUI picker, native dialogs and Sign in with Apple.
6. **Honest, warm microcopy**, with every refusal explained.
7. **Smart flows:** browse without an account, the slot remembered through sign-up, a visible hold timer.
8. **Motion discipline:** reduced-motion is respected everywhere, and animation uses transform/opacity only.

### 8.2 Breaks the premium line ❌ (ranked by customer impact)

| # | Finding | Where | Why it matters |
|---|---|---|---|
| 1 | **The domain is a café menu, not a padel club.** Title "Touch Cafe — Menu", manifest "Touch Cafe", no padel content, no app links. | `apps/web/app/[locale]/page.tsx`, `layout.tsx`, `manifest.ts` | The first impression for every new customer, every search and every shared link |
| 2 | **Venue phone is `00995419010203`, a Georgia (+995) number**, flagged `!! UNVERIFIED` in `seed.sql` since 2026-08-30. It came from the form-filler's contact in the client pack. | Live site footer, support page, app "Call the venue", degraded banner | A customer who calls may reach the wrong person or country; it also looks foreign on an Iraqi venue |
| 3 | **No photography anywhere:** no courts, no players, no food. | App (the court-photo keys exist but are unused), café menu (icons "until the photography exists") | Premium venues sell with pictures; the brand guide even specifies the shoot |
| 4 | **Retired brown bean** on the favicon, app icons and OG share image; the OG says "MENU • القائمة" while the page says "المنيو". | `apps/web/public/brand/cafe/*` | It is the image people see on WhatsApp and Instagram |
| 5 | **Legal pages print `[FILL: company legal name]`, `[FILL: registered address]`, `[FILL: privacy contact email]`.** | `/privacy`, `/terms` | Looks unfinished and blocks store approval |
| 6 | **"Developed by Kagu" / "تطوير Kagu"** in the guest menu footer. | Café footer | A vendor credit on a luxury venue's menu reads as a template product. Move it to an About/legal line. |
| 7 | **Success moment is static; no haptics anywhere in the app** (expo-haptics isn't installed). | `app/success.tsx` | The most emotional moment is the flattest one |
| 8 | **Text characters used as icons:** "!" and "0" in circles on Review's terminal states and the error state; "✓", "↻", "→/←" in strings. | `app/review.tsx:245`, `src/components/states.tsx:142` | Reads as placeholder next to the drawn icon set |
| 9 | **Arabic plural slip:** "{count} ملاعب متاحة" becomes "2 ملاعب", but Arabic needs the dual form (ملعبان متاحان). | `packages/i18n/src/catalogs/ar.ts:477` | The venue has exactly 2 courts, so this is the most frequent wrong phrase in the app |
| 10 | **"Send a test notification"** is visible to customers in Settings (owner asked for it on 09-06). | `settings.tsx` | Looks like a developer tool; hide it behind a staff flag once testing is done |
| 11 | **Café prices shown without a currency** in list rows ("3000"). | Menu rows | Ambiguous for tourists and looks like a draft |
| 12 | **System dialogs ignore the app's language** (English alerts in an Arabic app). | `Alert.alert` everywhere | Breaks the "fully Arabic" promise at confirm time, the moment trust matters most |
| 13 | **Store listing and screenshots undersell.** Plain copy, no lifestyle line. Screenshots are HTML recreations with a flat 2D court and dev-fixture prices. | `docs/store/app-store-listing.md`, `apps/mobile/store/` | The 3D court is the best sales asset and appears nowhere |
| 14 | **App icon is the full wordmark lockup on white**, which reads tiny on a home screen. The home-screen label is "TouchPadel" (one word), where the brand writes "Touch Padel". | `assets/icon.png`, `app.config.ts` | The icon is the most-seen brand mark; the ball alone holds up at small sizes |
| 15 | Small web polish: the orders strip always says "Preparing"; a video hero goes blank under reduced motion; undefined tokens leave the legal `h1` unsized; the 764 KB design HTML is publicly downloadable from `/brand/`; `BeanPattern` and `Swoosh` are built but unused. | `apps/web` | Individually minor; together they are the "almost finished" feel |
| 16 | **Court rates aren't configured**, so every real booking is refused with "no rate". | Phase 2 change order §7 | Not a design issue, but the whole premium booking flow ends in a refusal until Touch sends rate rules |

---

## 9 · Recommendations

### Now (before any marketing push)

1. **Give the domain a padel front door.**
   - `/` becomes a Touch Padel landing page: hero (night court photo or the 3D court render),
     *TOUCH IS A LIFESTYLE*, two courts, hours 09:00–02:00, location with a map, App Store / Google
     Play badges, and a "Touch Cafe menu →" link.
   - Keep the QR route `/t` exactly as it is; tables never see the landing page.
   - Move the menu to `/menu`, which currently redirects the other way.
   - Wire `seo.siteDescription`, give it a Touch Padel OG image, and make the page title Touch Padel.
2. **Confirm the real venue phone (+964)** and replace the Georgian number in venue settings.
3. **Regenerate the café favicon, app icons and OG image** in blue and green, with no brown.
4. **Fill the legal placeholders** (`docs/legal/LEGAL-DETAILS-TO-FILL.md`).
5. **Fix the Arabic dual** for court counts (use a proper plural rule: 1 / 2 / 3–10 / 11+).

### Next (premium feel)

6. **Commission one photo shoot** to the brand brief: night, floodlit, cool grade, the green ball the
   brightest thing in frame, athletes mid-swing, the glass cage, plus food and drinks shot on blue.
   Use it for the site hero, the store listing, court photos in the app and menu thumbnails.
7. **Make Success celebrate:** a short ball-bounce or swoosh draw-in plus a success haptic. Add
   `expo-haptics`: a light tap on slot select, success on reserve, a warning on hold expiry.
8. **Replace text glyphs with drawn icons** from the existing 24-grid set.
9. **Currency on prices** ("3,000 IQD" / "٣٬٠٠٠ د.ع" via the shared formatter).
10. **Move "Developed by Kagu"** off the guest menu.
11. **Rewrite the store listing** with one line of the loud voice, lead with the 3D court, and capture real
    screenshots with real prices once rates exist.

### Later (brand growth)

12. **App icon:** test the ball mark (or ball + swoosh "P") against the full lockup.
13. **Theme default:** consider *System* instead of Light, so night players get "blue mode" automatically;
    it is the most on-brand look the app has. This is an owner decision, since Light was chosen deliberately.
14. **In-app dialogs** that follow the app's language, replacing `Alert.alert`, if Arabic-on-English-phone users are common.
15. **Android design pass**, so Android customers get the same premium feel as iOS gets from Liquid Glass.
16. **Phase 2 screens** (loyalty tiers, tournaments, coaching, open matches) are where the loud voice
    finally has a home: tier cards, match posters and results boards can use the two-weight
    headlines, the pattern bands and the black-and-green poster look.

---

## 10 · Where to look

| Topic | File |
|---|---|
| Brand rules (the source of truth) | `docs/brand/touch-padel-style-reference.md` |
| App tokens (light + blue mode) | `apps/mobile/src/theme/tokens.ts` |
| Web/café tokens | `packages/ui/src/tokens/palette.ts`, `cafeBrand.ts`, `typography.ts` |
| 3D court | `apps/mobile/src/components/Court3D.tsx`, `src/features/courtTransition/` |
| Boot animation | `apps/mobile/src/features/boot/BootOverlay.tsx` |
| Booking sheet | `apps/mobile/src/components/BookingSheet.tsx` |
| Café app | `apps/web/src/components/cafe/` |
| Web metadata / manifest | `apps/web/app/[locale]/layout.tsx`, `apps/web/app/manifest.ts` |
| Copy (EN/AR) | `packages/i18n/src/catalogs/en.ts`, `ar.ts` |
| Store material | `docs/store/app-store-listing.md`, `apps/mobile/store/` |
| Venue phone (seed + note) | `packages/db/supabase/seed.sql:49,74` |
