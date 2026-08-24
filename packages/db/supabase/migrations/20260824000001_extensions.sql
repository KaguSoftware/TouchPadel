-- 0001_extensions — required Postgres extensions.
-- pg_cron is NOT created here: it is enabled via Supabase config/dashboard and first
-- referenced in migration 0017 (hold sweeps, degraded-period transitions).

create extension if not exists btree_gist;    -- uuid equality inside the reservations GiST exclusion constraint
create extension if not exists pgcrypto;      -- crypt()/gen_salt() for staff PINs, gen_random_uuid()
