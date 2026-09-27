-- 0192 stock_transfer_movement — a movement type for stock moved between the
-- venue's two stores.
--
-- Feature: protocols and the staff phone, wave 5, lane S
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8.6, §2.11, §7.4;
-- Majed's answer #8).
-- Depends on: nothing.
-- Re-runnable: add value if not exists.
--
-- Enum widening is its own file, strictly before its first use
-- (packages/db/CLAUDE.md, Migrations; 0143, 0155 and 0171 are the
-- precedents): stock_locations re-issues trg_low_stock_alert to skip it,
-- stock_transfers writes it and stock_counts_by_location reads it.
--
-- A transfer writes one pair per batch slice, minus at the source store and
-- plus at the destination, so it never changes the venue's on-hand. None of
-- the movement-type-filtered reports lists it (§2.8.6).
--
-- covered by packages/db/tests/stock-transfers.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

alter type movement_type add value if not exists 'transfer';
