# Tournaments: build contracts

Date: 2026-10-03. Status: **design, approved by Parsa; scaffold committed, nothing else built.**
This file is binding for every lane of the tournaments build (Phase 2 milestone 7). Where it and
the planning record disagree, this file wins. The planning record is
`~/.claude/plans/this-is-from-another-shiny-snowflake.md` (decisions T-1…T-8, scope, cuts, file
ownership, the build schedule).

It supersedes `PHASE-2-PLAN.md` §C4 (`PHASE-2-PLAN.md:393-397`): there are no `kind = 'tournament'`
reservations and no materialised standings. A tournament plays on the protocol run's event blocks
(`maintenance` + `block_purpose = 'event'`, 0174), and its standings are computed by
`app.tournament_standings` on every read.

`NNNN:line` means `packages/db/supabase/migrations/2026…NNNN_*.sql:line`. Authority order for a
builder: §0 → §1.12 (the scaffold review's rulings) → §1.1–§1.11 → the plan.

## 0. The product and the decisions

### 0.1 In one paragraph

A tournament starts life as a protocol run of kind `tournament` (plan → owner OK → courts →
ready, 0163/0164/0174/0178), which already plans the evening and blocks its courts. When the run
is `done`, a manager publishes it: the run's plan becomes one `tournaments` row, which adopts the
run's event blocks under the court locks. Guests register in the app (open-match eligibility),
with a capacity and a waitlist; the desk adds walk-ins. At the registration cut-off a tournament
below its minimum is cancelled (courts released, push sent), otherwise it closes. The entry fee is
paid at the desk on the day, on a `tournament` tab. The desk starts the play: Americano gets its
whole schedule at once, Mexicano one round at a time from the standings. The desk records each
side's points; standings are points won, then point difference, then head-to-head. The website's
landing lists upcoming tournaments, and each has a noindex public page with its schedule and
standings, names as "First I.".

### 0.2 Decisions (Parsa)

| # | Decision |
| --- | --- |
| T-1 | Americano and Mexicano only. Individual entry, rotating partners. Americano: the whole schedule up front. Mexicano: one round at a time, from the standings. |
| T-2 | The entry fee is paid at the desk on the day, as a `tournament` tab (the lesson desk-pay shape). No Qi; a clean seam (`online_paid = 0`). |
| T-3 | Reuse event blocks (`maintenance` + `block_purpose='event'`, `app.block_courts_for_event`, 0174:612). The desk shows them as the tournament. Fix the block-path gaps: R22 waiting match, degraded mode, `visible_venue_ids`. |
| T-4 | Guests register in the app with open-match eligibility; capacity and waitlist; the desk adds walk-ins. |
| T-5 | The desk records each side's points. Per-tournament points target. Standings: points won, then point difference, then head-to-head. Corrections are audited. Mexicano corrections once a later round exists are handled. |
| T-6 | Created through the protocol run. Publishing turns the run's plan into a `tournaments` row, which adopts its event blocks under court locks. |
| T-7 | Auto-cancel below the minimum at the cut-off (courts released, push sent). Withdrawal is free before the cut-off. No-show plus substitute; unplayed rounds are regenerated. |
| T-8 | The landing `Events` section lists upcoming tournaments (cached, like coaching). Each tournament has a noindex public page with schedule and standings. Names show as "First I.". |

### 0.3 Defaults (taken; Parsa may reverse any)

| # | Default |
| --- | --- |
| TD-1 | Categories are `open`, `women` and `men`, using `profiles.gender` and the phone's `CategoryPill`. |
| TD-2 | Prizes are display text only. One branch per tournament. |
| TD-3 | `venue_settings.tournaments_enabled` defaults to off on every branch. |
| TD-4 | **No fee change after publish.** To change a fee, cancel and start a new run. |
| TD-5 | Entry money is untaxed (tax only comes from order items, 0281:781-827). |
| TD-6 | Migration files are staged without ordinals in `packages/db/.tournaments-staging/` (untracked, `.git/info/exclude`) and numbered at landing. |
| TD-7 | Engine "B2": core TS generates the rounds and SQL checks the invariants (the lesson-grid precedent, `packages/core/src/coaching/grid.ts` against `app.lesson_on_grid`, 0282:176). |
| TD-8 | Standings are computed in SQL (`app.tournament_standings`) and nothing is stored. Core keeps a twin (`rankStandings`), used only for the parity test. |
| TD-9 | The score is `points_a + points_b = points_target` exactly; a time-capped game is entered as an agreed split, a forfeit as 0–target. |
| TD-10 | A sit-out in a fully scored round credits `floor(points_target / 2)` points won and 0 difference. |
| TD-11 | Corrections and no-shows **delete** unplayed rounds (no stale flag); the desk regenerates. |
| TD-12 | Gender is required at registration even for `open` (`match_guest`, 0260:232). |

### 0.4 Cut to v1.1 (explicitly)

Staff-phone scoring screen (seam: `tournament_score` is granted to `court_desk`); check-in;
typed-name walk-ins (walk-ins are real profiles through `desk-customer-create`); per-round clock
times; the `matches_at_risk` warning and re-issuing `tournament_context` / `tournament_feasibility`;
the `starting_soon` and `registered_by_desk` pushes; the revenue line (`reports_figures` 0288,
`report_revenue` / `report_drill` 0292); offline queued types, the app-link claim, knockout,
league, Qi online pay; court move or extend after publish (the guard trigger refuses it);
`close_branch` awareness of open tournaments; a refund cap on tournament tabs.

**Revenue gap (known, tell the client):** entry money appears in cash, card and the day close, never
in "revenue", until M7.1 re-issues 0288 and 0292. The owner's revenue figure runs below cash plus
card by the entry money.

## 1. Names (binding on every lane)

### 1.1 Migrations

Three files, staged in `packages/db/.tournaments-staging/` without ordinals, numbered `max+1..max+3`
at landing (`git fetch && git merge origin/main` first). Dollar tags are written `$<name>_0NNN$`
and a scripted `sed` replaces `_0NNN$` with the real ordinal (`packages/db/CLAUDE.md:239`).

| Order | Slug | Lane | Contents |
| --- | --- | --- | --- |
| 1 | `tournaments_schema_money.sql` | DB-A | switch column + column grant + comment + `assistant_readable_columns` row; `venue_settings_public`; outbox CHECK (`tournament_update`); the 5 tables; tabs widening, link column and shape CHECK, tabs guard; `compute_tab_totals`, `cafe_settled_tabs`; the money engine; `tournament_settle` |
| 2 | `tournaments_lifecycle.sql` | DB-B | `block_courts_for_event` re-issue; the guard trigger; publish, cancel, release blocks; register, withdraw, promote, add, remove; notify; sweep and cron; switch setter; `desk_tournaments`; `tournaments_public` |
| 3 | `tournaments_play.sql` | DB-A (after file 1) | `tournament_set_rounds`; score; no-show and substitute; standings; `desk_tournament_detail`; `tournament_public` |

- **No `create index` anywhere.** Lookups use inline `unique` / `primary key` constraints.
- Every file opens with `set lock_timeout = '3s'; set statement_timeout = '60s';`.
- **send-push deploys before file 1** (the outbox CHECK widens); `deploy.yml` already orders it.

### 1.2 Tables and columns (file 1)

Every table: `id uuid primary key default gen_random_uuid()`; `venue_id uuid not null references
venues(id)` with **no default**; RLS enabled, **0 policies, no client grant** (RPCs only); a
`zz_branch_guard` trigger with its link pairs; `revoke all on <table> from anon, authenticated` (Supabase's default privileges grant them; the 0278:895 precedent). Text columns get a length CHECK; guest-visible text
the `app.safe_line` sanitiser.

```
tournaments
  id                      uuid        not null  pk default gen_random_uuid()
  venue_id                uuid        not null  -> venues
  protocol_run_id         uuid        not null  -> protocol_runs   unique (tournaments_protocol_run_id_key)
  name_en, name_ar        text        not null  1..80
  format                  text        not null  in ('americano','mexicano')
  category                text        not null  default 'open'  in ('open','women','men')
  class                   text        not null  in ('A','B','C')
  points_target           smallint    not null  default 24  8..64
  rounds_planned          smallint    null      1..30   (mexicano: set at publish; americano: set by the first set_rounds)
  max_entries             smallint    not null  4..64
  min_entries             smallint    not null  >= 4
  waitlist_max            smallint    not null  default 8  0..64
  entry_fee_iqd           bigint      not null  default 0  >= 0
  prize_en, prize_ar      text        null      <= 200
  starts_at, ends_at      timestamptz not null
  registration_closes_at  timestamptz not null
  status                  text        not null  default 'open'  in ('open','closed','running','finished','cancelled')
  cancel_reason           text        null      in ('under_filled','staff')
  revision                int         not null  default 0
  closed_at, finished_at, cancelled_at timestamptz null
  published_by            uuid        not null  -> staff(id)
  created_at, updated_at  timestamptz not null  default now()
  check (starts_at < ends_at and registration_closes_at <= starts_at)
  check (min_entries <= max_entries)
  check (format <> 'mexicano' or rounds_planned is not null)
  check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
  guard ('scoped','protocol_runs','protocol_run_id')

tournament_entries
  id, venue_id
  tournament_id           uuid        not null  -> tournaments
  guest_id                uuid        not null  -> profiles
  status                  text        not null  in ('registered','waitlisted','withdrawn','no_show')
  seed_no                 smallint    null      stamped 1..N by entered_at at close (or the first set_rounds)
  entered_at              timestamptz not null  default now()
  added_by_kind           text        not null  in ('guest','staff')
  added_by_staff_id       uuid        null      -> staff(id)
  withdrawn_reason        text        null      in ('guest','staff','account_deleted')
  withdrawn_at, promoted_at, no_show_at timestamptz null
  substitute_for          uuid        null      -> tournament_entries(id)
  created_at, updated_at  timestamptz not null  default now()
  unique (tournament_id, guest_id)
  check ((status = 'withdrawn') = (withdrawn_reason is not null))
  guard ('scoped','tournaments','tournament_id','tournament_entries','substitute_for')

tournament_rounds
  id, venue_id
  tournament_id           uuid        not null  -> tournaments
  round_no                smallint    not null  1..30
  bye_entry_ids           uuid[]      not null  default '{}'   (the round's sit-outs)
  generated_by            uuid        not null  -> staff(id)
  created_at              timestamptz not null  default now()
  unique (tournament_id, round_no), unique (id, round_no)
  guard ('scoped','tournaments','tournament_id')

tournament_matches
  id, venue_id
  tournament_id           uuid        not null  -> tournaments
  round_id                uuid        not null
  round_no                smallint    not null
  foreign key (round_id, round_no) references tournament_rounds(id, round_no) on delete cascade
  court_id                uuid        not null  -> courts
  a1, a2, b1, b2          uuid        not null  -> tournament_entries
  points_a, points_b      smallint    null
  revision                int         not null  default 0
  scored_at               timestamptz null
  scored_by               uuid        null      -> staff(id)
  unique (round_id, court_id), unique (tournament_id, round_no, court_id)
  check (a1, a2, b1, b2 pairwise distinct)
  check ((points_a is null) = (points_b is null) and (points_a is null or (points_a >= 0 and points_b >= 0)))
  guard ('scoped','tournaments','tournament_id','tournament_rounds','round_id','courts','court_id',
         'tournament_entries','a1','tournament_entries','a2','tournament_entries','b1','tournament_entries','b2')

tournament_score_events   (append-only correction audit)
  id, venue_id
  tournament_id           uuid        not null  -> tournaments
  match_id                uuid        not null  -> tournament_matches   (restrict)
  points_a_before, points_b_before smallint null
  points_a, points_b      smallint    not null
  reason                  text        null      <= 300
  actor_staff_id          uuid        not null  -> staff(id)
  at                      timestamptz not null  default now()
  unique (match_id, at, id)
  guard ('scoped','tournaments','tournament_id','tournament_matches','match_id')
```

**Elsewhere in file 1:**

- `venue_settings.tournaments_enabled boolean not null default false`;
  `grant select (tournaments_enabled) on public.venue_settings to authenticated` (0297; the table
  has no table-level SELECT any more); a column comment; an `app.assistant_readable_columns` row
  (0277:146-166 statement, limited to the new column).
- `venue_settings_public` re-created from 0277:111-137 with `vs.tournaments_enabled` **appended
  last**; re-granted to anon, authenticated.
- `notification_outbox_kind_check` re-created from 0274:16-35 with `'tournament_update'` added
  (NOT VALID, then the guarded validate).
- `tabs_kind_chk` → `('cafe','shop','lesson','tournament')` (0276:15-26 pattern).
- `tabs.tournament_entry_id uuid null`, FK `tabs_tournament_entry_fkey` → `tournament_entries(id)`
  (NOT VALID then validated, 0278:582-591).
- CHECK `tabs_tournament_shape`: `(kind = 'tournament') = (tournament_entry_id is not null) and
(kind <> 'tournament' or (reservation_id is null and table_id is null and court_cap_iqd is null))`.
- The tabs `zz_branch_guard` re-created from 0278:751-753 with `'tournament_entries',
'tournament_entry_id'` inserted **before** the lesson pair (the lesson pair stays last,
  `coaching-schema.test.ts:241`).
- **No `tournament_iqd` column on tabs** (§1.12 S1).

### 1.3 Status vocabularies

| Thing | Values |
| --- | --- |
| `tournaments.status` | `open` → `closed` (cut-off, enough entries) → `running` (first `set_rounds`) → `finished` (every planned match scored, or `ends_at + 6h`; a `closed` one with no round drawn is cancelled `staff` at that point instead, so its payers are owed back: review fix 2026-10-03); `open` / `closed` / `running` → `cancelled` |
| `tournaments.cancel_reason` | `under_filled` (the sweep), `staff` (`tournament_cancel`, and the sweep's never-played cancel at the finish, note "not played") |
| `tournament_entries.status` | `registered`, `waitlisted`, `withdrawn`, `no_show` |
| `tournament_entries.withdrawn_reason` | `guest`, `staff`, `account_deleted` |
| `tournament_entries.added_by_kind` | `guest`, `staff` |
| live entry | `registered` or `waitlisted` |

### 1.4 Locks

The lock walker ranks only its `ORDER` list (`scripts/lib/lock-order.mjs:73-90`); the new tables are
unranked, so nothing is added to `ORDER`. Every body states its order in a header comment.

| RPC | Order |
| --- | --- |
| publish | `protocol_runs` FOR UPDATE → `app.lock_court` per court in court-id order → re-select the run's live event blocks FOR UPDATE → insert `tournaments` |
| cancel / finish release / sweep | `tournaments` FOR UPDATE (the sweep: SKIP LOCKED) → `app.lock_court` in court-id order → `reservations` update → outbox (the 0174:566-595 pair) |
| register / withdraw / add / remove / promote / rounds / score / no-show | `tournaments` FOR UPDATE → entries → rounds and matches. No court or advisory lock (score's finish then takes the release order above) |
| settle | `day_sessions` FOR SHARE (`app.current_open_day_locked(venue)`) → `tournaments` FOR SHARE → the entry FOR NO KEY UPDATE → `tabs` → `payments` (→ `till_shifts` by the stamp trigger) |
| `block_courts_for_event` | unchanged: `protocol_runs` → `protocol_run_steps` → courts → reservations |

Rule: `tournaments` before entries before rounds and matches. Nothing takes `day_sessions` after a
tournament lock, and cancel never takes a day lock, so there is no cycle (§1.12 S8).

### 1.5 Internal functions (revoked from public, anon, authenticated; service_role only where marked)

| Function | File | Notes |
| --- | --- | --- |
| `app.tournament_on(p_venue uuid) returns boolean` | 1 | `tournaments_enabled and venues.is_active` |
| `app.tournament_entry_money(p_entry_id uuid, p_exclude_tab_id uuid default null) returns jsonb` | 1 | §1.7; service_role (the shapes and money suites) |
| `app.tournament_fee_remaining(p_entry_id uuid, p_exclude_tab_id uuid default null) returns bigint` | 1 | the till line |
| `app.tournament_release_blocks(p_tournament_id uuid, p_note text) returns int` | 2 | blocks cancelled; called only after the status change |
| `app.tournament_cancel_internal(p_tournament_id uuid, p_reason text) returns jsonb` | 2 | status → release → notify each live entry `tournament.cancelled` → audit; returns `{refunds_due[]}` |
| `app.tournament_promote_internal(p_tournament_id uuid) returns uuid` | 2 | first waitlisted entry by `entered_at` (null when none); sends `tournament.promoted` |
| `app.tournament_notify(p_entry_id uuid, p_title_key text, p_dedupe text) returns void` | 2 | a cut-down `lesson_notify` (0283:4132-4282); `c_keys = {'tournament.cancelled','tournament.promoted'}` |
| `app.tournament_sweep() returns jsonb` | 2 | service_role; `{cancelled, closed, withdrawn, finished}` counts |
| `app.trg_tournament_block_guard() returns trigger` | 2 | trigger `reservations_tournament_guard` |
| `app.tournament_standings(p_tournament_id uuid) returns table(entry_id uuid, rank int, points_won int, points_against int, diff int, h2h int, played int, sat_out int, withdrawn boolean)` | 3 | `language sql stable`; service_role (the parity suite) |

Cron: `tp_tournament_sweep`, `'* * * * *'`, in a pg_cron-guarded DO block (0286:690-697).

### 1.6 Client RPCs (all sent with every argument, nulls included; first statement is the guard)

Staff guard (R57 order): role else `FORBIDDEN` → the row in `app.visible_venue_ids()` else the
`*_NOT_FOUND` code → `is_staff_at(row venue, roles)` else `VENUE_MISMATCH` →
`set_config('app.venue_id', …, true)`. Every RPC is `security definer`, `set search_path = public`,
`revoke … from public, anon`, `grant execute … to authenticated` (the two public reads also to anon).
**No client argument has a default**: every client sends every argument, nulls included (the
coaching bug `f5c61e4d`), and the provisional `types.gen.ts` marks none optional. The two internal
money functions keep `p_exclude_tab_id uuid default null`.

| RPC | Args | Roles | Answer (`TOURNAMENT_SHAPES`) |
| --- | --- | --- | --- |
| `tournament_publish` | `p_run_id uuid, p_settings jsonb, p_idempotency_key text` | manager, owner | `{tournament_id, starts_at, ends_at, blocks[{reservation_id, court_id, start_at, end_at}], unblocked_windows[{court_id, start_at, end_at}]}` |
| `tournament_cancel` | `p_tournament_id uuid, p_reason text` | manager, owner | `{tournament_id, status, refunds_due[{entry_id, net_paid_iqd}]}` |
| `tournament_register` | `p_tournament_id uuid` | guest (`match_guest(true)`) | `{entry_id, status, waitlist_position, duplicate}` |
| `tournament_withdraw` | `p_tournament_id uuid` | guest (`match_guest(false)`) | `{entry_id, status, refund_due_iqd, duplicate}` |
| `tournament_add_entry` | `p_tournament_id uuid, p_guest_id uuid` | court_desk, manager, owner | `{entry_id, status, waitlist_position, duplicate}` |
| `tournament_remove_entry` | `p_entry_id uuid, p_reason text` | court_desk, manager, owner | `{entry_id, status, refund_due_iqd}` |
| `tournament_mark_no_show` | `p_entry_id uuid, p_substitute_entry_id uuid, p_substitute_guest_id uuid` | court_desk, manager, owner | `{entry_id, status, substitute_entry_id, removed_from_round, revision}` |
| `tournament_set_rounds` | `p_tournament_id uuid, p_payload jsonb, p_idempotency_key text` | court_desk, manager, owner | `{revision, rounds_planned, status}` |
| `tournament_score` | `p_match_id uuid, p_points_a smallint, p_points_b smallint, p_expected_revision int, p_reason text` | court_desk, manager, owner | `{match_id, revision, tournament_revision, removed_from_round, status}` |
| `tournament_settle` | `p_entry_id uuid, p_method payment_method, p_expected_owed_iqd bigint, p_tendered_iqd bigint, p_idempotency_key text, p_device_id text` | cashier, court_desk, manager, owner | `{duplicate, payment_id, tab_id, entry_id, amount_iqd, change_iqd, method, owed_iqd, status}` |
| `set_tournaments_enabled` | `p_venue_id uuid, p_enabled boolean` | owner | `{venue_id, tournaments_enabled}` |
| `desk_tournaments` | `p_venue_id uuid, p_from timestamptz, p_to timestamptz` | any staff | `{tournaments_enabled, server_now, tournaments[{id, name_en, name_ar, status, format, category, starts_at, ends_at, registered, waitlisted, max_entries, blocks[{reservation_id, court_id, start_at, end_at}]}]}` |
| `desk_tournament_detail` | `p_tournament_id uuid` | cashier, court desk, managers, owner (the entries carry names and phones; review fix 2026-10-03) | §1.8 |
| `tournaments_public` | `p_venue_id uuid` (null = every live branch) | anon, authenticated; never raises; `publicByDesign` | §1.8 |
| `tournament_public` | `p_id uuid` | anon, authenticated; never raises; `publicByDesign` | §1.8 |
| re-issued `block_courts_for_event` | unchanged `(uuid, jsonb, text)` | unchanged | unchanged, plus conflict kind `match_waiting` (§1.10) |

**Behaviour, per RPC** (the plan §3.6 in full; the rulings of §1.12 amend it):

- **publish.** Lock the run. Not found / outside scope / not a tournament: `PROTOCOL_NOT_FOUND`;
  `is_staff_at` fails: `VENUE_MISMATCH`; switch off: `TOURNAMENTS_OFF`. Then `claim_replay`. Then
  `TOURNAMENT_PUBLISH_REFUSED` with the detail of §1.9. Owner check: `variant in
('type1','type3')` and a passed feasibility step with `needs_owner_ok` and a current submission
  (round = the step's round, not withdrawn or superseded) with decision `approve` or `auto`,
  `decided_by` a staff row with role `owner`. Fee = `coalesce((data->>'entry_fee_iqd')::bigint, 0)`;
  type2 has no fee field (0174:256), so 0. `max_entries = least(capacity.count, 64)`. Names and
  class from `data`; `starts_at` / `ends_at` = min and max of the adopted blocks. Audit
  `tournament.publish`, then `finish_replay`.
- **settings keys** (`p_settings`, every key optional unless marked): `format` (type2 required;
  type1/type3 must equal the plan's), `category`, `points_target` (8..64), `rounds` (Mexicano
  required, 1..30), `min_entries` (4..max_entries), `waitlist_max` (0..64),
  `registration_closes_at` (required; after now, no later than the first block start),
  `prize_en`, `prize_ar` (≤ 200, `app.safe_line`). An unknown key or a bad value:
  `TOURNAMENT_PUBLISH_REFUSED` detail `settings:<key>`.
- **cancel.** `REASON_REQUIRED` for a blank reason. Status `open` / `closed` / `running`, else
  `TOURNAMENT_NOT_OPEN` `status`. `cancel_internal(…, 'staff')`.
- **register.** `match_guest(true)` (AUTH, ACCOUNT, PHONE, TERMS, MATCH_BANNED, GENDER_REQUIRED);
  then lock; unknown or not visible to guests: `TOURNAMENT_NOT_FOUND`; switch off: `TOURNAMENTS_OFF`;
  not `open` or past the cut-off: `TOURNAMENT_NOT_OPEN` `status` | `cutoff`; category mismatch:
  `TOURNAMENT_CATEGORY_MISMATCH`. A live row answers `duplicate: true`. Otherwise `registered`
  while `registered < max_entries`, then `waitlisted` while `waitlisted < waitlist_max`, else
  `TOURNAMENT_FULL`. A withdrawn row is re-used with a fresh `entered_at`. A `no_show` row:
  `TOURNAMENT_NOT_OPEN` `status` (it only exists once play has begun).
- **withdraw.** `match_guest(false)`; no live entry: `TOURNAMENT_ENTRY_NOT_FOUND`; an already
  withdrawn entry answers `duplicate: true`; free while `open` and before the cut-off, else
  `TOURNAMENT_NOT_OPEN` `status` | `cutoff`. A freed registered place runs `promote_internal`.
- **add_entry.** Allowed in `open`, `closed`, `running` (else `TOURNAMENT_NOT_OPEN` `status`).
  The `customer_flags` match ban: `MATCH_BANNED`; category mismatch:
  `TOURNAMENT_CATEGORY_MISMATCH`; no gender on a gendered category: `GENDER_REQUIRED`. No terms or
  phone check. `registered` while `< max_entries`, otherwise `waitlisted` (no `TOURNAMENT_FULL` at
  the desk while `waitlist_max` allows; beyond it `TOURNAMENT_FULL`). Called for a waitlisted guest
  it promotes them if there is room. In `closed` / `running` it stamps the next `seed_no` and bumps
  `revision`.
- **remove_entry.** `open` or `closed` only (in `running`, use no-show): else
  `TOURNAMENT_NOT_OPEN` `status`. `REASON_REQUIRED`. Sets `withdrawn` (`staff`), promotes while open.
- **mark_no_show.** `closed` or `running`, else `TOURNAMENT_NOT_OPEN` `status`; the entry must be
  `registered`, else `INVALID_ARGUMENT` detail `entry_status`; both substitute arguments given:
  `INVALID_ARGUMENT` detail `substitute`. A substitute entry must be a waitlisted entry of the same
  tournament (else `TOURNAMENT_ENTRY_NOT_FOUND`); a substitute guest runs the add_entry checks (a
  live entry of that guest is used if waitlisted; registered: `INVALID_ARGUMENT` detail
  `substitute`). With a substitute: it becomes `registered` with `substitute_for` and the next
  `seed_no`; unscored matches swap a1/a2/b1/b2 in place and `bye_entry_ids` use `array_replace`.
  Without: if the entry's first unscored round already has a scored match,
  `TOURNAMENT_ROUNDS_INVALID` `played`; otherwise delete the rounds from that round on and answer
  `removed_from_round`. `revision += 1`; audit `tournament.no_show`.
- **set_rounds.** §1.10 payload; refusals and writes per the plan §3.6 table (details in §1.9).
- **score.** Lock the tournament; `running` or `finished` else `TOURNAMENT_SCORE_REFUSED` `status`;
  unknown match: `TOURNAMENT_NOT_FOUND`; `points_a + points_b = points_target`, both ≥ 0, else
  `invalid`; `p_expected_revision <> match.revision`: `changed`; a correction (the match already
  scored) needs `p_reason` (`REASON_REQUIRED`); a Mexicano correction of round r with a scored
  match in a round > r: `locked`, otherwise the unscored rounds > r are deleted and
  `removed_from_round = r + 1`. Writes the match (`revision + 1`, `scored_at`, `scored_by`), a
  `tournament_score_events` row every time, `tournaments.revision += 1`, audit `tournament.score`.
  Finish when every match of rounds 1..`rounds_planned` is scored (Mexicano: and `rounds_planned`
  rounds exist): `finished`, `finished_at`, then `tournament_release_blocks`.
- **settle.** The `lesson_settle` clone (0281:1993-2155), §1.7.
- **set_tournaments_enabled.** Owner, else `FORBIDDEN`; `is_staff_at(p_venue_id, 'owner')` false
  (unknown or closed branch): `VENUE_MISMATCH`; null `p_enabled`: `INVALID_ARGUMENT`. Audit
  `venue.tournaments_settings`.
- **desk_tournaments.** Any staff, a visible branch (else `VENUE_MISMATCH`); mirrors
  `desk_lessons` (0294:893): tournaments of the branch not cancelled whose `[starts_at, ends_at)`
  overlaps `[p_from, p_to)`, plus a cancelled one only when it still has a live block in range.
- **tournaments_public.** `{off: true}` for an unknown, closed or switched-off branch (and for
  `null` when no live branch has tournaments on). Lists `open`, `closed`, `running`, plus
  `finished` in the last 7 days. `mine` is filled only with `auth.uid()`.
- **tournament_public.** `{missing: true}` for unknown, branch off or closed, or cancelled more than
  7 days ago. Names appear only once a schedule exists, never for the waitlist.

### 1.7 Money (file 1)

```
app.tournament_entry_money(p_entry_id, p_exclude_tab_id default null) → jsonb
  {entry_id, tournament_id, entry_status, tournament_status, fee_iqd, desk_paid_iqd,
   desk_refunded_iqd, online_paid_iqd, net_iqd, payable, owed_iqd, refund_due_iqd}
fee           = tournaments.entry_fee_iqd
desk_paid     = Σ payments.amount_iqd on tabs kind 'tournament', tournament_entry_id = entry,
                status 'settled', merged_into_tab_id null, id <> p_exclude_tab_id
desk_refunded = Σ refunds.amount_iqd on those payments
online_paid   = 0                                   -- the Qi seam
net           = desk_paid - desk_refunded + online_paid
payable       = entry.status = 'registered' and tournament.status <> 'cancelled'
owed          = payable ? greatest(fee - net, 0) : 0
refund_due    = (entry.status = 'withdrawn' or tournament.status = 'cancelled') ? net : 0
NULL for an unknown entry. Stable, no locks, no name, phone or guest id.

app.tournament_fee_remaining(p_entry_id, p_exclude_tab_id) → bigint
  = (tournament_entry_money(p_entry_id, p_exclude_tab_id)->>'owed_iqd')::bigint, 0 when null
```

- `compute_tab_totals` (re-issued from 0281:716, `create or replace`, **same six columns**): after
  the lesson block, `v_tour := case when t.kind = 'tournament' then
app.tournament_fee_remaining(t.tournament_entry_id, t.id) else 0 end`; `total_iqd` adds
  `+ v_tour` beside `+ v_court + v_lesson`. Re-state `revoke … from public, anon, authenticated;
grant execute … to service_role` (0281:844-845) and the comment.
- `cafe_settled_tabs` (re-issued from 0281:1042): `t.kind not in ('lesson', 'tournament')` at
  0281:1079 (**mandatory**: without it a settled tournament tab counts as café gross).
- `tournament_settle` (clone of `lesson_settle`): role (`FORBIDDEN`) → `INVALID_ARGUMENT` (detail
  `p_entry_id`, `p_method`, `p_expected_owed_iqd` ≥ 1, `p_idempotency_key` required) → scope
  (`TOURNAMENT_ENTRY_NOT_FOUND`) → `VENUE_MISMATCH` → `claim_replay(…, 'tournament_settle')` →
  `current_open_day_locked(venue)` else `NO_OPEN_DAY` → the tournament FOR SHARE → the entry FOR NO
  KEY UPDATE → `TOURNAMENT_NOT_PAYABLE` (detail §1.9) → `TOURNAMENT_OWED_CHANGED` (detail
  `expected X, now Y`) → insert the tab (`label 'Tournament'`, `kind 'tournament'`, the open day,
  `tournament_entry_id`) → `compute_tab_totals.total_iqd` must equal owed (else
  `TOURNAMENT_OWED_CHANGED`) → `settle_tab(tab, method, tendered, owed, key, device, owed)` with
  `IDEMPOTENCY_CONFLICT` as 0281:2119-2124 → audit `tournament.settle` → `finish_replay`.
- Refunds go through the generic `app.refund` (`REFUND_EXCEEDS_PAYMENT` and the PIN; no due cap).

### 1.8 Read shapes (`packages/core/src/tournaments/shapes.ts`, `TOURNAMENT_SHAPES`)

The shapes file is the binding key list; a server may add keys, never rename or drop one. A
player as a public surface shows them is `{name, former, no}`: `name` is
`app.match_display_name(guest_id)->>'name'` ("First I.") or null, `former` true for a deleted
account ("Former player"), `no` the entry's `seed_no`; a staff-added entry whose profile has no
`terms_version` answers `name: null` ("Player <no>").

- `tournaments_public`: `{off, server_now, branches[{venue_id, name_en, name_ar, timezone}],
tournaments[{id, venue_id, name_en, name_ar, format, category, starts_at, ends_at,
registration_closes_at, entry_fee_iqd, prize_en, prize_ar, max_entries, places_left,
waitlist_open, status, mine{entry_id, status, waitlist_position}}]}`.
- `tournament_public`: `{missing, id, venue_id, branch{venue_id, name_en, name_ar, timezone},
name_en, name_ar, format, category, points_target, rounds_planned, starts_at, ends_at,
registration_closes_at, entry_fee_iqd, prize_en, prize_ar, status, max_entries, entries_count,
places_left, waitlist_open, server_now, rounds[{round_no, sit_out[player],
matches[{court_no, a[player, player], b[player, player], points_a, points_b}]}],
standings[{rank, player, points_won, diff, played}], me{entry_id, status, waitlist_position,
owed_iqd}}`.
- `desk_tournament_detail`: the tournament (`id, venue_id, protocol_run_id, name_en, name_ar,
format, category, class, points_target, rounds_planned, max_entries, min_entries, waitlist_max,
entry_fee_iqd, prize_en, prize_ar, starts_at, ends_at, registration_closes_at, status,
cancel_reason, revision, closed_at, finished_at, cancelled_at`), `timezone, server_now`,
  `entries[{entry_id, guest_id, full_name, phone, status, seed_no, waitlist_position,
added_by_kind, owed_iqd, net_paid_iqd, refund_due_iqd, substitute_for}]`,
  `courts[{court_id, name_en, name_ar, sort_order}]` (from the live adopted blocks),
  `rounds[{round_no, sit_out[], matches[{match_id, court_id, a[2], b[2], points_a, points_b,
revision, corrections}]}]` (entry ids), `standings[{entry_id, rank, points_won, points_against,
diff, h2h, played, sat_out, withdrawn}]`, `can{add, set_rounds, score, cancel, settle}`.
- `tournament_entry_money`: §1.7.

### 1.9 Error codes (12 new; every one in `ERROR_CODE_KEYS`, both op catalogs)

| Code | Detail | Raised by |
| --- | --- | --- |
| `TOURNAMENTS_OFF` | — | publish, register (switch off at the branch) |
| `TOURNAMENT_NOT_FOUND` | — | every tournament-id RPC; score for an unknown match |
| `TOURNAMENT_PUBLISH_REFUSED` | `not_done`, `already_published`, `capacity_unit`, `capacity_count`, `format`, `fee_not_approved`, `no_blocks`, `settings:<key>` | publish |
| `TOURNAMENT_NOT_OPEN` | `status`, `cutoff` | register, withdraw, add, remove, no-show, cancel |
| `TOURNAMENT_FULL` | — | register, add |
| `TOURNAMENT_CATEGORY_MISMATCH` | — | register, add, no-show substitute |
| `TOURNAMENT_ENTRY_NOT_FOUND` | — | withdraw, remove, no-show, settle |
| `TOURNAMENT_ROUNDS_INVALID` | `status`, `stale`, `engine`, `format`, `numbering`, `played`, `mexicano_one`, `round_open`, `seat`, `court`, `courts_used` | set_rounds, no-show (`played`) |
| `TOURNAMENT_SCORE_REFUSED` | `status`, `invalid`, `changed`, `locked` | score |
| `TOURNAMENT_NOT_PAYABLE` | `waitlisted`, `withdrawn`, `no_show` (the entry's status), `cancelled`, `nothing_owed` | settle |
| `TOURNAMENT_OWED_CHANGED` | `expected X, now Y` | settle |
| `TOURNAMENT_VIA_EVENTS` | — | the guard trigger (cancel, move, mark, extend of an adopted block) |

Reused: `FORBIDDEN`, `VENUE_MISMATCH`, `PROTOCOL_NOT_FOUND`, `INVALID_ARGUMENT`, `REASON_REQUIRED`,
`DEGRADED_LOCKOUT`, `NO_OPEN_DAY`, `IDEMPOTENCY_CONFLICT`, the match eligibility codes
(`AUTH_REQUIRED`, `ACCOUNT_REQUIRED`, `PHONE_REQUIRED`, `TERMS_REQUIRED`, `MATCH_BANNED`,
`GENDER_REQUIRED`), `TENDER_SHORT`, `TENDER_CARD`, `SLOT_TAKEN`, `COURT_NOT_FOUND`.

The set_rounds checks, in this order (SQL raises the first; `validateRoundsPayload` returns every
failing detail in this order, so its first equals SQL's):

| # | Check | Detail |
| --- | --- | --- |
| 1 | status in `closed`, `running` | `status` |
| 2 | `based_on_revision = revision` | `stale` |
| 3 | `engine = 'tp-tour-1'` | `engine` |
| 4 | `format` = the tournament's | `format` |
| 5 | `1 ≤ from_round ≤ last + 1`; n ≥ 1 rounds (every format: an Americano start sends the whole schedule, a regeneration at least one round); `round_no` contiguous from `from_round`; `from_round − 1 + n ≤ 30` | `numbering` |
| 6 | no scored match in rounds ≥ `from_round` | `played` |
| 7 | Mexicano: n = 1 and `from_round ≤ rounds_planned` | `mexicano_one` |
| 8 | Mexicano: every match of round `from_round − 1` is scored | `round_open` |
| 9 | active set = registered entries; each exactly once per round across matches and sit-outs; nothing else; 4 distinct per match | `seat` |
| 10 | courts distinct per round, each a court of a live adopted block of the run | `court` |
| 11 | `1 ≤ matches ≤ floor(active / 4)` per round | `courts_used` |

Checks run in that order after the lock and `claim_replay`. "Last" is the highest existing
`round_no` (0 when none). A payload that is not the §1.10 shape at all (not an object, `rounds`
not an array, a team that is not two ids, a non-integer number) is `INVALID_ARGUMENT` detail
`p_payload` before check 1, and `validateRoundsPayload` answers `['payload']` alone. An unknown
tournament is `TOURNAMENT_NOT_FOUND` (before the key is claimed).

Writes: stamp `seed_no` on registered entries still null (by `entered_at`, then id); delete rounds
≥ `from_round`; insert the new ones; Americano `rounds_planned = from_round − 1 + n`;
`revision += 1`; `closed` → `running`; audit `tournament.rounds`.

### 1.10 Payload, push, events

**Rounds payload** (`TourRoundsPayload`, core `types.ts`):

```
{ engine: 'tp-tour-1', format: 'americano' | 'mexicano', based_on_revision: int, from_round: int,
  rounds: [{ round_no: int, matches: [{ court_id, a: [entry_id, entry_id], b: [entry_id, entry_id] }],
             sit_out: [entry_id…] }] }
```

**Push** (one guest kind; DB-B lands the JSON, the copy and the tests together, §1.12 S12):

- kind `tournament_update`; title keys `tournament.cancelled`, `tournament.promoted` (both
  `tournament_update`); route `tournament`, id = the tournament id; no new params.
- `_shared/guest-push.json`: `kinds` gains `tournament_update` (appended last), `title_keys` the two
  keys (appended last), `routes` gains `tournament` (appended last), `params` unchanged.
- `send-push/index.ts`: a batch read of `tournaments(id, venue_id, starts_at, status)` beside the
  lesson read (:294-322), a terminal `TOURNAMENT_GONE` stamp for a vanished row.
- Phone: `features/tournaments/pushRoutes.ts` exports `TOURNAMENT_PUSH_KINDS = ['tournament_update']`
  and `TOURNAMENT_PUSH_ROUTES = ['tournament']`, spread last into `features/matches/pushRoutes.ts`.

**Event-block conflict kind:** `block_courts_for_event` may answer a conflict
`{court_id, start_at, end_at, reservation_id: null, kind: 'match_waiting', status: 'awaiting_court'}`;
both client parsers keep it (`eventBlock.ts:170`, staff `protocols/logic.ts:847`), worded by
`ws.events.block.conflictKind.match_waiting`.

**Audit actions:** `tournament.publish`, `tournament.cancel`, `tournament.register`,
`tournament.withdraw`, `tournament.add_entry`, `tournament.remove_entry`, `tournament.promote`,
`tournament.no_show`, `tournament.rounds`, `tournament.score`, `tournament.settle`,
`tournament.finish`, `venue.tournaments_settings`, and `reservation.cancel` per released block.

### 1.11 Client names

- Core: `@touch/core/tournaments` (`packages/core/package.json` export; **not** re-exported from
  `src/index.ts`: `protocols/types.ts:154-199` already exports `TournamentFormat`). New names use
  the `Tour*` prefix. Scaffold: `types.ts` (`TourFormat`, `TourCategory`, `TourStatus`,
  `TourEntryStatus`, `TourEntryRef`, `TourCourt`, `TourMatch`, `TourRound`, `TourRoundsPayload`,
  `TourStandingRow`, `TOUR_ENGINE`, the detail lists), `shapes.ts` (`TOURNAMENT_SHAPES`,
  `PUBLIC_TOURNAMENT_READS`, `tourMissingKeys`, `tourHasKeys`), `validate.ts`
  (`validateRoundsPayload(payload, ctx) → TourRoundsDetail[]`), `score.ts`
  (`isValidScore(a, b, target)`). Engine lane: `prng.ts` (`seedFrom`, `mulberry32`, `shuffle`),
  `americano.ts` (`americanoSchedule({entries, courts, rounds, seed, history}) → TourRound[]`),
  `mexicano.ts` (`mexicanoRound({entries, courts, standings, lastRound, roundNo, seed}) →
TourRound`), `regenerate.ts` (`regenerateFrom({format, fromRound, history, entries, courts,
rounds, standings, seed}) → TourRoundsPayload`), `standings.ts` (`rankStandings`); the engine
  lane appends its five `export *` lines to `index.ts`.
- i18n: `tournaments.common.*`, `tournaments.guest.*`, `tournaments.web.*` (catalogs
  `tournaments.{common,guest,web}.{en,ar}.ts`, assembled by `tournaments.{en,ar}.ts`, mounted in
  `en.ts` / `ar.ts`); `ws.tournaments.*` (`ws/tournaments.{en,ar}.ts`); `op.errors.TOURNAMENT_*`
  (`opErrors.tournaments.{en,ar}.ts`); `ws.events.block.conflictKind.match_waiting`. Lanes fill
  only their own fragment files and never edit `en.ts`, `ar.ts` or `ws/index.ts`. Arabic is
  DRAFT-AR.
- Operator: routes `/desk/tournaments`, `/desk/tournaments/$id`; capabilities `runTournaments`
  (court_desk, manager, owner), `publishTournaments` (manager, owner), `takeTournamentPayment`
  (cashier, court_desk, manager, owner); `QK.tournaments` (not persisted).
- Phone: `app/tournaments.tsx` (smoke `tournaments`, testID `tournaments.list`),
  `app/tournament/[id].tsx` (smoke `tournament-detail`, testID `tournament-detail.register`);
  query key root `['tournament']`, kept out of dehydration.
- Web: `src/lib/tournaments.server.ts` (`unstable_cache(['tournaments-public'], {tags:
['tournaments'], revalidate: 60})`), `src/lib/tournaments.ts`, `app/[locale]/events/[id]/page.tsx`
  (per-id cache `revalidate: 30`, tag `tournaments`).

### 1.12 Scaffold review rulings (2026-10-03; they amend §1.1–§1.11 and win over the plan)

A focused read of the plan's §3.4 locks, §3.6 money and §3.2 re-issues against the latest bodies
(0281, 0174, 0263, 0260; checked that 0282–0298 re-issue none of `block_courts_for_event`,
`compute_tab_totals`, `cafe_settled_tabs`, `settle_tab`, `refund`, `match_court_claimed`,
`match_guest`, `match_display_name`, `assert_not_degraded_for`, `assert_tab_kind_role`).

#### Money

- **S1. No seventh column.** `compute_tab_totals` keeps its six columns; the tournament line is
  only in `total_iqd`. `lesson_iqd` stays the lesson line (0 on a tournament tab), so
  `settle_tab` (0281:922-929) stamps `lesson_iqd = 0` and `total_iqd` with the fee, and
  `tabs_lesson_shape` (0278:603-606) holds. `tournament_settle` checks `total_iqd = owed` only
  (`lesson_settle`'s 0281:2112 also checks `lesson_iqd`; the tournament twin must not).
- **S2. The engine excludes the tab, so no add-back.** `lesson_fee_remaining` (0281:426-442) adds a
  settled tab's `lesson_iqd` back because `lesson_enrolment_money` never excludes a tab.
  `tournament_entry_money` takes `p_exclude_tab_id` itself and leaves that tab's payments and
  refunds out of `net`, so `tournament_fee_remaining` is just its `owed_iqd`; re-totalling a
  settled tournament tab gives back its own fee, as the lesson line does.
- **S3. Money is read from payments, not stamps.** `desk_paid` sums `payments.amount_iqd` (never
  `tendered_iqd`, never `tabs.total_iqd`), `desk_refunded` sums `refunds.amount_iqd` joined through
  those payments.
- **S4. Who may take it.** `settle_tab` calls `assert_tab_kind_role(kind)` (0244:43-60): a
  `tournament` tab falls in its café arm, so cashier, court_desk, manager and owner pass and
  shop_staff gets `TAB_KIND_FORBIDDEN`. `tournament_settle`'s own guard already refuses shop_staff
  first. Not re-issued.
- **S5. A tournament tab is never open.** It is inserted and settled inside `tournament_settle`'s
  transaction (any refusal rolls the insert back), so `trg_match_booking_no_cafe` (orders and
  adjustments on it) and `merge_tabs` need no tournament arm, and no partial unique index is
  needed: the entry FOR NO KEY UPDATE serialises two settles, and the second reads owed = 0
  (`TOURNAMENT_NOT_PAYABLE` `nothing_owed`). `open_tab` already refuses any kind but café and
  shop (0280:1227).
- **S6. Reports.** With `cafe_settled_tabs` excluding the kind, no other café-gross sum exists
  (`total_iqd - court_iqd` appears only there, 0219:57 and 0281:1068). `report_drill` (0292:1909, 1933) files a payment or refund on a non-lesson tab under its method only, so entry money shows in
  cash and card and never in `revenue` or `cafeNet`: the plan's revenue gap, as intended.
- **S7. Refunds take no tournament lock.** `app.refund` (0281:1102) on a tournament tab runs its
  generic path (`day_sessions` → `tabs` → `payments` → `till_shifts` → `refunds`); the refund-due
  figure is read without a lock, so a refund racing a cancel is bounded by
  `REFUND_EXCEEDS_PAYMENT` only (the accepted N2 limit).

#### Locks

- **S8. No cycle.** Settle: `day_sessions` (share) → `tournaments` (share) → entry → `tabs` →
  `payments`. Cancel / release: `tournaments` → court advisory → `reservations`. Refund: `day_sessions`
  → `tabs` → … (no tournament). Publish: `protocol_runs` → court advisory → `reservations` → insert
  (no tournament row exists yet; the unique key on `protocol_run_id` plus the run lock serialise two
  publishes). Match inserts take FOR KEY SHARE on entries, which FOR NO KEY UPDATE does not block
  (review N1). The walker sees only ranked names, and every ranked sequence above is in `ORDER`.
- **S9. The guard trigger meets no other writer.** Every `reservations` writer was checked: no
  sweep auto-completes a `maintenance` row (`lesson_court_release` completes `kind = 'lesson'` rows
  only, 0283:486; `close_branch` writes no reservation, 0280:671-750; `expire_stale_holds` touches
  holds). Before publish only `protocol_pass_tournament_plan` / `protocol_stop_tournament` cancel
  event blocks (0174:566-595), and they need an active or scheduled run. After publish, the
  tournament's own release sets `tournaments.status` to `cancelled` / `finished` first, in the same
  transaction, so the trigger lets it through. `reservations_match` part B fires only on newly firm
  rows, never on a cancel.

#### `block_courts_for_event` (re-issued from 0174:612, verbatim plus)

- **S10. Scope line.** 0174:639 becomes `not (v_run.venue_id = any ((select
app.visible_venue_ids())::uuid[]))` (the cast form, `packages/db/CLAUDE.md:206`); the
  `is_staff_at` miss stays `FORBIDDEN` (0174:642; N9 rejected).
- **S11. Degraded and R22.**
  - `v_min_start` is the earliest `start_at` of the request, computed in the validation loop; the
    `assert_not_degraded_for(v_min_start, v_run.venue_id)` call goes after validation and before the
    court locks (after `claim_replay`, which the raise rolls back). This is stricter than
    `staff_create_reservation`, which has no degraded check: an event block is planned work, and
    while a branch trades offline the desk's queued bookings may replay onto the same courts.
  - The combined R22 check mirrors `match_court_claimed` (0263:186-225) exactly: the awaiting
    matches considered **and** the awaiting matches counted both drop a degraded branch inside its
    protected horizon; `free_after` counts active courts with `m.duration_min = any
(duration_options)`, no live reservation over `m.period` (this run's existing identical blocks
    count as live: they are already there), and no block of this request overlapping `m.period` on
    that court. Refuse when `free_after < count(awaiting matches over m.period)`. A plain read,
    with no `match_venue` mutex (the sweep is the backstop, as for `match_court_claimed`). Only a
    requested block whose own court could book M (active, offering `m.duration_min`, no live row
    over `m.period`) is refused for it, as `match_court_claimed` asks of its one court (review fix
    2026-10-03: a block on a court M can never take starved nothing). Each
    conflict row is the requested block's `{court_id, start_at, end_at}` with `reservation_id:
null, kind: 'match_waiting', status: 'awaiting_court'`; one row per requested block, however
    many matches it starves. The answer is sorted as today (start, court, then the null id last).
  - `and c.is_active` joins the court check at 0174:680 (the plan said :687; it is the `courts` test in the validation loop), so an inactive court is `COURT_NOT_FOUND`.

#### Push and fixtures

- **S12. The push catalogue lands with its copy.** `_shared/guest-push.json` is checked by stackless
  tests on both sides (`tests/send-push-guest.test.ts` wants `GUEST_STRINGS` keys to equal its
  `title_keys`; the phone's `matches/__tests__/pushRoutes.test.ts` wants `GUEST_PUSH_ROUTES` /
  `GUEST_PUSH_KINDS` to equal its lists). Changed in the scaffold, it would turn root `pnpm test`
  red before any lane. So DB-B lands the JSON change (§1.10), `guestStrings.ts`, the
  `send-push-guest.test.ts` lists (`kinds` + `tournament_update`, `routes` + `tournament`, the key
  list) and `outbox-kinds.test.ts` (16 → 17) together; W-MOB codes `pushRoutes.ts` to §1.10 and its
  `pushRoutes.test.ts` goes green at the integration merge.
- **S13. Answer additions** (written into §1.6 and §1.8 above; the plan left them open):
  `tournament_publish.unblocked_windows` is `[{court_id, start_at, end_at}]`, each a court and range
  of the plan's `ranges` that no live block of the run covers; `tournament_withdraw` answers
  `{entry_id, status, refund_due_iqd, duplicate}`; `tournament_remove_entry` adds `entry_id`,
  `status`; `tournament_mark_no_show` answers `{entry_id, status, substitute_entry_id,
removed_from_round, revision}`; `tournament_score` adds `tournament_revision` (its `revision` is
  the match's, which the next correction sends as `p_expected_revision`; `set_rounds` sends the
  tournament's as `based_on_revision`); `tournament_cancel` adds `tournament_id`, `status`;
  `tournament_add_entry` adds `waitlist_position`, `duplicate`; `desk_tournaments` wraps its rows
  in `{tournaments_enabled, server_now, tournaments}`; both public reads carry `server_now` and the
  branch (`branches[]` / `branch`, with `timezone`, so a client formats local times); public names
  are the `{name, former, no}` player object.
- **S14. `TOURNAMENT_NOT_PAYABLE` detail** is the entry's own status when it is not `registered`
  (`waitlisted`, `withdrawn`, `no_show`), then `cancelled`, then `nothing_owed`, in that order.

## 2. Lanes

| Lane | Owns |
| --- | --- |
| Integrator | this file, `CONTINUE.md`; core `types/shapes/validate/score` + the `./tournaments` export; `errors.ts`; `opErrors.tournaments.*`; the catalog stubs and mounts; `ws/index.ts`; the provisional `types.gen.ts`; `rls-matrix.ts`, `rpc-allowlist.json`, `stored-fields.test.ts`; `.git/info/exclude`; Phase 3: the final `types.gen.ts`, assistant coverage and map, the registry floor, `packages/db/CLAUDE.md` ordinal line, paperwork |
| DB-A | staged files 1 and 3; `tests/tournaments-plant.ts` (the only plant); `tournaments-schema`, `tournaments-money`, `tournaments-play` suites; `tournament-rounds.test.ts` (parity) |
| DB-B | staged file 2; `tournaments-lifecycle`, `lock-order-tournaments` suites; `send-push/{index,guestStrings}.ts`, `_shared/guest-push.json`, `send-push-guest.test.ts`, `outbox-kinds.test.ts` (S12); db-fixtures helpers |
| Engine | `prng`, `americano`, `mexicano`, `regenerate`, `standings` + tests; their `index.ts` lines |
| W-OP / W-MOB / W-WEB | plan §5; also `eventBlock.ts` / `CourtBlock.tsx` (W-OP) and staff `protocols/logic.ts` (W-MOB) |

## 3. Known limits

- Entry money is not in "revenue" until M7.1 (S6).
- No refund cap on tournament tabs (S7, N2).
- `close_branch` does not count open tournaments (0280:706-711).
- No court move or extend after publish (the guard trigger).
- Mexicano rounds played under standings that were later corrected stay as history.
- Event blocks keep their English `notes`; the desk overlay names the tournament in its locale.
- `docs/design/open-matches/db.md:95` wrongly says event blocks take no `lock_court` (0174:697-699
  does); fix it in the paperwork.
