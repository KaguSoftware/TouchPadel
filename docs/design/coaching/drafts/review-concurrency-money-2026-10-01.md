> **Adversarial review, 2026-10-01. Lens: guard bypass, locks, money, state machines, gate fit.**
> A read-only review of the coaching design against `../build-contracts-2026-10-01.md` (§0, §1,
> and the §1.12 rulings R1–R23, which win over the lane files) and against the code on `main` at
> `d93bd9bf` (latest migration 0269). Nothing was run against a database. Every "latest body" below
> was found by extracting the last `create [or replace] function app.<name>(` across all 268
> migration files, not by grepping one spelling.
>
> Short names: `contracts:` = `build-contracts-2026-10-01.md`, `db:` = `db.md`, `money:` =
> `money.md`, `guest:` = `guest.md`, `op:` = `operator.md`, `walker:` =
> `packages/db/scripts/lib/lock-order.mjs`. `NNNN:line` is a line in
> `packages/db/supabase/migrations/2026…NNNN_*.sql`. Findings are numbered F1… so they do not clash
> with the decisions C-1…C-20.

# Review: concurrency and money (coaching)

## Verdict

The core holds. Two exclusion constraints make a double booking impossible whatever the locks do:
`reservations_no_overlap` for a court and `lessons_coach_no_overlap` for a coach (db:659-660). The
coach mutex then turns every race I built into a clean refusal rather than a raw 23P01:
- two guests booking one coach;
- two coaches taking the branch's last court;
- a booking against `hold_slot`;
- a join against a desk add;
- two desk settles of one enrolment;
- two webhooks for one payment;
- the sweep against a booking.

The declared order (coach after `match_money_advisory`, before `tabs`) has no static inversion in any
body the lanes specify, provided the text order rules in F13 are followed.

It is **not buildable as written**, for one reason:
- **F1.** DB's DDL forbids a `lesson_id` on an adjustment line, and Money's statement builder cannot
  work without one. Either the first adjustment raises 23514 and that coach's statements stop for
  good, or the builder drops the id and re-pays the same adjustment every month.

Nine more defects are major. Each one does one of four things:
- strands or over-refunds guest money;
- makes the day close disagree with the drawer;
- lets a guest hold courts and coaches with no cap and no strike;
- closes a lock cycle the contracts promise cannot exist.

Most of the fixes are a few lines. The proposed rulings R24–R41 at the end can be pasted into §1.12.

## What holds (checked, so nobody re-checks it)

**Every writer of `reservations`.** These are the 21 functions whose latest body contains
`update|insert into|delete from reservations` (none deletes). For each, what stops it from
touching a lesson row:

| Writer (latest) | Why it cannot touch a lesson row |
| --- | --- |
| `cancel_reservation` 0210:543 | Guest: `FORBIDDEN` (0210:569, `guest_id` is NULL on a lesson row). Staff: 0277's `LESSON_VIA_COACHING`. |
| `mark_reservation` 0262:3232, `extend_reservation` 0071:444, `staff_create_reservation` 0263:443 (`p_kind 'lesson'`), `open_tab` 0244:70 | 0277 refuses (db:1053-1059). |
| `move_reservation` 0150:37 | R7 refuses. db:1066-1087 and op:193 still describe a court change; R7 wins. |
| `release_hold` 0252:620, `deposit_prepare` 0242:327, `delete_my_account` 0264:56 | Ownership by `guest_id` (0252:649, 0242:356-358, `where guest_id = v_uid`). |
| `confirm_booking` 0242:1304 | Ownership for guests only. Staff are not refused: see F11. The CHECK `reservations_lesson_kind` still stops the write. |
| `deposit_apply`, `deposit_settle_success`, `trg_reservation_deposit` | Each is keyed on `purpose = 'deposit'` or on `reservation_id`, which is NULL on lesson rows (0267:64, :124, :147; 0258:930). |
| `match_try_book`, `mark_match_seats`, `desk_call_off_short` | Write only a match's own booking. |
| `hold_slot` | Inserts only; the exclusion constraint refuses an overlap. |
| `create_series` | Inserts through `staff_create_reservation` with `p_kind 'booking'` (0231:287-299). It locks its courts ascending (0231:237-245), the same order as the lesson bodies. |
| `block_courts_for_event` 0174:612 | Inserts only. It *lists* a lesson as a conflict (0174:708-723) and never cancels it. |
| `protocol_pass_tournament_plan`, `protocol_stop_tournament` | Cancel only their own `block_purpose = 'event'` rows (0174:545-549, :584-588). |
| `expire_stale_holds`, `match_expire_holds` | R1. See F9. |

Courts are safe too. `delete_court` refuses a court with any reservation (0074:52-64). `upsert_court`
refuses to deactivate a court with a future live row of any kind (0097:165-176).
`enqueue_reservation_push` returns at once for a row that is not `kind 'booking'` (0090:143). The
offline queue reaches only the five guarded RPCs, and a refusal there is a terminal `conflict`.

**Money that does not leak.**
- `onlineDeposits` (0265:348), `day_close_online` (0265:212), `deposit_net_paid` and the
  reconciler's first loop (0258:851-858) each filter `purpose = 'deposit'`.
- Every café reader goes through `cafe_settled_tabs`: `reports_figures`, `report_revenue`,
  `report_drill`, `analytics_daily_sales`, `analytics_courts_cafe`. So money's one extra predicate
  (money:513-519) is enough.
- `trg_match_booking_no_cafe` already fires on `update of tab_id` (0262:1432-1440), so a merge
  cannot carry goods onto a lesson tab. No writer can make a settled tab live again; the writers of
  `tabs` are `open_tab`, `settle_tab`, `settle_zero_tab`, `cancel_tab`, `merge_tabs`,
  `match_seat_settle`, `match_link_payment` (which needs a `reservation_id`, 0262:863),
  `create_guest_order` and `place_floor_order`.

**`compute_tab_totals` drop and create is safe.** All 14 latest callers read it by column name or
`select * into <record>`; none is `language sql` and no view depends on it:
- by name: 0015:793, 0244:731/760/885, 0039:246, 0067:230, 0217:974, 0262:727, 0262:1343;
- into a record: 0244:369/515, 0053:278, 0212:183, 0262:1135.

The TypeScript reader `tests/till-completeness.test.ts:85-87` ignores an extra key. Grants are
service-role only (0262:530-531), and money re-issues them.

**The enum value.** `alter type … add value` in 0270, alone, and first used by a CHECK and a trigger
`WHEN` in 0275/0277 of the same `db push`, works. Supabase applies each file in its own transaction.
The precedents 0143→0144 (`d0104ddf`) and 0155→0156 (`f6a0802c`) each landed in one commit and one
push.

