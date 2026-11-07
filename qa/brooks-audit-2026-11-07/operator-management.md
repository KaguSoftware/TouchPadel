# Brooks-Lint Review

**Mode:** Tech Debt Assessment
**Scope:** `apps/operator/src/features/{admin,analytics,reports,insights,marketing,content,plan}` (355 files, 71,542 lines with tests; 54,172 lines without tests. admin is 36,583 lines across 157 files). Read-only. `.brooks-lint.yaml` is absent, so the defaults apply (balanced, all risks). History was not appended, because the audit is read-only.
**Health Score:** 37/100

Verdict: the lane is mostly well layered. Pure `*Logic.ts` siblings have node tests, writes go through `appRpc`, and the anti-corruption readers are disciplined. The debt is horizontal. Small cross-cutting decisions are re-made in every screen: what "today" is, which timezone applies, how a bilingual name falls back, how an RPC number is coerced, how a manager PIN is proved, and which query key to invalidate. Shared helpers have also grown up inside feature folders. A few god components (DayClose, MarketingPanel) sit on top.

---

## Findings

### 🟡 Warning

**R1 Cognitive Overload: DayClose.tsx is a 1,328-line god component that mixes nine reads, IPC, PIN auth, RPC writes and CSV building (Warning)**
Symptom: `admin/DayClose.tsx` holds 9 components. `DayClose()` alone runs from line 173 to about 846, roughly 670 lines. It owns 9 `useQuery` calls (`DayClose.tsx:197,201,217,227,236,252,270,277` plus `useDayCloseOnline` at :261). It has 13 `useState` calls. It runs a durable-queue IPC subscription in a `useEffect` (:295-311) and a manager-PIN plus queue-row resolution flow (:321-363). It invalidates 9 query keys by hand (:368-378) and calls `open_day`/`close_day` with a heartbeat side-call (:381-436). It builds a CSV label bag of about 35 keys (:451-588) and renders four page states with JSX nested up to 30 spaces deep (:630). It imports from 15 other features (`DayClose.tsx:51-114`: shop, matches, holds, tillShift, checklists, ops, analytics and more).
Source: Fowler, *Refactoring*, Long Method / Divergent Change. McConnell, *Code Complete* ch. 7.
Consequence: every new day-close concern so far (desk payments 0106, checklists 0165, till shifts, hand-in 0343) was spliced into this one function. That is visible in the 50-line header (:1-50). Each addition widens the blast radius of the screen that stops the till. Only the pure `dayCloseLogic.ts` part has node coverage. The orchestration (refresh lists, heartbeat-then-close) is covered only by the jsdom test.
Remedy: keep `DayClose` as the composition. Extract `useDayCloseReads(day, closeResult)` (the queries plus `refresh`), `useQueueRows()` (:295-311) and the dismiss flow (see the next finding) into sibling modules. Move the CSV label map into a `dayCloseCsvLabels(tr)` helper next to `dayCloseCsv`.
Fix-Class: Extended-Safe. 3-4 new or changed files, the exported `DayClose` signature is unchanged, and `DayClose.test.tsx` and `dayCloseLogic.test.ts` exist.
Priority: Pain 3 × Spread 2 = 6
Intent: accidental

**R3 Knowledge Duplication: the manager-PIN proof and queue-row resolution sequence is copied, and the copies have drifted (Warning)**
Symptom: `DayClose.tsx:332-363` (`dismissRow`) re-implements `verify_manager_pin`, then null → `PIN_INVALID`, then `touch.pinObserved`, then `touch.resolveQueueRow`, then error mapping. `till/refusedSettle.ts:16-38` already exports that exact act as `resolveRefusedRow`, and its header says "the same act as Day close's 'Resolve' … (features/admin/DayClose.tsx dismissRow)". The copies differ:
- refusedSettle skips the server when `isStationOffline()` and treats `isTransportFailure(e)` as offline (:17,30).
- DayClose has neither check (:349).
- `KitchenPairing.tsx:50-66` is a third variant (`… && !isTransportFailure(e)`).
- The verify-then-observe core also appears in `components/LeaveStation.tsx:39-53`, `tillShift/api.ts:127-129` and `loyalty/useLoyalty.ts:107`.

