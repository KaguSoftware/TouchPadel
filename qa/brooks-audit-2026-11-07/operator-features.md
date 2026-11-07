# Brooks-Lint Review

**Mode:** Tech Debt Assessment
**Scope:** `apps/operator/src/features/{assistant, attendance, checklists, coaching, files, financial, floor, guide, holds, incidents, matches, monitoring, observation, ops, panel, players, protocols, ranks, rewards, roleExtras, setup, tasks, tournaments}`: 23 folders, 487 files, 98,183 lines including tests (63,563 non-test lines). Cross-feature imports were mapped across all 41 operator feature folders, because cycles run through features outside this lane (desk, till, admin, stock, deductions). Read-only. No `.brooks-lint.yaml` in the repo, so defaults apply (balanced).
**Health Score:** 42/100

These features are each well commented and the pure logic is well tested, but they are not separable. No feature has a public surface, and 21 of the 41 operator feature folders form one dependency cycle. A small set of shared helpers and widgets sit inside unrelated features (ops, checklists, roleExtras, deductions, desk) and cause much of that cycle. The protocol step-form stack exists twice, once in `protocols/` and once in `tasks/`.

Evidence files (scratchpad): `of_imports.txt` lists every cross-feature import edge with `file:line`. `of_dead.txt` holds the dead-code scan.

---

## Findings

### 🟡 Warning

**R5 Dependency Disorder — 21 operator features form one strongly connected import cycle, and no feature has a public surface (Warning)**
Symptom: An import scan of `apps/operator/src/features` (production files only, tests excluded) finds 20 two-way feature pairs and one strongly connected component of 21 features: admin, checklists, coaching, deductions, deposits, desk, holds, incidents, marketing, matches, ops, plan, players, protocols, ranks, roleExtras, stock, tasks, till, tillShift, tournaments. Representative two-way edges:
- desk ⇄ coaching (24 / 18 imports): `desk/TodaysBoard.tsx:68-74` imports `coaching/StartLessonDialog` and `useCoaching`; `coaching/StartLessonDialog.tsx:58-60` imports `desk/customers/CustomerPicker`, `desk/wizardParts` and `desk/deskLogic`.
- desk ⇄ matches (32 / 14): `desk/DeskCalendar.tsx:104-108` ⇄ `matches/StartMatchDialog.tsx:37-41`, including a type taken from `desk/CreateReservationDialog` at line 40.
- coaching ⇄ till: `coaching/LessonRosterPanel.tsx:44` and `coaching/TakeLessonPayment.tsx:27` import `till/PaymentPane`; `coaching/LessonRefundsDue.tsx:31` imports `till/ManagerActions`. The other direction is `till/*`, for example `till/NewTabDialog.tsx:24`, which imports `coaching/lessonLogic`.
- matches ⇄ till: `matches/MatchPlayersPanel.tsx:39` imports `till/PaymentPane`; `till/TillScreen.tsx:69`, `till/tillData.ts:16` and `till/OpenTabs.tsx:78` import `matches/matchLogic`.
- coaching ⇄ matches: `matches/matchLogic.ts:26` imports `isLessonLiteral`; `coaching/useCoaching.ts:32` imports `matchReadStatus`.
- matches → admin: `matches/matchLogic.ts:24-25` imports `admin/branches/branchesLogic` and `admin/qr/qrCardGeometry`. admin → matches: `admin/DayClose.tsx:54-55` and `admin/settings/MatchSettingsPanel.tsx:28-30`.
- Smaller cycles outside the big one: guide ⇄ kds (`guide/guideContent.ts:19-20` ⇄ `kds/KdsBoard.tsx:56`) and assistant ⇄ analytics (`assistant/PinControl.tsx:13-14` ⇄ `analytics/components/AssistantComponentCard.tsx:27`).
No feature folder has an `index.ts`, so every one of these imports reaches a feature's internal file directly. `apps/operator/eslint.config.mjs:21-29` restricts only `electron`, `fs` and `node:fs`. There is no boundary or `import/no-cycle` rule.
Source: Martin, Clean Architecture — Acyclic Dependencies Principle; Brooks, The Mythical Man-Month — Conceptual Integrity; Hunt & Thomas — Decoupling.
Consequence: Nothing can be tested, reasoned about or extracted feature by feature. Renaming one internal helper in desk, coaching or matches means checking up to 20 other folders, because any of them may import that exact file. Lazy route chunks (`routes/*.tsx` use `lazyRouteComponent`) cannot split cleanly along a cycle, so a till station's chunk graph reaches coaching and match code. Severity is Warning, not Critical: I found no runtime failure, and Vite tolerates cycles. The cost is the change burden and the lost isolation.
Remedy: (1) Do the kernel extraction in the next finding first. That alone cuts the component from 21 to 10 features (re-run of the scan with those edges removed). (2) Break the remaining UI cycles by moving the shared payment widget (`till/PaymentPane`, `till/ManagerActions`) to `src/components/payment/`. Then move `isLessonLiteral` and `matchReadStatus` to a `features/booking-kinds` leaf, or to `packages/core`, and move `resolveGuestSiteUrl` and `branchTone` to `src/lib`. (3) Give each feature an `index.ts` and add an ESLint `no-restricted-imports` pattern that bans `../<feature>/<internal>` across folders. Add `import/no-cycle` scoped to `src/features`.
Fix-Class: Residual. It moves exported symbols across many files and is far beyond 5 files per pass.
Priority: Pain 3 × Spread 3 = 9
Intent: accidental

