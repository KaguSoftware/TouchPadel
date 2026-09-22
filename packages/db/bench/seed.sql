-- BENCH FIXTURE — a database "full of test data", loaded only to be measured.
-- Never applied to staging or production. Apply with:
--
--     pnpm --filter @touch/db bench:seed      (node scripts/db-fixtures.mjs bench/seed.sql)
--
-- and remove with bench/teardown.sql (`bench:teardown`).
--
-- RESERVED UUID PREFIX `bec4` ("BENCh"), the same scheme as the fixtures' `f1f7`
-- and the test probes' `ee57`: every row this file writes starts with
-- `bec40000-0000-4000-8000-…`, so teardown can delete by prefix and a bench row
-- can never be mistaken for real data, a fixture or a probe. The first hex digit
-- of the last group is a per-table tag:
--
--     c…  courts          d…  rate rules      1…  reservations (bookings)
--     2…  expired holds   3…  day sessions    4…  tabs
--     5…  orders          6…  order items     7…  payments      8…  tickets
--     a…  menu            b…  cafe tables
--
-- IDEMPOTENT. Every insert is `on conflict do nothing` and every id is derived,
-- never random, so a second run is a no-op and a partial run can be finished by
-- re-running. Wrapped in one begin/commit: either the whole bench fixture is
-- there or none of it is.
--
-- TRIGGERS STAY ON. The realtime fan-out (reservations_rt), the line-number
-- trigger and the stock hook all run, because the bench exists to measure the
-- database as the product actually runs it. That is also why the bench menu
-- carries NO recipe lines: app.trg_ticket_consume would then walk FEFO batches
-- for every one of the ~2,810 seeded tickets and drain stock the cafe suites
-- expect to find, which is a side effect on the test suite, not a measurement.
--
-- WHAT IT IS SIZED FOR (PHASE-2-PLAN.md Part C+): 12,800 bookings and 1,200
-- expired holds over 400 days on four courts, plus 281 closed cafe days, so `analytics_courts_*`,
-- `analytics_hourly` and `report_revenue` are measured against a table they
-- cannot index-scan their way out of, and so the 400-day statement-timeout
-- finding (PHASE-2-CHECKLIST.md) is reproducible rather than anecdotal.

begin;

