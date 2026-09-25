# Protocols and the staff phone: build contracts between lanes (2026-09-23)

Companion to `plan-2026-09-23.md`. The plan says what and why. This file says the exact shapes each
lane produces and consumes, so the lanes of §1.1 (0, K and A to I; plan §10) can build in parallel
without meeting. Every contract here is binding until someone edits this file.

**Precedence.** Majed's §11 answers (rounds 7 and 8, 2026-09-23), his round 9 answers
(2026-09-24, plan decisions #51–#55) and his round 10 answers (2026-09-24, plan §11 Q3–Q7,
decisions #56–#60), all restated in §0, win over the plan wherever they differ, and this file
already applies them. Where this file and the plan differ, this file wins. The plan
and this file follow the same numbering rule (§1.3); the plan names migrations by feature only, and
this file's names (for example `protocols_engine_tables`) replace the plan's where they differ.

**Revision.** 2026-09-24: the review round's findings are applied here and the plan was aligned in
the same edit, so the two should not disagree. If they do, this file wins and the plan is the bug.
Later on 2026-09-24, round 9 (plan #51–#55) is applied: every list price goes through price/promo,
every new menu item through product release, the day-30 review is MGMT only, and the courts report
keeps its Events line (§0). The review of that round is applied too: the operator-only error codes
(§3), the price steps' OK switch (§2.8), the accepted limits and the scope of #54 (§0), the
featured-item discount (§2.13), `marketing_take` and its dependency (§2.10), H after G's photo
commit (§1.1), and the propose-time `RECORD_INVALID` (§2.13). Round 10 (plan #56–#60) is applied
too: promotions, court rates and the featured-item discount locked for managers with four more
change kinds (§2.13, §2.8, §5.5), "Needs my OK" fixed on at the two price steps (§2.6-§2.8), the
rename gap accepted (§2.9, §2.13), the kitchen board's money read closed by a new lane K (§1.1,
§2.23), and staff requests decided on the operator only (§6.1). The review of round 10 is applied
too: the hero's Featured mode joins the featured-discount lock (§2.13), `kitchen_board` returns no
ticket completed more than two minutes ago (§2.23), a manager keeps the promotion off switch
(§5.5), the desk's per-booking price override is listed as unchanged (§2.13), and `KdsBoard.tsx` is
a shared file (§1.2). Plan §11 Q8 is the one open choice.

**Markers.** **PROPOSAL** marks a shape chosen here that nobody has decided; build it unless someone
objects. **UNVERIFIED** marks a fact to check before relying on it.

**Citations.** `NNNN:line` means `packages/db/supabase/migrations/2026…NNNN_*.sql`; `op/` means
`apps/operator/src/`; `mob/` means `apps/mobile/`. Planned migrations are named by feature
(`protocols_engine_tables`), never by number.

---

## 0. The §11 answers and what they change

| Q | Answer (binding) | Consequence in these contracts |
|---|---|---|
| 1 | Billed as change-order line 10, built **alongside** multi-venue slice 2. | No ordinals reserved; each lane numbers at commit time (§1.3). Functions both efforts re-issue have one owner each (§2.18). |
| 2, 8 | **Everything works in both apps**: every start form, every step form and every decision, on the phone and on the desktop. | The phone gets decisions and the manager's and owner's forms (§6). The operator gets every step form: manager and owner in `/protocols`, every other actor in `/tasks`, which widens to every non-MGMT hireable role (§5.1, §5.4). Templates, checklist templates, one run's changes (owner), Goods in, deciding staff requests (#16) and making campaigns live stay operator-only (they are managing, not a step or a decision). |
| 3 | Type 2 tournaments: the manager decides. | Type 2 has no owner-OK step by default (§2.8). |
| 4 | Managers may **not** edit prices directly once the protocol exists; the one exception is a not-yet-launched draft item. | `upsert_variant` raises `PRICE_VIA_PROTOCOL` for a manager on a launched item, added by the `price_promo` migration that brings the protocol (§2.13). Round 9 (#51, below) widens it from cafe items to shop products and add-ons. Every item and add-on that exists at migration time counts as launched (§2.9, §2.13). An item in release takes its prices from the price step only (`ITEM_IN_RELEASE`, for everyone, §2.9). |
| 5 | Event hours get their own line in court analytics. | `analytics_open_minutes` is recreated with `event_minutes` and its three callers re-issued: `analytics_courts_summary`, `analytics_courts_cafe` and `report_courts` (§2.11). |
| 6 | The App Review login is a driver-role account at the real venue. | Lane G script (§1.2). |
| 7 | Built-in steps: rename, "Needs my OK" and checklist only. Order stays fixed where it matters; actors are fixed. The owner's own added steps can be added, moved and deleted freely. | `save_protocol_template` enforces dependencies, not positions (§2.7). Built-in steps cannot be removed, cannot change actors, cannot change "optional". Round 10 (#58) also fixes "Needs my OK" on at the two price steps. |
| 9 | All staff may add notes (customer remarks included) on a new item for 30 days; they feed the day-30 review and write-up. | `release_notes` is in (§2.10). |
| 10 | Staff-typed titles may be in one language. | `start_protocol` needs both titles only from the owner (§2.7). |
| 11 | Only the **owner** customises one running protocol. | `edit_run_items`, `add_run_step` are owner-only, on the operator's run sheet (managing, not a step form, so not on the phone). |
| 12 | The **owner only** presses Launch or schedules it. At the price step the owner **approves or sends back** and cannot edit the number. The owner's own steps pass automatically, with a record. | Launch actor is `owner`; no `owner_override` anywhere; auto-pass rule covers the owner (§2.7). |
| 13 | The day-30 model follows the venue's `llm_default_model`. | `release-review` reads it venue-qualified (§2.20). |

**Round 9 (2026-09-24, after the docs review; plan decisions #51–#55, binding):**

| # | Answer (binding) | Consequence in these contracts |
|---|---|---|
| 51 | **Every** price goes through the price or promotion change protocol: menu item sizes, Touch Shop product sizes and add-on (modifier) prices. The draft exception stays. | `PRICE_VIA_PROTOCOL` covers every writer of a list price (§2.13): `upsert_variant` on any launched item, shop included (the shop exception is gone), `upsert_retail_variant` through its call to `upsert_variant` (not re-issued), and a re-issued `upsert_modifier` for `price_delta_iqd`. All in F's `price_promo`. `price_promo` gains the change kinds `shop_launch` and `addon_price`, and `price` gains new sizes on a cafe item (§2.8). The owner keeps direct edits. Promotions, court rates and the featured-item discount (`featured_discount_pct`) were not named here; round 10 locks them too (#57 below, §2.13). |
| 52 | **Every** new menu item goes through product release and the owner's Launch. | E's re-issued `upsert_menu_item` refuses a manager's new cafe item, a manager's switch-on of a never-launched cafe item and a manager's move of one into a cafe category (`ITEM_VIA_RELEASE`, §2.9). The release creates its draft through `upsert_menu_item_internal`. The owner still creates and switches on items directly (**PROPOSAL**, the #41 reading). |
| 53 | *Consequence of #51–#52.* A manager's new shop product is saved hidden and goes on sale through a `shop_launch` change; a manager's new paid add-on is saved hidden and goes on sale through an `addon_price` change. A free (0 IQD) add-on may still be added switched on (**PROPOSAL**). | `LAUNCH_VIA_PROTOCOL` from `upsert_menu_item` (E, shop products) and `upsert_modifier` (F, paid add-ons) when a manager's never-launched target is created switched on, or switched on while never launched; saved hidden, it passes. The apply of `shop_launch` and `addon_price` switches a never-launched target on and stamps `launched_at`; a launched add-on keeps its switch (§2.13). "Nothing gets a price or goes on sale without the owner" holds without condition, because "Needs my OK" is fixed on at the price steps (#58, §2.8). Accepted limit (#59): a switched-off item or add-on that existed before the migration counts as launched, so a manager can rename it and switch it back on at its old price (§2.9, §2.13). |
| 54 | The proposer does **not** see sales on the day-30 review; only managers and owners do. | `release_review` is MGMT only; the starter's units-and-days-sold view is removed. `review_ready` goes to the owners and the venue's managers, never to a non-MGMT starter (**PROPOSAL** on the push) (§2.10, §2.21, §6.1). Scope: #54 is enforced on every protocol and review read. The bar and kitchen roles' kitchen-board read of `orders` and `order_items` (0157:36-61) would still let a head role's session count any item's sales; round 10 closes it in this work (#60 below, §2.23). |
| 55 | The courts report keeps its Events line. | No change: Q5 stands (§2.11, §5.5). |

**Round 10 (2026-09-24, plan §11 Q3–Q7; plan decisions #56–#60, binding):**

| # | Answer (binding) | Consequence in these contracts |
|---|---|---|
| 56 | Staff requests: the default stands. The owner decides them on the operator only (plan #16). | No `decide_staff_request` on the phone; the owner's `staff-request.tsx` says "Decide in Observe ▸ Requests on the operator" (§6.1). |
| 57 | Promotions, court rates and the featured-item discount are **locked for managers** behind the price or promotion change protocol. | F's `price_promo` locks every manager write of a promotion, a court rate rule or the featured-item discount, and adds the change kinds `promotion_edit`, `promotion_enable`, `rate` and `featured_discount` (§2.8, §2.13). The till's overrides and the desk's per-booking price override stay as they are (§2.13, plan §11 Q8). `upsert_promotion` and `generate_promo_code` refuse a manager; `set_promotion_enabled` refuses a manager's switch-on; `upsert_rate_rule` refuses every manager save; `set_cafe_setting` (and through it `set_cafe_settings`) refuses a manager's change of `featured_discount_pct`, a manager's move of `featured_item_id` while a discount is on, and a manager's switch of `hero_mode` to `featured` while a discount is stored (Featured mode is what puts the discount live, 0095:169). All raise `PRICE_VIA_PROTOCOL` (§3). A manager's switch-off of a promotion and of the discount (setting it to 0, or moving the hero off Featured) stay direct (**PROPOSAL**, plan §11 Q8). F's UI makes `/admin/promotions`, `/admin/rates` and the hero's discount read-only for a manager, each with a start (§5.5). |
| 58 | "Needs my OK" is **always on** at release `analysis` and price/promo `numbers`; the switch is hidden, as on launch and add staff. | `protocol_step_defs` marks `ok_fixed` on the two price steps and the two owner-only steps, `launch` and `add_staff` (§2.6); `save_protocol_template` refuses a change with `PROTOCOL_STEP_FIXED`, and `start_protocol` snapshots their flag from the def (§2.7); How it works hides the switch (§5.4). |
| 59 | The rename gap is **accepted as a limit**. | No guard. `product-release.test.ts` pins the rename and switch-on of a pre-migration item, `price-promo.test.ts` its locked price (§2.9, §2.13, §8.2). |
| 60 | The kitchen money read is **closed in this work**, inside line 10: a money-free definer read for the board, a venue conjunct on `order_items`, and no direct priced reads for the bar and kitchen roles. | New lane K (§1.1): `kitchen_board_read` (`app.kitchen_board`) and the board reading through it, then `kitchen_money_reads`, which drops head_barista, barista, head_chef, chef and prep from the four order-side read policies and adds the venue conjunct (§2.23). The LAN board, the `kds` topic and the till, desk and MGMT reads are unchanged. Deploy order in §1.6. |

---

## 1. Lanes, ownership, numbering, commits

### 1.1 Lanes and order

| Lane | Work | Commits after | Can start |
|---|---|---|---|
| **0** Scaffold | i18n mounts and empty lane catalogs, every error-code key and mapping (§3), shared `work.*` vocabulary, this file's coverage key | nothing | now, first |
| **K** Kitchen read (plan #60) | `kitchen_board_read` (`app.kitchen_board`, §2.23); the board commit: `op/features/kds/KdsBoard.tsx` reads through `kitchen_board`; then `kitchen_money_reads` (§2.23) | `kitchen_board_read`: nothing. The board commit: `kitchen_board_read`. Both land **before G's `send-push` commit** (§1.6 step 1). `kitchen_money_reads`: both of those and G's `send-push` commit, so step 2's push never carries it | now |
| **G** Push and photos | first, **its own commit**: `send-push/**`, `_shared/staff-push.json`, `send-push/staffStrings.ts` and their tests (§1.6 step 2); then `staff_media_bucket`, `staff_push`; expo-image-picker; `photo.ts`; store, legal and runbook docs; App Review script | 0; the `send-push` commit also after K's board commit (§1.6) | now |
| **A** Engine DB | `staff_ingredient_options`, `protocols_engine_tables`, `protocols_engine_rpcs` | G's `staff_media_bucket` and `staff_push` (for `protocols_engine_rpcs`) | now (apply G's drafts locally) |
| **B** Mobile shell and shared core | `@touch/core` role module (§7.1) and protocol form module (§7.2), staff sign-in, `StaffStatusProvider`, device hint, `GuestTabsGate`, `app/staff.tsx` (Today shell), `app/staff-request.tsx`, push tap routing, no-station-RPC guard | 0; G's `send-push` commit (the `pushRoutes` parity test reads `_shared/staff-push.json`) | now |
| **C** Staff-page DB | `checklists`, `shopping_purchases`, `staff_production`, `marketing_staff` | G; A's `staff_ingredient_options` (for `shopping_purchases`) and `protocols_engine_tables` (for `marketing_staff`) | now |
| **D** Operator protocols | **D1, shell:** `protocolsRoute` with its `validateSearch` and a placeholder page, registered in `op/main.tsx`; the `QK` keys (§5.2) and the `CAPABILITY_ROLES` entries (§5.1). **D2, pages:** `/protocols`, every operator step form and decision, How it works, per-run edits, the `/tasks` widening and forms, rail rows and badges, `/ops` rows, Observe row, audit keys | D1: 0. D2: A, B (§7.2), C, E, F, and I (the RPCs it reads, and I's `ChecklistsCard`), and K's board commit (the shared `KdsBoard.tsx`, §1.2) | D1 now; D2 after A's RPC shapes (this file) |
| **E** Product release | `product_test_movement`, `product_release` (with the manager new-item guard, #52, #53); `release_post_launch`; `protocol-action`, `release-review`; menu-editor UI (in-release notice, the manager price lock and the manager new-item guard); ledger and variance | A; `release_post_launch` also after C's `marketing_staff` (`release_review_input` reads `marketing_notes`, §2.10). The menu-editor UI commit also after D1 (typed `/protocols` link) and F's `price_promo` (the lock it shows) | now (drafts) |
| **F** Tournament, hiring, price/promo | `event_court_blocks`, `event_block_run_index`, `hiring`, `price_promo` (with the manager price lock on sizes, shop products and add-ons, the add-on launch guard, and the promotion, rate and featured-discount locks, #41, #51, #53, #57); desk event-block dialog; Staff hire prefill; courts analytics and courts report events line; the pricing UI commit: the manager locks in Stock ▸ Products, Add-ons, Promotions, Rates and the hero's featured discount (§5.5) | A; `price_promo` also after E's `product_release`; F's UI commits also after D1 (the pricing UI commit also after `price_promo`) | now (drafts) |
| **H** Mobile pages | every `app/staff-*.tsx` except `staff.tsx` and `staff-request.tsx` | B; G's photo commit (`photo.ts`, `PhotoButton.tsx`, expo-image-picker) for every page with a photo; and the RPCs each page calls | after B |
| **I** Operator stock and day close | Goods in "Bought by the driver", "Made today", day-close soft section, Daily checklists card and editor, marketing "From marketing", Setup "Worth checking" additions | C; I's UI commits also after D1 (`QK` keys, `editChecklists`) | after C's RPC shapes (this file) |

Critical path: G, then A, then E and F, then D2, then acceptance (§8.3).

The commit graph has no cycle. One order that satisfies every row: 0; K's `kitchen_board_read`
and board commit; D1; G `send-push`; B; K's `kitchen_money_reads`; G `staff_media_bucket`,
`staff_push` and its photo commit; A's three; C's four; E's `product_test_movement`,
`product_release`, `release_post_launch`; F's `event_court_blocks`, `event_block_run_index`,
`hiring`, `price_promo`; the E, F and I UI commits; H's pages as their RPCs land; D2. Slice 2's
commits interleave anywhere (§1.3).

### 1.2 File ownership

A lane edits only its own files. A shared file (second table) is edited by the named lanes in commit
order, append-only, re-read immediately before editing.

| Lane | Owns |
|---|---|
| 0 | `packages/i18n/src/catalogs/{work,opErrors.protocols}.{en,ar}.ts` (new); `packages/i18n/src/catalogs/staff/index.ts` and empty `staff/{shell,protocols,checklists,supplies,marketing,notes,media}.{en,ar}.ts` (new); empty `ws/{protocols,release,events,supplies,pricing}.{en,ar}.ts` (new); the mount lines in `en.ts`/`ar.ts` and `ws/index.ts`, plus the reworded `op.errors.IDEMPOTENCY_CONFLICT` string there (§3); the `MAPPED_CODES` block in `op/lib/errors.ts`; the `CODE_TO_KEY` block in `mob/src/features/booking/errors.ts`; this file |
| K | drafts `{kitchen_board_read,kitchen_money_reads}.sql` (then `migrations/`); `packages/db/tests/kitchen-board.test.ts` (new); the 0157 cases of `packages/db/tests/new-roles.test.ts` (the order-side read case moves the kitchen roles and prep to "reads nothing"); `op/features/kds/ticketView.ts` and the tests `KdsBoard.test.tsx`, `ticketView.test.ts`; `op/features/kds/KdsBoard.tsx` is shared with D (second table): K changes the tickets query only, and D owns the header button in `KitchenDisplayScreen.tsx` |
| A | `packages/db/supabase/drafts/{staff_ingredient_options,protocols_engine_tables,protocols_engine_rpcs}.sql` (then `migrations/`); `packages/db/tests/protocols-engine*.test.ts`, `protocols-roles.test.ts` (A's tables and RPCs only, §8.2), `staff-ingredient-options.test.ts`; the read-policy case of G's committed `packages/db/tests/staff-media.test.ts` (A re-issues that policy, §2.3, §2.18) |
| B | `packages/core/src/staff/**`, `packages/core/src/protocols/**` (§7.2); `op/lib/roleResolution.ts` (re-export only); `packages/db/tests/staff-roles-parity.test.ts`; the `Role` comment in `apps/operator-shell/src/ipc-channels.ts` and `op/ipc/bridge.ts` (§7.1); `mob/src/features/staff/{status,StaffStatusProvider,gate,RequireStaff,GuestTabsGate,hint,keys,api,venue,rows,edge,pushRoutes}.ts(x)` and their `__tests__`; `mob/app/staff.tsx`, `mob/app/staff-request.tsx`; `mob/src/smoke/staff.smoke.test.tsx`; `packages/i18n/src/catalogs/staff/shell.*`; `packages/db/fixtures/staff-roles.sql` (dev logins for the six new roles, **PROPOSAL**, loaded with `pnpm --filter @touch/db db:fixtures fixtures/staff-roles.sql`) |
| C | `packages/db/supabase/drafts/{checklists,shopping_purchases,staff_production,marketing_staff}.sql`; `packages/db/tests/{checklists,shopping-purchases,staff-production,marketing-staff}.test.ts` (each with its own driver and marketing denials, §8.2) |
| D | `op/features/protocols/**`; `op/routes/protocols.tsx`; `op/routes/tasks.tsx`; `op/features/tasks/**`; the "My tasks (N)" header button in `op/features/kds/KitchenDisplayScreen.tsx` (its count and handler come from `KdsBoard.tsx`, a shared file, second table); `op/routes/__root.tsx` (`RailLink` renders a `NavItem` badge); `packages/i18n/src/catalogs/ws/protocols.*`; `e2e/tests/operator-protocols.spec.ts` |
| E | drafts `{product_test_movement,product_release,release_post_launch}.sql`; `packages/db/supabase/functions/{protocol-action,release-review}/**`; `packages/db/tests/{product-release,release-post-launch,protocol-action,release-review}.test.ts` (each with its own driver and marketing denials); `op/features/admin/menu/**` (in-release notice, the manager price lock and the manager new-item guard); `packages/i18n/src/catalogs/ws/release.*` |
| F | drafts `{event_court_blocks,event_block_run_index,hiring,price_promo}.sql`; `packages/db/tests/{event-court-blocks,hiring,price-promo}.test.ts` (each with its own driver and marketing denials); `op/features/desk/CourtBlock.tsx` (event mode); `op/routes/desk/_children.ts` (`validateBlockSearch` gains `run`, `step`); `op/routes/admin/staff.tsx` (`validateSearch` for `hire`); `op/features/stock/products/**` and `op/features/admin/addons/**` (the manager locks, #51, #53); `op/features/admin/promotions/**`, `op/features/admin/{RateRuleEditor.tsx,rateRuleLogic.ts,rateRuleLogic.test.ts}` and `op/features/admin/hero/HeroBuilder.tsx` (the manager locks, #57, §5.5); `op/features/stock/stockKeys.ts` (only `fetchShopCatalogue`, whose select gains `launched_at`, and the `ShopProductRow` type, §5.5; no other lane edits the file, and one that must moves it to the shared-file table first); `packages/db/tests/promotions.test.ts` (its `mk` helper creates as the owner once the lock lands; the manager case moves to `price-promo.test.ts`); `packages/i18n/src/catalogs/ws/{events,pricing}.*` |
| G | drafts `{staff_media_bucket,staff_push}.sql`; `packages/db/supabase/functions/send-push/**`; `packages/db/supabase/functions/_shared/staff-push.json`; `packages/db/tests/{staff-media,staff-push,send-push-staff}.test.ts`; `mob/src/features/staff/photo.ts`, `mob/src/components/PhotoButton.tsx`; `mob/locales/ios.{en,ar}.json` (new); `packages/i18n/src/catalogs/staff/media.*`; `docs/store/app-store-submission.md`, `docs/store/google-play-data-safety.md`, `docs/legal/staff-privacy-notice.md`, `docs/install-runbook.md`, `packages/i18n/src/catalogs/legal.{en,ar}.ts`; `scripts/create-staff-review-account.mjs` (new) |
| H | `mob/app/staff-{checklist,start,runs,run,step,production,shopping,purchase,marketing,notes}.tsx`; `mob/src/features/staff/{protocols,checklists,supplies,marketing,notes}/**`; new `mob/src/components/{ChecklistRow,DecisionBar}.tsx`; `mob/src/smoke/staffPages.smoke.test.tsx`; `packages/i18n/src/catalogs/staff/{protocols,checklists,supplies,marketing,notes}.*` |
| I | `op/features/checklists/**` (new); `op/features/stock/{ReceiveDelivery,WasteAndProduction}.tsx` and new `op/features/stock/DriverPurchases.tsx`; `op/routes/stock/_children.ts` (`validateSearch` on the `receive` child for `purchase`); `op/features/admin/{DayClose.tsx,dayCloseLogic.ts}` (+ test); `op/features/marketing/MarketingPanel.tsx`; `op/features/admin/SetupHome.tsx` (+ test); `packages/i18n/src/catalogs/ws/supplies.*` |

| Shared file | Lanes, in commit order | What each adds |
|---|---|---|
| `packages/db/fixtures/rpc-allowlist.json`, `rpc-coverage-floor.json`, `assistant-coverage.json`, `packages/db/tests/rls-matrix.ts` | K, G, A, C, E, F (and 0, D, E, F, I for coverage `routes`/`docs` keys) | own keys only; floor via `--update-floor`; G lists the three path helpers under `publicByDesign` (§2.3); K changes the `tabs`, `orders` and `order_items` select rows (prep no longer `rows`, §2.23); F rewrites the notes of the `upsert_promotion`, `set_promotion_enabled`, `generate_promo_code` and `upsert_rate_rule` rows (the manager stays `execute`: the lock raises past the guard) |
| `packages/db/src/types.gen.ts` | every DB lane, at commit (§1.4) | regenerated, never hand-edited |
| three assistant-map outputs (§1.5) | every committing lane | regenerated from a clean tree |
| `packages/db/tests/stored-fields.test.ts` | F | `reservations.block_purpose: n, protocol_run_id: n` |
| `packages/db/scripts/check-analytics-payload.mjs` (SEC-29) | E, F (whichever commits first goes first) | E: an explicit `LLM_INPUT` list of functions scanned whatever their grant, starting with `release_review_input` (§2.10); F: `candidate_name`, `candidate_phone` in `FORBIDDEN` (a tripwire only: no scanned function touches candidates) |
| `packages/db/supabase/config.toml` | E | `[functions.protocol-action]`, `[functions.release-review]`, both `verify_jwt = true` |
| `docs/design/assistant/pages.md` | K, D1, E, F, I, D2 | own route sentences (§5.6); D1 lands the `/protocols` sentence and its coverage key with the route |
| `op/lib/auth.tsx` | D (D1, then D2), and F in commit order | D: §5.1. F, in its pricing UI commit only: `permissionsFor`'s `editRates` and `editPromotions` become owner-only, and `requiredRoleFor('editPromotions')` and `requiredRoleFor('editRates')` return `'owner'` (today both fall to `default: return 'manager'`, §5.5). Not earlier, or managers lose the editors before the protocol exists |
| `op/features/kds/KdsBoard.tsx` | K (the board commit), then D (D2) | K: the tickets query reads `kitchen_board` (§2.23). D: the My tasks count (`my_protocol_work`'s To do, §2.7) and the handler that opens `/tasks`, both passed to `KitchenDisplayScreen` beside `onExit` (§5.1). The file owns the board's queries and its way-out handler (`KdsBoard.tsx:9-10`, :190-216); `KitchenDisplayScreen.tsx` holds no query |
| `op/lib/workspaces.ts` (+ test; the `NavItem` type gains an optional `badge` key), `op/lib/queryKeys.ts`, `op/lib/edge.ts`, `op/features/ops/*`, `op/features/observation/ObservationHome.tsx`, `op/features/admin/audit/auditLogic.ts` (+ test), `op/main.tsx`, `packages/i18n/src/catalogs/ws/{shell,manager,team}.*` | D (D1, then D2) | §5 |
| `op/lib/analyticsApi.ts`, `op/features/analytics/**` (courts events line), `op/features/admin/staff/StaffList.tsx` (hire prefill) | F | §5.5 |
| `op/features/stock/{LedgerDrawer,VarianceReport}.tsx` | E | `product_test` |
| `op/features/reports/**` (`reportPayloads.ts`, `StockReport.tsx`, `CourtsReport.tsx` and tests) | E, F (whichever commits first goes first) | E: the stock payload's `productTestQty`; F: the courts report's events figure (§2.11) |
| `mob/app/_layout.tsx`, `mob/app/(tabs)/_layout.tsx`, `mob/app/sign-in.tsx`, `mob/src/features/auth/{gate.ts,RequireNoSession.tsx,social.ts,useSocialSignIn.ts,context.tsx}`, `mob/src/features/profile/{useTermsGate,pushSync,push}.ts`, `mob/src/lib/{queryClient,idempotency,bootPrefs}.ts`, `mob/src/test/smoke.tsx`, `mob/CLAUDE.md` | B | §6.8 |
| `mob/app/staff.tsx`, `mob/src/features/staff/rows.ts` | B, then H | H mounts the work list and appends a row definition per screen it lands |
| `mob/src/smoke/routes.ts` | B, then H | rows under `// ── staff ──` (§6.2) |
| `packages/config/src/eslint.js` (`testIdElements`) | B, G, H | each lane's new Pressable wrappers |
| `mob/package.json`, `mob/app.config.ts`, `pnpm-lock.yaml` | G | expo-image-picker (§6.10) |

`pnpm-lock.yaml`, `en.ts` and `ar.ts` currently carry another session's uncommitted hunks. Use the
partial-staging recipe (§1.5) or ask that session to commit first.

### 1.3 Migration numbering (binding, decided)

- `packages/db/scripts/check-migrations.mjs` refuses a new migration whose ordinal is not greater
  than the highest ordinal on `origin/main` (`migration-ordinal-not-max`), refuses a reused ordinal
  (`migration-duplicate-ordinal`) and refuses a version that sorts before the newest on the merge
  base (`migration-out-of-order`). Multi-venue slice 2 is built alongside this work.
- **No ordinals are reserved.** Each lane names its migrations by feature while building and takes
  the next free ordinal at the moment it **commits**, in commit order. Next free =
  1 + the highest of: every file in `packages/db/supabase/migrations/`, `HEAD`, and `origin/main`
  after `git fetch origin main`.
- The version is `<YYYYMMDD of the commit day><ordinal padded to 6>`, for example
  `<YYYYMMDD><NNNNNN>_staff_media_bucket.sql`. It must sort after every existing file.
- A migration that depends on another lane's migration commits after it. Dependencies are in §2.2.
- The file header names the feature and this file's section; the ordinal enters the header and
  every dollar tag at commit (§1.4, §2.1). Any doc that lists planned migrations lists them by name
  and dependency, never by number.

### 1.4 Drafts, the shared local stack, and `types.gen.ts`

- **Drafts live outside the migrations directory** until commit (**PROPOSAL**):
  `packages/db/supabase/drafts/<feature>.sql`. The gates, the map generator and `supabase db reset`
  never see them. Every draft is re-runnable (`create or replace`, `if not exists`, guarded
  constraint adds).
- Apply a draft to the local stack (psql is not installed on this Mac):
  `docker exec -i supabase_db_touchpadel psql -U postgres -d postgres -v ON_ERROR_STOP=1 < packages/db/supabase/drafts/<feature>.sql`.
  Apply dependencies first (§2.2). Other lanes see your objects; that is how A builds on G.
- **Commit-time reset.** The committing DB lane: moves its drafts into `migrations/` with their
  final versions (§1.3), writing the ordinal into the header and renaming every
  `$<name>_<feature>$` dollar tag in the file to `$<name>_0NNN$` (§2.1); announces the reset to the other sessions (`ListAgents`, `SendMessage`);
  runs `pnpm --filter @touch/db db:reset` so the database equals committed migrations plus its own;
  runs its tests and gates; runs `pnpm --filter @touch/db db:types`; commits. Other lanes then
  re-apply their drafts.
- `packages/db/src/types.gen.ts` is committed only by a DB lane, only right after that reset. UI
  lanes may regenerate it locally to build, and never commit it. A UI commit that calls a new RPC
  lands after the commit that carries the RPC's types.

### 1.5 Commit rules

- Commit only when Majed says "commit". Author is the repo identity (Majed Ahdab), sole author.
  **No `Co-Authored-By` trailer and no AI attribution** of any kind; strip any trailer a harness
  appends. Never run `git add`, `commit`, `stash`, `checkout`, `reset` or `clean` otherwise.
- **Pathspecs always.** When every file in the commit is wholly yours:
  `git commit -F <msg> -- <paths>`.
- **Partial files** (a shared file carrying someone else's uncommitted hunks):
  `git diff -- <file> > "$T/p.patch"`, delete the foreign hunks, `git apply --cached "$T/p.patch"`,
  stage your whole new files, confirm `git diff --cached --name-only` lists exactly your files,
  then `git commit -F <msg>` with no pathspec. If the index holds anyone else's staged work, stop
  and coordinate.
- **One commit carries** the migration, `types.gen.ts` (§1.4), both catalogs of every string it adds,
  every fixture it touches (`rpc-allowlist`, floor, `rls-matrix`, `assistant-coverage`,
  `stored-fields`, SEC-28/29 lists) and the three assistant-map outputs. The one exception is G's
  `send-push` change, which is its own commit made before the `staff_push` migration commit (§1.6).
- **Coverage keys.** Every new table, view, function (granted or internal), route, edge function,
  cron job and doc gets its `packages/db/fixtures/assistant-coverage.json` key in the same commit
  (§5.7 lists them). A `table_read` table also gets `app.assistant_readable_columns` rows in its
  migration: the 0144:94-120 statement with `and c.table_name in (<this migration's table_read
  tables>)` added. **Never run the all-table catch-up**: it takes every public table, so it would
  make `hiring_candidates` (names, phones, briefs) and `staff_media_uploads` readable by the owner
  assistant, and so send them to the LLM. `hiring.test.ts` and `staff-media.test.ts` assert that
  neither table has a row there. The commit that lands this file adds
  `"docs/design/protocols/build-contracts-2026-09-23.md": "index:doc"`.
- **Assistant map from a clean tree of exactly what is committed.** The working tree holds other
  sessions' uncommitted docs, so a map built in place is wrong.
  ```
  T=<scratch dir>
  git worktree add --detach "$T/tree" HEAD
  # copy in every file of this commit; for a partially staged file write the staged blob instead:
  #   git show :<path> > "$T/tree/<path>"
  (cd "$T/tree/packages/db" && node --experimental-strip-types scripts/build-assistant-map.mjs \
     && node --experimental-strip-types scripts/check-assistant-coverage.mjs)
  cp "$T/tree/packages/db/fixtures/assistant-map.json"                          packages/db/fixtures/
  cp "$T/tree/packages/db/fixtures/assistant-map-compact.md"                    packages/db/fixtures/
  cp "$T/tree/packages/db/supabase/functions/_shared/assistant/map.json"        packages/db/supabase/functions/_shared/assistant/
  git worktree remove --force "$T/tree"
  ```
  The generator needs only node (`build-assistant-map.mjs` header). `assistant-map.test.ts` in the
  shared working tree may still fail on other sessions' docs: report it as not yours.
- Waivers: `check:migrations` runs locally with
  `MIGRATION_RISK_ACCEPTED='<reason>'`; the reason is also written in the migration header
  (0108:20-26, 0135 precedent). There is no PR body on a push to `main`.

### 1.6 Pushing and deploy order

Push in batches: every push to `main` is a Vercel production build and a full CI run.
1. `f6a0802`, `ed5c2e3` and the plan (already committed), and K's `kitchen_board_read` and board
   commit, which land before G's `send-push` commit (§1.1). If they are not ready for this push,
   step 2's push carries them: they add no push kind, so they do the `send-push` push no harm.
   After whichever push carries them, the operator is tagged and installed on every station (the
   install that must precede any new role anyway, step 4). `kitchen_money_reads` takes the kitchen
   roles' direct order reads away, so a board still reading `tickets` with embedded orders would
   show every ticket without its lines; step 3 therefore waits until the operator that reads
   through `kitchen_board` runs on every kitchen machine.
2. **`send-push` alone**, with no staff migration in the push (none of this work's migrations
   except K's `kitchen_board_read`, which adds no push kind). G's `send-push` commit (`send-push/**`,
   `_shared/staff-push.json`, `send-push/staffStrings.ts` and their tests) sits in history before
   every migration commit of this work but K's `kitchen_board_read`, so push exactly up to it:
   `git push origin <send-push sha>:main`. Wait for `functions-deploy.yml` to finish on hosted
   before any later push. An unknown push kind is terminal in the deployed function
   (`send-push/index.ts:172-178`). What this push must never carry is the `staff_push` migration;
   a slice 2 commit below the sha does no harm, because it adds no staff kind, and neither do K's
   `kitchen_board_read` and board commit (step 1). K's `kitchen_money_reads` commits after the
   `send-push` commit, so this push never carries it.
3. The migrations (`db-migrate.yml`), `kitchen_money_reads` among them, only after step 1's
   operator install on every kitchen machine. Then `npx supabase migration list --linked` shows 0 pending;
   assert the `storage.objects` policies of `staff-media` (`staff_media_read` must read
   `bucket_id = 'staff-media' and app.staff_media_visible(name)`: its re-issue degrades to a
   NOTICE on a privilege refusal and would leave 0159's wider policy, §2.3) and the four
   `cron.job` rows (§2.19).
   `protocol-action` and `release-review` deploy with whichever functions push comes first; they are
   inert until the cron rows exist.
4. The operator tag: the next annotated `operator-vX.Y.Z` on the pushed commit fires
   `operator-release.yml`. Install it on every station **before** any account is given a new role
   (an older build reads the six roles as revoked), and right after the migration push: an older
   build still offers a manager the locked prices, promotions, rate rules and featured discount,
   switching the hero to Featured while a discount is stored, new cafe items and switch-ons, and shows `PRICE_VIA_PROTOCOL`, `ITEM_VIA_RELEASE` and
   `LAUNCH_VIA_PROTOCOL` unmapped (until it is installed, a manager cannot change a promotion or a
   rate at all). Its Stock ▸
   Products "New product" (`upsert_menu_item` with the default `p_is_active` true,
   `ProductsAdmin.tsx:277-281`) and its new paid option in Add-ons (`OptionsEditor.tsx:146`) are
   refused with `LAUNCH_VIA_PROTOCOL` until the new operator is installed. Tell the managers the
   day before.
5. The mobile build (a person runs production `eas build` and submits).

---

## 2. Database

### 2.1 Conventions every file follows

- Open with `set lock_timeout = '3s'; set statement_timeout = '60s';`. Header comment: feature,
  this file's section, dependencies, waivers.
- Functions: `security definer set search_path = public`, guard first,
  `raise exception '<CODE>' using errcode = 'P0001'`. Dollar tag: `$<name>_<feature>$` in the
  draft only (the ordinal is not known while drafting); at commit every tag in the file becomes
  `$<name>_0NNN$` with the file's final ordinal (`packages/db/CLAUDE.md`, as
  `$confirm_booking_0092$`), in the same step as the header (§1.4).
  Client-callable: `revoke all … from public, anon; grant execute … to authenticated;`.
  Internal: `revoke all … from public, anon, authenticated;` and no grant.
  `comment on` every table, column and function.
- **Role groups** used below (SQL lists are written out in full in code):

  | Name | Roles |
  |---|---|
  | ANY | any active staff: the 0072 guard `app.staff_role() is null → FORBIDDEN` |
  | MGMT | manager, owner |
  | HEADS | head_barista, head_chef |
  | BAR_KITCHEN | head_barista, barista, head_chef, chef |
  | BOARD | prep, cashier, manager, owner, head_barista, barista, head_chef, chef (the kitchen list of `tickets_staff_read` and `set_ticket_status`, 0156:605) |
  | CHEFS | head_chef, chef |
  | HIREABLE | cashier, court_desk, manager, head_barista, barista, head_chef, chef, driver, marketing |

  `prep` passes ANY guards and is added to **no** new explicit list (**PROPOSAL**, consistent with
  the soft retirement). BOARD is the one exception: it is the existing kitchen list, and
  `kitchen_board` serves the board a prep account still signs into, so prep leaves it only with
  the later drop of prep from every kitchen guard (§2.23).
- **Guards, in this order.**
  - Venue from an argument, ANY: `if app.staff_role() is null then FORBIDDEN; v_venue := coalesce(p_venue_id, app.current_venue()); if not (v_venue = any(app.staff_venue_ids())) then FORBIDDEN;`
  - Venue from an argument, subset: `if not app.is_staff(<roles>) then FORBIDDEN; v_venue := …; if not app.is_staff_at(v_venue, <roles>) then FORBIDDEN;`
  - Row-addressed: `if app.staff_role() is null then FORBIDDEN;` then lock the row; a row at a venue
    outside `app.staff_venue_ids()` raises the row's `…_NOT_FOUND` code (no cross-venue oracle);
    then the role check.
  - After the venue is known, every write RPC runs
    `perform set_config('app.venue_id', v_venue::text, true);` so bodies that rely on the
    `app.current_venue()` column default (`consume_fefo` → `stock_movements`, `receive_delivery` →
    `deliveries`, `upsert_menu_item` → `menu_items`) resolve on a phone, which asserts no station
    (0125 step 2).
  - Scheduled and service-role functions take `venue_id` from the row, never `current_venue()`.
- **New tables:** `venue_id uuid not null references venues(id)` with **no default** (**PROPOSAL**:
  every writer is a definer RPC that names it) on every table with a select policy; child tables
  read only through RPCs derive it by FK. RLS on; **select-only** policies; no insert, update or
  delete grant to clients; `grant select … to authenticated; grant all … to service_role;`.
- **The any-staff vs explicit-list rule.** A table may carry an any-staff select policy only when
  every column is something any staff member, including driver and marketing on a personal phone,
  may read: no price, cost or total, no other person's personal data, no free text about a person.
  Otherwise its policy names roles (the 0157 lesson). In this work **every new table's policy is
  MGMT at the venue** (`app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids())`,
  or `exists` on the parent), plus the own-row policies named per table. Everyone else reads
  through definer RPCs that shape the output by role.
- **Idempotency.** An RPC with side effects a retry would repeat takes
  `p_idempotency_key text default null` and brackets its work with
  `v := app.claim_replay(p_idempotency_key, '<fn>'); if v is not null then return v; end if;` …
  `perform app.finish_replay(p_idempotency_key, v_result);` (0049). Named per RPC below.
  Decisions, ticks, withdrawals, skips and stops are state-idempotent (a repeat hits a state code)
  and take no key.
- **Text.** Owner-typed template, step, checklist and item text: `_en` and `_ar` both NOT NULL and
  non-blank (`TEXT_BOTH_LANGUAGES_REQUIRED`). Staff-typed titles: `title_en`, `title_ar` nullable,
  at least one non-blank (`TEXT_REQUIRED`, hint `title`). Free text (notes, records, briefs) is one
  field in the writer's language. Caps: titles 120, names 80, checklist items 200, decision notes
  1000, notes and records' free text 2000, release notes included (`TEXT_TOO_LONG`, hint = field).
- **Required-text CHECKs** are written `coalesce(length(btrim(<col>)),0) > 0`. The bare
  `length(btrim(<col>)) > 0` is NULL for a NULL column, and a CHECK accepts NULL, so it enforces
  nothing.
- **Audit.** `app.write_audit(action, entity, entity_id, before, after)`; the actor is
  `auth.uid()` (null from cron shows as System). Payloads carry ids, statuses, decisions and counts
  only, never free text, never candidate data (`audit_log` is append-only, 0005:25). The action list
  is §2.22.
- **Indexes.** Plain `create index` on a table created in the same file is allowed with the header
  line `MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables` (0108 precedent). An index on
  an existing table goes in its own migration with a waiver (0135 precedent); the only one here is
  `event_block_run_index`.
- **Constraints on existing tables:** `add constraint … not valid`, then `validate constraint`
  inside a `pg_constraint` guard testing `conname` and `conrelid = '<table>'::regclass`.
- **Re-issues** copy the latest body verbatim at the moment of commit
  (`grep -n "function app.<name>(" supabase/migrations/*.sql | tail -1`, both `create` spellings).
  If slice 2 re-issued it after you drafted, rebase onto that body.

### 2.2 Migration list (by name and dependency)

| Migration | Lane | Depends on | Contents |
|---|---|---|---|
| `kitchen_board_read` | K | – | `app.kitchen_board`, the money-free read the kitchen board uses (§2.23) |
| `kitchen_money_reads` | K | `kitchen_board_read` (and, by commit order, K's board commit and G's `send-push` commit, §1.1) | the four order-side read policies of 0157 without the bar and kitchen family and prep; venue conjunct on `order_items` and `order_item_modifiers` (§2.23) |
| `staff_media_bucket` | G | – | `staff_media_uploads`; bucket `staff-media` and its storage policies; path helpers; `staff_media_slot`; `app.claim_staff_media` |
| `staff_push` | G | – | push kind CHECK widened; `app.staff_ids_with_roles`; `app.notify_staff`; `set_staff_active`, `submit_staff_request`, `decide_staff_request` re-issued |
| `staff_ingredient_options` | A | – | narrow ingredient read |
| `protocols_engine_tables` | A | – | seven engine tables, step definitions, state-machine functions, seeds |
| `protocols_engine_rpcs` | A | `protocols_engine_tables`, `staff_media_bucket`, `staff_push` | §2.7 RPCs and the hook dispatcher; `app.staff_media_visible`, with `app.claim_staff_media` and the `staff_media_read` policy re-issued (§2.3, §2.18) |
| `product_test_movement` | E | – | `alter type movement_type add value if not exists 'product_test';` and nothing else |
| `product_release` | E | `protocols_engine_rpcs`, `product_test_movement` | menu columns (`launched_at` counts every existing item as launched); `upsert_variant_internal` plus the `upsert_variant` wrapper (`ITEM_IN_RELEASE`); `upsert_menu_item_internal` plus the `upsert_menu_item` wrapper (`ITEM_IN_RELEASE` and the manager new-item guard: `ITEM_VIA_RELEASE`, `LAUNCH_VIA_PROTOCOL`); release hooks and reads; variance and `report_stock` |
| `release_post_launch` | E | `product_release`, `marketing_staff` (C; `release_review_input` reads `marketing_notes`) | `release_reviews`, `release_notes`; scheduler functions; two cron jobs |
| `event_court_blocks` | F | `protocols_engine_rpcs` | reservation columns; `block_courts_for_event`, `tournament_context`; tournament hooks; analytics and `report_courts` re-issues |
| `event_block_run_index` | F | `event_court_blocks` | one partial index on `reservations` |
| `hiring` | F | `protocols_engine_rpcs` | `hiring_candidates`; hiring hooks; purge cron |
| `price_promo` | F | `protocols_engine_rpcs`, `product_release` (`upsert_variant_internal` and the `upsert_variant` wrapper body it re-issues from; `upsert_menu_item_internal` and `menu_items.launched_at`, which the `shop_launch` apply uses) | promotion internals and wrappers with the manager promotion lock, and `generate_promo_code` re-issued with it; `upsert_rate_rule_internal` plus the `upsert_rate_rule` wrapper (rate lock); `set_cafe_setting_internal` plus the `set_cafe_setting` wrapper (featured-discount lock, `hero_mode` included); `upsert_variant` re-issued with the manager price lock on every launched item, shop included; `modifiers.launched_at`; `upsert_modifier_internal` plus the `upsert_modifier` wrapper (add-on price lock and launch guard); the eight change kinds, their apply and its target check; `price_promo_targets`, `price_promo_numbers`; price/promo hooks; apply cron |
| `checklists` | C | `staff_push` | four checklist tables and RPCs |
| `shopping_purchases` | C | `staff_push`, `staff_media_bucket`, `staff_ingredient_options` | three tables and RPCs |
| `staff_production` | C | – | `record_production_internal`, `record_batch`, two reads |
| `marketing_staff` | C | `protocols_engine_tables`, `staff_media_bucket` | campaign columns; `marketing_notes`; RPCs |

### 2.3 `staff_media_bucket` (G)

**Upload slots** (**PROPOSAL**, replaces the plan's "RPC checks `storage.objects.owner_id`", which
needed the UNVERIFIED definer read of `storage.objects`): the server mints every path, and both the
storage policy and the recording RPCs check the slot.

```
staff_media_uploads  path text primary key, venue_id uuid not null references venues(id),
                     folder text not null check (folder in ('proposals','tests','steps','marketing','campaigns','receipts')),
                     uploader uuid not null references staff(id), created_at timestamptz not null default now(),
                     used_at timestamptz, used_by text
RLS: select own rows (uploader = auth.uid()). Index (uploader, created_at).
```

- Path grammar: `<venue_id>/<folder>/<uuid>.<ext>`, ext `jpg | png | webp`,
  regex `^[0-9a-f-]{36}/(proposals|tests|steps|marketing|campaigns|receipts)/[0-9a-f-]{36}\.(jpg|png|webp)$`.
- Helpers, `immutable`, granted to `anon, authenticated, service_role` (a policy runs them as the
  reading role, the 0116→0121 rule): `app.is_staff_media_path(text) returns boolean`,
  `app.staff_media_venue(text) returns uuid`, `app.staff_media_folder(text) returns text`.
  **They never raise.** A name that fails the path regex returns `false` / NULL, for example
  `case when name ~ '<regex>' then split_part(name, '/', 1)::uuid end`. The staff-media policies
  sit on `storage.objects` beside the `menu-media` ones (0031:299-326), and Postgres does not
  promise to test `bucket_id = 'staff-media'` before the helper, so a helper that cast
  `items/…` to uuid would break menu photos for every signed-in user. All three go in
  `rpc-allowlist.json` `publicByDesign`, each with its reason (for example "pure text: splits a
  storage path; a storage policy evaluates it as the reading role"), because they do not refuse a
  guest and `check-rpc-authz` would fail them as `guarded`.
- Bucket `staff-media`: `public = false`, `file_size_limit = 5242880`,
  `allowed_mime_types = {image/jpeg,image/png,image/webp}`, in the guarded DO block shape of
  0031:283-336 (notice on insufficient privilege; assert on hosted).
- Policies on `storage.objects`:
  - `staff_media_insert` (insert, authenticated): `bucket_id = 'staff-media' and exists (select 1 from public.staff_media_uploads u where u.path = name and u.uploader = auth.uid() and u.used_at is null and u.created_at > now() - interval '1 hour')`.
  - `staff_media_read` (select, authenticated): `bucket_id = 'staff-media' and app.staff_role() is not null and app.staff_media_venue(name) = any(app.staff_venue_ids()) and (app.staff_media_folder(name) <> 'receipts' or owner_id = auth.uid()::text or app.is_staff('manager','owner'))`. **UNVERIFIED:** `owner_id` exists on the hosted storage version.
    **Re-issued by `protocols_engine_rpcs` (A)** (review 2026-09-25: the 0159 form let any staff
    member at the venue list and open photos §2.7 hides) as
    `bucket_id = 'staff-media' and app.staff_media_visible(name)`. `app.staff_media_visible(text)
    returns boolean` (definer, stable, never raises, granted to `authenticated` and `service_role`,
    `publicByDesign`, coverage `map:action`) reads the slot row: false for a guest, another venue
    or a name that is not a staff-media path; true for the uploader and MGMT at the venue; for
    `protocol_submission:<id>` also the sender of a submission of that step naming the path, and
    anyone involved in the run when the step's `record_visibility` is `run` (an owner-added step
    of a hiring run counts as `mgmt`); for `marketing_note:<id>` also marketing at the venue;
    anything else (receipts, campaign images, unclaimed slots) the uploader and MGMT only. A lane
    that claims photos under a new `<kind>` re-issues it from A's body.
  - `staff_media_delete` (delete, authenticated): MGMT at the path's venue. No update policy.

| RPC | Args | Returns | Guard | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `staff_media_slot` | `p_venue_id uuid, p_folder text, p_ext text` | `{path, bucket: 'staff-media', expires_at}` | ANY at venue | `FORBIDDEN`, `INVALID_ARGUMENT` (folder, ext), `UPLOAD_LIMIT` (more than 30 unused slots in the last hour) | – | – |
| `app.claim_staff_media` (internal) | `p_paths text[], p_venue uuid, p_folders text[], p_used_by text` | void | – | `PHOTO_PATH_INVALID` when a path is not a slot of `auth.uid()` at that venue in an allowed folder, or is used by something else (except the re-claim below) | – | – |

Every recording RPC calls `app.claim_staff_media` for its photo arguments. **Re-claim on
resubmission:** a path whose `used_by` is `protocol_submission:<id>` may be claimed again by a new
submission of the same run step when that earlier submission is withdrawn, superseded or decided
`send_back`, or belongs to an earlier round (an approved or automatic submission whose step a
send-back or `cancel_schedule` reopened; A re-issues `app.claim_staff_media` for this in
`protocols_engine_rpcs`), whoever uploaded it; `used_by` then names the new submission, and the earlier row keeps
the path in its history. So both apps keep the attached photos on a resubmission. Reading is by
signed URL (`createSignedUrl(path, 600)`), on both apps. Only the launch copies a photo out (§2.20).
`staff_media_uploads` never gets `app.assistant_readable_columns` rows (§1.5).

### 2.4 `staff_push` (G)

- Kind CHECK (latest 0075:45-60): drop `notification_outbox_kind_check` (scoped by `conrelid`),
  add it `not valid` with `('booking_confirmed','booking_reminder','booking_cancelled','booking_no_show','test','staff_task','staff_decide','staff_decided','staff_info')`,
  then `validate`.
- `app.staff_ids_with_roles(p_venue uuid, p_roles staff_role[]) returns uuid[]` (internal): active
  staff holding one of the roles who are members of the venue; owners count at every venue.
- `app.notify_staff(p_staff_ids uuid[], p_kind text, p_payload jsonb, p_dedupe text default null) returns int`
  (internal): inserts one `notification_outbox` row per recipient (`profile_id = staff.id`); skips
  nulls, inactive staff and `auth.uid()`; when `p_dedupe` is set, skips a recipient who got a row
  with the same `payload->>'dedupe'` in the last 15 minutes; validates `p_kind` and
  `payload->>'title_key'` against the lists in §2.21 (`INVALID_ARGUMENT`); ends with
  `perform app.push_nudge();`. Returns rows queued.
- Payload: `{route, id, title_key, params, dedupe?}` (§2.21). Never money, a phone number or a
  candidate name.
- Re-issues (latest bodies): `app.set_staff_active` (0081) clears `profiles.expo_push_token` for
  the account when `p_active = false`; `app.submit_staff_request` (0072) notifies owners
  `staff_decide / request_submitted`; `app.decide_staff_request` (0072) notifies the requester
  `staff_decided / request_approved | request_rejected`. Signatures and guards unchanged.

### 2.5 `staff_ingredient_options` (A)

| RPC | Args | Returns | Guard | Errors |
|---|---|---|---|---|
| `staff_ingredient_options` | `p_venue_id uuid default null, p_query text default null` | `{ingredients: [{id, name_en, name_ar, unit, kind, pack_size}]}`, active ingredients at the venue, `p_query` matched on either name, max 200 | BAR_KITCHEN, driver, MGMT at venue (driver for the purchase pack helper, **PROPOSAL**) | `FORBIDDEN` |

No cost, no on-hand, no supplier (ingredient tables stay MGMT, 0136:129-151).

### 2.6 `protocols_engine_tables` (A)

```
protocol_templates       id uuid pk default gen_random_uuid(), venue_id uuid not null → venues,
                         kind text not null check (kind in ('product_release','tournament','hiring','price_promo')),
                         variant text check (variant in ('type1','type2','type3')),
                         check ((kind = 'tournament') = (variant is not null)),
                         name_en text not null, name_ar text not null,
                         version int not null default 1, updated_by uuid → staff, updated_at timestamptz not null default now(),
                         unique nulls not distinct (venue_id, kind, variant)
protocol_template_steps  id uuid pk, template_id uuid not null → protocol_templates on delete cascade,
                         position int not null check (position >= 1),
                         step_key text,                                   -- null = the owner's own step
                         name_en text not null, name_ar text not null,
                         actor_roles staff_role[] not null check (cardinality(actor_roles) >= 1),
                         needs_owner_ok boolean not null default false,
                         optional boolean not null default false,
                         unique (template_id, position) deferrable initially deferred,
                         unique (template_id, step_key)
protocol_template_items  id uuid pk, step_id uuid not null → protocol_template_steps on delete cascade,
                         position int not null, text_en text not null, text_ar text not null,
                         unique (step_id, position) deferrable initially deferred
protocol_runs            id uuid pk, venue_id uuid not null → venues, template_id uuid not null → protocol_templates,
                         template_version int not null, kind text not null (same check), variant text,
                         title_en text, title_ar text,
                         check (coalesce(length(btrim(title_en)),0) > 0 or coalesce(length(btrim(title_ar)),0) > 0),
                         status text not null default 'active'
                           check (status in ('active','scheduled','live','done','stopped','withdrawn')),
                         started_by uuid not null → staff, started_at timestamptz not null default now(),
                         scheduled_for timestamptz, check (status <> 'scheduled' or scheduled_for is not null),
                         live_at timestamptz, finished_at timestamptz,
                         check ((status in ('done','stopped','withdrawn')) = (finished_at is not null)),
                         stop_reason text, check (status <> 'stopped' or coalesce(length(btrim(stop_reason)),0) > 0),
                         menu_item_id uuid → menu_items on delete set null,
                         promotion_id uuid → promotions on delete set null,
                         data jsonb not null default '{}',
                         photos_purged_at timestamptz
protocol_run_steps       id uuid pk, run_id uuid not null → protocol_runs on delete cascade,
                         position int not null, step_key text, name_en text not null, name_ar text not null,
                         actor_roles staff_role[] not null, assigned_to uuid → staff,
                         needs_owner_ok boolean not null, optional boolean not null,
                         after_keys text[] not null default '{}',
                         status text not null default 'waiting'
                           check (status in ('waiting','open','submitted','passed','skipped','stopped')),
                         round int not null default 1, opened_at timestamptz, passed_at timestamptz,
                         skip_note text, skipped_by uuid → staff, skipped_at timestamptz,
                         check (status <> 'skipped' or (skipped_by is not null and coalesce(length(btrim(skip_note)),0) > 0)),
                         unique (run_id, position) deferrable initially deferred
protocol_submissions     id uuid pk, run_step_id uuid not null → protocol_run_steps on delete cascade,
                         run_id uuid not null → protocol_runs on delete cascade, round int not null,
                         submitted_by uuid not null → staff, submitted_at timestamptz not null default now(),
                         record jsonb not null, photos text[] not null default '{}' check (cardinality(photos) <= 8),
                         withdrawn_at timestamptz, superseded_at timestamptz,
                         decided_by uuid → staff, decided_at timestamptz,
                         decision text check (decision in ('approve','auto','send_back','stop')),
                         decision_note text, send_back_to uuid → protocol_run_steps,
                         check (decision is null or (decided_by is not null and decided_at is not null
                                and (decision = 'auto' or decided_by <> submitted_by))),
                         check (decision is null or decision not in ('send_back','stop')
                                or coalesce(length(btrim(decision_note)),0) > 0),
                         check (num_nonnulls(decision, withdrawn_at, superseded_at) <= 1)
protocol_run_items       id uuid pk, run_step_id uuid not null → protocol_run_steps on delete cascade,
                         position int not null, text_en text not null, text_ar text not null,
                         done_by uuid → staff, done_at timestamptz, check ((done_by is null) = (done_at is null))
```

- Indexes (same file, waiver): `protocol_runs (venue_id, status)`, `protocol_runs (started_by)`,
  `protocol_run_steps (run_id, status)`, `protocol_run_steps (assigned_to) where assigned_to is not null`,
  `protocol_submissions (run_step_id, round)`, `protocol_submissions (submitted_by)`,
  unique `protocol_submissions (run_step_id, round) where withdrawn_at is null and superseded_at is null`,
  `protocol_run_items (run_step_id)`, `protocol_template_items (step_id)`.
- RLS: select policy MGMT at venue on `protocol_templates` and `protocol_runs`; the other five by
  `exists` on their parent under the same predicate.
- `app.assistant_readable_columns` (§1.5) takes the seven tables **without**
  `protocol_submissions.decision_note`, `protocol_submissions.record`,
  `protocol_run_steps.skip_note` and `protocol_runs.stop_reason`, for every kind: a hiring run's
  may name a candidate until the 90-day purge (§2.12), what the assistant reads goes to the LLM,
  and a column cannot be left out for one kind only (review 2026-09-25).
- `app.protocol_step_defs(p_kind text, p_variant text) returns jsonb` (immutable, internal): the
  built-in steps of §2.8 as `[{step_key, name_en, name_ar, actor_roles, assign_to_starter, needs_owner_ok, ok_fixed, optional, after, fixed, photo_folder, photos_min, photos_max, record_visibility}]`
  with `fixed` in `first | last | null` and `record_visibility` in `run | mgmt`. `ok_fixed` is true
  on the two price steps, release `analysis` and price/promo `numbers` (always on, plan #58), and
  on the two owner-only steps, release `launch` and hiring `add_staff` (the owner is the actor, so
  the flag means nothing there); the editor hides the switch wherever it is true.
- `app.protocol_step_allowed(p_from text, p_to text)` and `app.protocol_run_allowed(p_from text, p_to text)`,
  `immutable`, the 0112 transition-table shape. Allowed step moves:
  `waiting→open`, `waiting→skipped`, `open→submitted`, `open→skipped`, `open→waiting`,
  `submitted→open`, `submitted→passed`, `submitted→stopped`, `submitted→waiting`,
  `passed→open`, `passed→waiting`. Allowed run moves: `active→scheduled|live|done|stopped|withdrawn`,
  `scheduled→active|live|done|stopped`, `live→done`.
- `app.protocol_seed_venue(p_venue uuid) returns void` (internal): writes the four kinds' templates
  (three tournament variants) from the defs, EN and AR. The migration runs it for every active
  venue. **Coordination with slice 2:** venue creation calls it (the `PHASE-2-PLAN.md:25` copy rule).

### 2.7 `protocols_engine_rpcs` (A)

**Engine rules.**
- **Snapshot.** `start_protocol` copies the template's steps and items into run rows and stores
  `template_version`. Template edits change only new runs. For a step whose def has `ok_fixed`,
  the run takes `needs_owner_ok` from the def, never from the template row, so a row written
  around `save_protocol_template` cannot switch the owner's OK off (plan #58).
- **Opening.** After every transition the engine opens each `waiting` step whose `after_keys` are
  all `passed` or `skipped`, and whose lower-positioned owner-added steps are all `passed` or
  `skipped`. An owner-added step waits for every step below it. The terminal (`fixed = last`) step
  also waits for every other step to be `passed` or `skipped`.
- **Who may act.** The `assigned_to` person when set (then only them); otherwise a holder of one of
  `actor_roles` at the venue. A manager may cover any step whose actors do not include `owner`; the
  owner may cover any step. The record shows who submitted.
- **Who decides.** `needs_owner_ok` on: the owner. Off: a manager at the venue, or the owner
  (**PROPOSAL**: the owner as well, so no step stalls without a manager).
- **Automatic pass.** When the submitter is one of the step's possible deciders, the submission is
  decided at once: `decision = 'auto'`, `decided_by = submitted_by`, audit `protocol.auto`. This
  covers the manager's own steps (#9) and the owner's own steps (Q12). An automatic pass has no
  decision dialog, so the engine hands the pass hook the submission's normalised record as
  `p_decision_data`; a step whose approval needs decision data asks for it in the record when the
  submitter is a decider (release `propose`, §2.8).
- **Send back** to target T (the submitted step itself or any `passed` step below it): T → `open`,
  `round + 1`; every step that waits for T by the opening rule, transitively (a built-in step
  through its `after` keys, any step above an owner-added one, an owner-added step above any step,
  the terminal step), and the sent-back step itself when T is another step, goes from `passed`,
  `open` or `submitted` to `waiting` (`round + 1` where it holds a decided submission of its
  current round), their undecided submissions get `superseded_at`; then the opening rule runs.
  A step that does not wait for T keeps its state, so the order of two parallel steps never
  changes what a send-back undoes (review 2026-09-25; this replaced "every step above T").
  Earlier rounds stay.
- **Stop** (a decision, or `stop_protocol`): the step → `stopped`, the run → `stopped`, the kind's
  stop hook runs. A reason is required.
- **Terminal pass:** the kind's finish hook returns the run status (`done`, `live` or `scheduled`).
- **Hooks** decouple the engine from E and F. The engine calls a hook only when it exists
  (`to_regprocedure`), through `execute format('select app.%I(…)', name)`. Hooks are internal
  (revoked from every client role), run in the caller's transaction and see the caller's
  `auth.uid()`. A hook may call a public RPC only when every caller that reaches it passes that
  RPC's guard; otherwise it calls an `_internal` body.

  | Hook | Signature | Called | Missing |
  |---|---|---|---|
  | `protocol_start_<kind>` | `(p_run_id uuid, p_data jsonb) returns jsonb` (normalised `data`) | `start_protocol`, after the snapshot, before step 1's submission exists | `start_protocol` raises `PROTOCOL_NOT_READY` |
  | `protocol_check_<kind>_<step_key>` | `(p_run_step_id uuid, p_record jsonb, p_photos text[]) returns jsonb` (normalised record) | `submit_step` and `start_protocol` (step 1), before insert, on every round | generic check: `{note?}` only |
  | `protocol_submit_<kind>_<step_key>` | `(p_submission_id uuid) returns void` | `submit_step` and `start_protocol` (step 1), after insert, before the automatic pass, on every round | nothing |
  | `protocol_pass_<kind>_<step_key>` | `(p_run_step_id uuid, p_submission_id uuid, p_decision_data jsonb) returns void` | on approve or automatic pass | nothing |
  | `protocol_finish_<kind>` | `(p_run_id uuid) returns text` | when the terminal step passes | `'done'` |
  | `protocol_stop_<kind>` | `(p_run_id uuid) returns void` | run → stopped or withdrawn | nothing |

  **Every start hook takes `data = {}` in v1** and only marks its kind as ready. Work that needs
  the first record never goes in a start hook, which runs before that record is submitted:
  validation belongs in step 1's check hook and side effects in its submit hook, which also run
  again when step 1 is sent back and resubmitted.

  Owner-added steps (`step_key` null) use the generic check (`{note?: text ≤ 2000}`, photos folder
  `steps`, 0 to 6) and no other hook. Photo claiming is the engine's: it calls
  `app.claim_staff_media(p_photos, venue, {def.photo_folder}, 'protocol_submission:<id>')` (with
  the §2.3 re-claim for a resubmission) and enforces `photos_min` and `photos_max`
  (`RECORD_INVALID`, hint `photos`).
- **Visibility for anyone who is not MGMT.** "Involved" = the starter, or an actor or assignee of
  any step of the run. Involved staff see the run header, every step's status and names, their own
  submissions, and the records and photos of steps whose def says `record_visibility = 'run'`.
  Records of `mgmt` steps and the run's `data` are returned as `null` (the starter also sees
  `data`). Nobody outside the run sees it. A step whose actors need facts from a `mgmt` record gets
  a narrow context read instead of wider visibility: `tournament_context` for the tournament
  `courts` and `marketing` steps (§2.11), `release_test_context` for the release `test` step
  (§2.9). The day-30 review is not part of any run shape: only MGMT reads it, through
  `release_review` (§2.10, #54), so an involved starter sees the run reach `done` with no figures
  and no write-up. The staff-media read policy follows the same rule (`app.staff_media_visible`,
  §2.3), so a signed URL or a listing shows no photo these reads hide.

**Shared JSON shapes** (returned by several RPCs; all keys always present, nulls allowed):

```
RunRow        {id, kind, variant, title_en, title_ar, status, started_by, started_by_name, started_at,
               finished_at, scheduled_for, live_at, menu_item_id, promotion_id,
               current_steps: [StepBrief], waiting_on_me: boolean}
StepBrief     {id, position, step_key, name_en, name_ar, status, round}
StepRow       StepBrief + {actor_roles, assigned_to, assigned_to_name, needs_owner_ok, optional,
               after_keys, opened_at, passed_at, skip_note, skipped_by_name, skipped_at,
               items: [ItemRow], submissions: [SubmissionRow]}
ItemRow       {id, position, text_en, text_ar, done_by, done_by_name, done_at}
SubmissionRow {id, round, submitted_by, submitted_by_name, submitted_at, record, photos,
               withdrawn_at, superseded_at, decision, decided_by, decided_by_name, decided_at,
               decision_note, send_back_to}
Can           {submit: boolean, withdraw_submission_id: uuid|null, decide_submission_id: uuid|null,
               send_back_targets: [uuid], skip: boolean, tick: boolean, edit_items: boolean,
               add_step: boolean, stop: boolean, withdraw_run: boolean, cancel_schedule: boolean}
```

**RPCs** (all client-callable, `grant execute … to authenticated`).

| RPC | Args | Returns | Guard | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `start_protocol` | `p_kind text, p_variant text default null, p_title_en text default null, p_title_ar text default null, p_data jsonb default '{}', p_first_record jsonb default null, p_photos text[] default '{}', p_venue_id uuid default null, p_idempotency_key text default null` | `{run_id, status, first_step_id, submission_id, auto}` | by kind at venue: product_release HEADS + MGMT; tournament MGMT; hiring MGMT; price_promo manager, marketing, owner | `FORBIDDEN`, `INVALID_ARGUMENT` (kind, variant), `PROTOCOL_NOT_FOUND` (no template), `PROTOCOL_NOT_READY`, `TEXT_BOTH_LANGUAGES_REQUIRED` (owner), `TEXT_REQUIRED`, `TEXT_TOO_LONG`, `RECORD_INVALID` (hint `record`) when `p_first_record` is null, step 1's hook codes (`SPONSOR_DETAILS_REQUIRED`, `RECORD_INVALID`, `PHOTO_PATH_INVALID`, `NOT_STEP_ACTOR` for marketing's `shop_launch`, §2.8) | yes | `protocol.start`; `protocol.submit`/`protocol.auto` for step 1 |
| `submit_step` | `p_run_step_id uuid, p_record jsonb, p_photos text[] default '{}', p_idempotency_key text default null` | `{submission_id, auto, step_status, run_status, opened_step_ids}` | ANY; then may act | `PROTOCOL_NOT_FOUND`, `PROTOCOL_CLOSED`, `STEP_NOT_OPEN`, `NOT_STEP_ACTOR`, `RECORD_INVALID`, `PHOTO_PATH_INVALID`, `TEXT_TOO_LONG`, hook codes | yes | `protocol.submit` (+ `protocol.auto`) |
| `withdraw_step` | `p_submission_id uuid` | `{step_status}` | the submitter | `PROTOCOL_NOT_FOUND`, `FORBIDDEN`, `SUBMISSION_DECIDED` | – | `protocol.withdraw` |
| `decide_step` | `p_submission_id uuid, p_decision text, p_note text default null, p_send_back_to uuid default null, p_data jsonb default '{}'` | `{submission_id, decision, step_status, run_status, opened_step_ids}` | a decider | `PROTOCOL_NOT_FOUND`, `PROTOCOL_CLOSED`, `SUBMISSION_DECIDED`, `NOT_DECIDER`, `CANNOT_DECIDE_OWN`, `REASON_REQUIRED`, `SEND_BACK_TARGET_INVALID`, `INVALID_ARGUMENT`, pass-hook codes | – | `protocol.decide` |
| `skip_step` | `p_run_step_id uuid, p_note text` | `{step_status, opened_step_ids}` | the step's decider | `STEP_NOT_OPTIONAL`, `STEP_CLOSED` (submitted, passed, stopped), `REASON_REQUIRED`, `NOT_DECIDER` | – | `protocol.skip` |
| `tick_run_item` | `p_item_id uuid, p_done boolean` | `ItemRow` | may act on the step | `STEP_NOT_OPEN`, `NOT_STEP_ACTOR`, `PROTOCOL_NOT_FOUND` | – | – (the row keeps who and when, **PROPOSAL**) |
| `withdraw_protocol` | `p_run_id uuid` | `{run_status}` | the starter, before any decision (an automatic pass counts) | `FORBIDDEN`, `INVALID_TRANSITION` | – | `protocol.withdraw_run` |
| `stop_protocol` | `p_run_id uuid, p_note text` | `{run_status}` | MGMT at venue (**PROPOSAL**) | `REASON_REQUIRED`, `PROTOCOL_CLOSED` | – | `protocol.stop` |
| `cancel_schedule` | `p_run_id uuid` | `{run_status, reopened_step_id}` | may act on the terminal step | `INVALID_TRANSITION`, `NOT_STEP_ACTOR` | – | `protocol.unschedule` |
| `edit_run_items` | `p_run_step_id uuid, p_items jsonb` (`[{id: uuid\|null, text_en, text_ar}]`, max 12; kept ids keep their ticks) | `StepRow` | owner | `STEP_CLOSED`, `LIST_TOO_LONG`, `TEXT_BOTH_LANGUAGES_REQUIRED` | – | `protocol.run.edit_items` |
| `add_run_step` | `p_run_id uuid, p_after_run_step_id uuid, p_step jsonb` (`{name_en, name_ar, actor_roles, needs_owner_ok, optional, items: [{text_en, text_ar}]}`) | `StepRow` | owner; run active; inserted below the terminal step, which is still `waiting`, and above no other step that has left `waiting` (the engine never takes a started step back; hint = the lowest step in the way; right below the terminal step is always allowed, so `Can.add_step` stays run-level) | `PROTOCOL_CLOSED`, `PROTOCOL_ORDER_INVALID`, `INVALID_ROLE`, `LIST_TOO_LONG`, `TEXT_BOTH_LANGUAGES_REQUIRED` | – | `protocol.run.add_step` |
| `save_protocol_template` | `p_template_id uuid, p_expected_version int, p_name_en text, p_name_ar text, p_steps jsonb` (ordered `[{step_key\|null, name_en, name_ar, needs_owner_ok, optional, actor_roles, items: [{text_en, text_ar}]}]`; `optional` and `actor_roles` are read only for owner-added steps) | `{template_id, version}` | owner | `TEMPLATE_CHANGED`, `PROTOCOL_STEP_FIXED` (a built-in step missing, unknown or duplicated, or its actors/optional changed, or `needs_owner_ok` differing from the def on an `ok_fixed` step, plan #58), `PROTOCOL_ORDER_INVALID` (a built-in step above one of its `after` keys, the first not first, the last not last), `INVALID_ROLE` (owner-added actors outside HIREABLE), `LIST_TOO_LONG` (more than 20 steps or 12 items per step), `TEXT_BOTH_LANGUAGES_REQUIRED` | – | `protocol.template.save` |
| `protocol_template_detail` | `p_template_id uuid` | `{template: {id, kind, variant, name_en, name_ar, version, updated_at, updated_by_name}, steps: [{position, step_key, name_en, name_ar, actor_roles, needs_owner_ok, optional, items: [{text_en, text_ar}]}], defs: <protocol_step_defs>}` | MGMT at venue | `PROTOCOL_NOT_FOUND` | – | – |
| `protocols_overview` | `p_venue_id uuid default null` | `{templates: [{template_id, kind, variant, name_en, name_ar, version, running, waiting_on_me, finished_30d}]}` | MGMT at venue | `FORBIDDEN` | – | – |
| `protocol_runs_page` | `p_venue_id uuid default null, p_filter text default 'waiting', p_kind text default null, p_limit int default 50, p_offset int default 0` | `{runs: [RunRow], total}` | ANY at venue; MGMT see every run, others only runs they are involved in | `INVALID_ARGUMENT` (filter not `waiting \| active \| finished \| mine`) | – | – |
| `protocol_run_detail` | `p_run_id uuid` | `{run: RunRow + {template_name_en, template_name_ar, data}, steps: [StepRow], can: Can}` (shaped by visibility) | ANY; MGMT at venue or involved | `PROTOCOL_NOT_FOUND` | – | – |
| `protocol_step_detail` | `p_run_step_id uuid` | `{run: RunRow + {data}, step: StepRow, can: Can, def: <this step's def>}` | ANY; MGMT at venue or involved | `PROTOCOL_NOT_FOUND` | – | – |
| `my_protocol_work` | `p_venue_id uuid default null` | `{todo: [{run_step_id, run_id, kind, variant, title_en, title_ar, step_key, name_en, name_ar, opened_at, round}], waiting: [{submission_id, run_step_id, run_id, kind, title_en, title_ar, name_en, name_ar, submitted_at}], decided: [… + {decision, decision_note, decided_at, decided_by_name}] (7 days), to_decide: [{submission_id, run_step_id, run_id, kind, title_en, title_ar, name_en, name_ar, submitted_by_name, submitted_at, needs_owner_ok}], counts: {todo, waiting, to_decide}}` | ANY at venue | `FORBIDDEN` | – | – |
| `protocols_waiting_count` | `p_venue_id uuid default null` | `{to_decide, todo}` | ANY at venue | `FORBIDDEN` | – | – |

Notifications the engine sends itself (§2.21): `step_open` when a step opens, `step_submitted`
to deciders (the owners when an OK-off step's venue has no active manager), `step_approved` / `step_sent_back` / `step_stopped` to the submitter and starter,
`run_stopped` on `stop_protocol`.

### 2.8 Built-in steps, dependencies and record shapes

Default template per kind. "OK" is the default of `needs_owner_ok` (the owner may flip it, except
where it says **fixed**); "Vis" is `record_visibility`. Actors and "optional" are fixed.

**The price steps' switch** (plan #58, round 10). OK is **always on** at release `analysis` and
price/promo `numbers`, and the switch is hidden, as on `launch` and `add_staff`: the four steps'
defs carry `ok_fixed` (§2.6), `save_protocol_template` refuses a change with
`PROTOCOL_STEP_FIXED`, and a run takes the flag from the def (§2.7). So Q12's "the owner approves
or sends back" and #53's "nothing gets a price without the owner" hold without condition, for
every change kind, the #57 ones included.

**Product release** (`product_release`)

| # | Key | Actors | OK | Optional | After | Fixed | Photos | Vis |
|---|---|---|---|---|---|---|---|---|
| 1 | `propose` | HEADS | off (the manager accepts) | no | – | first | `proposals` 0–6 | run |
| 2 | `test` | HEADS, assigned to the starter | off | no | propose | – | `tests` 1–6 | run |
| 3 | `analysis` ("Price") | manager | **on**, fixed (#58) | no | test | – | – | mgmt |
| 4 | `marketing` | marketing | **on** | no | test | – | `marketing` 0–6 | run |
| 5 | `launch` | **owner** | off (the owner is the author), fixed | no | analysis, marketing | last | – | run |

**Tournament** (`tournament`): type1 and type3 run all five; type2 drops `feasibility`, and its
`marketing` and `courts` come after `plan`. Type2 has every OK off (Q3).

| # | Key | Actors | OK | Optional | After | Fixed | Photos | Vis |
|---|---|---|---|---|---|---|---|---|
| 1 | `plan` | manager | off | no | – | first | – | mgmt |
| 2 | `feasibility` (type1, type3) | manager | **on** | no | plan | – | – | mgmt |
| 3 | `marketing` | marketing | off | **yes** | feasibility (type2: plan) | – | `marketing` 0–6 | run |
| 4 | `courts` | court_desk | off | no | feasibility (type2: plan) | – | – | run |
| 5 | `ready` | manager | off | no | courts, marketing | last | `steps` 0–6 | run |

**Hiring** (`hiring`)

| # | Key | Actors | OK | Optional | After | Fixed | Photos | Vis |
|---|---|---|---|---|---|---|---|---|
| 1 | `open_position` | manager | **on** | no | – | first | – | mgmt |
| 2 | `interviews` | manager | **on** | no | open_position | – | – | mgmt |
| 3 | `add_staff` | owner | off, fixed | no | interviews | last | – | mgmt |

**Price or promotion change** (`price_promo`)

| # | Key | Actors | OK | Optional | After | Fixed | Photos | Vis |
|---|---|---|---|---|---|---|---|---|
| 1 | `propose` | manager, marketing | off (the manager reviews marketing's proposal) | no | – | first | – | run |
| 2 | `numbers` | manager | **on**, fixed (#58) | no | propose | – | – | mgmt |
| 3 | `announce` | marketing | off | **yes** | numbers | – | `marketing` 0–6 | run |
| 4 | `apply` | manager | off | no | numbers, announce | last | – | run |

Order stays fixed where it matters (Q7): a built-in step can move only where no dependency says
otherwise, which leaves exactly two swaps, price and marketing in a product release, marketing and
courts in a tournament (**PROPOSAL** that these two count as "where it does not matter"). A
send-back resets by dependency, not position (§2.7), so neither swap changes what it undoes.

**Record shapes** (validated by the check hooks; `?` = optional; text caps per §2.1):

| Kind / key | Record | Decision data |
|---|---|---|
| release `propose` | `{name_en?, name_ar?` (at least one, ≤ 60)`, item_kind: 'drink'\|'dessert'\|'food', lines: [{ingredient_id?, label?` (one of them)`, qty > 0, unit: 'g'\|'ml'\|'pc'}]` (1–30)`, sizes: [{name_en?, name_ar?}]` (1–4, at least one language each)`, audience?, inspiration?, link?` (https, ≤ 300)`, notes?, category_id?}` (`category_id` required when the submitter decides this step, i.e. MGMT, whose submission passes automatically; `RECORD_INVALID`, hint `category_id`) | approve: `{category_id}` (an active `cafe` category at the run's venue; else `RECORD_INVALID`, hint `category_id`). On an automatic pass the record's `category_id` arrives this way (§2.7) |
| release `test` | `{servings: [{variant_id, count: 1..50}]` (≥ 1)`, notes?}` | – |
| release `analysis` | `{prices: [{variant_id, price_iqd > 0}]` (every active size)`, name_en, name_ar` (both, ≤ 60)`, notes?}` | – (Q12: approve or send back, no override) |
| release `marketing` | `{highlights_en, highlights_ar` (≤ 300)`, hero?: {en, ar}` (≤ 80)`, ticker?: {en, ar}` (≤ 120)`, campaign_id?, notes?}` | – |
| release `launch` | `{when: 'now'\|'date', at?` (future, ≤ 90 days, required for `date`)`, photo_path` (a `tests` or `marketing` photo of this run)`, menu_photo_path?}`. For `now`, `menu_photo_path` is required and must equal `items/<run.menu_item_id>/<run.id>.<ext of photo_path>`, the path `protocol-action` writes after its copy (§2.20); else `RECORD_INVALID`, hint `menu_photo_path`. So a direct `submit_step` of a launch-now without the copy cannot pass. For `date` it is absent | – |
| tournament `plan` | `{class: 'A'\|'B'\|'C', name_en, name_ar` (both, public)`, format?: 'americano'\|'mexicano'\|'knockout'\|'league'` (required for type1/type3)`, ranges: [{court_ids: uuid[], from, to}]` (1–14)`, capacity: {unit: 'players'\|'pairs', count: 2..512}, entry_fee_iqd?, prize?: {text?, iqd?}, budget_iqd?, expected_entries?, risks?, notes?, sponsor?: {name, contact, contribution_iqd, branding?, invoice?}}` (type2 short form: class, names, ranges, capacity, notes; type3 requires `sponsor`: `SPONSOR_DETAILS_REQUIRED`, raised by `protocol_check_tournament_plan`, so `start_protocol` refuses a type 3 start without it). Figures are planning only. | – |
| tournament `feasibility` | `{staffing, income_iqd ≥ 0, cost_iqd ≥ 0, risks, notes?}` | – |
| tournament `marketing` | as release `marketing` | – |
| tournament `courts` | `{reservation_ids: uuid[]` (≥ 1, event blocks of this run)`, moved_note?}` | – |
| tournament `ready` | `{notes?}` + checklist ticks | – |
| hiring `open_position` | `{role` (HIREABLE)`, why, hours` (≤ 300)`, start_date, pay_min_iqd?, pay_max_iqd?}` | – |
| hiring `interviews` | `{candidate_ids: uuid[]` (≥ 1, this run's)`, picked_id` (one of them)`}` | – |
| hiring `add_staff` | `{staff_id}` | – |
| price_promo `propose` | One of eight change kinds (#51, #53, #57), each with `reason, expected_effect`: **`price`** `{change: 'price', menu_item_id` (launched, not in release, cafe or shop)`, prices: [{variant_id, price_iqd > 0}]` (0–12, sizes of that item)`, new_sizes?: [{name_en?, name_ar?, price_iqd > 0}]` (0–4, at least one language each; a cafe item only, else `RECORD_INVALID`, hint `new_sizes`: a shop size carries its own stock item, SKU and barcode, so a new pack size is a new hidden product or the owner's)`}`, at least one of `prices` and `new_sizes` non-empty. **`shop_launch`** `{change: 'shop_launch', menu_item_id` (a shop product with `launched_at` null, switched off)`, prices: [{variant_id, price_iqd > 0}]` (exactly the product's sizes, each once; hint `prices`)`}`; only a MGMT submitter (marketing gets `NOT_STEP_ACTOR`, hint `change`: hidden products are not offered to marketing (no screen or target list shows them), so `price_promo_targets('shop_launch')` is MGMT only. That is a UI rule, not a data wall: since 0156 any staff session reads its venue's hidden items and their draft prices through RLS, 0156:749-752, 766-771; once started, a `shop_launch` run is visible to marketing like any price/promo run, so its optional `announce` step can announce the launch, **PROPOSAL**). **`addon_price`** `{change: 'addon_price', addons: [{modifier_id, price_delta_iqd}]` (1–30, add-ons whose group is at the run's venue; `≥ 0` on a launched add-on, `> 0` on a never-launched one, since a free option needs no run)`}`. **`promotion`** (a new one) `{change: 'promotion', promotion: {name_en, name_ar, type, value, starts_at?, ends_at?, weekdays, hour_from?, hour_to?, scope, limits?, auto?, public_code?, code_single_use?}}` (the `upsert_promotion` arguments, 0067:259-275, without `p_id` and `p_enabled`; the check runs 0067's validations and raises `RECORD_INVALID` with hint `promotion.<field>`; a code is typed or drawn on the client from `PROMO_CODE_ALPHABET` (`@touch/core`), 4–16 letters or digits, and must be free, hint `promotion.public_code`). **`promotion_edit`** (#57) `{change: 'promotion_edit', promotion_id` (an existing promotion, on or off; hint `promotion_id`)`, promotion: {<the same shape>}}`; the check adds `base_updated_at`, the promotion's `updated_at` at submit, to the normalised record. **`promotion_enable`** (#57) `{change: 'promotion_enable', promotion_id` (a switched-off promotion)`}`; the check adds `base_updated_at` the same way. **`rate`** (#57) `{change: 'rate', rule_id?` (absent or null = a new rule; else a rule at the run's venue, hint `rule_id`)`, rule: {name` (≤ 80)`, court_id?` (a court at the run's venue; null = every court)`, days_of_week` (1–7 distinct, 0–6)`, start_time, end_time` (start before end; an overnight window is two rules)`, prices: {"<duration_min>": price_iqd}` (1–12 entries, durations 15–480 in steps of 5, prices > 0)`, priority?, valid_from?, valid_to?, is_active}}` (the `upsert_rate_rule` arguments, 0071:153-165); a failure raises `RECORD_INVALID` with hint `rule.<field>`, never the rate screen's own `INVALID_DAYS`, `INVALID_TIME_RANGE`, `INVALID_PRICES` or `INVALID_DURATION`; for an edit the check adds `before: {rule, prices}`, the rule row and its prices at submit. **`featured_discount`** (#57; `discount_pct` % off the featured item while the hero is in Featured mode, `hero_mode = 'featured'`, §2.13) `{change: 'featured_discount', menu_item_id` (an active item at the run's venue, the item to feature)`, discount_pct: 0..99}`, differing from the stored `featured_item_id` or `featured_discount_pct`, or with `discount_pct` above 0 while the stored `hero_mode` is not `featured` (a run that puts a stored discount live) (hint `discount_pct`); the check adds `before: {featured_item_id, featured_discount_pct, hero_mode}`. A resubmission keeps the run's `change`, `menu_item_id`, `promotion_id` and `rule_id` (`RECORD_INVALID`, hint `change`); its sizes, add-ons, fields and figures may change | – |
| price_promo `numbers` | `{recommendation: 'go'\|'change'\|'drop', prices?, new_sizes?, addons?, rule_prices?, discount_pct?` (final figures for exactly the proposal's targets, same shapes; default the proposal's; hint = the field)`, promotion_value?, note?}` | – |
| price_promo `announce` | `{campaign_id?, hero?, ticker?, notes?}` | – |
| price_promo `apply` | `{when: 'now'\|'date', at?}` | – |

`start_protocol` takes the first step's record in `p_first_record`, which is required: a product
release and a price/promo change are started by submitting `propose`; a tournament by submitting
`plan`; a hiring run by submitting `open_position`. Every starter the §2.7 guard admits may act on
its kind's step 1 (a manager or the owner by covering), so step 1 is always submitted in the same
transaction, through its check and submit hooks, and passes automatically when the starter is its
decider. A manager-started release therefore carries `category_id` in its `propose` record.

### 2.9 `product_test_movement` and `product_release` (E)

- `menu_items` gains `release_run_id uuid` (FK `→ protocol_runs on delete set null`, not valid then
  validate) and `launched_at timestamptz`, added in two statements in the same file:
  `alter table menu_items add column if not exists launched_at timestamptz default now();` then
  `alter table menu_items alter column launched_at drop default;`. `now()` is stable, so Postgres
  stores the value once as the column's missing value: no table rewrite, no UPDATE, and neither
  `menu_items_rt` (0022:142) nor the assistant index trigger (0110:539) fires per row. **Every item
  that exists at migration time counts as launched**, switched on or off, so a sold item that is
  off today is not a draft (Q4: the one exception is a not-yet-launched draft). New items start
  with it null. Two bodies set it: `upsert_menu_item_internal` (below; the `shop_launch` apply
  switches a product on through it, §2.13) and `release_launch_internal`. So "never launched"
  always means "never on sale", which the new-item guard below and the price lock (§2.13) read.
- `app.upsert_variant_internal(p_item_id uuid, p_name_en text, p_name_ar text, p_price_iqd bigint, p_id uuid, p_is_default boolean, p_sort_order int) returns uuid`:
  the 0013:203-254 body without its guard. Internal. That is the latest body: the function is
  defined once, by 0013, under either `create` spelling; 0145's `upsert_retail_variant` only calls
  it (0145:201).
- `app.upsert_variant` (same signature, same guard), re-issued here as a wrapper: after the guard,
  when the item's `release_run_id` run is not `live` or `done` and the call changes a stored
  `price_iqd` or adds a size (`p_id is null`), raise `ITEM_IN_RELEASE` **for every caller, the
  owner included**: an item in release takes its prices from the price step only, so nobody can
  change an approved price in the menu editor before launch (Q12). Then
  `return app.upsert_variant_internal(…)`. A name, default or order change is never refused. The
  manager price lock (`PRICE_VIA_PROTOCOL`) is **not** here: `price_promo` adds it with the
  protocol (§2.13), so managers are never locked out before the price change protocol exists.
- `app.upsert_menu_item_internal(p_category_id uuid, p_name_en text, p_name_ar text, p_id uuid, p_description_en text, p_description_ar text, p_sort_order int, p_is_active boolean, p_hook_en text, p_hook_ar text, p_highlight text, p_serve_temp text) returns uuid`:
  the latest body, 0054:48-120 (`grep` finds 0013:154, 0027:153 and 0054:48 under
  `create or replace function`; none under `create function`), without its guard, plus
  `launched_at = coalesce(launched_at, now())` whenever the save leaves the item active. Internal.
  An insert takes `menu_items.venue_id` from the `app.current_venue()` default, which the calling
  RPC has set (§2.1).
- `app.upsert_menu_item` (same 12-argument signature, same guard and grant), re-issued as a
  wrapper, then `return app.upsert_menu_item_internal(…)`. After the guard, in this order:
  1. **In release, everyone:** `p_is_active` on an item whose `release_run_id` run is not `live` or
     `done` raises `ITEM_IN_RELEASE`.
  2. **Manager new-item guard** (#52, #53), when `app.staff_role() = 'manager'` and the call
     creates an item (`p_id is null`) or saves one with `launched_at is null` and no release run
     (a never-launched item is always switched off, so `p_is_active` on it is a switch-on). The
     kind is that of `p_category_id`'s category:
     - a new item in a `cafe` category: `ITEM_VIA_RELEASE`, switched on or off (a new menu item
       starts as "Propose a new item");
     - a switch-on in a `cafe` category, or a move from a `shop` category into a `cafe` one:
       `ITEM_VIA_RELEASE`;
     - a new or existing product in a `shop` category saved switched on: `LAUNCH_VIA_PROTOCOL`.
       Saved hidden, it passes: that is the manager's shop draft, which goes on sale through a
       `shop_launch` change (§2.13).

     A launched item (`launched_at` set) that is switched off is switched back on by a manager as
     today. **Accepted limit** (decided in round 10, plan #59): every item that exists at migration
     time counts as launched, long-retired ones included, and a rename is never refused, so a
     manager can rename an old switched-off item or shop product, change its description or
     recipe, and switch it on without product release or the owner. Its price stays the old one
     (the §2.13 size lock). `product-release.test.ts` pins the rename and switch-on,
     `price-promo.test.ts` the locked price (§8.2). No guard refuses a rename plus a switch-on in
     one call: two saves would pass it. A missing category or item falls through to
     the internal's `CATEGORY_NOT_FOUND` or `ITEM_NOT_FOUND`. The owner passes (**PROPOSAL**, the #41 reading: the decision names
     managers), so the owner's editor still creates and switches on items directly.

  The guard arrives with `product_release`, so between that commit and `price_promo` (local stack
  only; both reach hosted in the same migrations push) a manager's hidden shop product goes on sale
  only through the owner.
- `v_variance_report` (0019:205): `create or replace view … with (security_invoker = on)`
  appending `product_test_qty` as the last column (sum of `product_test` movements, positive).
- `app.report_stock` (0068): re-issued verbatim with `'productTestQty'` added to the `variance`
  object (0068:1080-1096).
- `app.release_readiness_internal(p_run_id uuid) returns jsonb` (internal, no guard): the readiness
  body. The public `release_readiness` is its MGMT-guarded wrapper. Every caller without a staff
  session (the cron path, §2.10) and every hook uses the internal.
- Hooks:
  - `protocol_start_product_release`: `data` must be `{}`.
  - `protocol_check_product_release_{propose,test,analysis,marketing,launch}` per §2.8. `propose`
    requires `category_id` when the submitter decides the step. `launch` also requires
    `release_readiness_internal(run).ready` (`RELEASE_NOT_READY`, hint = failing keys) for both
    `now` and `date`, and the `menu_photo_path` rule of §2.8 for `now`.
  - `protocol_pass_product_release_propose`: validates `category_id` from `p_decision_data` (the
    decider's dialog, or the record on an automatic pass); creates the draft through
    `upsert_menu_item_internal` (inactive, names from the record; a missing language copies the
    other), because the public wrapper refuses a manager's new cafe item (#52) and the decider is
    usually a manager; then one `upsert_variant_internal` per size at price 0; sets `release_run_id`; inserts `recipe_lines`
    for every line with an `ingredient_id`, on every size (**PROPOSAL**; the manager tunes sizes in
    Stock ▸ Recipes); stores `run.menu_item_id`. Audit `protocol.release.accept`.
  - `protocol_submit_product_release_test`: for each `{variant_id, count}`, consumes
    `recipe qty / (yield_percent / 100) × count` of every line through
    `app.consume_fefo(…, 'product_test', null, null, auth.uid(), null, 'run:<run_id>')`.
    Audit `stock.product_test`. A withdrawn or sent-back test keeps its consumption (the stock was
    used); round 2 consumes again.
  - `protocol_pass_product_release_analysis`: writes the prices through `upsert_variant_internal`
    (the public path refuses an item in release) and the final names through
    `upsert_menu_item_internal` (the item stays inactive).
  - `protocol_pass_product_release_launch`: `now` → `app.release_launch_internal(run, menu_photo_path)`;
    `date` → `scheduled_for = at`.
  - `protocol_finish_product_release`: `'live'` after a launch now, `'scheduled'` for a date.
  - `protocol_stop_product_release`: deletes the draft item when `launched_at is null` (children
    cascade; `run.menu_item_id` goes null by FK).
- `app.release_launch_internal(p_run_id uuid, p_menu_photo_path text)` (internal): sets the item's
  `photo_path` (the `set_item_photo` rule, 0027:228), `is_active = true`, `launched_at = now()`;
  run → `live`, `live_at = now()`; notifies the starter `run_live`. Audit `protocol.release.launch`.

| RPC | Args | Returns | Guard | Errors |
|---|---|---|---|---|
| `release_readiness` | `p_run_id uuid` | `{ready, checks: [{key: 'names'\|'prices'\|'photo'\|'recipe'\|'category', ok}], warnings: [{key: 'allergens'\|'serve_temp'}]}` (from `release_readiness_internal`) | MGMT at venue | `PROTOCOL_NOT_FOUND` |
| `release_cost` | `p_run_id uuid` | `{sizes: [{variant_id, name_en, name_ar, cost_iqd, cost_known}], unknown_lines: [label]}` (`cost_known = false` when a line has no batch and no pack cost, or is free text) | MGMT at venue | `PROTOCOL_NOT_FOUND` |
| `release_test_context` | `p_run_id uuid` | `{sizes: [{variant_id, name_en, name_ar, lines: [{ingredient_id, name_en, name_ar, qty, unit}]}]}` (no cost) | the test step's assignee, or MGMT | `PROTOCOL_NOT_FOUND`, `NOT_STEP_ACTOR` |

### 2.10 `release_post_launch` (E)

```
release_reviews  run_id uuid pk → protocol_runs on delete cascade, venue_id uuid not null → venues,
                 menu_item_id uuid → menu_items on delete set null, numbers jsonb not null,
                 write_up jsonb,                       -- {en, ar}
                 status text not null check (status in ('written','thin','fallback','failed')),
                 model text, created_at timestamptz not null default now(), written_at timestamptz
release_notes    id uuid pk, venue_id uuid not null → venues, menu_item_id uuid not null → menu_items on delete cascade,
                 run_id uuid → protocol_runs on delete set null, author_id uuid not null → staff,
                 body text not null check (length(btrim(body)) between 1 and 2000),
                 created_at timestamptz not null default now()
Indexes: release_notes (menu_item_id, created_at). RLS: MGMT at venue, both.
```

- The note window of an item: `release_run_id is not null` and
  `launched_at <= now() < launched_at + interval '30 days'`. Notes may record what customers said
  (Q9); the UI asks for no names or phone numbers.

| RPC | Args | Returns | Guard | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `release_notes_for_me` | `p_venue_id uuid default null` | `{items: [{menu_item_id, name_en, name_ar, launched_at, window_ends_at, run_id, notes, my_notes}]}` (items in their window) | ANY at venue | `FORBIDDEN` | – | – |
| `release_notes_for_item` | `p_menu_item_id uuid` | `{item: {id, name_en, name_ar, window_ends_at, open}, notes: [{id, author_name, body, created_at, mine}]}` | ANY at the item's venue | `ITEM_NOT_FOUND` | – | – |
| `add_release_note` | `p_menu_item_id uuid, p_body text, p_idempotency_key text default null` | `{id}` | ANY at the item's venue | `ITEM_NOT_FOUND`, `NOTE_WINDOW_CLOSED`, `TEXT_REQUIRED`, `TEXT_TOO_LONG` | yes | – (**PROPOSAL**) |
| `release_review` | `p_run_id uuid` | `{status, numbers, write_up, model, written_at}` or null | MGMT at venue only (#54): the starter, and every other role, gets `FORBIDDEN` | `PROTOCOL_NOT_FOUND`, `FORBIDDEN` | – | – |

Service-role only: `app.release_due_launches(p_limit int default 10) → [{run_id, venue_id, menu_item_id, photo_path}]`;
`app.release_launch_scheduled(p_run_id uuid, p_menu_photo_path text) → text` (re-checks through
`release_readiness_internal`, never the guarded `release_readiness`; `'launched'`, or
`'reverted'`: run → active, launch step reopened `round + 1`, owners notified `launch_not_ready`);
`app.release_due_reviews(p_limit int default 5) → [{run_id, venue_id}]` (live, `live_at + 30 days <= now()`, no `written` review);
`app.release_review_input(p_run_id uuid) → {numbers, notes: [text], marketing_take: [text]}`
(`marketing_take`: the bodies of `marketing_notes` whose subject is the run's item or the run,
text only, no author names; numbers from its own query
over the rows the `report_cafe` item rows (0096) read, and `v_item_margin`:
`{units, revenue_iqd, margin_iqd, margin_pct, category_share_pct, days_sold, bought_with: [{item_id, name_en, name_ar, count}], from, to}`.
It never calls `app.report_cafe`, whose `app.reports_guard(false)` (0096:370, 0068:70-80) raises
`FORBIDDEN` for the edge function's service client, and it does not re-issue it. Notes as text
only, no author names. It is the LLM's input, so SEC-29 scans it by name (§1.2));
`app.release_review_save(p_run_id uuid, p_numbers jsonb, p_write_up jsonb, p_status text, p_model text)` (run → done; the owners and the run venue's managers notified `review_ready`, never a non-MGMT starter, #54; audit `protocol.release.review`);
`app.protocol_photo_purge_due(p_limit int default 20) → [{run_id, paths}]` (stopped or withdrawn runs, `finished_at + 90 days <= now()`, `photos_purged_at is null`, any kind);
`app.protocol_photos_purged(p_run_id uuid)`; `app.protocol_tick_nudge()` and `app.release_review_nudge()` (the `push_nudge` shape, 0090:90-120).

**Only managers and owners read the review** (#54). The first version of this file let a starter
who is not MGMT read `units` and `days_sold`; that is removed. The starter sees the run move to
`done` with no figures and no write-up, and gets no `review_ready` push: a push that opens a review
they cannot read would be a dead end, so it is dropped rather than sent without numbers
(**PROPOSAL** on the push). `release_reviews` keeps its MGMT-only select policy. Staff item notes
(`release_notes`) are unchanged: every role still writes them in the window, and they feed the
review, with marketing's take on the item or run (`marketing_notes`, C's `marketing_staff`, which
`release_post_launch` therefore commits after, §2.2). `release-review.test.ts` calls
`release_launch_scheduled` and `release_review_input` as `service_role` and expects no
`FORBIDDEN`, and asserts that `notes` and `marketing_take` carry no author name.

**Scope of #54.** It is enforced on every protocol and review read: `release_review`, the run
shapes (§2.7) and `/tasks`. On its own it would not be a data wall around the item's sales: the
bar and kitchen roles read `orders` and `order_items` directly for the kitchen board
(0157:36-61), `order_items` has no venue conjunct, and 0015:1338 grants the whole table, so
`unit_price_iqd`, `line_total_iqd` and `cost_iqd` are exposed to a head role's session, on the
phone the person's own (plan #10, #27). Round 10 closes that read in this work (plan #60): lane
K's `kitchen_money_reads` takes the bar and kitchen family and prep off those policies and adds
the venue conjunct, and the board reads through the money-free `kitchen_board` (§2.23).

### 2.11 `event_court_blocks` and `event_block_run_index` (F)

- `reservations` gains `block_purpose text` (check `block_purpose is null or block_purpose = 'event'`)
  and `protocol_run_id uuid → protocol_runs` (both constraints not valid then validate). No
  backfill. "Maintenance" now means `kind = 'maintenance' and block_purpose is distinct from 'event'`.
- `event_block_run_index` (own file, waiver):
  `create index if not exists reservations_protocol_run_idx on reservations (protocol_run_id) where protocol_run_id is not null;`
- `app.analytics_open_minutes` (0097:236-305): subtract only non-event maintenance; dropped by its
  exact signature `(timestamptz, timestamptz, text, int, uuid)`, recreated with an extra
  `event_minutes int` column, re-granted to `service_role` only. It has **three** callers, all
  re-issued verbatim with `event_minutes` / `eventMinutes` carried into their output (Q5, kept in
  round 9 as #55):
  `app.analytics_courts_summary` and `app.analytics_courts_cafe` (0147:543, 0147:1098) and
  `app.report_courts` (0097:1299, call at 0097:1355), whose per-court rows and totals gain the
  events figure so `/reports/courts` shows an Events line beside available minutes. Without the
  re-issue `report_courts` (plpgsql) would survive the drop and silently count tournament hours as
  open capacity with nothing to explain them. `tests/analytics-courts.test.ts:387` only asserts
  that clients are refused the helper and needs no change; `event-court-blocks.test.ts` covers
  the three outputs.

| RPC | Args | Returns | Guard | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `block_courts_for_event` | `p_run_id uuid, p_blocks jsonb` (`[{court_id, start_at, end_at}]`, 1–60)`, p_idempotency_key text default null` | `{blocked: [{reservation_id, court_id, start_at, end_at}], conflicts: [{court_id, start_at, end_at, reservation_id, kind, status}]}`; with any conflict nothing is written and `blocked` is empty | court_desk + MGMT at the run's venue; the run is a tournament and its `courts` step is open | `PROTOCOL_NOT_FOUND`, `STEP_NOT_OPEN`, `COURT_NOT_FOUND`, `BLOCK_RANGE_INVALID`, `SLOT_TAKEN` (a race past the check) | yes | `reservation.event_block` |
| `tournament_context` | `p_run_step_id uuid` | `{name_en, name_ar, class, format, capacity, ranges: [{court_ids, court_names: [{en, ar}], from, to}], blocked: [{reservation_id, court_id, start_at, end_at}]}` from the run's `data` (the plan record) and its event blocks; no fee, prize, budget, sponsor or income | the actors of that step (tournament `courts` or `marketing`) who may act on it, or MGMT at venue | `PROTOCOL_NOT_FOUND`, `NOT_STEP_ACTOR` | – | – |
| `tournament_feasibility` | `p_run_id uuid` | `{ranges: [{court_id, court_name_en, court_name_ar, from, to, bookings, guests}]}` | MGMT at venue | `PROTOCOL_NOT_FOUND` | – | – |

Blocks take every `app.lock_court` in court-id order first, are written as `kind = 'maintenance'`,
`block_purpose = 'event'`, `protocol_run_id`, `notes` = the tournament's EN name (older desks
render notes), and a desk moves conflicts through the normal move and cancel path. Hooks:
`protocol_start_tournament` (`data` `{}`), `protocol_check_tournament_*` per §2.8 (the `plan`
check holds the variant rules and raises `SPONSOR_DETAILS_REQUIRED` for type3),
`protocol_pass_tournament_plan` (run `data` := the plan record), `protocol_stop_tournament`
(cancels the run's future event blocks). The court desk (`courts`) and marketing (`marketing`) read
what they need through `tournament_context`, on both apps (§5.5, §6.1).

### 2.12 `hiring` (F)

```
hiring_candidates  id uuid pk, venue_id uuid not null → venues, run_id uuid not null → protocol_runs on delete cascade,
                   candidate_name text not null (1..80), candidate_phone text not null (≤ 32),
                   brief text not null default '' (≤ 1000), interview_at timestamptz,
                   picked boolean not null default false, pick_reason text (≤ 1000),
                   created_by uuid not null → staff, created_at timestamptz not null default now(),
                   decided_at timestamptz, purge_after timestamptz
unique (run_id) where picked; index (purge_after) where purge_after is not null. RLS: MGMT at venue.
```

| RPC | Args | Returns | Guard | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `hiring_candidates` | `p_run_id uuid` | `{candidates: [{id, candidate_name, candidate_phone, brief, interview_at, picked, pick_reason}], purged: boolean}` | MGMT at venue | `PROTOCOL_NOT_FOUND` | – | – |
| `save_hiring_candidate` | `p_run_id uuid, p_candidate jsonb` (`{candidate_name, candidate_phone, brief?, interview_at?, picked?, pick_reason?}`)`, p_id uuid default null, p_idempotency_key text default null` | `{id}` | MGMT at venue; the `interviews` step open | `STEP_NOT_OPEN`, `CANDIDATE_NOT_FOUND`, `RECORD_INVALID`, `TEXT_TOO_LONG` | yes | `protocol.hiring.candidate_save` (ids only) |
| `delete_hiring_candidate` | `p_id uuid` | void | same | `CANDIDATE_NOT_FOUND`, `STEP_NOT_OPEN` | – | `protocol.hiring.candidate_delete` |

- Hooks: `protocol_start_hiring` (`data` `{}`); `protocol_check_hiring_{open_position,interviews,add_staff}`;
  `add_staff` check: the staff row is active, created after the run started, its role equals the
  open position's role (`HIRE_ROLE_MISMATCH`), never prep (`ROLE_RETIRED`).
  `protocol_pass_hiring_interviews`: `decided_at = now(), purge_after = now() + interval '90 days'`
  on every candidate of the run. `protocol_pass_hiring_add_staff`: corrects the new staff member's
  `staff_venues` row to the run's venue; audit `protocol.hiring.complete`.
  `protocol_stop_hiring`: sets `purge_after` where still null.
- `app.hiring_purge_due()` (cron): deletes candidates with `purge_after <= now()` and, on that
  run, overwrites every free text a decider could have typed a name into with the fixed marker
  `'[deleted after 90 days]'`: `decision_note` of its submissions, `skip_note` of its steps and
  its `stop_reason`, where not null. It never writes NULL: the §2.6 reason CHECKs would refuse a
  `send_back` or `stop` row and roll the whole purge back. It also removes the `note` key from the
  records of the run's owner-added steps. The UI shows `work.protocol.noteDeleted` for the marker.
  Audit `protocol.hiring.purge` (counts only).
- No assistant index trigger and no `app.assistant_readable_columns` rows (§1.5; `hiring.test.ts`
  asserts none). Coverage: `"hiring_candidates": "excluded: candidate personal data, deleted 90 days after the decision"`.
  SEC-29 `FORBIDDEN` gains `candidate_name`, `candidate_phone` as a tripwire only: no function the
  scanner reads touches candidates. No candidate name or phone in any push, audit payload or step
  record.

### 2.13 `price_promo` (F)

**Every writer of a list price, a discount or a court price** (checked 2026-09-24 by grep over
every migration, under both `create function` and `create or replace function`), and what
`price_promo` does to it (#41, #51, #57):

| Price | Written only by | Latest body | In `price_promo` |
|---|---|---|---|
| `menu_item_variants.price_iqd` (menu sizes and shop sizes) | `app.upsert_variant` (writes at 0013:234, 0013:245) | 0013:203 (defined once); `product_release`'s wrapper after E commits (§2.9) | re-issued from `product_release`'s wrapper body with the size lock below |
| the same column, from Stock ▸ Products | `app.upsert_retail_variant`, which calls the **public** `upsert_variant` as the same caller (0145:201) | 0145:132 (defined once) | **not re-issued**: the lock reaches it through that call. `price-promo.test.ts` pins it, so a later re-issue that calls `upsert_variant_internal` instead cannot drop the lock unnoticed |
| `modifiers.price_delta_iqd` (add-ons) | `app.upsert_modifier` (writes at 0013:323, 0013:334) | 0013:298 (defined once; `reorder_modifiers`, 0050:170, writes `sort_order` only) | split into `upsert_modifier_internal` and a wrapper with the add-on lock below |
| `promotions` (every column: value, scope, dates, limits, switch, code) | `app.upsert_promotion` (0067:428, :449), `app.set_promotion_enabled` (0067:507), `app.generate_promo_code` (0067:560) | 0067:258, 0067:484, 0067:525 (each defined once) | the first two split into internals and wrappers, the third re-issued; the promotion lock below (#57) |
| `rate_rules` and `rate_rule_prices` (court prices) | `app.upsert_rate_rule` (0071:223-246) | 0071:153 (after 0013:452 and 0048:135) | split into `upsert_rate_rule_internal` and a wrapper with the rate lock below (#57) |
| `cafe_settings` `featured_discount_pct`, the `featured_item_id` it applies to, and `hero_mode`, which puts it live only at `featured` (0095:135, :169) | `app.set_cafe_setting` (0029:312), also reached through `app.set_cafe_settings` (0050:242), which calls the public `set_cafe_setting` per key | 0029:280 (defined once); `set_cafe_settings` 0050:242 (defined once) | `set_cafe_setting` split into `set_cafe_setting_internal` and a wrapper with the featured-discount lock below, `hero_mode` included (#57); `set_cafe_settings` **not re-issued**: the lock reaches it through its call, which `price-promo.test.ts` pins |

Not list prices, unchanged: `order_item_modifiers.price_delta_iqd` and the till's order lines are
copies taken when an order is sent, and `override_price` and `apply_discount` change one sale
under a manager PIN. `reservations.price_iqd` is taken from the rate rule when a booking is made;
the desk's per-booking override, `staff_create_reservation`'s `p_price_override_iqd` (0147:68,
:132-143), sets one booking's court price with no rule, manager or owner only, audited
`reservation.price_override` (0147:182-183), and `move_reservation` keeps it (0150:130-133). It
stays as it is, like the till's overrides (**PROPOSAL**, plan §11 Q8). `eligible_promotions` and
`apply_best_promotion` (0067) read promotions at the till, and `price_slot` (latest 0139:155) reads
rate rules; none writes them. Promotions discount goods only, never the court fee (0067). The
featured-item discount is 0 to 99 % off the featured item's unit price **while the hero is in
Featured mode**: `add_order_items` applies it only when `hero_mode = 'featured'` (0095:135, :141,
:169), and the guest menu uses the same test (`apps/web/src/lib/menu.ts:259-265`,
`featuredDiscountPct`). `hero_mode` is a manager key of its own (0105:164) that the hero builder
saves as a separate changed key (`HeroBuilder.tsx:120`), so switching the hero to Featured is what
puts a stored percentage live. **Global
targets:** `promotions` has no `venue_id` and `cafe_settings` is keyed by setting alone, so those
changes apply at every venue, whichever venue's run carries them; slice 2 owns scoping both
(`PHASE-2-PLAN.md:56, 257`). Rate rules carry `venue_id` and are checked against the run's venue.

- **Draft exception, for list prices only:** a target that was never launched (`launched_at is
  null`) and is switched off. Promotions, rates and the discount have none: the run carries the
  whole change. The owner passes every lock (the decisions name managers), apart from
  `ITEM_IN_RELEASE` (§2.9). Every lock reads `app.staff_role() = 'manager'`.
- `app.upsert_promotion_internal(<the 0067:259-275 arguments>) returns uuid` and
  `app.set_promotion_enabled_internal(p_id uuid, p_enabled boolean) returns jsonb`: the 0067 bodies
  without their guards, internal. The public `upsert_promotion` and `set_promotion_enabled` are
  re-issued as wrappers with their guards, signatures and grants unchanged.
- **The promotion lock** (#57). After each guard, for a manager:
  - `upsert_promotion`: `PRICE_VIA_PROTOCOL` on every call, a new promotion or an edit, whatever
    `p_enabled` says (a new one is a `promotion` run, an edit a `promotion_edit` run);
  - `set_promotion_enabled`: `PRICE_VIA_PROTOCOL` when `p_enabled` is true and the promotion is
    off (a `promotion_enable` run). Switching one off passes (**PROPOSAL**, plan §11 Q8), and so
    does the existing `duplicate` no-op;
  - `generate_promo_code` (re-issued from 0067:525 with the check after its guard; nothing internal
    calls it): `PRICE_VIA_PROTOCOL`. A code decides who can redeem a promotion that is not
    automatic, so it travels in the run's record (**PROPOSAL**, plan §11 Q8).
- **The rate lock** (#57). `app.upsert_rate_rule_internal(<the 0071:153-165 arguments>) returns
  uuid`: the 0071 body without its guard, internal; an insert takes `rate_rules.venue_id` from the
  `app.current_venue()` default, which the apply has set (§2.1). `app.upsert_rate_rule` (same
  signature, guard and grant) re-issued as a wrapper: for a manager, `PRICE_VIA_PROTOCOL` on every
  call, a new rule, an edit or a switch-off, since each changes which price a slot gets
  (**PROPOSAL**: no draft exception); then `return app.upsert_rate_rule_internal(…)`.
- **The featured-discount lock** (#57). `app.set_cafe_setting_internal(p_key text, p_value jsonb)
  returns jsonb`: the 0029:280 body without its guard and per-key role check (spec lookup and
  `UNKNOWN_SETTING`, validate, upsert, audit `settings.cafe`), internal. `app.set_cafe_setting` (same signature, guard and grant) re-issued as
  a wrapper: guard, `UNKNOWN_SETTING`, the per-key `min_role` check as today, then for a manager:
  - `featured_discount_pct` whose new value differs from the stored one (`app.cafe_setting`) and
    is not 0: `PRICE_VIA_PROTOCOL`. Setting it to 0 switches the discount off and passes
    (**PROPOSAL**, plan §11 Q8);
  - `featured_item_id` whose new value differs from the stored one while the stored
    `featured_discount_pct` is above 0: `PRICE_VIA_PROTOCOL`, because the discount follows the
    featured item (**PROPOSAL**, plan §11 Q8);
  - `hero_mode` changing **to** `featured` (the stored value is not `featured`) while the stored
    `featured_discount_pct` is above 0: `PRICE_VIA_PROTOCOL`, because Featured mode is what puts
    the stored percentage on the till and the guest menu (0095:169), the same act as a
    promotion's switch-on. Moving `hero_mode` away from `featured` takes the discount away and
    passes (**PROPOSAL**, plan §11 Q8), and so does any move between `none` and `media`;

  then `return app.set_cafe_setting_internal(…)`. Every other key is unchanged. `set_cafe_settings`
  applies keys in sorted order (`featured_discount_pct` < `featured_item_id` < `hero_mode`), so a
  manager's one-call `{featured_discount_pct: 0, featured_item_id: <new>}` and `{featured_discount_pct:
  0, hero_mode: 'featured'}` pass (the discount is off before the item moves or the mode turns
  on). The operator's hero builder sends only changed keys, `hero_mode` last (`diffHero`,
  `HeroBuilder.tsx:89-121`), so a manager saving labels, badges, ticker, hero media or a mode other
  than Featured is never refused, and §5.5 turns the Featured tile off for a manager while a
  discount is stored and the saved mode is not Featured. **Not the registry:** re-issuing `cafe_setting_specs`
  (0105:158) with the key owner-only would refuse a manager with a bare `FORBIDDEN`, would also
  refuse switching the discount off, and cannot see a featured-item move or a mode change, so the
  registry stays as 0105 left it.
- **The size lock.** `app.upsert_variant` re-issued once more, from `product_release`'s wrapper
  body (§2.9): after the guard and the in-release check, when `app.staff_role() = 'manager'`, the
  item is not a draft (`item.launched_at is not null or item.is_active`) and the call adds a size
  (`p_id is null`) or changes the stored `price_iqd` of that size, raise `PRICE_VIA_PROTOCOL`; then
  `return app.upsert_variant_internal(…)`. **Any category kind**: the first version's shop exception
  is gone (#51), so a launched shop product is locked in Stock ▸ Products too, through
  `upsert_retail_variant`. A size that does not exist falls through to the internal's
  `VARIANT_NOT_FOUND`. A name, default or order change is never refused, so a manager still edits a
  launched product's SKU, barcode, supplier, pack cost and low-stock level while its price stays the
  same. A new size on a launched item counts as a price change. The lock lives here, not in
  `product_release`, so it arrives with the protocol that replaces direct editing.
- **`modifiers.launched_at timestamptz`**, the §2.9 drill: `add column if not exists launched_at
  timestamptz default now()`, then `alter column launched_at drop default`. Every add-on that
  exists at migration time counts as launched, switched on or off, with no rewrite and no UPDATE.
  New add-ons start with it null.
- `app.upsert_modifier_internal(p_group_id uuid, p_name_en text, p_name_ar text, p_id uuid, p_price_delta_iqd bigint, p_sort_order int, p_is_active boolean) returns uuid`:
  the 0013:298-344 body without its guard, plus `launched_at = coalesce(launched_at, now())`
  whenever the save leaves the add-on active. Internal.
- **The add-on lock.** `app.upsert_modifier` (same signature `(uuid, text, text, uuid, bigint, int, boolean)`,
  same guard and grant), re-issued as a wrapper, then `return app.upsert_modifier_internal(…)`. For
  a manager:
  - a launched add-on whose `price_delta_iqd` changes: `PRICE_VIA_PROTOCOL`;
  - a new paid add-on (`p_price_delta_iqd > 0`) saved switched on, or a never-launched paid add-on
    switched on: `LAUNCH_VIA_PROTOCOL` (#53). Saved hidden, it passes; it goes on sale through an
    `addon_price` change. `p_is_active` defaults to `true`, so the Add-ons editor passes
    `p_is_active: false` for a manager's new paid add-on (§5.5);
  - a never-launched hidden add-on's price may be edited (the draft exception);
  - a free option (`p_price_delta_iqd = 0`, for example "no ice") may be added or switched on
    (**PROPOSAL**): it carries no price, and the internal stamps it launched, so giving it a price
    later is a price change;
  - renaming, moving to another group, reordering and switching a launched add-on off and on are
    unchanged. A missing group or add-on falls through to `GROUP_NOT_FOUND` or
    `MODIFIER_NOT_FOUND`;
  - the §2.9 accepted limit applies here too (decided, plan #59): every add-on that exists at
    migration time counts as launched, so a manager can rename an old switched-off paid add-on and
    switch it on at its old price, which `price-promo.test.ts` pins as unchanged.
- **When each lock arrives.** The size, add-on, promotion, rate and featured-discount locks arrive
  here, with the protocol, so managers are never locked out of pricing before it exists. The menu-item and shop-product launch
  guard arrived with `product_release` (§2.9). Both reach hosted in the same migrations push.
- **Lock tests that break today** (F updates them in `price_promo`'s commit): `promotions.test.ts`
  creates promotions as the manager (`mk`, :80), so its helper moves to the owner and the manager
  case becomes a lock case in `price-promo.test.ts`; `booking-integrity.test.ts` and
  `booking-hardening.test.ts` already save rate rules as the owner; `cafe-menu-ext.test.ts:391-430`
  sets the discount as the owner; the `rls-matrix.ts` rows keep `manager: 'execute'`, because each
  lock raises past the guard, and only their notes change (§1.2).
- `app.price_promo_check_targets(p_run_id uuid) returns void` (internal): reads the passed
  `propose` submission (the targets) and the passed `numbers` submission (the figures) and raises
  `PRICE_TARGET_CHANGED`, hint = the failing target (`item`, `size:<variant_id>`, `sizes`,
  `addon:<modifier_id>`, `promotion`, `rule`, `featured`), when:
  - any kind: a target no longer exists (the item, each approved size, each add-on, the promotion,
    the rule);
  - `price`: the item is no longer launched, or is in release;
  - `shop_launch`: the product is switched on or has `launched_at` set, or its sizes are no longer
    exactly the approved ones, so a size added after the owner's approval never goes on sale;
  - `promotion`: the record's code is no longer free;
  - `promotion_edit`, `promotion_enable`: the promotion's `updated_at` differs from the record's
    `base_updated_at` (anyone wrote it since the proposal, a manager's switch-off included), or,
    for an edit, the record's code is no longer free; `promotion_enable`: it is already on;
  - `rate`: for an edit, the rule row or its prices differ from the record's `before`;
  - `featured_discount`: the stored `featured_item_id`, `featured_discount_pct` or `hero_mode`
    differs from the record's `before`, or the item to feature is no longer active.
- Hooks: `protocol_start_price_promo`: `data` `{}`. `protocol_check_price_promo_propose`: the eight
  shapes of §2.8 and the target's state at submit (a `price` item launched and not in release; a
  `shop_launch` product in a `shop` category, never launched, switched off; each add-on at the run's
  venue; a promotion that exists, and is off for `promotion_enable`; a rule and a court at the run's
  venue; an active item to feature), and it writes the `base_updated_at` and `before` snapshots
  into the normalised record; marketing's `shop_launch` raises `NOT_STEP_ACTOR`. A target-state
  failure at propose raises `RECORD_INVALID` with hint `menu_item_id` (a `price` item not launched
  or in release, a `shop_launch` product already launched, switched on or not in a `shop`
  category, a featured item that is off), `prices`, `addons` (an add-on at another venue),
  `promotion_id`, `rule_id`, `promotion.<field>` or `rule.<field>`, never a menu, promotion or rate
  writer's code: marketing reaches this hook on the phone through `start_protocol`, and those codes
  are operator only or belong to other screens (§3).
  `protocol_check_price_promo_numbers`:
  exactly the proposal's targets. `protocol_check_price_promo_apply`: `{when, at?}`, then
  `price_promo_check_targets`, for `now` and `date` alike.
  `protocol_submit_price_promo_propose`, on every round: `price` and `shop_launch` store
  `run.menu_item_id`; `addon_price` keeps its add-on ids in the record; `promotion` saves the draft
  disabled through `upsert_promotion_internal(… p_enabled => false)` the first time (marketing may
  start one), updates that same draft on a resubmission, and stores `run.promotion_id`;
  `promotion_edit` and `promotion_enable` store `run.promotion_id` and write nothing to the
  promotion; `rate` and `featured_discount` keep their targets in the record and write nothing.
  `protocol_pass_price_promo_apply`: `now` → `app.price_promo_apply_internal(run)`; `date` →
  `scheduled_for`. `protocol_finish_price_promo` → `'done'` or `'scheduled'`.
  `protocol_stop_price_promo`: the disabled promotion stays disabled; a `shop_launch` product and a
  never-launched add-on stay hidden; the other kinds wrote nothing before apply, so nothing is
  undone.
- `app.price_promo_apply_internal(p_run_id uuid)` (internal): sets `app.venue_id` to the run's
  venue (§2.1), runs `price_promo_check_targets`, then writes the approved figures (the `numbers`
  step's final figures, else the proposal's) by kind. The manager may not use the public paths on
  anything launched, and the cron has no session, so every write goes through an internal:
  - `price`: each size through `upsert_variant_internal` with its stored name, default and order and
    the new price; each new size the same way (`p_id` null, not default, after the last size). A
    new size's recipe is added in Stock ▸ Recipes, as for any new size;
  - `shop_launch`: each size's price the same way; then `upsert_menu_item_internal` with the
    product's stored fields and `p_is_active => true`, which stamps `launched_at`;
  - `addon_price`: each add-on through `upsert_modifier_internal` with its stored fields and the new
    difference. A never-launched add-on is switched on (the internal stamps it); a launched one keeps
    its switch as it is;
  - `promotion`: `upsert_promotion_internal` (final value and dates), then
    `set_promotion_enabled_internal(true)`;
  - `promotion_edit`: `upsert_promotion_internal(p_id => promotion_id, …)` with the approved fields
    and final value, and `p_enabled` = the promotion's current switch, so an edit never switches a
    promotion on or off;
  - `promotion_enable`: `set_promotion_enabled_internal(promotion_id, true)`;
  - `rate`: `upsert_rate_rule_internal` with the approved rule and the final prices
    (`rule_prices`, else the proposal's), `p_id` = `rule_id` or null for a new rule; the internal
    replaces the rule's prices wholesale, as today, and writes its own `rates.rule.create` or
    `rates.rule.update` audit;
  - `featured_discount`: `set_cafe_setting_internal` for `featured_item_id` (when it changes), for
    `featured_discount_pct` (the final figure) and, when that figure is above 0 and the stored
    `hero_mode` is not `featured`, last for `hero_mode = 'featured'`, so the approved discount is
    the one that goes live (the hero then shows the featured item); all in the apply's one
    transaction, each writing its own `settings.cafe` audit.

  Run → done. Audit `protocol.price.apply` (payload `{run_id, change, counts}`) for `price`,
  `shop_launch`, `addon_price`, `rate` and `featured_discount`; `protocol.promo.apply` for
  `promotion`, `promotion_edit` and `promotion_enable`.
- `app.price_promo_apply_due()` (cron): takes each due scheduled run, one at a time, in its own
  `begin … exception` block, so one bad run never fails the statement, and calls
  `price_promo_apply_internal` with a null actor, which runs the same target check. A run that
  fails goes back to `active`, the `apply` step reopens with `round + 1`, and the venue's managers
  get `staff_task / apply_not_ready` (§2.21), the same shape as a reverted launch (§2.10).

| RPC | Args | Returns | Guard | Errors |
|---|---|---|---|---|
| `price_promo_targets` (**PROPOSAL** shape; the plan names it only) | `p_change text, p_venue_id uuid default null` | `price`: `{items: [{menu_item_id, name_en, name_ar, category_kind, is_active, sizes: [{variant_id, name_en, name_ar, price_iqd}]}]}`, launched items not in release, cafe and shop; `shop_launch`: the same shape, hidden never-launched shop products; `addon_price`: `{addons: [{modifier_id, group_id, group_name_en, group_name_ar, name_en, name_ar, price_delta_iqd, is_active, launched}]}`, launched add-ons, plus hidden never-launched ones for MGMT; `promotion_edit` and `promotion_enable`: `{promotions: [{promotion_id, name_en, name_ar, type, value, starts_at, ends_at, weekdays, hour_from, hour_to, scope, limits, auto, public_code, code_single_use, enabled, updated_at}]}` (every promotion for an edit, switched-off ones for a switch-on; the columns any staff session already reads, 0156:718-722, and no redemption count); `rate`: `{rules: [{rule_id, name, court_id, court_name_en, court_name_ar, days_of_week, start_time, end_time, priority, valid_from, valid_to, is_active, prices: {"<duration_min>": price_iqd}}]}`, the venue's rules on or off; `featured_discount`: `{featured_item_id, featured_discount_pct, hero_mode, items: [{menu_item_id, name_en, name_ar, category_kind, sizes: [{variant_id, name_en, name_ar, price_iqd}]}]}`, active items at the venue. List prices, rules and discounts only, which staff (and mostly guests) already see: no cost, no sales | manager, marketing, owner at venue; `shop_launch` MGMT only | `FORBIDDEN`, `INVALID_ARGUMENT` (`p_change` not one of `price`, `shop_launch`, `addon_price`, `promotion_edit`, `promotion_enable`, `rate`, `featured_discount`) |
| `price_promo_numbers` | `p_run_id uuid` | `{change, sizes: [{variant_id` (null for a new size)`, name_en, name_ar, current_price_iqd` (null for a new size)`, new_price_iqd, cost_iqd, cost_known, margin_before_iqd, margin_after_iqd, units_30d, revenue_30d_iqd}], addons: [{modifier_id, group_name_en, group_name_ar, name_en, name_ar, current_delta_iqd, new_delta_iqd, count_30d, revenue_30d_iqd}], promotion: {current_value, new_value, discount_cost_30d_iqd, units_30d, revenue_30d_iqd} \| null, rate: {durations: [{duration_min, current_price_iqd` (null for a new rule or duration)`, new_price_iqd}], bookings_30d, revenue_30d_iqd} \| null, featured: {current_item_id, new_item_id, current_pct, new_pct, current_hero_mode, sizes: [{variant_id, name_en, name_ar, price_iqd}], units_30d, discount_cost_30d_iqd} \| null}`. Cost from `v_item_cogs` (a shop size's is its retail stock row's batch or pack cost, so `cost_known` works the same); an add-on has no cost row. Units, counts and revenue are 0 for a new size, a hidden product and a never-launched add-on. A promotion's discount cost is the approved value applied to the last 30 days' matching lines (the `promotion` kind's figure, for all three promotion kinds). A rule's bookings and revenue are the last 30 days' reservations whose `rate_rule_id` is that rule (none for a new rule). The featured figures use the new item's last 30 days of units; `current_hero_mode` lets the form say that the discount is not live today and that applying one above 0 switches the hero to Featured | MGMT at venue | `PROTOCOL_NOT_FOUND` |

### 2.14 `checklists` (C)

```
checklist_templates       id uuid pk, venue_id uuid not null → venues, role staff_role not null,
                          slot text not null check (slot in ('open','close')), name_en text not null, name_ar text not null,
                          version int not null default 1, updated_by uuid → staff, updated_at timestamptz not null default now(),
                          unique (venue_id, role, slot)
checklist_template_items  id uuid pk, template_id uuid not null → checklist_templates on delete cascade,
                          position int not null, text_en text not null, text_ar text not null,
                          unique (template_id, position) deferrable initially deferred
checklist_runs            id uuid pk, venue_id uuid not null → venues, template_id uuid not null → checklist_templates,
                          role staff_role not null, slot text not null, business_date date not null,
                          created_at timestamptz not null default now(), unique (template_id, business_date)
checklist_run_items       id uuid pk, run_id uuid not null → checklist_runs on delete cascade, position int not null,
                          text_en text not null, text_ar text not null, done_by uuid → staff, done_at timestamptz,
                          note text (≤ 300), check ((done_by is null) = (done_at is null))
RLS: MGMT at venue (children by exists). Index checklist_run_items (run_id).
```

- A day's run snapshots the template items on first read (**PROPOSAL**: replaces the plan's
  `checklist_marks`, so an owner edit mid-day cannot orphan ticks).
- `app.venue_business_date(p_venue uuid, p_at timestamptz default now()) returns date` (internal):
  `app.business_date(p_at, venues.timezone, coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4))`.
  Never the one-argument 0034 form. Slice 2 owns moving the start hour per venue.
- No seeded templates: each role shows "No list yet" until the owner writes one.

| RPC | Args | Returns | Guard | Errors | Audit |
|---|---|---|---|---|---|
| `my_checklists_today` | `p_venue_id uuid default null` | `{business_date, lists: [{run_id, role, slot, name_en, name_ar, done, total, items: [{id, position, text_en, text_ar, done_by_name, done_at, note}]}]}` (the caller's role; creates today's runs) | ANY at venue | `FORBIDDEN` | – |
| `mark_checklist_item` | `p_item_id uuid, p_done boolean, p_note text default null` | the item | holders of the run's role at its venue, or MGMT | `CHECKLIST_NOT_FOUND`, `FORBIDDEN`, `TEXT_TOO_LONG` | – (row keeps who and when) |
| `checklist_board` | `p_venue_id uuid default null, p_business_date date default null` | `{business_date, templates: [{template_id, role, slot, name_en, name_ar, version, items: [{position, text_en, text_ar}], today: {run_id, done, total, items: [{text_en, text_ar, done_by_name, done_at, note}]} \| null}]}` | MGMT at venue | `FORBIDDEN` | – |
| `save_checklist_template` | `p_venue_id uuid, p_role staff_role, p_slot text, p_expected_version int, p_name_en text, p_name_ar text, p_items jsonb` (`[{text_en, text_ar}]`, max 30) | `{template_id, version}` | owner | `INVALID_ROLE` (prep), `INVALID_ARGUMENT` (slot), `TEMPLATE_CHANGED`, `LIST_TOO_LONG`, `TEXT_BOTH_LANGUAGES_REQUIRED` | `checklist.template.save` |
| `checklist_day_state` | `p_venue_id uuid default null, p_business_date date default null` | `{business_date, lists: [{role, slot, name_en, name_ar, total, done, open_items: [{text_en, text_ar}]}]}` (templates with items, roles someone holds) | MGMT at venue | `FORBIDDEN` | – |

No per-person history and no report that ranks people (SOW:265, :480).

### 2.15 `shopping_purchases` (C)

```
shopping_items  id uuid pk, venue_id uuid not null → venues, ingredient_id uuid → ingredients,
                label text (≤ 80), check (ingredient_id is not null or coalesce(length(btrim(label)),0) > 0),
                qty numeric(12,3) not null check (qty > 0), unit text not null check (unit in ('g','ml','pc','pack')),
                note text (≤ 200), requested_by uuid not null → staff, requested_at timestamptz not null default now(),
                status text not null default 'open' check (status in ('open','bought','cancelled','received','acknowledged')),
                purchase_id uuid → purchases, cancelled_by uuid → staff, cancelled_at timestamptz
purchases       id uuid pk, venue_id uuid not null → venues, staff_id uuid not null → staff,
                bought_at timestamptz not null, shop_name text (≤ 80), total_iqd iqd not null,
                receipt_path text, status text not null default 'to_receive' check (status in ('to_receive','done')),
                delivery_id uuid → deliveries, received_by uuid → staff, received_at timestamptz,
                created_at timestamptz not null default now()
purchase_lines  id uuid pk, purchase_id uuid not null → purchases on delete cascade,
                shopping_item_id uuid → shopping_items, ingredient_id uuid → ingredients, label text,
                qty numeric(12,3) not null check (qty > 0),         -- base unit when ingredient_id is set
                price_iqd iqd not null,
                status text not null default 'to_receive' check (status in ('to_receive','received','acknowledged'))
                -- no delivery_line_id: the link is purchases.delivery_id (receive_purchase below)
Indexes: shopping_items (venue_id) where status = 'open'; purchases (venue_id, status); purchase_lines (purchase_id).
RLS: MGMT at venue on all three; purchases also own rows (staff_id = auth.uid()); lines by exists on purchases.
```

| RPC | Args | Returns | Guard | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `shopping_list` | `p_venue_id uuid default null, p_status text default 'open'` | `{items: [{id, ingredient_id, name_en, name_ar, label, qty, unit, note, requested_by_name, requested_at, status, mine}], open_count}` | BAR_KITCHEN, driver, MGMT at venue | `FORBIDDEN`, `INVALID_ARGUMENT` | – | – |
| `add_shopping_item` | `p_venue_id uuid, p_ingredient_id uuid, p_label text, p_qty numeric, p_unit text, p_note text default null, p_idempotency_key text default null` | `{id}` | HEADS + MGMT at venue | `INGREDIENT_NOT_FOUND`, `SHOPPING_LABEL_REQUIRED`, `INVALID_QTY`, `INVALID_ARGUMENT` (unit), `TEXT_TOO_LONG` | yes | `shopping.add` |
| `cancel_shopping_item` | `p_id uuid` | void | the requester, or MGMT | `SHOPPING_ITEM_NOT_OPEN`, `FORBIDDEN` | – | `shopping.cancel` |
| `record_purchase` | `p_venue_id uuid, p_lines jsonb` (`[{shopping_item_id?, ingredient_id?, label?, qty, price_iqd}]`, 1–40)`, p_total_iqd bigint, p_shop text, p_receipt_path text, p_bought_at timestamptz default now(), p_idempotency_key text default null` | `{purchase_id}` | driver + MGMT at venue | `SHOPPING_ITEM_NOT_OPEN`, `INVALID_QTY`, `INVALID_AMOUNT`, `PHOTO_PATH_INVALID` (folder `receipts`), `TEXT_TOO_LONG` | yes | `purchase.record` |
| `my_purchases` | `p_venue_id uuid default null, p_limit int default 30` | `{purchases: [{id, bought_at, shop_name, total_iqd, status, lines: [{label, name_en, name_ar, qty, unit, price_iqd, status}]}]}` (driver: own; MGMT: all) | driver + MGMT | `FORBIDDEN` | – | – |
| `purchases_to_receive` | `p_venue_id uuid default null` | `{count, purchases: [{id, staff_name, bought_at, shop_name, total_iqd, receipt_path, lines: [{id, ingredient_id, ingredient_active, name_en, name_ar, unit, pack_size, label, qty, price_iqd, status}]}]}` (`ingredient_active`: null on a label line, false on a stock line whose ingredient was switched off since) | MGMT at venue | `FORBIDDEN` | – | – |
| `receive_purchase` | `p_purchase_id uuid, p_lines jsonb` (`[{purchase_line_id, qty_received, expiry_date?}]`)`, p_supplier_id uuid default null, p_supplier_name text default null, p_idempotency_key text default null` | `{delivery_id, received_line_ids}` | MGMT at venue | `PURCHASE_NOT_FOUND`, `PURCHASE_ALREADY_RECEIVED`, `INVALID_ARGUMENT` (a non-stock line), `INGREDIENT_NOT_FOUND` (hint `lines`, detail the line id: a stock line still to receive whose ingredient was switched off), `receive_delivery`'s codes | yes | `purchase.receive` |
| `acknowledge_purchase_line` | `p_line_id uuid` | void | MGMT at venue | `PURCHASE_NOT_FOUND`, `PURCHASE_ALREADY_RECEIVED`, `INVALID_ARGUMENT` (a stock line of an active ingredient) | – | `purchase.acknowledge` |

- `record_purchase` marks the lines' shopping items `bought`, notifies managers
  `purchase_to_receive`, never touches the till, the drawer or day close.
- `add_shopping_item` notifies the venue's drivers `shopping_new` with dedupe `shopping:<venue_id>`.
- `receive_purchase` locks the purchase row, refuses a received line, calls the public
  `app.receive_delivery` (0145:242) with `p_idempotency_key => null` (the outer claim covers it) and
  lines `{ingredient_id, qty_expected: line.qty, qty_received, unit_cost_iqd: price_iqd / qty, expiry_date}`
  (a cost per base unit, 0017:108), sets `purchases.delivery_id` to the returned `delivery_id`,
  marks the received lines `received`, and sets the purchase `done` when no line is `to_receive`.
  One transaction. `p_lines` names every stock line still `to_receive` (else `INVALID_ARGUMENT`,
  hint `lines`; a short line is `qty_received` below the bought quantity), so one purchase makes
  exactly one delivery. The link is at purchase level on purpose: `receive_delivery` returns only
  `{delivery_id, batch_ids}` (0145:333) and `delivery_lines` has no ordering column and no
  reference back (0017:103-111), so two purchase lines of the same ingredient could not be matched
  to their delivery lines.
- A stock line whose ingredient is switched off after the purchase cannot be booked
  (`receive_delivery` takes active ingredients only, 0145:295). `receive_purchase` refuses the
  whole purchase with `INGREDIENT_NOT_FOUND` (hint `lines`, detail the line) before it books
  anything, and `acknowledge_purchase_line` closes that line as it closes a label line; then the
  rest is received. Goods in (I) offers Acknowledge on a line with `ingredient_active = false`
  (review 2026-09-25).

### 2.16 `staff_production` (C)

- `app.record_production_internal(p_ingredient_id uuid, p_qty numeric, p_expiry_date date, p_device_id text) returns jsonb`:
  the 0018:342-399 body without its guard, internal.
- `app.record_production` (same signature `(uuid, numeric, date, text)`, same MGMT guard) calls it.

| RPC | Args | Returns | Guard | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `production_today` | `p_venue_id uuid default null` | `{items: [{ingredient_id, name_en, name_ar, unit, on_hand, par_level, below_par, made_today, shelf_life_days}]}` (active prepared ingredients with an output recipe; no cost) | CHEFS + MGMT at venue | `FORBIDDEN` | – | – |
| `record_batch` | `p_ingredient_id uuid, p_qty numeric, p_expiry_date date default null, p_venue_id uuid default null, p_idempotency_key text default null` | `{batch_id, qty, expiry_date}` (never `unit_cost_iqd`) | CHEFS + MGMT at venue | `INVALID_QTY`, `NOT_PREPARED`, `NO_RECIPE`, `INGREDIENT_NOT_FOUND` | yes | `stock.record_production` (from the body) |
| `production_log_today` | `p_venue_id uuid default null` | `{rows: [{movement_id, ingredient_id, name_en, name_ar, qty, unit, staff_name, at}]}` (`production_in` today) | CHEFS + MGMT at venue | `FORBIDDEN` | – | – |

Bar batches (syrups) are not in v1 (**PROPOSAL**; the decision names chef production).

### 2.17 `marketing_staff` (C)

- `marketing_campaigns` gains `suggested_by uuid → staff`, `suggested_at timestamptz`,
  `images text[] not null default '{}'`, `protocol_run_id uuid → protocol_runs on delete set null`,
  `menu_item_id uuid → menu_items on delete set null`, `suggestion_note text` (FKs not valid then
  validate). No new policy: marketing reads through RPCs.
- Names and channel (settled, 0073:74-76): `name_en`, `name_ar` and `channel` are NOT NULL, with
  no non-blank CHECK. So `suggest_campaign` raises `TEXT_REQUIRED` (hint `name`) when both names
  are blank, copies the typed name into the missing language column, and raises `BAD_CHANNEL` on a
  NULL channel or one outside `enum_range(null::marketing_channel)` before the insert. No draft
  reaches the table to fail with an unmapped 23502 or 22P02.
- A suggested draft is editable by its suggester while `status = 'draft' and updated_at = suggested_at`
  (the owner's `save_marketing_campaign` bumps `updated_at`, 0073), else `CAMPAIGN_DRAFT_LOCKED`
  (the owner has picked it up; the existing `CAMPAIGN_LOCKED` says "already gone out", which is not
  true of a saved draft).
  `marketing_overview` is **not** re-issued (slice 2 owns its venue filter); the owner panel joins
  `marketing_suggestions` by id (**PROPOSAL**).

```
marketing_notes  id uuid pk, venue_id uuid not null → venues, subject_kind text not null check (subject_kind in ('item','run','campaign')),
                 subject_id uuid not null, author_id uuid not null → staff,
                 body text not null (1..2000), photos text[] not null default '{}' (≤ 6),
                 created_at timestamptz not null default now()
Index (venue_id, subject_kind, subject_id). RLS: MGMT at venue.
```

| RPC | Args | Returns | Guard | Errors | Key | Audit |
|---|---|---|---|---|---|---|
| `suggest_campaign` | `p_id uuid default null, p_venue_id uuid default null, p_name_en text default null, p_name_ar text default null, p_channel text default null, p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_body_en text default '', p_body_ar text default '', p_images text[] default '{}', p_run_id uuid default null, p_menu_item_id uuid default null, p_note text default null, p_idempotency_key text default null` | `{id}` | marketing at venue | `TEXT_REQUIRED` (name), `BAD_CHANNEL`, `INVALID_RANGE`, `CAMPAIGN_DRAFT_LOCKED`, `CAMPAIGN_NOT_FOUND`, `PHOTO_PATH_INVALID` (folder `campaigns`), `REF_NOT_FOUND` | yes (new drafts) | `marketing.campaign.suggest` |
| `my_campaign_drafts` | `p_venue_id uuid default null` | `{drafts: [{id, name_en, name_ar, channel, status, starts_at, ends_at, images, run_id, menu_item_id, suggested_at, editable}]}` | marketing | `FORBIDDEN` | – | – |
| `marketing_suggestions` | `p_venue_id uuid default null` | `{drafts: [{campaign_id, suggested_by, suggested_by_name, suggested_at, images, run_id, menu_item_id, suggestion_note}]}` | owner | `FORBIDDEN` | – | – |
| `add_marketing_note` | `p_venue_id uuid default null, p_subject_kind text, p_subject_id uuid, p_body text, p_photos text[] default '{}', p_idempotency_key text default null` | `{id}` | marketing at venue | `REF_NOT_FOUND`, `INVALID_ARGUMENT`, `TEXT_REQUIRED`, `TEXT_TOO_LONG`, `PHOTO_PATH_INVALID` (folder `marketing`) | yes | `marketing.note.add` |
| `marketing_notes_for` | `p_subject_kind text, p_subject_id uuid` | `{notes: [{id, author_name, body, photos, created_at}]}` | MGMT + marketing at the subject's venue | `REF_NOT_FOUND` | – | – |
| `my_marketing_notes` | `p_venue_id uuid default null, p_limit int default 50` | `{notes: [{id, subject_kind, subject_id, subject_name_en, subject_name_ar, body, photos, created_at}]}` | marketing | `FORBIDDEN` | – | – |

`set_campaign_status` and `save_marketing_campaign` stay owner-only (0073). Marketing gets no
campaign performance, revenue, tab or order read.

### 2.18 Re-issued objects: one owner each

Each object below has one owning lane, with one exception: `upsert_variant`. E creates
`upsert_variant_internal` and the wrapper in `product_release`; F re-issues the wrapper once in
`price_promo` from E's committed body; neither lane touches it again.

| Object | Latest body today | Lane | Change |
|---|---|---|---|
| `notification_outbox` kind CHECK | 0075:45-60 | G | four staff kinds |
| `app.set_staff_active` | 0081:67 | G | clear the push token on deactivate |
| `app.claim_staff_media` | 0159 (G) | A (`protocols_engine_rpcs`) | re-claim from an earlier round of the same run step (§2.3) |
| policy `staff_media_read` on `storage.objects` | 0159 (G) | A (`protocols_engine_rpcs`) | `bucket_id = 'staff-media' and app.staff_media_visible(name)`, dropped and created in one guarded block (§2.3) |
| `app.submit_staff_request`, `app.decide_staff_request` | 0072 | G | one notify each |
| `app.upsert_variant` | 0013:203 | E, then F | E: `upsert_variant_internal` + wrapper with `ITEM_IN_RELEASE`; F (`price_promo`), from E's wrapper body: + `PRICE_VIA_PROTOCOL` for a manager on any launched item, shop included (§2.13) |
| `app.upsert_menu_item` | 0054:48 | E | `upsert_menu_item_internal` (with the `launched_at` stamp) + wrapper with `ITEM_IN_RELEASE` and the manager new-item guard (`ITEM_VIA_RELEASE`, `LAUNCH_VIA_PROTOCOL`, §2.9) |
| `app.upsert_modifier` | 0013:298 | F | `upsert_modifier_internal` (with the `launched_at` stamp) + wrapper with the add-on lock (`PRICE_VIA_PROTOCOL`, `LAUNCH_VIA_PROTOCOL`, §2.13) |
| `v_variance_report` | 0019:205 | E | `product_test_qty` last |
| `app.report_stock` | 0068 | E | `productTestQty` |
| `app.record_production` | 0018:342 | C | wrapper |
| `app.upsert_promotion`, `app.set_promotion_enabled` | 0067:258, 0067:484 | F | internals + wrappers with the manager promotion lock (#57, §2.13) |
| `app.generate_promo_code` | 0067:525 | F | the manager refusal after its guard (#57, §2.13) |
| `app.upsert_rate_rule` | 0071:153 | F | `upsert_rate_rule_internal` + wrapper with the manager rate lock (#57, §2.13) |
| `app.set_cafe_setting` | 0029:280 | F | `set_cafe_setting_internal` + wrapper with the manager featured-discount lock (#57, §2.13) |
| `app.analytics_open_minutes` | 0097:236 | F | event minutes; drop and recreate |
| `app.analytics_courts_summary`, `app.analytics_courts_cafe` | 0147 | F | carry `event_minutes` |
| `app.report_courts` | 0097:1299 | F | carry `event_minutes` (the courts report's Events line) |
| policies `tabs_staff_read`, `orders_staff_read`, `order_items_staff_read`, `order_item_modifiers_staff_read` | 0157:36-61 | K | without the bar and kitchen family and prep; venue conjunct on the last two (#60, §2.23) |

"Latest body today" was checked on 2026-09-24 with `grep -n -E "(create|create or replace) function app\.<name>\(" supabase/migrations/*.sql | tail -1`;
check it again at commit (§2.1).

Not re-issued here, on purpose: `marketing_overview`, `save_marketing_campaign`,
`set_campaign_status`, `receive_delivery`, `consume_fefo`, `staff_create_reservation`,
`staff_requests_page`, `upsert_retail_variant` (0145:132: the size lock reaches it through its call
to the public `upsert_variant`, §2.13), `reorder_modifiers` (0050:170, `sort_order` only),
`set_item_sold_out` and `set_item_availability` (they never change `is_active`), `set_cafe_settings`
(0050:242: the featured-discount lock reaches it through its call to the public
`set_cafe_setting`), `cafe_setting_specs` (0105:158: the registry keeps `featured_discount_pct` and
`hero_mode` manager keys; the lock is in the setter, §2.13), `eligible_promotions`, `apply_best_promotion` and
`price_slot` (readers only), `tickets_staff_read` and the `kds` realtime policy (no money column;
the kitchen list keeps prep, §2.23). If slice 2 needs any object in the first table, whoever
commits second rebases onto the other's body. The likely ones are `upsert_rate_rule` and
`set_cafe_setting` (slice 2's venue axis and `platform_settings` split, `PHASE-2-PLAN.md:56`) and
the four order-side policies (0136 left the leaf tables' venue axis to slice 2).

### 2.19 Cron jobs

All in the guarded pg_cron DO block shape (0021; `cron.schedule` upserts by name). Names follow the
existing `tp_` convention and replace the plan's names.

| Job | Schedule | Command | Lane |
|---|---|---|---|
| `tp_protocol_tick` | `*/5 * * * *` | `select app.protocol_tick_nudge();` → `protocol-action {action:'tick'}` | E |
| `tp_release_review` | `20 4 * * *` | `select app.release_review_nudge();` → `release-review {action:'tick'}` | E |
| `tp_price_promo_apply` | `*/5 * * * *` | `select app.price_promo_apply_due();` | F |
| `tp_hiring_purge` | `40 3 * * *` | `select app.hiring_purge_due();` | F |

### 2.20 Edge functions (E)

`protocol-action` (`verify_jwt = true`):
- `POST {action:'launch', run_step_id, when:'now'|'date', at?, photo_path, idempotency_key}`, owner
  session (`requireStaffRole(req, service, ['owner'])`). For `now`: copy `photo_path` from
  `staff-media` to `menu-media/items/<menu_item_id>/<run_id>.<ext>` (a retry overwrites the same
  object; `storage.copy` with `destinationBucket`, **UNVERIFIED** on hosted; fallback download plus
  upload), then call `app.submit_step` **with the caller's JWT** and the record
  `{when, at, photo_path, menu_photo_path}`, where `menu_photo_path` is
  `items/<menu_item_id>/<run_id>.<ext>`, the only value the launch check accepts (§2.8). For
  `date`: submit without copying. Returns the
  `submit_step` result.
- `POST {action:'tick'}`, service role (`isServiceRoleRequest`): due launches
  (`release_due_launches` → copy → `release_launch_scheduled`), then photo purges
  (`protocol_photo_purge_due` → storage remove → `protocol_photos_purged`). Returns
  `{launched, reverted, purged}`.
- Errors: SQL codes pass through `mapPgError` (`_shared/http.ts:76`) as `{error: '<CODE>', message}`
  with its status; the operator reads `EdgeError.detail`, the phone the body's `error`.

`release-review` (`verify_jwt = true`, service role only): `POST {action:'tick'}` →
`release_due_reviews`; per run `app.llm_begin_request()`, `release_review_input`, the model from
`select llm_default_model from venue_settings where venue_id = <run venue>` (venue-qualified;
`_shared/assistant/provider.ts` `vendorFor`), one call returning `{en, ar}`; the number gate and
template fallback of `analytics-insights` (`_shared/insightsGate.ts`, `insightsFallback.ts`);
`app.llm_record_usage(model, input, cache_write, cache_read, output, 1, 'release_review')`;
`release_review_save`. Below `MIN_ITEM_UNITS` the status is `thin` and the text says there is not
enough data yet. A campaign-effect claim only when the launch campaign carries a promotion.

Deno cannot import `packages/core`; shared shapes go under `_shared/` as JSON or byte-identical
copies with a test.

### 2.21 Push catalogue (G owns `send-push`; every lane sends through `app.notify_staff`)

The one list is `packages/db/supabase/functions/_shared/staff-push.json`
`{kinds: [...], title_keys: [...], routes: [...]}`. `send-push` imports it; a db test compares it
with the lists inside `app.notify_staff`; the phone's `pushRoutes.ts` test compares `routes`.

| Event | kind | title_key | To | route, id |
|---|---|---|---|---|
| A step opens | `staff_task` | `step_open` | assignee, else holders of its actor roles at the venue | `staff-step`, run step |
| A submission needs a decision | `staff_decide` | `step_submitted` | owners if `needs_owner_ok`; else the venue's managers, or the owners when `app.staff_ids_with_roles(venue, '{manager}')` is empty (the owner decides OK-off steps too, §2.7) | `staff-step`, run step |
| Decision on my submission or run | `staff_decided` | `step_approved`, `step_sent_back`, `step_stopped` | submitter and starter | `staff-step`, run step |
| Run stopped by `stop_protocol` | `staff_decided` | `run_stopped` | starter, actors of open steps | `staff-run`, run |
| Release launched | `staff_info` | `run_live` | starter | `staff-run`, run |
| Scheduled launch not ready | `staff_task` | `launch_not_ready` | owners | `staff-step`, launch step |
| Scheduled apply not ready | `staff_task` | `apply_not_ready` | managers | `staff-step`, apply step |
| Day-30 review written | `staff_info` | `review_ready` | owners and the run venue's managers; never a non-MGMT starter, who cannot read the review (#54, §2.10) | `staff-run`, run |
| Staff request submitted / decided | `staff_decide` / `staff_decided` | `request_submitted` (dedupe `request:<requester>`, 15 min: a submit, withdraw, submit loop buzzes each owner once) / `request_approved`, `request_rejected` | owners / requester | `staff-request`, request |
| New shopping items | `staff_task` | `shopping_new` (dedupe `shopping:<venue>`, 15 min) | drivers at the venue | `staff-shopping`, – |
| Purchase recorded | `staff_task` | `purchase_to_receive` | managers at the venue | `staff`, – |

- Payload `{route, id, title_key, params: {step?: {en, ar}, title?: text, name?: text}}`. `title` is
  the run title, omitted for hiring runs; `name` is the requester's display name for
  `request_submitted`.
- `send-push`: the `STRINGS` type (`index.ts:48`) is split: booking kinds keep `(court, when)`,
  staff kinds read `STAFF_STRINGS[lang][title_key] = {title, body(params)}` from a pure sibling
  `send-push/staffStrings.ts` (vitest-importable). An unknown `title_key` is terminal
  (`UNKNOWN_TITLE_KEY:<key>`, attempts capped). Expo `data` = `{kind, route, id}`. Language from
  `profiles.preferred_lang`.
- EN copy (AR written by G, parity tested): `step_open` "New task" / "{step}: {title}";
  `step_submitted` "Waiting on you" / "{step}: {title}"; `step_approved` "Approved" / "{step}: {title}";
  `step_sent_back` "Sent back for changes" / "{step}: {title}"; `step_stopped` and `run_stopped`
  "Stopped" / "{title}"; `run_live` "Launched" / "{title} is on the menu."; `launch_not_ready`
  "Launch postponed" / "{title} was not ready on the date. Open it to fix and launch again.";
  `apply_not_ready` "Change postponed" / "{title} could not be applied on the date.";
  `review_ready` "30-day review ready" / "{title}"; `request_submitted` "Staff request" /
  "{name} sent a request."; `request_approved` "Request approved"; `request_rejected`
  "Request declined"; `shopping_new` "Shopping list" / "New items to buy."; `purchase_to_receive`
  "Purchase to receive" / "Receive it in Stock ▸ Goods in on the operator." When `{title}` is
  absent the body is `{step}` alone.
- No iOS icon badge in v1 (**PROPOSAL**): the badges are the in-app counts.

### 2.22 Audit actions (the exact strings; D adds them to `ACTION_KEYS`)

`protocol.start`, `protocol.submit`, `protocol.auto`, `protocol.withdraw`, `protocol.withdraw_run`,
`protocol.decide`, `protocol.skip`, `protocol.stop`, `protocol.unschedule`,
`protocol.run.edit_items`, `protocol.run.add_step`, `protocol.template.save`,
`protocol.release.accept`, `protocol.release.launch`, `protocol.release.review`,
`protocol.price.apply` (`price`, `shop_launch`, `addon_price`, `rate`, `featured_discount`),
`protocol.promo.apply` (`promotion`, `promotion_edit`, `promotion_enable`), `protocol.hiring.candidate_save`,
`protocol.hiring.candidate_delete`, `protocol.hiring.complete`, `protocol.hiring.purge`,
`stock.product_test`, `checklist.template.save`, `shopping.add`, `shopping.cancel`,
`purchase.record`, `purchase.receive`, `purchase.acknowledge`, `marketing.campaign.suggest`,
`marketing.note.add`, `reservation.event_block`. New `FAMILY_KEYS`: `protocol`, `checklist`,
`shopping`, `purchase`. Entities: `protocol_run`, `protocol_template`, `checklist_template`,
`shopping_item`, `purchase`, `marketing_campaigns`, `marketing_note`, `reservations`,
`ingredients`.

### 2.23 `kitchen_board_read` and `kitchen_money_reads` (K, plan #60)

**What the board reads today** (`op/features/kds/ticketView.ts:57-101`: `TicketRow` :57-88,
`TICKET_SELECT` :90-101; queried by `KdsBoard.tsx:44-57` as a direct select on `tickets`): `tickets` (`id, status, target_seconds,
created_at, completed_at, last_actor_label`), its `orders` row (`id, source, status`), the tab
(`id, label`, `cafe_tables.table_number`, and the booking's `id, guest_name`), and the order lines
(`id, qty, notes, voided, ready_at`, the item's and size's `name_en, name_ar`, each add-on's `qty`
and `name_en, name_ar`). It never shows a price, but the embedded select runs under the order-side
policies, which is why the bar and kitchen roles hold them. The booking embed returns null for the
bar and kitchen family and prep today (`reservations` is readable only by court_desk, cashier and
MGMT, 0136:211-230), so their board already shows a court tab by its label.

Other paths, unchanged by K: the LAN board (`LanBoard.tsx`, `apps/operator-shell/src/main/lan-kds-*`,
`lan-frames.ts`) gets tickets as frames from the till and names from the shell's cached menu, with no
database read; its bumps replay through the till's queue as `set_ticket_status`. The `kds` broadcast
(0022 `rt_ticket`, 0061 `rt_order_item_ready`) carries ids and statuses only and stays under its
realtime policy (0156, BOARD). `set_ticket_status` and `set_order_item_ready` are definers. The
phone's staff area never reads the board (§6.7).

**`kitchen_board_read`** (no dependency):

| RPC | Args | Returns | Guard | Errors |
|---|---|---|---|---|
| `kitchen_board` | `p_venue_id uuid default null` (no window argument) | `{tickets: [TicketRow]}`, each row in exactly the `TICKET_SELECT` shape (same keys and nesting: `order`, `tab`, `table`, `reservation`, `order_items`, `menu_item`, `variant`, `order_item_modifiers`, `modifier`), so `ticketView.ts` and `TicketList` are unchanged; the venue's tickets with status `queued`, `preparing` or `ready`, or `completed` at or after `now() - interval '2 minutes'`, hard-coded (the board's own linger, `COMPLETED_LINGER_MS`, `KdsBoard.tsx:28`), ordered by `created_at`. No caller can widen the window: BOARD passes on a bar or kitchen phone (§6.7), so a window argument would let a head role's personal session read every completed ticket's lines and count any item's sales, which #54 and #60 close. `reservation` is filled only for the roles whose own policy reads that booking today (cashier, manager, owner) and is null for the bar and kitchen family and prep, so every role sees what it sees now. **No money anywhere**: no `unit_price_iqd`, `line_total_iqd`, `cost_iqd`, `price_delta_iqd`, tab or order total, and no other column | BOARD (`app.is_staff(<BOARD>)`). A venue named must pass `app.is_staff_at(<venue>, <BOARD>)` and is the only venue read. None named (the board's call) reads every venue in `app.staff_venue_ids()`, the `tickets_staff_read` axis (0156:788), and never resolves through `app.current_venue()`: with a second venue active that raises `VENUE_REQUIRED` for the owner (no `staff_venues` rows) and for anyone with two memberships. `stable` | `FORBIDDEN` |

`comment on` the function; `rpc-allowlist.json` and a matrix row (BOARD execute, court_desk,
guest and anon denied); coverage `map:action`. `kitchen-board.test.ts` asserts the payload has no
key ending in `_iqd` or starting with `cost` at any depth.

What remains is what the board itself shows: a session that calls `kitchen_board` more often than
every two minutes sees each ticket while it is live, as anyone standing at the board does.

**The board commit** (K, after `kitchen_board_read`): `KdsBoard.tsx`'s `ticketsQ` calls
`appRpc('kitchen_board', {p_venue_id})` instead of `supabase.from('tickets')` (no window: the
server fixes it; the client-side linger filter, `KdsBoard.tsx:142-150`, stays),
keeping its query key `['tickets']`, its 30 s refetch, the `kds` invalidation and both
mutations; `TICKET_SELECT` is removed (or kept only as the test fixture's shape). `KdsBoard.test.tsx`
mocks the RPC. The `/kds` sentence in `pages.md` names `app.kitchen_board` (§5.6).

**`kitchen_money_reads`** (after `kitchen_board_read`, the board commit and G's `send-push` commit,
§1.1): the four order-side read policies re-issued from 0157:36-61, each `drop policy if exists` +
`create policy`:

```
tabs_staff_read                  app.is_staff('cashier','court_desk','manager','owner')
                                 and venue_id = any(app.staff_venue_ids())
orders_staff_read                (the same)
order_items_staff_read           app.is_staff('cashier','court_desk','manager','owner')
                                 and exists (select 1 from orders o
                                              where o.id = order_items.order_id
                                                and o.venue_id = any(app.staff_venue_ids()))
order_item_modifiers_staff_read  app.is_staff('cashier','court_desk','manager','owner')
                                 and exists (select 1 from order_items oi
                                              join orders o on o.id = oi.order_id
                                              where oi.id = order_item_modifiers.order_item_id
                                                and o.venue_id = any(app.staff_venue_ids()))
```

- The role list is the pre-0156 five without prep: the till, the desk and MGMT read tabs and lines
  exactly as they do today. head_barista, barista, head_chef, chef and prep lose all four; their
  only reader was the board, which now reads through `kitchen_board`.
- The venue conjunct on the two leaf tables is an inline `exists` on the parent, not a definer
  helper, for the reason 0106 and 0136 give: every policy on a table is planned for every caller.
  For these four roles the nested `orders` policy is a pass-through.
- The guests' own-session policies (`*_guest_read`, 0015:1349-1372) and `tickets_staff_read` are
  untouched, and so are the grants (0015:1338): the policies are the wall.
- Header: the feature, this section, the dependency, and that no index or constraint is added.

**Tests** (`kitchen-board.test.ts`, K; plus K's edits to `new-roles.test.ts` and `rls-matrix.ts`):
- `kitchen_board` returns a probe ticket with its lines, add-ons, notes and ready marks to each of
  head_barista, barista, head_chef, chef, prep, cashier, manager and owner; refuses driver,
  marketing and court_desk with `FORBIDDEN`; returns no ticket of another venue to a staff member
  of one venue; carries no money key; fills `reservation` for cashier and MGMT only; returns a
  ticket completed a minute ago and none completed three minutes or a week ago, and a call that
  names `p_completed_since` (a week ago) matches no signature (`PGRST202` through PostgREST), so
  no caller can widen the window.
- After `kitchen_money_reads`: the bar and kitchen family and prep read zero rows of `tabs`,
  `orders`, `order_items` and `order_item_modifiers` (the `new-roles.test.ts` 0157 case, whose
  "station" list shrinks to cashier); cashier, court_desk, manager and owner still read them; a
  staff member of venue A reads no `order_items` or `order_item_modifiers` row of an order at
  venue B; `set_ticket_status` and `set_order_item_ready` still work for every BOARD role; the
  guest cafe suites (own-session reads) pass unchanged; `rls-matrix.ts` `tabs`, `orders` and
  `order_items` rows lose `prep: 'rows'`.
- Operator: `KdsBoard.test.tsx` (the RPC is called with the venue only, and the board renders the
  same cards); the visual check on `/kds` against the local stack as a kitchen
  login (§8.1); `lan-kds.test.ts` unchanged and passing.

---

## 3. Error codes

Lane 0 lands every key and every mapping below in one commit, before any migration that raises
them (mapping early is harmless; the rule is "never later").

- **Strings:** one EN and one AR string per code at `op.errors.<CODE>`, in the new pair
  `packages/i18n/src/catalogs/opErrors.protocols.{en,ar}.ts`, spread at the end of `op.errors` in
  `en.ts` / `ar.ts` (`...opErrorsProtocolsEn` / `...opErrorsProtocolsAr`; the AR file is typed
  `DeepMessages<typeof opErrorsProtocolsEn>`). **PROPOSAL:** the phone points at the same
  `op.errors.<CODE>` keys, so a message is written once. No file under `apps/mobile` reads an
  `op.*` key today; the phone reads `op.errors.*` and `op.roles.*` for the first time, which is
  allowed because `CODE_TO_KEY` is typed `satisfies Record<string, MessageKey>` over the assembled
  catalog. The wording therefore names no app ("on the operator" never appears in an error).
- **One meaning per code.** A new raiser never borrows an existing code whose string was written
  for another screen: `LABEL_REQUIRED` ("A counter sale needs…"), `CAMPAIGN_LOCKED` ("already gone
  out") and `INVALID_TIME_RANGE` ("Split a rule…") keep their screens, and the new work raises
  `SHOPPING_LABEL_REQUIRED`, `CAMPAIGN_DRAFT_LOCKED` and `BLOCK_RANGE_INVALID`. The one shared
  string that the new writes can reach through `app.claim_replay`, `IDEMPOTENCY_CONFLICT`, is
  reworded by lane 0 to name no screen: "This was already saved from another session. Refresh to
  see the latest." (AR to match).
- **Operator:** each code joins `MAPPED_CODES` (`op/lib/errors.ts:10`) in a block headed
  `// Protocols and the staff phone (build-contracts-2026-09-23).`
- **Mobile:** each code joins `CODE_TO_KEY` (`mob/src/features/booking/errors.ts:12`) with the value
  `'op.errors.<CODE>'`. Existing entries are unchanged (for example `INVALID_RANGE` stays
  `errors.validation`, `FORBIDDEN` stays `errors.forbidden`).

**New codes** (both maps):

| Code | Raised by | EN |
|---|---|---|
| `PROTOCOL_NOT_FOUND` | engine, E, F | That protocol could not be found. |
| `PROTOCOL_NOT_READY` | `start_protocol` | This kind of protocol is not available yet. |
| `PROTOCOL_CLOSED` | engine | This protocol is finished or stopped, so it cannot change. |
| `STEP_NOT_OPEN` | engine, F | This step is not open yet. |
| `STEP_CLOSED` | engine | This step is already finished. |
| `STEP_NOT_OPTIONAL` | `skip_step` | Only optional steps can be skipped. |
| `NOT_STEP_ACTOR` | engine, E | This step is for someone else. |
| `NOT_DECIDER` | engine | Someone else decides this step. |
| `SUBMISSION_DECIDED` | engine | This was already decided or withdrawn. Refresh to see the latest. |
| `SEND_BACK_TARGET_INVALID` | `decide_step` | Work can only go back to this step or an earlier finished one. |
| `RECORD_INVALID` | hooks (hint = field) | Some details are missing or not valid. Check the form and try again. |
| `TEXT_BOTH_LANGUAGES_REQUIRED` | engine, C | Fill in both English and Arabic. |
| `TEXT_REQUIRED` | engine, C, E | Write something first. |
| `TEXT_TOO_LONG` | all (hint = field) | That text is too long. |
| `TEMPLATE_CHANGED` | template saves | Someone saved this while you were editing. Reload it and make your change again. |
| `PROTOCOL_ORDER_INVALID` | template save, `add_run_step` | That order is not possible: a step has to come after the steps it depends on. |
| `PROTOCOL_STEP_FIXED` | template save (a built-in step removed, its actors or optional flag changed, or "Needs my OK" changed on an `ok_fixed` step, §2.6) | Built-in steps cannot be removed, who does them cannot change, and the price steps always need the owner's OK. |
| `LIST_TOO_LONG` | template saves, `edit_run_items` | That list is too long. |
| `INVALID_ROLE` | template saves, `add_run_step` | That role cannot be chosen here. |
| `PHOTO_PATH_INVALID` | `claim_staff_media` | A photo did not upload properly. Take or choose it again. |
| `UPLOAD_LIMIT` | `staff_media_slot` | Too many photos in a short time. Try again in a few minutes. |
| `PRICE_TARGET_CHANGED` | `price_promo`'s target check (§2.13): `submit_step` or `decide_step` of the `apply` step (its check and pass hooks), hint = the failing target (`item`, `size:<id>`, `sizes`, `addon:<id>`, `promotion`, `rule`, `featured`); the cron reverts instead of raising. Both maps: the manager's or the owner's apply step reaches it on the phone too (#38) | This change no longer matches what was approved: an item, size, add-on, promotion, court rate or the featured discount changed since. Start a new change. |
| `RELEASE_NOT_READY` | launch (hint = failing checks) | Not ready to launch: check names, prices, photo, recipe and category. |
| `NOTE_WINDOW_CLOSED` | `add_release_note` | Notes on this item closed 30 days after its launch. |
| `SPONSOR_DETAILS_REQUIRED` | tournament start | Add the sponsor or client details before starting this tournament. |
| `CANDIDATE_NOT_FOUND` | hiring | That candidate could not be found. Their details may have been deleted. |
| `HIRE_ROLE_MISMATCH` | `add_staff` check | The new account's role does not match the position. |
| `CHECKLIST_NOT_FOUND` | checklists | That checklist could not be found. |
| `SHOPPING_ITEM_NOT_OPEN` | shopping | That item is no longer on the list. |
| `PURCHASE_NOT_FOUND` | purchases | That purchase could not be found. |
| `PURCHASE_ALREADY_RECEIVED` | purchases | This purchase was already received. |
| `SHOPPING_LABEL_REQUIRED` | `add_shopping_item` | Pick an ingredient or write what to buy. |
| `CAMPAIGN_DRAFT_LOCKED` | `suggest_campaign` | The owner has picked up this draft, so it can no longer be changed here. |
| `BLOCK_RANGE_INVALID` | `block_courts_for_event` | Each block has to end after it starts. |

**New codes, operator only** (`MAPPED_CODES` and both catalogs, **not** `CODE_TO_KEY`). Only the
menu and price writers raise them: `upsert_menu_item`, `upsert_variant` (also reached through
`upsert_retail_variant`), `upsert_modifier`, and since round 10 `upsert_promotion`,
`set_promotion_enabled`, `generate_promo_code`, `upsert_rate_rule` and `set_cafe_setting` (also
reached through `set_cafe_settings`). The phone never calls any of them (§6.7 fails a staff file
that names one), and the protocol's own writes go through the `_internal` bodies, which raise none
of them. So they follow the `LABEL_REQUIRED` rule below: nothing the phone calls raises them. A
price/promo proposal whose target is in the wrong state raises `RECORD_INVALID`, never one of these
(§2.13). The operator screens that meet them are §5.5's.

| Code | Raised by | EN |
|---|---|---|
| `ITEM_IN_RELEASE` | `upsert_menu_item`, `upsert_variant` (E, `product_release`), for everyone | This item is still a new-item draft. Its prices come from its release, and it goes on sale when it is launched. |
| `PRICE_VIA_PROTOCOL` | `upsert_variant` on any launched item, cafe or shop, including through `upsert_retail_variant`; `upsert_modifier` on a launched add-on's price; `upsert_promotion` on every call, `set_promotion_enabled` switching one on, `generate_promo_code`; `upsert_rate_rule` on every call; `set_cafe_setting` (and `set_cafe_settings`) changing `featured_discount_pct` to anything but 0, `featured_item_id` while a discount is on, or `hero_mode` to `featured` while a discount is stored (F, `price_promo`, #51, #57); managers only | Prices, promotions, court rates and the featured-item discount change through a price or promotion change in Protocols. |
| `ITEM_VIA_RELEASE` | `upsert_menu_item` (E, `product_release`): a manager's new item in a cafe category, switch-on of a never-launched cafe item, or move of one into a cafe category | New menu items start as "Propose a new item", and the owner launches them. |
| `LAUNCH_VIA_PROTOCOL` | `upsert_menu_item` (E: a manager's never-launched shop product saved switched on); `upsert_modifier` (F: a manager's never-launched paid add-on saved switched on). Saved hidden, either passes | Save it hidden. It goes on sale when the owner approves its price in a price change. |

Keys for all four, like every code in this section: `op.errors.<CODE>` in
`packages/i18n/src/catalogs/opErrors.protocols.en.ts` and `.ar.ts` (AR written by lane 0, parity
typed). The operator block in `op/lib/errors.ts` lists them with the both-maps codes. Round 10
changes two EN strings above (`PRICE_VIA_PROTOCOL`, `PROTOCOL_STEP_FIXED`) and one hint list
(`PRICE_TARGET_CHANGED`); lane 0 lands the reworded EN and the matching AR in the same pair, and
adds no code: the round's refusals reuse these. `kitchen_board` raises only `FORBIDDEN`.

**Existing codes newly keyed** (a new `op.errors.<CODE>` string in the same pair; join
`MAPPED_CODES` if absent and `CODE_TO_KEY`): `NOT_PREPARED` ("Only prepared items can be made
here."), `NO_RECIPE` ("This item has no recipe yet. Ask a manager to add one."), `ROLE_RETIRED`
("Kitchen is retired. Choose barista or chef."; the Staff page keeps its screen-local
`staffRefusal`), `PROMOTION_NOT_FOUND`, `INVALID_WEEKDAYS`, `CODE_TAKEN`, `EMAIL_IN_USE` (the
`staff-admin` body code, for the phone's add-staff form).

**Existing codes the phone starts mapping** (to their existing `op.errors.*` key; operator
unchanged): `INVALID_TRANSITION`, `REASON_REQUIRED`, `CANNOT_DECIDE_OWN`, `IDEMPOTENCY_CONFLICT`
(reworded above), `VENUE_REQUIRED`, `INVALID_QTY`, `INVALID_PRICE`, `INVALID_AMOUNT`,
`INVALID_ARGUMENT`, `INVALID_VALUE`, `INGREDIENT_NOT_FOUND`, `VARIANT_NOT_FOUND`,
`CATEGORY_NOT_FOUND`, `CAMPAIGN_NOT_FOUND`, `BAD_CHANNEL`, `REQUEST_ALREADY_PENDING`,
`REQUEST_NOT_PENDING`, `REQUEST_NOT_FOUND`, `BAD_KIND`, `REF_NOT_FOUND`, `NAME_REQUIRED`;
`ITEM_NOT_FOUND` → `errors.notFound`. `LABEL_REQUIRED`, `CAMPAIGN_LOCKED` and
`INVALID_TIME_RANGE` are not mapped on the phone: nothing the phone calls raises them.

Edge failures: the operator maps `EdgeError.detail` through `MAPPED_CODES` when present
(`op/features/protocols/errors.ts`, D), else `EDGE_<code>`. The phone reads the body's `error`
through `rpcErrorCode` (`mob/src/features/staff/edge.ts`, B); `BAD_REQUEST` → `errors.validation`.

---

## 4. i18n

| Surface | Namespace | File pair | Lane |
|---|---|---|---|
| Both apps: shared work vocabulary | `work.*` (top level) | `catalogs/work.{en,ar}.ts` | 0 |
| Both apps: error messages | `op.errors.<CODE>` | `catalogs/opErrors.protocols.{en,ar}.ts` | 0 |
| Operator: Protocols page, run and step sheets, forms, decisions, How it works, `/tasks` forms | `ws.protocols.*` | `ws/protocols.*` | D |
| Operator: rail row | `ws.shell.nav.protocols` | `ws/shell.*` | D |
| Operator: audit labels | `ws.manager.audit.families.{protocol,checklist,shopping,purchase}`, `ws.manager.audit.actions.<camelCase action>` (`codeToKey`) | `ws/manager.*` | D |
| Operator: `/tasks` empty and list copy, the kitchen board's My tasks button | `ws.team.tasks.*` | `ws/team.*` | D |
| Operator: menu editor's in-release notice, price lock, "Propose a new item" and "Goes on sale when the owner launches it"; variance column | `ws.release.*` | `ws/release.*` | E |
| Operator: Stock ▸ Products and Add-ons locks ("Change the price", "Put on sale", "Saved hidden until the owner approves its price"); Promotions, Rates and the hero's discount ("Propose a promotion", "Change this promotion", "Switch on", "Change this rate", "Propose a new rate", "Change the discount", "Switch the discount off", "Moving the featured item moves its discount", the Featured mode tile's "Featured mode puts the stored discount on sale. Switch the discount off first, or change it in Protocols") | `ws.pricing.*` | `ws/pricing.*` | F |
| Operator: ledger label | `op.stock.movement.product_test` ("Used in a product test") | `en.ts`/`ar.ts` | 0 |
| Operator: desk event block, hire prefill, courts events line | `ws.events.*` | `ws/events.*` | F |
| Operator: Goods in from the driver, made today, day-close checklists, From marketing, Setup checks, Daily checklists card | `ws.supplies.*` | `ws/supplies.*` | I |
| Phone: Today, account, venue picker, revoked, update-the-app, alerts row, sign-in refusal, requests | `staff.shell.*` | `staff/shell.*` | B |
| Phone: start, runs, run, step forms, decisions | `staff.protocols.*` | `staff/protocols.*` | H |
| Phone: checklists | `staff.checklists.*` | `staff/checklists.*` | H |
| Phone: production, shopping, purchases | `staff.supplies.*` | `staff/supplies.*` | H |
| Phone: My take, campaign drafts | `staff.marketing.*` | `staff/marketing.*` | H |
| Phone: notes on new items | `staff.notes.*` | `staff/notes.*` | H |
| Phone: photo picker and permissions | `staff.media.*` | `staff/media.*` | G |
| Guest privacy policy line | `legal.*` | `legal.*` | G |

- `work.*` holds the words both apps show: `work.protocol.kind.{product_release,tournament,hiring,price_promo}`,
  `work.protocol.variant.{type1,type2,type3}`, `work.protocol.runStatus.<status>`,
  `work.protocol.stepStatus.<status>`, `work.protocol.decision.{approve,auto,send_back,stop}`,
  `work.protocol.action.{start,submit,withdraw,approve,sendBack,stop,skip,launchNow,launchOnDate,applyNow,applyOnDate,cancelSchedule}`,
  `work.protocol.{needsOwnerOk,optional,round,autoPassed,involved,noteDeleted}` (`noteDeleted`
  replaces the purge marker of §2.12 on screen),
  `work.protocol.change.{price,shop_launch,addon_price,promotion,promotion_edit,promotion_enable,rate,featured_discount}`
  (the eight price/promo change kinds, §2.8),
  `work.checklist.slot.{open,close}`, `work.shopping.status.<status>`,
  `work.purchase.status.<status>`, `work.item.kind.{drink,dessert,food}`. Role names stay `op.roles.*`.
- `staff/index.ts` assembles `staff = {shell, protocols, checklists, supplies, marketing, notes, media}`
  like `ws/index.ts`; `en.ts` mounts `staff: staffEn` and `work: workEn` (0).
- Arabic parity: every AR fragment is typed `DeepMessages<typeof <en fragment>>`, so a missing key
  fails typecheck; `packages/i18n/src/__tests__/t.test.ts:35` asserts parity. Every screen string
  exists in both catalogs.
- **Bilingual data** (rows, not catalogs): template, step and checklist names and items carry
  `_en` + `_ar` (both required); a run title carries whichever the starter typed and the UI shows
  it in both locales, falling back to the other language; step names come from the run snapshot;
  menu, court and ingredient names from their `_en`/`_ar` columns. Free text (notes, records,
  briefs, decision notes) is shown as typed, wrapped in `isolate()` (`@touch/i18n`) wherever it is
  interpolated into a sentence.

---

## 5. Operator

### 5.1 Routes, rail, capabilities

- `ROUTE_ROLES['/protocols'] = ['manager', 'owner']` (`op/lib/auth.tsx`). No `SUB_ROUTES` entry
  (that map lists only `/admin` and `/stock` children).
- **`/tasks` widens (Q2: every step form on the desktop too).** `ROUTE_ROLES['/tasks']` goes from
  `['driver', 'marketing']` to every non-MGMT hireable role: cashier, court_desk, head_barista,
  barista, head_chef, chef, driver, marketing. `workspaceForPath` (`op/lib/workspaces.ts:388`)
  stops pinning `/tasks` to `team` and renders it in the caller's own workspace; the `team` rail
  stays one row. Cashier and court_desk get a "My tasks" rail row in their workspace. The kitchen
  board is navless, so its header (`op/features/kds/KitchenDisplayScreen.tsx`) gains a "My tasks (N)"
  button for the bar and kitchen roles, opening `/tasks` with a way back to the board. Its count
  (`my_protocol_work`'s To do) and its handler live in `KdsBoard.tsx` and are passed down as props,
  as `onExit` is (`KdsBoard.tsx:190-232`); D edits that file after K's board commit (§1.2). prep gets
  nothing new. `homeRoute` is unchanged: each role still lands where it does today.
  `workspaces.test.ts` changes with it.
- `op/routes/protocols.tsx` exports `protocolsRoute` (`guarded('/protocols', …)`, lazy
  `features/protocols/ProtocolsPage`), registered in `op/main.tsx`. Search params
  `{run?: uuid, step?: uuid, start?: 'product_release'|'tournament'|'hiring'|'price_promo', variant?: 'type1'|'type2'|'type3', change?: 'price'|'shop_launch'|'addon_price'|'promotion'|'promotion_edit'|'promotion_enable'|'rate'|'featured_discount', item?: uuid, addon?: uuid, promotion?: uuid, rule?: uuid, filter?: 'waiting'|'active'|'finished'}`
  (`change`, `item`, `addon`, `promotion` and `rule` prefill a price/promo start from the menu
  editor, Stock ▸ Products, Add-ons, Promotions, Rates and the hero builder, §5.5).
  D1 lands this route with its `validateSearch` and a placeholder page, so E, F and I can link to
  it before D2's page (operator routes are type-registered, `op/main.tsx` `interface Register`).
- Rail (`op/lib/workspaces.ts`, D2): add `'protocols'` to the `labelKey` union; in
  `OWNER_OBSERVATION` directly after the `/observation/requests` row:
  `{ to: '/protocols', labelKey: 'protocols', icon: 'split' }`; appended to `MANAGER_RUN`: the
  same row. Icon **PROPOSAL**. `NavItem` gains an optional `badge?: 'protocolsWaiting'` key that
  `RailLink` (`op/routes/__root.tsx`) renders from `QK.protocolsWaiting`. `workspaces.test.ts`
  updated; the owner rail keeps four sections.
- `CAPABILITY_ROLES` (D1; apps/operator/CLAUDE.md forbids an inline role comparison):
  `editProtocols: ['owner']` (How it works, per-run edits), `editChecklists: ['owner']`,
  `startProtocolRelease: ['head_barista', 'head_chef', 'manager', 'owner']`,
  `startProtocolPriceChange: ['marketing', 'manager', 'owner']` (the two Starts on `/tasks` and the
  phone-equivalent cards), `editLaunchedPrices: ['owner']` (the price lock in the menu editor,
  Stock ▸ Products, Add-ons and the hero's featured discount and Featured tile, #41, #51, #57, §5.5; Promotions and
  Rates use their existing `can.editPromotions` and `can.editRates` flags, which F makes
  owner-only, §5.5), `launchDirectly: ['owner']` (Add item in a cafe
  category, the switch on a never-launched item, a new shop product or paid add-on saved switched
  on, #52, #53, §5.5). Row-level buttons follow the RPC's `Can`; no inline role check. The
  `shop_launch` change is never offered on `/tasks`, which no MGMT role opens, so it needs no
  capability of its own.
- Other routes gain search params, each in its route file: `/desk/block?run=&step=` (F, event mode;
  `validateBlockSearch` in `op/routes/desk/_children.ts` returns `{date?, run?, step?}`),
  `/admin/staff?hire=<run_step_id>` (F, prefilled Add staff member; `validateSearch` on
  `adminStaffRoute` in `op/routes/admin/staff.tsx`), `/stock/receive?purchase=<id>` (I; the
  `receive` child in `op/routes/stock/_children.ts` gains a `validateSearch`).

### 5.2 Query keys and realtime

- Shared, in `op/lib/queryKeys.ts` (`QK`, landed by D1 so I's and E's UI commits can use them): `protocolsWaiting: ['protocols', 'waiting']` (Protocols,
  `/ops`, Observe home, the rail badge), `purchasesToReceive: ['purchases', 'toReceive']` (`/ops`,
  Goods in), `checklistDayState: { all: ['checklists', 'dayState'], date: (d) => ['checklists', 'dayState', d] }`
  (day close, the checklists card).
- Feature-private, `op/features/protocols/keys.ts`: `PK.overview`, `PK.runs(filter, kind, page)`,
  `PK.run(id)`, `PK.step(id)`, `PK.template(id)`, `PK.context(stepKey, runId)`,
  `PK.targets(change)` (`price_promo_targets`), `PK.review(runId)` (`release_review`), all under
  `['protocols', …]`, so invalidating `['protocols']` refreshes the page. I keeps its own under
  `['checklists', …]` and `['purchases', …]`.
- Realtime: none new. Protocol and badge queries refetch every 60 s and on focus.

### 5.3 Writes

- Every write is `appRpc(...)`, online-only. **No queued mutation type** is added, so the six copies
  of the mutation list do not change.
- Keys for keyed RPCs: minted when a form opens, reused on retry, replaced after success:
  `` `${intent}:${crypto.randomUUID()}` `` with intents `protocol.start`, `protocol.submit`,
  `protocol.launch`, `event.block`, `hiring.candidate`, `purchase.receive` (the `ReceiveDelivery`
  precedent, `op/features/stock/ReceiveDelivery.tsx:65`).
- Launch: `callEdge('protocol-action', {...}, { ttlMs: 0 })`; `EdgeFunctionName` gains
  `'protocol-action'` (`op/lib/edge.ts`).
- Photos (desktop step forms): upload through `staff_media_slot` then storage, the same contract
  as the phone.

### 5.4 Pages (D)

- `/protocols`: five cards (the four protocols, then Daily checklists from I's
  `features/checklists/ChecklistsCard`), each protocol card "N running · N waiting on you" with
  Start (every kind, both roles); Waiting on you, In progress, Finished lists (the
  `op/features/observation/StaffRequests.tsx` layout). The price/promo start offers all eight
  change kinds (§2.8) with its targets from `price_promo_targets`, prefilled from `change`, `item`,
  `addon`, `promotion` and `rule` (§5.1). The run sheet: step timeline with rounds, records, photos by signed URL,
  ticks, marketing's take, release notes and the day-30 review (MGMT only, which this page already
  is, #54).
  The step sheet: the form for `step_key` (all 18 built-in forms plus the generic one), its context
  read (§2.9-2.13), ticks, and the decision dialog adapted from `DecisionDialog`
  (`StaffRequests.tsx:258`): Approve, Send back (target from `Can.send_back_targets`), Stop, Skip,
  a reason required for the last three, no price override. Buttons are hidden when `Can` says no.
  How it works (owner): `SettingsGroup`/`SettingsRow`, `Switch`, `SortButtons`, the checklist editor
  in the `SuggestedEditor` capped-list style, built-in steps locked per `defs` (no OK switch where
  the def says `ok_fixed`: release `analysis` and `launch`, price/promo `numbers`, hiring
  `add_staff`, #58), confirm "Running protocols keep their steps. New ones use this." Per-run edits (owner, `editProtocols`) on the run
  sheet; this is their only surface (they are not on the phone). Every form renders from
  `@touch/core/protocols` (§7.2).
- `/tasks` (every non-MGMT hireable role, §5.1): `my_protocol_work` To do, Waiting and Decided; an
  open step opens the same step sheet as `/protocols`, photos as files, ticks included (Q2: the
  head roles' propose and test, the court desk's courts step, marketing's steps, and owner-added
  steps whose actors include cashier, barista or chef). Start "Propose a new item" for
  `startProtocolRelease`, Start "Price or promo change" for `startProtocolPriceChange`, offering
  every kind but `shop_launch` (`price`, `addon_price`, `promotion`, `promotion_edit`,
  `promotion_enable`, `rate`, `featured_discount`; never `shop_launch`: hidden products are not
  offered to marketing, since no screen or target list shows them; §2.8). `/tasks` never shows a day-30 review: a head role's finished release shows as done,
  with no figures (#54). The
  phone-first role pages (checklists, production, shopping, purchases, My take, campaign drafts,
  requests, item notes) show as a read-only copy of today marked "on your phone"; checklists are
  not ticked on the desktop.
- `/ops`: two alert rows beside `OPS_ALERTS` (`op/features/ops/opsLogic.ts:257`), from separate
  queries, not a re-issued `ops_overview`: "N waiting on you" → `/protocols?filter=waiting`,
  "N purchases to receive" → `/stock/receive`.
- Observe home: a `WaitingOnYou` row (`op/features/observation/ObservationHome.tsx:140-190`); a
  count badge on the Observe rail button and on the Protocols row (the `NavItem` `badge` key,
  §5.1). `/panel` stays read-only.

### 5.5 Pages outside `/protocols`

- E, menu editor (`op/features/admin/menu/**`; its item read gains `launched_at`): an item with an
  unfinished release shows "In release: <run>", cannot be activated, and its size prices are
  read-only for everyone (`ITEM_IN_RELEASE`). On a launched item, cafe or shop,
  `VariantsEditor`'s `pricesLocked = !can(role, 'editLaunchedPrices') && launched`: prices
  read-only and Add size off, with "Change the price" linking
  `/protocols?start=price_promo&change=price&item=<id>`. A never-launched draft stays fully
  editable. **New items** (#52, #53), when `!can(role, 'launchDirectly')`: Add item in a cafe
  category becomes "Propose a new item" (`/protocols?start=product_release`); a never-launched
  cafe item's switch is off with "Goes on sale when the owner launches it"; a never-launched item in
  a shop category, if the editor lists one, shows "Put on sale"
  (`/protocols?start=price_promo&change=shop_launch&item=<id>`). The owner's editor is unchanged
  (`launchDirectly`). The server guards are the real line; the UI only avoids a refusal after
  typing, and maps `PRICE_VIA_PROTOCOL`, `ITEM_VIA_RELEASE` and `LAUNCH_VIA_PROTOCOL` if one still
  arrives. This UI commit lands after F's `price_promo` (the lock it mirrors) and D1. Ledger
  (`LedgerDrawer.tsx:23` `MOVEMENT_TYPES`) and the variance report show `product_test`.
- F, Stock ▸ Products (`op/features/stock/products/**`; #51, #53; the shop catalogue read,
  `fetchShopCatalogue` in `op/features/stock/stockKeys.ts:246-261`, gains `launched_at` so the page
  can tell a launched product from a never-launched hidden draft), when
  `!can(role, 'launchDirectly')`: "New product" saves the item with `p_is_active: false` (the
  manager's shop draft) and its sizes and prices through `upsert_retail_variant` as today (the
  draft exception); a hidden product that was never on sale shows "Put on sale"
  (`/protocols?start=price_promo&change=shop_launch&item=<id>`, prefilled with its sizes and
  prices). When `!can(role, 'editLaunchedPrices')`, a launched product's size prices are read-only
  and Add size is off, with "Change the price" (`change=price`); SKU, barcode, supplier, pack cost
  and low-stock level stay editable (`upsert_retail_variant` with the price unchanged). Copy in
  `ws.pricing.*`.
- F, Add-ons (`/admin/addons`, `op/features/admin/addons/**`; #51, #53; the options read gains
  `launched_at`), for a manager (`!can(role, 'editLaunchedPrices')`, `!can(role, 'launchDirectly')`;
  the owner's screen is unchanged): a launched add-on's price is read-only with "Change the price"
  (`/protocols?start=price_promo&change=addon_price&addon=<id>`); a new option with a price above 0
  is saved with `p_is_active: false` and shows "Put on sale" (the same link); a never-launched paid
  add-on's switch is off; a free option (0 IQD) is added and switched as today. The optimistic
  switch (`OptionsEditor.tsx:73`) and the reorder, which re-send `upsert_modifier` with the price
  unchanged, keep working. Copy in `ws.pricing.*`.
- F, Promotions (`/admin/promotions`, `op/features/admin/promotions/**`; #57). `permissionsFor`'s
  `editPromotions` (`op/lib/auth.tsx`) becomes `['owner']` in this commit, so for a manager
  `PromotionEditor` renders read-only as it already does for a role without the flag
  (`PromotionEditor.tsx:123`, with `PermissionRefusedNotice`). For a manager: New promotion becomes
  "Propose a promotion" (`/protocols?start=price_promo&change=promotion`); an open promotion shows
  "Change this promotion" (`change=promotion_edit&promotion=<id>`); in `PromotionsList` the switch
  still turns a promotion off (`set_promotion_enabled` false, `PromotionsList.tsx:96`): today the
  same flag disables it (`disabled={!can.editPromotions}`, `PromotionsList.tsx:166-169`), so this
  commit changes it to `disabled={!can.editPromotions && !p.enabled}`; on a switched-off row the
  switch stays disabled and "Switch on" (`change=promotion_enable&promotion=<id>`) stands beside it;
  Generate code (`PromotionEditor.tsx:184`) is hidden, and the start form offers a random code from
  `PROMO_CODE_ALPHABET` instead. The refusal notices take their role from `requiredRoleFor`, which
  returns `'manager'` for both flags today (`op/lib/auth.tsx`, `default:`), so a manager would read
  "… needs the manager role" (`ws.kit` copy, `kit.en.ts:93`). In this commit `requiredRoleFor`
  returns `'owner'` for `editPromotions` and `editRates` (the shared-file row, §1.2), and, for a
  manager, the three notices (`PromotionsList.tsx:204`, `PromotionEditor.tsx:253`,
  `RateRuleEditor.tsx:144`) give way to the protocol starts, so no screen says "ask an owner"
  beside a Propose button. The owner's screen is unchanged.
- F, Rates (`/admin/rates`, `op/features/admin/RateRuleEditor.tsx`, `rateRuleLogic.ts`; #57).
  `permissionsFor`'s `editRates` becomes `['owner']` in the same commit, so a manager's rule editor
  is read-only through its existing `readOnly` prop (`RateRuleEditor.tsx:198`); each rule shows
  "Change this rate" (`change=rate&rule=<id>`) and the page "Propose a new rate" (`change=rate`)
  in place of the `PermissionRefusedNotice` (`RateRuleEditor.tsx:144`, `requiredRoleFor`, as in
  Promotions above). The owner's screen is unchanged.
- F, Hero (`/admin/hero`, `op/features/admin/hero/HeroBuilder.tsx`; #57), for a manager
  (`!can(role, 'editLaunchedPrices')`): the featured discount (`HeroBuilder.tsx:317`) is read-only
  with "Change the discount" (`change=featured_discount`) and, when it is above 0, "Switch the
  discount off" (saves 0 through `set_cafe_settings`, which passes); while the discount is above 0
  the featured item picker is off with "Moving the featured item moves its discount", and, while
  the stored discount is above 0 and the saved hero mode is not Featured, the Featured mode tile
  (`HeroBuilder.tsx:205-229`) is off with "Featured mode puts the stored discount on sale. Switch
  the discount off first, or change it in Protocols" (`ws.pricing.*`). Moving the hero off
  Featured, and labels, badges, ticker and hero media, are saved as today (the builder sends
  changed keys only, `hero_mode` last, `diffHero`, `HeroBuilder.tsx:89-121`).
- F's pricing UI commit (Products, Add-ons, Promotions, Rates, Hero, the two `permissionsFor`
  flags and their `requiredRoleFor` roles) lands after `price_promo` and D1, never before: flipping the flags earlier would lock
  managers out before the protocol exists. Every refusal still maps through `MAPPED_CODES`
  (`PRICE_VIA_PROTOCOL`).
- K, the kitchen board (`op/features/kds/KdsBoard.tsx`, `ticketView.ts`; #60): the tickets query
  calls `kitchen_board` (§2.23). Nothing visible changes, cloud or LAN.
- F: `/desk/block` event mode, opened from the courts step on `/protocols` or `/tasks`
  (`?run=&step=`): ranges from `tournament_context`, multi-court, multi-day, conflicts listed to
  move first, then submits the courts step; `/admin/staff?hire=` opens Add staff member with the pick's display name and
  role, then calls `submit_step` for `add_staff` with the new `staff_id`; the courts analytics
  "Events" line and the same line on `/reports/courts` (`report_courts`, §2.11), kept in round 9
  (#55).
- I: Stock ▸ Goods in gains "Bought by the driver" (`purchases_to_receive`), prefilled from a
  purchase into `receive_purchase`, and Acknowledge for non-stock lines; Stock ▸ Waste and
  production gains "Made today" (`production_log_today`); day close gains a soft "Checklists not
  finished" section from `checklist_day_state`, a warning list, never a block
  (`dayCloseLogic.ts:290-294` pattern); `/marketing` gains a "From marketing" filter and badge
  (`marketing_suggestions`); Setup "Worth checking" lists prepared items with no par level and any
  prep accounts left.

### 5.6 pages.md sentences

`docs/design/assistant/pages.md` (the map generator refuses a route without one):
- D adds: `- /protocols — Protocols: cards for New item, Tournament, Hiring, Price or promo change and Daily checklists, each showing how many are running and waiting on you with a Start button; Waiting on you, In progress and Finished lists from app.protocol_runs_page; a run opens its steps, records, photos and decisions (app.protocol_run_detail), a step's form submits through app.submit_step, Approve, Send back, Stop and Skip call app.decide_step or app.skip_step (a reason is required for the last three), Launch goes through the protocol-action function, and the owner-only How it works sheet saves app.save_protocol_template.`
- K rewrites `/kds` to say the board reads its tickets through `app.kitchen_board` (in the board
  commit); D then adds the My tasks button to it, and rewrites `/tasks` for its new behaviour and
  roles. E, F and I update the sentences of `/admin/menu` (E: the price lock and "Propose a new
  item"), `/stock/variance`, `/desk/block`, `/admin/staff`, `/reports/courts`, `/stock/products`
  and `/admin/addons` (F: the price lock and "Put on sale"), `/admin/promotions`, `/admin/rates`
  and `/admin/hero` (F: read-only for a manager, with the starts of §5.5), `/stock/receive`,
  `/stock/waste`, `/admin/day-close`, `/marketing` and `/setup` for what they change.

### 5.7 Assistant-coverage keys

| Section | Keys | Value |
|---|---|---|
| `routes` | `/protocols` | `map:page` |
| `tables` | `protocol_templates`, `protocol_template_steps`, `protocol_template_items`, `protocol_runs`, `protocol_run_steps`, `protocol_submissions`, `protocol_run_items`, `release_reviews`, `release_notes`, `checklist_templates`, `checklist_template_items`, `checklist_runs`, `checklist_run_items`, `shopping_items`, `purchases`, `purchase_lines`, `marketing_notes` | `table_read` (+ readable-column rows for the migration's own tables only, §1.5) |
| `tables` | `hiring_candidates` | `excluded: candidate personal data, deleted 90 days after the decision` |
| `tables` | `staff_media_uploads` | `excluded: upload slots for work photos; bookkeeping no screen reads` |
| `functions` | every client-granted RPC in §2 | `map:action` |
| `functions` | every internal (revoked) function in §2: the `protocol_start_`/`check_`/`submit_`/`pass_`/`finish_`/`stop_` hooks, every `*_internal`, `notify_staff`, `staff_ids_with_roles`, `claim_staff_media`, `protocol_step_defs`, `protocol_step_allowed`, `protocol_run_allowed`, `protocol_seed_venue`, `venue_business_date`, the `release_due_*`/`release_launch_*`/`release_review_*` functions, `protocol_photo_purge_due`, `protocol_photos_purged`, the two nudges, `hiring_purge_due`, `price_promo_apply_due`, `price_promo_check_targets` (the `*_internal` set includes `upsert_menu_item_internal`, `upsert_variant_internal`, `upsert_modifier_internal`, `upsert_promotion_internal`, `set_promotion_enabled_internal`, `upsert_rate_rule_internal` and `set_cafe_setting_internal`) | `excluded: service_role only — an internal helper reached by other RPCs, edge functions or cron, never by a client` (the inventory takes every `create function app.*`, `build-assistant-map.mjs:284`; `check:assistant-coverage --update` writes the value) |
| `functions` | `is_staff_media_path`, `staff_media_venue`, `staff_media_folder` | the standard excluded value above as well, as `phone_digits` has today (granted to guests only so a storage policy can run them; also `publicByDesign`, §2.3) |
| `edge_functions` | `protocol-action`, `release-review` | `map:system` |
| `cron_jobs` | the four in §2.19 | `map:system` |
| `docs` | `docs/design/protocols/build-contracts-2026-09-23.md` | `index:doc` |

---

## 6. Mobile

Everything follows `apps/mobile/CLAUDE.md`. Guest behaviour is identical while the status is
`guest`, the context default, so every existing suite renders unchanged.

### 6.1 Route files

Flat files on the root stack, no new layout (`routes.test.ts:48-53`). Each screen sets its own
title with `<Stack.Screen options={{ title }} />` (the `settings.tsx:188` precedent); `app/_layout.tsx`
does not declare them (**PROPOSAL**). Each wraps itself in `<RequireStaff roles={…}>`; Back is
`useBack('/staff')`. A literal `router.push` target must exist in the same commit
(`routes.test.ts` "points every push at a route that exists"), so a Today row lands with its screen.

| File | Lane | Roles | Reads | Writes |
|---|---|---|---|---|
| `staff.tsx` (Today) | B, H | all | `my_protocol_work`, `my_checklists_today`, counts from the lists below | – |
| `staff-request.tsx?id=` | B | all | `staff_requests_page` | `submit_staff_request`, `withdraw_staff_request`. The owner sees requests here with "Decide in Observe ▸ Requests on the operator" (#16, decided in round 10 as #56: no `decide_staff_request` on the phone) |
| `staff-checklist.tsx?id=` | H | all | `my_checklists_today` | `mark_checklist_item` |
| `staff-start.tsx?kind=&variant=&change=&itemId=&addonId=&promotionId=&ruleId=` | H | by kind (§2.7); for price/promo, the change kinds by role: MGMT all eight, marketing every kind but `shop_launch` (MGMT only, §2.8) | `staff_ingredient_options`, `price_promo_targets` (price/promo), the kind's first-step form | `staff_media_slot`, `start_protocol` |
| `staff-runs.tsx?filter=` | H | all | `protocol_runs_page` | – |
| `staff-run.tsx?id=` | H | involved, MGMT | `protocol_run_detail`, `release_notes_for_item`, `release_review` (MGMT only, #54: for anyone else the query is not made and no review block renders; the run shows `done` with no figures), `marketing_notes_for` (MGMT) | `stop_protocol`, `withdraw_protocol`, `cancel_schedule` (per-run edits are operator-only, Q11) |
| `staff-step.tsx?id=` | H | involved, MGMT | `protocol_step_detail`, the step's context read (`release_test_context`, `release_cost`, `release_readiness`, `price_promo_numbers`, `tournament_context`, `tournament_feasibility`, as the step and role allow), `hiring_candidates` | `staff_media_slot`, `submit_step`, `withdraw_step`, `tick_run_item`, `decide_step`, `skip_step`, `block_courts_for_event`, `save_hiring_candidate`, `delete_hiring_candidate`, `suggest_campaign`; edge `protocol-action` (launch) and `staff-admin` (add staff, owner) |
| `staff-production.tsx` | H | CHEFS, MGMT | `production_today`, `production_log_today` | `record_batch` |
| `staff-shopping.tsx` | H | BAR_KITCHEN, driver, MGMT | `shopping_list`, `staff_ingredient_options` | `add_shopping_item`, `cancel_shopping_item` |
| `staff-purchase.tsx?itemIds=` | H | driver, MGMT | `shopping_list`, `my_purchases` | `staff_media_slot`, `record_purchase` |
| `staff-marketing.tsx` | H | marketing | `my_marketing_notes`, `my_campaign_drafts` | `add_marketing_note`, `suggest_campaign`, `staff_media_slot` |
| `staff-notes.tsx?itemId=` | H | all | `release_notes_for_me`, `release_notes_for_item` | `add_release_note` |

`staff-start.tsx` is every start form ("Propose a new item", "Price or promo change", and the
manager's and owner's tournament and hiring starts), and `staff-runs.tsx?filter=mine` is "My
runs", which covers the head roles' proposals (**PROPOSAL**). The add-staff form mirrors the
operator's (email, opening password 10 to 72 characters, display name and role prefilled); the
server is the wall. PINs are still set on the operator.

**Today rows by role** (`mob/src/features/staff/rows.ts`, pure `staffRows(role)`):

| Role | Protocols | Start | Production | Shopping | Purchases | Marketing | Requests | Notes |
|---|---|---|---|---|---|---|---|---|
| owner, manager | all runs | all four kinds | yes | read, add | read | – | yes | yes |
| head_barista | involved | product_release | – | read, add | – | – | yes | yes |
| head_chef | involved | product_release | yes | read, add | – | – | yes | yes |
| barista | involved | – | – | read | – | – | yes | yes |
| chef | involved | – | yes | read | – | – | yes | yes |
| driver | involved | – | – | read, buy | own | – | yes | yes |
| marketing | involved | price_promo (every kind but `shop_launch`) | – | – | – | yes | yes | yes |
| cashier, court_desk, prep | involved | – | – | – | – | – | yes | yes |

Checklists sit at the top of To do for every role. Receiving purchases, templates, checklist
templates, one run's changes (owner), deciding staff requests and making campaigns live are
operator-only; Today says so on the relevant row. The day-30 review is shown only to MGMT (#54),
and only MGMT gets the `review_ready` push that opens it (§2.21). The phone has no menu, product,
add-on, promotion, rate or hero editor: direct prices, discounts and new items stay on the
operator (§5.5), and a price, promotion, rate or discount change on the phone is a price/promo
start.

### 6.2 Smoke table rows (`mob/src/smoke/routes.ts`, under `// ── staff ──`)

```
{ file: 'staff.tsx',            route: 'staff',            primary: 'staff.requests' },
{ file: 'staff-request.tsx',    route: 'staff-request',    primary: 'staff-request.submit' },
{ file: 'staff-checklist.tsx',  route: 'staff-checklist',  primary: 'staff-checklist.done' },
{ file: 'staff-start.tsx',      route: 'staff-start',      primary: 'staff-start.submit' },
{ file: 'staff-runs.tsx',       route: 'staff-runs',       primary: 'staff-runs.filter.waiting' },
{ file: 'staff-run.tsx',        route: 'staff-run',        primary: 'staff-run.current-step' },
{ file: 'staff-step.tsx',       route: 'staff-step',       primary: 'staff-step.submit' },
{ file: 'staff-production.tsx', route: 'staff-production', primary: 'staff-production.record' },
{ file: 'staff-shopping.tsx',   route: 'staff-shopping',   primary: 'staff-shopping.add' },
{ file: 'staff-purchase.tsx',   route: 'staff-purchase',   primary: 'staff-purchase.save' },
{ file: 'staff-marketing.tsx',  route: 'staff-marketing',  primary: 'staff-marketing.tab.take' },
{ file: 'staff-notes.tsx',      route: 'staff-notes',      primary: 'staff-notes.add' },
```

B's two cases live in `staff.smoke.test.tsx`, H's ten in `staffPages.smoke.test.tsx`; each route is
named by exactly one suite, in EN and AR. `renderRoute` (`mob/src/test/smoke.tsx:79`) gains
`staff?: { role: StaffRole; venues?: string[] }`, which mounts `StaffStatusProvider` and seeds
`staffKeys.status(<test uid>)` and `staffKeys.venues(<test uid>)` through `queryData`
(`staleTime: Infinity`). Guest cases omit it.

### 6.3 testID prefixes

`<route>.<element>`, kebab-case; a list row appends its id; a shared component takes `testID` and
forwards `${testID}.<child>`.
- `staff.*`: `staff.requests`, `staff.row.<rowId>`, `staff.todo.<runStepId>`,
  `staff.checklist.<runId>`, `staff.waiting.<submissionId>`, `staff.decided.<submissionId>`,
  `staff.decide.<submissionId>`, `staff.venue.<venueId>`, `staff.alerts.enable`, `staff.settings`,
  `staff.sign-out`, `staff.revoked.sign-out`, `staff.update.sign-out`.
- `staff-step.*`: `submit`, `withdraw`, `item.<itemId>`, `photo.add`, `photo.<n>.remove`,
  `decide.approve`, `decide.send-back`, `decide.stop`, `decide.target.<runStepId>`, `decide.note`,
  `decide.confirm`, `skip`, `field.<fieldName>`, `launch.now`, `launch.date`,
  `block.add`, `block.submit`, `candidate.add`, `candidate.<id>`.
- `staff-run.*`: `current-step`, `step.<runStepId>`, `stop`, `withdraw`, `cancel-schedule`.
- `staff-start.*`: `submit`, `kind.<kind>`, `change.<change>`, `target.<menuItemId|modifierId|promotionId|ruleId>`, `target.featured`,
  `field.<fieldName>`, `line.add`, `line.<n>.remove`, `size.add`, `photo.add`.
- The rest: `staff-runs.filter.<filter>`, `staff-runs.run.<runId>`; `staff-checklist.item.<itemId>`,
  `staff-checklist.done`; `staff-production.record`, `staff-production.item.<ingredientId>`;
  `staff-shopping.add`, `staff-shopping.item.<id>`, `staff-shopping.cancel.<id>`,
  `staff-shopping.buy`; `staff-purchase.save`, `staff-purchase.line.<n>`, `staff-purchase.receipt`;
  `staff-marketing.tab.take`, `staff-marketing.tab.drafts`, `staff-marketing.note.add`,
  `staff-marketing.draft.<id>`; `staff-notes.add`, `staff-notes.item.<menuItemId>`;
  `staff-request.submit`, `staff-request.withdraw.<id>`.
- New Pressable wrappers join `testIdElements` (`packages/config/src/eslint.js:178`):
  `ChecklistRow`, `DecisionBar` (H), `PhotoButton` (G), and any wrapper B adds.

### 6.4 Query keys, idempotency, network

- `mob/src/features/staff/keys.ts` (B), one family, all under `['staff', …]`:
  `status(uid)`, `venues(uid)`, `work(venue)`, `checklists(venue)`, `runs(venue, filter)`, `run(id)`,
  `step(id)`, `context(stepKey, runId)`, `priceTargets(venue, change)`, `review(runId)` (MGMT
  only), `ingredients(venue)`, `production(venue)`,
  `productionLog(venue)`, `shopping(venue, status)`, `purchases(venue)`, `requests(uid)`,
  `notes(venue)`, `itemNotes(itemId)`, `marketingNotes(venue)`, `campaignDrafts(venue)`,
  `candidates(runId)`, and `mutation(name: StaffMutation) => ['staff', 'mutation', name]`. Never an
  inline array.
- `mob/src/lib/queryClient.ts:145-148`: the `'staff'` root is kept out of the disk cache, and
  `queryClient.setMutationDefaults(['staff', 'mutation'], { networkMode: 'always', retry: (n, e) => n < 1 && isRetriable(e) })`
  is set once there (**PROPOSAL**): a staff write runs now or fails with `errors.network`; it is
  never paused and replayed later. TanStack applies mutation defaults by `mutationKey` prefix
  only, and the global mutation default is `networkMode: 'offlineFirst'` (`queryClient.ts:108-114`),
  so **every staff `useMutation` passes `mutationKey: staffKeys.mutation(<name>)`**; without it a
  write could pause offline and fire later. A vitest case asserts
  `queryClient.getMutationDefaults(['staff', 'mutation', 'submit']).networkMode === 'always'`.
- `mob/src/lib/idempotency.ts`: `staffIdemKey(mutation: StaffMutation): string` →
  `` `MOBILE:staff.${mutation}:${ulid()}` ``; `staffIntentKey(intent: string, mutation: StaffMutation)`
  memoised per intent; `clearStaffIntentKey(intent)`. `StaffMutation = 'start' | 'submit' | 'launch' | 'shopping.add' | 'purchase' | 'batch' | 'note' | 'marketing_note' | 'campaign' | 'event_block' | 'candidate'`.
  A retry reuses the key; a new intent gets a new one.

### 6.5 StaffStatus

`mob/src/features/staff/status.ts` (pure):
`type StaffStatus = {kind:'none'} | {kind:'pending'} | {kind:'guest'} | {kind:'staff', staff:{id, displayName, role}, venues: string[]} | {kind:'revoked'} | {kind:'unsupported', role: string}`.
The context default is `guest`.

| Input | Next |
|---|---|
| Session still restoring (AuthProvider `initializing`), a hint on this phone | `pending` (the tabs never mount on a staff cold start) |
| No session | `none` |
| Session, row read in flight, hint uid = session uid | `pending` |
| Session, row read in flight, no matching hint | `guest` |
| The read errored | previous (a `pending` stays `pending`; Today shows a retry after 10 s) |
| No row, no hint for this uid | `guest` |
| No row, hint for this uid | `revoked` |
| Row with `is_active = false` | `revoked` |
| Active row, role unknown to this build (`unknown_role`, §7) | `unsupported` ("Update the app") |
| Active row, known role | `staff` (venues = `app.staff_venue_ids()` ∩ active venues) |

- Re-check on focus and every `ROLE_RECHECK_MS` (60 s, §7) while `staff`.
- **Device hint** `tp.staff-hint` in AsyncStorage: `{uid, surface: 'staff', v: 1}`; written when a
  row resolves to `staff`; read pre-splash in `bootPrefs.ts` (so a staff cold start never mounts the
  guest tabs); cleared on `SIGNED_OUT` (`context.tsx:68-77`) and on `revoked`; every access in
  try/catch. The chosen venue is `tp.staff-venue:<uid>` (**PROPOSAL**); the picker shows only with
  more than one venue, and every call passes `p_venue_id`.
- `staffGate(status, roles?)` → `'loading' | 'allow' | 'redirect-guest' | 'redirect-staff-home' | 'revoked' | 'unsupported'`.
  `guestTabsGate(status)` → `'tabs' | 'loading' | 'redirect-staff'` (`pending` → `loading`;
  `staff`, `revoked`, `unsupported` → redirect). `noSessionGate` gains `staff?: StaffStatus['kind']`:
  `pending` → `loading`; `staff` → redirect to `/staff` before the complete-profile branch. It also
  gains `staffAnswered?: boolean`, the provider's `answered` (the signed-in account's row has been
  read, or failed; an active row held at `guest` for a refusal is not answered): `false` →
  `loading`, because an unread staff account reads `guest` and would be sent to complete-profile.
  `useTermsGate` reads no consent until `answered`. `guestTabsGate` does not wait on it, so a
  guest's cold start is unchanged.
- `revoked` and `unsupported` render full-screen on `/staff` with Sign out, never the guest UI.

### 6.6 Sign-in

- `postSignInStep(profile, hasPendingSlot, staffRow?)` (`mob/src/features/auth/social.ts:198`)
  gains `'staff'`: an active staff row returns it before the profile branch; the screen writes the
  hint and replaces to `/staff`.
- A Google or Apple sign-in that lands on an active staff row signs out and shows
  `staff.shell.socialRefused` ("Staff accounts sign in with email and password"). Only a row known
  to be active refuses: a failed read signs no guest out. `StaffStatusProvider` holds the rule for
  the rest: a session whose JWT `amr` names `oauth` never resolves to `staff`, and is signed out
  with the same message once its row read shows an active row (a check that failed, a cold start).
- `useTermsGate` returns `'none'` for staff. The staff area links no change-password or
  forgot-password screen; the owner resets passwords on the Staff page.

### 6.7 The no-station-RPC guard

`mob/src/features/staff/__tests__/noStationRpc.test.ts` (B, vitest) reads every file under
`src/features/staff/**` and `app/staff*.tsx` and fails on a string literal naming any of:
- station: `heartbeat`, `break_status`, `start_break`, `end_break`, `cover_station`,
  `verify_own_pin`, `verify_manager_pin`, `consume_pin_grant`;
- kitchen: `set_ticket_status`, `set_order_item_ready`, `kitchen_board` (K, §2.23: BOARD passes
  on a bar or kitchen phone, so only this test keeps the board off the phone);
- till: `open_tab`, `till_add_items`, `settle_tab`, `settle_zero_tab`, `cancel_tab`, `refund`,
  `void_after_send`, `apply_discount`, `override_price`, `apply_best_promotion`, `merge_tabs`,
  `split_by_item`, `split_evenly`, `record_drawer_open`, `open_day`, `close_day`,
  `ack_waiter_call`, `resolve_waiter_call`, `record_waste`, `booking_bill`;
- desk: `staff_create_reservation`, `move_reservation`, `extend_reservation`, `mark_reservation`,
  `cancel_reservation`, `create_series`, `cancel_series`;
- the manager-only public bodies the phone must not use: `record_production` (use `record_batch`),
  `receive_delivery`, `upsert_variant`, `upsert_retail_variant`, `upsert_menu_item`,
  `upsert_modifier`, `upsert_promotion`, `set_promotion_enabled`, `generate_promo_code`,
  `upsert_rate_rule`, `set_cafe_setting`, `set_cafe_settings`. So the menu and price writers' codes
  (`ITEM_IN_RELEASE`, `PRICE_VIA_PROTOCOL`, `ITEM_VIA_RELEASE`, `LAUNCH_VIA_PROTOCOL`) cannot reach
  the phone (§3).

### 6.8 Shared mobile files (B unless noted)

1. `app/_layout.tsx`: mount `StaffStatusProvider` inside `AuthProvider` (`:375-381`); wire the push
   open handler's staff branch.
2. `app/(tabs)/_layout.tsx`: `export { default } from '../../src/features/staff/GuestTabsGate';`
   (keeps `unstable_settings`); `GuestTabsGate` renders `TabsLayout` or `<Redirect href="/staff" />`.
3. `src/features/auth/{gate.ts,RequireNoSession.tsx}`: the `staff` input.
4. `src/features/auth/social.ts`, `app/sign-in.tsx`, `src/features/auth/useSocialSignIn.ts`: §6.6.
5. `src/features/auth/context.tsx`: clear the hint on `SIGNED_OUT`.
6. `src/features/profile/useTermsGate.ts`: `'none'` for staff.
7. `src/lib/queryClient.ts`, `src/lib/idempotency.ts`, `src/lib/bootPrefs.ts`: §6.4, §6.5.
8. `src/features/profile/pushSync.ts`: `tapDestination(data, status)` →
   `{kind:'reservation', id} | {kind:'staff', href} | null`; a staff route opens only while the
   status is `staff` and only when `data.route` is in `STAFF_PUSH_ROUTES`
   (`src/features/staff/pushRoutes.ts`, equal to `_shared/staff-push.json` `routes`). Mapping:
   `staff` → `/staff`; `staff-step` → `/staff-step?id=`; `staff-run` → `/staff-run?id=`;
   `staff-request` → `/staff-request?id=`; `staff-shopping` → `/staff-shopping`;
   `staff-checklist` → `/staff-checklist?id=`; `staff-notes` → `/staff-notes?itemId=`.
   `src/features/profile/push.ts` routes the result.
9. Today's "Turn on work alerts" row calls `registerPushToken({ prompt: true })` until permission is
   granted; the Account section shows whether alerts are on and says "one account per phone".
10. `src/test/smoke.tsx`, `src/smoke/routes.ts`: §6.2.
11. `apps/mobile/CLAUDE.md`: the feature list gains `staff` and a line pointing here.
12. G: `package.json`, `app.config.ts`, `pnpm-lock.yaml` (§6.10).

Untouched: `TabsLayout.ios/.android`, `useTabBarHeight`, the Book, Bookings and Profile screens,
booking, availability, `courtTransition`, `BootOverlay`, the Supabase client and its SecureStore
key, `deepLink.ts`, the push registration lifecycle (`app/_layout.tsx:179-206`), `jest.setup.ts`,
`routes.test.ts`, the guest push kinds.

### 6.9 Photos (G)

`mob/src/features/staff/photo.ts` is the only importer of `expo-image-picker`, loaded lazily inside
try/catch (the expo-gl precedent, `reliability.test.ts:206-217`, with a boundary test).
`pickPhoto(source: 'camera'|'library') → {uri, width, height, mime} | null` with
`{ mediaTypes: ['images'], allowsEditing: false, quality: 0.7, exif: false, base64: false }`;
`uploadStaffPhoto(venueId, folder, photo) → path`: `staff_media_slot`, then
`supabase.storage.from('staff-media').upload(path, await (await fetch(uri)).arrayBuffer(), { contentType, upsert: false })`.
The RPC is called with the path only after the upload succeeds. **UNVERIFIED:** whether the
re-encoded output still carries GPS EXIF; if it does, add `expo-image-manipulator` to re-encode in
the same binary.

### 6.10 expo-image-picker config (G)

- Install from `apps/mobile`: `npx expo install expo-image-picker`; then
  `pnpm --filter @touch/mobile doctor`.
- `app.config.ts` plugins:
  `['expo-image-picker', { photosPermission: '<EN>', cameraPermission: '<EN>', microphonePermission: false }]`
  with EN "Touch Padel uses your photos only when you attach a work photo." and "Touch Padel uses
  the camera only when you take a work photo."
- iOS `locales: { en: './locales/ios.en.json', ar: './locales/ios.ar.json' }` carrying
  `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` in both languages.
- `privacyManifests` (`app.config.ts:256-270`) gains
  `NSPrivacyCollectedDataTypePhotosorVideos` and `NSPrivacyCollectedDataTypeOtherUserContent`,
  linked, not tracking, app functionality.
- Android `blockedPermissions`: `android.permission.READ_MEDIA_IMAGES`,
  `android.permission.READ_MEDIA_VIDEO`, `android.permission.READ_EXTERNAL_STORAGE`,
  `android.permission.RECORD_AUDIO` (**UNVERIFIED** against SDK 57; the system photo picker needs
  none of them).
- `version` stays `1.0.0`; a new `development` dev client is needed. Production builds and store
  submits are run by a person.

---

## 7. Shared: the `@touch/core` modules (B)

### 7.1 Staff roles

`packages/core/src/staff/roles.ts`, exported from the barrel (`packages/core/src/index.ts`) and
reachable as `@touch/core/staff/roles`:

```ts
export const STAFF_ROLES = ['cashier','prep','court_desk','manager','owner',
  'head_barista','barista','head_chef','chef','driver','marketing'] as const;   // the enum's order
export type StaffRole = (typeof STAFF_ROLES)[number];
export const RETIRED_ROLES: readonly StaffRole[] = ['prep'];
export const HIREABLE_ROLES: readonly StaffRole[] =
  ['cashier','court_desk','manager','head_barista','barista','head_chef','chef','driver','marketing'];
export const ROLE_RECHECK_MS = 60_000;
export interface StaffInfo { id: string; displayName: string; role: StaffRole }
export interface StaffRow { id: string; display_name: string; role: string; is_active: boolean }
export type RoleResolution =
  | { kind: 'active'; info: StaffInfo }
  | { kind: 'revoked' }                       // no row, or is_active = false
  | { kind: 'unknown_role'; role: string }    // active row, role this build does not know
  | { kind: 'unknown' };                      // could not ask
export function resolveStaffRow(row: Partial<StaffRow> | null | undefined, error: unknown): RoleResolution;
export function nextStaff(previous: StaffInfo | null, r: RoleResolution): StaffInfo | null; // unknown keeps previous; unknown_role and revoked give null
```

- Moved from `op/lib/roleResolution.ts` with its tests (`packages/core/src/staff/roles.test.ts`).
- `op/lib/roleResolution.ts` keeps the SEC-35 header, `shouldDropRealtime`, and re-exports the
  names above; its exported `resolveStaffRow` wraps the core one and maps `unknown_role` to
  `revoked`, so `op/lib/auth.tsx`, `AuditLog.tsx`, `OperationsOverview.tsx`,
  `StaffActivityReport.tsx` and `roleResolution.test.ts` stay unchanged.
- The phone imports it in `mob/src/features/staff/status.ts` and maps `unknown_role` to
  `unsupported` (§6.5).
- Deno cannot import it. `packages/db/tests/staff-roles-parity.test.ts` asserts that
  `_shared/auth.ts`'s `StaffRole` union, `staff-admin/role.ts` `ROLES ∪ RETIRED_ROLES`, the
  hand-written `Role` unions in `apps/operator-shell/src/ipc-channels.ts:195-208` and
  `op/ipc/bridge.ts:120-133`, and (with the stack up) `enum_range(null::staff_role)` all equal
  `STAFF_ROLES`. The two `Role` comments ("Mirrors StaffRole (…roleResolution.ts)") are repointed
  at `@touch/core/staff/roles` and at this test.

### 7.2 Protocol forms

`packages/core/src/protocols/` (`steps.ts`, `validate.ts`, `types.ts`), exported from the barrel
and reachable as `@touch/core/protocols`, so the operator (D2) and the phone (H) render the same
form for a `step_key` (plan #38):
- a record type for every §2.8 shape, the start forms included; price/promo `propose` and
  `numbers` are a union over the eight change kinds, and `priceChangeKinds(role)` returns the kinds
  a starter may pick (MGMT all eight; marketing all but `shop_launch`), which the phone's start form
  and `/tasks` use (the operator's `/protocols` is MGMT only and `/tasks` never MGMT, §5.4); the
  promotion and rate validators mirror 0067's and 0071's checks with `RECORD_INVALID`-style field
  codes, and `randomPromoCode()` draws from `PROMO_CODE_ALPHABET` (§2.13);
- a field list per `(kind, step_key)` and one for the owner-added step: field name, type,
  required, caps (§2.1), options, `photo_folder`, `photos_min`, `photos_max`, and which fields a
  decider must fill (release `propose`'s `category_id`);
- pure client validators returning `[{field, code}]`, with the server's hint names, so a form
  marks the field before the round trip.

The server's check hooks stay the authority. Labels come from each app's catalogs, never from
this module. A vitest case in `packages/core` compares the caps with §2.1.

---

## 8. Verification and acceptance

### 8.1 Per lane, before reporting

Report exact results. Stack-dependent tests skip without Docker; say so when they do.

| Lane | Commands |
|---|---|
| 0 | `pnpm --filter @touch/i18n typecheck test`; `pnpm --filter @touch/operator typecheck test -- errors`; `pnpm --filter @touch/mobile typecheck test` |
| K | DB: as the DB row below, with `tests/kitchen-board.test.ts tests/new-roles.test.ts tests/rls-matrix.test.ts` and the guest cafe suites (`cafe-flow`, `kds-item-ready`); operator: `pnpm --filter @touch/operator typecheck lint test -- kds`; the visual check below on `/kds` as the seeded `prep@dev.touch.local` (and a head chef once B's `staff-roles.sql` exists); the LAN board has no database read, so `pnpm --filter @touch/operator-shell test -- lan-kds` passing unchanged is its check |
| A, C, E, F, G (DB) | drafts applied (§1.4); `pnpm --filter @touch/db typecheck lint`; `pnpm --filter @touch/db test -- tests/<lane files> tests/rls-matrix.test.ts`; `MIGRATION_RISK_ACCEPTED='<reason>' pnpm --filter @touch/db check:migrations`; `pnpm --filter @touch/db check:rpc-registry check:assistant-coverage`; with the stack: `check:authz check:locks check:safeupdate check:invariants check:broadcast check:analytics`; at commit, §1.4 reset and `db:types` |
| E, G (edge) | `/opt/homebrew/bin/deno check --no-lock packages/db/supabase/functions/{protocol-action,send-push}/index.ts`; `release-review` imports `npm:@anthropic-ai/sdk`, so use the tsc-plus-shim recipe; the pure halves under vitest; `pnpm --filter @touch/db exec supabase functions serve <fn> --no-verify-jwt` for a real run |
| B | `pnpm --filter @touch/core typecheck test`; `pnpm --filter @touch/operator typecheck lint test`; `pnpm --filter @touch/mobile typecheck lint test test:smoke` |
| D, I (operator) | `pnpm --filter @touch/operator typecheck lint test`; `pnpm --filter @touch/i18n typecheck test`; the visual check (a second Vite on port 5199 against the local stack, seeded `manager@dev.touch.local` / `owner@dev.touch.local`, Playwright screenshots in EN and AR); D also `pnpm e2e -- operator-protocols` (EN and AR projects) |
| H (mobile) | `pnpm --filter @touch/mobile typecheck lint test test:smoke`; a device run against the local stack over the LAN IP (the new migrations are not on hosted) |
| G (mobile deps) | `pnpm --filter @touch/mobile doctor`; the boundary test; the camera itself only on a phone |
| All | root `pnpm security` (stackless) |

This Mac has no iOS or Android toolchain: phone UI is verified by typecheck, lint, vitest and smoke
here, and visually by Majed on a phone through Metro on the new dev client (screenshots into
`docs/design/mobile-ui`).

### 8.2 DB tests every lane writes

- `rls-matrix.ts` rows for every new table and granted RPC across the eight principals.
- Driver and marketing denials (the `new-roles.test.ts` style), **each DB lane for its own tables
  and RPCs, in its own test files** (A in `protocols-roles.test.ts`; C, E and F in the files §1.2
  gives them): no read of a new table, no record of an `mgmt` step, no purchase price except their
  own purchases (driver), no cost anywhere.
- Engine: every transition in both allowed-tables, send back (history kept, later steps reset),
  stop, skip, withdraw, automatic pass for manager and owner, `CANNOT_DECIDE_OWN`, the dependency
  rule in template saves, owner-only per-run edits, idempotent `start_protocol` and `submit_step`
  replays, a missing hook's `PROTOCOL_NOT_READY`, a null `p_first_record` refused, a resubmission
  that re-claims the earlier round's photos (an approved one sent back from a later step
  included), a send-back that leaves a step not waiting on its target as it was (in the default
  and the swapped order), an owner-added step refused above a started step, storage showing a
  photo to exactly those the engine's reads show it to, and the reason CHECKs refusing a NULL
  `stop_reason`, `skip_note` and send-back or stop `decision_note` at the table. The fixed OK
  (#58): `save_protocol_template` refuses `needs_owner_ok = false` on release `analysis` and
  price/promo `numbers`, and any change of it on `launch` and `add_staff`, with
  `PROTOCOL_STEP_FIXED`, while a rename and a checklist edit of the same steps pass; a template
  row set to false through the service role still snapshots `needs_owner_ok = true` on those two
  steps of a new run, so a manager's submission there goes to the owner.
- E: `ITEM_IN_RELEASE` on activation and on a price change or new size of an item in release, for
  the manager and the owner, while `protocol_pass_product_release_analysis` still writes the
  prices; a manager-started release (its `propose` record carries `category_id` and passes at
  once); test consumption as `product_test` (not waste); the variance column; scheduled launch
  launched and reverted; a launch-now with a missing or foreign `menu_photo_path` refused;
  `release_launch_scheduled` and `release_review_input` called as `service_role` without
  `FORBIDDEN`. Day-30 access (#54): `release_review` refuses a non-MGMT starter (a head chef) and
  every other non-MGMT role with `FORBIDDEN`, and returns the full review to a manager and the
  owner; `release_review_save` queues `review_ready` for the owners and the venue's managers and
  none for a non-MGMT starter. New-item guard (#52, #53): a manager's new item in a cafe category
  refused `ITEM_VIA_RELEASE` hidden or on; a manager's switch-on of a never-launched cafe item (the
  owner's hidden draft) refused `ITEM_VIA_RELEASE`, and its move from a shop category into a cafe
  one too; a manager's new shop product saved on, and a switch-on of a hidden one, refused
  `LAUNCH_VIA_PROTOCOL`, while saved hidden it passes; a manager switches a launched item (one that
  existed before the migration and is off) back on; the owner creates and switches on cafe items
  and shop products directly; a manager's accept of a release proposal still creates the draft
  (through `upsert_menu_item_internal`); `launched_at` is set by a save that leaves an item active
  and by `release_launch_internal`, and is null on a new hidden item. The accepted limit (plan
  #59): a manager renames an item that existed before the migration and is off, and switches it
  on, without a refusal. `release_review_input` returns `notes` and `marketing_take` with no
  author name.
- C: `receive_purchase` retried with the same key books stock once; a second key refuses
  `PURCHASE_ALREADY_RECEIVED`; a receive that leaves out a stock line refused; `suggest_campaign`
  with one name and no channel gives `BAD_CHANNEL`, not a 23502.
- F: an event block with a conflict writes nothing; event minutes stay open capacity and appear in
  `event_minutes` in all three re-issued outputs, `report_courts` included; `tournament_context`
  gives the court desk the ranges and no money; the purge deletes candidates and overwrites
  decision notes, skip notes and the stop reason with the marker, on a run with a send-back;
  `app.assistant_readable_columns` has no `hiring_candidates` row. **The price locks** (#41, #51,
  #53), each as manager and as owner: `PRICE_VIA_PROTOCOL` for a manager on a launched cafe item's
  size price, on a new size of a launched item, on an item that existed before the migration and
  is off today, on a launched shop product's price through `upsert_variant` **and through
  `upsert_retail_variant`** (the pin of §2.13), and on a launched add-on's `price_delta_iqd`
  (including one that existed before the migration and is off); allowed for a manager: a
  never-launched hidden draft's prices (item, shop product, add-on), a launched product's SKU,
  barcode, supplier, pack cost and low-stock level with the price unchanged, a size rename,
  default or reorder, an add-on rename, reorder and off-and-on switch; `LAUNCH_VIA_PROTOCOL` for a
  manager's new paid add-on saved on and a never-launched paid add-on switched on; a free (0 IQD)
  option added switched on by a manager and then stamped launched, so its later price is locked;
  the owner passes every lock. The accepted limit (plan #59): an item and a paid add-on that
  existed before the migration, renamed by a manager and switched back on, still refuse a price
  change with `PRICE_VIA_PROTOCOL`. **The round 10 locks** (#57), each as manager and as owner:
  `PRICE_VIA_PROTOCOL` for a manager's `upsert_promotion` (a new one, and an edit of an existing
  one, on or off), `set_promotion_enabled(true)` on a switched-off promotion and
  `generate_promo_code`, while `set_promotion_enabled(false)` passes; for a manager's
  `upsert_rate_rule` (a new rule, an edit, a switch-off); for a manager's `set_cafe_setting` and
  `set_cafe_settings` changing `featured_discount_pct` to 20, and changing `featured_item_id`
  while the discount is 15, while setting the discount to 0, then moving the item, passes; a
  manager's `hero_mode` → `featured` (from `media`) refused with the stored discount at 15 and
  passing with it at 0, a move from `featured` to `media` or `none` passing with the discount at
  15, and a one-call `set_cafe_settings({featured_discount_pct: 0, hero_mode: 'featured'})`
  passing; the labels, badges, ticker, hero media and bell keys pass as before; the owner passes
  all of them. The
  `set_cafe_settings` pin: the lock reaches it with no re-issue. **Propose-time target checks:** a `price` proposal on a
  never-launched item or one in release, a `shop_launch` proposal on a launched or switched-on
  product, and an `addon_price` proposal naming an add-on at another venue are refused
  `RECORD_INVALID` with hint `menu_item_id` or `addons`, never a menu-writer code, including when
  marketing starts the run. **The change kinds:** each of `price` (with a new size on a cafe
  item, and a new size on a shop product refused `RECORD_INVALID`), `shop_launch` (prices written,
  product switched on, `launched_at` stamped) and `addon_price` (a never-launched add-on switched on
  and stamped, a launched off add-on left off) applied now and on a date; marketing's
  `shop_launch` refused `NOT_STEP_ACTOR` and `price_promo_targets('shop_launch')` refused to
  marketing; `PRICE_TARGET_CHANGED` for a removed size, a `price` item put in release, a
  `shop_launch` product switched on by the owner and one given an extra size after approval; a
  scheduled apply whose target changed reverts with `apply_not_ready` while another due run
  applies. **The round 10 change kinds:** `promotion_edit` applied changes the fields and keeps
  the switch (a live promotion stays on, a switched-off one stays off); `promotion_enable`
  switches one on; a `rate` run creates a new rule and another edits a rule's prices (the old
  prices gone, the booking price at a slot of that rule changed through `price_slot`); a
  `featured_discount` run moves the featured item and sets the discount, and another, with the
  hero on Media and that item and discount already stored, switches the hero to Featured at apply,
  so `add_order_items` charges the approved discount; each started by marketing too, and applied
  now and on a date; `PRICE_TARGET_CHANGED` for a promotion written after the proposal (hint
  `promotion`), a rule edited by the owner after approval (hint `rule`), and a featured item,
  discount or hero mode changed after approval (hint `featured`); propose-time
  `RECORD_INVALID` for a rule with its end before its start (hint `rule.end_time`, never
  `INVALID_TIME_RANGE`), a rule at another venue (hint `rule_id`), a taken promotion code (hint
  `promotion.public_code`), and a `promotion_enable` on a promotion that is on (hint
  `promotion_id`); `price_promo_targets` for the four new kinds carries no cost or sales.
- K: §2.23's tests (the money-free `kitchen_board`, the narrowed policies, the venue conjunct, the
  kitchen RPCs still working, and the guest suites unchanged).
- G: `notify_staff` skips inactive staff and the caller, dedupes shopping pushes; storage policies
  refuse a path without a slot; the three path helpers return NULL or `false` on `items/…`, and an
  authenticated staff user still reads and uploads a `menu-media` object with the staff-media
  policies installed; `app.assistant_readable_columns` has no `staff_media_uploads` row.

### 8.3 Acceptance checklist (EN and AR, local stack first, then hosted after §1.6)

1. Product release: head chef proposes on the phone with photos; the manager accepts with a
   category; the test consumes stock as a product test; the price step goes to the owner, who sends
   it back once, then approves; marketing's step is accepted by the owner; the owner launches now
   from the phone. A second release is scheduled and launches from the cron; a third is stopped at
   the test and its draft item disappears. A fourth, started by the manager with a category,
   passes its proposal at once; a head barista starts one from `/tasks` on the operator. At day 30
   (time-shifted), the manager and the owner get `review_ready` and read the review; the head chef
   who proposed the first one sees it reach done with no figures, on the phone and on `/tasks`, and
   gets no push (#54).
2. Tournament: type 1 with feasibility approved by the owner, courts blocked by the court desk
   from `/tasks` on the operator with one conflict moved first, and its hours shown as an Events
   line in court analytics and on `/reports/courts`, not as occupied or closed (#46, #55); type 2
   passes on the manager alone; type 3 refused without sponsor details.
3. Hiring: open position, candidates, pick, the owner adds the staff member on the phone, run done;
   purge verified with a time-shifted test.
4. Price change started by marketing on the phone, numbers by the manager, approved by the owner,
   applied now; a promotion started on the operator, applied on a date by the cron; a manager's
   direct price edit refused on a launched cafe item, a launched shop product and a launched
   add-on, and allowed on a draft. A manager's new shop product saved hidden and put on sale
   through a `shop_launch` run the owner approves; a manager's new paid add-on saved hidden and put
   on sale through an `addon_price` run; a free option added directly. A manager's "New item" in a
   cafe category is refused and becomes "Propose a new item". Round 10 (#57): on the manager's
   operator, Promotions, Rates and the hero's discount are read-only with their starts; a
   promotion edited, one switched on, a new court rate and a changed one, and a new featured item
   with a discount, each proposed by the manager or marketing, approved by the owner and applied;
   a manager switches a promotion off and the discount to 0 directly.
5. Send back, stop, automatic pass, skip of an optional step and withdraw all seen in both apps.
6. A checklist day ticked on the phone, and the day-close warning on the operator.
7. A shopping run: head chef adds, the driver gets a push, records a purchase with a receipt photo,
   the manager receives it in Goods in; stock is booked once.
8. A production batch on the phone deducts stock and shows in "Made today".
9. A staff push tapped through to the right step; a guest booking push still opens the booking.
10. Staff email sign-in lands on Today; a Google sign-in into a staff email is refused; a switched-off
    account sees the full-screen notice; guest suites and the guest app are unchanged.
11. Every new operator screen shot in EN and AR through the visual-check recipe; every phone
    screen checked by Majed in both languages on a device.
12. Store forms, privacy policy, staff notice and runbook changed in the same release; the App Review
    driver account created by `scripts/create-staff-review-account.mjs` (password generated at run
    time, printed once, deactivated after the decision).
13. The new operator installed on every station before any account holds a new role.
14. How it works (#58): no "Needs my OK" switch on the price step of product release or the
    numbers step of price or promotion change; both still go to the owner after a template save.
15. The kitchen board (#60), after `kitchen_money_reads`: a head chef's and a barista's login shows
    every ticket, item, size, add-on, note and ready mark as before, cloud and in degraded (LAN)
    mode; the same login reads no `tabs`, `orders`, `order_items` or `order_item_modifiers` row
    through a direct query; the till, the desk and the manager's screens read orders as before.

### 8.4 Open facts to check (UNVERIFIED items in one place)

- `storage.objects.owner_id` on the hosted storage version (§2.3 read policy; only 0159's form
  reads it; A's re-issue in `protocols_engine_rpcs` does not).
- `storage.copy` with `destinationBucket` on hosted (§2.20).
- Android blocked permissions on SDK 57, and GPS EXIF after re-encoding (§6.9, §6.10).
- Whether the recipe editor lists inactive (draft) items (§2.9).
- Storage policies and cron rows after the hosted push (NOTICE-only DO blocks).
