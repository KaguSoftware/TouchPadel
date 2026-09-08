-- 0078_pin_strength — SEC-13. Raise the staff PIN floor from 4 digits to 6, and
-- refuse the handful of 6-digit PINs that are no better than 4.
--
-- WHAT A PIN ACTUALLY GUARDS HERE. It is not a login. It is the MANAGER
-- AUTHORISATION on the money paths: app.override_price, app.void_after_send,
-- app.write_off_expired and the refund flow all take p_pin and call
-- app.verify_manager_pin before they will move a price, void a sent item or
-- write off stock. It is also the idle-lock unlock (0064). So the PIN is what
-- stands between a cashier alone at the till and an unlogged discount.
--
-- WHY 4 DIGITS WAS NOT ENOUGH. 10,000 possibilities, entered at a terminal the
-- attacker is standing at, guarded by a limiter of 5 attempts per caller per 5
-- minutes. That limiter is doing all the work — and it is keyed on the CALLER,
-- so a second staff identity is a second budget. Six digits is 100x the
-- keyspace for one extra keypress.
--
-- WHY A BLOCKLIST ON TOP. `111111` and `123456` are 6 digits and worth about
-- two. The three shapes refused here are the ones a person actually picks when
-- told "six digits": one repeated digit, a straight ascending run, a straight
-- descending run. That is 21 PINs out of a million — a rounding error against
-- the keyspace, and it removes the guesses anyone would try first.
--
-- DELIBERATELY NOT REFUSED: dates (birthdays), repeated pairs (`121212`), and
-- keypad patterns. Each needs context this function does not have, and a rule
-- that refuses a PIN the user believes is fine — with no way to explain why —
-- trains people to write the PIN down. That is a worse outcome than `191919`.
--
-- THE SEEDED DEV PINS CHANGED WITH THIS. `111111` and `222222` are both now
-- refused by the rule they are meant to demonstrate. seed.sql sets pin_hash
-- through crypt() directly, so they would have kept WORKING while being
-- unsettable through the product — exactly the kind of divergence between the
-- dev environment and the shipped rule that hides bugs. They are now 719264
-- (owner) and 380517 (manager); DEV_PINS, the e2e specs and the README moved
-- with them.
--
-- covered by packages/db/tests/pin-strength.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- app.pin_is_weak — the shared predicate, so the RPC and its tests cannot
-- disagree about what "weak" means.
-- ---------------------------------------------------------------------------
create or replace function app.pin_is_weak(p_pin text) returns boolean
language sql immutable set search_path = public as $pin_is_weak_0078$
  select
    -- one digit repeated: 000000, 111111, ...
    p_pin ~ '^([0-9])\1*$'
    -- a straight run in either direction, of any length: 123456, 654321, 3456...
    or position(p_pin in '01234567890') > 0
    or position(p_pin in '09876543210') > 0;
$pin_is_weak_0078$;

comment on function app.pin_is_weak(text) is
  '0078/SEC-13. True for the three shapes a person picks when told "six digits": one repeated digit, an ascending run, a descending run. The trailing digit in each reference string ("...890" / "...210") extends the run by one so 567890 and 098765 are caught; it does NOT wrap further, so 890123 is allowed. Dates, repeated pairs and keypad walks are NOT refused — see the migration header.';

revoke all on function app.pin_is_weak(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_staff_pin — 6 digit minimum + the blocklist.
-- ---------------------------------------------------------------------------
-- Re-issued from the 0046 body with the format rule replaced; everything else
-- (owner guard, the manager/owner-and-active target, the audit row that never
-- carries PIN material) is carried over unchanged.
create or replace function app.set_staff_pin(p_staff_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public as $set_staff_pin_0078$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0078: was '^[0-9]{4,6}$'. Upper bound is generous rather than 6 — a longer
  -- PIN is strictly better and there is no reason to stop someone choosing one.
  if p_pin !~ '^[0-9]{6,12}$' then
    raise exception 'PIN_FORMAT' using errcode = 'P0001',
      hint = 'PIN must be 6-12 digits';
  end if;

  if app.pin_is_weak(p_pin) then
    raise exception 'PIN_WEAK' using errcode = 'P0001',
      hint = 'not a repeated digit and not a sequential run';
  end if;

  update staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
   where id = p_staff_id and role in ('manager','owner') and is_active;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001',
      hint = 'PINs exist for active managers/owners only';
  end if;

  -- Audit the CHANGE, never the PIN (0026).
  perform app.write_audit('staff.pin_set', 'staff', p_staff_id::text,
                          null, jsonb_build_object('staff_id', p_staff_id));
end $set_staff_pin_0078$;

revoke all on function app.set_staff_pin(uuid, text) from public, anon;
grant execute on function app.set_staff_pin(uuid, text) to authenticated;
