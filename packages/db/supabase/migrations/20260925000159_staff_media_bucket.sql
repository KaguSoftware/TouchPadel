-- 0159 staff_media_bucket — work photos from the staff phone and the operator's step
-- forms: upload slots, the private `staff-media` bucket and its storage policies.
--
-- Feature: protocols and the staff phone, lane G
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.3; plan §6.5).
-- Depends on: nothing. protocols_engine_rpcs (A), shopping_purchases and
-- marketing_staff (C) claim their photos through app.claim_staff_media.
-- Re-runnable: create or replace, if not exists, guarded adds.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- THE SHAPE. The server mints every path. staff_media_slot records a slot in
-- staff_media_uploads and returns `<venue_id>/<folder>/<uuid>.<ext>`; the
-- client uploads to exactly that name; the storage INSERT policy admits only an
-- unused slot of the uploader from the last hour; the recording RPC (a step
-- submission, a purchase, a marketing note) then claims the path through
-- app.claim_staff_media, which refuses a path that is not the caller's slot at
-- that venue in a folder the RPC allows. No RPC reads storage.objects.
--
-- WHO READS. Any active staff member at the path's venue reads its photos,
-- except receipts, which only their uploader and management read. Reads are
-- signed URLs (10 minutes) on both apps. Nothing here is public: the release
-- launch copies the one chosen photo into menu-media (§2.20).
--
-- THE PATH HELPERS NEVER RAISE. The staff-media policies sit on storage.objects
-- beside menu-media's (0031), and Postgres does not promise to test
-- `bucket_id = 'staff-media'` before a helper, so a helper that cast `items/…`
-- to uuid would break menu photos for every signed-in user. A name that fails
-- the grammar gives false / NULL.
--
-- covered by packages/db/tests/staff-media.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Path helpers. Pure text, `immutable`, and granted to anon, authenticated
--    and service_role: a storage policy evaluates them as the READING role (the
--    0116 → 0121 rule). The grammar is §2.3's `[0-9a-f-]{36}` written as the
--    canonical uuid shape, so the venue cast can never fail; every path the
--    server mints (gen_random_uuid, lower case) matches both.
-- ---------------------------------------------------------------------------
create or replace function app.is_staff_media_path(p_name text) returns boolean
language sql immutable as $is_staff_media_path_0159$
  select coalesce(
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(proposals|tests|steps|marketing|campaigns|receipts)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$',
    false)
$is_staff_media_path_0159$;

comment on function app.is_staff_media_path(text) is
  'staff_media_bucket (§2.3). True when a storage object name is a staff-media path, <venue_id>/<folder>/<uuid>.<jpg|png|webp>; false for anything else, NULL included. Pure text, never raises. Granted to anon, authenticated and service_role because the staff-media storage policies evaluate it as the reading role.';

create or replace function app.staff_media_venue(p_name text) returns uuid
language sql immutable as $staff_media_venue_0159$
  select case when app.is_staff_media_path(p_name) then split_part(p_name, '/', 1)::uuid end
$staff_media_venue_0159$;

comment on function app.staff_media_venue(text) is
  'staff_media_bucket (§2.3). The venue a staff-media path belongs to (its first segment); NULL for a name that is not a staff-media path, so a menu-media name never reaches the cast. Policy-evaluated, hence the anon grant.';

create or replace function app.staff_media_folder(p_name text) returns text
language sql immutable as $staff_media_folder_0159$
  select case when app.is_staff_media_path(p_name) then split_part(p_name, '/', 2) end
$staff_media_folder_0159$;

comment on function app.staff_media_folder(text) is
  'staff_media_bucket (§2.3). The folder of a staff-media path (proposals, tests, steps, marketing, campaigns or receipts); NULL for a name that is not a staff-media path. Policy-evaluated, hence the anon grant.';

