-- FIXTURE — replaceable business data, dev/staging ONLY. Never applied to prod.
--
-- Reserved fixture UUID prefix 'f1f7' (see courts.sql / packages/db/README.md).
-- Suffix namespace: venue B 00000000be01..be41. ('b0**' is taken —
-- seeds/one-size-catchup.sql:29 — so this file uses 'be**'.)
--
-- Content: a SECOND venue, so a human can see the multi-venue schema (0122-0138)
-- behave by hand: the venue itself, two courts, one all-day rate rule with
-- prices, two cafe tables deliberately numbered 'T1'/'T2' — the same numbers
-- venue A's tables.sql uses — and one till station. No staff, no auth users, no
-- day sessions.
--
-- NOT IN THE DEFAULT FIXTURE LIST, and it must never be added to it. Three
-- reasons, each one already proved by a red suite:
--
--   1. e2e. apps/web-e2e's operator-journey.spec.ts:87 walks the desk grid by
--      position; a second venue's courts renumber it.
--   2. cafe admin. operator-cafe-admin.spec.ts:188 looks a table up by
--      table_number with .single(); 'T1' existing twice makes that throw.
--   3. the bench. bench/ counts courts, and the compare would read a second
--      venue's capacity as a regression.
--
--   And the big one: while TWO venues are ACTIVE, app.current_venue() cannot
--   resolve for a caller with no station and no single membership, so every
--   venue-less insert — the seeds, the other fixtures, `check:authz` stage 2,
--   every service_role write in the test suite — raises VENUE_REQUIRED. That is
--   the design (0125/R1), not a bug: a row is filed where the caller belongs or
--   the write is refused loudly.
--
-- Apply:  pnpm --filter @touch/db db:fixtures:venue-b
-- Undo:   pnpm --filter @touch/db db:reset && pnpm --filter @touch/db db:fixtures
--         (always do this before any e2e or check:authz run)
--
-- MANUAL STAGING STEP — staff_venues. This file creates NO staff, so nobody can
-- sign in and see venue B. To give a dev account a second venue by hand:
--
--     insert into staff_venues (staff_id, venue_id, role)
--     values ('<staff uuid>', 'f1f70000-0000-4000-8000-00000000be01', 'manager')
--     on conflict (staff_id, venue_id) do nothing;
--
-- Remember that a staffer with TWO memberships and no asserted station resolves
-- to NO venue (0125 step 3), so delete their venue-A row as well if you want
-- their writes to land at B. The db suite does exactly this in
-- tests/helpers.ts ensureVenueBProbeData, on its own ee57 ids, and puts it back
-- in deactivateVenueBProbeData.
--
-- Every insert below names venue_id explicitly. The column default is
-- app.current_venue(), which is precisely what this file makes ambiguous.

begin;

-- ---------------------------------------------------------------------------
-- The venue. '+9647700000001' is the reserved-for-testing shape
-- (scripts/security/check-data-hygiene.mjs:49-58): 7XX, six zeros, then free
-- digits. Never a real Iraqi number in a fixture.
-- ---------------------------------------------------------------------------
insert into venues (id, slug, name_en, name_ar, timezone, phone, is_active) values
  ('f1f70000-0000-4000-8000-00000000be01', 'karrada',
   'Touch Padel — Karrada', 'تاتش بادل — الكرادة',
   'Asia/Baghdad', '+9647700000001', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Courts. sort_order 101/102 so every "first court" lookup — check:authz
-- stage 2, tests/analytics.test.ts:675, the desk grid — keeps picking venue A's
-- court 1.
-- ---------------------------------------------------------------------------
insert into courts (id, venue_id, name_en, name_ar, description_en, description_ar, indoor, duration_options, sort_order, is_active) values
  ('f1f70000-0000-4000-8000-00000000be11', 'f1f70000-0000-4000-8000-00000000be01',
   'Karrada Court 1', 'ملعب الكرادة ١',
   'Panoramic court', 'ملعب بانورامي', true, '{60,90,120}', 101, true),
  ('f1f70000-0000-4000-8000-00000000be12', 'f1f70000-0000-4000-8000-00000000be01',
   'Karrada Court 2', 'ملعب الكرادة ٢',
   'Panoramic court', 'ملعب بانورامي', true, '{60,90,120}', 102, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- One all-day rule so a B slot prices at all (a slot with no rule fails
-- NO_RATE). Priority -100: it never beats a real rule if one is ever added.
-- ---------------------------------------------------------------------------
insert into rate_rules (id, venue_id, name, court_id, days_of_week, start_time, end_time, priority, is_active) values
  ('f1f70000-0000-4000-8000-00000000be21', 'f1f70000-0000-4000-8000-00000000be01',
   'Karrada all-day', null, '{0,1,2,3,4,5,6}', '09:00', '23:00', -100, true)
on conflict (id) do nothing;

insert into rate_rule_prices (rule_id, duration_min, price_iqd) values
  ('f1f70000-0000-4000-8000-00000000be21',  60,  40000),
  ('f1f70000-0000-4000-8000-00000000be21',  90,  55000),
  ('f1f70000-0000-4000-8000-00000000be21', 120,  70000)
on conflict (rule_id, duration_min) do nothing;

-- ---------------------------------------------------------------------------
-- Cafe tables. 'T1'/'T2' already exist at venue A (tables.sql). The collision
-- is the point: it is what 0134's (venue_id, table_number) unique index exists
-- for, and it is why this file cannot join the default list.
-- ---------------------------------------------------------------------------
insert into cafe_tables (id, venue_id, table_number, zone, capacity, token_version, bell_enabled, is_active) values
  ('f1f70000-0000-4000-8000-00000000be31', 'f1f70000-0000-4000-8000-00000000be01',
   'T1', 'indoor', 4, 1, true, true),
  ('f1f70000-0000-4000-8000-00000000be32', 'f1f70000-0000-4000-8000-00000000be01',
   'T2', 'indoor', 4, 1, true, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- One till. app.heartbeat registers a station on its own (0130), but a station
-- that exists before the first beat is what makes a hand walk-through legible:
-- app.current_venue('TILL-B1') answers B from the first call.
-- ---------------------------------------------------------------------------
insert into stations (id, venue_id, is_till) values
  ('TILL-B1', 'f1f70000-0000-4000-8000-00000000be01', true)
on conflict (id) do nothing;

commit;
