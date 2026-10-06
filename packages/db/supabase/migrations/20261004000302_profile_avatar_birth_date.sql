set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0302 profile_avatar_birth_date — Edit profile gains a profile photo and a
-- date of birth (owner, 2026-10-04).
--
--   1. profiles gains avatar_path (the guest's photo in the private `avatars`
--      bucket, `<profile id>/<uuid>.<jpg|png|webp>`) and birth_date (optional,
--      editable, 1900-01-01 .. today). Plain nullable columns: no rewrite.
--   2. avatar_path is readable like the name (the guest, and the desk through
--      profiles_select); birth_date has NO column grant: only the guest reads
--      it, through app.my_birth_date. Neither is client-writable: the two
--      definers below are the only writers.
--   3. The `avatars` bucket: a guest uploads only into their own folder (at
--      most 10 objects there at once), reads and deletes only their own;
--      active staff read every photo. Other open-match players (the owner's
--      third audience) arrive with the match screens, in a later file.
--   4. app.set_my_avatar(p_path) points the profile at an uploaded object (or
--      clears it with NULL) and queues the previous object for removal.
--   5. app.set_my_birth_date(p_birth_date) and app.my_birth_date().
--   6. avatar_purges: the removal queue. An account deletion (the 0077
--      tombstone UPDATE, or a DELETE cascading from auth.users) empties both
--      columns and queues the whole folder, so orphans go too. protocol-action
--      drains it through app.avatar_purge_due / app.avatar_purged, and
--      app.protocol_tick_nudge wakes it when a row is queued.

-- ---------------------------------------------------------------------------
-- 1. Columns and their CHECKs
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists avatar_path text;
alter table profiles add column if not exists birth_date  date;

comment on column profiles.avatar_path is
  '0302. The guest''s profile photo: an object in the private avatars bucket, <profile id>/<uuid>.<jpg|png|webp>. Written only by app.set_my_avatar; NULL = initials. Emptied by account deletion.';
comment on column profiles.birth_date is
  '0302. Optional date of birth, 1900-01-01 .. today. Written only by app.set_my_birth_date, read only by its guest (app.my_birth_date; no column grant). Emptied by account deletion.';

do $constraints_0302$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_avatar_path_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_avatar_path_chk check (
      avatar_path is null
      or (avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
          and split_part(avatar_path, '/', 1) = id::text)) not valid;
    alter table profiles validate constraint profiles_avatar_path_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_birth_date_chk'
                    and conrelid = 'public.profiles'::regclass) then
    -- The upper bound (today) is the RPC's: a CHECK may not read the clock.
    alter table profiles add constraint profiles_birth_date_chk check (
      birth_date is null or birth_date >= date '1900-01-01') not valid;
    alter table profiles validate constraint profiles_birth_date_chk;
  end if;
end $constraints_0302$;

grant select (avatar_path) on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Path helpers. Pure text, immutable, never raise, and granted to anon,
--    authenticated and service_role: the storage policies evaluate them as
--    the reading role (0116 → 0121), and they sit beside the other buckets'
--    policies, so a name from another bucket must give false / NULL.
-- ---------------------------------------------------------------------------
create or replace function app.is_avatar_path(p_name text) returns boolean
language sql immutable as $is_avatar_path_0302$
  select coalesce(
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$',
    false)
$is_avatar_path_0302$;

comment on function app.is_avatar_path(text) is
  '0302. True when a storage object name is an avatar path, <profile id>/<uuid>.<jpg|png|webp>; false for anything else, NULL included. Pure text, never raises; granted to every role because the avatars storage policies evaluate it as the reading role.';

create or replace function app.avatar_owner(p_name text) returns uuid
language sql immutable as $avatar_owner_0302$
  select case when app.is_avatar_path(p_name) then split_part(p_name, '/', 1)::uuid end
$avatar_owner_0302$;

comment on function app.avatar_owner(text) is
  '0302. The profile an avatar path belongs to (its first segment); NULL for a name that is not an avatar path, so another bucket''s name never reaches the cast. Policy-evaluated, hence the anon grant.';

