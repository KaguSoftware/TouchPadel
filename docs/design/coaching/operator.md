# Coaching: operator contract (§5, lane Operator)

Date: 2026-10-01. Status: **design, lane section of `build-contracts-2026-10-01.md`; nothing built.**

Consistency pass 2026-10-01: aligned with §1.12–§1.13 and C-21…C-31.

Order of authority: `build-contracts-2026-10-01.md` §0.2b (C-21…C-31) and §0.2 (C-1…C-20), then the
§1.13 review rulings (R24–R63), the §1.12 merge rulings (R1–R23), §1.1–§1.11, then this file. The
read shapes follow the binding X1–X29 table and the error vocabulary the X31 table of
`drafts/review-rules-privacy-2026-10-01.md` §5 (R41, R52). Nothing in §1 is renamed here. New names
are listed under "Additions to §1" at the end, with this lane's contradictions and how the rulings
settled them.

`op/` is `apps/operator/src/`. `path:line` was read on `d93bd9bf`. A migration is named by its
§1.1 ordinal. "Desk" means the court desk screens under `/desk`. The open-matches operator
contract (`docs/design/open-matches/operator.md`, "OM §5.x") is the house precedent this file
follows wherever it does not say otherwise.

## 5.1 Ground rules

- **Every coaching write is a direct `appRpc('<name>', …)` with the literal RPC name** (CD-6, the
  DF-11 precedent). No queued mutation type, so the six-copy rule (`apps/operator/CLAUDE.md`,
  "Writes") is untouched. No wrapper: the assistant map finds operator callers with
  `(?:appRpc|\.rpc)\(\s*'name'` (`packages/db/scripts/build-assistant-map.mjs:519`), and a type
  argument hides the caller (`op/features/matches/rpcCallers.test.ts`), so results are cast, not
  typed at the call. The one coaching money write that is queued is a refund of desk lesson money:
  it is the till's `payment.refund` (R22), not a coaching write.
- **Idempotency.** A keyed write (`desk_book_lesson`, `desk_create_group`, `desk_create_course`,
  `desk_add_student`, `lesson_settle`) sends `p_idempotency_key` minted once per dialog as
  `` `lesson.<action>:${crypto.randomUUID()}` `` in a `useRef`, sent again on a retry, re-minted
  after a success (`op/features/desk/CourtBlock.tsx:296,320`; `useMatchIdemKey`,
  `op/features/matches/useMatches.ts:214-225`). `lesson_settle` also sends
  `p_device_id = deviceId()` (`op/lib/idem.ts:32`).
- **The server is the wall.** Screen-level buttons follow `CAPABILITY_ROLES` (§5.3.1). Row-level
  buttons follow the `can` objects of `desk_lesson_detail` (§5.6.2) and `coach_statement_detail`.
  No inline role comparison (`apps/operator/CLAUDE.md`, "Roles and routes"). Every staff coaching
  RPC checks the role before any argument (R57), so a refused role always reads `FORBIDDEN`.
- **No money is computed on a staff screen.** Every figure is the server's: a payment's due is the
  enrolment's `money.take_iqd`, and `lesson_settle` re-checks it (`LESSON_OWED_CHANGED`). Course
  splits, late-join prices, course-leave refunds (C-23) and coach shares are never worked out in the
  operator, even though `@touch/core` has the twins (`packages/core/src/coaching/statement.ts`).
- **Clock mirrors use `server_now`** from the payload on screen (cut-off, "starts in", the 24 h
  no-show window of CD-11, a start inside its cut-off, R47), never the station clock alone.
- **Branch.** Reads and writes ride the request headers (`op/lib/venueScope.ts`); an argument that
  names a branch (`p_venue_id`) takes `currentBranchId()`. Only `report_`-prefixed reads widen to the
  owner's "All branches" (`op/lib/venueScope.ts:63`, `REPORT_RPC`).
- **A build never selects a column the server may not have.** `RESERVATION_COLUMNS`
  (`op/features/desk/deskTypes.ts:33-35`) does not gain `lesson_id`: the desk learns which rows are
  lessons from `desk_lessons` (§5.6.1), keyed by `reservation_id`, and from the row's own `kind`.
  The only new filter on `reservations` is written so it is valid on a server without the enum
  value (`.not('kind', 'in', '(hold,maintenance)')`, §5.8).
- **Read shapes are shared (R41).** Every parser in `lessonPayloads.ts` reads its key list from
  `packages/core/src/coaching/shapes.ts` (`COACHING_SHAPES`, one entry per read and per write
  result this lane renders); the DB test asserts every RPC answers a superset of that list. The
  shapes in §5.6 and §5.7 are those lists.
- **Student names stay off disk** (privacy review P15). `QK.coaching` is never in
  `PERSISTED_ROOTS` (`op/lib/persist.ts`) and never wrapped in `cachedQuery` (`op/lib/refCache.ts`):
  `desk_lessons.label` and the rosters carry student names and phones.
- **A typed student stays typed (C-21, R44).** For an enrolment booked by a coach or at the desk,
  every staff surface shows the name and phone recorded on the enrolment, never the linked
  profile's. A phone match the student has not confirmed is invisible to staff: no Open customer,
  no row on that customer's record.
- **Every string is a catalog key**, EN and DRAFT-AR (§5.20); the Arabic lesson words come from the
  shared coaching glossary (R55). Numbers go through `formatNumber`/`formatIQD` (Latin digits in
  both languages), names inside sentences through `isolate()`, counts and `4/6` through
  `isolateLtr()`, counted phrases through `countPhrase` / `pluralForm`.

## 5.2 What the decisions force on the staff side

