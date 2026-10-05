set lock_timeout = '3s';
set statement_timeout = '60s';

-- loyalty_promotions — Phase 2 milestone 3, staged file D
-- (docs/design/loyalty/build-contracts-2026-10-05.md §1.4; plan §3.5).
--
--   1. Two indexes: tabs_customer_idx (contracts §1.3 put it in file B, but
--      file B runs before file C creates tabs.customer_id, so it is here)
--      and loyalty_ledger_profile (the history reads and the recompute).
--   2. eligible_promotions (latest 0212:143) and apply_best_promotion (latest
--      0217:851), verbatim plus the marked 0306 lines: the customer is
--      app.tab_customer, and a promotion whose limits carry tierMin (a tier's
--      sort) is eligible only while loyalty is on and the customer's tier is
--      at least that one. That is how a tier's benefit reaches the bill: the
--      existing pricing path, no new discount route.
--   3. delete_my_account (latest 0290:1329), verbatim plus the marked lines:
--      the account's member card and points cache go; ledger rows stay on the
--      tombstone.
--   4. app.loyalty_nightly() and the cron row tp_loyalty_nightly
--      ('15 0 * * *' UTC): the cache reconciled against the ledger, the
--      12-month points and tiers recomputed, inactivity expiry applied.
--
-- Plain CREATE INDEX, not CONCURRENTLY: loyalty_ledger is new and empty, and
-- tabs_customer_idx is partial on a column file C added (null on every row,
-- so the index is empty), though it still takes SHARE on tabs for one scan
-- under lock_timeout 3s. The waiver goes in the commit message:
--   MIGRATION-RISK-ACCEPTED: a new empty table, plus a partial index on tabs
--   whose predicate matches no row today
-- and `MIGRATION_RISK_ACCEPTED=... node scripts/check-migrations.mjs` is run
-- before the push (0279 precedent).

-- ===========================================================================
-- 1. Indexes
-- ===========================================================================
create index if not exists tabs_customer_idx on tabs (customer_id) where customer_id is not null;
create index if not exists loyalty_ledger_profile on loyalty_ledger (profile_id, created_at desc);

-- ===========================================================================
-- 2. Promotions: the tab's customer and tierMin
-- ===========================================================================

