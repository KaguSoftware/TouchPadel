-- SECURITY FIX (found by the RLS matrix suite on staging): app.is_staff()
-- returned NULL for non-staff principals (staff_role() is NULL, and
-- NULL = any(...) is NULL). Guards written as `if not app.is_staff(...)` then
-- evaluate to NULL — condition not taken — and a guest sails straight into the
-- body of staff-only RPCs (reaching RESERVATION_NOT_FOUND / INVALID_RANGE
-- instead of FORBIDDEN). coalesce to false closes the hole for every caller.
-- 0003 amended in place for fresh environments; this re-applies for staging.

create or replace function app.is_staff(variadic roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app.staff_role() = any(roles), false)
$$;