**R5 Dependency Disorder — Shared helpers and widgets live inside unrelated features and are imported up to 50 times (Warning)**
Symptom: Generic building blocks sit inside a feature that happened to need them first:
| Module | What it really is | Importers (non-test) |
|---|---|---|
| `ops/OpsVisuals.tsx` (254 lines; `FigureRow`, `CardTitle`, `RowList`, `Step`, `MARK*` tones) | design primitives | 50 files in 22 features (stock ×12, admin ×10, tillShift ×4, …) |
| `roleExtras/roleExtrasLogic.ts:11-26` (`isObject`, `str`, `num`, `list`, `role`, `bilingual`) | JSON payload readers | 17 files in 11 features, plus `lib/navBadges.ts:17` |
| `protocols/errors.ts` (`protocolErrorKey`, `refusalCode`, `refusalHint`) | the generic refusal mapper | 16 files (wages, deductions, incidents, admin settings, safe, rewards, …) |
| `checklists/StaffPhoto.tsx` (`STAFF_MEDIA_BUCKET`, `useSignedPhoto`, `PhotoViewer`) | staff-media storage widget | 14 files |
| `deductions/venueDate.ts` (`venueToday`, `addDays`, `shiftMonth`, `venueWallValue`) | venue calendar helpers | 6 files (attendance, incidents, rewards, tasks, content) |
| `desk/customers/CustomerPicker`, `desk/wizardParts`, `desk/deskLogic` (`sanitizeName/Phone`), `desk/useTradingNight`, `desk/weekLogic`, `desk/calendar/*` | booking-wizard kit and trading-night date maths | coaching, matches, tournaments, ranks, players, observation (≈45 imports) |
| `stock/decimalInput`, `stock/stockUi` | input and format kit | protocols, rewards, roleExtras, tasks |
`ops` is both the owner of this design kit (high fan-in) and the Today aggregator. `ops/NeedsYou.tsx:27-40` imports plan, stock, deposits, deductions and tillShift (high fan-out). The kit therefore inherits ops's instability, and that creates the ops⇄stock, ops⇄tillShift, ops⇄deductions, ops⇄deposits and ops⇄plan cycles.
Source: Martin, Clean Architecture — Stable Dependencies Principle and Common Reuse Principle; Fowler, Refactoring — Inappropriate Intimacy.
Consequence: A change to the ops Today screen, the roleExtras suggestion box or the deductions page can break wages, stock or incidents. Developers looking for a payload reader or a figure row do not find one in `components/` or `lib/`, so they write another (see the R3 findings below). Together these modules account for 11 of the 21 features in the cycle.
Remedy: Move them into stable leaf homes without changing behaviour: `OpsVisuals` → `src/components/figures.tsx`, `StaffPhoto` → `src/components/StaffPhoto.tsx`, `protocols/errors` → `src/lib/refusals.ts` (keep the coaching `PRICE_TARGET_CHANGED` branch in coaching), the reader primitives → `src/lib/payload.ts`, `venueDate` and the desk date helpers → `src/lib/venueTime.ts` (or `packages/core/time`), and the booking-wizard kit → `src/components/booking/`. Leave a re-export at each old path for one release, then delete it.
Fix-Class: Residual. It changes the exported paths of widely used symbols across more than 5 files. Each single move done with a re-export shim is Extended-Safe.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication — The protocol step-form stack is built twice, in `protocols/` and in `tasks/` (Warning)**
Symptom: `@touch/core/protocols` provides one field list so that "the two apps cannot ask for different things" (`protocols/StepForm.tsx:1-5`). Inside the operator, however, two independent walkers and models consume that list:
- Form renderers: `protocols/StepForm.tsx` (1,361 lines) and `tasks/ProtocolForm.tsx` (514) plus `tasks/StepFormFields.tsx`.
- Form models: `protocols/formModel.ts` (`blankValue`, `initialValue`, `cleanRecord`, `getAt`/`setAt`, `hintOf`) and `tasks/formModel.ts` (`emptyValue`, `emptyDraft`, `toRecord`, `getIn`/`setIn`, `hintFor`). They cover the same jobs under different names.
- Same-named sibling files: `StartSheet.tsx` (359 / 217 lines), `PhotoField.tsx` (163 / 218), `search.ts` (107 / 35), `keys.ts`, `api.ts`. `incidents/ReportIncidentForm.tsx:40` uses the tasks copy of `PhotoField`.
- Price targets: `protocols/priceTargets.ts:223 readTargets` and `tasks/priceLogic.ts:87 readTargets` parse the same RPC (`app.price_promo_targets`) into different shapes (snake_case driven by COACHING_SHAPES versus hand-written camelCase). Each is cached under its own key: `protocols/keys.ts:24` `['protocols','targets',…]`, fetched at `protocols/api.ts:83` with `p_venue_id: null`, and `tasks/keys.ts:18` `['protocols','taskTargets',…]`, fetched at `tasks/StepFormFields.tsx:127` without that argument.
- `renameKeyOf` is byte-identical in `protocols/renames.ts:22-26` and `tasks/priceLogic.ts:179-183`. The rename-pruning rule is written twice: `protocols/renames.ts:104 finalizeRenames` and `tasks/formModel.ts:197 withoutUnchangedRenames`.
- The copies have already drifted in the blank value of a field. For `enum`, protocols applies defaults (`ENUM_DEFAULTS` at `protocols/formModel.ts:17-23`, including `when: 'now'` and `capacity.unit → 'players'`) and tasks starts at `''` (`tasks/formModel.ts:42-44`). For `bool`, protocols starts at `name === 'is_active'` and tasks at `required ? true : null` (`tasks/formModel.ts:52-53`). For `priceMap`, protocols starts at `{}` and tasks at `[{duration,price}]` (`tasks/formModel.ts:54-55`). The two copies also convert datetimes in different time zones (next finding).
Source: Hunt & Thomas — DRY; Fowler, Refactoring — Duplicate Code and Alternative Classes with Different Interfaces.
Consequence: Every new protocol field type, picker or validation rule has to be built twice. The same step can open with different defaults depending on whether a manager uses /protocols or a head uses /tasks, which is exactly what the shared core field list was meant to prevent. The diverging enum default for `when` changes what a head submits unless they touch the control.
Remedy: Pick one model, `protocols/formModel.ts` because it is the richer one, and one walker, `StepForm`, with a `mode: 'decide' | 'task'` prop (or a `hidden`/`sources` prop as `ProtocolForm` already takes). Move both into a `features/protocolForm/` leaf that both pages import. Fold `tasks/priceLogic.ts` into `priceTargets.ts` and share one query key. Delete the tasks copies once `StepSheet.test.tsx` and `MyTasks.test.tsx` pass against the shared form.
Fix-Class: Residual. It merges exported modules across about 12 files in 3 features, and the behaviour differences need a product decision on which defaults win.
Priority: Pain 3 × Spread 2 = 6
Intent: accidental

