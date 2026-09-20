-- EVAL FIXTURE — the deterministic rows behind packages/db/tests/assistant-eval/cases.json
-- (plan §8 "Eval set"). Local stack only; never applied to prod.
--
-- Ids: the TEST-probe prefix `ee57` (tests/helpers.ts probeId) with the eval
-- marker `e7a1` in the last group, so an eval row can never be mistaken for
-- real data, for a fixture (`f1f7`) or for another suite's probe rows
-- (`ee570000-0000-4000-8000-0000000001xx`, which ensureCafeProbeData leaves in
-- place on purpose). Cleanup-by-prefix: id::text like 'ee570000-0000-4000-8000-0000e7a1%'.
--
-- Eval week: business days 2024-03-04 (Mon) .. 2024-03-10 (Sun). The seed has
-- nothing there, so the aggregates over that range see only these rows.
-- Business day = Asia/Baghdad (+03) minus 4 h (app.analytics_bounds), so a
-- '2024-03-05 12:00+03' timestamp is business day 2024-03-05 and the week's
-- bounds are [2024-03-04 04:00+03, 2024-03-11 04:00+03).
--
-- How it is applied: through the stack's own container as postgres with
-- `set session_replication_role = replica` — audit_log, payments and refunds
-- are append-only (app.forbid_mutation) so no client path could remove them,
-- and the realtime / push / index triggers must not fire for planted rows.
-- The two sections are split on the `-- @section` markers: `cleanup` runs
-- before `plant` (idempotent) and again on its own afterwards.
--
-- Expected figures for the week (pinned by `expect.value` in cases.json):
--   padel revenue 180000 (4 live bookings: 40000+60000+40000+40000), booked 270 min,
--   1 cancellation, 1 no-show; cafe gross 49000 (15000+11000+18000+5000), discounts 2000,
--   refunds 1000 (card), cafe net 48000; revenue = 180000 + 48000 = 228000;
--   cash 58000 (15000+18000+25000), card 30000 (11000+20000-1000);
--   4 orders, avg order value round(49000/4) = 12250; best seller Eval Latte 10 units;
--   5 tabs (4 settled + 1 void), 5 payments; breaks 25+15 = 40 min.

-- @section cleanup
delete from audit_log        where device_id = 'ee57-eval' or entity_id like 'ee570000-0000-4000-8000-0000e7a1%';
delete from refunds          where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from payments         where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from order_items      where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from orders           where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from tabs             where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from reservations     where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from day_sessions     where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from staff_breaks     where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from staff_requests   where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from menu_item_variants where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from menu_items       where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from menu_categories  where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from courts           where id::text like 'ee570000-0000-4000-8000-0000e7a1%';
delete from assistant_index_queue where ref like 'ee570000-0000-4000-8000-0000e7a1%';

-- @section plant

-- ── Court (inactive with a window, so the desk never offers it; the reports
--    still include it because it has bookings in the range) ──────────────────
insert into courts (id, name_en, name_ar, indoor, duration_options, sort_order, is_active, active_from, active_to)
values ('ee570000-0000-4000-8000-0000e7a10001', 'Eval Court', 'ملعب التقييم', true, '{60,90,120}', 990, false, '2024-03-01', '2024-03-31')
on conflict (id) do nothing;

-- ── Menu: one hidden category with two items ────────────────────────────────
insert into menu_categories (id, name_en, name_ar, tax_group_id, sort_order, is_active, serve_temp)
values ('ee570000-0000-4000-8000-0000e7a10101', 'Eval Drinks', 'مشروبات التقييم', 'b0000000-0000-4000-8000-000000000001', 990, false, 'none')
on conflict (id) do nothing;
insert into menu_items (id, category_id, name_en, name_ar, is_active, sort_order, hook_en, hook_ar, highlight, sold_out, serve_temp)
values ('ee570000-0000-4000-8000-0000e7a10102', 'ee570000-0000-4000-8000-0000e7a10101', 'Eval Latte', 'لاتيه التقييم', false, 1, '', '', 'none', false, 'none'),
       ('ee570000-0000-4000-8000-0000e7a10104', 'ee570000-0000-4000-8000-0000e7a10101', 'Eval Water', 'ماء التقييم',   false, 2, '', '', 'none', false, 'none')