DayClose also hand-builds the PIN modal (:812-837) instead of using `PinPromptOverlay` (`components/kit.tsx:1846`), which `reports/coaches/MarkPaidDialog.tsx` and `VoidStatementDialog.tsx` use.
Source: Hunt & Thomas, DRY. Fowler, Duplicate Code.
Consequence: this is a security gate. The comments at `DayClose.tsx:338-341` and `KitchenPairing.tsx:51-54` record that treating a `null` answer as success once let any PIN through while online, and that fix had to land in each copy separately. The offline/transport handling already differs between the till and day-close paths for the same queue row.
Remedy: have `DayClose.dismissRow` call `resolveRefusedRow(dismissing.idempotencyKey, dismissPin)` and render `PinPromptOverlay`. Then move `resolveRefusedRow`, plus a `proveManagerPin(pin)` primitive that KitchenPairing, LeaveStation and tillShift share, into `src/lib/` (e.g. `lib/managerPin.ts`).
Fix-Class: the DayClose swap is Safe (one file, it imports an existing export, and no exported symbol changes). Relocating the helper into `lib/` and adopting it in KitchenPairing, LeaveStation and tillShift is Residual, because it moves an exported symbol across features.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication: hand-rolled numeric inputs drop Arabic-Indic digits, a genuine bug (Warning)**
Symptom: `components/inputs.tsx:15-21` `digitsOnly` maps ٠-٩ and ۰-۹ to 0-9 before stripping, and `MoneyInput` uses it. Several fields in the lane bypass it:
- `DayClose.tsx:537`, the opening float: `Number(e.target.value.replace(/\D/g, '')) || 0`. The `MoneyInput` for counted cash in the same file (:695) handles Arabic digits correctly.
- `promotions/PromotionEditor.tsx:516` (`CountInput`) uses `replace(/\D/g, '')`.
- `RateRuleEditor.tsx:466`, `addons/RevealsEditor.tsx:162,171` and `qr/TableForm.tsx:91` use raw `Number(e.target.value)`, so "٥" becomes NaN, which becomes 0 or NaN.

