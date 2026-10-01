set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0288 lesson_reports — coaching, lane Money (docs/design/coaching/money.md
-- §8; build contracts §1.1, §1.5, §1.7, §1.8, C-18, C-28, C-31, CM-13,
-- CM-14, CM-15, R27, R42, R71, R72, R81).
--
--   1. app.lesson_money_figures     internal: every lesson figure of a time
--                                   range and some branches, one helper for
--                                   every screen (the ticket_money_figures
--                                   twin), so no two screens disagree
--   2. app.reports_figures          re-issued from 20260929000265_match_reports.sql:287:
--                                   revenue gains lessonRevenue (C-18); keys
--                                   lessonRevenue and owedToCoaches appended
--      app.panel_headline           re-issued from 0265:397: the two keys last
--   3. app.report_revenue           re-issued from 20260926000219_reports_venue_scope.sql:637:
--                                   lessonIqd (in totalIqd) and owedToCoachesIqd
--                                   (never in totalIqd)
--   4. app.report_courts            re-issued from 0265:469: lesson minutes are
--                                   occupied court time (CM-14); the lessons
--                                   block (owedToCoachesIqd, R72)
--   5. app.analytics_courts_summary re-issued from 0219:2219: the same
--                                   occupancy rule; a lapsed lesson payment is
--                                   not a lapsed court hold
--   6. app.day_close_online         re-issued from 0265:155: the lessons block,
--                                   desk refunds dated by their till shift's day
--                                   (C-31, R27, R71)
--   7. app.report_lessons           manager, owner: the Lessons report (X24), a
--                                   person-money report (C-28, R42)
--
-- Everything here reads and nothing locks, so check:locks has nothing to walk.
-- A sandbox lesson payment adds 0 to every figure and is counted only in the
-- sandbox tallies (CM-15). Lesson money (CM-13): cash basis and net
-- (lessonRevenue: desk payments by payments.created_at less their refunds by
-- refunds.created_at, online by succeeded_at less refunds by refunded_at);
-- owedToCoaches is accrual (the coach share of the statement lessons starting
-- in the range, 0287's app.coach_statement_lessons). Desk lesson money is
-- already in cash and card: it is ordinary payments.
--
-- SEC-29 (R42): report_courts, analytics_courts_summary and panel_headline
-- are read by the assistant and the analytics model; they carry branch
-- aggregates only, and the coach total is named owedToCoachesIqd so no coach
-- pattern matches it. report_lessons (money about named coaches) is a
-- person-money report: scanned for guest identity, exempt from the coach
-- patterns, never an assistant tool.
--
-- Functions of other coaching files this one calls (bound late, by name):
--   0281 (Money) app.lesson_enrolment_money, app.cafe_settled_tabs (re-issued
--                to leave lesson tabs out)
--   0287 (Money) app.coach_statement_lessons

-- ===========================================================================
-- 1. The lesson figures (money.md §8.1)
-- ===========================================================================
create or replace function app.lesson_money_figures(p_ts_from timestamptz, p_ts_to timestamptz, p_venues uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_money_figures_0288$
declare
  v_desk record;
  v_dref record;
  v_on   record;
  v_oref record;
  v_wait record;
  v_sl   record;
  v_ls   record;
  v_late bigint;
  v_due  record;
begin
  -- Desk money: the payments on kind 'lesson' tabs, by created_at, and their
  -- refunds by created_at (the moment each was made, as reports_figures dates
  -- every refund; the day close dates them by their till shift's day, R27).
  select coalesce(sum(p.amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_desk
    from payments p
    join tabs t on t.id = p.tab_id and t.kind = 'lesson'
   where p.venue_id = any (p_venues) and p.created_at >= p_ts_from and p.created_at < p_ts_to;

  select coalesce(sum(r.amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_dref
    from refunds r
    join payments p on p.id = r.payment_id
    join tabs t on t.id = p.tab_id and t.kind = 'lesson'
   where p.venue_id = any (p_venues) and r.venue_id = any (p_venues)
     and r.created_at >= p_ts_from and r.created_at < p_ts_to;

  -- Online money: every lesson row that succeeded in the range (a wrong
  -- amount, a duplicate or a slot lost is refunded in full and nets to 0 over
  -- time, the onlineDeposits rule), less what was refunded in the range.
  select coalesce(sum(bp.amount_iqd) filter (where not bp.sandbox), 0)::bigint as iqd,
         count(*) filter (where not bp.sandbox)::bigint                         as n,
         count(*) filter (where bp.sandbox)::bigint                             as sandbox
    into v_on
    from booking_payments bp
   where bp.purpose = 'lesson' and bp.venue_id = any (p_venues)
     and bp.succeeded_at >= p_ts_from and bp.succeeded_at < p_ts_to;

  select coalesce(sum(bp.refund_amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_oref
    from booking_payments bp
   where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any (p_venues)
     and bp.status = 'refunded'
     and bp.refunded_at >= p_ts_from and bp.refunded_at < p_ts_to;

  select coalesce(sum(bp.refund_amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_wait
    from booking_payments bp
   where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any (p_venues)
     and bp.status in ('refund_pending', 'refund_failed');

  -- The statement lessons starting in the range (0287, money.md §7.1): the
  -- accrual figures, and the places, enrolments and marks on them. A course
  -- enrolment counts on every session it covers.
  with
  sl as (
    select * from app.coach_statement_lessons(p_venues, p_ts_from, p_ts_to, null)),
  cov as (
    select sl.lesson_id, sl.kind, e.id as enrolment_id, e.party_size
      from sl
      join lesson_enrolments e
        on e.status = 'booked'
       and (e.lesson_id = sl.lesson_id
            or (e.course_id = sl.course_id
                and sl.session_no between e.first_session_no
                                      and e.first_session_no + e.sessions_covered - 1)))
  select (select count(*) from sl)::bigint                                                    as lessons,
         (select count(*) from sl where sl.kind = 'private')::bigint                          as private_n,
         (select count(*) from sl where sl.kind = 'group')::bigint                            as group_n,
         (select count(*) from sl where sl.kind = 'course')::bigint                           as course_n,
         (select coalesce(sum(sl.minutes), 0) from sl)::bigint                                as minutes,
         (select coalesce(sum(sl.collected_iqd), 0) from sl)::bigint                          as collected,
         (select coalesce(sum(least(sl.court_share_iqd, sl.collected_iqd)), 0) from sl)::bigint as court,
         (select coalesce(sum(sl.coach_iqd), 0) from sl)::bigint                              as coach,
         (select coalesce(sum(sl.max_places), 0) from sl where sl.kind in ('group', 'course'))::bigint as places,
         (select coalesce(sum(cov.party_size), 0) from cov where cov.kind in ('group', 'course'))::bigint as taken,
         (select count(*) from cov)::bigint                                                   as enrolments,
         (select count(*) from lesson_attendance a join sl on sl.lesson_id = a.lesson_id
           where a.status = 'attended')::bigint                                               as attended,
         (select count(*) from lesson_attendance a join sl on sl.lesson_id = a.lesson_id
           where a.status = 'no_show')::bigint                                                as no_shows
    into v_sl;

  -- Every lesson starting in the range that did not take place.
  select count(*) filter (where l.status = 'cancelled')::bigint                                  as cancelled,
         count(*) filter (where l.status = 'cancelled' and l.cancel_reason = 'under_filled')::bigint as under_filled,
         count(*) filter (where l.status = 'expired')::bigint                                    as expired
    into v_ls
    from lessons l
   where l.venue_id = any (p_venues) and l.start_at >= p_ts_from and l.start_at < p_ts_to;

  -- Late cancels: a private or group place by its lesson's start, a course
  -- leave by when it was made.
  select count(*)::bigint into v_late
    from lesson_enrolments e
    left join lessons l on l.id = e.lesson_id
   where e.venue_id = any (p_venues)
     and e.status = 'cancelled' and e.cancel_kind = 'guest_late'
     and coalesce(l.start_at, e.cancelled_at) >= p_ts_from
     and coalesce(l.start_at, e.cancelled_at) < p_ts_to;

  -- Desk money owed back now (the till pays it, R36); the engine runs only on
  -- enrolments that ever took desk money.
  select coalesce(sum(x.due), 0)::bigint as iqd, count(*) filter (where x.due > 0)::bigint as n
    into v_due
    from (select (app.lesson_enrolment_money(e.id) ->> 'refund_due_desk_iqd')::bigint as due
            from lesson_enrolments e
           where e.venue_id = any (p_venues)
             and exists (select 1 from tabs t where t.lesson_enrolment_id = e.id and t.status = 'settled')) x;

  return jsonb_build_object(
    'deskIqd',                   v_desk.iqd,
    'deskCount',                 v_desk.n,
    'deskRefundsIqd',            v_dref.iqd,
    'deskRefundsCount',          v_dref.n,
    'onlineIqd',                 v_on.iqd,
    'onlineCount',               v_on.n,
    'onlineRefundsIqd',          v_oref.iqd,
    'onlineRefundsCount',        v_oref.n,
    'onlineRefundsWaitingIqd',   v_wait.iqd,
    'onlineRefundsWaitingCount', v_wait.n,
    'netIqd',                    v_desk.iqd - v_dref.iqd + v_on.iqd - v_oref.iqd,
    'lessons',                   v_sl.lessons,
    'private',                   v_sl.private_n,
    'group',                     v_sl.group_n,
    'courseSessions',            v_sl.course_n,
    'lessonMinutes',             v_sl.minutes,
    'collectedIqd',              v_sl.collected,
    'courtShareIqd',             v_sl.court,
    'owedToCoachesIqd',          v_sl.coach,
    'places',                    v_sl.places,
    'placesTaken',               v_sl.taken,
    'enrolments',                v_sl.enrolments,
    'attended',                  v_sl.attended,
    'noShows',                   v_sl.no_shows,
    'cancelled',                 v_ls.cancelled,
    'underFilled',               v_ls.under_filled,
    'expired',                   v_ls.expired,
    'lateCancels',               v_late,
    'refundsDueDeskIqd',         v_due.iqd,
    'refundsDueDeskCount',       v_due.n,
    'sandboxExcluded',           v_on.sandbox);
end $lesson_money_figures_0288$;

comment on function app.lesson_money_figures(timestamptz, timestamptz, uuid[]) is
  '0288 (money.md §8.1; CM-13, CM-15). Internal, the ticket_money_figures twin: every lesson figure of the branches p_venues for [p_ts_from, p_ts_to), non-sandbox. Cash basis: deskIqd, deskCount (payments on kind lesson tabs by created_at), deskRefundsIqd, deskRefundsCount (their refunds by created_at), onlineIqd, onlineCount (lesson rows by succeeded_at), onlineRefundsIqd, onlineRefundsCount (refunded by refunded_at), netIqd = desk - desk refunds + online - online refunds (lessonRevenue). Now: onlineRefundsWaitingIqd/Count (refund_pending, refund_failed), refundsDueDeskIqd/Count (Σ the engine''s refund_due_desk_iqd). Accrual, over the statement lessons starting in the range (app.coach_statement_lessons): lessons, private, group, courseSessions, lessonMinutes, collectedIqd, courtShareIqd (Σ least(court share, collected)), owedToCoachesIqd (Σ the coach share; named so no SEC-29 coach pattern matches), places and placesTaken (group and course sessions), enrolments (booked enrolments on those lessons, a course enrolment on each session it covers), attended, noShows. Lessons starting in the range: cancelled, underFilled, expired; lateCancels (guest_late enrolments: by the lesson''s start, a course leave by when it was made). sandboxExcluded: sandbox lesson rows succeeded in the range. Read by reports_figures, report_revenue (pinned equal per range), report_courts, report_lessons and day_close_online. Aggregates only. Takes no lock.';

revoke all on function app.lesson_money_figures(timestamptz, timestamptz, uuid[]) from public, anon, authenticated;

-- ===========================================================================
-- 2. reports_figures and panel_headline (money.md §8.2)
-- ===========================================================================

-- reports_figures: re-issued from 20260929000265_match_reports.sql:287;
-- revenue = padel + café net + lesson revenue (C-18); + lessonRevenue,
-- owedToCoaches, appended after matchWrittenOff.
create or replace function app.reports_figures(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $reports_figures_0288$
declare
  v_rv uuid[] := app.report_venues();
  v_b   record;
  v_out jsonb;
  v_tk  jsonb;
  v_lm  jsonb;
begin
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  -- 0265: the ticket figures come from the one helper (MD-16); the sales,
  -- refunds and liability are chain-wide, the forfeits this report's branches.
  v_tk := app.ticket_money_figures(v_b.ts_from, v_b.ts_to, v_rv);
  -- 0288: the lesson figures likewise (money.md §8.1).
  v_lm := app.lesson_money_figures(v_b.ts_from, v_b.ts_to, v_rv);

  with
  res as (
    select count(*) filter (where r.status in ('confirmed','arrived','completed'))                    as bookings,
           coalesce(sum(r.price_iqd) filter (where r.status in ('confirmed','arrived','completed')), 0)::bigint as padel_iqd,
           count(*) filter (where r.status = 'no_show')                                               as no_shows
      from reservations r
     where r.venue_id = any(v_rv) and r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to),
  cafe as (
    select coalesce(sum(s.cafe_gross_iqd), 0)::bigint as cafe_iqd,
           coalesce(sum(s.cafe_net_iqd), 0)::bigint   as cafe_net_iqd,
           coalesce(sum(s.discount_iqd), 0)::bigint   as discounts_iqd,
           coalesce(sum(s.refunds_iqd), 0)::bigint    as refunds_iqd
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s),
  ord as (
    select count(*) as orders
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'),
  pay as (
    select coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from payments p
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to),
  ref as (
    select coalesce(sum(r.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from refunds r
      join payments p on p.id = r.payment_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to),
  waste as (
    select coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as cost_iqd
      from stock_movements sm
     where sm.venue_id = any(v_rv) and sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= v_b.ts_from and sm.at < v_b.ts_to),
  -- 0265: online deposits, net of their refunds, each dated by its own
  -- stamp; a forfeited deposit by forfeited_at. Sandbox rows never count.
  dep as (
    select coalesce(sum(bp.amount_iqd) filter (where bp.succeeded_at >= v_b.ts_from
                                                 and bp.succeeded_at < v_b.ts_to), 0)::bigint
           - coalesce(sum(bp.refund_amount_iqd) filter (where bp.refunded_at >= v_b.ts_from
                                                          and bp.refunded_at < v_b.ts_to), 0)::bigint as online_iqd,
           coalesce(sum(bp.amount_iqd) filter (where bp.forfeited_at >= v_b.ts_from
                                                 and bp.forfeited_at < v_b.ts_to), 0)::bigint as forfeits_iqd
      from booking_payments bp
     where bp.purpose = 'deposit' and not bp.sandbox and bp.venue_id = any(v_rv)),
  -- 0265: the shares nobody pays on the live match bookings starting in the
  -- period (no-shows, unrefilled late leaves, vacant numbers, manual write-offs).
  mw as (
    select coalesce(sum(app.court_fee_written_off(r.id, null)), 0)::bigint as written_off_iqd
      from matches mt
      join reservations r on r.id = mt.reservation_id
     where mt.venue_id = any(v_rv) and not mt.sandbox
       and r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
       and mt.start_at >= v_b.ts_from and mt.start_at < v_b.ts_to)
  select jsonb_build_object(
           -- 0288 (C-18): lesson money is part of headline revenue as its own line.
           'revenue',       res.padel_iqd + cafe.cafe_net_iqd + (v_lm ->> 'netIqd')::bigint,
           'padelRevenue',  res.padel_iqd,
           'cafeRevenue',   cafe.cafe_iqd,
           'cafeNet',       cafe.cafe_net_iqd,
           'cash',          pay.cash_iqd - ref.cash_iqd,
           'card',          pay.card_iqd - ref.card_iqd,
           'bookings',      res.bookings,
           'orders',        ord.orders,
           'avgOrderValue', case when ord.orders > 0
                                 then round(cafe.cafe_iqd::numeric / ord.orders)::bigint
                                 else 0 end,
           'discounts',     cafe.discounts_iqd,
           'refunds',       cafe.refunds_iqd,
           'waste',         waste.cost_iqd,
           'noShows',       res.no_shows,
           -- 0265 (money.md §7.3). revenue, padelRevenue, cash and card are
           -- unchanged: ticket money is never branch revenue, cash or card.
           'onlineDeposits',  dep.online_iqd,
           'depositForfeits', dep.forfeits_iqd,
           'ticketSales',     (v_tk ->> 'soldIqd')::bigint,
           'ticketRefunds',   (v_tk ->> 'refundedIqd')::bigint,
           'ticketForfeits',  (v_tk ->> 'forfeitsIqd')::bigint,
           'ticketLiability', (v_tk ->> 'liabilityIqd')::bigint,
           'matchWrittenOff', mw.written_off_iqd,
           -- 0288 (money.md §8.2, CM-13): lesson revenue, cash basis and net
           -- (desk lesson money is already in cash and card); the coach share of
           -- the statement lessons starting in the range, information only.
           'lessonRevenue',   (v_lm ->> 'netIqd')::bigint,
           'owedToCoaches',   (v_lm ->> 'owedToCoachesIqd')::bigint)
    into v_out
    from res, cafe, ord, pay, ref, waste, dep, mw;

  return v_out;
end $reports_figures_0288$;

comment on function app.reports_figures(date, date) is
  '0288, from 0265. Internal (service role; panel_headline reads it). The headline figures of a business-day range over app.report_venues(): revenue (padelRevenue + cafeNet + lessonRevenue, C-18), padelRevenue, cafeRevenue, cafeNet, cash, card (desk lesson money included: ordinary payments), bookings, orders, avgOrderValue, discounts, refunds, waste, noShows; then (money.md §7.3, non-sandbox) onlineDeposits, depositForfeits, ticketSales, ticketRefunds and ticketLiability (chain-wide, app.ticket_money_figures), ticketForfeits, matchWrittenOff; then (money.md §8.2) lessonRevenue (app.lesson_money_figures netIqd: desk lesson payments less their refunds, online lesson payments less theirs, each by its own date) and owedToCoaches (the coach share of the statement lessons starting in the range; never in cash, card or revenue). Ticket money never enters revenue, cash or card.';

revoke all on function app.reports_figures(date, date) from public, anon, authenticated;
grant execute on function app.reports_figures(date, date) to service_role;

-- panel_headline: re-issued from 20260929000265_match_reports.sql:397; the two
-- coaching keys appended to the fixed list (owner only).
create or replace function app.panel_headline(p_from date, p_to date, p_compare text default 'none')
returns jsonb
language plpgsql stable security definer set search_path = public as $panel_headline_0288$
declare
  v_b        record;
  v_cur      jsonb;
  v_prev     jsonb;
  v_cmp_from date;
  v_cmp_to   date;
  v_len      int;
  -- 0265: the seven online-money and open-match keys go last (money.md §7.3),
  -- so every existing position is unchanged. 0288: the two coaching keys
  -- after them (money.md §8.2).
  v_keys     text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','bookings',
                             'orders','avgOrderValue','discounts','refunds','waste','noShows',
                             'onlineDeposits','depositForfeits','ticketSales','ticketRefunds',
                             'ticketForfeits','ticketLiability','matchWrittenOff',
                             'lessonRevenue','owedToCoaches'];
  v_figures  jsonb;
begin
  perform app.reports_guard(true);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_compare is null or p_compare not in ('previousPeriod','sameLastYear','none') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_compare', hint = 'p_compare must be ''previousPeriod'', ''sameLastYear'' or ''none''';
  end if;

  v_cur := app.reports_figures(p_from, p_to);

  if p_compare = 'previousPeriod' then
    v_len      := (p_to - p_from) + 1;
    v_cmp_to   := p_from - 1;
    v_cmp_from := p_from - v_len;
  elsif p_compare = 'sameLastYear' then
    v_cmp_from := (p_from - interval '1 year')::date;
    v_cmp_to   := (p_to   - interval '1 year')::date;
  end if;

  if v_cmp_from is not null then
    v_prev := app.reports_figures(v_cmp_from, v_cmp_to);
  end if;

  select jsonb_agg(jsonb_build_object(
           'key',       k,
           'value',     (v_cur ->> k)::bigint,
           'previous',  (v_prev ->> k)::bigint,
           'changeAbs', case when v_prev is not null
                             then (v_cur ->> k)::bigint - (v_prev ->> k)::bigint end,
           'changePct', case when v_prev is not null and (v_prev ->> k)::bigint > 0
                             then round(((v_cur ->> k)::bigint - (v_prev ->> k)::bigint) * 100.0
                                        / (v_prev ->> k)::bigint, 1) end
         ) order by ord)
    into v_figures
    from unnest(v_keys) with ordinality as u(k, ord);

  return jsonb_build_object(
    'period',     jsonb_build_object('from', p_from, 'to', p_to),
    'comparison', case when v_cmp_from is not null
                       then jsonb_build_object('from', v_cmp_from, 'to', v_cmp_to) end,
    'figures',    coalesce(v_figures, '[]'::jsonb));
end $panel_headline_0288$;

comment on function app.panel_headline(date, date, text) is
  '0288, from 0265. Owner only (reports_guard(true)): the management panel headline for a business-day range, {period, comparison, figures [{key, value, previous, changeAbs, changePct}]} in a fixed key order: revenue, padelRevenue, cafeRevenue, cafeNet, cash, card, bookings, orders, avgOrderValue, discounts, refunds, waste, noShows, then onlineDeposits, depositForfeits, ticketSales, ticketRefunds, ticketForfeits, ticketLiability, matchWrittenOff (money.md §7.3; ticketSales, ticketRefunds and ticketLiability are chain-wide), then lessonRevenue and owedToCoaches (coaching, money.md §8.2: lesson money in revenue as its own line, C-18; the coaches'' share, information only). p_compare: none, previousPeriod or sameLastYear. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.panel_headline(date, date, text) from public, anon;
grant execute on function app.panel_headline(date, date, text) to authenticated;

-- ===========================================================================
-- 3. report_revenue (money.md §8.3)
-- ===========================================================================

-- report_revenue: re-issued from 20260926000219_reports_venue_scope.sql:637;
-- + lessonIqd (part of totalIqd, C-18) and owedToCoachesIqd (accrual, never
-- in totalIqd), each bucketed by the business date of its own movement (X26).
-- With a paymentMethod or staffId filter, lessonIqd counts only the desk
-- lesson money that matches (online money has neither) and owedToCoachesIqd
-- is 0.
create or replace function app.report_revenue(
  p_from    date,
  p_to      date,
  p_group   text default 'day',
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_revenue_0288$
declare
  v_rv uuid[] := app.report_venues();
  v_b      record;
  v_method payment_method;
  v_staff  uuid;
  v_rows   jsonb;
  v_totals jsonb;
begin
  perform app.reports_guard(true);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_group is null or p_group not in ('day','week','month') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_group', hint = 'p_group must be ''day'', ''week'' or ''month''';
  end if;
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'paymentMethod' and jsonb_typeof(p_filters -> 'paymentMethod') <> 'null' then
    if (p_filters ->> 'paymentMethod') not in ('cash','card') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'paymentMethod', hint = 'paymentMethod must be ''cash'' or ''card''';
    end if;
    v_method := (p_filters ->> 'paymentMethod')::payment_method;
  end if;
  if p_filters ? 'staffId' and jsonb_typeof(p_filters -> 'staffId') <> 'null' then
    begin
      v_staff := (p_filters ->> 'staffId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'staffId';
    end;
  end if;

  with
  res as (
    select app.reports_bucket(app.business_date(r.start_at, v_b.tz, v_b.start_hour), p_group) as b,
           count(*)                            as bookings,
           coalesce(sum(r.price_iqd), 0)::bigint as padel_iqd
      from reservations r
     where r.venue_id = any(v_rv) and r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (v_staff is null or r.created_by_staff_id = v_staff)
     group by 1),
  cafe as (
    select app.reports_bucket(app.business_date(s.settled_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(s.cafe_gross_iqd), 0)::bigint as cafe_iqd,
           coalesce(sum(s.cafe_net_iqd), 0)::bigint   as cafe_net_iqd,
           coalesce(sum(s.tax_iqd), 0)::bigint        as tax_iqd,
           coalesce(sum(s.discount_iqd), 0)::bigint   as discounts_iqd
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
     where (v_method is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.method = v_method))
       and (v_staff  is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.recorded_by = v_staff))
     group by 1),
  -- 0146: the Touch Shop share of the settled tabs, net of line and tab
  -- discounts and of refunds, before tax (cafe_net_lines, 0095). A breakdown
  -- of the café money, not an addition to it: total_iqd is unchanged.
  st as (
    select s.tab_id, s.settled_at
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
     where (v_method is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.method = v_method))
       and (v_staff  is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.recorded_by = v_staff))),
  shop as (
    select app.reports_bucket(app.business_date(st.settled_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(nl.net_iqd), 0)::bigint as shop_iqd
      from app.cafe_net_lines(array(select st2.tab_id from st st2)) nl
      join st on st.tab_id = nl.tab_id
      join menu_items mi on mi.id = nl.menu_item_id
      join menu_categories c on c.id = mi.category_id and c.kind = 'shop'
     group by 1),
  ord as (
    select app.reports_bucket(app.business_date(o.placed_at, v_b.tz, v_b.start_hour), p_group) as b,
           count(*) as orders
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
       and (v_staff is null or o.placed_by_staff_id = v_staff)
     group by 1),
  pay as (
    select app.reports_bucket(app.business_date(p.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from payments p
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or p.recorded_by = v_staff)
     group by 1),
  ref as (
    select app.reports_bucket(app.business_date(r.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(r.amount_iqd), 0)::bigint                                   as refunds_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from refunds r
      join payments p on p.id = r.payment_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or r.refunded_by = v_staff)
     group by 1),
  -- Staff-attributed discounts: the adjustment rows that member applied, by
  -- the day they applied them. A stamped tab discount has no single author,
  -- so this variant is the UNCAPPED sum of the rows (0068 behaviour).
  adj as (
    select app.reports_bucket(app.business_date(a.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(a.amount_iqd), 0)::bigint as discounts_iqd
      from tab_adjustments a
     where v_staff is not null
       and a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
       and a.applied_by = v_staff
     group by 1),
  vd as (
    select app.reports_bucket(app.business_date(l.at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum((l.after ->> 'line_total_iqd')::bigint), 0)::bigint as voids_iqd
      from audit_log l
     where l.venue_id = any(v_rv) and l.action = 'order_item.void'
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
       and (v_staff is null or l.actor_id = v_staff)
     group by 1),
  -- 0288 (money.md §8.3, CM-13): lesson money, cash basis, each movement by
  -- its own business date, by the definitions of app.lesson_money_figures
  -- (a test pins the two equal over the range): desk payments and their
  -- refunds by created_at (the filters apply), online payments by
  -- succeeded_at and their refunds by refunded_at (no filter can match them).
  les_pay as (
    select app.reports_bucket(app.business_date(p.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(p.amount_iqd), 0)::bigint as iqd
      from payments p
      join tabs t on t.id = p.tab_id and t.kind = 'lesson'
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or p.recorded_by = v_staff)
     group by 1),
  les_ref as (
    select app.reports_bucket(app.business_date(r.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(r.amount_iqd), 0)::bigint as iqd
      from refunds r
      join payments p on p.id = r.payment_id
      join tabs t on t.id = p.tab_id and t.kind = 'lesson'
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or r.refunded_by = v_staff)
     group by 1),
  les_on as (
    select app.reports_bucket(app.business_date(bp.succeeded_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(bp.amount_iqd), 0)::bigint as iqd
      from booking_payments bp
     where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any(v_rv)
       and bp.succeeded_at >= v_b.ts_from and bp.succeeded_at < v_b.ts_to
       and v_method is null and v_staff is null
     group by 1),
  les_onref as (
    select app.reports_bucket(app.business_date(bp.refunded_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(bp.refund_amount_iqd), 0)::bigint as iqd
      from booking_payments bp
     where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any(v_rv)
       and bp.status = 'refunded'
       and bp.refunded_at >= v_b.ts_from and bp.refunded_at < v_b.ts_to
       and v_method is null and v_staff is null
     group by 1),
  -- Accrual (X26): the coach share of the statement lessons starting in the
  -- bucket, as owedToCoaches; never part of total_iqd.
  les_owed as (
    select app.reports_bucket(app.business_date(sl.start_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(sl.coach_iqd), 0)::bigint as iqd
      from app.coach_statement_lessons(v_rv, v_b.ts_from, v_b.ts_to, null) sl
     where v_method is null and v_staff is null
     group by 1),
  buckets as (
    select b from res union select b from cafe union select b from shop union select b from ord union select b from pay
    union select b from ref union select b from adj union select b from vd
    union select b from les_pay union select b from les_ref union select b from les_on union select b from les_onref
    union select b from les_owed),
  rows_ as (
    select buckets.b                                                          as period,
           coalesce(res.padel_iqd, 0)                                         as padel_iqd,
           coalesce(cafe.cafe_iqd, 0)                                         as cafe_iqd,
           coalesce(cafe.cafe_net_iqd, 0)                                     as cafe_net_iqd,
           coalesce(shop.shop_iqd, 0)                                         as shop_iqd,
           coalesce(les_pay.iqd, 0) - coalesce(les_ref.iqd, 0)
             + coalesce(les_on.iqd, 0) - coalesce(les_onref.iqd, 0)           as lesson_iqd,
           coalesce(les_owed.iqd, 0)                                          as owed_to_coaches_iqd,
           coalesce(res.padel_iqd, 0) + coalesce(cafe.cafe_net_iqd, 0)
             + coalesce(les_pay.iqd, 0) - coalesce(les_ref.iqd, 0)
             + coalesce(les_on.iqd, 0) - coalesce(les_onref.iqd, 0)           as total_iqd,
           coalesce(pay.cash_iqd, 0) - coalesce(ref.cash_iqd, 0)              as cash_iqd,
           coalesce(pay.card_iqd, 0) - coalesce(ref.card_iqd, 0)              as card_iqd,
           case when v_staff is null then coalesce(cafe.discounts_iqd, 0)
                else coalesce(adj.discounts_iqd, 0) end                       as discounts_iqd,
           coalesce(vd.voids_iqd, 0)                                          as voids_iqd,
           coalesce(ref.refunds_iqd, 0)                                       as refunds_iqd,
           coalesce(cafe.tax_iqd, 0)                                          as tax_iqd,
           coalesce(ord.orders, 0)                                            as orders,
           coalesce(res.bookings, 0)                                          as bookings
      from buckets
      left join res       on res.b       = buckets.b
      left join cafe      on cafe.b      = buckets.b
      left join shop      on shop.b      = buckets.b
      left join ord       on ord.b       = buckets.b
      left join pay       on pay.b       = buckets.b
      left join ref       on ref.b       = buckets.b
      left join adj       on adj.b       = buckets.b
      left join vd        on vd.b        = buckets.b
      left join les_pay   on les_pay.b   = buckets.b
      left join les_ref   on les_ref.b   = buckets.b
      left join les_on    on les_on.b    = buckets.b
      left join les_onref on les_onref.b = buckets.b
      left join les_owed  on les_owed.b  = buckets.b)
  select coalesce(jsonb_agg(jsonb_build_object(
           'period',           r.period,
           'padelIqd',         r.padel_iqd,
           'cafeIqd',          r.cafe_iqd,
           'cafeNetIqd',       r.cafe_net_iqd,
           'shopIqd',          r.shop_iqd,
           'lessonIqd',        r.lesson_iqd,
           'owedToCoachesIqd', r.owed_to_coaches_iqd,
           'totalIqd',         r.total_iqd,
           'cashIqd',          r.cash_iqd,
           'cardIqd',          r.card_iqd,
           'discountsIqd',     r.discounts_iqd,
           'voidsIqd',         r.voids_iqd,
           'refundsIqd',       r.refunds_iqd,
           'taxIqd',           r.tax_iqd,
           'orders',           r.orders,
           'bookings',         r.bookings
         ) order by r.period), '[]'::jsonb),
         jsonb_build_object(
           'padelIqd',         coalesce(sum(r.padel_iqd), 0)::bigint,
           'cafeIqd',          coalesce(sum(r.cafe_iqd), 0)::bigint,
           'cafeNetIqd',       coalesce(sum(r.cafe_net_iqd), 0)::bigint,
           'shopIqd',          coalesce(sum(r.shop_iqd), 0)::bigint,
           'lessonIqd',        coalesce(sum(r.lesson_iqd), 0)::bigint,
           'owedToCoachesIqd', coalesce(sum(r.owed_to_coaches_iqd), 0)::bigint,
           'totalIqd',         coalesce(sum(r.total_iqd), 0)::bigint,
           'cashIqd',          coalesce(sum(r.cash_iqd), 0)::bigint,
           'cardIqd',          coalesce(sum(r.card_iqd), 0)::bigint,
           'discountsIqd',     coalesce(sum(r.discounts_iqd), 0)::bigint,
           'voidsIqd',         coalesce(sum(r.voids_iqd), 0)::bigint,
           'refundsIqd',       coalesce(sum(r.refunds_iqd), 0)::bigint,
           'taxIqd',           coalesce(sum(r.tax_iqd), 0)::bigint,
           'orders',           coalesce(sum(r.orders), 0)::bigint,
           'bookings',         coalesce(sum(r.bookings), 0)::bigint)
    into v_rows, v_totals
    from rows_ r;

  return jsonb_build_object(
    'group',   p_group,
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','period',           'labelEn','Period',          'labelAr','الفترة',           'kind','date'),
      jsonb_build_object('key','padelIqd',         'labelEn','Padel',           'labelAr','البادل',           'kind','money'),
      jsonb_build_object('key','cafeIqd',          'labelEn','Cafe',            'labelAr','الكافيه',          'kind','money'),
      jsonb_build_object('key','cafeNetIqd',       'labelEn','Cafe net',        'labelAr','صافي الكافيه',     'kind','money'),
      jsonb_build_object('key','shopIqd',          'labelEn','Of which shop',   'labelAr','منها المتجر',      'kind','money'),
      -- 0288: the one coaching glossary (C-30, R55, R81).
      jsonb_build_object('key','lessonIqd',        'labelEn','Lessons',         'labelAr','الحصص',            'kind','money'),
      jsonb_build_object('key','owedToCoachesIqd', 'labelEn','Owed to coaches', 'labelAr','مستحق للمدرّبين',  'kind','money'),
      jsonb_build_object('key','totalIqd',         'labelEn','Total',           'labelAr','الإجمالي',         'kind','money'),
      jsonb_build_object('key','cashIqd',          'labelEn','Cash',            'labelAr','نقد',              'kind','money'),
      jsonb_build_object('key','cardIqd',          'labelEn','Card',            'labelAr','بطاقة',            'kind','money'),
      jsonb_build_object('key','discountsIqd',     'labelEn','Discounts',       'labelAr','الخصومات',         'kind','money'),
      jsonb_build_object('key','voidsIqd',         'labelEn','Voids',           'labelAr','الإلغاءات',        'kind','money'),
      jsonb_build_object('key','refundsIqd',       'labelEn','Refunds',         'labelAr','المبالغ المستردة', 'kind','money'),
      jsonb_build_object('key','taxIqd',           'labelEn','Tax',             'labelAr','الضريبة',          'kind','money'),
      jsonb_build_object('key','orders',           'labelEn','Orders',          'labelAr','الطلبات',          'kind','count'),
      jsonb_build_object('key','bookings',         'labelEn','Bookings',        'labelAr','الحجوزات',         'kind','count')),
    'rows',       v_rows,
    'totals',     v_totals,
    'comparison', null);
end $report_revenue_0288$;

comment on function app.report_revenue(date, date, text, jsonb) is
  '0288, from 0219 (0146, 0068). Owner only (reports_guard(true)): revenue by day, week or month over app.report_venues(), with paymentMethod and staffId filters. Per bucket and in totals: padelIqd, cafeIqd, cafeNetIqd, shopIqd, lessonIqd (coaching, money.md §8.3: desk lesson payments less their refunds by created_at, online lesson payments by succeeded_at less refunds by refunded_at; with a filter, only the matching desk money), owedToCoachesIqd (the coach share of the statement lessons starting in the bucket; 0 with a filter; never in totalIqd), totalIqd (padel + cafe net + lessons, C-18), cashIqd, cardIqd, discountsIqd, voidsIqd, refundsIqd, taxIqd, orders, bookings; columns with EN and AR labels. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.report_revenue(date, date, text, jsonb) from public, anon;
grant execute on function app.report_revenue(date, date, text, jsonb) to authenticated;

-- ===========================================================================
-- 4. report_courts (money.md §8.4)
-- ===========================================================================

-- report_courts: re-issued from 20260929000265_match_reports.sql:469; + lesson
-- court time as occupied time (CM-14: per-court lessons and lessonMinutes,
-- occupancyPct over booked + lesson minutes; revenue, rates and peak counts
-- stay bookings only) and the lessons block (X25, R72).
create or replace function app.report_courts(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_courts_0288$
declare
  v_av uuid := app.analysis_venue();
  v_b       record;
  v_court   uuid;
  v_rows    jsonb;
  v_totals  jsonb;
  v_by_hour jsonb;
  v_trend   jsonb;
  v_matches jsonb;
  v_lm      jsonb;
  v_lessons jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'courtId' and jsonb_typeof(p_filters -> 'courtId') <> 'null' then
    begin
      v_court := (p_filters ->> 'courtId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'courtId';
    end;
  end if;

  with
  b as (
    select r.id, r.court_id, r.status, r.start_at, r.end_at,
           coalesce(r.price_iqd, 0)::bigint                                   as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int            as mins,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)              as d,
           extract(hour from (r.start_at at time zone v_b.tz))::int           as hour,
           r.status in ('confirmed','arrived','completed')                    as live,
           rp.price_iqd                                                       as rule_price,
           (select max(p2.price_iqd)
              from rate_rules rr
              join rate_rule_prices p2 on p2.rule_id = rr.id
             where rr.venue_id = v_av and rr.is_active
               and (rr.court_id is null or rr.court_id = r.court_id)
               and p2.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int) as max_price
      from reservations r
      left join rate_rule_prices rp
             on rp.rule_id = r.rate_rule_id
            and rp.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int
     where r.venue_id = v_av and r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (v_court is null or r.court_id = v_court)),
  -- 0288 (CM-14): a lesson's court row is occupied court time; it carries no
  -- price (reservations_lesson_row), so no revenue figure can count it.
  ls as (
    select r.court_id,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int as mins
      from reservations r
     where r.venue_id = v_av and r.kind = 'lesson'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (v_court is null or r.court_id = v_court)),
  lc as (
    select ls.court_id, count(*)::bigint as lessons, coalesce(sum(ls.mins), 0)::bigint as lesson_minutes
      from ls
     group by ls.court_id),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where c.venue_id = v_av and (v_court is null or c.id = v_court)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id)
            or exists (select 1 from ls where ls.court_id = c.id))),
  oc as (
    select o.court_id, sum(o.open_minutes)::bigint as open_minutes, sum(o.event_minutes)::bigint as event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, v_court) o
      join courts_in ci on ci.id = o.court_id
     group by o.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(oc.open_minutes, 0)::bigint                                as avail,
           coalesce(oc.event_minutes, 0)::bigint                               as event_minutes,
           coalesce(lc.lessons, 0)::bigint                                     as lessons,
           coalesce(lc.lesson_minutes, 0)::bigint                              as lesson_minutes,
           count(b.id) filter (where b.live)                                   as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint              as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint         as revenue_iqd,
           count(b.id) filter (where b.status = 'cancelled')                   as cancellations,
           count(b.id) filter (where b.status = 'no_show')                     as no_shows,
           count(b.id) filter (where b.live and b.rule_price is not null
                                 and b.max_price is not null and b.rule_price >= b.max_price) as peak,
           count(b.id) filter (where b.live and not (b.rule_price is not null
                                 and b.max_price is not null and b.rule_price >= b.max_price)) as off_peak
      from courts_in c
      left join oc on oc.court_id = c.id
      left join lc on lc.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, oc.open_minutes, oc.event_minutes,
              lc.lessons, lc.lesson_minutes)
  select coalesce(jsonb_agg(jsonb_build_object(
           'courtId',                    pc.id,
           'courtNameEn',                pc.name_en,
           'courtNameAr',                pc.name_ar,
           'isActive',                   pc.is_active,
           'bookings',                   pc.bookings,
           'bookedMinutes',              pc.booked_minutes,
           'lessons',                    pc.lessons,
           'lessonMinutes',              pc.lesson_minutes,
           'availableMinutes',           pc.avail,
           'eventMinutes',               pc.event_minutes,
           'occupancyPct',               case when pc.avail > 0 then round((pc.booked_minutes + pc.lesson_minutes) * 100.0 / pc.avail, 1) end,
           'revenueIqd',                 pc.revenue_iqd,
           'revenuePerAvailableHourIqd', case when pc.avail > 0 then round(pc.revenue_iqd * 60.0 / pc.avail)::bigint end,
           'cancellations',              pc.cancellations,
           'noShows',                    pc.no_shows,
           'cancellationRatePct',        case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                              then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
           'noShowRatePct',              case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                              then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
           'peakBookings',               pc.peak,
           'offPeakBookings',            pc.off_peak
         ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb),
         jsonb_build_object(
           'bookings',         coalesce(sum(pc.bookings), 0)::bigint,
           'bookedMinutes',    coalesce(sum(pc.booked_minutes), 0)::bigint,
           'lessons',          coalesce(sum(pc.lessons), 0)::bigint,
           'lessonMinutes',    coalesce(sum(pc.lesson_minutes), 0)::bigint,
           'availableMinutes', coalesce(sum(pc.avail), 0)::bigint,
           'eventMinutes',     coalesce(sum(pc.event_minutes), 0)::bigint,
           'occupancyPct',     case when coalesce(sum(pc.avail), 0) > 0
                                    then round((coalesce(sum(pc.booked_minutes), 0) + coalesce(sum(pc.lesson_minutes), 0))
                                               * 100.0 / sum(pc.avail), 1) end,
           'revenueIqd',       coalesce(sum(pc.revenue_iqd), 0)::bigint,
           'cancellations',    coalesce(sum(pc.cancellations), 0)::bigint,
           'noShows',          coalesce(sum(pc.no_shows), 0)::bigint,
           'peakBookings',     coalesce(sum(pc.peak), 0)::bigint,
           'offPeakBookings',  coalesce(sum(pc.off_peak), 0)::bigint)
    into v_rows, v_totals
    from per_court pc;

  -- byHour: every venue-local hour 0..23 (a chart wants the full axis).
  select jsonb_agg(jsonb_build_object('hour', h.hour, 'bookings', coalesce(x.n, 0)) order by h.hour)
    into v_by_hour
    from generate_series(0, 23) as h(hour)
    left join (
      select extract(hour from (r.start_at at time zone v_b.tz))::int as hour, count(*) as n
        from reservations r
       where r.venue_id = v_av and r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (v_court is null or r.court_id = v_court)
       group by 1) x on x.hour = h.hour;

  -- trend: one entry per business day that had a live booking.
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', x.d, 'bookings', x.n, 'revenueIqd', x.rev) order by x.d), '[]'::jsonb)
    into v_trend
    from (
      select app.business_date(r.start_at, v_b.tz, v_b.start_hour) as d,
             count(*)                                             as n,
             coalesce(sum(r.price_iqd), 0)::bigint                as rev
        from reservations r
       where r.venue_id = v_av and r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (v_court is null or r.court_id = v_court)
       group by 1) x;

  -- 0265 (money.md §7.4): the branch's open matches starting in the period,
  -- sandbox left out. The block is the whole branch whatever courtId says
  -- (the Matches view hides the court filter, operator.md §5.19); match
  -- bookings stay in the per-court rows above as ordinary bookings. Counts and
  -- money only: no name, label or customer id (G6a).
  select jsonb_build_object(
           'bookings',          count(*) filter (where x.live),
           'bookedIqd',         coalesce(sum(x.price_iqd) filter (where x.live), 0)::bigint,
           'deskPaidIqd',       coalesce(sum(app.court_fee_paid(x.reservation_id, null)) filter (where x.live), 0)::bigint,
           'writtenOffIqd',     coalesce(sum(app.court_fee_written_off(x.reservation_id, null)) filter (where x.live), 0)::bigint,
           'noShowSeats',       coalesce(sum(x.no_show_seats), 0)::bigint,
           'calledOffShort',    count(*) filter (where x.ended_reason = 'called_off_short'),
           'ticketForfeitsIqd', (app.ticket_money_figures(v_b.ts_from, v_b.ts_to, array[v_av]) ->> 'forfeitsIqd')::bigint)
    into v_matches
    from (
      select mt.reservation_id, mt.ended_reason,
             coalesce(r.kind = 'booking' and r.status in ('confirmed','arrived','completed'), false) as live,
             coalesce(r.price_iqd, 0)::bigint                                                     as price_iqd,
             (select count(*) from match_seats s
               where s.match_id = mt.id and s.status = 'no_show')                                 as no_show_seats
        from matches mt
        left join reservations r on r.id = mt.reservation_id
       where mt.venue_id = v_av and not mt.sandbox
         and mt.start_at >= v_b.ts_from and mt.start_at < v_b.ts_to) x;

  -- 0288 (money.md §8.4, X25, R72): the analysed branch's lessons starting in
  -- the period, whatever courtId says, through the one helper
  -- (app.lesson_money_figures: the statement lessons). Counts and branch
  -- aggregates only: no coach, student or court name (C-28 lets aggregates
  -- through). The coach total is owedToCoachesIqd, never coachShareIqd: this
  -- report is an assistant tool, outside PERSON_MONEY_REPORTS (R42).
  v_lm := app.lesson_money_figures(v_b.ts_from, v_b.ts_to, array[v_av]);
  v_lessons := jsonb_build_object(
    'lessons',          (v_lm ->> 'lessons')::bigint,
    'private',          (v_lm ->> 'private')::bigint,
    'group',            (v_lm ->> 'group')::bigint,
    'courseSessions',   (v_lm ->> 'courseSessions')::bigint,
    'lessonMinutes',    (v_lm ->> 'lessonMinutes')::bigint,
    'enrolments',       (v_lm ->> 'enrolments')::bigint,
    'attended',         (v_lm ->> 'attended')::bigint,
    'noShows',          (v_lm ->> 'noShows')::bigint,
    'cancelled',        (v_lm ->> 'cancelled')::bigint,
    'underFilled',      (v_lm ->> 'underFilled')::bigint,
    'collectedIqd',     (v_lm ->> 'collectedIqd')::bigint,
    'courtShareIqd',    (v_lm ->> 'courtShareIqd')::bigint,
    'owedToCoachesIqd', (v_lm ->> 'owedToCoachesIqd')::bigint);

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','courtNameEn',                'labelEn','Court',               'labelAr','الملعب',                 'kind','text'),
      jsonb_build_object('key','bookings',                   'labelEn','Bookings',            'labelAr','الحجوزات',               'kind','count'),
      jsonb_build_object('key','bookedMinutes',              'labelEn','Booked minutes',      'labelAr','الدقائق المحجوزة',       'kind','count'),
      jsonb_build_object('key','lessonMinutes',              'labelEn','Lesson minutes',      'labelAr','دقائق الحصص',            'kind','count'),
      jsonb_build_object('key','availableMinutes',           'labelEn','Available minutes',   'labelAr','الدقائق المتاحة',        'kind','count'),
      jsonb_build_object('key','eventMinutes',               'labelEn','Event minutes',       'labelAr','دقائق الفعاليات',        'kind','count'),
      jsonb_build_object('key','occupancyPct',               'labelEn','Occupancy',           'labelAr','الإشغال',                'kind','pct'),
      jsonb_build_object('key','revenueIqd',                 'labelEn','Revenue',             'labelAr','الإيراد',                'kind','money'),
      jsonb_build_object('key','revenuePerAvailableHourIqd', 'labelEn','Revenue / open hour', 'labelAr','الإيراد لكل ساعة متاحة', 'kind','money'),
      jsonb_build_object('key','cancellations',              'labelEn','Cancellations',       'labelAr','الإلغاءات',              'kind','count'),
      jsonb_build_object('key','noShows',                    'labelEn','No-shows',            'labelAr','عدم الحضور',             'kind','count'),
      jsonb_build_object('key','cancellationRatePct',        'labelEn','Cancellation rate',   'labelAr','نسبة الإلغاء',           'kind','pct'),
      jsonb_build_object('key','noShowRatePct',              'labelEn','No-show rate',        'labelAr','نسبة عدم الحضور',        'kind','pct'),
      jsonb_build_object('key','peakBookings',               'labelEn','Peak',                'labelAr','وقت الذروة',             'kind','count'),
      jsonb_build_object('key','offPeakBookings',            'labelEn','Off-peak',            'labelAr','خارج الذروة',            'kind','count')),
    'rows',       v_rows,
    'totals',     v_totals,
    'byHour',     coalesce(v_by_hour, '[]'::jsonb),
    'trend',      v_trend,
    'comparison', null,
    'matches',    v_matches,
    'lessons',    v_lessons);
end $report_courts_0288$;

comment on function app.report_courts(date, date, jsonb) is
  '0288, from 0265 (0219, event_court_blocks §2.11, 0097). MGMT: the courts report for a business-day range (p_filters.courtId narrows to one court): per-court rows and totals with availableMinutes (event hours included), eventMinutes, lessons and lessonMinutes (a lesson''s live court rows, CM-14), occupancyPct over booked plus lesson minutes, revenue, rates and peak counts bookings only; byHour and the daily trend; match bookings count there as ordinary bookings. Plus matches {bookings, bookedIqd, deskPaidIqd, writtenOffIqd, noShowSeats, calledOffShort, ticketForfeitsIqd} (money.md §7.4) and lessons {lessons, private, group, courseSessions, lessonMinutes, enrolments, attended, noShows, cancelled, underFilled, collectedIqd, courtShareIqd, owedToCoachesIqd} (money.md §8.4, X25, R72: the analysed branch''s statement lessons starting in the range, app.lesson_money_figures), each the whole branch whatever courtId says, sandbox left out; counts and money only.';

revoke all on function app.report_courts(date, date, jsonb) from public, anon;
grant execute on function app.report_courts(date, date, jsonb) to authenticated;

-- ===========================================================================
-- 5. analytics_courts_summary (money.md §8.5)
-- ===========================================================================

-- analytics_courts_summary: re-issued from
-- 20260926000219_reports_venue_scope.sql:2219; + lesson minutes as occupied
-- time (CM-14: per_court, tot, kpis, by_day and heatmap gain them, and every
-- occupancy reads booked + lesson minutes; bookings, revenue and the rates
-- stay bookings only), and a lapsed lesson payment is not a lapsed court hold
-- (holds: lesson_id is null). analytics_open_minutes (0214:121) is not
-- re-issued: it subtracts maintenance only, so a lesson's court time is
-- already open time.
create or replace function app.analytics_courts_summary(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_summary_0288$
declare
  v_b   record;
  v_out jsonb;
  v_av  uuid := app.analysis_venue();
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           r.start_at at time zone v_b.tz                                            as s_local,
           r.end_at at time zone v_b.tz                                              as e_local,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)                     as d,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status in ('confirmed','arrived','completed')                           as live,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show
      from reservations r
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  -- 0288 (CM-14): a lesson's live court rows, occupied time.
  ls as (
    select r.id, r.court_id,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           r.start_at at time zone v_b.tz                                            as s_local,
           r.end_at at time zone v_b.tz                                              as e_local,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)                     as d
      from reservations r
     where r.venue_id = v_av and r.kind = 'lesson'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  holds as (
    select extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
     where r.venue_id = v_av and r.kind = 'hold' and r.status = 'expired' and r.source = 'mobile'
       -- 0288: a lapsed online lesson payment is not a lapsed court hold.
       and r.lesson_id is null
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where c.venue_id = v_av and (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id)
            or exists (select 1 from ls where ls.court_id = c.id))),
  oc as (
    select o.court_id, o.dow, o.hour, o.open_minutes, o.open_days, o.event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id),
  court_open as (
    select oc.court_id, sum(oc.open_minutes)::bigint as open_minutes, sum(oc.event_minutes)::bigint as event_minutes
      from oc group by oc.court_id),
  lc as (
    select ls.court_id, count(*)::bigint as lessons, coalesce(sum(ls.mins), 0)::bigint as lesson_minutes
      from ls group by ls.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(co.open_minutes, 0)::bigint                           as open_minutes,
           coalesce(co.event_minutes, 0)::bigint                          as event_minutes,
           coalesce(lc.lessons, 0)::bigint                                as lessons,
           coalesce(lc.lesson_minutes, 0)::bigint                         as lesson_minutes,
           count(b.id) filter (where b.live)                              as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint         as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint    as revenue_iqd,
           count(b.id) filter (where b.cancelled)                         as cancellations,
           count(b.id) filter (where b.no_show)                           as no_shows,
           count(b.id) filter (where b.live and b.source = 'mobile')      as mobile_bookings,
           count(b.id) filter (where b.live and b.source = 'desk')        as desk_bookings,
           avg(b.mins) filter (where b.live)                              as avg_duration_min
      from courts_in c
      left join court_open co on co.court_id = c.id
      left join lc on lc.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, co.open_minutes, co.event_minutes,
              lc.lessons, lc.lesson_minutes),
  tot as (
    select count(*)::int                                   as courts_count,
           coalesce(sum(pc.bookings), 0)::bigint           as bookings,
           coalesce(sum(pc.booked_minutes), 0)::bigint     as booked_minutes,
           coalesce(sum(pc.lessons), 0)::bigint            as lessons,
           coalesce(sum(pc.lesson_minutes), 0)::bigint     as lesson_minutes,
           coalesce(sum(pc.revenue_iqd), 0)::bigint        as revenue_iqd,
           coalesce(sum(pc.cancellations), 0)::bigint      as cancellations,
           coalesce(sum(pc.no_shows), 0)::bigint           as no_shows,
           coalesce(sum(pc.mobile_bookings), 0)::bigint    as mobile_bookings,
           coalesce(sum(pc.desk_bookings), 0)::bigint      as desk_bookings,
           coalesce(sum(pc.open_minutes), 0)::bigint       as open_minutes,
           coalesce(sum(pc.event_minutes), 0)::bigint      as event_minutes
      from per_court pc),
  days as (
    select gs::date as d
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') gs),
  by_day as (
    select d.d,
           coalesce((select case when jsonb_typeof(vs.opening_hours -> lower(to_char(d.d, 'Dy'))) = 'array'
                                  then jsonb_array_length(vs.opening_hours -> lower(to_char(d.d, 'Dy')))
                                  else 0 end = 0
                            or d.d = any (coalesce(vs.closed_dates, '{}'))
                       from venue_settings vs where vs.venue_id = v_av), true) as closed,
           count(b.id) filter (where b.live)                           as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint      as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as revenue_iqd,
           count(b.id) filter (where b.cancelled)                      as cancellations,
           count(b.id) filter (where b.no_show)                        as no_shows,
           (select coalesce(sum(ls.mins), 0) from ls where ls.d = d.d)::bigint as lesson_minutes
      from days d
      left join b on b.d = d.d
     group by d.d),
  split as (
    select extract(dow from (gs - make_interval(hours => v_b.start_hour))::date)::int as dow,
           extract(hour from gs)::int                                                 as hour,
           sum(extract(epoch from (least(b.e_local, gs + interval '1 hour') - greatest(b.s_local, gs))) / 60) as booked_minutes
      from b
      cross join lateral generate_series(date_trunc('hour', b.s_local), b.e_local, interval '1 hour') gs
     where b.live and gs < b.e_local
     group by 1, 2),
  -- 0288: lesson minutes split per hour as the bookings are.
  lsplit as (
    select extract(dow from (gs - make_interval(hours => v_b.start_hour))::date)::int as dow,
           extract(hour from gs)::int                                                 as hour,
           sum(extract(epoch from (least(ls.e_local, gs + interval '1 hour') - greatest(ls.s_local, gs))) / 60) as lesson_minutes
      from ls
      cross join lateral generate_series(date_trunc('hour', ls.s_local), ls.e_local, interval '1 hour') gs
     where gs < ls.e_local
     group by 1, 2),
  starts as (
    select b.dow, b.hour,
           count(*) filter (where b.live)                               as bookings,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint  as revenue_iqd,
           count(*) filter (where b.cancelled)                          as cancellations,
           count(*) filter (where b.no_show)                            as no_shows
      from b
     group by b.dow, b.hour),
  hold_cells as (
    select h.dow, h.hour, count(*) as holds_expired from holds h group by h.dow, h.hour),
  open_cells as (
    -- VENUE-WIDE: every court in courts_in, summed per cell.
    select oc.dow, oc.hour, sum(oc.open_minutes)::bigint as open_minutes, max(oc.open_days)::int as open_days
      from oc
     group by oc.dow, oc.hour),
  keys as (
    select oc.dow, oc.hour from open_cells oc
    union select sp.dow, sp.hour from split sp
    union select lsp.dow, lsp.hour from lsplit lsp
    union select st.dow, st.hour from starts st
    union select hc.dow, hc.hour from hold_cells hc),
  heat as (
    select k.dow, k.hour,
           coalesce(oc.open_minutes, 0)::bigint            as open_minutes,
           coalesce(oc.open_days, 0)                       as open_days,
           coalesce(round(sp.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(round(lsp.lesson_minutes), 0)::bigint  as lesson_minutes,
           coalesce(st.bookings, 0)                        as bookings,
           coalesce(st.revenue_iqd, 0)                     as revenue_iqd,
           coalesce(st.cancellations, 0)                   as cancellations,
           coalesce(st.no_shows, 0)                        as no_shows,
           coalesce(hc.holds_expired, 0)                   as holds_expired
      from keys k
      left join open_cells oc on oc.dow = k.dow and oc.hour = k.hour
      left join split sp      on sp.dow = k.dow and sp.hour = k.hour
      left join lsplit lsp    on lsp.dow = k.dow and lsp.hour = k.hour
      left join starts st     on st.dow = k.dow and st.hour = k.hour
      left join hold_cells hc on hc.dow = k.dow and hc.hour = k.hour)
  select jsonb_build_object(
    'range',         jsonb_build_object('from', p_from, 'to', p_to),
    'courts_count',  t.courts_count,
    'open_minutes',  t.open_minutes,
    'event_minutes', t.event_minutes,
    'kpis', jsonb_build_object(
      'bookings',                  t.bookings,
      'booked_minutes',            t.booked_minutes,
      'lessons',                   t.lessons,
      'lesson_minutes',            t.lesson_minutes,
      'occupancy_pct',             case when t.open_minutes > 0 then round((t.booked_minutes + t.lesson_minutes) * 100.0 / t.open_minutes, 1) end,
      'revenue_iqd',               t.revenue_iqd,
      'rev_per_open_hour_iqd',     case when t.open_minutes > 0 then round(t.revenue_iqd * 60.0 / t.open_minutes)::bigint end,
      'price_per_booked_hour_iqd', case when t.booked_minutes > 0 then round(t.revenue_iqd * 60.0 / t.booked_minutes)::bigint end,
      'cancellations',             t.cancellations,
      'no_shows',                  t.no_shows,
      'booked_total',              t.bookings + t.cancellations + t.no_shows,
      'cancellation_rate_pct',     case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.cancellations * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'no_show_rate_pct',          case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.no_shows * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'mobile_bookings',           t.mobile_bookings,
      'desk_bookings',             t.desk_bookings,
      'holds_expired',             (select count(*) from holds),
      'booking_days',              (select count(distinct b.d) from b where b.live)),
    'per_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',              pc.id,
               'name_en',               pc.name_en,
               'name_ar',               pc.name_ar,
               'is_active',             pc.is_active,
               'bookings',              pc.bookings,
               'booked_minutes',        pc.booked_minutes,
               'lessons',               pc.lessons,
               'lesson_minutes',        pc.lesson_minutes,
               'open_minutes',          pc.open_minutes,
               'occupancy_pct',         case when pc.open_minutes > 0 then round((pc.booked_minutes + pc.lesson_minutes) * 100.0 / pc.open_minutes, 1) end,
               'revenue_iqd',           pc.revenue_iqd,
               'rev_per_open_hour_iqd', case when pc.open_minutes > 0 then round(pc.revenue_iqd * 60.0 / pc.open_minutes)::bigint end,
               'cancellations',         pc.cancellations,
               'no_shows',              pc.no_shows,
               'booked_total',          pc.bookings + pc.cancellations + pc.no_shows,
               'cancellation_rate_pct', case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'no_show_rate_pct',      case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'mobile_bookings',       pc.mobile_bookings,
               'desk_bookings',         pc.desk_bookings,
               'avg_duration_min',      round(pc.avg_duration_min, 1)
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'business_date',  x.d,
               'closed',         x.closed,
               'bookings',       x.bookings,
               'booked_minutes', x.booked_minutes,
               'lesson_minutes', x.lesson_minutes,
               'revenue_iqd',    x.revenue_iqd,
               'cancellations',  x.cancellations,
               'no_shows',       x.no_shows
             ) order by x.d), '[]'::jsonb)
        from by_day x),
    'heatmap', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'dow',            h.dow,
               'hour',           h.hour,
               'open_minutes',   h.open_minutes,
               'open_days',      h.open_days,
               'booked_minutes', h.booked_minutes,
               'lesson_minutes', h.lesson_minutes,
               'bookings',       h.bookings,
               'revenue_iqd',    h.revenue_iqd,
               'cancellations',  h.cancellations,
               'no_shows',       h.no_shows,
               'holds_expired',  h.holds_expired
             ) order by h.dow, h.hour), '[]'::jsonb)
        from heat h))
    into v_out
    from tot t;

  return v_out;
end $analytics_courts_summary_0288$;

comment on function app.analytics_courts_summary(date, date, uuid) is
  '0288, from 0219 (0214). Owner analytics (analytics_guard): the analysed branch''s courts for a business-day range (p_court_id narrows): kpis, per_court, by_day and heatmap. 0288 (money.md §8.5, CM-14): a lesson''s live court rows are occupied time: lessons and lesson_minutes in kpis and per_court, lesson_minutes in by_day and heatmap (split per hour as bookings are), and every occupancy_pct over booked + lesson minutes; bookings, revenue and the rates stay bookings only; holds_expired leaves out a lapsed lesson payment''s hold (lesson_id set). Branch aggregates only.';

revoke all on function app.analytics_courts_summary(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_summary(date, date, uuid) to authenticated;

-- ===========================================================================
-- 6. day_close_online (money.md §8.6, X27)
-- ===========================================================================

-- day_close_online: re-issued from 20260929000265_match_reports.sql:155 (its
-- one re-issue, §1.8); + the lessons block and sandbox_excluded.lessons.
-- Information only: close_day is untouched (0281 dates its refunds by till
-- shift), desk lesson money is already in cash and card because it is
-- ordinary payments, and owed_to_coaches_iqd is NEVER part of the cash count
-- (C-12: the coach is paid outside the till). C-31, R27, R71: a desk lesson
-- refund counts on the day it was made, its till shift's day (the payment's
-- day when it was made outside a shift).
create or replace function app.day_close_online(p_day_session_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $day_close_online_0288$
declare
  v_day      day_sessions%rowtype;
  v_tz       text;
  v_hour     int;
  v_from     timestamptz;
  v_to       timestamptz;
  v_tickets  jsonb;
  v_owed     jsonb;
  v_dep      jsonb;
  v_sb_dep   bigint;
  v_matches  jsonb;
  v_lm       jsonb;
  v_desk     record;
  v_dref     bigint;
  v_kept     record;
  v_lowed    record;
  v_lessons  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_day_session_id is not null then
    select * into v_day from day_sessions where id = p_day_session_id;
  else
    select * into v_day from day_sessions
     where venue_id = app.current_venue()
     order by (status = 'open') desc, business_date desc
     limit 1;
  end if;
  if not found then
    raise exception 'DAY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_day.venue_id, 'manager', 'owner') then
    raise exception 'DAY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The business day as bounds: app.venue_business_date(venue, ts) =
  -- business_date exactly when ts falls in [v_from, v_to) (0211:29).
  v_tz   := coalesce((select v.timezone from venues v where v.id = v_day.venue_id), 'Asia/Baghdad');
  v_hour := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v_day.venue_id), 4);
  v_from := (v_day.business_date::timestamp + make_interval(hours => v_hour)) at time zone v_tz;
  v_to   := ((v_day.business_date + 1)::timestamp + make_interval(hours => v_hour)) at time zone v_tz;

  -- Online deposits of this branch: received by succeeded_at, refunded by
  -- refunded_at, kept for a no-show by forfeited_at; waiting = now.
  select jsonb_build_object(
           'received_iqd',          coalesce(sum(bp.amount_iqd) filter (where bp.succeeded_at >= v_from
                                                                        and bp.succeeded_at < v_to), 0)::bigint,
           'received_count',        count(*) filter (where bp.succeeded_at >= v_from and bp.succeeded_at < v_to),
           'refunded_iqd',          coalesce(sum(bp.refund_amount_iqd) filter (where bp.refunded_at >= v_from
                                                                               and bp.refunded_at < v_to), 0)::bigint,
           'refunded_count',        count(*) filter (where bp.refunded_at >= v_from and bp.refunded_at < v_to),
           'forfeited_iqd',         coalesce(sum(bp.amount_iqd) filter (where bp.forfeited_at >= v_from
                                                                        and bp.forfeited_at < v_to), 0)::bigint,
           'forfeited_count',       count(*) filter (where bp.forfeited_at >= v_from and bp.forfeited_at < v_to),
           'refunds_waiting_iqd',   coalesce(sum(bp.refund_amount_iqd)
                                               filter (where bp.status in ('refund_pending', 'refund_failed')), 0)::bigint,
           'refunds_waiting_count', count(*) filter (where bp.status in ('refund_pending', 'refund_failed')))
    into v_dep
    from booking_payments bp
   where bp.purpose = 'deposit' and not bp.sandbox and bp.venue_id = v_day.venue_id;

  select count(*) into v_sb_dep
    from booking_payments bp
   where bp.purpose = 'deposit' and bp.sandbox and bp.venue_id = v_day.venue_id
     and bp.succeeded_at >= v_from and bp.succeeded_at < v_to;

  -- Tickets through the one helper, with the day's bounds; the liability as of
  -- the close (or now, while the day is open).
  v_tickets := app.ticket_money_figures(v_from, v_to, array[v_day.venue_id]);
  v_owed    := app.ticket_money_figures(coalesce(v_day.closed_at, now()), coalesce(v_day.closed_at, now()),
                                        array[v_day.venue_id]);

  -- Open matches starting that business day: the live match bookings' money
  -- (M3: price = paid + written off + owed when nothing is over-paid), the
  -- call-offs, and the no-show carriers (R21: a no-show whose number a walk-in
  -- took carries nothing).
  select jsonb_build_object(
           'bookings',        count(*) filter (where x.live),
           'price_iqd',       coalesce(sum(x.price_iqd) filter (where x.live), 0)::bigint,
           'desk_paid_iqd',   coalesce(sum(app.court_fee_paid(x.reservation_id, null)) filter (where x.live), 0)::bigint,
           'written_off_iqd', coalesce(sum(app.court_fee_written_off(x.reservation_id, null)) filter (where x.live), 0)::bigint,
           'owed_iqd',        coalesce(sum(app.court_fee_remaining(x.reservation_id, null)) filter (where x.live), 0)::bigint,
           'called_off',      count(*) filter (where x.ended_reason = 'called_off_short'),
           'no_show_seats',   coalesce(sum(x.no_show_carriers), 0)::bigint)
    into v_matches
    from (
      select mt.reservation_id, mt.ended_reason,
             coalesce(r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed'), false) as live,
             coalesce(r.price_iqd, 0)::bigint                                                       as price_iqd,
             (select count(*) from app.match_carriers(mt.id) c where c.status = 'no_show')          as no_show_carriers
        from matches mt
        left join reservations r on r.id = mt.reservation_id
       where mt.venue_id = v_day.venue_id and not mt.sandbox
         and mt.start_at >= v_from and mt.start_at < v_to) x;

  -- 0288 (money.md §8.6, X27): lessons.
  v_lm := app.lesson_money_figures(v_from, v_to, array[v_day.venue_id]);

  -- Desk lesson money taken in this day session; its refunds by the day they
  -- were made (C-31, R27: the till shift's day, else the payment's day).
  select coalesce(sum(p.amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_desk
    from payments p
    join tabs t on t.id = p.tab_id and t.kind = 'lesson'
   where p.day_session_id = v_day.id;

  select coalesce(sum(r.amount_iqd), 0)::bigint
    into v_dref
    from refunds r
    join payments p on p.id = r.payment_id
    join tabs t on t.id = p.tab_id and t.kind = 'lesson'
   where r.venue_id = v_day.venue_id
     and coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id),
                  p.day_session_id) = v_day.id;

  -- Money the venue keeps for late cancels and no-shows on the sessions
  -- starting that business day: Σ the engine's allocation to each such session.
  select coalesce(sum((s ->> 'alloc_iqd')::bigint), 0)::bigint                        as iqd,
         count(distinct x.enrolment_id) filter (where (s ->> 'alloc_iqd')::bigint > 0)::bigint as n
    into v_kept
    from (select e.id as enrolment_id, l.id as lesson_id
            from lessons l
            join lesson_enrolments e
              on (e.lesson_id = l.id
                  or (e.course_id = l.course_id
                      and l.session_no between e.first_session_no
                                           and e.first_session_no + e.sessions_covered - 1))
           where l.venue_id = v_day.venue_id
             and l.start_at >= v_from and l.start_at < v_to
             and ((e.status = 'cancelled' and e.cancel_kind = 'guest_late')
                  or exists (select 1 from lesson_attendance a
                              where a.lesson_id = l.id and a.enrolment_id = e.id and a.status = 'no_show'))) x
    cross join lateral jsonb_array_elements(app.lesson_enrolment_money(x.enrolment_id) -> 'sessions') s
   where (s ->> 'lesson_id')::uuid = x.lesson_id;

  -- Played, not yet paid: booked desk enrolments with a session that started
  -- that business day (each enrolment once).
  select coalesce(sum(y.owed), 0)::bigint as iqd, count(*) filter (where y.owed > 0)::bigint as n
    into v_lowed
    from (select (app.lesson_enrolment_money(e.id) ->> 'owed_iqd')::bigint as owed
            from lesson_enrolments e
           where e.venue_id = v_day.venue_id
             and e.status = 'booked' and e.payment_mode = 'desk'
             and exists (select 1 from lessons l
                          where l.venue_id = v_day.venue_id
                            and l.start_at >= v_from and l.start_at < v_to and l.start_at <= now()
                            and l.status <> 'cancelled'
                            and (e.lesson_id = l.id
                                 or (e.course_id = l.course_id
                                     and l.session_no between e.first_session_no
                                                          and e.first_session_no + e.sessions_covered - 1)))) y;

  v_lessons := jsonb_build_object(
    'desk_paid_iqd',                v_desk.iqd,
    'desk_paid_count',              v_desk.n,
    'desk_refunded_iqd',            v_dref,
    'online_received_iqd',          (v_lm ->> 'onlineIqd')::bigint,
    'online_received_count',        (v_lm ->> 'onlineCount')::bigint,
    'online_refunded_iqd',          (v_lm ->> 'onlineRefundsIqd')::bigint,
    'online_refunded_count',        (v_lm ->> 'onlineRefundsCount')::bigint,
    'online_refunds_waiting_iqd',   (v_lm ->> 'onlineRefundsWaitingIqd')::bigint,
    'online_refunds_waiting_count', (v_lm ->> 'onlineRefundsWaitingCount')::bigint,
    'refunds_due_desk_iqd',         (v_lm ->> 'refundsDueDeskIqd')::bigint,
    'refunds_due_desk_count',       (v_lm ->> 'refundsDueDeskCount')::bigint,
    'kept_iqd',                     v_kept.iqd,
    'kept_count',                   v_kept.n,
    'lessons',                      (v_lm ->> 'lessons')::bigint,
    'owed_iqd',                     v_lowed.iqd,
    'owed_count',                   v_lowed.n,
    -- Information only: the coaches are paid outside the till (C-12).
    'owed_to_coaches_iqd',          (v_lm ->> 'owedToCoachesIqd')::bigint);

  return jsonb_build_object(
    'day_session_id', v_day.id,
    'venue_id',       v_day.venue_id,
    'business_date',  v_day.business_date,
    'as_of',          now(),
    'deposits',       v_dep,
    'tickets_here',   jsonb_build_object(
                        'forfeited_iqd',   v_tickets -> 'forfeitsIqd',
                        'forfeited_count', v_tickets -> 'forfeitedTickets',
                        'restored_count',  v_tickets -> 'restoredTickets',
                        'cashouts_iqd',    v_tickets -> 'cashoutsHereIqd',
                        'cashouts_count',  v_tickets -> 'cashoutsHereTickets'),
    'tickets_chain',  jsonb_build_object(
                        'sold_iqd',              v_tickets -> 'soldIqd',
                        'sold_tickets',          v_tickets -> 'soldTickets',
                        'purchases',             v_tickets -> 'purchases',
                        'refunded_iqd',          v_tickets -> 'refundedIqd',
                        'refunded_tickets',      v_tickets -> 'refundedTickets',
                        'refunds_waiting_iqd',   v_tickets -> 'refundsWaitingIqd',
                        'refunds_waiting_count', v_tickets -> 'refundsWaitingCount',
                        'liability_iqd',         v_owed -> 'liabilityIqd',
                        'liability_tickets',     v_owed -> 'liabilityTickets'),
    'matches',        v_matches,
    'lessons',        v_lessons,
    'sandbox_excluded', jsonb_build_object('deposits', v_sb_dep, 'tickets', v_tickets -> 'sandboxExcluded',
                                           'lessons', (v_lm ->> 'sandboxExcluded')::bigint));
end $day_close_online_0288$;

comment on function app.day_close_online(uuid) is
  '0288, from 0265 (money.md §7.2, §8.6). Manager or owner at the day''s branch: the day close''s "Money outside the drawer" card for p_day_session_id (default the branch''s open day, else its latest; another branch''s day is DAY_NOT_FOUND). {day_session_id, venue_id, business_date, as_of, deposits {...}, tickets_here {...}, tickets_chain {...}, matches {...} (0265, unchanged), lessons {desk_paid_iqd, desk_paid_count (payments on lesson tabs in this day session), desk_refunded_iqd (their refunds made this day: the till shift''s day, else the payment''s, C-31, R27, R71), online_received_iqd, online_received_count, online_refunded_iqd, online_refunded_count (by the day''s bounds), online_refunds_waiting_iqd, online_refunds_waiting_count, refunds_due_desk_iqd, refunds_due_desk_count (now), kept_iqd, kept_count (money kept for late cancels and no-shows on sessions starting that day), lessons, owed_to_coaches_iqd (statement lessons starting that day and the coaches'' share: information only, never part of the cash count, C-12), owed_iqd, owed_count (booked desk enrolments with a session played that day, not yet paid)}, sandbox_excluded {deposits, tickets, lessons}}. Information only: close_day is untouched and nothing here enters the cash count. Takes no lock. FORBIDDEN, DAY_NOT_FOUND, VENUE_REQUIRED (no default branch).';

revoke all on function app.day_close_online(uuid) from public, anon;
grant execute on function app.day_close_online(uuid) to authenticated;

-- ===========================================================================
-- 7. report_lessons (money.md §8.7, X24)
-- ===========================================================================

-- A person-money report (C-28, R42): byCoach is money about a named coach, so
-- it is in PERSON_MONEY_REPORTS (scanned for guest identity, exempt from the
-- coach patterns) and no assistant tool names it. No student name, phone or
-- guest id. collectedIqd and coachShareIqd are accrual (the statement
-- lessons); deskIqd, onlineIqd, refundsIqd and lessonRevenueIqd are cash
-- basis (app.lesson_money_figures).
create or replace function app.report_lessons(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $report_lessons_0288$
declare
  v_rv       uuid[] := app.report_venues();
  v_b        record;
  v_lm       jsonb;
  v_set      jsonb;
  v_by_coach jsonb;
  v_by_type  jsonb;
  v_by_day   jsonb;
  v_places   bigint;
  v_taken    bigint;
  v_coll     bigint;
  v_share    bigint;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  v_lm := app.lesson_money_figures(v_b.ts_from, v_b.ts_to, v_rv);

  -- The statement lessons once, each with its booked enrolments.
  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson',     sl.lesson_id,
           'coach',      sl.coach_id,
           'type',       sl.lesson_type_id,
           'kind',       sl.kind,
           'day',        app.business_date(sl.start_at, v_b.tz, v_b.start_hour),
           'collected',  sl.collected_iqd,
           'share',      sl.coach_iqd,
           'enrolments', (select count(*) from lesson_enrolments e
                           where e.status = 'booked'
                             and (e.lesson_id = sl.lesson_id
                                  or (e.course_id = sl.course_id
                                      and sl.session_no between e.first_session_no
                                                            and e.first_session_no + e.sessions_covered - 1))))),
           '[]'::jsonb)
    into v_set
    from app.coach_statement_lessons(v_rv, v_b.ts_from, v_b.ts_to, null) sl;

  select coalesce(jsonb_agg(jsonb_build_object(
           'coachId',       x.coach,
           'coachNameEn',   c.display_name_en,
           'coachNameAr',   c.display_name_ar,
           'lessons',       x.lessons,
           'enrolments',    x.enrolments,
           'collectedIqd',  x.collected,
           'coachShareIqd', x.share)
           order by x.collected desc, c.display_name_en), '[]'::jsonb)
    into v_by_coach
    from (select s.coach, count(*)::bigint as lessons, sum(s.enrolments)::bigint as enrolments,
                 sum(s.collected)::bigint as collected, sum(s.share)::bigint as share
            from jsonb_to_recordset(v_set) as s(lesson uuid, coach uuid, type uuid, kind text, day date,
                                                collected bigint, share bigint, enrolments bigint)
           group by s.coach) x
    join coaches c on c.id = x.coach;

  select coalesce(jsonb_agg(jsonb_build_object(
           'lessonTypeId', x.type,
           'nameEn',       lt.name_en,
           'nameAr',       lt.name_ar,
           'kind',         lt.kind,
           'lessons',      x.lessons,
           'enrolments',   x.enrolments,
           'collectedIqd', x.collected)
           order by x.collected desc, lt.sort_order, lt.name_en), '[]'::jsonb)
    into v_by_type
    from (select s.type, count(*)::bigint as lessons, sum(s.enrolments)::bigint as enrolments,
                 sum(s.collected)::bigint as collected
            from jsonb_to_recordset(v_set) as s(lesson uuid, coach uuid, type uuid, kind text, day date,
                                                collected bigint, share bigint, enrolments bigint)
           group by s.type) x
    join lesson_types lt on lt.id = x.type;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date',          x.day,
           'lessons',       x.lessons,
           'collectedIqd',  x.collected,
           'coachShareIqd', x.share)
           order by x.day), '[]'::jsonb)
    into v_by_day
    from (select s.day, count(*)::bigint as lessons, sum(s.collected)::bigint as collected,
                 sum(s.share)::bigint as share
            from jsonb_to_recordset(v_set) as s(lesson uuid, coach uuid, type uuid, kind text, day date,
                                                collected bigint, share bigint, enrolments bigint)
           group by s.day) x;

  v_places := (v_lm ->> 'places')::bigint;
  v_taken  := (v_lm ->> 'placesTaken')::bigint;
  v_coll   := (v_lm ->> 'collectedIqd')::bigint;
  v_share  := (v_lm ->> 'owedToCoachesIqd')::bigint;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', jsonb_build_object(
      'lessons',          (v_lm ->> 'lessons')::bigint,
      'private',          (v_lm ->> 'private')::bigint,
      'group',            (v_lm ->> 'group')::bigint,
      'courseSessions',   (v_lm ->> 'courseSessions')::bigint,
      'cancelled',        (v_lm ->> 'cancelled')::bigint,
      'underFilled',      (v_lm ->> 'underFilled')::bigint,
      'expired',          (v_lm ->> 'expired')::bigint,
      'enrolments',       (v_lm ->> 'enrolments')::bigint,
      'places',           v_places,
      'placesTaken',      v_taken,
      'fillRatePct',      case when v_places > 0 then round(v_taken * 100.0 / v_places, 1) end,
      'attended',         (v_lm ->> 'attended')::bigint,
      'noShows',          (v_lm ->> 'noShows')::bigint,
      'lateCancels',      (v_lm ->> 'lateCancels')::bigint,
      'collectedIqd',     v_coll,
      'courtShareIqd',    (v_lm ->> 'courtShareIqd')::bigint,
      'coachShareIqd',    v_share,
      'venueShareIqd',    v_coll - v_share,
      'deskIqd',          (v_lm ->> 'deskIqd')::bigint,
      'onlineIqd',        (v_lm ->> 'onlineIqd')::bigint,
      'refundsIqd',       (v_lm ->> 'deskRefundsIqd')::bigint + (v_lm ->> 'onlineRefundsIqd')::bigint,
      'lessonRevenueIqd', (v_lm ->> 'netIqd')::bigint,
      'sandboxExcluded',  (v_lm ->> 'sandboxExcluded')::bigint),
    'byCoach', v_by_coach,
    'byType',  v_by_type,
    'byDay',   v_by_day,
    -- The byCoach table's columns, the report_courts shape; the one coaching
    -- glossary (C-30, R55, R81). DRAFT-AR.
    'columns', jsonb_build_array(
      jsonb_build_object('key','coachNameEn',   'labelEn','Coach',          'labelAr','المدرّب',      'kind','text'),
      jsonb_build_object('key','lessons',       'labelEn','Lessons',        'labelAr','الحصص',        'kind','count'),
      jsonb_build_object('key','enrolments',    'labelEn','Places taken',   'labelAr','الأماكن المحجوزة', 'kind','count'),
      jsonb_build_object('key','collectedIqd',  'labelEn','Collected',      'labelAr','المحصّل',       'kind','money'),
      jsonb_build_object('key','coachShareIqd', 'labelEn','Coach''s share', 'labelAr','نصيب المدرّب', 'kind','money')));
end $report_lessons_0288$;

comment on function app.report_lessons(date, date) is
  '0288 (money.md §8.7, X24; C-28, R42). Manager or owner (reports_guard): the Lessons report for a business-day range over app.report_venues(), lessons by start. {period {from, to}, totals {lessons, private, group, courseSessions, cancelled, underFilled, expired, enrolments, places, placesTaken, fillRatePct (group and course sessions, one decimal), attended, noShows, lateCancels, collectedIqd, courtShareIqd, coachShareIqd, venueShareIqd (= collected - coach share), deskIqd, onlineIqd, refundsIqd, lessonRevenueIqd, sandboxExcluded} (app.lesson_money_figures: collected and coach share accrual over the statement lessons, desk, online, refunds and lesson revenue cash basis), byCoach [{coachId, coachNameEn, coachNameAr, lessons, enrolments, collectedIqd, coachShareIqd}], byType [{lessonTypeId, nameEn, nameAr, kind, lessons, enrolments, collectedIqd}], byDay [{date, lessons, collectedIqd, coachShareIqd}], columns (EN, AR)}. A person-money report: coach display names, never a student, a phone or a guest id; never an assistant tool (R42). FORBIDDEN, INVALID_RANGE.';

revoke all on function app.report_lessons(date, date) from public, anon;
grant execute on function app.report_lessons(date, date) to authenticated;
