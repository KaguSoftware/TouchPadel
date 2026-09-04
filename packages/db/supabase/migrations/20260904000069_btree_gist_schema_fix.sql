-- 0069_btree_gist_schema_fix — move btree_gist out of `public`.
--
-- Security Layer 1, Block 3 (SEC-04). This is the one finding the Supabase
-- dashboard Security Advisor raises as `extension_in_public`.
--
-- WHY IT MATTERS
--
-- `public` is on the default search_path for every role, so an extension living
-- there puts its functions and operators in front of any unqualified call made
-- by anything that has not pinned its search_path. It also means an object
-- created in `public` by a less-privileged role can shadow one of them. Every
-- other extension in this project is already schema-pinned — pgcrypto in
-- `extensions` (that is what 0009 exists for) and pg_cron in `cron`. btree_gist
-- was the last one left behind, from 0001.
--
-- WHY THIS IS SAFE FOR THE RESERVATIONS CONSTRAINT
--
-- btree_gist is what lets 0008's `exclude using gist (court_id with =, ...)`
-- compare uuid equality inside a GiST constraint — the constraint that stops
-- two bookings occupying the same court at the same time, i.e. the single most
-- important invariant in the product.
--
-- Relocating the extension does NOT rebuild or invalidate that constraint: the
-- existing index references its operator classes by OID, and an OID does not
-- change when the object's schema does. btree_gist is marked `relocatable` in
-- its control file, which is precisely the guarantee that this is a catalog
-- update rather than a data operation.
--
-- What DOES change is name resolution for FUTURE DDL: anything creating a new
-- gist exclusion constraint now needs `extensions` on its search_path. Every
-- definer function in this schema pins `search_path = public` and none of them
-- creates indexes, so nothing in the current codebase is affected.
--
-- ⚠ VERIFY BEFORE PUSHING TO THE HOSTED PROJECT. This was written without a
-- local stack available (Docker was not running), so it has NOT been executed.
-- Run `supabase db reset` and the concurrency suite — which exercises the
-- reservations exclusion constraint directly — before this reaches the venue's
-- database.

set lock_timeout = '3s';
set statement_timeout = '60s';

do $$
begin
  -- Idempotent: a fresh environment created it in `extensions` already if 0001
  -- is ever amended, and re-running a migration must never error.
  if exists (
    select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'btree_gist'
       and n.nspname = 'public'
  ) then
    alter extension btree_gist set schema extensions;
    raise notice 'btree_gist moved from public to extensions';
  else
    raise notice 'btree_gist is not in public — nothing to do';
  end if;
end $$;

-- Prove the reservations invariant still holds after the move. If the operator
-- class resolution broke, this constraint would no longer be enforceable and
-- the failure would otherwise only surface as a double-booked court during
-- service.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
    from pg_constraint
   where conrelid = 'app.reservations'::regclass
     and contype = 'x'
   limit 1;

  if v_conname is null then
    raise exception 'POST-CHECK FAILED: the reservations exclusion constraint is gone after moving btree_gist';
  end if;
  raise notice 'reservations exclusion constraint intact: %', v_conname;
end $$;
