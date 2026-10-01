set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0265 match_reports — open matches, lane Money (with Ops): the money outside
-- the drawer at day close and the open-match reports (docs/design/
-- open-matches/money.md §7, §8, §9 M8 M10; operator.md §5.6.4, §5.18, §5.19;
-- build contracts §1.5, §1.7, §1.8, rulings R14, R31; decisions MD-16, OM-45,
-- OM-48, DF-19).
--
--   1. app.ticket_money_figures    internal (MD-16): every ticket figure, one
--                                  helper for the three screens
--   2. app.day_close_online         manager, owner: the day close's "Money
--                                  outside the drawer" card
--   3. app.reports_figures          re-issued from 0219:174: seven keys
--      app.panel_headline           re-issued from 0096:107: the seven keys last
--   4. app.report_courts            re-issued from 0219:2438: the matches block
--   5. app.unpaid_played_bookings   re-issued from 0231:950: the match fields
--   6. app.report_matches           reports guard: the Courts report's Matches
--                                  view
--
-- Everything here reads and nothing locks (money.md §8: the reports and
-- day_close_online take no lock), so check:locks has nothing to walk.
--
-- Sandbox (DF-19, M10): a sandbox match, deposit or ticket adds 0 to every
-- figure; it is only counted in the sandbox_excluded / sandboxExcluded tallies.
-- Ticket money is chain money: sales, refunds, refunds waiting and the
-- liability are chain-wide; forfeits, restores and cash-outs belong to the
-- branch where they happened. None of it is branch revenue, cash or card (M8):
-- revenue, padelRevenue, cash and card are unchanged.
--
-- Seat money comes from the 0262 engine: court_fee_paid (0106),
-- court_fee_written_off and match_money (0262), court_fee_remaining (0262,
-- netting written-off shares). No name, label or customer id reaches a
-- report_* or panel_* payload (G6a, SEC-29); unpaid_played_bookings is the one
-- read here that shows a staff label, as booking_bill does.
--
-- A business day is the one app.venue_business_date (0211) gives: the
-- branch's venues.timezone and its analytics_business_day_start_hour. The
-- reports keep app.analytics_bounds (0214), as every report does.

-- ===========================================================================
-- 1. The ticket figures (money.md §7.1)
-- ===========================================================================

