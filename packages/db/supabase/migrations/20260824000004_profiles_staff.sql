-- 0004_profiles_staff — guest profiles, staff, auth signup trigger, PIN machinery.
-- PIN model (resolved override #6): online server-side crypt() check only — no
-- per-staff HMAC pin_proof machinery.

-- ---------------------------------------------------------------------------
-- profiles — guests; 1:1 with auth.users (anonymous users get no profile row)
-- ---------------------------------------------------------------------------
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null,
  phone           text,                        -- captured day one per scope (future SMS identity)
  preferred_lang  text not null default 'en' check (preferred_lang in ('en','ar')),
  expo_push_token text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- staff — role lookup source of truth (see app.staff_role() in 0003)
-- ---------------------------------------------------------------------------
create table staff (
  id           uuid primary key references auth.users(id) on delete restrict,
  display_name text not null,
  role         staff_role not null,
  pin_hash     text,                           -- crypt(pin, gen_salt('bf')); managers/owners only
  is_active    boolean not null default true,
  created_by   uuid references staff(id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Signup trigger: create a profile for every NON-anonymous auth user.
-- Fired by GoTrue's insert into auth.users (runs as supabase_auth_admin), so the
-- function is SECURITY DEFINER owned by postgres.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;                                -- cafe anonymous sessions: no profile
  end if;
  insert into public.profiles (id, full_name, phone, preferred_lang)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
             split_part(coalesce(new.email, ''), '@', 1),
             ''),
    new.raw_user_meta_data->>'phone',
    case when new.raw_user_meta_data->>'preferred_lang' in ('en','ar')
         then new.raw_user_meta_data->>'preferred_lang' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- PIN attempt rate limiting: 5 failures / 5 minutes per device => PIN_LOCKED.
-- Unlogged: throwaway telemetry, lives in `app`, definer-only access.
-- ---------------------------------------------------------------------------
create unlogged table app.pin_attempts (
  device_id    text not null,
  attempted_at timestamptz not null default now(),
  success      boolean not null
);
create index pin_attempts_device_at on app.pin_attempts (device_id, attempted_at desc);

-- ---------------------------------------------------------------------------
-- app.set_staff_pin — owner-only. PINs are 4-6 digits, bcrypt-hashed.
-- (Audit row for pin changes is added when app.write_audit lands in 0005 — the
-- 0019 hardening sweep re-checks this.)
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN_FORMAT' using errcode = 'P0001',
      hint = 'PIN must be 4-6 digits';
  end if;
  update staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
   where id = p_staff_id and role in ('manager','owner') and is_active;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001',
      hint = 'PINs exist for active managers/owners only';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- app.verify_manager_pin — returns the authorizer staff id, or raises
-- PIN_INVALID / PIN_LOCKED. Sensitive RPCs call this and record both applied_by
-- (the logged-in cashier) and authorized_by (the PIN holder).
-- ---------------------------------------------------------------------------
create or replace function app.verify_manager_pin(p_pin text, p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_dev   text := coalesce(p_device_id, 'unknown');
  v_fails int;
  v_id    uuid;
begin
  select count(*) into v_fails
    from app.pin_attempts
   where device_id = v_dev and not success
     and attempted_at > now() - interval '5 minutes';
  if v_fails >= 5 then
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  select id into v_id
    from staff
   where role in ('manager','owner') and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_pin, pin_hash)
   limit 1;

  insert into app.pin_attempts (device_id, success) values (v_dev, v_id is not null);

  -- Returns NULL on an invalid PIN instead of raising: a raise would roll back
  -- the attempt row above (PostgREST wraps each RPC in one transaction) and the
  -- 5-failure lockout could never engage. Callers treat NULL as PIN_INVALID;
  -- composite sensitive RPCs re-raise it themselves. Found by the RLS matrix
  -- suite against staging (lockout test).
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------
revoke all on function app.handle_new_user() from public, anon, authenticated;
revoke all on function app.set_staff_pin(uuid, text) from public, anon;
grant execute on function app.set_staff_pin(uuid, text) to authenticated;
revoke all on function app.verify_manager_pin(text, text) from public, anon;
grant execute on function app.verify_manager_pin(text, text) to authenticated;

alter table profiles enable row level security;
alter table staff enable row level security;

-- profiles: guest reads/updates own row; court_desk/manager/owner read (walk-in lookup).
grant select on profiles to authenticated;
grant update (full_name, phone, preferred_lang, expo_push_token) on profiles to authenticated;

create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or app.is_staff('court_desk','manager','owner'));
create policy profiles_update_own on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- INSERT is trigger-only; DELETE cascades from auth.users. No policies, no grants.

-- staff: column-level grant — pin_hash is NEVER readable by clients.
grant select (id, display_name, role, is_active, created_by, created_at) on staff to authenticated;

create policy staff_select on staff for select to authenticated
  using (id = auth.uid() or app.is_staff('manager','owner'));
-- Staff administration (owner) is RPC-only and lands with the admin drop; no
-- INSERT/UPDATE/DELETE policies or grants here.
