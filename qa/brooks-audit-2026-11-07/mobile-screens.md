# Brooks-Lint Review

**Mode:** Tech Debt Assessment
**Scope:** lane `mobile-screens`: `apps/mobile/app/**` (expo-router screens, 44,683 lines) and `apps/mobile/src/features/staff/**` (20,482 non-test lines), compared against `apps/operator/src/features`, `apps/operator/src/lib/auth.tsx`, `apps/web/src/lib/menu.ts` and `packages/core`. Read-only. There is no `.brooks-lint.yaml`, so the defaults apply (balanced preset).
**Health Score:** 46/100

The screens mostly call feature hooks; they make no RPC calls of their own. The debt is in three places: staff permission rules that see only the person's main role and live in 25 small copies instead of one table; protocol, activity, content and modifier logic written twice across the phone, the operator and the web, with drift already shipped; and route components of 500 to 1,000 lines that hold untestable validation.

---

## Findings

### 🟡 Warning

**R6 Domain Model Distortion — Staff screens judge the person by their main role, while the gate also counts second jobs (Warning)**
Symptom: The gate admits a person when any of their jobs fits: `rolesOf(status.staff)` at `apps/mobile/src/features/staff/gate.ts:44-45`, with the comment "a second job opens its pages too, as the server's is_staff does". Today's rows also add second jobs (`todayGroups.tsx:259-263`, `todayRows(role, extraRoles)`). Inside the pages, every behaviour check reads `status.staff.role` alone. That is 42 reads across `app/` and `src/features/staff`. `rolesOf` is used only in `gate.ts:45` and `access.ts:170`. Three of these are bugs you can reproduce:
- `app/(staff)/staff-purchase.tsx:48-49`: `buyer = role === 'driver'`. A cashier whose second job is driver opens Purchases (`PURCHASE_ROLES` includes driver), gets no Add button (`:52-60`) and sees the management note instead (`:94`).
- `app/(staff)/staff-content.tsx:1102` → `contentAccess(role)` (`src/features/staff/content/logic.ts:32-33`, `sends: role === 'marketing'`). A second-job marketer gets past `RequireStaff roles={CONTENT_ROLES}` (`:1114`) and then cannot send content.
- `app/(staff)/staff-start.tsx:625,628`: `startableKinds(role)` (`packages/core/src/protocols/steps.ts:73`) takes one role. A cashier whose second job is court_desk or marketing sees the "Start" row and the gate lets them in, but they land on a start page with nothing to start.
- The waiting badges have the same gap: `todayGroups.tsx:230` (`CALL_ROLES.includes(staffRole)`) and `:242`. So does the assistant's page list, `src/features/assistant/free.ts:51` (`staffRows(role)` with no extra roles).

Source: Evans — Domain-Driven Design, Ubiquitous Language (the domain concept is "a person with jobs", the code models one schema column); Fowler — Primitive Obsession.
Consequence: Since 0345, anyone the owner gives a second job can reach pages that then refuse to work, or that show the management view of the page. The server allows the action, so the phone is the only thing in the way. The defect is bounded to accounts with second jobs, but it is live on every page that branches on role.
Remedy: Add one `useStaffWho()` hook that returns the `StaffInfo`. Give every predicate in `src/features/staff/*/logic.ts` a person instead of a role, answering through `rolesOf(who)`, the way operator's `can(staff, …)` does. Make `startableKinds` and `priceChangeKinds` in core accept a `StaffAccess`. Add a vitest per predicate for a main role plus a second job.
Fix-Class: Residual. It changes the signatures of about 15 exported predicates across the lane, and the screens have smoke tests only.
Priority: Pain×Spread = 2×3 = 6
Intent: accidental