on conflict (id) do nothing;
insert into menu_item_variants (id, item_id, name_en, name_ar, price_iqd, is_default, sort_order)
values ('ee570000-0000-4000-8000-0000e7a10103', 'ee570000-0000-4000-8000-0000e7a10102', 'Regular', 'عادي', 5000, true, 0),
       ('ee570000-0000-4000-8000-0000e7a10105', 'ee570000-0000-4000-8000-0000e7a10104', 'Bottle',  'قنينة', 1000, true, 0)
on conflict (id) do nothing;

-- ── Trading days (closed) ───────────────────────────────────────────────────
insert into day_sessions (id, business_date, status, opened_at, opened_by, opening_float_iqd, closed_at, closed_by, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd)
values ('ee570000-0000-4000-8000-0000e7a10201', '2024-03-05', 'closed', '2024-03-05 09:00:00+03', 'a0000000-0000-4000-8000-000000000002', 100000, '2024-03-06 02:00:00+03', 'a0000000-0000-4000-8000-000000000002', 115000, 115000, 0),
       ('ee570000-0000-4000-8000-0000e7a10202', '2024-03-06', 'closed', '2024-03-06 09:00:00+03', 'a0000000-0000-4000-8000-000000000002', 100000, '2024-03-07 02:30:00+03', 'a0000000-0000-4000-8000-000000000002', 118000, 116000, -2000),
       ('ee570000-0000-4000-8000-0000e7a10203', '2024-03-08', 'closed', '2024-03-08 09:00:00+03', 'a0000000-0000-4000-8000-000000000003', 100000, '2024-03-09 01:30:00+03', 'a0000000-0000-4000-8000-000000000002', 125000, 125000, 0)
on conflict (id) do nothing;

-- ── Bookings on the eval court (created at the desk by Dev Court Desk) ─────
insert into reservations (id, court_id, kind, status, start_at, end_at, guest_name, guest_phone, created_by_staff_id, source, price_iqd, players, created_at, cancelled_at, cancelled_by, cancellation_reason)
values
  ('ee570000-0000-4000-8000-0000e7a10801', 'ee570000-0000-4000-8000-0000e7a10001', 'booking', 'completed', '2024-03-08 19:00:00+03', '2024-03-08 20:00:00+03', 'Eval Guest One',   null, 'a0000000-0000-4000-8000-000000000005', 'desk', 40000, 4, '2024-03-04 10:00:00+03', null, null, null),
  ('ee570000-0000-4000-8000-0000e7a10802', 'ee570000-0000-4000-8000-0000e7a10001', 'booking', 'confirmed', '2024-03-05 17:00:00+03', '2024-03-05 18:30:00+03', 'Eval Guest Two',   null, 'a0000000-0000-4000-8000-000000000005', 'desk', 60000, 4, '2024-03-04 10:05:00+03', null, null, null),
  ('ee570000-0000-4000-8000-0000e7a10803', 'ee570000-0000-4000-8000-0000e7a10001', 'booking', 'completed', '2024-03-06 18:00:00+03', '2024-03-06 19:00:00+03', 'Eval Guest Three', null, 'a0000000-0000-4000-8000-000000000005', 'desk', 40000, 2, '2024-03-04 10:10:00+03', null, null, null),
  ('ee570000-0000-4000-8000-0000e7a10804', 'ee570000-0000-4000-8000-0000e7a10001', 'booking', 'cancelled', '2024-03-07 20:00:00+03', '2024-03-07 21:00:00+03', 'Eval Guest Four',  null, 'a0000000-0000-4000-8000-000000000005', 'desk', 40000, null, '2024-03-04 10:15:00+03', '2024-03-07 10:00:00+03', 'staff', 'guest_request'),
  ('ee570000-0000-4000-8000-0000e7a10805', 'ee570000-0000-4000-8000-0000e7a10001', 'booking', 'no_show',   '2024-03-09 16:00:00+03', '2024-03-09 17:00:00+03', 'Eval Guest Five',  null, 'a0000000-0000-4000-8000-000000000005', 'desk', 40000, null, '2024-03-04 10:20:00+03', null, null, null),
  ('ee570000-0000-4000-8000-0000e7a10806', 'ee570000-0000-4000-8000-0000e7a10001', 'booking', 'arrived',   '2024-03-10 15:00:00+03', '2024-03-10 16:00:00+03', 'Eval Guest Six',   null, 'a0000000-0000-4000-8000-000000000005', 'desk', 40000, 3, '2024-03-04 10:25:00+03', null, null, null)
