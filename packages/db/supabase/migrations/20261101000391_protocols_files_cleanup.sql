set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0391 protocols_files_cleanup — the protocol and Files fixes (Majed 2026-11-01:
-- F-61 "fix all, and removed photos are deleted from storage too"; F-64 "a
-- garbage collector: broken rows (failed deletes) are deleted").
--
--   1. stop_protocol (0164 is no longer the latest): the owner stops a run
--      without a reason, as decide_step has let the owner stop or send back
--      since 0361 (Majed: the owner never needs a reason); every other
--      decider still says why. decide_step stays 0361's.
--   2. Removed protocol photos leave storage: the new discard_staff_media(p_paths)
--      (see section 2).
--   3. Files: the new venue_files_gc() (section 3).

-- ===========================================================================
-- 1. stop_protocol: the owner stops without a reason
-- ===========================================================================
-- stop_protocol: re-issued from 20260925000164_protocols_engine_rpcs.sql.
create or replace function app.stop_protocol(p_run_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $stop_protocol_0391$
declare
  v_run  protocol_runs%rowtype;
  v_note text;
  v_ids  uuid[];
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  v_note := app.protocol_engine_text(p_note, 1000, 'note');
  -- 0391 (F-61, Majed): the owner never needs a reason to stop (0361's rule,
  -- as in decide_step); a manager still says why.
  if v_note is null and not app.is_staff_at(v_run.venue_id, 'owner') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if not app.protocol_run_allowed(v_run.status, 'stopped') then
    raise exception 'PROTOCOL_CLOSED' using errcode = 'P0001';
  end if;

  update protocol_runs
     set status = 'stopped', stop_reason = v_note, finished_at = now()
   where id = v_run.id;
  perform app.protocol_engine_stop_hook(v_run.id);

  -- The starter and whoever had a step open.
  v_ids := array[v_run.started_by] || coalesce((
             select array_agg(distinct x)
               from protocol_run_steps s,
                    unnest(app.protocol_engine_actor_ids(v_run.venue_id, s.actor_roles, s.assigned_to)) x
              where s.run_id = v_run.id and s.status = 'open'), '{}'::uuid[]);
  perform app.protocol_engine_notify(v_ids, 'staff_decided', 'run_stopped', 'staff-run', v_run.id, v_run.id, null);

  perform app.write_audit('protocol.stop', 'protocol_run', v_run.id::text,
    jsonb_build_object('status', v_run.status), jsonb_build_object('status', 'stopped'));

  return jsonb_build_object('run_status', 'stopped');
end $stop_protocol_0391$;

comment on function app.stop_protocol(uuid, text) is
  'protocols_engine_rpcs (§2.7). MGMT at the run''s venue (PROPOSAL) stops an active or scheduled run with a reason (0391: optional for the owner, as decide_step since 0361); the kind''s stop hook runs and the starter and the actors of open steps get run_stopped. REASON_REQUIRED, PROTOCOL_CLOSED. Returns {run_status}. Audit protocol.stop.';

revoke all on function app.stop_protocol(uuid, text) from public, anon;
grant execute on function app.stop_protocol(uuid, text) to authenticated;

-- ===========================================================================
-- 2. Removed protocol photos leave storage
-- ===========================================================================
-- A photo taken off a protocol form (PhotoField's remove) was only dropped from
-- the form: its upload slot stayed unused and its object stayed in storage for
-- good, because the orphan purge (0240) looked at the incident, campaign,
-- receipt and slip folders only. Now:
--   * discard_staff_media(p_paths) marks the caller's OWN slots that no record
--     claimed (used_by null) for the purge (used_by 'orphan_purge'); the
--     protocol-action tick (nudged by app.protocol_tick_nudge) deletes the
--     object and the slot, as for every orphan. A claimed photo (a record
--     names it) or someone else's is left alone. Returns how many it marked.
--   * staff_media_orphan_purge_due (0240 is no longer the latest) and
--     protocol_tick_nudge (0302 is no longer the latest) also take a protocol
--     folder's slot (proposals, tests, steps, marketing) that no record
--     claimed within 7 days (an abandoned form).

create or replace function app.discard_staff_media(p_paths text[])
returns int
language plpgsql security definer set search_path = public as $discard_staff_media_0391$
declare
  v_n int;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_paths is null or cardinality(p_paths) = 0 then
    return 0;
  end if;
  if cardinality(p_paths) > 50 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'paths';
  end if;
  with mine as (
    select u.path from staff_media_uploads u
     where u.path = any (p_paths) and u.used_by is null and u.uploader = auth.uid()
     order by u.path
       for update skip locked)
  update staff_media_uploads u
     set used_at = now(), used_by = 'orphan_purge'
    from mine
   where u.path = mine.path;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform app.protocol_tick_nudge();
  end if;
  return v_n;
end $discard_staff_media_0391$;

comment on function app.discard_staff_media(text[]) is
  '0391 (F-61). Any active staff: the photos they uploaded and then removed from a form (at most 50 paths): each of the caller''s own upload slots that no record claimed is marked for the orphan purge (used_by orphan_purge), which deletes the object and the slot; a claimed or someone else''s path is left alone. Returns how many were marked. FORBIDDEN, INVALID_ARGUMENT (hint paths).';
revoke all on function app.discard_staff_media(text[]) from public, anon;
grant execute on function app.discard_staff_media(text[]) to authenticated;

-- staff_media_orphan_purge_due: re-issued from 20260927000240_scan_hardening.sql.
create or replace function app.staff_media_orphan_purge_due(p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $staff_media_orphan_purge_due_0391$
declare
  v_paths jsonb;
begin
  -- SKIP LOCKED: a slot a recording RPC is claiming right now is its.
  with due as (
    select u.path
      from staff_media_uploads u
     where (u.used_by is null
            and u.folder in ('incidents', 'campaigns', 'receipts', 'slips')
            and u.created_at < now() - interval '1 day')
        -- 0391 (F-61): a protocol photo uploaded and never kept (removed from
        -- the form, or the form abandoned) after a week; a draft kept on the
        -- station that long has its photo uploaded again.
        or (u.used_by is null
            and u.folder in ('proposals', 'tests', 'steps', 'marketing')
            and u.created_at < now() - interval '7 days')
        or u.used_by = 'orphan_purge'
        or u.path in (select app.scan_photos_expired(p_limit))
     order by u.created_at, u.path
     limit greatest(coalesce(p_limit, 50), 1)
       for update skip locked
  ), held as (
    update staff_media_uploads u
       set used_at = coalesce(u.used_at, now()),
           used_by = 'orphan_purge'
      from due
     where u.path = due.path
    returning u.path, u.created_at
  )
  select coalesce(jsonb_agg(h.path order by h.created_at, h.path), '[]'::jsonb) into v_paths
    from held h;
  return v_paths;
end $staff_media_orphan_purge_due_0391$;

revoke all on function app.staff_media_orphan_purge_due(int) from public, anon, authenticated;
grant execute on function app.staff_media_orphan_purge_due(int) to service_role;

-- protocol_tick_nudge: re-issued from 20261004000302_profile_avatar_birth_date.sql.
create or replace function app.protocol_tick_nudge()
returns void
language plpgsql security definer set search_path = public as $protocol_tick_nudge_0391$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from protocol_runs r
                    where r.kind = 'product_release' and r.status = 'scheduled'
                      and r.scheduled_for <= now())
       and not exists (select 1 from protocol_runs r
                        where r.status in ('stopped', 'withdrawn')
                          and r.finished_at + interval '90 days' <= now()
                          and r.photos_purged_at is null)
       and not exists (select 1 from incident_reports i
                        where i.purge_after <= now()
                          and i.photos_purged_at is null
                          and cardinality(i.photos) > 0)
       and not exists (select 1 from staff_media_uploads u
                        where (u.used_by is null
                               and u.folder in ('incidents', 'campaigns', 'receipts', 'slips')
                               and u.created_at < now() - interval '1 day')
                           -- 0391: an abandoned protocol photo, as staff_media_orphan_purge_due.
                           or (u.used_by is null
                               and u.folder in ('proposals', 'tests', 'steps', 'marketing')
                               and u.created_at < now() - interval '7 days')
                           or u.used_by = 'orphan_purge')
       and not exists (select 1 from app.scan_photos_expired(1))
       -- 0298 (EC-01, R43): a coach photo folder queued for removal.
       and not exists (select 1 from coach_photo_purges q where q.purged_at is null)
       -- 0302: a replaced avatar or a deleted account's avatar folder.
       and not exists (select 1 from avatar_purges a where a.purged_at is null) then
      return;                                  -- nothing due: no HTTP
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
      url                  := rtrim(v_base, '/') || '/protocol-action',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'protocol_tick_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $protocol_tick_nudge_0391$;

comment on function app.protocol_tick_nudge() is
  'release_post_launch (§2.19), re-issued by incident_reports (wave5-addendum §2.6.2), scan_hardening (0240), coach_photo_purge_tick (0298, EC-01) and profile_avatar_birth_date (0302). Every 5 minutes (tp_protocol_tick): asks protocol-action to launch the scheduled releases whose date has come, to remove the photos of runs stopped or withdrawn 90 days ago, to remove the photos of incident reports past purge_after, to remove the incidents, campaigns, receipts and slips photos nobody claimed within a day, to remove scanned papers'' photos past retention, to remove the coach photo folders queued in coach_photo_purges (R43), and to remove the avatars queued in avatar_purges. Posts nothing when nothing is due; silent without pg_net or the functions_base_url / service_role_key secrets; swallows its own errors.';

revoke all on function app.protocol_tick_nudge() from public, anon, authenticated;

-- ===========================================================================
-- 3. Files: rows whose file is gone are collected
-- ===========================================================================
-- The Files page removes a file's storage objects first and its row after
-- (venue_file_delete, 0354: the storage delete rule needs the row), so a failed
-- second call left a row whose download fails. app.venue_files_gc() deletes
-- every such row: a ready file whose blob object is no longer in the
-- venue-files bucket, and an upload that never finished within a day (its
-- object, if any, goes with the slot rules of 0354). Each removal is audited
-- (file.gc). Service role only, run by cron tp_venue_files_gc every 10 minutes.

create or replace function app.venue_files_gc()
returns int
language plpgsql security definer set search_path = public as $venue_files_gc_0391$
declare
  v_row record;
  v_n   int := 0;
begin
  for v_row in
    select f.id, f.venue_id, f.name, f.status, f.blob_path
      from venue_files f
     where (f.status = 'ready'
            and f.ready_at < now() - interval '5 minutes'
            and not exists (select 1 from storage.objects o
                             where o.bucket_id = 'venue-files' and o.name = f.blob_path))
        or (f.status = 'uploading' and f.created_at < now() - interval '1 day')
     order by f.created_at
     limit 500
       for update of f skip locked
  loop
    perform set_config('app.venue_id', v_row.venue_id::text, true);
    delete from venue_files where id = v_row.id;
    perform app.write_audit('file.gc', 'venue_files', v_row.id::text,
                            jsonb_build_object('status', v_row.status), null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $venue_files_gc_0391$;

comment on function app.venue_files_gc() is
  '0391 (F-64). Internal, cron tp_venue_files_gc: deletes the venue_files rows whose file is gone, a ready file whose blob object is no longer in the venue-files bucket (a delete whose second call failed) and an upload that never finished within a day; at most 500 a run, each audited file.gc. Returns how many.';
revoke all on function app.venue_files_gc() from public, anon, authenticated;
grant execute on function app.venue_files_gc() to service_role;

-- Through 0385's app.ensure_cron, so a missing job raises SETUP_FAILED and the
-- hourly app.setup_check sees it (F-55).
select app.ensure_cron('tp_venue_files_gc', '*/10 * * * *', 'select app.venue_files_gc();');
