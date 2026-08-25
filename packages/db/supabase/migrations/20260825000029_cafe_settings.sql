-- 0029_cafe_settings — key/value cafe settings with a migration-owned spec
-- registry (typed validation + per-key write role), a definer view for the
-- public subset, the manager|owner write RPC, and internal typed accessors
-- used by later migrations (0030 pricing, 0032 telegram, 0034 analytics) and
-- by edge functions through the service role.
--
-- Posture (db-slice.md "Settings"):
--   * base table `cafe_settings` is manager|owner READ only (RLS), no client
--     writes — every write goes through app.set_cafe_setting.
--   * `cafe_settings_public` (security_invoker = off, like venue_settings_public
--     in 0006) exposes ONLY rows with is_public = true to anon + authenticated.
--     telegram_* / analytics_* keys are is_public = false and therefore never
--     reach guests or the till.
--   * the registry app.cafe_setting_specs() is the single source of truth for
--     keys, public flag, shape (`jtype`), minimum write role and default value.
--     Adding a key later = a new migration that CREATE OR REPLACEs the registry
--     and re-runs the seed insert (on conflict do nothing).
--   * hero_media_path is validated with an inline regex (same shape as the
--     0027 app.is_media_path rule, restricted to the `hero/` prefix) so this
--     migration does not depend on a sibling's function.
--   * telegram_last_callback_at is stamped by the telegram-callback edge
--     function with the service role (direct table write; 0012 grants) and may
--     also be written by the owner through the RPC.
--
-- Additive only: new table, new view, new app.* functions. No enum changes.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table cafe_settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references staff(id)         -- staff.id = auth.users.id (0004)
);

comment on table cafe_settings is
  'Cafe key/value settings. Keys, shapes, defaults and write roles live in app.cafe_setting_specs(); writes only via app.set_cafe_setting. is_public rows are mirrored to anon/guests through the cafe_settings_public view; private rows (telegram_*, analytics_*) are manager|owner read only.';

alter table cafe_settings enable row level security;

grant select on cafe_settings to authenticated;
create policy cafe_settings_staff_read on cafe_settings for select to authenticated
  using (app.is_staff('manager','owner'));
-- No INSERT/UPDATE/DELETE grants or policies: RPC-only (service_role keeps
-- full access via the 0012 default privileges).

-- ---------------------------------------------------------------------------
-- Public view — the ONLY cafe_settings surface anon / guests may read.
-- Definer-style (security_invoker off): owner read bypasses base-table RLS,
-- the WHERE clause is the privacy boundary.
-- ---------------------------------------------------------------------------
create view cafe_settings_public with (security_invoker = off) as
select key, value
  from cafe_settings
 where is_public;

