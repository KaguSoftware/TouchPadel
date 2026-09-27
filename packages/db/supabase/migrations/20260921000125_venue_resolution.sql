-- ===========================================================================
-- 0125 — app.resolve_venue / app.current_venue / app.current_venue_or_default:
-- the one place that answers "which venue is this write for" (multi-venue
-- slice 1, decisions R1 and R3).
--
-- THE RESOLUTION ORDER (Parsa, 2026-09-21), most specific first:
--
--   1. The asserted STATION — the argument, else the app.station_id GUC — if it
--      names an active, un-retired stations row. A till is bolted to a wall in
--      one building; nothing knows better than it does.
--   2. The app.venue_id GUC, if it parses and names an active venue. For
--      server-side callers (edge functions, cron, a future admin session) that
--      have no station.
--   3. The CALLER's staff_venues rows: exactly one active membership -> that
--      venue. More than one -> NULL, on purpose: a manager of two clubs who
--      asserted nothing has not said which, and guessing files a payment at
--      the wrong club.
--   4. Exactly one active venue in the whole database -> that one. This is what
--      keeps production working with ZERO app changes through slice 1, and it
--      is also why slice 1 must never leave a second ACTIVE venue on hosted.
--
-- Otherwise NULL. resolve_venue NEVER RAISES — it is the shared engine, and the
-- caller decides what NULL means:
--
--   * app.current_venue()            raises VENUE_REQUIRED (P0001). It is the
--                                    DEFAULT on 27 business tables (0126), so a
--                                    row with no defensible venue is refused at
--                                    write time instead of filed at a guess.
--   * app.current_venue_or_default() coalesces to app.default_venue(). It is
--                                    the default on the eight tables cron and
--                                    service_role write with no caller
--                                    (audit_log, manager_alerts, the telegram
--                                    and analytics tables, degraded_periods),
--                                    and it backs the zero-arg is_degraded() /
--                                    venue_mode() the guest menu calls before
--                                    any identity exists (R3). A cron tick must
--                                    never raise.
--
-- GRANTS. resolve_venue and default_venue (0122) are SERVICE_ROLE ONLY: no
-- client may ask the server to guess. current_venue and current_venue_or_default
-- are granted to anon, authenticated AND service_role, because a COLUMN DEFAULT
-- is evaluated as the role doing the INSERT — the 0121 trap, where
-- app.phone_digits was granted to the two client roles only and every
-- service-role UPDATE on profiles failed until 0121. They are SECURITY DEFINER,
-- so they reach resolve_venue as their owner without a client grant on it.
--
-- NEITHER GUC IS SETTABLE BY A POSTGREST CLIENT. app.station_id and app.venue_id
-- are custom settings; a client can only reach them through a definer RPC that
-- calls set_config(..., true) itself. In slice 1 the only setter is app.heartbeat
-- (0130); slice 3 adds the same line to each of the 41 RPCs that already take
-- p_device_id.
--
-- Next in this slice: 0126 puts these functions on the columns as defaults.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.resolve_venue — the engine. Returns NULL, never raises.
-- ---------------------------------------------------------------------------
create or replace function app.resolve_venue(p_station_id text default null) returns uuid
language plpgsql stable security definer set search_path = public as $resolve_venue_0125$
declare
  v_station text;
  v_raw     text;
  v_cast    uuid;
  v_venue   uuid;
  v_count   int;
