# Brooks-Lint Review

**Mode:** Tech Debt Assessment
**Scope:** Lane `shared-and-web`: `packages/core` (non-test ~15.6k lines in 19 modules), `packages/ui`, `packages/court3d`, `packages/config`, `packages/i18n` (code and structure only, no translation strings), `apps/web` (27.3k non-test lines, 38k with tests), root `scripts/`, `turbo.json`, `tsconfig*.json`. Cross-app greps of `apps/*` for logic that duplicates core. No `.brooks-lint.yaml`, so defaults apply (balanced, all risks on). Read-only: nothing in the repo was edited.
**Health Score:** 45/100

The shared packages respect dependency direction and core's money maths is reused properly, but "single source of truth" holds only for money and pricing. Statuses, roles, venue-local dates, enums and bilingual picking are re-decided across the apps, and two package-root barrels (`@touch/i18n`, `@touch/core`) send operator-only code and strings to every public web page.

---

## Answers to the lane's key questions

1. **Is `packages/core` the single source of truth?** Partly.
   - **Money: yes.** Web basket and preview maths go through `addIqd`/`mulIqd`/`sumIqd`/`applyPctDiscountIqd` (`apps/web/src/lib/cafe/basket.ts:1,53-95`, `apps/web/src/components/cafe/ItemSheet/selection.ts:1,90-118`). The operator till uses `subIqd`/`splitEvenly` (`apps/operator/src/features/till/change.ts:5,20-22`, `apps/operator/src/features/matches/startMatchLogic.ts:12,198`).
   - **Pricing: yes.** The mobile grid prices with core `resolveRateRule` (`apps/mobile/src/features/availability/assemble.ts:13,218`).
   - **Status: no.** The core state machines have no production consumer, and four apps redeclare the unions and transitions (W3).
   - **Time: no.** The venue-local date is re-derived 13 times instead of using `localParts` (W4).
   - **Staff roles: half.** `STAFF_ROLES`/`StaffRole` are shared, but "management = owner|manager" is redeclared 10+ times (W6).
2. **Exported-but-unused core APIs?** By the strict gate (no hit anywhere, docs included), only ~26 exported *types* are fully dead. Another 30 runtime exports have no production consumer and appear only in their own tests and, for some, in design docs. They are listed in S2 with the grep. Of the 755 core exports, 257 are not referenced outside core. Most of those are used inside core, which is fine.
3. **Does any package import from an app?** No shared package does. `core`, `ui`, `court3d`, `i18n` and `config` import no app and no other workspace package except `@touch/config` (dev). `packages/db` tests do, in 4 files: 2 read operator sources as text for parity (fine), and 2 import operator modules (S9).

---

## Findings

### 🟡 Warning

**W1 · R5 Dependency Disorder: one `Messages` tree for all apps puts the operator's and staff's strings on every public web page (Warning)**
Symptom: `packages/i18n/src/t.ts:1-3,14` builds `catalogs = { en, ar }` from the root catalogs. `packages/i18n/src/catalogs/en.ts:7-8,31,2597` folds in `wsEn` (the operator workspaces, `catalogs/ws` is 1.5 MB of source) and `staffEn`. Any web client component that calls `t`/`makeT` therefore bundles every app's strings in both languages. 41 `'use client'` files in `apps/web` import the `@touch/i18n` root. The built artifact (`apps/web/.next`, build of 2026-10-29) shows the effect:
- `diagnostics/route-bundle-stats.json` gives first-load JS of 2.62 MB for `/[locale]/menu` and 2.12–2.52 MB for every other route.
- Each of those routes loads `static/chunks/2tfoyjh7ohc-m.js`, which is 1.66 MB (484 KB gzip).
- That chunk contains operator-only text: the cashier string "Pick the tab everything moves into, then the tab that closes." (`catalogs/ws/cashier.en.ts`), its Arabic twin, and the analytics line `{returning} returning · {fresh} new` (`catalogs/ws/analytics.en.ts:82`).

The team already knows about the coupling. `apps/web/src/lib/site/openNow.ts:1-2` imports `@touch/i18n/formatting` "because the package index re-exports both full message catalogs", but that workaround protects one file out of 42.
Source: Martin, Clean Architecture: Interface Segregation / Common Reuse Principle. Ousterhout, Information Leakage.
Consequence: guests on phone data download about 0.5 MB gzip of strings they will never see before the café menu becomes interactive. Every new operator screen makes the public site heavier, which is change propagation across an app boundary. Internal staff wording is also published on the public origin.
Remedy: split the catalogs by audience (for example `site`/`cafe`/`legal`/`errors` for web, `ws`/`staff` for operator and staff) behind per-app entry points (`@touch/i18n/web`, `@touch/i18n/operator`), each with its own `Messages` type and `t`. Keep the key-parity test per catalog. Interim step: a web-only `makeT` over `{site, cafe, legal, coaching.web, matches.web, loyalty.web, errors}` sub-trees.
Fix-Class: Residual. This changes the public API of a shared package used by three apps.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**W2 · R5 Dependency Disorder: the `@touch/core` root barrel pulls zod and the operator's till-mutation schemas into the web client bundle (Warning)**
Symptom: `packages/core/src/index.ts:12` does `export * from './schemas/mutations'`, the zod schemas for the operator's offline till queue (manager-PIN adjustments, refunds, voids). `packages/core/package.json` has no `sideEffects: false`, so top-level `z.object(...)` calls cannot be dropped. Six web client modules import the root:
- `apps/web/src/hooks/cafe/useSessionChannel.ts:4`
- `apps/web/src/components/cafe/Hero/HeroFeatured.tsx:5`
- `apps/web/src/components/cafe/MenuCard/MenuCard.tsx:6`
- `apps/web/src/components/cafe/ItemSheet/selection.ts:1`
- `apps/web/src/components/legal/DeleteAccountForm.tsx:6`
- `apps/web/src/components/account/MemberCardView.tsx:4`

