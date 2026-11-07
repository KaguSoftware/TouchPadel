# Brooks-Lint Review

**Mode:** Tech Debt Assessment
**Scope:** lane operator-core: `apps/operator/src/{components,lib,routes,ipc,main.tsx,gallery*.tsx}` (208 files, about 25.3k non-test lines) and `apps/operator-shell/src` (about 10.8k lines incl. tests). Read-only. The cycle check was `npx madge --circular` on `apps/operator/src`. Churn figures come from `git log` (355 commits touch `apps/operator/src`). No `.brooks-lint.yaml`, so defaults apply (balanced).
**Health Score:** 47/100

The operator shell holds together and is well tested. Its structural debt sits in a few change magnets: `routes/__root.tsx`, `lib/auth.tsx` + `lib/workspaces.ts`, `components/kit.tsx`, and the hand-mirrored IPC types. Adding one page or one permission means editing many hand-kept lists that only tests and regex parsers keep in sync.

---

## Findings

### 🟡 Warning

**R2 Change Propagation — Adding one page touches 8–12 files and repeats its path string 5–7 times (Warning)**
Symptom: A page has no single descriptor. It is registered in all of these places:
- the route file (`routes/wages.tsx:12-18`). The path is written twice there: `path: '/wages'` and `guarded('/wages', …)`.
- the import plus `addChildren` in `main.tsx:11-55,69-101`;
- `ROUTE_ROLES` (`lib/auth.tsx:229-347`);
- for admin, shop and stock pages, `SUB_ROUTES` (`lib/auth.tsx:350-408`). Its comment says it "drives the admin sub-nav", but no runtime code reads it any more. Only tests and the assistant-map script do (grep: `auth.test.ts:187,199`, `workspaces.test.ts:547`, `build-assistant-map.mjs:393`).
- a rail row in `WORKSPACES` (`lib/workspaces.ts:209-605`);
- the `NavLabelKey` union (`lib/workspaces.ts:50-95`);
- for owner pages, the hand-written if-ladder `workspaceForRoute` (`lib/workspaces.ts:707-726`). It re-states route→workspace facts that `WORKSPACES`/`workspaceOwnsPath` (`:855-858`) already hold.
- an icon (`components/icons.tsx`);
- `ws.shell.nav.*` in `shell.en.ts` and `shell.ar.ts`;
- `packages/db/fixtures/assistant-coverage.json`;
- for front-line pages, `ACCESS_AREAS` plus a migration.

Commit `7aea33d2` (adding `/rewards`) touched 9 such files and `34a36418` (`/files`) touched 13. `lib/auth.tsx` and `lib/workspaces.ts` changed together in 25 commits. No test checks the router tree against `ROUTE_ROLES`, or rail `to:` targets against real routes. `ROUTE_ROLES` is `Record<string, …>` and rail `to` is a plain `string`, not the router's typed path.
Source: Fowler, *Refactoring*: Shotgun Surgery. Ousterhout: Information Leakage.
Consequence: Every new screen pays a fixed tax of about 10 coordinated edits. A typo in any one list fails silently: default-deny shows a refusal, or a rail row hits NotFound. A route test or a click-through catches it, not `typecheck`.
Remedy: Introduce one `PAGES` descriptor per page: `{ path, roles, workspace, navLabelKey, icon, accessArea? }`. Derive `ROUTE_ROLES`, `SUB_ROUTES`, `workspaceForRoute` and the `NavLabelKey` union from it, and let the assistant map read it (see the regex finding below). Add a test that walks `router.flatRoutes` and asserts every path has a roles entry. Move `guarded`/`RoutePending` out of `routes/admin/_shared.tsx` (every top-level route imports it from there, e.g. `routes/wages.tsx:3`) into `routes/_guard.tsx`. Stale `TODO(FE2)` (`main.tsx:67`, since 2026-08-24): file-based routing would also remove the hand-kept `main.tsx` + `*/_children.ts` wiring.
Fix-Class: Residual. Cross-package (core `ACCESS_AREAS`, db scripts, i18n), and it changes exported tables.
Priority: Pain×Spread = 2×3 = 6
Intent: intentional (the steps are documented in `apps/operator/CLAUDE.md` "Roles and routes"). The duplication itself has no payback plan.

