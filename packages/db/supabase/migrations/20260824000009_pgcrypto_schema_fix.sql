-- pgcrypto lives in the `extensions` schema on Supabase (hosted AND local CLI
-- stacks), so crypt()/gen_salt() are not visible from functions pinned to
-- `search_path = public`. 0004 was amended in place for fresh environments;
-- this migration re-applies the two affected function bodies so environments
-- that ran the original 0004 (staging) pick up the qualified calls.
-- Idempotent: CREATE OR REPLACE with identical definitions to the fixed 0004.

create or replace function app.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN_FORMAT' using errcode = 'P0001',
      hint = 'PIN must be 4-6 digits';
  end if;
  update staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
   where id = p_staff_id and role in ('manager','owner') and is_active;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001',
      hint = 'PINs exist for active managers/owners only';
  end if;
end $$;

create or replace function app.verify_manager_pin(p_pin text, p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_dev   text := coalesce(p_device_id, 'unknown');
  v_fails int;
  v_id    uuid;
begin
  select count(*) into v_fails
    from app.pin_attempts
   where device_id = v_dev and not success
     and attempted_at > now() - interval '5 minutes';
  if v_fails >= 5 then
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  select id into v_id
    from staff
   where role in ('manager','owner') and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_pin, pin_hash)
   limit 1;

  insert into app.pin_attempts (device_id, success) values (v_dev, v_id is not null);

  -- Returns NULL on an invalid PIN instead of raising: a raise would roll back
  -- the attempt row above (PostgREST wraps each RPC in one transaction) and the
  -- 5-failure lockout could never engage. Callers treat NULL as PIN_INVALID;
  -- composite sensitive RPCs re-raise it themselves. Found by the RLS matrix
  -- suite against staging (lockout test).
  return v_id;
end $;
