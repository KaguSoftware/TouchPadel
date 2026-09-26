-- ===========================================================================
-- 0102 — report_drill says what each transaction is in structured fields.
--
-- The drill-through window's "What" column printed `label`, a string this
-- function assembled in English from raw codes: "refund · quality · cash",
-- "discount_percent · promotion", "Test Item × 2". Arabic staff read the same
-- English, and codes like `guest_web` or `waste_spill` reached the owner as-is.
--
-- Each row now also carries `detail`: the facts behind the label as separate
-- fields (which court and guest, which table, payment method, reason code,
-- adjustment kind, item and ingredient names in both languages, quantity and
-- unit). The operator writes the sentence in the reader's language.
--
-- Additive only: `label` and every other key are unchanged, so any client that
-- has not been updated keeps working. The body is 0099's with one `detail`
-- column added to each branch; filters, tags, guards and the 500-row cap are
-- identical.
-- ===========================================================================

create or replace function app.report_drill(
  p_figure text,
  p_key    text,
  p_from   date,
  p_to     date
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_drill_0102$
declare
  v_b        record;
  v_tag      text;
  v_scope    record;
  v_key      record;
  v_court    uuid;
  v_item     uuid;
  v_staff    uuid;
  v_out      jsonb;
  v_figures  text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','discounts',
                             'refunds','voids','waste','noShows','bookings','orders','cancellations'];
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
  if v_tag in ('revenue','padelRevenue','cafeRevenue','cafeNet','cash','card') then
    perform app.reports_guard(true);
  end if;

  v_court := case when v_scope.kind = 'court' then v_scope.id when v_key.kind = 'court' then v_key.id end;
  v_item  := case when v_scope.kind = 'item'  then v_scope.id when v_key.kind = 'item'  then v_key.id end;
  v_staff := case when v_scope.kind = 'staff' then v_scope.id when v_key.kind = 'staff' then v_key.id end;

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
     where r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
    union all
    -- Settled tabs from the shared helper: the cafe part, gross of refunds.
    -- 0099: only the cafeRevenue figure lists these; revenue lists the net twin.
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_gross_iqd,
           coalesce((select p.recorded_by from payments p where p.tab_id = s.tab_id
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
           coalesce((select p.recorded_by from payments p where p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'settledTab', 'tabLabel', t.label, 'table', ct.table_number),
           array['revenue','cafeNet']
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
      left join cafe_tables ct on ct.id = t.table_id
    union all
    -- Payments by method.
    select p.id::text, p.created_at, 'payment',
           p.method::text || ' · ' || coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           p.amount_iqd::bigint, p.recorded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'payment', 'method', p.method, 'tabLabel', t.label, 'table', ct.table_number),
           array[p.method::text]
      from payments p
      join tabs t on t.id = p.tab_id
      left join cafe_tables ct on ct.id = t.table_id
     where p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
    union all
    -- Refunds (money out; also net off cash/card).
    select r.id::text, r.created_at, 'refund',
           'refund · ' || r.reason_code || ' · ' || p.method::text,
           r.amount_iqd::bigint, r.refunded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', r.reason_code, 'method', p.method),
           array['refunds', p.method::text]
      from refunds r
      join payments p on p.id = r.payment_id
     where r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
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
     where l.action = 'order_item.void'
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
     where sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
    union all
    -- Orders (non-voided), amount = live line total.
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
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
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
     where v_item is not null),
  picked as (
    select tx.*
      from tx
     where (v_tag is null or v_tag = any (tx.tags))
       and (v_court is null or tx.court_id = v_court)
       and (v_staff is null or tx.staff_id = v_staff)
       and (v_item  is null or tx.item_id  = v_item)
       -- Scope-only drills: a court shows its bookings, an item its lines
       -- (plus voids of it), a member their actions (not the duplicate lines,
       -- and not the net twin of a tab row).
       and (v_tag is not null
            or (v_scope.kind = 'court' and 'lines' <> all (tx.tags) and 'cafeNet' <> all (tx.tags))
            or (v_scope.kind = 'item'  and ('lines' = any (tx.tags) or 'voids' = any (tx.tags)))
            or (v_scope.kind = 'staff' and 'lines' <> all (tx.tags) and 'cafeNet' <> all (tx.tags)))
       and (v_tag is null or 'lines' <> all (tx.tags))
     order by tx.at desc, tx.id desc
     limit 500)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        p.id,
           'at',        p.at,
           'kind',      p.kind,
           'label',     p.label,
           'amountIqd', p.amount,
           'staffId',   p.staff_id,
           'staffName', s.display_name,
           'reference', p.reference,
           'detail',    p.detail
         ) order by p.at desc, p.id desc), '[]'::jsonb)
    into v_out
    from picked p
    left join staff s on s.id = p.staff_id;

  return jsonb_build_object(
    'figure',       p_figure,
    'key',          p_key,
    'period',       jsonb_build_object('from', p_from, 'to', p_to),
    'transactions', v_out);
end $fn_report_drill_0102$;

revoke all on function app.report_drill(text, text, date, date) from public, anon;
grant execute on function app.report_drill(text, text, date, date) to authenticated;
