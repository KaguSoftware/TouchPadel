# Touch Padel — Mobile App Audit & Remediation Plan

## Context

`apps/mobile` is the guest padel-booking app (Expo + expo-router) and one of the three
contracted Phase-1 deliverables. **It has had zero commits since 2026-08-24** while the
database advanced from migration 0026 → 0047 and every other surface (web cafe, operator,
edge functions, integrations) was built out. It is now the least-finished part of the system
and the only one with a hard external deadline: **store submission Wed 2026-09-16**
(hard stop Fri 2026-09-18), i.e. **20 days from today, 2026-08-27**.

The audit found the app's **data layer and pure logic are genuinely good** — `assemble.ts`,
`logic.ts`, `errors.ts` and the RPC bindings are well-typed, correctly modelled against the
migrations, and unit-tested. The **presentation layer is a wireframe** (the code says so
itself: `src/components/ui.tsx:2` — *"visual polish is FE1's later"*), and **everything the
SOW attaches around booking is missing or broken**: push never reaches a device, court photos
have neither a renderer nor a storage bucket, there is no profile screen, no account deletion,
no Sentry, no app icon, and no EAS project.

There is also **one confirmed runtime crash on the money path** (§1.1) that ships today.

Target: Expo **SDK 54** — the correct choice, because Expo Go on the Apple App Store stops at
SDK 54, so it is the highest SDK that keeps the Expo Go dev loop alive on a physical iPhone.

**Owner decisions taken (2026-08-27):** everything, deadline-ordered · Apple account exists,
Play account new-or-missing · UI rebuild = native-correct, lightly styled · bundle ID stays
`com.kagu.touchpadel`.

---

## 1. What is actually broken today

### 1.1 CONFIRMED CRASH — every booking attempt throws

`src/features/booking/hooks.ts:23` → `src/lib/idempotency.ts:9` → `@touch/core`
`makeIdempotencyKey` → `ulid@2.4.0`.

Under Hermes there is no `window.crypto`, and Expo's winter runtime does **not** polyfill
`getRandomValues` (verified: `node_modules/expo/src/winter/` has no crypto module). `ulid`'s
`package.json` `browser` field redirects `crypto` → `./stubs/crypto.js`, and I verified that
file is **literally 0 bytes**. So `detectPrng()` succeeds at module-init and returns a closure
that calls `nodeCrypto.randomBytes` on `{}` → **`TypeError` on every slot hold**.

The unit tests pass precisely because `vitest.config.ts` sets `environment: 'node'`, where
`require('crypto')` is real. *The tests are green because they do not run on the target runtime.*

Fix: `react-native-get-random-values@~1.11.0` imported before anything touching `@touch/core`
(note `packages/core/src/index.ts` does `export * from './schemas/mutations'`, so **every**
`@touch/core` import drags `ulid` in).

### 1.2 Two of five auth flows cannot complete on a device

- **Password reset**: `RESET_REDIRECT = 'touchpadel://reset-password'`
  (`src/features/auth/api.ts:12`), but `packages/db/supabase/config.toml:53-54` allow-lists only
  `localhost:3000`. Worse, `supabase.ts:29` sets `detectSessionInUrl: false` and there is **zero**
  `Linking`/`getInitialURL`/`setSession`/`exchangeCodeForSession` code anywhere — `expo-linking`
  is a dependency imported nowhere. The recovery token is never turned into a session.
- **Email verification**: `signUp` passes no `emailRedirectTo` while `enable_confirmations = true`,
  so the link goes to `localhost:3000`. `verify-email.tsx` has no polling or auth listener, so
  even out-of-band verification leaves the user stranded.

Both need the **hosted** project's Auth redirect allow-list updated, not just `config.toml`.

### 1.3 Correctness defects in shipped code

| # | Defect | Location |
|---|---|---|
| a | Reads `venue_phone`; the column is **`phone`** (0026:824-838) → the contractual degraded-mode phone number (SOW L676-678) never renders. Hidden by an `as` cast that discarded the generated type. | `app/(app)/confirm.tsx:55` |
| b | `CLOSED_DATE` / `OUTSIDE_HOURS` (raised by `app.assert_bookable`, wired into `hold_slot` by 0042:139) are absent from `CODE_TO_KEY` → both render "Something went wrong". Touches SOW L319. | `src/features/booking/errors.ts` |
| c | Only `isLoading` is checked, never `isError` → **a network failure renders as a legitimate empty state** ("No courts are available right now"). Two of three main screens silently lie. | `app/(app)/index.tsx:22`, `bookings.tsx:65` |
| d | Retry calls `day.refetch`, which refetches 1 of the 5 queries that can set `isError` → if courts/rates/settings fail, Retry does nothing, forever. | `app/(app)/availability.tsx:144` |
| e | **Idempotency is decorative** — a fresh ULID is minted inside the mutationFn per attempt, so `hold_slot`'s dedupe (0008:191-197) can never fire. A timeout that committed server-side then retried creates a *second* hold. | `src/lib/idempotency.ts` |
| f | Abandoning confirm **leaks the slot hold** for the full `hold_ttl_seconds` (300 s) — Cancel just calls `router.back()`, and there is no `release_hold` RPC in the schema at all. | `app/(app)/confirm.tsx:109` |
| g | No `queryClient.clear()` on sign-out → account B sees account A's cached `my-bookings`. | `src/lib/queryClient.ts` |
| h | Whole Supabase session stored in `expo-secure-store`, which has a **~2048-byte per-value limit**, with no chunking adapter or size guard → the classic silent "randomly logged out". | `src/lib/supabase.ts:18-22` |
| i | No `AppState` wiring for `startAutoRefresh`/`stopAutoRefresh`; no `onlineManager`/`focusManager` for TanStack Query (netinfo not installed). | `src/lib/supabase.ts`, `queryClient.ts` |
| j | Modal missing `onRequestClose` → **Android hardware back is trapped**; backdrop is a non-pressable `View`. | `app/(app)/availability.tsx:201` |
| k | No error boundary anywhere, no crash reporting. `formatIQD` throws on any non-integer at 4 unguarded call sites → white screen. | app-wide |
| l | `app.venue_mode()` / `app.is_degraded()` (guest-executable, 0021) never called — degraded state is only discovered *after* a failed write. | — |

