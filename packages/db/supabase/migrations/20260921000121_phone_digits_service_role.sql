-- ===========================================================================
-- 0121 — app.phone_digits is executable by the service role.
--
-- THE DEFECT. 0116 put `coalesce(app.phone_digits(phone), '')` inside the
-- CHECK constraint profiles_phone_format and granted EXECUTE on
-- app.phone_digits to anon and authenticated, because "a CHECK runs as the
-- writing role". It does — and the service role writes profiles too:
-- functions/send-push (clears dead push tokens), functions/send-sms-otp, the
-- desk's customer tooling, and every test that seeds a profile with
-- serviceClient(). Since 0116 each of those UPDATEs failed with
-- "permission denied for function phone_digits" (0003 revoked the default
-- PUBLIC execute in schema app), which is why analytics-courts, no-show and
-- account-deletion went red in the first local run of the suite (2026-09-21).
-- Inserts through the auth trigger were unaffected: that function is
-- SECURITY DEFINER and evaluates the CHECK as its owner.
--
-- THE FIX. Grant EXECUTE to service_role. Nothing else changes: the function
-- is IMMUTABLE text arithmetic and was already public by design.
--
-- THE RULE (packages/db/CLAUDE.md): a function named in a CHECK constraint,
-- a generated column or a non-definer trigger is granted to EVERY role that
-- writes the table — anon, authenticated AND service_role — never to the
-- client roles alone.
--
-- Hosted never ran 0116 (nothing from 0108 on is there).
-- covered by packages/db/tests/profiles-checks.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

grant execute on function app.phone_digits(text) to service_role;
