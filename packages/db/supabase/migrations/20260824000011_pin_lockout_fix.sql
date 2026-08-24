-- Lockout fix for verify_manager_pin (found by the RLS matrix suite against
-- staging): raising PIN_INVALID rolled back the just-inserted attempt row
-- (PostgREST wraps each RPC in one transaction), so the 5-failure lockout could
-- never engage. Invalid PIN now returns NULL — the attempt row persists —
-- and only PIN_LOCKED raises. Callers treat NULL as PIN_INVALID; composite
-- sensitive RPCs re-raise it themselves. 0004/0009 amended in place for fresh
-- environments; this re-applies the body for environments that already ran them.

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

  -- NULL = invalid PIN (see header). Never raise here.
  return v_id;
end $$;
