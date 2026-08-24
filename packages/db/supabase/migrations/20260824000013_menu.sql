-- 0013_menu — cafe menu: categories, items, variants, modifier groups/modifiers,
-- allergens, addon suggestions (design-data.md §1.4) + menu_item_availability view
-- + admin editor RPCs (menu, rate rules, opening hours) — manager/owner-guarded,
-- audited via app.write_audit.
--
-- Availability view NOTE: the design's stock clause (app.item_required_ingredients /
-- app.ingredient_on_hand) belongs to the stock drop. THIS migration defines the
-- view WITHOUT the stock clause (is_active + unavailable_on only); 0018 replaces
-- it with the stock-aware version via CREATE OR REPLACE VIEW.

-- ---------------------------------------------------------------------------
-- Tables (§1.4, exactly)
-- ---------------------------------------------------------------------------
create table menu_categories (
  id           uuid primary key default gen_random_uuid(),
  name_en      text not null,
  name_ar      text not null,
  tax_group_id uuid not null references tax_groups(id),
  sort_order   int not null default 0,
  is_active    boolean not null default true
);

create table menu_items (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references menu_categories(id),
  name_en        text not null,
  name_ar        text not null,
  description_en text,
  description_ar text,
  photo_path     text,                         -- Supabase Storage key
  is_active      boolean not null default true,
  unavailable_on date,                         -- staff "86" for today; auto-restores (check is = current_date)
  sort_order     int not null default 0
);

create table menu_item_variants (              -- sizes; every item has >=1 (a 'Regular' default)
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references menu_items(id) on delete cascade,
  name_en    text not null,
  name_ar    text not null,
  price_iqd  iqd not null,                     -- absolute price per size, per scope
  is_default boolean not null default false,
  sort_order int not null default 0
);

create table modifier_groups (
  id         uuid primary key default gen_random_uuid(),
  name_en    text not null,
  name_ar    text not null,
  min_select int not null default 0,
  max_select int not null default 1
);

create table modifiers (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references modifier_groups(id) on delete cascade,
  name_en         text not null,
  name_ar         text not null,
  price_delta_iqd iqd not null default 0,
  sort_order      int not null default 0,
  is_active       boolean not null default true
);

create table menu_item_modifier_groups (
  item_id    uuid references menu_items(id) on delete cascade,
  group_id   uuid references modifier_groups(id) on delete cascade,
  sort_order int not null default 0,
  primary key (item_id, group_id)
);

create table allergens (
  id       uuid primary key default gen_random_uuid(),
  code     text unique not null,               -- 'nuts','dairy','gluten','vegan','spicy',...
  label_en text not null,
  label_ar text not null
);

create table menu_item_allergens (
  item_id     uuid references menu_items(id) on delete cascade,
  allergen_id uuid references allergens(id) on delete cascade,
  primary key (item_id, allergen_id)
);

create table addon_suggestions (
  item_id           uuid references menu_items(id) on delete cascade,
  suggested_item_id uuid references menu_items(id) on delete cascade,
  sort_order        int not null default 0,
  primary key (item_id, suggested_item_id),
  check (item_id <> suggested_item_id)
);

create index menu_items_category on menu_items (category_id, sort_order);
create index menu_item_variants_item on menu_item_variants (item_id, sort_order);
create index modifiers_group on modifiers (group_id, sort_order);

-- ---------------------------------------------------------------------------
-- menu_item_availability — ingredient-out greying is a VIEW, not a flag.
-- INTERIM version: is_active + unavailable_on only. 0018 (stock ledger drop)
-- replaces this with the BOM/stock-aware version once app.item_required_ingredients
-- and app.ingredient_on_hand exist. Definer view: ids + a boolean, zero PII.
-- ---------------------------------------------------------------------------
create view menu_item_availability with (security_invoker = off) as
select mi.id as item_id,
       (mi.is_active and coalesce(mi.unavailable_on <> current_date, true)) as orderable
  from menu_items mi;

