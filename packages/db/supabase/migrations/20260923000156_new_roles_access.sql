-- ===========================================================================
-- 0156 — the six 0155 roles pass the guards they are meant to pass, and no
-- guard needs touching for the next role.
--
-- A staff_role value gets nothing on its own: every guard names the roles it
-- admits, and there is no hierarchy. Two kinds of guard named `prep`:
--
--   ANY STAFF. Eight functions and seventeen policies listed all five roles,
--   which is a long way of saying "any active staff member". Each becomes
--   role-agnostic, the 0072 way:
--       functions  if app.staff_role() is null then raise …
--       policies   using (app.staff_role() is not null …)
--   app.staff_role() returns the caller's role only for an ACTIVE staff row
--   and NULL for everyone else, so for the five existing roles this is the
--   same predicate, bit for bit; is_staff's coalesce to false has no work to
--   do here, `is not null` is never NULL. It is already granted to anon and
--   authenticated (0003:64), which the anon branch of the catalogue policies
--   needs.
--   What any staff member gets is therefore unchanged in kind: sign-in,
--   the idle-lock PIN, breaks and cover, the heartbeat, the manager-PIN step
--   before a money RPC (whose own role guard still decides), and the reads
--   prep and court_desk share today — menu, courts, rates, tax groups,
--   venues, venue settings, stations, tables, promotions, tabs and orders at
--   the venues they work at. No till, desk, stock, menu write or money read:
--   those guards list their roles and none of them changes.
--
--   KITCHEN. set_ticket_status, set_order_item_ready, tickets_staff_read and
--   the kds/floor realtime topics list prep, cashier, manager and owner. They
--   keep an explicit list and gain head_barista, barista, head_chef and chef,
--   so the bar and kitchen roles hold exactly what prep holds and driver and
--   marketing hold none of it.
--
-- PREP STAYS in every kitchen list. It is soft-retired in the client (the
-- Staff page no longer offers it, staff-admin refuses to create it) and the
-- accounts that hold it keep working until the owner moves them to barista
-- or chef. A later migration drops it from the four lists once no active
-- prep account is left; the any-staff guards will not need that one.
--
-- Every function is its LATEST body, copied verbatim from the file named
-- beside it, with the guard line and the dollar tag changed and nothing else.
-- Signatures are unchanged, so each keeps its grants; the revoke/grant pair
-- the latest file used is re-issued anyway. Every policy is its latest
-- definition (0136 and 0139 venue conjuncts included) with only the role
-- test changed, as `drop policy if exists` + `create policy`.
--
-- covered by packages/db/tests/new-roles.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.break_status — 0105:313 ($break_status_0105$) verbatim, guard only.
-- ---------------------------------------------------------------------------
create or replace function app.break_status(p_device_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $break_status_0156$
declare
  v_caller uuid := auth.uid();
  v_date   date;
  v_allow  int;
  v_used   int;
  v_open   staff_breaks%rowtype;
begin
  if v_caller is null or app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
    raise exception 'INVALID_STATION' using errcode = 'P0001',
      hint = 'capitals, digits and dashes, starting with a letter';
  end if;

  v_date  := app.business_date(now());
  v_allow := app.break_allowance_seconds();
  v_used  := app.break_used_seconds(v_caller, v_date);
  select * into v_open from staff_breaks where staff_id = v_caller and ended_at is null;

  return jsonb_build_object(
    'now', now(),
    'business_date', v_date,
    'allowance_seconds', v_allow,
    'used_seconds', v_used,
    'remaining_seconds', greatest(0, v_allow - v_used),
    'open', case when v_open.id is null then null else app.break_row_json(v_open) end,
    'candidates', app.break_cover_candidates(p_device_id, v_caller)
  );
end $break_status_0156$;

revoke all on function app.break_status(text) from public, anon;
grant execute on function app.break_status(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.start_break — 0105:353 ($start_break_0105$) verbatim, guard only.
-- ---------------------------------------------------------------------------
create or replace function app.start_break(p_pin text, p_device_id text)
returns jsonb
language plpgsql security definer set search_path = public as $start_break_0156$
declare
  v_caller uuid := auth.uid();
  v_date   date;
  v_allow  int;
  v_used   int;
  v_row    staff_breaks%rowtype;
begin
  if v_caller is null or app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
    raise exception 'INVALID_STATION' using errcode = 'P0001',
      hint = 'a break is taken from a named station';
  end if;
  if exists (select 1 from staff_breaks where staff_id = v_caller and ended_at is null) then
    raise exception 'BREAK_ALREADY_OPEN' using errcode = 'P0001';
  end if;

  v_date  := app.business_date(now());
  v_allow := app.break_allowance_seconds();
  v_used  := app.break_used_seconds(v_caller, v_date);
  -- Less than a minute left is nothing to take.
  if v_allow - v_used < 60 then
    raise exception 'BREAK_ALLOWANCE_USED' using errcode = 'P0001',
      hint = format('%s of %s seconds used today', v_used, v_allow);
  end if;

  -- The person's own PIN, with the 0064/0086 limiter (':self:' namespace).
  -- Raises PIN_LOCKED / NO_PIN_SET itself; a plain wrong PIN comes back false
  -- and is RETURNED, so the attempt row it wrote survives (0011).
  if not app.verify_own_pin(p_pin, p_device_id) then
    return jsonb_build_object('ok', false, 'code', 'PIN_INVALID');
  end if;

  insert into staff_breaks (staff_id, station_id, business_date)
  values (v_caller, p_device_id, v_date)
  returning * into v_row;

  perform app.write_audit('staff.break_start', 'staff_break', v_row.id::text, null,
                          jsonb_build_object('staff_id', v_caller, 'station_id', p_device_id,
                                             'business_date', v_date,
                                             'remaining_seconds', v_allow - v_used),
                          null, null, p_device_id);

  return jsonb_build_object(
    'ok', true,
    'break', app.break_row_json(v_row),
    'allowance_seconds', v_allow,
    'used_seconds', v_used,
    'remaining_seconds', v_allow - v_used
  );
end $start_break_0156$;

revoke all on function app.start_break(text, text) from public, anon;
grant execute on function app.start_break(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.end_break — 0105:415 ($end_break_0105$) verbatim, guard only.
-- ---------------------------------------------------------------------------
create or replace function app.end_break(p_pin text, p_device_id text)
returns jsonb
language plpgsql security definer set search_path = public as $end_break_0156$
declare
  v_caller   uuid := auth.uid();
  v_row      staff_breaks%rowtype;
  v_allow    int;
  v_used     int;
  v_duration int;
begin
  if v_caller is null or app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from staff_breaks where staff_id = v_caller and ended_at is null for update;
  if not found then
    raise exception 'BREAK_NOT_OPEN' using errcode = 'P0001';
  end if;

  if not app.verify_own_pin(p_pin, p_device_id) then
    return jsonb_build_object('ok', false, 'code', 'PIN_INVALID');
  end if;

  update staff_breaks set ended_at = now() where id = v_row.id returning * into v_row;
  v_duration := extract(epoch from v_row.ended_at - v_row.started_at)::int;
  v_allow    := app.break_allowance_seconds();
  v_used     := app.break_used_seconds(v_caller, v_row.business_date);

  perform app.write_audit('staff.break_end', 'staff_break', v_row.id::text, null,
                          jsonb_build_object('staff_id', v_caller, 'station_id', v_row.station_id,
                                             'duration_seconds', v_duration,
                                             'used_seconds', v_used,
                                             'allowance_seconds', v_allow,
                                             'overran', v_used > v_allow,
                                             'covered_by', v_row.covered_by),
                          null, v_row.covered_by, p_device_id);

  return jsonb_build_object(
    'ok', true,
    'break', app.break_row_json(v_row),
    'duration_seconds', v_duration,
    'allowance_seconds', v_allow,
    'used_seconds', v_used,
    'remaining_seconds', greatest(0, v_allow - v_used)
  );
end $end_break_0156$;

revoke all on function app.end_break(text, text) from public, anon;
grant execute on function app.end_break(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.cover_station — 0105:479 ($cover_station_0105$) verbatim, guard
--    only. The target test (manager/owner, or assigned to the station) is
--    about who may take over, not who may ask, and stays as it is.
-- ---------------------------------------------------------------------------
create or replace function app.cover_station(p_staff_id uuid, p_pin text, p_device_id text)
returns jsonb
language plpgsql security definer set search_path = public as $cover_station_0156$
declare
  v_started timestamptz := clock_timestamp();
  v_caller  uuid := auth.uid();
  v_row     staff_breaks%rowtype;
  v_target  staff%rowtype;
  v_key     text;
  v_fails   int;
  v_ok      boolean;
begin
  if v_caller is null or app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
    raise exception 'INVALID_STATION' using errcode = 'P0001';
  end if;

  select * into v_row
    from staff_breaks
   where staff_id = v_caller and ended_at is null and station_id = p_device_id
     for update;
  if not found then
    raise exception 'BREAK_NOT_OPEN' using errcode = 'P0001',
      hint = 'cover is only offered while the signed-in person is on a break at this station';
  end if;

  if p_staff_id is null or p_staff_id = v_caller then
    raise exception 'COVER_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  select * into v_target from staff where id = p_staff_id and is_active;
  if not found or v_target.pin_hash is null then
    raise exception 'COVER_NOT_ALLOWED' using errcode = 'P0001',
      hint = 'not active staff, or no PIN set';
  end if;
  if v_target.role not in ('manager','owner')
     and not exists (select 1 from station_staff
                      where station_id = p_device_id and staff_id = p_staff_id) then
    raise exception 'COVER_NOT_ALLOWED' using errcode = 'P0001',
      hint = 'not assigned to this station';
  end if;

  v_key := v_caller::text || ':cover:' || p_device_id;
  select count(*) into v_fails
    from app.pin_attempts
   where device_id like v_caller::text || ':cover:%'
     and not success
     and attempted_at > now() - interval '5 minutes';
  if v_fails >= 5 then
    perform app.pin_pad_to_floor(v_started);
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  v_ok := v_target.pin_hash = extensions.crypt(p_pin, v_target.pin_hash);
  insert into app.pin_attempts (device_id, success) values (v_key, v_ok);

  if not v_ok then
    if v_fails + 1 >= 5 then
      perform app.write_audit('staff.pin_locked', 'staff', v_caller::text, null,
                              jsonb_build_object('scope', 'cover', 'fails', v_fails + 1,
                                                 'window', '5 minutes'),
                              null, null, p_device_id);
    end if;
    perform app.pin_pad_to_floor(v_started);
    return jsonb_build_object('ok', false, 'code', 'PIN_INVALID');
  end if;

  if v_row.covered_by is distinct from p_staff_id then
    update staff_breaks
       set covered_by = p_staff_id, cover_started_at = now()
     where id = v_row.id
     returning * into v_row;
    perform app.write_audit('staff.break_cover', 'staff_break', v_row.id::text,
                            null,
                            jsonb_build_object('staff_id', v_caller, 'station_id', p_device_id,
                                               'covered_by', p_staff_id),
                            null, p_staff_id, p_device_id);
  end if;

  perform app.pin_pad_to_floor(v_started);
  return jsonb_build_object('ok', true, 'break', app.break_row_json(v_row));
end $cover_station_0156$;

revoke all on function app.cover_station(uuid, text, text) from public, anon;
grant execute on function app.cover_station(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.verify_own_pin — 0086:234 ($own_pin_0086$) verbatim, guard only.
-- ---------------------------------------------------------------------------
create or replace function app.verify_own_pin(p_pin text, p_device_id text default null)
returns boolean
language plpgsql security definer set search_path = public as $verify_own_pin_0156$
declare
  v_started timestamptz := clock_timestamp();
  v_caller  uuid := auth.uid();
  v_key     text;
  v_fails   int;
  v_row     staff%rowtype;
  v_ok      boolean;
begin
  if v_caller is null or app.staff_role() is null then
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
end $verify_own_pin_0156$;

revoke all on function app.verify_own_pin(text, text) from public, anon;
grant execute on function app.verify_own_pin(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.heartbeat — 0130:63 ($fn_heartbeat_0130$) verbatim, guard only.
-- ---------------------------------------------------------------------------
create or replace function app.heartbeat(
  p_device_id   text,
  p_queue_depth int default 0,
  p_app_version text default null,
  p_is_till     boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $heartbeat_0156$
declare
  v_venue   uuid;
  v_is_till boolean;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id = '' then
    raise exception 'DEVICE_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0130: an id the registry does not hold as a live station. A retired row
  -- counts as absent on purpose (0118: "if it beats again it simply
  -- re-registers"), which is what the on-conflict clause below settles.
  if not exists (select 1 from stations where id = p_device_id and retired_at is null) then
    if p_device_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
      raise exception 'INVALID_STATION' using errcode = 'P0001',
        hint = 'capitals, digits and dashes, starting with a letter';
    end if;
    -- No station argument: the station is what we are trying to learn. R2.
    v_venue := app.resolve_venue();
    if v_venue is null then
      raise exception 'STATION_UNKNOWN' using errcode = 'P0001',
        detail = p_device_id,
        hint = 'sign in as staff of the venue this device belongs to, or register the station first';
    end if;
    v_is_till := coalesce(p_is_till, false) or p_device_id like 'TILL%';
    insert into stations (id, venue_id, is_till, registered_by)
    values (p_device_id, v_venue, v_is_till, auth.uid())
    on conflict (id) do update
       set retired_at = null,
           is_till    = stations.is_till or excluded.is_till;
    perform app.write_audit('station.registered', 'stations', p_device_id,
                            null,
                            jsonb_build_object('venue_id', v_venue, 'is_till', v_is_till,
                                               'via', 'heartbeat'),
                            null, null, p_device_id);
  end if;

  -- Transaction-local: everything below this line, and every RPC that shares
  -- this transaction, resolves the venue from the device that is beating.
  perform set_config('app.station_id', p_device_id, true);

  -- Observe the venue as this beat FOUND it (0055): without this, a returning
  -- till erases the evidence of its own outage before anything records it.
  perform app.sweep_degraded_periods();

  insert into device_heartbeats (device_id, last_seen_at, queue_depth, app_version, is_till, staff_id, venue_id)
  values (p_device_id, now(), greatest(coalesce(p_queue_depth, 0), 0), p_app_version,
          coalesce(p_is_till, false), auth.uid(), app.current_venue(p_device_id))
  on conflict (device_id) do update
     set last_seen_at = excluded.last_seen_at,
         queue_depth  = excluded.queue_depth,
         app_version  = coalesce(excluded.app_version, device_heartbeats.app_version),
         -- Sticky (0026): once a device has identified as a till it stays one.
         is_till      = device_heartbeats.is_till or excluded.is_till,
         staff_id     = excluded.staff_id,
         -- 0130: always equal to stations.venue_id — the resolver above reads
         -- the station row and the 0131 trigger pins it, so nothing here can
         -- move a device between venues; that is a manual `update stations`
         -- until slice 3 gives it an RPC.
         venue_id     = excluded.venue_id;

  -- ...and again now that it is fresh, so recovery closes the period above
  -- rather than waiting for whatever beats next.
  perform app.sweep_degraded_periods();

  return jsonb_build_object('degraded', app.is_degraded(), 'server_time', now());
end $heartbeat_0156$;

revoke all on function app.heartbeat(text, int, text, boolean) from public, anon;
grant execute on function app.heartbeat(text, int, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.consume_pin_grant — 0115:104 ($consume_pin_grant_0115$) verbatim,
--    guard only. Internal: revoked from every client role, as 0115 left it.
-- ---------------------------------------------------------------------------
create or replace function app.consume_pin_grant(p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $consume_pin_grant_0156$
declare
  v_auth uuid;
begin
  -- Same staff guard as the callers: reached only from SECURITY DEFINER money
  -- RPCs, but stated here so the function is safe on its own.
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update app.pin_grants g
     set consumed_at = now()
   where g.id = (
     select id from app.pin_grants
      where caller_id = auth.uid()
        and consumed_at is null
        and created_at > now() - app.pin_grant_ttl()
      order by created_at desc
      limit 1
      for update skip locked)
  returning g.authorizer_id into v_auth;

  if v_auth is null then
    raise exception 'PIN_GRANT_REQUIRED' using errcode = 'P0001';
  end if;
  return v_auth;
end $consume_pin_grant_0156$;

revoke all on function app.consume_pin_grant(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.verify_manager_pin — 0115:143 ($vmp_0115$) verbatim, guard only.
--    The candidate scan (`role in ('manager','owner')`) is whose PIN
--    counts, not who may ask, and stays as it is. 0115 re-issued no
--    grants; these are the 0086:228-229 pair it inherited.
-- ---------------------------------------------------------------------------
create or replace function app.verify_manager_pin(p_pin text, p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $verify_manager_pin_0156$
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
  if app.staff_role() is null then
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

  -- 0115: a CORRECT pin that is weak (0078) is refused like a wrong one — same
  -- padding, same attempt row, same NULL — so the refusal is not an oracle
  -- either. The audit row explains it to the owner; app.set_staff_pin, which
  -- refuses weak PINs, is the way out. Written here, on the returning path.
  if v_id is not null and app.pin_is_weak(p_pin) then
    perform app.write_audit('staff.pin_weak_refused', 'staff', v_id::text, null,
                            jsonb_build_object('scope', 'manager'), null, null, p_device_id);
    v_id := null;
    v_matches := 0;
  end if;

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

  -- 0115: mint the grant the money RPC will consume (app.consume_pin_grant).
  -- This is the returning path, so the row commits with the attempt row.
  if v_id is not null then
    insert into app.pin_grants (caller_id, authorizer_id, device_id)
    values (auth.uid(), v_id, p_device_id);
    -- Housekeeping, bounded: spent or stale rows older than an hour.
    delete from app.pin_grants
     where caller_id = auth.uid()
       and created_at < now() - interval '1 hour';
  end if;

  -- Padded on BOTH outcomes. Padding only the failure would invert the leak:
  -- fast would mean correct.
  perform app.pin_pad_to_floor(v_started);
  return v_id;
end $verify_manager_pin_0156$;

revoke all on function app.verify_manager_pin(text, text) from public, anon;
grant execute on function app.verify_manager_pin(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.set_ticket_status — 0032:493 ($tg_set_ticket$) verbatim; kitchen list.
-- ---------------------------------------------------------------------------
create or replace function app.set_ticket_status(
  p_ticket_id uuid,
  p_status    ticket_status,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_ticket_status_0156$
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.ticket_transition(p_ticket_id, p_status, p_device_id, null);
end $set_ticket_status_0156$;

revoke all on function app.set_ticket_status(uuid, ticket_status, text) from public, anon;
grant execute on function app.set_ticket_status(uuid, ticket_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.set_order_item_ready — 0061:23 ($item_ready_0061$) verbatim; kitchen list.
-- ---------------------------------------------------------------------------
create or replace function app.set_order_item_ready(
  p_order_item_id uuid,
  p_ready         boolean,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_order_item_ready_0156$
declare
  v_oi     order_items%rowtype;
  v_ticket tickets%rowtype;
  v_all    boolean;
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_oi from order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_oi.voided then
    raise exception 'ITEM_VOIDED' using errcode = 'P0001';
  end if;

  select * into v_ticket from tickets where order_id = v_oi.order_id;
  if found and v_ticket.status in ('completed','voided') then
    raise exception 'TICKET_CLOSED' using errcode = 'P0001',
      hint = 'a finished ticket''s marks are history, not state';
  end if;

  if p_ready then
    -- Idempotent: a double-tap (or a replay) keeps the FIRST timestamp.
    update order_items set ready_at = coalesce(ready_at, now())
     where id = p_order_item_id
     returning * into v_oi;
  else
    update order_items set ready_at = null
     where id = p_order_item_id
     returning * into v_oi;
  end if;

  select bool_and(ready_at is not null) into v_all
    from order_items where order_id = v_oi.order_id and not voided;

  return jsonb_build_object(
    'order_item_id',   v_oi.id,
    'ready_at',        v_oi.ready_at,
    'all_items_ready', coalesce(v_all, false),
    'ticket_id',       v_ticket.id);
end $set_order_item_ready_0156$;

revoke all on function app.set_order_item_ready(uuid, boolean, text) from public, anon;
grant execute on function app.set_order_item_ready(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Any-staff policies. Latest definition beside each; only the role test
--     changed. Shape A keeps its 0136/0139 venue conjunct on the whole
--     predicate, shape C on the staff disjunct only (0136 header), and the
--     policies 0136 left alone stay without one.
-- ---------------------------------------------------------------------------

-- cafe_tables (0136:77)
drop policy if exists cafe_tables_staff_read on cafe_tables;
create policy cafe_tables_staff_read on cafe_tables for select to authenticated
  using (app.staff_role() is not null
         and venue_id = any(app.staff_venue_ids()));

-- tabs (0136:95)
drop policy if exists tabs_staff_read on tabs;
create policy tabs_staff_read on tabs for select to authenticated
  using (app.staff_role() is not null
         and venue_id = any(app.staff_venue_ids()));

-- orders (0136:101)
drop policy if exists orders_staff_read on orders;
create policy orders_staff_read on orders for select to authenticated
  using (app.staff_role() is not null
         and venue_id = any(app.staff_venue_ids()));

-- stations (0139:104)
drop policy if exists stations_read_staff on stations;
create policy stations_read_staff on stations
  for select to authenticated
  using (app.staff_role() is not null
         and venue_id = any(app.staff_venue_ids()));

-- order_items (0015:1363)
drop policy if exists order_items_staff_read on order_items;
create policy order_items_staff_read on order_items for select to authenticated
  using (app.staff_role() is not null);

-- order_item_modifiers (0015:1370)
drop policy if exists order_item_modifiers_staff_read on order_item_modifiers;
create policy order_item_modifiers_staff_read on order_item_modifiers
  for select to authenticated
  using (app.staff_role() is not null);

-- venue_settings (0006:65)
drop policy if exists venue_settings_staff_read on venue_settings;
create policy venue_settings_staff_read on venue_settings for select to authenticated
  using (app.staff_role() is not null);

-- promotions (0067:164)
drop policy if exists promotions_staff_read on promotions;
create policy promotions_staff_read on promotions for select to authenticated
  using (app.staff_role() is not null);

-- courts (0136:239)
drop policy if exists courts_read on courts;
create policy courts_read on courts for select to anon, authenticated
  using (is_active or (app.staff_role() is not null
                       and venue_id = any(app.staff_venue_ids())));

-- rate_rules (0136:245)
drop policy if exists rate_rules_read on rate_rules;
create policy rate_rules_read on rate_rules for select to anon, authenticated
  using (is_active or (app.staff_role() is not null
                       and venue_id = any(app.staff_venue_ids())));

-- tax_groups (0136:251)
drop policy if exists tax_groups_read on tax_groups;
create policy tax_groups_read on tax_groups for select to anon, authenticated
  using (is_active or (app.staff_role() is not null
                       and venue_id = any(app.staff_venue_ids())));

-- menu_categories (0136:257)
drop policy if exists menu_categories_read on menu_categories;
create policy menu_categories_read on menu_categories for select to anon, authenticated
  using (is_active or (app.staff_role() is not null
                       and venue_id = any(app.staff_venue_ids())));

-- menu_items (0136:263)
drop policy if exists menu_items_read on menu_items;
create policy menu_items_read on menu_items for select to anon, authenticated
  using (is_active or (app.staff_role() is not null
                       and venue_id = any(app.staff_venue_ids())));

-- modifiers (0013:630)
drop policy if exists modifiers_read on modifiers;
create policy modifiers_read on modifiers for select to anon, authenticated
  using (is_active or app.staff_role() is not null);

-- venues (0122:95)
drop policy if exists venues_read on venues;
create policy venues_read on venues
  for select to anon, authenticated
  using (is_active or app.staff_role() is not null);

-- menu_item_variants (0013:620)
drop policy if exists menu_item_variants_read on menu_item_variants;
create policy menu_item_variants_read on menu_item_variants for select to anon, authenticated
  using (exists (
    select 1 from menu_items mi
     where mi.id = item_id
       and (mi.is_active or app.staff_role() is not null)
  ));

-- rate_rule_prices (0007:86)
drop policy if exists rate_rule_prices_read on rate_rule_prices;
create policy rate_rule_prices_read on rate_rule_prices for select to anon, authenticated
  using (exists (
    select 1 from rate_rules r
     where r.id = rule_id
       and (r.is_active or app.staff_role() is not null)
  ));

-- ---------------------------------------------------------------------------
-- 12. Kitchen policies: prep's list plus the four bar and kitchen roles.
-- ---------------------------------------------------------------------------

-- tickets (0136:107)
drop policy if exists tickets_staff_read on tickets;
create policy tickets_staff_read on tickets for select to authenticated
  using (app.is_staff('prep','cashier','manager','owner','head_barista','barista','head_chef','chef')
         and venue_id = any(app.staff_venue_ids()));

-- realtime.messages kds / floor (0022:172). Guarded exactly as 0022 is: the
-- realtime schema is absent on a bare Postgres, and the policy with it.
do $rt_staff_topics_0156$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent - skipping broadcast RLS policies';
    return;
  end if;

  execute $p$
    drop policy if exists touchpadel_rt_staff_topics on realtime.messages
  $p$;

  execute $p$
    create policy touchpadel_rt_staff_topics on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and realtime.topic() in ('kds','floor')
        and app.is_staff('prep','cashier','manager','owner','head_barista','barista','head_chef','chef')
      )
  $p$;
end $rt_staff_topics_0156$;