**R3 Knowledge Duplication — The phone has about 25 hand-written capability lists, while the operator has one table (Warning)**
Symptom: The operator keeps capabilities in one table, `CAPABILITY_ROLES` (`apps/operator/src/lib/auth.tsx:487-640`), and its CLAUDE.md calls that "the one place to change a permission" (`apps/operator/CLAUDE.md:26`). The phone re-declares the same decisions per feature:
- `DEDUCT_ROLES` (`deductions/logic.ts:18`) is the operator's `proposeDeductions`.
- `IDEA_REVIEW_ROLES` (`protocols/logic.ts:55`) is `reviewIdeas`.
- `PRODUCTION_ROLES` (`supplies/production.ts:13`) is `readProduction`.
- `PURCHASE_ROLES` (`supplies/logic.ts:33`) is `readPurchases`.
- `RECIPE_ROLES` (`recipes/logic.ts:24`) is `readRecipes`.
- `TEACHING_ROLES` (`teachings/logic.ts:15`) is `readTeachings`.
- `CONTENT_ROLES` / `contentAccess` (`content/logic.ts:23,33`) is `submitContent` / `decideContent`.
- `REVIEW_ROLES` (`incidents/logic.ts:39`) is `reviewIncidents`.
- `STOCK_ROLES` (`stock/logic.ts:27-34`) is byte-for-byte core's `STOCK_VIEW_ROLES` (`packages/core/src/staff/stores.ts:55`), yet the sibling `stores/logic.ts:10-30` imports from core.

