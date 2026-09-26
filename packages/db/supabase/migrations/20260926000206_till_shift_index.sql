-- 0206 till_shift_index — the two partial indexes a till shift's sums read by.
--
-- Feature: protocols and the staff phone, wave 5, lane T
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.9.5).
-- Depends on: till_shifts (T: payments.till_shift_id and refunds.till_shift_id).
-- Re-runnable: create index if not exists.
--
-- app.till_shift_figures sums the payments and the refunds that carry one
-- shift, at every close, every status read and every open shift in
-- till_shift_list. Both indexes are partial on "carries a shift", so every
-- row written before till_shifts (all null, "outside a shift") stays out of
-- them, and each build scans a table of hundreds to low thousands of rows.
-- In their own file because they index existing money tables (the 0135
-- precedent), not the new, empty one.
--
-- MIGRATION-RISK-ACCEPTED: partial index on a small table, momentary SHARE lock
-- — two plain CREATE INDEX statements, not CONCURRENTLY, which cannot run
-- inside the transaction Supabase wraps each migration in. Each SHARE lock on
-- payments or refunds lasts milliseconds, and lock_timeout = '3s' aborts the
-- file rather than stall the till; push outside trading hours or re-run (§7.5).

set lock_timeout = '3s';
set statement_timeout = '60s';

create index if not exists payments_till_shift
  on payments (till_shift_id) where till_shift_id is not null;

create index if not exists refunds_till_shift
  on refunds (till_shift_id) where till_shift_id is not null;

comment on index payments_till_shift is
  'till_shift_index: the payments carrying a till shift (app.till_shift_figures). Partial: rows outside a shift are not in it.';
comment on index refunds_till_shift is
  'till_shift_index: the refunds carrying a till shift (app.till_shift_figures). Partial: rows outside a shift are not in it.';
