# Loyalty (Phase 2 · M3): build contracts, 2026-10-05

Supersedes `PHASE-2-PLAN.md` C6 (§411-421) where they differ, and the C7 `customer_identities`
sketch (Customer 360 was dropped by the client on 2026-09-22). Every lane codes against the names
below; only the integrator changes this file.

## 0. Decisions (Parsa, 2026-10-05)

| #   | Decision                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-1 | Full loyalty: points, tiers, rewards, the web account. Everything ships behind `loyalty_settings.enabled = false` until the client gives the point value, tier names and thresholds (`PHASE-2-CHECKLIST.md` "Loyalty"). |
| L-2 | Duplicate accounts (same phone, or same email) are **merged**, never deleted. The drop account is tombstoned and banned, and its rows move to the keep account.                                                         |
| L-3 | After the one-time merge, a live profile's phone is unique (`profiles.phone_key`). Sign-up never fails on it; a guest edit that collides raises `PHONE_TAKEN`.                                                          |
| L-4 | The member QR is a rotating TOTP token, computed offline on the phone or browser. Staff can also type the phone the guest says (exact match only).                                                                      |
| L-5 | Earn and clawback are triggers on `tabs` and `refunds`. No money RPC is re-issued for earn. Redeem is a `tab_adjustments` discount, not a payment method.                                                               |
| L-6 | No new queued mutation type. Every loyalty write is online-only, like `apply_best_promotion`.                                                                                                                           |
| L-7 | Points are business-wide (shared across branches). Ledger rows carry `venue_id` for reporting.                                                                                                                          |

### 0.1 Decisions of the second review (Parsa, 2026-10-06; migrations 0307–0309)

They amend §1 where they differ; the migration headers carry the detail.

| #    | Decision                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L-8  | **Spending points needs the member's QR or a manager PIN.** `loyalty_redeem(p_tab_id, p_points, p_reward_id, p_idempotency_key, p_member_token)` (0308): the token must name the tab's customer and is spent once (`loyalty_cards.last_counter`, window ±1 step), or the caller spends a manager PIN grant that is not the customer's own. |
| L-9  | Token lookups are throttled (`loyalty_token_attempts`): 10 misses in 10 minutes lock a staff caller, 5 an anonymous café session, and 20 anonymous misses in an hour lock a member code for café sessions only. A miss is answered as data so it commits; an expired token (a real one shown late) is answered but never counted.          |
| L-10 | **Everything earns**: café, shop, court, lesson, tournament and open-match seat tabs, and online payments (`booking_payments` when they succeed; deposit and ticket under `earn_court`, lesson under `earn_lesson`), each behind its own switch. A refund claws back on a cumulative target over the stored `earn_base_iqd`.               |
| L-11 | A manager never adjusts their own points nor gifts active staff; a manager's positive gifts above 1,000 points in a rolling 24 hours (given, or received by the profile) are the owner's, and every manager gift pushes `loyalty_gift` to the owners. Adjustments move the balance only, never `lifetime_earned` or the tier.              |
| L-12 | **`promotions.limits.tierMin` is a `loyalty_tiers` id** (0309), no longer a tier sort; eligibility is `app.promotion_tier_ok` (the customer's tier `min_points_12m` at least the named tier's). A customer change re-checks the tab's promotion and drops it when it no longer qualifies.                                                  |
| L-13 | The nightly expires nothing while loyalty is off and measures inactivity from `greatest(last_activity_at, enabled_at)`; it runs per account and commits per batch (`app.loyalty_nightly_run`).                                                                                                                                             |

## 1. Migrations (staged in `packages/db/.loyalty-staging/`, numbered at landing)

Saeed's `0302_profile_avatar_birth_date` lands first. The loyalty files are:

| File | Name                                           | Owner |
| ---- | ---------------------------------------------- | ----- |
| A    | `0303_account_identity`                        | DB-A  |
| B    | `0304_profiles_phone_unique` (the index only)  | DB-A  |
| C    | `0305_loyalty`                                 | DB-B  |
| D    | `0306_loyalty_promotions` (re-issues and cron) | DB-B  |

Dollar tags are `$<fn>_0NNN$`. While staged they use `_03XX`, and a `sed` at landing gives them their ordinals.