**R1 Cognitive Overload — `routes/__root.tsx` is a 2,093-line god module and the app's top churn hotspot (Warning)**
Symptom: The file holds the provider stack (`:111`), the workspace context that features import (`:201-221`), the shell, the rail (`WorkspaceNav` `:755-1112`, about 360 lines), the security-sensitive idle lock (`IdleLock` `:1153-1590`, about 440 lines, SEC-34/F-07, with its own `appRpc('has_own_pin')` `:1203` and `supabase.auth.signInWithPassword` `:1294`), `ExitFullscreen` (`:1591`), `QuitToDesktop` (`:1717`), `SignInScreen` (`:1842-2044`) and `RequireRole` (`:2064`). It imports 11 feature modules (`:81,93-103`). Three features import context back from it (`features/kds/KdsBoard.tsx:30`, `features/tasks/MyTasks.tsx:32`, `features/observation/DetailPanel.tsx:22`). It has changed in 65 of 355 operator commits (18%).
Source: Fowler: Large Class / Divergent Change. McConnell, *Code Complete* ch. 7.
Consequence: Changes to sign-in, idle-lock security, rail layout and the quit flow all land in one file. Reviews of security-relevant lock code get diluted by rail styling diffs, and parallel sessions keep colliding on it.
Remedy: Split by responsibility into `shell/IdleLock.tsx`, `shell/SignInScreen.tsx`, `shell/StationExit.tsx` (Quit + ExitFullscreen), `shell/WorkspaceNav.tsx`, and `lib/workspaceContext.tsx` (move `useWorkspace`/`useWorkspaceOrNull` out of the route module). Leave `__root.tsx` as provider composition plus `RequireRole`.
Fix-Class: Extended-Safe. Move-only, with the operator test suite as backstop. Do it in two passes of ≤5 files, and keep the exported names re-exported from `__root.tsx` until callers move.
Priority: Pain×Spread = 3×3 = 9
Intent: accidental

**R3 Knowledge Duplication — Permission decisions live in 8 hand-kept tables, and two of them disagree with `STAFF_ROLES` (Warning)**
Symptom: The places that decide who may do what:
- `ROUTE_ROLES` (`lib/auth.tsx:229`);
- `CAPABILITY_ROLES` (68 entries, `:487-713`);
- a second, older capability map: `Permissions`/`permissionsFor` (15 flags, `:777-845`, with its own `MANAGEMENT`/`SELLER_UP` lists at `:809,814`);
- a hand-written `requiredRoleFor(permission)` switch that must mirror `permissionsFor` (`:847-864`);
- `homeRoute` switch (`:730-764`);
- `workspacesForRole` switch (`lib/workspaces.ts:617-645`);
- a separate `ROLE_ORDER` for refusals in `routes/__root.tsx:2045-2062`, which omits `shop_staff` and `dev`;
- inline role tests: `lib/venue.tsx:187` (`staff?.role === 'owner'`), `features/till/tillData.ts:378`, `features/admin/staff/staffModel.ts:102`, `features/reports/ReportBranchScope.tsx:45`, `features/protocols/DecisionDialog.tsx:66`, `features/roleExtras/Ideas.tsx:193`.
Source: Hunt & Thomas: DRY. Brooks: Conceptual Integrity.
Consequence: Adding a role or reshaping a permission means walking up to eight places. The `ROLE_ORDER` copy has already drifted (see the bug finding below). `apps/operator/CLAUDE.md` calls `CAPABILITY_ROLES` "the one place to change a permission", but `Permissions` is a second one that new code still reads (56 `usePermissions`/`permissionsFor` references).
Remedy: Fold `Permissions` into `CAPABILITY_ROLES`, with `permissionsFor` derived as `can(who, key)` for each key. Derive `requiredRoleFor` for both routes and capabilities from one ordered list built from `STAFF_ROLES`, and move that into `lib/auth.tsx`. Replace the inline comparisons in the lane (`lib/venue.tsx:187`) with a capability such as `switchAnyBranch`.
Fix-Class: Residual. It changes exported API used by about 116 importers of `lib/auth`.
Priority: Pain×Spread = 2×3 = 6
Intent: accidental

