-- 0171 product_test_movement — the stock ledger's product-test movement.
--
-- Feature: protocols and the staff phone, lane E
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.9, §2.2).
-- Depends on: nothing. product_release (E) is the first file that uses the
-- value: its test step consumes a new item's trial servings through
-- app.consume_fefo(…, 'product_test', …), so they show in the ledger and the
-- count differences as a product test, not as waste or a sale.
-- Re-runnable: add value if not exists.
--
-- An enum widening is its own migration, landing strictly before the file
-- that uses the value (packages/db/CLAUDE.md; the 0143 and 0155 precedents):
-- Postgres refuses a new value in the transaction that added it.

set lock_timeout = '3s';
set statement_timeout = '60s';

alter type movement_type add value if not exists 'product_test';