**The status-only argument (R6).** A cancel that moves a court row out of
`status in ('pending','confirmed','arrived')` cannot create an overlap. A concurrent inserter that
meets the old version waits on its `xmax` and then sees no conflict. That wait can close a cycle only
if the canceller later waits on something the inserter holds. The only such row is a stale lesson
hold (F12). The rest of the 0042 reasoning carries over.

## Defects

### F1. Blocker. Adjustment lines cannot carry a lesson, so statements stall or re-pay

**Where.**
- db:854: `constraint coach_statement_lines_kind check (is_adjustment = (lesson_id is null))`,
  accepted by contracts:472-474 because no ruling touches it.
- money:972-982 (§7.2 step 4 "booked lines of a lesson L" and step 6 "an adjustment line … of
  collected_L − booked_collected(L)"), money:209-214 (unique `(statement_id, lesson_id)`, index on
  `lesson_id` "for the look-back"), money:1342-1343 (invariant L8: Σ of a lesson's lines on
  approved, paid and draft statements = `coach_L`), money:1088-1092 (detail lines carry `lesson_id`
  and `is_adjustment`).

**Scenario.**
1. September is approved with a regular line for lesson L: collected 40,000, coach 18,000.
2. On 10 October the guest's online payment for L gets a manager goodwill refund of 10,000
   (`staff_refund`, allowed: L's money is final).
3. On 1 November at 03:00, `coach_statements_draft` builds October. L is in the look-back with a
   booked line, so step 6 writes an adjustment line for L (collected −10,000, coach −6,000), with
   `lesson_id = L`.
4. The CHECK raises 23514. The cron's per-pair `exception when others` swallows it as a warning
   (money:1001-1002). October is never drafted for this coach, and every refresh or approve that
   reaches the build fails the same way.
5. CM-8 forbids a newer draft while an older month is missing, so November, December and every later
   month are blocked for that coach. `coach_statement_approve` also builds the next month's draft in
   its own transaction (money:1042-1044). Once that month is complete, approving the earlier month
   raises too.

If the builder satisfies the CHECK instead, by writing adjustments with `lesson_id` NULL, step 4's
`booked_coach(L)` never sees them. Every later draft then recomputes the same −6,000 (or +18,000
after a void) and books it again. That is a repeating overpayment or clawback.

**How often.** This happens on the first refund after an approval, and on any lesson that ends after
the 03:00 run (money:994-995).

**Fix.** Drop `coach_statement_lines_kind`. Every line carries `lesson_id` (adjustments too);
`is_adjustment` means "this lesson already had booked lines". Add `coach_statement_lines_lesson
check (lesson_id is not null)` and keep the unique `(statement_id, lesson_id)`. Add a test that drafts,
approves, refunds and redrafts twice, and asserts that the adjustment appears once (R24).

### F2. Major. With the default `cutoff_hours = 0`, the sweep cancels a session after it starts, and an under-filled course still charges session 1

**Where.**
- `lesson_types.cutoff_hours … default 0`, and 0 is allowed for group and course (db:505, :519-522);
  `lessons.cutoff_at` = start − cutoff_hours (db:666-667).
- The sweep judges `cutoff_at <= now()` with no test on the start (db:1772, :1789-1790).
- `lesson_cancel_internal` refuses nothing that is `scheduled` (db:1316-1317, :1335-1338).
- `course_cancel_internal` cancels only sessions with `start_at > now()` (db:1339-1341).
- money:310: a `course_cancelled` enrolment keeps every session that was not cancelled.

**Scenario, group.** Min 3, cutoff 0, 18:00 start, two booked, one online. The cut-off is 18:00, and
the sweep runs at 18:00:40, after the start. It cancels the session `under_filled`, and the guests'
court row turns `cancelled` while they are on the court. The online money is refunded, and the
`lesson.under_filled` push lands after they have started playing. A coach-cancel of the same session
would have been refused `started` (db:1543).

**Scenario, course.** Min 4, cutoff 0, three enrolled at 100,000 for four sessions. The sweep judges
after session 1 has started. Session 1 is skipped (`start_at > now()` is false) and runs. The course
is cancelled from session 2. Each enrolment refunds only sessions 2–4 (75,000), the venue keeps
25,000 for an under-filled class, and the coach is paid on it.

C-14 says an under-filled course is cancelled and refunded. With the default settings it never is.

**Fix (R26).**
- `lesson_types_cutoff check (kind = 'private' or min_places = 1 or cutoff_hours >= 1)`. Writers
  default a group or course type to 2 hours.
- The sweep judges a cut-off only while `now() < start_at` of the session (for a course, of
  session 1).
- A judgement that arrives late (the coach was skipped, the cron stalled) stamps
  `cutoff_checked_at`, writes an `under_filled` event with `data {late: true}` for the desk, and
  cancels nothing.

### F3. Major. The day close dates a lesson refund by the payment's day, so every later desk refund shows as a cash shortage

**Where.**
- `close_day` counts refunds `where p.day_session_id = v_day.id`, the PAYMENT's day (0216:190-200).
- `v_day_close_summary` does the same (0106:1080-1084).
- `app.refund` computes the open day (0217:95) and stores it nowhere (0217:129-131). The refund
  carries `till_shift_id` (`src/types.gen.ts:9812`).
- money:1241-1243 ("close_day is untouched"); money:570-589 (desk refunds of lesson money go through
  `app.refund`).
- `reports_figures` dates the same refund by `r.created_at` (0265:331), so the two disagree.

**Scenario.**
1. Monday: a guest prepays a private lesson at the desk, 40,000 in cash. The payment is on Monday's
   day session.
2. Wednesday: the coach cancels. `lesson_refunds_due` lists 40,000, and the manager pays it out of
   Wednesday's drawer.
3. Wednesday's `close_day`: the expected cash leaves the refund out (its payment is Monday's), so
   counted cash is 40,000 short. `cash_variance_iqd` is −40,000 against the cashier.
4. Monday's stored figures never move.

This is not an edge case. A desk refund of lesson money is almost always for a payment taken on an
earlier day: a free cancel outside the 12-hour window, a coach cancel, an under-filled cut-off, or
the rest of a course. The same flaw exists today for a café refund of yesterday's bill. Coaching
makes it the normal path.

**Fix (R27).** `close_day`, `v_day_close_summary` and `day_close_online` count a refund on the day
its till shift belongs to: `coalesce((select ts.day_session_id from till_shifts ts where ts.id =
r.till_shift_id), p.day_session_id)`. Every refund is stamped with its open shift; `close_day`
already reads `till_shifts.day_session_id` (0216:177). Money owns the change, in 0278 or 0285. Add a
`desk-payment.test.ts` case with a refund on day 2 of a payment taken on day 1.

