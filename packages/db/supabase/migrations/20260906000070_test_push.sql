-- 0070 — "Send a test notification" (mobile Settings, owner request 2026-09-06).
--
-- A guest presses one button and their own phone receives a REAL Expo push
-- through the production path — profiles.expo_push_token -> notification_outbox
-- -> app.push_nudge() -> the send-push edge function -> Expo -> the device.
-- Nothing is simulated on the phone, so a green result means the pipeline
-- works, and a silent one points at exactly the stage that does not (the
-- outbox row's last_error says which).
--
-- Scope of the new RPC: it only ever targets auth.uid() — a caller cannot name
-- a profile — and it is rate-limited to one test a minute per profile so the
-- button cannot be turned into a push flood.
--
-- Also here: the outbox `kind` check learns 'test'. 0024 let Postgres name the
-- constraint, so it is looked up rather than assumed.

do $$
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
    check (kind in ('booking_confirmed', 'booking_reminder', 'booking_cancelled', 'test'));
end $$;

-- ---------------------------------------------------------------------------
-- app.send_test_push — enqueue a 'test' push for the CALLER and nudge the
-- sender so it leaves now rather than on the next minute of cron.
--
-- Raises (P0001, mapped on the phone):
--   AUTH_REQUIRED   no session (also what the authz sweep expects to see)
--   NO_PUSH_TOKEN   the caller's profile holds no Expo token — enable
--                   notifications first (the app retries after registering)
--   RATE_LIMITED    a test was queued for this profile within the last minute
-- ---------------------------------------------------------------------------
create or replace function app.send_test_push() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_token text;
  v_id    bigint;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select expo_push_token into v_token from profiles where id = v_uid;
  if v_token is null then
    raise exception 'NO_PUSH_TOKEN' using errcode = 'P0001';
  end if;

  if exists (select 1 from notification_outbox
              where profile_id = v_uid and kind = 'test'
                and created_at > now() - interval '60 seconds') then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into notification_outbox (profile_id, kind, payload)
  values (v_uid, 'test', jsonb_build_object('source', 'settings'))
  returning id into v_id;

  -- Best effort, never raises (push_nudge swallows its own errors): the cron
  -- sweep (0048) picks the row up within a minute regardless.
  perform app.push_nudge();

  return jsonb_build_object('queued', true, 'id', v_id);
end $$;

revoke all on function app.send_test_push() from public, anon;
grant execute on function app.send_test_push() to authenticated;
