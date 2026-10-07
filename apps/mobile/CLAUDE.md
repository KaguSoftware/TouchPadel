# apps/mobile — rules for every change

The guest app: Expo SDK 57 with expo-router screens under `app/` and feature code under
`src/features/{auth,availability,booking,boot,courtTransition,deposit,matches,profile,staff}`.
Written 2026-09-20 (Phase 2, Milestone 0 item 12) from `PHASE-2-PLAN.md` Part A5 plus the 09-20
code verification. Database-side rules are in `packages/db/CLAUDE.md`.

The same app is the staff phone for a signed-in staff account (`app/staff*.tsx`,
`src/features/staff`): `StaffStatusProvider` decides guest or staff, `GuestTabsGate` keeps a staff
session out of the tabs, and a guest renders exactly as before. The binding shapes (routes, query
keys, the status table, the no-station-RPC rule) are
`docs/design/protocols/build-contracts-2026-09-23.md` §6 and §7.

Coach mode (`app/coach-mode*.tsx`, `src/features/coach`; `docs/design/coaching/guest.md` §4.13): a
coach is a GUEST. `CoachStatusProvider` (inside `StaffStatusProvider`) reads `coach_me` while a
reader is mounted and never changes what the staff status answers; `RequireCoach` gates every
coach-mode screen (a retired coach reaches the statements only). Guests open it from Profile, staff
who coach from the "Coach mode" row of the staff hub (C-27).

