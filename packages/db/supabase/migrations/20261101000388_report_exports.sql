set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0388 report_exports — the report exports and the drill window add up (F-14,
-- Majed 2026-11-01: "fix all report export bugs").
--
-- report_drill (0292 is no longer the latest) listed the newest 500 rows and
-- nothing else, so the window's total card, its kind counts and its per-day
-- totals were sums of a capped page: wrong past 500 rows. It now also returns
-- totals {count, amountIqd, kinds [{key, count, sum}], days {date: {count,
-- sum}}} over every matching transaction, capped (more than 500 matched), and
-- each listed row's day, its BUSINESS date (app.business_date with the branch's
-- analytics_business_day_start_hour, default 4, and timezone), so a sale at
-- 01:30 sits under the night it belongs to, not the calendar date. Signature
-- unchanged; the rows are unchanged.

-- report_drill: re-issued from 20261002000292_lesson_money_reports.sql:1797.
create or replace function app.report_drill(
  p_figure text,
  p_key    text,
  p_from   date,
  p_to     date
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_drill_0388$
declare
  v_rv uuid[] := app.report_venues();
  v_b        record;
  v_tag      text;
  v_scope    record;
  v_key      record;
  v_court    uuid;
  v_item     uuid;
  v_staff    uuid;
  v_out      jsonb;
  v_tz       text;
  v_start    int;
  v_figures  text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','discounts',
                             'refunds','voids','waste','noShows','bookings','orders','cancellations',
                             'lessonRevenue'];
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  if p_figure is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_figure';
  end if;
  select * into v_scope from app.reports_parse_scope(p_figure);
  if v_scope.kind is null then
    if not (p_figure = any (v_figures)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'p_figure', hint = 'a figure key or court:<uuid> | item:<uuid> | staff:<uuid>';
    end if;
    v_tag := p_figure;
  end if;
  select * into v_key from app.reports_parse_scope(p_key);
  if p_key is not null and v_key.kind is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_key', hint = 'court:<uuid> | item:<uuid> | staff:<uuid> or null';
  end if;

  -- Financial figures are the owner's alone (spec R-roles, build plan §4).
  if v_tag in ('revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','lessonRevenue') then
    perform app.reports_guard(true);
  end if;

  v_court := case when v_scope.kind = 'court' then v_scope.id when v_key.kind = 'court' then v_key.id end;
  v_item  := case when v_scope.kind = 'item'  then v_scope.id when v_key.kind = 'item'  then v_key.id end;
  v_staff := case when v_scope.kind = 'staff' then v_scope.id when v_key.kind = 'staff' then v_key.id end;
  -- 0388 (F-14): each row's business day, by the branch's clock and day start (default 4).
  v_tz    := coalesce((select v.timezone from venues v where v.id = v_rv[1]), 'Asia/Baghdad');
  v_start := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v_rv[1]), 4);

  with
  tx as (
    -- Bookings on their slot's day (every status the reports count).
    select r.id::text                                                  as id,
           r.start_at                                                  as at,
           'reservation'                                               as kind,
           c.name_en || ' · ' || coalesce(r.guest_name, pr.full_name, '') as label,
           coalesce(r.price_iqd, 0)::bigint                            as amount,
           r.created_by_staff_id                                       as staff_id,
           r.id::text                                                  as reference,
           r.court_id                                                  as court_id,
           null::uuid                                                  as item_id,
           jsonb_build_object('sub', 'booking', 'status', r.status,
                              'courtEn', c.name_en, 'courtAr', c.name_ar,
                              'guest', coalesce(r.guest_name, pr.full_name)) as detail,
           case
             when r.status in ('confirmed','arrived','completed') then array['bookings','revenue','padelRevenue']
             when r.status = 'no_show'   then array['noShows']
             when r.status = 'cancelled' then array['cancellations']
             else array[]::text[]
           end                                                         as tags
      from reservations r
      join courts c on c.id = r.court_id
      left join profiles pr on pr.id = r.guest_id
     where c.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
    union all
    -- Settled tabs from the shared helper: the cafe part, gross of refunds.
    -- 0099: only the cafeRevenue figure lists these; revenue lists the net twin.
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_gross_iqd,
           coalesce((select p.recorded_by from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'settledTab', 'tabLabel', t.label, 'table', ct.table_number),
           array['cafeRevenue']
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
      left join cafe_tables ct on ct.id = t.table_id
    union all
    -- The same tabs, net of their refunds: the cafeNet figure and, since 0099,
    -- the cafe part of revenue (so the drill rows add up to the headline).
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_net_iqd,
           coalesce((select p.recorded_by from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'settledTab', 'tabLabel', t.label, 'table', ct.table_number),
           array['revenue','cafeNet']
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
      left join cafe_tables ct on ct.id = t.table_id
    union all
    -- Payments by method. 0292 (DB-16): every tab of the branches, a tab with
    -- no table included (t.venue_id); a payment on a lesson tab is lesson
    -- revenue too.
    select p.id::text, p.created_at, 'payment',
           p.method::text || ' · ' || coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           p.amount_iqd::bigint, p.recorded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'payment', 'method', p.method, 'tabLabel', t.label, 'table', ct.table_number),
           case when t.kind = 'lesson' then array[p.method::text, 'revenue', 'lessonRevenue']
                else array[p.method::text] end
      from payments p
      join tabs t on t.id = p.tab_id
      left join cafe_tables ct on ct.id = t.table_id
     where t.venue_id = any(v_rv) and p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
    union all
    -- Refunds (money out), listed under refunds.
    select r.id::text, r.created_at, 'refund',
           'refund · ' || r.reason_code || ' · ' || p.method::text,
           r.amount_iqd::bigint, r.refunded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', r.reason_code, 'method', p.method),
           array['refunds']
      from refunds r
      join payments p on p.id = r.payment_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union all
    -- 0292 (DB-16): the same refunds as negative rows, netted off their
    -- method (cash, card) and, on a lesson tab, off lesson revenue. 'net' marks
    -- the twin, which a scope-only drill leaves out.
    select r.id::text, r.created_at, 'refund',
           'refund · ' || r.reason_code || ' · ' || p.method::text,
           -r.amount_iqd::bigint, r.refunded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', r.reason_code, 'method', p.method),
           case when t.kind = 'lesson' then array[p.method::text, 'net', 'revenue', 'lessonRevenue']
                else array[p.method::text, 'net'] end
      from refunds r
      join payments p on p.id = r.payment_id
      join tabs t on t.id = p.tab_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union all
    -- 0292 (DB-16): online lesson money (never cash or card), paid by
    -- succeeded_at, refunded as a negative row by refunded_at; sandbox rows
    -- count 0 and are not listed (CM-15). No guest identity (R42).
    select bp.id::text, bp.succeeded_at, 'payment',
           'lesson · online',
           bp.amount_iqd::bigint, null::uuid, bp.id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'payment', 'method', 'online', 'tabLabel', 'Lesson'),
           array['revenue', 'lessonRevenue']
      from booking_payments bp
     where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any(v_rv)
       and bp.succeeded_at >= v_b.ts_from and bp.succeeded_at < v_b.ts_to
    union all
    select bp.id::text || ':refund', bp.refunded_at, 'refund',
           'refund · lesson · online',
           -bp.refund_amount_iqd::bigint, null::uuid, bp.id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', bp.refund_reason, 'method', 'online'),
           array['revenue', 'lessonRevenue']
      from booking_payments bp
     where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any(v_rv)
       and bp.status = 'refunded'
       and bp.refunded_at >= v_b.ts_from and bp.refunded_at < v_b.ts_to
    union all
    -- 0292 (DB-16, DB-20): online lesson money handed back outside the till
    -- (R75), as a negative row by when it was recorded; a sandbox place left
    -- out.
    select 'lesson-event:' || ev.id::text, ev.at, 'refund',
           'refund · lesson · outside the till',
           -(ev.data ->> 'amount_iqd')::bigint, ev.actor_staff_id, ev.id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', 'lesson_refund_outside', 'method', 'outside'),
           array['revenue', 'lessonRevenue']
      from lesson_events ev
     where ev.type = 'refunded' and ev.code = 'outside' and ev.venue_id = any(v_rv)
       and ev.at >= v_b.ts_from and ev.at < v_b.ts_to
       and not exists (select 1 from booking_payments bp
                        where bp.lesson_enrolment_id = ev.enrolment_id and bp.purpose = 'lesson' and bp.sandbox)
    union all
    -- Discounts / price overrides.
    select a.id::text, a.created_at, 'adjustment',
           a.kind::text || ' · ' || a.reason_code,
           a.amount_iqd::bigint, a.applied_by, a.tab_id::text, null::uuid,
           (select oi.menu_item_id from order_items oi where oi.id = a.order_item_id),
           jsonb_build_object('sub', 'discount', 'adjKind', a.kind, 'reason', a.reason_code),
           array['discounts']
      from tab_adjustments a
     where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
    union all
    -- Voids, from the audit trail (the only timestamped record of a void).
    select l.id::text, l.at, 'adjustment',
           'void · ' || coalesce(l.reason_code, '') || ' · ' || coalesce(mi.name_en, ''),
           coalesce((l.after ->> 'line_total_iqd')::bigint, 0), l.actor_id, l.entity_id,
           null::uuid, mi.id,
           jsonb_build_object('sub', 'void', 'reason', l.reason_code, 'itemEn', mi.name_en, 'itemAr', mi.name_ar),
           array['voids']
      from audit_log l
      left join menu_items mi on mi.id::text = (l.after ->> 'menu_item_id')
     where mi.venue_id = any(v_rv) and l.venue_id = any(v_rv) and l.action = 'order_item.void'
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
    union all
    -- Waste movements.
    select sm.id::text, sm.at, 'waste',
           i.name_en || ' · ' || coalesce(sm.reason_code, sm.movement_type::text)
             || ' · ' || (-sm.qty_delta)::text || ' ' || i.unit::text,
           coalesce(round(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0)), 0)::bigint,
           sm.staff_id, sm.id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'waste', 'movement', sm.movement_type, 'reason', sm.reason_code,
                              'ingredientEn', i.name_en, 'ingredientAr', i.name_ar,
                              'qty', -sm.qty_delta, 'unit', i.unit),
           array['waste']
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
     where i.venue_id = any(v_rv) and sm.venue_id = any(v_rv) and sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
    union all
    -- Orders (non-voided), amount = live line total. 0292: a tab with no
    -- table included (t.venue_id), as reports_figures counts orders.
    select o.id::text, o.placed_at, 'tab',
           'order · ' || o.source::text || ' · ' || coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           coalesce((select sum(oi.line_total_iqd) from order_items oi
                      where oi.order_id = o.id and not oi.voided), 0)::bigint,
           o.placed_by_staff_id, o.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'order', 'source', o.source, 'tabLabel', t.label, 'table', ct.table_number),
           array['orders']
      from orders o
      join tabs t on t.id = o.tab_id
      left join cafe_tables ct on ct.id = t.table_id
     where t.venue_id = any(v_rv) and o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
    union all
    -- Settled lines, for the item scope only (net of discounts and refunds).
    select l.order_item_id::text, l.placed_at, 'tab',
           mi.name_en || ' × ' || l.qty::text,
           l.net_line_iqd, o.placed_by_staff_id, l.tab_id::text, null::uuid, l.menu_item_id,
           jsonb_build_object('sub', 'line', 'itemEn', mi.name_en, 'itemAr', mi.name_ar, 'qty', l.qty),
           array['lines']
      from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
      join orders o on o.id = l.order_id
      join menu_items mi on mi.id = l.menu_item_id
     where mi.venue_id = any(v_rv) and o.venue_id = any(v_rv) and v_item is not null),
  matched as (
    select tx.*
      from tx
     where (v_tag is null or v_tag = any (tx.tags))
       and (v_court is null or tx.court_id = v_court)
       and (v_staff is null or tx.staff_id = v_staff)
       and (v_item  is null or tx.item_id  = v_item)
       -- Scope-only drills: a court shows its bookings, an item its lines
       -- (plus voids of it), a member their actions (not the duplicate lines,
       -- and not the net twin of a tab row or of a refund).
       and (v_tag is not null
            or (v_scope.kind = 'court' and 'lines' <> all (tx.tags) and 'cafeNet' <> all (tx.tags)
                and 'net' <> all (tx.tags))
            or (v_scope.kind = 'item'  and ('lines' = any (tx.tags) or 'voids' = any (tx.tags)))
            or (v_scope.kind = 'staff' and 'lines' <> all (tx.tags) and 'cafeNet' <> all (tx.tags)
                and 'net' <> all (tx.tags)))
       and (v_tag is null or 'lines' <> all (tx.tags))),
  -- 0388 (F-14): the list is still the newest 500; the totals are every match.
  picked as (
    select m.* from matched m order by m.at desc, m.id desc limit 500)
  select jsonb_build_object(
           'transactions', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id',        p.id,
                      'at',        p.at,
                      'day',       app.business_date(p.at, v_tz, v_start),
                      'kind',      p.kind,
                      'label',     p.label,
                      'amountIqd', p.amount,
                      'staffId',   p.staff_id,
                      'staffName', s.display_name,
                      'reference', p.reference,
                      'detail',    p.detail
                    ) order by p.at desc, p.id desc), '[]'::jsonb)
               from picked p
               left join staff s on s.id = p.staff_id),
           'totals', (
             select jsonb_build_object(
                      'count',     count(*),
                      'amountIqd', coalesce(sum(m.amount), 0),
                      'kinds',     coalesce((
                        select jsonb_agg(jsonb_build_object('key', k.key, 'count', k.n, 'sum', k.total) order by k.first_at desc)
                          from (select coalesce(m2.detail->>'sub', m2.kind) as key, count(*) as n,
                                       coalesce(sum(m2.amount), 0) as total, max(m2.at) as first_at
                                  from matched m2 group by 1) k), '[]'::jsonb),
                      'days',      coalesce((
                        select jsonb_object_agg(d.day, jsonb_build_object('count', d.n, 'sum', d.total))
                          from (select app.business_date(m3.at, v_tz, v_start)::text as day, count(*) as n,
                                       coalesce(sum(m3.amount), 0) as total
                                  from matched m3 where m3.at is not null group by 1) d), '{}'::jsonb))
               from matched m))
    into v_out;

  return jsonb_build_object(
    'figure',       p_figure,
    'key',          p_key,
    'period',       jsonb_build_object('from', p_from, 'to', p_to),
    'transactions', v_out->'transactions',
    -- 0388 (F-14): the figure's totals over every transaction, not only the 500 listed.
    'totals',       v_out->'totals',
    'capped',       (v_out #>> '{totals,count}')::int > 500);
end $report_drill_0388$;

comment on function app.report_drill(text, text, date, date) is
  '0219, 0292. Manager or owner (reports_guard; the money figures revenue, padelRevenue, cafeRevenue, cafeNet, cash, card and lessonRevenue the owner''s alone): the transactions behind a report figure (or a court:, item: or staff: scope) for a business-day range over app.report_venues(), newest first, at most 500, each {id, at, day (0388: its business date by the branch''s day start, default 4), kind, label, amountIqd, staffId, staffName, reference, detail}; 0388 (F-14): totals {count, amountIqd, kinds [{key (detail.sub, else kind), count, sum}], days {date: {count, sum}}} over EVERY matching transaction and capped (more than 500 matched). 0292 (DB-16): revenue, cash and card add up to reports_figures (lesson money by app.lesson_money_figures'' definitions, tagged revenue and lessonRevenue: desk lesson payments, their refunds negative, online lesson rows by succeeded_at, their refunds negative by refunded_at, handbacks outside the till negative; every payment of the branches, a tab with no table included, each refund a negative twin under its method). A lesson row carries no guest identity (R42). FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.report_drill(text, text, date, date) from public, anon;
grant execute on function app.report_drill(text, text, date, date) to authenticated;
