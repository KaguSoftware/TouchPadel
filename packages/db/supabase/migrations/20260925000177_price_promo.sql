-- 0177 price_promo — the price or promotion change protocol, and the manager locks
-- that send every list price, promotion, court rate and the featured-item
-- discount through it.
--
-- Feature: protocols and the staff phone, lane F
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.13, §2.8, §2.18,
-- §2.19, §2.21, §2.22, §3; plan #41, #51, #53, #57, #58, #59).
-- Depends on: protocols_engine_rpcs (A: the engine that calls the hooks
-- below, app.protocol_engine_text, app.protocol_engine_notify), product_release
-- (E: app.upsert_variant_internal and the upsert_variant wrapper this file
-- re-issues; app.upsert_menu_item_internal and menu_items.launched_at, which
-- the shop_launch apply uses).
-- Re-issues (§2.18), each from its latest body: app.upsert_variant (E's
-- product_release wrapper) with the size lock; app.upsert_modifier (0013:298)
-- split into upsert_modifier_internal and a wrapper; app.upsert_promotion
-- (0067:258) and app.set_promotion_enabled (0067:484) split likewise;
-- app.generate_promo_code (0067:525); app.upsert_rate_rule (0071:153) and
-- app.set_cafe_setting (0029:280) split likewise; app.upsert_modifier_group
-- and app.link_item_modifier_group (0013:256, 0013:377) and
-- app.set_modifier_reveals (0028:76) verbatim with the compulsory add-on lock.
-- Signatures, guards and grants are unchanged.
-- Not re-issued, on purpose: app.upsert_retail_variant (0145:132) and
-- app.set_cafe_settings (0050:242) reach the locks through their calls to
-- the public upsert_variant and set_cafe_setting (price-promo.test.ts pins
-- both); app.cafe_setting_specs (0105:158) keeps featured_discount_pct and
-- hero_mode as manager keys, since the lock is in the setter.
-- Re-runnable: add column if not exists, create or replace; the cron job
-- upserts by name.
--
-- THE RUN. A manager or marketing proposes one of eight changes (price,
-- shop_launch, addon_price, promotion, promotion_edit, promotion_enable,
-- rate, featured_discount); marketing's proposal waits for a manager. The
-- manager sets the numbers and the owner approves them ("Needs my OK" is fixed
-- on there, #58). Marketing may announce it (optional). The manager applies it
-- now or on a date; tp_price_promo_apply applies the dated ones. Nothing a
-- guest or the till sees changes before the apply, which writes through the
-- _internal bodies below, so none of the locks refuses it.
--
-- THE LOCKS (#41, #51, #53, #57). A manager, never the owner, is refused
-- PRICE_VIA_PROTOCOL on: a new size or a changed size price of any item that
-- is not a draft (cafe or shop), a changed price of a launched add-on, every
-- promotion save, a promotion's switch-on, a promo code, every court rate
-- save, the featured discount set above 0, the featured item moved while a
-- discount is stored, and the hero switched to Featured while a discount is
-- stored; and on any add-on write (an option, a group's min_select, an item
-- link, a reveal) that raises the least a guest pays in add-ons for an item,
-- which is how a paid add-on is made compulsory. LAUNCH_VIA_PROTOCOL on a
-- never-launched paid add-on saved switched on. The draft exception covers
-- list prices only: an item or add-on never launched and switched off stays
-- the manager's to price. A manager still switches a promotion off and the
-- discount to 0 directly.
--
-- LAUNCHED. An item or add-on is launched when launched_at is set or it is
-- switched on (one written around the RPCs, a seed or a fixture, is on sale
-- all the same). Everything that exists when the columns are added counts as
-- launched, switched off or not: a manager can rename an old switched-off one
-- and switch it back on at its old price (the accepted limit, #59), never at a
-- new one.
--
-- GLOBAL TARGETS. promotions has no venue_id and cafe_settings is keyed by
-- setting alone, so those changes apply at every venue, whichever venue's run
-- carries them (slice 2 scopes both). Rate rules, menu items and add-on groups
-- are checked against the run's venue.
--
-- NO STOP HOOK. Before the apply the run has written nothing that needs
-- undoing: a new promotion's draft stays disabled, a hidden product or add-on
-- stays hidden, and the other kinds wrote nothing. The engine treats a
-- missing stop hook as exactly that.
--
-- covered by packages/db/tests/price-promo.test.ts (and promotions.test.ts,
-- whose promotions the owner now configures)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. modifiers.launched_at: when an add-on first went on sale. Added with
--    now() as its default and the default dropped at once: now() is stable,
--    so Postgres stores it as the column's missing value for every existing
--    row (no rewrite, no UPDATE, no trigger fires), and every add-on that
--    exists today counts as launched. New rows start NULL.
-- ---------------------------------------------------------------------------
alter table modifiers add column if not exists launched_at timestamptz default now();
alter table modifiers alter column launched_at drop default;

comment on column modifiers.launched_at is
  'price_promo (§2.13): when the add-on first went on sale. Every add-on that existed when the column was added counts as launched; after that app.upsert_modifier_internal stamps it whenever a save leaves the add-on switched on. NULL on a never-launched add-on, which a manager saves hidden and puts on sale through an addon_price change (LAUNCH_VIA_PROTOCOL).';

-- ---------------------------------------------------------------------------
-- 2. Record helpers for the price/promo check hooks. Internal. A field is
--    absent or JSON null when it is not given; the hint is the field the form
--    marks (validate.ts in @touch/core names the same ones).
-- ---------------------------------------------------------------------------

-- A text field: trimmed, NULL when blank; RECORD_INVALID when it is not a
-- string or is required and blank; TEXT_TOO_LONG past the cap.
create or replace function app.price_promo_text(p_value jsonb, p_cap int, p_required boolean, p_hint text)
returns text
language plpgsql immutable set search_path = public as $price_promo_text_0177$
declare
  v text;
begin
  if p_value is not null and p_value <> 'null'::jsonb then
    if jsonb_typeof(p_value) <> 'string' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    v := app.protocol_engine_text(p_value #>> '{}', p_cap, p_hint);
  end if;
  if v is null and p_required then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return v;
end $price_promo_text_0177$;

comment on function app.price_promo_text(jsonb, int, boolean, text) is
  'price_promo (§2.8). Internal: a price/promo record''s text field, trimmed and NULL when blank; RECORD_INVALID (hint p_hint) when not a string or required and blank, TEXT_TOO_LONG past p_cap.';

revoke all on function app.price_promo_text(jsonb, int, boolean, text) from public, anon, authenticated;

-- A uuid field, given as a string.
create or replace function app.price_promo_uuid(p_value jsonb, p_required boolean, p_hint text)
returns uuid
language plpgsql immutable set search_path = public as $price_promo_uuid_0177$
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_required then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string'
     or (p_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return (p_value #>> '{}')::uuid;
end $price_promo_uuid_0177$;

comment on function app.price_promo_uuid(jsonb, boolean, text) is
  'price_promo (§2.8). Internal: a price/promo record''s uuid field, given as a string; RECORD_INVALID (hint p_hint) when malformed, or required and absent.';

revoke all on function app.price_promo_uuid(jsonb, boolean, text) from public, anon, authenticated;

-- A whole number within [p_min, p_max]; NULL when absent and not required.
create or replace function app.price_promo_int(p_value jsonb, p_min bigint, p_max bigint, p_required boolean, p_hint text)
returns bigint
language plpgsql immutable set search_path = public as $price_promo_int_0177$
declare
  v numeric;
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_required then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'number' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  v := (p_value #>> '{}')::numeric;
  if v <> trunc(v) or v < p_min or v > p_max then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return v::bigint;
end $price_promo_int_0177$;

comment on function app.price_promo_int(jsonb, bigint, bigint, boolean, text) is
  'price_promo (§2.8). Internal: a price/promo record''s whole number within [p_min, p_max], NULL when absent and not required; RECORD_INVALID (hint p_hint) otherwise.';

revoke all on function app.price_promo_int(jsonb, bigint, bigint, boolean, text) from public, anon, authenticated;

-- A boolean; NULL when absent and not required.
create or replace function app.price_promo_bool(p_value jsonb, p_required boolean, p_hint text)
returns boolean
language plpgsql immutable set search_path = public as $price_promo_bool_0177$
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_required then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return (p_value #>> '{}')::boolean;
end $price_promo_bool_0177$;

comment on function app.price_promo_bool(jsonb, boolean, text) is
  'price_promo (§2.8). Internal: a price/promo record''s boolean, NULL when absent and not required; RECORD_INVALID (hint p_hint) otherwise.';

revoke all on function app.price_promo_bool(jsonb, boolean, text) from public, anon, authenticated;

-- A time of day, HH:MM or HH:MM:SS (the TIME_RE of @touch/core).
create or replace function app.price_promo_time(p_value jsonb, p_required boolean, p_hint text)
returns time
language plpgsql stable set search_path = public as $price_promo_time_0177$
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_required then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string'
     or (p_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return (p_value #>> '{}')::time;
end $price_promo_time_0177$;

comment on function app.price_promo_time(jsonb, boolean, text) is
  'price_promo (§2.8). Internal: a price/promo record''s time of day (HH:MM or HH:MM:SS), NULL when absent and not required; RECORD_INVALID (hint p_hint) otherwise.';

revoke all on function app.price_promo_time(jsonb, boolean, text) from public, anon, authenticated;

-- An optional calendar date, YYYY-MM-DD.
create or replace function app.price_promo_date(p_value jsonb, p_hint text)
returns date
language plpgsql stable set search_path = public as $price_promo_date_0177$
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  begin
    return (p_value #>> '{}')::date;
  exception when others then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end;
end $price_promo_date_0177$;

comment on function app.price_promo_date(jsonb, text) is
  'price_promo (§2.8). Internal: a price/promo record''s optional date (YYYY-MM-DD), NULL when absent; RECORD_INVALID (hint p_hint) when malformed.';

revoke all on function app.price_promo_date(jsonb, text) from public, anon, authenticated;

-- An instant: an ISO date-time string. Words Postgres would also take
-- ('now', 'tomorrow') are refused, as the forms refuse them.
create or replace function app.price_promo_instant(p_value jsonb, p_required boolean, p_hint text)
returns timestamptz
language plpgsql stable set search_path = public as $price_promo_instant_0177$
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_required then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  begin
    return (p_value #>> '{}')::timestamptz;
  exception when others then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end;
end $price_promo_instant_0177$;

comment on function app.price_promo_instant(jsonb, boolean, text) is
  'price_promo (§2.8). Internal: a price/promo record''s ISO date-time, NULL when absent and not required; RECORD_INVALID (hint p_hint) otherwise.';

revoke all on function app.price_promo_instant(jsonb, boolean, text) from public, anon, authenticated;

-- RECORD_INVALID when p_record is not an object, or names a key (with a
-- value) that it does not take. The hint is p_hint when given (a list element
-- names its list), else p_prefix and the key (promotion.<key>, rule.<key>).
create or replace function app.price_promo_only_keys(p_record jsonb, p_allowed text[], p_hint text, p_prefix text default '')
returns void
language plpgsql immutable set search_path = public as $price_promo_only_keys_0177$
declare
  v_bad text;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001',
      hint = coalesce(p_hint, nullif(rtrim(p_prefix, '.'), ''), 'record');
  end if;
  select e.k into v_bad
    from jsonb_each(p_record) as e(k, v)
   where e.v <> 'null'::jsonb and not (e.k = any(p_allowed))
   order by e.k
   limit 1;
  if v_bad is not null then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = coalesce(p_hint, p_prefix || v_bad);
  end if;
end $price_promo_only_keys_0177$;

comment on function app.price_promo_only_keys(jsonb, text[], text, text) is
  'price_promo (§2.8). Internal: RECORD_INVALID when p_record is not an object or carries a key outside p_allowed with a non-null value; the hint is p_hint, else p_prefix || the key.';

revoke all on function app.price_promo_only_keys(jsonb, text[], text, text) from public, anon, authenticated;

-- An optional {en, ar} line (the announcement's hero or ticker): both, each
-- within the cap.
create or replace function app.price_promo_line(p_value jsonb, p_cap int, p_hint text)
returns jsonb
language plpgsql stable set search_path = public as $price_promo_line_0177$
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  perform app.price_promo_only_keys(p_value, array['en', 'ar'], p_hint);
  return jsonb_build_object('en', app.price_promo_text(p_value->'en', p_cap, true, p_hint),
                            'ar', app.price_promo_text(p_value->'ar', p_cap, true, p_hint));
end $price_promo_line_0177$;

comment on function app.price_promo_line(jsonb, int, text) is
  'price_promo (§2.8). Internal: an optional {en, ar} line, both required and within p_cap (hint p_hint); NULL when absent.';

revoke all on function app.price_promo_line(jsonb, int, text) from public, anon, authenticated;

-- [{variant_id, price_iqd}]: sizes of p_item, each once, prices above 0,
-- at least p_min of them and at most 12. Absent is [] when p_min is 0.
create or replace function app.price_promo_sizes(p_value jsonb, p_item uuid, p_min int, p_hint text)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_sizes_0177$
declare
  v_el   jsonb;
  v_vid  uuid;
  v_seen uuid[] := '{}';
  v_out  jsonb := '[]'::jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then
    if p_min > 0 then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    return v_out;
  end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) not between p_min and 12 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  for v_el in select e from jsonb_array_elements(p_value) e loop
    perform app.price_promo_only_keys(v_el, array['variant_id', 'price_iqd'], p_hint);
    v_vid := app.price_promo_uuid(v_el->'variant_id', true, p_hint);
    if v_vid = any(v_seen)
       or not exists (select 1 from menu_item_variants v where v.id = v_vid and v.item_id = p_item) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    v_seen := v_seen || v_vid;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
               'variant_id', v_vid,
               'price_iqd',  app.price_promo_int(v_el->'price_iqd', 1, 9007199254740991, true, p_hint)));
  end loop;
  return v_out;
end $price_promo_sizes_0177$;

comment on function app.price_promo_sizes(jsonb, uuid, int, text) is
  'price_promo (§2.8). Internal: a record''s [{variant_id, price_iqd}]: sizes of p_item, each once, price_iqd above 0, p_min to 12 of them (absent = [] when p_min is 0); RECORD_INVALID with hint p_hint otherwise.';

revoke all on function app.price_promo_sizes(jsonb, uuid, int, text) from public, anon, authenticated;

-- [{name_en?, name_ar?, price_iqd}]: 0 to 4 new sizes, a name in at least
-- one language each (80 at most), prices above 0. Absent is [].
create or replace function app.price_promo_new_sizes(p_value jsonb)
returns jsonb
language plpgsql stable set search_path = public as $price_promo_new_sizes_0177$
declare
  v_el  jsonb;
  v_en  text;
  v_ar  text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return v_out;
  end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 4 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'new_sizes';
  end if;
  for v_el in select e from jsonb_array_elements(p_value) e loop
    perform app.price_promo_only_keys(v_el, array['name_en', 'name_ar', 'price_iqd'], 'new_sizes');
    v_en := app.price_promo_text(v_el->'name_en', 80, false, 'new_sizes');
    v_ar := app.price_promo_text(v_el->'name_ar', 80, false, 'new_sizes');
    if v_en is null and v_ar is null then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'new_sizes';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
               'name_en',   v_en,
               'name_ar',   v_ar,
               'price_iqd', app.price_promo_int(v_el->'price_iqd', 1, 9007199254740991, true, 'new_sizes'))));
  end loop;
  return v_out;
end $price_promo_new_sizes_0177$;

comment on function app.price_promo_new_sizes(jsonb) is
  'price_promo (§2.8). Internal: a record''s new_sizes, [{name_en?, name_ar? (at least one, <= 80), price_iqd > 0}], 0 to 4 (absent = []); RECORD_INVALID or TEXT_TOO_LONG with hint new_sizes.';

revoke all on function app.price_promo_new_sizes(jsonb) from public, anon, authenticated;

-- [{modifier_id, price_delta_iqd}]: 1 to 30 add-ons whose group is at the
-- venue, each once; 0 or more on a launched add-on, above 0 on one never
-- launched (a free option needs no run).
create or replace function app.price_promo_addons(p_value jsonb, p_venue uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_addons_0177$
declare
  v_el    jsonb;
  v_id    uuid;
  v_mod   modifiers%rowtype;
  v_delta bigint;
  v_seen  uuid[] := '{}';
  v_out   jsonb := '[]'::jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'array'
     or jsonb_array_length(p_value) not between 1 and 30 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'addons';
  end if;
  for v_el in select e from jsonb_array_elements(p_value) e loop
    perform app.price_promo_only_keys(v_el, array['modifier_id', 'price_delta_iqd'], 'addons');
    v_id := app.price_promo_uuid(v_el->'modifier_id', true, 'addons');
    select m.* into v_mod
      from modifiers m
      join modifier_groups g on g.id = m.group_id
     where m.id = v_id and g.venue_id = p_venue;
    if not found or v_id = any(v_seen) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'addons';
    end if;
    v_delta := app.price_promo_int(v_el->'price_delta_iqd',
                                   case when v_mod.launched_at is not null or v_mod.is_active then 0 else 1 end,
                                   9007199254740991, true, 'addons');
    v_seen := v_seen || v_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('modifier_id', v_id, 'price_delta_iqd', v_delta));
  end loop;
  return v_out;
end $price_promo_addons_0177$;

comment on function app.price_promo_addons(jsonb, uuid) is
  'price_promo (§2.8). Internal: a record''s addons, [{modifier_id, price_delta_iqd}], 1 to 30 add-ons whose group is at p_venue, each once, price_delta_iqd >= 0 on a launched add-on and > 0 on a never-launched one; RECORD_INVALID with hint addons otherwise.';

revoke all on function app.price_promo_addons(jsonb, uuid) from public, anon, authenticated;

-- {"<duration_min>": price_iqd}: 1 to 12 durations of 15 to 480 minutes in
-- steps of 5, prices above 0. Keys come back as plain numbers ("060" -> "60").
create or replace function app.price_promo_price_map(p_value jsonb, p_hint text)
returns jsonb
language plpgsql stable set search_path = public as $price_promo_price_map_0177$
declare
  v_kv  record;
  v_dur int;
  v_out jsonb := '{}'::jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_value)) not between 1 and 12 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  for v_kv in select key, value from jsonb_each(p_value) loop
    if v_kv.key !~ '^[0-9]{1,4}$' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    v_dur := v_kv.key::int;
    if v_dur < 15 or v_dur > 480 or v_dur % 5 <> 0 or v_out ? v_dur::text then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    v_out := v_out || jsonb_build_object(v_dur::text,
               app.price_promo_int(v_kv.value, 1, 9007199254740991, true, p_hint));
  end loop;
  return v_out;
end $price_promo_price_map_0177$;

comment on function app.price_promo_price_map(jsonb, text) is
  'price_promo (§2.8). Internal: a court rate''s prices {"<duration_min>": price_iqd}, 1 to 12 durations of 15 to 480 minutes in steps of 5, prices above 0; RECORD_INVALID with hint p_hint otherwise (never the rate screen''s INVALID_PRICES or INVALID_DURATION).';

revoke all on function app.price_promo_price_map(jsonb, text) from public, anon, authenticated;

-- A promotion as app.upsert_promotion would take it (0067:291-420), every
-- refusal RECORD_INVALID with the hint promotion.<field>, never 0067's own
-- NAME_REQUIRED, INVALID_VALUE, INVALID_RANGE, INVALID_WEEKDAYS or CODE_TAKEN
-- (the Promotions screen's). The code: absent keeps the stored one (an edit)
-- or means none (a new promotion), '' clears it, anything else is upper-cased
-- and must be free of every promotion but p_own (the edited one, or the run's
-- own draft).
create or replace function app.price_promo_promotion(p_value jsonb, p_own uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_promotion_0177$
declare
  v_type     text;
  v_starts   timestamptz;
  v_ends     timestamptz;
  v_el       jsonb;
  v_weekdays int[] := '{}';
  v_from     time;
  v_to       time;
  v_key      text;
  v_ids      uuid[];
  v_found    int;
  v_scope    jsonb := '{}'::jsonb;
  v_limits   jsonb := '{}'::jsonb;
  v_n        bigint;
  v_code     text;
  v_out      jsonb;
begin
  perform app.price_promo_only_keys(p_value,
    array['name_en', 'name_ar', 'type', 'value', 'starts_at', 'ends_at', 'weekdays', 'hour_from',
          'hour_to', 'scope', 'limits', 'auto', 'public_code', 'code_single_use'], null, 'promotion.');

  v_type := app.price_promo_text(p_value->'type', 10, true, 'promotion.type');
  if v_type not in ('percent', 'amount') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.type';
  end if;

  v_starts := app.price_promo_instant(p_value->'starts_at', false, 'promotion.starts_at');
  v_ends := app.price_promo_instant(p_value->'ends_at', false, 'promotion.ends_at');
  if v_starts is not null and v_ends is not null and v_starts >= v_ends then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.ends_at';
  end if;

  -- 0 = Sunday .. 6 = Saturday, each once; empty = every day.
  if jsonb_typeof(p_value->'weekdays') is distinct from 'array' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.weekdays';
  end if;
  for v_el in select e from jsonb_array_elements(p_value->'weekdays') e loop
    v_weekdays := v_weekdays || app.price_promo_int(v_el, 0, 6, true, 'promotion.weekdays')::int;
  end loop;
  if cardinality(v_weekdays) <> (select count(distinct d) from unnest(v_weekdays) d) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.weekdays';
  end if;

  -- Both hours or neither; equal hours are an empty window (from > to
  -- crosses midnight).
  v_from := app.price_promo_time(p_value->'hour_from', false, 'promotion.hour_from');
  v_to := app.price_promo_time(p_value->'hour_to', false, 'promotion.hour_to');
  if (v_from is null) <> (v_to is null) or (v_from is not null and v_from = v_to) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.hour_to';
  end if;

  -- The scope, stored as 0067 stores it: known keys, existing ids, empty
  -- arrays dropped.
  if jsonb_typeof(p_value->'scope') is distinct from 'object' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.scope';
  end if;
  perform app.price_promo_only_keys(p_value->'scope', array['courtIds', 'categoryIds', 'itemIds'], 'promotion.scope');
  for v_key in select k from jsonb_object_keys(p_value->'scope') k order by k loop
    continue when jsonb_typeof(p_value->'scope'->v_key) = 'null';
    if jsonb_typeof(p_value->'scope'->v_key) <> 'array' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.scope.' || v_key;
    end if;
    v_ids := '{}';
    for v_el in select e from jsonb_array_elements(p_value->'scope'->v_key) e loop
      v_ids := v_ids || app.price_promo_uuid(v_el, true, 'promotion.scope.' || v_key);
    end loop;
    if cardinality(v_ids) <> (select count(distinct i) from unnest(v_ids) i) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.scope.' || v_key;
    end if;
    continue when cardinality(v_ids) = 0;
    if v_key = 'courtIds' then
      select count(*) into v_found from courts where id = any(v_ids);
    elsif v_key = 'categoryIds' then
      select count(*) into v_found from menu_categories where id = any(v_ids);
    else
      select count(*) into v_found from menu_items where id = any(v_ids);
    end if;
    if v_found <> cardinality(v_ids) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.scope.' || v_key;
    end if;
    v_scope := v_scope || jsonb_build_object(v_key, to_jsonb(v_ids));
  end loop;

  -- The limits: total and perCustomer at least 1, minSpendIqd at least 0.
  if p_value->'limits' is not null and p_value->'limits' <> 'null'::jsonb then
    perform app.price_promo_only_keys(p_value->'limits', array['total', 'perCustomer', 'minSpendIqd'], 'promotion.limits');
    foreach v_key in array array['total', 'perCustomer', 'minSpendIqd'] loop
      v_n := app.price_promo_int(p_value->'limits'->v_key, case when v_key = 'minSpendIqd' then 0 else 1 end,
                                 999999999999999, false, 'promotion.limits.' || v_key);
      if v_n is not null then
        v_limits := v_limits || jsonb_build_object(v_key, v_n);
      end if;
    end loop;
  end if;

  v_out := jsonb_build_object(
    'name_en',         app.price_promo_text(p_value->'name_en', 80, true, 'promotion.name_en'),
    'name_ar',         app.price_promo_text(p_value->'name_ar', 80, true, 'promotion.name_ar'),
    'type',            v_type,
    'value',           app.price_promo_int(p_value->'value', 1,
                                           case when v_type = 'percent' then 99 else 2147483647 end,
                                           true, 'promotion.value'),
    'starts_at',       v_starts,
    'ends_at',         v_ends,
    'weekdays',        to_jsonb(v_weekdays),
    'hour_from',       v_from,
    'hour_to',         v_to,
    'scope',           v_scope,
    'limits',          v_limits,
    'auto',            coalesce(app.price_promo_bool(p_value->'auto', false, 'promotion.auto'), true),
    'code_single_use', coalesce(app.price_promo_bool(p_value->'code_single_use', false, 'promotion.code_single_use'), false));

  if p_value->'public_code' is not null and p_value->'public_code' <> 'null'::jsonb then
    if jsonb_typeof(p_value->'public_code') <> 'string' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.public_code';
    end if;
    v_code := upper(btrim(p_value->>'public_code'));
    if v_code <> '' and (v_code !~ '^[A-Z0-9]{4,16}$'
                         or exists (select 1 from promotions x
                                     where x.public_code = v_code and x.id is distinct from p_own)) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.public_code';
    end if;
    v_out := v_out || jsonb_build_object('public_code', v_code);
  end if;
  return v_out;
end $price_promo_promotion_0177$;

comment on function app.price_promo_promotion(jsonb, uuid) is
  'price_promo (§2.8). Internal: checks and normalises a proposed promotion {name_en, name_ar (<= 80), type percent|amount, value (1-99 | 1-2147483647), starts_at?, ends_at?, weekdays (0-6, each once), hour_from?, hour_to?, scope {courtIds?, categoryIds?, itemIds?} (existing ids), limits? {total?, perCustomer?, minSpendIqd?}, auto?, public_code? (4-16 letters or digits, free of every promotion but p_own; '''' clears), code_single_use?}: 0067''s validations, each refusal RECORD_INVALID or TEXT_TOO_LONG with hint promotion.<field>.';

revoke all on function app.price_promo_promotion(jsonb, uuid) from public, anon, authenticated;

-- A court rate as app.upsert_rate_rule would take it (0071:153-165), every
-- refusal RECORD_INVALID with the hint rule.<field>, never the rate screen's
-- INVALID_DAYS, INVALID_TIME_RANGE, INVALID_PRICES or INVALID_DURATION. The
-- court is one of the venue's; an overnight window is two rules.
create or replace function app.price_promo_rule(p_value jsonb, p_venue uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_rule_0177$
declare
  v_court uuid;
  v_el    jsonb;
  v_days  int[] := '{}';
  v_start time;
  v_end   time;
  v_from  date;
  v_to    date;
begin
  perform app.price_promo_only_keys(p_value,
    array['name', 'court_id', 'days_of_week', 'start_time', 'end_time', 'prices', 'priority',
          'valid_from', 'valid_to', 'is_active'], null, 'rule.');

  v_court := app.price_promo_uuid(p_value->'court_id', false, 'rule.court_id');
  if v_court is not null
     and not exists (select 1 from courts c where c.id = v_court and c.venue_id = p_venue) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'rule.court_id';
  end if;

  if jsonb_typeof(p_value->'days_of_week') is distinct from 'array'
     or jsonb_array_length(p_value->'days_of_week') not between 1 and 7 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'rule.days_of_week';
  end if;
  for v_el in select e from jsonb_array_elements(p_value->'days_of_week') e loop
    v_days := v_days || app.price_promo_int(v_el, 0, 6, true, 'rule.days_of_week')::int;
  end loop;
  if cardinality(v_days) <> (select count(distinct d) from unnest(v_days) d) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'rule.days_of_week';
  end if;

  v_start := app.price_promo_time(p_value->'start_time', true, 'rule.start_time');
  v_end := app.price_promo_time(p_value->'end_time', true, 'rule.end_time');
  if v_start >= v_end then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'rule.end_time';
  end if;

  v_from := app.price_promo_date(p_value->'valid_from', 'rule.valid_from');
  v_to := app.price_promo_date(p_value->'valid_to', 'rule.valid_to');
  if v_from is not null and v_to is not null and v_from > v_to then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'rule.valid_to';
  end if;

  return jsonb_build_object(
    'name',         app.price_promo_text(p_value->'name', 80, true, 'rule.name'),
    'court_id',     v_court,
    'days_of_week', to_jsonb(v_days),
    'start_time',   v_start,
    'end_time',     v_end,
    'prices',       app.price_promo_price_map(p_value->'prices', 'rule.prices'),
    'priority',     coalesce(app.price_promo_int(p_value->'priority', -2147483648, 2147483647, false, 'rule.priority'), 0),
    'valid_from',   v_from,
    'valid_to',     v_to,
    'is_active',    app.price_promo_bool(p_value->'is_active', true, 'rule.is_active'));
end $price_promo_rule_0177$;

comment on function app.price_promo_rule(jsonb, uuid) is
  'price_promo (§2.8). Internal: checks and normalises a proposed court rate {name (<= 80), court_id? (a court at p_venue; null = every court), days_of_week (1-7 distinct, 0-6), start_time, end_time (start before end), prices {"<duration_min>": price_iqd} (1-12, 15-480 in steps of 5, > 0), priority?, valid_from?, valid_to? (from <= to), is_active}: each refusal RECORD_INVALID or TEXT_TOO_LONG with hint rule.<field>.';

revoke all on function app.price_promo_rule(jsonb, uuid) from public, anon, authenticated;

-- The record of a run's step that counts: its latest approved or automatic
-- pass. NULL until the step has passed once.
create or replace function app.price_promo_record(p_run_id uuid, p_step_key text)
returns jsonb
language sql stable security definer set search_path = public as $price_promo_record_0177$
  select x.record
    from protocol_submissions x
    join protocol_run_steps s on s.id = x.run_step_id
   where x.run_id = p_run_id and s.step_key = p_step_key
     and x.decision in ('approve', 'auto')
   order by x.round desc, x.decided_at desc, x.id desc
   limit 1
$price_promo_record_0177$;

comment on function app.price_promo_record(uuid, text) is
  'price_promo (§2.13). Internal: the record of the latest approved or automatically passed submission of a run''s step (propose: the targets; numbers: the final figures; apply: when). NULL before the step has passed.';

revoke all on function app.price_promo_record(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The menu writers (§2.13, §2.18). The size lock in upsert_variant (E's
--    wrapper, re-issued once more), and upsert_modifier split into its
--    internal body and a wrapper with the add-on lock.
-- ---------------------------------------------------------------------------

-- app.upsert_variant — product_release's wrapper, plus the size lock after
-- the in-release check: a manager does not add a size to, or change a stored
-- size price of, an item that is not a draft (launched, or switched on), cafe
-- or shop (#51). Stock ▸ Products' upsert_retail_variant reaches it through
-- its call. A name, default or order change is never refused, and a size that
-- does not exist falls through to VARIANT_NOT_FOUND. Both checks read the
-- item row locked: the price and shop_launch apply lock it before they write,
-- so a save racing an apply waits for it and then sees the item launched.
create or replace function app.upsert_variant(
  p_item_id    uuid,
  p_name_en    text,
  p_name_ar    text,
  p_price_iqd  bigint,
  p_id         uuid default null,
  p_is_default boolean default false,
  p_sort_order int default 0
) returns uuid
language plpgsql security definer set search_path = public as $upsert_variant_0177$
declare
  v_run_status text;
  v_price      bigint;
  v_item       menu_items%rowtype;
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

  -- The size lock (#41, #51): a manager's price goes through a price change.
  if app.staff_role() = 'manager' then
    if v_item.id is not null and (v_item.launched_at is not null or v_item.is_active) then
      if p_id is null then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
      end if;
      select v.price_iqd into v_price
        from menu_item_variants v
       where v.id = p_id and v.item_id = p_item_id;
      if found and p_price_iqd is distinct from v_price then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return app.upsert_variant_internal(p_item_id, p_name_en, p_name_ar, p_price_iqd,
                                     p_id, p_is_default, p_sort_order);
end $upsert_variant_0177$;

comment on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) is
  'Manager or owner: creates or updates one size of a menu item or shop product (0013; a wrapper over app.upsert_variant_internal since product_release). ITEM_IN_RELEASE, for everyone, on a new size or a price change of an item whose product release is not live or done: its prices come from the price step. PRICE_VIA_PROTOCOL (price_promo, #51), for a manager, on a new size or a price change of any item that is not a draft (launched_at set, or switched on), cafe or shop, including through app.upsert_retail_variant: it goes through a price change. ITEM_NOT_FOUND, VARIANT_NOT_FOUND, INVALID_PRICE.';

revoke all on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) from public, anon;
grant execute on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) to authenticated;

-- app.upsert_modifier_internal — the 0013:298 body without its guard, plus
-- the launched_at stamp whenever the save leaves the add-on switched on.
create or replace function app.upsert_modifier_internal(
  p_group_id        uuid,
  p_name_en         text,
  p_name_ar         text,
  p_id              uuid default null,
  p_price_delta_iqd bigint default 0,
  p_sort_order      int default 0,
  p_is_active       boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $upsert_modifier_internal_0177$
declare
  v_before jsonb;
  v_row    modifiers%rowtype;
begin
  if not exists (select 1 from modifier_groups where id = p_group_id) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_price_delta_iqd is null or p_price_delta_iqd < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into modifiers (group_id, name_en, name_ar, price_delta_iqd, sort_order, is_active, launched_at)
    values (p_group_id, p_name_en, p_name_ar, p_price_delta_iqd, p_sort_order, p_is_active,
            case when p_is_active then now() end)
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
           is_active = p_is_active,
           launched_at = case when p_is_active then coalesce(v_row.launched_at, now())
                              else v_row.launched_at end
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.modifier.update', 'modifiers', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $upsert_modifier_internal_0177$;

comment on function app.upsert_modifier_internal(uuid, text, text, uuid, bigint, int, boolean) is
  'price_promo (§2.13). Internal: the 0013 app.upsert_modifier body without its guard, plus launched_at = coalesce(launched_at, now()) whenever the save leaves the add-on switched on. Creates or updates one add-on; audit menu.modifier.create or menu.modifier.update. Called by the public app.upsert_modifier and by the addon_price apply.';

revoke all on function app.upsert_modifier_internal(uuid, text, text, uuid, bigint, int, boolean) from public, anon, authenticated;

-- The compulsory add-on lock (§2.13, the review of wave 3). A paid add-on
-- made compulsory raises what a guest pays as surely as a new price:
-- add_order_items refuses a line that misses a group's min_select
-- (MODIFIER_SELECTION, 0095), so the item costs more, and a compulsory group
-- revealed by a choice makes that choice cost more. A manager's add-on write
-- that raises either is refused: a group's min_select, an item link, a
-- reveal, and an option switched off or moved. The owner passes, as at every
-- lock.

-- The least a guest adds for one group's choices: its min_select cheapest
-- switched-on options. 0 when it asks for none, or when too few are on for
-- anyone to satisfy it: the item cannot be sold then, so no price is set,
-- and making it sellable at a price is a raise. Internal.
create or replace function app.addon_group_floor(p_group_id uuid)
returns bigint
language sql stable security definer set search_path = public as $addon_group_floor_0177$
  select (case when g.min_select = 0 or count(m.id) < g.min_select then 0
               else sum(m.price_delta_iqd) filter (where m.rn <= g.min_select) end)::bigint
    from modifier_groups g
    left join (select x.id, x.price_delta_iqd,
                      row_number() over (order by x.price_delta_iqd, x.id) as rn
                 from modifiers x
                where x.group_id = p_group_id and x.is_active) m on true
   where g.id = p_group_id
   group by g.id, g.min_select
$addon_group_floor_0177$;

comment on function app.addon_group_floor(uuid) is
  'price_promo (§2.13, the compulsory add-on lock). Internal: the sum of a group''s min_select cheapest switched-on options; 0 when min_select is 0 or fewer options are on than it needs.';

revoke all on function app.addon_group_floor(uuid) from public, anon, authenticated;

-- What a guest pays at least in add-ons for one item, and for each choice on
-- it: {"floor": <the item>, "<modifier_id>": <the choice>}. A choice costs
-- its price plus the least of every group it reveals (one level deep, 0028;
-- a group the item links anyway adds nothing). Every option of a linked
-- group is listed, switched on or off, so switching one back on never hides
-- a change made while it was off. The floor is, per linked group, its
-- min_select cheapest switched-on choices (0 as in addon_group_floor).
-- Internal.
create or replace function app.addon_item_prices(p_item_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $addon_item_prices_0177$
  with linked as (
    select g.id, g.min_select
      from menu_item_modifier_groups l
      join modifier_groups g on g.id = l.group_id
     where l.item_id = p_item_id
  ),
  opts as (
    select l.id as group_id, m.id, m.is_active,
           m.price_delta_iqd + coalesce((
             select sum(app.addon_group_floor(r.group_id))
               from modifier_reveals r
              where r.modifier_id = m.id
                and not exists (select 1 from linked k where k.id = r.group_id)), 0) as cost
      from linked l
      join modifiers m on m.group_id = l.id
  ),
  ranked as (
    select o.group_id, o.cost,
           row_number() over (partition by o.group_id order by o.cost, o.id) as rn,
           count(*) over (partition by o.group_id) as n
      from opts o
     where o.is_active
  ),
  floors as (
    select (case when l.min_select = 0 or coalesce(max(k.n), 0) < l.min_select then 0
                 else coalesce(sum(k.cost) filter (where k.rn <= l.min_select), 0) end) as floor
      from linked l
      left join ranked k on k.group_id = l.id
     group by l.id, l.min_select
  )
  select jsonb_build_object('floor', coalesce((select sum(f.floor) from floors f), 0)::bigint)
         || coalesce((select jsonb_object_agg(o.id::text, o.cost::bigint) from opts o), '{}'::jsonb)
$addon_item_prices_0177$;

comment on function app.addon_item_prices(uuid) is
  'price_promo (§2.13, the compulsory add-on lock). Internal: {floor, <modifier_id>: cost} for one item: the least a guest adds for it (per linked group, its min_select cheapest switched-on choices), and what each option of a linked group costs at least (its price plus app.addon_group_floor of every group it reveals that the item does not link).';

revoke all on function app.addon_item_prices(uuid) from public, anon, authenticated;

-- The items whose add-on prices these groups set: every item that links
-- one, and every item that links a group with an option revealing one.
-- Internal.
create or replace function app.addon_items_of(p_group_ids uuid[])
returns uuid[]
language sql stable security definer set search_path = public as $addon_items_of_0177$
  select coalesce(array_agg(distinct x.item_id), '{}'::uuid[])
    from (select l.item_id
            from menu_item_modifier_groups l
           where l.group_id = any(p_group_ids)
          union
          select l.item_id
            from modifier_reveals r
            join modifiers m on m.id = r.modifier_id
            join menu_item_modifier_groups l on l.group_id = m.group_id
           where r.group_id = any(p_group_ids)) x
$addon_items_of_0177$;

comment on function app.addon_items_of(uuid[]) is
  'price_promo (§2.13, the compulsory add-on lock). Internal: the items that link one of p_group_ids, or link a group with an option that reveals one.';

revoke all on function app.addon_items_of(uuid[]) from public, anon, authenticated;

-- {item_id: app.addon_item_prices(item_id)}, taken before a manager's write.
-- Internal.
create or replace function app.addon_prices_snapshot(p_item_ids uuid[])
returns jsonb
language sql stable security definer set search_path = public as $addon_prices_snapshot_0177$
  select coalesce(jsonb_object_agg(i::text, app.addon_item_prices(i)), '{}'::jsonb)
    from unnest(coalesce(p_item_ids, '{}'::uuid[])) as i
$addon_prices_snapshot_0177$;

comment on function app.addon_prices_snapshot(uuid[]) is
  'price_promo (§2.13, the compulsory add-on lock). Internal: {item_id: app.addon_item_prices(item_id)} for p_item_ids, the snapshot a manager''s add-on write is checked against.';

revoke all on function app.addon_prices_snapshot(uuid[]) from public, anon, authenticated;

-- After a manager's write: PRICE_VIA_PROTOCOL (hint required_addon) when an
-- item of the snapshot, or a choice on it, now costs more than it did. A
-- choice no longer on the item is not compared. The raise rolls the write
-- back. Internal.
create or replace function app.addon_prices_guard(p_before jsonb)
returns void
language plpgsql stable security definer set search_path = public as $addon_prices_guard_0177$
begin
  if exists (select 1
               from jsonb_each(coalesce(p_before, '{}'::jsonb)) i
               cross join lateral (select app.addon_item_prices(i.key::uuid) as now) a
               cross join lateral jsonb_each_text(i.value) b
              where (a.now->>b.key)::bigint > b.value::bigint) then
    raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001', hint = 'required_addon';
  end if;
end $addon_prices_guard_0177$;

comment on function app.addon_prices_guard(jsonb) is
  'price_promo (§2.13, the compulsory add-on lock). Internal: raises PRICE_VIA_PROTOCOL (hint required_addon) when an item of an app.addon_prices_snapshot now has a higher floor, or a choice on it a higher cost (app.addon_item_prices).';

revoke all on function app.addon_prices_guard(jsonb) from public, anon, authenticated;

-- app.upsert_modifier — the same signature, guard and grant, now a wrapper
-- with the add-on lock, for a manager (#51, #53):
--   * a launched add-on (launched_at set, or switched on) keeps its price:
--     PRICE_VIA_PROTOCOL;
--   * a paid add-on that was never launched is not saved switched on:
--     LAUNCH_VIA_PROTOCOL. Saved hidden it passes, its price stays editable,
--     and an addon_price change puts it on sale;
--   * a free option (0 IQD) may be added or switched on: it carries no price,
--     and the internal stamps it launched, so a later price is a change;
--   * a save that raises the least a guest pays in add-ons for an item or a
--     choice on it (a free option switched off or moved out of a compulsory
--     group) is PRICE_VIA_PROTOCOL, hint required_addon.
-- Otherwise renaming, moving, reordering and switching a launched add-on off
-- and on are unchanged. A missing group or add-on falls through to
-- GROUP_NOT_FOUND or MODIFIER_NOT_FOUND. p_is_active defaults to true, so the
-- Add-ons editor sends false for a manager's new paid add-on. The add-on row
-- is read locked: the addon_price apply locks it before it writes, so a save
-- racing an apply waits for it and then sees the add-on launched.
create or replace function app.upsert_modifier(
  p_group_id        uuid,
  p_name_en         text,
  p_name_ar         text,
  p_id              uuid default null,
  p_price_delta_iqd bigint default 0,
  p_sort_order      int default 0,
  p_is_active       boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $upsert_modifier_0177$
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
      v_prices := app.addon_prices_snapshot(app.addon_items_of(array[p_group_id, v_mod.group_id]));
    end if;
  end if;

  v_id := app.upsert_modifier_internal(p_group_id, p_name_en, p_name_ar, p_id,
                                       p_price_delta_iqd, p_sort_order, p_is_active);
  if v_prices is not null then
    perform app.addon_prices_guard(v_prices);
  end if;
  return v_id;
end $upsert_modifier_0177$;

comment on function app.upsert_modifier(uuid, text, text, uuid, bigint, int, boolean) is
  'Manager or owner: creates or updates one add-on (0013; a wrapper over app.upsert_modifier_internal since price_promo). For a manager: PRICE_VIA_PROTOCOL on a changed price of a launched add-on (launched_at set, or switched on); LAUNCH_VIA_PROTOCOL on a never-launched paid add-on saved switched on (saved hidden it passes and goes on sale through an addon_price change); PRICE_VIA_PROTOCOL (hint required_addon) on a save that raises the least a guest pays in add-ons for an item or a choice on it (app.addon_item_prices). A free option may be added and switched on. GROUP_NOT_FOUND, MODIFIER_NOT_FOUND, INVALID_PRICE.';

revoke all on function app.upsert_modifier(uuid, text, text, uuid, bigint, int, boolean) from public, anon;
grant execute on function app.upsert_modifier(uuid, text, text, uuid, bigint, int, boolean) to authenticated;

-- app.upsert_modifier_group — the 0013:256 body verbatim, plus the
-- compulsory add-on lock: a manager's min_select that raises the least a
-- guest pays for an item offering the group, or for the choice revealing
-- it, is PRICE_VIA_PROTOCOL, hint required_addon. A group with a free
-- option to pick, or offered nowhere yet, is the manager's as before.
create or replace function app.upsert_modifier_group(
  p_name_en    text,
  p_name_ar    text,
  p_id         uuid default null,
  p_min_select int default 0,
  p_max_select int default 1
) returns uuid
language plpgsql security definer set search_path = public as $upsert_modifier_group_0177$
declare
  v_before jsonb;
  v_row    modifier_groups%rowtype;
  v_prices jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_min_select < 0 or p_max_select < 1 or p_min_select > p_max_select then
    raise exception 'INVALID_SELECT_RANGE' using errcode = 'P0001';
  end if;
  if app.staff_role() = 'manager' and p_id is not null then
    v_prices := app.addon_prices_snapshot(app.addon_items_of(array[p_id]));
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
  if v_prices is not null then
    perform app.addon_prices_guard(v_prices);
  end if;
  return v_row.id;
end $upsert_modifier_group_0177$;

comment on function app.upsert_modifier_group(text, text, uuid, int, int) is
  'Manager or owner: creates or updates one add-on group (0013; price_promo adds the compulsory add-on lock). For a manager, PRICE_VIA_PROTOCOL (hint required_addon) when the new min_select raises the least a guest pays in add-ons for an item that offers the group, or for the choice that reveals it (app.addon_item_prices). INVALID_SELECT_RANGE, GROUP_NOT_FOUND.';

revoke all on function app.upsert_modifier_group(text, text, uuid, int, int) from public, anon;
grant execute on function app.upsert_modifier_group(text, text, uuid, int, int) to authenticated;

-- app.link_item_modifier_group — the 0013:377 body verbatim, plus the
-- compulsory add-on lock: a manager does not link a group that would raise
-- the least a guest pays for the item (a compulsory group with no free
-- choice): PRICE_VIA_PROTOCOL, hint required_addon. Unlinking never raises it.
create or replace function app.link_item_modifier_group(
  p_item_id    uuid,
  p_group_id   uuid,
  p_sort_order int default 0,
  p_linked     boolean default true
) returns void
language plpgsql security definer set search_path = public as $link_item_modifier_group_0177$
declare
  v_prices jsonb;
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
  if app.staff_role() = 'manager' then
    v_prices := app.addon_prices_snapshot(array[p_item_id]);
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
  if v_prices is not null then
    perform app.addon_prices_guard(v_prices);
  end if;
end $link_item_modifier_group_0177$;

comment on function app.link_item_modifier_group(uuid, uuid, int, boolean) is
  'Manager or owner: links or unlinks one add-on group on one item (0013; price_promo adds the compulsory add-on lock). For a manager, PRICE_VIA_PROTOCOL (hint required_addon) when the link raises the least a guest pays in add-ons for the item or a choice on it (app.addon_item_prices). ITEM_NOT_FOUND, GROUP_NOT_FOUND.';

revoke all on function app.link_item_modifier_group(uuid, uuid, int, boolean) from public, anon;
grant execute on function app.link_item_modifier_group(uuid, uuid, int, boolean) to authenticated;

-- app.set_modifier_reveals — the 0028:76 body verbatim, plus the compulsory
-- add-on lock: a manager does not make an option reveal a compulsory group
-- with no free choice, which raises what the option costs:
-- PRICE_VIA_PROTOCOL, hint required_addon. Clearing reveals never raises it.
create or replace function app.set_modifier_reveals(
  p_modifier_id uuid,
  p_group_ids   uuid[]
) returns void
language plpgsql security definer set search_path = public as $set_modifier_reveals_0177$
declare
  v_own_group uuid;
  v_ids       uuid[];
  v_before    uuid[];
  v_prices    jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Serialise reveal writers: the depth invariant is checked against OTHER
  -- modifiers' rows, so two concurrent edits must not both pass their
  -- pre-checks. Readers are never blocked; writes are rare admin edits.
  lock table modifier_reveals in share row exclusive mode;

  select group_id into v_own_group from modifiers where id = p_modifier_id for update;
  if not found then
    raise exception 'MODIFIER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if app.staff_role() = 'manager' then
    v_prices := app.addon_prices_snapshot(app.addon_items_of(array[v_own_group]));
  end if;

  -- Dedupe, keeping the first position of each id (that position = sort_order).
  select coalesce(array_agg(d.id order by d.ord), '{}')
    into v_ids
    from (
      select distinct on (s.id) s.id, s.ord
        from unnest(coalesce(p_group_ids, '{}')) with ordinality as s(id, ord)
       order by s.id, s.ord
    ) d;

  if exists (
       select 1 from unnest(v_ids) as g(id)
        where g.id is null
           or not exists (select 1 from modifier_groups mg where mg.id = g.id)
     ) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_own_group = any (v_ids) then
    raise exception 'REVEAL_SELF' using errcode = 'P0001';
  end if;

  if cardinality(v_ids) > 0 then
    -- (a) a target group already contains a revealing modifier -> would be depth 2.
    if exists (
         select 1
           from modifier_reveals r
           join modifiers m on m.id = r.modifier_id
          where m.group_id = any (v_ids)
       ) then
      raise exception 'REVEAL_DEPTH' using errcode = 'P0001',
        detail = 'a target group contains a modifier that has reveals of its own';
    end if;
    -- (b) this modifier's own group is itself revealed somewhere -> would be depth 2.
    if exists (select 1 from modifier_reveals where group_id = v_own_group) then
      raise exception 'REVEAL_DEPTH' using errcode = 'P0001',
        detail = 'the revealing modifier belongs to a group that is itself a reveal target';
    end if;
  end if;

  select coalesce(array_agg(group_id order by sort_order, group_id), '{}')
    into v_before
    from modifier_reveals where modifier_id = p_modifier_id;

  delete from modifier_reveals where modifier_id = p_modifier_id;

  insert into modifier_reveals (modifier_id, group_id, sort_order)
  select p_modifier_id, s.id, s.ord - 1
    from unnest(v_ids) with ordinality as s(id, ord);

  perform app.write_audit('menu.modifier.reveals', 'modifier_reveals', p_modifier_id::text,
                          jsonb_build_object('modifier_id', p_modifier_id,
                                             'group_id', v_own_group,
                                             'reveals', to_jsonb(v_before)),
                          jsonb_build_object('modifier_id', p_modifier_id,
                                             'group_id', v_own_group,
                                             'reveals', to_jsonb(v_ids)));
  if v_prices is not null then
    perform app.addon_prices_guard(v_prices);
  end if;
end $set_modifier_reveals_0177$;

comment on function app.set_modifier_reveals(uuid, uuid[]) is
  'Manager or owner: replaces one option''s reveal list (0028; price_promo adds the compulsory add-on lock). For a manager, PRICE_VIA_PROTOCOL (hint required_addon) when the reveals raise the least a guest pays for the option, or for an item that offers it (app.addon_item_prices). MODIFIER_NOT_FOUND, GROUP_NOT_FOUND, REVEAL_SELF, REVEAL_DEPTH.';

revoke all on function app.set_modifier_reveals(uuid, uuid[]) from public, anon;
grant execute on function app.set_modifier_reveals(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The promotion writers (§2.13, #57). The two internals are the 0067
--    bodies without their guards; the public RPCs keep their signatures,
--    guards and grants and refuse a manager: a new promotion or an edit is a
--    promotion or promotion_edit change, a switch-on a promotion_enable
--    change, and a code travels in the change's record. A manager's switch-
--    off passes (PROPOSAL, plan §11 Q8), and so does the duplicate no-op.
-- ---------------------------------------------------------------------------

-- app.upsert_promotion_internal — the 0067:258 body without its guard.
-- Semantics as there: full replacement, except that p_public_code null KEEPS
-- an existing code and '' CLEARS it.
create or replace function app.upsert_promotion_internal(
  p_id              uuid        default null,
  p_name_en         text        default null,
  p_name_ar         text        default null,
  p_type            text        default null,
  p_value           int         default null,
  p_starts_at       timestamptz default null,
  p_ends_at         timestamptz default null,
  p_weekdays        int[]       default '{}',
  p_hour_from       time        default null,
  p_hour_to         time        default null,
  p_scope           jsonb       default '{}'::jsonb,
  p_limits          jsonb       default '{}'::jsonb,
  p_auto            boolean     default true,
  p_public_code     text        default null,
  p_code_single_use boolean     default false,
  p_enabled         boolean     default true
) returns uuid
language plpgsql security definer set search_path = public as $upsert_promotion_internal_0177$
declare
  v_row      promotions%rowtype;
  v_before   jsonb;
  v_scope    jsonb := '{}'::jsonb;
  v_limits   jsonb := '{}'::jsonb;
  v_code     text;
  v_key      text;
  v_ids      uuid[];
  v_n        int;
  v_found    int;
  v_wd       int;
  v_weekdays int[] := coalesce(p_weekdays, '{}');
begin
  -- names
  if coalesce(btrim(p_name_en), '') = '' or coalesce(btrim(p_name_ar), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001',
      hint = 'both English and Arabic names';
  end if;

  -- type + value
  if p_type is null or p_type not in ('percent','amount') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'type',
      hint = 'type is percent or amount';
  end if;
  if p_type = 'percent' and (p_value is null or p_value < 1 or p_value > 99) then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'value',
      hint = 'percent promotions are whole numbers 1..99';
  end if;
  if p_type = 'amount' and (p_value is null or p_value < 1) then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'value',
      hint = 'amount promotions are IQD > 0';
  end if;

  -- dates
  if p_starts_at is not null and p_ends_at is not null and p_starts_at >= p_ends_at then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', detail = 'dates',
      hint = 'ends_at must be after starts_at';
  end if;

  -- weekdays: 0..6, no duplicates
  v_n := coalesce(array_length(v_weekdays, 1), 0);
  if v_n > 0 then
    foreach v_wd in array v_weekdays loop
      if v_wd is null or v_wd < 0 or v_wd > 6 then
        raise exception 'INVALID_WEEKDAYS' using errcode = 'P0001',
          detail = coalesce(v_wd::text, 'null'), hint = '0 = Sunday .. 6 = Saturday';
      end if;
    end loop;
    if v_n <> (select count(distinct d) from unnest(v_weekdays) d) then
      raise exception 'INVALID_WEEKDAYS' using errcode = 'P0001', hint = 'each weekday once';
    end if;
  end if;

  -- hour window: both or neither; a zero-length window is refused
  if (p_hour_from is null) <> (p_hour_to is null) then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', detail = 'hours',
      hint = 'hour_from and hour_to go together';
  end if;
  if p_hour_from is not null and p_hour_from = p_hour_to then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', detail = 'hours',
      hint = 'hour window must not be empty (from > to crosses midnight)';
  end if;

  -- scope: known keys, arrays of existing ids; stored canonical (lower-case
  -- uuid text, empty arrays dropped) so the `?` containment tests in
  -- eligibility are exact.
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope',
      hint = 'scope is an object {courtIds, categoryIds, itemIds}';
  end if;
  for v_key in select jsonb_object_keys(p_scope) loop
    if v_key not in ('courtIds','categoryIds','itemIds') then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = 'scope keys are courtIds, categoryIds, itemIds';
    end if;
    if jsonb_typeof(p_scope->v_key) = 'null' then
      continue;
    end if;
    if jsonb_typeof(p_scope->v_key) <> 'array' then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = 'an array of ids';
    end if;
    begin
      select coalesce(array_agg(distinct (e #>> '{}')::uuid), '{}')
        into v_ids from jsonb_array_elements(p_scope->v_key) e;
    exception when invalid_text_representation then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = 'ids must be uuids';
    end;
    v_n := coalesce(array_length(v_ids, 1), 0);
    if v_n = 0 then
      continue;
    end if;
    if v_key = 'courtIds' then
      select count(*) into v_found from courts where id = any(v_ids);
    elsif v_key = 'categoryIds' then
      select count(*) into v_found from menu_categories where id = any(v_ids);
    else
      select count(*) into v_found from menu_items where id = any(v_ids);
    end if;
    if v_found <> v_n then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = format('%s of %s ids exist', v_found, v_n);
    end if;
    v_scope := v_scope || jsonb_build_object(v_key, to_jsonb(v_ids));
  end loop;

  -- limits: known keys, whole numbers; total/perCustomer >= 1, minSpendIqd >= 0.
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits',
      hint = 'limits is an object {total, perCustomer, minSpendIqd}';
  end if;
  for v_key in select jsonb_object_keys(p_limits) loop
    if v_key not in ('total','perCustomer','minSpendIqd') then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits.' || v_key,
        hint = 'limit keys are total, perCustomer, minSpendIqd';
    end if;
    if jsonb_typeof(p_limits->v_key) = 'null' then
      continue;
    end if;
    if jsonb_typeof(p_limits->v_key) <> 'number'
       or (p_limits->>v_key) !~ '^[0-9]{1,15}$' then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits.' || v_key,
        hint = 'a whole non-negative number';
    end if;
    if v_key in ('total','perCustomer') and (p_limits->>v_key)::bigint < 1 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits.' || v_key,
        hint = 'at least 1';
    end if;
    v_limits := v_limits || jsonb_build_object(v_key, (p_limits->>v_key)::bigint);
  end loop;

  -- code: normalised upper-case; '' clears; null keeps (update) / none (insert)
  if p_public_code is not null then
    v_code := nullif(upper(btrim(p_public_code)), '');
    if v_code is not null and v_code !~ '^[A-Z0-9]{4,16}$' then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'public_code',
        hint = '4-16 letters or digits';
    end if;
    if v_code is not null and exists (
         select 1 from promotions x where x.public_code = v_code and x.id is distinct from p_id) then
      raise exception 'CODE_TAKEN' using errcode = 'P0001', detail = v_code;
    end if;
  end if;

  if p_id is null then
    begin
      insert into promotions (name_en, name_ar, type, value, starts_at, ends_at, weekdays,
                              hour_from, hour_to, scope, limits, auto, public_code,
                              code_single_use, enabled, created_by)
      values (btrim(p_name_en), btrim(p_name_ar), p_type, p_value, p_starts_at, p_ends_at,
              v_weekdays, p_hour_from, p_hour_to, v_scope, v_limits, coalesce(p_auto, true),
              v_code, coalesce(p_code_single_use, false), coalesce(p_enabled, true), auth.uid())
      returning * into v_row;
    exception when unique_violation then
      raise exception 'CODE_TAKEN' using errcode = 'P0001', detail = v_code;
    end;
    perform app.write_audit('promotion.upsert', 'promotions', v_row.id::text, null, to_jsonb(v_row));
    return v_row.id;
  end if;

  select * into v_row from promotions where id = p_id for update;
  if not found then
    raise exception 'PROMOTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  begin
    update promotions
       set name_en         = btrim(p_name_en),
           name_ar         = btrim(p_name_ar),
           type            = p_type,
           value           = p_value,
           starts_at       = p_starts_at,
           ends_at         = p_ends_at,
           weekdays        = v_weekdays,
           hour_from       = p_hour_from,
           hour_to         = p_hour_to,
           scope           = v_scope,
           limits          = v_limits,
           auto            = coalesce(p_auto, true),
           public_code     = case when p_public_code is null then public_code else v_code end,
           code_single_use = coalesce(p_code_single_use, false),
           enabled         = coalesce(p_enabled, true),
           updated_at      = now()
     where id = p_id
     returning * into v_row;
  exception when unique_violation then
    raise exception 'CODE_TAKEN' using errcode = 'P0001', detail = v_code;
  end;

  perform app.write_audit('promotion.upsert', 'promotions', p_id::text, v_before, to_jsonb(v_row));
  return v_row.id;
end $upsert_promotion_internal_0177$;

comment on function app.upsert_promotion_internal(uuid, text, text, text, int, timestamptz, timestamptz, int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) is
  'price_promo (§2.13). Internal: the 0067 app.upsert_promotion body without its guard: creates (created_by = the caller) or replaces a promotion, validated by name (NAME_REQUIRED, INVALID_VALUE, INVALID_RANGE, INVALID_WEEKDAYS, CODE_TAKEN, PROMOTION_NOT_FOUND); p_public_code null keeps a code and '''' clears it. Audit promotion.upsert. Called by the public app.upsert_promotion, by a promotion change''s proposal (its disabled draft) and by the apply.';

revoke all on function app.upsert_promotion_internal(uuid, text, text, text, int, timestamptz, timestamptz, int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) from public, anon, authenticated;

-- app.upsert_promotion — the same signature, guard and grant: a manager's
-- save, new or edit, on or off, is refused (#57).
create or replace function app.upsert_promotion(
  p_id              uuid        default null,
  p_name_en         text        default null,
  p_name_ar         text        default null,
  p_type            text        default null,
  p_value           int         default null,
  p_starts_at       timestamptz default null,
  p_ends_at         timestamptz default null,
  p_weekdays        int[]       default '{}',
  p_hour_from       time        default null,
  p_hour_to         time        default null,
  p_scope           jsonb       default '{}'::jsonb,
  p_limits          jsonb       default '{}'::jsonb,
  p_auto            boolean     default true,
  p_public_code     text        default null,
  p_code_single_use boolean     default false,
  p_enabled         boolean     default true
) returns uuid
language plpgsql security definer set search_path = public as $upsert_promotion_0177$
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if app.staff_role() = 'manager' then
    raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
  end if;

  return app.upsert_promotion_internal(p_id, p_name_en, p_name_ar, p_type, p_value, p_starts_at,
                                       p_ends_at, p_weekdays, p_hour_from, p_hour_to, p_scope,
                                       p_limits, p_auto, p_public_code, p_code_single_use, p_enabled);
end $upsert_promotion_0177$;

comment on function app.upsert_promotion(uuid, text, text, text, int, timestamptz, timestamptz, int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) is
  'Owner (the guard admits manager and owner; a manager is refused PRICE_VIA_PROTOCOL on every call since price_promo, #57: a promotion is proposed and edited through a price or promotion change): creates or replaces a promotion (0067; a wrapper over app.upsert_promotion_internal). NAME_REQUIRED, INVALID_VALUE, INVALID_RANGE, INVALID_WEEKDAYS, CODE_TAKEN, PROMOTION_NOT_FOUND.';

revoke all on function app.upsert_promotion(uuid, text, text, text, int, timestamptz, timestamptz,
  int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) from public, anon;
grant execute on function app.upsert_promotion(uuid, text, text, text, int, timestamptz, timestamptz,
  int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) to authenticated;

-- app.set_promotion_enabled_internal — the 0067:484 body without its guard.
create or replace function app.set_promotion_enabled_internal(p_id uuid, p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path = public as $set_promotion_enabled_internal_0177$
declare
  v_row    promotions%rowtype;
  v_before jsonb;
begin
  if p_enabled is null then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'enabled';
  end if;

  select * into v_row from promotions where id = p_id for update;
  if not found then
    raise exception 'PROMOTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.enabled = p_enabled then
    return jsonb_build_object('id', v_row.id, 'enabled', v_row.enabled, 'duplicate', true);
  end if;
  v_before := to_jsonb(v_row);

  update promotions set enabled = p_enabled, updated_at = now()
   where id = p_id
   returning * into v_row;

  perform app.write_audit('promotion.set_enabled', 'promotions', p_id::text,
                          v_before, to_jsonb(v_row));
  return jsonb_build_object('id', v_row.id, 'enabled', v_row.enabled, 'duplicate', false);
end $set_promotion_enabled_internal_0177$;

comment on function app.set_promotion_enabled_internal(uuid, boolean) is
  'price_promo (§2.13). Internal: the 0067 app.set_promotion_enabled body without its guard: switches a promotion on or off, {id, enabled, duplicate}; INVALID_VALUE, PROMOTION_NOT_FOUND. Audit promotion.set_enabled. Called by the public app.set_promotion_enabled and by the apply of promotion and promotion_enable changes.';

revoke all on function app.set_promotion_enabled_internal(uuid, boolean) from public, anon, authenticated;

-- app.set_promotion_enabled — the same signature, guard and grant: a
-- manager's switch-on of a promotion that is off is refused (#57); a
-- switch-off, and switching on one already on (the duplicate), pass.
create or replace function app.set_promotion_enabled(p_id uuid, p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path = public as $set_promotion_enabled_0177$
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if app.staff_role() = 'manager' and p_enabled
     and exists (select 1 from promotions p where p.id = p_id and not p.enabled) then
    raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
  end if;

  return app.set_promotion_enabled_internal(p_id, p_enabled);
end $set_promotion_enabled_0177$;

comment on function app.set_promotion_enabled(uuid, boolean) is
  'Manager or owner: switches a promotion on or off (0067; a wrapper over app.set_promotion_enabled_internal since price_promo), {id, enabled, duplicate}. A manager''s switch-on of a promotion that is off is refused PRICE_VIA_PROTOCOL (#57: a promotion_enable change); a switch-off passes. INVALID_VALUE, PROMOTION_NOT_FOUND.';

revoke all on function app.set_promotion_enabled(uuid, boolean) from public, anon;
grant execute on function app.set_promotion_enabled(uuid, boolean) to authenticated;

-- app.generate_promo_code — the 0067:525 body, plus the refusal of a manager
-- after its guard: a code decides who can redeem a promotion that is not
-- automatic, so it travels in the change's record (#57).
create or replace function app.generate_promo_code(p_id uuid)
returns text
language plpgsql security definer set search_path = public as $generate_promo_code_0177$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_row      promotions%rowtype;
  v_before   jsonb;
  v_bytes    bytea;
  v_code     text;
  v_try      int := 0;
  i          int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if app.staff_role() = 'manager' then
    raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
  end if;

  select * into v_row from promotions where id = p_id for update;
  if not found then
    raise exception 'PROMOTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  loop
    v_try := v_try + 1;
    if v_try > 20 then
      raise exception 'CODE_GENERATION_FAILED' using errcode = 'P0001';
    end if;
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from promotions x where x.public_code = v_code);
  end loop;

  update promotions set public_code = v_code, updated_at = now()
   where id = p_id
   returning * into v_row;

  perform app.write_audit('promotion.generate_code', 'promotions', p_id::text,
                          v_before, to_jsonb(v_row));
  return v_code;
end $generate_promo_code_0177$;

comment on function app.generate_promo_code(uuid) is
  'Owner (the guard admits manager and owner; a manager is refused PRICE_VIA_PROTOCOL since price_promo, #57): draws an 8-character code from the unambiguous alphabet (PROMO_CODE_ALPHABET in @touch/core), unique across promotions, replacing any existing code (0067). PROMOTION_NOT_FOUND, CODE_GENERATION_FAILED. Audit promotion.generate_code.';

revoke all on function app.generate_promo_code(uuid) from public, anon;
grant execute on function app.generate_promo_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The court rate writer (§2.13, #57): the 0071:153 body without its guard,
--    and a wrapper that refuses every manager save, a new rule, an edit or a
--    switch-off, since each changes the price a slot gets (PROPOSAL: no draft
--    exception).
-- ---------------------------------------------------------------------------

-- app.upsert_rate_rule_internal — the 0071 body without its guard. An insert
-- takes rate_rules.venue_id from the app.current_venue() default, which the
-- calling RPC (or the apply) has set.
create or replace function app.upsert_rate_rule_internal(
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
language plpgsql security definer set search_path = public as $upsert_rate_rule_internal_0177$
declare
  v_before jsonb;
  v_row    rate_rules%rowtype;
  v_kv     record;
  v_dur    int;
  v_price  bigint;
begin
  if p_court_id is not null and not exists (select 1 from courts where id = p_court_id) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_days_of_week is null or cardinality(p_days_of_week) = 0
     or exists (select 1 from unnest(p_days_of_week) d where d < 0 or d > 6) then
    raise exception 'INVALID_DAYS' using errcode = 'P0001',
      hint = 'days_of_week: 0=Sun..6=Sat, at least one';
  end if;

  -- 0048 (H4): a midnight-crossing window is priced by SQL (price_slot wraps)
  -- and refused by @touch/core (rateRules.ts:79), so the guest sees one price
  -- and is charged another. One semantic, enforced at the source.
  if p_start_time is null or p_end_time is null or p_start_time >= p_end_time then
    raise exception 'INVALID_TIME_RANGE' using errcode = 'P0001',
      hint = 'start_time must be before end_time; split an overnight window into two rules';
  end if;

  if p_prices is null or jsonb_typeof(p_prices) <> 'object' or p_prices = '{}'::jsonb then
    raise exception 'INVALID_PRICES' using errcode = 'P0001',
      hint = 'prices: {"<duration_min>": <price_iqd>, ...}';
  end if;

  -- 0071 (SEC-10): validate the WHOLE price map before any write. A rule whose
  -- durations are half-written is worse than one that was refused — the admin
  -- UI replaces prices wholesale (the delete below), so a mid-loop failure
  -- would leave the rule priced for fewer durations than it had before.
  for v_kv in select key, value from jsonb_each_text(p_prices) loop
    if v_kv.key !~ '^[0-9]+$' or v_kv.value !~ '^[0-9]+$' then
      raise exception 'INVALID_PRICES' using errcode = 'P0001',
        detail = format('bad entry %s: %s', v_kv.key, v_kv.value);
    end if;
    v_dur   := v_kv.key::int;
    v_price := v_kv.value::bigint;
    if v_price <= 0 then
      raise exception 'INVALID_PRICES' using errcode = 'P0001',
        detail = format('duration %s', v_dur),
        hint = 'a price must be greater than zero; use is_active = false to retire a rule';
    end if;
    if v_dur < 15 or v_dur > 480 or v_dur % 5 <> 0 then
      raise exception 'INVALID_DURATION' using errcode = 'P0001',
        detail = format('duration %s', v_dur),
        hint = 'duration_min: 15 to 480 minutes, in steps of 5';
    end if;
  end loop;

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
    insert into rate_rule_prices (rule_id, duration_min, price_iqd)
    values (v_row.id, v_kv.key::int, v_kv.value::bigint);
  end loop;

  perform app.write_audit(
    case when v_before is null then 'rates.rule.create' else 'rates.rule.update' end,
    'rate_rules', v_row.id::text, v_before,
    to_jsonb(v_row) || jsonb_build_object('prices', p_prices));

  return v_row.id;
end $upsert_rate_rule_internal_0177$;

comment on function app.upsert_rate_rule_internal(text, int[], time, time, jsonb, uuid, uuid, int, date, date, boolean) is
  'price_promo (§2.13). Internal: the 0071 app.upsert_rate_rule body without its guard: creates or updates a court rate rule and replaces its per-duration prices wholesale (COURT_NOT_FOUND, INVALID_DAYS, INVALID_TIME_RANGE, INVALID_PRICES, INVALID_DURATION, RULE_NOT_FOUND). Audit rates.rule.create or rates.rule.update. Called by the public app.upsert_rate_rule and by the apply of a rate change.';

revoke all on function app.upsert_rate_rule_internal(text, int[], time, time, jsonb, uuid, uuid, int, date, date, boolean) from public, anon, authenticated;

-- app.upsert_rate_rule — the same signature, guard and grant.
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
language plpgsql security definer set search_path = public as $upsert_rate_rule_0177$
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if app.staff_role() = 'manager' then
    raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
  end if;

  return app.upsert_rate_rule_internal(p_name, p_days_of_week, p_start_time, p_end_time, p_prices,
                                       p_id, p_court_id, p_priority, p_valid_from, p_valid_to,
                                       p_is_active);
end $upsert_rate_rule_0177$;

comment on function app.upsert_rate_rule(text, int[], time, time, jsonb, uuid, uuid, int, date, date, boolean) is
  'Owner (the guard admits manager and owner; a manager is refused PRICE_VIA_PROTOCOL on every save since price_promo, #57: a court rate changes through a rate change): creates or updates a court rate rule and replaces its prices wholesale (0071; a wrapper over app.upsert_rate_rule_internal). COURT_NOT_FOUND, INVALID_DAYS, INVALID_TIME_RANGE, INVALID_PRICES, INVALID_DURATION, RULE_NOT_FOUND.';

revoke all on function app.upsert_rate_rule(text, int[], time, time, jsonb, uuid, uuid, int, date, date, boolean) from public, anon;
grant execute on function app.upsert_rate_rule(text, int[], time, time, jsonb, uuid, uuid, int, date, date, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The cafe setting writer (§2.13, #57): the featured-item discount lock.
--    Featured mode is what puts the stored percentage on the till and the
--    guest menu (add_order_items applies it only while hero_mode is
--    'featured', 0095:169), so three writes are locked for a manager: the
--    discount set to anything but 0, the featured item moved while a
--    discount is stored, and the hero switched to Featured while one is
--    stored. Setting the discount to 0 and moving the hero away from
--    Featured take it off sale and pass (PROPOSAL, plan §11 Q8). Every other
--    key is unchanged. set_cafe_settings applies keys in sorted order through
--    this function (featured_discount_pct < featured_item_id < hero_mode), so
--    one call that switches the discount off first passes.
-- ---------------------------------------------------------------------------

-- app.set_cafe_setting_internal — the 0029:280 body without its guard and
-- per-key role check: spec lookup (UNKNOWN_SETTING), validate, upsert, audit.
create or replace function app.set_cafe_setting_internal(
  p_key   text,
  p_value jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $set_cafe_setting_internal_0177$
declare
  v_spec   record;
  v_value  jsonb := coalesce(p_value, 'null'::jsonb);   -- SQL NULL from PostgREST == JSON null
  v_before jsonb;
  v_row    cafe_settings%rowtype;
begin
  select * into v_spec from app.cafe_setting_spec(p_key);
  if not found then
    raise exception 'UNKNOWN_SETTING' using errcode = 'P0001',
      detail = format('no such cafe setting: %s', coalesce(p_key, '<null>'));
  end if;

  perform app.validate_cafe_setting(v_spec.key, v_spec.jtype, v_value);

  select to_jsonb(cs) into v_before from cafe_settings cs where cs.key = v_spec.key for update;

  insert into cafe_settings (key, value, is_public, updated_at, updated_by)
  values (v_spec.key, v_value, v_spec.is_public, now(), auth.uid())
  on conflict (key) do update
     set value      = excluded.value,
         is_public  = excluded.is_public,     -- registry wins if a flag ever changes
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by
  returning * into v_row;

  perform app.write_audit('settings.cafe', 'cafe_settings', v_spec.key,
                          v_before, to_jsonb(v_row));

  return jsonb_build_object(
    'key',        v_row.key,
    'value',      v_row.value,
    'is_public',  v_row.is_public,
    'updated_at', v_row.updated_at
  );
end $set_cafe_setting_internal_0177$;

comment on function app.set_cafe_setting_internal(text, jsonb) is
  'price_promo (§2.13). Internal: the 0029 app.set_cafe_setting body without its guard and per-key role check: UNKNOWN_SETTING, validation (INVALID_SETTING_VALUE, ITEM_NOT_FOUND), upsert, audit settings.cafe; returns {key, value, is_public, updated_at}. Called by the public app.set_cafe_setting and by the apply of a featured_discount change.';

revoke all on function app.set_cafe_setting_internal(text, jsonb) from public, anon, authenticated;

-- app.set_cafe_setting — the same signature, guard and grant. Order: role
-- guard -> UNKNOWN_SETTING -> per-key role (FORBIDDEN) -> the manager's
-- featured-discount lock -> the internal.
create or replace function app.set_cafe_setting(
  p_key   text,
  p_value jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $set_cafe_setting_0177$
declare
  v_role  staff_role := app.staff_role();
  v_spec  record;
  v_value jsonb := coalesce(p_value, 'null'::jsonb);   -- SQL NULL from PostgREST == JSON null
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_spec from app.cafe_setting_spec(p_key);
  if not found then
    raise exception 'UNKNOWN_SETTING' using errcode = 'P0001',
      detail = format('no such cafe setting: %s', coalesce(p_key, '<null>'));
  end if;

  -- Owner passes everything; a manager may only write 'manager' keys.
  if v_spec.min_role = 'owner' and v_role <> 'owner' then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = format('%s is owner-only', p_key);
  end if;

  if v_role = 'manager' then
    if p_key = 'featured_discount_pct'
       and v_value is distinct from app.cafe_setting('featured_discount_pct')
       and v_value <> '0'::jsonb then
      raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
    if p_key = 'featured_item_id'
       and lower(v_value #>> '{}') is distinct from lower(app.cafe_setting_text('featured_item_id'))
       and coalesce(app.cafe_setting_int('featured_discount_pct'), 0) > 0 then
      raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
    if p_key = 'hero_mode'
       and v_value = '"featured"'::jsonb
       and app.cafe_setting_text('hero_mode') is distinct from 'featured'
       and coalesce(app.cafe_setting_int('featured_discount_pct'), 0) > 0 then
      raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
  end if;

  return app.set_cafe_setting_internal(p_key, p_value);
end $set_cafe_setting_0177$;

comment on function app.set_cafe_setting(text, jsonb) is
  'Manager or owner: writes one cafe setting (0029; a wrapper over app.set_cafe_setting_internal since price_promo): UNKNOWN_SETTING, FORBIDDEN on an owner key for a manager, then validation (INVALID_SETTING_VALUE, ITEM_NOT_FOUND); returns {key, value, is_public, updated_at}. For a manager (#57), PRICE_VIA_PROTOCOL on featured_discount_pct set to anything but 0 (when it changes), on featured_item_id moved while a discount is stored, and on hero_mode switched to featured while a discount is stored: the featured-item discount changes through a featured_discount change. Reached by app.set_cafe_settings per key.';

revoke all on function app.set_cafe_setting(text, jsonb) from public, anon;
grant execute on function app.set_cafe_setting(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The target check (§2.13). What the owner approved must still be what
--    the apply writes: the proposal names the targets, the numbers the
--    figures, and anything written since (by anyone, a manager's switch-off
--    included) makes the change stale. Run by the apply check hook, the apply
--    itself, and so the cron. Internal.
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_check_targets(p_run_id uuid)
returns void
language plpgsql stable security definer set search_path = public as $price_promo_check_targets_0177$
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
end $price_promo_check_targets_0177$;

comment on function app.price_promo_check_targets(uuid) is
  'price_promo (§2.13). Internal: raises PRICE_TARGET_CHANGED (hint item, size:<variant_id>, sizes, addon:<modifier_id>, promotion, rule or featured) when what the passed proposal and numbers approved no longer matches: a target gone; a price item no longer launched or put in release; a shop_launch product switched on, launched, put in release, or with sizes other than the approved ones; a promotion written since the proposal (updated_at against base_updated_at), already on for a switch-on, or its code taken; an edited rule or its prices changed since (against before), or the rule''s court gone; the featured item, discount or hero mode changed since (against before), or the item to feature switched off. Called by the apply check hook and app.price_promo_apply_internal.';

revoke all on function app.price_promo_check_targets(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The apply (§2.13). Internal: the pass hook (a manager's apply now) and
--    the cron (a date that has come) call it. The target check first, then
--    the approved figures (the numbers step's, else the proposal's), each
--    through an internal body: the manager may not use the public paths on
--    anything launched, and the cron has no session. The run is done.
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_apply_internal(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $price_promo_apply_internal_0177$
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
    -- The product goes on sale: the internal stamps launched_at.
    if v_change = 'shop_launch' then
      perform app.upsert_menu_item_internal(v_item.category_id, v_item.name_en, v_item.name_ar, v_item.id,
                                            v_item.description_en, v_item.description_ar, v_item.sort_order,
                                            true, v_item.hook_en, v_item.hook_ar, v_item.highlight,
                                            v_item.serve_temp);
    end if;
    v_counts := jsonb_build_object('sizes', v_a, 'new_sizes', v_b);

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
    v_counts := jsonb_build_object('addons', v_a, 'launched', v_b);

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
end $price_promo_apply_internal_0177$;

comment on function app.price_promo_apply_internal(uuid) is
  'price_promo (§2.13). Internal: applies an active (pass hook) or scheduled (cron) price or promotion change: app.venue_id set to the run''s venue, app.price_promo_check_targets, then the approved figures (numbers, else the proposal''s) through the internals: price (sizes, new sizes after the last), shop_launch (sizes, then the product switched on and stamped launched), addon_price (a never-launched add-on switched on and stamped, a launched one keeps its switch), promotion (the draft updated, then switched on), promotion_edit (the approved fields and value, the switch kept), promotion_enable, rate (the rule and its prices), featured_discount (the item when it moves, the discount, then Featured mode when the discount is above 0). The three promotion kinds then name the owner who approved the numbers as the promotion''s created_by, which apply_best_promotion records as every redemption''s authorized_by (0067). The run is done. Audit protocol.price.apply or protocol.promo.apply {run_id, change, counts, authorized_by (promotion kinds)}; returns the same.';

revoke all on function app.price_promo_apply_internal(uuid) from public, anon, authenticated;

-- The cron (tp_price_promo_apply): every scheduled change whose date has
-- come, one at a time in its own block, so one bad run never fails the
-- statement. A change that cannot apply (its target changed, most often) goes
-- back to active with its apply step reopened in a new round, and the venue's
-- managers are told (staff_task / apply_not_ready), the shape of a reverted
-- launch.
create or replace function app.price_promo_apply_due()
returns jsonb
language plpgsql security definer set search_path = public as $price_promo_apply_due_0177$
declare
  v_id       uuid;
  v_run      protocol_runs%rowtype;
  v_step     protocol_run_steps%rowtype;
  v_code     text;
  v_hint     text;
  v_applied  int := 0;
  v_reverted int := 0;
begin
  for v_id in
    select r.id
      from protocol_runs r
     where r.kind = 'price_promo' and r.status = 'scheduled' and r.scheduled_for <= now()
     order by r.scheduled_for, r.id
  loop
    begin
      -- Under the lock: a date cancelled since the list was read is skipped.
      select * into v_run from protocol_runs where id = v_id for update;
      continue when v_run.status <> 'scheduled' or v_run.scheduled_for > now();
      perform app.price_promo_apply_internal(v_id);
      v_applied := v_applied + 1;
    exception when others then
      get stacked diagnostics v_code = message_text, v_hint = pg_exception_hint;
      begin
        select * into v_run from protocol_runs where id = v_id for update;
        select * into v_step from protocol_run_steps s where s.run_id = v_id and s.step_key = 'apply' for update;
        if v_run.status = 'scheduled' and app.protocol_step_allowed(v_step.status, 'open') then
          perform set_config('app.venue_id', v_run.venue_id::text, true);
          update protocol_runs set status = 'active', scheduled_for = null where id = v_run.id;
          update protocol_run_steps
             set status = 'open', round = round + 1, opened_at = now(), passed_at = null
           where id = v_step.id;
          perform app.protocol_engine_notify(app.staff_ids_with_roles(v_run.venue_id, '{manager}'),
                                             'staff_task', 'apply_not_ready', 'staff-step',
                                             v_step.id, v_run.id, v_step.id);
          -- Codes and ids only: an unexpected error's text is not kept.
          perform app.write_audit('protocol.unschedule', 'protocol_run', v_run.id::text,
            jsonb_build_object('status', 'scheduled'),
            jsonb_build_object('status', 'active', 'run_step_id', v_step.id,
                               'not_applied', case when v_code ~ '^[A-Z][A-Z_]*$' then v_code else 'ERROR' end,
                               'hint', case when v_code ~ '^[A-Z][A-Z_]*$' then v_hint end));
          v_reverted := v_reverted + 1;
        end if;
      exception when others then
        raise warning 'price_promo_apply_due: run % could not be put back (%)', v_id, sqlerrm;
      end;
    end;
  end loop;
  return jsonb_build_object('applied', v_applied, 'reverted', v_reverted);
end $price_promo_apply_due_0177$;

comment on function app.price_promo_apply_due() is
  'price_promo (§2.13, §2.19). Internal, cron tp_price_promo_apply (as the database owner, no staff session): applies each scheduled price_promo run whose date has come through app.price_promo_apply_internal, one at a time in its own block. A run that fails goes back to active, its apply step reopens in a new round, the venue''s managers are told (staff_task / apply_not_ready) and audit protocol.unschedule records the code. Returns {applied, reverted}.';

revoke all on function app.price_promo_apply_due() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. The price_promo hooks (§2.7, §2.8, §2.13). Internal, called by the
--    engine in the caller's transaction with the caller's auth.uid(); the
--    engine has set app.venue_id to the run's venue.
-- ---------------------------------------------------------------------------

-- The kind is ready; data is {}.
create or replace function app.protocol_start_price_promo(p_run_id uuid, p_data jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_start_price_promo_0177$
begin
  if p_data is not null and p_data <> '{}'::jsonb then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'data';
  end if;
  return '{}'::jsonb;
end $protocol_start_price_promo_0177$;

comment on function app.protocol_start_price_promo(uuid, jsonb) is
  'price_promo (§2.7). Internal start hook: marks price_promo ready; takes data {} (RECORD_INVALID hint data otherwise) and keeps nothing.';

revoke all on function app.protocol_start_price_promo(uuid, jsonb) from public, anon, authenticated;

-- propose: one of the eight changes, each with its reason and expected
-- effect, and its target in the state the change needs (§2.8). A target in
-- the wrong state is RECORD_INVALID with the field as hint, never a menu,
-- promotion or rate writer's code: marketing reaches this on the phone. A
-- resubmission keeps the run's change and target. base_updated_at and
-- before are written here (a copy the client sends back is replaced).
create or replace function app.protocol_check_price_promo_propose(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_price_promo_propose_0177$
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
    perform app.price_promo_only_keys(p_record, c_common || array['menu_item_id', 'prices', 'new_sizes'], null);
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
    -- A shop size carries its own stock item, SKU and barcode: a new pack
    -- size is a new hidden product, or the owner's.
    if jsonb_array_length(v_new) > 0 and v_kind = 'shop' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'new_sizes';
    end if;
    if jsonb_array_length(v_prices) + jsonb_array_length(v_new) = 0 then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'prices';
    end if;
    v_out := v_out || jsonb_build_object('menu_item_id', v_id, 'prices', v_prices)
                   || case when jsonb_array_length(v_new) > 0
                           then jsonb_build_object('new_sizes', v_new) else '{}'::jsonb end;

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
    perform app.price_promo_only_keys(p_record, c_common || array['addons'], null);
    v_out := v_out || jsonb_build_object('addons', app.price_promo_addons(p_record->'addons', v_run.venue_id));

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
end $protocol_check_price_promo_propose_0177$;

comment on function app.protocol_check_price_promo_propose(uuid, jsonb, text[]) is
  'price_promo (§2.8, §2.13). Internal check hook: one of the eight changes with reason and expected_effect (<= 2000): price {menu_item_id (launched, not in release, at the run''s venue), prices (0-12 of its sizes), new_sizes? (0-4, a cafe item only)}, shop_launch {menu_item_id (a never-launched hidden shop product, not in release), prices (exactly its sizes)} (MGMT only: NOT_STEP_ACTOR hint change for marketing), addon_price {addons (1-30 at the venue)}, promotion {promotion}, promotion_edit {promotion_id, promotion}, promotion_enable {promotion_id (off)}, rate {rule_id?, rule}, featured_discount {menu_item_id (active, at the venue), discount_pct 0-99, a change}. Adds base_updated_at (promotion edit or switch-on) and before (rate edit, featured discount). A resubmission keeps change and target (hint change). RECORD_INVALID and TEXT_TOO_LONG with the field as hint, never a writer''s code.';

revoke all on function app.protocol_check_price_promo_propose(uuid, jsonb, text[]) from public, anon, authenticated;

-- propose is sent, on every round: price and shop_launch keep their item on
-- the run; a new promotion is saved as a disabled draft the first time and
-- updated in place after, and kept on the run (the apply switches it on);
-- promotion_edit and promotion_enable keep their promotion on the run and
-- write nothing to it; the others keep their targets in the record.
create or replace function app.protocol_submit_price_promo_propose(p_submission_id uuid)
returns void
language plpgsql security definer set search_path = public as $protocol_submit_price_promo_propose_0177$
declare
  v_rec jsonb;
  v_run protocol_runs%rowtype;
  v_f   jsonb;
  v_id  uuid;
begin
  select x.record into v_rec from protocol_submissions x where x.id = p_submission_id;
  select r.* into v_run
    from protocol_runs r
    join protocol_submissions x on x.run_id = r.id
   where x.id = p_submission_id;

  if v_rec->>'change' in ('price', 'shop_launch') then
    update protocol_runs set menu_item_id = (v_rec->>'menu_item_id')::uuid
     where id = v_run.id and menu_item_id is distinct from (v_rec->>'menu_item_id')::uuid;

  elsif v_rec->>'change' = 'promotion' then
    v_f := v_rec->'promotion';
    v_id := app.upsert_promotion_internal(
      v_run.promotion_id,
      v_f->>'name_en', v_f->>'name_ar', v_f->>'type', (v_f->>'value')::int,
      (v_f->>'starts_at')::timestamptz, (v_f->>'ends_at')::timestamptz,
      array(select jsonb_array_elements_text(v_f->'weekdays')::int),
      (v_f->>'hour_from')::time, (v_f->>'hour_to')::time,
      v_f->'scope', v_f->'limits', (v_f->>'auto')::boolean,
      coalesce(v_f->>'public_code', ''), (v_f->>'code_single_use')::boolean,
      false);
    update protocol_runs set promotion_id = v_id
     where id = v_run.id and promotion_id is distinct from v_id;

  elsif v_rec->>'change' in ('promotion_edit', 'promotion_enable') then
    update protocol_runs set promotion_id = (v_rec->>'promotion_id')::uuid
     where id = v_run.id and promotion_id is distinct from (v_rec->>'promotion_id')::uuid;
  end if;
end $protocol_submit_price_promo_propose_0177$;

comment on function app.protocol_submit_price_promo_propose(uuid) is
  'price_promo (§2.13). Internal submit hook, every round: price and shop_launch store the run''s menu_item_id; promotion saves its promotion disabled through app.upsert_promotion_internal (created the first time, updated after) and stores the run''s promotion_id; promotion_edit and promotion_enable store the run''s promotion_id and write nothing to the promotion; addon_price, rate and featured_discount keep their targets in the record.';

revoke all on function app.protocol_submit_price_promo_propose(uuid) from public, anon, authenticated;

-- numbers: the manager's recommendation and the final figures, each for
-- exactly the proposal's targets and in its shapes; a figure left out stays
-- the proposal's. The owner approves or sends back, never edits (Q12).
create or replace function app.protocol_check_price_promo_numbers(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_price_promo_numbers_0177$
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

  return v_out;
end $protocol_check_price_promo_numbers_0177$;

comment on function app.protocol_check_price_promo_numbers(uuid, jsonb, text[]) is
  'price_promo (§2.8). Internal check hook: numbers {recommendation go|change|drop, note? (<= 2000), and the final figures for exactly the passed proposal''s targets, each optional (left out = the proposal''s): prices (the same sizes), new_sizes (the same count, the proposal''s names), addons (the same add-ons), promotion_value (by its type), rule_prices (the same durations), discount_pct (0-99)}. A figure the change does not take, or targets other than the proposal''s, is RECORD_INVALID with the field as hint.';

revoke all on function app.protocol_check_price_promo_numbers(uuid, jsonb, text[]) from public, anon, authenticated;

-- announce: marketing's highlights for the change; nothing is published.
create or replace function app.protocol_check_price_promo_announce(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_price_promo_announce_0177$
declare
  v_venue    uuid;
  v_campaign uuid;
begin
  select r.venue_id into v_venue
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  perform app.price_promo_only_keys(p_record, array['campaign_id', 'hero', 'ticker', 'notes'], null);

  v_campaign := app.price_promo_uuid(p_record->'campaign_id', false, 'campaign_id');
  if v_campaign is not null
     and not exists (select 1 from marketing_campaigns c where c.id = v_campaign and c.venue_id = v_venue) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'campaign_id';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'campaign_id', v_campaign,
    'hero',        app.price_promo_line(p_record->'hero', 80, 'hero'),
    'ticker',      app.price_promo_line(p_record->'ticker', 120, 'ticker'),
    'notes',       app.price_promo_text(p_record->'notes', 2000, false, 'notes')));
end $protocol_check_price_promo_announce_0177$;

comment on function app.protocol_check_price_promo_announce(uuid, jsonb, text[]) is
  'price_promo (§2.8). Internal check hook: announce {campaign_id? (a campaign at the run''s venue), hero?: {en, ar} (<= 80), ticker?: {en, ar} (<= 120), notes? (<= 2000)}. Nothing is published. RECORD_INVALID and TEXT_TOO_LONG with the field as hint.';

revoke all on function app.protocol_check_price_promo_announce(uuid, jsonb, text[]) from public, anon, authenticated;

-- apply: now or on a date ahead, and the targets still what was approved
-- (PRICE_TARGET_CHANGED), for both.
create or replace function app.protocol_check_price_promo_apply(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_price_promo_apply_0177$
declare
  v_run_id uuid;
  v_when   text;
  v_at     timestamptz;
begin
  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  perform app.price_promo_only_keys(p_record, array['when', 'at'], null);

  v_when := app.price_promo_text(p_record->'when', 8, true, 'when');
  if v_when not in ('now', 'date') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'when';
  end if;
  if v_when = 'date' then
    v_at := app.price_promo_instant(p_record->'at', true, 'at');
    if v_at <= now() then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'at';
    end if;
  elsif p_record->'at' is not null and p_record->'at' <> 'null'::jsonb then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'at';
  end if;

  perform app.price_promo_check_targets(v_run_id);

  return jsonb_strip_nulls(jsonb_build_object('when', v_when, 'at', v_at));
end $protocol_check_price_promo_apply_0177$;

comment on function app.protocol_check_price_promo_apply(uuid, jsonb, text[]) is
  'price_promo (§2.8, §2.13). Internal check hook: apply {when now|date, at? (a date: ahead; now: absent)}, then app.price_promo_check_targets (PRICE_TARGET_CHANGED) for both. RECORD_INVALID with the field as hint.';

revoke all on function app.protocol_check_price_promo_apply(uuid, jsonb, text[]) from public, anon, authenticated;

-- apply passes (a manager's apply passes at once): now writes the change in
-- this transaction; a date schedules the run (the finish hook says
-- scheduled, and tp_price_promo_apply applies it when the date comes).
create or replace function app.protocol_pass_price_promo_apply(p_run_step_id uuid, p_submission_id uuid, p_decision_data jsonb)
returns void
language plpgsql security definer set search_path = public as $protocol_pass_price_promo_apply_0177$
declare
  v_run_id uuid;
  v_rec    jsonb;
begin
  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  select x.record into v_rec from protocol_submissions x where x.id = p_submission_id;
  if v_rec->>'when' = 'now' then
    perform app.price_promo_apply_internal(v_run_id);
  else
    update protocol_runs set scheduled_for = (v_rec->>'at')::timestamptz where id = v_run_id;
  end if;
end $protocol_pass_price_promo_apply_0177$;

comment on function app.protocol_pass_price_promo_apply(uuid, uuid, jsonb) is
  'price_promo (§2.13). Internal pass hook: when now, app.price_promo_apply_internal (the change is written and the run done); when a date, scheduled_for = at (the finish hook then schedules the run).';

revoke all on function app.protocol_pass_price_promo_apply(uuid, uuid, jsonb) from public, anon, authenticated;

-- The terminal step passed: done after an apply now, scheduled for a date.
create or replace function app.protocol_finish_price_promo(p_run_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $protocol_finish_price_promo_0177$
begin
  return case app.price_promo_record(p_run_id, 'apply')->>'when'
           when 'now' then 'done' when 'date' then 'scheduled' end;
end $protocol_finish_price_promo_0177$;

comment on function app.protocol_finish_price_promo(uuid) is
  'price_promo (§2.13). Internal finish hook: done after an apply now, scheduled for an apply on a date (read from the passed apply record); NULL otherwise, which the engine refuses.';

revoke all on function app.protocol_finish_price_promo(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. The reads (§2.13). price_promo_targets feeds the start form: list
--     prices, rules and discounts only, which staff (and mostly guests)
--     already see; no cost, no sales. price_promo_numbers feeds the numbers
--     step and its decision: cost, margin and the last 30 days' sales, MGMT
--     only.
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_targets(p_change text, p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_targets_0177$
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
                                          'promotion_enable', 'rate', 'featured_discount') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'change';
  end if;
  v_mgmt := app.is_staff_at(v_venue, 'manager', 'owner');
  -- Hidden products are not offered to marketing (§2.8).
  if p_change = 'shop_launch' and not v_mgmt then
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
end $price_promo_targets_0177$;

comment on function app.price_promo_targets(text, uuid) is
  'price_promo (§2.13). Manager, marketing or owner at the venue (shop_launch: MGMT only): the targets a price or promotion change may name. price: {items: [{menu_item_id, name_en, name_ar, category_kind, is_active, sizes: [{variant_id, name_en, name_ar, price_iqd}]}]}, launched items not in release, cafe and shop; shop_launch: the same shape, hidden never-launched shop products not in release; addon_price: {addons: [{modifier_id, group_id, group_name_en, group_name_ar, name_en, name_ar, price_delta_iqd, is_active, launched}]}, launched add-ons plus, for MGMT, hidden never-launched ones; promotion_edit / promotion_enable: {promotions: [...]} (every promotion / the switched-off ones), no redemption count; rate: {rules: [{rule_id, name, court_id, court_name_en, court_name_ar, days_of_week, start_time, end_time, priority, valid_from, valid_to, is_active, prices}]}; featured_discount: {featured_item_id, featured_discount_pct, hero_mode, items: [...]}, active items. No cost, no sales. FORBIDDEN, INVALID_ARGUMENT (hint change).';

revoke all on function app.price_promo_targets(text, uuid) from public, anon;
grant execute on function app.price_promo_targets(text, uuid) to authenticated;

create or replace function app.price_promo_numbers(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_numbers_0177$
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
    'promotion', v_promo,
    'rate',      v_rate,
    'featured',  v_feat);
end $price_promo_numbers_0177$;

comment on function app.price_promo_numbers(uuid) is
  'price_promo (§2.13). MGMT at the run''s venue: the figures behind a price or promotion change, from its standing proposal and numbers (a figure the numbers leave out is the proposal''s): {change, sizes: [{variant_id (null for a new size), name_en, name_ar, current_price_iqd, new_price_iqd, cost_iqd, cost_known, margin_before_iqd, margin_after_iqd, units_30d, revenue_30d_iqd}], addons: [{modifier_id, group_name_en, group_name_ar, name_en, name_ar, current_delta_iqd, new_delta_iqd, count_30d, revenue_30d_iqd}], promotion: {current_value, new_value, discount_cost_30d_iqd, units_30d, revenue_30d_iqd} | null, rate: {durations: [{duration_min, current_price_iqd, new_price_iqd}], bookings_30d, revenue_30d_iqd} | null, featured: {current_item_id, new_item_id, current_pct, new_pct, current_hero_mode, sizes, units_30d, discount_cost_30d_iqd} | null}. Cost is the recipe cost (latest batch, else pack cost; unknown when a line has neither); sales are the last 30 days'' settled lines. PROTOCOL_NOT_FOUND.';

revoke all on function app.price_promo_numbers(uuid) from public, anon;
grant execute on function app.price_promo_numbers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The apply job (§2.19), in its own guarded block (0021 shape;
--     cron.schedule upserts by name).
-- ---------------------------------------------------------------------------
do $price_promo_cron_0177$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - price/promo apply skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_price_promo_apply not scheduled';
    return;
  end if;

  perform cron.schedule('tp_price_promo_apply', '*/5 * * * *', 'select app.price_promo_apply_due();');
end $price_promo_cron_0177$;