revoke all on function app.is_staff_media_path(text) from public;
grant execute on function app.is_staff_media_path(text) to anon, authenticated, service_role;
revoke all on function app.staff_media_venue(text) from public;
grant execute on function app.staff_media_venue(text) to anon, authenticated, service_role;
revoke all on function app.staff_media_folder(text) from public;
grant execute on function app.staff_media_folder(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. staff_media_uploads — one row per minted slot. Written only by the
--    definers below; read by its uploader (the storage INSERT policy's subquery
--    runs as them). Never given app.assistant_readable_columns rows (§1.5).
-- ---------------------------------------------------------------------------
create table if not exists staff_media_uploads (
  path       text primary key,
  venue_id   uuid not null references venues(id),
  folder     text not null
             check (folder in ('proposals','tests','steps','marketing','campaigns','receipts')),
  uploader   uuid not null references staff(id),
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  used_by    text,
  -- The grammar, and the path agreeing with its own venue and folder, written
  -- out rather than through the helpers so no role needs EXECUTE to write here.
  constraint staff_media_uploads_path_chk check (
    path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(proposals|tests|steps|marketing|campaigns|receipts)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    and split_part(path, '/', 1) = venue_id::text
    and split_part(path, '/', 2) = folder),
  constraint staff_media_uploads_used_chk check ((used_at is null) = (used_by is null))
);

comment on table staff_media_uploads is
  'staff_media_bucket (§2.3): upload slots for work photos. staff_media_slot mints the path; the staff-media storage INSERT policy admits only an unused slot of the uploader from the last hour; app.claim_staff_media marks it used by the record that names it. Bookkeeping no screen reads; excluded from the owner assistant.';
comment on column staff_media_uploads.path is
  'The storage object name in bucket staff-media: <venue_id>/<folder>/<uuid>.<jpg|png|webp>.';
comment on column staff_media_uploads.venue_id is
  'The venue the photo belongs to; also the path''s first segment. Readers are staff at this venue.';
comment on column staff_media_uploads.folder is
  'What the photo is for: proposals, tests, steps, marketing, campaigns or receipts (receipts are read by their uploader and management only).';
comment on column staff_media_uploads.uploader is
  'The staff member the slot was minted for; only they may upload to it.';
comment on column staff_media_uploads.created_at is
  'When the slot was minted. The upload must happen within an hour of it.';
comment on column staff_media_uploads.used_at is
  'When a record first claimed the path (app.claim_staff_media); NULL = not claimed yet.';
comment on column staff_media_uploads.used_by is
  'The record that claims the path, as <kind>:<id> (for example protocol_submission:<uuid>); NULL = not claimed yet.';

create index if not exists staff_media_uploads_uploader_idx
  on staff_media_uploads (uploader, created_at);

alter table staff_media_uploads enable row level security;

drop policy if exists staff_media_uploads_read_own on staff_media_uploads;
create policy staff_media_uploads_read_own on staff_media_uploads
  for select to authenticated
  using (uploader = auth.uid());

grant select on staff_media_uploads to authenticated;
grant all    on staff_media_uploads to service_role;

-- ---------------------------------------------------------------------------
-- 3. The bucket and its storage policies, in 0031's guarded shape: storage
--    schema absent -> NOTICE; each policy tolerates duplicate_object; a
--    policy refused for privilege degrades to a NOTICE without rolling back
--    the bucket. On hosted, assert the three policies after the push (§1.6).
--
--    staff_media_read also admits the uploader's own receipts through
--    storage's owner_id (UNVERIFIED on the hosted storage version, §8.4). An
--    upload is an INSERT … RETURNING, so the uploader must pass this read
--    policy too: a receipt passes by owner_id, anything else by the venue.
-- ---------------------------------------------------------------------------
do $storage_0159$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent - skipping staff-media bucket + policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('staff-media', 'staff-media', false, 5242880,
          array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  begin
    begin
      create policy staff_media_insert on storage.objects
        for insert to authenticated
        with check (bucket_id = 'staff-media'
                    and exists (select 1
                                  from public.staff_media_uploads u
                                 where u.path = objects.name
                                   and u.uploader = auth.uid()
                                   and u.used_at is null
                                   and u.created_at > now() - interval '1 hour'));
    exception when duplicate_object then null;
    end;

    begin
      create policy staff_media_read on storage.objects
        for select to authenticated
        using (bucket_id = 'staff-media'
               and app.staff_role() is not null
               and app.staff_media_venue(name) = any(app.staff_venue_ids())
               and (app.staff_media_folder(name) <> 'receipts'
                    or owner_id = auth.uid()::text
                    or app.is_staff('manager','owner')));
    exception when duplicate_object then null;
    end;

    begin
      create policy staff_media_delete on storage.objects
        for delete to authenticated
        using (bucket_id = 'staff-media'
               and app.is_staff('manager','owner')
               and app.staff_media_venue(name) = any(app.staff_venue_ids()));
    exception when duplicate_object then null;
    end;
  exception when insufficient_privilege then
    raise notice 'cannot create policies on storage.objects as % (%) - create staff_media_insert / staff_media_read / staff_media_delete via Dashboard > Storage > Policies',
      current_user, sqlerrm;
  end;
exception when insufficient_privilege then
  raise notice 'storage.buckets not writable as % (%) - create the staff-media bucket and its policies via the Dashboard',
    current_user, sqlerrm;
end $storage_0159$;

-- ---------------------------------------------------------------------------
-- 4. app.staff_media_slot — any active staff member at the venue.
-- ---------------------------------------------------------------------------
create or replace function app.staff_media_slot(
  p_venue_id uuid,
  p_folder   text,
  p_ext      text
) returns jsonb
language plpgsql security definer set search_path = public as $staff_media_slot_0159$
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

  if v_folder not in ('proposals','tests','steps','marketing','campaigns','receipts') then
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
end $staff_media_slot_0159$;

comment on function app.staff_media_slot(uuid, text, text) is
  'staff_media_bucket (§2.3). Any active staff member at the venue: mints an upload slot and returns {path, bucket: staff-media, expires_at}. The client uploads to exactly that path within the hour, then passes it to the recording RPC. INVALID_ARGUMENT (hint folder or ext); UPLOAD_LIMIT past 30 unused slots in the last hour.';

revoke all on function app.staff_media_slot(uuid, text, text) from public, anon;
grant execute on function app.staff_media_slot(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.claim_staff_media — internal; every recording RPC calls it for its
--    photo arguments, after the row that names them exists.
--
--    A path is claimable when it is a slot at p_venue in one of p_folders and:
--      * unused, and minted for the caller; or
--      * already claimed by p_used_by (a replay of the same record); or
--      * RE-CLAIM ON RESUBMISSION (§2.3): claimed by protocol_submission:<a>
--        while p_used_by is protocol_submission:<b>, both of the same run step,
--        and <a> was withdrawn, superseded or sent back — whoever uploaded it.
--        So both apps keep the attached photos when a step is sent again. The
--        earlier submission keeps the path in its own photos array; only
--        used_by moves. protocol_submissions is A's table (protocols_engine_
--        tables); the branch is reached only by a used_by that names it.
--    Anything else raises PHOTO_PATH_INVALID, one code for every reason, so
--    the answer says nothing about another person's slots.
-- ---------------------------------------------------------------------------
create or replace function app.claim_staff_media(
  p_paths   text[],
  p_venue   uuid,
  p_folders text[],
  p_used_by text
) returns void
language plpgsql security definer set search_path = public as $claim_staff_media_0159$
declare
  c_sub  constant text := '^protocol_submission:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
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
                          or e.decision = 'send_back'));
      end if;
    end if;

    if not coalesce(v_ok, false) then
      raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
    end if;

    update staff_media_uploads
       set used_at = now(), used_by = p_used_by
     where path = v_path;
  end loop;
end $claim_staff_media_0159$;

comment on function app.claim_staff_media(text[], uuid, text[], text) is
  'staff_media_bucket (§2.3). Internal: marks each path used by p_used_by (<kind>:<id>). PHOTO_PATH_INVALID unless the path is a slot at p_venue in one of p_folders that is unused and the caller''s, already this record''s, or (a resubmission) claimed by a withdrawn, superseded or sent-back protocol submission of the same run step. Called by the recording RPCs after the row that names the photos exists.';

revoke all on function app.claim_staff_media(text[], uuid, text[], text) from public, anon, authenticated;
