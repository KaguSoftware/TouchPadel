-- 0064_idle_lock — the station-lock half of SOW L237-238 ("short-lived
-- sessions on shared till machines, with a PIN for sensitive actions").
--
-- The sensitive-action PIN has existed since 0004 (verify_manager_pin gates
-- discounts/voids/overrides). What was missing is the SESSION side: a shared
-- till that someone walks away from stays signed in forever. Owner-approved
-- model (day-14 plan): the Supabase session STAYS signed in (fighting token
-- lifetimes on a kiosk buys nothing); an idle overlay locks the SCREEN after a
-- configurable timeout, and unlocking takes the signed-in staff member's OWN
-- pin (or their password, client-side re-auth).
--
--   1. app.verify_own_pin — any active staff role, own row only, the 0011/0026
--      lockout machinery ('{caller}:self:{device}' attempts, 5 fails / 5 min).
--      Self-scoped + rate-limited + staff-only ⇒ no oracle. NO_PIN_SET tells
--      the client to fall back to password re-auth. Returns boolean.
--   2. till_idle_lock_seconds joins cafe_setting_specs (int 0-3600, manager;
--      0 = disabled; default 300).
--
-- covered by packages/db/tests/idle-lock.test.ts

create or replace function app.verify_own_pin(p_pin text, p_device_id text default null)
returns boolean
language plpgsql security definer set search_path = public as $own_pin_0064$
declare
  v_caller uuid := auth.uid();
  v_key    text;
  v_fails  int;
  v_row    staff%rowtype;
  v_ok     boolean;
begin
  if v_caller is null or not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Same shape as verify_manager_pin's limiter, namespaced ':self:' so a
  -- lock-screen brute force and a discount brute force share nothing.
  v_key := v_caller::text || ':self:' || coalesce(p_device_id, 'unknown');
  select count(*) into v_fails
    from app.pin_attempts
   where device_id like v_caller::text || ':self:%'
     and not success
     and attempted_at > now() - interval '5 minutes';
  if v_fails >= 5 then
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  select * into v_row from staff where id = v_caller and is_active;
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_row.pin_hash is null then
    raise exception 'NO_PIN_SET' using errcode = 'P0001',
      hint = 'unlock with the account password instead';
  end if;

  v_ok := v_row.pin_hash = extensions.crypt(p_pin, v_row.pin_hash);
  insert into app.pin_attempts (device_id, success) values (v_key, v_ok);
  return v_ok;
end $own_pin_0064$;

revoke all on function app.verify_own_pin(text, text) from public, anon;
grant execute on function app.verify_own_pin(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- till_idle_lock_seconds — full re-create of the 0029 VALUES list + one row.
-- ---------------------------------------------------------------------------
create or replace function app.cafe_setting_specs()
returns table (key text, is_public boolean, jtype text, min_role staff_role, default_value jsonb)
language sql stable security definer set search_path = public as $cafe_specs_0064$
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
      -- private + manager (station behaviour)
      ('till_idle_lock_seconds',            false, 'int(0,3600)',               'manager'::staff_role, '300'::jsonb),
      -- private + owner (operational / secrets-adjacent)
      ('telegram_enabled',                  false, 'bool',                      'owner'::staff_role,   'false'::jsonb),
      ('telegram_chat_id',                  false, 'chat_id',                   'owner'::staff_role,   'null'::jsonb),
      ('telegram_lang',                     false, 'enum(ar|en)',               'owner'::staff_role,   '"ar"'::jsonb),
      ('telegram_last_callback_at',         false, 'timestamp',                 'owner'::staff_role,   'null'::jsonb),
      ('analytics_business_day_start_hour', false, 'int(0,12)',                 'owner'::staff_role,   '4'::jsonb),
      ('analytics_excluded_item_ids',       false, 'uuid_array',                'owner'::staff_role,   '[]'::jsonb),
      ('analytics_engagement_floor',        false, 'date',                      'owner'::staff_role,   'null'::jsonb)
    ) as v(key, is_public, jtype, min_role, default_value)
$cafe_specs_0064$;