The first-load chunk `0z-_xbwizk8m9.js` (349 KB, loaded by `/[locale]/menu`) contains `ZodError` and the adjustment schema itself (`kind:enum(["discount_percent","discount_amount"]),tabId:…,pin:…,reasonCode:…`). `apps/web/package.json` does not depend on zod, so it can only arrive through core.
Source: Martin, Clean Architecture: Common Reuse Principle (whatever depends on one class of a component depends on all of it).
Consequence: the guest bundle grows with every operator-side schema added to core, and the public site ships the shape of manager-PIN RPC payloads. That shape is not secret, but it is needless exposure.
Remedy: (a) switch the six web imports to the subpaths core already exports through `"./*"` (`@touch/core/money/iqd`, `@touch/core/money/discount`, `@touch/core/net/resilientChannel`, `@touch/core/phone/iraq`). (b) Add `"sideEffects": false` to `packages/core/package.json`. (c) Longer term, move `schemas/mutations` out of the root barrel, since only the operator and the shell use it.
Fix-Class: Extended-Safe for (a)+(b): no exported symbol changes, and web tests plus `test:smoke` exist. (c) is Residual.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**W3 · R3 Knowledge Duplication: core's status machines have no production consumer, and the apps redeclare statuses and transitions (Warning)**
Symptom: `packages/core/src/status/machines.ts:10-105` defines `OrderStatus`, `TicketStatus`, `ReservationStatus`, `TabStatus` and their legal edges. Its header says "clients use the same tables to enable/disable buttons". Gate result: `orderStatusMachine`, `ticketStatusMachine`, `reservationStatusMachine` and `tabStatusMachine` appear only in `machines.ts` and `machines.test.ts`. Meanwhile:
- `apps/operator/src/features/kds/ticketView.ts:193-202` keeps its own `TRANSITIONS` table ("mirrors app.set_ticket_status's transition table").
- `apps/operator/src/components/kit.tsx:600` redeclares `TabStatus`.
- `apps/operator/src/features/till/kitchenReach.ts:28` redeclares `TicketStatus` as `CloudTicketStatus`.
- `apps/web/src/hooks/cafe/orders.ts:6,29,43,50-56` redeclares `OrderStatus` as `GuestOrderStatus`, plus the live set and a rank table.
- `apps/operator/src/features/till/TabDetailPanel.tsx:555` inlines `['sent','preparing','ready']`.

Source: Hunt & Thomas, The Pragmatic Programmer: DRY. Fowler, Refactoring: Duplicate Code / Alternative Classes with Different Interfaces.
Consequence: adding a status, which happens with each new migration, needs edits in SQL, core and at least four app files, and nothing type-links them. Core's copy is the one most likely to rot silently, because no runtime path uses it.
Remedy: make core the producer. Export the unions plus small derived sets (`LIVE_ORDER_STATUSES`, `canTransition`) and import them in `ticketView.ts`, `kit.tsx`, `kitchenReach.ts` and `orders.ts`. If the apps truly need only the unions, delete the unused machine objects rather than keep a fourth copy alive.
Fix-Class: Residual. The change crosses three apps.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**W4 · R3 Knowledge Duplication: "the venue's calendar date and weekday" is re-derived in 13+ places instead of using core `localParts` (Warning)**
Symptom: `packages/core/src/time/tz.ts:65-84` already returns `{date:'YYYY-MM-DD', dayOfWeek, minutesOfDay}`, memoised and DST-safe, and 18 files outside core use it. The apps still spell `toLocaleDateString('en-CA', {timeZone})` or `Intl.DateTimeFormat('en-CA', …)` themselves:
- `apps/web/src/lib/site/openNow.ts:31-45`
- `apps/web/src/lib/cafe/hours.ts:41-42`
- `apps/web/src/components/site/SiteFooter.tsx:66`
- `apps/operator/src/features/deductions/venueDate.ts:17,53`
- `apps/operator/src/features/desk/useTradingNight.ts:29`
- `apps/operator/src/features/desk/weekLogic.ts:44-49`
- `apps/operator/src/features/desk/CourtBlock.tsx:376`
- `apps/operator/src/features/assistant/usageDates.ts:13`
- `apps/operator/src/features/admin/promotions/promotionLogic.ts:56`
- `apps/operator/src/features/marketing/marketingTypes.ts:135`
- `apps/operator/src/features/loyalty/loyaltyLogic.ts:262`
- `apps/operator/src/features/observation/activity/activityLogic.ts:82`
- `apps/operator/src/features/tournaments/TournamentDetail.tsx:344`
- `apps/operator/src/features/admin/OpeningHoursEditor.tsx:151`
- `scripts/create-review-account.mjs:190-193`, which hard-codes `+ 3 * 3600_000`.