-- MD-16: the one helper behind reports_figures, report_courts, report_matches
-- and day_close_online, so no two screens can disagree on a ticket figure.
create or replace function app.ticket_money_figures(p_ts_from timestamptz, p_ts_to timestamptz, p_venues uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $ticket_money_figures_0265$
declare
  v_sold record;
  v_ref  record;
  v_wait record;
  v_lost record;
  v_here record;
  v_live record;
begin
  -- Sales (chain): purchases that succeeded in the period. A purchase refunded
  -- amount_mismatch was never a sale (MD-2: not our payment).
  select coalesce(sum(bp.amount_iqd) filter (where not bp.sandbox), 0)::bigint   as iqd,
         coalesce(sum(bp.ticket_count) filter (where not bp.sandbox), 0)::bigint as tickets,
         count(*) filter (where not bp.sandbox)                                  as purchases,
         count(*) filter (where bp.sandbox)                                      as sandbox
    into v_sold
    from booking_payments bp
   where bp.purpose = 'ticket'
     and bp.succeeded_at >= p_ts_from and bp.succeeded_at < p_ts_to
     and bp.refund_reason is distinct from 'amount_mismatch';

  -- Refunds (chain): cash-outs and account deletions paid back in the period
  -- (a manual settle keeps its reason, so it counts too). The tickets are the
  -- refund over the price paid: every ticket of a purchase cost the same (T2).
  select coalesce(sum(bp.refund_amount_iqd), 0)::bigint as iqd,
         coalesce(sum(bp.refund_amount_iqd::bigint / nullif(bp.quoted_price_iqd::bigint, 0)), 0)::bigint as tickets
    into v_ref
    from booking_payments bp
   where bp.purpose = 'ticket' and not bp.sandbox
     and bp.status = 'refunded'
     and bp.refund_reason in ('ticket_cashout', 'account_deleted')
     and bp.refunded_at >= p_ts_from and bp.refunded_at < p_ts_to;

  -- Refunds waiting (chain, now): asked of Qi and not paid back yet.
  select coalesce(sum(bp.refund_amount_iqd), 0)::bigint as iqd, count(*) as n
    into v_wait
    from booking_payments bp
   where bp.purpose = 'ticket' and not bp.sandbox
     and bp.status in ('refund_pending', 'refund_failed');

  -- Forfeits (these branches): tickets forfeited NOW whose forfeit falls in
  -- the period, so a restore takes the forfeit out of every period.
  select coalesce(sum(t.price_iqd), 0)::bigint as iqd, count(*) as n
    into v_lost
    from match_tickets t
   where t.status = 'forfeited' and not t.sandbox
     and t.forfeited_venue_id = any (p_venues)
     and t.forfeited_at >= p_ts_from and t.forfeited_at < p_ts_to;

  -- Restores and cash-outs pressed at these branches, by the event's branch
  -- (a DF-20 refund has none, so it is nobody's cash-out here).
  select count(*) filter (where e.type = 'restored')                                as restored,
         coalesce(sum(t.price_iqd) filter (where e.type = 'cashed_out'), 0)::bigint as cashout_iqd,
         count(*) filter (where e.type = 'cashed_out')                               as cashout_n
    into v_here
    from match_ticket_events e
    join match_tickets t on t.id = e.ticket_id
   where e.type in ('restored', 'cashed_out') and not t.sandbox
     and e.venue_id = any (p_venues)
     and e.at >= p_ts_from and e.at < p_ts_to;

  -- Liability (chain) at p_ts_to: an exact replay of the ledger (the table is
  -- small). A ticket is owed to its holder while its latest event before then
  -- leaves it unused or in play.
  select coalesce(sum(t.price_iqd), 0)::bigint as iqd, count(*) as n
    into v_live
    from match_tickets t
    join lateral (select e.type
                    from match_ticket_events e
                   where e.ticket_id = t.id and e.at < p_ts_to
                   order by e.at desc, e.id desc
                   limit 1) last on true
   where not t.sandbox
     and last.type in ('bought', 'reserved', 'locked', 'released', 'restored');

  return jsonb_build_object(
    'soldIqd',             v_sold.iqd,
    'soldTickets',         v_sold.tickets,
    'purchases',           v_sold.purchases,
    'refundedIqd',         v_ref.iqd,
    'refundedTickets',     v_ref.tickets,
    'refundsWaitingIqd',   v_wait.iqd,
    'refundsWaitingCount', v_wait.n,
    'forfeitsIqd',         v_lost.iqd,
    'forfeitedTickets',    v_lost.n,
    'restoredTickets',     v_here.restored,
    'cashoutsHereIqd',     v_here.cashout_iqd,
    'cashoutsHereTickets', v_here.cashout_n,
    'liabilityIqd',        v_live.iqd,
    'liabilityTickets',    v_live.n,
    'sandboxExcluded',     v_sold.sandbox);
end $ticket_money_figures_0265$;

comment on function app.ticket_money_figures(timestamptz, timestamptz, uuid[]) is
  '0265. Internal (MD-16). Every open-match ticket figure for [p_ts_from, p_ts_to), non-sandbox: soldIqd, soldTickets, purchases (chain; purchases succeeded in range, amount_mismatch excluded); refundedIqd, refundedTickets (chain; refunded in range, reasons ticket_cashout and account_deleted); refundsWaitingIqd, refundsWaitingCount (chain; refund_pending or refund_failed now); forfeitsIqd, forfeitedTickets (tickets forfeited now at a branch of p_venues with forfeited_at in range); restoredTickets, cashoutsHereIqd, cashoutsHereTickets (restored and cashed_out events at p_venues in range); liabilityIqd, liabilityTickets (chain; tickets whose latest event before p_ts_to is bought, reserved, locked, released or restored); sandboxExcluded (sandbox purchases left out). Read by reports_figures, report_courts, report_matches and day_close_online. Takes no lock.';

revoke all on function app.ticket_money_figures(timestamptz, timestamptz, uuid[]) from public, anon, authenticated;

-- ===========================================================================
-- 2. Day close: money outside the drawer (money.md §7.2, operator.md §5.18)
-- ===========================================================================

-- Information only: close_day is untouched, and seat money is already in cash
-- and card because it is ordinary payments. Default day as day_close_shop
-- (0246:450): the branch's open day, else its latest; another branch's day is
-- DAY_NOT_FOUND.
create or replace function app.day_close_online(p_day_session_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $day_close_online_0265$
declare
  v_day     day_sessions%rowtype;
  v_tz      text;
  v_hour    int;
  v_from    timestamptz;
  v_to      timestamptz;
  v_tickets jsonb;
  v_owed    jsonb;
  v_dep     jsonb;
  v_sb_dep  bigint;
  v_matches jsonb;
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
    'sandbox_excluded', jsonb_build_object('deposits', v_sb_dep, 'tickets', v_tickets -> 'sandboxExcluded'));
end $day_close_online_0265$;

comment on function app.day_close_online(uuid) is
  '0265 (money.md §7.2). Manager or owner at the day''s branch: the day close''s "Money outside the drawer" card for p_day_session_id (default the branch''s open day, else its latest; another branch''s day is DAY_NOT_FOUND). {day_session_id, venue_id, business_date, as_of, deposits {received_iqd, received_count, refunded_iqd, refunded_count, forfeited_iqd, forfeited_count, refunds_waiting_iqd, refunds_waiting_count} (this branch, by each stamp''s business day; waiting = now), tickets_here {forfeited_iqd, forfeited_count, restored_count, cashouts_iqd, cashouts_count} (this branch), tickets_chain {sold_iqd, sold_tickets, purchases, refunded_iqd, refunded_tickets, refunds_waiting_iqd, refunds_waiting_count, liability_iqd, liability_tickets} (every branch; liability as of the close, or now while open), matches {bookings, price_iqd, desk_paid_iqd, written_off_iqd, owed_iqd, called_off, no_show_seats} (open matches starting that day), sandbox_excluded {deposits, tickets}}. Information only: close_day is untouched and nothing here enters the cash count. Takes no lock. FORBIDDEN, DAY_NOT_FOUND, VENUE_REQUIRED (no default branch).';

revoke all on function app.day_close_online(uuid) from public, anon;
grant execute on function app.day_close_online(uuid) to authenticated;

-- ===========================================================================
-- 3. reports_figures and panel_headline (money.md §7.3)
-- ===========================================================================

-- reports_figures: re-issued from 20260926000219_reports_venue_scope.sql:174;
-- + onlineDeposits, depositForfeits, ticketSales, ticketRefunds,
-- ticketForfeits, ticketLiability, matchWrittenOff.
create or replace function app.reports_figures(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $reports_figures_0265$
declare
  v_rv uuid[] := app.report_venues();
  v_b   record;
  v_out jsonb;
  v_tk  jsonb;
begin
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  -- 0265: the ticket figures come from the one helper (MD-16); the sales,
  -- refunds and liability are chain-wide, the forfeits this report's branches.
  v_tk := app.ticket_money_figures(v_b.ts_from, v_b.ts_to, v_rv);

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
           'revenue',       res.padel_iqd + cafe.cafe_net_iqd,
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
           'matchWrittenOff', mw.written_off_iqd)
    into v_out
    from res, cafe, ord, pay, ref, waste, dep, mw;

  return v_out;
end $reports_figures_0265$;

comment on function app.reports_figures(date, date) is
  '0265. Internal (service role; panel_headline reads it). The headline figures of a business-day range over app.report_venues(): revenue (padelRevenue + cafeNet), padelRevenue, cafeRevenue, cafeNet, cash, card, bookings, orders, avgOrderValue, discounts, refunds, waste, noShows; then (money.md §7.3, non-sandbox) onlineDeposits (deposits by succeeded_at less their refunds by refunded_at), depositForfeits (deposits by forfeited_at), ticketSales, ticketRefunds and ticketLiability (chain-wide, app.ticket_money_figures; the liability at the end of the range), ticketForfeits (these branches), matchWrittenOff (Σ court_fee_written_off of the live match bookings starting in the range). Ticket money never enters revenue, cash or card.';

revoke all on function app.reports_figures(date, date) from public, anon, authenticated;
grant execute on function app.reports_figures(date, date) to service_role;

-- panel_headline: re-issued from 20260914000096_reports_shared_cafe.sql:107;
-- the seven reports_figures keys appended to the fixed list (owner only).
create or replace function app.panel_headline(p_from date, p_to date, p_compare text default 'none')
returns jsonb
language plpgsql stable security definer set search_path = public as $panel_headline_0265$
declare
  v_b        record;
  v_cur      jsonb;
  v_prev     jsonb;
  v_cmp_from date;
  v_cmp_to   date;
  v_len      int;
  -- 0265: the seven online-money and open-match keys go last (money.md §7.3),
  -- so every existing position is unchanged.
  v_keys     text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','bookings',
                             'orders','avgOrderValue','discounts','refunds','waste','noShows',
                             'onlineDeposits','depositForfeits','ticketSales','ticketRefunds',
                             'ticketForfeits','ticketLiability','matchWrittenOff'];
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
end $panel_headline_0265$;

comment on function app.panel_headline(date, date, text) is
  '0265. Owner only (reports_guard(true)): the management panel headline for a business-day range, {period, comparison, figures [{key, value, previous, changeAbs, changePct}]} in a fixed key order: revenue, padelRevenue, cafeRevenue, cafeNet, cash, card, bookings, orders, avgOrderValue, discounts, refunds, waste, noShows, then onlineDeposits, depositForfeits, ticketSales, ticketRefunds, ticketForfeits, ticketLiability, matchWrittenOff (money.md §7.3; ticketSales, ticketRefunds and ticketLiability are chain-wide). p_compare: none, previousPeriod or sameLastYear. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.panel_headline(date, date, text) from public, anon;
grant execute on function app.panel_headline(date, date, text) to authenticated;

-- ===========================================================================
-- 4. report_courts: the matches block (money.md §7.4)
-- ===========================================================================

-- report_courts: re-issued from 20260926000219_reports_venue_scope.sql:2438;
-- + the matches block.
create or replace function app.report_courts(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_courts_0265$
declare
  v_av uuid := app.analysis_venue();
  v_b       record;
  v_court   uuid;
  v_rows    jsonb;
  v_totals  jsonb;
  v_by_hour jsonb;
  v_trend   jsonb;
  v_matches jsonb;
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
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where c.venue_id = v_av and (v_court is null or c.id = v_court)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, sum(o.open_minutes)::bigint as open_minutes, sum(o.event_minutes)::bigint as event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, v_court) o
      join courts_in ci on ci.id = o.court_id
     group by o.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(oc.open_minutes, 0)::bigint                                as avail,
           coalesce(oc.event_minutes, 0)::bigint                               as event_minutes,
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
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, oc.open_minutes, oc.event_minutes)
  select coalesce(jsonb_agg(jsonb_build_object(
           'courtId',                    pc.id,
           'courtNameEn',                pc.name_en,
           'courtNameAr',                pc.name_ar,
           'isActive',                   pc.is_active,
           'bookings',                   pc.bookings,
           'bookedMinutes',              pc.booked_minutes,
           'availableMinutes',           pc.avail,
           'eventMinutes',               pc.event_minutes,
           'occupancyPct',               case when pc.avail > 0 then round(pc.booked_minutes * 100.0 / pc.avail, 1) end,
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
           'availableMinutes', coalesce(sum(pc.avail), 0)::bigint,
           'eventMinutes',     coalesce(sum(pc.event_minutes), 0)::bigint,
           'occupancyPct',     case when coalesce(sum(pc.avail), 0) > 0
                                    then round(coalesce(sum(pc.booked_minutes), 0) * 100.0 / sum(pc.avail), 1) end,
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

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','courtNameEn',                'labelEn','Court',               'labelAr','الملعب',                 'kind','text'),
      jsonb_build_object('key','bookings',                   'labelEn','Bookings',            'labelAr','الحجوزات',               'kind','count'),
      jsonb_build_object('key','bookedMinutes',              'labelEn','Booked minutes',      'labelAr','الدقائق المحجوزة',       'kind','count'),
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
    'matches',    v_matches);
end $report_courts_0265$;

comment on function app.report_courts(date, date, jsonb) is
  '0265, from 0219 (event_court_blocks §2.11, 0097). MGMT: the courts report for a business-day range (p_filters.courtId narrows to one court): per-court rows and totals with availableMinutes (event hours included) and eventMinutes (the part event blocks hold), byHour and the daily trend; match bookings count there as ordinary bookings. Plus matches {bookings, bookedIqd, deskPaidIqd, writtenOffIqd, noShowSeats, calledOffShort, ticketForfeitsIqd} (money.md §7.4): the analysed branch''s open matches starting in the range, whatever courtId says, sandbox left out; counts and money only.';

revoke all on function app.report_courts(date, date, jsonb) from public, anon;
grant execute on function app.report_courts(date, date, jsonb) to authenticated;

-- ===========================================================================
-- 5. unpaid_played_bookings: the match fields (money.md §7.5)
-- ===========================================================================

-- unpaid_played_bookings: re-issued from
-- 20260926000231_branch_scoped_reads.sql:950; + match_id, owed_by_seats_iqd,
-- delta_owed_iqd, seats_owing. The filter is unchanged: court_fee_remaining
-- (0262) nets written-off shares, so a match whose present players paid and
-- whose no-shows are written off drops off the list.
create or replace function app.unpaid_played_bookings(p_day_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $unpaid_played_bookings_0265$
declare
  v_day day_sessions%rowtype;
  v_out jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_day_session_id is null then
    -- 0219: the open day of the caller's branch.
    select * into v_day from day_sessions
     where venue_id = app.current_venue() and status in ('open','closing')
     order by opened_at desc limit 1;
  else
    select * into v_day from day_sessions where id = p_day_session_id;
  end if;
  if not found then
    return '[]'::jsonb;
  end if;
  if not app.is_staff_at(v_day.venue_id, 'manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'reservation_id', r.id,
           'guest_name',     r.guest_name,
           'status',         r.status,
           'start_at',       r.start_at,
           'end_at',         r.end_at,
           'court_name_en',  c.name_en,
           'court_name_ar',  c.name_ar,
           'price_iqd',      r.price_iqd,
           'remaining_iqd',  app.court_fee_remaining(r.id, null),
           'live_tab_id',    (select t.id from tabs t where t.reservation_id = r.id
                                and t.status in ('open','awaiting_payment') limit 1),
           -- 0265 (money.md §7.5): a match booking names its match and the
           -- seats that still owe (NULL on any other booking). The label is
           -- the staff one of booking_bill.seats: the player's, the linked
           -- customer's or the typed walk-in name; a friend seat its holder's.
           'match_id',          mt.id,
           'owed_by_seats_iqd', (mm.money ->> 'owed_iqd')::bigint,
           'delta_owed_iqd',    (mm.money ->> 'delta_owed_iqd')::bigint,
           'seats_owing',       mm.seats_owing)
         order by r.start_at), '[]'::jsonb)
    into v_out
    from reservations r
    join courts c on c.id = r.court_id
    left join matches mt on mt.reservation_id = r.id
    left join lateral (
      select e.money,
             coalesce((select jsonb_agg(jsonb_build_object(
                                'seat_no',  (s ->> 'seat_no')::int,
                                'label',    case when ms.guest_id is not null then p.full_name else ms.guest_name end,
                                'owed_iqd', (s ->> 'owed_iqd')::bigint)
                              order by (s ->> 'seat_no')::int)
                         from jsonb_array_elements(e.money -> 'seats') s
                         join match_seats ms on ms.id = (s ->> 'seat_id')::uuid
                         left join profiles p on p.id = ms.guest_id
                        where coalesce((s ->> 'carrying')::boolean, false)
                          and (s ->> 'owed_iqd')::bigint > 0), '[]'::jsonb) as seats_owing
        from (select app.match_money(mt.id, null) as money) e
       where mt.id is not null) mm on true
   where r.kind = 'booking'
     and r.venue_id = v_day.venue_id
     -- 0231: a sargable window around the business day (any timezone and
     -- start hour fall inside it) before the exact per-row test below.
     and r.start_at >= v_day.business_date::timestamptz - interval '2 days'
     and r.start_at <  v_day.business_date::timestamptz + interval '3 days'
     and app.venue_business_date(v_day.venue_id, r.start_at) = v_day.business_date
     and (r.status in ('arrived','completed') or (r.status = 'confirmed' and r.end_at <= now()))
     and app.court_fee_remaining(r.id, null) > 0;

  return v_out;
end $unpaid_played_bookings_0265$;

comment on function app.unpaid_played_bookings(uuid) is
  '0265, from 0106/0219/0231. Manager/owner. The bookings of a day session (default: the open one) that were played — arrived, completed, or confirmed and over — and still owe their court fee (court_fee_remaining, which nets written-off match shares). Each row: reservation_id, guest_name, status, start_at, end_at, court_name_en, court_name_ar, price_iqd, remaining_iqd, live_tab_id, and for an open-match booking match_id, owed_by_seats_iqd, delta_owed_iqd and seats_owing [{seat_no, label, owed_iqd}] (the staff label of booking_bill.seats; NULL on any other booking). Day close lists them as a warning; it does not refuse.';

revoke all on function app.unpaid_played_bookings(uuid) from public, anon;
grant execute on function app.unpaid_played_bookings(uuid) to authenticated;

-- ===========================================================================
-- 6. report_matches: the Courts report's Matches view (money.md §7.6)
-- ===========================================================================

-- Open matches by start_at over the report's branches (report_venues, so the
-- owner's "All branches" scope works as for every report), sandbox left out.
-- Filters: category, joinPolicy; any other key, or a value outside its
-- vocabulary, is INVALID_ARGUMENT with the key as detail. The ticket block is
-- app.ticket_money_figures for the same bounds (MD-16), so it ignores the
-- filters. No names, labels or ids of people (G6a, SEC-29).
create or replace function app.report_matches(p_from date, p_to date, p_filters jsonb default '{}')
returns jsonb
language plpgsql stable security definer set search_path = public as $report_matches_0265$
declare
  v_rv       uuid[];
  v_b        record;
  v_filters  jsonb := coalesce(p_filters, '{}'::jsonb);
  v_key      text;
  v_category text;
  v_policy   text;
  v_tk       jsonb;
  v_sandbox  bigint;
  v_totals   jsonb;
  v_by_day   jsonb;
begin
  perform app.reports_guard(false);
  v_rv := app.report_venues();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  for v_key in select jsonb_object_keys(v_filters) loop
    if v_key not in ('category', 'joinPolicy') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  if v_filters ? 'category' and jsonb_typeof(v_filters -> 'category') <> 'null' then
    v_category := v_filters ->> 'category';
    if jsonb_typeof(v_filters -> 'category') <> 'string' or v_category not in ('open', 'women', 'men') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'category';
    end if;
  end if;
  if v_filters ? 'joinPolicy' and jsonb_typeof(v_filters -> 'joinPolicy') <> 'null' then
    v_policy := v_filters ->> 'joinPolicy';
    if jsonb_typeof(v_filters -> 'joinPolicy') <> 'string' or v_policy not in ('open', 'approve') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'joinPolicy';
    end if;
  end if;

  v_tk := app.ticket_money_figures(v_b.ts_from, v_b.ts_to, v_rv);

  select count(*) into v_sandbox
    from matches mt
   where mt.venue_id = any(v_rv) and mt.sandbox
     and mt.start_at >= v_b.ts_from and mt.start_at < v_b.ts_to
     and (v_category is null or mt.category = v_category)
     and (v_policy is null or mt.join_policy = v_policy);

  -- One row per match: its business day, whether it ever booked a court (a
  -- match keeps its reservation_id once booked), whether that booking is live,
  -- its seat money (0 unless live) and its seats by kind and status.
  with
  m as (
    select mt.id, mt.status, mt.ended_reason, mt.reservation_id,
           app.business_date(mt.start_at, v_b.tz, v_b.start_hour)                                    as d,
           mt.reservation_id is not null                                                           as booked,
           coalesce(r.kind = 'booking' and r.status in ('confirmed','arrived','completed'), false) as live,
           coalesce(r.price_iqd, 0)::bigint                                                        as price_iqd
      from matches mt
      left join reservations r on r.id = mt.reservation_id
     where mt.venue_id = any(v_rv) and not mt.sandbox
       and mt.start_at >= v_b.ts_from and mt.start_at < v_b.ts_to
       and (v_category is null or mt.category = v_category)
       and (v_policy is null or mt.join_policy = v_policy)),
  x as (
    select m.*,
           case when m.live then app.court_fee_paid(m.reservation_id, null) else 0 end::bigint        as paid_iqd,
           case when m.live then app.court_fee_written_off(m.reservation_id, null) else 0 end::bigint as written_off_iqd,
           s.seats, s.account_seats, s.friend_seats, s.desk_seats,
           s.attended_seats, s.no_show_seats, s.left_late_seats, s.refilled_seats
      from m
      cross join lateral (
        select count(*)                                          as seats,
               count(*) filter (where ms.kind = 'account')      as account_seats,
               count(*) filter (where ms.kind = 'friend')       as friend_seats,
               count(*) filter (where ms.kind = 'desk')         as desk_seats,
               count(*) filter (where ms.status = 'attended')   as attended_seats,
               count(*) filter (where ms.status = 'no_show')    as no_show_seats,
               count(*) filter (where ms.status = 'left_late')  as left_late_seats,
               count(*) filter (where ms.status = 'refilled')   as refilled_seats
          from match_seats ms
         where ms.match_id = m.id) s)
  select (select jsonb_build_object(
            'started',           count(*),
            'booked',            count(*) filter (where x.booked),
            'played',            count(*) filter (where x.status = 'played'),
            'bumped',            count(*) filter (where x.status = 'bumped'),
            'expired',           count(*) filter (where x.status = 'expired'),
            'cancelled',         count(*) filter (where x.status = 'cancelled'
                                                    and x.ended_reason is distinct from 'called_off_short'),
            'calledOffShort',    count(*) filter (where x.ended_reason = 'called_off_short'),
            'allNoShow',         count(*) filter (where x.status = 'no_show'),
            'fillRatePct',       case when count(*) > 0
                                      then round(count(*) filter (where x.booked) * 100.0 / count(*), 1) end,
            'seatsFilled',       coalesce(sum(x.seats), 0)::bigint,
            'accountSeats',      coalesce(sum(x.account_seats), 0)::bigint,
            'friendSeats',       coalesce(sum(x.friend_seats), 0)::bigint,
            'deskSeats',         coalesce(sum(x.desk_seats), 0)::bigint,
            'attendedSeats',     coalesce(sum(x.attended_seats), 0)::bigint,
            'noShowSeats',       coalesce(sum(x.no_show_seats), 0)::bigint,
            'leftLateSeats',     coalesce(sum(x.left_late_seats), 0)::bigint,
            'refilledSeats',     coalesce(sum(x.refilled_seats), 0)::bigint,
            'bookedIqd',         coalesce(sum(x.price_iqd) filter (where x.live), 0)::bigint,
            'deskPaidIqd',       coalesce(sum(x.paid_iqd), 0)::bigint,
            'writtenOffIqd',     coalesce(sum(x.written_off_iqd), 0)::bigint,
            'ticketForfeitsIqd', (v_tk ->> 'forfeitsIqd')::bigint,
            'sandboxExcluded',   v_sandbox)
            from x),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'date',          y.d,
                   'started',       y.started,
                   'booked',        y.booked,
                   'bookedIqd',     y.booked_iqd,
                   'writtenOffIqd', y.written_off_iqd,
                   'noShowSeats',   y.no_show_seats) order by y.d), '[]'::jsonb)
            from (select x.d,
                         count(*)                                                  as started,
                         count(*) filter (where x.booked)                          as booked,
                         coalesce(sum(x.price_iqd) filter (where x.live), 0)::bigint as booked_iqd,
                         coalesce(sum(x.written_off_iqd), 0)::bigint                as written_off_iqd,
                         coalesce(sum(x.no_show_seats), 0)::bigint                  as no_show_seats
                    from x
                   group by x.d) y)
    into v_totals, v_by_day;

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'totals',  v_totals,
    'tickets', jsonb_build_object(
                 'soldIqd',          v_tk -> 'soldIqd',
                 'soldTickets',      v_tk -> 'soldTickets',
                 'refundedIqd',      v_tk -> 'refundedIqd',
                 'refundedTickets',  v_tk -> 'refundedTickets',
                 'forfeitsIqd',      v_tk -> 'forfeitsIqd',
                 'forfeitedTickets', v_tk -> 'forfeitedTickets',
                 'liabilityIqd',     v_tk -> 'liabilityIqd',
                 'liabilityTickets', v_tk -> 'liabilityTickets',
                 'chainWide',        jsonb_build_array('soldIqd', 'soldTickets', 'refundedIqd', 'refundedTickets',
                                                       'liabilityIqd', 'liabilityTickets')),
    'byDay',   v_by_day,
    -- The By day table's columns, in the report_courts shape. DRAFT-AR: the
    -- Arabic labels wait for the client's review (CONTINUE.md, client steps).
    'columns', jsonb_build_array(
      jsonb_build_object('key','date',          'labelEn','Day',           'labelAr','اليوم',        'kind','date'),
      jsonb_build_object('key','started',       'labelEn','Started',       'labelAr','المُنشأة',     'kind','count'),
      jsonb_build_object('key','booked',        'labelEn','Booked',        'labelAr','المحجوزة',     'kind','count'),
      jsonb_build_object('key','bookedIqd',     'labelEn','Court price',   'labelAr','سعر الملاعب',  'kind','money'),
      jsonb_build_object('key','writtenOffIqd', 'labelEn','Written off',   'labelAr','المشطوب',      'kind','money'),
      jsonb_build_object('key','noShowSeats',   'labelEn','No-show seats', 'labelAr','مقاعد الغياب', 'kind','count')));