-- ---------------------------------------------------------------------------
-- Admin RPCs — manager/owner only, audited. Menu management is RPC-ONLY:
-- no direct INSERT/UPDATE/DELETE policy or grant exists on any menu table.
-- ---------------------------------------------------------------------------
create or replace function app.upsert_menu_category(
  p_name_en      text,
  p_name_ar      text,
  p_tax_group_id uuid,
  p_id           uuid default null,
  p_sort_order   int default 0,
  p_is_active    boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_row    menu_categories%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tax_groups where id = p_tax_group_id) then
    raise exception 'TAX_GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into menu_categories (name_en, name_ar, tax_group_id, sort_order, is_active)
    values (p_name_en, p_name_ar, p_tax_group_id, p_sort_order, p_is_active)
    returning * into v_row;
    perform app.write_audit('menu.category.create', 'menu_categories', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from menu_categories where id = p_id for update;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update menu_categories
       set name_en = p_name_en, name_ar = p_name_ar, tax_group_id = p_tax_group_id,
           sort_order = p_sort_order, is_active = p_is_active
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.category.update', 'menu_categories', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $$;

create or replace function app.upsert_menu_item(
  p_category_id    uuid,
  p_name_en        text,
  p_name_ar        text,
  p_id             uuid default null,
  p_description_en text default null,
  p_description_ar text default null,
  p_photo_path     text default null,
  p_sort_order     int default 0,
  p_is_active      boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_row    menu_items%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from menu_categories where id = p_category_id) then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into menu_items (category_id, name_en, name_ar, description_en, description_ar,
                            photo_path, sort_order, is_active)
    values (p_category_id, p_name_en, p_name_ar, p_description_en, p_description_ar,
            p_photo_path, p_sort_order, p_is_active)
    returning * into v_row;
    perform app.write_audit('menu.item.create', 'menu_items', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from menu_items where id = p_id for update;
    if not found then
      raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update menu_items
       set category_id = p_category_id, name_en = p_name_en, name_ar = p_name_ar,
           description_en = p_description_en, description_ar = p_description_ar,
           photo_path = p_photo_path, sort_order = p_sort_order, is_active = p_is_active
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.item.update', 'menu_items', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $$;

create or replace function app.upsert_variant(
  p_item_id    uuid,
  p_name_en    text,
  p_name_ar    text,
  p_price_iqd  bigint,
  p_id         uuid default null,
  p_is_default boolean default false,
  p_sort_order int default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_row    menu_item_variants%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from menu_items where id = p_item_id) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_price_iqd is null or p_price_iqd < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;

  -- Only one default size per item.
  if p_is_default then
    update menu_item_variants set is_default = false
     where item_id = p_item_id and is_default and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default, sort_order)
    values (p_item_id, p_name_en, p_name_ar, p_price_iqd, p_is_default, p_sort_order)
    returning * into v_row;
    perform app.write_audit('menu.variant.create', 'menu_item_variants', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from menu_item_variants where id = p_id and item_id = p_item_id for update;
    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update menu_item_variants
       set name_en = p_name_en, name_ar = p_name_ar, price_iqd = p_price_iqd,
           is_default = p_is_default, sort_order = p_sort_order
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.variant.update', 'menu_item_variants', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $$;

create or replace function app.upsert_modifier_group(
  p_name_en    text,
  p_name_ar    text,
  p_id         uuid default null,
  p_min_select int default 0,
  p_max_select int default 1
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_row    modifier_groups%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_min_select < 0 or p_max_select < 1 or p_min_select > p_max_select then
    raise exception 'INVALID_SELECT_RANGE' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into modifier_groups (name_en, name_ar, min_select, max_select)
    values (p_name_en, p_name_ar, p_min_select, p_max_select)
    returning * into v_row;
    perform app.write_audit('menu.modifier_group.create', 'modifier_groups', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from modifier_groups where id = p_id for update;
    if not found then
      raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update modifier_groups
       set name_en = p_name_en, name_ar = p_name_ar,
           min_select = p_min_select, max_select = p_max_select
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.modifier_group.update', 'modifier_groups', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $$;

create or replace function app.upsert_modifier(
  p_group_id        uuid,
  p_name_en         text,
  p_name_ar         text,
  p_id              uuid default null,
  p_price_delta_iqd bigint default 0,
  p_sort_order      int default 0,
  p_is_active       boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_row    modifiers%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from modifier_groups where id = p_group_id) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_price_delta_iqd is null or p_price_delta_iqd < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into modifiers (group_id, name_en, name_ar, price_delta_iqd, sort_order, is_active)
    values (p_group_id, p_name_en, p_name_ar, p_price_delta_iqd, p_sort_order, p_is_active)
    returning * into v_row;
    perform app.write_audit('menu.modifier.create', 'modifiers', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from modifiers where id = p_id for update;
    if not found then
      raise exception 'MODIFIER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update modifiers
       set group_id = p_group_id, name_en = p_name_en, name_ar = p_name_ar,
           price_delta_iqd = p_price_delta_iqd, sort_order = p_sort_order,
           is_active = p_is_active
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.modifier.update', 'modifiers', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $$;

-- app.set_item_availability — the staff "86". p_available=false marks
-- unavailable_on = current_date (auto-restores tomorrow); true clears it.
create or replace function app.set_item_availability(
  p_item_id   uuid,
  p_available boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_row    menu_items%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from menu_items where id = p_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  update menu_items
     set unavailable_on = case when p_available then null else current_date end
   where id = p_item_id
   returning * into v_row;

  perform app.write_audit('menu.item.availability', 'menu_items', v_row.id::text,
                          v_before, to_jsonb(v_row));
end $$;

-- app.link_item_modifier_group — attach/detach a modifier group to an item.
create or replace function app.link_item_modifier_group(
  p_item_id    uuid,
  p_group_id   uuid,
  p_sort_order int default 0,
  p_linked     boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from menu_items where id = p_item_id) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from modifier_groups where id = p_group_id) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_linked then
    insert into menu_item_modifier_groups (item_id, group_id, sort_order)
    values (p_item_id, p_group_id, p_sort_order)
    on conflict (item_id, group_id) do update set sort_order = excluded.sort_order;
  else
    delete from menu_item_modifier_groups
     where item_id = p_item_id and group_id = p_group_id;
  end if;

  perform app.write_audit('menu.item.link_group', 'menu_item_modifier_groups',
                          p_item_id::text || ':' || p_group_id::text,
                          null,
                          jsonb_build_object('item_id', p_item_id, 'group_id', p_group_id,
                                             'sort_order', p_sort_order, 'linked', p_linked));
end $$;

-- app.set_addon_suggestions — replace an item's suggestion list wholesale
-- (order of the array = sort order).
create or replace function app.set_addon_suggestions(
  p_item_id            uuid,
  p_suggested_item_ids uuid[]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from menu_items where id = p_item_id) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_item_id = any (coalesce(p_suggested_item_ids, '{}')) then
    raise exception 'SELF_SUGGESTION' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(suggested_item_id order by sort_order), '[]'::jsonb)
    into v_before
    from addon_suggestions where item_id = p_item_id;

  delete from addon_suggestions where item_id = p_item_id;

  insert into addon_suggestions (item_id, suggested_item_id, sort_order)
  select p_item_id, s.id, s.ord - 1
    from unnest(coalesce(p_suggested_item_ids, '{}')) with ordinality as s(id, ord);
  -- FK to menu_items raises for unknown ids; PK raises for duplicates in the array.

  perform app.write_audit('menu.item.addons', 'addon_suggestions', p_item_id::text,
                          jsonb_build_object('suggested', v_before),
                          jsonb_build_object('suggested', to_jsonb(coalesce(p_suggested_item_ids, '{}'))));
end $$;

-- ---------------------------------------------------------------------------
-- app.upsert_rate_rule — the admin rates editor (courts/rate tables from 0007).
-- p_prices: jsonb object {"60": 40000, "90": 55000} — duration minutes -> IQD;
-- replaces the rule's rate_rule_prices wholesale.
-- ---------------------------------------------------------------------------
create or replace function app.upsert_rate_rule(
  p_name         text,
  p_days_of_week int[],
  p_start_time   time,
  p_end_time     time,
  p_prices       jsonb,
  p_id           uuid default null,
  p_court_id     uuid default null,
  p_priority     int default 0,
  p_valid_from   date default null,
  p_valid_to     date default null,
  p_is_active    boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_row    rate_rules%rowtype;
  v_kv     record;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_court_id is not null and not exists (select 1 from courts where id = p_court_id) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_days_of_week is null or cardinality(p_days_of_week) = 0
     or exists (select 1 from unnest(p_days_of_week) d where d < 0 or d > 6) then
    raise exception 'INVALID_DAYS' using errcode = 'P0001',
      hint = 'days_of_week: 0=Sun..6=Sat, at least one';
  end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'object' or p_prices = '{}'::jsonb then
    raise exception 'INVALID_PRICES' using errcode = 'P0001',
      hint = 'prices: {"<duration_min>": <price_iqd>, ...}';
  end if;

  if p_id is null then
    insert into rate_rules (name, court_id, days_of_week, start_time, end_time,
                            priority, valid_from, valid_to, is_active)
    values (p_name, p_court_id, p_days_of_week, p_start_time, p_end_time,
            p_priority, p_valid_from, p_valid_to, p_is_active)
    returning * into v_row;
  else
    select * into v_row from rate_rules where id = p_id for update;
    if not found then
      raise exception 'RULE_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update rate_rules
       set name = p_name, court_id = p_court_id, days_of_week = p_days_of_week,
           start_time = p_start_time, end_time = p_end_time, priority = p_priority,
           valid_from = p_valid_from, valid_to = p_valid_to, is_active = p_is_active
     where id = p_id
     returning * into v_row;
  end if;

  -- Replace per-duration prices wholesale.
  delete from rate_rule_prices where rule_id = v_row.id;
  for v_kv in select key, value from jsonb_each_text(p_prices) loop
    if v_kv.key !~ '^[0-9]+$' or v_kv.value !~ '^[0-9]+$' then
      raise exception 'INVALID_PRICES' using errcode = 'P0001',
        detail = format('bad entry %s: %s', v_kv.key, v_kv.value);
    end if;
    insert into rate_rule_prices (rule_id, duration_min, price_iqd)
    values (v_row.id, v_kv.key::int, v_kv.value::bigint);
  end loop;

  perform app.write_audit(
    case when v_before is null then 'rates.rule.create' else 'rates.rule.update' end,
    'rate_rules', v_row.id::text, v_before,
    to_jsonb(v_row) || jsonb_build_object('prices', p_prices));

  return v_row.id;
end $$;

-- ---------------------------------------------------------------------------
-- app.set_opening_hours — the admin hours editor (venue_settings from 0006).
-- Pass null to leave a field unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.set_opening_hours(
  p_opening_hours jsonb default null,
  p_closed_dates  date[] default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_opening_hours is not null and jsonb_typeof(p_opening_hours) <> 'object' then
    raise exception 'INVALID_HOURS' using errcode = 'P0001';
  end if;

  select jsonb_build_object('opening_hours', opening_hours, 'closed_dates', to_jsonb(closed_dates))
    into v_before from venue_settings;

  update venue_settings
     set opening_hours = coalesce(p_opening_hours, opening_hours),
         closed_dates  = coalesce(p_closed_dates, closed_dates);

  select jsonb_build_object('opening_hours', opening_hours, 'closed_dates', to_jsonb(closed_dates))
    into v_after from venue_settings;

  perform app.write_audit('settings.opening_hours', 'venue_settings', 'singleton',
                          v_before, v_after);
end $$;

-- ---------------------------------------------------------------------------
-- Function grants: definer + pinned search_path everywhere; clients call via
-- authenticated only (role guard is the first statement of every body).
-- ---------------------------------------------------------------------------
revoke all on function app.upsert_menu_category(text, text, uuid, uuid, int, boolean) from public, anon;
grant execute on function app.upsert_menu_category(text, text, uuid, uuid, int, boolean) to authenticated;

revoke all on function app.upsert_menu_item(uuid, text, text, uuid, text, text, text, int, boolean) from public, anon;
grant execute on function app.upsert_menu_item(uuid, text, text, uuid, text, text, text, int, boolean) to authenticated;

revoke all on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) from public, anon;
grant execute on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) to authenticated;

revoke all on function app.upsert_modifier_group(text, text, uuid, int, int) from public, anon;
grant execute on function app.upsert_modifier_group(text, text, uuid, int, int) to authenticated;

revoke all on function app.upsert_modifier(uuid, text, text, uuid, bigint, int, boolean) from public, anon;
grant execute on function app.upsert_modifier(uuid, text, text, uuid, bigint, int, boolean) to authenticated;

revoke all on function app.set_item_availability(uuid, boolean) from public, anon;
grant execute on function app.set_item_availability(uuid, boolean) to authenticated;

revoke all on function app.link_item_modifier_group(uuid, uuid, int, boolean) from public, anon;
grant execute on function app.link_item_modifier_group(uuid, uuid, int, boolean) to authenticated;

revoke all on function app.set_addon_suggestions(uuid, uuid[]) from public, anon;
grant execute on function app.set_addon_suggestions(uuid, uuid[]) to authenticated;

revoke all on function app.upsert_rate_rule(text, int[], time, time, jsonb, uuid, uuid, int, date, date, boolean) from public, anon;
grant execute on function app.upsert_rate_rule(text, int[], time, time, jsonb, uuid, uuid, int, date, date, boolean) to authenticated;

revoke all on function app.set_opening_hours(jsonb, date[]) from public, anon;
grant execute on function app.set_opening_hours(jsonb, date[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS (matrix §3.2): public/anon SELECT of active rows; staff see
-- everything (retired rows included, for the editor); writes RPC-only.
-- ---------------------------------------------------------------------------
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table menu_item_variants enable row level security;
alter table modifier_groups enable row level security;
alter table modifiers enable row level security;
alter table menu_item_modifier_groups enable row level security;
alter table allergens enable row level security;
alter table menu_item_allergens enable row level security;
alter table addon_suggestions enable row level security;

grant select on menu_categories, menu_items, menu_item_variants, modifier_groups,
                modifiers, menu_item_modifier_groups, allergens, menu_item_allergens,
                addon_suggestions
  to anon, authenticated;
grant select on menu_item_availability to anon, authenticated;

create policy menu_categories_read on menu_categories for select to anon, authenticated
  using (is_active or app.is_staff('cashier','prep','court_desk','manager','owner'));

create policy menu_items_read on menu_items for select to anon, authenticated
  using (is_active or app.is_staff('cashier','prep','court_desk','manager','owner'));

create policy menu_item_variants_read on menu_item_variants for select to anon, authenticated
  using (exists (
    select 1 from menu_items mi
     where mi.id = item_id
       and (mi.is_active or app.is_staff('cashier','prep','court_desk','manager','owner'))
  ));

create policy modifier_groups_read on modifier_groups for select to anon, authenticated
  using (true);                                 -- names + min/max only; nothing sensitive

create policy modifiers_read on modifiers for select to anon, authenticated
  using (is_active or app.is_staff('cashier','prep','court_desk','manager','owner'));

create policy menu_item_modifier_groups_read on menu_item_modifier_groups
  for select to anon, authenticated using (true);

create policy allergens_read on allergens for select to anon, authenticated
  using (true);

create policy menu_item_allergens_read on menu_item_allergens
  for select to anon, authenticated using (true);

create policy addon_suggestions_read on addon_suggestions
  for select to anon, authenticated using (true);
