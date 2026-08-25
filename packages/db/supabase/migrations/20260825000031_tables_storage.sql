-- 0031_tables_storage — cafe_tables.bell_enabled, admin table CRUD + QR-token
-- export RPCs, app.open_table_session re-created to surface bell_enabled, the
-- waiter-call cooldown setter, and the `menu-media` storage bucket + policies
-- (docs/design/cafe-rebuild/db-slice.md, "0031_tables_storage").
--
-- Additive on 0001–0026 (hosted lczijabnorujcgmbuqlw is production): one new
-- column with a default, new RPCs, one same-signature re-creation. Function
-- body ownership: app.open_table_session is re-created ONLY here (full 0014
-- body + one jsonb key); app.raise_waiter_call (the BELL_DISABLED check and the
-- Telegram enqueue) is re-created in 0032 — never split one function's edits
-- across two migrations.
--
-- Storage: the bucket and the storage.objects policies live inside a guarded
-- DO block — skipped with a NOTICE on stacks without the storage schema, and
-- policy creation degrades to a NOTICE (Dashboard fallback, see the SETUP
-- checklist) when the migration role does not own storage.objects (hosted
-- `db push` runs as postgres).

-- ---------------------------------------------------------------------------
-- 1. cafe_tables.bell_enabled — per-table "call waiter" switch.
-- ---------------------------------------------------------------------------
alter table cafe_tables add column if not exists bell_enabled boolean not null default true;

comment on column cafe_tables.bell_enabled is
  'Guest "call waiter" bell for this table. false = the guest page hides the bell and app.raise_waiter_call raises BELL_DISABLED (0032). Default on; toggled via app.set_table_bell (manager|owner, audited table.bell).';

-- ---------------------------------------------------------------------------
-- 2. app.set_table_bell — manager|owner; audit table.bell.
-- ---------------------------------------------------------------------------
create or replace function app.set_table_bell(p_table_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_table  cafe_tables%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_table from cafe_tables where id = p_table_id for update;
  if not found then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_table);

  update cafe_tables
     set bell_enabled = p_enabled
   where id = p_table_id
   returning * into v_table;

  perform app.write_audit('table.bell', 'cafe_tables', v_table.id::text,
                          v_before, to_jsonb(v_table));
end $$;

