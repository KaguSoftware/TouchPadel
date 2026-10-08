# Scheduled, assigned checklists: build contract (2026-10-08)

Binding for every lane of this build. It extends the 0165 checklists (role × open/close, daily,
shared) in place; it does not fork a second system. Migration **0323**
(`20261008000323_checklist_schedules.sql`, 14-digit prefix). **Everything goes in 0323.** 0324
and up belong to other sessions (0324 is `assistant_web_search`, 0325–0327 are reserved), so do
not create another migration file.

## 0. Majed's calls (2026-10-08, AskUserQuestion)

- **Who:** the owner assigns a list to a **role** or to **named people** (managers included).
- **Role lists:** per list, the owner picks **one shared list** (anyone in the role ticks, as
  today) or **everyone does their own copy**.
- **Repeats:** every day; chosen weekdays (covers once or twice a week); once or twice a month
  (chosen dates).
- **Mandatory = remind + flag:** pinned on the phone, a push before it is due and when it is
  overdue, overdue shown to manager and owner. **Nothing is locked or blocked** (day close still
  only warns).
- Every list is mandatory. There is no "optional" switch.

Defaults taken without asking (say so in the hand-off):
- Only the owner creates, edits and archives lists (`editChecklists: ['owner']`, unchanged).
  Managers see the board.
- A person's list may be ticked by that person, or by a manager or owner at the branch.
- People on approved `leave` (`staff_requests`, `status='approved'`, `from_date ≤ D ≤ to_date`)
  get no copy of an `each`/`people` occurrence that starts on D, and no checklist push that day.