### 1.4 Contracted features with no implementation

- **Guest profile (name/phone)** — SOW L233 and the `design-delivery.md:181` cutline both require
  it. `fetchOwnProfile` exists in `src/features/profile/api.ts` and is **called from nowhere**.
  Name/phone are write-once at sign-up.
- **Court photographs** — SOW L299. `courts.photo_path` is fetched
  (`src/features/availability/api.ts:31`) and never rendered; `app/(app)/index.tsx:37-40` draws a
  hardcoded `"TP"` glyph. **There is also no `court-media` bucket in any of the 47 migrations**
  (only `menu-media` at 0031:290) and no `set_court_photo` RPC — the backend half is missing too.
- **Push notifications** — SOW L166-167, L306. The backend is complete and correct (0024 outbox +
  trigger + `send-push`). The client half fails silently: `getExpoPushTokenAsync()` is called with
  **no `projectId`** (`src/features/profile/push.ts:27`) inside a `catch { return 'unavailable' }`.
  No token ⇒ the trigger returns early at 0024:79-81 ⇒ nothing is ever enqueued. Also no
  `setNotificationHandler`, no response listener (so tapping a push deep-links nowhere despite
  `send-push` sending `data:{kind, reservation_id}`), no Android channel, and `expo-notifications`
  is not in the `plugins` array.
- **Error tracking** — SOW L256-257 and the cutline require Sentry. Repo-wide grep: **0 hits**.
- **OTA updates** — SOW L165. `expo-updates` not installed, no `updates`/`runtimeVersion` block,
  so the `channel` values in `eas.json` are inert.

### 1.5 The native-feel rule is violated wholesale

`HANDOFF.md:58-60` (owner, 2026-08-24): *"if it can look/behave native in React Native, it must —
bottom tabs via expo-router `Tabs`, native stack with platform back gestures/transitions, platform
pickers/switches/action sheets. No web-styled custom nav."*

Grep counts across `app/` + `src/`: **`Tabs` 0 · `ActionSheetIOS` 0 · `Switch` 0 · `Platform.` 0 ·
`Haptics` 0 · `Animated`/`Reanimated` 0 · `RefreshControl` 0 · `useColorScheme` 0 · SafeArea/insets
0 · `Image` 0 · `KeyboardAvoidingView` 0 · `hitSlop` 0 · `testID` 0 · `accessibilityLabel` 0.**

Navigation between Courts / My Bookings / Settings is done by **two `<Button>`s stacked at the
bottom of the court list** (`app/(app)/index.tsx:62-71`) — exactly the web-styled custom nav the
rule forbids. From Bookings or Settings there is no way to reach the other except back → tap again.

Also: the duration picker is a hand-rolled `<Modal transparent animationType="fade">`; the language
switch is two `<Text onPress>` pills duplicated verbatim in two files; the slot grid is a
`ScrollView` + nested `.map` mounting ~450 `Pressable`s unvirtualized; `react-native-safe-area-context`
is a declared dependency imported in **zero** files.

Accessibility: 6 `accessibilityRole`s total and nothing else. Slot state is encoded in **colour
alone** (WCAG 1.4.1 failure), and `slotColors.booked` is **~1.9:1 contrast** — a severe AA failure.
Touch targets: slot cells ~26 pt, date chips ~25 pt, language pills ~32 pt, against a 44 pt/48 dp
minimum, with zero `hitSlop` to compensate.

### 1.6 Quality gates that would have caught all of the above

- **`pnpm turbo lint` is a green no-op across the entire monorepo.** No package defines a `lint`
  script; there is no `eslint.config.*` or `.eslintrc*` anywhere — despite `packages/config/src/eslint.js`
  existing (4191 bytes) and shipping the eslint deps. `HANDOFF.md:57` claims "CSS logical properties
  only (lint-enforced)". **That enforcement does not exist.**
- **CI never bundles, prebuilds, or runs `expo-doctor`.** `apps/mobile` has no `lint` and no `build`
  script, so the only real gate is `tsc --noEmit` + 17 pure-logic tests. The `ulid` crash and every
  missing asset are structurally invisible to CI.
