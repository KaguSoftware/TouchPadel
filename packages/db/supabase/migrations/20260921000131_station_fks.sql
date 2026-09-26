-- ===========================================================================
-- 0131 — the two live station references become real foreign keys.
--
-- 0124 created the registry and 0130 made the two id-minting RPCs fill it, so
-- every device_heartbeats.device_id and every station_staff.station_id now
-- names a row in stations. This file says so to the database, which is what
-- turns "we are careful" into "it cannot happen": a service_role insert, a
-- fixture, a seed or a future RPC can no longer invent a station id, and 0133
-- can hang the composite (id, venue_id) agreement off these same columns.
--
-- NOT VALID first, then VALIDATE in the same file (0098 precedent): the ADD is
-- a brief ACCESS EXCLUSIVE catalog write, the scan that follows runs under
-- SHARE UPDATE EXCLUSIVE and the till keeps trading through it. Both tables
-- are tens of rows. The guarded DO block (shape 0092:64-76) makes a re-run of
-- this file a no-op rather than an error.
--
-- NO FOREIGN KEY ON staff_breaks.station_id, DELIBERATELY. A break is history:
-- it records where somebody stood on a Tuesday in March, and a station that
-- has since been dismantled must not make that row unwritable — nor must the
-- station become undeletable because a two-year-old break mentions it. The
-- column carries no constraint of its own either (0105:220-234): its shape is
-- enforced by the RPCs that write it, app.start_break and app.cover_station,
-- which take the station from the caller's own break screen. It gains a
-- comment saying the absence is a decision, not an oversight, so the next
-- reader does not "fix" it.
--
-- staff_breaks also gets venue_id (slice 1's 35-table list), so a break is
-- still answerable per venue without walking through stations.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The two FKs, NOT VALID inside an idempotent guard.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'device_heartbeats_station_fkey' and conrelid = 'device_heartbeats'::regclass) then
    alter table device_heartbeats
      add constraint device_heartbeats_station_fkey
      foreign key (device_id) references stations(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'station_staff_station_fkey' and conrelid = 'station_staff'::regclass) then
    alter table station_staff
      add constraint station_staff_station_fkey
      foreign key (station_id) references stations(id) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Validate: a scan under SHARE UPDATE EXCLUSIVE, not a lock-out.
-- ---------------------------------------------------------------------------
alter table device_heartbeats validate constraint device_heartbeats_station_fkey;
alter table station_staff     validate constraint station_staff_station_fkey;

-- ---------------------------------------------------------------------------
-- 3. The one that is NOT an FK, and why.
-- ---------------------------------------------------------------------------
comment on column staff_breaks.station_id is
  '0105: the station the person was covering. 0131: deliberately NOT a foreign '
  'key to stations(id) — a break row is history and must outlive the station it '
  'names, both ways round: retiring or renaming a till may not make old breaks '
  'unwritable, and an old break may not keep a dismantled station alive. The '
  'shape is enforced by the RPCs that write it (app.start_break / '
  'app.cover_station), and the venue is answered by staff_breaks.venue_id, not '
  'by a join.';

-- ---------------------------------------------------------------------------
-- 4. Direct writers of device_heartbeats register the station themselves.
--
-- app.heartbeat (0130) is the production writer and registers before it
-- upserts. But the row is also written directly as service_role: the e2e
-- helper's TILL-E2E, tests/degraded.test.ts, the RLS probe. Without this
-- trigger every one of them now dies on device_heartbeats_station_fkey with
-- a raw 23503. The registry is the source of truth for the venue: an existing
-- station pins new.venue_id to its own venue (0133's composite FK demands they
-- agree); an unknown one is registered at the venue the row names, else at the
-- venue the caller resolves to, else the default venue. A retired station that
-- beats again is un-retired, as in 0130.
-- ---------------------------------------------------------------------------
create or replace function app.trg_device_heartbeats_station() returns trigger
language plpgsql security definer set search_path = public as $trg_device_heartbeats_station_0131$
declare
  v_venue uuid;
begin
  select s.venue_id into v_venue from stations s where s.id = new.device_id;
  if v_venue is not null then
    update stations set retired_at = null,
                        is_till = is_till or coalesce(new.is_till, false)
     where id = new.device_id and retired_at is not null;
    new.venue_id := v_venue;
    return new;
  end if;
  v_venue := coalesce(new.venue_id, app.current_venue_or_default());
  insert into stations (id, venue_id, is_till, registered_by)
  values (new.device_id, v_venue,
          coalesce(new.is_till, false) or new.device_id like 'TILL%',
          new.staff_id)
  on conflict (id) do nothing;
  new.venue_id := v_venue;
  return new;
end $trg_device_heartbeats_station_0131$;

revoke all on function app.trg_device_heartbeats_station() from public, anon, authenticated;

drop trigger if exists device_heartbeats_station on device_heartbeats;
create trigger device_heartbeats_station
  before insert on device_heartbeats
  for each row execute function app.trg_device_heartbeats_station();
