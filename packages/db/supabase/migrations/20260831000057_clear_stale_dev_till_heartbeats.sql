-- 0057 — clear stale development till heartbeats.
--
-- WHY: app.is_degraded() (0026) is "a till row exists in device_heartbeats AND
-- none of them is fresh". Nothing is installed at the venue yet, but the operator
-- app was run against this project during development, so a till row exists and
-- has been stale ever since. Result: every guest — mobile and web — has been in
-- degraded mode (desk-only horizon, amber "venue connection lost" banners, holds
-- refused with DEGRADED_LOCKOUT) since that session closed. Verified 2026-08-31:
-- `select app.is_degraded()` on the hosted project returned true with no till
-- running.
--
-- This is a one-off DATA fix, not a semantic change: with no till rows the
-- function returns false ("no till installed"), which is the intended pre-launch
-- state. Once the real till heartbeats, the contract behaviour resumes unchanged.
--
-- Safety: nothing references device_heartbeats by foreign key; a till that has
-- beaten within the last hour is left alone (so a live station is never wiped);
-- idempotent; a no-op on fresh local/CI databases.
--
-- GOTCHA (recorded in HANDOFF.md): running the operator app against the hosted
-- project and closing it re-creates exactly this state 45 s later. Until a real
-- till is installed, re-run this delete (or keep the operator open) when testing
-- the guest apps against production.

delete from device_heartbeats
 where (is_till or device_id like 'TILL%')
   and last_seen_at < now() - interval '1 hour';

-- Close the open degraded_periods row now that the venue is no longer degraded;
-- otherwise it waits for the next heartbeat/sweep to notice.
select app.sweep_degraded_periods();
