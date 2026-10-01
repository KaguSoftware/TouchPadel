-- 0282 price_promo_lessons — every lesson price goes through the owner's price
-- or promotion change: a launched lesson type's price or court share, a draft
-- type put on sale, and one coach's own price for a type.
--
-- Feature: coaching, Phase 2 milestone 5, lane DB
-- (docs/design/coaching/build-contracts-2026-10-01.md C-5, C-17, §1.8, R14,
-- R46, R81; db.md §4.8; operator.md §5.14; protocols build-contracts
-- 2026-09-23 §2.8, §2.13).
-- Depends on: price_promo (0177) and price_promo_renames (0195), whose six
-- hooks are re-issued here; coaching_tables (0275: lesson_types, coaches,
-- coach_lesson_types, coach_prices, lessons, courses, lesson_enrolments);
-- coaching_admin (0279: app.upsert_lesson_type_internal(uuid, uuid, jsonb)
-- returns lesson_types and app.set_coach_price_internal(uuid, uuid, bigint,
-- uuid) returns void, the two writers the apply calls by name; plpgsql binds
-- them at run time, and no lesson run can reach the apply before 0279 lands).
-- Re-runnable: create or replace.
--
-- THE CHANGE. Three kinds join the eight: lesson_price {lesson_type_id,
-- price_iqd?, court_share_iqd?} (a launched type; at least one figure, each a
-- change), lesson_launch {lesson_type_id, price_iqd, court_share_iqd} (a
-- never-launched, switched-off type), coach_price {coach_id, lesson_type_id,
-- price_iqd} (a coach not retired who teaches the type at the venue; price
-- null removes the coach's own price; any type, a draft included, D-8).
-- Managers and the owner only: marketing is refused NOT_STEP_ACTOR hint
-- change, as shop_launch is, and price_promo_targets answers it FORBIDDEN.
-- A price is 1..100,000,000 and, for a course, at least one dinar per
-- session (lesson_types_price); a court share 0..100,000,000.
--
-- THE SNAPSHOT (R46). The check writes before into the normalised record (a
-- client copy is replaced): the type's figures (lesson_price,
-- lesson_launch: price_iqd, court_share_iqd) or the coach's own price
-- (coach_price: price_iqd, null when none), and shape = {kind,
-- duration_min, sessions_count, max_places (a private type only; NULL for a
-- group or course, whose places are not part of the priced product, R82)},
-- what the approved price buys. A
-- draft stays the manager's to edit (C-17), so without the shape an approved
-- 30,000 for a 60-minute draft could go on sale as a 120-minute lesson.
--
-- THE TARGET CHECK. PRICE_TARGET_CHANGED hint lesson_type when the type is
-- gone or at another venue, no longer launched (lesson_price), launched or
-- switched on (lesson_launch), its figures differ from before (lesson_price,
-- lesson_launch), or its shape differs from before.shape (all three); hint
-- coach_price when the coach is retired, no longer teaches the type (an
-- unlink deletes the coach's price, R46) or the coach's own price differs
-- from before. Checked before the shape, so a coach_price run whose coach was
-- unlinked names the coach.
--
-- THE APPLY. The figures are the numbers step's, else the proposal's. The
-- lesson type row is locked first, before the target check, so a manager's
-- save of the same type (upsert_lesson_type reads it for update) waits for
-- the apply and the check reads the shape the write prices. lesson_price
-- writes its figures through app.upsert_lesson_type_internal, which validates
-- as the wrapper does, so a stale row never meets a raw 23514 inside
-- price_promo_apply_due; lesson_launch adds is_active true (the internal
-- stamps launched_at); coach_price writes app.set_coach_price_internal with
-- the run's id. Counts {lesson_types: 1} (+ launched: 1) or {coach_prices: 1};
-- audit protocol.price.apply. Lessons already booked keep their snapshots.
--
-- THE FIGURES. price_promo_targets: lesson_price and lesson_launch ->
-- {lesson_types: [{lesson_type_id, kind, name_en, name_ar, duration_min,
-- sessions_count, max_places, price_iqd, court_share_iqd, is_active}]};
-- coach_price -> {coaches: [{coach_id, display_name_en, display_name_ar,
-- lesson_types: [{lesson_type_id, name_en, name_ar, kind, sessions_count,
-- type_price_iqd, coach_price_iqd}]}]} (X28: DB's shape). price_promo_numbers
-- gains lesson: {lesson_type_id, coach_id, kind, name_en, name_ar,
-- current_price_iqd, new_price_iqd, current_court_share_iqd,
-- new_court_share_iqd, places_30d, owed_30d_iqd} (X28: DB's plus name_*; null
-- for every other change): booked sign-ups of the type (and coach) whose
-- lesson, or first covered course session, started in the last 30 days, at
-- their snapshot prices. Lesson tables only; no coach pay (C-28).
--
-- Every function is its LATEST body, copied verbatim (protocol_check_price_
-- promo_propose 0195:308, protocol_check_price_promo_numbers 0177:2526,
-- price_promo_check_targets 0195:506, price_promo_apply_internal 0195:647,
-- price_promo_targets 0177:2747, price_promo_numbers 0195:850; each checked
-- with `grep -n "function app.<name>(" supabase/migrations/*.sql`, both
-- spellings, no later definition), with the lesson branches above, its
-- comment and the dollar tag changed and nothing else. Signatures are
-- unchanged, so each keeps its grants; the revoke/grant pair is re-issued
-- anyway. No new function, table, index or error code.
--
-- Not re-issued: protocol_submit_price_promo_propose (0177:2479; its branches
-- skip the three kinds, whose targets stay in the record, as rate's do),
-- protocol_check_price_promo_apply (0177:2668, calls the target check),
-- protocol_pass_price_promo_apply (0177:2705), price_promo_apply_due
-- (0177:2209; a null actor, and the internals check no role).
--
-- covered by packages/db/tests/coaching-price-protocol.test.ts (and
-- price-promo.test.ts, unmodified)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. propose: the three lesson kinds, their before snapshots, marketing
--    refused (app.protocol_check_price_promo_propose, 0195:308).
-- ---------------------------------------------------------------------------
create or replace function app.protocol_check_price_promo_propose(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_price_promo_propose_0282$
declare
  c_common constant text[] := array['change', 'reason', 'expected_effect'];
  v_run    protocol_runs%rowtype;
  v_first  jsonb;
  v_change text;
  v_out    jsonb;
  v_id     uuid;
  v_item   menu_items%rowtype;
  v_kind   text;
  v_prices jsonb;
  v_new    jsonb;
  v_ren    jsonb;
  v_promo  promotions%rowtype;
  v_rule   rate_rules%rowtype;
  v_pct    bigint;
  v_lt     lesson_types%rowtype;
  v_shape  jsonb;
  v_coach  uuid;
  v_price  bigint;
  v_share  bigint;
  v_min    bigint;
  v_cur    bigint;
begin
  select r.* into v_run
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'record';
  end if;

  v_change := app.price_promo_text(p_record->'change', 20, true, 'change');
  if v_change not in ('price', 'shop_launch', 'addon_price', 'promotion', 'promotion_edit',
                      'promotion_enable', 'rate', 'featured_discount',
                      'lesson_price', 'lesson_launch', 'coach_price') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'change';
  end if;
  -- A hidden product is launched by MGMT only; marketing is not offered one.
  -- Lesson prices are the venue's (C-5, C-17): MGMT only too (0282).
  if v_change in ('shop_launch', 'lesson_price', 'lesson_launch', 'coach_price')
     and not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'NOT_STEP_ACTOR' using errcode = 'P0001', hint = 'change';
  end if;

  v_out := jsonb_build_object(
    'change',          v_change,
    'reason',          app.price_promo_text(p_record->'reason', 2000, true, 'reason'),
    'expected_effect', app.price_promo_text(p_record->'expected_effect', 2000, true, 'expected_effect'));

  case v_change
  when 'price' then
    perform app.price_promo_only_keys(p_record, c_common || array['menu_item_id', 'prices', 'new_sizes', 'renames'], null);
    v_id := app.price_promo_uuid(p_record->'menu_item_id', true, 'menu_item_id');
    select mi.* into v_item from menu_items mi where mi.id = v_id and mi.venue_id = v_run.venue_id;
    select c.kind into v_kind from menu_categories c where c.id = v_item.category_id;
    -- Launched (or on sale) and not in a release: a draft is priced directly,
    -- an item in release by its price step.
    if v_item.id is null
       or not (v_item.launched_at is not null or v_item.is_active)
       or exists (select 1 from protocol_runs rr
                   where rr.id = v_item.release_run_id and rr.status not in ('live', 'done')) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'menu_item_id';
    end if;
    v_prices := app.price_promo_sizes(p_record->'prices', v_id, 0, 'prices');
    v_new := app.price_promo_new_sizes(p_record->'new_sizes');
    -- A size renamed keeps its row: its recipe, and its price unless prices
    -- names it too (#9).
    v_ren := app.price_promo_size_renames(p_record->'renames', v_id);
    -- A shop size carries its own stock item, SKU and barcode: a new pack
    -- size is a new hidden product, or the owner's.
    if jsonb_array_length(v_new) > 0 and v_kind = 'shop' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'new_sizes';
    end if;
    if jsonb_array_length(v_prices) + jsonb_array_length(v_new) + jsonb_array_length(v_ren) = 0 then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'prices';
    end if;
    v_out := v_out || jsonb_build_object('menu_item_id', v_id, 'prices', v_prices)
                   || case when jsonb_array_length(v_new) > 0
                           then jsonb_build_object('new_sizes', v_new) else '{}'::jsonb end
                   || case when jsonb_array_length(v_ren) > 0
                           then jsonb_build_object('renames', v_ren) else '{}'::jsonb end;

  when 'shop_launch' then
    perform app.price_promo_only_keys(p_record, c_common || array['menu_item_id', 'prices'], null);
    v_id := app.price_promo_uuid(p_record->'menu_item_id', true, 'menu_item_id');
    select mi.* into v_item from menu_items mi where mi.id = v_id and mi.venue_id = v_run.venue_id;
    select c.kind into v_kind from menu_categories c where c.id = v_item.category_id;
    -- A draft in a product release goes on sale through the owner's Launch
    -- only (#52), never as a shop product.
    if v_item.id is null or v_kind is distinct from 'shop'
       or v_item.launched_at is not null or v_item.is_active
       or exists (select 1 from protocol_runs rr
                   where rr.id = v_item.release_run_id and rr.status not in ('live', 'done')) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'menu_item_id';
    end if;
    -- Exactly the product's sizes, each once.
    v_prices := app.price_promo_sizes(p_record->'prices', v_id, 1, 'prices');
    if jsonb_array_length(v_prices) <> (select count(*) from menu_item_variants v where v.item_id = v_id) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'prices';
    end if;
    v_out := v_out || jsonb_build_object('menu_item_id', v_id, 'prices', v_prices);

  when 'addon_price' then
    perform app.price_promo_only_keys(p_record, c_common || array['addons', 'renames'], null);
    -- A change of names only (#9) leaves addons absent or empty; one of the
    -- two is always there.
    v_ren := app.price_promo_addon_renames(p_record->'renames', v_run.venue_id);
    if jsonb_array_length(v_ren) > 0
       and (p_record->'addons' is null or p_record->'addons' in ('null'::jsonb, '[]'::jsonb)) then
      v_out := v_out || jsonb_build_object('addons', '[]'::jsonb);
    else
      v_out := v_out || jsonb_build_object('addons', app.price_promo_addons(p_record->'addons', v_run.venue_id));
    end if;
    v_out := v_out || case when jsonb_array_length(v_ren) > 0
                           then jsonb_build_object('renames', v_ren) else '{}'::jsonb end;

  when 'promotion' then
    perform app.price_promo_only_keys(p_record, c_common || array['promotion'], null);
    -- The run's own draft (on a resubmission) holds its code already.
    v_out := v_out || jsonb_build_object('promotion', app.price_promo_promotion(p_record->'promotion', v_run.promotion_id));

  when 'promotion_edit', 'promotion_enable' then
    perform app.price_promo_only_keys(p_record,
      c_common || case when v_change = 'promotion_edit' then array['promotion_id', 'promotion', 'base_updated_at']
                       else array['promotion_id', 'base_updated_at'] end, null);
    v_id := app.price_promo_uuid(p_record->'promotion_id', true, 'promotion_id');
    select * into v_promo from promotions where id = v_id;
    if not found or (v_change = 'promotion_enable' and v_promo.enabled) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion_id';
    end if;
    v_out := v_out || jsonb_build_object('promotion_id', v_id, 'base_updated_at', v_promo.updated_at);
    if v_change = 'promotion_edit' then
      v_out := v_out || jsonb_build_object('promotion', app.price_promo_promotion(p_record->'promotion', v_id));
    end if;

  when 'rate' then
    perform app.price_promo_only_keys(p_record, c_common || array['rule_id', 'rule', 'before'], null);
    v_id := app.price_promo_uuid(p_record->'rule_id', false, 'rule_id');
    if v_id is not null then
      select * into v_rule from rate_rules where id = v_id and venue_id = v_run.venue_id;
      if not found then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'rule_id';
      end if;
      -- The rule and its prices as they stand: the apply checks nobody
      -- wrote them since.
      v_out := v_out || jsonb_build_object(
        'rule_id', v_id,
        'before',  jsonb_build_object(
                     'rule',   to_jsonb(v_rule),
                     'prices', coalesce((select jsonb_object_agg(rp.duration_min::text, rp.price_iqd)
                                           from rate_rule_prices rp where rp.rule_id = v_id), '{}'::jsonb)));
    end if;
    v_out := v_out || jsonb_build_object('rule', app.price_promo_rule(p_record->'rule', v_run.venue_id));

  when 'featured_discount' then
    perform app.price_promo_only_keys(p_record, c_common || array['menu_item_id', 'discount_pct', 'before'], null);
    v_id := app.price_promo_uuid(p_record->'menu_item_id', true, 'menu_item_id');
    if not exists (select 1 from menu_items mi
                    where mi.id = v_id and mi.venue_id = v_run.venue_id and mi.is_active) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'menu_item_id';
    end if;
    v_pct := app.price_promo_int(p_record->'discount_pct', 0, 99, true, 'discount_pct');
    -- A change, or a stored discount put live by Featured mode; never a
    -- no-op.
    if lower(app.cafe_setting_text('featured_item_id')) is not distinct from v_id::text
       and coalesce(app.cafe_setting_int('featured_discount_pct'), 0) = v_pct
       and (v_pct = 0 or app.cafe_setting_text('hero_mode') = 'featured') then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'discount_pct';
    end if;
    v_out := v_out || jsonb_build_object(
      'menu_item_id', v_id,
      'discount_pct', v_pct,
      'before',       jsonb_build_object(
                        'featured_item_id',      app.cafe_setting('featured_item_id'),
                        'featured_discount_pct', app.cafe_setting('featured_discount_pct'),
                        'hero_mode',             app.cafe_setting('hero_mode')));

  -- Lessons (0282; C-17, R46). Each names a lesson type at the run's venue.
  -- before is written here, a client copy replaced: the figures the owner
  -- approves against and the type's shape, what the price buys.
  when 'lesson_price', 'lesson_launch', 'coach_price' then
    perform app.price_promo_only_keys(p_record,
      c_common || case when v_change = 'coach_price'
                       then array['coach_id', 'lesson_type_id', 'price_iqd', 'before']
                       else array['lesson_type_id', 'price_iqd', 'court_share_iqd', 'before'] end, null);
    v_id := app.price_promo_uuid(p_record->'lesson_type_id', true, 'lesson_type_id');
    select lt.* into v_lt from lesson_types lt where lt.id = v_id and lt.venue_id = v_run.venue_id;
    -- lesson_price: launched (on sale or switched off); lesson_launch: never
    -- launched and switched off (a draft is priced directly, C-17);
    -- coach_price: any type, a draft included (D-8).
    if v_lt.id is null
       or (v_change = 'lesson_price' and v_lt.launched_at is null)
       or (v_change = 'lesson_launch' and (v_lt.launched_at is not null or v_lt.is_active)) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'lesson_type_id';
    end if;
    v_shape := jsonb_build_object('kind',           v_lt.kind,
                                  'duration_min',   v_lt.duration_min,
                                  'sessions_count', v_lt.sessions_count,
                                  'max_places',     case when v_lt.kind = 'private' then v_lt.max_places end);
    -- A price is never 0, and a course's is at least a dinar a session
    -- (lesson_types_price): every iqd_split share stays positive.
    v_min := greatest(coalesce(v_lt.sessions_count, 1), 1);

    if v_change = 'coach_price' then
      v_coach := app.price_promo_uuid(p_record->'coach_id', true, 'coach_id');
      if not exists (select 1
                       from coaches c
                       join coach_lesson_types clt on clt.coach_id = c.id
                      where c.id = v_coach and c.status <> 'retired'
                        and clt.lesson_type_id = v_lt.id and clt.venue_id = v_run.venue_id) then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'coach_id';
      end if;
      -- A price, or null to remove the coach's own price; never the one stored
      -- (removing none is a no-op too).
      v_price := app.price_promo_int(p_record->'price_iqd', v_min, 100000000, false, 'price_iqd');
      select cp.price_iqd into v_cur
        from coach_prices cp
       where cp.coach_id = v_coach and cp.lesson_type_id = v_lt.id;
      if v_price is not distinct from v_cur then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'price_iqd';
      end if;
      v_out := v_out || jsonb_build_object(
        'coach_id',       v_coach,
        'lesson_type_id', v_lt.id,
        'price_iqd',      v_price,
        'before',         jsonb_build_object('price_iqd', v_cur, 'shape', v_shape));
    else
      -- lesson_launch needs both figures; lesson_price at least one, each a
      -- change from the stored one.
      v_price := app.price_promo_int(p_record->'price_iqd', v_min, 100000000,
                                     v_change = 'lesson_launch', 'price_iqd');
      v_share := app.price_promo_int(p_record->'court_share_iqd', 0, 100000000,
                                     v_change = 'lesson_launch', 'court_share_iqd');
      if v_change = 'lesson_price' then
        if v_price is null and v_share is null then
          raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'price_iqd';
        end if;
        if v_price = v_lt.price_iqd then
          raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'price_iqd';
        end if;
        if v_share = v_lt.court_share_iqd then
          raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'court_share_iqd';
        end if;
      end if;
      v_out := v_out || jsonb_build_object('lesson_type_id', v_lt.id)
                     || jsonb_strip_nulls(jsonb_build_object('price_iqd', v_price, 'court_share_iqd', v_share))
                     || jsonb_build_object('before', jsonb_build_object(
                          'price_iqd',       v_lt.price_iqd,
                          'court_share_iqd', v_lt.court_share_iqd,
                          'shape',           v_shape));
    end if;
  end case;

  -- A resubmission keeps the run's change and target; its sizes, add-ons,
  -- fields and figures may change.
  select x.record into v_first
    from protocol_submissions x
   where x.run_step_id = p_run_step_id
   order by x.round, x.submitted_at, x.id
   limit 1;
  if v_first is not null
     and (v_first->'change' is distinct from v_out->'change'
          or v_first->'menu_item_id' is distinct from v_out->'menu_item_id'
          or v_first->'promotion_id' is distinct from v_out->'promotion_id'
          or v_first->'rule_id' is distinct from v_out->'rule_id'
          or v_first->'lesson_type_id' is distinct from v_out->'lesson_type_id'
          or v_first->'coach_id' is distinct from v_out->'coach_id') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'change';
  end if;

  return v_out;
end $protocol_check_price_promo_propose_0282$;

comment on function app.protocol_check_price_promo_propose(uuid, jsonb, text[]) is
  'price_promo (§2.8, §2.13). Internal check hook: one of the eleven changes with reason and expected_effect (<= 2000): price {menu_item_id (launched, not in release, at the run''s venue), prices (0-12 of its sizes), new_sizes? (0-4, a cafe item only), renames? (0-12 of its sizes, app.price_promo_size_renames); at least one price, new size or rename}, shop_launch {menu_item_id (a never-launched hidden shop product, not in release), prices (exactly its sizes)}, addon_price {addons (1-30 at the venue; absent or empty when renames has one), renames? (0-30 launched add-ons at the venue, app.price_promo_addon_renames)}, promotion {promotion}, promotion_edit {promotion_id, promotion}, promotion_enable {promotion_id (off)}, rate {rule_id?, rule}, featured_discount {menu_item_id (active, at the venue), discount_pct 0-99, a change}; and the lessons (price_promo_lessons, coaching C-17, R46): lesson_price {lesson_type_id (launched, at the venue), price_iqd?, court_share_iqd? (at least one, each a change)}, lesson_launch {lesson_type_id (never launched, switched off), price_iqd, court_share_iqd}, coach_price {coach_id (not retired, teaching the type at the venue), lesson_type_id (any, a draft included), price_iqd (null removes; a change)}; a price 1..100,000,000 and at least sessions_count for a course, a court share 0..100,000,000. shop_launch and the three lesson kinds are MGMT only: NOT_STEP_ACTOR hint change for marketing. Adds base_updated_at (promotion edit or switch-on), before (rate edit, featured discount; the lesson kinds: the type''s price_iqd and court_share_iqd, or the coach''s own price_iqd, and shape {kind, duration_min, sessions_count, max_places}) and each rename''s before_en and before_ar. A resubmission keeps change and target, lesson_type_id and coach_id included (hint change). RECORD_INVALID and TEXT_TOO_LONG with the field as hint, never a writer''s code.';

revoke all on function app.protocol_check_price_promo_propose(uuid, jsonb, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. numbers: the lesson figures (app.protocol_check_price_promo_numbers,
--    0177:2526).
-- ---------------------------------------------------------------------------
create or replace function app.protocol_check_price_promo_numbers(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_price_promo_numbers_0282$
declare
  v_run    protocol_runs%rowtype;
  v_p      jsonb;
  v_change text;
  v_rec    text;
  v_out    jsonb;
  v_v      jsonb;
  v_el     jsonb;
  v_i      int;
  v_sizes  jsonb := '[]'::jsonb;
  v_min    bigint;
begin
  select r.* into v_run
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  v_p := app.price_promo_record(v_run.id, 'propose');
  v_change := v_p->>'change';

  perform app.price_promo_only_keys(p_record,
    array['recommendation', 'note'] || case v_change
      when 'price'            then array['prices', 'new_sizes']
      when 'shop_launch'      then array['prices']
      when 'addon_price'      then array['addons']
      when 'promotion'        then array['promotion_value']
      when 'promotion_edit'   then array['promotion_value']
      when 'rate'             then array['rule_prices']
      when 'featured_discount' then array['discount_pct']
      when 'lesson_price'     then array['price_iqd', 'court_share_iqd']
      when 'lesson_launch'    then array['price_iqd', 'court_share_iqd']
      when 'coach_price'      then array['price_iqd']
      else '{}'::text[] end, null);

  v_rec := app.price_promo_text(p_record->'recommendation', 10, true, 'recommendation');
  if v_rec not in ('go', 'change', 'drop') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'recommendation';
  end if;
  v_out := jsonb_strip_nulls(jsonb_build_object(
             'recommendation', v_rec,
             'note',           app.price_promo_text(p_record->'note', 2000, false, 'note')));

  if p_record->'prices' is not null and p_record->'prices' <> 'null'::jsonb then
    v_v := app.price_promo_sizes(p_record->'prices', (v_p->>'menu_item_id')::uuid, 0, 'prices');
    if (select coalesce(array_agg(e->>'variant_id' order by e->>'variant_id'), '{}')
          from jsonb_array_elements(v_v) e)
       is distinct from
       (select coalesce(array_agg(e->>'variant_id' order by e->>'variant_id'), '{}')
          from jsonb_array_elements(v_p->'prices') e) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'prices';
    end if;
    v_out := v_out || jsonb_build_object('prices', v_v);
  end if;

  -- New sizes by position: the proposal's names, the final prices.
  if p_record->'new_sizes' is not null and p_record->'new_sizes' <> 'null'::jsonb then
    v_v := app.price_promo_new_sizes(p_record->'new_sizes');
    if jsonb_array_length(v_v) <> jsonb_array_length(coalesce(v_p->'new_sizes', '[]'::jsonb)) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'new_sizes';
    end if;
    for v_el, v_i in select e, (o - 1)::int from jsonb_array_elements(v_v) with ordinality as t(e, o) loop
      if (v_el ? 'name_en' and v_el->'name_en' is distinct from v_p->'new_sizes'->v_i->'name_en')
         or (v_el ? 'name_ar' and v_el->'name_ar' is distinct from v_p->'new_sizes'->v_i->'name_ar') then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'new_sizes';
      end if;
      v_sizes := v_sizes || jsonb_build_array((v_p->'new_sizes'->v_i) || jsonb_build_object('price_iqd', v_el->'price_iqd'));
    end loop;
    v_out := v_out || jsonb_build_object('new_sizes', v_sizes);
  end if;

  if p_record->'addons' is not null and p_record->'addons' <> 'null'::jsonb then
    v_v := app.price_promo_addons(p_record->'addons', v_run.venue_id);
    if (select array_agg(e->>'modifier_id' order by e->>'modifier_id') from jsonb_array_elements(v_v) e)
       is distinct from
       (select array_agg(e->>'modifier_id' order by e->>'modifier_id') from jsonb_array_elements(v_p->'addons') e) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'addons';
    end if;
    v_out := v_out || jsonb_build_object('addons', v_v);
  end if;

  if p_record->'promotion_value' is not null and p_record->'promotion_value' <> 'null'::jsonb then
    v_out := v_out || jsonb_build_object('promotion_value',
      app.price_promo_int(p_record->'promotion_value', 1,
                          case when v_p->'promotion'->>'type' = 'percent' then 99 else 2147483647 end,
                          true, 'promotion_value'));
  end if;

  if p_record->'rule_prices' is not null and p_record->'rule_prices' <> 'null'::jsonb then
    v_v := app.price_promo_price_map(p_record->'rule_prices', 'rule_prices');
    if (select array_agg(k::int order by k::int) from jsonb_object_keys(v_v) k)
       is distinct from
       (select array_agg(k::int order by k::int) from jsonb_object_keys(v_p->'rule'->'prices') k) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'rule_prices';
    end if;
    v_out := v_out || jsonb_build_object('rule_prices', v_v);
  end if;

  if p_record->'discount_pct' is not null and p_record->'discount_pct' <> 'null'::jsonb then
    v_out := v_out || jsonb_build_object('discount_pct',
      app.price_promo_int(p_record->'discount_pct', 0, 99, true, 'discount_pct'));
  end if;

  -- Lesson figures (0282): only those the proposal carries (a coach_price
  -- removal carries none), in the proposal's bounds; a course's price stays
  -- at least a dinar per session of the shape the owner approves.
  if p_record->'price_iqd' is not null and p_record->'price_iqd' <> 'null'::jsonb then
    if v_p->'price_iqd' is null or v_p->'price_iqd' = 'null'::jsonb then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'price_iqd';
    end if;
    v_min := greatest(coalesce((v_p->'before'->'shape'->>'sessions_count')::bigint, 1), 1);
    v_out := v_out || jsonb_build_object('price_iqd',
      app.price_promo_int(p_record->'price_iqd', v_min, 100000000, true, 'price_iqd'));
  end if;

  if p_record->'court_share_iqd' is not null and p_record->'court_share_iqd' <> 'null'::jsonb then
    if v_p->'court_share_iqd' is null or v_p->'court_share_iqd' = 'null'::jsonb then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'court_share_iqd';
    end if;
    v_out := v_out || jsonb_build_object('court_share_iqd',
      app.price_promo_int(p_record->'court_share_iqd', 0, 100000000, true, 'court_share_iqd'));
  end if;

  return v_out;
end $protocol_check_price_promo_numbers_0282$;

comment on function app.protocol_check_price_promo_numbers(uuid, jsonb, text[]) is
  'price_promo (§2.8). Internal check hook: numbers {recommendation go|change|drop, note? (<= 2000), and the final figures for exactly the passed proposal''s targets, each optional (left out = the proposal''s): prices (the same sizes), new_sizes (the same count, the proposal''s names), addons (the same add-ons), promotion_value (by its type), rule_prices (the same durations), discount_pct (0-99), and for the lesson kinds (price_promo_lessons) price_iqd (lesson_price, lesson_launch, coach_price; only when the proposal carries one; 1..100,000,000, at least the approved shape''s sessions_count for a course) and court_share_iqd (lesson_price, lesson_launch; only when the proposal carries one; 0..100,000,000)}. A figure the change does not take, or targets other than the proposal''s, is RECORD_INVALID with the field as hint.';

revoke all on function app.protocol_check_price_promo_numbers(uuid, jsonb, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The target check: a lesson type still in the state, with the figures
--    and the shape, the owner approved; a coach still teaching it at the
--    approved coach price (app.price_promo_check_targets, 0195:506).
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_check_targets(p_run_id uuid)
returns void
language plpgsql stable security definer set search_path = public as $price_promo_check_targets_0282$
declare
  v_p     jsonb := app.price_promo_record(p_run_id, 'propose');
  v_n     jsonb := app.price_promo_record(p_run_id, 'numbers');
  v_run   protocol_runs%rowtype;
  v_item  menu_items%rowtype;
  v_promo promotions%rowtype;
  v_rule  rate_rules%rowtype;
  v_el    jsonb;
  v_id    uuid;
  v_code  text;
  v_lt    lesson_types%rowtype;
  v_shape jsonb;
begin
  select * into v_run from protocol_runs where id = p_run_id;
  if v_p is null or v_n is null then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', hint = 'numbers';
  end if;

  case v_p->>'change'
  when 'price', 'shop_launch' then
    select * into v_item from menu_items where id = (v_p->>'menu_item_id')::uuid;
    if not found then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'item';
    end if;
    -- Neither kind prices an item in a product release: its prices come from
    -- the price step and it goes on sale at the owner's Launch.
    if exists (select 1 from protocol_runs rr
                where rr.id = v_item.release_run_id and rr.status not in ('live', 'done')) then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'item';
    end if;
    if v_p->>'change' = 'price' and not (v_item.launched_at is not null or v_item.is_active) then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'item';
    end if;
    if v_p->>'change' = 'shop_launch' and (v_item.is_active or v_item.launched_at is not null) then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'item';
    end if;
    for v_el in select e from jsonb_array_elements(v_p->'prices') e loop
      v_id := (v_el->>'variant_id')::uuid;
      if not exists (select 1 from menu_item_variants v where v.id = v_id and v.item_id = v_item.id) then
        raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'size:' || v_id;
      end if;
    end loop;
    -- A renamed size is still the item's and still has the names the owner
    -- saw it renamed from (#9). A run proposed before the renames has none.
    for v_el in select e from jsonb_array_elements(coalesce(v_p->'renames', '[]'::jsonb)) e loop
      v_id := (v_el->>'variant_id')::uuid;
      if not exists (select 1 from menu_item_variants v
                      where v.id = v_id and v.item_id = v_item.id
                        and v.name_en is not distinct from v_el->>'before_en'
                        and v.name_ar is not distinct from v_el->>'before_ar') then
        raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'size:' || v_id;
      end if;
    end loop;
    -- A shop product goes on sale with exactly the sizes the owner priced: a
    -- size added since would go on sale at a price nobody approved.
    if v_p->>'change' = 'shop_launch'
       and exists (select 1 from menu_item_variants v
                    where v.item_id = v_item.id
                      and not (v.id::text in (select e->>'variant_id' from jsonb_array_elements(v_p->'prices') e))) then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'sizes';
    end if;

  when 'addon_price' then
    for v_el in select e from jsonb_array_elements(v_p->'addons') e loop
      v_id := (v_el->>'modifier_id')::uuid;
      if not exists (select 1 from modifiers m where m.id = v_id) then
        raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'addon:' || v_id;
      end if;
    end loop;
    for v_el in select e from jsonb_array_elements(coalesce(v_p->'renames', '[]'::jsonb)) e loop
      v_id := (v_el->>'modifier_id')::uuid;
      if not exists (select 1 from modifiers m
                      where m.id = v_id
                        and m.name_en is not distinct from v_el->>'before_en'
                        and m.name_ar is not distinct from v_el->>'before_ar') then
        raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'addon:' || v_id;
      end if;
    end loop;

  when 'promotion', 'promotion_edit', 'promotion_enable' then
    select * into v_promo
      from promotions
     where id = case when v_p->>'change' = 'promotion' then v_run.promotion_id
                     else (v_p->>'promotion_id')::uuid end;
    if not found then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'promotion';
    end if;
    if v_p->>'change' in ('promotion_edit', 'promotion_enable')
       and v_promo.updated_at is distinct from (v_p->>'base_updated_at')::timestamptz then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'promotion';
    end if;
    if v_p->>'change' = 'promotion_enable' and v_promo.enabled then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'promotion';
    end if;
    v_code := nullif(v_p->'promotion'->>'public_code', '');
    if v_code is not null
       and exists (select 1 from promotions x where x.public_code = v_code and x.id <> v_promo.id) then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'promotion';
    end if;

  when 'rate' then
    if v_p->>'rule_id' is not null then
      select * into v_rule from rate_rules where id = (v_p->>'rule_id')::uuid;
      if not found
         or to_jsonb(v_rule) is distinct from v_p->'before'->'rule'
         or coalesce((select jsonb_object_agg(rp.duration_min::text, rp.price_iqd)
                        from rate_rule_prices rp where rp.rule_id = v_rule.id), '{}'::jsonb)
            is distinct from v_p->'before'->'prices' then
        raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'rule';
      end if;
    end if;
    if v_p->'rule'->>'court_id' is not null
       and not exists (select 1 from courts c
                        where c.id = (v_p->'rule'->>'court_id')::uuid and c.venue_id = v_run.venue_id) then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'rule';
    end if;

  when 'featured_discount' then
    if app.cafe_setting('featured_item_id') is distinct from v_p->'before'->'featured_item_id'
       or app.cafe_setting('featured_discount_pct') is distinct from v_p->'before'->'featured_discount_pct'
       or app.cafe_setting('hero_mode') is distinct from v_p->'before'->'hero_mode'
       or not exists (select 1 from menu_items mi
                       where mi.id = (v_p->>'menu_item_id')::uuid and mi.is_active) then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'featured';
    end if;

  -- Lessons (0282; R46). The type is still at the venue and in the state the
  -- change needs, with the figures and the shape in before; a coach price
  -- also needs its coach, still teaching the type, at the approved price.
  when 'lesson_price', 'lesson_launch', 'coach_price' then
    select * into v_lt from lesson_types where id = (v_p->>'lesson_type_id')::uuid;
    if not found or v_lt.venue_id is distinct from v_run.venue_id then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'lesson_type';
    end if;
    if v_p->>'change' = 'coach_price' then
      -- Retired, or unlinked from the type (which deletes the coach's price),
      -- or a coach price written since (the owner's set_coach_price).
      if not exists (select 1
                       from coaches c
                       join coach_lesson_types clt on clt.coach_id = c.id
                      where c.id = (v_p->>'coach_id')::uuid and c.status <> 'retired'
                        and clt.lesson_type_id = v_lt.id)
         or (select cp.price_iqd from coach_prices cp
              where cp.coach_id = (v_p->>'coach_id')::uuid and cp.lesson_type_id = v_lt.id)
            is distinct from (v_p->'before'->>'price_iqd')::bigint then
        raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'coach_price';
      end if;
    elsif (v_p->>'change' = 'lesson_price' and v_lt.launched_at is null)
          or (v_p->>'change' = 'lesson_launch' and (v_lt.launched_at is not null or v_lt.is_active))
          or v_lt.price_iqd is distinct from (v_p->'before'->>'price_iqd')::bigint
          or v_lt.court_share_iqd is distinct from (v_p->'before'->>'court_share_iqd')::bigint then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'lesson_type';
    end if;
    -- What the approved price buys: a length, sessions or party size changed
    -- since (a draft is the manager's to edit, C-17) is a new proposal.
    v_shape := jsonb_build_object('kind',           v_lt.kind,
                                  'duration_min',   v_lt.duration_min,
                                  'sessions_count', v_lt.sessions_count,
                                  'max_places',     case when v_lt.kind = 'private' then v_lt.max_places end);
    if v_shape is distinct from v_p->'before'->'shape' then
      raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'lesson_type';
    end if;

  else
    raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'change';
  end case;
end $price_promo_check_targets_0282$;

comment on function app.price_promo_check_targets(uuid) is
  'price_promo (§2.13). Internal: raises PRICE_TARGET_CHANGED (hint item, size:<variant_id>, sizes, addon:<modifier_id>, promotion, rule, featured, lesson_type or coach_price) when what the passed proposal and numbers approved no longer matches: a target gone; a price item no longer launched or put in release; a shop_launch product switched on, launched, put in release, or with sizes other than the approved ones; a renamed size no longer the item''s, or a renamed size or add-on whose names are no longer its before_en and before_ar (price_promo_renames, #9); a promotion written since the proposal (updated_at against base_updated_at), already on for a switch-on, or its code taken; an edited rule or its prices changed since (against before), or the rule''s court gone; the featured item, discount or hero mode changed since (against before), or the item to feature switched off; and (price_promo_lessons, R46) a lesson type gone or at another venue, no longer launched (lesson_price), launched or switched on (lesson_launch), its price or court share other than before (lesson_price, lesson_launch), or its shape {kind, duration_min, sessions_count, max_places} other than before.shape (all three: lesson_type); a coach retired, no longer teaching the type, or whose own price is not before.price_iqd (coach_price). Called by the apply check hook and app.price_promo_apply_internal.';

revoke all on function app.price_promo_check_targets(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The apply: a lesson type's figures, a draft put on sale, a coach's own
--    price (app.price_promo_apply_internal, 0195:647).
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_apply_internal(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $price_promo_apply_internal_0282$
declare
  v_run    protocol_runs%rowtype;
  v_p      jsonb;
  v_n      jsonb;
  v_change text;
  v_item   menu_items%rowtype;
  v_v      menu_item_variants%rowtype;
  v_m      modifiers%rowtype;
  v_el     jsonb;
  v_f      jsonb;
  v_sort   int;
  v_value  int;
  v_pct    int;
  v_counts jsonb;
  v_a      int := 0;
  v_b      int := 0;
  v_r      int := 0;
  v_kind   text;
  v_ok_by  uuid;
begin
  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or v_run.kind <> 'price_promo' then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_run.status not in ('active', 'scheduled') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', hint = v_run.status || ' -> done';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  -- A lesson change locks its type first (0282): the target check below then
  -- reads the shape and figures this apply writes over, and a manager's save
  -- of the same type (upsert_lesson_type reads it for update) waits and then
  -- sees the new price.
  v_p := app.price_promo_record(v_run.id, 'propose');
  if v_p->>'change' in ('lesson_price', 'lesson_launch', 'coach_price') then
    perform 1 from lesson_types lt where lt.id = (v_p->>'lesson_type_id')::uuid for update;
  end if;
  perform app.price_promo_check_targets(v_run.id);

  v_p := app.price_promo_record(v_run.id, 'propose');
  v_n := app.price_promo_record(v_run.id, 'numbers');
  v_change := v_p->>'change';

  if v_change in ('price', 'shop_launch') then
    select * into v_item from menu_items where id = (v_p->>'menu_item_id')::uuid for update;
    -- Each approved size at its new price, keeping its name, default and order.
    for v_el in select e from jsonb_array_elements(coalesce(v_n->'prices', v_p->'prices')) e loop
      select * into v_v from menu_item_variants where id = (v_el->>'variant_id')::uuid;
      perform app.upsert_variant_internal(v_item.id, v_v.name_en, v_v.name_ar, (v_el->>'price_iqd')::bigint,
                                          v_v.id, v_v.is_default, v_v.sort_order);
      v_a := v_a + 1;
    end loop;
    -- New sizes after the last one, never the default. Their recipe is added
    -- in Stock ▸ Recipes, as for any new size.
    select coalesce(max(v.sort_order), -1) + 1 into v_sort from menu_item_variants v where v.item_id = v_item.id;
    for v_el in select e from jsonb_array_elements(coalesce(v_n->'new_sizes', v_p->'new_sizes', '[]'::jsonb)) e loop
      perform app.upsert_variant_internal(v_item.id,
                                          coalesce(v_el->>'name_en', v_el->>'name_ar'),
                                          coalesce(v_el->>'name_ar', v_el->>'name_en'),
                                          (v_el->>'price_iqd')::bigint, null, false, v_sort);
      v_sort := v_sort + 1;
      v_b := v_b + 1;
    end loop;
    -- Renamed sizes (#9), from the proposal (numbers never carries names):
    -- the row is kept, so its recipe is, and its price as it stands after the
    -- loop above, which is the new one when this run prices it too. A shop
    -- size's retail stock row takes the name upsert_retail_variant would give
    -- it (0145:205-206).
    select c.kind into v_kind from menu_categories c where c.id = v_item.category_id;
    for v_el in select e from jsonb_array_elements(coalesce(v_p->'renames', '[]'::jsonb)) e loop
      select * into v_v from menu_item_variants where id = (v_el->>'variant_id')::uuid for update;
      perform app.upsert_variant_internal(v_item.id, v_el->>'name_en', v_el->>'name_ar', v_v.price_iqd,
                                          v_v.id, v_v.is_default, v_v.sort_order);
      if v_kind = 'shop' then
        update ingredients
           set name_en = left(btrim(v_item.name_en || ' ' || (v_el->>'name_en')), 200),
               name_ar = left(btrim(v_item.name_ar || ' ' || (v_el->>'name_ar')), 200)
         where variant_id = v_v.id and kind = 'retail';
      end if;
      v_r := v_r + 1;
    end loop;
    -- The product goes on sale: the internal stamps launched_at.
    if v_change = 'shop_launch' then
      perform app.upsert_menu_item_internal(v_item.category_id, v_item.name_en, v_item.name_ar, v_item.id,
                                            v_item.description_en, v_item.description_ar, v_item.sort_order,
                                            true, v_item.hook_en, v_item.hook_ar, v_item.highlight,
                                            v_item.serve_temp);
    end if;
    v_counts := jsonb_build_object('sizes', v_a, 'new_sizes', v_b, 'renamed', v_r);

  elsif v_change = 'addon_price' then
    -- A never-launched add-on goes on sale (the internal stamps it); a
    -- launched one keeps its switch as it is.
    for v_el in select e from jsonb_array_elements(coalesce(v_n->'addons', v_p->'addons')) e loop
      select * into v_m from modifiers where id = (v_el->>'modifier_id')::uuid for update;
      perform app.upsert_modifier_internal(v_m.group_id, v_m.name_en, v_m.name_ar, v_m.id,
                                           (v_el->>'price_delta_iqd')::bigint, v_m.sort_order,
                                           case when v_m.launched_at is not null or v_m.is_active
                                                then v_m.is_active else true end);
      v_a := v_a + 1;
      v_b := v_b + case when v_m.launched_at is null and not v_m.is_active then 1 else 0 end;
    end loop;
    -- Renamed add-ons (#9) keep their price as it now stands, their switch
    -- and their order.
    for v_el in select e from jsonb_array_elements(coalesce(v_p->'renames', '[]'::jsonb)) e loop
      select * into v_m from modifiers where id = (v_el->>'modifier_id')::uuid for update;
      perform app.upsert_modifier_internal(v_m.group_id, v_el->>'name_en', v_el->>'name_ar', v_m.id,
                                           v_m.price_delta_iqd, v_m.sort_order, v_m.is_active);
      v_r := v_r + 1;
    end loop;
    v_counts := jsonb_build_object('addons', v_a, 'launched', v_b, 'renamed', v_r);

  elsif v_change in ('promotion', 'promotion_edit') then
    v_f := v_p->'promotion';
    v_value := coalesce((v_n->>'promotion_value')::int, (v_f->>'value')::int);
    perform app.upsert_promotion_internal(
      coalesce(v_run.promotion_id, (v_p->>'promotion_id')::uuid),
      v_f->>'name_en', v_f->>'name_ar', v_f->>'type', v_value,
      (v_f->>'starts_at')::timestamptz, (v_f->>'ends_at')::timestamptz,
      array(select jsonb_array_elements_text(v_f->'weekdays')::int),
      (v_f->>'hour_from')::time, (v_f->>'hour_to')::time,
      v_f->'scope', v_f->'limits', (v_f->>'auto')::boolean,
      -- A new promotion's code is the record's, none when it has none; an
      -- edit keeps the stored code unless the record names one ('' clears).
      case when v_change = 'promotion' then coalesce(v_f->>'public_code', '') else v_f->>'public_code' end,
      (v_f->>'code_single_use')::boolean,
      -- An edit never switches a promotion on or off.
      case when v_change = 'promotion' then false
           else (select p.enabled from promotions p where p.id = (v_p->>'promotion_id')::uuid) end);
    if v_change = 'promotion' then
      perform app.set_promotion_enabled_internal(v_run.promotion_id, true);
    end if;
    v_counts := jsonb_build_object('value', v_value);

  elsif v_change = 'promotion_enable' then
    perform app.set_promotion_enabled_internal((v_p->>'promotion_id')::uuid, true);
    v_counts := '{}'::jsonb;

  elsif v_change = 'rate' then
    v_f := v_p->'rule';
    perform app.upsert_rate_rule_internal(
      v_f->>'name',
      array(select jsonb_array_elements_text(v_f->'days_of_week')::int),
      (v_f->>'start_time')::time, (v_f->>'end_time')::time,
      coalesce(v_n->'rule_prices', v_f->'prices'),
      (v_p->>'rule_id')::uuid, (v_f->>'court_id')::uuid, (v_f->>'priority')::int,
      (v_f->>'valid_from')::date, (v_f->>'valid_to')::date, (v_f->>'is_active')::boolean);
    v_counts := jsonb_build_object('durations',
                  (select count(*) from jsonb_object_keys(coalesce(v_n->'rule_prices', v_f->'prices'))));

  elsif v_change = 'featured_discount' then
    -- The item first, then the discount, then Featured mode when the
    -- approved discount is above 0: the discount that goes live is the
    -- approved one, on the approved item.
    v_pct := coalesce((v_n->>'discount_pct')::int, (v_p->>'discount_pct')::int);
    if lower(app.cafe_setting_text('featured_item_id')) is distinct from v_p->>'menu_item_id' then
      perform app.set_cafe_setting_internal('featured_item_id', v_p->'menu_item_id');
      v_a := v_a + 1;
    end if;
    perform app.set_cafe_setting_internal('featured_discount_pct', to_jsonb(v_pct));
    v_a := v_a + 1;
    if v_pct > 0 and app.cafe_setting_text('hero_mode') is distinct from 'featured' then
      perform app.set_cafe_setting_internal('hero_mode', '"featured"'::jsonb);
      v_a := v_a + 1;
    end if;
    v_counts := jsonb_build_object('settings', v_a);

  elsif v_change in ('lesson_price', 'lesson_launch') then
    -- The approved figures (the numbers', else the proposal's; a
    -- lesson_price carries only the ones it changes) through the internal,
    -- which validates as upsert_lesson_type does. lesson_launch also switches
    -- the type on, and the internal stamps launched_at. Lessons and courses
    -- already booked keep their snapshots.
    v_f := jsonb_strip_nulls(jsonb_build_object(
             'price_iqd',       coalesce(v_n->'price_iqd', v_p->'price_iqd'),
             'court_share_iqd', coalesce(v_n->'court_share_iqd', v_p->'court_share_iqd')));
    if v_change = 'lesson_launch' then
      v_f := v_f || jsonb_build_object('is_active', true);
    end if;
    perform app.upsert_lesson_type_internal(v_run.venue_id, (v_p->>'lesson_type_id')::uuid, v_f);
    v_counts := jsonb_build_object('lesson_types', 1)
                || case when v_change = 'lesson_launch' then jsonb_build_object('launched', 1) else '{}'::jsonb end;

  elsif v_change = 'coach_price' then
    -- The coach's own price, or none (the type's price applies again), with
    -- the run that approved it.
    perform app.set_coach_price_internal((v_p->>'coach_id')::uuid, (v_p->>'lesson_type_id')::uuid,
                                         coalesce((v_n->>'price_iqd')::bigint, (v_p->>'price_iqd')::bigint),
                                         v_run.id);
    v_counts := jsonb_build_object('coach_prices', 1);
  end if;

  -- The owner who approved the numbers authorises every discount the
  -- promotion gives from now on: apply_best_promotion writes
  -- promotions.created_by as tab_adjustments.authorized_by, and day close
  -- names that person (0067:800-809). Never the proposer, who may be a
  -- marketing account with no discount authority.
  if v_change in ('promotion', 'promotion_edit', 'promotion_enable') then
    select x.decided_by into v_ok_by
      from protocol_submissions x
      join protocol_run_steps s on s.id = x.run_step_id
     where x.run_id = v_run.id and s.step_key = 'numbers'
       and x.decision in ('approve', 'auto')
     order by x.round desc, x.decided_at desc, x.id desc
     limit 1;
    update promotions set created_by = v_ok_by
     where id = coalesce(v_run.promotion_id, (v_p->>'promotion_id')::uuid)
       and created_by is distinct from v_ok_by;
  end if;

  update protocol_runs set status = 'done', finished_at = now() where id = v_run.id;

  perform app.write_audit(
    case when v_change in ('promotion', 'promotion_edit', 'promotion_enable')
         then 'protocol.promo.apply' else 'protocol.price.apply' end,
    'protocol_run', v_run.id::text,
    jsonb_build_object('status', v_run.status),
    jsonb_build_object('run_id', v_run.id, 'change', v_change, 'counts', v_counts)
    || case when v_ok_by is not null then jsonb_build_object('authorized_by', v_ok_by) else '{}'::jsonb end);

  return jsonb_build_object('run_id', v_run.id, 'change', v_change, 'counts', v_counts)
         || case when v_ok_by is not null then jsonb_build_object('authorized_by', v_ok_by) else '{}'::jsonb end;
end $price_promo_apply_internal_0282$;

comment on function app.price_promo_apply_internal(uuid) is
  'price_promo (§2.13). Internal: applies an active (pass hook) or scheduled (cron) price or promotion change: app.venue_id set to the run''s venue, a lesson change''s type row locked (price_promo_lessons), app.price_promo_check_targets, then the approved figures (numbers, else the proposal''s) through the internals: price (sizes, new sizes after the last, then the proposal''s renames, each size keeping its row, recipe and current price, a shop size''s retail stock row renamed with it), shop_launch (sizes, then the product switched on and stamped launched), addon_price (a never-launched add-on switched on and stamped, a launched one keeps its switch; then the renames, each keeping its price, switch and order), promotion (the draft updated, then switched on), promotion_edit (the approved fields and value, the switch kept), promotion_enable, rate (the rule and its prices), featured_discount (the item when it moves, the discount, then Featured mode when the discount is above 0), lesson_price (the type''s price and court share it changes, app.upsert_lesson_type_internal), lesson_launch (the same, switched on and stamped launched), coach_price (app.set_coach_price_internal with the run''s id; a null price removes the coach''s own). The three promotion kinds then name the owner who approved the numbers as the promotion''s created_by, which apply_best_promotion records as every redemption''s authorized_by (0067). The run is done. Audit protocol.price.apply or protocol.promo.apply {run_id, change, counts (price and shop_launch: sizes, new_sizes, renamed; addon_price: addons, launched, renamed; lesson_price: lesson_types; lesson_launch: lesson_types, launched; coach_price: coach_prices), authorized_by (promotion kinds)}; returns the same.';

revoke all on function app.price_promo_apply_internal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The start form's targets: the venue's lesson types, and its coaches
--    with the types they teach (app.price_promo_targets, 0177:2747).
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_targets(p_change text, p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_targets_0282$
declare
  v_venue uuid;
  v_mgmt  boolean;
begin
  if not app.is_staff('manager', 'marketing', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'marketing', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_change is null or p_change not in ('price', 'shop_launch', 'addon_price', 'promotion_edit',
                                          'promotion_enable', 'rate', 'featured_discount',
                                          'lesson_price', 'lesson_launch', 'coach_price') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'change';
  end if;
  v_mgmt := app.is_staff_at(v_venue, 'manager', 'owner');
  -- Hidden products are not offered to marketing (§2.8), nor lesson prices
  -- (C-17, price_promo_lessons).
  if p_change in ('shop_launch', 'lesson_price', 'lesson_launch', 'coach_price') and not v_mgmt then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_change in ('price', 'shop_launch', 'featured_discount') then
    return (
      with items as (
        select mi.id, mi.name_en, mi.name_ar, mi.is_active, c.kind as category_kind,
               c.sort_order as c_sort, mi.sort_order as i_sort
          from menu_items mi
          join menu_categories c on c.id = mi.category_id
         where mi.venue_id = v_venue
           and case p_change
                 -- launched (or on sale), not in a release, cafe or shop
                 when 'price' then (mi.launched_at is not null or mi.is_active)
                                   and not exists (select 1 from protocol_runs rr
                                                    where rr.id = mi.release_run_id
                                                      and rr.status not in ('live', 'done'))
                 -- never on sale, hidden, in a shop category, not in a release
                 when 'shop_launch' then c.kind = 'shop' and mi.launched_at is null and not mi.is_active
                                         and not exists (select 1 from protocol_runs rr
                                                          where rr.id = mi.release_run_id
                                                            and rr.status not in ('live', 'done'))
                 -- on sale today
                 else mi.is_active
               end),
      shaped as (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'menu_item_id',  i.id,
                 'name_en',       i.name_en,
                 'name_ar',       i.name_ar,
                 'category_kind', i.category_kind)
                 || case when p_change = 'featured_discount' then '{}'::jsonb
                         else jsonb_build_object('is_active', i.is_active) end
                 || jsonb_build_object('sizes', coalesce((
                      select jsonb_agg(jsonb_build_object('variant_id', v.id, 'name_en', v.name_en,
                                                          'name_ar', v.name_ar, 'price_iqd', v.price_iqd)
                                       order by v.sort_order, v.id)
                        from menu_item_variants v where v.item_id = i.id), '[]'::jsonb))
                 order by i.c_sort, i.i_sort, i.name_en, i.id), '[]'::jsonb) as list
          from items i)
      select case when p_change = 'featured_discount'
                  then jsonb_build_object(
                         'featured_item_id',      app.cafe_setting('featured_item_id'),
                         'featured_discount_pct', app.cafe_setting('featured_discount_pct'),
                         'hero_mode',             app.cafe_setting('hero_mode'),
                         'items',                 s.list)
                  else jsonb_build_object('items', s.list) end
        from shaped s);
  end if;

  if p_change = 'addon_price' then
    return jsonb_build_object('addons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'modifier_id',   m.id,
               'group_id',      g.id,
               'group_name_en', g.name_en,
               'group_name_ar', g.name_ar,
               'name_en',       m.name_en,
               'name_ar',       m.name_ar,
               'price_delta_iqd', m.price_delta_iqd,
               'is_active',     m.is_active,
               'launched',      m.launched_at is not null or m.is_active)
             order by g.name_en, g.id, m.sort_order, m.id)
        from modifiers m
        join modifier_groups g on g.id = m.group_id
       where g.venue_id = v_venue
         and (m.launched_at is not null or m.is_active or v_mgmt)), '[]'::jsonb));
  end if;

  if p_change in ('promotion_edit', 'promotion_enable') then
    return jsonb_build_object('promotions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'promotion_id',    p.id,
               'name_en',         p.name_en,
               'name_ar',         p.name_ar,
               'type',            p.type,
               'value',           p.value,
               'starts_at',       p.starts_at,
               'ends_at',         p.ends_at,
               'weekdays',        to_jsonb(p.weekdays),
               'hour_from',       p.hour_from,
               'hour_to',         p.hour_to,
               'scope',           p.scope,
               'limits',          p.limits,
               'auto',            p.auto,
               'public_code',     p.public_code,
               'code_single_use', p.code_single_use,
               'enabled',         p.enabled,
               'updated_at',      p.updated_at)
             order by p.enabled desc, p.name_en, p.id)
        from promotions p
       where p_change = 'promotion_edit' or not p.enabled), '[]'::jsonb));
  end if;

  -- lesson_price: the venue's launched lesson types, on or off; lesson_launch:
  -- its drafts (never launched, switched off) with their draft figures
  -- (price_promo_lessons; X28).
  if p_change in ('lesson_price', 'lesson_launch') then
    return jsonb_build_object('lesson_types', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lesson_type_id',  lt.id,
               'kind',            lt.kind,
               'name_en',         lt.name_en,
               'name_ar',         lt.name_ar,
               'duration_min',    lt.duration_min,
               'sessions_count',  lt.sessions_count,
               'max_places',      lt.max_places,
               'price_iqd',       lt.price_iqd,
               'court_share_iqd', lt.court_share_iqd,
               'is_active',       lt.is_active)
             order by array_position(array['private', 'group', 'course'], lt.kind), lt.sort_order, lt.name_en, lt.id)
        from lesson_types lt
       where lt.venue_id = v_venue
         and case when p_change = 'lesson_price' then lt.launched_at is not null
                  else lt.launched_at is null and not lt.is_active end), '[]'::jsonb));
  end if;

  -- coach_price: the coaches not retired who teach at the venue (an active
  -- branch row, or a type they teach there), each with the types they teach
  -- there, the type's price and their own (null when none).
  if p_change = 'coach_price' then
    return jsonb_build_object('coaches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'coach_id',        c.id,
               'display_name_en', c.display_name_en,
               'display_name_ar', c.display_name_ar,
               'lesson_types',    coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'lesson_type_id',  lt.id,
                          'name_en',         lt.name_en,
                          'name_ar',         lt.name_ar,
                          'kind',            lt.kind,
                          'sessions_count',  lt.sessions_count,
                          'type_price_iqd',  lt.price_iqd,
                          'coach_price_iqd', cp.price_iqd)
                        order by array_position(array['private', 'group', 'course'], lt.kind),
                                 lt.sort_order, lt.name_en, lt.id)
                   from coach_lesson_types clt
                   join lesson_types lt on lt.id = clt.lesson_type_id
                   left join coach_prices cp on cp.coach_id = clt.coach_id and cp.lesson_type_id = clt.lesson_type_id
                  where clt.coach_id = c.id and clt.venue_id = v_venue), '[]'::jsonb))
             order by c.sort_order, c.display_name_en, c.id)
        from coaches c
       where c.status <> 'retired'
         and (exists (select 1 from coach_branches cb
                       where cb.coach_id = c.id and cb.venue_id = v_venue and cb.active)
              or exists (select 1 from coach_lesson_types clt
                          where clt.coach_id = c.id and clt.venue_id = v_venue))), '[]'::jsonb));
  end if;

  -- rate: the venue's rules, on or off.
  return jsonb_build_object('rules', coalesce((
    select jsonb_agg(jsonb_build_object(
             'rule_id',       r.id,
             'name',          r.name,
             'court_id',      r.court_id,
             'court_name_en', c.name_en,
             'court_name_ar', c.name_ar,
             'days_of_week',  to_jsonb(r.days_of_week),
             'start_time',    r.start_time,
             'end_time',      r.end_time,
             'priority',      r.priority,
             'valid_from',    r.valid_from,
             'valid_to',      r.valid_to,
             'is_active',     r.is_active,
             'prices',        coalesce((select jsonb_object_agg(rp.duration_min::text, rp.price_iqd)
                                          from rate_rule_prices rp where rp.rule_id = r.id), '{}'::jsonb))
           order by r.is_active desc, r.priority desc, r.name, r.id)
      from rate_rules r
      left join courts c on c.id = r.court_id
     where r.venue_id = v_venue), '[]'::jsonb));
