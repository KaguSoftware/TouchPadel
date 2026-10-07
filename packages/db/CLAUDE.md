# packages/db — rules for every change

Schema, RPCs, edge functions and the gates that guard them. Written 2026-09-20 (Phase 2, Milestone 0
item 12) from `PHASE-2-PLAN.md` Part A5 plus the 09-20 code verification; where this file and an
older doc disagree, this file wins. `NNNN` means `supabase/migrations/2026…NNNN_*.sql`; `NNNN:line`
is a line in that file.

## Commits

- No AI co-author trailer of any kind (`Co-Authored-By: Claude …`, Copilot, …). If a harness appends
  one, strip it. Root `CLAUDE.md`.
- Commit and push only when Parsa says "commit" or "push". Never run `git add`, `commit`, `stash`,
  `checkout`, `reset` or `clean` on your own.
- One commit carries the migration, the regenerated `src/types.gen.ts` (CI diffs it:
  `.github/workflows/ci.yml:337-338`), both i18n catalogs (`packages/i18n/src/catalogs/{en,ar}.ts`,
  or a `ws/<lane>.en.ts` + `.ar.ts` pair) and every gate fixture the change touches.

## Migrations

- Ordinal strictly greater than the current max, never a reused one. Latest is `0312`
  (`20261007000312_assistant_models_5_5.sql`, the assistant on Claude Opus 5.5 and Sonnet 5.5 only,
  first committed as a second 0307 and renumbered before it reached hosted; 0307–0311 the second review of loyalty and
  tournaments: 0307 identity hardening, 0308 loyalty earn and redeem, 0309 loyalty promotions and
  the nightly, 0310 tournament money and lifecycle (with the `tabs_tournament_entry_idx` index
  first planned as 0312), 0311 tournament play fixes; 0303–0306 loyalty, Phase 2 milestone 3:
  account identity, unique phone, loyalty, loyalty promotions; 0302 avatar and birth date;
  0299–0301 tournaments, Phase 2 milestone 7: schema and
  money, lifecycle, play; 0290–0298 the coaching review fixes; 0273–0289 coaching, Phase 2 milestone 5: lesson
  kind, lesson push kinds, settings, tables, reservation guards, lesson money, coach admin,
  booking, Qi lessons, price-protocol lesson kinds, sweep, statements, reports, account deletion —
  written as 0270–0286 and renumbered +3 at the merge because the wages migrations took 0270–0272,
  so `docs/design/coaching/` still says 0270–0286; 0270–0272 wages: staff_wages, wage_payments,
  staff_attendance, their RPCs, and owner-only deduction approval; 0266–0269 hosted drift, deposit
  match, hold sweep split, principal lock caps; 0253–0265 open matches; 0252 the hold ladder (lapsed holds → waits, suspension, day-close review), written as 0249 on the kemal branch and renumbered at the merge because 0249–0251 were already on hosted; 0249–0251 staff page scopes, batch sizes, floor orders; 0248 the owner's offline-mode switch, off by default; 0247 degraded mode only while a day is open; 0243–0246 Touch Shop as its own desk; 0241–0242 online
  deposits; 0240 the scanned-paper audit fixes; 0236–0239 scanned paper, Milestone 4b; 0228–0235 the multi-venue audit fixes; multi-venue slice 1 = 0122–0139, assistant 0140–0142,
  Touch Shop 0143–0146, then 0147 drop-reservation-players, 0148 customer-directory,
  0149 assistant-cap, 0150 move-not-into-past, 0151 out-of-stock-alert, 0152 my-reservations,
  0153 terms-consent, 0154 analytics-returning-guest, 0155–0157 six new staff roles, 0158–0206
  protocols and the staff phone (change-order line 10), 0207–0227 multi-venue slices 2–4); the next is
  `0313`. **Check the directory, not this line** — it said 0146 while 0147–0149 were already on
  disk, and later 0150 while 0154 was, and a reused ordinal fails `check-migrations.mjs` after the
  file is written.
- `0069` and `0071` are already doubled; `0023`, `0040` and `0101` have no file, so leave the gaps.
  `scripts/check-migrations.mjs` enforces both rules (`migration-duplicate-ordinal`,
  `migration-ordinal-not-max`).
- Open every file with `set lock_timeout = '3s'; set statement_timeout = '60s';`
  (`check-migrations.mjs:247-248,467-483`).
- `add constraint … NOT VALID`, then a separate `VALIDATE CONSTRAINT` inside an idempotent
  `pg_constraint` guard that tests `conname` AND `conrelid = '<table>'::regclass` (`conname` is
  unique per relation, not per database: a same-named constraint elsewhere would skip the add and
  fail the VALIDATE — 0128–0133 were scoped this way after the 09-21 review); a `create index` needs its own migration or
  `MIGRATION-RISK-ACCEPTED: <reason>` in the PR body (`check-migrations.mjs:36,262,282-288`).
