set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0228 (multi-venue audit, 2026-09-26): one branch answer for reads and writes,
-- and never a silent swap to another branch.
--
--   * app.resolve_venue: a station or venue the SERVER asserted (the argument,
--     app.station_id, app.venue_id) that names a closed branch now answers NULL
--     instead of falling through to the headers, the caller's membership or
--     "the only open branch". A 0217 guard that asserted a closed branch's row
--     used to file the refund, tab or order at another branch.
--   * Staff who have no open branch left (not the owner) no longer reach step
--     (4): a closed branch's cashier used to write at the only open branch.
--   * The two operator headers are read in ONE order by both the write path
--     (resolve_venue) and the read path (visible_venue_ids): the station first.
--     A registered till trades for its own branch; the switcher's x-venue-scope
--     counts only on a machine that is not a registered station. A scope the
--     caller may not use is refused (NULL / no rows), never swapped for another
--     branch. The headers are an operator (staff) concept: a guest's are ignored.
--   * The owner reads a closed branch's history again (A2): app.readable_venue_ids
--     is every branch for the owner; the scope header may name a closed branch
--     and 'all' includes closed branches. Writes still never land on one.
--   * 'all:<uuid>' names the branch whose clock and business day the "All
--     branches" figures use (app.analysis_venue): the one the page names.
--   * app.is_staff_at is false for a closed or unknown branch, owner included,
--     so every 0217 guard refuses a closed branch's row with VENUE_MISMATCH.
--   * app.default_venue never returns NULL while any branch exists, so the cron
--     and service-role defaults keep resolving even with no open branch.
--   * anon loses app.current_venue(text) and app.current_venue_or_default():
--     step (1) answered station-id probes and the default branch to anyone.

-- One request header, lower-case name, trimmed; NULL when absent or unreadable.
create or replace function app.req_header(p_name text) returns text
language plpgsql stable security definer set search_path = public as $req_header_0228$
begin
  return nullif(btrim(nullif(current_setting('request.headers', true), '')::json ->> p_name), '');
exception when others then
  return null;
end
$req_header_0228$;

comment on function app.req_header(text) is
  '0228. One PostgREST request header (lower-case name), trimmed; NULL when absent or unreadable. Internal.';

revoke all on function app.req_header(text) from public, anon, authenticated;

-- The branch of the x-station-id header: a live station at a branch that is not
-- closed, counted only for staff who are the owner or a member of that branch.
create or replace function app.header_station_venue() returns uuid
language plpgsql stable security definer set search_path = public as $header_station_venue_0228$
declare
  v_hdr   text;
  v_venue uuid;
begin
  if auth.uid() is null or app.staff_role() is null then
    return null;
  end if;
  v_hdr := app.req_header('x-station-id');
  if v_hdr is null then
    return null;
  end if;
  select s.venue_id into v_venue
    from stations s
    join venues v on v.id = s.venue_id and v.status <> 'closed'
   where s.id = upper(v_hdr)
     and s.retired_at is null;
  if v_venue is not null
     and (app.is_staff('owner')
          or exists (select 1 from staff_venues sv
                      where sv.staff_id = auth.uid() and sv.venue_id = v_venue)) then
    return v_venue;
  end if;
  return null;
end
$header_station_venue_0228$;

comment on function app.header_station_venue() is
  '0228. The branch of the x-station-id header: a live station at a branch that is not closed, for the owner or a member of that branch; else NULL. Internal.';

revoke all on function app.header_station_venue() from public, anon, authenticated;

-- resolve_venue: re-issued from 20260926000226_staff_reads_follow_scope.sql:415
create or replace function app.resolve_venue(p_station_id text default null) returns uuid
language plpgsql stable security definer set search_path = public as $resolve_venue_0228$
declare
  v_station text;
  v_raw     text;
  v_cast    uuid;
  v_venue   uuid;
  v_status  venue_status;
  v_count   int;
  v_hdr     text;
