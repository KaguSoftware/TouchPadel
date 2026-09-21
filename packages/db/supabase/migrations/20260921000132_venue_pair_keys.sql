-- ===========================================================================
-- 0132 — (id, venue_id) pair keys: the targets the composite FKs need.
--
-- WHY A REDUNDANT-LOOKING INDEX. 0133 wants Postgres itself to refuse a
-- reservation on a court at the other venue, a tab against a booking at the
-- other venue, an order on a tab at the other venue, and so on — a FOREIGN KEY
-- on the PAIR (child.parent_id, child.venue_id) -> parent (id, venue_id). A
-- foreign key may only reference a UNIQUE or PRIMARY KEY constraint or a
-- unique index, and "(id, venue_id)" is not one: id alone is the primary key.
-- The pair is trivially unique because id already is — that is exactly the
-- point. The index is not there to be selective, it is there to be a
-- referencable key, so that the child row and the parent row cannot disagree
-- about which building they are in.
--
-- Five parents, one per composite FK in 0133: courts, reservations, tabs,
-- cafe_tables, stations.
--
-- MIGRATION-RISK-ACCEPTED: five CREATE UNIQUE INDEX statements, not
-- CONCURRENTLY. CONCURRENTLY cannot run inside a transaction block and
-- Supabase wraps every migration file in one, so the choice is a plain index
-- or no migration at all. The exposure is a SHARE lock — writers blocked, not
-- readers — for the length of each build, on tables the client's project holds
-- in the hundreds of rows: courts 6, cafe_tables ~20, stations ~5, plus
-- reservations and tabs, the two that actually grow. At that size each build
-- is milliseconds, well inside the 3 s lock_timeout that would abort the file
-- rather than queue the till behind it. The alternative — five more migration
-- files, each doing one CONCURRENTLY outside a transaction — buys nothing on
-- a database this size and costs five more things to get wrong. The same
-- acceptance covers 0134 and 0135; the waiver is given locally through
-- MIGRATION_RISK_ACCEPTED because check:migrations on a push to main judges
-- zero files (decision R11).
--
-- `if not exists` so a re-run is a no-op. The names end in _key, not _idx:
-- they are keys, and pg_constraint will name the FKs after them in error
-- messages.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- courts <- reservations(court_id, venue_id)
create unique index if not exists courts_id_venue_key
  on courts (id, venue_id);

-- reservations <- tabs(reservation_id, venue_id)
create unique index if not exists reservations_id_venue_key
  on reservations (id, venue_id);

-- tabs <- orders(tab_id, venue_id)
create unique index if not exists tabs_id_venue_key
  on tabs (id, venue_id);

-- cafe_tables <- guest_sessions(table_id, venue_id)
create unique index if not exists cafe_tables_id_venue_key
  on cafe_tables (id, venue_id);

-- stations <- station_staff(station_id, venue_id), device_heartbeats(device_id, venue_id)
create unique index if not exists stations_id_venue_key
  on stations (id, venue_id);
