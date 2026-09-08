-- 0075_no_show_terminates — marking a no-show must actually END the booking.
--
-- THE COMPLAINT. "If I mark someone as no-show it doesn't really cancel the
-- reservation, and it even keeps the reservation in the customer's mobile."
-- Both halves are real, and neither is where you would first look: the status
-- DOES flip to 'no_show', and the slot DOES leave the exclusion predicate the
-- instant it does (0008's reservations_no_overlap covers pending/confirmed/
-- arrived only). What is missing is everything AROUND the status.
--
-- 1. THE ROW DOES NOT LOOK ENDED. cancel_reservation stamps cancelled_at and
--    cancellation_reason; mark_reservation stamps neither, for any status. So
--    a no-show is a terminated booking with no record of WHEN it was
--    terminated or WHY, and every consumer that asks "is this over?" by
--    reading cancelled_at — which is the obvious way to ask — says no.
--
-- 2. THE GUEST IS NEVER TOLD, AND THE REMINDER STILL FIRES. This is the half
--    the operator sees on the customer's phone. app.enqueue_reservation_push
--    (0024) fires on status changes to 'confirmed' and 'cancelled' and on a
--    move. 'no_show' is none of those, so:
--      * no notification is ever sent — the booking silently changes meaning
--        under the guest, which is why it looks like nothing happened;
--      * the pending booking_reminder is NOT voided. cancel deletes it; a
--        no-show left it in the outbox, so a guest marked no-show for an early
--        slot still gets "your game is in 3 hours" for the booking the desk
--        already wrote off.
--
-- So: mark_reservation stamps the terminal columns, and the push trigger
-- treats a no-show as the ending it is. The status machine, the tier check and
-- the allowed transitions are untouched — a no-show is still only reachable
-- from 'confirmed', and it is still not a cancellation (the reports count the
-- two separately, and a venue's no-show rate is a real number it acts on).
--
-- covered by packages/db/tests/no-show.test.ts

-- ---------------------------------------------------------------------------
-- 1. notification_outbox grows a kind. The CHECK is an explicit list, so a new
--    kind has to be added here or the insert below fails at runtime.
--    send-push maps kinds to copy; an unknown kind is TERMINAL there (attempts
--    pinned to the cap, never retried), so a database ahead of a deployed
--    function costs one unsent row rather than a queue that never drains.
--
--    Same dynamic lookup 0070 used: 0024 let Postgres name this constraint, so
--    on a stack that has not run 0070 the name is not the one below.
-- ---------------------------------------------------------------------------
do $kind_check_0075$
declare
  v_con text;
begin
  select conname into v_con
    from pg_constraint
   where conrelid = 'public.notification_outbox'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%booking_confirmed%';
  if v_con is not null then
    execute format('alter table notification_outbox drop constraint %I', v_con);
  end if;
  alter table notification_outbox
    add constraint notification_outbox_kind_check
    check (kind in ('booking_confirmed', 'booking_reminder', 'booking_cancelled',
                    'booking_no_show', 'test'));
end $kind_check_0075$;

-- ---------------------------------------------------------------------------
-- 2. mark_reservation — stamp the terminal columns on the endings.
--
-- 'no_show' and 'completed' both END a booking; 'arrived' does not. Only the
-- no-show sets cancellation_reason: "completed" is the happy path and has
-- nothing to explain, while a no-show is a desk decision the guest may query
-- later, and p_reason is the reason code the operator already picked in
-- ReasonCodePrompt.
-- ---------------------------------------------------------------------------
create or replace function app.mark_reservation(
  p_reservation_id uuid,
  p_status         reservation_status,
  p_reason         text default 'staff_op'      -- recorded in the audit row (0026)
) returns jsonb
language plpgsql security definer set search_path = public as $mark_reservation_0075$
declare
  v        reservations%rowtype;
  v_before jsonb;
  v_ok     boolean;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_ok := (p_status = 'arrived'   and v.status = 'confirmed')
       or (p_status = 'no_show'   and v.status = 'confirmed')
       or (p_status = 'completed' and v.status in ('confirmed','arrived'));
  if not v_ok then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s', v.status, p_status);
  end if;

  v_before := to_jsonb(v);

  update reservations
     set status = p_status,
         -- The booking is over from this moment. Anything asking "has this
         -- ended?" reads this column, and a no-show used to leave it null.
         cancelled_at = case when p_status in ('no_show','completed')
                             then coalesce(v.cancelled_at, now())
                             else v.cancelled_at end,
         cancellation_reason = case when p_status = 'no_show'
                                    then coalesce(p_reason, 'no_show')
                                    else v.cancellation_reason end
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.mark_' || p_status::text, 'reservations',
                          v.id::text, v_before, to_jsonb(v),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'status', v.status);
