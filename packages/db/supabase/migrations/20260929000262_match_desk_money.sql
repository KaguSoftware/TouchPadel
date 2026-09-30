set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0262 match_desk_money — open matches at the desk: seat money (lane Money,
-- docs/design/open-matches/money.md §6, §8, §9, §10) and the desk RPCs (lane
-- DB, db.md §4.7). Build contracts §1.2, §1.5, §1.7, §1.8, §1.10 and rulings
-- R1, R2, R4, R14, R19, R20, R21, R42 (money.md §14 folds its changes into
-- §1).
--
-- Part 1, Money (this part, first in the file):
--
--   1. The engine         app.match_money (the one money engine, §6.2),
--                         app.match_seat_money (its seat rows),
--                         app.court_fee_written_off (§6.3)
--   2. Court money        court_fee_remaining (re-issued from 0106:138: nets
--                         written-off shares), compute_tab_totals (re-issued
--                         from 0211:200: the court line capped by
--                         tabs.court_cap_iqd, R2)
--   3. Desk money writes  match_seat_settle (§6.4), match_link_payment
--                         (§6.5), match_seat_write_off (§6.6, R1: a manager
--                         PIN grant, PIN_GATED_RPCS)
--   4. Reads              booking_bill (re-issued from 0242:1551) and
--                         booking_bill_states (re-issued from 0106:949): the
--                         match block, seat rows and written-off figures
--                         (§6.7); booking_bill's online list scoped to
--                         deposits
--   5. The DF-16 wall     app.trg_match_booking_no_cafe on orders and
--                         tab_adjustments: MATCH_BOOKING_NO_CAFE (R20, §6.8)
--
-- Part 2, DB (after this part): the desk RPCs of db.md §4.7 and DB's
-- re-issues (§4.7.13). desk_match_detail reads app.match_money and
-- app.match_seat_money from Part 1.
--
-- The money lock (R19, §6.1) is DB's primitive app.lock_match_money (0260);
-- it is not re-created here. Every Money writer takes it first, after any day
-- lock and before any other lock (money.md §8):
--
--   match_seat_settle     day_sessions (share) -> match_money_advisory -> tabs
--                         (insert, or FOR UPDATE on an adopted empty tab)
--                         -> settle_tab: tabs -> payments (+ till_shifts
--                         share) -> link inserts
--   match_link_payment    [day_sessions share, closing a live tab] ->
--                         match_money_advisory -> tabs -> [settle_zero_tab:
--                         the same day and tab again] -> link inserts
--   match_seat_write_off  [pin grant] -> match_money_advisory -> app.match_lock
--                         (courts -> the booking row -> hold expiry -> the
--                         branch mutex) -> one seat UPDATE
--
-- Reads (the engine, court_fee_*, compute_tab_totals, booking_bill*) and the
-- R20 guard take no lock. match_money reads matches and match_seats without a
-- lock: a writer that cannot take the money lock (a cancel, a re-price, the
-- sweep) is caught by the settle's court-line check (SEAT_OWED_CHANGED).
--
-- Seat money is never stored: what a seat owes is the engine's answer over
-- matches.shares_iqd, the carriers (app.match_carriers, 0260, R4/R21), the
-- payment_match_seats links (0258) and the booking's court money. Only the
-- manual write-off columns of match_seats are written here (under the money
-- lock and match_lock).

-- ===========================================================================
-- 1. The engine (money.md §6.2, §6.3)
-- ===========================================================================