-- eligible_promotions: re-issued from 20260926000212_degraded_promotions_telegram_per_venue.sql:143
create or replace function app.eligible_promotions(p_tab_id uuid, p_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $eligible_promotions_0306$
declare
  v_tab      tabs%rowtype;
  v_court_id uuid;
  v_customer uuid;
  v_totals   record;
  v_gross    bigint;
  v_local    timestamp;
  v_dow      int;
  v_time     time;
  v_code     text := nullif(upper(btrim(p_code)), '');
  p          promotions%rowtype;
  v_base     bigint;
  v_amount   bigint;
  v_limit    bigint;
  v_out      jsonb := '[]'::jsonb;
  v_sorted   jsonb;
  v_on       boolean;   -- 0306 (loyalty)
  v_tier     int;       -- 0306 (loyalty)
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_code is not null and not exists (select 1 from promotions x where x.public_code = v_code) then
    raise exception 'CODE_INVALID' using errcode = 'P0001', detail = v_code;
  end if;

  if v_tab.reservation_id is not null then
    select r.court_id into v_court_id
      from reservations r where r.id = v_tab.reservation_id;
  end if;

  -- 0306 (loyalty): the customer is app.tab_customer (the attached guest, the
  -- booking's guest, or a linked café session's profile), and the tier the
  -- customer's points reach decides limits.tierMin (the tier's sort; no
  -- account yet is the base tier, sort 0).
  v_customer := app.tab_customer(p_tab_id);
  v_on := coalesce((select s.enabled from loyalty_settings s where s.id), false);
  v_tier := coalesce((select t.sort from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id
                       where a.profile_id = v_customer), 0);

  -- Gross = goods subtotal + court fee (what the guest is spending before any
  -- discount). The discount BASE is narrower (goods only; see promotion_base_iqd).
  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_gross := coalesce(v_totals.subtotal_iqd, 0) + coalesce(v_totals.court_iqd, 0);

  v_local := now() at time zone coalesce((select vs.timezone from venue_settings vs
                                            where vs.venue_id = v_tab.venue_id), 'Asia/Baghdad');
  v_dow   := extract(dow from v_local)::int;
  v_time  := v_local::time;

  for p in
    select pr.*
      from promotions pr
     where pr.enabled
       and (pr.venue_id is null or pr.venue_id = v_tab.venue_id)   -- 0212 (MV2)
       and (pr.starts_at is null or pr.starts_at <= now())
       and (pr.ends_at   is null or pr.ends_at   >  now())
       and (coalesce(array_length(pr.weekdays, 1), 0) = 0 or v_dow = any(pr.weekdays))
       and (pr.hour_from is null
            or (pr.hour_from < pr.hour_to and v_time >= pr.hour_from and v_time < pr.hour_to)
            or (pr.hour_from > pr.hour_to and (v_time >= pr.hour_from or v_time < pr.hour_to)))
       and (pr.auto or (v_code is not null and pr.public_code = v_code))
       and (jsonb_typeof(pr.scope->'courtIds') is distinct from 'array'
            or jsonb_array_length(pr.scope->'courtIds') = 0
            or (v_court_id is not null and (pr.scope->'courtIds') ? v_court_id::text))
     order by pr.created_at, pr.id
  loop
    -- Redemptions on OTHER tabs: this tab's own current promotion is about to
    -- be replaced by any apply, so it must never block a re-apply.
    if not p.auto and p.code_single_use and exists (
         select 1 from promotion_redemptions r
          where r.promotion_id = p.id and r.tab_id <> p_tab_id) then
      continue;
    end if;

    v_limit := (p.limits->>'total')::bigint;
    if v_limit is not null and (
         select count(*) from promotion_redemptions r
          where r.promotion_id = p.id and r.tab_id <> p_tab_id) >= v_limit then
      continue;
    end if;

    v_limit := (p.limits->>'perCustomer')::bigint;
    if v_limit is not null then
      -- A per-customer cap needs a customer: a tab with no identified guest
      -- cannot be counted, so it is not eligible (the strict reading).
      if v_customer is null then
        continue;
      end if;
      if (select count(*) from promotion_redemptions r
           where r.promotion_id = p.id and r.customer_id = v_customer and r.tab_id <> p_tab_id)
         >= v_limit then
        continue;
      end if;
    end if;

    -- 0306 (loyalty): a tier promotion needs loyalty on, a customer, and that
    -- customer's tier at least limits.tierMin.
    if p.limits ? 'tierMin' then
      if not v_on or v_customer is null or v_tier < (p.limits->>'tierMin')::int then
        continue;
      end if;
    end if;

    v_limit := (p.limits->>'minSpendIqd')::bigint;
    if v_limit is not null and v_gross < v_limit then
      continue;
    end if;

    v_base   := app.promotion_base_iqd(p_tab_id, p.scope);
    v_amount := app.promotion_amount_iqd(v_base, p.type, p.value);
    if v_amount < 1 then
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'promotionId', p.id,
      'name_en',     p.name_en,
      'name_ar',     p.name_ar,
      'type',        p.type,
      'value',       p.value,
      'amountIqd',   v_amount);
  end loop;

  select coalesce(jsonb_agg(t.e order by (t.e->>'amountIqd')::bigint desc, t.ord), '[]'::jsonb)
    into v_sorted
    from jsonb_array_elements(v_out) with ordinality as t(e, ord);
  return v_sorted;
end $eligible_promotions_0306$;

revoke all on function app.eligible_promotions(uuid, text) from public, anon;
grant execute on function app.eligible_promotions(uuid, text) to authenticated;

comment on function app.eligible_promotions(uuid, text) is
  '0067, 0212 (MV2), loyalty 0306. Cashier, manager, owner: the promotions a tab is eligible for now, best first ({promotionId, name_en, name_ar, type, value, amountIqd}). The customer (perCustomer, tierMin) is app.tab_customer. limits.tierMin (a tier''s sort) needs loyalty on, a customer, and the customer''s tier sort at least that value (no account = the base tier, 0). CODE_INVALID for an unknown code.';