revoke all on function app.is_avatar_path(text) from public;
grant execute on function app.is_avatar_path(text) to anon, authenticated, service_role;
revoke all on function app.avatar_owner(text) from public;
grant execute on function app.avatar_owner(text) to anon, authenticated, service_role;

-- The insert policy's cap. A definer, because a count of storage.objects inside
-- a storage.objects policy recurses into that table's own policies.
create or replace function app.avatar_upload_room() returns boolean
language sql stable security definer set search_path = public as $avatar_upload_room_0302$
  select auth.uid() is not null
     and (select count(*) from storage.objects o
           where o.bucket_id = 'avatars'
             and o.name like auth.uid()::text || '/%') < 10
$avatar_upload_room_0302$;

comment on function app.avatar_upload_room() is
  '0302. True while the caller holds fewer than 10 objects in avatars/<their id>/: the avatars_insert storage policy''s cap (replaced photos leave with the next protocol-action tick). Policy-evaluated, hence the anon grant.';

revoke all on function app.avatar_upload_room() from public;
grant execute on function app.avatar_upload_room() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. avatar_purges — storage objects (one photo) or folders (a deleted
--    account) queued for removal from the avatars bucket.
-- ---------------------------------------------------------------------------
create table if not exists avatar_purges (
  id        uuid primary key default gen_random_uuid(),
  path      text not null,
  queued_at timestamptz not null default now(),
  purged_at timestamptz,
  -- A folder is the bare profile id; an object is a full avatar path.
  constraint avatar_purges_path_chk check (
    path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp))?$')
);

comment on table avatar_purges is
  '0302. Storage housekeeping: avatar objects replaced by a newer photo, and the whole folder of a deleted account, queued for removal from the avatars bucket. protocol-action drains it (app.avatar_purge_due / app.avatar_purged). No client grant.';
comment on column avatar_purges.path is
  'A profile id (the whole folder, account deletion) or <profile id>/<uuid>.<ext> (one replaced photo).';
comment on column avatar_purges.queued_at is 'When the removal was queued.';
comment on column avatar_purges.purged_at is 'When protocol-action removed it; NULL = still due.';

alter table avatar_purges enable row level security;
grant all on avatar_purges to service_role;

-- ---------------------------------------------------------------------------
-- 4. The bucket and its storage policies, in 0159's guarded shape. On hosted,
--    assert the three policies after the push.
--
--    An upload is an INSERT … RETURNING, so the uploader passes the read
--    policy by owning the folder.
-- ---------------------------------------------------------------------------
do $storage_0302$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent - skipping avatars bucket + policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', false, 2097152,
          array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  begin
    begin
      -- Own folder only, a signed-in account (a café anonymous session has no
      -- profile), and at most 10 objects there at once: replaced photos leave
      -- with the next protocol-action tick.
      create policy avatars_insert on storage.objects
        for insert to authenticated
        with check (bucket_id = 'avatars'
                    and app.avatar_owner(name) = (select auth.uid())
                    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
                    and (select app.avatar_upload_room()));
    exception when duplicate_object then null;
    end;

    begin
      create policy avatars_read on storage.objects
        for select to authenticated
        using (bucket_id = 'avatars'
               and (app.avatar_owner(name) = (select auth.uid())
                    or (select app.staff_role()) is not null));
    exception when duplicate_object then null;
    end;

    begin
      -- The guest removes an upload that never reached their profile.
      create policy avatars_delete on storage.objects
        for delete to authenticated
        using (bucket_id = 'avatars'
               and app.avatar_owner(name) = (select auth.uid()));
    exception when duplicate_object then null;
    end;
  exception when insufficient_privilege then
    raise notice 'cannot create policies on storage.objects as % (%) - create avatars_insert / avatars_read / avatars_delete via Dashboard > Storage > Policies',
      current_user, sqlerrm;
  end;