Eleven app files also spell `'Asia/Baghdad'` (for example `apps/mobile/src/features/availability/assemble.ts:100`, `apps/mobile/src/features/matches/logic.ts:1134`) instead of `VENUE_TZ` (`packages/i18n/src/formatting.ts:27`). `formatting.ts:5-10` declares itself "the ONLY sanctioned way" to render dates and numbers, but the operator builds `Intl` formatters directly (`apps/operator/src/features/analytics/format.ts:51-62`, `apps/operator/src/features/reports/drillWords.ts:91,169`, `apps/operator/src/features/observation/ObserveDateBar.tsx:24`). Nothing lints the rule.
**Genuine bug (minor):** `OpeningHoursEditor.tsx:151` passes `timeZone: settingsQ.data?.timezone ?? undefined`, so "today" is read in the *device* zone until settings load.
Source: The Pragmatic Programmer: DRY. McConnell, Code Complete Ch. 12 (magic constants).
Consequence: every copy owns the day-boundary and DST decision separately, which is exactly the problem core's `openingHours.ts:19-24` says it was created to end. Multi-branch time zones (`venue_settings.timezone`) have to be threaded through 13 sites.
Remedy: add `venueDate(instant, tz)` and `venueDayKey(instant, tz)` (thin wrappers over `localParts`) plus a `DEFAULT_VENUE_TZ` to core `time/tz.ts`, and replace the copies. Then add a `no-restricted-syntax` rule in `packages/config/src/eslint.js` against `toLocaleDateString` and `new Intl.DateTimeFormat` outside `packages/i18n` and `packages/core/src/time`.
Fix-Class: Residual overall, since it crosses apps. Each app's batch of 5 files or fewer is Extended-Safe.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**W5 · R3 Knowledge Duplication: web `openNow.ts` duplicates `cafe/hours.ts` and re-states core's overnight-tail rule differently (Warning)**
Symptom: `apps/web/src/lib/site/openNow.ts:14-27,29-46,54-56` copies `DAY_KEYS`, the defensive window parser, the venue-clock read and `nextDay` from `apps/web/src/lib/cafe/hours.ts:22-23,37-49,59-61,78-87`. The overnight rule is re-implemented as `from !== '00:00'` (`openNow.ts:78`). Core's `isOvernightTail` (`packages/core/src/time/openingHours.ts:44-46`) also requires the window to end before 24:00, so a full day `["00:00","24:00"]` counts as an opening in core and is skipped by the web pill. The two web copies also diverge on failure: `hours.ts:40-46` falls back on an `Intl` throw, while `openNow.ts:31-41` throws. The root cause is W1: `hours.ts:1` imports `VENUE_TZ` from the i18n root, so the client pill could not reuse it.
Source: The Pragmatic Programmer: DRY. Refactoring: Duplicate Code.
Consequence: a change to opening-hours storage, such as the next "split night" fix, has to be made in core, `hours.ts` and `openNow.ts`, and the footer and the pill can disagree about whether the venue is open.
Remedy: move `venueClock` and the open-state check into core `time/openingHours.ts` (`openStateAt(hours, closedDates, now, tz)`, built on `localParts` and `isOvernightTail`). Make `hours.ts` and `openNow.ts` thin callers that import through the `@touch/core/time/openingHours` subpath, which is client-safe and carries no catalogs.
Fix-Class: Extended-Safe. Three files, no exported signature change, `site-lib.test.ts` exists.
Priority: Pain 2 × Spread 1 = 2
Intent: accidental

**W6 · R3 Knowledge Duplication: the "management = owner or manager" role set is declared more than 10 times (Warning)**
Symptom: `packages/core/src/staff/roles.ts` owns `STAFF_ROLES`, `TEAM_HEAD` and `teamOf`, but not the management set. Core itself keeps a private copy (`packages/core/src/protocols/steps.ts:64`). Further copies:
- `apps/operator/src/lib/auth.tsx:809`
- `apps/operator/src/features/admin/staff/staffModel.ts:102`
- `apps/operator/src/features/till/tillData.ts:378`
- `apps/mobile/src/features/staff/teachings/logic.ts:25,34`
- `apps/mobile/src/features/staff/protocols/logic.ts:43-46` (a second exported `isMgmt`)
- `apps/mobile/src/features/staff/rows.ts:296`
- `apps/mobile/src/features/staff/deductions/logic.ts:20`
- `apps/mobile/src/features/staff/recipes/logic.ts:46`
- `apps/mobile/src/features/staff/suggestions/logic.ts:17`

