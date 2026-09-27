-- 0195 price_promo_renames — a manager renames a size of an item on sale, or
-- a paid add-on on sale, through a price change, never directly.
--
-- Feature: protocols and the staff phone, wave 5, lane N
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.2, §2.10, §3, §6.1;
-- Majed's answer #9: "price changes").
-- Depends on: price_promo (0177, committed: the locks, the change kinds and
-- the internals re-issued here). Its tests create an assistant_barista and a
-- waiter, so it commits after staff_roles_assistant_waiter (V7).
-- Re-runnable: create or replace.
--
-- THE LOCK. A manager's upsert_variant that changes either name of an
-- existing size of an item that is not a draft (launched_at set, or switched
-- on), cafe or shop, and a manager's upsert_modifier that changes either name
-- of a launched add-on whose stored price is above 0, raise
-- PRICE_VIA_PROTOCOL hint name. The code is the one operator 0.2.20 already
-- maps; W0 rewords its string so it names sizes and add-ons. Names are
-- compared trimmed, so whitespace alone is not a rename and a case change
-- is. The price check runs first and keeps no hint, so a save that changes
-- both is refused as a price. A free option ("no ice") and a never-launched
-- add-on stay the manager's to rename, and so does a draft item's size.
-- Default, order, a group move and a switch that keep the name pass. The
-- owner passes every lock. upsert_retail_variant reaches the size lock through
-- its call to upsert_variant, as it reaches the price lock (0177's pin).
-- #59 narrows: an add-on switched off before 0177 comes back at its locked
-- price, and now under its own name too.
--
-- THE CHANGE. Renames ride on the two existing kinds as renames: price takes
-- 0-12 sizes of its item, addon_price 0-30 launched add-ons at the venue, each
-- named once with both names (80 at most), at least one changed. The check
-- adds before_en and before_ar, the names at submit. A price change needs a
-- price, a new size or a rename; an addon_price change an add-on or a rename.
-- numbers never carries names: the owner approves the proposal's names or
-- sends it back (Q12). price_promo_numbers lists the renames. The apply runs
-- them after the prices and new sizes: the row is kept, so the recipe and the
-- current price are, and a shop size's retail stock row is renamed with it.
-- The target check holds the apply to before_en and before_ar, so a name
-- written since is PRICE_TARGET_CHANGED size:<id> or addon:<id>, and the cron
-- reverts a dated run with apply_not_ready. A run proposed before this file
-- has no renames key: every new branch reads coalesce(…->'renames', '[]').
--
-- Every function is its LATEST body, copied verbatim from 0177 (re-checked
-- with the addendum §2.10 command, migrations and drafts), with the changes
-- above, its comment and the dollar tag changed and nothing else. Signatures
-- are unchanged, so each keeps its grants; the revoke/grant pair 0177 used is
-- re-issued anyway. The two new helpers are plpgsql with a SET clause and
-- revoked from every client role, the price_promo_sizes pattern (0177:315).
--
-- Not re-issued: upsert_retail_variant, upsert_variant_internal,
-- upsert_modifier_internal, protocol_check_price_promo_numbers (a rename-only
-- run leaves its figures out, which it allows), price_promo_targets (it
-- returns the names already), protocol_submit_price_promo_propose and
-- upsert_menu_item: a whole item's name is untouched (#59; OPEN §8 Q4).
--
-- covered by packages/db/tests/price-promo.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The name lock on sizes: app.upsert_variant (0177:707).
-- ---------------------------------------------------------------------------
create or replace function app.upsert_variant(
  p_item_id    uuid,
  p_name_en    text,
  p_name_ar    text,
  p_price_iqd  bigint,
  p_id         uuid default null,
  p_is_default boolean default false,
  p_sort_order int default 0
) returns uuid
language plpgsql security definer set search_path = public as $upsert_variant_0195$
declare
  v_run_status text;
  v_price      bigint;
  v_item       menu_items%rowtype;
  v_name_en    text;
  v_name_ar    text;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_item from menu_items where id = p_item_id for update;
  if v_item.release_run_id is not null then
    select r.status into v_run_status from protocol_runs r where r.id = v_item.release_run_id;
  end if;
  if v_run_status is not null and v_run_status not in ('live', 'done') then
    if p_id is null then
      raise exception 'ITEM_IN_RELEASE' using errcode = 'P0001';
    end if;
    select v.price_iqd into v_price
      from menu_item_variants v
     where v.id = p_id and v.item_id = p_item_id;
    -- A size that is not there falls through to VARIANT_NOT_FOUND.
    if found and p_price_iqd is distinct from v_price then
      raise exception 'ITEM_IN_RELEASE' using errcode = 'P0001';
    end if;
  end if;

  -- The size lock (#41, #51): a manager's price goes through a price change,
  -- and so does a manager's new name (#9): the price first, with no hint, then
  -- the name, hint name. Surrounding whitespace is not a rename; a case change
  -- is.
  if app.staff_role() = 'manager' then
    if v_item.id is not null and (v_item.launched_at is not null or v_item.is_active) then
      if p_id is null then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
      end if;
      select v.price_iqd, v.name_en, v.name_ar into v_price, v_name_en, v_name_ar
        from menu_item_variants v
       where v.id = p_id and v.item_id = p_item_id;
      if found and p_price_iqd is distinct from v_price then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
      end if;
      if found and (btrim(p_name_en) is distinct from btrim(v_name_en)
                    or btrim(p_name_ar) is distinct from btrim(v_name_ar)) then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001', hint = 'name';
      end if;
    end if;
  end if;

  return app.upsert_variant_internal(p_item_id, p_name_en, p_name_ar, p_price_iqd,
                                     p_id, p_is_default, p_sort_order);
end $upsert_variant_0195$;

comment on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) is
  'Manager or owner: creates or updates one size of a menu item or shop product (0013; a wrapper over app.upsert_variant_internal since product_release). ITEM_IN_RELEASE, for everyone, on a new size or a price change of an item whose product release is not live or done: its prices come from the price step. PRICE_VIA_PROTOCOL (price_promo, #51), for a manager, on a new size or a price change of any item that is not a draft (launched_at set, or switched on), cafe or shop, including through app.upsert_retail_variant: it goes through a price change. PRICE_VIA_PROTOCOL hint name (price_promo_renames, #9), for a manager, on a changed name (either language, compared trimmed) of an existing size of such an item, checked after the price: the rename goes through a price change too. ITEM_NOT_FOUND, VARIANT_NOT_FOUND, INVALID_PRICE.';

revoke all on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) from public, anon;
grant execute on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The name lock on paid add-ons: app.upsert_modifier (0177:982).
-- ---------------------------------------------------------------------------
create or replace function app.upsert_modifier(
  p_group_id        uuid,
  p_name_en         text,
  p_name_ar         text,
  p_id              uuid default null,
  p_price_delta_iqd bigint default 0,
  p_sort_order      int default 0,
  p_is_active       boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $upsert_modifier_0195$
declare
  v_mod      modifiers%rowtype;
  v_launched boolean := false;
  v_prices   jsonb;
  v_id       uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if app.staff_role() = 'manager'
     and exists (select 1 from modifier_groups where id = p_group_id) then
    if p_id is not null then
      select * into v_mod from modifiers where id = p_id for update;
    end if;
    if p_id is null or v_mod.id is not null then
      v_launched := v_mod.id is not null and (v_mod.launched_at is not null or v_mod.is_active);
      if v_launched and p_price_delta_iqd is distinct from v_mod.price_delta_iqd then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
      end if;
      if not v_launched and coalesce(p_price_delta_iqd, 0) > 0 and coalesce(p_is_active, false) then
        raise exception 'LAUNCH_VIA_PROTOCOL' using errcode = 'P0001';
      end if;
      -- The name lock (#9): a launched paid add-on is renamed through an
      -- addon_price change, as its price is. A free option and a
      -- never-launched one stay the manager's to rename; a move or a switch
      -- that keeps the name is not a rename.
      if v_launched and v_mod.price_delta_iqd > 0
         and (btrim(p_name_en) is distinct from btrim(v_mod.name_en)
              or btrim(p_name_ar) is distinct from btrim(v_mod.name_ar)) then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001', hint = 'name';
      end if;
      v_prices := app.addon_prices_snapshot(app.addon_items_of(array[p_group_id, v_mod.group_id]));
    end if;
  end if;

  v_id := app.upsert_modifier_internal(p_group_id, p_name_en, p_name_ar, p_id,
                                       p_price_delta_iqd, p_sort_order, p_is_active);
  if v_prices is not null then
    perform app.addon_prices_guard(v_prices);
  end if;
  return v_id;
end $upsert_modifier_0195$;

comment on function app.upsert_modifier(uuid, text, text, uuid, bigint, int, boolean) is
  'Manager or owner: creates or updates one add-on (0013; a wrapper over app.upsert_modifier_internal since price_promo). For a manager: PRICE_VIA_PROTOCOL on a changed price of a launched add-on (launched_at set, or switched on); LAUNCH_VIA_PROTOCOL on a never-launched paid add-on saved switched on (saved hidden it passes and goes on sale through an addon_price change); PRICE_VIA_PROTOCOL hint name (price_promo_renames, #9) on a changed name (either language, compared trimmed) of a launched add-on whose stored price is above 0, which goes through an addon_price change; PRICE_VIA_PROTOCOL (hint required_addon) on a save that raises the least a guest pays in add-ons for an item or a choice on it (app.addon_item_prices). A free option may be added, switched on and renamed. GROUP_NOT_FOUND, MODIFIER_NOT_FOUND, INVALID_PRICE.';

revoke all on function app.upsert_modifier(uuid, text, text, uuid, bigint, int, boolean) from public, anon;
grant execute on function app.upsert_modifier(uuid, text, text, uuid, bigint, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The record helpers: renames on a price and an addon_price change.
-- ---------------------------------------------------------------------------
-- [{variant_id, name_en, name_ar}]: 0 to 12 sizes of p_item, each once, both
-- names given (80 at most) and at least one of them other than the size's
-- name now, compared trimmed. Each comes back trimmed, with before_en and
-- before_ar, the size's names now (a copy the client sends is replaced),
-- which the target check holds the apply to. Absent is [].
create or replace function app.price_promo_size_renames(p_value jsonb, p_item uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_size_renames_0195$
declare
  v_el   jsonb;
  v_vid  uuid;
  v_v    menu_item_variants%rowtype;
  v_en   text;
  v_ar   text;
  v_seen uuid[] := '{}';
  v_out  jsonb := '[]'::jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return v_out;
  end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 12 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'renames';
  end if;
  for v_el in select e from jsonb_array_elements(p_value) e loop
    perform app.price_promo_only_keys(v_el, array['variant_id', 'name_en', 'name_ar', 'before_en', 'before_ar'], 'renames');
    v_vid := app.price_promo_uuid(v_el->'variant_id', true, 'renames');
    select v.* into v_v from menu_item_variants v where v.id = v_vid and v.item_id = p_item;
    if not found or v_vid = any(v_seen) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'renames';
    end if;
    v_en := app.price_promo_text(v_el->'name_en', 80, true, 'renames');
    v_ar := app.price_promo_text(v_el->'name_ar', 80, true, 'renames');
    if v_en is not distinct from btrim(v_v.name_en) and v_ar is not distinct from btrim(v_v.name_ar) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'renames';
    end if;
    v_seen := v_seen || v_vid;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
               'variant_id', v_vid,
               'name_en',    v_en,
               'name_ar',    v_ar,
               'before_en',  v_v.name_en,
               'before_ar',  v_v.name_ar));
  end loop;
  return v_out;
end $price_promo_size_renames_0195$;

comment on function app.price_promo_size_renames(jsonb, uuid) is
  'price_promo_renames (#9). Internal: a price change''s renames, [{variant_id, name_en, name_ar}]: 0 to 12 sizes of p_item, each once, both names required (<= 80) and at least one other than the size''s name now, compared trimmed (absent = []). Each comes back trimmed with before_en and before_ar, the size''s stored names (a client copy is replaced). RECORD_INVALID or TEXT_TOO_LONG with hint renames otherwise.';

revoke all on function app.price_promo_size_renames(jsonb, uuid) from public, anon, authenticated;

-- [{modifier_id, name_en, name_ar}]: 0 to 30 launched add-ons whose group is
-- at the venue, each once, with the same name rules and the same before_en
-- and before_ar. A never-launched add-on is the manager's to rename. Absent
-- is [].
create or replace function app.price_promo_addon_renames(p_value jsonb, p_venue uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_addon_renames_0195$
declare
  v_el   jsonb;
  v_id   uuid;
  v_mod  modifiers%rowtype;
  v_en   text;
  v_ar   text;
  v_seen uuid[] := '{}';
  v_out  jsonb := '[]'::jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return v_out;
  end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 30 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'renames';
  end if;
  for v_el in select e from jsonb_array_elements(p_value) e loop
    perform app.price_promo_only_keys(v_el, array['modifier_id', 'name_en', 'name_ar', 'before_en', 'before_ar'], 'renames');
    v_id := app.price_promo_uuid(v_el->'modifier_id', true, 'renames');
    select m.* into v_mod
      from modifiers m
      join modifier_groups g on g.id = m.group_id
     where m.id = v_id and g.venue_id = p_venue
       and (m.launched_at is not null or m.is_active);
    if not found or v_id = any(v_seen) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'renames';
    end if;
    v_en := app.price_promo_text(v_el->'name_en', 80, true, 'renames');
    v_ar := app.price_promo_text(v_el->'name_ar', 80, true, 'renames');
    if v_en is not distinct from btrim(v_mod.name_en) and v_ar is not distinct from btrim(v_mod.name_ar) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'renames';
    end if;
    v_seen := v_seen || v_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
               'modifier_id', v_id,
               'name_en',     v_en,
               'name_ar',     v_ar,
               'before_en',   v_mod.name_en,
               'before_ar',   v_mod.name_ar));
  end loop;
  return v_out;
end $price_promo_addon_renames_0195$;

comment on function app.price_promo_addon_renames(jsonb, uuid) is
  'price_promo_renames (#9). Internal: an addon_price change''s renames, [{modifier_id, name_en, name_ar}]: 0 to 30 launched add-ons (launched_at set, or switched on) whose group is at p_venue, each once, both names required (<= 80) and at least one other than the add-on''s name now, compared trimmed (absent = []). Each comes back trimmed with before_en and before_ar, the add-on''s stored names (a client copy is replaced). RECORD_INVALID or TEXT_TOO_LONG with hint renames otherwise.';

revoke all on function app.price_promo_addon_renames(jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. propose: renames on the two kinds
--    (app.protocol_check_price_promo_propose, 0177:2296).
-- ---------------------------------------------------------------------------
create or replace function app.protocol_check_price_promo_propose(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_price_promo_propose_0195$
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
                      'promotion_enable', 'rate', 'featured_discount') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'change';
  end if;
  -- A hidden product is launched by MGMT only; marketing is not offered one.
  if v_change = 'shop_launch' and not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
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
          or v_first->'rule_id' is distinct from v_out->'rule_id') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'change';
  end if;

  return v_out;
end $protocol_check_price_promo_propose_0195$;

comment on function app.protocol_check_price_promo_propose(uuid, jsonb, text[]) is
  'price_promo (§2.8, §2.13). Internal check hook: one of the eight changes with reason and expected_effect (<= 2000): price {menu_item_id (launched, not in release, at the run''s venue), prices (0-12 of its sizes), new_sizes? (0-4, a cafe item only), renames? (0-12 of its sizes, app.price_promo_size_renames); at least one price, new size or rename}, shop_launch {menu_item_id (a never-launched hidden shop product, not in release), prices (exactly its sizes)} (MGMT only: NOT_STEP_ACTOR hint change for marketing), addon_price {addons (1-30 at the venue; absent or empty when renames has one), renames? (0-30 launched add-ons at the venue, app.price_promo_addon_renames)}, promotion {promotion}, promotion_edit {promotion_id, promotion}, promotion_enable {promotion_id (off)}, rate {rule_id?, rule}, featured_discount {menu_item_id (active, at the venue), discount_pct 0-99, a change}. Adds base_updated_at (promotion edit or switch-on), before (rate edit, featured discount) and each rename''s before_en and before_ar. A resubmission keeps change and target (hint change). RECORD_INVALID and TEXT_TOO_LONG with the field as hint, never a writer''s code.';

revoke all on function app.protocol_check_price_promo_propose(uuid, jsonb, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The target check: a renamed size or add-on keeps its old names until
--    the apply (app.price_promo_check_targets, 0177:1908).
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_check_targets(p_run_id uuid)
returns void
language plpgsql stable security definer set search_path = public as $price_promo_check_targets_0195$
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

  else
    raise exception 'PRICE_TARGET_CHANGED' using errcode = 'P0001', hint = 'change';
  end case;
end $price_promo_check_targets_0195$;

comment on function app.price_promo_check_targets(uuid) is
  'price_promo (§2.13). Internal: raises PRICE_TARGET_CHANGED (hint item, size:<variant_id>, sizes, addon:<modifier_id>, promotion, rule or featured) when what the passed proposal and numbers approved no longer matches: a target gone; a price item no longer launched or put in release; a shop_launch product switched on, launched, put in release, or with sizes other than the approved ones; a renamed size no longer the item''s, or a renamed size or add-on whose names are no longer its before_en and before_ar (price_promo_renames, #9); a promotion written since the proposal (updated_at against base_updated_at), already on for a switch-on, or its code taken; an edited rule or its prices changed since (against before), or the rule''s court gone; the featured item, discount or hero mode changed since (against before), or the item to feature switched off. Called by the apply check hook and app.price_promo_apply_internal.';

revoke all on function app.price_promo_check_targets(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The apply: the renames after the prices and new sizes
--    (app.price_promo_apply_internal, 0177:2032).
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_apply_internal(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $price_promo_apply_internal_0195$
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
end $price_promo_apply_internal_0195$;

comment on function app.price_promo_apply_internal(uuid) is
  'price_promo (§2.13). Internal: applies an active (pass hook) or scheduled (cron) price or promotion change: app.venue_id set to the run''s venue, app.price_promo_check_targets, then the approved figures (numbers, else the proposal''s) through the internals: price (sizes, new sizes after the last, then the proposal''s renames, each size keeping its row, recipe and current price, a shop size''s retail stock row renamed with it), shop_launch (sizes, then the product switched on and stamped launched), addon_price (a never-launched add-on switched on and stamped, a launched one keeps its switch; then the renames, each keeping its price, switch and order), promotion (the draft updated, then switched on), promotion_edit (the approved fields and value, the switch kept), promotion_enable, rate (the rule and its prices), featured_discount (the item when it moves, the discount, then Featured mode when the discount is above 0). The three promotion kinds then name the owner who approved the numbers as the promotion''s created_by, which apply_best_promotion records as every redemption''s authorized_by (0067). The run is done. Audit protocol.price.apply or protocol.promo.apply {run_id, change, counts (price and shop_launch: sizes, new_sizes, renamed; addon_price: addons, launched, renamed), authorized_by (promotion kinds)}; returns the same.';

revoke all on function app.price_promo_apply_internal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The figures: the renames beside the sizes and add-ons
--    (app.price_promo_numbers, 0177:2891).
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_numbers(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_numbers_0195$
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
  end if;

  return jsonb_build_object(
    'change',    v_change,
    'sizes',     v_sizes,
    'addons',    v_addons,
    'renames',   v_renames,
    'promotion', v_promo,
    'rate',      v_rate,
    'featured',  v_feat);
end $price_promo_numbers_0195$;

comment on function app.price_promo_numbers(uuid) is
  'price_promo (§2.13). MGMT at the run''s venue: the figures behind a price or promotion change, from its standing proposal and numbers (a figure the numbers leave out is the proposal''s): {change, sizes: [{variant_id (null for a new size), name_en, name_ar, current_price_iqd, new_price_iqd, cost_iqd, cost_known, margin_before_iqd, margin_after_iqd, units_30d, revenue_30d_iqd}], addons: [{modifier_id, group_name_en, group_name_ar, name_en, name_ar, current_delta_iqd, new_delta_iqd, count_30d, revenue_30d_iqd}], renames: [{target size|addon, id, from_en, from_ar, to_en, to_ar, price_iqd (what it sells at once applied: this change''s figure, else its price now)}] (price_promo_renames, #9; [] for every other change), promotion: {current_value, new_value, discount_cost_30d_iqd, units_30d, revenue_30d_iqd} | null, rate: {durations: [{duration_min, current_price_iqd, new_price_iqd}], bookings_30d, revenue_30d_iqd} | null, featured: {current_item_id, new_item_id, current_pct, new_pct, current_hero_mode, sizes, units_30d, discount_cost_30d_iqd} | null}. Cost is the recipe cost (latest batch, else pack cost; unknown when a line has neither); sales are the last 30 days'' settled lines. PROTOCOL_NOT_FOUND.';

revoke all on function app.price_promo_numbers(uuid) from public, anon;
grant execute on function app.price_promo_numbers(uuid) to authenticated;
