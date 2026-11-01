set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0398 retired_station_wall — a retired station loses everything on the
-- server too, and the idle-lock timeout is the owner's alone (Majed,
-- 2026-11-01, launch findings F-49 and F-48).
--
--   1. F-49. 0397 told a retired station it was retired, and the operator
--      replaced its screen; the server still took whatever such a machine
--      sent, including writes it had queued before retirement and replayed
--      after (a retired id resolves like an unregistered machine, so they
--      landed at the person's branch). From here a request whose
--      x-station-id names a RETIRED station (stations.retired_at set) is
--      refused with STATION_RETIRED (P0001, detail the station id):
--        - every /rpc/ call except the few the retired screen itself needs
--          (heartbeat, to learn it is retired or registered again;
--          register_station, the way back; verify_manager_pin and
--          verify_own_pin, the PIN of the Quit and Register steps;
--          report_event, the dev monitoring panel);
--        - every table write (POST, PATCH, PUT, DELETE outside /rpc/);
--      in app.pre_request (re-issued from its latest body, 0384, with the
--      one addition), which PostgREST runs before every API request, the
--      replay and receipt-scan edge functions' calls included: a queued write
--      replaying after retirement reaches app.queued_rpc or its money RPC as
--      the staff session with the queued station's header, and is refused
--      there. Replay records that refusal like any deterministic one (a
--      failed row the manager sees at Day close), and also checks the station
--      itself before dispatch, so the wall holds while the hook is missing.
--      app.queued_rpc_claim (0395) checks it as well. Table reads stay open:
--      the retired screen reads who is signed in.
--   2. F-48. app.set_cafe_setting (latest 0209) refuses till_idle_lock_seconds
--      to anyone but the owner (FORBIDDEN, detail "<key> is owner-only"), so a
--      manager cannot change it through the RPC or set_cafe_settings (which
--      calls it per key). The registry row in app.cafe_setting_specs (latest
--      0355) is deliberately NOT re-issued: re-creating that whole VALUES list
--      in a parallel pass would undo any other change to it; its min_role
--      'manager' stays and only means a manager may READ the value
--      (cafe_settings_mgmt_read), which the Settings page shows read-only.
--
-- covered by packages/db/tests/retired-station-wall.test.ts

-- ===========================================================================
-- 1. Is this request from a retired station?
-- ===========================================================================
create or replace function app.request_station_retired()
returns text
language plpgsql stable security definer set search_path = public as $request_station_retired_0398$
declare
  v_id text;
begin
  v_id := app.req_header('x-station-id');
  if v_id is null then
    return null;
  end if;
  if exists (select 1 from stations where id = v_id and retired_at is not null) then
    return v_id;
  end if;
  return null;
end $request_station_retired_0398$;

comment on function app.request_station_retired() is
  '0398 (F-49). The x-station-id of this request when it names a retired station (stations.retired_at set), else NULL. Internal: app.pre_request and app.queued_rpc_claim.';

revoke all on function app.request_station_retired() from public, anon, authenticated;

-- The RPCs a retired station may still call: its own screen's needs.
create or replace function app.retired_station_rpcs()
returns text[]
language sql immutable set search_path = public as $retired_station_rpcs_0398$
  select array['heartbeat', 'register_station', 'verify_manager_pin', 'verify_own_pin', 'report_event']::text[]
$retired_station_rpcs_0398$;

comment on function app.retired_station_rpcs() is
  '0398 (F-49). The only /rpc/ calls app.pre_request lets through from a retired station: learning it is retired or registered again, registering again, the PINs of those steps, and dev monitoring.';

revoke all on function app.retired_station_rpcs() from public, anon, authenticated;

-- ===========================================================================
-- 2. app.pre_request — the 0384 body verbatim plus the retired-station wall.
-- ===========================================================================
create or replace function app.pre_request() returns void
language plpgsql stable security definer set search_path = public as $pre_request_0398$
declare
  v_path    text;
  v_rpc     text;
  v_no      boolean := false;
  v_retired text;
  v_method  text;
begin
  v_path := current_setting('request.path', true);

  -- 0398 (F-49): a retired station loses everything but its way back. Checked
  -- for any caller with a JWT; a fault here lets the request through, like
  -- the rest of the hook (the client lockout and replay's own check stand).
  if auth.uid() is not null then
    begin
      v_retired := app.request_station_retired();
    exception when others then
      v_retired := null;
    end;
    if v_retired is not null then
      v_method := upper(coalesce(current_setting('request.method', true), 'GET'));
      if v_path is not null and left(v_path, 5) = '/rpc/' then
        if not (split_part(substr(v_path, 6), '/', 1) = any (app.retired_station_rpcs())) then
          raise exception 'STATION_RETIRED' using errcode = 'P0001', detail = v_retired,
            hint = 'register this station again in Settings > Stations';
        end if;
      elsif v_method in ('POST', 'PATCH', 'PUT', 'DELETE') then
        raise exception 'STATION_RETIRED' using errcode = 'P0001', detail = v_retired,
          hint = 'register this station again in Settings > Stations';
      end if;
    end if;
  end if;

  if v_path is null or left(v_path, 5) <> '/rpc/' or auth.uid() is null then
    return;
  end if;
  v_rpc := split_part(substr(v_path, 6), '/', 1);
  begin
    v_no := app.area_blocked_rpc(v_rpc);
  exception when others then
    -- Never take the API down for the hook's own fault: the RPC's role and
    -- branch guards still stand.
    v_no := false;
  end;
  if v_no then
    raise exception 'AREA_BLOCKED' using errcode = 'P0001', detail = v_rpc,
      hint = 'the owner blocked this page for this person (Staff > Access)';
  end if;
end $pre_request_0398$;

comment on function app.pre_request() is
  '0384 (F-16), 0398 (F-49). PostgREST pre-request hook (authenticator pgrst.db_pre_request): refuses every /rpc/ call but app.retired_station_rpcs() and every table write from a retired station (STATION_RETIRED, detail the station id); refuses /rpc/<name> with AREA_BLOCKED (detail <name>) when app.area_blocked_rpc(<name>) is true. Does nothing for guests and service-role calls; a fault inside it lets the request through.';

revoke all on function app.pre_request() from public;
grant execute on function app.pre_request() to anon, authenticated, service_role;

-- ===========================================================================
-- 3. app.queued_rpc_claim — the 0395 body plus the same wall.
-- ===========================================================================
create or replace function app.queued_rpc_claim(p_key text, p_fn text)
returns jsonb
language plpgsql security definer set search_path = public as $queued_rpc_claim_0398$
declare
  v_retired text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_retired := app.request_station_retired();
  if v_retired is not null then
    raise exception 'STATION_RETIRED' using errcode = 'P0001', detail = v_retired;
  end if;
  if p_fn is null or not (p_fn = any (app.queueable_rpcs())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'not a queueable RPC';
  end if;
  if p_key is null or p_key !~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*:rpc\.queued:[0-9A-HJKMNP-TV-Z]{26}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  return app.claim_replay(p_key, 'queued:' || p_fn);
end $queued_rpc_claim_0398$;

revoke all on function app.queued_rpc_claim(text, text) from public, anon;
grant execute on function app.queued_rpc_claim(text, text) to authenticated;

-- ===========================================================================
-- 4. app.set_cafe_setting — the 0209 body verbatim plus the owner-only key.
-- ===========================================================================
create or replace function app.set_cafe_setting(
  p_key      text,
  p_value    jsonb,
  p_venue_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_cafe_setting_0398$
declare
  v_role  staff_role := app.staff_role();
  v_venue uuid;
  v_spec  record;
  v_value jsonb := coalesce(p_value, 'null'::jsonb);   -- SQL NULL from PostgREST == JSON null
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager','owner') then
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

  -- 0398 (F-48): the idle-lock timeout is the owner's, whatever the registry
  -- row says (it is not re-issued here; see the header).
  if v_spec.key = 'till_idle_lock_seconds' and v_role <> 'owner' then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = format('%s is owner-only', p_key);
  end if;

  if v_role = 'manager' then
    if p_key = 'featured_discount_pct'
       and v_value is distinct from app.cafe_setting('featured_discount_pct', v_venue)
       and v_value <> '0'::jsonb then
      raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
    if p_key = 'featured_item_id'
       and lower(v_value #>> '{}') is distinct from lower(app.cafe_setting_text('featured_item_id', v_venue))
       and coalesce(app.cafe_setting_int('featured_discount_pct', v_venue), 0) > 0 then
      raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
    if p_key = 'hero_mode'
       and v_value = '"featured"'::jsonb
       and app.cafe_setting_text('hero_mode', v_venue) is distinct from 'featured'
       and coalesce(app.cafe_setting_int('featured_discount_pct', v_venue), 0) > 0 then
      raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
  end if;

  return app.set_cafe_setting_internal(p_key, p_value, v_venue);
end $set_cafe_setting_0398$;

comment on function app.set_cafe_setting(text, jsonb, uuid) is
  '0029/0177, 0209, 0398. Manager or owner at the branch (p_venue_id; default the caller''s resolved venue): write one cafe setting. Owner-only keys (and till_idle_lock_seconds since 0398, F-48) refuse a manager; a manager''s featured-discount changes that would give a discount raise PRICE_VIA_PROTOCOL (#57), judged against that branch''s values.';

revoke all on function app.set_cafe_setting(text, jsonb, uuid) from public, anon;
grant execute on function app.set_cafe_setting(text, jsonb, uuid) to authenticated;