Across `apps/*` there are 50 inline `role === '…'` checks in 32 files.
Source: The Pragmatic Programmer: DRY. Evans, DDD: Ubiquitous Language (`MGMT`, `MGMT_ROLES`, `MANAGEMENT` and `isMgmt` all name one concept).
Consequence: the next role that should count as management (for example an "assistant manager", the way `dev` arrived in 0392) is a 10-file hunt across two apps. A missed copy silently hides a screen or shows one, and the server's `verify_manager_pin` role filter is the only safety net.
Remedy: export `MANAGEMENT_ROLES` and `isManagement(role)` from core `staff/roles.ts`, have `protocols/steps.ts` use it, and replace the app copies. Extend `packages/db/tests/staff-roles-parity.test.ts` to compare it with the SQL guard.
Fix-Class: Residual. The change crosses apps.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**W7 · R3 Knowledge Duplication: closed enums and rules redeclared next to core's own exports (`DAY_KEYS`, lesson kinds, tournament format/category/status/cut-off) (Warning)**
Symptom:
- **`DAY_KEYS`:** core exports only the `DayKey` type (`packages/core/src/availability/slotGrid.ts:40`), so the list is written out 16 times. Examples: `apps/web/src/lib/site/openNow.ts:14` and `apps/web/src/lib/cafe/hours.ts:22` (Monday-first), `apps/operator/src/features/admin/rateRuleLogic.ts:136`, `apps/operator/src/features/checklists/checklistLogic.ts:41`, `apps/operator/src/features/admin/promotions/promotionLogic.ts:306`, `apps/mobile/src/features/availability/assemble.ts:102` and `apps/mobile/src/features/matches/logic.ts:1143` (Sunday-first).
- **Lesson kinds:** `['private','group','course']` appears in `apps/web/src/lib/coaching.ts:30-34`, `apps/mobile/src/features/coaching/logic.ts:38`, `apps/mobile/src/features/coach/logic.ts:51` and `apps/operator/src/features/coaching/lessonPayloads.ts:68`. Core coaching exports `COACH_LEVELS` but not the kinds.
- **Tournaments:** `apps/web/src/lib/tournaments.ts:35-41` redeclares `TourFormat`, `TourCategory`, `TourStatus` and their arrays, which `packages/core/src/tournaments/types.ts:12-21` already exports as `TOUR_FORMATS`/`TOUR_CATEGORIES`/`TOUR_STATUSES`. `registrationOpen` (`tournaments.ts:458-467`) restates the cut-off rule of mobile `tourActionOf` (`apps/mobile/src/features/tournaments/logic.ts:536-538`), and its own comment says it "judges the cut-off the same way".

Source: The Pragmatic Programmer: DRY. Refactoring: Parallel Inheritance Hierarchies (parallel enum lists).
Consequence: a new tournament status or lesson kind needs coordinated edits in core, web, mobile and operator. Web's parser drops rows with an unknown enum, so a missed copy makes tournaments or lessons quietly vanish from the public site rather than fail loudly.
Remedy: export `DAY_KEYS` (Sunday-first, matching `dow`) and `LESSON_KINDS`/`LESSON_PAYMENT_MODES` from core. Have web import `TOUR_*` from `@touch/core/tournaments`, which web already uses for coaching, and move the cut-off predicate into `core/tournaments` (`registrationIsOpen(status, closesAt, nowMs)`) for both web and mobile.
Fix-Class: Extended-Safe for the web part (2 files, tests pin the keys). Residual for mobile and operator.
Priority: Pain 1 × Spread 3 = 3
Intent: accidental