**R2 Change Propagation — The assistant-map script parses `auth.tsx` and `workspaces.ts` with regexes and re-implements the route rule (Warning)**
Symptom: `packages/db/scripts/build-assistant-map.mjs:390-403` finds `ROUTE_ROLES` with `/export const ROUTE_ROLES[^{]*\{([\s\S]*?)\n\};/`. `:415-470` rebuilds the whole `WORKSPACES` tree with nested regexes, relying on literal shapes such as `const X: readonly NavTab[] = [ … ];`, the `{ to: '…', labelKey: '…'` property order, and `tabs: NAME`. `:406-412` re-implements the longest-prefix rule "the same rule auth.tsx applies" (`lib/auth.tsx:418-429`). The comment at `lib/workspaces.ts:39-41` admits the coupling.
Source: Winters et al., *Software Engineering at Google*: Hyrum's Law. Hunt & Thomas: DRY.
Consequence: The formatting and declaration style of two hot UI files (53 and 42 commits) is now an implicit contract. Reordering a property, inlining a tab list, or computing a list makes the map silently miss pages, or fail CI with a regen requirement. The project memory already records "route changes need a clean-worktree assistant-map regen or CI fails".
Remedy: Make the route/nav tables a pure, React-free module (e.g. `lib/pages.ts`, see the page-registration finding) and have the script import it through `tsx`/`esbuild` instead of regex-parsing it. Delete the script's `rolesForRoute` and call the real `canAccess`.
Fix-Class: Residual. Crosses the operator↔db-scripts boundary.
Priority: Pain×Spread = 2×2 = 4
Intent: intentional (documented) but tactical

**R3 Knowledge Duplication — IPC wire types are hand-mirrored in renderer and shell and have already drifted (Warning)**
Symptom: `apps/operator-shell/src/ipc-channels.ts` and `apps/operator/src/ipc/bridge.ts` each declare `MutationEnvelope`, `QueueStatus`, `AuthState`, `MutationResult`, `QueueRowInfo`, `KitchenTicket`, `StationInfo`, `LeaveResult`, `Role`, and more. Both still carry `TODO(W2)` from 2026-08-24 (`ipc-channels.ts:3`, `bridge.ts:5`, `preload/index.ts:28-29`). The preload object is not typed against `TouchBridge`. The drift is real:
- the shell's envelope has `venueScope?: string | null` (`ipc-channels.ts:194`), but the bridge's does not (`bridge.ts:11-26`), although `lib/mutate.ts:367,378` sends it;
- both sides declare `enqueue` as resolving `{ localId; state: 'queued' }` (`bridge.ts:261`, `preload/index.ts:32-33`), but main's `guardIpc` returns `{ error }` on a validation refusal (`main/index.ts:157-169,574-575`). So `lib/mutate.ts:381` has to cast the result to `{ localId?: string; error?: string }`;
- `LeaveResult.error` is a closed union in the shell (`ipc-channels.ts:349`) but `string` in the bridge (`bridge.ts:169`);
- `getCachedRef` returns `Promise<unknown>` in the preload (`preload/index.ts:71`) but `Promise<CachedRef | undefined>` in the bridge (`bridge.ts:274`).

The two files changed together in 21 commits. Only the `Role` union has a parity test (`packages/db/tests/staff-roles-parity.test.ts`).
Source: Hunt & Thomas: DRY. Fowler: Parallel Inheritance Hierarchies (parallel type trees).
Consequence: TypeScript gives false assurance at the till's most critical boundary (the durable sale queue). A refusal shape the renderer does not model is handled only because one cast remembers it, and the next IPC change can drift silently.
Remedy: Move the wire types to one shared, dependency-free module, either `packages/core/src/ipc/` or a tiny `@touch/operator-ipc` package. Type the preload object `satisfies TouchBridge`, and make `enqueue` return `EnqueueResult = { localId; state } | { error }`.
Fix-Class: Residual. Cross-package, touches the Electron build.
Priority: Pain×Spread = 2×2 = 4
Intent: intentional (TODO W2) with no payback date

**R4 Accidental Complexity — The shell's copies of `@touch/core` rest on a constraint that no longer exists (Warning)**
Symptom: The main process mirrors core code because "`@touch/core` is an ESM-only workspace package … so it cannot be a runtime dependency until the main process is bundled (a Wave 5 packaging item)" (`main/ipc-validate.ts:22-29`). The same reason is given for `main/ulid.ts:4-8` ("until it is bundled (A6)") and `main/pairing-code.ts:5`, and for the `Role` union (`ipc-channels.ts:261-280`) and `MUTATION_TYPES` (`ipc-validate.ts:62`). But `esbuild.config.mjs:1,23-34` now bundles main and preload ("design-arch.md §8, A6"), `package.json:8` builds with it, and `package.json:28` already declares `@touch/core` as a dependency.
Source: Ousterhout: Strategic vs Tactical Programming. Fowler: Duplicate Code.
Consequence: Four or five mirrors plus their drift tests are kept alive for a reason that was paid off. One of them is the shell's slot in the documented "six code copies" of mutation types. Each new mutation type or role still costs an extra edit and a parity test.
Remedy: Switch the shell's typecheck to `module: "preserve"` / `moduleResolution: "bundler"` (esbuild does the emit), import `MUTATION_TYPES`, `MANAGER_PIN_RE`, the ULID generator, `pairingCode` and `StaffRole` from `@touch/core`, and delete the mirrors and their parity tests. The mutation list shrinks from six copies to five, so update `apps/operator/CLAUDE.md` in the same change.
Fix-Class: Residual. Changes build config and a CLAUDE.md-documented rule.
Priority: Pain×Spread = 2×2 = 4
Intent: intentional, now stale