-- ---------------------------------------------------------------------------
-- 1. Courts. Four of them, because the booking area spreads N=10 and N=50
--    callers across four courts as well as piling them onto one.
--
--    No active_from / active_to: app.analytics_open_minutes multiplies the
--    venue's opening windows by every court inside its active window, and a
--    court that opened partway through the measured year would make the
--    open-minutes denominator move between runs as `current_date` advances.
-- ---------------------------------------------------------------------------
insert into courts (id, name_en, name_ar, description_en, description_ar,
                    indoor, duration_options, sort_order, is_active) values
  ('bec40000-0000-4000-8000-00000000c001', 'bench-court-1', 'bench-court-1',
   'bench fixture court', 'ملعب قياس الأداء', true,  '{60,90,120}', 901, true),
  ('bec40000-0000-4000-8000-00000000c002', 'bench-court-2', 'bench-court-2',
   'bench fixture court', 'ملعب قياس الأداء', true,  '{60,90,120}', 902, true),
  ('bec40000-0000-4000-8000-00000000c003', 'bench-court-3', 'bench-court-3',
   'bench fixture court', 'ملعب قياس الأداء', false, '{60,90,120}', 903, true),
  ('bec40000-0000-4000-8000-00000000c004', 'bench-court-4', 'bench-court-4',
   'bench fixture court', 'ملعب قياس الأداء', false, '{60,90,120}', 904, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Rate rules — COURT-SCOPED, one per bench court, priority -90.
--
--    NOT an all-courts rule. packages/db/fixtures/pricing-golden.json asserts
--    that three cases price to NOTHING in a fixed past week, and tests/helpers.ts
--    (~L166-178) records what an unbounded all-courts helper did to them: it
--    priced every slot on every court at every instant in history and turned
--    three deliberate "no rule prices this" cases green by accident. A rule
--    scoped to a bec4 court cannot reach an f1f7 court at all, so the golden
--    file is out of range by construction rather than by luck.
--
--    valid_from is current_date - 400: the bench's own measured window, never
--    open-ended. Priority -90 loses to every fixture rule (off-peak 0, weekend
--    5, peak 10), so on the hours the fixtures already cover the bench courts
--    price exactly like a real court; this rule only guarantees that the hours
--    they do NOT cover still resolve instead of failing NO_RATE.
-- ---------------------------------------------------------------------------
insert into rate_rules (id, name, court_id, days_of_week, start_time, end_time,
                        priority, valid_from, valid_to, is_active)
select c.rule_id,
       'bench-allday-' || c.n,
       c.id,
       '{0,1,2,3,4,5,6}'::int[],
       '00:00'::time, '23:59:59'::time,
       -90,
       current_date - 400,
       null,
       true
  from (values
    ('bec40000-0000-4000-8000-00000000c001'::uuid, 1, 'bec40000-0000-4000-8000-00000000d001'::uuid),
    ('bec40000-0000-4000-8000-00000000c002'::uuid, 2, 'bec40000-0000-4000-8000-00000000d002'::uuid),
    ('bec40000-0000-4000-8000-00000000c003'::uuid, 3, 'bec40000-0000-4000-8000-00000000d003'::uuid),
    ('bec40000-0000-4000-8000-00000000c004'::uuid, 4, 'bec40000-0000-4000-8000-00000000d004'::uuid)
  ) c(id, n, rule_id)
on conflict (id) do nothing;

insert into rate_rule_prices (rule_id, duration_min, price_iqd)
select r.id, d.duration_min, d.price_iqd
  from rate_rules r
  cross join (values (60, 40000), (90, 55000), (120, 70000)) d(duration_min, price_iqd)
 where r.name like 'bench-allday-%'
on conflict (rule_id, duration_min) do nothing;

-- ---------------------------------------------------------------------------
-- 2b. Three hundred bench guests, as PROFILES ONLY.
--
--     public.profiles has no foreign key OUT to auth.users (only inbound
--     references), so a bench identity is one row here and nothing in the auth
--     schema — no invented sign-ins, and teardown is a delete by prefix.
--
--     WHY THE RESERVATIONS BELOW CARRY guest_id AND NOT guest_phone. Identity in
--     the analytics RPCs comes from app.analytics_guest_ident(guest_id,
--     guest_phone), and its two branches cost wildly different amounts:
--
--       guest_id is not null   ->  'u:' || guest_id            (free)
--       phone_canon(phone) null->  null                        (free)
--       otherwise              ->  SELECT over profiles with app.phone_canon()
--                                  applied to every row        (a seq scan, per
--                                                               reservation)
--
--     Measured on this seed: 6,400 phone-only bookings cost 5.85 s in that third
--     branch, against 20 ms for phone_canon alone — and
--     analytics_courts_endings and analytics_courts_guests each evaluate it two
--     or three times over the window. That was enough to push both RPCs past the
--     `authenticated` role's 8 s statement_timeout and to turn
--     tests/analytics-courts.test.ts and tests/assistant-wall.test.ts red while
--     the bench fixture was loaded — a seed breaking the suite it shares a
--     database with.
--
--     So every bench booking is either identified by guest_id or anonymous in
--     BOTH columns; nothing takes the scanning branch. phone stays NULL on these
--     profiles for the same reason: a bench profile with a phone would make that
--     branch slower for everyone ELSE'S rows.
-- ---------------------------------------------------------------------------
insert into profiles (id, full_name, phone, preferred_lang, created_at)
select ('bec40000-0000-4000-8000-9' || lpad(to_hex(n), 11, '0'))::uuid,
       'bench-guest-' || n,
       null,
       case when n % 3 = 0 then 'en' else 'ar' end,
       now() - interval '400 days'
  from generate_series(0, 299) n
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Reservations — 400 days x 4 courts x 8 of the 14 hourly slots 09:00-22:00
--    local, i.e. 12,800 bookings.
--
--    WHY 8 OF 14, AND WHY EVERY SLOT IS 60 MINUTES WHEN IT IS STILL LIVE.
--    reservations_no_overlap is an EXCLUDE (court_id =, period &&) constraint
--    that only applies WHERE status in ('pending','confirmed','arrived'). Every
--    generated slot starts on a distinct (court, day, hour), so a 60-minute
--    booking can never collide. The longer durations are given only to rows
--    whose status is outside the exclusion predicate (completed / cancelled /
--    no_show), where a 90- or 120-minute booking may legitimately overlap the
--    next hour's row and the constraint is not consulted. Get that backwards and
--    the seed fails at row ~120 with a conflicting key error.
--
--    The `(hidx * 5 + day + court) % 14 < 8` filter is a bijection over the 14
--    hours (gcd(5,14)=1), so it picks exactly 8 every time while rotating WHICH
--    8 per day and per court — the day-of-week x hour heatmaps the analytics
--    RPCs build are then genuinely uneven, as a real venue's are.
--
--    IDENTITY. guest_id points at one of the 300 bench profiles above, so
--    analytics_courts_guests has real visit buckets, returning/new splits and
--    "regulars" to compute instead of a table of nulls — and takes the free
--    branch of app.analytics_guest_ident while it does it (section 2b).
-- ---------------------------------------------------------------------------
insert into reservations (
  id, court_id, kind, status, start_at, end_at, guest_id, guest_name,
  source, rate_rule_id, price_iqd, created_at, cancelled_at,
  cancelled_by, cancellation_reason)
select
  ('bec40000-0000-4000-8000-1' || lpad(to_hex(s.seq), 11, '0'))::uuid,
  s.court_id,
  'booking'::reservation_kind,
  s.status,
  s.start_at,
  s.start_at + make_interval(mins => s.duration_min),
  -- One in twenty is anonymous in BOTH identity columns (a desk walk-in nobody
  -- typed anything for), which is what fills the analytics' 'unidentified'
  -- bucket without paying for the scanning branch described above.
  case when s.seq % 20 <> 19
       then ('bec40000-0000-4000-8000-9' || lpad(to_hex(s.seq % 300), 11, '0'))::uuid end,
  'bench-guest-' || (s.seq % 300),
  s.source,
  s.rule_id,
  case s.duration_min when 60 then 40000 when 90 then 55000 else 70000 end,
  s.start_at - interval '3 days',
  case when s.status = 'cancelled' then s.start_at - interval '1 day' end,
  case when s.status = 'cancelled' then 'guest'::cancellation_actor end,
  case when s.status = 'cancelled' then 'bench-cancel' end
from (
  select
    row_number() over (order by g.day_off, c.idx, h.hidx) as seq,
    c.id  as court_id,
    c.rule_id,
    ((current_date - g.day_off)::timestamp + make_interval(hours => 9 + h.hidx))
      at time zone 'Asia/Baghdad' as start_at,
    -- 70 % completed / 10 % confirmed / 10 % cancelled / 10 % no_show
    (case (row_number() over (order by g.day_off, c.idx, h.hidx)) % 10
       when 7 then 'confirmed' when 8 then 'cancelled' when 9 then 'no_show'
       else 'completed' end)::reservation_status as status,
    -- 60 % mobile / 40 % desk
    (case when (row_number() over (order by g.day_off, c.idx, h.hidx)) % 5 < 3
          then 'mobile' else 'desk' end)::reservation_source as source,
    -- A still-live status is pinned to 60 minutes; see the note above.
    (case when (row_number() over (order by g.day_off, c.idx, h.hidx)) % 10 = 7
          then 60
          else (array[60, 90, 120])[1 + (row_number() over (order by g.day_off, c.idx, h.hidx)) % 3]
     end) as duration_min
  from generate_series(0, 399) g(day_off)
  cross join (values
    ('bec40000-0000-4000-8000-00000000c001'::uuid, 0, 'bec40000-0000-4000-8000-00000000d001'::uuid),
    ('bec40000-0000-4000-8000-00000000c002'::uuid, 1, 'bec40000-0000-4000-8000-00000000d002'::uuid),
    ('bec40000-0000-4000-8000-00000000c003'::uuid, 2, 'bec40000-0000-4000-8000-00000000d003'::uuid),
    ('bec40000-0000-4000-8000-00000000c004'::uuid, 3, 'bec40000-0000-4000-8000-00000000d004'::uuid)
  ) c(id, idx, rule_id)
  cross join generate_series(0, 13) h(hidx)
  where ((h.hidx * 5 + g.day_off + c.idx) % 14) < 8
) s
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Expired mobile holds — 1,200 of them (3 a day for 400 days).
--
--    app.analytics_courts_summary reads these in its own `holds` CTE, matched on
--    kind = 'hold' AND status = 'expired' AND source = 'mobile' (migration 0097),
--    to build the "demand we lost" half of the day x hour heatmap. Without them
--    that half of every cell is zero and the query measures less work than it
--    does in production.
--
--    'expired' is outside the exclusion predicate, so these may share an hour
--    with a booking — which is exactly what an abandoned hold looks like.
--    reservations_check1 still demands hold_expires_at, and
--    reservations_live_hold_has_guest only binds a PENDING hold, so guest_id
--    may stay NULL here.
-- ---------------------------------------------------------------------------
insert into reservations (
  id, court_id, kind, status, start_at, end_at, source, hold_expires_at, created_at)
select
  ('bec40000-0000-4000-8000-2' || lpad(to_hex(s.seq), 11, '0'))::uuid,
  s.court_id,
  'hold'::reservation_kind,
  'expired'::reservation_status,
  s.start_at,
  s.start_at + interval '60 minutes',
  'mobile'::reservation_source,
  s.start_at - interval '20 minutes',
  s.start_at - interval '30 minutes'
from (
  select
    row_number() over (order by g.day_off, h.hidx) as seq,
    (array['bec40000-0000-4000-8000-00000000c001'::uuid,
           'bec40000-0000-4000-8000-00000000c002'::uuid,
           'bec40000-0000-4000-8000-00000000c003'::uuid,
           'bec40000-0000-4000-8000-00000000c004'::uuid])[1 + (g.day_off + h.hidx) % 4] as court_id,
    ((current_date - g.day_off)::timestamp + make_interval(hours => 11 + h.hidx * 4))
      at time zone 'Asia/Baghdad' as start_at
  from generate_series(0, 399) g(day_off)
  cross join generate_series(0, 2) h(hidx)
) s
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Bench menu — 1 category, 6 items, one default variant each, 3 modifier
--    groups of 2 modifiers all linked to every item.
--
--    NO recipe_lines and NO stock_batches on purpose (see the header): the
--    tickets seeded below would otherwise consume a year of stock the cafe
--    suites rely on. The bench measures the ORDER path, and app.add_order_items
--    snapshots app.current_unit_cost, which simply returns nothing costed here.
-- ---------------------------------------------------------------------------
insert into menu_categories (id, name_en, name_ar, tax_group_id, sort_order, is_active)
values ('bec40000-0000-4000-8000-00000000a001', 'bench-category', 'bench-category',
        'b0000000-0000-4000-8000-000000000001', 900, true)
on conflict (id) do nothing;

insert into menu_items (id, category_id, name_en, name_ar, is_active, sort_order)
select ('bec40000-0000-4000-8000-00000000a1' || lpad(n::text, 2, '0'))::uuid,
       'bec40000-0000-4000-8000-00000000a001',
       'bench-item-' || n, 'bench-item-' || n, true, 900 + n
  from generate_series(1, 6) n
on conflict (id) do nothing;

insert into menu_item_variants (id, item_id, name_en, name_ar, price_iqd, is_default, sort_order)
select ('bec40000-0000-4000-8000-00000000a2' || lpad(n::text, 2, '0'))::uuid,
       ('bec40000-0000-4000-8000-00000000a1' || lpad(n::text, 2, '0'))::uuid,
       'bench-regular', 'bench-regular', 1000 * n, true, 0
  from generate_series(1, 6) n
on conflict (id) do nothing;

-- max_select 2, min_select 0: app.add_order_items validates every chosen
-- modifier against its line's active groups, so a group that allowed only one
-- choice would refuse the 3-modifier cafe row.
insert into modifier_groups (id, name_en, name_ar, min_select, max_select)
select ('bec40000-0000-4000-8000-00000000a3' || lpad(n::text, 2, '0'))::uuid,
       'bench-group-' || n, 'bench-group-' || n, 0, 2
  from generate_series(1, 3) n
on conflict (id) do nothing;

insert into modifiers (id, group_id, name_en, name_ar, price_delta_iqd, sort_order, is_active)
select ('bec40000-0000-4000-8000-00000000a4' || lpad((g * 10 + m)::text, 2, '0'))::uuid,
       ('bec40000-0000-4000-8000-00000000a3' || lpad(g::text, 2, '0'))::uuid,
       'bench-mod-' || g || '-' || m, 'bench-mod-' || g || '-' || m,
       250 * m, m, true
  from generate_series(1, 3) g cross join generate_series(1, 2) m
on conflict (id) do nothing;

insert into menu_item_modifier_groups (item_id, group_id, sort_order)
select ('bec40000-0000-4000-8000-00000000a1' || lpad(i::text, 2, '0'))::uuid,
       ('bec40000-0000-4000-8000-00000000a3' || lpad(g::text, 2, '0'))::uuid,
       g
  from generate_series(1, 6) i cross join generate_series(1, 3) g
on conflict (item_id, group_id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Cafe table for the guest-order row. table_number is UNIQUE, so it carries
--    the bench- prefix like everything else.
-- ---------------------------------------------------------------------------
insert into cafe_tables (id, table_number, zone, capacity, is_active, bell_enabled)
values ('bec40000-0000-4000-8000-00000000b001', 'bench-table-1', 'bench', 4, true, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. A BAND of CLOSED cafe days — 281 day_sessions from current_date-400 to
--    current_date-120, ~10 settled tabs each, one till order per tab, 3 lines
--    per order, one ticket and one payment.
--
--    WHY THE BAND STOPS 120 DAYS SHORT OF TODAY. day_sessions.business_date is
--    UNIQUE and app.analytics_daily_sales counts orders per business date
--    across every day session, so a bench day on a date a suite also uses
--    collides twice over: the suite's own day_sessions insert is refused, and
--    its per-day assertion then reads the bench's ten orders. That is exactly
--    what tests/cafe-stock-analytics.test.ts hit — it plants fixed dates
--    (2026-07-14 and 2026-07-15) and asserts `orders` is 2; with the band
--    running to current_date-36 it read 10.
--
--    The recent past is where the cafe suites put their fixed dates, so the
--    bench stays out of it. The only other literal business dates in the suite
--    are 2001-01-01 (tests/helpers.ts probe) and 2020-01-01
--    (tests/staff-breaks.test.ts), both far outside any band anchored on
--    current_date. 281 days is still nine months of cafe money inside the
--    12-month analytics window, which is what report_revenue and
--    analytics_hourly are measured on.
--
--    The insert also skips any date already taken, so a stack that has been
--    through a test run is seeded rather than refused.
-- ---------------------------------------------------------------------------
insert into day_sessions (
  id, business_date, status, opened_at, opened_by, opening_float_iqd,
  closed_at, closed_by, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, notes)
select
  ('bec40000-0000-4000-8000-3' || lpad(to_hex(n), 11, '0'))::uuid,
  (current_date - 400 + n),
  'closed'::day_status,
  ((current_date - 400 + n)::timestamp + interval '9 hours') at time zone 'Asia/Baghdad',
  'a0000000-0000-4000-8000-000000000002',   -- seeded manager (supabase/seed.sql)
  100000,
  ((current_date - 400 + n)::timestamp + interval '26 hours') at time zone 'Asia/Baghdad',
  'a0000000-0000-4000-8000-000000000002',
  0, 0, 0,
  'bench-day'
from generate_series(0, 280) n
where not exists (
  select 1 from day_sessions ds where ds.business_date = (current_date - 400 + n))
on conflict (id) do nothing;

-- Everything below hangs off the days that were ACTUALLY inserted, found by
-- their bench marker, so a skipped date silently costs ten tabs instead of
-- failing a foreign key. `seq` is the day's offset in the band times ten plus
-- the tab index, which keeps every derived id (tab / order / item / ticket /
-- payment) a pure function of the business date.
insert into tabs (
  id, day_session_id, status, table_id, label, opened_by_staff_id,
  subtotal_iqd, tax_iqd, discount_iqd, total_iqd, opened_at, settled_at, device_id)
select
  ('bec40000-0000-4000-8000-4' || lpad(to_hex(s.seq), 11, '0'))::uuid,
  s.day_id,
  'settled'::tab_status,
  null,                                     -- a till tab, not a QR table tab
  'bench-tab-' || s.seq,
  'a0000000-0000-4000-8000-000000000003',   -- seeded cashier
  s.total, 0, 0, s.total,
  s.opened_at,
  s.opened_at + interval '40 minutes',
  'BENCHSEED'
from (
  select d.id as day_id,
         (d.business_date - (current_date - 400)) * 10 + t.k as seq,
         (d.business_date::timestamp
            + make_interval(hours => 10 + t.k, mins => 7 * t.k)) at time zone 'Asia/Baghdad' as opened_at,
         -- 3 lines: items (k%6)+1, ((k+2)%6)+1, ((k+4)%6)+1 at 1000*n each, qty 1/2/1
         (1000 * ((t.k % 6) + 1)) + (2 * 1000 * (((t.k + 2) % 6) + 1)) + (1000 * (((t.k + 4) % 6) + 1)) as total
    from day_sessions d
    cross join generate_series(0, 9) t(k)
   where d.notes = 'bench-day' and d.id::text like 'bec4%'
) s
on conflict (id) do nothing;

-- The children read `seq` back out of the parent id (the last 11 hex digits)
-- instead of regenerating it from the date, so a day the band skipped can never
-- put an order on a tab that was never created.
insert into orders (id, tab_id, source, guest_session_id, placed_by_staff_id,
                    status, placed_at, device_id, idempotency_key)
select
  ('bec40000-0000-4000-8000-5' || lpad(to_hex(t.seq), 11, '0'))::uuid,
  t.id,
  'till'::order_source,
  null,                                      -- orders_check: guest_web <=> guest_session_id
  'a0000000-0000-4000-8000-000000000003',
  'served'::order_status,
  t.opened_at + interval '2 minutes',
  'BENCHSEED',
  'BENCHSEED:order.create:' || lpad(t.seq::text, 12, '0')
from (
  select tb.id,
         ('x' || substr(tb.id::text, 26, 11))::bit(44)::bigint as seq,
         tb.opened_at
    from tabs tb
   where tb.device_id = 'BENCHSEED' and tb.id::text like 'bec40000-0000-4000-8000-4%'
) t
on conflict (id) do nothing;

-- line_no is supplied rather than left to app.trg_order_item_line_no: the
-- trigger does a max(line_no) lookup per row, which for ~8,400 bulk rows is
-- ~8,400 index probes for numbers this query already knows.
insert into order_items (id, order_id, menu_item_id, variant_id, qty,
                         unit_price_iqd, line_total_iqd, list_price_iqd, line_no)
select
  ('bec40000-0000-4000-8000-6' || lpad(to_hex(x.seq * 4 + x.ln), 11, '0'))::uuid,
  x.order_id,
  ('bec40000-0000-4000-8000-00000000a1' || lpad(x.item_n::text, 2, '0'))::uuid,
  ('bec40000-0000-4000-8000-00000000a2' || lpad(x.item_n::text, 2, '0'))::uuid,
  x.qty,
  1000 * x.item_n,
  1000 * x.item_n * x.qty,
  1000 * x.item_n,
  x.ln
from (
  select o.id as order_id,
         ('x' || substr(o.id::text, 26, 11))::bit(44)::bigint as seq,
         l.ln,
         ((('x' || substr(o.id::text, 26, 11))::bit(44)::bigint % 10 + (l.ln - 1) * 2) % 6) + 1 as item_n,
         case l.ln when 2 then 2 else 1 end as qty
    from orders o
    cross join generate_series(1, 3) l(ln)
   where o.device_id = 'BENCHSEED' and o.id::text like 'bec40000-0000-4000-8000-5%'
) x
on conflict (id) do nothing;

-- One completed ticket per order. app.trg_ticket_consume fires on insert and
-- walks this order's lines, but the bench menu has no recipe lines, so each
-- call finds nothing to consume — the trigger is exercised, the stock is not.
insert into tickets (id, order_id, status, target_seconds, created_at,
                     started_at, ready_at, completed_at, actual_prep_seconds, device_id)
select
  ('bec40000-0000-4000-8000-8' || lpad(to_hex(t.seq), 11, '0'))::uuid,
  t.id,
  'completed'::ticket_status,
  600,
  t.placed_at,
  t.placed_at + interval '30 seconds',
  t.placed_at + interval '6 minutes',
  t.placed_at + interval '8 minutes',
  480,
  'BENCHSEED'
from (
  select o.id,
         ('x' || substr(o.id::text, 26, 11))::bit(44)::bigint as seq,
         o.placed_at
    from orders o
   where o.device_id = 'BENCHSEED' and o.id::text like 'bec40000-0000-4000-8000-5%'
) t
on conflict (id) do nothing;

-- Payments. public.payments is append-only (trigger payments_ao raises on any
-- UPDATE or DELETE), so bench/teardown.sql has to disable that trigger to clean
-- up; nothing here may ever be edited in place.
insert into payments (id, tab_id, day_session_id, method, amount_iqd,
                      tendered_iqd, change_iqd, recorded_by, created_at,
                      device_id, idempotency_key)
select
  ('bec40000-0000-4000-8000-7' || lpad(to_hex(p.seq), 11, '0'))::uuid,
  p.id,
  p.day_session_id,
  (case when p.seq % 3 = 0 then 'card' else 'cash' end)::payment_method,
  p.total_iqd,
  case when p.seq % 3 = 0 then null else p.total_iqd end,
  case when p.seq % 3 = 0 then null else 0 end,
  'a0000000-0000-4000-8000-000000000003',
  p.settled_at,
  'BENCHSEED',
  'BENCHSEED:payment.record:' || lpad(p.seq::text, 12, '0')
from (
  select tb.id, tb.day_session_id, tb.total_iqd, tb.settled_at,
         ('x' || substr(tb.id::text, 26, 11))::bit(44)::bigint as seq
    from tabs tb
   where tb.device_id = 'BENCHSEED' and tb.id::text like 'bec40000-0000-4000-8000-4%'
) p
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 8. The LIVE surface the runner needs: one open bench day, one 40-line tab for
--    compute_tab_totals and one empty tab for the replay drain.
--
--    business_date is `current_date - 1`: unique against section 7 (which stops
--    120 days back) and against the far-future dates tests/helpers.ts openFreshDay
--    picks. Only ONE day may be open at a time — app.open_day raises
--    PREVIOUS_DAY_OPEN otherwise — but every suite that opens its own day calls
--    forceCloseAllDays first, so this day is theirs to close and the bench areas
--    re-open it if a test run has been through since bench:seed.
-- ---------------------------------------------------------------------------
insert into day_sessions (id, business_date, status, opened_at, opened_by, opening_float_iqd, notes)
values ('bec40000-0000-4000-8000-3ffffffffff1', current_date - 1, 'open',
        now() - interval '2 hours', 'a0000000-0000-4000-8000-000000000002', 100000, 'bench-day-open')
on conflict (id) do nothing;

insert into tabs (id, day_session_id, status, label, opened_by_staff_id,
                  subtotal_iqd, tax_iqd, discount_iqd, total_iqd, opened_at, device_id) values
  ('bec40000-0000-4000-8000-4ffffffffff1', 'bec40000-0000-4000-8000-3ffffffffff1',
   'open', 'bench-tab-totals-40', 'a0000000-0000-4000-8000-000000000003',
   null, null, null, null, now() - interval '90 minutes', 'BENCH1'),
  ('bec40000-0000-4000-8000-4ffffffffff2', 'bec40000-0000-4000-8000-3ffffffffff1',
   'open', 'bench-tab-replay', 'a0000000-0000-4000-8000-000000000003',
   null, null, null, null, now() - interval '90 minutes', 'BENCH1')
on conflict (id) do nothing;

-- The 40-line tab: ONE till order carrying 40 lines, which is what
-- app.compute_tab_totals has to fold. No guest_session_id, so
-- app.trg_guest_order_item_cap (venue_settings.guest_items_per_order = 40)
-- short-circuits on the very first line instead of refusing the fortieth.
insert into orders (id, tab_id, source, placed_by_staff_id, status, placed_at,
                    device_id, idempotency_key)
values ('bec40000-0000-4000-8000-5ffffffffff1', 'bec40000-0000-4000-8000-4ffffffffff1',
        'till', 'a0000000-0000-4000-8000-000000000003', 'served',
        now() - interval '85 minutes', 'BENCH1', 'BENCH1:order.create:BENCHTOTALS40')
on conflict (id) do nothing;

insert into order_items (id, order_id, menu_item_id, variant_id, qty,
                         unit_price_iqd, line_total_iqd, list_price_iqd, line_no)
select
  ('bec40000-0000-4000-8000-6fffffff' || lpad(to_hex(n), 4, '0'))::uuid,
  'bec40000-0000-4000-8000-5ffffffffff1',
  ('bec40000-0000-4000-8000-00000000a1' || lpad(((n % 6) + 1)::text, 2, '0'))::uuid,
  ('bec40000-0000-4000-8000-00000000a2' || lpad(((n % 6) + 1)::text, 2, '0'))::uuid,
  1 + (n % 3),
  1000 * ((n % 6) + 1),
  1000 * ((n % 6) + 1) * (1 + (n % 3)),
  1000 * ((n % 6) + 1),
  n + 1
from generate_series(0, 39) n
on conflict (id) do nothing;

-- Two modifiers on each of the first ten lines, so the totals fold is not a
-- bare sum of line_total_iqd.
insert into order_item_modifiers (order_item_id, modifier_id, qty, price_delta_iqd)
select ('bec40000-0000-4000-8000-6fffffff' || lpad(to_hex(n), 4, '0'))::uuid,
       ('bec40000-0000-4000-8000-00000000a4' || lpad((((n % 3) + 1) * 10 + m)::text, 2, '0'))::uuid,
       1,
       250 * m
  from generate_series(0, 9) n cross join generate_series(1, 2) m
on conflict (order_item_id, modifier_id) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Plan the queries against what is actually there. Without this the first
--    analytics call of a fresh bench run is measuring a planner that still
--    believes reservations holds ten rows.
-- ---------------------------------------------------------------------------
analyze courts;
analyze rate_rules;
analyze rate_rule_prices;
analyze reservations;
analyze day_sessions;
analyze tabs;
analyze orders;
analyze order_items;
analyze order_item_modifiers;
analyze tickets;
analyze payments;
analyze menu_items;
analyze menu_item_variants;
analyze modifiers;

commit;