**W8 · R1 Cognitive Overload: `buildCourtScene` is one 718-line function (Warning)**
Symptom: `packages/court3d/src/scene.ts:346-1063` builds, in one closure, the ground, lines, net, cage, glass and windows, the mesh fence, rackets, drill props, join-scene spot marks, ball, shadow caster, trail and disc. It also branches on three scene kinds (`rally`/`drill`/`join`, `:118`), two views (`book`/`top`) and three host profiles (`lean` Android, iOS, web `mergeOpaqueOnly`, see the merge comment around `:636-659`), and returns the per-frame `update`. Indentation reaches 5 levels. The file is 1,143 lines, and both apps draw it (`apps/web/src/features/court3d/courtCanvas.ts`, `apps/mobile/src/components/Court3D.tsx`).
Source: Fowler, Refactoring: Long Method. McConnell, Code Complete Ch. 7.
Consequence: each owner-requested visual tweak (the comments record several, dated 2026-09-29) means editing inside a 700-line scope where a line can affect three scene kinds and three hosts. Performance work such as merging and instancing has to reason about the whole function.
Remedy: extract internal, non-exported builders (`buildGround`, `buildCage(opts)`, `buildRacketRigs`, `buildBallOverlay`, `buildTrail`) that return `{object, update?, dispose}`, and compose them in `buildCourtScene`. Keep the exported signature identical. `__tests__/scene.test.ts` (675 lines) and the pixel-diff recipe cover the refactor.
Fix-Class: Extended-Safe. One file, no exported-signature change, tests pass before the change.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**W9 · R5 Dependency Disorder: root scripts copy their HTTP and env helpers and read the service-role key from `apps/web/.env.local` (Warning)**
Symptom: `scripts/create-review-account.mjs:77-131` and `scripts/create-staff-review-account.mjs:65-119` are line-for-line copies (`envFromFile`, `call`, `makePassword`; a diff shows only two comment lines differing). `scripts/create-operator-owner.mjs:39-61` is a third variant. All three load `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local` (`create-operator-owner.mjs:48-51`, `create-review-account.mjs:87-89`, `create-staff-review-account.mjs:75-79`), and their error message tells the operator to put it there. `apps/web/CLAUDE.md` ("Data") says "The service-role key never reaches this package". Next loads `.env.local` into the web server's `process.env`. It is not `NEXT_PUBLIC_`, so the browser never gets it, but it then sits in the one package that is meant never to have it. The current file has no such line.
Source: Clean Architecture: Dependency direction (ops tooling depending on an app's private config). The Pragmatic Programmer: DRY.
Consequence: following the scripts' own instructions breaks a security rule. The three scripts also drift independently when the auth API changes.
Remedy: give the scripts their own env source (`scripts/.env.local`, git-ignored, or `packages/db/.env`). Extract `scripts/lib/admin.mjs` (`envFromFile`, `call`, `makePassword`, `signInAs`), and use core-style venue-date logic instead of the `+3h` offset.
Fix-Class: Extended-Safe. Four files, no exported API.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

### 🟢 Suggestion

**S1 · R3 Knowledge Duplication: two exported `formatIQD`s with different output (Suggestion)**
Symptom: `packages/core/src/money/format.ts:21-40`, exported from the core root (`packages/core/src/index.ts:8`), renders `"IQD 15,000"` / `"‏15,000 د.ع.‏"` via `Intl` with the `ar-IQ` tag. `packages/i18n/src/formatting.ts:237-243` renders `"15,000 IQD"` from its own tables. `formatting.ts:11-18` records that very `ar-IQ` tag as broken on Hermes. Gate: 178 imports come from `@touch/i18n`, none from core except `money.test.ts:4`.
Source: Refactoring: Alternative Classes with Different Interfaces. DDD: Ubiquitous Language.
Consequence: an editor auto-import of `formatIQD` from `@touch/core` compiles and prints a different string, with Persian-digit risk on Android.
Remedy: delete `money/format.ts` (and `MoneyLocale`, `FormatIqdOptions`) from core, or rename it `formatIqdIntl` and drop it from the barrel.
Fix-Class: Residual. It removes an exported symbol, though no consumer exists.
Priority: Pain 1 × Spread 3 = 3
Intent: accidental

**S2 · R4 Accidental Complexity: core runtime exports with no production consumer (Suggestion)**
Symptom: from the dead-code gate (`rg -l -w -F <name> --hidden` over the whole repo, excluding the generated `assistant-map.json`), these appear only in their own module and its test, sometimes also in a design doc:
- the four status machines (`status/machines.ts:71,79,87,100`)
- `calcTaxIqd` (`money/tax.ts:10`)
- `splitByItems` (`money/split.ts:39`)
- `ZERO_IQD` (`money/iqd.ts:52`)
- `pickBestPromotion` (`money/promotion.ts:52`)
- `isGeneratedPromoCode` (`money/promotion.ts:69`)
- `withRequestTimeout` (`net/timeout.ts:112`)
- `gridLabel` (`time/openingHours.ts:38`)
- `MOVE_KINDS` and `countKindsFor` (`staff/stores.ts:58,115`)
- `isValidScore` (`tournaments/score.ts:11`)
- `regenerateFrom` (`tournaments/regenerate.ts:42`)
- `buildOverview` (`analytics/overview.ts:160`)
- `menuEngineeringForModel` (`analytics/menuMatrix.ts:273`)
- `saleRatio` (`analytics/compare.ts:80`)
- `shiftRange` and `previousRange` (`analytics/range.ts:114,122`)
- `normalizeExcludedIds` and `exclusionSignature` (`analytics/exclusions.ts:14,57`)
- `TERMS_VERSION_PATTERN` (`legal/terms.ts:29`)
- `isLessonGridTime` (`coaching/grid.ts:46`)

Fully dead, with no hit anywhere at all: 26 exported types, for example the 16 `*Payload` types in `schemas/mutations.ts:254-711` and `TourScoreDetail`/`TourNotOpenDetail`/`TourNotPayableDetail`/`TourPublishDetail`/`TourErrorCode` (`tournaments/types.ts:116-177`). In apps/web the gate finds `allTournamentsPath` (`apps/web/src/lib/tournaments.ts:602`) and `MenuIcon` (`apps/web/src/components/site/icons.tsx:71`) with no reference outside their definition.
Source: Refactoring: Speculative Generality. McConnell Ch. 5 (YAGNI).
Consequence: readers assume these are the live rules. `calcTaxIqd` and `pickBestPromotion` are documented as twins of SQL that "MUST agree", yet no client runs them, so their tests guard nothing users see.
Remedy: for each one, either wire it to its intended consumer (W3 for the status machines) or delete it with its test. Keep a "twin" only if a parity test compares it against SQL.
Fix-Class: Residual. It removes exported symbols. The two web exports are Safe-sized but exported.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**S3 · R3 Knowledge Duplication: web re-implements small shared helpers with different semantics (bilingual pick, time-zone guard, plural, points-to-next-tier) (Suggestion)**
Symptom:
- **Bilingual pick.** Core `pickLocale` (`packages/core/src/i18n/pickLocale.ts:4-9`) uses `??`, so `''` is kept and renders blank. Web adds `localText` twice (`apps/web/src/lib/coaching.ts:427-429`, `apps/web/src/lib/tournaments.ts:419-421`, blank falls back), `localName` (`apps/web/src/lib/account/account.ts:87-89`, `||`) and an inline variant (`apps/web/app/[locale]/m/[token]/page.tsx:97`).
- **Time-zone helpers.** `knownTimeZone` and `inviteWhen` live in the open-match feature module (`apps/web/src/lib/site/matchInvite.ts:126-153`) but are imported by coaching and tournaments (`coaching.ts:4`, `tournaments.ts:10`).
- **Plural.** `apps/web/src/lib/site/plural.ts:11-24` re-implements `@touch/i18n` `pluralForm`/`countPhrase` (`packages/i18n/src/plural.ts:27-60`) over `Intl.PluralRules`, which the i18n file deliberately avoids because of Hermes. The zero form differs, and there is no digit grouping.
- **Points to next tier.** Computed in both `apps/web/src/lib/account/account.ts:92-97` and `apps/mobile/src/features/loyalty/logic.ts:181`.

Source: The Pragmatic Programmer: DRY.
Consequence: the same database row (an empty `name_ar`) renders blank on the phone and in English on the site. The helpers sit in arbitrary feature files, so the next page will add a fifth copy.
Remedy: settle one bilingual-fallback rule in core (`pickLocale` with blank-as-missing) and use it everywhere. Move `knownTimeZone`/`inviteWhen` to `apps/web/src/lib/site/when.ts`. Make `hoursPhrase` call `countPhrase('site.hoursCount', n, locale)`. Add `pointsToNextTier` to core `loyalty`.
Fix-Class: Extended-Safe for the web-only parts (5 files or fewer, tests exist). Residual for the core rule change.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**S4 · R3 Knowledge Duplication: the lesson-type card is built twice with parallel stylesheets (Suggestion)**
Symptom: `apps/web/src/components/coaching/CoachingBranch.tsx:154-189` (`LessonType`) and `apps/web/app/[locale]/c/[id]/page.tsx:163-189` (`card`) render the same band, kind, two-line name, duration line, description and price from the same helpers, with different class prefixes (`tp-coach-type__*` and `tp-clink__*`) and separate CSS files (`src/styles/site/coaching.css.ts`, 230 lines; `src/styles/site/coachLink.css.ts`, 225 lines).
Source: Refactoring: Duplicate Code.
Consequence: a change to a lesson card's content, such as showing places left, has to be made twice, and the two pages already differ in markup (`<p>` versus `<span>`).
Remedy: one exported `LessonTypeCard({type, price, locale, variant})` in `components/coaching`, with the shared rules in one css.ts and the per-page layout in a modifier class.
Fix-Class: Extended-Safe. Four files, tests exist.
Priority: Pain 1 × Spread 1 = 1
Intent: accidental

**S5 · R1 Cognitive Overload / R2 Divergent Change: web read-model files mix fetching, shaping, settings and presentation (Suggestion)**
Symptom:
- `apps/web/src/lib/menu.ts` (655 lines): menu types, cafe-settings folding (`:126-215`), reveals and featured discounts (`:238-330`), the 180-line `fetchMenu` (`:351-531`, five queries plus inline row types plus shaping) and branch and opening-hours reads (`:532-655`).
- `apps/web/src/lib/tournaments.ts` (612 lines) and `apps/web/src/lib/coaching.ts` (551 lines) each combine a parser, enum declarations, bilingual and time formatting, and URL helpers.
- `apps/web/app/[locale]/events/[id]/page.tsx` (462 lines) defines six components inline (`Schedule`, `Head`, `Standings`, `Cell`, `TournamentView` and the page).

Source: Refactoring: Long Method / Divergent Change.
Consequence: these files change for unrelated reasons (menu schema, cafe-settings switches, branches), so diffs and reviews get noisy. The risk is moderate because tests exist.
Remedy: split `menu.ts` into `menu.ts` (types and shaping), `cafeSettings.ts` and `branches.ts`. Move the event-page components to `components/tournaments/`.
Fix-Class: Extended-Safe, done in passes of 5 files or fewer with re-exports kept.
Priority: Pain 1 × Spread 1 = 1
Intent: accidental

**S6 · R5 Dependency Disorder: `packages/db` tests import operator app modules (Suggestion)**
Symptom: `packages/db/tests/insights-fallback.test.ts:14-43` imports `derive`, `payload`, `shape`, `format`, `fixtures` and `courts/*` from `apps/operator/src/features/analytics`. `packages/db/tests/marketing-insights.test.ts:23` imports `apps/operator/src/features/insights/insightsLogic`. Text-read parity tests (`staff-roles-parity.test.ts:70,75`, `replay-mutate-parity.test.ts:15`) are deliberate and not part of this finding.
Source: Clean Architecture: Stable Dependencies Principle.
Consequence: renaming or moving an operator analytics file breaks the db suite. The payload builders that define what the edge function receives live in an app, not in the core contract file (`packages/core/src/analytics/insightsContract.ts`) that claims to be "the ONE contract".
Remedy: move the pure payload builders (`payload.ts`, `courts/payload.ts` and their shape helpers) into `@touch/core/analytics`, next to `insightsContract.ts`. Both the operator and the db tests can then import them from there.
Fix-Class: Residual. It crosses the package boundary.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**S7 · R3 Knowledge Duplication: overnight rate rules are handled four different ways (Suggestion)**
Symptom: the database forbids them (`packages/db/supabase/migrations/20260827000048_booking_hardening.sql:126,130`, `check (start_time < end_time)`, validated). `app.price_slot` still carries a wrap branch for `start_time > end_time` (`20260926000210_booking_settings_per_venue.sql`, inside `price_slot`). Core `resolveRateRule` refuses them (`packages/core/src/pricing/rateRules.ts:96`, pinned by `rateRules.test.ts:142-147`). The operator editor splits them (`apps/operator/src/features/admin/rateRuleLogic.ts:9,37-56`).
Source: The Pragmatic Programmer: DRY. Speculative Generality (unreachable branches).
Consequence: there is no live defect while the constraint holds. Every reader has to rediscover which of the four stances is true, and the golden test's own history (`rateRules.golden.test.ts:11-17`) shows this exact disagreement once quoted a guest one price and charged another.
Remedy: record the decision ("split windows only") once in core `pricing/rateRules.ts`. Remove the editor's overnight split. Drop the SQL wrap branch with a *new* migration that re-issues `app.price_slot`; never edit the applied one.
Fix-Class: Residual. It crosses the database and an app.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**S8 · R4 Accidental Complexity: `packages/config` tsconfig fragments with no consumer, and an Expo root `tsconfig.json` (Suggestion)**
Symptom: `packages/config/tsconfig/node.json` and `react.json` are exported (`packages/config/package.json` `"./tsconfig/*"`, description "Shared tsconfig fragments"). Gate: `rg "tsconfig/node|tsconfig/react|config/tsconfig"` over the repo gives no hit. Every package extends `../../tsconfig.base.json` directly (`packages/core/tsconfig.json`, `apps/web/tsconfig.json`, and the others). The root `tsconfig.json` extends `expo/tsconfig.base` with empty options.
Source: Speculative Generality. Brooks: Conceptual Integrity (two tsconfig roots with no rule for which to use).
Consequence: a new package has two plausible bases. Tooling that opens root files (`scripts/*.mjs`, `e2e/`) gets Expo's compiler settings.
Remedy: delete the two fragments and the export, or make every package extend them. Point the root `tsconfig.json` at `tsconfig.base.json`, or delete it if nothing needs it.
Fix-Class: Residual. It removes a package export path.
Priority: Pain 1 × Spread 1 = 1
Intent: accidental

**S9 · R2 Change Propagation: `turbo.json` has no `globalDependencies` (Suggestion)**
Symptom: `turbo.json` declares no `globalDependencies`/`inputs` for `typecheck`, `lint` or `test`. Root `tsconfig.base.json`, which sets `strict` and `noUncheckedIndexedAccess` for every package, sits outside every package directory and so is not part of any task hash. CI runs cold (`.github/workflows/ci.yml:145`, no turbo cache), so only local runs are affected.
Source: Winters et al., Software Engineering at Google Ch. 18/21 (hermetic builds).
Consequence: after a compiler-flag change, a local pre-push `pnpm typecheck`, which root `CLAUDE.md` requires before every push, can replay a cached green.
Remedy: add `"globalDependencies": ["tsconfig.base.json"]` to `turbo.json`.
Fix-Class: Safe. One config line, nothing exported.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**S10 · R2 Change Propagation: `useCafeActions` takes a 15-field dependency object of hooks and setters (Suggestion)**
Symptom: `apps/web/src/components/cafe/useCafeActions.ts:25-41` (`CafeActionsDeps`: six hook results plus six setters plus a ref) is memoised on `[d]` (`:49-55`), so every callback is rebuilt on every render. This is item C10 in `apps/web/CLAUDE.md`.
Source: Refactoring: Long Parameter List / Inappropriate Intimacy.
Consequence: `CafeApp` (378 lines, 22 hook calls) and the actions hook have to change together, and memoisation is defeated.
Remedy: as `apps/web/CLAUDE.md` prescribes, memoise the deps object in `CafeApp`. Also consider passing a reducer `dispatch` instead of six setters.
Fix-Class: Extended-Safe. Two files.
Priority: Pain 1 × Spread 1 = 1
Intent: intentional (documented as C10, with a prescribed fix)

---

## Top offenders

| File | Lines | What's tangled |
|---|---|---|
| `packages/i18n/src/catalogs/en.ts` (+`ws/`, 1.5 MB source) via `t.ts:1-14` | 2,608 + `ws` | One `Messages` tree for three apps, so every web page ships operator strings (W1) |
| `packages/court3d/src/scene.ts` | 1,143 | `buildCourtScene` is 718 lines: 3 scene kinds × 2 views × 3 host profiles (W8) |
| `packages/core/src/index.ts` | 26 | Barrel of 25 modules (`export *`), which drags zod and till schemas into the web client (W2) |
| `apps/web/src/lib/menu.ts` | 655 | Fetch (180-line `fetchMenu`), shaping, cafe settings and branches in one module (S5) |
| `apps/web/src/lib/tournaments.ts` | 612 | Redeclares core `TOUR_*` enums and the cut-off rule, plus parser, formatting and paths (W7, S5) |
| `apps/web/src/lib/coaching.ts` | 551 | Parser plus redeclared lesson kinds plus bilingual and time helpers (W7, S3) |
| `apps/web/app/[locale]/events/[id]/page.tsx` | 462 | Six inline components in one page (S5) |
| `apps/web/src/components/cafe/CafeApp.tsx` + `useCafeActions.ts` | 378 + 236 | 22 hook calls; 15-field deps object (S10) |
| `apps/web/app/[locale]/c/[id]/page.tsx` | 352 | Duplicate lesson card plus layout grouping inline (S4) |
| `packages/core/src/status/machines.ts` | 105 | The "client" status tables have no production consumer while four apps redeclare them (W3) |
| `apps/web/src/lib/site/openNow.ts` | 80 | Duplicates `cafe/hours.ts` and re-states core's overnight rule (W5) |
| `scripts/create-review-account.mjs` / `create-staff-review-account.mjs` | 313 / 324 | Copy-pasted admin helpers; service key in the web env file (W9) |

## Looks bad but is fine

- **`packages/core/src/coaching/shapes.ts` (1,736 lines)** and **`packages/core/src/tournaments/shapes.ts` (401):** declarative read-contract key tables, checked against SQL by the db `coaching-shapes` tests and read by the parsers. This is data, not tangled logic.
- **`packages/core/src/assistant/tools.ts` (1,257):** the assistant's tool registry. Its order is the model's cached prefix, and it is byte-copied to Deno with a parity test.
- **Deno byte copies** `packages/db/supabase/functions/_shared/insightsContract.ts` and `insightsText.ts`: the edge runtime cannot import workspace packages. The copies carry headers and are pinned by `packages/db/tests/insights-text-parity.test.ts`; a whitespace-insensitive diff shows only the three-line header.
- **SQL twins of core money:** `applyPctDiscountIqd` mirrors migration 0030 (`packages/db/supabase/migrations/20260825000030_order_pricing.sql:56`) and `splitEvenly` mirrors 0260 (`20260929000260_match_core.sql:483`). Both are documented twins with parity tables. This is intentional duplication across a language boundary.
- **Web money maths:** `basket.ts` and `selection.ts` use only core helpers. The raw subtraction at `basket.ts:91` is wrapped in `sumIqd`, which re-asserts that the result is non-negative.
- **Parity tests reading operator source as text** (`staff-roles-parity.test.ts:70,75`, `replay-mutate-parity.test.ts:15`): they check that hand copies agree, without importing them.
- **`packages/core/src/analytics` (4.3k lines) with essentially one consumer (operator):** its floors feed the Deno copy and the db tests, so it is shared knowledge, not speculative.
- **Exported-but-internal types in `court3d` and `ui`** (`DrillProps`, `GhostTrail`, `BALL_SPIN`, `SiteVars`, and similar): the gate shows each one used inside its own file. The `export` keyword is unnecessary, but the code is not dead.
- **Individual mutation payload schemas** (`orderCreatePayloadSchema` and the rest): unused outside core but composed into `mutationEnvelopeSchema` (`schemas/mutations.ts:741,794`), so they are live.
- **Mobile's own design tokens instead of `@touch/ui`:** deliberate. The closed palette is documented in `apps/mobile/src/theme/tokens.ts:9-23`.
- **`apps/web/src/components/cafe/MenuStage/sectionArt.tsx` (524):** SVG art data.
- **Template-string CSS in `src/styles/**/*.css.ts`:** a repo convention (`apps/web/CLAUDE.md`).
- **`packages/i18n/src/errors.ts` (885):** a code-to-message-key table the web's `rpcErrorKey` relies on. It is a table, not a ladder.
- **`turbo.json` `typecheck` depends on `^build` with no package builds:** a harmless no-op.
- **Shared-package layering:** `core`, `ui`, `court3d`, `i18n` and `config` import no app and no peer package except `@touch/config` (dev). Core has no infrastructure dependency (`qrcode`, `ulid`, `zod`), and `net/resilientChannel` depends on a `RealtimeClientLike` interface, which is the right direction.

## Debt Summary

| Risk | Findings | Avg Priority | Classification | Intent |
|------|----------|-------------|----------------|--------|
| Cognitive Overload      | 2 (W8, S5) | 2.5 | Monitored | accidental |
| Change Propagation      | 2 (S9, S10) | 1.5 | Monitored | accidental / intentional (C10) |
| Knowledge Duplication   | 9 (W3, W4, W5, W6, W7, S1, S3, S4, S7) | 3.4 | Scheduled | accidental |
| Accidental Complexity   | 2 (S2, S8) | 1.5 | Monitored | accidental |
| Dependency Disorder     | 4 (W1, W2, W9, S6) | 3.5 | Scheduled | accidental |
| Domain Model Distortion | 0 | n/a | n/a | n/a |

**Recommended focus:** Knowledge Duplication is systemic. Core holds the right concepts but not the small shared decisions (management set, venue date, `DAY_KEYS`, lesson kinds, status unions), so every app re-decides them. Dependency Disorder through the two package-root barrels (W1, W2) is the highest-leverage single fix, because it is measurable in the guest bundle today.

## Summary

The most important action is to stop the public site shipping operator code. That means splitting `@touch/i18n` catalogs per audience (W1) and switching the six web client imports of `@touch/core` to subpaths, with `sideEffects: false` (W2): together about 2 MB of first-load JS on every web route. The next step is to make core the producer for the shared micro-decisions the apps keep re-implementing: status unions and transitions, `isManagement`, `venueDate`/`DAY_KEYS`, and lesson and tournament enums (W3–W7). Then delete or wire up its test-only exports (S2). The trend is additive: each recent feature (coaching, tournaments, staff roles) added another local copy instead of a core export.

**Health Score:** 45/100 (balanced: 9 Warning × −5, 10 Suggestion × −1; no Critical)