**R5 Dependency Disorder — `lib/` and `components/` have no layering rule; `lib` imports features and holds feature code (Warning)**
Symptom:
- `lib/navBadges.ts:13-28` imports 18 symbols from 11 feature modules: stock, ops, roleExtras, deductions, incidents, content, plan, wages.
- `lib/navAccess.ts:13-14` imports `features/deposits` and `features/matches`.
- `lib/edge.ts:21` imports `features/assistant/sse`.
- `components/RailMoreMenu.tsx:11` imports `features/assistant/AssistantDrawer`.
- In the other direction, feature-only modules sit in `lib`: `lib/analyticsApi.ts` (285 lines) is imported only by `features/analytics/**` (10 files), and `lib/assistantPricing.ts` only by `features/assistant/**` and `features/analytics/components/**`.
- `components/kit.tsx` exports a date helper that a pure data module imports (`features/stock/stockKeys.ts:12`).

Adding a badge means editing the `NavBadge` union (`lib/workspaces.ts:101-109`), a new `useQuery` in `useBadgeSum`, and a new term in its sum (`lib/navBadges.ts:47-130`).
Source: Martin, *Clean Architecture*: Stable Dependencies Principle and Open/Closed. Brooks: Conceptual Integrity.
Consequence: `lib` (116 importers of `lib/auth` alone) is not more stable than the features it imports, so a change inside one feature's `api.ts` can break the shell's badge code. Nobody can say from the tree what may import what. That is how the three madge cycles inside features formed (see "Looks bad but is fine"). Each badge is a three-place edit in two files.
Remedy: State a rule: `lib`/`components` → `@touch/*` only, and `features` → `lib`/`components`. Enforce it with `eslint-plugin-boundaries` or `no-restricted-imports`. Invert badges into a registry (`Record<NavBadge, { queryKey, fetch, count, capability? }>`) that each feature registers, so `useBadgeSum` loops over it. Move `analyticsApi.ts` to `features/analytics/api.ts`, `assistantPricing.ts` to `features/assistant/`, and `sse.ts` into `lib`.
Fix-Class: Residual for the registry inversion and lint rule. Extended-Safe for the file moves, one at a time.
Priority: Pain×Spread = 2×3 = 6
Intent: accidental

**R3 Knowledge Duplication — Three date-range vocabularies: core `analytics/range`, `kit.tsx` and `dateRangeLogic.ts` (Warning)**
Symptom: `packages/core/src/analytics/range.ts:10-177` has `DateRange`, `addDays`, `addMonths`, `resolveRange`, `RangePreset` and `CompareBasis`. `components/kit.tsx:1715-1755` re-declares `Period`, a private `isoDate`, `presetPeriod` with a different preset set, and `ComparisonMode = 'previousPeriod' | 'sameLastYear'` (`:1685`). `components/dateRangeLogic.ts:11-45` declares `Period` again, plus `addDaysIso` and a different `addMonths(YearMonth)`. `presetPeriod` counts from the station clock (`kit.tsx:1725-1727`), while core's `businessTodayISO` is venue-TZ and business-day aware. Callers must remember to pass `useBusinessDay().today` (`lib/settings.ts:200-211`), and `features/stock/stockKeys.ts:165` and `DateRangePicker.tsx:58-61` (`localToday`) do not.
Source: Hunt & Thomas: DRY. Evans: Ubiquitous Language (Period vs DateRange).
Consequence: A business-day bug fixed in core will not reach the kit presets. Between midnight and the business-day start hour, "today" on report screens can differ from analytics' "today". Today's only missed case (`fetchSummary`) is harmless because that RPC ignores the period (`stockKeys.ts:159-162`).
Remedy: Move `presetPeriod` into core next to `resolveRange`, taking `(preset, businessTodayISO)` with no default `new Date()`. Re-export one `DateRange` type and delete both `Period` copies and `addDaysIso`.
Fix-Class: Residual. It adds an export to `packages/core` and changes the `presetPeriod` signature (5 callers).
Priority: Pain×Spread = 2×2 = 4
Intent: accidental

