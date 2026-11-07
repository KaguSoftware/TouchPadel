# Brooks-Lint Review

**Mode:** Tech Debt Assessment
**Scope:** lane `mobile-core`: `apps/mobile/src/**` except `features/staff` (features/{assistant,auth,availability,booking,boot,cafe,coach,coaching,courtTransition,deposit,loyalty,matches,monitoring,play,playProfile,profile,ranks,tournaments}, components, lib, navigation, theme, i18n, smoke, test). About 96k lines. `app/` and `features/staff` are cited only where a lane module's behaviour depends on them. No `.brooks-lint.yaml`, so the defaults apply (balanced).
**Health Score:** 32/100

The layer most screens touch is well disciplined: one api layer with an injected client, centralised money formatting, zero TODO/`as any`/`ts-ignore`, and no file-level import cycles. The spaghetti sits between features. The coach/coaching, deposit/matches/coaching and components/features pairs each re-decide the same things (lesson model, trading night, error codes, payment start, cache invalidation), and every query family's policy has to be hand-registered in five places, one of which already missed the owner's assistant chats.

How the evidence was gathered: `wc -l`, a function-length script, Tarjan SCC over relative value imports in `app/`+`src/` (0 file-level cycles; module-level edge list in the scratchpad), cross-file exported-name intersection, and the repo-wide dead-code gate below.

---

## Findings

### 🟡 Warning

**R2 Change Propagation: the owner's assistant chats are written to the plaintext disk cache (Warning, genuine bug)**
Symptom: `persistOptions.dehydrateOptions.shouldDehydrateQuery` (`src/lib/queryClient.ts:336-365`) is a deny-list. It keeps `staff`, `deposit`, `match`, `coaching`, `coach`, `tournament`, `ranks`, `own-profile` and others off disk "because a … read back from disk would be shown before the account is re-checked" (`:319-331`). The assistant family is `['assistant', …]` (`src/features/assistant/api.ts:39-46`), not under `staff`, and it is not in the list. `fetchMessages` stores full message `content` and `sources` (`api.ts:71-78`), read under `assistantKeys.messages/conversation/conversations/usage` (`app/(staff)/staff-assistant.tsx:88-97`, `app/(staff)/staff-assistant-chats.tsx:30`, `src/features/assistant/SettingsSheet.tsx:76`). None of the 10 `*/__tests__/queryDefaults.test.ts` files covers `assistant`.
Source: Ousterhout, A Philosophy of Software Design: Information Leakage. Hunt & Thomas, Pragmatic Programmer: Orthogonality.
Consequence: the owner's business Q&A (revenue, staff names, costs) and their AI spend sit in `tp.query-cache.v1` in AsyncStorage, the same plaintext file the 2026-10 pentest took the profile row out of (`queryClient.ts:351-355`). A backup or a seized phone can read them until sign-out runs `clearAllCaches`. The cause is structural: any new family is persisted unless someone remembers this file.
Remedy: add `query.queryKey[0] !== 'assistant'` now, plus a case in a `queryDefaults` test. The structural fix is in the next finding.
Fix-Class: Safe. One line in one file, no exported signature changes (a test case makes it Extended-Safe).
Priority: Pain 3 × Spread 1 = 3
Intent: accidental

