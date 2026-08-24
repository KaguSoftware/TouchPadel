-- 0024_push_outbox — durable outbox for Expo push notifications.
--
-- Pattern: triggers on `reservations` ENQUEUE rows here; a Supabase cron job
-- invokes the `send-push` edge function (service role), which CLAIMS due rows
-- via app.claim_due_notifications(), batches them to Expo's push API, and
-- stamps sent_at / last_error. The database never talks to Expo directly —
-- an outage of exp.host can never roll back a booking confirm.
--
-- Kinds (guest booking lifecycle only, Phase 1):
--   booking_confirmed  — immediately on status -> confirmed
--   booking_reminder   — at start_at - 3 hours (only if that is still in the future)
--   booking_cancelled  — immediately on status -> cancelled
--
-- Only reservations with a guest_id whose profile has an expo_push_token are
-- enqueued (walk-ins and tokenless guests produce no rows). The payload is a
-- reservation snapshot; the sender resolves the CURRENT push token and
-- preferred_lang at send time (tokens rot; language is a live preference).

create table notification_outbox (
  id            bigint generated always as identity primary key,
  profile_id    uuid not null references profiles(id) on delete cascade,
  kind          text not null check (kind in ('booking_confirmed','booking_reminder','booking_cancelled')),
  payload       jsonb not null,               -- reservation snapshot: reservation_id, court_id, start_at, end_at, price_iqd
  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,
  attempts      int not null default 0,
  last_error    text,
  created_at    timestamptz not null default now()
);

-- The claim query's working set: due, unsent, under the retry cap.
create index notification_outbox_due on notification_outbox (scheduled_for)
  where sent_at is null and attempts < 5;
-- Reminder upkeep (cancel / reschedule) looks rows up by reservation id.
create index notification_outbox_reservation on notification_outbox ((payload->>'reservation_id'))
  where sent_at is null;

-- ---------------------------------------------------------------------------
-- Enqueue trigger. AFTER INSERT OR UPDATE:
--   * UPDATE status -> confirmed  — the guest path (hold -> booking flips in place, 0008).
--   * INSERT with status confirmed — desk-created bookings for a known guest
--     (app.staff_create_reservation inserts directly as confirmed; an
--     UPDATE-only trigger would silently miss every desk booking).
--   * UPDATE status -> cancelled  — cancels; also voids any unsent reminder.
--   * UPDATE start_at (still live) — reschedules the pending reminder so a
--     desk move never fires a reminder for the old time.
-- ---------------------------------------------------------------------------
create or replace function app.enqueue_reservation_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_notifiable boolean;
  v_payload    jsonb;
  -- NOTE: OLD is referenced only inside tg_op = 'UPDATE' branches — touching it
  -- in an INSERT invocation raises "record old is not assigned yet".
  v_confirmed  boolean := false;
  v_cancelled  boolean := false;
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
    v_moved     := new.status = 'confirmed' and not v_confirmed
                   and (old.start_at is distinct from new.start_at
                        or old.end_at is distinct from new.end_at);
  end if;
  if not (v_confirmed or v_cancelled or v_moved) then
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

  elsif v_cancelled then
    -- Void the not-yet-sent reminder for this reservation, then tell the guest.
    delete from notification_outbox
     where kind = 'booking_reminder' and sent_at is null
       and payload->>'reservation_id' = new.id::text;
    insert into notification_outbox (profile_id, kind, payload)
    values (new.guest_id, 'booking_cancelled', v_payload);

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
end $$;

create trigger reservations_push_outbox
  after insert or update of status, start_at, end_at on reservations
  for each row execute function app.enqueue_reservation_push();

-- ---------------------------------------------------------------------------
-- app.claim_due_notifications — the sender's claim: due, unsent, attempts < 5,
-- FOR UPDATE SKIP LOCKED so two overlapping cron invocations never double-send.
-- Claiming increments attempts up front: a sender that crashes mid-batch burns
-- one attempt instead of retrying forever.
-- SERVICE-ROLE ONLY: never callable by clients, staff included.
-- ---------------------------------------------------------------------------
create or replace function app.claim_due_notifications(p_limit int default 100)
returns setof notification_outbox
language sql security definer set search_path = public as $$
  update notification_outbox o
     set attempts = o.attempts + 1
    from (
      select id from notification_outbox
       where sent_at is null and attempts < 5 and scheduled_for <= now()
       order by scheduled_for
       for update skip locked
       limit p_limit
    ) due
   where o.id = due.id
  returning o.*;
$$;

revoke all on function app.enqueue_reservation_push() from public, anon, authenticated;
revoke all on function app.claim_due_notifications(int) from public, anon, authenticated;
grant execute on function app.claim_due_notifications(int) to service_role;

-- ---------------------------------------------------------------------------
-- Grants + RLS: clients get NOTHING (not even select — push contents can name
-- other guests' bookings). service_role has full access via the 0012 default
-- privileges; RLS on with no policies keeps the 0019 RLS-everywhere assertion
-- honest and blanks the table for any client role regardless of future grants.
-- ---------------------------------------------------------------------------
alter table notification_outbox enable row level security;

-- ---------------------------------------------------------------------------
-- SCHEDULING NOTE (configured at deploy, not in a migration):
-- the sender is invoked by Supabase cron -> edge function `send-push`
-- (Dashboard > Integrations > Cron, or pg_cron + pg_net):
--   schedule: * * * * *  (every minute)
--   action:   POST https://<project-ref>.supabase.co/functions/v1/send-push
--             Authorization: Bearer <service-role key>   (from Vault)
-- Nothing here references a project ref — see packages/db/README.md
-- "Edge functions" for the exact deploy + cron commands.
-- ---------------------------------------------------------------------------