exception when insufficient_privilege then
  raise notice 'storage.buckets not writable as % (%) - create the avatars bucket and its policies via the Dashboard',
    current_user, sqlerrm;
end $storage_0302$;

-- ---------------------------------------------------------------------------
-- 5. app.set_my_avatar — the guest's own profile only.
-- ---------------------------------------------------------------------------
create or replace function app.set_my_avatar(p_path text)
returns jsonb
language plpgsql security definer set search_path = public as $set_my_avatar_0302$
declare
  v_uid     uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_profile from profiles where id = v_uid for update;
  if not found or v_profile.deleted_at is not null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  if p_path is not null then
    -- Own folder, and the object must already be in the bucket.
    if app.avatar_owner(p_path) is distinct from v_uid
       or not exists (select 1 from storage.objects o
                       where o.bucket_id = 'avatars' and o.name = p_path) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_path', hint = 'p_path';
    end if;
  end if;

  if v_profile.avatar_path is not distinct from p_path then
    return jsonb_build_object('avatar_path', p_path, 'duplicate', true);
  end if;

  update profiles set avatar_path = p_path where id = v_uid;

  if v_profile.avatar_path is not null then
    insert into avatar_purges (path) values (v_profile.avatar_path);
  end if;

  return jsonb_build_object('avatar_path', p_path, 'duplicate', false);
end $set_my_avatar_0302$;

comment on function app.set_my_avatar(text) is
  '0302. The caller''s own profile: points avatar_path at an object they uploaded to avatars/<their id>/ (INVALID_ARGUMENT, hint p_path, for any other path or a missing object), or clears it with NULL. The previous photo is queued in avatar_purges. Returns {avatar_path, duplicate}.';

revoke all on function app.set_my_avatar(text) from public, anon;
grant execute on function app.set_my_avatar(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Date of birth — written and read by its guest only.
-- ---------------------------------------------------------------------------
create or replace function app.set_my_birth_date(p_birth_date date)
returns jsonb
language plpgsql security definer set search_path = public as $set_my_birth_date_0302$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles where id = v_uid and deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  if p_birth_date is not null
     and (p_birth_date < date '1900-01-01' or p_birth_date > current_date) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_birth_date', hint = 'p_birth_date';
  end if;

  update profiles set birth_date = p_birth_date
   where id = v_uid and birth_date is distinct from p_birth_date;

  return jsonb_build_object('birth_date', p_birth_date);
end $set_my_birth_date_0302$;

comment on function app.set_my_birth_date(date) is
  '0302. The caller''s own profile: sets the optional date of birth (1900-01-01 .. today, INVALID_ARGUMENT hint p_birth_date otherwise) or clears it with NULL. Returns {birth_date}.';

revoke all on function app.set_my_birth_date(date) from public, anon;
grant execute on function app.set_my_birth_date(date) to authenticated;

create or replace function app.my_birth_date()
returns jsonb
language plpgsql stable security definer set search_path = public as $my_birth_date_0302$
declare
  v_uid  uuid := auth.uid();
  v_date date;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select birth_date into v_date from profiles where id = v_uid and deleted_at is null;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('birth_date', v_date);
end $my_birth_date_0302$;

comment on function app.my_birth_date() is
  '0302. The caller''s own date of birth, {birth_date} (NULL when unset). The column has no client grant, so the desk never reads it.';

revoke all on function app.my_birth_date() from public, anon;
grant execute on function app.my_birth_date() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Account deletion: both columns emptied, the folder queued.
--    BEFORE UPDATE OF deleted_at (the 0077 tombstone) and BEFORE DELETE (a
--    cascade from auth.users). A trigger, so delete_my_account (latest 0290)
--    is not re-issued.
-- ---------------------------------------------------------------------------
create or replace function app.trg_profile_media_tombstone() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_media_tombstone_0302$
begin
  if tg_op = 'DELETE' then
    insert into avatar_purges (path) values (old.id::text);
    return old;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.avatar_path := null;
    new.birth_date  := null;
    insert into avatar_purges (path) values (new.id::text);
  end if;
  return new;
end $trg_profile_media_tombstone_0302$;

comment on function app.trg_profile_media_tombstone() is
  '0302. Trigger profiles_media_tombstone: on the 0077 tombstone UPDATE, empties avatar_path and birth_date; on that UPDATE or a DELETE, queues the account''s whole avatars folder in avatar_purges.';

revoke all on function app.trg_profile_media_tombstone() from public, anon, authenticated;

drop trigger if exists profiles_media_tombstone on profiles;
create trigger profiles_media_tombstone
  before update of deleted_at or delete on profiles
  for each row execute function app.trg_profile_media_tombstone();

-- ---------------------------------------------------------------------------
-- 8. The queue's service pair (the coach_photo_purge_due shape, 0282).
-- ---------------------------------------------------------------------------
create or replace function app.avatar_purge_due(p_limit int default 20) returns jsonb
language sql stable security definer set search_path = public as $avatar_purge_due_0302$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'path', d.path) order by d.queued_at, d.id),
                  '[]'::jsonb)
    from (select q.id, q.path, q.queued_at
            from avatar_purges q
           where q.purged_at is null
           order by q.queued_at, q.id
           limit greatest(coalesce(p_limit, 20), 1)) d