- An edit made mid-occurrence applies from the next occurrence (today's snapshot rule).
- **SOW:480 and PRODUCT.md:37 still hold:** reads show the *current* occurrence only, with names
  of who it is assigned to and who ticked what. No per-person history, no counts across periods,
  no completion rates, no "missed" report. A missed occurrence simply ends.
- No clock-in exists (SOW:265 excludes a time clock), so "before work / at the end" anchor to the
  **branch's opening hours**, or to a time the owner types.

## 1. Model

### 1.1 Schedule ("repeat")

`repeat_kind`:
- `'weekdays'` with `weekdays smallint[]`: distinct values 0..6, **0 = Sunday** (the `coach_hours`
  and rate-rule convention), 1 to 7 of them. All seven = "every day".
- `'monthdays'` with `month_days smallint[]`: distinct values 1..31, 1 to 4 of them. A day past the
  month's end means the month's **last day** (31 = "last day of the month").

A **scheduled day** is a business date that matches the rule. The **occurrence** for business date
D is the latest scheduled day S ≤ D:
- `period_start = S`;
- `period_end` = the day before the next scheduled day after S.

So a daily list lives one day. A Sunday-only list opens on Sunday and stays open (overdue once
past due) through Saturday. A list on the 1st and 15th runs 1–14 and 15–end. **One rule for
everyone: a list stays open until it is done or the next one starts.** When the next one starts,
the old run is simply no longer current. There is no "missed" record.

Business dates come from `app.venue_business_date(venue, at)` (branch timezone plus start hour).

### 1.2 Due time

`slot text` stays `'open' | 'close'` (old clients label and sort by it). New `due_time time null`:
- `due_time` null with `slot='open'`: due at the branch's **opening time** on S, the first interval
  start in `venue_settings.opening_hours[<mon..sun of S>]`.
- `due_time` null with `slot='close'`: due at the **closing time** on S, the last interval end. An
  end ≤ start means after midnight, so add a day.
- `due_time` set: due at that wall-clock time on S. `slot` is then derived: `'open'` when
  `due_time < '14:00'`, else `'close'`, so old readers keep a sane label.
- With no hours for that weekday, or no settings row, fall back as follows:
  - `open`: S at the business-day start hour;
  - `close`: S + 1 day at the start hour, minus 1 minute.

`due_at timestamptz` is computed once, **when the run is created** (snapshot), in the branch
timezone.

`overdue` is `now() > due_at and done < total`, computed at read time and never stored.

### 1.3 Audience

- `audience='role'`, `copy_mode='shared'`: today's behaviour. One run per occurrence,
  `assignee_id` null, ticked by anyone holding `role` at the branch.
- `audience='role'`, `copy_mode='each'`: one run per active staff member holding `role` at the
  branch (`staff.role = role`, `is_active`, member of the branch via the same membership the
  existing role checks use), `assignee_id` = that person. Holders who joined mid-occurrence get a
  run on the next materialise.
- `audience='people'` (`copy_mode` is always `'each'`, `role` is null): one run per row in
  `checklist_assignees` who is active and at the branch.
- `owner` may be an assignee, and `owner`/`manager` may be a list's role. `prep` stays refused.

## 2. Schema (0323)

`checklist_templates`:
- add `audience text not null default 'role' check in ('role','people')`;
- add `copy_mode text not null default 'shared' check in ('shared','each')`;
- add `repeat_kind text not null default 'weekdays' check in ('weekdays','monthdays')`;
- add `weekdays smallint[] not null default '{0,1,2,3,4,5,6}'`;
- add `month_days smallint[]` (null unless monthdays);
- add `due_time time`;
- add `archived_at timestamptz`;
- `role` drops NOT NULL;
- **drop** `checklist_templates_role_slot_key`;
- add a CHECK (NOT VALID, then a guarded VALIDATE, per packages/db/CLAUDE.md):
  `(audience='role') = (role is not null)` and `(audience='people') <= (copy_mode='each')`,
  plus the array-shape checks. Malformed arrays are refused in the RPC with hints anyway.

New `checklist_assignees`:
- columns: `template_id uuid not null references checklist_templates on delete cascade`,
  `staff_id uuid not null references staff`, `venue_id uuid not null references venues`,
  `created_at timestamptz not null default now()`;
- `primary key (template_id, staff_id)`;
- RLS: select-only for MGMT at visible venues (same shape as the 0234 policies);
- grants: select to authenticated, all to service_role;
- `zz_branch_guard` `('child','checklist_templates','template_id')`;
- add to `rls-matrix.ts` (append only), assistant coverage and `assistant_readable_columns`
  (names only, as the other checklist tables).

`checklist_runs`:
- add `assignee_id uuid references staff`, `period_end date`, `due_at timestamptz`,
  `due_pushed_at timestamptz`, `overdue_pushed_at timestamptz`;
- `role` drops NOT NULL;
- `business_date` stays and **is** `period_start`;
- **drop** `checklist_runs_template_day_key`;
- add unique `checklist_runs_occurrence_key (template_id, business_date, assignee_id) NULLS NOT
  DISTINCT` (PG 17);
- index `(venue_id, business_date)` for the sweep (risk header for the index, as 0165).

Backfill: existing runs get `period_end = business_date`, and `due_at` from rule 1.2 (or leave it
null and treat null as "never overdue"; the DB lane picks one and states it).

## 3. RPCs

All are definer, `set search_path = public`, errcode P0001, `revoke … from public, anon`,
`grant execute … to authenticated` unless marked internal. Every changed body is re-issued from
its **latest** definition.

- **`app.checklist_materialize(p_venue uuid, p_date date) returns int`**
  - *Internal* (no client grant). Idempotent (`on conflict do nothing`).
  - Creates the current occurrence's runs (snapshotting the lines) for every non-archived template
    with at least one line at the branch, per §1.3, skipping people on leave on S.
  - Returns the number of runs created.
- **`app.my_checklists_today(p_venue_id uuid default null)`**
  - Same signature. Calls materialise for the caller's venue.
  - Returns the runs current on today's business date where:
    - the run is a shared role run for the caller's role; or
    - the run's `assignee_id = auth.uid()`.
  - Excludes archived templates.
  - Payload keeps every existing field and **adds** per list: `template_id`, `audience`,
    `copy_mode`, `repeat_kind`, `weekdays`, `month_days`, `period_start`, `period_end`, `due_at`,
    `overdue`, `assignee_id`.
  - Order: unfinished overdue first, then unfinished by `due_at`, then finished.
- **`app.mark_checklist_item(...)`**
  - Same 4-argument signature.
  - Guard: a run with `assignee_id` allows that person or MGMT at the venue. A shared run keeps
    today's rule.
  - Refuses a run whose `period_end` < today's business date with **`CHECKLIST_CLOSED`** (new
    code).
  - Everything else unchanged.
