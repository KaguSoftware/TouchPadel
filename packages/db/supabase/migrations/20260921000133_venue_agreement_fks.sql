-- ===========================================================================
-- 0133 — a child row and its parent must agree about the venue (decision R9).
--
-- The denormalised venue_id added in 0126 is a fact repeated in two places. A
-- repeated fact drifts: a court_id from venue A on a reservation stamped venue
-- B is a single wrong parameter away, and nothing in slice 1 re-reads the
-- parent to check. The cheapest possible detector is the database's own — a
-- FOREIGN KEY on the PAIR, referencing the (id, venue_id) keys 0132 created.
-- Postgres then refuses the mismatch with 23503 at write time, in every path
-- at once: RPCs, service_role inserts, fixtures, seeds and whatever slice 3
-- adds. No trigger, so no new lock-order surface and no walk into the 0121
-- grant trap (a trigger function runs as the WRITING role and would need a
-- grant to anon, authenticated and service_role alike).
--
-- Six edges, chosen because each is a real cross-venue mistake somebody could
-- make, not because the column exists:
--
--   reservations(court_id, venue_id)       -> courts        booking a court at the other site
--   tabs(reservation_id, venue_id)         -> reservations  charging a tab to the other site's booking
--   orders(tab_id, venue_id)               -> tabs          an order on the other site's tab
--   guest_sessions(table_id, venue_id)     -> cafe_tables   a QR session bound to the other site's table
--   station_staff(station_id, venue_id)    -> stations      cover assigned across sites
--   device_heartbeats(device_id, venue_id) -> stations      a till beating for the wrong venue
--
-- MATCH SIMPLE (the default) matters for tabs: reservation_id is nullable — a
-- cafe tab has no booking — and under MATCH SIMPLE a row with any NULL in the
-- referencing columns satisfies the constraint outright. That is the behaviour
-- wanted; MATCH FULL would refuse every cafe tab.
--
-- venue_id itself is nullable in slice 1 (R5: a validated CHECK, no SET NOT
-- NULL until slice 2), so the same rule covers the moment between 0126 and
-- 0127 if this file were ever re-run against a half-backfilled table.
--
-- NOT VALID inside an idempotent guard (shape 0092:64-76), then VALIDATE in
-- the same file (0098 precedent). Validation is free while one venue exists:
-- every row carries the same venue_id, so every pair matches by construction.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The six pair FKs, NOT VALID.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_court_venue_fkey' and conrelid = 'reservations'::regclass) then
    alter table reservations
      add constraint reservations_court_venue_fkey
      foreign key (court_id, venue_id) references courts (id, venue_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tabs_reservation_venue_fkey' and conrelid = 'tabs'::regclass) then
    alter table tabs
      add constraint tabs_reservation_venue_fkey
      foreign key (reservation_id, venue_id) references reservations (id, venue_id)
      match simple not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_tab_venue_fkey' and conrelid = 'orders'::regclass) then
    alter table orders
      add constraint orders_tab_venue_fkey
      foreign key (tab_id, venue_id) references tabs (id, venue_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guest_sessions_table_venue_fkey' and conrelid = 'guest_sessions'::regclass) then
    alter table guest_sessions
      add constraint guest_sessions_table_venue_fkey
      foreign key (table_id, venue_id) references cafe_tables (id, venue_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'station_staff_station_venue_fkey' and conrelid = 'station_staff'::regclass) then
    alter table station_staff
      add constraint station_staff_station_venue_fkey
      foreign key (station_id, venue_id) references stations (id, venue_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'device_heartbeats_device_venue_fkey' and conrelid = 'device_heartbeats'::regclass) then
    alter table device_heartbeats
      add constraint device_heartbeats_device_venue_fkey
      foreign key (device_id, venue_id) references stations (id, venue_id) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Validate — SHARE UPDATE EXCLUSIVE, and every existing pair already agrees.
-- ---------------------------------------------------------------------------
alter table reservations      validate constraint reservations_court_venue_fkey;
alter table tabs              validate constraint tabs_reservation_venue_fkey;
alter table orders            validate constraint orders_tab_venue_fkey;
alter table guest_sessions    validate constraint guest_sessions_table_venue_fkey;
alter table station_staff     validate constraint station_staff_station_venue_fkey;
alter table device_heartbeats validate constraint device_heartbeats_device_venue_fkey;