**R1 Cognitive Overload — `components/kit.tsx` (2,532 lines, 68 exports) and `ui.tsx` (1,252 lines) are grab-bags with duplicated primitives (Warning)**
Symptom: `kit.tsx` mixes page layout (`PageHeader` `:41`, `Panel` `:151`), a full `DataTable` (`:748-1070`), domain status vocabularies (`:565-612`), date presets (`:1715`), governance prompts (`PinPromptOverlay` `:1846`, `ReasonCodePrompt` `:1905`), money (`:2306`) and bilingual editing (`:2354`). 278 files import it and 291 import `ui.tsx`, and both have about 37 commits. There are duplicates:
- `ui.tsx:940` `PinReasonModal` vs `kit.tsx:1846` + `:1905` (8 / 8 / 17 importers). `apps/operator/CLAUDE.md` names this as Q3.
- `inputs.tsx:263` `BilingualFields` (17 files) vs `kit.tsx:2354` `BilingualFieldPair` (5 files). The latter's doc comment says "The only route for editing a bilingual record", which is false.
- The domain `REASON_CODES` lists live in `ui.tsx:891-936`.
Source: Ousterhout: Deep vs Shallow Modules (a deep file is not a deep module). Fowler: Alternative Classes with Different Interfaces.
Consequence: A new screen author cannot tell which PIN/reason/bilingual primitive is canonical, so both keep gaining callers. Any kit edit invalidates every screen's chunk and widens review.
Remedy: Split `kit.tsx` into `kit/layout.tsx`, `kit/DataTable.tsx`, `kit/status.tsx`, `kit/governance.tsx`, `kit/money.tsx` and `kit/bilingual.tsx`, behind an `index.ts` barrel, so no import path changes. Pick one PIN+reason prompt and one bilingual field, deprecate the other with a lint ban, and move the reason codes to `governance.tsx`.
Fix-Class: Extended-Safe for the barrel split (no export renames, ≤5 files per pass). Residual for merging the duplicate primitives (prop shapes differ).
Priority: Pain×Spread = 2×3 = 6
Intent: accidental (Q3 is acknowledged, but no plan)

### 🟢 Suggestion

**R6 Domain Model Distortion — Bug: refusal copy names the wrong role for `/shop` and `/monitoring` (Suggestion)**
Symptom: `ROLE_ORDER` (`routes/__root.tsx:2045-2059`) lists 13 of the 15 `STAFF_ROLES` (`packages/core/src/staff/roles.ts:39-56`) and omits `shop_staff` and `dev`. `requiredRoleFor(route)` (`:2060-2062`) therefore returns `manager` for `/shop` (`ROUTE_ROLES['/shop'] = ['shop_staff','manager','owner']`, `lib/auth.tsx:247`). It falls back to `owner` for `/monitoring` (`['dev','owner']`, `:345`).
Source: Evans: Ubiquitous Language. Hunt & Thomas: DRY (a copied role list).
Consequence: A refused person is told to ask for a bigger role than needed. `apps/operator/CLAUDE.md` says the refusal should name "the smallest role".
Remedy: Build the order from `STAFF_ROLES` with an explicit rank map typed `Record<StaffRole, number>`, so a new role fails `typecheck`. Folding it into `lib/auth.tsx` belongs to the permission-tables finding.
Fix-Class: Safe. One file, a non-exported constant.
Priority: Pain×Spread = 1×1 = 1
Intent: accidental

**R3 Knowledge Duplication — `kit.tsx` re-declares core's status unions under different names (Suggestion)**
Symptom: `kit.tsx:565` `BookingStatus`, `:593` `TicketState` and `:600` `TabStatus` copy `ReservationStatus`, `TicketStatus` and `TabStatus` from `packages/core/src/status/machines.ts:11-20` word for word. Unknown values fall back silently (`kit.tsx:581-582` renders an unknown booking as `expired` tone).
Source: Evans: Ubiquitous Language. Hunt & Thomas: DRY.
Consequence: A new status added to core and the DB enum does not fail `typecheck` in the tone maps. It renders with a fallback tone.
Remedy: `import type { ReservationStatus, TicketStatus, TabStatus } from '@touch/core'`, keep the kit names as aliases, and let `Record<…, Tone>` enforce completeness.
Fix-Class: Safe. One file, and the exported names stay as aliases.
Priority: Pain×Spread = 1×2 = 2
Intent: accidental