**R3 Knowledge Duplication — Protocol datetime fields use the station's local time zone, not the venue's (Warning, likely bug)**
Symptom: `protocols/formModel.ts:238-250` (`toLocalInput`, `fromLocalInput`) build the `datetime-local` value with `new Date(v)`, `getHours()` and `getDate()`, which is the browser or OS zone ("in this station's time", line 237). These functions back every `datetime` field in `protocols/StepForm.tsx:428-431` and `:1250`, and the candidates' interview time at `protocols/CandidatesPanel.tsx:180`. The tasks copy of the same field converts in the venue zone: `tasks/formModel.ts:74-99` (`localToIso`/`isoToLocal` with `VENUE_TZ` and `wallTimeToUtc`). The repo's own rule is stated at `deductions/venueDate.ts:7-8`: "The venue zone is fixed (VENUE_TZ), never the browser's."
Source: Hunt & Thomas — DRY (one decision, two answers); Fowler, Refactoring — Divergent Change.
Consequence: On any machine whose zone is not the venue's (the owner's laptop abroad, or a station with a wrong OS zone), a launch time, interview slot or schedule `at` entered on /protocols is stored shifted by the zone difference. The same field entered on /tasks is stored correctly. The test at `protocols/formModel.test.ts:94-96` only checks a round trip, so it passes in any zone.
Remedy: Replace the bodies of `toLocalInput` and `fromLocalInput` with the venue-zone conversions, either shared or by calling `tasks/formModel.ts` `isoToLocal`/`localToIso` with `VENUE_TZ`. Add a test that pins `TZ=UTC` and asserts the Baghdad wall time.
Fix-Class: Extended-Safe. It touches `protocols/formModel.ts` plus its test, keeps the signatures, and the operator test command exists.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R3 Knowledge Duplication — JSON payload readers (`isObject`/`str`/`num`/`list`) re-implemented 67 times with different meanings (Warning)**
Symptom: 67 local definitions in about 40 operator files (grep `^(export )?(const|function) (isObject|isRecord|asRecord|str|num|…)`). In this lane they disagree on what an empty or missing value means:
- `num`: `null` on garbage in `roleExtras/roleExtrasLogic.ts:13`, `coaching/lessonPayloads.ts:31`, `matches/matchPayloads.ts:20` and `assistant/useAssistantChat.ts:101`; `0` in `protocols/protocolLogic.ts:35`, `checklists/checklistLogic.ts:71`, `files/filesLogic.ts:38` and `monitoring/monitoringLogic.ts:93`; caller-chosen in `ops/opsLogic.ts:91` (`fallback = 0`).
- `str`: keeps `''` in `roleExtrasLogic.ts:12`, `lessonPayloads.ts:37` and `matchPayloads.ts:26`; turns `''` into `null` in `files/filesLogic.ts:37`, `monitoring/monitoringLogic.ts:94`, `players/playerLogic.ts:87` and `holds/holdStandingLogic.ts:30`; returns `''` for non-strings in `checklists/checklistLogic.ts:72`.
- `matches/matchPayloads.ts:16-33` is a copy of `coaching/lessonPayloads.ts:25-42` (`obj`, `list`, `num`, `str`, `flag`). The one shared copy that exists (`roleExtrasLogic`) lives in an unrelated feature.
Source: Hunt & Thomas — DRY; Fowler, Refactoring — Duplicate Code.
Consequence: Whether a missing count shows "0" or "—", and whether a blank name is "no name" or an empty label, depends on which file read it. Nobody can change the policy (for example, accepting numeric strings, which `lessonPayloads.ts:34` does and `protocolLogic.ts:35` handles differently) in one place.
Remedy: Create `src/lib/payload.ts` with explicitly named variants (`numOrNull`, `numOrZero`, `text`, `textOrNull`, `records`, `flag`). Point `roleExtrasLogic` at it with a re-export. Migrate file by file. The existing pure-reader tests (`*Payloads.test.ts`, `*Logic.test.ts`) are the safety net.
Fix-Class: Residual overall, because it spans about 40 files. Each per-feature migration of 5 files or fewer is Extended-Safe.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication — The bilingual-name fallback rule is implemented six ways, and one shared name means two things (Warning)**
Symptom: `lib/i18n.tsx:59-65 pickName(locale, row)` returns the locale column with no fallback. `tournaments/tournamentLogic.ts:41-48 pickName(locale, en, ar)` has the same name, a different signature, and falls back to the other language. The fallback is also copied as the private `pick` at `coaching/lessonLogic.ts:114-121`, as `bilingual` at `roleExtras/roleExtrasLogic.ts:22-26` (which also trims) and at `reports/coaches/statementsLogic.ts:65`, and as `nameIn` at `reports/ReportParts.tsx:132`. On top of these, 36 inline `locale === 'ar' ? x_ar : x_en` ternaries exist (10 in admin, 4 in coaching, 3 in protocols, …).
Source: Evans, Domain-Driven Design — Ubiquitous Language; Hunt & Thomas — DRY.
Consequence: A court, coach or item named in one language only shows blank on screens using `lib/i18n.pickName` or the inline ternaries, and shows the other language on coaching, tournament and role screens. Two exported `pickName`s with different contracts invite the wrong import. `coaching/StartLessonDialog.tsx` uses `lib/i18n`'s version while `lessonLogic` uses the fallback.
Remedy: Give `lib/i18n.pickName` the fallback-and-trim behaviour, since the bilingual-row rule "a row may carry one language" is stated in `roleExtrasLogic.ts:21`. Add an `(en, ar)` overload. Delete the five copies and replace the ternaries over time. Rename the tournaments export to avoid the clash in the meantime.
Fix-Class: Residual. It changes an exported helper's behaviour used across features.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication — "Venue day" and month-shift date maths written in at least six places (Warning)**
Symptom: The venue calendar date (`toLocaleDateString('en-CA', {timeZone})`) is written separately in `assistant/usageDates.ts:11-14` (`venueDate`), `observation/activity/activityLogic.ts:81-83` (`dayIn`), `desk/useTradingNight.ts:27-30` (`todayInTz`), `desk/weekLogic.ts:43-45` (`localDateOf`), `deductions/venueDate.ts:16-18` (`venueToday`) and inline at `tournaments/TournamentDetail.tsx:344`. `shiftMonth` exists three times: `desk/calendar/monthLogic.ts:37`, `deductions/venueDate.ts:34` and `safe/safeLogic.ts:288`. Day shifting exists as `addDays` (`deductions/venueDate.ts:21`, `packages/core/src/analytics/range.ts:63`), `shiftIsoDate` (`desk/weekLogic.ts:16`) and `addDaysIso` (`components/dateRangeLogic.ts:35`). Wall-clock `formatToParts` conversion appears in `tasks/formModel.ts:83`, `deductions/venueDate.ts:52`, `desk/weekLogic.ts:49` and others. `packages/core/src/time/tz.ts` exports `localParts` and `wallTimeToUtc` but no venue-day or month helpers. The tz source also differs: `deductions/venueDate.ts` defaults to the fixed `VENUE_TZ`, while the desk and assistant helpers take `venue_settings.timezone`.
Source: Hunt & Thomas — DRY; McConnell, Code Complete — Ch. 12 (fundamental data types).
Consequence: "Today" already means three things in the lane: calendar day (activity monitor, assistant meter), trading night (desk `tradingDateOf`) and business day (reports `venueDay` with a start hour). None of them is named in core. A branch in a different zone, or a change to the business-day start hour, needs a search over a dozen files.
Remedy: Add `venueDay(instant, tz)`, `addDays`, `shiftMonth`, `monthOf` and `wallValue`/`fromWallValue` to `packages/core/src/time` (pure, testable). Keep `tradingDateOf` and the business-day helper as named concepts next to them. Migrate callers, starting with the copies inside this lane.
Fix-Class: Residual. It is cross-package and touches more than 5 files.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R1 Cognitive Overload — God components: 400–700-line single components holding the whole flow's state and writes (Warning)**
Symptom:
- `coaching/StartLessonDialog.tsx` (1,026 lines): one component (lines 141–815) with 23 `useState`, three create flows (`desk_book_lesson`, `desk_create_group`, `desk_create_course`) chosen by an if/else on `kind` inside `submit()` (lines 336–409), and a 30-line `blockText` switch (lines 280–316). It has 13 props.
- `tournaments/start/TournamentStartSheet.tsx` (1,373 lines): `TournamentStartSheet` spans lines 92–777 and `CourtsSection` spans 962–1358.
- `protocols/StepForm.tsx` (1,361 lines, 28 inner functions). It has no unit test of its own and is covered only through `ProtocolsPage.test.tsx` and e2e.
- `assistant/Thread.tsx` (771 lines): a single component (lines 46–771) with 9 queries, 2 mutations, 10 `useState` and 3 effects. No test.
- `ranks/RanksScreen.tsx` (953 lines, 15 components, 19 `useState`, 5 queries). No test.
- `matches/StartMatchDialog.tsx` (530 lines): one component from line 92 with 17 `useState` and two `react-hooks/exhaustive-deps` disables (lines 123, 165).
- `observation/courts/CourtsObserve.tsx` (803) and `incidents/ReportIncidentForm.tsx` (761) have no test.
Source: Fowler, Refactoring — Long Method and Large Class; McConnell, Code Complete — Ch. 7 (High-Quality Routines); Ousterhout — deep modules.
Consequence: These are the screens that create bookings, lessons and tournaments. A change to one lesson kind means reading the state of all three. Untested 800–1,000-line screens (Thread, RanksScreen, CourtsObserve, ReportIncidentForm) depend on e2e runs, which the memory notes are load-bound on this Mac.
Remedy: Split by flow, not by size. For StartLessonDialog, use `PrivateLessonForm`, `GroupLessonForm` and `CourseForm`, each owning its state and its RPC, behind a kind picker. The pure `startLessonLogic.ts` already exists, so this is a mechanical move. For TournamentStartSheet, move `CourtsSection` to its own file with a hook. For Thread, extract `useThreadData` (queries and mutations) from the rendering. Add a jsdom smoke test for Thread, RanksScreen and CourtsObserve before splitting them.
Fix-Class: Residual. Each split has to keep the exported component signature, and three of the files have no tests to fall back on.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R2 Change Propagation — Coaching's 1,900-line payload module and 1,000-line logic module act as the coaching API for six other features (Warning)**
Symptom: `coaching/lessonPayloads.ts` is 1,903 lines with 107 exports and 29 `read*` readers for every coaching RPC: lessons, coaches, schedules, statements, settings and refunds (section banners at lines 64–1824). `coaching/lessonLogic.ts` is 1,030 lines with 64 exports covering names (114–160), places chips (192–234), pay state (245–295), banners (391–490), the event log (506–566), money lines (596–690), roster actions (692–800), cancel codes (803–835) and a 125-line error ladder (865–989). Non-test importers from other features: `lessonPayloads` ×26, `useCoaching` ×20, `lessonLogic` ×20, from admin (36 imports in total, e.g. `admin/settings/CoachingSettingsPanel.tsx:31-43`), reports (26), desk (24), ops (`ops/LessonRefundsDuePanel.tsx:28-33`), observation (`observation/courts/CourtsObserve.tsx:38-43`), financial (`financial/FinancialHome.tsx:42`), deposits and till.
Source: Fowler, Refactoring — Divergent Change; Ousterhout — Information Leakage.
Consequence: A coach-statement reader change, a desk banner change and an admin settings change all edit the same two files, and each edit re-runs the type check for six features. Internal reader shapes have become an implicit contract (Hyrum's Law) for reports and admin.
Remedy: Split along the sub-domains already marked by the section banners: `payloads/lessons.ts`, `payloads/coaches.ts`, `payloads/statements.ts`, `payloads/settings.ts`, and `lessonNames.ts`, `lessonMoney.ts`, `lessonErrors.ts`. Re-export everything from a `features/coaching/index.ts` and have other features import only from it.
Fix-Class: Residual. It moves exported symbols used by more than 5 files in 6 features. Doing it behind an index re-export keeps it Extended-Safe per sub-step.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication — The "owner may decline without a reason" permission is written inline twice, beyond the CLAUDE.md limit (Warning)**
Symptom: `protocols/DecisionDialog.tsx:66` and `roleExtras/Ideas.tsx:193` both say `const byOwner = useAuth().staff?.role === 'owner';` to apply the same rule ("0361: the owner declines with no reason; a head or a manager says why", `Ideas.tsx:192`). `apps/operator/CLAUDE.md` ("Roles and routes") says: "Never write `staff.role === '…'` inline … Four inline comparisons remain (Q4); do not add a fifth." Across the operator I count 9 such sites today: `admin/staff/StaffAccountEditor.tsx:290,310,369,420`, `reports/ReportBranchScope.tsx:45`, `lib/venue.tsx:187`, plus these two. Both lane sites also compare `staff.role` rather than asking about the person, which the 0345 rule forbids (an owner-as-second-job is not modelled).
Source: Hunt & Thomas — DRY; Brooks, The Mythical Man-Month — Conceptual Integrity (one place to change a permission).
Consequence: If the reason rule extends to a second role, or the server rule changes, two screens must be found by grep, and `CAPABILITY_ROLES` (`lib/auth.tsx:487`) no longer tells the whole story. This breaks a documented repo rule.
Remedy: Add `declineWithoutReason: ['owner']` to `CAPABILITY_ROLES` and use `can(staff, 'declineWithoutReason')` in both components.
Fix-Class: Extended-Safe. Three files, no exported signature changes, and `auth.test.ts` exists.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

### 🟢 Suggestion

**R3 Knowledge Duplication — The idempotency-key hook is triplicated and the key shape is written five ways (Suggestion)**
Symptom: `useMatchIdemKey` (`matches/useMatches.ts:222-230`), `useTournamentIdemKey` (`tournaments/useTournaments.ts:167-175`) and `useLessonIdemKey` (`coaching/useCoaching.ts:357`) are the same 8 lines, differing only in the mint function (`mintMatchKey`:211, `mintTournamentKey`:158, `mintLessonKey`:327). The private `refresh(qc, keys)` helper is duplicated next to the first two (`useMatches.ts:234`, `useTournaments.ts:179`). Protocol keys are minted three more ways: `protocols/formModel.ts:258-262 mintKey` (with a `Math.random` fallback), and inline `` `protocol.submit:${crypto.randomUUID()}` `` at `tasks/StepSheet.tsx:189`, `desk/CourtBlock.tsx:302` and `admin/staff/StaffList.tsx:396`. `lib/idem.ts:42 onlineKey` exists for exactly this case (online RPCs with `p_idempotency_key`) and is used once.
Source: Hunt & Thomas — DRY.
Consequence: The renew-after-success rule and the key format (a server `claim_replay` contract) can drift per feature. The protocols fallback key is not a UUID.
Remedy: Add one `useIdemKey(prefix, action)` hook (and `useDraftIdemKeys`) to `src/lib/idem.ts`, and make the three feature hooks one-line aliases.
Fix-Class: Extended-Safe. Four files, existing names kept as aliases.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R4 Accidental Complexity — Dead exports and production-dead, test-only helpers (Suggestion)**
Symptom: Each symbol below appears only at its definition. I checked with `grep -rnw <name> apps packages e2e scripts docs qa`, excluding node_modules and dist, which covers code, tests, docs, JSON registries and SQL, and so includes string lookups. None is exported from a package.
- `assistant/AssistantDrawer.tsx:82 AssistantRailButton` (a whole rail component, superseded by `components/RailMoreMenu`)
- `assistant/UsageMeter.tsx:28 slotTotal`
- `coaching/lessonLogic.ts:525 LessonEventType`, `:811 CoachingCancelCode`
- `coaching/lessonPayloads.ts:76 COURSE_STATUSES`, `:79 STATEMENT_STATUSES`, `:80 LESSON_CANCEL_REASONS`, `:100 BOOKED_BY_KINDS`
- `files/compress.ts:24 MAX_STORED_BYTES`
- `floor/floorModel.ts:349 EMPTY_SNAPSHOT`
- `ops/OpsVisuals.tsx:162 RowGroupLabel`
- `protocols/protocolLogic.ts:381 isFinished`, `:399 standingSubmission`, `:719 lastStepKey`
- `protocols/priceTargets.ts:433 targetItemName`
- `ranks/ranksLogic.ts:14 RANKS_PERIODS`
- `tournaments/tournamentLogic.ts:266 registeredCount`
Used only by tests: `matches/matchLogic.ts:918 seatOwedNow` (the panel handles `SEAT_OWED_CHANGED` by re-reading, `MatchPlayersPanel.tsx:299`), `matches/startMatchLogic.ts:218 startSeatLabels`, `coaching/lessonScreenLogic.ts:468 deskDueTotal`, `coaching/lessonPayloads.ts:1692 readCancelledLesson`, `players/playerLogic.ts:163 agreesWithGames`, `tournaments/layoutLogic.ts:124 statusCounts`, and `assistant/freeThreadLogic.ts:146 saveFreeThread`. The last one is the writer of the session-storage thread that `freeChats.ts:101-103` now only migrates away from, a format that was live from 2026-10-16 to 2026-10-20 and stored per tab. The `Tr` type alias is also re-declared in `matchLogic.ts:31`, `lessonLogic.ts:41` and `tournamentLogic.ts:23`.
Source: Fowler, Refactoring — Speculative Generality and Dead Code.
Consequence: About 300 lines of code and tests that readers must assume are live. `AssistantRailButton` and `saveFreeThread` describe UI and storage that no longer exist.
Remedy: Delete the 17 dead exports. Delete the test-only helpers together with their test cases, or wire them in if the behaviour was meant to ship (`seatOwedNow` → show the new owed amount). Drop the free-thread migration after one release.
Fix-Class: Safe for the unexported-after-check removals inside one file. The test-only ones touch a test file too, which makes them Extended-Safe.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R2 Change Propagation — Cross-feature cache invalidation by raw string literals (Suggestion)**
Symptom: `roleExtras/Ideas.tsx:199-200`, `roleExtras/RecipeChanges.tsx:245`, `tasks/StepSheet.tsx:207`, `tasks/StartSheet.tsx:69,123-124` and `protocols/StartSheet.tsx:237` invalidate `['protocols']` and `['ideas']` as literals. `protocols/keys.ts:13` exports `PROTOCOLS_ROOT` for exactly this, and no `ideas` root constant exists anywhere.
Source: Ousterhout — Information Leakage.
Consequence: Renaming the protocols or ideas root silently stops refreshes on three pages. Typecheck cannot catch it.
Remedy: Import `PROTOCOLS_ROOT`, and add an `IDEAS_ROOT` next to `QK` in `lib/queryKeys.ts`.
Fix-Class: Extended-Safe. Five files, no exported signature changes.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication — Per-feature error helpers duplicate each other (Suggestion)**
Symptom: `detailOf` is exported from `tournaments/tournamentLogic.ts:51` and re-written privately at `coaching/lessonLogic.ts:852`. `codeOf` (`tournamentLogic.ts:148`) and `refusalCode` (`protocols/errors.ts:29`) answer the same question. The `PRICE_TARGET_CHANGED` → `ws.coaching.errors.priceTargetChanged.*` mapping exists at both `protocols/errors.ts:21-25` and `coaching/lessonLogic.ts:937-939`.
Source: Hunt & Thomas — DRY.
Consequence: A new detail shape (for example, JSON details) has to be taught to each helper separately.
Remedy: Put `codeOf`, `detailOf` and `hintOf` in `lib/errors.ts`. Keep the per-feature detail ladders, which are legitimate, but have them call the shared helpers. Keep one `PRICE_TARGET_CHANGED` mapping.
Fix-Class: Extended-Safe. Four files.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R1 Cognitive Overload — `floorScene.ts` is one 1,320-line closure (Suggestion)**
Symptom: `floor/floorScene.ts:331-1651`: `createFloorScene` builds the renderer, the camera, the controls and the whole venue's static architecture (courts, the strip blocks, the bar, cafe tables, plants, the shop; sections at lines 464–1150), and also holds the live layer (`apply`, 1158–1354), focus, zoom and dispose. Nesting reaches 5 levels at line 1181. It has no test; `floorModel.ts`, `rally/*` and `LiveFloor.tsx` are tested.
Source: Fowler, Refactoring — Long Method; McConnell, Code Complete — Ch. 7.
Consequence: An owner request to move one room means scrolling a 1,300-line function whose locals are all in scope together. Rated Suggestion because the module sits behind a small handle interface (`FloorSceneHandle`), serves one owner-only view, and changes about 7 times since September.
Remedy: Extract `buildArchitecture(scene, materials)` (static and pure apart from three.js) and `createLiveLayer(scene)` as sibling modules. Keep `createFloorScene` as the composition.
Fix-Class: Safe as a single-file extraction of non-exported helpers. Splitting it into files is Extended-Safe.
Priority: Pain 1 × Spread 1 = 1
Intent: accidental

**R3 Knowledge Duplication — The floor rally copy points at a source that moved, and has drifted (Suggestion)**
Symptom: `floor/rally/racket.ts:1-8` says it was "COPIED from apps/mobile/src/features/courtTransition/racket.ts … keep everything else byte-identical". That file no longer exists. The racket now lives in `packages/court3d/src/racket.ts`, and `apps/mobile/src/features/courtTransition/` has no racket file. Diffs against `packages/court3d/src`: `racket.ts` 34 lines, `rally.ts` 259 lines, `swing.ts` 14, `svgPath.ts` 14, `smileyPaths.ts` 11, `smileyMark.ts` 9. The reason given for the copy still holds: operator pins three 0.184 (`apps/operator/package.json:29`) and court3d's peer is 0.160 (`packages/court3d/package.json:16`).
Source: Hunt & Thomas — DRY (documented duplication must keep its pointer true).
Consequence: The "diff shows only FLOOR: changes" check that protects the copy is no longer possible, so artwork fixes in court3d will not reach the owner's floor.
Remedy: Repoint the headers at `packages/court3d/src/*`. Either re-sync the copies, or widen court3d's three peer range so the operator can import it directly.
Fix-Class: Safe for the header correction (comments, one file each). Re-syncing is Extended-Safe.
Priority: Pain 1 × Spread 1 = 1
Intent: intentional (copy documented; pointer stale)

**R5 Dependency Disorder — `lib/` and `components/` import feature internals (Suggestion)**
Symptom: `lib/edge.ts:21` (the edge-function transport) imports `parseSseChunk` and `parseSseData` from `features/assistant/sse`. `lib/navBadges.ts:15-17` imports `ops/protocolsWaiting`, `roleExtras/api` and `roleExtras/roleExtrasLogic`. `components/RailMoreMenu.tsx:11` imports `assistant/AssistantDrawer`. Other lanes' features do the same in `lib/navBadges.ts:13-28` and `lib/navAccess.ts:13-14`.
Source: Martin, Clean Architecture — Stable Dependencies and Dependency Inversion.
Consequence: Infrastructure (`edge.ts`, used by every edge call) changes when the assistant feature changes. Rated Suggestion because `navBadges` is arguably a composition root.
Remedy: Move `sse.ts` to `src/lib/sse.ts`. It is a wire-format parser with its own test. Treat `navBadges` as a composition root and leave it, once the kernel moves above are done.
Fix-Class: Extended-Safe. Three files (move plus two imports plus the test).
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R6 Domain Model Distortion — The live floor plan is one building's geometry in a multi-branch app (Suggestion)**
Symptom: `floor/floorModel.ts:34-41` hard-codes "the venue as built: two courts, nine tables" (`COURT_SLOTS = 2`, `TABLE_SLOTS = 9`), and `floor/floorScene.ts:6-10` builds the YCA_PADEL CAD layout. `panel/ManagementPanel.tsx:74` shows it on the owner's Overview for whichever branch the rail switcher selects (multi-venue since 2026-09-26, `apps/operator/CLAUDE.md` "Branches"). `floorModel.ts:44-48` also re-states the server's default `heartbeat_stale_seconds` (45) as a client constant.
Source: Evans, Domain-Driven Design — the model should say what the domain says (a branch has its own layout).
Consequence: A second branch's courts and tables are drawn into the first branch's building, and extras are shown as "not on this plan". This was an intentional owner call, made 2026-09-18 before multi-branch existed.
Remedy: Short term, show the 3D plan only for the branch it models (a `venue_settings` flag), and show the counts elsewhere. Longer term, make the layout data per branch.
Fix-Class: Residual. It needs a product decision.
Priority: Pain 1 × Spread 1 = 1
Intent: intentional

---

## Top offenders

| File | Lines | What's tangled |
|---|---|---|
| `coaching/lessonPayloads.ts` | 1,903 | Every coaching RPC reader (107 exports) and private copies of `num`/`str`/`list`; imported by 6 other features |
| `floor/floorScene.ts` | 1,651 | One 1,320-line closure: renderer, camera, a whole building's geometry, live layer, zoom; untested |
| `tournaments/start/TournamentStartSheet.tsx` | 1,373 | A 685-line component plus a 400-line `CourtsSection`; shared by `protocols/StartSheet` and `tasks/StartSheet` |
| `protocols/StepForm.tsx` | 1,361 | Walker for every protocol form; duplicated by `tasks/ProtocolForm.tsx`; no unit test |
| `tournaments/RoundsBoard.tsx` | 1,030 | 12 `useState`, 3 queries, rounds, scores, corrections and leaderboard in one file |
| `coaching/lessonLogic.ts` | 1,030 | Names, chips, pay state, banners, events, money lines, roster actions, a 125-line error ladder |
| `matches/matchLogic.ts` | 1,026 | Match labels, money, invites (imports admin QR geometry), errors; imported by till ×6, desk, admin, ops, floor, observation |
| `coaching/StartLessonDialog.tsx` | 1,026 | Three create flows, 23 `useState`, 13 props |
| `ranks/RanksScreen.tsx` | 953 | 15 components, 19 `useState`, 5 queries; no test |
| `observation/courts/CourtsObserve.tsx` | 803 | Imports 9 desk and 6 coaching internals; no test |
| `assistant/Thread.tsx` | 771 | A single 725-line component, 9 queries, 2 mutations; no test |
| `ops/OpsVisuals.tsx` | 254 | Small, but the most-imported file in the lane (50 importers in 22 features) and the root of 5 ops cycles |

## Looks bad but is fine

- **The mutation-type lists and `QUEUE_WRITE_KEY` in other features.** The six code copies of mutation types are required by `apps/operator/CLAUDE.md` ("Writes") and are policed by tests. Not debt.
- **Per-feature error ladders** (`coachingErrorKey` `lessonLogic.ts:865`, `matchErrorKey` `matchLogic.ts:936`, `tournamentErrorKey` `tournamentLogic.ts:91`). Each maps a server code plus a feature-specific `details` value to that feature's catalogue keys, on top of the central `MAPPED_CODES`. That is legitimate bounded-context translation. Only the shared helper duplication is flagged.
- **`isLessonLiteral` and the `'Lesson'` guest-name sentinel** (`coaching/lessonLogic.ts:51-63`). It looks like a stringly typed discriminator. `kind = 'lesson'` arrived in 0273, but the literal is still needed for held-lesson `hold` rows without a `desk_lessons` row (offline). It is documented as OP-19 and pinned "byte for byte" to the DB literal.
- **Reservation status sets** (`observation/observeLogic.ts:20` BOOKED, `floor/floorData.ts:52`, `floor/floorModel.ts:266`, `ranks/ranksLogic.ts:408`, `desk/deskLogic.ts:11` BLOCKING). These look like a duplicated decision, but each set answers a different question (counts as booked, blocks a slot, shows as on the floor, can record a result), and each mirrors its own RPC's rule with a comment. A named set in `packages/core/status` would be nice but is not drift.
- **`ops/NeedsYou.tsx`, `panel/PanelNeedsYou.tsx` and `financial/FinancialHome.tsx` fan-out (11–23 imports).** These are aggregator screens, which is composition-root fan-out. They are flagged only where they create cycles (the ops kit).
- **`tournaments/engine.ts`, a pure re-export of `@touch/core/tournaments`.** It looks like a middle man, but it is the documented single seam so the generators are not reimplemented in the app (engine.ts:1-8).
- **`floor/rally/*` being a copy at all.** The three.js version split (0.184 versus 0.160) is real. Only the stale pointer and the drift are flagged.
- **Shared query roots `['protocols', …]` across `tasks/keys.ts` and `protocols/keys.ts`.** This is deliberate (one invalidation refreshes both pages, `tasks/keys.ts:1-7`). Only the raw literals and the duplicate `targets` cache are flagged.
- **Money maths.** No IQD arithmetic is re-implemented in this lane. A grep for price, fee and amount multiplications or divisions in coaching, matches, tournaments, ranks, holds and players found none, and amounts come from the server.
- **TODO/FIXME.** None in the lane.
- **`useAssistantChat.ts:161-165` `as unknown as` on SSE events.** These are unchecked casts, but the stream comes from the repo's own edge function and the turn reducer tolerates missing fields. Noted, not scored.
- **`desk/CreateReservationDialog` imported by `matches/StartMatchDialog.tsx:40`.** It is type-only (`CreateNight`). It is counted in the cycle finding and is not a separate issue.

## Debt Summary

| Risk | Findings | Avg Priority | Classification | Intent |
|------|----------|-------------|----------------|--------|
| Cognitive Overload      | 2 | 3.5 | Monitored/Scheduled (god components 6, floorScene 1) | accidental |
| Change Propagation      | 2 | 4.0 | Scheduled (coaching API 6) / Monitored (literal keys 2) | accidental |
| Knowledge Duplication   | 9 | 4.1 | Scheduled (protocol form stack 6, payload readers 6, bilingual names 6, venue day 6, tz bug 4, owner inline 4) / Monitored (idem keys 2, error helpers 2, rally copy 1) | accidental (rally copy intentional) |
| Accidental Complexity   | 1 | 2.0 | Monitored | accidental |
| Dependency Disorder     | 3 | 5.7 | Critical debt (21-feature cycle 9) / Scheduled (misplaced kernel 6) / Monitored (lib→features 2) | accidental |
| Domain Model Distortion | 1 | 1.0 | Monitored | intentional |

**Recommended focus:** Dependency Disorder first. Moving the misplaced helpers and widgets (OpsVisuals, payload readers, refusal mapper, StaffPhoto, venue-date helpers, booking-wizard kit) into `src/components`, `src/lib` or `packages/core` is mostly mechanical. It halves the cycle and is a precondition for most of the R3 fixes. Then merge the duplicated protocol form stack, and fix the station-zone datetime defect in `protocols/formModel.ts`, which is a one-file Extended-Safe change worth doing immediately.

---

## Summary

The most important action is to give operator features a dependency direction. Move the shared helpers and widgets out of the features that happen to host them, add `index.ts` surfaces, and enforce the boundary in ESLint. Today 21 features form one cycle, so nothing can change in isolation. The most urgent concrete defect is `protocols/formModel.ts:238-250`, which converts protocol datetimes in the station's zone while `/tasks` uses the venue's. Beyond that, the debt is duplicated decisions (two protocol form stacks, 67 payload readers, six name-fallback rules, six venue-day helpers) rather than tangled control flow. The pure-logic files are well tested, which makes these consolidations safe to do incrementally.

**Health Score:** 42/100. Balanced preset: 10 Warnings × −5 = −50, 8 Suggestions × −1 = −8.