### 1.1 File A: identity

- `profiles.phone_key text`, filled by `app.trg_profile_phone_key` (BEFORE INSERT OR UPDATE OF phone; SECURITY DEFINER; `phone_key := app.phone_canon(new.phone)` when it has 7–15 digits, else null). Backfilled in the file.
- `app.profile_merges` (`id uuid pk`, `keep_id uuid`, `drop_id uuid`, `reason text`, `moved jsonb`, `actor_id uuid null`, `created_at`). No FK on `drop_id`. RLS is on, with select for `app.is_staff('manager','owner')` and no writes except the definer functions.
- `app.merge_profiles_internal(p_keep uuid, p_drop uuid, p_reason text) returns jsonb`. Granted to nobody. Refuses with `MERGE_REFUSED` (detail `staff_both` | `coach_both` | `same` | `missing`). It re-points every FK of plan §3.2 and the loyalty tables, and resolves unique collisions by deleting the drop's row. It moves `birth_date`, names, gender and terms when keep's are null. It does **not** copy `avatar_path`. Auth handling: email or phone move across when keep's slot is empty (cleared on drop first), `auth.identities` move per missing provider, and the drop gets `banned_until = 'infinity'`. The drop is then tombstoned as in `delete_my_account`. Finally it recomputes `loyalty_accounts` for keep when file C exists (call through `to_regprocedure`, so file A does not depend on C), and writes `profile_merges` and `audit_log`.
- `app.duplicate_account_groups() returns jsonb`: owner only. `[{key, kind:'phone'|'email', profiles:[{id, name, phone, email, created_at, staff, coach, synthetic, activity}]}]`.
- `app.merge_accounts(p_keep uuid, p_drop uuid, p_reason text) returns jsonb`: owner, behind a manager PIN grant (0115 pattern).
- The one-time `do` block uses this keep order: staff or coach row, then a confirmed auth phone equal to the number, then not `@guest.touch.local`, then the most `reservations` + `tabs.customer_id` rows, then the oldest `created_at`. A refused pair gets `phone := null` on the newer one and `reason = 'phone_cleared_conflict'`. The block always completes.
- `handle_new_user` is re-issued from its latest body (0256:180). A phone whose key is held by a live profile:
  - **Holder is synthetic and the new user has `phone_confirmed_at`:** insert the profile, then `merge_profiles_internal(new, holder, 'walkin_claim')`.
  - **Anything else:** insert with `phone = null`.
- An update of `profiles.phone` that hits the index surfaces as `PHONE_TAKEN`. A BEFORE UPDATE check in `trg_profile_phone_key` raises it before the index does.

### 1.2 File B

`create unique index if not exists profiles_phone_key_live on profiles (phone_key) where deleted_at is null and phone_key is not null;`

### 1.3 File C: loyalty

The tables are in plan §3.4. Pinned columns:

- `loyalty_settings`: `id boolean pk default true check (id)`, `enabled bool default false`, `iqd_per_point int default 1000 check (>0)`, `point_value_iqd int default 50 check (>0)`, `min_redeem_points int default 100 check (>=0)`, `earn_cafe/earn_shop/earn_court/earn_lesson/earn_tournament bool default true`, `inactivity_expiry_months int null`, `totp_step_seconds int default 30 check (between 15 and 120)`, `updated_at`, `updated_by`.
- `loyalty_tiers`: `id`, `name_en`, `name_ar`, `min_points_12m int unique`, `earn_multiplier numeric(3,2) default 1 check (between 1 and 5)`, `promotion_id uuid null references promotions`, `sort smallint unique`. Seed: `('Member','عضو',0,1.00,null,0)`.
- `loyalty_rewards`: `id`, `name_en`, `name_ar`, `cost_points int > 0`, `kind text check in ('iqd_off','item')`, `iqd_off int null`, `menu_variant_id uuid null`, `active bool default true`, `venue_id uuid null` (null means every branch), `created_at`. Check: `iqd_off` is set for `iqd_off`, `menu_variant_id` is set for `item`.
- `loyalty_cards`: `profile_id uuid pk references profiles`, `member_code text unique check (~ '^[0-9A-HJKMNP-TV-Z]{8}$')`, `secret bytea not null check (length = 20)`, `created_at`, `rotated_at`. No client select; reads go through `my_member_card`.
- `loyalty_ledger`: `id`, `profile_id references profiles`, `venue_id null`, `delta int <> 0`, `kind text check in ('earn','redeem','redeem_void','reward','adjust','clawback','expire','merge_in')`, `source_kind text`, `source_id uuid`, `tab_id uuid null`, `actor_id uuid null`, `note text null`, `created_at`. `unique (kind, source_kind, source_id)`. `app.trg_loyalty_ledger_immutable` refuses UPDATE and DELETE, except the merge's `profile_id` re-point, which the definer flags with `set_config('app.loyalty_merge','on',true)`.
- `loyalty_accounts`: `profile_id pk`, `balance int`, `lifetime_earned int`, `points_12m int`, `tier_id uuid`, `last_activity_at`, `updated_at`. Maintained by `app.trg_loyalty_account_apply` (AFTER INSERT on the ledger, upsert) and `app.loyalty_recompute(p_profile uuid)`.
- `tabs.customer_id uuid null references profiles(id)`, plus `tabs_customer_idx` in the same file (waiver line in the PR body, or put it in B. **Ruling: put it in file B** with the phone index).