- **Zero component tests, zero mobile e2e.** No `jest-expo`, no `@testing-library/react-native`, no
  Maestro, no Detox. Root `e2e/` is Playwright web/operator only.
- **Intl/Hermes risk**: `@touch/core/time/tz.ts` and `@touch/i18n/formatting.ts` use raw `Intl` with
  `timeZone: 'Asia/Baghdad'` and `ar-IQ-u-nu-latn`, tested only under Node 22's full ICU. Hermes
  backs Intl with Apple NSFormatter shims (iOS) and android.icu (Android) — outputs differ,
  especially for `ar`. **Prices and times can render wrong on a real Arabic device while CI is green.**
- `ci.yml:30`'s `--frozen-lockfile || --no-frozen-lockfile` fallback now silently masks lockfile drift.
- `.gitignore` missing `/android`, `/ios`, `google-services.json`, `*.jks`, `credentials.json`; no
  `.easignore`, so EAS uploads the whole monorepo on every build.

### 1.7 Config bugs

- **`extra.supportsRTL: true` is a no-op.** It has not been read from `extra` since ~SDK 44; the real
  home is the `expo-localization` config plugin — and `expo-localization` is not installed. So the
  contractually-central RTL requirement is **natively unconfigured**, and the app can never read the
  device locale (`LocaleProvider` hardcodes `useState<Locale>('en')`), meaning an Arabic phone gets
  English on first launch.
- `extra.supabaseUrl` / `supabaseAnonKey` are dead config — `expo-constants` is a dependency imported
  in zero files. Two sources of truth, one dead.
- `expo-constants: ~17.0.0` and `expo-linking: ~7.0.0` are **SDK 52 ranges** — wrong today,
  independent of any upgrade, and producing a duplicated `expo-constants` under `apps/mobile/node_modules`.
- `src/theme.ts:1` imports from the `@touch/ui` **barrel**, pulling the DOM `ThemeProvider` and a large
  CSS string into the RN bundle to obtain a colour object.
- No `metro.config.js` anywhere → `packages/*` are outside Metro's `watchFolders`, so **editing the
  workspace packages does not hot-reload**.
- **`apps/mobile/.env` points at the hosted Supabase project, not `127.0.0.1:54321`** — contradicting
  its own `.env.example` header ("values from `supabase start`"). Anyone running
  `pnpm --filter @touch/mobile dev` is writing to the client's database. Given roadmap item 6 is
  "real data over fixtures", this is an active foot-gun. (The anon key itself is public-by-design and
  correctly gitignored — this is about the *target*, not a leak.)

---

## 2. Day-zero unblocks (external lead time — start 2026-08-27)

These have lead times measured in days-to-weeks and gate everything else. Nothing in
sections 3–5 can compensate for starting these late.

### 2.1 THE DATE RISK: Google Play

I verified the rule directly. **The 12-testers-for-14-continuous-days requirement applies only
to *personal* developer accounts created after 2023-11-13. Organization accounts are exempt.**

The arithmetic from today (2026-08-27):

| Path | Requirement | Earliest production-eligible | Verdict |
|---|---|---|---|
| **Personal account** | 12 real testers on real devices, opted in **continuously** 14 days, clock starts only after the closed-testing release is *approved*; then apply for production access, Google review "7 days or less" | 14 days → **2026-09-10**, + review → **~2026-09-17** | **Misses 09-16.** Marginal even against the 09-18 hard stop. Any tester dropping out **resets the counter to zero**. |
| **Organization account** | Exempt from the tester rule, but requires a **D-U-N-S number** + business verification. D-U-N-S takes *up to 30 days, averaging 4–8 weeks*; Google then needs up to 7 days to receive it | Only viable **if Kagu already holds a D-U-N-S number** | **If Kagu has a D-U-N-S: viable (verification has completed in ~33 h with docs ready). If not: misses the date outright.** |

**The contractual escape hatch.** SOW L789-790: *"acceptance of the mobile app is on **submission
of a working build**, not on store approval."* An upload to Play's **internal testing track** is a
submission of a working build. It requires no tester rule and no production access. So the
contract can be satisfied on time for Android even if public availability slips.

**Recommended action today, in this order:**
1. Ask Kagu whether it already has a **D-U-N-S number**. This single fact decides the Android path.
2. If yes → enrol the Play account as an **organization**, submit D-U-N-S immediately. Exempt.
3. If no → enrol as **personal** *and start closed testing with 12 testers the same day* as a
   hedge, while requesting a D-U-N-S in parallel (free, but request it today regardless).
4. Either way, plan **iOS-first submission** and treat Android production availability as a
   follow-on, restating SOW L789-790 to Mustafa on the next client call so the expectation is set
   in writing before the date, not after.

### 2.2 Other day-zero items

