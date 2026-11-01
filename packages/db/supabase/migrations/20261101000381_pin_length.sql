-- 0381 pin_length — staff PINs are 4 to 12 digits (launch finding F-50, Majed
-- 2026-11-01: "PINs are 4 to 12 digits (not 6 to 12)").
--
-- 0078 (SEC-13) raised the floor from 4 digits to 6; the owner has set it back
-- to 4 so the Quit / Exit-full-screen field, the till's PIN pads and the
-- server agree on one rule. The upper bound stays 12. The blocklist stays:
-- app.pin_is_weak still refuses one repeated digit (1111) and a straight run
-- either way (1234, 4321) at every length, so a 4-digit PIN is never the
-- first guess anyone would try. The attempt limiter (verify_manager_pin's
-- 5 per caller per 5 minutes and the lockout) is unchanged.
--
-- app.set_staff_pin is the only server rule on a PIN's shape (verify_* only
-- compare a hash), re-issued from its latest body, 20260917000105_staff_breaks.sql:66,
-- with the format test and its hint changed and nothing else.
--
-- covered by packages/db/tests/pin-strength.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.set_staff_pin(p_staff_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public as $set_staff_pin_0381$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0381 (F-50): was '^[0-9]{6,12}$' (0078).
  if p_pin !~ '^[0-9]{4,12}$' then
    raise exception 'PIN_FORMAT' using errcode = 'P0001',
      hint = 'PIN must be 4-12 digits';
  end if;

  if app.pin_is_weak(p_pin) then
    raise exception 'PIN_WEAK' using errcode = 'P0001',
      hint = 'not a repeated digit and not a sequential run';
  end if;

  -- 0105: no role filter. A cashier's PIN starts and ends a break and unlocks
  -- the idle lock; verify_manager_pin still ignores it for approvals.
  update staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
   where id = p_staff_id and is_active;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001',
      hint = 'PINs exist for active staff only';
  end if;

  -- Audit the CHANGE, never the PIN (0026).
  perform app.write_audit('staff.pin_set', 'staff', p_staff_id::text,
                          null, jsonb_build_object('staff_id', p_staff_id));
end $set_staff_pin_0381$;

comment on function app.set_staff_pin(uuid, text) is
  'Owner only. Sets an active staff member''s PIN: 4 to 12 digits (0381, F-50; PIN_FORMAT), not one repeated digit or a straight run (app.pin_is_weak; PIN_WEAK). Stored as a bcrypt hash; audited as staff.pin_set without PIN material. STAFF_NOT_FOUND for an inactive or unknown id.';

revoke all on function app.set_staff_pin(uuid, text) from public, anon;
grant execute on function app.set_staff_pin(uuid, text) to authenticated;
