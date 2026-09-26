-- 0090_push_immediate_delivery — a booking notification leaves in seconds, and once.
--
-- ---------------------------------------------------------------------------
-- THE GAP (field reports, 2026-09-13)
-- ---------------------------------------------------------------------------
--
-- Reserve a court on the deployed app and the confirmation lands ~30 s later.
-- Nothing on the booking path sends: enqueue_reservation_push (0075) only
-- writes the outbox row, and the row then waits for tp_push_sweep, which runs
-- once a minute (0048). So every notification sat 0–60 s before send-push was
-- even called — the telegram outbox has nudged from its enqueue path since
-- 0032; push never got the same.
--
-- (The separate "10 minutes late" and "three arrive at once" reports are the
-- Android side: send-push sent at Expo's default priority, which is `normal` on
-- Android and is deferred while the phone dozes. Fixed in send-push itself.)
--
-- ---------------------------------------------------------------------------
-- THE CHANGE
-- ---------------------------------------------------------------------------
--
--   1. enqueue_reservation_push nudges the sender the moment it queues a row
--      that is due now (confirmed / cancelled / no-show). pg_net only issues
--      the request after the booking commits, so a rolled-back booking sends
--      nothing, and push_nudge swallows its own errors, so it can never fail
--      a booking.
--   2. tp_push_sweep runs every 30 seconds (falls back to every minute where
--      pg_cron predates the seconds syntax, exactly as tp_telegram_sweep does).
--      It is the safety net now: scheduled reminders, retries, and any nudge
--      that did not go out.
--   3. A claim LEASE. Claiming only bumped `attempts`; the row stayed
--      `sent_at is null` until the sender stamped it, so a second send-push
--      invocation started in that window claimed the same row and the guest got
--      the notification twice. Rare at one call a minute; routine once every
--      booking nudges and the sweep runs every 30 s. `claimed_at` marks a row as
--      taken, and neither the claim nor the nudge looks at it again for 60 s.
--
-- WHY 60 SECONDS. The lease must outlast the slowest send, or a live sender's
-- rows get taken over mid-flight. send-push bounds its one slow step (the Expo
-- request) at 15 s; cold start + reads + up to 100 per-row stamps put the worst
-- case near 30 s. A sender that crashed after claiming leaves its rows retried
-- once the lease runs out, still capped at 5 attempts.
--
-- WHAT IS LEFT. A sender that dies after Expo accepted a batch but before it
-- stamped sent_at cannot know whether the push went out; its rows are retried
-- after the lease and may arrive twice. That window is milliseconds wide and is
-- the deliberate at-least-once trade: twice, rarely, over never.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The lease column. Nullable, no default: a metadata-only change, no rewrite.
-- ---------------------------------------------------------------------------
alter table notification_outbox add column if not exists claimed_at timestamptz;

comment on column notification_outbox.claimed_at is
  '0090. When a send-push invocation last claimed this row. The claim and app.push_nudge skip a row claimed within the last 60 seconds, so two overlapping senders never deliver it twice. NULL = never claimed.';

-- ---------------------------------------------------------------------------
-- 2. app.claim_due_notifications — 0024 plus the lease.
--
-- Concurrency: FOR UPDATE SKIP LOCKED passes over a row another claim holds
-- right now; once that claim commits, READ COMMITTED re-checks the WHERE on the
-- new row version, sees claimed_at, and leaves it. Grants survive
-- create-or-replace (0024: service_role only).
-- ---------------------------------------------------------------------------
create or replace function app.claim_due_notifications(p_limit int default 100)
returns setof notification_outbox
language sql security definer set search_path = public as $claim_due_notifications_0090$
  update notification_outbox o
     set attempts   = o.attempts + 1,
         claimed_at = now()
    from (
      select id from notification_outbox
       where sent_at is null and attempts < 5 and scheduled_for <= now()
         and (claimed_at is null or claimed_at <= now() - interval '60 seconds')
       order by scheduled_for
       for update skip locked
       limit p_limit
    ) due
   where o.id = due.id
  returning o.*;
$claim_due_notifications_0090$;

-- ---------------------------------------------------------------------------
-- 3. app.push_nudge — 0048 with the same lease in its "anything due?" test, so
-- the 30 s sweep does not call send-push for rows a live sender already holds.
-- ---------------------------------------------------------------------------
create or replace function app.push_nudge() returns void
language plpgsql security definer set search_path = public as $push_nudge_0090$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from notification_outbox
                    where sent_at is null and attempts < 5 and scheduled_for <= now()
                      and (claimed_at is null or claimed_at <= now() - interval '60 seconds')) then
      return;
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured yet
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/send-push',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'push_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $push_nudge_0090$;

revoke all on function app.push_nudge() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. enqueue_reservation_push — 0075 verbatim, plus the nudge at the end.
--
-- Only the branches that queue a row due NOW nudge. A moved booking only
-- reschedules its reminder, which the sweep picks up when it falls due.
-- ---------------------------------------------------------------------------
create or replace function app.enqueue_reservation_push() returns trigger
language plpgsql security definer set search_path = public as $enqueue_reservation_push_0090$
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

  -- 0090: send now, not on the next sweep. The request is queued inside this
  -- transaction and only leaves once the booking commits.
  if v_confirmed or v_cancelled or v_no_show then
    perform app.push_nudge();
  end if;

  return null;
end $enqueue_reservation_push_0090$;

revoke all on function app.enqueue_reservation_push() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. tp_push_sweep every 30 seconds. cron.schedule upserts by job name (0021).
-- Guarded like 0048: a local stack without pg_cron still resets.
-- ---------------------------------------------------------------------------
do $push_cron_0090$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_push_sweep not scheduled';
    return;
  end if;

  begin
    perform cron.schedule('tp_push_sweep', '30 seconds', 'select app.push_nudge();');
  exception when others then
    raise notice 'pg_cron seconds syntax unsupported (%) - tp_push_sweep stays every minute', sqlerrm;
    perform cron.schedule('tp_push_sweep', '* * * * *', 'select app.push_nudge();');
  end;
end $push_cron_0090$;
