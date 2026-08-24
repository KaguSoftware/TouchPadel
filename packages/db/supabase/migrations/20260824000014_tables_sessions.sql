-- 0014_tables_sessions — cafe tables, signed QR tokens, anonymous guest sessions
-- (design-data.md §1.5).
--
-- Token design: the QR encodes /t/<token> where
--   token = base64url(table_id || '.' || version || '.' || hmac_sha256_hex(table_id || '.' || version, secret))
-- NO token is stored in the DB — nothing to leak. Rotation = bump
-- cafe_tables.token_version (owner RPC, audited) + reprint; every old QR dies.
--
-- Secret storage: Supabase Vault when available (vault.create_secret /
-- vault.decrypted_secrets), else a private definer-only table app.secrets.
-- app.table_token_secret() reads whichever exists and bootstraps a random
-- secret (extensions.gen_random_bytes) on first run. AT W5 HANDOVER the same
-- secret value must be set on the client's project or every printed QR dies
-- (HANDOFF gotcha).

-- ---------------------------------------------------------------------------
-- Tables (§1.5, exactly)
-- ---------------------------------------------------------------------------
create table cafe_tables (
  id            uuid primary key default gen_random_uuid(),
  table_number  text not null unique,          -- '9', 'T12', printed on QR
  zone          text,
  capacity      int,
  token_version int not null default 1,        -- ROTATION: bump => every printed QR for this table dies
  is_active     boolean not null default true
);

create table guest_sessions (
  id                uuid primary key default gen_random_uuid(),
  table_id          uuid not null references cafe_tables(id),
  auth_user_id      uuid not null references auth.users(id),  -- Supabase ANONYMOUS sign-in user
  linked_profile_id uuid references profiles(id),             -- optional sign-in attaches account
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),
  expires_at        timestamptz not null,                     -- last_activity + table_token_ttl_minutes
  closed_at         timestamptz
);
create index guest_sessions_live_by_user on guest_sessions (auth_user_id) where closed_at is null;
create index guest_sessions_table on guest_sessions (table_id) where closed_at is null;

-- ---------------------------------------------------------------------------
-- Secret store fallback: definer-only. NO grants to anon/authenticated — only
-- SECURITY DEFINER functions (running as the migration role) can touch it.
-- (service_role can read it via 0012 defaults; service_role is server-side only.)
-- ---------------------------------------------------------------------------
create table if not exists app.secrets (
  name  text primary key,
  value text not null
);

-- ---------------------------------------------------------------------------
-- base64url helpers (Postgres encode() emits padded base64 with line breaks).
-- Definer-internal: no client grants needed — called from definer functions,
-- whose runtime user (the owner) always has EXECUTE.
-- ---------------------------------------------------------------------------
create or replace function app.b64url_encode(p bytea) returns text
language sql immutable as $$
  select translate(replace(encode(p, 'base64'), e'\n', ''), '+/=', '-_')
$$;

create or replace function app.b64url_decode(p text) returns bytea
language sql immutable as $$
  select decode(
           translate(p, '-_', '+/') || repeat('=', (4 - length(p) % 4) % 4),
           'base64')
$$;

-- ---------------------------------------------------------------------------
-- app.table_token_secret — read the HMAC secret; Vault first, app.secrets
-- fallback; bootstrap a random 32-byte hex secret on first run. Vault access is
-- wrapped in exception guards so the same migration runs on stacks without it.
-- ---------------------------------------------------------------------------
create or replace function app.table_token_secret() returns text
language plpgsql security definer set search_path = public as $$
declare
  v text;
begin
  -- 1. Vault, if present.
  begin
    select decrypted_secret into v
      from vault.decrypted_secrets
     where name = 'table_token_secret'
     limit 1;
  exception when others then
    v := null;                                 -- vault schema/view missing or unreadable
  end;
  if v is not null then
    return v;
  end if;

  -- 2. Fallback table.
  select value into v from app.secrets where name = 'table_token_secret';
  if v is not null then
    return v;
  end if;

  -- 3. First run: bootstrap. Prefer Vault; fall back to app.secrets.
  v := encode(extensions.gen_random_bytes(32), 'hex');
  begin
    perform vault.create_secret(v, 'table_token_secret',
                                'HMAC key for cafe table QR tokens');
    return v;
  exception when others then
    insert into app.secrets (name, value) values ('table_token_secret', v)
    on conflict (name) do nothing;             -- concurrent bootstrap: keep the winner
    select value into v from app.secrets where name = 'table_token_secret';
    return v;
  end;
end $$;

-- Bootstrap the secret at migration time so both environments have one from day 0.
do $$ begin perform app.table_token_secret(); end $$;

