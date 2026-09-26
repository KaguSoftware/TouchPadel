-- 0196 staff_media_incidents — the incidents photo folder, and who reads a
-- marketing content item's images.
--
-- Feature: protocols and the staff phone, wave 5, lane P
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.4, §2.10; Majed's
-- answers #6 and #7; §8 Q14).
-- Depends on: nothing uncommitted (0170 staff_media_folders). incident_reports
-- (P) claims photos in the new folder; marketing_content (P) claims its
-- images in campaigns and relies on the read rule below.
-- Re-issues (§2.10): the two staff_media_uploads CHECKs, app.is_staff_media_path,
-- app.staff_media_slot and app.staff_media_visible, each from 0170; and the
-- storage policy staff_media_delete from 0159.
-- Re-runnable: drop constraint if exists before each add, guarded validates,
-- create or replace.
--
-- FOLDERS. incidents (incident report photos, #6) joins the nine of 0170.
-- staff_media_insert reads the slot row and staff_media_read asks
-- app.staff_media_visible, so neither names a folder and neither changes.
-- staff_media_delete (0159) let any manager at the venue delete any staff
-- photo through the storage API, which would let one delete a filed incident
-- report's photo, even one naming them. It is re-issued to leave the
-- incidents folder out: those photos go only by the owner's redaction or the
-- purge, both through the service role (review 2026-09-26). app.staff_media_venue and app.staff_media_folder call
-- is_staff_media_path, so only their comments change. is_staff_media_path
-- stays language sql immutable with no SET clause: it is granted to the API
-- roles and the storage policies evaluate it, so 0189's rule for revoked
-- helpers does not reach it (M1).
--
-- WHO READS (app.staff_media_visible). One used_by kind joins, and it
-- answers BEFORE the uploader-or-MGMT rule, so it alone decides:
--   marketing_content:<id>  the uploader, and marketing and the owners at the
--                           content's venue; never a manager (PROPOSAL, §8
--                           Q14, V4). Until marketing_content exists, the
--                           uploader only.
-- An incident's photo (incident:<id>) needs no branch: a kind the function
-- does not name stays the uploader's and MGMT's. Every 0170 rule is kept.
--
-- covered by packages/db/tests/staff-media-incidents.test.ts and
-- staff-media-folders.test.ts (and marketing-content.test.ts,
-- incident-reports.test.ts for the rules their tables bring)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. staff_media_uploads: the folder CHECK and the path CHECK, dropped and
--    added back NOT VALID with ten folders, then validated under the lighter
--    lock.
-- ---------------------------------------------------------------------------
alter table staff_media_uploads drop constraint if exists staff_media_uploads_folder_check;
alter table staff_media_uploads
  add constraint staff_media_uploads_folder_check
  check (folder in ('proposals','tests','steps','marketing','campaigns','receipts',
                    'checklists','teachings','requests','incidents'))
  not valid;

alter table staff_media_uploads drop constraint if exists staff_media_uploads_path_chk;
alter table staff_media_uploads
  add constraint staff_media_uploads_path_chk
  check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(proposals|tests|steps|marketing|campaigns|receipts|checklists|teachings|requests|incidents)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
         and split_part(path, '/', 1) = venue_id::text
         and split_part(path, '/', 2) = folder)
  not valid;

do $validate_folder_checks_0196$
begin
  if exists (select 1 from pg_constraint
              where conname = 'staff_media_uploads_folder_check'
                and conrelid = 'public.staff_media_uploads'::regclass
                and not convalidated) then
    alter table staff_media_uploads validate constraint staff_media_uploads_folder_check;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'staff_media_uploads_path_chk'
                and conrelid = 'public.staff_media_uploads'::regclass
                and not convalidated) then
    alter table staff_media_uploads validate constraint staff_media_uploads_path_chk;
  end if;
end $validate_folder_checks_0196$;

comment on column staff_media_uploads.folder is
  'What the photo is for: proposals, tests, steps, marketing, campaigns, receipts, checklists, teachings, requests or incidents (receipts and incidents are read by their uploader and management only).';

-- ---------------------------------------------------------------------------
-- 2. The path helper, 0170 with the ten-folder grammar. Still pure text,
--    `immutable`, never raising, no SET clause, and granted to anon,
--    authenticated and service_role (the storage policies evaluate it as the
--    reading role).
-- ---------------------------------------------------------------------------
create or replace function app.is_staff_media_path(p_name text) returns boolean
language sql immutable as $is_staff_media_path_0196$
  select coalesce(
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(proposals|tests|steps|marketing|campaigns|receipts|checklists|teachings|requests|incidents)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$',
    false)
$is_staff_media_path_0196$;