begin
  -- (1) the asserted station. An unregistered or retired id is not an
  -- assertion (a machine that is not a station) and falls through; a live
  -- station at a closed branch answers NULL (0228), never another branch.
  v_station := nullif(coalesce(p_station_id, current_setting('app.station_id', true)), '');
  if v_station is not null then
    select s.venue_id, v.status into v_venue, v_status
      from stations s
      join venues v on v.id = s.venue_id
     where s.id = v_station
       and s.retired_at is null;
    if v_venue is not null then
      if v_status = 'closed' then
        return null;
      end if;
      return v_venue;
    end if;
  end if;

  -- (2) the venue a definer body asserted. 0228: whatever it names is the
  -- answer; a closed, unknown or malformed value is NULL, never a fall-through.
  v_raw := nullif(current_setting('app.venue_id', true), '');
  if v_raw is not null then
    begin
      v_cast := v_raw::uuid;
    exception when invalid_text_representation then
      return null;
    end;
    select v.id into v_venue from venues v where v.id = v_cast and v.status <> 'closed';
    return v_venue;
  end if;

  if auth.uid() is not null and app.staff_role() is not null then
    -- (2b) 0215: the station the operator names on every request. It outranks
    -- the switcher (0228): a registered till works for its own branch.
    v_venue := app.header_station_venue();
    if v_venue is not null then
      return v_venue;
    end if;

    -- (2c) 0226: the branch the switcher names. 0228: a scope the caller may
    -- not use (closed, unknown, not theirs, malformed) is refused, not swapped.
    -- 'all' / 'all:<uuid>' is a read scope and says nothing about writes.
    v_hdr := app.req_header('x-venue-scope');
    if v_hdr is not null and v_hdr <> 'all' and v_hdr not like 'all:%' then
      begin
        v_cast := v_hdr::uuid;
      exception when invalid_text_representation then
        return null;
      end;
      select v.id into v_venue from venues v where v.id = v_cast and v.status <> 'closed';
      if v_venue is not null
         and (app.is_staff('owner')
              or exists (select 1 from staff_venues sv
                          where sv.staff_id = auth.uid() and sv.venue_id = v_venue)) then
        return v_venue;
      end if;
      return null;
    end if;
  end if;

  -- (3) the caller's memberships. Exactly one is an answer; more than one is an
  -- ambiguity the caller has to resolve.
  if auth.uid() is not null then
    select count(*), min(sv.venue_id::text)::uuid into v_count, v_venue
      from staff_venues sv
      join venues v on v.id = sv.venue_id and v.status <> 'closed'
     where sv.staff_id = auth.uid();
    if v_count = 1 then
      return v_venue;
    end if;
    if v_count > 1 then
      return null;
    end if;
    -- 0228: staff with no open branch left work nowhere. Only the owner (who
    -- has no memberships) and non-staff callers go on to (4).
    if app.staff_role() is not null and not app.is_staff('owner') then
      return null;
    end if;
  end if;

  -- (4) one open venue in the database.
  select count(*), min(v.id::text)::uuid into v_count, v_venue
    from venues v
   where v.is_active;
  if v_count = 1 then
    return v_venue;
  end if;

  return null;
end
$resolve_venue_0228$;

-- Every branch the caller may READ history of: the owner every branch, closed
-- ones included (A2); anyone else their branches that are not closed.
create or replace function app.readable_venue_ids() returns uuid[]
language sql stable security definer set search_path = public as $readable_venue_ids_0228$
  select case
    when app.is_staff('owner') then
      coalesce((select array_agg(v.id order by v.created_at, v.id) from venues v), '{}'::uuid[])
    else app.staff_venue_ids()
  end
$readable_venue_ids_0228$;

comment on function app.readable_venue_ids() is
  '0228. The branches a caller may read history of: every branch (closed included) for the owner, else app.staff_venue_ids(). Internal.';

revoke all on function app.readable_venue_ids() from public, anon, authenticated;

-- visible_venue_ids: re-issued from 20260926000226_staff_reads_follow_scope.sql:37
create or replace function app.visible_venue_ids() returns uuid[]
language plpgsql stable security definer set search_path = public as $visible_venue_ids_0228$
declare
  v_hdr     text;
  v_one     uuid;
  v_station uuid;
  v_owner   boolean;
begin
  if app.staff_role() is null then
    return '{}'::uuid[];
  end if;
  v_owner := app.is_staff('owner');
  v_hdr := app.req_header('x-venue-scope');

  -- The owner's "All branches" on a report page: every branch, closed ones too.
  if v_owner and (v_hdr = 'all' or v_hdr like 'all:%') then
    return app.readable_venue_ids();
  end if;

  -- The owner reading a closed branch's history on a report page (A2), from
  -- any machine. Reads only: resolve_venue never files a write at one.
  if v_owner and v_hdr is not null and v_hdr <> 'all' and v_hdr not like 'all:%' then
    begin
      v_one := v_hdr::uuid;
    exception when others then
      v_one := null;
    end;
    if v_one is not null and exists (select 1 from venues v where v.id = v_one and v.status = 'closed') then
      return array[v_one];
    end if;
  end if;

  -- The station on the request outranks the switcher, as in resolve_venue.
  v_station := app.header_station_venue();
  if v_station is not null then
    return array[v_station];
  end if;

  if v_hdr is not null and v_hdr <> 'all' and v_hdr not like 'all:%' then
    begin
      v_one := v_hdr::uuid;
    exception when others then
      return '{}'::uuid[];
    end;
    if v_one = any (app.readable_venue_ids()) then
      return array[v_one];
    end if;
    -- A scope the caller may not read is refused, never swapped for another.
    return '{}'::uuid[];
  end if;

  -- The branch the caller is working at, else every branch of theirs.
  v_one := app.resolve_venue();
  if v_one is not null and v_one = any (app.staff_venue_ids()) then
    return array[v_one];
  end if;
  return app.staff_venue_ids();