-- The one money engine. Booking figures (court_fee_written_off, hence
-- court_fee_remaining and every tab's court line) and seat figures
-- (match_seat_money, booking_bill, desk_match_detail) all come from here, so
-- they cannot drift. It never calls court_fee_remaining or compute_tab_totals:
-- no recursion.
create or replace function app.match_money(p_match_id uuid, p_exclude_tab_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $match_money_0262$
declare
  v_m          matches%rowtype;
  v_r          reservations%rowtype;
  v_live       boolean := false;
  v_started    boolean := false;
  v_phase      text := 'not_live';
  v_price      bigint;                 -- M: Σ shares (DF-3)
  v_booking    bigint;                 -- P: the booking's price (moves with DF-4)
  v_rise       bigint := 0;            -- D
  v_fall       bigint := 0;            -- C
  v_paid       bigint := 0;
  v_live_tab   uuid;
  v_tab_paid   bigint := 0;
  v_links      jsonb;
  v_ids        uuid[]    := array_fill(null::uuid, array[4]);
  v_status     text[]    := array_fill(null::text, array[4]);
  v_kind       text[]    := array_fill(null::text, array[4]);
  v_group      text[]    := array_fill(null::text, array[4]);   -- collectable | auto | open
  v_wo_kind    text[]    := array_fill(null::text, array[4]);   -- manual | no_show | left_late | vacant
  v_share      bigint[]  := array_fill(0::bigint, array[4]);
  v_linked     bigint[]  := array_fill(0::bigint, array[4]);    -- L = least(links, S)
  v_credit     bigint[]  := array_fill(0::bigint, array[4]);
  v_sum_l      bigint := 0;
  v_pool       bigint := 0;            -- U
  v_left       bigint := 0;            -- K, spent in the MD-9 order
  v_give       bigint;
  v_delta      bigint := 0;
  v_over       bigint := 0;
  v_owed_t     bigint := 0;
  v_wo_t       bigint := 0;
  v_open_t     bigint := 0;
  v_base       bigint;
  v_owed       bigint;
  v_wo         bigint;
  v_open       bigint;
  v_take       bigint;
  v_seats      jsonb := '[]'::jsonb;
  v_unassigned jsonb := '[]'::jsonb;
  c            record;
  s            record;
  n            int;
begin
  select * into v_m from matches where id = p_match_id;
  if not found then
    return null;
  end if;
  v_price := v_m.price_iqd;

  if v_m.reservation_id is not null then
    select * into v_r from reservations where id = v_m.reservation_id;
    if found then
      v_booking := v_r.price_iqd;
      v_live := v_r.kind = 'booking' and v_r.status in ('confirmed', 'arrived', 'completed')
                and v_r.price_iqd is not null;
      -- What the booking has been paid, excluding a tab the caller is
      -- computing (the filter of court_fee_paid, 0242:1533-1538). Reported
      -- even when the booking is not live: a refund may be due.
      v_paid := app.court_fee_paid(v_r.id, p_exclude_tab_id);
      select t.id into v_live_tab
        from tabs t
       where t.reservation_id = v_r.id and t.status in ('open', 'awaiting_payment')
       limit 1;
      if v_live_tab is not null then
        v_tab_paid := app.tab_net_paid(v_live_tab);
      end if;
    end if;
  end if;
  if v_live then
    v_started := now() >= v_r.start_at;
    v_phase := case when v_started then 'started' else 'booked' end;
    v_rise := greatest(v_booking - v_price, 0);
    v_fall := greatest(v_price - v_booking, 0);
  end if;

  -- links(s): Σ payment_match_seats of the seat over payments whose tab is
  -- settled, not merged and not the excluded one. Gross of refunds (MD-13).
  select coalesce(jsonb_object_agg(l.match_seat_id::text, l.total), '{}'::jsonb)
    into v_links
    from (select pms.match_seat_id, sum(pms.amount_iqd)::bigint as total
            from payment_match_seats pms
            join match_seats ms on ms.id = pms.match_seat_id
            join payments p on p.id = pms.payment_id
            join tabs t on t.id = p.tab_id
           where ms.match_id = p_match_id
             and t.status = 'settled'
             and t.merged_into_tab_id is null
             and t.id is distinct from p_exclude_tab_id
           group by pms.match_seat_id) l;

  -- Per seat number: its carrier (R21) or vacant, and the group it is in.
  for c in select * from app.match_carriers(p_match_id) loop
    n := c.seat_no;
    v_share[n] := coalesce(v_m.shares_iqd[n], 0);
    if c.seat_id is null then
      v_kind[n] := 'vacant';
      if v_started then
        v_group[n] := 'auto';
        v_wo_kind[n] := 'vacant';
      else
        v_group[n] := 'open';
      end if;
    else
      select ms.kind, ms.written_off_at into s from match_seats ms where ms.id = c.seat_id;
      v_ids[n] := c.seat_id;
      v_status[n] := c.status;
      v_kind[n] := s.kind;
      v_linked[n] := least(coalesce((v_links->>c.seat_id::text)::bigint, 0), v_share[n]);
      if c.status in ('in', 'attended') then
        -- A manual write-off stays in the collectable group (MD-11): clearing
        -- one moves no other seat's figure.
        v_group[n] := 'collectable';
        if s.written_off_at is not null then
          v_wo_kind[n] := 'manual';
        end if;
      elsif c.status = 'no_show' then
        v_group[n] := 'auto';
        v_wo_kind[n] := 'no_show';
      elsif v_started then                                  -- left_late after the start
        v_group[n] := 'auto';
        v_wo_kind[n] := 'left_late';
      else                                                  -- left_late before the start
        v_group[n] := 'open';
      end if;
    end if;
    v_sum_l := v_sum_l + v_linked[n];
  end loop;

  -- The pool (MD-9): court money no carrying seat holds, plus a price fall.
  -- It pays a price rise first, then collectable seats from the highest
  -- seat_no down, then automatic write-offs from the highest seat_no down.
  -- Open shares are never credited; what is left is over.
  if v_live then
    v_pool := greatest(v_paid - v_sum_l, 0);
    v_left := v_pool + v_fall;
    v_give := least(v_left, v_rise);
    v_delta := v_rise - v_give;
    v_left := v_left - v_give;
    for n in reverse 4 .. 1 loop
      if v_group[n] = 'collectable' then
        v_give := least(v_left, v_share[n] - v_linked[n]);
        v_credit[n] := v_give;
        v_left := v_left - v_give;
      end if;
    end loop;
    for n in reverse 4 .. 1 loop
      if v_group[n] = 'auto' then
        v_give := least(v_left, v_share[n] - v_linked[n]);
        v_credit[n] := v_give;
        v_left := v_left - v_give;
      end if;
    end loop;
    v_over := v_left;
  end if;

  -- One row per seat number (carrier or vacant) ...
  for n in 1 .. 4 loop
    v_base := v_share[n] - v_linked[n];
    v_owed := 0;
    v_wo := 0;
    v_open := 0;
    v_take := 0;
    if v_live then
      if v_group[n] = 'collectable' and v_wo_kind[n] is null then
        v_owed := v_base - v_credit[n];
        v_take := v_owed;
      elsif v_group[n] = 'collectable' then                 -- manual: Take share collects it
        v_wo := v_base - v_credit[n];
        v_take := v_wo;
      elsif v_group[n] = 'auto' then
        v_wo := v_base - v_credit[n];
      else
        v_open := v_base;
      end if;
    end if;
    v_owed_t := v_owed_t + v_owed;
    v_wo_t := v_wo_t + v_wo;
    v_open_t := v_open_t + v_open;
    v_seats := v_seats || jsonb_build_array(jsonb_build_object(
      'seat_id',         v_ids[n],
      'seat_no',         n,
      'kind',            v_kind[n],
      'status',          v_status[n],
      'carrying',        v_ids[n] is not null,
      'share_iqd',       v_share[n],
      'paid_desk_iqd',   v_linked[n],
      'credit_iqd',      case when v_live then v_credit[n] else 0 end,
      'owed_iqd',        v_owed,
      'written_off_iqd', v_wo,
      'write_off',       case when v_wo > 0 then v_wo_kind[n] end,
      'open_iqd',        v_open,
      'take_iqd',        v_take));
  end loop;

  -- ... then one row per seat that carries nothing (left, removed, cancelled,
  -- refilled, a replaced no_show): only what was linked to it.
  for s in
    select ms.id, ms.seat_no, ms.kind, ms.status
      from match_seats ms
     where ms.match_id = p_match_id
       and ms.id <> all (array_remove(v_ids, null))
     order by ms.seat_no, ms.joined_at, ms.id
  loop
    v_seats := v_seats || jsonb_build_array(jsonb_build_object(
      'seat_id', s.id, 'seat_no', s.seat_no, 'kind', s.kind, 'status', s.status, 'carrying', false,
      'share_iqd', coalesce(v_m.shares_iqd[s.seat_no], 0),
      'paid_desk_iqd', coalesce((v_links->>s.id::text)::bigint, 0),
      'credit_iqd', 0, 'owed_iqd', 0, 'written_off_iqd', 0, 'write_off', null, 'open_iqd', 0, 'take_iqd', 0));
  end loop;

  -- Money the desk can still link (conc-D11): per payment on a settled tab,
  -- what neither the payment nor its tab has linked yet; per payment on a
  -- live court-only tab, the payment net of its refunds.
  if v_live then
    select coalesce(jsonb_agg(jsonb_build_object(
             'payment_id', x.id, 'tab_id', x.tab_id, 'tab_live', x.tab_live, 'method', x.method,
             'amount_iqd', x.amount_iqd, 'unassigned_iqd', x.unassigned, 'created_at', x.created_at)
             order by x.created_at, x.id), '[]'::jsonb)
      into v_unassigned
      from (select p.id, p.tab_id, p.method, p.amount_iqd, p.created_at,
                   t.status <> 'settled' as tab_live,
                   case when t.status = 'settled'
                        then least(
                               p.amount_iqd
                                 - coalesce((select sum(rf.amount_iqd) from refunds rf where rf.payment_id = p.id), 0)
                                 - coalesce((select sum(l.amount_iqd) from payment_match_seats l where l.payment_id = p.id), 0),
                               t.court_iqd
                                 - coalesce((select sum(l.amount_iqd)
                                               from payment_match_seats l
                                               join payments p2 on p2.id = l.payment_id
                                              where p2.tab_id = t.id), 0))
                        else p.amount_iqd
                               - coalesce((select sum(rf.amount_iqd) from refunds rf where rf.payment_id = p.id), 0)
                   end::bigint as unassigned
              from payments p
              join tabs t on t.id = p.tab_id
             where t.reservation_id = v_r.id
               and t.merged_into_tab_id is null
               and t.id is distinct from p_exclude_tab_id
               and (t.status = 'settled'
                    or (t.status in ('open', 'awaiting_payment')
                        and not exists (select 1 from orders o where o.tab_id = t.id)))) x
     where x.unassigned > 0;
  end if;

  return jsonb_build_object(
    'match_id',          v_m.id,
    'reservation_id',    v_m.reservation_id,
    'phase',             v_phase,
    'price_iqd',         v_price,
    'booking_price_iqd', v_booking,
    'price_delta_iqd',   case when v_live then v_booking - v_price else 0 end,
    'paid_iqd',          v_paid,
    'live_tab_paid_iqd', v_tab_paid,
    'desk_paid_iqd',     v_paid + v_tab_paid,
    'unassigned_iqd',    v_pool,
    'delta_owed_iqd',    v_delta,
    'owed_iqd',          v_owed_t,
    'written_off_iqd',   v_wo_t,
    'open_iqd',          v_open_t,
    'over_iqd',          v_over,
    'seats',             v_seats,
    'unassigned',        v_unassigned);
end $match_money_0262$;

comment on function app.match_money(uuid, uuid) is
  '0262. Internal (money.md §6.2, MD-9). The one open-match money engine: per seat number (carrier or vacant, app.match_carriers) and per non-carrying seat, share, paid at the desk (payment_match_seats links on settled tabs, gross), pool credit, owed, written off (manual | no_show | left_late | vacant), open and take; the booking''s paid, live-tab paid, unassigned, delta, owed, written-off, open and over figures; and unassigned[] (money the desk can still link). p_exclude_tab_id leaves one tab out, as court_fee_paid does. A booking that is not live (none, sandbox, called off, cancelled, all no-show) owes, writes off and credits nothing. NULL for an unknown match. Stable, no locks; never calls court_fee_remaining or compute_tab_totals.';

revoke all on function app.match_money(uuid, uuid) from public, anon, authenticated;

-- The engine's seat rows as a table: desk_match_detail's seats[].money
-- (db.md §4.7.3) and the tests read it.
create or replace function app.match_seat_money(p_match_id uuid)
returns table (seat_id uuid, seat_no smallint, kind text, status text, carrying boolean, share_iqd bigint,
               paid_desk_iqd bigint, credit_iqd bigint, owed_iqd bigint, written_off_iqd bigint,
               write_off text, open_iqd bigint, take_iqd bigint)
language sql stable security definer set search_path = public as $match_seat_money_0262$
  select x.seat_id, x.seat_no, x.kind, x.status, x.carrying, x.share_iqd, x.paid_desk_iqd, x.credit_iqd,
         x.owed_iqd, x.written_off_iqd, x.write_off, x.open_iqd, x.take_iqd
    from jsonb_to_recordset(app.match_money(p_match_id, null)->'seats')
      as x(seat_id uuid, seat_no smallint, kind text, status text, carrying boolean, share_iqd bigint,
           paid_desk_iqd bigint, credit_iqd bigint, owed_iqd bigint, written_off_iqd bigint,
           write_off text, open_iqd bigint, take_iqd bigint)
$match_seat_money_0262$;

comment on function app.match_seat_money(uuid) is
  '0262. Internal (money.md §6.2, §1.5). The seat rows of app.match_money(match, NULL) as a table: one per seat number 1..4 (the carrier, or kind vacant with seat_id NULL), then one per non-carrying seat (carrying false). desk_match_detail reads seats[].money from it.';

revoke all on function app.match_seat_money(uuid) from public, anon, authenticated;

-- The shares nobody pays (no-show, unrefilled late leave, vacant number after
-- the start, manual write-off), as booking money. One probe of
-- matches_reservation_key for a booking with no match.
create or replace function app.court_fee_written_off(p_reservation_id uuid, p_exclude_tab_id uuid default null)
returns bigint
language sql stable security definer set search_path = public as $court_fee_written_off_0262$
  select coalesce((
    select least((app.match_money(m.id, p_exclude_tab_id)->>'written_off_iqd')::bigint,
                 greatest(r.price_iqd - app.court_fee_paid(r.id, p_exclude_tab_id), 0))::bigint
      from matches m
      join reservations r on r.id = m.reservation_id
     where m.reservation_id = p_reservation_id
       and r.kind = 'booking'
       and r.status in ('confirmed', 'arrived', 'completed')
       and r.price_iqd is not null
  ), 0)::bigint
$court_fee_written_off_0262$;

comment on function app.court_fee_written_off(uuid, uuid) is
  '0262. Internal (money.md §6.3). The part of a live open-match booking''s price nobody pays: app.match_money''s written_off_iqd, at most what the booking still owes (price minus court_fee_paid). 0 for a booking with no match or one that is not live. Derived, never stored; court_fee_remaining subtracts it.';

revoke all on function app.court_fee_written_off(uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. Court money (money.md §6.3)
-- ===========================================================================

-- court_fee_remaining: re-issued from 20260917000106_desk_payment.sql:138.
-- One term added: written-off shares are owed by nobody. A booking with no
-- match is unchanged (written off 0).
create or replace function app.court_fee_remaining(p_reservation_id uuid, p_exclude_tab_id uuid default null)
returns bigint
language sql stable security definer set search_path = public as $court_fee_remaining_0262$
  select coalesce((
    select greatest(r.price_iqd - app.court_fee_paid(r.id, p_exclude_tab_id)
                                - app.court_fee_written_off(r.id, p_exclude_tab_id), 0)::bigint
      from reservations r
     where r.id = p_reservation_id
       and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.price_iqd is not null
  ), 0)::bigint
$court_fee_remaining_0262$;

revoke all on function app.court_fee_remaining(uuid, uuid) from public, anon, authenticated;

comment on function app.court_fee_remaining(uuid, uuid) is
  '0106, 0262. The court fee still owed on a booking: price_iqd minus the court_iqd stamped on its OTHER settled tabs (and its online deposit) minus the open-match shares written off (court_fee_written_off), floored at 0; 0 unless the booking is confirmed/arrived/completed. The basis of the court line on every tab (compute_tab_totals). Internal.';

-- compute_tab_totals: re-issued from 20260926000211_cafe_settings_readers_per_venue.sql:200.
-- The court line only (0211:246-250): a tab with court_cap_iqd (R2: a seat
-- settle's tab, or a normal bill closed by match_link_payment) bills at most
-- its cap.
create or replace function app.compute_tab_totals(p_tab_id uuid)
returns table (
  subtotal_iqd bigint,
  discount_iqd bigint,
  tax_iqd      bigint,
  court_iqd    bigint,
  total_iqd    bigint
)
language plpgsql stable security definer set search_path = public as $compute_tab_totals_0262$
declare
  v_subtotal  bigint;
  v_disc_line bigint;
  v_disc_tab  bigint;
  v_discount  bigint;
  v_tab_alloc bigint;
  v_tax       bigint;
  v_court     bigint;
  v_inclusive boolean;
begin
  select coalesce(sum(oi.line_total_iqd), 0) into v_subtotal
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_line
    from tab_adjustments a
    join order_items oi on oi.id = a.order_item_id
    join orders o on o.id = oi.order_id
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and o.tab_id = p_tab_id
     and o.status <> 'voided'
     and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_tab
    from tab_adjustments a
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and a.order_item_id is null;

  v_discount := least(v_disc_line + v_disc_tab, v_subtotal);

  v_tab_alloc := greatest(least(v_disc_tab, v_discount - least(v_disc_line, v_discount)), 0);

  -- 0106: the court fee still OWED on the booking this tab is charged to (D1,
  -- D3). 'pending' holds, cancelled, expired and no-show bookings owe nothing.
  -- 0262 (R2): a tab with court_cap_iqd bills at most its cap.
  select case when t.court_cap_iqd is null then app.court_fee_remaining(t.reservation_id, t.id)
              else least(t.court_cap_iqd, app.court_fee_remaining(t.reservation_id, t.id)) end
    into v_court
    from tabs t
   where t.id = p_tab_id
     and t.reservation_id is not null;
  v_court := coalesce(v_court, 0);

  with grp as (
    select mc.tax_group_id, sum(oi.line_total_iqd) as grp_subtotal
      from order_items oi
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
     group by mc.tax_group_id
  ),
  line_disc as (
    select mc.tax_group_id, sum(a.amount_iqd) as amt
      from tab_adjustments a
      join order_items oi     on oi.id = a.order_item_id and not oi.voided
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where a.tab_id = p_tab_id
       and a.kind in ('discount_percent','discount_amount')
       and o.tab_id = p_tab_id
       and o.status <> 'voided'
     group by mc.tax_group_id
  ),
  base as (
    select g.tax_group_id,
           greatest(g.grp_subtotal - coalesce(ld.amt, 0), 0) as after_line
      from grp g
      left join line_disc ld on ld.tax_group_id = g.tax_group_id
  ),
  alloc as (
    select b.tax_group_id,
           greatest(
             b.after_line
               - round((v_tab_alloc::numeric * b.after_line)
                       / nullif(sum(b.after_line) over (), 0)),
             0) as taxable
      from base b
  )
  select coalesce(sum(
           case when coalesce((select vs.tax_inclusive from venue_settings vs
                                 where vs.venue_id = (select t.venue_id from tabs t where t.id = p_tab_id)), false)
                then round((a.taxable::numeric * tg.rate_bp) / (10000.0 + tg.rate_bp))
                else round((a.taxable::numeric * tg.rate_bp) / 10000.0)
           end), 0)::bigint
    into v_tax
    from alloc a
    join tax_groups tg on tg.id = a.tax_group_id
   where tg.is_active;

  select vs.tax_inclusive into v_inclusive from venue_settings vs
   where vs.venue_id = (select t.venue_id from tabs t where t.id = p_tab_id);

  subtotal_iqd := v_subtotal;
  discount_iqd := v_discount;
  tax_iqd      := v_tax;
  court_iqd    := v_court;
  total_iqd    := greatest(
    v_subtotal - v_discount
      + case when coalesce(v_inclusive, false) then 0 else v_tax end,
    0) + v_court;
  return next;
end $compute_tab_totals_0262$;

revoke all on function app.compute_tab_totals(uuid) from public, anon, authenticated;
grant execute on function app.compute_tab_totals(uuid) to service_role;

comment on function app.compute_tab_totals(uuid) is
  '0053, 0106, 0211, 0262: a tab''s subtotal, discount, tax, court line and total. The court line is what the booking still owes (court_fee_remaining, this tab excluded), capped by tabs.court_cap_iqd when set (R2: a seat settle''s tab, or a normal bill closed by match_link_payment). Court time is outside subtotal_iqd (so percentage discounts apply to goods only) and outside the tax base (tax is per item group, L454-455).';

-- ===========================================================================
-- 3. Desk money writes (money.md §6.4-§6.6)
-- ===========================================================================

-- Take share: one fresh booking tab per desk action, capped at what is taken
-- and settled in the same call (MD-8), then linked to the seats.
create or replace function app.match_seat_settle(
  p_seat_ids           uuid[],
  p_method             payment_method,
  p_expected_owed_iqd  bigint,
  p_tendered_iqd       bigint default null,
  p_amount_iqd         bigint default null,
  p_idempotency_key    text default null,
  p_device_id          text default null
) returns jsonb
language plpgsql security definer set search_path = public as $match_seat_settle_0262$
declare
  v_m        matches%rowtype;
  v_r        reservations%rowtype;
  v_tab      tabs%rowtype;
  v_tab_id   uuid;
  v_matches  uuid[];
  v_found    int;
  v_day      uuid;
  v_replay   jsonb;
  v_mm       jsonb;
  v_row      jsonb;
  v_take     bigint;
  v_sum      bigint := 0;
  v_amount   bigint;
  v_left     bigint;
  v_apply    bigint;
  v_court    bigint;
  v_settle   jsonb;
  v_payment  uuid;
  v_cleared  uuid[] := '{}';
  v_applied  jsonb := '{}'::jsonb;
  v_seat     uuid;
  v_ws       match_seats%rowtype;
  v_out      jsonb := '[]'::jsonb;
  v_result   jsonb;
  v_constraint text;
begin
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_seat_ids is null or coalesce(cardinality(p_seat_ids), 0) = 0 or cardinality(p_seat_ids) > 4
     or array_position(p_seat_ids, null) is not null
     or (select count(distinct x) from unnest(p_seat_ids) x) <> cardinality(p_seat_ids) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_ids';
  end if;
  if p_method is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_method';
  end if;
  if p_expected_owed_iqd is null or p_expected_owed_iqd < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_expected_owed_iqd';
  end if;
  if p_amount_iqd is not null and p_amount_iqd < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_amount_iqd';
  end if;
  -- C16: a money write is always keyed (the signature keeps its default).
  if p_idempotency_key is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  -- Every seat known, all of one match; a sandbox match or one outside the
  -- caller's branches is not found (db.md §4.7).
  select array_agg(distinct s.match_id), count(*) into v_matches, v_found
    from match_seats s where s.id = any (p_seat_ids);
  if v_found <> cardinality(p_seat_ids) or cardinality(v_matches) <> 1 then
    raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_m from matches where id = v_matches[1];
  if v_m.sandbox or not (v_m.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_m.venue_id, 'cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_m.venue_id::text, true);

  -- 0049: claim after the guards, before the day lock and any write.
  v_replay := app.claim_replay(p_idempotency_key, 'match_seat_settle');
  if v_replay is not null then
    return v_replay;
  end if;

  -- Lock order (money.md §8): day_sessions (share) -> the money lock -> tabs.
  v_day := app.current_open_day_locked(v_m.venue_id);
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;
  perform app.lock_match_money(v_m.id);

  select * into v_m from matches where id = v_m.id;
  if v_m.status not in ('booked', 'played') or v_m.reservation_id is null then
    raise exception 'MATCH_NOT_BOOKED' using errcode = 'P0001';
  end if;
  select * into v_r from reservations where id = v_m.reservation_id;
  if not found or v_r.kind <> 'booking' or v_r.status not in ('confirmed', 'arrived', 'completed') then
    raise exception 'MATCH_NOT_BOOKED' using errcode = 'P0001';
  end if;

  -- MD-8: an empty live tab on the booking is adopted; any other live tab
  -- is the normal bill, closed through match_link_payment first.
  select t.id into v_tab_id
    from tabs t
   where t.reservation_id = v_r.id and t.status in ('open', 'awaiting_payment')
   limit 1;
  if v_tab_id is not null then
    select * into v_tab from tabs where id = v_tab_id for update;
    if v_tab.status not in ('open', 'awaiting_payment') then
      v_tab_id := null;                                     -- closed meanwhile: a fresh tab below
    elsif exists (select 1 from orders where tab_id = v_tab.id)
       or exists (select 1 from payments where tab_id = v_tab.id)
       or exists (select 1 from tab_adjustments where tab_id = v_tab.id) then
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = v_tab.id::text,
        hint = 'this booking has an open bill; assign it to the seats first';
    end if;
  end if;

  -- What the picked seats owe now, in this statement's snapshot.
  v_mm := app.match_money(v_m.id, null);
  foreach v_seat in array p_seat_ids loop
    select e into v_row from jsonb_array_elements(v_mm->'seats') e where e->>'seat_id' = v_seat::text;
    v_take := coalesce((v_row->>'take_iqd')::bigint, 0);
    if v_take = 0 then
      raise exception 'NOTHING_OWED' using errcode = 'P0001', detail = v_seat::text;
    end if;
    v_sum := v_sum + v_take;
  end loop;
  if v_sum <> p_expected_owed_iqd then
    raise exception 'SEAT_OWED_CHANGED' using errcode = 'P0001',
      detail = format('expected %s, now %s', p_expected_owed_iqd, v_sum),
      hint = 'what these seats owe changed since it was shown; read it again';
  end if;
  if p_amount_iqd is not null and p_amount_iqd > v_sum then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001',
      detail = format('owed %s, got %s', v_sum, p_amount_iqd);
  end if;
  v_amount := coalesce(p_amount_iqd, v_sum);

  -- MD-11: collecting a share clears its manual write-off.
  for v_ws in
    select * from match_seats where id = any (p_seat_ids) and written_off_at is not null order by seat_no, id
  loop
    update match_seats
       set written_off_by_staff_id = null, written_off_at = null, write_off_reason = null
     where id = v_ws.id;
    perform app.write_audit('match.seat_write_off_cleared', 'match_seats', v_ws.id::text,
                            jsonb_build_object('written_off_at', v_ws.written_off_at,
                                               'written_off_by_staff_id', v_ws.written_off_by_staff_id,
                                               'write_off_reason', v_ws.write_off_reason),
                            null, v_ws.write_off_reason, null, p_device_id);
    v_cleared := v_cleared || v_ws.id;
  end loop;

  -- The tab: a fresh one at the match's branch and open day, capped at what
  -- is taken (R2), or the adopted empty live tab with the same cap.
  if v_tab_id is null then
    begin
      insert into tabs (venue_id, day_session_id, reservation_id, opened_by_staff_id, device_id, kind,
                        court_cap_iqd)
      values (v_m.venue_id, v_day, v_r.id, auth.uid(), p_device_id, 'cafe', v_amount)
      returning * into v_tab;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'tabs_one_live_per_reservation' then
        raise;
      end if;
      -- A normal bill opened meanwhile: adopt it when empty (G12).
      select t.id into v_tab_id
        from tabs t
       where t.reservation_id = v_r.id and t.status in ('open', 'awaiting_payment')
       limit 1;
      select * into v_tab from tabs where id = v_tab_id for update;
      if v_tab.id is null
         or exists (select 1 from orders where tab_id = v_tab.id)
         or exists (select 1 from payments where tab_id = v_tab.id)
         or exists (select 1 from tab_adjustments where tab_id = v_tab.id) then
        raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = coalesce(v_tab.id::text, ''),
          hint = 'this booking has an open bill; assign it to the seats first';
      end if;
    end;
  end if;
  if v_tab.court_cap_iqd is distinct from v_amount then
    update tabs set court_cap_iqd = v_amount where id = v_tab.id returning * into v_tab;
  end if;

  -- The net for writers that cannot take the money lock (a cancel, a
  -- re-price, the sweep): the tab must bill exactly what is taken.
  select t.court_iqd into v_court from app.compute_tab_totals(v_tab.id) t;
  if v_court is distinct from v_amount then
    raise exception 'SEAT_OWED_CHANGED' using errcode = 'P0001',
      detail = format('expected %s, now %s', v_amount, coalesce(v_court, 0)),
      hint = 'what these seats owe changed since it was shown; read it again';
  end if;

  -- 0106's till path: TENDER_SHORT, TENDER_CARD, the till-shift stamp.
  v_settle := app.settle_tab(v_tab.id, p_method, p_tendered_iqd, v_amount, p_idempotency_key, p_device_id,
                             v_amount);
  if coalesce((v_settle->>'duplicate')::boolean, false) or v_settle->>'status' <> 'settled' then
    -- The key already names another payment (a plain settle_tab of the same
    -- caller): never link seats to it.
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
      hint = 'that key belongs to another payment';
  end if;
  v_payment := (v_settle->>'payment_id')::uuid;

  -- The links: v_amount spread over the seats in the order given, each up to
  -- what it owed (MD-12: append-only).
  v_left := v_amount;
  foreach v_seat in array p_seat_ids loop
    select e into v_row from jsonb_array_elements(v_mm->'seats') e where e->>'seat_id' = v_seat::text;
    v_apply := least(v_left, (v_row->>'take_iqd')::bigint);
    if v_apply > 0 then
      insert into payment_match_seats (payment_id, match_seat_id, venue_id, amount_iqd, linked_by)
      values (v_payment, v_seat, v_m.venue_id, v_apply, auth.uid());
    end if;
    v_applied := v_applied || jsonb_build_object(v_seat::text, v_apply);
    v_left := v_left - v_apply;
  end loop;

  v_mm := app.match_money(v_m.id, null);
  foreach v_seat in array p_seat_ids loop
    select e into v_row from jsonb_array_elements(v_mm->'seats') e where e->>'seat_id' = v_seat::text;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
               'seat_id', v_seat, 'seat_no', (v_row->>'seat_no')::int,
               'applied_iqd', (v_applied->>v_seat::text)::bigint,
               'owed_iqd', (v_row->>'owed_iqd')::bigint));
  end loop;

  v_result := jsonb_build_object(
    'duplicate',             false,
    'payment_id',            v_payment,
    'tab_id',                v_tab.id,
    'amount_iqd',            v_amount,
    'change_iqd',            (v_settle->>'change_iqd')::bigint,
    'seats',                 v_out,
    'cleared_write_offs',    to_jsonb(v_cleared),
    'booking_remaining_iqd', app.court_fee_remaining(v_r.id, null));
  perform app.write_audit('match.seat_settle', 'matches', v_m.id::text, null,
                          jsonb_build_object('match_id', v_m.id, 'payment_id', v_payment, 'tab_id', v_tab.id,
                                             'method', p_method, 'amount_iqd', v_amount, 'seats', v_out,
                                             'cleared_write_offs', to_jsonb(v_cleared)),
                          null, null, p_device_id);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $match_seat_settle_0262$;

comment on function app.match_seat_settle(uuid[], payment_method, bigint, bigint, bigint, text, text) is
  '0262 (money.md §6.4, MD-8, MD-11). Take share: cashier, court_desk, manager, owner at the match''s branch (not shop_staff), online only. Settles one fresh booking tab (or an adopted empty live one) capped at the amount taken (tabs.court_cap_iqd, R2) and links the payment to the picked seats in the order given. p_expected_owed_iqd is the sum of their take_iqd; a part payment (p_amount_iqd below it) still settles its tab. Collecting a manually written-off share clears the write-off. Refusals in order: FORBIDDEN; INVALID_ARGUMENT (p_seat_ids 1..4 distinct, p_method, p_expected_owed_iqd >= 1, p_amount_iqd >= 1, p_idempotency_key required); SEAT_NOT_FOUND (unknown, two matches, sandbox, another branch''s); VENUE_MISMATCH; a replay returns the stored result, IDEMPOTENCY_CONFLICT; NO_OPEN_DAY; then under the money lock MATCH_NOT_BOOKED; BOOKING_TAB_OPEN (detail the tab id); NOTHING_OWED (detail the seat id); SEAT_OWED_CHANGED (detail expected X, now Y); INVALID_AMOUNT; settle_tab''s TENDER_SHORT, TENDER_CARD. Returns {duplicate, payment_id, tab_id, amount_iqd, change_iqd, seats[{seat_id, seat_no, applied_iqd, owed_iqd}], cleared_write_offs[], booking_remaining_iqd}.';

revoke all on function app.match_seat_settle(uuid[], payment_method, bigint, bigint, bigint, text, text) from public, anon;
grant execute on function app.match_seat_settle(uuid[], payment_method, bigint, bigint, bigint, text, text) to authenticated;

-- Assign: attributes a payment taken on the booking's normal bill to seats,
-- or closes that bill as booking-level money (C22).
create or replace function app.match_link_payment(
  p_payment_id      uuid,
  p_allocations     jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $match_link_payment_0262$
declare
  v_pay        payments%rowtype;
  v_tab        tabs%rowtype;
  v_m          matches%rowtype;
  v_r          reservations%rowtype;
  v_replay     jsonb;
  v_day        uuid;
  v_item       jsonb;
  v_seat       uuid;
  v_amount     bigint;
  v_seat_no    smallint;
  v_share      bigint;
  v_net        bigint;
  v_closed     boolean := false;
  v_links      jsonb := '[]'::jsonb;
  v_refunds    bigint;
  v_unassigned bigint;
  v_result     jsonb;
  v_uuid_re    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- C16: a money write is always keyed.
  if p_idempotency_key is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  -- 0..4 items {seat_id, amount_iqd >= 1}, one per seat ([] only closes a
  -- live court-only bill, C22).
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) > 4 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_allocations';
  end if;
  for v_item in select e from jsonb_array_elements(p_allocations) e loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'seat_id', '') !~ v_uuid_re
       or jsonb_typeof(v_item->'amount_iqd') is distinct from 'number'
       or (v_item->>'amount_iqd') !~ '^[0-9]{1,15}$'
       or (v_item->>'amount_iqd')::bigint < 1 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_allocations';
    end if;
  end loop;
  if (select count(distinct (e->>'seat_id')::uuid) from jsonb_array_elements(p_allocations) e)
     <> jsonb_array_length(p_allocations) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_allocations';
  end if;

  select * into v_pay from payments where id = p_payment_id;
  if not found or not (v_pay.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_pay.venue_id, 'cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_pay.venue_id::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'match_link_payment');
  if v_replay is not null then
    return v_replay;
  end if;

  -- Unlocked reads: the payment's tab, its booking's match.
  select * into v_tab from tabs where id = v_pay.tab_id;
  select * into v_m from matches where reservation_id = v_tab.reservation_id;
  if v_tab.reservation_id is null or v_m.id is null or v_m.sandbox then
    raise exception 'PAYMENT_NOT_ON_MATCH' using errcode = 'P0001';
  end if;
  select * into v_r from reservations where id = v_m.reservation_id;
  if v_m.status not in ('booked', 'played') or v_r.kind <> 'booking'
     or v_r.status not in ('confirmed', 'arrived', 'completed') then
    raise exception 'MATCH_NOT_BOOKED' using errcode = 'P0001';
  end if;
  for v_item in select e from jsonb_array_elements(p_allocations) e loop
    if not exists (select 1 from match_seats s
                    where s.id = (v_item->>'seat_id')::uuid and s.match_id = v_m.id) then
      raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
    end if;
  end loop;

  -- Lock order (money.md §8): the day (only when a live tab will close) ->
  -- the money lock -> the tab.
  if v_tab.status in ('open', 'awaiting_payment') then
    v_day := app.current_open_day_locked(v_m.venue_id);
    if v_day is null then
      raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
    end if;
  end if;
  perform app.lock_match_money(v_m.id);
  select * into v_tab from tabs where id = v_pay.tab_id for update;

  if v_tab.status = 'void' or v_tab.merged_into_tab_id is not null then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = v_tab.status::text;
  end if;
  if v_tab.status in ('open', 'awaiting_payment') then
    v_net := app.tab_net_paid(v_tab.id);
    if v_net <= 0 then
      raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = 'empty',
        hint = 'nothing was paid on this bill; take the shares with match_seat_settle';
    end if;
    -- R2: the normal bill closes at what was paid on it; the rest of the
    -- booking's price goes back to the seats.
    update tabs set court_cap_iqd = v_net where id = v_tab.id;
    begin
      perform app.settle_zero_tab(v_tab.id, 'match_link', null, null);
    exception when raise_exception then
      if sqlerrm = 'REFUND_DUE' then
        raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = 'over_paid',
          hint = 'more was paid on this bill than the booking now owes; a manager refunds the difference first';
      end if;
      raise;
    end;
    select * into v_tab from tabs where id = v_tab.id;
    v_closed := true;
  elsif jsonb_array_length(p_allocations) = 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_allocations',
      hint = 'this bill is already closed; nothing to do';
  end if;

  select coalesce(sum(rf.amount_iqd), 0) into v_refunds from refunds rf where rf.payment_id = v_pay.id;

  -- Each link, checked against what is already linked (the ones before it in
  -- this call included).
  for v_item in select e from jsonb_array_elements(p_allocations) e loop
    v_seat := (v_item->>'seat_id')::uuid;
    v_amount := (v_item->>'amount_iqd')::bigint;
    select c.seat_no into v_seat_no from app.match_carriers(v_m.id) c where c.seat_id = v_seat;
    if not found then
      raise exception 'NOTHING_OWED' using errcode = 'P0001', detail = v_seat::text;
    end if;
    if exists (select 1 from payment_match_seats l where l.payment_id = v_pay.id and l.match_seat_id = v_seat) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'already_linked';
    end if;
    v_share := coalesce(v_m.shares_iqd[v_seat_no], 0);
    if coalesce((select sum(l.amount_iqd) from payment_match_seats l where l.match_seat_id = v_seat), 0)
       + v_amount > v_share then
      raise exception 'AMOUNT_OVER_SEAT' using errcode = 'P0001', detail = v_seat::text;
    end if;
    if coalesce((select sum(l.amount_iqd) from payment_match_seats l where l.payment_id = v_pay.id), 0)
         + v_amount > v_pay.amount_iqd - v_refunds
       or coalesce((select sum(l.amount_iqd)
                      from payment_match_seats l
                      join payments p on p.id = l.payment_id
                     where p.tab_id = v_tab.id), 0) + v_amount > v_tab.court_iqd then
      raise exception 'PAYMENT_OVER_ALLOCATED' using errcode = 'P0001';
    end if;
    insert into payment_match_seats (payment_id, match_seat_id, venue_id, amount_iqd, linked_by)
    values (v_pay.id, v_seat, v_m.venue_id, v_amount, auth.uid());
    v_links := v_links || jsonb_build_array(jsonb_build_object('seat_id', v_seat, 'seat_no', v_seat_no,
                                                               'amount_iqd', v_amount));
  end loop;

  v_unassigned := greatest(least(
    v_pay.amount_iqd - v_refunds
      - coalesce((select sum(l.amount_iqd) from payment_match_seats l where l.payment_id = v_pay.id), 0),
    v_tab.court_iqd
      - coalesce((select sum(l.amount_iqd)
                    from payment_match_seats l
                    join payments p on p.id = l.payment_id
                   where p.tab_id = v_tab.id), 0)), 0);

  v_result := jsonb_build_object('duplicate', false, 'payment_id', v_pay.id, 'tab_id', v_tab.id,
                                 'tab_closed', v_closed, 'links', v_links, 'unassigned_iqd', v_unassigned);
  perform app.write_audit('match.payment_link', 'payments', v_pay.id::text, null,
                          jsonb_build_object('match_id', v_m.id, 'tab_id', v_tab.id, 'tab_closed', v_closed,
                                             'links', v_links));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $match_link_payment_0262$;

comment on function app.match_link_payment(uuid, jsonb, text) is
  '0262 (money.md §6.5, MD-12, C22). Assign: cashier, court_desk, manager, owner, online only. Attributes a payment on an open-match booking''s normal bill to seats (p_allocations [{seat_id, amount_iqd}], 0..4), closing a live court-only bill first at what was paid on it (court_cap_iqd = tab_net_paid, settle_zero_tab); [] only closes it (a DF-4 price rise). Links are append-only. Refusals in order: FORBIDDEN; INVALID_ARGUMENT (p_idempotency_key, p_allocations); PAYMENT_NOT_FOUND; VENUE_MISMATCH; a replay, IDEMPOTENCY_CONFLICT; PAYMENT_NOT_ON_MATCH; MATCH_NOT_BOOKED; SEAT_NOT_FOUND; NO_OPEN_DAY (closing a live bill); then under the money lock PAYMENT_STATE (void | empty | over_paid); INVALID_ARGUMENT p_allocations ([] on a settled bill); per item NOTHING_OWED (not a carrier), INVALID_ARGUMENT already_linked, AMOUNT_OVER_SEAT, PAYMENT_OVER_ALLOCATED. Returns {duplicate, payment_id, tab_id, tab_closed, links[{seat_id, seat_no, amount_iqd}], unassigned_iqd}.';

revoke all on function app.match_link_payment(uuid, jsonb, text) from public, anon;
grant execute on function app.match_link_payment(uuid, jsonb, text) to authenticated;

-- R1: a manager forgives the share of a player who played and walked out (or
-- a staff error). The PIN is proved to app.verify_manager_pin first; this
-- spends the grant (the till's apply_discount model). Undone only by
-- collecting the share (MD-11).
create or replace function app.match_seat_write_off(
  p_seat_id   uuid,
  p_reason    text,
  p_pin       text,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $match_seat_write_off_0262$
declare
  v_s    match_seats%rowtype;
  v_m    matches%rowtype;
  v_r    reservations%rowtype;
  v_auth uuid;
  v_row  jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('walked_out', 'staff_error', 'other') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'walked_out, staff_error or other';
  end if;
  select * into v_s from match_seats where id = p_seat_id;
  if not found then
    raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_m from matches where id = v_s.match_id;
  if v_m.sandbox or not (v_m.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_m.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_m.venue_id::text, true);

  -- Already forgiven: answered before the grant is spent.
  if v_s.written_off_at is not null then
    select e into v_row from jsonb_array_elements(app.match_money(v_m.id, null)->'seats') e
     where e->>'seat_id' = p_seat_id::text;
    return jsonb_build_object('duplicate', true, 'seat_id', v_s.id, 'seat_no', v_s.seat_no,
                              'written_off_iqd', coalesce((v_row->>'written_off_iqd')::bigint, 0),
                              'booking_remaining_iqd', app.court_fee_remaining(v_m.reservation_id, null));
  end if;

  -- 0115: p_pin is never read here; without a fresh grant this is
  -- PIN_GRANT_REQUIRED whatever it says.
  v_auth := app.consume_pin_grant(p_device_id);

  -- money lock -> courts -> the booking row -> hold expiry -> the branch
  -- mutex (R19, R15; conc-D4).
  perform app.lock_match_money(v_m.id);
  v_m := app.match_lock(v_m.id);

  select * into v_r from reservations where id = v_m.reservation_id;
  if v_m.status not in ('booked', 'played') or v_r.id is null or v_r.kind <> 'booking'
     or v_r.status not in ('confirmed', 'arrived', 'completed') then
    raise exception 'MATCH_NOT_BOOKED' using errcode = 'P0001';
  end if;
  if now() < v_r.start_at then
    raise exception 'SEAT_NOT_STARTED' using errcode = 'P0001';
  end if;
  select * into v_s from match_seats where id = p_seat_id;
  if v_s.written_off_at is not null then
    select e into v_row from jsonb_array_elements(app.match_money(v_m.id, null)->'seats') e
     where e->>'seat_id' = p_seat_id::text;
    return jsonb_build_object('duplicate', true, 'seat_id', v_s.id, 'seat_no', v_s.seat_no,
                              'written_off_iqd', coalesce((v_row->>'written_off_iqd')::bigint, 0),
                              'booking_remaining_iqd', app.court_fee_remaining(v_r.id, null));
  end if;
  -- A no-show, a late leave and a vacant number are written off on their own;
  -- only a carrier in or attended that still owes is forgiven by hand.
  select e into v_row from jsonb_array_elements(app.match_money(v_m.id, null)->'seats') e
   where e->>'seat_id' = p_seat_id::text;
  if v_s.status not in ('in', 'attended') or not coalesce((v_row->>'carrying')::boolean, false)
     or coalesce((v_row->>'owed_iqd')::bigint, 0) = 0 then
    raise exception 'NOTHING_OWED' using errcode = 'P0001', detail = p_seat_id::text;
  end if;

  update match_seats
     set written_off_by_staff_id = auth.uid(),
         written_off_at          = now(),
         write_off_reason        = p_reason
   where id = p_seat_id;

  select e into v_row from jsonb_array_elements(app.match_money(v_m.id, null)->'seats') e
   where e->>'seat_id' = p_seat_id::text;
  perform app.write_audit('match.seat_write_off', 'match_seats', p_seat_id::text, null,
                          jsonb_build_object('match_id', v_m.id, 'seat_no', v_s.seat_no,
                                             'written_off_iqd', (v_row->>'written_off_iqd')::bigint),
                          p_reason, v_auth, p_device_id);
  return jsonb_build_object('duplicate', false, 'seat_id', v_s.id, 'seat_no', v_s.seat_no,
                            'written_off_iqd', (v_row->>'written_off_iqd')::bigint,
                            'booking_remaining_iqd', app.court_fee_remaining(v_r.id, null));
end $match_seat_write_off_0262$;

comment on function app.match_seat_write_off(uuid, text, text, text) is
  '0262 (money.md §6.6, R1, MD-11). court_desk, manager, owner at the match''s branch, authorised by a manager PIN grant (verify_manager_pin mints it, this spends it; p_pin is never read). Forgives what a carrier seat in or attended still owes after the start: stamps written_off_by_staff_id, written_off_at, write_off_reason (the amount is not stored; a later payment only shrinks it). Undone only by collecting the share (match_seat_settle). Refusals in order: FORBIDDEN; REASON_REQUIRED (walked_out, staff_error, other); SEAT_NOT_FOUND (unknown, sandbox, another branch''s); VENUE_MISMATCH; already written off -> duplicate (no grant spent); PIN_GRANT_REQUIRED; then under the money lock and app.match_lock MATCH_NOT_BOOKED (booked or played, the booking live); SEAT_NOT_STARTED; NOTHING_OWED (not an in or attended carrier, or owes nothing). Audited match.seat_write_off with the authorising manager. Returns {duplicate, seat_id, seat_no, written_off_iqd, booking_remaining_iqd}.';

revoke all on function app.match_seat_write_off(uuid, text, text, text) from public, anon;
grant execute on function app.match_seat_write_off(uuid, text, text, text) to authenticated;

-- ===========================================================================
-- 4. Reads (money.md §6.7)
-- ===========================================================================

-- booking_bill: re-issued from 20260927000242_online_deposit_rpcs.sql:1551,
-- plus court_written_off_iqd, the match block and its seat rows (R14: the
-- staff label, never a phone), the seat links of each settled payment, and
-- the online list scoped to deposits (a ticket row never has a reservation,
-- M8; explicit).
create or replace function app.booking_bill(p_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $booking_bill_0262$
declare
  v_res        reservations%rowtype;
  v_court      courts%rowtype;
  v_live       boolean;
  v_day_open   boolean;
  v_tab        tabs%rowtype;
  v_totals     record;
  v_paid_net   bigint;
  v_live_json  jsonb := null;
  v_court_paid bigint;
  v_remaining  bigint;
  v_refunds    bigint;
  v_refund_due bigint;
  v_settled    jsonb;
  v_online     bigint;
  v_online_list jsonb;
  v_match      matches%rowtype;
  v_mm         jsonb;
  v_match_json jsonb := null;
  v_seats      jsonb := null;
  v_written_off bigint;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_res from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_res.venue_id, 'cashier','court_desk','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  select * into v_court from courts where id = v_res.court_id;

  v_live := v_res.kind = 'booking' and v_res.status in ('confirmed','arrived','completed');
  v_day_open := exists (select 1 from day_sessions where status = 'open' and venue_id = v_res.venue_id);

  select * into v_tab from tabs
   where reservation_id = v_res.id and status in ('open','awaiting_payment')
   limit 1;
  if found then
    select * into v_totals from app.compute_tab_totals(v_tab.id);
    v_paid_net := app.tab_net_paid(v_tab.id);
    v_live_json := jsonb_build_object(
      'id',              v_tab.id,
      'status',          v_tab.status,
      'day_session_id',  v_tab.day_session_id,
      'subtotal_iqd',    v_totals.subtotal_iqd,
      'discount_iqd',    v_totals.discount_iqd,
      'tax_iqd',         v_totals.tax_iqd,
      'court_iqd',       v_totals.court_iqd,
      'total_iqd',       v_totals.total_iqd,
      'paid_iqd',        v_paid_net,
      'due_iqd',         greatest(v_totals.total_iqd - v_paid_net, 0),
      'over_paid_iqd',   greatest(v_paid_net - v_totals.total_iqd, 0),
      -- Units, not rows: two coffees on one line are two items to the guest.
      'item_count',      (select coalesce(sum(oi.qty), 0) from order_items oi join orders o on o.id = oi.order_id
                           where o.tab_id = v_tab.id and o.status <> 'voided' and not oi.voided),
      'has_orders',      exists (select 1 from orders where tab_id = v_tab.id),
      'has_payments',    exists (select 1 from payments where tab_id = v_tab.id),
      'has_adjustments', exists (select 1 from tab_adjustments where tab_id = v_tab.id));
  end if;

  v_court_paid := app.court_fee_paid(v_res.id, null);
  v_remaining  := app.court_fee_remaining(v_res.id, null);
  -- 0242: the part of court_paid that came in online (0 unless live).
  v_online     := case when v_live then app.deposit_net_paid(v_res.id) else 0 end;
  -- 0262: the open-match shares nobody pays (0 without a match).
  v_written_off := app.court_fee_written_off(v_res.id, null);

  select coalesce(sum(rf.amount_iqd), 0) into v_refunds
    from refunds rf
    join payments p on p.id = rf.payment_id
    join tabs t on t.id = p.tab_id
   where t.reservation_id = v_res.id and t.status = 'settled' and t.merged_into_tab_id is null;

  -- Display only ("may be owed back"): what the settled tabs billed for the
  -- court beyond what the booking now costs, less anything already refunded
  -- on those tabs. A refund carries no court/goods split, so this is a prompt
  -- for a manager, never a figure anything else is computed from.
  v_refund_due := greatest(
    v_court_paid - (case when v_live then coalesce(v_res.price_iqd, 0) else 0 end) - v_refunds,
    0);

  select coalesce(jsonb_agg(jsonb_build_object(
           'tab_id',      t.id,
           'settled_at',  t.settled_at,
           'court_iqd',   t.court_iqd,
           'total_iqd',   t.total_iqd,
           'refunds_iqd', (select coalesce(sum(rf.amount_iqd), 0) from refunds rf
                             join payments p2 on p2.id = rf.payment_id where p2.tab_id = t.id),
           'payments',    (select coalesce(jsonb_agg(jsonb_build_object(
                                     'id',               p.id,
                                     'method',           p.method,
                                     'amount_iqd',       p.amount_iqd,
                                     'tendered_iqd',     p.tendered_iqd,
                                     'change_iqd',       p.change_iqd,
                                     'created_at',       p.created_at,
                                     'recorded_by_name', s.display_name,
                                     -- 0262: the open-match seats this payment paid.
                                     'seats',            (select coalesce(jsonb_agg(jsonb_build_object(
                                                                   'seat_no', ms.seat_no, 'amount_iqd', l.amount_iqd)
                                                                   order by ms.seat_no, ms.joined_at), '[]'::jsonb)
                                                            from payment_match_seats l
                                                            join match_seats ms on ms.id = l.match_seat_id
                                                           where l.payment_id = p.id)) order by p.created_at), '[]'::jsonb)
                             from payments p left join staff s on s.id = p.recorded_by
                            where p.tab_id = t.id)
         ) order by t.settled_at), '[]'::jsonb)
    into v_settled
    from tabs t
   where t.reservation_id = v_res.id and t.status = 'settled' and t.merged_into_tab_id is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                bp.id,
           'status',            bp.status,
           'amount_iqd',        bp.amount_iqd,
           'refund_amount_iqd', bp.refund_amount_iqd,
           'refund_reason',     bp.refund_reason,
           'succeeded_at',      bp.succeeded_at,
           'refunded_at',       bp.refunded_at,
           'forfeited',         bp.forfeited_at is not null,
           'sandbox',           bp.sandbox) order by bp.succeeded_at), '[]'::jsonb)
    into v_online_list
    from booking_payments bp
   where bp.reservation_id = v_res.id
     and bp.purpose = 'deposit'
     and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded');

  -- 0262: the open match on this booking (none for any other booking), from
  -- the one engine. Seat labels are staff-facing (the player's, the linked
  -- customer's or the typed walk-in name; a friend seat carries its holder's
  -- name and the operator words it from kind); no phone.
  select * into v_match from matches where reservation_id = v_res.id;
  if found then
    v_mm := app.match_money(v_match.id, null);
    v_match_json := jsonb_build_object(
      'id',                v_match.id,
      'status',            v_match.status,
      'phase',             v_mm->'phase',
      'price_iqd',         v_mm->'price_iqd',
      'booking_price_iqd', v_mm->'booking_price_iqd',
      'price_delta_iqd',   v_mm->'price_delta_iqd',
      'paid_iqd',          v_mm->'paid_iqd',
      'desk_paid_iqd',     v_mm->'desk_paid_iqd',
      'unassigned_iqd',    v_mm->'unassigned_iqd',
      'delta_owed_iqd',    v_mm->'delta_owed_iqd',
      'owed_iqd',          v_mm->'owed_iqd',
      'written_off_iqd',   v_mm->'written_off_iqd',
      'open_iqd',          v_mm->'open_iqd',
      'over_iqd',          v_mm->'over_iqd',
      'unassigned',        v_mm->'unassigned');
    select coalesce(jsonb_agg(x.e || jsonb_build_object(
             'label',            case when x.e->>'kind' = 'vacant' then null
                                      when ms.guest_id is not null then p.full_name
                                      else ms.guest_name end,
             'ticket',           case when ms.ticket_id is null then 'none'
                                      when k.status = 'in_use' and k.seat_id = ms.id then 'in_use'
                                      when k.status = 'forfeited' and k.forfeited_seat_id = ms.id then 'forfeited'
                                      else 'released' end,
             'write_off_reason', ms.write_off_reason) order by x.ord), '[]'::jsonb)
      into v_seats
      from jsonb_array_elements(v_mm->'seats') with ordinality as x(e, ord)
      left join match_seats ms on ms.id = (x.e->>'seat_id')::uuid
      left join profiles p on p.id = ms.guest_id
      left join match_tickets k on k.id = ms.ticket_id;
  end if;

  return jsonb_build_object(
    'reservation', jsonb_build_object(
       'id',            v_res.id,
       'kind',          v_res.kind,
       'status',        v_res.status,
       'price_iqd',     v_res.price_iqd,
       'guest_name',    v_res.guest_name,
       'start_at',      v_res.start_at,
       'end_at',        v_res.end_at,
       'court_id',      v_res.court_id,
       'court_name_en', v_court.name_en,
       'court_name_ar', v_court.name_ar),
    'live',                  v_live,
    'day_open',              v_day_open,
    'live_tab',              v_live_json,
    'court_paid_iqd',        v_court_paid,
    'court_remaining_iqd',   v_remaining,
    'court_refund_due_iqd',  v_refund_due,
    'settled_tabs',          v_settled,
    'online_paid_iqd',       v_online,
    'online_payments',       v_online_list,
    'court_written_off_iqd', v_written_off,
    'match',                 v_match_json,
    'seats',                 v_seats);
end $booking_bill_0262$;

revoke all on function app.booking_bill(uuid) from public, anon;
grant execute on function app.booking_bill(uuid) to authenticated;

comment on function app.booking_bill(uuid) is
  '0106, 0242, 0262. Every money figure for one booking (cashier, court_desk, manager, owner): its live tab with server totals and due, the court fee billed, still owed and written off, what may be owed back, the settled tabs with their payments (and the open-match seats each paid), the online deposits; for an open match''s booking the match block (the money engine''s figures and unassigned[]) and one row per seat with its staff label, ticket state and write-off reason (never a phone). The desk renders this; it computes nothing.';

-- booking_bill_states: re-issued from 20260917000106_desk_payment.sql:949.
-- Rows gain match_id, court_written_off_iqd and, for an open match's booking,
-- seats_owing, seats_paid and seats_owed_iqd (rules-D19). The state
-- vocabulary is unchanged.
create or replace function app.booking_bill_states(p_reservation_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $booking_bill_states_0262$
declare
  v_out     jsonb;
  v_visible uuid[];
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_reservation_ids, 1), 0) > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'at most 500 bookings per call';
  end if;
  -- 0262: only the bookings of the branches in scope (as desk_match_states
  -- and booking_bill's VENUE_MISMATCH): another branch's id drops silently.
  v_visible := app.visible_venue_ids();

  with ids as (
    select distinct unnest(coalesce(p_reservation_ids, '{}'::uuid[])) as id
  ),
  base as (
    select r.id,
           (r.kind = 'booking' and r.status in ('confirmed','arrived','completed')) as live,
           coalesce(r.price_iqd, 0) as price,
           app.court_fee_paid(r.id, null) as court_paid,
           app.court_fee_remaining(r.id, null) as remaining,
           (select t.id from tabs t
             where t.reservation_id = r.id and t.status in ('open','awaiting_payment')
             limit 1) as live_tab_id,
           (select coalesce(sum(rf.amount_iqd), 0) from refunds rf
              join payments p on p.id = rf.payment_id
              join tabs t on t.id = p.tab_id
             where t.reservation_id = r.id and t.status = 'settled' and t.merged_into_tab_id is null) as refunds,
           m.id as match_id,
           case when m.id is not null then app.match_money(m.id, null) end as mm,
           app.court_fee_written_off(r.id, null) as written_off
      from ids
      join reservations r on r.id = ids.id and r.venue_id = any (v_visible)
      left join matches m on m.reservation_id = r.id
  ),
  tabbed as (
    select b.*,
           tt.total_iqd as tab_total,
           case when b.live_tab_id is null then 0 else app.tab_net_paid(b.live_tab_id) end as tab_paid,
           greatest(b.court_paid - case when b.live then b.price else 0 end - b.refunds, 0) as refund_due
      from base b
      left join lateral (select * from app.compute_tab_totals(b.live_tab_id)) tt on b.live_tab_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'reservation_id',       x.id,
           'state',
             case
               when x.live_tab_id is not null then
                 case
                   when x.tab_paid > coalesce(x.tab_total, 0) then 'refund_due'
                   when coalesce(x.tab_total, 0) - x.tab_paid <= 0 then 'dead_open'
                   when x.tab_paid > 0 then 'partly_paid'
                   else 'open'
                 end
               when x.refund_due > 0 then 'refund_due'
               when x.live and x.remaining > 0 and x.court_paid > 0 then 'owed'
               when x.court_paid > 0 and x.remaining = 0 then 'paid'
               else 'none'
             end,
           'live_tab_id',          x.live_tab_id,
           'due_iqd',
             case when x.live_tab_id is not null
                  then greatest(coalesce(x.tab_total, 0) - x.tab_paid, 0)
                  else x.remaining end,
           'court_paid_iqd',       x.court_paid,
           'court_remaining_iqd',  x.remaining,
           'court_refund_due_iqd',
             case when x.live_tab_id is not null and x.tab_paid > coalesce(x.tab_total, 0)
                  then x.tab_paid - coalesce(x.tab_total, 0)
                  else x.refund_due end,
           -- 0262: the open match on the booking (NULL for any other booking).
           'match_id',              x.match_id,
           'court_written_off_iqd', x.written_off,
           'seats_owing',
             case when x.match_id is not null then
               (select count(*) from jsonb_array_elements(x.mm->'seats') e
                 where (e->>'carrying')::boolean and (e->>'owed_iqd')::bigint > 0) end,
           'seats_paid',
             case when x.match_id is not null then
               (select count(*) from jsonb_array_elements(x.mm->'seats') e
                 where (e->>'carrying')::boolean and (e->>'paid_desk_iqd')::bigint > 0
                   and (e->>'owed_iqd')::bigint = 0) end,
           'seats_owed_iqd',
             case when x.match_id is not null then (x.mm->>'owed_iqd')::bigint end)), '[]'::jsonb)
    into v_out
    from tabbed x;

  return v_out;
end $booking_bill_states_0262$;

revoke all on function app.booking_bill_states(uuid[]) from public, anon;
grant execute on function app.booking_bill_states(uuid[]) to authenticated;

comment on function app.booking_bill_states(uuid[]) is
  '0106, 0262. One payment state per booking (none | open | partly_paid | dead_open | paid | owed | refund_due) with due, billed, owed and owed-back figures, the open-match shares written off, and for an open match''s booking its match_id, seats_owing (carriers that owe), seats_paid (carriers paid at the desk that owe nothing) and seats_owed_iqd. At most 500 ids. Cashier, court_desk, manager, owner; only bookings of the branches in scope (app.visible_venue_ids()): another branch''s id gets no row.';

-- ===========================================================================
-- 5. The DF-16 wall (R20, money.md §6.8)
-- ===========================================================================

-- A match booking's tab carries court money only: café orders by match
-- players go on their own café bill, and a share is forgiven only by a
-- write-off (no discount or promotion). Every path is caught here: open_tab
-- + till_add_items, merge_tabs (it moves orders and adjustments), the floor
-- phone (place_floor_order), apply_discount and a promotion, a queued
-- order.create / adjustment.apply replay. An empty court-only tab (the
-- offline path) stays allowed. One probe of matches_reservation_key.
create or replace function app.trg_match_booking_no_cafe() returns trigger
language plpgsql security definer set search_path = public as $trg_match_booking_no_cafe_0262$
begin
  if new.tab_id is not null
     and exists (select 1
                   from tabs t
                   join matches m on m.reservation_id = t.reservation_id
                  where t.id = new.tab_id) then
    raise exception 'MATCH_BOOKING_NO_CAFE' using errcode = 'P0001',
      hint = 'a match player''s café order goes on a café bill of its own';
  end if;
  return new;
end $trg_match_booking_no_cafe_0262$;

comment on function app.trg_match_booking_no_cafe() is
  '0262 (R20, DF-16). Trigger on orders and tab_adjustments (insert, or a move of tab_id): refuses a row on the tab of an open match''s booking with MATCH_BOOKING_NO_CAFE. The booking''s tabs carry court money only; café orders go on their own bill and a share is forgiven only by a write-off.';

revoke all on function app.trg_match_booking_no_cafe() from public, anon, authenticated;

drop trigger if exists orders_match_booking_no_cafe on orders;
create trigger orders_match_booking_no_cafe
  before insert or update of tab_id on orders
  for each row execute function app.trg_match_booking_no_cafe();

drop trigger if exists tab_adjustments_match_booking_no_cafe on tab_adjustments;
create trigger tab_adjustments_match_booking_no_cafe
  before insert or update of tab_id on tab_adjustments
  for each row execute function app.trg_match_booking_no_cafe();

-- Part 2: DB desk
--
-- 0262 match_desk_money, lane DB's half: the desk's open-match RPCs and the
-- customer re-issues (docs/design/open-matches/db.md §4.7; operator.md §5.6,
-- the read shapes the operator builds against, and §5.7, the writes; build
-- contracts §1.7, §1.8, §1.10, rulings R4, R9, R10, R12, R16, R19, R21, R31,
-- R33, R35, R39, R40, R42). Part 1 (lane Money, money.md §6) comes first in
-- the file: desk_match_detail reads its engine, app.match_money(match, NULL).
--
--   1. Internals   match_reason_parts, match_desk_numbers, match_seat_ticket,
--                  desk_start_answer
--   2. Reads       desk_open_matches, desk_match_states, desk_match_detail
--   3. Writes      desk_start_match, desk_add_seat, desk_remove_seat,
--                  desk_cancel_match, mark_match_seats, desk_call_off_short
--   4. Customers   set_match_ban, staff_set_customer_gender,
--      and reports match_reports_open, resolve_match_report
--   5. Re-issues   mark_reservation (0089), set_customer_flags (0242),
--                  customer_counts and customer_record (0065),
--                  customer_search (0077), customer_directory (0148)
--
-- Every staff RPC (db.md §4.7): the role guard is its first statement
-- (FORBIDDEN; "desk" is court_desk, manager and owner); a match outside
-- app.visible_venue_ids(), or a sandbox match, is MATCH_NOT_FOUND
-- (SEAT_NOT_FOUND for a seat, D-10); a write the caller can see but is not
-- is_staff_at is VENUE_MISMATCH, and then app.venue_id is asserted (0217).
-- Reason arguments take R42's form, '<code>' or '<code>: <note>': the code is
-- stored on rows, events and the flag label, the whole text in the audit row.
--
-- Locks (db.md §2.3, §2.5): desk_start_match takes LS (every court of the
-- branch, its stale holds, the branch mutex); desk_cancel_match L1 (the
-- mutex); desk_remove_seat L1+M (the match's money lock, then the mutex);
-- desk_add_seat, mark_match_seats and desk_call_off_short L2+M (the money
-- lock, then app.match_lock: courts -> the booking row -> stale holds -> the
-- mutex). The money lock always comes first (R19), tickets after the mutex.
-- The reads, the ban, the gender correction and the reports take none.

-- ===========================================================================
-- 1. Internals
-- ===========================================================================

-- R42: '<code>' or '<code>: <note>' -> {code, note}. The code is what the
-- caller checks against its list; the note only goes to the audit row.
create or replace function app.match_reason_parts(p_reason text) returns text[]
language plpgsql immutable security definer set search_path = public as $match_reason_parts_0262$
declare
  v_at int;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return array[null, null]::text[];
  end if;
  v_at := position(': ' in p_reason);
  if v_at = 0 then
    return array[btrim(p_reason), null]::text[];
  end if;
  return array[nullif(btrim(left(p_reason, v_at - 1)), ''), nullif(btrim(substr(p_reason, v_at + 2)), '')]::text[];
end $match_reason_parts_0262$;

comment on function app.match_reason_parts(text) is
  '0262. Internal (R42, operator.md §5.13.8): splits a reason sent as <code> or <code>: <note> at the first '': '' into {code, note}, both trimmed, NULL when empty. desk_remove_seat, desk_cancel_match and set_match_ban store only the code and refuse a note over 200 characters.';

revoke all on function app.match_reason_parts(text) from public, anon, authenticated;

-- The seat numbers open for the desk now (db.md §3.2), ascending: a vacant
-- number of a filling match before its deadline; on a booked match before its
-- end, a vacant number, a late leaver's, or (after the start) a no-show's
-- (R4, R21). Empty for a waiting or ended match.
create or replace function app.match_desk_numbers(m matches) returns smallint[]
language sql stable security definer set search_path = public as $match_desk_numbers_0262$
  select coalesce(array_agg(c.seat_no order by c.seat_no), '{}'::smallint[])
    from app.match_carriers(m.id) c
   where (m.status = 'filling' and now() < m.fill_deadline_at and c.seat_id is null)
      or (m.status = 'booked' and now() < m.end_at
          and (c.seat_id is null
               or c.status = 'left_late'
               or (c.status = 'no_show' and now() >= m.start_at)))
$match_desk_numbers_0262$;

comment on function app.match_desk_numbers(matches) is
  '0262. Internal (db.md §3.2, R4, R21): the seat numbers the desk can fill now, ascending. filling before its deadline: the vacant numbers; booked before end_at: a vacant number, a left_late carrier''s, or after the start a no_show carrier''s (the walk-in replaces it). Empty for awaiting_court and ended matches. desk_add_seat takes the first; desk_open_matches, desk_match_states and desk_match_detail count them.';

revoke all on function app.match_desk_numbers(matches) from public, anon, authenticated;

-- A seat's ticket as the desk sees it: {ticket_id, status}, status in_use
-- (on this seat), forfeited (by this seat) or released (it went back);
-- NULL for a desk seat.
create or replace function app.match_seat_ticket(s match_seats) returns jsonb
language sql stable security definer set search_path = public as $match_seat_ticket_0262$
  select case when s.ticket_id is null then null
              else jsonb_build_object(
                     'ticket_id', s.ticket_id,
                     'status', case when k.status = 'in_use' and k.seat_id = s.id then 'in_use'
                                    when k.status = 'forfeited' and k.forfeited_seat_id = s.id then 'forfeited'
                                    else 'released' end) end
    from (select 1) one
    left join match_tickets k on k.id = s.ticket_id
$match_seat_ticket_0262$;

comment on function app.match_seat_ticket(match_seats) is
  '0262. Internal: an account or friend seat''s ticket as the desk reads it, {ticket_id, status}: in_use (in use on this seat), forfeited (forfeited by this seat), else released (back with its holder, whatever it does now); NULL for a desk seat. desk_match_detail.seats[].ticket and mark_match_seats'' ticket_status.';

revoke all on function app.match_seat_ticket(match_seats) from public, anon, authenticated;

-- What desk_start_match answers, fresh or replayed (R24).
create or replace function app.desk_start_answer(m matches, p_duplicate boolean) returns jsonb
language sql stable security definer set search_path = public as $desk_start_answer_0262$
  select jsonb_build_object(
    'duplicate', coalesce(p_duplicate, false),
    'match_id', m.id,
    'status', m.status,
    'share_token', m.share_token,
    'seats', coalesce((select jsonb_agg(jsonb_build_object('seat_id', s.id, 'seat_no', s.seat_no, 'kind', s.kind)
                                        order by s.seat_no)
                         from match_seats s
                        where s.match_id = m.id and s.joined_at = m.created_at
                          and s.created_by_staff_id = m.created_by_staff_id), '[]'::jsonb),
    'price_iqd', m.price_iqd,
    'shares_iqd', to_jsonb(m.shares_iqd),
    'fill_deadline_at', m.fill_deadline_at)
$desk_start_answer_0262$;

comment on function app.desk_start_answer(matches, boolean) is
  '0262. Internal: desk_start_match''s answer for match m, {duplicate, match_id, status, share_token, seats[{seat_id, seat_no, kind}] (the seats the start wrote: joined with the match, by its staff), price_iqd, shares_iqd, fill_deadline_at}. The same shape for a fresh start and a replay of its key.';

revoke all on function app.desk_start_answer(matches, boolean) from public, anon, authenticated;

-- ===========================================================================
-- 2. Reads (db.md §4.7.1-§4.7.3 = operator.md §5.6.1-§5.6.3, R31)
-- ===========================================================================

-- The desk's open matches for a trading night (D12, D18): an envelope, since
-- court_desk cannot call match_settings.
create or replace function app.desk_open_matches(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_open_matches_0262$
declare
  v_visible uuid[];
  v_venue   uuid;
  v_vs      venue_settings%rowtype;
  v_price   bigint;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  elsif p_to is null or p_to <= p_from or p_to - p_from > interval '3 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to';
  end if;

  -- The branch in scope; NULL (the owner's "All branches", or a clerk of two
  -- branches with no station) lists every visible branch with no settings.
  v_visible := app.visible_venue_ids();
  v_venue := app.resolve_venue();
  if v_venue is not null and not (v_venue = any (v_visible)) then
    v_venue := null;
  end if;
  if v_venue is not null then
    select * into v_vs from venue_settings where venue_id = v_venue;
  end if;
  select ps.match_ticket_price_iqd into v_price from platform_settings ps where ps.id;

  return jsonb_build_object(
    'matches_enabled', case when v_venue is null then null else coalesce(v_vs.matches_enabled, false) end,
    'fill_deadline_minutes', v_vs.match_fill_deadline_minutes,
    'earliest_start_minutes', v_vs.match_fill_deadline_minutes + 60,
    'ticket_price_iqd', v_price,
    'server_now', now(),
    'matches', coalesce((
      select jsonb_agg(x.j order by x.start_at, x.id)
        from (select m.id, m.start_at,
                     jsonb_build_object(
                       'match_id', m.id, 'venue_id', m.venue_id, 'status', m.status,
                       'start_at', m.start_at, 'end_at', m.end_at, 'duration_min', m.duration_min,
                       'category', m.category, 'join_policy', m.join_policy, 'visibility', m.visibility,
                       'seats_taken', (select count(*) from app.match_carriers(m.id) c
                                        where c.status in ('in', 'attended')),
                       'seats_left', cardinality(app.match_desk_numbers(m)),
                       'requests_pending', (select count(*) from match_requests q
                                             where q.match_id = m.id and q.status = 'pending'),
                       'fill_deadline_at', m.fill_deadline_at,
                       'organised_by', m.organised_by,
                       'organiser', (select jsonb_build_object('customer_id', p.id, 'full_name', p.full_name,
                                                               'phone', p.phone)
                                       from profiles p where p.id = m.organiser_id),
                       'price_iqd', m.price_iqd,
                       'shares_iqd', to_jsonb(m.shares_iqd),
                       'courts_free_firm', (select count(*) from courts c
                                             where c.venue_id = m.venue_id and c.is_active
                                               and m.duration_min = any (c.duration_options)
                                               and not exists (select 1 from reservations r
                                                                where r.court_id = c.id
                                                                  and r.kind in ('booking', 'maintenance')
                                                                  and r.status in ('pending', 'confirmed', 'arrived')
                                                                  and r.period && m.period)),
                       'courts_total', (select count(*) from courts c
                                         where c.venue_id = m.venue_id and c.is_active
                                           and m.duration_min = any (c.duration_options))) as j
                from matches m
               where m.venue_id = any (case when v_venue is null then v_visible else array[v_venue] end)
                 and not m.sandbox
                 and m.start_at >= p_from and m.start_at < p_to
                 and (m.status in ('filling', 'awaiting_court')
                      or (m.status = 'booked' and now() < m.end_at
                          and cardinality(app.match_desk_numbers(m)) > 0))) x), '[]'::jsonb));
end $desk_open_matches_0262$;

comment on function app.desk_open_matches(timestamptz, timestamptz) is
  '0262 (db.md §4.7.1 = operator.md §5.6.1, D12, D18). Desk (court_desk, manager, owner): {matches_enabled, fill_deadline_minutes, earliest_start_minutes (deadline + 60, OM-43), ticket_price_iqd, server_now, matches[]} for the branch in scope (app.resolve_venue; NULL = every visible branch, and the branch settings NULL). Rows: non-sandbox matches starting in [p_from, p_to) that are filling, awaiting_court, or booked with a number open for the desk before end_at: {match_id, venue_id, status, start_at, end_at, duration_min, category, join_policy, visibility, seats_taken (in or attended carriers), seats_left (numbers open for the desk), requests_pending, fill_deadline_at, organised_by, organiser {customer_id, full_name, phone} | null, price_iqd, shares_iqd, courts_free_firm, courts_total (active courts offering the length)}. INVALID_ARGUMENT for a NULL or a window over 3 days.';

revoke all on function app.desk_open_matches(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function app.desk_open_matches(timestamptz, timestamptz) to authenticated;

-- Match facts for the board and the calendar, keyed by booking (D19; the
-- booking_bill_states batch shape). Money stays in booking_bill_states.
create or replace function app.desk_match_states(p_reservation_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_match_states_0262$
declare
  v_visible uuid[];
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_reservation_ids), 0) > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reservation_ids',
      hint = 'at most 500 bookings per call';
  end if;
  v_visible := app.visible_venue_ids();

  return coalesce((
    select jsonb_object_agg(m.reservation_id::text, jsonb_build_object(
             'match_id', m.id,
             'status', m.status,
             'category', m.category,
             'label', coalesce(nullif(btrim(o.full_name), ''),
                               (select s.guest_name from match_seats s
                                 where s.match_id = m.id and s.kind = 'desk' and s.guest_name is not null
                                 order by s.seat_no, s.joined_at, s.id
                                 limit 1)),
             'organiser_customer_id', m.organiser_id,
             'seats_in', c.n_in,
             'seats_attended', c.n_attended,
             'seats_no_show', c.n_no_show,
             'seats_unmarked', case when now() >= m.start_at then c.n_in else 0 end,
             'seats_left_late', c.n_left_late,
             'open_seats', cardinality(app.match_desk_numbers(m))))
      from matches m
      left join profiles o on o.id = m.organiser_id
      cross join lateral (
        select count(*) filter (where x.status = 'in')        as n_in,
               count(*) filter (where x.status = 'attended')  as n_attended,
               count(*) filter (where x.status = 'no_show')   as n_no_show,
               count(*) filter (where x.status = 'left_late') as n_left_late
          from app.match_carriers(m.id) x) c
     where m.reservation_id = any (coalesce(p_reservation_ids, '{}'::uuid[]))
       and not m.sandbox
       and m.venue_id = any (v_visible)), '{}'::jsonb);
end $desk_match_states_0262$;

comment on function app.desk_match_states(uuid[]) is
  '0262 (db.md §4.7.2 = operator.md §5.6.2, D19). Desk: an object keyed by reservation id, only for the match bookings among p_reservation_ids the caller can see: {match_id, status, category, label (the organiser''s full_name, else the first desk seat''s typed name, else NULL), organiser_customer_id, seats_in, seats_attended, seats_no_show, seats_unmarked (in carriers after the start), seats_left_late, open_seats (numbers open for the desk)}. Money figures stay in booking_bill_states. INVALID_ARGUMENT above 500 ids.';

revoke all on function app.desk_match_states(uuid[]) from public, anon, authenticated;
grant execute on function app.desk_match_states(uuid[]) to authenticated;

-- One match as the desk sees it: operator.md §5.6.3 is the contract (D20);
-- the can flags are the server's word, the operator only mirrors them.
create or replace function app.desk_match_detail(p_match_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_match_detail_0262$
declare
  v_m         matches%rowtype;
  v_r         reservations%rowtype;
  v_court     courts%rowtype;
  v_org       profiles%rowtype;
  v_s         match_seats%rowtype;
  v_p         profiles%rowtype;
  v_mgr       boolean;
  v_started   boolean;
  v_marks     boolean;
  v_live      boolean := false;
  v_carriers  uuid[];
  v_in        int;
  v_attended  int;
  v_absent    int;
  v_free      int;
  v_total     int;
  v_org_seat  uuid;
  v_money     jsonb;
  v_by_seat   jsonb := '{}'::jsonb;
  v_sm        jsonb;
  v_tstatus   text;
  v_ticket    jsonb;
  v_paid      boolean;
  v_carrying  boolean;
  v_holder    uuid;
  v_holder_nm text;
  v_companion int;
  v_reasons   jsonb;
  v_seats     jsonb := '[]'::jsonb;
  v_requests  jsonb;
  v_events    jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_match_id is not null then
    select * into v_m from matches where id = p_match_id;
  end if;
  if v_m.id is null or v_m.sandbox or not (v_m.venue_id = any (app.visible_venue_ids())) then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_mgr := app.is_staff('manager', 'owner');
  v_started := now() >= v_m.start_at;
  v_marks := app.match_marks_open(v_m.id);
  v_carriers := array(select c.seat_id from app.match_carriers(v_m.id) c where c.seat_id is not null);
  select count(*) filter (where c.status = 'in'),
         count(*) filter (where c.status = 'attended'),
         count(*) filter (where c.status in ('no_show', 'left_late'))
    into v_in, v_attended, v_absent
    from app.match_carriers(v_m.id) c;
  select count(*) filter (where not exists (select 1 from reservations r
                                             where r.court_id = c.id
                                               and r.kind in ('booking', 'maintenance')
                                               and r.status in ('pending', 'confirmed', 'arrived')
                                               and r.period && v_m.period)),
         count(*)
    into v_free, v_total
    from courts c
   where c.venue_id = v_m.venue_id and c.is_active and v_m.duration_min = any (c.duration_options);

  -- Money's block exists once there is a booking (D11: Money's names win).
  if v_m.reservation_id is not null then
    select * into v_r from reservations where id = v_m.reservation_id;
    select * into v_court from courts where id = v_r.court_id;
    v_live := v_r.kind = 'booking' and v_r.status in ('confirmed', 'arrived', 'completed');
    v_money := app.match_money(v_m.id, null);
    select coalesce(jsonb_object_agg(x.value->>'seat_id', x.value), '{}'::jsonb)
      into v_by_seat
      from jsonb_array_elements(coalesce(v_money->'seats', '[]'::jsonb)) x
     where x.value->>'seat_id' is not null;
  end if;

  if v_m.organiser_id is not null then
    select * into v_org from profiles where id = v_m.organiser_id;
    select s.id into v_org_seat
      from match_seats s
     where s.id = any (v_carriers) and s.guest_id = v_m.organiser_id and s.kind in ('account', 'desk')
     order by s.seat_no
     limit 1;
  end if;

  -- Every seat: the carriers by number, then the ended seats.
  for v_s in
    select s.* from match_seats s
     where s.match_id = v_m.id
     order by (s.id = any (v_carriers)) desc,
              case when s.id = any (v_carriers) then s.seat_no end,
              s.ended_at nulls last, s.joined_at, s.seat_no, s.id
  loop
    v_carrying := v_s.id = any (v_carriers);
    v_p := null;
    if v_s.guest_id is not null then
      select * into v_p from profiles where id = v_s.guest_id;
    end if;
    v_tstatus := null;
    if v_s.ticket_id is not null then
      select k.status into v_tstatus from match_tickets k where k.id = v_s.ticket_id;
    end if;
    v_ticket := app.match_seat_ticket(v_s);
    v_paid := exists (select 1 from payment_match_seats pm where pm.match_seat_id = v_s.id);
    v_sm := v_by_seat -> (v_s.id::text);

    -- A friend seat is listed under its holder's account seat; a nameless
    -- desk extra under the seat it was started with (companion 1..2).
    v_holder := null;
    v_holder_nm := null;
    v_companion := null;
    if v_s.kind = 'friend' then
      select h.id into v_holder
        from match_seats h
       where h.match_id = v_m.id and h.kind = 'account' and h.guest_id = v_s.guest_id
       order by (h.id = any (v_carriers)) desc, h.joined_at desc, h.id desc
       limit 1;
      v_holder_nm := nullif(btrim(v_p.full_name), '');
      select count(*) into v_companion
        from match_seats f
       where f.match_id = v_m.id and f.kind = 'friend' and f.guest_id = v_s.guest_id
         and f.joined_at = v_s.joined_at and (f.seat_no, f.id) <= (v_s.seat_no, v_s.id);
    elsif v_s.kind = 'desk' and v_s.guest_id is null and v_s.guest_name is null then
      select h.id, coalesce(nullif(btrim(hp.full_name), ''), h.guest_name)
        into v_holder, v_holder_nm
        from match_seats h
        left join profiles hp on hp.id = h.guest_id
       where h.match_id = v_m.id and h.kind = 'desk' and h.joined_at = v_s.joined_at and h.id <> v_s.id
         and (h.guest_id is not null or h.guest_name is not null)
       order by h.seat_no, h.id
       limit 1;
      if v_holder is not null then
        select count(*) into v_companion
          from match_seats f
         where f.match_id = v_m.id and f.kind = 'desk' and f.guest_id is null and f.guest_name is null
           and f.joined_at = v_s.joined_at and (f.seat_no, f.id) <= (v_s.seat_no, v_s.id);
      end if;
    end if;

    -- The desk remove reasons the caller may use on this seat now (§5.13.8).
    v_reasons := case
      when v_s.status <> 'in' then '[]'::jsonb
      when v_m.status in ('filling', 'awaiting_court')
        then '["customer_request", "conduct", "staff_error", "duplicate", "other"]'::jsonb
      when v_m.status = 'booked' and not v_started and v_mgr
        then '["customer_request", "conduct", "staff_error", "duplicate", "other"]'::jsonb
      when v_m.status = 'booked' and not v_started
        then '["customer_request", "conduct", "other"]'::jsonb
      when v_m.status = 'booked' and v_mgr
        then '["staff_error", "duplicate"]'::jsonb
      else '[]'::jsonb end;

    v_seats := v_seats || jsonb_build_array(jsonb_build_object(
      'seat_id', v_s.id, 'seat_no', v_s.seat_no, 'kind', v_s.kind, 'status', v_s.status,
      'end_reason', v_s.end_reason, 'carrying', v_carrying,
      'customer_id', v_s.guest_id,
      'full_name', case when v_s.kind = 'friend' then null
                        when v_s.guest_id is not null then nullif(btrim(v_p.full_name), '')
                        else v_s.guest_name end,
      'display_name', app.match_seat_label(v_s)->>'name',
      'phone', case when v_s.kind = 'friend' then null
                    when v_s.guest_id is not null then v_p.phone
                    else v_s.guest_phone end,
      'holder_seat_id', v_holder, 'holder_name', v_holder_nm, 'companion_no', v_companion,
      'gender', v_s.gender,
      'gender_source', case when v_s.gender is null then null
                            when v_s.kind = 'account' then 'guest'
                            when v_s.kind = 'friend' then 'holder'
                            when v_s.guest_id is not null and v_p.gender = v_s.gender
                                 and v_p.gender_set_by = 'guest' then 'guest'
                            else 'desk' end,
      'vouched', v_s.vouched,
      'flags', case when v_s.kind <> 'friend' and v_s.guest_id is not null
                    then app.customer_flags_json(v_s.guest_id) else '[]'::jsonb end,
      'is_organiser', coalesce(v_s.guest_id = v_m.organiser_id and v_s.kind in ('account', 'desk'), false),
      'joined_at', v_s.joined_at, 'ended_at', v_s.ended_at, 'marked_at', v_s.marked_at,
      'marked_by_name', (select st.display_name from staff st where st.id = v_s.marked_by_staff_id),
      'replaces_seat_id', v_s.replaces_seat_id,
      'replaced_by_seat_id', (select x.id from match_seats x where x.replaces_seat_id = v_s.id
                               order by x.joined_at desc, x.id desc limit 1),
      'ticket', v_ticket,
      'write_off_reason', v_s.write_off_reason,
      'money', case when v_sm is null then null else jsonb_build_object(
                 'share_iqd', v_sm->'share_iqd', 'paid_desk_iqd', v_sm->'paid_desk_iqd',
                 'credit_iqd', v_sm->'credit_iqd', 'owed_iqd', v_sm->'owed_iqd',
                 'written_off_iqd', v_sm->'written_off_iqd', 'write_off', v_sm->'write_off',
                 'open_iqd', v_sm->'open_iqd', 'take_iqd', v_sm->'take_iqd') end,
      'can', jsonb_build_object(
        'mark_attended', coalesce(v_m.status in ('booked', 'played', 'no_show') and v_marks and v_carrying
                                  and v_s.status in ('in', 'no_show'), false),
        'mark_no_show', coalesce(v_m.status in ('booked', 'played') and v_started and v_marks and v_carrying
                                 and not v_paid
                                 and (v_s.status = 'in'
                                      or (v_s.status = 'attended'
                                          and (v_s.ticket_id is null or v_tstatus = 'available'))), false),
        'unmark', coalesce(v_m.status = 'booked' and v_marks and v_carrying
                           and ((v_s.status = 'attended' and (v_s.ticket_id is null or v_tstatus = 'available'))
                                or (v_s.status = 'no_show'
                                    and (v_s.ticket_id is null or v_ticket->>'status' = 'forfeited'
                                         or v_tstatus = 'available'))), false),
        'remove_reasons', v_reasons,
        'take_share', coalesce(v_m.status in ('booked', 'played') and v_live
                               and (v_sm->>'take_iqd')::bigint > 0, false),
        'write_off', coalesce(v_m.status in ('booked', 'played') and v_live and v_started and v_carrying
                              and v_s.status in ('in', 'attended') and v_s.written_off_at is null
                              and (v_sm->>'owed_iqd')::bigint > 0, false),
        'replace', coalesce(v_m.status = 'booked' and v_started and now() < v_m.end_at and v_carrying
                            and v_s.status = 'no_show', false))));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'request_id', q.id, 'customer_id', q.guest_id, 'full_name', p.full_name, 'phone', p.phone,
           'flags', app.customer_flags_json(q.guest_id), 'seats_requested', q.seats_requested,
           'friend_genders', coalesce(to_jsonb(q.friend_genders), '[]'::jsonb),
           'games_played', app.guest_games_played(q.guest_id), 'no_shows', app.guest_match_no_shows(q.guest_id),
           'created_at', q.created_at)
           order by q.created_at, q.id), '[]'::jsonb)
    into v_requests
    from match_requests q
    join profiles p on p.id = q.guest_id
   where q.match_id = v_m.id and q.status = 'pending';

  select coalesce(jsonb_agg(x.j order by x.at desc, x.id desc), '[]'::jsonb)
    into v_events
    from (select e.id, e.at,
                 jsonb_build_object(
                   'at', e.at, 'type', e.type, 'actor', e.actor,
                   'actor_name', case e.actor
                                   when 'staff' then (select st.display_name from staff st where st.id = e.actor_staff_id)
                                   when 'guest' then (select p.full_name from profiles p where p.id = e.actor_guest_id)
                                 end,
                   'seat_no', (select s.seat_no from match_seats s where s.id = e.seat_id),
                   'code', e.code) as j
            from match_events e
           where e.match_id = v_m.id
           order by e.at desc, e.id desc
           limit 50) x;

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', v_m.id, 'venue_id', v_m.venue_id, 'status', v_m.status, 'ended_reason', v_m.ended_reason,
      'start_at', v_m.start_at, 'end_at', v_m.end_at, 'duration_min', v_m.duration_min,
      'category', v_m.category, 'join_policy', v_m.join_policy, 'visibility', v_m.visibility,
      'price_iqd', v_m.price_iqd, 'shares_iqd', to_jsonb(v_m.shares_iqd),
      'fill_deadline_at', v_m.fill_deadline_at, 'share_token', v_m.share_token,
      'organised_by', v_m.organised_by, 'organiser_seat_id', v_org_seat,
      'organiser', case when v_org.id is null then null
                        else jsonb_build_object('customer_id', v_org.id, 'full_name', v_org.full_name,
                                                'phone', v_org.phone,
                                                'flags', app.customer_flags_json(v_org.id)) end,
      'reservation_id', v_m.reservation_id, 'reservation_status', v_r.status, 'court_id', v_r.court_id,
      'court_name_en', v_court.name_en, 'court_name_ar', v_court.name_ar, 'sandbox', v_m.sandbox,
      'courts_free_firm', v_free, 'courts_total', v_total,
      'started', v_started, 'marks_open', v_marks, 'server_now', now(),
      'can', jsonb_build_object(
        'add_seat', cardinality(app.match_desk_numbers(v_m)) > 0,
        'cancel', v_m.status in ('filling', 'awaiting_court'),
        'call_off', v_m.status = 'booked' and v_started and v_marks
                    and v_in = 0 and v_absent > 0 and v_attended > 0)),
    'seats', v_seats,
    'requests', v_requests,
    'money', case when v_money is null then null else jsonb_build_object(
      'phase', v_money->'phase', 'price_iqd', v_money->'price_iqd',
      'booking_price_iqd', v_money->'booking_price_iqd', 'price_delta_iqd', v_money->'price_delta_iqd',
      'paid_iqd', v_money->'paid_iqd', 'live_tab_paid_iqd', v_money->'live_tab_paid_iqd',
      'desk_paid_iqd', v_money->'desk_paid_iqd', 'unassigned_iqd', v_money->'unassigned_iqd',
      'delta_owed_iqd', v_money->'delta_owed_iqd', 'owed_iqd', v_money->'owed_iqd',
      'written_off_iqd', v_money->'written_off_iqd', 'open_iqd', v_money->'open_iqd',
      'over_iqd', v_money->'over_iqd',
      'vacant', (select coalesce(jsonb_agg(jsonb_build_object('seat_no', x.value->'seat_no',
                                                              'open_iqd', x.value->'open_iqd',
                                                              'written_off_iqd', x.value->'written_off_iqd')
                                           order by (x.value->>'seat_no')::int), '[]'::jsonb)
                   from jsonb_array_elements(coalesce(v_money->'seats', '[]'::jsonb)) x
                  where x.value->>'kind' = 'vacant'),
      'unassigned', coalesce(v_money->'unassigned', '[]'::jsonb)) end,
    'events', v_events);
