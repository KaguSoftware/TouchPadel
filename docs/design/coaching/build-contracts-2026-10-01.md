# Coaching: build contracts

Date: 2026-10-01. Status: **design, approved by Parsa the same day; nothing built.** This file is
binding for every lane of the coaching build (Phase 2 milestone 5, change-order item 2). Where it
and the planning record disagree, this file wins. The planning record is
`~/.claude/plans/which-features-are-left-eventual-wigderson.md` (six rounds of questions, decisions
C-1…C-20).

It supersedes `PHASE-2-PLAN.md` §C2 (generic `event_participants`, `commission_rules` tables, the
undecided coach surface) and amends `docs/design/web-site/contracts-2026-09-23.md:25-27` ("not
prices", no coach names): see C-11.

Lane sections live beside this file: `db.md` (lane DB), `money.md` (lane Money), `guest.md` (lane
Guest: the phone's guest side, coach mode, the website, push and links), `operator.md` (lane
Operator). A lane section may add names; it lists them under "Additions to §1" and the merge folds
them back here.

## 0. The product and the decisions

### 0.1 In one paragraph

A manager makes an existing guest a **coach** (bio, photo, branches, the lesson types they teach).
The coach sets weekly hours and time off in **coach mode** on the phone. Guests book a **private
lesson** instantly on a 30-minute grid: only times when the coach is free and a court is free are
offered, and booking takes a court at the coach's branch automatically. Coaches and managers also
schedule **group sessions** (N places, each guest pays their own) and **courses** (a fixed run of
sessions, one sign-up). A lesson is paid at the desk on its own bill, or by Qi Card when the owner
switches online payment on. A session that has not reached its minimum by its cut-off is cancelled
and refunded. Every month the system drafts each coach's statement: 60 % of what was collected,
less a fixed court share per session. The branch manager approves it and marks it paid; the money
is handed over outside the till. Prices never come from a coach: the venue sets them, and every
price goes through the owner's price-or-promotion protocol. A `/coaching` page on the website shows
the coaches and the sessions with places left, with prices behind a switch.

### 0.2 Decisions

| # | Decision |
| --- | --- |
| C-1 | Three kinds. **Private**: one coach, the booker plus up to 3 friends (party 1..4), one slot, one price for the lesson. **Group session**: N places, each guest books and pays one place. **Course**: a fixed run of sessions, one sign-up, one price per person. |
| C-2 | Private lessons are booked **instantly** by guests. Offered times: the coach is available and at least one court is free. Booking takes a court and confirms. |
| C-3 | Paid **at the desk** by default; **Qi online** when the owner switches it on (the deposit hosted-page path, `booking_payments.purpose 'lesson'`). |
| C-4 | The **coach** sets weekly hours and time off in coach mode; a **manager can override** both in the operator. |
| C-5 | The **venue** sets prices per lesson type, with an optional **per-coach** price. Coaches never set prices. |
| C-6 | **Court share** = a fixed IQD amount per lesson type, per session. The coach earns `coach_share_bp` (60 %) × (collected − court share). |
| C-7 | A **manager promotes** an existing guest profile to coach in the operator. Only managers edit the coach's display name, bio (EN + AR) and photo. |
| C-8 | A coach **books for their own students** from coach mode: by name and phone, or name only for someone without the app. That student pays at the desk. |
| C-9 | Cancels follow **court-booking rules**: free outside the branch's `cancellation_window_hours`; a late cancel or a no-show keeps online money and records a strike. The coach is paid only on money collected. A coach cancel refunds and notifies everyone. |
| C-10 | The court is **any free court at the coach's branch**, chosen automatically. The desk can move a lesson to another court at the same time. |
| C-11 | Website: a **`/coaching` page** (EN + AR) with coach cards, lesson types and upcoming group sessions and courses with places left, and "Book in the app" (`/c/<coachId>`). **Prices show only when the branch's `lesson_prices_public` switch is on** (default off, until Mustafa agrees). The switch is presentation, not secrecy: the app shows prices to anyone. |
| C-12 | Statements are **drafted monthly** per coach per branch. The **branch manager** (or the owner) approves, then marks paid under a manager PIN with a payment reference (R4). |
| C-13 | Group sessions and courses are created by the **coach** (coach mode) **or a manager** (operator). Courts are taken at creation, one per session. |
| C-14 | Each lesson type has **`min_places`** and **`cutoff_hours`**. A group session or course below its minimum at the cut-off is cancelled (`under_filled`): courts released, online money refunded, everyone notified. |
| C-15 | A guest can **join a course late** and pays for the sessions not yet started (the course price split evenly over its sessions, largest remainder, summed over the remaining ones). Sign-up closes when the last session starts. |
| C-16 | A coach sees the **full name and phone of their own students**, for their own lessons only. |
| C-17 | Every lesson-type price, court share and per-coach price goes through the **price-or-promotion protocol** (owner approval). Drafts that were never launched are edited directly. |
| C-18 | Lesson money is part of **headline revenue as its own line** (`lessonRevenue`). The coach share is shown separately as **owed to coaches**. |
| C-19 | A course session can be **rescheduled, never dropped**. Cancelling the rest of a course refunds the remaining sessions' shares in one refund per payment. |
| C-20 | Private lessons start on a **30-minute grid** (`:00` and `:30` local time). |

### 0.2b Decisions from the review (Parsa, 2026-10-01, after `drafts/review-rules-privacy-2026-10-01.md` §7)

| # | Decision |
| --- | --- |
| C-21 | **A phone link is confirmed first.** When a coach or the desk types a phone that matches a verified account, that person's My lessons asks "A coach added you to a lesson. Is this you?". "Yes" links it; "Not me" unlinks it silently and the coach is never told. No reminder goes out before confirmation. Until then staff and the roster see the typed name and phone. |
| C-22 | **A coach accepts before going public.** On first opening coach mode the coach accepts "Your coach profile will be public on the app and the website". Until then the coach is not listed in any public read. |
| C-23 | **Leaving a running course** refunds the online shares of sessions that start outside the cancellation window (the reverse of C-15's pro-rata). The next session, if it is inside the window, is kept. "Late" is judged against the guest's own next covered session. |
| C-24 | **No court hoarding.** A coach cannot enrol in their own lesson. A coach holds at most 10 upcoming coach-booked private lessons (a branch setting). The desk tile shows "booked by the coach · unpaid", and coach-booked no-shows show on the statement detail. |
| C-25 | **Retiring a coach** cancels their upcoming lessons and courses as coach cancels (refunds, pushes) and is never refused. A retired coach sees their approved and paid statements only: no rosters, no phones. |
| C-26 | **Terms before online lesson money.** Online lesson payment cannot be switched on until the terms and privacy text carry a lessons section and that version is live. Desk-paid lessons can run before that. |
| C-27 | **Staff who coach** reach coach mode from a "Coach mode" row in the staff hub. |
| C-28 | **Coach pay never reaches an LLM.** Statements and per-coach money are excluded from the owner assistant and the analytics models (the `salary_deductions` precedent); aggregates stay readable. |
| C-29 | **A deleted coach's display name stays on their statements** (the venue's pay record); it never reaches a guest surface. |
| C-30 | **The Arabic word for a lesson is «حصة»** in every app (client review later). |
| C-31 | **A refund is counted on the day it is made**, for every kind of refund (café, court, lesson): day close, its summary and the online card date a refund by the till shift it was made in. Closed days keep their stored figures. |

### 0.3 Defaults (taken; Parsa may reverse any)

| # | Default |
| --- | --- |
| CD-1 | `lesson_payment_mode` per branch: `desk` (default), `online_optional`, `online_required`. Bookings made by a coach or the desk are always `desk`. |
| CD-2 | Strikes only for enrolments a guest booked themselves with an account. Coach- and desk-booked students and walk-ins never get strikes. A coach or staff cancel never strikes. |
| CD-3 | A coach sees a student's phone until 7 days after the lesson; after that the roster shows the name only. |
| CD-4 | Lessons are outside the tax base (like the court line) until the client names a tax group. |
| CD-5 | `coach_share_bp` (default 6000) is an owner-only branch setting, snapshotted on every lesson and course. |
| CD-6 | Every coaching write is online-only (no queued mutation type), like open matches (DF-11). |
| CD-7 | Reminders go out 3 hours before a lesson; the push carries no names and no amounts. |
| CD-8 | Walk-in names and typed phones on enrolments are purged 365 days after the lesson. |
| CD-9 | A coach can add at most 30 students a day (`lock_principal` cap), audited. |
| CD-10 | Coach hours are windows inside one local day (`end_time` may be `24:00`); a coach working past midnight adds a second window on the next day. |
| CD-11 | A no-show is marked by the coach or the desk, up to 24 hours after the lesson's start. |
| CD-12 | A deleted student's future enrolments are cancelled and online money refunded; a deleted coach is retired, their future lessons cancelled as coach cancels; statements are kept. |

## 1. Names (binding on every lane)

Nothing below may be renamed in a lane section. A lane that needs something new adds it in its own
section under "Additions to §1"; the merge folds it back here.

### 1.1 Migrations

Every file opens with `set lock_timeout = '3s'; set statement_timeout = '60s';`, re-issues functions
from their latest body (`grep -n "function app.<name>(" *.sql | tail -1`, both `create` and `create
or replace`), uses `$<name>_0NNN$` dollar tags with its real ordinal, and ships `types.gen.ts`, both
catalogs and every gate artifact it needs in the same commit. A CHECK or FK on an existing table is
`NOT VALID` plus a validate guarded on `conname` and `conrelid`. Check the directory before writing
each file: if the team has landed more, shift every ordinal up, keeping this order. Matrix rows go in
a new drop of `tests/rls-matrix.ts`.

| Ordinal | File | Owner lane | What |
| --- | --- | --- | --- |
| 0270 | `reservation_kind_lesson` | DB | `alter type reservation_kind add value if not exists 'lesson'`, alone |
| 0271 | `outbox_lesson_kinds` | Guest | CHECK widening only: `notification_outbox.kind` + `lesson_update`, `lesson_reminder`, `coach_update`. After `send-push` is deployed with the lesson keys (`deploy.yml` deploys it first) |
| 0272 | `booking_payments_lesson_checks` | Money | CHECK widening only: `purpose` + `'lesson'`; `refund_reason` + `'coach_cancel'`, `'under_filled'` |
| 0273 | `tabs_kind_lesson` | Money | CHECK widening only: `tabs_kind_chk` + `'lesson'` |
| 0274 | `coaching_settings` | DB | `venue_settings` columns (§1.2), `venue_settings_public` appended, `coaching_settings` / `set_coaching_settings` |
| 0275 | `coaching_tables` | DB + Money | every table of §1.2; the new columns on `reservations`, `tabs`, `booking_payments`; anchor and `reason_by_purpose` re-created; `zz_branch_guard` on the new tables and re-created on the three changed ones; RLS, grants, sanitiser and append-only triggers; the `menu-media/coaches/` storage policy |
| 0276 | `coaching_indexes` | DB | every index of §1.2, alone (`MIGRATION-RISK-ACCEPTED` in the commit message: new or empty tables, plus partial indexes on `reservations`, `tabs`, `booking_payments`) |
| 0277 | `lesson_reservation_guards` | DB | §1.8 reservation re-issues: firm counts, the trigger WHEN, `court_availability` mask, `close_branch`, the `LESSON_VIA_COACHING` refusals, `move_reservation` |
| 0278 | `lesson_money` | Money | `iqd_split`, `lesson_fee_remaining`, `lesson_enrolment_money`, `lesson_coach_share`, `compute_tab_totals` (drop + create), `settle_tab`, the no-goods guard, `cafe_settled_tabs`, `lesson_settle`, `lesson_refunds_due` |
| 0279 | `coaching_admin` | DB | `lock_coach`, `coach_self`, promote and edit coaches, branches, lesson types (direct for drafts), `_internal` price writers, hours, time off, `coaches_admin` |
| 0280 | `lesson_booking` | DB + Guest | `coach_slots`, every booking, joining, adding, cancelling, rescheduling, attendance and roster RPC of §1.6 and §1.7, `coaching_public`, `coach_profile`, `lesson_offer`, `my_lessons`, `my_lesson`, `desk_lessons`, `desk_lesson_detail`, `customer_lessons`; Guest's `lesson_notify` and `lesson_sync_reminders` |
| 0281 | `lesson_online_payment` | Money | `lesson_payment_prepare`, `lesson_settle_success`, the lesson branch in `deposit_apply`, `deposit_status`, `deposit_refund_apply`, `deposits_due_for_reconcile`, `deposit_attention`; the edge function `lesson-begin` ships in the same commit |
| 0282 | `price_promo_lessons` | DB | the six protocol hook re-issues (§1.8) |
| 0283 | `lesson_sweep` | DB | `lesson_strike_record`, `hold_strikes_settle` re-issued to settle lesson strikes, `lesson_sweep`, cron `tp_lesson_sweep` |
| 0284 | `coach_statements` | Money | statement draft, refresh, approve, mark paid, void, reads; cron `tp_coach_statements` |
| 0285 | `lesson_reports` | Money | `lesson_money_figures`, `reports_figures` + `panel_headline` keys, `report_revenue`, `report_courts` lessons block, `analytics_courts_summary` lesson minutes, `day_close_online`, `report_lessons` |
| 0286 | `lesson_account_deletion` | DB | `delete_my_account` re-issued once, from 0264 |

### 1.2 Tables and columns

All branch tables: `venue_id uuid not null references venues`, the `zz_branch_guard` trigger with the
link pairs named, RLS on, **no policy and no client grant** (`revoke all … from anon, authenticated`;
`grant all … to service_role`). Every read and write goes through a definer RPC. Guest-typed and
staff-typed free text gets the `safe_line` sanitiser trigger and a length CHECK. Money is `iqd`
(`bigint` with a named `>= 0` CHECK added NOT VALID where a domain column would rewrite a hot table).

**`coaches`** (chain-wide, no `venue_id`, no guard). `id uuid pk`, `profile_id uuid not null unique
→ profiles`, `display_name_en`, `display_name_ar` (1..60), `bio_en`, `bio_ar` (0..1000, default
`''`), `photo_path` (null, or `^coaches/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$` in the `menu-media`
bucket), `status` (§1.3), `sort_order int not null default 0`, `created_by_staff_id → staff`,
`created_at`, `updated_at`, `retired_at`. The profile name is never public; the display names are.

**`coach_branches`** (branch). `coach_id → coaches`, `venue_id`, `active boolean not null default
true`, `created_at`. Primary key `(coach_id, venue_id)`. Guard `('scoped')`.

**`coach_time_off`** (chain-wide). `id`, `coach_id`, `period tstzrange not null`, `reason` (0..200),
`set_by` (`coach`|`staff`), `set_by_staff_id`, `created_at`, `cancelled_at`. Exclusion
`coach_time_off_no_overlap (coach_id with =, period with &&) where (cancelled_at is null)`.

**`coach_hours`** (branch). `id`, `coach_id`, `venue_id`, `weekday smallint` (0..6, Sunday = 0, as
`extract(dow …)` in the branch time zone), `start_time time`, `end_time time` (`start_time <
end_time`, `end_time <= '24:00'`), `set_by` (`coach`|`staff`), `set_by_staff_id`, `updated_at`.
Overlaps between a coach's windows on the same weekday, at any branch, are refused by the writers
(`HOURS_OVERLAP`). Guard `('scoped')`.

**`lesson_types`** (branch). `id`, `venue_id`, `kind` (§1.3), `name_en`, `name_ar` (1..60),
`description_en`, `description_ar` (0..500, default `''`), `duration_min` (30..240, multiple of 30),
`price_iqd iqd null` (private: the whole lesson; group: one place; course: the whole course for one
person), `court_share_iqd iqd not null default 0` (per session), `max_places smallint` (private:
largest party 1..4; group and course: 2..16), `min_places smallint` (1..`max_places`; private: 1),
`cutoff_hours smallint not null default 0` (0..168; private: 0), `sessions_count smallint null` (set
iff course, 2..52), `is_active boolean not null default false`, `launched_at timestamptz null`,
`sort_order int not null default 0`, `created_by_staff_id`, `created_at`, `updated_at`. CHECKs:
`price_iqd is not null or launched_at is null`; `is_active` implies `launched_at is not null`.

**`coach_lesson_types`** (branch). `coach_id`, `lesson_type_id`, `venue_id`, `created_at`. Primary
key `(coach_id, lesson_type_id)`. Guard links `lesson_types/lesson_type_id`.

**`coach_prices`** (branch). `coach_id`, `lesson_type_id`, `venue_id`, `price_iqd iqd not null`
(> 0), `set_at`, `protocol_run_id → protocol_runs` (null only for an owner's direct write). Primary
key `(coach_id, lesson_type_id)`. Guard links `lesson_types/lesson_type_id`,
`protocol_runs/protocol_run_id`. Written only by `set_coach_price_internal`.

**`courses`** (branch). `id`, `venue_id`, `coach_id`, `lesson_type_id`, `title_en`, `title_ar`
(0..80, default `''`), snapshots `price_iqd`, `court_share_iqd`, `coach_share_bp`, `sessions_count`,
`max_places`, `min_places`, `cutoff_at`, `signup_closes_at` (= the last session's start), `status`
(§1.3), `cancel_reason`, `created_by_kind` (`coach`|`staff`), `created_by_profile_id`,
`created_by_staff_id`, `idempotency_key text unique`, `created_at`, `updated_at`, `cancelled_at`.
Guard links `lesson_types/lesson_type_id`.

**`lessons`** (branch; one session on one court). `id`, `venue_id`, `coach_id`, `lesson_type_id`,
`kind` (snapshot of the type's kind), `course_id → courses` and `session_no smallint` (both set iff
`kind = 'course'`), `start_at`, `end_at`, `period` (generated `tstzrange [)`), snapshots `price_iqd`
(null for a course session), `court_share_iqd`, `coach_share_bp`, `max_places`, `min_places`,
`cutoff_at` (null for private), `status` (§1.3), `hold_expires_at` (set iff `held`),
`booked_by_kind` (`guest`|`coach`|`staff`), `created_by_profile_id`, `created_by_staff_id`,
`cancel_reason` (§1.3), `cancelled_at`, `completed_at`, `idempotency_key text unique`, `created_at`,
`updated_at`. **`lessons_coach_no_overlap EXCLUDE USING gist (coach_id WITH =, period WITH &&)
WHERE (status in ('held','scheduled'))`**. Guard links `lesson_types/lesson_type_id`,
`courses/course_id`.

**`lesson_enrolments`** (branch). `id`, `venue_id`, `lesson_id → lessons`, `course_id → courses`
(exactly one: `num_nonnulls(lesson_id, course_id) = 1`), `guest_id → profiles` (null for a walk-in),
`guest_name` (1..80; required when `guest_id` is null), `guest_phone` (null or the phone format of
`app.phone_canon`; typed by a coach or the desk, never linked by it alone), `party_size smallint not
null default 1` (private: 1..4; otherwise 1), `friend_names text[] not null default '{}'` (private
only, ≤ 3 entries, each 1..40), `booked_by_kind` (`guest`|`coach`|`staff`), `booked_by_profile_id`,
`booked_by_staff_id`, `price_iqd iqd not null` (snapshot; pro-rata for a late course join),
`first_session_no smallint` and `sessions_covered smallint` (both set iff a course enrolment),
`payment_mode` (`desk`|`online`), `status` (§1.3), `hold_expires_at` (set iff `held`),
`cancel_kind` (§1.3), `cancelled_at`, `idempotency_key text unique`, `created_at`, `updated_at`.
Guard links `lessons/lesson_id`, `courses/course_id`. Sanitiser on `guest_name`, `guest_phone`,
`friend_names`.

**`lesson_attendance`** (branch). `lesson_id`, `enrolment_id`, `venue_id`, `status`
(`attended`|`no_show`), `marked_by_kind` (`coach`|`staff`), `marked_by_profile_id`,
`marked_by_staff_id`, `marked_at`. Primary key `(lesson_id, enrolment_id)`. Guard links
`lessons/lesson_id`, `lesson_enrolments/enrolment_id`.

**`lesson_strikes`** (branch; the strike ledger, settled later by `hold_strikes_settle`).
`enrolment_id`, `lesson_id`, `venue_id`, `guest_id`, `kind` (`late_cancel`|`no_show`),
`struck_at`, `settled_at`, `counted boolean`. Primary key `(enrolment_id, lesson_id)`.

**`lesson_events`** (branch, append-only via `app.forbid_mutation()`). `id bigint identity`,
`venue_id`, `lesson_id`, `course_id`, `enrolment_id`, `type` (§1.3), `actor`
(`guest`|`coach`|`staff`|`system`), `actor_profile_id`, `actor_staff_id`, `code` (≤ 40), `data
jsonb` (ids and counts only, never names or phones), `at`.

**`coach_statements`** (branch). `id`, `coach_id`, `venue_id`, `month date` (the first of the month,
branch local), `status` (§1.3), `lessons_count int`, `collected_iqd`, `court_share_iqd`,
`coach_iqd`, `adjustments_iqd bigint` (signed), `drafted_at`, `refreshed_at`, `approved_by → staff`,
`approved_at`, `paid_by → staff`, `paid_at`, `paid_reference` (1..80, required when `paid`),
`voided_by`, `voided_at`, `void_reason`. Unique `(coach_id, venue_id, month) where status <>
'void'`.

**`coach_statement_lines`** (branch). `id`, `statement_id`, `venue_id`, `lesson_id`,
`collected_iqd`, `court_share_iqd`, `share_bp`, `coach_iqd`, `is_adjustment boolean`,
`created_at`. Rows of an `approved` or `paid` statement are immutable (trigger
`coach_statement_lines_frozen`).

**Changed tables.**

- `reservations.lesson_id uuid null → lessons` (FK NOT VALID + validate). CHECKs
  `reservations_lesson_link` (`kind <> 'lesson' or lesson_id is not null`) and
  `reservations_lesson_kind` (`lesson_id is null or kind in ('lesson','hold')`). A lesson's court row
  has `guest_id` null and `guest_name` exactly `'Lesson'`. A private lesson paid online holds its
  court with a `hold` row that carries `lesson_id`; success turns it into `kind 'lesson'`,
  `status 'confirmed'`. Unique partial index `reservations_one_live_per_lesson (lesson_id) where
  status in ('pending','confirmed','arrived')`.
- `tabs.kind` + `'lesson'`; `tabs.lesson_enrolment_id uuid null → lesson_enrolments`;
  `tabs.lesson_iqd bigint not null default 0` (CHECK `>= 0`, NOT VALID + validate). CHECK
  `tabs_lesson_shape`: `kind = 'lesson'` iff `lesson_enrolment_id is not null`, and a lesson tab has
  no `reservation_id` and no `table_id`. Unique partial index `tabs_one_live_per_enrolment
  (lesson_enrolment_id) where status in ('open','awaiting_payment')`.
- `booking_payments.purpose` + `'lesson'`; `refund_reason` + `'coach_cancel'`, `'under_filled'`;
  `booking_payments.lesson_enrolment_id uuid null → lesson_enrolments`. `booking_payments_anchor`
  re-created: lesson ⇒ `venue_id` and `lesson_enrolment_id` set, `ticket_count` null, `hold_id` set
  only for a private lesson's court hold; deposit and ticket shapes unchanged.
  `booking_payments_reason_by_purpose` gains the lesson set (`money.md`). Unique partial index
  `booking_payments_one_active_lesson (lesson_enrolment_id) where purpose = 'lesson' and status in
  ('created','pending')`.
- `venue_settings`: `coaching_enabled boolean not null default false`, `lesson_payment_mode text not
  null default 'desk'` (CD-1), `coach_share_bp int not null default 6000` (0..10000),
  `lesson_prices_public boolean not null default false`. Named CHECK `venue_settings_coaching_rules`.
  `venue_settings_public` appends `coaching_enabled`, `lesson_payment_mode`,
  `lesson_prices_public` (never `coach_share_bp`).
- `notification_outbox.kind` + `lesson_update`, `lesson_reminder`, `coach_update`.

### 1.3 Status vocabularies

| Column | Values |
| --- | --- |
| `coaches.status` | `active`, `paused` (not bookable, keeps lessons), `retired` |
| `lesson_types.kind`, `lessons.kind` | `private`, `group`, `course` |
| `courses.status` | `open` (before the first session), `running`, `completed`, `cancelled` |
| `lessons.status` | `held` (a private lesson awaiting its Qi payment), `scheduled`, `completed`, `cancelled`, `expired` |
| `lessons.cancel_reason`, `courses.cancel_reason` | `guest_cancel`, `coach_cancel`, `staff_cancel`, `under_filled`, `payment_expired`, `account_deleted`, `coach_retired` |
| `lesson_enrolments.status` | `held` (awaiting Qi), `booked`, `cancelled`, `expired` |
| `lesson_enrolments.cancel_kind` | `guest_free`, `guest_late`, `coach`, `staff`, `under_filled`, `expired`, `account_deleted`, `course_cancelled` |
| `lesson_attendance.status` | `attended`, `no_show` |
| `lesson_events.type` | `booked`, `held`, `paid_online`, `expired`, `joined`, `added`, `cancelled`, `enrolment_cancelled`, `rescheduled`, `court_moved`, `under_filled`, `completed`, `attended`, `no_show`, `unmarked`, `settled`, `refunded` |
| `coach_statements.status` | `draft`, `approved`, `paid`, `void` |
| desk and coach cancel reasons | `customer_request`, `coach_unavailable`, `court_needed`, `staff_error`, `duplicate`, `other`, sent as `<code>` or `<code>: <note>` |

### 1.4 Locks (the order `check-lock-order.mjs` enforces; `ORDER` gains one entry)

```text
day_sessions
  → match_money_advisory
  → coach_advisory (app.lock_coach(coach): 'app.coaches:'||id)
  → tabs → orders → order_items → tickets → payments → till_shifts → refunds → stock_batches
  → court_advisory (every active court of the branch, id order; app.lock_court)
  → reservations
  → match_venue_advisory → match_tickets
```

- `lock_coach` is hashed as 0042 does (`pg_advisory_xact_lock(hashtextextended(key, 0))`), added to
  `ADVISORY` and `ONCE_PER_SEQUENCE` (no path takes two coaches' locks; a lesson's coach never
  changes). The walker also walks the service-role functions `lesson_sweep`,
  `lesson_settle_success`, `coach_statements_draft`.
- `lessons`, `courses`, `lesson_enrolments`, `lesson_attendance`, `coach_statements` are never
  locked FOR UPDATE outside the coach lock; the coach mutex serialises every change to them.
  They stay out of `ORDER`, like `booking_payments`.
- Sequences: booking `lock_principal → hold standing → lock_coach → every active court of the branch
  in id order (lazy hold expiry per court) → reservations`; desk settle `day_sessions → lock_coach →
  tabs → payments → till_shifts`; cancel `lock_coach → courts → reservations → booking_payments`.
- **No strike is applied inside a coach or court lock** (the 0268 deadlock). Lesson paths write a
  `lesson_strikes` row; `hold_strikes_settle` applies it under the principal lock, oldest first.

### 1.5 Internal functions (revoked from public, anon, authenticated; by file)

- **0274 (DB):** `coaching_rules(uuid) returns jsonb` (the branch's coaching settings, for readers).
- **0275 (DB):** `trg_sanitise_lesson_enrolment()`, `trg_sanitise_coach()`,
  `trg_coach_statement_lines_frozen()`.
- **0278 (Money):** `iqd_split(bigint, int) returns bigint[]` (twin of `@touch/core`
  `splitEvenly`; R2), `lesson_fee_remaining(uuid, uuid) returns bigint` (enrolment, tab),
  `lesson_enrolment_money(uuid) returns jsonb` (owed, desk, online, refunded, kept),
  `lesson_coach_share(bigint, bigint, int) returns bigint`, `course_share_for(uuid, int) returns
  bigint` (enrolment, session_no).
- **0279 (DB):** `lock_coach(uuid)`, `coach_self(boolean default true) returns coaches` (raises
  `NOT_A_COACH` when the flag is true, else returns null), `coach_available(uuid, uuid, tstzrange)
  returns boolean` (coach, branch, period: hours, time off, no other live lesson),
  `upsert_lesson_type_internal(uuid, uuid, jsonb) returns lesson_types`,
  `set_coach_price_internal(uuid, uuid, bigint, uuid) returns void`,
  `lesson_price_for(uuid, uuid) returns bigint` (coach, type: `coalesce(coach price, type price)`).
- **0280 (DB + Guest):** `lesson_guest(boolean) returns profiles`, `lesson_lock_branch_courts(uuid)`, `lesson_pick_court(uuid, tstzrange)
  returns uuid`, `lesson_places_taken(uuid) returns int`, `course_places_taken(uuid) returns int`,
  `lesson_create_internal(…) returns lessons`, `lesson_cancel_internal(uuid, text, text, uuid, uuid)
  returns jsonb`, `enrolment_cancel_internal(uuid, text, text, uuid, uuid) returns jsonb`,
  `lesson_event(…)`; Guest: `lesson_notify(uuid, text, text, jsonb) returns int`,
  `lesson_sync_reminders(uuid) returns void`.
- **0281 (Money):** `lesson_payment_prepare(uuid, uuid, text, text) returns jsonb` (R3),
  `lesson_settle_success(uuid) returns text`.
- **0283 (DB):** `lesson_strike_record(uuid, uuid, text) returns void`, `lesson_sweep() returns
  jsonb`.
- **0284 (Money):** `coach_statement_build(uuid, uuid, date) returns uuid`,
  `coach_statements_draft(date default null) returns int`.
- **0285 (Money):** `lesson_money_figures(timestamptz, timestamptz, uuid[]) returns jsonb`.

### 1.6 Guest and coach RPCs (`authenticated` unless marked; first statement is the guard)

Public by design (`anon` + `authenticated`, allowlisted with a reason; return `[]`/`{off:true}`
while `coaching_enabled` is false at the branch; never a student, phone or count of people by name):

- `coaching_public(p_venue_id uuid default null) returns jsonb` — coaches, lesson types with prices
  and `prices_public`, upcoming group sessions and courses with places left, for one open branch or
  every open branch.
- `coach_profile(p_coach_id uuid, p_venue_id uuid) returns jsonb`.
- `coach_slots(p_coach_id uuid, p_lesson_type_id uuid, p_from timestamptz, p_to timestamptz) returns
  jsonb` — 30-minute starts, `p_to - p_from ≤ 14 days`; no court ids, names or money.
- `lesson_offer(p_lesson_id uuid default null, p_course_id uuid default null) returns jsonb` — a
  group session or course: times, places left, the caller's price (pro-rata for a late course join).

Guest (first statement `app.lesson_guest(p_act boolean)`, the coaching twin of `app.match_guest`
(0260:245): `AUTH_REQUIRED`, `ACCOUNT_REQUIRED`; with `p_act` also `PHONE_REQUIRED` and
`TERMS_REQUIRED`):

- `lesson_book_private(p_coach_id uuid, p_lesson_type_id uuid, p_start_at timestamptz,
  p_party_size int, p_friend_names text[], p_payment_mode text, p_expected_price_iqd bigint,
  p_idempotency_key text) returns jsonb`
- `lesson_join(p_lesson_id uuid, p_payment_mode text, p_expected_price_iqd bigint,
  p_idempotency_key text) returns jsonb`
- `course_join(p_course_id uuid, p_payment_mode text, p_expected_price_iqd bigint,
  p_idempotency_key text) returns jsonb`
- `lesson_cancel_mine(p_enrolment_id uuid) returns jsonb`
- `my_lessons(p_scope text default 'upcoming') returns jsonb` (`upcoming` | `past` | `cancelled`)
- `my_lesson(p_enrolment_id uuid) returns jsonb`

Coach (first statement `app.coach_self()`; every row read or written is the caller's own):

- `coach_me() returns jsonb` (never raises; `{coach: null}` for a non-coach)
- `coach_schedule(p_from timestamptz, p_to timestamptz) returns jsonb`
- `coach_hours_mine() returns jsonb`; `set_my_coach_hours(p_venue_id uuid, p_windows jsonb) returns
  jsonb`
- `add_my_time_off(p_starts_at timestamptz, p_ends_at timestamptz, p_reason text) returns jsonb`;
  `cancel_my_time_off(p_id uuid) returns jsonb`
- `coach_lesson(p_lesson_id uuid) returns jsonb` (roster, C-16, CD-3)
- `coach_book_private(p_lesson_type_id uuid, p_venue_id uuid, p_start_at timestamptz,
  p_student_name text, p_student_phone text, p_party_size int, p_idempotency_key text) returns
  jsonb`
- `coach_create_group(p_lesson_type_id uuid, p_venue_id uuid, p_start_at timestamptz,
  p_idempotency_key text) returns jsonb`
- `coach_create_course(p_lesson_type_id uuid, p_venue_id uuid, p_starts timestamptz[], p_title_en
  text, p_title_ar text, p_idempotency_key text) returns jsonb`
- `coach_add_student(p_lesson_id uuid, p_course_id uuid, p_name text, p_phone text,
  p_idempotency_key text) returns jsonb` (C-8, CD-9; never reveals whether the phone matched)
- `coach_remove_student(p_enrolment_id uuid, p_reason text) returns jsonb`
- `coach_mark_attendance(p_lesson_id uuid, p_enrolment_id uuid, p_status text) returns jsonb`
  (`attended` | `no_show` | `clear`)
- `coach_cancel_lesson(p_lesson_id uuid, p_reason text) returns jsonb`;
  `coach_cancel_course(p_course_id uuid, p_reason text) returns jsonb`
- `coach_reschedule_session(p_lesson_id uuid, p_start_at timestamptz) returns jsonb` (C-19)
- `my_coach_statements(p_month date default null) returns jsonb`

### 1.7 Staff RPCs (`authenticated` + role guard; branch via `is_staff_at`)

| RPC | Roles |
| --- | --- |
| `coaching_settings(p_venue_id)` / `set_coaching_settings(p_venue_id, p_patch jsonb)` | read manager, owner / write owner |
| `coaches_admin(p_venue_id)` | manager, owner |
| `coach_promote(p_profile_id, p_display_name_en, p_display_name_ar, p_bio_en, p_bio_ar, p_photo_path, p_venue_ids uuid[])` | manager, owner |
| `coach_update(p_coach_id, p_patch jsonb)`, `set_coach_status(p_coach_id, p_status, p_reason)`, `set_coach_branches(p_coach_id, p_venue_ids uuid[])`, `set_coach_lesson_types(p_coach_id, p_venue_id, p_lesson_type_ids uuid[])` | manager, owner |
| `upsert_lesson_type(p_venue_id, p_id, p_patch jsonb)` (drafts and non-price fields; `PRICE_VIA_PROTOCOL` / `LAUNCH_VIA_PROTOCOL` for a manager), `set_coach_price(p_coach_id, p_lesson_type_id, p_price_iqd)` (owner only; managers use the protocol) | manager, owner |
| `set_coach_hours(p_coach_id, p_venue_id, p_windows jsonb)`, `add_coach_time_off(p_coach_id, p_starts_at, p_ends_at, p_reason)`, `cancel_coach_time_off(p_id)` | manager, owner |
| `desk_lessons(p_venue_id, p_from, p_to)`, `desk_lesson_detail(p_lesson_id)`, `customer_lessons(p_customer_id)` | cashier, court_desk, manager, owner |
| `desk_book_lesson(p_coach_id, p_lesson_type_id, p_start_at, p_customer_id, p_name, p_phone, p_party_size, p_idempotency_key)`, `desk_create_group(p_coach_id, p_lesson_type_id, p_start_at, p_idempotency_key)`, `desk_create_course(p_coach_id, p_lesson_type_id, p_starts timestamptz[], p_title_en, p_title_ar, p_idempotency_key)`, `desk_add_student(p_lesson_id, p_course_id, p_customer_id, p_name, p_phone, p_idempotency_key)` | court_desk, manager, owner |
| `desk_cancel_enrolment(p_enrolment_id, p_reason)`, `desk_cancel_lesson(p_lesson_id, p_reason)`, `desk_cancel_course(p_course_id, p_reason)`, `desk_reschedule_session(p_lesson_id, p_start_at)`, `desk_move_lesson_court(p_lesson_id, p_court_id)`, `desk_mark_attendance(p_lesson_id, p_enrolment_id, p_status)` | court_desk, manager, owner |
| `lesson_settle(p_enrolment_id, p_method, p_expected_owed_iqd, p_tendered_iqd, p_idempotency_key, p_device_id)` | cashier, court_desk, manager, owner |
| `lesson_refunds_due(p_venue_id)` | manager, owner |
| `report_coach_statements(p_month date)` (report scope: "All branches"), `coach_statement_detail(p_statement_id)` | manager, owner |
| `coach_statement_refresh(p_statement_id)`, `coach_statement_approve(p_statement_id)`, `coach_statement_void(p_statement_id, p_reason)` | manager, owner |
| `coach_statement_mark_paid(p_statement_id, p_reference, p_pin, p_device_id)` (manager PIN, added to every `PIN_GATED_RPCS` copy; R4) | manager, owner |
| `report_lessons(p_from, p_to)` | manager, owner |

### 1.8 Re-issued functions (one owner each; each re-issued once, from its latest body)

- **0277 (DB):** `match_court_free_firm`, `match_quote`, `desk_open_matches`,
  `desk_match_detail` (count `lesson` as firm); trigger `reservations_match` re-created with `WHEN
  (new.kind in ('booking','maintenance','lesson'))`; view `court_availability` (a lesson shows as
  `booking`); `close_branch` (refuses live lessons and courses: `BRANCH_HAS_BOOKINGS`);
  `cancel_reservation`, `mark_reservation`, `extend_reservation`, `staff_create_reservation`
  (`p_kind 'lesson'`), `open_tab` (a lesson reservation) raise `LESSON_VIA_COACHING`;
  `move_reservation` lets a lesson change court only, at the same times and branch.
- **0278 (Money):** `compute_tab_totals` (drop + create with `lesson_iqd`), `settle_tab` (stamps
  `lesson_iqd`), `trg_match_booking_no_cafe` (also `LESSON_TAB_NO_GOODS`), `cafe_settled_tabs`
  (leaves lesson tabs out).
- **0281 (Money):** `deposit_apply`, `deposit_status`, `deposit_refund_apply`,
  `deposits_due_for_reconcile`, `deposit_attention`.
- **0282 (DB):** `protocol_check_price_promo_propose` (0195:308), `protocol_check_price_promo_numbers`
  (0177:2526), `price_promo_check_targets` (0195:506), `price_promo_apply_internal` (0195:647),
  `price_promo_targets` (0177:2747), `price_promo_numbers` (0195:850): change kinds
  `lesson_price`, `lesson_launch`, `coach_price` (managers only, like `shop_launch`).
- **0283 (DB):** `hold_strikes_settle` (also settles `lesson_strikes`).
- **0285 (Money):** `reports_figures`, `panel_headline`, `report_revenue`, `report_courts`,
  `analytics_courts_summary`, `day_close_online`.
- **0286 (DB):** `delete_my_account` (from 0264:56).

### 1.9 Push family (guest, templated; `_shared/guest-push.json`)

A coach is a guest, so coach pushes ride the guest family. Queued only by `app.lesson_notify`
(whose `c_keys` copy is pinned by a test against the JSON). Params carry ids, times and counts only.

| Kind | Title keys | Route (phone) |
| --- | --- | --- |
| `lesson_update` | `lesson.booked`, `lesson.cancelled_by_coach`, `lesson.cancelled_by_staff`, `lesson.under_filled`, `lesson.rescheduled`, `lesson.court_moved`, `lesson.payment_expired`, `lesson.added_by_coach` | `lesson` → `/lesson/<enrolmentId>` |
| `lesson_reminder` | `lesson.reminder` | `lesson` |
| `coach_update` | `coach.new_student`, `coach.student_cancelled`, `coach.lesson_cancelled_by_staff`, `coach.under_filled`, `coach.statement_ready`, `coach.statement_paid` | `coach_lesson` → `/coach-mode-lesson?id=` ; `coach_statements` → `/coach-mode-statements` |

### 1.10 Error codes (every one in the `@touch/i18n` error catalogue, EN + AR)

New: `COACHING_OFF`, `NOT_A_COACH`, `ALREADY_COACH`, `COACH_NOT_FOUND`, `COACH_INACTIVE`,
`COACH_NOT_AT_BRANCH`, `LESSON_TYPE_NOT_FOUND`, `LESSON_TYPE_INACTIVE`, `LESSON_TYPE_NOT_OFFERED`,
`COACH_UNAVAILABLE`, `COACH_BUSY`, `NO_COURT_FREE`, `SLOT_NOT_ON_GRID`, `PARTY_TOO_LARGE`,
`LESSON_FULL`, `LESSON_CLOSED`, `ALREADY_ENROLLED`, `LESSON_NOT_FOUND`, `ENROLMENT_NOT_FOUND`,
`LESSON_NOT_CANCELLABLE`, `LESSON_VIA_COACHING`, `LESSON_OWED_CHANGED`, `LESSON_NOT_PAYABLE`,
`LESSON_TAB_NO_GOODS`, `ONLINE_PAYMENT_REQUIRED`, `ONLINE_PAYMENT_OFF`, `HOURS_INVALID`, `HOURS_OVERLAP`, `TIME_OFF_HAS_LESSONS`,
`COURSE_STARTS_INVALID`, `SESSION_NOT_MOVABLE`, `COACH_ADD_LIMIT`, `STATEMENT_NOT_DRAFT`,
`STATEMENT_NOT_APPROVED`, `STATEMENT_REFERENCE_REQUIRED`.

Reused: `AUTH_REQUIRED`, `ACCOUNT_REQUIRED`, `PHONE_REQUIRED`, `TERMS_REQUIRED` (as open matches
use it), `BOOKING_SUSPENDED`, `HOLD_COOLDOWN`, `FORBIDDEN`, `VENUE_MISMATCH`, `VENUE_CLOSED`,
`SLOT_IN_PAST`, `BEYOND_HORIZON`, `PRICE_CHANGED`, `PIN_GRANT_REQUIRED`, `BRANCH_HAS_BOOKINGS`,
`INVALID_TRANSITION`, `RECORD_INVALID`, `NOT_STEP_ACTOR`, `PRICE_TARGET_CHANGED`,
`PRICE_VIA_PROTOCOL`, `LAUNCH_VIA_PROTOCOL` (copy widened for lessons), `DEGRADED_LOCKOUT`,
`IDEMPOTENCY_CONFLICT`, `INVALID_ARGUMENT`, `SLOT_TAKEN`, and the deposit edge codes (R14).

### 1.11 Client names

- **Mobile routes** (flat files; `apps/mobile/CLAUDE.md`): guest `app/coaches.tsx`,
  `app/coach/[id].tsx`, `app/classes.tsx`, `app/class/[id].tsx` (`?kind=session|course`),
  `app/lesson-review.tsx`, `app/lesson/[id].tsx` (an enrolment); coach mode `app/coach-mode.tsx`,
  `app/coach-mode-hours.tsx`, `app/coach-mode-lesson.tsx` (`?id=`), `app/coach-mode-new.tsx`,
  `app/coach-mode-book.tsx`, `app/coach-mode-statements.tsx`. Deep link `/c/<coachId>` (and
  `/en/c/`, `/ar/c/`, `touchpadel://c/`) folds onto `app/coach/[id].tsx`.
- **Mobile code:** `src/features/coaching/` (guest) and `src/features/coach/` (coach mode:
  `CoachStatusProvider`, `RequireCoach`, `status.ts`, `gate.ts`); key families `coachingKeys`
  (`['coaching', …]`) and `coachKeys` (`['coach', …]`), both kept off disk; a `lessonIntentKey` in
  `lib/idempotency.ts`; `PaymentPurpose` + `'lesson'`; `coachingEnabled()` beside
  `matchesEnabled()`.
- **Operator routes:** `/admin/coaches` (tabs `coaches`, `types`, `hours` as a search param),
  `/desk/lessons/$id` (inherits `/desk`), `/reports/coaches` (statements). Capabilities
  `runLessons`, `takeLessonPayment`, `manageCoaches`, `settleCoaches`. Query family `QK.coaching`.
  Tone token `--tp-lesson` / `--tp-lesson-soft` with blue-mode values.
- **Web:** `app/[locale]/coaching/page.tsx`, `app/[locale]/c/[id]/page.tsx` (the "Open in the app"
  fallback), `src/lib/coaching.server.ts`, `src/lib/site/coachLink.ts`; `LINK_PATHS` + `/c/*`,
  `/en/c/*`, `/ar/c/*`.
- **Edge:** `lesson-begin` (copy of `ticket-begin`; `verify-jwt.json` + `config.toml` entries).
- **Core:** `packages/core/src/coaching/` (`statement.ts`: `lessonCoachShare`,
  `allocateCourseMoney`, `courseLateJoinPrice`; `grid.ts`: the 30-minute start rule);
  `slotGrid.ts` maps `lesson` to `booked`. The queued-payload enum in `mutations.ts` does **not**
  gain `'lesson'` (R13).
- **Strings:** mobile `catalogs/coaching.{en,ar}.ts` assembling `coaching.{common,guest,coach}`;
  operator `catalogs/ws/coaching.{en,ar}.ts` assembling `coachingDesk`, `coachingAdmin`,
  `coachingMoney`, plus `opErrors.coaching`; web `catalogs/coaching.web.{en,ar}.ts`; push copy in
  `send-push/guestStrings.ts`. Arabic marked DRAFT-AR for the client.

### 1.12 Merge rulings (2026-10-01; they amend §1.1–§1.11 and win over any lane section)

Folded from the four lane sections' "Additions to §1" and their contradiction lists. The additions
each lane listed (`db.md` §10.1, `money.md` §14, `guest.md` §4.20, `operator.md` "Additions to §1")
are accepted as written unless a ruling below changes them.

| # | Ruling |
| --- | --- |
| R1 | **Online lesson holds.** A private lesson paid online holds its court with a `hold` row that has `guest_id` NULL and `lesson_id` set. 0275 widens `reservations_live_hold_has_guest` (0071:54-60) to accept `lesson_id is not null` in place of a guest. 0277 re-issues `expire_stale_holds` (0268:33) and `match_expire_holds` (0260) so their orphan clause skips rows with a `lesson_id`. A lapsed lesson hold is expired only by Money's `lesson_hold_expire` (0281), called by `lesson_sweep`. Until the sweep runs (at most a minute) that court shows free but refuses a booking with `SLOT_TAKEN`; this is accepted and listed under §6.3. |
| R2 | **Name clash.** `app.split_evenly(uuid, int)` is the till's Split bill RPC (0015:768). The internal money splitter is **`app.iqd_split(bigint, int) returns bigint[]`**, the twin of `@touch/core` `splitEvenly`. No overload is added. |
| R3 | **`lesson_payment_prepare(p_guest_id uuid, p_enrolment_id uuid, p_locale text, p_provider text) returns jsonb`**, the shape of its two sibling prepare functions (`money.md`). |
| R4 | **`coach_statement_mark_paid(p_statement_id uuid, p_reference text, p_pin text, p_device_id text)`**: the PIN transports need a string `p_pin` (as `match_seat_write_off`). It joins every `PIN_GATED_RPCS` copy. **C-12 reads: the PIN is asked when marking paid, not when approving.** |
| R5 | **Refunds started by a cancel.** DB's cancel internals call Money's **`app.lesson_refund_start(p_enrolment_id uuid, p_reason text, p_from_session smallint default null) returns int`** (refunds started). It replaces `money.md`'s `lesson_refund_online`. Money owns it in 0278. |
| R6 | **Locks.** `lock_coach` and `try_lock_coach` are created in **0275** (not 0279), and the `lock-order.mjs` edit lands in the 0275 commit, because 0278 calls them. Cancels, removals, attendance marks and the sweep take **no court lock** (`db.md` §2): they write reservations' status only and join `STATUS_ONLY_RESERVATION_WRITERS`. That keeps the declared order and keeps the multi-coach sweep deadlock-free. §1.4's "cancel `lock_coach → courts → …`" is replaced by `db.md` §2. |
| R7 | **Court moves have one owner.** `move_reservation` **refuses** a lesson row (`LESSON_VIA_COACHING`), queued or not. `desk_move_lesson_court` (0280) is the only way to move a lesson's court, so the push lives in one place and no 0277 body needs 0280's `lesson_notify`. |
| R8 | **Reschedule** applies to **every lesson kind**: private, group, and a course session. It keeps the branch, needs the 30-minute grid, `coach_in_hours`, the coach's own overlap check excluding the lesson itself, and a free court. Enrolled guests are notified. `lessons.rescheduled_at` is stamped. A guest whose lesson was rescheduled after they booked may cancel free (`guest_free`) until the new start. C-19 only forbids **dropping** a course session. |
| R9 | **The 30-minute grid** (C-20) applies to every lesson start, not only private lessons. |
| R10 | **Linking a coach-added student.** `coach_add_student` and `coach_book_private` link the enrolment to an account (`guest_id`) only on an exact match of a **verified** phone (`auth.users.phone` with `phone_confirmed_at`, the 0252 identity). The answer, its timing class and its errors are identical whether or not it matched. The roster shows the name and phone the coach typed. A linked student sees the lesson in My lessons, gets `lesson.added_by_coach`, and may cancel without a strike (CD-2). §1.2's "never linked by it alone" means the typed phone is never trusted without that verified match. |
| R11 | **`lesson_enrolments.guest_phone`** is checked with `app.phone_digits` (granted), not `app.phone_canon` (no grant, 0189:169). |
| R12 | **Allowlist.** Only the four anonymous reads (`coaching_public`, `coach_profile`, `coach_slots`, `lesson_offer`) and `coach_me` are `publicByDesign`. Every other guest and coach RPC goes in the `guarded` list: `check-rpc-authz.mjs:98` counts `ACCOUNT_REQUIRED` as a refusal. |
| R13 | **`mutations.ts` stays as it is.** The core queued-payload enum does **not** gain `'lesson'`, and the test at `mutations.test.ts:474` still refuses it (CD-6). Only the readers learn the kind: `slotGrid.ts` maps `lesson` to `booked`, and the operator's `ReservationKind` type adds `lesson`. |
| R14 | **Error codes.** `PRICE_VIA_PROTOCOL` and `LAUNCH_VIA_PROTOCOL` already exist (0177; `packages/i18n/src/errors.ts:340,342`). They move to "Reused", and their copy widens to cover lesson prices. Also reused: `DEGRADED_LOCKOUT`, `IDEMPOTENCY_CONFLICT`, `INVALID_ARGUMENT`, `SLOT_TAKEN`, and the deposit edge codes. |
| R15 | **Degraded mode.** Guest and coach booking paths (`lesson_book_private`, `lesson_join`, `course_join`, `coach_book_private`, `coach_create_*`, `coach_add_student`) call `assert_not_degraded_for` as `hold_slot` does. Desk paths follow `staff_create_reservation`. |
| R16 | **Coach status.** `paused` hides the coach from guests: they are not listed, and guest booking answers `COACH_INACTIVE`. Coach mode still works, with a banner. `retired` leaves coach mode read-only (schedule history and statements). `set_coach_status` lives in **0280**, beside the cancel internal that retiring calls. |
| R17 | **`coach_profile(p_coach_id, p_venue_id default null)`.** NULL means every open branch where the coach is active; that is what the `/c/<id>` link uses. |
| R18 | **Push.** `lesson_notify` keeps §1.5's types. `guest.md` §4.5 fixes what each argument means and who receives the push. `lesson_sync_reminders` is called only by the triggers `trg_lesson_reminders` and `trg_enrolment_reminders`. §1.9 gains `coach.session_added`, `coach.rescheduled_by_staff` and `coach.court_moved`. `coach.statement_ready` is sent on approval, `coach.statement_paid` when marked paid. The `match_notify` key-parity test compares its own subset of `guest-push.json`; that change ships in the 0271 commit. |
| R19 | **Mobile routes.** §1.11 gains `app/my-lessons.tsx`. The route names are `coach-detail`, `class-detail` and `lesson-detail`. The native date picker is `@react-native-community/datetimepicker` (`guest.md`; a native change, so it ships in the production `eas build`). |
| R20 | **The desk reads coaching settings through `desk_lessons`.** Its envelope carries `coaching_enabled`, the payment mode, `server_now` and the coach and lesson-type catalogue (`operator.md`). The desk never calls `coaching_settings` or `coaches_admin`. A cashier takes lesson money from the customer record, because the cashier cannot open `/desk/lessons/$id`. |
| R21 | **Statements across branches.** `report_coach_statements` widens to "All branches". `coach_statement_detail` and every statement write act on the rail's branch only; other branches' rows are read-only. |
| R22 | **Smaller amendments:** a lesson payment row has `reservation_id` NULL; `tabs_lesson_shape` also requires `court_cap_iqd` NULL on a lesson tab and `lesson_iqd = 0` on every other tab; statement-line money columns are signed (`coach_statement_lines_sign`); a void statement's lines are frozen too; §1.8 gains `deposit_refund_request` (Money, 0281) and, under R1, `expire_stale_holds` and `match_expire_holds` (DB, 0277); `lessons.cutoff_checked_at` and `courses.cutoff_checked_at` (DB); partial unique indexes add `<column> is not null`; the coach bio columns get a new SEC-20 `empty` erasure route; `CD-6` covers coaching RPCs only, and the existing till refund mutation (`payment.refund`) keeps its queue behaviour. |
| R23 | **Paperwork in the commit.** `fixtures/assistant-coverage.json` gains a `docs` entry for every file under `docs/design/coaching/`, and `pnpm --filter @touch/db assistant:map` is re-run. `packages/db/CLAUDE.md`'s latest-ordinal line and its error-mapping lines are fixed in the first commit. |

### 1.13 Review rulings (2026-10-01; they amend §1.1–§1.12 and win over any lane section)

From `drafts/review-concurrency-money-2026-10-01.md` (R24–R39, and its R40/R41 renumbered R59/R60)
and `drafts/review-rules-privacy-2026-10-01.md` (R40–R58), adapted to decisions C-21…C-31. Each
ruling's full text, evidence and failure scenario is in its review. The summary below is binding
where it differs from the review.

#### Concurrency and money

| # | Ruling |
| --- | --- |
| R24 | **Statement lines carry their lesson.** `coach_statement_lines_kind` is dropped. Every line has a `lesson_id`; `is_adjustment` marks a line for a lesson that already has lines on an approved or paid statement. Unique `(statement_id, lesson_id)`. Test: approve, refund, redraft twice, and the adjustment appears exactly once. |
| R25 | **Lesson holds (replaces R1's last two sentences).** 0277 changes only the orphan clause of `expire_stale_holds` and `match_expire_holds`, to `(r.guest_id is null and r.lesson_id is null)`. A lapsed lesson hold expires by TTL like any hold; `lesson_hold_expire` expires it with its lesson. Every path that ends a held lesson also expires its `pending` hold row whatever `hold_expires_at` says, `for update skip locked`. §6.3's `SLOT_TAKEN` limit is struck. |
| R26 | **Cut-off.** CHECK `lesson_types_cutoff (kind = 'private' or min_places = 1 or cutoff_hours >= 1)`; writers default a group or course type to 2 hours. The sweep judges a cut-off only before the session's start (a course: session 1). Judged later, it stamps `cutoff_checked_at`, writes `under_filled` with `data {late: true}`, and cancels nothing. |
| R27 | **Refund day (C-31).** `close_day`, `v_day_close_summary` and `day_close_online` date **every** refund by `coalesce((select day_session_id from till_shifts where id = r.till_shift_id), p.day_session_id)`. Owner: Money, in 0278. Tests: a refund on day 2 of a payment taken on day 1, for a café tab and for a lesson tab. |
| R28 | **Online refunds of lesson money (amends R5).** `lesson_refund_start(p_enrolment_id uuid, p_reason text) returns int`, no `from`. The amount is always `lesson_enrolment_money(e)->>'refund_due_online_iqd'` (which implements C-23 for a course leave). The reason comes from the enrolment's `cancel_kind` and the lesson's or course's `cancel_reason`; `account_deleted` stays `account_deleted`. `lesson_cancel_internal` and `course_cancel_internal` call it for **every** enrolment with an applied online row, live or not, after the status writes. The reconciler's lesson loop has no `updated_at` window. |
| R29 | **Late Qi success.** In `lesson_settle_success`'s `held` branch, a group or course enrolment re-checks places against `max_places`, itself excluded; over the limit is `slot_lost`. The revival clears the lesson's `cancel_reason`, `cancelled_at` and `hold_expires_at`. Any `check_violation`, `unique_violation` or `exclusion_violation` in the revival or re-pick is `slot_lost`. DB's state machines gain `expired → scheduled` and `expired → booked` (writer: Money). |
| R30 | **Online lesson holds are holds.** Online `lesson_book_private`, `lesson_join` and `course_join` take `lock_principal('hold_slot', caller)` and refuse `HOLD_QUOTA_EXCEEDED` when live court holds plus `held` enrolments reach `max_live_holds_per_guest`. `lesson_strikes.kind` gains `lapsed_hold`; `lesson_hold_expire` records one for a guest-booked enrolment that expired with no succeeded payment. |
| R31 | **Strike rows never wait.** The attendance delete of an unsettled strike and `lesson_strike_record`'s existence check use `for update skip locked`; the lesson-strike loop of `hold_strikes_settle` selects `for update skip locked`. A two-connection race test covers a mark against `lesson_join`. |
| R32 | **Reschedule (amends R8).** Refuses a `held` lesson (`INVALID_TRANSITION` detail `held`). A group session's `cutoff_at` moves with its start, and `cutoff_checked_at` is cleared when the new cut-off is still ahead. `lessons.rescheduled_at timestamptz` joins §1.2. `db.md` D-10 and its `not_course` refusal are struck. |
| R33 | **Text order for the lock gate.** No cancel, mark or sweep body takes `FOR UPDATE` on `reservations` (guarded `update … where status in (…)` only), so no coaching name joins `STATUS_ONLY_RESERVATION_WRITERS` (amends R6). Level M and the lesson arm of `deposit_apply`: courts, then the row `FOR UPDATE`, then `match_expire_holds`, then the writes. `SERVICE_WALK` gains `lesson_sweep`, `lesson_settle_success`, `lesson_payment_prepare` and `coach_statements_draft` in the 0275 commit; `tests/lock-order-matches.test.ts:75`, `:228` and `:301` are edited in the commits that change them. |
| R34 | **Pick only what is locked.** `lesson_lock_branch_courts(uuid) returns uuid[]`; `lesson_pick_court(p_venue uuid, p_period tstzrange, p_locked uuid[])` chooses only from that set. |
| R35 | **`confirm_booking`** (latest 0242:1304) joins 0277's `LESSON_VIA_COACHING` list (detail `confirm`), straight after its `FOR UPDATE` read. |
| R36 | **Desk lesson refunds.** Money re-issues `app.refund` (latest 0217:34). For a payment on a `kind 'lesson'` tab it takes `lock_coach` before the tab lock, and refuses more than `refund_due_desk_iqd` with `REFUND_EXCEEDS_DUE` unless `p_reason_code = 'lesson_goodwill'`. |
| R37 | **Closing a branch with coaching money.** `close_branch` refuses `BRANCH_HAS_BOOKINGS` detail `coaching_money` while the branch has a `draft` or `approved` statement, an undrafted month with statement lessons, or any `refund_due_desk > 0`. |
| R38 | **What a cut-off counts.** `booked` places. When `booked < min_places ≤ booked + live held`, the sweep waits until the held enrolments resolve or `start_at − 10 minutes`, then judges on `booked`. |
| R39 | **Course adds close at the last start** (with R48): `coach_add_student` and `desk_add_student` refuse a course with `LESSON_CLOSED` from `signup_closes_at`. |
| R59 | **Statements** (was R40). `coach_statements_draft` is a procedure that commits after each (coach, branch) pair. A void from `approved` consumes a manager PIN grant. `coach_statement_mark_paid` refuses a negative total (`STATEMENT_NOT_APPROVED` detail `negative`). |
| R60 | **R2 everywhere** (was R41). Every body, test and twin reads `iqd_split`; no `rpc-overloads.json` entry. The three hot-table partial indexes of 0276 (`reservations`, `tabs`, `booking_payments`) are created `CONCURRENTLY` in their own files if the push can't be outside trading hours. |

#### Rules, privacy and decisions

| # | Ruling |
| --- | --- |
| R40 | **Push fan-out (resolves R18's open point).** Guest's AFTER INSERT trigger `lesson_events_notify` on `lesson_events` (0280) is the only queuer of every `lesson.*` and `coach.*` key, except `coach.statement_ready` and `coach.statement_paid`, which Money's approve and mark-paid call directly. Mapping per the privacy review (guest.md's tables). DB writes no `lesson_notify` call. `lesson-push.test.ts` asserts every row against real transitions. |
| R41 | **Read contracts.** The privacy review's §5 table (X1–X29) is binding: where a client renders a field, the client lane's name wins. `packages/core/src/coaching/shapes.ts` holds each read's key list; a DB test asserts every RPC result's keys ⊇ its list, and the client parsers read the same list. |
| R42 | **Person-money stays away from LLMs (C-28, SEC-29).** `check-analytics-payload.mjs` gains `PERSON_MONEY_REPORTS = ['report_coach_statements', 'report_lessons']`: scanned for guest identity, exempt from the coach patterns, and `tests/assistant-catalog.test.ts` asserts no assistant tool names them. The coach patterns are underscore-optional (`/coach_?id/i`, `/coach_?name/i`, `/coach_?(share\|iqd)/i`). `coach_statements` and `coach_statement_lines` are `excluded` in assistant coverage. |
| R43 | **Coach photos.** The upload folder is a fresh random uuid (`coaches/<uuid>/<uuid>.<ext>`), never a profile or coach id. `app.storage_path_in_use` counts `coaches.photo_path`. Deletion and retirement queue the folder for removal, and a service path removes it within a day. No public payload carries a `profiles.id`. |
| R44 | **A typed student's identity (C-21).** For coach- and staff-booked enrolments, the roster, `desk_lesson_detail`, `desk_lessons` and the till show the typed name and phone, never the profile's. `lesson_enrolments.link_confirmed_at`: a phone match sets `guest_id` and leaves it unconfirmed; My lessons asks "Is this you?" (`lesson_link_confirm(p_enrolment_id, p_yes boolean)`); "Not me" sets `guest_id` NULL silently; no reminder before confirmation. The coach-add push is due at `now() + 5 s`, so the linked and unlinked paths do the same synchronous work. The CD-8 purge writes a fixed marker, never NULL. |
| R45 | **Coach-mode reach (C-25, C-27).** `coach_me` is read on Profile mount and from the staff hub, whatever the coaching switch and the staff status say. With coaching off, coach mode shows "Lessons are switched off at {branch}" instead of hiding. `set_coach_status('retired')` (0280) cancels upcoming lessons and courses as `coach_retired` with refunds and pushes, and is never refused. A retired coach's `coach_me` answers `{coach: {status: 'retired'}}`; coach mode shows approved and paid statements only; `coach_lesson` and `coach_schedule` answer `NOT_A_COACH`. |
| R46 | **Price shape.** `lesson_price`, `lesson_launch` and `coach_price` proposals carry `before.shape = {kind, duration_min, sessions_count, max_places}`, and the target check compares it (`PRICE_TARGET_CHANGED` hint `lesson_type`). On a launched type, a manager editing `duration_min`, `sessions_count` or a private type's `max_places` gets `PRICE_VIA_PROTOCOL` detail `shape`; the operator shows them read-only. Unlinking a coach from a type deletes their coach price. A manager switching a launched type off and on stays direct (as menu items do). |
| R47 | **Cut-off at creation.** Every coach and desk creation, and every reschedule, refuses `LESSON_CLOSED` detail `cutoff` when the session (a course: session 1) would start within its `cutoff_hours`. |
| R48 | **Course adds close with sign-up** (with R39). Group sessions keep "until the end" for walk-ins. |
| R49 | **SEC-20 for coaches.** `stored-fields.test.ts` gains `COACH_DATA`: `coach_time_off.reason` (user content, emptied on deletion), statement money (a new `Financial info` category, kept), `paid_reference` (kept), `courses.title_*` (kept). `paid_reference` and `void_reason` refuse any run of 12 or more digits (`INVALID_ARGUMENT`); the Mark paid copy says "never a card or account number". |
| R50 | **Legal (C-26).** Before coaching is switched on with an online payment mode: the delete-account text (lessons cancelled and refunded; a coach's profile retired, photo removed, statements kept), the privacy text for students and for coaches, and the terms' lessons section. `set_coaching_settings` refuses an online `lesson_payment_mode` until `platform_settings.lesson_terms_version` is set; `lesson_guest(true)` checks it (`TERMS_REQUIRED`) on online paths. |
| R51 | **Staff reads ignore the switch.** `coach_slots` answers a staff caller at the type's branch whether coaching is on or off, so the desk can stage lessons. A paused coach answers `bookable: false, starts: []` to everyone else. |
| R52 | **Error vocabulary.** The privacy review's X31 table is binding. The operator drops codes no server raises. `set_coach_branches` raises `BRANCH_HAS_BOOKINGS` when a removed branch has live lessons. Every detail a screen meets has its own sentence in both catalogs. |
| R53 | **Coverage now.** Done 2026-10-01: `assistant-coverage.json` has an `excluded` entry for every file under `docs/design/coaching/`; every file added later gets its entry in the same change. The build contracts become `index:doc` when the milestone lands, with `assistant:map` re-run. |
| R54 | **CD-3 window:** a coach sees a student's phone until `end_at + 7 days` of that session. |
| R55 | **One Arabic glossary (C-30).** One shared constants block is used by `coaching.*` and `ws/coaching*`: «حصة» the lesson, «أجرة الملعب» the court share, «نصيب المدرّب» the coach's share. |
| R56 | **No self-enrolment, no hoarding (C-24).** Guest booking and joining refuse the lesson's own coach (`ALREADY_ENROLLED` detail `coach`). `venue_settings.coach_max_open_private int not null default 10` (1..100, owner): a coach holds at most that many upcoming coach-booked private lessons (`COACH_ADD_LIMIT` detail `live`). The desk tile flag and the statement no-show list per C-24. |
| R57 | **Guard first.** Every staff coaching RPC checks the role before any argument check or `current_venue()`. |
| R58 | **Tests.** The privacy review's G2 value scans and cases, and its G6 e2e journeys (`operator-coaching.spec.ts`, `site-coaching.spec.ts`). |
| R61 | **Coach consent (C-22).** `coaches.public_accepted_at timestamptz`. `coach_accept_public()` (coach RPC, 0280) sets it. Every public read and guest listing shows only accepted, active coaches; until then coach mode opens on the accept sheet. Desk and coach-booked lessons work before acceptance. |
| R62 | **Leaving a running course (C-23).** For a `guest_late` course cancel, `refund_due_online` = the shares (`iqd_split` of what the enrolment paid, over its covered sessions) of every covered session that starts outside the cancellation window, judged from the guest's own next covered session; the next session, if inside the window, is kept. Core twin `courseLeaveRefund`. |
| R63 | **A deleted coach (C-29).** Deletion retires the coach (R45), clears bio and photo (R43), and keeps `display_name_*` for statements; retired coaches never reach a guest surface. The deletion text says so. |

### 1.14 Closing rulings (2026-10-01, after the consistency pass; they win over §1.12–§1.13 and the lanes)

The four lane files were aligned with §1.12–§1.13 and C-21…C-31 on 2026-10-01. These settle what
each pass left open.

| # | Ruling |
| --- | --- |
| R64 | **`SKIP LOCKED` never waits.** The lock walker treats `FOR UPDATE … SKIP LOCKED` on `reservations` the way it treats `pg_try_advisory_xact_lock`: no Rule 1 or Rule 3 finding (`db.md` D-25). Nothing joins `STATUS_ONLY_RESERVATION_WRITERS`. R33's "no `FOR UPDATE` on reservations" means no *waiting* `FOR UPDATE`. The walker edit and its fixture test land in the 0275 commit. Every path that ends a held lesson releases its court row through `lesson_court_release`. |
| R65 | **Strike rows.** `lesson_strike_record` checks existence with a plain read (`db.md` D-26); the attendance delete and `hold_strikes_settle`'s lesson loop keep `skip locked` (R31). A late successful payment withdraws the guest's unsettled `lapsed_hold` strike. |
| R66 | **Reschedule and the cut-off.** R47's refusal applies on reschedule only to a session whose cut-off has not been judged; a judged session keeps its stamp and may move (`db.md` D-24). |
| R67 | **Online availability.** `coaching_settings` reports `online_payments_available` = the lessons terms version is set. `set_coaching_settings` refuses an online mode with `ONLINE_PAYMENT_OFF` detail `terms`. A missing Qi provider is answered by `lesson-begin` with the deposit edge's `PROVIDER_UNAVAILABLE`. |
| R68 | **Desk linking.** A phone typed at the desk links pending confirmation, as a coach's does (C-21). A customer picked from the directory is linked at once, and their name and phone are copied into `guest_name` / `guest_phone`, so staff surfaces always show a recorded label (`db.md` D-22). |
| R69 | **One booking lock per guest.** Desk-mode guest bookings also take `lock_principal('hold_slot', caller)` (`db.md` D-23). `hold_slot` itself still counts court holds only; this is a known limit. |
| R70 | **Money signatures.** `lesson_settle_success(p_payment_id uuid, p_locked uuid[])`; `coach_statement_void(p_statement_id uuid, p_reason text, p_pin text default null, p_device_id text default null)` (the PIN is required from `approved`; it joins every `PIN_GATED_RPCS` copy); `procedure app.coach_statements_draft(p_month date default null)` is security invoker, revoked from public, anon and authenticated, and calls the definer `coach_statement_draft_one(uuid, uuid, date)` once per pair; `lesson_places_taken(uuid, uuid default null)` and `course_places_taken(uuid, uuid default null)` take an enrolment to exclude; `coach_self(p_raise boolean default true)` refuses retired coaches, and `coach_of_caller()` lets a retired coach read `my_coach_statements`. |
| R71 | **C-31's reach.** In 0278, `close_day`, `v_day_close_summary`, `ops_overview` (0219:1254) and `day_close_shop` (0246:450) date refunds by their till shift's day; `day_close_online` does so in its 0285 re-issue. There is no per-day flag: a closed day shows its stored figures, and the "refunds count on the day they are made" sentence shows only on an open day. |
| R72 | **Names.** `report_courts.lessons.owedToCoachesIqd` (not `coachShareIqd`). The statement detail's `coach_booked_no_shows` is an array of `{lesson_id, start_at, student_label}`. One glossary, `packages/i18n/src/catalogs/coaching.glossary.ts` exporting `coachingGlossary`, is used by every lane. Shapes are `packages/core/src/coaching/shapes.ts` exporting `COACHING_SHAPES`. |
| R73 | **Codes and details.** New: `REFUND_EXCEEDS_DUE`. Reused: `PROVIDER_UNAVAILABLE`. Details: `move_reservation` refuses `LESSON_VIA_COACHING` detail `move`; `set_coach_branches` refuses `BRANCH_HAS_BOOKINGS` detail `coach_lessons`; `HOURS_OVERLAP` detail is the 0-based index of the clashing submitted window, or `time_off`; `ALREADY_ENROLLED` detail `coach` on every booking path, desk and coach included. |
| R74 | **Card guard.** `paid_reference` and `void_reason` are refused when, after removing spaces and hyphens, they hold a run of 12 or more digits. |
| R75 | **A refund Qi can't take.** When a share is owed back on an online payment that already has its one refund (a course leave, then a venue cancel of the kept session), `lesson_refunds_due` lists it as `online_blocked_iqd`. A manager records the handback with `lesson_blocked_refund_record(p_enrolment_id uuid, p_amount_iqd bigint, p_reference text, p_pin text, p_device_id text)` (Money, 0278; PIN-gated). It is stored in `lesson_enrolments.refunded_outside_iqd`, counted as refunded by the engine and the statements, and never written as a `payments` or `refunds` row. The cancellation window is read live at cancel time, as for court bookings. |
| R76 | **Paused coaches.** `coaching_public`, `lesson_offer` and every listing leave out paused coaches. `coach_profile`, reached by a direct link, answers a paused coach with `status: 'paused'` and `bookable: false`. |
| R77 | **Starts.** `coach_slots` serves private lessons. Group and course starts are chosen with a date-time picker in coach mode and at the desk, and checked by the server. |
| R78 | **Events the push trigger needs.** `paid_online` carries `lesson_id`, `places_taken`, `places_total`. The reminder triggers also fire on changes to `link_confirmed_at` and `guest_id`, and skip a pending link. |
| R79 | **Known limit.** A coach add that matches an account writes one more outbox row than one that does not; the push is due at `now() + 5 s` either way. Accepted. |
| R81 | **The shapes file is binding for keys.** `packages/core/src/coaching/shapes.ts` (`COACHING_SHAPES`, built 2026-10-01) decides every read and write result's key names. Where a lane file names a key differently, the shapes file wins: e.g. `coach_me` answers `public_accepted`, `private_open`, `private_cap` (and a separate retired shape, `coach_me_retired`); `my_lesson` answers `confirm_needed` and `can.confirm`; `coach_statement_detail.coach_booked_no_shows` is the R72 array (Money's per-line count of the same name is dropped). The shapes not yet in the file (attendance marks, hours writes, `coach_promote`, `set_coach_branches`, `set_coach_lesson_types`, `add_coach_time_off`, `lesson_link_confirm`, `coach_accept_public`, the `price_promo_*` lesson targets) are added by the sub-step that builds those RPCs, and lanes read `COACHING_SHAPES.<name>` rather than per-read constants. The glossary `coachingGlossary` is likewise binding over `guest.md` §4.15 and `operator.md` §5.20: «كشف حساب» a statement, «آخر موعد للتسجيل» the cut-off, «أوقات التدريب» a coach's hours, «مستحق للمدرّبين» owed to coaches. |
| R80 | **e2e and the staff phone.** Playwright sends the staff phone's protocol decide step through the API exactly as the phone sends it; a mobile smoke case renders that screen. |

## 2. Database core (lane DB)

See `db.md`.

## 3. Money and statements (lane Money)

See `money.md`.

## 4. Guest app, coach mode, web, push, links (lane Guest)

See `guest.md`.

## 5. Operator (lane Operator)

See `operator.md`.

## 6. Rollout, tests, known limits

### 6.1 Landing order

1. One batch, one push, after the root `CLAUDE.md` gates. `deploy.yml` deploys `send-push` (with the
   lesson keys) → `db push` (0270–0286) → every other function (`lesson-begin` included) after CI is
   green.
2. Coaching is off on every branch (`coaching_enabled = false`); nothing changes for guests.
3. The operator tag; the production `eas build` (coach mode, guest coaching, `/c/` links).
4. The owner enters coaches and lesson types; price runs through the protocol.
5. `coaching_enabled` at one branch for a TestFlight trial, then public.

### 6.2 Tests

`tests/coaching*.test.ts` (booking races, coach overlap, cut-off sweep, desk and online money,
statements against the core twin, protocol locks, privacy, deletion), core parity tests, matrix rows,
operator and mobile unit and smoke tests, `e2e/tests/operator-coaching.spec.ts` (EN + `@ar`).

### 6.3 Known limits

Coach mode has no offline support. A lesson's coach cannot be swapped (cancel and rebook). No
coach-to-student messaging. No per-session cancel of a course (C-19). A lapsed online lesson hold
keeps its court refusing bookings (`SLOT_TAKEN`) for up to a minute, until `lesson_sweep` expires it
(R1).
