set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0143 — Touch Shop (Phase 2 item 5): the `retail` ingredient kind.
--
-- A retail product is a menu item in a `kind = 'shop'` category (0144); each
-- sellable size/colour is a menu_item_variants row that owns exactly one
-- `retail` ingredient (unit `pc`, one recipe line of qty 1). That keeps the
-- whole tab -> settle -> refund -> day close -> report path and the FEFO
-- stock ledger unchanged; the kind only lets the stock screens and the
-- availability rule tell a racket from a coffee bean.
--
-- Enum widening is its own file, strictly before its first use
-- (packages/db/CLAUDE.md, Migrations): 0144 onward use the value.
-- ===========================================================================

alter type ingredient_kind add value if not exists 'retail';