**R3 Knowledge Duplication — "Is the shell present" is implemented five-plus times (Suggestion)**
Symptom: `lib/mutate.ts:52-54` `isElectron`, `lib/appRpc.ts:160-163` `inElectron`, `lib/offlinePin.ts:24-27` `inElectron`, `components/LeaveStation.tsx:24-26` `hasShell`, and four inline `window.touch` checks in `routes/__root.tsx:1604,1612,1733,1737`. `ipc/bridge.ts:463` already knows the answer.
Source: Hunt & Thomas: DRY.
Consequence: There is no single seam to fake the shell in tests or to change the detection (e.g. a preload version check).
Remedy: Export `hasShell()` from `ipc/bridge.ts` and replace the copies.
Fix-Class: Extended-Safe. 5 files, existing names kept as re-exports.
Priority: Pain×Spread = 1×2 = 2
Intent: accidental

**R3 Knowledge Duplication — PIN length rule written three times (Suggestion)**
Symptom: `lib/pinRules.ts:9-10` (`PIN_MIN = 4`, `PIN_MAX = 12`), `packages/core/src/schemas/mutations.ts:211` (`/^\d{4,12}$/`) and `apps/operator-shell/src/main/ipc-validate.ts:304` (`/^\d{4,12}$/`). The pinRules comment lists the others by hand.
Source: Hunt & Thomas: DRY.
Consequence: Changing the rule (as F-50 did on 2026-11-01) needs three coordinated edits plus the SQL.
Remedy: Export `PIN_MIN`/`PIN_MAX` from core, build `MANAGER_PIN_RE` from them, and re-export from `lib/pinRules.ts`. The shell copy goes away with the stale-constraint finding.
Fix-Class: Extended-Safe.
Priority: Pain×Spread = 1×2 = 2
Intent: accidental

**R1 Cognitive Overload — `lib/workspaces.ts` (941 lines) mixes nav data, matching algorithms and persistence (Suggestion)**
Symptom: It holds the rail tree data (`:209-614`), role→workspace policy (`:617-670`), localStorage persistence (`:672-701`), the route→workspace ladder (`:707-726`) and a scoring matcher (`EXACT_SCORE` `:806`, `navMatchScore` `:822`, `activeTab` `:903`). It has 42 commits.
Source: Fowler: Divergent Change.
Consequence: A label change, a matching bug and a storage change all touch one file, and the assistant-map regex depends on its exact layout.
Remedy: Split into `nav/tree.ts` (pure data, which the assistant map can import), `nav/match.ts` and `nav/storage.ts`, keeping a re-exporting `lib/workspaces.ts`.
Fix-Class: Extended-Safe.
Priority: Pain×Spread = 2×1 = 2
Intent: accidental

**R1 Cognitive Overload — The shell's `app.whenReady` callback is about 520 lines and wires 30 IPC handlers inline (Suggestion)**
Symptom: `apps/operator-shell/src/main/index.ts:521-1040` registers every `ipcMain.handle/on` (`:574-971`) with logic inline: the quit/exit PIN rules at `:844-888` and the supplier fetch at `:971`. Window state lives in module-level `WeakSet`s (`:176-209`). The file has 36 commits.
Source: McConnell, *Code Complete* ch. 7 (routine length).
Consequence: The process that holds the durable queue has its boundary rules spread through one long closure. The rules are tested only through the helper modules they call.
Remedy: Group handlers into `registerQueueIpc(deps)`, `registerStationIpc`, `registerLanIpc` and `registerExitIpc`, each in its own file with injected `station`/`queue`/`updater`. Keep `index.ts` as the composition root.
Fix-Class: Extended-Safe. Move-only, and the shell test suite exists.
Priority: Pain×Spread = 2×1 = 2
Intent: accidental