-- apply_best_promotion: re-issued from 20260926000217_cross_venue_guards.sql:851
create or replace function app.apply_best_promotion(
  p_tab_id          uuid,
  p_code            text default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_best_promotion_0306$
declare
  v_venue uuid;
  v_tab       tabs%rowtype;
  v_replay    jsonb;
  v_elig      jsonb;
  v_best      jsonb;
  v_promo     promotions%rowtype;
  v_code      text := nullif(upper(btrim(p_code)), '');
  v_code_id   uuid;
  v_customer  uuid;
  v_amount    bigint;
  v_old_red   promotion_redemptions%rowtype;
  v_old_adj   tab_adjustments%rowtype;
  v_adj       tab_adjustments%rowtype;
  v_red       promotion_redemptions%rowtype;
  v_replaced  uuid;
  v_paid      bigint;
  v_new_total bigint;
  v_result    jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'apply_best_promotion');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_elig := app.eligible_promotions(p_tab_id, p_code);   -- raises CODE_INVALID

  -- A known code that is not eligible right now (expired, used up, wrong day,
  -- below minimum spend) is named rather than silently replaced by whatever
  -- auto promotion happens to be best: the cashier is holding a guest's code.
  if v_code is not null then
    select x.id into v_code_id from promotions x where x.public_code = v_code;
    if not exists (select 1 from jsonb_array_elements(v_elig) e
                    where (e->>'promotionId')::uuid = v_code_id) then
      raise exception 'CODE_NOT_ELIGIBLE' using errcode = 'P0001', detail = v_code;
    end if;
  end if;

  if jsonb_array_length(v_elig) = 0 then
    raise exception 'NO_ELIGIBLE_PROMOTION' using errcode = 'P0001';
  end if;

  v_best   := v_elig->0;
  v_amount := (v_best->>'amountIqd')::bigint;
  select * into v_promo from promotions where id = (v_best->>'promotionId')::uuid;

  -- 0306 (loyalty): the redemption's customer is the tab's (app.tab_customer),
  -- the same one eligible_promotions counted perCustomer and tierMin against.
  v_customer := app.tab_customer(p_tab_id);

  -- Replace the earlier promotion on this tab (one per tab). Same promotion,
  -- same amount: nothing has changed, so nothing is rewritten.
  select * into v_old_red from promotion_redemptions where tab_id = p_tab_id;
  if found then
    select * into v_old_adj from tab_adjustments where id = v_old_red.adjustment_id;
    if v_old_red.promotion_id = v_promo.id and v_old_adj.amount_iqd = v_amount then
      v_result := jsonb_build_object('promotionId', v_promo.id, 'amountIqd', v_amount,
        'adjustmentId', v_old_adj.id, 'replacedPromotionId', null, 'unchanged', true);
      perform app.finish_replay(p_idempotency_key, v_result);
      return v_result;
    end if;
    v_replaced := v_old_red.promotion_id;
    delete from promotion_redemptions where id = v_old_red.id;
    -- By promotion_id, not by adjustment id alone: any stray promotion row on
    -- this tab goes with it, so the partial unique index cannot refuse the insert.
    delete from tab_adjustments where tab_id = p_tab_id and promotion_id is not null;
    perform app.write_audit('promotion.replace', 'tab_adjustments', v_old_adj.id::text,
                            to_jsonb(v_old_adj) || jsonb_build_object('redemption', to_jsonb(v_old_red)),
                            null, 'promotion', v_promo.created_by, p_device_id);
  end if;

  -- authorized_by = the manager who configured the promotion (created_by):
  -- the configuration is the authorisation, and day close names that person.
  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code, promotion_id)
  values (p_tab_id, null,
          case when v_promo.type = 'percent' then 'discount_percent'::adjustment_kind
               else 'discount_amount'::adjustment_kind end,
          case when v_promo.type = 'percent' then v_promo.value * 100   -- basis points, as apply_discount stores
               else v_promo.value end,
          v_amount, auth.uid(), v_promo.created_by, 'promotion', v_promo.id)
  returning * into v_adj;

  insert into promotion_redemptions (promotion_id, tab_id, adjustment_id, customer_id,
                                     amount_iqd, code_used, idempotency_key, redeemed_by)
  values (v_promo.id, p_tab_id, v_adj.id, v_customer, v_amount,
          case when v_promo.auto then null else v_code end, p_idempotency_key, auth.uid())
  returning * into v_red;

  -- DISCOUNT-AFTER-PAYMENT GUARD (0037), verbatim shape. An 'open' tab has
  -- normally taken nothing, but the guard is cheap and the invariant matters.
  v_paid := app.tab_net_paid(p_tab_id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(p_tab_id) t;
    if v_new_total < v_paid then
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-promotion total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before applying a promotion';
    end if;
  end if;

  perform app.write_audit('promotion.apply', 'tab_adjustments', v_adj.id::text,
                          null, to_jsonb(v_adj) || jsonb_build_object('redemption', to_jsonb(v_red)),
                          'promotion', v_promo.created_by, p_device_id);

  v_result := jsonb_build_object('promotionId', v_promo.id, 'amountIqd', v_amount,
    'adjustmentId', v_adj.id, 'replacedPromotionId', v_replaced, 'unchanged', false);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $apply_best_promotion_0306$;

revoke all on function app.apply_best_promotion(uuid, text, text, text) from public, anon;
grant execute on function app.apply_best_promotion(uuid, text, text, text) to authenticated;

comment on function app.apply_best_promotion(uuid, text, text, text) is
  '0067, 0217, loyalty 0306. Cashier, manager, owner at the tab''s branch: applies the best eligible promotion (app.eligible_promotions) to an open tab, replacing the tab''s earlier one; the redemption''s customer is app.tab_customer.';

-- ===========================================================================
-- 3. delete_my_account: the card and the cache
-- ===========================================================================

-- delete_my_account: re-issued from 20261002000290_coaching_admin_fixes.sql:1329
create or replace function app.delete_my_account(p_confirm text default null)
returns jsonb
language plpgsql security definer set search_path = public as $delete_my_account_0306$
declare
  v_uid          uuid := auth.uid();
  v_profile      profiles%rowtype;
  v_apple        boolean;
  v_reservations int;
  v_series       int;
  v_notes        int;
  v_flags        int;
  v_outbox       int;
  v_seats        int;
  v_requests     int;
  v_blocks       int;
  v_links        int;
  v_enrolments   int;
  v_photos       int;
  v_coach        int;
  v_time_off     int;
  v_loyalty      int;   -- 0306 (loyalty)
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- An anonymous café session has no account to delete: handle_new_user (0004)
  -- returns early for is_anonymous, so no profiles row was ever created.
  --
  -- This guard is also what keeps check-rpc-authz.mjs safe. That sweep calls
  -- EVERY RPC granted to `authenticated` with NULL arguments as a real
  -- anonymous guest. Without a refusal on its first line, the authorization
  -- gate would delete the account it probes with, on every run.
  select * into v_profile from profiles where id = v_uid;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Staff are deactivated, never deleted: staff.id -> auth.users is ON DELETE
  -- RESTRICT (0004), and audit_log.actor_id, staff.created_by and
  -- reservations.created_by_staff_id all point at them. Without this the call
  -- would reach the delete and fail there with a raw 23503.
  if exists (select 1 from staff where id = v_uid) then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = 'staff accounts are deactivated, not deleted';
  end if;

  if v_profile.deleted_at is not null then
    raise exception 'ALREADY_DELETED' using errcode = 'P0001';
  end if;

  -- Irreversible, and reachable by anything holding the guest's JWT. The
  -- explicit token means a stray retry or an injected fetch cannot spend the
  -- account by calling a bare zero-argument RPC.
  if p_confirm is distinct from 'DELETE' then
    raise exception 'CONFIRMATION_REQUIRED' using errcode = 'P0001',
      hint = 'call with p_confirm => ''DELETE''';
  end if;

  -- Apple requires POST https://appleid.apple.com/auth/revoke when an account
  -- offering Sign in with Apple is deleted. The .p8 key does not exist yet
  -- (blocked on Apple Developer enrolment), so the obligation is RECORDED
  -- rather than silently skipped — the deletion itself must not be held hostage
  -- to a missing credential.
  select exists (select 1 from auth.identities
                  where user_id = v_uid and provider = 'apple')
    into v_apple;

  -- --- the anonymisation ----------------------------------------------------
  --
  -- Everything below removes a column that names or reaches a PERSON. Columns
  -- carrying business value — times, prices, courts, statuses, totals — are
  -- deliberately untouched, which is the entire point of retaining the row.

  -- The profile itself. expo_push_token is cleared here (SEC-21: cleared on
  -- deletion), which is also the only remaining way to reach the device.
  -- 0264: the two name parts and the three gender columns (0256) go too.
  -- profiles_sync_names empties them on the tombstone anyway; naming them
  -- here keeps the erasure readable in one place (the three gender columns
  -- together, as profiles_gender_stamp requires).
  update profiles
     set full_name       = 'Deleted account',
         phone           = null,
         expo_push_token = null,
         given_name      = null,
         family_name     = null,
         gender          = null,
         gender_set_at   = null,
         gender_set_by   = null,
         deleted_at      = now()
   where id = v_uid;

  -- Denormalised identity on the booking rows. THIS IS THE HALF THAT IS EASY TO
  -- MISS: reservations and reservation_series each carry their OWN guest_name
  -- and guest_phone beside guest_id, and nothing constrains the two to be
  -- mutually exclusive — app.confirm_booking writes
  -- `guest_name = coalesce(p_guest_name, guest_name)` whatever guest_id holds,
  -- and app.create_series takes p_guest_name the same way.
  --
  -- No client ships that argument TODAY: the mobile app calls confirm_booking
  -- with p_hold_id alone, so an app-made booking leaves both columns null, and
  -- only the test suite currently passes a name alongside a guest_id. The desk
  -- surface that would do it for a walk-in with an account is the obvious next
  -- feature. Scrubbing here is therefore mostly forward defence — but it is the
  -- difference between a deletion that stays complete and one that silently
  -- stops being complete the day that screen is built, which is exactly the
  -- kind of regression nobody re-audits.
  update reservations
     set guest_name = null, guest_phone = null, notes = null, device_id = null
   where guest_id = v_uid;
  get diagnostics v_reservations = row_count;

  update reservation_series
     set guest_name = null, guest_phone = null, notes = null
   where guest_id = v_uid;
  get diagnostics v_series = row_count;

  -- Records ABOUT the person, with no aggregate value: staff free text and
  -- labels, and queued notifications addressed to a device that is now
  -- unreachable. These used to CASCADE from profiles; now that the profile row
  -- survives, they have to be removed explicitly or they would outlive it.
  delete from customer_notes where customer_id = v_uid;
  get diagnostics v_notes = row_count;

  delete from customer_flags where customer_id = v_uid;
  get diagnostics v_flags = row_count;

  -- --- open matches (0264; db.md §4.9, R25, R29) ----------------------------
  --
  -- The seats and requests stay: they are the matches' history, and the sweep
  -- (0263) moves the live ones. What goes is what describes the person. Every
  -- seat that names the player (account seats, the friend seats they hold,
  -- linked desk seats) loses the gender it was taken with; a seat with a
  -- guest_id never holds a typed name or phone (match_seats_kind), and both are
  -- named anyway so the erasure reads the same as the booking rows above.
  -- Written outside the branch mutex on purpose (db.md §2.1): no match state
  -- reads these columns. Only rows that still hold something are touched, so
  -- a player's finished seats are not locked for nothing.
  update match_seats
     set guest_name = null, guest_phone = null, gender = null
   where guest_id = v_uid
     and (guest_name is not null or guest_phone is not null or gender is not null);
  get diagnostics v_seats = row_count;

  -- The genders the player declared for friends (R29).
  update match_requests
     set friend_genders = null
   where guest_id = v_uid
     and friend_genders is not null;
  get diagnostics v_requests = row_count;

  -- A block is a list of people kept by a person: both directions go (the
  -- blocker's own list, and the entries that name this account).
  delete from match_blocks where blocker_id = v_uid or blocked_id = v_uid;
  get diagnostics v_blocks = row_count;

  -- --- coaching (0289; db.md §4.10, CD-12, C-21, C-29, R43, R44, R63) -------
  --
  -- Written outside every coach lock on purpose (db.md §2.4 rule 7): no
  -- coaching state reads these columns, and lesson_sweep (0286) cancels the
  -- live enrolments and a retired coach's lessons within a minute, with
  -- refunds and pushes.

  -- A pending link (C-21): a coach or the desk typed a phone that matched this
  -- account and nobody confirmed it. It goes as "Not me" takes it: guest_id
  -- NULL, silently, the coach's typed student kept as typed, so the roster
  -- never learns that the phone had matched an account (R10, R44).
  update lesson_enrolments
     set guest_id = null, updated_at = now()
   where guest_id = v_uid
     and booked_by_kind <> 'guest'
     and link_confirmed_at is null;
  get diagnostics v_links = row_count;

  -- The account's own enrolments and confirmed links: a typed name keeps a
  -- fixed marker (lesson_enrolments_typed requires one on a coach- or
  -- desk-booked row; NULL would let a reader fall back to the account), the
  -- typed phone and the friend names go (SEC-20: guest_name anonymise,
  -- guest_phone scrub, friend_names empty). Only rows that still hold
  -- something are touched.
  update lesson_enrolments
     set guest_name   = case when booked_by_kind = 'guest' then null else 'Deleted account' end,
         guest_phone  = null,
         friend_names = '{}'::text[],
         updated_at   = now()
   where guest_id = v_uid
     and (guest_phone is not null
          or cardinality(friend_names) > 0
          or (booked_by_kind <> 'guest' and guest_name is distinct from 'Deleted account')
          or (booked_by_kind = 'guest' and guest_name is not null));
  get diagnostics v_enrolments = row_count;

  -- 0290 (DB-03): the account's coach rows, locked (profile, then coach; no
  -- coach mutex). A coach_update holding the row is waited for, so the photo
  -- queued below is the one it saved, and a coach_update that comes after
  -- sees the row retired.
  perform 1 from coaches c where c.profile_id = v_uid for update;

  -- R63, C-29: a deleted coach is retired (R45), bios and photo emptied; the
  -- display names stay on the statements the venue paid and never reach a
  -- guest surface (retired coaches are hidden everywhere).
  -- R43: the photo folder of each row this clears is queued for removal from
  -- menu-media (the old path, returned by the update itself); a service path
  -- removes coaches/<folder>/* within a day (app.coach_photo_purge_due,
  -- app.coach_photo_purged, 0282).
  with old as (
    select c.id, c.photo_path from coaches c where c.profile_id = v_uid
  ), cleared as (
    update coaches c
       set status     = 'retired',
           retired_at = coalesce(c.retired_at, now()),
           bio_en     = '',
           bio_ar     = '',
           photo_path = null,
           updated_at = now()
      from old
     where c.id = old.id
       and (c.status <> 'retired' or c.bio_en <> '' or c.bio_ar <> '' or c.photo_path is not null)
    returning c.id, old.photo_path as old_photo
  ), queued as (
    insert into coach_photo_purges (coach_id, folder)
    select x.id, substring(x.old_photo from '^(coaches/[0-9a-f-]{36})/')
      from cleared x
     where x.old_photo is not null
    returning 1
  )
  select (select count(*) from cleared), (select count(*) from queued)
    into v_coach, v_photos;

  -- R49: a coach's time-off reasons are user content, emptied (NOT NULL text).
  update coach_time_off
     set reason = ''
   where coach_id in (select c.id from coaches c where c.profile_id = v_uid)
     and reason <> '';
  get diagnostics v_time_off = row_count;

  -- The queued notifications, after the match rows: a mutex holder ending a
  -- match writes its seats and requests first and then, through the
  -- match_events push trigger, deletes that match's queued reminders
  -- (app.match_sync_reminders). Taking the outbox rows last keeps this body in
  -- the same order, so it never holds a reminder row while it waits for a
  -- seat such a body holds (a 40P01 that would fail the deletion or swallow
  -- the reminder clean-up of a cancelled match).
  delete from notification_outbox where profile_id = v_uid;
  get diagnostics v_outbox = row_count;

  -- DF-20 (money.md §5.11, R13), the last data write: after the tombstone
  -- (ticket_refund_deleted picks deleted payers) and after every reservations
  -- write. Each purchase with nothing reserved, in use or restorable is cashed
  -- out now, one Qi refund of the price paid; a purchase whose ticket another
  -- body holds is skipped, never waited for. No match lock (R25): a purchase
  -- still tied to a match is refunded by the sweep once the match lets it go.
  -- A deletion never fails on a refund: an error is a warning, and the sweep's
  -- ticket_refund_deleted(null) retries.
  begin
    perform app.ticket_refund_deleted(v_uid);
  exception when others then
    raise warning 'delete_my_account: ticket refunds left for the sweep: % (%)', sqlerrm, sqlstate;
  end;

  -- 0306 (loyalty, contracts §1.4): the member card (its secret and code) and
  -- the points cache go. The ledger rows stay, on the tombstone, for the
  -- venue's figures; nothing in them names the person. loyalty_accounts ranks
  -- last in the lock order, so this comes after the ticket refunds.
  delete from loyalty_cards where profile_id = v_uid;
  get diagnostics v_loyalty = row_count;
  delete from loyalty_accounts where profile_id = v_uid;

  -- The audit row is written BEFORE the auth user goes, while auth.uid() still
  -- resolves for write_audit's actor_id.
  --
  -- It deliberately carries NO before-image. to_jsonb(profile) would write the
  -- full_name and phone this function exists to erase into an append-only table
  -- that manager and owner can read — reintroducing the data one row further
  -- down. What is recorded is the SHAPE of the deletion: enough to prove it
  -- happened and what it touched, nothing that identifies who.
  perform app.write_audit(
    'account.delete', 'profiles', v_uid::text,
    jsonb_build_object(
      'had_phone',      v_profile.phone is not null,
      'had_push_token', v_profile.expo_push_token is not null,
      'created_at',     v_profile.created_at),
    jsonb_build_object(
      'reservations_anonymised',    v_reservations,
      'series_anonymised',          v_series,
      'customer_notes_deleted',     v_notes,
      'customer_flags_deleted',     v_flags,
      'outbox_deleted',             v_outbox,
      'match_seats_scrubbed',       v_seats,
      'match_requests_scrubbed',    v_requests,
      'match_blocks_deleted',       v_blocks,
      'lesson_enrolments_scrubbed', v_enrolments,
      'lesson_links_dropped',       v_links,
      'coach_retired',              v_coach > 0,
      'coach_photo_queued',         v_photos,
      'coach_time_off_scrubbed',    v_time_off,
      'loyalty_card_deleted',       v_loyalty > 0,
      'apple_revoke_pending',       v_apple),
    'guest_request');

  -- The global sign-out, and the destruction of the identity itself.
  --
  -- auth.sessions CASCADEs from auth.users and auth.refresh_tokens CASCADEs from
  -- auth.sessions, so every token ever issued to this account dies with this one
  -- statement — a refresh token captured an hour ago can no longer mint a JWT.
  -- It also takes auth.identities (the Apple / Google link) and the email, phone
  -- and raw_user_meta_data, which is where full_name and phone were duplicated.
  --
  -- The on_auth_user_deleted trigger fires here and does nothing: deleted_at was
  -- stamped above, so the tombstone is left standing.
  delete from auth.users where id = v_uid;

  return jsonb_build_object(
    'deleted',              true,
    'profile_id',           v_uid,
    'apple_revoke_pending', v_apple);
end $delete_my_account_0306$;

comment on function app.delete_my_account(text) is
  'Loyalty 0306, 0290 (DB-03), 0289, from 0264 (0077; db.md §4.9 of open matches, §4.10 of coaching; DF-20, CD-12, R25, R29, R43, R44, R63). Store-mandated in-app account deletion. Destroys the auth user (which cascades every session, refresh token and identity — this IS the global sign-out) and leaves profiles as an anonymised tombstone (name parts and gender emptied too) so reservations.guest_id and the venue statistics keep a parent. Open matches: the player''s seats and requests lose gender and friend_genders, every block by or of the player is deleted, and every ticket purchase with nothing reserved, in use or restorable is refunded at once (app.ticket_refund_deleted, one Qi refund each). Coaching: a pending typed-phone link to the account is dropped silently, as "Not me" (C-21); the account''s other enrolments lose typed phones and friend names, a typed name becoming ''Deleted account''; the account''s coach profile is retired, its bios emptied, its photo folder queued for removal (coach_photo_purges, R43) and its time-off reasons emptied, the display names kept for the statements (C-29); since 0290 the coach rows are locked (profile, then coach) and the folder queued is the one of the row actually cleared. Loyalty (0306): the member card and the points cache are deleted after the ticket refunds (loyalty_accounts ranks last); the ledger rows stay on the tombstone. Takes no match lock, coach mutex or court lock (R25, D9): the sweeps (0263, 0286) leave or cancel the live matches, enrolments and a retired coach''s lessons, with refunds (account_deleted, coach_retired) and pushes; meanwhile other players see "Former player". Refuses an anonymous session (ACCOUNT_REQUIRED), a staff account (FORBIDDEN — staff are deactivated), an account already deleted (ALREADY_DELETED) and any call without p_confirm => ''DELETE''. Apple''s /auth/revoke is NOT called: no .p8 key exists yet, so the audit row records apple_revoke_pending instead.';

revoke all on function app.delete_my_account(text) from public, anon, authenticated;
grant execute on function app.delete_my_account(text) to authenticated;

-- ===========================================================================
-- 4. The nightly run
-- ===========================================================================
create or replace function app.loyalty_nightly() returns jsonb
language plpgsql security definer set search_path = public as $loyalty_nightly_0306$
declare
  v_s        loyalty_settings%rowtype;
  v_p        uuid;
  v_n        int := 0;
  v_expired  int := 0;
  a          record;
begin
  -- A deleted account has no cache (delete_my_account, the merge's drop): one
  -- left behind goes, and none is rebuilt from the ledger rows the tombstone
  -- keeps.
  delete from loyalty_accounts c
   using profiles p
   where p.id = c.profile_id and p.deleted_at is not null;

  -- The cache against the ledger, and the 12-month window that slid a day.
  for v_p in
    select x.profile_id
      from (select l.profile_id from loyalty_ledger l
            union
            select c.profile_id from loyalty_accounts c) x
      join profiles p on p.id = x.profile_id and p.deleted_at is null
     order by x.profile_id
  loop
    perform app.loyalty_recompute(v_p);
    v_n := v_n + 1;
  end loop;

  -- Inactivity expiry (off while inactivity_expiry_months is null): the whole
  -- balance of a live account with no activity for that long.
  select * into v_s from loyalty_settings where id;
  if v_s.inactivity_expiry_months is not null then
    for a in
      select c.profile_id, c.balance
        from loyalty_accounts c
        join profiles p on p.id = c.profile_id and p.deleted_at is null
       where c.balance > 0
         and c.last_activity_at < now() - make_interval(months => v_s.inactivity_expiry_months)
       order by c.profile_id
         for update of c   -- the balance expired is the one a till redeem waits behind
    loop
      insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, note)
      values (a.profile_id, null, -a.balance, 'expire', 'expiry', gen_random_uuid(),
              format('inactive %s months', v_s.inactivity_expiry_months));
      v_expired := v_expired + 1;
    end loop;
  end if;

  return jsonb_build_object('recomputed', v_n, 'expired', v_expired);
end $loyalty_nightly_0306$;

comment on function app.loyalty_nightly() is
  'Loyalty (M3, contracts §1.4). Cron tp_loyalty_nightly (''15 0 * * *'' UTC): the cache of a deleted profile removed, then app.loyalty_recompute for every live profile with ledger rows or an account (the cache reconciled to sum(ledger), the 12-month points and the tier recomputed), then, when inactivity_expiry_months is set, an (expire, expiry) row taking the whole balance of every live account inactive that long. Returns {recomputed, expired}. Granted to the service role only.';

revoke all on function app.loyalty_nightly() from public, anon, authenticated;
grant execute on function app.loyalty_nightly() to service_role;

-- tp_loyalty_nightly: daily at 00:15 UTC, its own transaction. Guarded like
-- 0300's tp_tournament_sweep. After a hosted push, cron.job must have the row
-- (packages/db/CLAUDE.md).
do $loyalty_nightly_cron_0306$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_loyalty_nightly not scheduled';
    return;
  end if;
  perform cron.schedule('tp_loyalty_nightly', '15 0 * * *', 'select app.loyalty_nightly();');
end $loyalty_nightly_cron_0306$;
