> **Adversarial review: rules, privacy and decisions, 2026-10-01.** Read-only review of
> `../build-contracts-2026-10-01.md` (§0 decisions C-1…C-20 and CD-1…CD-12, §1 names, §1.12 rulings
> R1–R23) and the four lane files (`../db.md`, `../money.md`, `../guest.md`, `../operator.md`).
> Checked against the rules files (root, `packages/db`, `apps/mobile`, `apps/operator` and `apps/web`
> `CLAUDE.md`), `docs/security/security-general.md` (SEC-20, SEC-28, SEC-29, D1–D11) and the gate
> scripts at `d93bd9bf` (latest migration 0269).
>
> Sibling: `review-concurrency-money-2026-10-01.md` (locks, races, money invariants; its rulings
> start at R24). This file's rulings start at **R40**.
>
> Citations: `bc:` = build contracts; `db:` / `mo:` / `gu:` / `op:` = the four lane files; `NNNN:line` =
> a migration; anything else is a repo path.
>
> **This file needs an `assistant-coverage.json` `docs` entry before it is committed** (G1):
> `"excluded: an engineering review of the coaching design (defects and fixes); the resulting rulings
> are in build-contracts-2026-10-01.md §1.12"`.

# Review: rules, privacy and decisions (coaching)

## Verdict

The decisions are sound, and most of them reach the lanes intact.

- No create path takes a price.
- Push bodies name nobody and carry no amount.
- Every new table is RLS-on with no client grant.
- Deletion scrubs the typed names and phones.
- The protocol covers all three price kinds.

**As written, the design cannot be built to a working product.** Four reasons, each a BLOCKER:

- **B1. No lesson push is ever sent.**
  - `db.md` says DB never calls `lesson_notify` and that Guest owns a trigger on `lesson_events`.
  - `guest.md` has no such trigger. Its call sites live in DB's bodies.
  - R18 does not decide between the two. This is the open-matches D27 problem again.
- **B2. The read contracts disagree for almost every RPC a client parses.** 29 contract rows, about
  34 RPCs, are affected (§5, X1–X29). One example: a desk-mode private booking answers
  `status: 'scheduled'`, and the phone branches only on `booked` or `held`, so neither path runs.
- **B3. `check:analytics` (SEC-29) goes red at 0284.**
  - DB's new FORBIDDEN patterns (`/coach_id/i`, `/coach_name/i`) match Money's
    `report_coach_statements` keys.
  - Money's camelCase `report_lessons.byCoach` slips past the same tripwire. So the gate fails where
    it should pass and passes where it is meant to catch.
- **B4. Today's working tree already fails `pnpm security`.**
  - `docs/design/coaching/` is on disk with no `assistant-coverage.json` entries.
  - `inventoryDocs` walks the filesystem (`build-assistant-map.mjs:485-490`).
  - Under the root `CLAUDE.md` push rule, this blocks every push from this machine, including
    unrelated work.

Eleven rulings are not applied, or are contradicted, in at least one lane: R2, R5, R6, R7, R8, R15,
R16, R17, R18, R20 and R23 (§1.2). The consistency pass that CONTINUE.md schedules must apply them.

The privacy and rule MAJORs:

- **P1.** The coach's photo path published the coach's **auth user id** to anonymous readers.
- **P2.** A deleted coach's photo stays public for ever.
- **P3.** A mistyped phone links a stranger to someone else's lesson.
- **P4.** A coach whose account is staff never reaches coach mode.
- **P5.** Coach mode vanishes when coaching is switched off, while booked lessons still run.
- **P6.** The retired coach's access, and whether retiring cancels lessons: the lanes contradict R16
  and each other.
- **P7.** SEC-20 misses the coach's own data, and the payment reference can hold an account or card
  number.
- **P8.** Per-coach pay is readable by the owner's AI assistant, against the deduction precedent.
- **P9.** The legal pages: the web deletion page and the coach's privacy text are missing.
- **P10.** Money can be kept on lessons before any accepted terms mention lessons.
- **R-findings:**
  - a session created inside its cut-off is cancelled within a minute (D1);
  - a coach or desk add to a course after its last start fails with a raw CHECK error (D2);
  - the desk cannot stage private lessons while coaching is off (D3).
- **Price protocol (PR1, PR2):**
  - a draft's shape can change between the owner's approval and the apply;
  - the operator offers fields that no path can save.

Nine items change what guests, coaches or staff experience. They go to Parsa (§7):

| Q | Topic |
| --- | --- |
| Q1 | A typed phone that links a stranger |
| Q2 | The coach's consent to a public profile |
| Q3 | Leaving a running course |
| Q4 | Coach pay and LLMs |
| Q5 | Court hoarding through coach bookings |
| Q6 | Retired coaches |
| Q7 | Lesson terms before money is kept |
| Q8 | A deleted coach's display name |
| Q9 | Staff who coach |

## 1. Decision conformance

Status key:

- **Done**: specified end to end.
- **Partial**: specified, but one lane is missing it or out of step.
- **Contradicted**: a lane says the opposite of §0 or §1.12.

### 1.1 Decisions and defaults

| ID | Status | Where | Verdict |
| --- | --- | --- | --- |
| C-1 three kinds | Done | db:519-524 (`lesson_types_places`), db:703-707, gu:929-933 | Party 1..4, one price for the lesson; up to 3 friends, each name 1..40. |
| C-2 instant, only offered times | Partial | db:1347-1377, db:1583-1590 | The booking and `coach_slots` apply the same rule set: grid, hours, time off, R22 and the horizon. But `coach_slots` has three shapes (X3), and it offers a **paused** coach's times (`coach_available` never reads `coaches.status`, db:1144-1147). |
| C-3 desk default, Qi when on | Done | db:335-342, db:1270-1272, db:716-717 | `lesson_enrolments_payment` forces `desk` for coach and desk bookings. The operator reads `online_payments_available`, which nobody returns (X20). |
| C-4 coach sets, manager overrides | Done | db:1204-1223, gu:1320-1346, op:807-828 | — |
| C-5 / C-17 coaches never price | Done for C-5; Partial for C-17 | db:1172-1200, db:1656-1730 | **No create path accepts a price** (§3.1). C-17 has the shape loophole (PR1) and dead-end editor fields (PR2). |
| C-6 math | Done | mo:941-947, mo:250-253 | `floor(bp × max(0, collected − court share) / 10000)` per session, from snapshots. |
| C-7 manager-only bio | Done | db:1165, db:922-930 (storage: manager and owner only) | The coach has no write. Photo path: P1. Consent: Q2. |
| C-8 coach books students | Partial | db:1400-1413, db:1459-1486 | The R10 link has a stranger case (P3, Q1). A course add after the last start crashes (D2). |
| C-9 cancel rules | Partial | db:1529-1538, mo:303-313 | Courses: "a course already running is always late". That also catches a late joiner whose first session is days away, and it keeps every unheld session's money (Q3). R8's free cancel after a reschedule is not in DB (D4). |
| C-10 any free court; desk moves | Done | db:1291-1294, db:1519-1525 | `move_reservation` still moves a lesson's court, against R7 (D6). |
| C-11 web prices behind the switch | Done | gu:1453-1456 (prices dropped at parse), gu:122-124 | The app shows prices, by design. Separate leaks: the profile id in `photo_path` (P1) and staged coaches via `coach_profile(NULL)` (P11). |
| C-12 monthly draft, manager approves, PIN on paid | Partial | mo:1025-1066, R4 | Money's CM-8 stops any later month from drafting while an older draft is live (mo:65, mo:969). "Drafted monthly" then stops for that coach. The guest lane shows drafts to the coach (gu:1424, :1428-1430), against CM-12 (mo:69). |
| C-13 coach or manager creates | Done | db:1425-1455 | Courts are taken at creation with no cap (Q5). |
| C-14 min and cut-off | Partial | db:1772-1790 | A session created inside its own cut-off is judged at once and cancelled (D1). |
| C-15 late join pro-rata; sign-up closes at last start | Partial | db:1389-1396, mo:255-258 | D-13 (db:2010) lets coaches and the desk add **after** the last start, against C-15. The price set is then empty, which breaks a CHECK (D2). |
| C-16 coach sees own students | Partial | db:1616-1621, gu:251-267 | Window end: `start_at` (db) against `end_at` (gu) (D5). Reachability: P4 and P5. Retired: P6. After the CD-8 purge the roster leaks the account name (P3c). |
| C-18 lesson revenue line | Done | mo:1155-1172 | The operator reads `owedToCoachesIqd` in `report_revenue`, which Money never adds (X26). |
| C-19 reschedule, never drop | Done | db:1494-1517, mo:426-433 | R8 widens reschedule to every kind; the lanes still say course sessions only (D4). |
| C-20 30-minute grid | Done | db:1148-1150, R9 | The operator copy says "Private lessons start…" (op:1068); R9 applies the grid to every kind. |
| CD-1 | Done | db:335-342, db:716-717 | — |
| CD-2 | Done | db:1734-1741, db:1549 | A coach-added linked student cancels without a strike (R10). |
| CD-3 | Partial | db:1618 vs gu:266, gu:1357-1360 | `start_at + 7 d` against `end_at + 7 d` (D5). |
| CD-4 | Done | mo:457-458 | — |
| CD-5 | Done | db:666, db:345-348 | No manager path reaches `coach_share_bp`; it is read-only for the manager (§3.1). |
| CD-6 | Partial | db:1064-1087 | A queued `reservation.update` still changes a lesson's court (D6, R7). |
| CD-7 | Done in copy | gu:608-635 | Every body is nameless. **Nothing is sent at all until B1 is fixed.** |
| CD-8 | Partial | db:1795-1799 | The purge NULLs a linked enrolment's typed name. The roster then shows the account's full name (P3c). |
| CD-9 | Done | db:1403-1404, db:993 | The count covers `coach_book_private` too. Say that it counts every status, so add-then-remove still spends the cap. |
| CD-10 | Done | db:474-478, gu:1330-1333 | — |
| CD-11 | Done | db:1553-1562 | Detail names differ between the lanes (X31). |
| CD-12 | Partial | db:1818-1857 | The photo object outlives the account (P2). Retirement semantics (P6). Web deletion page (P9). |