**R2 Change Propagation: a query family's policy is spread over five places, and disk persistence is opt-out (Warning)**
Symptom: adding a family (matches, coaching, coach, tournaments, loyalty, ranks, deposit each did) means editing (1) `features/<x>/keys.ts`, (2) a `setMutationDefaults([...,'mutation'])` block (`lib/queryClient.ts:167,168,182,201,223,243,259,274,285,295`), (3) a fail-fast `setQueryDefaults([...,'slots'])` (`:205,227,247,263`), (4) the dehydrate deny-list, which compares raw first segments against literals like `'my-bookings'`, `'own-profile'` and `'avatar-url'` (`:336-365`) instead of the exported key families, and (5) a new copy of `queryDefaults.test.ts`, which repeats the same native-module stubs (10 copies, 736 lines: `features/{booking,coach,coaching,deposit,loyalty,matches,profile,ranks,staff,tournaments}/__tests__/queryDefaults.test.ts`; for example `ranks/__tests__/queryDefaults.test.ts:8-23`).
Source: Fowler, Refactoring: Shotgun Surgery. Ousterhout: Information Leakage.
Consequence: each new family is three to five coordinated edits far from the feature, and forgetting one fails open (persisted, or offline-queued), as the assistant finding shows. The deny-list grows by one clause per family (14 now).
Remedy: give each `keys.ts` a declarative policy (`{ persist: false, writes: 'now-or-fail', fastFailSlots: true }`) and have `queryClient.ts` iterate a registry. Make persistence an allow-list (`venue-*`, `courts`, `rate-*`, `cafe`, `loyalty.mine`, …). Replace the 10 test copies with one table-driven test over the registry.
Fix-Class: Residual. Touches more than 5 files and changes the default persistence behaviour.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication: "what is stale after this write" is re-decided in each feature with inline key literals (Warning)**
Symptom: `availabilityKeys` has no `all`, so 17 sites invalidate the inline `['availability']` / `['reservation']` / `['own-consent']` arrays: `features/booking/hooks.ts:63,76,78,100,102,120,122`, `features/deposit/hooks.ts:175,177`, `features/matches/hooks.ts:74`, `features/matches/tickets.ts:130`, `features/coach/hooks.ts:60`, `features/coaching/hooks.ts:55`, `features/availability/hooks.ts:648`, `features/profile/hooks.ts:81-82,183`. The same rule ("a court changed hands → grid + family") is hand-rolled four times under different names: `useInvalidateMatches(alsoGrid)` (`matches/hooks.ts:68-78`), `useInvalidateLessons(alsoGrid)` (`coaching/hooks.ts:48-58`), `useAfterWrite().done(courts)` (`coach/hooks.ts:53-61`) and `useRefreshAfterPayment` (`deposit/hooks.ts:171-181`). A fifth copy is in the push wiring (`app/_layout.tsx:523,531,534,541`). The four booking mutations repeat the same three-line block (`booking/hooks.ts:56-125`).
Source: Hunt & Thomas: DRY. Fowler: Duplicate Code. The repo's own rule: "Extend a family; never inline a key array" (`apps/mobile/CLAUDE.md`, Queries).
Consequence: renaming the availability prefix, or adding a read that depends on bookings (history, open-match chips), means finding every literal by grep. A miss shows stale slots after a booking. `deposit` must know three other families' keys to refresh after payment (see the R5 finding).
Remedy: add `availabilityKeys.all`, `bookingKeys.allReservations`, `profileKeys.consentAll`. Put a small `invalidate.ts` beside `queryClient.ts` with named events (`afterCourtChange`, `afterBookingWrite`, `afterPayment(purpose)`), and have hooks and `_layout` call the event, not the keys.
Fix-Class: Extended-Safe, in two passes of ≤5 files (keys first, then call sites). No exported signature changes, and vitest plus smoke cover the hooks.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication: coach mode and guest coaching each own a copy of the lesson model, and it has already drifted (Warning)**
Symptom: `features/coach/logic.ts` and `features/coaching/logic.ts` both export `LESSON_KINDS`, `LESSON_STATUSES`, `BOOKED_BY`, `ATTENDANCE`, `CANCEL_REASONS`, `CoachSlots`, `parseCoachSlots`, `coachPhotoUrl`, `slotsByNight` and `DEFAULT_TZ` (`coach/logic.ts:51-66,86,162,1177-1203,1215,1234`; `coaching/logic.ts:38-75,97,110,485-512,1147,1216-1230`). The same RPC `app.coach_slots` is fetched by two api functions both named `fetchCoachSlots` (`coaching/api.ts:83-95`, `coach/api.ts:131-143`) and cached under two families (`coachingKeys.slots`, `coachKeys.slots`). The two parsers disagree. A missing `bookable` reads as bookable for the coach (`coach/logic.ts:1191`, `!== false`) and not bookable for the guest (`coaching/logic.ts:509`, `bool()`). The `duration_min` default is 60 vs 0 (`:1192` vs `:511`), a missing `end_at` becomes `''` vs `startAt`, and only the coach copy sorts. The photo guard (R43) differs: coaching also rejects `..` and defaults the base URL (`coaching/logic.ts:1223-1227`), coach does neither (`coach/logic.ts:1234-1238`). The UI follows suit with two `CoachAvatar`s, using different props (`photoPath` vs `photoUrl`), tokens and initial logic (`components/coaching.tsx:58`, `components/coachMode.tsx:88-121`).
Source: Fowler: Duplicate Code, Alternative Classes with Different Interfaces. Evans, DDD: Bounded Context (one context, two models).
Consequence: today the server always sends `bookable` and `duration_min` (`20261002000294_coaching_reads.sql:254-255,315-316`), so the parser drift is latent. A server change to `coach_slots`, a new lesson status, or a tightening of the photo-path rule now needs two edits with two test suites, and the security-relevant photo guard is already unequal.
Remedy: move the shared vocabulary, `CoachSlots` + `parseCoachSlots` and `coachPhotoUrl` into one `features/coaching/model.ts` (or `@touch/core/coaching`, which already holds `shapes.ts`/`grid.ts`), import it from coach mode, and merge the `CoachAvatar`s.
Fix-Class: Residual. Changes exported types used by both features and their tests.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R3 Knowledge Duplication: "which trading night does this instant belong to" has three answers (Warning)**
Symptom: `tradingNightOf` (`features/matches/logic.ts:1130-1141`) reads the branch's overnight opening-hours tail. Guest coaching uses it (`coaching/logic.ts:33,1153,1176`), as do `components/match.tsx:73-74` and `app/(tabs)/play.tsx:312,321`. Coach mode uses `nightOf` with a fixed `NIGHT_CUT_MINUTES = 6*60` (`coach/logic.ts:385-396`), ignoring opening hours, for its schedule and slot strip (`:436-457,1218`). `coaching/logic.ts:1122-1131` has a third tail reader (`nightEndsAt`). `availability/assemble.ts` assembles the Book grid's night on its own. The weekday table is declared three times (`matches/logic.ts:1143`, `availability/assemble.ts:102`, `coaching/logic.ts:1116`), plus `packages/core/src/availability/slotGrid.ts:100`. The date shifter exists twice (`matches/logic.ts:1145-1150` `shiftDate` vs `addDays`).
Source: Hunt & Thomas: DRY. Fowler: Duplicate Code (two modules implementing the same algorithm).
Consequence: for any branch whose overnight tail does not end at exactly 06:00 (a 03:00 close, a branch with no tail and a late lesson), the coach's schedule and the guest's lesson screen file the same lesson under different nights. Changing hours to a 07:00 close would silently move only one of them.
Remedy: one `tradingNightOf(at, settings)` in `@touch/core/time` (next to `openingHours`), used by matches, coaching, coach and assemble. Coach mode passes the branch settings it already reads.
Fix-Class: Residual. A behaviour change in coach mode, crosses into `packages/core`.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R3 Knowledge Duplication: three mechanisms map an error code to the phone's line, and four regexes read a code (Warning)**
Symptom: open-match codes live in `MOBILE_OVERRIDES` inside `features/booking/errors.ts:66-81`, which also carries staff floor and deposit lines (`:52-65`), so "booking/errors" is in fact the app-wide error module. Coaching keeps its own `COACHING_CODE_KEYS` (`coaching/errors.ts:34-63`), tournaments its own `TOURNAMENT_GUEST_KEYS` (`tournaments/errors.ts:29-39`), and matches a `refusalKey` (`matches/errors.ts:121`). A code is extracted by `errorCode` (@touch/i18n, via `rpcErrorCode`), by `isAppRefusal` `/^[A-Z][A-Z0-9_]{3,}$/m` (`lib/queryClient.ts:60-62`), by coach's `CODE_RE` `/^[A-Z][A-Z0-9_]{2,}$/` (`coach/errors.ts:21-28`) and by coaching's `CODE_WORD` scan (`coaching/errors.ts:96-114`). Coaching's reader is documented as temporary "until [the catalogue] carries the coaching codes … then the same lines can move into MOBILE_OVERRIDES" (`coaching/errors.ts:8-11`). The catalogue now has them (`packages/i18n/src/errors.ts:444,449,456,457,474`). Feature error modules import each other (`tournaments/errors.ts:22` → matches, `coaching/errors.ts:28` → matches).
Source: Hunt & Thomas: DRY. Fowler: Alternative Classes with Different Interfaces. Evans: Ubiquitous Language ("booking" naming the whole app's errors).
Consequence: CLAUDE.md tells contributors that "a new code gets an entry there [booking/errors.ts]", but a coaching or tournament code needs a different table. The four regexes disagree on 3-letter codes, so the query client logs as an exception what coach mode reads as a refusal.
Remedy: retire coaching's transitional reader now that the catalogue has the codes. Move the guest lines into one `features/errors/overrides.ts` (or `MOBILE_OVERRIDES` split by area and spread in), keep per-feature files only for routing (`xRefusalOf`, `keepsXKey`), and have `isAppRefusal` and `coachErrorCode` call `errorCode`.
Fix-Class: Residual. Touches more than 5 feature modules and their tests, and moves exported tables.
Priority: Pain 2 × Spread 3 = 6
Intent: intentional (coaching's copy is documented temporary debt whose trigger has passed), accidental for the rest

**R4 Accidental Complexity: the "one pending intent" rule is enforced by three copy-paste stores plus cross-clears (Warning)**
Symptom: `pendingSlot.ts:42-84`, `matches/pendingJoin.ts:40-80` and `coaching/pendingLesson.ts:27-69` are line-for-line the same module-level store (`pending`, `pendingAt`, `listeners`, `emit`, TTL-on-read, `subscribe`, `useSyncExternalStore`). `booking/pendingIntent.ts:42-88` re-establishes the MB-04 invariant by hand: `hasPendingIntent` ORs three getters, `subscribe` fans out to three, and `setOnlyPendingSlot/Join/Lesson` each clear the other two (an N×(N−1) matrix). A second family of copy-paste stores holds persisted booleans: `playProfile/askDismissed.ts:18-71`, `assistant/freeMode.ts:20-67` and `auth/welcomeSeen.ts:15-51`.
Source: Fowler: Duplicate Code. Ousterhout, ch. 4: Modules Should Be Deep (the invariant should live in the module, not in its callers).
Consequence: a fourth intent kind (a tournament registration that survives sign-in, say) means a new store, edits to all three `setOnly*`, `hasPendingIntent`, `subscribe`, `clearPendingIntents` and the post-auth continuation. One missed clear lets two intents survive, which is exactly what MB-04 forbids.
Remedy: one store holding `PendingIntent = {kind:'slot'…} | {kind:'join'…} | {kind:'lesson'…}`, so "only one" holds by construction. Keep typed selectors (`usePendingSlot()` = `kind==='slot' ? …`). A small `createPersistedFlag(key)` factory covers the three booleans.
Fix-Class: Residual. Changes the exported store API that screens and the continuation use.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R3 Knowledge Duplication: the Qi payment start sequence is copied three times and has diverged (Warning)**
Symptom: "save pointer → `claimResume(ref)` → replace to `/pay/status?ref` → `openPaymentPage(formUrl)`" is written out in `features/deposit/hooks.ts:142-152`, `features/matches/tickets.ts:92-99` and `features/coaching/payment.ts:70-83`. Coaching navigates with `replaceTop` (`payment.ts:82`), the other two with `router.replace`. The pointer shape's purpose-specific fields are documented as comments in `deposit/pendingPayment.ts:20-46`.
Source: Fowler: Duplicate Code. Hunt & Thomas: DRY.
Consequence: online payment is off in every build today (`features/deposit/enabled.ts`, F-02), so this is latent. When it is switched on, a fix to the crash-resume ordering (pointer before claim before navigate) has to land three times, and the navigation behaviour already differs between lessons and the rest.
Remedy: one `startPaymentAttempt({ userId, attempt, pointer, navigate })` in `features/deposit/`, used by all three.
Fix-Class: Extended-Safe. New helper plus 3 call sites, no exported symbol removed, vitest covers `pendingPayment`.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

**R5 Dependency Disorder: features form a mesh, and the shared payment and UI layers depend on their consumers (Warning)**
Symptom: the module-level import graph (`app/`+`src/`, tests included) has 43 bidirectional pairs. Among them: `deposit ↔ matches` (5/8 edges), `deposit ↔ coaching` (2/9), `booking ↔ matches`, `auth ↔ profile`, `components ↔ features/{auth,availability,booking,coach,profile,staff,assistant}`. `deposit`, the payment service, imports its consumers' cache keys and types: `deposit/hooks.ts:20-22` (`bookingKeys`, `matchKeys`, `coachingKeys`), `deposit/pendingPayment.ts:31` (`matches/continuation`), `deposit/logic.ts:14` (`booking/logic`). Its consumers import it back: `matches/tickets.ts:26-28`, `matches/api.ts:19`, `coaching/payment.ts:21-23`, `coaching/api.ts:19`. Guest coaching takes its night rule from matches (`coaching/logic.ts:33`). The shared kit reaches into staff internals (`components/DecisionBar.tsx:26`, `components/PhotoButton.tsx:47`). `lib/bootPrefs.ts:22-26` imports from three features. A Tarjan pass found no file-level cycle, so the tangle exists only at module level.
Source: Martin, Clean Architecture: Acyclic Dependencies and Stable Dependencies principles. Brooks, Mythical Man-Month: Conceptual Integrity.
Consequence: you cannot change or test `deposit` without the match, coaching and booking modules, and a feature cannot be removed or flag-stripped cleanly (the payments-off build still links all of it). No rule says which way a dependency may point, so each new feature adds edges in both directions.
Remedy: state a layering rule (lib/theme/i18n → components (kit only) → shared services (deposit, errors, invalidation) → features → app). `deposit` should expose `onSettled(purpose)` / `afterPayment` events (see the invalidation finding) and take the continuation as an opaque payload. Move `MULTILINE_*` and the photo helper out of `features/staff` into `components/` or `lib/`. Enforce the rule with an `import/no-restricted-paths` zone.
Fix-Class: Residual. Cross-module restructuring.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R5 Dependency Disorder: two conventions for where feature UI lives, and the "booking" file holds the app's primitives (Warning)**
Symptom: older features put their UI in shared-layer grab-bags: `components/booking.tsx` (2086 lines, 22 exports), `match.tsx` (1448, 20), `coachMode.tsx` (1367, 18), `tournament.tsx` (1226, 11), `coaching.tsx` (947, 15), `play.tsx` (808, 9). Newer ones keep it in the feature: `features/loyalty/PointsCard.tsx`, `features/cafe/*`, `features/ranks/*`, `features/assistant/parts.tsx`. `components/booking.tsx` also exports generic primitives used across the app: `StatusPill` (`:96`; used by staff run/step/request screens), `ListHeading` (`:784`; coach-mode screens), `FilterChip` (`:831`; coach statements, staff runs) and `MenuRow` (`:2009`; profile, staff marketing/shopping, `features/staff/todayGroups.tsx`). The same component names mean different things: `NightHeader` in `components/play.tsx:166` vs `components/coachMode.tsx:234` (staff incidents imports the play one).
Source: Brooks: Conceptual Integrity. Martin: Common Closure Principle. McConnell, Code Complete: names that require reading the implementation.
Consequence: a new contributor cannot tell where a component belongs or where to find one. Touching `booking.tsx` to change a guest slot cell recompiles and re-reviews the staff and coach-mode primitives in the same 2k-line file, and the smoke suites of four areas depend on it.
Remedy: keep `components/` for the kit (ui, overlays, states, pickers, plus the four primitives moved to `components/rows.tsx`). Move each feature's display components to `features/<x>/ui/`, as the newer features already do. Rename one `NightHeader`.
Fix-Class: Residual. Many files, and moves exported components.
Priority: Pain 2 × Spread 3 = 6
Intent: accidental

**R1 Cognitive Overload: god render units on the Book tab (Warning)**
Symptom: `components/Court3D.tsx:472-1656` is one 1185-line component function with 12 `useEffect`s and 35 `useRef`s. `features/availability/useAvailabilityBooking.ts:161-709` is one 549-line hook composing about 20 hooks (profile gate, branch, courts, settings, degraded, gender rules, grid, warm-up, broadcast, match slots, hold, router, toast). `components/BookingSheet.tsx:128-731` is a 604-line component. `features/loyalty/PointsCard.tsx:509` is a 408-line component. `useAvailabilityWindow` takes 8 positional parameters, two of them bare booleans (`features/availability/hooks.ts:277-286`, called as `…, settings.isSuccess, open, true)` at `:347-356` and `…, open, false)` at `:476-485`).
Source: McConnell: Ch. 7 High-Quality Routines. Fowler: Long Method, Long Parameter List, Flag Argument.
Consequence: these are the most performance-sensitive surfaces (the long comments record owner-reported hitches, 2026-09-05/08) and the hardest to change safely. There is no simulator on this Mac (memory note), so a refactor is verified only by smoke renders that mock Court3D out entirely (`jest.setup.ts` mocks `./src/components/Court3D`).
Remedy: do not split the rAF loop. Extract Court3D's surface lifecycle, reveal/fade and probe timer into hooks next to the existing `features/courtTransition/*` helpers. Split `useAvailabilityBooking` into `useBookingGate`, `useLaneGrid` and `useMatchChips`, with the orchestrator only composing them. Give `useAvailabilityWindow` an options object.
Fix-Class: Residual. Perf-critical, no device verification here.
Priority: Pain 2 × Spread 2 = 4
Intent: intentional (documented performance work)

**R2 Change Propagation: push notification routing is an if/else ladder in `profile/` (Warning)**
Symptom: `installNotificationHandler` (`features/profile/push.ts:336-360`) takes 12 optional per-kind callbacks. The tap path is a 6-branch `dest?.kind ===` ladder (`:385-405`), the foreground path a second ladder (`:444-449`) importing each feature's `is*PushKind` (`:42-44`), and `app/_layout.tsx:513-545` wires each callback with its own `isOnScreen` guard and key invalidation. `useRefreshLessons` (`coaching/hooks.ts:275`) and `useRefreshMatches` (`matches/hooks.ts:419`) say they are "for the root layout's foreground push listener", but nothing calls them. `_layout` inlines the invalidation instead (dead-code gate below).
Source: Fowler: Shotgun Surgery, Switch Statements. Ousterhout: Information Leakage.
Consequence: a new push kind (ranks confirmations, rewards) means editing the feature's `pushRoutes.ts`, both ladders, the options type and `_layout.tsx`. Push lives in `profile`, so the routing logic for every feature changes under that feature's name.
Remedy: a `pushRoutes` registry, `{ kind → { href(data), onForeground(queryClient) } }`, contributed by each feature and iterated by a `features/push/` handler. Delete the two dead hooks.
Fix-Class: Residual. Changes the exported handler signature and `_layout`.
Priority: Pain 2 × Spread 2 = 4
Intent: accidental

### 🟢 Suggestion

**R3 Knowledge Duplication: the default venue timezone is written 10 times (Suggestion)**
Symptom: `'Asia/Baghdad'` appears as a fallback in `features/matches/errors.ts:96`, `matches/logic.ts:1134` and `matches/hooks.ts:66`, and as five separately exported `DEFAULT_TZ`s (`coach/logic.ts:162`, `availability/assemble.ts:100`, `tournaments/logic.ts:39`, `coaching/logic.ts:110`), plus `app/(coaching)/class/[id].tsx:95`, `lesson/[id].tsx:99` and `lesson-review.tsx:130`. `@touch/core` has no such constant.
Source: Hunt & Thomas: DRY. McConnell, Ch. 12: magic constants.
Consequence: a second-country branch, or a change to the fallback, is a grep hunt, and any missed copy renders wrong local times only when settings have not loaded.
Remedy: export one `DEFAULT_VENUE_TZ` from `@touch/core/time` and import it everywhere.
Fix-Class: Extended-Safe, in passes of ≤5 files (re-export under the old names first).
Priority: Pain 1 × Spread 3 = 3
Intent: accidental

**R3 Knowledge Duplication: JSON coercion helpers are re-declared per logic file with different meanings (Suggestion)**
Symptom: `str`/`int`/`arr`/`obj`/`bool`/`isObj` are local in `matches/logic.ts:143-151`, `coaching/logic.ts:116-126`, `coach/logic.ts:32-40`, `tournaments/logic.ts:45-53`, `ranks/logic.ts:94-97`, `loyalty/logic.ts:24-27`, `deposit/logic.ts:47-50`, `matches/continuation.ts:148`, `availability/branch.ts:53` and `assistant/chat.ts:264-265`. Semantics differ: `str` returns `''` (coach, loyalty) or `null` (others); `int` falls back to `0` (coach, ranks) or `null` (coaching, matches, tournaments). The `coach_slots` drift above is one direct result.
Source: Fowler: Duplicate Code.
Consequence: the same wire field parses to different "missing" values depending on which feature reads it, and nothing flags it.
Remedy: one `lib/wire.ts` (pure, vitest) exposing `str`/`strOrNull`/`int(fallback)`/`arr`/`obj`, adopted file by file.
Fix-Class: Extended-Safe. Non-exported locals replaced by a new shared module, ≤5 files per pass.
Priority: Pain 1 × Spread 3 = 3
Intent: accidental

**R3 Knowledge Duplication: small helpers re-implemented (clock tick, name initial, phone digits) (Suggestion)**
Symptom: a hand-rolled `setInterval(() => setNow(…), 60_000)` clock appears in `features/availability/useAvailabilityBooking.ts:203` and `features/coaching/useLessonBooking.ts:92`, and in `app/booking/[id].tsx:89`, `app/(tabs)/bookings.tsx:259`, `app/(tabs)/play.tsx:203`, `app/(matches)/match/[id].tsx:193` and `app/(tournaments)/tournament/[id].tsx:137`. Name initial: `profile/names.ts:65` (`avatarInitialsOf`), `coaching/logic.ts:1233` (`coachInitial`), an inline version in `components/coachMode.tsx:119`, and `app/profile-edit.tsx:159`. Phone normalisation: `lib/phone.ts:8` (`normalizePhone`), `auth/social.ts:192` (`phoneDigits`, a private namesake of `@touch/core` `phoneDigits`), and `profile/phone.ts:425` (`composePhone`).
Source: Fowler: Duplicate Code.
Consequence: small but real drift. For example, `coachMode`'s initial falls back to `'·'` while `coachInitial` has its own rule, and the verified-phone check (`social.ts:208-209`) compares digits differently from the profile save.
Remedy: `lib/useNow(intervalMs)`; one `initialOf(name)` in `profile/names.ts`; route phone comparisons through `composePhone` or core `phoneDigits`.
Fix-Class: Extended-Safe.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication: `profiles.preferred_lang` has two writers, one in the i18n layer (Suggestion)**
Symptom: `i18n/LocaleProvider.tsx:81-93` updates `profiles` directly with its own `supabase` import. `features/profile/api.ts:113-116` (`updatePreferredLang`, called from `profile/push.ts:130`) is the other writer. Neither updates the `own-profile` cache.
Source: Hunt & Thomas: DRY. Martin: SDP (infrastructure context reaching into a feature's table).
Consequence: two code paths decide when and how the language syncs, and the i18n provider gains a database dependency.
Remedy: have `LocaleProvider` take an `onLocaleChanged` callback that the root wires to `updatePreferredLang`.
Fix-Class: Extended-Safe. Two or three files.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R3 Knowledge Duplication: the smoke harness restates the app's provider tree by hand (Suggestion)**
Symptom: `test/smoke.tsx:12,176-206` says it "reproduces app/_layout.tsx's provider tree exactly", but it rebuilds it by hand. It omits `ImmersiveInsets` (`app/_layout.tsx:563`) and leaves `StaffStatusProvider` out of guest cases, while production always mounts it (`:576`).
Source: Fowler: Duplicate Code. Feathers, Working Effectively with Legacy Code: seams.
Consequence: a provider added to `_layout` (the next context a screen reads) passes every smoke test until a real device crashes.
Remedy: extract `AppProviders({ client, locale, appearance, children })` from `_layout.tsx` and render it in both places, with test-only overrides as props.
Fix-Class: Extended-Safe. Two files plus one new file, and smoke covers it.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R4 Accidental Complexity: dead exports (Suggestion)**
Symptom: dead-code gate. A repo-wide `rg` over `apps packages scripts docs e2e qa` (tests and docs included) finds only the definition line for `appSchema` (`lib/supabase.ts:93`), `chunkArray` (`lib/chunk.ts:33`), `useRefreshLessons` (`features/coaching/hooks.ts:275`), `useRefreshMatches` (`features/matches/hooks.ts:419`), `USERNAME_MIN`/`USERNAME_MAX` (`features/profile/username.ts:10-11`) and `CAP_HEIGHT` (`features/courtTransition/logoMark.ts:88`). None is an RPC name, i18n key or route string, and apps/mobile exports nothing to another package. `username.ts:15` hard-codes `{1,18}` instead of deriving it from the unused MIN/MAX.
Source: Fowler: Speculative Generality / Dead Code.
Consequence: misleading surface. `appSchema`'s comment presents it as the way writes go, and the two refresh hooks claim a caller that does not exist.
Remedy: delete them, or derive the username regex from the constants and keep those.
Fix-Class: Extended-Safe. App-internal exports with no consumer outside their file (gate shown), so this is not a public-API break.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R1 Cognitive Overload: smoke suites growing into dated integration suites (Suggestion)**
Symptom: per CLAUDE.md, the smoke runner is "one smoke render per screen", which `test/smokeCase.tsx` `runSmokeCases` implements well. Around it, suites organised by event have grown up: `smoke/launchFixes.smoke.test.tsx` (466 lines, F-16/F-59/F-39/F-21/F-70/F-46 per its header `:1-19`), `staffRenames.smoke.test.tsx` and `storeBuild.smoke.test.tsx`. Feature suites are large too: `coaching.smoke.test.tsx` is 1115 lines with 36 `renderRoute` calls and 45 seeds. Fixtures repeat constants (`test/coachFixtures.ts:27` and `test/coachingFixtures.ts:15` both export `COACH_TZ`).
Source: McConnell: organise by function, not by history. Fowler: Long Method (test-side).
Consequence: to find a screen's behavioural tests you have to know which launch fixed it, and deleting a feature leaves its cases scattered across dated files.
Remedy: move each `launchFixes` case into its screen's suite (keep the F-number in the test title), and share one fixtures TZ.
Fix-Class: Residual. A multi-file test reorganisation.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

**R6 Domain Model Distortion: the mobile rulebook and comments point at code that no longer exists (Suggestion)**
Symptom: `apps/mobile/CLAUDE.md:93` sends contributors to "`CODE_TO_KEY` and `mapErrorToKey` (`src/features/booking/errors.ts:12,83`)". `CODE_TO_KEY` no longer exists; it is `MOBILE_OVERRIDES` plus the i18n catalogue (`booking/errors.ts:25,121`), and `packages/i18n/src/catalogs/en.ts:773` and `matches.en.ts:21` still name it too. `CLAUDE.md:101` cites `src/lib/network.ts:66` (the file has 44 lines). `CLAUDE.md:3-4` lists 9 features (19 exist). `features/availability/hooks.ts:229` refers to `usePrefetchAdjacentDays` (gone).
Source: Evans: Ubiquitous Language. Winters et al., Software Engineering at Google: docs as code.
Consequence: CLAUDE.md is the binding rulebook for every agent and contributor, so stale pointers send them to the wrong place for the one rule ("a new code gets an entry there") they most need.
Remedy: update the citations to `MOBILE_OVERRIDES` / `errorMessageKey` and the current feature list, and fix the comments.
Fix-Class: Extended-Safe. Docs and comments only, ≤5 files.
Priority: Pain 1 × Spread 2 = 2
Intent: accidental

---

## Top offenders

| File | Lines | What's tangled |
|---|---|---|
| `src/components/booking.tsx` | 2086 | 22 exports: guest booking cards (NextUpCard 241 lines, CourtLaneRow 205, SlotCell 139) plus app-wide primitives (MenuRow, FilterChip, ListHeading, StatusPill) used by staff, coach mode and profile |
| `src/components/Court3D.tsx` | 1656 | One 1185-line component: GL surfaces, rAF loop, reveal/fade, liveness probe; 12 effects, 35 refs |
| `src/components/match.tsx` | 1448 | 20 open-match display components in the shared layer; imports matches/logic |
| `src/features/coaching/logic.ts` | 1400 | 14 RPC parsers + gating + grid + display; duplicates coach/logic vocabulary; imports matches' night rule |
| `src/features/coach/logic.ts` | 1374 | Its own copy of the lesson enums, `CoachSlots` parser, photo guard and a fixed-06:00 night rule |
| `src/components/coachMode.tsx` | 1367 | RosterRow 224 lines, HoursDayEditor 154; second CoachAvatar and NightHeader |
| `src/features/matches/logic.ts` | 1254 | Parsers for 12 RPCs + the canonical trading-night rule other features borrow |
| `src/components/tournament.tsx` | 1226 | TournamentTicket 265 lines, TournamentRow 218, seating board |
| `src/components/ui.tsx` | 1214 | The kit itself (SegmentedControl 209, Field 200): large but cohesive |
| `src/smoke/coaching.smoke.test.tsx` | 1115 | 36 renders / 45 seeds; integration tests in the smoke runner |
| `src/components/BookingSheet.tsx` | 731 | One 604-line component |
| `src/features/availability/hooks.ts` + `useAvailabilityBooking.ts` | 715 + 709 | Module grid cache, placeholder logic, realtime patching, polls; a 549-line orchestrating hook |
| `src/lib/queryClient.ts` | 384 | Every family's retry/network/persistence policy, registered by hand |

## Looks bad but is fine

- **Large `features/*/logic.ts` files** (coaching 1400, coach 1374, matches 1254, deposit 792, tournaments 654). They are pure, sectioned per RPC, and vitest-covered, and CLAUDE.md requires logic to live in `logic.ts` so it can be tested under node. Only the duplication between them is flagged.
- **The module-level `gridCache` beside react-query** (`availability/hooks.ts:205-252`). This is a second cache, but it is documented perf work (owner, 2026-09-08), validated by input identity, bounded at 8 entries, and it stores derived grids, not server data.
- **`lib/queryClient.ts`'s per-family blocks.** CLAUDE.md requires retry, online-pause, focus and persistence to be "set once in queryClient". Only the registry shape and deny-list default are flagged.
- **Money.** No IQD maths is re-implemented in the lane. Display goes through `lib/price.ts:11` `formatPrice` → `@touch/i18n` `formatIQD`, and amounts are server-computed.
- **The api layer.** It is consistent: every feature `api.ts` takes an injected client and writes through `schema('app').rpc`, a testable seam. The one exception is `assistant/api.ts`, which uses the module client because it streams SSE from an edge function.
- **No file-level import cycles** (Tarjan over `app/`+`src/`: 0 SCCs). The mesh in the R5 finding exists at module level only.
- **No TODO/FIXME/HACK, no `@ts-ignore`, `@ts-expect-error` or `as any`** in lane production code (0 hits). `eslint-disable` appears at most 4 times per file, each with a reason.
- **`TabsLayout.ios.tsx` and `TabsLayout.android.tsx` repeat the tab list.** This is the native-feel rule (NativeTabs vs JS Tabs), not accidental duplication.
- **The `testIdElements` registry** in `packages/config/src/eslint.js:178` is a manual list (89 names). It is CLAUDE.md-mandated. `BirthDatePicker` and `IdentifierField` are missing from it, but both declare `testID: string` as required, so TypeScript already catches a missing id.
- **vitest `queryDefaults` tests import `lib/queryClient`** (which imports react-native). They `vi.mock` the three native modules, so they still run as plain node.
- **Per-hook `staleTime` literals** (about 15 distinct values). Freshness is a per-read decision, and CLAUDE.md centralises only retry, online, focus and persistence.
- **Phone validation is worldwide while `@touch/core/phone` is Iraq-only.** This was an owner decision (2026-09-15, `auth/phoneOtp.ts:59-66`).
- **Per-feature error modules as such.** Each owns its screen routing (`startRefusalOf`, `bookRefusalOf`, `keepsLessonKey`), which is legitimately feature-specific. Only the code→line tables and the code readers are flagged.
- **The smoke harness design** (`test/smokeCase.tsx`: the route table as the single source of primary ids, object rows to dodge jest-each arity, todo-as-skip). This is good structure; only the hand-copied provider tree and the dated suites are flagged.

## Debt Summary

| Risk | Findings | Avg Priority | Classification | Intent |
|------|----------|-------------|----------------|--------|
| Cognitive Overload      | 2  | 3.0 | Monitored | intentional (Court3D/booking perf), accidental (smoke) |
| Change Propagation      | 3  | 4.3 | Scheduled | accidental |
| Knowledge Duplication   | 10 | 3.8 | Scheduled | accidental (coaching error reader: intentional, overdue) |
| Accidental Complexity   | 2  | 3.0 | Monitored | accidental |
| Dependency Disorder     | 2  | 6.0 | Scheduled | accidental |
| Domain Model Distortion | 1  | 2.0 | Monitored | accidental |

**Recommended focus:**
1. Dependency Disorder: state a layering rule and enforce it, then pull `deposit`, errors and invalidation out as shared services.
2. Knowledge Duplication: one trading-night rule, one lesson model, one error-line table, one invalidation module.
3. Change Propagation: a declarative query-family registry with allow-list persistence. Ship the one-line `assistant` deny entry first.

---

## Summary

Ship the one-line fix that keeps `['assistant']` off the plaintext disk cache today. Then turn query-family policy into a registry with allow-list persistence, so the next family cannot fail open. Over the quarter, the leverage is in the seams between features rather than inside them: give deposit/errors/invalidation a shared-service layer and collapse coach vs coaching onto one lesson model and one trading-night rule.

**Health Score:** 32/100. Counts: 0 Critical, 12 Warning (−60), 8 Suggestion (−8), balanced preset.
