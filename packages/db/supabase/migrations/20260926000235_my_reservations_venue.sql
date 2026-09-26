set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0235 (multi-venue audit, 2026-09-26): a guest's booking names its branch.
--
-- The app's booking detail learned a booking's branch by finding its court in
-- the list of active courts at open branches. A court taken out of service
-- since (or not in that list for any reason) sent it to the guest's picked
-- branch instead, so the cancellation window, the phone and the clock could be
-- another branch's: "free to cancel" shown, then CANCELLATION_WINDOW refused.
-- my_reservations now returns the row's own venue_id. A new column changes the
-- result type, so the function is dropped and re-created with its grants
-- (0152); older clients ignore the extra field.

drop function if exists app.my_reservations(uuid);

create function app.my_reservations(p_reservation_id uuid default null)
returns table(id uuid, court_id uuid, kind text, status text, start_at timestamptz, end_at timestamptz,
              price_iqd bigint, hold_expires_at timestamptz, cancelled_by text, cancelled_at timestamptz,
              court_paid_iqd bigint, court_remaining_iqd bigint, venue_id uuid)
language sql stable security definer set search_path = public as $my_reservations_0235$
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
         app.court_fee_remaining(r.id) as court_remaining_iqd,
         r.venue_id
    from reservations r
   where auth.uid() is not null
     and r.guest_id = auth.uid()
     and (p_reservation_id is null or r.id = p_reservation_id)
   order by r.start_at desc
   limit 100
$my_reservations_0235$;

revoke all on function app.my_reservations(uuid) from public, anon;
grant execute on function app.my_reservations(uuid) to authenticated;