end $report_matches_0265$;

comment on function app.report_matches(date, date, jsonb) is
  '0265 (money.md §7.6). Manager or owner (reports_guard(false)) over app.report_venues(): the open matches starting in a business-day range, sandbox left out, for the Courts report''s Matches view. p_filters: category (open|women|men), joinPolicy (open|approve); another key or value is INVALID_ARGUMENT with the key as detail. {period, totals {started, booked (ever booked a court), played, bumped, expired, cancelled (not called off), calledOffShort, allNoShow, fillRatePct (booked / started, one decimal), seatsFilled, accountSeats, friendSeats, deskSeats, attendedSeats, noShowSeats, leftLateSeats, refilledSeats (seat rows by kind and status), bookedIqd, deskPaidIqd, writtenOffIqd (live match bookings), ticketForfeitsIqd, sandboxExcluded}, tickets {soldIqd, soldTickets, refundedIqd, refundedTickets, forfeitsIqd, forfeitedTickets, liabilityIqd, liabilityTickets, chainWide [the chain-wide keys]} (app.ticket_money_figures, filters not applied), byDay [{date, started, booked, bookedIqd, writtenOffIqd, noShowSeats}], columns}. No names or ids of people. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.report_matches(date, date, jsonb) from public, anon;
grant execute on function app.report_matches(date, date, jsonb) to authenticated;
