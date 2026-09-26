set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0215_station_header_venue — multi-venue slice 3, step 1.
--
-- The operator is a station: every request it makes is on behalf of one till,
-- desk or kitchen board, and the station belongs to one branch (0124, 0130).
-- Until now the server learned that only when heartbeat set app.station_id for
-- its own transaction, so any other RPC resolved the caller's venue from their
-- memberships alone: right for a cashier who works at one branch, VENUE_REQUIRED
-- for the owner or a manager at two.
--
-- Rather than re-issue every one of the ~45 RPCs that take p_device_id to
-- set_config('app.station_id') (the plan's first shape), the operator names its
-- station on EVERY request in an `x-station-id` header, which PostgREST exposes
-- as the request.headers setting, and app.resolve_venue reads it. It is exactly
-- as client-asserted as p_device_id already is, it also reaches column defaults
-- and bodies that never took p_device_id, and it needs no change to the RPCs.
--
-- Resolution order (app.resolve_venue, 0125 body, one step added):
--   1. the station asserted by the argument or app.station_id (heartbeat)
--   2. app.venue_id, asserted by a definer body about the row it works on
--   2b. NEW: the x-station-id request header, counted only when the caller is
--       the owner or holds a membership at that station's branch, so a header
--       cannot steer a write into a branch the caller does not work at
--   3. the caller's only membership
--   4. the only active venue
-- The server's own assertion (2) wins over the client's header (2b): a body
-- that set app.venue_id to the court or tab it is writing keeps that branch.

-- resolve_venue: re-issued from 20260921000125_venue_resolution.sql:62
create or replace function app.resolve_venue(p_station_id text default null) returns uuid
language plpgsql stable security definer set search_path = public as $resolve_venue_0215$
declare
  v_station text;
  v_raw     text;
  v_cast    uuid;
  v_venue   uuid;
  v_count   int;
  v_hdr     text;
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

  -- (2b) 0215: the station the operator names on every request (x-station-id,
  -- exposed by PostgREST in request.headers). Counted only for the owner or a
  -- member of that station's branch.
  begin
    v_hdr := nullif(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-station-id'), '');
  exception when others then
    v_hdr := null;
  end;
  if v_hdr is not null and auth.uid() is not null then
    select s.venue_id into v_venue
      from stations s
      join venues v on v.id = s.venue_id and v.is_active
     where s.id = v_hdr
       and s.retired_at is null;
    if v_venue is not null
       and (app.is_staff('owner')
            or exists (select 1 from staff_venues sv
                        where sv.staff_id = auth.uid() and sv.venue_id = v_venue)) then
      return v_venue;
    end if;
    v_venue := null;
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
$resolve_venue_0215$;

