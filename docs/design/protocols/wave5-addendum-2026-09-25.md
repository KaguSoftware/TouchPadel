# Wave 5 addendum: Majed's nine answers, as build contracts (2026-09-25)

Companion to `build-contracts-2026-09-23.md` ("contracts") and `plan-2026-09-23.md`. The contracts
cover waves 0–4. This file covers **wave 5**: the nine parked questions Majed answered on the
evening of 2026-09-25 (memory `wave4-role-pages-spec-2026-09-25`, "Majed's answers to the parked
list"). It is binding for every wave-5 lane until someone edits it.

**Precedence.** For a wave-5 object, this file wins over the contracts and the plan. For everything
it does not restate, the contracts still bind: numbering (§1.3), drafts and the shared local stack
(§1.4), commit rules (§1.5), push and deploy order (§1.6), SQL conventions (§2.1), the one-meaning
error rule (§3), i18n parity (§4), and the mobile rules (§6, `apps/mobile/CLAUDE.md`). Once
committed, the contracts' §0 "Parked" table points here (the doc commit Z, §1.4 below).

**Markers.** **PROPOSAL** marks a shape chosen here or in a section draft that nobody has decided.
Build it unless someone objects. **UNVERIFIED** marks a fact to check before relying on it.
**OPEN** points to a question in §8. Its default is built now, under Majed's standing rule "always
keep building" (memory `wave4-role-pages-spec-2026-09-25`, line 10). No §8 question is "Parked" in
the contracts' §0 sense (NOT TO BUILD). When Majed's answer differs from a default, it becomes a
follow-up change.

**Citations.** `NNNN:line` means `packages/db/supabase/migrations/2026…NNNN_*.sql`; `op/` means
`apps/operator/src/`; `mob/` means `apps/mobile/`. Planned migrations are named by feature and take
their ordinal only at commit (contracts §1.3). At HEAD `bd09757` the committed migrations run to
0189, and another session's 0190 `touch_ingredients_and_recipes` (f71e115, pushed and applied on hosted 2026-09-25 21:29 with 0161-0189), so the first wave-5 ordinal is 0191. The two drafts this file first waited on are now
committed. 0188 `checklist_day_state_asof` (R7) re-issues `checklist_day_state` only (0188:51).
0189 `sql_helpers_not_inlinable` (hardening) re-issues ten SQL helpers (`b64url_*`,
`business_date`, `normalize_finding`, `phone_canon`, `search_norm`, `like_escape`,
`customer_reservation_json`, `reports_bucket` and `assistant_params_hash`). Neither one re-issues an
object that wave 5 re-issues. `packages/db/supabase/drafts/` does not exist at HEAD, so each lane
creates it for its own drafts (contracts §1.4).

**Sources.** This file merges four design sections. All four existed and were read in full:
`w5-g1.md` (the two roles, and size renames through a price change), `w5-g2.md` (salary
deductions, incident reports, marketing content approval), `w5-g3.md` (two stores, transfers, log
stock, stock control) and `w5-g4.md` (till shifts). They sit in the session scratchpad and are not
committed. Where they disagreed, or one assumed something another did not build, this file decides.
The merge fixes are listed below.

**Re-verified at merge (2026-09-25, HEAD 179e1c8), and re-checked at review (HEAD `bd09757`,
migrations to 0189). 0188 and 0189 re-issue none of the bodies below.**
- **The latest body of every re-issued function.** Searched in sorted file order, both `create`
  spellings: `notify_staff` 0169:26, `staff_media_visible` 0170:298, `staff_media_slot` 0170:116,
  `is_staff_media_path` 0170:97, `claim_staff_media` 0170:205, `staff_team` 0170:176,
  `protocol_tick_nudge` 0173:642, `upsert_variant` 0177:707, `upsert_modifier` 0177:982, the four
  price/promo bodies in 0177, `save_teaching` 0179:80, `teachings_for_me` 0179:260,
  `staff_stock_view` 0181:34 and `recipe_view` 0182:33.
- **More latest bodies:** `kitchen_board` 0158:42, `set_ticket_status` 0156:598,
  `set_order_item_ready` 0156:617, `protocol_engine_roles` 0164:114,
  `protocol_check_hiring_open_position` 0176:200, `consume_fefo` 0018:83, `start_count` 0019:41,
  `finalize_count` 0044:301, `receive_delivery` 0145:242, `receive_purchase` 0166:678,
  `record_production_internal` 0167:38, `record_production` 0167:111, `record_waste` 0049:356,
  `trg_refund_restock` 0146:245, `trg_low_stock_alert` 0151:36, `report_stock` 0172:1889,
  `protocol_submit_product_release_test` 0172:1112, `refund` 0139:368 and `close_day` 0020:18.
- **Error maps:** which codes are in `op/lib/errors.ts` and `mob/src/features/booking/errors.ts`
  (§3).
- **Gates and scripts:** the lock order (`packages/db/scripts/check-lock-order.mjs:31-42`), the
  go-live reset list (`packages/db/scripts/go-live-reset.sql:86-150`), SEC-29's `FORBIDDEN`
  (`packages/db/scripts/check-analytics-payload.mjs:41-50`), SEC-20's discovery
  (`packages/db/tests/stored-fields.test.ts:81`) and the staff-role parity test
  (`packages/db/tests/staff-roles-parity.test.ts:84-87`).
- **Push keys:** 26 title keys in `_shared/staff-push.json`, the last one
  `marketing_request_answered`.

### What the merge changed from the section drafts

| # | Change | Why |
|---|---|---|
| M1 | `app.is_staff_media_path` is re-issued with **no** SET clause, as `language sql immutable` with its `anon`, `authenticated` and `service_role` grants. G2 said it "keeps its SET clause", but it has none (0170:97-98). | It is granted to the API roles and evaluated by storage policies, so the hardening rule for *revoked* SQL helpers does not apply. The contracts (§2.24.2) keep its form. |
| M2 | The waiter's operator `/tasks` gets read-only copies (the wave-4 `PhoneCopies` pattern, `op/features/tasks/tasksLogic.ts:117-162`): the existing `stock` copy (the waiter joins it) and a new `storeToday` copy from `stock_today`. Move, log and count stay phone writes. | G1 promised "Move stock" on `/tasks` "from the stock-locations section", and G3 built no `/tasks` piece. |
| M3 | One question covers both Hasan's team and Bareq's team for deductions (§8 Q2). The default is the same in both drafts. | G1 Q3 and G2 Q-a3 asked the same thing. |
| M4 | Only lane P adds push title keys (ten of them). G3's `count_submitted` and G4's `till_shift_difference` stay unbuilt (§8 Q20, Q27). If Majed says yes before `staff_push_keys_wave5` commits, they join P's send-push commit and that migration. After it, they need a new pair. | One `notify_staff` owner per wave (contracts §2.18). |
| M5 | `transfer_stock` and `app.receive_delivery_internal` take `pg_advisory_xact_lock_shared` on the store key(s) before they test for a count in progress. Because every stock addition goes through the internal, that covers `log_stock`, Goods in (`receive_delivery`) and the driver receipt (`receive_purchase`). `start_count` and `submit_stock_count` take the same key exclusively. | Without the shared lock, a count started while a transfer is in flight can snapshot before the transfer commits, which gives phantom variance. That is G3's own invariant I14. The same double count happens when goods are received into a store during its count (the delta against the start snapshot, 0044:350, is applied at :365 and :387), so the review moved the lock into the internal (V19). |
| M6 | `log_stock` validates its lines before calling `receive_delivery_internal`, so `EMPTY_DELIVERY` and `INVALID_LINE` can never reach the phone. A test pins this. | Neither app maps those two codes today (grep of both maps). |
| M7 | The phone's no-station guard gains the manager-only stock bodies (`start_count`, `finalize_count`, `discard_count`, `price_logged_stock`, `receive_purchase`) and the five till-shift names. | The contracts' §6.7 rule: manager-only public bodies never appear in a staff file. |
| M8 | `go-live-reset.sql` gains `till_shifts`, which is required (it references `day_sessions` and `stations`, and `payments` and `refunds` reference it). It also gains `stock_transfers`, `stock_transfer_lines`, `salary_deductions` and `incident_reports` (**PROPOSAL**). A gap already there is flagged (§7.8). | TRUNCATE without CASCADE refuses a table that another, untruncated table references. |
| M9 | `salary_deductions` commits after `assistant_barista_waiter_access`, so its test covers Bareq proposing for Hussein. `till_shifts` and `stock_transfers` commit after the roles enum. | These are soft dependencies that the drafts left as "if committed first". |
| M10 | The smoke suites are named by lane: `staffPeople.smoke.test.tsx` (P) and `staffStores.smoke.test.tsx` (S). G2 had used `staffWave5.smoke.test.tsx`. | Each route must be named by exactly one suite (`apps/mobile/CLAUDE.md`, Tests). |

### What the review changed (2026-09-25)

| # | Change | Where |
|---|---|---|
| V1 | `app.stamp_till_shift` now uses an `if`/`else` on the table. PL/pgSQL resolves every NEW field a statement names when it prepares that statement, so the shared SELECT raised `record "new" has no field "day_session_id"` on every refund that carries a device. This was reproduced on the local stack inside a rolled-back transaction. The refund branch only takes a shift whose day is open | §2.9.3, TI2, T3 |
| V2 | N owns the `/tasks` price forms, the phone's price-form logic and their catalogs | §1.2, §1.3, §2.2.5, §4.1 |
| V3 | §8 holds defaults that are taken, not the contracts' "Parked" | header, §8 |
| V4 | Only owners can read `marketing_content` and its versions, and content images are hidden from managers (Q14) | §2.4, §2.7.1, §2.12, §6.1 |
| V5 | Q17 and Q22 are removed, because the binding answers settle them | §0, §2.8.5, §8 |
| V6 | Citations now point at HEAD `bd09757` and 0189 | header, §1.4, §2.0, §2.1 |
| V7 | Every commit whose tests create either new role now follows R's enum commit | §1.1, §1.4, §2.11 |
| V8 | `ws/owner.*` is shared by R and then S. The waiter's hint says that moves happen on the phone | §1.2, §1.3, §4.2 |
| V9 | `forceCloseAllDays` leaves shifts open, and `open_till_shift` heals them | §2.9.5 |
| V10 | Refunds of an earlier day's payments are carried explicitly: in TI6 and TI7, in the list and in the day-close step | §2.9.4, §2.9.6, §7.5, §7.6, §7.9 |
| V11 | The phone maps `COUNT_IN_PROGRESS` to its own sentence, and `CANNOT_DECIDE_OWN` is reworded so it fits every use | §3, §4.2, §5.3 |
| V12 | The re-check command bypasses the shell's `grep` function and sorts its own output | §2.1.5, §2.10 |
| V13 | `open_till_shift` refuses while its station has queued writes | §2.9.4, §3, TI11, T5 |
| V14 | Shop (retail) stock is kept in the cafe only, on every path that adds stock | §2.8.2, §2.8.4, §2.8.5 |
| V15 | Stock writers that touch several ingredients lock them in ingredient order | §2.8.2, §2.8.5, §2.8.7, §7.4 |
| V16 | An approved deduction's pay month is the month it was approved in | §2.5, §8 Q9 |
| V17 | Deduction audit rows carry `{status}` only | §2.0, §2.5 |
| V18 | The handover difference counts cash that came in or went out outside a shift | §2.9.4, T7 |
| V19 | Receiving goods respects a count in progress, through the internal | M5, §2.8, §3 |
| V20 | The refund restock is costed like today only while every live batch is in the cafe | D3 |
| V21 | `stock_cost_estimate` deliberately skips batches with no cost, unlike `v_item_cogs` | D5, I15 |

### What the fix pass changed (2026-09-26, after the privacy and money/stock reviews)

| # | Change | Where |
|---|---|---|
| F1 | An ingredient advisory lock, `app.lock_stock_ingredients(uuid[])` (in `ingredient_id` order), comes before any batch is read by `consume_fefo_at`, `transfer_stock`, `finalize_count` and `price_logged_stock`. `consume_for_order_item` (0018:213, now re-issued by S) takes the whole order's, and the product test all its servings'. A sale that waited on a batch a move was emptying read its batch list before the move committed and wrote an overdraft while the other store held the stock, and a two-item ticket whose items ran against ingredient order met a two-line move in 40P01 | D3, D6, §2.8.4, §2.8.6, §2.10 |
| F2 | `consume_fefo_at` returns what it booked, and a production is costed from that: summing every `production_consume` row after a `max(id)` read counted a concurrent production's rows | §2.8.4, §2.8.6 |
| F3 | A phone count's variance period ends at its submit (`started_at`, when its theoretical was taken), and the next period starts there | §2.8.6 (`v_variance_report`) |
| F4 | The handover's outside cash counts the null-stamped rows since the previous shift **opened**, so a settle that began before the close and wrote after it is in | §2.9.4 step 8, `till_shift_status` |
| F5 | `close_till_shift_internal` locks the shift itself before it sums | §2.9.4 |
| F6 | A manager who is a deduction's person reads it only as the person: the table policy, `deductions_page` and `deductions_month` leave out the caller's own rows | §2.5.2, §7.6 |
| F7 | `notification_outbox.profile_id` and `payload` leave `app.assistant_readable_columns`: `deduction_recorded` goes to the person | §2.0, §2.5.3 |
| F8 | `staff_media_delete` (0159) is re-issued without the `incidents` folder | §2.4, §2.10, §7.9 |
| F9 | Upload slots in `incidents` and `campaigns` nobody claimed a day on are held (`used_by 'orphan_purge'`) and removed by the tick | §2.6.2, §2.12 |
| F10 | The §2.1.8 waiter-call objects are listed with R's re-issues, with the venue check R's draft adds (a **PROPOSAL** for Majed), and the texts that still kept the waiter out of the calls say he answers them | §2.1.1, §2.1.4, §2.1.5, §2.1.8, §2.10, §2.12, §6.1 |

---

## 0. Majed's nine answers and what each changes

Each answer below is verbatim from the relayed request. The reading is the binding memory entry
(`wave4-role-pages-spec-2026-09-25`, "Majed's answers"). These answers close contracts §0 Parked
P1–P8, and the §2.13 "Open" note on renames.

| # | Question | Majed (verbatim) | Binding reading | What it changes | Lane |
|---|---|---|---|---|---|
| 1 | Create the Assistant barista (Hussein) and Waiter (Hasan) roles? | "yes" | Create `assistant_barista` and `waiter`. | Two `staff_role` values, appended after `marketing`. A value can never be dropped (plan #1), which is why this waited. <br><br>The assistant barista joins the bar team, the kitchen board, teachings and recipe names. The waiter joins no team and gets the any-staff baseline, the cleaning-photo checklists, and "Move stock" (#8). Every client copy of the role list changes in one commit. <br><br>The operator is released **before** anyone is given either role (§2.1, §7.3). | R |
| 2 | "Manage salaries … cut": dropped, or do heads manage salary deductions? | "heads can do salary deductions , however deuction needs approval from manager/owner" | A head (Bareq, Rusul) proposes a deduction for a member of their team. A manager or owner approves or declines it. | A new `salary_deductions` record: propose, withdraw, decide, cancel, month view and my deductions. <br><br>It is money about a named person, so it is never readable by the owner assistant or any LLM. Pushes and audit rows carry no amount. <br><br>Decided on the operator (`/deductions`); proposed on the phone (§2.5). | P |
| 3 | Recipes "no numbers": ingredient names only, or quantities but no costs? | "ingredient no quantity even" | Ingredient names only, no quantities at all. | **No change.** `recipe_view` (0182:33) already returns names only to everyone (contracts #72). The assistant barista joins its readers (#1). This closes P3. | R (reader list only) |
| 4 | Cashier "day close": the whole day, or just her own till? | "just her own thats the new thing , the day will keep on going but like someone else will be on the system" | She closes only HER OWN till session, as a shift handover. The business day keeps going. | A new **till shift** below the day. <br><br>Open: the float is counted in, with a handover difference from the last count. Close: a blind count with her own PIN, or a manager's. The closed shift is stamped with expected, counted and the difference. <br><br>Payments and refunds are attributed by a station trigger. `close_day` keeps its math and ends any shift still open (§2.9). | T |
| 5 | "Log stock" vs "stock control": counting the shelf, or recording usage and waste? | "log stock: add stuff to stock , stock control : count whats there atm" | "Log stock" = ADD to stock (Bareq, Maha, the desk for the shop, into the cafe; Rusul into the bakery). "Stock control" = COUNT what is there (Rusul, Tiba). | **Log stock:** a new `log_stock`, with no cost shown or asked. Its cost is estimated from the last known cost, and a manager corrects it. <br><br>**Count:** a new phone count, `submit_stock_count`. It is blind (no expected quantity, no cost), and a manager applies it (§2.8). | S |
| 6 | Desk "Report": what goes in it? | "they will be able to report incidents that happen there , accidents , fights , someone hurt etc.." | Incident reports. | A new `incident_reports` record with photos. <br><br>The desk and the cashier report on the operator (`/incidents`), and every role can report on the phone. A manager or owner reviews it with a note. <br><br>The text is purged at 365 days, and the owner can redact it early. It never reaches the LLM (§2.6). | P |
| 7 | Marketing "Approval": what do they approve? | "they send stuff like content for the owners approval" | Marketing sends content (posts) for the owners' approval. | New `marketing_content` and `marketing_content_versions` records. <br><br>Marketing submits and revises. The owner approves, asks for changes or declines, with a reason. The approved version is frozen (§2.7). | P |
| 8 | Waiter "moved to bakery panel": does Hasan use the bakery pages? | "there will be 2 storage units , one in the bakery one in the cafe , he should be able to move from cafe to bakery since all products will always be delivered and logged into the cafe stock first snd he {hasan} is the one that moves stuff from the storage units" **+ the same-evening UPDATE** (memory): "the bakery is a WHOLE STOCK OF ITS OWN … RUSUL does the logging … 'always cafe first' is withdrawn" | Two stores per venue, cafe and bakery. Hasan moves stock between them. Every receive or log path names a store, and the cafe is the default. | `stock_location` on batches, movements, counts and deliveries. <br><br>`transfer_stock` is open to the waiter and MGMT. Consumption is location-aware and never blocks: it takes its preferred store first, then the other. <br><br>Goods in and "Bought by the driver" get a store picker. Counts, variance and the stock report work per store (§2.8). <br><br>The UPDATE is binding and withdraws "always cafe first" (memory `wave4-role-pages-spec-2026-09-25`, lines 80-82), so this is not a question. The one exception is shop (retail) stock, which lives only in the cafe (§2.8.5). | S |
| 9 | Size renames on live items: only you, or through a price change? | "price changes" | A manager cannot rename directly; a rename goes through a price change. | A manager renaming a launched item's size, or a launched **paid** add-on, gets `PRICE_VIA_PROTOCOL` with hint `name`. <br><br>Renames travel inside the existing `price` and `addon_price` change kinds as `renames`. The owner's fixed OK at `numbers` (#58) approves them (§2.2). | N |

**What the answers retire in the contracts** (the doc commit Z does these edits):
- the §0 Parked table P1–P8, and the "Open" note in §2.13;
- acceptance item 27 ("Nothing on §0's Parked list exists");
- the §6.1 sentence "Nothing on the Parked list (§0) has a row";
- the §8.2 note "The **Parked** guard for §0 P1 already exists".

---

## 1. Lanes, file ownership, dependencies, commit order

### 1.1 Lanes

Wave-5 lanes use their own letters, so they do not collide with the contracts' lanes 0 and A–K.
Every lane starts its drafts now, as new files under `packages/db/supabase/drafts/<feature>.sql`.
A lane edits no file that wave 4 (H, D2) is still writing until wave 4 is committed, and it re-reads
each such file immediately before editing it.

| Lane | Work | DB drafts (by feature) | Depends on |
|---|---|---|---|
| **Z** Doc | this file, its `assistant-coverage.json` key, and the contracts pointer edits of §0 | – | – |
| **W0** Scaffold | the new i18n pairs (empty, apart from `staff.stores.countWaiting`) and their mounts; every new error code's EN and AR string, `MAPPED_CODES` and `CODE_TO_KEY` rows; the reworded `PRICE_VIA_PROTOCOL` and `CANNOT_DECIDE_OWN`; the `work.*` vocabulary; `op.stock.movement.transfer` and `op.stockNav.moves` | – | wave 4 committed |
| **R** Roles | `assistant_barista` and `waiter`: the enum, the access re-issues, every client copy of the role list, labels, the dev fixture | `staff_roles_assistant_waiter` (enum only), `assistant_barista_waiter_access` | W0 |
| **N** Renames | size and add-on renames through a price change: the manager lock and the change-kind fields, plus the operator and phone forms | `price_promo_renames` | W0 (the reworded string); R's enum (tests only, V7) |
| **P** People records | the wave-5 push keys (send-push commit + migration), the `incidents` folder and content read rule, salary deductions, incident reports, marketing content approval | `staff_push_keys_wave5`, `staff_media_incidents`, `salary_deductions`, `incident_reports`, `marketing_content` | W0; R's enum (the tests of `incident_reports` and `marketing_content`, V7); R's access migration (`salary_deductions`, M9) |
| **S** Stores | the cafe and bakery stores, transfers, log stock, phone counts, location-aware consumption, counts, variance and the report | `stock_transfer_movement` (enum only), `stock_locations`, `stock_transfers`, `stock_logs`, `stock_counts_by_location`, `stock_store_reads` | W0; R's enum (`stock_transfers` and `stock_store_reads`, and the tests of `stock_logs` and `stock_counts_by_location`, V7) |
| **T** Till shifts | a till shift below the day: open, close (own PIN or manager PIN), handover, attribution, day-close and drawer views | `till_shifts`, `till_shift_index` | W0; R's enum (tests only, M9) |

### 1.2 Owned files (one owner each in wave 5)

A file named here is edited only by its lane in wave 5. A file already owned in the contracts
(§1.2) passes to the wave-5 lane named here once wave 4 is committed.

| Lane | Owns |
|---|---|
| Z | `docs/design/protocols/wave5-addendum-2026-09-25.md`; the pointer edits in `build-contracts-2026-09-23.md` (§0 above) |
| W0 | new pairs, empty apart from one key: `packages/i18n/src/catalogs/ws/{deductions,incidents,content,stores,tillShift}.{en,ar}.ts` and `packages/i18n/src/catalogs/staff/{deductions,incidents,content,stores}.{en,ar}.ts` (each lane fills its own pair after W0; the only key W0 writes is `staff.stores.countWaiting`, V11) |
| R | drafts `{staff_roles_assistant_waiter,assistant_barista_waiter_access}.sql`; `packages/db/tests/assistant-barista-waiter.test.ts` (new); the role cases of `packages/db/tests/{kitchen-board,teachings,recipe-view,hiring,staff-admin}.test.ts`; `packages/core/src/staff/roles.ts` (+ `roles.test.ts`); `packages/db/supabase/functions/_shared/auth.ts` (`StaffRole`); `packages/db/supabase/functions/staff-admin/role.ts` (`ROLES`); `apps/operator-shell/src/ipc-channels.ts` and `op/ipc/bridge.ts` (`Role`); `op/features/admin/staff/staffModel.ts` (+ the picker test); `op/features/floor/floorModel.ts` (+ test); the unknown-role examples in `op/features/marketing/marketingStaffLogic.test.ts:70` and `op/features/roleExtras/roleExtrasLogic.test.ts:30`; `packages/i18n/src/catalogs/ws/owner.{en,ar}.ts` (`staff.roleAccess`; S appends later, see §1.3); `packages/db/fixtures/staff-roles.sql`; `mob/src/features/staff/teachings/logic.ts`, `mob/src/features/staff/recipes/logic.ts` and their tests; `mob/src/features/staff/__tests__/status.test.ts` |
| N | draft `price_promo_renames.sql`; the rename cases of `packages/db/tests/price-promo.test.ts` (listed in §6.1); `op/features/admin/menu/{menuLogic.ts,VariantsEditor.tsx}` (+ tests); `op/features/stock/products/productsLogic.ts` (+ test); `op/features/admin/addons/addonsLogic.ts` (+ test); `packages/i18n/src/catalogs/ws/{release,pricing}.{en,ar}.ts` (rewords and adds); the price and add-on-price forms and run sheet in `op/features/protocols/**`; marketing's price and add-on-price start form on `/tasks`, `op/features/tasks/{StartSheet.tsx,StepFormFields.tsx,priceLogic.ts,formModel.ts,fieldLabels.ts}` (+ tests; only `tasksLogic.ts`, `MyTasks.tsx` and `PhoneCopies.tsx` are shared, §1.3); `mob/app/staff-start.tsx`, `mob/app/staff-step.tsx`, `mob/src/features/staff/protocols/{useStepReads.ts,logic.ts,labels.ts,FormFields.tsx}` (+ tests; the prefilled rename rows and their labels only; `logic.ts:210` `PRICE_PROPOSE_HIDDEN`, `:274-293`); the rename labels in `packages/i18n/src/catalogs/{ws/team,ws/protocols,staff/protocols}.{en,ar}.ts` (§4.1; every other lane keeps its `/tasks` strings in its own pair); `packages/core/src/protocols/{steps.ts,validate.ts,protocols.test.ts}` |
| P | `packages/db/supabase/functions/send-push/staffStrings.ts` and `packages/db/tests/send-push-staff.test.ts`; `packages/db/supabase/functions/_shared/staff-push.json`; drafts `{staff_push_keys_wave5,staff_media_incidents,salary_deductions,incident_reports,marketing_content}.sql`; `packages/db/tests/{salary-deductions,incident-reports,marketing-content,staff-media-incidents}.test.ts` (new); the cases that grow in `staff-push.test.ts` and `staff-media-folders.test.ts` (`FOLDERS`); `packages/db/supabase/functions/protocol-action/{logic.ts,index.ts}` (+ vitest); `packages/db/tests/stored-fields.test.ts` (`UNLINKED_PERSONAL`); `packages/db/scripts/check-analytics-payload.mjs` (two tripwires); `op/features/{deductions,incidents,content}/**` (new); `op/routes/{deductions,incidents}.tsx` (new); `op/features/marketing/MarketingPanel.tsx` (mounts the content section); `ws/{deductions,incidents,content}.*`, `staff/{deductions,incidents,content}.*` (after W0); `mob/app/staff-{deductions,incidents,content}.tsx` (new); `mob/src/features/staff/{deductions,incidents,content}/**` (new); `mob/src/smoke/staffPeople.smoke.test.tsx` (new); `mob/app/staff-request.tsx` (the "My deductions" row); `mob/app/staff-marketing.tsx` (the content row); `mob/src/features/staff/photo.ts` (`PhotoFolder`); `docs/legal/staff-privacy-notice.md`, `docs/store/{google-play-data-safety,app-store-submission}.md`, `packages/i18n/src/catalogs/legal.{en,ar}.ts` |
| S | drafts `{stock_transfer_movement,stock_locations,stock_transfers,stock_logs,stock_counts_by_location,stock_store_reads}.sql`; `packages/db/tests/{stock-locations,stock-transfers,stock-logs,stock-counts,stock-store-reads}.test.ts` (new); the cases that grow in `staff-stock-view`, `staff-production`, `product-release`, `shopping-purchases`, `replay-mutate-parity` and `staff-roles-parity` (the `stock_location` case); `packages/core/src/staff/stores.ts` (new, + test); `packages/core/src/schemas/mutations.ts` (the optional `location` on `stockWastePayloadSchema`, + test); `op/lib/mutate.ts` and `packages/db/supabase/functions/replay/index.ts` (the `stock.waste` `p_location` pass-through only); `op/features/stock/{MoveStock,StaffLogs}.tsx`, `op/features/stock/storeLogic.ts` (+ test) (new); `op/features/stock/{OnHand,ReceiveDelivery,DriverPurchases,CountScreen,WasteAndProduction,LedgerDrawer,VarianceReport,AlertsPanel}.tsx` and the Expiry panel; `op/features/stock/stockKeys.ts` (moved to the shared table by the contracts' rule, §1.3 below); `op/routes/stock/_children.ts`; `op/features/reports/{StockReport.tsx,reportPayloads.ts}` (+ tests); `ws/stores.*`, `staff/stores.*` (after W0); `mob/app/staff-stock-{log,move,count}.tsx` (new); `mob/src/features/staff/stores/**` (new); `mob/app/staff-stock.tsx` and `mob/src/features/staff/stock/logic.ts`; `mob/src/smoke/staffStores.smoke.test.tsx` (new) |
| T | drafts `{till_shifts,till_shift_index}.sql`; `packages/db/tests/till-shifts.test.ts` (new); `packages/db/scripts/check-lock-order.mjs` (`ORDER`); the lock-order line in `packages/db/CLAUDE.md`; `HANDOFF.md` (the "Till online-only ops" row); the online-only line in `apps/operator/CLAUDE.md`; `op/features/tillShift/**` (new); `ws/tillShift.*` (after W0); `op/features/till/{CashDrawer,TabDetailPanel}.tsx` and the payment pane; `op/features/admin/{DayClose.tsx,dayCloseLogic.ts}` (+ test); `op/features/reports/StaffActivityReport.tsx` |

### 1.3 Shared files (append-only, in commit order, re-read before each edit)

| Shared file | Lanes, in commit order | What each adds |
|---|---|---|
| `packages/db/src/types.gen.ts`; `packages/db/fixtures/{rpc-allowlist,rpc-coverage-floor,assistant-coverage}.json`; `packages/db/tests/rls-matrix.ts`; the three assistant-map outputs (contracts §1.5) | every DB commit, then Z for its doc key | own keys and rows only (§2.12); the floor via `--update-floor`; the map rebuilt from a clean tree |
| `packages/i18n/src/catalogs/{en,ar}.ts` | W0, R | W0: `op.stock.movement.transfer`, `op.stockNav.moves`, and the `op.errors.CANNOT_DECIDE_OWN` reword (§3, V11). R: `op.roles.{assistant_barista,waiter}` |
| `packages/i18n/src/catalogs/ws/owner.{en,ar}.ts` | R (#4), then S (#24) | R: `staff.roleAccess.{assistant_barista,waiter}`, the waiter's without the stock clause. S: the waiter's stock clause (§4.2, V8) |
| `packages/i18n/src/catalogs/{work,opErrors.protocols}.{en,ar}.ts`, the wave-5 block of `MAPPED_CODES` (`op/lib/errors.ts:10`), the wave-5 block of `CODE_TO_KEY` (`mob/src/features/booking/errors.ts:12`), `packages/i18n/src/catalogs/{ws,staff}/index.ts` | W0 only | §3, §4. W0 also puts `staff.stores.countWaiting` into the new `staff/stores.*` pair, because `CODE_TO_KEY` points at it (V11) |
| `op/lib/auth.tsx` | R, P, S, T | R: `ROUTE_ROLES['/kds']` and `['/tasks']`, `homeRoute`. P: `ROUTE_ROLES['/deductions']` and `['/incidents']`, eight capabilities. S: `SUB_ROUTES['/stock']` gains `/stock/moves`. T: `payOnOthersShift` |
| `op/lib/workspaces.ts` (+ test) | R, P | R: `workspacesForRole` and the `TEAM` comment. P: `labelKey` `deductions` and `incidents`, the rows, and the badges `deductionsWaiting`, `incidentsOpen` and `contentWaiting` |
| `op/routes/__root.tsx` | R, P, T | R: `ROLE_ORDER`. P: `useNavBadge` queries. T: mounts `ShiftRailControl` under `BreakRailControl`, and adds the leaving guard on Sign out and on the idle lock's Switch user |
| `op/lib/queryKeys.ts`, `op/main.tsx` | P, T | P: `QK.deductionsWaiting`, `incidentsOpen` and `contentWaiting`, and two routes. T: `QK.tillShift` |
| `op/features/admin/audit/auditLogic.ts` (+ test), `packages/i18n/src/catalogs/ws/{shell,manager}.{en,ar}.ts` | P, S, T | action and family keys and their labels (§2.12) |
| `op/features/observation/ObservationHome.tsx`, `op/features/ops/{opsLogic.ts,OperationsOverview.tsx}` (+ test) | P, T | P: "Waiting on you" and `/ops` rows. T: the `tillShifts` work alert |
| `op/features/admin/SetupHome.tsx` (+ test) | S, T | S: "N staff stock additions need a cost". T: "N cashiers have no PIN" |
| `op/features/tasks/{tasksLogic.ts,MyTasks.tsx,PhoneCopies.tsx}` (+ tests) | R (#7), P (#21), S (#24) | R: nothing here (`phoneSectionsFor` reads `can('readTeachings')` and `can('readRecipes')` since wave 4, so R widens those two `CAPABILITY_ROLES` entries in `op/lib/auth.tsx`). P: a `myDeductionProposals` copy (HEADS) and marketing's Content section. S: the waiter joins `stock`, plus a new `storeToday` copy (M2). The `/tasks` form files are N's alone (§1.2) |
| `op/features/stock/stockKeys.ts` | S | moved here from F's sole ownership (contracts §1.2 rule): `fetchOpenCount` and `MOVEMENT_SELECT` |
| `op/routes/stock/_children.ts`, `op/features/stock/{ReceiveDelivery,WasteAndProduction,DriverPurchases}.tsx` | S | the store pickers and the `moves` child |
| `packages/core/src/protocols/types.ts` | P, N | P: `PHOTO_FOLDERS` gains `incidents`. N: `renames?` on the two record variants |
| `packages/core/src/staff/roles.ts` | R | – |
| `packages/db/tests/staff-roles-parity.test.ts` | S | a `stock_location` = `STOCK_LOCATIONS` case (R needs no edit: the test reads `STAFF_ROLES`) |
| `mob/src/features/staff/rows.ts` (+ `rowsByRole` test) | R, P, S | R: the rows follow the widened constants. P: `deductions`, `incidents`, `content`. S: `stock-log`, `stock-move`, `stock-count`, and the waiter on `stock` |
| `mob/src/features/staff/keys.ts`, `mob/src/lib/idempotency.ts`, `mob/src/smoke/routes.ts` | P, S | keys, `StaffMutation` names and smoke rows (§5.3); a screen's smoke row lands **in its screen's commit** (`smokeCoverage.test.ts`) |
| `mob/src/features/staff/__tests__/noStationRpc.test.ts` | S, T | M7 |
| `packages/config/src/eslint.js` (`testIdElements`) | any lane adding a Pressable wrapper | the wrapper's name |
| `packages/db/scripts/go-live-reset.sql` | P, S, T | M8, §7.8 |
| `docs/design/assistant/pages.md` | R, P, S, T | own sentences (§2.12); the commit regenerates the map from a clean tree |

### 1.4 Dependencies and commit order

Everything here commits **after wave 4** (H, D2) is committed. The R7 and hardening drafts are
already committed (0188, 0189), and they share no object with wave 5. One order that satisfies
every dependency:

| # | Commit | Lane | Migration (by feature) | Must follow |
|---|---|---|---|---|
| 1 | **wave-5 `send-push` copy** (no migration): the ten title keys' EN and AR copy (§2.3) | P | – | wave 4 |
| 2 | this addendum + its coverage key + the contracts pointer edits (§0) | Z | – | 1 |
| 3 | scaffold (§1.1) | W0 | – | 2 |
| 4 | the roles enum + **every** client copy of the role list (typecheck and parity pass only together) | R | `staff_roles_assistant_waiter` (enum only) | 3 |
| 5 | the movement-type enum | S | `stock_transfer_movement` (enum only) | 3 |
| 6 | the push keys in `notify_staff` and the JSON | P | `staff_push_keys_wave5` | 1 |
| 7 | the two roles' access + the guard mirrors | R | `assistant_barista_waiter_access` | 4 |
| 8 | renames (DB) | N | `price_promo_renames` | 3; 4 (tests) |
| 9 | the `incidents` folder and the content read rule | P | `staff_media_incidents` | 3 |
| 10 | deductions | P | `salary_deductions` | 6, 7 |
| 11 | incidents (with the `protocol-action` tick phase) | P | `incident_reports` | 6, 9; 4 (tests) |
| 12 | content approval | P | `marketing_content` | 6, 9; 4 (tests) |
| 13 | the stores | S | `stock_locations` | 5 |
| 14–16 | transfers; logs; counts by store (any order) | S | `stock_transfers`, `stock_logs`, `stock_counts_by_location` | 13; 4 (the guard of `stock_transfers` names the waiter, and all three tests create the new roles) |
| 17 | the store reads | S | `stock_store_reads` | 4, 14–16 |
| 18 | till shifts | T | `till_shifts` | 4 (tests), 3 |
| 19 | the index on the two money tables | T | `till_shift_index` | 18 |
| 20 | renames UI (core, operator, phone) | N | – | 8 |
| 21–23 | people records: operator UI; mobile UI; legal and store docs | P | – | 10–12 |
| 24–25 | stores: operator UI; mobile UI | S | – | 17 |
| 26 | till shifts: operator UI (+ the phone guard append) | T | – | 19 |

- **Enum widenings are their own files**: `staff_roles_assistant_waiter` and
  `stock_transfer_movement` (`packages/db/CLAUDE.md`, the 0143, 0155 and 0171 precedent).
- `stock_location` is a **new** type created inside `stock_locations`. A type created in the same
  file can be used there, and only `add value` needs its own file.
- **UI after DB.** A UI commit that calls a new RPC lands after the DB commit that carries its types
  (contracts §1.4).
- **R's enum commit carries the whole client copy set** (§2.1.6). R's access commit carries the
  guard mirrors.
- **Commit mechanics** are the contracts' §1.5 (pathspecs, partial staging, a clean-tree map, sole
  author Majed Ahdab, no trailer). Commit only when Majed says "commit".

### 1.5 Push points (all behind the 0161 hold)

No push that touches `packages/db/supabase/migrations/**` goes out until Majed confirms that every
station runs 0.2.20 (memory `push-triggers-db-migrate`; contracts §1.6). When it lifts, push in
this order:
1. **Wave 3's J `send-push` point (`2cc0ec2`), exactly as planned** (contracts §1.6 step 2b). Wait
   for `functions-deploy.yml` on hosted.
2. **Up to wave 5's `send-push` commit (#1 above)**, with `git push origin <sha>:main`. This push
   carries every earlier commit, the waves 2–4 migrations among them. None of them sends a wave-5
   key. Wait for `functions-deploy.yml` again.
3. **The rest.** db-migrate applies the wave-5 migrations. Push at a quiet hour: `stock_locations`
   and `till_shifts` alter hot tables (§7.4, §7.5).
4. **The operator tag.** Cut the next annotated `operator-vX.Y.Z` on the pushed commit (tagger
   Majed) and install it on every station. Only then give anyone a new role (§7.3).
5. **The mobile build** (1.0 carries the staff area; a person runs production `eas build`).

---

## 2. Contracts per feature

### 2.0 Rules every wave-5 file follows

- **Contracts §2.1 applies verbatim.** That covers the `set lock_timeout = '3s'; set
  statement_timeout = '60s';` header, `security definer set search_path = public`, and the guard
  as the first statement. It covers the order of guards: the ANY form, the subset form, and
  row-addressed with `…_NOT_FOUND` across venues. After the venue is known, every write runs
  `perform set_config('app.venue_id', v_venue::text, true)`. It also covers:
  - new tables with `venue_id uuid not null references venues(id)`, no default, RLS on, a select
    policy for **MGMT at the venue only**, no client write grant, and `comment on` everything;
  - `p_idempotency_key` with `app.claim_replay` and `app.finish_replay` (0049) on every keyed
    insert, while decisions, withdrawals and reviews are state-idempotent;
  - the text caps and the `coalesce(length(btrim(x)),0) > 0` CHECK form;
  - audit payloads with ids, statuses and counts, and no free text;
  - the index waiver line;
  - `NOT VALID`, then `VALIDATE` inside a `conname` + `conrelid` guard;
  - re-issue from the latest body at commit (§2.10).
- **Every new SQL helper is `plpgsql`, or carries a `SET` clause.** A revoked, inlinable
  `language sql` helper can run for `authenticated` through a pooled generic plan (memory
  `postgrest-cached-plan-execute-bypass`; 0189's header, "THE HOLE", 0189:36-53; and
  `packages/db/tests/sql-helpers-not-inlinable.test.ts`, whose `OFFENDERS` query at :65-79 fails on
  any new offender). `app.staff_team` keeps its `set search_path = public` (0170:177). The one
  exception is `is_staff_media_path`, which is granted to the API roles (M1).
- **Signature changes** follow `packages/db/CLAUDE.md`:
  - `drop function` by the exact old signature, then recreate;
  - re-issue `revoke … from public, anon` and `grant execute … to authenticated`, even when the
    signature is new;
  - no stray overloads (`check:rpc-registry`, `rpc-overloads.test.ts`).
- **Role groups** added or widened by wave 5 (SQL lists are written out in full):

  | Name | Roles | Used by |
  |---|---|---|
  | BOARD (widened by R) | prep, cashier, manager, owner, head_barista, barista, **assistant_barista**, head_chef, chef | the kitchen board and ticket writers (§2.1) |
  | BAR_TEAM (widened by R) | head_barista, barista, **assistant_barista** (team `bar`; its head is head_barista) | `app.staff_team`, teachings, deductions |
  | TEAM_READERS | BAR_TEAM ∪ KITCHEN_TEAM (head_chef, chef) | `teachings_for_me`, `recipe_view` |
  | HIREABLE (widened by R) | cashier, **waiter**, court_desk, manager, head_barista, barista, **assistant_barista**, head_chef, chef, driver, marketing | owner-added step actors, hiring positions |
  | DEDUCT | head_barista, head_chef, manager, owner | proposing deductions (§2.5) |
  | MOVE | waiter, manager, owner | `transfer_stock` (§2.8) |
  | LOG | head_barista, head_chef, cashier, court_desk, manager, owner | `log_stock` (§2.8) |
  | COUNT | head_chef, chef, manager, owner | `submit_stock_count` (§2.8) |
  | STOCK_VIEW (widened by S) | head_barista, head_chef, court_desk, **waiter**, manager, owner | `staff_stock_view` (§2.8) |
  | SHIFT | cashier, court_desk, manager, owner (the `settle_tab` list, 0106:410) | till shifts (§2.9) |

  `prep` passes ANY guards and joins no new explicit list (contracts §2.1). Neither new role joins
  SHIFT, LOG, COUNT, DEDUCT or any money read.
- **Shared helpers** (reused, never copied):

  | Helper | Latest body | Wave-5 users |
  |---|---|---|
  | `app.staff_team(staff_role)`, `app.staff_team_head(text)` | 0170:176, :189 | R re-issues `staff_team`; P's deduction targets follow it |
  | `app.venue_business_date(uuid, timestamptz)` | 0165:182 | P (the deduction date window, the month), S (`stock_today`'s day) |
  | `app.staff_ids_with_roles(uuid, staff_role[])` | 0160 | P's push recipients |
  | `app.notify_staff(uuid[], text, jsonb, text)` | 0169:26 | re-issued once, by P (§2.3) |
  | `app.claim_staff_media(text[], uuid, text[], text)` | 0170:205 | P (incident photos, content images); **not** re-issued: each record claims under its own id, and a repeat claim by the same `used_by` passes (0170:241-242) |
  | `app.staff_media_slot` | 0170:116 | re-issued once, by P (§2.4) |
  | `app.claim_replay`, `app.finish_replay` | 0049:68, :98 | every keyed insert |
  | `app.write_audit` | – | every write |
  | `app.staff_home_location(staff_role)` (new, S) | – | S (production, product test, waste) |
  | `app.verify_own_pin`, `app.consume_pin_grant`, `app.verify_manager_pin` | 0156:302, :446, :484 | T |

- **Errors.** Wave 5 adds nine codes: two in both maps, seven for the operator only. Everything else
  reuses a code whose string already says the meaning (§3). W0 lands every new key and mapping
  before any migration that raises it.
- **Pushes.** No new kind and no new route. Ten new title keys, all from P, all on route `staff`.
  They are sent through `app.notify_staff`, with params from `{name, title, step}` only. No push
  carries an amount, a quantity, a reason, a description, the name of the person a deduction is
  against, or a guest's name (§2.3).
- **Staff media.** One new folder, `incidents`. Content images reuse `campaigns`. The waiter's
  cleaning photos reuse `checklists` and its `checklist_item:` read rule, unchanged (0170:374, the
  holders of the list's role at the venue). One migration re-issues the folder helpers (§2.4).
- **The LLM wall.** Three kinds of data are never readable by the owner assistant or any LLM:
  deductions, incident reports and unpublished content versions. Each is enforced by:
  - an `excluded` coverage value and no `app.assistant_readable_columns` row;
  - no assistant tool, and no `assistant_enqueue_index` trigger (0110:470-521 lists its tables by
    name);
  - never the all-table readable-columns catch-up (contracts §1.5);
  - two SEC-29 tripwires, `/deduction/i` and `/people_involved/i`. A grep of every migration found
    no scanned function emitting either key today;
  - audit rows that say only that an event happened and who acted. `audit_log` is `table_read`
    (`assistant-coverage.json:24`), and its `before` and `after` are readable when named
    (`is_default = false`, 0109:106; `table_read` accepts any allowlisted column, 0109:716-727). So
    a deduction's audit payload is `{status}` only: it never names the person the deduction is
    against, never carries an amount or reason, and its `reason_code` is null. `entity_id` points
    at the `salary_deductions` row, and that table is excluded (V17).

### 2.1 Roles: `assistant_barista` (Hussein) and `waiter` (Hasan) — lane R

#### 2.1.1 What every role already has (no re-issue)

0156 made the any-staff guards role-agnostic (0156:1-44). Both roles therefore get these with no
change:
- sign-in, breaks, cover, heartbeat and the PIN steps (0156:55-590);
- the guest-safe reads (0156:671-781);
- **Vacation**, the `leave` staff request (`submit_staff_request` 0160:246);
- **Suggestions** (`add_suggestion` 0180:71);
- **checklists** (`my_checklists_today` 0184:76, `mark_checklist_item` 0184:167). A photo-required
  item needs `p_photo_path`, so the owner writes Hasan's close list with "Needs a photo" items: that
  is data, not code;
- photo slots (`staff_media_slot` 0170:116, folder `checklists`) and the `checklist_item:` read rule;
- "Ask marketing" (`add_marketing_request` 0187:93);
- notes on new items (`add_release_note` 0173:191);
- `my_protocol_work`, `protocol_runs_page` (both empty for them);
- the day-close warning for unticked lists (`checklist_day_state`, latest body 0188:51, R7).

Both stay out of every money and order read. The order-side policies are explicit lists naming
neither (0157:36-61, narrowed by 0161). `waiter_calls_staff_read` (0136:125), `ack_waiter_call` and
`resolve_waiter_call` (0032:691-710) stay closed to the assistant barista; the waiter joins them
(§2.1.8, §8 Q3 answered).

#### 2.1.2 Which explicit lists they join

| List (latest body) | assistant_barista | waiter |
|---|---|---|
| BOARD: `set_ticket_status` 0156:598, `set_order_item_ready` 0156:617, policy `tickets_staff_read` 0156:788, policy `touchpadel_rt_staff_topics` (the guarded DO block 0156:794-814), `kitchen_board` 0158:42 (:50, :57-58) | **joins** (**PROPOSAL**: he makes drinks from the bar's tickets; OPEN §8 Q1) | no (§8 Q3: answered, the board stays closed to him) |
| `app.staff_team` 0170:176 | **`bar`** (contracts §2.1 reserved this) | none (**PROPOSAL**; OPEN §8 Q2) |
| `save_teaching` push recipients 0179:197 | **joins** | no |
| `teachings_for_me` guards 0179:276, :281 | **joins** | no |
| `recipe_view` guards 0182:43, :63 (names only, #3) | **joins** | no |
| HIREABLE: `protocol_engine_roles` `c_hireable` 0164:118-119; `protocol_check_hiring_open_position` 0176:213-215 | **joins** | **joins** |
| `staff_ingredient_options` 0162:38, `shopping_list` 0185:109, `add_shopping_item`, ideas (0172:1582 ff.), `record_batch` and the production reads (0167), `request_recipe_change` (0183), `start_protocol` (0178:192), the order-side reads (0161) | no (OPEN §8 Q1 for ideas and shopping) | no |
| `staff_stock_view` 0181:34 | no | **joins through S** (§2.8, with purchased and prepared) |
| `transfer_stock` (new, S) | no | **MOVE** |

With `app.staff_team('assistant_barista') = 'bar'`, Hussein's head is Bareq
(`app.staff_team_head('bar')`, unchanged). The teaching-photo rule
(`t.team = app.staff_team(app.staff_role())`, 0170:374) then covers him with no re-issue. Deduction
targets follow the same mapping (§2.5).

#### 2.1.3 Data model

- **No table and no column.** `staff_role` gains `assistant_barista` and `waiter`, **appended after
  `marketing`**. `staff-roles-parity.test.ts:84-87` compares `enum_range` with `STAFF_ROLES` in
  order.
- **No new policy.** The two re-issued policies keep their explicit lists, plus
  `assistant_barista`.

#### 2.1.4 Re-issues (in `assistant_barista_waiter_access`, each verbatim from the latest body)

| Object | Latest body | Change |
|---|---|---|
| `app.set_ticket_status(uuid, ticket_status, text)` | 0156:598 | `, 'assistant_barista'` in the `is_staff` list |
| `app.set_order_item_ready(uuid, boolean, text)` | 0156:617 | same |
| policy `tickets_staff_read` | 0156:788 | same; the venue conjunct is kept |
| policy `touchpadel_rt_staff_topics` on `realtime.messages` | 0156:794-814 | same; the `to_regclass('realtime.messages')` guard is kept |
| `app.kitchen_board(uuid)` | 0158:42 | both lists (:50, :57-58); the payload is unchanged |
| `app.staff_team(staff_role)` | 0170:176 | `when p_role in ('head_barista','barista','assistant_barista') then 'bar'`; keep `language sql immutable parallel safe set search_path = public` |
| `app.save_teaching(...)` | 0179:80 | the bar array at :197 |
| `app.teachings_for_me(...)` | 0179:260 | the guards at :276 and :281 |
| `app.recipe_view(uuid, uuid)` | 0182:33 | the guards at :43 and :63 |
| `app.protocol_engine_roles(jsonb)` | 0164:114 | `c_hireable` gains both roles; the comment lists 11 |
| `app.protocol_check_hiring_open_position(uuid, jsonb, text[])` | 0176:200 | the `not in (...)` list at :213-215 gains both |
| policy `waiter_calls_staff_read` (§2.1.8) | 0136:125 | `'waiter'` in the list; the venue conjunct is kept |
| `app.ack_waiter_call(uuid)`, `app.resolve_waiter_call(uuid)` (§2.1.8) | 0032:691, :702 | `'waiter'` in the guard, and a venue check past it (**PROPOSAL**): a call outside `app.staff_venue_ids()` is `CALL_NOT_FOUND`, for the cashier and MGMT too, then `set_config('app.venue_id', …)` |
| policy `touchpadel_rt_staff_topics` (§2.1.8, the same re-issue as above) | 0156:794-814 | the waiter on `floor` only, never `kds` |

- **No new RPC, argument, return key, error code or idempotency change.**
- **Audit and push.** The audit strings are unchanged (`set_staff_role` 0157 audits
  `staff.role_set`). There is no new push key: `teaching_new` simply reaches assistant baristas too.
- **Not re-issued:** `set_staff_role` (0157:66) and `save_checklist_template` (latest body
  0184:318). Both refuse only prep (0157:91-93; 0184:350-351).

#### 2.1.5 Migrations

| Migration | Depends on | Contents |
|---|---|---|
| `staff_roles_assistant_waiter` | – | the header, then `alter type staff_role add value if not exists 'assistant_barista';` and `… 'waiter';`, and nothing else |
| `assistant_barista_waiter_access` | `staff_roles_assistant_waiter` | the re-issues of §2.1.4 (the eleven of the roles, and the three waiter-call objects of §2.1.8), each re-checked at commit with the §2.10 command |

Fixtures:
- `rpc-allowlist.json` and the floor are unchanged, because no grant changes.
- `rls-matrix.ts` gets no new principal (its header says never restructure it). R's access commit
  appends three `drop: 18` rows that restate the waiter-call rules with the waiter and the venue
  check in their notes (`select waiter_calls`, `ack_waiter_call`, `resolve_waiter_call`).
- `assistant-coverage.json` needs no key.
- Regenerate `types.gen.ts` and the three map outputs.

#### 2.1.6 Every client copy of the role list (R's enum commit, one commit)

Adding to `STAFF_ROLES` breaks typecheck at the exhaustive switches (`homeRoute`,
`workspacesForRole`) and at every `tr(\`op.roles.${role}\`)` and `ws.owner.staff.roleAccess.*`
lookup. The parity test also fails the moment the enum and any copy differ.

| File | Change |
|---|---|
| `packages/core/src/staff/roles.ts:30` `STAFF_ROLES` | append `'assistant_barista', 'waiter'` (enum order) |
| same file, `:54` `HIREABLE_ROLES` | **PROPOSAL** order: cashier, waiter, court_desk, manager, head_barista, barista, assistant_barista, head_chef, chef, driver, marketing. `CHECKLIST_ROLES`, `OWNER_STEP_ROLES` and the hiring role field follow it |
| same file, `:179` `teamOf`, `:193` `TEAM_HEAD` | `assistant_barista` → `'bar'`; the comment at :171 says he joined |
| `packages/core/src/staff/roles.test.ts` | order, HIREABLE, `teamOf('assistant_barista') === 'bar'`, `teamOf('waiter') === null` |
| `packages/db/supabase/functions/_shared/auth.ts` `StaffRole`; `staff-admin/role.ts` `ROLES` | append both (the owner creates the accounts) |
| `apps/operator-shell/src/ipc-channels.ts`, `op/ipc/bridge.ts` `Role` | append both |
| `op/lib/auth.tsx:232` `ROUTE_ROLES['/kds']` | add `assistant_barista` |
| `op/lib/auth.tsx:262` `ROUTE_ROLES['/tasks']` | add both (every non-MGMT hireable role, contracts §5.1) |
| `op/lib/auth.tsx:410` `homeRoute` | `assistant_barista` → `/kds`; `waiter` → `/tasks` |
| `op/lib/workspaces.ts` `workspacesForRole` | `assistant_barista` → `['prep']` (the board); `waiter` → `['team']` |
| `op/features/admin/staff/staffModel.ts` `ASSIGNABLE_ROLES` | **PROPOSAL** order: cashier, waiter, court_desk, head_barista, barista, assistant_barista, head_chef, chef, driver, marketing, manager, owner (`hirePrefill.ts` follows) |
| `op/features/floor/floorModel.ts` `roomForRole` | `assistant_barista` → `'bar'`; `waiter` → `'floor'` (**PROPOSAL**) |
| `op/routes/__root.tsx` `ROLE_ORDER` | **PROPOSAL**: driver, marketing, waiter, assistant_barista, barista, chef, head_barista, head_chef, prep, … |
| `marketingStaffLogic.test.ts:70`, `roleExtrasLogic.test.ts:30` | both use `'waiter'` as the *unknown* role; switch to `'sommelier'` (the `roles.test.ts` convention) |
| `packages/i18n/src/catalogs/{en,ar}.ts` `op.roles`; `ws/owner.{en,ar}.ts` `staff.roleAccess` | §4.2 |
| `packages/db/fixtures/staff-roles.sql` | `…00000000000e` `assistant-barista@dev.touch.local`, `…00000000000f` `waiter@dev.touch.local` |

- **The guard mirrors** ship in R's access commit, after wave 4 lands their files:
  - `op/lib/auth.tsx` `CAPABILITY_ROLES.readTeachings` and `.readRecipes` gain
    `'assistant_barista'` (wave 4's fix moved `phoneSectionsFor` onto `can()`, 5161003), with
    `auth.test.ts` updated; `readShoppingList` is not widened, so the shopping section stays the
    bar and kitchen heads' and staff's;
  - `mob/src/features/staff/teachings/logic.ts` `TEACHING_ROLES` and
    `mob/src/features/staff/recipes/logic.ts` `RECIPE_ROLES` gain `'assistant_barista'`, and the
    Today rows follow them.
- **`docs/design/assistant/pages.md`.** The Team line (":35") and the kitchen-staff list (":103")
  name both roles.
- **The operator release rule.** `op/lib/roleResolution.ts:85` maps `unknown_role` to `revoked`, so
  every operator build before R shows "no access" to either role. The phone maps an unknown role to
  `unsupported` (`mob/src/features/staff/status.ts:116`). So the order is:
  1. the migrations reach hosted;
  2. the next operator tag is installed on every station;
  3. only then does the owner give Hussein and Hasan their roles (§7.3).

  The staff phone has not shipped yet, so R must be in the first store build.

#### 2.1.8 The waiter answers guests' "call a waiter" (§8 Q3, answered 2026-09-25)

Majed: Hasan answers guests' calls. He still gets no till and no kitchen board.

- **Server (R's access migration, `assistant_barista_waiter_access`).** `waiter` joins, each from
  its latest body: the `waiter_calls_staff_read` policy (0136:125, venue conjunct kept);
  `app.ack_waiter_call` and `app.resolve_waiter_call` (latest bodies: grep both create spellings;
  0032:691-710 per Q3); the `floor` topic in `touchpadel_rt_staff_topics` (the guarded DO block,
  latest 0156:794-814), so `rt_waiter_call`'s broadcast (0033) reaches him. He reads the table
  label the call names (`cafe_tables` read for the waiter if the latest policy excludes him). No
  money, tab or order read comes with it: 0161's four order-side policies stay closed to him.
  As built: the latest `cafe_tables_staff_read` (0156:679) already admits any staff at the venue,
  so it is not re-issued. The two RPCs gain a venue check 0032 never had (**PROPOSAL**, for
  Majed): another venue's call is `CALL_NOT_FOUND` to everyone, the cashier and MGMT included.
- **Push (P, `staff_push_keys_wave5` + the send-push copy, §2.3).** A new key `waiter_call_new`
  to the venue's active waiters when a call is raised (title only, with the table label; no
  guest identity), deduplicated per call. The guest cooldown (`set_waiter_call_cooldown`, 0052)
  still limits how often a table can call.
- **Phone (R's UI part, after the impeccable pass).** `mob/app/staff-calls.tsx`: open calls with
  table, reason and age, newest first, live on the `floor` topic; "On my way" (`ack`) and "Done"
  (`resolve`), keyed per call and action; a Today row with the open count. The cashier and managers
  keep answering on the till as today; whoever acts first wins, and the other screen updates live.
- **Tests (R).** The waiter reads, acks and resolves a call at his venue, not another venue's;
  sees no tab, order or payment; receives the `floor` broadcast; the driver and marketing still
  cannot. `waiter_call_new` reaches waiters only.

### 2.2 Size and add-on renames through a price change — lane N

#### 2.2.1 Every writer of a size or add-on name

| Name | Writer (latest body) | Reached by a manager today? |
|---|---|---|
| `menu_item_variants.name_en/_ar` | `app.upsert_variant` 0177:707 (lock :743-756; compares **price only**, :750) → `upsert_variant_internal` 0172:419 | yes: a rename passes |
| same, Stock ▸ Products | `app.upsert_retail_variant` 0145:132 calls the **public** `upsert_variant` (:201) and renames the retail ingredient from the size name (:205-206) | yes, through that call |
| `modifiers.name_en/_ar` | `app.upsert_modifier` 0177:982 (lock :1002-1016; a rename passes, comment :976-977) → `upsert_modifier_internal` 0177:770 | yes |
| release drafts | the `product_release` hooks through the internals | no |

#### 2.2.2 The manager refusal: `PRICE_VIA_PROTOCOL`, hint `name` (**PROPOSAL**)

- **Reuse the code.** It is already mapped in operator 0.2.20 (`op/lib/errors.ts:227`), so an old
  station shows a real sentence. The compulsory add-on lock set the same-code-plus-hint precedent
  (`addonsLogic.ts:134` `isRequiredAddonRefusal`).
- **Reword the string** in W0 (§4.2), so the meaning stays one: "this changes through a price or
  promotion change".
- **`upsert_variant`**, re-issued from 0177:707. The check sits inside the existing manager block,
  for a non-draft item (`launched_at is not null or is_active`) and an existing size:
  1. the price check first, unchanged (no hint);
  2. then `if btrim(p_name_en) is distinct from btrim(v.name_en) or btrim(p_name_ar) is distinct from btrim(v.name_ar) then raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001', hint = 'name';`

  A whitespace-only difference is not a rename; a case change is. Default and order still pass. The
  draft exception and `ITEM_IN_RELEASE` are unchanged. `upsert_retail_variant` is not re-issued: the
  lock reaches it through its call.
- **`upsert_modifier`**, re-issued from 0177:982. It runs after the price and launch checks
  (:1008-1014) and before the snapshot (:1015). For a manager, when `v_launched` and the stored
  `price_delta_iqd > 0` and either btrimmed name differs, it raises `PRICE_VIA_PROTOCOL` hint `name`.
  **PROPOSAL** on scope:
  - a **free** launched option ("no ice") may still be renamed directly;
  - a never-launched hidden add-on stays the manager's;
  - a group move that keeps its name is unchanged.
- **Check order is contract.** A price refusal carries no hint, so `price-promo.test.ts`'s existing
  cases hold. `required_addon` still wins for a save that keeps its name. The owner passes every
  lock.

#### 2.2.3 Record shapes: renames ride on the two existing change kinds (**PROPOSAL**)

| Kind | Added to the `propose` record | Normalised by the check |
|---|---|---|
| `price` | `renames?: [{variant_id, name_en, name_ar}]`, 0–12 entries. Each is a size of `menu_item_id`, named once. Both names are required, non-blank and at most 80 characters, and at least one language must differ from the stored name after `btrim`; otherwise `RECORD_INVALID` hint `renames`. A size may appear in `prices` and `renames` at once. The "something to do" rule becomes `prices + new_sizes + renames > 0` (hint `prices`) | each entry gains `before_en` and `before_ar` (the stored names at submit; a client copy is replaced) |
| `addon_price` | `renames?: [{modifier_id, name_en, name_ar}]`, 0–30 entries. Each is a **launched** add-on whose group is at the run's venue, named once, with the same text rules (hint `renames`). `addons` may then be absent or empty, but at least one of `addons` and `renames` must be non-empty (hint `addons`) | the same |

- Marketing may propose renames, because it may propose both kinds (contracts §2.8).
- A resubmission keeps the change and the target (0177:2451-2462), and its renames may change.
- **`numbers` never carries renames.** The owner approves the proposal's names or sends it back
  (contracts §0 Q12). `protocol_check_price_promo_numbers` is not re-issued: a rename-only run omits
  `prices`/`addons` at `numbers`, which it already allows.
- **In-flight runs:** a run proposed before the migration has no `renames` key. Every new branch
  reads `coalesce(…->'renames','[]')`.

#### 2.2.4 `price_promo_renames` (depends on 0177 only)

| Object | Latest | Change |
|---|---|---|
| `app.upsert_variant` | 0177:707 | the rename lock (§2.2.2) |
| `app.upsert_modifier` | 0177:982 | the rename lock |
| `app.protocol_check_price_promo_propose` | 0177:2296 | the `price` branch (:2338-2361): `renames` in the allowed keys, `app.price_promo_size_renames`, and the widened non-empty rule. The `addon_price` branch (:2385-2387): `renames`, with `addons` optional when renames exist |
| `app.price_promo_check_targets` | 0177:1908 | `price` (:1928-1958): each renamed size still belongs to the item, and its names equal `before_*`, else `PRICE_TARGET_CHANGED` hint `size:<variant_id>`. `addon_price` (:1960-1966): the same test, hint `addon:<modifier_id>`. No new hint |
| `app.price_promo_apply_internal` | 0177:2032 | `price`, after the price loop and the new sizes: lock each size row, then `upsert_variant_internal(item, name_en, name_ar, <its current price, or the new one>, id, is_default, sort_order)`. For a `shop` category item, also `update ingredients set name_en = left(btrim(item.name_en \|\| ' ' \|\| new_en), 200), name_ar = … where variant_id = <size> and kind = 'retail'` (the 0145:205-206 derivation). `addon_price`: lock the row, then `upsert_modifier_internal(group_id, name_en, name_ar, id, <current delta>, sort_order, is_active)`. `v_counts` gains `renamed`. The audit `protocol.price.apply` stays `{run_id, change, counts}` |
| `app.price_promo_numbers` | 0177:2891 | the return (:3125-3131) gains `renames: [{target: 'size'\|'addon', id, from_en, from_ar, to_en, to_ar, price_iqd}]` from the standing proposal. It is MGMT only, as today |
| new `app.price_promo_size_renames(jsonb, uuid) returns jsonb` | – | internal, `plpgsql stable security definer set search_path = public`, revoked from `public, anon, authenticated`; the `price_promo_sizes` pattern (0177:315) |
| new `app.price_promo_addon_renames(jsonb, uuid) returns jsonb` | – | the same, launched add-ons only; the `price_promo_addons` pattern (0177:393) |

- **Not re-issued:** `upsert_retail_variant`, the two internals, `protocol_check_price_promo_numbers`,
  `price_promo_targets` (0177:2747 already returns the names), `protocol_submit_price_promo_propose`
  and `upsert_menu_item`. Whole-**item** names are untouched (#59; OPEN §8 Q4).
- **#59 narrows.** A paid add-on that existed before the migration and was switched off can still be
  switched back on at its locked price by a manager, but no longer renamed.
- **Lock order.** The apply already holds `menu_items` for update (0177:2068), then takes the size
  rows. The `ingredients` UPDATE has a WHERE (`check:safeupdate`).
- **Coverage.** The two helpers are `"excluded: service_role only — an internal helper …"` (the
  0177 wording, `assistant-coverage.json:386, 393`). The allowlist and the floor are unchanged.

#### 2.2.5 Clients

- **Core** (`packages/core/src/protocols/`):
  - `steps.ts`: `PROPOSE_BY_CHANGE.price` gains `RENAMES` (`variant_id` uuid, `name_en`/`name_ar`
    text required ≤ 80, max 12). `addon_price` gains `ADDON_RENAMES` (max 30), and its `ADDONS`
    becomes `required: false, minItems: 0`;
  - `types.ts` (241-247): `renames?` on both record variants;
  - `validate.ts` (330-334): the non-empty rules;
  - `protocols.test.ts`: `names('price')` gains `renames`.
- **Operator locks:**
  - `menuLogic.ts` (241-275): the `onSale` lock also locks names. `VariantsEditor.tsx` shows a
    locked size's names as text and re-sends the stored names;
  - `productsLogic.ts`: `ProductLock.nameLocked = priceLocked`;
  - `addonsLogic.ts`: `AddonLock.nameLocked = !caps.editLaunchedPrices && launched && m.price_delta_iqd > 0`;
  - a new `isRenameRefusal(e)` sits beside `isRequiredAddonRefusal` and shows
    `ws.pricing.renameViaProtocol`.
- **Operator `/protocols`.** The `price` and `addon_price` rows gain a name pair, prefilled from
  `price_promo_targets`, and only changed rows are sent. The numbers form and the run sheet show
  "{from} → {to}". The form says: "A new name keeps this size's recipe and, unless you change it
  here, its price."
- **Operator `/tasks`** (marketing's start form). The same name pair goes on the price and
  add-on-price start. `priceLogic.ts` `startDraft` prefills it, `StartSheet.tsx:161` and
  `StepFormFields.tsx` render it, and `formModel.ts` sends only the changed rows. `fieldLabels.ts`
  maps the new fields to `ws.team.tasks.form.field.{renames,renames_name_en,renames_name_ar}`.
- **Phone.** `staff-start.tsx`'s price forms (marketing, MGMT) get the same fields.
  `mob/src/features/staff/protocols/logic.ts` prefills them next to `prices` and `addons`
  (:274-293). The new `renames.variant_id` and `renames.modifier_id` join `PRICE_PROPOSE_HIDDEN`
  (:210). `labels.ts` maps the labels (`staff.protocols.field.*`, beside :80-81), and
  `FormFields.tsx` renders the pair. `staff-step.tsx` shows the renames on `numbers` and `apply`.
  `useStepReads.ts`'s `price_promo_numbers` read gains the key.
- **Old clients** never send `renames`. The one risk is the owner deciding on an old operator,
  whose numbers sheet does not show renames (§7.3).

### 2.3 Wave-5 push keys (shared; lane P owns `notify_staff` for the wave)

Eleven title keys (the eleventh, `waiter_call_new`, added for §8 Q3 on 2026-09-25, §2.1.8). No kind and no route is added, so `mob/src/features/staff/pushRoutes.ts` and the
tap handling do not change. Every key opens Today (route `staff`), with `id` null.

| title_key | kind | To | params | EN title / body | AR title / body (draft for review) |
|---|---|---|---|---|---|
| `deduction_proposed` | `staff_decide` | `app.staff_ids_with_roles(venue,'{manager,owner}')` minus the person (`notify_staff` already skips the caller, 0169:86); dedupe `deduction:<proposer>` | `name` (the proposer) | Pay deduction / {name} proposed a deduction. | خصم من الراتب / اقترح {name} خصماً. |
| `deduction_approved` | `staff_decided` | the proposer | – | Deduction approved / Your proposal was approved. | تمت الموافقة على الخصم / تمت الموافقة على اقتراحك. |
| `deduction_declined` | `staff_decided` | the proposer | – | Deduction declined / Your proposal was declined. | رُفض الخصم / رُفض اقتراحك. |
| `deduction_recorded` | `staff_info` | the person (**PROPOSAL**, OPEN §8 Q6) | – | Pay deduction / A deduction was added to your record. | خصم من الراتب / أُضيف خصم إلى سجلّك. |
| `incident_reported` | `staff_task` | MGMT at the venue (`'{manager,owner}'`) | `name` (the reporter), `step` (the kind's `{en, ar}` label) | Incident report / {name}: {step} | بلاغ حادثة / {name}: {step} |
| `incident_reviewed` | `staff_info` | the reporter | `step` | Incident reviewed / {step} | تمت مراجعة البلاغ / {step} |
| `content_submitted` | `staff_decide` | the owners at the venue (`'{owner}'`); dedupe `content:<id>` | `name`, `title` | Content for approval / {name}: {title} | محتوى بانتظار الموافقة / {name}: {title} |
| `content_approved` | `staff_decided` | the version's submitter and the author (deduplicated) | `title` | Content approved / {title} | تمت الموافقة على المحتوى / {title} |
| `content_changes` | `staff_decided` | the same | `title` | Changes asked / {title} | طُلبت تعديلات / {title} |
| `content_declined` | `staff_decided` | the same | `title` | Content declined / {title} | رُفض المحتوى / {title} |
| `waiter_call_new` | `staff_task` | the venue's active waiters (`app.staff_ids_with_roles(venue,'{waiter}')`), from an `after insert` definer trigger on `waiter_calls`; dedupe `waiter_call:<id>` | `table` (the table's label) | Guest call / Table {table} | نداء زبون / طاولة {table} |

- **P's `send-push` commit** (no migration) is wave 5's first commit (§1.4 #1).
  - `send-push/staffStrings.ts` gains the eleven keys in EN and AR (a `{table}` param if the
    template helper does not already pass unknown params through).
  - `send-push-staff.test.ts` becomes "every JSON key has copy, and so does each wave-5 key" (the
    J pattern, contracts §2.24.1).
  - The JSON is untouched, so `staff-push.test.ts` stays green.
  - It is deployed (`functions-deploy.yml`) before any push that carries `staff_push_keys_wave5`.
    An unknown `title_key` is terminal in the deployed function (contracts §1.6).
- **`staff_push_keys_wave5`:**
  - re-issues `app.notify_staff(uuid[], text, jsonb, text)` verbatim from 0169:26-96;
  - changes only `c_title_keys`: the eleven keys are appended after `marketing_request_answered`,
    in the table's order; the `waiter_calls` insert trigger that sends `waiter_call_new` ships in
    this migration too (definer, `set search_path`, never raises into the guest's insert);
  - in the same commit, `_shared/staff-push.json` `title_keys` gains the same eleven, in the same order,
    and `send-push-staff.test.ts` returns to equality (36 keys).
- **The params rule** (contracts §2.21): only `name`, `title` and `step`. No amount, no reason, no
  description, no place free text, no people, and never the name of the person a deduction is
  against. `incident_reported`'s `step` comes from a SQL `case` over the five kinds, and a test pins
  it to `work.incident.kind.*` (§4).

### 2.4 Staff media for wave 5: `staff_media_incidents` (shared; lane P)

- **Folders.** `incidents` joins the nine (the regex at 0170:97-101). The steps follow 0170:58-87:
  - drop `staff_media_uploads_folder_check` and `staff_media_uploads_path_chk`, scoped by `conrelid`
    (confirm the auto-generated name in `pg_constraint` first);
  - add both back `not valid` with ten folders;
  - validate them inside the guard.
- **`app.is_staff_media_path(text)`** is re-issued from 0170:97 with the ten-folder regex. It stays
  `language sql immutable` with **no SET clause** (M1), keeps its grants to `anon`, `authenticated`
  and `service_role`, and never raises. `staff_media_venue` and `staff_media_folder` call it, so only
  their comments change.
- **`app.staff_media_slot`** is re-issued from 0170:116 and accepts `incidents`.
- **`app.staff_media_visible`** is re-issued from 0170:298-392. Every existing rule is kept, and the
  uploader and MGMT at the venue still see everything else (0170:317-319). One `used_by` kind joins,
  behind `to_regclass('public.marketing_content')`:

  | `used_by` | Readable by |
  |---|---|
  | `marketing_content:<content_id>` | the uploader, marketing and the owners at the content's venue, and **not** managers (**PROPOSAL**, Q14, V4). This branch runs **before** the uploader-or-MGMT return at 0170:317-319, so it answers for these objects alone. An unclaimed slot (`used_by` null) keeps today's rule |
  | `incident:<id>` | the uploader and MGMT only. A kind the function does not name falls to that default (0170:345-347, :385), so no branch is written |

- **Not touched:** `staff_media_insert` and `staff_media_read` (it already asks
  `staff_media_visible`), and `app.claim_staff_media` (each record claims under its own id).
  `staff_media_delete` is re-issued (0164's guarded shape) with
  `and app.staff_media_folder(name) is distinct from 'incidents'`: a manager could delete a filed
  report's photo, one naming them included. Those photos go only by redaction or the purge,
  through the service role (F8).
- **Client twins, in the same commit:**
  - `PHOTO_FOLDERS` (`packages/core/src/protocols/types.ts`);
  - `PhotoFolder` (`mob/src/features/staff/photo.ts:37`);
  - `FOLDERS` (`packages/db/tests/staff-media-folders.test.ts:186`);
  - `STAFF_MEDIA_PATH_RE` (`packages/db/supabase/functions/protocol-action/logic.ts:29-30`). It is a
    function file, so it deploys with functions-deploy, and the regex only widens.
- If Majed later wants another photo kind in wave 5, it folds into this migration before it commits.

### 2.5 Salary deductions — lane P

**Grounding.**
- **Nothing to join to.** There is no pay, salary or deduction data anywhere. Only the 0072 wage
  advance (`staff_requests.amount_iqd`, 0072:37, :76-83) and stock "deduction" exist.
- **Not a fifth `staff_requests` kind.** Staff requests reach the owner assistant:
  `staff_requests_page` is an assistant tool (0109:1009-1011), and the index copies each request's
  amount and note (0110:292-303, trigger 0110:518-521).
- **Hence a table of its own**, with no tool, no index trigger and no readable columns.

#### 2.5.1 Table `salary_deductions`

```
salary_deductions
  id              uuid primary key default gen_random_uuid()
  venue_id        uuid not null references venues(id)
  staff_id        uuid not null references staff(id)          -- the person the deduction is against
  amount_iqd      iqd not null                                 -- 0002:26 domain
  deduction_date  date not null                                -- when it happened (shown; not the pay month)
  pay_month       date                                         -- PROPOSAL (V16): set on approval, the first day of the venue's business month at decided_at
  reason          text not null
  proposed_by     uuid not null references staff(id)
  proposed_at     timestamptz not null default now()
  status          text not null default 'waiting'
  decided_by      uuid references staff(id)
  decided_at      timestamptz
  decision_note   text
  cancelled_by    uuid references staff(id)
  cancelled_at    timestamptz
  cancel_reason   text
  check (amount_iqd between 1 and 2000000)                                           -- PROPOSAL cap (OPEN Q7)
  check (coalesce(length(btrim(reason)),0) > 0 and length(reason) <= 500)
  check (status in ('waiting','approved','declined','withdrawn','cancelled'))
  check (staff_id <> proposed_by)
  check ((status in ('approved','declined','cancelled')) = (decided_by is not null))
  check ((decided_by is null) = (decided_at is null))
  check (decided_by is null or (decided_by <> proposed_by and decided_by <> staff_id))
  check (decision_note is null or length(decision_note) <= 1000)
  check (status <> 'declined' or coalesce(length(btrim(decision_note)),0) > 0)
  check ((status = 'cancelled') = (cancelled_by is not null))
  check ((cancelled_by is null) = (cancelled_at is null))
  check (cancel_reason is null or length(cancel_reason) <= 1000)
  check (status <> 'cancelled' or coalesce(length(btrim(cancel_reason)),0) > 0)
  check (cancelled_by is null or cancelled_by <> staff_id)
  check ((pay_month is not null) = (status in ('approved','cancelled')))
  check (pay_month is null or pay_month = date_trunc('month', pay_month)::date)
Indexes (waiver line): (venue_id, status, proposed_at); (venue_id, staff_id, deduction_date); (venue_id, pay_month).
RLS: select for MGMT at the venue. No other policy.
```

- **A record, not payroll** (**PROPOSAL**). The owner pays outside the system and reads the month
  view. Nothing is marked "applied" or "paid" (OPEN §8 Q9).
- **The pay month is the month of approval** (**PROPOSAL**, OPEN §8 Q9, V16). `decide_deduction`
  stamps `pay_month = date_trunc('month', app.venue_business_date(venue, now()))::date` on approval,
  and a cancel keeps it. `deduction_date` stays "when it happened". Take a head who proposes on the
  30th, and a manager who approves on the 2nd after the owner has paid from last month's view. The
  deduction then lands in the new month's pay, which is still open, and not in the month already
  paid. A row whose `deduction_date` falls in an earlier month than its `pay_month` carries
  `dated_earlier: true` in every read.
- **Immutable once proposed** (0072:14-19):
  - the proposer withdraws rather than edits;
  - a decision is one-way;
  - an approval made in error is **cancelled** by the owner with a reason, and the row stays
    (**PROPOSAL**).
- **Who proposes** (**PROPOSAL**, OPEN §8 Q5):
  - **HEADS:** any active member at the venue whose `app.staff_team(role)` equals the head's team,
    excluding head roles and themselves. With R, Bareq proposes for barista and assistant_barista,
    and Rusul for chef;
  - **MGMT:** any active non-owner at the venue except themselves.
- **Who decides:** any manager or owner at the venue **except** the proposer and the person. This is
  enforced by the CHECKs and by `CANNOT_DECIDE_OWN`. With nobody else there, it stays waiting
  (0072:25-27).
- **Limits** (**PROPOSAL**, OPEN §8 Q7):
  - 1 to 2,000,000 IQD (`INVALID_AMOUNT`);
  - `deduction_date` from 60 days before the venue's business date up to that date
    (`app.venue_business_date`, 0165:182; `INVALID_ARGUMENT` hint `date`).

#### 2.5.2 Who sees what (**PROPOSAL**, OPEN §8 Q6)

| Who | Sees |
|---|---|
| The person | their own **approved** and **cancelled** rows: amount, date, reason, status, when decided, and the month's approved total. Not waiting, declined or withdrawn rows, not the proposer, not the decision note, not the cancel reason |
| The proposing head | their own proposals, every status: the person's name, amount, date, reason, status and the decision note. No totals |
| MGMT at the venue | everything, with the month view, but a deduction against themselves: that one they read only as the person (F6) |
| Anyone else, and the owner assistant or any LLM | nothing |

#### 2.5.3 RPCs

All are `security definer set search_path = public`, `revoke all … from public, anon; grant execute
… to authenticated`.

| RPC | Args | Returns | Guard (first) | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `deduction_targets` | `p_venue_id uuid default null` | `{staff: [{id, display_name, role}]}` by name: HEADS get their non-head team members; MGMT get every active non-owner but themselves | subset DEDUCT, then `is_staff_at` | `FORBIDDEN` | – | – |
| `propose_deduction` | `p_staff_id uuid, p_amount_iqd bigint, p_date date, p_reason text, p_venue_id uuid default null, p_idempotency_key text default null` | `{id, status:'waiting'}` | subset DEDUCT; `set_config`; `claim_replay(key,'propose_deduction')` | `FORBIDDEN` (hint `staff_id`: not among the caller's targets), `INVALID_AMOUNT`, `INVALID_ARGUMENT` (hint `date`), `TEXT_REQUIRED`/`TEXT_TOO_LONG` (hint `reason`) | yes | `staff.deduction.propose`, entity `salary_deduction`, after `{status}` (never `staff_id`: the audit log is assistant-readable, §2.0, V17) |
| `withdraw_deduction` | `p_id uuid` | `{status:'withdrawn'}` | ANY; lock the row; another venue → `REF_NOT_FOUND`; not the proposer → `FORBIDDEN` | `REF_NOT_FOUND`, `FORBIDDEN`, `SUBMISSION_DECIDED` | – | `staff.deduction.withdraw` `{status}` |
| `decide_deduction` | `p_id uuid, p_approve boolean, p_note text default null` | `{status, decided_at, pay_month}` (`pay_month` null on a decline) | ANY; lock; `REF_NOT_FOUND`; `is_staff_at(row.venue,'manager','owner')` | `REF_NOT_FOUND`, `FORBIDDEN`, `SUBMISSION_DECIDED`, `CANNOT_DECIDE_OWN`, `REASON_REQUIRED` (decline), `TEXT_TOO_LONG` | – | `staff.deduction.approve` / `.decline` `{status}` |
| `cancel_deduction` | `p_id uuid, p_reason text` | `{status:'cancelled', cancelled_at}` | ANY; lock; `REF_NOT_FOUND`; `app.is_staff('owner')` (**PROPOSAL**) | `REF_NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION` (not approved), `REASON_REQUIRED`, `TEXT_TOO_LONG`, `CANNOT_DECIDE_OWN` | – | `staff.deduction.cancel` `{status}` |
| `deductions_page` | `p_venue_id uuid default null, p_filter text default 'waiting', p_limit int default 50, p_offset int default 0` | `{deductions:[{id, staff_id, staff_name, staff_role, amount_iqd, deduction_date, pay_month, dated_earlier, reason, status, proposed_by_name, proposed_by_role, proposed_at, decided_by_name, decided_at, decision_note, cancelled_by_name, cancelled_at, cancel_reason, can_decide, can_cancel}], waiting_count, total}`: waiting first, then newest; limit 1–200 | subset MGMT at the venue | `FORBIDDEN`, `INVALID_ARGUMENT` (filter not `waiting\|decided\|all`) | – | – |
| `deductions_month` | `p_venue_id uuid default null, p_month date default null` (NULL means the venue's current business month) | `{month, totals:{approved_iqd, approved_count, waiting_iqd, waiting_count, people}, people:[{staff_id, display_name, role, is_active, approved_iqd, approved_count, waiting_iqd, waiting_count, deductions:[{id, amount_iqd, deduction_date, dated_earlier, reason, status, proposed_by_name, decided_by_name, decided_at}]}]}`. It shows the approved and cancelled rows whose `pay_month` is the month, and cancelled rows are in no total. Waiting rows have no pay month yet, so they appear only in the current month's view, as "waiting" | subset MGMT | `FORBIDDEN` | – | – |
| `my_deduction_proposals` | `p_venue_id uuid default null, p_limit int default 30` | `{proposals:[{id, staff_name, staff_role, amount_iqd, deduction_date, reason, status, proposed_at, decided_at, decision_note}]}`, 1–100 | subset DEDUCT | `FORBIDDEN` | – | – |
| `my_deductions` | `p_venue_id uuid default null, p_month date default null` | `{month, total_iqd, deductions:[{id, amount_iqd, deduction_date, dated_earlier, reason, status, decided_at}]}`: the caller's own approved and cancelled rows whose `pay_month` is the month | ANY at the venue (driver and marketing included) | `FORBIDDEN` | – | – |

**Pushes** (§2.3):
- propose → `deduction_proposed`;
- approve → `deduction_approved` to the proposer, and `deduction_recorded` to the person;
- decline → `deduction_declined`;
- withdraw and cancel push nothing (**PROPOSAL**).

**Money rules:**
- coverage `salary_deductions`: `"excluded: staff pay deductions, money about a named person; never
  readable by the owner assistant or any LLM"`;
- the nine RPCs are `map:action`, and the route `/deductions` is `map:page`, whose `pages.md`
  sentence carries no figures;
- audit payloads carry `{status}` only, with `reason_code` null. They never carry `staff_id`: the
  entity id already names the (excluded) row, and `audit_log.after` is readable by the assistant
  when named (§2.0, V17);
- SEC-29 gains `/deduction/i`;
- `notification_outbox.profile_id` and `payload` leave `app.assistant_readable_columns`: the
  `deduction_recorded` row's recipient, beside the approval's audit row, would name the person
  (F7);
- the wage-advance path (0109, 0110) is unchanged (OPEN §8 Q10).

### 2.6 Incident reports — lane P

#### 2.6.1 Table `incident_reports`

```
incident_reports
  id               uuid primary key default gen_random_uuid()
  venue_id         uuid not null references venues(id)
  kind             text not null check (kind in ('accident','injury','fight','damage','other'))    -- PROPOSAL (OPEN Q13)
  occurred_at      timestamptz not null
  place            text not null check (place in ('court','cafe','shop','outside','other'))         -- PROPOSAL (OPEN Q13)
  court_id         uuid references courts(id)
  place_detail     text check (place_detail is null or length(place_detail) <= 120)
  description      text not null check (coalesce(length(btrim(description)),0) > 0 and length(description) <= 2000)
  people_involved  text check (people_involved is null or length(people_involved) <= 1000)
  photos           text[] not null default '{}' check (cardinality(photos) <= 6)                -- folder incidents
  reported_by      uuid not null references staff(id)
  reported_at      timestamptz not null default now()
  status           text not null default 'open' check (status in ('open','reviewed'))
  reviewed_by      uuid references staff(id)
  reviewed_at      timestamptz
  review_note      text check (review_note is null or length(review_note) <= 1000)
  purge_after      timestamptz not null default now() + interval '365 days'                       -- PROPOSAL (OPEN Q12)
  text_purged_at   timestamptz
  photos_purged_at timestamptz
  check ((place = 'court') = (court_id is not null))
  check ((status = 'reviewed') = (reviewed_by is not null))
  check ((reviewed_by is null) = (reviewed_at is null))
  check (status <> 'reviewed' or text_purged_at is not null or coalesce(length(btrim(review_note)),0) > 0)
  check (reviewed_by is null or reviewed_by <> reported_by)
Indexes (waiver): (venue_id, status, reported_at desc); (purge_after) where text_purged_at is null.
RLS: select for MGMT at the venue. No other policy.
```

- **No guest link column, on purpose** (**PROPOSAL**). It has no `guest_id`, `profile_id`,
  `customer_id`, phone or reservation id. SEC-20 discovery (`LINK_COLUMNS`,
  `stored-fields.test.ts:81`) therefore does not see it, and `delete_my_account` cannot follow it.
  Erasure is by retention and redaction instead, declared in a new `UNLINKED_PERSONAL` (§2.12).
- **Immutable once filed.** There is no withdraw and no edit, and a correction goes in the
  reviewer's note (OPEN §8 Q12).
- **Who reports:** ANY role at the venue (**PROPOSAL**, OPEN §8 Q11).
- **Who reviews:** MGMT at the venue except the reporter (`CANNOT_DECIDE_OWN`), and the review needs
  a note.
- **Field rules:**
  - `occurred_at` from 7 days ago to 10 minutes ahead (`INVALID_ARGUMENT` hint `occurred_at`);
  - `court_id` must be a court at the venue (`REF_NOT_FOUND` hint `court_id`);
  - a court sent for another place is `INVALID_ARGUMENT` hint `court_id`.

  The phone reads courts directly (any signed-in user, 0156:724-725).

#### 2.6.2 RPCs and internals

| RPC | Args | Returns | Guard (first) | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `submit_incident` | `p_kind text, p_occurred_at timestamptz, p_place text, p_description text, p_court_id uuid default null, p_place_detail text default null, p_people_involved text default null, p_photos text[] default '{}', p_venue_id uuid default null, p_idempotency_key text default null` | `{id}` | ANY at the venue; `set_config`; `claim_replay(key,'submit_incident')` | `FORBIDDEN`; `INVALID_ARGUMENT` (hints `kind`, `place`, `occurred_at`, `court_id`, `photos`); `REF_NOT_FOUND` (`court_id`); `TEXT_REQUIRED` (`description`); `TEXT_TOO_LONG` (`description`, `people_involved`, `place_detail`); `PHOTO_PATH_INVALID` (claimed `incident:<id>`, folder `incidents`, after the insert) | yes | `incident.report`, entity `incident_report`, after `{kind, place, court_id, photos: n}` |
| `review_incident` | `p_id uuid, p_note text` | `{status:'reviewed', reviewed_at}` | ANY; lock; `REF_NOT_FOUND` across venues; `is_staff_at(venue,'manager','owner')` | `REF_NOT_FOUND`, `FORBIDDEN`, `SUBMISSION_DECIDED`, `CANNOT_DECIDE_OWN`, `TEXT_REQUIRED`/`TEXT_TOO_LONG` (hint `note`) | – | `incident.review` `{status}` |
| `redact_incident` (**PROPOSAL**) | `p_id uuid` | `{text_purged_at}` | ANY; lock; `REF_NOT_FOUND`; `app.is_staff('owner')` | `REF_NOT_FOUND`, `FORBIDDEN` | state-idempotent | `incident.redact` `{}` → `{redacted:true}` |
| `my_incidents` | `p_venue_id uuid default null, p_limit int default 30` | `{incidents:[{id, kind, occurred_at, place, court_id, court_name_en, court_name_ar, place_detail, description, people_involved, photos, status, reviewed_by_name, reviewed_at, review_note, redacted}]}`: the caller's own, 1–100; the reporter sees the review note | ANY at the venue | `FORBIDDEN` | – | – |
| `incidents_page` | `p_venue_id uuid default null, p_filter text default 'open', p_limit int default 50, p_offset int default 0` | `{incidents:[<my_incidents row> + {reported_by_name, reported_by_role, reported_at, can_review, can_redact}], open_count, total}` | subset MGMT | `FORBIDDEN`, `INVALID_ARGUMENT` (filter not `open\|reviewed\|all`) | – | – |
| `app.incident_purge_due()` | – | `{incidents}` | none (cron, database owner; audit shows System) | – | – | `incident.purge`, counts only |
| `app.incident_photo_purge_due(p_limit int default 20)` | – | `[{incident_id, paths}]` (rows with `purge_after <= now()`, `photos_purged_at is null`, photos present) | `service_role` grant only | – | – | – |
| `app.incident_photos_purged(p_id uuid)` | – | void: `photos_purged_at = now()`, `photos = '{}'` | `service_role` grant only | – | – | – |
| `app.staff_media_orphan_purge_due(p_limit int default 50)` (F9) | – | `["<path>", …]`: `incidents` and `campaigns` slots unclaimed a day on, oldest first, each marked `used_by 'orphan_purge'` (a later claim is `PHOTO_PATH_INVALID`) | `service_role` grant only | – | – | – |
| `app.staff_media_orphans_purged(p_paths text[])` (F9) | – | int: the held slots deleted once the tick removed their objects | `service_role` grant only | – | – | – |

- **The text purge.** `incident_purge_due` overwrites `description` with
  `'[deleted after 365 days]'` and nulls `people_involved`, `place_detail` and `review_note` (a
  marker rather than NULL, per 0176:586-592). It then stamps `text_purged_at`. The kind, place,
  court, `occurred_at` and the review stamps stay, so counts survive.
- **Redaction.** `redact_incident` does the same overwrite at once and sets `purge_after = now()`.
  The photos go at the next tick. No reason is stored, because the reason would itself name the
  person.
- **Cron.** `tp_incident_purge` runs at `50 3 * * *` with `select app.incident_purge_due();` (the
  guarded pg_cron block of 0176:657-673).
- **`app.protocol_tick_nudge`** is re-issued from 0173:642-677. Its "anything due" test also checks
  `exists (select 1 from incident_reports where purge_after <= now() and photos_purged_at is null and cardinality(photos) > 0)`.
- **The `protocol-action` tick** gains a third phase, run last, in the same commit:
  - `logic.ts` `tick()` (:240-280) loops over `ports.incidentPurgeDue()`, filters with
    `STAFF_MEDIA_PATH_RE`, then calls `removePhotos` and `markIncidentPurged`;
  - the phase is wrapped, so a missing function (functions-deploy beating db-migrate, PGRST202)
    only logs and counts `failed`;
  - `index.ts` `tickPorts` (:107-128) gains the two ports, and `TickResult` gains
    `incidents_purged`.
- **Pushes:** `incident_reported` on submit and `incident_reviewed` on review (§2.3). Only the kind
  goes on a lock screen.
- **LLM rule:**
  - coverage `incident_reports`: `"excluded: incident reports may name guests and describe injuries;
    never sent to the owner assistant or any LLM; purged 365 days after the report"`;
  - no tool and no index trigger;
  - SEC-29 gains `/people_involved/i`;
  - the writer is `submit_incident`, never `report_*`, because SEC-29 scans `report_*` as LLM-bound
    (`check-analytics-payload.mjs:82-87`).
- **The form's privacy hint** (`ws.incidents.form.privacyHint`, `staff.incidents.form.privacyHint`):
  "Write only what is needed. Do not add phone numbers."

### 2.7 Marketing content approval — lane P

**Why new tables** (**PROPOSAL**):
- **Not `marketing_requests` (0187).** That is staff asking marketing, with one answer and no
  rounds (0187:38-56).
- **Not `marketing_campaigns` (0073, 0168).** Its channel enum is `telegram | guest_site |
  in_venue` (0073:43), and its status is a send lifecycle (0073:408-465) that
  `set_campaign_status` and `marketing_overview` read. Slice 2 owns `marketing_overview`
  (0168:26-28).
- **Immutable versions.** The owner approves exactly one version, so each round is an immutable
  version row (the 0072:14-19 reason).
- **Links instead.** A content item may point at a campaign or a menu item.

#### 2.7.1 Tables

```
marketing_content
  id               uuid primary key default gen_random_uuid()
  venue_id         uuid not null references venues(id)
  author_id        uuid not null references staff(id)
  title            text not null check (coalesce(length(btrim(title)),0) > 0 and length(title) <= 120)
  channel          text not null check (channel in ('instagram','tiktok','facebook','snapchat','whatsapp',
                                                    'telegram','guest_site','in_venue','print','other'))   -- PROPOSAL (OPEN Q15)
  planned_for      date not null
  menu_item_id     uuid references menu_items(id) on delete set null
  campaign_id      uuid references marketing_campaigns(id) on delete set null
  status           text not null default 'waiting'
                   check (status in ('waiting','changes','approved','declined','withdrawn'))
  current_version  int not null default 1 check (current_version >= 1)
  decided_by       uuid references staff(id)
  decided_at       timestamptz
  created_at       timestamptz not null default now()
  updated_at       timestamptz not null default now()
  check ((status in ('approved','declined')) = (decided_by is not null))
  check ((decided_by is null) = (decided_at is null))
  check (decided_by is null or decided_by <> author_id)

marketing_content_versions
  id               uuid primary key default gen_random_uuid()
  content_id       uuid not null references marketing_content(id) on delete cascade
  version          int not null check (version >= 1)
  body             text not null check (coalesce(length(btrim(body)),0) > 0 and length(body) <= 4000)
  images           text[] not null default '{}' check (cardinality(images) <= 10)     -- folder campaigns
  media_link       text check (media_link is null or (length(media_link) <= 500 and media_link ~ '^https://[^[:space:]]+$'))
  note             text check (note is null or length(note) <= 1000)
  submitted_by     uuid not null references staff(id)
  submitted_at     timestamptz not null default now()
  superseded_at    timestamptz
  decision         text check (decision in ('approve','changes','decline'))
  decided_by       uuid references staff(id)
  decided_at       timestamptz
  decision_note    text check (decision_note is null or length(decision_note) <= 1000)
  unique (content_id, version)
  check ((decision is null) = (decided_by is null))
  check ((decided_by is null) = (decided_at is null))
  check (decision not in ('changes','decline') or coalesce(length(btrim(decision_note)),0) > 0)
  check (decided_by is null or decided_by <> submitted_by)
  check (not (superseded_at is not null and decision is not null))
Indexes (waiver): marketing_content (venue_id, status, planned_for);
  unique marketing_content_versions (content_id) where decision is null and superseded_at is null.
RLS (PROPOSAL, V4; owner-only, a departure from the contracts' MGMT default, because Q14 keeps
  managers out):
  marketing_content — using (app.is_staff('owner') and venue_id = any(app.staff_venue_ids())).
  marketing_content_versions — using (app.is_staff('owner') and exists (select 1 from marketing_content c
    where c.id = content_id and c.venue_id = any(app.staff_venue_ids())))   (the 0165:166-172 child form).
  grant select … to authenticated, as 0187:86. Marketing reads only through the definer RPCs below.
```

- **The state machine:**
  - `waiting` means the current version is undecided;
  - the owner's `approve` makes it `approved`, which is final (**PROPOSAL**, OPEN §8 Q16). Changing
    approved content means a new item, which "Send again" prefills;
  - `changes` makes it `changes`;
  - `decline` makes it `declined`, which is final;
  - in `waiting` or `changes`, marketing may send a new version: the open version gets
    `superseded_at`, `current_version` goes up by one, and the status is `waiting` again;
  - `withdrawn` (by marketing) is final.
- **Readers:** marketing at the venue sees the venue's whole queue, and the **owners** decide.
  Managers have no screen, no RPC read, no table read (the owner-only policies above) and no image
  read (§2.4) (**PROPOSAL**, OPEN §8 Q14; `/marketing` is owner-only, `op/lib/auth.tsx:252`). If
  Majed says managers may read, the two policies and the §2.4 branch change back to MGMT.
- **Video:** the bucket takes jpg, png and webp up to 5 MB (contracts §2.3). `media_link` (an
  `https://` link) covers a reel. It is shown as text with a copy button and never opened in the
  shell (OPEN §8 Q15).
- **Photos:** folder `campaigns`, claimed as `marketing_content:<content_id>`, so every version of
  one item re-uses a path. A path from another item is `PHOTO_PATH_INVALID`. The read rule is in
  §2.4. The form says "Ask anyone recognisable in a photo before it is posted"
  (`staff.content.form.consentHint`, `ws.content.form.consentHint`).

#### 2.7.2 RPCs

| RPC | Args | Returns | Guard (first) | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `submit_content` | `p_title text, p_channel text, p_planned_for date, p_body text, p_images text[] default '{}', p_media_link text default null, p_note text default null, p_menu_item_id uuid default null, p_campaign_id uuid default null, p_venue_id uuid default null, p_idempotency_key text default null` | `{id, version:1, status:'waiting'}` | subset `app.is_staff('marketing')` + `is_staff_at(v_venue,'marketing')` | `FORBIDDEN`; `TEXT_REQUIRED` (`title`, `body`); `TEXT_TOO_LONG` (`title`, `body`, `note`); `INVALID_ARGUMENT` (`channel`, `planned_for` before the business date, `media_link`, `images` > 10); `ITEM_NOT_FOUND`; `CAMPAIGN_NOT_FOUND`; `PHOTO_PATH_INVALID` | yes | `marketing.content.submit`, entity `marketing_content`, after `{status, version, channel, images: n}` |
| `revise_content` | `p_id uuid, p_body text, p_images text[] default '{}', p_media_link text default null, p_note text default null, p_title text default null, p_channel text default null, p_planned_for date default null, p_idempotency_key text default null` | `{id, version, status:'waiting'}` | ANY; lock; `REF_NOT_FOUND`; marketing at the venue; then `claim_replay` | as `submit_content` (a NULL header field keeps its value), plus `SUBMISSION_DECIDED` (not `waiting` or `changes`) | yes | `marketing.content.revise` `{version, status}` |
| `withdraw_content` | `p_id uuid` | `{status:'withdrawn'}` | ANY; lock; `REF_NOT_FOUND`; marketing at the venue | `REF_NOT_FOUND`, `FORBIDDEN`, `SUBMISSION_DECIDED` | – | `marketing.content.withdraw` |
| `decide_content` | `p_id uuid, p_version int, p_decision text, p_note text default null` | `{status, version, decided_at}` | ANY; lock; `REF_NOT_FOUND`; `app.is_staff('owner')` | `REF_NOT_FOUND`, `FORBIDDEN`, `SUBMISSION_DECIDED` (`p_version` is not the current open version), `INVALID_ARGUMENT` (`decision`), `REASON_REQUIRED` (`changes`, `decline`), `TEXT_TOO_LONG`, `CANNOT_DECIDE_OWN` | – | `marketing.content.approve` / `.changes` / `.decline` `{status, version}` |
| `content_page` | `p_venue_id uuid default null, p_filter text default 'waiting', p_limit int default 50, p_offset int default 0` | `{content:[{id, title, channel, planned_for, status, current_version, author_name, submitted_at, cover_image, menu_item_id, item_name_en, item_name_ar, campaign_id, campaign_name_en, campaign_name_ar, decided_by_name, decided_at, updated_at}], waiting_count, total}` | subset `app.is_staff('marketing','owner')` + `is_staff_at` | `FORBIDDEN`, `INVALID_ARGUMENT` (filter not `waiting\|changes\|approved\|closed\|all`) | – | – |
| `content_detail` | `p_id uuid` | `{content:{…}, versions:[{version, body, images, media_link, note, submitted_by_name, submitted_at, superseded_at, decision, decided_by_name, decided_at, decision_note}], can_decide, can_revise, can_withdraw}`, newest first | ANY; `REF_NOT_FOUND`; marketing or owner at the venue | `REF_NOT_FOUND`, `FORBIDDEN` | – | – |

- **Pushes:** `content_submitted` on submit and on revise; `content_approved`, `content_changes`
  or `content_declined` on a decision (§2.3).
- **Coverage.**
  - `marketing_content` is `table_read`, with readable-column rows for its own columns only (the
    0173:743-767 statement restricted to it). It holds a title, a channel, dates and a status,
    with no people.
  - `marketing_content_versions` is `"excluded: unpublished captions and images waiting for the
    owner; read on /marketing"`, because draft images may show guests.

### 2.8 Two stores (cafe, bakery), transfers, log stock, stock control — lane S

#### 2.8.1 Grounding

- **The ledger.** `stock_movements` is the append-only truth (0018:24-51, trigger
  `stock_movements_ao`). `stock_batches.qty_remaining` is the FEFO index (0017:113-126, with
  `check (qty_remaining >= 0)` at :120). Both carry `venue_id` (0126, 0127) and are read by MGMT at
  the venue (0136:139-146).
- **Consumption.** `app.consume_fefo` (0018:83, its only body) locks the live batches in FEFO order,
  `expiry_date asc nulls last, received_at asc`, **with no id tie-break** (0018:95-100). On a
  shortfall it writes one batch-less overdraft row and one `negative_stock` alert (0018:112-121), so
  a sale is never blocked. Its callers:
  - `consume_for_order_item` (0018:213) → `sale_consumption`;
  - `record_production_internal` (0167:38, :75) → `production_consume`;
  - `record_waste` (0049:356) → waste;
  - `protocol_submit_product_release_test` (0172:1112, :1133) → `product_test`.
- **Every other writer of batches or movements:** `finalize_count` (0044:301),
  `receive_delivery` (0145:242), `trg_order_item_voided` (0146:187), `trg_refund_restock`
  (0146:245) and `write_off_expired` (0115:624). `start_count` (0019:41) writes the count tables
  only.
- **Counts today.** `start_count` refuses while **any** count is open anywhere (0019:50), and
  snapshots every active ingredient with no venue filter (0019:56-61). `v_variance_report` (latest
  0172:1836) takes the period globally. The operator assumes one open count
  (`op/features/stock/stockKeys.ts:159` `maybeSingle`). No db test runs a count end to end.
- **Receiving.** `receive_delivery` has no venue check on its ingredients (0145:295).
  `receive_purchase` calls the public `receive_delivery` by name (0166:810).

#### 2.8.2 Design decisions

- **D1. A store is an enum** (**PROPOSAL**): `create type stock_location as enum ('cafe','bakery')`.
  - `add column location stock_location not null default 'cafe'` is a non-volatile default, stored
    as the column's missing value. There is no rewrite and no UPDATE, so the `stock_movements_ao`
    trigger never fires, and no CHECK has to be validated.
  - Verify on the local stack that `pg_class.relfilenode` of `stock_movements` and `stock_batches`
    is unchanged by the migration.
  - Both stores exist at every venue (one venue today). A third store would be an `add value` in its
    own file.
- **D2. A movement's store is its batch's store.** A BEFORE INSERT trigger,
  `stock_movements_location` → `app.trg_stock_movement_location()` (definer, internal), sets
  `new.location` from the batch whenever `batch_id` is not null, overriding the writer. A batch-less
  row keeps what the writer passed, or the default.
  - So `write_off_expired` and `trg_order_item_voided` are **not** re-issued. This is the 0018:10-16
    precedent: wire stock by trigger, not by patching RPC bodies.
- **D3. Which store each use draws from.** A new internal, `app.consume_fefo_at(p_location, …the
  eight consume_fefo args…)`, works in three steps:
  1. it first locks **all** live batches of the ingredient in one canonical order,
     `expiry_date asc nulls last, received_at asc, id asc` (`perform … for update`);
  2. it consumes the preferred store FEFO, then the other store;
  3. it overdraws only when the whole venue is short, with the batch-less row at the preferred store
     (the 0018:116 cost rule) and one `negative_stock` alert whose payload gains `location`.

  The canonical lock order prevents a new deadlock between a cafe-preferring sale and a
  bakery-preferring production. The `id` tie-break matters because transferred batches copy
  `expiry_date` and `received_at`. **Venue totals are unchanged**: until any stock sits in the
  bakery, the result is identical to today.

  | Use | Preferred store |
  |---|---|
  | Sale (cafe ticket, shop sale, guest web order) | cafe: `consume_fefo` becomes a wrapper, `consume_fefo_at('cafe', …)`. `consume_for_order_item` takes the whole order's ingredient locks first (F1) |
  | Production (`record_batch`, `record_production`) | bakery by default (**PROPOSAL**, OPEN §8 Q18); the output batch lands there too |
  | Waste (`record_waste`) | the named store, else the caller's home (`app.staff_home_location`) |
  | Product test | the submitter's home: bakery for head_chef and chef, otherwise cafe |
  | Expired write-off; void reclass; retail void restock | that batch's store (D2) |
  | Refund restock | the re-issued `trg_refund_restock` orders `(location <> 'cafe'), received_at desc, id desc` (today's `received_at desc, id desc` is at 0146:284, in the SELECT at 0146:281-286). The synthetic batch defaults to cafe. The restock's cost is the chosen batch's `unit_cost_iqd` (0146:296-299). So money is identical to today only while every live batch is in the cafe. After that, the restock is costed at the newest **cafe** batch, not the newest batch overall (V20) |

  **Availability, low stock and out of stock stay venue-wide** (**PROPOSAL**): an item is orderable
  when any store holds the ingredient. `trg_low_stock_alert` is re-issued only to return early on a
  `transfer` row, because a transfer never changes the venue's on-hand.
- **D4. Receive and log always name a store, with cafe as the default.** `receive_delivery` and
  `receive_purchase` gain `p_location text default null`. A new internal,
  `app.receive_delivery_internal`, holds 0145:242's body without the guard, claim and audit, and adds:
  - `venue_id` and `location` on the delivery, its batches and its movements;
  - `deliveries.source` (`goods_in` or `staff_log`);
  - `delivery_lines.cost_source`;
  - an ingredient-at-this-venue check (**PROPOSAL** tightening);
  - **shop (retail) stock is cafe-only** (V14). A `kind = 'retail'` line with location `bakery`
    raises `INVALID_ARGUMENT` hint `kind`. Transfers refuse shop products (D6), and the bakery count
    leaves them out (D7). A shop product booked into the bakery could therefore never be moved or
    counted there, and the next cafe count would book the same units a second time (the surplus
    branch, 0044:379-396). One check in the internal covers Goods in, `receive_purchase` and
    `log_stock` together;
  - **the count lock** (M5, V19): `pg_advisory_xact_lock_shared` on the store key, then
    `STORE_BEING_COUNTED` (hint = the store) when an operator count is in progress at that store. A
    waiting phone count does not block. So Goods in, a driver receipt and a staff log never add
    stock to a store in the middle of its count.

  `receive_purchase` still calls the public `receive_delivery` by name, now passing `p_location`, so
  its two audit rows are unchanged.
- **D5. The cost of logged stock** (**PROPOSAL**, OPEN §8 Q23). `app.stock_cost_estimate(ingredient)`
  takes the first of these that exists:
  1. the latest batch with `unit_cost_iqd > 0` → `cost_source 'last_batch'`. It uses the
     `received_at desc, id desc` tie-break of `v_item_cogs` (0019:255-256). Unlike `v_item_cogs`,
     which takes the latest batch whatever its cost, it deliberately skips zero-cost synthetic
     batches (a refund restock, a count surplus), so one of those never turns an estimate into 0
     (V21);
  2. otherwise `pack_cost_iqd / pack_size` → `'pack'`;
  3. otherwise 0 → `'none'`.

  The staff member never sees a cost. A manager corrects it with `price_logged_stock`, which
  revalues only what is on the shelf: the line, its batch and that batch's transfer descendants.
  Booked movements keep the estimate, and the audit keeps both costs. A `'none'` line nags in Setup
  "Worth checking".
- **D6. Transfers.** `transfer_stock` handles its lines **ordered by `ingredient_id`**, whatever
  order `p_lines` gives. This is the rule every stock writer that touches several ingredients has
  followed since 0044 (0044:263-264; the BOM at :293, the count at :348). For each ingredient it
  first takes the canonical lock pass over **all** live batches of that ingredient, in both stores
  (`expiry_date asc nulls last, received_at asc, id asc`, `for update`, as `consume_fefo_at` does).
  Only then does it touch any batch (V15). Without the order, a transfer of [milk, sugar] next to a
  latte sale, whose BOM gives sugar before milk, deadlocks (40P01). It then takes the source store's
  batches in FEFO order. Per slice of a source batch it:
  - reduces the source batch;
  - inserts a destination batch with the same ingredient, expiry, `received_at`, `unit_cost_iqd`
    and venue, `delivery_line_id null`, `origin_batch_id = coalesce(src.origin_batch_id, src.id)`,
    and `qty_received = qty_remaining = slice`;
  - writes **one movement pair**, `movement_type 'transfer'`, `reason_code 'transfer:<id>'`: −slice
    at the source and +slice at the destination.

  It refuses:
  - the whole transfer with `TRANSFER_SHORT` when the source store's batches hold less than a line
    (**PROPOSAL**; moving past the batches would create stock from nothing);
  - shop (retail) products;
  - any move while a manager's count is in progress at either store (`STORE_BEING_COUNTED`).
- **D7. Counts by store.**
  - `stock_counts` gains `location` and `source` (`operator` or `phone`). There is one count in
    progress or waiting per (venue, store), under the advisory lock
    `hashtextextended('stock_count:'||venue||':'||location, 0)`. `start_count` and
    `submit_stock_count` take it **exclusively**. `transfer_stock` and `receive_delivery_internal`
    take it **shared** on every store they touch, before their count check (M5). The internal is
    how `log_stock`, `receive_delivery` and `receive_purchase` all get it.
  - **`start_count(p_location, p_venue_id)`** snapshots only the venue's active ingredients, and
    the bakery count leaves shop products out.
  - **`submit_stock_count`** (phone) creates a count that is already waiting. It has lines only for
    the items typed, and it snapshots each line's theoretical quantity (the ledger sum at that
    store) at submit.
  - **`finalize_count`** reconciles at the count's store only. A shortage draws that store's
    batches in the canonical order, with the batch-less row at that store. A surplus tops up that
    store's newest live batch. Failing that, it creates one there costed like the newest live batch
    elsewhere, or at zero cost (**PROPOSAL**).
  - **`discard_count`** (MGMT) deletes an unapplied count.
  - **`v_variance_report`** partitions by (venue, store, ingredient) and appends `location` and
    `transfer_qty`.

#### 2.8.3 Data model (all in `stock_locations` unless marked)

```
create type stock_location as enum ('cafe','bakery');

stock_batches    + location        stock_location not null default 'cafe'
                 + origin_batch_id uuid   -- FK → stock_batches(id) on delete set null, NOT VALID then VALIDATE (guarded, conrelid)
stock_movements  + location        stock_location not null default 'cafe'    -- set from the batch by the D2 trigger
stock_counts     + location        stock_location not null default 'cafe'
                 + source          text not null default 'operator'
                                   -- stock_counts_source_chk check (source in ('operator','phone')) NOT VALID, then VALIDATE
deliveries       + location        stock_location not null default 'cafe'
                 + source          text not null default 'goods_in'
                                   -- deliveries_source_chk check (source in ('goods_in','staff_log')) NOT VALID, then VALIDATE
delivery_lines   + cost_source     text not null default 'entered'
                                   -- delivery_lines_cost_source_chk check (cost_source in ('entered','last_batch','pack','none')) NOT VALID, then VALIDATE

-- in stock_transfers (waiver: plain indexes on new, empty tables)
stock_transfers       id uuid pk default gen_random_uuid(), venue_id uuid not null references venues(id),
                      from_location stock_location not null, to_location stock_location not null,
                      moved_by uuid not null references staff(id), moved_at timestamptz not null default now(),
                      check (from_location <> to_location)
stock_transfer_lines  transfer_id uuid not null references stock_transfers(id) on delete cascade,
                      ingredient_id uuid not null references ingredients(id),
                      qty numeric(12,3) not null check (qty > 0),
                      primary key (transfer_id, ingredient_id)
index stock_transfers (venue_id, moved_at)
RLS: stock_transfers_mgmt_read (MGMT at the venue); stock_transfer_lines_mgmt_read (exists on the parent, MGMT).
No note column.

-- view (stock_locations): v_stock_by_location, security_invoker = on
  ingredient_id, venue_id, name_en, name_ar, unit, kind, location, on_hand (Σ qty_remaining > 0 at the store),
  theoretical (Σ qty_delta at the store), is_active — no cost column; base-table RLS makes it MGMT
```

- **No policy changes** on existing tables. The MGMT-at-venue policies (0136:134-156) cover the new
  columns.
- **No new index** on an existing table. `stock_batches_fefo` (0017:125) already narrows by
  ingredient.

#### 2.8.4 Internal functions (no grant; revoked from `public, anon, authenticated`)

| Function | Migration | Body |
|---|---|---|
| `app.staff_home_location(staff_role) returns stock_location` | `stock_locations` | head_chef, chef → `bakery`; every other role → `cafe`. **plpgsql** with `set search_path` (§2.0) |
| `app.parse_stock_location(text, stock_location) returns stock_location` | `stock_locations` | null or `''` → the default; `cafe`/`bakery` → cast; else `INVALID_ARGUMENT` hint `location`. plpgsql |
| `app.consume_fefo_at(stock_location, uuid, numeric, movement_type, uuid default null, uuid default null, uuid default null, text default null, text default null) returns void` | `stock_locations` | D3; `INVALID_QTY` as 0018:91-93; every row it inserts names `location` |
| `app.trg_stock_movement_location() returns trigger` | `stock_locations` | D2 |
| `app.receive_delivery_internal(uuid, stock_location, jsonb, text, text, text, uuid, text) returns jsonb` | `stock_locations` | D4; returns `{delivery_id, batch_ids}`; `EMPTY_DELIVERY`, `INGREDIENT_NOT_FOUND` (now also another venue's), `INVALID_LINE`, `INVALID_ARGUMENT` hint `kind` (a shop line at the bakery, V14), `STORE_BEING_COUNTED` (M5, V19); reads an optional per-line `cost_source` |
| `app.stock_cost_estimate(uuid, out unit_cost numeric, out cost_source text)` | `stock_logs` | D5 |
| `app.lock_stock_ingredients(uuid[]) returns void` | `stock_locations` | F1: `pg_advisory_xact_lock(hashtextextended('stock_ingredient:'\|\|id, 0))` per distinct id, in `ingredient_id` order. plpgsql |

#### 2.8.5 New RPCs

All are `security definer set search_path = public`, with the guard first. Client-callable ones get
`revoke … from public, anon; grant execute … to authenticated`. Once the venue is known, each runs
`set_config('app.venue_id', …)`.

| RPC (migration) | Args | Returns | Guard | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `transfer_stock` (`stock_transfers`) | `p_from text, p_to text, p_lines jsonb, p_venue_id uuid default null, p_idempotency_key text default null` | `{transfer_id, from, to, moved_at, lines:[{ingredient_id, qty}]}` (base unit; no cost) | MOVE at the venue | `FORBIDDEN`; `INVALID_ARGUMENT` (hint `location`: the same store or an unknown one; `lines`: empty, > 50, a repeat, not an object; `unit`; `kind`: a shop product); `INVALID_QTY` (≤ 0 or ≥ 1e9); `INGREDIENT_NOT_FOUND` (detail = id); `TRANSFER_SHORT` (hint = ingredient_id, detail = the quantity the source shows); `STORE_BEING_COUNTED` (hint = the store). Lines are processed by `ingredient_id`, each after a canonical lock pass (D6) | yes | `stock.transfer`, entity `stock_transfers`, after `{from, to, lines, batches}` |
| `log_stock` (`stock_logs`) | `p_location text default null, p_lines jsonb, p_note text default null, p_venue_id uuid default null, p_idempotency_key text default null` | `{delivery_id, location, lines:[{ingredient_id, qty, expiry_date}]}` (no cost) | LOG at the venue; the store per role (below) | `FORBIDDEN` (also hint `location`: the desk and the bakery); `INVALID_ARGUMENT` (hints `location`, `lines`, `unit`, `kind`, `expiry_date`); `INVALID_QTY`; `INGREDIENT_NOT_FOUND`; `TEXT_TOO_LONG` (`note`, 200); `STORE_BEING_COUNTED` (from the internal, M5). Lines are validated **before** the internal is called, including the shop-in-the-cafe rule (hint `kind`), so `EMPTY_DELIVERY` and `INVALID_LINE` never escape (M6) | yes | `stock.log`, entity `deliveries`, after `{location, lines, cost_sources:{last_batch, pack, none}}` |
| `price_logged_stock` (`stock_logs`) | `p_delivery_id uuid, p_lines jsonb` (`[{delivery_line_id, unit_cost_iqd}]`, per base unit, `0 ≤ x < 1e9`) | `{delivery_id, updated}` | MGMT; row-addressed: another venue's delivery, or one that is not `source = 'staff_log'`, → `REF_NOT_FOUND` hint `delivery` | `FORBIDDEN`, `REF_NOT_FOUND` (`delivery`, `lines`), `INVALID_ARGUMENT` (`unit_cost_iqd`, `lines`). Before any UPDATE it locks every affected batch (each line's batch and that batch's transfer descendants) in one statement: `select … order by ingredient_id, expiry_date asc nulls last, received_at asc, id asc for update`. That order is the one a sale's canonical pass uses (V15) | state | `stock.price_log`, before and after `{lines:[{delivery_line_id, unit_cost_iqd}]}` |
| `submit_stock_count` (`stock_counts_by_location`) | `p_location text default null, p_lines jsonb` (`[{ingredient_id, counted_qty, unit?}]`, 1–300), `p_venue_id uuid default null, p_idempotency_key text default null` | `{count_id, location, lines}` | COUNT at the venue; head_chef and chef get the bakery only (cafe → `FORBIDDEN` hint `location`) | `FORBIDDEN`; `INVALID_ARGUMENT` (`location`, `lines`, `unit`, `kind`: a shop product at the bakery); `INVALID_QTY`; `INGREDIENT_NOT_FOUND`; `COUNT_IN_PROGRESS` | yes | `stock.submit_count`, entity `stock_counts`, after `{location, lines}` |
| `discard_count` (`stock_counts_by_location`) | `p_count_id uuid` | `{count_id, discarded:true}` | MGMT; row-addressed | `FORBIDDEN`, `COUNT_NOT_FOUND`, `COUNT_FINALIZED` | state | `stock.discard_count`, before `{location, source, lines}` |
| `stock_pick_list` (`stock_store_reads`) | `p_purpose text, p_location text default null, p_venue_id uuid default null, p_query text default null` | `{purpose, location, items:[{ingredient_id, name_en, name_ar, unit, kind, pack_size, on_hand?}]}` (≤ 300, by English name; `on_hand` only for `move`, at the source) | per purpose: `log` LOG, `move` MOVE, `count` COUNT, at the venue | `FORBIDDEN` (also hints `location`, `purpose`), `INVALID_ARGUMENT` (`purpose`, `location`) | – | – |
| `stock_today` (`stock_store_reads`) | `p_venue_id uuid default null` | `{business_date, transfers:[…]\|null, logs:[…]\|null, driver_deliveries_waiting:int\|null, counts:[…]\|null}` | MOVE ∪ LOG ∪ COUNT at the venue | `FORBIDDEN` | – | – |

**Store and kind rules.** Some of these are binding answers, not PROPOSALs. Maha logs shop stock
because she covers the desk ("Desk (Hussein 2, and Maha) … Logs shop stock", memory
`wave4-role-pages-spec-2026-09-25` lines 31-34 and 75). Every add-stock path names its store, with
Rusul logging into the bakery (lines 80-82). Shop (retail) stock is cafe-only for everyone (D4,
V14). The rest is **PROPOSAL** (who moves, OPEN §8 Q21; each role's other store and the defaults).

| Role | Log kinds | Log stores (default) | Move | Count |
|---|---|---|---|---|
| head_barista (Bareq) | purchased | cafe or bakery (cafe) | – | – |
| cashier (Maha) | purchased, retail | purchased: cafe or bakery (cafe); retail: cafe only | – | – |
| court_desk (Hussein 2) | retail | cafe only | – | – |
| head_chef (Rusul) | purchased | bakery or cafe (bakery) | – | bakery |
| chef (Tiba) | – | – | – | bakery |
| waiter (Hasan) | – | – | purchased and prepared, either way | – |
| manager, owner | purchased, retail | purchased: either (cafe); retail: cafe only | purchased and prepared | either (cafe) |

- **Shop stock never enters the bakery**, on any path (V14). `log_stock`, Goods in
  (`receive_delivery`) and "Bought by the driver" (`receive_purchase`) all refuse a retail line at
  the bakery with `INVALID_ARGUMENT` hint `kind`, through `receive_delivery_internal` (D4). The
  operator's store pickers disable Bakery for a shop line, and the phone's `logStoresFor` offers
  only the cafe for one.
- `prepared` is never logged: it comes from production (`INVALID_ARGUMENT` hint `kind`; the phone
  says "Made here? Record a batch").
- **A line** is `{ingredient_id, qty, unit?, expiry_date?}`. `unit` is the base unit, or `'pack'`
  (which needs `pack_size` and is multiplied into the base unit). This mirrors
  `shopping_items.unit` (0166).
- **`stock_today`** uses the business day of `app.venue_business_date` (0165:182; the same day as
  `production_today`, 0167:207-208), with each section present only for its roles:
  - `transfers` (MOVE): the day's transfers, `[{transfer_id, from, to, moved_by_name, moved_at,
    lines:[{ingredient_id, name_en, name_ar, unit, qty}]}]`;
  - `logs` (LOG): every delivery of the day, staff logs and Goods in both, limited to the kinds the
    caller may log, with no cost, no supplier and no note;
  - `driver_deliveries_waiting` (LOG): the number of purchases delivered and still `to_receive`
    (0186);
  - `counts` (COUNT): the phone counts of the last 30 days, `waiting` or `applied`, with no
    theoretical quantity and no variance.

**Changed shape.** `staff_stock_view` rows gain `by_location: {cafe, bakery}`, where cafe + bakery
= `on_hand`. The waiter joins its guard, with purchased and prepared (STOCK_VIEW).

**No push** (**PROPOSAL**; OPEN §8 Q20). A waiting phone count is a badge on Stock ▸ Counts.

#### 2.8.6 Re-issued committed functions (each verbatim from its latest body)

| Object | Latest | Migration | Signature | Change |
|---|---|---|---|---|
| `consume_fefo` | 0018:83 | `stock_locations` | same | the body becomes `perform app.consume_fefo_at('cafe', <8 args>)`; re-revoke (0018:549) |
| `consume_for_order_item` | 0018:213 | `stock_locations` | same | F1: `app.lock_stock_ingredients` over the whole order's BOM before the item's; re-revoke (0018:552) |
| `receive_delivery` | 0145:242 | `stock_locations` | **new**: `+ p_location text default null`; drop `(jsonb, text, text, text, uuid, text)`, recreate, re-revoke and re-grant | guard as 0145:266; venue from `app.current_venue()`, then `is_staff_at`; supplier check and claim (0145:284) verbatim; calls `receive_delivery_internal(…, 'goods_in')`, so it now also raises `STORE_BEING_COUNTED` and refuses a shop line at the bakery (D4); audit (0145:329) plus `location` |
| `receive_purchase` | 0166:678 | `stock_locations` | **new**: `+ p_location text default null`; drop `(uuid, jsonb, uuid, text, text)`, recreate, re-revoke and re-grant | passes `p_location` to the public `receive_delivery` (0166:810), so the same two refusals reach it; `purchase.receive` after gains `location` |
| `record_production_internal` | 0167:38 | `stock_locations` | **new**: `+ p_location stock_location default 'bakery'`; drop `(uuid, numeric, date, text)`, recreate, revoke from `public, anon, authenticated` | `consume_fefo_at(p_location, …)` (0167:75); the batch insert gets `location` (0167:86); the audit gains `location`. `record_batch` (0167:134) calls it with 4 positional args (0167:168), so it is **not** re-issued |
| `record_production` | 0167:111 | `stock_locations` | **new**: `+ p_location text default 'bakery'`; drop and recreate, re-grant | `parse_stock_location(p_location, 'bakery')` |
| `record_waste` (**severable**) | 0049:356 (plain `create function`) | `stock_locations` | **new**: `+ p_location text default null`; drop `(uuid, numeric, movement_type, text, text, text)`, recreate, re-grant | `consume_fefo_at(parse_stock_location(p_location, staff_home_location(app.staff_role())), …)`; the audit gains `location`. The queued `stock.waste`: `stockWastePayloadSchema` (`packages/core/src/schemas/mutations.ts:481`) gains an optional `location: z.enum(['cafe','bakery'])`; `DIRECT_RPC` (`op/lib/mutate.ts:222`) and `MUTATION_RPCS` (`replay/index.ts:226`) pass `p_location` **only when present**. The type list is unchanged. If cut, bakery waste books cafe-first and counts correct the split |
| `protocol_submit_product_release_test` | 0172:1112 | `stock_locations` | same | `consume_fefo_at(staff_home_location(app.staff_role()), …)` in place of 0172:1133 |
| `trg_refund_restock` | 0146:245 | `stock_locations` | same | 0146:284 (the ORDER BY) becomes `order by (location <> 'cafe'), received_at desc, id desc` |
| `trg_low_stock_alert` | 0151:36 | `stock_locations` | same | first statement: `if new.movement_type = 'transfer' then return new; end if;` |
| `start_count` | 0019:41 | `stock_counts_by_location` | **new**: `(p_location text default null, p_venue_id uuid default null)`; drop `start_count()`, recreate, re-grant | MGMT at the venue; the exclusive advisory lock; `COUNT_IN_PROGRESS` per (venue, store); lines are the venue's active ingredients (the bakery count: purchased and prepared) with theoretical = Σ `qty_delta` at the store; `source 'operator'`; the audit and the return gain `location` |
| `finalize_count` | 0044:301 (`$function$` body; rename the tag) | `stock_counts_by_location` | same | row-addressed (`COUNT_NOT_FOUND` across venues), then `is_staff_at` and `set_config`; the shortage uses the canonical order (… `received_at asc, id asc`) at the count's store; the surplus follows D7; the audit and the return gain `location` |
| `v_variance_report` | 0172:1836 | `stock_counts_by_location` | columns kept, **appended** `location`, `transfer_qty` | `lag` partitioned by (venue, store, ingredient); the lateral filters to the count's store; `transfer_qty = sum(qty_delta) filter (where movement_type = 'transfer')`; `comment on column`; readable-column rows (the 0172:1880 statement) |
| `report_stock` | 0172:1889 | `stock_counts_by_location` | same | variance rows gain `location` and `transferQty`; expiring and expired rows gain `location` through `left join stock_batches sb on sb.id = e.batch_id`; `stockValueIqd`, low and below-par stay venue totals. SEC-29 scans it: neither new key is forbidden |
| `staff_stock_view` | 0181:34 | `stock_store_reads` | same `(uuid, text)` | the guard and `is_staff_at` gain `waiter` (purchased, prepared); each row gains `by_location` |

- **Not re-issued, on purpose:**
  - `write_off_expired`, `trg_order_item_voided` (D2);
  - `record_batch`;
  - `ingredient_on_hand`, `menu_availability`, `item_required_ingredients`, `production_today`,
    `ops_overview`, `assistant_stock_view` (venue totals);
  - `v_ingredient_on_hand` (the new view carries the per-store figures);
  - `v_item_cogs`, `release_cost`, `price_promo_numbers` (a transfer copies cost and `received_at`);
  - `flag_expired_batches`, `v_expiring_soon` (slice 2 owns them);
  - the movement-type-filtered report functions (a `transfer` row is in none of their lists);
  - `confirm_purchase_delivery` (the store is chosen when the purchase is received).
- **Old callers keep working.** Every new parameter defaults. An old operator's
  `rpc('start_count', {})` resolves to the all-default signature and counts the cafe, and its
  `record_production` goes to the bakery by default.
- **Slice 2** rebases onto S's `start_count` and `finalize_count` if it re-issues them.

#### 2.8.7 Stock invariants (each is a test, §6.1)

| # | Invariant |
|---|---|
| I1 | The ledger is the truth. The venue's Σ `qty_delta` equals the sum over both stores, and every `transfer:<id>` group sums to 0 |
| I2 | Batch conservation: for every batch created after the migration, `qty_remaining` = Σ `qty_delta` of its movements |
| I3 | A movement is at its batch's store. A service-role insert naming the wrong store comes back corrected |
| I4 | A transfer changes neither the venue's on-hand nor its stock value. A transfer past the source's batches writes nothing |
| I5 | No batch goes below zero. 10 cafe sales and 10 bakery `record_batch` calls of one ingredient run in `Promise.all` against both stores: no 40P01, exact sums, one overdraft row and one alert when the venue runs out (the `concurrency.test.ts:402` pattern). With two ingredients, a transfer whose `p_lines` lists them against `ingredient_id` order, a `price_logged_stock` over both, and two-ingredient sales all run in `Promise.all`: no 40P01 (V15) |
| I6 | A sale is never blocked, and it overdraws only when the whole venue is short. With the cafe empty and the bakery stocked there is no batch-less row and no alert |
| I7 | With all stock in the cafe, behaviour is identical to today. The whole existing db suite passes unchanged, and a golden case compares a sale's movement rows before and after |
| I8 | A transfer keeps expiry, unit cost and FEFO position: margins, `release_cost` and `price_promo_numbers` are equal before and after |
| I9 | A count adjusts only its store, and its variance and explanation columns cover only that store and period. `start_count` leaves another venue's ingredients out |
| I10 | A transfer never raises `low_stock` |
| I11 | Retries are exactly-once: a same-key `transfer_stock`, `log_stock` or `submit_stock_count` changes stock once |
| I12 | Staff never see money: a walker over every staff payload finds no key ending in `_iqd` or starting with `cost`, `price` or `supplier` |
| I13 | A cost correction revalues only the shelf: `price_logged_stock` on a `goods_in` delivery → `REF_NOT_FOUND` |
| I14 | No double counting during a manager's count. A transfer, a log, a Goods in receipt or a driver receipt into a store with an operator count open → `STORE_BEING_COUNTED`, and one racing `start_count` waits on the advisory lock (M5, V19). A waiting phone count does not block |
| I15 | `cost_source` is honest, and the batch cost equals the estimate. A log made after a zero-cost synthetic batch (a refund restock or a count surplus) gets the last **positive** cost (V21) |
| I16 | Shop stock is cafe-only. A retail line at the bakery is refused with `INVALID_ARGUMENT:kind` by `log_stock`, `receive_delivery` and `receive_purchase`, and writes nothing (V14) |

### 2.9 Till shifts — lane T

#### 2.9.1 Grounding

- **The day is the only cash unit today.** `day_sessions` (0015:25-39), `open_day` (0015:364) and
  `close_day` (0020:18, its only body) set expected cash as `float + Σ cash payments − Σ cash
  refunds` over the day (0020:68-79). The variance is stamped, never recomputed.
- **Payments and refunds are append-only** (`payments_ao`, `refunds_ao`, 0015:164-169). No row can
  be backfilled. `settle_tab` (0106:391) is the only writer of `payments` and stores
  `device_id = p_device_id` (0106:484-486). `refund` (0139:368) writes `refunds` with **no**
  `device_id` (0015:137-144; insert at 0139:454).
- **A refund may be for an earlier day's payment.** `refund` needs only an open day
  (0139:420-423), and it finds the payment by id with no day match (0139:436-445). `close_day` and
  `v_day_close_summary` count a refund under its **payment's** day (0020:70-77; 0106:1080-1084). A
  shift counts it in the drawer it left (§2.9.4). The difference is carried explicitly (V10, TI6).
- **Every till money write carries the station.** `DIRECT_RPC` passes `p_device_id` (`op/lib/mutate.ts`);
  replay passes `p_device_id = station_id` and runs under the caller's JWT, so a queue can be
  replayed by a colleague (`replay/index.ts:347`, :427-436). **Attribution by station is immune to
  that**, and attribution by person is not.
- **Break cover** keeps the first person's session (0105:37-41). **Drawer opens** are audit rows
  with no amount (`record_drawer_open` 0106:787, online-only). A cashier reads `payments`
  (`payments_staff_read`, 0136:113-115).
- **No shift exists anywhere.** Test ids must avoid `start-shift` (`op/lib/audio.ts:144`
  `StartShiftBanner`).

#### 2.9.2 Data model (`till_shifts`)

```sql
create table till_shifts (
  id                      uuid primary key default gen_random_uuid(),
  venue_id                uuid not null references venues(id),
  day_session_id          uuid not null references day_sessions(id),
  station_id              text not null,
  staff_id                uuid not null references staff(id),
  opened_at               timestamptz not null default now(),
  opening_float_iqd       iqd not null,
  open_note               text,
  handover_from_shift_id  uuid references till_shifts(id),
  handover_difference_iqd iqd_signed,
  closed_at               timestamptz,
  closed_by               uuid references staff(id),
  closed_via              text,                           -- 'own_pin' | 'manager_pin' | 'day_close'
  authorized_by           uuid references staff(id),
  cash_payments_iqd       iqd,
  cash_refunds_iqd        iqd,
  cash_expected_iqd       iqd_signed,                     -- signed: a refund of an earlier shift's payment can exceed float + takings
  cash_counted_iqd        iqd,
  cash_variance_iqd       iqd_signed,
  card_payments_iqd       iqd,
  card_refunds_iqd        iqd,
  payment_count           int,
  refund_count            int,
  drawer_open_count       int,
  close_note              text,
  constraint till_shifts_station_venue_fkey foreign key (station_id, venue_id) references stations (id, venue_id),  -- 0132:58 pair key
  constraint till_shifts_closed_chk     check ((closed_at is null) = (closed_via is null) and (closed_at is null) = (closed_by is null)),
  constraint till_shifts_via_chk        check (closed_via is null or closed_via in ('own_pin','manager_pin','day_close')),
  constraint till_shifts_order_chk      check (closed_at is null or closed_at >= opened_at),
  constraint till_shifts_stamped_chk    check (closed_at is null or (cash_expected_iqd is not null and cash_payments_iqd is not null
                                                and cash_refunds_iqd is not null and payment_count is not null)),
  constraint till_shifts_counted_chk    check (closed_via is null or closed_via = 'day_close' or cash_counted_iqd is not null),
  constraint till_shifts_authorizer_chk check (closed_via is distinct from 'manager_pin' or authorized_by is not null),
  constraint till_shifts_expected_chk   check (cash_expected_iqd is null or cash_expected_iqd = opening_float_iqd + cash_payments_iqd - cash_refunds_iqd),
  constraint till_shifts_variance_chk   check ((cash_counted_iqd is null and cash_variance_iqd is null) or cash_variance_iqd = cash_counted_iqd - cash_expected_iqd),
  constraint till_shifts_handover_chk   check ((handover_from_shift_id is null) = (handover_difference_iqd is null)),
  constraint till_shifts_note_len_chk   check (coalesce(length(open_note),0) <= 500 and coalesce(length(close_note),0) <= 500)
);
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
create unique index till_shifts_one_open_per_station on till_shifts (station_id) where closed_at is null;
create unique index till_shifts_one_open_per_staff   on till_shifts (staff_id)   where closed_at is null;
create index till_shifts_day on till_shifts (day_session_id);
RLS: till_shifts_mgmt_read (MGMT at the venue). No own-row policy; no client write grant.
```

- **Open** means `closed_at is null`. There is no status column.
- **Roles that hold a shift:** SHIFT, an explicit list. The new roles, the bar and kitchen family,
  driver, marketing and prep are all out.
- **Columns on existing tables** (same migration):
  - `payments.till_shift_id uuid` (FK `payments_till_shift_fkey`);
  - `refunds.device_id text`;
  - `refunds.till_shift_id uuid` (FK `refunds_till_shift_fkey`).

  Each is `add column if not exists` with no default (metadata only). The FKs are added `NOT VALID`
  inside the `conname` + `conrelid` guard, then `VALIDATE`d; every existing row is null. **No
  backfill, ever:** history before this is "outside a shift".
- **Readable columns.** The 0144:94-120 statement runs with
  `and c.table_name in ('till_shifts','payments','refunds') and c.column_name not in ('open_note','close_note')`.
  `ON CONFLICT DO NOTHING` adds only the new columns. Staff notes never reach the LLM.

#### 2.9.3 Attribution trigger (same migration)

```sql
create or replace function app.stamp_till_shift() returns trigger
language plpgsql security definer set search_path = public as $stamp_till_shift_0NNN$
begin
  new.till_shift_id := null;                       -- never trust a supplied value
  if new.device_id is null then return new; end if;
  -- One SELECT per table. PL/pgSQL resolves every NEW field a statement names when it
  -- prepares the statement, so a shared SELECT naming new.day_session_id raises
  -- 'record "new" has no field "day_session_id"' on refunds, whatever an OR around it says.
  if tg_table_name = 'payments' then
    select s.id into new.till_shift_id
      from till_shifts s
     where s.station_id     = new.device_id
       and s.venue_id       = new.venue_id          -- the column default is applied before BEFORE triggers
       and s.day_session_id = new.day_session_id
       and s.closed_at is null
     for share;                                    -- vs the close's FOR UPDATE (the 0038:47-52 pattern)
  else                                             -- refunds: no day column (0015:137-144)
    select s.id into new.till_shift_id
      from till_shifts s
      join day_sessions d on d.id = s.day_session_id and d.status = 'open'
     where s.station_id = new.device_id
       and s.venue_id   = new.venue_id
       and s.closed_at is null
     for share of s;                               -- refund already holds the open day FOR SHARE (0139:420)
  end if;
  return new;
end $stamp_till_shift_0NNN$;
revoke all on function app.stamp_till_shift() from public, anon, authenticated;
create trigger payments_till_shift_stamp before insert on payments for each row execute function app.stamp_till_shift();
create trigger refunds_till_shift_stamp  before insert on refunds  for each row execute function app.stamp_till_shift();
```

- **A trigger, not a `settle_tab` re-issue.** `settle_tab` is the most sensitive money body, and
  slice 2 may re-issue it; a trigger survives that. It also covers the queued, direct and desk paths
  at once.
- **Two branches, one function** (V1). The shared form failed on every refund carrying a device.
  After §2.9.4's re-issue of `refund`, that is every till refund, queued replays included (the
  operator sends `p_device_id` on every `payment.refund`, `op/lib/mutate.ts:241-250`). It was
  reproduced on the local stack inside a rolled-back transaction, and the `if`/`else` form passes
  there. The refund branch takes only a shift whose day is **open**. A shift left open on a day
  that was closed outside `close_day` (for example by the `forceCloseAllDays` test helper, §2.9.5)
  therefore never takes a refund. A payment already gets this from its day conjunct.
- **Serialisation.** If a close holds the shift `FOR UPDATE` first, an in-flight insert waits. It
  then re-checks `closed_at is null` and gets `null`, never a closed shift. If the insert holds
  `FOR SHARE` first, the close waits, and its sums see the payment.
- **Lock order.** `check-lock-order.mjs` `ORDER` gains `till_shifts` **after `payments`, before
  `refunds`**, and the `packages/db/CLAUDE.md` line changes in the same commit. The sequences:
  - `settle_tab`: tabs → (trigger) till_shifts SHARE;
  - `refund`: day_sessions SHARE → tabs → payments FOR UPDATE → (trigger) till_shifts SHARE;
  - `close_day`: day_sessions FOR UPDATE → till_shifts FOR UPDATE;
  - `close_till_shift*`: till_shifts FOR UPDATE only;
  - `open_till_shift`: day_sessions SHARE → insert.

  The script sees only `FOR UPDATE` (:113), so the trigger's SHARE is documented in the header and
  covered by the race test.

#### 2.9.4 RPCs

All are definer with the guard first, and every write runs `set_config`. The internals are plpgsql
and revoked from `public, anon, authenticated`.

- **`app.till_shift_station(p_device_id text) returns stations`** (internal):
  1. `!~ '^[A-Z][A-Z0-9-]{0,31}$'` → `INVALID_STATION`;
  2. there must be a live station (`retired_at is null`) with `venue_id = any(app.staff_venue_ids())`,
     else `STATION_UNKNOWN` (no oracle);
  3. **for writes only:** the caller must be the session beating from that station,
     `exists(device_heartbeats h where h.device_id = p_device_id and h.staff_id = auth.uid() and h.last_seen_at > now() - interval '60 seconds')`,
     else `TILL_SHIFT_WRONG_STATION`. `app.heartbeat` stamps `staff_id` (0156:362, 0107:25), and
     the operator sends `sendHeartbeat` right before the write (the `DayClose.tsx:340` precedent).
     The phone never beats (§6.7 of the contracts), so no phone can open or close a drawer.
- **`app.till_shift_figures(p_shift_id uuid) returns jsonb`** (internal, the one place the money is
  summed):
  - cash payments = Σ `payments` where `till_shift_id = S` and `method = 'cash'`;
  - cash refunds = Σ `refunds r join payments p` where `r.till_shift_id = S` and `p.method = 'cash'`
    (the 0020:70-72 rule);
  - card payments and card refunds, the same way;
  - the counts;
  - `drawer_open_count` from `audit_log` `drawer.open` by `device_id` within the shift's window
    (shown only, never in the math);
  - expected = float + cash payments − cash refunds.

| RPC | Args | Returns | Steps and errors |
|---|---|---|---|
| `open_till_shift` | `p_opening_float_iqd bigint, p_device_id text, p_note text default null, p_idempotency_key text default null` | `{duplicate:false, till_shift:{id, station_id, staff_id, staff_name, opened_at, opening_float_iqd, handover_from:{till_shift_id, staff_name, closed_at, left_in_drawer_iqd, outside_cash_since_iqd}\|null, handover_difference_iqd}}` | 1. SHIFT, else `FORBIDDEN`. 2. The station check (write form), then the venue and `set_config`. 3. `INVALID_FLOAT` (null or negative), `TEXT_TOO_LONG` (hint `note`, 500). 4. `claim_replay(key,'open_till_shift')`. 5. The open day `for share`, else `NO_OPEN_DAY`. 6. **Self-heal** (**PROPOSAL**): a stale open shift on this station, or for this person, whose day is closed is closed `day_close` (figures stamped, count null), audited `drawer.shift_close_by_day`. 6a. **Queued writes** (V13): `TILL_SHIFT_UNSYNCED` when `exists(device_heartbeats where device_id = p_device_id and queue_depth > 0 and last_seen_at >= <the open day's opened_at>)`. This mirrors the close's step 6 and `close_day`'s guard (0020:57-64). The stamp trigger picks the shift that is open when a row is **inserted**, and a queued sale is inserted at replay. Without this step, a sale queued while no shift was open (the gate fails open offline) would land in the new shift, whose counted float already holds its cash, and show a false shortage. With it, the replay lands first, outside a shift. 7. `TILL_SHIFT_ALREADY_OPEN` (detail = its station); `TILL_SHIFT_STATION_BUSY`; a `unique_violation` from a race is mapped by index name to these two. 8. **Handover** (V18): the latest counted shift on this station in this day sets `handover_from_shift_id`. Then `handover_difference_iqd = float − (prev.cash_counted_iqd + outside_cash_since_iqd)`. `outside_cash_since_iqd` = Σ cash `payments` − Σ cash `refunds` (by the payment's method, the 0020:70-72 rule) stamped null with `device_id` = this station and `created_at > prev.opened_at` (F4: a settle that began before the close and wrote after it is stamped null with a `created_at` before `closed_at`; a null row inside the shift's own window can only be such a straggler). That is cash that entered or left the drawer between the two shifts: a no-shift sale (the gate fails open, and managers pay without a shift) or a manager's cash refund at the till. A new day never hands over. 9. Insert; audit `drawer.shift_open`, entity `till_shifts` (row minus the notes). 10. `finish_replay` |
| `close_till_shift` (my own, my PIN) | `p_till_shift_id uuid, p_counted_iqd bigint, p_pin text, p_device_id text, p_note text default null, p_idempotency_key text default null` | `{ok:true, duplicate?, till_shift_id, station_id, staff_id, staff_name, opened_at, closed_at, closed_via, authorized_by_name, opening_float_iqd, cash_payments_iqd, cash_refunds_iqd, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count, drawer_open_count, left_in_drawer_iqd}`, or `{ok:false, code:'PIN_INVALID'}` | 1. SHIFT. 2. `INVALID_COUNT` (null, negative, > 999,999,999,999), `TEXT_TOO_LONG`. 3. **The PIN before the claim** (the 0011 rule, as `start_break` 0105:386-388): `if not app.verify_own_pin(p_pin, p_device_id) then return {ok:false, code:'PIN_INVALID'}`; `NO_PIN_SET` and `PIN_LOCKED` are raised by `verify_own_pin` (0156:302). A wrong PIN is returned, so its attempt row commits. 4. `claim_replay`. 5. Lock the shift `for update`; missing or another venue → `TILL_SHIFT_NOT_FOUND`. 6. `TILL_SHIFT_CLOSED`; `TILL_SHIFT_NOT_YOURS` (`staff_id <> auth.uid()`); `TILL_SHIFT_WRONG_STATION`; `TILL_SHIFT_UNSYNCED` (`exists(device_heartbeats where device_id = S.station_id and queue_depth > 0 and last_seen_at >= S.opened_at)`, the `DAY_UNSYNCED` mirror of 0020:57-64). 7. `close_till_shift_internal(S, counted, note, 'own_pin', null)`. 8. `finish_replay` |
| `close_till_shift_for` (someone else's, or mine without a PIN) | `p_till_shift_id uuid, p_counted_iqd bigint, p_device_id text, p_note text default null, p_idempotency_key text default null` | as `close_till_shift` | The 0115 grant pattern: the screen first calls `verify_manager_pin` (0156:484), which mints a single-use grant. 1. SHIFT. 2. The argument checks. 3. `claim_replay(…,'close_till_shift_for')`; the duplicate path spends the grant best-effort (as `refund`, 0139:407-413). 4. Lock → `TILL_SHIFT_NOT_FOUND`, `TILL_SHIFT_CLOSED`, `TILL_SHIFT_WRONG_STATION`, `TILL_SHIFT_UNSYNCED`. 5. `v_auth := app.consume_pin_grant(p_device_id)` (0156:446) → `PIN_GRANT_REQUIRED`. 6. `close_till_shift_internal(S, counted, note, 'manager_pin', v_auth)`. **Not** in `PIN_GATED_RPCS` (it has no `p_pin`), so `packages/core` and `_shared/mutation-types.json` do not change |
| `till_shift_status` (stable) | `p_device_id text` | `{station_id, day:{id, business_date, opening_float_iqd}\|null, shift:{id, staff_id, staff_name, is_mine, opened_at, opening_float_iqd, payment_count, refund_count, drawer_open_count, cash_expected_iqd /* MGMT only; the key is absent otherwise */}\|null, last_closed:{id, staff_name, closed_at, left_in_drawer_iqd, outside_cash_since_iqd}\|null, mine_elsewhere:{id, station_id, opened_at}\|null, queue_depth}` (the start panel prefills `left_in_drawer_iqd + outside_cash_since_iqd`, V18) | SHIFT; the station check in its read form, with no heartbeat test. **Blind count** (**PROPOSAL**, OPEN §8 Q29): nothing open to a cashier or the desk returns running expected cash. It is a screen rule, not a wall, because `payments_staff_read` stays |
| `till_shift_list` (stable) | `p_from date default null, p_to date default null, p_station_id text default null, p_staff_id uuid default null, p_venue_id uuid default null` | `{from, to, shifts:[{id, day_session_id, business_date, station_id, staff_id, staff_name, opened_at, closed_at, closed_via, closed_by_name, authorized_by_name, opening_float_iqd, handover_difference_iqd, cash_payments_iqd, cash_refunds_iqd, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count, drawer_open_count, open_note, close_note}], outside:[{day_session_id, business_date, station_id, cash_payments_iqd, cash_refunds_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count}], cross_day:[{day_session_id, business_date, earlier_days_cash_refunds_iqd, earlier_days_card_refunds_iqd, later_cash_refunds_iqd, later_card_refunds_iqd}]}` | MGMT, then `is_staff_at` (0139:269). With no dates it covers the open day, else the latest. The range is capped at 62 days (`INVALID_ARGUMENT` hint `range`). **Which day a row belongs to** (V10): a payment belongs to its `day_session_id`. A refund belongs to the day it was **made**: its shift's day, or for an outside refund the day whose `[opened_at, closed_at)` window holds its `created_at`. `cross_day` carries the difference from `close_day`'s rule, which counts a refund under its payment's day. `earlier_days_*` covers refunds made on this day for earlier days' payments. `later_*` covers refunds of this day's payments made on a later day |

**`app.close_till_shift_internal(till_shifts, bigint, text, text, uuid) returns jsonb`** locks the
shift `for update` in its own first statement (F5; its callers already hold it), computes the
figures and runs one `update … where id = …`. It stamps the figures, the counted amount and the
variance (null for `day_close`), then audits `drawer.shift_close` (or `drawer.shift_close_by_day`)
with the row minus the notes.

**Re-issued (each verbatim from its latest body):**

| Object | Latest | Change |
|---|---|---|
| `app.refund(uuid, bigint, text, text, jsonb, text, text)` | 0139:368 (`$refund_0139$`) | the insert at 0139:454 gains `device_id` = `p_device_id`, and nothing else. The same signature; the 0139:493-494 revoke and grant are re-issued anyway |
| `app.close_day(bigint, bigint, text, text)` | 0020:18 | after the two guards (0020:50-64) and before the math: `perform 1 from till_shifts where day_session_id = v_day.id and closed_at is null for update;`, then each such shift goes through `close_till_shift_internal(s, null, null, 'day_close', null)`. The return gains `shifts_closed_with_day`. **The expected, counted and variance math at 0020:66-93 is unchanged.** The 0020:179-180 revoke and grant are re-issued |

**Not re-issued, on purpose:** `settle_tab` (the trigger handles it), `record_drawer_open`,
`open_day`, `heartbeat`, `v_day_close_summary`, `unpaid_played_bookings`,
`report_staff_activity`.

**Idempotency and online-only.**
- Open, close and close-for take keys: `` `${intent}:${crypto.randomUUID()}` `` with the intents
  `till_shift.open` and `till_shift.close`. A key is minted when the dialog opens.
- The three writes go through `appRpc` and are **not** queued types (**PROPOSAL**; the
  `open_day`/`close_day` decision, `HANDOFF.md:1938`), so the six mutation-list copies do not
  change. The `HANDOFF.md` row and the `apps/operator/CLAUDE.md` line "merge_tabs,
  record_drawer_open, open_day and close_day stay online-only" gain the three names.

**Audit and push.**
- `drawer.shift_open`, `drawer.shift_close` (a manager-PIN close carries `authorizer_id`) and
  `drawer.shift_close_by_day`, entity `till_shifts`, in the existing `drawer` family. Their payloads
  carry money figures, as `day.close` does (0020:95).
- No push in v1 (**PROPOSAL**; OPEN §8 Q27).

#### 2.9.5 Migrations

| Migration | Contents |
|---|---|
| `till_shifts` | the table, indexes (waiver line) and RLS; the three columns and FKs; `app.stamp_till_shift` and its two triggers; the internals `till_shift_station`, `till_shift_figures`, `close_till_shift_internal`; the RPCs `open_till_shift`, `close_till_shift`, `close_till_shift_for`, `till_shift_status`, `till_shift_list`; the re-issues of `refund` and `close_day`; readable-column rows; `comment on` everything |
| `till_shift_index` | `create index if not exists payments_till_shift on payments (till_shift_id) where till_shift_id is not null;` and the same on `refunds`. It is in its own file, with `MIGRATION-RISK-ACCEPTED: partial index on a small table, momentary SHARE lock` (the 0135 precedent) |

The commit also carries:
- the lock-order edit and the `packages/db/CLAUDE.md` line;
- `go-live-reset.sql` (`public.till_shifts`, beside `public.day_sessions`);
- **`helpers.ts` `forceCloseAllDays` (:559) is left as it is, and shifts stay open** (V9). The helper
  writes through PostgREST as the service role (:563-575). A plain update that set `closed_at` and
  `closed_via` would break `till_shifts_closed_chk` (no `closed_by`, since `auth.uid()` is null)
  and `till_shifts_stamped_chk` (no figures). A shift left open on a force-closed day takes no new
  money: a payment needs its own day, and a refund needs an open day (§2.9.3). The next
  `open_till_shift` on that station, or by that person, closes it through the self-heal (step 6).
  The T test "the self-heal after `forceCloseAllDays`" pins exactly that.

#### 2.9.6 Money-path invariants (each is a test, §6.1)

| # | Invariant |
|---|---|
| TI1 | Shifts never refuse, alter or delay money beyond a row-lock wait. The `settle_tab` body is untouched, and `refund` gains only `device_id`. The server never raises on a missing shift |
| TI2 | `till_shift_id` is null, or a shift of the same station and venue that was open when the row was inserted. For a payment it is a shift of the same day session, and for a refund a shift whose day was open (§2.9.3) |
| TI3 | A closed shift's stamped figures equal the sums over the rows carrying its id, forever |
| TI4 | `payments` and `refunds` stay append-only: the stamp is BEFORE INSERT only |
| TI5 | `close_day`'s cash math is unchanged, byte for byte against the 0020 formula. That math counts a refund under its payment's day (0020:70-77), which is why TI6 and TI7 carry a cross-day term |
| TI6 | Partition, for a day D. Payments, cash and card: Σ shifts + Σ outside = `v_day_close_summary` exactly. Refunds: Σ shifts + Σ outside = the summary's `refunds_iqd` + `earlier_days` − `later`. Here a refund belongs to the day it was made (`till_shift_list`, V10), `earlier_days` = refunds made on D for earlier days' payments, and `later` = refunds of D's payments made on a later day, which the live view counts under D |
| TI7 | The clean-drawer identity: with one till, the drawer passed whole, no outside-shift cash, the first float = the day float and the day count = the last shift's count. Then the day variance that `close_day` stamps = Σ shift variances + Σ handover differences − `earlier_days_cash_refunds_iqd`. A cash refund made on D for an earlier day's payment left the drawer, and the shifts count it, but `close_day` does not. `later` does not enter, because `close_day` stamps at close time |
| TI8 | At most one open shift per station and per person, and the station and the shift agree on the venue |
| TI9 | No shift outlives its day: `close_day` closes them in its own transaction, and `open_till_shift` self-heals |
| TI10 | Expected, counted and variance are stamped once and tied by CHECKs; expected is signed |
| TI11 | A shift can neither open nor close while its station reports queued writes (V13) |
| TI12 | Blind count: before the close, no cashier or desk read returns expected cash (a UI rule over a readable ledger, §7.6) |
| TI13 | Every count is signed by the person's own PIN or a manager's grant, named in `authorized_by`. A wrong own PIN is returned, never raised |
| TI14 | A close retried with the same key echoes the stored result, with no second audit row |

#### 2.9.9 Desk shifts (§8 Q28, answered 2026-09-25)

Majed: the desk counts its own cash box at each handover too. The shift UI is offered in desk mode
as well as till mode, and the server treats the desk's station like a till's: a desk shift's
expected cash is the desk cash box (0106's own desk cash box: cash taken at that station, the
same station-scoped sums the till uses), with the same blind count, one-tap accept or recount,
handover and outside-cash (V18) rules. T verifies that every desk cash path (court payments,
prepayments, refunds at the desk, 0106) carries the desk's `station_id` so attribution is exact,
and adds tests: a desk shift open, desk court payments attributed to it, a handover, a close with
a difference, and a till shift and a desk shift open at once without mixing. `SHIFT` guards
include `court_desk`. The operator UI (T, later) mounts the shift control in desk mode too.

### 2.10 Re-issued committed objects: one wave-5 owner each

At commit, re-check each "latest body" from `packages/db` with

```sh
command grep -n -i -E "(create|create or replace) function app\.<name>\(" supabase/migrations/*.sql \
  | LC_ALL=C sort -t: -k1,1 -k2,2n | tail -1
```

`-i` catches 0044's upper-case body. `command` bypasses the agent shell's `grep`, which is a ugrep
shell function (`type grep`) that does not promise file order, and the explicit `sort` makes the
last line the latest body whatever the tool. If slice 2 or a sibling re-issued a body after you
drafted, rebase onto that body.

| Object | Latest body | Lane (migration) | Change |
|---|---|---|---|
| `app.set_ticket_status`, `app.set_order_item_ready` | 0156:598, :617 | R (`assistant_barista_waiter_access`) | + assistant_barista |
| policies `tickets_staff_read`, `touchpadel_rt_staff_topics` | 0156:788, :794-814 | R | + assistant_barista; the waiter on `floor` (§2.1.8) |
| policy `waiter_calls_staff_read`; `app.ack_waiter_call`, `app.resolve_waiter_call` | 0136:125; 0032:691, :702 | R | + waiter; the RPCs' venue check (§2.1.8) |
| `app.kitchen_board` | 0158:42 | R | + assistant_barista |
| `app.staff_team` | 0170:176 | R | assistant_barista → `bar` |
| `app.save_teaching`, `app.teachings_for_me` | 0179:80, :260 | R | + assistant_barista |
| `app.recipe_view` | 0182:33 | R | + assistant_barista |
| `app.protocol_engine_roles`, `app.protocol_check_hiring_open_position` | 0164:114, 0176:200 | R | + both roles |
| `app.upsert_variant`, `app.upsert_modifier` | 0177:707, :982 | N (`price_promo_renames`) | the rename lock |
| `app.protocol_check_price_promo_propose`, `app.price_promo_check_targets`, `app.price_promo_apply_internal`, `app.price_promo_numbers` | 0177:2296, :1908, :2032, :2891 | N | renames |
| `app.notify_staff` | 0169:26 | P (`staff_push_keys_wave5`) | ten title keys |
| `staff_media_uploads` folder CHECK and path CHECK; `app.is_staff_media_path`; `app.staff_media_slot`; `app.staff_media_visible` | 0170:58-87, :97, :116, :298 | P (`staff_media_incidents`) | `incidents`; the `marketing_content:` rule |
| `app.protocol_tick_nudge` | 0173:642 | P (`incident_reports`) | incident photos due |
| `protocol-action` `logic.ts` (`STAFF_MEDIA_PATH_RE`, `tick`), `index.ts` (`tickPorts`) | E's committed files | P (the `staff_media_incidents` and `incident_reports` commits) | the regex; the third purge phase |
| `app.consume_fefo`, `app.receive_delivery`, `app.receive_purchase`, `app.record_production_internal`, `app.record_production`, `app.record_waste`, `app.protocol_submit_product_release_test`, `app.trg_refund_restock`, `app.trg_low_stock_alert` | 0018:83, 0145:242, 0166:678, 0167:38, 0167:111, 0049:356, 0172:1112, 0146:245, 0151:36 | S (`stock_locations`) | §2.8.6 |
| `app.start_count`, `app.finalize_count`, `v_variance_report`, `app.report_stock` | 0019:41, 0044:301, 0172:1836, 0172:1889 | S (`stock_counts_by_location`) | §2.8.6 |
| `app.staff_stock_view` | 0181:34 | S (`stock_store_reads`) | the waiter; `by_location` |
| `app.refund`, `app.close_day` | 0139:368, 0020:18 | T (`till_shifts`) | §2.9.4 |

- **No object has two wave-5 owners.**
  - `refund` (T) and `trg_refund_restock` (S) are different functions on the same money path. They
    touch different lines, and the lock order holds: payments → till_shifts → refunds →
    stock_batches.
  - `staff_stock_view` is S's only; R does not touch it.
  - `staff_media_visible` is P's only; R relies on the unchanged 0170:374 teaching rule.
- **Not re-issued by wave 5:**
  - `claim_staff_media`, `staff_team_head`;
  - `settle_tab`, `open_day`, `record_drawer_open`, `heartbeat`;
  - `upsert_retail_variant`, `upsert_menu_item`, `protocol_check_price_promo_numbers`;
  - `record_batch`, `write_off_expired`, `trg_order_item_voided`;
  - `checklist_day_state` (R7's), and every hardening helper;
  - `staff_requests` and its RPCs;
  - `marketing_campaigns`, `marketing_requests` and their RPCs;
  - `delete_my_account`;
  - every `storage.objects` policy but `staff_media_delete` (P, F8).

### 2.11 Migration list (by name and dependency)

| Migration | Lane | Depends on | Contents |
|---|---|---|---|
| `staff_roles_assistant_waiter` | R | – | `alter type staff_role add value` × 2, and nothing else |
| `assistant_barista_waiter_access` | R | `staff_roles_assistant_waiter` | §2.1.4 |
| `price_promo_renames` | N | `staff_roles_assistant_waiter` (its tests only, V7); 0177 is committed | §2.2.4 |
| `staff_push_keys_wave5` | P | P's `send-push` commit (deployed before its push) | §2.3 |
| `staff_media_incidents` | P | – (0170 committed) | §2.4 |
| `salary_deductions` | P | `staff_push_keys_wave5`, `assistant_barista_waiter_access` (M9) | the table, nine RPCs, coverage `excluded` |
| `incident_reports` | P | `staff_push_keys_wave5`, `staff_media_incidents`; `staff_roles_assistant_waiter` (tests, V7) | the table, five client RPCs, three internals, cron `tp_incident_purge`, `protocol_tick_nudge`; the `protocol-action` tick phase in the same commit |
| `marketing_content` | P | `staff_push_keys_wave5` (its photo rule is already in `staff_media_incidents`, behind `to_regclass`); `staff_roles_assistant_waiter` (tests, V7) | two tables with owner-only select policies (V4), six RPCs, readable-column rows for `marketing_content` only |
| `stock_transfer_movement` | S | – | `alter type movement_type add value if not exists 'transfer';` and nothing else |
| `stock_locations` | S | `stock_transfer_movement` | the type, the columns and constraints, the trigger, `v_stock_by_location`, four internals, nine re-issues (§2.8.6) |
| `stock_transfers` | S | `stock_locations`, `staff_roles_assistant_waiter` | two tables, RLS, the index (waiver), `transfer_stock` |
| `stock_logs` | S | `stock_locations`; `staff_roles_assistant_waiter` (tests, V7) | `stock_cost_estimate`, `log_stock`, `price_logged_stock` |
| `stock_counts_by_location` | S | `stock_locations`, `stock_transfer_movement`; `staff_roles_assistant_waiter` (tests, V7) | `start_count`, `finalize_count`, `v_variance_report`, `report_stock` re-issued; `submit_stock_count`, `discard_count` |
| `stock_store_reads` | S | `stock_transfers`, `stock_logs`, `stock_counts_by_location`, `staff_roles_assistant_waiter` | `stock_pick_list`, `stock_today`; `staff_stock_view` re-issued |
| `till_shifts` | T | – (committed bodies only) | §2.9.5 |
| `till_shift_index` | T | `till_shifts` | two partial indexes (waiver) |

### 2.12 Fixtures, coverage, cron, gates, docs

- **Every DB commit carries** (contracts §1.5):
  - the migration;
  - `types.gen.ts` after the reset;
  - `rpc-allowlist.json` and the floor (`--update-floor`);
  - `rls-matrix.ts` rows;
  - `assistant-coverage.json` keys;
  - its SEC-20 or SEC-29 edits;
  - both catalogs of any string it adds;
  - the three map outputs, rebuilt from a clean tree.
- **`rls-matrix.ts` rows** (append only):
  - **P:**
    - `write` is denied on the four new tables;
    - `select` on `marketing_content` and `marketing_content_versions`: `silence` for every
      principal, and the manager in particular (the owner-only policies, V4; the matrix seeds no
      content row);
    - `MANAGER_UP`: `deduction_targets`, `propose_deduction`, `my_deduction_proposals`,
      `deductions_page`, `deductions_month`, `incidents_page`;
    - `STAFF_ANY`: `withdraw_deduction`, `decide_deduction`, `cancel_deduction`, `my_deductions`,
      `submit_incident`, `review_incident`, `redact_incident`, `my_incidents`, `revise_content`,
      `withdraw_content`, `decide_content`, `content_detail` (row-addressed or ANY; a nil id stops
      at `REF_NOT_FOUND` past the guard);
    - `submit_content`: `guarded` for cashier, prep, court_desk, manager and owner (marketing is
      not a principal);
    - `content_page`: `OWNER_ONLY`.
  - **S:** the seven new RPCs, the two new tables, and `start_count`. Its "matrix-never" note at
    `rls-matrix.ts:2204-2207` shrinks, because `p_location: 'matrix-never'` now fails
    `INVALID_ARGUMENT` past the guard.
  - **T:** the table and the five RPCs.
  - **R:** no new grant; three `drop: 18` rows restate `select waiter_calls`, `ack_waiter_call`
    and `resolve_waiter_call` for the waiter and the venue check (§2.1.8).
- **`assistant-coverage.json` keys:**

  | Key | Value |
  |---|---|
  | `salary_deductions`, `incident_reports`, `marketing_content_versions` | `excluded: <the reasons in §2.5–§2.7>` |
  | `marketing_content`, `stock_transfers`, `stock_transfer_lines`, `v_stock_by_location`, `till_shifts` | `table_read`, with readable-column rows from each migration's own restricted statement (never the all-table catch-up) |
  | every new granted RPC (P: 20, S: 7, T: 5) | `map:action` |
  | every new internal and trigger function (`price_promo_size_renames`, `price_promo_addon_renames`, `incident_purge_due`, `incident_photo_purge_due`, `incident_photos_purged`, `staff_media_orphan_purge_due`, `staff_media_orphans_purged`, `consume_fefo_at`, `lock_stock_ingredients`, `staff_home_location`, `parse_stock_location`, `receive_delivery_internal`, `trg_stock_movement_location`, `stock_cost_estimate`, `stamp_till_shift`, `till_shift_station`, `till_shift_figures`, `close_till_shift_internal`) | `excluded: service_role only — an internal helper …` |
  | routes `/deductions`, `/incidents`, `/stock/moves` | `map:page` |
  | cron `tp_incident_purge` | the existing cron value form |
  | `docs/design/protocols/wave5-addendum-2026-09-25.md` | `index:doc` (Z's commit; until then, `check:assistant-coverage` in the working tree reports this file as uncovered) |

- **Cron.** One new job, `tp_incident_purge` at `50 3 * * *`, running
  `select app.incident_purge_due();`. It is written in the guarded DO block shape and asserted
  after the hosted push (§7.9).
- **SEC-20** (`stored-fields.test.ts`, P):
  - a second declaration, `UNLINKED_PERSONAL`, for tables of staff-typed personal data that carry
    **no** guest link on purpose, erased by retention. `Field.onDelete` gains `'purge'`;
  - `incident_reports` is declared column by column, with `place_detail`, `description`,
    `people_involved`, `photos` and `review_note` as `purge`;
  - three cases: no `LINK_COLUMNS` column, the live columns equal the declared ones (the :207-225
    drift check), and the purge proof;
  - the printed data-safety declaration lists them with fate `purge`;
  - `payments`, `refunds`, the stock tables and the deduction and content tables carry no guest link,
    so SEC-20 does not see them.
- **SEC-29** (`check-analytics-payload.mjs:41-50`, P): `FORBIDDEN` gains `/deduction/i` and
  `/people_involved/i`, as tripwires. `/device_id/i` is already there, and no scanned function emits
  T's new `refunds.device_id`. S's `report_stock` keys `location` and `transferQty` are allowed.
- **Lock order** (T): `ORDER` becomes `day_sessions, tabs, orders, order_items, tickets, payments,
  till_shifts, refunds, stock_batches, court_advisory, reservations`. S needs no `ORDER` change: of
  its locks, only `stock_batches` is in `ORDER`.
- **`docs/design/assistant/pages.md`** sentences, with no figures in them:
  - R: the Team line and the kitchen-staff list name both roles;
  - P: `/deductions`, `/incidents`, and the content section on `/marketing`;
  - S: `/stock/moves` and the store wording on On hand, Goods in and Counts;
  - T: the shift wording on `/till/drawer` and `/admin/day-close`.

  Each commit that edits the file regenerates the map from a clean tree.

---

## 3. Error codes

**New codes (nine).** W0 lands the EN and AR strings at `op.errors.<CODE>` in
`opErrors.protocols.{en,ar}.ts`, and the mappings, before any raiser (the "never later" rule).

| Code | Raised by | Maps | EN | AR (draft for review) |
|---|---|---|---|---|
| `TRANSFER_SHORT` | `transfer_stock` (hint = ingredient_id, detail = the quantity the source shows) | `MAPPED_CODES` + `CODE_TO_KEY` | That store shows less than you are moving. Move what it shows, or ask a manager to count it. | المخزن يُظهر كمية أقل مما تنقله. انقل الكمية الظاهرة أو اطلب من المدير جرده. |
| `STORE_BEING_COUNTED` | `transfer_stock`, and `receive_delivery_internal`, which reaches `log_stock`, `receive_delivery` and `receive_purchase` (hint = the store; M5, V19) | both | That store is being counted right now. Try again when the count is finished. | يجري جرد هذا المخزن الآن. حاول مرة أخرى بعد انتهاء الجرد. |
| `TILL_SHIFT_ALREADY_OPEN` | `open_till_shift` | `MAPPED_CODES` only | You already have a till shift open. End it before you start another. | لديك وردية صندوق مفتوحة بالفعل. أنهِها قبل أن تبدأ وردية أخرى. |
| `TILL_SHIFT_STATION_BUSY` | `open_till_shift` | operator only | Someone else's shift is still open on this till. It has to be counted and closed first. | لا تزال وردية شخص آخر مفتوحة على هذا الصندوق. يجب عدّها وإغلاقها أولاً. |
| `TILL_SHIFT_NOT_FOUND` | close, close for | operator only | That till shift could not be found. | تعذّر العثور على وردية الصندوق هذه. |
| `TILL_SHIFT_CLOSED` | close, close for | operator only | This shift is already closed. Refresh to see the latest. | هذه الوردية مغلقة بالفعل. حدّث الصفحة لرؤية آخر المستجدات. |
| `TILL_SHIFT_NOT_YOURS` | close | operator only | This is someone else's shift. Closing it needs a manager's PIN. | هذه وردية شخص آخر. إغلاقها يحتاج رمز المدير. |
| `TILL_SHIFT_WRONG_STATION` | open, close, close for | operator only | Start and end a till shift at the till itself, signed in there. | ابدأ وردية الصندوق وأنهِها من الصندوق نفسه وأنت مسجّل الدخول عليه. |
| `TILL_SHIFT_UNSYNCED` | open, close, close for (V13) | operator only | This till still has sales waiting to send. Try again once they are sent. | لا تزال لدى هذا الصندوق مبيعات بانتظار الإرسال. حاول مرة أخرى بعد إرسالها. |

- **The phone maps** `COUNT_IN_PROGRESS` (raised by `submit_stock_count`) to a **new phone key**,
  `staff.stores.countWaiting` (V11). The operator's `op.errors.COUNT_IN_PROGRESS` says "finalize it
  first", which only a manager on the operator can do. EN: "This store already has a count open or
  waiting for a manager. Try again once a manager has finished it." AR (draft): "لهذا المخزن جرد
  مفتوح أو بانتظار المدير. حاول مرة أخرى بعد أن ينهيه المدير." W0 lands the key in the new
  `staff/stores.*` pair together with the `CODE_TO_KEY` row.
- **Reworded:** `op.errors.CANNOT_DECIDE_OWN` (`en.ts:1771`, `ar.ts:1669`), in W0 (V11). Today's
  "You cannot decide your own request." does not fit a deduction against oneself or a review of
  one's own incident report. New EN: "You cannot decide something you sent or that is about you."
  AR (draft): "لا يمكنك البتّ في أمر أرسلته أنت أو يخصّك." It still fits every existing raiser, each of
  which refuses the sender (the staff requests 0072 and 0160:337-338, the protocol engine
  0164:1118-1119, recipe changes 0183, shopping approval 0185:373-374), and both apps already map
  it.
- **Reworded:** `op.errors.PRICE_VIA_PROTOCOL` (§4.2). It is still operator only.
- The till-shift codes stay operator only because the phone never calls a till-shift RPC (M7). They
  go in the wave-5 block of `MAPPED_CODES` (`// Wave 5 (wave5-addendum-2026-09-25)`).

**Reused codes, each for the meaning its string already states** (verified present in both maps
unless marked):

| Situation | Code : hint | Raisers |
|---|---|---|
| A manager's rename of a launched size or paid add-on | `PRICE_VIA_PROTOCOL:name` (operator only; `op/lib/errors.ts:227`) | `upsert_variant`, `upsert_modifier` (also via `upsert_retail_variant`) |
| A bad rename in a proposal | `RECORD_INVALID:renames` (`:addons` for an empty add-on change) | price/promo propose |
| The owner renamed a target after approval | `PRICE_TARGET_CHANGED:size:<id>` / `:addon:<id>` | the apply |
| A wrong role, or a target outside the caller's reach | `FORBIDDEN` (hints `staff_id`, `location`, `purpose`) | all |
| Not found across venues (a deduction, incident, content item, court, delivery) | `REF_NOT_FOUND` (hints `court_id`, `delivery`, `lines`) | P, S |
| Already decided, withdrawn, reviewed or superseded | `SUBMISSION_DECIDED` | deductions, incidents, content |
| Deciding one's own, or one against oneself (the reworded string above) | `CANNOT_DECIDE_OWN` | `decide_deduction`, `cancel_deduction`, `review_incident`, `decide_content` |
| A decline, cancel or "changes" without a reason | `REASON_REQUIRED` | `decide_deduction`, `cancel_deduction`, `decide_content` |
| A cancel of a deduction that is not approved | `INVALID_TRANSITION` | `cancel_deduction` |
| An amount out of range | `INVALID_AMOUNT` | `propose_deduction` |
| A bad argument | `INVALID_ARGUMENT` (hints `date`, `kind`, `place`, `occurred_at`, `court_id`, `photos`, `channel`, `planned_for`, `media_link`, `images`, `decision`, `filter`, `location`, `lines`, `unit`, `expiry_date`, `purpose`, `unit_cost_iqd`, `range`, `note`) | P, S, T |
| Text | `TEXT_REQUIRED`, `TEXT_TOO_LONG` (hint = field) | P, S, T |
| Photos | `PHOTO_PATH_INVALID`, `UPLOAD_LIMIT` | P |
| A menu item or campaign at another venue | `ITEM_NOT_FOUND`, `CAMPAIGN_NOT_FOUND` | `submit_content` |
| Stock | `INVALID_QTY`, `INGREDIENT_NOT_FOUND`, `COUNT_IN_PROGRESS` (the phone shows `staff.stores.countWaiting`); `COUNT_NOT_FOUND`, `COUNT_FINALIZED` (operator only) | S |
| Till (operator only, all mapped) | `NO_OPEN_DAY`, `INVALID_FLOAT`, `INVALID_COUNT`, `INVALID_STATION`, `STATION_UNKNOWN`, `PIN_INVALID` (returned), `PIN_LOCKED`, `NO_PIN_SET`, `PIN_GRANT_REQUIRED`, `IDEMPOTENCY_CONFLICT` | T |
| Role writes | `INVALID_ROLE`, `ROLE_RETIRED` (unchanged) | R |

**Unreachable by design:** `EMPTY_DELIVERY` and `INVALID_LINE` from `log_stock` (M6). Neither app
maps them today (checked), and Goods in's handling is unchanged.

**Operator helpers.** `isRenameRefusal(e)` (N) sits beside `isRequiredAddonRefusal`
(`addonsLogic.ts:134`). The phone reads the `detail` of `TRANSFER_SHORT` to show the quantity
(`shortDetail`, S).

---

## 4. i18n

### 4.1 Namespaces and file pairs

Every AR fragment is typed `DeepMessages<typeof <en>>`, so a missing key fails typecheck, and
`packages/i18n/src/__tests__/t.test.ts:35` asserts parity.

| Surface | Namespace | File pair | Lane |
|---|---|---|---|
| Role labels | `op.roles.{assistant_barista,waiter}` | `en.ts` / `ar.ts` | R |
| Role hints on the Staff page | `ws.owner.staff.roleAccess.{assistant_barista,waiter}` | `ws/owner.*` | R |
| Error strings (§3) and the `PRICE_VIA_PROTOCOL` reword | `op.errors.*` | `opErrors.protocols.*` | W0 |
| The `CANNOT_DECIDE_OWN` reword | `op.errors.CANNOT_DECIDE_OWN` | `en.ts` / `ar.ts` | W0 |
| The phone's count refusal | `staff.stores.countWaiting` | `staff/stores.*` (W0 creates the pair with this key) | W0 |
| Shared vocabulary | `work.deduction.status.*`, `work.incident.{kind,place,status}.*`, `work.content.{status,decision,channel}.*`, `work.store.{cafe,bakery}` | `work.*` | W0 |
| Ledger label, stock sub-nav | `op.stock.movement.transfer`, `op.stockNav.moves` | `en.ts` / `ar.ts` | W0 |
| Size and add-on rename locks | `ws.release.menu.sizes.onSale` (reword), `ws.pricing.products.priceLocked` (reword), `ws.pricing.addons.nameLocked`, `ws.pricing.renameViaProtocol` | `ws/release.*`, `ws/pricing.*` | N |
| Rename fields | `ws.protocols.fields.{renames,renames_name_en,renames_name_ar}`, `ws.protocols.priceForm.renamedFrom`; `ws.team.tasks.form.field.{renames,renames_name_en,renames_name_ar}` (the `/tasks` start form); `staff.protocols.field.{renames,renames_name_en,renames_name_ar}`, `staff.protocols.renamedFrom` | `ws/protocols.*`, `ws/team.*`, `staff/protocols.*` | N |
| Operator `/deductions`, `/incidents`, the content section | `ws.deductions.*`, `ws.incidents.*`, `ws.content.*` | `ws/{deductions,incidents,content}.*` (W0 creates them; P fills them) | P |
| Phone deductions, incidents, content | `staff.deductions.*`, `staff.incidents.*`, `staff.content.*` | `staff/{deductions,incidents,content}.*` | P |
| Rail labels | `ws.shell.nav.{deductions,incidents}` | `ws/shell.*` | P |
| Audit labels | `ws.manager.audit.actions.<camelCase>`; `ws.manager.audit.families.incident` | `ws/manager.*` | P, S, T |
| Operator stores (Move stock, Added by staff, store pickers, Counts from the phone) | `ws.stores.*` | `ws/stores.*` | S |
| Phone stores (Add to stock, Move stock, Count the bakery) | `staff.stores.*` | `staff/stores.*` | S |
| Till shifts (rail, start panel, close dialog, drawer card, day-close step, staff activity panel) | `ws.tillShift.*` | `ws/tillShift.*` | T |
| Guest privacy line | `legal.*` | `legal.{en,ar}.ts` | P |
| Push copy | – | `send-push/staffStrings.ts` (§2.3) | P |

**Rules.**
- Staff free text (reasons, descriptions, people, captions, notes) is shown as typed, wrapped in
  `isolate()` wherever it is interpolated.
- Amounts use each app's IQD formatter, and never appear in a push.
- UI builds load `/impeccable`; the repo's token, RTL and testID rules win on conflict (memory
  `ui-work-uses-impeccable`).

### 4.2 Strings fixed here (EN, and AR drafts for review)

| Key | EN | AR |
|---|---|---|
| `op.roles.assistant_barista` | Assistant barista | مساعد باريستا |
| `op.roles.waiter` | Waiter | نادل |
| `ws.owner.staff.roleAccess.assistant_barista` | The kitchen screen, and My tasks from its header: their checklists, the bar team's teachings, recipe ingredients and their phone pages. | شاشة المطبخ، وصفحة «مهامي» من أعلاها: قوائم التحقق الخاصة به، وتعليمات فريق البار، ومكوّنات الوصفات، وصفحات هاتفه. |
| `ws.owner.staff.roleAccess.waiter` (R, #4) | A task list (My tasks): their checklists, cleaning photos included, and their phone pages. No till, desk or kitchen. | قائمة مهام («مهامي»): قوائم التحقق الخاصة به ومنها صور التنظيف، وصفحات هاتفه. بلا صندوق ولا مكتب ولا مطبخ. |
| `ws.owner.staff.roleAccess.waiter` (S, #24, V8) | A task list (My tasks): their checklists, cleaning photos included, and their phone pages, where they move stock between the cafe and the bakery. No till, desk or kitchen. | قائمة مهام («مهامي»): قوائم التحقق الخاصة به ومنها صور التنظيف، وصفحات هاتفه، ومنها ينقل المخزون بين المقهى والمخبز. بلا صندوق ولا مكتب ولا مطبخ. |
| `op.errors.CANNOT_DECIDE_OWN` (reword, W0) | You cannot decide something you sent or that is about you. | لا يمكنك البتّ في أمر أرسلته أنت أو يخصّك. |
| `staff.stores.countWaiting` (W0) | This store already has a count open or waiting for a manager. Try again once a manager has finished it. | لهذا المخزن جرد مفتوح أو بانتظار المدير. حاول مرة أخرى بعد أن ينهيه المدير. |
| `op.errors.PRICE_VIA_PROTOCOL` (reword) | Prices, size and add-on names, promotions, court rates and the featured-item discount change through a price or promotion change in Protocols. | تتغيّر الأسعار وأسماء الأحجام والإضافات والعروض وأسعار الملاعب وخصم الصنف المميز عبر تغيير سعر أو عرض في البروتوكولات. |
| `ws.release.menu.sizes.onSale` (reword) | This item is on sale, so its sizes' prices and names change through Change the price, with the owner's OK. | – (N writes the AR) |
| `ws.pricing.products.priceLocked` (reword) | This product is on sale, so its sizes' prices and names change through "Change the price", with the owner's OK. Everything else here is yours to edit. | – |
| `ws.pricing.addons.nameLocked` | This option is on sale, so its name changes through "Change the price", with the owner's OK. | – |
| `ws.pricing.renameViaProtocol` | Renaming a size or an option that is on sale goes through "Change the price", with the owner's OK. | – |
| `ws.protocols.fields.renames` / `_name_en` / `_name_ar`; `ws.team.tasks.form.field.*`; `staff.protocols.field.*` | New names · New name (English) · New name (Arabic) | – |
| `ws.protocols.priceForm.renamedFrom`; `staff.protocols.renamedFrom` | {from} → {to} | – |
| `op.stock.movement.transfer` | Moved between stores | نقل بين المخزنين |
| `op.stockNav.moves` | Move stock | نقل المخزون |
| `work.store.cafe` / `.bakery` | Cafe store / Bakery store | مخزن المقهى / مخزن المخبز |
| `work.deduction.status.{waiting,approved,declined,withdrawn,cancelled}` | Waiting / Approved / Declined / Withdrawn / Cancelled | بانتظار القرار / موافق عليه / مرفوض / مسحوب / ملغى |
| `work.incident.kind.{accident,injury,fight,damage,other}` | Accident / Injury / Fight / Damage / Other | حادث / إصابة / شجار / ضرر / أخرى |
| `work.incident.place.{court,cafe,shop,outside,other}` | Court / Cafe / Shop / Outside / Other | ملعب / المقهى / المتجر / خارج المكان / مكان آخر |
| `work.incident.status.{open,reviewed}` | Open / Reviewed | مفتوح / تمت المراجعة |
| `work.content.status.{waiting,changes,approved,declined,withdrawn}` | Waiting / Changes asked / Approved / Declined / Withdrawn | بانتظار الموافقة / طُلبت تعديلات / موافق عليه / مرفوض / مسحوب |
| `work.content.decision.{approve,changes,decline}` | Approve / Ask for changes / Decline | موافقة / طلب تعديلات / رفض |
| `work.content.channel.{instagram,tiktok,facebook,snapchat,whatsapp,telegram,guest_site,in_venue,print,other}` | Instagram / TikTok / Facebook / Snapchat / WhatsApp / Telegram / Guest site / In the venue / Print / Other | إنستغرام / تيك توك / فيسبوك / سناب شات / واتساب / تيليغرام / موقع الضيوف / داخل المكان / مطبوعات / أخرى |

- **The waiter's role hint.** It names "moving stock", so it ships in S's first UI commit or later,
  never before Move stock exists. R's commit (#4) ships the hint **without** that clause, and S's
  commit (#24) adds it, through the shared `ws/owner.*` row of §1.3. This way the hint never
  promises a page that does not exist yet. The clause puts the moves on the phone, because
  `/tasks` holds only a read-only copy of them (M2).
- **The incident push.** `incident_reported`'s `step` labels come from SQL, so the SQL `case` copies
  `work.incident.kind.*` exactly, and a P test pins the pair.
- **Wordings still to confirm** (OPEN §8 Q13): the guest privacy line (`legal.*`): "If an incident
  happens at the venue, staff may record what happened and who was involved. The record is kept for
  up to a year." The staff-notice wording goes in `docs/legal/staff-privacy-notice.md`.

---

## 5. Operator and mobile pages per role

Only the wave-5 additions are listed here. Everything from waves 1–4 stays (contracts §5, §6.1).
Hussein 2 is the court desk. Maha is the cashier, and she also covers the desk.

### 5.1 By role

| Role (person) | Operator | Phone |
|---|---|---|
| **owner** | `/deductions`: decide, month, **cancel**, propose. `/incidents`: review, **redact**, report. `/marketing` "Content for approval": decide. Stock: Move stock, the store pickers on Goods in, "Bought by the driver" and waste and production, "Added by staff" (set cost), Counts by store (apply or discard phone counts), On hand per store, and store columns on Expiry, Ledger and Variance. `/admin/day-close`: the "Till shifts" step. `/till/drawer`: the shifts on this till. `/reports/staff`: a Till shifts panel. Staff: the two new roles. `/protocols`: rename rows on price and add-on forms, and renames on numbers. Observe home and `/ops`: deductions, incidents, posts and till-shift differences | `staff-deductions` (propose; "decide on the operator"); `staff-incidents` (report, review); `staff-content` (decide); `staff-stock-log`, `staff-stock-move`, `staff-stock-count` (either store); `staff-start` and `staff-step` renames |
| **manager** | As the owner, **except** cancel, redact and content. Also works a cashier's open drawer, with a banner (`payOnOthersShift`) | as the owner, minus content |
| **head_barista** (Bareq) | `/tasks`: "My deduction proposals: on your phone" and the Today-in-stores copy | `staff-deductions` (propose for the bar team, including Hussein; my proposals; mine); `staff-stock-log` (purchased; cafe default, bakery allowed); `staff-stock` (by store); `staff-incidents` |
| **barista** (Yusuf) | – | `staff-deductions?view=mine`; `staff-incidents` |
| **assistant_barista** (Hussein) **new** | lands on `/kds` (the bar's tickets, set status and ready) with "My tasks (N)". `/tasks` copies: checklists, teachings (bar), recipes (names only), requests, marketing requests, item notes, suggestions | Today: Checklists; Teachings (bar, read); Recipes (names only); Suggestions; Vacation and requests (+ My deductions); Ask marketing; Notes on new items; Incidents |
| **cashier** (Maha) | **Till shift:** a rail row under the break row ("My shift · since 9:02" + End my shift, or Start my shift). A start panel on `/till` and the payment pane: the handover ("Maha left 1,250,000 IQD in the drawer at 4:02 PM" → "That's right", or "I counted a different amount"), with the first shift of the day prefilled with the day's float. The payment gate ("Start your shift to take payment" / "Maha's shift is still open on this till" + "Close Maha's shift" by manager PIN) **fails open** offline or unknown, and never gates `OfflineTabPanel`. End my shift: blind count → own PIN → result card → Sign out. The leaving guard on Sign out and Switch user. A "Your shift" card on `/till/drawer`, with no expected figure. **`/incidents`:** report, my reports. `/tasks`: the Today-in-stores copy | `staff-stock-log` (purchased and retail; cafe default); `staff-incidents`; `staff-deductions?view=mine` |
| **waiter** (Hasan) **new** | lands on `/tasks` (workspace `team`): copies of checklists (the cleaning list), stock (by store) and Today-in-stores (moves), plus requests, marketing requests, item notes and suggestions (M2) | Today: Checklists (photo-required ticks, folder `checklists`); **Move stock** (`staff-stock-move`); Stock (by store); Suggestions; Vacation and requests (+ My deductions); Ask marketing; Notes on new items; Incidents |
| **court_desk** (Hussein 2) | **`/incidents`:** report, my reports (rail row before My tasks). A desk shift at each handover, counting the desk's own cash box (§8 Q28, answered; §2.9.9). `/tasks`: the Today-in-stores copy | `staff-stock-log` (retail, cafe only); `staff-incidents`; `staff-deductions?view=mine` |
| **head_chef** (Rusul) | `/tasks`: "My deduction proposals" and the Today-in-stores copy. Production now lands in the bakery | `staff-deductions` (propose for the kitchen team); `staff-stock-log` (purchased; bakery default, cafe allowed); `staff-stock-count` (bakery); `staff-stock` (by store); `staff-incidents` |
| **chef** (Tiba, "Chef assistant") | `/tasks`: the Today-in-stores copy (her counts). Production lands in the bakery | `staff-stock-count` (bakery, blind); `staff-incidents`; `staff-deductions?view=mine` |
| **driver** | – | `staff-incidents`; `staff-deductions?view=mine` |
| **marketing** | `/tasks`: a **Content** section with full write (submit, revise, withdraw; images as files through `PhotoField`, folder `campaigns`; **PROPOSAL**). `/protocols`-equivalent starts on `/tasks` gain rename fields | `staff-content` (submit, revise, withdraw, queue, reasons); `staff-incidents`; `staff-deductions?view=mine`; `staff-start` renames |
| **prep** (retired) | – | `staff-incidents`; `staff-deductions?view=mine` |

### 5.2 Operator: routes, rail, capabilities, keys

- **`ROUTE_ROLES`** (`op/lib/auth.tsx`):
  - `'/deductions': ['manager','owner']`;
  - `'/incidents': ['court_desk','cashier','manager','owner']`;
  - `'/kds'` adds `assistant_barista`;
  - `'/tasks'` adds both new roles;
  - `SUB_ROUTES['/stock']` adds `/stock/moves` (registered in `routes/stock/_children.ts` and the
    sub-nav).
- **Pages:** `features/deductions/DeductionsPage` and `features/incidents/IncidentsPage` are lazy
  and registered in `op/main.tsx`.
- **Rail** (`op/lib/workspaces.ts`):
  - `labelKey` gains `deductions` and `incidents`;
  - `DEDUCTIONS = {to:'/deductions', labelKey:'deductions', icon:'banknote', badge:'deductionsWaiting'}`
    goes in `OWNER_OBSERVATION` after `/observation/requests`, and is appended to `MANAGER_RUN`;
  - `INCIDENTS = {to:'/incidents', labelKey:'incidents', icon:'alert', badge:'incidentsOpen'}` (the
    badge counts for MGMT only) is appended to `COURT_DESK` and `CASHIER` before `MY_TASKS`, to
    `MANAGER_RUN`, and to `OWNER_OBSERVATION` after `SUGGESTIONS`;
  - the Marketing row (owner) gains `badge:'contentWaiting'`;
  - the icons are **PROPOSAL**; the owner rail keeps four sections; `workspaces.test.ts` follows.
- **`CAPABILITY_ROLES`** (no inline role checks; buttons follow the RPC's `can_*`):
  - `proposeDeductions: ['head_barista','head_chef','manager','owner']`,
    `decideDeductions: ['manager','owner']`, `cancelDeductions: ['owner']`;
  - `reportIncidents: ['court_desk','cashier','manager','owner']`,
    `reviewIncidents: ['manager','owner']`, `redactIncidents: ['owner']`;
  - `submitContent: ['marketing']`, `decideContent: ['owner']`;
  - `payOnOthersShift: ['manager','owner']`.
- **`QK`:**
  - `deductionsWaiting: ['deductions','waiting']`;
  - `incidentsOpen: ['incidents','open']`;
  - `contentWaiting: ['content','waiting']`;
  - `tillShift: (station) => ['tillShift', station]` (refetches every 30 s and on focus, and its own
    writes invalidate it);
  - S keeps its count and store keys feature-private (`stockKeys.ts`, under `['stock', …]`).
- **Writes.** All go through `appRpc`, online-only, with no new queued type. The one queued-payload
  change is S's optional `location` on `stock.waste`. The keys are
  `` `${intent}:${crypto.randomUUID()}` ``, with the intents `deduction.propose`,
  `incident.submit`, `content.submit`, `content.revise`, `stock.move`, `stock.log`, `stock.count`,
  `till_shift.open` and `till_shift.close`. A key is minted when the form opens, reused on retry
  and replaced after success.
- **Pages in detail:**
  - `/deductions` has three tabs:
    - Waiting: Approve, and Decline with a reason, using the `DecisionDialog` shape of
      `StaffRequests.tsx:258`;
    - Month: a month stepper, a per-person table that expands, the totals line, the owner's Cancel,
      and "Propose a deduction";
    - All.
  - `/incidents` has the report form, with the privacy hint, photos through `PhotoField` (folder
    `incidents`) and a court picker. Station roles also get "My reports". MGMT get Open, Reviewed
    and All, with a sheet showing photos by signed URL (600 s) and a Review note ("The reporter
    sees this note"). The owner gets Redact, with a confirm.
  - `/marketing` Content has Waiting, Changes asked, Approved, Closed and All. Its sheet shows every
    version, images by signed URL, and the link as text with a copy button. The owner may Approve,
    Ask for changes or Decline (the last two need a reason) and never edits the text.
  - `/stock/moves` has a from/to form with lines, the recent moves, and a first-day "opening move"
    call-out (§7.4).
  - Goods in gets "Put it in: Cafe store / Bakery store", the same picker on "Bought by the
    driver" (Bakery is disabled for a shop line, V14), and an "Added by staff" card: 14 days, estimated cost and its source, "Needs a cost"
    first, and Set cost per base unit or per pack.
  - Counts: pick the store before Start; `fetchOpenCount` filters `source = 'operator'` and the
    store; a "Counts from the phone" list (counted lines, difference and its value, Apply with
    editable lines, Discard), with a badge while one is waiting.
  - Waste and production get a store picker; production defaults to Bakery.
  - The Ledger gets `'transfer'` in `MOVEMENT_TYPES` and a store column. Variance gets the store and
    "Moved" columns. AlertsPanel's `negative_stock` line names the store. Reports ▸ Stock gains the
    store tag and `transferQty`.
  - `/admin/day-close` gets a "Till shifts" step from `till_shift_list`. It shows each shift, with
    the difference as a sign word (the `dayCloseLogic.ts` helpers), and the "Taken outside a shift"
    rows. It also shows one line for refunds made today for earlier days' payments (`cross_day`),
    which the day's expected cash leaves out (TI5, V10). An open shift is a **warning, never a
    block**: `deriveDayCloseState` and `closeBlock` are unchanged. The CSV gains shift rows.
- **Observe home and `/ops`:** "N deductions to decide", "N incidents to review", "N posts to
  approve" (owner), and `OPS_WORK_ALERTS` `{key:'tillShifts', severity:'warn', href:'/admin/day-close'}`
  (today's closed shifts with a non-zero difference; OPEN §8 Q27).
- **Setup "Worth checking":** "N staff stock additions need a cost" (S); "N cashiers have no PIN and
  must close their shift with a manager's PIN" (T).
- **Audit `ACTION_KEYS`:**
  - P: `staff.deduction.{propose,withdraw,approve,decline,cancel}`,
    `incident.{report,review,redact,purge}` and
    `marketing.content.{submit,revise,withdraw,approve,changes,decline}`, plus `FAMILY_KEYS`
    `incident`;
  - S: `stock.{transfer,log,price_log,submit_count,discard_count}`;
  - T: `drawer.{shift_open,shift_close,shift_close_by_day}`.

### 5.3 Mobile: screens, rows, keys, smoke

| Route file | Roles (`RequireStaff`) | Reads | Writes | Primary testID |
|---|---|---|---|---|
| `staff-deductions.tsx?view=&id=` | all (`view=mine`); DEDUCT for Propose and My proposals | `my_deductions`, `deduction_targets`, `my_deduction_proposals` | `propose_deduction` (key `staffIntentKey('deduction.propose','deduction')`), `withdraw_deduction`. MGMT see "N waiting: decide on the operator" | `staff-deductions.propose` (smoke as head_barista) |
| `staff-incidents.tsx?id=` | all | `my_incidents`, `incidents_page` (MGMT), `courts` | `staff_media_slot` (folder `incidents`), `submit_incident` (key `incident.submit`), `review_incident` (MGMT) | `staff-incidents.submit` |
| `staff-content.tsx?id=` | marketing, owner | `content_page`, `content_detail` | `staff_media_slot` (folder `campaigns`), `submit_content`, `revise_content`, `withdraw_content`, `decide_content` (owner) | `staff-content.submit` (smoke as marketing) |
| `staff-stock-log.tsx` "Add to stock" | LOG | `stock_pick_list('log', store)`, `stock_today` (added today; "N driver deliveries are waiting for the manager: do not add those here") | `log_stock` (key `log:<store>`) | `staff-stock-log.save` |
| `staff-stock-move.tsx` "Move stock" | MOVE | `stock_pick_list('move', from)` (on-hand at the source), `stock_today` | `transfer_stock` (key `move:<from>`) | `staff-stock-move.move` |
| `staff-stock-count.tsx` "Count the bakery" | COUNT | `stock_pick_list('count', 'bakery')` (names and units only), `stock_today` (your counts) | `submit_stock_count` (key `count:<store>`) | `staff-stock-count.submit` |
| `staff-stock.tsx` (H's; changed) | STOCK_VIEW | `staff_stock_view` (`by_location`) | – | unchanged `staff-stock.list`; new `staff-stock.store.<location>` tabs (none for the desk) |
| `staff-request.tsx` (B's; changed) | all | – | – | a new "My deductions" row → `/staff-deductions?view=mine` (`staff-request.deductions`) |
| `staff-marketing.tsx` (H's; changed) | marketing | – | – | a "Content for approval" row → `/staff-content` |
| `staff-start.tsx`, `staff-step.tsx` (H's; changed) | as today | + `price_promo_numbers.renames` | + `renames` in the price and add-on-price records | unchanged |

- **Today rows** (`rows.ts`, appended by each screen's lane):
  - `deductions` (DEDUCT);
  - `incidents` (all; for MGMT it reads "Incidents (N to review)");
  - `content` (marketing, owner; "Content for approval (N)");
  - `stock-log` (LOG), `stock-move` (MOVE), `stock-count` (COUNT);
  - the existing `teachings` and `recipes` rows follow R's constants, and `stock` gains the waiter.
- **testIDs:**
  - `staff-deductions.{propose,target.<staffId>,amount,date,reason,submit,withdraw.<id>,item.<id>,month.prev,month.next}`;
  - `staff-incidents.{submit,kind.<kind>,place.<place>,court.<courtId>,when,description,people,photo.add,item.<id>,review.<id>,review.note,review.confirm}`;
  - `staff-content.{submit,title,channel.<channel>,planned,body,link,note,photo.add,item.<id>,revise,withdraw,decide.approve,decide.changes,decide.decline,decide.note,decide.confirm}`;
  - `staff-stock-log.{store.<location>,item.<ingredientId>,unit.<ingredientId>,remove.<ingredientId>}`;
  - `staff-stock-move.{swap,item.<ingredientId>}`;
  - `staff-stock-count.item.<ingredientId>`;
  - `staff.row.<rowId>` for each new row.

  Nothing may collide with `start-shift` (`op/lib/audio.ts:144`).
- **`staffKeys`** (`mob/src/features/staff/keys.ts`), all under `['staff', …]`:
  - P: `deductionTargets(venue)`, `myDeductions(venue, month)`, `myDeductionProposals(venue)`,
    `myIncidents(venue)`, `incidents(venue, filter)`, `content(venue, filter)`, `contentDetail(id)`;
  - S: `stockPick(venue, purpose, location)`, `stockToday(venue)`.
- **`StaffMutation`** (`mob/src/lib/idempotency.ts:66`) gains `'deduction' | 'incident' | 'content'`
  (P) and `'stock_log' | 'stock_move' | 'stock_count'` (S). **Every** staff `useMutation` passes
  `mutationKey: staffKeys.mutation(<name>)`, keyed or not, so a write never pauses offline
  (contracts §6.4).
- **Smoke:**
  - rows in `mob/src/smoke/routes.ts` under `// ── staff ──`, each landing in its screen's commit;
  - `staffPeople.smoke.test.tsx` (P: three routes) and `staffStores.smoke.test.tsx` (S: three
    routes), in EN and AR, each rendered with a role that sees its primary element.
- **`CODE_TO_KEY`:** `TRANSFER_SHORT`, `STORE_BEING_COUNTED`, and `COUNT_IN_PROGRESS` →
  `staff.stores.countWaiting` (W0, V11).
- **The no-station guard** (`noStationRpc.test.ts`, M7):
  - `till` gains `open_till_shift`, `close_till_shift`, `close_till_shift_for`,
    `till_shift_status` and `till_shift_list` (T);
  - the manager-only list gains `start_count`, `finalize_count`, `discard_count`,
    `price_logged_stock` and `receive_purchase` (S).

  `record_waste`, `record_production` and `receive_delivery` are already there. `cancel_deduction`,
  `decide_deduction` and `redact_incident` are left off: their guards are the wall, as for
  `decide_staff_request`.
- **Pure logic (vitest):**
  - `mob/src/features/staff/{deductions,incidents,content}/logic.ts`;
  - `mob/src/features/staff/stores/logic.ts`: `LOG_ROLES`, `MOVE_ROLES`, `COUNT_ROLES`,
    `logKindsFor`, `logStoresFor`, `homeStore`, `toBaseQty`, `shortDetail`;
  - `stock/logic.ts` gains the waiter in `STOCK_ROLES` and `byStore`.

  Each role constant mirrors its RPC guard.
- **The till stays operator-only.** There is no mobile till-shift page (the contracts §0 decision
  of 2026-09-23).

---

## 6. Tests and acceptance

### 6.1 DB tests (each new file carries its own driver and marketing denials, contracts §8.2)

- **`assistant-barista-waiter.test.ts`** (R, new; the `new-roles.test.ts:1-26` pattern, one staff
  row per role through the service role, removed in `afterAll`):
  - **Both roles** hold the baseline: `break_status`, the heartbeat on a probe station,
    `submit_staff_request('leave')`, `add_suggestion`/`my_suggestions`, `my_checklists_today`,
    `add_marketing_request`, `add_release_note` and `my_protocol_work`.
  - **assistant_barista:**
    - `kitchen_board` returns the probe ticket with no key ending `_iqd`; `set_ticket_status` and
      `set_order_item_ready` work; `tickets` gives rows;
    - zero rows from `tabs`, `orders`, `order_items` and `order_item_modifiers`;
    - `teachings_for_me` gives the bar's teachings and not the kitchen's, and `p_team:'kitchen'` →
      `FORBIDDEN`. A head barista's new teaching queues `teaching_new` for him, he reads its photo,
      and `save_teaching` → `FORBIDDEN`;
    - `recipe_view` gives no `qty`, `quantity` or `unit` key;
    - `FORBIDDEN` on `shopping_list`, `add_shopping_item`, `staff_ingredient_options`,
      `staff_stock_view`, `submit_release_idea`, `request_recipe_change`, `record_batch`,
      `production_today`, `start_protocol`, `marketing_requests_page`, `open_tab`,
      `staff_create_reservation` and `ack_waiter_call`.
  - **waiter:**
    - `FORBIDDEN` on `kitchen_board`, `set_ticket_status`, `teachings_for_me`, `recipe_view`,
      `shopping_list` and `open_tab`; he acks and resolves a call at his venue only (§2.1.8);
    - zero rows from `tickets` and the four order tables;
    - with an owner-written `waiter` close list that has a photo item: a tick without a photo →
      `RECORD_INVALID:photo_path`, and a tick with a slot photo passes;
    - that photo is readable by a second waiter and by MGMT, and not by a driver, marketing or a
      barista.
  - **Hiring and templates:** `open_position {role:'waiter'}` and `{role:'assistant_barista'}` pass;
    an owner step with `actor_roles ['waiter']` saves; `set_staff_role` moves an account onto each
    role and back.
  - **Unchanged:** driver and marketing are still `FORBIDDEN` on `kitchen_board`,
    `teachings_for_me` and `recipe_view`.
  - **Edited committed tests** (R's cases only): `kitchen-board.test.ts`, `teachings.test.ts`,
    `recipe-view.test.ts`, `hiring.test.ts`, `staff-admin.test.ts` (`checkCreateRole` passes both).
- **`price-promo.test.ts`** (N):
  - **The edits.** In the first case (:277-395), `m_rename` and `m_mod_rename` →
    `PRICE_VIA_PROTOCOL:name`. `m_mod_off`, `m_mod_on_again` and `m_mod_old_back` send the stored
    names (`'PP mod_on'`, `'إضافة'`). A new `m_mod_old_rename` → `:name`. The ok list loses both
    renames. In the compulsory case (:396-495), the `mod` helper defaults to the stored names, and
    `m_oat_rename` → `:name`.
  - **New cases**, each as manager and as owner:
    - a launched size's rename is refused via `upsert_variant` and via `upsert_retail_variant`;
    - a whitespace-only difference, a default or order change, and a draft item's rename all pass;
    - a launched paid add-on's rename is refused, while a free one and a hidden never-launched one
      pass;
    - a group move that keeps its name passes;
    - a `price` run with renames only, and a Small↔Large **swap** in one run, proposed by the
      manager and by marketing: the owner approves and it applies now. The names swap, and prices
      and `recipe_lines` are unchanged, with `counts.renamed = 2`;
    - a shop size rename also renames its retail ingredient;
    - an `addon_price` run with renames only;
    - the owner renames a size after approval → `PRICE_TARGET_CHANGED:size:<id>`, and the cron
      reverts it with `apply_not_ready`;
    - `RECORD_INVALID:renames` for another item's size, an unchanged name, a blank or over-80 name,
      a duplicate, and a never-launched add-on;
    - `price_promo_numbers` returns `renames`;
    - `FORBIDDEN` for driver, cashier, barista, assistant_barista and waiter on
      `start_protocol('price_promo')` and `price_promo_numbers`, and for marketing on
      `price_promo_numbers`.
  - **Checked unaffected:** `product-release.test.ts:293` (a draft in release) and `shop.test.ts`
    (it raises before `upsert_variant`).
- **`salary-deductions.test.ts`** (P):
  - **Proposing:**
    - Bareq proposes for a barista **and for Hussein** (M9). MGMT get `deduction_proposed`, and
      the person does not. The outbox payload has no `amount*` key, no digits of the amount and no
      target name;
    - Bareq for a chef, another head_barista, himself or an owner → `FORBIDDEN:staff_id`, while
      Rusul for a chef passes;
    - a manager proposes for the cashier and for the waiter.
  - **Deciding and cancelling:**
    - an approval sends `deduction_approved` to the proposer and `deduction_recorded` to the
      person;
    - a decline without a note → `REASON_REQUIRED`;
    - deciding one's own proposal, or one against oneself → `CANNOT_DECIDE_OWN`;
    - a repeat decide, or a withdraw after the decision → `SUBMISSION_DECIDED`;
    - the owner cancels with a reason, a manager's cancel → `FORBIDDEN`, and cancelling a waiting
      row → `INVALID_TRANSITION`.
  - **Reads:**
    - `my_deductions` gives approved and cancelled rows only, with no `proposed_by*`,
      `decision_note` or `cancel_reason`;
    - `my_deduction_proposals` gives the proposer's own only;
    - the month totals exclude waiting and cancelled rows;
    - another venue's row → `REF_NOT_FOUND`.
  - **Limits:** a replayed key returns the first id; 0 or 2,000,001 → `INVALID_AMOUNT`; tomorrow
    or 61 days ago → `INVALID_ARGUMENT:date`.
  - **The pay month** (V16): take a row dated in the previous month and approved now. Its
    `pay_month` is the current business month, it is counted in this month's `deductions_month`
    and `my_deductions` with `dated_earlier: true`, and it is in neither view for last month. A
    decline leaves `pay_month` null, and a cancel keeps it.
  - **Denials:** barista, assistant_barista, chef, cashier, court_desk, waiter, driver and marketing
    are refused `propose_deduction`, `deduction_targets`, `decide_deduction`, `deductions_page` and
    `deductions_month`.
  - **The LLM wall:** no readable-columns row. Every `staff.deduction.%` audit row has no key other
    than `status` in `before` or `after` (so no `staff_id`, amount, reason or note), and its
    `reason_code` is null (V17).
- **`incident-reports.test.ts`** (P):
  - **Filing:**
    - every role (driver, marketing and both new roles included) files a report;
    - MGMT get `incident_reported`, whose params are only `name` and the kind label;
    - `court` without a court → `INVALID_ARGUMENT:court_id`, and another venue's court →
      `REF_NOT_FOUND`;
    - `occurred_at` 8 days back is refused;
    - another person's slot, or one in `requests` → `PHOTO_PATH_INVALID`.
  - **Reviewing:**
    - a review without a note → `TEXT_REQUIRED`;
    - reviewing one's own report → `CANNOT_DECIDE_OWN`, and a second review →
      `SUBMISSION_DECIDED`;
    - the reporter gets `incident_reviewed` and sees the note.
  - **Reads:** `incidents_page` is refused to every non-MGMT role.
  - **Photos:** through `storage.objects`, the reporter, a manager and the owner can read an
    incident photo, and no other court_desk account, driver or marketing can.
  - **Purge and redaction:**
    - `incident_purge_due` leaves the marker and the NULLs;
    - `incident_photo_purge_due` lists the paths, and `incident_photos_purged` empties them;
    - `redact_incident` is owner-only and state-idempotent;
    - the pinned pair (the SQL kind labels = `work.incident.kind.*`).
  - **The LLM wall:** no readable-columns row.
- **`marketing-content.test.ts`** (P):
  - **The approval loop:**
    - a submit sends `content_submitted` to each owner;
    - the owner asks for changes with a reason; version 2 re-uses version 1's image and adds one;
    - deciding version 1 now → `SUBMISSION_DECIDED`; version 2 is approved; a revise after that →
      `SUBMISSION_DECIDED`.
  - **Refusals:**
    - a decline without a reason → `REASON_REQUIRED`;
    - a manager is refused on `decide_content`, `content_page` and `content_detail`;
    - a manager's direct `select` on `marketing_content` and `marketing_content_versions` returns
      zero rows, and the owner's returns the item (V4);
    - barista, court_desk, cashier, driver and both new roles are refused on `submit_content`;
    - another item's image → `PHOTO_PATH_INVALID`;
    - a past `planned_for`, an `http://` link or 11 images → `INVALID_ARGUMENT`;
    - another venue's campaign → `CAMPAIGN_NOT_FOUND`.
  - **Photos:** a second marketing account and the owner read the images, and a driver and a
    manager do not (V4).
  - **Coverage:** `marketing_content` has readable-column rows, and the versions table has none.
- **`staff-media-incidents.test.ts`** (P):
  - a slot in `incidents`, while the nine old folders still mint;
  - the CHECKs pass a ten-folder path;
  - the helpers return NULL or `false` on `items/…`;
  - an authenticated user still reads and uploads `menu-media`;
  - `is_staff_media_path` has no `proconfig` (M1);
  - `staff-media-folders.test.ts` `FOLDERS` gains `incidents`.
- **Push tests:** in `staff-push-keys.test.ts` and `staff-push.test.ts`, each of the ten keys
  queues a row, and the JSON equals the SQL lists in order. `send-push-staff.test.ts` checks EN
  and AR copy for every key.
- **`stored-fields.test.ts`:** the three `UNLINKED_PERSONAL` cases.
- **`protocol-action` vitest:**
  - the incident phase removes the paths and marks them;
  - a failing `incidentPurgeDue` leaves the launch and run-purge counts intact;
  - the regex accepts `incidents/…`.
- **Stores (S):**
  - `stock-locations.test.ts` covers I2, I3, I5, I6, I7 and I10, and also:
    - production draws the bakery first and lands there;
    - a product test by a head chef draws the bakery first, and by a head barista the cafe first;
    - `record_waste` and both receive paths work with `p_location 'bakery'`;
    - another venue's ingredient → `INGREDIENT_NOT_FOUND`;
    - the refund restock prefers a cafe batch;
    - `v_stock_by_location` is MGMT only and sums to `v_ingredient_on_hand`;
    - `relfilenode` is unchanged.
  - `stock-transfers.test.ts` covers I1, I4, I8, I11 and I14, and also:
    - both directions, and a split over two batches;
    - a ping-pong keeps `origin_batch_id` at the root;
    - retail → `INVALID_ARGUMENT:kind`, and the same store → `:location`;
    - the waiter, manager and owner may move;
    - a two-line transfer whose `p_lines` lists the ingredients against `ingredient_id` order runs
      beside two-ingredient sales with no 40P01 (I5, V15);
    - head_barista, barista, assistant_barista, head_chef, chef, cashier, court_desk, driver and
      marketing → `FORBIDDEN`;
    - a `start_count` racing a transfer on the same store serialises on the advisory lock (M5).
  - `stock-logs.test.ts` covers I12, I13, I15 and I16, and also:
    - a retail line at the bakery is refused on `log_stock`, `receive_delivery` and
      `receive_purchase` alike (V14);
    - a Goods in receipt into a store with an operator count open → `STORE_BEING_COUNTED` (V19);
    - the kinds and stores per role;
    - the desk at the bakery → `FORBIDDEN:location`, and prepared → `:kind`;
    - the pack conversion;
    - the audit carries counts only;
    - an empty `p_lines` → `INVALID_ARGUMENT:lines`, never `EMPTY_DELIVERY` (M6);
    - barista, chef, waiter, driver and marketing → `FORBIDDEN`.
  - `stock-counts.test.ts` (the first end-to-end count test) covers I9, and also:
    - head_chef and chef submit at the bakery, and the cafe → `FORBIDDEN`;
    - a second submission at the same store → `COUNT_IN_PROGRESS`, while a cafe operator count
      runs alongside;
    - `discard_count`;
    - a phone count finalised with edited lines;
    - `report_stock` carries `location` and `transferQty`;
    - the other roles → `FORBIDDEN`.
  - `stock-store-reads.test.ts`:
    - `stock_pick_list` per purpose and role: `count` has no quantity key, `move` has on-hand, and
      `log` has the role's kinds;
    - `stock_today`'s sections per role;
    - I12;
    - driver and marketing are refused for every purpose.
  - **Edited:**
    - `staff-stock-view.test.ts`: `by_location`, and the waiter's kinds;
    - `staff-production.test.ts`: the bakery batch;
    - `product-release.test.ts`: the test's store;
    - `shopping-purchases.test.ts`: a bakery receive;
    - `replay-mutate-parity`: `location` present and absent;
    - `staff-roles-parity.test.ts`: `stock_location` = `STOCK_LOCATIONS`.
- **`till-shifts.test.ts`** (T; every write heartbeats first):
  - **T1 Open:**
    - the row is right, and a replay → `duplicate:true`;
    - `IDEMPOTENCY_CONFLICT`, `TILL_SHIFT_ALREADY_OPEN`, `TILL_SHIFT_STATION_BUSY` and
      `NO_OPEN_DAY`;
    - `INVALID_FLOAT`, `INVALID_STATION`, `STATION_UNKNOWN` (retired, and venue B),
      `TILL_SHIFT_WRONG_STATION` (no fresh beat) and `TEXT_TOO_LONG`.
  - **T2 Denials:** driver, marketing, head_barista, barista, head_chef, chef, prep,
    **assistant_barista and waiter** (M9); `till_shift_list` is refused to cashier and court_desk
    as well; anon and a guest.
  - **T3 Attribution:**
    - a cash `settle_tab` at TILL-01 gets the shift;
    - a desk payment with no shift → null, and a null device → null;
    - a manager `refund` at TILL-01, with `p_device_id`, **succeeds** and gets `device_id` and the
      shift. This is the case the shared-SELECT trigger failed (V1);
    - a refund at a station whose only open shift belongs to a force-closed day → null;
    - a service-role insert with a bogus `till_shift_id` is overwritten.
  - **T4 Own close:**
    - a wrong PIN → `{ok:false, code:'PIN_INVALID'}`, and the attempt row persists;
    - five wrong PINs → `PIN_LOCKED`, and no PIN set → `NO_PIN_SET`;
    - the right PIN stamps the math, and the audit row carries no note;
    - a replay → the same body and no second audit row;
    - `TILL_SHIFT_CLOSED`, `TILL_SHIFT_NOT_YOURS` and `TILL_SHIFT_WRONG_STATION`.
  - **T5 Unsynced:** queue depth after `opened_at` → `TILL_SHIFT_UNSYNCED`, and an older depth does
    not block. **Open** (V13): with no shift open and a queued depth on TILL-01, `open_till_shift`
    → `TILL_SHIFT_UNSYNCED`. The "replayed" `settle_tab` then lands null (outside). Once the depth is
    0, the open works, and those payments stay null, not the new shift's.
  - **T6 Close for:** no grant → `PIN_GRANT_REQUIRED` and a working retry; `manager_pin` with
    `authorized_by`; a no-PIN cashier closes her own this way.
  - **T7 Handover:** a count of 250,000 then a float of 245,000 → −5,000. A payment between the
    close and the next open → null, and after the open → B. A 20,000 cash sale between the shifts,
    with a float of count + 20,000 → handover 0 and `outside_cash_since_iqd = 20,000`. A manager's
    5,000 cash refund in between, with a float of count − 5,000 → handover 0 (V18).
  - **T8 `close_day`:**
    - an open shift is closed `day_close`, and `shifts_closed_with_day = 1`;
    - a `DAY_OPEN_TABS` refusal leaves the shift open;
    - the day's expected cash equals the 0020 formula;
    - the next day's open works, with no handover.
  - **T9 Race:** 20 rounds of `settle_tab` ∥ `close_till_shift`. The stamped sum equals the
    attributed rows, and the new payment carries S or null, never S while missing from S's sum.
  - **T10–T15:** the TI invariants, a negative expected, the self-heal after `forceCloseAllDays`,
    RLS (MGMT at venue A only), the status shaping (no `cash_expected_iqd` key for a cashier), and
    the list's `outside` rows and its 62-day cap.
  - **T16 Cross-day refund** (V10): inside today's shift, refund yesterday's 30,000 cash payment.
    The shift's `cash_refunds_iqd` includes it. Today's summary `refunds_iqd` does not, and
    yesterday's (live) does. Today's `cross_day.earlier_days_cash_refunds_iqd` = 30,000 and
    yesterday's `later_cash_refunds_iqd` = 30,000. TI6 holds for both days with the term, and so
    does TI7 for today.
  - `desk-payment.test.ts` and `cafe-flow.test.ts` pass **untouched**.
- **Gates** (contracts §8.1, the DB row):
  - `check:migrations` (with the waivers);
  - `check:rpc-registry`, `check:assistant-coverage`;
  - `check:authz`, `check:locks` (T's new `ORDER`), `check:safeupdate`, `check:invariants`
    (definer `search_path`; `v_stock_by_location` `security_invoker`), `check:broadcast`,
    `check:analytics` (SEC-29);
  - `db:types` after the §1.4 reset;
  - the parity test with the stack up;
  - the whole existing DB suite, green (S's I7).

### 6.2 Client tests

- **Core:**
  - `roles.test.ts` (R);
  - `stores.test.ts` (S);
  - `protocols.test.ts`, the rename rules (N);
  - `mutations.test.ts`, the optional `location` (S);
  - a `PHOTO_FOLDERS` case (P).
- **Operator:**
  - `auth.test.ts`: `/kds`, `/tasks`, `/deductions`, `/incidents`, `homeRoute`, and the new
    capabilities, with `payOnOthersShift` MGMT only;
  - `workspaces.test.ts`: the rows, badges and four owner sections;
  - `auditLogic.test.ts`, `errors.test.ts` (the nine codes, and both catalogs typed);
  - `floorModel.test.ts`, `tasksLogic.test.ts` (TEAM_READERS, the waiter's copies, `storeToday`),
    the Staff picker order, and the two unknown-role examples;
  - `menuLogic`, `productsLogic`, `addonsLogic` and the menu, products and add-ons screen tests (N);
  - the D2 form tests (N);
  - `storeLogic.test.ts`, the Counts open-count filter, the `LedgerDrawer` labels,
    `driverPurchasesLogic.test.ts`, `mutate.test.ts` (S);
  - `tillShiftLogic.test.ts`: `shiftGate` (start, ok, othersShift, the manager ok, the desk ok,
    unknown or offline ok **fails open**, noDay), `handoverPrefill` and `closeState` (T);
  - `dayCloseLogic.test.ts`: `tillShiftRows`, and `deriveDayCloseState`/`closeBlock` unchanged for
    every input, plus the CSV (T);
  - `opsLogic.test.ts` (P, T);
  - jsdom:
    - `DeductionsPage`, `IncidentsPage`, the content sheet;
    - the payment pane: the start panel under the gate and never on an offline tab;
    - the idle lock's Switch user and the rail Sign out ask first when a shift is open.
  - e2e (EN and AR projects):
    - `operator-people.spec.ts` (P);
    - `operator-till-shift.spec.ts` (T): the manager opens the day, A starts, sells, ends with a
      count and signs out, then B accepts the handover and sells, and the day close lists two
      shifts, one warning, and closes;
  - the visual-check recipe (memory `operator-visual-check-recipe`) for every new or changed
    screen.
- **Mobile** (vitest + jest-expo):
  - `status.test.ts` (a new role resolves to `staff`);
  - `rows.test.ts` / `rowsByRole.test.ts`;
  - the teachings and recipes logic tests (R);
  - the deductions, incidents, content and stores logic tests;
  - the `idempotency` keys;
  - `noStationRpc.test.ts`;
  - `staffPeople.smoke.test.tsx` and `staffStores.smoke.test.tsx` in EN and AR;
  - the `staff-stock`, `staff-start` and `staff-step` smoke cases stay green.

  This Mac has no device toolchain. Majed checks every phone screen on a device through Metro.

### 6.3 Acceptance checklist (EN and AR; the local stack first, then hosted after §7)

The numbering continues the contracts' §8.3, whose item 27 ("Parked") is retired.

28. **Roles.** On the new operator, the owner creates Hussein (assistant barista) and Hasan
    (waiter).
    - Hussein lands on `/kds`, sees and moves the bar's tickets, and opens My tasks. He reads the
      bar's teachings (and gets the push for a new one) and recipe names with no quantities. He
      has no shopping, stock, ideas or till.
    - Hasan lands on `/tasks`.
    - On the phone, each sees exactly §5.1's rows.
    - An older operator build shows either account as "no access".
29. **The cleaning photos.** The owner writes a waiter close list with "Needs a photo". Hasan cannot
    tick without a photo, and ticks with one. A second waiter and the manager see the photo, and a
    barista does not. The day close warns about Hasan's unticked list.
30. **A size rename through a price change.**
    - A manager's direct rename of a launched size is refused with the new sentence, and so is a
      launched paid add-on's. A free option renames directly.
    - Marketing proposes a Small↔Large swap on the phone.
    - The owner sees "Small (4,000 IQD) → Large" on numbers and approves it.
    - It applies: the names swap, and prices and recipes stay with their rows.
    - A shop size rename also renames its stock row.
31. **Deductions.**
    - Bareq proposes a deduction for Yusuf, and one for Hussein, on the phone. The managers' push
      shows no amount.
    - The manager approves one on `/deductions` and declines the other with a reason.
    - Yusuf sees the approved one in My deductions, with no proposer's name. Bareq sees the
      decline's reason.
    - The owner cancels an approval with a reason.
    - The month view totals are right.
    - The owner assistant, asked about deductions, has nothing to read.
32. **Incidents.**
    - Hussein 2 reports a court injury on `/incidents` with a photo, and a driver reports one on
      the phone.
    - The managers get a push showing only the kind.
    - The manager reviews with a note, and Hussein 2 sees it.
    - Another desk account cannot open the photo.
    - The owner redacts one: the text becomes the marker, and the photo is gone after the next tick.
    - A time-shifted purge replaces the text at 365 days.
33. **Content.**
    - Marketing submits a post with two images on the phone or on `/tasks`.
    - The owner asks for changes with a reason. Marketing revises (v2 keeps one image), and the
      owner approves v2.
    - Marketing sees each round.
    - A manager sees nothing: no screen, no RPC, no table rows and no image (V4).
    - Deciding v1 after v2 exists is refused.
34. **Stores.**
    - Bareq adds a delivery to the cafe on the phone, and no cost is shown. The manager sets its
      cost in "Added by staff".
    - Rusul adds a bakery delivery.
    - The manager records the opening move of the bakery shelf.
    - Hasan moves flour from the cafe to the bakery. A move larger than the cafe shows is refused
      with the shown quantity.
    - Rusul and Tiba count the bakery blind, and the manager applies the count: variance only at
      the bakery, and a Moved column.
    - With the cafe out of an ingredient that the bakery holds, a cafe sale goes through with no
      alert.
    - A transfer into a store while its count is open is refused.
    - Stock value and on-hand are unchanged by every transfer.
35. **Till shifts.**
    - Maha starts a shift at the till, accepting the day's float, and sells cash and card.
    - She ends it with a blind count and her PIN, and sees "short by 5,000 IQD", then signs out.
    - Another cashier signs in and taps "That's right".
    - The day close shows both shifts, with the second one open as a warning, and closes.
    - The shift sums plus the "outside" rows equal the day's cash and card.
    - A manager takes a payment on the cashier's open drawer, with the banner.
    - The payment pane never blocks an offline tab.
36. **The release order held.** The operator tag was installed on every station before either new
    role was assigned. The mobile build carries every wave-5 page.

---

## 7. Rollout

### 7.1 The hold

Wave 5 stays **local** until Majed confirms that every station runs operator 0.2.20. Until then, no
push may touch `packages/db/supabase/migrations/**`: db-migrate runs on any such push and would
apply 0161 (memory `push-triggers-db-migrate`; contracts §1.6). This covers the wave-2 to wave-4
local commits too. Once cleared, the push points are §1.5.

### 7.2 Deploy order on hosted

- **Functions and DB run in parallel on one push.** functions-deploy and db-migrate run side by
  side, so code that reaches a function first must tolerate a missing function:
  - the `protocol-action` incident phase runs last and is wrapped (§2.6.2);
  - `staff-admin`'s widened `ROLES` may deploy before the enum. A create in a new role would then
    fail at the insert, which is harmless, because roles are assigned only after §7.3.
- **The push kind goes first.** P's `send-push` commit deploys in the push **before** the one that
  carries `staff_push_keys_wave5`. An unknown `title_key` is terminal in the deployed function.

### 7.3 The operator release comes before any new role is assigned

After the migration push, cut the next annotated `operator-vX.Y.Z` on the pushed commit (tagger
Majed; `operator-release.yml`) and install it on **every** station. Only then does the owner give
Hussein and Hasan their roles. Tell the managers the day before.

What an older operator does meanwhile:

| Feature | An older operator build |
|---|---|
| R | shows an account holding either new role as **"no access"** (`roleResolution.ts:85`) |
| N | still offers editable size names on launched items, and the manager gets the (reworded, mapped) `PRICE_VIA_PROTOCOL` sentence. Its `/protocols` form cannot carry renames, and its numbers sheet does not show them. So until the install, only the owner renames live sizes, and the owner decides rename runs on the new build |
| P | lacks `/deductions`, `/incidents` and the content section, and refuses nothing (the phone carries the proposals and reports) |
| S | sends production to the bakery by default and Goods in and waste to the cafe, and shows a raw `transfer` label. Its Counts screen assumes one open count per database (`maybeSingle`), so it fails once a cafe and a bakery count are both open. That state needs the phone or the new operator, so **install the operator before the phone's store pages are used**. Goods in during an open cafe count gets `STORE_BEING_COUNTED`, which the old build does not map, so it shows its generic error (V19) |
| T | never opens a shift, so its payments land "outside a shift" and are reconciled at day close as today. `close_day` returns one extra key, which it ignores |

### 7.4 Stock-location migration order and day one

1. `stock_transfer_movement` (the enum only).
2. `stock_locations`, **at a quiet hour.** Adding the columns takes a brief ACCESS EXCLUSIVE lock on
   `stock_movements`, `stock_batches`, `stock_counts`, `deliveries` and `delivery_lines`. With
   `lock_timeout = '3s'` the apply fails under till load rather than stalling, so re-run it.
   Nothing is rewritten: prove locally that `relfilenode` is unchanged.
3. `stock_transfers`, `stock_logs`, `stock_counts_by_location`, then `stock_store_reads`.
4. The operator tag, installed everywhere (§7.3).
5. **Day one.** All existing stock is booked in the cafe, but the bakery physically holds some. So
   before Rusul's first count, a manager records an **opening move** of the bakery's shelf (Stock ▸
   Move stock; the page's first-day call-out). Without it, the first bakery count shows a surplus
   and the next cafe count a matching shortage (OPEN §8 Q25).
6. The mobile build.

- **Deadlocks.** Two rules prevent them. The first is the canonical lock pass per ingredient in
  `consume_fefo_at`, `transfer_stock` and `finalize_count`. The second is `ingredient_id` order
  across ingredients (0044:263-264): the BOM (0044:293), `finalize_count` (0044:348),
  `transfer_stock`'s lines (D6) and `price_logged_stock`'s single locking SELECT all follow it
  (V15). I5's concurrency test, including its two-ingredient case, stays in the suite.
- **Drift without moves.** Stock carried between the stores without a recorded move leaves a paired
  difference in the two stores' counts. The venue total and its value are unaffected, but the
  variance is noisy, so Hasan records moves both ways.
- **Variance history.** The period is now per (venue, store, ingredient), so an ingredient added
  between two full counts gets a longer first period than the old global `lag` gave it.

### 7.5 Money-path cautions

- **`till_shifts` alters `payments` and `refunds`** (ACCESS EXCLUSIVE, briefly), so push outside
  trading hours or re-run. `settle_tab`'s body is untouched, and `refund` gains only `device_id`.
  `close_day`'s math is byte-identical (TI5). The proof is the partition identity (TI6) with its
  cross-day term (`till_shift_list.cross_day`, V10), checked on hosted after the first day.
- **Day-one behaviour change for cashiers.** In till mode, Pay asks for a shift before the first
  sale, but the gate fails open offline and on an unknown status. Make sure every cashier has a PIN
  (the Setup nag), or knows the manager-PIN path.
- **`consume_fefo` becomes a wrapper for every sale.** I7 (the whole existing suite, plus a golden
  movement comparison) must be green before the commit.
- **Transfers never move money:** on-hand and stock value are unchanged (I4, I8).
- **Estimated costs.** Logged stock carries an estimated cost until a manager sets it. A `none` line
  costs 0 and flatters margins, so Setup nags.
- **Double booking.** A staff log of goods that a manager also enters in Goods in, or that is
  later received as a driver purchase, doubles the stock. `stock_today` shows the day's deliveries
  and the waiting driver purchases, and Goods in shows "Added by staff" beside the form, but a
  human can still double-book (OPEN §8 Q24).
- **Deductions are records.** The owner still pays outside the system (OPEN §8 Q9). The amounts are
  in no push, no audit row and no LLM input (§2.5).
- **Renames.** A renamed size keeps its row's recipe and price unless the same run re-prices it, as
  the form says. A shop size rename also renames its retail stock row, inside the same apply.

### 7.6 Known limits (recorded, not fixed here)

- **The blind count is a screen rule.** A cashier can still read `payments`
  (`payments_staff_read`, 0136:113-115). Narrowing that policy is out of scope.
- **Person attribution.** A queue replayed under the next person's session records the wrong
  person (`replay/index.ts:347`, :427), and cover payments record the person on break (0105:37).
  Shifts fix the drawer attribution, not those.
- **Wage advances** still reach the owner assistant through 0109 and 0110 (OPEN §8 Q10).
- **Refunds of another day's payment** (V10). The rule is that a shift counts a refund in the drawer
  it left, on the day it was made. `close_day` and `v_day_close_summary` keep counting it under the
  payment's day (TI5). So a cash refund of yesterday's sale shows as a shortage in today's
  `close_day` variance, as it does today, while today's shift figures are right. The day-close step
  and `till_shift_list.cross_day` show the amount, and TI6 and TI7 carry it. Changing `close_day`
  is out of scope.
- **Receiving waits for a count.** Goods in, a driver receipt and a staff log into a store with an
  operator count open are refused until the count is applied or discarded (M5, V19). A count left
  open blocks receiving at that store.
- **The phone's "decide on the operator"** for deductions follows the staff-request precedent
  (#16, #56), not "every decision in both apps" (OPEN §8 Q8).
- **Managers read every deduction at the venue but their own** (F6): a manager reads one against
  another manager, and one against themselves only as the person (`my_deductions`). The decide
  and cancel CHECKs still keep a manager out of their own case.

### 7.7 Privacy, legal and store forms (P, one release with the mobile build)

- **`docs/legal/staff-privacy-notice.md`:**
  - incident photos are seen only by the reporter, managers and the owner (this corrects the blanket
    line at :33-34);
  - incident reports and their photos are deleted after a year (:44-48);
  - a line on deductions (§2.5.2).
- **`docs/store/google-play-data-safety.md` (:49-54) and `app-store-submission.md`:**
  - "Other user-generated content" and "Photos" gain "an incident report";
  - **Financial info → Other financial info (staff accounts only): wage advances and pay
    deductions** replaces the exclusion. Wage advances were already such data (0072). The
    classification is **UNVERIFIED**, and it is Majed's call.
- **The guest privacy line** (`legal.{en,ar}.ts`, §4.2; OPEN §8 Q13).
- **Iraqi labour law** on wage deductions (caps, written notice) is **UNVERIFIED**. The app records
  deductions and enforces no legal rule (OPEN §8 Q7).

### 7.8 `go-live-reset.sql` (M8)

- **T (required).** `public.till_shifts` joins the truncate list beside `public.day_sessions`. It
  references `day_sessions` and `stations`, and `payments` and `refunds` reference it. TRUNCATE
  without CASCADE refuses a table referenced by one it does not truncate (the script's header,
  :22-25).
- **S (PROPOSAL).** `public.stock_transfers` and `public.stock_transfer_lines` join the Stock block.
- **P (PROPOSAL).** `public.salary_deductions` and `public.incident_reports` join the staff-activity
  block. These are test-period records.
- **A gap that already exists.** `purchases.delivery_id` references `deliveries` (0166:56), but
  `purchases` is not in the list, and `deliveries` is. Today the script would therefore stop at
  TRUNCATE, because the table it would have to cascade into is not listed. S adds `purchases` (and
  any child that references it) in its edit.

  Checked by reading the FKs, not by running the script (**UNVERIFIED**, because the script wipes
  data). Before go-live, a run against a throwaway local copy confirms the whole list.

### 7.9 After the hosted push

- `npx supabase migration list --linked` shows 0 pending.
- `cron.job` has `tp_incident_purge` (a DO block, NOTICE-only on failure).
- `pg_policy` `touchpadel_rt_staff_topics` names `assistant_barista` (its re-issue degrades to a
  NOTICE when `realtime.messages` is absent).
- The `staff-media` storage policies: `staff_media_delete` names the `incidents` folder (F8, a DO
  block, NOTICE-only on failure), and the other two are unchanged; assert all three, per contracts
  §1.6 step 3.
- A first real shift closes, and the partition identity holds for that day in its corrected form
  (TI6: Σ shifts + Σ outside = the summary, with refunds adjusted by `cross_day`'s
  `earlier_days` − `later`).

### 7.10 The mobile build

The staff phone has not shipped, and 1.0 waits for the staff area. So every wave-5 page and R's
role copies must be in the first store build, which comes after the migrations and the operator
install. There is no new native dependency (photos reuse G's `expo-image-picker`), so no new binary
is needed beyond the one already planned.

---

## 8. OPEN QUESTIONS (defaults taken; Majed may override)

These questions go to Majed, and each one's default is **built now**, under his standing rule to
keep building (memory `wave4-role-pages-spec-2026-09-25`, line 10). None of them is "Parked" in the
contracts' §0 sense (NOT TO BUILD). Everything else in this file is built as written too. An
answer that differs from a default becomes a follow-up change, and each is small (a list, a
policy, a check or a string). The defaults are marked **PROPOSAL** where they appear above. Q17 and
Q22 were removed at review, because the binding answers settle them (V5; §0 row 8, §2.8.5). The
other numbers are unchanged, so the references above still hold.

### Roles and renames

| # | Question for Majed | Default built |
|---|---|---|
| Q1 | Beyond your list (vacation, teachings, recipe ingredients, suggestions), what else does **Hussein** (assistant barista) get? Specifically: the bar's **order board**, new-drink **ideas** to Bareq like Yusuf, and a read-only view of the bar's **shopping list** | The board: yes (he makes drinks). Ideas: no. The shopping list: no. Each "yes" is one re-issue: `submit_release_idea` and its reads (0172:1582 ff.), or `shopping_list` (0185:109) |
| Q2 | Who leads **Hasan** (waiter)? And for salary deductions, is **Bareq's team** the bar only (barista, assistant barista), or the whole cafe section (cashier and waiter too)? | Hasan has no head, and the manager leads him. Bareq's team is the bar only. A manager or owner proposes deductions for the cashier and the waiter |
| Q3 | Does **Hasan** use the **till**, answer guests' "**call a waiter**" (today cashier and managers only, 0032:691-710), or see the **kitchen board** to run ready orders? | **ANSWERED 2026-09-25: he answers "call a waiter"** (§2.1.8). No till, no kitchen board |
| Q4 | Renaming a **whole live item** (for example "Latte" → "Mocha"), not a size: direct as today, or through a price change too? | Direct (plan #59 stands). #9 covers sizes and paid add-ons only |

### Salary deductions

| # | Question for Majed | Default built |
|---|---|---|
| Q5 | Besides the heads, may **managers and owners** propose deductions (for anyone but themselves and owners)? And may a manager approve another manager's proposal, or only the owner? | Yes, MGMT propose. Any manager or owner decides, except the proposer and the person the deduction is against |
| Q6 | What does the **person** see, and are they notified? | Their approved and cancelled deductions (amount, date, reason, month total), with no proposals and no proposer's name. A push: "A deduction was added to your record" (no amount) |
| Q7 | A **cap** per deduction, and how far back may one be dated? Is there a legal limit we must respect? | 1 to 2,000,000 IQD each, dated within the last 60 days. No legal rule is enforced (§7.7) |
| Q8 | Are deductions decided **on the phone** too? | No. They are decided on the operator only, like staff requests (#16, #56), and the phone says "decide on the operator" |
| Q9 | Should a month be marked "**paid**", or exported? And which month does a deduction count in when it is approved after its month has ended? | No paid mark and no export: the month view on `/deductions` only. A deduction counts in the month it is **approved** in (its pay month). The date it happened is kept, and it is flagged when it falls in an earlier month, so an approval after pay day is never lost in a month already paid |
| Q10 | **Wage advances** (existing staff requests) already reach the owner assistant with their amounts (0109, 0110). Should they leave it, like deductions? | Unchanged in wave 5, and flagged |

### Incidents

| # | Question for Majed | Default built |
|---|---|---|
| Q11 | Which roles **report** incidents? | Every role on the phone. On the operator: the desk, the cashier, managers and the owner |
| Q12 | How long are reports **kept**, and is a legal hold ever needed? May the reporter add photos or details after filing? | 365 days, then the text is replaced with a marker and the photos removed. The owner can redact early. There is no hold. A report is immutable after filing, and the reviewer's note carries corrections |
| Q13 | The **kind** and **place** lists, and the wording of the guest privacy line and the staff notice | Kinds: accident, injury, fight, damage, other. Places: court (with the court), cafe, shop, outside, other. The wordings in §4.2 and §7.7, for you or the client to confirm |

### Marketing content

| # | Question for Majed | Default built |
|---|---|---|
| Q14 | Do **managers** see or decide marketing content? | No. The owners decide, and only marketing and the owners can read it: no manager screen, RPC, table read or image read |
| Q15 | **Video**, and the channel list | Images only (up to 10), plus an optional `https://` link to a video or design file. Channels: Instagram, TikTok, Facebook, Snapchat, WhatsApp, Telegram, guest site, in the venue, print, other |
| Q16 | May approved content be **edited** and re-approved? Should it be marked "**posted**"? | No: approved is final, and a change is a new item ("Send again" prefills it). No "posted" mark |

### Stores

| # | Question for Majed | Default built |
|---|---|---|
| Q18 | Where do finished **bakery products** (desserts) live: in the bakery store, or straight into the cafe? | The bakery (production defaults there). Cafe sales still take them through the fallback, and Hasan records moves to the display |
| Q19 | Does a chef's **count** change stock at once, or after a manager applies it? | A manager applies it (Apply or Discard) on the operator |
| Q20 | A **push** to managers when a count is sent? | No push, only an operator badge |
| Q21 | Who may **move stock** between the stores? | Hasan and the managers and owner. Heads and chefs ask Hasan |
| Q23 | The **cost** of stock that staff add (they never see costs) | The last known cost, else the pack cost, else 0 flagged "needs a cost". A manager can correct it |
| Q24 | When a supplier delivers and Bareq logs it, does the manager **still** enter it in Goods in? | No. The manager prices Bareq's entry under "Added by staff", and Goods in is for deliveries nobody logged |
| Q25 | Go-live: an **opening move** of the bakery's shelf, or a first bakery count? | An opening move by a manager, then Rusul's first count |

### Till shifts

| # | Question for Majed | Default built |
|---|---|---|
| Q26 | At handover, does cash **leave the drawer** (a drop to the manager or safe, leaving only a float)? | No. The drawer passes whole, and the next shift starts from the counted amount, plus or minus any cash taken outside a shift in between (V18) |
| Q27 | **Notify** the managers when a shift closes short or over? What counts as short or over on `/ops`? | No push. It shows on `/ops` and at day close. Any non-zero difference counts |
| Q28 | Does the **desk** count its own cash box at each handover too? | **ANSWERED 2026-09-25: yes** (§2.9.9). Shifts are offered in desk mode too, and a desk shift counts the desk's own cash box |
| Q29 | A **blind count** (the cashier does not see the expected figure until she has counted)? And does the incoming person accept the outgoing count with one tap, or always recount? | **ANSWERED 2026-09-25: yes, as the default.** Blind, and the difference is shown right after. One tap "That's right", or type her own count; the difference is recorded |
| Q30 | Should the till **refuse payment** without an open shift? And may a manager take payment on a cashier's open drawer? | The screen asks for a shift before taking payment in till mode, but the server never refuses and the gate fails open offline. Managers and owners may work a cashier's drawer, with a banner; a cashier or desk person must close the other person's shift first |

**Smaller defaults, also PROPOSALs (not asked separately):**
- **Online-only.** Start and end of shift are online-only, like the day boundary.
- **No PIN.** A cashier with no PIN closes her shift with a manager's PIN.
- **Shift history.** A cashier does not see her own past shifts in v1.
- **An open shift at day close** warns and does not block.
- **Content on the desktop.** Marketing may submit content from the desktop.
- **Transfers.** A move larger than the store shows is refused. Moves, logs and receipts into a
  store are refused while a manager's count is open there (V19).
- **Shop stock** is kept in the cafe only (V14).
- **Waste.** The chefs record no waste on the phone.
- **Driver purchases.** The driver does not pick a store.
- **Availability** stays venue-wide.
- **Stores.** Every venue has both stores.
- **Renames.** The comparison ignores surrounding whitespace, and free add-ons stay directly
  renameable.
- **Layout.** The role list orders and the icons.

Any of these can be objected to, and each is a one-line change.
