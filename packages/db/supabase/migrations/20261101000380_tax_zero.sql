-- 0380 tax_zero — every tax rate is 0 (launch finding F-06, Majed 2026-11-01:
-- "Set all tax to 0").
--
-- Why: an offline tab on the till estimates its total without tax (and
-- without promotions), while the server's app.compute_tab_totals adds each
-- line's tax group rate at replay. With a non-zero rate the cash taken offline
-- is short of what the server records and the gap shows only at Day close.
-- With every rate at 0 the offline estimate and the server total agree.
--
-- What: a data migration, nothing else.
--   * every tax_groups.rate_bp is set to 0, at every branch, active or not
--     ('Restaurant' was seeded at 1000 bp, inactive);
--   * the column default stays 0 (0006) and is restated here, so a group a
--     later branch copy or a hand insert makes without a rate is 0 too;
--   * venue_settings.tax_inclusive keeps its default false (inclusive or not
--     makes no difference at 0).
-- The tax arithmetic itself (0036 post-discount base, 0045 inclusive
-- extraction) is untouched: tests/cafe-money.test.ts still proves it by
-- setting a rate for the length of each test. No CHECK pins the rate to 0, so
-- tax can come back by a migration when the accountant says so.
--
-- seed.sql inserts the same two groups with rate 0 since this migration, so a
-- fresh reset agrees with a migrated project.
--
-- covered by packages/db/tests/tax-zero.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

update tax_groups
   set rate_bp = 0
 where rate_bp <> 0;

alter table tax_groups alter column rate_bp set default 0;

comment on column tax_groups.rate_bp is
  'Basis points (1000 = 10%). 0 for every group since 0380 (F-06: the till''s offline estimate carries no tax, so the server total must not either).';
