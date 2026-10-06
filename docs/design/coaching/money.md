# Coaching: money and statements (lane Money)

Consistency pass 2026-10-01: aligned with §1.12–§1.13 and C-21…C-31.

Date: 2026-10-01. Status: **lane contract, merged; consistency pass done.**
`build-contracts-2026-10-01.md` §0 (C-1…C-31, CD-1…CD-12), §1 and the rulings R1–R63 (§1.12,
§1.13) are binding and are not repeated here; where this file and a ruling disagree, the ruling
wins. The read contracts of `drafts/review-rules-privacy-2026-10-01.md` §5 (X1–X29) and its error
table X31 are binding (R41, R52). Names this file still needs that §1 does not have are in §14, with
the points the merge must still rule on.

`packages/db/fixtures/assistant-coverage.json` already has this file's `docs` entry (R53, done
2026-10-01).

Conventions:
- **Ordinals as §1.1 has them**: Money's files are **0272** (`booking_payments` CHECK widening),
  **0273** (`tabs.kind` CHECK widening), Money's part of **0275** (columns, anchor), **0278**
  (desk money, `lesson_refund_start`, the refund-day re-issues of C-31), **0281** (online payment
  and `lesson-begin`), **0284** (statements), **0285** (reports). Latest on disk at writing: 0269
  (`20261001000269_principal_lock_caps.sql`). Check the directory before each file; if the team has
  landed more, shift every ordinal up in this order. `app.lock_coach` / `try_lock_coach` and the
  lock-gate edit land in **0275** (R6), before any Money body calls them.
- `NNNN:line` is a line in `packages/db/supabase/migrations/2026…NNNN_*.sql`, checked on 2026-10-01
  at d93bd9bf. `fn/` is `packages/db/supabase/functions/`, `op/` is `apps/operator/src/`.
- Latest bodies used here (each found with `grep -nE "create (or replace )?function app\.<name>\("
  *.sql | tail -1`): `compute_tab_totals` 0262:413, `settle_tab` 0244:312, `open_tab` 0244:70,
  `assert_tab_kind_role` 0244:43, `trg_match_booking_no_cafe` 0262:1413, `cafe_settled_tabs`
  0219:31, `refund` 0217:34, `close_day` 0216:114, view `v_day_close_summary` 0106:1061 (`create or
  replace view`), `match_seat_settle` 0262:542, `deposit_apply` 0267:23,
  `deposit_settle_success` 0258:723, `deposit_status` 0259:897, `deposit_refund_apply` 0259:1002,
  `deposits_due_for_reconcile` 0258:841, `deposit_attention` 0258:969, `deposit_refund_request`
  0258:1155, `deposit_begin_refund` 0242:165, `deposit_prepare` 0242:327, `ticket_payment_prepare`
  0259:41, `expire_stale_holds` 0268:33, `match_expire_holds` 0268:71, `reports_figures` 0265:287,
  `panel_headline` 0265:397, `report_revenue` 0219:637, `report_courts` 0265:469,
  `analytics_courts_summary` 0219:2219, `analytics_open_minutes` 0214:121, `day_close_online`
  0265:155, `ticket_money_figures` 0265:47, `consume_pin_grant` 0156:446, `verify_manager_pin`
  0231:828, `claim_replay` 0049:68, `finish_replay` 0049:98, `current_open_day_locked` 0216:35,
  `match_shares` 0260:485.
- Every file opens with `set lock_timeout = '3s'; set statement_timeout = '60s';`, re-issues from
  the latest body verbatim plus the marked change, uses `$<name>_0NNN$` tags with its real ordinal,
  and adds every CHECK or FK to an existing table `NOT VALID` plus a validate guarded on `conname`
  and `conrelid` (the 0254:28-46 and 0258:574-616 form).

**Money's migrations** (§1.1 with the rulings applied):