| # | Item | Owner | Lead time | Blocking? |
|---|---|---|---|---|
| 1 | **`eas init`** — no `.expo/`, no `extra.eas.projectId` (a literal TODO at `app.config.ts:29`), no `owner` field. Nothing can be built at all. Set `owner` to the Kagu org **before** running it, or the project binds to whoever ran it. `design-delivery.md:100` scheduled this Week 1 Day 1 as *"cannot slip"* — it is now day 4+. | Dev | minutes | **YES — total** |
| 2 | Google Play enrolment per §2.1 | Owner | days–weeks | **YES (Android)** |
| 3 | Confirm the Apple Developer membership is active and note the **Team ID** + App Store Connect app record (create the app record early; `ascAppId` is needed for `eas submit`) | Owner | ~1 day | **YES (iOS)** |
| 4 | **FCM V1 service-account JSON** for Android push (upload to EAS as a credential). None exists anywhere in the repo; `API.md` has zero mentions of Apple/Google/FCM/EAS. Without it Android push silently fails in production. | Dev + Owner | ~1 h once Play exists | YES (push) |
| 5 | **APNs key** for iOS push (EAS can generate it given Apple access) | Dev | minutes | YES (push) |
| 6 | **Domain decision** — still blocked on Mustafa (HANDOFF.md:206-210). Gates the **privacy-policy URL**, which is a hard store requirement for both platforms, *and* Universal Links. **Fallback if unresolved by 2026-09-05: publish the privacy policy on the existing `touch-padel-web.vercel.app` domain** and submit against that; a policy URL only has to resolve, it does not have to be on the final brand domain. | Owner | client-blocked | **YES — has a fallback** |
| 7 | Real Supabase env values for the three `eas.json` profiles (all are `REPLACE_*` today; `production` points at `https://REPLACE-TOUCH-PROD-REF.supabase.co`). Cutline explicitly allows submitting against Kagu staging if Touch's project isn't live. | Dev | minutes | **YES** |
| 8 | **Demo account seeded with a future booking** for App Review notes — reviewers *will* reject an app they cannot sign into. `staff` still holds only `Dev` seed rows. | Dev | ~1 h | **YES** |

---

## 3. The SDK 54 upgrade

SDK 54 = **React Native 0.81.5 · React 19.1.0 · expo-router ~6.0.24**. It is the last SDK
supporting the legacy architecture (`newArchEnabled: true` is already set, so this is a non-issue),
and **Android edge-to-edge becomes always-on and cannot be disabled** — which turns the current
zero-usage of `react-native-safe-area-context` into a visible bug on every screen.

### 3.1 The hard part: React must move atomically across the monorepo

`.npmrc` sets `node-linker=hoisted`, so there is exactly **one physical `react`** at the root.
React `19.0.0` is **exact-pinned in four places** and `@types/react` `~19.0.10` in the same four:

- `apps/mobile/package.json`
- `apps/web/package.json` (+ `react-dom`)
- `apps/operator/package.json` (+ `react-dom`)
- `packages/ui/package.json` (devDep)

Bumping only `apps/mobile` makes pnpm either fail the pins or nest a second `react@19.1.0` under
`apps/mobile/node_modules` — which in React Native produces *"Invalid hook call / two copies of
React"* at runtime, with Metro's flat resolution making the winner non-deterministic.

**This is one atomic commit touching all four `package.json` files.** Compatibility checked:
`apps/web` runs Next 16.3 whose react peer range accepts `^19.0.0`, so 19.1.0 is fine;
`apps/operator` is Vite + React + TanStack Router with no exact peer constraint;
`packages/ui` declares a permissive peer `>=18 <20`.

Verification gate after the bump: `pnpm turbo typecheck test` must stay green **for web and
operator as well as mobile** before any further mobile work lands.

### 3.2 Also fix two ranges that are wrong *today*

Independent of the upgrade, `expo-constants: ~17.0.0` and `expo-linking: ~7.0.0` are **SDK 52**
ranges. They resolved to 17.0.8 / 7.0.5 while the root hoisted `expo-constants@17.1.8`, producing
a duplicated copy under `apps/mobile/node_modules`. `npx expo-doctor` flags both immediately —
which is itself evidence it has never been run.

### 3.3 Target dependency manifest (versions verified against `expo@54.0.37`)

**Upgrade:** `expo@~54.0.0` · `expo-router@~6.0.24` · `react-native@0.81.5` · `react@19.1.0` ·
`@types/react@~19.1.x` · `expo-constants@~18.0.14` · `expo-linking@~8.0.12` · `expo-device@~8.0.10` ·
`expo-notifications@~0.32.17` · `expo-secure-store@~15.0.8` · `expo-status-bar@~3.0.9` ·
`react-native-screens@~4.16.0` · `react-native-safe-area-context@~5.6.0`.

**Add — correctness and platform (all bundled in Expo Go, so the fast loop survives):**

| Package | Version | Why |
|---|---|---|
| `react-native-get-random-values` | `~1.11.0` | **Fixes the §1.1 crash.** |
| `expo-localization` | `~17.0.9` | Device locale on first launch + the config plugin that actually carries `supportsRTL` (§1.7). |
| `expo-splash-screen` | `~31.0.13` | Required for any splash on SDK 53+. |
| `expo-font` | `~14.0.12` | Brand fonts; Arabic currently renders in the system face. |
| `expo-system-ui` | `~6.0.9` | Root background colour under edge-to-edge. |
| `expo-updates` | `~29.0.20` | Makes the `eas.json` `channel` values real; SOW L165 OTA. |
| `expo-application` | `~7.0.8` | App version in Settings; Sentry release tagging. |
| `expo-web-browser` | `~15.0.11` | In-app privacy policy / terms (store requirement). |
| `@react-native-community/netinfo` | `11.4.1` | TanStack `onlineManager` — pause instead of fail offline. |
| `@react-native-async-storage/async-storage` | `2.2.0` | Move the **locale preference** off SecureStore (keychain is the wrong store for a non-secret) and back the query cache. |