Source: Hunt & Thomas, DRY. McConnell ch. 12.
Consequence: on an Arabic keyboard, typing the opening float silently yields 0 (`/\D/` strips every Arabic digit, then `|| 0`), and the day opens with a zero float. A promotion's total or per-customer limit typed in Arabic digits is dropped. The keypad (`AmountPad`) path is unaffected, which hides the bug in tests.
Remedy: replace the opening-float `<input>` with `MoneyInput` (as at :695). Route `CountInput` and the other three through `digitsOnly`, or through a shared `CountInput` in `components/inputs.tsx`. PIN fields stay ASCII-only through `lib/pinRules.pinDigits`, so leave them.
Fix-Class: Safe per file (local onChange change, no exports). Doing all five in one pass is Extended-Safe.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R2 Change Propagation: one query-cache key holds two different shapes, StaffList against Protocols (Warning)**
Symptom: `admin/staff/StaffList.tsx:289-304` caches the raw RPC payload under `['protocols','step',stepId]` and `['protocols','run',runId]`, and parses with `select: readHireStep`. `protocols/api.ts:49-64` caches the parsed `readRunDetail(...)` / `readStepDetail(...)` under the same keys (`protocols/keys.ts:18-19`). `desk/CourtBlock.tsx:283-287` does the same as StaffList. StaffList then navigates straight to `/protocols` with that run and step (`StaffList.tsx:317`).
Source: Winters et al., *SE at Google* ch. 1 (Hyrum's Law). Ousterhout ch. 5 (Information Leakage).
Consequence: whichever query ran last owns the cache entry. After the HireBanner, the Protocols page first renders a raw payload typed as `StepDetail`, until its refetch. HireBanner can likewise receive a parsed object. Both work today only because `readRunRow`/`readStepRow` keep the snake_case field names (`protocolLogic.ts:66-138`). Any parser that renames or defaults a field turns this into wrong UI or a crash.
Remedy: in StaffList (and CourtBlock), use `useStepDetail` and `useRunDetail` from `protocols/api.ts`, and rewrite `readHireStep`/`hirePrefill` to read `StepDetail`/`RunDetail`. Otherwise give the raw reads their own key segment.
Fix-Class: Extended-Safe. 3 files (StaffList, hirePrefill, CourtBlock), with tests for hirePrefill.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R2 Change Propagation: shared query keys spelled as literals around the QK registry (Warning)**
Symptom: `lib/queryKeys.ts:1-21` says a key spelled by more than one module belongs in `QK`, and `apps/operator/CLAUDE.md` ("Queries and realtime") repeats that rule. The lane bypasses it in several places:
- `DayClose.tsx:377` invalidates `['tabs']` (that is `QK.tabs`, `queryKeys.ts:42`) and `:374` invalidates `['holdReviews']`, which is the holds feature's private key (`holds/HoldStandingPanels.tsx:119`).
- `ClosedDayBookings.tsx:54-55` uses `['reservations']` and `['bookingBill']` (QK roots).
- `courts/CourtsAdmin.tsx:120` uses `['courts']` (`QK.courts`).
- `['venues']` is spelled in `branches/BranchesAdmin.tsx:374,606`, `settings/StationsPanel.tsx:68`, `reports/ReportBranchScope.tsx:50` and `lib/venue.tsx:116,122,143`, with no QK entry at all.

Source: Ousterhout ch. 5 (Information Leakage). Fowler, Shotgun Surgery.
Consequence: the registry header names this exact failure: "a rename on either side would have invalidated nothing, with no error anywhere". A branch create or rename that misses `lib/venue`'s cache leaves the rail switcher stale. A holds-key rename silently breaks the day-close refresh.
Remedy: add `QK.venues` (with `mine`, `station` and `closed` children), reference `QK.tabs`, `QK.courts`, `QK.reservations.all` and `QK.bookingBill.all`, and export `HOLD_REVIEWS_KEY` from holds instead of re-spelling it.
Fix-Class: Extended-Safe. At most 5 files per pass, and it only adds exports.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication: "current business day plus period" resolved seven times though `useBusinessDay` exists (Warning)**
Symptom: the same block (normalise the start hour, then `businessTodayISO(new Date(), startHour, VENUE_TZ)`, then `resolveRange`, then `resolveCompare`) is copied in:
- `analytics/useAnalyticsData.ts:208-221`
- `analytics/courts/useCourtsData.ts:92-104`
- `analytics/people/PeopleTab.tsx:57-68`, whose comment reads "exactly as the other tabs"
- `insights/InsightsPage.tsx:151-155`, whose comment reads "as on Analytics"
- `reports/ReportParts.tsx:83`
- `admin/audit/AuditLog.tsx:146`
- `analytics/AnalyticsBar.tsx:164`, with its own magic default `deck?.startHour ?? 4`

`lib/settings.ts:203-212` (`useBusinessDay`) already computes `todayIso` and `startHour` once.
Source: Hunt & Thomas, DRY. Fowler, Duplicate Code.
Consequence: the period that a preset like "Today" means is defined in seven places. Changing the rule (for example the timezone, in the next finding) needs seven coordinated edits. The bar and the data hooks can already disagree when settings fail to load: the bar falls back to 4, while the hooks use `normalizeBusinessDayStart`'s default.
Remedy: add `useAnalyticsPeriod(search)` to `analytics/` (or `lib/settings.ts`), built on `useBusinessDay`, returning `{ todayISO, range, preset, compare }`, and use it in all seven places.
Fix-Class: Extended-Safe. A new export plus call-site swaps, split over two passes of at most 5 files.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R6 Domain Model Distortion: branch timezone ignored by analytics, reports, audit, promotions and marketing (Warning)**
Symptom: the server's business day is per branch: `app.venue_business_date` reads `venues.timezone` (migration `20260926000211_cafe_settings_readers_per_venue.sql`, `venue_business_date`). The owner can open a branch in any IANA zone (`branches/BranchesAdmin.tsx`, `TimezonePicker.tsx`, `timezoneData.ts`). Some screens honour the branch zone: `coaches/CoachHoursTab.tsx:133,438`, `reports/coaches/StatementDialog.tsx:89` and `OpeningHoursEditor.tsx:151`. Others hard-code `VENUE_TZ = 'Asia/Baghdad'` (`packages/i18n/src/formatting.ts:27`):
- the seven period sites in the previous finding
- `analytics/format.ts:62` and `analytics/cellFormat.ts:52,59`
- `reports/drillView.ts:53`
- `admin/promotions/promotionLogic.ts:56,140-141`
- `marketing/MarketingPanel.tsx:289,791,831`

Source: Evans, *DDD*, Bounded Context / Ubiquitous Language. Brooks, *MMM* ch. 4 (Conceptual Integrity).
Consequence: the defect is latent today, because every branch is in Baghdad. For a branch in another zone, these would all shift by the zone offset relative to the server: the presets' "today", the audit log window, promotion start and end days, campaign windows, and the hour of day in analytics cells. That makes the client disagree with the server's own business date.
Remedy: add `useBranchTz()` (`useVenue().current?.timezone ?? VENUE_TZ`) and pass it wherever `VENUE_TZ` is used for a business-day or wall-clock edge. Decide what "All branches" means on report pages that mix zones.
Fix-Class: Residual. It is cross-cutting (more than 10 files) and needs an owner decision on mixed-zone report scope.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication: bilingual-name fallback, list joining and number locale re-implemented about 30 times, with drift (Warning)**
Symptom: `core/src/i18n/pickLocale.ts:4-9` falls back to the other language, while `lib/i18n.ts:59-65` (`pickName`) has no fallback. The lane hand-writes a third style of pick in about 20 places:
- With a `??` fallback: `menu/menuLogic.ts:301`, `branches/BranchesAdmin.tsx:116`, `reports/ReportParts.tsx:133`, `reports/columns.ts:12`, `reports/drillWords.ts:45`, `MarketingPanel.tsx:219,605`.
- With a `||` fallback: `promotions/promotionLogic.ts:229`.
- Trim-aware: `reports/coaches/statementsLogic.ts:70-71`.
- With no fallback: `promotions/PromotionsList.tsx:183,202`, `hero/HeroBuilder.tsx:257,371`, `hero/HeroPreview.tsx:177`, `audit/auditLogic.ts:629`, `ClosedDayBookings.tsx:59`.

The Arabic list separator `join(locale === 'ar' ? '، ' : ', ')` is repeated 11 times (`DayClose.tsx:449,1138`, `coaches/CoachEditor.tsx:621`, `coaches/PromoteCoachDialog.tsx:179`, `addons/AddonsPage.tsx:72`, `menu/ItemModifierGroups.tsx:136`, `menu/ItemForm.tsx:476`, `analytics/people/PeopleTab.tsx:244,293,319,336`), while `analytics/legacyHistory.ts:60` uses `Intl.ListFormat`. Number locale tags also diverge: `analytics/format.ts:37` uses `'en-GB-u-nu-latn'` and `reports/drillWords.ts:91,169` uses `'en-IQ'`. The currency unit literal appears twice (`analytics/format.ts:63`, `analytics/copy.ts:66`).
Source: Hunt & Thomas, DRY. Evans, Ubiquitous Language.
Consequence: a promotion, hero item or audit record with only an Arabic name prints blank on some screens and in English fallback on others. An empty-string name falls back in promotions (`||`) but not in reports (`??`). Every new screen has to choose a variant.
Remedy: standardise on `pickLocale` (or give `pickName` the same fallback), add `joinNames(list, locale)` and one number-format factory in `lib/i18n.ts`, then replace the call sites in batches.
Fix-Class: Extended-Safe, in batches of at most 5 files. It only adds helpers.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication: RPC payload coercers copied about 10 times, with opposite "missing figure" policies (Warning)**
Symptom: private `num`/`str`/`arr`/`obj`/`int` helpers appear in:
- `analytics/shape.ts:18-25`
- `analytics/courts/shape.ts:10-23`, which also adds `numOrNull`
- `analytics/courts/shop.ts:20-33`, which also adds `numOrNull`
- `analytics/people/peopleLogic.ts:106-117`
- `insights/insightsLogic.ts:143-150`
- `reports/reportPayloads.ts:32-47`
- `admin/handInLogic.ts:39`
- `admin/staff/hirePrefill.ts:16-25`
- `admin/audit/auditLogic.ts:171`
- `analytics/legacyHistory.ts:33`

The semantics differ: `str(5)` is `'5'` in `shape.ts` but `''` in `peopleLogic.ts`. `num(garbage)` is `0` in the analytics readers but `null` in `reportPayloads.ts`, whose header (:25-26) states the opposite rule: "a field the payload does not carry is null … printed as '—', never as 0".
Source: Fowler, Duplicate Code. Hunt & Thomas, DRY.
Consequence: the same absent server figure renders as `0` on Analytics and `—` on Reports. That is the honesty rule that `reportPayloads` and the marketing header (`MarketingPanel.tsx:9-17`) care about, applied inconsistently. A fix to one coercer, such as accepting `''`, does not reach the others.
Remedy: one `lib/payload.ts` with explicitly named variants (`numOr0`, `numOrNull`, `textOrEmpty`, `textOrNull`, `record`, `list`), imported by every reader. Each analytics reader then chooses its missing-figure policy on purpose.
Fix-Class: Extended-Safe. A new module, then swaps of private helpers in passes of at most 5 files. The readers have node tests.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R1 Cognitive Overload: MarketingPanel.tsx at 1,303 lines hosts five features in one file (Warning)**
Symptom: `marketing/MarketingPanel.tsx` has 25 `useState` calls and 6 components. `MarketingPanelScreen` (:164 to about 549, roughly 385 lines) builds the campaign table with business flags computed in column renderers (overdue :214-217, the window at :289). It also hosts the content-approval and plan panels. `MarketingRequestsPanel` (:550-694), `AudiencePanel` (:695-778), `CampaignEditor` (:779-1081, with 10 `useState` calls and a direct `marketing_campaigns` read at :811) and `AudienceEditor` (:1082-1303) live in the same file. It reaches into admin internals: `admin/promotions/promotionsApi` (:68) and `admin/menu/availability.todayIso` (:69,560). The 60-line header (:1-60) is a changelog of five passes.
Source: Fowler, Large Class / Divergent Change. McConnell ch. 7.
Consequence: campaigns, audiences, requests and content approval change for different reasons and owners, but every change edits the same file. The header shows past regressions here (campaign bodies wiped, UTC day windows) that came from editing in this density.
Remedy: split into `CampaignsTable.tsx`, `CampaignEditor.tsx`, `AudienceEditor.tsx` and `RequestsPanel.tsx`, and keep `MarketingPanelScreen` as the composition. Import promotions through a public `promotions` entry point rather than `admin/...` internals.
Fix-Class: Extended-Safe. 4-5 files, the exported `MarketingPanelScreen` is unchanged, and `MarketingPanel.test.tsx` exists.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R5 Dependency Disorder: shared libraries live inside feature folders, with feature-level cycles (Warning)**
Symptom:
- `analytics/exportTables` (XLSX/CSV export) is imported by admin (`DayClose.tsx:87`, `dayCloseLogic.ts:10`, `audit/AuditLog.tsx:62`, `audit/auditLogic.ts:18`), reports (`ReportParts.tsx:58`, `CourtsReport.tsx:54`, `exportCells.ts:13`), panel and stock.
- `analytics/cellFormat` is imported by admin and reports (`dayCloseLogic.ts:11`, `auditLogic.ts:19`, `StockReport.tsx:59`).
- `ops/OpsVisuals` is imported by 23 features.
- `deductions/venueDate` is imported by 11 features, including `content/ContentForm.tsx:38`, `content/ContentSheet.tsx:33`, `plan/PlanPage.tsx:31` and `plan/PlanSummary.tsx:21`.
- `deductions/deductionsLogic.isStaleRefusal` is imported by content (`ContentSheet.tsx:34`).
- `admin/menu/availability.todayIso` is imported by marketing and three stock files.

There are two feature cycles:
- analytics → reports (`AnalyticsBar.tsx:27`, `drill.tsx:12`) and reports → analytics (5 imports).
- content → plan (`ContentForm.tsx:39-40`) and plan → content (`plan/api.ts:9`, `planLogic.ts:15`, `PlanPage.tsx:33-34`, `IdeaParts.tsx:42`, `PostsPage.tsx:10`).

Two unrelated registries are both named `PK` (`protocols/keys.ts:15`, `plan/api.ts:11`).
Source: Martin, *Clean Architecture*: Acyclic Dependencies and Stable Dependencies principles.
Consequence: stable, widely used utilities sit inside volatile feature folders. A refactor of the analytics tab can break the day close and the audit export, and deleting or reshaping "deductions" breaks content and plan. The cycles mean analytics and reports, and content and plan, cannot be reasoned about or tested apart.
Remedy: move `exportTables`, `xlsx` and `cellFormat` to `src/lib/export/`, `venueDate` to `src/lib/venueDate.ts`, `OpsVisuals` to `src/components/`, and `isStaleRefusal` to `lib/errors.ts`. Move `DrillDialog` and `ReportBranchScope` (which analytics consumes) into a shared `reportsKit`, or treat content and plan as one feature folder. Rename plan's `PK` to `PLAN_KEYS`.
Fix-Class: Residual. It moves exported modules across features and touches more than 30 importers.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

### 🟢 Suggestion

**R1 Cognitive Overload: further god components in admin (Suggestion)**
Symptom:
- `coaches/LessonTypeEditor.tsx`: one 617-line component (:79-696).
- `menu/MenuEditor.tsx`: one 492-line component (:64-556).
- `coaches/CoachHoursTab.tsx`: `WeeklyHours` (:128-424).
- `RateRuleEditor.tsx`: 16 `useState` calls in 529 lines.
- `courts/CourtsAdmin.tsx`: 15 `useState` calls.
- `staff/StaffList.tsx`: `StaffList` (:78-284) plus 4 dialogs and 10 RPC calls.
- `coaches/CoachEditor.tsx`: 1,231 lines, but decomposed into per-section components on purpose (:1-28).

Source: Fowler, Long Method. McConnell ch. 7.
Consequence: these files are slower to change than the lane's logic siblings, but each keeps its rules in a tested `*Logic.ts`, so the impact is limited.
Remedy: when next touched, split the form state into a reducer or hook beside the existing logic module, as `CoachEditor` did with sections.
Fix-Class: Extended-Safe, per file, with tests present.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R1 Cognitive Overload: CafeTab derives business figures inside a 637-line render function (Suggestion)**
Symptom: `analytics/cafe/CafeTab.tsx:89-726` is a single component. It computes the small-sample and reliability gates (:125-127), cash share (:136-137), the previous window's average order value (:192), 16 pulse figures (:181-200) and the notice rules (:214-236) inline. The Courts tab splits the same responsibilities into `courts/sections/*` and `courts/derive.ts`.
Source: McConnell ch. 7. `apps/operator/CLAUDE.md` (Tests): "Keep screen logic in a pure sibling with a node test."
Consequence: the gating rules that hide a misleading "−80%" are untested and live in JSX scope, so the two tabs can drift.
Remedy: move the pulse figures, notices and gates into `cafe/derive.ts` with node tests, mirroring `courts/`.
Fix-Class: Extended-Safe. 2-3 files, with `CafeTab.test.tsx` present.
Priority: Pain 2 × Spread 1 = 2
Intent: accidental

**R3 Knowledge Duplication: calendar-day helpers and day-window encodings are re-implemented (Suggestion)**
Symptom: "today as YYYY-MM-DD" exists in four forms:
- the station calendar: `admin/menu/availability.ts:96` (used by `MarketingPanel.tsx:560`)
- the venue zone: `promotions/promotionLogic.ts:56,67`
- the settings zone, inline: `OpeningHoursEditor.tsx:151`
- `deductions/venueDate.ts:16`

`isIsoDate` exists three times (`admin/closedDates.ts:18`, `components/dateFieldLogic.ts:32`, `core/src/analytics/range.ts:46`). "HH:MM → minutes" is `coachHoursLogic.ts:54`, while core has `parseHHMM` (`core/src/time/tz.ts:176`). A promotion's last day is sent as the next midnight minus 1 ms (`promotionLogic.ts:141`), but a campaign's last day is sent as the next midnight, exclusive (`marketing/marketingTypes.ts:157`). The server compares `ends_at > now()` for promotions and `redeemed_at < ends_at` for campaigns (migrations 0177 and 0073 at :248).
Source: Hunt & Thomas, DRY.
Consequence: both window encodings are correct today, and the station-day versus venue-day gap is small. Still, each new date field chooses a helper at random, and a campaign measures its promotion with a boundary that differs by 1 ms.
Remedy: one `lib/venueDate.ts` (see the previous Warning) with `venueToday(tz)`, `isIsoDate` re-exported from core, and `dayWindowToServer(start, last, tz)` used by both promotions and marketing.
Fix-Class: Extended-Safe, in passes of at most 5 files.
Priority: Pain 1 × Spread 3 = 3
Intent: accidental

**R5 Dependency Disorder: two write-state idioms side by side (Suggestion)**
Symptom: 17 files in the lane hand-roll `busy`/`error`/`try`/`finally` state (23 `setBusy(true)` calls, e.g. `DayClose.tsx:381-392`, `coaches/CoachEditor.tsx:350-351`, `reports/coaches/MarkPaidDialog.tsx`). 29 files use `useMutation` (e.g. `MarketingPanel.tsx:190`, `staff/StaffAccountEditor.tsx:299`). `courts/CourtsAdmin.tsx` uses both.
Source: Brooks, *MMM* ch. 4 (Conceptual Integrity).
Consequence: double-submit guards, error reset and invalidation timing differ by file, so a reader has to learn both idioms.
Remedy: pick `useMutation` for new code and convert files when they are touched.
Fix-Class: Extended-Safe, per file.
Priority: Pain 1 × Spread 3 = 3
Intent: accidental

**R3 Knowledge Duplication: the "reset draft when the server copy changes" effect is copied with lint suppressed (Suggestion)**
Symptom: `useEffect(() => setDraft(fromServer(x)), [JSON.stringify(saved)])` with `eslint-disable react-hooks/exhaustive-deps` appears at `coaches/CoachEditor.tsx:354-355,588-589,705-708`, `coaches/LessonTypeEditor.tsx:115-123`, `coaches/CoachHoursTab.tsx:142-143`, `coaches/PromoteCoachDialog.tsx:119-121`, `promotions/PromotionEditor.tsx:145`, `menu/ItemForm.tsx:125-127` and `plan/PlanPage.tsx:77-79`. There are 13 suppressions in the lane, each with small variations (the `fromPromote` guard at `CoachEditor.tsx:706`).
Source: Fowler, Duplicate Code.
Consequence: the rule for when a server save overwrites the operator's typing is re-decided per form, and the lint that would catch a stale closure is off each time.
Remedy: add a `useServerDraft(saved, toDraft, { keep? })` hook in `components/` and adopt it per form.
Fix-Class: Extended-Safe.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication: role sets restated outside core and auth (Suggestion)**
Symptom: `admin/staff/staffModel.ts:40-44` re-declares `RETIRED_ROLES = ['prep']` and `isRetiredRole`, which already exist in `packages/core/src/staff/roles.ts:63`. `staffModel.ts:101-103` (`approvesWithPin`: manager or owner) encodes the PIN-approver set outside `CAPABILITY_ROLES` (`lib/auth.tsx:487`), and `routes/__root.tsx:1315` consumes it.
Source: Hunt & Thomas, DRY.
Consequence: retiring the next role, or letting a head barista approve, requires finding these copies. `staffModel.test.ts:45-48` guards `ASSIGNABLE_ROLES` but not `RETIRED_ROLES`.
Remedy: re-export `RETIRED_ROLES` from `@touch/core`, and move the approver set to `CAPABILITY_ROLES.approveWithPin`.
Fix-Class: Extended-Safe. 2-3 files, and the exported names stay as re-exports.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R2 Change Propagation: the audit ACTION_KEYS list hand-mirrors every `write_audit` string (Suggestion)**
Symptom: `admin/audit/auditLogic.ts:356-543` lists about 190 action codes "grep `write_audit` in migrations" by hand. Each code needs EN and AR catalog keys. The guard test checks only a hand-picked subset (`auditLogic.test.ts:322-340`).
Source: Fowler, Shotgun Surgery.
Consequence: a new audited RPC is a three-place edit (the migration, this list, two catalogs). If it is missed, the row shows the raw code under its area. That degrades gracefully, so the impact is small.
Remedy: add a node test that extracts the `write_audit('…')` literals from `packages/db/supabase/migrations/*.sql` and asserts that each is in `ACTION_KEYS`.
Fix-Class: Extended-Safe (a test only).
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication: basis-points to percent display converted ad hoc (Suggestion)**
Symptom: `admin/settings/venueQueries.ts:53` (`bpToPercent`), `admin/settings/coachingSettingsLogic.ts:54` (`bpToPercentText`, 2 decimals), `reports/coaches/StatementDialog.tsx:537` (inline `share_bp / 100`), and outside the lane `deposits/depositSettingsLogic.ts:56` (rounded) and `discounts/discountLogic.ts:159`.
Source: Hunt & Thomas, DRY.
Consequence: a coach share of 6,250 bp shows as "62.5" in settings, and `formatPercent(62.5)` in statements may round differently.
Remedy: one `bpToPercent(bp, { decimals })` in `lib/` or core, used for display.
Fix-Class: Extended-Safe.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

---

## Top offenders

| File | Lines | What's tangled |
|---|---|---|
| `admin/DayClose.tsx` | 1328 | A 670-line component: 9 queries, queue IPC effect, PIN dismissal (copied), open/close RPCs + heartbeat, 9 manual invalidations, a 35-key CSV label bag, imports from 15 features |
| `marketing/MarketingPanel.tsx` | 1303 | Campaigns, audiences, requests, content and plan hosting in one file; a 385-line screen; 25 `useState`; reaches into admin internals |
| `admin/coaches/CoachEditor.tsx` | 1231 | Long but sectioned by design; repeats the busy/error and draft-reset patterns 6 times |
| `reports/CourtsReport.tsx` | 818 | Courts, matches and lessons reports in one screen (~290-line screen component) |
| `insights/InsightsPage.tsx` | 770 | 15 components, a copied period resolver, 12 imports from analytics |
| `admin/coaches/LessonTypeEditor.tsx` | 756 | One 617-line component with 2 lint-suppressed reset effects |
| `admin/branches/BranchesAdmin.tsx` | 749 | List, details and create dialog; `['venues']` literal invalidations |
| `analytics/cafe/CafeTab.tsx` | 726 | One 637-line component that also derives gates, pulse figures and notices inline |
| `admin/coaches/CoachHoursTab.tsx` | 726 | `WeeklyHours` ~300 lines, 12 `useState` |
| `admin/staff/StaffList.tsx` | 654 | List + HireBanner (poisoned protocols cache keys) + 3 dialogs, 10 RPCs |
| `admin/menu/MenuEditor.tsx` | 623 | One 492-line component |

## Looks bad but is fine

- **`reports/reportPayloads.ts` (844 lines).** It is a cohesive anti-corruption layer: one reader per report RPC, documented (:1-27), with no arithmetic. Its length tracks the payload count.
- **`admin/branches/timezoneData.ts` (687 lines).** Data generated from IANA zone.tab (:1-10), not logic.
- **`analytics/courts/fixtures.ts` (400 lines, not named `.test`).** The header says it is test-only, and the only importers are `*.test.ts(x)` (grep: `useVenueRevenue.test.tsx:21`, `derive.test.ts:8`, `CourtsTab.test.tsx:70`, …).
- **`dayCloseLogic.ts` `QUEUE_WRITE_KEY` as one of six mutation-type registries.** Required by `apps/operator/CLAUDE.md` ("Writes") and guarded by `dayCloseLogic.test.ts` against `_shared/mutation-types.json`.
- **`staffModel.ASSIGNABLE_ROLES` against core `HIREABLE_ROLES`.** They serve different purposes: assignable includes manager, owner and dev. It is test-guarded against `STAFF_ROLES` (`staffModel.test.ts:45-48`). Only `RETIRED_ROLES` is a true copy (reported above).
- **`reports/ReportBranchScope.tsx:45` `staff?.role === 'owner'`.** One of the four inline comparisons `apps/operator/CLAUDE.md` tolerates (Q4). The others are `roleExtras/Ideas.tsx:193`, `protocols/DecisionDialog.tsx:66` and `lib/venue.tsx:187`. It is not a new violation. Other `role === 'owner'` hits in admin (`SetupHome.tsx:308`, `StaffList.tsx:104`, `StaffAccountEditor.tsx:290,310,369`) test the role of the person being edited, which is data and not a permission gate.
- **Hand-written payload parsers instead of zod.** A documented decision (`analytics/search.ts:2`: "no zod in the operator app"). Only the copy-paste is reported.
- **Direct `supabase.from(...)` reads in components** (`DayClose.tsx:162,204,240,281`, `SetupHome.tsx:79-104`). CLAUDE.md allows reads, and no direct writes exist in the lane (the grep for `.insert/.update/.upsert/.delete()` came back empty).
- **`SetupHome.tsx` fan-out (8 features).** It is a dashboard aggregator, a composition root. That fan-out is expected.
- **Three settings-logic skeletons** (`settings/coachingSettingsLogic.ts`, `settings/matchSettingsLogic.ts`, `deposits/depositSettingsLogic.ts`, each with Draft/FIELD map/errors/patch). They are parallel in shape, but the rules really differ: whole percent versus 2-decimal percent, a 250-IQD step, chained fields. A generic engine would be speculative.
- **Long "WHY" headers** (DayClose, MarketingPanel, CafeTab). They are deliberate design records. They are cited as evidence, not counted as debt.
- **TODO/FIXME clusters.** None: the grep found 0 TODO, FIXME, XXX or HACK in the lane.

## Debt Summary

| Risk | Findings | Avg Priority | Classification | Intent |
|------|----------|-------------|----------------|--------|
| Cognitive Overload      | 4 | 4.0 | Scheduled | accidental |
| Change Propagation      | 3 | 4.0 | Scheduled | accidental |
| Knowledge Duplication   | 9 | 3.9 | Scheduled | accidental |
| Accidental Complexity   | 0 | – | – | – |
| Dependency Disorder     | 2 | 4.5 | Scheduled | accidental |
| Domain Model Distortion | 1 | 6.0 | Scheduled | accidental |

**Recommended focus:** Knowledge Duplication is systemic: nine findings, spread across every folder in the lane. It is the root of the timezone, "today", name-fallback and PIN drift. Do these first, since they are cheap: the PIN-flow swap in DayClose (Safe), the Arabic-digit inputs (Safe), and `useAnalyticsPeriod` plus `QK.venues` (Extended-Safe). Then do the one Residual that unlocks the rest: move `exportTables`, `cellFormat`, `venueDate` and `OpsVisuals` into `lib/` and `components/`, and give the timezone a single `useBranchTz()`.

**Severity counts:** Critical 0 · Warning 11 · Suggestion 8. Score: 100 − 11×5 − 8×1 = **37/100** (balanced).

## Summary

The most important action is to stop re-deciding small domain rules per screen. One manager-PIN proof, one business-day period hook, one branch-timezone source, one name and payload coercion layer, and the QK registry for every shared key would remove most of the drift found here. Two of those drifts are genuine bugs: Arabic digits lost on the opening float, and the protocols cache key holding two shapes. Structural splits of DayClose and MarketingPanel are the second priority. The trend is mixed: recent work (pure logic siblings, `reportPayloads`, `QK`) shows the right direction, but each new wave copies the nearest screen rather than the shared helper.