grant select on cafe_settings_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Spec registry. `jtype` is a small shape grammar parsed by
-- app.validate_cafe_setting:
--   enum(a|b|c)          JSON string, one of the listed values
--   media_path(prefix)   JSON null, or a storage path under '<prefix>/'
--   active_item_id       JSON null, or the uuid of an ACTIVE menu_items row
--   text(max)            JSON string, length <= max
--   int(lo,hi)           JSON integer number in [lo, hi]
--   text_array(n,max)    JSON array of <= n strings, each length <= max
--   bool                 JSON boolean
--   chat_id              JSON null, or a Telegram chat id string ^-?[0-9]{5,20}$
--   timestamp            JSON null, or an ISO-8601 timestamp string
--   uuid_array           JSON array of uuid strings
--   date                 JSON null, or a 'YYYY-MM-DD' string
-- min_role: 'manager' = manager|owner may write; 'owner' = owner only.
-- ---------------------------------------------------------------------------
create or replace function app.cafe_setting_specs()
returns table (key text, is_public boolean, jtype text, min_role staff_role, default_value jsonb)
language sql stable security definer set search_path = public as $cafe_specs$
  select v.key, v.is_public, v.jtype, v.min_role, v.default_value
    from (values
      -- public + manager|owner (guest-visible content)
      ('hero_mode',                         true,  'enum(none|media|featured)', 'manager'::staff_role, '"none"'::jsonb),
      ('hero_media_path',                   true,  'media_path(hero)',          'manager'::staff_role, 'null'::jsonb),
      ('hero_media_kind',                   true,  'enum(image|video)',         'manager'::staff_role, '"image"'::jsonb),
      ('featured_item_id',                  true,  'active_item_id',            'manager'::staff_role, 'null'::jsonb),
      ('featured_label_en',                 true,  'text(200)',                 'manager'::staff_role, '""'::jsonb),
      ('featured_label_ar',                 true,  'text(200)',                 'manager'::staff_role, '""'::jsonb),
      ('featured_badge_en',                 true,  'text(60)',                  'manager'::staff_role, '""'::jsonb),
      ('featured_badge_ar',                 true,  'text(60)',                  'manager'::staff_role, '""'::jsonb),
      ('featured_discount_pct',             true,  'int(0,99)',                 'manager'::staff_role, '0'::jsonb),
      ('ticker_en',                         true,  'text_array(12,120)',        'manager'::staff_role, '[]'::jsonb),
      ('ticker_ar',                         true,  'text_array(12,120)',        'manager'::staff_role, '[]'::jsonb),
      ('bell_tutorial_enabled',             true,  'bool',                      'manager'::staff_role, 'true'::jsonb),
      -- private + owner (operational / secrets-adjacent)
      ('telegram_enabled',                  false, 'bool',                      'owner'::staff_role,   'false'::jsonb),
      ('telegram_chat_id',                  false, 'chat_id',                   'owner'::staff_role,   'null'::jsonb),
      ('telegram_lang',                     false, 'enum(ar|en)',               'owner'::staff_role,   '"ar"'::jsonb),
      ('telegram_last_callback_at',         false, 'timestamp',                 'owner'::staff_role,   'null'::jsonb),
      ('analytics_business_day_start_hour', false, 'int(0,12)',                 'owner'::staff_role,   '4'::jsonb),
      ('analytics_excluded_item_ids',       false, 'uuid_array',                'owner'::staff_role,   '[]'::jsonb),
      ('analytics_engagement_floor',        false, 'date',                      'owner'::staff_role,   'null'::jsonb)
    ) as v(key, is_public, jtype, min_role, default_value)
$cafe_specs$;

create or replace function app.cafe_setting_spec(p_key text)
returns table (key text, is_public boolean, jtype text, min_role staff_role, default_value jsonb)
language sql stable security definer set search_path = public as $cafe_spec$
  select s.key, s.is_public, s.jtype, s.min_role, s.default_value
    from app.cafe_setting_specs() s
   where s.key = p_key
$cafe_spec$;

-- ---------------------------------------------------------------------------
-- app.validate_cafe_setting — shape check against the registry grammar.
-- Raises INVALID_SETTING_VALUE (detail = reason) or ITEM_NOT_FOUND
-- (featured_item_id pointing at a missing / inactive item). Internal.
-- ---------------------------------------------------------------------------
create or replace function app.validate_cafe_setting(
  p_key   text,
  p_jtype text,
  p_value jsonb
) returns void
language plpgsql stable security definer set search_path = public as $cafe_validate$
declare
  v_base  text := split_part(p_jtype, '(', 1);
  v_args  text[];
  v_text  text;
  v_elem  jsonb;
  v_i     int;
  v_regex text;