on conflict (id) do nothing;

-- ── Tabs: four settled (one carrying a court fee), one void ─────────────────
insert into tabs (id, day_session_id, status, reservation_id, label, opened_by_staff_id, subtotal_iqd, tax_iqd, discount_iqd, total_iqd, court_iqd, opened_at, settled_at)
values
  ('ee570000-0000-4000-8000-0000e7a10301', 'ee570000-0000-4000-8000-0000e7a10201', 'settled', null, 'Eval tab 1', 'a0000000-0000-4000-8000-000000000003', 15000, 0, 0,    15000, 0,     '2024-03-05 12:00:00+03', '2024-03-05 12:30:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10302', 'ee570000-0000-4000-8000-0000e7a10201', 'settled', null, 'Eval tab 2', 'a0000000-0000-4000-8000-000000000003', 11000, 0, 0,    11000, 0,     '2024-03-05 18:00:00+03', '2024-03-05 18:40:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10303', 'ee570000-0000-4000-8000-0000e7a10202', 'settled', null, 'Eval tab 3', 'a0000000-0000-4000-8000-000000000002', 20000, 0, 2000, 18000, 0,     '2024-03-06 20:00:00+03', '2024-03-06 20:50:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10304', 'ee570000-0000-4000-8000-0000e7a10203', 'void',    null, 'Eval tab 4', 'a0000000-0000-4000-8000-000000000003', null,  null, null, null, 0,   '2024-03-08 13:00:00+03', null),
  ('ee570000-0000-4000-8000-0000e7a10305', 'ee570000-0000-4000-8000-0000e7a10203', 'settled', 'ee570000-0000-4000-8000-0000e7a10801', 'Eval tab 5', 'a0000000-0000-4000-8000-000000000003', 5000, 0, 0, 45000, 40000, '2024-03-08 19:00:00+03', '2024-03-08 21:10:00+03')
on conflict (id) do nothing;

-- ── Orders and lines (till orders, served) ──────────────────────────────────
insert into orders (id, tab_id, source, placed_by_staff_id, status, placed_at)
values
  ('ee570000-0000-4000-8000-0000e7a10401', 'ee570000-0000-4000-8000-0000e7a10301', 'till', 'a0000000-0000-4000-8000-000000000003', 'served', '2024-03-05 12:05:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10402', 'ee570000-0000-4000-8000-0000e7a10302', 'till', 'a0000000-0000-4000-8000-000000000003', 'served', '2024-03-05 18:05:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10403', 'ee570000-0000-4000-8000-0000e7a10303', 'till', 'a0000000-0000-4000-8000-000000000002', 'served', '2024-03-06 20:05:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10404', 'ee570000-0000-4000-8000-0000e7a10305', 'till', 'a0000000-0000-4000-8000-000000000003', 'served', '2024-03-08 19:30:00+03')
on conflict (id) do nothing;
insert into order_items (id, order_id, menu_item_id, variant_id, qty, unit_price_iqd, line_total_iqd, voided, discount_pct, line_no)
values
  ('ee570000-0000-4000-8000-0000e7a10501', 'ee570000-0000-4000-8000-0000e7a10401', 'ee570000-0000-4000-8000-0000e7a10102', 'ee570000-0000-4000-8000-0000e7a10103', 3, 5000, 15000, false, 0, 1),
  ('ee570000-0000-4000-8000-0000e7a10502', 'ee570000-0000-4000-8000-0000e7a10402', 'ee570000-0000-4000-8000-0000e7a10102', 'ee570000-0000-4000-8000-0000e7a10103', 2, 5000, 10000, false, 0, 1),
  ('ee570000-0000-4000-8000-0000e7a10503', 'ee570000-0000-4000-8000-0000e7a10402', 'ee570000-0000-4000-8000-0000e7a10104', 'ee570000-0000-4000-8000-0000e7a10105', 1, 1000, 1000,  false, 0, 2),
  ('ee570000-0000-4000-8000-0000e7a10504', 'ee570000-0000-4000-8000-0000e7a10403', 'ee570000-0000-4000-8000-0000e7a10102', 'ee570000-0000-4000-8000-0000e7a10103', 4, 5000, 20000, false, 0, 1),
  ('ee570000-0000-4000-8000-0000e7a10505', 'ee570000-0000-4000-8000-0000e7a10404', 'ee570000-0000-4000-8000-0000e7a10102', 'ee570000-0000-4000-8000-0000e7a10103', 1, 5000, 5000,  false, 0, 1)