-- ---------------------------------------------------------------------------
-- 3. app.upsert_cafe_table — manager|owner; the QR page's table editor (no
-- admin table CRUD existed before 0031). token_version is never touched here:
-- rotation stays app.rotate_table_token (owner, audited). Column types match
-- 0014: table_number text unique, zone text, capacity int, is_active boolean.
-- ---------------------------------------------------------------------------
create or replace function app.upsert_cafe_table(
  p_table_number text,
  p_zone         text    default null,
  p_capacity     int     default null,
  p_id           uuid    default null,
  p_is_active    boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_number text := nullif(btrim(p_table_number), '');
  v_before jsonb;
  v_row    cafe_tables%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_number is null then
    raise exception 'INVALID_TABLE_NUMBER' using errcode = 'P0001',
      hint = 'the table number is printed on the QR card — it cannot be blank';
  end if;

  begin
    if p_id is null then
      insert into cafe_tables (table_number, zone, capacity, is_active)
      values (v_number, p_zone, p_capacity, coalesce(p_is_active, true))
      returning * into v_row;
      perform app.write_audit('table.upsert', 'cafe_tables', v_row.id::text,
                              null, to_jsonb(v_row));
    else
      select * into v_row from cafe_tables where id = p_id for update;
      if not found then
        raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
      end if;
      v_before := to_jsonb(v_row);
      update cafe_tables
         set table_number = v_number,
             zone         = p_zone,
             capacity     = p_capacity,
             is_active    = coalesce(p_is_active, true)
       where id = p_id
       returning * into v_row;
      perform app.write_audit('table.upsert', 'cafe_tables', v_row.id::text,
                              v_before, to_jsonb(v_row));
    end if;
  exception when unique_violation then
    -- cafe_tables_table_number_key is the only non-PK unique constraint.
    raise exception 'TABLE_NUMBER_TAKEN' using errcode = 'P0001',
      detail = v_number, hint = 'another table already uses this number';
  end;

  return v_row.id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. app.table_qr_tokens — manager|owner (the tier app.generate_table_token
-- enforces in its body; 0014's "owner/manager" header is the truth, the
-- context doc's "owner-only" note is stale). One call = every ACTIVE table
-- with its current signed token, for the operator's print route. Least
-- privilege: no service role needed anywhere for QR artwork any more.
-- Ordered by table_number, shortest first so 'T2' sorts before 'T10' on the
-- printed sheet. Audited ONCE per call (table.qr_tokens_read).
-- ---------------------------------------------------------------------------
create or replace function app.table_qr_tokens() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_out   jsonb;
  v_count int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'table_id',      t.id,
           'table_number',  t.table_number,
           'zone',          t.zone,
           'capacity',      t.capacity,
           'is_active',     t.is_active,
           'bell_enabled',  t.bell_enabled,
           'token_version', t.token_version,
           'token',         app.generate_table_token(t.id))
           order by length(t.table_number), t.table_number), '[]'::jsonb),
         count(*)
    into v_out, v_count
    from cafe_tables t
   where t.is_active;

  perform app.write_audit('table.qr_tokens_read', 'cafe_tables', 'all',
                          null, jsonb_build_object('tables', v_count));
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- 5. app.open_table_session — THE ONLY anon-executable function in the system
-- (0014). Same signature and attributes; FULL 0014 body; the single change is
-- the returned jsonb gaining 'bell_enabled' so the guest page can hide the
-- bell without a cafe_tables read (guests have no cafe_tables grant).
-- Returns {session_id, table_id, table_number, bell_enabled, expires_at}.
-- ---------------------------------------------------------------------------
create or replace function app.open_table_session(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_table_id uuid;
  v_table    cafe_tables%rowtype;
  v_ttl      int;
  v_sess     guest_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001',
      hint = 'sign in anonymously before opening a table session';
  end if;

  v_table_id := app.verify_table_token(p_token);
  if v_table_id is null then
    raise exception 'TOKEN_INVALID' using errcode = 'P0001',
      hint = 'ask staff for a fresh QR';
  end if;

  select * into v_table from cafe_tables where id = v_table_id;
  select table_token_ttl_minutes into v_ttl from venue_settings;

  -- One live session per auth user: refresh on the same table, replace on a
  -- table switch (guest moved seats / rescanned another QR).
  select * into v_sess
    from guest_sessions
   where auth_user_id = v_uid and closed_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;

  if found and v_sess.table_id = v_table_id then
    update guest_sessions
       set last_activity_at = now(),
           expires_at = now() + make_interval(mins => coalesce(v_ttl, 90))
     where id = v_sess.id
     returning * into v_sess;
  else
    if found then
      update guest_sessions set closed_at = now() where id = v_sess.id;
    end if;
    insert into guest_sessions (table_id, auth_user_id, linked_profile_id, expires_at)
    values (v_table_id, v_uid,
            (select id from profiles where id = v_uid),   -- null for anonymous users
            now() + make_interval(mins => coalesce(v_ttl, 90)))
    returning * into v_sess;
  end if;

  return jsonb_build_object(
    'session_id',   v_sess.id,
    'table_id',     v_table.id,
    'table_number', v_table.table_number,
    'bell_enabled', v_table.bell_enabled,
    'expires_at',   v_sess.expires_at);
end $$;

-- Re-apply the 0014 grants verbatim (create or replace keeps ACLs, but the
-- anon grant is the one deliberate exception in the system — restate it).
revoke all on function app.open_table_session(text) from public;
grant execute on function app.open_table_session(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.set_waiter_call_cooldown — manager|owner; 30–600 s. Writes the
-- venue_settings singleton (0006: id boolean pk, always true — no WHERE
-- needed, same as app.set_opening_hours). Audit settings.waiter_cooldown.
-- ---------------------------------------------------------------------------
create or replace function app.set_waiter_call_cooldown(p_seconds int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_seconds is null or p_seconds < 30 or p_seconds > 600 then
    raise exception 'INVALID_COOLDOWN' using errcode = 'P0001',
      hint = 'cooldown must be between 30 and 600 seconds';
  end if;

  select jsonb_build_object('waiter_call_cooldown_seconds', waiter_call_cooldown_seconds)
    into v_before from venue_settings;

  update venue_settings set waiter_call_cooldown_seconds = p_seconds;

  select jsonb_build_object('waiter_call_cooldown_seconds', waiter_call_cooldown_seconds)
    into v_after from venue_settings;

  perform app.write_audit('settings.waiter_cooldown', 'venue_settings', 'singleton',
                          v_before, v_after);
end $$;

-- ---------------------------------------------------------------------------
-- Function grants (0013 pattern: staff RPCs are authenticated-only; the body
-- role guard is the real gate).
-- ---------------------------------------------------------------------------
revoke all on function app.set_table_bell(uuid, boolean) from public, anon;
grant execute on function app.set_table_bell(uuid, boolean) to authenticated;

revoke all on function app.upsert_cafe_table(text, text, int, uuid, boolean) from public, anon;
grant execute on function app.upsert_cafe_table(text, text, int, uuid, boolean) to authenticated;

revoke all on function app.table_qr_tokens() from public, anon;
grant execute on function app.table_qr_tokens() to authenticated;

revoke all on function app.set_waiter_call_cooldown(int) from public, anon;
grant execute on function app.set_waiter_call_cooldown(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Storage: `menu-media` bucket (public read) + storage.objects policies.
-- Path conventions: items/{item_id}/{ulid}.webp, categories/{category_id}/
-- {ulid}.webp, hero/{ulid}.webp|mp4 — the insert policy pins the top-level
-- folder. 25 MiB exists for hero video; images are compressed client-side.
-- Public URL: {SUPABASE_URL}/storage/v1/object/public/menu-media/{path}.
-- Mirrors [storage.buckets.menu-media] in config.toml (local seed path).
--
-- Guards (0022 pattern): storage schema absent -> NOTICE + return; each
-- policy tolerates duplicate_object (re-runs, Dashboard-created first);
-- insufficient_privilege on the policies degrades to a NOTICE WITHOUT rolling
-- back the bucket upsert (nested block), and the outer handler covers a
-- non-writable storage.buckets.
-- ---------------------------------------------------------------------------
do $storage$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent - skipping menu-media bucket + policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('menu-media', 'menu-media', true, 26214400,
          array['image/webp','image/jpeg','image/png','video/mp4','video/webm'])
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  begin
    begin
      create policy menu_media_public_read on storage.objects
        for select to anon, authenticated
        using (bucket_id = 'menu-media');
    exception when duplicate_object then null;
    end;

    begin
      create policy menu_media_staff_insert on storage.objects
        for insert to authenticated
        with check (bucket_id = 'menu-media'
                    and app.is_staff('manager','owner')
                    and (storage.foldername(name))[1] in ('items','categories','hero'));
    exception when duplicate_object then null;
    end;

    begin
      create policy menu_media_staff_update on storage.objects
        for update to authenticated
        using      (bucket_id = 'menu-media' and app.is_staff('manager','owner'))
        with check (bucket_id = 'menu-media' and app.is_staff('manager','owner'));
    exception when duplicate_object then null;
    end;

    begin
      create policy menu_media_staff_delete on storage.objects
        for delete to authenticated
        using (bucket_id = 'menu-media' and app.is_staff('manager','owner'));
    exception when duplicate_object then null;
    end;
  exception when insufficient_privilege then
    raise notice 'cannot create policies on storage.objects as % (%) - create menu_media_public_read / menu_media_staff_insert / menu_media_staff_update / menu_media_staff_delete via Dashboard > Storage > Policies (SETUP checklist)',
      current_user, sqlerrm;
  end;
exception when insufficient_privilege then
  raise notice 'storage.buckets not writable as % (%) - create the menu-media bucket and its policies via the Dashboard',
    current_user, sqlerrm;
end $storage$;