begin
  -- (1) the asserted station.
  v_station := nullif(coalesce(p_station_id, current_setting('app.station_id', true)), '');
  if v_station is not null then
    select s.venue_id into v_venue
      from stations s
      join venues v on v.id = s.venue_id and v.is_active
     where s.id = v_station
       and s.retired_at is null;
    if v_venue is not null then
      return v_venue;
    end if;
  end if;

  -- (2) the asserted venue. A GUC is text, so a malformed value must degrade to
  -- "not asserted" rather than blow up a guest insert.
  v_raw := nullif(current_setting('app.venue_id', true), '');
  if v_raw is not null then
    begin
      v_cast := v_raw::uuid;
    exception when invalid_text_representation then
      v_cast := null;
    end;
    if v_cast is not null then
      select v.id into v_venue from venues v where v.id = v_cast and v.is_active;
      if v_venue is not null then
        return v_venue;
      end if;
    end if;
  end if;

  -- (3) the caller's memberships. Exactly one is an answer; more than one is an
  -- ambiguity the caller has to resolve, so stop here rather than fall through
  -- to (4) and pick the oldest venue for a manager who works at two.
  if auth.uid() is not null then
    select count(*), min(sv.venue_id::text)::uuid into v_count, v_venue
      from staff_venues sv
      join venues v on v.id = sv.venue_id and v.is_active
     where sv.staff_id = auth.uid();
    if v_count = 1 then
      return v_venue;
    end if;
    if v_count > 1 then
      return null;
    end if;
  end if;

  -- (4) one active venue in the database: production, all of slice 1.
  select count(*), min(v.id::text)::uuid into v_count, v_venue
    from venues v
   where v.is_active;
  if v_count = 1 then
    return v_venue;
  end if;

  return null;
end
$resolve_venue_0125$;

comment on function app.resolve_venue(text) is
  '0125: station -> app.venue_id GUC -> the caller''s single membership -> the single active '
  'venue -> NULL. Never raises. Service_role only; clients reach it through app.current_venue '
  'and app.current_venue_or_default, which are definer.';

revoke all on function app.resolve_venue(text) from public, anon, authenticated;
grant execute on function app.resolve_venue(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.current_venue — resolve or refuse. The default on the 27 C tables.
-- ---------------------------------------------------------------------------
create or replace function app.current_venue(p_station_id text default null) returns uuid
language plpgsql stable security definer set search_path = public as $current_venue_0125$
declare
  v_venue uuid;
begin
  v_venue := app.resolve_venue(p_station_id);
  if v_venue is null then
    raise exception 'VENUE_REQUIRED'
      using errcode = 'P0001',
            hint = 'No station asserted and the venue is ambiguous: the caller belongs to more than one venue, or more than one venue is active. Assert a station (app.heartbeat) or pass venue_id explicitly.';
  end if;
  return v_venue;
end
$current_venue_0125$;

comment on function app.current_venue(text) is
  '0125: app.resolve_venue() or VENUE_REQUIRED (P0001). The column default on the 27 tables '
  'written only by identified callers (R1) — a row with no defensible venue is refused, not '
  'guessed. Granted to anon and authenticated because a default runs as the writing role (0121).';

-- The 0121 grant trap: a COLUMN DEFAULT is evaluated as the role doing the
-- INSERT, so every role that writes a venue-scoped table needs EXECUTE — anon
-- (guest sessions, waiter calls), authenticated (staff RPC bodies do run as
-- their definer owner, but direct writes do not) and service_role (tests,
-- fixtures, seeds, the edge functions).
revoke all on function app.current_venue(text) from public;
grant execute on function app.current_venue(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. app.current_venue_or_default — resolve, else the default venue. The
--    default on the eight D tables, and the delegate for the zero-arg
--    is_degraded() / venue_mode() (0137, R3).
-- ---------------------------------------------------------------------------
create or replace function app.current_venue_or_default() returns uuid
language sql stable security definer set search_path = public as $current_venue_or_default_0125$
  select coalesce(app.resolve_venue(), app.default_venue())
$current_venue_or_default_0125$;

comment on function app.current_venue_or_default() is
  '0125: app.resolve_venue() falling back to app.default_venue(). Never raises. The column '
  'default on the eight tables cron and service_role write with no caller (R1), and the delegate '
  'behind the zero-arg app.is_degraded() / app.venue_mode() the guest menu calls before any '
  'identity exists (R3).';

revoke all on function app.current_venue_or_default() from public;
grant execute on function app.current_venue_or_default() to anon, authenticated, service_role;