### 1.2 Rulings still contradicted in a lane (§1.12 wins; the consistency pass must apply them)

| R | Lane text that contradicts it |
| --- | --- |
| R2 | `app.split_evenly(bigint, int)` (db:1392, db:1863; mo:241-282) plus an `rpc-overloads.json` entry (mo:276-282, mo:605). R2 forbids the overload. |
| R5 | `lesson_refund_online` (mo:396-424, mo:1498-1500); DB calls `lesson_refund_start` (db:1865). |
| R6 | "§2.5 lands here (the first `lock_coach`)", in the 0279 commit (db:196, db:1239). R6 puts it in 0275. |
| R7 | `move_reservation` moves a lesson's court and writes `court_moved` (db:1064-1087, D-16 db:2013). The operator's `RESULT_INVALIDATIONS` rely on that (op:192-194). |
| R8 | `SESSION_NOT_MOVABLE not_course` (db:1500, D-10 db:2007). Coach-mode reschedule is "a course session" only (gu:1383-1384). There is no `lessons.rescheduled_at` in the DDL (db:607-661), and no free cancel after a reschedule (db:1532-1535). |
| R15 | "Joins and adds take no court: no degraded check" (db:1262-1263). R15 lists `lesson_join`, `course_join` and `coach_add_student`. |
| R16 | `coach_self` raises `NOT_A_COACH` for a retired coach (db:1121-1123), and guest decision 11 sends a retired coach to Profile (gu:1808). Neither gives a read-only mode. `set_coach_status` refuses to retire a coach with lessons (db:1166) and lives in 0279; R16 and the operator (op:770-775) have retiring cancel them. |
| R17 | `coach_profile(NULL)`: R17 says "every open branch where the coach is active"; gu:142-145 answers `venue: null` with empty offers. |
| R18 | B1. |
| R20 | `desk_lessons` returns `{coaching_enabled, server_now, lessons}` (db:1625-1629), with no catalogue and no payment mode. |
| R23 | Today's tree (B4). |

## 2. BLOCKERS

**[BLOCKER] B1. The lesson push fan-out has no owner.**

- **Evidence.**
  - db:1638-1642: "Guest writes … the AFTER INSERT trigger on `lesson_events` that calls them. DB
    never calls them."
  - db:1928-1929: "DB never calls `lesson_notify`."
  - gu:459-515 (rules 1 and 2): the cancel pushes are queued by "DB's two cancel internals", and
    every other push by "the RPC that made the change". Its call-site table names 12 DB bodies.
  - gu:1828-1835 (§4.20) lists only the reminder triggers. No `lesson_events` trigger exists in any
    lane.
  - R18 fixes `lesson_notify`'s meaning but not who calls it.
- **Why it matters.** Built as written, neither lane queues any `lesson.*` or `coach.*` push except
  Money's four direct calls (mo:776, :793-794, :1041, :1059). CD-7, C-9 ("a coach cancel … notifies
  everyone") and C-14 ("everyone notified") all silently fail. The test plan cannot catch it: each
  lane's tests cover its own side.