### F4. Major. A cancel refunds only live enrolments, so a late canceller's money for sessions later cancelled is never refunded automatically

**Where.**
- `lesson_cancel_internal` and `course_cancel_internal` cancel "every **live** enrolment"
  (db:1335-1337, :1341-1342); `enrolment_cancel_internal` re-reads its row and returns at once for
  one that is no longer live (db:1316-1317).
- Money expects the refund call "for **every** enrolment … whatever its status: a `guest_late`
  enrolment is refunded when the coach later cancels the session" (money:399-402, :1496-1500).
- R5 (contracts:482) names the function and leaves the call sites as DB wrote them.
- The safety net: the reconciler's lesson loop needs `e.updated_at > now() - interval '30 days'`
  (money:806). `lesson_refunds_due` lists an online refund only when no refundable row exists
  (money:573-574).

**Scenario.**
1. An 8-session course at 160,000 (20,000 a session), paid online. The guest drops out in week 2.
   The course is running, so the cancel is always `guest_late`, and the venue keeps the money for
   the sessions still to come.
2. Week 7: the coach is injured and cancels the rest. `course_cancel_internal` cancels sessions 7–8
   and refunds every *live* enrolment. The guest's is already `cancelled`, so nothing calls a refund.
3. The engine now says `refund_due_online = 40,000` (sessions 7–8 no longer count).
4. The reconciler skips the row: the enrolment was last updated 5 weeks ago.
5. `lesson_refunds_due` skips it: the row is still refundable.

Only `deposit_attention` lists it (its lesson twin has no window). The money stays with the venue
unless a manager notices the item. Money's own test R3 (money:1384-1385) expects the late
canceller's refund to happen in the cancel's own transaction. It will fail.

**Fix (R28).** The two internals call `lesson_refund_start` for every enrolment of the lesson, or
of the course, that has an applied online row, live or not, after the status writes. The
reconciler's lesson loop drops the 30-day window. Its `refund_due_online > 0` predicate already
keeps kept rows out of the limit.

### F5. Major. R5's `p_from_session` invites a refund of sessions already given; the account-deletion reason disagrees

**Where.**
- R5 (contracts:482): `lesson_refund_start(p_enrolment_id, p_reason, p_from_session smallint
  default null)`.
- db:1866-1870: the amount is "everything, or Σ `course_share_for` over the sessions ≥
  `p_from_session_no`".
- db:1327: an `account_deleted` enrolment refunds as `guest_cancel` with no `from`.
- Sweep item 3 selects a deleted profile's enrolments "whose … course's last session has not
  started" (db:1767-1768), which includes a running course.
- Money computes the amount from the engine, `refund_due_online_iqd` (money:407-422), and its reason
  set has `account_deleted` (money:176-179, :415).

**Scenario.** A guest with an online 160,000 enrolment in a running course deletes their account
after session 3. The sweep calls `enrolment_cancel_internal(e, 'account_deleted')`, which calls
`lesson_refund_start(e, 'guest_cancel', NULL)`. If R5 is built literally, NULL means "everything":
160,000 goes back, including the 60,000 for the three sessions the guest attended. CD-12 refunds
only future sessions.

The engine-based amount would be 100,000. The two definitions agree in the common cases (a whole
private lesson, a course cancelled from session k), which is exactly why tests built from those cases
will not catch it.

**Fix (R28).**
- `lesson_refund_start` takes no `from`: its amount is always the engine's `refund_due_online_iqd`,
  the one money source.
- The reason comes from the enrolment's `cancel_kind` and the lesson's or course's `cancel_reason`,
  as money:412-418 does. `account_deleted` stays `account_deleted`.
- A test deletes a guest mid-course and asserts the refund is the shares of the sessions not begun.

### F6. Major. A late success on a still-`held` group or course enrolment books it without checking places

**Where.**
- `lesson_places_taken` and `course_places_taken` count a `held` enrolment only while
  `hold_expires_at > now()` or its payment is within ten minutes of its deadline (db:1295-1299).
- `lesson_settle_success`'s normal (`held`) branch re-checks nothing for a group or course; it moves
  `held → booked` (money:745-758).
- Its `expired` branch does re-check places (money:767-769).

**Scenario.**
1. A group of 8 places has 7 booked. G1 joins online, so G1 is `held` with a payment whose deadline
   is 18:15. Qi is slow.
2. At 18:25:30 the ten-minute grace is over, so G1 no longer counts. The sweep has not reached the
   coach yet: at most a minute, longer while the coach is busy and try-locked away.
3. At 18:25:40 G2 joins at the desk and takes the 8th place.
4. At 18:25:50 the reconciler's check returns SUCCESS for G1. G1 is still `held`, and the branch
   books G1.

That is 9 of 8. `places_left` goes to −1 on the public reads (`coaching_public`, `lesson_offer`).

**Fix (R29).** In the `held` branch, a group or course enrolment re-checks `lesson_places_taken`
(or `course_places_taken`) plus its own party against `max_places`, with the enrolment excluded,
under the coach lock that `deposit_apply` already holds. When it does not fit, the reason is
`slot_lost`.

### F7. Major. An online private lesson is a court hold with no cap and no strike: a free way to block a coach and a court

**Where.**
- The per-guest hold cap counts `guest_id = v_uid and kind = 'hold'` (0269:183-193).
- The hold ladder settles only holds with `guest_id is not null` (0252:241).
- A lesson's hold row has `guest_id` NULL by design (db:1998 D-1; db:69-72: "a lapsed lesson hold
  never becomes a hold-ladder strike"; situation 8, db:1949).
- `lesson_strikes.kind` is `late_cancel | no_show` only (db:770).
- `lesson_book_private` has no cap on the caller's live `held` lessons (db:1347-1377).

**Scenario.** A script with one account books a private lesson with `p_payment_mode 'online'` in
every free 30-minute slot of every coach at a branch, and never pays. Each booking takes:
- the coach, through `lessons_coach_no_overlap` while the lesson is `held`;
- a court, through its `hold` row;
for 15 minutes, extended to the payment deadline by `lesson_payment_prepare`, plus ten minutes of
grace if it opened Qi.

No cap stops it, no strike accrues, and `HOLD_COOLDOWN` and `BOOKING_SUSPENDED` never trip. Joins can
do the same to group places: one per lesson per account (the unique index on `(lesson_id, guest_id)`
stops the same account twice). D-4 ("a suspended guest is suspended everywhere") assumes lapses
strike, and these never do.