$avatar_purge_due_0302$;

comment on function app.avatar_purge_due(int) is
  '0302. Service role: [{id, path}], the oldest avatar objects and folders queued for removal; protocol-action removes them from the avatars bucket (never the object a profile still points at) and calls app.avatar_purged.';

revoke all on function app.avatar_purge_due(int) from public, anon, authenticated;
grant execute on function app.avatar_purge_due(int) to service_role;

create or replace function app.avatar_purged(p_id uuid) returns void
language sql security definer set search_path = public as $avatar_purged_0302$
  update avatar_purges set purged_at = now() where id = p_id and purged_at is null
$avatar_purged_0302$;

comment on function app.avatar_purged(uuid) is
  '0302. Service role: marks a queued avatar object or folder removed from storage.';

revoke all on function app.avatar_purged(uuid) from public, anon, authenticated;
grant execute on function app.avatar_purged(uuid) to service_role;

create or replace function app.avatar_in_use(p_path text) returns boolean
language sql stable security definer set search_path = public as $avatar_in_use_0302$
  select exists (select 1 from profiles where avatar_path = p_path)
$avatar_in_use_0302$;

comment on function app.avatar_in_use(text) is
  '0302. Service role: true while a profile still points at this avatar path, so protocol-action never removes a live photo.';

revoke all on function app.avatar_in_use(text) from public, anon, authenticated;
grant execute on function app.avatar_in_use(text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. app.protocol_tick_nudge: re-created from
--    20261002000298_coach_photo_purge_tick.sql:60, verbatim plus the
--    avatar_purges clause.
-- ---------------------------------------------------------------------------
create or replace function app.protocol_tick_nudge()
returns void
language plpgsql security definer set search_path = public as $protocol_tick_nudge_0302$
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
end $protocol_tick_nudge_0302$;

comment on function app.protocol_tick_nudge() is
  'release_post_launch (§2.19), re-issued by incident_reports (wave5-addendum §2.6.2), scan_hardening (0240), coach_photo_purge_tick (0298, EC-01) and profile_avatar_birth_date (0302). Every 5 minutes (tp_protocol_tick): asks protocol-action to launch the scheduled releases whose date has come, to remove the photos of runs stopped or withdrawn 90 days ago, to remove the photos of incident reports past purge_after, to remove the incidents, campaigns, receipts and slips photos nobody claimed within a day, to remove scanned papers'' photos past retention, to remove the coach photo folders queued in coach_photo_purges (R43), and to remove the avatars queued in avatar_purges. Posts nothing when nothing is due; silent without pg_net or the functions_base_url / service_role_key secrets; swallows its own errors.';

revoke all on function app.protocol_tick_nudge() from public, anon, authenticated;