**Customer of a tab** (`app.tab_customer(p_tab_id) returns uuid`, internal): `coalesce(tabs.customer_id, reservations.guest_id via tabs.reservation_id, the latest guest_web order's guest_sessions.linked_profile_id)`. Deleted profiles count as null.

**Earn** (`app.trg_loyalty_earn`, AFTER UPDATE OF status ON tabs, `new.status = 'settled' and old.status <> 'settled'`). Earn is skipped when the settings are disabled or there is no customer.

- `paid = sum(payments.amount_iqd where tab_id)`
- `court = least(tabs.court_iqd, paid)`
- The rest is assigned to the tab's own kind:

  | `tabs.kind`             | Base           | Switch            |
  | ----------------------- | -------------- | ----------------- |
  | `cafe`                  | `paid − court` | `earn_cafe`       |
  | `shop`                  | `paid`         | `earn_shop`       |
  | `lesson`                | `paid`         | `earn_lesson`     |
  | `tournament`            | `paid`         | `earn_tournament` |
  | court portion (any tab) | `court`        | `earn_court`      |

- `points = floor(eligible / iqd_per_point * tier.earn_multiplier)`
- When `points > 0`: `insert … ('earn','tab',tab_id) on conflict do nothing`.

**Clawback** (`app.trg_loyalty_clawback`, AFTER INSERT ON refunds): the tab comes from `payments.tab_id`. `earned` is that tab's earn row. `claw = ceil(earned * refund.amount / paid)`, capped at `earned − sum(earlier clawbacks for the tab)`. Writes `('clawback','refund',refund_id)` with a negative delta.

**Lock order:** `… → refunds → … → loyalty_accounts` is appended **last** (after `match_tickets`) in `packages/db/CLAUDE.md` and in `scripts/lib/lock-order.mjs`. The ledger is insert-only, so it is not ranked.

**TOTP** (RFC 6238, SHA-1, 6 digits):

- `counter = floor(epoch_seconds / step)`.
- `app.loyalty_totp(p_secret bytea, p_counter bigint) returns text`, internal and immutable.
- Verification accepts `counter ± 2`.
- Token format: `TP-<member_code>-<6 digits>`, regex `^TP-[0-9A-HJKMNP-TV-Z]{8}-[0-9]{6}$`. Input is uppercased and trimmed.
- The secret goes to the client as RFC 4648 base32 with no padding (32 characters).

**RPCs** (`app.` schema; arguments are always sent, nulls included):