end $desk_match_detail_0262$;

comment on function app.desk_match_detail(uuid) is
  '0262 (db.md §4.7.3 = operator.md §5.6.3, D20, R31). Desk: one match. MATCH_NOT_FOUND when unknown, sandbox or outside the visible branches. {match {id, venue_id, status, ended_reason, start_at, end_at, duration_min, category, join_policy, visibility, price_iqd, shares_iqd, fill_deadline_at, share_token, organised_by, organiser_seat_id, organiser {customer_id, full_name, phone, flags} | null, reservation_id, reservation_status, court_id, court_name_en, court_name_ar (the booked court), sandbox, courts_free_firm, courts_total, started, marks_open, server_now, can {add_seat, cancel, call_off}}, seats[] (carriers by number, then ended seats: identity, holder and companion for friends and nameless desk extras, gender and gender_source, flags, marks, replacement links, ticket {ticket_id, status in_use|forfeited|released} | null, write_off_reason, money (Money''s match_seat_money row) | null, can {mark_attended, mark_no_show, unmark, remove_reasons[], take_share, write_off, replace}), requests[] (pending, with OM-41''s games_played and no_shows), money (app.match_money''s top level with vacant[] and unassigned[]) | null while there is no booking, events[] (the last 50, newest first, with the actor''s name)}. Staff see names and phones; players never read this.';

