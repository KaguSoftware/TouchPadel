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

- **0416 (2026-11-13, loyalty_card_colors; Majed: the cards are white (the starter card), Touch
  Padel green, Touch Padel blue, then black):** `loyalty_tiers_color` also takes `white`, `green`,
  `blue`; the 0376 metals stay valid but the operator offers only `CARD_LADDER`
  (`@touch/core/loyalty`), plus a tier's own legacy colour. No tier is recoloured and no function
  re-issued. `tests/loyalty-tier-colors.test.ts` ("the club cards (0416)").
- **0415 (2026-11-13, loyalty_reward_vouchers; Majed: the guest redeems a reward in the app and
  gets a QR for that reward that the till scans):** table `loyalty_reward_vouchers` (no client
  grant; fixed single-use code `TPV-` + 12 Crockford base32, lives 15 minutes, status active |
  used | cancelled | expired). Guest RPCs `redeem_reward` (points leave at once, held by the
  voucher; five active at most), `cancel_reward_voucher`, `my_reward_vouchers` (active + ended in
  the last 30 minutes, expires the caller's late ones). Till RPC `use_reward_voucher(p_tab_id,
  p_code, key)`: the code is the proof (no member card, PIN or customer on the tab; a screenshot
  works by Majed's call), then the reward exactly as `loyalty_redeem` gives it (item, court_hour,
  iqd_off: that body is copied, not called, so change both). Points: redeem `(reward,
  reward_voucher, id)`; cancel/expiry `(redeem_void, reward_voucher, id)`; use hands over with
  `(redeem_void, reward_voucher, id)` + the bill's own `(reward, tab_adjustment |
  reservation_reward, id)`, so Undo, the settle cap and the booking-cancel refund work unchanged
  and pay the voucher's member. One `redeem_void` per voucher (`loyalty_ledger_once`) means
  never both used and refunded. `loyalty_history_guest` hides the hand-over pair. Cron
  `tp_reward_voucher_sweep` every minute (expires_at + 1 minute of grace). Lock rank
  `loyalty_reward_vouchers` before `loyalty_gift_advisory`. Tests: `tests/loyalty.test.ts`
  ("loyalty reward vouchers (0415)").
- **0414 (2026-11-13, phone_sign_up_status; Majed: Create account must say "this number already
  has an account" before a code is paid for):** the anon `phone_sign_up_status(p_phone)` answers
  `taken` (an `auth.users.phone` match whose profile has a phone, a name and a gender and no
  `deleted_at`: the phone's `needsProfileCompletion` three), `free` (nobody, or an unfinished
  sign-up) or `unknown` (unreadable, or throttled); `00…` reads as `+…`; never raises. Throttle:
  table `app.phone_sign_up_lookups` (md5 of `cf-connecting-ip`, or `none`; rows live an hour; no
  client grant, no index), 20 a caller per 10 minutes, 300 shared without the header.
  `x-forwarded-for` / `x-real-ip` are deliberately ignored: a caller can forge them. The local
  stack sends no `cf-connecting-ip`, so locally every call shares the 300 bucket. Publicly callable by
  design (`rpc-allowlist.json`); `tests/phone-sign-up-status.test.ts`.
- **0412–0413 (2026-11-13, legacy_cafe_history; Majed: the old till's sales in analytics, and the
  assistant must see them):** tables `legacy_cafe_hours` (per calendar day and clock hour of the
  old Morabaa till, 2 June to 31 October 2026: the items reports' lines, units, money and tickets,
  and the orders reports' orders, money, discounts and money received, NULL on a day no orders
  report covers), `legacy_cafe_item_days` (day, product name, unit price: units) and
  `legacy_cafe_products` (OUR grouping and the owner's stated cost per product and price), owner
  read only, no client write, `zz_branch_guard`, all in `app.assistant_readable_columns`; the
  `security_invoker` view `legacy_cafe_days` (one figure per day: the larger gross of the two
  reports, net = received + the items money the orders report lacks, NULL discounts where
  unknown). The internal `app.legacy_cafe_totals(p_venues, p_from, p_to)` and
  `app.legacy_cafe_add_to_figures(p_fig, p_lc)` are the café's twins of the padel helpers, day by
  day (a range may cut a month). **0412 holds `analytics_daily_sales`** (0346 no longer: an
  old-till day is a row, its money in revenue_iqd / cafe_gross_iqd / cafe_net_iqd / goods_iqd, its
  orders in tabs_settled / orders / visits / till_orders, plus `old_till_iqd` and
  `old_till_discount_known`; cash, card, refunds and waste get nothing), **`analytics_hourly`**
  (0095 no longer) **and `panel_headline`** (0349 no longer: cafeRevenue, cafeNet, revenue, orders,
  discounts and a recomputed avgOrderValue include the old till, `history.period.cafe` /
  `history.comparison.cafe` say how much). `reports_figures`, `legacy_report_totals` and
  `legacy_add_to_figures` are untouched. New owner RPC `analytics_cafe_history(p_from, p_to)`
  (months, groups, products of the old till; product names are the till's, never menu items).
  0413 is GENERATED (`scripts/lib/legacy-cafe.mjs` from `client-data/cafe-pos-2026/history-*.csv`,
  written by `extract.py` from the PDFs) except its first section, which writes the owner's cost
  sheet onto `menu_item_costs` by menu item id AND English name (a no-op on any database whose
  menu differs, never over an existing cost). Because the rows load on EVERY database at venue A,
  a test that reads `analytics_daily_sales`, `analytics_hourly` or `panel_headline` over days up
  to 31 October 2026 sees them: assert the system's own part (subtract `legacy_cafe_days`, as
  `cafe-stock-analytics.test.ts` does) or use later days. `tests/legacy-cafe.test.ts`,
  `tests/legacy-cafe-source.test.ts`.
- **0410 (2026-11-12, loyalty_deals_perks; Majed: deals in the app beside the points, and cards
  that give privileges, not only extra points):** a deal is a promotion the owner lists in the app
  (`promotions.in_app`, guest line `app_blurb_en`/`_ar`, written by `set_promotion_app`, owner only;
  `upsert_promotion` and the price and promo protocol are untouched). A guest reads `my_deals` and
  picks one with `pick_deal` (`DEAL_UNAVAILABLE`, `DEAL_LOCKED`, `DEAL_USED`); the pick sits on
  `loyalty_cards` (`deal_promotion_id`, `deal_picked_at`, `deal_uses_before`) for 24 hours or until
  a bill carrying it settles (`app.loyalty_picked_deal`: one pick is one use, counted on settled
  redemptions, never on timestamps). `eligible_promotions` takes a listed promotion the tab's
  customer picked with no code and sorts it first, so the unchanged `apply_best_promotion` applies
  it: a listed promotion that is not automatic and has no code is an "in the app only" deal.
  Table `loyalty_tier_perks` (no client grant): what a tier gives, kind `free_addons`
  (`modifier_group_ids`, empty = every add-on) or `custom` (honoured by hand), written by
  `upsert_loyalty_tier_perk` / `delete_loyalty_tier_perk` (owner). A card holds its tier's
  privileges and those of every tier below (`app.loyalty_tier_floor`). Free add-ons reach a bill
  as LINE discounts (`tab_adjustments.order_item_id` set, `reason_code = 'loyalty_tier_perk'`,
  authorized_by the privilege's maker), planned by `app.loyalty_perks_plan` and written by
  `loyalty_perks_refresh` (desk roles, no PIN, state-idempotent, 0037 guard answered as data),
  which the operator calls whenever a bill with a member changes, like 0342's customer discount;
  no trigger writes them, so a bill nobody opened at a till carries none. A reader that groups
  discounts by `reason_code` must know `loyalty_tier_perk`. `loyalty_tab_benefits` is the till's
  read (tier, privileges, the picked deal, whether a refresh is due). **0410 holds
  `eligible_promotions`** (0382 no longer), **`loyalty_tier_json`, `loyalty_admin`** (0376 no
  longer; the tier answer gains `min_points_12m`, the admin tiers `perks`) and **`my_loyalty`**
  (0403 no longer; it gains `tiers`, the whole ladder with each tier's privileges and listed
  deals). No index is created (the gate refuses a non-concurrent one; both tables are small).
  `tests/loyalty-deals-perks.test.ts`.
- **0406 (2026-11-11, assistant_branch_scope; evaluation 2026-11-11):** the six SECURITY DEFINER
  assistant list tools had no branch predicate (RLS does not apply inside them), so with one
  branch on the rail an answer mixed that branch's report figures with chain-wide rows. Each now
  reads `venue_id = any(app.report_venues())`, the reports' own rule (0219), on its count and its
  rows: **0406 holds `assistant_bookings_list`** (0147 no longer), **`assistant_tabs_list`,
  `assistant_payments_list`, `assistant_break_history`, `assistant_audit_page` and
  `assistant_table_read`** (0109 no longer). `assistant_table_read` adds
  `(venue_id is null or venue_id = any(...))` only for a relation that has a `venue_id` column
  (looked up in `pg_attribute`; NULL stays in because a promotion with NULL is every branch,
  0212); a table without one is read as before. `assistant_count` goes through the same bodies.
  Signatures, STABLE, definer, guards and grants unchanged; no new function;
  `tests/assistant-branch-scope.test.ts` (one rolled-back psql transaction).
- **0405 (2026-11-09, assistant_concurrency; review 2026-11-09):** `assistant_conversations` loses
  its client UPDATE (`revoke update, delete … from authenticated, anon`, policy
  `assistant_conversations_update_owner` dropped: an owner session could rewrite `tokens` or
  `handles` over PostgREST; scopes, range, model and archiving stay on their definer RPCs, every
  other write is the service role); the service-role `app.assistant_conversation_persist(
  p_conversation_id, p_handles, p_usage, p_title default null, p_context default null)`, the end of
  a chat turn in ONE UPDATE on the locked row (each `tokens` counter = stored + this turn's delta,
  so two turns of one chat no longer lose one's spend; handles last-writer-wins; title only while
  empty; context only when given), called by assistant-chat's `_shared/assistant/persist.ts`;
  `assistant_jobs.tick_claimed_until` (an internal lease, not in `assistant_readable_columns`) and
  the service-role `app.assistant_job_claim_tick(p_seconds int default 120)` (1..900,
  INVALID_ARGUMENT; claims the running batch jobs FOR UPDATE SKIP LOCKED, so two overlapping ticks
  never collect one batch twice); `assistant_job_transition` stays 0112's; both functions
  excluded in `fixtures/assistant-coverage.json`; `tests/assistant-concurrency.test.ts`.
- **0380–0386 (2026-11-01, launch findings; tests next to each):** 0380 tax_zero (every
  `tax_groups.rate_bp` is 0, seed too; `tests/tax-zero.test.ts`); 0381 pin_length (**0381 holds
  `set_staff_pin`**: 4–12 digits); 0382 branch_isolation (no broadcast on the literal `kds`,
  `floor`, `courts` topics, the realtime policies admit `<topic>:<venue>` only; **0382 holds
  `rt_ticket`, `rt_order_item_ready`, `rt_waiter_call`, `rt_reservation`, `rt_court_changed`,
  `rt_order_slip`, `order_set_delivery`, `delete_court`, `split_evenly`, `split_by_item`,
  `eligible_promotions`, `staff_requests_page`**; `app.shares_branch_with`, trigger
  `staff_requests_branch_guard`); 0383 second_jobs (`app.my_staff_roles()` replaces
  `staff_role()` where a second job must count; **0383 holds `my_checklists_today`,
  `my_checklist_history`, `checklist_materialize`, `checklist_day_state`, `teachings_for_me`,
  `staff_media_visible`, `log_stock`, `submit_stock_count`, `stock_pick_list`, `stock_today`,
  `staff_stock_view`**; `_shared/auth.ts` counts `extra_roles`); 0384 blocked_areas_enforced
  (`staff.blocked_areas` is a server wall: PostgREST pre-request hook `app.pre_request` +
  the data table `app.access_area_rpcs`, AREA_BLOCKED; a new page's RPCs need rows there);
  0385 setup_checks (`app.setup_expected`, `app.setup_missing()`, `app.setup_check()` hourly
  `tp_setup_check`; **schedule new cron jobs with `app.ensure_cron(name, schedule, command)`,
  which raises SETUP_FAILED, and register other setup with `app.expect_setup`**; the migration
  itself raises when anything expected is missing); 0386 prune_jobs (`app.prune_housekeeping`,
  cron `tp_housekeeping_prune`: `cron.job_run_details` 7 days, `app.rpc_replays` and
  `sync_replays` 90 days).
- **0387–0391 (2026-11-01, launch findings, lane OP-BACK; tests next to each):** 0387
  safe_balance_guard (F-12: **0387 holds `main_cash_record_payment`**, the one writer of the safe
  rows of `mark_wage_paid`, `give_wage_advance` and `coach_statement_mark_paid`: paid from the
  safe, an amount above the balance raises `SAFE_NOT_ENOUGH` hint the balance, under
  `app.lock_main_cash`, and the caller's whole write rolls back; bank is never refused;
  `main_cash_pay` keeps 0343's rule; `tests/main-cash.test.ts`, `tests/coaching-statements.test.ts`);
  0388 report_exports (F-14: **0388 holds `report_drill`**, 0292 no longer: + `totals {count,
  amountIqd, kinds [{key, count, sum}], days {date: {count, sum}}}` over every match, `capped`,
  and each row's business `day` by `analytics_business_day_start_hour` (default 4);
  `tests/report-drill-totals.test.ts`); 0389 shop_products_never_lost (F-36: **0389 holds
  `receive_delivery_internal`**, 0245 no longer: on goods_in, shop (retail) lines bound for
  another store go to the shop store, their own delivery `shop_delivery_id` when mixed, a staff log
  is still refused; triggers `menu_items_shop_no_delete` / `menu_item_variants_shop_no_delete`
  (FORBIDDEN hint shop_product); the client `create_shop_product(p_category_id, p_name_en,
  p_name_ar, p_size_name_en, p_size_name_ar, p_price_iqd, p_sku, p_barcode, p_supplier_id,
  p_pack_cost_iqd, p_low_stock_threshold, p_is_active, p_purchase_line_id, p_idempotency_key)`
  (product + first size in one transaction, key required; with a purchase line, manager or owner,
  it approves a driver's new product: the line becomes its stock item and is booked into the
  shop store; REQUEST_NOT_PENDING, PURCHASE_NOT_FOUND); `tests/shop-new-product.test.ts`);
  0390 closed_days_and_tournament_confirm (F-51: **0390 holds `set_opening_hours`**, 0208 no
  longer: a newly closed date with a booking still to cancel, mark no-show or pay is
  `CLOSED_DAY_HAS_BOOKINGS` detail the count, hint the first date; internal
  `closed_day_unresolved`; client `closed_day_bookings(p_dates date[], p_venue_id uuid default
  null)`; F-40: `tournament_entries.confirmed_at` / `confirmed_by`, the client
  `tournament_confirm_entry(p_entry_id, p_confirmed boolean default true)` (court desk, manager,
  owner; open or closed tournament; registered entry), the trigger `tournament_rounds_confirmed`
  (`TOURNAMENT_UNCONFIRMED` detail the count: no draw while a registered entry is unconfirmed),
  `tournament_entries_confirm` (leaving the list clears it, a no-show substitute is confirmed),
  **0390 holds `desk_tournament_detail`** (0359 no longer: `entries[].confirmed_at`,
  `confirmed_by_name`, `can.confirm`); `tests/closed-day-bookings.test.ts`,
  `tests/tournament-confirm.test.ts`; the tournaments plant confirms its fields); 0391
  protocols_files_cleanup (F-61: **0391 holds `stop_protocol`** (0164 no longer: the owner stops a
  run with no reason, as `decide_step` (still 0361's) lets the owner stop or send back; every
  other decider says why), `staff_media_orphan_purge_due` (0240 no longer) and `protocol_tick_nudge` (0302 no longer): a
  protocol-folder slot nobody claimed in 7 days is purged; client `discard_staff_media(p_paths
  text[])` (own unclaimed slots only); F-64: service-role `venue_files_gc()`, cron
  `tp_venue_files_gc` every 10 minutes, deletes ready rows whose blob is gone and uploads stuck a
  day; `tests/protocol-photos-files-gc.test.ts`).
- **0404 (2026-11-07, shop_only_second_jobs; brooks audit db.md Critical):** a person with
  `shop_staff` as a SECOND job passed the `is_staff('manager','owner','shop_staff')` guard and
  skipped every shop limit, which tested `app.staff_role() = 'shop_staff'` (the main role alone).
  The limit is now `not app.is_staff(<the guard's other roles>)`: manager and owner, plus the
  cashier for `record_waste` (a cashier writes off anywhere); a caller held to the shop defaults to
  the shop store in `start_count` and `record_waste`. **0404 holds `upsert_menu_item`,
  `upsert_variant`** (0246 no longer) **and `receive_delivery`, `start_count`, `record_waste`,
  `finalize_count`, `discard_count`** (0245 no longer); `tests/second-jobs.test.ts` "0404".
- **0403 (2026-11-05, loyalty_rewards_only; Majed: points buy things you take, a free coffee or a
  free court hour, not money off like a wallet):** `loyalty_settings.points_off_enabled` (default
  false; the hosted row turns false): `loyalty_redeem(p_points)` is `POINTS_OFF` while it is off,
  rewards are not; a new reward kind `court_hour` (no amount, no item) frees one hour of the court
  fee of the plain booking the tab belongs to, `app.court_hour_value` (price after the customer
  court discount × 60 / minutes, the whole fee for an hour or less), used whole
  (`REWARD_EXCEEDS_BILL` over `court_fee_remaining`), once per booking (`REWARD_ALREADY_ON_BOOKING`),
  `REWARD_NEEDS_BOOKING` with no booking, `COURT_DISCOUNT_NOT_ALLOWED` for a match, lesson, event or
  unpriced booking; table `reservation_loyalty_rewards` (one row per booking, no client grant,
  `zz_branch_guard`, wiped as booking money), ledger `(reward, reservation_reward, id)`; undo by its
  id through `loyalty_unredeem` until a bill of the booking settles (`COURT_BILL_CLOSED`), and the
  deferred trigger `reservations_loyalty_court_reward` gives the points back once when the booking is
  cancelled or a no-show first; the desk reads `loyalty_court_reward(p_tab_id)`. **0403 holds
  `loyalty_redeem`, `loyalty_unredeem`** (0350 and 0305 no longer), **`court_fee_remaining`,
  `apply_customer_court_discount`, `bill_customer_discount`** (0342 no longer), **`set_loyalty_settings`**
  (0309 no longer), **`loyalty_till_terms`** (0305 no longer), **`my_loyalty`** (0376 no longer) and
  **`profile_merge_columns`** (0368 no longer); lock order adds `court_advisory → reservations` before
  `loyalty_accounts`; `tests/loyalty.test.ts` "loyalty rewards only (0403)".
- **0402 (2026-11-01, sweeps_report; owner: every failure reaches the dev monitoring panel):**
  every `exception when others` handler of the six background bodies 0394 left over now also calls
  `app.monitor('cron', 'error', '<function>_failed', <the warning's text>, <ids + sqlstate>)`
  (0393; never raises), so a caught item, branch or step error is on the Monitoring page and not
  only in a `raise warning`. **0402 holds `match_sweep`** (0263 no longer: per match, DF-20
  refunds, report purge), **`lesson_sweep`** (0295 no longer: per item, refund net, CD-8 purge),
  **`tournament_sweep`** (0310 no longer: cut-off, deleted account, finish, cancel, mark),
  **`checklist_sweep`** (0323 no longer), **`loyalty_nightly_one`** (0376 no longer) and
  **`price_promo_apply_due`** (0177 no longer: the run that did not apply, which had no warning,
  and its put-back). A new catch-all in a cron body reports the same way;
  `tests/sweeps-report.test.ts` counts handlers against `app.monitor` calls in each latest body.
  `app.monitor_scrub_text` masks any run of eight digits, dashes included, so a digit-heavy uuid
  in a message or detail is stored as `[number]`.
- Ordinal strictly greater than the current max, never a reused one. Latest is `0406`
  (0380–0391 and 0402–0406 are at the top of this list; 0392–0401 are in their own headers, and
  0377–0379 have no file). Before them: (0376 loyalty_tier_colors, 2026-10-31 (Ameen: a tier made "from 100 points" never reached a
  gifted account, and the owner picks each tier's card colour): `loyalty_tiers.color` (classic |
  bronze | silver | gold | platinum | black, default classic, `loyalty_tiers_color`; the same keys
  as `TIER_COLORS` in `@touch/core/loyalty`), and points given by hand (kind `adjust`) count toward
  lifetime and the 12-month tier points again (0308's c17 rule undone; the manager's 1,000-a-day cap
  and the owner's push stay); **0376 holds `loyalty_recompute`, `my_loyalty`** (0308 no longer),
  **`upsert_loyalty_tier`, `loyalty_nightly_one`** (0309 no longer), **`loyalty_admin` and
  `loyalty_tier_json`** (0305 no longer); `tests/loyalty-tier-colors.test.ts`;
  0375 checklist_live_lines, 2026-10-31 (written as 0374 and renumbered before the merge, because
  saeed's branch took 0374 for guest_lesson_no_overlap; Ameen: a cashier had nowhere to see the lists they
  filled; a line added to a finished list never reached the person; a list could be saved with no
  lines; the lists read only on a timer): the internal `checklist_sync_run_lines` (the copies open
  now follow a list's lines: a new line is added unticked, an unticked line taken off goes, a ticked
  line stays), **0375 holds `save_checklist`** (0323 no longer: `CHECKLIST_NO_LINES` hint items, the
  sync after an edit, audit `copies_updated`; the legacy `save_checklist_template` stays 0323's), the
  client `my_checklist_history(p_venue_id, p_before_date, p_before_run, p_limit)` (a person's own
  ended lists, keyset paged; no counts across lists) and the private per-branch realtime topic
  `checklists:<venue>` (event `changed`, payload {at}; `app.rt_checklists` statement triggers on
  `checklist_run_items` and `checklist_templates`; policy `touchpadel_rt_checklists`, any active
  staff at the branch; SEC-28 guards it); `tests/checklists.test.ts`;
  0373 tournament_seat_pick, 2026-10-29 (Majed: a tap on an open chair at court 6 seats the guest
  there, not in the first open chair): `tournament_entries.seat_no` (the board chair, backfilled in
  registration order), `app.tournament_seats(t)` (internal: a seat_no keeps its chair, a desk add or
  promotion with none takes the lowest left), `tournament_register(p_tournament_id, p_seat_no int
  default null)` (the one-argument call of older phones still works; TOURNAMENT_SEAT_TAKEN,
  INVALID_ARGUMENT detail p_seat_no; returns seat_no) and `tournament_public` entries[].seat;
  `tests/tournament-seat-pick.test.ts`; **0373 holds `tournament_register` and `tournament_public`**
  (0359 is no longer the latest); the draw does not read seat_no;
  0372 desk_decide_request, 2026-10-26 (Sait: "the staff can accept someone joining them"): the desk
  (court desk, manager, owner) approves or declines a pending join request of an ask-to-join match,
  `desk_decide_request(p_request_id, p_approve)`, with `match_decide`'s rules (approve seats the
  requester on the tickets the request reserved, the fourth carrier books the court; decline releases
  them; approve branch L2 before decline L1) but staff events, no MATCHES_OFF or DEGRADED_LOCKOUT (R10)
  and no idempotency key (the answer is state-idempotent); `tests/matches-lifecycle.test.ts`;
  0371 match_pay_at_desk_when_offline, 2026-10-26 (Sait): `match_pay_at_desk()` is also true while the
  0340 online-payments lock is closed, whatever `match_payment_mode` holds; **0371 holds `match_pay_at_desk`**;
  0370 open_matches_pay_at_desk, 2026-10-25 (Sait: "have the open matches but without the online
  payments"): `platform_settings.match_payment_mode` (`tickets` default | `desk`,
  `platform_settings_match_payment_mode_chk`); in `desk` mode a player's seat carries no ticket
  (`match_seats_kind` now lets an account or friend seat have a NULL `ticket_id`), the desk
  collects the share as it does for a desk seat, and `ticket_pick` hands back one NULL per seat
  and `ticket_lock` counts an all-NULL list as locked, so `match_start`, `match_join`,
  `match_request` and `match_decide` are untouched; **0370 holds `ticket_pick`** (0260 no
  longer), **`ticket_lock`** (0260 no longer), **`match_settings`** (0257 no longer: `+
  match_payment_mode`) **and `set_match_settings`** (0340 no longer: accepts `match_payment_mode`;
  while online payments are paused `matches_enabled = true` is allowed only in `desk` mode and the
  mode cannot go back to `tickets`, `ONLINE_PAYMENTS_PAUSED`); the 0340 lock itself is unchanged
  and still gates online deposits and lessons; the harmless boolean `match_pay_at_desk()` for
  the phone and the operator; `tests/matches-pay-at-desk.test.ts`;
  0369 customer_analytics, 2026-10-24 (Majed: "there is nothing that shows exactly who our
  customers are"): the owner-only `analytics_customers(p_from, p_to)` behind `analytics_guard` —
  the crowd of the analysed branch counted once, how much of it the club knows (`coveragePct`),
  genders / ages / levels / interests with their shares, the claim against the judgment
  (`judged`), `segments` (every group under five guests folded into one `other` row), each
  bucket's two busiest slots and new against returning; **no key is called `gender`** (SEC-29
  forbids one in an analytics payload: the bucket is `who` / `bucket`, the gender is its value);
  the service-role wording helpers `mkt_buckets`, `mkt_bucket_trends`, `mkt_segments`; and
  **0369 holds `marketing_insights`** (0365 no longer: one more section, `people`, as shares,
  about-N counts and trends, with every bucket under ten guests left out); a play is a court
  booking the guest booked or an open-match seat they sat in, and spend is what settled on their
  own tabs and their bookings' tabs; `tests/customer-analytics.test.ts`;
  0368 customer_facts, 2026-10-24 (Majed: "at sign up, the customer is asked their gender, their
  age, their level ... a manager or their performance will judge if that level is actually
  accurate", and interests "without asking them ... by the data that they provide"): `profiles`
  gains `age_band` + `age_band_set_at` (six bands, `profiles_age_band_chk` / `_stamp`) and the
  CONFIRMED level `level_confirmed`, `_at`, `_by` (a FK to profiles), `_role`
  (coach | court_desk | manager | owner) and `level_note` (≤ 120, one block by
  `profiles_level_confirmed_stamp`), all read by a column grant except `_by`; the effective level
  is `app.effective_play_level(confirmed, claimed)`; writers `set_my_age_band` (the guest's own,
  changeable), `staff_set_customer_age_band` and `staff_set_customer_level` (court desk, manager,
  owner — and a coach through `app.coach_self`, which is why the operator's capability is only
  three roles); the measurement `app.level_suggestions` / `level_suggested` (confirmed
  `game_results` of the last 365 days, chain-wide, scored against the opponents' effective levels
  ±0.5 for a win or a loss, nothing under five scored games, never "new") and the client
  `customer_level_reviews` (the disagreements, coach / desk / manager / owner, cap 100); the
  derived `app.customer_interest_tags` (14 closed tags from bookings, seats, lessons,
  tournaments, tabs, loyalty, discounts, results and the hours played; a day-part word needs
  three plays; no tag ever means money); **0368 holds `customer_record`** (0262 no longer: a
  `player` block — the band, the claim, the judgment with its judge's name, the suggestion and
  the tags), **`desk_register_customer`** (0353 no longer: `+ p_age_band, p_play_level`, which
  only fill a hole), **`trg_profile_media_tombstone`** (0334 no longer), **`merge_profiles_internal`**
  (0347 no longer) and **`profile_merge_columns`** (0364 no longer: `profiles.level_confirmed_by`
  repoints); `tests/customer-facts.test.ts`, `tests/customers-plant.ts`;
  0366 branch_counts, 2026-10-22 (Sait: the Branches cards' courts and café tables): the client
  `branch_counts()` (manager or owner; the owner counts every branch, a manager the open or
  preparing branches they work at) returns `[{venue_id, courts, tables}]`, active rows only, so a
  card can count a branch the rail is not on; re-creates no function;
  0365 insights_percentages, 2026-10-22 (Majed: Insights in percentages, "how much up, how much
  down"): **0365 holds `marketing_insights`** (0360 no longer): every trend gains its size,
  `<trend>Pct` (percent change, `app.mkt_change`) or `<trend>Pts` (points a rate moved,
  `app.mkt_points`, both service role only), shares are whole percents, `levelPct` / `fillPct`;
  still no money figure or exact count; `tests/marketing-insights.test.ts`;
  0362 marketing_plan, 2026-10-22 (Majed: marketing proposes the month's content calendar, the
  owner approves it, each idea's result goes for approval): tables `marketing_plans` (one per
  branch and month: draft | waiting | changes | approved) and `marketing_plan_ideas` (proposed |
  approved | dropped | cancelled), both owner-read only; `marketing_content.idea_id`; the client
  `marketing_plan`, `save_plan_idea` (several days in one call), `remove_plan_idea`,
  `send_marketing_plan`, `take_back_marketing_plan` (marketing) and `decide_marketing_plan`
  (owner, note optional per 0361, `p_drop`); **0362 holds `submit_content`** (0199 no longer:
  `+ p_idea_id`, IDEA_LOCKED / IDEA_HAS_RESULT), `notify_staff`'s `plan_submitted`, `plan_approved` and
  `plan_changes` (0363 re-issues it after, so 0363 holds it) and **`set_staff_access` plus `staff_blocked_areas_chk`** (0360
  no longer: the `content` area, /plan and /posts); `tests/marketing-plan.test.ts`;
  0364 ranks_leaderboard, 2026-10-22 (Majed: the players' leaderboard, points for every game,
  the top N public, levels, all set by the owner like loyalty): tables `ranks_settings` (one
  row: points for a win, loss, draw, period all | month | quarter, `board_size`, the two sources,
  `report_hours`), `ranks_levels`, `game_results` (source player | desk | tournament, status
  pending | confirmed | rejected | expired | voided, sides a1/a2 and b1/b2) and the append-only
  `ranks_ledger` (written once per player per confirmed result at that moment's rules, so a rule
  change applies from then on; a void writes the negation), RLS on, no client grant; the
  anon-readable `ranks_board()` (the top `board_size` only, "First L."), the player's
  `my_ranks`, `ranks_find_player`, `ranks_report` (the booker of a played booking, pending until
  side B answers through `ranks_confirm`), the desk's `ranks_desk_record` / `ranks_desk_results`
  (court desk, manager, owner), `ranks_void` / `ranks_admin` (manager, owner) and the owner's
  `set_ranks_settings`, `set_ranks_levels`, `ranks_adjust`; the trigger `tournament_match_ranks`
  (AFTER UPDATE OF points_a, points_b on `tournament_matches`: a score records a confirmed
  tournament result, a correction voids the old one first); **0364 holds
  `profile_merge_columns`** (0347 is no longer the latest: `game_results` a1..b2 and
  `ranks_ledger.profile_id` repoint, with `game_results_merge` skipping a seat that would put
  one person twice on a game, and the ledger's append-only trigger letting the merge's
  re-point through); `tests/ranks-leaderboard.test.ts`;
  0363 protocol_watch, 2026-10-22 (Majed: the owner gets every protocol status update, with an
  on/off setting, and approvals still waiting get a reminder): deferred constraint triggers
  `protocol_run_steps_watch` / `protocol_runs_watch` (`app.trg_protocol_step_watch`,
  `app.trg_protocol_run_watch`) push `step_passed` and `run_live` | `run_scheduled` | `run_done` |
  `run_stopped` | `run_withdrawn` at commit to the owners with `staff_push_prefs.protocol_updates`
  on (no row = on), minus anyone this transaction already told about the run
  (`app.protocol_watch_ids`, outbox `created_at = now()`), so no body is re-issued; the owner-only
  `my_push_prefs` / `set_my_push_prefs` (the phone's Work alerts "Follow every step" switch); the
  service-role `protocol_remind_sweep` (cron `tp_protocol_remind`, every 15 minutes, 09:00–23:00
  branch time) sends `decision_waiting` to the deciders 3 hours after a submission, then daily
  (`protocol_submissions.reminded_at`); **0363 holds `notify_staff`** (0362 is no longer the
  latest: 52 title keys); `tests/protocol-watch.test.ts`;
  0361 owner_declines_without_reason, 2026-10-22 (Majed: the owner never needs a reason to
  reject): **0361 holds `decide_staff_request` (0160 no longer), `decide_content` (0199),
  `decide_deduction` (0272), `decide_recipe_change` (0183), `decide_shopping_item` (0185),
  `decide_step` (0164) and `decline_release_idea` (0172)**; the owner's refusal takes no reason,
  other deciders still say why (`app.is_staff_at(venue, 'owner')`); the reason CHECKs on those
  tables are dropped and `shopping_items_declined_chk` is now `shopping_items_declined_by_chk`;
  0360 marketing_insights, 2026-10-22 (Majed: the marketing role's Insights page, the whole
  place with as few exact numbers as possible): the client `marketing_insights(p_from, p_to,
  p_cmp_from, p_cmp_to)` (marketing and owner) runs the owner's analytics_* reads and returns only
  levels, trends, rounded shares and about-N counts, through the service-role wording helpers
  `mkt_level`, `mkt_trend`, `mkt_rate_trend`, `mkt_about` and `mkt_share`; **0360 holds
  `analytics_guard`** (0034 no longer: it also lets marketing through while the transaction-local
  `app.marketing_read` assertion stands, which only marketing_insights sets and clears) **and
  `set_staff_access` plus `staff_blocked_areas_chk`** (0345 no longer: the `insights` area);
  `tests/marketing-insights.test.ts`;
  0359 tournament_classes, 2026-10-22 (Ameen; written as 0356 and renumbered at the merge, because
  0355–0357 were already taken): `tournaments.classes text[]`, one to three of A, B, C in
  A-B-C order, never null by the validated `tournaments_classes` CHECK, which also ties `class` to
  the first of them (kept for builds before it); the plan takes `classes` or an older desk's
  `class`; `tournament_register` takes a level that fits ANY class; the desk no longer asks
  `play_years` (0339's column and check stay). **0359 holds `protocol_check_tournament_plan`,
  `tournament_publish`, `tournament_register`, `tournaments_public`, `tournament_public` (0339 no
  longer), `desk_tournament_detail` (0311 no longer), `assistant_tournaments_summary` (0328 no
  longer) and `tournament_context` (0174 no longer)**.
  0358 analytics_compare_bases, 2026-10-22 (Ameen; written as 0355 and renumbered at the
  merge): "Compare with" is month | year | `custom:<from>:<to>` (prev | 4w | 52w still valid), one test `app.analytics_compare_basis_ok`
  (service role only) behind the `analytics_insights` CHECK; **0358 holds
  `save_analytics_insights`** (0098 no longer).
  0357 legacy_report_months, 2026-10-21 (Majed: the analytics charts must show the whole picked
  period, nothing missed; written as 0355 and renumbered at the merge, because 0355 and 0356 came
  in from the saeed branch): **0357 holds `app.legacy_report_totals`** (0349 is no longer the latest:
  each `included` report gains its own summary bookings, cancellations, noShows and lessons, null
  where it has none, so Analytics › Courts draws a range holding a report month by month);
  `tests/legacy-reports.test.ts`;
  0356 desk_coach_schedule, 2026-10-21 (Sait: the court desk sees each coach's day): the client
  `desk_coach_schedule(p_venue_id, p_from, p_to)` (security definer, authenticated) behind the
  desk's Coaches tab; booking still goes through `desk_book_lesson`, `desk_create_group` and
  `desk_create_course`; `tests/desk-coach-schedule.test.ts`;
  0355 shop_sale_rewards, 2026-10-21 (Sait: whoever rings up a Touch Shop sale earns a percent of
  what the customer paid, on their wage; café sales earn nothing): the owner-only cafe setting
  `shop_sale_reward_pct` (default 10, 0..50), so **0355 holds `cafe_setting_specs`** (0270 is no
  longer the latest); table `shop_sale_reward_rates` (the percent frozen on a shop tab when it
  settles, by the `tabs_shop_sale_reward` trigger; no client grant) and
  `shop_sale_reward_earnings` (one per person and closed business month, owner read only, LLM
  wall), the internal `shop_reward_lines` (each seller's `cafe_net_lines` net and reward over a
  window, never the owner) and the service-role `shop_reward_sweep` (cron `tp_shop_reward_sweep`,
  every five minutes, 0333's month rules, under `app.lock_wage`, paid in `app.wage_open_month`
  from the month after); **0355 holds `wage_line` and `wages_month`** (0344 is no longer the
  latest: the shop rewards join `bonuses_iqd` and `bonus_count`, are listed in `shop_rewards[]`,
  count for `bonus_only` and bring their person onto the month; `mark_wage_paid` stays 0344's);
  and the client `shop_reward_info()` (shop assistant, manager, owner: the percent, each shop
  size's price, cost and reward, and the caller's own month); `tests/shop-sale-rewards.test.ts`;
  0354 venue_files, 2026-10-20 (Majed: a Files section for the manager and the owner, read by the
  assistant, every file compressed before it touches the database): table `venue_files` (metadata
  only, no client grant), the private `venue-files` bucket (gzip and WebP only, 50 MB an object, a
  2 GB compressed quota per branch), the minted-path flow `venue_file_begin` → upload →
  `venue_file_finish`, `venue_files_list`, `venue_file_update`, `venue_file_delete` (objects
  first, then the row: storage reads an object through its read rule before deleting it), the
  policy helpers `is_venue_file_path` and `venue_file_object_{readable,uploadable,removable}`, an
  owner_only flag the owner alone sets and sees, and the owner assistant's `assistant_files_list` /
  `assistant_file_get` (tools `files_list`, `file_read`; the edge function downloads and gunzips
  the `<id>.txt.gz` text as the owner); **0354 holds `assistant_run_tool`** (0330 is no longer the
  latest); `tests/venue-files.test.ts`;
  0353 court_gender_rules, 2026-10-19 (Majed: some courts are women-only at set times, some hours
  on every court; a gender is a must for every account): table `court_gender_rules` (the operator's
  Gender hours card, rates-shaped: one court or every court, weekdays, a window that runs past
  midnight when its end is at or before its start, optional dates, on/off, gender female | male;
  guests read active rows of open branches), written only by `app.upsert_court_gender_rule`
  (manager or owner, no protocol); the internal `app.slot_gender_rules` (mirrored by
  `@touch/core` `slotGenderRules`); the triggers `reservations_gender_guard` (a booking or hold
  with a guest account on a kept slot: `GENDER_REQUIRED` with no gender, `SLOT_GENDER_RESTRICTED`
  with the other; a typed desk name, a match booking, a lesson pass; status changes never re-judge)
  and `matches_gender_guard` (an open match touching a kept window at its branch, any court, must be
  that gender's category); **0353 holds `desk_register_customer`** (0307 is no longer the latest:
  `+ p_gender` default NULL, stamped `gender_set_by` staff); `tests/court-gender-rules.test.ts`;
  0352 counter_orders, 2026-10-17: order first, the table after. A café tab may open with no table
  and no booking (a counter tab, labelled with the name given or the day's `#<n>`; TAB_ANCHOR_REQUIRED
  is now only `send_order_slip`'s); `orders.deliver_table_id` / `deliver_reservation_id` say where
  ONE order is brought, attached any time after by `app.order_set_delivery` (online only, re-announces
  the ticket on `kds`); **0352 holds `open_tab` and `kitchen_board`** (0280 and 0231 no longer).
  0351 order_service, 2026-10-17: `orders.service` (`deliver` | `pickup`, default `deliver`);
  **0351 holds `till_add_items`** (0244 no longer), now `(uuid, jsonb, text, text, text)` with
  `p_service`, defaulting from the tab (a seat: deliver, none: pickup), carried by the queued
  `order.add_items` payload's optional `service`;
  0350 loyalty_item_rewards, 2026-10-17: an item reward frees one unit of its exact variant on the
  tab as a line discount of that line's unit price, ordering it onto the tab first when no line has
  a unit free (`REWARD_ITEM_NOT_ON_TAB` for the court desk); **0350 holds `loyalty_redeem` and
  `trg_loyalty_redeem_cap`** (0308 is no longer the latest: a reward on a line voided before the
  settle comes back whole); 0349 legacy_reports_in_figures, 2026-10-17: the pre-system padel reports count in panel_headline and
  analytics_courts_summary when the range holds their whole month (helpers app.legacy_report_totals,
  app.legacy_add_to_figures); **0349 now holds the latest panel_headline and analytics_courts_summary**
  (0288 no longer); reports_figures stays 0288's, unchanged;
  0348 legacy_reports_data, 2026-10-17: the four pre-system padel reports inserted by migration,
  generated from client-data/padel-monthly-2026/reports.json, never edited by hand; 0347 discounts_merge;
  0346 shop_analytics, 2026-10-16: Touch Shop sales in the owner's analytics, counted as padel
  revenue (Majed). New owner-only `app.analytics_shop(p_from, p_to)` (analytics_guard, the analysed
  branch: kpis, by_day, by_hour, items, categories; a sale is a settled kind `shop` tab), and **0346
  holds `app.analytics_daily_sales`** (0219 is no longer the latest: café only, shop tabs, their
  lines and orders and the shop store's waste are left out), so a shop sale counts once, as padel,
  in the analytics Venue revenue. The Reports pages and the café item analytics are unchanged
  (`report_revenue` keeps "of which shop" inside café); `tests/shop-analytics.test.ts`;
  0345 staff_access, 2026-10-16: the owner's per-person Access list. `staff.extra_roles`
  (second jobs, front-line roles only, `staff_extra_roles_chk`) and `staff.blocked_areas` (the
  `ACCESS_AREAS` keys of `packages/core/src/staff/access.ts`, `staff_blocked_areas_chk`), both
  set by the owner-only `app.set_staff_access`. **0345 holds `app.is_staff`** (0010 is no longer
  the latest: it now counts a second job) and `app.staff_ids_with_roles` (0160 is no longer the
  latest); `app.staff_role()` still returns the main role alone. Blocks are a screen rule, read by
  no RPC; `tests/staff-access.test.ts`;
  0342–0344 customer discounts, main cash and wage advances, 2026-10-16 (see their headers);
  0341 staff_activity, 2026-10-16: the owner's activity monitor. Table `staff_activity`, one row per
  staff member and app (`operator` | `mobile`), no client grant; `app.staff_activity_ping(p_surface,
  p_state, p_screen, p_app_version)` (any staff, own row, throttled to a write per 20 s unless state
  or screen changed), the `audit_log_staff_activity` AFTER INSERT trigger (stamps the actor's last
  action on the app named by the `x-touch-app` request header, or the operator when only
  `x-station-id` is sent; never raises) and the owner-only `app.staff_activity_board()`; the
  internal `app.request_surface()`. Both clients send `x-touch-app` on every request;
  `tests/staff-activity.test.ts`;
  0342 customer_discounts, 2026-10-16: a customer's standing café and court discount (percent or
  amount), set by any till or desk staff with no PIN. Tables `customer_discounts` (chain-wide, no
  client grant), `reservation_court_discounts` (per booking, `zz_branch_guard`) and
  `customer_discount_waivers` ("not on this bill": p_kind `none` writes it, `standing` or a
  one-off lifts it, a refresh respects it); RPCs
  `customer_discount`, `set_customer_discount`, `apply_customer_discount` (tab rows with
  reason_code `customer_discount` | `customer_discount_once`), `apply_customer_court_discount`,
  `bill_customer_discount`; holds `court_fee_remaining` (0262 is no longer the latest: it also
  subtracts `app.court_fee_discount`); the `profiles_discount_tombstone` trigger drops the row on
  account deletion; `tests/customer-discounts.test.ts`;
  0343 main_cash and 0344 wage_advances, 2026-10-16 (Majed: a main cash, "the safe", beside the
  separate desk and café drawers; costs are paid from it; salary advances): table `main_cash_entries`
  (one ledger: payment from the safe or the bank, hand_in / to_drawer per box cafe|desk|shop,
  owner_in/out, bank_in/out, count; `delta_iqd` is the row's effect, the balance is the live sum; no
  client grant) with `main_cash_overview`, `main_cash_pay`, `main_cash_move`, `main_cash_count`,
  `main_cash_void`, `main_cash_day_boxes` and `main_cash_hand_in_day` (manager and owner; a box is
  `stations.mode`, else the café till); 0344 adds `wage_advances` (owner only, LLM wall) with
  `give_wage_advance` / `undo_wage_advance`, and holds `wage_line`, `wages_month`, `mark_wage_paid`
  (now `+ p_paid_from, p_expected_paid_iqd`; paid = net − advances), `undo_wage_paid` (0271 is no
  longer the latest: it voids the safe row) and `coach_statement_mark_paid` (0293 is no longer the
  latest: `+ p_paid_from`); `tests/main-cash.test.ts`;
  0340 online_payments_paused, 2026-10-13: `platform_settings.online_payments_live` lock, false until Qi is live; holds `set_deposit_settings`, `set_match_settings`, `set_coaching_settings` (0242, 0257, 0277 are no longer the latest: each raises `ONLINE_PAYMENTS_PAUSED` when the patch turns online money or matches on) plus `online_payments_live()`; a test that turns those settings on through the RPCs wraps itself in `setOnlinePaymentsLive` (`tests/helpers.ts`); 0339 tournament_play_years; 0335–0338 coach mode and coach links, 2026-10-11, written as 0334–0337 on the saeed branch and
  renumbered +1 at the merge because main took 0334: 0335 coach_book_students, a coach books a
  private lesson for a past or new student and the other students' phones; 0336
  lesson_friend_phones_read, those phones in the coach's roster and the desk's lesson; 0337
  coach_slugs, the coach's share link names the coach; 0338 the unique index on coaches.slug;
  0334 play_profile_coach_levels, the guest's optional play survey on `profiles`, each coach's
  levels and a tournament's entries before the draw, 2026-10-11; 0333 reward_wages, a reward reached in a closed business month becomes a bonus on the wage and
  the person gets a push when they unlock one, 2026-10-11; 0332 staff_rewards, the owner's per-person order targets and each person's own progress on
  the staff phone, 2026-10-10; 0331 legacy_reports, the pre-system monthly padel reports kept as written, 2026-10-10;
  0330 the assistant's stored-days cache, 2026-10-09; 0324–0329 the owner assistant, 2026-10-08: 0324 web search, 0325 search recall and the frozen
  first turn, 0326 the tsv GIN index, 0327 card views, 0328 tournaments, open matches and loyalty
  tools, 0329 messages and calls written by the service role only; what each holds is below;
  0323 is `20261008000323_checklist_schedules.sql`, scheduled and assigned checklists;
  0322 is `20261008000322_shop_price_watch.sql`, the shop desk's hourly supplier price watch;
  0321 is `20261008000321_coach_statements_live.sql` (holds `report_coach_statements`); 0314–0320 usernames and photo frames, Phase 2 Edit profile: usernames_frames,
  profiles_username_unique, earned_frames, frame_style, frame_grants, username_not_allowed,
  frame_grants_merge — written as 0307–0313 on the saeed branch and renumbered +7 at the merge
  because main took 0307–0313; 0320 re-issues `profile_merge_columns` and
  `merge_profiles_internal` from 0307 identity hardening plus frame_grants and username_holds;
  0313 is `20261007000313_staff_screenshot_report.sql`, a staff member's screenshot is audited and pushed
  to the owners; 0312 is `20261007000312_assistant_models_5_5.sql`, the assistant on Claude Opus 5.5 and Sonnet 5.5 only,
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
  `0407`. **Check the directory, not this line** — it said 0146 while 0147–0149 were already on
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
  and `is_degraded(uuid)` 0248, `set_opening_hours` 0390, `apply_discount` and `override_price`
  0244, `staff_create_reservation` 0280, `cafe_setting_specs` 0355, `set_staff_role` 0157; 0156
  holds `verify_own_pin`, `consume_pin_grant`, `break_status`, `start_break`, `end_break` and
  `cover_station`, and its `heartbeat` (0397 holds it now), `verify_manager_pin` (0231),
  `set_ticket_status` and `set_order_item_ready` (0217) were re-issued since
  (copying an older body back brings a five-role guard with it and locks the 0155 roles out).
  0257 (match settings) holds `accept_terms` (0153 is no longer the latest; an older version never
  replaces a newer one on record). 0262 (open matches at the desk) holds `court_fee_remaining`, `compute_tab_totals`,
  `booking_bill`, `booking_bill_states`, `mark_reservation`, `set_customer_flags`,
  `customer_counts`, `customer_record`, `customer_search` and `customer_directory`.
  0263 (the reservation trigger and the match sweep) held `hold_slot` (0252's hold-ladder body
  plus R22; 0269 principal_lock_caps holds it now) and `staff_create_reservation` (0280 holds it now); `release_hold` and `expire_stale_holds` stay 0252's
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
  0293 `coach_statement_void`, `coach_statement_mark_paid` (0344 holds it now), `report_coach_statements`
  (0321 holds it now), `coach_statement_detail` (0287 is no longer the latest) and `lesson_blocked_refund_record`, now
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
  Staff screenshot report (0313): holds `notify_staff` (0308 is no longer the latest; it gains the
  title key `screenshot_taken`, 40 keys now) plus the new `log_staff_screenshot(p_venue_id, p_route)`,
  any active staff at the branch: one `staff.screenshot` / `screen` / page row through `write_audit`
  (so the desktop Audit log shows it, and `audit_log_page` with the prefix `staff.screenshot` is the
  owner's list on the phone) and a `screenshot_taken` `staff_info` push to the owners naming the
  person only (the page stays off the lock screen), deduped per person and page for 15 minutes. No
  new table.
  Supplier price watch (0322): holds `notify_staff` (0313 is no longer the latest; it gains the
  title key `shop_price_changed`, 41 keys now) plus the table `shop_price_watches` (one row per
  shop size with a supplier page link; read by manager, owner and `shop_staff` of the branch,
  written only by the RPCs; `zz_branch_guard` linked through `menu_item_variants`) and the new
  `set_shop_price_watch(p_variant_id, p_url)` (`SUPPLIER_URL_INVALID` for a link that is not https
  to a public host name) and `record_shop_supplier_price(p_variant_id, p_url, p_price_iqd,
  p_error)`, the shop desk PC's report of one read (stale, error, first, same, changed). A change
  the shop does not already sell at queues a `shop_price_changed` `staff_info` push to the owners
  and the branch's shop assistants naming the product only, never a price. The reading itself runs
  in the operator shell on the shop station, not on the server
  (`docs/design/shop/supplier-price-watch-2026-10-08.md`).
  Scheduled checklists (0323, `docs/design/checklists/scheduled-checklists-2026-10-08.md`): holds
  `my_checklists_today`, `mark_checklist_item`, `checklist_board`, `save_checklist_template`
  (0184 is no longer the latest), `checklist_day_state` (0188), `notify_staff` (0322 is no longer
  the latest; it gains `checklist_due` and `checklist_overdue`, 43 keys now), `create_branch`
  (0233) and `staff_media_visible` (0238), plus the table `checklist_assignees`, the new
  `save_checklist` (0375 holds it now), `archive_checklist`, `checklist_staff_options`, the service-role
  `checklist_sweep` (cron `tp_checklist_sweep`, every five minutes) and the internals
  `checklist_materialize`, `checklist_occurrence`, `checklist_is_scheduled`, `checklist_due_at`,
  `checklist_current`, `checklist_on_leave` and `checklist_member_at`. `(venue, role, slot)` is no
  longer unique: a run is one occurrence (`business_date` = its first day, `period_end`) per list
  and person (`assignee_id`, NULL for a shared list), and the legacy `save_checklist_template`
  writes the oldest live role list under an advisory lock.
  Play profile, coach levels, tournament entries (0334, 2026-10-11): holds `set_my_play_profile`
  (new; the four `play_*` columns are read by a direct own-row select), and is the latest body of
  `tournament_public` (0311 is no longer the latest: it adds `entries` [{player, mine}], registered
  entries in registration order, before and after the draw), `coaching_public`, `coach_profile`
  and `coaches_admin` (each coach gains `levels`; empty means every level), `coach_update` (accepts
  `levels`) and `trg_profile_media_tombstone` (0317 is no longer the latest: it also nulls the play
  columns). Contract: `docs/design/play-coaches/contracts-2026-10-11.md` §4.
  Coach mode and coach links (0335–0338, 2026-10-11): 0335 holds `coach_book_private` (0291 is no
  longer the latest: a saved student's key in place of a phone, and the other students' names and
  phones) plus the new `coach_saved_students`, the column `lesson_enrolments.friend_phones` and its
  scrub trigger; 0336 is the latest body of `desk_lesson_detail` (0294) and re-issued `coach_lesson` (0283; 0401
  coach_student_level holds it now),
  each adding `friend_phones`; 0337 is the latest body of `coaching_public`, `coach_profile`,
  `coaches_admin` and `coach_update` (0334 is no longer the latest: each keeps `levels` and adds
  `slug`; `coach_update` accepts `slug`, COACH_SLUG_TAKEN), plus `coaches.slug`, its trigger,
  `coach_slug_ok`, `coach_slug_free` and the anon `coach_id_for_slug`; 0338 is the
  `coaches_slug_key` unique index.
  Reward wages (0333, 2026-10-11): holds `wage_line`, `wages_month` and `mark_wage_paid` (0271 is
  no longer the latest: a line adds `bonuses_iqd`, `bonus_count` and `bonuses[]`, the
  `staff_reward_earnings` rows whose pay month it is, prize-only ones included; the net is salary -
  deductions - penalties + bonuses, and `wage_payments_net_chk` says so), `my_rewards` (0332 is no
  longer the latest: `last_month.reached[]` gains `pay_month`, built from the frozen earnings once
  the month is closed) and `notify_staff` (0323 is no longer the latest; it gains the title key
  `reward_unlocked`, 44 keys now, and the route `staff-rewards`, 8 routes), plus the tables
  `staff_reward_earnings` (owner read only) and `staff_reward_unlocks` (push bookkeeping, no client
  grant) and the service-role `reward_sweep` (cron `tp_reward_sweep`, every five minutes): the
  unlock push to the person only, no amount, prize, name or id, once per person, target and business
  month; and the earnings of every ended business month not closed yet (oldest first, at most twelve
  back, once the new month's first business day has passed), one per person and target (the reward
  set last, so a removed and re-set target pays once; `staff_reward_earnings_target_month_key`),
  under `app.lock_wage`, paid in `app.wage_open_month` from the month after. `mark_wage_paid` pays a
  month with no salary (status unset or none) for its reward bonus alone; `wage_line` charges no
  salary (`bonus_only`) in a month that only carries a bonus for someone no longer active at the
  branch who placed no order and had no recorded day there in it. `wages_due` and `undo_wage_paid`
  stay 0271's.
  Owner assistant (0324–0329, 2026-10-08): 0324 (web search) holds `assistant_usage` (0207 is
  no longer the latest) plus the service-role `llm_record_web_search`. 0325 (search recall) re-issued
  `assistant_search` (0110 is no longer the latest; 0367 assistant_search_full_window holds it now) plus the new `search_fold` (Arabic and digit
  folding, granted to anon, authenticated and service_role because the generated column runs it)
  and `assistant_tsquery` (an OR of prefix lexemes, stopwords dropped); it rebuilds
  `assistant_chunks.tsv` over the folded text with the title at weight A, and adds
  `assistant_conversations.context` (the chat's frozen first turn, written by the service role
  only: its INSERT grant is by column without it). `hnsw.ef_search` is raised in the body with
  `set_config(..., true)`, never a function SET clause: `postgres` is not a superuser, and SET on
  pgvector's placeholder GUC fails on deploy. 0326 is the `assistant_chunks_tsv_idx` GIN index
  0325's column rebuild dropped. 0327 holds `analytics_component` (0141 is no longer the latest),
  now VOLATILE, stamping `assistant_components.last_viewed_at` at most once an hour (the nightly
  pre-warm skips cards not viewed in 7 days). 0328 (another session) adds the read tools
  `assistant_tournaments_summary`, `assistant_loyalty_summary` and dispatches `report_matches`,
  so it holds `assistant_run_tool` (0266 is no longer the latest). 0329 re-creates no function:
  it revokes the client INSERT on `assistant_messages` and `assistant_calls` (0108 granted it to
  any owner session) and drops their insert policies; only the edge functions write them.
  Assistant stored-days cache (0330, 2026-10-09): holds `assistant_run_tool` (0328 is no longer the
  latest; one branch, `assistant_history_figures`, the tool `history_figures`) plus the tables
  `assistant_cache_config` (one row: `enabled` OFF, `freeze_days` 3) and `assistant_day_facts` (one
  row per report scope and closed business day: the `app.reports_figures` keys for that day), both
  empty and unreadable by any client, and the functions `assistant_history_figures` (the read path:
  day/week/month buckets of at most 31, kept days from the table, the rest live through
  `reports_figures`, so the numbers are the panel's; never writes), `assistant_cache_fill` (the only
  writer, newest first, `p_max_days` a call, nothing while off; cron `tp_assistant_cache_fill`,
  01:20 UTC), `assistant_cache_init` (switch on + fill), `assistant_cache_clear` (empty + off),
  `assistant_cache_invalidate(from, to)` and `assistant_cache_status`, all service role. A scope is a
  branch id or `all:<md5 of the branch ids>`, so a changed branch set is a miss. The cache ships
  empty and OFF; `node scripts/assistant-cache.mjs init` is the "cache init", run only when the
  owner says so. A correction to a day older than `freeze_days` needs `invalidate` for that range.
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
  joins `app.notify_staff`'s `c_title_keys` (latest `0363`, 52 keys, which appended `step_passed`,
  `decision_waiting`, `run_scheduled`, `run_done` and `run_withdrawn` after 0362's `plan_submitted`,
  `plan_approved` and `plan_changes`, themselves after 0333's `reward_unlocked` and the route
  `staff-rewards`, after 0323's `checklist_due` and `checklist_overdue`, themselves after 0322's `shop_price_changed`, itself after 0313's `screenshot_taken`, itself after 0308's `loyalty_gift` and 0261's `match_report_new`) in
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
  everything else in the `cafe_settings` registry (`app.cafe_setting_specs`, latest 0355). Design
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
- `app.is_staff` counts second jobs (0345), `app.staff_role()` is the main job alone. A limit on
  one role the guard admits tests `not app.is_staff(<the guard's other roles>)`, never
  `app.staff_role() = '<role>'`, or a second job of that role skips it (0404). A role that can
  never be a second job (`manager`, `owner`, the heads; `staff_extra_roles_chk`) may still be
  read from `staff_role()`.
- Errors are `raise exception 'CODE'` (P0001). Every new code gets its line in the one error
  catalogue, `ERROR_CODE_KEYS` in `packages/i18n/src/errors.ts`, EN and AR, in the same commit
  (`check:error-codes` fails otherwise); the operator's `MAPPED_CODES`, the web's `rpcErrorKey` and
  the phone's `mapErrorToKey` all resolve through it, with per-app wording only as overrides
  (`WEB_OVERRIDES`, `MOBILE_OVERRIDES`).
- No WHERE-less write (`scripts/check-safe-update.mjs`). `app.lock_court` (0042) before any
  reservation write. Lock order
  `day_sessions → match_money_advisory → coach_advisory → tournaments → tournament_entries → tabs → promotions → loyalty_attempts_advisory → orders → order_items → tickets → payments → till_shifts → refunds → stock_batches → court_advisory → venues → reservations → match_venue_advisory → match_tickets → loyalty_reward_vouchers → loyalty_gift_advisory → loyalty_accounts`
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
- `rpc.queued` (0395) is the one generic type: an allowlisted RPC name plus its `p_*` arguments,
  dispatched by replay to `app.queued_rpc` (security invoker; claims the key through the definer
  `queued_rpc_claim` in the same transaction, then calls the RPC as the caller). The allowlist has
  three copies held equal by `tests/queued-rpc.test.ts`: core `QUEUEABLE_RPCS`,
  `_shared/mutation-types.json` `queueableRpcs`, `app.queueable_rpcs()`. A PIN rides as
  `args.p_pin` only for a PIN-gated name; replay proves it first and `redact.ts` strips `p_pin`.
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