Screenshot guard (owner call 2026-10-07): `StaffScreenGuard`
(`src/features/staff/screenGuard/`, mounted once in `app/_layout.tsx`) blocks screenshots and
recordings for every staff role except the owner (`expo-screen-capture`: Android FLAG_SECURE; iOS
cannot block a screenshot, it blanks recordings and the app switcher) and reports each screenshot it
hears of to `log_staff_screenshot` (0313) with the page from `usePathname()`, retried a few times
without signal. The owner reads the list at `app/staff-screenshots.tsx` (Today's "Screenshots" tile),
the audit log's `staff.screenshot` rows through `audit_log_page`. The owner's assistant is a
floating button (`src/features/assistant/AssistantFab.tsx`, also mounted in the layout) on staff
pages other than the assistant's own; Today no longer carries the assistant banner.

## Commits

- No AI co-author trailer of any kind (`Co-Authored-By: Claude …`, Copilot, …). If a harness appends
  one, strip it. Root `CLAUDE.md`.
- Commit and push only when Parsa says "commit" or "push". Never run `git add`, `commit`, `stash`,
  `checkout`, `reset` or `clean` on your own.
- One commit carries the screen, its keys in `packages/i18n/src/catalogs/en.ts` and `ar.ts`, and,
  when an RPC changed, the regenerated `packages/db/src/types.gen.ts`.

## Writes and errors

- Every write is an `app.*` RPC on the shared client (`src/lib/supabase.ts`). Reservation writes
  carry a per-intent idempotency key from `src/lib/idempotency.ts`
  (`{station}:{mutation_type}:{ulid}`; mobile is one logical station) passed as `p_idempotency_key`
  (`src/features/booking/api.ts:25`).
- A retry of the same intent reuses its key; a new intent gets a new key. Never mint a key inside a
  retry loop.
- Server codes map through `CODE_TO_KEY` and `mapErrorToKey`
  (`src/features/booking/errors.ts:12,83`); a new code gets an entry there and both catalogs.
  `isDegradedRefusal` (`:73`) is the only place that recognises a degraded-mode refusal.
- The booking gate (`bookingGateState` + `bookingGateHref`, `src/features/auth/social.ts`) stands
  before every intent that ends in a court booking: a slot's hold and an open match's start or join
  (owner, 2026-09-27 and 2026-09-29; `intentBooksCourt` in `src/features/matches/pendingJoin.ts`).
  No phone → `/complete-profile`, a phone nobody verified → `/phone-sign-in`: continue mode from
  the Book tab and the post-auth continuation (the intent stays pending), back mode from Review and
  the match screens' Start / Join. The list and one's own match are browsing and pass.
- `isTransportError` (`src/lib/network.ts:66`) decides what `src/lib/queryClient.ts` retries; a
  P0001 business error is never retried and never shown as "offline".
- Auth links: only the code-exchange path in `src/features/auth/deepLink.ts`. The raw-tokens branch
  is S6 and goes in Milestone 0 item 6, as does the `app/reset-password.tsx` guard (render only
  after a recovery exchange in this session). Do not build on either.

## Queries

- Query keys are families exported next to their hooks: `availabilityKeys`, `bookingKeys`,
  `profileKeys` (`src/features/*/hooks.ts`), `historyKeys` (`src/features/booking/history.ts`) and
  `matchKeys` (`src/features/matches/keys.ts`, re-exported by its `hooks.ts`), and coaching's
  `coachingKeys` (`src/features/coaching/keys.ts`, the guest's lessons) and `coachKeys`
  (`src/features/coach/keys.ts`, coach mode). Extend a family; never inline a key array in a
  component.
- Coaching (`docs/design/coaching/guest.md` §4.7): everything under `['coaching']` (the guest's
  lessons) and `['coach']` (coach mode: a roster carries students' phones, a statement the coach's
  pay) stays off disk, and every lesson and coach write runs now or fails now (CD-6,
  `src/lib/queryClient.ts`). Bookings, joins, creations and adds take
  `lessonIntentKey(intent, kind)` (`src/lib/idempotency.ts`): a guest's key is kept across
  PHONE_REQUIRED, TERMS_REQUIRED and PRICE_CHANGED, a coach's only across a transport failure.
  Cancels, the link confirm and attendance marks take none. Lesson push routes live in
  `src/features/coaching/pushRoutes.ts`.
- Open matches (`docs/design/open-matches/guest.md` §4.23): everything under `['match']` is live
  state and is never persisted (`src/lib/queryClient.ts` leaves it out of the dehydrate filter).
  `match_start` is the only match write with a key: `matchIntentKey(matchStartIntent(…))` from
  `src/lib/idempotency.ts`, kept across the refusals the guest fixes and the ticket continuation
  that replays the start. Every other match write is state-idempotent and takes none.
- Tournaments (tournaments plan §5.2; `docs/design/tournaments/build-contracts-2026-10-03.md`):
  `tournamentKeys` (`src/features/tournaments/keys.ts`), everything under `['tournament']` stays
  off disk and register / withdraw run now or fail now. Both are state-idempotent and take no key;
  every argument is sent, nulls included. The push route and kind live in
  `src/features/tournaments/pushRoutes.ts`.
- Retry, online-pause, focus refetch and persistence are set once in `src/lib/queryClient.ts`; a
  screen does not override them.

## Native feel, direction and theme

- Native-feel rule (owner, 2026-08-24): expo-router `Tabs`, native stack with platform back
  gestures, platform pickers, switches and sheets; no web-styled custom nav
  (`docs/design/mobile-audit-2026-08-27.md` section 1.5;
  `src/navigation/TabsLayout.android.tsx:96`).
- `Text` comes from `src/i18n/text.tsx`, never from `react-native` (restricted import,
  `eslint.config.mjs:51-52`): it carries the paragraph's writing direction.
- Direction is app state from `useLocale().dir` (`src/i18n/direction.tsx`); `I18nManager`,
  `DevSettings` and `reloadAsync` are restricted imports (`eslint.config.mjs:39-57`). A language
  switch never reloads the app.
- Logical style props only (`paddingStart`, `marginEnd`, `start`, `end`); `rtlGuardRules` from
  `packages/config/src/eslint.js` fails `lint` on the physical ones, and
  `src/lib/__tests__/rtlGuard.test.ts` pins the rule.
- Colours come from `src/theme/tokens.ts` (the palette is closed, owner 2026-09-05); components
  never reference raw hex. Import `@touch/ui` by subpath only (`eslint.config.mjs:26-31`), never the
  barrel.
- Strings live in `packages/i18n/src/catalogs/en.ts` + `ar.ts` under the shared namespaces (`auth`,
  `booking`, `profile`, `cafe`, `errors`, `degraded`, …); `packages/i18n/src/__tests__/t.test.ts:35`
  asserts key parity. Open-match strings are `matches.*` (`catalogs/matches.en.ts` + `ar.ts`, which
  spread one fragment pair per area: `matches.core`, `screens`, `book`, `wallet`, `web`); a noun
  that agrees with a number ("2 tickets") goes through `countPhrase` (`packages/i18n/src/plural.ts`,
  the six Arabic forms), and a third-person line in a women's match takes its `…F` twin
  (`byCategory`).

## Config and builds

- Env is `EXPO_PUBLIC_*`, inlined at build time (`src/lib/supabase.ts:11-12`, `app.config.ts`). A
  new variable goes into `app.config.ts` and into the `env` block of all three `eas.json` build
  profiles (`development`, `staging`, `production`); nothing goes in `extra`.
- Service-role or `sb_secret_` values never reach the bundle; `clientSecrets` lint
  (`@touch/config/eslint`) fails on them, and CI runs
  `scripts/security/check-artifact-secrets.mjs --only=mobile` on the export (`ci.yml:241`).
- Migrations reach hosted before a build that calls them. `eas` and `expo` run from `apps/mobile`,
  never the repo root. Production `eas build` and any store submit are Parsa's to run; prepare the
  command and hand it over.
- Native modules reach phones only in a new dev client and store build. The date-time picker
  (`@react-native-community/datetimepicker`, wrapped once in `src/components/DateTimeField.tsx`)
  is one: coach mode's pickers need the coaching build (coaching R19). So is `expo-screen-capture`
  (the screenshot guard): until the build after 2026-10-07 is installed, staff phones neither block
  nor report screenshots. On Android 13 and older the report needs a media permission the guard asks
  for; check on a real phone whether Android 14 reports an attempt FLAG_SECURE blocks.

## Tests

- TWO RUNNERS, and their globs must never overlap (`jest.config.js` explains the split):
  - **vitest**, plain node, `src/**/__tests__/**/*.test.ts` — pure modules only; nothing under
    test may import `react-native` or `expo`. Put logic in
    `src/features/<x>/{assemble,logic,errors}.ts` so it is testable.
  - **jest-expo** (`preset: jest-expo/ios`), `src/smoke/**/*.smoke.test.tsx` — one smoke render
    per screen, in EN and AR: it mounts, its primary action is present by `testID`, the tree
    resolved to the right direction, and the primary's label is `makeT(locale)(<its key>)` so an
    Arabic case that rendered English fails. Mocks are global (`jest.setup.ts`); the provider tree
    is `src/test/smoke.tsx`.
- `testID` convention: `<route>.<element>`, kebab-case, dots between segments
  (`sign-in.submit`, `bookings.filter.upcoming`); a list row appends its entity id
  (`bookings.upcoming.<reservationId>`). Route = the file path minus `app/`, `(tabs)` and `.tsx`,
  with `(tabs)/index` → `book`, `booking/[id]` → `booking-detail`, `(tabs)/_layout` → `tabs`,
  `match/[id]` → `match-detail`, `m/[token]` → `match-link`, `coach/[id]` → `coach-detail`,
  `class/[id]` → `class-detail`, `lesson/[id]` → `lesson-detail`, `tournament/[id]` →
  `tournament-detail`.
  A shared component NEVER mints an id: it takes `testID?: string` and forwards it EXPLICITLY
  (`testID={testID}` — a `{...spread}` does not count, because the lint rule reads the JSX).
- `testIdRules` from `@touch/config/eslint` fails `lint` on any interactive element without one
  (and on `testID={undefined}`); `src/lib/__tests__/testIdGuard.test.ts` pins the rule. A new
  Pressable wrapper (anything under `src/components/**` that renders a `Pressable`) must be added
  to `testIdElements` in `packages/config/src/eslint.js`, or the rule never sees its call sites.
  A wrapper that derives child ids from its own takes `testID: string` (required) and forwards
  `${testID}.<child>` unconditionally. `no-restricted-syntax` is not merged by
  ESLint, so `eslint.config.mjs` composes RTL + client-secret + testID into ONE array in ONE entry.
- A new screen ships with a smoke case, or `src/navigation/__tests__/smokeCoverage.test.ts` fails:
  it walks `app/**/*.tsx` against the checked-in table in `src/smoke/routes.ts`, and reads every
  `src/smoke/*.smoke.test.tsx` to check each table route is named by exactly one suite. A case
  names its `route`; the primary id comes from the table.
- Run `pnpm --filter @touch/mobile typecheck`, `lint`, `test` and `test:smoke`;
  `pnpm --filter @touch/mobile run doctor` after any dependency change (`run`: pnpm 9 has a
  `doctor` command of its own). Report the exact result.