**Add — native look & feel:**

| Package | Version | Replaces |
|---|---|---|
| `expo-symbols` | `~1.0.8` | SF Symbols on iOS — the app currently has **no icon set at all**. |
| `expo-image` | `~3.0.11` | The hardcoded `"TP"` text glyph; court photos. |
| `expo-haptics` | `~15.0.8` | Slot select, booking confirm, cancel. |
| `react-native-reanimated` | `~4.1.1` | All motion. **Requires a new `react-native-worklets` peer and forces creating `babel.config.js`.** |
| `react-native-gesture-handler` | `~2.28.0` | Sheet drags; reanimated/bottom-sheet peer. |
| `@react-native-community/datetimepicker` | `8.4.4` | The hand-rolled horizontal date chip strip. |
| `@react-native-segmented-control/segmented-control` | `2.5.7` | The two `<Text onPress>` language pills (native `UISegmentedControl` on iOS). |
| `@gorhom/bottom-sheet` | latest | The `<Modal transparent>` duration picker (pure JS over reanimated + GH → works in Expo Go). |
| `react-native-svg` | `15.12.1` | Brand marks. |
| `expo-blur` / `expo-glass-effect` | `~15.0.8` / `~0.1.10` | Optional iOS 26 polish — **not on the critical path.** |

**Requires an EAS dev build (not Expo Go):** `@sentry/react-native`, `expo-dev-client@~6.0.21`,
`expo-build-properties@~1.0.10`, and **push notification testing** (push does not work in Expo Go
on SDK 53+).

### 3.4 Files that must be created

- **`apps/mobile/metro.config.js`** — `watchFolders = [workspaceRoot]` + `nodeModulesPaths`.
  Explicitly do **not** set `disableHierarchicalLookup`: that is for the isolated linker and would
  break the flat root lookup this repo uses. Without this, editing `packages/*` does not hot-reload.
- **`apps/mobile/babel.config.js`** — currently absent and *currently fine* (`@expo/metro-config`
  falls back to `babel-preset-expo`), but reanimated 4 / `react-native-worklets` forces it.
- **`apps/mobile/eslint.config.js`** — `import { base, react } from '@touch/config/eslint'`. The
  preset is **already written** (`packages/config/src/eslint.js`, 4191 bytes, includes the RTL
  logical-properties guard) and consumed by **zero** packages. Add a `lint` script here and in
  every other package so `pnpm turbo lint` stops being a green no-op.
- **`apps/mobile/assets/`** — icon (1024×1024, no alpha), adaptive icon foreground + monochrome,
  splash, notification icon. Source art at `docs/brand/touch_padel_logo_transparent.png`.
- **`apps/mobile/.easignore`** — EAS currently uploads the entire monorepo on every build.

### 3.5 `app.config.ts` rewrite

Add: `icon`, `splash` via the `expo-splash-screen` plugin, `android.adaptiveIcon`, `owner`,
`extra.eas.projectId`, `runtimeVersion` + `updates`, `ios.buildNumber`/`android.versionCode`
strategy, `locales: { en, ar }`, and `ios.infoPlist` with **`ITSAppUsesNonExemptEncryption: false`**
(without it every App Store Connect upload stalls on manual export compliance) and
`CFBundleLocalizations: ['en','ar']`.

Plugins become: `expo-router`, `expo-secure-store`, **`['expo-localization', { supportsRTL: true }]`**,
`['expo-notifications', { icon, color }]`, `expo-splash-screen`, `expo-font`, `expo-updates`.
Delete the inert `extra.supportsRTL` and the dead `extra.supabaseUrl`/`supabaseAnonKey`.

---

## 4. The native-UI rebuild (native-correct, lightly styled)

### 4.1 Navigation — the headline change

Replace the flat 5-screen `Stack` and the two nav buttons with **bottom tabs + a native stack per
tab**:

```
(app)/_layout.tsx            → tabs
  (tabs)/index               → Courts        [sf: "sportscourt.fill"]
    availability             → pushed native stack
    confirm                  → formSheet presentation
  (tabs)/bookings            → My Bookings   [sf: "calendar"]
  (tabs)/settings            → Settings      [sf: "gearshape.fill"]
```

**Decision needed — `NativeTabs` vs `Tabs`.** SDK 54 ships `NativeTabs` from
`expo-router/unstable-native-tabs` (SwiftUI `TabView` on iOS, incl. liquid-glass tabs and
scroll-to-top on tab press). It is genuinely native and exactly what the owner's rule asks for —
**but Expo documents it as *alpha*, "API subject to change", and on Android icons require custom
`drawable` resources, which do not exist in Expo Go.**

Recommendation: **spike `NativeTabs` on day 1 behind a single `_layout.tsx`** so swapping to the
stable `Tabs` is a one-file change. Ship `NativeTabs` if the Android drawable path is clean in a
dev build; otherwise ship `Tabs` (SF Symbols on iOS via `expo-symbols`, Material icons on Android)
and revisit after submission. Do not let an alpha API sit on the critical path to 2026-09-16.