end
$visible_venue_ids_0228$;

comment on function app.visible_venue_ids() is
  '0226, 0228. The branches a staff read covers now: the owner''s ''all'' (every branch, closed included); else the live station on the request; else the x-venue-scope branch when the caller may read it (none when not); else the branch the caller is working at; else every branch of theirs. Called by the staff read policies, so granted to every reading role.';

revoke all on function app.visible_venue_ids() from public;
grant execute on function app.visible_venue_ids() to anon, authenticated, service_role;

-- report_venues: re-issued from 20260926000226_staff_reads_follow_scope.sql:85
create or replace function app.report_venues() returns uuid[]
language plpgsql stable security definer set search_path = public as $report_venues_0228$
begin
  -- No caller (service role, cron): every branch.
  if auth.uid() is null then
    return coalesce((select array_agg(v.id order by v.created_at, v.id) from venues v), '{}'::uuid[]);
  end if;
  return app.visible_venue_ids();
end
$report_venues_0228$;

revoke all on function app.report_venues() from public, anon, authenticated;

-- analysis_venue: re-issued from 20260926000214_analytics_stock_settings_per_venue.sql:88.
-- Several branches in scope: the branch 'all:<uuid>' names (the page's own
-- branch, whose clock the note promises), else the station's, else the oldest.
create or replace function app.analysis_venue() returns uuid
language plpgsql stable security definer set search_path = public as $analysis_venue_0228$
declare
  v_r   uuid[];
  v_hdr text;
  v_one uuid;
begin
  v_r := app.report_venues();
  if cardinality(v_r) = 1 then
    return v_r[1];
  end if;
  v_hdr := app.req_header('x-venue-scope');
  if v_hdr like 'all:%' then
    begin
      v_one := substr(v_hdr, 5)::uuid;
    exception when others then
      v_one := null;
    end;
    if v_one = any (v_r) then
      return v_one;
    end if;
  end if;
  v_one := app.header_station_venue();
  if v_one = any (v_r) then
    return v_one;
  end if;
  return coalesce(app.resolve_venue(), app.default_venue());
end
$analysis_venue_0228$;

revoke all on function app.analysis_venue() from public, anon, authenticated;

-- is_staff_at: re-issued from 20260926000222_venue_status_and_stations.sql:98.
-- The owner too needs a branch that exists and is not closed.
create or replace function app.is_staff_at(p_venue uuid, variadic roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $is_staff_at_0228$
  select case
    when not app.is_staff(variadic roles) then false
    when app.is_staff('owner') then
      exists (select 1 from venues v where v.id = p_venue and v.status <> 'closed')
    else exists (select 1
                   from staff_venues sv
                   join venues v on v.id = sv.venue_id and v.status <> 'closed'
                  where sv.staff_id = auth.uid()
                    and sv.venue_id = p_venue)
  end
$is_staff_at_0228$;

-- default_venue: re-issued from 20260921000122_venues.sql. The oldest open
-- branch; with none open, the oldest preparing one, then the oldest of all, so
-- a cron or service-role default never meets NULL while a branch exists.
create or replace function app.default_venue() returns uuid
language sql stable security definer set search_path = public as $default_venue_0228$
  select v.id
    from venues v
   order by (v.status = 'open') desc, (v.status = 'preparing') desc, v.created_at, v.id
   limit 1
$default_venue_0228$;

-- Staff with no membership used to work through step (4); from here they work
-- nowhere. The 0123 trigger files every non-owner at a branch, but a row that
-- slipped past it on a one-branch project would lock that person out of every
-- write the moment this lands. While exactly one branch is not closed, file
-- any such staff member there (their own role), as the trigger would have.
insert into staff_venues (staff_id, venue_id, role)
select s.id, (select v.id from venues v where v.status <> 'closed'), s.role
  from staff s
 where s.role <> 'owner'
   and not exists (select 1 from staff_venues sv where sv.staff_id = s.id)
   and (select count(*) from venues v where v.status <> 'closed') = 1;

-- anon never needed these: every guest insert runs in a definer body.
revoke execute on function app.current_venue(text) from anon;
revoke execute on function app.current_venue_or_default() from anon;