-- ---------------------------------------------------------------------------
-- app.generate_table_token — owner/manager; feeds the QR-artwork export in the
-- operator app. Always signs the CURRENT token_version.
-- ---------------------------------------------------------------------------
create or replace function app.generate_table_token(p_table_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_table   cafe_tables%rowtype;
  v_payload text;
  v_sig     text;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_table from cafe_tables where id = p_table_id;
  if not found then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_payload := v_table.id::text || '.' || v_table.token_version::text;
  v_sig := encode(extensions.hmac(v_payload, app.table_token_secret(), 'sha256'), 'hex');
  return app.b64url_encode(convert_to(v_payload || '.' || v_sig, 'utf8'));
end $$;

-- ---------------------------------------------------------------------------
-- app.verify_table_token — returns the table_id, or NULL on ANY failure
-- (malformed, bad signature, stale version, inactive table). Same posture as
-- PIN verify: never raise on invalid input, never leak which check failed.
-- ---------------------------------------------------------------------------
-- (volatile, not stable: table_token_secret() may write on its bootstrap path)
create or replace function app.verify_table_token(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_decoded text;
  v_table   cafe_tables%rowtype;
  v_id      uuid;
  v_version int;
  v_sig     text;
  v_expect  text;
begin
  if p_token is null or length(p_token) > 512 then
    return null;
  end if;

  begin
    v_decoded := convert_from(app.b64url_decode(p_token), 'utf8');
    v_id      := split_part(v_decoded, '.', 1)::uuid;
    v_version := split_part(v_decoded, '.', 2)::int;
    v_sig     := split_part(v_decoded, '.', 3);
  exception when others then
    return null;                               -- malformed token
  end;

  v_expect := encode(extensions.hmac(
                split_part(v_decoded, '.', 1) || '.' || split_part(v_decoded, '.', 2),
                app.table_token_secret(), 'sha256'), 'hex');
  if v_sig is distinct from v_expect then
    return null;
  end if;

  select * into v_table from cafe_tables where id = v_id;
  if not found or not v_table.is_active or v_table.token_version <> v_version then
    return null;                               -- rotated or retired QR
  end if;

  return v_table.id;
end $$;

-- ---------------------------------------------------------------------------
-- app.open_table_session — THE ONLY anon-executable function in the system.
-- Requires a real auth.uid() (Supabase anonymous sign-in happens first), so the
-- anon grant only serves clients whose JWT hasn't refreshed yet; the body is
-- the real gate. Verifies HMAC + token_version, upserts the caller's live
-- session, returns {session_id, table_id, table_number, expires_at}.
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
    'expires_at',   v_sess.expires_at);
end $$;

-- ---------------------------------------------------------------------------
-- app.touch_guest_session — INTERNAL helper for every guest write RPC
-- (create_guest_order, raise_waiter_call): re-checks the caller's live binding,
-- slides the inactivity expiry, returns the session row. Raises SESSION_EXPIRED
-- when there is no live session. No client grants.
-- ---------------------------------------------------------------------------
create or replace function app.touch_guest_session() returns guest_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_ttl  int;
  v_sess guest_sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_sess
    from guest_sessions
   where auth_user_id = auth.uid() and closed_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found then
    raise exception 'SESSION_EXPIRED' using errcode = 'P0001',
      hint = 'scan the table QR again';
  end if;

  select table_token_ttl_minutes into v_ttl from venue_settings;
  update guest_sessions
     set last_activity_at = now(),
         expires_at = now() + make_interval(mins => coalesce(v_ttl, 90))
   where id = v_sess.id
   returning * into v_sess;

  return v_sess;
end $$;

-- ---------------------------------------------------------------------------
-- app.is_own_session — RLS-policy helper: does this guest_sessions id belong to
-- the caller? Definer so policies on other tables can use it without recursive
-- RLS evaluation. Used by 0015 (orders) and 0016 (waiter_calls).
-- ---------------------------------------------------------------------------
create or replace function app.is_own_session(p_session_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guest_sessions gs
     where gs.id = p_session_id and gs.auth_user_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------------
-- app.rotate_table_token — owner only, audited. Every printed QR for the table
-- dies instantly (verify checks token_version).
-- ---------------------------------------------------------------------------
create or replace function app.rotate_table_token(p_table_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_table  cafe_tables%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_table from cafe_tables where id = p_table_id for update;
  if not found then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_table);

  update cafe_tables
     set token_version = token_version + 1
   where id = p_table_id
   returning * into v_table;

  -- Live sessions on the table keep running (they were opened with a then-valid
  -- QR); only NEW scans require the reprinted code.
  perform app.write_audit('table.token.rotate', 'cafe_tables', v_table.id::text,
                          v_before, to_jsonb(v_table));

  return v_table.token_version;
end $$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
revoke all on function app.b64url_encode(bytea) from public, anon, authenticated;
revoke all on function app.b64url_decode(text) from public, anon, authenticated;
revoke all on function app.table_token_secret() from public, anon, authenticated;
revoke all on function app.touch_guest_session() from public, anon, authenticated;

revoke all on function app.generate_table_token(uuid) from public, anon;
grant execute on function app.generate_table_token(uuid) to authenticated;

revoke all on function app.verify_table_token(text) from public, anon;
grant execute on function app.verify_table_token(text) to authenticated;

-- THE single anon-executable RPC (design §3.1).
revoke all on function app.open_table_session(text) from public;
grant execute on function app.open_table_session(text) to anon, authenticated;

revoke all on function app.is_own_session(uuid) from public, anon;
grant execute on function app.is_own_session(uuid) to authenticated;   -- used in RLS policies

revoke all on function app.rotate_table_token(uuid) from public, anon;
grant execute on function app.rotate_table_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS (matrix §3.2): guest_sessions — guest SELECT own; cashier/
-- manager/owner SELECT. cafe_tables — staff read (guests learn their table
-- number from open_table_session's return, never from the table).
-- app.secrets: RLS-enabled with NO policies and NO grants — definer-only.
-- ---------------------------------------------------------------------------
alter table cafe_tables enable row level security;
alter table guest_sessions enable row level security;
alter table app.secrets enable row level security;

grant select on cafe_tables to authenticated;
create policy cafe_tables_staff_read on cafe_tables for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner'));

grant select on guest_sessions to authenticated;
create policy guest_sessions_own_read on guest_sessions for select to authenticated
  using (auth_user_id = auth.uid());
create policy guest_sessions_staff_read on guest_sessions for select to authenticated
  using (app.is_staff('cashier','manager','owner'));