end $mark_reservation_0075$;

comment on function app.mark_reservation(uuid, reservation_status, text) is
  '0075: arrived / no_show / completed. The two ENDINGS stamp cancelled_at, and a no_show also stamps cancellation_reason, so a terminated booking looks terminated to every reader. A no_show is not a cancellation: the reports count them separately.';

revoke all on function app.mark_reservation(uuid, reservation_status, text) from public, anon;
grant execute on function app.mark_reservation(uuid, reservation_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. enqueue_reservation_push — a no-show is an ending, so it behaves like one.
--
-- Void the pending reminder (a guest who was marked no-show must not be told
-- their game is in 3 hours) and tell them the booking was closed. Everything
-- else is 0024 verbatim.
-- ---------------------------------------------------------------------------
create or replace function app.enqueue_reservation_push() returns trigger
language plpgsql security definer set search_path = public as $enqueue_reservation_push_0075$
declare
  v_notifiable boolean;
  v_payload    jsonb;
  -- NOTE: OLD is referenced only inside tg_op = 'UPDATE' branches — touching it
  -- in an INSERT invocation raises "record old is not assigned yet".
  v_confirmed  boolean := false;
  v_cancelled  boolean := false;
  v_no_show    boolean := false;
  v_moved      boolean := false;
begin
  -- Only real bookings for an account-holding guest notify.
  if new.kind <> 'booking' or new.guest_id is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_confirmed := new.status = 'confirmed';
  else
    v_confirmed := new.status = 'confirmed' and old.status is distinct from new.status;
    v_cancelled := new.status = 'cancelled' and old.status is distinct from new.status;
    v_no_show   := new.status = 'no_show'   and old.status is distinct from new.status;
    v_moved     := new.status = 'confirmed' and not v_confirmed
                   and (old.start_at is distinct from new.start_at
                        or old.end_at is distinct from new.end_at);
  end if;
  if not (v_confirmed or v_cancelled or v_no_show or v_moved) then
    return null;
  end if;

  select expo_push_token is not null into v_notifiable
    from profiles where id = new.guest_id;
  if not coalesce(v_notifiable, false) then
    return null;
  end if;

  v_payload := jsonb_build_object(
    'reservation_id', new.id,
    'court_id',       new.court_id,
    'start_at',       new.start_at,
    'end_at',         new.end_at,
    'price_iqd',      new.price_iqd);

  if v_confirmed then
    insert into notification_outbox (profile_id, kind, payload)
    values (new.guest_id, 'booking_confirmed', v_payload);

    if new.start_at - interval '3 hours' > now() then
      insert into notification_outbox (profile_id, kind, payload, scheduled_for)
      values (new.guest_id, 'booking_reminder', v_payload, new.start_at - interval '3 hours');
    end if;

  elsif v_cancelled or v_no_show then
    -- Void the not-yet-sent reminder for this reservation, then tell the guest.
    -- The no-show half is new in 0075: a booking the desk has written off must
    -- not still push "your game is in 3 hours".
    delete from notification_outbox
     where kind = 'booking_reminder' and sent_at is null
       and payload->>'reservation_id' = new.id::text;
    insert into notification_outbox (profile_id, kind, payload)
    values (new.guest_id,
            case when v_no_show then 'booking_no_show' else 'booking_cancelled' end,
            v_payload);

  elsif v_moved then
    -- Moved booking: reschedule (or drop) the pending reminder.
    update notification_outbox
       set scheduled_for = new.start_at - interval '3 hours',
           payload       = v_payload
     where kind = 'booking_reminder' and sent_at is null
       and payload->>'reservation_id' = new.id::text;
    delete from notification_outbox
     where kind = 'booking_reminder' and sent_at is null
       and payload->>'reservation_id' = new.id::text
       and scheduled_for <= now();     -- moved to < 3h away: reminder is moot
  end if;

  return null;
end $enqueue_reservation_push_0075$;

comment on function app.enqueue_reservation_push() is
  '0075: confirm / cancel / no-show / move. A no-show voids the pending reminder and enqueues booking_no_show — before this it did neither, so the guest was never told and still got the 3-hour nudge for a booking the desk had closed.';

revoke all on function app.enqueue_reservation_push() from public, anon, authenticated;