on conflict (id) do nothing;

-- ── Payments (cash 58000, card 31000) and one card refund of 1000 ───────────
insert into payments (id, tab_id, day_session_id, method, amount_iqd, tendered_iqd, change_iqd, recorded_by, created_at)
values
  ('ee570000-0000-4000-8000-0000e7a10601', 'ee570000-0000-4000-8000-0000e7a10301', 'ee570000-0000-4000-8000-0000e7a10201', 'cash', 15000, 15000, 0, 'a0000000-0000-4000-8000-000000000003', '2024-03-05 12:30:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10602', 'ee570000-0000-4000-8000-0000e7a10302', 'ee570000-0000-4000-8000-0000e7a10201', 'card', 11000, null,  null, 'a0000000-0000-4000-8000-000000000003', '2024-03-05 18:40:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10603', 'ee570000-0000-4000-8000-0000e7a10303', 'ee570000-0000-4000-8000-0000e7a10202', 'cash', 18000, 20000, 2000, 'a0000000-0000-4000-8000-000000000002', '2024-03-06 20:50:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10604', 'ee570000-0000-4000-8000-0000e7a10305', 'ee570000-0000-4000-8000-0000e7a10203', 'cash', 25000, 25000, 0, 'a0000000-0000-4000-8000-000000000003', '2024-03-08 21:10:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10605', 'ee570000-0000-4000-8000-0000e7a10305', 'ee570000-0000-4000-8000-0000e7a10203', 'card', 20000, null,  null, 'a0000000-0000-4000-8000-000000000003', '2024-03-08 21:10:00+03')
on conflict (id) do nothing;
insert into refunds (id, payment_id, amount_iqd, reason_code, refunded_by, created_at)
values ('ee570000-0000-4000-8000-0000e7a10701', 'ee570000-0000-4000-8000-0000e7a10602', 1000, 'wrong_item', 'a0000000-0000-4000-8000-000000000002', '2024-03-05 19:00:00+03')
on conflict (id) do nothing;

-- ── Staff requests: two pending, one approved by the owner, one rejected by the manager
insert into staff_requests (id, staff_id, kind, status, from_date, to_date, amount_iqd, note, created_at, decided_by, decided_at, decision_note)
values
  ('ee570000-0000-4000-8000-0000e7a10901', 'a0000000-0000-4000-8000-000000000003', 'leave',      'pending',  '2024-03-11', '2024-03-12', null,   'Eval leave',        '2024-03-05 10:00:00+03', null, null, null),
  ('ee570000-0000-4000-8000-0000e7a10902', 'a0000000-0000-4000-8000-000000000004', 'advance',    'approved', null,         null,         150000, 'Eval wage advance', '2024-03-05 11:00:00+03', 'a0000000-0000-4000-8000-000000000001', '2024-03-06 09:00:00+03', 'ok'),
  ('ee570000-0000-4000-8000-0000e7a10903', 'a0000000-0000-4000-8000-000000000005', 'shift_swap', 'rejected', '2024-03-09', '2024-03-09', null,   'Eval shift swap',   '2024-03-06 10:00:00+03', 'a0000000-0000-4000-8000-000000000002', '2024-03-08 09:00:00+03', 'no cover available'),
  ('ee570000-0000-4000-8000-0000e7a10904', 'a0000000-0000-4000-8000-000000000003', 'advance',    'pending',  null,         null,         50000,  'Eval small advance','2024-03-09 10:00:00+03', null, null, null)
on conflict (id) do nothing;

-- ── Breaks: 25 min covered by the manager, 15 min uncovered ─────────────────
insert into staff_breaks (id, staff_id, station_id, business_date, started_at, ended_at, covered_by, cover_started_at)
values
  ('ee570000-0000-4000-8000-0000e7a10a01', 'a0000000-0000-4000-8000-000000000003', 'till-1',  '2024-03-05', '2024-03-05 14:00:00+03', '2024-03-05 14:25:00+03', 'a0000000-0000-4000-8000-000000000002', '2024-03-05 14:00:00+03'),
  ('ee570000-0000-4000-8000-0000e7a10a02', 'a0000000-0000-4000-8000-000000000004', 'kitchen', '2024-03-06', '2024-03-06 15:00:00+03', '2024-03-06 15:15:00+03', null, null)