**R4 Accidental Complexity — The updater's state machine is 12 mutable flags in one 385-line closure (Suggestion)**
Symptom: `startUpdater` (`apps/operator-shell/src/main/updater.ts:111-495`) keeps `ready`, `launched`, `endStartupWait`, `startTried`, `startupAnswered`, `startCheckOut`, `installing`, `quitAnnounced`, `downloaded`, `squirrelHasIt` and others (`:141-170`) as `let`s mutated by about 15 inner arrow functions.
Source: Ousterhout: Strategic Programming. Fowler: Long Function.
Consequence: Legal state combinations are implicit. The 1,176-line test file (`updater.test.ts`) is what holds it together, and station-update regressions have happened before.
Remedy: Model it as an explicit `type UpdaterState = 'idle' | 'checking' | 'downloaded' | 'installing:start' | …` with a transition function, keeping the injected `opts` seams.
Fix-Class: Residual. Behaviour-sensitive, release-critical.
Priority: Pain×Spread = 2×1 = 2
Intent: accidental

**R4 Accidental Complexity — Dead `ScreenScaffold`, plus stale TODO and comment (Suggestion)**
Symptom: `components/kit.tsx:474-481` `ScreenScaffold` ("Placeholder for a screen a lane has not built yet") passes the dead-code gate. `grep -rn ScreenScaffold` over the whole repo (apps, packages, e2e, scripts, docs, qa, json fixtures) returns only its definition. `main.tsx:67` `TODO(FE2) … once typed search params land` dates from 2026-08-24, but typed search params have landed (24 `validateSearch` in `routes/`). The `SUB_ROUTES` comment "drives the admin sub-nav" (`lib/auth.tsx:349`) is stale (see the page-registration finding).
Source: Fowler: Speculative Generality / Dead Code.
Consequence: These mislead the next reader about how routing and sub-nav work.
Remedy: Delete `ScreenScaffold`. Either schedule FE2 (file-based routing) or delete the TODO. Reword the `SUB_ROUTES` comment to "inventory for the assistant map and tests".
Fix-Class: Extended-Safe (it removes an app-internal export, in a single file).
Priority: Pain×Spread = 1×1 = 1
Intent: accidental

---

## Top offenders

| File | Lines | What's tangled |
|---|---|---|
| `apps/operator/src/components/kit.tsx` | 2,532 | 68 exports: layout, DataTable, status vocab, date presets, PIN/reason prompts, money, bilingual. Duplicates `ui.tsx`/`inputs.tsx` primitives. 278 importers. |
| `apps/operator/src/components/GlobalStyles.tsx` | 2,095 | One CSS template string (649 selectors). 48 commits. RTL lint cannot read it (hand-checked; clean today). |
| `apps/operator/src/routes/__root.tsx` | 2,093 | Providers + workspace context + rail + idle lock (SEC-34) + sign-in + quit + guard. Imports 11 features. 65/355 commits. |
| `apps/operator/src/components/ui.tsx` | 1,252 | Button/Field/Modal/Select plus domain reason codes and `PinReasonModal`. 291 importers. |
| `apps/operator-shell/src/main/index.ts` | 1,060 | About 520-line `whenReady` closure with 30 inline IPC handlers. Module-level window state. |
| `apps/operator/src/lib/workspaces.ts` | 941 | Nav tree data + role policy + matcher scoring + localStorage + route ladder. Regex-parsed by a db script. |
| `apps/operator/src/lib/auth.tsx` | 870 | `ROUTE_ROLES`, `SUB_ROUTES`, `CAPABILITY_ROLES` and `Permissions`: two capability systems, three role switches. 53 commits. |
| `apps/operator-shell/src/main/updater.ts` | 761 | 385-line closure with 12 mutable state flags. |
| `apps/operator/src/ipc/bridge.ts` + `apps/operator-shell/src/ipc-channels.ts` | 463 + 393 | Hand-mirrored wire types (21 co-change commits), with drift on `venueScope`, `enqueue` result and `LeaveResult`. |
| `apps/operator/src/lib/navBadges.ts` | 131 | Small, but fan-out to 11 feature modules. Every badge is a three-place edit. |

## Looks bad but is fine

