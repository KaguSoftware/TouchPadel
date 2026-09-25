-- 0175 event_block_run_index — one partial index on reservations for a tournament's
-- event blocks.
--
-- Feature: protocols and the staff phone, lane F
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.11, §2.1 "Indexes").
-- Depends on: event_court_blocks (F: reservations.protocol_run_id).
--
-- MIGRATION-RISK-ACCEPTED: one partial index on reservations, in its own file
-- (the 0135 precedent). Every row existing when it lands has protocol_run_id
-- NULL, so the build writes no entry, and the table is thousands of rows at
-- one venue; the SHARE lock lasts as long as the scan of those rows.
--
-- Why: tournament_context, the courts check, the stop hook and
-- block_courts_for_event each look a run's blocks up by protocol_run_id.

set lock_timeout = '3s';
set statement_timeout = '60s';

create index if not exists reservations_protocol_run_idx
  on reservations (protocol_run_id)
  where protocol_run_id is not null;
