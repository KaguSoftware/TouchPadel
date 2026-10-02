# Coaching: database core (lane DB)

Consistency pass 2026-10-01: aligned with §1.12–§1.13 and C-21…C-31.

Date: 2026-10-01. Status: **lane contract, binding for the DB lane; nothing built.** It does not
repeat §0 (decisions C-1…C-31, defaults CD-1…CD-12) or §1 (names, rulings R1–R63) of
`build-contracts-2026-10-01.md`; it refers to them. Where this file and a ruling disagree, the ruling
wins. Nothing in §1 is renamed here. Every new name is in §10 ("Additions to §1"); the merge
questions of §10.2 are all settled by rulings, each marked there.

Code facts were checked on `d93bd9bf` (latest migration **0269**, `20261001000269_principal_lock_caps.sql`).
`NNNN:line` is a line in `packages/db/supabase/migrations/2026…NNNN_*.sql`; other paths are from the
repo root. `packages/db/CLAUDE.md` is stale on two points this file relies on: the latest ordinal (it
says 0252; the directory has 0269) and the error-code rule (since 2026-10-01 the one catalogue is
`ERROR_CODE_KEYS` in `packages/i18n/src/errors.ts`, which `scripts/check-error-codes.mjs` reads; the
per-app `MAPPED_CODES`/`CODE_TO_KEY` lists it names resolve through it).

**Coverage** (R53): `packages/db/fixtures/assistant-coverage.json` already has an `excluded` entry
for every file under `docs/design/coaching/`; a file added later gets its entry, and
`pnpm --filter @touch/db assistant:map`, in the same change. The two `packages/db/CLAUDE.md` fixes
(latest ordinal, error mapping) land in the first commit of the build (R23).

## 1. Ground rules

### 1.1 Ordinals and owners

