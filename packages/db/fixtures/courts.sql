-- FIXTURE — replaceable business data, dev/staging ONLY. Never applied to prod.
--
-- Reserved fixture UUID prefix: every fixture row id starts with 'f1f7'
-- ("FIXT"; the design doc's illustrative '00000000-f1x7-…' is not valid hex).
-- Nothing outside packages/db/fixtures/ may ever reference an f1f7 UUID.
-- Swap procedure: see packages/db/README.md — delete by prefix, run the
-- client-data import scripts (CSV templates issued to Touch in week 1).
--
-- Apply: pnpm --filter @touch/db db:fixtures   (psql against the local stack)
--
-- Content: 4 courts (2 indoor / 2 outdoor), rate rules for weekday off-peak /
-- weekday peak (17:00-23:00) / weekend (Iraq weekend = Fri+Sat; days_of_week
-- 0=Sun..6=Sat), per-duration absolute prices in round IQD.

begin;

-- ---------------------------------------------------------------------------
-- Courts
-- ---------------------------------------------------------------------------
insert into courts (id, name_en, name_ar, description_en, description_ar, indoor, duration_options, sort_order, is_active) values
  ('f1f70000-0000-4000-8000-00000000c001', 'Indoor Court 1',  'الملعب الداخلي ١',
   'Air-conditioned panoramic court', 'ملعب بانورامي مكيّف', true,  '{60,90,120}', 1, true),
  ('f1f70000-0000-4000-8000-00000000c002', 'Indoor Court 2',  'الملعب الداخلي ٢',
   'Air-conditioned panoramic court', 'ملعب بانورامي مكيّف', true,  '{60,90,120}', 2, true),
  ('f1f70000-0000-4000-8000-00000000c003', 'Outdoor Court 1', 'الملعب الخارجي ١',
   'Open-air court with night lighting', 'ملعب مكشوف مع إضاءة ليلية', false, '{60,90,120}', 3, true),
  ('f1f70000-0000-4000-8000-00000000c004', 'Outdoor Court 2', 'الملعب الخارجي ٢',
   'Open-air court with night lighting', 'ملعب مكشوف مع إضاءة ليلية', false, '{60,90,120}', 4, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Rate rules (court_id NULL = all courts). Priority: court-specific beats
-- NULL-court, then higher priority wins — peak (10) > weekend (5) > off-peak (0).
-- ---------------------------------------------------------------------------
insert into rate_rules (id, name, court_id, days_of_week, start_time, end_time, priority, is_active) values
  ('f1f70000-0000-4000-8000-00000000a001', 'Weekday off-peak', null, '{0,1,2,3,4}', '09:00', '17:00', 0,  true),
  ('f1f70000-0000-4000-8000-00000000a002', 'Weekday peak',     null, '{0,1,2,3,4}', '17:00', '23:00', 10, true),
  ('f1f70000-0000-4000-8000-00000000a003', 'Weekend',          null, '{5,6}',       '09:00', '23:00', 5,  true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Per-duration prices, round IQD (integer money — no floats, ever)
-- ---------------------------------------------------------------------------
insert into rate_rule_prices (rule_id, duration_min, price_iqd) values
  -- Weekday off-peak
  ('f1f70000-0000-4000-8000-00000000a001',  60,  40000),
  ('f1f70000-0000-4000-8000-00000000a001',  90,  55000),
  ('f1f70000-0000-4000-8000-00000000a001', 120,  70000),
  -- Weekday peak (17:00-23:00)
  ('f1f70000-0000-4000-8000-00000000a002',  60,  50000),
  ('f1f70000-0000-4000-8000-00000000a002',  90,  70000),
  ('f1f70000-0000-4000-8000-00000000a002', 120,  90000),
  -- Weekend (Fri + Sat)
  ('f1f70000-0000-4000-8000-00000000a003',  60,  60000),
  ('f1f70000-0000-4000-8000-00000000a003',  90,  85000),
  ('f1f70000-0000-4000-8000-00000000a003', 120, 110000)
on conflict (rule_id, duration_min) do nothing;

commit;
