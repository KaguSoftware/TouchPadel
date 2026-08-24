-- 0003_app_schema — schema `app` (functions + internal helpers), baseline grants
-- posture, append-only guard trigger, role-resolution helpers.
--
-- Posture (design-data.md §3): business tables live in `public` (so gen-types and
-- PostgREST see them); every mutating write path is a SECURITY DEFINER function in
-- `app`. Client roles get NO automatic privileges on anything — each migration
-- grants exactly what its RLS matrix row allows.

-- staff_role()/is_staff() reference the `staff` table which lands in 0004; skip
-- body validation at creation time (bodies are checked at first execution).
set check_function_bodies = off;

create schema if not exists app;

grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Baseline default privileges: future objects created by `postgres` (the role
-- the CLI applies migrations as) carry no client grants. service_role keeps the
-- Supabase-standard full grants (it bypasses RLS and is server-side only).
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema app
  revoke all on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Append-only guard (layer 2 — layer 1 is the absence of UPDATE/DELETE grants).
-- Attached per-table in later migrations (audit_log, stock_movements, payments,
-- refunds, sync_replays).
-- ---------------------------------------------------------------------------
create or replace function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- Role resolution: `staff` table lookup, NOT JWT custom claims — role edits by
-- the owner take effect on the next statement, no token refresh. The `staff`
-- table itself lands in 0004; STABLE + SECURITY DEFINER makes these safe to use
-- inside RLS policies for any role.
-- ---------------------------------------------------------------------------
create or replace function app.staff_role() returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff where id = auth.uid() and is_active
$$;

create or replace function app.is_staff(variadic roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  -- coalesce: NULL (not staff) must read as FALSE, or "if not is_staff(...)" guards
  -- silently pass for guests (SQL three-valued logic).
  select coalesce(app.staff_role() = any(roles), false)
$$;

revoke all on function app.forbid_mutation() from public, anon, authenticated;
revoke all on function app.staff_role() from public;
revoke all on function app.is_staff(variadic staff_role[]) from public;
-- Safe reads, needed inside RLS policies evaluated for anon and authenticated:
grant execute on function app.staff_role() to anon, authenticated;
grant execute on function app.is_staff(variadic staff_role[]) to anon, authenticated;
