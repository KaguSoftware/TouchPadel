-- 0354 venue_files — the Files page: documents the owner and the managers keep
-- in the system (contracts, licences, supplier price lists, reports), stored
-- compressed, and read by the owner assistant.
--
-- Feature: Files (Majed 2026-10-20: "for manager and owner, add a 'files'
-- section where they can upload documents and save them in the system, make
-- the assistant have access to those files too, make sure that any file
-- touching the database is compressed first").
-- Depends on: venues and staff_venues (0122, 0222), app.is_staff_at (0222),
-- app.write_audit (0005), the assistant dispatcher (0109, latest body 0330).
-- Re-runnable: create … if not exists, create or replace, guarded policies.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on a new, empty table
--
-- COMPRESSED FIRST. Nothing a person picks reaches storage as they picked it.
-- The operator compresses every file in the browser before the first byte is
-- sent (apps/operator/src/features/files/compress.ts): a photo is redrawn as
-- WebP (encoding `webp`), everything else is gzipped (encoding `gzip`). The
-- words inside a document (a PDF's text layer, a Word or Excel file's text,
-- a plain text file) are pulled out in the browser too, gzipped, and stored
-- beside it as `<id>.txt.gz`; that is what the assistant reads. The bucket
-- itself admits only application/gzip and image/webp, so an uncompressed
-- upload is refused by storage, not only by the page. This table holds the
-- metadata alone: names, sizes, who added it. No file content is stored in a
-- table.
--
-- THE SHAPE (0159's minted-path pattern). venue_file_begin records a row in
-- `uploading` and returns the paths; the operator uploads to exactly those
-- names (the storage INSERT policy admits only the uploader's own uploading
-- row from the last hour); venue_file_finish marks the row ready. A begin that
-- never finishes is ignored by every read and cleared by the same person's
-- next begin. Removing a file is the objects first, then the row: storage
-- finds an object through the read rule before it deletes it, so the row must
-- still be there, and the DELETE rule admits only someone who may remove that
-- file (the owner, or the manager who added it). venue_file_delete then
-- removes the row (audited). Objects removed with no row delete after them
-- leave a row whose download fails; removing it again finishes the job.
--
-- WHO. The owner and the managers of the branch read, add and rename. A file
-- the owner marks owner_only is the owner's alone: hidden from managers in
-- every read, every storage read and every assistant tool. A manager removes
-- only what they added; the owner removes anything.
--
-- THE ASSISTANT. Two owner-only reads behind app.assistant_run_tool's
-- read-only wall: assistant_files_list (names, notes, sizes, whether the text
-- is readable) and assistant_file_get (one file's details and where its text
-- is). The assistant-chat function then downloads the text object as the
-- owner (the storage read policy applies), gunzips it and hands a window of it
-- to the model through clean(), which pseudonymises phone numbers and e-mail
-- addresses like any other tool result.
--
-- covered by packages/db/tests/venue-files.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. venue_files — one row per stored file. No client grant: every read and
--    write is an RPC below, and the storage policies read it through definer
--    helpers.
-- ---------------------------------------------------------------------------
create table if not exists venue_files (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null default app.current_venue() references venues(id),
  name         text not null,
  note         text,
  mime         text not null,
  size_bytes   bigint not null,
  stored_bytes bigint not null,
  encoding     text not null,
  blob_path    text not null,
  text_path    text,
  text_bytes   bigint,
  text_chars   integer,
  owner_only   boolean not null default false,
  status       text not null default 'uploading',
  uploaded_by  uuid not null references staff(id),
  created_at   timestamptz not null default now(),
  ready_at     timestamptz,
  constraint venue_files_name_len check (char_length(name) between 1 and 200),
  constraint venue_files_note_len check (note is null or char_length(note) between 1 and 500),
  constraint venue_files_mime_chk check (char_length(mime) <= 120 and mime ~ '^[a-z0-9][a-z0-9.+_-]*/[a-z0-9][a-z0-9.+_-]*$'),
  constraint venue_files_size_chk check (size_bytes between 1 and 52428800),
  constraint venue_files_stored_chk check (stored_bytes between 1 and 52428800),
  constraint venue_files_encoding_chk check (encoding in ('gzip', 'webp')),
  constraint venue_files_status_chk check (status in ('uploading', 'ready')),
  constraint venue_files_ready_chk check ((status = 'ready') = (ready_at is not null)),
  -- The minted names, written out so no role needs EXECUTE to write here.
  constraint venue_files_blob_path_chk check (
    blob_path = venue_id::text || '/' || id::text || case encoding when 'webp' then '.webp' else '.gz' end),
  constraint venue_files_text_path_chk check (
    text_path is null or text_path = venue_id::text || '/' || id::text || '.txt.gz'),
  constraint venue_files_text_chk check (
    (text_path is null) = (text_bytes is null)
    and (text_bytes is null or text_bytes between 1 and 52428800)
    and (text_chars is null or text_chars between 1 and 500000)
    and (status = 'uploading' or (text_path is null) = (text_chars is null)))
);

create unique index if not exists venue_files_blob_path_key on venue_files (blob_path);
create unique index if not exists venue_files_text_path_key on venue_files (text_path) where text_path is not null;
create index if not exists venue_files_venue_idx on venue_files (venue_id, status, ready_at desc);

comment on table venue_files is
  'venue_files (0354): the Files page. One row per document the owner or a manager stored; the file itself is in the private venue-files bucket, compressed in the browser first (gzip, or WebP for a photo), and its words beside it as <id>.txt.gz. No client grant: app.venue_files_list / venue_file_begin / venue_file_finish / venue_file_update / venue_file_delete, and the owner assistant through assistant_files_list and assistant_file_get.';
comment on column venue_files.name is 'The file''s name as the person gave it (the picked file''s name unless renamed).';
comment on column venue_files.note is 'Optional: what the file is, in the adder''s words. The assistant reads it.';
comment on column venue_files.mime is 'The original file''s type (application/pdf, image/jpeg, …), restored on download.';
comment on column venue_files.size_bytes is 'The original file''s size, before compression.';
comment on column venue_files.stored_bytes is 'The compressed object''s size in storage.';
comment on column venue_files.encoding is 'How the stored object is compressed: gzip (any file; download gunzips it back to the original bytes) or webp (a photo redrawn as WebP).';
comment on column venue_files.blob_path is 'The object in bucket venue-files: <venue_id>/<id>.gz or <venue_id>/<id>.webp.';
comment on column venue_files.text_path is 'The gzipped words of the file, <venue_id>/<id>.txt.gz, read by the owner assistant; NULL when the file had no readable text (a photo, a scanned PDF).';
comment on column venue_files.text_bytes is 'The gzipped text object''s size; NULL with text_path.';
comment on column venue_files.text_chars is 'How many characters the text holds once unzipped; NULL with text_path.';
comment on column venue_files.owner_only is 'True: only the owner sees and reads the file (and only the owner''s assistant). Set by the owner only.';
comment on column venue_files.status is 'uploading between venue_file_begin and venue_file_finish, then ready. Only ready rows are shown.';
comment on column venue_files.uploaded_by is 'Who added the file.';
comment on column venue_files.ready_at is 'When the upload finished; NULL while uploading.';

alter table venue_files enable row level security;
grant all on venue_files to service_role;

-- A branch table (0230): a staff writer must be at the row's branch unless a
-- definer asserted it (app.venue_files_venue does).
drop trigger if exists zz_branch_guard on public.venue_files;
create trigger zz_branch_guard before insert or update or delete on public.venue_files
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 2. The storage helpers. A storage policy evaluates them as the READING role,
--    so they are granted to anon, authenticated and service_role (the 0116 →
--    0121 rule). They never raise: the venue-files policies sit on
--    storage.objects beside every other bucket's, and Postgres does not
--    promise to test bucket_id first.
-- ---------------------------------------------------------------------------
create or replace function app.is_venue_file_path(p_name text) returns boolean
language sql immutable as $is_venue_file_path_0354$
  select coalesce(
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(gz|webp|txt\.gz)$',
    false)
$is_venue_file_path_0354$;

comment on function app.is_venue_file_path(text) is
  'venue_files (0354). True when a storage object name is a venue-files path, <venue_id>/<file_id>.<gz|webp|txt.gz>; false for anything else, NULL included. Pure text, never raises; policy-evaluated, hence the anon grant.';

create or replace function app.venue_file_object_readable(p_name text) returns boolean
language sql stable security definer set search_path = public as $venue_file_object_readable_0354$
  select app.is_venue_file_path(p_name)
     and exists (select 1
                   from venue_files f
                  where (f.blob_path = p_name or f.text_path = p_name)
                    and app.is_staff_at(f.venue_id, 'manager', 'owner')
                    and (not f.owner_only or app.is_staff('owner')))
$venue_file_object_readable_0354$;

comment on function app.venue_file_object_readable(text) is
  'venue_files (0354). The venue-files storage read rule: a row points at the object, the caller is a manager or the owner at its branch, and an owner_only file is read by the owner alone. Never raises; policy-evaluated, hence the anon grant (false for anon).';

create or replace function app.venue_file_object_uploadable(p_name text) returns boolean
language sql stable security definer set search_path = public as $venue_file_object_uploadable_0354$
  select app.is_venue_file_path(p_name)
     and exists (select 1
                   from venue_files f
                  where (f.blob_path = p_name or f.text_path = p_name)
                    and f.status = 'uploading'
                    and f.uploaded_by = auth.uid()
                    and f.created_at > now() - interval '1 hour')
$venue_file_object_uploadable_0354$;

comment on function app.venue_file_object_uploadable(text) is
  'venue_files (0354). The venue-files storage insert rule: the name is one app.venue_file_begin minted for the caller less than an hour ago, and the file is not finished yet. Never raises; policy-evaluated, hence the anon grant.';

create or replace function app.venue_file_object_removable(p_name text) returns boolean
language sql stable security definer set search_path = public as $venue_file_object_removable_0354$
  select app.is_venue_file_path(p_name)
     and exists (select 1
                   from venue_files f
                  where (f.blob_path = p_name or f.text_path = p_name)
                    and app.is_staff_at(f.venue_id, 'manager', 'owner')
                    and (app.is_staff('owner') or (f.uploaded_by = auth.uid() and not f.owner_only)))
$venue_file_object_removable_0354$;

comment on function app.venue_file_object_removable(text) is
  'venue_files (0354). The venue-files storage delete rule: a row points at the object and the caller may remove that file (the owner, or the manager who added it), the same rule as app.venue_file_delete, which removes the row after the objects. Never raises; policy-evaluated, hence the anon grant.';

revoke all on function app.is_venue_file_path(text) from public;
grant execute on function app.is_venue_file_path(text) to anon, authenticated, service_role;
revoke all on function app.venue_file_object_readable(text) from public;
grant execute on function app.venue_file_object_readable(text) to anon, authenticated, service_role;
revoke all on function app.venue_file_object_uploadable(text) from public;
grant execute on function app.venue_file_object_uploadable(text) to anon, authenticated, service_role;
revoke all on function app.venue_file_object_removable(text) from public;
grant execute on function app.venue_file_object_removable(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The bucket and its policies, in 0031's guarded shape: storage schema
--    absent -> NOTICE; each policy tolerates duplicate_object; a policy
--    refused for privilege degrades to a NOTICE. On hosted, assert the three
--    policies after the push. 50 MB per object (the hosted global limit);
--    gzip and WebP only, so storage itself refuses an uncompressed file.
-- ---------------------------------------------------------------------------
do $storage_0354$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent - skipping venue-files bucket + policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('venue-files', 'venue-files', false, 52428800, array['application/gzip', 'image/webp'])
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  begin
    begin
      create policy venue_files_insert on storage.objects
        for insert to authenticated
        with check (bucket_id = 'venue-files' and app.venue_file_object_uploadable(name));
    exception when duplicate_object then null;
    end;

    -- An upload is an INSERT … RETURNING, so the uploader passes this too:
    -- their uploading row points at the name.
    begin
      create policy venue_files_read on storage.objects
        for select to authenticated
        using (bucket_id = 'venue-files' and app.venue_file_object_readable(name));
    exception when duplicate_object then null;
    end;

    begin
      create policy venue_files_delete on storage.objects
        for delete to authenticated
        using (bucket_id = 'venue-files' and app.venue_file_object_removable(name));
    exception when duplicate_object then null;
    end;
  exception when insufficient_privilege then
    raise notice 'cannot create policies on storage.objects as % (%) - create venue_files_insert / venue_files_read / venue_files_delete via Dashboard > Storage > Policies',
      current_user, sqlerrm;
  end;
exception when insufficient_privilege then
  raise notice 'storage.buckets not writable as % (%) - create the venue-files bucket and its policies via the Dashboard',
    current_user, sqlerrm;
end $storage_0354$;

-- ---------------------------------------------------------------------------
-- 4. Internal helpers
-- ---------------------------------------------------------------------------

-- What one branch may keep, compressed: 2 GB. Stable with a SET clause, not
-- immutable: an inlinable revoked sql helper runs for any caller through a
-- pooled generic plan (tests/sql-helpers-not-inlinable.test.ts).
create or replace function app.venue_files_quota_bytes() returns bigint
language sql stable set search_path = public as $venue_files_quota_bytes_0354$
  select 2147483648::bigint
$venue_files_quota_bytes_0354$;

comment on function app.venue_files_quota_bytes() is
  'venue_files (0354). Internal: the compressed bytes one branch may keep in the venue-files bucket (2 GB). app.venue_file_begin refuses a file past it with FILES_QUOTA_FULL.';
revoke all on function app.venue_files_quota_bytes() from public, anon, authenticated;
grant execute on function app.venue_files_quota_bytes() to service_role;

-- The branch of a Files call: p_venue_id, else the one in scope; FORBIDDEN
-- unless the caller is a manager or the owner there. Asserts app.venue_id.
create or replace function app.venue_files_venue(p_venue_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $venue_files_venue_0354$
declare
  v_venue uuid;
begin
  v_venue := coalesce(p_venue_id, app.current_venue());
  if v_venue is null
     or not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  return v_venue;
end $venue_files_venue_0354$;

comment on function app.venue_files_venue(uuid) is
  'venue_files (0354). Internal: the branch of a Files call (p_venue_id, else app.current_venue()), FORBIDDEN unless the caller is a manager or the owner there; asserts app.venue_id.';
revoke all on function app.venue_files_venue(uuid) from public, anon, authenticated;
grant execute on function app.venue_files_venue(uuid) to service_role;

-- One file as the Files page shows it. Internal; the callers have already
-- decided the caller may see it.
create or replace function app.venue_file_json(f venue_files)
returns jsonb
language sql stable security definer set search_path = public as $venue_file_json_0354$
  select jsonb_build_object(
    'id',               f.id,
    'name',             f.name,
    'note',             f.note,
    'mime',             f.mime,
    'size_bytes',       f.size_bytes,
    'stored_bytes',     f.stored_bytes + coalesce(f.text_bytes, 0),
    'encoding',         f.encoding,
    'blob_path',        f.blob_path,
    'text_path',        f.text_path,
    'has_text',         f.text_path is not null,
    'text_chars',       f.text_chars,
    'owner_only',       f.owner_only,
    'uploaded_by',      f.uploaded_by,
    'uploaded_by_name', (select s.display_name from staff s where s.id = f.uploaded_by),
    'added_at',         coalesce(f.ready_at, f.created_at),
    'can_delete',       app.is_staff('owner') or f.uploaded_by = auth.uid())
$venue_file_json_0354$;

comment on function app.venue_file_json(venue_files) is
  'venue_files (0354). Internal: one file as the Files page shows it (stored_bytes counts the text object too; text_path for removing it; can_delete for the owner or the adder).';
revoke all on function app.venue_file_json(venue_files) from public, anon, authenticated;
grant execute on function app.venue_file_json(venue_files) to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.venue_files_list — the Files page.
-- ---------------------------------------------------------------------------
create or replace function app.venue_files_list(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $venue_files_list_0354$
declare
  v_venue uuid;
  v_owner boolean;
  v_files jsonb;
  v_used  bigint;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := app.venue_files_venue(p_venue_id);
  v_owner := app.is_staff('owner');

  select coalesce(jsonb_agg(app.venue_file_json(f) order by f.ready_at desc, f.id), '[]'::jsonb)
    into v_files
    from venue_files f
   where f.venue_id = v_venue
     and f.status = 'ready'
     and (v_owner or not f.owner_only);

  -- The quota counts every file of the branch, the owner's own included, so
  -- a manager is not surprised by a full store they cannot see into.
  select coalesce(sum(f.stored_bytes + coalesce(f.text_bytes, 0)), 0)
    into v_used
    from venue_files f
   where f.venue_id = v_venue
     and (f.status = 'ready' or f.created_at > now() - interval '1 hour');

  return jsonb_build_object(
    'venue_id',    v_venue,
    'files',       v_files,
    'used_bytes',  v_used,
    'quota_bytes', app.venue_files_quota_bytes(),
    'is_owner',    v_owner);
end $venue_files_list_0354$;

comment on function app.venue_files_list(uuid) is
  'venue_files (0354). The Files page: the branch''s finished files, newest first (an owner_only file for the owner alone), with used_bytes against quota_bytes. Manager or owner at the branch; FORBIDDEN otherwise.';
revoke all on function app.venue_files_list(uuid) from public, anon;
grant execute on function app.venue_files_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.venue_file_begin — before the upload: record the file, mint the paths.
--    The browser has already compressed the file and its text, so the sizes
--    here are the compressed ones that will be stored.
-- ---------------------------------------------------------------------------
create or replace function app.venue_file_begin(
  p_name         text,
  p_mime         text,
  p_size_bytes   bigint,
  p_stored_bytes bigint,
  p_encoding     text,
  p_text_bytes   bigint default null,
  p_note         text default null,
  p_owner_only   boolean default false,
  p_venue_id     uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $venue_file_begin_0354$
declare
  v_venue uuid;
  v_id    uuid := gen_random_uuid();
  v_name  text := app.safe_line(p_name);
  v_note  text := nullif(app.safe_text(p_note), '');
  v_mime  text := lower(btrim(coalesce(p_mime, '')));
  v_used  bigint;
  v_blob  text;
  v_text  text;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := app.venue_files_venue(p_venue_id);

  if coalesce(p_owner_only, false) and not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'owner_only';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'name';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'note';
  end if;
  if v_mime = '' then
    v_mime := 'application/octet-stream';
  end if;
  if char_length(v_mime) > 120 or v_mime !~ '^[a-z0-9][a-z0-9.+_-]*/[a-z0-9][a-z0-9.+_-]*$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'mime';
  end if;
  if p_encoding is null or p_encoding not in ('gzip', 'webp') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'encoding';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_stored_bytes is null or p_stored_bytes < 1
     or (p_text_bytes is not null and p_text_bytes < 1) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'size';
  end if;
  if p_size_bytes > 52428800 or p_stored_bytes > 52428800 or coalesce(p_text_bytes, 0) > 52428800 then
    raise exception 'FILE_TOO_LARGE' using errcode = 'P0001';
  end if;

  -- The caller's own uploads that never finished are dropped; their objects,
  -- if any landed, are now orphans the storage delete rule admits.
  delete from venue_files
   where venue_id = v_venue
     and uploaded_by = auth.uid()
     and status = 'uploading'
     and created_at <= now() - interval '1 hour';

  -- One branch at a time, so two uploads cannot both squeeze under the quota.
  perform pg_advisory_xact_lock(hashtextextended('app.venue_files:' || v_venue::text, 0));
  select coalesce(sum(f.stored_bytes + coalesce(f.text_bytes, 0)), 0)
    into v_used
    from venue_files f
   where f.venue_id = v_venue
     and (f.status = 'ready' or f.created_at > now() - interval '1 hour');
  if v_used + p_stored_bytes + coalesce(p_text_bytes, 0) > app.venue_files_quota_bytes() then
    raise exception 'FILES_QUOTA_FULL' using errcode = 'P0001';
  end if;

  v_blob := v_venue::text || '/' || v_id::text || case p_encoding when 'webp' then '.webp' else '.gz' end;
  v_text := case when p_text_bytes is not null then v_venue::text || '/' || v_id::text || '.txt.gz' end;

  insert into venue_files (id, venue_id, name, note, mime, size_bytes, stored_bytes, encoding,
                           blob_path, text_path, text_bytes, owner_only, uploaded_by)
  values (v_id, v_venue, v_name, v_note, v_mime, p_size_bytes, p_stored_bytes, p_encoding,
          v_blob, v_text, p_text_bytes, coalesce(p_owner_only, false), auth.uid());

  return jsonb_build_object('id', v_id, 'blob_path', v_blob, 'text_path', v_text);
end $venue_file_begin_0354$;

comment on function app.venue_file_begin(text, text, bigint, bigint, text, bigint, text, boolean, uuid) is
  'venue_files (0354). Before an upload: records the file (uploading) and returns {id, blob_path, text_path}, the only names the storage insert rule admits, for an hour. The sizes are the compressed ones (the browser compresses first). Manager or owner at the branch; owner_only by the owner. FORBIDDEN, INVALID_ARGUMENT, FILE_TOO_LARGE, FILES_QUOTA_FULL.';
revoke all on function app.venue_file_begin(text, text, bigint, bigint, text, bigint, text, boolean, uuid) from public, anon;
grant execute on function app.venue_file_begin(text, text, bigint, bigint, text, bigint, text, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.venue_file_finish — after the upload. p_text_chars NULL says the text
--    object was not stored (none, or its upload failed): the file keeps no
--    text and the assistant sees only its name and note.
-- ---------------------------------------------------------------------------
create or replace function app.venue_file_finish(p_id uuid, p_text_chars integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $venue_file_finish_0354$
declare
  f venue_files;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into f from venue_files where id = p_id for update;
  if not found or f.uploaded_by is distinct from auth.uid() or f.status <> 'uploading' then
    raise exception 'FILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.venue_files_venue(f.venue_id);
  if p_text_chars is not null and (f.text_path is null or p_text_chars not between 1 and 500000) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'text_chars';
  end if;

  update venue_files
     set status     = 'ready',
         ready_at   = now(),
         text_chars = p_text_chars,
         text_path  = case when p_text_chars is null then null else text_path end,
         text_bytes = case when p_text_chars is null then null else text_bytes end
   where id = p_id
  returning * into f;

  perform app.write_audit('file.add', 'venue_file', f.id::text, null,
                          jsonb_build_object('name', f.name, 'mime', f.mime, 'size_bytes', f.size_bytes,
                                             'stored_bytes', f.stored_bytes, 'encoding', f.encoding,
                                             'has_text', f.text_path is not null, 'owner_only', f.owner_only));
  return app.venue_file_json(f);
end $venue_file_finish_0354$;

comment on function app.venue_file_finish(uuid, integer) is
  'venue_files (0354). After an upload: marks the caller''s uploading file ready (and audits file.add). p_text_chars is the length of the text object stored beside it, NULL when none was stored. FILE_NOT_FOUND for another person''s file or one already finished.';
revoke all on function app.venue_file_finish(uuid, integer) from public, anon;
grant execute on function app.venue_file_finish(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.venue_file_update — rename, note, and (the owner) who may see it.
-- ---------------------------------------------------------------------------
create or replace function app.venue_file_update(
  p_id         uuid,
  p_name       text,
  p_note       text default null,
  p_owner_only boolean default null
) returns jsonb
language plpgsql security definer set search_path = public as $venue_file_update_0354$
declare
  f      venue_files;
  v_name text := app.safe_line(p_name);
  v_note text := nullif(app.safe_text(p_note), '');
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into f from venue_files where id = p_id and status = 'ready' for update;
  if not found or (f.owner_only and not app.is_staff('owner')) then
    raise exception 'FILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.venue_files_venue(f.venue_id);
  if p_owner_only is not null and p_owner_only <> f.owner_only and not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'owner_only';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'name';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'note';
  end if;

  update venue_files
     set name       = v_name,
         note       = v_note,
         owner_only = coalesce(p_owner_only, owner_only)
   where id = p_id
  returning * into f;

  perform app.write_audit('file.edit', 'venue_file', f.id::text, null,
                          jsonb_build_object('name', f.name, 'owner_only', f.owner_only));
  return app.venue_file_json(f);
end $venue_file_update_0354$;

comment on function app.venue_file_update(uuid, text, text, boolean) is
  'venue_files (0354). Renames a file and sets its note (both written whole); p_owner_only (the owner only) says who may see it. Manager or owner at the file''s branch; a manager never reaches an owner_only file (FILE_NOT_FOUND).';
revoke all on function app.venue_file_update(uuid, text, text, boolean) from public, anon;
grant execute on function app.venue_file_update(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.venue_file_delete — removes the row, after the operator removed the
--    objects (the storage delete rule needs the row). Hands back the paths so
--    a caller that skipped storage can still clear them.
-- ---------------------------------------------------------------------------
create or replace function app.venue_file_delete(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $venue_file_delete_0354$
declare
  f venue_files;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into f from venue_files where id = p_id and status = 'ready' for update;
  if not found or (f.owner_only and not app.is_staff('owner')) then
    raise exception 'FILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.venue_files_venue(f.venue_id);
  if not app.is_staff('owner') and f.uploaded_by is distinct from auth.uid() then
    raise exception 'FILE_NOT_YOURS' using errcode = 'P0001';
  end if;

  delete from venue_files where id = p_id;

  perform app.write_audit('file.remove', 'venue_file', f.id::text,
                          jsonb_build_object('name', f.name, 'mime', f.mime, 'size_bytes', f.size_bytes,
                                             'uploaded_by', f.uploaded_by, 'owner_only', f.owner_only),
                          null);
  return jsonb_build_object('id', f.id, 'paths', to_jsonb(array_remove(array[f.blob_path, f.text_path], null)));
end $venue_file_delete_0354$;

comment on function app.venue_file_delete(uuid) is
  'venue_files (0354). Removes a file''s row (audited file.remove) and returns {id, paths}, its storage objects, which the caller removes BEFORE this call (the storage delete rule needs the row). The owner removes any file; a manager only one they added (FILE_NOT_YOURS).';
revoke all on function app.venue_file_delete(uuid) from public, anon;
grant execute on function app.venue_file_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The owner assistant's two reads (tools files_list and file_read). Both
--     are reached only through app.assistant_run_tool (owner-only, read-only).
-- ---------------------------------------------------------------------------
create or replace function app.assistant_files_list(p_query text default null, p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_files_list_0354$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_files jsonb;
  v_total int;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  with hits as (
    select f.*, v.name_en as branch
      from venue_files f
      join venues v on v.id = f.venue_id
     where f.status = 'ready'
       and f.venue_id = any((select app.visible_venue_ids())::uuid[])
       and (v_query is null
            or f.name ilike '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
            or f.note ilike '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%')
  )
  select (select count(*) from hits),
         coalesce((select jsonb_agg(x.j order by x.ready_at desc)
                     from (select h.ready_at,
                                  jsonb_build_object(
                                    'id',         h.id,
                                    'name',       h.name,
                                    'note',       h.note,
                                    'type',       h.mime,
                                    'size_kb',    ceil(h.size_bytes / 1024.0)::bigint,
                                    'readable',   h.text_path is not null,
                                    'text_chars', h.text_chars,
                                    'owner_only', h.owner_only,
                                    'branch',     h.branch,
                                    'added_by',   (select s.display_name from staff s where s.id = h.uploaded_by),
                                    'added_at',   h.ready_at) as j
                             from hits h
                            order by h.ready_at desc
                            limit v_limit) x), '[]'::jsonb)
    into v_total, v_files;

  return jsonb_build_object('files', v_files, 'total', v_total);
end $assistant_files_list_0354$;

comment on function app.assistant_files_list(text, int) is
  '0354. Owner-only, read-only, reached through app.assistant_run_tool (tool files_list). The finished files on the Files page of the branches in scope, newest first: name, note, type, size, whether the words are readable (readable, text_chars), owner_only, branch, who added it and when. p_query matches the name or the note. At most 100.';
revoke all on function app.assistant_files_list(text, int) from public, anon;
grant execute on function app.assistant_files_list(text, int) to authenticated;

create or replace function app.assistant_file_get(p_file_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_file_get_0354$
declare
  r record;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select f.*, v.name_en as branch into r
    from venue_files f
    join venues v on v.id = f.venue_id
   where f.id = p_file_id
     and f.status = 'ready'
     and f.venue_id = any((select app.visible_venue_ids())::uuid[]);
  if not found then
    raise exception 'FILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'id',         r.id,
    'name',       r.name,
    'note',       r.note,
    'type',       r.mime,
    'size_kb',    ceil(r.size_bytes / 1024.0)::bigint,
    'text_path',  r.text_path,
    'text_chars', r.text_chars,
    'owner_only', r.owner_only,
    'branch',     r.branch,
    'added_by',   (select s.display_name from staff s where s.id = r.uploaded_by),
    'added_at',   r.ready_at);
end $assistant_file_get_0354$;

comment on function app.assistant_file_get(uuid) is
  '0354. Owner-only, read-only, reached through app.assistant_run_tool (tool file_read). One finished file of the branches in scope with text_path, the gzipped words the assistant-chat function downloads as the owner and unzips; text_path NULL when the file has no readable text. FILE_NOT_FOUND.';
revoke all on function app.assistant_file_get(uuid) from public, anon;
grant execute on function app.assistant_file_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. app.assistant_run_tool — re-issued from 20261009000330:763 with two
--     branches (assistant_files_list, assistant_file_get)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_run_tool(p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_run_tool_0354$
declare
  a           jsonb := coalesce(p_args, '{}'::jsonb);
  v_result    jsonb;
  v_path      text;                 -- the catalog's rows_path for this tool
  v_count     int;
  v_truncated boolean;
  v_scope     text;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The wall. STABLE is a promise; this is the enforcement: from here to the
  -- end of the transaction any INSERT/UPDATE/DELETE/DDL reached through a
  -- dispatched RPC fails with 25006 read_only_sql_transaction.
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('statement_timeout', '8000', true);

  if jsonb_typeof(a) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_args', hint = 'an object of p_* keys';
  end if;

  case p_tool
    -- ── Money and headline ────────────────────────────────────────────────
    when 'panel_headline' then
      v_path := 'figures';
      v_result := app.panel_headline((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_compare', 'none'));
    when 'report_revenue' then
      v_path := 'rows';
      v_result := app.report_revenue((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     coalesce(a ->> 'p_group', 'day'), coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_compare' then
      v_result := app.report_compare(a ->> 'p_report', (a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     a ->> 'p_compare', coalesce(a ->> 'p_group', 'day'),
                                     coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_drill' then
      -- The RPC's row array is 'transactions' (the catalog says 'rows'; the
      -- dispatcher follows the RPC so row_count is real, and the mismatch is
      -- reported to the catalog's owner).
      v_path := 'transactions';
      v_result := app.report_drill(a ->> 'p_figure', a ->> 'p_key', (a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'assistant_payments_list' then
      v_path := 'rows';
      v_result := app.assistant_payments_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_method',
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Cafe ──────────────────────────────────────────────────────────────
    when 'report_cafe' then
      v_result := app.report_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_daily_sales' then
      v_path := '$';
      v_result := app.analytics_daily_sales((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_sold_items' then
      v_path := '$';
      v_result := app.analytics_sold_items((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_best_sellers' then
      v_path := '$';
      v_result := app.analytics_best_sellers((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                             coalesce((a ->> 'p_limit')::int, 20), coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_item_margins' then
      v_result := app.analytics_item_margins((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_price_bands' then
      v_path := '$';
      v_result := app.analytics_price_bands((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_hourly' then
      v_path := '$';
      v_result := app.analytics_hourly((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_bought_together' then
      v_path := '$';
      -- The RPC's basket scope is 'order' | 'tab'; anything else falls back to
      -- its default rather than failing the whole turn.
      v_scope := case when a ->> 'p_scope' in ('order', 'tab') then a ->> 'p_scope' else 'order' end;
      v_result := app.analytics_bought_together((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                                coalesce((a ->> 'p_min_support')::int, 3),
                                                coalesce((a ->> 'p_limit')::int, 30), v_scope);
    when 'analytics_menu_snapshot' then
      v_result := app.analytics_menu_snapshot();
    when 'assistant_tabs_list' then
      v_path := 'rows';
      v_result := app.assistant_tabs_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_status',
                                          (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Courts ────────────────────────────────────────────────────────────
    when 'report_courts' then
      v_result := app.report_courts((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_courts_summary' then
      v_result := app.analytics_courts_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_demand' then
      v_result := app.analytics_courts_demand((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_endings' then
      v_result := app.analytics_courts_endings((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_guests' then
      v_result := app.analytics_courts_guests((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_cafe' then
      v_result := app.analytics_courts_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'assistant_bookings_list' then
      v_path := 'rows';
      v_result := app.assistant_bookings_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid,
                                              a ->> 'p_status', (a ->> 'p_customer_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);
    when 'booking_bill' then
      v_result := app.booking_bill((a ->> 'p_reservation_id')::uuid);
    when 'series_detail' then
      v_result := app.series_detail((a ->> 'p_series_id')::uuid);
    when 'assistant_courts_and_rates' then
      v_result := app.assistant_courts_and_rates();

    -- ── Stock ─────────────────────────────────────────────────────────────
    when 'report_stock' then
      v_result := app.report_stock((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'assistant_stock_view' then
      v_path := 'rows';
      v_result := app.assistant_stock_view(a ->> 'p_view', (a ->> 'p_limit')::int, (a ->> 'p_offset')::int);

    -- ── Staff and ops ─────────────────────────────────────────────────────
    when 'ops_overview' then
      v_result := app.ops_overview();
    when 'list_staff' then
      v_path := '$';
      select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_result from app.list_staff() s;
    when 'staff_requests_page' then
      v_path := 'requests';   -- the RPC returns {requests, total, pending}; the catalog says the same
      v_result := app.staff_requests_page(a ->> 'p_status', coalesce((a ->> 'p_limit')::int, 50),
                                          coalesce((a ->> 'p_offset')::int, 0));
    when 'report_staff_activity' then
      v_path := 'rows';
      v_result := app.report_staff_activity((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid);
    when 'assistant_break_history' then
      v_path := 'rows';
      v_result := app.assistant_break_history((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Audit ─────────────────────────────────────────────────────────────
    when 'assistant_audit_page' then
      v_path := 'rows';
      v_result := app.assistant_audit_page((a ->> 'p_from')::timestamptz, (a ->> 'p_to')::timestamptz,
                                           (a ->> 'p_actor_id')::uuid, a ->> 'p_action_prefix', a ->> 'p_text',
                                           (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Customers ─────────────────────────────────────────────────────────
    when 'customer_search' then
      v_path := '$';
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result
        from app.customer_search(a ->> 'p_query', coalesce((a ->> 'p_limit')::int, 12)) x;
    when 'customer_record' then
      v_result := app.customer_record((a ->> 'p_customer_id')::uuid);

    -- ── Marketing ─────────────────────────────────────────────────────────
    when 'analytics_promo' then
      v_result := app.analytics_promo((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'marketing_overview' then
      v_result := app.marketing_overview();
    when 'marketing_campaign_performance' then
      v_result := app.marketing_campaign_performance((a ->> 'p_campaign')::uuid);

    -- ── Tournaments, open matches, loyalty (0328) ────────────────────────
    when 'assistant_tournaments_summary' then
      v_path := 'tournaments';
      v_result := app.assistant_tournaments_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'report_matches' then
      v_path := 'byDay';
      v_result := app.report_matches((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'assistant_loyalty_summary' then
      v_path := 'tiers';
      v_result := app.assistant_loyalty_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Stored daily figures (0330) ───────────────────────────────────────
    when 'assistant_history_figures' then
      v_path := 'rows';
      v_result := app.assistant_history_figures((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                                coalesce(a ->> 'p_group', 'day'), coalesce((a ->> 'p_extra')::boolean, false));
    when 'assistant_history_items' then
      v_path := 'rows';
      v_result := app.assistant_history_items((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                              coalesce((a ->> 'p_limit')::int, 10), coalesce(a ->> 'p_order', 'revenue'));
    when 'assistant_history_courts' then
      v_path := 'rows';
      v_result := app.assistant_history_courts((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                               coalesce(a ->> 'p_group', 'range'), coalesce((a ->> 'p_hours')::boolean, false));
    when 'assistant_history_staff' then
      v_path := 'rows';
      v_result := app.assistant_history_staff((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Files (0354) ──────────────────────────────────────────────────────
    when 'assistant_files_list' then
      v_path := 'files';
      v_result := app.assistant_files_list(a ->> 'p_query', coalesce((a ->> 'p_limit')::int, 50));
    when 'assistant_file_get' then
      v_result := app.assistant_file_get((a ->> 'p_file_id')::uuid);

    -- ── Settings, system, any table ───────────────────────────────────────
    when 'assistant_settings_read' then
      v_result := app.assistant_settings_read();
    when 'assistant_system_status' then
      v_result := app.assistant_system_status();
    when 'assistant_table_read' then
      v_path := 'rows';
      v_result := app.assistant_table_read(
                    a ->> 'p_table',
                    case when a ? 'p_columns' and jsonb_typeof(a -> 'p_columns') = 'array'
                         then array(select jsonb_array_elements_text(a -> 'p_columns')) end,
                    a -> 'p_filters', a ->> 'p_order',
                    (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Meter (0111) ──────────────────────────────────────────────────────
    when 'assistant_usage' then
      v_path := 'days';
      v_result := app.assistant_usage((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    else
      raise exception 'ASSISTANT_UNKNOWN_TOOL' using errcode = 'P0001', detail = coalesce(p_tool, 'null');
  end case;

  -- row_count: the length of the array rows_path points at, when known.
  v_count := case
               when v_path = '$' and jsonb_typeof(v_result) = 'array' then jsonb_array_length(v_result)
               when v_path is not null and v_path <> '$' and jsonb_typeof(v_result -> v_path) = 'array'
                 then jsonb_array_length(v_result -> v_path)
             end;
  -- truncated: a paged list whose total exceeds what this page returned.
  v_truncated := case
                   when v_count is not null and jsonb_typeof(v_result) = 'object' and (v_result ->> 'total') ~ '^\d+$'
                     then (v_result ->> 'total')::bigint > coalesce((v_result ->> 'offset')::bigint, coalesce((a ->> 'p_offset')::bigint, 0)) + v_count
                   else false
                 end;

  return jsonb_build_object('tool', p_tool, 'data', v_result, 'row_count', v_count, 'truncated', v_truncated);
end $assistant_run_tool_0354$;

comment on function app.assistant_run_tool(text, jsonb) is
  '0109, 0328, 0330, 0354. Owner-only. THE read-only wall for the assistant: turns transaction_read_only on, then dispatches over the fixed catalog of read RPC names (packages/core/src/assistant/tools.ts DISPATCHED_RPCS) with arguments pulled from p_args by p_* name. Unknown names raise ASSISTANT_UNKNOWN_TOOL. Returns {tool, data, row_count, truncated}. Called with the owner''s JWT by the assistant-chat edge function.';

revoke all on function app.assistant_run_tool(text, jsonb) from public, anon;
grant execute on function app.assistant_run_tool(text, jsonb) to authenticated;