on conflict (id) do nothing;

-- ── Audit trail: who did what (device_id 'ee57-eval' is the cleanup key) ────
insert into audit_log (at, actor_id, actor_role, authorizer_id, action, entity, entity_id, before, after, reason_code, device_id)
values
  ('2024-03-04 11:00:00+03', 'a0000000-0000-4000-8000-000000000001', 'owner',      null, 'rate_rule.update',       'rate_rule',     'ee570000-0000-4000-8000-0000e7a10b01', '{"price_iqd":40000}', '{"price_iqd":45000}', null,                 'ee57-eval'),
  ('2024-03-04 12:00:00+03', 'a0000000-0000-4000-8000-000000000001', 'owner',      null, 'staff.set_role',         'staff',         'a0000000-0000-4000-8000-000000000004', '{"role":"cashier"}',  '{"role":"prep"}',     null,                 'ee57-eval'),
  ('2024-03-05 19:00:00+03', 'a0000000-0000-4000-8000-000000000002', 'manager',    null, 'payment.refund',         'payment',       'ee570000-0000-4000-8000-0000e7a10602', null,                  '{"amount_iqd":1000,"method":"card"}', 'wrong_item', 'ee57-eval'),
  ('2024-03-06 09:00:00+03', 'a0000000-0000-4000-8000-000000000001', 'owner',      null, 'staff_request.decide',   'staff_request', 'ee570000-0000-4000-8000-0000e7a10902', '{"status":"pending"}', '{"status":"approved","kind":"advance","amount_iqd":150000}', null, 'ee57-eval'),
  ('2024-03-06 20:45:00+03', 'a0000000-0000-4000-8000-000000000002', 'manager',    null, 'tab.discount',           'tab',           'ee570000-0000-4000-8000-0000e7a10303', '{"discount_iqd":0}',  '{"discount_iqd":2000}', 'staff_meal',       'ee57-eval'),
  ('2024-03-07 02:30:00+03', 'a0000000-0000-4000-8000-000000000002', 'manager',    null, 'day.close',              'day_session',   'ee570000-0000-4000-8000-0000e7a10202', null,                  '{"business_date":"2024-03-06","cash_variance_iqd":-2000}', null, 'ee57-eval'),
  ('2024-03-07 10:00:00+03', 'a0000000-0000-4000-8000-000000000005', 'court_desk', null, 'reservation.cancel',     'reservation',   'ee570000-0000-4000-8000-0000e7a10804', '{"status":"confirmed"}', '{"status":"cancelled"}', 'guest_request',  'ee57-eval'),
  ('2024-03-08 09:00:00+03', 'a0000000-0000-4000-8000-000000000002', 'manager',    null, 'staff_request.decide',   'staff_request', 'ee570000-0000-4000-8000-0000e7a10903', '{"status":"pending"}', '{"status":"rejected","kind":"shift_swap"}', 'no_cover',  'ee57-eval'),
  ('2024-03-08 13:05:00+03', 'a0000000-0000-4000-8000-000000000003', 'cashier',    'a0000000-0000-4000-8000-000000000002', 'tab.void', 'tab', 'ee570000-0000-4000-8000-0000e7a10304', '{"status":"open"}', '{"status":"void"}', 'opened_by_mistake', 'ee57-eval'),
  ('2024-03-09 16:20:00+03', 'a0000000-0000-4000-8000-000000000005', 'court_desk', null, 'reservation.no_show',    'reservation',   'ee570000-0000-4000-8000-0000e7a10805', '{"status":"confirmed"}', '{"status":"no_show"}', null,              'ee57-eval'),
  ('2024-03-10 15:02:00+03', 'a0000000-0000-4000-8000-000000000003', 'cashier',    null, 'reservation.mark_arrived','reservation',  'ee570000-0000-4000-8000-0000e7a10806', '{"status":"confirmed"}', '{"status":"arrived"}', null,              'ee57-eval');
