-- 0150_my_reservations: let a guest see whether their own booking is paid.
--
-- WHAT. `app.my_reservations(p_reservation_id)` returns the caller's own
-- reservations -- the columns the mobile app already reads, plus `cancelled_at`
-- -- and two figures it could not get at all: `court_paid_iqd` and
-- `court_remaining_iqd`. Passing an id narrows it to that one booking; passing
-- null lists them.
--
-- WHY cancelled_at. The guest app's "Clear history" hides everything that was
-- already history when it was tapped. It judged that on `end_at`, which is
-- wrong for a booking CANCELLED for a slot that has not happened yet: the app
-- files it under past (terminal status) while its end is still in the future,
-- so the cut never reached it and clearing appeared to do nothing. 0075 set
-- cancelled_at for exactly this question -- "the booking is over from this
-- moment" -- and sets it for cancelled, no_show and completed alike.
--
-- WHY. The guest app showed "Pay at the desk" on every booking it ever
-- rendered, including ones already paid for, because nothing in its reach says
-- otherwise (owner, 2026-09-22). `reservations` carries `price_iqd` -- what it
-- COSTS -- and no record of payment; payment lives on `tabs`/`payments`, which
-- are staff-only by RLS (0015: "money surfaces: staff only, never guests"), and
-- the two helpers that do the arithmetic are revoked from anon and
-- authenticated (0106:151-152). `booking_bill` and `booking_bill_states` both
-- raise FORBIDDEN for a non-staff caller. So there was no client-side fix.
--
-- GUARD. This is the mirror image of the staff readers: instead of
-- `app.is_staff(...)` the predicate is `r.guest_id = auth.uid()`, inside the
-- function, because a security definer bypasses the RLS that would otherwise
-- enforce it. An anon caller (auth.uid() is null) matches no row and gets an
-- empty set rather than an exception -- the same thing the table read did.
--
-- WHY TWO FIGURES AND NOT A BOOLEAN. `court_fee_remaining` returns 0 for a
-- booking that is merely `pending`, so "remaining = 0" alone reads as paid on a
-- booking nobody has paid for. The client tests `remaining = 0 AND paid > 0`,
-- and a partly-paid booking stays describable instead of collapsing to a
-- yes/no the desk would have to explain.
--
-- WHAT IS NOT EXPOSED. No tab, no payment row, no method, no who took it, no
-- cafe line. Two integers about the court fee on the caller's own booking.
--
-- Posture: one new function, no table change, no policy change, no lock taken.

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.my_reservations(p_reservation_id uuid default null)
returns table (
  id                  uuid,
  court_id            uuid,
  kind                text,
  status              text,
  start_at            timestamptz,
  end_at              timestamptz,
  price_iqd           bigint,
  hold_expires_at     timestamptz,
  cancelled_by        text,
  cancelled_at        timestamptz,
  court_paid_iqd      bigint,
  court_remaining_iqd bigint
)
language sql stable security definer set search_path = public as $my_reservations_0150$
  select r.id,
         r.court_id,
         r.kind::text,
         r.status::text,
         r.start_at,
         r.end_at,
         r.price_iqd::bigint,
         r.hold_expires_at,
         r.cancelled_by::text,
         r.cancelled_at,
         app.court_fee_paid(r.id)      as court_paid_iqd,
         app.court_fee_remaining(r.id) as court_remaining_iqd
    from reservations r
   where auth.uid() is not null
     and r.guest_id = auth.uid()
     and (p_reservation_id is null or r.id = p_reservation_id)
   order by r.start_at desc
   limit 100
$my_reservations_0150$;

revoke all on function app.my_reservations(uuid) from public, anon;
grant execute on function app.my_reservations(uuid) to authenticated;

comment on function app.my_reservations(uuid) is
  '0150. The caller''s own reservations (guest_id = auth.uid()), newest first, capped at 100, with the court fee paid and still owed on each, and cancelled_at (0075: the moment the booking became history). Null id lists them; an id returns that one. The guest-side counterpart of booking_bill, which is staff-only.';