begin
  if p_value is null then
    raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
      detail = format('%s: value is required', p_key);
  end if;

  -- JSON null: only the nullable shapes accept it.
  if jsonb_typeof(p_value) = 'null' then
    if v_base in ('media_path', 'active_item_id', 'chat_id', 'timestamp', 'date') then
      return;
    end if;
    raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
      detail = format('%s: null is not allowed (expected %s)', p_key, p_jtype);
  end if;

  case v_base
    when 'enum' then
      v_args := string_to_array((regexp_match(p_jtype, '^enum\((.*)\)$'))[1], '|');
      if jsonb_typeof(p_value) <> 'string' or not ((p_value #>> '{}') = any (v_args)) then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected one of %s', p_key, array_to_string(v_args, ', '));
      end if;

    when 'media_path' then
      v_args  := regexp_match(p_jtype, '^media_path\(([a-z]+)\)$');
      v_regex := '^' || v_args[1] || '/[A-Za-z0-9][A-Za-z0-9/_.-]{0,180}\.(webp|jpe?g|png|mp4|webm)$';
      -- Same rule as 0027 app.is_media_path (char class + no '//'), prefix-pinned.
      if jsonb_typeof(p_value) <> 'string'
         or not ((p_value #>> '{}') ~ v_regex)
         or (p_value #>> '{}') ~ '//' then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected null or a media path under %s/ (webp|jpg|jpeg|png|mp4|webm)', p_key, v_args[1]);
      end if;

    when 'active_item_id' then
      v_text := p_value #>> '{}';
      if jsonb_typeof(p_value) <> 'string'
         or v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected null or a uuid string', p_key);
      end if;
      if not exists (select 1 from menu_items where id = v_text::uuid and is_active) then
        raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001',
          detail = format('%s: no active menu item %s', p_key, v_text);
      end if;

    when 'text' then
      v_args := regexp_match(p_jtype, '^text\(([0-9]+)\)$');
      if jsonb_typeof(p_value) <> 'string' or length(p_value #>> '{}') > v_args[1]::int then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected a string of at most %s characters', p_key, v_args[1]);
      end if;

    when 'int' then
      v_args := regexp_match(p_jtype, '^int\((-?[0-9]+),(-?[0-9]+)\)$');
      v_text := p_value #>> '{}';
      -- Two steps on purpose: SQL `or` is not short-circuit, so the cast must
      -- only run once the integer regex has passed (else 4.5 -> 22P02, not our code).
      if jsonb_typeof(p_value) <> 'number' or v_text !~ '^-?[0-9]+$' then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected an integer between %s and %s', p_key, v_args[1], v_args[2]);
      end if;
      if v_text::numeric < v_args[1]::numeric or v_text::numeric > v_args[2]::numeric then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected an integer between %s and %s', p_key, v_args[1], v_args[2]);
      end if;

    when 'text_array' then
      v_args := regexp_match(p_jtype, '^text_array\(([0-9]+),([0-9]+)\)$');
      if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > v_args[1]::int then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected an array of at most %s strings', p_key, v_args[1]);
      end if;
      v_i := 0;
      for v_elem in select e from jsonb_array_elements(p_value) e loop
        if jsonb_typeof(v_elem) <> 'string' or length(v_elem #>> '{}') > v_args[2]::int then
          raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
            detail = format('%s[%s]: expected a string of at most %s characters', p_key, v_i, v_args[2]);
        end if;
        v_i := v_i + 1;
      end loop;

    when 'bool' then
      if jsonb_typeof(p_value) <> 'boolean' then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected true or false', p_key);
      end if;

    when 'chat_id' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^-?[0-9]{5,20}$' then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected null or a Telegram chat id (5-20 digits, optional leading minus)', p_key);
      end if;

    when 'timestamp' then
      v_text := p_value #>> '{}';
      if jsonb_typeof(p_value) <> 'string' or v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected null or an ISO-8601 timestamp string', p_key);
      end if;
      begin
        perform v_text::timestamptz;
      exception when others then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected null or an ISO-8601 timestamp string', p_key);
      end;

    when 'uuid_array' then
      if jsonb_typeof(p_value) <> 'array' then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected an array of uuid strings', p_key);
      end if;
      v_i := 0;
      for v_elem in select e from jsonb_array_elements(p_value) e loop
        if jsonb_typeof(v_elem) <> 'string'
           or (v_elem #>> '{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
          raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
            detail = format('%s[%s]: expected a uuid string', p_key, v_i);
        end if;
        v_i := v_i + 1;
      end loop;

    when 'date' then
      v_text := p_value #>> '{}';
      if jsonb_typeof(p_value) <> 'string' or v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected null or a YYYY-MM-DD date string', p_key);
      end if;
      begin
        perform v_text::date;
      exception when others then
        raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
          detail = format('%s: expected null or a YYYY-MM-DD date string', p_key);
      end;

    else
      -- Registry bug, not a caller error: surface it loudly.
      raise exception 'INVALID_SETTING_VALUE' using errcode = 'P0001',
        detail = format('%s: unknown spec shape %s', p_key, p_jtype);
  end case;
end $cafe_validate$;

-- ---------------------------------------------------------------------------
-- app.set_cafe_setting — the single client write path (manager|owner).
-- Order: role guard -> UNKNOWN_SETTING -> per-key role (FORBIDDEN) ->
-- shape (INVALID_SETTING_VALUE / ITEM_NOT_FOUND) -> upsert -> audit.
-- Returns the stored row as {key, value, is_public, updated_at}.
-- ---------------------------------------------------------------------------
create or replace function app.set_cafe_setting(
  p_key   text,
  p_value jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $cafe_set$
declare
  v_role   staff_role := app.staff_role();
  v_spec   record;
  v_value  jsonb := coalesce(p_value, 'null'::jsonb);   -- SQL NULL from PostgREST == JSON null
  v_before jsonb;
  v_row    cafe_settings%rowtype;
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
end $cafe_set$;

-- ---------------------------------------------------------------------------
-- Internal typed accessors: stored value, else the registry default.
-- Definer, no client grants — consumed by later app.* functions (0030/0032/
-- 0034) and by edge functions through the service role.
-- ---------------------------------------------------------------------------
create or replace function app.cafe_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $cafe_get$
  select coalesce(
    (select cs.value from cafe_settings cs where cs.key = p_key),
    (select s.default_value from app.cafe_setting_spec(p_key) s)
  )
$cafe_get$;

-- Text: JSON null -> SQL NULL (#>> on a json null yields NULL); strings
-- unwrapped without quotes; arrays/objects come back as their JSON text.
create or replace function app.cafe_setting_text(p_key text) returns text
language sql stable security definer set search_path = public as $cafe_get_text$
  select app.cafe_setting(p_key) #>> '{}'
$cafe_get_text$;

create or replace function app.cafe_setting_int(p_key text) returns int
language sql stable security definer set search_path = public as $cafe_get_int$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric::int end
    from app.cafe_setting(p_key) as v
$cafe_get_int$;

create or replace function app.cafe_setting_bool(p_key text) returns boolean
language sql stable security definer set search_path = public as $cafe_get_bool$
  select case when jsonb_typeof(v) = 'boolean' then (v #>> '{}')::boolean end
    from app.cafe_setting(p_key) as v
$cafe_get_bool$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
-- Client-callable write RPC (role guard is the first statement).
revoke all on function app.set_cafe_setting(text, jsonb) from public, anon;
grant execute on function app.set_cafe_setting(text, jsonb) to authenticated;

-- Internal: registry, validator, typed accessors. Service role only.
revoke all on function app.cafe_setting_specs() from public, anon, authenticated;
grant execute on function app.cafe_setting_specs() to service_role;

revoke all on function app.cafe_setting_spec(text) from public, anon, authenticated;
grant execute on function app.cafe_setting_spec(text) to service_role;

revoke all on function app.validate_cafe_setting(text, text, jsonb) from public, anon, authenticated;
grant execute on function app.validate_cafe_setting(text, text, jsonb) to service_role;

revoke all on function app.cafe_setting(text) from public, anon, authenticated;
grant execute on function app.cafe_setting(text) to service_role;

revoke all on function app.cafe_setting_text(text) from public, anon, authenticated;
grant execute on function app.cafe_setting_text(text) to service_role;

revoke all on function app.cafe_setting_int(text) from public, anon, authenticated;
grant execute on function app.cafe_setting_int(text) to service_role;

revoke all on function app.cafe_setting_bool(text) from public, anon, authenticated;
grant execute on function app.cafe_setting_bool(text) to service_role;

-- ---------------------------------------------------------------------------
-- Seed: one row per registry key at its default. Re-runnable; a later
-- migration that adds keys repeats this statement.
-- ---------------------------------------------------------------------------
insert into cafe_settings (key, value, is_public)
select s.key, s.default_value, s.is_public
  from app.cafe_setting_specs() s
on conflict (key) do nothing;
