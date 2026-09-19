-- ===========================================================================
-- 0107 — the heartbeat names who is signed in.
--
-- The ask (owner, 2026-09-18): the live floor plan should show a manager or an
-- owner as active at their own station — they hold no till assignment, so the
-- 0105 station_staff mapping can never place them, and the plan drew the
-- people running the building as absent.
--
-- device_heartbeats knows the DEVICE (0021) and whether it is a till (0026);
-- it never knew the PERSON. app.heartbeat already refuses anything but a
-- staff session, so auth.uid() at the time of the beat IS the signed-in
-- person, and recording it costs one column. Everything that read the table
-- before keeps reading it: is_degraded and the sweep look only at is_till and
-- last_seen_at.
--
-- A device whose signed-in person changes overwrites the column on the next
-- beat; a device left on the sign-in screen does not beat at all (the client
-- only beats while someone is signed in), so a stale row still names the last
-- person, and readers must pair staff_id with last_seen_at, never trust it on
-- its own. The floor plan reads it inside the same 45 s window is_degraded
-- uses.
-- ===========================================================================

alter table device_heartbeats
  add column if not exists staff_id uuid references staff(id) on delete set null;

comment on column device_heartbeats.staff_id is
  '0107: who was signed in on the device at its last beat (auth.uid() of the '
  'session that called app.heartbeat). Meaningful only together with '
  'last_seen_at; the client beats only while someone is signed in.';

create index if not exists device_heartbeats_staff_idx on device_heartbeats (staff_id);

create or replace function app.heartbeat(
  p_device_id   text,
  p_queue_depth int default 0,
  p_app_version text default null,
  p_is_till     boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $fn_heartbeat_0107$
begin
  if not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id = '' then
    raise exception 'DEVICE_REQUIRED' using errcode = 'P0001';
  end if;

  -- Observe the venue as this beat FOUND it (0055): without this, a returning
  -- till erases the evidence of its own outage before anything records it.
  perform app.sweep_degraded_periods();

  insert into device_heartbeats (device_id, last_seen_at, queue_depth, app_version, is_till, staff_id)
  values (p_device_id, now(), greatest(coalesce(p_queue_depth, 0), 0), p_app_version,
          coalesce(p_is_till, false), auth.uid())
  on conflict (device_id) do update
     set last_seen_at = excluded.last_seen_at,
         queue_depth  = excluded.queue_depth,
         app_version  = coalesce(excluded.app_version, device_heartbeats.app_version),
         -- Sticky (0026): once a device has identified as a till it stays one.
         is_till      = device_heartbeats.is_till or excluded.is_till,
         staff_id     = excluded.staff_id;

  -- ...and again now that it is fresh, so recovery closes the period above
  -- rather than waiting for whatever beats next.
  perform app.sweep_degraded_periods();

  return jsonb_build_object('degraded', app.is_degraded(), 'server_time', now());
end $fn_heartbeat_0107$;

revoke all on function app.heartbeat(text, int, text, boolean) from public, anon;
grant execute on function app.heartbeat(text, int, text, boolean) to authenticated;