- **Six copies of the mutation-type list** (`apps/operator/CLAUDE.md` "Writes"). The list is required by repo rules, has a canonical JSON (`_shared/mutation-types.json`) and is drift-tested (`mutate.test.ts`, `queueResults.test.ts`, `dayCloseLogic.test.ts`, `ipc-validate.test.ts`). It is not debt in itself; the stale-constraint finding above only removes the shell's copy.
- **`components/QueueFailureToasts.tsx:22` imports `features/admin/dayCloseLogic`.** CLAUDE.md puts `QUEUE_WRITE_KEY` there on purpose.
- **`lib/appRpc.ts:165-189` hands work to `lib/queuedRpc.ts`, registered by a side-effect import in `main.tsx:9`.** It looks like hidden temporal coupling, but it is a deliberate break of the `mutate → appRpc` cycle and documented at both ends. It degrades safely (`if (!offlineQueue) throw new TypeError('Failed to fetch')`, `appRpc.ts:188`).
- **madge reports 7 cycles.** None are in this lane's runtime graph. Two are type-only or core-internal (`packages/core/staff/roles ↔ access`, `packages/ui tokens`). One is `import type` (`features/admin/coaches/CoachesAdmin.tsx:30 → routes/admin/coaches.tsx`). Four are inside features (dayClose↔tillShift, analytics charts, protocols StepForm↔contextLogic, stock receipts) and belong to the feature lanes. The routes ↔ features back-edges (`useWorkspace`) are not cycles because routes load features lazily.
- **`__root.tsx` fan-out of about 50 imports.** It is the composition root, and high fan-out there is expected. The finding is about mixed responsibilities, not imports.
- **`lib/errors.ts`** looks like a duplicate error map. It derives `MAPPED_CODES` from the shared `ERROR_CODE_KEYS` in `@touch/i18n` and only adds the transport rule.
- **`lib/settings.ts` business day** correctly uses core's `businessTodayISO`/`normalizeBusinessDayStart`.
- **IPC channels.** Every `IPC.*` key (32) is used by both preload and main (checked one by one). There are no orphan channels; the debt is the type mirror, not the channel set.
- **`gallery.tsx` / `galleryWizard.tsx`.** These are not dead: `gallery.html:16` loads them as a dev-only surface, and they are not in the app bundle.
- **`allowedRoutes` / `allowedSubRoutes` (`lib/auth.tsx:464-474`).** No production caller, but they are referenced in tests, `docs/design/cafe-rebuild/*.md` and `assistant-map.json`, so they fail the dead-code gate. Not reported as dead.
- **`GlobalStyles.tsx` size.** It is one string by design (states, keyframes, print). A grep for physical properties (`margin-left`, `left:`, `text-align: left`, and similar) found none, so the hand-checked RTL promise holds today.
- **`routes/desk/_children.ts:63-80` hand-validates search params.** It looks like duplication of zod, but it is intentionally kept out of the lazy feature chunk (comment `:31-33`) and is small.
- **The `supabase.ts` demo anon key** is the public `supabase start` default, gated to dev builds (`:15-25`).

## Debt Summary

| Risk | Findings | Avg Priority | Classification | Intent |
|------|----------|-------------|----------------|--------|
| Cognitive Overload      | 4 | 4.75 | Scheduled | accidental |
| Change Propagation      | 2 | 5.0 | Scheduled | intentional (documented, no payback plan) |
| Knowledge Duplication   | 6 | 3.3 | Monitored→Scheduled | mostly accidental; IPC mirror intentional (TODO W2) |
| Accidental Complexity   | 3 | 2.3 | Monitored | intentional-but-stale (shell mirrors) / accidental |
| Dependency Disorder     | 1 | 6.0 | Scheduled | accidental |
| Domain Model Distortion | 1 | 1.0 | Monitored | accidental (bug) |

**Recommended focus:** Change Propagation and Dependency Disorder. Build one `PAGES` descriptor that the router, guards, rail and assistant map all derive from, and add a lint-enforced `lib`/`components` → features ban. Next, split `__root.tsx` (it has the highest single Pain×Spread, 9) and unify the IPC types now that the shell is bundled.

## Summary

The most valuable change is one page/permission descriptor. The tables `ROUTE_ROLES`, `SUB_ROUTES`, `WORKSPACES`, `workspaceForRoute`, `ROLE_ORDER` and `Permissions` would all derive from it, and the assistant-map script would import it instead of regex-parsing two hot files. That removes most of the 8–12-file cost of a new page and the role-list drift already seen in `ROLE_ORDER`. The IPC boundary is sound at runtime: channels are complete and validated in main. But its types are mirrored by hand and have drifted, and the reason given for the shell's core mirrors (no bundling) has already been paid off. Splitting `__root.tsx` and `kit.tsx` is safe, move-only work with good test cover.

Score: 100 − 9×5 (Warning) − 8×1 (Suggestion) = **47**. Counts: Critical 0, Warning 9, Suggestion 8 (one of them a genuine bug: the `ROLE_ORDER` refusal copy).