- **`app.save_checklist(p_venue_id uuid, p_template_id uuid, p_expected_version int, p_spec
  jsonb) returns jsonb`**. Owner only, owner at the branch.
  - `p_template_id` null creates a list (expected version 0 or null).
  - `p_spec`:
    ```
    {name_en, name_ar, audience, role?, copy_mode, staff_ids?: uuid[], repeat_kind,
     weekdays?: int[], month_days?: int[], slot: 'open'|'close'|'time', due_time?: 'HH:MM',
     items: [{text_en, text_ar, photo_required}]}
    ```
    `slot:'time'` is stored as a derived slot plus `due_time` (§1.2).
  - Limits as `save_checklist_template`:
    - at most 30 lines, 200 characters per line, 120 characters per name, both languages;
    - staff_ids: 1..50, each active and a member of the branch, else
      **`ASSIGNEE_NOT_AT_BRANCH`** (new code, hint `staff_ids`);
    - weekdays: 1..7 distinct 0..6;
    - month_days: 1..4 distinct 1..31;
    - a bad audience/role/slot/time is `INVALID_ARGUMENT` with a hint naming the field;
    - prep is `INVALID_ROLE`.
  - `TEMPLATE_CHANGED` on a version mismatch. Assignees are replaced whole.
  - Audit `checklist.save`. Returns `{template_id, version}`.
- **`app.archive_checklist(p_template_id uuid, p_expected_version int) returns jsonb`**. Owner only.
  - Sets `archived_at`, which hides the list everywhere at once, open runs included.
  - Audit `checklist.archive`.
- **`app.save_checklist_template(...)`** (legacy, the same 7-argument signature): **must keep
  working for operator stations on the old build.**
  - It operates on the oldest non-archived `audience='role'` template for (venue, role, slot),
    under a row lock or advisory lock instead of the dropped unique key.
  - A new template it creates is shared, every day, with no due_time.
- **`app.checklist_staff_options(p_venue_id uuid default null) returns jsonb`**. MGMT at the
  branch.
  - Returns `[{id, display_name, role}]`: active staff who are members of the branch, plus owners.
  - Used by the picker.
- **`app.checklist_board(p_venue_id, p_business_date)`**. MGMT, same signature.
  - Returns non-archived templates with every existing field plus:
    - the schedule fields (`audience`, `copy_mode`, `repeat_kind`, `weekdays`, `month_days`,
      `due_time`);
    - `assignees [{id, display_name, role}]`;
    - `runs`: the occurrence runs current on that date, each
      `{run_id, assignee_id, assignee_name, period_start, period_end, due_at, overdue, done,
      total, items}`, with items as today.
  - Keeps `today` (the shared run, or the first run, or null) for old builds.
  - Materialises only when the date is today.
- **`app.checklist_day_state(p_venue_id, p_business_date)`**. MGMT, same signature.
  - Keeps the 0188 "as of" rule.
  - One entry per current run, keeping the existing fields (`role`, `slot`, `name_en`,
    `name_ar`, `total`, `done`, `open_items`) and **adding** `template_id`, `assignee_name`,
    `due_at`, `overdue`, `period_start` and `period_end`.
- **`app.checklist_sweep() returns int`**. Internal; cron job **`tp_checklist_sweep`**, every 5
  minutes.
  - For every branch with live templates, it materialises today and then pushes:
    - **due soon**: unfinished, `due_pushed_at` null, `now() >= due_at - 30 min`,
      `now() < due_at`, the run current. Title key `checklist_due`. Sets `due_pushed_at`.
    - **overdue**: unfinished, `overdue_pushed_at` null, `now() >= due_at`, the run current.
      Title key `checklist_overdue`. Sets `overdue_pushed_at`. A run first created after its due
      time gets only this one.
  - Recipients:
    - the assignee for a person run;
    - for a shared run, `app.staff_ids_with_roles(venue, array[role])` **minus owners**, unless
      the list's role is owner.
    - Both exclude anyone on approved leave today.
  - Payload: `{route: 'staff-checklist', id: run_id, title_key, params: {title: <name in
    English; send-push picks its own language strings>}}`. Follow how existing
    `notify_staff` callers fill `params.title`. Dedupe `'checklist:'||run_id||':'||title_key`.
- **`app.notify_staff`**: re-issued from **0322's body** (tag `$notify_staff_0322$`, 41 title keys,
  `shop_price_changed` last), adding `checklist_due` and `checklist_overdue` **after**
  `shop_price_changed`. Also add both keys, in that order, to
  `functions/_shared/staff-push.json` and to `send-push/staffStrings.ts` (EN and AR), and bump the
  key-count tests (`send-push-staff.test.ts`, `staff-push-keys.test.ts`).
- **`app.create_branch`**: re-issued from its latest body.
  - Copies **role** lists with every schedule column (`audience`, `copy_mode`, `repeat_kind`,
    `weekdays`, `month_days`, `due_time`) and skips `audience='people'` lists (their people
    belong to the source branch) and archived lists.

