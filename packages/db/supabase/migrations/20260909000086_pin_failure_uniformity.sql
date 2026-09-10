-- 0086_pin_failure_uniformity — SEC-13, the half 0078 did not do.
--
-- 0078 raised the PIN floor to six digits. This closes the other half of the
-- box: "make every PIN failure path return the same code, message and delay;
-- audit every lockout and every manager-cleared lock."
--
-- ---------------------------------------------------------------------------
-- WHAT WAS ALREADY TRUE, AND IS THEREFORE NOT TOUCHED HERE
-- ---------------------------------------------------------------------------
--
-- Read against the live catalog before writing a line of this:
--
--   * THE CODE AND MESSAGE ARE ALREADY UNIFORM. app.verify_manager_pin returns
--     NULL for every non-match — no such manager, inactive manager, no PIN set,
--     wrong PIN — and all five money callers (apply_discount, override_price,
--     refund, void_after_send, write_off_expired) turn that single NULL into
--     the single code PIN_INVALID. There is nothing to collapse.
--
--   * verify_own_pin's OWN codes (FORBIDDEN, NO_PIN_SET) are NOT an oracle and
--     are deliberately left alone. That function asks "is this the CALLER's own
--     PIN"; telling the caller they have no PIN set discloses nothing they do
--     not already know about themselves, and the lock screen needs to know in
--     order to offer the password path instead. Collapsing them into
--     PIN_INVALID would destroy a real UX affordance to hide a fact from the
--     only person who already has it.
--
-- So what was actually missing was the DELAY and the AUDIT.
--
-- ---------------------------------------------------------------------------
-- 1. THE TIMING LEAK, WHICH WAS REAL
-- ---------------------------------------------------------------------------
--
-- verify_manager_pin ran TWO scans over the candidate managers:
--
--     select count(*) ...  where pin_hash = crypt(p_pin, pin_hash)   -- all rows
--     select id      ...   where pin_hash = crypt(p_pin, pin_hash) limit 1
--
-- The second stops at the first match. So a CORRECT PIN returns after roughly
-- N + 1 bcrypt evaluations and a WRONG one after 2N — the function was
-- measurably faster when the guess was right, which is precisely the signal a
-- PIN gate must not emit. bcrypt is deliberately slow, which makes the gap
-- large rather than small: it is the dominant cost in the call.
--
-- Fixed by collapsing both scans into ONE aggregate that always evaluates every
-- candidate. That is strictly better on both counts: constant work regardless
-- of the answer, and roughly HALF the bcrypt work on the happy path, which is
-- the path a cashier waits on every time they take a manager authorisation.
--
-- On top of that, both verifiers now pad to a floor (app.pin_delay_floor) so
-- that success, failure and refusal-while-locked are indistinguishable in wall
-- time even if the bcrypt cost factor changes underneath us, and so that a
-- brute-force loop inside the 5-attempt window is slowed rather than free.
--
-- THE COST, STATED PLAINLY: every manager authorisation now takes at least
-- 250 ms. It is on the money path — a discount, a void, a refund — and it holds
-- its connection for that time. It is also invisible next to the dialog the
-- cashier is already reading, and there are a handful of tills in one venue.
-- The floor is a constant rather than a venue_setting on purpose: a tunable
-- security floor is a floor somebody eventually tunes to zero.
--
-- ---------------------------------------------------------------------------
-- 2. AUDITING THE LOCKOUT — AND WHY IT IS WRITTEN WHERE IT IS
-- ---------------------------------------------------------------------------
--
-- The obvious implementation is to write the audit row where PIN_LOCKED is
-- raised. It does not work, and it fails SILENTLY: `raise` aborts the
-- transaction, so the row is rolled back with it and the audit log stays empty
-- while the code reads as though it logs. This repository has already been
-- bitten by exactly this — migration 0011 exists because raising PIN_INVALID
-- rolled back the just-inserted pin_attempts row and the lockout could
-- therefore never engage.
--
-- So the row is written at the moment the lockout BEGINS: the failure that
-- takes the count to the threshold. That path returns normally, so the insert
-- commits. It is also the more accurate record — one row saying "this caller
-- was locked out at 19:42", rather than one row per subsequent retry, which is
-- what auditing at the raise site would have produced if it had worked.
--
-- ---------------------------------------------------------------------------
-- 3. CLEARING A LOCK
-- ---------------------------------------------------------------------------
--
-- The box says "audit every lockout and every manager-cleared lock". There was
-- no way to clear a lock at all: a cashier who fat-fingered five times sat out
-- five minutes mid-service with a queue, and the only lever anybody had was to
-- wait. app.clear_pin_lockout gives a manager that lever and writes the audit
-- row that makes using it accountable — which is the point of having it be a
-- manager action rather than a shorter window.
--
-- Note what it does NOT do: it does not reveal, set or verify a PIN. It deletes
-- recent FAILED attempts for one staff member. The successful ones stay, so the
-- history of who authorised what is untouched.
--
-- covered by packages/db/tests/pin-uniformity.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- app.pin_delay_floor — the constant every PIN verification is padded to.
-- ---------------------------------------------------------------------------
create or replace function app.pin_delay_floor() returns interval
language sql immutable set search_path = public as $pin_floor_0086$
  select interval '250 milliseconds';
