-- 0055_heartbeat_sweep_order — a beat now detects the outage it is about to end.
--
-- SOW L670: "every degraded period is logged with its start, end and duration."
--
-- How the logging works today (0021). Two things drive it, and only one of them
-- OPENS a period:
--
--   * cron `tp_degraded_sweep` runs app.sweep_degraded_periods() every minute —
--     this is what notices a venue has gone degraded and writes started_at.
--   * app.heartbeat() sweeps AFTER its upsert, which is deliberate and is what
--     0021's header means by "Closes any open degraded period on recovery":
--     the device is fresh by then, so the sweep takes the else branch and
--     stamps ended_at.
--
-- So the ordering is not itself a bug — opening is cron's job, closing is the
-- beat's. What it leaves is a hole at each end of that division:
--
--   1. An outage that starts AND ends between two cron ticks is never recorded
--      at all. The till dies, comes back 40 s later, its own beat closes a
--      period that was never opened, and the history shows nothing happened.
--   2. `create extension pg_cron` sits in a best-effort block that explicitly
--      tolerates its own failure ("pg_cron unavailable - scheduled jobs
--      skipped"). Wherever that branch is taken, NOTHING opens a period ever,
--      and the safety property is silently off with no other symptom.
--
-- Both holes close by having the beat also look BEFORE it refreshes itself:
--
--     sweep()   -- the venue as this beat FOUND it -> open the period
--     upsert    -- this device goes fresh
--     sweep()   -- the venue as this beat LEFT it  -> close it
--
-- Detection then rides on the same ~10 s traffic that recovery does, instead of
-- depending on a once-a-minute job that may not be installed. cron stays as the
-- backstop for the case no device beats at all.
--
-- Nothing else changes: the guards, the sticky is_till rule and the returned
-- payload are 0026's verbatim, and `degraded` is still computed AFTER the
-- upsert, so a fresh beat still reports degraded=false.
--
-- The sweep is idempotent in both directions — it opens only when no period is
-- already open, and its close is a WHERE-scoped update matching nothing on a
-- healthy venue — so calling it twice per beat is safe and costs two cheap
-- index probes on a path that runs every ~10 s.

create or replace function app.heartbeat(
  p_device_id   text,
  p_queue_depth int default 0,
  p_app_version text default null,
  p_is_till     boolean default false           -- 0026: explicit till identification
) returns jsonb
language plpgsql security definer set search_path = public as $fn_heartbeat$
begin
  if not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id = '' then
    raise exception 'DEVICE_REQUIRED' using errcode = 'P0001';
  end if;

  -- Observe the venue as this beat FOUND it. Without this, a returning till
  -- erases the evidence of its own outage before anything records it.
  perform app.sweep_degraded_periods();

  insert into device_heartbeats (device_id, last_seen_at, queue_depth, app_version, is_till)
  values (p_device_id, now(), greatest(coalesce(p_queue_depth, 0), 0), p_app_version,
          coalesce(p_is_till, false))
  on conflict (device_id) do update
     set last_seen_at = excluded.last_seen_at,
         queue_depth  = excluded.queue_depth,
         app_version  = coalesce(excluded.app_version, device_heartbeats.app_version),
         -- Sticky: once a device has identified as a till it stays one — an
         -- older client build omitting the flag must not undo detection.
         is_till      = device_heartbeats.is_till or excluded.is_till;

  -- ...and again now that it is fresh, so recovery closes the period above
  -- rather than waiting for whatever beats next.
  perform app.sweep_degraded_periods();

  return jsonb_build_object('degraded', app.is_degraded(), 'server_time', now());
end $fn_heartbeat$;

revoke all on function app.heartbeat(text, int, text, boolean) from public, anon;
grant execute on function app.heartbeat(text, int, text, boolean) to authenticated;
