set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0155 — six staff roles: head barista, barista, head chef, chef, driver,
-- marketing.
--
-- The bar and kitchen roles (head_barista, barista, head_chef, chef) take the
-- place of `prep`, which is soft-retired: the owner can no longer hand it out,
-- existing prep accounts keep working, and every guard keeps it until none
-- are left. driver and marketing are staff with no station: they sign in,
-- lock, take breaks and send requests, and hold nothing else yet.
--
-- Enum widening is its own file, strictly before its first use
-- (packages/db/CLAUDE.md, Migrations; 0143 is the first): 0156 opens the
-- guards to the new values.
-- ===========================================================================

alter type staff_role add value if not exists 'head_barista';
alter type staff_role add value if not exists 'barista';
alter type staff_role add value if not exists 'head_chef';
alter type staff_role add value if not exists 'chef';
alter type staff_role add value if not exists 'driver';
alter type staff_role add value if not exists 'marketing';
