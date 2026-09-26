# apps/mobile — rules for every change

The guest app: Expo SDK 57 with expo-router screens under `app/` and feature code under
`src/features/{auth,availability,booking,boot,courtTransition,profile,staff}`. Written 2026-09-20 (Phase
2, Milestone 0 item 12) from `PHASE-2-PLAN.md` Part A5 plus the 09-20 code verification.
Database-side rules are in `packages/db/CLAUDE.md`.

The same app is the staff phone for a signed-in staff account (`app/staff*.tsx`,
`src/features/staff`): `StaffStatusProvider` decides guest or staff, `GuestTabsGate` keeps a staff
session out of the tabs, and a guest renders exactly as before. The binding shapes (routes, query
keys, the status table, the no-station-RPC rule) are
`docs/design/protocols/build-contracts-2026-09-23.md` §6 and §7.

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
- `isTransportError` (`src/lib/network.ts:66`) decides what `src/lib/queryClient.ts` retries; a
  P0001 business error is never retried and never shown as "offline".
- Auth links: only the code-exchange path in `src/features/auth/deepLink.ts`. The raw-tokens branch
  is S6 and goes in Milestone 0 item 6, as does the `app/reset-password.tsx` guard (render only
  after a recovery exchange in this session). Do not build on either.

## Queries

- Query keys are families exported next to their hooks: `availabilityKeys`, `bookingKeys`,
  `profileKeys` (`src/features/*/hooks.ts`) and `historyKeys` (`src/features/booking/history.ts`).
  Extend a family; never inline a key array in a component.
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
  asserts key parity.

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
  with `(tabs)/index` → `book`, `booking/[id]` → `booking-detail`, `(tabs)/_layout` → `tabs`.
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
  `pnpm --filter @touch/mobile doctor` after any dependency change. Report the exact result.