$pin_floor_0086$;

comment on function app.pin_delay_floor() is
  '0086/SEC-13. The wall-clock floor every PIN verification is padded to, so success, failure and refusal-while-locked are indistinguishable by timing. A constant, not a venue_setting: a tunable security floor is one somebody eventually tunes to zero.';

revoke all on function app.pin_delay_floor() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.pin_pad_to_floor — sleep out the remainder of the floor.
--
-- Takes the instant the verification STARTED. clock_timestamp(), not now():
-- now() is the transaction timestamp and does not advance, so measuring with it
-- would compute a zero elapsed time and pad every call by the full floor.
-- ---------------------------------------------------------------------------
create or replace function app.pin_pad_to_floor(p_started timestamptz) returns void
language plpgsql set search_path = public as $pin_pad_0086$
declare
  v_remaining double precision;
begin
  v_remaining := extract(epoch from (app.pin_delay_floor() - (clock_timestamp() - p_started)));
  if v_remaining > 0 then
    perform pg_sleep(v_remaining);
  end if;
end $pin_pad_0086$;

comment on function app.pin_pad_to_floor(timestamptz) is
  '0086/SEC-13. Pads a PIN verification to app.pin_delay_floor(). Called on EVERY exit of verify_manager_pin / verify_own_pin, including the raises — a path that skipped it would be the fast one, and the fast one is the answer.';