| Ordinal | What Money puts in it |
| --- | --- |
| 0272 | `booking_payments` `purpose` + `lesson`, `refund_reason` + `coach_cancel`, `under_filled`; alone (§3.1) |
| 0273 | `tabs_kind_chk` + `lesson`; alone (§3.2) |
| 0275 (with DB) | `tabs` and `booking_payments` columns, `tabs_lesson_shape`, the anchor and `reason_by_purpose` re-created, the branch-guard pairs; the statement DDL Money needs (§4.3: `lesson_id not null`, no `coach_statement_lines_kind`, R24); `SERVICE_WALK` and the lock-gate edit ride this commit (R6, R33) |
| 0276 (DB's file) | `tabs_by_lesson_enrolment`, `booking_payments_by_lesson_enrolment` (hot tables, R60), `coach_statement_lines_lesson`, unique `(statement_id, lesson_id)` |
| 0278 | `iqd_split`, `lesson_coach_share`, `course_late_join_price`, `course_share_for`, `lesson_enrolment_money`, `lesson_fee_remaining`, `lesson_collected`, `lesson_refund_start` (R5/R28), `lesson_money_open` (R37), `compute_tab_totals` (drop + create), `settle_tab`, `trg_match_booking_no_cafe`, `cafe_settled_tabs`, `refund` (R36), `close_day` and `v_day_close_summary` (C-31, R27), `lesson_settle`, `lesson_refunds_due` (§5) |
| 0281 | `lesson_payment_prepare`, `lesson_settle_success`, `lesson_hold_expire`, `deposit_apply`, `deposit_status`, `deposit_refund_apply`, `deposits_due_for_reconcile`, `deposit_attention`, `deposit_refund_request`; edge `lesson-begin` (§6) |
| 0284 | `coach_statement_build`, `coach_statement_draft_one`, procedure `coach_statements_draft` (R59), refresh, approve, void, mark paid, `report_coach_statements`, `coach_statement_detail`, `my_coach_statements`; cron `tp_coach_statements` (§7) |
| 0285 | `lesson_money_figures`, `reports_figures`, `panel_headline`, `report_revenue`, `report_courts`, `analytics_courts_summary`, `day_close_online`, `report_lessons` (§8) |

## 1. Where every dinar lives

| Money | Record | Counts as | Never counts in |
| --- | --- | --- | --- |
| A lesson paid at the desk | one `tabs` row `kind 'lesson'` per payment, `lesson_enrolment_id` set, settled in the same call; its one `payments` row | till money: cash or card, the day's cash count, `lessonRevenue` | café figures (`cafe_settled_tabs`, `cafeRevenue`, `cafeNet`, `refunds`), `padelRevenue`, any booking bill |
| A desk refund of it | `refunds` row on that payment (`app.refund`, manager PIN; at most `refund_due_desk_iqd` unless `lesson_goodwill`, R36) | money out of the till on the day it is made: its till shift's day in `close_day`, `v_day_close_summary` and `day_close_online` (C-31, R27); nets `lessonRevenue` by its own date | café refunds |
| A lesson paid online (Qi) | `booking_payments` `purpose 'lesson'`, `venue_id` and `lesson_enrolment_id` set, `reservation_id` NULL (R22), `hold_id` = the court hold of a private lesson, else NULL | `lessonRevenue` (by `succeeded_at`), "money outside the drawer" at day close | cash, card, `onlineDeposits`, ticket figures, `court_fee_paid`, `deposit_net_paid` |
| An online refund of it | the same row, `refund_pending → refunded` (one refund per row, 0242:179-181), started only by `lesson_refund_start` (R28), by `lesson_settle_success` for a success that does not book (§6.4), or by a manager once final (CM-5) | nets `lessonRevenue` by `refunded_at` | — |
| Money the venue keeps after a late cancel or a no-show | not moved: the enrolment's `kept_iqd` (§5.3; a course leave keeps only what C-23 keeps) | `lessonRevenue` already; the coach's share (§7) | refunds |
| The coach's share | derived, never stored as money; frozen on `coach_statement_lines` when approved | `owedToCoaches` (information) | cash, card, any payment or refund row (marking paid writes neither, C-12) |

The court a lesson uses is never billed: a lesson's court row is `kind 'lesson'` with no price that
anybody owes (`court_fee_remaining` reads `kind = 'booking'` only, 0262:398). The **court share** is
an internal figure of the statement (C-6), not a payment.

## 2. Decisions this lane takes (technical; Parsa may reverse any)

| # | Decision | Why |
| --- | --- | --- |
| CM-1 | Desk money is **one fresh `kind 'lesson'` tab per payment**, inserted and settled in the same call by `lesson_settle`. No part payments. A lesson tab is never live after a commit, carries no goods (`LESSON_TAB_NO_GOODS`), no table, no booking, no court cap. | Parsa's ruling (separate lesson tab, never mixed with court or café bills); a live tab blocks day close (0216) and a goods line would leak into café revenue. |
| CM-2 | **Owed uses gross money** (refunds are not netted, as `court_fee_paid` does not net them, 0106:120-124 and open-matches MD-13). **Kept, refunds due and statements use net money.** | A manager's goodwill refund must not make a paid lesson "owed" again at the desk. |
| CM-3 | What the venue keeps is decided in one place, `lesson_enrolment_money` (§5.3): nothing after a coach cancel, a staff cancel, under-filled, a free guest cancel, an expired hold or a deleted account (for sessions not yet started); everything for sessions still given after a **late guest cancel** of a private lesson or group session, or a **no-show** (C-9). **Leaving a running course late** keeps only the sessions already begun and those starting inside the cancellation window, the guest's next covered session always among them (C-23, R62). A late cancel also keeps a **desk prepayment** on the same rule; an unpaid desk late cancel owes nothing. | C-9, C-23 and Parsa's brief; one rule for online and desk money. |
| CM-4 | Course money: the enrolment's price splits evenly over the sessions it covers (`iqd_split`, R2/R60; largest remainder, first sessions +1). Money kept is allocated evenly over the sessions the enrolment pays for (`T_e`, §5.3). | C-15; the suffix of an even split is the even split of its sum, so a late joiner's share of session k equals a full member's (proof in §5.2). |
| CM-5 | Online lesson money goes back **only** through `lesson_refund_start` (R5/R28: the coaching cancel paths, the reconciler's net), **one refund per payment row**. A manager's partial refund of an online lesson payment (`deposit_refund_request`, `staff_refund`) is allowed only once the enrolment's money is **final** (no covered session still to come). One exception is forced by C-23: a late course leave refunds at once though its kept next session is still to come; if the venue then cancels that session, its share is `refund_blocked_iqd` (§5.3, §15). | 0242:179-181 allows one refund per row; refund-due can only grow while a session is still to come, so a refund taken before then could block the one the cancel needs. |
| CM-6 | Online is **reserve first, then pay** (C-3). SUCCESS books; a held group or course enrolment re-checks places, itself excluded (R29); a late SUCCESS after expiry revives the enrolment if the coach, a court and the places are still free, else `slot_lost`; any constraint violation in the booking writes is `slot_lost` (R29); inside the degraded horizon `venue_offline`; a second success `duplicate_success`; wrong amount `amount_mismatch`. | The deposit rules (0258:723-833), applied to a lesson. |
| CM-7 | A coach earns on **money the venue keeps**, per **statement lesson**: a lesson that is over (completed, or still `scheduled` past its end), or one a late guest cancel ended with money kept. | C-9 "the coach is paid only on money collected"; late-cancel and no-show money is collected money. |
| CM-8 | **One live draft per coach and branch.** A draft is built only for a complete month and only when no older draft of that coach and branch is live; approving a draft builds the next complete month's. Adjustments are computed against approved and paid lines, looking back 12 months; every line carries its lesson (R24). The monthly run commits after each (coach, branch) pair (R59). | Two live drafts would each carry the same adjustment. |
| CM-9 | Approval freezes the draft as drafted or last refreshed. Money that moves later is an adjustment line on the next draft. | Deterministic; the manager approves what they saw. |
| CM-10 | Void from `draft` or `approved` only (never `paid`); a void from `approved` spends a manager PIN grant (R59: cash may already have been handed over). A voided statement's lessons roll into the next draft as adjustments; refreshing a void statement redrafts that month. A negative statement cannot be marked paid (R59); voiding it carries it forward. | Undo without losing a lesson; paid money handed over must never be forgotten. |
| CM-11 | Nobody approves, voids or marks paid a statement of their **own** coach profile (`FORBIDDEN` detail `own_statement`). Writes and the detail act on the rail's branch only (R21). **Amended 2026-10-02:** also the PIN authoriser (build-contracts §1.15 D6). | A manager who also coaches. |
| CM-12 | A coach (a retired one too, C-25) sees approved and paid statements only (drafts can still change), plus a month-to-date estimate flagged as such (X12). | Avoids showing figures that move. |
| CM-13 | `lessonRevenue` is **cash basis, net**: desk payments by `payments.created_at`, desk refunds by `refunds.created_at`, online by `succeeded_at` and `refunded_at`. `owedToCoaches` is **accrual**: the coach share of statement lessons starting in the range. | The same dating as `cash`/`card` and `onlineDeposits` (0265:322-348); statements are per lesson. |
| CM-14 | Lesson minutes are **occupied court time** in `report_courts` and `analytics_courts_summary` (occupancy counts them); court revenue stays bookings only. | A lesson holds a court; `analytics_open_minutes` already counts it as open time (0214:165-180 subtracts maintenance only). |
| CM-15 | Sandbox lesson payments (the App Review account) book for real but add 0 to every statement and report. | DF-19's rule for deposits and tickets. |
| CM-16 | Statement months are **branch-local calendar months** (`venues.timezone`, midnight), not business days. | "Previous month by branch local date"; the coach's month. |

## 3. 0272 and 0273: CHECK widenings, each alone in its file

### 3.1 0272 `booking_payments_lesson_checks`

Both constraints are inline column CHECKs of 0241 (0241:33, 0241:53-55), already re-issued by name
in 0254:18-26. Re-issued again in the 0254 shape:

```sql
alter table booking_payments drop constraint if exists booking_payments_purpose_check;
alter table booking_payments add constraint booking_payments_purpose_check
  check (purpose in ('deposit', 'ticket', 'lesson')) not valid;
alter table booking_payments drop constraint if exists booking_payments_refund_reason_check;
alter table booking_payments add constraint booking_payments_refund_reason_check
  check (refund_reason is null or refund_reason in
    ('guest_cancel', 'staff_cancel', 'no_show', 'slot_lost', 'venue_offline', 'amount_mismatch',
     'duplicate_success', 'manual', 'staff_refund', 'ticket_cashout', 'account_deleted',
     'coach_cancel', 'under_filled')) not valid;
-- then one guarded VALIDATE per constraint ($booking_payments_purpose_validate_0272$,
-- $booking_payments_refund_reason_validate_0272$), conname AND conrelid = 'public.booking_payments'::regclass
```

Do not confuse the second with the table constraint `booking_payments_refund_reason` (0241:70-72).
Safe alone: nothing writes `purpose 'lesson'` before 0281, and until 0275 re-creates it the 0258
anchor (0258:579-583) refuses any lesson-shaped row anyway.

### 3.2 0273 `tabs_kind_lesson`

`tabs_kind_chk` is named explicitly at 0144:88.

```sql
alter table tabs drop constraint if exists tabs_kind_chk;
alter table tabs add constraint tabs_kind_chk check (kind in ('cafe', 'shop', 'lesson')) not valid;
-- guarded VALIDATE ($tabs_kind_validate_0273$), conname AND conrelid = 'public.tabs'::regclass
```

Safe alone: `open_tab` refuses every kind but `cafe` and `shop` (0244:101-103) and requires a table
or a booking for a café tab (0244:152-164); no writer names `'lesson'` before 0278. The drop and add
take a brief ACCESS EXCLUSIVE on `tabs` (no scan, NOT VALID); the validate takes SHARE UPDATE
EXCLUSIVE and does not block the till. `lock_timeout 3s` bounds the wait.

**Gates with 0272/0273:** `check:migrations` (NOT VALID + guarded VALIDATE, alone in the file);
`pnpm db:types` (no diff); `deposits.test.ts`, `matches-tickets.test.ts`, `cafe-money.test.ts`,
`desk-payment.test.ts` green unmodified.

## 4. 0275 `coaching_tables`: Money's part

It lands in the same file as DB's tables, after `lesson_enrolments` exists and before any lesson row
can. Every constraint below: NOT VALID, then one guarded validate loop (the 0258:603-616 form).

### 4.1 `tabs`

```sql
alter table tabs add column if not exists lesson_enrolment_id uuid;
alter table tabs add column if not exists lesson_iqd bigint not null default 0;   -- fast default, no rewrite
-- (bigint, not the iqd domain: a domain with a CHECK on ADD COLUMN forces a rewrite of a hot table, §1.2)

constraint tabs_lesson_enrolment_fkey foreign key (lesson_enrolment_id) references lesson_enrolments(id);
constraint tabs_lesson_iqd_nonneg     check (lesson_iqd >= 0);
constraint tabs_lesson_shape check (
      (kind = 'lesson') = (lesson_enrolment_id is not null)
  and (kind <> 'lesson' or (reservation_id is null and table_id is null and court_cap_iqd is null))
  and (kind = 'lesson' or lesson_iqd = 0));
```

- `zz_branch_guard` on `tabs` (DB re-creates it in this file, §1.1) gains the pair:
  `app.trg_branch_guard('scoped', 'cafe_tables', 'table_id', 'day_sessions', 'day_session_id',
  'tabs', 'merged_into_tab_id', 'lesson_enrolments', 'lesson_enrolment_id')` (today's list,
  0230:196-198, plus the last pair; `app.row_venue` resolves `lesson_enrolments` through its dynamic
  branch, 0230:79).
- Comments: `tabs.lesson_enrolment_id` *"0275. The lesson enrolment a kind 'lesson' tab takes desk
  money for (one payment, settled in the same call by app.lesson_settle). NULL on every other
  tab."*; `tabs.lesson_iqd` *"0275. The lesson line stamped at settlement (app.settle_tab, from
  compute_tab_totals): what the enrolment still owed. Outside the tax base like the court line
  (CD-4). 0 on every other tab."*
- `tabs_one_live_per_enrolment` (§1.2) is DB's 0276 index. Money also needs
  `tabs_by_lesson_enrolment (lesson_enrolment_id) where lesson_enrolment_id is not null` (0276).
  Both are partial indexes on a hot table: created `CONCURRENTLY` in their own files if the push
  cannot be made outside trading hours (R60).

### 4.2 `booking_payments`

```sql
alter table booking_payments add column if not exists lesson_enrolment_id uuid;
constraint booking_payments_lesson_enrolment_fkey foreign key (lesson_enrolment_id) references lesson_enrolments(id);

alter table booking_payments drop constraint if exists booking_payments_anchor;   -- 0258:579-583
constraint booking_payments_anchor check (
     (purpose = 'deposit' and venue_id is not null and hold_id is not null
                          and reservation_id is not null and ticket_count is null
                          and lesson_enrolment_id is null)
  or (purpose = 'ticket'  and venue_id is null and hold_id is null
                          and reservation_id is null and ticket_count between 1 and 3
                          and lesson_enrolment_id is null)
  or (purpose = 'lesson'  and venue_id is not null and lesson_enrolment_id is not null
                          and reservation_id is null and ticket_count is null));
                          -- hold_id: the court hold of a private lesson, else NULL (lesson_payment_prepare)

alter table booking_payments drop constraint if exists booking_payments_reason_by_purpose;   -- 0258:596-599
constraint booking_payments_reason_by_purpose check (
  refund_reason is null
  or (purpose = 'ticket'  and refund_reason in ('ticket_cashout', 'account_deleted', 'amount_mismatch'))
  or (purpose = 'deposit' and refund_reason not in ('ticket_cashout', 'account_deleted',
                                                    'coach_cancel', 'under_filled'))
  or (purpose = 'lesson'  and refund_reason in ('guest_cancel', 'staff_cancel', 'coach_cancel',
                                                'under_filled', 'slot_lost', 'venue_offline',
                                                'amount_mismatch', 'duplicate_success',
                                                'account_deleted', 'staff_refund')));
```

- **The lesson reason set.** `guest_cancel` (a free cancel, or a late course leave's
  outside-window shares, C-23), `staff_cancel`, `coach_cancel`, `under_filled` (the cancel paths,
  through `lesson_refund_start`); `account_deleted` (CD-12, R28);
  `slot_lost`, `venue_offline`, `amount_mismatch`, `duplicate_success` (SUCCESS that does not book,
  §6.4); `staff_refund` (a manager's partial refund once money is final, CM-5). Never `no_show`
  (C-9 keeps it), `ticket_cashout` or `manual` (`deposit_refund_manual` keeps the reason the refund
  started with, 0258:1128-1137).
- `reservation_id` is **NULL** on a lesson row. Every deposit hook keyed on it therefore ignores
  lesson rows by construction, and each also filters `purpose = 'deposit'` since 0258:
  `trg_reservation_deposit` (0258:928-933), `deposit_net_paid` (0258:700-710), `court_fee_paid`
  (0242:1530), `deposit_settle_success`'s duplicate test (0258:744-749), `my_reservations`
  (0258:1215-1222), `booking_bill`'s online list (0262), the reconciler's first loop (0258:851-858).
- `ticket_count` stays NULL; `booking_payments_ticket_amount` (0258:590-591) is `purpose <> 'ticket'
  or …` and needs no change.
- `booking_payments_one_active` (0241:84-85, on `hold_id`) also holds a private lesson's hold to one
  live attempt; `booking_payments_one_active_lesson` (§1.2, DB's 0276, with `lesson_enrolment_id is
  not null` in its predicate, R22) holds the enrolment to one. Money also needs
  `booking_payments_by_lesson_enrolment (lesson_enrolment_id) where lesson_enrolment_id is not null`
  (0276; hot table, R60 as for `tabs`).
- `zz_branch_guard` on `booking_payments` (DB re-creates it in this file): `app.trg_branch_guard(
  'scoped', 'reservations', 'reservation_id', 'reservations', 'hold_id', 'lesson_enrolments',
  'lesson_enrolment_id')` (0241:100-101 plus the last pair).
- Comment on `booking_payments` re-issued (0258:623-624 plus): *"…or a lesson paid online (purpose
  lesson, 0281: venue_id and lesson_enrolment_id set, reservation_id NULL, hold_id the court hold of
  a private lesson). …"*; on the column: *"0275. The lesson enrolment a purpose 'lesson' payment is
  for; NULL otherwise."*

### 4.3 What Money needs in DB's statement DDL

DB writes `coach_statements` and `coach_statement_lines` (§1.2). Money needs, in that DDL:
- **Every line carries its lesson (R24):** `coach_statement_lines.lesson_id uuid not null`, and DB's
  `coach_statement_lines_kind` is **dropped**. `is_adjustment` means "this lesson already has lines
  on an approved or paid statement" (§7.2), not "no lesson".
- `coach_statement_lines.collected_iqd`, `court_share_iqd`, `coach_iqd` are **`bigint`** (signed: an
  adjustment line can be negative, R22), with `coach_statement_lines_sign check (is_adjustment or
  (collected_iqd >= 0 and court_share_iqd >= 0 and coach_iqd >= 0))` written **inline in the `create
  table`** (`check-migrations` exempts only a `create table` statement), `share_bp int` 0..10000,
  and a unique `(statement_id, lesson_id)` (one line per lesson per statement, R24). Index
  `coach_statement_lines_lesson (lesson_id)` for §7.2's look-back.
- `coach_statements.lessons_count`, `collected_iqd`, `court_share_iqd`, `coach_iqd` are ≥ 0 (Σ of
  regular lines); `adjustments_iqd` signed. CHECKs: `status = 'paid'` ⇔ `paid_at`, `paid_by` and a
  `paid_reference` of 1..80 are set; `status in ('approved','paid')` ⇒ `approved_at` set;
  `status = 'void'` ⇔ `voided_at` set; `month` is the first of a month.
- `trg_coach_statement_lines_frozen` refuses insert, update and delete of a line whose statement is
  `approved`, `paid` **or `void`**.
- Index `coach_statements (coach_id, venue_id, month)` (the unique partial of §1.2 serves).

### 4.4 Gates with Money's part of 0275

- `check:migrations`: the five new constraints and the two re-created ones NOT VALID + guarded
  validate. The 0276 indexes carry DB's waiver; Money's two extra partial indexes are named there.
- SEC-20 (`tests/stored-fields.test.ts:192-203`): `booking_payments.lesson_enrolment_id: n`; the
  `why` of `amount_iqd`, `quoted_price_iqd`, `refund_amount_iqd` widened to "a deposit, open-match
  tickets or a lesson paid online". `tabs` has no guest link column and is not declared. Money's
  rows of DB's `COACH_DATA` block (R49, reached through `coaches.profile_id`): `coach_statements`
  money columns and `coach_statement_lines` money columns (category `Financial info`, `keep`: the
  venue's accounts), `coach_statements.paid_reference` (`keep`); the deletion proof asserts them
  kept.
- `tests/rls-matrix.ts`: nothing new for these columns (both tables already deny every client).
- `src/types.gen.ts` regenerated.

## 5. 0278 `lesson_money`

Order in the file: `iqd_split`, `lesson_coach_share`, `course_late_join_price`,
`course_share_for`, `lesson_enrolment_money`, `lesson_fee_remaining`, `lesson_collected`,
`lesson_refund_start`, `lesson_money_open`, `compute_tab_totals`, `settle_tab`,
`trg_match_booking_no_cafe`, `cafe_settled_tabs`, `refund` (R36, §5.12), `close_day` and
`v_day_close_summary` (R27, §5.13), `lesson_settle`, `lesson_refunds_due`. Every internal function
is `security definer set search_path = public` and `revoke all … from public, anon, authenticated`.

### 5.1 The arithmetic twins (internal)

```sql
-- R2/R60. Twin of packages/core/src/money/split.ts:16-31 splitEvenly: floor(t/n) each, plus 1 on
-- the first t % n parts. NULL in, NULL out; INVALID_ARGUMENT detail p_total (< 0) or p_n (< 1).
app.iqd_split(p_total bigint, p_n int) returns bigint[]             -- plpgsql immutable
  = array(select p_total / p_n + case when i <= p_total % p_n then 1 else 0 end
            from generate_series(1, p_n) i order by i)

-- C-6, CD-5. Twin of core lessonCoachShare. bigint division floors a non-negative value.
app.lesson_coach_share(p_collected bigint, p_court_share bigint, p_share_bp int) returns bigint  -- sql immutable
  = (p_share_bp::bigint * greatest(p_collected - p_court_share, 0)) / 10000
  -- INVALID_ARGUMENT (plpgsql guard) when p_share_bp not in 0..10000 or an input < 0

-- C-15. Twin of core courseLateJoinPrice: the sessions from p_first_session_no on.
app.course_late_join_price(p_course_price bigint, p_sessions_count int, p_first_session_no int) returns bigint  -- sql immutable
  = coalesce((select sum(s) from unnest(app.iqd_split(p_course_price, p_sessions_count))
                with ordinality u(s, i) where i >= p_first_session_no), 0)

-- One session's share of one course enrolment: the enrolment's own price split over the sessions
-- it covers. 0 outside its range; NULL for a private or group enrolment.
app.course_share_for(p_enrolment_id uuid, p_session_no int) returns bigint                       -- sql stable
  = select case when e.course_id is null then null
                when p_session_no <  e.first_session_no
                  or p_session_no >= e.first_session_no + e.sessions_covered then 0
                else (app.iqd_split(e.price_iqd, e.sessions_covered))[p_session_no - e.first_session_no + 1]
           end
      from lesson_enrolments e where e.id = p_enrolment_id
```

**The name is `iqd_split` (R2, R60).** `app.split_evenly(p_tab_id uuid, p_n int)` (0015:768-803) is
the till's Split bill RPC and is not touched: no overload, no `fixtures/rpc-overloads.json` entry.
Every body, test and twin in this file and in DB's (`course_join`, `coach_add_student`,
`lesson_offer`) reads `app.iqd_split(bigint, int)`; the core twin keeps its name `splitEvenly`.

`match_shares(p)` (0260:485-498) equals `iqd_split(p, 4)`; the parity test pins it (it is not
re-issued). DB's `course_join`, `lesson_offer` and the desk and coach adds price a late course join
with `course_late_join_price(courses.price_iqd, courses.sessions_count, first_session_no)`; Money's
parity test pins it to core.

**Why a late joiner's per-session share equals a full member's.** `iqd_split(P, N)` is
non-increasing with values in `{q, q+1}`. Any suffix of it is again non-increasing with values in
`{q', q'+1}`, which is the unique even split of its own sum. So with `price = course_late_join_price(
P, N, f)`, `iqd_split(price, N − f + 1)[i] = iqd_split(P, N)[f − 1 + i]`. Both definitions agree
whenever DB prices a late join with the helper; `course_share_for` uses the enrolment's own price so
Σ shares = `price_iqd` holds even if it ever did not.

### 5.2 The sessions an enrolment pays for

For an enrolment `e`, its **covered sessions** `S_e`: the lesson `e.lesson_id` (private, group), or
the course's lessons with `session_no` in `[first_session_no, first_session_no + sessions_covered)`,
in `session_no` order. `share(e, L)` = `e.price_iqd` (private, group) or `course_share_for(e,
L.session_no)`.

A covered session **counts** for `e` (the venue may keep its share) when:

| `e.status` | `e.cancel_kind` | `L` counts when |
| --- | --- | --- |
| `held`, `expired` | — | never |
| `booked` | — | `L.status <> 'cancelled'` |
| `cancelled` | `guest_late`, private or group | `L.status <> 'cancelled'`, or `L.cancel_reason = 'guest_cancel'` (the guest's own cancel ended it: a private lesson, or a group whose last guest left) |
| `cancelled` | `guest_late`, course (C-23, R62) | `L.status <> 'cancelled'` and (`L.start_at < e.kept_until` or `L = N_e`): the sessions already begun or starting inside the window are kept, every later one is refunded |
| `cancelled` | `course_cancelled` | `L.status <> 'cancelled'` (the sessions held before the rest was cancelled) |
| `cancelled` | `guest_free`, `coach`, `staff`, `under_filled`, `account_deleted`, `expired` | `L.status <> 'cancelled' and L.start_at < e.cancelled_at` (a session that had begun before this enrolment was cancelled; none for a cancel before the start) |

`W` = `make_interval(hours => venue_settings.cancellation_window_hours)` of the enrolment's branch.
**Amended 2026-10-02 (0292, DB-18, R75):** `e.kept_until` = `e.cancelled_at + W` with `W` as it was at
the cancel: `enrolment_cancel_internal` stamps it on every `guest_late` cancel (from `coaching_rules`, in
the same transaction), and 0292 backfilled the earlier ones from the window as it was then. A later
change of the window no longer moves what a leave keeps; the `if_cancelled` previews (a cancel now)
still use the live `W`, and a row with no stamp falls back to `e.cancelled_at + W` live.

`N_e` = the guest's own next covered session at the cancel (the first `L` in `S_e` by `start_at`
with `L.start_at >= e.cancelled_at` that was not cancelled then: `L.cancelled_at is null or
L.cancelled_at > e.cancelled_at`; a later venue cancel of `N_e` takes it out of the count through
the first condition and never promotes the session after it), kept whatever `W` says later (a later change
of the window moves only sessions after `N_e`, §15). DB decides `guest_late` against `N_e`
(C-23); the engine never re-judges the kind. The core twin is `courseLeaveRefund` (§7.1); for a
course leave `refund_due_online` implements it (R62).

`T_e` = the counting sessions, in `session_no` order. A no-show changes nothing here: it counts.

### 5.3 `app.lesson_enrolment_money(p_enrolment_id uuid) returns jsonb` (the engine)

Internal, `stable`, no locks; NULL for an unknown id. The one place that decides what an enrolment
owes, what the venue keeps and what goes back (CM-2, CM-3). Every other figure reads it: desk
reads (DB's `desk_lesson_detail`, `my_lesson`, `my_lessons`, `customer_lessons`,
`lesson_cancel_mine`'s `refund_iqd`/`kept_iqd`, X6–X8, X17–X18), `lesson_fee_remaining`,
`lesson_settle`, `lesson_refund_start`, `lesson_refunds_due`, `app.refund`'s lesson guard,
`deposit_attention`, `lesson_collected`, statements and reports.

Inputs:
- **Due** `due = Σ share(e, L)` over `T_e`.
- **Desk**: `desk_paid` = Σ `t.lesson_iqd` of tabs with `t.lesson_enrolment_id = e.id`,
  `t.status = 'settled'`, `t.merged_into_tab_id is null` (gross, the `court_fee_paid` filter,
  0242:1533-1538); `desk_refunded` = Σ `refunds.amount_iqd` on those tabs' payments.
- **Online**: the **applied** rows = `purpose 'lesson'`, this enrolment, `status in ('succeeded',
  'refund_pending', 'refund_failed', 'refunded')` and `refund_reason` not in (`amount_mismatch`,
  `duplicate_success`, `slot_lost`, `venue_offline`) (a row refunded for those never paid for the
  enrolment). `online_paid` = Σ `amount_iqd`; `online_refunded` = Σ `refund_amount_iqd` of applied
  rows in `refund_pending|refund_failed|refunded` (money promised back counts as gone, as
  `deposit_net_paid` does, 0258:703-704); `online_refundable` = Σ `amount_iqd` of applied rows still
  `succeeded`. `sandbox_net` = the same net over applied `sandbox` rows.
- **Payable**: `e.status = 'booked'` and some covered session is not cancelled, and, for a private
  or group enrolment, no `lesson_attendance` row `no_show` for it (CD-11: the desk collects nothing
  from a no-show; unmarking makes it payable again).

Figures:

```text
paid_gross        = desk_paid + online_paid
net               = paid_gross − desk_refunded − online_refunded
kept              = least(net, due)
real_kept         = greatest(kept − sandbox_net, 0)                      -- CM-15
owed              = payable ? greatest(due − paid_gross, 0) : 0          -- CM-2: gross
refund_due        = greatest(net − due, 0)
refund_due_online = least(refund_due, online_refundable)                 -- online first
refund_due_desk   = least(refund_due − refund_due_online, desk_paid − desk_refunded)
refund_blocked    = refund_due − refund_due_online − refund_due_desk     -- online money owed back on a
                                                                         -- row that had its one refund (CM-5)
final             = e.status = 'expired'
                    or (e.status = 'cancelled' and e.cancel_kind <> 'guest_late')
                    or every L in S_e has status in ('completed', 'cancelled')
alloc(e, L)       = iqd_split(real_kept, |T_e|)[position of L in T_e] for L in T_e, else 0
```

Identities (tested, §10): `kept + refund_due = net`; `refund_due = refund_due_online +
refund_due_desk + refund_blocked`; `kept ≤ due`; `owed ≤ due`; `Σ alloc = real_kept`.

**`if_cancelled`** (for X6/X8's "what a cancel now gives back"): for a `held` or `booked` enrolment,
the same figures recomputed as if it were cancelled now, once as `guest_free` and once as
`guest_late` (`cancelled_at = now()`); NULL otherwise. DB's `my_lesson` picks the one its own
cancel rule (C-9, C-23, R8) would apply; the engine never decides the kind.

Output:

```json
{ "enrolment_id": "uuid", "kind": "private|group|course", "status": "held|booked|cancelled|expired",
  "cancel_kind": null, "payment_mode": "desk|online", "price_iqd": 40000,
  "due_iqd": 40000, "payable": true, "final": false,
  "desk_paid_iqd": 0, "desk_refunded_iqd": 0,
  "online_paid_iqd": 40000, "online_refunded_iqd": 0, "online_refundable_iqd": 40000,
  "paid_gross_iqd": 40000, "net_iqd": 40000, "kept_iqd": 40000, "real_kept_iqd": 40000,
  "owed_iqd": 0, "refund_due_iqd": 0, "refund_due_online_iqd": 0, "refund_due_desk_iqd": 0,
  "refund_blocked_iqd": 0, "sandbox": false,
  "if_cancelled": { "guest_free": { "refund_iqd": 40000, "kept_iqd": 0 },
                    "guest_late": { "refund_iqd": 0, "kept_iqd": 40000 } },
  "sessions": [ { "lesson_id": "uuid", "session_no": 1, "start_at": "…", "status": "scheduled",
                  "share_iqd": 40000, "counts": true, "alloc_iqd": 40000 } ] }
```

The key list is `LESSON_ENROLMENT_MONEY_KEYS` in `packages/core/src/coaching/shapes.ts` (R41).

No name, phone or guest id: it is a money engine. Readers add identity themselves under their own
rules.

### 5.4 `lesson_fee_remaining`, `lesson_collected` (internal)

```sql
-- §1.5. What the enrolment still owes at the desk with one tab left out (the court_fee_remaining
-- shape). The left-out tab is only ever the live tab being totalled (compute_tab_totals runs before
-- settle_tab stamps it), which desk_paid never counts; a settled lesson tab of e is added back.
app.lesson_fee_remaining(p_enrolment_id uuid, p_exclude_tab_id uuid default null) returns bigint   -- plpgsql stable
  = case when not (m->>'payable')::boolean then 0
         else greatest((m->>'due_iqd')::bigint - (m->>'paid_gross_iqd')::bigint
                       + coalesce((select t.lesson_iqd from tabs t
                                    where t.id = p_exclude_tab_id and t.lesson_enrolment_id = p_enrolment_id
                                      and t.status = 'settled' and t.merged_into_tab_id is null), 0), 0) end
    -- m = app.lesson_enrolment_money(p_enrolment_id); 0 for an unknown id

-- Addition (§14). The money one lesson (one session) collected: Σ alloc(e, L) over every
-- enrolment covering it, whatever its status (a late canceller's kept money counts).
app.lesson_collected(p_lesson_id uuid) returns bigint                                               -- plpgsql stable

-- R37. True while the branch still has coaching money to settle; DB's close_branch (0277) refuses
-- BRANCH_HAS_BOOKINGS detail coaching_money when it is (binds late: 0277 calls a 0278 function).
app.lesson_money_open(p_venue_id uuid) returns boolean                                              -- plpgsql stable
  = exists (select 1 from coach_statements s where s.venue_id = p_venue_id and s.status in ('draft','approved'))
    or exists (<a statement lesson (§7.1) of the branch, any month up to now, whose (coach_id, venue_id,
               local month) has no non-void statement>)
    or exists (select 1 from lesson_enrolments e where e.venue_id = p_venue_id
                 and (exists (select 1 from tabs t where t.lesson_enrolment_id = e.id and t.status = 'settled')
                      or exists (select 1 from booking_payments bp where bp.lesson_enrolment_id = e.id
                                   and bp.status in ('refund_pending','refund_failed','refunded')))
                 and ((m->>'refund_due_desk_iqd')::bigint > 0 or (m->>'refund_blocked_iqd')::bigint > 0))
  -- Amended 2026-10-02 (0292; R37 amended, build-contracts §1.15 D6): also true while a lesson
  -- booking_payments row of the branch is refund_pending (DB-19), or while a (coach, branch) pair
  -- (coach_branches, plus coaches with a lesson there in 13 months) has an is_adjustment line in
  -- coach_statement_plan(coach, branch, the branch-local month now): money that moved on a lesson of
  -- a month already paid, not yet drafted (DB-19). The third test runs the engine only on the places
  -- app.lesson_enrolment_may_owe lets through (DB-15, §5.11).
    -- m = app.lesson_enrolment_money(e.id); the two cheap tests first, so the engine runs only on
    -- enrolments that took desk money or had an online refund
```

### 5.5 `app.lesson_refund_start(p_enrolment_id uuid, p_reason text) returns int`

R5 as amended by R28 (no `from`). Internal, 0278. The only path that refunds online lesson money
for a coaching reason (CM-5); it replaces the `lesson_refund_online` of earlier drafts. Returns the
refunds started (0 or 1). **Called after** the caller's status writes, in the same transaction, by:

- DB's `enrolment_cancel_internal` (its enrolment, every kind), `lesson_cancel_internal` and
  `course_cancel_internal` (**every** enrolment of the lesson or course that has an applied online
  row, **live or not**, R28): a `guest_late` enrolment is refunded when the venue later cancels a
  session it kept, and a late course leave refunds its outside-window shares at once (C-23).
  Through them: guest,
  coach and desk cancels, the under-filled sweep, coach retirement (`coach_retired`, C-25) and the
  sweep's `account_deleted` item (CD-12; `delete_my_account` itself calls nothing of Money's, D9);
- the reconciler's net (§6.6).

It takes **no coach or court lock** (the cancel callers hold `lock_coach` only, R6; the reconciler
holds neither), so it never waits behind a coaching path while holding a payment row. It is
idempotent: a second call on the same enrolment finds nothing due (the first refund's amount
already counts as gone) and returns 0, so a lesson cancel that reaches an enrolment both through
`enrolment_cancel_internal` and through its own loop refunds once.

1. Lock the enrolment's applied `succeeded` rows `for update` (id order).
2. `m := lesson_enrolment_money(p_enrolment_id)`; `v_amount := refund_due_online_iqd` (R28: always
   the engine's amount, which implements C-23 for a course leave). 0 → return 0.
3. The reason is **always derived** (R28). `p_reason` exists for the signature; callers pass NULL,
   and a non-NULL value outside the lesson set is `INVALID_ARGUMENT` detail `p_reason` (it never
   overrides the derivation):

   | Enrolment | Reason |
   | --- | --- |
   | `cancelled`, `guest_free` | `guest_cancel` |
   | `cancelled`, `coach` / `staff` / `under_filled` / `account_deleted` | `coach_cancel` / `staff_cancel` / `under_filled` / `account_deleted` |
   | `cancelled`, `course_cancelled` | from `courses.cancel_reason`: `coach_cancel`, `coach_retired` → `coach_cancel`; `staff_cancel` → `staff_cancel`; `under_filled` → `under_filled`; `account_deleted` → `account_deleted`; anything else `staff_cancel` |
   | `cancelled`, `guest_late`, a counted session since cancelled by the venue | from that lesson's `cancel_reason` as above |
   | `cancelled`, `guest_late`, otherwise (a course leave, C-23) | `guest_cancel` |
   | `expired` | `slot_lost` |

4. On the one refundable row (an enrolment has at most one applied row: a second success is
   `duplicate_success`): `app.deposit_begin_refund(row, reason, case when v_amount = amount_iqd then
   null else v_amount end, 'lesson')` (0242:165-207; partial when less than the row);
   `app.deposit_nudge()`; one `lesson_events` row `refunded` (`code` = reason, data `{payment_id,
   amount_iqd}`, actor as the caller's) through DB's `app.lesson_event`; no push (R40: the trigger
   maps no key to `refunded`). Return 1.

**C-19 fits the one-refund rule.** Cancelling the rest of a course is a terminal event for each
enrolment: `due` drops to the shares of the sessions already held and never moves again, so the
remaining shares go back in **one** partial refund per payment row (`refund_amount_iqd` = Σ the
cancelled sessions' shares). `refund_due` can only grow while a covered session is still to come
(a cancel, under-filled, a venue cancel after a late cancel); `final` is false exactly then, and
CM-5 keeps manager refunds out of that window, so the one refund a row allows is available to the
cancel that needs it. The one exception is a late course leave (C-23), which refunds before its
kept next session `N_e` is over: if the venue then cancels `N_e`, its share has no refund left on
the row and shows as `refund_blocked_iqd` in `lesson_refunds_due` (§5.11, §15).

### 5.6 `compute_tab_totals` (drop + create, from 0262:413)

The return type gains a sixth column, `lesson_iqd bigint`, appended last, so the function is
dropped and created (the 0053:53-54 precedent):

```sql
drop function if exists app.compute_tab_totals(uuid);
create function app.compute_tab_totals(p_tab_id uuid)
returns table (subtotal_iqd bigint, discount_iqd bigint, tax_iqd bigint, court_iqd bigint,
               total_iqd bigint, lesson_iqd bigint)
-- body: 0262:421-528 verbatim, $compute_tab_totals_0278$, plus after the court line (0262:460-466):
  select case when t.kind = 'lesson' then app.lesson_fee_remaining(t.lesson_enrolment_id, t.id) else 0 end
    into v_lesson from tabs t where t.id = p_tab_id;
  v_lesson := coalesce(v_lesson, 0);
-- and the result (0262:519-526):
  lesson_iqd := v_lesson;
  total_iqd  := greatest(v_subtotal - v_discount + case when coalesce(v_inclusive, false) then 0 else v_tax end, 0)
                + v_court + v_lesson;
revoke all on function app.compute_tab_totals(uuid) from public, anon, authenticated;
grant execute on function app.compute_tab_totals(uuid) to service_role;   -- 0262:531; a drop forgets it
```

The lesson line is outside `subtotal_iqd` (no discount applies) and outside the tax base (CD-4),
exactly as the court line.

**Why an extra column is safe for every caller.** PL/pgSQL binds a call at run time and keeps no
`pg_depend` row on the functions it calls; no view or SQL-language function references
`compute_tab_totals` (the only views near it, `venue_settings_public` 0026:826 and
`v_day_close_summary` 0106:1061, do not); the drop needs no cascade. Every latest caller reads the
result by column name or into a `record`, never `select *` into a row type or a scalar list:
- `select * into v_totals` with `v_totals record`: `settle_tab` (0244:325, :369), `settle_zero_tab`
  (0244:467, :515), `booking_bill` (0262:1099, :1135) and the older bodies at 0217:409/452,
  0217:548/595, 0212:150/183, 0231:415/444, 0120:183/222, 0242:1563/1594;
- by name: `select t.subtotal_iqd …` / `t.total_iqd …` (0244:731, :760, :885; 0217:805, :834, :974,
  :1098), `select t.court_iqd …` (`match_seat_settle`, 0262:727), `tt.total_iqd` in
  `booking_bill_states`' lateral (0262:1343-1347);
- outside SQL: `bench/areas/cafe.ts:156` (service role, reads the row), `tests/matches-money.test.ts:
  428-434` (`to_jsonb(t)` with `toMatchObject`, which ignores an extra key).
A non-lesson tab returns `lesson_iqd = 0` and every other column unchanged (invariant L12).
`types.gen.ts` changes (`compute_tab_totals` Returns gains `lesson_iqd`).

### 5.7 `settle_tab` (from 0244:312)

Verbatim (`$settle_tab_0278$`) plus the stamp (0244:379-386) gains `lesson_iqd = v_totals.lesson_iqd`
and the result (0244:445-450) gains `'lesson_iqd', v_tab.lesson_iqd`. `assert_tab_kind_role(
v_tab.kind)` (0244:361) already admits cashier, court_desk, manager and owner for any kind but
`shop` (0244:48-57) and refuses shop_staff (`TAB_KIND_FORBIDDEN`), so a lesson tab needs no role
change. Grants unchanged (create or replace).

`settle_zero_tab` and `cancel_tab` are **not** re-issued: a lesson tab is never live after a commit
(CM-1), so neither can reach one. `open_tab` cannot create one either: it refuses `p_kind 'lesson'`
with `INVALID_ARGUMENT` detail `p_kind` (0244:101-103), and DB's 0277 re-issue keeps that check.

### 5.8 The no-goods wall: `trg_match_booking_no_cafe` (from 0262:1413)

```sql
create or replace function app.trg_match_booking_no_cafe() returns trigger   -- $trg_match_booking_no_cafe_0278$
  … declare v_kind text; v_res uuid;
  if new.tab_id is not null then
    select t.kind, t.reservation_id into v_kind, v_res from tabs t where t.id = new.tab_id;
    -- 0278 (CM-1): a lesson tab carries the lesson line only.
    if v_kind = 'lesson' then
      raise exception 'LESSON_TAB_NO_GOODS' using errcode = 'P0001',
        hint = 'a lesson is paid on its own bill; café items go on a café bill';
    end if;
    if v_res is not null and exists (select 1 from matches m where m.reservation_id = v_res) then
      raise exception 'MATCH_BOOKING_NO_CAFE' …            -- 0262:1421-1422 verbatim
    end if;
  end if;
  return new;
```

The two triggers (`orders_match_booking_no_cafe`, `tab_adjustments_match_booking_no_cafe`,
0262:1432-1440) are unchanged: `create or replace` keeps the binding. It catches every path a goods
line or an adjustment could take onto a lesson tab (`till_add_items`, `merge_tabs`,
`place_floor_order`, `apply_discount`, a promotion, a queued replay). One primary-key probe of
`tabs` per order insert.

### 5.9 `cafe_settled_tabs` (from 0219:31)

Verbatim (`$cafe_settled_tabs_0278$`) plus one predicate in the `where` (0219:67): `and t.kind <>
'lesson'`. Same result type, so `create or replace`. Without it a settled lesson tab counts its
whole `total_iqd` as `cafe_gross_iqd` (0219:57) and every refund on it as a café refund (0219:61-66),
in `reports_figures`, `report_revenue`, `panel_*`, the café analytics and every other reader listed
at 0219:197-1525. `analytics_sales_lines` needs nothing: it reads order lines, and a lesson tab has
none.

### 5.10 `app.lesson_settle(…) returns jsonb` (§1.7)

```sql
lesson_settle(p_enrolment_id uuid, p_method payment_method, p_expected_owed_iqd bigint,
              p_tendered_iqd bigint default null, p_idempotency_key text default null,
              p_device_id text default null)
```

Cashier, court_desk, manager, owner (capability `takeLessonPayment`); not shop_staff. Online only
(CD-6). Modelled on `match_seat_settle` (0262:542-784). Refusals and steps, in order:

1. `FORBIDDEN`: not `is_staff('cashier','court_desk','manager','owner')`.
2. `INVALID_ARGUMENT`: `p_enrolment_id` NULL; `p_method` NULL; `p_expected_owed_iqd` NULL or < 1;
   `p_idempotency_key` NULL (detail = the argument name; a money write is always keyed, as C16 made
   `match_seat_settle`'s, 0262:596-599).
3. `ENROLMENT_NOT_FOUND`: unknown, or its branch not in `app.visible_venue_ids()`.
4. `VENUE_MISMATCH` unless `is_staff_at(e.venue_id, …)`; then `set_config('app.venue_id',
   e.venue_id::text, true)`.
5. `app.claim_replay(p_idempotency_key, 'lesson_settle')`: a replay returns the stored result
   (`duplicate: true`); `IDEMPOTENCY_CONFLICT`.
6. `NO_OPEN_DAY`: `v_day := app.current_open_day_locked(e.venue_id)` (the enrolment's branch).
7. `app.lock_coach(v_coach)` (0275, R6; the coach of the lesson or course, read unlocked: it never
   changes, §1.4).
8. Re-read the enrolment and its lesson or course under the lock. `LESSON_NOT_PAYABLE` with detail:
   `held` (pay online, or it expires), `expired`, `cancelled` (the status), `lesson_cancelled`
   (every covered session cancelled), `no_show`.
9. `v_owed := (lesson_enrolment_money(e)->>'owed_iqd')`. 0 → `LESSON_NOT_PAYABLE` detail
   `nothing_owed`. `v_owed <> p_expected_owed_iqd` → `LESSON_OWED_CHANGED` detail `expected X, now
   Y`.
10. Insert the tab: `insert into tabs (venue_id, day_session_id, lesson_enrolment_id, label,
    opened_by_staff_id, device_id, kind) values (e.venue_id, v_day, e.id, 'Lesson', auth.uid(),
    p_device_id, 'lesson')`. A `unique_violation` on `tabs_one_live_per_enrolment` (impossible
    under the coach lock unless a tab was written outside this function) → `LESSON_OWED_CHANGED`
    detail `tab_open`. The label is fixed: no student name on a till row.
11. `compute_tab_totals(tab).lesson_iqd <> v_owed` or `total_iqd <> v_owed` → `LESSON_OWED_CHANGED`.
12. `v_settle := app.settle_tab(tab, p_method, p_tendered_iqd, v_owed, p_idempotency_key,
    p_device_id, v_owed)`: `TENDER_SHORT`, `TENDER_CARD`, the till-shift stamp's refusals (0205),
    `TOTAL_CHANGED`. A `duplicate` answer or a status other than `settled` → `IDEMPOTENCY_CONFLICT`
    (the key names another payment; 0262:737-742).
13. One `lesson_events` row `settled` (data `{enrolment_id, payment_id, tab_id, amount_iqd,
    method}`); audit `lesson.settle` (same data plus `lesson_id`, `course_id`); `finish_replay`.

Returns `{duplicate: false, payment_id, tab_id, enrolment_id, amount_iqd, change_iqd, method,
owed_iqd: 0, status: 'settled'}`.

The direct insert (not `open_tab`) names the enrolment's branch and open day, as
`match_seat_settle` names the match's (0262:697-699). No push: the guest is at the desk, and the
`lesson_events_notify` trigger maps no key to `settled` (R40).

### 5.11 `app.lesson_refunds_due(p_venue_id uuid default null) returns jsonb` (§1.7)

Guard first (R57): `FORBIDDEN` unless `is_staff('manager','owner')`; then `v_venue :=
coalesce(p_venue_id, app.current_venue())`; `VENUE_MISMATCH` unless `is_staff_at(v_venue, 'manager',
'owner')`. Money the venue owes back at the till: enrolments of the branch with
`refund_due_desk_iqd > 0` or `refund_blocked_iqd > 0` (the engine runs only on enrolments with a
settled lesson tab or an online row in `refund_pending|refund_failed|refunded`), oldest lesson
first. **Amended 2026-10-02 (0292, DB-15):** the engine runs only on the enrolments
`app.lesson_enrolment_may_owe` lets through: that paid-money condition AND (the place is no longer
`booked`, or a covered session is cancelled or expired, or desk plus applied online money is above
`price_iqd`). It is exact: a booked place with every session on is due its whole price (§5.2), so
nothing goes back unless it was overpaid. `lesson_money_open` (test 3) and the day close's
`refunds_due_desk_*` use the same gate. Shape X21: Money's envelope plus `phone` (and the operator's `type_name_*`, `cancelled_at`):

```json
{ "venue_id": "uuid", "total_iqd": 40000,
  "items": [ { "enrolment_id", "lesson_id", "course_id", "kind", "coach_id",
               "coach_name_en", "coach_name_ar", "type_name_en", "type_name_ar", "start_at",
               "label", "phone", "cancel_kind", "cancelled_at",
               "refund_due_iqd", "refund_due_desk_iqd", "online_blocked_iqd",
               "payments": [ { "payment_id", "tab_id", "method", "amount_iqd", "refunded_iqd",
                               "refundable_iqd", "created_at" } ] } ] }
```

`label` and `phone` follow R44: for `booked_by_kind in ('coach','staff')` the typed `guest_name`
and `guest_phone`, never the profile's; for a guest's own booking the profile's `full_name` and
`phone`; a walk-in's typed name. Staff see phones (C-16 limits coaches only). `online_blocked_iqd`
is the engine's `refund_blocked_iqd` (online money that cannot go back through Qi, §5.5): it has no
desk payment to refund and is handed back outside the till (§15). `total_iqd` = Σ
`refund_due_desk_iqd` + Σ `online_blocked_iqd`. Key list `LESSON_REFUNDS_DUE_KEYS` in `shapes.ts`.

The operator refunds each desk payment with `app.refund(payment_id, amount, pin, 'lesson_refund',
…)` (manager PIN; `NO_OPEN_DAY` when the branch has no open day), capped by `refund_due_desk_iqd`
(§5.12).

### 5.12 `app.refund` (re-issued from 0217:34, R36)

`$refund_0278$`, verbatim plus, for a payment on a `kind 'lesson'` tab:
- **Lock.** After `current_open_day_locked()` and `consume_pin_grant` (0217:95-104) and before the
  tab lock (0217:111-117): resolve, unlocked, `t.kind` and `t.lesson_enrolment_id` of the
  payment's tab and the enrolment's coach (none of them ever changes); `if v_kind = 'lesson' then
  perform app.lock_coach(v_coach); end if;`. The order stays `day_sessions → coach_advisory → tabs →
  payments → till_shifts → refunds` (§1.4).
- **Bound.** After the `REFUND_EXCEEDS_PAYMENT` test (0217:122-127): `m :=
  lesson_enrolment_money(e)`; `p_amount_iqd > m->>'refund_due_desk_iqd'` → `REFUND_EXCEEDS_DUE`
  (detail `due <n>`) unless `p_reason_code = 'lesson_goodwill'` (a manager's goodwill refund beyond
  what is due, PIN as always). Two tills, or a queued `payment.refund` replayed after another
  manager paid, can then never refund the same due twice; the replay records the refusal as a
  conflict (R22: the mutation keeps its queue behaviour).
- Every other tab kind: unchanged (the lesson branch is skipped at run time). Signature, grants and
  `PIN_GATED_RPCS` membership unchanged (`create or replace`).

Reason codes on a lesson payment: `lesson_refund` (what is due) and `lesson_goodwill` (beyond it).

### 5.13 The refund day (C-31, R27): `close_day` and `v_day_close_summary`

A refund is counted on the day it is made, for every kind of refund (café, court, lesson): the day
of the till shift it was made in, else the payment's day:
`coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id),
p.day_session_id)`. Both re-issues are verbatim plus that predicate in place of `p.day_session_id =
<day>` on the refunds side only (payments stay on `p.day_session_id`):
- **`close_day`** (from 0216:114, `$close_day_0278$`): the two refund sums (0216:191-193 cash,
  0216:196-198 card). Same signature and result, `create or replace`; the `till_shifts` join is a
  plain read beside the existing `till_shifts … for update` (0216:177), so no new lock.
- **`v_day_close_summary`** (from 0106:1061, `create or replace view`, same columns): the `ref`
  lateral (0106:1080-1084).
- **`day_close_online`** has no till refund today (0265:155 counts online money only); its new
  `lessons` block dates desk refunds the same way, in its one re-issue in 0285 (§8.6), so §1.8's
  "each function once" holds.

Closed days keep their stored figures (`cash_expected_iqd`, `cash_variance_iqd`, …); the view's
derived `refunds_iqd` of a day closed before 0278 is re-dated by the new rule. Readers R27 does not
name still date by the payment's day: `ops_overview`'s `expectedCashIqd` (0219:1254, :1416-1419) and
`day_close_shop` (0246:450, :489-493) (§14, for the merge).

Tests (R27): `desk-payment.test.ts` gains a café tab paid on day 1 and refunded on day 2 (day 2's
`close_day` expected cash and `v_day_close_summary.refunds_iqd` carry it; day 1's do not; day 1's
stored figures unchanged); `coaching-money.test.ts` the same for a lesson tab (R1b, §10).

### 5.14 Gates that travel with 0278

- `tests/rls-matrix.ts` drop 25: `lesson_settle` inline `ex('guarded', {anon:'denied',
  cashier:'execute', court_desk:'execute', manager:'execute', owner:'execute'})` with args
  `{p_enrolment_id: NIL_UUID, p_method: 'cash', p_expected_owed_iqd: 10000, p_tendered_iqd: 10000,
  p_idempotency_key: 'matrix-lesson-settle'}` (a nil enrolment is `ENROLMENT_NOT_FOUND` before the
  key is claimed); `lesson_refunds_due` `MANAGER_UP`. `fixtures/rpc-allowlist.json` `guarded` gains
  both; `check:rpc-registry --update-floor`.
- `fixtures/assistant-coverage.json`: `lesson_settle`, `lesson_refunds_due` → `map:action`;
  `iqd_split`, `lesson_coach_share`, `course_late_join_price`, `course_share_for`,
  `lesson_enrolment_money`, `lesson_fee_remaining`, `lesson_collected`, `lesson_refund_start`,
  `lesson_money_open` → `excluded: internal — the coaching money engine (0278), reached only through
  the desk and report RPCs` (where the inventory lists them). `split_evenly` keeps its entry
  untouched (the till RPC). `compute_tab_totals`, `settle_tab`, `cafe_settled_tabs`,
  `trg_match_booking_no_cafe`, `refund`, `close_day`, `v_day_close_summary` keep theirs.
- No `fixtures/rpc-overloads.json` entry (R60).
- Error codes: operator `MAPPED_CODES` (`op/lib/errors.ts:10`) + both `ws` coaching catalogs:
  `LESSON_OWED_CHANGED`, `LESSON_NOT_PAYABLE` (the copy branches on the detail, `nothing_owed`
  included: X31), `LESSON_TAB_NO_GOODS`, `ENROLMENT_NOT_FOUND`, and the new `REFUND_EXCEEDS_DUE`
  (also on the queued `payment.refund` conflict copy); mobile `CODE_TO_KEY` gets
  `LESSON_NOT_PAYABLE` (the phone can see it from `lesson-begin`, §6.7).
- `check:locks`: `lesson_settle` prints `day_sessions → coach_advisory → tabs → payments`, and
  `refund` gains `coach_advisory` after `day_sessions` (§9). `app.lock_coach` and the gate edit are
  in the tree from the 0275 commit (R6).
- `check:safeupdate`: every UPDATE has a WHERE. `tests/coaching-money.test.ts` (§10);
  `cafe-money.test.ts`, `matches-money.test.ts` unmodified; `desk-payment.test.ts` gains R27's
  café case (§5.13) and any case asserting the old payment-day dating is updated in the same
  commit; `pnpm db:types`.

## 6. 0281 `lesson_online_payment`

### 6.1 The payment end to end (reserve first, then pay)

```text
phone: lesson_book_private / lesson_join / course_join with p_payment_mode 'online'   (DB, 0280;
       hold cap under lock_principal('hold_slot'), R30; lessons terms, R50)
  private: lessons 'held' + reservations kind 'hold' (lesson_id set) + lesson_enrolments 'held'
  group, course: lesson_enrolments 'held' (a place counted)
phone → POST lesson-begin {enrolment_id, locale} → app.lesson_payment_prepare
  → createAtGateway → app.deposit_mark_created → 200 {request_id, form_url, …}
  → the phone opens form_url and polls deposit-status
Qi → deposit-webhook | deposit-status poll | deposit-reconcile → app.deposit_apply (lesson branch)
  SUCCESS → app.lesson_settle_success: hold → kind 'lesson' 'confirmed'; lesson 'scheduled';
            enrolment 'booked'; lesson_events 'paid_online'      (or a refund, §6.4)
  FAILED  → the hold stays until hold_expires_at; the guest may try again (3 attempts)
  EXPIRED → app.lesson_hold_expire: enrolment (and a private lesson and its hold) 'expired';
            lesson_events 'expired'; a lapsed_hold strike (R30)
```

The payment window is `venue_settings.deposit_window_seconds` (default 900, as 0242:399, 0242:408).
The pushes follow the events: Guest's `lesson_events_notify` trigger queues `coach.new_student` for
`paid_online` and `lesson.payment_expired` for `expired` (R40); no Money body calls
`lesson_notify` or `lesson_sync_reminders` here.

### 6.2 `app.lesson_payment_prepare(p_guest_id uuid, p_enrolment_id uuid, p_locale text, p_provider text) returns jsonb`

R3. Service role only (edge `lesson-begin`, on behalf of the JWT user), the shape of its two
sibling prepares: the gateway needs both the locale and the provider, and the edge reads `reused`,
`guest_phone` and `guest_name`, exactly as from `deposit_prepare` (0242:327-440) and
`ticket_payment_prepare` (0259:41-172).

Refusals and steps, in order:
1. `INVALID_ARGUMENT`: `p_guest_id` or `p_enrolment_id` NULL; `p_provider` not `qi`/`fake` (detail
   `p_provider`).
2. `ACCOUNT_REQUIRED`: no profile, or `deleted_at` set.
3. `ENROLMENT_NOT_FOUND`: unknown, or `guest_id <> p_guest_id` (someone else's reads the same as
   none, 0242:280-285).
4. `app.lock_coach(v_coach)`; for a private lesson's hold, `app.lock_court(hold.court_id)` and the
   hold row `for update` (coach → court → reservations, the `deposit_prepare` shape 0242:351-352);
   `set_config('app.venue_id', e.venue_id::text, true)`.
5. The enrolment's live attempt (`purpose 'lesson'`, `created|pending`, `for update`) → return it
   with `reused: true` (a double tap; the edge handles a stale one, §6.7).
6. `LESSON_NOT_PAYABLE` detail: `booked`, `cancelled`, `expired` (the status) unless `held`;
   `desk` when `payment_mode <> 'online'`; `expired` when `hold_expires_at < now()` or a private
   lesson's hold row is no longer `pending` (expired by TTL, R25); `free` when `price_iqd = 0` (DB
   never makes a free enrolment online).
7. `COACHING_OFF` when the branch's `coaching_enabled` is false; `ONLINE_PAYMENT_OFF` when its
   `lesson_payment_mode = 'desk'` (the owner switched online off after the hold was taken).
8. `PHONE_REQUIRED`: blank `profiles.phone` (0242:385-389).
8a. `TERMS_REQUIRED` (C-26, R50): `platform_settings.lesson_terms_version` is NULL, or the guest's
    `profiles.terms_version` is below it (the (date, revision) comparison of `match_terms_ok`,
    0257:157, against `lesson_terms_version`; NULL refuses here, unlike `match_terms_ok`). The same
    test `lesson_guest(true)` makes on DB's online booking paths; online lesson money is never taken
    before the lessons terms are live and accepted.
8b. **Added 2026-10-02 (0295, DB-35):** `LESSON_NOT_PAYABLE` detail `started` when the first
    covered session has started (`start_at <= now()`) or the place covers none: a SUCCESS could only
    be `slot_lost`, so no attempt is opened. Clients read the detail as the generic "can't be paid"
    line.
9. `app.assert_not_degraded_for(<first covered session's start_at>, e.venue_id)` →
   `DEGRADED_LOCKOUT`.
10. `TOO_MANY_ATTEMPTS`: three or more lesson rows already on the enrolment (the per-hold rule,
    0242:393-397).
11. Insert: `(venue_id e.venue_id, reservation_id NULL, hold_id <private: the hold row, else NULL>,
    lesson_enrolment_id e.id, guest_id, purpose 'lesson', ticket_count NULL, provider, sandbox =
    profiles.payment_sandbox, request_id gen_random_uuid(), amount_iqd = owed (= e.price_iqd: no
    part payments), quoted_price_iqd = e.price_iqd, locale ('en' or 'ar'), status 'created',
    deadline_at = now() + deposit_window_seconds)`. A `unique_violation` on
    `booking_payments_one_active_lesson` or `booking_payments_one_active` re-reads the live row and
    returns it as `reused`.
12. The window owns the hold: `hold_expires_at := greatest(hold_expires_at, deadline_at)` on the
    enrolment, a private lesson and its hold row (0242:411-414). `reservations.hold_expires_at` is
    not a column `reservations_match` fires on (0263:169), and the row stays `pending`.
    **Amended 2026-10-02 (0295, DB-35):** never past the first covered session's start:
    `greatest(hold_expires_at, least(deadline_at, <start>))`. The attempt's own `deadline_at` is
    unchanged.
13. Event `begin` (`deposit_event`); audit `lesson.payment_begin` `{payment_id, enrolment_id,
    amount_iqd, sandbox}`.

Returns `{id, request_id, purpose: 'lesson', status, provider, sandbox, amount_iqd, deadline_at,
form_url, provider_payment_id, locale, reused, enrolment_id, lesson_id, course_id, guest_phone,
guest_name}`.

### 6.3 `deposit_apply` (re-issued from 0267:23): the lesson branch

`$deposit_apply_0281$`. Everything in 0267:23-160 stays, including the 0267 payment-id check
(0267:57-62). The changes, each marked 0281:

**Locks (R33, R34).** Written so the text is monotone in the declared order whichever branch runs
(the walker reads the body linearly, §9): the coach first, then every court, then every
reservations row `FOR UPDATE`, then `match_expire_holds`, then the payment row and the writes. The
current block (0267:64-75) becomes:

```sql
if v.purpose = 'lesson' then
  -- 0281: the coach of the enrolment (§1.4) and a private lesson's period; neither ever changes
  -- under a held or expired enrolment, so the unlocked read is sound.
  select coalesce(l.coach_id, c.coach_id), l.period into v_coach, v_period
    from lesson_enrolments e left join lessons l on l.id = e.lesson_id left join courses c on c.id = e.course_id
   where e.id = v.lesson_enrolment_id;
  perform app.lock_coach(v_coach);
end if;
if v.purpose = 'deposit' then
  select * into r from reservations where id = v.reservation_id;
  perform app.lock_court(r.court_id);                         -- 0267:67
elsif v.purpose = 'lesson' and v.hold_id is not null then
  v_locked := app.lesson_lock_branch_courts(v.venue_id);     -- DB 0280, R34: every active court, id order; returns them
end if;
if v.purpose = 'deposit' then
  perform 1 from reservations where id in (v.reservation_id, v.hold_id) order by id for update;   -- 0267:68
elsif v.purpose = 'lesson' and v.hold_id is not null then
  perform 1 from reservations where id = v.hold_id for update;
  perform app.match_expire_holds(v.venue_id, v_period);      -- R33: after the row lock, before any write;
end if;                                                       -- clears stale holds before a re-pick
select * into v from booking_payments where id = v.id for update;
if v.purpose <> 'ticket' then
  perform set_config('app.venue_id', v.venue_id::text, true);
end if;
```

A private lesson takes **every** court of the branch because a swept hold re-picks a court (§6.4),
and the pick chooses only from `v_locked` (R34). `match_expire_holds` (0268:71, its orphan clause
`(r.guest_id is null and r.lesson_id is null)` after DB's 0277, R25) skips this payment's own hold
while the payment is inside its ten-minute grace; past it, it expires that hold too and §6.4
re-picks. A group or course payment takes the coach lock only: places are serialised by the coach
mutex.

**SUCCESS** (0267:110-129): the amount test is shared (a mismatch is `amount_mismatch` on the whole
row; the enrolment stays `held` and expires on its own). Then, in this text order:
`if v.purpose = 'deposit' then deposit_settle_success; elsif v.purpose = 'lesson' then v_new :=
app.lesson_settle_success(v.id, v_locked); else ticket_settle_success; end if;`.

**FAILED** (0267:132-138): unchanged for every purpose (the hold stays).

**EXPIRED** (0267:140-154): the deposit hold release stays as it is; then `elsif v.purpose =
'lesson' then perform app.lesson_hold_expire(v.lesson_enrolment_id); end if;` (§6.5; it does
nothing while another attempt on the enrolment is live).

The result JSON gains `lesson_enrolment_id`. Comment re-issued with the lesson branch.

### 6.4 `app.lesson_settle_success(p_payment_id uuid, p_locked uuid[]) returns text` (§1.5, R29, R34)

Internal, service path. `p_locked` is the court set `deposit_apply` locked (NULL for a group or
course payment); the second argument is this pass's addition for R34 (§14). The caller holds the
coach lock, for a private lesson every court in `p_locked` and the hold row, has run
`match_expire_holds` (§6.3), and holds the payment row. **It takes no lock itself, no `FOR UPDATE`
on `reservations`, and calls nothing that does**: the walker walks it on its own (§1.4) and Rule 3
would refuse a reservations lock without a court lock (`scripts/lib/lock-order.mjs:285-295`). It
never raises on a valid row: a raise rolls back `deposit_apply`, the webhook answers 500 and the
reconciler loops (the `ticket_settle_success` rule).

1. `v` the row, `e` the enrolment, the lesson or course. A `guest_id` NULL or a profile with
   `deleted_at` → reason `account_deleted`.
2. **Duplicate**: another applied lesson row of `e` is `succeeded` (or refunded for a coaching
   reason) → `duplicate_success`.
3. **`e.status = 'held'`** (the normal case):
   - inside the degraded horizon (`assert_not_degraded_for` of the first covered start raises
     `DEGRADED_LOCKOUT`) → `venue_offline`;
   - first covered session already started → `slot_lost`;
   - group or course (R29): `app.lesson_places_taken(lesson, e.id)` (or
     `course_places_taken(course, e.id)`), the enrolment itself excluded, `+ e.party_size >
     max_places` → `slot_lost`;
   - private: the hold row `h` (`v.hold_id`) is `kind 'hold'`, `status 'pending'` → `update
     reservations set kind = 'lesson', status = 'confirmed', hold_expires_at = null where id = h.id`
     (same court and period: the exclusion is satisfied as it was). Otherwise (expired by TTL, R25):
     `v_court := app.lesson_pick_court(e.venue_id, lesson.period, p_locked)` (DB 0280, R34: a court
     of `p_locked` with **no live row**, holds included; a pure read); NULL → `slot_lost`; else
     insert the lesson's court row (the shape of DB's `lesson_create_internal`: `kind 'lesson'`,
     `status 'confirmed'`, `lesson_id`, `guest_id` NULL, `guest_name 'Lesson'`; a test compares the
     two shapes);
   - then `lessons.status 'held' → 'scheduled'`, `hold_expires_at := null` (private);
     `lesson_enrolments.status 'held' → 'booked'`, `hold_expires_at := null`.
4. **`e.status = 'expired'`** (a late SUCCESS after the window): revive when everything is still
   free (DB's state machines gain `expired → scheduled` and `expired → booked`, writer Money, R29):
   - private: the lesson's start is in the future; the coach is `active` and at the branch;
     `app.coach_available(coach, venue, period)` (DB 0279: hours, time off, no other live lesson; the
     expired lesson is not live); a court from `lesson_pick_court(…, p_locked)`; then the lesson
     `expired → scheduled` clearing `cancel_reason`, `cancelled_at` and `hold_expires_at`
     (`lessons_ended` requires them NULL off `cancelled|expired`; `lessons_coach_no_overlap` is the
     last word), its court row inserted, the enrolment `expired → booked`, `cancel_kind`,
     `cancelled_at`, `hold_expires_at := null`;
   - group: the lesson `scheduled` and in the future, `lesson_places_taken(lesson, e.id) +
     party_size ≤ max_places`; course: the course `open|running`, every covered session in the
     future, `course_places_taken(course, e.id) < max_places`; then the enrolment `expired →
     booked`, the same three columns cleared;
   - the revived enrolment's unsettled `lapsed_hold` strike (§6.5) is deleted (`… where ctid in
     (select ctid from lesson_strikes where enrolment_id = e.id and kind = 'lapsed_hold' and
     settled_at is null for update skip locked)`, R31): the guest did pay;
   - anything else → `slot_lost`.
   Steps 3 and 4 write inside one sub-block where `check_violation`, `unique_violation`,
   `exclusion_violation` → `slot_lost` and `DEGRADED_LOCKOUT` → `venue_offline` (R29).
5. **Any other enrolment state** (cancelled while the bank was thinking) → `slot_lost`.
5a. **Added 2026-10-02 (0295, DB-38):** before steps 3 and 4, a place whose branch is `closed`
    (`venues.status`; a paused branch is not caught) → `slot_lost`, so a late SUCCESS never revives
    a lesson at a closed branch.
5b. **Added 2026-10-02 (0295, DB-35; build-contracts §1.15 D5):** a place that was `held` and is
    refunded `slot_lost` or `venue_offline` ends now: the enrolment `expired` (`cancel_kind
    'expired'`), a held private lesson `expired` (`payment_expired`) with its hold row expired
    through `app.lesson_court_release(lesson, 'expired')` (skip locked; the row is the one
    `deposit_apply` holds), and one `expired` event, code `payment_expired`, data `{lesson_id,
    reason}` (the push trigger tells a refund from a lapse by `reason`). No strike. Before 0295 the
    place stayed `held`: payable again, and expired later by the sweep with a `lapsed_hold` strike on
    a guest who had paid. `amount_mismatch` never reaches this function (§6.3): that place stays
    `held` and expires on its own, with no strike (§6.5).
6. `status 'succeeded'`, `succeeded_at = coalesce(succeeded_at, now())`, `failure_code = null`.
7. A reason → `deposit_begin_refund(v.id, reason)` (whole row), `deposit_nudge()`, return
   `refund_pending`. Else: one `lesson_events` row `paid_online` through DB's `app.lesson_event`
   (`enrolment_id` e, `lesson_id` the enrolment's lesson or, for a course, its first covered
   session, `course_id`, actor `system`, data `{payment_id, amount_iqd}` plus `revived: true` on a
   revival); audit `lesson.paid_online`. Return `succeeded`. **No `lesson_notify` and no
   `lesson_sync_reminders` call** (R40, R18): the `paid_online` event makes the trigger queue
   `coach.new_student` (the coach learns of a student once paid; no guest push, the payment screen
   is open, X15), and the reminder triggers follow the status writes. **Amended 2026-10-02 (0296,
   DB-43):** X15 holds for a payment that lands while the screen is open. A revival (step 4,
   `revived: true`) also sends `lesson.booked` to the guest: by then the screen is long closed and
   the guest's last push was `lesson.payment_expired`. The `expired` event of step 5b (data
   `reason`) sends the guest no `lesson.payment_expired`: they paid, and the money goes back whole.

### 6.5 `app.lesson_hold_expire(p_enrolment_id uuid) returns boolean`

Addition (§14). Internal; the caller holds the coach lock (no court lock is needed: every write is
status-only; F23 struck the court precondition). The one definition used by `deposit_apply`'s
EXPIRED branch and by DB's `lesson_sweep` items 1–2 (0283; D8: not `enrolment_cancel_internal(…,
'expired')`), so the two cannot disagree. Returns false and changes nothing unless the enrolment is
`held`; also false while a lesson row of the enrolment is `created|pending` with `deadline_at >
now() − interval '10 minutes'` (the `expire_stale_holds` grace, 0268:48-51), or one is `succeeded`.
Otherwise:
- `lesson_enrolments`: `status 'expired'`, `cancel_kind 'expired'`, `cancelled_at now()`,
  `hold_expires_at null`;
- private: `lessons` `status 'expired'`, `cancel_reason 'payment_expired'`, `cancelled_at now()`,
  `hold_expires_at null`; its `pending` hold row expired whatever `hold_expires_at` says, never
  waiting (R25): `update reservations set status = 'expired' where id in (select id from
  reservations where lesson_id = l.id and kind = 'hold' and status = 'pending' for update skip
  locked)` (a hold locked by an expirer is being expired anyway; see §14 for the lock gate);
- a guest-booked enrolment (`booked_by_kind = 'guest'`, `guest_id` set; CD-2): DB's
  `app.lesson_strike_record(e.id, <the lesson, or a course's first covered session>,
  'lapsed_hold')` (R30; its existence check is `skip locked`, R31; `hold_strikes_settle` applies it
  later under the principal lock, never here). **Amended 2026-10-02 (0295, DB-35, DB-36;
  build-contracts §1.15 D5):** no strike when a lesson row of the enrolment ever succeeded
  (`succeeded_at` set: the guest paid, whatever happened to the money after: `slot_lost`,
  `venue_offline`, `amount_mismatch`), or when the branch now has `coaching_enabled` false or
  `lesson_payment_mode 'desk'` (the switch made paying impossible: §6.2 refuses both). A
  `lapsed_hold` whose enrolment still has a payment `created|pending` is left unsettled by
  `hold_strikes_settle` (DB-37), so the late SUCCESS of that payment can still withdraw it (§6.4,
  R65); one older than two days is settled uncounted as before;
- one `lesson_events` row `expired` (`enrolment_id`, `lesson_id` as in §6.4 step 7, `course_id`,
  actor `system`, code `payment_expired`). **No `lesson_notify` call** (R40): the trigger queues
  `lesson.payment_expired` to the guest.

### 6.6 The reconciler, the attention list, the status read, the refund outcome

**`deposits_due_for_reconcile`** (from 0258:841, `$deposits_due_0281$`): after the deposit loop
(0258:851-864), a second loop, the net for a coaching refund that never started:

```sql
for v_row in
  select bp.id, bp.lesson_enrolment_id from booking_payments bp
    join lesson_enrolments e on e.id = bp.lesson_enrolment_id
   where bp.purpose = 'lesson' and bp.status = 'succeeded'
     and (e.status in ('cancelled', 'expired')
          or exists (select 1 from lessons l where l.id = e.lesson_id and l.status = 'cancelled')
          or exists (select 1 from courses c where c.id = e.course_id and c.status = 'cancelled'))
     and (app.lesson_enrolment_money(e.id)->>'refund_due_online_iqd')::bigint > 0
   order by bp.id limit 20
     for update of bp skip locked
loop
  perform app.lesson_refund_start(v_row.lesson_enrolment_id, null);   -- refunds only what is due
end loop;
```

**No time window** (R28): a venue cancel can come weeks after a late cancel, and a cancel path
whose refund was lost must still be caught. The cheap tests run first (a cancelled or expired
enrolment, or a cancelled covered lesson or course), so the engine runs only on those; the
refund-due predicate keeps a late cancel's kept row (`succeeded` forever, nothing due) out of the
limit, so it never starves it. The cost grows with the kept rows of cancelled enrolments (§15).

**Amended 2026-10-02 (0295, DB-40):** the loop is the internal `app.lesson_refund_net()` (verbatim,
20 a run, `for update of bp skip locked`, returns the refunds started). `deposits_due_for_reconcile`
calls it in place of the loop, and `lesson_sweep` calls it every minute in its own exception block
(`db.md` §4.9.3): the reconciler only runs when `deposit_nudge` finds some payment open, so before
0295 a lost refund waited for another guest's payment.

Each output row (0258:886-902) gains `lesson_enrolment_id`. The comment says lesson rows join the
`check` and `refund` actions like any other.

**`deposit_attention`** (from 0258:969, `$deposit_attention_0281$`): the venue filter (0258:1010)
already admits lesson rows of the branch (`bp.venue_id = v_venue`). The not-live branch
(0258:1013-1014) gains a lesson twin: `or (bp.purpose = 'lesson' and bp.status = 'succeeded' and
<the enrolment is cancelled or expired, or its lesson or course cancelled> and
(app.lesson_enrolment_money(bp.lesson_enrolment_id)->>'refund_due_online_iqd')::bigint > 0)` (the
cheap test first, so the engine runs only on cancelled enrolments, not on every paid one). Items
gain `lesson_enrolment_id`, `lesson_id`, `course_id`, and the operator's `enrolment_id` (= the
enrolment) and `customer_id` (= its `guest_id`) (R41); for a lesson row `guest_name` / `guest_phone`
are the profile's `full_name` / `phone` (an online lesson row is always guest-booked, CD-1, so R44's
typed-name rule never applies) and `start_at` is the first covered session's (`court_name_*`
NULL). `deposit_refund_retry` and
`deposit_refund_manual` (0258:1027, :1083) already work on a lesson row: its branch is checked,
`lock_court(NULL)` is a no-op (0042:53) and the reservations lock reads no row.

**`deposit_status`** (from 0259:897, `$deposit_status_0281$`): the ownership test (0259:913-917) is
unchanged (the guest, or court_desk/manager/owner of the row's branch). A lesson row answers:

```json
{ "request_id": "uuid", "purpose": "lesson",
  "status": "created|pending|succeeded|failed|expired|refund_pending|refunded|refund_failed",
  "failure_code": null, "amount_iqd": 40000, "price_iqd": 40000, "rest_iqd": 0,
  "deadline_at": "…", "form_url": "…" ,
  "refund_reason": null, "refund_amount_iqd": null, "refunded_at": null, "sandbox": false,
  "deposit_mode": null, "attempts_left": 2, "hold_live": true, "reservation": null, "ticket_count": null,
  "lesson": { "enrolment_id", "enrolment_status", "kind", "lesson_id", "course_id", "start_at",
              "end_at", "venue_id", "coach_id", "coach_name_en", "coach_name_ar",
              "type_name_en", "type_name_ar" },
  "server_now": "…" }
```

The `lesson` block is X14's union (`DEPOSIT_STATUS_LESSON_KEYS` in `shapes.ts`, R41).
`attempts_left` = `greatest(3 − lesson rows on the enrolment, 0)`; `hold_live` = the enrolment is
`held` and `hold_expires_at > now()`; `start_at`/`end_at` are the first covered session's (a
course's first one). `coach_name_*` are the public display names, NULL once the coach is `retired`
(C-29, R63: a deleted or retired coach's name never reaches a guest surface); `coach_id` is a
`coaches.id`, never a profile id (R43). No court id (§1.6 keeps courts off guest reads). The deposit
and ticket branches are verbatim; the deposit branch's JSON is untouched.

**`deposit_refund_apply`** (from 0259:1002, `$deposit_refund_apply_0281$`): a lesson row takes the
ticket branch's lock (the row only, 0259:1028-1030), never a court or booking lock. On `succeeded`
(0259:1038-1075), a lesson row writes audit `lesson.refunded` `{amount_iqd, reason,
lesson_enrolment_id}` and nothing else: no push (the cancel already told the guest; §1.9 has no
refund key) and no ticket call. `failed`, `pending`, `unknown` are shared.

**`deposit_refund_request`** (from 0258:1155, `$deposit_refund_request_0281$`; §1.8, R22): after
`PAYMENT_NOT_FOUND`, a lesson row whose enrolment money is not `final` raises `PAYMENT_STATE` detail
`lesson_live` (CM-5). A final one proceeds as a deposit does (branch check, the no-op locks,
`deposit_begin_refund(…, 'staff_refund', p_amount_iqd)`).

**`expire_stale_holds` and `match_expire_holds`** (0268:33, :71) are DB's 0277 re-issues (R25): only
the orphan clause changes, to `(r.guest_id is null and r.lesson_id is null)`. A lesson hold then
expires by TTL like any hold, never as an orphan, and never while its payment row (`bp.hold_id =
r.id`, `created|pending`) is within ten minutes of its deadline (0268:48-51);
`lesson_payment_prepare` stretches `hold_expires_at` to the deadline (§6.2 step 12).

### 6.7 Edge `lesson-begin` (`fn/lesson-begin/index.ts` + `logic.ts`, `verify_jwt = true`)

A copy of `fn/ticket-begin/` (`index.ts`, 83 lines; `logic.ts`, 136), changed only where named:

`POST {enrolment_id, locale}` → 200 `{request_id, form_url, amount_iqd, deadline_at, status:
'pending', reused, enrolment_id}`. `enrolment_id` must be a uuid (`isUuid`, else 400 `BAD_REQUEST`);
`locale` is `en`, anything else `ar` (as `parseTicketBegin`, logic.ts:22-28).

| HTTP | Codes |
| --- | --- |
| 400 | `BAD_REQUEST`, `INVALID_ARGUMENT`, `PHONE_REQUIRED` |
| 401 | `AUTH_REQUIRED` |
| 403 | `ACCOUNT_REQUIRED`, `TERMS_REQUIRED` (C-26, R50) |
| 404 | `ENROLMENT_NOT_FOUND` |
| 409 | `LESSON_NOT_PAYABLE` (with `detail`), `ONLINE_PAYMENT_OFF`, `COACHING_OFF` |
| 429 | `TOO_MANY_ATTEMPTS` |
| 503 | `PROVIDER_UNAVAILABLE`, `DEGRADED_LOCKOUT` (as `deposit-begin` maps it), `RETRY_LATER` |

Flow (ticket-begin's `beginTickets`, logic.ts:113-136): no provider configured → 503 before
prepare; `lesson_payment_prepare(uid, enrolment_id, locale, provider)`; a reused attempt past its
deadline → `checkNow(…, 'poll')` once, prepare again, still the same stale attempt → 503
`RETRY_LATER`; a `pending` attempt with a page → 200 with it; else `createAtGateway(service, env,
row, uid, {purpose: 'lesson', enrolment_id, request_id})` (`fn/_shared/deposits.ts:217`).

Shared code (no copies):
- `fn/_shared/deposits.ts:22-44`: `PaymentRow.purpose` becomes `'deposit' | 'ticket' | 'lesson'`
  (:42), `lesson_enrolment_id: string | null` joins the type and `ROW_COLUMNS` (:46-47).
- `fn/deposit-reconcile/index.ts:32-49`: `DueRow.purpose` gains `'lesson'` (:47) and
  `lesson_enrolment_id`; the refund message (:131) reads `Touch Padel lesson refund (${reason})` for
  a lesson row.
- `deposit-webhook`, `deposit-status`, `payments-fake` route by `request_id` and need only the type
  change; `deposit-status` reads `app.deposit_status` as the caller (deposit-status/index.ts:34-36).

Same commit: `supabase/config.toml` `[functions.lesson-begin] verify_jwt = true  # the guest's own
session JWT; lesson_payment_prepare re-checks the enrolment's owner` (beside :230-231);
`fixtures/verify-jwt.json` `"lesson-begin": true` (beside :27); `fixtures/assistant-coverage.json`
`edge_functions."lesson-begin": "map:system"`; `tests/payments-provider.test.ts:371` lists
`lesson-begin`; `tests/lesson-begin.test.ts` (the pure half, as `tests/ticket-begin.test.ts`):
body parsing, the refusal map with details, the stale-attempt path, a reused pending page, the
gateway error mapping. The phone: `PaymentPurpose` + `'lesson'` (Guest, §1.11); it lists every
code in the table above (X33), `PHONE_REQUIRED` routing to `/complete-profile` and
`TERMS_REQUIRED` to the terms screen. The 200 body is `LESSON_BEGIN_KEYS` in `shapes.ts` (R41).

### 6.8 Gates that travel with 0281

- `tests/rls-matrix.ts`: nothing new granted to a client (prepare and settle-success are service
  role; `deposit_status`, `deposit_attention`, `deposit_refund_request` keep their rows and args).
- `fixtures/assistant-coverage.json`: `lesson_payment_prepare`, `lesson_settle_success`,
  `lesson_hold_expire` → `excluded: service_role only — the online lesson payment (0281), reached
  through lesson-begin and deposit_apply, never by a client`.
- Error codes: mobile `CODE_TO_KEY` (`apps/mobile/src/features/booking/errors.ts:12`):
  `ENROLMENT_NOT_FOUND`, `LESSON_NOT_PAYABLE`, `ONLINE_PAYMENT_OFF`, `COACHING_OFF` (shared with
  Guest's commit; the first to land adds them; `TERMS_REQUIRED` is mapped already); `PAYMENT_STATE`
  detail `lesson_live` on the operator, with its own sentence in both catalogs (X31).
- `check:locks`: `deposit_apply` prints `coach_advisory → court_advisory → reservations →
  match_venue_advisory → match_tickets`; `lesson_settle_success` alone prints `match_venue_advisory
  → match_tickets` (the reservations trigger expanded under its writes); both in SERVICE_WALK (§9).
  `tests/lock-order-matches.test.ts:228` and `:301` pin `deposit_apply`'s row and are edited in
  this commit (it now starts with `coach_advisory`, R33).
- `tests/coaching-online.test.ts` (§10); `deposits.test.ts` and `matches-tickets.test.ts` green
  unmodified; `pnpm db:types` (`lesson_settle_success`'s new argument is internal and not in the
  generated client types).

## 7. 0284 `coach_statements`

### 7.1 Statement lessons and the per-lesson figure

A **statement lesson** of coach `c` at branch `v` in month `M`: a lesson with `coach_id = c`,
`venue_id = v`, `date_trunc('month', (start_at at time zone venues.timezone))::date = M` (CM-16),
`end_at ≤ now()`, and either `status = 'completed'`, or `status = 'scheduled'` (over, the sweep not
yet run), or `status = 'cancelled' and cancel_reason = 'guest_cancel' and lesson_collected(L) > 0`
(a late cancel the venue kept money for, CM-7).

Per lesson, from its own snapshots (`lessons.court_share_iqd`, `lessons.coach_share_bp`):

```text
collected_L = app.lesson_collected(L)                 -- Σ alloc of real kept money (§5.3, §5.4)
coach_L     = app.lesson_coach_share(collected_L, L.court_share_iqd, L.coach_share_bp)
            = floor(coach_share_bp × max(0, collected_L − court_share_iqd) / 10000)
```

The core twin `packages/core/src/coaching/statement.ts` (§1.11):

```ts
export function lessonCoachShare(collectedIqd: number, courtShareIqd: number, shareBp: number): IQD;
/** The money kept on one enrolment, spread evenly over the sessions it pays for (= splitEvenly). */
export function allocateCourseMoney(keptIqd: number, sessions: number): IQD[];
/** C-15: the course price split evenly over its sessions, summed from firstSessionNo on. */
export function courseLateJoinPrice(coursePriceIqd: number, sessionsCount: number, firstSessionNo: number): IQD;
/** C-23, R62: what a late course leave refunds. shares = splitEvenly(price, sessionsCovered); a
 *  session is kept when it is not cancelled and starts before leftAt + windowHours, or it is the
 *  guest's next covered session at leftAt (the first starting at or after leftAt that was not
 *  cancelled by then); the refund is Σ the shares of the rest (§5.2). */
export function courseLeaveRefund(
  sessions: { shareIqd: number; startAt: Date; cancelledAt: Date | null }[],
  leftAt: Date, windowHours: number): IQD;
```

with `statement.test.ts` (property tests: Σ allocation = kept, shares differ by ≤ 1, the suffix
property of §5.1, `lessonCoachShare` monotone and 0 when collected ≤ court share,
`courseLeaveRefund` = 0 when every remaining session starts inside the window, and = Σ the shares
after the next session for weekly sessions and a 12-hour window). The parity test pins the engine's `refund_due_online_iqd` of a late course
leave (online-paid in full, no other refund) to `courseLeaveRefund`.

### 7.2 `app.coach_statement_build(p_coach_id uuid, p_venue_id uuid, p_month date) returns uuid`

Internal (§1.5). The caller holds `lock_coach(p_coach_id)`. Returns the draft's id, or NULL when
there is nothing to draft or drafting is blocked.

1. `p_month` normalised to the first of the month. Not complete at the branch (`p_month + 1 month >
   (now() at time zone venues.timezone)::date`) → NULL.
2. A **live draft** of this coach and branch for another month → NULL (CM-8: one live draft).
3. A non-void statement for `(coach, branch, p_month)`: `draft` → rebuild its lines in place
   (delete them, insert the new set); `approved` or `paid` → NULL.
4. **Booked lines** of a lesson `L`: its lines on `approved` and `paid` statements (void lines never
   count), found by `lesson_id`, which every line carries (R24). `booked_collected(L)`,
   `booked_court(L)`, `booked_coach(L)` are their sums.
5. Candidates: the statement lessons of `p_month` (regular), and every lesson of the pair with a
   local month in `[p_month − 12 months, p_month)` that is a statement lesson or has a booked line
   (adjustments).
6. For each candidate `L`, target = `(collected_L, L.court_share_iqd, L.coach_share_bp, coach_L)`:
   - `L` of `p_month` with no booked line → a **regular line** with the target values (also when
     `collected_L = 0`: the coach sees a lesson taught that brought in nothing);
   - otherwise → an **adjustment line** (`is_adjustment = true`, `lesson_id = L`) of `collected_L −
     booked_collected(L)`, `L.court_share_iqd − booked_court(L)`, `share_bp`, `coach_L −
     booked_coach(L)`, written only when the coach or collected delta is non-zero. The unique
     `(statement_id, lesson_id)` holds: a lesson has at most one line per statement, regular or
     adjustment.
7. No line and no existing draft → NULL. Else insert or update the statement: `status 'draft'`,
   `lessons_count` = regular lines, `collected_iqd`, `court_share_iqd`, `coach_iqd` = Σ regular,
   `adjustments_iqd` = Σ adjustment `coach_iqd`, `drafted_at` (new) or `refreshed_at` (rebuilt).
   Audit `coach.statement_drafted` / `coach.statement_refreshed` `{statement_id, coach_id, month,
   lines, coach_iqd, adjustments_iqd}`.

What a coach is owed for a statement = `coach_iqd + adjustments_iqd` (`total_iqd` in the reads). It
can be negative (a refund after an approved month): §7.4 void carries it forward.

Why it converges: after the latest draft is built, for every lesson in the look-back, Σ coach on its
booked lines plus the draft's line = `coach_L` now (invariant L8). A lesson the cron missed (one
that ended after the run: a 23:30 start of 240 minutes ends 03:30 local, after the 03:00 local run)
is not lost: it is a regular line on a refresh, or an adjustment on the next draft.

### 7.3 `procedure app.coach_statements_draft(p_month date default null)` and cron (R59)

A **procedure that commits after each (coach, branch) pair**, so no coach's lock is held longer than
its own build (R59; F21: a run over every coach in one transaction held the first coach's bookings
for the whole chain's run). PostgreSQL refuses `COMMIT` in a procedure that is `security definer`
or has a `SET` clause, so this one is **security invoker with no `SET` clause**: it qualifies every
name (`app.`, `public.`), is revoked from `public, anon, authenticated`, and is run by pg_cron as
the job owner. `COMMIT` cannot run inside a block with an exception handler, so the per-pair work
and its error handling live in a function:

- **`app.coach_statement_draft_one(p_coach_id uuid, p_venue_id uuid, p_month date) returns
  boolean`** (internal, definer, revoked from clients; §14): in `begin … exception when others then
  raise warning … ; return false; end`: `perform app.lock_coach(p_coach_id)`; **if a live draft of
  an older month exists for the pair, refresh that one instead** (`coach_statement_build(coach,
  venue, <its month>)`), else `coach_statement_build(coach, venue, p_month)`; true when a draft was
  built or refreshed.
- **The procedure:** for every pair, ordered by `(coach_id, venue_id)`: `coach_branches` rows
  (`active` or not, any coach status: a paused or retired coach is still paid for lessons given,
  C-25), plus every distinct `(coach_id, venue_id)` of a lesson in the 12-month look-back (a coach
  taken off a branch); the month is `p_month`, else the previous branch-local month
  (`date_trunc('month', (now() at time zone v.timezone)::date)::date - interval '1 month'`); `call`
  … `perform app.coach_statement_draft_one(coach, venue, month); commit;` (the loop's cursor is
  held across the commit). It raises a notice with the count of drafts built or refreshed.

On a new draft, `lesson_notify` is **not** called (CM-12: drafts are hidden).

```sql
do $coach_statements_cron_0284$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_coach_statements not scheduled';
    return;
  end if;
  perform cron.schedule('tp_coach_statements', '0 0 1 * *', 'call app.coach_statements_draft(null);');
end $coach_statements_cron_0284$;
```

`'0 0 1 * *'` UTC is 03:00 on the 1st in Baghdad: the previous local month is over everywhere the
chain trades east of UTC. After a hosted push, `cron.job` must have the row (packages/db/CLAUDE.md).

**Amended 2026-10-02 (0293, DB-26):** the schedule is `'0 12 1 * *'` UTC (`cron.unschedule`, then
`cron.schedule`). At midnight UTC a branch west of UTC is still on the last day of the old month,
and the run drafted the month before it; at noon UTC on the 1st every zone from UTC-12 to UTC+14 is
on local day 1 or 2, so the previous local month is over everywhere. After the hosted deploy,
confirm `cron.job` holds `0 12 1 * *` for `tp_coach_statements`.

### 7.4 The staff writes (manager, owner at the statement's branch)

Common prologue for each (guard first, R57): `FORBIDDEN` unless `is_staff('manager','owner')`;
`STATEMENT_NOT_FOUND` is not a §1.10 code, so an unknown or invisible statement is
`INVALID_ARGUMENT` detail `p_statement_id`; `VENUE_MISMATCH` unless `s.venue_id =
app.current_venue()` (the rail's branch, R21: under "All branches" another branch's statement is
read-only) and `is_staff_at(s.venue_id, 'manager', 'owner')`, then `set_config('app.venue_id', …)`;
`FORBIDDEN` detail `own_statement` when `coaches.profile_id = auth.uid()` (CM-11);
`app.lock_coach(s.coach_id)`; re-read the row. **Amended 2026-10-02 (0293, DB-22; CM-11):** after
every `consume_pin_grant` (mark paid; a void from `approved`), a grant whose authoriser is the
statement coach's own profile is `FORBIDDEN` detail `own_statement_pin`; the raise rolls the call
back, so the grant is not spent and another manager's PIN can follow.

Free text (R49): `paid_reference` and `void_reason` are trimmed, sanitised with `app.safe_line`, and
refused with `INVALID_ARGUMENT` (detail `p_reference` / `p_reason`, hint `digits`) when they hold a
run of 12 or more digits, single spaces or dashes between digits ignored (`~
'([0-9][ -]?){11}[0-9]'`): a card, IBAN or wallet number never lands in a note.
**Amended 2026-10-02 (0293, DB-21; R74):** the test is `app.looks_like_card(text)` (immutable),
run on the text `app.safe_line` returns: Arabic-Indic (U+0660..0669) and Extended Arabic-Indic
(U+06F0..06F9) digits read as 0-9, spaces, dots and dashes (hyphen-minus, U+2010..2015, U+2212)
are removed, and a run of 12 or more digits is refused. The same function backs the CHECK
`coach_statements_no_card` and `lesson_blocked_refund_record`'s reference.

- **`coach_statement_refresh(p_statement_id uuid) returns jsonb`**: `draft` → `coach_statement_build`
  in place; `void` → a fresh draft for the same coach, branch and month when none is live for that
  month and no other draft of the pair is live (else `STATEMENT_NOT_DRAFT` detail `live_draft`);
  `approved`/`paid` → `STATEMENT_NOT_DRAFT`. Returns `{statement_id, status, created}` (the new id
  when a void month was redrafted).
- **`coach_statement_approve(p_statement_id uuid) returns jsonb`**: `STATEMENT_NOT_DRAFT` unless
  `draft`. `status 'approved'`, `approved_by = auth.uid()`, `approved_at = now()`; the lines freeze
  (DB's trigger). Audit `coach.statement_approved` `{statement_id, coach_id, month, coach_iqd,
  adjustments_iqd}`. `app.lesson_notify(s.id, 'coach.statement_ready')` (route `coach_statements`;
  in a `begin … exception … end`; one of Money's two direct push calls, R40). Then, under the same
  coach lock, `coach_statement_build` for the first later complete month of the pair that yields a
  draft (CM-8's chain). Returns `{statement_id, status: 'approved', next_statement_id}`.
- **`coach_statement_void(p_statement_id uuid, p_reason text, p_pin text default null, p_device_id
  text default null) returns jsonb`** (R59; the two PIN arguments are this pass's addition, §14):
  `REASON_REQUIRED` when blank (1..200 after trim; R49's digit refusal; stored in `void_reason`);
  `void` → `{duplicate: true}` and `paid` → `INVALID_TRANSITION` detail `paid` (CM-10), both before
  any grant is spent; from `approved`, `v_auth := app.consume_pin_grant(p_device_id)`
  (`PIN_GRANT_REQUIRED`: cash may already have been handed over); from `draft` no PIN. `draft|approved
  → void`, `voided_by`, `voided_at`. Audit `coach.statement_voided` `{statement_id, from_status,
  reason}` (with `p_authorizer_id = v_auth` from `approved`). Its lessons have no booked line any
  more, so the next draft carries them as adjustments; a voided negative statement is how a clawback
  is carried forward. No push.
- **`coach_statement_mark_paid(p_statement_id uuid, p_reference text, p_pin text, p_device_id text
  default null) returns jsonb`** (C-12, R4). Order: `STATEMENT_REFERENCE_REQUIRED` when the trimmed
  reference is blank or over 80 characters; R49's digit refusal; already `paid` → `{duplicate:
  true, paid_reference}` before any grant is spent; `STATEMENT_NOT_APPROVED` unless `approved`;
  `STATEMENT_NOT_APPROVED` detail `negative` when `coach_iqd + adjustments_iqd < 0` (R59: a negative
  month is voided and carried forward, never "paid"); `v_auth := app.consume_pin_grant(p_device_id)`
  (0156:446-474; `PIN_GRANT_REQUIRED`); then `status 'paid'`, `paid_by = auth.uid()`, `paid_at`,
  `paid_reference`. **No `payments`, `refunds` or `booking_payments` row**: the money is handed over
  outside the till. Audit `coach.statement_paid` `{statement_id, coach_id, month, total_iqd,
  reference}` with `p_authorizer_id = v_auth`. `app.lesson_notify(s.id, 'coach.statement_paid')`
  (Money's other direct push call, R40). Returns `{duplicate: false, statement_id, status: 'paid',
  paid_at, total_iqd}`. The Mark paid copy says "a receipt or transfer number, never a card or
  account number" (R49).
- `PIN_GATED_RPCS` gains `coach_statement_mark_paid` and `coach_statement_void` in all three copies:
  `packages/core/src/schemas/mutations.ts:49-58`, `fn/_shared/mutation-types.json:20-28`
  (`pinGatedRpcs`), `packages/db/tests/helpers.ts:176-179`; `apps/operator/src/lib/mutate.test.ts:
  34-35` holds the first two equal. The transports prove the PIN only when the call carries a string
  `p_pin` (`helpers.ts:188`, `op/lib/appRpc.ts:147`): that is why the argument must exist, and why a
  void from `draft` (no `p_pin`) goes through unproved. The `_shared` edit starts
  `functions-deploy`; harmless. Both are online-only (CD-6): never a queued mutation (R13).

### 7.5 The reads

Each read's key list lives in `packages/core/src/coaching/shapes.ts` (`REPORT_COACH_STATEMENTS_KEYS`,
`COACH_STATEMENT_DETAIL_KEYS`, `MY_COACH_STATEMENTS_KEYS`); a DB test asserts every result's keys ⊇
the list and the client parsers read the same lists (R41).

**`report_coach_statements(p_month date) returns jsonb`** (manager, owner; `reports_guard(false)`;
`app.report_venues()`, so the operator's "All branches" scope applies, R21; `p_month` NULL = the
previous month). Shape X22, the union of both lanes:

```json
{ "month": "2026-09-01", "current_month": "2026-10-01", "server_now": "…",
  "statements": [ { "statement_id", "coach_id", "coach_name_en", "coach_name_ar",
                    "venue_id", "venue_name_en", "venue_name_ar", "status", "lessons_count",
                    "collected_iqd", "court_share_iqd", "coach_iqd", "adjustments_iqd",
                    "total_iqd", "payable_iqd", "drafted_at", "refreshed_at",
                    "approved_at", "approved_by_name", "paid_at", "paid_by_name", "paid_reference",
                    "voided_at", "void_reason" } ],
  "missing": [ { "coach_id", "coach_name_en", "coach_name_ar", "venue_id",
                 "reason": "older_draft|newer_draft|not_drafted",
                 "blocking_month", "blocking_statement_id" } ],
  "totals": { "statements", "collected_iqd", "court_share_iqd", "coach_iqd", "adjustments_iqd",
              "total_iqd", "payable_iqd", "approved_unpaid_iqd", "unpaid_iqd", "paid_iqd" } }
```

`payable_iqd` = `total_iqd` = `coach_iqd + adjustments_iqd`; `unpaid_iqd` = `approved_unpaid_iqd`;
`current_month` is the month now in the rail's branch time zone (the stepper's limit); the `*_by_name`
are staff display names. Void statements are listed (status `void`) and left out of the totals.
`missing` names pairs with statement lessons in the month and no non-void statement (blocked by an
older draft, or the month not drafted yet). **Amended 2026-10-02 (0293, DB-24, DB-25):** a pair is
kept only while one of those lessons has no line on a statement that is not void (a voided month
whose lessons a later statement settled as adjustments waits for nothing); the reason is
`older_draft` when the pair's live draft is of an earlier month, `newer_draft` when of a later one
(an approved month voided after its approval drafted the next), with `blocking_month` and
`blocking_statement_id` naming it (both NULL for `not_drafted`). Coach display names only (public, §1.2; a deleted
coach's stay, C-29). It is a **person-money report** (R42, C-28): scanned by SEC-29 for guest
identity, exempt from the coach patterns, never an assistant tool.

**`coach_statement_detail(p_statement_id uuid) returns jsonb`** (manager, owner; the statement's
branch must be the rail's, R21, as the writes' prologue). Shape X23, the union:

```json
{ "statement": { …the report_coach_statements row… },
  "stale": false,
  "can": { "refresh": true, "approve": true, "void": true, "mark_paid": false },
  "coach_booked_no_shows": 1,
  "lines": [ { "line_id", "lesson_id", "start_at", "kind", "type_name_en", "type_name_ar",
               "course_id", "course_title_en", "course_title_ar", "session_no", "lesson_status",
               "is_adjustment", "collected_iqd", "court_share_iqd", "share_bp", "coach_iqd",
               "enrolments", "attended", "no_shows", "coach_booked_no_shows" } ] }
```

Lines ordered by `is_adjustment, start_at`. `stale` (a draft only): a rebuild now would change a
line. `can.*` follow the statuses of §7.4 (`mark_paid` also needs `payable_iqd ≥ 0`) and are all
false on the caller's own statement (CM-11). **Amended 2026-10-02 (0293, DB-25):** `can.refresh` on
a `void` statement also needs a draft of its month to hold a line (`coach_statement_plan` not
empty), so Redraft is not offered once a later statement settled its lessons. **C-24, R56:** `coach_booked_no_shows` counts, per line
and in total, the `no_show` marks on enrolments with `booked_by_kind = 'coach'` (a no-show of a
coach-booked student is a line with nothing collected, since every completed lesson is a statement
line), so the manager sees hoarding on the pay screen. No student name, phone or guest id.

**`my_coach_statements(p_month date default null) returns jsonb`** (coach; first statement the coach
guard, which must admit a `retired` coach for this read, C-25 / R45: a retired coach sees approved
and paid statements and nothing else). Shape X12: Money's visibility plus Guest's `months[]`:

```json
{ "months": ["2026-09-01"],
  "statements": [ { "id", "venue_id", "venue_name_en", "venue_name_ar", "month",
                    "status": "approved|paid", "lessons_count", "collected_iqd", "court_share_iqd",
                    "coach_iqd", "adjustments_iqd", "total_iqd", "share_bp", "approved_at",
                    "paid_at", "paid_reference",
                    "lines": [ { "lesson_id", "start_at", "kind", "type_name_en", "type_name_ar",
                                 "collected_iqd", "court_share_iqd", "share_bp", "coach_iqd",
                                 "is_adjustment" } ] } ],
  "current_month": [ { "venue_id", "estimate": true, "lessons", "collected_iqd", "coach_iqd" } ] }
```

`months`: months with an approved or paid statement, newest first, the last 12; `p_month` NULL =
the latest of them; `statements`: that month's statements at every branch with their lines.
`share_bp` on a statement = its regular lines' share when they agree, else NULL (each line carries
its own). `current_month`: this month's statement lessons so far with today's math, per branch,
empty for a retired coach. Drafts and voids are never sent (CM-12).

### 7.6 Gates that travel with 0284

- `tests/rls-matrix.ts` drop 25: `report_coach_statements`, `coach_statement_detail`,
  `coach_statement_refresh`, `coach_statement_approve` → `MANAGER_UP`; `coach_statement_void` →
  `MANAGER_UP` with args `{p_statement_id: NIL_UUID, p_reason: 'matrix'}`;
  `coach_statement_mark_paid` → `MANAGER_UP` with args `{p_statement_id: NIL_UUID, p_reference:
  'matrix', p_pin: MANAGER_PIN}` (the `deposit_refund_manual` row, rls-matrix.ts:4254-4259);
  `my_coach_statements` → the coach-read shape DB defines for `coach_me`'s family (every matrix
  principal is a non-coach, so `NOT_A_COACH` is its guard). Allowlist `guarded` (R12);
  `--update-floor`.
- `fixtures/assistant-coverage.json` (C-28, R42; the `salary_deductions` precedent):
  `report_coach_statements`, `coach_statement_detail`, `coach_statement_refresh`,
  `coach_statement_approve`, `coach_statement_void`, `coach_statement_mark_paid`,
  `my_coach_statements` → `map:action` (the assistant knows where the screen is; **no** `tool:`
  entry, and `tests/assistant-catalog.test.ts` asserts no assistant tool names
  `report_coach_statements` or `report_lessons`); `coach_statement_build`,
  `coach_statement_draft_one`, `coach_statements_draft` → `excluded: internal — the monthly coach
  statement builder (0284), run by tp_coach_statements and the approve path` (where the inventory
  lists them); `cron_jobs.tp_coach_statements` → `map:system`. Tables `coach_statements`,
  `coach_statement_lines` (DB's 0275 entries): `excluded: a coach's pay, money about a named
  person; never readable by the owner assistant or any LLM`.
- SEC-29 (`scripts/check-analytics-payload.mjs`, R42): `PERSON_MONEY_REPORTS =
  ['report_coach_statements', 'report_lessons']` are scanned for guest identity and exempt from the
  underscore-optional coach patterns (`/coach_?id/i`, `/coach_?name/i`, `/coach_?(share|iqd)/i`);
  `report_coach_statements` emits no guest key (coach and staff display names are not a guest's; no
  `guest_*`, phone or profile id).
- SEC-20: R49's `COACH_DATA` rows for statement money and `paid_reference` (§4.4).
- Error codes: operator `MAPPED_CODES` + `coachingMoney` catalogs: `STATEMENT_NOT_DRAFT`,
  `STATEMENT_NOT_APPROVED`, `STATEMENT_REFERENCE_REQUIRED`; a sentence for each detail a screen
  meets (X31, R52): `own_statement`, `live_draft`, `paid`, `negative`, and `INVALID_ARGUMENT`
  `digits`. `REASON_REQUIRED`, `PIN_GRANT_REQUIRED`, `INVALID_TRANSITION` are mapped already.
- `check:locks`: every write prints `coach_advisory`; `coach_statements_draft` is in SERVICE_WALK
  from the 0275 commit (R33) and prints `coach_advisory` through `coach_statement_draft_one`.
- The procedure is the repo's first `create procedure`: `fn-signatures.mjs` and the registry replay
  read `function` statements, so it is invisible to them (it is granted to nobody); if a gate
  requires `set search_path` on every routine, it names this one as the exception (§14).
- `tests/coaching-statements.test.ts` and the core parity cases (§10); `pnpm db:types`.

## 8. 0285 `lesson_reports`

Everything here reads and nothing locks. A sandbox lesson payment adds 0 to every figure and is
counted only in `sandboxExcluded` (CM-15).

### 8.1 `app.lesson_money_figures(p_ts_from timestamptz, p_ts_to timestamptz, p_venues uuid[]) returns jsonb`

> **Amended 2026-10-02 (build-contracts §1.15 D2):** money handed back outside the till
> (`refunded_outside_iqd`) also reduces `netIqd` (`lessonRevenue`). Built by 0292 (DB-20) as
> `outsideRefundsIqd`/`outsideRefundsCount`; 0292 (DB-15) also moved `refundsDueDesk*` to
> `day_close_online`, their only reader.

Internal (§1.5), the twin of `ticket_money_figures` (0265:47-140): one helper behind
`reports_figures`, `report_revenue`, `report_courts`, `report_lessons` and `day_close_online`, so no
two screens disagree. Branch-scoped (`venue_id = any(p_venues)`), non-sandbox:

| Key | Definition |
| --- | --- |
| `deskIqd`, `deskCount` | Σ `payments.amount_iqd` on `kind 'lesson'` tabs, `payments.created_at` in range |
| `deskRefundsIqd` | Σ `refunds.amount_iqd` on those payments, `refunds.created_at` in range |
| `onlineIqd`, `onlineCount` | lesson rows with `succeeded_at` in range |
| `onlineRefundsIqd` | Σ `refund_amount_iqd` of lesson rows `refunded` with `refunded_at` in range |
| `outsideRefundsIqd`, `outsideRefundsCount` | Σ `data.amount_iqd` of `lesson_events` `refunded` code `outside` (R75 handbacks), `at` in range; a place paid through the Qi sandbox left out (0292) |
| `onlineRefundsWaitingIqd`, `onlineRefundsWaitingCount` | lesson rows in `refund_pending` or `refund_failed` now |
| `netIqd` | `deskIqd − deskRefundsIqd + onlineIqd − onlineRefundsIqd − outsideRefundsIqd` (**lessonRevenue**, CM-13; the handbacks since 0292, D2) |
| `lessons`, `lessonMinutes` | statement lessons (§7.1) starting in range; Σ their minutes |
| `collectedIqd` | Σ `collected_L` of those lessons |
| `courtShareIqd` | Σ `least(court_share_iqd, collected_L)` |
| `owedToCoachesIqd` | Σ `coach_L` (**owedToCoaches**; named so no coach pattern of SEC-29 matches it, R42) |
| ~~`refundsDueDeskIqd`, `refundsDueDeskCount`~~ | removed by 0292 (DB-15): `day_close_online` sums `refund_due_desk_iqd` itself, over the places `lesson_enrolment_may_owe` lets through |
| `sandboxExcluded` | sandbox lesson rows succeeded in range |

A wrong-amount, duplicate or slot-lost row is received and refunded in full, so it nets to 0 over
time (the `onlineDeposits` rule, 0265:341-348). `deskRefundsIqd` dates a refund by `created_at`,
the moment it was made, as `reports_figures` dates every refund (0265:331); the day close dates it
by its till shift's day (§5.13, §8.6), the same day for any refund made while the day is open.
Aggregates only: C-28 lets them reach the assistant and the analytics model.

### 8.2 `reports_figures` (from 0265:287) and `panel_headline` (from 0265:397)

`reports_figures` (`$reports_figures_0285$`): `v_lm := app.lesson_money_figures(v_b.ts_from,
v_b.ts_to, v_rv)`; then

- `revenue` = `res.padel_iqd + cafe.cafe_net_iqd + netIqd` (C-18; 0265:359 today is padel + café
  net);
- new keys, appended after `matchWrittenOff`: `lessonRevenue` = `netIqd`, `owedToCoaches` =
  `owedToCoachesIqd`.

`padelRevenue` is unchanged (it reads `kind = 'booking'`, 0265:308; a lesson's court row is `kind
'lesson'`); `cash` and `card` already include desk lesson money (0265:321-331 reads every payment
and refund); `cafeRevenue`, `cafeNet`, `refunds`, `discounts` stop seeing lesson tabs through
`cafe_settled_tabs` (§5.9). `panel_headline` (`$panel_headline_0285$`): `v_keys` (0265:409-412)
gains `'lessonRevenue', 'owedToCoaches'` at the end, so every existing position is unchanged; the
operator's `mapFigures` drops unknown keys until the Operator lane adds tiles. The `panel_headline`
tool description gains "lesson revenue and the share owed to coaches" in both tool copies
(`packages/core/src/assistant/tools.ts`, `fn/_shared/assistant/tools.ts`); regenerate the map.

### 8.3 `report_revenue` (from 0219:637)

`$report_revenue_0285$`. A `les` CTE buckets lesson money by the business date of each movement
(desk payments by `created_at`, desk refunds by `created_at`, online by `succeeded_at` and
`refunded_at`), through the same definitions as §8.1 (one SQL fragment, or `lesson_money_figures`
per bucket for a short range; the builder picks, a test pins equality with §8.1 over the range).
`rows_` (0219:762-786) gains `lesson_iqd` and `owed_to_coaches_iqd`; `total_iqd` (0219:768)
becomes `padel + cafe_net + lesson`; the row and totals JSON gain `'lessonIqd'` and
`'owedToCoachesIqd'` (X26: accrual, Σ `coach_L` of statement lessons starting in the bucket, as
`owedToCoaches`; never in `totalIqd`); `columns` (0219:823-837) gains `{key:'lessonIqd',
labelEn:'Lessons', labelAr:'الحصص', kind:'money'}` after `shopIqd` and `{key:'owedToCoachesIqd',
labelEn:'Owed to coaches', labelAr:'المستحق للمدرّبين', kind:'money'}` after it (the Arabic from the
one glossary, C-30, R55). With a `paymentMethod` or `staffId` filter, `lessonIqd` counts only desk
money that matches (online money has neither) and `owedToCoachesIqd` is 0. `buckets` gains `les`.

### 8.4 `report_courts` (from 0265:469): occupancy and the lessons block

`$report_courts_0285$`.
- A `ls` CTE: reservations of `v_av` with `kind = 'lesson'`, `status in ('confirmed', 'arrived',
  'completed')`, `start_at` in range, the `courtId` filter applied.
- `per_court` (0265:530-546) gains `lessons` and `lesson_minutes`; each row gains `'lessons'`,
  `'lessonMinutes'`; `occupancyPct` becomes `(booked_minutes + lesson_minutes) × 100 / avail`
  (CM-14). `revenueIqd`, `revenuePerAvailableHourIqd`, the cancellation and no-show rates and the
  peak counts stay bookings only. Totals likewise. `columns` gains `lessonMinutes` after
  `bookedMinutes`.
- A `lessons` block beside `matches` (modelled on 0265:614-632), for the analysed branch whatever
  `courtId` says:

```json
"lessons": { "lessons", "private", "group", "courseSessions", "lessonMinutes", "enrolments",
             "attended", "noShows", "cancelled", "underFilled", "collectedIqd", "courtShareIqd",
             "owedToCoachesIqd" }
```

Money's names (X25), except the coach total, renamed from `coachShareIqd` to `owedToCoachesIqd`:
`report_courts` is an assistant tool and not a person-money report, so R42's `/coach_?(share|iqd)/i`
applies to it (§14). Counts and branch aggregates only (no coach or student name; C-28 lets
aggregates through). The `report_courts` tool description mentions the block and the occupancy rule
in both copies.

### 8.5 `analytics_courts_summary` (from 0219:2219)

`$analytics_courts_summary_0285$`. `analytics_open_minutes` (0214:121) is **not** re-issued: its
`maint` CTE subtracts `kind = 'maintenance'` only (0214:165-180), so a lesson's court time is
already open time; this function makes it occupied time:
- an `ls` CTE as in §8.4 (lesson rows of `v_av`, live, in range, the court filter);
- `per_court` gains `lessons`, `lesson_minutes`; `tot` gains them; `kpis` gains `lessons`,
  `lesson_minutes`, and `occupancy_pct` (0219:2367) and each `per_court.occupancy_pct` (0219:2391)
  use `booked_minutes + lesson_minutes`; `by_day` gains `lesson_minutes`; `heatmap` gains
  `lesson_minutes` (split per hour as `split` does for bookings, 0219:2316-2323);
- the `holds` CTE (0219:2251-2257) gains `and r.lesson_id is null`: a lapsed lesson payment is not a
  lapsed court hold.
`booked_minutes`, `bookings`, `revenue_iqd` and the rates stay bookings only. The operator lane
colours the heatmap from `booked_minutes + lesson_minutes`.

### 8.6 `day_close_online` (from 0265:155)

`$day_close_online_0285$` (its one re-issue, §1.8). The result gains a `lessons` block for the day's
branch and `sandbox_excluded.lessons`. Shape X27: Money's keys plus `kept_iqd` and `kept_count`
(`DAY_CLOSE_LESSONS_KEYS` in `shapes.ts`):

```json
"lessons": { "desk_paid_iqd", "desk_paid_count", "desk_refunded_iqd",
             "online_received_iqd", "online_received_count", "online_refunded_iqd", "online_refunded_count",
             "online_refunds_waiting_iqd", "online_refunds_waiting_count",
             "refunds_due_desk_iqd", "refunds_due_desk_count",
             "kept_iqd", "kept_count",
             "lessons", "owed_iqd", "owed_count", "owed_to_coaches_iqd" }
```

- **Desk money by the day session (C-31, R27):** `desk_paid_*` = payments on `kind 'lesson'` tabs
  with `p.day_session_id = v_day.id`; `desk_refunded_iqd` = refunds on them whose
  `coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id),
  p.day_session_id) = v_day.id`: the day the refund was made, as `close_day` counts it (§5.13).
- `online_*` from `lesson_money_figures(v_from, v_to, array[v_day.venue_id])`, bucketed as the
  deposits are (`[v_from, v_to)`, 0265:188-193); `refunds_due_desk_*` and
  `online_refunds_waiting_*` are now.
- `kept_iqd`, `kept_count`: Σ `alloc(e, L)` over sessions `L` starting that business day of
  enrolments cancelled `guest_late` or marked `no_show` on `L`, and the number of those enrolments
  (money the venue keeps for late cancels and no-shows).
- `lessons`, `owed_to_coaches_iqd`: statement lessons starting that business day and Σ `coach_L`.
- `owed_iqd`, `owed_count`: Σ `owed_iqd` of booked desk enrolments whose lesson (or a course's
  session) started that business day: played, not yet paid.
- Information only: desk lesson money is already in cash and card (it is ordinary payments), and
  `close_day` counts its refunds by the same day rule (§5.13); `owed_to_coaches_iqd` is **never**
  part of the cash count (C-12: the coach is paid outside the till). The comment says so.

### 8.7 `app.report_lessons(p_from date, p_to date) returns jsonb` (§1.7)

Manager, owner (`reports_guard(false)`), `app.report_venues()`, `analytics_bounds`. Lessons by
`start_at` in range.

```json
{ "period": {"from", "to"},
  "totals": { "lessons", "private", "group", "courseSessions", "cancelled", "underFilled", "expired",
              "enrolments", "places", "placesTaken", "fillRatePct", "attended", "noShows", "lateCancels",
              "collectedIqd", "courtShareIqd", "coachShareIqd", "venueShareIqd",
              "deskIqd", "onlineIqd", "refundsIqd", "lessonRevenueIqd", "sandboxExcluded" },
  "byCoach": [ { "coachId", "coachNameEn", "coachNameAr", "lessons", "enrolments", "collectedIqd", "coachShareIqd" } ],
  "byType":  [ { "lessonTypeId", "nameEn", "nameAr", "kind", "lessons", "enrolments", "collectedIqd" } ],
  "byDay":   [ { "date", "lessons", "collectedIqd", "coachShareIqd" } ],
  "columns": [ … the report_courts column shape, EN + AR labels … ] }
```

Money's names (X24; `REPORT_LESSONS_KEYS` in `shapes.ts`). `collectedIqd` / `coachShareIqd` are
accrual (statement lessons, §7.1); `deskIqd`, `onlineIqd`, `refundsIqd`, `lessonRevenueIqd` are
cash basis (§8.1). `venueShareIqd = collectedIqd − coachShareIqd`. `fillRatePct` = places taken ÷
places offered for group sessions and course sessions, one decimal. `columns` labels use the one
Arabic glossary (C-30, R55: «حصة» the lesson, «أجرة الملعب» the court share, «نصيب المدرّب» the
coach's share). No student name, phone or guest id. **A person-money report** (C-28, R42):
`byCoach` is money about a named coach, so the report is in `PERSON_MONEY_REPORTS` (scanned for
guest identity, exempt from the coach patterns) and no assistant tool names it.

### 8.8 Gates that travel with 0285

- `tests/rls-matrix.ts` drop 25: `report_lessons` `MANAGER_UP`. The re-issued functions keep their
  rows. Allowlist `guarded`; `--update-floor`.
- `fixtures/assistant-coverage.json`: `report_lessons` → `map:action` (never `tool:`, R42);
  `lesson_money_figures` → `excluded: internal — every lesson money figure for the reports and the
  day close (0285)`. Tool descriptions (§8.2, §8.4) in both copies; `pnpm --filter @touch/db
  assistant:map`.
- SEC-29 (R42): `report_courts` and `analytics_courts_summary` carry no forbidden key and no coach
  pattern (`owedToCoachesIqd`, §8.4); `report_lessons` and `report_coach_statements` carry no guest
  key (`PERSON_MONEY_REPORTS`). Recommended tripwires (DB adds them once for the build):
  `/friend_names/i`, `/student/i` (G4: one edit, DB's list subsumes Money's `/student_/i`).
- `tests/reports.test.ts` the new keys and the `revenue` sum; `pnpm db:types`.

## 9. Lock order

The final `ORDER` (DB's gate edit, §1.4): `day_sessions → match_money_advisory → coach_advisory →
tabs → orders → order_items → tickets → payments → till_shifts → refunds → stock_batches →
court_advisory → reservations → match_venue_advisory → match_tickets`. `ADVISORY` gains `{fn:
'lock_coach', lock: 'coach_advisory'}`; `ONCE_PER_SEQUENCE` gains `coach_advisory`.
`booking_payments` stays out of `ORDER`: deposit and lesson rows are locked after reservations,
ticket rows only after `match_tickets`, and no body locks two kinds.

| Function | Locks, in order |
| --- | --- |
| `lesson_settle` | `day_sessions` (share) → `coach_advisory` → `tabs` (insert; `settle_tab`'s `for update`) → `payments` (+ `till_shifts` share, stamp trigger) |
| `refund` (R36), a lesson tab | `day_sessions` → `coach_advisory` → `tabs` → `payments` → `till_shifts` (stamp) → `refunds` (0217's order with the coach key inserted) |
| `deposit_apply`, lesson branch | `coach_advisory` → `court_advisory` (private: every court of the branch, id order, returned as `v_locked`) → `reservations` (the hold, `FOR UPDATE`) → `match_expire_holds` (R33) → [payment row] → `lesson_settle_success` / `lesson_hold_expire` (writes only) |
| `deposit_apply`, deposit and ticket branches | unchanged (0267:64-75), textually after the coach lock |
| `lesson_settle_success` | none taken; writes `lessons`, `lesson_enrolments`, `reservations` (trigger: `match_venue_advisory` → `match_tickets`), the payment row; a `lesson_strikes` delete with `skip locked` (unranked) |
| `lesson_hold_expire` | none waited on: the hold row by R25's `for update skip locked` (see §14 for the walker), `lesson_strike_record` (unranked, `skip locked`, R31), status writes |
| `lesson_payment_prepare` | `coach_advisory` → `court_advisory` (the hold's court) → `reservations` (the hold) → [payment row or insert] |
| `lesson_refund_start` | [the enrolment's payment rows] only; called last by DB's cancel internals, which hold `lock_coach` and no court lock (R6) and write reservations by guarded status updates only (R33) |
| `deposits_due_for_reconcile` | [payment rows, `skip locked`] → `lesson_refund_start` |
| `deposit_refund_apply` / `_retry` / `_manual` / `_request`, lesson rows | [payment row] only (`lock_court(NULL)` is a no-op, 0042:53) |
| `coach_statement_refresh` / `_approve` / `_void` / `_mark_paid` | [pin grant] (mark paid; void from `approved`) → `coach_advisory` → statement writes |
| `coach_statements_draft` (procedure) | per pair, `coach_statement_draft_one`: `coach_advisory`, then `commit` (R59) |
| `close_day`, `v_day_close_summary` (R27) | unchanged; the `till_shifts` join is a plain read |
| `compute_tab_totals`, `lesson_enrolment_money`, `lesson_fee_remaining`, `lesson_collected`, `lesson_money_open`, every read and report, the no-goods trigger, `cafe_settled_tabs` | none |

Static sequences the walker must print: `lesson_settle`: `day_sessions → coach_advisory → tabs →
payments`; `refund`: `day_sessions → coach_advisory → tabs → payments …` (0217's tail);
`deposit_apply`: `coach_advisory → court_advisory → reservations → match_venue_advisory →
match_tickets`; `lesson_payment_prepare`: `coach_advisory → court_advisory → reservations`;
`lesson_settle_success`: `match_venue_advisory → match_tickets`; `coach_statements_draft`:
`coach_advisory`.

**SERVICE_WALK** (`scripts/lib/lock-order.mjs:60-67`) is **one list, edited in the 0275 commit**
(R33): `lesson_sweep`, `lesson_settle_success`, `lesson_payment_prepare`,
`coach_statements_draft` (names not yet created are skipped). `deposit_apply` is already there.
`tests/lock-order-matches.test.ts:75` (the exact list) is edited in the 0275 commit; `:228` and
`:301` (`deposit_apply`'s row) in the 0281 commit. No coaching name joins
`STATUS_ONLY_RESERVATION_WRITERS` (R33).

Three textual rules keep these green: in `deposit_apply` the coach lock comes first, then every court
lock of both branches, then every reservations lock of both branches, then `match_expire_holds`,
before any settle call (the walker reads the body linearly, statement by statement,
lock-order.mjs:148-190); `lesson_settle_success` never locks `reservations` and never calls a
function that does; the reconciler's lesson loop calls only `lesson_refund_start`. The fixture test
(`tests/lock-order-matches.test.ts` pattern) gains a synthetic `deposit_apply` with the deposit and
lesson blocks in this order, and the inverted order failing.

## 10. Money invariants and tests

`assertLessonMoney(enrolmentId)` and `assertStatement(statementId)` (`packages/db/tests/helpers.ts`)
run after every case of the coaching money suites.

Invariants:
1. **L1** `iqd_split(t, n)` = core `splitEvenly(t, n)`: Σ = t, non-increasing, max − min ≤ 1;
   `match_shares(p) = iqd_split(p, 4)`.
2. **L2** Per course enrolment: Σ `course_share_for` over covered sessions = `price_iqd`; a late
   join's price = `course_late_join_price` = core `courseLateJoinPrice`; a late course leave's
   `refund_due_online` (online-paid in full) = core `courseLeaveRefund` (C-23, R62).
3. **L3** Per enrolment: `kept + refund_due = net`; `refund_due = refund_due_online +
   refund_due_desk + refund_blocked`; `kept ≤ due`; `owed ≤ due`; `real_kept ≤ kept`; Σ `alloc` =
   `real_kept`.
4. **L4** Every `kind 'lesson'` tab is `settled`, has no order and no adjustment, `reservation_id`,
   `table_id`, `court_cap_iqd` NULL, `lesson_iqd = total_iqd = court_iqd + lesson_iqd` with
   `subtotal = discount = tax = court = 0`, and exactly one payment of `lesson_iqd`.
5. **L5** No `kind 'lesson'` tab in `cafe_settled_tabs`; with lesson tabs present every café figure
   equals its value without them.
6. **L6** A lesson payment row is refunded at most once; `refund_due_online_iqd ≤
   online_refundable_iqd`; a lesson row's `reservation_id` is NULL.
7. **L7** No lesson row counts in `deposit_net_paid`, `court_fee_paid`, `my_reservations`,
   `booking_bill`, `onlineDeposits` or ticket figures.
8. **L8** After the latest draft of a pair is built, for every lesson in the look-back: Σ `coach_iqd`
   of its lines on approved, paid and the live draft = `coach_L` now; likewise `collected`.
9. **L9** A statement's `coach_iqd`, `collected_iqd`, `court_share_iqd` = Σ regular lines;
   `adjustments_iqd` = Σ adjustment lines; `lessons_count` = regular lines; at most one live draft
   per pair; at most one non-void statement per pair and month.
10. **L10** Marking paid writes no `payments`, `refunds` or `booking_payments` row (counts before and
    after).
11. **L11** `revenue = padelRevenue + cafeNet + lessonRevenue`; `cash`/`card` include desk lesson
    money; `owedToCoaches` never enters `cash`, `card` or the day's cash count.
12. **L12** A non-lesson tab: `compute_tab_totals` gives `lesson_iqd = 0` and its 0262 values;
    `cafe-money.test.ts`, `matches-money.test.ts` pass unmodified; `desk-payment.test.ts` passes
    with R27's added case.
13. **L13** Sandbox lesson rows add 0 to every statement and report figure.
14. **L14** (C-31, R27) A refund counts in the day close of the day it was made (its till shift's
    day): `close_day`'s expected cash and card, `v_day_close_summary.refunds_iqd` and
    `day_close_online.lessons.desk_refunded_iqd` agree for every day; Σ over days = Σ refunds; a
    closed day's stored figures never change.
15. **L15** (R36) Σ desk refunds on an enrolment's lesson payments with reason other than
    `lesson_goodwill` never exceed what was due when each was made; no two refunds pass the bound
    concurrently.
16. **L16** (R24) Every statement line has a `lesson_id`; at most one line per (statement, lesson);
    an adjustment for a money change appears on exactly one later statement.
17. **L17** (R28) Every enrolment with `refund_due_online_iqd > 0` and a refundable row has a refund
    started by the end of the cancel's transaction, or by the next reconcile run, however old.

Test files and concrete scenarios (prices: private 40,000 with court share 10,000; group 15,000 a
place with court share 10,000; course 100,001 for 4 sessions with court share 8,000; `coach_share_bp`
6000):

**`tests/coaching-money.test.ts`** (0278):
- *D1 desk settle, private, cash.* `lesson_settle(e, 'cash', 40000, 50000, key)` → change 10,000; one
  `kind 'lesson'` tab, settled, `lesson_iqd = total_iqd = 40000`; one cash payment of 40,000.
  `v_day_close_summary.cash_payments_iqd` +40,000; `close_day` expected cash +40,000;
  `cafe_settled_tabs` unchanged; `reports_figures` `lessonRevenue` 40,000, `revenue` +40,000,
  `cafeRevenue` unchanged. Replay with the same key → `duplicate`; a new key → `LESSON_NOT_PAYABLE
  nothing_owed`; expected 39,000 → `LESSON_OWED_CHANGED`; NULL key → `INVALID_ARGUMENT`; shop_staff →
  `FORBIDDEN`; another branch's cashier → `VENUE_MISMATCH`; no open day → `NO_OPEN_DAY`; card with a
  tender → `TENDER_CARD`; a held, a cancelled, an expired enrolment → `LESSON_NOT_PAYABLE` with the
  status.
- *D2 the wall.* A lesson tab inserted live as postgres (the harness): an `orders` insert,
  `apply_discount`, a `tab_adjustments` insert, a `merge_tabs` into it → `LESSON_TAB_NO_GOODS`;
  `open_tab(p_kind 'lesson')` → `INVALID_ARGUMENT p_kind`.
- *D3 group.* Four places; three paid at the desk, one no-show unpaid: the no-show's `owed_iqd = 0`
  (`LESSON_NOT_PAYABLE no_show`); unmark → owed 15,000 again; `lesson_collected` = 45,000.
- *D4 course allocation.* A full enrolment desk-paid 100,001 → shares `[25001, 25000, 25000,
  25000]`; a late join from session 3 priced 50,000 = `course_late_join_price(100001, 4, 3)`;
  `lesson_collected` of session 1 = 25,001, of session 3 = 50,000.
- *D5 goodwill refund, course.* After D4, `app.refund` 10,001 of the full member's payment with a
  PIN and reason `lesson_refund` → `REFUND_EXCEEDS_DUE` (nothing is due, R36); with
  `lesson_goodwill` → done: `net = kept = 90,000`, `alloc = [22500 × 4]`; `owed` still 0 (gross,
  CM-2); `lessonRevenue` of the refund's day −10,001.
- *R1 free cancel, desk-prepaid.* `refund_due_desk = 40,000`; listed by `lesson_refunds_due` (typed
  name and phone for a coach-booked student, R44); `app.refund` 40,000 `lesson_refund` → due 0;
  nothing in café refunds.
- *R1b refund on a later day (C-31, R27).* R1 paid on day 1, day 1 closed, refunded on day 2: day
  2's `close_day` expected cash −40,000 and `v_day_close_summary.refunds_iqd` 40,000; day 1's
  `refunds_iqd` 0 and its stored figures unchanged; `day_close_online.lessons.desk_refunded_iqd` of
  day 2 = 40,000.
- *R2 late cancel.* Online-paid private: no refund, `kept = 40,000`, `lesson_collected` = 40,000 on
  the cancelled lesson; desk-unpaid private: `owed = 0`, `kept = 0`; desk-prepaid: kept.
- *R3 coach cancel, group* with two online and one desk-paid enrolment and one earlier `guest_late`
  online enrolment: three online refunds `coach_cancel` (the late one too, in the cancel's own
  transaction, R28), one desk refund due.
- *R4 the rest of a course* (online 100,001, after sessions 1–2): one refund of 50,000 on the row,
  `due = kept = 50,001`, `alloc = [25001, 25000]` on sessions 1 and 2; a second
  `lesson_refund_start` → 0; `deposit_refund_request` on the row → `PAYMENT_STATE` (it is
  `refund_pending`).
- *R5 under-filled course at the cut-off* (judged before session 1, R26): every online row refunded
  `under_filled`, desk refunds due.
- *R6 deposit_refund_request* on a live enrolment's lesson row → `PAYMENT_STATE lesson_live`; on a
  completed private lesson, 10,000 `staff_refund` → `kept = 30,000`, `owed = 0`.
- *R7 two tills (R36).* A course desk-paid 100,001, the rest cancelled after session 2 →
  `refund_due_desk = 50,000`; manager A refunds 50,000 `lesson_refund`; manager B's 50,000 at
  another till → `REFUND_EXCEEDS_DUE` (the coach lock serialises them; a queued `payment.refund`
  replay of B records a conflict).
- *R8 leaving a running course (C-23, R62).* Online 100,001, weekly sessions, window 12 h. Leave 6 h
  before session 2 → `guest_late`: `due = kept = 50,001` (sessions 1–2), one refund of 50,000
  `guest_cancel` at once, equal to `courseLeaveRefund`; leave 2 days before session 2 →
  `guest_free`: refund 75,000; a late joiner from session 3 leaving 6 h before it → keeps 25,000,
  refunds 25,000. Then, on the first case, the venue cancels the rest of the course before session
  2 starts: `refund_blocked_iqd = 25,000`, listed as `online_blocked_iqd` in `lesson_refunds_due`.
- *R9 account deleted mid-course (R28, CD-12).* Online 160,000 for 8 sessions (20,000 each); the
  guest deletes after session 3; the sweep's `account_deleted` cancel → one refund of 100,000
  (sessions 4–8) with reason `account_deleted`, never the whole 160,000.
- *R10 `if_cancelled`.* A booked online private: `guest_free` → refund 40,000, kept 0;
  `guest_late` → refund 0, kept 40,000. A booked online course after session 1, 6 h before session
  2: `guest_late` → refund 50,000.
- *R11 `lesson_money_open` (R37).* True with a `draft` or `approved` statement, with last month's
  statement lessons undrafted, with a desk refund due or a blocked one; false once all are paid,
  drafted and refunded. 0292 (DB-19): also true with a lesson refund still `refund_pending`, and
  with an adjustment not yet drafted (a paid month, then a late desk payment on one of its lessons).
- *Parity*: `iqd_split`, `lesson_coach_share`, `course_late_join_price` and the course-leave refund
  against core (`splitEvenly`, `lessonCoachShare`, `courseLateJoinPrice`, `courseLeaveRefund`) over
  awkward amounts (0, 1, n − 1, n, n + 1, 99,999, 100,001; n in 1..52) (the
  `cafe-flow.test.ts:392-429` pattern); `compute_tab_totals` of a café, a shop and a booking tab
  equal to their 0262 values.

**`tests/coaching-online.test.ts`** (0281; the fake provider through `deposit_apply`):
- *O1 private success*: hold → `kind 'lesson' 'confirmed'` on the same court; lesson `scheduled`,
  enrolment `booked`, row `succeeded`; `deposit_status` lesson shape (X14 keys); one `lesson_events`
  `paid_online` (actor `system`) and, through Guest's trigger, one `coach_update` outbox row
  `coach.new_student` for the coach and none for the guest (R40). A source test pins that
  `lesson_settle_success` and `lesson_hold_expire` contain no `lesson_notify(` and no
  `lesson_sync_reminders(`.
- *O2 group and course success*: enrolment `booked`; places unchanged (the held place was counted).
- *O3 prepare*: every refusal in order; a double tap → `reused`; two concurrent prepares → one row;
  a desk-mode enrolment → `LESSON_NOT_PAYABLE desk`; branch switched to `desk` → `ONLINE_PAYMENT_OFF`;
  `platform_settings.lesson_terms_version` NULL, or the guest's accepted version below it →
  `TERMS_REQUIRED` (R50); another guest's enrolment → `ENROLMENT_NOT_FOUND`; three attempts →
  `TOO_MANY_ATTEMPTS`; the hold, lesson and enrolment `hold_expires_at` ≥ the deadline.
- *O4 FAILED* keeps the hold; a retry succeeds.
- *O5 EXPIRED*: enrolment, lesson (`payment_expired`) and hold `expired`; one `expired` event and,
  through the trigger, `lesson.payment_expired` queued; one unsettled `lapsed_hold` strike for the
  guest (R30), applied by the next `hold_strikes_settle`; with a second live attempt, nothing
  expires; with the hold row locked by a second connection, `lesson_hold_expire` returns without
  waiting (R25).
- *O6 late SUCCESS after expiry*: still free → revived on a court (possibly another), the lesson's
  `cancel_reason`, `cancelled_at`, `hold_expires_at` NULL, `paid_online` `{revived: true}`, the
  `lapsed_hold` strike gone; the coach booked meanwhile → `slot_lost` refund; the group full
  meanwhile → `slot_lost`; the lesson started → `slot_lost`.
- *O7 hold expired by TTL* (the payment > 10 minutes past its deadline, so `match_expire_holds` in
  `deposit_apply` expires it): success re-picks a free court from the locked set (R34); no free
  court → `slot_lost`.
- *O8* amount mismatch → whole-row `amount_mismatch`, the enrolment still `held`; a second success →
  `duplicate_success`; degraded inside the horizon → `venue_offline`; deleted payer →
  `account_deleted`.
- *O9 reconciler net*: a `succeeded` row on an enrolment cancelled as postgres with no refund, its
  `updated_at` set 40 days back → the next `deposits_due_for_reconcile` refunds exactly
  `refund_due_online` (no window, R28); `deposit_attention` lists a lesson `refund_failed` row at its
  branch, not at another, with `enrolment_id` and `customer_id`; retry and manual work on it.
- *O10* (R25) `expire_stale_holds` and `match_expire_holds` expire a lesson hold by TTL like any
  hold, never as an orphan, never while its payment is inside the grace, and never an online private
  lesson's hold before its `hold_expires_at`.
- *O11* `deposit_refund_apply` on a lesson row: `refunded`, audit `lesson.refunded`, no outbox row.
- *O12 a full group (R29).* 8 places, 7 booked; G1 joins online and its payment passes the
  ten-minute grace; G2 takes the 8th place at the desk; G1's SUCCESS → `slot_lost` refund, 8 places
  taken, never 9.
- *O13 no raise (R29).* A revival or re-pick that meets a `unique_violation` (a stale live court row
  of the lesson), a `check_violation` or an `exclusion_violation` → `slot_lost`; `deposit_apply`
  returns, the webhook answers 200.

**`tests/coaching-statements.test.ts`** (0284):
- *S1 draft*: September's lessons (D1, D3, D4's sessions 1–2, R2's late cancel) → one draft per coach
  and branch; each line = core `lessonCoachShare(collected, courtShare, bp)`: D1 18,000; D3 21,000;
  D4 session 1 `floor(6000 × 17001 / 10000)` = 10,200; R2 18,000.
- *S2 adjustment*: approve September; D5's goodwill refund in October → October's draft has
  adjustments for sessions 1 and 2 (September's): collected −2,501 and −2,500, coach −1,500 each
  (`8,700 − 10,200`: `floor(6000 × 14,500 / 10000)` against `floor(6000 × 17,001 / 10000)` and
  `floor(6000 × 17,000 / 10000)`); sessions 3 and 4 (October's) regular at collected 47,500 (the
  full member's 22,500 plus the late joiner's 25,000), coach `floor(6000 × 39,500 / 10000)` = 23,700.
- *S3* mark paid without a grant → `PIN_GRANT_REQUIRED`; blank reference →
  `STATEMENT_REFERENCE_REQUIRED`; reference `4111 1111 1111 1111` → `INVALID_ARGUMENT digits` (R49);
  with a PIN → `paid`, no payments/refunds row (L10), audit `coach.statement_paid`, one
  `coach.statement_paid` outbox row; again → `duplicate`. Approve queues `coach.statement_ready`.
- *S4* void an approved statement without a grant → `PIN_GRANT_REQUIRED`; with one → `void`, its
  lessons appear as adjustments on the next draft; void a draft needs no PIN; a `void_reason` with 12
  digits → `INVALID_ARGUMENT`; refresh the void → a new draft for that month; void a paid one →
  `INVALID_TRANSITION paid`.
- *S5* one live draft: with August still a draft, the cron refreshes August and skips September;
  approving August builds September.
- *S6* a lesson ending after the cron run is a regular line on refresh; `stale` true before it.
- *S7* own statement → `FORBIDDEN own_statement` and `can.*` all false; another branch's manager →
  `VENUE_MISMATCH`; the owner in "All branches" sees both branches in `report_coach_statements`,
  and a write or detail on the branch that is not the rail's → `VENUE_MISMATCH` (R21).
- *S8* `my_coach_statements`: own approved and paid only (X12 keys); a draft or void is invisible;
  another coach's never; a retired coach still reads them (C-25), with an empty `current_month`.
- *S9 negative (R59)*: a coach with one private lesson in September, paid at 18,000; a 40,000
  goodwill refund in October leaves October at −18,000 (an adjustment, nothing else) → approve →
  mark paid → `STATEMENT_NOT_APPROVED negative`; void it (PIN) → November's draft carries the
  −18,000 adjustment.
- *S10 one adjustment (R24)*: approve, refund, redraft twice → the adjustment line appears exactly
  once, with its `lesson_id`; every line of every statement has one.
- *S11 the procedure (R59)*: `call app.coach_statements_draft(null)` with a pair whose build raises
  → the other pairs' drafts are committed and the failing pair has none; a booking for coach A
  during the run is not held past A's own build.
- *S12 coach-booked no-shows (C-24, R56)*: a coach-booked private lesson marked `no_show` is a line
  with collected 0 and `coach_booked_no_shows` 1 in `coach_statement_detail`.

**`tests/coaching-reports.test.ts`** (0285): `reports_figures` and `panel_headline` (key order, the
last two keys); `report_revenue.lessonIqd` and `owedToCoachesIqd` per bucket equal §8.1 per bucket;
`report_courts` occupancy with a lesson and its `lessons` block (`owedToCoachesIqd`, no
`coachShareIqd`); `analytics_courts_summary` lesson minutes and the holds filter;
`day_close_online.lessons` (desk refunds by the till shift's day, `kept_iqd`, `kept_count`; X27
keys); `report_lessons` totals (X24 keys); sandbox excluded everywhere; `check:analytics` green with
`PERSON_MONEY_REPORTS` (R42).

**`tests/lesson-begin.test.ts`**: §6.7.

## 11. Situations

| # | Situation | Desk money | Online money | Coach |
| --- | --- | --- | --- | --- |
| 1 | Private booked at the desk, paid before or after | one lesson tab, settled | — | share of 40,000 − 10,000 |
| 2 | Paid online (Qi) | — | one row, `succeeded` | same |
| 3 | Free guest cancel | refund due at the till (manager PIN), counted on the day it is paid out (C-31) | refunded `guest_cancel` | nothing |
| 4 | Late guest cancel, private or group | prepaid kept; unpaid owes nothing | kept | share of what was kept |
| 4b | Leaving a running course late (C-23) | prepaid: refund due for the sessions outside the window | refunded `guest_cancel` for them at once; the next session and any inside the window kept | share of the kept sessions |
| 5 | No-show | prepaid kept; unpaid not collectable | kept | share of what was kept |
| 6 | Coach or staff cancel (and retirement, C-25) | refund due at the till | refunded `coach_cancel` / `staff_cancel`, late cancellers included (R28) | nothing |
| 7 | Under-filled at the cut-off | refund due | refunded `under_filled` | nothing |
| 8 | The rest of a course cancelled after two of four sessions | refund due: sessions 3–4's shares | one partial refund per row | shares of sessions 1–2 |
| 9 | A guest joins a course late | owes `course_late_join_price` | same amount | allocated over the covered sessions |
| 10 | Manager goodwill refund after the lesson | `app.refund` (PIN) with `lesson_goodwill` | `deposit_refund_request` once final | adjustment on the next draft |
| 10b | Two tills refund the same desk money | the second is refused `REFUND_EXCEEDS_DUE` (R36) | — | — |
| 11 | Online payment never completes | — | `expired`; enrolment (and lesson, hold) expired; a `lapsed_hold` strike (R30) | — |
| 12 | Late SUCCESS, slot still free | — | revived, booked; the strike withdrawn | as 2 |
| 13 | Late SUCCESS, slot gone (a full group included, R29) | — | refunded `slot_lost` | — |
| 14 | Qi refuses the refund | — | `refund_failed` → attention list → Retry or "Settled another way" | — |
| 15 | A café order on a lesson tab | refused `LESSON_TAB_NO_GOODS` | — | — |
| 16 | Statement approved, money changes later | — | — | adjustment line next draft |
| 17 | Statement paid | no till movement | — | audit `coach.statement_paid`; push |
| 17b | Statement negative (a refund after a paid month) | — | — | cannot be marked paid; voided (PIN) and carried forward (R59) |
| 18 | Student deletes their account (CD-12) | future enrolments: refund due (the sweep cancels within a minute) | refunded `account_deleted` | sessions already begun only |
| 19 | App Review account pays in Qi sandbox | — | books for real | 0 (CM-15) |

## 12. What this lane needs from the other lanes

**DB:**
- **The online hold row (R1 as amended by R25; was R-1 here).** The hold has `guest_id` NULL,
  `lesson_id` set and `guest_name 'Lesson'` (no guest RPC can confirm, release or deposit-pay it;
  `confirm_booking` also refuses it for staff, R35). 0275 widens `reservations_live_hold_has_guest`
  to accept `lesson_id` in place of a guest (R1); 0277 re-issues `expire_stale_holds` and
  `match_expire_holds` together with only the orphan clause changed to `(r.guest_id is null and
  r.lesson_id is null)` (R25). `hold_expires_at` = the platform hold TTL at booking;
  `lesson_payment_prepare` extends it to the payment deadline. Every DB path that ends a held lesson
  expires its `pending` hold row with R25's `skip locked` statement.
- `lock_coach` and `try_lock_coach` (0275, R6); `coach_available` (0279); `lesson_lock_branch_courts(
  uuid) returns uuid[]` (0280, R34: every active court of the branch in id order, returned);
  `lesson_pick_court(p_venue uuid, p_period tstzrange, p_locked uuid[])` (0280, R34: **a stable
  read** choosing only from `p_locked`, a court with no live row over the period, holds included);
  `lesson_places_taken(uuid, p_exclude_enrolment uuid default null)` /
  `course_places_taken(uuid, p_exclude_enrolment uuid default null)` (held and booked places, the
  named enrolment left out, for R29; §14); `lesson_event` (0280); `lesson_strike_record(uuid, uuid,
  text)` accepting `lapsed_hold` with its `skip locked` existence check and `hold_strikes_settle`
  settling it (R30, R31).
- DB's state machines gain `expired → scheduled` (lessons) and `expired → booked` (enrolments),
  writer Money (R29).
- Online booking (`lesson_book_private`, `lesson_join`, `course_join` with `online`) creates the
  enrolment `held` (and a private lesson `held` with its hold), counts against the hold cap under
  `lock_principal('hold_slot', caller)` (R30), checks the lessons terms (`TERMS_REQUIRED`, R50);
  `lesson_events` `held`. A free (`price_iqd = 0`) enrolment is never online. `set_coaching_settings`
  refuses an online `lesson_payment_mode` until `platform_settings.lesson_terms_version` is set
  (R50).
- **Refunds (R5, R28).** `enrolment_cancel_internal` (its enrolment, every kind, `guest_late`
  included: C-23), `lesson_cancel_internal` and `course_cancel_internal` (every enrolment of the
  lesson or course with an applied online row, **live or not**) write their statuses
  (`cancelled_at` included), then call `app.lesson_refund_start(e, NULL)`, last, under `lock_coach`
  only. They never compute an amount, never pass a `from`, and never pick the reason (db.md §4.7.2's
  reason column is replaced by §5.5's derivation: `account_deleted` stays `account_deleted`).
  `delete_my_account` (0286) calls nothing of Money's; the sweep's `account_deleted` item does (D9).
- `lesson_sweep` (0283) items 1–2 expire held enrolments through `app.lesson_hold_expire` (D8; it
  waits out a live payment's grace) and completes over lessons. Course enrolments stay `booked` when
  the course completes; the rest of a cancelled course sets `cancel_kind 'course_cancelled'`.
- `close_branch` (0277) refuses `BRANCH_HAS_BOOKINGS` detail `coaching_money` when
  `app.lesson_money_open(v)` (0278, §5.4) is true (R37).
- `coach_self` admits a `retired` coach for `my_coach_statements` (R45, C-25).
- Late course joins and course adds price with `course_late_join_price`.
- `desk_lesson_detail`, `my_lesson`, `my_lessons`, `customer_lessons`, `lesson_cancel_mine` read
  money only through `lesson_enrolment_money` (`owed_iqd`, `paid_gross_iqd`, `refund_due_iqd`,
  `refund_due_desk_iqd`, `kept_iqd`, `payable`, and `if_cancelled` for X8's cancel block);
  `desk_lesson_detail` carries `can.take_payment = owed_iqd > 0` for the caller's
  `takeLessonPayment`, and the operator sends `p_expected_owed_iqd = owed_iqd`.
- 0275 DDL of §4.3 (`lesson_id not null`, `coach_statement_lines_kind` dropped, R24); 0276 indexes
  `tabs_by_lesson_enrolment`, `booking_payments_by_lesson_enrolment` (R60), `coach_statement_lines_lesson`,
  the unique `(statement_id, lesson_id)`.
- The `check:locks` gate edit (`ORDER`, `ADVISORY`, `ONCE_PER_SEQUENCE`, the one `SERVICE_WALK`
  list, `lock-order-matches.test.ts:75`) in the 0275 commit (R6, R33); `reservations_match`'s WHEN
  gains `'lesson'` (0277).

**Guest:** the `lesson_events_notify` trigger (0280, R40) maps `paid_online` to `coach.new_student`
(no guest push) and `expired` to `lesson.payment_expired`, and no key to `settled` or `refunded`;
`app.lesson_notify` accepts `coach.statement_ready` and `coach.statement_paid` (route
`coach_statements`) from Money's approve and mark paid, the only direct calls Money makes. The phone
reads `lesson-begin` (§6.7, X33) and `deposit_status`'s lesson shape (§6.6, X14), maps the §6.8
codes with `LESSON_NOT_PAYABLE`'s details, and adds `PaymentPurpose 'lesson'`. Coach mode reads
`my_coach_statements` (§7.5, X12; no drafts).

**Operator:** the lesson payment button sends `lesson_settle` with `p_expected_owed_iqd`; the
refunds-due panel reads `lesson_refunds_due`'s envelope (X21) and calls `app.refund` per payment
with reason `lesson_refund` up to `refund_due_desk_iqd`, or `lesson_goodwill` beyond it, mapping
`REFUND_EXCEEDS_DUE`; an `online_blocked_iqd` item is shown as "hand back outside the till";
`/reports/coaches` reads `report_coach_statements` (X22) and `coach_statement_detail` (X23) and
writes refresh, approve, void (PIN from `approved`), mark paid (PIN; `settleCoaches`; refused when
negative; the copy says "never a card or account number"); the day close shows
`day_close_online.lessons` (X27) with "owed to coaches" labelled outside the cash count; the panel
adds `lessonRevenue` and `owedToCoaches` tiles; the Revenue report reads `lessonIqd` and
`owedToCoachesIqd` (X26); the Courts report reads `lessons` (X25, `owedToCoachesIqd`) and the new
occupancy; the heatmap adds `lesson_minutes`; till history labels a `kind 'lesson'` tab and its
receipt shows the lesson line.

## 13. Rollout constraints for this lane

1. One batch, one push (§6.1 of the contracts). `deploy.yml` deploys `send-push`, then `db push`
   0270–0286, then every other function, `lesson-begin` included. Between the migrations and the
   function, nothing can call `lesson-begin`: coaching is off everywhere.
2. 0272 and 0273 are each alone in their file; 0275 is never split (the anchor lands with the
   columns). The partial indexes on `tabs` and `booking_payments` (0276, Money's two included) are
   pushed outside trading hours or moved to their own `CONCURRENTLY` files (R60).
3. 0278's `_shared` file is untouched; 0281's `_shared/deposits.ts` type change rides with
   `lesson-begin`; 0284's `mutation-types.json` edit starts `functions-deploy` (harmless).
4. `coaching_enabled` stays false until the operator tag and the phone build ship; online stays off
   until the owner switches `lesson_payment_mode` (CD-1), which `set_coaching_settings` refuses
   until the lessons terms are live (C-26, R50).
5. After a hosted push, `cron.job` has `tp_coach_statements` with `call app.coach_statements_draft(null)`.
6. Before real money: the open Qi questions (fees, partial refunds, refund time limit) apply to
   lesson refunds as to deposits.

## 14. Changes and additions to §1

**Changes of the merge draft, all folded** (no longer open):
1. ~~§1.5 `lesson_payment_prepare` signature~~ → **R3**, as §6.2.
2. ~~§1.7 `coach_statement_mark_paid` with `p_pin`, `p_device_id`~~ → **R4**.
3. ~~§1.2 anchor: lesson rows `reservation_id` NULL~~ → **R22**.
4. ~~§1.2 `tabs_lesson_shape` extras~~ → **R22**.
5. ~~§1.2 signed statement-line money; void lines frozen~~ → **R22**; every line carries its lesson,
   `coach_statement_lines_kind` dropped → **R24**.
6. ~~§1.8 `deposit_refund_request`; `expire_stale_holds` + `match_expire_holds`~~ → **R22, R25**.
7. ~~`split_evenly(bigint, int)` as an overload~~ → **superseded by R2/R60**: `iqd_split`, no
   `rpc-overloads.json` entry.

**Open after the consistency pass** (the merge must rule; this file is written as proposed):
1. **R34 → §1.5 `lesson_settle_success(p_payment_id uuid, p_locked uuid[]) returns text`.** The
   re-pick must choose from the courts `deposit_apply` locked, and §1.5's one-argument form cannot
   see them (calling `lesson_lock_branch_courts` inside would print `court_advisory` after
   `match_tickets`).
2. **R59 → §1.7 `coach_statement_void(p_statement_id, p_reason, p_pin text default null,
   p_device_id text default null)`** and `PIN_GATED_RPCS` + `coach_statement_void`: the transports
   prove a PIN only when the call carries a string `p_pin` (R4's reason).
3. **R59 → §1.5 `coach_statements_draft`** is a **procedure** (no `returns int`), security invoker
   with no `SET` clause (PostgreSQL refuses `COMMIT` otherwise), plus the internal
   `coach_statement_draft_one(uuid, uuid, date) returns boolean`; the cron string is `call …`.
4. **R29 → DB's `lesson_places_taken(uuid, p_exclude_enrolment uuid default null)` and
   `course_places_taken(uuid, p_exclude_enrolment uuid default null)`** ("itself excluded").
5. **R25 × R33, the lock gate.** R25's never-wait statement (`… where id in (select … for update
   skip locked)`) is a `FOR UPDATE` on `reservations` to the walker (`lock-order.mjs:160`). Under
   `deposit_apply` it follows the court locks and passes; under `lesson_sweep` (walked, no court
   lock, R6) Rule 3 fails, and so does every DB cancel RPC that ends a held lesson with the same
   statement, while R33 forbids adding coaching names to `STATUS_ONLY_RESERVATION_WRITERS`. Pick
   one: let `lesson_sweep` and those RPCs join the set (they only move rows out of the constrained
   set, the set's own definition), or teach the walker that a `skip locked` lock never waits.
6. **R27 / C-31 reach.** `ops_overview`'s `expectedCashIqd` (0219:1254, :1416-1419) and
   `day_close_shop` (0246:450, :489-493) still date refunds by the payment's day, so the live
   expected-cash tile and the shop card would disagree with `close_day` after a cross-day refund.
   Recommended: re-issue both in 0278 with §5.13's predicate.
7. **R42 × X25.** `report_courts.lessons.coachShareIqd` is renamed `owedToCoachesIqd`:
   `report_courts` is an assistant tool outside `PERSON_MONEY_REPORTS`, so R42's
   `/coach_?(share|iqd)/i` would fail it. The operator reads the new name.
8. **R36 → §1.10** gains `REFUND_EXCEEDS_DUE` (new code, both catalogs, operator `MAPPED_CODES`).
9. **C-23 × CM-5, a blocked refund.** A late course leave refunds before its kept next session is
   over; if the venue then cancels that session, its share has no refund left on the row
   (`refund_blocked_iqd`, listed as `online_blocked_iqd`) and no RPC records handing it back.
   Alternatives: defer the leave refund until that session starts (the guest waits up to the
   window), or add a "handed back" write. Default here: list it, hand it back outside the till.

**Additions** (folded by R1.12 unless marked **new**):
1. **Internal functions:** `lesson_collected(uuid) returns bigint`, `course_late_join_price(bigint,
   int, int) returns bigint` (0278); `lesson_refund_start(uuid, text) returns int` (0278, R5/R28;
   replaces `lesson_refund_online`); `lesson_hold_expire(uuid) returns boolean` (0281); **new**:
   `lesson_money_open(uuid) returns boolean` (0278, R37), `coach_statement_draft_one(uuid, uuid,
   date) returns boolean` (0284, R59).
2. **Constraints and indexes:** `tabs_lesson_enrolment_fkey`, `tabs_lesson_iqd_nonneg`,
   `booking_payments_lesson_enrolment_fkey`, `coach_statement_lines_sign` (0275, inline in the
   `create table`); `tabs_by_lesson_enrolment`, `booking_payments_by_lesson_enrolment` (R60),
   `coach_statement_lines_lesson`, unique `(statement_id, lesson_id)` on `coach_statement_lines`
   (0276). `coach_statement_lines.lesson_id not null`; `coach_statement_lines_kind` dropped (R24).
3. **Branch-guard pairs:** `lesson_enrolments/lesson_enrolment_id` on `tabs` and `booking_payments`.
4. **Refusal details:** `LESSON_NOT_PAYABLE` `held|booked|cancelled|expired|desk|free|no_show|
   nothing_owed|lesson_cancelled`; `LESSON_OWED_CHANGED` `expected X, now Y|tab_open`;
   `PAYMENT_STATE` `lesson_live`; `FORBIDDEN` `own_statement`; `STATEMENT_NOT_DRAFT` `live_draft`;
   `INVALID_TRANSITION` `paid`; `INVALID_ARGUMENT` `p_enrolment_id|p_method|p_expected_owed_iqd|
   p_idempotency_key|p_statement_id|p_reason|p_total|p_n`; **new**: `STATEMENT_NOT_APPROVED`
   `negative` (R59), `INVALID_ARGUMENT` `p_reference|p_reason` hint `digits` (R49),
   `REFUND_EXCEEDS_DUE` `due <n>` (R36), `BRANCH_HAS_BOOKINGS` `coaching_money` (R37, raised by DB),
   `TERMS_REQUIRED` from `lesson-begin` (R50).
5. **Audit actions:** `lesson.settle`, `lesson.payment_begin`, `lesson.paid_online`,
   `lesson.refunded`, `coach.statement_drafted`, `coach.statement_refreshed`,
   `coach.statement_approved`, `coach.statement_voided`, `coach.statement_paid`.
6. **`lesson_events` Money writes** (R40: the rows the push trigger reads): `settled`,
   `paid_online` (`{payment_id, amount_iqd, revived?}`), `expired` (code `payment_expired`),
   `refunded` (code = the refund reason).
7. **Engine keys:** `lesson_enrolment_money` gains `refund_blocked_iqd` and `if_cancelled` (**new**).
8. **Gate:** `SERVICE_WALK` one list in the 0275 commit (R33); `PIN_GATED_RPCS` +
   `coach_statement_mark_paid` (R4) and **new** `coach_statement_void` (open 2), three copies;
   `PERSON_MONEY_REPORTS` (R42); R49's `COACH_DATA` rows.
9. **Cron schedule:** `tp_coach_statements` `'0 0 1 * *'` UTC, `call app.coach_statements_draft(null)`.
   **Amended 2026-10-02 (0293, DB-26):** `'0 12 1 * *'` UTC.
10. **Reason codes** for `app.refund` on a lesson payment: `lesson_refund`, **new** `lesson_goodwill`
    (R36). Tab label of a lesson tab: `'Lesson'`.
11. **Read shapes owned here** (key lists in `shapes.ts`, R41; X picks applied):
    `lesson_enrolment_money`, `lesson_refunds_due` (X21), `deposit_status` lesson block (X14),
    `lesson-begin`, `report_coach_statements` (X22), `coach_statement_detail` (X23),
    `my_coach_statements` (X12), `report_lessons` (X24), `day_close_online.lessons` (X27),
    `reports_figures` / `panel_headline` keys `lessonRevenue`, `owedToCoaches`,
    `report_revenue.lessonIqd` and `owedToCoachesIqd` (X26), `report_courts.lessons` (X25) and
    `lessonMinutes`, `analytics_courts_summary` `lessons` and `lesson_minutes`.
12. **Decisions** CM-1…CM-16 (§2), amended by this pass (CM-3, CM-4, CM-5, CM-6, CM-8, CM-10,
    CM-11, CM-12).

## 15. Known limits

- Adjustments look back 12 months: a lesson whose money changes later than that is not adjusted.
- Reports and statements compute `lesson_collected` per lesson (one engine run per enrolment): an
  owner's "All branches" year is that many runs; the first place to look if a report slows.
- Statement months are local calendar months; reports use business days (start hour 4 by default),
  so a lesson between local midnight and the start hour on the 1st falls in different months on the
  two screens.
- `report_drill` drills `lessonRevenue` (owner only) since 0292 (DB-16); `owedToCoaches` is still
  `INVALID_ARGUMENT`. The revenue, cash and card drills add up to their headline: lesson money by
  §8.1's definitions, every tab of the branch (a tab with no table included), each refund a negative
  twin under its method and, on a lesson tab, under revenue.
- A desk refund due needs a manager at the till with a PIN and an open day; the guest is not told
  automatically when it is paid.
- A late cancel's money is credited to the coach even though no session was given (CM-7, §16 Q1).
- Approval freezes the draft as last refreshed; anything after is next month's adjustment.
- A lesson booked through a sandbox payment is real for the coach and the court but counts 0.
- **Blocked online refunds** (C-23 × CM-5, §14 open 9): a venue cancel of the session a late course
  leaver kept, after the leave's refund, is owed back with no Qi refund left on the row; it is
  listed in `lesson_refunds_due` as `online_blocked_iqd` and handed back outside the till.
- **The window of a course leave is fixed at the cancel** (§5.2, 0292 DB-18: `kept_until`). What is
  still re-judged is a later **reschedule** of a kept session: a session moved past `kept_until` stops
  counting (and one moved before it starts), so a move after a leave's refund can add a blocked
  amount. Smaller than the window change it replaced; left as a known limit.
- **The reconciler's lesson loop has no time window** (R28): every run re-checks the `succeeded`
  rows of cancelled enrolments that keep money (late cancels, no-shows of cancelled enrolments),
  one engine run each. If the loop slows, the first fix is a "nothing can change any more" bound
  on the lessons (every covered session over or cancelled long ago), not an enrolment window.
- **Closing a branch waits for its coaches** (R37): a branch with lessons this month cannot close
  until that month is drafted on the 1st, approved and marked paid, and every desk refund is made.
- A day closed before 0278 keeps its stored figures; its derived `v_day_close_summary.refunds_iqd`
  is re-dated by the new rule (§5.13).

## 16. Owner questions

None blocks the build; each has a default above.
1. **A late cancel's share for the coach** (CM-7). The venue keeps a late-cancelled private lesson's
   money; the coach gets their share though no lesson was given. Default yes ("paid on money
   collected"). Or should late-cancel money stay with the venue?
2. **A desk prepayment on a late cancel** (CM-3). Default: kept, as online money is (a course leave
   keeps only what C-23 keeps).
3. ~~**Negative statements.**~~ Settled by R59: a negative statement cannot be marked paid; it is
   voided (with a PIN from `approved`) and offsets the following month. Collecting it from the
   coach in cash stays outside the system.
4. **Qi fees on lesson refunds**: who bears them on a coach cancel or an under-filled session?
5. **Occupancy** (CM-14): lessons now count as occupied court time on the Courts report. Keep, or
   show bookings-only occupancy beside it?
6. **A blocked refund after a course leave** (§14 open 9): hand it back outside the till (default),
   or hold the leave refund until the kept session has started?