### 4.2 Component-by-component replacement

| Today | Becomes |
|---|---|
| `<Modal transparent animationType="fade">` duration picker, **no `onRequestClose`** (Android back trapped) | `@gorhom/bottom-sheet` or native action sheet, with in-flight state on the *correct* control and slots disabled while the hold RPC is in flight |
| Horizontal `ScrollView` of `Pressable` date chips (~25 pt tall) | `@react-native-community/datetimepicker` + a segmented week strip, ≥44 pt targets |
| Two `<Text onPress>` language pills, duplicated in 2 files | `@react-native-segmented-control/segmented-control`, extracted to one component |
| Push opt-in `<Button>` with state never hydrated from `profiles.expo_push_token` | RN `<Switch>`, hydrated via the currently-dead `fetchOwnProfile` |
| Hardcoded `"TP"` text glyph | `expo-image` + a new `court-media` bucket (§5) |
| `ScrollView` + nested `.map`, ~450 unvirtualized `Pressable`s | `FlatList`/`FlashList`, memoised rows, `useMemo` on the per-cell reduce |
| No icons anywhere | `expo-symbols` (iOS) / `@expo/vector-icons` (Android) |
| No motion | `react-native-reanimated` — hold countdown, list transitions, sheet |
| No feedback | `expo-haptics` on slot select / confirm / cancel |
| Bare `<View>` `Screen` | `SafeAreaView` + insets — **mandatory** under SDK 54 forced Android edge-to-edge |
| No refresh | `RefreshControl` on Courts + My Bookings; skeletons instead of bare spinners |
| Errors rendered as empty states | Distinct `ErrorState` with a retry that refetches **all** failed queries |

### 4.3 Token layer

Replace the 12-colour `src/theme.ts` with spacing / radius / type / shadow scales (every screen
currently hardcodes raw numbers across 6 `StyleSheet` blocks). Import from `@touch/ui` via
**subpath** (`@touch/ui/tokens/palette`), not the barrel, so the DOM `ThemeProvider` and its CSS
string stop being bundled into the app. Fix `slotColors.booked` (**~1.9:1 — a severe WCAG AA
failure**) and pull `held`/`blocked` from `statusVars` instead of the two hardcoded off-palette hexes.

Add a non-colour encoding for slot state (icon or pattern) — colour-alone fails WCAG 1.4.1 — plus
`accessibilityLabel`/`accessibilityState` on slot cells, which today announce as *"5:30 PM, 40,000
IQD, button"* with no court, no duration and no state.

Keep `userInterfaceStyle: 'light'` for submission (the `@touch/ui` palette has no dark variant), but
**fix `<StatusBar style="auto" />` → `"dark"`** — `auto` reads the *system* scheme, so on a
dark-mode phone it paints light glyphs onto the app's permanently-white background: an invisible
status bar on every dark-mode device today.

### 4.4 Fonts

`expo-font` + the stand-ins (Montserrat Latin, IBM Plex Sans Arabic) that `packages/ui` currently
declares only as **CSS font-family strings React Native cannot consume**. Gate on
`expo-splash-screen` so there is no flash of system font. Licensed Next Art / Frutiger LT Arabic
remain the documented swap point.

---

## 5. Backend work this requires

Four gaps need **migrations or edge functions**, not just client code. These are the items most
likely to be discovered late, because the mobile audit is where they surface.

| # | Work | Detail |
|---|---|---|
| 1 | **`app.delete_account()` RPC + edge function** | **Apple Guideline 5.1.1(v) is an automatic rejection** for any app that creates accounts. Nothing exists: zero hits for `delete_account` across all 47 migrations, no edge function, and not even a string in the i18n catalogs. Needs a `SECURITY DEFINER` RPC that anonymises/cascades the guest's `profiles` row and reservations per the retention policy, plus a service-role edge function calling `auth.admin.deleteUser`. Flagged by the team's own `design-critique.md:51` as *"unbudgeted-but-required"*. |
| 2 | **`court-media` storage bucket + `set_court_photo` RPC** | SOW L299 requires court photographs. Only `menu-media` exists (0031:290). Needs a bucket, `storage.objects` policies (public read, staff write), a `set_court_photo` RPC, and an operator admin UI to upload — mirroring the existing menu-photo pattern, including the lesson from 0027 that photo writes get their **own** RPC so the day-1 photo-wipe bug cannot recur. |
| 3 | **`app.release_hold()` RPC** | Abandoning the confirm screen currently blocks the slot for the full 300 s TTL for every other guest. No release path exists in the schema. Needs an RPC callable by the hold's owner, plus a client `beforeRemove` guard. |
| 4 | **Supabase Auth redirect allow-list on the HOSTED project** | `touchpadel://reset-password` must be added to the Auth URL configuration, and `signUp` must pass `emailRedirectTo`. This is a *dashboard* change on `lczijabnorujcgmbuqlw`, not a `config.toml` edit — so it needs a Claude-in-Chrome prompt per the project's standing practice (`docs/client/chrome-agent-prompt.md`). Without it, password reset and email verification stay broken on device regardless of client code. |