revoke all on function app.pin_pad_to_floor(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.verify_manager_pin — re-issued IN FULL.
--
-- `create or replace` replaces the whole body, so the 0046 staff guard and the
-- 0026 caller-keyed limiter are restated here verbatim rather than assumed.
-- (That is how 0075 silently reverted 0071's guard.)
-- ---------------------------------------------------------------------------
create or replace function app.verify_manager_pin(p_pin text, p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $vmp_0086$
declare
  v_started timestamptz := clock_timestamp();
  v_caller  text := coalesce(auth.uid()::text, 'anon');
  v_key     text;
  v_fails   int;
  v_id      uuid;
  v_matches int;
begin
  -- 0046: staff only. The five money RPCs that call this are SECURITY DEFINER
  -- owned by postgres, so this guard sees the ORIGINAL caller's JWT and passes
  -- for them; a guest probing the endpoint directly is refused before any
  -- bcrypt work happens. NOT padded: this is not a PIN outcome at all, it is
  -- "you are not staff", and the caller's own role is not a secret from them.
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
    -- 0086: padded. Without this a locked-out caller is refused in a
    -- millisecond while a wrong PIN costs a bcrypt, and the retry loop that
    -- follows a lockout runs at full speed.
    perform app.pin_pad_to_floor(v_started);
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  -- 0086: ONE scan, always over every candidate. The previous count(*) +
  -- `select … limit 1` pair made a CORRECT pin measurably faster than a wrong
  -- one, because only the second query could stop early. array_agg with an
  -- ORDER BY keeps 0037's stable attribution on a PIN collision.
  select count(*), (array_agg(id order by id))[1]
    into v_matches, v_id
    from staff
   where role in ('manager','owner') and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_pin, pin_hash);

  insert into app.pin_attempts (device_id, success) values (v_key, v_id is not null);

  -- 0086: the lockout is audited HERE — at the failure that reaches the
  -- threshold — because this path RETURNS and therefore commits. Writing it
  -- beside the `raise` above would roll the row back with the exception and
  -- log nothing at all (the 0011 lesson).
  --
  -- entity_id is THE CALLER, not the manager whose PIN was guessed at — there
  -- is no such manager on a failure, and audit_log.entity_id is NOT NULL, so
  -- passing null here aborted the whole transaction. That did not merely lose
  -- the audit row: it rolled back the pin_attempts INSERT alongside it, so the
  -- fifth failure was never recorded and THE LOCKOUT NEVER ENGAGED. Caught by
  -- pin-uniformity.test.ts on its first run; it is the 0011 failure mode
  -- wearing a different hat, which is why the row is written on a path that
  -- returns rather than one that raises.
  if v_id is null and v_fails + 1 >= 5 then
    perform app.write_audit('staff.pin_locked', 'staff', v_caller, null,
                            jsonb_build_object('scope', 'manager', 'fails', v_fails + 1,
                                               'window', '5 minutes'),
                            null, null, p_device_id);
  end if;

  -- A collision means authorized_by may name the wrong manager. Ordering makes
  -- the choice stable; it does not make it correct. Real fix is PIN uniqueness.
  if v_matches > 1 then
    raise warning 'PIN collision: % active managers share this PIN', v_matches;
    perform app.write_audit('staff.pin_collision', 'staff', v_id::text, null,
                            jsonb_build_object('matches', v_matches), null, null, p_device_id);
  end if;

  -- Padded on BOTH outcomes. Padding only the failure would invert the leak:
  -- fast would mean correct.
  perform app.pin_pad_to_floor(v_started);
  return v_id;
end $vmp_0086$;

revoke all on function app.verify_manager_pin(text, text) from public, anon;
grant execute on function app.verify_manager_pin(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- app.verify_own_pin — re-issued IN FULL (0064 body + the 0086 additions).
-- ---------------------------------------------------------------------------
create or replace function app.verify_own_pin(p_pin text, p_device_id text default null)
returns boolean
language plpgsql security definer set search_path = public as $own_pin_0086$
declare
  v_started timestamptz := clock_timestamp();
  v_caller  uuid := auth.uid();
  v_key     text;
  v_fails   int;
  v_row     staff%rowtype;
  v_ok      boolean;
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
    perform app.pin_pad_to_floor(v_started);
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  select * into v_row from staff where id = v_caller and is_active;
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- Kept as its own code: this tells the CALLER about the CALLER, so it is not
  -- an oracle, and the lock screen needs it to offer the password path (the
  -- self-unlock gap — a cashier has no PIN to unlock with).
  if v_row.pin_hash is null then
    raise exception 'NO_PIN_SET' using errcode = 'P0001',
      hint = 'unlock with the account password instead';
  end if;

  v_ok := v_row.pin_hash = extensions.crypt(p_pin, v_row.pin_hash);
  insert into app.pin_attempts (device_id, success) values (v_key, v_ok);

  if not v_ok and v_fails + 1 >= 5 then
    perform app.write_audit('staff.pin_locked', 'staff', v_caller::text, null,
                            jsonb_build_object('scope', 'self', 'fails', v_fails + 1,
                                               'window', '5 minutes'),
                            null, null, p_device_id);
  end if;

  perform app.pin_pad_to_floor(v_started);
  return v_ok;
end $own_pin_0086$;

revoke all on function app.verify_own_pin(text, text) from public, anon;
grant execute on function app.verify_own_pin(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- app.clear_pin_lockout — a manager releases a locked-out staff member.
-- ---------------------------------------------------------------------------
create or replace function app.clear_pin_lockout(p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $clear_lock_0086$
declare
  v_cleared int;
  v_target  staff%rowtype;
begin
  -- The role guard is the FIRST statement, before any argument validation:
  -- check:authz calls every RPC with NULL arguments as a real anonymous guest
  -- and expects a refusal.
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_target from staff where id = p_staff_id;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Only the FAILURES, and only the ones still inside the window. The
  -- successful attempts are the record of who authorised what and are never
  -- touched; older failures are already spent and deleting them would quietly
  -- rewrite how often this person has been locked out.
  delete from app.pin_attempts
   where device_id like p_staff_id::text || ':%'
     and not success
     and attempted_at > now() - interval '5 minutes';
  get diagnostics v_cleared = row_count;

  -- Both scopes: '{uuid}:{device}' (manager authorisations) and
  -- '{uuid}:self:{device}' (the lock screen) both start with the uuid, so the
  -- one prefix covers them. A manager clearing a lock releases the person, not
  -- one of their two limiters.
  perform app.write_audit('staff.pin_lockout_cleared', 'staff', p_staff_id::text,
                          jsonb_build_object('failed_attempts', v_cleared),
                          jsonb_build_object('failed_attempts', 0));

  return jsonb_build_object('cleared', v_cleared);
end $clear_lock_0086$;

comment on function app.clear_pin_lockout(uuid) is
  '0086/SEC-13. Manager/owner releases a staff member locked out by 5 failed PIN attempts in 5 minutes. Deletes only in-window FAILED attempts; never reveals, sets or verifies a PIN. Audited as staff.pin_lockout_cleared.';

revoke all on function app.clear_pin_lockout(uuid) from public, anon;
grant execute on function app.clear_pin_lockout(uuid) to authenticated;