Error codes `CHECKLIST_CLOSED` and `ASSIGNEE_NOT_AT_BRANCH` go into `packages/i18n/src/errors.ts`
`ERROR_CODE_KEYS`, with EN and AR lines (operator `opErrors.protocols.*` and wherever the mobile
`op.errors.*` overrides read), and `check:error-codes`. Every new RPC goes in
`rpc-allowlist.json`, `assistant-coverage.json` and the coverage floor as those files require.

## 4. Operator (apps/operator/src/features/checklists, owner edits, manager reads)

- **The card** on `/protocols` (`ChecklistsCard`):
  - title "Checklists";
  - rows per current run: list name, who (role label, or the person's name), the repeat summary,
    "due HH:MM", and an **Overdue** danger tag;
  - overdue rows first;
  - the 5-row cap stays (Majed's call).
- **The sheet, Today tab**: grouped per list, each run showing the assignee name, due, overdue,
  ticks and photos as today.
- **The sheet, Edit tab**: replaces the role × slot nav with a **list of lists** (name, who,
  repeats), a "New list" button, and the editor. The editor fields, top to bottom:
  1. Name (EN, AR).
  2. **Who**: segmented `A role | Named people`.
     - A role: role select (`HIREABLE_ROLES` + owner, prep never), plus a switch "Everyone does
       their own copy" (off = one shared list).
     - Named people: a multi-select picker over `checklist_staff_options` (name · role, search),
       built as a reusable kit primitive only if `components/kit.tsx` has nothing fitting (grep
       first).
  3. **Repeats**: presets `Every day | Chosen weekdays | Once a month | Twice a month`.
     - Weekday chips Sun..Sat in locale order (Arabic day names).
     - One or two date selects (1–28, plus "Last day").
     - The internal model is §1.1; the presets only drive the fields.
  4. **Due**: `Before opening | Before closing | By a set time` (time input).
  5. Lines, as today: EN, AR, Needs a photo, move, remove, at most 30.
  6. A plain-language summary line, e.g. "Every Sunday, before opening · Bareq, Maha".
  7. Save, Discard, and **Archive** (confirm dialog).
- Save calls `save_checklist`; `TEMPLATE_CHANGED` keeps the reload flow.
- `checklistLogic.ts`: re-key by `template_id`; types for the new fields; pure helpers
  `repeatSummary`, `dueLabel`, `specFromDraft`, `draftProblems` (both languages, at least one
  weekday or date, at least one person for people lists, a time for set-time), all node-tested.
- `readBoard` and `readDayState` stay tolerant (a missing field means the old shape).
- Day close: `ChecklistsOpen` shows the assignee name and overdue. Still a warning, still not in
  `closeBlock`.
- `/tasks` `PhoneCopies`: tolerate the new fields (label with due, overdue).
- Strings in `ws/supplies.{en,ar}.ts` under `ws.supplies.checklists.*`: reword "One shared list
  per role…" and `noneOwner`; add who, repeat, due, overdue and archive keys. Arabic should be
  natural Iraqi-office MSA, not literal.
- Tokens, logical CSS, testids (`checklist-editor`, `checklist-list-<id>`,
  `checklist-who-role|people`, `checklist-repeat-<preset>`, `checklist-due-<kind>`,
  `checklist-archive`, `checklist-person-<id>`).

## 5. Mobile (apps/mobile staff)

- `logic.ts` types gain the new optional fields. Old payloads still parse (every new field
  optional).
- New pure helpers:
  - `dueText(list, now, locale)`: "Due 9:00", "Overdue since 9:00", or "Due Sunday" for an
    occurrence whose due is on another day;
  - `repeatText(list)`;
  - `sortForToday`, matching the server order and putting overdue first.
- **Today** (`TodayChecklists` in `app/staff.tsx`): unfinished lists pinned at the top as today,
  each row with name, `done/total` and a due line. Overdue rows get the danger `Tag` "Overdue".
  The heading count is unchanged.
- **Checklist screen** (`app/staff-checklist.tsx`): under each list's name, a small line with the
  repeat summary and the due/overdue tag. The checkbox list is otherwise unchanged (it is already
  the simple list Majed asked for). Map `CHECKLIST_CLOSED` to a friendly line ("This list has
  ended; pull to refresh") and refetch.
- **Push**: `staff-checklist` is already a route. Nothing new on the phone beyond the catalogue
  test.
- Strings: `staff.checklists.*` (`packages/i18n/src/catalogs/staff/checklists.{en,ar}.ts`): due,
  overdue, dueOn, repeat summaries, closed. Arabic numerals via `countPhrase` where counted.
- Smoke: extend the existing checklist smoke fixtures with an overdue person list (EN and AR).
  There is no new route.

## 6. Gates (before reporting)

- DB:
  - `pnpm db:reset`, then `packages/db/tests/checklists.test.ts` extended;
  - covers schedule maths across weekdays and month ends ("31" in February), each/shared/people,
    leave skip, the assignee guard, CHECKLIST_CLOSED, legacy save, archive, sweep push once,
    create_branch copy, branch guard;
  - the full db suite and the `check:*` gates from packages/db/CLAUDE.md;
  - `pnpm db:types` with no diff after regenerating.
- Root `pnpm typecheck`, `lint`, `test`, `security`; `pnpm --filter @touch/mobile test:smoke`.
- Assistant map regenerated if routes or docs require it (packages/db/CLAUDE.md says when).
- A failure in a file this build did not touch is reported as "pre-existing, not ours", not fixed.

## 7. Shared-tree rules for this build

- Peers own uncommitted work in: `staff-push.json`, `staffStrings.ts`, `rls-matrix.ts`,
  `rpc-allowlist.json`, `rpc-coverage-floor.json`, `assistant-coverage.json`, `errors.ts`,
  `catalogs/en.ts`/`ar.ts`, `packages/db/CLAUDE.md`, `HANDOFF.md`, `lib/workspaces.ts`,
  `lib/auth.tsx`, `components/kit.tsx`, `MyTasks.tsx`.
- Edit those **additively only**; never revert or reformat their lines.
- **No git add, commit, stash, checkout, reset or clean.** No push.

## 8. Review amendments (2026-10-08, after the adversarial review)

Where the review proved the first build wrong, 0323 was fixed in place (it is unpushed). What
changed against §1–§5 above:

- **Edits and new lists (§0 "applies from the next occurrence").** `checklist_materialize` skips an
  occurrence while a run of another occurrence reaches into it (a run that started after S, or an
  older run whose `period_end` ≥ S), so a half-ticked copy is never closed by an edit; the new rule
  starts on its first scheduled day after the old run ends. A list saved after its occurrence's S
  with nothing running (a new list, a list on the 1st made on the 8th) starts on its next
  scheduled day, so no copy is born overdue for a day already over. A person put on a people list
  mid-occurrence gets their first copy from the next one (`checklist_assignees.created_at`, now kept
  for people who stay on the list when it is saved again). A list saved the same day after its due
  time still gets that day's copy and one overdue push (§3, unchanged). Moving a list from monthly
  to daily mid-month therefore starts the daily rule after the month's run ends.
- **`checklist_day_state`.** The no-run fallback follows the same rules (no entry for a list that
  has no copy on purpose, nor for one whose people are all gone, on approved leave on S, or added
  after S), and each entry also carries `assignee_id` and `run_id` (two people of one name stay two
  rows; the operator keys rows by `run_id`).
- **`checklist_board`.** Within one role and slot, lists are ordered oldest first (`created_at`,
  `id`), so an old operator build edits the same list the legacy `save_checklist_template` writes.
- **`checklist_sweep`.** A person's copy is pushed only while they still work at the branch
  (`checklist_member_at`).
- **`my_checklists_today`** also returns `due_time` (`HH:MM` or null); the phone drops the derived
  "Opening"/"Closing" label for a list due by a typed time.
- **Operator.** A person on a saved list who is no longer at the branch is marked "No longer at this
  branch" in the picker, the save is held until they are taken off ("Take them off"), and a list just
  created stays open in the editor until the board's refetch lands.

## 9. Release sequencing (old operator builds)

Operator stations only get new code with an operator tag. A station on the build before 0323 reads
the new payloads like this: people lists never appear in its card, sheet or day-close warning (it
drops entries with no role); an "everyone their own copy" list, or two lists for one role and slot,
repeat the `role:slot` React key and show the same "Role · Opening" label; its Today tab shows one
person's copy as the whole list. Nothing is blocked, but the screens mislead. So:

1. Push 0323 and cut the operator tag that carries the new checklists code in the same release
   window.
2. Until the Devices panel shows every station on that tag, the owner should not create people lists,
   "everyone their own copy" lists, or a second list for a role and slot.