| Decision | Staff side |
| --- | --- |
| C-1 | Three kinds everywhere a lesson is shown: Private lesson / Group session / Course, each with its own badge word; a course session also says "Session 2 of 8". |
| C-2, C-10, C-20, R9 | A desk-booked private lesson takes **any free court** at the branch: the desk does not choose it. The new-lesson dialog offers only 30-minute starts the coach is free for (`coach_slots`); every lesson start is on the grid. After creation, if the court differs from the one pressed, the toast names it and the lesson screen offers **Move court** at the same times. |
| C-3, CD-1 | Every desk- or coach-booked enrolment is paid at the desk (`payment_mode 'desk'`). Online enrolments show "Paid online" or "Awaiting the guest's payment" and never offer Take payment. |
| C-4 | `/admin/coaches` › Hours lets a manager override a coach's hours and time off; the screen says who last set them. |
| C-5, C-17, R46 | A manager edits a draft lesson type, price included, directly. Once launched, its price, court share, per-coach prices and shape (length, sessions, a private type's party size) are read-only for the manager, with **Propose a price** or **Make a new lesson type…**; switching a launched type off and on stays direct. The owner edits directly. |
| C-6, C-18, CD-5 | The coach's share is shown only as the server's figure ("Owed to coaches"); `coach_share_bp` is an owner-only setting, read-only for a manager. |
| C-7, R43 | A manager makes a coach from an existing customer (`coach_promote`); only managers edit display names, bio and photo. A photo uploads to a fresh random folder, never one named by a profile or coach id. The account name and phone are shown to staff and never labelled as public. |
| C-8, CD-2 | Students a coach or the desk adds show "Added by the coach" / "Added at the desk"; no strike is mentioned for them. |
| C-9, R36 | Cancels say what happens to money: desk money becomes a **refund due** (manager, the till's refund flow, capped at what is due unless the manager marks it goodwill); online money is refunded by Qi (`refund_reason 'coach_cancel'`). |
| C-12, R4, R59 | Coach pay statements: approve (a confirm, no PIN), then mark paid under a manager PIN with a payment reference. Voiding an approved statement takes a manager PIN too. A statement below zero cannot be marked paid. Marking paid moves no till money. |
| C-13, R47 | The desk creates group sessions and courses (`desk_create_group`, `desk_create_course`); courts are taken at creation. A session (a course: session 1) that would start inside its cut-off is refused. |
| C-14, R26 | A group session or course below its minimum shows "Needs 2 more by 18:00 or it is cancelled" until its cut-off. A group or course type with a minimum above 1 has a cut-off of at least 1 hour; new types default to 2 hours. |
| C-15, R39, R48 | A late course sign-up shows "Joined at session 3 · pays for 6 sessions"; the price is the server's. Adds to a course close when its last session starts; a group session takes walk-ins until it ends. |
| C-19, R8, R32 | Every lesson kind can be rescheduled (a held lesson cannot); a course session is never dropped: no per-session cancel. Cancelling the rest of a course is one action on the course. |
| C-21, R44 | A student a coach or the desk typed shows as typed everywhere staff look; an unconfirmed phone match never shows as a link. |
| C-22, R61 | The Coaches tab shows "Waiting for the coach to accept" until the coach accepts in the app; until then guests do not see the coach, and desk and coach bookings work. |
| C-23, R62 | A guest leaving a running course gets back the shares of the sessions outside the cancellation window; the roster and the refunds-due lists show the server's figures. |
| C-24, R56 | The owner sets how many upcoming private lessons a coach may hold for their students (default 10). A coach-booked private lesson still unpaid is flagged "Booked by the coach · unpaid"; the statement lists coach-booked no-shows. |
| C-25, R45 | Retiring a coach cancels their upcoming lessons and courses as coach cancels (refunds, pushes) and is never refused; the confirm says so. |
| C-26, R50 | The online payment modes stay disabled in the settings panel until the lessons terms version is live, with the reason shown. |
| C-28, R42 | No assistant tool reads statements or `report_lessons`; aggregates stay. |
| C-29, R63 | A deleted coach keeps their display name on Coach pay; the Coaches tab reads "Account deleted". |
| C-30, R55 | Arabic «حصة» for a lesson, «أجرة الملعب» for the court share, «نصيب المدرّب» for the coach's share. |
| C-31, R27 | Day close counts a refund on the day it is made; the copy says so. |
| CD-6 | Every coaching write is disabled offline with one reason (§5.5). |
| CD-11 | No-show is offered from the start until 24 hours after it (`can.mark_no_show`). |
| CD-12 | A retired coach's row reads "Retired"; their statements stay. |

## 5.3 Capabilities, routes, rail and setup entries

### 5.3.1 Capabilities

`CAPABILITY_ROLES` (`op/lib/auth.tsx:388-534`) gains the four §1.11 names, after the open-matches
block (`:505-533`), each the guard of the RPCs behind it (§1.7):

| Capability | Roles | Gates |
| --- | --- | --- |
| `runLessons` | court_desk, manager, owner | New lesson (all three kinds), Add student, Cancel enrolment / lesson / course, Reschedule, Move court, Arrived / No-show / Undo, the record's Lessons panel and "Book a lesson", the Today group's New lesson |
| `takeLessonPayment` | cashier, court_desk, manager, owner | Take payment (`lesson_settle`) on the lesson screen and on the customer record. Never `permissionsFor().takeCourtPayment` (`auth.tsx:617`), which includes shop_staff. |
| `manageCoaches` | manager, owner | `/admin/coaches` writes, "Make coach" and "Open in Coaches" on the record, the Setup card's status line |
| `settleCoaches` | manager, owner | `/reports/coaches` Recount, Approve, Void, Redraft, Mark paid |

Reused, not new: `editVenueDetails` (owner) gates editing the coaching settings panel, as it gates
`MatchSettingsPanel` (`op/features/admin/settings/VenueDetailsTab.tsx:97-99`); `editLaunchedPrices`
(`auth.tsx:417`, owner and shop_staff, who cannot open `/admin`) gates editing a launched lesson
price, a launched type's shape and `set_coach_price`; `launchDirectly` (`:423`) gates putting a
lesson type on sale without a protocol; `startProtocolPriceChange` (`:409`) via
`usePriceChangeStart` (`op/features/admin/promotions/PriceChangeStart.tsx:20-26`) gates "Propose a
price"; `permissionsFor().refund` (`:622`) gates Refund on the refunds-due lists.

`useCoachingCaps()` in `op/features/coaching/useCoaching.ts` returns the four plus those reused ones,
the `useMatchCaps` pattern (`useMatches.ts:183-196`).

### 5.3.2 Routes

| Route | `ROUTE_ROLES` | Registered in | Component |
| --- | --- | --- | --- |
| `/desk/lessons/$id` | none: inherits `/desk` by longest prefix (`auth.tsx:346-362`), like `/desk/matches/$id` (`op/routes/desk/_children.ts:148-160`) | `deskChildren` (`_children.ts`), new `lessonDetailRoute` | `op/features/coaching/LessonDetail.tsx` `LessonDetailScreen` |
| `/admin/coaches` | none: inherits `/admin` (manager, owner) | `SUB_ROUTES['/admin']` after `'/admin/courts'` (`auth.tsx:295-312`); `adminChildren` (`op/routes/admin/_children.ts:24-43`) after `adminCourtsRoute`; new `op/routes/admin/coaches.tsx` (copy of `routes/admin/branches.tsx`) | `op/features/admin/coaches/CoachesAdmin.tsx` `CoachesAdmin` |
| `/reports/coaches` | none: inherits `/reports` (manager, owner) | `reportsChildren` (`op/routes/reports/_children.ts`), its own `createRoute` because it validates a search param | `op/features/reports/coaches/CoachStatements.tsx` `CoachStatementsScreen` |

Search params (validated at the route, hand parsers like `validateMatchSearch`):
- `lessonDetailRoute`: `{ customer?: uuid, pay?: uuid }`. `customer` (handed back from search or
  create) opens Add student with that customer picked; `pay` (an enrolment id, from the Today group
  or the record) opens Take payment on that enrolment once the detail has loaded.
- `validateCalendarSearch` (`_children.ts:73-79`) accepts `kind: 'lesson'` beside `'match'`:
  `/desk?customer=<id>&kind=lesson` is the record's "Book a lesson" (§5.9).
- `validateCustomerSearch` (`_children.ts:43-52`) and its copy in `CustomerSearch.tsx:60-70`
  accept `attach: 'lesson'` with `lesson: uuid`; attach returns to `/desk/lessons/$id?customer=<id>`.
  `validateCustomerCreateSearch` accepts the same pair; `CustomerCreate.tsx` returns there.
- `/admin/coaches`: `{ tab?: 'coaches' | 'types' | 'hours', coach?: uuid, promote?: uuid, type?: uuid }`
  (`tab` is §1.11's; `coach` opens that coach's editor or, on Hours, picks the coach; `promote`
  opens "Make a coach" with that customer picked; `type` opens that lesson type).
- `/reports/coaches`: `{ month?: 'YYYY-MM-01' }`.
- `/protocols` (`op/features/protocols/search.ts`): `lessonType` and `coach` join `UUID_PARAMS`;
  `PRICE_CHANGE_KINDS` gains the three lesson kinds (§5.14).

`/admin/coaches` is in `SUB_ROUTES`, so `check-assistant-coverage.mjs` requires
`"/admin/coaches": "map:page"` in `packages/db/fixtures/assistant-coverage.json` (`routes`, `:977`).
`/desk/lessons/$id` and `/reports/coaches` are in neither `ROUTE_ROLES` nor `SUB_ROUTES`, so they need
no coverage entry; `/reports/coaches` is a rail `to` (§5.3.3), so the map needs a pages.md sentence
for it (`build-assistant-map.mjs:691-712`), and `/desk/lessons/$id` gets one by choice (§5.23).

### 5.3.3 Rail, Setup and Financial entries

`op/lib/workspaces.ts`:
- `NavItem.labelKey` (`:44-65`) gains `'coaches' | 'coachPay'`.
- `OWNER_SETUP` (`:345-353`) gains `{ to: '/admin/coaches', labelKey: 'coaches', icon: 'whistle' }`
  after Courts; `MANAGER_SETUP` (`:221-225`) gains the same row after Rates.
- `OWNER_FINANCIAL` (`:259-266`) gains `{ to: '/reports/coaches', labelKey: 'coachPay', icon:
  'whistle' }` after Day close. It wins over the Reports row's `/reports` prefix in
  `sectionForPath` (an exact `to` beats a prefix, `navMatchScore`), so the Coach pay row lights on
  its own screen and the Reports row on the others.
- `MANAGER_RECORDS` (`:213-216`) gains the same Coach pay row after Reports.
- `workspaceForRoute` (`:494`) is unchanged: both routes are shared.

Cards: `op/features/admin/SetupHome.tsx` `CardKey` (`:69`) gains `'coaches'`, with the status line
"Coaches 3 · Lesson types on sale 4" / "المدرّبون 3 · أنواع الحصص المعروضة 4" from `coaches_admin`
(`manageCoaches`, `RPC_MISSING` → no line). `op/features/financial/FinancialHome.tsx` `CardKey`
(`:44-46`) gains `'coachPay'`, with "To approve 2 · To pay 1" / "للاعتماد 2 · للدفع 1" (draft and
approved statements) from `report_coach_statements` for the current month (no line when both are
zero). The cards themselves come from the rail (`sectionDestinations`, `op/components/SectionHome.tsx`),
so no card list is edited. Strings: `ws.shell.nav.coaches` "Coaches" / "المدرّبون",
`ws.shell.nav.coachPay` "Coach pay" / "مستحقات المدرّبين", `ws.owner.setupHome.cards.coaches`
"Coaches, the lessons they teach, prices and hours" / "المدرّبون والحصص التي يقدّمونها وأسعارها
وساعات العمل", `ws.owner.financialHome.cards.coachPay` "Monthly coach statements: approve and mark
paid" / "كشوف المدرّبين الشهرية: الاعتماد وتسجيل الدفع".

Icon: `op/components/icons.tsx` gains `whistle` (a 24-px stroke path drawn like the others), used for
coaches, the lesson badge and the rail rows.

## 5.4 Query keys, refresh, invalidation, live updates

**`QK.coaching`** (`op/lib/queryKeys.ts`, after `deskMatches` at `:126-144`), one family so one root
refreshes every coaching read. It is never persisted (§5.1):

| Key | RPC | Refresh |
| --- | --- | --- |
| `all: ['coaching']` | root | — |
| `desk(fromIso, toIso)` | `desk_lessons` (`p_venue_id = currentBranchId()`) | 30 s, `keepPreviousData` |
| `lesson(lessonId)` | `desk_lesson_detail` | 20 s, `keepPreviousData` |
| `customer(customerId)` | `customer_lessons` | on mount and focus |
| `admin(branchId)` | `coaches_admin` | on mount; 60 s while `/admin/coaches` is open |
| `settings(branchId)` | `coaching_settings` | on mount |
| `slots(coachId, typeId, fromIso, toIso)` | `coach_slots` | on open of the dialog, `staleTime` 15 s |
| `refundsDue(branchId)` | `lesson_refunds_due` | 60 s |
| `statement(statementId)` | `coach_statement_detail` | on open |

Feature-private, because the report scope invalidates by a `reports` root
(`op/features/reports/ReportBranchScope.tsx:24,61-63`): the statements list
`['reports', 'report_coach_statements', month ?? 'current']`
(`op/features/reports/coaches/statementKeys.ts`), the lessons report
`['reports', 'report_lessons', args]`, and DayClose's existing
`['dayCloseOnline', day?.id ?? 'open']` (`op/features/admin/DayCloseOnline.tsx:27`).

**After each write** the caller invalidates (helpers in `useCoaching.ts`, the
`invalidateMatch*` pattern, `useMatches.ts:231-259`):

| Write | Keys |
| --- | --- |
| book, create group, create course, add student, cancel enrolment / lesson / course, reschedule, move court | `QK.coaching.all`, `invalidateReservations(qc)` (`queryKeys.ts:155-157`), `QK.reservation.all`, `QK.deskMatches.all` (a lesson is firm and can bump a filling match, 0277) |
| attendance | `QK.coaching.lesson(id)`, `QK.coaching.desk` root (`['coaching', 'desk']`) |
| `lesson_settle` | `QK.coaching.all`, `QK.day`, `['dayCloseOnline']` |
| refund (the till's `payment.refund`) | through `RESULT_INVALIDATIONS` (below) |
| coach, type, hours, time off, price writes, status (retire cancels lessons) | `QK.coaching.admin(branch)`, `QK.coaching.desk` root (the envelope carries the catalogue); retire also `QK.coaching.all` and `invalidateReservations(qc)` |
| settings | `QK.coaching.all` |
| statement refresh, approve, void, mark paid | `['reports', 'report_coach_statements']`, `QK.coaching.statement(id)` |

**`RESULT_INVALIDATIONS`** (`op/lib/queueResults.ts:29-46`) adds `QK.coaching.all` to
`payment.refund` only (a lesson refund is the till's queued refund, §5.10.10). `reservation.update`
gains nothing: `move_reservation` refuses a lesson row (R7). `queueResults.test.ts` keeps passing:
the family root is a registry root.

**Live updates.** No new realtime topic. `useTradingNight.ts:145-151` adds `QK.coaching.all` to its
`invalidateKeys`; `LessonDetail` subscribes with `useBroadcast({ topic: 'courts', isPrivate: true,
events: ['slot_changed'], invalidateKeys: [QK.coaching.all] })` (`op/lib/realtime.ts` shares one
channel per topic). Every lesson create, cancel, reschedule and court move writes `reservations`,
so `slot_changed` fires; enrolments and payments write none, and the polls above carry them.

## 5.5 Online-only, offline, switched off, and older servers

Reach comes from `useStationReach()` (`op/lib/stationReach.tsx`), which fails open before the first
heartbeat and outside the shell. Missing RPCs come from `isRpcMissing` (`op/lib/appRpc.ts:102`,
PostgREST `PGRST202` → `RPC_MISSING`).

Every coaching read goes through `lessonRead(call, parse)` in `useCoaching.ts`, the `matchRead` twin
(`useMatches.ts:41-49`): `RPC_MISSING` answers `null` ("no coaching on this server"), a network
failure stays an error. Read status is `matchReadStatus(q, reachable)` (generic, re-used from
`op/features/matches/matchLogic.ts`); the notice is `LessonReadNotice`, the `MatchReadNotice` twin
with `ws.coaching.offline.*` strings.

| Situation | Behaviour |
| --- | --- |
| Offline: any coaching write (book, create, add, cancel, reschedule, move, mark, take payment, every `/admin/coaches` and settings write, every statement action) | Disabled with `disabledReason` "Needs a connection: lessons work online only" / "يلزم الاتصال: الحصص تعمل عبر الإنترنت فقط" |
| Offline: Refund on a refunds-due list | Stays enabled: it is the till's queued `payment.refund`, not a coaching write; a refusal on replay (`REFUND_EXCEEDS_DUE`) arrives as the queue's conflict toast |
| Coaching reads while mounted | Last data kept, with "Last updated {time}" / "آخر تحديث {time}" |
| A coaching read that fails first time | Refused presenter with `wifiOff`: "Lessons can't be shown without a connection" / "تعذّر عرض الحصص دون اتصال", and Retry |
| Coaching switched off at the branch (`coaching_enabled` false) | The desk can still stage lessons (R51: `coach_slots` answers staff whether on or off; desk book, create and add take no `COACHING_OFF`): the booking dialog's Lesson kind, New lesson, Add student and Book a lesson keep working, each with the line "Lessons are switched off at this branch: guests can't see or book this yet." / "الحصص متوقفة في هذا الفرع، فلا يراها الزبائن ولا يحجزونها بعد." |
| `RPC_MISSING` on `desk_lessons` | No Lesson kind in the new-booking dialog, no Lessons group, no New lesson button; lesson tiles cannot exist on such a server (no `lesson` rows) |
| `RPC_MISSING` on `coaches_admin`, `report_coach_statements`, `coaching_settings` | `/admin/coaches` and `/reports/coaches` show `EmptyState` "Coaching needs a server update that isn't there yet." / "يتطلب التدريب تحديثًا للخادم لم يصل بعد."; the settings panel and the Setup and Financial status lines render nothing |
| `RPC_MISSING` on `customer_lessons`, `lesson_refunds_due`, `report_lessons` | The panel or view is absent |
| Calendar and Today board offline | Work from the cached day (`useTradingNight.ts:110-131`). A lesson row (`kind 'lesson'`) still draws as a lesson tile labelled "Lesson" / "حصة" (no coach name without the in-memory `desk_lessons` read) and still routes to the lesson screen, which shows its own offline presenter |
| `day_close_online` without a `lessons` block (a server before 0285) | The lessons group is absent; the rest of the card is unchanged |
| `report_courts` without a `lessons` block, `report_revenue` without `lessonIqd` | No Lessons view; no Lessons figure ("—" is never invented as zero) |

## 5.6 Reads this lane consumes

Parsers are pure and defensive (`op/features/coaching/lessonPayloads.ts`, the `reportPayloads.ts`
`num()`/`str()`/`obj()`/`list()` style): a missing key renders "—", never a made-up zero. Each
parser reads the `COACHING_SHAPES` list of its RPC (R41). Where the X table picked a server lane's
names, they are used below; where it picked this lane's, the DB and Money builders return them.

### 5.6.1 `desk_lessons(p_venue_id, p_from, p_to)` → envelope (DB, 0280; X16, R20)

Called with the trading night's `dayStart`/`dayEnd` (`useTradingNight.ts:97-110`), the window ≤ 3
days (the server refuses over 7). The envelope carries the branch's settings and catalogue because
the desk never calls `coaching_settings` or `coaches_admin` (R20). It answers whether coaching is on
or off (staging, R51).

```text
{ coaching_enabled, lesson_payment_mode, server_now,
  coaches:      [{ coach_id, display_name_en, display_name_ar, status, photo_path,
                   lesson_type_ids[], prices: [{ lesson_type_id, price_iqd }] }]
                                        -- active and paused coaches at the branch, accepted
                                        -- or not (R61); prices are lesson_price_for
  lesson_types: [{ lesson_type_id, kind, name_en, name_ar, duration_min, price_iqd,
                   max_places, min_places, cutoff_hours, sessions_count }]   -- on sale only
  lessons:      [{ lesson_id, reservation_id, court_id, court_name_en, court_name_ar,
                   kind, status, start_at, end_at, hold_expires_at, booked_by_kind,
                   coach_id, coach_name_en, coach_name_ar,
                   lesson_type_id, type_name_en, type_name_ar,
                   course: { course_id, title_en, title_ar, session_no, sessions_count } | null,
                   label,              -- private: the booker's name (R44: as recorded when a
                                       -- coach or the desk booked it); else null
                   party_size,         -- private: the booker's party; else null
                   places_taken, max_places, min_places, cutoff_at,
                   enrolments, owing, owing_iqd, paid_online }] }
```

Rows: lessons of the branch with status `held`, `scheduled` or `completed` and `start_at` in the
window. `reservation_id` is the lesson's live court row, `kind 'lesson'`, or the `hold` row of a
private lesson awaiting Qi (§1.2 "Changed tables"), so a held lesson's block is recognised too.
`owing` counts `booked` desk enrolments whose `take_iqd > 0`; `owing_iqd` sums them.
`booked_by_kind` drives the C-24 flag (§5.8).

### 5.6.2 `desk_lesson_detail(p_lesson_id)` (DB, 0280; money from Money's 0278 internals; X17)

```text
lesson:     { id, venue_id, kind, status, cancel_reason, start_at, end_at, duration_min,
              rescheduled_at, booked_by_kind,
              coach: { coach_id, display_name_en, display_name_ar, status },
              lesson_type: { lesson_type_id, name_en, name_ar },
              course: { course_id, title_en, title_ar, status, cancel_reason, session_no,
                        sessions_count, signup_closes_at, places_taken, max_places,
                        sessions: [{ lesson_id, session_no, start_at, end_at, status,
                                     court_name_en, court_name_ar }] } | null,
              reservation_id, reservation_status, court_id, court_name_en, court_name_ar,
              price_iqd, court_share_iqd, max_places, min_places, places_taken, cutoff_at,
              hold_expires_at, created_by_name, server_now, day_open,
              can: { add_student, cancel, cancel_course, reschedule, move_court } }
enrolments: [{ enrolment_id, scope,              -- 'lesson' | 'course'
               status, cancel_kind, cancelled_at,
               customer_id,                       -- see below
               full_name, phone,                  -- see below (R44)
               typed,                             -- true when the row shows a recorded name
               flags[], party_size, friend_names[],
               first_session_no, sessions_covered,
               booked_by_kind, booked_by_name, payment_mode, created_at,
               attendance: { status, marked_at, marked_by_name } | null,   -- this session's
               money: { price_iqd, owed_iqd, desk_paid_iqd, online_paid_iqd, refunded_iqd,
                        kept_iqd, refund_due_iqd, take_iqd },
               can: { take_payment, cancel, mark_attended, mark_no_show, unmark } }]
events:     [{ at, type, actor, actor_name, enrolment_id, code, late }]  -- last 50, newest first
```

**Names (C-21, R44).** A guest-booked enrolment shows the profile's full name and phone. A coach-
or desk-booked one shows `guest_name` and `guest_phone` as recorded on the enrolment (typed, or for
a customer the desk picked, the customer's name and phone at booking), never re-read from a linked
profile, and `typed` is true. `customer_id` is set for a guest-booked enrolment, a customer the desk
picked, and a phone match the student has confirmed (`link_confirmed_at`); an unconfirmed match
reads `customer_id: null`, exactly like an unmatched walk-in. Staff see phones (C-16 limits coaches,
not staff).

`money` is `lesson_enrolment_money` plus `take_iqd` = `lesson_fee_remaining` (what Take payment
collects; a course sign-up's money is the whole sign-up's, shown on every session). `late` is true
on an `under_filled` event judged after the start (R26: nothing was cancelled). `can` rules the
operator mirrors only for offline and capability: `add_student` (scheduled; a group session before
its end, a course before `signup_closes_at`, R39/R48; a place left); `cancel` (held or scheduled,
not started; a private lesson or group session); `cancel_course` (a course session whose course is
open or running with a session left to start); `reschedule` (scheduled, not started, any kind, R8;
never held, R32); `move_court` (scheduled, not held, before `end_at`); `enrolment.can.take_payment`
(booked, desk mode, `take_iqd > 0`, the lesson not cancelled); `mark_no_show` from the start until
24 h after (CD-11); `unmark` while the mark can still change.

### 5.6.3 The other reads

| RPC (owner lane) | Called from | Keys read |
| --- | --- | --- |
| `customer_lessons(p_customer_id)` (DB, 0280; X18) | record | `coach: { coach_id, status, display_name_en, display_name_ar, venue_ids[] } \| null`, `counts: { lessons, no_shows }`, `lesson_strikes_30d`, `lessons[]: { enrolment_id, lesson_id, course_id, venue_id, kind, start_at, end_at, status, enrolment_status, attendance, type_name_en, type_name_ar, coach_name_en, coach_name_ar, course_title_en, course_title_ar, payment_mode, money: { owed_iqd, desk_paid_iqd, online_paid_iqd, refund_due_iqd, take_iqd } }` (upcoming, then the last 20). Lists only enrolments this customer booked, the desk picked them for, or they confirmed (C-21) |
| `coaches_admin(p_venue_id)` (DB, 0279; X19) | `/admin/coaches`, Setup card | `coaching_enabled, server_now, coaches[]: { coach_id, profile_id, full_name, phone, account_deleted, display_name_en, display_name_ar, bio_en, bio_ar, photo_path, status, public_accepted_at, sort_order, venue_ids[], lesson_type_ids[] (this branch), prices[]: { lesson_type_id, price_iqd }, hours[]: { weekday, start_time, end_time }, hours_set_by, hours_set_by_name, hours_updated_at, hours_elsewhere[]: { venue_id, venue_name_en, venue_name_ar, weekday, start_time, end_time }, time_off[]: { id, starts_at, ends_at, reason, set_by, set_by_name }, upcoming_lessons, open_courses }`, `lesson_types[]: { lesson_type_id, kind, name_en, name_ar, description_en, description_ar, duration_min, price_iqd, court_share_iqd, max_places, min_places, cutoff_hours, sessions_count, is_active, launched_at, sort_order, coach_ids[], pending_run: { run_id, change } \| null }` |
| `coaching_settings(p_venue_id)` (DB, 0274; X20, R50, R56) | settings panel | `venue_id, coaching_enabled, lesson_payment_mode, coach_share_bp, lesson_prices_public, coach_max_open_private, online_payments_available` (a Qi provider is configured), `lesson_terms_ready` (`platform_settings.lesson_terms_version` is set) |
| `coach_slots(p_coach_id, p_lesson_type_id, p_from, p_to)` (DB, 0280; public; X3, R51) | new private lesson | `{ off, venue_id, lesson_type_id, duration_min, bookable, starts: [{ start_at, end_at }] }`; one local day per call; a staff caller at the type's branch is answered whether coaching is on or off; a paused coach answers `bookable: false, starts: []` |
| `lesson_refunds_due(p_venue_id)` (Money, 0278; X21) | Ops panel, lesson screen | `{ venue_id, total_iqd, items: [{ enrolment_id, lesson_id, course_id, kind, coach_id, coach_name_en, coach_name_ar, start_at, label, phone, cancel_kind, refund_due_iqd, refund_due_desk_iqd, online_blocked_iqd, payments: [{ payment_id, tab_id, method, amount_iqd, refunded_iqd, refundable_iqd, created_at }] }] }`, oldest lesson first; `label` per R44; includes course-leave refunds (R62) |
| `report_coach_statements(p_month)` (Money, 0284; X22) | `/reports/coaches`, Financial card | `month, current_month, server_now, statements[]: { statement_id, coach_id, coach_name_en, coach_name_ar, venue_id, venue_name_en, venue_name_ar, status, lessons_count, collected_iqd, court_share_iqd, coach_iqd, adjustments_iqd, total_iqd, payable_iqd (= total_iqd), drafted_at, refreshed_at, approved_at, approved_by_name, paid_at, paid_by_name, paid_reference, voided_at, void_reason }, missing[]: { coach_id, coach_name_en, coach_name_ar, venue_id, reason: 'older_draft' \| 'not_drafted' }, totals: { statements, collected_iqd, court_share_iqd, coach_iqd, adjustments_iqd, total_iqd, approved_unpaid_iqd, unpaid_iqd, paid_iqd }` |
| `coach_statement_detail(p_statement_id)` (Money, 0284; X23, R24, R56) | statement dialog | `statement` (as a list row), `stale`, `lines[]: { line_id, lesson_id, start_at, kind, type_name_en, type_name_ar, course_id, course_title_en, course_title_ar, session_no, lesson_status, is_adjustment, collected_iqd, court_share_iqd, share_bp, coach_iqd, enrolments, attended, no_shows }` (every line carries its lesson), `coach_booked_no_shows[]: { lesson_id, start_at, type_name_en, type_name_ar }`, `can: { refresh, approve, void, mark_paid }` (all false on the caller's own statement, CM-11) |
| `report_lessons(p_from, p_to)` (Money, 0285; X24) | Courts report, Lessons view | `totals: { lessons, private, group, courseSessions, cancelled, underFilled, expired, enrolments, places, placesTaken, fillRatePct, attended, noShows, lateCancels, collectedIqd, courtShareIqd, coachShareIqd, venueShareIqd, deskIqd, onlineIqd, refundsIqd, lessonRevenueIqd, sandboxExcluded }`, `byCoach[]: { coachId, coachNameEn, coachNameAr, lessons, enrolments, collectedIqd, coachShareIqd }`, `byType[]: { lessonTypeId, nameEn, nameAr, kind, lessons, enrolments, collectedIqd }`, `byDay[]: { date, lessons, collectedIqd, coachShareIqd }`, `columns` |
| `report_courts` `lessons` block (Money, 0285; X25) | Courts report | `{ lessons, private, group, courseSessions, lessonMinutes, enrolments, attended, noShows, cancelled, underFilled, collectedIqd, courtShareIqd, coachShareIqd }`; per-court rows gain `lessons`, `lessonMinutes`, and occupancy counts lesson minutes |
| `report_revenue` (Money, 0285; X26) | Revenue report | rows and totals gain `lessonIqd` (C-18 `lessonRevenue`, inside `totalIqd`, outside `padelIqd`) and `owedToCoachesIqd` (accrual) |
| `panel_headline` (Money, 0285) | Management panel, Financial home | keys `lessonRevenue`, `owedToCoaches` |
| `day_close_online` (Money, 0285; X27) | day close | `lessons: { desk_paid_iqd, desk_paid_count, desk_refunded_iqd, online_received_iqd, online_received_count, online_refunded_iqd, online_refunded_count, online_refunds_waiting_iqd, online_refunds_waiting_count, kept_iqd, kept_count, refunds_due_desk_iqd, refunds_due_desk_count, lessons, owed_iqd, owed_count, owed_to_coaches_iqd }`, and the day's `refunds_dated_by_shift` (§5.18.1) |
| `deposit_attention` (Money, 0281) | Ops online refunds | items with `purpose 'lesson'` carry `lesson_id, enrolment_id, customer_id` |
| `price_promo_targets(p_change)` (DB, 0282; X28) | `/protocols` start and steps | `lesson_price`, `lesson_launch` → `lesson_types[]: { lesson_type_id, kind, name_en, name_ar, duration_min, sessions_count, price_iqd, court_share_iqd, is_active }`; `coach_price` → `coaches[]: { coach_id, display_name_en, display_name_ar, lesson_types[]: { lesson_type_id, name_en, name_ar, kind, sessions_count, type_price_iqd, coach_price_iqd } }` |
| `price_promo_numbers(p_run_id)` (DB, 0282; X28) | numbers step | `lesson: { lesson_type_id, coach_id, kind, name_en, name_ar, current_price_iqd, new_price_iqd, current_court_share_iqd, new_court_share_iqd, places_30d, owed_30d_iqd }` |

## 5.7 Writes this lane calls

Refusals are the X31 vocabulary (R52): only codes a server raises, each detail with its own line
(§5.19). Result keys follow X13 and X29 (the server returns this lane's keys).

| RPC | Sent from | Args the operator sends | Result keys read | Refusals handled in place |
| --- | --- | --- | --- | --- |
| `desk_book_lesson` | New lesson, private | §1.7 args; `p_customer_id` or `p_name` + `p_phone`; `p_party_size`; key | `lesson_id, enrolment_id, court_id, court_name_en, court_name_ar, price_iqd` → `/desk/lessons/$id` | `COACH_UNAVAILABLE`, `COACH_BUSY`, `NO_COURT_FREE`, `SLOT_NOT_ON_GRID`, `SLOT_IN_PAST`, `CLOSED_DATE`, `OUTSIDE_HOURS`, `PARTY_TOO_LARGE`, `LESSON_TYPE_NOT_FOUND`, `LESSON_TYPE_NOT_OFFERED`, `LESSON_TYPE_INACTIVE`, `COACH_NOT_FOUND`, `COACH_INACTIVE`, `COACH_NOT_AT_BRANCH`, `VENUE_MISMATCH`, `CUSTOMER_NOT_FOUND`, `ALREADY_ENROLLED` `coach` (each re-reads the slots). Never `COACHING_OFF` or `BEYOND_HORIZON` (the desk stages and has no horizon) |
| `desk_create_group` | New lesson, group | §1.7 args; key | `lesson_id, cutoff_at` → `/desk/lessons/$id` | as above, less the party, customer and coach-enrolled codes; `LESSON_CLOSED` `cutoff` (R47) |
| `desk_create_course` | New lesson, course | `p_starts` (every session, ascending), `p_title_en`, `p_title_ar` ('' when blank); key | `course_id, lesson_ids[]` (and `sessions[]`, X13) → first session's screen | `COURSE_STARTS_INVALID` `count` / `order` / `span`; per start `SLOT_NOT_ON_GRID`, `SLOT_IN_PAST`, `CLOSED_DATE`, `OUTSIDE_HOURS`, `COACH_UNAVAILABLE`, `COACH_BUSY`, `NO_COURT_FREE` with detail the session number; `LESSON_CLOSED` `cutoff` (session 1, R47) |
| `desk_add_student` | Add student | `p_lesson_id` (group) or `p_course_id` (course), `p_customer_id` or `p_name` + `p_phone`; key | `enrolment_id, places_left` | `LESSON_FULL`, `LESSON_CLOSED` (a group session over; a course from its last start, R39), `ALREADY_ENROLLED` (and `coach`), `CUSTOMER_NOT_FOUND`, `LESSON_NOT_FOUND`, `VENUE_MISMATCH` (field errors in the dialog) |
| `desk_cancel_enrolment` | roster row | `p_enrolment_id`, `p_reason` (`<code>` or `<code>: <note>`) | `status, refund_due_iqd, online_refund` | `ENROLMENT_NOT_FOUND` (refetch), `LESSON_NOT_CANCELLABLE` `status` / `ended` |
| `desk_cancel_lesson` | lesson header | `p_lesson_id`, `p_reason` | `status` | `LESSON_NOT_CANCELLABLE` `course_session` / `status` / `started` |
| `desk_cancel_course` | lesson header (course) | `p_course_id`, `p_reason` | `status, sessions_cancelled` | `LESSON_NOT_CANCELLABLE` `status` / `ended` |
| `desk_reschedule_session` | Reschedule dialog (every kind, R8) | `p_lesson_id`, `p_start_at` | `start_at, end_at, court_name_en, court_name_ar` | `SESSION_NOT_MOVABLE` `ended` / `started` / `order`, `INVALID_TRANSITION` `held` (R32), `LESSON_CLOSED` `cutoff` (R47), `SLOT_NOT_ON_GRID`, `SLOT_IN_PAST`, `CLOSED_DATE`, `OUTSIDE_HOURS`, `COACH_UNAVAILABLE`, `COACH_BUSY`, `NO_COURT_FREE` |
| `desk_move_lesson_court` | Move court dialog (the only court move for a lesson, R7) | `p_lesson_id`, `p_court_id` | — (refetch) | `NO_COURT_FREE`, `INVALID_TRANSITION` `held` / `ended`, `COURT_NOT_FOUND` |
| `desk_mark_attendance` | roster row | `p_lesson_id`, `p_enrolment_id`, `p_status` ∈ `attended`, `no_show`, `clear` | `status` | `INVALID_TRANSITION` `not_started` / `marks_closed` / `not_booked` / `cancelled`, `ENROLMENT_NOT_FOUND` |
| `lesson_settle` | Take payment pane | `p_enrolment_id`, `p_method`, `p_expected_owed_iqd` (= `take_iqd`), `p_tendered_iqd` (cash), key, `p_device_id` | `duplicate, payment_id, amount_iqd, change_iqd` | `LESSON_OWED_CHANGED`, `LESSON_NOT_PAYABLE` `held` / `expired` / `cancelled` / `lesson_cancelled` / `no_show` / `nothing_owed`, `NO_OPEN_DAY`, `TENDER_SHORT`, `TENDER_CARD`, `TOTAL_CHANGED`, the till-shift stamp's refusals |
| `set_coaching_settings` | settings panel | `p_venue_id = currentBranchId()`, `p_patch` (changed keys only) | the settings | `INVALID_ARGUMENT` (detail = key → field), `ONLINE_PAYMENT_OFF` `provider` / `terms` (on the payment-mode field; X20, R50) |
| `coach_promote` | Make a coach | all §1.7 args; `p_venue_ids` default `[currentBranchId()]` | `coach_id` | `ALREADY_COACH` (link to the coach), `CUSTOMER_NOT_FOUND`, `INVALID_ARGUMENT` |
| `coach_update` | coach editor | `p_coach_id`, `p_patch` ⊆ `display_name_en, display_name_ar, bio_en, bio_ar, photo_path, sort_order` | the coach | `COACH_NOT_FOUND`, `INVALID_ARGUMENT` |
| `set_coach_status` | coach editor | `p_coach_id`, `p_status` ∈ `active, paused, retired`, `p_reason` (note, 1..200; optional for pause and resume) | `status, lessons_cancelled` | `INVALID_ARGUMENT`. Retiring is never refused (R45) |
| `set_coach_branches` | coach editor | `p_coach_id`, `p_venue_ids` | `venue_ids` | `BRANCH_HAS_BOOKINGS` (detail: the removed branch with lessons to come, R52), `INVALID_ARGUMENT`, `FORBIDDEN` |
| `set_coach_lesson_types` | coach editor, Make a coach | `p_coach_id`, `p_venue_id = currentBranchId()`, `p_lesson_type_ids` | `lesson_type_ids` | `LESSON_TYPE_NOT_FOUND`, `COACH_NOT_AT_BRANCH`. Unlinking a type deletes the coach's own price for it (R46) |
| `upsert_lesson_type` | lesson type editor | `p_venue_id`, `p_id` (null for new), `p_patch` (changed keys only) | the type | `PRICE_VIA_PROTOCOL` `price` / `shape`, `LAUNCH_VIA_PROTOCOL` (each turns into its way out, §5.13.2), `INVALID_ARGUMENT` (detail = key → field) |
| `set_coach_price` | coach editor (owner) | `p_coach_id`, `p_lesson_type_id`, `p_price_iqd` (NULL removes) | — | `INVALID_ARGUMENT`, `LESSON_TYPE_NOT_OFFERED` |
| `set_coach_hours` | Hours tab | `p_coach_id`, `p_venue_id`, `p_windows` `[{ weekday, start, end }]` | `hours` | `HOURS_INVALID`, `HOURS_OVERLAP` (detail: the window index, or `"<index>:<weekday>"`; the operator finds the weekday from the windows it sent), `COACH_NOT_AT_BRANCH` |
| `add_coach_time_off` | Hours tab | `p_coach_id`, `p_starts_at`, `p_ends_at`, `p_reason` | `id` | `TIME_OFF_HAS_LESSONS` (detail = count), `HOURS_OVERLAP` `time_off`, `INVALID_ARGUMENT` |
| `cancel_coach_time_off` | Hours tab | `p_id` | — | `INVALID_ARGUMENT` `p_id` (refetch) |
| `coach_statement_refresh` | statement dialog (Recount on a draft, Redraft on a void) | `p_statement_id` | `statement_id, status, created` | `STATEMENT_NOT_DRAFT` (and `live_draft`), `FORBIDDEN` `own_statement` |
| `coach_statement_approve` | statement dialog | `p_statement_id` | `statement_id, status` | `STATEMENT_NOT_DRAFT`, `FORBIDDEN` `own_statement` |
| `coach_statement_void` | Void dialog | `p_statement_id`, `p_reason` (1..200); from `approved` also `p_pin`, `p_device_id` (R59) | the statement | `REASON_REQUIRED`, `INVALID_TRANSITION` `paid`, `INVALID_ARGUMENT` `p_reason` (a run of 12 or more digits, R49), `PIN_INVALID`, `PIN_LOCKED`, `PIN_GRANT_REQUIRED`, `FORBIDDEN` `own_statement` |
| `coach_statement_mark_paid` | Mark paid dialog | `p_statement_id`, `p_reference` (1..80), `p_pin`, `p_device_id` (R4) | `status, paid_at, total_iqd` | `STATEMENT_NOT_APPROVED` (and `negative`, R59), `STATEMENT_REFERENCE_REQUIRED`, `INVALID_ARGUMENT` `p_reference` (R49), `PIN_INVALID`, `PIN_LOCKED`, `PIN_GRANT_REQUIRED`, `FORBIDDEN` `own_statement` |

Existing writes that meet coaching refusals: `close_branch` (Setup › Branches) `BRANCH_HAS_BOOKINGS`
with no detail (live lessons, 0277) or detail `coaching_money` (R37); the till's queued
`payment.refund` `REFUND_EXCEEDS_DUE` (R36); `deposit_refund_request` (Ops) `PAYMENT_STATE`
`lesson_live`; `cancel_reservation`, `mark_reservation`, `extend_reservation`, `move_reservation`,
`confirm_booking`, `staff_create_reservation` and `open_tab` `LESSON_VIA_COACHING` with their
details (a stale screen or a replayed queue).

Every other refusal renders beside its control (`ErrorText`) or as a refusal presenter through
`errorToMessageKey`, with the detail lines of §5.19 (`coachingErrorKey`). A rule refusal never
reverts silently.

**Reason form (as OM §5.13.8, binding on DB).** `desk_cancel_enrolment`, `desk_cancel_lesson` and
`desk_cancel_course` take `p_reason` as `<code>` or `<code>: <note>` with the §1.3 desk cancel codes;
the server validates the code before the first `': '`, stores the code on the row and event, keeps
the whole text in the audit row, and caps the note at 200 characters.

## 5.8 Desk calendar, the lesson tile, and every kind check

`ReservationKind` (`op/features/desk/deskTypes.ts:7`) becomes `'booking' | 'hold' | 'maintenance' |
'lesson'` (R13), and `ReservationRow` gains `lesson_id?: string | null` (present only where a screen
selects `*`, as `BookingDetail` does; absent on every list). The row of a lesson has
`guest_id` null and `guest_name` exactly `'Lesson'`; `LESSON_RESERVATION_NAME = 'Lesson'` in
`op/features/coaching/lessonLogic.ts` must equal the DB literal byte for byte.

**Tone.** The kit's `Tone` (`op/components/kit.tsx:404`) does not grow. `op/features/desk/deskStatus.tsx`
gains `BlockTone = Tone | 'lesson'`, the maps `BLOCK_SOFT`, `BLOCK_FG`, `BLOCK_EDGE`
(`TONE_SOFT`/`TONE_FG`/`TONE_EDGE` plus `lesson`), and `reservationBlockTone(r)` (`'lesson'` for a
lesson row, else `reservationTone(r)`). `lesson` paints `background: var(--tp-lesson-soft)`,
`color: var(--tp-lesson)`, `border: 1px solid var(--tp-lesson)`.

**Tokens** (§1.11 names; `packages/ui/src/tokens/operator.ts` beside the status families at
`:96-116`, and `operatorBlue.ts`):

| Token | Paper | Blue mode | Job |
| --- | --- | --- | --- |
| `--tp-lesson` | `oklch(46% 0.15 318)` | `#E8C0F4` | ink on the soft ground, edge, icon, dot |
| `--tp-lesson-soft` | `oklch(95% 0.035 318)` | `#4B2F63` | the tinted ground of a tile, badge or row |

Hue 318 (a violet) stays clear of the accent blue (260), Padel Green (128), warn (65–85) and danger
(27). Because `--tp-lesson` is both ink and mark, it must measure ≥ 4.5:1 on `--tp-lesson-soft` and ≥
3:1 on `--tp-surface` and `--tp-bg` in both modes; the builder computes the four ratios, adjusts the
lightness if one misses, and writes them into each file's header comment as the other families do
(`operatorBlue.ts:21-29`). No other token is added.

**Badge.** `op/features/coaching/LessonBadge.tsx`: `StatusBadge` (`kit.tsx:415`) with `icon="whistle"`
and `style={{ background: 'var(--tp-lesson-soft)', color: 'var(--tp-lesson)' }}`, label by kind
("Private lesson" / "حصة خاصة", "Group session" / "حصة جماعية", "Course" / "دورة"), or "Awaiting
payment" / "بانتظار الدفع" for a held lesson. `ReservationBadge` (`deskStatus.tsx:87-92`) renders it
for `kind 'lesson'`.

**The tile** (`DeskCalendar.tsx:1153-1279`), for `r.kind === 'lesson'`, with `lesson =
lessonsByReservation.get(r.id)` from `useDeskLessons(dayStart, dayEnd)`:
- ground, ink and edge from `reservationBlockTone(r)` in place of `reservationTone` (`:1159`,
  `:1206-1208`); a solid edge;
- name (`:1161-1167`): `lessonLabel(lesson, locale, tr)`: private "{coach} · {booker}" ("Coach Sara ·
  Ali Hasan", the booker's name per R44), group "{coach} · {type}", course "{coach} · {title, else
  type} · Session 2" / "… · الحصة 2"; with no lesson row (offline, or the read failed) "Lesson" /
  "حصة";
- after the name, `LessonPlacesChip` for a group session or course: `isolateLtr('4/6')`, drawn in the
  tile's own ink (`border: 1px solid currentColor`, transparent ground, `users` icon 12 px; the
  `SeatChip` treatment, no token), `aria-label` "Group session · 4 of 6 places" / "حصة جماعية · 4 من
  6 أماكن"; a private lesson with a party shows `isolateLtr('+2')`;
- the third line is `LessonBadge`; after the start, a lesson with `owing > 0` adds a warn
  `StatusBadge` "To pay 2" / "للدفع 2"; a private lesson with `booked_by_kind 'coach'` and
  `owing > 0` shows, from the moment it is booked, the warn flag "Booked by the coach · unpaid" /
  "حجزها المدرّب · غير مدفوعة" (C-24, `lessonPayState`);
- never draggable: `canMoveReservation` already refuses any kind but `booking` (`deskLogic.ts:66-73`),
  so the grip never shows; a court change goes through **Move court** (§5.10.9), the only path
  (R7: `move_reservation` refuses a lesson row);
- e2e finds blocks by accessible name (`DeskCalendar.tsx:44-48`); a lesson tile's name holds the
  coach's display name once `desk_lessons` has loaded.

`useDeskLessons(dayStart, dayEnd, enabled)` in `useCoaching.ts` reads `desk_lessons` with
`QK.coaching.desk`; `lessonsByReservation(envelope)` is pure (`lessonLogic.ts`).

**Every place that checks a reservation's kind**, and what it does with `'lesson'`:

| Site | Today | With `'lesson'` |
| --- | --- | --- |
| `deskStatus.tsx:63-64` `reservationTone` | maintenance neutral, hold info, else by status | unchanged (a lesson falls to the status branch); blocks use `reservationBlockTone` |
| `deskStatus.tsx:80` `availabilityTone` | maintenance neutral, else accent | unchanged |
| `deskStatus.tsx:89-90` `ReservationBadge` | booking indicator, else kind badge; unknown kind read as booking (`:90`) | `kind 'lesson'` → `LessonBadge` before the fallback |
| `deskStatus.tsx:101` `ChargeCell` | null for non-booking | unchanged; lesson rows use `LessonPayCell` (§5.11) |
| `DeskCalendar.tsx:668` `dayCount` | bookings only | unchanged; the day header adds "Lessons 3" / "الحصص 3" from the envelope when > 0 |
| `DeskCalendar.tsx:1163-1168` name and match state | maintenance, hold, else booking label | lesson branch: `lessonLabel`; a `hold` row whose id is a held lesson's `reservation_id` also draws as that lesson |
| `DeskCalendar.tsx:1208` edge style | dashed for maintenance | solid; colours from `BLOCK_*` |
| `TodaysBoard.tsx:293-300` `guestLabel`, `isMatchRow` | maintenance, hold, booking | `guestLabel` returns `lessonLabel` for a lesson; `isMatchRow` unchanged (booking only) |
| `TodaysBoard.tsx:343` next booking | booking only | unchanged |
| `TodaysBoard.tsx:615` busy line | "Blocked" or "Busy until" | lesson: "Lesson until {time}" / "حصة حتى {time}" |
| `TodaysBoard.tsx:648` busy dot | maintenance mark, else accent | lesson: `var(--tp-lesson)` |
| `TodaysBoard.tsx:657` name under a busy tile | booking only | lesson: `lessonLabel` |
| `TodaysBoard.tsx:762` Mark arrived | confirmed bookings | lesson rows: **Open lesson** / **فتح الحصة** instead |
| `TodaysBoard.tsx:806` bill-state ids | bookings only | unchanged (lesson money comes from `desk_lessons`) |
| `BookingDetail.tsx:108` match literal | booking only | unchanged |
| `BookingDetail.tsx:243-244` title from `kindLabel.<kind>` | — | adds `ws.courtDesk.detail.kindLabel.lesson` "Lesson" / "حصة" (the template key now includes `lesson`) |
| `BookingDetail.tsx:265,285,326,374,383` eyebrow, Charge on till, details, bill, actions | booking only | unchanged (a lesson gets none of them) |
| `BookingDetail.tsx:461` cancel on a non-booking | maintenance and hold | narrowed to `maintenance` and `hold`; a lesson row gets the redirect below |
| `ReservationActionsDialog.tsx:77` `canPay` | booking only | unchanged |
| `ReservationActionsDialog.tsx:140,142` title, match | maintenance, hold, else booking | lesson branch, below |
| `CourtBillPanel.tsx:101` | null for non-booking | unchanged |
| `deskLogic.ts:41` `isVisible` | expired holds hidden | unchanged |
| `deskLogic.ts:70` `canMoveReservation` | booking only | unchanged: lessons never drag |
| `deskLogic.ts:128-144` `CourtAvailability.kind` | `'booking' \| 'hold' \| 'maintenance'` | typed `ReservationKind` |
| `deskLogic.ts:169` `arrivalsDue` | confirmed bookings | unchanged: a lesson's arrivals are per student, on its screen |
| `deskLogic.ts:189` `nightSummary` | bookings only | `NightSummary` gains `lessons` (live lesson rows); the board's subtitle adds "Lessons N" when > 0 |
| `CourtBlock.tsx:373` conflict kind label | booking, hold, maintenance, else raw | adds `lesson` → `ws.events.block.conflictKind.lesson` "Lesson" / "حصة"; its "Open booking" (`:455`) stays booking-only, and a lesson conflict links `/desk/bookings/$id`, which forwards (below) |
| `calendar/monthFetchers.ts:19` month counts | `.eq('kind', 'booking')` | unchanged: the month view counts bookings, as its label says |
| `observation/courts/CourtsObserve.tsx:301` in play | booking | lesson counts as in play |
| `CourtsObserve.tsx:330-340` now tile | booking success, hold info, else neutral | lesson: `LessonBadge` tone, "In a lesson" / "في حصة", who = `lessonLabel` |
| `CourtsObserve.tsx:412-420` legend | seven keys | adds `lesson` with the lesson swatch |
| `CourtsObserve.tsx:529-531` block tone and name | — | `reservationBlockTone`, `lessonLabel` |
| `CourtsObserve.tsx:549,572,608` edge, 3-line extras, peek tabs read | booking only | unchanged |
| `CourtsObserve.tsx:616-655` peek | maintenance, hold, booking | lesson: eyebrow "Lesson", title `lessonLabel`, places and pay lines, **Open lesson** (`/desk/lessons/$id`) |
| `observation/observeLogic.ts:42` `courtDaySummary` | non-booking counted as blocks | `CourtDaySummary` gains `lessons`; a lesson is no longer a block |
| `observeLogic.ts:69` `didNotHappen` | bookings | unchanged |
| `floor/floorData.ts:48` Floor now courts | `.eq('kind', 'booking')` | `.not('kind', 'in', '(hold,maintenance)')` (valid without the enum value), `kind` added to the select; a lesson row reads "Lesson" through `reservationNameOf` |
| `matches/matchLogic.ts:694` `isFirm` | every live row but a hold | unchanged: a lesson is firm, as 0277 counts it |
| `matchLogic.ts:710` `matchesBumpedBy` draft kinds | booking, maintenance | unchanged; lessons are not warned (known limit) |
| `matchLogic.ts:73-83` `reservationNameOf` | match literal | also `LESSON_RESERVATION_NAME` → "Lesson" / "حصة" |
| `desk/payment/deskPaymentLogic.ts:365,382` `toSettle`, `unsettledBefore` | bookings | unchanged |
| `till/SpotDialog.tsx:67` | the spot target's kind (`'booking' \| 'table'`), not a reservation kind | unchanged; the till's court board (`till/FloorView.tsx:58-80`) adds `kind` to its select and drops lesson rows, so no lesson is offered to open a tab on (`open_tab` refuses `LESSON_VIA_COACHING`) |
| `till/NewTabDialog.tsx:40-62` `tillMayBill` | no live tab, not a match | selects `kind` too and refuses `kind 'lesson'` |

**`ReservationActionsDialog`, lesson branch.** A new prop `lesson?: DeskLesson | null` (the
calendar's row). For `r.kind === 'lesson'`, or a `hold` row that is a held lesson's, the dialog
renders `LessonSummary` and nothing else: title `lessonLabel`, `titleAfter` `LessonBadge` and the
places chip, subtitle court and times, then "Places 4 of 6" / "الأماكن 4 من 6", "To pay 2 · 60,000" /
"للدفع 2 · 60,000", the C-24 flag and, before the cut-off with too few, the cut-off line (§5.10.2).
Footer: Close and **Open lesson** (primary). No Arrived, Completed, No-show, Move, Extend, Shorten,
Confirm or Cancel: each would be refused `LESSON_VIA_COACHING` (R7, R35).

**`BookingDetail`, lesson row.** When the reservation read (`select('*')`, `BookingDetail.tsx:96-103`)
returns `kind 'lesson'` (or a `hold`) with `lesson_id`, the screen replaces itself with
`navigate({ to: '/desk/lessons/$id', params: { id: lesson_id }, replace: true })`. Without
`lesson_id` (an older server) a lesson row shows the info presenter "This court is held for a lesson.
Lessons are changed from their own screen." / "هذا الملعب محجوز لحصة، وتُعدَّل الحصة من صفحتها." and
no actions.

## 5.9 New lesson: the booking dialog's Lesson kind and `StartLessonDialog`

**Lesson kind** (`CreateReservationDialog.tsx`). `CreateKind` (`:60`) gains `'lesson'`; a new optional
prop `onStartLesson?: (carry: StartLessonCarry) => void` (the `onStartMatch` pattern, `:109`,
`:296-307`). The segment shows **Lesson** / **حصة** when the caller passes the callback, i.e. when
`runLessons` and the night's `desk_lessons` answered (coaching on or off: the desk stages, R51);
offline it is disabled with the §5.5 reason. Choosing it closes this dialog and opens
`StartLessonDialog` with the pressed court, start, picked customer and typed name and phone. The
queued `reservation.create` path and the e2e selectors are untouched. Callers: `DeskCalendar.tsx:1361`
and `TodaysBoard.tsx:950`, mounting the dialog beside `StartMatchDialog` (`DeskCalendar.tsx:1388`,
`TodaysBoard.tsx:969`).

**Book-for strip, `kind=lesson`.** `/desk?customer=<id>&kind=lesson` (the record's **Book a lesson**)
reads "Booking a lesson for {name}: pick a free time" / "حجز حصة باسم {name}: يُرجى اختيار وقت
متاح"; a free slot opens `StartLessonDialog` directly with the court, time and customer
(`DeskCalendar.tsx:271` gains `lessonMode` beside `matchMode`).

**`StartLessonDialog`** (`op/features/coaching/StartLessonDialog.tsx`), opened from the booking
dialog, the calendar in `kind=lesson` mode, the Today group's **New lesson** and the record. Pure
rules in `startLessonLogic.ts`. Title "New lesson" / "حصة جديدة". With coaching off at the branch
it shows the §5.5 staging line above the fields.

| Field | Values | Rule and copy |
| --- | --- | --- |
| Kind | Private lesson · Group session · Course (`SegmentedControl`) | only the kinds with a lesson type on sale in the envelope |
| Lesson type | the envelope's `lesson_types` of that kind | each option "Private 60 min · 30,000" / "خاصة 60 دقيقة · 30,000" (the type price; the coach's own price replaces it once a coach is picked) |
| Coach | the envelope's coaches whose `lesson_type_ids` include the type | a paused coach is listed disabled: "Paused: not taking lessons" / "موقوف مؤقتًا ولا يستقبل حصصًا" |
| Date and start, private | the pressed date; starts from `coach_slots` (`starts[].start_at`) for that coach, type and local day, as chips | the pressed time is pre-selected when it is a slot; otherwise "{coach} isn't free at {time}. Pick one of these times." / "{coach} غير متاح في {time}. يُرجى اختيار أحد هذه الأوقات."; no slots: "No free time for {coach} that day." / "لا وقت متاحًا لـ{coach} في ذلك اليوم." |
| Date and start, group | the pressed date and time; a 30-minute grid Select | the server checks the coach and a court (`COACH_UNAVAILABLE`, `NO_COURT_FREE`); `cutoffPassed(start, cutoff_hours, server_now)` mirrors R47: "That start is too close: its cut-off ({time}) has already passed. Pick a later time." / "هذا الموعد قريب جدًا: فات موعد إغلاقه ({time}). يُرجى اختيار موعد لاحق." |
| Starts, course | first date and time, then the generated list | `weeklyStarts(firstDate, time, sessions_count, tz)`: the same local time each week (`wallTimeToUtc`); each row "Session 3 · Sun 19 Oct · 18:00" / "الحصة 3 · الأحد 19 أكتوبر · 18:00" with its own date and time to change one; `startsErrors` mirrors `COURSE_STARTS_INVALID` (`count`, `order`, `span`) and the per-start checks (on the grid, not in the past); session 1 also takes the cut-off check |
| Course title | EN and AR (`BilingualFields`, 0..80, optional) | "Shown to guests instead of the lesson type's name." / "يظهر للزبائن بدل اسم نوع الحصة." |
| Student, private | `CustomerPicker` with the typed-query mirror (`nameFromQuery`/`phoneFromQuery`, `deskLogic.ts:326,332`), or typed name and phone | one of the two (`GUEST_REQUIRED` mirror); party size 1..`max_places` ("Coming with 0–3" / "يرافقه 0–3") |
| Price line | the server's price for the coach and type | private: "{price} for the lesson, paid at the desk." / "{price} للحصة، تُدفع في الاستقبال."; group: "{price} a place. Each student pays their own." / "{price} للمكان الواحد، ويدفع كل متدرّب عن نفسه."; course: "{price} a person for {sessions}." / "{price} للشخص عن {sessions}." |
| Court line | — | private and group: "The court is picked automatically from the free courts." / "يُختار الملعب تلقائيًا من الملاعب المتاحة."; course: "A court is taken for every session now." / "يُحجز ملعب لكل حصة الآن." |

**Create** / **إنشاء الحصة** calls `desk_book_lesson`, `desk_create_group` or `desk_create_course` and
navigates to `/desk/lessons/$id` (for a course, its first session). Toasts: "Lesson booked on
{court}." / "حُجزت الحصة على {court}."; when the court differs from the pressed one: "Booked on
{court}: {pressed} wasn't free with the coach's hours. Move it from the lesson if needed." / "حُجزت
على {court}، إذ لم يكن {pressed} متاحًا ضمن ساعات المدرّب. يمكن نقلها من صفحة الحصة عند الحاجة.";
group "Group session created. Add students or share it in the app." / "أُنشئت الحصة الجماعية. يمكن
إضافة متدرّبين أو مشاركتها عبر التطبيق."; course "Course created: {sessions} booked." / "أُنشئت
الدورة وحُجزت {sessions}.". A refusal with a session number in its detail marks that row of the
course list.

## 5.10 Lesson screen (`/desk/lessons/$id`, `op/features/coaching/LessonDetail.tsx`)

For every status. Reads `desk_lesson_detail` (`QK.coaching.lesson(id)`) and, for a manager,
`lesson_refunds_due` filtered to this lesson or course; Move court reads the lesson's night through
`useTradingNight` for the free courts.

### 5.10.1 Header

| Part | Content |
| --- | --- |
| Eyebrow | "Private lesson" / "حصة خاصة", "Group session" / "حصة جماعية", "Course · Session 3 of 8" / "دورة · الحصة 3 من 8" |
| Title | "{type or course title} · {coach}" |
| Subtitle | court, weekday and date, time range, `LessonBadge`, the status badge (§5.10.2); group and course "Places 4 of 6" / "الأماكن 4 من 6"; the C-24 flag for a coach-booked private lesson still unpaid |
| Actions | **See on calendar** / **عرض في التقويم**; **Move court** / **نقل الملعب** (`can.move_court`); **Reschedule** / **تغيير الموعد** (`can.reschedule`, every kind); **Cancel lesson** / **إلغاء الحصة** (`can.cancel`; on a course session **Cancel the course** / **إلغاء الدورة**, `can.cancel_course`). A held lesson shows Reschedule and Move court disabled: "Waiting for the guest's online payment: it can be moved once paid." / "بانتظار دفع الزبون الإلكتروني، ويمكن نقلها بعد الدفع." |
| Not found | `LESSON_NOT_FOUND`: `EmptyState` "That lesson isn't at this branch." / "هذه الحصة ليست في هذا الفرع." with Back to Today |

### 5.10.2 Banner (`lessonBannerKey(lesson)`)

| Status / reason | EN | AR |
| --- | --- | --- |
| `held` | "Awaiting the guest's online payment until {time}. If it doesn't arrive, the lesson is cancelled." | "بانتظار دفع الزبون الإلكتروني حتى {time}، وإن لم يصل تُلغى الحصة." |
| `scheduled`, under the minimum before the cut-off | "Needs {students} more by {time}, or it is cancelled and everyone is refunded." | "تحتاج إلى {students} آخرين قبل {time}، وإلا أُلغيت وأُعيدت المبالغ للجميع." |
| `scheduled` | "Booked on {court}" | "محجوزة على {court}" |
| `completed` | "Done" | "انتهت" |
| `cancelled` / `guest_cancel` | "Cancelled by the guest." | "ألغاها الزبون." |
| `cancelled` / `coach_cancel` | "Cancelled by the coach. Everyone was told and online money refunded." | "ألغاها المدرّب، وأُبلغ الجميع وأُعيدت المبالغ الإلكترونية." |
| `cancelled` / `staff_cancel` | "Cancelled at the desk. Everyone was told and online money refunded." | "أُلغيت من الاستقبال، وأُبلغ الجميع وأُعيدت المبالغ الإلكترونية." |
| `cancelled` / `under_filled` | "Cancelled at the cut-off: too few students. Everyone was refunded." | "أُلغيت عند موعد الإغلاق لقلة المتدرّبين، وأُعيدت المبالغ للجميع." |
| `cancelled` / `payment_expired` | "The guest's online payment didn't arrive in time." | "لم يصل دفع الزبون الإلكتروني في الوقت المحدد." |
| `cancelled` / `account_deleted` | "The guest deleted their account." | "حذف الزبون حسابه." |
| `cancelled` / `coach_retired` | "Cancelled because the coach was retired. Everyone was told and online money refunded." | "أُلغيت لإحالة المدرّب إلى التقاعد، وأُبلغ الجميع وأُعيدت المبالغ الإلكترونية." |
| `expired` | "Never confirmed." | "لم تُؤكَّد." |
| unknown | the raw status, neutral | — |

"Refunded" here names what the server does; desk money still waits on a manager (§5.10.10), and the
banner adds "Money paid at the desk is waiting for a refund: {amount}." / "مبلغ مدفوع في الاستقبال
بانتظار الرد: {amount}." when any enrolment has `refund_due_iqd > 0`.

### 5.10.3 Course strip

On a course session, a strip of the course's sessions, one chip each: "1 · Sun 12 Oct · 18:00" with
its status; the current one pressed; each a link to its own `/desk/lessons/$id`. A rescheduled
session reads its new time. Under it: "Sign-up closes when the last session starts ({time})." / "يُغلق
التسجيل عند بدء الحصة الأخيرة ({time})." It closes for the desk too (R39).

### 5.10.4 Roster (`op/features/coaching/LessonRosterPanel.tsx`)

One row per enrolment, booked first, then cancelled and expired under "Earlier" / "سابقًا":

- name: `full_name` (§5.6.2: the recorded name for a coach- or desk-booked row); a private booker
  with a party reads `{isolate(name)} {isolateLtr('+2')}` and, when given, the friends' names muted;
  a row with no `customer_id` carries "Walk-in" / "زبون عابر";
- phone `dir="ltr"`; `CustomerFlagBadge`s; **Open customer** / **فتح ملف الزبون** only when
  `customer_id` (never for an unconfirmed phone match, C-21);
- booked by: "Booked in the app" / "حُجز عبر التطبيق", "Added by the coach" / "أضافه المدرّب",
  "Added at the desk by {name}" / "أُضيف من الاستقبال بواسطة {name}";
- a course sign-up: "Course sign-up · sessions {from}–{to}" / "تسجيل في الدورة · الحصص {from}–{to}"
  and, for a late join, "Joined at session {from}" / "انضمّ من الحصة {from}";
- money line (`enrolmentLine(e)`, every figure the server's): "To pay {owed} at the desk" / "عليه
  {owed} يُدفع في الاستقبال", "Paid at the desk {paid}" / "دُفع في الاستقبال {paid}", "Paid online
  {paid}" / "دُفع إلكترونيًا {paid}", "Awaiting online payment" / "بانتظار الدفع الإلكتروني",
  "Refunded {amount}" / "أُعيد {amount}", "Kept: late cancel" / "محتجز: إلغاء متأخر" (a guest
  leaving a running course: "Kept: the next session was inside the cancellation window" / "محتجز:
  كانت الحصة التالية ضمن مهلة الإلغاء", C-23), "Refund due {amount}" / "مستحق الرد {amount}" (warn);
- attendance chip "Arrived" / "حضر", "No-show" / "لم يحضر", with who marked it;
- buttons per §5.10.5–§5.10.8, each from the row's `can` and the capability.

Footer: **Add student** / **إضافة متدرّب** (`can.add_student`, `runLessons`); "Places 4 of 6" and
"To pay 2 · 60,000" / "للدفع 2 · 60,000".

### 5.10.5 Take payment (`takeLessonPayment`, `enrolment.can.take_payment`)

Opens the till's `PaymentPane` (`op/features/till/PaymentPane.tsx:72`) with `due = money.take_iqd`,
`subtitle` "{name}'s lesson" / "حصة {name}" (course: "{name}'s course" / "دورة {name}"),
`allowPartial={false}` (the exact owed, §1.7). The shift gate works unchanged. Sends `lesson_settle`
(§5.7). On success: toast "Took {amount} for {name}." / "استُلم {amount} عن {name}." plus "Change
{change}" / "الباقي {change}" for cash; `invalidateLessonMoney(qc)`.

`LESSON_OWED_CHANGED`: refetch the detail, keep the pane open with the new due and "What this
student owes changed to {amount}. Check before taking it." / "تغيّر المستحق على هذا المتدرّب إلى
{amount}. يُرجى التحقق قبل الاستلام."; when the new due is 0 the pane closes: "Nothing left to take
for this student." / "لم يبقَ ما يُستلم عن هذا المتدرّب." (the `TOTAL_CHANGED` precedent,
`CourtBillPanel.tsx:214`). `LESSON_NOT_PAYABLE` closes the pane with its detail's line (§5.19;
`nothing_owed` reads as the line above).

### 5.10.6 Attendance (`runLessons`)

**Arrived** / **تسجيل الحضور** (`can.mark_attended`) and **No-show** / **تسجيل الغياب**
(`can.mark_no_show`), one click each, optimistic on `QK.coaching.lesson(id)` and rolled back on any
refusal (the `ReservationActionsDialog.tsx:103-113` pattern). Before the start No-show is disabled
(`not_started`): "A no-show can be marked once the lesson starts" / "لا يُسجَّل الغياب قبل بدء
الحصة"; after 24 h (`marks_closed`): "Too late to change: marks close 24 hours after the start." /
"فات الأوان: يُغلق التسجيل بعد 24 ساعة من البدء." **Undo** / **تراجع** (`can.unmark`) sends `clear`.
A private booker's mark covers the party. No strike line is shown (CD-2 is the server's).

### 5.10.7 Add student (`op/features/coaching/AddStudentDialog.tsx`)

`CustomerPicker` with the typed-query mirror, typed name and phone, and **Create customer** →
`/desk/customers/new?attach=lesson&lesson=<id>`; **Find in the directory** →
`/desk/customers?attach=lesson&lesson=<id>`. A course: "Joins from session {n}: pays for
{sessions}." / "ينضمّ من الحصة {n} ويدفع عن {sessions}." with the server's figures once the roster
refetches. The title of a course says "Add a student to the course" / "إضافة متدرّب إلى الدورة".
Success: "{name} is in." / "أُضيف {name}."; at the last place (`places_left` 0): "{name} is in. The
session is full." / "أُضيف {name}، واكتملت الحصة." Works with coaching off (§5.5).

### 5.10.8 Cancel enrolment, lesson, course

`ReasonCodePrompt` (`kit.tsx:1679`) with `reasonCodes={COACHING_CANCEL_CODES}` =
`['customer_request', 'coach_unavailable', 'court_needed', 'staff_error', 'duplicate', 'other']`
(§1.3) and the reason form of §5.7. `coach_unavailable` joins `ReasonCode` as the new
`COACHING_REASON_CODES` (`op/components/ui.tsx:861-883`; `REASON_CODES` does not grow; `court_needed`
is already in `MATCH_REASON_CODES`). Consequence lines by money state, from the server's figures:
- enrolment, desk-paid: "{amount} was paid at the desk. It becomes a refund a manager makes at the
  till." / "دُفع {amount} في الاستقبال، ويصبح مبلغًا يردّه مدير عند الصندوق.";
- enrolment, online: "The online payment goes back to the guest's card." / "يعود الدفع الإلكتروني
  إلى بطاقة الزبون.";
- course sign-up: "Money for the sessions not yet held goes back: online to the card, desk money as
  a refund due." / "يُرد المبلغ عن الحصص التي لم تُعقد بعد: الإلكتروني إلى البطاقة، والمدفوع في
  الاستقبال يصبح مستحق الرد.";
- enrolment, nothing paid: "Nothing was paid, so nothing is refunded." / "لم يُدفع شيء، فلا شيء يُرد.";
- lesson: "Cancels the lesson for {students}, releases the court and tells everyone. Online money
  goes back; desk money becomes a refund due." / "تُلغى الحصة لـ{students} ويُحرَّر الملعب ويُبلَّغ
  الجميع. تعود المبالغ الإلكترونية، ويصبح المدفوع في الاستقبال مستحق الرد.";
- course: "Cancels the sessions still to come for everyone signed up. Each payment gets back what
  the sessions not held are worth, in one refund." / "تُلغى الحصص المتبقية لجميع المسجّلين، ويُرد
  لكل دفعة ما يقابل الحصص التي لن تُعقد في ردٍّ واحد." (C-19).
No strike is mentioned: a staff cancel never strikes (CD-2). Cancelling the private booker's
enrolment cancels the lesson with it (`staff_cancel`).

### 5.10.9 Reschedule and move court

**Reschedule** (`op/features/coaching/RescheduleDialog.tsx`, every kind, R8): date and a 30-minute
start Select; the length stays; the cut-off mirror of §5.9 (R47). Body: "Moves this lesson to the new
time on any free court. Everyone in it is told, and guests who booked in the app may cancel free
until the new start." / "تُنقل الحصة إلى الموعد الجديد على أي ملعب متاح، ويُبلَّغ جميع المسجّلين،
ويمكن لمن حجز عبر التطبيق الإلغاء مجانًا حتى الموعد الجديد." A group session adds "The cut-off moves
with it." / "ويتحرّك موعد الإغلاق معها." (R32). Refusals in place. A held lesson never opens it (R32).

**Move court** (`MoveCourtDialog.tsx`, the only court move for a lesson, R7): the branch's courts free
for the same times (from the night's rows through `slotTaken`, `deskLogic.ts:202`), the current one
disabled. Body: "Same time, another court. Students are told the new court." / "الموعد نفسه على
ملعب آخر، ويُبلَّغ المتدرّبون بالملعب الجديد." Refusals: `NO_COURT_FREE` (refetch the night),
`INVALID_TRANSITION` `held` / `ended`, `COURT_NOT_FOUND`.

### 5.10.10 Refunds due (manager)

Shown when `permissionsFor().refund` and `lesson_refunds_due` has items for this lesson or course: a
warn panel "Refunds due at the desk" / "مبالغ مستحقة الرد في الاستقبال", one row per item and
payment: "{label} · paid {amount} by {method} · {refunded} refunded · {due} due" / "{label} · دفع
{amount} {method} · أُعيد {refunded} · المستحق {due}" (`due` = `refund_due_desk_iqd`), and
**Refund** / **ردّ المبلغ** opening the till's `RefundDialog` (`op/features/till/ManagerActions.tsx:56`)
with `payments` = that payment (`refunds` = `[{ amount_iqd: refunded_iqd }]`), `lines=[]`,
`canRefund` true and the new optional prop `dueIqd` (R36). With `dueIqd` the amount is capped at
`min(refundable, due)` and the PIN prompt offers the reason `lesson_refund` only; the toggle
"Goodwill: refund more than is due" / "رد بحسن نية: أكثر من المستحق" lifts the cap to the
refundable amount and offers `lesson_goodwill` only (`LESSON_REFUND_REASON_CODES`, `op.reasons`).
It rides the queued `payment.refund` with the manager PIN, as every till refund does; that is the
existing refund flow, not a coaching write. `REFUND_EXCEEDS_DUE` (online: beside the control;
replayed: the queue's conflict toast) refetches the list. The same rows feed the Ops panel (§5.17).

### 5.10.11 History

`events`, one sentence per type with the actor (`ws.coaching.events.<type>`, "· {actor}" appended;
system → "automatic" / "تلقائي"): `booked` Booked / حجز; `held` Held for online payment / حجز بانتظار
الدفع; `paid_online` Paid online / دفع إلكتروني; `expired` Payment time ran out / انتهاء مهلة الدفع;
`joined` Joined / انضمام; `added` Student added / إضافة متدرّب; `cancelled` Lesson cancelled ({code}) /
إلغاء الحصة ({code}); `enrolment_cancelled` Sign-up cancelled ({code}) / إلغاء تسجيل ({code});
`rescheduled` Moved to a new time / تغيير الموعد; `court_moved` Moved to another court / نقل الملعب;
`under_filled` Cancelled at the cut-off / إلغاء عند موعد الإغلاق, or with `late` (R26) Cut-off checked
too late: nothing was cancelled / فُحص موعد الإغلاق متأخرًا: لم يُلغَ شيء; `completed` Done / انتهاء
الحصة; `attended` Marked arrived / تسجيل حضور; `no_show` Marked no-show / تسجيل غياب; `unmarked` Mark
undone / التراجع عن التسجيل; `settled` Paid at the desk / دفع في الاستقبال; `refunded` Refunded / رد
المبلغ. An unknown type renders its raw word.

## 5.11 Today board: "Lessons today"

`op/features/coaching/LessonsTodayPanel.tsx`, mounted after the open-matches group in both layouts
(`TodaysBoard.tsx:173-184`, `:211-233`). `TodaysBoardView` gains the props `lessons`
(`MatchReadStatus<DeskLessons>`), `runLessons`, `takeLessonPayment`, `onOpenLesson`, `onPayLesson`,
`onNewLesson`, `onRetryLessons`, and stays pure presentation.

| Part | EN | AR |
| --- | --- | --- |
| Time and court | "18:00–19:00 · Court 2" | "18:00–19:00 · الملعب 2" |
| Kind | `LessonBadge` | — |
| What | "{type} · {coach}"; private adds the booker | — |
| Places | "Places 4 of 6" (group, course); private "+2" | "الأماكن 4 من 6" |
| Pay | "To pay 2" (warn once started), "All paid" (success), "Paid online" (neutral) | "للدفع 2"، "مدفوع بالكامل"، "مدفوع إلكترونيًا" |
| Tags | "Needs 2 more by 16:00" (warn), "Awaiting online payment" (info), "Starts in 20 min", "Booked by the coach · unpaid" (warn, C-24) | "تحتاج إلى 2 قبل 16:00"، "بانتظار الدفع الإلكتروني"، "تبدأ بعد 20 دقيقة"، "حجزها المدرّب · غير مدفوعة" |
| Actions | **Take payment** (`takeLessonPayment`, `owing > 0`; one owing enrolment → `/desk/lessons/$id?pay=<enrolment>`, several → the lesson), **Open** | **استلام الدفع**، **فتح** |

Header action **New lesson** / **حصة جديدة** (`runLessons`, reachable). States: coaching off and none
listed: hidden (the booking dialog's Lesson kind still stages, R51); off with some listed: the rows,
the button and "Lessons are switched off here. Lessons already booked carry on." / "الحصص متوقفة
هنا، وتستمر الحصص المحجوزة."; on with none: "No lessons today" / "لا حصص اليوم" and the button;
failed read: §5.5; `RPC_MISSING`: hidden.

**Booking rows.** `TodaysBoardScreen` (`:785`) calls `useDeskLessons(dayStart, dayEnd)` and passes
`lessonsByReservation` down: `guestLabel` and the `CourtsNow` tiles use `lessonLabel`; `BoardRow`
(`:688`) shows `LessonPayCell` ("To pay 2" / "All paid") where a booking shows `ChargeCell`, and
**Open lesson** where a booking shows Mark arrived; `onSelectReservation` (`:928`) navigates to
`/desk/lessons/$id` for a lesson row, else `/desk/bookings/$id` as today.

## 5.12 Coaching settings (`op/features/admin/settings/CoachingSettingsPanel.tsx`)

In Venue details, after `MatchSettingsPanel`: owner in `afterRules` (`VenueDetailsTab.tsx:97-99`) with
`canEdit`; manager `<CoachingSettingsPanel canEdit={false} />` after the read-only match panel
(`:136-137`). Gate `can(role, 'editVenueDetails')`. Own draft, own Save. Pure rules in
`coachingSettingsLogic.ts` (draft, patch of changed keys, field errors, server key → field,
percent ↔ basis points, `onlineModeBlock(settings)`). Title "Lessons and coaches" / "الحصص والمدرّبون".

| Field | Values | Copy EN / AR |
| --- | --- | --- |
| Lessons at this branch (`coaching_enabled`) | switch | Off: "Guests can't book lessons here and the website leaves this branch out. Lessons already booked carry on, and the desk can still set lessons up." / "لا يمكن للزبائن حجز حصص هنا، ولا يعرض الموقع هذا الفرع. تستمر الحصص المحجوزة، ويمكن للاستقبال إعداد الحصص." |
| How lessons are paid (`lesson_payment_mode`) | At the desk · At the desk or online · Online only / في الاستقبال · في الاستقبال أو إلكترونيًا · إلكترونيًا فقط | "Lessons booked by a coach or at the desk are always paid at the desk." / "تُدفع دائمًا في الاستقبال الحصص التي يحجزها مدرّب أو الاستقبال." The two online choices are disabled, with every reason that applies shown under them (C-26, R50, X20): `online_payments_available` false: "Online payment isn't set up for this branch." / "الدفع الإلكتروني غير مُعدّ لهذا الفرع."; `lesson_terms_ready` false: "Online lesson payment can be switched on once the terms and privacy text with a lessons section are live." / "يمكن تفعيل الدفع الإلكتروني للحصص بعد نشر الشروط ونص الخصوصية متضمّنين قسم الحصص." |
| Coach's share (`coach_share_bp`) | 0..100 %, two decimals (`PercentInput`, sent as basis points) | Label "Coach's share" / "نصيب المدرّب". "Coaches earn this share of what is collected for a lesson, after the court share. Each lesson keeps the share it was booked with." / "يحصل المدرّب على هذه النسبة مما يُحصَّل عن الحصة بعد خصم أجرة الملعب، وتحتفظ كل حصة بالنسبة التي حُجزت بها." |
| Prices on the website (`lesson_prices_public`) | switch | "Lesson prices show on the website's coaching page only when this is on. The app shows them either way." / "تظهر أسعار الحصص في صفحة التدريب على الموقع فقط عند تفعيل هذا الخيار، ويعرضها التطبيق في الحالتين." |
| Private lessons a coach can hold (`coach_max_open_private`, C-24, R56) | whole number 1..100, default 10 | Label "Private lessons a coach can hold for their students" / "الحصص الخاصة التي يحجزها المدرّب لمتدرّبيه". "At most this many upcoming private lessons booked by a coach at once. Lessons booked in the app or at the desk don't count." / "حدّ أقصى للحصص الخاصة القادمة التي يحجزها المدرّب في الوقت نفسه، ولا تُحتسب الحصص المحجوزة عبر التطبيق أو من الاستقبال." |

A manager sees `Facts` rows and "Only the owner can change these." / "يغيّر هذه الإعدادات المالك فقط."
`INVALID_ARGUMENT` with a key in its detail lands on that field; `ONLINE_PAYMENT_OFF` `provider` or
`terms` on the payment mode, with the matching line above.

## 5.13 `/admin/coaches` (`op/features/admin/coaches/`)

`CoachesAdmin.tsx`: `PageHeader` "Coaches" / "المدرّبون", lead "Coaches, the lessons they teach and
their hours at this branch." / "المدرّبون والحصص التي يقدّمونها وساعات عملهم في هذا الفرع."; ui
`Tabs` (`op/components/ui.tsx:1038`) Coaches · Lesson types · Hours / المدرّبون · أنواع الحصص ·
الساعات bound to `?tab=`. One read, `coaches_admin` (`QK.coaching.admin(branch)`); `AsyncStateWrapper`;
`RPC_MISSING` → the §5.5 empty state. When `coaching_enabled` is false an info line: "Lessons are
switched off at this branch. Coaches and lesson types can be set up now; guests see nothing until
the owner switches lessons on." / "الحصص متوقفة في هذا الفرع. يمكن إعداد المدرّبين وأنواع الحصص
الآن، ولا يرى الزبائن شيئًا حتى يفعّل المالك الحصص." Every write disabled offline (§5.5).

### 5.13.1 Coaches tab (`CoachesTab.tsx`, `CoachEditor.tsx`, `PromoteCoachDialog.tsx`)

The `CourtsAdmin` shape (`op/features/admin/courts/CourtsAdmin.tsx`): a list and a sticky editor.

List row: photo (square), display name in the screen's language, status badge (Active success,
Paused warn, Retired neutral: "Active" / "نشط", "Paused" / "موقوف مؤقتًا", "Retired" / "متقاعد"),
"Waiting for the coach to accept" / "بانتظار موافقة المدرّب" (info, while `public_accepted_at` is
null, C-22, R61), "Account deleted" / "حُذف الحساب" (neutral, `account_deleted`, R63), "Branches 2" /
"الفروع 2", "Lesson types 3" / "أنواع الحصص 3", "No hours yet" / "لا ساعات بعد" (warn) when `hours`
is empty, "Upcoming lessons 5" / "الحصص القادمة 5". Retired coaches fold behind "Show retired
coaches" / "إظهار المدرّبين المتقاعدين". Header action **Make a coach** / **تعيين مدرّب**
(`manageCoaches`).

**Make a coach** (opened by the button, or by `?promote=<customerId>` from the record):
`CustomerPicker` (guest accounts; a picked account shows full name and phone with "Guests see the
display name below, never the account name." / "يرى الزبائن الاسم المعروض أدناه، لا اسم الحساب.");
display name EN and AR (`BilingualFields`, `op/components/inputs.tsx:263`, 1..60, both required);
bio EN and AR (multiline, 0..1000); photo (`ImageField`, `op/components/ImageField.tsx`,
`folder="coaches"`, no `ownerId`, `aspect="1:1"`; `MediaFolder` in `op/lib/storage.ts:14` gains
`'coaches'`, and `mediaPath('coaches', …)` writes `coaches/<random uuid>/<random uuid>.<ext>`: a fresh
folder per upload, never a profile or coach id (R43), matching §1.2's `photo_path` pattern;
`isMediaPath` learns the `coaches/` shape); branches (checkboxes of `useVenue().venues`, the rail's
branch ticked); lesson types at this branch (checkboxes). Under the form: "The coach is asked in the
app to accept being shown publicly. Until then guests don't see them." / "يُطلب من المدرّب في
التطبيق الموافقة على ظهوره للعموم، ولا يراه الزبائن قبل ذلك." **Make coach** / **تعيين مدرّب**
sends `coach_promote`, then `set_coach_lesson_types` when types were ticked; if the second call fails
the coach exists, the editor opens on it and shows the refusal beside the types. `ALREADY_COACH`
offers "Open {name}" / "فتح {name}".

**Editor** (a coach picked from the list or by `?coach=`):
- Account (read-only): full name, phone `dir="ltr"`, **Open customer**; a deleted account reads
  "Account deleted: the bio and photo were cleared; the display name stays on their statements." /
  "حُذف الحساب: مُسحت النبذة والصورة، ويبقى الاسم المعروض في كشوفه.";
- while not accepted: "{name} hasn't accepted a public profile yet. Guests don't see them until they
  accept in the app; lessons booked at the desk or by the coach work now." / "لم يوافق {name} على
  ملف عام بعد، فلا يراه الزبائن حتى يوافق في التطبيق، وتعمل الحصص المحجوزة من الاستقبال أو من
  المدرّب الآن.";
- display names, bio, photo (`ImageField` as above), order arrows (`SortButtons`, `sort_order`
  through `coach_update`); **Save** sends `coach_update` with the changed keys; a replaced photo's
  old object is removed with `removeMedia` after the save (`app.storage_path_in_use` counts
  `coaches.photo_path`, R43);
- Branches: checkboxes → `set_coach_branches`; removing one with lessons to come is refused
  (`BRANCH_HAS_BOOKINGS`, the detail naming the branch): "This coach has lessons at {branch}. Cancel
  them first." / "لدى المدرّب حصص في {branch}. يلزم إلغاؤها أولًا.";
- Lesson types here: checkboxes → `set_coach_lesson_types`; unticking a type the coach has an own
  price for asks first: "Unticking {type} also removes {coach}'s own price for it." / "إلغاء تحديد
  {type} يحذف أيضًا السعر الخاص بـ{coach} له." (R46);
- Prices for this coach: one row per type taught: "Lesson price {type price}" and the coach's own
  price if any. Owner (`editLaunchedPrices`): a `MoneyInput` with **Set** (`set_coach_price`) and
  "Leave empty to use the lesson type's price." / "يُترك فارغًا لاعتماد سعر نوع الحصة."; manager:
  read-only with **Propose a price for {coach}** / **اقتراح سعر لـ{coach}**
  (`PriceChangeButton target={{ change: 'coach_price', coach: id, lessonType: typeId }}`) and
  `PriceLockNote` "Prices change through the owner's approval." / "تتغيّر الأسعار بموافقة المالك.";
- Status: **Pause** / **إيقاف مؤقت** (note optional: "Not bookable and hidden from guests. Lessons
  already booked stay." / "لا يمكن الحجز معه ولا يظهر للزبائن، وتبقى الحصص المحجوزة."), **Resume** /
  **استئناف**, **Retire** / **إحالة إلى التقاعد** (`ConfirmDialog kind="danger" requireChoice`, note
  required; C-25, R45): "Retire {name}? Their {lessons} to come and any running course are
  cancelled as coach cancels: everyone booked is told, online money goes back and desk money becomes
  a refund due. Their photo comes off the app and the website. They keep seeing their approved and
  paid statements, nothing else." / "إحالة {name} إلى التقاعد؟ تُلغى {lessons} القادمة وأي دورة جارية
  كإلغاء من المدرّب: يُبلَّغ جميع المسجّلين، وتعود المبالغ الإلكترونية، ويصبح المدفوع في الاستقبال
  مستحق الرد. تُزال صورته من التطبيق والموقع، ولا يرى بعدها إلا كشوفه المعتمدة والمدفوعة." (`{lessons}`
  counts `upcoming_lessons`; the course clause shows when `open_courses > 0`). Retiring is never
  refused; the toast reads "{name} is retired: {lessons} cancelled." / "أُحيل {name} إلى التقاعد،
  وأُلغيت {lessons}." from `lessons_cancelled`. Each sends `set_coach_status`;
- a retired coach's editor is read-only, with **Make a coach again** / **إعادة التعيين مدرّبًا** →
  Make a coach with that customer picked (`coach_promote` revives the row; the photo starts empty).

### 5.13.2 Lesson types tab (`LessonTypesTab.tsx`, `LessonTypeEditor.tsx`, `lessonTypeLogic.ts`)

List grouped Private · Group · Course, each row: name, "60 min" / "60 دقيقة", places ("Up to 4
people" / "حتى 4 أشخاص"; "2–8 places" / "2–8 أماكن"; course "{sessions}"), price (`Money`) or "No
price yet" / "بلا سعر بعد", court share ("Court share {amount}" / "أجرة الملعب {amount}"), state
badge: Draft / مسودة (neutral), On sale / معروض للبيع (success), Off / متوقف (neutral), and "Price
change in progress" / "تغيير سعر قيد الموافقة" (info, from `pending_run`, linking `/protocols?run=`).
Header **New lesson type** / **نوع حصة جديد** (`manageCoaches`).

Editor fields: kind (SegmentedControl; locked once launched: "The kind can't change after it goes
on sale." / "لا يتغيّر النوع بعد طرحه للبيع."); names EN and AR (1..60); descriptions EN and AR
(0..500); duration (Select 30..240 by 30); largest party (private, 1..4) or places max and minimum
(group and course, 2..16, minimum 1..max); cut-off hours (group and course, 0..168, at least 1 when
the minimum is above 1; a new group or course type starts at 2, R26: "Below the minimum this long
before the start, it is cancelled and refunded. At least 1 hour when the minimum is above 1." / "إن
قلّ العدد عن الحد الأدنى قبل البدء بهذه المدة، تُلغى وتُعاد المبالغ. ساعة واحدة على الأقل إن زاد
الحد الأدنى عن 1."); sessions (course, 2..52); price and court share (`MoneyInput`); coaches
teaching it (chips, read-only: "Choose coaches on the Coaches tab." / "يُختار المدرّبون من تبويب
المدرّبين."). Pure `lessonTypeDraftErrors` mirrors the §1.2 CHECKs and `lesson_types_cutoff`.

Who edits what (`priceLock(type, caps)`, R46):

| Type state | Owner | Manager |
| --- | --- | --- |
| Draft (never launched) | every field; **Put on sale** / **طرح للبيع** saves `is_active: true` directly (`launchDirectly`) | every field including price and court share (C-17: drafts are edited directly); **Put on sale** is `PriceChangeButton target={{ change: 'lesson_launch', lessonType: id }}`, disabled until a price is set ("Set a price first." / "يلزم تحديد سعر أولًا.") |
| Launched | every field | names, descriptions, group and course places, minimum, cut-off and order. Price and court share read-only with **Propose a price** / **اقتراح سعر** (`change: 'lesson_price'`) and `PriceLockNote`. Duration, sessions and a private type's party size read-only with "Make a new lesson type to change its length, sessions or party size." / "لتغيير المدة أو عدد الحصص أو عدد الأشخاص يلزم إنشاء نوع حصة جديد." and **Make a new lesson type…** / **إنشاء نوع حصة جديد…** (opens a new draft prefilled from this one) |
| Launched, on or off | the Active switch | the Active switch, a direct write (R46, folded Addition 9) |

A stale screen's refusal renders its way out, never the item wording of
`op.errors.PRICE_VIA_PROTOCOL`: `PRICE_VIA_PROTOCOL` `price` and `LAUNCH_VIA_PROTOCOL` "Lesson prices
change through the owner's approval." / "تتغيّر أسعار الحصص بموافقة المالك." with the matching start
button; `PRICE_VIA_PROTOCOL` `shape` the "Make a new lesson type…" line and button.

### 5.13.3 Hours tab (`CoachHoursTab.tsx`, `coachHoursLogic.ts`)

A coach Select (active and paused at this branch; `?coach=` picks one). Then:

**Weekly hours** (the `OpeningHoursEditor` layout, `op/features/admin/OpeningHoursEditor.tsx:66`,
Sunday first as `weekday` 0..6): each day lists its windows, each a start and an end Select on the
half hour from 00:00 to 24:00 (CD-10: one local day; "24:00" is offered as an end, which a native
time input cannot hold), with **Add a window** / **إضافة فترة**, a remove button, and **Copy to every
day** / **نسخ إلى كل الأيام**. Muted under a day: the coach's windows at other branches ("At {branch}:
09:00–13:00" / "في {branch}: 09:00–13:00") from `hours_elsewhere`. The line above the grid: "Set by
the coach on {date}" / "حدّدها المدرّب في {date}" or "Set at the desk by {name} on {date}" / "حدّدها
{name} من الإدارة في {date}". Pure checks before Save: start before end, on the half hour, end ≤
24:00, no overlap on a day here; an overlap with another branch's window is a warning, the server
decides (`HOURS_OVERLAP`, its detail mapped back to the window and weekday the operator sent).
**Save hours** / **حفظ الساعات** sends `set_coach_hours` with every window; body line "The coach sees
the change in coach mode. Lessons already booked stay." / "يرى المدرّب التغيير في وضع المدرّب، وتبقى
الحصص المحجوزة."

**Time off**: the upcoming list ("Mon 13 Oct 09:00 – Wed 15 Oct 24:00 · {reason} · set by the coach"
/ "… · حدّدها المدرّب"), **Add time off** / **إضافة إجازة** (from and to as date and time, reason
0..200) → `add_coach_time_off`; `TIME_OFF_HAS_LESSONS` reads "{name} has {lessons} in that time.
Cancel or move them first." / "لدى {name} {lessons} في هذه الفترة. يلزم إلغاؤها أو نقلها أولًا.";
**Cancel** per row → `cancel_coach_time_off` (`INVALID_ARGUMENT` `p_id` refetches the list).

## 5.14 Price approval: the three lesson change kinds

The owner's price-or-promotion protocol is started from screens with `PriceChangeButton` →
`/protocols?start=price_promo&change=<kind>&…` (`op/features/admin/promotions/priceChange.ts:27-34`,
`PriceChangeStart.tsx:20-26`), and its start and steps are drawn from the shared field lists in
`@touch/core/protocols`. The three kinds are §1.8's `lesson_price`, `lesson_launch`, `coach_price`,
managers and the owner only (marketing never, like `shop_launch`).

### 5.14.1 The core twin (`packages/core/src/protocols/`)

- `types.ts:33-43` `PRICE_CHANGE_KINDS` gains the three, appended; `LESSON_CHANGE_KINDS` and
  `isLessonChange(k)` are new exports. `PriceProposeRecord` (`:254-276`) gains
  `| { change: 'lesson_price'; lesson_type_id: string; price_iqd?: number | null; court_share_iqd?: number | null; before?: LessonBefore | null }`
  `| { change: 'lesson_launch'; lesson_type_id: string; price_iqd: number; court_share_iqd: number; before?: LessonBefore | null }`
  `| { change: 'coach_price'; coach_id: string; lesson_type_id: string; price_iqd: number | null; before?: LessonBefore | null }`
  (`lesson_price`: at least one of the two figures; `coach_price` `null` removes the coach's own
  price). `LessonBefore = { price_iqd?, court_share_iqd?, shape: { kind, duration_min,
  sessions_count, max_places } }` is stamped by `protocol_check_price_promo_propose` at submit, like
  `PriceRename.before_*` (a copy the client sends is replaced), and compared by the target check
  (`PRICE_TARGET_CHANGED` hint `lesson_type`, R46). `PriceNumbersRecord` gains `price_iqd`,
  `court_share_iqd`.
- `steps.ts:82-87` `priceChangeKinds`: marketing's filter also drops `isLessonChange` kinds.
- `steps.ts:528-551` `PROPOSE_BY_CHANGE`: `lesson_price: [f.uuid('lesson_type_id'),
  f.iqd('price_iqd', false), f.iqd('court_share_iqd', false)]`, `lesson_launch:
  [f.uuid('lesson_type_id'), f.iqd('price_iqd', true), f.iqd('court_share_iqd', true)]`,
  `coach_price: [f.uuid('coach_id'), f.uuid('lesson_type_id'), f.iqd('price_iqd', false)]`;
  `NUMBERS_BY_CHANGE`: `[f.iqd('price_iqd', false), f.iqd('court_share_iqd', false)]` for the two
  type kinds, `[f.iqd('price_iqd', false)]` for `coach_price`.
- `validate.ts`: `lesson_price` needs one figure; `price_iqd > 0` where given.
- `protocols.test.ts:146-149` and the propose cases extend to the three kinds.

DB's 0282 re-issues (`protocol_check_price_promo_propose`, `price_promo_check_targets`,
`price_promo_apply_internal`, `price_promo_targets`, `price_promo_numbers`) validate and apply the
same record keys (accepted §1.12 addition; `before.shape` per R46).

### 5.14.2 Operator `/protocols` (management)

- `op/features/protocols/search.ts:25-35` `PRICE_CHANGE_KINDS` (the local copy) gains the three;
  `lessonType`, `coach` join `UUID_PARAMS` (`:65`) and `ProtocolsSearch`.
- `op/features/admin/promotions/priceChange.ts` `PriceChangeTarget` and `priceChangeSearch` carry
  `lessonType`, `coach`.
- `op/features/protocols/priceTargets.ts`: `Targets` gains `lessonTypes[]` and `coaches[]` (read from
  §5.6.3's `price_promo_targets` arrays, X28: a coach's types nest under the coach with
  `type_price_iqd` and `coach_price_iqd`); `TargetLink` gains `lessonType`, `coach`;
  `priceProposalPrefill` (`:217-248`) gains `lesson_price` (the type's current price and court share),
  `lesson_launch` (the draft's price and court share), `coach_price` (`coach_price_iqd`, else
  `type_price_iqd`); `pickTarget` (`:251-277`) sets `lesson_type_id` / `coach_id` and refills the
  figures. Both switches are exhaustive, so typecheck fails until every case is written.
- `StepForm.tsx:238-240`: `lesson_type_id` and `coach_id` route to `TargetSelect` (`:658-700`), which
  lists lesson types ("Group 90 min · Draft" / "جماعية 90 دقيقة · مسودة") or coaches; a `coach_price`
  proposal lists only the picked coach's types. Under the figures, the current values: "Now: price
  {price} · court share {share}" / "الآن: السعر {price} · أجرة الملعب {share}".
- `contextLogic.ts:169-219` `readNumbers` reads the `lesson` block (X28); the numbers step shows
  "{name}: places sold in the last 30 days 40 · their value 1,200,000" / "{name}: الأماكن المبيعة
  خلال 30 يومًا 40 · قيمتها 1,200,000" (`places_30d`, `owed_30d_iqd`); `numbersPrefill`
  (`:261-271`) copies `price_iqd` and `court_share_iqd`; `NUMBERS_FIGURES` (`:290`) gains both.
- `RecordView.tsx` names the target from the targets list (lesson type, coach) as it does items.
- `PRICE_TARGET_CHANGED` hint `lesson_type` and `coach_price` have their own lines (§5.19).
- Labels: `ws.protocols.fields.lesson_type_id` "Lesson type" / "نوع الحصة", `.coach_id` "Coach" /
  "المدرّب", `.price_iqd` "Price" / "السعر", `.court_share_iqd` "Court share per session" / "أجرة
  الملعب لكل حصة" (`labels.test.ts` walks every form); `work.protocol.change.lesson_price` "Change a
  lesson price" / "تغيير سعر حصة", `.lesson_launch` "Put a lesson type on sale" / "طرح نوع حصة
  للبيع", `.coach_price` "Change a coach's lesson price" / "تغيير سعر حصة لمدرّب"
  (`packages/i18n/src/catalogs/work.{en,ar}.ts:70-79`).
- `/tasks` (`op/features/tasks/`): marketing never starts these, but works the `announce` step of any
  run, so `fieldLabels.ts:150` gains the three change labels and the new field labels, and
  `priceLogic.ts` `needsTargets` stays true for them (an exhaustive `targetSources` gains the lesson
  arrays). No start is offered there (`priceChangeKinds('marketing')`).

### 5.14.3 Staff phone protocol form (apps/mobile; staff screens, not the Guest lane's)

The phone duplicates the rendering over the same core lists, so growing `PRICE_CHANGE_KINDS` reaches
it:
- `apps/mobile/app/staff-start.tsx:491-495`: the start list filters `isLessonChange` out. Lesson
  prices are started from the operator, where the lesson types are; the start page's
  `targetTitle` template (`:166`) excludes the three in its type, as it excludes `addon_price` and
  `promotion`.
- `src/features/staff/protocols/logic.ts:180-196` `targetKindOf`: the three return `'none'`
  (exhaustive). `priceNumbersStart` (`:515-560`) prefills `price_iqd` and `court_share_iqd` from
  `numbers.lesson`.
- `src/features/staff/protocols/labels.ts:202-211`: the `change` map gains the three `work.*` keys.
- `src/features/staff/protocols/types.ts:189-197` `PriceTargets` gains `lesson_types?`, `coaches?`
  (the X28 shapes); `useStepReads.ts:146-152` puts their names in the id → name map, so the record,
  decide and numbers steps of a lesson run read by name on the phone (the owner decides from the
  phone).
- Phone tests: the labels and `targetKindOf` cases extend; a `test:smoke` case renders the decide
  step of a `lesson_price` run by name (R58's phone half). No new screen.

## 5.15 Customer record (`op/features/desk/customers/CustomerRecord.tsx`)

| Part | Content | Gate |
| --- | --- | --- |
| Header badge | `CoachBadge` "Coach" / "مدرّب" (lesson tokens, `whistle`) when `customer_lessons.coach` is set; "Coach · paused" / "مدرّب · موقوف مؤقتًا", "Coach · retired" / "مدرّب · متقاعد". It is not a customer flag: `FLAG_TYPES` (`:55`) and `CustomerFlagType` do not change | — |
| Header actions | **Make coach** / **تعيين مدرّب** → `/admin/coaches?tab=coaches&promote=<id>` (not a coach); **Open in Coaches** / **فتح في المدرّبين** → `?coach=<coach_id>` (a coach) | `manageCoaches` |
| Header action | **Book a lesson** / **حجز حصة** → `/desk?customer=<id>&kind=lesson` (coaching on or off, R51) | `runLessons` |
| Counts | "Lessons 5 · No-shows 1" / "الحصص 5 · الغياب 1"; when `lesson_strikes_30d > 0`, "Late cancels and no-shows in 30 days: {count}" / "الإلغاءات المتأخرة والغياب خلال 30 يومًا: {count}" | — |
| Lessons panel (`op/features/coaching/CustomerLessonsPanel.tsx`) | upcoming, then recent: time, kind badge, type and coach, sign-up status, attendance, the money line of §5.10.4; a row at this branch opens `/desk/lessons/$id`; a row at another branch shows that branch's name and no link; **Take payment** on an owing row at this branch (PaymentPane + `lesson_settle`, §5.10.5). Only lessons this customer booked, was picked for at the desk, or confirmed (C-21) | panel: `runLessons` or `takeLessonPayment`; Open: `runLessons`; Take payment: `takeLessonPayment` |

The record is the cashier's way to take a lesson payment for a student with an account (R20): the
cashier opens `/desk/customers` (`ROUTE_ROLES`, `auth.tsx:228`) but not `/desk/lessons/$id`.

## 5.16 Coach pay (`/reports/coaches`, `op/features/reports/coaches/CoachStatements.tsx`)

Modelled on `op/features/deductions/DeductionsMonth.tsx` (month stepper, one row per person, rows
open to their lines). `PageHeader` "Coach pay" / "مستحقات المدرّبين", lead "Each coach's monthly
statement: what was collected for their lessons, less the court share, and their share of the rest.
The money is handed over outside the till." / "كشف شهري لكل مدرّب: ما حُصّل عن حصصه بعد خصم أجرة
الملعب، ونصيبه من الباقي. يُسلَّم المبلغ خارج الصندوق." No `ReportTabs` strip (it is not one of the
five reports, `ReportTabs.tsx:31-37`); the `/reports` layout's `ReportBranchScope` applies. A
retired or deleted coach keeps their display name here (C-29).

- **Month stepper**: ‹ and › around "October 2026" / "أكتوبر 2026"; never past the server's
  `current_month`; `?month=` keeps it across reloads.
- **Totals band** (`HeadlineFigure`s, `totals`): Collected · Court share · Coach's share ·
  Adjustments · To pay (`total_iqd`) · Approved, not paid · Paid / المحصَّل · أجرة الملعب · نصيب
  المدرّب · التسويات · للدفع · معتمد ولم يُدفع · المدفوع.
- **Table** (`DataTable`, `kit.tsx:654`): coach, branch (only under "All branches"), lessons,
  collected, court share, coach's share, adjustments (signed, `isolateLtr`), to pay, status badge
  (Draft neutral, Approved info, Paid success, Void muted: "Draft" / "مسودة", "Approved" / "معتمد",
  "Paid" / "مدفوع", "Void" / "ملغى"); a row opens the statement dialog.
- **Not drafted** (`missing[]`): muted rows under the table, "{coach}: not drafted yet" / "{coach}:
  لم يُعدّ بعد", or with `older_draft` "{coach}: waits for an older month's draft" / "{coach}: بانتظار
  مسودة شهر سابق".
- **Empty**: current month "Statements are drafted on the 1st for the month before." / "تُعدّ الكشوف
  في اليوم الأول من كل شهر عن الشهر السابق."; another month "No statements for {month}." / "لا كشوف
  لشهر {month}."
- **Other branches (R21).** Under "All branches", a row of a branch other than the rail's is
  read-only and does not open: "Switch to {branch} to approve or pay." / "يلزم التبديل إلى {branch}
  للاعتماد أو الدفع." (writes and the detail read stay on the rail's branch, `apps/operator/CLAUDE.md`
  "Branches").

**Statement dialog** (`StatementDialog.tsx`, `Modal size="lg"`): title "{coach} · {month}"; the
figures; lines (`DataTable`, every line carries its lesson, R24): date, lesson ("Group · Session 3" /
"جماعية · الحصة 3"), sign-ups, attended, no-shows, collected, court share, share %, coach amount; a
line opens `/desk/lessons/$id`; an adjustment line is marked "Adjustment" / "تسوية" with "This lesson
was on an approved statement; its money changed since." / "كانت هذه الحصة في كشف معتمد، وتغيّر
مبلغها بعد ذلك."; a stale draft (`stale`) shows "Lessons changed since this draft was counted.
Recount to include them." / "تغيّرت حصص منذ احتساب هذه المسودة. يلزم إعادة الاحتساب لإدراجها.";
the coach-booked no-shows (C-24, R56) under "Booked by the coach, the student didn't come" /
"حجزها المدرّب ولم يحضر المتدرّب": date and type, each linking its lesson; the paid line "Paid {date}
by {name} · Ref {reference}" / "دُفع في {date} بواسطة {name} · المرجع {reference}". On the caller's
own statement (every `can` false, CM-11): "This is your own statement. Another manager or the owner
approves and pays it." / "هذا كشفك أنت، ويعتمده ويدفعه مدير آخر أو المالك." Actions
(`settleCoaches`, the statement's `can`, `statementActions`):
- draft: **Recount** / **إعادة الاحتساب** (`coach_statement_refresh`; "Recounts from the lessons
  collected so far." / "يُعاد الاحتساب من الحصص المحصّلة حتى الآن."), **Approve** / **اعتماد**
  (`ConfirmDialog` "Approve {coach}'s statement for {month}? It can't change after this, except by
  voiding it." / "اعتماد كشف {coach} لشهر {month}؟ لا يتغيّر بعد ذلك إلا بإلغائه."; no PIN, R4),
  **Void** / **إلغاء الكشف** (no PIN);
- approved: **Mark paid** / **تسجيل الدفع**, **Void** (manager PIN, R59). A total below zero
  disables Mark paid: "This statement is below zero ({amount}). Void it; the next statement carries
  it." / "هذا الكشف دون الصفر ({amount}). يلزم إلغاؤه، ويُرحَّل إلى الكشف التالي.";
- void: **Redraft** / **إعادة الإعداد** (`coach_statement_refresh`, "Drafts this month again from
  its lessons." / "يُعدّ كشف هذا الشهر من جديد من حصصه."); paid: none.

**Mark paid** (`MarkPaidDialog.tsx`): a reference field (1..80, "Receipt or transfer number, or a
note on how it was paid. Never a card or account number." / "رقم الإيصال أو التحويل، أو ملاحظة عن
طريقة الدفع. لا يُكتب رقم بطاقة أو حساب أبدًا."; `referenceErrors` mirrors R49: a run of 12 or more
digits, "A card or account number can't go here. Use a receipt or transfer number." / "لا يُكتب هنا
رقم بطاقة أو حساب. يُرجى استخدام رقم الإيصال أو التحويل."), then `PinPromptOverlay` (`kit.tsx:1620`)
"Mark {amount} paid to {coach}" / "تسجيل دفع {amount} إلى {coach}"; sends `coach_statement_mark_paid`
with `p_pin` and `p_device_id`, so `appRpc` proves the PIN to `verify_manager_pin` first
(`appRpc.ts:147-155`; `PIN_GATED_RPCS`, R4). Body: "Records that the money was handed over. Nothing
is taken from the drawer." / "يُسجّل تسليم المبلغ، ولا يُسحب شيء من الصندوق."

**Void** (`VoidStatementDialog.tsx`): a reason (1..200, the same 12-digit mirror), body "A voided
statement is redrafted from the lessons next time statements are drafted." / "يُعاد إعداد الكشف
الملغى من الحصص عند الإعداد التالي للكشوف." From `approved` it adds "Cash may already have been handed
over for an approved statement. Voiding it needs a manager PIN, and the next statement counts these
lessons again." / "قد يكون المبلغ سُلّم فعلًا عن الكشف المعتمد. يتطلب إلغاؤه رمز مدير، ويحتسب الكشف
التالي هذه الحصص من جديد." and `PinPromptOverlay` "Void {coach}'s approved statement" / "إلغاء كشف
{coach} المعتمد", sending `p_pin` and `p_device_id` (R59).

**Financial card** (§5.3.3). The owner's Financial home also shows nothing new above the cards: the
month-so-far card reads `panel_headline`, which gains the lesson line (§5.18.4).

## 5.17 Ops: lesson refunds and online refunds

**Lesson refunds due** (`op/features/ops/LessonRefundsDuePanel.tsx`), mounted
`hideWhenEmpty` after `MatchReportsPanel` (`op/features/ops/OperationsOverview.tsx:185-187`), gated
`permissionsFor().refund`. Title "Lesson refunds due" / "مبالغ حصص مستحقة الرد", the header figure
`total_iqd`. A row (`items[]`): the student (`label`, `phone`), the lesson (time, kind badge, coach,
**Open lesson**), "Paid {amount} by {method}", "Refunded so far {amount}", "Due {amount}"
(`refund_due_desk_iqd`); a course leave (C-23, R62) adds "Left the course: due for the sessions still
to come" / "انسحب من الدورة: المستحق عن الحصص المتبقية"; `online_blocked_iqd > 0` adds "Online
refund needs attention: {amount}" / "رد إلكتروني يحتاج إلى متابعة: {amount}" linking the online
refunds panel. **Refund** opens `RefundDialog` as in §5.10.10 (capped at the due, goodwill toggle,
R36). Lead: "Desk money for lessons that were cancelled or left. Online money goes back by itself." /
"مبالغ مدفوعة في الاستقبال عن حصص أُلغيت أو انسحب منها أصحابها. تعود المبالغ الإلكترونية تلقائيًا."

**Online refunds** (`op/features/deposits/DepositAttentionPanel.tsx`, `depositAttentionLogic.ts`):
rows with `purpose 'lesson'` read "Lesson refund · {name}" / "رد مبلغ حصة · {name}" with **Open
lesson** (`lesson_id`) and **Open customer**; `RefundReason` (`depositApi.ts`) gains `coach_cancel`
("Coach cancelled" / "ألغاها المدرّب") and `under_filled` ("Too few students" / "قلة المتدرّبين").
`deposit_refund_request` on a lesson payment whose money is not final answers `PAYMENT_STATE`
`lesson_live` (its own line, §5.19).

## 5.18 Money on other screens

### 5.18.1 Day close (`op/features/admin/DayClose.tsx`, `DayCloseOnline.tsx`)

`DayCloseOnline` (mounted `DayClose.tsx:735`) gains a **Lessons** group, information only, never in
the cash count, hidden when every figure is zero. `OnlineGroupId` (`dayCloseLogic.ts:60`) gains
`'lessons'`; `onlineMoneyOf` adds it after `matches`; `readDayCloseOnline` reads the optional
`lessons` block (X27: Money's names plus `kept_*`); the label lookup becomes
`onlineLabelKey(group, row)` so the lessons group reads `ws.coaching.dayClose.*` while the others keep
`ws.matches.dayClose.*`.

| Row (keys) | EN | AR |
| --- | --- | --- |
| `online_received_*` | Paid online | المدفوع إلكترونيًا |
| `online_refunded_*` | Refunded online | المردود إلكترونيًا |
| `online_refunds_waiting_*` | Online refunds waiting | ردود إلكترونية قيد الانتظار |
| `kept_*` | Kept for late cancels and no-shows | المحتجز للإلغاء المتأخر وعدم الحضور |
| `desk_paid_*` | Paid at the desk (in the drawer) | المدفوع في الاستقبال (ضمن الصندوق) |
| `desk_refunded_iqd` | Refunded at the desk today, whatever day it was paid (out of the drawer) | المردود في الاستقبال اليوم أيًّا كان يوم الدفع (من الصندوق) |
| `owed_*` | Lessons held and not paid | حصص عُقدت ولم تُدفع |
| `refunds_due_desk_*` | Refunds due at the desk | مبالغ مستحقة الرد في الاستقبال |
| `lessons`, `owed_to_coaches_iqd` | Owed to coaches for today's lessons (paid outside the till) | مستحق للمدرّبين عن حصص اليوم (يُدفع خارج الصندوق) |

The group's title "Lessons today" / "حصص اليوم".

**Refunds count on the day they are made (C-31, R27).** From 0278 `close_day`,
`v_day_close_summary` and `day_close_online` date every refund (café, court, lesson) by the till
shift it was made in. The till-shifts step's cross-day line (`DayClose.tsx:1009-1013`,
`ws.tillShift.dayClose.crossDay`, today "… The day's expected cash leaves them out.") would then be
wrong: it reads `day_close_online.refunds_dated_by_shift` for the day and, when true, says "Refunds
made on this day for earlier days' payments: {amount} in cash. They count in this day's expected
cash." / "مبالغ رُدّت في هذا اليوم عن دفعات أيام سابقة: {amount} نقدًا، وتُحتسب في النقد المتوقع لهذا
اليوم." (new key `crossDayCounted`); when false or absent (a day closed before the change keeps its
stored figures, or an older server) the existing sentence stays. The CSV row label is unchanged.

### 5.18.2 Courts report, Lessons view (`op/features/reports/CourtsReport.tsx`)

`readCourts` (`reportPayloads.ts:179`) reads the optional `lessons` block (X25) and the per-court
`lessons`, `lessonMinutes`; `View` (`CourtsReport.tsx:90`) gains `'lessons'`, offered when the block is
present (`courtsViews`). Occupancy now counts lesson minutes as booked (Money CM-14): the occupancy
figure's hint adds "Lesson time counts as booked." / "تُحتسب أوقات الحصص ضمن الإشغال.", and the
per-court table shows `lessonMinutes` from `columns`. The view: a band from the block (lessons, court
hours from `lessonMinutes`, collected, court share, owed to coaches) and, from `report_lessons` for
the same period (`['reports', 'report_lessons', args]`, X24): counts (lessons, private, group, course
sessions, cancelled, cancelled at the cut-off, expired, sign-ups, attended, no-shows, late cancels,
fill rate), money (collected, at the desk, online, refunded, court share, owed to coaches, the
venue's share, lesson revenue), and three tables: By coach, By lesson type, By day (each exportable,
`exportTable`). The court filter hides. "Compare with" is disabled: "Comparison isn't available for
lessons yet." / "المقارنة غير متاحة للحصص بعد." (`useComparedReport` knows three RPCs,
`ReportParts.tsx:477`). Empty: "No lessons in this period." / "لا حصص في هذه الفترة."
`report_lessons` matches `REPORT_RPC`, so "All branches" works with no change. Labels
`ws.reports.courts.views.lessons` "Lessons" / "الحصص" and `.lead.lessons`.

### 5.18.3 Revenue report (`op/features/reports/RevenueReport.tsx`)

`revenueFigures` (`reportPayloads.ts:87-101`) reads `lessonIqd` and `owedToCoachesIqd` (X26). The
Earned group (`RevenueReport.tsx:192-196`) gains **Lessons** / **الحصص** (`lessonIqd`, after Padel)
and **Owed to coaches** / **مستحق للمدرّبين** (`owedToCoachesIqd`, hint "Coaches' share of lesson
money, paid outside the till" / "نصيب المدرّبين من مبالغ الحصص، يُدفع خارج الصندوق"); the breakdown
table gains a Lessons column. `VIEW_FIGURES.earned` (`:65-79`) adds `lessonRevenue` only if Money's
`report_drill` accepts that figure; otherwise the figure is plain (no drill). The figure is "—" on a
server without the key.

### 5.18.4 Management panel and Financial home (`op/features/panel/figures.ts`)

`LESSON_FIGURE_KEYS = ['lessonRevenue', 'owedToCoaches']` beside `ONLINE_FIGURE_KEYS` (`:34`), group
`'lessons'`, not drillable (`exportAll.ts` `DRILLABLE_FIGURES` does not grow); `lessonRevenue` opens
`/reports/revenue`, `owedToCoaches` opens `/reports/coaches`. `ManagementPanel.tsx` renders the group
as its own Panel "Lessons" / "الحصص", hidden when neither key came back. Labels
`ws.owner.panel.figures.lessonRevenue` "Lessons" / "الحصص", `.owedToCoaches` "Owed to coaches" /
"مستحق للمدرّبين".

## 5.19 Errors

**Catalogue.** Each §1.10 code is a key of `ERROR_CODE_KEYS` (`packages/i18n/src/errors.ts:45`), its
line `op.errors.<CODE>` in a new pair `packages/i18n/src/catalogs/opErrors.coaching.{en,ar}.ts`,
spread into `op.errors` beside `opErrorsMatchesEn` (`en.ts:2073-2074`) and `opErrorsMatchesAr`
(`ar.ts:1934`). As for open matches (R11), each row lands in the migration commit that first raises
the code (`check-error-codes` fails otherwise); the wording below is this lane's, written to fit staff
and guests alike, and the phone overrides where it needs its own words (`errorMessageKey`
`overrides`). `PRICE_VIA_PROTOCOL` and `LAUNCH_VIA_PROTOCOL` already exist (`errors.ts:340,342`,
`opErrors.protocols.*`): reused (R14), with the screen lines of §5.13.2. The operator handles only
codes a server raises (R52): `NOTHING_OWED`, `NOT_FOUND`, `SLOT_TAKEN` on a court move, and
`COACHING_OFF` / `BEYOND_HORIZON` on a desk booking are gone.

| Code | EN | AR |
| --- | --- | --- |
| `COACHING_OFF` | Lessons are switched off at this branch. | الحصص متوقفة في هذا الفرع. |
| `NOT_A_COACH` | This account isn't a coach. | هذا الحساب ليس حساب مدرّب. |
| `ALREADY_COACH` | This customer is already a coach. | هذا الزبون مدرّب أصلًا. |
| `COACH_NOT_FOUND` | That coach can't be found. | تعذّر العثور على هذا المدرّب. |
| `COACH_INACTIVE` | This coach is paused or retired, so no new lessons can be booked with them. | هذا المدرّب موقوف مؤقتًا أو متقاعد، فلا تُحجز معه حصص جديدة. |
| `COACH_NOT_AT_BRANCH` | This coach doesn't teach at this branch. | لا يدرّب هذا المدرّب في هذا الفرع. |
| `LESSON_TYPE_NOT_FOUND` | That lesson type can't be found. | تعذّر العثور على نوع الحصة هذا. |
| `LESSON_TYPE_INACTIVE` | This lesson type isn't on sale. | نوع الحصة هذا غير معروض للبيع. |
| `LESSON_TYPE_NOT_OFFERED` | This coach doesn't teach this lesson type. | لا يقدّم هذا المدرّب نوع الحصة هذا. |
| `COACH_UNAVAILABLE` | The coach isn't working at that time. | المدرّب خارج ساعات عمله في هذا الوقت. |
| `COACH_BUSY` | The coach already has a lesson at that time. | لدى المدرّب حصة أخرى في هذا الوقت. |
| `NO_COURT_FREE` | No court is free at that time. | لا يوجد ملعب متاح في هذا الوقت. |
| `SLOT_NOT_ON_GRID` | Lessons start on the hour or at half past. | تبدأ الحصص عند رأس الساعة أو نصفها. |
| `PARTY_TOO_LARGE` | That's more people than this lesson takes. | العدد أكبر مما تتّسع له هذه الحصة. |
| `LESSON_FULL` | No place is left in this lesson. | لم يبقَ مكان في هذه الحصة. |
| `LESSON_CLOSED` | This lesson isn't taking sign-ups any more. | لم تعد هذه الحصة تقبل التسجيل. |
| `ALREADY_ENROLLED` | This person is already signed up. | هذا الشخص مسجّل أصلًا. |
| `LESSON_NOT_FOUND` | That lesson isn't at this branch any more. | هذه الحصة لم تعد في هذا الفرع. |
| `ENROLMENT_NOT_FOUND` | That sign-up changed. The list has been refreshed. | تغيّر هذا التسجيل، وحُدّثت القائمة. |
| `LESSON_NOT_CANCELLABLE` | This lesson can't be cancelled any more. | لم يعد إلغاء هذه الحصة ممكنًا. |
| `LESSON_VIA_COACHING` | This court is held for a lesson. Change it from the lesson's own screen. | هذا الملعب محجوز لحصة، وتُعدَّل من صفحة الحصة نفسها. |
| `LESSON_OWED_CHANGED` | What's owed for this lesson just changed. Check the new amount. | تغيّر المستحق عن هذه الحصة للتو. يُرجى مراجعة المبلغ الجديد. |
| `LESSON_NOT_PAYABLE` | Nothing can be taken for this sign-up now. | لا يمكن استلام أي مبلغ عن هذا التسجيل الآن. |
| `LESSON_TAB_NO_GOODS` | Café items don't go on a lesson's bill. Open a separate café bill. | لا تُضاف أصناف المقهى إلى فاتورة الحصة. يُرجى فتح فاتورة مقهى منفصلة. |
| `ONLINE_PAYMENT_REQUIRED` | This branch takes lesson payments online only. | يقبل هذا الفرع دفع الحصص إلكترونيًا فقط. |
| `ONLINE_PAYMENT_OFF` | Online payment isn't available for lessons here. | الدفع الإلكتروني للحصص غير متاح هنا. |
| `HOURS_INVALID` | Each window has to start before it ends, within one day. | يجب أن تبدأ كل فترة قبل نهايتها ضمن اليوم نفسه. |
| `HOURS_OVERLAP` | These hours overlap other hours of this coach. | تتداخل هذه الساعات مع ساعات أخرى لهذا المدرّب. |
| `TIME_OFF_HAS_LESSONS` | The coach has lessons in that time. Cancel or move them first. | لدى المدرّب حصص في هذه الفترة. يلزم إلغاؤها أو نقلها أولًا. |
| `COURSE_STARTS_INVALID` | The course dates don't fit: one per session, each after the one before, all within a year. | مواعيد الدورة غير صالحة: موعد لكل حصة، كلٌّ بعد سابقه، وجميعها خلال سنة. |
| `SESSION_NOT_MOVABLE` | This session can't be moved any more. | لم يعد نقل هذه الحصة ممكنًا. |
| `COACH_ADD_LIMIT` | This coach has reached the limit on students they can add. | بلغ هذا المدرّب الحدّ المسموح لإضافة المتدرّبين. |
| `STATEMENT_NOT_DRAFT` | This statement isn't a draft any more. | لم يعد هذا الكشف مسودة. |
| `STATEMENT_NOT_APPROVED` | The statement has to be approved before it is marked paid. | يلزم اعتماد الكشف قبل تسجيل دفعه. |
| `STATEMENT_REFERENCE_REQUIRED` | Enter the payment reference. | يُرجى إدخال مرجع الدفع. |
| `REFUND_EXCEEDS_DUE` (new, Money 0278, R36) | That's more than is due back for this lesson. Refresh the list, or choose a goodwill refund to give more. | هذا أكثر من المستحق ردّه عن هذه الحصة. يُرجى تحديث القائمة، أو اختيار الرد بحسن نية لرد مبلغ أكبر. |

Widened existing lines: `BRANCH_HAS_BOOKINGS` "This branch still has bookings, lessons, holds or
series to come. Cancel or move them first." / "لا تزال لهذا الفرع حجوزات أو حصص أو حجوزات مؤقتة أو
سلاسل قادمة. ألغها أو انقلها أولًا." (0277); `PRICE_VIA_PROTOCOL` and `LAUNCH_VIA_PROTOCOL` name
lesson prices too (R14).

**Details** (`AppRpcError.details`, or the hint where the server sends one), read by the pure
`coachingErrorKey(error)` in `lessonLogic.ts`, which returns a `ws.coaching.errors.*` key when it
knows the detail and falls back to `errorToMessageKey`. Every detail an operator screen meets has its
own line (R52):

| Code · detail | EN | AR |
| --- | --- | --- |
| `NO_COURT_FREE`, `COACH_BUSY`, `COACH_UNAVAILABLE`, `SLOT_NOT_ON_GRID`, `SLOT_IN_PAST`, `CLOSED_DATE`, `OUTSIDE_HOURS` · a session number (course create) | "Session {n}: {the base line}" | "الحصة {n}: {السطر الأساسي}" |
| `COURSE_STARTS_INVALID` · `count` / `order` / `span` | "One date is needed for each of the {sessions}." / "Each session has to start after the one before ends." / "A course can't run longer than a year." | "يلزم موعد لكل حصة من {sessions}." / "يجب أن تبدأ كل حصة بعد انتهاء سابقتها." / "لا تتجاوز مدة الدورة سنة واحدة." |
| `LESSON_CLOSED` · `cutoff` (R47) | "That start is too close: its cut-off has already passed. Pick a later time." | "هذا الموعد قريب جدًا: فات موعد إغلاقه. يُرجى اختيار موعد لاحق." |
| `LESSON_NOT_CANCELLABLE` · `status` / `started` / `ended` / `course_session` / `private` | "This lesson is already cancelled or over." / "This lesson has started." / "The lesson, or the course's last session, has ended." / "A course session can't be cancelled alone. Move it, or cancel the course." / "Cancel the private lesson itself instead." | "هذه الحصة ملغاة أو منتهية." / "بدأت هذه الحصة." / "انتهت الحصة أو آخر حصص الدورة." / "لا تُلغى حصة من دورة وحدها. يمكن نقلها أو إلغاء الدورة." / "يُلغى بدلًا من ذلك الحصة الخاصة نفسها." |
| `SESSION_NOT_MOVABLE` · `ended` / `started` / `order` | "This lesson is cancelled or over." / "This lesson has started." / "A course session has to stay between the sessions before and after it." | "هذه الحصة ملغاة أو منتهية." / "بدأت هذه الحصة." / "يجب أن تبقى حصة الدورة بين الحصة السابقة واللاحقة." |
| `INVALID_TRANSITION` · `held` (reschedule, move court, R32) | "Waiting for the guest's online payment: it can be moved once paid." | "بانتظار دفع الزبون الإلكتروني، ويمكن نقلها بعد الدفع." |
| `INVALID_TRANSITION` · `ended` (move court) | "This lesson is over or cancelled, so its court can't change." | "انتهت الحصة أو أُلغيت، فلا يتغيّر ملعبها." |
| `INVALID_TRANSITION` · `not_started` / `marks_closed` / `not_booked` / `cancelled` (attendance) | the two §5.10.6 lines / "This student's sign-up isn't active." / "This lesson was cancelled." | السطران في §5.10.6 / "تسجيل هذا المتدرّب غير قائم." / "أُلغيت هذه الحصة." |
| `INVALID_TRANSITION` · `paid` (void) | "A paid statement can't be voided." | "لا يُلغى كشف مدفوع." |
| `LESSON_NOT_PAYABLE` · `held` / `expired` / `cancelled` / `lesson_cancelled` / `no_show` / `nothing_owed` | "The guest is paying online." / "This sign-up expired." / "This sign-up is cancelled." / "Every session of this sign-up was cancelled." / "This student was marked no-show." / "Nothing left to take for this student." | "الزبون يدفع إلكترونيًا." / "انتهت صلاحية هذا التسجيل." / "هذا التسجيل ملغى." / "أُلغيت كل حصص هذا التسجيل." / "سُجّل هذا المتدرّب غائبًا." / "لم يبقَ ما يُستلم عن هذا المتدرّب." |
| `HOURS_INVALID` · a window index | "{day}: each window has to start before it ends, on the half hour, by 24:00." | "{day}: يجب أن تبدأ كل فترة قبل نهايتها، على نصف الساعة، وحتى 24:00." |
| `HOURS_OVERLAP` · a window index or `"<index>:<weekday>"` | "{day}: these hours overlap the coach's hours here or at another branch." | "{day}: تتداخل هذه الساعات مع ساعات المدرّب هنا أو في فرع آخر." |
| `HOURS_OVERLAP` · `time_off` | "This overlaps time off already set." | "تتداخل هذه الفترة مع إجازة محدّدة سابقًا." |
| `TIME_OFF_HAS_LESSONS` · count | the §5.13.3 sentence with `{lessons}` | — |
| `PRICE_VIA_PROTOCOL` · `price`, `LAUNCH_VIA_PROTOCOL` on a lesson screen | "Lesson prices change through the owner's approval." | "تتغيّر أسعار الحصص بموافقة المالك." |
| `PRICE_VIA_PROTOCOL` · `shape` (R46) | "Make a new lesson type to change its length, sessions or party size." | "لتغيير المدة أو عدد الحصص أو عدد الأشخاص يلزم إنشاء نوع حصة جديد." |
| `PRICE_TARGET_CHANGED` · `lesson_type` / `coach_price` | "This lesson type changed after the proposal (price, length, sessions or party size). Start a new proposal." / "This coach's price or lessons changed after the proposal. Start a new proposal." | "تغيّر نوع الحصة بعد الاقتراح (السعر أو المدة أو عدد الحصص أو عدد الأشخاص). يلزم بدء اقتراح جديد." / "تغيّر سعر المدرّب أو حصصه بعد الاقتراح. يلزم بدء اقتراح جديد." |
| `ONLINE_PAYMENT_OFF` · `provider` / `terms` (settings) | the two §5.12 lines | — |
| `BRANCH_HAS_BOOKINGS` · a branch id (`set_coach_branches`) | the §5.13.1 line | — |
| `BRANCH_HAS_BOOKINGS` · `coaching_money` (`close_branch`, R37; `BranchesAdmin.tsx` `closeM.onError`) | "This branch still has coach statements to approve or pay, a month not drafted yet, or lesson money to refund at the desk. Settle them in Coach pay and Ops first." | "لا تزال لهذا الفرع كشوف مدرّبين للاعتماد أو الدفع، أو شهر لم يُعدّ كشفه، أو مبالغ حصص مستحقة الرد في الاستقبال. يلزم إنهاؤها من مستحقات المدرّبين والعمليات أولًا." |
| `FORBIDDEN` · `own_statement` | the §5.16 own-statement line | — |
| `STATEMENT_NOT_DRAFT` · `live_draft` | "This coach already has a draft for that month. Open it instead." | "لدى هذا المدرّب مسودة لذلك الشهر. يُرجى فتحها بدلًا من ذلك." |
| `STATEMENT_NOT_APPROVED` · `negative` (R59) | the §5.16 below-zero line | — |
| `INVALID_ARGUMENT` · `p_reference` / `p_reason` (statements, R49) | "A card or account number can't go here. Use a receipt or transfer number." | "لا يُكتب هنا رقم بطاقة أو حساب. يُرجى استخدام رقم الإيصال أو التحويل." |
| `PAYMENT_STATE` · `lesson_live` (Ops online refunds) | "This lesson is still on. Cancel the sign-up from the lesson's screen; its refund follows." | "لا تزال هذه الحصة قائمة. يُلغى التسجيل من صفحة الحصة، ثم يتبعه الرد." |
| `LESSON_VIA_COACHING` · `cancel` / `mark` / `extend` / `move` or `court_only` / `create` / `tab` / `held` or `confirm` | "Cancel a lesson from its own screen." / "Mark each student on the lesson's screen." / "A lesson's length can't change here. Reschedule it from its screen." / "Move a lesson's court from its own screen." / "Lessons are booked with New lesson." / "A lesson is paid on its own screen, not on a court bill." / "This hold is a lesson waiting for the guest's online payment." | "تُلغى الحصة من صفحتها." / "يُسجَّل حضور كل متدرّب من صفحة الحصة." / "لا تتغيّر مدة الحصة من هنا. يمكن تغيير موعدها من صفحتها." / "يُنقل ملعب الحصة من صفحتها." / "تُحجز الحصص من «حصة جديدة»." / "تُدفع الحصة من صفحتها، لا على فاتورة ملعب." / "هذا الحجز المؤقت حصة بانتظار دفع الزبون الإلكتروني." |
| `ALREADY_ENROLLED` · `coach` (desk book and add, C-24) | "That customer is the coach of this lesson." | "هذا الزبون هو مدرّب هذه الحصة." |
| `INVALID_ARGUMENT` · a settings or lesson-type key | the field's own error | — |

## 5.20 Strings

**Catalogs** (`packages/i18n/src/catalogs/ws/`), the open-matches layout (`ws/matches.en.ts:1-26`):
- `ws/coaching.en.ts` + `ws/coaching.ar.ts` (`DeepMessages<typeof coachingEn>`): the assembly,
  registered in `ws/index.ts` as `coaching` (`:70-125`); it owns `common` (lesson, kinds, statuses,
  cancel reasons, enrolment states, payment modes, booked-by words), `count` (plurals), `errors`
  (detail lines), `offline`, and spreads the three lane pairs;
- `ws/coachingDesk.{en,ar}.ts` → `coachingDesk`: groups `calendar`, `today`, `create`, `start`,
  `lesson`, `roster`, `pay`, `attendance`, `add`, `cancel`, `reschedule`, `events`, `customers`;
- `ws/coachingAdmin.{en,ar}.ts` → `coachingAdmin`: groups `coachesAdmin`, `lessonTypes`,
  `coachHours`, `settings`;
- `ws/coachingMoney.{en,ar}.ts` → `coachingMoney`: groups `coachPay`, `lessonRefunds`, `dayClose`,
  `reports`, `panel`;
- `opErrors.coaching.{en,ar}.ts` (§5.19);
- the shared glossary (R55, C-30): the Arabic lesson words come from one constants block,
  `packages/i18n/src/glossary/coaching.ar.ts`, imported by `ws/coaching*.ar.ts` and the phone's
  `coaching.*.ar.ts` alike;
- small keys in existing lanes: `ws.shell.nav.{coaches, coachPay}`; `ws.owner.setupHome.cards.coaches`,
  `ws.owner.financialHome.cards.coachPay` and their status lines; `ws.owner.panel.figures.{lessonRevenue,
  owedToCoaches}`; `ws.reports.courts.views.lessons`, `.lead.lessons`, the occupancy hint;
  `ws.reports.revenue.{lessons, owedToCoaches, owedToCoachesHint, columns.lessons}`;
  `ws.courtDesk.detail.kindLabel.lesson`; `ws.events.block.conflictKind.lesson`;
  `ws.kit.reservationKind.lesson`; `ws.protocols.fields.*` (§5.14.2); `work.protocol.change.*`
  (shared with the phone); `ws.tillShift.dayClose.crossDayCounted` (§5.18.1);
  `op.reasons.coach_unavailable` "Coach unavailable" / "المدرّب غير متاح", `op.reasons.lesson_refund`
  "Lesson refund" / "رد مبلغ حصة", `op.reasons.lesson_goodwill` "Goodwill refund" / "رد بحسن نية"
  (`en.ts:1201-1220`); the widened `op.errors.BRANCH_HAS_BOOKINGS`.

The group names are the second key segment the assistant map routes on: `calendar`, `today`,
`customers`, `settings`, `dayClose`, `reports` and `panel` already route through `LABEL_ROUTE_HINTS`
(`build-assistant-map.mjs:548-556`); `coachesAdmin`, `lessonTypes`, `coachHours` (`/admin/coaches`),
`coachPay` (`/reports/coaches`) and `lessonRefunds` (`/ops`) are added there. No group is named
`hours`, which would route to `/admin/hours`.

**Terms (DRAFT-AR, client review).** From the shared glossary (R55, binding): lesson «حصة», court
share «أجرة الملعب», coach's share «نصيب المدرّب». This lane's: coach مدرّب (f مدرّبة); private lesson
حصة خاصة; group session حصة جماعية; course دورة; session حصة (الحصة 3 من 8); lesson type نوع الحصة;
student متدرّب; place مكان; sign-up تسجيل; owed to coaches مستحق للمدرّبين; statement كشف; coach pay
مستحقات المدرّبين; cut-off موعد الإغلاق; time off إجازة; hours ساعات العمل; walk-in زبون عابر
(`ws/courtDesk.ar.ts:40`); the desk الاستقبال, the till الصندوق. «درس» is not used anywhere.

**Status labels:** lesson `held` "Awaiting payment" / "بانتظار الدفع", `scheduled` "Booked" /
"محجوزة", `completed` "Done" / "انتهت", `cancelled` "Cancelled" / "ملغاة", `expired` "Not confirmed" /
"لم تُؤكَّد"; course `open` "Open" / "مفتوحة", `running` "Running" / "جارية", `completed` "Finished" /
"انتهت", `cancelled` "Cancelled" / "ملغاة"; enrolment `booked` "Signed up" / "مسجّل", `held`
"Awaiting payment" / "بانتظار الدفع", `cancelled` "Cancelled" / "ملغى", `expired` "Not paid in time"
/ "لم يُدفع في الوقت"; coach status as §5.13.1; statement status as §5.16.

**Plurals** (`countPhrase` / `pluralForm`, `packages/i18n/src/plural.ts`), keys
`ws.coaching.count.<noun>.{zero,one,two,few,many,other}` (EN repeats `one`/`other`):

| Noun | AR one · two · few · many · other · zero |
| --- | --- |
| `lessons` | حصة واحدة · حصتان · {count} حصص · {count} حصة · {count} حصة · لا حصص |
| `students` | متدرّب واحد · متدرّبان · {count} متدرّبين · {count} متدرّبًا · {count} متدرّب · لا متدرّبين |
| `places` | مكان واحد · مكانان · {count} أماكن · {count} مكانًا · {count} مكان · لا أماكن |
| `sessions` | حصة واحدة · حصتان · {count} حصص · {count} حصة · {count} حصة · لا حصص |
| `coaches` | مدرّب واحد · مدرّبان · {count} مدرّبين · {count} مدرّبًا · {count} مدرّب · لا مدرّبين |

`lessons` and `sessions` share their Arabic forms and keep separate keys (English differs).
Everything else uses label and figure ("Places 4 of 6", "To pay 2").

**Arabic rules** (the R38 rules of the open-matches build): Latin digits through
`formatNumber`/`formatIQD`; buttons are verbal nouns (حجز، إنشاء، إضافة، استلام، تسجيل، إلغاء، نقل،
تغيير، اعتماد، طرح، اقتراح), never imperatives; staff are addressed without gendered verbs (يلزم،
يُرجى، يمكن + noun, passives); `isolateLtr` on "4/6", "+2" and counts; `isolate` on names. «حصة» is
feminine: verbs and adjectives agree (حُجزت، أُلغيت، محجوزة). A coach or student in the third person
uses the masculine form in v1 (no gender is stored for either); the client may ask for feminine
variants at review. Every Arabic string of this lane is marked DRAFT-AR in a comment block at the top
of each `.ar.ts` file.

## 5.21 Pure logic and tests

**Pure modules with node tests** (`*.test.ts`):

| Module | Functions |
| --- | --- |
| `op/features/coaching/lessonLogic.ts` | `LESSON_RESERVATION_NAME`, `lessonsByReservation`, `lessonLabel`, `lessonPlacesChip`, `lessonPayState` (owing, all paid, online, the C-24 coach-booked flag), `cutoffState` (under minimum before the cut-off, against `server_now`), `lessonBannerKey`, `eventKey` (with `late`), `rosterName(e)` (R44), `enrolmentLine`, `enrolmentActionsOf(e, lesson, reachable, caps)`, `refundsForLesson`, `coachingErrorKey`, `COACHING_CANCEL_CODES` |
| `op/features/coaching/startLessonLogic.ts` | `kindsOnSale`, `coachesFor(type)`, `gridStarts`, `slotChoice(slots, pressed)`, `cutoffPassed(start, cutoffHours, serverNow)` (R47), `weeklyStarts(firstDate, hhmm, count, tz)`, `startsErrors` (`count`, `order`, `span`, grid, past), `startDraftErrors`, `startArgs` (per kind) |
| `op/features/coaching/lessonPayloads.ts` | `readDeskLessons`, `readLessonDetail`, `readCustomerLessons`, `readCoachesAdmin`, `readCoachingSettings`, `readSlots`, `readRefundsDue`, `readStatements`, `readStatementDetail`, `readLessonsReport`, each over its `COACHING_SHAPES` list (R41) |
| `op/features/reports/coaches/statementsLogic.ts` | row order, totals, `missingRows`, `statementActions(statement, caps, railBranch)` (other-branch rows read-only, R21; own statement read-only; no PIN to approve; a PIN to void from `approved`; Mark paid off below zero, R59), `referenceErrors` (1..80; no run of 12 or more digits, R49), month stepper bounds |
| `op/features/admin/coaches/coachesLogic.ts` | promote draft and args, coach patch (changed keys), branch and type diffs (with the coach-price warning, R46), acceptance state (R61), retire confirm copy (R45) |
| `op/features/admin/coaches/lessonTypeLogic.ts` | draft (a new group or course type starts at a 2-hour cut-off), patch, `lessonTypeDraftErrors` (§1.2 CHECKs and `lesson_types_cutoff`, R26), `priceLock(type, caps)` (R46 shape fields), `draftCopyOf(type)` (Make a new lesson type…), launch path |
| `op/features/admin/coaches/coachHoursLogic.ts` | windows by weekday, half-hour options with 24:00, `hoursErrors`, overlap with `hours_elsewhere` as a warning, `overlapWindow(detail, sentWindows)`, `toWindows`, time-off checks |
| `op/features/admin/settings/coachingSettingsLogic.ts` | draft, patch, field errors, percent ↔ basis points, server key → field, `onlineModeBlock(settings)` (provider, terms), `coach_max_open_private` bounds |
| edits | `deskLogic.ts` (`nightSummary.lessons`, `courtAvailability` kind), `deskStatus.tsx` (`reservationBlockTone` in a `.ts` sibling if needed), `observeLogic.ts` (`lessons`), `dayCloseLogic.ts` (`lessons` group on Money's keys, `onlineLabelKey`, the cross-day sentence by `refunds_dated_by_shift`), `reportPayloads.ts` (`readCourts` lessons block and per-court lesson minutes, `lessonIqd`, `owedToCoachesIqd`), `panel/figures.ts` (lessons group), `protocols/priceTargets.ts`, `protocols/contextLogic.ts`, `protocols/search.ts`, `promotions/priceChange.ts`, `tasks/fieldLabels.ts`, `matchLogic.ts` (`reservationNameOf`), `till/NewTabDialog.tsx` (`tillMayBill`), `till/ManagerActions.tsx` (`refundCap(payment, dueIqd, goodwill)`), `lib/storage.ts` (`mediaPath('coaches')`, `isMediaPath`), `queueResults.ts`, `auth.ts` |

Cases that must exist: `lessonLabel` for each kind, with no lesson row, in Arabic, and for a
coach-booked private lesson (the recorded name, R44); `rosterName` and `enrolmentActionsOf` for a
guest-booked row, a desk-typed row, a confirmed match and an unconfirmed match (no Open customer,
C-21); `weeklyStarts` across a month end and for 2 and 52 sessions; `startsErrors` for each detail;
`slotChoice` with the pressed time in and out of the slots; `cutoffPassed` at, before and after;
`enrolmentActionsOf` before and after the start, after 24 h, offline, without each capability, for an
online enrolment (no Take payment) and a cancelled one; `cutoffState` at, before and after the
cut-off; `lessonPayState` with the C-24 flag; `priceLock` for each row of §5.13.2 (a launched private
type's party size read-only for a manager, a group type's places editable, the Active switch direct);
`lessonTypeDraftErrors` refusing a 0-hour cut-off with a minimum above 1; `hoursErrors` with 24:00,
an inverted window and an overlap; `overlapWindow` for both detail forms and `time_off`;
`statementActions` per status, without `settleCoaches`, for another branch's row, for the caller's own
statement, below zero, and a void from `approved` asking a PIN; `referenceErrors` refusing
"4111 1111 1111 1111" and a 12-digit run, accepting an 11-digit one; `coachingErrorKey` for every
detail row of §5.19; `onlineModeBlock` with no provider, no terms, and both; `mediaPath('coaches', …)`
returning a new random folder on every call and never an owner id, and `isMediaPath` accepting it;
`refundCap` capped at the due, lifted by goodwill; `readDayCloseOnline` on Money's lesson keys, and a
lesson refund made on day 2 of a day-1 payment showing on day 2's `desk_refunded_iqd` (the operator
half of R27's test); `canMoveReservation` false for a lesson; `isFirm` true for a live lesson;
`nightSummary` with lessons; `courtDaySummary` counting lessons apart from blocks; `tillMayBill` false
for a lesson; `reservationNameOf` on the `'Lesson'` literal; `queueResults.test.ts` registry keys (no
coaching key on `reservation.update`); `persist.test.ts` (`shouldPersistQuery` false for every
`['coaching', …]` key, P15); `auth.test.ts` (the four capabilities and their roles;
`takeLessonPayment` includes cashier, excludes shop_staff); `errors.test.ts` (both catalogs); core
`protocols.test.ts` (the three kinds, marketing excluded, `before` replaced at submit);
`lessonPayloads.test.ts` (every parser reads exactly its `COACHING_SHAPES` list, fixtures built from
the lists); `op/features/coaching/rpcCallers.test.ts` (every coaching RPC the operator calls is called
by its literal name and never with a type argument, the `matches/rpcCallers.test.ts` copy over the
§5.7 and §5.6 names); a token test `op/lib/tokens.test.ts` asserting that every `--tp-lesson*` name in
`operator.ts` has a value in `operatorBlue.ts`.

**jsdom** (`*.test.tsx`): `coaching/LessonDetail.test.tsx` (every banner including `coach_retired`,
course strip, not found, a held lesson's Reschedule and Move court disabled, the C-24 flag, redirect
from a lesson row in `BookingDetail`), `coaching/LessonRosterPanel.test.tsx` (rows and money lines;
a desk-typed row shows the typed name even when linked, no Open customer for an unconfirmed match;
the course-leave kept line; optimistic Arrived and Undo; No-show disabled before the start; Take
payment opens the pane with due = `take_iqd` and `allowPartial` false; `LESSON_OWED_CHANGED` keeps the
pane with the new due; cancel sends `<code>: <note>`; offline disables every control with the reason;
AR render `dir="rtl"` with Latin digits and «حصة»), `coaching/StartLessonDialog.test.tsx` (kinds,
slots from `starts[]`, weekly starts and an edited row, the cut-off refusal, the staging line with
coaching off, the court-picked toast), `coaching/AddStudentDialog.test.tsx`,
`reports/coaches/CoachStatements.test.tsx` (approve with no PIN; Mark paid sends `p_reference`,
`p_pin`, `p_device_id` and refuses a 12-digit reference; Mark paid disabled below zero; void from
`approved` asks the PIN, from `draft` does not; the own-statement line; other-branch rows read-only;
`missing` rows; coach-booked no-shows; adjustment lines), `ops/LessonRefundsDuePanel.test.tsx`
(`hideWhenEmpty`; Refund opens `RefundDialog` with the payment, capped at the due; goodwill lifts the
cap and sends `lesson_goodwill`; a course-leave row), `admin/coaches/CoachesAdmin.test.tsx` (Make a
coach with a picked customer and a random-folder photo path; the waiting-to-accept badge; retire
confirm names the count and is never refused; an account-deleted row), `admin/coaches/LessonTypesTab.test.tsx`
(manager: draft price editable, launched price read-only with Propose a price linking
`/protocols?start=price_promo&change=lesson_price&lessonType=`, duration read-only with Make a new
lesson type…, the Active switch saves directly; owner edits and launches directly),
`admin/coaches/CoachHoursTab.test.tsx` (24:00, copy to every day, other-branch hint, time off refusal),
`admin/settings/CoachingSettingsPanel.test.tsx` (owner, manager, online modes disabled with the
provider and terms reasons, `coach_max_open_private` bounds, field error); and the existing
`desk/deskDialogs.test.tsx` (Lesson kind hands over, coaching on or off; the actions dialog's lesson
branch shows only Open lesson, for a lesson row and a held lesson's hold row), `desk/TodaysBoard.test.tsx`
(Lessons today rows and states; a lesson row offers Open lesson, not Mark arrived),
`desk/customers/CustomerRecord.test.tsx` (coach badge, Make coach, Lessons panel, Take payment for a
cashier), `admin/DayClose.test.tsx` (lessons group; the cross-day sentence for a day dated by shift
and for an older day), `admin/branches/BranchesAdmin.test.tsx` (the `coaching_money` line on close),
`reports/CourtsReport.test.tsx` (Lessons view, compare disabled, occupancy hint),
`reports/ReportScreens.test.tsx` (Lessons and Owed to coaches figures), `panel/ManagementPanel.test.tsx`
(lessons group), `deposits/DepositPanels.test.tsx` (a lesson refund row; `PAYMENT_STATE lesson_live`),
`protocols/ProtocolsPage.test.tsx` (a lesson price start prefilled from the link;
`PRICE_TARGET_CHANGED` `lesson_type`).

## 5.22 e2e (`e2e/tests/operator-coaching.spec.ts`, EN and AR projects, `e2e/playwright.config.ts:52-65`)

Setup (`beforeAll`): `ensureTillFresh`, `ensureOpenDay` (`e2e/tests/helpers.ts:115,155`),
`enableCoaching`, `seedCoach`, `seedLessonTypes`, `cleanE2eLessons`. `afterAll` switches coaching off
and cleans. Lesson times are tomorrow unless a journey backdates one. Desk-typed names carry no
digits (`sanitizeName`). Journeys 7–12 are R58's (the privacy review's G6); the web `/coaching` page's
`site-coaching.spec.ts` is the Guest lane's.

| # | Journey |
| --- | --- |
| 1 | Manager: `/admin/coaches` › Make a coach, search the seeded guest "Playwright Coach Bravo", display names EN and AR, bio, a photo (its stored path is `coaches/<uuid>/<uuid>.<ext>` and not the profile id), this branch, the private type → the row reads "Active", "Waiting for the coach to accept" and "No hours yet". Hours: Sunday to Saturday 09:00–23:00, Save → "Set at the desk by …". Lesson types: the launched private type's price is read-only with "Propose a price", which lands on `/protocols` with "Change a lesson price" and the type picked; its duration is read-only with "Make a new lesson type…". |
| 2 | court_desk: calendar › tomorrow, press a free 10:00 slot, choose Lesson, Private lesson, Coach Alpha, the 10:00 slot, typed walk-in "Playwright Student Alpha" with a phone → Create → the lesson screen, title "… · Coach Alpha", the roster row "To pay 30,000". Back on the calendar the block found by "Coach Alpha" has no grip; pressing it shows only Open lesson. |
| 3 | A seeded private lesson started 30 minutes ago: court_desk opens it from Today's "Lessons today", marks the student Arrived, Take payment (cash, 50,000 handed over) → "Took 30,000 … Change 20,000"; the row reads "Paid at the desk 30,000"; the Today row reads "All paid". |
| 4 | Group: court_desk creates a group session tomorrow at 18:00, adds a directory customer and a typed walk-in; the walk-in's sign-up is cancelled with "Customer request" → "Cancelled" under Earlier; Cancel lesson with "Coach unavailable" → the banner "Cancelled at the desk…"; the calendar block is gone. A second group session placed inside its 2-hour cut-off is refused with the cut-off line. |
| 5 | Course: court_desk creates a four-session course, changes session 3's date by a day, creates → the course strip lists four sessions; Reschedule session 2 → its chip shows the new time; Reschedule the private lesson of journey 2 by an hour → its block moves; Cancel the course → every session reads Cancelled. |
| 6 | Money: a seeded desk-paid enrolment, then cancelled by the desk → the manager sees "Lesson refunds due" on `/ops`; Refund offers at most the due; Refund with the manager PIN → the row is gone; the day close's Lessons group shows it under "Refunded at the desk today". Statements: the service client drafts last month's statements (`app.coach_statements_draft`); the manager opens `/reports/coaches`, steps back a month, opens Coach Alpha's draft, Approve (no PIN), Mark paid with a 12-digit reference → refused with the card-number line, then "E2E REF" and the PIN → "Paid". |
| 7 | Price approval (R58): the manager proposes a new price for the launched private type (`lesson_price`) and puts a draft group type on sale (`lesson_launch`); the owner decides the `lesson_price` run under "Waiting on you" in the operator; the `lesson_launch` run's decide step is sent from the owner's client exactly as the staff phone sends it (the phone's rendering of that step is its `test:smoke` case, §5.14.3); after the apply the private type shows the new price and the group type reads "On sale". |
| 8 | Cashier (R20, R58): a seeded guest with an account owes a desk-mode group place; the cashier opens `/desk/customers`, the record's Lessons panel, Take payment (card) → "Paid at the desk"; `/desk/lessons/$id` is not reachable for the cashier. |
| 9 | A manager who coaches (CM-11, R58): the seeded manager account is promoted to coach (`seedCoach(svc, 'M', { staff: 'manager' })`); a drafted statement of theirs opens with "This is your own statement…" and no actions; a direct `coach_statement_approve` from that manager's client answers `FORBIDDEN` detail `own_statement`. |
| 10 | Staging with coaching off (R51, R58): `enableCoaching(svc, { enabled: false })`; court_desk books a private lesson from the calendar: the Lesson kind is offered, slots come back, the dialog shows "Lessons are switched off at this branch…", Create lands on the lesson screen. |
| 11 | Retiring a coach with lessons (C-25, R45, R58): Coach Charlie has a desk-booked private lesson and a group session with a desk-paid student; the manager retires Charlie → the confirm names "2 lessons", Retire succeeds (never refused) → the row reads "Retired"; both lessons read "Cancelled because the coach was retired…"; "Lesson refunds due" lists the desk-paid student. |
| 12 | Online payment through the fake provider (R58): `setLessonTerms(svc)`, the owner sets "At the desk or online"; a seeded guest pays a private lesson online (`payLessonOnline`) → the desk's lesson screen reads "Paid online" with no Take payment; the day close's Lessons group shows "Paid online"; the desk cancels the lesson → the banner says online money is refunded and Ops' online refunds lists "Lesson refund · …" until the fake provider settles it. |
| 13 | `@ar`: journeys 2 and 3 condensed in Arabic: the §5.9–§5.10 Arabic labels («حصة جديدة»، «فتح الحصة»), `dir="rtl"`, amounts in Latin digits. |

Helpers in `e2e/tests/helpers.ts` (service role unless said): `enableCoaching(svc, { enabled?, mode? })`
(the owner client calls `set_coaching_settings`); `setLessonTerms(svc)` (sets
`platform_settings.lesson_terms_version` and the seeded guests' accepted version); `seedCoach(svc,
letter, { staff? })` (a guest account `e2e-coach-<letter>@dev.touch.local` through
`svc.auth.admin.createUser`, or the seeded staff account, reused on rerun; the owner client calls
`coach_promote`, `set_coach_lesson_types`, `set_coach_hours` 08:00–24:00 every day; the coach's client
calls `coach_accept_public` except for journey 1's coach); `seedLessonTypes(svc)` (owner client: a
private 60-minute type at 30,000 with a 10,000 court share, a group type 2–8 places with a 2-hour
cut-off, a four-session course; each launched directly; plus one draft group type for journey 7);
`seedPrivateLesson(opts)` through `desk_book_lesson` as the desk; `backdateLesson(svc, lessonId,
minutesAgo)` (moves the lesson's and its reservation's times, since a lesson cannot be booked in the
past); `payLessonOnline(svc, guest, opts)` (the `grantTickets` sequence: the guest's client books
`lesson_book_private` online, then `lesson_payment_prepare(…, 'fake')`, `deposit_mark_created` and a
SUCCESS through `deposit_apply`); `cleanE2eLessons(svc)` (cancels leftover lessons and courses of the
e2e coaches as the manager, and un-retires Charlie with `coach_promote` on the next run).

## 5.23 Assistant map, docs, HANDOFF

- `packages/db/scripts/build-assistant-map.mjs`: `FEATURE_ROUTE` (`:501-508`) gains
  `coaching: '/desk'`; `CATALOG_FILE_ROUTE` (`:557`) gains `coaching: '/desk'`; `CATALOG_FILE_MOUNT`
  (`:559`) gains `coachingDesk`, `coachingAdmin`, `coachingMoney` → `'coaching'`; `LABEL_ROUTE_HINTS`
  (`:548-556`) gains `coachesAdmin`, `lessonTypes`, `coachHours` → `/admin/coaches`, `coachPay` →
  `/reports/coaches`, `lessonRefunds` → `/ops`. `routeOfFile` routes an RPC caller by its feature
  folder (`:538-543`), so every panel that lives on another page sits in its host folder, as the
  open-matches panels do: `features/admin/coaches/` and `features/admin/settings/` (`/admin`),
  `features/desk/customers/` (`/desk`), `features/reports/coaches/` (`/reports`, the statements
  screen), `features/ops/LessonRefundsDuePanel.tsx` (`/ops`); everything in `features/coaching/` is
  the desk's.
- `packages/db/fixtures/assistant-coverage.json`: `routes` gains `"/admin/coaches": "map:page"`.
  Function entries for every coaching RPC ship with the migrations that create them (their lanes);
  `coach_statements` and `coach_statement_lines` are `excluded` (DB's entries, R42). Every
  `docs/design/coaching/` file already has its entry (R53); if the milestone flips the build
  contracts to `index:doc`, that rides commit (g) with `assistant:map`.
- **Coach pay never reaches an LLM (C-28, R42).** No assistant tool names `report_coach_statements`
  or `report_lessons` (`tests/assistant-catalog.test.ts` asserts it); the pages.md lines below name
  those RPCs for navigation only. `check-analytics-payload.mjs`'s `PERSON_MONEY_REPORTS` is the DB
  and Money lanes' edit.
- `docs/design/assistant/pages.md`, each sentence extended with what the code does:
  - `/desk` (`:24`): "… The booking dialog's 'Lesson' kind opens 'New lesson' (app.desk_book_lesson,
    app.desk_create_group, app.desk_create_course, slots from app.coach_slots), also while lessons are
    switched off; lesson blocks name the coach and places (app.desk_lessons) and open only 'Open
    lesson'.";
  - `/desk/today` (`:25`): "… A 'Lessons today' group (app.desk_lessons) lists the day's lessons with
    places and what is still to pay, 'Take payment', 'Open' and 'New lesson'.";
  - `/desk/customers` (`:26`): "… A record shows a 'Coach' badge, 'Make coach' for managers, 'Book a
    lesson' and a 'Lessons' panel (app.customer_lessons) with 'Take payment' (app.lesson_settle); in
    attach mode 'Add to the lesson' hands the customer back to a lesson.";
  - new line `/desk/lessons/$id`: "One lesson, group session or course session
    (app.desk_lesson_detail): 'Move court' (app.desk_move_lesson_court), 'Reschedule'
    (app.desk_reschedule_session), 'Cancel lesson' or 'Cancel the course' (app.desk_cancel_lesson,
    app.desk_cancel_course); the roster with 'Arrived', 'No-show' and 'Undo'
    (app.desk_mark_attendance), 'Take payment' (app.lesson_settle), 'Cancel' a sign-up
    (app.desk_cancel_enrolment) and 'Add student' (app.desk_add_student); for a manager, 'Refunds due
    at the desk' (app.lesson_refunds_due) with 'Refund' through the till's refund; then the history.
    Online only.";
  - new line `/admin/coaches`: "The 'Coaches' screen in three tabs (app.coaches_admin): Coaches ('Make
    a coach' through app.coach_promote; names, bio and photo through app.coach_update; branches,
    lesson types, per-coach prices for the owner through app.set_coach_price, Pause, Resume and Retire
    through app.set_coach_status; a coach not yet accepted reads 'Waiting for the coach to accept'),
    Lesson types (drafts saved with app.upsert_lesson_type; for a manager a launched price shows
    'Propose a price', a launched length 'Make a new lesson type…' and a draft 'Put on sale', each
    price a price or promo change on /protocols) and Hours (weekly windows through
    app.set_coach_hours, time off through app.add_coach_time_off and app.cancel_coach_time_off).";
  - new line `/reports/coaches`: "'Coach pay' (app.report_coach_statements): one statement per coach
    for a month with collected, court share, coach's share and to pay; a statement
    (app.coach_statement_detail) offers 'Recount', 'Approve', 'Void' (a manager PIN once approved) and
    'Mark paid' with a reference and a manager PIN (app.coach_statement_mark_paid). The money is
    handed over outside the till.";
  - `/ops` (`:42`): "… 'Lesson refunds due' (app.lesson_refunds_due) offers 'Refund' through the
    till's refund, up to what is due; online refunds include lesson refunds.";
  - `/reports/courts` (`:56`): "… A 'Lessons' view reads app.report_lessons, with no court filter or
    compare; occupancy counts lesson time.";
  - `/reports/revenue` (`:55`): "… Earned includes 'Lessons' and 'Owed to coaches'.";
  - `/admin/day-close` (`:60`): "… the card adds the day's lesson money: online, kept, at the desk,
    refunds made today, refunds due and owed to coaches.";
  - `/admin/settings` (`:115`): "… and the lessons panel (app.set_coaching_settings, owner only: lessons
    on or off, how lessons are paid (online only once the lessons terms are live), the coach's share,
    prices on the website and how many private lessons a coach may hold).";
  - `/panel` (`:46`): "… a 'Lessons' group (lesson revenue, owed to coaches).";
  - `/setup` (`:102`) and `/financial` (`:53`): their new cards.
- `docs/design/assistant/rules.md`, two sections (each names its source): "## Lesson money is its own
  revenue line, and coaches are paid outside the till" (C-6, C-12, C-18: collected less the court
  share, the coach's share of the rest, statements approved and marked paid with a reference and a
  manager PIN, no till movement); "## Lesson prices go through the owner" (C-5, C-17, R46: venue
  prices per type with an optional per-coach price, drafts edited directly, every launched price,
  court share, shape and coach price through a price or promo change).
- Tool catalog: if Money adds the `lessons` block to `report_courts` and `lessonRevenue` to
  `report_revenue` / `panel_headline`, those tool descriptions say so (aggregates only, C-28), in both
  byte-identical copies (`packages/core/src/assistant/tools.ts`,
  `packages/db/supabase/functions/_shared/assistant/tools.ts`), in the operator commit.
- Regenerate with `pnpm --filter @touch/db assistant:map` in the operator commit:
  `packages/db/fixtures/assistant-map.json`, `packages/db/supabase/functions/_shared/assistant/map.json`,
  `packages/db/fixtures/assistant-map-compact.md`.
- `HANDOFF.md` scope ledger, one row after "Open matches online-only (DF-11)" (`:2270`): `| Coaching
  online-only (CD-6) | Every coaching write is a direct appRpc call, never a queued type: the desk's
  desk_book_lesson, desk_create_group, desk_create_course, desk_add_student, desk_cancel_enrolment,
  desk_cancel_lesson, desk_cancel_course, desk_reschedule_session, desk_move_lesson_court,
  desk_mark_attendance, lesson_settle; setup's coach_promote, coach_update, set_coach_status,
  set_coach_branches, set_coach_lesson_types, upsert_lesson_type, set_coach_price, set_coach_hours,
  add_coach_time_off, cancel_coach_time_off, set_coaching_settings; the statement actions; and every
  guest and coach-mode RPC. A refund of desk lesson money is the till's queued payment.refund, capped
  at what is due (coaching operator contract §5.5, R36) | Queued lesson payments and marks | Later
  phase (full offline DB, SOW) |`.

## 5.24 Files touched

New, `apps/operator/src/`:
- `features/coaching/`: `useCoaching.ts` (+ test: `useDeskLessons`, `useLessonDetail`,
  `useCustomerLessons`, `useCoachesAdmin`, `useCoachingSettings`, `useCoachSlots`, `useRefundsDue`,
  `useCoachingCaps`, `useLessonIdemKey`, `invalidateLesson*`), `lessonLogic.ts` (+ test),
  `startLessonLogic.ts` (+ test), `lessonPayloads.ts` (+ test), `rpcCallers.test.ts`, `LessonBadge.tsx`,
  `LessonPlacesChip.tsx`, `LessonPayCell.tsx`, `LessonReadNotice.tsx`, `LessonSummary.tsx`,
  `StartLessonDialog.tsx` (+ test), `LessonDetail.tsx` (+ test), `LessonRosterPanel.tsx` (+ test),
  `AddStudentDialog.tsx` (+ test), `RescheduleDialog.tsx`, `MoveCourtDialog.tsx`,
  `LessonsTodayPanel.tsx`, `CustomerLessonsPanel.tsx`, `CoachBadge.tsx`;
- `features/reports/coaches/`: `CoachStatements.tsx` (+ test), `StatementDialog.tsx`,
  `MarkPaidDialog.tsx`, `VoidStatementDialog.tsx`, `statementsLogic.ts` (+ test), `statementKeys.ts`;
- `features/ops/LessonRefundsDuePanel.tsx` (+ test);
- `features/admin/coaches/`: `CoachesAdmin.tsx` (+ test), `CoachesTab.tsx`, `CoachEditor.tsx`,
  `PromoteCoachDialog.tsx`, `LessonTypesTab.tsx` (+ test), `LessonTypeEditor.tsx`, `CoachHoursTab.tsx`
  (+ test), `coachesLogic.ts` (+ test), `lessonTypeLogic.ts` (+ test), `coachHoursLogic.ts` (+ test);
- `features/admin/settings/`: `CoachingSettingsPanel.tsx` (+ test), `coachingSettingsLogic.ts` (+ test);
- `routes/admin/coaches.tsx`; `lib/tokens.test.ts`.

Edited, `apps/operator/src/`:
- desk: `features/desk/deskTypes.ts`, `deskStatus.tsx`, `deskLogic.ts` (+ test), `DeskCalendar.tsx`,
  `TodaysBoard.tsx` (+ test), `BookingDetail.tsx`, `ReservationActionsDialog.tsx`,
  `CreateReservationDialog.tsx`, `deskDialogs.test.tsx`, `CourtBlock.tsx`, `useTradingNight.ts`;
- customers: `features/desk/customers/CustomerRecord.tsx` (+ test), `CustomerSearch.tsx`,
  `CustomerCreate.tsx`;
- till: `features/till/FloorView.tsx` (court board drops lessons), `features/till/NewTabDialog.tsx`,
  `features/till/ManagerActions.tsx` (`RefundDialog` `dueIqd` and the goodwill toggle, R36);
- observation and floor: `features/observation/courts/CourtsObserve.tsx`,
  `features/observation/observeLogic.ts` (+ test), `features/floor/floorData.ts`;
- matches: `features/matches/matchLogic.ts` (+ test; `reservationNameOf`);
- money and reports: `features/admin/DayClose.tsx` (+ test), `DayCloseOnline.tsx`, `dayCloseLogic.ts`
  (+ test), `features/reports/CourtsReport.tsx` (+ test), `RevenueReport.tsx`, `reportPayloads.ts`
  (+ test), `features/panel/figures.ts` (+ test), `ManagementPanel.tsx` (+ test),
  `features/financial/FinancialHome.tsx`, `features/ops/OperationsOverview.tsx`,
  `features/deposits/DepositAttentionPanel.tsx`, `depositAttentionLogic.ts` (+ test), `depositApi.ts`;
- setup: `features/admin/SetupHome.tsx`, `features/admin/settings/VenueDetailsTab.tsx`,
  `features/admin/branches/BranchesAdmin.tsx` (+ test; the `coaching_money` line, R37);
- protocols: `features/protocols/search.ts` (+ test), `priceTargets.ts` (+ test), `StepForm.tsx`,
  `contextLogic.ts` (+ test), `RecordView.tsx`, `features/admin/promotions/priceChange.ts`,
  `features/tasks/fieldLabels.ts`, `features/tasks/priceLogic.ts` (+ test);
- components: `components/icons.tsx` (`whistle`), `components/ui.tsx` (`COACHING_REASON_CODES`,
  `LESSON_REFUND_REASON_CODES`, `ReasonCode`);
- lib: `lib/auth.tsx` (+ test), `lib/workspaces.ts` (+ test), `lib/queryKeys.ts`, `lib/queueResults.ts`
  (+ test), `lib/storage.ts` (+ test; `MediaFolder`, `mediaPath`, `isMediaPath`), `lib/persist.test.ts`
  (the P15 case; `persist.ts` itself is unchanged);
- routes: `routes/desk/_children.ts`, `routes/admin/_children.ts`, `routes/reports/_children.ts`.

Elsewhere:
- `packages/ui/src/tokens/operator.ts`, `operatorBlue.ts` (the two tokens);
- `packages/core/src/protocols/types.ts`, `steps.ts`, `validate.ts`, `protocols.test.ts`, `index.ts`;
- `packages/core/src/coaching/shapes.ts`: the entries of the reads and write results this lane
  renders (§5.6, §5.7), in the shared file (R41);
- `packages/i18n/src/catalogs/ws/coaching.{en,ar}.ts`, `coachingDesk.{en,ar}.ts`,
  `coachingAdmin.{en,ar}.ts`, `coachingMoney.{en,ar}.ts` (new), `ws/index.ts`, `ws/shell.*`,
  `ws/owner.*`, `ws/reports.*`, `ws/courtDesk.*`, `ws/events.*`, `ws/kit.*`, `ws/protocols.*`,
  `ws/tillShift.*` (`crossDayCounted`), `work.{en,ar}.ts`, `en.ts`, `ar.ts` (`op.reasons.*`, the
  widened `BRANCH_HAS_BOOKINGS`, the opErrors spread); `packages/i18n/src/glossary/coaching.ar.ts`
  (R55, shared with the Guest lane: whichever lands first creates it); `opErrors.coaching.{en,ar}.ts`
  and the `ERROR_CODE_KEYS` rows land with the migrations (§5.19);
- staff phone: `apps/mobile/app/staff-start.tsx`, `apps/mobile/src/features/staff/protocols/logic.ts`,
  `labels.ts`, `types.ts`, `useStepReads.ts` and their tests, plus the lesson-run smoke case;
- `e2e/tests/operator-coaching.spec.ts` (new), `e2e/tests/helpers.ts`;
- `packages/db/scripts/build-assistant-map.mjs`, `packages/db/fixtures/assistant-coverage.json`, the
  three map files, `docs/design/assistant/pages.md`, `docs/design/assistant/rules.md`, both
  `tools.ts` copies (if §5.23's condition holds), `HANDOFF.md`.

Written by other lanes, relied on here: `PIN_GATED_RPCS` + `coach_statement_mark_paid` and
`coach_statement_void` in every copy (`packages/core/src/schemas/mutations.ts:49-59`,
`_shared/mutation-types.json` `pinGatedRpcs`, `packages/db/tests/helpers.ts`), with the migration
that creates the RPC; every §1.7 RPC in `types.gen.ts`; the `ERROR_CODE_KEYS` rows and catalog lines
with the SQL that raises them (`REFUND_EXCEEDS_DUE` with Money's `app.refund` re-issue); the DB test
that asserts each RPC against `COACHING_SHAPES`.

Not touched: `lib/venueScope.ts`, `lib/queries.ts` (no new column selected), `lib/persist.ts`,
`lib/refCache.ts`, the six mutation-type copies, `apps/operator-shell`, `.github/workflows/ci.yml`.

## 5.25 Build order and release

1. After the DB and Money steps have produced `types.gen.ts` with every §1.7 RPC and the scaffolding
   step has mounted `ws/coaching.*` (empty lane files), `opErrors.coaching.*`, the glossary and
   `coaching/shapes.ts`.
2. Operator commits, each with its catalogs and tests green: (a) tokens, icon, lib (`QK.coaching`,
   capabilities, rail rows, routes, storage, the persist case), this lane's `COACHING_SHAPES` entries,
   `lessonLogic`, payloads and hooks; (b) the lesson screen, roster, Take payment, attendance, add,
   cancel, reschedule, move, refunds due (with the `RefundDialog` cap); (c) calendar, Today board,
   booking dialog, StartLessonDialog, booking detail and actions dialog, till and floor guards,
   observation; (d) `/admin/coaches`, the settings panel, the record, the branch close line; (e)
   protocol kinds (core twin, `/protocols`, `/tasks` labels, staff phone); (f) statements, Ops
   refunds, day close (with the cross-day sentence), reports, panel, Financial and Setup cards; (g)
   assistant docs, map regeneration, HANDOFF row; (h) e2e EN + AR.
3. Gates per `apps/operator/CLAUDE.md` "Tests" and the root `CLAUDE.md`: `pnpm --filter
   @touch/operator typecheck`, `lint`, `test`; `pnpm --filter @touch/mobile test:smoke` (staff phone
   changed); root `pnpm typecheck`, `lint`, `test`, `security`; `pnpm e2e`.
4. The operator tag ships after 0270–0286 are on hosted (§6.1). A build that meets an older server
   shows no coaching UI (`RPC_MISSING`), so an early station update is harmless. `coaching_enabled`
   stays off until the whole milestone is live; the desk may stage lessons before (R51).

## 5.26 Known limits

- Creating, rescheduling or moving a lesson can bump a filling open match with no warning in the
  new-lesson dialog (the server decides; the matches strip and Today group refresh on `slot_changed`).
- A cashier holds `takeLessonPayment` but no cashier screen shows the lesson screen (`/desk` excludes
  the cashier, `auth.tsx:226`): a cashier takes lesson money from a student's record (R20), so a
  walk-in student without an account is paid at the desk.
- A student whose phone matched an account but who has not confirmed it (C-21) stays a walk-in to
  staff: their record does not gain the lesson until they say "Yes" in the app.
- The `'Lesson'` literal still reaches screens that read `reservations.guest_name` without
  `reservationNameOf` (the staff phone's lists, Telegram summaries, report drill rows).
- The month heat view counts bookings only, not lessons.
- A coach or student in Arabic third person is masculine in v1.
- The staff phone does not start lesson price changes; it reads and decides them.
- A lesson's coach cannot be swapped (cancel and rebook); a course session cannot be cancelled alone
  (C-19, §6.3).
- No rail badge for lesson refunds due or statements to approve; the Ops panel and the Financial card
  status line carry them.

## Additions to §1 (nothing in §1 is renamed)

Items 1–9 were listed before the merge; the §1.12 preamble accepted them unless a ruling changed
them. Their state after §1.13:

1. **Read contracts** — *folded, superseded by R41 and X1–X29.* The shapes of §5.6 are the X-table
   picks: this lane's for `desk_lessons` (X16), `desk_lesson_detail` (X17, names per R44),
   `customer_lessons` (X18, plus `lesson_strikes_30d`), `coaches_admin` (X19), `coaching_settings`
   (X20); Money's for `lesson_refunds_due` (X21, plus `phone`), `report_coach_statements` and
   `coach_statement_detail` (X22, X23, the union), `report_lessons` (X24), `report_courts.lessons`
   (X25), `report_revenue.owedToCoachesIqd` (X26), `day_close_online.lessons` (X27, plus `kept_*`);
   DB's for `coach_slots` (X3) and the protocol targets and numbers (X28, numbers plus `name_*`);
   write results per X13 and X29. The lists live in `COACHING_SHAPES`.
2. **Protocol record shapes** — *folded*, amended by R46: each lesson record carries a
   server-stamped `before` with `shape {kind, duration_min, sessions_count, max_places}`.
3. **Reason form** — *folded* as written.
4. **Detail values** — *superseded by R52 and X31*; §5.19's details table is the full list.
5. **Operator client names** — *folded*, plus `LESSON_REFUND_REASON_CODES = ['lesson_refund',
   'lesson_goodwill']`, `op.reasons.lesson_refund`, `op.reasons.lesson_goodwill`, `RefundDialog`'s
   `dueIqd` prop, `ws.tillShift.dayClose.crossDayCounted`.
6. **Search params** — *folded* as written.
7. **Assistant** — *folded*, with R42's rule that no tool names the two person-money reports.
8. **Tokens** — *folded* as written.
9. **Manager on/off of a launched type is direct** — *folded into R46.*

New in this pass (for DB and Money to confirm; each follows a ruling that names no key):

10. `coaching_settings` returns `coach_max_open_private` (R56), `online_payments_available` (X20) and
    `lesson_terms_ready` (R50); `set_coaching_settings` refuses an online mode with
    `ONLINE_PAYMENT_OFF` detail `provider` or `terms`.
11. `coaches_admin` coaches carry `public_accepted_at` (R61), `account_deleted` (R63),
    `upcoming_lessons` and `open_courses` (the retire confirm, R45).
12. `desk_lessons` lessons carry `booked_by_kind` (the C-24 flag); `desk_lesson_detail` carries
    `lesson.rescheduled_at`, `lesson.booked_by_kind` and `events[].late` (R26); its enrolment
    `customer_id` is null for an unconfirmed phone match, and `full_name`/`phone` follow R44.
13. `desk_book_lesson` and `desk_add_student` with a picked customer record that customer's name and
    phone on the enrolment (so R44's "recorded name" exists for every staff-booked row), and refuse
    the lesson's own coach as the customer (`ALREADY_ENROLLED` detail `coach`, C-24).
14. `customer_lessons` lists only enrolments the customer booked, was picked for at the desk, or
    confirmed (C-21).
15. `coach_statement_detail` gains `coach_booked_no_shows[] {lesson_id, start_at, type_name_*}`
    (C-24, R56), no student names.
16. `coach_statement_void(p_statement_id uuid, p_reason text, p_pin text default null, p_device_id
    text default null)` joins every `PIN_GATED_RPCS` copy; the grant is consumed only from
    `approved` (R59).
17. `set_coach_branches`' `BRANCH_HAS_BOOKINGS` carries the removed branch's id as its detail (R52).
18. R49's run of 12 or more digits is counted across spaces, dots and hyphens (a card typed in
    groups of four); the operator mirrors that.
19. `day_close_online` carries `refunds_dated_by_shift boolean` per day (C-31 copy, §5.18.1): true
    for a day open or closed under the new dating, false for a day closed before it.
20. `move_reservation`'s refusal of a lesson row (R7) uses detail `move` (or `court_only`, which the
    operator reads the same).
21. The shared glossary lives at `packages/i18n/src/glossary/coaching.ar.ts` (R55 names no path) and
    `COACHING_SHAPES` is the export name of `packages/core/src/coaching/shapes.ts` (R41 names none).

## Contradictions this lane raised, and how the rulings settled them

a. `PRICE_VIA_PROTOCOL` and `LAUNCH_VIA_PROTOCOL` listed as new in §1.10 — **settled by R14**: reused,
   copy widened; screens keep their lesson lines (§5.19).
b. `coach_statement_mark_paid` could not take the PIN grant — **settled by R4**: `(p_statement_id,
   p_reference, p_pin, p_device_id)`, in every `PIN_GATED_RPCS` copy.
c. Statements under "All branches" — **settled by R21**: the list widens, the detail and every write
   act on the rail's branch; other-branch rows are read-only (§5.16).
d. court_desk needed settings and a catalogue it cannot read — **settled by R20**: the `desk_lessons`
   envelope carries them; the desk never calls `coaching_settings` or `coaches_admin`.
e. The cashier and `/desk/lessons/$id` — **settled by R20**: the cashier takes lesson money from the
   customer record (§5.15, §5.26).
f. C-12's PIN — **settled by R4 and R59**: approve is a confirm, mark paid takes the PIN, and a void
   from `approved` takes one too; a negative total is refused.
g. Which kinds reschedule — **settled by R8 and R32**: every kind; a held lesson is refused;
   a group session's cut-off moves with it.
h. CD-6 against a queued `move_reservation` of a lesson — **settled by R7**: `move_reservation`
   refuses a lesson row, and `desk_move_lesson_court` is the only move; the till's queued refund of
   desk lesson money stays a till write (R22), bounded by R36.