**Fix (R30).**
- `lesson_book_private` with `online` takes `lock_principal('hold_slot', caller)`, the key
  `hold_slot` takes (0269:113), so the two caps are counted under one lock. It refuses
  `HOLD_QUOTA_EXCEEDED` when the caller's live court holds plus their `held` private lessons reach
  `max_live_holds_per_guest`.
- `lesson_strikes_kind` gains `lapsed_hold`. `lesson_hold_expire` writes one for a guest-booked
  enrolment that expired with no `succeeded` payment. `hold_strikes_settle` settles it like the
  others.
- Online joins count against the same cap.

### F8. Major. A strike settle and an attendance correction can deadlock: a lesson booking holds a strike row and waits for the coach, the coach-lock holder waits for that row

**Where.**
- `lesson_book_private`, `lesson_join` and `course_join` settle the caller's ladder before
  `lock_coach` (db:1354-1357, :1366-1367, :1379-1381).
- The re-issued settle runs `update lesson_strikes set settled_at = now() … where … and settled_at
  is null` (db:1750-1752).
- `coach_mark_attendance` and `desk_mark_attendance` hold the coach lock and delete the unsettled
  strike on `attended` or `clear` (db:1558-1560).
- db:189-191 and situations 19 and 21 (db:1960, :1962) promise no cycle.

**Interleaving** (one coach C, guest X, strike S = X's `no_show` on lesson L, still unsettled):

| t | G = X books the next session with C (`lesson_join`) | M = C corrects X to `attended` |
| --- | --- | --- |
| 1 | `lock_principal('lesson_guest', X)` | |
| 2 | settle: `update lesson_strikes` S, so G holds S's row; `hold_strike_apply` | |
| 3 | | `lock_coach(C)`: granted |
| 4 | `lock_coach(C)`: waits for M | |
| 5 | | `delete from lesson_strikes` S: waits for G |

That is a 40P01 after `deadlock_timeout`. Either the guest sees a raw error, or the coach's
correction fails. A `no_show` re-mark has the same shape: its `insert … on conflict do nothing`
(db:1739-1740) waits on G's uncommitted version of S. The window is narrow (a correction made in the
minute before `tp_hold_strikes`), but it is the 0268 class the contracts set out to close, and the
walker cannot see it (`lesson_strikes` is not ranked and these are not `FOR UPDATE`).

**Fix (R31).** Neither side may wait on a strike row.
- The attendance delete becomes `delete from lesson_strikes where ctid in (select ctid from
  lesson_strikes where enrolment_id = … and lesson_id = … and settled_at is null for update skip
  locked)`. A row being settled is treated as settled; staff lift the ladder with
  `hold_standing_decide`.
- `lesson_strike_record` checks for the row first, with `skip locked`.
- The settle's lesson-strike loop selects `… for update skip locked`.
- Add a two-connection race test (the 0268 test shape).

### F9. Major. R1 contradicts itself, and the strict reading leaves a cancelled held lesson's court row pending until its slot passes

**Where.**
- R1 (contracts:478) says three things:
  - the expiries' "orphan clause skips rows with a `lesson_id`";
  - "A lapsed lesson hold is expired **only** by Money's `lesson_hold_expire` … called by
    `lesson_sweep`";
  - until then the court "refuses a booking with `SLOT_TAKEN`" (also contracts:539-541).
- The first sentence is db:1037-1049 and money:1481-1485. A hold past `hold_expires_at` is still
  expired lazily, so the third sentence is false under it. The second and third sentences describe a
  different rule: the expiries skip lesson holds entirely.
- db.md relies on the lazy expiry. A lesson body leaves a stale hold row "to `expire_stale_holds`"
  (db:161-163, :286-287, :1785-1786, D-19 at :2016).
- `lesson_hold_expire` acts only on a `held` enrolment (money:784-785).

**Scenario under the binding reading (rulings win).**
1. A guest books an online private lesson, opens Qi at 18:00 (deadline 18:15) and abandons the
   page. The payment stays `created`.
2. At 18:20 they press Cancel in My lessons. The lesson is `held`, so the cancel is `guest_free`:
   the lesson and the enrolment are cancelled.
3. The hold is past `hold_expires_at`, so per db:161-163 the cancel leaves it to
   `expire_stale_holds`.
4. Under strict R1, `expire_stale_holds` skips every lesson hold, and `lesson_hold_expire` never
   runs (the enrolment is no longer `held`).
5. The row stays `pending` until its slot is in the past. `court_availability` hides it
   (`hold_expires_at < now()`), so the court shows free, and every booking there gets `SLOT_TAKEN`.
   The court cannot be deactivated (0097:165-176), and the branch cannot be closed.

The sweep's items 3–4 (a deleted student, a retired coach) do the same to a held lesson whose hold
is stale.

Under the other reading the lane files work. That reading still needs one guard: a revival or a re-pick
can meet the old hold row still `pending` and raise 23505 on `reservations_one_live_per_lesson`,
which `lesson_settle_success` does not catch (money:752-756, it catches `exclusion_violation`
only), so `deposit_apply` answers 500 until `tp_hold_sweep` runs.

**Fix (R25).**
- Read R1 as db:1043 only: the orphan clause becomes `(r.guest_id is null and r.lesson_id is
  null)`, and a lesson hold expires by TTL like any hold.
- Strike R1's "only" sentence and the `SLOT_TAKEN` limit (contracts:539-541).
- Every cancel path expires its lesson's `pending` hold row whatever its staleness, through a
  statement that never waits (F12).
- `lesson_settle_success` maps `unique_violation` to `slot_lost` as well.

### F10. Major. R8 widens reschedule to every kind, but the lane body, the cut-off and the held state were written for course sessions only

**Where.**
- R8 (contracts:485) lets private, group and course sessions be rescheduled.
- The reschedule body still refuses `not_course` (db:1500-1501). D-10 (db:2006) says only course
  sessions move. op:1506-1508 asks DB to state the rule.
- Step 10 moves `cutoff_at` only for "session 1 of a course whose `cutoff_checked_at` is NULL"
  (db:1513-1514).
- A group session's `cutoff_at` is its own start minus `cutoff_hours` (db:666-667).

**What goes wrong once R8 is built on that body.**
1. *A group moved earlier.* An 18:00 group with a 2-hour cut-off (16:00) is moved to 14:00, and
   `cutoff_at` stays at 16:00. The session runs at 14:00; at 16:00 the sweep (item 5, no start test,
   F2) judges it under-filled and cancels a session that has already been played, refunding the
   guests who played it. A cancelled lesson is not a statement lesson (money:935-939), so the coach
   is not paid for it.