end $price_promo_targets_0282$;

comment on function app.price_promo_targets(text, uuid) is
  'price_promo (§2.13). Manager, marketing or owner at the venue (shop_launch and the lesson kinds: MGMT only): the targets a price or promotion change may name. price: {items: [{menu_item_id, name_en, name_ar, category_kind, is_active, sizes: [{variant_id, name_en, name_ar, price_iqd}]}]}, launched items not in release, cafe and shop; shop_launch: the same shape, hidden never-launched shop products not in release; addon_price: {addons: [{modifier_id, group_id, group_name_en, group_name_ar, name_en, name_ar, price_delta_iqd, is_active, launched}]}, launched add-ons plus, for MGMT, hidden never-launched ones; promotion_edit / promotion_enable: {promotions: [...]} (every promotion / the switched-off ones), no redemption count; rate: {rules: [{rule_id, name, court_id, court_name_en, court_name_ar, days_of_week, start_time, end_time, priority, valid_from, valid_to, is_active, prices}]}; featured_discount: {featured_item_id, featured_discount_pct, hero_mode, items: [...]}, active items; lesson_price / lesson_launch (price_promo_lessons, X28): {lesson_types: [{lesson_type_id, kind, name_en, name_ar, duration_min, sessions_count, max_places, price_iqd, court_share_iqd, is_active}]}, the launched types / the drafts (never launched, switched off) at the venue; coach_price: {coaches: [{coach_id, display_name_en, display_name_ar, lesson_types: [{lesson_type_id, name_en, name_ar, kind, sessions_count, type_price_iqd, coach_price_iqd}]}]}, coaches not retired who teach at the venue, with the types they teach there. No cost, no sales. FORBIDDEN, INVALID_ARGUMENT (hint change).';