| RPC                     | Args → returns                                                                                                                                                                                                                                                                            | Grant / guard                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `my_loyalty`            | `()` → `{enabled, balance, lifetime, points_12m, tier:{id,name_en,name_ar,multiplier}, next_tier:{…, min_points_12m}\|null, point_value_iqd, min_redeem_points, history:[{id,kind,delta,venue_id,created_at,note}] (50 newest), rewards:[{id,name_en,name_ar,cost_points,kind,iqd_off}]}` | authenticated, not anonymous, live profile                                                                                                                                                                                          |
| `my_member_card`        | `()` → `{member_code, secret_b32, step}` (lazily creates the card)                                                                                                                                                                                                                        | same                                                                                                                                                                                                                                |
| `rotate_member_card`    | `()` → same shape                                                                                                                                                                                                                                                                         | same                                                                                                                                                                                                                                |
| `loyalty_identify`      | `(p_code text, p_venue_id uuid)` → `{customer_id, display_name, phone_masked, tier_name_en, tier_name_ar, balance, enabled}`                                                                                                                                                              | `app.is_staff('cashier','shop_staff','court_desk','manager','owner')`, venue visible. Errors `MEMBER_CODE_INVALID`, `MEMBER_CODE_EXPIRED`, `MEMBER_NOT_FOUND`. Writes an `audit_log` row (`loyalty.identify`, method `qr`\|`phone`) |
| `set_tab_customer`      | `(p_tab_id uuid, p_customer_id uuid)` → `{tab_id, customer_id}` (null clears)                                                                                                                                                                                                             | same roles + `app.assert_tab_kind_role`. `TAB_NOT_OPEN` on a non-open tab; `MEMBER_NOT_FOUND` for a deleted or unknown profile                                                                                                      |
| `loyalty_redeem`        | `(p_tab_id uuid, p_points int, p_reward_id uuid, p_idempotency_key text)` (0308: plus `p_member_token text`, L-8) → `{adjustment_id, points, amount_iqd, balance}`. Exactly one of points or reward                                                                                       | same roles. `LOYALTY_OFF`, `NO_CUSTOMER`, `POINTS_BELOW_MIN`, `POINTS_INSUFFICIENT`, `REWARD_NOT_FOUND`, `TAB_NOT_OPEN`; `amount_iqd` capped at the tab remaining (points rounded down to fit); `claim_replay`                      |
| `loyalty_unredeem`      | `(p_adjustment_id uuid)` → `{balance}`                                                                                                                                                                                                                                                    | same roles. Open tab only; deletes the adjustment and writes `redeem_void`                                                                                                                                                          |
| `loyalty_adjust`        | `(p_profile_id uuid, p_delta int, p_reason text)` → `{balance}`                                                                                                                                                                                                                           | manager/owner + PIN grant; `REASON_REQUIRED`                                                                                                                                                                                        |
| `loyalty_customer`      | `(p_profile_id uuid)` → `{balance, lifetime, points_12m, tier, history[100]}`                                                                                                                                                                                                             | staff (all desk roles)                                                                                                                                                                                                              |
| `loyalty_admin`         | `()` → `{settings, tiers[], rewards[]}`                                                                                                                                                                                                                                                   | manager/owner                                                                                                                                                                                                                       |
| `set_loyalty_settings`  | `(p_patch jsonb)` → settings                                                                                                                                                                                                                                                              | owner                                                                                                                                                                                                                               |
| `upsert_loyalty_tier`   | `(p_tier jsonb)` → tier                                                                                                                                                                                                                                                                   | owner                                                                                                                                                                                                                               |
| `delete_loyalty_tier`   | `(p_tier_id uuid)` → void                                                                                                                                                                                                                                                                 | owner; the sort-0 base tier is refused (`INVALID_ARGUMENT`)                                                                                                                                                                         |
| `upsert_loyalty_reward` | `(p_reward jsonb)` → reward                                                                                                                                                                                                                                                               | owner                                                                                                                                                                                                                               |
| `link_guest_session`    | `(p_member_token text)` → `{linked:true, display_name}`                                                                                                                                                                                                                                   | authenticated anonymous user with a live `guest_sessions` row; token verify; `MEMBER_CODE_INVALID` \| `MEMBER_CODE_EXPIRED`                                                                                                         |

Redeem adjustment row: `kind 'discount_amount'`, `value = points`, `amount_iqd = points*point_value_iqd` (reward: `iqd_off` or the variant price, capped), `applied_by = authorized_by = caller staff`, `reason_code 'loyalty_points' | 'loyalty_reward'`. Ledger: `('redeem'|'reward','tab_adjustment',adjustment_id, tab_id)`.

### 1.4 File D

