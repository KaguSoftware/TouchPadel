set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0392 — the `dev` staff role (Majed, 2026-11-01, launch findings F-15/F-26).
--
-- The developer who looks after the system: they sign in to the operator and
-- open the Monitoring page (0393), and hold nothing else. Like driver and
-- marketing (0155) they get the any-staff baseline (sign-in, the idle-lock
-- PIN, requests) through the role-agnostic guards 0156 made, and no guard that
-- names its roles admits them. The owner creates the account on the Staff page.
--
-- Enum widening is its own file, strictly before its first use (0393).
-- ===========================================================================

alter type staff_role add value if not exists 'dev';