revoke all on function app.desk_match_detail(uuid) from public, anon, authenticated;
grant execute on function app.desk_match_detail(uuid) to authenticated;

-- ===========================================================================
-- 3. Writes (db.md §4.7.4-§4.7.9; operator.md §5.7)
-- ===========================================================================

-- The desk starts an open match for a customer or a walk-in (OM-29): seat 1
-- and up to two nameless extras, all desk seats (vouched, no ticket). No
-- horizon, degraded, OM-37 or time-clash check: the desk is online and
-- vouches.
create or replace function app.desk_start_match(
  p_start_at        timestamptz,
  p_duration_min    int,
  p_category        text,
  p_visibility      text,
  p_join_policy     text,
  p_customer_id     uuid default null,
  p_guest_name      text default null,
  p_guest_phone     text default null,
  p_gender          text default null,
  p_extra_seats     int default 0,
  p_court_id        uuid default null,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $desk_start_match_0262$
declare
  v_staff    uuid := auth.uid();
  v_venue    uuid;
  v_extra    int := coalesce(p_extra_seats, 0);
  v_name     text := nullif(btrim(coalesce(p_guest_name, '')), '');
  v_phone    text := nullif(btrim(coalesce(p_guest_phone, '')), '');
  v_need     text := case p_category when 'women' then 'female' when 'men' then 'male' end;
  v_p        profiles%rowtype;
  v_gender   text;
  v_m        matches%rowtype;
  v_court    courts%rowtype;
  v_vs       venue_settings%rowtype;
  v_deadline int;
  v_end      timestamptz;
  v_period   tstzrange;
  v_n        int;
  v_rule     uuid;
  v_price    bigint;
  v_shares   bigint[];
  v_token    text;
  v_seat     uuid;
  v_seats    uuid[] := '{}'::uuid[];
  v_i        int;
  v_result   jsonb;
begin
  -- 1.
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 2. The branch named, else the tapped court's, else the caller's.
  v_venue := coalesce(p_venue_id, (select c.venue_id from courts c where c.id = p_court_id), app.current_venue());
  if not app.is_staff_at(v_venue, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  -- 3. The arguments, each by name (D-8: the key is required).
  if p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  elsif p_duration_min is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_duration_min';
  elsif p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  elsif p_category is null or p_category not in ('open', 'women', 'men') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_category';
  elsif p_visibility is null or p_visibility not in ('public', 'link') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_visibility';
  elsif p_join_policy is null or p_join_policy not in ('open', 'approve') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_join_policy';
  elsif p_gender is not null and p_gender not in ('female', 'male') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_gender';
  elsif v_phone is not null and coalesce(app.phone_digits(v_phone), '') !~ '^[0-9]{7,15}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_phone';
  elsif v_name is not null and char_length(v_name) > 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_name';
  elsif p_join_policy = 'approve' and p_customer_id is null then
    -- Approve mode needs an account organiser to approve.
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_join_policy';
  end if;

  -- 4. A replay of this clerk's start answers the same match; the key under
  --    anyone else (another clerk, a guest's start) is a conflict.
  select * into v_m from matches where idempotency_key = p_idempotency_key;
  if found then
    if v_m.created_by_staff_id is distinct from v_staff then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        hint = 'that key belongs to another match';
    end if;
    return app.desk_start_answer(v_m, true);
  end if;

  -- 5. OM-20: the fourth seat is always someone else's.
  if v_extra not between 0 and 2 then
    raise exception 'MATCH_SEAT_LIMIT' using errcode = 'P0001';
  end if;

  -- 6.
  if p_customer_id is null and v_name is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001';
  end if;

  -- 7, 8. A linked customer: a live profile, not banned.
  if p_customer_id is not null then
    select * into v_p from profiles where id = p_customer_id;
    if v_p.id is null or v_p.deleted_at is not null then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
    end if;
    if exists (select 1 from customer_flags f where f.customer_id = v_p.id and f.type = 'match_ban') then
      raise exception 'MATCH_BANNED' using errcode = 'P0001';
    end if;
  end if;

  -- 9. R10.
  select * into v_vs from venue_settings where venue_id = v_venue;
  if not coalesce(v_vs.matches_enabled, false) then
    raise exception 'MATCHES_OFF' using errcode = 'P0001';
  end if;

  -- 10, 11. The price court: the tapped one, else the first active court by
  --         sort order that offers the length.
  if p_court_id is not null then
    select * into v_court from courts where id = p_court_id and venue_id = v_venue and is_active;
    if v_court.id is null then
      raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if not (p_duration_min = any (v_court.duration_options)) then
      raise exception 'INVALID_DURATION' using errcode = 'P0001';
    end if;
  else
    select * into v_court from courts
     where venue_id = v_venue and is_active and p_duration_min = any (duration_options)
     order by sort_order, id
     limit 1;
    if v_court.id is null then
      raise exception 'INVALID_DURATION' using errcode = 'P0001';
    end if;
  end if;

  v_end := p_start_at + make_interval(mins => p_duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');
  v_deadline := coalesce(v_vs.match_fill_deadline_minutes, 120);

  -- 12. Closed dates and opening hours (0026).
  perform app.assert_bookable(v_court.id, p_start_at, v_end);

  -- 13. OM-43 (the past too).
  if p_start_at < now() + make_interval(mins => v_deadline + 60) then
    raise exception 'MATCH_TOO_LATE' using errcode = 'P0001', detail = (v_deadline + 60)::text;
  end if;

  -- 14. OM-7, OM-39: a linked customer's declared gender is theirs; the desk
  --     vouches for an undeclared customer, a walk-in and the extras.
  if v_need is not null
     and ((v_p.gender is not null and v_p.gender <> v_need)
          or (v_p.gender is null and p_gender is distinct from v_need)
          or (v_extra > 0 and p_gender is distinct from v_need)) then
    raise exception 'MATCH_GENDER_MISMATCH' using errcode = 'P0001', detail = 'p_gender';
  end if;
  v_gender := coalesce(v_p.gender, p_gender);

  -- 15. LS: every court of the branch, its stale holds, the branch mutex.
  perform set_config('app.venue_id', v_venue::text, true);
  perform app.match_lock_courts(v_venue);
  perform app.match_expire_holds(v_venue, v_period);
  perform app.lock_match_venue(v_venue);

  -- 16. R24: a double tap waited on the courts; the first start is committed.
  select * into v_m from matches where idempotency_key = p_idempotency_key;
  if found then
    if v_m.created_by_staff_id is distinct from v_staff then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        hint = 'that key belongs to another match';
    end if;
    return app.desk_start_answer(v_m, true);
  end if;

  -- 17. A court offering the length with no firm row (a hold is not firm).
  if not app.match_court_free_firm(v_venue, v_period, p_duration_min, 1) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end if;

  -- 18. OM-42: filling matches over this time never outnumber the free courts.
  select count(*) into v_n from matches x
   where x.venue_id = v_venue and not x.sandbox and x.status in ('filling', 'awaiting_court')
     and x.period && v_period;
  if not app.match_court_free_firm(v_venue, v_period, p_duration_min, v_n + 1) then
    raise exception 'MATCH_SLOT_FULL' using errcode = 'P0001', detail = v_n::text;
  end if;

  -- 19. DF-3: the price court's price, stamped.
  select ps.rule_id, ps.price_iqd into v_rule, v_price
    from app.price_slot(v_court.id, p_start_at, p_duration_min) ps;
  if v_rule is null then
    raise exception 'NO_RATE' using errcode = 'P0001';
  end if;

  v_shares := app.match_shares(v_price);
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
  begin
    insert into matches (venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category,
                         price_iqd, shares_iqd, rate_rule_id, price_court_id, fill_deadline_at, share_token,
                         organiser_id, organised_by, created_by_staff_id, sandbox, idempotency_key)
    values (v_venue, 'filling', p_start_at, v_end, p_duration_min, p_visibility, p_join_policy, p_category,
            v_price, v_shares, v_rule, v_court.id, p_start_at - make_interval(mins => v_deadline), v_token,
            v_p.id, 'desk', v_staff, false, p_idempotency_key)
    returning * into v_m;
  exception when unique_violation then
    -- The key used at another branch and committed while this one waited
    -- (the mutex is per branch): the same answer as 4 and 16.
    select * into v_m from matches where idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    if v_m.created_by_staff_id is distinct from v_staff then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        hint = 'that key belongs to another match';
    end if;
    return app.desk_start_answer(v_m, true);
  end;

  -- Seat 1: the linked customer, or the walk-in the desk typed.
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, guest_name, guest_phone, gender, share_iqd,
                           created_by_staff_id)
  values (v_venue, v_m.id, 1, 'desk', v_p.id,
          case when v_p.id is null then v_name end, case when v_p.id is null then v_phone end,
          v_gender, v_shares[1], v_staff)
  returning id into v_seat;
  v_seats := array_append(v_seats, v_seat);
  -- The extras: nameless desk seats, vouched with p_gender.
  for v_i in 2 .. 1 + v_extra loop
    insert into match_seats (venue_id, match_id, seat_no, kind, gender, share_iqd, created_by_staff_id)
    values (v_venue, v_m.id, v_i, 'desk', p_gender, v_shares[v_i], v_staff)
    returning id into v_seat;
    v_seats := array_append(v_seats, v_seat);
  end loop;
  perform app.match_event(v_m.id, v_venue, 'started', 'staff', v_seats[1], null, null,
                          jsonb_build_object('seats', to_jsonb(v_seats), 'seats_taken', cardinality(v_seats)));

  v_result := app.desk_start_answer(v_m, false);
  perform app.write_audit('match.desk_start', 'matches', v_m.id::text, null,
                          v_result || jsonb_build_object('customer_id', v_p.id, 'category', p_category,
                                                         'join_policy', p_join_policy));
  return v_result;
end $desk_start_match_0262$;

comment on function app.desk_start_match(timestamptz, int, text, text, text, uuid, text, text, text, int, uuid, uuid, text) is
  '0262 (db.md §4.7.4, OM-29). Desk: starts a filling open match (organised_by desk, the caller as created_by_staff_id, organiser_id the linked customer or NULL, never sandbox) with seat 1 (a linked customer, gender from the profile or p_gender, or a typed walk-in with p_gender) and p_extra_seats nameless desk seats; no tickets. Refusals in order: FORBIDDEN; VENUE_MISMATCH (p_venue_id, else the court''s branch, else the caller''s); INVALID_ARGUMENT (NULL time, length or key; an enum; p_gender; the phone format; a name over 80; approve without a customer: p_join_policy); a replay of the caller''s key -> duplicate, anyone else''s IDEMPOTENCY_CONFLICT; MATCH_SEAT_LIMIT (extras outside 0..2); GUEST_REQUIRED; CUSTOMER_NOT_FOUND (unknown or deleted); MATCH_BANNED; MATCHES_OFF; COURT_NOT_FOUND; INVALID_DURATION (with no court: the first active court by sort order offering the length prices it); CLOSED_DATE / OUTSIDE_HOURS; MATCH_TOO_LATE (detail minutes, OM-43, the past too); MATCH_GENDER_MISMATCH (detail p_gender); then under LS: the key again (R24), SLOT_TAKEN, MATCH_SLOT_FULL (detail the overlapping count), NO_RATE. No horizon, degraded, OM-37 or time-clash check. Event started (staff); audit match.desk_start. Returns {duplicate, match_id, status, share_token, seats[], price_iqd, shares_iqd, fill_deadline_at}.';

revoke all on function app.desk_start_match(timestamptz, int, text, text, text, uuid, text, text, text, int, uuid, uuid, text) from public, anon, authenticated;
grant execute on function app.desk_start_match(timestamptz, int, text, text, text, uuid, text, text, text, int, uuid, uuid, text) to authenticated;

-- The desk seats a customer or a walk-in (OM-29, OM-30): the lowest free
-- number of a filling match, or the lowest number open for the desk on a
-- booked one (a late leaver's is refilled; after the start a no-show's is
-- taken over, R4). MATCHES_OFF does not apply (R10).
create or replace function app.desk_add_seat(
  p_match_id        uuid,
  p_customer_id     uuid default null,
  p_guest_name      text default null,
  p_guest_phone     text default null,
  p_gender          text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $desk_add_seat_0262$
declare
  v_staff   uuid := auth.uid();
  v_name    text := nullif(btrim(coalesce(p_guest_name, '')), '');
  v_phone   text := nullif(btrim(coalesce(p_guest_phone, '')), '');
  v_m       matches%rowtype;
  v_p       profiles%rowtype;
  v_need    text;
  v_replay  jsonb;
  v_numbers smallint[];
  v_no      smallint;
  v_c_seat  uuid;
  v_c_stat  text;
  v_repl    uuid;
  v_seat    uuid;
  v_left    match_seats%rowtype;
  v_n       int;
  v_status  text;
  v_result  jsonb;
  v_pass    int;
begin
  -- 1.
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 2. Unknown, another branch's and a sandbox match read the same (D-10).
  if p_match_id is not null then
    select * into v_m from matches where id = p_match_id;
  end if;
  if v_m.id is null or v_m.sandbox or not (v_m.venue_id = any (app.visible_venue_ids())) then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 3.
  if not app.is_staff_at(v_m.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_m.venue_id::text, true);

  -- 4. D-8: the key is required (the signature keeps its default).
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  elsif p_gender is not null and p_gender not in ('female', 'male') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_gender';
  elsif v_phone is not null and coalesce(app.phone_digits(v_phone), '') !~ '^[0-9]{7,15}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_phone';
  elsif v_name is not null and char_length(v_name) > 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_name';
  end if;

  -- 5. A replay answers what the first call answered (0049).
  v_replay := app.claim_replay(p_idempotency_key, 'desk_add_seat');
  if v_replay is not null then
    return v_replay;
  end if;

  -- 6.
  if p_customer_id is null and v_name is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001';
  end if;

  -- 7, 8.
  if p_customer_id is not null then
    select * into v_p from profiles where id = p_customer_id;
    if v_p.id is null or v_p.deleted_at is not null then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
    end if;
    if exists (select 1 from customer_flags f where f.customer_id = v_p.id and f.type = 'match_ban') then
      raise exception 'MATCH_BANNED' using errcode = 'P0001';
    end if;
  end if;
  v_need := case v_m.category when 'women' then 'female' when 'men' then 'male' end;

  -- 9-12 once unlocked, then 9, 11 and 12 again under L2+M: the money lock
  -- (R19), then courts -> the booking row -> stale holds -> the mutex.
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_match_money(v_m.id);
      v_m := app.match_lock(v_m.id);
    end if;

    -- 9. A customer holds one carrier here (desk seats are exempt from R41
    --    and OM-37, not from this).
    if v_p.id is not null
       and exists (select 1 from app.match_carriers(v_m.id) c
                     join match_seats s on s.id = c.seat_id
                    where s.guest_id = v_p.id) then
      raise exception 'MATCH_ALREADY_IN' using errcode = 'P0001';
    end if;

    -- 10. OM-7, OM-39: a declared gender is the customer's; the desk vouches
    --     for an undeclared customer and a walk-in.
    if v_pass = 1 and v_need is not null
       and ((v_p.gender is not null and v_p.gender <> v_need)
            or (v_p.gender is null and p_gender is distinct from v_need)) then
      raise exception 'MATCH_GENDER_MISMATCH' using errcode = 'P0001', detail = 'p_gender';
    end if;

    -- 11. Ended; filling past its deadline; booked from its end on.
    if v_m.status not in ('filling', 'awaiting_court', 'booked')
       or (v_m.status = 'filling' and now() >= v_m.fill_deadline_at)
       or (v_m.status = 'booked' and now() >= v_m.end_at) then
      raise exception 'MATCH_NOT_FILLING' using errcode = 'P0001';
    end if;

    -- 12. Waiting for a court, or no number open for the desk (db.md §3.2).
    v_numbers := app.match_desk_numbers(v_m);
    if v_m.status = 'awaiting_court' or cardinality(v_numbers) = 0 then
      raise exception 'MATCH_FULL' using errcode = 'P0001';
    end if;
  end loop;

  -- The lowest open number. On a booked match the new seat replaces the
  -- number's late leaver (refilled below) or no-show (R4: it keeps its status
  -- and forfeit), else the latest seat that ended on it.
  v_no := v_numbers[1];
  v_c_stat := null;
  if v_m.status = 'booked' then
    select c.seat_id, c.status into v_c_seat, v_c_stat from app.match_carriers(v_m.id) c where c.seat_no = v_no;
    if v_c_seat is not null then
      v_repl := v_c_seat;
    else
      select s.id into v_repl
        from match_seats s
       where s.match_id = v_m.id and s.seat_no = v_no and s.ended_at is not null
       order by s.ended_at desc, s.joined_at desc, s.id desc
       limit 1;
    end if;
  end if;

  begin
    insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, guest_name, guest_phone, gender, share_iqd,
                             replaces_seat_id, created_by_staff_id)
    values (v_m.venue_id, v_m.id, v_no, 'desk', v_p.id,
            case when v_p.id is null then v_name end, case when v_p.id is null then v_phone end,
            coalesce(v_p.gender, p_gender), v_m.shares_iqd[v_no], v_repl, v_staff)
    returning id into v_seat;
  exception when unique_violation then
    -- The occupying (match, number) index is the backstop (R4).
    raise exception 'MATCH_FULL' using errcode = 'P0001';
  end;

  -- OM-11: a refilled late leaver's ticket comes back in this transaction
  -- (released, or restored if the start already forfeited it, situation 19).
  if v_c_stat = 'left_late' then
    select * into v_left from match_seats where id = v_repl;
    update match_seats set status = 'refilled', end_reason = 'refilled' where id = v_left.id;
    if v_left.ticket_id is not null then
      perform app.ticket_release(array[v_left.ticket_id], 'refilled', array[v_left.id]);
      perform app.ticket_restore(v_left.ticket_id, v_left.id, false);
    end if;
    perform app.match_event(v_m.id, v_m.venue_id, 'refilled', 'staff', v_left.id, null, 'refilled',
                            jsonb_build_object('by_seat_id', v_seat));
  end if;

  select count(*) into v_n from app.match_carriers(v_m.id) c where c.status in ('in', 'attended');
  perform app.match_event(v_m.id, v_m.venue_id, 'joined', 'staff', v_seat, null, null,
                          jsonb_build_object('seats', jsonb_build_array(v_seat), 'seats_taken', v_n,
                                             'refill', v_m.status = 'booked'));
  -- OM-34: the organiser left late and this seat took their number.
  if v_c_stat = 'left_late' and v_m.organiser_id is not null and v_left.guest_id = v_m.organiser_id then
    perform app.match_recompute_organiser(v_m.id);
  end if;

  -- The fourth carrier books the court (match_try_book serves waiting matches
  -- first and expires pending requests).
  v_status := v_m.status;
  if v_m.status = 'filling'
     and (select count(*) from app.match_carriers(v_m.id) c where c.seat_id is not null) = 4 then
    v_status := app.match_try_book(v_m.id);
  end if;

  v_result := jsonb_build_object(
    'duplicate', false, 'seat_id', v_seat, 'seat_no', v_no, 'match_status', v_status,
    'replaced_seat_id', v_repl,
    'reservation_id', (select mt.reservation_id from matches mt where mt.id = v_m.id));
  perform app.write_audit('match.desk_add_seat', 'match_seats', v_seat::text, null,
                          v_result || jsonb_build_object('match_id', v_m.id, 'customer_id', v_p.id));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $desk_add_seat_0262$;

comment on function app.desk_add_seat(uuid, uuid, text, text, text, text) is
  '0262 (db.md §4.7.5, R4, R10, R21). Desk: seats a linked customer or a typed walk-in (a desk seat: vouched, no ticket, gender from the profile or p_gender) on the lowest free number of a filling match, or the lowest number open for the desk on a booked one before end_at: a late leaver''s number refills it (refilled, its ticket released or restored), after the start a no-show''s number is taken over (replaces_seat_id; the no-show keeps its status, forfeit and count). The fourth carrier books the court (match_try_book). Refusals in order: FORBIDDEN; MATCH_NOT_FOUND (unknown, sandbox, not visible); VENUE_MISMATCH; INVALID_ARGUMENT (the key required; p_gender; phone; name); a replay of the key (claim_replay) -> the first answer with duplicate true, IDEMPOTENCY_CONFLICT; GUEST_REQUIRED; CUSTOMER_NOT_FOUND; MATCH_BANNED; MATCH_ALREADY_IN (the customer holds a carrier here); MATCH_GENDER_MISMATCH (detail p_gender); MATCH_NOT_FILLING (ended, filling past its deadline, booked from its end); MATCH_FULL (awaiting_court, or no open number); then under L2+M the customer, the status and the numbers again. MATCHES_OFF does not apply (R10). Events refilled and joined (staff), then match_recompute_organiser when the refilled seat was the organiser''s (OM-34); audit match.desk_add_seat. Returns {duplicate, seat_id, seat_no, match_status, replaced_seat_id, reservation_id}.';

revoke all on function app.desk_add_seat(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function app.desk_add_seat(uuid, uuid, text, text, text, text) to authenticated;

-- The desk removes a seat (db.md §4.7.6; operator.md §5.13.8). While filling
-- or waiting the ticket goes back; on a booked match before the start a
-- removal counts as a late leave; a staff error or duplicate (manager, owner)
-- releases at any time. An account seat takes its friends' seats with it.
create or replace function app.desk_remove_seat(p_seat_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $desk_remove_seat_0262$
declare
  v_parts   text[];
  v_code    text;
  v_s       match_seats%rowtype;
  v_m       matches%rowtype;
  v_mgr     boolean;
  v_late    boolean;
  v_targets uuid[];
  v_tickets uuid[];
  v_paired  uuid[];
  v_n       int;
  v_pass    int;
begin
  -- 1.
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 2. R42: the code before the first ': ' is a desk remove reason.
  v_parts := app.match_reason_parts(p_reason);
  v_code := v_parts[1];
  if v_code is null or v_code not in ('customer_request', 'conduct', 'staff_error', 'duplicate', 'other') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'customer_request | conduct | staff_error | duplicate | other, optionally followed by '': <note>''';
  end if;
  if char_length(coalesce(v_parts[2], '')) > 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;

  -- 3.
  if p_seat_id is not null then
    select * into v_s from match_seats where id = p_seat_id;
  end if;
  if v_s.id is not null then
    select * into v_m from matches where id = v_s.match_id;
  end if;
  if v_s.id is null or v_m.sandbox or not (v_m.venue_id = any (app.visible_venue_ids())) then
    raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 4.
  if not app.is_staff_at(v_m.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_m.venue_id::text, true);
  v_mgr := app.is_staff('manager', 'owner');

  -- 5-7 once unlocked, then again under L1+M (the money lock, then the mutex).
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_match_money(v_m.id);
      perform app.lock_match_venue(v_m.venue_id);
      select * into v_m from matches where id = v_m.id;
      select * into v_s from match_seats where id = v_s.id;
    end if;

    -- 5. Already ended by staff with this outcome: a replay.
    if v_s.end_reason = 'removed_by_staff'
       and (v_s.status = 'removed'
            or (v_s.status = 'left_late' and v_code in ('customer_request', 'conduct', 'other'))) then
      return jsonb_build_object(
        'duplicate', true,
        'removed', (select coalesce(jsonb_agg(jsonb_build_object('seat_id', x.id, 'status', x.status)
                                              order by (x.kind = 'account') desc, x.seat_no, x.id), '[]'::jsonb)
                      from match_seats x
                     where x.match_id = v_s.match_id and x.end_reason = 'removed_by_staff'
                       and x.ended_at = v_s.ended_at
                       and (x.id = v_s.id or (v_s.kind = 'account' and x.kind = 'friend'
                                              and x.guest_id = v_s.guest_id))),
        'match_status', v_m.status,
        'ticket', case when v_s.ticket_id is null then 'none'
                       when v_s.status = 'left_late' then 'locked_until_refill'
                       else 'released' end);
    end if;

    -- 6.
    if v_s.status in ('attended', 'no_show') then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'marked',
        hint = 'undo the mark first';
    elsif v_s.status <> 'in' then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'ended';
    elsif v_m.status not in ('filling', 'awaiting_court', 'booked') then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'match_ended';
    elsif v_m.status = 'booked' and now() >= v_m.start_at and v_code not in ('staff_error', 'duplicate') then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'use_attendance',
        hint = 'after the start, mark attended or no-show';
    end if;

    -- 7. §1.7: after booking, a staff error or a duplicate is a manager's call.
    if v_m.status = 'booked' and v_code in ('staff_error', 'duplicate') and not v_mgr then
      raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'manager_required';
    end if;
  end loop;

  -- The account seat takes its holder's friend seats with it.
  v_late := v_m.status = 'booked' and v_code in ('customer_request', 'conduct', 'other');
  select array_agg(s.id order by (s.kind = 'account') desc, s.seat_no, s.id),
         array_agg(s.ticket_id order by s.seat_no, s.id) filter (where s.ticket_id is not null),
         array_agg(s.id order by s.seat_no, s.id) filter (where s.ticket_id is not null)
    into v_targets, v_tickets, v_paired
    from match_seats s
   where s.match_id = v_m.id and s.status = 'in'
     and (s.id = v_s.id or (v_s.kind = 'account' and s.kind = 'friend' and s.guest_id = v_s.guest_id));

  if v_late then
    -- Booked, before the start: a late leave. The tickets stay in use until a
    -- refill releases them or the start forfeits them.
    update match_seats set status = 'left_late', ended_at = now(), end_reason = 'removed_by_staff'
     where id = any (v_targets);
  else
    perform app.ticket_release(v_tickets, 'removed_by_staff', v_paired);
    update match_seats set status = 'removed', ended_at = now(), end_reason = 'removed_by_staff'
     where id = any (v_targets);
  end if;

  -- Removed for conduct: that player cannot rejoin this match.
  if v_code = 'conduct' and v_s.guest_id is not null and v_s.kind in ('account', 'desk') then
    insert into match_exclusions (match_id, guest_id, venue_id, reason)
    values (v_m.id, v_s.guest_id, v_m.venue_id, 'removed_by_staff')
    on conflict (match_id, guest_id) do nothing;
  end if;

  if v_m.status = 'awaiting_court' then
    update matches set status = 'filling', updated_at = now() where id = v_m.id;
  end if;
  select count(*) into v_n from app.match_carriers(v_m.id) c where c.status in ('in', 'attended');
  perform app.match_event(v_m.id, v_m.venue_id, 'removed', 'staff', v_s.id, null, v_code,
                          jsonb_build_object('seats', to_jsonb(v_targets), 'seats_taken', v_n));
  perform app.match_recompute_organiser(v_m.id);
  perform app.write_audit('match.desk_remove_seat', 'match_seats', v_s.id::text,
                          jsonb_build_object('status', 'in', 'match_status', v_m.status),
                          jsonb_build_object('seats', to_jsonb(v_targets),
                                             'status', case when v_late then 'left_late' else 'removed' end,
                                             'reason', v_code),
                          p_reason);

  return jsonb_build_object(
    'duplicate', false,
    'removed', (select coalesce(jsonb_agg(jsonb_build_object('seat_id', x.id, 'status', x.status)
                                          order by (x.kind = 'account') desc, x.seat_no, x.id), '[]'::jsonb)
                  from match_seats x where x.id = any (v_targets)),
    'match_status', (select mt.status from matches mt where mt.id = v_m.id),
    'ticket', case when coalesce(cardinality(v_tickets), 0) = 0 then 'none'
                   when v_late then 'locked_until_refill'
                   else 'released' end);
end $desk_remove_seat_0262$;

comment on function app.desk_remove_seat(uuid, text) is
  '0262 (db.md §4.7.6, R42). Desk: removes a seat (an account seat takes its friends'' seats). p_reason is <code> or <code>: <note> (code customer_request, conduct, staff_error, duplicate, other; the note, at most 200 characters, only in the audit row). Filling or awaiting_court: removed (removed_by_staff), tickets released, a waiting match back to filling. Booked before the start, customer_request/conduct/other: left_late (removed_by_staff), the tickets held until a refill or forfeited at the start. Booked at any time, staff_error/duplicate (manager and owner only): removed, tickets released. conduct excludes the player from the match. Then match_recompute_organiser, event removed (code), audit match.desk_remove_seat. Refusals: FORBIDDEN; REASON_REQUIRED; INVALID_ARGUMENT (detail p_reason); SEAT_NOT_FOUND (unknown, sandbox, not visible); VENUE_MISMATCH; the same removal again -> duplicate; INVALID_TRANSITION (marked, ended, match_ended, use_attendance); FORBIDDEN (detail manager_required); re-checked under L1+M. Returns {duplicate, removed[{seat_id, status}], match_status, ticket: released | locked_until_refill | none}.';

revoke all on function app.desk_remove_seat(uuid, text) from public, anon, authenticated;
grant execute on function app.desk_remove_seat(uuid, text) to authenticated;

-- The desk cancels a filling or waiting match (a booked one is cancelled from
-- its booking, and the reservation trigger follows).
create or replace function app.desk_cancel_match(p_match_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $desk_cancel_match_0262$
declare
  v_parts text[];
  v_code  text;
  v_m     matches%rowtype;
  v_from  text;
  v_pass  int;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- R42.
  v_parts := app.match_reason_parts(p_reason);
  v_code := v_parts[1];
  if v_code is null or v_code not in ('customer_request', 'court_needed', 'staff_error', 'duplicate', 'other') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'customer_request | court_needed | staff_error | duplicate | other, optionally followed by '': <note>''';
  end if;
  if char_length(coalesce(v_parts[2], '')) > 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;

  if p_match_id is not null then
    select * into v_m from matches where id = p_match_id;
  end if;
  if v_m.id is null or v_m.sandbox or not (v_m.venue_id = any (app.visible_venue_ids())) then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_m.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_m.venue_id::text, true);

  -- Once unlocked, then again under L1 (the branch mutex).
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_match_venue(v_m.venue_id);
      select * into v_m from matches where id = v_m.id;
    end if;
    if v_m.status = 'cancelled' and v_m.ended_reason = 'staff_cancelled' then
      return jsonb_build_object('match_id', v_m.id, 'status', 'cancelled', 'duplicate', true);
    end if;
    if v_m.status not in ('filling', 'awaiting_court') then
      raise exception 'MATCH_NOT_FILLING' using errcode = 'P0001',
        hint = 'a booked match is cancelled by cancelling its booking';
    end if;
  end loop;

  v_from := v_m.status;
  perform app.match_end(v_m.id, 'cancelled', 'staff_cancelled', 'staff');
  perform app.write_audit('match.desk_cancel', 'matches', v_m.id::text,
                          jsonb_build_object('status', v_from),
                          jsonb_build_object('status', 'cancelled', 'reason', v_code),
                          p_reason);
  return jsonb_build_object('match_id', v_m.id, 'status', 'cancelled', 'duplicate', false);
end $desk_cancel_match_0262$;

comment on function app.desk_cancel_match(uuid, text) is
  '0262 (db.md §4.7.7, R42). Desk: cancels a filling or awaiting_court match (app.match_end staff_cancelled: seats cancelled, tickets back, pending requests expired). p_reason is <code> or <code>: <note> (customer_request, court_needed, staff_error, duplicate, other). Refusals: FORBIDDEN; REASON_REQUIRED; INVALID_ARGUMENT (detail p_reason, a note over 200); MATCH_NOT_FOUND (unknown, sandbox, not visible); VENUE_MISMATCH; already cancelled by staff -> duplicate; MATCH_NOT_FILLING (booked: cancel the booking; ended); re-checked under the branch mutex. Audit match.desk_cancel with the whole reason. Returns {match_id, status, duplicate}.';

revoke all on function app.desk_cancel_match(uuid, text) from public, anon, authenticated;
grant execute on function app.desk_cancel_match(uuid, text) to authenticated;

-- Attendance per seat (OM-29, R9, R16, R21, C17, C18): arrived, no-show, or
-- the undo (in), for up to four seats of one match in one call. Tickets move
-- with the marks; then the match; then the booking.
create or replace function app.mark_match_seats(p_seat_ids uuid[], p_attendance text) returns jsonb
language plpgsql security definer set search_path = public as $mark_match_seats_0262$
declare
  v_staff    uuid := auth.uid();
  v_m        matches%rowtype;
  v_s        match_seats%rowtype;
  v_t        match_tickets%rowtype;
  v_r_status reservation_status;
  v_carriers uuid[];
  v_changed  uuid[] := '{}'::uuid[];
  v_reopen   boolean;
  v_in       int;
  v_attended int;
  v_no_show  int;
  v_pass     int;
begin
  -- 1.
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 2.
  if p_attendance is null or p_attendance not in ('attended', 'no_show', 'in') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_attendance';
  end if;
  if p_seat_ids is null or cardinality(p_seat_ids) not between 1 and 4
     or array_position(p_seat_ids, null) is not null
     or (select count(distinct x) from unnest(p_seat_ids) x) <> cardinality(p_seat_ids)
     or (select count(distinct s.match_id) from match_seats s where s.id = any (p_seat_ids)) > 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_ids';
  end if;

  -- 3.
  if (select count(*) from match_seats s where s.id = any (p_seat_ids)) <> cardinality(p_seat_ids) then
    raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
  end if;
  select mt.* into v_m
    from matches mt
   where mt.id = (select s.match_id from match_seats s where s.id = p_seat_ids[1]);
  if v_m.id is null or v_m.sandbox or not (v_m.venue_id = any (app.visible_venue_ids())) then
    raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 4.
  if not app.is_staff_at(v_m.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_m.venue_id::text, true);

  -- 5-11 once unlocked, then again under L2+M: the money lock (R19, so a
  -- no-show never lands on a seat a payment is being linked to), then courts
  -- -> the booking row -> stale holds -> the mutex.
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_match_money(v_m.id);
      v_m := app.match_lock(v_m.id);
    end if;

    -- 5.
    if v_m.status not in ('booked', 'played', 'no_show') then
      raise exception 'MATCH_NOT_BOOKED' using errcode = 'P0001';
    end if;
    v_carriers := array(select c.seat_id from app.match_carriers(v_m.id) c where c.seat_id is not null);

    for v_s in select s.* from match_seats s where s.id = any (p_seat_ids) order by s.seat_no, s.id loop
      -- A seat already in the target state is a no-op.
      continue when v_s.status = p_attendance;
      -- 6.
      if v_s.status not in ('in', 'attended', 'no_show') then
        raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'not_carrier';
      end if;
      -- 7. R21: a no-show whose number a walk-in took stays a no-show.
      if v_s.status = 'no_show' and not (v_s.id = any (v_carriers)) then
        raise exception 'SEAT_MARK_LOCKED' using errcode = 'P0001', detail = 'replaced';
      end if;
      -- 8. R16: the undo only while the match is booked.
      if p_attendance = 'in' and v_m.status <> 'booked' then
        raise exception 'SEAT_MARK_LOCKED' using errcode = 'P0001', detail = 'match_ended';
      end if;
      -- 9.
      if p_attendance = 'no_show' and now() < v_m.start_at then
        raise exception 'SEAT_NOT_STARTED' using errcode = 'P0001';
      end if;
      -- 10. C18: a seat that paid is refunded before it can be a no-show.
      if p_attendance = 'no_show'
         and exists (select 1 from payment_match_seats pm where pm.match_seat_id = v_s.id) then
        raise exception 'SEAT_MARK_LOCKED' using errcode = 'P0001', detail = 'paid';
      end if;
    end loop;

    -- 11. R13: marks are final once the match's business day closes.
    if not app.match_marks_open(v_m.id) then
      raise exception 'SEAT_MARK_LOCKED' using errcode = 'P0001', detail = 'day_closed';
    end if;
  end loop;

  -- 12. Every available ticket this call can touch, in one id-ordered
  --     statement (db.md §2.4); in-use and forfeited ones are this match's
  --     and move under the mutex.
  perform 1 from match_tickets k
   where k.id in (select s.ticket_id from match_seats s where s.id = any (p_seat_ids) and s.ticket_id is not null)
     and k.status = 'available'
   order by k.id
   for update;

  select r.status into v_r_status from reservations r where r.id = v_m.reservation_id;
  -- Only an arrival can bring an all-no-show match back (the undo is refused
  -- off a booked match, R16).
  v_reopen := v_m.status = 'no_show' and p_attendance = 'attended';

  for v_s in select s.* from match_seats s where s.id = any (p_seat_ids) order by s.seat_no, s.id loop
    continue when v_s.status = p_attendance;

    if v_s.ticket_id is not null then
      select * into v_t from match_tickets where id = v_s.ticket_id;
      if v_s.status = 'in' and p_attendance = 'attended' then
        perform app.ticket_release(array[v_s.ticket_id], 'attended', array[v_s.id]);
      elsif v_s.status = 'in' and p_attendance = 'no_show' then
        perform app.ticket_forfeit(v_s.ticket_id, v_s.id);
      elsif v_s.status = 'attended' and p_attendance = 'no_show' then
        -- The seat's own ticket, if it is still in the wallet (R9, C3).
        if v_t.status = 'available' then
          perform app.ticket_forfeit(v_s.ticket_id, v_s.id);
        elsif not (v_t.status = 'forfeited' and v_t.forfeited_seat_id = v_s.id) then
          raise exception 'SEAT_MARK_LOCKED' using errcode = 'P0001', detail = 'ticket_used';
        end if;
      elsif v_s.status = 'attended' and p_attendance = 'in' then
        -- R9, R17: a ticket reserved or in use elsewhere is not taken back.
        if app.ticket_lock(array[v_s.ticket_id], array[v_s.id]) <> 1 then
          raise exception 'SEAT_MARK_LOCKED' using errcode = 'P0001', detail = 'ticket_used';
        end if;
      elsif v_s.status = 'no_show' and p_attendance = 'attended' then
        perform app.ticket_restore(v_s.ticket_id, v_s.id, false);
      elsif v_s.status = 'no_show' and p_attendance = 'in' then
        -- The forfeit undone and the ticket back on the seat; a deleted
        -- holder's released ticket is locked again instead.
        if not app.ticket_restore(v_s.ticket_id, v_s.id, true)
           and app.ticket_lock(array[v_s.ticket_id], array[v_s.id]) <> 1 then
          raise exception 'SEAT_MARK_LOCKED' using errcode = 'P0001', detail = 'ticket_used';
        end if;
      end if;
    end if;

    -- C17: the seat first (the undo clears the mark).
    update match_seats
       set status             = p_attendance,
           marked_at          = case when p_attendance = 'in' then null else now() end,
           marked_by_staff_id = case when p_attendance = 'in' then null else v_staff end
     where id = v_s.id;
    v_changed := array_append(v_changed, v_s.id);
    perform app.match_event(v_m.id, v_m.venue_id,
                            case p_attendance when 'attended' then 'seat_attended'
                                              when 'no_show' then 'seat_no_show'
                                              else 'seat_unmarked' end,
                            'staff', v_s.id, null, v_s.status,
                            case when v_reopen then jsonb_build_object('reopened', true) else '{}'::jsonb end);
  end loop;

  if cardinality(v_changed) > 0 then
    select count(*) filter (where c.status = 'in'),
           count(*) filter (where c.status = 'attended'),
           count(*) filter (where c.status = 'no_show')
      into v_in, v_attended, v_no_show
      from app.match_carriers(v_m.id) c;

    -- Then the match, then the booking, under the booking row lock
    -- app.match_lock already holds.
    if v_m.status = 'booked' and v_in = 0 and v_attended = 0 and v_no_show > 0 then
      -- Nobody came: the match ends no_show, and the booking with it (a
      -- direct write: mark_reservation refuses a match booking's no-show).
      perform app.match_end(v_m.id, 'no_show', 'all_no_show', 'staff');
      update reservations
         set status = 'no_show', cancelled_at = coalesce(cancelled_at, now()), cancellation_reason = 'all_no_show'
       where id = v_m.reservation_id;
    elsif v_reopen and v_in + v_attended > 0 then
      -- A correction out of an all-no-show match reopens both. The booking
      -- re-enters the exclusion set: a court re-sold since refuses it.
      update matches set status = 'booked', ended_at = null, ended_reason = null, updated_at = now()
       where id = v_m.id;
      begin
        update reservations set status = 'arrived', cancelled_at = null, cancellation_reason = null
         where id = v_m.reservation_id;
      exception when exclusion_violation then
        raise exception 'SEAT_MARK_LOCKED' using errcode = 'P0001', detail = 'court_reused';
      end;
    elsif v_m.status = 'booked' and p_attendance = 'attended' and v_r_status = 'confirmed' then
      -- The first arrival: the booking is arrived.
      update reservations set status = 'arrived' where id = v_m.reservation_id and status = 'confirmed';
    end if;
    -- A played match stays played whatever the corrections.

    perform app.write_audit('match.mark_seats', 'matches', v_m.id::text,
                            jsonb_build_object('match_status', v_m.status, 'reservation_status', v_r_status),
                            jsonb_build_object('attendance', p_attendance, 'seats', to_jsonb(v_changed),
                                               'match_status', (select mt.status from matches mt where mt.id = v_m.id),
                                               'reopened', v_reopen));
  end if;

  return jsonb_build_object(
    'match_id', v_m.id,
    'match_status', (select mt.status from matches mt where mt.id = v_m.id),
    'reservation_status', (select r.status from reservations r where r.id = v_m.reservation_id),
    'seats', (select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'status', s.status,
                                                           'ticket_status', app.match_seat_ticket(s)->>'status')
                                        order by s.seat_no, s.id), '[]'::jsonb)
                from match_seats s where s.id = any (p_seat_ids)));
end $mark_match_seats_0262$;

comment on function app.mark_match_seats(uuid[], text) is
  '0262 (db.md §4.7.8, R9, R13, R16, R19, R21, C17, C18). Desk: marks 1-4 seats of one booked, played or no_show match attended, no_show or in (the undo). Tickets: in -> attended released; in -> no_show forfeited (a deleted holder''s released, R18); attended -> no_show the seat''s own ticket forfeited if still available; attended -> in locked again; no_show -> attended restored; no_show -> in restored and locked. A seat already in the target state is a no-op. Then the match and the booking: the first arrival turns a confirmed booking arrived; no carrier in or attended with a no_show ends a booked match no_show (all_no_show) and its booking no_show; a correction out of an all-no-show match reopens both (booked, arrived). A played match stays played. Refusals: FORBIDDEN; INVALID_ARGUMENT (p_attendance; p_seat_ids: none, over 4, duplicates, two matches); SEAT_NOT_FOUND; VENUE_MISMATCH; MATCH_NOT_BOOKED; INVALID_TRANSITION not_carrier; SEAT_MARK_LOCKED replaced (R21), match_ended (the undo off a booked match, R16), paid (C18), day_closed (R13), ticket_used (R9), court_reused; SEAT_NOT_STARTED (no_show before the start); re-checked under L2+M. Events seat_attended / seat_no_show / seat_unmarked (code = the previous status; {reopened: true} on a reopening); audit match.mark_seats. Returns {match_id, match_status, reservation_status, seats[{seat_id, status, ticket_status}]}.';

revoke all on function app.mark_match_seats(uuid[], text) from public, anon, authenticated;
grant execute on function app.mark_match_seats(uuid[], text) to authenticated;

-- OM-47, R12, R39: the players who came call the game off. Every carrier must
-- be marked first; "short" means a no-show carrier, or a late leaver nobody
-- replaced (absent after the start).
create or replace function app.desk_call_off_short(p_match_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $desk_call_off_short_0262$
declare
  v_m        matches%rowtype;
  v_in       int;
  v_attended int;
  v_absent   int;
  v_pass     int;
begin
  -- 1.
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 2.
  if p_match_id is not null then
    select * into v_m from matches where id = p_match_id;
  end if;
  if v_m.id is null or v_m.sandbox or not (v_m.venue_id = any (app.visible_venue_ids())) then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 3.
  if not app.is_staff_at(v_m.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_m.venue_id::text, true);

  -- 4-10 once unlocked, then again under L2+M.
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_match_money(v_m.id);
      v_m := app.match_lock(v_m.id);
    end if;
    select count(*) filter (where c.status = 'in'),
           count(*) filter (where c.status = 'attended'),
           count(*) filter (where c.status in ('no_show', 'left_late'))
      into v_in, v_attended, v_absent
      from app.match_carriers(v_m.id) c;

    -- 4.
    if v_m.status = 'cancelled' and v_m.ended_reason = 'called_off_short' then
      return jsonb_build_object(
        'match_id', v_m.id, 'status', 'cancelled',
        'reservation_status', (select r.status from reservations r where r.id = v_m.reservation_id),
        'attended', v_attended, 'no_show', v_absent, 'duplicate', true);
    end if;
    -- 5.
    if v_m.status <> 'booked' then
      raise exception 'MATCH_NOT_BOOKED' using errcode = 'P0001';
    end if;
    -- 6.
    if now() < v_m.start_at then
      raise exception 'MATCH_NOT_STARTED' using errcode = 'P0001';
    end if;
    -- 7.
    if not app.match_marks_open(v_m.id) then
      raise exception 'SEAT_MARK_LOCKED' using errcode = 'P0001', detail = 'day_closed';
    end if;
    -- 8. R12: every carrier marked first.
    if v_in > 0 then
      raise exception 'MATCH_MARK_SEATS' using errcode = 'P0001', detail = v_in::text,
        hint = 'mark every player first';
    end if;
    -- 9. R12, R39.
    if v_absent = 0 then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'not_short';
    end if;
    -- 10.
    if v_attended = 0 then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'nobody_came';
    end if;
  end loop;

  -- The match first (it forfeits unrefilled late leavers' tickets and expires
  -- requests), then the booking under the row lock match_lock holds: the
  -- reservation trigger then finds the match ended. Nothing is owed from here;
  -- money already taken is Money's refund-due line.
  perform app.match_end(v_m.id, 'cancelled', 'called_off_short', 'staff');
  update reservations
     set status = 'cancelled', cancelled_by = 'staff', cancellation_reason = 'called_off_short',
         cancelled_at = coalesce(cancelled_at, now())
   where id = v_m.reservation_id;
  perform app.write_audit('match.call_off_short', 'matches', v_m.id::text,
                          jsonb_build_object('status', 'booked'),
                          jsonb_build_object('status', 'cancelled', 'reservation_id', v_m.reservation_id,
                                             'attended', v_attended, 'no_show', v_absent));

  return jsonb_build_object('match_id', v_m.id, 'status', 'cancelled', 'reservation_status', 'cancelled',
                            'attended', v_attended, 'no_show', v_absent, 'duplicate', false);
end $desk_call_off_short_0262$;

comment on function app.desk_call_off_short(uuid) is
  '0262 (db.md §4.7.9, OM-47, R12, R39). Desk: calls off a booked, started match that is short (a no_show carrier, or an unrefilled left_late carrier) and that at least one player came to: app.match_end called_off_short (unrefilled late leavers'' tickets forfeited, requests expired; attended tickets were released and no-show tickets forfeited at their marks), then the booking cancelled by staff (called_off_short). Refusals in order: FORBIDDEN; MATCH_NOT_FOUND; VENUE_MISMATCH; already called off -> duplicate; MATCH_NOT_BOOKED; MATCH_NOT_STARTED; SEAT_MARK_LOCKED day_closed; MATCH_MARK_SEATS (a carrier still in, detail how many); INVALID_TRANSITION not_short, nobody_came; re-checked under L2+M. Audit match.call_off_short. Returns {match_id, status, reservation_status, attended, no_show (absent carriers, late leavers included), duplicate}.';

revoke all on function app.desk_call_off_short(uuid) from public, anon, authenticated;
grant execute on function app.desk_call_off_short(uuid) to authenticated;

-- ===========================================================================
-- 4. Customers and reports (db.md §4.7.10-§4.7.12)
-- ===========================================================================

-- R35, R40: a manager or owner at any branch bans or lifts, for every branch
-- (customer_flags is chain-wide). No match lock: from the next statement
-- match_guest(true) and every approval refuse, match_try_book and the sweep
-- drop the player's filling seats; booked seats are left to the desk.
create or replace function app.set_match_ban(p_customer_id uuid, p_banned boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $set_match_ban_0262$
declare
  v_parts text[];
  v_code  text;
  v_p     profiles%rowtype;
  v_was   boolean;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_parts := app.match_reason_parts(p_reason);
  v_code := v_parts[1];
  if p_banned is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_banned';
  elsif char_length(coalesce(v_parts[2], '')) > 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;
  if p_customer_id is not null then
    select * into v_p from profiles where id = p_customer_id;
  end if;
  if v_p.id is null or v_p.deleted_at is not null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- R35: a ban names its reason code; a lift's reason is optional.
  if p_banned and (v_code is null or v_code not in ('conduct', 'no_shows', 'reported', 'other')) then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'conduct | no_shows | reported | other, optionally followed by '': <note>''';
  end if;

  v_was := exists (select 1 from customer_flags f where f.customer_id = v_p.id and f.type = 'match_ban');
  if v_was = p_banned then
    return jsonb_build_object('customer_id', v_p.id, 'flags', app.customer_flags_json(v_p.id),
                              'banned', v_was, 'duplicate', true);
  end if;

  if p_banned then
    insert into customer_flags (customer_id, type, label, created_by)
    values (v_p.id, 'match_ban', v_code, auth.uid())
    on conflict (customer_id, type) do nothing;
  else
    delete from customer_flags where customer_id = v_p.id and type = 'match_ban';
  end if;
  perform app.write_audit('customer.match_ban', 'customer_flags', v_p.id::text,
                          jsonb_build_object('banned', v_was),
                          jsonb_build_object('banned', p_banned, 'reason', v_code),
                          p_reason);
  return jsonb_build_object('customer_id', v_p.id, 'flags', app.customer_flags_json(v_p.id),
                            'banned', p_banned, 'duplicate', false);
end $set_match_ban_0262$;

comment on function app.set_match_ban(uuid, boolean, text) is
  '0262 (db.md §4.7.10, R35, R40, R42). Manager, owner at any branch: bans a customer from open matches at every branch (customer_flags match_ban, label = the reason code conduct | no_shows | reported | other) or lifts the ban (reason optional). p_reason is <code> or <code>: <note>; the whole text goes to the audit row customer.match_ban {banned, reason}. Refusals: FORBIDDEN; INVALID_ARGUMENT (p_banned NULL; a note over 200: p_reason); CUSTOMER_NOT_FOUND (unknown or deleted); REASON_REQUIRED (a ban without a ban code); the same state -> duplicate. No match lock: the guest RPCs refuse from the next statement and the sweep drops filling seats. The only writer of a match_ban flag (set_customer_flags carries it over). Returns {customer_id, flags, banned, duplicate}.';

revoke all on function app.set_match_ban(uuid, boolean, text) from public, anon, authenticated;
grant execute on function app.set_match_ban(uuid, boolean, text) to authenticated;

-- OM-28: the desk corrects a customer's declared gender (or clears it).
-- Seats keep the gender stamped when they were taken.
create or replace function app.staff_set_customer_gender(p_customer_id uuid, p_gender text) returns jsonb
language plpgsql security definer set search_path = public as $staff_set_customer_gender_0262$
declare
  v_p profiles%rowtype;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_gender is not null and p_gender not in ('female', 'male') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_gender';
  end if;
  if p_customer_id is not null then
    select * into v_p from profiles where id = p_customer_id;
  end if;
  if v_p.id is null or v_p.deleted_at is not null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_p.gender is not distinct from p_gender then
    return jsonb_build_object('customer_id', v_p.id, 'gender', v_p.gender, 'gender_set_by', v_p.gender_set_by,
                              'duplicate', true);
  end if;

  -- profiles_gender_stamp: the three columns set together, or all NULL.
  update profiles
     set gender        = p_gender,
         gender_set_at = case when p_gender is null then null else now() end,
         gender_set_by = case when p_gender is null then null else 'staff' end
   where id = v_p.id;
  -- The audit row names the account and who set it, never the value (as
  -- set_my_gender, 0256): audit_log is append-only and outlives an account
  -- deletion, which erases the gender (R29).
  perform app.write_audit('customer.gender_set', 'profiles', v_p.id::text,
                          jsonb_build_object('gender_set_by', v_p.gender_set_by,
                                             'had_gender', v_p.gender is not null),
                          jsonb_build_object('gender_set_by', case when p_gender is null then null else 'staff' end,
                                             'cleared', p_gender is null));
  return jsonb_build_object('customer_id', v_p.id, 'gender', p_gender,
                            'gender_set_by', case when p_gender is null then null else 'staff' end,
                            'duplicate', false);
end $staff_set_customer_gender_0262$;

comment on function app.staff_set_customer_gender(uuid, text) is
  '0262 (db.md §4.7.11, OM-28, OM-39). Desk (court_desk, manager, owner): sets a customer''s gender (female | male; gender_set_at now, gender_set_by staff) or clears it (NULL: all three NULL). Refusals: FORBIDDEN; INVALID_ARGUMENT (detail p_gender); CUSTOMER_NOT_FOUND (unknown or deleted); the same value -> duplicate. Seats keep the gender stamped when they were taken. Audit customer.gender_set without the value (before {gender_set_by, had_gender}, after {gender_set_by, cleared}): audit_log outlives an account deletion. Returns {customer_id, gender, gender_set_by, duplicate}.';

revoke all on function app.staff_set_customer_gender(uuid, text) from public, anon, authenticated;
grant execute on function app.staff_set_customer_gender(uuid, text) to authenticated;

-- The Ops reports queue (D24): open reports of the branch, oldest first.
create or replace function app.match_reports_open(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $match_reports_open_0262$
declare
  v_venue uuid;
begin
  -- R33: the role first, then the branch.
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return coalesce((
    select jsonb_agg(x.j order by x.created_at, x.id)
      from (select r.id, r.created_at,
                   jsonb_build_object(
                     'report_id', r.id, 'reason', r.reason, 'created_at', r.created_at,
                     'match', jsonb_build_object('id', m.id, 'start_at', m.start_at, 'category', m.category,
                                                 'status', m.status, 'reservation_id', m.reservation_id),
                     'reported', jsonb_build_object(
                                   'customer_id', rp.id, 'full_name', rp.full_name, 'phone', rp.phone,
                                   'flags', app.customer_flags_json(rp.id),
                                   'banned', exists (select 1 from customer_flags f
                                                      where f.customer_id = rp.id and f.type = 'match_ban'),
                                   'reports_90d', (select count(*) from match_reports x
                                                     join matches xm on xm.id = x.match_id
                                                    where x.reported_id = rp.id and not xm.sandbox
                                                      and x.created_at > now() - interval '90 days'),
                                   'no_shows', app.guest_match_no_shows(rp.id)),
                     'reporter', jsonb_build_object('customer_id', rr.id, 'full_name', rr.full_name)) as j
              from match_reports r
              join matches m on m.id = r.match_id
              join profiles rp on rp.id = r.reported_id
              join profiles rr on rr.id = r.reporter_id
             where r.venue_id = v_venue and r.status = 'open' and not m.sandbox
             order by r.created_at, r.id
             limit 200) x), '[]'::jsonb);
end $match_reports_open_0262$;

comment on function app.match_reports_open(uuid) is
  '0262 (db.md §4.7.12, D24, R33). Manager, owner: the branch''s open player reports, oldest first (at most 200, sandbox matches never): [{report_id, reason, created_at, match {id, start_at, category, status, reservation_id}, reported {customer_id, full_name, phone, flags, banned, reports_90d (chain-wide), no_shows (app.guest_match_no_shows)}, reporter {customer_id, full_name}}]. FORBIDDEN unless manager or owner, then FORBIDDEN unless is_staff_at the branch (p_venue_id, else app.current_venue()).';

revoke all on function app.match_reports_open(uuid) from public, anon, authenticated;
grant execute on function app.match_reports_open(uuid) to authenticated;

-- A manager closes a report, or bans the reported player (R35 reason
-- reported). The UPDATE ... WHERE status = 'open' is the race's arbiter.
create or replace function app.resolve_match_report(p_report_id uuid, p_outcome text) returns jsonb
language plpgsql security definer set search_path = public as $resolve_match_report_0262$
declare
  v_r      match_reports%rowtype;
  v_m      matches%rowtype;
  v_status text;
  v_now    text;
  v_banned boolean := false;
  v_new    int;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('dismissed', 'banned') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_outcome';
  end if;
  if p_report_id is not null then
    select * into v_r from match_reports where id = p_report_id;
  end if;
  if v_r.id is not null then
    select * into v_m from matches where id = v_r.match_id;
  end if;
  if v_r.id is null or v_m.sandbox or not (v_r.venue_id = any (app.visible_venue_ids())) then
    raise exception 'REPORT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_r.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_r.venue_id::text, true);

  v_status := case p_outcome when 'dismissed' then 'dismissed' else 'actioned' end;
  update match_reports
     set status = v_status, reviewed_by = auth.uid(), reviewed_at = now()
   where id = v_r.id and status = 'open';
  if not found then
    select x.status into v_now from match_reports x where x.id = v_r.id;
    if v_now = v_status then
      return jsonb_build_object(
        'report_id', v_r.id, 'status', v_now, 'duplicate', true,
        'banned', exists (select 1 from customer_flags f where f.customer_id = v_r.reported_id and f.type = 'match_ban'));
    end if;
    raise exception 'REPORT_CLOSED' using errcode = 'P0001', detail = v_now;
  end if;

  if p_outcome = 'banned' then
    -- The §4.7.10 ban with reason reported (a deleted account is not banned).
    if exists (select 1 from profiles p where p.id = v_r.reported_id and p.deleted_at is null) then
      insert into customer_flags (customer_id, type, label, created_by)
      values (v_r.reported_id, 'match_ban', 'reported', auth.uid())
      on conflict (customer_id, type) do nothing;
      get diagnostics v_new = row_count;
      if v_new > 0 then
        perform app.write_audit('customer.match_ban', 'customer_flags', v_r.reported_id::text,
                                jsonb_build_object('banned', false),
                                jsonb_build_object('banned', true, 'reason', 'reported', 'report_id', v_r.id),
                                'reported');
      end if;
    end if;
    v_banned := exists (select 1 from customer_flags f where f.customer_id = v_r.reported_id and f.type = 'match_ban');
  end if;
  perform app.write_audit('match.report_resolve', 'match_reports', v_r.id::text,
                          jsonb_build_object('status', 'open'),
                          jsonb_build_object('status', v_status, 'outcome', p_outcome, 'banned', v_banned));
  return jsonb_build_object('report_id', v_r.id, 'status', v_status, 'duplicate', false, 'banned', v_banned);
end $resolve_match_report_0262$;

comment on function app.resolve_match_report(uuid, text) is
  '0262 (db.md §4.7.12, R35, R40). Manager, owner: resolves an open player report: dismissed -> status dismissed; banned -> actioned plus the chain-wide match_ban with reason reported (audit customer.match_ban; a deleted account is not banned). Stamps reviewed_by and reviewed_at; audit match.report_resolve. Refusals: FORBIDDEN; INVALID_ARGUMENT (detail p_outcome); REPORT_NOT_FOUND (unknown, sandbox, outside the visible branches); VENUE_MISMATCH; the same outcome again -> duplicate; REPORT_CLOSED (closed with the other outcome, detail its status). Returns {report_id, status, duplicate, banned}.';

revoke all on function app.resolve_match_report(uuid, text) from public, anon, authenticated;
grant execute on function app.resolve_match_report(uuid, text) to authenticated;

-- ===========================================================================
-- 5. Re-issues (db.md §4.7.13; build contracts §1.8)
-- ===========================================================================

-- mark_reservation, re-issued from 0089 (the 0076 body) with one refusal: a
-- match booking's no-show is marked seat by seat.
create or replace function app.mark_reservation(
  p_reservation_id uuid,
  p_status         reservation_status,
  p_reason         text default 'staff_op'      -- recorded in the audit row (0026)
) returns jsonb
language plpgsql security definer set search_path = public as $mark_reservation_0262$
declare
  v        reservations%rowtype;
  v_before jsonb;
  v_ok     boolean;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 0262 (db.md §4.7.13): an open match's booking is marked player by player
  -- (mark_match_seats), whatever the match's status, so an offline
  -- reservation.update replay can never forfeit four people's tickets in one
  -- click. arrived and completed stay allowed (completed ends the match).
  if p_status = 'no_show' and exists (select 1 from matches m where m.reservation_id = p_reservation_id) then
    raise exception 'MATCH_MARK_SEATS' using errcode = 'P0001',
      hint = 'an open match is marked player by player (mark_match_seats)';
  end if;

  v_ok := (p_status = 'arrived'   and v.status = 'confirmed')
       or (p_status = 'no_show'   and v.status = 'confirmed')
       or (p_status = 'completed' and v.status in ('confirmed','arrived'));
  if not v_ok then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s', v.status, p_status);
  end if;

  -- 0071 (SEC-11), restored. Checked against the FOR UPDATE read, so it cannot
  -- race a concurrent move that shifted start_at.
  if p_status in ('no_show','completed') and now() < v.start_at then
    raise exception 'RESERVATION_NOT_STARTED' using errcode = 'P0001',
      detail = format('starts at %s', v.start_at),
      hint = 'a future booking is cancelled through cancel_reservation with a reason, not marked no_show';
  end if;

  v_before := to_jsonb(v);

  -- 0075: the booking is over from this moment. Anything asking "has this
  -- ended?" reads cancelled_at, and a no-show used to leave it null.
  update reservations
     set status = p_status,
         cancelled_at = case when p_status in ('no_show','completed')
                             then coalesce(v.cancelled_at, now())
                             else v.cancelled_at end,
         cancellation_reason = case when p_status = 'no_show'
                                    then coalesce(p_reason, 'no_show')
                                    else v.cancellation_reason end
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.mark_' || p_status::text, 'reservations',
                          v.id::text, v_before, to_jsonb(v),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'status', v.status);
end $mark_reservation_0262$;

comment on function app.mark_reservation(uuid, reservation_status, text) is
  '0262 = the 0089 body (0076 = 0075 + 0071/SEC-11) plus one refusal: no_show on a booking that is an open match''s reservation_id is MATCH_MARK_SEATS, whatever the match''s status (marks are per seat, mark_match_seats). arrived / no_show / completed. The two ENDINGS stamp cancelled_at (a no_show also stamps cancellation_reason) AND are refused before start_at with RESERVATION_NOT_STARTED, because both leave the exclusion set and would free a future court for resale. A no_show is not a cancellation: the reports count them separately.';

revoke all on function app.mark_reservation(uuid, reservation_status, text) from public, anon, authenticated;
grant execute on function app.mark_reservation(uuid, reservation_status, text) to authenticated;

-- set_customer_flags, re-issued from 0242: a match_ban is written only by
-- set_match_ban, and a desk flag edit (or an older build) carries it over.
create or replace function app.set_customer_flags(p_customer_id uuid, p_flags jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_customer_flags_0262$
declare
  v_flags  jsonb := coalesce(p_flags, '[]'::jsonb);
  v_flag   jsonb;
  v_type   text;
  v_label  text;
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_flags) <> 'array' then
    raise exception 'INVALID_FLAGS' using errcode = 'P0001',
      hint = 'p_flags is an array of {type, label}';
  end if;
  if not exists (select 1 from profiles where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Validate everything before touching the table: a refused call leaves the
  -- previous flags exactly as they were.
  for v_flag in select * from jsonb_array_elements(v_flags) loop
    v_type := v_flag->>'type';
    -- 0262 (R35): the ban has its own RPC, reason code and audit.
    if v_type = 'match_ban' then
      raise exception 'INVALID_FLAG' using errcode = 'P0001',
        detail = 'match_ban',
        hint = 'use set_match_ban';
    end if;
    if v_type is null or v_type not in ('vip','birthday','payment_note','special_request','deposit_exempt') then
      raise exception 'INVALID_FLAG' using errcode = 'P0001',
        detail = coalesce(v_type, 'null'),
        hint = 'type is vip | birthday | payment_note | special_request | deposit_exempt';
    end if;
    if length(coalesce(v_flag->>'label', '')) > 120 then
      raise exception 'LABEL_LENGTH' using errcode = 'P0001',
        hint = 'a flag label is at most 120 characters';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_flags))
     <> (select count(distinct f->>'type') from jsonb_array_elements(v_flags) f) then
    raise exception 'DUPLICATE_FLAG' using errcode = 'P0001',
      hint = 'each flag type may appear once';
  end if;

  v_before := app.customer_flags_json(p_customer_id);

  -- 0262: every flag but a match_ban, which only set_match_ban lifts.
  delete from customer_flags where customer_id = p_customer_id and type <> 'match_ban';

  for v_flag in select * from jsonb_array_elements(v_flags) loop
    v_label := nullif(btrim(coalesce(v_flag->>'label', '')), '');
    insert into customer_flags (customer_id, type, label, created_by)
    values (p_customer_id, v_flag->>'type', v_label, auth.uid());
  end loop;

  v_after := app.customer_flags_json(p_customer_id);

  if v_before is distinct from v_after then
    perform app.write_audit('customer.flags_set', 'customer_flags', p_customer_id::text,
                            v_before, v_after);
  end if;

  return v_after;
end $set_customer_flags_0262$;

comment on function app.set_customer_flags(uuid, jsonb) is
  '0262 = the 0242 body (0065 plus deposit_exempt) with the ban kept out: the desk replaces a customer''s flags with p_flags ([{type, label}], types vip, birthday, payment_note, special_request, deposit_exempt; labels at most 120). A match_ban element is INVALID_FLAG detail match_ban (set_match_ban writes bans), and the delete spares a stored match_ban, so a flag edit or an older build never lifts one. Validates everything before writing; audit customer.flags_set when something changed. Returns customer_flags_json.';

revoke all on function app.set_customer_flags(uuid, jsonb) from public, anon, authenticated;
grant execute on function app.set_customer_flags(uuid, jsonb) to authenticated;

-- customer_counts, re-issued from 0065: seat no-shows join the no-show total
-- (DF-12; a friend seat counts on its holder, DF-15), plus the match counts.
create or replace function app.customer_counts(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = public as $customer_counts_0262$
  select jsonb_build_object(
           'bookings',      r.bookings,
           'cancellations', r.cancellations,
           'noShows',       r.no_shows + s.no_shows,
           'matchesPlayed', s.played,
           'matchNoShows',  s.no_shows,
           'lateLeaves',    s.late_leaves)
    from (select count(*) filter (where kind = 'booking'
                                    and status in ('pending','confirmed','arrived','completed')) as bookings,
                 count(*) filter (where kind = 'booking' and status = 'cancelled')               as cancellations,
                 count(*) filter (where kind = 'booking' and status = 'no_show')                 as no_shows
            from reservations
           where guest_id = p_customer_id) r
   cross join
         (select count(*) filter (where ms.status = 'no_show')   as no_shows,
                 count(*) filter (where ms.status = 'left_late') as late_leaves,
                 count(distinct ms.match_id) filter (where ms.status = 'attended'
                                                       and ms.kind in ('account', 'desk')
                                                       and m.status <> 'cancelled') as played
            from match_seats ms
            join matches m on m.id = ms.match_id
           where ms.guest_id = p_customer_id
             and not m.sandbox) s
$customer_counts_0262$;

comment on function app.customer_counts(uuid) is
  '0262 = the 0065 counts plus open matches (DF-12, DF-15): {bookings, cancellations, noShows (booking no-shows + no_show seats), matchesPlayed (distinct non-cancelled matches with an attended account or linked desk seat), matchNoShows (no_show seats: account, friend on the holder, linked desk), lateLeaves (seats still left_late: never refilled)}. Sandbox matches never count. Internal: customer_search and customer_record read it.';

revoke all on function app.customer_counts(uuid) from public, anon, authenticated;

-- customer_record, re-issued from 0065: the gender (OM-28) and the customer's
-- open matches (the last 20, every branch). Tickets stay in guest_tickets
-- (Money); the ban shows through flags.
create or replace function app.customer_record(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_record_0262$
declare
  v_customer jsonb;
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'id',             p.id,
           'full_name',      p.full_name,
           'phone',          p.phone,
           'email',          u.email,
           'preferred_lang', p.preferred_lang,
           'created_at',     p.created_at,
           'gender',         p.gender,
           'gender_set_by',  p.gender_set_by)
    into v_customer
    from profiles p
    left join auth.users u on u.id = p.id
   where p.id = p_customer_id;
  if v_customer is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'customer', v_customer,
    'flags',    app.customer_flags_json(p_customer_id),
    'counts',   app.customer_counts(p_customer_id),
    'upcoming', coalesce(
      (select jsonb_agg(app.customer_reservation_json(r, c) order by r.start_at)
         from reservations r
         join courts c on c.id = r.court_id
        where r.guest_id = p_customer_id
          and r.start_at >= now()
          and r.status in ('pending','confirmed','arrived')),
      '[]'::jsonb),
    'history', coalesce(
      (select jsonb_agg(h.payload order by h.start_at desc)
         from (select app.customer_reservation_json(r, c) as payload, r.start_at
                 from reservations r
                 join courts c on c.id = r.court_id
                where r.guest_id = p_customer_id
                  and r.kind <> 'hold'
                  and not (r.start_at >= now() and r.status in ('pending','confirmed','arrived'))
                order by r.start_at desc
                limit 50) h),
      '[]'::jsonb),
    -- 0262: open matches (one row per match: the customer's own seat, account
    -- or linked desk, before a friend seat they hold), newest first.
    'matches', coalesce(
      (select jsonb_agg(x.j order by x.start_at desc, x.id)
         from (select m.id, m.start_at,
                      jsonb_build_object('match_id', m.id, 'reservation_id', m.reservation_id,
                                         'venue_id', m.venue_id, 'status', m.status,
                                         'start_at', m.start_at, 'end_at', m.end_at, 'category', m.category,
                                         'seat_status', s.status, 'kind', s.kind) as j
                 from matches m
                 join lateral (select ms.status, ms.kind
                                 from match_seats ms
                                where ms.match_id = m.id and ms.guest_id = p_customer_id
                                order by (ms.kind <> 'friend') desc, ms.joined_at desc, ms.id desc
                                limit 1) s on true
                where not m.sandbox
                order by m.start_at desc, m.id
                limit 20) x),
      '[]'::jsonb),
    'cafeOrders', coalesce(
      (select jsonb_agg(jsonb_build_object(
                          'id',             t.id,
                          'opened_at',      t.opened_at,
                          'total_iqd',      t.total_iqd,
                          'status',         t.status,
                          'reservation_id', t.reservation_id)
                        order by t.opened_at desc)
         from tabs t
        where t.reservation_id in (select r.id from reservations r where r.guest_id = p_customer_id)),
      '[]'::jsonb),
    'notes', coalesce(
      (select jsonb_agg(jsonb_build_object(
                          'id',             n.id,
                          'body',           n.body,
                          'author_id',      n.author_id,
                          'author_name',    a.display_name,
                          'created_at',     n.created_at,
                          'edited_at',      n.edited_at,
                          'edited_by',      n.edited_by,
                          'edited_by_name', e.display_name)
                        order by n.created_at desc)
         from customer_notes n
         join staff a on a.id = n.author_id
         left join staff e on e.id = n.edited_by
        where n.customer_id = p_customer_id),
      '[]'::jsonb),
    -- 0066 (series lane) fills this; the key exists now so the screen can bind to it.
    'series', '[]'::jsonb);
end $customer_record_0262$;

comment on function app.customer_record(uuid) is
  '0262 = the 0065 record plus customer.gender and customer.gender_set_by (OM-28) and matches[] (the customer''s last 20 open matches at every branch, sandbox never: {match_id, reservation_id, venue_id, status, start_at, end_at, category, seat_status, kind}); counts gain matchesPlayed, matchNoShows, lateLeaves (customer_counts). Court desk, cashier, manager, owner. CUSTOMER_NOT_FOUND.';

revoke all on function app.customer_record(uuid) from public, anon, authenticated;
grant execute on function app.customer_record(uuid) to authenticated;

-- customer_search, re-issued from 0077: each row gains the gender (the desk's
-- pickers check it against a women's or men's match, OM-39).
create or replace function app.customer_search(p_query text, p_limit int default 12)
returns setof jsonb
language plpgsql stable security definer set search_path = public as $customer_search_0262$
declare
  v_query  text := btrim(coalesce(p_query, ''));
  v_name   text;
  v_digits text;
  v_email  text;
  v_limit  int  := least(greatest(coalesce(p_limit, 12), 1), 50);
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- One character matches half the venue; the screen's `idle` state covers it.
  if length(v_query) < 2 then
    return;
  end if;

  v_name   := app.like_escape(replace(app.search_norm(v_query), ' ', ''));
  v_digits := app.phone_digits(v_query);
  v_email  := app.like_escape(lower(v_query));

  return query
    select jsonb_build_object(
             'id',             p.id,
             'full_name',      p.full_name,
             'phone',          p.phone,
             'email',          u.email,
             'preferred_lang', p.preferred_lang,
             'gender',         p.gender,
             'flags',          app.customer_flags_json(p.id),
             'counts',         app.customer_counts(p.id))
      from profiles p
      left join auth.users u on u.id = p.id
     where p.deleted_at is null                          -- 0077: not a tombstone
       and ((v_name <> ''
             and replace(app.search_norm(p.full_name), ' ', '') like '%' || v_name || '%')
        or (v_digits is not null and length(v_digits) >= 3
            and app.phone_digits(p.phone) like '%' || v_digits || '%')
        or ((position('@' in v_query) > 0 or length(v_query) >= 3)
            and u.email is not null and lower(u.email) like '%' || v_email || '%'))
     order by
       -- prefix hits first, then substring hits, then by name
       case
         when v_name <> '' and replace(app.search_norm(p.full_name), ' ', '') like v_name || '%' then 0
         when v_digits is not null and app.phone_digits(p.phone) like v_digits || '%' then 1
         else 2
       end,
       p.full_name,
       p.created_at desc
     limit v_limit;
end $customer_search_0262$;

comment on function app.customer_search(text, int) is
  '0262 = the 0077 search (no tombstones) with gender on every row: {id, full_name, phone, email, preferred_lang, gender, flags, counts}. Name, phone digits or email, prefix hits first; at least two characters; p_limit clamped to 1..50. Court desk, cashier, manager, owner.';

revoke all on function app.customer_search(text, int) from public, anon, authenticated;
grant execute on function app.customer_search(text, int) to authenticated;

-- customer_directory, re-issued from 0148: its inline no-show count adds the
-- customer_counts seat term (DF-12, DF-15).
create or replace function app.customer_directory(p_limit int default 5000)
returns jsonb
language plpgsql stable security definer set search_path = public as $customer_directory_0262$
declare
  v_limit int := least(greatest(coalesce(p_limit, 5000), 1), 5000);
  v_total bigint;
  v_rows  jsonb;
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select count(*) into v_total
    from profiles p
   where p.deleted_at is null
     and not exists (select 1 from staff s where s.id = p.id and s.is_active);

  with page as (
    select p.id, p.full_name, p.phone
      from profiles p
     where p.deleted_at is null
       and not exists (select 1 from staff s where s.id = p.id and s.is_active)
     -- a nameless account last, as the screen lists it, so the cap drops those first
     order by (btrim(coalesce(p.full_name, '')) = ''), p.full_name, p.created_at desc
     limit v_limit
  ),
  counts as (
    select r.guest_id,
           count(*) filter (where r.kind = 'booking'
                              and r.status in ('pending','confirmed','arrived','completed')) as bookings,
           count(*) filter (where r.kind = 'booking' and r.status = 'cancelled')          as cancellations,
           count(*) filter (where r.kind = 'booking' and r.status = 'no_show')            as no_shows
      from reservations r
      join page on page.id = r.guest_id
     group by r.guest_id
  ),
  -- 0262: no_show seats of non-sandbox open matches, as customer_counts counts them.
  seat_no_shows as (
    select ms.guest_id, count(*) as no_shows
      from match_seats ms
      join matches m on m.id = ms.match_id and not m.sandbox
      join page on page.id = ms.guest_id
     where ms.status = 'no_show'
     group by ms.guest_id
  ),
  flags as (
    select f.customer_id,
           jsonb_agg(jsonb_build_object('type', f.type, 'label', f.label) order by f.type) as flags
      from customer_flags f
      join page on page.id = f.customer_id
     group by f.customer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        page.id,
           'full_name', page.full_name,
           'phone',     page.phone,
           'email',     u.email,
           'flags',     coalesce(fl.flags, '[]'::jsonb),
           'counts',    jsonb_build_object(
                          'bookings',      coalesce(c.bookings, 0),
                          'cancellations', coalesce(c.cancellations, 0),
                          'noShows',       coalesce(c.no_shows, 0) + coalesce(sn.no_shows, 0)))
           order by page.full_name), '[]'::jsonb)
    into v_rows
    from page
    left join auth.users u     on u.id = page.id
    left join counts c         on c.guest_id = page.id
    left join seat_no_shows sn on sn.guest_id = page.id
    left join flags fl         on fl.customer_id = page.id;

  return jsonb_build_object(
    'rows',      v_rows,
    'total',     v_total,
    'truncated', v_total > v_limit);
end $customer_directory_0262$;

comment on function app.customer_directory(int) is
  '0262 = the 0148 directory (every live non-staff customer, name order, {rows, total, truncated}, p_limit clamped to 1..5000) with counts.noShows adding the customer''s no_show seats in non-sandbox open matches, as customer_counts does (DF-12, DF-15). Court desk, cashier, manager, owner.';

revoke all on function app.customer_directory(int) from public, anon, authenticated;
grant execute on function app.customer_directory(int) to authenticated;