- Re-issue `eligible_promotions` (latest 0212:143) and `apply_best_promotion` (latest 0217:851) from their latest bodies. Customer = `app.tab_customer(tab)`. `limits.tierMin` (int, tier sort) is eligible only when the customer's tier sort is at least that value. _Superseded by 0309 (L-12): `tierMin` is a tier id._
- Re-issue `delete_my_account` (latest 0290:1329): delete `loyalty_cards` and `loyalty_accounts` for the caller.
- `app.loyalty_nightly()`: reconcile the cache, recompute 12-month points and tier, apply inactivity expiry. Run by cron `tp_loyalty_nightly` at `15 0 * * *` UTC.

## 2. Error codes (new)

`PHONE_TAKEN`, `MERGE_REFUSED`*, `MEMBER_CODE_INVALID`, `MEMBER_CODE_EXPIRED`, `MEMBER_NOT_FOUND`, `NO_CUSTOMER`, `LOYALTY_OFF`, `POINTS_INSUFFICIENT`, `POINTS_BELOW_MIN`, `REWARD_NOT_FOUND`, `TAB_NOT_OPEN` (reused if it already exists). * carries a detail.

Reused: `FORBIDDEN`, `INVALID_ARGUMENT`, `REASON_REQUIRED`, `PIN_GRANT_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `VENUE_MISMATCH`, `MATCH_BOOKING_NO_CAFE`.

## 3. Shared TS (`packages/core/src/loyalty/`, exported as `@touch/core/loyalty`)

- `totp.ts`:
  - `base32Decode(s)`
  - `hotp(secret: Uint8Array, counter: number): string`
  - `memberToken(card: {member_code, secret_b32, step}, nowMs): {token, secondsLeft}`
  - `parseMemberInput(raw): {kind:'token', code, otp} | {kind:'phone', digits} | {kind:'invalid'}`
  - `MEMBER_TOKEN_RE`
  - HMAC-SHA1 is pure TS in `sha1.ts` (no new dependency; Hermes has no `crypto.subtle`), tested against the RFC 6238 vectors.
- `qr.ts`: `qrModules(text)`, `qrPath(modules)`, `QR_INK`, `QR_PAPER`, `QUIET_MODULES`, moved from `apps/operator/src/features/admin/qr/qrCardGeometry.ts`, which re-exports them.
- `points.ts`: `earnPoints({kind, paid, court, settings, multiplier})`, `redeemAmount({points, pointValue, remaining})`.
- Shapes, `types.ts`: `MyLoyalty`, `MemberCard`, `IdentifiedMember`, `LoyaltyAdmin`, `LedgerRow` (as §1.3).

## 4. i18n key roots

- `loyalty.guest.{card.*, home.*, history.kind.*, rewards.*, tier.*, off}`
- `loyalty.web.{account.*, signIn.*, cafeChip.*}`
- `ws.loyalty.{member.*, redeem.*, rewards.*, panel.*, adjust.*, setup.*}`
- `op.errors.<CODE>` and the mobile/web error maps for every §2 code.

Arabic is drafted and marked DRAFT-AR.

## 5. File ownership

| Lane       | Files                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integrator | this file; `packages/i18n/src/errors.ts` + catalog stubs; `packages/core/src/loyalty/*` + its export; provisional `types.gen.ts`; `rls-matrix.ts`; `rpc-allowlist.json`; `stored-fields.test.ts`; lock-order docs; final types, assistant coverage + map, registry floor, paperwork |
| DB-A       | staged files A and B; `tests/account-merge.test.ts` (including the FK-coverage guard over `pg_constraint`)                                                                                                                                                                          |
| DB-B       | staged files C and D; `tests/loyalty.test.ts`; `tests/loyalty-totp-parity.test.ts`; `scripts/lib/lock-order.mjs` rank                                                                                                                                                               |
| W-MOB      | `apps/mobile/app/{member-card,loyalty}.tsx`, `src/features/loyalty/*`, profile card and row, the `PHONE_TAKEN` map, smoke                                                                                                                                                           |
| W-WEB      | `apps/web` account client factory, `/[locale]/account`, café chip, tests, e2e `site-account.spec.ts`                                                                                                                                                                                |
| W-OP       | `apps/operator/src/features/loyalty/*`, the till/shop/booking-bill hooks, the customer record panel, Setup › Loyalty, e2e `operator-loyalty.spec.ts`                                                                                                                                |