- Re-issue a function only from its latest body, verbatim:
  `grep -n "function app.<name>(" supabase/migrations/*.sql | tail -1`. **Both spellings count**:
  a plain `create function` (0049 `apply_discount`, `override_price`, `record_waste`; 0097
  `upsert_court`) is as much "the latest body" as `create or replace function`. Searching for the
  long form only is how 0115 re-issued two RPCs at an arity 0049 had dropped and created stray
  overloads (fixed by 0119). The latest file is often not the obvious one: `is_degraded()` 0137
  and `is_degraded(uuid)` 0139, `set_opening_hours` 0052, `apply_discount` and `override_price`
  0119, `staff_create_reservation` 0147, `cafe_setting_specs` 0105, `set_staff_role` 0157; 0156
  holds `heartbeat`, `verify_manager_pin`, `verify_own_pin`, `consume_pin_grant`, `break_status`,
  `start_break`, `end_break`, `cover_station`, `set_ticket_status` and `set_order_item_ready`
  (copying an older body back brings a five-role guard with it and locks the 0155 roles out).
  0257 (match settings) holds `accept_terms` (0153 is no longer the latest; an older version never
  replaces a newer one on record). 0262 (open matches at the desk) holds `court_fee_remaining`, `compute_tab_totals`,
  `booking_bill`, `booking_bill_states`, `mark_reservation`, `set_customer_flags`,
  `customer_counts`, `customer_record`, `customer_search` and `customer_directory`.
  0263 (the reservation trigger and the match sweep) holds `hold_slot` (0252's hold-ladder body
  plus R22) and `staff_create_reservation`; `release_hold` and `expire_stale_holds` stay 0252's
  (0260's `match_expire_holds` twin settles no strike: the guest's next hold or `tp_hold_sweep` does). 0264 holds `delete_my_account` (0077 is no longer the latest; the
  body scrubs the open-match rows and calls `ticket_refund_deleted` before the audit row, with no
  match lock, R25). 0265 (open-match reports) holds `reports_figures` and `report_courts` (0219 is
  no longer the latest), `panel_headline` (0096) and `unpaid_played_bookings` (0231).
  0270 (wages tables) holds `cafe_setting_specs` (0105 is no longer the latest). 0272 holds
  `propose_deduction`, `decide_deduction`, `cancel_deduction`, `deductions_page` and
  `deductions_month` (0197 is no longer the latest; decide is the owner's alone and takes
  `app.lock_wage` before the row lock). Coaching holds: 0280 `cancel_reservation`,
  `close_branch`, `confirm_booking`, `desk_match_detail`, `desk_open_matches`,
  `expire_stale_holds`, `extend_reservation`, `mark_reservation`, `match_court_free_firm`,
  `match_expire_holds`, `match_quote`, `move_reservation`, `open_tab`, `staff_create_reservation`;
  0281 `cafe_settled_tabs`, `close_day`, `compute_tab_totals`, `day_close_shop`, `ops_overview`,
  `refund`, `settle_tab`, `till_shift_list`, `trg_match_booking_no_cafe`; 0282
  `storage_path_in_use`; 0284 `deposit_apply`, `deposit_attention`, `deposit_refund_apply`,
  `deposit_refund_request`, `deposit_status`, `deposits_due_for_reconcile`; 0285 the six
  price/promo protocol hooks; 0286 `hold_strikes_settle`; 0288 `analytics_courts_summary`,
  `day_close_online`, `panel_headline`, `report_courts`, `report_revenue`, `reports_figures`;
  0289 `delete_my_account` (superseded by 0290). The coaching review fixes (0290 onward):
  0290 `coach_in_hours`, `coaches_admin`, `coach_promote`, `coach_update`, `set_coach_branches`,
  `set_coach_lesson_types`, `set_coach_price`, `set_coach_price_internal`, `coach_hours_write`,
  `coach_time_off_add`, `price_promo_apply_internal` (0285 is no longer the latest) and
  `delete_my_account` (it now locks the account's coach rows, never the coach mutex).
  0291 `coach_book_private`, `coach_cancel_course`, `desk_book_lesson`, `desk_cancel_enrolment`,
  `expire_stale_holds`, `lesson_course_create_internal`, `lesson_create_internal`,
  `lesson_group_create_internal`, `lesson_link_confirm`, `lesson_lock_branch_courts`,
  `lesson_mark_internal`, `lesson_reschedule_internal` and `match_expire_holds` (0280 and 0283 are
  no longer the latest; `match_expire_holds` asserts and restores `app.venue_id`, and every lesson
  body takes its branch's `venues` row FOR KEY SHARE after the courts), plus the new internal
  `lesson_assert_coach_bookable`. 0292 `lesson_enrolment_money`, `enrolment_cancel_internal`,
  `lesson_refunds_due`, `lesson_money_open`, `lesson_money_figures`, `day_close_online`,
  `report_revenue`, `report_lessons`, `ops_overview` and `report_drill` (0281, 0283, 0288 and 0219
  are no longer the latest; `lesson_money_figures` no longer carries `refundsDueDesk*`), plus the
  new internal `lesson_enrolment_may_owe` and the column `lesson_enrolments.kept_until`.
  0293 `coach_statement_void`, `coach_statement_mark_paid`, `report_coach_statements`,
  `coach_statement_detail` (0287 is no longer the latest) and `lesson_blocked_refund_record`, now
  `(uuid, bigint, text, text, text, text)` with a required `p_idempotency_key` (0281's 5-argument
  version is dropped), plus the new internal `looks_like_card` behind the re-added
  `coach_statements_no_card` CHECK; `tp_coach_statements` runs `'0 12 1 * *'` UTC.
  0294 `coach_slots`, `lesson_read_sessions`, `lesson_offer`, `my_lesson`, `desk_lessons`,
  `desk_lesson_detail` (0283 is no longer the latest) and `tournament_feasibility` (0174 is no
  longer the latest), plus the new internal `hold_is_live(reservations)`, the twin of the
  `expire_stale_holds` / `match_expire_holds` WHERE: whoever changes that pair changes it too.
  0295 `lesson_payment_prepare`, `lesson_settle_success`, `lesson_hold_expire`,
  `deposits_due_for_reconcile` (0284 is no longer the latest), `hold_strikes_settle` and
  `lesson_sweep` (0286 is no longer the latest), plus the new internal `lesson_refund_net()`, the R28
  net the reconciler and the sweep both run; `deposit_settle_success` stays 0258's.
  0296 `trg_lesson_events_notify` (0283 is no longer the latest), and the two push helpers with new
  signatures: `lesson_read_push_guest(uuid, text, uuid, text)` (a `p_suffix` on the dedupe) and
  `lesson_read_push_coach(uuid, text, jsonb, uuid, text)` (`p_enrolment_id`, then `p_suffix`);
  0283's three-argument versions are dropped. `lesson_notify` stays 0283's.
  0297 re-creates no function: it deletes the coaching money columns (`price_iqd`,
  `court_share_iqd`, `coach_share_bp` on `lessons` and `courses`, `venue_settings.coach_share_bp`)
  from `app.assistant_readable_columns` (DB-45, C-28 as amended by D1; `coaching-schema.test.ts`
  fails if one comes back) and grants `venue_settings` by column (DB-46).
  0298 `storage_path_in_use` (0282 is no longer the latest; it answers the service role too, for
  `protocol-action`'s coach photo purge, EC-01) and `protocol_tick_nudge` (0240 is no longer the
  latest; a queued `coach_photo_purges` row is due work).
  Tournaments (0299–0301): 0299 `compute_tab_totals` and `cafe_settled_tabs` (0281 is no longer
  the latest; a kind `tournament` tab adds `tournament_fee_remaining` to `total_iqd` only, and is
  never café money); 0300 `block_courts_for_event` (0174 is no longer the latest: branches in
  scope, active courts, `DEGRADED_LOCKOUT`, the combined R22 check with `match_waiting`
  conflicts), plus the `reservations_tournament_guard` trigger, which refuses a status, court,
  time or kind change of a published tournament's event block (`TOURNAMENT_VIA_EVENTS`) instead
  of re-issuing cancel, move, mark or extend.
  0302 holds `protocol_tick_nudge` (0298 is no longer the latest; a due avatar purge is due work).
  Loyalty (0303–0306, milestone 3): 0303 `merge_accounts`, `profile_activity` and the
  `trg_append_only_but_merge` trigger (its other bodies are 0307's); 0305 every loyalty body
  0308/0309 did not re-issue (`loyalty_admin`, `loyalty_card_ensure`, `loyalty_history`,
  `loyalty_me`, `loyalty_public`, `loyalty_retier`, `loyalty_till_terms`, `loyalty_totp`,
  `loyalty_unredeem`, `my_member_card`, `rotate_member_card`, `upsert_loyalty_reward`,
  `trg_loyalty_account_apply`, `trg_loyalty_ledger_immutable` and the small helpers); 0306
  `delete_my_account` (0290 is no longer the latest: it also deletes the account's
  `loyalty_cards` row, the TOTP secret, and `tests/delete-my-account-latest.test.ts` fails
  when the newest body stops doing so).
  Identity (0307, the review of 0303): holds `trg_profile_phone_key`, `profile_merge_columns`,
  `merge_profiles_internal`, `duplicate_groups_internal`, `duplicate_account_groups`, `merge_duplicates_internal`,
  `handle_new_user`, `handle_user_phone_confirmed` (now trigger `on_auth_user_phone_changed`),
  `find_customer_by_phone` and `desk_register_customer` (0303 and 0065 are no longer the latest),
  plus the internals `phone_verified_owner`, `profile_is_desk_walkin`, `profile_phone_key` and
  `phone_claim_internal`. `profiles.phone_key` is set only for a proven number (the account's
  confirmed auth phone, or the number the desk registered a walk-in with while nobody has signed
  in to it: `profile_is_desk_walkin(profile, key)`) and `zz_phone_key` never raises `PHONE_TAKEN`; the desk pair
  (`find_customer_by_phone`, `desk_register_customer`) sees only a keyed holder, and the owner's
  `duplicate_account_groups` lists the unproven pairs as kind `phone_unproven`. Logins move in a
  merge only on proof (a shared confirmed phone or verified email), never on the owner's word:
  `merge_accounts` on an unproven pair moves data only (`MERGE_REFUSED` detail `keep_no_login`
  when the drop is the only one of the two anybody can sign in to). A failed walk-in claim keeps
  the walk-in findable by its registered number, so the next confirmation retries it.
  Loyalty earn and redeem (0308, the review of 0305/0306): holds `tab_customer`,
  `loyalty_recompute`, `trg_loyalty_earn`, `trg_loyalty_clawback`, `loyalty_token_profile`,
  `my_loyalty`, `link_guest_session`, `loyalty_identify`, `set_tab_customer`, `loyalty_adjust`,
  `loyalty_customer` and `loyalty_redeem`, now `(uuid, int, uuid, text, text)` with
  `p_member_token` last (0305's four-argument version is dropped), plus the internals
  `promotion_tier_ok` (0309's tier test, created here because
  `set_tab_customer` calls it and 0308 runs first; it reads a tier id and the legacy sort),
  `lock_loyalty_attempts`, `lock_loyalty_gifts`, `loyalty_token_match`, `loyalty_token_consume`, `loyalty_token_code`, `loyalty_throttle_check`,
  `loyalty_attempt_record`, `loyalty_history_guest`, `loyalty_tab_paid_at_settle` and the deferred
  triggers `tabs_loyalty_redeem_cap` and `booking_payments_loyalty`. A redemption needs the
  member's token (spent once, `loyalty_cards.last_counter`) or a manager PIN grant not the
  member's own; `loyalty_identify`, `link_guest_session` and the token path of `loyalty_redeem`
  answer a miss as data (`{error}`, `{linked: false}`, `{error, detail}`) so
  `loyalty_token_attempts` keeps it for the throttle (`loyalty_redeem` also releases its
  `rpc_replays` claim, so the press can go on with a PIN under the same key). The per-caller lock
  holds everyone; the per-member-code lock (20 an hour) counts and holds anonymous café sessions
  only, and an attempt keeps `member_code` only when a card holds it, so throwaway sessions
  cannot lock the desk out of a member. Every fallback of `tab_customer` skips active staff, and
  the booking guest's fallback is the booking's first tab only. `loyalty_adjust` holds a manager
  to 1,000 gifted points in a rolling 24 hours (given, or received by the profile) and queues a
  `loyalty_gift` staff push to the owners, so 0308 also holds `notify_staff` (0261 is no longer
  the latest). c44 (a column grant hiding `tabs.customer_id` from guest sessions) is deferred:
  staff and guest sessions are both `authenticated`, so the till's own `tabs` read must move to an
  RPC first. Every body that moves
  a booking payment to succeeded or refunded now ends its lock sequence in `loyalty_accounts`
  (the deferred trigger, at commit). A throttled lookup takes `app.lock_loyalty_attempts`
  (caller, then member code) before its count, and `loyalty_adjust` takes
  `app.lock_loyalty_gifts` (manager, then profile) before its 24-hour sums; an expired member
  token is answered but never counted toward the throttle.
  Loyalty promotions and the nightly (0309, the review of 0306): holds `apply_best_promotion`,
  `eligible_promotions`, `loyalty_nightly` (0306 is no longer the latest),
  `price_promo_promotion`, `upsert_promotion_internal` (0177 is no longer the latest),
  `set_loyalty_settings`, `upsert_loyalty_tier` and `delete_loyalty_tier` (0305 is no longer
  the latest), plus `loyalty_nightly_one`, the procedure `loyalty_nightly_run` (cron
  `tp_loyalty_nightly` CALLs it), `loyalty_tiers_renumber` and `promotion_room_iqd`.
  `promotions.limits.tierMin` is a `loyalty_tiers` id (a string), never a sort.
  Tournament money and lifecycle (0310, the review of 0299–0300): holds `close_branch` (0280 is
  no longer the latest), `refund` (0281 is no longer the latest; a tournament tab's refund is
  held to refund_due unless the reason is `tournament_goodwill`), `desk_tournaments`,
  `tournament_add_entry`, `tournament_cancel`, `tournament_register`,
  `tournament_release_blocks`, `tournament_sweep` (0300 is no longer the latest) and
  `tournament_entry_money` (0299), plus the new `tournament_close`, `tournament_finish`,
  `tournament_close_internal`, `tournament_refund_candidates` and `tournament_refunds_due`.
  Tournament play (0311): holds `desk_tournament_detail` and `tournament_set_rounds` (0310 is
  no longer the latest), `tournament_mark_no_show`, `tournament_public`, `tournament_score`
  and `tournament_standings` (0301 is no longer the latest).
- Signature change: `drop function` by exact signature, recreate, re-issue
  `revoke … from public, anon` and `grant execute … to authenticated`. The registry gate replays
  GRANT/REVOKE/DROP in file order (`scripts/check-rpc-registry.mjs`), so a missing re-grant shows
  up there — and it forgets a name's grants on ANY drop, so re-grant even when the new signature
  already existed.
- No accidental overloads: the same gate replays every `create [or replace] function app.X(...)`
  and `drop function app.X(...)` (`scripts/lib/fn-signatures.mjs`) and fails when a name ends with
  two signatures unless `fixtures/rpc-overloads.json` says so (`business_date`, `is_degraded`,
  `llm_record_usage`, `venue_mode` since 0137). `tests/rpc-overloads.test.ts` proves
  the same list against `pg_proc` when Docker is up.
- Enum widening (`alter type … add value`) is its own migration file, landing strictly before the
  file that uses the value. Precedents: 0143 (`ingredient_kind` `retail`, first used by 0144) and
  0155 (six `staff_role` values, first used by 0156).
- New push kind: `notification_outbox.kind` is a closed CHECK (`0024:22`, re-issued by
  `0075:36-58`, `0274` added `lesson_update`, `lesson_reminder`, `coach_update`; latest `0299`, which added
  `tournament_update`, whose two keys are `app.tournament_notify`'s `c_keys`);
  widen it by migration and add EN/AR copy: a booking kind to
  `STRINGS` in `supabase/functions/send-push/index.ts:48`; a staff kind to `staffStrings.ts` and
  `_shared/staff-push.json`; the guest kinds of open matches take their copy from
  `send-push/guestStrings.ts` and `_shared/guest-push.json`, not `STRINGS`.
  `tests/outbox-kinds.test.ts` holds the CHECK to the three lists. A new staff title key also
  joins `app.notify_staff`'s `c_title_keys` (latest `0308`, which appended `loyalty_gift` after
  0261's `match_report_new`) in
  the same commit, and a guest title key `app.match_notify`'s `c_keys` (`0261`) or, for a
  lesson or coach key, `app.lesson_notify`'s `c_keys` (`0283`; every lesson push is queued by the
  `lesson_events_notify` trigger except the two statement keys); the stack tests
  (`staff-push.test.ts`, `guest-push.test.ts`, `lesson-push.test.ts`) compare each with its JSON.
- `send-push` deploys before the migration: `.github/workflows/deploy.yml` (started by a green CI
  run on `main`, or `workflow_dispatch`) deploys `send-push`, then pushes the migrations, then
  deploys every other function. An unknown kind is terminal in send-push
  (`send-push/index.ts:173`).
- Migrations reach hosted (`deploy.yml`) before any client build that calls them. Never accept
  `migration repair --status reverted`.
- Every edge function's `verify_jwt` is fixed in `fixtures/verify-jwt.json`; `check:verify-jwt`
  holds `config.toml` to it (in `pnpm security`) and `deploy.yml` holds the hosted project to it.
  A new function needs its entry and its `[functions.<name>]` block in the same commit.

## Tables

- Money is integer IQD through the `iqd` / `iqd_signed` domains (`0002:26-27`); guest-visible text
  is `_en` + `_ar`, both `NOT NULL` (`CONTRIBUTING.md`).
- `enable row level security` on every new table (by hand for schema `app`); select-only policies;
  guest-writable text gets a sanitiser trigger (`app.safe_line`, 0080) and a length CHECK.
- A function named in a CHECK constraint, a generated column or a non-definer trigger runs as the
  WRITING role, so grant it to every role that writes the table: anon, authenticated AND
  service_role (edge functions, seeds, tests). 0116 granted `app.phone_digits` to the two client
  roles only and every service-role UPDATE on `profiles` failed until 0121.
- Append rules for the table to `tests/rls-matrix.ts` (data only; `tests/rls-matrix.test.ts` runs it
  against 8 principals). Never restructure that file.
- A table that holds guest data is declared in `GUEST_DATA` (`tests/stored-fields.test.ts:86`,
  SEC-20); the test fails on an undeclared table and prints the store data-safety form from the
  declaration.
- SEC-28 (`scripts/check-broadcast-payloads.mjs`) and SEC-29 (`scripts/check-analytics-payload.mjs`)
  each carry a `FORBIDDEN` list; extend it when a new column can reach a broadcast or analytics
  payload.
- Every new table, view, granted RPC, route, edge function, cron job and doc needs an entry in
  `fixtures/assistant-coverage.json`; `check:assistant-coverage` re-derives the inventory from the
  code and fails on a missing key (`scripts/check-assistant-coverage.mjs`, in `pnpm security`). A
  `table_read` table also gets `app.assistant_readable_columns` rows (`0109:94`).
- **Venues (0122–0138, milestone 1 slice 1).** Every venue-scoped table carries `venue_id`
  (`docs/design/multi-venue/slice-1-2026-09-21.md` has the three lists: scoped, FK-derived,
  global). A new scoped insert either names `venue_id` or relies on the column default,
  `app.current_venue()`, which resolves station → the caller's only `staff_venues` row → the
  single active venue and otherwise raises `VENUE_REQUIRED` — it never guesses. Cron- and
  service-written tables (`audit_log`, `degraded_periods`, `manager_alerts`, `telegram_*`,
  `analytics_*`) default to `app.current_venue_or_default()` instead. A function referenced by a
  column default, an RLS policy or a CHECK runs as the writing or reading role, so it is granted
  to `anon`, `authenticated` AND `service_role` (the 0116→0121 lesson, repeated at 0125). Staff
  read policies carry `venue_id = any(app.staff_venue_ids())`; the owner is global (no
  `staff_venues` rows, sees every active venue). `venues` rows are written by migration only in
  slice 1: a second ACTIVE venue on hosted before slice 3 makes every guest insert raise
  `VENUE_REQUIRED`. A `service_role` insert while two venues are active must pass `venue_id`
  (`tests/multi-venue.test.ts` builds and deactivates its own venue B for that reason). Never
  read `venue_settings` unqualified: it is **one row per venue since 0208** (unique index on
  `venue_id`; the boolean `id` is deprecated, always true and no longer unique). Read the row of
  the branch the court, table, session, order or tab belongs to (`where venue_id = …`).
  `cafe_settings` is keyed `(venue_id, key)` since 0209: pass the branch to
  `app.cafe_setting*(key, venue)` whenever the body knows it. The chain's own settings (currency,
  the LLM budget and price list, the per-guest hold cap) are in the `platform_settings` singleton
  (0207). `promotions.venue_id` is nullable on purpose: NULL means every branch (0212).
  Since slice 3–4 (0215–0227): a body that creates rows for a thing (tab, court, payment, batch…)
  looks up that thing's venue, refuses another branch's caller with `VENUE_MISMATCH` and asserts
  `set_config('app.venue_id', …)` so every default-based insert downstream lands there (0217
  pattern). A staff read policy's venue axis is `venue_id = any((select app.visible_venue_ids())::uuid[])`
  (0226), never `app.staff_venue_ids()`: visibility follows the branch in scope (the operator's
  `x-station-id` / `x-venue-scope` headers, read by `app.resolve_venue`). A report reads
  `venue_id = any(v_rv)` with `v_rv := app.report_venues()` (0219). `venues.status` is
  preparing/open/closed; `is_active` means open (guests), staff see every branch not closed.
  `any((select f())::uuid[])` needs the cast: `any((select f()))` compares against the ROW.
  Since the audit (0228–0235, `docs/design/multi-venue/audit-2026-09-26.md`):
  - `app.resolve_venue` never swaps branches: a station or `app.venue_id` naming a closed branch
    answers NULL, a scope header the caller may not use answers NULL, and staff with no open branch
    (not the owner) answer NULL. The station header outranks `x-venue-scope` in BOTH
    `resolve_venue` and `visible_venue_ids`. `app.is_staff_at` is false for a closed branch, owner
    included. The owner still READS a closed branch (`app.readable_venue_ids`, scope header).
  - **Every branch table and child table carries the `zz_branch_guard` trigger** (0230,
    `app.trg_branch_guard`): a row's links must name rows of its own branch (everyone), and a staff
    writer must be `is_staff_at` the row's branch unless a definer body asserted it
    (`app.venue_id`) or it is their own guest row. A new branch table (or a child of one) gets the
    trigger in the migration that creates it, with its link pairs; a test fixture that writes as
    postgres clears `request.jwt.claims` first (`tests/stores-harness.ts`).
  - A heartbeat never registers or revives a station (0229, decision A1): a machine is registered in
    Settings > Stations (`app.register_station`); a test registers its station with
    `registerTestStation` (`tests/helpers.ts`) before it beats. `DEV1` is seeded.
  - A policy calls `app.is_staff(...)` / `app.staff_role()` inside `(select …)` (0234), like
    `visible_venue_ids`: one evaluation per statement.
- **`venue_settings` is granted to `authenticated` column by column since 0297** (DB-46): the
  table-level SELECT is revoked so `coach_share_bp` and `coach_max_open_private` stay unread
  (managers and the owner read them through `app.coaching_settings`). A new `venue_settings` column
  needs its own `grant select (<column>) on public.venue_settings to authenticated` in the same
  migration, or no client can read it; a column only RPCs should read gets no grant. A client read
  names its columns: `select('*')` on `venue_settings` is refused.
- Guest-readable knobs go on `venue_settings` through the `app.set_venue_details` allowlist (0104,
  per branch with `p_venue_id` since 0208) and `venue_settings_public` (one row per active branch);
  everything else in the `cafe_settings` registry (`app.cafe_setting_specs`, latest 0105). Design
  notes: `docs/design/multi-venue/slice-1-2026-09-21.md`, `slice-2-2026-09-26.md`,
  `slice-3-4-2026-09-26.md`, `audit-2026-09-26.md`.

## RPCs

- `security definer`, `set search_path`, `revoke … from public, anon`,
  `grant execute … to authenticated`; dollar tag `$<name>_0NNN$` (as `$confirm_booking_0092$`); the
  role or venue guard is the first statement.
- A guard that means "any active staff" is `if app.staff_role() is null then raise …` in a function
  and `app.staff_role() is not null` in a policy (the 0072 form), never a list of every role. 0156
  converted the old five-role lists, so a new role needs no re-issue; a guard for a subset (kitchen,
  till, money, stock) still names its roles.
- Errors are `raise exception 'CODE'` (P0001). Every new code gets its line in the one error
  catalogue, `ERROR_CODE_KEYS` in `packages/i18n/src/errors.ts`, EN and AR, in the same commit
  (`check:error-codes` fails otherwise); the operator's `MAPPED_CODES`, the web's `rpcErrorKey` and
  the phone's `mapErrorToKey` all resolve through it, with per-app wording only as overrides
  (`WEB_OVERRIDES`, `MOBILE_OVERRIDES`).
- No WHERE-less write (`scripts/check-safe-update.mjs`). `app.lock_court` (0042) before any
  reservation write. Lock order
  `day_sessions → match_money_advisory → coach_advisory → tournaments → tournament_entries → tabs → promotions → loyalty_attempts_advisory → orders → order_items → tickets → payments → till_shifts → refunds → stock_batches → court_advisory → venues → reservations → match_venue_advisory → match_tickets → loyalty_gift_advisory → loyalty_accounts`
  (`coach_advisory` since coaching, `app.lock_coach`, once per sequence; a `FOR UPDATE … SKIP
  LOCKED` on reservations never waits and is not ranked, like `pg_try_advisory_xact_lock`;
  `venues` since 0291: a lesson body's branch row FOR KEY SHARE, once per sequence, the one share
  lock the walker ranks (with tournaments since 0310), against `open_branch`/`close_branch`'s FOR UPDATE; `tournaments`
  then `tournament_entries` since 0310, the tournament row FOR UPDATE or FOR SHARE (share-ranked)
  before its entries in id order, and a `FOR UPDATE SKIP LOCKED` tournament (the sweep) not
  emitted, like a skip-locked reservation; `promotions` since 0309, the candidates in id order
  under the tab; the loyalty advisory keys since 0308, `app.lock_loyalty_attempts` and
  `app.lock_loyalty_gifts`, each once per sequence)
  (`scripts/check-lock-order.mjs`, walker in `scripts/lib/lock-order.mjs`; `till_shifts` since
  wave 5, whose stamp trigger takes the open shift FOR SHARE on every payment and refund insert;
  the three open-match ranks since 0260: `app.lock_match_money`, the branch mutex
  `app.lock_match_venue`, and `match_tickets` rows in id order, each advisory key counted once per
  sequence, and the service-role paths of `docs/design/open-matches/db.md` §2.6 walked too).
- Every insert or kind/status/court/time update of a booking or maintenance row fires
  `reservations_match` (0263): a match's own booking cascades to the match (cancel, complete,
  move; a booking-level no-show is `MATCH_MARK_SEATS`, so a body that ends a match with its
  booking ends the match first), and a newly firm row bumps the branch's filling and waiting
  matches it leaves with no firm-free court (try-lock only; the sweep `tp_match_sweep`, every
  30 s, is the backstop). The walker expands it under every reservations writer. A hold or desk
  create on a court a waiting match still needs is `SLOT_TAKEN` detail `match_waiting` (R22),
  except while the branch is degraded inside the protected horizon (the sweep does not book the
  match there, so the desk may take the court and the new row bumps it).
- A non-idempotent money write takes `p_idempotency_key` and calls `app.claim_replay` (0049).
- Open-match seat money (0262) is derived by `app.match_money`, never stored; every writer that
  changes what a seat owes takes `app.lock_match_money` first. A match booking's tab carries court
  money only: `orders` and `tab_adjustments` refuse a row on it (`MATCH_BOOKING_NO_CAFE`, R20). The
  desk's open-match RPCs treat a sandbox match, or one outside `app.visible_venue_ids()`, as not
  found, and take `p_reason` as `<code>` or `<code>: <note>` (R42).
- Ticket money reaches a report only through `app.ticket_money_figures` (0265, MD-16: sales,
  refunds and the liability chain-wide, forfeits, restores and cash-outs by branch); ticket and
  deposit money never enters `revenue`, `cash` or `card`, and a sandbox row adds 0 to every figure.
- Registry: every granted function is covered in `tests/rls-matrix.ts` or listed `publicByDesign` in
  `fixtures/rpc-allowlist.json` with a reason of at least 10 characters
  (`check-rpc-registry.mjs:94-95`). The floor in `fixtures/rpc-coverage-floor.json` (164/167 on
  2026-09-20) only rises, via `--update-floor`.
- `scripts/check-rpc-authz.mjs` reads `fixtures/rpc-allowlist.json` (one list, since Milestone 0
  item 10); it needs a running stack, so it runs in the CI db job after `supabase start` and must
  NOT join `pnpm security`, which runs stackless.

## Offline mutation contract

- A queued mutation type lives in six code copies, appended in the SAME order in each (the shell's
  test compares arrays): `packages/core/src/schemas/mutations.ts` (`MUTATION_TYPES` + payload
  schema + envelope variant), `apps/operator/src/lib/mutate.ts` (`DIRECT_RPC`),
  `supabase/functions/replay/index.ts` (`MUTATION_RPCS`),
  `apps/operator-shell/src/main/ipc-validate.ts` (`MUTATION_TYPES`),
  `apps/operator/src/lib/queueResults.ts` (`RESULT_INVALIDATIONS`) and
  `apps/operator/src/features/admin/dayCloseLogic.ts` (`QUEUE_WRITE_KEY`).
- The one list is `supabase/functions/_shared/mutation-types.json`: replay asserts against it at
  boot and `apps/operator/src/lib/mutate.test.ts` compares `DIRECT_RPC`. Since 0120 the queued
  types are `order.create`, `order.add_items`, `ticket.status`, `payment.record`,
  `reservation.create`, `reservation.update`, `waiter_call.action`, `stock.waste`, `tab.open`,
  `tab.settle`, `adjustment.apply`, `tab.cancel`, `tab.settle_zero`, `payment.refund`,
  `order_item.void`; `merge_tabs`, `record_drawer_open`, `open_day`, `close_day` stay online-only
  by decision (scope ledger row in `HANDOFF.md`). A state-idempotent RPC (`set_ticket_status`,
  `void_after_send`) takes no key; every other money write takes `p_idempotency_key` +
  `app.claim_replay`.
- `PIN_GATED_RPCS` (three copies: `packages/core/src/schemas/mutations.ts`,
  `_shared/mutation-types.json` `pinGatedRpcs`, `tests/helpers.ts`) gained `match_seat_write_off`
  in 0262 (online only, never queued).
- Payloads never carry a price (`mutations.ts:13-14`). Secrets that must not persist (a manager
  `pin`) are stripped by `redactSecrets` (`_shared/redact.ts`) before any record or echo; a new
  secret field is added there, not handled ad hoc.
- Retryable Postgres errors (40001, 55P03, 57014, 53300, 53400) map to 503 `RETRY_LATER` and are
  never recorded as conflicts (`_shared/http.ts:71-84`; `tests/replay-transport.test.ts`).

## Edge functions

- Staff-only functions call `requireStaffRole` (`_shared/auth.ts:23`); service writes use
  `createServiceClient` (`_shared/supabase.ts:16`). Deno cannot import `packages/core`: shared data
  is JSON under `_shared/` or a byte-identical copy checked by a test
  (`tests/assistant-catalog.test.ts:56` for `assistant/tools.ts`).
- Every handler goes through `_shared/http.ts` (2026-10-01): `Deno.serve(handle(name, …))`,
  `readJsonBody` with a byte cap, `fetchWithTimeout` for every outbound call, `errorResponse` /
  `pgErrorBody` / `logError` so a caller never sees raw database, vendor or exception text (keep
  the `error` code and status), `isUuid`, `constantTimeEqual`; the caller-JWT client is
  `callerClient` (`_shared/supabase.ts`). A write whose failure means a duplicate side effect
  (an outbox `sent` stamp) logs loudly with the row id. CI type-checks every entry
  (`ci.yml` job `edge-functions`); locally, from this package:
  `DENO_NO_PACKAGE_JSON=1 npx --yes deno@2.5.6 check --no-config --node-modules-dir=none supabase/functions/*/index.ts`.
- LLM code uses `npm:@anthropic-ai/sdk`, model `claude-opus-5-5` unless Parsa names another (the
  assistant: `claude-opus-5-5` or `claude-sonnet-5-5` only, 0307 CHECKs + `ASSISTANT_MODELS`), meters
  spend through `app.llm_record_usage` (0079, 0111), puts no guest identity in a prompt (SEC-29) and
  never computes a number the page did not already have.
- **Scanned paper (0236–0239) is the exception on the model:** `receipt-scan` reads supplier
  receipts and waiters' order slips through ONE vendor-free adapter,
  `_shared/receipts/connect.ts`, the only file that may name a vendor, its key or its host
  (`tests/receipt-scan.test.ts` enforces it). `RECEIPT_READER=fake` is the stand-in for local, CI
  and e2e. The model never writes stock or an order: a person confirms (`confirm_receipt`,
  `send_order_slip`).
  Since 0240 a reading holds a lease (`reading_token`, passed back to `*_store_reading` /
  `*_fail_reading`), `app.scan_sweep_stale` ends one older than three minutes (cron
  `tp_scan_sweep`), and `scan_reads` caps readings (3 per paper, 100 a day per person below
  MGMT). `RECEIPT_READER=fake` is refused unless `SUPABASE_URL` is a local stack or
  `ALLOW_FAKE_READER=1`. Any real reader must pass `tests/receipt-reader-conformance.ts`.
- `scripts/check-error-codes.mjs` (in root `pnpm security`): a code a migration raises is mapped
  by a client, or it is on `fixtures/error-codes-unmapped.json`, which only shrinks.
- Secrets come from `supabase secrets set`, never the repo or `config.toml`. `supabase`, `eas` and
  `expo` run from their package directory, never the repo root.
- **Never run `supabase config push`.** `config.toml` describes the LOCAL stack; hosted auth is
  dashboard-managed (`docs/client/phone-otp-activation.md`). One push on 2026-08-24 overwrote it and
  carried the then-committed test-OTP pair to the client's project
  (`docs/security/security-audit-2026-09-13.md:191`, M8). `[auth.sms.test_otp]` now carries
  `env(SUPABASE_AUTH_SMS_TEST_OTP_CODE)` and never a literal — locally from `packages/db/.env`, in
  CI from the repository variable. Two gates fail the build on a regression:
  `scripts/check-config-env.mjs` (in `db:start` with `--require-values`, static in `pnpm security`
  as `check:config-env`) and `scripts/security/check-no-config-push.mjs` (root
  `pnpm security:config-push`). The hosted store-review account is a different thing entirely:
  `scripts/create-review-account.mjs` provisions a phone-confirmed guest on the hosted project with
  a run-time-generated number and password, printed once and never committed, so the reviewer signs
  in with phone + password and needs no code at all. If a hosted test-OTP pair is still wanted, the
  owner picks a fresh one per review in the dashboard and deletes it after the decision — never a
  value from this repo.

## Verify before you report

- `pnpm --filter @touch/db typecheck`, `lint`, `test`, `check:migrations`, `check:rpc-registry`,
  `check:assistant-coverage`; root `pnpm security` runs the last two. Stack-dependent test files
  `skipIf` when the stack is down; the pure ones (`replay-transport`, `assistant-*`, `insights-*`,
  `telegram-render`) always run.
- Needs Docker (`pnpm db:start` in this package): `db:reset`, `db:types` (regenerates
  `src/types.gen.ts`), `check:locks`, `check:authz`, `check:safeupdate`, `check:invariants`,
  `check:broadcast`, `check:analytics`, and every `tests/*.test.ts` gated on `stackAvailable()`.
  Without Docker, say so; the CI db job (`ci.yml`) is the gate of record.
- Windows, local: `apps/operator-shell` tests need `pnpm --filter @touch/operator-shell native:node`
  first (better-sqlite3 ABI) and `native:electron` after, before any `dist`.
  `tests/sms-provider.test.ts` path failures are local noise.
- After a hosted push: `npx supabase migration list --linked` shows 0 pending; assert `cron.job`
  rows (`tp_match_sweep` since 0263) and `storage.objects` policies exist, because schedules and storage policies are best-effort
  DO blocks (0021, 0031).