2. *A group moved later.* Judged at the old cut-off, a day early. A judged session moved later is
   never judged again for its new date.
3. *A held private lesson.* `desk_move_lesson_court` refuses `held` (db:1520-1521); the reschedule
   does not. A guest who is mid-payment for 18:00 pays for a lesson that now starts at 20:00, and
   the hold row moves under an open Qi attempt.
4. *The free cancel after a reschedule* (R8) needs `lessons.rescheduled_at` compared with the
   enrolment's `created_at`. That column has no definition (it is not in db:608-661).

**Fix (R32).**
- The reschedule refuses `held` (`INVALID_TRANSITION` detail `held`).
- A group session's `cutoff_at` moves with its start. `cutoff_checked_at` is cleared when the new
  cut-off is still in the future, and kept when the move is inside the old cut-off, so the session
  stays confirmed.
- `lessons.rescheduled_at timestamptz` joins §1.2.
- D-10 is struck, and db:1500's `not_course` refusal goes.

### F11. Minor. `confirm_booking` lets staff confirm a lesson's hold row; only a CHECK stops it, with a raw 23514

**Where.** 0242:1331-1334: the ownership refusal applies only `if not app.is_staff(...)`. 0242:1374
passes (`guest_name 'Lesson'`). 0242:1402-1410 sets `kind 'booking'` and a price. db:67-72 says
`confirm_booking` is closed by ownership, which is true for guests only. 0277's list (db:1053-1059)
does not include it.

**Scenario.** The desk grid shows a held lesson as a hold. A court_desk user presses Confirm (the
staff confirm-a-phone-hold path). `reservations_lesson_kind` (or `reservations_lesson_row`)
raises 23514, and the operator shows an unmapped error.

**Fix (R35).** 0277 adds `confirm_booking` (latest 0242:1304) to the `LESSON_VIA_COACHING` list,
detail `confirm`, placed right after the `FOR UPDATE` read.

### F12. Minor. Status-only writers that touch many court rows can deadlock with `hold_slot` over a stale lesson hold

**Where.**
- §2.3 and §2.4 item 4 (db:161-163, :184-188) rest on "a lesson body writes a hold row only while it
  is not stale". "Not stale" is judged against the writer's `now()`, which is its transaction's
  start.
- `hold_slot` (0269:200-203) and the branch expiries select stale holds `FOR UPDATE` by their own
  later `now()`.
- The sweep (up to 200 items, one transaction), `set_coach_status` retiring (R16) and
  `course_cancel_internal` all write many court rows.

**Interleaving** (the db.md reading of R1, where an expiry may take a lesson hold):
1. Sweep run S starts at 18:00:00.0.
2. Item A cancels the under-filled group lesson L1, court 3, 19:00–20:00. Its row R1 becomes
   `cancelled`, uncommitted.
3. `hold_slot` H (started 18:00:01) takes court 3. Its expiry over 19:30–20:30 locks H2, the
   held private lesson L2's hold (20:00–21:00, `hold_expires_at` 18:00:00.4: stale for H, live for
   S).