comment on function app.is_staff_media_path(text) is
  'staff_media_bucket (§2.3), re-issued by staff_media_folders (§2.24.2) and staff_media_incidents (wave5-addendum §2.4). True when a storage object name is a staff-media path, <venue_id>/<folder>/<uuid>.<jpg|png|webp> with one of the ten folders; false for anything else, NULL included. Pure text, never raises. Granted to anon, authenticated and service_role because the staff-media storage policies evaluate it as the reading role.';

comment on function app.staff_media_folder(text) is
  'staff_media_bucket (§2.3). The folder of a staff-media path (proposals, tests, steps, marketing, campaigns, receipts, checklists, teachings, requests or incidents); NULL for a name that is not a staff-media path. Policy-evaluated, hence the anon grant.';

revoke all on function app.is_staff_media_path(text) from public;
grant execute on function app.is_staff_media_path(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. app.staff_media_slot — 0170 verbatim, accepting the ten folders.
-- ---------------------------------------------------------------------------
create or replace function app.staff_media_slot(
  p_venue_id uuid,
  p_folder   text,
  p_ext      text
) returns jsonb
language plpgsql security definer set search_path = public as $staff_media_slot_0196$
declare
  v_venue  uuid;
  v_folder text := lower(btrim(coalesce(p_folder, '')));
  v_ext    text := lower(btrim(coalesce(p_ext, '')));
  v_path   text;
  v_row    staff_media_uploads%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if v_folder not in ('proposals','tests','steps','marketing','campaigns','receipts',
                      'checklists','teachings','requests','incidents') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'folder';
  end if;
  if v_ext = 'jpeg' then
    v_ext := 'jpg';
  end if;
  if v_ext not in ('jpg','png','webp') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'ext';
  end if;

  -- A phone that mints slots and never uploads (a loop, a stuck retry) is
  -- stopped here rather than filling the table.
  if (select count(*) from staff_media_uploads
       where uploader = auth.uid() and used_at is null
         and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'UPLOAD_LIMIT' using errcode = 'P0001';
  end if;

  v_path := v_venue::text || '/' || v_folder || '/' || gen_random_uuid()::text || '.' || v_ext;
  insert into staff_media_uploads (path, venue_id, folder, uploader)
  values (v_path, v_venue, v_folder, auth.uid())
  returning * into v_row;

  return jsonb_build_object('path', v_row.path,
                            'bucket', 'staff-media',
                            'expires_at', v_row.created_at + interval '1 hour');
end $staff_media_slot_0196$;

comment on function app.staff_media_slot(uuid, text, text) is
  'staff_media_bucket (§2.3), re-issued by staff_media_folders (§2.24.2) and staff_media_incidents (wave5-addendum §2.4). Any active staff member at the venue: mints an upload slot in one of the ten folders and returns {path, bucket: staff-media, expires_at}. The client uploads to exactly that path within the hour, then passes it to the recording RPC. INVALID_ARGUMENT (hint folder or ext); UPLOAD_LIMIT past 30 unused slots in the last hour.';

revoke all on function app.staff_media_slot(uuid, text, text) from public, anon;
grant execute on function app.staff_media_slot(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.staff_media_visible — 0170 verbatim, plus the marketing content
--    rule, which answers before the uploader-or-MGMT one (§2.4, V4). Still
--    stable, a definer, and never raising: the staff_media_read policy asks
--    it for every object in storage.objects, menu-media's included.
-- ---------------------------------------------------------------------------
create or replace function app.staff_media_visible(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $staff_media_visible_0196$
declare
  c_sub  constant text := '^protocol_submission:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_ref  constant text := '^(release_idea|checklist_item|teaching|marketing_request):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_content constant text := '^marketing_content:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_up   staff_media_uploads%rowtype;
  v_step protocol_run_steps%rowtype;
  v_run  protocol_runs%rowtype;
  v_kind text;
  v_ref  uuid;
begin
  if not app.is_staff_media_path(p_name) or app.staff_role() is null then
    return false;
  end if;
  select * into v_up from staff_media_uploads where path = p_name;
  if not found or not (v_up.venue_id = any(app.staff_venue_ids())) then
    return false;
  end if;

  -- staff_media_incidents (§2.4, V4): a content item's images are the
  -- uploader's, marketing's and the owners' at its venue, and not a
  -- manager's, so this answers before the MGMT rule below. Nested behind its
  -- table, which a later migration creates.
  if v_up.used_by ~ c_content then
    if v_up.uploader = auth.uid() then
      return true;
    end if;
    if to_regclass('public.marketing_content') is null then
      return false;
    end if;
    return exists (select 1 from marketing_content c
                    where c.id = split_part(v_up.used_by, ':', 2)::uuid
                      and c.venue_id = v_up.venue_id)
       and app.is_staff_at(v_up.venue_id, 'marketing', 'owner');
  end if;

  if v_up.uploader = auth.uid() or app.is_staff_at(v_up.venue_id, 'manager', 'owner') then
    return true;
  end if;

  if v_up.used_by ~ c_sub then
    select s.* into v_step
      from protocol_submissions x
      join protocol_run_steps s on s.id = x.run_step_id
     where x.id = split_part(v_up.used_by, ':', 2)::uuid;
    if not found then
      return false;
    end if;
    select * into v_run from protocol_runs where id = v_step.run_id;
    return exists (select 1 from protocol_submissions x
                    where x.run_step_id = v_step.id
                      and x.submitted_by = auth.uid()
                      and p_name = any(x.photos))
        or (coalesce(app.protocol_step_def(v_run.kind, v_run.variant, v_step.step_key)->>'record_visibility',
                     'run') = 'run'
            and app.protocol_engine_involved(v_run.id));
  end if;

  if v_up.used_by ~ '^marketing_note:' then
    return app.is_staff_at(v_up.venue_id, 'marketing');
  end if;

  -- staff_media_folders (§2.24.2): the role spec's records. Each read is
  -- nested behind its table, which a later migration may create.
  if v_up.used_by !~ c_ref then
    return false;
  end if;
  v_kind := split_part(v_up.used_by, ':', 1);
  v_ref  := split_part(v_up.used_by, ':', 2)::uuid;

  if v_kind = 'release_idea' then
    if to_regclass('public.release_ideas') is null then
      return false;
    end if;
    return exists (select 1 from release_ideas i
                    where i.id = v_ref
                      and i.venue_id = v_up.venue_id
                      and app.is_staff_at(i.venue_id, app.staff_team_head(i.team)));
  elsif v_kind = 'checklist_item' then
    return exists (select 1
                     from checklist_run_items ci
                     join checklist_runs r on r.id = ci.run_id
                    where ci.id = v_ref
                      and r.venue_id = v_up.venue_id
                      and app.is_staff_at(r.venue_id, r.role));
  elsif v_kind = 'teaching' then
    if to_regclass('public.teachings') is null then
      return false;
    end if;
    return exists (select 1 from teachings t
                    where t.id = v_ref
                      and t.venue_id = v_up.venue_id
                      and t.archived_at is null
                      and t.team = app.staff_team(app.staff_role())
                      and app.is_staff_at(t.venue_id, app.staff_role()));
  elsif v_kind = 'marketing_request' then
    if to_regclass('public.marketing_requests') is null then
      return false;
    end if;
    return exists (select 1 from marketing_requests m
                    where m.id = v_ref
                      and m.venue_id = v_up.venue_id)
       and app.is_staff_at(v_up.venue_id, 'marketing');
  end if;
  return false;
end $staff_media_visible_0196$;

comment on function app.staff_media_visible(text) is
  'protocols_engine_rpcs (§2.3, §2.7 "Visibility"), re-issued by staff_media_folders (§2.24.2) and staff_media_incidents (wave5-addendum §2.4). True when the caller may read a staff-media photo: a marketing content item''s image only its uploader, and marketing and the owners at its venue (never a manager); any other photo its uploader and MGMT at its venue always; a protocol submission''s photo also its step''s sender and, on a step whose record is run-visible, anyone involved in the run; a marketing note''s photo also marketing at the venue; an idea''s photo also the holders of the idea''s team head role at its venue; a checklist tick''s photo also the holders of the list''s role at its venue; a teaching''s photo also its team at its venue while it is not archived; a request to marketing''s photo also marketing at its venue; an incident''s photo and anything else nobody else. False for a guest, another venue and any name that is not a staff-media path; never raises. The staff_media_read storage policy evaluates it as the reading role, hence the authenticated grant.';

revoke all on function app.staff_media_visible(text) from public, anon;
grant execute on function app.staff_media_visible(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. staff_media_delete — 0159, re-issued in 0164's guarded shape (dropped
--    and created in one block, so a refusal for privilege keeps the old
--    policy and says so): MGMT at the venue, as before, but never an
--    incident's photo. On hosted, assert after the push that
--    staff_media_delete names the incidents folder.
-- ---------------------------------------------------------------------------
do $storage_delete_0196$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema absent - skipping the staff_media_delete re-issue';
    return;
  end if;
  begin
    drop policy if exists staff_media_delete on storage.objects;
    create policy staff_media_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'staff-media'
             and app.is_staff('manager','owner')
             and app.staff_media_venue(name) = any(app.staff_venue_ids())
             and app.staff_media_folder(name) is distinct from 'incidents');
  exception when insufficient_privilege then
    raise notice 'cannot recreate staff_media_delete as % (%) - replace it via Dashboard > Storage > Policies with: bucket_id = ''staff-media'' and app.is_staff(''manager'',''owner'') and app.staff_media_venue(name) = any(app.staff_venue_ids()) and app.staff_media_folder(name) is distinct from ''incidents''',
      current_user, sqlerrm;
  end;
end $storage_delete_0196$;
