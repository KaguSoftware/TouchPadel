-- Hosted `db push` applies migrations as `postgres`; local CLI stacks apply
-- them as `supabase_admin`. Tables created locally therefore miss the
-- postgres-role default privileges that normally give service_role full access
-- ("permission denied for table rate_rules" from the service client on a fresh
-- local stack). Grant explicitly, and set default privileges for the CURRENT
-- applying role, so both environments end up identical.
--
-- service_role is server-side only and bypasses RLS by design; the append-only
-- protection on audit_log / stock_movements / payments etc. remains enforced by
-- the layer-2 forbid_mutation trigger, which fires regardless of role.

grant usage on schema app to service_role;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all tables    in schema app    to service_role;
grant all on all sequences in schema app    to service_role;

alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema app    grant all on tables    to service_role;
alter default privileges in schema app    grant all on sequences to service_role;