Also client-side but schema-adjacent: **wire `app.venue_mode()`** (guest-executable since 0021 and
never called) so degraded mode shows a proactive banner with the venue phone number, rather than
being discovered only after a failed write.

i18n: **both catalogs need new keys** — verified absent from `en.ts` and `ar.ts`: `booking.closedDate`,
`booking.outsideHours`, `booking.noSlots`, the whole `profile.*` group, and `settings.deleteAccount*`.

---

## 6. Quality gates and schedule

### 6.1 Gates to add (these are what let all of this ship undetected)

1. **Wire the ESLint preset that already exists.** `packages/config/src/eslint.js` is complete —
   including the RTL logical-properties guard — and consumed by nobody. Add `eslint.config.js` +
   a `lint` script to every package. `HANDOFF.md:57`'s "lint-enforced" claim becomes true.
2. **`npx expo-doctor` and `npx expo export` in CI.** Neither has ever run. `expo export` would
   have caught the missing assets; `expo-doctor` catches the SDK 52 ranges and the duplicate
   `expo-constants`.
3. **`mobile-eas.yml`** — specified in detail at `design-arch.md:317`, never written.
4. **Component tests**: `jest-expo@~54.0.18` + `@testing-library/react-native`. These do **not**
   coexist cleanly with vitest — keep vitest for the pure `logic/assemble/errors` modules and add
   jest for `.tsx`, with `"test": "vitest run && jest"`.
5. **Maestro** for the booking happy path. Needs `testID`s, of which the app currently has **zero**.
6. **An on-device Arabic smoke check before submission.** `Intl` with `timeZone: 'Asia/Baghdad'`
   and `ar-IQ-u-nu-latn` is validated only against Node 22's full ICU; Hermes uses NSFormatter on
   iOS and android.icu on Android. **Prices and times can render wrong in Arabic while CI is
   green.** No amount of unit testing substitutes for running it once on a real phone.
7. Remove `ci.yml:30`'s `--frozen-lockfile || --no-frozen-lockfile` fallback (now masking drift);
   add `/android`, `/ios`, `google-services.json`, `*.jks`, `credentials.json` to `.gitignore`.

### 6.2 Suggested sequencing to 2026-09-16

| Window | Work |
|---|---|
| **Today** | §2 day-zero unblocks — `eas init`, Play/D-U-N-S decision, Apple team ID, real env values. These have external lead time; everything else can be done in parallel afterwards. |
| **Days 1–3** | Crash fix (§1.1) + SDK 54 atomic upgrade (§3) + `metro.config.js`/`babel.config.js`/eslint wiring. Gate: `expo-doctor` clean, `pnpm turbo lint typecheck test` green across **all four** packages, `expo export` succeeds. `NativeTabs` spike. |
| **Days 4–8** | Native UI rebuild (§4) — tabs, sheets, pickers, safe areas, icons, images, haptics, refresh, skeletons, tokens, fonts, a11y. |
| **Days 4–8 (parallel)** | Backend work (§5) — account deletion, `court-media`, `release_hold`, hosted Auth redirect URLs. |
| **Days 9–12** | Correctness defects (§1.3), profile screen, push wired end-to-end **on a dev build** (push cannot be tested in Expo Go), Sentry, degraded banner. |
| **Days 13–16** | Store assets, listings EN+AR, screenshots in both languages, privacy labels + Data Safety, review notes + demo account, Arabic on-device pass, builds, submit. |
| **Buffer** | 09-16 → 09-18 hard stop; SOW weeks 5–6 are held for review/fixes. |

### 6.3 Top risks

| Risk | Mitigation | Decide by |
|---|---|---|
| **Google Play tester rule / D-U-N-S lead time makes Android production impossible** | Confirm D-U-N-S today; hedge with a personal account + 12 testers started immediately; lean on SOW L789-790 (acceptance is on *submission*, and an internal-track upload qualifies); plan iOS-first | **Today** |
| Domain unresolved → no privacy-policy URL → no listing | Publish the policy on the existing `vercel.app` domain and submit against it | 2026-09-05 |
| `NativeTabs` is alpha; Android drawables don't exist in Expo Go | Spike day 1 behind a one-file swap to stable `Tabs` | Day 2 |
| React 19.1 bump breaks `apps/web` or `apps/operator` | One atomic commit, full `turbo` gate across all four packages before anything else lands | Day 3 |
| Hermes `Intl` renders Arabic prices/times wrong — invisible to CI | Mandatory on-device Arabic pass; consider pinning formatting to explicit helpers | Day 14 |

### 6.4 Verification

- `npx expo-doctor` clean; `pnpm turbo lint typecheck test` green across mobile, web, operator, ui.
- `npx expo export --platform all` succeeds (proves the bundle builds — CI has never done this).
- Expo Go on a physical iPhone (SDK 54 is the App Store ceiling) for the daily loop; an **EAS dev
  build** for push, Sentry and `expo-updates`, which Expo Go cannot exercise.
- End-to-end on a real device: sign up → verify email → book a court → confirm → receive the
  confirmation push → tap it → land on the booking → cancel → receive the cancellation push.
  **Run the entire script once in Arabic** (`HANDOFF.md` convention).
- Confirm the booking appears immediately on the operator desk calendar — the SOW's own acceptance
  test (L290-296).

