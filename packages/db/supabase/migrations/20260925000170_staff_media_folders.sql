-- 0170 staff_media_folders — three more work-photo folders, the bar and kitchen
-- teams, and who reads the photos of the role spec's new records.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.2, §2.1, §2.3; plan #64, #65, #69, #73).
-- Depends on: nothing uncommitted (0159 staff_media_bucket, 0164
-- protocols_engine_rpcs). teachings, checklist_photos and marketing_requests
-- (J) claim photos in the new folders; product_release (E) claims ideas'
-- photos and relies on the re-claim below.
-- Re-issues (§2.18): the two staff_media_uploads CHECKs, app.is_staff_media_path
-- and app.staff_media_slot from 0159; app.claim_staff_media and
-- app.staff_media_visible from 0164.
-- Re-runnable: drop constraint if exists before each add, guarded validates,
-- create or replace.
--
-- FOLDERS. checklists (photo ticks, #69), teachings (#64) and requests
-- (requests to marketing, #73) join the six of 0159. No storage policy is
-- dropped or created: staff_media_insert reads the slot row and
-- staff_media_read asks app.staff_media_visible, so neither names a folder.
-- app.staff_media_venue and app.staff_media_folder call is_staff_media_path,
-- so only their comments change.
--
-- TEAMS. app.staff_team maps head_barista and barista to 'bar', head_chef and
-- chef to 'kitchen', anything else to NULL; app.staff_team_head gives a team's
-- head role. Teachings (J) and ideas (E) are addressed by team. When the
-- parked assistant barista role (§0 P1) is answered, it joins 'bar' here.
--
-- WHO READS (app.staff_media_visible). The uploader and MGMT at the venue
-- still see everything; protocol-submission and marketing-note photos keep
-- their 0164 rules. Four used_by kinds join, each behind its table's
-- to_regclass (the 0164 pattern: E's release_ideas, and J's teachings and
-- marketing_requests, are created by later migrations):
--   release_idea:<id>       the holders of the idea's team head role at its venue;
--   checklist_item:<id>     the holders of the list's role at its venue;
--   teaching:<id>           the teaching's team at its venue, while it is not archived;
--   marketing_request:<id>  marketing at the request's venue.
-- Anything else stays the uploader's and MGMT's.
--
-- THE IDEA RE-CLAIM (app.claim_staff_media, #65). A head who starts a release
-- from an idea sends the idea's photos with the propose step: a path claimed
-- as release_idea:<id> may be claimed as protocol_submission:<sid> when that
-- submission is on the propose step of a product release whose data names
-- the idea, whoever uploaded it. used_by then names the submission; the idea
-- keeps the path in its own photos.
--
-- covered by packages/db/tests/staff-media-folders.test.ts (and teachings,
-- checklist-photos, marketing-requests, E's product-release for the rules
-- their tables bring)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. staff_media_uploads: the folder CHECK (auto-named by 0159) and the path
--    CHECK, dropped and added back NOT VALID with nine folders, then
--    validated under the lighter lock.
-- ---------------------------------------------------------------------------
alter table staff_media_uploads drop constraint if exists staff_media_uploads_folder_check;
alter table staff_media_uploads
  add constraint staff_media_uploads_folder_check
  check (folder in ('proposals','tests','steps','marketing','campaigns','receipts',
                    'checklists','teachings','requests'))
  not valid;

alter table staff_media_uploads drop constraint if exists staff_media_uploads_path_chk;
alter table staff_media_uploads
  add constraint staff_media_uploads_path_chk
  check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(proposals|tests|steps|marketing|campaigns|receipts|checklists|teachings|requests)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
         and split_part(path, '/', 1) = venue_id::text
         and split_part(path, '/', 2) = folder)
  not valid;

do $validate_folder_checks_0170$
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
end $validate_folder_checks_0170$;

comment on column staff_media_uploads.folder is
  'What the photo is for: proposals, tests, steps, marketing, campaigns, receipts, checklists, teachings or requests (receipts are read by their uploader and management only).';

-- ---------------------------------------------------------------------------
-- 2. The path helper, 0159 with the nine-folder grammar. Still pure text,
--    `immutable`, never raising, and granted to anon, authenticated and
--    service_role (the storage policies evaluate it as the reading role).
-- ---------------------------------------------------------------------------
create or replace function app.is_staff_media_path(p_name text) returns boolean
language sql immutable as $is_staff_media_path_0170$
  select coalesce(
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(proposals|tests|steps|marketing|campaigns|receipts|checklists|teachings|requests)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$',
    false)
$is_staff_media_path_0170$;

comment on function app.is_staff_media_path(text) is
  'staff_media_bucket (§2.3), re-issued by staff_media_folders (§2.24.2). True when a storage object name is a staff-media path, <venue_id>/<folder>/<uuid>.<jpg|png|webp> with one of the nine folders; false for anything else, NULL included. Pure text, never raises. Granted to anon, authenticated and service_role because the staff-media storage policies evaluate it as the reading role.';

comment on function app.staff_media_folder(text) is
  'staff_media_bucket (§2.3). The folder of a staff-media path (proposals, tests, steps, marketing, campaigns, receipts, checklists, teachings or requests); NULL for a name that is not a staff-media path. Policy-evaluated, hence the anon grant.';

revoke all on function app.is_staff_media_path(text) from public;
grant execute on function app.is_staff_media_path(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. app.staff_media_slot — 0159 verbatim, accepting the nine folders.
-- ---------------------------------------------------------------------------
create or replace function app.staff_media_slot(
  p_venue_id uuid,
  p_folder   text,
  p_ext      text
) returns jsonb
language plpgsql security definer set search_path = public as $staff_media_slot_0170$
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
                      'checklists','teachings','requests') then
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
end $staff_media_slot_0170$;

comment on function app.staff_media_slot(uuid, text, text) is
  'staff_media_bucket (§2.3), re-issued by staff_media_folders (§2.24.2). Any active staff member at the venue: mints an upload slot in one of the nine folders and returns {path, bucket: staff-media, expires_at}. The client uploads to exactly that path within the hour, then passes it to the recording RPC. INVALID_ARGUMENT (hint folder or ext); UPLOAD_LIMIT past 30 unused slots in the last hour.';

revoke all on function app.staff_media_slot(uuid, text, text) from public, anon;
grant execute on function app.staff_media_slot(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The two teams (§2.1). Internal: definer bodies call them.
-- ---------------------------------------------------------------------------
create or replace function app.staff_team(p_role staff_role) returns text
language sql immutable parallel safe set search_path = public as $staff_team_0170$
  select case
    when p_role in ('head_barista', 'barista') then 'bar'
    when p_role in ('head_chef', 'chef')       then 'kitchen'
  end
$staff_team_0170$;

comment on function app.staff_team(staff_role) is
  'staff_media_folders (§2.1, §2.24.2). Internal: the team a role belongs to, bar (head_barista, barista) or kitchen (head_chef, chef); NULL for every other role. The twin of @touch/core teamOf.';

revoke all on function app.staff_team(staff_role) from public, anon, authenticated;

create or replace function app.staff_team_head(p_team text) returns staff_role
language sql immutable parallel safe set search_path = public as $staff_team_head_0170$
  select case p_team
    when 'bar'     then 'head_barista'::staff_role
    when 'kitchen' then 'head_chef'::staff_role
  end
$staff_team_head_0170$;

comment on function app.staff_team_head(text) is
  'staff_media_folders (§2.1, §2.24.2). Internal: the head role of a team, head_barista for bar and head_chef for kitchen; NULL for anything else. The twin of @touch/core TEAM_HEAD.';

revoke all on function app.staff_team_head(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.claim_staff_media — 0164 verbatim, plus the idea re-claim (#65).
-- ---------------------------------------------------------------------------
create or replace function app.claim_staff_media(
  p_paths   text[],
  p_venue   uuid,
  p_folders text[],
  p_used_by text
) returns void
language plpgsql security definer set search_path = public as $claim_staff_media_0170$
declare
  c_sub  constant text := '^protocol_submission:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_idea constant text := '^release_idea:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_path text;
  v_row  staff_media_uploads%rowtype;
  v_ok   boolean;
begin
  if p_paths is null or cardinality(p_paths) = 0 then
    return;
  end if;
  if coalesce(btrim(p_used_by), '') = '' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'used_by';
  end if;

  -- Sorted, so two claims of overlapping paths lock them in the same order.
  for v_path in select distinct x from unnest(p_paths) as x order by 1 loop
    if v_path is null then
      raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
    end if;

    select * into v_row from staff_media_uploads where path = v_path for update;
    if not found
       or v_row.venue_id is distinct from p_venue
       or not (v_row.folder = any(coalesce(p_folders, '{}'::text[]))) then
      raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
    end if;

    if v_row.used_by is null then
      v_ok := v_row.uploader = auth.uid();
    elsif v_row.used_by = p_used_by then
      continue;                                   -- already this record's
    else
      v_ok := false;
      -- Nested, so the query below is only planned once its table exists.
      if v_row.used_by ~ c_sub and p_used_by ~ c_sub
         and to_regclass('public.protocol_submissions') is not null then
        v_ok := exists (
                  select 1
                    from protocol_submissions e
                    join protocol_submissions n
                      on n.run_step_id = e.run_step_id
                   where e.id = split_part(v_row.used_by, ':', 2)::uuid
                     and n.id = split_part(p_used_by, ':', 2)::uuid
                     and n.id <> e.id
                     and (e.withdrawn_at is not null
                          or e.superseded_at is not null
                          or e.decision = 'send_back'
                          or e.round < n.round));
      -- staff_media_folders (#65): an idea's photo moves to the propose step of
      -- the release its head started from it, whoever uploaded it.
      elsif v_row.used_by ~ c_idea and p_used_by ~ c_sub
            and to_regclass('public.release_ideas') is not null then
        v_ok := exists (
                  select 1
                    from protocol_submissions n
                    join protocol_run_steps s on s.id = n.run_step_id
                    join protocol_runs r      on r.id = n.run_id
                    join release_ideas i      on i.id = split_part(v_row.used_by, ':', 2)::uuid
                   where n.id = split_part(p_used_by, ':', 2)::uuid
                     and s.step_key = 'propose'
                     and r.kind = 'product_release'
                     and r.venue_id = i.venue_id
                     and r.data->>'idea_id' = i.id::text);
      end if;
    end if;

    if not coalesce(v_ok, false) then
      raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
    end if;

    update staff_media_uploads
       set used_at = now(), used_by = p_used_by
     where path = v_path;
  end loop;
end $claim_staff_media_0170$;

comment on function app.claim_staff_media(text[], uuid, text[], text) is
  'staff_media_bucket (§2.3), re-issued by protocols_engine_rpcs and staff_media_folders (§2.24.2). Internal: marks each path used by p_used_by (<kind>:<id>). PHOTO_PATH_INVALID unless the path is a slot at p_venue in one of p_folders that is unused and the caller''s, already this record''s, (a resubmission) claimed by a protocol submission of the same run step that was withdrawn, superseded or sent back, or belongs to an earlier round, or (an idea''s photo) claimed by release_idea:<id> while p_used_by is a submission on the propose step of the product release started from that idea. Called by the recording RPCs after the row that names the photos exists.';

revoke all on function app.claim_staff_media(text[], uuid, text[], text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.staff_media_visible — 0164 verbatim, plus the four role-spec kinds.
--    Still stable, a definer, and never raising: the staff_media_read policy
--    asks it for every object in storage.objects, menu-media's included.
-- ---------------------------------------------------------------------------
create or replace function app.staff_media_visible(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $staff_media_visible_0170$
declare
  c_sub  constant text := '^protocol_submission:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_ref  constant text := '^(release_idea|checklist_item|teaching|marketing_request):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
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
end $staff_media_visible_0170$;

comment on function app.staff_media_visible(text) is
  'protocols_engine_rpcs (§2.3, §2.7 "Visibility"), re-issued by staff_media_folders (§2.24.2). True when the caller may read a staff-media photo: its uploader and MGMT at its venue always; a protocol submission''s photo also its step''s sender and, on a step whose record is run-visible, anyone involved in the run; a marketing note''s photo also marketing at the venue; an idea''s photo also the holders of the idea''s team head role at its venue; a checklist tick''s photo also the holders of the list''s role at its venue; a teaching''s photo also its team at its venue while it is not archived; a request to marketing''s photo also marketing at its venue; nothing else to anyone else. False for a guest, another venue and any name that is not a staff-media path; never raises. The staff_media_read storage policy evaluates it as the reading role, hence the authenticated grant.';

revoke all on function app.staff_media_visible(text) from public, anon;
grant execute on function app.staff_media_visible(text) to authenticated, service_role;