| Ordinal | File | This lane writes |
| --- | --- | --- |
| 0270 | `reservation_kind_lesson` | all |
| 0274 | `coaching_settings` | all (with `platform_settings.lesson_terms_version` and `lesson_terms_ok`, R50) |
| 0275 | `coaching_tables` | every coaching table, the `reservations` changes, the guards, sanitisers, append-only and frozen triggers, grants, the storage policy, **`lock_coach` and `try_lock_coach`** and the lock-gate edit (R6, R33; §2.5) (Money writes the `tabs` and `booking_payments` changes in the same file, §4.3.12) |
| 0276 | `coaching_indexes` | all (Money's named partial indexes included, §4.4) |
| 0277 | `lesson_reservation_guards` | all |
| 0279 | `coaching_admin` | all (with `storage_path_in_use` and the coach-photo purge queue readers, R43) |
| 0280 | `lesson_booking` | everything but Guest's `lesson_notify`, `lesson_sync_reminders`, the reminder triggers and the `lesson_events_notify` trigger (R40, §5.2); `set_coach_status` lives here (R16) |
| 0282 | `price_promo_lessons` | all |
| 0283 | `lesson_sweep` | all |
| 0286 | `lesson_account_deletion` | all |

Check the directory before writing each file (`ls supabase/migrations | tail`). If the team has landed
more, shift every ordinal up, keep this order, and use the real ordinal in each `$<name>_0NNN$` tag.
Matrix rows of this build go in **drop 25** (`tests/rls-matrix.ts` ends at drop 24, `:4843`).

### 1.2 Every file

- Opens with `set lock_timeout = '3s'; set statement_timeout = '60s';`.
- Functions use `$<name>_0NNN$` tags and are re-issued only from the latest body named in the tables
  below (each checked with `grep -n "function app.<name>(" *.sql | grep -i create | tail -1`).
- A CHECK or FK on an **existing** table is `NOT VALID`, then validated in a `do` block guarded on
  `conname` **and** `conrelid` (the 0174:50-78 and 0257:31-49 shape). CHECKs on new tables are inline.
- Every writing body asserts `set_config('app.venue_id', <the lesson's branch>, true)` before its first
  write, so `zz_branch_guard` (0230:90-174, rule 2 at :149-167) passes a staff writer, and a coach who
  is also staff somewhere else.
- Online only (CD-6). No coaching write is a queued mutation type; nothing joins
  `_shared/mutation-types.json`.
- Each commit carries `src/types.gen.ts`, the error catalogue lines (EN + AR) for every new code it
  raises, and the gate artifacts listed under "Gates" in its section.
- Bodies may call functions created in a later file of this build (plpgsql binds at run time): 0277's
  `close_branch` calls Money's `lesson_enrolment_money` (0278); 0280 calls `lesson_strike_record`
  (0283). No such call can run before its target lands, because no lesson row can exist before 0280
  and the stack is reset with every file.
- No body of this lane calls Guest's `lesson_notify` or `lesson_sync_reminders` (R40): pushes and
  reminders follow `lesson_events` rows and row state through Guest's triggers.
- Every staff RPC checks the role first, before any argument check or `app.current_venue()` (R57).

### 1.3 What the code forces

- **A live hold must carry a guest.** `reservations_live_hold_has_guest` is `kind <> 'hold' or status
  <> 'pending' or guest_id is not null` (0071:54-60), and every hold expiry treats `guest_id is null`
  as an orphan to expire on sight (`expire_stale_holds` 0268:45, `match_expire_holds` 0268:81). §1.2
  puts `guest_id` NULL on a lesson's court row and gives an online private lesson a `hold` row: as
  written, the insert fails, and if it did not, the next lazy expiry on that court would kill it. R1
  and R25 settle it: 0275 widens the CHECK (§4.3.12) and 0277 narrows the orphan rule (§4.5.2).
- **A NULL `guest_id` keeps a row off every guest path.** Guest RLS on `reservations`
  (`guest_id = auth.uid()`, 0008:685-686), `cancel_reservation`'s guest branch (0210:567-574),
  `confirm_booking` and `release_hold` for guests (ownership, FORBIDDEN: `check-rpc-authz.mjs:270-273`
  pins it), `my_reservations` (0258:1192, ownership) and `hold_strikes_settle` (`h.guest_id is not
  null`, 0252:241). So a lesson's court row is reachable only through the coaching RPCs, except by
  staff through `confirm_booking`, which 0277 refuses (R35). The hold ladder never sees the court
  hold; a lapsed online lesson strikes through `lesson_strikes` instead (`lapsed_hold`, R30).
- **Firm** is a live row that is not a hold. Four bodies and one trigger spell it `kind in
  ('booking','maintenance')`: 0260:519, 0261:916, 0262:1632, 0262:1763, and the `reservations_match`
  WHEN at 0263:170. A lesson must join that list or a lesson on the last court never bumps a filling
  match and is counted free by OM-42.
- **The court lock** is `pg_advisory_xact_lock(hashtextextended('app.reservations:court:'||id, 0))`
  (0042:50-58). The branch's courts in id order is `match_lock_courts` (0260:112-122).
- **Branch-scoped hold expiry** is `app.match_expire_holds(venue, period)` (0268:71): one id-ordered
  statement, safe for a staff caller (the chain-wide form trips the branch guard, open-matches D-1).
- **The branch guard's parent lookup** falls back to `select venue_id from public.<parent>`
  (0230:79). A chain-wide parent (`coaches`, `coach_time_off`, `profiles`, `staff`) is never a link
  pair: `coaches` has no `venue_id` and the lookup would fail.
- **Same branch for a court move** is the composite FK `reservations_court_venue_fkey (court_id,
  venue_id) → courts (id, venue_id)` (0133:47-50): a lesson row can never be moved to another
  branch's court.
- **btree_gist lives in schema `extensions`** (0069): "anything creating a new gist exclusion
  constraint now needs `extensions` on its search_path". The two new exclusion constraints name the
  operator class: `coach_id extensions.gist_uuid_ops with =`.
- **`app.phone_canon` has no grant at all** (0189:169), so it cannot appear in a CHECK that the service
  role writes through. `app.phone_digits` is granted to anon, authenticated and service_role (0116:56,
  0121:32); the `match_seats.guest_phone` CHECK uses it (0258:148-149).
- **`court_availability` is an owner-rights view** (0008:670-674; `AUDITED_OWNER_RIGHTS_VIEWS` in
  `scripts/check-db-invariants.mjs:50-58`). Its column list must not grow.
- **`slot_changed` carries `kind`** (0224:154-161). Its consumers only invalidate
  (`apps/mobile/src/features/availability/courtsChannel.ts:87`, `apps/operator/src/features/desk/useTradingNight.ts:148`),
  so a `lesson` value breaks nothing; `rt_reservation` is not re-issued.
- **The offline queue reaches four reservation RPCs and `open_tab`.** `replay` routes
  `reservation.create` to `staff_create_reservation` with the payload's `kind`
  (`supabase/functions/replay/index.ts:96-111`), `reservation.update` to `move_reservation`,
  `extend_reservation`, `cancel_reservation` and `mark_reservation` (`:116-155`), and `tab.open` to
  `open_tab` with `p_reservation_id` (`:177-189`), always as the staff session that queued it
  (`asStaff`, `:492-518`). A P0001 refusal is recorded as a terminal `conflict` row and never retried
  (`:593-609`). So the `LESSON_VIA_COACHING` refusals of §4.5 cover every replayed envelope, a
  hand-edited one included; `reservationCreateShape` allows only `booking|hold|maintenance`
  (`packages/core/src/schemas/mutations.ts:232`), which is a client check, not the wall.
- **The lock walker** (`scripts/lib/lock-order.mjs`) flattens every branch of a body in text order,
  emits a lock only for `FOR UPDATE` and the `ADVISORY` calls (`events()`; an `INSERT` or `UPDATE`
  is not a lock), expands triggers of written tables ignoring `WHEN`, never emits
  `pg_try_advisory_xact_lock`, and walks only client-callable definers plus `SERVICE_WALK`. Rule 1
  (no inversion) reads the flattened text order, so a `reservations` lock that follows an expanded
  `match_tickets` anywhere in a body is a violation. Rule 3 (every reservations locker takes
  `court_advisory` first) exempts `STATUS_ONLY_RESERVATION_WRITERS` by the **walked** name only.
- **The authz sweep counts `ACCOUNT_REQUIRED` as a refusal** (`scripts/check-rpc-authz.mjs:98`), and
  so does the matrix runner (`tests/rls-matrix.test.ts:50`). `NOT_A_COACH` is not a refusal to either.
- **SEC-20 discovers tables by link column** (`tests/stored-fields.test.ts:99-102`, `LINK_COLUMNS`)
  and proves `scrub` = NULL, `anonymise` = `'Deleted account'` (`:574-579`). There is no route for a
  NOT NULL text emptied to `''`.
- **The hold ladder is settled every minute** by `tp_hold_strikes` (`hold_strikes_settle(null)`,
  0268:102-112), and by `hold_slot` for the caller under `lock_principal` (0269:113-136).
- **The price lock shape** is a wrapper over an internal: the wrapper raises `PRICE_VIA_PROTOCOL`
  for `app.staff_role() = 'manager'`, the apply calls the internal (`upsert_rate_rule`, 0177:1749-1766;
  `upsert_rate_rule_internal`, 0177:1642). Both codes already exist in the catalogue (R14).
- **The per-guest hold cap** is `platform_settings.max_live_holds_per_guest`, counted by `hold_slot`
  under `lock_principal('hold_slot', caller)` (0269:113, :183-193). The online lesson paths count
  against the same cap under the same key (R30).
- **Terms versions** are `platform_settings.match_terms_version` and `app.match_terms_ok` (0257:61,
  :157): set by migration only, compared as (date, revision). `lesson_terms_version` copies the shape
  (R50).
- **Storage purges** run in a service edge path: `protocol-action` removes incident photos through
  `incident_photo_purge_due` / `incident_photos_purged` (`supabase/functions/protocol-action/index.ts:121-130`).
  The coach-photo queue copies it (R43).

## 2. Locks

### 2.1 The order (the gate's `ORDER`)

```text
day_sessions → match_money_advisory → coach_advisory → tabs → orders → order_items → tickets
  → payments → till_shifts → refunds → stock_batches → court_advisory → reservations
  → match_venue_advisory → match_tickets
```

`coach_advisory` is `app.lock_coach(coach)`: `pg_advisory_xact_lock(hashtextextended('app.coaches:' ||
id, 0))`. `lessons`, `courses`, `lesson_enrolments`, `lesson_attendance`, `lesson_strikes`,
`coach_statements` stay out of `ORDER`, like `booking_payments`: nothing locks them `FOR UPDATE`
outside the coach lock; the coach mutex serialises every change to them. `lesson_strikes` rows are
only ever taken `skip locked` (R31). `hold_standing` and `lock_principal` stay unranked (0269
header): both are taken only before `lock_coach`.

### 2.2 Primitives

| Function | Takes | File |
| --- | --- | --- |
| `lock_coach(p_coach_id uuid)` | the coach mutex, blocking | 0275 (R6) |
| `try_lock_coach(p_coach_id uuid) returns boolean` | the same key, `pg_try_advisory_xact_lock`; never waits | 0275 (R6) |
| `lesson_lock_branch_courts(p_venue uuid) returns uuid[]` | `app.lock_court` on every **active** court of the branch, id order, one loop (the `match_lock_courts` body); returns the ids it locked (R34) | 0280 |
| `match_expire_holds(p_venue, p_period)` | reused as is (0268:71, re-issued in 0277 for the orphan rule) | — |
| `lock_principal(kind, id)` | reused (0269:43); kinds `hold_slot` (every guest booking and join, R30) and `coach_students` (§10) | — |

### 2.3 Levels (what each body holds, in order)

| Level | Sequence | Bodies |
| --- | --- | --- |
| **B** book (court write) | [`lock_principal` → ladder settle → hold cap] → `lock_coach` → `lesson_lock_branch_courts(v)` → `match_expire_holds(v, span)` → reservation insert | `lesson_book_private` (principal `hold_slot` + ladder; the cap when online), `coach_book_private` (principal `coach_students`, no ladder), `desk_book_lesson`, `coach_create_group`, `desk_create_group`, `coach_create_course`, `desk_create_course` (no principal) |
| **M** move (court write) | `lock_coach` → `lesson_lock_branch_courts(v)` → the lesson's live court row `FOR UPDATE` → `match_expire_holds(v, new period)` → writes (R33) | `coach_reschedule_session`, `desk_reschedule_session`, `desk_move_lesson_court` |
| **J** join (no court write) | [`lock_principal` → ladder settle → hold cap] → `lock_coach` | `lesson_join`, `course_join` (principal `hold_slot` + ladder; the cap when online), `coach_add_student` (principal `coach_students`), `desk_add_student` |
| **C** cancel / mark | `lock_coach` → status-only reservation writes → `booking_payments` (Money's `lesson_refund_start`) | every cancel, removal and attendance RPC, `set_coach_status` retiring |
| **S** sweep | first coach: `lock_coach`; every later coach: `try_lock_coach`, skipped when busy; status-only writes; no court lock | `lesson_sweep` |
| **H** hours | `lock_coach` | `set_coach_hours`, `set_my_coach_hours`, time off, `lesson_link_confirm` |

Money's desk settle is `day_sessions → lock_coach → tabs → payments → till_shifts` (§1.4, §5.1.3).

**Cancels, removals, marks and the sweep take no court lock and no `FOR UPDATE` on `reservations`**
(R6, R33). They write court rows only by a guarded `update … where lesson_id = … and status in
(…)` that moves a row out of the exclusion set, which cannot create an overlap, and no coaching name
joins `STATUS_ONLY_RESERVATION_WRITERS`. Taking every court of the branch to cancel one lesson
would only queue every guest hold behind it, and would let the multi-coach sweep close a cycle.

**The one exception is a held lesson's court hold** (R25). Every path that ends a held lesson
(guest, coach or desk cancel, retirement, deletion, Money's `lesson_hold_expire`) expires its
`pending` hold row at once, whatever `hold_expires_at` says, through one statement in
`lesson_court_release` (§4.7.2):

```sql
update reservations set status = 'expired'
 where id in (select id from reservations
               where lesson_id = p_lesson_id and kind = 'hold' and status = 'pending'
               for update skip locked);
```

A hold another transaction has locked is being expired by it (`hold_slot`'s or `tp_hold_sweep`'s
`expire_stale_holds`, which select only stale holds), so skipping it is correct, and the statement
never waits. The gate learns that a `reservations` lock taken `skip locked` never waits (§2.5 item
7); without that, Rule 3 refuses every cancel and Rule 1 refuses every body that reaches this
statement twice. This reconciles R25's statement with R33's "no `FOR UPDATE` in a cancel": the
cancels take no lock that can wait.

### 2.4 Why this cannot deadlock

1. **Coach before courts, always.** Only lesson bodies take `coach_advisory`, and each takes it before
   any court key, tab or row it writes. Nothing that holds a court key waits for a coach key (Money's
   `deposit_apply` arm included: §5.1.3).
2. **One coach per blocking body.** No interactive path takes two coaches' locks; a lesson's coach
   never changes. The sweep blocks only on its first coach and try-locks the rest.
3. **Courts in id order** (`lesson_lock_branch_courts`) and hold expiry in one id-ordered statement
   per branch (`match_expire_holds`), the order `tp_hold_sweep`, `hold_slot`, `move_reservation` and
   the match bodies use. A lesson body never expires holds court by court (the C12 cycle of open
   matches), and picks a court only from the set it locked (R34), so a court re-activated meanwhile
   is never written without its key.
4. **Cancels and the sweep never wait on a court row another body holds.** They write `kind
   'lesson'` rows, which no hold expiry selects, by plain status updates; a lesson's `hold` row only
   through the `skip locked` statement above. So a `hold_slot` that holds a stale lesson hold and
   waits on a row the sweep wrote can never be waited on by the sweep (the F12 cycle).
5. **No strike inside a coach or court lock, and no wait on a strike row** (R31). Lesson paths only
   insert a `lesson_strikes` row, after a plain existence read; the attendance correction deletes an
   unsettled one `skip locked`; `hold_strikes_settle` selects them `skip locked` and applies them
   under the principal lock or in `tp_hold_strikes`'s own transaction (0268), never holding a coach
   or court key (§4.9). A booking that is settling a guest's strike while it waits for the coach
   therefore never meets a coach-lock holder waiting for that strike row (the F8 cycle).
6. **The match mutex is only try-locked** by the reservation trigger's part B under a lesson write;
   part A never runs for a lesson row (no match books it).
7. **Deletion takes no coach lock** (§4.10): the sweep cancels a deleted student's or coach's
   lessons once the deletion has committed; the deletion's scrub writes only the guest's own
   enrolment rows and takes no lock of its own.

### 2.5 Gate changes (`scripts/lib/lock-order.mjs`, in the 0275 commit, R6, R33)

1. `ORDER`: insert `'coach_advisory'` after `'match_money_advisory'`.
2. `ADVISORY`: add `{ fn: 'lock_coach', lock: 'coach_advisory' }`. `try_lock_coach` is not listed (it
   never waits), and `lock_coach` is skipped in the call list like the other keys.
3. `ONCE_PER_SEQUENCE`: add `'coach_advisory'`.
4. `SERVICE_WALK`, one list (R33): append `'lesson_sweep', 'lesson_settle_success',
   'lesson_payment_prepare', 'coach_statements_draft'` (names not created yet are skipped by
   `byName.has`).
5. `STATUS_ONLY_RESERVATION_WRITERS`: unchanged (R33).
6. The header comment and `scripts/check-lock-order.mjs`'s header gain one paragraph each (coaching:
   the coach mutex, its rank, once per sequence, the walk list, the `skip locked` rule).
7. `events()`: a `FOR UPDATE … SKIP LOCKED` whose locked relation is `reservations` is not emitted,
   for the reason `pg_try_advisory_xact_lock` is not (it never waits). Every other `skip locked`
   (`match_tickets` in 0264, the outboxes) is emitted as today, so no printed row changes.
8. `packages/db/CLAUDE.md`, RPCs section: the order line becomes §2.1's.

Fixture tests:

- `tests/lock-order-matches.test.ts`: `DECLARED` gains `coach_advisory`, and `:75` (the
  `SERVICE_WALK` equality) gains the four names, in the 0275 commit. `:228` and `:301` (the
  `deposit_apply` row) are Money's edit, in the 0281 commit that changes them (R33).
- **New** `tests/lock-order-coaching.test.ts` (pure half always runs, stack half `skipIf`): synthetic
  `lock_coach` emits `coach_advisory`; a second `lock_coach` in one body is dropped; a synthetic level
  B body prints `coach_advisory -> court_advisory -> reservations -> match_venue_advisory ->
  match_tickets`; a body that takes `lock_court` then `lock_coach` is a violation; a body that takes
  `try_lock_coach` prints nothing; a `for update skip locked` on `reservations` prints nothing and a
  plain `for update` on it still does. Stack half: the gate passes and prints, for
  `lesson_book_private`, `coach_create_course`, `coach_reschedule_session`, `desk_move_lesson_court`:
  `coach_advisory -> court_advisory -> reservations -> match_venue_advisory -> match_tickets`; for
  `lesson_join`, `course_join`, `coach_add_student`, the attendance RPCs and `lesson_link_confirm`:
  `coach_advisory`; for every cancel RPC, `set_coach_status` and `lesson_sweep`: `coach_advisory ->
  match_venue_advisory -> match_tickets` (the trigger expanded under a status write; at run time part
  B returns at once for a status leaving the live set); for `deposit_apply` after 0281:
  `coach_advisory -> court_advisory -> reservations -> match_venue_advisory -> match_tickets` (§5.1.3).

## 3. State machines

The writer named in each row is the only one for that transition. Every transition writes one
`lesson_events` row in the same transaction (§5.2 lists what each carries).

### 3.1 Lesson (`lessons.status`)

| From | To | When | Writer |
| --- | --- | --- | --- |
| — | `scheduled` | private lesson booked for the desk (guest, coach, staff); group session or course session created | `lesson_create_internal` (from the level B bodies) |
| — | `held` | private lesson booked by a guest paying online | `lesson_create_internal` (`lesson_book_private`) |
| `held` | `scheduled` | the Qi payment succeeded | Money's `lesson_settle_success` (0281) |
| `held` | `expired` (`payment_expired`) | hold lapsed with no open payment | Money's `lesson_hold_expire` (0281), called by `lesson_sweep` and by `deposit_apply`'s EXPIRED branch |
| `expired` | `scheduled` | a late Qi success revives it (R29: clears `cancel_reason`, `cancelled_at`, `hold_expires_at`) | Money's `lesson_settle_success` |
| `held`, `scheduled` | `cancelled` (`guest_cancel`) | the private lesson's guest cancels | `lesson_cancel_mine` |
| `held`, `scheduled` | `cancelled` (`coach_cancel`, `staff_cancel`) | coach or desk cancels a private or group lesson | `coach_cancel_lesson`, `desk_cancel_lesson`, `desk_cancel_enrolment` (private) |
| `scheduled` | `cancelled` (`under_filled`) | group: below minimum at its cut-off, judged **before its start** (R26, R38); course session: its course under-filled | `lesson_sweep` |
| `scheduled` | `cancelled` (`coach_cancel`, `staff_cancel`, `under_filled`, `coach_retired`) | a course session of a course cancelled from now on | `course_cancel_internal` |
| `held`, `scheduled` | `cancelled` (`coach_retired`) | the coach is retired (R45), or deleted the account (CD-12, R63) | `set_coach_status`; the sweep for a deletion |
| `held`, `scheduled` | `cancelled` (`account_deleted`) | the private lesson's guest deleted the account | `lesson_sweep` |
| `scheduled` | `completed` | `now() ≥ end_at + 15 min` | `lesson_sweep` |

Every kind may be **rescheduled** while `scheduled` and not started (R8, R32): not a status
transition; it stamps `rescheduled_at` and writes `rescheduled`. A `held` lesson is never moved
(`INVALID_TRANSITION` detail `held`). A course session is never cancelled alone (C-19):
`coach_cancel_lesson` and `desk_cancel_lesson` refuse it; it moves or goes with its course.
Terminal: `completed`, `cancelled`; `expired` is terminal except for Money's revival.

### 3.2 Enrolment (`lesson_enrolments.status`, `cancel_kind`)

| From | To (`cancel_kind`) | When | Writer |
| --- | --- | --- | --- |
| — | `booked` | desk payment: guest booking, guest join, coach or desk add | the booking and join RPCs |
| — | `held` | guest paying online (private, join) | `lesson_book_private`, `lesson_join`, `course_join` |
| `held` | `booked` | payment succeeded | Money's `lesson_settle_success` |
| `held` | `expired` (`expired`) | hold lapsed with no open payment; a guest-booked one records a `lapsed_hold` strike (R30) | Money's `lesson_hold_expire` |
| `expired` | `booked` | a late Qi success that still fits (R29) | Money's `lesson_settle_success` |
| `held`, `booked` | `cancelled` (`guest_free`) | the guest cancels outside the window, or after the coach or desk rescheduled their session (R8), or while it is `held` | `lesson_cancel_mine` |
| `booked` | `cancelled` (`guest_late`) | the guest cancels inside the window, judged against their own next covered session (C-23); a strike if the guest booked it (CD-2) | `lesson_cancel_mine` |
| `held`, `booked` | `cancelled` (`coach`) | coach removes the student, cancels the lesson, or is retired | `coach_remove_student`, `lesson_cancel_internal` (`coach_cancel`, `coach_retired`) |
| `held`, `booked` | `cancelled` (`staff`) | desk cancels the enrolment or the lesson | `desk_cancel_enrolment`, `lesson_cancel_internal` (`staff_cancel`) |
| `held`, `booked` | `cancelled` (`under_filled`) | group session under-filled | `lesson_sweep` |
| `held`, `booked` | `cancelled` (`course_cancelled`) | its course was cancelled (any reason: the course's `cancel_reason` says which) | `course_cancel_internal` |
| `held`, `booked` | `cancelled` (`account_deleted`) | the student deleted the account | `lesson_sweep` |

A `booked` enrolment of a lesson that ended stays `booked`; attendance is a separate row (§3.5).
Online money of a cancelled enrolment goes back through Money's engine, called for every enrolment
with an applied online row, live or not, after the status writes (R28; §4.7.2).

**The link of a typed phone** (C-21, R44) is a separate state on a `booked` enrolment a coach or the
desk created from a typed phone: `guest_id` set by the verified-phone match with `link_confirmed_at`
NULL (pending) → `lesson_link_confirm(e, true)` stamps `link_confirmed_at` (linked) or
`lesson_link_confirm(e, false)` sets `guest_id` NULL (a walk-in again, silently). Guest-booked and
desk-picked (`p_customer_id`) enrolments are linked at insert.

### 3.3 Course (`courses.status`)

| From | To | When | Writer |
| --- | --- | --- | --- |
| — | `open` | created with all its sessions | `coach_create_course`, `desk_create_course` |
| `open` | `running` | session 1 has started | `lesson_sweep` |
| `open` | `cancelled` (`under_filled`) | below minimum at `cutoff_at`, judged before session 1 starts (R26, R38) | `lesson_sweep` |
| `open`, `running` | `cancelled` (`coach_cancel`, `staff_cancel`, `coach_retired`) | the rest of the course cancelled | `coach_cancel_course`, `desk_cancel_course`, `set_coach_status`; the sweep for a deletion |
| `running` | `completed` | every session `completed` or `cancelled`, none live | `lesson_sweep` |

### 3.4 The lesson's court row (`reservations`, `lesson_id` set)

| Lesson | Court row |
| --- | --- |
| `held` | `kind 'hold'`, `status 'pending'`, `hold_expires_at` = the lesson's |
| `scheduled` | `kind 'lesson'`, `status 'confirmed'` (Money's success turns the hold row into this, in place) |
| `completed` | `status 'completed'`, `cancelled_at` stamped (the `mark_reservation` convention, 0262:3281-3289) |
| `cancelled` | `kind 'lesson'`: `status 'cancelled'`, `cancelled_at`, `cancellation_reason` = the lesson's `cancel_reason`, `cancelled_by` `guest` for `guest_cancel` else `staff`; `kind 'hold'`: `status 'expired'` (holds are expired, never cancelled, as `release_hold` does, 0252:675-678) at once, whatever `hold_expires_at` says, by the `skip locked` statement (R25, §2.3) |
| `expired` | the hold row `expired` by Money's `lesson_hold_expire` through the same statement, or earlier by TTL (`expire_stale_holds`, lazy or `tp_hold_sweep`) |

Always `guest_id` NULL, `guest_name` `'Lesson'`, `guest_phone`, `price_iqd`, `rate_rule_id`,
`series_id`, `notes`, `idempotency_key`, `client_ref` NULL; `source` `'desk'` when staff booked it,
else `'mobile'`; `created_by_staff_id` the staff member or NULL. At most one live row per lesson
(`reservations_one_live_per_lesson`). A lapsed lesson hold is expired by TTL like any hold (R25):
the orphan clause no longer treats it as an orphan.

### 3.5 Attendance (`lesson_attendance`)

A row per (session, enrolment) once marked: `attended` or `no_show`; `clear` deletes it. Marks are
open from the session's `start_at` to `start_at + 24 h` (CD-11), for a `booked` enrolment that covers
the session (a course enrolment covers `session_no` in `first_session_no .. first_session_no +
sessions_covered − 1`). A `no_show` writes a `lesson_strikes` row only for an enrolment the guest
booked themselves with an account (CD-2); `clear` or `attended` after it deletes that row while it is
unsettled and not locked (`skip locked`, R31: a row being settled counts as settled; staff lift the
ladder with `hold_standing_decide`, 0252:340).

## 4. Migrations

Each section ends with **Gates**: what lands in the same commit. "Matrix" is `tests/rls-matrix.ts`
drop 25; "allowlist" is `fixtures/rpc-allowlist.json` (plus `fixtures/rpc-coverage-floor.json`
raised with `--update-floor`); "coverage" is `fixtures/assistant-coverage.json`; "SEC-20" is
`tests/stored-fields.test.ts`; "codes" are `ERROR_CODE_KEYS` lines in `packages/i18n/src/errors.ts`
with EN and AR copy (DRAFT-AR) in the catalogs. Matrix shapes used below, beside the file's own
`MANAGER_UP`, `OWNER_ONLY`, `CASHIER_DESK_UP`, `SELF_AUTHED`, `SELF_ANON_OK` (`tests/rls-matrix.ts:116-136`):

- `GUEST_OR_COACH` = `ex('execute', {anon: 'denied', guest_anon_session: 'guarded'})` (the drop-24
  `match_join` shape: an anonymous session has no profile and gets `ACCOUNT_REQUIRED`; a profile that
  is not a coach gets `NOT_A_COACH`, which the runner counts as past the guard);
- `DESK_UP` = `ex('guarded', {anon: 'denied', court_desk: 'execute', manager: 'execute', owner: 'execute'})`.

### 4.1 0270 `reservation_kind_lesson`

```sql
set lock_timeout = '3s';
set statement_timeout = '60s';
alter type reservation_kind add value if not exists 'lesson';
```

Alone, as 0143 and 0155 were: nothing in the file uses the value. **Gates:** `types.gen.ts`
(`reservation_kind` gains `lesson`). Every client switch over `reservation_kind` compiles in the same
push (operator desk grid; `packages/core/src/availability/slotGrid.ts`, which §1.11 maps `lesson` to
`booked`; mobile `features/availability/assemble.ts` reads `court_availability`, which masks it, §4.5.1).

### 4.2 0274 `coaching_settings`

**Columns** (on `venue_settings`, one row per branch since 0208):

```sql
alter table venue_settings add column if not exists coaching_enabled        boolean not null default false;
alter table venue_settings add column if not exists lesson_payment_mode     text    not null default 'desk';
alter table venue_settings add column if not exists coach_share_bp          int     not null default 6000;
alter table venue_settings add column if not exists lesson_prices_public    boolean not null default false;
alter table venue_settings add column if not exists coach_max_open_private  int     not null default 10;   -- R56
-- NOT VALID inside a do block guarded on conname + conrelid, then the guarded validate (0257:31-49):
alter table venue_settings add constraint venue_settings_coaching_rules
  check (lesson_payment_mode in ('desk', 'online_optional', 'online_required')
         and coach_share_bp between 0 and 10000
         and coach_max_open_private between 1 and 100) not valid;

alter table platform_settings add column if not exists lesson_terms_version text;               -- R50
-- the same guarded NOT VALID + validate pair (the 0257:61-83 shape):
alter table platform_settings add constraint platform_settings_lesson_terms
  check (lesson_terms_version is null
         or lesson_terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$') not valid;
```

`set_venue_details`'s allowlist (0248) does **not** gain these keys: they are written only by
`set_coaching_settings`. `lesson_terms_version` is set by migration only, after the terms and privacy
text with the lessons section is live on phones (C-26, R50), as `match_terms_version` is (0257:91).
Switching `coaching_enabled` off stops new guest and coach bookings, joins, adds and creations
(`COACHING_OFF`); lessons already booked run to their end (the R10 rule of open matches); coach mode
keeps working (R45). `coach_share_bp` applies to lessons and courses created after a change (CD-5
snapshot). `coach_max_open_private` caps a coach's upcoming coach-booked private lessons at the
branch (C-24, R56).

**`venue_settings_public`** re-created from 0257:99-120 (`create or replace view … with
(security_invoker = off)`): the 0257 column list verbatim plus, appended, `vs.coaching_enabled,
vs.lesson_payment_mode, vs.lesson_prices_public`. Never `coach_share_bp`, never
`coach_max_open_private`. `grant select … to anon, authenticated` re-issued; comment updated.
(`docs/security/security-advisor-waiver-2026-09-06.md` enumerates the projection as of 0006 and
already predates 0257's two columns: re-verify it at freeze.)

**`app.assistant_readable_columns`**: the 0257:130-148 statement with the five `venue_settings`
columns, the three view columns and `platform_settings.lesson_terms_version`.

**`app.coaching_rules(p_venue uuid) returns jsonb`** (internal, `stable`, revoked from public, anon,
authenticated): `{venue_id, coaching_enabled, lesson_payment_mode, coach_share_bp,
lesson_prices_public, coach_max_open_private, cancellation_window_hours, deposit_window_seconds,
max_booking_horizon_days, protected_horizon_hours, timezone}` from the branch's `venue_settings` row;
NULL when there is none. Every coaching body reads its branch's rules through it.

**`app.lesson_terms_ok(p_version text) returns boolean`** (internal, `language sql stable`, the
`match_terms_ok` shape, 0257:157): false when `p_version` or `lesson_terms_version` is NULL, else
`p_version >= lesson_terms_version` compared as (date, revision). The online booking paths call it
(R50, §4.7.1 rule 7).

**`app.coaching_settings(p_venue_id uuid) returns jsonb`** (manager, owner; role first, R57; the R33
order of `match_settings`, 0257:237-269): `is_staff('manager','owner')` else `FORBIDDEN`; `v :=
coalesce(p_venue_id, app.current_venue())`; `is_staff_at(v, 'manager','owner')` else `FORBIDDEN`;
`coaching_rules(v)` or `VENUE_SETTINGS_MISSING`, plus `online_payments_available` (X20) =
`lesson_terms_version is not null`. A manager reads `coach_share_bp` (they approve statements,
C-12); only the owner writes it.

**`app.set_coaching_settings(p_venue_id uuid, p_patch jsonb) returns jsonb`** (owner):
`is_staff('owner')` else `FORBIDDEN`; branch as above with `'owner'`; the whole patch checked before
any write (`INVALID_ARGUMENT`, detail the key, or `p_patch` for an empty or non-object patch): keys
`coaching_enabled` (boolean), `lesson_payment_mode` (the three values), `coach_share_bp`
(`app.venue_patch_int(p_patch, 'coach_share_bp', 0, 10000)`, 0104), `coach_max_open_private`
(`venue_patch_int`, 1..100), `lesson_prices_public` (boolean). Then **R50**: a resulting
`lesson_payment_mode` other than `desk` while `online_payments_available` is false →
`ONLINE_PAYMENT_OFF` detail `terms` (C-26: desk-paid lessons can run before the terms bump).
`set_config('app.venue_id', v)`, one `update venue_settings … where venue_id = v`, audit
`venue.coaching_settings` (before and after = `coaching_settings(v)`) when changed; returns
`coaching_settings(v)`.

**Gates.** Matrix: `coaching_settings` `MANAGER_UP`, args `{p_venue_id: VENUE_A}`;
`set_coaching_settings` `OWNER_ONLY`, args `{p_venue_id: VENUE_A, p_patch: {}}` (the owner fails
`INVALID_ARGUMENT` past the guard). Allowlist: both `guarded`. Coverage: both `map:action`;
`coaching_rules` and `lesson_terms_ok` `excluded: service_role only — the branch's coaching rules
and the lessons terms gate for the coaching bodies (0274), never called by a client`. Codes: the
`ONLINE_PAYMENT_OFF` line (first raised here) with a sentence for detail `terms`. SEC-20: the new
columns are settings (`n`). `types.gen.ts`. Test `coaching-settings.test.ts`.

### 4.3 0275 `coaching_tables`

**Order in the file:** `coaches` → `coach_branches` → `coach_time_off` → `coach_hours` →
`lesson_types` → `coach_lesson_types` → `coach_prices` → `courses` → `lessons` → `lesson_enrolments`
→ `lesson_attendance` → `lesson_strikes` → `lesson_events` → `coach_statements` →
`coach_statement_lines` → `coach_photo_purges` → the `reservations` changes (§4.3.12) → Money's part
(§4.3.12) → guards, sanitisers, append-only and frozen triggers → RLS and grants → the storage policy
→ `lock_coach`, `try_lock_coach` (§4.6.1; R6: 0278 calls them) → comments →
`app.assistant_readable_columns`.

Rules for every new table: RLS on, no policy; `revoke all on <t> from anon, authenticated; grant all
on <t> to service_role` (0258:439-465). Branch tables carry `venue_id uuid not null references
venues(id)` with **no default**: every writer names it from the lesson, type or coach row. Chain-wide
tables (`coaches`, `coach_time_off`, `coach_photo_purges`) have no `venue_id` and no guard. Every
CHECK on a new table is inline in its `create table` (F14: `check-migrations` exempts only that
statement); Money's constraints on DB's tables (§4.3.11) are written inline here too.

#### 4.3.1 `coaches` (chain-wide)

```sql
create table if not exists coaches (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null unique references profiles(id),
  display_name_en     text not null,
  display_name_ar     text not null,
  bio_en              text not null default '',
  bio_ar              text not null default '',
  photo_path          text,
  status              text not null default 'active',
  sort_order          int  not null default 0,
  public_accepted_at  timestamptz,                     -- C-22, R61
  created_by_staff_id uuid references staff(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  retired_at          timestamptz,
  constraint coaches_status  check (status in ('active', 'paused', 'retired')),
  constraint coaches_names   check (char_length(display_name_en) between 1 and 60
                                    and char_length(display_name_ar) between 1 and 60),
  constraint coaches_bios    check (char_length(bio_en) <= 1000 and char_length(bio_ar) <= 1000),
  constraint coaches_photo   check (photo_path is null
                                    or photo_path ~ '^coaches/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  constraint coaches_retired check ((status = 'retired') = (retired_at is not null))
);
```

The photo lives in `menu-media` under `coaches/<uuid>/<uuid>.<ext>`: the operator uploads first, to a
**fresh random uuid folder, never a profile or coach id** (R43), and saves the path with
`coach_promote` or `coach_update` (which refuse a folder that is a `profiles.id` or `coaches.id`,
§4.6.3). The profile's own name and phone are never public; `display_name_*` are.
`public_accepted_at` is set by the coach's `coach_accept_public` (§4.7.5); until then no public read
or guest listing shows the coach (C-22, R61). A re-promoted retired coach starts unaccepted again.

#### 4.3.2 `coach_branches` (branch)

`coach_id uuid not null references coaches(id)`, `venue_id`, `active boolean not null default true`,
`created_at timestamptz not null default now()`; primary key `(coach_id, venue_id)`. Guard
`('scoped')`. A coach is bookable at a branch while `active`; deactivating a branch keeps its lessons.

#### 4.3.3 `coach_time_off` (chain-wide)

```sql
create table if not exists coach_time_off (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references coaches(id),
  period          tstzrange not null,
  reason          text not null default '',
  set_by          text not null,
  set_by_staff_id uuid references staff(id),
  created_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  constraint coach_time_off_period check (not isempty(period) and not lower_inf(period)
                                          and not upper_inf(period) and lower_inc(period)
                                          and not upper_inc(period)),
  constraint coach_time_off_reason check (char_length(reason) <= 200),
  constraint coach_time_off_set_by check (set_by in ('coach', 'staff')
                                          and (set_by = 'staff') = (set_by_staff_id is not null)),
  constraint coach_time_off_no_overlap exclude using gist
    (coach_id extensions.gist_uuid_ops with =, period with &&) where (cancelled_at is null)
);
```

#### 4.3.4 `coach_hours` (branch)

```sql
create table if not exists coach_hours (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references coaches(id),
  venue_id        uuid not null references venues(id),
  weekday         smallint not null,
  start_time      time not null,
  end_time        time not null,
  set_by          text not null,
  set_by_staff_id uuid references staff(id),
  updated_at      timestamptz not null default now(),
  constraint coach_hours_weekday check (weekday between 0 and 6),
  constraint coach_hours_window  check (start_time < end_time and end_time <= time '24:00'
                                        and extract(second from start_time) = 0
                                        and extract(second from end_time) = 0
                                        and extract(minute from start_time)::int % 30 = 0
                                        and extract(minute from end_time)::int % 30 = 0),
  constraint coach_hours_set_by  check (set_by in ('coach', 'staff')
                                        and (set_by = 'staff') = (set_by_staff_id is not null))
);
```

`weekday` is `extract(dow …)` of the branch's local date (Sunday 0). A window lies inside one local
day (CD-10); `24:00` is the end of that day. Windows sit on :00/:30, so every grid start (C-20) fits a
window exactly. Overlap between a coach's windows on one weekday, across branches, is refused by the
writers under the coach lock (`HOURS_OVERLAP`, §4.6.5). Guard `('scoped')`.

#### 4.3.5 `lesson_types` (branch)

```sql
create table if not exists lesson_types (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references venues(id),
  kind                text not null,
  name_en             text not null,
  name_ar             text not null,
  description_en      text not null default '',
  description_ar      text not null default '',
  duration_min        smallint not null,
  price_iqd           iqd,
  court_share_iqd     iqd not null default 0,
  max_places          smallint not null,
  min_places          smallint not null default 1,
  cutoff_hours        smallint not null default 0,
  sessions_count      smallint,
  is_active           boolean not null default false,
  launched_at         timestamptz,
  sort_order          int not null default 0,
  created_by_staff_id uuid references staff(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint lesson_types_kind     check (kind in ('private', 'group', 'course')),
  constraint lesson_types_text     check (char_length(name_en) between 1 and 60
                                          and char_length(name_ar) between 1 and 60
                                          and char_length(description_en) <= 500
                                          and char_length(description_ar) <= 500),
  constraint lesson_types_duration check (duration_min between 30 and 240 and duration_min % 30 = 0),
  constraint lesson_types_places   check (
    (kind = 'private' and max_places between 1 and 4 and min_places = 1 and cutoff_hours = 0)
    or (kind in ('group', 'course') and max_places between 2 and 16
        and min_places between 1 and max_places and cutoff_hours between 0 and 168)),
  constraint lesson_types_sessions check ((kind = 'course') = (sessions_count is not null)
                                          and (sessions_count is null or sessions_count between 2 and 52)),
  constraint lesson_types_launch   check ((price_iqd is not null or launched_at is null)
                                          and (not is_active or launched_at is not null)),
  constraint lesson_types_price    check ((price_iqd is null or price_iqd > 0)
                                          and (kind <> 'course' or price_iqd is null
                                               or price_iqd >= sessions_count)),
  constraint lesson_types_cutoff   check (kind = 'private' or min_places = 1 or cutoff_hours >= 1)  -- R26
);
```

`lesson_types_launch` is §1.2's two CHECKs, named. `lesson_types_cutoff` (R26): a type with a minimum
above one has a cut-off of at least an hour, so the sweep can judge it before the start; the writer
defaults `cutoff_hours` to 2 for a new group or course type (§4.6.4). `lesson_types_price` is new
(§10): a list price is never 0, and a course price is at least one dinar per session, so every
`iqd_split` share (R2, R60) is
positive (late joins, refunds of the remaining sessions). `kind` never changes after insert (the
writer refuses, §4.6.4). Guard `('scoped')`.

#### 4.3.6 `coach_lesson_types`, `coach_prices` (branch)

- **`coach_lesson_types`**: `coach_id → coaches`, `lesson_type_id → lesson_types`, `venue_id`,
  `created_at`; primary key `(coach_id, lesson_type_id)`. Guard `('scoped', 'lesson_types',
  'lesson_type_id')`.
- **`coach_prices`**: `coach_id → coaches`, `lesson_type_id → lesson_types`, `venue_id`, `price_iqd
  iqd not null` with `constraint coach_prices_positive check (price_iqd > 0)` (and, for a course type,
  `>= sessions_count`, checked by the writer), `set_at timestamptz not null default now()`,
  `protocol_run_id uuid references protocol_runs(id)` (NULL only for an owner's direct write);
  primary key `(coach_id, lesson_type_id)`. Guard `('scoped', 'lesson_types', 'lesson_type_id',
  'protocol_runs', 'protocol_run_id')`. Written by `set_coach_price_internal`, and deleted (audited)
  by `set_coach_lesson_types` when the coach stops teaching the type (R46): a relink starts from the
  type price, so an old approval never comes back against a different type price.

#### 4.3.7 `courses` (branch)

```sql
create table if not exists courses (
  id                    uuid primary key default gen_random_uuid(),
  venue_id              uuid not null references venues(id),
  coach_id              uuid not null references coaches(id),
  lesson_type_id        uuid not null references lesson_types(id),
  title_en              text not null default '',
  title_ar              text not null default '',
  price_iqd             iqd not null,
  court_share_iqd       iqd not null,
  coach_share_bp        int not null,
  sessions_count        smallint not null,
  max_places            smallint not null,
  min_places            smallint not null,
  cutoff_at             timestamptz not null,
  cutoff_checked_at     timestamptz,
  signup_closes_at      timestamptz not null,
  status                text not null default 'open',
  cancel_reason         text,
  created_by_kind       text not null,
  created_by_profile_id uuid references profiles(id),
  created_by_staff_id   uuid references staff(id),
  idempotency_key       text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  cancelled_at          timestamptz,
  constraint courses_status     check (status in ('open', 'running', 'completed', 'cancelled')),
  constraint courses_cancel     check ((status = 'cancelled') = (cancelled_at is not null)
                                       and (status = 'cancelled') = (cancel_reason is not null)
                                       and (cancel_reason is null or cancel_reason in
                                         ('guest_cancel', 'coach_cancel', 'staff_cancel', 'under_filled',
                                          'payment_expired', 'account_deleted', 'coach_retired'))),
  constraint courses_titles     check (char_length(title_en) <= 80 and char_length(title_ar) <= 80),
  constraint courses_numbers    check (price_iqd > 0 and price_iqd >= sessions_count
                                       and coach_share_bp between 0 and 10000
                                       and sessions_count between 2 and 52
                                       and max_places between 2 and 16
                                       and min_places between 1 and max_places
                                       and cutoff_at <= signup_closes_at),
  constraint courses_created_by check ((created_by_kind = 'coach' and created_by_profile_id is not null
                                        and created_by_staff_id is null)
                                       or (created_by_kind = 'staff' and created_by_staff_id is not null)),
  constraint courses_idem       check (idempotency_key is null
                                       or char_length(idempotency_key) between 1 and 200)
);
```

`cutoff_at` = session 1's start − `cutoff_hours`; `signup_closes_at` = the last session's start (C-15);
both follow a reschedule of the first or last session (§4.7.6). `cutoff_checked_at` (R22) is
stamped when the sweep has judged the cut-off, so a course that passed it is never judged again.
`signup_closes_at` also closes coach and desk adds (R39, R48). Guard `('scoped', 'lesson_types',
'lesson_type_id')`.

#### 4.3.8 `lessons` (branch; one session on one court)

```sql
create table if not exists lessons (
  id                    uuid primary key default gen_random_uuid(),
  venue_id              uuid not null references venues(id),
  coach_id              uuid not null references coaches(id),
  lesson_type_id        uuid not null references lesson_types(id),
  kind                  text not null,
  course_id             uuid references courses(id),
  session_no            smallint,
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  period                tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  price_iqd             iqd,
  court_share_iqd       iqd not null,
  coach_share_bp        int not null,
  max_places            smallint not null,
  min_places            smallint not null,
  cutoff_at             timestamptz,
  cutoff_checked_at     timestamptz,
  status                text not null default 'scheduled',
  hold_expires_at       timestamptz,
  booked_by_kind        text not null,
  created_by_profile_id uuid references profiles(id),
  created_by_staff_id   uuid references staff(id),
  cancel_reason         text,
  cancelled_at          timestamptz,
  completed_at          timestamptz,
  rescheduled_at        timestamptz,                  -- R8, R32
  idempotency_key       text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint lessons_kind          check (kind in ('private', 'group', 'course')),
  constraint lessons_course        check ((kind = 'course') = (course_id is not null)
                                          and (course_id is null) = (session_no is null)
                                          and (session_no is null or session_no between 1 and 52)),
  constraint lessons_price         check ((kind = 'course') = (price_iqd is null)),
  constraint lessons_time          check (end_at > start_at and end_at - start_at <= interval '240 minutes'),
  constraint lessons_cutoff        check ((kind = 'private') = (cutoff_at is null)),
  constraint lessons_places        check (max_places between 1 and 16 and min_places between 1 and max_places),
  constraint lessons_status        check (status in ('held', 'scheduled', 'completed', 'cancelled', 'expired')),
  constraint lessons_hold          check ((status = 'held') = (hold_expires_at is not null)
                                          and (status <> 'held' or kind = 'private')),
  constraint lessons_ended         check ((status in ('cancelled', 'expired')) = (cancelled_at is not null)
                                          and (status in ('cancelled', 'expired')) = (cancel_reason is not null)
                                          and (status = 'completed') = (completed_at is not null)
                                          and (status <> 'expired' or cancel_reason = 'payment_expired')),
  constraint lessons_cancel_reason check (cancel_reason is null or cancel_reason in
                                          ('guest_cancel', 'coach_cancel', 'staff_cancel', 'under_filled',
                                           'payment_expired', 'account_deleted', 'coach_retired')),
  constraint lessons_booked_by     check ((booked_by_kind in ('guest', 'coach') and created_by_profile_id is not null
                                           and created_by_staff_id is null)
                                          or (booked_by_kind = 'staff' and created_by_staff_id is not null)),
  constraint lessons_idem          check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  constraint lessons_coach_no_overlap exclude using gist
    (coach_id extensions.gist_uuid_ops with =, period with &&) where (status in ('held', 'scheduled'))
);
```

Snapshots at creation: `kind`, `court_share_iqd`, `max_places`, `min_places` from the type (a course
session: from its course); `price_iqd` = `lesson_price_for(coach, type)` (private: the lesson; group:
one place; course session: NULL); `coach_share_bp` from `coaching_rules`. `cutoff_at`: group = start −
`cutoff_hours`; course session = its course's `cutoff_at`; private NULL. A course session's
`booked_by_kind` is its course's `created_by_kind`. `rescheduled_at` is stamped by every reschedule
(§4.7.6); a guest who booked before it may cancel free until the new start (R8). Money's revival
(R29) clears `cancel_reason`, `cancelled_at` and `hold_expires_at` so `lessons_ended` holds. Guard
`('scoped', 'lesson_types', 'lesson_type_id', 'courses', 'course_id')`.

#### 4.3.9 `lesson_enrolments` (branch)

```sql
create table if not exists lesson_enrolments (
  id                   uuid primary key default gen_random_uuid(),
  venue_id             uuid not null references venues(id),
  lesson_id            uuid references lessons(id),
  course_id            uuid references courses(id),
  guest_id             uuid references profiles(id),
  guest_name           text,
  guest_phone          text,
  party_size           smallint not null default 1,
  friend_names         text[] not null default '{}',
  booked_by_kind       text not null,
  booked_by_profile_id uuid references profiles(id),
  booked_by_staff_id   uuid references staff(id),
  price_iqd            iqd not null,
  first_session_no     smallint,
  sessions_covered     smallint,
  payment_mode         text not null,
  status               text not null default 'booked',
  hold_expires_at      timestamptz,
  cancel_kind          text,
  cancelled_at         timestamptz,
  link_confirmed_at    timestamptz,                   -- C-21, R44
  idempotency_key      text unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint lesson_enrolments_target    check (num_nonnulls(lesson_id, course_id) = 1),
  constraint lesson_enrolments_who       check (guest_id is not null or guest_name is not null),
  constraint lesson_enrolments_typed     check (booked_by_kind = 'guest' or guest_name is not null),
  constraint lesson_enrolments_link      check ((link_confirmed_at is null or guest_id is not null)
                                                and (booked_by_kind <> 'guest' or link_confirmed_at is not null)),
  constraint lesson_enrolments_name      check (guest_name is null or char_length(guest_name) between 1 and 80),
  constraint lesson_enrolments_phone     check (guest_phone is null
                                                or coalesce(app.phone_digits(guest_phone), '') ~ '^[0-9]{7,15}$'),
  constraint lesson_enrolments_party     check (party_size between 1 and 4
                                                and (course_id is null or party_size = 1)),
  constraint lesson_enrolments_friends   check (cardinality(friend_names) <= 3
                                                and cardinality(friend_names) <= party_size - 1
                                                and char_length(array_to_string(friend_names, '')) <= 120),
  constraint lesson_enrolments_booked_by check (
    (booked_by_kind = 'guest' and guest_id is not null and booked_by_profile_id = guest_id
       and booked_by_staff_id is null)
    or (booked_by_kind = 'coach' and booked_by_profile_id is not null and booked_by_staff_id is null)
    or (booked_by_kind = 'staff' and booked_by_staff_id is not null)),
  constraint lesson_enrolments_course    check ((course_id is not null) = (first_session_no is not null)
                                                and (first_session_no is null) = (sessions_covered is null)
                                                and (sessions_covered is null or sessions_covered >= 1)),
  constraint lesson_enrolments_payment   check (payment_mode in ('desk', 'online')
                                                and (booked_by_kind = 'guest' or payment_mode = 'desk')),
  constraint lesson_enrolments_status    check (status in ('held', 'booked', 'cancelled', 'expired')),
  constraint lesson_enrolments_hold      check ((status = 'held') = (hold_expires_at is not null)
                                                and (status <> 'held' or payment_mode = 'online')),
  constraint lesson_enrolments_ended     check ((status in ('cancelled', 'expired'))
                                                  = (cancelled_at is not null and cancel_kind is not null)
                                                and (status <> 'expired' or cancel_kind = 'expired')),
  constraint lesson_enrolments_cancel_kind check (cancel_kind is null or cancel_kind in
    ('guest_free', 'guest_late', 'coach', 'staff', 'under_filled', 'expired', 'account_deleted',
     'course_cancelled')),
  constraint lesson_enrolments_idem      check (idempotency_key is null
                                                or char_length(idempotency_key) between 1 and 200)
);
```

- `guest_phone`'s CHECK uses `app.phone_digits`, not `app.phone_canon` (R11: no grant). The
  writers refuse a phone `app.phone_canon` cannot read (`INVALID_ARGUMENT`, detail `p_phone` or
  `p_student_phone`), so every stored phone also has a canonical form.
- **Identity** (R10, R44, C-21). A coach- or staff-booked enrolment always carries the name (and
  phone, when given) that was typed (`lesson_enrolments_typed`); every staff and coach surface shows
  those, never the profile's. A typed phone links an account only on an exact match of a
  **verified** phone (§4.7.5), and the link is **pending** (`guest_id` set, `link_confirmed_at`
  NULL) until that person answers "Is this you?" (`lesson_link_confirm`). A guest-booked enrolment,
  and a desk booking that picked the customer (`p_customer_id`), are linked at insert
  (`link_confirmed_at = now()`; the desk copies the profile's name and phone into the typed columns).
- The per-name rule for `friend_names` (each 1..40 after cleaning) is the writers'; the sanitiser
  cleans and drops empty entries. CD-1: coach and desk bookings are `desk` (`lesson_enrolments_payment`).
- Guard `('scoped', 'lessons', 'lesson_id', 'courses', 'course_id')`.

#### 4.3.10 `lesson_attendance`, `lesson_strikes`, `lesson_events` (branch)

```sql
create table if not exists lesson_attendance (
  lesson_id            uuid not null references lessons(id),
  enrolment_id         uuid not null references lesson_enrolments(id),
  venue_id             uuid not null references venues(id),
  status               text not null,
  marked_by_kind       text not null,
  marked_by_profile_id uuid references profiles(id),
  marked_by_staff_id   uuid references staff(id),
  marked_at            timestamptz not null default now(),
  primary key (lesson_id, enrolment_id),
  constraint lesson_attendance_status check (status in ('attended', 'no_show')),
  constraint lesson_attendance_by     check ((marked_by_kind = 'coach' and marked_by_profile_id is not null
                                            and marked_by_staff_id is null)
                                           or (marked_by_kind = 'staff' and marked_by_staff_id is not null))
);

create table if not exists lesson_strikes (
  enrolment_id uuid not null references lesson_enrolments(id),
  lesson_id    uuid not null references lessons(id),
  venue_id     uuid not null references venues(id),
  guest_id     uuid not null references profiles(id),
  kind         text not null,
  struck_at    timestamptz not null default now(),
  settled_at   timestamptz,
  counted      boolean,
  primary key (enrolment_id, lesson_id),
  constraint lesson_strikes_kind    check (kind in ('late_cancel', 'no_show', 'lapsed_hold')),   -- R30
  constraint lesson_strikes_settled check ((settled_at is null) = (counted is null))
);

create table if not exists lesson_events (
  id               bigint generated always as identity primary key,
  venue_id         uuid not null references venues(id),
  lesson_id        uuid references lessons(id),
  course_id        uuid references courses(id),
  enrolment_id     uuid references lesson_enrolments(id),
  type             text not null,
  actor            text not null,
  actor_profile_id uuid references profiles(id),
  actor_staff_id   uuid references staff(id),
  code             text,
  data             jsonb not null default '{}'::jsonb,
  at               timestamptz not null default now(),
  constraint lesson_events_type   check (type in ('booked', 'held', 'paid_online', 'expired', 'joined',
                                       'added', 'cancelled', 'enrolment_cancelled', 'rescheduled',
                                       'court_moved', 'under_filled', 'completed', 'attended', 'no_show',
                                       'unmarked', 'settled', 'refunded')),
  constraint lesson_events_target check (num_nonnulls(lesson_id, course_id) >= 1),
  constraint lesson_events_actor  check ((actor in ('guest', 'coach') and actor_profile_id is not null
                                          and actor_staff_id is null)
                                         or (actor = 'staff' and actor_staff_id is not null)
                                         or (actor = 'system' and actor_profile_id is null
                                             and actor_staff_id is null)),
  constraint lesson_events_code   check (code is null or char_length(code) <= 40),
  constraint lesson_events_data   check (jsonb_typeof(data) = 'object')
);
```

Guards: `lesson_attendance` and `lesson_strikes` `('scoped', 'lessons', 'lesson_id',
'lesson_enrolments', 'enrolment_id')`; `lesson_events` `('scoped', 'lessons', 'lesson_id', 'courses',
'course_id', 'lesson_enrolments', 'enrolment_id')`. A course strike or mark names the session
(`lesson_id`) and the course enrolment; a `lapsed_hold` strike of a course enrolment names its first
covered session. `lesson_events.data` carries ids, times, counts, codes and flags only, never a name
or a phone (§5.2).

#### 4.3.11 `coach_statements`, `coach_statement_lines` (branch; DB writes the DDL, Money is the only writer); `coach_photo_purges`

```sql
create table if not exists coach_statements (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references coaches(id),
  venue_id        uuid not null references venues(id),
  month           date not null,
  status          text not null default 'draft',
  lessons_count   int  not null default 0,
  collected_iqd   iqd  not null default 0,
  court_share_iqd iqd  not null default 0,
  coach_iqd       iqd_signed not null default 0,
  adjustments_iqd iqd_signed not null default 0,
  drafted_at      timestamptz not null default now(),
  refreshed_at    timestamptz,
  approved_by     uuid references staff(id),
  approved_at     timestamptz,
  paid_by         uuid references staff(id),
  paid_at         timestamptz,
  paid_reference  text,
  voided_by       uuid references staff(id),
  voided_at       timestamptz,
  void_reason     text,
  constraint coach_statements_month  check (extract(day from month) = 1),
  constraint coach_statements_status check (status in ('draft', 'approved', 'paid', 'void')),
  constraint coach_statements_stamps check ((approved_at is null) = (approved_by is null)
                                            and (paid_at is null) = (paid_by is null)
                                            and (status not in ('approved', 'paid') or approved_at is not null)
                                            and (status <> 'paid' or (paid_at is not null and paid_reference is not null))
                                            and (status = 'void') = (voided_at is not null and voided_by is not null
                                                                     and void_reason is not null)),
  constraint coach_statements_text   check ((paid_reference is null or char_length(paid_reference) between 1 and 80)
                                            and (void_reason is null or char_length(void_reason) between 1 and 200)),
  constraint coach_statements_no_card check (coalesce(paid_reference, '') !~ '[0-9]{12}'          -- R49
                                             and coalesce(void_reason, '') !~ '[0-9]{12}')
);

create table if not exists coach_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  statement_id    uuid not null references coach_statements(id),
  venue_id        uuid not null references venues(id),
  lesson_id       uuid not null references lessons(id),            -- R24: every line, adjustments too
  collected_iqd   iqd_signed not null default 0,
  court_share_iqd iqd_signed not null default 0,
  share_bp        int not null,
  coach_iqd       iqd_signed not null,
  is_adjustment   boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint coach_statement_lines_bp   check (share_bp between 0 and 10000),
  constraint coach_statement_lines_sign check (is_adjustment                                     -- R22
                                               or (collected_iqd >= 0 and court_share_iqd >= 0 and coach_iqd >= 0))
);
```

R24: `coach_statement_lines_kind` is gone. Every line names its lesson; `is_adjustment` marks a line
for a lesson that already has lines on an approved or paid statement; one line per lesson per
statement (`coach_statement_lines_one_per_lesson`, 0276). `coach_iqd`, `adjustments_iqd` and the
line money are signed (a refund after payment comes back as a negative adjustment, R22).
`coach_statements_no_card` backs Money's `INVALID_ARGUMENT` on a run of 12 or more digits (R49: a
card or account number never lands in a free-text field). Guards: `coach_statements` `('scoped')`;
`coach_statement_lines` `('scoped', 'coach_statements', 'statement_id', 'lessons', 'lesson_id')`.
The one-live-per-month unique index is in 0276.

**`coach_photo_purges`** (chain-wide; R43): the folders of photos to remove from `menu-media`.

```sql
create table if not exists coach_photo_purges (
  id        uuid primary key default gen_random_uuid(),
  coach_id  uuid not null references coaches(id),
  folder    text not null,
  queued_at timestamptz not null default now(),
  purged_at timestamptz,
  constraint coach_photo_purges_folder check (folder ~ '^coaches/[0-9a-f-]{36}$')
);
```

Queued by retirement (`set_coach_status`, §4.7.7) and account deletion (0286) from the coach's
`photo_path` before it is cleared; read and closed by the service RPCs `coach_photo_purge_due` and
`coach_photo_purged` (0279, §4.6.3), which the `protocol-action` edge path calls, removing
`coaches/<folder>/*` within a day (the incident-photo precedent).

#### 4.3.12 Changed tables

**`reservations` (DB):**

```sql
alter table reservations add column if not exists lesson_id uuid;
-- each add inside one do block guarded on conname + conrelid, NOT VALID; then one guarded validate block:
alter table reservations add constraint reservations_lesson_id_fkey
  foreign key (lesson_id) references lessons(id) not valid;
alter table reservations add constraint reservations_lesson_link
  check (kind <> 'lesson' or lesson_id is not null) not valid;
alter table reservations add constraint reservations_lesson_kind
  check (lesson_id is null or kind in ('lesson', 'hold')) not valid;
alter table reservations add constraint reservations_lesson_row
  check (lesson_id is null
         or (guest_id is null and guest_name = 'Lesson' and guest_phone is null and price_iqd is null
             and rate_rule_id is null and series_id is null)) not valid;
-- the 0071 hold rule, widened for a lesson's court hold (§1.3, R1); then the guarded validate:
alter table reservations drop constraint if exists reservations_live_hold_has_guest;
alter table reservations add constraint reservations_live_hold_has_guest
  check (kind <> 'hold' or status <> 'pending' or guest_id is not null or lesson_id is not null) not valid;
```

`reservations_lesson_row` (new, §10) pins §1.2's "guest_id null and guest_name exactly 'Lesson'" and
keeps money off the court row: lesson money lives on enrolments, and no court figure that sums
`reservations.price_iqd` can count it (they also filter `kind = 'booking'`: `unpaid_played_bookings`,
0265:742). `zz_branch_guard` on `reservations` re-created from 0230:187-189 with the pair added:
`('scoped', 'rate_rules', 'rate_rule_id', 'reservation_series', 'series_id', 'protocol_runs',
'protocol_run_id', 'lessons', 'lesson_id')`.

**`tabs`, `booking_payments` (Money, in this file after the tables):** the §1.2 columns and CHECKs
(`tabs.lesson_enrolment_id`, `tabs.lesson_iqd`, `tabs_lesson_shape`;
`booking_payments.lesson_enrolment_id`, `booking_payments_anchor`,
`booking_payments_reason_by_purpose`), as `money.md` specifies, with R22's amendments (a lesson
payment row has `reservation_id` NULL; `tabs_lesson_shape` also requires `court_cap_iqd` NULL on a
lesson tab and `lesson_iqd = 0` on every other tab). The guards Money re-creates: `tabs` from
0230:196-198 plus `'lesson_enrolments', 'lesson_enrolment_id'`; `booking_payments` from 0241:99-101
plus the same pair. Their partial unique indexes are in DB's 0276.

#### 4.3.13 Sanitisers, append-only and frozen triggers

Every function is `security definer set search_path = public`, revoked from public, anon,
authenticated; every sanitiser is `before insert or update of <its columns> … for each row` and sorts
before `zz_branch_guard`.

| Trigger | Function | Does |
| --- | --- | --- |
| `coaches_sanitise` | `trg_sanitise_coach()` | `display_name_*` := `app.safe_line`; `bio_*` := `coalesce(app.safe_text(…), '')` |
| `lesson_types_sanitise` | `trg_sanitise_lesson_type()` (§10) | `name_*` := `app.safe_line`; `description_*` := `coalesce(app.safe_text(…), '')` |
| `courses_sanitise` | `trg_sanitise_course()` (§10) | `title_*` := `coalesce(app.safe_line(…), '')` |
| `coach_time_off_sanitise` | `trg_sanitise_coach_time_off()` (§10) | `reason` := `coalesce(app.safe_line(…), '')` |
| `lesson_enrolments_sanitise` | `trg_sanitise_lesson_enrolment()` | `guest_name`, `guest_phone` := `nullif(app.safe_line(…), '')`; `friend_names` := each `app.safe_line`, empties dropped, order kept |
| `coach_statements_sanitise` | `trg_sanitise_coach_statement()` (§10) | `paid_reference`, `void_reason` := `nullif(app.safe_line(…), '')` |
| `lesson_events_append_only` | `app.forbid_mutation()` (0003:36) | `before update or delete or truncate … for each statement` (0258:412-415) |
| `coach_statement_lines_frozen` | `trg_coach_statement_lines_frozen()` | `before insert or update or delete … for each row`: the statement of `new.statement_id` (and of `old.statement_id` on update and delete) in `approved`, `paid` or `void` (R22) → `STATEMENT_NOT_DRAFT` |

`app.safe_line` and `app.safe_text` (0080:69-123) never return NULL for a non-NULL input, so a NOT NULL
column survives them.

#### 4.3.14 Storage: `menu-media/coaches/`

Re-create `menu_media_staff_insert` from its latest body (0234:452-454) with `'coaches'` appended to
the folder list, in a `do` block that degrades to a NOTICE on `insufficient_privilege` (the
0062:201-213 shape), keeping the 0234 InitPlan form `(select app.is_staff(variadic
array['manager'::staff_role, 'owner'::staff_role]))`. Managers and the owner upload; that is C-7. The
read, update and delete policies already cover the bucket (0234:448-459). After the hosted push,
check that `storage.objects` has the policy (`packages/db/CLAUDE.md`, "Verify before you report").
`app.storage_path_in_use` (0223:498) is re-issued in 0279 to count `coaches.photo_path` (R43), so the
operator's `removeMedia` never deletes a live coach photo and does delete a replaced one. Any manager
may write any object in the bucket (0234:448-459); that chain-wide rule is accepted (§9).

#### 4.3.15 Gates (0275)

| Gate | In this commit |
| --- | --- |
| Matrix | for each of the 16 tables: `{kind: 'select', name, expect: ex('denied'), drop: 25}` and `{kind: 'write', name, op: 'insert', payload, expect: ex('denied'), drop: 25}`; payload `{id: NIL_UUID}` for the tables with an `id`, `{coach_id: NIL_UUID}` for `coach_branches`, `coach_lesson_types`, `coach_prices`, `{lesson_id: NIL_UUID}` for `lesson_attendance`, `{enrolment_id: NIL_UUID}` for `lesson_strikes` |
| Allowlist | none (no granted RPC) |
| Coverage | `coaches`, `coach_branches`, `coach_hours`, `lesson_types`, `coach_lesson_types`, `coach_prices`, `courses`, `lessons` `table_read`, with readable-column rows for every column but `profile_id`, `created_by_profile_id`, `bio_*`, `photo_path`, `public_accepted_at`; `lesson_enrolments`, `lesson_attendance`, `lesson_strikes`, `lesson_events`, `coach_time_off` `excluded: student identity, attendance, strikes or a coach's time-off reasons; the owner reads lessons through desk_lessons, customer_lessons and report_lessons`; **`coach_statements` and `coach_statement_lines` `excluded: a coach's pay, money about a named person; never readable by the owner assistant or any LLM`** (C-28, R42, the `salary_deductions` precedent); `coach_photo_purges` `excluded: storage housekeeping`; the six trigger functions, `lock_coach` and `try_lock_coach` `excluded: service_role only — …` |
| SEC-20 | §4.3.16 |
| Codes | `STATEMENT_NOT_DRAFT` (first raised here, by the frozen trigger): DB adds the catalogue line, EN and AR, in this commit (G5); Money words it |
| Lock gate | §2.5 lands here (R6, R33): `ORDER`, `ADVISORY`, `ONCE_PER_SEQUENCE`, `SERVICE_WALK` (four names), the `skip locked` rule; `lock-order-matches.test.ts` `DECLARED` and `:75`; the new `lock-order-coaching.test.ts` pure half |
| Other | `types.gen.ts`; `docs/design/multi-venue/slice-1-2026-09-21.md`: scoped list + the 13 branch tables, global list + `coaches`, `coach_time_off`, `coach_photo_purges` |

#### 4.3.16 SEC-20 declarations

`LINK_COLUMNS` (`tests/stored-fields.test.ts:99-102`) gains `created_by_profile_id`,
`booked_by_profile_id`, `marked_by_profile_id`, `actor_profile_id` (no existing table has them,
checked by grep), so `lessons`, `courses`, `lesson_attendance` and `lesson_events` are discovered
beside `coaches` (`profile_id`), `lesson_enrolments` and `lesson_strikes` (`guest_id`). The `Field`
type's `onDelete` gains **`'empty'`**: a NOT NULL text or array the deletion sets to `''` or `'{}'`;
the proof (§4.10) checks it.

| Table | Personal columns (every other column `n`) |
| --- | --- |
| `coaches` | `display_name_en`, `display_name_ar`: Name, "the coach's public name, chosen by the venue; kept on a deleted coach for the statements the venue paid (C-29, R63)", `keep`; `bio_en`, `bio_ar`: User content, "the coach's public bio, written by a manager", `empty`; `photo_path`: Photos, "the coach's public photo; the object is queued for removal on retirement or deletion (R43)", `scrub` |
| `lesson_enrolments` | `guest_name`: Name, "a student a coach or the desk named; replaced by a fixed marker 365 days after the lesson (CD-8, R44)", `anonymise`; `guest_phone`: Phone number, "a student's number typed by a coach or the desk, shown to the coach until 7 days after the session (CD-3, R54), purged after 365 (CD-8)", `scrub`; `friend_names`: Name, "the friends a guest brings to a private lesson", `empty`; `price_iqd`: Purchase history, "what the lesson place cost", `keep` |
| `lessons`, `courses` | `price_iqd`: Purchase history, "the lesson's or course's price when it was booked", `keep` |
| `lesson_strikes`, `lesson_attendance`, `lesson_events` | all `n` (ids, codes, counts, times) |

`guest_name` is `anonymise` because a coach- or staff-booked row must keep a name
(`lesson_enrolments_typed`): deletion writes `'Deleted account'` into a typed name, and leaves a
guest-booked row's NULL. `link_confirmed_at`, `public_accepted_at` and `rescheduled_at` are `n`.

**`COACH_DATA`** (R49; an explicit block reached through `coaches.profile_id`, the
`UNLINKED_PERSONAL` precedent, `stored-fields.test.ts:307-321`, with its own proof):
`coach_time_off.reason`: User content, "a coach's note on their time off", `empty` on deletion;
`coach_statements.collected_iqd`, `court_share_iqd`, `coach_iqd`, `adjustments_iqd` and
`coach_statement_lines` money: a new **`Financial info`** category, "a coach's monthly pay", `keep`
(the venue's accounts); `coach_statements.paid_reference`: Financial info, "the receipt or transfer
number of a coach payment", `keep`; `courses.title_en`, `title_ar`: User content, "a course title a
coach or the desk wrote", `keep`.

### 4.4 0276 `coaching_indexes`

Alone: only `create [unique] index if not exists` statements. The commit message carries
`MIGRATION-RISK-ACCEPTED: new and empty tables, plus partial indexes on reservations, tabs and
booking_payments whose predicates match no row today`, and `MIGRATION_RISK_ACCEPTED=… node
scripts/check-migrations.mjs` is run before the push (CI reads the waiver only from a PR body, and on
a push to `main` judges no file: F14). The non-concurrent indexes on the three hot tables take SHARE
for a full scan under `lock_timeout 3s`, so the push goes **outside trading hours**; if it cannot,
those indexes (`reservations_*`, `tabs_*`, `booking_payments_*` below) move to their own files as
`create index concurrently`, one per file, and every later ordinal shifts (R60).

| Index | Table | Definition |
| --- | --- | --- |
| `coach_branches_venue` | `coach_branches` | `(venue_id) where active` |
| `coach_hours_coach` | `coach_hours` | `(coach_id, weekday)` |
| `coach_hours_venue` | `coach_hours` | `(venue_id, coach_id)` |
| `coach_time_off_coach` | `coach_time_off` | `(coach_id, upper(period)) where cancelled_at is null` |
| `lesson_types_venue` | `lesson_types` | `(venue_id, sort_order)` |
| `coach_lesson_types_type` | `coach_lesson_types` | `(lesson_type_id)` |
| `coach_prices_type` | `coach_prices` | `(lesson_type_id)` |
| `courses_coach` | `courses` | `(coach_id, status)` |
| `courses_venue_live` | `courses` | `(venue_id, signup_closes_at) where status in ('open', 'running')` |
| `courses_cutoff_due` | `courses` | `(cutoff_at) where status = 'open' and cutoff_checked_at is null` |
| `lessons_coach_start` | `lessons` | `(coach_id, start_at)` |
| `lessons_venue_start` | `lessons` | `(venue_id, start_at)` |
| `lessons_course_session` | `lessons` | **unique** `(course_id, session_no) where course_id is not null` |
| `lessons_held_due` | `lessons` | `(hold_expires_at) where status = 'held'` |
| `lessons_cutoff_due` | `lessons` | `(cutoff_at) where status = 'scheduled' and kind = 'group' and cutoff_checked_at is null` |
| `lessons_end_due` | `lessons` | `(end_at) where status = 'scheduled'` |
| `lessons_type` | `lessons` | `(lesson_type_id)` |
| `lesson_enrolments_lesson` | `lesson_enrolments` | `(lesson_id) where lesson_id is not null` |
| `lesson_enrolments_course` | `lesson_enrolments` | `(course_id) where course_id is not null` |
| `lesson_enrolments_guest` | `lesson_enrolments` | `(guest_id, created_at desc) where guest_id is not null` |
| `lesson_enrolments_one_live_lesson` | `lesson_enrolments` | **unique** `(lesson_id, guest_id) where guest_id is not null and lesson_id is not null and status in ('held', 'booked')` |
| `lesson_enrolments_one_live_course` | `lesson_enrolments` | **unique** `(course_id, guest_id) where guest_id is not null and course_id is not null and status in ('held', 'booked')` |
| `lesson_enrolments_held_due` | `lesson_enrolments` | `(hold_expires_at) where status = 'held'` |
| `lesson_enrolments_coach_adds` | `lesson_enrolments` | `(booked_by_profile_id, created_at) where booked_by_kind = 'coach'` (the CD-9 count) |
| `lesson_enrolments_purge_due` | `lesson_enrolments` | `(created_at) where guest_phone is not null or cardinality(friend_names) > 0 or (booked_by_kind <> 'guest' and guest_name <> 'Walk-in')` (CD-8, R44) |
| `lesson_attendance_enrolment` | `lesson_attendance` | `(enrolment_id)` |
| `lesson_strikes_unsettled` | `lesson_strikes` | `(struck_at) where settled_at is null` |
| `lesson_strikes_guest` | `lesson_strikes` | `(guest_id)` |
| `lesson_events_lesson` | `lesson_events` | `(lesson_id, at) where lesson_id is not null` |
| `lesson_events_course` | `lesson_events` | `(course_id, at) where course_id is not null` |
| `lesson_events_venue` | `lesson_events` | `(venue_id, at)` |
| `coach_statements_one_live` | `coach_statements` | **unique** `(coach_id, venue_id, month) where status <> 'void'` (§1.2) |
| `coach_statements_venue` | `coach_statements` | `(venue_id, month)` |
| `coach_statement_lines_statement` | `coach_statement_lines` | `(statement_id)` |
| `coach_statement_lines_one_per_lesson` | `coach_statement_lines` | **unique** `(statement_id, lesson_id)` (R24) |
| `coach_statement_lines_lesson` | `coach_statement_lines` | `(lesson_id)` (Money's look-back) |
| `coach_photo_purges_due` | `coach_photo_purges` | `(queued_at) where purged_at is null` |
| `reservations_one_live_per_lesson` | `reservations` | **unique** `(lesson_id) where lesson_id is not null and status in ('pending', 'confirmed', 'arrived')` |
| `reservations_lesson` | `reservations` | `(lesson_id) where lesson_id is not null` |
| `tabs_one_live_per_enrolment` | `tabs` | **unique** `(lesson_enrolment_id) where lesson_enrolment_id is not null and status in ('open', 'awaiting_payment')` (Money's name, §1.2) |
| `tabs_by_lesson_enrolment` | `tabs` | `(lesson_enrolment_id) where lesson_enrolment_id is not null` (Money's name) |
| `booking_payments_one_active_lesson` | `booking_payments` | **unique** `(lesson_enrolment_id) where purpose = 'lesson' and status in ('created', 'pending')` (Money's name, §1.2) |
| `booking_payments_by_lesson_enrolment` | `booking_payments` | `(lesson_enrolment_id) where lesson_enrolment_id is not null` (Money's name) |

The partial uniques on the two hot tables add `<column> is not null` to §1.2's predicates (R22): the
index stays empty for every non-lesson row and no uniqueness changes (NULLs are distinct). Any further
index Money needs goes into this file by name. **Gates:** the waiver; `types.gen.ts` unchanged.

### 4.5 0277 `lesson_reservation_guards`

Every function keeps its signature (so its grants), is re-issued verbatim from the body named below
with the one change listed, and carries a comment naming 0277. Each is `create or replace`.

#### 4.5.1 A lesson is firm, masked, counted

| Object | Latest | Change |
| --- | --- | --- |
| `match_court_free_firm` | 0260:508 (list at :519) | `r.kind in ('booking', 'maintenance', 'lesson')` |
| `match_quote` | 0261:860 (:916) | the same list |
| `desk_open_matches` | 0262:1573 (:1632) | the same list (`courts_free_firm`) |
| `desk_match_detail` | 0262:1707 (:1763) | the same list |
| trigger `reservations_match` | 0263:167-170 | `drop trigger if exists … ; create trigger reservations_match after insert or update of kind, status, court_id, start_at, end_at on reservations for each row when (new.kind in ('booking', 'maintenance', 'lesson')) execute function app.trg_reservation_match();` The body (0263:58) is not re-issued: part A finds no match for a lesson row (`matches_reservation_key`), part B bumps a filling or waiting match a newly live lesson row leaves with no firm-free court, and a held lesson's success (Money turns the hold row into `kind 'lesson'`) is caught by `old.kind is distinct from new.kind`. Its comment is re-issued to say "booking, maintenance or lesson row". |
| view `court_availability` | 0008:670-674 | `create or replace view court_availability with (security_invoker = off) as select court_id, start_at, end_at, case when kind = 'lesson' then 'booking'::reservation_kind else kind end as kind from reservations where status in ('pending', 'confirmed', 'arrived') and (kind <> 'hold' or hold_expires_at > now());` Same columns, names and types, so `create or replace` is legal and the owner-rights waiver's projection is unchanged; `grant select … to anon, authenticated` re-issued. A held private lesson shows as a hold until paid. |
| `close_branch` | 0233:69 (:104-109) | `r.kind in ('booking', 'hold', 'lesson')`; hint "cancel or move the branch's bookings, lessons, holds and series first". Every live lesson and every live course session has exactly one live court row (§3.4), so this counts them all. Then **R37**: `BRANCH_HAS_BOOKINGS` detail `coaching_money` while the branch has a `coach_statements` row in `draft` or `approved`, a `completed` lesson in a month that has no non-void statement for its coach and branch (Money's statement-lesson rule, `money.md` §7), or an enrolment whose `lesson_enrolment_money(e)->>'refund_due_desk_iqd'` is above 0: once closed, no one could approve, pay or refund them (`is_staff_at` is false there). |

Not changed: `match_pick_court` (0260:533) and `match_court_claimed` (0263:186) already read every
live row whatever its kind; `unpaid_played_bookings` (0265:674) and the court reports filter
`kind = 'booking'`, so lesson rows stay out of court money until Money's 0285 adds the lessons line.

#### 4.5.2 A lesson's court hold is not an orphan (R1, R25)

`expire_stale_holds` (0268:33) and its twin `match_expire_holds` (0268:71), re-issued together (the
twin's comment asks for it): only the orphan line changes, to

```sql
and (r.hold_expires_at < now() or (r.guest_id is null and r.lesson_id is null))   -- 0071, 0277
```

Nothing else changes: same id-ordered single statement, same open-payment skip, same grants (0268
revoked the client grant of `expire_stale_holds` and granted the service role). A lapsed lesson hold
expires by TTL like any hold: at its `hold_expires_at`, or later while its payment is open, exactly
like a deposit hold. Every path that ends a held lesson also expires its hold row at once (§2.3,
`lesson_court_release`), so a cancelled held lesson never keeps its court until the TTL. R1's "only
`lesson_hold_expire`" sentence and §6.3's `SLOT_TAKEN` limit are struck (R25). `hold_strikes_settle`
still skips `guest_id is null` (0252:241); a lapsed online lesson strikes through `lesson_strikes`
(`lapsed_hold`, R30).

#### 4.5.3 `LESSON_VIA_COACHING` (a lesson is changed only through the coaching RPCs)

| Function | Latest | Refusal (detail) and where |
| --- | --- | --- |
| `cancel_reservation` | 0210:543 | right after `v_staff := …` (:566): `if v_staff and v.lesson_id is not null` → `LESSON_VIA_COACHING` (`cancel`). A guest still gets `FORBIDDEN` from the ownership check (a lesson row has no `guest_id`), so no guest learns that a row is a lesson. |
| `mark_reservation` | 0262:3232 | right after `RESERVATION_NOT_FOUND` (:3248-3250), before `MATCH_MARK_SEATS`: `v.lesson_id is not null` → `LESSON_VIA_COACHING` (`mark`), for every status: attendance is per student (§3.5), completion is the sweep's. |
| `extend_reservation` | 0071:444 | after the `FOR UPDATE` read and its `RESERVATION_NOT_FOUND` (:471-474): `LESSON_VIA_COACHING` (`extend`). |
| `staff_create_reservation` | 0263:443 | after the branch block and before `INVALID_RANGE` (:484-486): `p_kind = 'lesson'` → `LESSON_VIA_COACHING` (`create`). It never sets `lesson_id`, so it cannot make a lesson row of another kind. |
| `open_tab` | 0244:70 | in the `p_reservation_id` branch, the read becomes `select status, lesson_id into v_status, v_lesson` (:132); `v_lesson is not null` → `LESSON_VIA_COACHING` (`tab`) before `RESERVATION_NOT_LIVE` (:139). A lesson is paid on its own `kind 'lesson'` tab (Money's `lesson_settle`). |
| `confirm_booking` | 0242:1304 | straight after its `FOR UPDATE` read (R35): `v.lesson_id is not null` → `LESSON_VIA_COACHING` (`confirm`). Guests already get `FORBIDDEN` from ownership; staff were stopped only by a raw 23514 from `reservations_lesson_kind`. |
| `move_reservation` | 0150:37 | after `INVALID_RANGE` (0150:101-103) and before `RESERVATION_IN_PAST`: `v.lesson_id is not null` → `LESSON_VIA_COACHING` (`move`), whatever the new court and times, queued or not (R7). `desk_move_lesson_court` (0280) is the only way to move a lesson's court; a lesson moves in time through its reschedule (§4.7.6). |

`p_reason` and every other branch are verbatim. The refusals come after the row is read, so an
unknown id still answers `RESERVATION_NOT_FOUND` first. Each body takes the row `FOR UPDATE` (after
its court lock) and then refuses, so the lock gate prints what it prints today.

#### 4.5.4 The offline queue

`replay` dispatches as the queuing staff member (§1.3): a `reservation.create` with `kind 'lesson'`
reaches `staff_create_reservation` and is refused (`create`); a `reservation.update` on a lesson row
reaches `cancel_reservation` (`cancel`), `mark_reservation` (`mark`), `extend_reservation`
(`extend`) or `move_reservation` (`move`); a `tab.open` on a lesson row reaches `open_tab` (`tab`).
Each refusal is P0001, recorded once in `sync_replays` as `conflict` and surfaced, never retried
(`replay/index.ts:593-609`). Nothing a till queued while offline can cancel, end, extend, bill, move
or retime a lesson. The core payload enum stays `booking|hold|maintenance` (R13).

**Gates (0277).** Matrix, allowlist, coverage: unchanged (same signatures, no new function).
Codes: `LESSON_VIA_COACHING`, with one operator sentence per detail (`cancel`, `mark`, `extend`,
`create`, `tab`, `confirm`, `move`); `BRANCH_HAS_BOOKINGS` gains a sentence for `coaching_money`.
Lock gate: unchanged sequences. Tests: `coaching-guards.test.ts` (§7). The twin test that pins
`match_expire_holds` to `expire_stale_holds` gains a lesson hold (neither expires it before its time;
both expire it after).

### 4.6 0279 `coaching_admin`

Every function: `security definer set search_path = public`; internals revoked from public, anon,
authenticated; RPCs `revoke … from public, anon; grant execute … to authenticated`. Staff RPCs check
the role first (`app.is_staff(…)`, `FORBIDDEN`), before any argument check or `current_venue()`
(R57), then the branch (`app.is_staff_at(v, …)`, `FORBIDDEN`), the R33 order of open matches. A
manager acts on a coach only when the coach has a `coach_branches` row at a branch the manager works
at (`FORBIDDEN` otherwise); the owner acts on every coach. Every write is audited
(`app.write_audit`, actions below) with ids and flags, never a student's name or phone.

#### 4.6.1 Locks and the coach's identity

- **`lock_coach(p_coach_id uuid) returns void`** (created in **0275**, R6, because Money's 0278 calls
  it): `pg_advisory_xact_lock(hashtextextended('app.coaches:' || p_coach_id::text, 0))` when not NULL
  (the 0260:46-51 shape).
- **`try_lock_coach(p_coach_id uuid) returns boolean`** (0275, R6): the same key through
  `pg_try_advisory_xact_lock`; never waits. Only the sweep calls it.
- **`coach_self(p_raise boolean default true) returns coaches`**: `auth.uid()` NULL → `AUTH_REQUIRED`;
  no profile, or `deleted_at` set → `ACCOUNT_REQUIRED`; no `coaches` row with `profile_id =
  auth.uid()` and `status <> 'retired'` → `NOT_A_COACH`. With `p_raise` false every one of these
  returns NULL instead. A retired coach is `NOT_A_COACH` here (R45: no rosters, no phones, no
  schedule). A paused coach is returned (reads, cancels and marks work; booking, creating and adding
  refuse `COACH_INACTIVE`). Each code is its own literal `raise` (check-error-codes sees literals only,
  the 0260:257-268 rule).
- **`coach_of_caller() returns coaches`** (§10): the caller's `coaches` row whatever its status, or
  NULL; never raises. Used only by `coach_me` and Money's `my_coach_statements` (a retired coach
  still reads their approved and paid statements, C-25, R45).
- **`coach_me() returns jsonb`** (authenticated; publicByDesign, R12): first statement `v :=
  app.coach_of_caller()`; NULL → `{"coach": null}`; retired → `{"coach": {"id", "status":
  "retired", "display_name_en", "display_name_ar"}, "server_now"}` and nothing else (R45). Else the
  shape of `guest.md` §4.3 (X9) plus DB's bios and the consent stamp: `{coach: {id, status,
  display_name_*, bio_*, photo_path, public_accepted_at, branches: [{venue_id, name_*, timezone,
  coaching_enabled, open_private, open_private_cap}], lesson_types: [{id, venue_id, kind, name_*,
  duration_min, max_places, min_places, sessions_count, cutoff_hours, price_iqd (lesson_price_for),
  is_active}], adds_today, add_cap: 30}, server_now}`. `branches` lists every branch the coach has a
  `coach_branches` row at, a closed one or one with coaching off answering `coaching_enabled:
  false`, so coach mode shows "Lessons are switched off at {branch}" instead of hiding (R45).
  `adds_today` is the CD-9 count; `open_private` / `open_private_cap` are the R56 count and
  `coach_max_open_private` at that branch. It reads no switch and no staff status: a staff member
  who coaches gets the same answer (C-27). Never the profile's phone. Never raises.

#### 4.6.2 Availability, grid and price helpers (internal, `stable`)

- **`coach_in_hours(p_coach_id uuid, p_venue uuid, p_period tstzrange) returns boolean`** (§10):
  true when (1) `coach_branches (p_coach_id, p_venue)` is `active`; (2) with `tz` the branch's
  timezone, `ls := lower(p_period) at time zone tz`, `le := upper(p_period) at time zone tz`, the
  period lies in one local day (`le::date = ls::date`, or `le` is exactly the next local midnight);
  (3) a `coach_hours` row of the coach at the branch has `weekday = extract(dow from ls)`,
  `start_time <= ls::time` and `end_time >= (case when le::date > ls::date then '24:00' else
  le::time end)`; (4) no live `coach_time_off` row of the coach overlaps `p_period`.
- **`coach_available(p_coach_id uuid, p_venue uuid, p_period tstzrange) returns boolean`**:
  `coach_in_hours(…)` and no `lessons` row of the coach, at any branch, in `held` or `scheduled`
  overlaps `p_period` (`lessons_coach_no_overlap` is the backstop). Callers turn false into
  `COACH_BUSY` when such a lesson exists, else `COACH_UNAVAILABLE`. A reschedule uses
  `coach_in_hours` plus its own overlap test that leaves the lesson itself out.
- **`lesson_on_grid(p_start_at timestamptz, p_venue uuid) returns boolean`** (§10, the twin of core
  `grid.ts`; C-20, R9: every lesson start): `l := p_start_at at time zone tz`; `date_trunc('minute',
  l) = l and extract(minute from l)::int in (0, 30)`.
- **`lesson_bookable(p_venue uuid, p_start_at timestamptz, p_end_at timestamptz) returns text`** (§10):
  NULL, or the first of `CLOSED_DATE`, `OUTSIDE_HOURS` that `app.assert_bookable(<the branch's first
  active court by id>, p_start_at, p_end_at)` (0210:52-108, per branch since 0208) raises, caught in a
  `begin … exception when sqlstate 'P0001'` block (the 0261:921-930 shape); `NO_COURT_FREE` when the
  branch has no active court. Lets `coach_slots` and the course pre-check report without raising.
- **`lesson_price_for(p_coach_id uuid, p_lesson_type_id uuid) returns bigint`**:
  `coalesce(coach_prices.price_iqd, lesson_types.price_iqd)`; NULL for a type with no price.

#### 4.6.3 Coaches

| RPC | Roles | Refusals (in order) | Writes |
| --- | --- | --- | --- |
| `coaches_admin(p_venue_id)` | manager, owner | `FORBIDDEN` (role; branch) | — : the operator's shape (X19, `operator.md` §5.6.3): `{coaching_enabled, server_now, coaches: [{coach_id, profile_id, full_name, phone (the profile's: staff see customers), display_name_*, bio_*, photo_path, status, public_accepted_at, sort_order, venue_ids, lesson_type_ids (this branch), prices: [{lesson_type_id, price_iqd}], hours: [{weekday, start_time, end_time}], hours_set_by, hours_set_by_name, hours_updated_at, hours_elsewhere: [{venue_id, venue_name_*, weekday, start_time, end_time}], time_off: [{id, starts_at, ends_at, reason, set_by, set_by_name}], upcoming_lessons}], lesson_types: [<every column>, coach_ids, pending_run: {run_id, change} or null]}` for the coaches with a `coach_branches` row at `v`; the type's `launched_at` tells the operator which fields are locked (R46) |
| `coach_promote(p_profile_id, p_display_name_en, p_display_name_ar, p_bio_en, p_bio_ar, p_photo_path, p_venue_ids uuid[])` | manager, owner | `FORBIDDEN`; `INVALID_ARGUMENT` (names 1..60, bios ≤ 1000, photo path format, a photo folder that is a `profiles.id` or `coaches.id` (R43), `p_venue_ids` empty, detail the argument); `CUSTOMER_NOT_FOUND` (no profile, or deleted); `FORBIDDEN` unless `is_staff_at(v, 'manager','owner')` for every branch; `ALREADY_COACH` (a row not retired) | a new `coaches` row, or the retired row re-activated (status `active`, `retired_at` and `public_accepted_at` NULL, the fields replaced, under `lock_coach`); `coach_branches` rows `active` for every branch; audit `coaching.coach.promote` |
| `coach_update(p_coach_id, p_patch jsonb)` | manager, owner | `FORBIDDEN`; `COACH_NOT_FOUND`; `FORBIDDEN` (scope); `INVALID_ARGUMENT` (keys `display_name_en`, `display_name_ar`, `bio_en`, `bio_ar`, `photo_path` (NULL clears; the R43 folder rule), `sort_order`; a retired coach → detail `retired`) | the row; audit `coaching.coach.update` |
| `set_coach_branches(p_coach_id, p_venue_ids uuid[])` | manager, owner | `FORBIDDEN`; `COACH_NOT_FOUND`; `INVALID_ARGUMENT` (empty); `FORBIDDEN` when the set names, or the change would drop, a branch the manager does not work at; `[lock_coach]`; `BRANCH_HAS_BOOKINGS` (R52) when a branch it drops has a `held` or `scheduled` lesson of the coach not yet ended, or an `open` or `running` course | listed branches upserted `active`; the caller's other branches set inactive; audit `coaching.coach.branches` |
| `set_coach_lesson_types(p_coach_id, p_venue_id, p_lesson_type_ids uuid[])` | manager, owner | `FORBIDDEN` (role; branch); `COACH_NOT_FOUND`; `COACH_NOT_AT_BRANCH`; `LESSON_TYPE_NOT_FOUND` (a type not at the branch) | the coach's set at that branch replaced; the coach's `coach_prices` rows of every type dropped from the set deleted (R46); lessons untouched; audit `coaching.coach.types` (with the prices removed) |

`set_coach_status` lives in 0280 (R16, §4.7.7): retiring cancels lessons through the cancel
internals there.

**Photos (R43).** `app.storage_path_in_use(p_path text)` re-issued from 0223:498, verbatim plus
`+ (select count(*) from coaches where photo_path = p_path)`. Two service-role RPCs, the
`incident_photo_purge_due` / `incident_photos_purged` pair's shape: **`coach_photo_purge_due(p_limit
int default 20) returns jsonb`** (`[{id, folder}]`, oldest `purged_at is null` first) and
**`coach_photo_purged(p_id uuid) returns void`** (stamps `purged_at`). `protocol-action` lists the
objects under each folder, removes them from `menu-media` and marks the row (the same commit edits
`supabase/functions/protocol-action/index.ts`, its test and `functions-deploy`'s change list).

#### 4.6.4 Lesson types and coach prices (the price lock)

- **`upsert_lesson_type(p_venue_id uuid, p_id uuid, p_patch jsonb) returns jsonb`** (manager, owner):
  `FORBIDDEN` (role; `is_staff_at(p_venue_id, …)`); an existing `p_id` is read `for update` and must be
  at `p_venue_id` (`LESSON_TYPE_NOT_FOUND`); `INVALID_ARGUMENT` (detail the key): a key outside the
  allowlist (R46: `name_en`, `name_ar`, `description_en`, `description_ar`, `duration_min`,
  `price_iqd`, `court_share_iqd`, `max_places`, `min_places`, `cutoff_hours`, `sessions_count`,
  `is_active`, `sort_order`, and `kind` on create only; `launched_at`, `venue_id`, `id`,
  `created_by_staff_id` refused by name); `kind` missing on create or present on update; a value
  outside §4.3.5's rules for the resulting row (names, duration, places by kind, `cutoff_hours` with
  `lesson_types_cutoff`, `sessions_count` iff course, price > 0 and ≥ sessions for a course). A new
  group or course type without `cutoff_hours` gets 2 (R26). Then **the lock, for
  `app.staff_role() = 'manager'`** (the 0177:1767-1769 shape): on a launched type (`launched_at is
  not null`) a patch that changes `price_iqd` or `court_share_iqd` → `PRICE_VIA_PROTOCOL` detail
  `price`; one that changes `duration_min`, `sessions_count`, or a private type's `max_places` →
  `PRICE_VIA_PROTOCOL` detail `shape` (R46: the price would buy something else; the operator shows
  these read-only, "Make a new lesson type to change its length or sessions"); on a never-launched
  type, `is_active: true` → `LAUNCH_VIA_PROTOCOL`. A draft is edited freely (C-17); names,
  descriptions, group and course places, cut-off, order and switching a launched type off or back on
  stay the manager's (as menu items). The owner passes every lock. Then `return
  to_jsonb(app.upsert_lesson_type_internal(p_venue_id, p_id, p_patch))`.
- **`upsert_lesson_type_internal(p_venue uuid, p_id uuid, p_patch jsonb) returns lesson_types`** (no
  role check; called by the RPC and the protocol apply): runs the same validator as the wrapper
  (`INVALID_ARGUMENT`, R46), so an apply never meets a raw 23514; `set_config('app.venue_id',
  p_venue)`; insert (with `created_by_staff_id = auth.uid()` when staff) or update the row;
  `is_active` turning true while `launched_at` is NULL stamps `launched_at = now()`; `updated_at =
  now()`; audit `coaching.lesson_type.create` or `.update`. Existing lessons keep their snapshots.
- **`set_coach_price(p_coach_id uuid, p_lesson_type_id uuid, p_price_iqd bigint) returns jsonb`**
  (guard manager, owner; owner only in effect): `FORBIDDEN`; `COACH_NOT_FOUND`;
  `LESSON_TYPE_NOT_FOUND`; `FORBIDDEN` unless `is_staff_at(<type's branch>, …)`; **a manager →
  `PRICE_VIA_PROTOCOL` detail `price`, drafts included** (D-8); `INVALID_ARGUMENT` (`p_price_iqd` ≤
  0, or below `sessions_count` for a course type; NULL removes); `LESSON_TYPE_NOT_OFFERED` (the coach
  does not teach the type). Then `set_coach_price_internal(…, null)`; returns `{coach_id,
  lesson_type_id, price_iqd}`.
- **`set_coach_price_internal(p_coach_id uuid, p_lesson_type_id uuid, p_price_iqd bigint, p_run_id
  uuid) returns void`**: `set_config('app.venue_id', <type's branch>)`; NULL price deletes the row;
  else `insert … on conflict (coach_id, lesson_type_id) do update set price_iqd, set_at = now(),
  protocol_run_id = p_run_id`; audit `coaching.coach_price`.

#### 4.6.5 Hours and time off

- **`set_coach_hours(p_coach_id, p_venue_id, p_windows jsonb)`** (manager, owner) and
  **`set_my_coach_hours(p_venue_id, p_windows jsonb)`** (coach: `coach_self()` first). Refusals:
  `FORBIDDEN` (staff: role, branch, scope) / `NOT_A_COACH`; `COACH_NOT_FOUND`; `COACH_NOT_AT_BRANCH`
  (no active `coach_branches` row); `HOURS_INVALID`, detail the index (or `p_windows`): not an array of
  0..28 objects `{weekday 0..6, start_time "HH:MM", end_time "HH:MM"}`, a time off the :00/:30 grid,
  `start >= end`, `end > "24:00"`; `HOURS_OVERLAP`, detail `"<index>:<weekday>"` (X31): two windows of
  the set overlap on a weekday, or one overlaps the coach's window at another branch on that weekday.
  `[lock_coach]`, the overlap check again, then the coach's rows at the branch replaced (`set_by`
  `staff` with `set_by_staff_id`, or `coach`). Lessons already booked outside the new hours stay.
  Audit `coaching.hours`. Returns the branch's `windows` (`guest.md` §4.3 shape).
- **`coach_hours_mine()`** (coach): the `guest.md` §4.3 shape: `{branches: [{venue_id, name_*,
  timezone, windows: [{id, weekday, start_time, end_time, set_by, updated_at}]}], time_off: [{id,
  starts_at, ends_at, reason, set_by}], server_now}` (time off not cancelled and ending after now).
- **`add_coach_time_off(p_coach_id, p_starts_at, p_ends_at, p_reason)`** (manager, owner, scope) and
  **`add_my_time_off(p_starts_at, p_ends_at, p_reason)`** (coach): `INVALID_ARGUMENT` (NULLs, start ≥
  end, end ≤ now, longer than 366 days, reason over 200); `[lock_coach]`; `TIME_OFF_HAS_LESSONS`,
  detail how many `held`/`scheduled` lessons of the coach overlap (move or cancel them first); insert
  (`coach_time_off_no_overlap` → `HOURS_OVERLAP` detail `time_off`). Audit `coaching.time_off`.
  Returns `{id}`.
- **`cancel_coach_time_off(p_id)`** (manager, owner, scope) and **`cancel_my_time_off(p_id)`** (coach,
  own row only): an unknown or someone else's id → `INVALID_ARGUMENT` detail `p_id` (X31); already
  cancelled → `{duplicate: true}`; `[lock_coach]`; `cancelled_at = now()`; audit.

**Gates (0279).** Matrix: `MANAGER_UP` for `coaches_admin` (`{p_venue_id: VENUE_A}`),
`coach_promote` (nil profile, names `'x'`, `{p_venue_ids: [VENUE_A]}`), `coach_update`,
`set_coach_branches`, `set_coach_lesson_types`, `upsert_lesson_type` (`{p_venue_id: VENUE_A, p_id:
NIL_UUID, p_patch: {}}`), `set_coach_price`, `set_coach_hours`, `add_coach_time_off`,
`cancel_coach_time_off` (nil ids: `COACH_NOT_FOUND`, `LESSON_TYPE_NOT_FOUND` or `INVALID_ARGUMENT`
past the guard); `GUEST_OR_COACH` for `coach_hours_mine`, `set_my_coach_hours`, `add_my_time_off`,
`cancel_my_time_off`; `SELF_AUTHED` for `coach_me`. Allowlist (R12): `coach_me` publicByDesign
("coaching (0279): answers only about the caller — their own coach row, branches and lesson types, or
{coach: null}; no argument, never raises"); the other 14 `guarded`. Coverage: the 15 RPCs
`map:action`; `coach_self`, `coach_of_caller`, `coach_in_hours`, `coach_available`, `lesson_on_grid`,
`lesson_bookable`, `lesson_price_for`, `upsert_lesson_type_internal`, `set_coach_price_internal`,
`coach_photo_purge_due`, `coach_photo_purged` `excluded: service_role only — …`;
`storage_path_in_use` keeps its entry. Codes: `NOT_A_COACH`, `ALREADY_COACH`, `COACH_NOT_FOUND`,
`COACH_NOT_AT_BRANCH`, `LESSON_TYPE_NOT_FOUND`, `LESSON_TYPE_NOT_OFFERED`, `HOURS_INVALID`,
`HOURS_OVERLAP`, `TIME_OFF_HAS_LESSONS`; the existing `PRICE_VIA_PROTOCOL` and `LAUNCH_VIA_PROTOCOL`
copy widened to name lesson prices, plus a sentence for `PRICE_VIA_PROTOCOL` `shape` (R14, R52);
`BRANCH_HAS_BOOKINGS` for `set_coach_branches`. `types.gen.ts`. Tests `coaching-admin.test.ts`.

### 4.7 0280 `lesson_booking` (DB, with Guest's push functions)

#### 4.7.1 Rules for every RPC in this file

1. **Grants.** `coaching_public`, `coach_profile`, `coach_slots`, `lesson_offer`: `anon` and
   `authenticated`. Every other RPC: `authenticated` only.
2. **First statement.** Guest RPCs: `app.lesson_guest(p_act)`; coach RPCs: `app.coach_self()`; staff
   RPCs: the role check (`FORBIDDEN`), before any argument check or `current_venue()` (R57); the four
   public reads have none.
3. **Not yours is not found.** A guest or coach naming an id that is not theirs gets the not-found
   code (`ENROLMENT_NOT_FOUND`, `LESSON_NOT_FOUND`), never `FORBIDDEN`. Staff: a lesson, course or
   enrolment outside `app.visible_venue_ids()` is not found; visible but not `is_staff_at(v, roles)` is
   `VENUE_MISMATCH` (the 0262 desk pattern).
4. **The branch.** `COACHING_OFF` (`coaching_rules(v).coaching_enabled` false) refuses every guest and
   coach booking, join, add and creation. The desk may create, book and add while it is off (staging
   before launch, D-12), and a staff caller at the branch reads `coach_slots` while it is off (R51);
   cancels, marks, reschedules and reads always work, coach mode included (R45). A branch not in
   `app.open_venue_ids()` is not found for guests and coaches; `is_staff_at` is false there for staff.
5. **The coach.** Paused (R16): guest booking and joining, and coach and desk booking, creation and
   adding, refuse `COACH_INACTIVE`; cancels, marks, reschedules and reads work. Not yet accepted
   (`public_accepted_at` NULL, C-22, R61): invisible to guests (booking `COACH_NOT_FOUND`, joining
   `LESSON_NOT_FOUND`, every public read leaves the coach and their sessions out); coach and desk
   paths work. Retired: not found everywhere but `coach_me` and Money's statement reads. **No
   self-enrolment** (C-24, R56): a guest booking or joining a lesson of their own coach row, or the
   desk enrolling the coach's own profile, is `ALREADY_ENROLLED` detail `coach`.
6. **Time.** Every start on the grid (`SLOT_NOT_ON_GRID`, `lesson_on_grid`; C-20, R9: every kind and
   every reschedule); after now (`SLOT_IN_PAST`); opening hours and closed dates (`lesson_bookable` →
   `CLOSED_DATE` / `OUTSIDE_HOURS`, each re-raised as a literal). Guests only: `BEYOND_HORIZON`
   (`max_booking_horizon_days`, the 0269:160-165 test). **Degraded** (R15): every guest and coach
   booking, join, add and creation calls `app.assert_not_degraded_for(<start>, v)`
   (`DEGRADED_LOCKOUT`, 0210:111), `<start>` being the lesson's, or for a course the first session the
   enrolment would cover; the desk is exempt, as `staff_create_reservation` is. **Cut-off at
   creation** (R47): a group session, or a course's session 1, whose start − `cutoff_hours` ≤ now() is
   refused `LESSON_CLOSED` detail `cutoff` by every coach and desk creation and every reschedule of an
   unjudged session.
7. **Idempotency.** `p_idempotency_key` is required (1..200, `INVALID_ARGUMENT` detail
   `p_idempotency_key`) on every book, create, join and add. Lookup on the table that owns the key
   (`lesson_enrolments`, `lessons` for a group session, `courses`): the same booker (profile or staff
   id) → the current answer with `duplicate: true`; anyone else → `IDEMPOTENCY_CONFLICT` (the 0269:98-107
   rule). Looked up after the principal lock (guest, coach) or the guard (desk), again right after
   `lock_coach`, and a `unique_violation` on insert re-reads the same way. Every un-keyed write answers
   a repeat with `duplicate: true` or a state code, never a second effect.
8. **Payment, terms and the hold cap.** Guest RPCs take `p_payment_mode` `desk|online`
   (`INVALID_ARGUMENT`). Branch mode `desk` with `online` → `ONLINE_PAYMENT_OFF`; `online_required`
   with `desk` → `ONLINE_PAYMENT_REQUIRED` (CD-1). With `online`: `TERMS_REQUIRED` detail `lessons`
   unless `app.lesson_terms_ok(<the caller's terms_version>)` (C-26, R50); then `HOLD_QUOTA_EXCEEDED`
   (detail the cap) when `platform_settings.max_live_holds_per_guest` > 0 and the caller's live court
   holds (`reservations` with `guest_id` = caller, `kind 'hold'`, `pending`, `hold_expires_at > now()`)
   plus live `held` enrolments (`hold_expires_at > now()`) reach it (R30). Every guest booking and join
   takes `lock_principal('hold_slot', caller)`, the key `hold_slot` takes (0269:113), so the cap is
   counted under one lock with court holds. Coach and desk bookings are always `desk`.
9. **Price.** Guest RPCs take `p_expected_price_iqd`; a different current price → `PRICE_CHANGED`,
   detail `{"quoted_iqd", "current_iqd"}` (quote = charge, DF-3 of open matches).
10. **Reasons.** Coach and desk cancels and removals take `p_reason` as `<code>` or `<code>: <note>`
    (`app.match_reason_parts`, 0262); the code is one of §1.3's six, the note at most 200 characters,
    else `INVALID_ARGUMENT` detail `p_reason`. The code goes to `lesson_events.code`, the note only to
    the audit row.
11. **Writes.** `set_config('app.venue_id', v, true)` before the first write (per row's branch when one
    call writes at several); one `lesson_events` row per transition, carrying what Guest's trigger
    needs (§5.2); **no call to `lesson_notify` or `lesson_sync_reminders`** (R40); coach and staff
    writes audited `coaching.*` with ids and flags only.
12. **Shapes** (R41). Every read and write result carries at least the keys of the privacy review's
    §5 pick (X1–X29): the client lane's names where a client renders them (`guest.md` §4.3,
    `operator.md` §5.6–§5.7). DB may add keys, never rename or drop them.
    `packages/core/src/coaching/shapes.ts` (created in this commit) lists each result's keys;
    `coaching-shapes.test.ts` asserts `keys(result) ⊇ list` for every RPC here and in 0279, and the
    client parsers read the same lists.
13. Refusals are listed in the order checked. `[lock]` marks where a lock is taken; the rows after it
    are re-checked under it with the same codes.

#### 4.7.2 Internals (revoked from public, anon, authenticated)

- **`lesson_guest(p_act boolean) returns profiles`**: the twin of `match_guest` (0260:245-272):
  `AUTH_REQUIRED`; `ACCOUNT_REQUIRED` (no profile, or `deleted_at` set); with `p_act`, `PHONE_REQUIRED`
  (`nullif(btrim(phone), '') is null`) and `TERMS_REQUIRED` (no accepted terms: `terms_version is
  null`). No ban, no gender. Literal raises; returns the caller's profile. The online paths add the
  lessons-terms check of rule 8 once the mode is known (R50); a desk-paid lesson needs no lessons
  terms (C-26).
- **`lesson_lock_branch_courts(p_venue uuid) returns uuid[]`** (R34): the `match_lock_courts` loop
  (0260:112-122), returning the ids it locked.
- **`lesson_pick_court(p_venue uuid, p_period tstzrange, p_locked uuid[]) returns uuid`** (R34): a
  court **in `p_locked`**, still active, with no live row (any kind) over `p_period` and `not
  app.match_court_claimed(c.id, p_period)` (R22 of open matches), by `sort_order`, `id`; NULL when
  none. The caller holds those courts and has expired stale holds. Courts' `duration_options` are
  booking lengths and are not read. Money's late-success re-pick passes its own locked set.
- **`lesson_places_taken(p_lesson_id uuid) returns int`**, **`course_places_taken(p_course_id uuid)
  returns int`**: `sum(party_size)` of the lesson's (course's) enrolments that are `booked`, or `held`
  and live: `hold_expires_at > now()` or an open lesson payment (`booking_payments.lesson_enrolment_id
  = e.id and status in ('created', 'pending') and deadline_at > now() - interval '10 minutes'`, the
  `expire_stale_holds` rule, 0268:48-51). The cut-off counts `booked` places only (R38, §4.9.3).
- **`lesson_link_by_phone(p_phone text, p_exclude_profile uuid) returns uuid`** (§10; R10, C-21): `select
  u.id from auth.users u join profiles p on p.id = u.id and p.deleted_at is null where
  u.phone_confirmed_at is not null and app.phone_canon(u.phone) = app.phone_canon(p_phone) and u.id
  <> p_exclude_profile limit 2`, the verified-phone source `hold_standing_key` reads (0252:116-126;
  `auth.users.phone` with `phone_confirmed_at`, never the typed `profiles.phone`, the 0252 identity).
  Exactly one row → its id; otherwise NULL. A NULL phone → NULL.
- **`lesson_create_internal(p_coach_id uuid, p_lesson_type_id uuid, p_start_at timestamptz, p_course_id
  uuid, p_session_no smallint, p_price_iqd bigint, p_held boolean, p_booked_by_kind text, p_profile_id
  uuid, p_staff_id uuid, p_idempotency_key text, p_locked uuid[]) returns lessons`** (signature in
  §10): the caller holds `lock_coach`, the courts `p_locked` and has run `match_expire_holds` over the
  period, and has checked grid, hours and the coach. It computes the end and the snapshots (§4.3.8),
  picks the court (`lesson_pick_court(v, period, p_locked)`; `NO_COURT_FREE` when NULL), inserts the
  lesson (`held` with `hold_expires_at = now() + deposit_window_seconds` when `p_held`, else
  `scheduled`) and its court row (§3.4). An `exclusion_violation` on `lessons_coach_no_overlap` →
  `COACH_BUSY`; on `reservations_no_overlap` → `NO_COURT_FREE`. Writes no event.
- **`lesson_event(p_venue_id uuid, p_lesson_id uuid, p_course_id uuid, p_enrolment_id uuid, p_type
  text, p_actor text, p_actor_profile_id uuid default null, p_actor_staff_id uuid default null, p_code
  text default null, p_data jsonb default '{}') returns bigint`** (signature in §10): one insert.
- **`lesson_court_release(p_lesson_id uuid, p_status text) returns void`** (§10): the only body of
  this lane that writes a lesson's court row on its way out. First the R25 statement of §2.3 (the
  `pending` hold row → `expired`, `skip locked`, whatever `hold_expires_at` says); then the `kind
  'lesson'` row by a guarded `update reservations set status = p_status, cancelled_at =
  coalesce(cancelled_at, now()), cancellation_reason, cancelled_by … where lesson_id = p_lesson_id and
  kind = 'lesson' and status in ('pending', 'confirmed', 'arrived')` (`p_status` `cancelled` or
  `completed`, §3.4). No `FOR UPDATE`, no court lock (R6, R33). Money's `lesson_hold_expire` uses it
  for the hold row too.
- **`enrolment_cancel_internal(p_enrolment_id uuid, p_kind text, p_actor text, p_profile_id uuid,
  p_staff_id uuid) returns jsonb`**, **`lesson_cancel_internal(p_lesson_id uuid, p_reason text, p_actor
  text, p_profile_id uuid, p_staff_id uuid) returns jsonb`**, **`course_cancel_internal(p_course_id
  uuid, p_reason text, p_actor text, p_profile_id uuid, p_staff_id uuid) returns jsonb`** (§10). The
  caller holds `lock_coach`. Each re-reads its row, returns `{changed: false}` when it is no longer
  live, and never takes a court lock. After every status write, each calls Money's
  **`app.lesson_refund_start(p_enrolment_id, p_reason)`** (R5, R28) for every enrolment it touches
  that has an applied online `purpose 'lesson'` row, **live or not** (a `guest_late` enrolment is
  refunded when the coach later cancels its session), passing the reason below; the amount is always
  the engine's `refund_due_online_iqd`, never computed here. Expiry of a held enrolment is Money's
  `lesson_hold_expire`, not these internals.

| `cancel_kind` (enrolment) | A private lesson goes with it as | Reason passed to `lesson_refund_start` | Strike |
| --- | --- | --- | --- |
| `guest_free` | `guest_cancel` | `guest_cancel` | — |
| `guest_late` | `guest_cancel` | `guest_cancel` (the engine refunds nothing for a lesson, and for a course the covered sessions outside the window, C-23, R62) | `late_cancel`, by the caller (§4.7.7) |
| `coach` | `coach_cancel` (`coach_retired` when retiring) | `coach_cancel` | — |
| `staff` | `staff_cancel` | `staff_cancel` | — |
| `under_filled` | `under_filled` | `under_filled` | — |
| `account_deleted` | `account_deleted` | `account_deleted` (R28) | — |
| `course_cancelled` | — | the course's reason: `coach_cancel` (also for `coach_retired`), `staff_cancel`, `under_filled` | — |
| an enrolment already cancelled, whose lesson or course is now cancelled | — | the lesson's or course's reason, as the row above | — |

  - `enrolment_cancel_internal`: a live private lesson of the enrolment first goes with it
    (`lesson_court_release(l, 'cancelled')`, then the lesson row `cancelled` with the reason above);
    then the enrolment: status `cancelled`, `cancel_kind`, `cancelled_at`, `hold_expires_at` NULL; the
    refund call; events `cancelled` on the lesson (private) and `enrolment_cancelled` (code `p_kind`).
    Returns `{enrolment_id, status, cancel_kind, lesson_cancelled, refunds_started}`.
  - `lesson_cancel_internal`: `lesson_court_release(l, 'cancelled')`; the lesson `cancelled`
    (`p_reason`); every live enrolment of the lesson through `enrolment_cancel_internal` with the kind
    mapped from `p_reason` (`coach_cancel`, `coach_retired` → `coach`; `staff_cancel` → `staff`;
    `under_filled` → `under_filled`; `account_deleted` → `account_deleted`); the refund call for every
    enrolment of the lesson that was already cancelled; event `under_filled` when `p_reason =
    'under_filled'`, else `cancelled` (code `p_reason`). A course session has no enrolment of its own.
  - `course_cancel_internal`: every session `scheduled` with `start_at > now()` through
    `lesson_cancel_internal(…, p_reason, …)` (a session in progress runs to its end; C-19: never one
    session alone); the course `cancelled` (`p_reason`); every live course enrolment through
    `enrolment_cancel_internal(…, 'course_cancelled', …)`; the refund call for every course enrolment
    already cancelled; event `under_filled` or `cancelled` on the course. Returns `{course_id, status,
    sessions_cancelled, enrolments}`.

#### 4.7.3 Guest: book and join

**`lesson_book_private(p_coach_id, p_lesson_type_id, p_start_at, p_party_size, p_friend_names,
p_payment_mode, p_expected_price_iqd, p_idempotency_key)`**

1. `lesson_guest(true)`.
2. `INVALID_ARGUMENT`: a NULL argument (`p_friend_names` NULL means none), the key, `p_party_size < 1`,
   `p_payment_mode`, more than `p_party_size - 1` friend names or one empty or over 40 after
   `app.safe_line`, `p_expected_price_iqd < 0`.
3. `[lock_principal('hold_slot', caller)]` (R30); replay (rule 7).
4. The ladder, when `platform_settings.hold_strikes_since` is set: `hold_strikes_settle(
   hold_key_guests(hold_standing_key(caller)))`, then `BOOKING_SUSPENDED` or `HOLD_COOLDOWN` exactly as
   `hold_slot` (0269:119-136). Lesson and court strikes are one ladder (§4.9).
5. `LESSON_TYPE_NOT_FOUND` (unknown, or not `private`); `COACH_NOT_FOUND` (unknown, retired, or not
   accepted, R61); with `v` the type's branch: `COACH_NOT_AT_BRANCH` (no active `coach_branches` row,
   or `v` not open); `COACHING_OFF`; `COACH_INACTIVE` (paused, R16); `LESSON_TYPE_INACTIVE`;
   `LESSON_TYPE_NOT_OFFERED`; `ALREADY_ENROLLED` detail `coach` (the caller is this coach, R56).
6. `PARTY_TOO_LARGE` (`p_party_size > max_places`, detail the maximum).
7. `ONLINE_PAYMENT_OFF`, `ONLINE_PAYMENT_REQUIRED`; online: `TERMS_REQUIRED` `lessons`,
   `HOLD_QUOTA_EXCEEDED` (rule 8).
8. `SLOT_NOT_ON_GRID`; `BEYOND_HORIZON`; `CLOSED_DATE`, `OUTSIDE_HOURS`; `SLOT_IN_PAST`; `DEGRADED_LOCKOUT`.
9. `PRICE_CHANGED` against `lesson_price_for(coach, type)`.
10. `COACH_UNAVAILABLE` (`coach_in_hours`, unlocked).
11. `[lock_coach]`; replay; the coach and the type re-read (5); `COACH_BUSY` / `COACH_UNAVAILABLE`
    (`coach_available`).
12. `[v_locked := lesson_lock_branch_courts(v)]`, `match_expire_holds(v, period)`.
13. `lesson_create_internal(…, p_held = (p_payment_mode = 'online'), 'guest', caller, null, key,
    v_locked)` (`NO_COURT_FREE`, `COACH_BUSY`).
14. The enrolment: `guest_id` = `booked_by_profile_id` = caller, `link_confirmed_at = now()`, party
    and friend names, price = the lesson's, `payment_mode`, `held` (with the lesson's
    `hold_expires_at`) or `booked`, the key.
15. Event `held` or `booked` (lesson and enrolment; §5.2).

Returns (X5) `{duplicate, enrolment_id, lesson_id, status: 'booked'|'held'` (the **enrolment's**),
`hold_expires_at, payment_mode, price_iqd, start_at, end_at, court_name_en, court_name_ar,
venue_id}`. For `online` the app then calls `lesson-begin` (Money's `lesson_payment_prepare`, 0281).

**`lesson_join(p_lesson_id, p_payment_mode, p_expected_price_iqd, p_idempotency_key)`** (a group
session): 1 `lesson_guest(true)`; 2 `INVALID_ARGUMENT`; 3 `[lock_principal('hold_slot', caller)]`,
replay; 4 the ladder; 5 `LESSON_NOT_FOUND` (unknown, not `group`, branch not open, coach not accepted
or retired); `COACHING_OFF`; `COACH_INACTIVE` (paused, R16); 6 `LESSON_CLOSED` (status not
`scheduled`, or `now() >= start_at`); 7 `ALREADY_ENROLLED` (a live enrolment of the caller; detail
`coach` when the caller is the coach, R56); 8 the payment mode, terms and hold cap (rule 8); 9
`PRICE_CHANGED` against `lessons.price_iqd`; 10 `DEGRADED_LOCKOUT` (R15); 11 `LESSON_FULL`
(`lesson_places_taken + 1 > max_places`); 12 `[lock_coach]`, replay, re-check 5, 6, 7, 11; 13 the
enrolment (price = the lesson's, `link_confirmed_at = now()`, `held` or `booked`); event `joined`.
Returns `{duplicate, enrolment_id, lesson_id, status, hold_expires_at, payment_mode, price_iqd,
places_left}`.

**`course_join(p_course_id, p_payment_mode, p_expected_price_iqd, p_idempotency_key)`**: as
`lesson_join`, with `LESSON_NOT_FOUND` for an unknown course; `LESSON_CLOSED` when the course is not
`open|running`, `now() >= signup_closes_at`, or no session is left to start. **The price** (C-15):
the course price when no session has started; else Money's `course_late_join_price` (0278), `Σ
app.iqd_split(price_iqd, sessions_count)[k]` (R2, R60) over the session numbers `k` of the
`scheduled` sessions with `start_at > now()`. `first_session_no` = the lowest of them,
`sessions_covered` = their count. `DEGRADED_LOCKOUT` reads `first_session_no`'s start. `LESSON_FULL`
reads `course_places_taken`. Under the coach lock the price is computed again (a session may have
started in between: `PRICE_CHANGED`). Returns `{duplicate, enrolment_id, course_id, status,
hold_expires_at, payment_mode, price_iqd, places_left}`.

#### 4.7.4 Coach and desk: book and create

**`coach_book_private(p_lesson_type_id, p_venue_id, p_start_at, p_student_name, p_student_phone,
p_party_size, p_idempotency_key)`**: 1 `coach_self()`; 2 `INVALID_ARGUMENT` (name 1..80 after
cleaning; phone NULL or read by `app.phone_canon`; party; key); 3 `[lock_principal('coach_students',
coach)]`, then `COACH_ADD_LIMIT` detail `day` when the coach's `booked_by_kind = 'coach'` enrolments
created in the last 24 hours, whatever their status, number 30 (CD-9, `lesson_enrolments_coach_adds`);
replay; 4 the type at `p_venue_id` (`LESSON_TYPE_NOT_FOUND`, private only), `COACH_NOT_AT_BRANCH`,
`COACHING_OFF`, `COACH_INACTIVE`, `LESSON_TYPE_INACTIVE`, `LESSON_TYPE_NOT_OFFERED`,
`PARTY_TOO_LARGE`; 5 grid, hours, past, `DEGRADED_LOCKOUT` (no horizon); 6 `COACH_UNAVAILABLE`; 7
`[lock_coach]`, replay, **`COACH_ADD_LIMIT` detail `live`** when the coach's `held`/`scheduled`
private lessons with `booked_by_kind 'coach'` and `start_at > now()` at the branch number
`coach_max_open_private` (C-24, R56), `COACH_BUSY`; 8 `[v_locked := courts]`, hold expiry; 9
`lesson_create_internal(…, false, 'coach', <coach's profile>, …, v_locked)`; 10 the enrolment:
`guest_name` and `guest_phone` as typed, `guest_id` = `lesson_link_by_phone(p_student_phone, <the
coach's profile>)` with `link_confirmed_at` NULL (a pending link, C-21), `booked_by_kind 'coach'`,
`desk`, `booked`; 11 events `booked` (lesson) and `added` (enrolment); audit `coaching.lesson.book`
(`{lesson_id, enrolment_id, linked}`). Returns `{duplicate, lesson_id, enrolment_id, start_at,
end_at, court_name_en, court_name_ar, price_iqd}`, the same shape and the same work whether or not
the phone matched (R10).

**`desk_book_lesson(p_coach_id, p_lesson_type_id, p_start_at, p_customer_id, p_name, p_phone,
p_party_size, p_idempotency_key)`** (court_desk, manager, owner): `FORBIDDEN` (role first);
`INVALID_ARGUMENT` (exactly one of `p_customer_id` and `p_name`; name and phone rules; key);
`LESSON_TYPE_NOT_FOUND`; `VENUE_MISMATCH` (not at the type's branch); `CUSTOMER_NOT_FOUND` (unknown or
deleted profile); replay; `COACH_NOT_FOUND`, `COACH_NOT_AT_BRANCH`, `COACH_INACTIVE`,
`LESSON_TYPE_INACTIVE`, `LESSON_TYPE_NOT_OFFERED`, `PARTY_TOO_LARGE`, `ALREADY_ENROLLED` detail
`coach` (the customer is the coach, R56); grid, hours, past; `COACH_UNAVAILABLE`; `[lock_coach]`,
`COACH_BUSY`; `[courts]`; create (`'staff'`, caller). The enrolment: with `p_customer_id`, `guest_id`
= it, `link_confirmed_at = now()`, the profile's name and phone copied into the typed columns (R44);
with `p_name`, the typed name and phone, and a typed phone matched like the coach's, pending (C-21).
Events `booked`, `added`; audit. No `COACHING_OFF`, no degraded, no horizon. Returns (X29)
`{duplicate, lesson_id, enrolment_id, court_id, court_name_en, court_name_ar, start_at, end_at,
price_iqd}`.

**`coach_create_group(p_lesson_type_id, p_venue_id, p_start_at, p_idempotency_key)`** and
**`desk_create_group(p_coach_id, p_lesson_type_id, p_start_at, p_idempotency_key)`**: the same checks
for a `group` type (no student, no party, no cap), plus `LESSON_CLOSED` detail `cutoff` (R47); replay
on `lessons.idempotency_key` (`created_by_profile_id` or `created_by_staff_id` = caller);
`lesson_create_internal(…, price = lesson_price_for, …)`; event `booked`. Returns `{duplicate,
lesson_id, start_at, end_at, cutoff_at, court_id, court_name_en, court_name_ar, price_iqd,
max_places, min_places}`. The coach variant refuses `COACHING_OFF` and `DEGRADED_LOCKOUT`; the desk
variant `VENUE_MISMATCH`.

**`coach_create_course(p_lesson_type_id, p_venue_id, p_starts timestamptz[], p_title_en, p_title_ar,
p_idempotency_key)`** and **`desk_create_course(p_coach_id, …)`**, all or nothing:

1. The guard; `INVALID_ARGUMENT` (titles over 80; key); replay on `courses.idempotency_key`.
2. The type: `LESSON_TYPE_NOT_FOUND` unless a `course` type at the branch; `COACH_NOT_AT_BRANCH`,
   (coach) `COACHING_OFF`, `COACH_INACTIVE`, `LESSON_TYPE_INACTIVE`, `LESSON_TYPE_NOT_OFFERED`;
   (desk) `VENUE_MISMATCH`, `COACH_INACTIVE`.
3. `COURSE_STARTS_INVALID`, detail `count` (`cardinality(p_starts) <> sessions_count`, NULL entries
   included), `order` (not strictly increasing, or a session ends after the next starts), `span` (last
   start − first start over 366 days).
4. Per start `i` (1-based, in order): `SLOT_NOT_ON_GRID`, `SLOT_IN_PAST`, `CLOSED_DATE` /
   `OUTSIDE_HOURS`, `COACH_UNAVAILABLE`, each with detail `i`; `LESSON_CLOSED` detail `cutoff` when
   start 1 − `cutoff_hours` ≤ now() (R47); (coach) `DEGRADED_LOCKOUT` when any start is inside the
   protected horizon.
5. `[lock_coach]`; replay; per start `COACH_BUSY` detail `i`.
6. `[v_locked := courts]`; `match_expire_holds(v, tstzrange(first start, last end))` (one statement).
7. The course row (price = `lesson_price_for`, the snapshots, `cutoff_at` = start 1 − `cutoff_hours`,
   `signup_closes_at` = the last start, `created_by_kind`), then `lesson_create_internal` per session
   (`session_no = i`, price NULL, `v_locked`); a `NO_COURT_FREE` or `COACH_BUSY` from session `i` is
   re-raised as the same literal code with detail `i`, and the whole call rolls back.
8. Event `booked` on the course; audit `coaching.course.create`.

Returns (X13) `{duplicate, course_id, lesson_ids: [..], sessions: [{session_no, lesson_id, start_at,
end_at, court_name_en, court_name_ar}], price_iqd, cutoff_at, signup_closes_at}`.

#### 4.7.5 Adding students; the verified-phone match; confirming a link; the coach's consent

**`coach_add_student(p_lesson_id, p_course_id, p_name, p_phone, p_idempotency_key)`**:

1. `coach_self()`.
2. `INVALID_ARGUMENT`: not exactly one of `p_lesson_id`, `p_course_id`; `p_name` 1..80 after cleaning;
   `p_phone` NULL or read by `app.phone_canon`; the key.
3. `[lock_principal('coach_students', coach)]`; `COACH_ADD_LIMIT` detail `day` (CD-9, as
   `coach_book_private`); replay.
4. `LESSON_NOT_FOUND`: not the caller's, or a private lesson or a course session (students join a group
   session or a course).
5. `COACHING_OFF`; `COACH_INACTIVE`.
6. `LESSON_CLOSED`: a group session not `scheduled` or at or past its `end_at` (a coach may seat a
   walk-in during the session); a course not `open|running` or `now() >= signup_closes_at` (R39,
   R48: sign-up, and every add, closes when the last session starts).
7. `DEGRADED_LOCKOUT` for the group session's start, or the course's next session to start (R15).
8. `[lock_coach]`; replay; `LESSON_FULL`.
9. **The match.** `lesson_link_by_phone(p_phone, <the coach's profile_id>)`; a profile that already
   holds a live enrolment here is not linked (rather than refused).
10. The enrolment: `guest_name`, `guest_phone` as typed; `guest_id` the match or NULL,
    `link_confirmed_at` NULL; `booked_by_kind 'coach'`; `desk`; `booked`; price = the session's place
    price, or the course's remaining-sessions price (as `course_join`).
11. Event `added`; audit `coaching.student.add` `{lesson_id|course_id, enrolment_id, linked}`
    (managers read it; coaches cannot).

Returns `{duplicate, enrolment_id, places_left}`. **No oracle** (R10, R44): the answer, its timing
class (the push to a linked student is due at `now() + 5 s`, so neither path nudges the sender
synchronously, §5.2), the roster (typed name and phone only) and every refusal are the same whether or
not the phone matched; an already-enrolled match is simply not linked. The cap (30 a day, audited)
bounds probing. The matched person sees the lesson in My lessons only as "A coach added you to a
lesson. Is this you?" until they answer (C-21).

**`desk_add_student(p_lesson_id, p_course_id, p_customer_id, p_name, p_phone, p_idempotency_key)`**
(court_desk, manager, owner): `FORBIDDEN` (role first); `INVALID_ARGUMENT` (one target; one of
customer and name); `LESSON_NOT_FOUND`, `VENUE_MISMATCH`; `CUSTOMER_NOT_FOUND`; replay;
`LESSON_CLOSED` (as the coach: a group until its end, a course until `signup_closes_at`, R48);
`[lock_coach]`; `LESSON_FULL`; `ALREADY_ENROLLED` (the desk picked a customer who is already in:
staff may know; detail `coach` for the coach, R56); the enrolment (`staff`, `desk`, `booked`; a
picked customer linked at once with the profile's name and phone copied, a typed phone matched and
pending, as `desk_book_lesson`); event `added`; audit. No `COACHING_OFF`. Returns `{duplicate,
enrolment_id, price_iqd, places_left}`.

**`lesson_link_confirm(p_enrolment_id uuid, p_yes boolean) returns jsonb`** (guest; C-21, R44; §10):
1 `lesson_guest(false)`; 2 `INVALID_ARGUMENT` (NULLs); 3 `ENROLMENT_NOT_FOUND` unless `guest_id` =
caller and `booked_by_kind <> 'guest'`; already confirmed: `p_yes` → `{duplicate: true}`, not
`p_yes` → `INVALID_TRANSITION` detail `confirmed` (cancel it instead); 4 `[lock_coach]`, re-read; 5
yes → `link_confirmed_at = now()`; no → `guest_id = NULL` (a walk-in again). No `lesson_events` row
and no push either way (the coach is never told, C-21); audit `coaching.link.confirm` or
`coaching.link.decline` with ids only. Guest's enrolment reminder trigger resyncs on the change
(§5.2). Returns `{enrolment_id, linked}`.

**`coach_accept_public() returns jsonb`** (coach; C-22, R61; §10): `coach_self()`; already accepted →
`{duplicate: true, public_accepted_at}`; else `public_accepted_at = now()`, audit
`coaching.coach.accept_public`; returns `{public_accepted_at}`. Coach mode opens on the accept sheet
while `coach_me` answers `public_accepted_at: null`; desk- and coach-booked lessons work before it.

#### 4.7.6 Reschedule any lesson (R8, R32); move a lesson's court (C-10, R7)

**`coach_reschedule_session(p_lesson_id, p_start_at)`** and **`desk_reschedule_session(p_lesson_id,
p_start_at)`**, for **every kind** (private, group, course session):

1. The guard; `INVALID_ARGUMENT` (NULL); `LESSON_NOT_FOUND` (coach: not theirs) / `VENUE_MISMATCH`.
2. `INVALID_TRANSITION` detail `held` (a held private lesson is mid-payment, R32);
   `SESSION_NOT_MOVABLE` detail `ended` (not `scheduled`) or `started` (`now() >= start_at`). The same
   start → `{duplicate: true}`.
3. `SLOT_NOT_ON_GRID`, `SLOT_IN_PAST`, `CLOSED_DATE` / `OUTSIDE_HOURS`; (coach) `DEGRADED_LOCKOUT`.
4. A course session: `SESSION_NOT_MOVABLE` detail `order`: the new period starts at or after the
   previous live session's end and ends at or before the next live session's start, so session numbers
   keep their order (the C-15 price reads them).
5. `LESSON_CLOSED` detail `cutoff` (R47) when the session's cut-off is still unjudged
   (`cutoff_checked_at` NULL; a course: session 1) and the new start − `cutoff_hours` ≤ now(). A
   judged session keeps its stamp and may move anywhere (R32).
6. `COACH_UNAVAILABLE` (`coach_in_hours`).
7. `[lock_coach]`; re-read 2; `COACH_BUSY` (another live lesson of the coach overlaps; this one
   excluded).
8. `[v_locked := lesson_lock_branch_courts(v)]`; the lesson's live court row `FOR UPDATE`;
   `match_expire_holds(v, new period)` (R33: courts, row, expiry, writes).
9. The court: its own court when no other live row overlaps the new period there and it is not
   `match_court_claimed`, else `lesson_pick_court(v, period, v_locked)` (`NO_COURT_FREE`).
10. Update the court row (`court_id`, `start_at`, `end_at`), then the lesson (`start_at`, `end_at`,
    `rescheduled_at = now()`); the exclusions map to `NO_COURT_FREE` and `COACH_BUSY`.
11. The cut-off (R32): a group session's `cutoff_at` = new start − `cutoff_hours`; session 1 of a
    course: `cutoff_at` moves by the same amount on the course and its sessions; in both,
    `cutoff_checked_at` is cleared when the new cut-off is still ahead and kept otherwise. The last
    course session: `signup_closes_at` = the new start.
12. Event `rescheduled`; audit `coaching.reschedule`.

Returns `{lesson_id, start_at, end_at, court_id, court_name_en, court_name_ar}`. Every guest booked
before `rescheduled_at` may now cancel free until the new start (R8, §4.7.7).

**`desk_move_lesson_court(p_lesson_id, p_court_id)`** (court_desk, manager, owner), the **only**
way to move a lesson's court (R7): `FORBIDDEN`; `INVALID_ARGUMENT`; `LESSON_NOT_FOUND` /
`VENUE_MISMATCH`; `INVALID_TRANSITION` detail `held` (a held private lesson) or `ended` (not
`scheduled`, or `now() >= end_at`; a running lesson may move); `COURT_NOT_FOUND` (not an active court
of the lesson's branch); the same court → `{duplicate: true}`; `[lock_coach]`; `[v_locked :=
courts]`, the lesson's court row `FOR UPDATE`, `match_expire_holds(v, period)`; `COURT_NOT_FOUND` when
the target is not in `v_locked` (R34); `NO_COURT_FREE` (a live row overlaps on the target, the
exclusion as backstop); update `court_id`; event `court_moved`; audit `coaching.court_move`. Returns
`{lesson_id, court_id, court_name_en, court_name_ar}`. Like every move, not R22-guarded.

#### 4.7.7 Cancels, removals and retirement

**`lesson_cancel_mine(p_enrolment_id)`**: 1 `lesson_guest(false)`; 2 `INVALID_ARGUMENT`; 3
`ENROLMENT_NOT_FOUND` (not the caller's: `guest_id`); 4 `[lock_coach]`; an enrolment already
cancelled → `{duplicate: true, …}` (the same fields); 5 `LESSON_NOT_CANCELLABLE` detail `status` (not
`held|booked`), `started` (the lesson started; a course enrolment once its last covered session
started) or `link_pending` (a pending link: answer "Is this you?" first, C-21); 6 the kind: `held` →
`guest_free`; else `ref` = the lesson, or for a course **the guest's own next covered session not yet
started** (C-23); `guest_free` when `now() < ref.start_at − cancellation_window_hours`
(`coaching_rules`, default 12 as 0210:572) or when `ref.rescheduled_at > e.created_at` (R8: free until
the new start), else `guest_late`; 7 `enrolment_cancel_internal(e, kind, 'guest', caller, null)`,
whose refund call returns, for a `guest_late` course leave, the shares of the covered sessions that
start outside the window (Money's engine, R62); 8 `guest_late` → `lesson_strike_record(e, ref,
'late_cancel')`, which records only for a guest-booked enrolment (CD-2). No principal lock: the
strike is applied later (§4.9). Returns (X6) `{duplicate, enrolment_id, status, cancel_kind,
refunds_started, strike, refund_iqd, kept_iqd}`, the amounts read from `lesson_enrolment_money`
after the write (`refund_iqd` = the online money going back, `kept_iqd` = what the venue keeps).

| RPC | Guard | Refusals after the guard | Then; returns |
| --- | --- | --- | --- |
| `coach_remove_student(p_enrolment_id, p_reason)` | `coach_self()` | `INVALID_ARGUMENT` (reason); `ENROLMENT_NOT_FOUND` (not in the caller's lesson or course); `LESSON_NOT_CANCELLABLE` `private` (cancel the lesson), `status`, `started` (group: started; course: last session started) | `[lock_coach]`, re-check, `enrolment_cancel_internal(e, 'coach', …)`; audit `coaching.student.remove`; `{ok: true}` or `{duplicate: true}` |
| `coach_cancel_lesson(p_lesson_id, p_reason)` | `coach_self()` | `INVALID_ARGUMENT`; `LESSON_NOT_FOUND`; `LESSON_NOT_CANCELLABLE` `course_session` (C-19: move it or cancel the course), `status` (not `held` or `scheduled`), `started` | `[lock_coach]`, `lesson_cancel_internal(l, 'coach_cancel', 'coach', …)`; audit `coaching.lesson.cancel`; `{ok: true}` |
| `coach_cancel_course(p_course_id, p_reason)` | `coach_self()` | `INVALID_ARGUMENT`; `LESSON_NOT_FOUND`; `LESSON_NOT_CANCELLABLE` `status` (not `open` or `running`), `ended` (no session left to start) | `[lock_coach]`, `course_cancel_internal(c, 'coach_cancel', …)`; audit `coaching.course.cancel`; `{ok: true}` |
| `desk_cancel_enrolment(p_enrolment_id, p_reason)` | court_desk, manager, owner | `INVALID_ARGUMENT`; `ENROLMENT_NOT_FOUND`, `VENUE_MISMATCH`; `LESSON_NOT_CANCELLABLE` `status`, `ended` (the lesson, or the course's last session, has ended) | `[lock_coach]`, `enrolment_cancel_internal(e, 'staff', …)` (a private lesson goes with it: `staff_cancel`); audit; (X29) `{enrolment_id, status, refund_due_iqd, online_refund}` |
| `desk_cancel_lesson(p_lesson_id, p_reason)` | court_desk, manager, owner | as `coach_cancel_lesson`, plus `VENUE_MISMATCH` | `lesson_cancel_internal(l, 'staff_cancel', 'staff', …)`; `{lesson_id, status}` |
| `desk_cancel_course(p_course_id, p_reason)` | court_desk, manager, owner | as `coach_cancel_course`, plus `VENUE_MISMATCH` | `course_cancel_internal(c, 'staff_cancel', 'staff', …)`; (X29) `{course_id, status, sessions_cancelled}` |

A coach or staff cancel never strikes (CD-2). `refund_due_iqd` is the desk money now due back
(`refund_due_desk_iqd`); `online_refund` the amount Money's call started.

**`set_coach_status(p_coach_id, p_status, p_reason)`** (manager, owner; 0280, R16): `FORBIDDEN` (role
first); `INVALID_ARGUMENT` (`p_status` not `active|paused|retired`; `p_reason` over 200);
`COACH_NOT_FOUND`; `FORBIDDEN` (scope); `[lock_coach]`; the same status → `{duplicate: true}`; a retired
coach comes back only through `coach_promote` (`INVALID_TRANSITION` detail `retired`). `active` ↔
`paused`: the status only. **Retiring is never refused** (C-25, R45): every `held` or `scheduled`
lesson of the coach, at any branch, not yet started and not a course session →
`lesson_cancel_internal(l, 'coach_retired', 'staff', null, caller)`; every `open` or `running`
course with a session left to start → `course_cancel_internal(c, 'coach_retired', …)` (each under
`set_config('app.venue_id', <its branch>)`, which `zz_branch_guard` rule 2 accepts, 0230:149-167, so a
manager's retire reaches the coach's other branches); then `status 'retired'`, `retired_at`, the photo
folder queued in `coach_photo_purges` and `photo_path` NULL (R43). Sessions in progress run to their
end. Audit `coaching.coach.status` with the counts. Returns (X29) `{coach_id, status,
lessons_cancelled, courses_cancelled, duplicate}`. The same internals push and refund as any coach
cancel (`coach_retired` → `lesson.cancelled_by_coach`).

#### 4.7.8 Attendance (CD-11, CD-2)

**`coach_mark_attendance(p_lesson_id, p_enrolment_id, p_status)`** (`coach_self()`, own lessons) and
**`desk_mark_attendance(…)`** (court_desk, manager, owner): `INVALID_ARGUMENT` (`p_status` not
`attended|no_show|clear`); `LESSON_NOT_FOUND` / `VENUE_MISMATCH`; `ENROLMENT_NOT_FOUND` (not of this
lesson, nor of its course covering this session); `INVALID_TRANSITION` detail `not_started` (`now() <
start_at`), `marks_closed` (`now() >= start_at + 24 h`), `not_booked`, `cancelled` (the lesson);
`[lock_coach]`, re-check; then the `lesson_attendance` row upserted (`clear` deletes it);
`no_show` → `lesson_strike_record(e, l, 'no_show')`; `attended` or `clear` after a `no_show` → the
unsettled strike row deleted **without waiting** (R31): `delete from lesson_strikes where ctid in
(select ctid from lesson_strikes where enrolment_id = … and lesson_id = … and settled_at is null for
update skip locked)`; a row being settled counts as settled and stays, as a settled one does
(`hold_standing_decide` lifts the ladder). The same mark again → `{duplicate: true}`. Event
`attended`, `no_show` or `unmarked`. Returns `{lesson_id, enrolment_id, attendance}`.

#### 4.7.9 Reads (keys per R41; DB owns content, filters and privacy)

**Public** (no guard; never a student, a phone, a profile id or a court id, checked by a value scan,
R43, R58):

- **`coaching_public(p_venue_id uuid default null)`** (X1, the `guest.md` §4.3 flat shape: `{off,
  branches[], coaches[{id, …, venue_ids, offers[]}], lesson_types[{id, venue_id, …}], sessions[{…,
  sessions_left, max_places, signup_closes_at, cutoff_at}], server_now}`): a named branch that is off,
  closed or unknown → `{off: true}`; NULL → every open branch with coaching on, `{off: true}` when none.
  Coaches: `active` and accepted (R16, R61) with an active branch row, by `sort_order`; types: active
  and taught by a listed coach; sessions of listed coaches: group sessions `scheduled` with places
  left before their start (within 30 days), courses `open|running` with sign-up open and a place left
  (within 60 days), soonest first, at most 50. Branch fields `timezone`, `payment_mode`,
  `prices_public`, `cancellation_window_hours`. Prices are always sent (C-11: the website drops them
  when `prices_public` is false).
- **`coach_profile(p_coach_id, p_venue_id default null)`** (R17, X2, the `guest.md` §4.3 shape):
  `COACH_NOT_FOUND` (unknown, retired, or not accepted); a named branch: `{off: true}` when it is off or
  closed, `COACH_NOT_AT_BRANCH` when the coach is not active there, else the card, `venue`, `offers`
  (taught, active, priced by `lesson_price_for`) and `sessions`; NULL: the card with `venue_ids` (the
  open branches with coaching on where the coach is active), `venue: null`, empty `offers` and
  `sessions`, or `{off: true}` when there are none (P11). A paused coach: `status: 'paused'`, empty
  `offers` and `sessions` (R16).
- **`coach_slots(p_coach_id, p_lesson_type_id, p_from, p_to)`** (X3, R51): `INVALID_ARGUMENT` (NULLs,
  `p_to <= p_from`, `p_to - p_from > 14 days`); `LESSON_TYPE_NOT_FOUND` (not a private type);
  `COACH_NOT_FOUND` (unknown or retired; not accepted unless the caller is staff at the type's branch);
  `{off: true}` while coaching is off, **except for a staff caller `is_staff_at` the type's branch**
  (R51); else `{off: false, venue_id, lesson_type_id, duration_min, bookable, starts: [{start_at,
  end_at}]}`. A paused coach: `bookable: false, starts: []` (R51). Every start `s` on the branch's
  grid with `greatest(p_from, now()) < s`, `s + duration <= p_to`, within the horizon, outside the
  protected horizon while `is_degraded(v)`, `lesson_bookable` NULL, `coach_available`, and one active
  court with no live row over the period (a hold counts while `hold_expires_at > now()`, as
  `court_availability`) that is not `match_court_claimed`. At most 14 × 48 candidates, set-based over
  `generate_series`.
- **`lesson_offer(p_lesson_id default null, p_course_id default null)`** (X4, the `guest.md` §4.3
  shape): `INVALID_ARGUMENT` unless exactly one; `LESSON_NOT_FOUND` (a private lesson, a course
  session's id, a closed branch, a coach retired or not accepted); `{off: true}`; else the offer with
  the server's `status` (`open|full|closed|cancelled`: `closed` after a group's start or a course's
  `signup_closes_at`), `places_taken` (a count), `price_iqd` (the caller's price now: the place, the
  whole course, or the remaining sessions), `full_price_iqd`, `late_join`, the branch's `phone`,
  `timezone`, `payment_mode`, `cancellation_window_hours`, and `mine` (authenticated only: the
  caller's own live enrolment, else NULL).

**Guest** (`lesson_guest(false)`):

- **`my_lessons(p_scope default 'upcoming')`** (X7, the `guest.md` §4.3 flat rows):
  `INVALID_ARGUMENT` unless `upcoming|past|cancelled`; the caller's enrolments (upcoming: `held` or
  `booked` not ended, plus anything ended in the last 24 h; past: `booked` and ended; cancelled:
  `cancelled|expired`), at most 100, money from `lesson_enrolment_money`. A pending link (C-21) is
  listed with `link_pending: true`.
- **`my_lesson(p_enrolment_id)`** (X8): `ENROLMENT_NOT_FOUND` unless the caller's; the row above plus
  the `guest.md` §4.3 detail: `friend_names`, `booked_by`, `court_name_*`, `sessions[]` (with
  `rescheduled` = `rescheduled_at is not null`, `attendance`), `cancel: {policy: free|late|none,
  free_until, refund_iqd, kept_iqd, counts_late}` computed by the rule `lesson_cancel_mine` applies,
  `can: {cancel, pay, confirm_link}`, `branch_phone`, `timezone`, `server_now`. A pending link answers
  the card only (no friend names), `can: {cancel: false, pay: false, confirm_link: true}`. Never
  another student.

**Coach** (`coach_self()`; a retired coach is `NOT_A_COACH`, R45):

- **`coach_schedule(p_from, p_to)`** (X10): `INVALID_ARGUMENT` (over 31 days); the caller's lessons at
  every branch in the `guest.md` §4.3 shape (`type_name_*`, `title_*`, `sessions_count`, `unmarked`,
  `court_name_*`, places, `cutoff_at`) and `time_off[]`. No names.
- **`coach_lesson(p_lesson_id)`** (X11; C-16, CD-3, R44, R54): `LESSON_NOT_FOUND` unless the caller's;
  the lesson, its course, and the roster `[{enrolment_id, name, phone, party_size, friend_names,
  booked_by, payment_mode, status, attendance}]` (live enrolments of the lesson; for a course session,
  the course's covering it). `name` and `phone` are the typed values for a coach- or staff-booked
  enrolment, whatever its link (never the profile's, never a fallback: after the CD-8 purge the
  marker), and the profile's for a guest-booked one; `phone` is NULL after the session's `end_at + 7
  days` (R54) and while the enrolment is `held` (P13). `can: {add, remove, cancel, cancel_course,
  reschedule, mark}`, `mark_until` (start + 24 h). Never money, never a profile id, never whether a
  phone matched.

**Desk** (cashier, court_desk, manager, owner; role first, R57):

- **`desk_lessons(p_venue_id, p_from, p_to)`** (X16, R20, the `operator.md` §5.6.1 envelope):
  `FORBIDDEN`; `INVALID_ARGUMENT` (over 7 days); `FORBIDDEN` unless `is_staff_at(v)`; `{coaching_enabled,
  lesson_payment_mode, server_now, coaches[], lesson_types[], lessons[]}` with, per lesson,
  `booked_by_kind` (the C-24 tile flag "booked by the coach · unpaid" reads it with `owing`) and a
  private lesson's `label` = the typed name for a coach- or staff-booked enrolment, the profile's for
  a guest-booked one (R44). The desk reads the catalogue here, never `coaching_settings` or
  `coaches_admin` (R20).
- **`desk_lesson_detail(p_lesson_id)`** (X17, the `operator.md` §5.6.2 shape): `LESSON_NOT_FOUND` /
  `VENUE_MISMATCH`; the lesson, its course, the enrolments with `full_name` and `phone` = the typed
  values for a coach- or staff-booked enrolment (R44), the profile's for a guest-booked one;
  `customer_id` only for a confirmed link; `typed`; money from `lesson_enrolment_money` plus
  `take_iqd` = `lesson_fee_remaining`; the last 50 events; the `can` flags.
- **`customer_lessons(p_customer_id)`** (X18, the `operator.md` §5.6.3 keys plus
  `lesson_strikes_30d`, counted strikes in 30 days; the ladder itself is `guest_hold_standing`,
  0252:394): `FORBIDDEN`; `CUSTOMER_NOT_FOUND`; the customer's guest-booked and **confirmed-link**
  enrolments at visible branches (a pending link never reaches a customer record, C-21), upcoming then
  the last 20.

#### 4.7.10 Guest's part of this file (R18, R40)

Guest writes `lesson_notify(uuid, text, text, jsonb) returns int`, `lesson_sync_reminders(uuid)
returns void`, the reminder triggers `trg_lesson_reminders` and `trg_enrolment_reminders`, and the
AFTER INSERT trigger **`lesson_events_notify`** on `lesson_events`, after DB's part. That trigger is
the only queuer of every `lesson.*` and `coach.*` key except `coach.statement_ready` and
`coach.statement_paid` (Money's approve and mark-paid). DB never calls `lesson_notify` or
`lesson_sync_reminders`; what DB owes the trigger is the event contract of §5.2.

**Gates (0280).**

- **Matrix.** `SELF_ANON_OK`: `coaching_public` (`{}`), `coach_profile`, `coach_slots` (nil ids,
  `FUTURE` + 1 day), `lesson_offer` (`{p_lesson_id: NIL_UUID}`). `GUEST_OR_COACH`:
  `lesson_book_private`, `lesson_join`, `course_join`, `lesson_cancel_mine`, `my_lessons`,
  `my_lesson`, `lesson_link_confirm`, `coach_schedule`, `coach_lesson`, `coach_book_private`,
  `coach_create_group`, `coach_create_course`, `coach_add_student`, `coach_remove_student`,
  `coach_mark_attendance`, `coach_cancel_lesson`, `coach_cancel_course`, `coach_reschedule_session`,
  `coach_accept_public` (nil ids; every args set fails past the guard; nothing is written).
  `CASHIER_DESK_UP`: `desk_lessons`, `desk_lesson_detail`, `customer_lessons`. `DESK_UP`:
  `desk_book_lesson`, `desk_create_group`, `desk_create_course`, `desk_add_student`,
  `desk_cancel_enrolment`, `desk_cancel_lesson`, `desk_cancel_course`, `desk_reschedule_session`,
  `desk_move_lesson_court`, `desk_mark_attendance`. `MANAGER_UP`: `set_coach_status`.
- **Allowlist** (R12). publicByDesign: `coaching_public` ("coaching (0280): the branch's accepted
  coaches, lesson types with prices and upcoming sessions with places left; no student, phone,
  profile or court id (C-11)"), `coach_profile` ("… one accepted coach's public card, types and
  sessions"), `coach_slots` ("… free 30-minute starts of one coach and type, no court ids, names or
  money"), `lesson_offer` ("… one group session or course: times, places left and the caller's own
  price"); the other 33 `guarded` (each refuses an anonymous session with `ACCOUNT_REQUIRED` or
  `FORBIDDEN`).
- **Coverage.** The 37 RPCs `map:action`; `lesson_guest`, `lesson_lock_branch_courts`,
  `lesson_pick_court`, `lesson_places_taken`, `course_places_taken`, `lesson_link_by_phone`,
  `lesson_create_internal`, `lesson_event`, `lesson_court_release`, `enrolment_cancel_internal`,
  `lesson_cancel_internal`, `course_cancel_internal` `excluded: service_role only — …`; Guest's five.
- **Codes.** `COACHING_OFF`, `COACH_INACTIVE`, `LESSON_TYPE_INACTIVE`, `COACH_UNAVAILABLE`,
  `COACH_BUSY`, `NO_COURT_FREE`, `SLOT_NOT_ON_GRID`, `PARTY_TOO_LARGE`, `LESSON_FULL`,
  `LESSON_CLOSED`, `ALREADY_ENROLLED`, `LESSON_NOT_FOUND`, `ENROLMENT_NOT_FOUND`,
  `LESSON_NOT_CANCELLABLE`, `ONLINE_PAYMENT_REQUIRED`, `COURSE_STARTS_INVALID`, `SESSION_NOT_MOVABLE`,
  `COACH_ADD_LIMIT`. One sentence per detail a screen meets, in both catalogs (R52, X31):
  `LESSON_NOT_CANCELLABLE` `status`, `started`, `private` ("Cancel the lesson instead"),
  `course_session` ("Move it or cancel the course"), `ended`, `link_pending`; `SESSION_NOT_MOVABLE`
  `ended`, `started`, `order`; `COURSE_STARTS_INVALID` `count`, `order`, `span`; `INVALID_TRANSITION`
  `held`, `ended`, `not_started`, `marks_closed`, `not_booked`, `cancelled`, `retired`, `confirmed`;
  `LESSON_CLOSED` `cutoff`; `ALREADY_ENROLLED` `coach` ("You're the coach of this session.");
  `COACH_ADD_LIMIT` `day`, `live`; `TERMS_REQUIRED` `lessons`; `HOLD_QUOTA_EXCEEDED` (reused). Arabic
  uses the shared glossary (R55: «حصة» the lesson), marked DRAFT-AR.
- **SEC-28 / SEC-29** (R42). `scripts/check-broadcast-payloads.mjs` `FORBIDDEN` gains
  `/friend_names/i, /student/i, /share_bp/i`. `scripts/check-analytics-payload.mjs` gains
  `/coach_?id/i, /coach_?name/i, /coach_?(share|iqd)/i, /friend_names/i, /student/i, /share_bp/i`
  (underscore-optional, so camelCase `coachId` is caught; no `/display_name/i`) and
  `PERSON_MONEY_REPORTS = ['report_coach_statements', 'report_lessons']` (Money's 0284/0285 names,
  listed ahead): scanned for guest identity, exempt from the coach patterns.
  `tests/assistant-catalog.test.ts` asserts no assistant tool names either report (C-28).
- **Lock gate.** The §2.5 printed sequences (stack half of `lock-order-coaching.test.ts`).
- **Other.** `types.gen.ts`; `check:safeupdate` (every UPDATE and DELETE has a WHERE);
  `packages/core/src/coaching/shapes.ts` and `coaching-shapes.test.ts` (R41).

### 4.8 0282 `price_promo_lessons` (C-17)

Three change kinds join the eight: **`lesson_price`**, **`lesson_launch`**, **`coach_price`**,
managers and the owner only (marketing gets `NOT_STEP_ACTOR` hint `change`, as `shop_launch` does at
0195:341-343). Six hooks are re-issued from their latest bodies (each checked: no later create),
verbatim plus the lesson branches:

| Function | Latest | Change |
| --- | --- | --- |
| `protocol_check_price_promo_propose` | 0195:308 | the change list gains the three kinds; the marketing refusal covers them; the shapes below; the resubmission rule (0195:481-492) also holds `lesson_type_id` and `coach_id` |
| `protocol_check_price_promo_numbers` | 0177:2526 | allowed figures: `lesson_price` and `lesson_launch` → `price_iqd`, `court_share_iqd` (only those the proposal carries), `coach_price` → `price_iqd` (only when the proposal's is not NULL); same bounds through `app.price_promo_int`; a figure the proposal does not carry → `RECORD_INVALID` hint = the field |
| `price_promo_check_targets` | 0195:506 | three branches (below) |
| `price_promo_apply_internal` | 0195:647 | three branches (below) |
| `price_promo_targets` | 0177:2747 | `p_change` list gains the three; MGMT only (the 0177:2767 `shop_launch` rule); the shapes below |
| `price_promo_numbers` | 0195:850 | a `lesson` block in the answer (below); `NULL` for every other kind |

**Proposal shapes** (with `reason`, `expected_effect`; `app.price_promo_only_keys`,
`app.price_promo_uuid`, `app.price_promo_int`; failures are `RECORD_INVALID` with the field as hint,
never a writer's code):

- `lesson_price` `{lesson_type_id, price_iqd?, court_share_iqd?}`: a type at the run's venue with
  `launched_at` set (hint `lesson_type_id`); at least one figure, each different from the stored one;
  `price_iqd` 1..100,000,000 and at least `sessions_count` for a course; `court_share_iqd`
  0..100,000,000. The check adds `before: {price_iqd, court_share_iqd, shape}`.
- `lesson_launch` `{lesson_type_id, price_iqd, court_share_iqd}`: a never-launched, switched-off type at
  the venue (hint `lesson_type_id`); both figures required. Adds `before` (the draft's figures and
  `shape`).
- `coach_price` `{coach_id, lesson_type_id, price_iqd}`: a coach not retired who teaches the type
  (`coach_lesson_types`) at the venue (hint `coach_id`); `price_iqd` > 0 (≥ `sessions_count` for a
  course) or NULL to remove; different from the stored coach price (removing none is
  `RECORD_INVALID`). Any type, launched or draft: a manager never sets a coach price directly (D-8).
  Adds `before: {price_iqd, shape}` (`price_iqd` NULL when none).

`shape` (R46) is the type's `{kind, duration_min, sessions_count, max_places}`: what the approved
price buys. A draft stays directly editable (C-17), so without it a manager could approve 30,000 for a
60-minute lesson and then make the draft 120 minutes before the apply.

**Target check** (`PRICE_TARGET_CHANGED`): `lesson_price`: the type still launched, its price and
share equal `before`, its shape equal `before.shape` (hint `lesson_type`); `lesson_launch`: still
never launched, still off, figures and shape equal `before` (hint `lesson_type`); `coach_price`: the
coach not retired, still teaching the type, the coach price equal to `before` (hint `coach_price`),
the type's shape equal `before.shape` (hint `lesson_type`). The apply's internal validates as the
wrapper does (§4.6.4), so a stale shape can never reach a raw 23514 inside `price_promo_apply_due`.

**Apply** (after the target check; the figures are the `numbers` step's, else the proposal's):
`lesson_price`: the type row `for update`, then `upsert_lesson_type_internal(venue, id,
jsonb_strip_nulls({price_iqd, court_share_iqd}))`, counts `{lesson_types: 1}`; `lesson_launch`: the
same with `is_active: true` (the internal stamps `launched_at`), counts `{lesson_types: 1, launched:
1}`; `coach_price`: `set_coach_price_internal(coach, type, price, run_id)`, counts `{coach_prices: 1}`.
Audit `protocol.price.apply`. A save by `upsert_lesson_type` reads the same row `for update`, so a
manager's save racing an apply waits and then sees the type launched (the 0177 size-lock rule,
protocols contracts §2.13).

**Targets** (`price_promo_targets`; X28: DB's shape, which the operator and the staff phone parse):
`lesson_price` → `{lesson_types: [{lesson_type_id, kind, name_*, duration_min, sessions_count,
max_places, price_iqd, court_share_iqd, is_active}]}` (launched, at the venue); `lesson_launch` → the
same shape, never-launched types with their draft figures; `coach_price` → `{coaches: [{coach_id,
display_name_*, lesson_types: [{lesson_type_id, name_*, kind, sessions_count, type_price_iqd,
coach_price_iqd}]}]}` (coaches not retired, at the venue, the types they teach there).

**Numbers** (`price_promo_numbers`; X28: DB's plus `name_*`): `lesson: {lesson_type_id, coach_id,
name_en, name_ar, kind, current_price_iqd, new_price_iqd, current_court_share_iqd,
new_court_share_iqd, places_30d, owed_30d_iqd}`, the last two from `booked` enrolments of that type
(and coach) whose lesson started in the last 30 days and their `price_iqd` snapshots. Lesson tables
only: no dependency on Money's figures, and no per-coach pay (C-28).

Not re-issued: `protocol_submit_price_promo_propose` (0177:2479: its branches skip the three kinds;
targets stay in the record, as for `rate`), `protocol_check_price_promo_apply` (0177:2668, calls the
target check), `protocol_pass_price_promo_apply` (0177:2705), `price_promo_apply_due` (0177:2209,
null actor; the internals check no role).

**The TypeScript twin and the forms (Operator lane, same push):** `packages/core/src/protocols/types.ts`
`PRICE_CHANGE_KINDS` (:33-42), `PriceProposeRecord` (:254-275), `PriceNumbersRecord` (:277); `steps.ts`
`PROPOSE_BY_CHANGE` (:528) and `NUMBERS_BY_CHANGE` (:542), both `Record<PriceChangeKind, …>` so the
compiler demands the three entries, and `priceChangeKinds` (:82) whose marketing filter must drop the
three; `validate.ts` (:333-337, the per-change set rules: `lesson_price` needs a figure);
`protocols.test.ts:146-149` ("all eight" becomes eleven). Operator `features/protocols/priceTargets.ts`
(the target pickers, :220, :254), `features/tasks/priceLogic.ts`, `features/tasks/fieldLabels.ts`; the
staff phone `features/staff/protocols/{labels.ts, logic.ts, StepForms.tsx, useStepReads.ts}`.

**Gates (0282).** Matrix, allowlist, coverage: unchanged (same signatures). Codes: none new; operator
sentences for the new hints (`RECORD_INVALID` `lesson_type_id`, `coach_id`, `price_iqd`,
`court_share_iqd`; `PRICE_TARGET_CHANGED` `lesson_type`, `coach_price`). Tests
`price-promo-lessons.test.ts` (with a draft whose shape changes between approval and apply);
`price-promo.test.ts` keeps passing unmodified. The owner's end-to-end `lesson_price` and
`lesson_launch` runs, with a decide step on the staff phone, are in `operator-coaching.spec.ts` (R58).

### 4.9 0283 `lesson_sweep`

#### 4.9.1 `lesson_strike_record(p_enrolment_id uuid, p_lesson_id uuid, p_kind text) returns void`

Internal. `INVALID_ARGUMENT` unless `p_kind` is `late_cancel|no_show|lapsed_hold` (R30). Returns
without a row unless the enrolment's `booked_by_kind = 'guest'`, `guest_id` is set and the profile is
not deleted (CD-2: a coach- or desk-booked student, a walk-in and a coach or staff cancel never
strike). Then, never waiting on a strike row (R31): a plain `exists` read of `(p_enrolment_id,
p_lesson_id)` first, which sees a committed row even while a settle holds it, and returns when there
is one (a row being settled counts as there); only when none is visible, `insert into lesson_strikes
(enrolment_id, lesson_id, venue_id, guest_id, kind, struck_at) values (…, now()) on conflict
(enrolment_id, lesson_id) do nothing`. (A `for update skip locked` existence check would hide a row
being settled and send the insert to wait on it in the unique check, the F8 cycle.) Called under the
coach lock, and by Money's `lesson_hold_expire` for a `lapsed_hold`; it never touches
`hold_standing` (§1.4).

#### 4.9.2 `hold_strikes_settle(p_guests uuid[] default null)` re-issued from 0252:221

Same signature, so the 0268:66 grant to the service role stays. One loop, oldest first by `(at,
source, id)`, over:

- the 0252 rows, the predicate verbatim (0252:235-248; `at` = `hold_expires_at`): handled as today;
- `lesson_strikes` with `settled_at is null`, `struck_at >= hold_strikes_since` and `(p_guests is
  null or guest_id = any(p_guests))` (`at` = `struck_at`), selected **`for update skip locked`**
  (R31): `update lesson_strikes set settled_at = now(), counted = true where enrolment_id = … and
  lesson_id = …`, then `hold_strike_apply(hold_standing_key(guest_id), guest_id, venue_id,
  struck_at)`. A row a mark is deleting, or another settle holds, is left for the next run.

Returns the strikes counted (holds and lessons, `lapsed_hold` included). One ladder: a strike from a
lapsed court hold, a lapsed online lesson, a late cancel or a no-show count the same, in time order,
so the one-day memory reads them right. The callers are unchanged and none holds a coach or court key:
`tp_hold_strikes` (every minute, its own transaction, 0268:111), `hold_slot` after `lock_principal`
(0269:122), and 0280's `lesson_book_private`, `lesson_join`, `course_join` after theirs.

#### 4.9.3 `lesson_sweep() returns jsonb` (service role)

**Phase 1, find work (no locks).** Due items, at most 200 a run, each `(work, id, coach_id, venue_id)`:

1. `held` enrolments (private, group, course) with `hold_expires_at <= now()` → expire (Money's
   `lesson_hold_expire` decides; it waits out an open payment's ten-minute grace, 0268:48-51);
2. live enrolments of a deleted profile (`deleted_at` set) whose lesson, or course's last covered
   session, has not started → `account_deleted`;
3. a retired coach's live lessons not yet started (private and group) and courses with a session left
   to start → `coach_retired` (`set_coach_status` cancels them at once; this catches a coach retired by
   account deletion, 0286, which takes no coach lock);
4. group sessions `scheduled` with `cutoff_checked_at` NULL and `cutoff_at <= now()` → judge;
5. courses `open` with `cutoff_checked_at` NULL and `cutoff_at <= now()` → judge;
6. courses `open` whose session 1 has started → `running`;
7. lessons `scheduled` with `end_at + 15 min <= now()` → `completed`; courses `running` with no
   session `held|scheduled` left → `completed`.

Sorted by coach, then by the order above.

**Phase 2, per coach.** The first coach: `lock_coach` (blocking). Every later coach: `try_lock_coach`;
false → its items are skipped this run (`skipped`). No court lock and no `FOR UPDATE` on
`reservations`, ever (R6, R33; the hold row only through `lesson_court_release`'s `skip locked`
statement, §2.3). Per item, in its own `begin … exception when others then v_errors := v_errors + 1;
raise warning 'lesson_sweep: % (%)', sqlerrm, sqlstate; end`, re-read under the lock,
`set_config('app.venue_id', v)`:

1 → Money's `app.lesson_hold_expire(e)` (0281; R25 and the review's pick D8: one definition for the
sweep and `deposit_apply`'s EXPIRED branch). It expires the enrolment (and a private lesson,
`payment_expired`, and its hold row through `lesson_court_release`), writes `expired`, and records a
`lapsed_hold` strike through `lesson_strike_record` for a guest-booked enrolment with no succeeded
payment (R30); it returns false and changes nothing while a payment is still open.
2 → `enrolment_cancel_internal(e, 'account_deleted', 'system', null, null)` (refund reason
`account_deleted`, R28).
3 → `lesson_cancel_internal(l, 'coach_retired', …)` or `course_cancel_internal(c, 'coach_retired', …)`.
4, 5 → **the cut-off** (R26, R38). With `start` the session's start (a course: session 1's) and
`booked` the `sum(party_size)` of `booked` enrolments (a course's: `booked` course enrolments):
   - `now() >= start` (judged late: a skipped coach, a stalled cron): stamp `cutoff_checked_at`; when
     `booked < min_places`, event `under_filled` with `data {late: true, places_taken, min_places}`;
     cancel nothing;
   - else `booked >= min_places`: stamp (confirmed);
   - else `booked + live held places >= min_places` and `now() < start − 10 minutes`: defer (no stamp,
     the item comes back next minute);
   - else `lesson_cancel_internal(l, 'under_filled', …)` or `course_cancel_internal(c, 'under_filled',
     …)` (C-14), and the stamp, on the course and its sessions for a course.
6 → `running`. 7 → `lesson_court_release(l, 'completed')`, the lesson `completed` (`completed_at`),
event `completed`; a course `completed` with event `completed`.

**Phase 3, once an hour** (`extract(minute from now()) = 0`), its own exception block: the CD-8 purge,
at most 500 rows: enrolments whose lesson (course: last covered session) ended more than 365 days ago
and still hold a typed phone, friend names or a typed name get `guest_phone = NULL`, `friend_names =
'{}'`, and, for a coach- or staff-booked row, `guest_name = 'Walk-in'`, a fixed marker, **never NULL**
(R44: NULL would let a reader fall back to the account's name, revealing a link). No status changes,
no event, no lock: nothing reads these columns for state.

Every step selects only rows that still need it; every change is one-way or a stamp, so a second run
in the same minute does nothing. Returns `{held_expired, deleted_cancelled, retired_cancelled,
under_filled, courses_under_filled, judged_late, deferred, courses_running, completed,
courses_completed, purged, skipped, errors}`. `revoke all … from public, anon, authenticated; grant
execute … to service_role`. The walker prints `coach_advisory -> match_venue_advisory ->
match_tickets` (the reservation trigger expanded under its status writes; at run time part B returns
at once for a row leaving the live set).

#### 4.9.4 Cron `tp_lesson_sweep`

`'* * * * *'`, `select app.lesson_sweep();`, in the guarded `do` block of 0268:105-112 (pg_cron absent
→ NOTICE). After the hosted push, `cron.job` must have the row.

**Gates (0283).** Matrix, allowlist: none. Coverage: `lesson_strike_record`, `lesson_sweep`
`excluded: service_role only — …`; cron `tp_lesson_sweep` `map:system`. Lock gate: `lesson_sweep`
walked (`SERVICE_WALK`, §2.5). Tests `coaching-sweep.test.ts`, `coaching-strikes.test.ts`.
`check:safeupdate`.

### 4.10 0286 `lesson_account_deletion` (CD-12, R63)

`delete_my_account` re-issued once, from 0264:56, verbatim plus, after the match statements
(0264:188-204) and before the `notification_outbox` delete (0264:213):

```sql
-- typed names keep a marker (lesson_enrolments_typed, SEC-20 anonymise)
update lesson_enrolments
   set guest_name = case when booked_by_kind = 'guest' then null else 'Deleted account' end,
       guest_phone = null, friend_names = '{}'
 where guest_id = v_uid
   and (guest_phone is not null or cardinality(friend_names) > 0
        or (booked_by_kind <> 'guest' and guest_name is distinct from 'Deleted account'));
get diagnostics v_enrolments = row_count;

insert into coach_photo_purges (coach_id, folder)                                  -- R43
select c.id, substring(c.photo_path from '^(coaches/[0-9a-f-]{36})/')
  from coaches c where c.profile_id = v_uid and c.photo_path is not null;

update coaches
   set status = 'retired', retired_at = coalesce(retired_at, now()),
       bio_en = '', bio_ar = '', photo_path = null, updated_at = now()
 where profile_id = v_uid
   and (status <> 'retired' or bio_en <> '' or bio_ar <> '' or photo_path is not null);
get diagnostics v_coach = row_count;

update coach_time_off
   set reason = ''
 where coach_id in (select c.id from coaches c where c.profile_id = v_uid) and reason <> '';
get diagnostics v_time_off = row_count;
```

The audit `after` gains `lesson_enrolments_scrubbed`, `coach_retired` (`v_coach > 0`),
`coach_photo_queued` and `coach_time_off_scrubbed`. **No coach or court lock** (the R25 rule of open
matches; the review's pick D9): the sweep (§4.9.3 items 2 and 3) cancels the student's live
enrolments and the coach's lessons within a minute, with refunds (`account_deleted`, `coach_retired`)
and pushes. Kept on purpose (C-29, R63): the coach's display names (statements, never a guest surface:
retired coaches are hidden everywhere), `lesson_events`, `lesson_strikes`, `lesson_attendance`,
statements. The deletion text (Guest, R50) says so.

**Gates (0286).** Matrix, allowlist, coverage: unchanged (same signature). SEC-20: the deletion proof
(`stored-fields.test.ts:426-615`) also creates, for the deleting guest, a `coaches` row with bios, a
photo path and a time off with a reason, and a coach-booked enrolment linked to the guest with typed
`guest_name`, `guest_phone` and a private party's `friend_names`; after deletion it asserts
`guest_phone` NULL, the typed name `'Deleted account'`, the `empty` columns `''` / `[]`,
`coaches.status = 'retired'`, the display names kept, and one `coach_photo_purges` row for the old
folder (R43); the table list gains `['coaches', 'profile_id', uid]` and `['lesson_enrolments', 'id',
e]`; the `COACH_DATA` proof covers the time-off reason. Tests `coaching-deletion.test.ts`.

## 5. Interfaces with the other lanes

### 5.1 Money

**5.1.1 DB calls Money.** `app.iqd_split(bigint, int) returns bigint[]` (R2, R60; never
`split_evenly`, which is the till's Split bill RPC, 0015:768; no `rpc-overloads.json` entry) and
`course_late_join_price` (`course_join`, `coach_add_student`, `desk_add_student`, `lesson_offer`);
`app.lesson_enrolment_money(uuid)` (`my_lessons`, `my_lesson`, `lesson_cancel_mine`,
`desk_lesson_detail`, `customer_lessons`, `close_branch`); `app.lesson_fee_remaining` (`take_iqd`);
**`app.lesson_refund_start(p_enrolment_id uuid, p_reason text) returns int`** (0278; R5 as amended by
R28: no `from`). The contract DB relies on: called by the cancel internals (§4.7.2), under the
caller's coach lock, after the status writes, for every enrolment with an applied online row, live or
not; the amount is always the engine's `refund_due_online_iqd` (which implements C-23's course leave,
R62); `p_reason` is DB's (§4.7.2 table; `account_deleted` stays `account_deleted`); it locks only the
enrolment's `booking_payments` rows (`FOR UPDATE`, unranked), starts at most one refund per payment
row through `app.deposit_begin_refund` (0242:165), calls `app.deposit_nudge()`, writes the
`refunded` event, and never touches `tabs`, `payments`, `refunds`, `reservations` or a court key;
it leaves a `created|pending` payment alone (its success is refunded by the apply, because the
enrolment is no longer live); returns the refunds started. Desk money of a cancelled enrolment is
not refunded here: `lesson_refunds_due` lists it for the till, and Money's `app.refund` caps it at
`refund_due_desk_iqd` (R36). The sweep calls **`app.lesson_hold_expire(p_enrolment_id) returns
boolean`** (0281) for every lapsed `held` enrolment (§4.9.3).

**5.1.2 Money calls DB.** `lock_coach` (0275); `lesson_places_taken`, `course_places_taken` (a late
success re-checks places, itself excluded, R29); `lesson_lock_branch_courts` (returns the locked set)
and `lesson_pick_court(p_venue, p_period, p_locked)` (R34), `match_expire_holds`,
`coach_available` (a late success re-picks or revives); `lesson_court_release` (the hold row, R25);
`lesson_strike_record(e, l, 'lapsed_hold')` (R30); `lesson_event` (`paid_online`, `expired`,
`settled`, `refunded`); `coaching_rules`; `coach_of_caller` (`my_coach_statements`, R45).

**5.1.3 Lock rules for Money's lesson bodies.**

- `lesson_settle`: `day_sessions → lock_coach → tabs → payments → till_shifts` (§1.4); passes.
- `app.refund` re-issued for a lesson tab (R36): `lock_coach` before the tab lock, the order staying
  `day_sessions → coach → tabs → payments → refunds`.
- **`deposit_apply`'s lesson arm (0281; R33).** The walker flattens arms in text order. The shape that
  passes: `lock_coach(<the enrolment's coach>)` in a `purpose = 'lesson'` arm placed before the
  deposit arm's `lock_court`; then, for a private lesson, `lesson_lock_branch_courts`, the hold row
  `FOR UPDATE`, `match_expire_holds`, the writes (courts, row, expiry, writes: an expiry before the
  row lock would print `… match_tickets -> reservations`, a Rule 1 violation); then the shared
  `booking_payments … for update`. `lesson_settle_success` takes no lock of its own, turns the hold
  row into `kind 'lesson'`, `confirmed` by a plain `UPDATE` (court and period unchanged: no new
  overlap), and re-picks only from the locked set. Printed: `coach_advisory -> court_advisory ->
  reservations -> match_venue_advisory -> match_tickets`. Money edits
  `tests/lock-order-matches.test.ts:228` and `:301` in the 0281 commit (R33). At run time the payment
  row is locked only after `lock_coach` (the first read, 0267:48-51, is unlocked).
- `lesson_hold_expire`: no lock of its own; the hold row only through `lesson_court_release` (the
  `skip locked` statement), so the sweep, which holds only coach keys, can call it (the court
  precondition of `money.md` §6.5 is not needed for a status-only write).
- `coach_statements_draft`: a procedure that commits after each (coach, branch) pair (R59), one coach
  at a time in coach id order, never a court.

**5.1.4 What DB promises Money.** The states of §3, including the two transitions Money writes
(`expired → scheduled`, `expired → booked`, R29) and the held expiry (`lesson_hold_expire`); the
snapshots on lessons and courses (price, court share, `coach_share_bp`);
`lesson_enrolments.price_iqd` is what the enrolment owes (private: the lesson; group: the place;
course: the whole course or the remaining sessions); `payment_mode`; a `held` enrolment's
`hold_expires_at` is the payment window (`deposit_window_seconds`), which `lesson_payment_prepare`
copies to the payment's `deadline_at`; `coach_statement_lines` carries a `lesson_id` on every line
(R24). DB never writes `tabs` or `booking_payments` except through `lesson_refund_start`; an open
lesson tab of a cancelled enrolment is Money's (`lesson_settle` refuses it).

### 5.2 Guest

DB writes one `lesson_events` row per transition, in the same transaction and after the rows it
describes are in their new state. Guest's AFTER INSERT trigger `lesson_events_notify` maps each row
to its push (the `guest.md` §4.5.4 tables, R40), so the row must carry what the mapping reads:
`type`, `code`, `actor`, `enrolment_id`, and `lesson_id`, which for a course-wide event is in `data`
as the course's next session not yet started (else its last), the push's `params.lesson_id` and the
coach push's ref. `data` holds ids, times, counts, codes and flags only.

| Transition | `type` | `lesson_id` / `course_id` | `enrolment_id` | `actor` | `code` | `data` |
| --- | --- | --- | --- | --- | --- | --- |
| private lesson booked | `booked` / `held` | lesson | the enrolment | guest, coach, staff | — | `{court_id, party_size}` |
| group session / course created | `booked` | lesson / course | — | coach, staff | — | `{court_id}` / `{sessions, lesson_id}` |
| guest joined | `joined` | lesson / course | yes | guest | — | `{places_taken, places_total, lesson_id}` |
| coach or desk added | `added` | lesson / course | yes | coach, staff | — | `{places_taken, places_total, lesson_id}` |
| payment succeeded (Money) | `paid_online` | lesson / course | yes | system | — | `{payment_id, amount_iqd, places_taken, places_total, lesson_id}` |
| payment window lapsed (Money) | `expired` | lesson / course | yes | system | `expired` | `{lesson_id}` |
| enrolment cancelled | `enrolment_cancelled` | lesson / course | yes | guest, coach, staff, system | the `cancel_kind` | `{reason, refunds_started, places_taken, places_total, lesson_id}`: `reason` is the lesson's or course's `cancel_reason` that carried it, NULL for an enrolment-only cancel |
| lesson or course cancelled | `cancelled` | lesson (+ course) / course | — | coach, staff, system | the `cancel_reason` | `{enrolments, via_course, lesson_id}`: `via_course` true on a session cancelled with its course |
| under-filled at cut-off | `under_filled` | lesson / course | — | system | — | `{places_taken, min_places, late, lesson_id}`: `late` true when judged after the start, nothing cancelled (R26) |
| lesson moved in time | `rescheduled` | lesson (+ course) | — | coach, staff | — | `{from_start_at, to_start_at, court_id}` |
| court changed | `court_moved` | lesson (+ course) | — | staff | — | `{from_court_id, to_court_id}` |
| lesson or course ended | `completed` | lesson / course | — | system | — | — |
| attendance | `attended` / `no_show` / `unmarked` | lesson | yes | coach, staff | — | — |
| desk payment, refund (Money) | `settled` / `refunded` | lesson / course | yes | staff, system | the refund reason | `{payment_id, amount_iqd}` |

`places_taken` is the booked places after the change; `places_total` is `max_places`; a private lesson
sends neither. `court_moved` comes only from `desk_move_lesson_court` (R7). A pending link (C-21) is
an `added` row like any other: the trigger reads the enrolment's `guest_id` and queues
`lesson.added_by_coach` due at `now() + 5 s` (R44), never synchronously, so a matched and an unmatched
add do the same work. `lesson_link_confirm` writes no event (the coach is never told).

Guest's reminder triggers (`trg_lesson_reminders`, `trg_enrolment_reminders`) follow row state; DB
asks two things of them: the enrolment trigger also fires on `update of link_confirmed_at,
guest_id`, and no reminder is queued for a pending link (`link_confirmed_at` NULL with
`booked_by_kind <> 'guest'`, C-21). DB never calls `lesson_notify` or `lesson_sync_reminders` (R40).
Read shapes: §4.7.9 and `guest.md` §4.3 (R41).

### 5.3 Operator

The desk grid shows a lesson row as `kind 'lesson'`, `guest_name 'Lesson'`; every reservation action
on it (cancel, mark, extend, confirm, move, open a tab) gets `LESSON_VIA_COACHING` (one sentence per
detail, §4.5.3) and should open `/desk/lessons/$id`; the court moves only through
`desk_move_lesson_court` (R7). `desk_lessons` carries the settings and the catalogue (R20) and
`booked_by_kind` for the "booked by the coach · unpaid" tile flag (C-24). Staff surfaces show typed
names and phones for coach- and staff-booked students (R44). Retiring a coach cancels their lessons and
answers `lessons_cancelled` (R45); `set_coach_branches` can refuse `BRANCH_HAS_BOOKINGS` (R52).
Admin reads `coaches_admin`; promotion picks a profile with `customer_search`. The protocol forms and
the widened `PRICE_VIA_PROTOCOL` / `LAUNCH_VIA_PROTOCOL` copy are §4.8; a launched type's
`duration_min`, `sessions_count` and private `max_places` are read-only for a manager (R46). Reads,
results and `can` flags: §4.7.9 and `operator.md` §5.6–§5.7 (R41). Codes the operator maps follow X31
(R52): `desk_move_lesson_court` raises `NO_COURT_FREE`, `INVALID_TRANSITION` `held|ended` and
`COURT_NOT_FOUND`, never `SLOT_TAKEN`; `cancel_coach_time_off` raises `INVALID_ARGUMENT` `p_id`, never
`NOT_FOUND`; `desk_book_lesson` never raises `COACHING_OFF` or `BEYOND_HORIZON`.

## 6. Situations we must survive

| # | Situation | What happens |
| --- | --- | --- |
| 1 | Two guests book the same coach at the same time | `lock_coach` orders them; the second gets `COACH_BUSY` (`coach_available` under the lock; `lessons_coach_no_overlap` backs it). |
| 2 | Two coaches' lessons race for the branch's last court | `lesson_lock_branch_courts` orders them; the second gets `NO_COURT_FREE`. |
| 3 | A coach's private lesson at A and group session at B overlap | The coach key is branch-free: `COACH_BUSY`, exclusion as backstop. |
| 4 | A guest's `hold_slot` sits on the last court as a lesson is booked | The lesson waits for the court, sees a live hold: `NO_COURT_FREE` (a stale one is expired first). |
| 5 | A lesson takes the last firm-free court while an open match fills | The trigger (WHEN now includes `lesson`) bumps the match (part B). |
| 6 | A waiting open match needs the last free court | `lesson_pick_court` skips it (`match_court_claimed`, R22 of open matches): `NO_COURT_FREE`. |
| 7 | A double tap on Book | The second waits on `lock_principal('hold_slot')`, then replays: `duplicate: true`. |
| 8 | A guest picks Qi and walks away | The hold expires by TTL like any hold (R25); the sweep calls `lesson_hold_expire`, which expires lesson and enrolment and records a `lapsed_hold` strike for the guest (R30). |
| 9 | Qi success arrives after the sweep expired the lesson | Money's apply revives it (`expired → scheduled/booked`, R29) or refunds `slot_lost`; never a raw error. |
| 10 | A group session is 2 of 3 at its cut-off, a third guest mid-Qi | The sweep defers until the payment resolves or start − 10 minutes, then judges on `booked` places (R38): cancelled `under_filled` with online money refunded, or confirmed. |
| 11 | A student cancels late after the cut-off, dropping below the minimum | `cutoff_checked_at` is set: the session runs. |
| 12 | The sweep reaches a cut-off after the session started (a busy coach) | Stamp and an `under_filled` `late` event; nothing is cancelled (R26). |
| 13 | A coach creates tonight's 18:00 group at 17:00 with a 2-hour cut-off | `LESSON_CLOSED` `cutoff` (R47); never created and cancelled a minute later. |
| 14 | A guest joins an 8-session course after session 3 | Pays `Σ iqd_split(price, 8)[4..8]`; `PRICE_CHANGED` if session 4 starts while paying. |
| 15 | A guest leaves a running course with sessions weeks away | `guest_late` judged against their own next session; the sessions outside the window are refunded online, the next one kept if inside it (C-23, R62). |
| 16 | The coach moves session 2 past session 3 | `SESSION_NOT_MOVABLE` `order`. |
| 17 | The coach moves a private or group lesson | Allowed (R8): grid, hours, overlap, a free court; `rescheduled_at` stamped; its guests may cancel free until the new start; a group's cut-off moves with it (R32). A held lesson: `INVALID_TRANSITION` `held`. |
| 18 | The desk drags a lesson on the grid, or an offline till replays a move | `LESSON_VIA_COACHING` `move` (R7); the lesson screen's Move court uses `desk_move_lesson_court`. |
| 19 | An offline till replays a cancel, extend, confirm or tab on a lesson row | `LESSON_VIA_COACHING`, recorded as a conflict, never retried. |
| 20 | A coach types a phone verified on someone's account | Linked but pending: that person's My lessons asks "Is this you?"; "Not me" unlinks silently; no reminder before "Yes"; the answer, timing and roster are those of an unknown phone (C-21, R44). |
| 21 | A coach tries 31 phones in a day | The 31st is `COACH_ADD_LIMIT` `day`; every add is audited. |
| 22 | A coach books an 11th upcoming private lesson for walk-ins | `COACH_ADD_LIMIT` `live` (C-24, R56); the desk tile shows "booked by the coach · unpaid". |
| 23 | A coach tries to book or join their own lesson | `ALREADY_ENROLLED` `coach` (R56). |
| 24 | The coach opens the roster 8 days after the session | Typed names, no phones (CD-3 from `end_at`, R54). |
| 25 | A guest-booked student no-shows | A strike row; `tp_hold_strikes` applies it within a minute; the next court hold or lesson booking reads the ladder. |
| 26 | A coach-booked student no-shows | No strike (CD-2); the no-show shows on the statement detail (C-24). |
| 27 | A coach corrects a no-show while the student's booking is settling that strike | The delete skips the locked row, the booking's settle never waits on the coach: no 40P01 (R31). |
| 28 | Coach and desk mark the same student at once | The coach lock orders them; the second is a duplicate or the next mark. |
| 29 | A manager raises a launched type's price, or its length | `PRICE_VIA_PROTOCOL` `price` / `shape`; the owner approves `lesson_price`; booked lessons keep their snapshot; a stale screen gets `PRICE_CHANGED`. |
| 30 | A draft's length changes between the owner's approval and the apply | `PRICE_TARGET_CHANGED` `lesson_type` (the shape in `before`, R46). |
| 31 | A student deletes the account with a lesson tomorrow | Typed names marked, phones scrubbed at once; the sweep cancels within a minute and refunds (`account_deleted`). |
| 32 | A manager retires a coach with six lessons and a running course | Never refused: the lessons and the rest of the course are cancelled as `coach_retired` with refunds and pushes, the photo queued for removal; the coach keeps read access to approved and paid statements only (C-25, R45). |
| 33 | A coach deletes the account | Retired at once, bio emptied, photo queued; the sweep cancels the lessons; the display name stays on statements, never on a guest surface (C-29, R63). |
| 34 | The owner switches coaching off | No new guest or coach bookings; lessons run; coach mode keeps working with a banner; the desk can still stage, `coach_slots` included (R45, R51). |
| 35 | The owner switches online lesson payment on before the lessons terms ship | `ONLINE_PAYMENT_OFF` `terms` (C-26, R50). |
| 36 | The till goes stale with offline mode on | Guest and coach bookings, joins, adds and creations inside the protected horizon: `DEGRADED_LOCKOUT` (R15); cancels and the desk work. |
| 37 | The owner closes a branch with a lesson next week, or an unpaid statement | `BRANCH_HAS_BOOKINGS` (`coaching_money` for the money, R37). |
| 38 | A guest cancels a held lesson while `hold_slot` expires stale holds on that court | The cancel's hold-row statement skips a row `hold_slot` holds (it is expiring it anyway); no cycle (R25). |
| 39 | The sweep holds coach A while a booking holds coach B | The sweep try-locks B, skips it this run. |
| 40 | A guest with two court holds books online lessons | Court holds plus held lessons count against `max_live_holds_per_guest`: `HOLD_QUOTA_EXCEEDED` (R30). |

## 7. Tests (`packages/db/tests`)

| File | Covers |
| --- | --- |
| `coaching-settings.test.ts` | ships off everywhere; roles; patch validation; `coach_max_open_private` bounds; the view's three columns and no `coach_share_bp`; `ONLINE_PAYMENT_OFF` `terms` while `lesson_terms_version` is NULL, accepted once set; `lesson_terms_ok` (date, revision); audit |
| `coaching-admin.test.ts` | promote (twice → `ALREADY_COACH`; retired → re-activated, unaccepted; a photo folder that is a profile id refused), branch scope for managers, `set_coach_branches` `BRANCH_HAS_BOOKINGS`, types (unlink deletes the coach price); the price lock (manager `price`, `shape` incl. a private type's `max_places`, `LAUNCH_VIA_PROTOCOL`; drafts free; owner direct; `set_coach_price` refused to a manager on a draft); the patch allowlist; the 2-hour cut-off default and `lesson_types_cutoff`; hours (`HOURS_INVALID`, `HOURS_OVERLAP` `<i>:<weekday>` across branches, `24:00`); time off (`TIME_OFF_HAS_LESSONS`, overlap); `storage_path_in_use` counts a coach photo; `coach_me` for a retired coach, a staff member who coaches, a branch with coaching off |
| `coaching-guards.test.ts` | every §4.5 re-issue: firm counts, the trigger fires on a lesson insert and on hold → lesson, `court_availability` masks, `close_branch` (live lessons; `coaching_money`), each `LESSON_VIA_COACHING` detail incl. `confirm` and `move` (queued or not), a lesson hold not expired as an orphan but expired by TTL, the twin test |
| `coaching-booking.test.ts` | private desk and online (held); the enrolment's status in the result (X5); grid for every kind, horizon, hours, closed date, time off, `COACH_BUSY` across branches, party, payment modes, `TERMS_REQUIRED` `lessons` online only, `HOLD_QUOTA_EXCEEDED` across court holds and held lessons, `PRICE_CHANGED`, idempotency (double tap, foreign key), R22 court skipped, `NO_COURT_FREE`, a pick limited to the locked courts, the lesson row passes every `reservations` CHECK; self-enrolment refused; paused and unaccepted coaches; join and course join (places, `LESSON_CLOSED`, `DEGRADED_LOCKOUT`, pro-rata against `@touch/core` `splitEvenly` through `iqd_split`); creation inside the cut-off refused |
| `coaching-races.test.ts` (two connections) | same coach same slot (one wins); last court (one wins); private + group across branches; `hold_slot` against a lesson booking; a held-lesson cancel against `hold_slot`'s expiry (no 40P01); the sweep against a booking; a no-show correction against `lesson_join` settling that strike (R31) |
| `coaching-courses.test.ts` | all-or-nothing creation with the failing index in `detail`; reschedule of every kind (order for courses, court kept or re-picked, coach busy, held refused, the group and course cut-off follow and `cutoff_checked_at` clears, sign-up follows, `rescheduled_at`); cancel before and after session 1 (Money's refund called once per enrolment, live or not, with the right reason) |
| `coaching-cancel.test.ts` | free versus late at the window; held cancel releases the hold row at once; free after a reschedule; a course leave judged against the guest's own next session (C-23); course session refused; coach and staff cancels never strike; a `guest_late` enrolment refunded when the coach later cancels; `account_deleted` reason; retirement cancels everything, never refused; reason form; `link_pending` refused |
| `coaching-attendance.test.ts` | the 24-hour window; no-show strike only for guest-booked; `clear` removes an unsettled strike, a settled or locked one stays |
| `coaching-sweep.test.ts` | each step; a second run does nothing; a busy coach skipped; the cut-off judged once, only before the start (late: event, no cancel), deferred while held places could reach the minimum; completion and the court row; deleted student and retired coach cancels; held expiry through `lesson_hold_expire` with a `lapsed_hold` strike; the hourly purge writes the marker, never NULL |
| `coaching-strikes.test.ts` | settle merges holds and the three lesson strike kinds in time order; `BOOKING_SUSPENDED` / `HOLD_COOLDOWN` on lesson bookings; no `hold_standing` write inside a cancel's transaction; settle skips locked rows |
| `coaching-privacy.test.ts` | the public reads and `my_lessons` carry no student, phone, profile id or court id, by **value** scan as well as key scan (R43, R58); unaccepted coaches absent; roster: typed names and phones for coach- and staff-booked rows (never the profile's), phone gone after `end_at` + 7 days and while held; the CD-8 marker on the roster after the purge; `coach_add_student` matched and unmatched answers identical but for ids, the same outbox work; an already-enrolled match not linked; a pending link absent from `customer_lessons` and from the desk's `customer_id`; "Not me" unlinks with no event; `COACH_ADD_LIMIT` at the 31st; another coach's lesson is `LESSON_NOT_FOUND`; a retired coach's `coach_lesson` is `NOT_A_COACH` |
| `coaching-shapes.test.ts` | every 0279/0280 read and write result ⊇ its key list in `packages/core/src/coaching/shapes.ts` (R41) |
| `price-promo-lessons.test.ts` | the three kinds through propose, numbers and apply; marketing `NOT_STEP_ACTOR`; `PRICE_TARGET_CHANGED` on figures and on shape; coach price removal |
| `coaching-deletion.test.ts` | student and coach deletion end to end with the sweep; the photo purge queue and its two RPCs |
| `lock-order-coaching.test.ts` | §2.5 |
| Extended | `stored-fields.test.ts` (§4.3.16 incl. `COACH_DATA`, §4.10), `rls-matrix.ts` (drop 25), `lock-order-matches.test.ts` (`DECLARED`, `:75`; Money: `:228`, `:301`), `hold-strikes.test.ts`, `account-deletion.test.ts`, `booking-integrity.test.ts`, `assistant-catalog.test.ts` (no tool names the person-money reports, R42); helpers `createTestCoach`, `createTestLessonType` in a new `coaching-harness.ts` |
| Gates | `check:locks`, `check:authz`, `check:rpc-registry`, `check:assistant-coverage`, `check:broadcast`, `check:analytics`, `check:invariants`, `check:migrations` (with the waiver for 0276), `check:safeupdate`, `check-error-codes`; `db:types` with no diff |

The e2e journeys (R58: `operator-coaching.spec.ts`, `site-coaching.spec.ts`, EN and `@ar`) are the
Operator and Guest lanes'; DB's fixtures (`scripts/db-fixtures.mjs`) give them a branch with coaching
on, an accepted coach, the three kinds and a launched type.

## 8. Decisions this file takes

| # | Decision | Why |
| --- | --- | --- |
| D-1 | A lesson's court rows keep `guest_id` NULL; `reservations_live_hold_has_guest` and the orphan rule exempt rows with a `lesson_id` | Folded into R1 and R25. Giving the hold a guest would open `confirm_booking`, `release_hold`, the guest branch of `cancel_reservation`, `my_reservations` and the hold ladder to it (§1.3). |
| D-2 | Cancels, removals, marks and the sweep take no court lock | Folded into R6 and R33 (no `FOR UPDATE` on `reservations` either, no `STATUS_ONLY` addition). |
| D-3 | The sweep blocks on its first coach only and try-locks the rest | It touches many coaches in one transaction; a blocking second coach could close a cycle with a booking. |
| D-4 | Lesson strikes and lapsed holds are one ladder; guest lesson bookings read it | §1.4's settle-under-the-principal-lock design; with R30, a lapsed online lesson strikes too. |
| D-5 | Guest and coach RPCs are `guarded` in the allowlist; only the four public reads and `coach_me` are publicByDesign | Folded into R12. |
| D-6 | `guest_phone`'s CHECK uses `app.phone_digits`; writers require `app.phone_canon` to read it | Folded into R11. |
| D-7 | The 30-minute grid applies to every lesson start | Folded into R9. |
| D-8 | `set_coach_price` refuses a manager even on a draft type | A coach price on a draft would go live with the type's launch without the owner seeing it. |
| D-9 | A type's `kind` never changes; a manager's change of `duration_min` or `sessions_count` on a launched type is a price change | Amended by R46: a private type's `max_places` too, and the proposal carries the shape. |
| D-10 | ~~Only course sessions move in time~~ | **Struck** (R8, R32): every kind is rescheduled. |
| D-11 | The cut-off is judged once (`cutoff_checked_at`) | Amended by R26 and R38: judged only before the start, on `booked` places, deferred while held places could decide it; a reschedule may clear the stamp (R32). |
| D-12 | The desk may create, book and add while coaching is off | Staging before launch; extended by R51 (`coach_slots` answers staff while off). |
| D-13 | ~~Coaches and the desk may add to a course until the end~~ | **Superseded** by R39 and R48: course adds close at `signup_closes_at`; group sessions keep "until the end" for walk-ins. |
| D-14 | `coach_add_student` never reveals a match | Amended by C-21 and R44: the link is pending until the person confirms; staff and coach surfaces show typed values only; the push is due a few seconds later on both paths. |
| D-15 | A deleted coach keeps the display names; bios, photo path and time-off reasons are emptied; the sweep cancels the rest | Folded into C-29 and R63; the photo object is queued for removal (R43). |
| D-16 | ~~`move_reservation`'s lesson court move writes `court_moved`~~ | **Struck** (R7): `move_reservation` refuses a lesson row; `desk_move_lesson_court` is the only mover and the only `court_moved` writer. |
| D-17 | A lesson's court row carries no price (`reservations_lesson_row`) | Lesson money is on enrolments; no court figure can count it twice. |
| D-18 | Coach hours sit on :00/:30 | Every offered start then fits a window exactly. |
| D-19 | ~~A lapsed lesson's court hold is left to `expire_stale_holds`; a lesson body writes a `hold` row only while it is not stale~~ | **Superseded** by R25: TTL expiry as any hold, and every path that ends a held lesson expires its hold row at once with `skip locked` (§2.3). |
| D-20 | A paused coach's lessons run, can be cancelled, marked and rescheduled; no new booking, creation or add (`COACH_INACTIVE`) | Amended by R16: guests cannot join a paused coach's sessions either, and a paused coach is hidden from guests. |
| D-21 | `move_reservation`'s refusal detail is `move` | One detail per refusing function (`cancel`, `mark`, `extend`, `create`, `tab`, `confirm`, `move`); `court_only` no longer describes anything. |
| D-22 | A desk-typed phone links like a coach-typed one (pending, C-21); a desk-picked customer is linked at once with the profile's name and phone copied into the typed columns | C-21 names the desk; R44 needs typed values on every staff surface. |
| D-23 | Every guest booking and join takes `lock_principal('hold_slot', caller)`, desk mode included | R30 needs the key for online paths; one key per guest keeps the ladder settle, the cap and the replay under one lock; `lesson_guest` as a principal kind is dropped. |
| D-24 | A reschedule of a session whose cut-off is already judged keeps its stamp and is not refused `LESSON_CLOSED` | R32 keeps the stamp when the move is inside the old cut-off; R47's purpose (no immediate under-filled cancel) only applies to an unjudged session. |
| D-25 | The R25 hold-row statement uses `skip locked`, and the lock walker does not emit a `skip locked` lock on `reservations` | Reconciles R25 with R33 (§2.3, §2.5 item 7): the cancels take no lock that can wait. |
| D-26 | `lesson_strike_record` checks existence by a plain read | A `skip locked` check would hide a row being settled and make the insert wait on it (the R31 cycle); the plain read never waits and sees the row. |
| D-27 | `online_payments_available` means "the lessons terms version is set" | The database cannot see whether the Qi secrets are configured; `lesson-begin` answers `PROVIDER_UNAVAILABLE` when they are not. |

## 9. Known limits

- A retired or deleted coach's photo object leaves `menu-media` within a day, through the purge queue
  and `protocol-action` (R43), not in the same transaction; a CDN or chat preview may hold it longer.
- Any manager may write any object in `menu-media` (0234:448-459), so a manager at branch A can
  replace the photo of a coach who teaches only at B (P14; accepted, as for menu items).
- `coach_slots` counts an unswept stale hold as free (as `court_availability` does); a booking then
  expires it, unless its payment is still open (`NO_COURT_FREE`).
- `coach_slots` shows anyone a coach's free starts for 14 days, so the gaps reveal when they teach,
  though not whom (P12; accepted).
- `hold_slot` counts only court holds against `max_live_holds_per_guest` (0269:183-193); the lesson
  paths count both, so a guest at the cap through lessons can still place court holds up to the cap.
- Nothing stops a guest from booking two overlapping lessons with different coaches.
- Coach-hour overlap across branches is enforced by the writers, not a constraint.
- The CD-8 marker `'Walk-in'` and the deletion marker `'Deleted account'` are English on staff screens.
- A busy coach may be skipped by the sweep for a run (about a minute); a cut-off judged after the
  start then cancels nothing (R26).
- `my_lessons` lists at most 100 rows per scope; `customer_lessons` the upcoming and the last 20.
- Lesson money is outside the court reports until Money's 0285.
- A strike settled into the ladder is not undone by a later `attended` mark: staff lift it with
  `hold_standing_decide`.

## 10. Additions to §1

Items folded into §1.12–§1.13 are marked **(folded, R…)**; the rest are this lane's names.

### 10.1 New names (no rename)

- **§1.2 columns.** `lessons.cutoff_checked_at`, `courses.cutoff_checked_at` **(folded, R22)**;
  `lessons.rescheduled_at` **(folded, R32)**; `lesson_enrolments.link_confirmed_at` **(folded,
  R44)**; `coaches.public_accepted_at` **(folded, R61)**; `venue_settings.coach_max_open_private`
  **(folded, R56)**; `platform_settings.lesson_terms_version` **(folded, R50)**.
- **§1.2 table.** `coach_photo_purges` (chain-wide; R43's queue).
- **§1.2 constraints.** `coaches_status`, `coaches_names`, `coaches_bios`, `coaches_photo`,
  `coaches_retired`; `coach_time_off_period`, `coach_time_off_reason`, `coach_time_off_set_by`;
  `coach_hours_weekday`, `coach_hours_window`, `coach_hours_set_by`; `lesson_types_kind`,
  `lesson_types_text`, `lesson_types_duration`, `lesson_types_places`, `lesson_types_sessions`,
  `lesson_types_launch` (§1.2's two), `lesson_types_price` (price > 0, course price ≥ sessions),
  `lesson_types_cutoff` **(folded, R26)**; `coach_prices_positive`; `courses_status`,
  `courses_cancel`, `courses_titles`, `courses_numbers`, `courses_created_by`, `courses_idem`;
  `lessons_kind`, `lessons_course`, `lessons_price`, `lessons_time`, `lessons_cutoff`,
  `lessons_places`, `lessons_status`, `lessons_hold`, `lessons_ended`, `lessons_cancel_reason`,
  `lessons_booked_by`, `lessons_idem`; `lesson_enrolments_target`, `_who`, `_typed`, `_link`,
  `_name`, `_phone`, `_party`, `_friends`, `_booked_by`, `_course`, `_payment`, `_status`, `_hold`,
  `_ended`, `_cancel_kind`, `_idem`; `lesson_attendance_status`, `lesson_attendance_by`;
  `lesson_strikes_kind` (with `lapsed_hold`, **folded, R30**), `lesson_strikes_settled`;
  `lesson_events_type`, `_target`, `_actor`, `_code`, `_data`; `coach_statements_month`,
  `_status`, `_stamps`, `_text`, `_no_card` (R49); `coach_statement_lines_bp`,
  `coach_statement_lines_sign` **(folded, R22)**, and no `coach_statement_lines_kind` **(dropped,
  R24)**; `coach_photo_purges_folder`; `reservations_lesson_id_fkey`, `reservations_lesson_row`;
  `reservations_live_hold_has_guest` re-created **(folded, R1)**; `venue_settings_coaching_rules`
  (§1.2's, widened for `coach_max_open_private`); `platform_settings_lesson_terms`. The 0276 index
  names (§4.4), with Money's `tabs_by_lesson_enrolment`, `booking_payments_by_lesson_enrolment`,
  `coach_statement_lines_lesson`, and `coach_statement_lines_one_per_lesson` (R24's unique).
- **§1.4.** `lock_coach` and `try_lock_coach(uuid) returns boolean` in 0275 **(folded, R6)**;
  `lock_principal` kinds `hold_slot` (reused, **R30**) and `coach_students`; the gate changes of §2.5
  (`SERVICE_WALK` **folded, R33**; the `skip locked` rule, D-25).
- **§1.5.** In 0274: `lesson_terms_ok(text) returns boolean` (R50). In 0275:
  `trg_sanitise_lesson_type()`, `trg_sanitise_course()`, `trg_sanitise_coach_time_off()`,
  `trg_sanitise_coach_statement()`; triggers `coaches_sanitise`, `lesson_types_sanitise`,
  `courses_sanitise`, `coach_time_off_sanitise`, `lesson_enrolments_sanitise`,
  `coach_statements_sanitise`, `lesson_events_append_only`, `coach_statement_lines_frozen`. In 0279:
  `coach_of_caller() returns coaches`, `coach_in_hours(uuid, uuid, tstzrange) returns boolean`,
  `lesson_on_grid(timestamptz, uuid) returns boolean`, `lesson_bookable(uuid, timestamptz,
  timestamptz) returns text`, `coach_photo_purge_due(int default 20) returns jsonb`,
  `coach_photo_purged(uuid) returns void`; `storage_path_in_use` re-issued **(folded, R43)**. In
  0280: `lesson_lock_branch_courts(uuid) returns uuid[]` and `lesson_pick_court(uuid, tstzrange,
  uuid[]) returns uuid` **(folded, R34)**; `lesson_link_by_phone(text, uuid) returns uuid`;
  `lesson_court_release(uuid, text) returns void`; `course_cancel_internal(uuid, text, text, uuid,
  uuid) returns jsonb`; fixed signatures for §1.5's `…`: `lesson_create_internal(uuid, uuid,
  timestamptz, uuid, smallint, bigint, boolean, text, uuid, uuid, text, uuid[]) returns lessons`,
  `lesson_event(uuid, uuid, uuid, uuid, text, text, uuid default null, uuid default null, text
  default null, jsonb default '{}') returns bigint`. **Money's, called by DB:**
  `lesson_refund_start(uuid, text) returns int` **(folded, R5, R28)**, `lesson_hold_expire(uuid)
  returns boolean`, `course_late_join_price`, `iqd_split(bigint, int) returns bigint[]` **(R2, R60)**.
- **§1.6 RPCs.** `lesson_link_confirm(p_enrolment_id uuid, p_yes boolean) returns jsonb` (guest;
  **folded, R44**); `coach_accept_public() returns jsonb` (coach; **folded, R61**). Both `guarded`.
- **§1.7.** `set_coach_status` in 0280 **(folded, R16)**, never refusing a retire **(R45)**.
- **§1.8 (0277).** `expire_stale_holds` (0268:33) and `match_expire_holds` (0268:71), the orphan rule
  **(folded, R22, R25)**; `confirm_booking` (0242:1304) **(folded, R35)**; `move_reservation` refuses
  a lesson **(folded, R7)**; `close_branch` `coaching_money` **(folded, R37)**.
- **§1.10 details.** `LESSON_VIA_COACHING` `cancel`, `mark`, `extend`, `create`, `tab`, `confirm`,
  `move`; `LESSON_NOT_CANCELLABLE` `status`, `started`, `private`, `course_session`, `ended`,
  `link_pending`; `SESSION_NOT_MOVABLE` `ended`, `started`, `order` (no `not_course`, R32);
  `COURSE_STARTS_INVALID` `count`, `order`, `span`; per-start codes carry the 1-based index;
  `INVALID_TRANSITION` `held`, `ended`, `not_started`, `marks_closed`, `not_booked`, `cancelled`,
  `retired`, `confirmed` (no `has_lessons`, R45); `LESSON_CLOSED` `cutoff` (R47);
  `ALREADY_ENROLLED` `coach` (R56); `COACH_ADD_LIMIT` `day`, `live` (R56); `TERMS_REQUIRED`
  `lessons` (R50); `ONLINE_PAYMENT_OFF` `terms`; `BRANCH_HAS_BOOKINGS` `coaching_money` (R37);
  `HOURS_OVERLAP` `<index>:<weekday>` or `time_off`; `PRICE_VIA_PROTOCOL` details `price`, `shape`
  (R46); `PRICE_TARGET_CHANGED` hints `lesson_type`, `coach_price`. Reused, already in the catalogue
  (R14): `PRICE_VIA_PROTOCOL`, `LAUNCH_VIA_PROTOCOL`, `INVALID_ARGUMENT`, `IDEMPOTENCY_CONFLICT`,
  `CLOSED_DATE`, `OUTSIDE_HOURS`, `DEGRADED_LOCKOUT`, `HOLD_QUOTA_EXCEEDED`, `VENUE_SETTINGS_MISSING`,
  `COURT_NOT_FOUND`, `CUSTOMER_NOT_FOUND`; `STATEMENT_NOT_DRAFT` is first raised by DB in 0275.
- **Event data keys** (§5.2): `court_id`, `party_size`, `sessions`, `places_taken`, `places_total`,
  `min_places`, `late`, `reason`, `refunds_started`, `enrolments`, `via_course`, `lesson_id`,
  `from_start_at`, `to_start_at`, `from_court_id`, `to_court_id`, and Money's `payment_id`,
  `amount_iqd`. No `desk_grid` code (R7).
- **Audit actions.** `venue.coaching_settings`; `coaching.coach.promote|update|status|types|branches|accept_public`,
  `coaching.lesson_type.create|update`, `coaching.coach_price`, `coaching.hours`,
  `coaching.time_off`, `coaching.lesson.book|cancel`, `coaching.course.create|cancel`,
  `coaching.student.add|remove`, `coaching.link.confirm|decline`, `coaching.attendance`,
  `coaching.reschedule`, `coaching.court_move`.
- **Gates.** Matrix drop 25 and the shapes `GUEST_OR_COACH`, `DESK_UP`; SEC-20 `LINK_COLUMNS` + four,
  the `empty` route, `COACH_DATA` and the `Financial info` category **(folded, R49)**; the SEC-28 /
  SEC-29 patterns and `PERSON_MONEY_REPORTS` **(folded, R42)**; `tests/lock-order-coaching.test.ts`;
  `packages/core/src/coaching/shapes.ts` and `coaching-shapes.test.ts` **(folded, R41)**.

### 10.2 Where §1 could not be built as written (all settled)

1. **§1.2 lesson court row vs 0071.** "guest_id null" on a `hold` row failed
   `reservations_live_hold_has_guest` and would be expired on sight as an orphan. **Settled by R1 and
   R25** (§4.3.12, §4.5.2).
2. **§1.2 `guest_phone` "the phone format of `app.phone_canon`".** **Settled by R11**: `phone_digits`.
3. **§1.4 cancel sequence "lock_coach → courts → reservations → booking_payments".** **Settled by R6
   and R33**: cancels and the sweep take no court lock and no `FOR UPDATE` on `reservations`.
4. **§1.5 `coach_available`** counts the lesson being rescheduled against itself; reschedule uses
   `coach_in_hours` plus its own overlap test (this file, §4.6.2).
5. **§1.6 "Public by design".** **Settled by R12**.
6. **§1.10 `PRICE_VIA_PROTOCOL`, `LAUNCH_VIA_PROTOCOL` listed as new.** **Settled by R14** (reused).
7. **§1.4's walk of `lesson_settle_success` under `deposit_apply`.** **Settled by R33** (§5.1.3).
8. **§1.2 partial unique predicates.** **Settled by R22** (`<column> is not null`).
9. **§1.11 "the `mutations.ts` kind enum + 'lesson'".** **Settled by R13**: the enum stays.
10. **§1.5 names no refund call.** **Settled by R5 and R28**: `lesson_refund_start(p_enrolment_id,
    p_reason)`.
11. **C-20 grid** stated for private lessons. **Settled by R9**.
12. **§1.2 `coaches.bio_*` NOT NULL default `''`** has no SEC-20 route. **Settled by R22** (`empty`).
13. **`packages/db/CLAUDE.md` stale** (latest ordinal, error mapping). **Settled by R23**: fixed in
    the first commit.
14. **R25 against R33** (new in this pass): R25's hold-row statement is a `FOR UPDATE … SKIP
    LOCKED`, which R33's "no `FOR UPDATE` on `reservations` in a cancel, mark or sweep body" and the
    walker's Rules 1 and 3 would refuse. This file keeps R25's statement and teaches the walker that
    a `skip locked` lock on `reservations` never waits (D-25, §2.5 item 7). **The merge should
    confirm it.**