---

## 7. Verified backend blockers (checked against the SQL on 2026-08-27)

Three items in §5 turned out to be harder than "write an RPC". All three were verified directly
against the migration files, not inferred.

### 7.1 Account deletion is blocked by a foreign key, not just by missing UI

`packages/db/supabase/migrations/20260824000004_*.sql:9`
```sql
id uuid primary key references auth.users(id) on delete cascade
```
`packages/db/supabase/migrations/20260824000008_reservations.sql:21`
```sql
guest_id uuid references profiles(id),          -- NO on-delete clause -> NO ACTION
```
So `auth.admin.deleteUser(uid)` cascades into `profiles`, which then **fails with a foreign-key
violation for any guest who has ever booked**. And the row cannot simply be nulled either, because
line 38 of the same file has:
```sql
check (kind <> 'booking' or (guest_id is not null or guest_name is not null))
```

**A migration is mandatory before any deletion path can work at all.** The shape:
1. `alter table reservations ... foreign key (guest_id) references profiles(id) on delete set null;`
2. The RPC must **snapshot `profiles.full_name`/`phone` into `reservations.guest_name`/`guest_phone`
   before** the guest row is nulled, or the check constraint fires.
3. Then anonymise `profiles` (`full_name = 'Deleted guest'`, `phone = null`,
   `expo_push_token = null`, `deleted_at = now()`) and write an audit row.
4. A service-role edge function calls `auth.admin.deleteUser` last.

Google Play's Data Safety form also asks for a **web-accessible account-deletion URL**, so
`apps/web` needs a route as well as the in-app flow.

### 7.2 `cancel_reservation` cannot be reused to release a hold

`20260824000008_reservations.sql:600-605` — for a non-staff caller:
```sql
select cancellation_window_hours into v_window from venue_settings;
if v.start_at < now() + make_interval(hours => coalesce(v_window, 12)) then
  raise exception 'CANCELLATION_WINDOW' ...
```
Releasing a hold for **tonight** is by definition inside the default 12-hour window, so the existing
RPC raises instead of releasing. `app.release_hold(p_reservation_id uuid)` is genuinely new work:
own-hold guard, `app.lock_court`, set `status = 'expired'`, audit — after which the 0022 realtime
trigger broadcasts `slot_changed` and other guests see the slot free immediately.

### 7.3 `send-push` was never deployed, and its cron was never scheduled

`HANDOFF.md` Day-3 records *"All four edge functions deployed"* and names them:
`telegram-send`, `telegram-callback`, `analytics-posthog`, `analytics-insights`.
**`send-push` is not among them** — nor is `replay`.

Separately, the every-minute cron is a documented **manual deploy step**, not a migration
(`packages/db/README.md:100-108`, restated at `0024:164-167`), and nothing in the Day-3 integrations
log mentions scheduling it.

So push is dead on the hosted project on **three** independent counts, any one of which is
sufficient: the client never obtains a token (§1.4), the sender function is not deployed, and the
cron that would drain `notification_outbox` does not exist. Fixing only the client bug would change
nothing observable.

Verify with:
```sql
select jobname, schedule, active from cron.job;
```
and `supabase functions list --linked`.

---

## 8. Two implementation details worth fixing exactly once

### 8.1 The ulid fix belongs in an entry shim, not a screen

`main` is currently `expo-router/entry`, and expo-router discovers routes through a
`require.context` virtual module — so module-evaluation order across route files is not something
that can be reasoned about locally. The deterministic fix is a new `apps/mobile/index.js`:

```js
import 'react-native-get-random-values';   // MUST be first — seeds global.crypto.getRandomValues
import 'expo-router/entry';
```
with `"main": "index.js"`.

Add a second, independent layer in `src/lib/idempotency.ts` by seeding the generator explicitly
(`factory(prng)` over `expo-crypto.getRandomValues`) so the failure cannot silently return if the
import order is ever disturbed — and guard the order itself with a pure vitest that reads
`index.js` and asserts the first import. The current failure mode is silent until a user tries to
book, which is exactly the kind of bug that needs belt *and* braces.

### 8.2 Three slot states fail contrast, not one

`src/theme.ts:25-31`, measured:

| state | today | ratio | fix |
|---|---|---|---|
| `booked` | `#BCBDBF` / `#5C5E62` | **~1.9:1** | `#E8E9EA` / `#4A4C50` + border → ~6.8:1 |
| `past` | `#F6F7F5` / `#BCBDBF` | **~1.6:1** | `#F6F7F5` / `#5C5E62` → ~5.9:1 |
| `blocked` | `#8A8C90` / `#FFFFFF` | **~3.4:1** | `#5C5E62` / `#FFFFFF` → ~6.6:1 |
| `held` | off-palette `#F0C868` | ok | use `statusVars['--tp-warn-bg'/'--tp-warn-fg']`, which already exist in `packages/ui/src/tokens/cafeBrand.ts` |
| `free` | `#A5D06F` / `#000` | ~12:1 | keep |

Colour is also the *only* channel encoding slot state, which fails WCAG 1.4.1 independently of
contrast. Add a per-state glyph and `accessibilityState`, and assert the ratios in a unit test so
this stays fixed.