`['manager','owner']` is declared five more times: `rows.ts:296`, `deductions/logic.ts:20`, `marketing/logic.ts:53`, `teachings/logic.ts:25`, `protocols/logic.ts:43`, plus `packages/core/src/protocols/steps.ts:64`. It is inlined again as `role === 'manager' || role === 'owner'` (`recipes/logic.ts:46`, `suggestions/logic.ts:17`, `todayGroups.tsx:242`). Only the page-to-area map has a parity check, and that check reads the operator's source as text (`src/features/staff/__tests__/access.test.ts:26,69-78`). The capability lists have none.
Source: Hunt & Thomas — The Pragmatic Programmer, DRY; Fowler — Duplicate Code.
Consequence: To change who may do something today you edit the SQL guard, the operator's table and one or more phone feature files. Nothing fails when the phone copy is missed. The second-job defect above is this duplication showing.
Remedy: Move a `STAFF_CAPABILITIES` table and a `can(who, cap)` function (person-aware, like the operator's) into `packages/core/src/staff/`. Have both apps import it. Replace each phone `*_ROLES` constant with `CAPABILITY.x` (keep the names as aliases for one pass). Delete the local MGMT copies.
Fix-Class: Residual. The change crosses packages and alters exported constants in both apps.
Priority: Pain×Spread = 2×3 = 6
Intent: accidental

**R3 Knowledge Duplication — Protocol client logic is written two or three times across apps, and the copies have drifted (Warning)**
Symptom: The same pure readers and builders for the protocol RPCs live in:
- the phone: `src/features/staff/protocols/logic.ts` (922 lines) and `assemble.ts`;
- the operator: `protocols/protocolLogic.ts`, `protocols/formModel.ts`, `tasks/formModel.ts`, `protocols/priceTargets.ts`, `tasks/priceLogic.ts` and `desk/eventBlock.ts`.

That makes three draft⇄record form models over core's `FieldDef`:
- phone `assemble.ts:38-330`: `emptyValue`, `emptyDraft`, `recordFromDraft`, `draftFromRecord`, `getAt`, `setAt`;
- operator `tasks/formModel.ts:32-312`;
- operator `protocols/formModel.ts:25-215`.

There are also three price-target readers: phone `logic.ts:256-700`, operator `priceTargets.ts:223` and `tasks/priceLogic.ts:87`. Drift found:
- **Tournament classes (a behaviour defect):** the phone reads only `class`, at `logic.ts:736,759`. The operator reads the 0359 `classes` array with a fallback, at `desk/eventBlock.ts:48,72-76`. Migration 0359 keeps `class` as the first class only (`20261022000359_tournament_classes.sql:120,1184`). As a result, the phone's courts and marketing step context (`StepContext.tsx:231`) shows one class for a multi-class tournament.
- **`launchPhotoChoices`:** the phone (`logic.ts:128-138`) keeps photos from a `stop` decision and sorts newest first. The operator (`protocolLogic.ts:438-449`) drops `stop` and keeps step order.
- **`bilingual` vs `pickText`:** the phone trims and returns null (`logic.ts:65-67`). The operator returns the untrimmed string or `''` (`protocolLogic.ts:317-322`).
- **`readBlockAnswer`:** the operator also requires a court on a `match_waiting` conflict (`eventBlock.ts:191`). The phone does not (`logic.ts:858`).
- **Who decides a step:** the phone decides inline (`StepForms.tsx:258`). The operator goes through `decidesStep` → `CAPABILITY_ROLES` (`protocolLogic.ts:736-738`).

Source: Fowler — Duplicate Code / Alternative Classes with Different Interfaces; Hunt & Thomas — DRY.
Consequence: Each protocol wave (0359, 0285 lessons and so on) has to land in two apps. The 0359 drift shows that copies get missed, and the result is a step context that is wrong on the phone. Protocols are one of the most active areas in the repo.
Remedy: Move the pure halves to `packages/core/src/protocols/`. That covers `readTournamentContext`, `plannedWindows`, `blocksToSend`, `readBlockAnswer`, `courtsRecord`, `launchPhotoChoices`, the price-target reader, one form model (draft⇄record, getAt/setAt) and `pickText`. Keep each app's UI wrappers. Fix the class reader first, as a standalone change.
Fix-Class: Residual. It crosses apps and changes exports.
Priority: Pain×Spread = 2×3 = 6
Intent: accidental

**R3 Knowledge Duplication — Other RPC readers and rules are copied between the phone's staff features and the operator (Warning)**
Symptom:
- **Activity monitor:** the phone (`activity/logic.ts:12-70,112-121,152-154`) and the operator (`observation/activity/activityLogic.ts:12-115`, `admin/audit/auditLogic.ts:578`, `lib/activityPing.ts:22-26`) each define `ActivityPart`, `onlineCounts`, `codeToKey`, `PING_INTERVAL_MS` and `SIGN_OUT_PING_TIMEOUT_MS`.
- **Waiter-call urgency:** the phone (`calls/logic.ts:40-62`) and the operator (`till/WaiterCallsPanel.tsx:59-72`) each set the 2/5/120-minute thresholds.
- **Content limits and validation:** the phone has them at `content/logic.ts:63-70,160-190`, the operator at `content/contentLogic.ts:34-38,226-250`. They have drifted: the phone measures with `title.length` / `body.length` (UTF-16 code units), while the operator uses `[...s].length` and the server uses Postgres `length()` (`20261022000362_marketing_plan.sql:359,726`), both of which count characters. An emoji-heavy caption near 4,000 characters is refused on the phone but accepted by the server and the operator.
- **Calendar helpers:** the phone has them at `deductions/logic.ts:98-115`, the operator at `deductions/venueDate.ts:23-40`.

Source: Fowler — Duplicate Code; Hunt & Thomas — DRY.
Consequence: Each limit or threshold change needs coordinated edits in two apps, and the content length rule has already drifted. The impact is bounded: the server enforces the real limits.
Remedy: Put the board types, ping timings, call thresholds, content limits (`CONTENT_CAPS`) and a code-point `chars()` in `packages/core`. Count characters with `[...s].length` on the phone now.
Fix-Class: Residual. It crosses apps.
Priority: Pain×Spread = 2×2 = 4
Intent: accidental

**R3 Knowledge Duplication — Menu option rules are in three apps with different behaviour (Warning)**
Symptom: The rules for a menu item's option groups (min/max, a one-choice group behaving like radio buttons, groups revealed by another choice) are written three times:
- the phone's waiter order: `src/features/staff/floor/logic.ts:214-282` (`activeGroups`, `pruneChoices`, `toggleChoice`, `missingGroups`, `initialChoices`);
- the web menu: `apps/web/src/lib/menu.ts:293` (`activeGroups`);
- the operator till, inline in a component: `apps/operator/src/features/till/ItemSheet.tsx:91-110`.

The till ignores revealed groups (there is no "reveal" anywhere in `features/till`), and it lets a required one-choice option be un-ticked (`:99-100`). The phone refuses that (`floor/logic.ts:258`).
Source: Fowler — Duplicate Code; Hunt & Thomas — DRY.
Consequence: The waiter's phone and the till can build different orders for the same item: a revealed required group is enforced on the phone and not on the till. A change to the option rules must land in three places, one of which has no tests.
Remedy: Move `floor/logic.ts`'s option functions (they are pure and vitest-tested) to `packages/core/src/menu/` and use them from the till's `ItemSheet` and the web `ItemSheet`.
Fix-Class: Residual. It crosses apps, and the till copy is untested.
Priority: Pain×Spread = 2×3 = 6
Intent: accidental

**R3 Knowledge Duplication — The rule that the owner gives no reason (0361) is an inline `role === 'owner'` in six places (Warning)**
Symptom: `app/(staff)/staff-shopping.tsx:258` (decline needs a reason unless the person is the owner) and `:362`; `staff-step.tsx:408,473`; `staff-start.tsx:354,798,812`; `staff-ideas.tsx:374`; `staff-run.tsx:384`; `src/features/staff/protocols/StepForms.tsx:258` (`submitterDecides`). The same reason-optional rule for content lives in a feature function (`content/logic.ts` `validateDecision`), so one rule has two homes.
Source: Fowler — Duplicate Code / Shotgun Surgery; operator CLAUDE.md's "never write `staff.role === '…'` inline" applied to the phone.
Consequence: If the rule changes (for example, a manager may also skip the reason), six screens need edits, and the screens have smoke tests only.
Remedy: Add `decidesWithoutReason(who)` and `decidesStep(who, needsOwnerOk)` to the capability module from the second finding, and use them in these screens.
Fix-Class: Extended-Safe. It adds new exports and edits five screens in one pass plus one more, with no existing exports changed.
Priority: Pain×Spread = 2×2 = 4
Intent: accidental

**R1 Cognitive Overload — God route components of 500 to 1,000 lines in a single function (Warning)**
Symptom (function spans):
- `app/(matches)/match/[id].tsx:142-1164` (~1,020 lines, 9 mutation hooks, `:175-183`);
- `app/(coach-mode)/coach-mode-book.tsx:102-1124` (~1,020 lines, 17 `useState`);
- `app/pay/status.tsx:110-1187` (~1,080 lines: three payment kinds, seven effects chained through `pointer.read` → terminal → `plan` → `navigated`, `:135-305`);
- `app/(tabs)/bookings.tsx:202-1181` (~980);
- `app/(tabs)/play.tsx:180-1120` (~940);
- `app/(staff)/staff-recipe-change.tsx:121-944` (~820; two products behind one flag: `head` drafts, owner/manager decide, `:129-160`);
- `app/(tabs)/index.tsx:489-1161` (~670);
- `app/(staff)/staff-marketing.tsx:101-741` (~640, 9 queries/mutations);
- `app/(staff)/staff-content.tsx:597-1096` (~500);
- `app/(staff)/staff-incident-report.tsx:109-568` (~460);
- `app/profile-edit.tsx` holds a hub plus four forms in one 1,351-line file (`:351,728,803,914,1070`).

Source: Fowler — Long Method / Divergent Change; McConnell — Code Complete Ch. 7.
Consequence: These are the screens that change most often (booking, matches, payments, staff work). Each holds dozens of state variables whose interactions are covered only by one smoke render per locale (`apps/mobile/CLAUDE.md` Tests). Reviewers can't hold a 1,000-line closure in their head, and any change risks breaking state the smoke render never reaches.
Remedy: Split each route into a thin route file plus section components and a `use<Screen>Model()` hook under `src/features/<x>/`. Start with `staff-recipe-change` (split head and decider into two components) and `pay/status` (one hook per payment kind). The CLAUDE.md "one file per form" choice for profile-edit can stay a single route if its forms move into `src/features/profile/`.
Fix-Class: Residual. There is no unit coverage of screen state to fall back on.
Priority: Pain×Spread = 2×3 = 6
Intent: accidental

**R5 Dependency Disorder — Screens hold business validation and decision ladders that the mobile CLAUDE.md puts in `features/<x>/logic.ts` (Warning)**
Symptom: `apps/mobile/CLAUDE.md:190` says: "Put logic in `src/features/<x>/{assemble,logic,errors}.ts` so it is testable." These screens hold the rules themselves:
- `app/(coach-mode)/coach-mode-book.tsx:162-247`: phone required unless a saved student; a friend's phone needs a name; party cap `Math.min(4, …)`. `coach-mode-lesson.tsx:314-325` repeats the phone rule.
- `app/(staff)/staff-shopping.tsx:254-266`: decline validation.
- `app/profile-edit.tsx:938-947`: the username state ladder, four levels of ternary with a magic `3`.
- `app/review.tsx:240-290` and `:296-310`: two error-code-to-action ladders.
- `app/pay/status.tsx:292-305` and `:423-436`: the `/success` params, including the `durationMin` calculation, built twice in one file.
- `app/(tabs)/bookings.tsx:107-121`: `withTournaments` list merge, next to `mergeReservationLists` in `features/matches/logic.ts`.

Source: Martin — Clean Architecture (business rules must not live in the UI layer); Feathers — Working Effectively with Legacy Code, the seam model.
Consequence: None of these rules has a unit test, because the vitest runner cannot import screens. A wrong coach-booking or decline rule surfaces as a server refusal at best, and as a silently wrong payload at worst.
Remedy: Extract each into a pure function in its feature (`coach/logic.ts` `bookStudentsProblem`, `profile/username.ts` `usernameState`, `booking/errors.ts` `confirmRefusalAction`, `deposit/…` `successParams`, `matches/logic.ts` `withTournaments`) and give each a vitest.
Fix-Class: Extended-Safe. Each is one screen plus one feature file plus one test, with no exports removed.
Priority: Pain×Spread = 2×2 = 4
Intent: accidental

**R1 Cognitive Overload — Protocol step forms: an if-ladder in a `.tsx` hook and read guards of up to six conditions (Warning)**
Symptom: `src/features/staff/protocols/StepForms.tsx:113-228` (`useSpec`) is a 115-line ladder keyed by (kind, step) that builds drafts inside `useMemo`, in a file that imports react-native, so vitest cannot reach it. `useStepReads.ts:100-147` holds `enabled:` predicates such as `is('price_promo','propose') && acting && (mgmt || role === 'marketing') && (change !== 'shop_launch' || mgmt)` (`:110`). These copy the server's read guards by hand.
Source: McConnell — Code Complete Ch. 19 (complex boolean expressions); Fowler — Switch Statements.
Consequence: A new step kind, or a change to who may read what, means editing this ladder and the guards, then the operator's copy as well. Getting a guard wrong gives a permission-denied fetch or a form that never loads (`return null`). The only safety net is a smoke test.
Remedy: Move the per-step draft builders into `assemble.ts` as a `Record<\`${kind}:${step}\`, (reads) => Spec | null>` table with vitest coverage. Name each `enabled` predicate (for example `readsTargets(who, run)`) in `protocols/logic.ts`.
Fix-Class: Extended-Safe. Three files, new exports only.
Priority: Pain×Spread = 2×2 = 4
Intent: accidental

### 🟢 Suggestion

**R3 Knowledge Duplication — `dayLabel` is copied into nine staff screens (Suggestion)**
Symptom: The same three-line `formatDate(new Date(\`${day}T12:00:00Z\`), locale)` appears at `app/(staff)/staff-content.tsx:104`, `staff-marketing.tsx:97`, `staff-request-new.tsx:42`, `staff-marketing-request-new.tsx:51`, `staff-stock.tsx:57`, `staff-deduction-propose.tsx:58`, `staff-request.tsx:45`, `staff-marketing-requests.tsx:80` and `staff-deductions.tsx:66`. The operator has its own in `deductions/venueDate.ts:44`.
Source: Fowler — Duplicate Code.
Consequence: A fix to how a day-only date is shown (the zone, or the noon trick) must touch nine files.
Remedy: Export `dayLabel(day, locale)` from `@touch/i18n` (next to `formatDate`) and import it.
Fix-Class: Extended-Safe. Each copy is non-exported and local, so it can be done in two passes of five files or fewer.
Priority: Pain×Spread = 1×2 = 2
Intent: accidental

**R3 Knowledge Duplication — Business-day and calendar constants are re-declared, and one ignores the owner's setting (Suggestion)**
Symptom:
- `src/features/staff/deductions/logic.ts:87`: `VENUE_DAY_START_HOUR = 4` copies core's `BUSINESS_DAY_START_DEFAULT` (`packages/core/src/analytics/businessDay.ts:20`). The comment at `:82-86` names the owner setting `analytics_business_day_start_hour`, which the owner can change (`setBusinessDayStart`, `apps/operator/src/lib/auth.tsx:491`).
- `addDays`, `monthOf` and `shiftMonth` (`deductions/logic.ts:98-115`) copy core's `analytics/range.ts:63,103` and `availability/assemble.ts:107`.
- `protocols/assemble.ts:34` hard-codes `VENUE_OFFSET_MINUTES = 180`, while `marketing/logic.ts:113` uses core's `wallTimeToUtc(…, VENUE_TZ)` for the same venue time.

Source: Hunt & Thomas — DRY; McConnell Ch. 12 (magic numbers).
Consequence: If the owner moves the day start, a deduction proposed between 04:00 and the new hour defaults to a date the server judges differently. The impact is bounded: only the default date is affected, and the server checks.
Remedy: Import `BUSINESS_DAY_START_DEFAULT` and `addDays` / `addMonths` from core, and use `wallTimeToUtc` in `assemble.ts`. Later, read the venue's setting the way the operator does.
Fix-Class: Extended-Safe for the constant and helper swaps (they can stay exported as aliases). Honouring the setting is Residual.
Priority: Pain×Spread = 1×2 = 2
Intent: accidental

**R3 Knowledge Duplication — The UUID regex is copied six times although core exports `isUuid`, and detail routes are inconsistent (Suggestion)**
Symptom: The regex appears at `app/(matches)/match/[id].tsx:153`, `app/(coach-mode)/coach-mode-lesson.tsx:83`, `src/features/profile/avatar.ts:24`, `availability/branch.ts:46`, `staff/supplies/logic.ts:283` and `coaching/links.ts:23`. Core exports `isUuid` at `packages/core/src/protocols/validate.ts:69`. `booking/[id].tsx:55`, `tournament/[id].tsx:102`, `lesson/[id].tsx:75` and `class/[id].tsx:74` pass any non-empty string through.
Source: Fowler — Duplicate Code.
Consequence: Hand-typed deep links are treated differently from one screen to the next. The impact is minor.
Remedy: Import `isUuid` from `@touch/core` everywhere, and validate ids the same way on each `[id]` route.
Fix-Class: Extended-Safe.
Priority: Pain×Spread = 1×2 = 2
Intent: accidental

**R3 Knowledge Duplication — The degraded-refusal message is inlined five times in the booking flow (Suggestion)**
Symptom: `phone ? t('degraded.bookingRefused', {phone}) : t('degraded.bookingRefusedShort')` appears at `app/review.tsx:242-248,299-305`, `app/pay/status.tsx:340-344,444-448` and `src/features/availability/useAvailabilityBooking.ts:478-483`. Matches and coaching already wrap it in a function (`features/matches/errors.ts:112`, `features/coaching/errors.ts:223`).
Source: Fowler — Duplicate Code.
Consequence: A wording or fallback change misses one of the copies.
Remedy: Add `bookingErrorText(err, t, { phone })` to `features/booking/errors.ts`, beside `isDegradedRefusal`, and use it in all five places.
Fix-Class: Extended-Safe.
Priority: Pain×Spread = 1×2 = 2
Intent: accidental

**R2 Change Propagation — Query keys are inlined in screens, against the mobile CLAUDE.md (Suggestion)**
Symptom: `app/(staff)/staff-work.tsx:67-68` invalidates `['staff','myRecipeChanges']` and `['staff','recipeChanges']` (the families exist at `src/features/staff/keys.ts:103-105`). `app/review.tsx:269` matches `q.queryKey[0] === 'rate-rules'` (the family is `availabilityKeys.rates`, `features/availability/keys.ts:27`). `apps/mobile/CLAUDE.md:113` says "never inline a key array in a component".
Source: Ousterhout — Information Leakage.
Consequence: If either family is renamed, the refresh stops working without any error.
Remedy: Build the prefixes from the key families (`staffKeys.myRecipeChanges` …, or a `.all` prefix entry).
Fix-Class: Safe. Each is a local edit in one file.
Priority: Pain×Spread = 1×2 = 2
Intent: accidental

**R4 Accidental Complexity — Today screen: a dead `compact` flag and owner tiles outside the row registry (Suggestion)**
Symptom: `app/staff.tsx:710`: `const compact = true;` still drives about 20 `compact ? … : …` branches whose false arm can never run. The three owner tiles are inline `staff.role === 'owner'` spreads (`:881-922`), bypassing `STAFF_ROW_DEFS` and the group registry the other tiles use (`src/features/staff/rows.ts`, `todayGroups.tsx`). The Arabic brand rewrite of the venue name is inline at `:718`.
Source: Fowler — Speculative Generality / Dead Code.
Consequence: Every reader has to reason about two layouts, one of which can never render. Owner pages are invisible to anything that lists rows, such as the assistant's map (`assistant/free.ts:51`).
Remedy: Inline `compact` as true and delete the dead arms. Add the owner tiles as rows with `roles: ['owner']`.
Fix-Class: Safe for the flag (one file, non-exported). Moving the tiles is Extended-Safe.
Priority: Pain×Spread = 1×1 = 1
Intent: accidental

**R4 Accidental Complexity — `todayRows` only forwards to `staffRows` (Suggestion)**
Symptom: `src/features/staff/rows.ts:304-306` is `return staffRows(role, extraRoles);` with no other behaviour. It has one caller (`todayGroups.tsx:259`).
Source: Fowler — Middle Man.
Consequence: Readers look for a difference between the two that isn't there. The impact is minor.
Remedy: Call `staffRows` directly and drop `todayRows`.
Fix-Class: Residual by the letter of the criteria (it removes an exported symbol), though in practice it is a two-file change.
Priority: Pain×Spread = 1×1 = 1
Intent: accidental

**R6 Domain Model Distortion — Role-extraction boilerplate in 25 screens, eight of them with made-up fallback roles (Suggestion)**
Symptom: `status.kind === 'staff' ? status.staff.role : …` appears in 25 files. Eight of them invent a role when the status is not staff: `'head_chef'` (`staff-recipe-change.tsx:128`), `'barista'` (`staff-recipes.tsx:231`, `staff-teachings.tsx:79`) and `'cashier'` (`staff-incidents.tsx:101`, `staff-deductions.tsx:85`, `staff-deduction-propose.tsx:71`, `staff-marketing-requests.tsx:94`, `staff-marketing-request-new.tsx:63`).
Source: Evans — Ubiquitous Language; Fowler — Duplicate Code.
Consequence: Today this is harmless, because `RequireStaff` renders the page only for staff. But the invented roles are the kind of code that lets a person-blind check (the first finding) look correct.
Remedy: The `useStaffWho()` hook from the first finding, which throws or returns null outside `RequireStaff`. No fallback roles.
Fix-Class: Extended-Safe, done in passes of five files or fewer.
Priority: Pain×Spread = 1×3 = 3
Intent: accidental

**R2 Change Propagation — Adding one staff page means editing about eight registries (Suggestion)**
Symptom: A new staff page touches:
- the screen itself;
- `STAFF_ROW_DEFS` (`rows.ts:46`);
- `ROW_ICONS`, `ROW_GROUPS` and `CREATE_ROW_IDS` (`todayGroups.tsx:61,103,192`);
- `STAFF_PAGE_AREAS` (`access.ts`, "fails on a staff screen missing here");
- `src/smoke/routes.ts:222` plus a smoke suite;
- `pushRoutes.ts:69` when the page has a push;
- `staffKeys` (`keys.ts`);
- the en and ar catalogs.

Source: Fowler — Shotgun Surgery.
Consequence: Tests catch each omission (`rows.test.ts`, `access.test.ts`, `smokeCoverage.test.ts`), so the cost is time, not bugs.
Remedy: Fold row, icon, group and area into one `STAFF_PAGES` record per page in `rows.ts`, and derive the others from it.
Fix-Class: Residual. This is a design change.
Priority: Pain×Spread = 1×3 = 3
Intent: intentional (test-enforced registries)

---

## Top offenders

| File | Lines | What's tangled |
|---|---:|---|
| `apps/mobile/app/profile-edit.tsx` | 1351 | Hub plus four forms in one route; 22 `useState`; username state ladder inline (`:938-947`) |
| `apps/mobile/app/pay/status.tsx` | 1196 | One component for deposit, ticket and lesson payments; 7 chained effects; `/success` params built twice (`:292,423`); degraded branch ×2 |
| `apps/mobile/app/(tabs)/bookings.tsx` | 1181 | ~980-line component; list merge `withTournaments` in the screen (`:107`) |
| `apps/mobile/app/(matches)/match/[id].tsx` | 1175 | ~1,020-line component, 9 mutation hooks, poster maths and UUID regex inline |
| `apps/mobile/app/(tabs)/index.tsx` | 1161 | ~670-line component with stage, sheet and animation orchestration (mostly presentation) |
| `apps/mobile/app/(coach-mode)/coach-mode-book.tsx` | 1131 | ~1,020-line body, 17 `useState`, booking validation rules inline (`:162-247`) |
| `apps/mobile/app/(tabs)/play.tsx` | 1120 | ~940-line component |
| `apps/mobile/app/(staff)/staff-content.tsx` | 1118 | Form, list and item in one file; access decided by the main role only (`:1102`) |
| `apps/mobile/src/features/staff/protocols/StepForms.tsx` | 1063 | `useSpec` (kind, step) ladder in a `.tsx` (`:113-228`); inline decider rule (`:258`) |
| `apps/mobile/app/staff.tsx` | 1021 | Dead `compact` flag (`:710`); owner tiles outside the registry (`:881-922`) |
| `apps/mobile/app/(staff)/staff-recipe-change.tsx` | 951 | One ~820-line function holding two role modes behind `head` (`:129-160`); fallback role `'head_chef'` |
| `apps/mobile/src/features/staff/protocols/logic.ts` | 922 | Parallel copy of operator protocol logic; has drifted (`:128,736,759,858`) |

## Looks bad but is fine

- **Screens never call RPCs.** Only auth screens import `supabase` (`sign-in.tsx:3`, `profile-edit.tsx:871` passes it to `startPhoneLink`), and that is `supabase.auth` / feature APIs. Data access lives in `src/features/*/api.ts`.
- **Inline `useQuery` / `useMutation` in the staff screens (118 calls).** Almost all use the exported `staffKeys` families and feature `fetch*` functions, which the mobile CLAUDE.md allows. Only the two inline keys in the inline-keys finding break the rule.
- **`AREA_ROLES` copies the operator's `ROUTE_ROLES` (`src/features/staff/access.ts:44-75`).** The copy is deliberate (the phone cannot import the operator), and a text-parsing test pins it (`__tests__/access.test.ts:69-78`). It is noted under the capability-lists finding as the model the capability table should follow, not as a separate finding.
- **`app/_layout.tsx` (615 lines, 12 effects).** It is the composition root. Each effect delegates to one named hook, and the order dependency between the push-lifecycle effects (`:243-275`) is deliberate and documented.
- **`app/play-survey.tsx` latches state in render (`setAskGender` at `:248`).** React allows this pattern. The survey's step logic lives in `features/playProfile` (`surveyStepsFor`, `nextStep`, `withLevel`).
- **Very long header comments (`bookings.tsx:123-200`, `profile-edit.tsx:116-157`).** The repo documents owner decisions next to the code; that is documentation, not debt.
- **Exported symbols used only in their own file** (`IDEA_AUTHOR_ROLES`, `VENUE_OFFSET_MINUTES`, `fetchPushPrefs`, and about 40 others found by a repo-wide grep over apps/packages/scripts/docs/qa with a file count of 1). Each is used inside its file (2+ occurrences), so none is dead. No dead code was reported: nothing passed the dead-code gate.
- **Different call ordering on the phone (newest first, `calls/logic.ts:66-80`) and the till (oldest first, `WaiterCallsPanel.tsx:74`).** The comments cite separate design decisions (§2.1.8 and fairness). The urgency rule itself matches in effect, so it appears only as duplication in the RPC-readers finding.
- **`coach-mode-book` calls `startProblem` without a cut-off (`:204`), while New session (`coach-mode-new.tsx:159`) and move (`coach-mode-lesson.tsx:360`) pass one.** This may be deliberate (a booked private lesson has no session cut-off). It is not called a bug without the owner's confirmation.

## Debt Summary

| Risk | Findings | Avg Priority | Classification | Intent |
|------|----------|-------------|----------------|--------|
| Cognitive Overload      | 2 | 5.0 | Scheduled | accidental |
| Change Propagation      | 2 | 2.5 | Monitored | mixed (registries intentional) |
| Knowledge Duplication   | 9 | 3.8 | Scheduled (borderline) | accidental |
| Accidental Complexity   | 2 | 1.0 | Monitored | accidental |
| Dependency Disorder     | 1 | 4.0 | Scheduled | accidental |
| Domain Model Distortion | 2 | 4.5 | Scheduled | accidental |

**Recommended focus:** Domain Model Distortion and Knowledge Duplication together. One person-aware staff capability table in `packages/core`, used by both apps, fixes the second-job bugs and removes about 25 hand-written role lists. Second, move the pure protocol, activity and menu-option logic into core, starting with the tournament-class reader that has already drifted.

## Summary

The most important fix is to make the phone's staff pages ask about the person (all their jobs, `rolesOf`) through one shared capability table, rather than `staff.role` in 42 places. Today a second-job driver, marketer or court-desk person passes the gate and then gets a page that does not work for them. After that, the trend to stop is parallel logic in the two apps: protocol readers and form models, content limits, the activity board and menu options each exist two or three times, and three copies have already drifted (tournament classes, content length, option rules). The giant route components are the third priority: split them only where the logic they hold has no tests (coach booking, payment status, recipe change).

**Counts:** 0 Critical, 9 Warning, 9 Suggestion. Health Score 100 − 9×5 − 9×1 = 46.
