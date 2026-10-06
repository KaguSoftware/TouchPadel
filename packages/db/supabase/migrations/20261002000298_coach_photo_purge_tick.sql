set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0298 coach_photo_purge_tick — the coaching post-build review, the coach
-- photo purge queue drained (plan "Coaching: make it bulletproof" §5, item
-- EC-01; build contracts R43; db.md §4.6.3). 0273–0289 are not edited. No
-- lock is taken, no error code is added, no signature changes.
--
--   EC-01 coach_photo_purges was filled (retirement 0282, account deletion
--         0289 and 0290, a replaced photo 0290) but nothing drained it:
--         protocol-action's tick never called app.coach_photo_purge_due, so a
--         deleted coach's photo stayed public in menu-media. protocol-action
--         now lists each queued folder, removes every object no row still
--         points at and calls app.coach_photo_purged. Two database pieces:
--
--   1. app.storage_path_in_use answers the service role too. The tick asks it
--      for every object before removing it, so a folder whose photo a revived
--      coach (coach_promote) or any other row still shows is never emptied.
--      Re-created from 20261001000282_coaching_admin.sql:1782, verbatim but
--      for the guard (staff, or the service role) and the service_role grant.
--   2. app.protocol_tick_nudge posts when a coach folder is queued. It posts
--      nothing when nothing is due, and a coach folder was not on its list,
--      so a queue with only coach rows never woke protocol-action. Re-created
--      from 20260927000240_scan_hardening.sql:1340, verbatim plus the
--      coach_photo_purges clause. tp_protocol_tick still runs every 5 minutes.

-- ===========================================================================
-- 1. app.storage_path_in_use: staff, and the service role (EC-01)
-- ===========================================================================

create or replace function app.storage_path_in_use(p_path text)
returns boolean
language plpgsql stable security definer set search_path = public as $storage_path_in_use_0298$
begin
  -- 0298 (EC-01): protocol-action's coach photo purge asks as the service role.
  if app.staff_role() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_path, '')), '') is null then
    return false;
  end if;
  return (  (select count(*) from menu_items      where photo_path = p_path)
          + (select count(*) from menu_categories where photo_path = p_path)
          + (select count(*) from courts          where photo_path = p_path)
          + (select count(*) from cafe_settings   where key = 'hero_media_path' and value #>> '{}' = p_path)
          + (select count(*) from coaches         where photo_path = p_path)   -- 0282 (R43)
         ) > 0;
end $storage_path_in_use_0298$;

comment on function app.storage_path_in_use(text) is
  '0223 (MV6), coaches since 0282 (R43), the service role since 0298 (EC-01). Staff, and the service role: true while any row (menu item, category, court, a branch''s hero, a coach) still points at this storage path. The operator asks it after moving a row off a photo, so replacing a photo on one branch never deletes the object another branch shares, and a live coach photo is never removed; protocol-action''s tick asks it for every object of a queued coach photo folder before removing it.';

revoke all on function app.storage_path_in_use(text) from public, anon;
grant execute on function app.storage_path_in_use(text) to authenticated, service_role;

-- ===========================================================================
-- 2. app.protocol_tick_nudge: a queued coach photo folder is due work (EC-01)
-- ===========================================================================

create or replace function app.protocol_tick_nudge()
returns void
language plpgsql security definer set search_path = public as $protocol_tick_nudge_0298$
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
                           or u.used_by = 'orphan_purge')
       and not exists (select 1 from app.scan_photos_expired(1))
       -- 0298 (EC-01, R43): a coach photo folder queued for removal.
       and not exists (select 1 from coach_photo_purges q where q.purged_at is null) then
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
end $protocol_tick_nudge_0298$;

comment on function app.protocol_tick_nudge() is
  'release_post_launch (§2.19), re-issued by incident_reports (wave5-addendum §2.6.2), scan_hardening (0240) and coach_photo_purge_tick (0298, EC-01). Every 5 minutes (tp_protocol_tick): asks protocol-action to launch the scheduled releases whose date has come, to remove the photos of runs stopped or withdrawn 90 days ago, to remove the photos of incident reports past purge_after, to remove the incidents, campaigns, receipts and slips photos nobody claimed within a day, to remove scanned papers'' photos past retention, and to remove the coach photo folders queued in coach_photo_purges (R43). Posts nothing when nothing is due; silent without pg_net or the functions_base_url / service_role_key secrets; swallows its own errors.';

revoke all on function app.protocol_tick_nudge() from public, anon, authenticated;
