-- 0189 sql_helpers_not_inlinable — the ten SQL helpers that clients are revoked from
-- can no longer be inlined, so the EXECUTE revoke holds on a pooled PostgREST
-- connection. The four that run once per row in the analytics, report and
-- customer queries become LANGUAGE plpgsql; the other six keep their SQL body
-- and get a SET clause.
--
-- Feature: sql_helpers_not_inlinable (security sweep 2026-09-25, found through
-- the analytics owner-gate flake at tests/analytics.test.ts:548).
-- Depends on: 0014 (b64url_encode, b64url_decode), 0034 (the 3-argument
-- business_date, normalize_finding), 0065 (phone_canon, search_norm,
-- like_escape, customer_reservation_json), 0068 (reports_bucket), 0141
-- (assistant_params_hash).
-- Re-issues each one from its latest body; each has exactly one definition
-- (both create spellings searched, 0014–0187). Two treatments:
--   * plpgsql, for the four that run once per row: business_date(timestamptz,
--     text, int) and reports_bucket (the per-row GROUP BY of the analytics and
--     report functions: analytics_daily_sales, _hourly, _sales_lines, the five
--     analytics_courts_*, report_revenue, report_courts,
--     report_staff_activity), phone_canon (every profile in
--     analytics_courts_guests and _endings, find_customer_by_phone,
--     desk_register_customer) and search_norm (every profile in
--     customer_search). The body becomes `begin return <expr>; end`, where
--     <expr> is the old SELECT's expression byte for byte. No SET clause:
--     every name in the four bodies is in pg_catalog or schema-qualified
--     (app.phone_digits), and plpgsql is never inlined anyway.
--   * a SET clause, for the six called once per statement (b64url_encode,
--     b64url_decode, normalize_finding, like_escape, assistant_params_hash) or
--     per row of one customer (customer_reservation_json, which was never
--     inlined; see THE HOLE): the body verbatim plus `set search_path =
--     public`.
-- Signature, volatility, parallel safety, strictness, cost (100, the default
-- in both languages), owner and 0141's comment stay the same. The revokes and
-- the three service_role grants are re-issued exactly as they stand.
-- Re-runnable: create or replace; revoke and grant re-issued.
--
-- THE HOLE. PostgreSQL inlines a simple LANGUAGE sql function (one SELECT of an
-- expression, not SECURITY DEFINER, no SET clause) into the calling query. It
-- checks EXECUTE only while it plans. PostgREST prepares every statement on a
-- pooled connection that every role shares. After five service_role calls of
-- app.normalize_finding, that connection caches a generic plan with the body
-- inlined. The next anon or authenticated call to the same RPC reuses the plan
-- and skips the EXECUTE check. Over HTTP with the public anon key: 401 cold,
-- 200 once warm. This is proven for the three helpers granted to service_role:
-- business_date(timestamptz, text, int), normalize_finding and reports_bucket.
-- The other seven are granted to no API role, so nothing on a PostgREST
-- connection can plant such a plan. An owner session can (psql proof), and no
-- client can reach one. customer_reservation_json wraps the STABLE
-- jsonb_build_object inside an IMMUTABLE declaration, so the planner never
-- inlines it. It still takes the SET clause, so the rule has no exceptions.
-- A function that is not inlined stays a call in the plan, and the executor
-- checks EXECUTE for the current role each time it starts that plan, cached
-- or not.
--
-- IMPACT: none today. Each body is one expression over its own arguments and
-- reads no table. Every function the inlined body calls is still checked
-- against the caller. So a caller learns only what it could work out for
-- itself: a date, a bucket, a normalised string. The fix makes the revokes
-- true. It stops the owner-gate flake, which shows when the analytics file
-- runs twice inside PostgREST's 30 s idle window. The test below keeps the
-- next revoked helper from inheriting the hole: it fails on any revoked,
-- non-definer sql function in app or public that has no SET clause.
--
-- WHAT NEITHER TREATMENT COVERS: constant folding. The planner evaluates an
-- IMMUTABLE function whose arguments are all constants once, while it plans,
-- whatever its language, SET clause or definer flag, and keeps the result in
-- the plan as a constant. EXECUTE is checked then, for the role that plans. A
-- generic plan cached on a shared connection keeps that constant, and the
-- next role to run it never calls the function. PostgREST binds RPC arguments
-- as parameters, so a call reaches the planner with nothing but constants
-- only when the function needs no argument (every argument has a default).
-- The test's FOLDABLE guard keeps that class empty: no IMMUTABLE function in
-- app or public, callable with no argument, that an API role may run and a
-- client role may not. Today it is empty; the ten helpers each take a
-- required argument.
--
-- COST, and 0034 reversed on purpose. 0034:16 and 0034:62-63 left the
-- 3-argument business_date as plain SQL so the planner would inline it into
-- the per-row GROUP BY. An inlined helper is exactly one whose revoke a cached
-- plan can skip, so that choice goes; plpgsql keeps most of the speed.
-- Measured locally over one 576,000-row series (400 days of minutes in a temp
-- table, no JIT, no parallel workers, median of five runs), in ms:
--                                                 inlined     SET  plpgsql
--   business_date GROUP BY                            119     824      292
--   reports_bucket GROUP BY                            86   1,133      254
--   reports_bucket(business_date(..)) GROUP BY        169   2,022      524
--     (report_revenue's shape)
--   search_norm filter (customer_search's)          1,392   2,163    1,563
--   phone_canon filter (find_customer_by_phone's)     776   1,697      932
-- The SET clause adds 1.2–1.8 µs per call (a GUC save and restore each time);
-- plpgsql adds about 0.3 µs, which is why the four per-row helpers take it.
-- Every caller of these helpers is SECURITY DEFINER.
--
-- covered by packages/db/tests/sql-helpers-not-inlinable.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- app.b64url_encode (0014:56-59) verbatim, plus set search_path = public.
-- ---------------------------------------------------------------------------
create or replace function app.b64url_encode(p bytea) returns text
language sql immutable set search_path = public as $b64url_encode_0189$
  select translate(replace(encode(p, 'base64'), e'\n', ''), '+/=', '-_')
$b64url_encode_0189$;

revoke all on function app.b64url_encode(bytea) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.b64url_decode (0014:61-66) verbatim, plus set search_path = public.
-- ---------------------------------------------------------------------------
create or replace function app.b64url_decode(p text) returns bytea
language sql immutable set search_path = public as $b64url_decode_0189$
  select decode(
           translate(p, '-_', '+/') || repeat('=', (4 - length(p) % 4) % 4),
           'base64')
$b64url_decode_0189$;

revoke all on function app.b64url_decode(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.business_date (0034:64-68): the same expression, as LANGUAGE plpgsql.
-- ---------------------------------------------------------------------------
create or replace function app.business_date(p_at timestamptz, p_tz text, p_start_hour int)
returns date
language plpgsql immutable parallel safe as $business_date3_0189$
begin
  return ((p_at at time zone p_tz) - make_interval(hours => p_start_hour))::date;
end
$business_date3_0189$;

revoke all on function app.business_date(timestamptz, text, int) from public, anon, authenticated;
grant execute on function app.business_date(timestamptz, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- app.normalize_finding (0034:875-888) verbatim, plus set search_path = public.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_finding(p_text text)
returns text
language sql immutable parallel safe set search_path = public as $normalize_finding_0189$
  select btrim(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 translate(lower(p_text),
                           E'\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9',
                           '01234567890123456789'),
                 E'[\u0640\u064B-\u0652\u0670]', '', 'g'),
               '[^[:alnum:][:space:]]', ' ', 'g'),
             '\s+', ' ', 'g'))
$normalize_finding_0189$;

revoke all on function app.normalize_finding(text) from public, anon, authenticated;
grant execute on function app.normalize_finding(text) to service_role;   -- parity tests

-- ---------------------------------------------------------------------------
-- app.phone_canon (0065:130-137): the same expression, as LANGUAGE plpgsql.
-- ---------------------------------------------------------------------------
create or replace function app.phone_canon(p_phone text) returns text
language plpgsql immutable as $phone_canon_0189$
begin
  return nullif(
           regexp_replace(
             regexp_replace(coalesce(app.phone_digits(p_phone), ''), '^00', ''),
             '^(964|0)', ''),
           '');
end
$phone_canon_0189$;

revoke all on function app.phone_canon(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.search_norm (0065:146-154): the same expression, as LANGUAGE plpgsql.
-- ---------------------------------------------------------------------------
create or replace function app.search_norm(p_text text) returns text
language plpgsql immutable as $search_norm_0189$
begin
  return btrim(regexp_replace(
           translate(
             regexp_replace(lower(coalesce(p_text, '')), '[ـً-ْٰ]', '', 'g'),
             'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
             'ااااهي01234567890123456789'),
           '\s+', ' ', 'g'));
end
$search_norm_0189$;

revoke all on function app.search_norm(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.like_escape (0065:159-162) verbatim, plus set search_path = public.
-- ---------------------------------------------------------------------------
create or replace function app.like_escape(p_text text) returns text
language sql immutable set search_path = public as $like_escape_0189$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_')
$like_escape_0189$;

revoke all on function app.like_escape(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.customer_reservation_json (0065:194-207) verbatim, plus set search_path = public.
-- ---------------------------------------------------------------------------
create or replace function app.customer_reservation_json(r reservations, c courts) returns jsonb
language sql immutable set search_path = public as $customer_reservation_json_0189$
  select jsonb_build_object(
           'id',            (r).id,
           'court_id',      (r).court_id,
           'court_name_en', (c).name_en,
           'court_name_ar', (c).name_ar,
           'start_at',      (r).start_at,
           'end_at',        (r).end_at,
           'status',        (r).status,
           'kind',          (r).kind,
           'price_iqd',     (r).price_iqd,
           'source',        (r).source)
$customer_reservation_json_0189$;

revoke all on function app.customer_reservation_json(reservations, courts) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.reports_bucket (0068:85-93): the same expression, as LANGUAGE plpgsql.
-- ---------------------------------------------------------------------------
create or replace function app.reports_bucket(p_d date, p_group text)
returns date
language plpgsql immutable parallel safe as $reports_bucket_0189$
begin
  return case p_group
           when 'day'   then p_d
           when 'week'  then date_trunc('week', p_d::timestamp)::date
           when 'month' then date_trunc('month', p_d::timestamp)::date
         end;
end
$reports_bucket_0189$;

revoke all on function app.reports_bucket(date, text) from public, anon, authenticated;
grant execute on function app.reports_bucket(date, text) to service_role;

-- ---------------------------------------------------------------------------
-- app.assistant_params_hash (0141:130-137) verbatim, plus set search_path = public.
-- ---------------------------------------------------------------------------
create or replace function app.assistant_params_hash(p_params jsonb)
returns text
language sql immutable parallel safe set search_path = public as $assistant_params_hash_0189$
  -- jsonb text is canonical (keys sorted, one spacing), so {"to":…,"from":…}
  -- and {"from":…,"to":…} hash alike; nulls are stripped so an absent key and
  -- an explicit null are the same parameter set.
  select md5(jsonb_strip_nulls(coalesce(p_params, '{}'::jsonb))::text)
$assistant_params_hash_0189$;

revoke all on function app.assistant_params_hash(jsonb) from public, anon, authenticated;
