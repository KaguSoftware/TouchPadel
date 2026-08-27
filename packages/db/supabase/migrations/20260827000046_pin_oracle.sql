-- ===========================================================================
-- 0046 — close the manager-PIN oracle
--
--   #22  app.verify_manager_pin was EXECUTE-able by `authenticated`, and café
--        guests hold `authenticated` (anonymous sign-in, config.toml
--        enable_anonymous_sign_ins = true). It has no role guard by design --
--        it returns the authorizing staff id on a match and NULL otherwise,
--        deliberately not raising, so the attempt row survives to drive the
--        lockout. That makes it a clean yes/no PIN oracle for anyone at all.
--
--        0026 hardened the lockout by keying attempts on auth.uid() rather
--        than the client-supplied p_device_id, because rotating device ids
--        gave unlimited guesses. Rotating IDENTITIES does the same thing:
--        anonymous sign-up is unauthenticated and unlimited, and every new
--        anonymous user is a brand-new auth.uid() with a brand-new bucket.
--
--        Reproduced against 0045:
--          A: one identity, wrong PINs      -> PIN_LOCKED on the 6th attempt
--          B: fresh identity per attempt    -> 20 attempts allowed, 0 lockouts
--          C: rotated identity, PIN 222222  -> 200, returns the manager's id
--
--        A guest holding a manager PIN still cannot call apply_discount,
--        override_price, void_after_send or refund -- those check is_staff
--        first. The exposure is a CASHIER: those four need only the cashier
--        role plus a valid manager PIN, so a cashier who brute-forces the PIN
--        through rotated anonymous sessions gains manager authority over
--        discounts, voids, price overrides and refunds from their own till
--        account. That is precisely what the PIN gate exists to stop.
--
--        Fix: require staff. An anonymous identity is not staff, so the
--        rotation vector is closed outright; a real cashier brute-forcing from
--        their own account now meets the 0026 lockout, which binds because
--        staff accounts are finite and owner-created rather than minted on
--        demand. EXECUTE stays granted to authenticated: the till's PIN-prompt
--        pattern (verify, then act) is a legitimate staff call, and the
--        hardening and rls-matrix suites exercise it directly. Anonymous is
--        revoked outright since a guest has no use for it at all.
-- ===========================================================================

create or replace function app.verify_manager_pin(p_pin text, p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $vmp_0046$
declare
  v_caller  text := coalesce(auth.uid()::text, 'anon');
  v_key     text;
  v_fails   int;
  v_id      uuid;
  v_matches int;
begin
  -- 0046: staff only. The five RPCs that call this are SECURITY DEFINER owned
  -- by postgres, so this guard sees the ORIGINAL caller's JWT and passes for
  -- them; a guest probing the endpoint directly is refused before any bcrypt
  -- work happens, which also removes the timing side-channel.
  if not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- RATE-LIMIT KEY (0026): p_device_id is client-supplied, so keying on it
  -- alone let a caller rotate device ids for unlimited guesses. Attempts are
  -- stored under '{caller}:{device}' and failures are COUNTED per caller
  -- (prefix match across all that caller's devices): 5 fails / 5 min / caller.
  v_key := v_caller || ':' || coalesce(p_device_id, 'unknown');

  select count(*) into v_fails
    from app.pin_attempts
   where device_id like v_caller || ':%'
     and not success
     and attempted_at > now() - interval '5 minutes';
  if v_fails >= 5 then
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  select count(*) into v_matches
    from staff
   where role in ('manager','owner') and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_pin, pin_hash);

  select id into v_id
    from staff
   where role in ('manager','owner') and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_pin, pin_hash)
   order by id                      -- 0037: was unordered; attribution drifted
   limit 1;

  insert into app.pin_attempts (device_id, success) values (v_key, v_id is not null);

  -- A collision means authorized_by may name the wrong manager. Ordering makes
  -- the choice stable; it does not make it correct. Real fix is PIN uniqueness.
  if v_matches > 1 then
    raise warning 'PIN collision: % active managers share this PIN', v_matches;
    perform app.write_audit('staff.pin_collision', 'staff', v_id::text, null,
                            jsonb_build_object('matches', v_matches), null, null, p_device_id);
  end if;

  return v_id;
end $vmp_0046$;

-- anon has no use for this; staff keep it for the till PIN prompt. The five
-- internal SECURITY DEFINER callers are unaffected either way -- their EXECUTE
-- is checked against the function owner, not the caller.
revoke all on function app.verify_manager_pin(text, text) from public, anon;
grant execute on function app.verify_manager_pin(text, text) to authenticated;