revoke all on function app.price_promo_targets(text, uuid) from public, anon;
grant execute on function app.price_promo_targets(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The figures: a lesson block beside the sizes and add-ons
--    (app.price_promo_numbers, 0195:850).
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_numbers(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_numbers_0282$
declare
  v_run    protocol_runs%rowtype;
  v_p      jsonb;
  v_n      jsonb;
  v_change text;
  v_from   timestamptz := now() - interval '30 days';
  v_tz     text;
  v_hour   int;
  v_sizes  jsonb := '[]'::jsonb;
  v_addons jsonb := '[]'::jsonb;
  v_renames jsonb := '[]'::jsonb;
  v_promo  jsonb;
  v_rate   jsonb;
  v_feat   jsonb;
  v_f      jsonb;
  v_type   text;
  v_value  int;
  v_items  jsonb;
  v_cats   jsonb;
  v_courts jsonb;
  v_cur    promotions%rowtype;
  v_item   uuid;
  v_pct    int;
  v_text   text;
  v_lesson jsonb;
  v_lt_id  uuid;
  v_coach  uuid;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or v_run.kind <> 'price_promo'
     or not (v_run.venue_id = any(app.staff_venue_ids()))
     or not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The proposal and the figures that count: the passed or pending ones of
  -- the latest round (a withdrawn, set-aside or sent-back one never counts);
  -- a figure the numbers leave out is the proposal's.
  select x.record into v_p
    from protocol_submissions x
    join protocol_run_steps s on s.id = x.run_step_id
   where x.run_id = v_run.id and s.step_key = 'propose'
     and x.withdrawn_at is null and x.superseded_at is null
     and (x.decision is null or x.decision in ('approve', 'auto'))
   order by x.round desc, x.submitted_at desc, x.id desc
   limit 1;
  select x.record into v_n
    from protocol_submissions x
    join protocol_run_steps s on s.id = x.run_step_id
   where x.run_id = v_run.id and s.step_key = 'numbers'
     and x.withdrawn_at is null and x.superseded_at is null
     and (x.decision is null or x.decision in ('approve', 'auto'))
   order by x.round desc, x.submitted_at desc, x.id desc
   limit 1;
  v_change := v_p->>'change';

  v_tz := coalesce((select v.timezone from venues v where v.id = v_run.venue_id), 'Asia/Baghdad');
  v_hour := coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4);

  if v_change in ('price', 'shop_launch') then
    with fig as (
      select (e->>'variant_id')::uuid as variant_id, (e->>'price_iqd')::bigint as new_price, o
        from jsonb_array_elements(coalesce(v_n->'prices', v_p->'prices', '[]'::jsonb)) with ordinality as t(e, o)),
    lines as (
      -- The recipe cost, from each ingredient's latest batch, else its pack
      -- cost; a line with neither makes the size's cost unknown (never 0).
      select rl.variant_id,
             rl.qty / (i.yield_percent / 100.0)
             * coalesce((select b.unit_cost_iqd from stock_batches b
                          where b.ingredient_id = i.id
                          order by b.received_at desc, b.id desc limit 1),
                        i.pack_cost_iqd::numeric / nullif(i.pack_size, 0)) as cost
        from recipe_lines rl
        join ingredients i on i.id = rl.ingredient_id
       where rl.variant_id in (select f.variant_id from fig f)),
    cost as (
      select l.variant_id, round(sum(l.cost))::bigint as cost_iqd, bool_and(l.cost is not null) as known
        from lines l group by l.variant_id),
    sales as (
      select l.variant_id, sum(l.net_qty)::bigint as units, sum(l.net_line_iqd)::bigint as revenue
        from app.analytics_sales_lines('settled', v_from, now(), v_tz, v_hour) l
       where l.variant_id in (select f.variant_id from fig f)
       group by l.variant_id)
    select coalesce(jsonb_agg(jsonb_build_object(
             'variant_id',        v.id,
             'name_en',           v.name_en,
             'name_ar',           v.name_ar,
             'current_price_iqd', v.price_iqd,
             'new_price_iqd',     f.new_price,
             'cost_iqd',          coalesce(c.cost_iqd, 0),
             'cost_known',        coalesce(c.known, false),
             'margin_before_iqd', case when c.known then v.price_iqd - c.cost_iqd end,
             'margin_after_iqd',  case when c.known then f.new_price - c.cost_iqd end,
             'units_30d',         coalesce(s.units, 0),
             'revenue_30d_iqd',   coalesce(s.revenue, 0))
             order by f.o), '[]'::jsonb)
      into v_sizes
      from fig f
      join menu_item_variants v on v.id = f.variant_id
      left join cost c on c.variant_id = f.variant_id
      left join sales s on s.variant_id = f.variant_id;

    -- New sizes: no recipe, no sales yet.
    v_sizes := v_sizes || coalesce((
      select jsonb_agg(jsonb_build_object(
               'variant_id',        null,
               'name_en',           coalesce(e->>'name_en', e->>'name_ar'),
               'name_ar',           coalesce(e->>'name_ar', e->>'name_en'),
               'current_price_iqd', null,
               'new_price_iqd',     (e->>'price_iqd')::bigint,
               'cost_iqd',          0,
               'cost_known',        false,
               'margin_before_iqd', null,
               'margin_after_iqd',  null,
               'units_30d',         0,
               'revenue_30d_iqd',   0)
               order by o)
        from jsonb_array_elements(coalesce(v_n->'new_sizes', v_p->'new_sizes', '[]'::jsonb)) with ordinality as t(e, o)),
      '[]'::jsonb);

    -- Renamed sizes (#9), from the proposal: the price is what the size sells
    -- at once applied, this change's figure for it or else its price now.
    select coalesce(jsonb_agg(jsonb_build_object(
             'target',    'size',
             'id',        v.id,
             'from_en',   coalesce(e->>'before_en', v.name_en),
             'from_ar',   coalesce(e->>'before_ar', v.name_ar),
             'to_en',     e->>'name_en',
             'to_ar',     e->>'name_ar',
             'price_iqd', coalesce((select (x->>'price_iqd')::bigint
                                      from jsonb_array_elements(coalesce(v_n->'prices', v_p->'prices', '[]'::jsonb)) x
                                     where x->>'variant_id' = v.id::text), v.price_iqd))
             order by o), '[]'::jsonb)
      into v_renames
      from jsonb_array_elements(coalesce(v_p->'renames', '[]'::jsonb)) with ordinality as t(e, o)
      join menu_item_variants v on v.id = (e->>'variant_id')::uuid;

  elsif v_change = 'addon_price' then
    with fig as (
      select (e->>'modifier_id')::uuid as modifier_id, (e->>'price_delta_iqd')::bigint as new_delta, o
        from jsonb_array_elements(coalesce(v_n->'addons', v_p->'addons', '[]'::jsonb)) with ordinality as t(e, o)),
    used as (
      select oim.modifier_id,
             sum(oim.qty * l.net_qty)::bigint                     as cnt,
             sum(oim.price_delta_iqd * oim.qty * l.net_qty)::bigint as revenue
        from app.analytics_sales_lines('settled', v_from, now(), v_tz, v_hour) l
        join order_item_modifiers oim on oim.order_item_id = l.order_item_id
       where oim.modifier_id in (select f.modifier_id from fig f)
       group by oim.modifier_id)
    select coalesce(jsonb_agg(jsonb_build_object(
             'modifier_id',       m.id,
             'group_name_en',     g.name_en,
             'group_name_ar',     g.name_ar,
             'name_en',           m.name_en,
             'name_ar',           m.name_ar,
             'current_delta_iqd', m.price_delta_iqd,
             'new_delta_iqd',     f.new_delta,
             'count_30d',         coalesce(u.cnt, 0),
             'revenue_30d_iqd',   coalesce(u.revenue, 0))
             order by f.o), '[]'::jsonb)
      into v_addons
      from fig f
      join modifiers m on m.id = f.modifier_id
      join modifier_groups g on g.id = m.group_id
      left join used u on u.modifier_id = f.modifier_id;

    -- Renamed add-ons (#9), the same way.
    select coalesce(jsonb_agg(jsonb_build_object(
             'target',    'addon',
             'id',        m.id,
             'from_en',   coalesce(e->>'before_en', m.name_en),
             'from_ar',   coalesce(e->>'before_ar', m.name_ar),
             'to_en',     e->>'name_en',
             'to_ar',     e->>'name_ar',
             'price_iqd', coalesce((select (x->>'price_delta_iqd')::bigint
                                      from jsonb_array_elements(coalesce(v_n->'addons', v_p->'addons', '[]'::jsonb)) x
                                     where x->>'modifier_id' = m.id::text), m.price_delta_iqd))
             order by o), '[]'::jsonb)
      into v_renames
      from jsonb_array_elements(coalesce(v_p->'renames', '[]'::jsonb)) with ordinality as t(e, o)
      join modifiers m on m.id = (e->>'modifier_id')::uuid;

  elsif v_change in ('promotion', 'promotion_edit', 'promotion_enable') then
    -- The approved value over the last 30 days' matching lines of the
    -- venue: per tab, as a promotion applies (app.promotion_amount_iqd).
    if v_change = 'promotion_enable' or v_change = 'promotion_edit' then
      select * into v_cur from promotions where id = (v_p->>'promotion_id')::uuid;
    end if;
    v_f := case when v_change = 'promotion_enable' then to_jsonb(v_cur) else v_p->'promotion' end;
    v_type := v_f->>'type';
    v_value := coalesce((v_n->>'promotion_value')::int, (v_f->>'value')::int);
    v_items := coalesce(v_f->'scope'->'itemIds', '[]'::jsonb);
    v_cats := coalesce(v_f->'scope'->'categoryIds', '[]'::jsonb);
    v_courts := coalesce(v_f->'scope'->'courtIds', '[]'::jsonb);
    with lines as (
      select l.tab_id, l.net_qty, l.net_line_iqd
        from app.analytics_sales_lines('settled', v_from, now(), v_tz, v_hour) l
        join menu_items mi on mi.id = l.menu_item_id
       where mi.venue_id = v_run.venue_id
         and ((jsonb_array_length(v_items) = 0 and jsonb_array_length(v_cats) = 0)
              or v_items ? l.menu_item_id::text or v_cats ? mi.category_id::text)
         and (jsonb_array_length(v_courts) = 0
              or exists (select 1 from tabs t join reservations r on r.id = t.reservation_id
                          where t.id = l.tab_id and v_courts ? r.court_id::text))),
    per_tab as (
      select sum(ln.net_line_iqd)::bigint as base from lines ln group by ln.tab_id)
    select jsonb_build_object(
             'current_value',         case when v_change = 'promotion' then null else v_cur.value end,
             'new_value',             v_value,
             'discount_cost_30d_iqd', coalesce((select sum(app.promotion_amount_iqd(pt.base, v_type, v_value))
                                                  from per_tab pt where pt.base > 0), 0)::bigint,
             'units_30d',             coalesce((select sum(ln.net_qty) from lines ln), 0)::bigint,
             'revenue_30d_iqd',       coalesce((select sum(ln.net_line_iqd) from lines ln), 0)::bigint)
      into v_promo;

  elsif v_change = 'rate' then
    v_rate := jsonb_build_object(
      'durations', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'duration_min',      k.key::int,
                 'current_price_iqd', (select rp.price_iqd from rate_rule_prices rp
                                        where rp.rule_id = (v_p->>'rule_id')::uuid
                                          and rp.duration_min = k.key::int),
                 'new_price_iqd',     (k.value #>> '{}')::bigint)
                 order by k.key::int)
          from jsonb_each(coalesce(v_n->'rule_prices', v_p->'rule'->'prices', '{}'::jsonb)) as k), '[]'::jsonb),
      'bookings_30d', (select count(*) from reservations r
                        where r.rate_rule_id = (v_p->>'rule_id')::uuid and r.kind = 'booking'
                          and r.status not in ('cancelled', 'expired')
                          and r.start_at >= v_from and r.start_at < now()),
      'revenue_30d_iqd', coalesce((select sum(r.price_iqd) from reservations r
                                    where r.rate_rule_id = (v_p->>'rule_id')::uuid and r.kind = 'booking'
                                      and r.status not in ('cancelled', 'expired')
                                      and r.start_at >= v_from and r.start_at < now()), 0)::bigint);

  elsif v_change = 'featured_discount' then
    v_item := (v_p->>'menu_item_id')::uuid;
    v_pct := coalesce((v_n->>'discount_pct')::int, (v_p->>'discount_pct')::int);
    v_text := app.cafe_setting_text('featured_item_id');
    with lines as (
      select l.net_qty, l.list_price_iqd
        from app.analytics_sales_lines('settled', v_from, now(), v_tz, v_hour) l
       where l.menu_item_id = v_item)
    select jsonb_build_object(
             'current_item_id',   case when v_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                       then v_text::uuid end,
             'new_item_id',       v_item,
             'current_pct',       coalesce(app.cafe_setting_int('featured_discount_pct'), 0),
             'new_pct',           v_pct,
             'current_hero_mode', app.cafe_setting_text('hero_mode'),
             'sizes',             coalesce((select jsonb_agg(jsonb_build_object(
                                                'variant_id', v.id, 'name_en', v.name_en,
                                                'name_ar', v.name_ar, 'price_iqd', v.price_iqd)
                                              order by v.sort_order, v.id)
                                              from menu_item_variants v where v.item_id = v_item), '[]'::jsonb),
             'units_30d',         coalesce((select sum(ln.net_qty) from lines ln), 0)::bigint,
             'discount_cost_30d_iqd',
                                  case when v_pct > 0
                                       then coalesce((select sum(ln.net_qty * (ln.list_price_iqd
                                                          - app.apply_pct_discount(ln.list_price_iqd, v_pct)))
                                                        from lines ln), 0)::bigint
                                       else 0 end)
      into v_feat;

  elsif v_change in ('lesson_price', 'lesson_launch', 'coach_price') then
    -- The lesson type priced (and, for a coach price, the coach): the price
    -- and court share now and once applied (a figure neither step carries
    -- stays as it is; a coach price removed falls back to the type's), and
    -- the last 30 days' booked sign-ups of that type (and coach) at their
    -- snapshot prices: a private lesson or a group place by its lesson's
    -- start, a course sign-up by its first covered session's. Lesson tables
    -- only; no coach pay (C-28). price_promo_lessons, X28.
    v_lt_id := (v_p->>'lesson_type_id')::uuid;
    v_coach := case when v_change = 'coach_price' then (v_p->>'coach_id')::uuid end;
    with sold as (
      select e.price_iqd
        from lesson_enrolments e
        join lessons l on l.id = e.lesson_id
       where l.lesson_type_id = v_lt_id
         and (v_coach is null or l.coach_id = v_coach)
         and e.status = 'booked'
         and l.start_at >= v_from and l.start_at < now()
      union all
      select e.price_iqd
        from lesson_enrolments e
        join courses c on c.id = e.course_id
        join lessons l on l.course_id = c.id and l.session_no = e.first_session_no
       where c.lesson_type_id = v_lt_id
         and (v_coach is null or c.coach_id = v_coach)
         and e.status = 'booked'
         and l.start_at >= v_from and l.start_at < now())
    select jsonb_build_object(
             'lesson_type_id',          lt.id,
             'coach_id',                v_coach,
             'kind',                    lt.kind,
             'name_en',                 lt.name_en,
             'name_ar',                 lt.name_ar,
             'current_price_iqd',       case when v_coach is not null then coalesce(cp.price_iqd, lt.price_iqd)
                                             else lt.price_iqd end,
             'new_price_iqd',           coalesce((v_n->>'price_iqd')::bigint, (v_p->>'price_iqd')::bigint,
                                                 lt.price_iqd),
             'current_court_share_iqd', lt.court_share_iqd,
             'new_court_share_iqd',     coalesce((v_n->>'court_share_iqd')::bigint,
                                                 (v_p->>'court_share_iqd')::bigint, lt.court_share_iqd),
             'places_30d',              (select count(*) from sold),
             'owed_30d_iqd',            (select coalesce(sum(s.price_iqd), 0) from sold s)::bigint)
      into v_lesson
      from lesson_types lt
      left join coach_prices cp on cp.lesson_type_id = lt.id and cp.coach_id = v_coach
     where lt.id = v_lt_id;
  end if;

  return jsonb_build_object(
    'change',    v_change,
    'sizes',     v_sizes,
    'addons',    v_addons,
    'renames',   v_renames,
    'promotion', v_promo,
    'rate',      v_rate,
    'featured',  v_feat,
    'lesson',    v_lesson);
end $price_promo_numbers_0282$;

comment on function app.price_promo_numbers(uuid) is
  'price_promo (§2.13). MGMT at the run''s venue: the figures behind a price or promotion change, from its standing proposal and numbers (a figure the numbers leave out is the proposal''s): {change, sizes: [{variant_id (null for a new size), name_en, name_ar, current_price_iqd, new_price_iqd, cost_iqd, cost_known, margin_before_iqd, margin_after_iqd, units_30d, revenue_30d_iqd}], addons: [{modifier_id, group_name_en, group_name_ar, name_en, name_ar, current_delta_iqd, new_delta_iqd, count_30d, revenue_30d_iqd}], renames: [{target size|addon, id, from_en, from_ar, to_en, to_ar, price_iqd (what it sells at once applied: this change''s figure, else its price now)}] (price_promo_renames, #9; [] for every other change), promotion: {current_value, new_value, discount_cost_30d_iqd, units_30d, revenue_30d_iqd} | null, rate: {durations: [{duration_min, current_price_iqd, new_price_iqd}], bookings_30d, revenue_30d_iqd} | null, featured: {current_item_id, new_item_id, current_pct, new_pct, current_hero_mode, sizes, units_30d, discount_cost_30d_iqd} | null, lesson: {lesson_type_id, coach_id (coach_price, else null), kind, name_en, name_ar, current_price_iqd (a coach price: the coach''s own, else the type''s), new_price_iqd (once applied; a removed coach price falls back to the type''s), current_court_share_iqd, new_court_share_iqd, places_30d, owed_30d_iqd (booked sign-ups of the type and coach whose lesson, or first covered course session, started in the last 30 days, at their snapshot prices)} | null (price_promo_lessons; X28)}. Cost is the recipe cost (latest batch, else pack cost; unknown when a line has neither); sales are the last 30 days'' settled lines. No coach pay (C-28). PROTOCOL_NOT_FOUND.';

revoke all on function app.price_promo_numbers(uuid) from public, anon;
grant execute on function app.price_promo_numbers(uuid) to authenticated;