- **Fix.** R40.
  - One AFTER INSERT trigger on `lesson_events`, Guest's, in 0280. It maps `(type, code, actor,
    enrolment)` to the key and recipient using gu:467-501's tables.
  - DB already writes one event per transition (db:1906-1927), so no call site can be missed. This is
    the open-matches D27 pick.
  - Money keeps only the statement pushes, which have no event. It drops its direct
    `coach.new_student` and `lesson.payment_expired` calls: the `paid_online` and `expired` events
    carry them. The 15-minute dedupe makes a stray double harmless.

**[BLOCKER] B2. The read contracts disagree in 29 contract rows (about 34 RPCs).**

- **Evidence.** §5, X1–X29.
- **Why it matters.** The phone and the operator parse defensively, so a mismatch renders as
  "unknown" or "—" rather than crashing. But it renders wrong everywhere:
  - X5: the phone's desk path never runs.
  - X12: the coach sees drafts that Money hides.
  - X16: the desk has no catalogue for New lesson (R20).
  - X3: three shapes for `coach_slots`.
- **Fix.**
  - R41: the client lanes' shapes are the contract, with the picks in §5.
  - A shared key-set fixture that DB tests assert against and the client parsers read, so the drift
    cannot come back.

**[BLOCKER] B3. SEC-29 goes red at 0284, and is blind where it matters.**

- **Evidence.**
  - db:1652 adds `/coach_id/i, /coach_name/i, /display_name/i` to `check-analytics-payload.mjs`
    FORBIDDEN.
  - The gate scans every client-callable `report_%` function's `'key',` literals
    (`check-analytics-payload.mjs:90-104`).
  - `report_coach_statements` emits `coach_id`, `coach_name_en` and `coach_name_ar` (mo:1075-1079).
    It is `report_`-prefixed and granted to `authenticated`, so the gate fails.
  - `report_lessons.byCoach` emits `coachId`, `coachNameEn` and `coachShareIqd` (mo:1256). The
    camelCase misses every underscore pattern, though DB's stated intent is exactly "a per-coach
    figure sent to the analytics model would be money about a named person, the `deduction`
    precedent".
- **Why it matters.** CI's db job goes red on the statements commit. Fixing it the obvious way
  (deleting the patterns) removes the only tripwire on per-coach pay.
- **Fix.** R42 and Q4.

**[BLOCKER, working tree] B4. `pnpm security` fails on the current tree.**

- **Evidence.**
  - `git status`: `?? docs/design/coaching/`.
  - `assistant-coverage.json` has no `docs/design/coaching/*` key (only the open-matches set,
    `:1133-1140`).
  - `inventoryDocs()` walks `docs/` on disk (`build-assistant-map.mjs:485-490`).
- **Why it matters.** Root `CLAUDE.md` step 1 requires `pnpm security` before every push. Any push
  from this machine, coaching or not, now fails its own gate. Copying R23 to "in the commit" leaves
  the tree red until the coaching commit lands.
- **Fix.** R53. Add the entries now, in their own docs-only commit (with the map regenerated):
  - the six coaching files, `CONTINUE.md`, and both reviews;
  - `excluded` for the lane files, the drafts and CONTINUE;
  - build contracts: `index:doc` as for open matches, or `excluded`. It holds the phone-oracle and
    privacy design, and the precedent review G8c already suggested excluding these specs.

## 3. Privacy and security

### 3.1 What was checked and holds

Each of these was traced to its text:

- **No create path accepts a price.**
  - `lesson_book_private` and `lesson_join` take only an expected price.
  - `coach_*`, `desk_*`, `course_*` and `coach_add_student` take none (db:1347-1455).
  - `lesson_settle` takes only `p_expected_owed_iqd`.
- **No manager path reaches `coach_share_bp`.**
  - It is read through `coaching_settings` and written by the owner only (db:371-378).
  - It is never in `set_venue_details` (db:345-346) or the public view (db:350-352).
  - Lessons and courses snapshot it.
- **Every new table** is RLS-on with no policy and no client grant (db:395-398).
- **Lesson court rows** carry `guest_id` NULL, so no guest path can reach them (db:67-72).
- **Push bodies** carry no name or amount; payload data is `{kind, route, title_key, id}`
  (gu:584-587, :631-635).
- **The coach roster** never shows money or a profile id (db:1620-1621).
- **Account deletion** scrubs typed names, phones and friend names, and empties bios and time-off
  reasons (db:1823-1840).
- **R12's allowlist split** is applied in db:1649 and db:1231-1233.

### 3.2 Findings

**[MAJOR] P1. The coach's photo path publishes the coach's auth user id.**

- **Evidence.**
  - op:746-748: "`ImageField` … `folder="coaches"`, `ownerId` = the picked profile id, … `mediaPath`
    writes `coaches/<profileId>/<uuid>.<ext>`".
  - `profiles.id` is `auth.users.id`.
  - The path is returned by the anonymous reads (db:1572, gu:105, :132, :162), by `my_lessons`
    (db:1604) and in the website's image URLs.
  - db:427-429 says the operator uploads "to a fresh uuid folder"; the two lanes disagree.
  - db:1566 promises "never … a profile id" in public reads, but `coaching-privacy.test.ts` scans
    keys, not values (db:1987).
- **Why it matters.** Anyone on the website learns the coach's account id. That breaks the stated
  invariant and links the public coach to the private guest account (bookings, match seats) wherever
  else that id surfaces.
- **Fix.** R43.
  - The folder is a fresh random uuid at upload; never a profile or coach id.
  - The `coaches_photo` CHECK keeps its shape.
  - Add a **value** scan to the privacy test: no public payload contains a `profiles.id`.

**[MAJOR] P2. A deleted coach's face stays public for ever.**

- **Evidence.**
  - SEC-20 `photo_path: scrub` (db:954). Deletion nulls the pointer only (db:1832).
  - db:2021-2022 known limit: "stays in `menu-media` until a manager deletes the object".
  - `menu-media` is public-read, with a one-month `cacheControl` (`op/lib/storage.ts:12`).
  - The DB cannot delete storage objects. The repo already removes personal photos through an edge
    path (`protocol-action/index.ts:61, :121`, incident photos).
- **Why it matters.** After the account is deleted, its photo is still served at a stable URL that
  search engines and chat previews may hold. CD-12 and the deletion text promise erasure.
- **Fix.** R43.
  - Deletion and retirement leave a row on a purge list; a service edge path (the protocol-action
    pattern) removes `coaches/<folder>/*` within the day.
  - `app.storage_path_in_use` (0223:498) learns `coaches.photo_path`, so `removeMedia`
    (`op/lib/storage.ts:72-81`) never deletes a live coach photo, and deletes a replaced one.
  - The SEC-20 proof asserts the queued purge.

**[MAJOR] P3. A coach-typed phone that matches a stranger links them to someone else's lesson.**

- **Evidence.**
  - R10 and db:1472-1477 link on an exact verified-phone match.
  - gu:494 pushes `lesson.added_by_coach` ("Your coach added you to a lesson") to that account.
  - My lessons shows the lesson; `lesson_cancel_mine` lets that account cancel it (db:1529-1531).
  - op:280: the desk roster shows "account: the profile's" name and phone, not the typed ones.
  - `customer_lessons` adds the lesson and any no-show to that customer's record (op:305, :917).
- **Why it matters.**
  - A one-digit typo hands a stranger the real student's lesson, push and reminders.
  - The stranger can cancel it, and the walk-in loses it.
  - The desk calls the wrong person, and the wrong customer's record gains a no-show.
  - It is also a nuisance channel: 30 strangers a day per coach (CD-9).
- **The oracle residue (part of the same finding).** The coach is never told directly, but learns
  the link four ways:
  - **(a)** the linked account cancels in the app, and the row disappears with a
    `coach.student_cancelled` push (gu:474);
  - **(b)** the account deletes itself and the sweep cancels the enrolment;
  - **(c)** after CD-8's purge, a linked row's typed name is NULLed (db:1798-1799), and the roster
    falls back to `p.full_name` (db:1617). That reveals both the link and the account's real name;
  - **(d)** timing: only the linked path inserts an outbox row, calls `push_nudge` and writes
    reminder rows (gu:404-411, :444-448). R10 promises an identical "timing class".
  - The privacy text (gu:1642-1644, "the coach is never told whether that number belongs to an
    account") therefore overstates.
- **Fix.** Q1, then R44:
  - the roster and desk show the typed name and phone for every `booked_by_kind in ('coach','staff')`
    row and never fall back to the profile's;
  - the purge sets a coach-typed name to a fixed marker, never NULL, on linked rows too;
  - `lesson_notify` from a coach add is due a few seconds later and nudged by the cron, so both
    paths do the same synchronous work;
  - the privacy sentence gains "unless you cancel it yourself".

**[MAJOR] P4. A coach whose account is also staff never reaches coach mode.**

- **Evidence.**
  - gu:1279: "`staff` other than `guest` → `none`: a staff session never reads `coach_me`".
  - `GuestTabsGate` keeps a staff session out of the tabs (`apps/mobile/CLAUDE.md`, line 9), so
    Profile, the only entry (gu:816-817), is unreachable.
  - Money's CM-11 (mo:68) and db:48-50 both expect a staff member who coaches.
- **Why it matters.** That coach cannot set hours (C-4), read rosters (C-16), mark attendance
  (CD-11), book students (C-8) or see statements (C-12) on the phone. Their `coach_lesson` push taps
  land on a redirect (gu:1223-1224).
- **Fix.** Q9, R45. `CoachStatusProvider` reads `coach_me` for staff too. The staff hub's menu gets
  the same "Coach mode" row, and coach-mode screens accept a staff session. Staff status still wins
  the tabs.

**[MAJOR] P5. Coach mode disappears while booked lessons still run.**

- **Evidence.**
  - gu:773-776: with `!anyCoaching(branches)`, `CoachStatusProvider` does not call `coach_me`.
  - `coach_me` lists only branches "not closed" (db:1132).
  - db:346-347 (and op:691-692): switching coaching off lets booked lessons "run to their end".
- **Why it matters.** The owner switches a branch off, or the coach's only branch is closed, and
  the coach loses rosters, phones, attendance marks and statements for lessons still on the
  calendar. A coach "not at any open branch" loses statements they are owed.
- **Fix.** R45. Read `coach_me` on Profile mount and from the staff hub, whatever the switches say
  (one cheap call per visit, staleTime 5 min). Coach mode shows "Lessons are switched off at
  {branch}" instead of hiding.

**[MAJOR] P6. The retired coach: three lanes, three behaviours.**

- **Evidence.**
  - R16: "`retired` leaves coach mode read-only (schedule history and statements)", and retiring
    calls the cancel internal.
  - db:1121-1123: `coach_self` treats retired as `NOT_A_COACH`.
  - db:1166: retiring with live lessons is `INVALID_TRANSITION has_lessons`.
  - gu:1808: retired never sees coach mode.
  - op:770-775: "Retire {name}? Their {lessons} to come are cancelled".
  - op:339 reads `lessons_cancelled` from the result.
- **Why it matters.**
  - A coach retired with an approved, unpaid statement cannot see it.
  - The `coach.statement_paid` push lands on Profile.
  - The operator's Retire flow fails `INVALID_TRANSITION` every time a coach has a lesson booked.
  - If R16's read-only mode is built naively, a retired coach keeps reading student phones.
- **Fix.** Q6, R45.

**[MAJOR] P7. SEC-20 misses the coach's own data; the payment reference can hold a card number.**

- **Evidence.**
  - `LINK_COLUMNS` gains `created_by_profile_id`, `booked_by_profile_id`, `marked_by_profile_id` and
    `actor_profile_id` (db:945-947), but not `coach_id`. So these tables are never discovered:
    - `coach_time_off.reason` (coach-typed, ≤ 200, e.g. a medical reason; emptied only on deletion,
      db:959);
    - `coach_statements.paid_reference` (1..80 free text);
    - the coach's pay (`coach_statements` and `coach_statement_lines` money);
    - `courses.title_*` (coach-typed).
  - op:961-962 invites "Receipt number, transfer reference or a note on how it was paid".
  - `security-general.md:307` (the "rule that has no exception"): never add a column or note field
    that could hold a card number.
- **Why it matters.** The store data-safety forms are generated from the declarations
  (`packages/db/CLAUDE.md`, Tables). A coach is an app user whose pay, schedule notes and payment
  references are stored and never declared.
- **Fix.** R49.
  - An explicit `COACH_DATA` declaration block (the `UNLINKED_PERSONAL` precedent,
    `stored-fields.test.ts:307-321`), with its own proof.
  - A `Category` for pay ("Financial info"); amounts kept as the venue's accounts.
  - `paid_reference` refuses a run of 12 or more digits (a card, IBAN or wallet number), and the
    copy says "a receipt or transfer number, never a card or account number".

**[MAJOR] P8. Per-coach pay is readable by the owner's AI assistant.**

- **Evidence.**
  - db:938: `coach_statements` is `table_read`.
  - mo:1114-1116 recommends `excluded`.
  - The precedent: `salary_deductions` is "excluded: … money about a named person; never readable by
    the owner assistant or any LLM" (`assistant-coverage.json:108`).
  - D10 (`security-general.md:60`): switching the assistant on needs its own SEC-29 review.
- **Why it matters.** It contradicts the house rule and Money's own recommendation. The next
  assistant switch-on would ship a named person's pay to a model.
- **Fix.** Q4, R42. `coach_statements` and `coach_statement_lines` are `excluded`. B3's gate is
  fixed the same way.

**[MAJOR] P9. The legal pages are incomplete.**

- **Evidence.**
  - gu:1587-1590 changes only the in-app `profile.deleteBody`.
  - The web deletion page, which is the Play deletion URL (`legal.en.ts:358-372`, "What is deleted
    and what is kept"), says nothing about lessons.
  - Nothing tells a **coach** what happens to their coach profile:
    - the photo is removed;
    - the display name is kept on statements;
    - statements are kept.
  - The privacy text (gu:1640-1652) covers students only. It says nothing about the coach's own data:
    - the public name, bio and photo chosen by the venue;
    - weekly hours and time off;
    - monthly pay statements.
  - The "Venue staff" paragraph (`legal.en.ts:121`) does not mention coaches seeing phones.
- **Why it matters.** Google Play checks the web deletion page against the app. The precedent review
  flagged the same gap (open-matches §4.5 item 4).
- **Fix.** R50. List the exact lines: delete-account, privacy (collect, share, retention) for
  students and for coaches, at the terms bump.

**[MAJOR] P10. Money can be kept on lessons before any accepted terms mention lessons.**

- **Evidence.**
  - gu:1638-1652: the lessons terms ship "with the next terms bump".
  - `lesson_guest(true)` checks `match_terms_ok`, the open-matches terms version (db:1286-1289).
  - Rollout (bc:520-528) switches coaching on at one branch with nothing tying it to that bump.
- **Why it matters.**
  - A guest can pay by Qi under `online_required`.
  - A late cancel keeps the money and records a strike, under terms that never named either.
  - The precedent review sent penalty-shaped terms to the client's lawyer before the 1.0 freeze
    (open-matches §4.5 item 1).
- **Fix.** Q7, R50: `set_coaching_settings` refuses a non-desk `lesson_payment_mode` until
  `platform_settings` names a terms version that contains the lessons section, and `lesson_guest`
  checks that version.

**[MINOR] P11. A staged coach is visible to anyone holding the id.**

- **Evidence.** gu:142-148: `coach_profile(id, NULL)` answers the card and `status` without a
  switch. db:1580-1582 covers only a named branch. Coaches are entered while coaching is off (bc:527).
- **Fix.** R41's X2 pick: NULL answers only open branches with coaching on, and `{off: true}` when
  there are none.

**[MINOR] P12. `coach_slots` exposes a coach's busy pattern for 14 days, to anyone.**

- **Evidence.** db:1583-1590. Read against the public `court_availability`, the gaps inside a
  coach's hours show when their lessons are, though not with whom.
- **Fix.** Accept. Record it in §6.3 known limits and in the privacy text's "coaches" line. A paused
  coach's slots must be empty (C-2 row).

**[MINOR] P13. The coach sees a held student's name and phone before they have paid.**

- **Evidence.** gu:261 (`status: "held|booked"` in the roster). Money pushes `coach.new_student`
  only once paid (mo:776).
- **Fix.** The roster lists `held` enrolments as "Awaiting payment", without a phone, until booked.

**[MINOR] P14. Cross-branch writes in `menu-media`.**

- **Evidence.** Any manager may insert, update or delete any object in the bucket
  (0234:448-459). `coach_update`'s scope check (db:1165) does not reach storage, so a manager at
  branch A can overwrite the photo of a coach who teaches only at B. The path is public.
- **Fix.** Accept as the existing chain-wide bucket rule (menu items already work this way). Name it
  in `db.md` §9.

**[MINOR] P15. Lesson student names reach the till's plaintext cache.**

- **Evidence.** op:223 works from "the cached day" offline. `desk_lessons.label` carries student
  names (op:253). D8's open S12 item (`security-general.md:58`): guest names and phones in plaintext
  in `queue.db` `ref_cache`.
- **Fix.** `QK.coaching` is never written to the shell cache (the mobile no-dehydrate rule,
  gu:720-722).

## 4. Price protocol

### 4.1 What was checked and holds

- **`upsert_lesson_type`:**
  - a manager on a launched type changing `price_iqd` or `court_share_iqd` gets `PRICE_VIA_PROTOCOL
    price`;
  - changing `duration_min` or `sessions_count` gets `PRICE_VIA_PROTOCOL shape`;
  - `is_active: true` on a never-launched type gets `LAUNCH_VIA_PROTOCOL`;
  - see db:1172-1183.
- **`set_coach_price`** refuses a manager even on a draft (D-8, db:1189-1196).
- **`set_coach_lesson_types`** takes no price.
- **The marketing role** gets `NOT_STEP_ACTOR` for the three kinds (db:1658-1660), and
  `priceChangeKinds('marketing')` drops them (op:847, :888-891).
- **Operator Addition 9 is not a bypass.** Switching a launched type off and on is a direct manager
  write (op:1474-1477). The same rule holds for launched menu items and add-ons:
  - `launched_at` stays set and only the first launch is a protocol;
  - see 0172:99 and 0177:87, :1028.
  - Re-activation changes no price.

### 4.2 Findings

**[MAJOR] PR1. A draft's shape can change between the owner's approval and the apply.**

- **Evidence.**
  - C-17 lets a manager edit a never-launched draft directly (db:1181).
  - `lesson_launch`'s target check compares only the figures: "still never launched, still off,
    figures equal `before`" (db:1689-1690).
  - `coach_price` compares only the coach price (db:1690-1691).
  - The apply calls `upsert_lesson_type_internal`, which validates nothing (db:1184-1188); it relies
    on CHECKs.
- **Why it matters.**
  - The owner approves 30,000 for a 60-minute private lesson.
  - Before the apply, the manager edits the draft to 120 minutes, or a party of 4, or a course from
    8 sessions to 4.
  - The approved price goes on sale for a different product. The same works for a `coach_price` on a
    draft type.
  - A changed `sessions_count` can also make the apply fail a CHECK (`price_iqd >= sessions_count`)
    with a raw 23514 inside `price_promo_apply_due`.
- **Fix.** R46.
  - `before` for all three kinds carries the type's shape: `kind`, `duration_min`, `sessions_count`,
    and `max_places` for a private type.
  - The target check compares the shape (`PRICE_TARGET_CHANGED` hint `lesson_type`).
  - The internal runs the same validator as the wrapper.

**[MAJOR] PR2. The operator's editor offers fields that no path can save.**

- **Evidence.**
  - op:800: for a launched type the manager edits "every field but price and court share".
  - db:1179-1180: `duration_min` and `sessions_count` are `PRICE_VIA_PROTOCOL shape`.
  - op:803-805 turns that refusal into "Propose a price".
  - But no proposal shape carries a duration or session count (db:1676-1686).
- **Why it matters.** A dead end: the button leads to a protocol that cannot make the change.
- **Fix.** R46.
  - `kind`, `duration_min` and `sessions_count` (and `max_places` for a private type) are read-only
    on a launched type for everyone except the owner.
  - The copy: "Make a new lesson type to change its length or sessions."
  - The `shape` hint gets that sentence too (X31).

**[MINOR] PR3. On a private type, `max_places` is what the price buys, yet it is a direct manager
write.**

- **Evidence.** db:1181-1182 ("places … stay the manager's"). C-1: one price for a party of 1..4. D-9
  locks duration for exactly this reason.
- **Fix.** R46 adds private `max_places` to `shape`. Group and course places stay direct (a place
  costs the same).

**[MINOR] PR4. The patch allowlist is not written down.**

- **Evidence.** db:1174-1175 says "an unknown key"; the allowed set is never listed.
- **Fix.** R46 names the keys:
  - allowed: `name_*`, `description_*`, `duration_min`, `price_iqd`, `court_share_iqd`,
    `max_places`, `min_places`, `cutoff_hours`, `sessions_count`, `is_active`, `sort_order`, and
    `kind` on create only;
  - refused by name: `launched_at`, `venue_id`, `id`, `created_by_staff_id`.

**[MINOR] PR5. An old approved coach price comes back on a relink or re-promotion.**

- **Evidence.**
  - db:1199-1200: a coach price "stays when the coach stops teaching the type … read only while the
    link exists".
  - `coach_promote` revives a retired row with its old links and prices (db:1164).
- **Why it matters.** A manager can revive a price the owner approved long ago against a different
  type price.
- **Fix.** Unlinking a type deletes its `coach_prices` row (audited); a relink starts from the type
  price.

**[MINOR] PR6. The staff phone decides lesson runs from shapes that do not match.**

- **Evidence.** op:893-907 reads `numbers.lesson` and the targets' lesson arrays. Those shapes
  differ between DB and the operator (X28).
- **Fix.** R41.

## 5. Cross-lane consistency (the read and write contracts)

Pick rule (R41): the client lane's field names win where a client renders them; the server lane's
win where only a server reads them. Each row below is binding once ruled.

| # | RPC | Server lane | Client lane | Pick |
| --- | --- | --- | --- | --- |
| X1 | `coaching_public` | Per branch `{venue_id, slug, …, coaches[{coach_id…}], lesson_types, sessions}`; `{venues: […]}` for NULL (db:1569-1579) | Flat `{off, branches[], coaches[{id, venue_ids, offers[]}], lesson_types[{id, venue_id…}], sessions[{…, sessions_left, max_places, signup_closes_at, cutoff_at}]}`, branch `timezone`, `cancellation_window_hours` (gu:99-127) | Guest's (both the web and the phone parse it) |
| X2 | `coach_profile` | `COACH_NOT_FOUND` with no branch row (db:1580-1582); R17: NULL means every open branch | `COACH_NOT_AT_BRANCH`; paused answered with `status`; NULL → `venue: null`, `venue_ids` (gu:129-148) | Guest's codes; NULL → the card plus `venue_ids` of open branches with coaching on, else `{off: true}` (P11) |
| X3 | `coach_slots` | `{off, venue_id, lesson_type_id, duration_min, bookable, starts[]}` (db:1585) | Guest: bare `[{start_at, end_at}]`, `[]` when off (gu:150-157). Operator: `slots[]:{start_at}` or bare strings (op:308) | DB envelope with `starts: [{start_at, end_at}]`; a paused coach answers `bookable: false, starts: []` |
| X4 | `lesson_offer` | `status` = row status, `my_enrolment_id` (db:1591-1597) | `status: open\|full\|closed\|cancelled`, `mine{enrolment_id, status}`, `places_taken`, `min_places`, `cutoff_at`, `full_price_iqd`, `late_join`, `payment_mode`, `cancellation_window_hours`, `timezone`, `phone` (gu:159-178) | Guest's |
| X5 | `lesson_book_private` result | `status: 'held'\|'scheduled'` (the **lesson's**) (db:1375-1377) | `status: booked\|held` (the enrolment's) drives §4.9.1 steps 5 and 6 (gu:181-182, :1020-1023) | The enrolment's status. As written, a desk booking runs neither branch |
| X6 | `lesson_cancel_mine` | `{enrolment_id, status, cancel_kind, refunds_started, strike}` (db:1538) | `{enrolment_id, cancel_kind, refund_iqd, kept_iqd, duplicate}` (gu:183, :1110-1112) | The union; the amounts from `lesson_enrolment_money` after the write |
| X7 | `my_lessons` | Nested `lesson_type{}`, `venue{}`, `court_name_*`; upcoming = ending after now (db:1601-1606) | Flat `type_name_*`, `venue_id`, `lesson_status`, `attendance`, `paid_online_iqd`, `owed_iqd`, `refund`, `pending_payment`, `places_taken`, course fields; upcoming includes the last 24 h (gu:185-201) | Guest's |
| X8 | `my_lesson` | `money`, `can{cancel, cancel_free_until, pay_online}` (db:1607-1609) | `cancel{policy, free_until, refund_iqd, kept_iqd, counts_late}`, `can{cancel, pay}`, `booked_by`, `branch_phone`, `timezone`, `sessions[].rescheduled` (gu:203-216) | Guest's; the server computes `cancel.policy` |
| X9 | `coach_me` | Top-level `branches`, `lesson_types[{lesson_type_id, active}]`, bios (db:1127-1133) | `coach.branches`, `lesson_types[{id, is_active}]`, `adds_today`, `add_cap` (gu:218-229) | Guest's, plus DB's bios |
| X10 | `coach_schedule` | `lesson_type` object, "time off and hours" (db:1613-1615) | `type_name_*`, `title_*`, `sessions_count`, `unmarked`, `time_off[]` (gu:231-238) | Guest's |
| X11 | `coach_lesson` | Phone until `start_at + 7 d`; `can{cancel, reschedule, mark, add}` (db:1616-1621) | `end_at + 7 d`; `can{add, remove, cancel, cancel_course, reschedule, mark}`, `mark_until` (gu:251-267) | Guest's (window: R54) |
| X12 | `my_coach_statements` | Approved and paid only, 12-month summaries, `current_month` estimate (mo:1095-1099, CM-12) | `months[]`, statuses including `draft`, `share_bp` (gu:269-280); the copy "A draft can still change" (gu:1428-1430) | Money's visibility plus Guest's `months[]`; no drafts |
| X13 | course create results | `sessions[{session_no, lesson_id…}]` (db:1454-1455) | Guest `lesson_ids` (gu:283); Operator `lesson_ids[]` (op:327) | Return both |
| X14 | `deposit_status` lesson block | `{enrolment_id, enrolment_status, kind, lesson_id, course_id, start_at, end_at, venue_id, coach_id}` (mo:847-848) | Adds `coach_name_*`, `type_name_*` (gu:293-297) | The union |
| X15 | online success push | `coach.new_student` only; "no push to the guest" (mo:773-778) | `lesson.booked` plus `coach.new_student` (gu:493) | R40 (Money's: no guest push) |
| X16 | `desk_lessons` | `{coaching_enabled, server_now, lessons[{…, students[]}]}` (db:1625-1629) | Envelope with `lesson_payment_mode`, `coaches[]`, `lesson_types[]`; per lesson `reservation_id`, `label`, `owing`, `owing_iqd`, `paid_online`, `hold_expires_at` (op:234-262; R20) | The operator's (R20 already says so) |
| X17 | `desk_lesson_detail` | Roster `guest_id, name, phone, price_iqd, cancel_kind, attendance, money`; `can{cancel, reschedule, move_court, mark, add, settle}` (db:1630-1633) | Lesson `can{add_student, cancel, cancel_course, reschedule, move_court}`; per enrolment `can{take_payment, cancel, mark_attended, mark_no_show, unmark}`, `money.take_iqd`, `typed`, `booked_by_name`, `day_open` (op:264-299) | The operator's; names per R44 |
| X18 | `customer_lessons` | `lesson_strikes_30d` (db:1634-1636) | `coach{…}\|null`, `counts{lessons, no_shows}`, `lessons[].money` (op:305) | The operator's plus DB's strikes |
| X19 | `coaches_admin` | `settings`, `branches[{venue_id, active}]`, `hours[{weekday, start, end}]` (db:1163) | `venue_ids[]`, `hours[{start_time, end_time}]`, `hours_set_by*`, `hours_elsewhere[]`, `upcoming_lessons`, types' `coach_ids`, `pending_run` (op:306) | The operator's |
| X20 | `coaching_settings` | No `online_payments_available` (db:359-369); `set_coaching_settings` never raises `ONLINE_PAYMENT_OFF` | Reads it (op:307, :712) and maps the refusal on save (op:336) | DB returns it (a Qi provider configured); the setter refuses online modes without it |
| X21 | `lesson_refunds_due` | `{venue_id, total_iqd, items[{…, label, refund_due_desk_iqd, payments[]}]}`, "no phone" (mo:576-586) | Bare array with `full_name`, `phone`, `due_iqd` (op:309, :978) | Money's envelope plus `phone` (staff see phones; C-16 limits coaches only) |
| X22 | `report_coach_statements` | `total_iqd`, `missing[]`, totals `approved_unpaid_iqd` (mo:1074-1081) | `payable_iqd`, `current_month`, `server_now`, `venue_name_*`, `approved_by_name`, `paid_by_name`, `voided_at`, `void_reason`, totals `unpaid_iqd` (op:310) | The union (`payable_iqd` = `total_iqd`) |
| X23 | `coach_statement_detail` | `stale`; lines with `enrolments, attended, no_shows` (mo:1088-1093) | `can{refresh, approve, void, mark_paid}`, `line_id`, `course_title_*` (op:311) | The union; `can.*` false on the caller's own statement (CM-11) |
| X24 | `report_lessons` | totals `lessons, private, group, courseSessions, …, venueShareIqd`; `byCoach{coachId, coachNameEn…}` (mo:1250-1258) | `sessions, held, signUps, placesOffered, refundedIqd, coachIqd, courtMinutes`; `byCoach{nameEn, sessions…}` (op:312) | Money's names; R42 for `byCoach` |
| X25 | `report_courts.lessons` | `{lessons, private, group, courseSessions, lessonMinutes, …}` (mo:1199-1203) | `{sessions, courtMinutes, collectedIqd, courtShareIqd}` (op:313) | Money's |
| X26 | `report_revenue` | No `owedToCoachesIqd` (mo:1174-1184) | Reads it (op:314, :1026-1029) | Money adds it (accrual, as `owedToCoaches`) |
| X27 | `day_close_online.lessons` | `desk_paid_*`, `online_received_*`, `online_refunds_waiting_*`, `refunds_due_desk_*`, `owed_*`, `owed_to_coaches_iqd` (mo:1229-1233) | `online_*`, `kept_*`, `desk_*`, `unpaid_*`, `refunds_due_*`, `coach_share_iqd` (op:316, :998-1006) | Money's, plus `kept_iqd` and `kept_count` (the operator's row has no source) |
| X28 | `price_promo_targets` / `numbers` | Targets `lesson_types[…is_active]`, nested coach types; numbers `places_30d, owed_30d_iqd` (db:1702-1711) | `launched`, `lesson_type_ids[]`, `prices[]`; numbers `name_*, sessions_30d, sign_ups_30d, collected_30d_iqd, coach_share_bp` (op:318-319) | DB's targets; numbers DB's plus `name_*`. The staff phone (op:893-907) reads the same |
| X29 | Operator write results | `desk_book_lesson` returns court names only; cancels return the internal JSON (db:1333-1334); `set_coach_status` returns `{duplicate}` | `court_id` for the "court differs" toast (op:325); `refund_due_iqd, online_refund` (op:329); `sessions_cancelled` (op:331); `lessons_cancelled` (op:339) | DB returns the operator's keys |

**X30. Names from R2, R5 and R6 still in the lanes (§1.2).**

- **Evidence.**
  - Coverage, overload and registry fixtures copied from the lanes would name `split_evenly` and
    `lesson_refund_online`.
  - The gate would then fail "in the fixture but not in the code".
- **Severity.** MINOR; the sibling review owns the detail.

**[MAJOR] X31. Error codes and details the two sides disagree on.**

- **What the gate checks.** `check-error-codes.mjs` only checks raised → catalogued (`:12-24`), so
  none of these fail CI. They show the wrong words, or dead branches.

| Server raises | Client maps | Fix |
| --- | --- | --- |
| `LESSON_NOT_PAYABLE nothing_owed` (mo:548-549) | `NOTHING_OWED` (op:335) | The operator maps the detail |
| `NO_COURT_FREE`, `INVALID_TRANSITION held\|ended`, `COURT_NOT_FOUND` from `desk_move_lesson_court` (db:1519-1525) | `SLOT_TAKEN` (op:333) | The operator maps DB's codes |
| `INVALID_ARGUMENT p_id` from `cancel_coach_time_off` (db:1221-1223) | `NOT_FOUND` (op:346) | As DB |
| `set_coach_branches`: no refusal (db:1167) | `BRANCH_HAS_BOOKINGS` (op:340, :760-762) | Q-free fix: DB refuses removing a branch with live lessons, as the operator expects |
| `INVALID_TRANSITION has_lessons` (db:1166) | Retire expects cancellation (op:339) | Q6 |
| `INVALID_TRANSITION not_started\|marks_closed\|not_booked\|cancelled` (db:1556-1557) | `too_late\|not_started` (op:1102, :1455) | DB's names |
| `COURSE_STARTS_INVALID count\|order\|span`, plus per-start `SLOT_NOT_ON_GRID`, `SLOT_IN_PAST`, `CLOSED_DATE`, `OUTSIDE_HOURS`, `COACH_UNAVAILABLE`, `COACH_BUSY`, `NO_COURT_FREE` with detail `i` (db:1440-1451) | Operator `count\|order\|past\|grid` (op:1099); Guest puts a session number on `COURSE_STARTS_INVALID` (gu:304-306, :1196-1197) | DB's; both clients key the session row on the per-start codes |
| `HOURS_OVERLAP` detail = window index or `time_off` (db:1209-1210, :1220) | Weekday (op:1100) | DB returns `{index, weekday}` as `"<i>:<weekday>"`, or the clients use the index |
| `FORBIDDEN own_statement`, `STATEMENT_NOT_DRAFT live_draft`, `INVALID_TRANSITION paid`, `PAYMENT_STATE lesson_live` (mo:68, :1034-1047, :864-865) | Absent from op §5.19 | Add the detail lines |
| `ALREADY_ENROLLED coach` (db:1383) | "You're already booked on this." (gu:1163) | "You're the coach of this session." |
| `LESSON_NOT_CANCELLABLE private\|course_session` (db:1542-1543) | One generic sentence on both sides | "Cancel the lesson instead" / "Move it or cancel the course" |
| `PRICE_VIA_PROTOCOL shape` (db:1179-1180) | The generic lesson-price line (op:1103) | PR2's sentence |
| — (never raised for the desk, db:1423) | `COACHING_OFF`, `BEYOND_HORIZON` on `desk_book_lesson` (op:325) | Drop them |

**[MINOR] X32. Guard first.**

- **Evidence.**
  - `desk_lessons` lists `INVALID_ARGUMENT` (window) before the role check (db:1625-1626).
  - `lesson_refunds_due` resolves `coalesce(p_venue_id, app.current_venue())` in the guard's own
    parenthesis (mo:572).
- **Why it matters.** Precedent G4: an anonymous call gets `VENUE_REQUIRED`, which is not a refusal
  to `check-rpc-authz.mjs`. It also breaks `packages/db/CLAUDE.md`'s "the role … guard is the first
  statement".
- **Fix.** `is_staff(…)` first in every staff RPC, then the arguments and the branch.

**[MINOR] X33. `lesson-begin` refusals the phone does not list.**

- **Evidence.** gu:290-291 omits `COACHING_OFF`, `PHONE_REQUIRED`, `ACCOUNT_REQUIRED`,
  `DEGRADED_LOCKOUT`, `INVALID_ARGUMENT` and `BAD_REQUEST`, all of which mo:881-889 returns. They
  resolve through the catalogue, but `PHONE_REQUIRED` should route to `/complete-profile`, as the
  booking refusal does (gu:1030).
- **Fix.** Add them.

## 6. Decision and rule findings, UX, RTL, links

**[MAJOR] D1. A session created inside its own cut-off is cancelled within a minute.**

- **Evidence.**
  - `cutoff_at` = start − `cutoff_hours` (db:600, :666-667).
  - No create path checks it against now (db:1425-1452).
  - The sweep judges every `cutoff_at <= now()` with `cutoff_checked_at` NULL (db:1772-1773).
- **Why it matters.** A coach creates tonight's 18:00 group at 17:00, with a 2-hour cut-off. The
  sweep cancels it as `under_filled` at 17:01, and pushes everyone.
- **Fix.** R47.
  - Coach and desk creation refuse `LESSON_CLOSED` detail `cutoff` when `start − cutoff_hours <=
    now()`. The same rule holds for the first session of a course, and for a reschedule into it.
  - Or: on Parsa's word, such a session is created already judged (`cutoff_checked_at = now()`).

**[MAJOR] D2. A course add after the last start fails with a raw CHECK error.**

- **Evidence.**
  - D-13 (db:2010) and `coach_add_student` step 6 (db:1469-1470) allow adds "past its last session's
    end" (the desk is the same, db:1490).
  - The price is the sum over sessions with `start_at > now()` (db:1392-1394). Once the last session
    has started, that set is empty:
    - `first_session_no` is NULL, so `lesson_enrolments_course` fails (db:713-715);
    - `sessions_covered` is 0, which also fails.
  - C-15: "Sign-up closes when the last session starts."
- **Fix.** R48: coach and desk adds to a course close at `signup_closes_at`, as guest joins do.

**[MAJOR] D3. The desk cannot stage private lessons while coaching is off.**

- **Evidence.**
  - D-12 (db:2009) and rule 4 (db:1255-1256) let the desk book while off.
  - `StartLessonDialog` takes private starts from `coach_slots` (op:501), which answers
    `{off: true}` while off (db:1585).
  - The e2e switches coaching on first (op:1228), so it never sees this.
- **Fix.** R51: `coach_slots` ignores the switch for a staff caller `is_staff_at` the type's branch.
  Guests still get `{off: true}`.

**[MAJOR] D4. R8 (reschedule every kind) is applied nowhere.**

- **Evidence.** §1.2's R8 row; op contradiction (g) (op:1506-1508).
- **Why it matters.**
  - A coach cannot move a private lesson; the coach has to cancel it, and the guest's online money is
    refunded.
  - The free cancel after a reschedule (R8) has no column to key on: `lessons.rescheduled_at` is not
    in the DDL.
  - A group session's `cutoff_at` must move with it, which no text says.
- **Fix.** R8 as written, plus:
  - `lessons.rescheduled_at`;
  - `lesson_cancel_mine` treats `rescheduled_at > enrolment.created_at` as free until the new start;
  - a group's `cutoff_at` moves while unchecked;
  - drop `SESSION_NOT_MOVABLE not_course`.

**[MINOR] D5. The CD-3 window end.**

- **Evidence.** db:1618 uses `start_at + 7 days`; gu:266 and gu:1357-1358 use `end_at`.
- **Fix.** R54: `end_at + 7 days`, which is what the decision says ("7 days after the lesson").

**[MINOR] D6. A queued move still changes a lesson's court.**

- **Evidence.** db:1064-1087 and D-16, against R7.
- **Fix.** Apply R7: `LESSON_VIA_COACHING` detail `court_only` for every lesson row.
  `RESULT_INVALIDATIONS` keeps `QK.coaching.all` on `reservation.update` (harmless).

**[MINOR] D7. R15's degraded check on joins and adds.**

- **Evidence.** db:1262-1263.
- **Fix.** Apply R15, or record why a join takes no court and amend R15.

**[MINOR] D8. `COACH_INACTIVE` order.**

- **Evidence.** db:1359-1360: `COACH_NOT_AT_BRANCH` and `COACHING_OFF` come before
  `COACH_INACTIVE`, so a paused coach's link reads "doesn't teach at this branch" when the branch is
  off.
- **Fix.** Harmless. Keep the order, and make the phone's paused state come from `coach_profile.status`
  (gu:877).

**[MAJOR] U1. The Arabic glossaries contradict each other on money words.**

- **Evidence.**
  - Guest: lesson = «حصة»; court share = «أجرة الملعب», "**not** «حصة الملعب»: حصة already means
    'lesson' here" (gu:1617, :1628).
  - The guest lane says the operator uses the same words (gu:1612).
  - Operator: lesson = «درس»; court share = «حصة الملعب»; coach's share = «حصة المدرّب»; group
    session = «حصة جماعية» (op:1134-1136).
- **Why it matters.**
  - The coach's statement (phone) and the manager's statement (operator) name the same figure two
    ways.
  - In the operator, «حصة» means both "session" and "share" on one screen: «حصة المدرّب» reads as
    "the coach's lesson".
  - The client reviews DRAFT-AR, but the conflict has to be fixed first.
- **Fix.** R55.
  - One glossary in `packages/i18n` used by both lanes.
  - «أجرة الملعب» for the court share and «نصيب المدرّب» for the coach's share, in both.
  - The lesson noun: one word in both apps, the client's pick (gu:1890).

**[MINOR] U2. Operator copy says the grid is for private lessons only.**

- **Evidence.** `SLOT_NOT_ON_GRID` "Private lessons start on the hour…" (op:1068), against R9.
- **Fix.** "Lessons start on the hour or at half past."

**[MINOR] U3. An uncounted plural.**

- **Evidence.** "Finish payment within {minutes}" (gu:951) has no `count.minutes` key (gu:1595-1608).
- **Fix.** Add the six Arabic forms, or show the time ("by 18:42").

**[MINOR] U4. The Android note.**

- **Evidence.** The remove and cancel reason "Other, then an optional note `Field`" (gu:1366-1367,
  :1376-1377). `nativeChoice` is an `Alert` (three buttons, no input on Android), and where the note
  is typed is not specified.
- **Fix.** An inline sheet with the reason segmented and the note field, as the hours editor does.

**[MINOR] U5. Coach-mode smoke cases name list primaries.**

- **Evidence.** `coach-mode.schedule`, `coach-mode-lesson.roster` and `coach-mode-statements.month`
  (gu:1672-1677) carry no label. The smoke contract asserts `makeT(locale)(<key>)`
  (`apps/mobile/CLAUDE.md`, Tests).
- **Fix.** Name each case's label or `nearbyKey`, as the guest suite does (gu:1683-1684).

**[MINOR] U6. Universal links.**

- **Evidence.**
  - Apple fetches AASA through its CDN, which refreshes on install or update and lags the origin.
  - The coaching build must be installed after `/c/*` is visible at
    `app-site-association.cdn-apple.com`, or `/c/` links open Safari until the next refresh.
  - A same-domain tap in Safari (the website's "Book in the app" to `/en/c/<id>`) never opens the
    app. It always lands on the fallback page, whose "Open in the app" scheme link then works
    (gu:1516-1517).
  - Android: one invalid `assetlinks.json` unverifies every path of the filter, match links included.
- **Fix.** Write all three into §6.1 step 3. Push the `LINK_PATHS` change before the `eas build`
  submit, and check the CDN copy.

**[MINOR] U7. The web `/coaching` e2e is "optional".**

- **Evidence.** gu:1741. It is a new public, indexed page with a price switch, in EN and AR
  (`apps/web/CLAUDE.md`: "Test every touched screen at `/ar`").
- **Fix.** Required, EN and `@ar`: prices hidden and shown, `/c/` fallback.

**[MINOR] U8. A coach can book themselves.**

- **Evidence.** `lesson_book_private` has no caller-is-the-coach check (db:1358-1360);
  `lesson_join` has one (db:1383).
- **Why it matters.** A coach can hold a court at desk pay as their own student (Q5), and their
  statement credits their own payment.
- **Fix.** R56: `ALREADY_ENROLLED` detail `coach` on `lesson_book_private` too, with U-copy.

## 7. Questions for Parsa

**Q1. A coach types a phone that belongs to someone else's account.**

- Today (R10) that account is linked at once:
  - it gets a push and the lesson;
  - it can cancel the lesson;
  - its customer record collects the lesson and any no-show (P3).
- **Should the linked person confirm first?**
- **Recommended: yes.**
  - My lessons shows "A coach added you to a lesson. Is this you?"
  - "Yes" links it. "Not me" unlinks it silently; the coach is never told.
  - Until confirmed, the desk and roster show the typed name and phone.
  - No reminders go out until confirmed.

**Q2. A guest made a coach gets a public name, bio and photo without being asked (C-7).**

- **Should the coach accept before the profile is public?**
- **Recommended: yes.**
  - On first open, coach mode asks "Your coach profile will be public on the app and the website" →
    Accept.
  - `coaching_public` lists only coaches who accepted.
  - The minimum alternative: the manager ticks "The coach agreed to this photo and bio being public"
    in Make a coach, and the tick is audited.

**Q3. A guest leaves a course that has started (C-9 says late; C-19 is about venue cancels).**

- Today they lose every online share, including sessions weeks away, and the freed place can be
  resold pro-rata.
- A late joiner whose first session is days away counts as late too.
- **Recommended:**
  - sessions starting outside the window are refunded, as C-15 pro-rata in reverse;
  - the next session, if inside the window, is kept;
  - "late" is judged against the guest's own first uncancelled covered session, not "the course is
    running".

**Q4. Should per-coach pay reach an LLM (the owner's assistant or the analytics model)?**

- **Recommended: no**, as `salary_deductions`:
  - statements are `excluded` in assistant coverage;
  - `report_coach_statements` and `report_lessons` are named in the SEC-29 gate as person-money
    reports that no assistant tool may call (R42).
- Aggregates (`owedToCoaches`, the lessons block) stay readable.

**Q5. Coaches can hold courts without paying.**

- `coach_book_private` for named walk-ins takes 30 courts a day, desk pay, with no strike (CD-2).
- `coach_create_group` and `coach_create_course` take courts at creation, released only at the
  cut-off (0..168 h, every session of a course).
- A coach can also book themselves (U8).
- **Recommended:**
  - refuse self-booking;
  - cap a coach's live future coach-booked private lessons (default 10);
  - flag "booked by the coach · unpaid" on the desk tile;
  - show coach-booked no-shows on the statement detail for the manager.

**Q6. Retired coaches.**

- **(a) Does retiring cancel the coach's future lessons, or refuse while any exist?**
  - R16 and the operator say cancel; DB says refuse.
  - **Recommended: cancel, as coach cancels**, mirroring CD-12.
- **(b) What can a retired coach still see?**
  - R16 says read-only coach mode.
  - **Recommended:** statements only (approved and paid), no rosters and no phones.

**Q7. Must the lessons section of the terms be accepted before any lesson money is kept?**

- **Recommended: yes.**
  - Online payment for lessons stays off until the terms bump with the lessons section is live.
  - `lesson_guest` checks that version (P10).

**Q8. A deleted coach's display name stays on the `coaches` row for statements (D-15).**

- **Recommended: keep it.**
  - It is the venue's pay record.
  - It never reaches a guest surface, because retired coaches are hidden.
  - The deletion text says so.

**Q9. Staff who coach.**

- **Should coach mode be reachable from the staff phone?**
- **Recommended: yes**, a "Coach mode" row in the staff hub (P4).

## 8. Tests and gates

**[MAJOR] G1. Assistant coverage and the map.**

- B4.
- This file and the concurrency review need `excluded` entries the day they are written.
- Every later edit of an `index:doc` contract makes `assistant-map.test.ts` stale until
  `assistant:map` runs in the same commit. That commit also starts `functions-deploy.yml`, because
  the map lives under `_shared/assistant/`.
- If the coaching build contracts stay `index:doc`, say so in R23, with the regeneration rule.

**[MAJOR] G2. The privacy test checks keys, not values.**

- **Evidence.** db:1987: "the public reads carry no student, phone, profile or court id (key scan)".
- **Fix.** Add value scans over the four public reads and `my_lessons`:
  - no `profiles.id` anywhere in the payload (P1);
  - no phone-shaped string.
- Add cases:
  - the CD-8 purge leaves the roster name a marker (P3c);
  - a retired coach's `coach_lesson` (P6);
  - a staff-coach `coach_me` (P4).

**[MINOR] G3. A contract key-set fixture (R41).**

- **Evidence.** The same drift happened in open matches (D12–D24) and again here (§5).
- **Fix.** `packages/core/src/coaching/shapes.ts` lists each read's keys.
  - DB tests assert `keys(rpc result) ⊇ shape`.
  - The client parsers import the same lists.

**[MINOR] G4. SEC-28 and SEC-29 lists.**

- SEC-28 (`check-broadcast-payloads.mjs:52-62`): DB's `/friend_names/i, /student/i, /share_bp/i`
  (db:1652) is fine; Money's `/student_/i` (mo:1276) is subsumed. One edit.
- SEC-29: R42.

**[MINOR] G5. `STATEMENT_NOT_DRAFT`'s catalogue line.**

- **Evidence.** It is first raised by DB's 0275 trigger (db:917, :940), and "Money writes the copy".
- **Fix.** `check-error-codes` fails 0275's commit unless DB adds the line there.

**[MINOR] G6. Missing e2e journeys.**

- **Evidence.** op:1232-1240 covers the desk, the manager and money. Not covered:
  - the owner approving a `lesson_price` and a `lesson_launch` run end to end, including a decide
    step on the staff phone;
  - a cashier taking payment from the customer record (R20);
  - `FORBIDDEN own_statement` for a manager who coaches (CM-11);
  - the desk staging a private lesson while coaching is off (D3);
  - retiring a coach with lessons (Q6);
  - an online lesson payment through the fake provider;
  - the web `/coaching` page (U7).
- **Fix.** Add them to `operator-coaching.spec.ts` and a `site-coaching.spec.ts`.

**[MINOR] G7. Gate fixtures named, and verified complete.**

- **Evidence.** Each of these is named, with an owner and a commit:
  - the rls-matrix drop 25 and its shapes (db:312-315);
  - the allowlist split (R12);
  - the coverage floor;
  - `verify-jwt.json` and `config.toml` for `lesson-begin` (mo:906-910);
  - `outbox-kinds.test.ts` and the `guest-push.test.ts` split (gu:357-360, :646-648);
  - the three `PIN_GATED_RPCS` copies (mo:1061-1064);
  - the SEC-20 `LINK_COLUMNS` and the `empty` route (db:945-950);
  - `lock-order-coaching.test.ts`;
  - `rpc-overloads` (to be dropped, R2);
  - the 0276 migration waiver.
- **Missing:**
  - the `COACH_DATA` declaration (P7);
  - the storage-purge proof (P2);
  - the docs entries for both reviews (G1);
  - the coverage name changes from R2 and R5 (X30).

## 9. Proposed rulings (for §1.12; they amend §1 and the lanes)

| # | Ruling |
| --- | --- |
| R40 | **Push fan-out.** Guest's AFTER INSERT trigger `lesson_events_notify` on `lesson_events` (0280, Guest) is the only queuer of every `lesson.*` and `coach.*` key except `coach.statement_ready` and `coach.statement_paid`, which Money's approve and mark-paid call directly. The trigger maps `(type, code, actor, enrolment)` with gu:467-501's tables. `paid_online` pushes `coach.new_student` only (no guest push: the payment screen is open). `expired` pushes `lesson.payment_expired`. `added` by a coach pushes `lesson.added_by_coach` to a linked student (subject to R44). DB writes no `lesson_notify` call; Money removes its `coach.new_student` and `lesson.payment_expired` calls. `lesson-push.test.ts` asserts every row of the mapping against real transitions. |
| R41 | **Read contracts.** §5 (X1–X29) of `drafts/review-rules-privacy-2026-10-01.md` is binding: the client lane's names where a client renders them. `packages/core/src/coaching/shapes.ts` holds the key lists. A DB test asserts each RPC's result keys ⊇ the list, and the clients' parsers read the same list. |
| R42 | **Person-money and LLMs (SEC-29).** `check-analytics-payload.mjs` gains `PERSON_MONEY_REPORTS = ['report_coach_statements', 'report_lessons']`. These are scanned for guest identity, but exempt from the coach patterns, and `tests/assistant-catalog.test.ts` asserts no assistant tool names them. The coach patterns are underscore-optional (`/coach_?id/i`, `/coach_?name/i`, `/coach_?(share\|iqd)/i`) and apply to every other scanned function. `/display_name/i` is dropped (staff and coach display names are public by design). `coach_statements` and `coach_statement_lines` are `excluded` in assistant coverage ("a coach's pay, money about a named person; never readable by the owner assistant or any LLM"). |
| R43 | **Coach photos.** The upload folder is a fresh random uuid (`coaches/<uuid>/<uuid>.<ext>`), never a profile or coach id. `app.storage_path_in_use` (re-issued in 0279) counts `coaches.photo_path`. Deletion (0286) and retirement queue the coach's folder for removal; a service edge path removes the objects within a day (the `protocol-action` precedent). The SEC-20 and privacy tests assert the queue and that no public payload contains a `profiles.id`. |
| R44 | **A typed student's identity.** For `booked_by_kind in ('coach','staff')` the roster, `desk_lesson_detail`, `desk_lessons.label` and the till always show the typed name and phone, never the profile's. The CD-8 purge writes a fixed marker into a typed name, never NULL. A coach add's push is due at `now() + 5 s` and nudged by the cron, so the linked and unlinked paths do the same synchronous work. If Q1 is yes: `lesson_enrolments.link_confirmed_at`, My lessons asks "Is this you?", "Not me" sets `guest_id` NULL silently, and no reminder goes out before confirmation. The privacy text gains "unless you cancel or change the lesson yourself". |
| R45 | **Coach-mode reach.** `coach_me` is read on Profile mount and from the staff hub whatever the coaching switches and the staff status say. Coach mode shows "Lessons are switched off at {branch}" instead of hiding. Per Q6: `set_coach_status('retired')` lives in 0280, cancels future lessons and courses as `coach_retired` (refunds and pushes) and never refuses. A retired coach's `coach_me` answers `{coach: {status: 'retired'}}`, and coach mode then shows statements only. `coach_lesson` and `coach_schedule` answer `NOT_A_COACH` for retired. |
| R46 | **Price shape.** `lesson_price`, `lesson_launch` and `coach_price` proposals carry `before.shape = {kind, duration_min, sessions_count, max_places (private)}`, and the target check compares it (`PRICE_TARGET_CHANGED` hint `lesson_type`). `upsert_lesson_type_internal` validates as the wrapper does. On a launched type, `duration_min`, `sessions_count` and a private type's `max_places` are `PRICE_VIA_PROTOCOL shape` for a manager, and the operator shows them read-only with "Make a new lesson type to change its length or sessions". The patch allowlist is named (PR4). Unlinking a coach from a type deletes their coach price. |
| R47 | **Cut-off at creation.** Every coach and desk creation, and every reschedule, refuses `LESSON_CLOSED` detail `cutoff` when the session (a course: session 1) would start within its `cutoff_hours`. |
| R48 | **Course adds close with sign-up.** `coach_add_student` and `desk_add_student` on a course refuse `LESSON_CLOSED` at `signup_closes_at`, as `course_join` does. D-13 is replaced. Group sessions keep "until the end" for walk-ins. |
| R49 | **SEC-20 for coaches.** `stored-fields.test.ts` gains `COACH_DATA` (reached through `coaches.profile_id`): `coach_time_off.reason` (User content, emptied on deletion), `coach_statements` money and `coach_statement_lines` money (a new `Financial info` category, `keep`: the venue's accounts), `paid_reference` (`keep`), `courses.title_*` (User content, `keep`). The deletion proof covers them. `paid_reference` and `void_reason` refuse any run of 12 or more digits (`INVALID_ARGUMENT`), and the Mark paid copy says "never a card or account number". |
| R50 | **Legal.** At the terms bump, before `coaching_enabled` with any online mode: `legal.*` delete-account (lessons cancelled and refunded; a coach's profile retired, photo removed, statements kept); privacy for students (gu:1640-1652) and for coaches (their public profile, hours, statements, who sees their phone); the terms' lessons section. Per Q7: `set_coaching_settings` refuses an online `lesson_payment_mode` until `platform_settings.lesson_terms_version` is set, and `lesson_guest(true)` checks it (`TERMS_REQUIRED`). |
| R51 | **Staff reads ignore the switch.** `coach_slots` answers a staff caller `is_staff_at` the type's branch whether coaching is on or off (D-12 staging). A paused coach answers `bookable: false, starts: []` to everyone. |
| R52 | **Error vocabulary.** §5's X31 table is binding. The operator drops codes no server raises (`NOTHING_OWED`, `SLOT_TAKEN` on a court move, `NOT_FOUND`, `COACHING_OFF` and `BEYOND_HORIZON` on desk booking). DB adds `BRANCH_HAS_BOOKINGS` to `set_coach_branches` when a removed branch has live lessons. Every detail a screen meets has its own sentence in both catalogs. |
| R53 | **Coverage now.** A docs-only commit, before any other push from this tree, adds `assistant-coverage.json` entries for every file under `docs/design/coaching/` (the drafts and both reviews included) and regenerates the map. R23's "in the commit" becomes "now, and again for every file added later". |
| R54 | **CD-3 window.** A coach sees a student's phone until `end_at + 7 days` of that session. |
| R55 | **One Arabic glossary.** `packages/i18n/src/glossary/coaching.ar.ts` (or a shared constants block) is used by `coaching.*` and `ws/coaching*`. «أجرة الملعب» is the court share and «نصيب المدرّب» the coach's share in both lanes. The lesson noun is one word in both apps (the client's pick). |
| R56 | **No self-enrolment.** `lesson_book_private`, `lesson_join` and `course_join` refuse the lesson's own coach (`ALREADY_ENROLLED` detail `coach`); `coach_book_private` and `coach_add_student` already exclude the coach's own phone (db:1474). Per Q5, a coach holds at most N (default 10) live future coach-booked private lessons (`COACH_ADD_LIMIT` detail `live`). |
| R57 | **Guard first.** Every staff coaching RPC checks `is_staff(…)` before any argument check or `current_venue()` (`desk_lessons`, `lesson_refunds_due`, `customer_lessons` named). |
| R58 | **Tests.** Add G2's value scans and cases and G6's e2e journeys. The guest held-roster rule (P13) and the shell-cache rule (P15) each get a unit test. |

## 10. Top fixes, ranked

1. **Give the pushes an owner (B1, R40).** As written, no student or coach is ever told anything.
2. **Settle the 29 contract rows in one table and pin them with a key-set fixture (B2, R41).**
3. **Unbreak SEC-29 without losing it (B3, R42), and keep coach pay away from the assistant (P8).**
4. **Add the coverage entries today (B4, R53).** The tree fails `pnpm security` now.
5. **Coach photos: no account id in the path; delete on account deletion (P1, P2, R43).**
6. **Typed-phone linking: confirm step and typed names everywhere staff look (P3, Q1, R44).**
7. **Coach-mode reach for staff, for switched-off branches and for retired coaches (P4–P6, R45,
   Q6, Q9).**
8. **Price protocol shape (PR1, PR2, R46).**
9. **Cut-off at creation, course adds, desk staging (D1–D3, R47, R48, R51).**
10. **Apply R8 for real (D4).**
11. **SEC-20 for coaches and the card-number guard (P7, R49).**
12. **Legal: web deletion page, coach privacy, terms before money (P9, P10, R50, Q7).**
13. **Error vocabulary (X31, R52).**
14. **One Arabic glossary (U1, R55).**
15. **Court hoarding and self-booking (Q5, U8, R56).**