4. H inserts its row and meets R1's in-progress `xmax`, so H waits for S.
5. S reaches item B (L2's coach was retired) and updates H2, so S waits for H. 40P01.

Either the item is lost for this minute, or the guest sees a raw deadlock.

**Fix (R25).** Every status-only write of a lesson's `hold` row is `update reservations set status =
'expired' where id in (select id from reservations where id = <hold> and kind = 'hold' and status =
'pending' for update skip locked)`. A hold locked by an expirer is being expired anyway. The same
statement closes F9.

A related rare cycle: `delete_my_account`'s scrub of `lesson_enrolments` (db:1824-1828) updates
several rows in heap order, while the sweep updates the same guest's enrolments in item order. Lock
them first with `where id in (select id … order by id for update)`.

### F13. Minor (CI turns red unless edited). Lock-gate edits that neither lane lists, and two text-order traps

1. `tests/lock-order-matches.test.ts:228` and `:301` pin `deposit_apply`'s printed row to
   `court_advisory -> reservations -> match_venue_advisory -> match_tickets`. After 0281 it starts
   with `coach_advisory`, so the stack half of the test fails in the CI db job. db:210-211 updates
   only `DECLARED` and `SERVICE_WALK`, and money:1317-1319 adds a synthetic case.
2. `:75` asserts `SERVICE_WALK` equals an exact list. DB adds three names (db:202). Money also adds
   `lesson_payment_prepare` (money:1309-1311, §14 Addition 6). The two lanes must ship one list.
3. Rule 3 exempts by the **walked** name (walker:293). If a cancel internal reads its court row
   `FOR UPDATE`, every cancel RPC that calls it prints `coach_advisory -> reservations` with no
   court lock and fails. Adding the internal's name to `STATUS_ONLY_RESERVATION_WRITERS` does not
   help. R6 says the cancels "join" the set, and db:196-206 lists no such edit. The simplest rule:
   no `FOR UPDATE` on `reservations` in any cancel, mark or sweep body; guarded `update … where
   status in (…)` only.
4. Level M (reschedule, desk move) and the revival inside `deposit_apply`: a `FOR UPDATE` of the
   lesson's court row placed **after** `match_expire_holds` reads `… match_tickets -> reservations`
   (the trigger is expanded under the expiry's write) and breaks Rule 1. This is precedent C1 of the
   open-matches review. The safe order: courts, then the row `FOR UPDATE`, then
   `match_expire_holds`, then the writes. That order also lets `deposit_apply` clear stale holds
   before a re-pick, which money:731-735 currently forbids (so a stale hold today makes a spurious
   `slot_lost`).

### F14. Minor. Paperwork that breaks at run time or at the gate

- **R2 not propagated.** db:1392 and :1863, and money:246, :257, :266, :353 still call
  `app.split_evenly(bigint, int)`. Under R2 there is no such signature, so PL/pgSQL fails at the
  first course join with "function does not exist". The migration itself succeeds, because the call
  binds late. money:605 still adds an `rpc-overloads.json` entry, and
  `tests/rpc-overloads.test.ts` would then fail against `pg_proc`.
- **`constraint-validating` exempts only a statement that starts `create table`**
  (`check-migrations.mjs:369-376`). Any constraint Money adds to DB's new tables with `alter table …
  add constraint` (for example `coach_statement_lines_sign`, money:210-212) must be inline in the
  `create table` or `NOT VALID` plus validate. Otherwise 0275 needs a waiver nobody planned.
- **The 0276 waiver is local only.** On a push to `main`, `check-migrations` diffs `origin/main`
  against HEAD, which is the same commit, so it judges no file (`check-migrations.mjs:61-64`,
  `ci.yml:114-118`). The non-concurrent unique indexes on `reservations`, `tabs` and
  `booking_payments` take SHARE for a full scan with `lock_timeout 3s`. On a busy evening `db push`
  can fail midway, leaving 0270–0275 applied. Push outside trading hours, or move those three into
  their own `CONCURRENTLY` files.

### F15. Minor. `lesson_pick_court` can pick a court the caller never locked

**Where.**
- `lesson_lock_branch_courts` locks the active courts of its own snapshot (0260:112-122 shape).
- `lesson_pick_court` re-reads `courts` in a later statement (db:1291-1293).
- `upsert_court` re-activates a court with no court lock (0097:87-206).

**Scenario.** A manager re-activates court 5 while a course creation holds courts 1–4. The pick
sees court 5 and inserts there without its key, while a `hold_slot` that holds court 5's key inserts
an overlapping row. Two inserters in the GiST check without a court lock give the 40P01 that 0042
removed.

**Fix (R34).** `lesson_lock_branch_courts` returns the `uuid[]` it locked, and
`lesson_pick_court(p_venue, p_period, p_locked uuid[])` chooses only from that set (the revival in
`lesson_settle_success` included).

### F16. Minor. The revival breaks DB's state machine and a CHECK; done wrongly it loops the webhook

**Where.**
- DB: `expired` is terminal (db:248-249, and the §3.2 table at db:251-267).
- Money revives `expired → scheduled` and `expired → booked` (money:759-770). It clears the
  enrolment's `cancel_kind` and `cancelled_at`, but not the lesson's `cancel_reason` and
  `cancelled_at`, which `lessons_ended` requires to be NULL off `cancelled|expired` (db:648-651).
- money:737-739: `lesson_settle_success` "never raises on a valid row".

**Outcome.** A late SUCCESS on an expired private lesson raises 23514 inside `deposit_apply`. The
webhook answers 500 and the reconciler re-checks every 90 s for ever, with the guest's money taken
and no lesson.

**Fix (R29).** The revival clears the lesson's `cancel_reason`, `cancelled_at` and
`hold_expires_at`. It writes `lesson_events` `paid_online` with `data {revived: true}`. Any
`check_violation`, `unique_violation` or `exclusion_violation` in its sub-block maps to `slot_lost`.
DB's §3.1 and §3.2 gain the two transitions, writer Money.

### F17. Minor. Desk lesson refunds are bounded per payment, not by what is due

**Where.**
- `app.refund` checks only `refunded + amount ≤ payment` (0217:122-127).
- The lesson refund rides the queued `payment.refund` with a typed amount (op:645-655,
  `RefundDialog`).
- money:585-589 relies on `REFUND_EXCEEDS_PAYMENT`.

**Scenario.** A course paid at the desk, 100,001, is cancelled after session 2, so 50,000 is due.
Two managers at two tills, or one till's offline queue replaying after another manager already paid
it, each refund 50,000. Both pass (100,000 ≤ 100,001). The guest gets 100,000.

**Fix (R36).**
- Money re-issues `app.refund`. For a payment on a `kind 'lesson'` tab it resolves the enrolment and
  coach unlocked, then takes `lock_coach` before the `tabs` lock. The order stays `day_sessions →
  coach → tabs → payments → refunds`.
- It refuses an amount above `refund_due_desk_iqd` with a new `REFUND_EXCEEDS_DUE`, unless
  `p_reason_code = 'lesson_goodwill'`. A queued replay records the refusal as a conflict.

### F18. Minor. A closed branch's coaches can never be paid, and its desk refunds can never be made

**Where.**
- `is_staff_at` is false for a closed branch, the owner included (`packages/db/CLAUDE.md:149`).
- Every statement write starts with it (money:1027-1031), as do `lesson_refunds_due` (money:572) and
  `app.refund` (0217:63-66).
- `close_branch` refuses only live rows (db:1031).

**Scenario.** A branch closes on the 15th. On the 1st the cron (service role) drafts the half month
for each coach, and no manager or owner can approve it or mark it paid. Desk refunds due at the
branch are frozen the same way.

**Fix (R37).** `close_branch` also refuses, `BRANCH_HAS_BOOKINGS` with detail `coaching_money`,
while the branch has any statement in `draft|approved`, any lesson month not yet drafted, or any
`refund_due_desk > 0`.

### F19. Minor. The cut-off counts a guest who is still paying

`lesson_places_taken` counts a `held` enrolment while its payment is open (db:1295-1299), and the
sweep judges once and stamps (db:1789-1791, D-11).

**Scenario.** Minimum 3, with 2 booked and 1 mid-Qi. The session is confirmed and stamped. The
payment fails, so the session runs below its minimum and is never judged again. Counting booked
only does the opposite: it cancels a session whose third guest's success then arrives as `slot_lost`.

**Fix (R38).** The cut-off counts `booked` places. When `booked < min_places ≤ booked + live held`,
it defers (no stamp) until the held ones resolve or until `start_at − 10 minutes`, whichever comes
first, and then judges on `booked`.

### F20. Minor. Adding a student during a course's last session has no session to price

`coach_add_student` and `desk_add_student` accept a course until its last session's **end**
(db:1469-1470, :1490). The price is the sum over sessions with `start_at > now()` (db:1392-1394),
which is empty during the last session. So `first_session_no` is NULL and `sessions_covered` is 0,
and `lesson_enrolments_course` raises 23514 (db:713-715).

**Fix (R39).** Refuse with `LESSON_CLOSED` once the last session has started (the guest rule, C-15).

### F21. Minor. Coach locks held longer than the lanes assume

- `coach_statements_draft` takes every coach's lock in turn and holds them all to the end of the run
  (money:1003-1007), while each build re-runs the money engine over a 12-month look-back for every
  lesson (money:974-976, :1601-1602). With 20 coaches and 100 lessons a month each, the first
  coach's bookings wait for the whole chain's run, well past "a few hundred ms", and past PostgREST's
  statement timeout. **Fix (R40):** make it a procedure that commits after each pair (pg_cron can
  `CALL` it), so no coach is held longer than its own build.
- The reminder triggers resync whole lessons (guest:419-456). A course cancel writes up to 52
  sessions and 16 enrolments, and each enrolment write resyncs every covered session. That is
  hundreds of `delete from notification_outbox … where payload->'params'->>'lesson_id' = …` scans of
  the due set, all under the coach lock (and under the sweep's many locks). Guest should resync once
  per lesson per statement (a statement-level trigger, or a de-duplicating transaction-local
  `set_config` list).

### F22. Minor. Statement voids and negative totals

- CM-10 allows a void from `approved` (money:1045-1050). The money is handed over outside the till,
  and the PIN is asked only at "mark paid" (R4). A coach paid in cash on approval and then voided is
  paid again on the next draft. **Fix:** a void from `approved` consumes a manager PIN grant, as mark
  paid does, and the confirm copy says that cash may already have been handed over.
- Nothing stops marking a negative statement paid (money:1051-1060). **Fix:** `STATEMENT_NOT_APPROVED`
  detail `negative` when `coach_iqd + adjustments_iqd < 0`. A negative month is carried forward by a
  void, per CM-10.

### F23. Minor. Contradictions with no runtime effect yet, which a builder will trip on

- R16 says `retired` keeps coach mode read-only (statements included). `coach_self()` raises
  `NOT_A_COACH` for a retired coach (db:1122-1124), so `my_coach_statements` refuses them.
  `coach_self` needs a flag that admits `retired` for reads.
- R16 says `set_coach_status` retiring calls the cancel internal. db:1166 refuses a retire with
  lessons (`has_lessons`). Pick R16 and drop the refusal.
- D-20 lets guests join a paused coach's group sessions (db:2017). R16 hides a paused coach from
  guests, and `lesson_join` has no `COACH_INACTIVE` (db:1381-1385). State which wins.
- `lesson_hold_expire` requires its caller to hold the courts (money:782-783). The sweep, its main
  caller under R1, takes none (R6). The precondition is not needed for a status-only write; strike
  it.
- Money §12 has `delete_my_account` call the refund (money:1496-1498). DB's 0286 cancels nothing and
  leaves it to the sweep (db:1843-1846). DB wins (the open-matches R25 rule).
- The sweep's held items call `enrolment_cancel_internal(e, 'expired')`, which leaves the hold row
  alone (db:1785-1786). R1 and money:780-794 say `lesson_hold_expire`. One function, Money's.
- The `lesson_refunds_due` shape: money:576-583 has an object `{venue_id, total_iqd, items[]}` with
  `refund_due_desk_iqd`; op:309 has an array with `due_iqd`. Money owns it.

## Gate fit

| Gate | Passes as designed? |
| --- | --- |
| `check:locks` | Rules 1–3 hold statically for every body the lanes specify. CI goes red on `lock-order-matches.test.ts:75/228/301` until those lines are edited (F13.1, F13.2). Rule 3 fails if a cancel reads its row `FOR UPDATE` (F13.3), and Rule 1 if level M locks after the expiry (F13.4). The cycles of F8 and F12 are invisible to the walker: unranked tables, and no `FOR UPDATE`. |
| `check:safeupdate` | Yes. Every UPDATE and DELETE in the lanes has a WHERE, and the SKIP LOCKED forms of R25 and R31 keep one. |
| `check:rpc-registry` | Yes under R2. It fails if money:605's overload entry is shipped (F14). The `compute_tab_totals` drop is not client-granted, so no re-grant is missed. |
| `check:migrations` | Ordinals 0270–0286 are past the max (0269), and the enum is alone in its file (it works, see "What holds"). 0276 needs the local waiver. CI on `main` judges nothing (F14). An `alter table … add constraint` on a new table needs `NOT VALID` or must be inline (F14). |
| `check:authz` | Yes. `lesson_guest()` and `coach_self()` refuse anon (`AUTH_REQUIRED`) and an anonymous session (`ACCOUNT_REQUIRED`, `check-rpc-authz.mjs:98`). `coach_me` is publicByDesign. |
| `db:types` | Yes, with 0270's enum value and `compute_tab_totals`'s new column in the same push. |

## Disagreements between the files

| # | Point | Positions | Pick |
| --- | --- | --- | --- |
| D1 | Who expires a lapsed lesson hold | R1: only `lesson_hold_expire`. db:1043, money:1481-1485: TTL as any hold, orphan clause only | **db.md's rule** (R25); strike R1's "only" and the `SLOT_TAKEN` limit |
| D2 | Which enrolments a cancel refunds | DB: live ones (db:1335-1342). Money: every enrolment with an applied online row (money:399-402) | **Money** (R28) |
| D3 | Refund amount | R5 / db:1866-1870: from `p_from_session`. Money: the engine's `refund_due_online` | **Money's engine**, no `from` (R28) |
| D4 | `account_deleted` refund reason | db:1327 `guest_cancel`; money:415 `account_deleted` | **`account_deleted`** |
| D5 | Reschedule scope | R8 every kind; db:1500 and D-10 course only; op:1506-1508 asks | **R8**, with R32 |
| D6 | Lane `move_reservation` text | db:1066-1087, op:193, D-16 allow a court change. R7 refuses | **R7**; strike D-16 and the db:1080-1087 event |
| D7 | Statement line kind | db:854 adjustment ⇔ no lesson; money needs the lesson on every line | **Money** (R24) |
| D8 | Held-sweep transition | db:1785-1786 `enrolment_cancel_internal('expired')`; money:780-794 `lesson_hold_expire` | **Money** |
| D9 | `delete_my_account` refunds | money:1496-1498 yes; db:1843-1846 no (sweep) | **DB** |
| D10 | Retire with lessons | db:1166 refuses; R16 cancels | **R16** |

## Top fixes, ranked

1. **F1.** Every statement line carries its lesson. Drop `coach_statement_lines_kind`.
2. **F3.** The day close dates a refund by its till shift's day.
3. **F4 + F5.** One refund call per enrolment with applied online money, live or not, for the
   engine's amount and no `from`. No 30-day window in the reconciler.
4. **F2 + F10.** No under-filled cancel after a start, a cut-off of at least 1 hour when a minimum
   exists, and a cut-off that follows a reschedule. A reschedule refuses a held lesson.
5. **F7.** Online lesson holds join the hold cap and strike when they lapse.
6. **F9 + F12.** One reading of R1, and lesson hold rows written with `skip locked`.
7. **F8.** Strike rows written with `skip locked` on both sides.
8. **F6 + F16.** A late success checks places in the `held` branch and never raises in the revival.
9. **F13.** The lock-test edits listed, and the text-order rules for cancels and level M.
10. **F17.** The lesson guard in `app.refund`.
11. **F11, F14, F15.** `confirm_booking` refuses a lesson, R2 is propagated, and the pick is limited
    to the locked courts.

## Proposed rulings (paste into §1.12)

| # | Ruling |
| --- | --- |
| R24 | **Statement lines carry their lesson.** `coach_statement_lines_kind` is dropped. Every line has `lesson_id` (`coach_statement_lines_lesson check (lesson_id is not null)`), and `is_adjustment` marks a line for a lesson that already has lines on an approved or paid statement. The unique index is `(statement_id, lesson_id)`. A test approves, refunds and redrafts twice, and asserts that the adjustment appears exactly once. |
| R25 | **Lesson holds (replaces R1's last two sentences).** 0277 changes only the orphan clause of `expire_stale_holds` and `match_expire_holds`, to `(r.guest_id is null and r.lesson_id is null)`. A lapsed lesson hold expires by TTL like any hold, and `lesson_hold_expire` expires it with its lesson. Every cancel or sweep path that ends a held lesson expires its `pending` hold row whatever `hold_expires_at` says, with `update reservations set status = 'expired' where id in (select id from reservations where id = <hold> and kind = 'hold' and status = 'pending' for update skip locked)`. §6.3's `SLOT_TAKEN` limit is struck. |
| R26 | **Cut-off.** `lesson_types_cutoff check (kind = 'private' or min_places = 1 or cutoff_hours >= 1)`; writers default a group or course type to 2 hours. The sweep judges a cut-off only while `now() <` the session's start (for a course, session 1's). Judged later, it stamps `cutoff_checked_at`, writes `under_filled` with `data {late: true}`, and cancels nothing. |
| R27 | **Refund day.** `close_day`, `v_day_close_summary` and `day_close_online` date a refund by `coalesce((select day_session_id from till_shifts where id = r.till_shift_id), p.day_session_id)`. Owner: Money, in 0278. `desk-payment.test.ts` gains a refund on day 2 of a payment taken on day 1. |
| R28 | **Online refunds of lesson money.** `lesson_refund_start(p_enrolment_id uuid, p_reason text) returns int`, with no `from` (amends R5). The amount is always `lesson_enrolment_money(e)->>'refund_due_online_iqd'`. The reason comes from the enrolment's `cancel_kind` and the lesson's or course's `cancel_reason` (money:412-418); `account_deleted` stays `account_deleted`. `lesson_cancel_internal` and `course_cancel_internal` call it for **every** enrolment of the lesson or course with an applied online row, live or not, after the status writes. The reconciler's lesson loop has no `updated_at` window. |
| R29 | **Late success.** In `lesson_settle_success`'s `held` branch, a group or course enrolment re-checks places, with itself excluded, against `max_places`; over the limit is `slot_lost`. The revival clears the lesson's `cancel_reason`, `cancelled_at` and `hold_expires_at`. Any `check_violation`, `unique_violation` or `exclusion_violation` in the revival or re-pick sub-block is `slot_lost`. DB's §3.1 and §3.2 gain `expired → scheduled` and `expired → booked` (writer: Money). |
| R30 | **Online lesson holds are holds.** `lesson_book_private` with `online`, `lesson_join` and `course_join` with `online` take `lock_principal('hold_slot', caller)` and refuse `HOLD_QUOTA_EXCEEDED` when the caller's live court holds plus their `held` enrolments reach `max_live_holds_per_guest`. `lesson_strikes_kind` gains `lapsed_hold`. `lesson_hold_expire` records one for a guest-booked enrolment that expired with no succeeded payment, and `hold_strikes_settle` settles it. |
| R31 | **Strike rows never wait.** The attendance delete of an unsettled strike, and `lesson_strike_record`'s existence check, use `for update skip locked` (a row being settled counts as settled). The lesson-strike loop of `hold_strikes_settle` selects `for update skip locked`. A two-connection race test covers a mark against `lesson_join`. |
| R32 | **Reschedule (amends R8).** A reschedule refuses a `held` lesson (`INVALID_TRANSITION` detail `held`). A group session's `cutoff_at` moves with its start; `cutoff_checked_at` is cleared when the new cut-off is still in the future. A course session follows db:1513-1514. `lessons.rescheduled_at timestamptz` joins §1.2. D-10 and db:1500's `not_course` refusal are struck. |
| R33 | **Text order for the lock gate.** No cancel, mark or sweep body takes `FOR UPDATE` on `reservations` (guarded `update … where status in (…)` only), so no coaching name joins `STATUS_ONLY_RESERVATION_WRITERS`. Level M and the lesson arm of `deposit_apply` take: courts, then the row `FOR UPDATE`, then `match_expire_holds`, then the writes. The 0281 commit updates `tests/lock-order-matches.test.ts:228` and `:301`. `SERVICE_WALK` is one list, in the 0275 commit: `lesson_sweep`, `lesson_settle_success`, `lesson_payment_prepare`, `coach_statements_draft` (`:75`). |
| R34 | **Pick only what is locked.** `lesson_lock_branch_courts(uuid) returns uuid[]`, and `lesson_pick_court(p_venue uuid, p_period tstzrange, p_locked uuid[])` chooses only from that set. |
| R35 | **`confirm_booking`** (latest 0242:1304) joins 0277's `LESSON_VIA_COACHING` list (detail `confirm`), right after its `FOR UPDATE` read. |
| R36 | **Desk lesson refunds.** Money re-issues `app.refund` (latest 0217:34). For a payment on a `kind 'lesson'` tab it takes `lock_coach` before the tab lock, and refuses an amount above `refund_due_desk_iqd` with `REFUND_EXCEEDS_DUE` unless `p_reason_code = 'lesson_goodwill'`. |
| R37 | **Closing a branch with coaching money.** `close_branch` refuses with `BRANCH_HAS_BOOKINGS`, detail `coaching_money`, while the branch has any statement in `draft` or `approved`, an undrafted month with statement lessons, or any `refund_due_desk > 0`. |
| R38 | **What a cut-off counts.** It counts `booked` places. When `booked < min_places ≤ booked + live held`, the sweep defers (no stamp) until the held enrolments resolve or until `start_at − 10 minutes`, then judges on `booked`. |
| R39 | **Course adds close at the last start.** `coach_add_student` and `desk_add_student` refuse a course with `LESSON_CLOSED` once its last session has started. |
| R40 | **Statements.** `coach_statements_draft` is a procedure that commits after each (coach, branch) pair, called by `tp_coach_statements`. A void from `approved` consumes a manager PIN grant. `coach_statement_mark_paid` refuses a negative total (`STATEMENT_NOT_APPROVED`, detail `negative`). |
| R41 | **R2 everywhere.** Every body, test and twin that db.md or money.md names `split_evenly(bigint, int)` reads `iqd_split`. No `rpc-overloads.json` entry is added. The 0276 commit is pushed outside trading hours, or its three hot-table indexes move to their own `CONCURRENTLY` files. |
