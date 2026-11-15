set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0421 assistant_money_staff_tools: five read-only tools for the OWNER
-- assistant over the day closes, the costs and the cash result, the safe,
-- wages and attendance, and the walls the owner lifted for it.
--
-- THE OWNER'S DECISIONS (Majed, 2026-11-12). The code walled several tables
-- off from every model ("never readable by the assistant": headers of 0197,
-- 0270, 0333, 0343, 0344, 0355; check-analytics-payload.mjs FORBIDDEN; the
-- coverage fixture's "excluded"). For the OWNER assistant only he lifted them:
--   * the safe ledger (main_cash_entries): "there is no need for that
--     restriction, give it full access". Offered "pay to a named person only
--     as a category total", he rejected that limit: payee names, including
--     wage, advance and coach pay rows, are readable;
--   * wages and salary advances: "get rid of the wall there is no need for
--     it". Per person by name;
--   * attendance (lateness and early leaving typed in by managers,
--     staff_attendance): "get rid of the wall here too";
--   * profit: "Cash result", revenue minus everything paid from the safe or
--     the bank in the period, computed here and labelled cash_result, never
--     profit.
-- Still binding (docs/PRODUCT.md, contractual): nothing grades staff. Rows
-- about people are in name or time order, never ordered by a figure; no
-- per-person score, rank or "worst" list. The walls stay for every other
-- model surface: analytics-insights (check-analytics-payload.mjs patterns
-- unchanged), the free staff assistant (no tools), and table_read
-- (app.assistant_readable_columns gains nothing).
--
-- 1. New owner-only tools, each app.assistant_<x>(p_from, p_to, ...) returns
--    jsonb, STABLE, SECURITY DEFINER, FORBIDDEN unless app.is_staff('owner'),
--    every read at the branches in app.report_venues() (0406's rule), no
--    client grant (reached only through app.assistant_run_tool, so the
--    rpc registry and app.access_area_rpcs are untouched). All are catalog
--    kind `aggregate` with capped row arrays inside (a `list` tool would need
--    app.assistant_count re-issued); the emitted keys are the column
--    allowlist, and every total is summed here, never by the model:
--      * assistant_cash_closes      (tool cash_closes)        day closes, till
--        shifts and the day-close hand-ins per box. The page RPCs
--        (till_shift_list 0281, main_cash_day_boxes 0343) resolve one branch
--        through app.current_venue() and admit managers, so they cannot be
--        dispatched for a chain-wide owner.
--      * assistant_costs_summary    (tool costs_summary)      live payments
--        from the safe or the bank (0343's first rule: costs never come from
--        a drawer) by category and bucket, panel_headline's revenue, and the
--        cash result; null with a note while a pre-system monthly report is
--        counted in that revenue (the reports carry revenue, never costs).
--      * assistant_safe_summary     (tool safe_summary)       the safe per
--        branch: balance now, opening and closing for the range, money in and
--        out by kind, counts; with p_rows the ledger rows, payee and note of
--        every source.
--      * assistant_wages_summary    (tool wages_summary)      app.wage_line
--        (0355) per branch, person and pay month, so the figures are the
--        Wages page's (wages_month, 0355).
--      * assistant_attendance_summary (tool attendance_summary) the lateness
--        a manager typed in (0270), per person, plus till-shift presence for
--        cash staff, with a coverage note: there is no clock-in and no rota.
-- 2. app.assistant_run_tool re-issued from 0420 + the five branches.
-- 3. app.assistant_set_scopes re-issued from 0108 with the catalog's full
--    scope list: engagement and files were missing, so ticking either chip on
--    a saved chat raised ASSISTANT_UNKNOWN_SCOPE (tests/assistant-catalog
--    pins the SQL list to ASSISTANT_SCOPES).
-- 4. v_day_close_summary leaves app.assistant_readable_columns: it has no
--    venue_id, so 0406's branch predicate cannot apply and one chosen branch
--    read every branch's days; cash_closes answers it with branch scope.
--    day_sessions and till_shifts stay readable.
-- 5. The table comments that said "never readable by the owner assistant or
--    any LLM" say what is true now.
--
-- Re-issued verbatim from their latest bodies except the lines marked 0421:
--   app.assistant_run_tool    20261114000420_assistant_history_reports.sql:405
--   app.assistant_set_scopes  20260920000108_assistant_tables.sql:235
-- Same signatures, STABLE / volatility, SECURITY DEFINER, search_path,
-- guards and grants.
--
-- covered by packages/db/tests/assistant-money-tools.test.ts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1a. app.assistant_cash_closes (new, tool cash_closes)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_cash_closes(
  p_from   date,
  p_to     date,
  p_detail text default 'days'
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_cash_closes_0421$
declare
  v_rv     uuid[];
  v_detail text := coalesce(p_detail, 'days');
  v_out    jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must be at most 400 days';
  end if;
  if v_detail not in ('days', 'shifts', 'none') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_detail', hint = 'days, shifts or none';
  end if;
  v_rv := app.report_venues();

  with
  ds as materialized (
    select d.*, v.name_en as branch
      from day_sessions d
      join venues v on v.id = d.venue_id
     where d.venue_id = any(v_rv)
       and d.business_date between p_from and p_to),
  sh as materialized (
    select t.*, ds.business_date, ds.branch, app.main_cash_box(t.station_id) as box
      from till_shifts t
      join ds on ds.id = t.day_session_id),
  -- Cash each drawer box took less the cash refunds counted under the day, as
  -- main_cash_day_boxes (0343) counts them.
  takings as (
    select p.day_session_id as day_id, app.main_cash_box(p.device_id) as box, p.amount_iqd::bigint as amt
      from payments p
      join ds on ds.id = p.day_session_id
     where p.method = 'cash'
    union all
    select x.day_id, x.box, -x.amt
      from (select coalesce(ts.day_session_id, p.day_session_id) as day_id,
                   app.main_cash_box(coalesce(r.device_id, p.device_id)) as box,
                   r.amount_iqd::bigint as amt
              from refunds r
              join payments p on p.id = r.payment_id
              left join till_shifts ts on ts.id = r.till_shift_id
             where p.method = 'cash'
               and (p.day_session_id in (select id from ds) or ts.day_session_id in (select id from ds))) x
     where x.day_id in (select id from ds)),
  boxnet as (select day_id, box, sum(amt)::bigint as net from takings group by 1, 2),
  hand as (
    select e.day_session_id as day_id, e.box, sum(e.amount_iqd)::bigint as handed
      from main_cash_entries e
      join ds on ds.id = e.day_session_id
     where e.source = 'day_close' and e.kind = 'hand_in' and e.voided_at is null
     group by 1, 2),
  dbox as materialized (
    select coalesce(b.day_id, h.day_id) as day_id, coalesce(b.box, h.box) as box,
           coalesce(b.net, 0) as net, h.handed
      from boxnet b
      full join hand h on h.day_id = b.day_id and h.box = b.box),
  closed as (select * from ds where status = 'closed'),
  boxes as (select x.b as box, x.o from (values ('cafe', 1), ('desk', 2), ('shop', 3)) as x(b, o))
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'totals', jsonb_build_object(
      'days_closed',  (select count(*) from closed),
      'days_open',    (select count(*) from ds where status <> 'closed'),
      'expected_iqd', (select coalesce(sum(cash_expected_iqd), 0) from closed),
      'counted_iqd',  (select coalesce(sum(cash_counted_iqd), 0) from closed),
      'variance_iqd', (select coalesce(sum(cash_variance_iqd), 0) from closed),
      'short_days',   (select count(*) from closed where cash_variance_iqd < 0),
      'short_iqd',    (select coalesce(-sum(cash_variance_iqd), 0) from closed where cash_variance_iqd < 0),
      'over_days',    (select count(*) from closed where cash_variance_iqd > 0),
      'over_iqd',     (select coalesce(sum(cash_variance_iqd), 0) from closed where cash_variance_iqd > 0),
      'card_gap_iqd', (select coalesce(sum(card_terminal_batch_iqd - card_expected_iqd), 0) from closed
                        where card_terminal_batch_iqd is not null),
      'shifts',              (select count(*) from sh),
      'shifts_uncounted',    (select count(*) from sh where cash_counted_iqd is null),
      'shift_variance_iqd',  (select coalesce(sum(cash_variance_iqd), 0) from sh),
      'handover_difference_iqd', (select coalesce(sum(handover_difference_iqd), 0) from sh),
      'handed_in_iqd',       (select coalesce(sum(handed), 0) from dbox),
      -- what the closed days' boxes took (net of cash refunds) and no day-close hand-in carried
      'hand_in_gap_iqd',     (select coalesce(sum(b.net - coalesce(b.handed, 0)), 0) from dbox b
                               where b.day_id in (select id from closed))),
    'by_box', (select coalesce(jsonb_agg(jsonb_build_object(
                 'box',           bx.box,
                 'shifts',        (select count(*) from sh where sh.box = bx.box),
                 'variance_iqd',  (select coalesce(sum(sh.cash_variance_iqd), 0) from sh where sh.box = bx.box),
                 'net_cash_iqd',  (select coalesce(sum(b.net), 0) from dbox b where b.box = bx.box),
                 'handed_in_iqd', (select coalesce(sum(b.handed), 0) from dbox b where b.box = bx.box))
                 order by bx.o), '[]'::jsonb)
                 from boxes bx
                where exists (select 1 from sh where sh.box = bx.box)
                   or exists (select 1 from dbox b where b.box = bx.box)))
    || case when v_detail in ('days', 'shifts') then jsonb_build_object(
         'days_total', (select count(*) from ds),
         -- the latest 100 days, listed in date order
         'days', (select coalesce(jsonb_agg(jsonb_build_object(
                    'business_date',  d.business_date,
                    'branch',         d.branch,
                    'status',         d.status,
                    'expected',       d.cash_expected_iqd,
                    'counted',        d.cash_counted_iqd,
                    'variance',       d.cash_variance_iqd,
                    'card_expected',  d.card_expected_iqd,
                    'card_batch',     d.card_terminal_batch_iqd,
                    'closed_by_name', (select s.display_name from staff s where s.id = d.closed_by),
                    'notes',          d.notes,
                    'boxes',          (select coalesce(jsonb_agg(jsonb_build_object('box', b.box, 'net', b.net, 'handed_in', b.handed)
                                                                 order by bx.o), '[]'::jsonb)
                                         from dbox b join boxes bx on bx.box = b.box where b.day_id = d.id))
                    order by d.business_date, d.branch, d.id), '[]'::jsonb)
                    from (select * from ds order by business_date desc, branch, id limit 100) d))
       else '{}'::jsonb end
    || case when v_detail = 'shifts' then jsonb_build_object(
         'shifts_total', (select count(*) from sh),
         -- the latest 200 shifts, listed in time order
         'shifts', (select coalesce(jsonb_agg(jsonb_build_object(
                      'business_date', t.business_date,
                      'branch',        t.branch,
                      'station',       t.station_id,
                      'box',           t.box,
                      'staff_id',      t.staff_id,
                      'staff_name',    (select s.display_name from staff s where s.id = t.staff_id),
                      'opened_at',     t.opened_at,
                      'closed_at',     t.closed_at,
                      'closed_via',    t.closed_via,
                      'expected',      t.cash_expected_iqd,
                      'counted',       t.cash_counted_iqd,
                      'variance',      t.cash_variance_iqd,
                      'handover_difference_iqd', t.handover_difference_iqd)
                      order by t.opened_at, t.id), '[]'::jsonb)
                      from (select * from sh order by opened_at desc, id limit 200) t))
       else '{}'::jsonb end
    into v_out;

  return v_out;
end $assistant_cash_closes_0421$;

comment on function app.assistant_cash_closes(date, date, text) is
  '0421. Owner-only, read-only, reached through app.assistant_run_tool (tool cash_closes). The day closes of the branches in app.report_venues() over business days p_from..p_to (at most 400): {from, to, totals {days_closed, days_open, expected_iqd, counted_iqd, variance_iqd (closed days), short_days, short_iqd (positive), over_days, over_iqd, card_gap_iqd (terminal batch minus card expected, where a batch was entered), shifts, shifts_uncounted, shift_variance_iqd, handover_difference_iqd, handed_in_iqd (live day-close hand-ins), hand_in_gap_iqd (closed days: box net cash minus its hand-in)}, by_box [{box, shifts, variance_iqd, net_cash_iqd, handed_in_iqd}]}; p_detail days (default) adds days_total and days [{business_date, branch, status, expected, counted, variance, card_expected, card_batch, closed_by_name, notes, boxes [{box, net, handed_in}]}] (the latest 100, in date order); shifts adds also shifts_total and shifts [{business_date, branch, station, box, staff_id, staff_name, opened_at, closed_at, closed_via, expected, counted, variance, handover_difference_iqd}] (the latest 200, in time order); none: totals and by_box only. A box''s net cash is main_cash_day_boxes'' (0343): cash taken at its stations less the cash refunds counted under the day. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.assistant_cash_closes(date, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b. app.assistant_costs_summary (new, tool costs_summary)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_costs_summary(
  p_from  date,
  p_to    date,
  p_group text default 'month'
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_costs_summary_0421$
declare
  v_rv       uuid[];
  v_group    text := coalesce(p_group, 'month');
  v_buckets  int;
  v_ph       jsonb;
  v_revenue  bigint;
  v_legacy   boolean;
  v_since    date;
  v_out      jsonb;
  v_note     text;
  -- 0343's categories, in the Safe page's order
  v_cats     text[] := array['shopping','supplier','rent','bills','repairs','marketing','other','wages','advance','coach_pay'];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must be at most 400 days';
  end if;
  if v_group not in ('day', 'week', 'month') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_group', hint = 'day, week or month';
  end if;
  select count(distinct case v_group when 'day' then d::date
                                     when 'week' then date_trunc('week', d)::date
                                     else date_trunc('month', d)::date end)
    into v_buckets
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d;
  if v_buckets > 31 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = format('%s buckets; at most 31 (use group week or month for a longer range)', v_buckets);
  end if;
  v_rv := app.report_venues();

  -- Revenue exactly as the management panel shows it for the same range and branches.
  v_ph := app.panel_headline(p_from, p_to, 'none');
  select (f ->> 'value')::bigint into v_revenue
    from jsonb_array_elements(v_ph -> 'figures') f
   where f ->> 'key' = 'revenue';
  v_legacy := jsonb_array_length(coalesce(v_ph #> '{history,period,included}', '[]'::jsonb)) > 0;
  select min(e.occurred_on) into v_since from main_cash_entries e where e.venue_id = any(v_rv);

  with
  pay as materialized (
    select e.*, v.name_en as branch,
           case v_group when 'day' then e.occurred_on
                        when 'week' then date_trunc('week', e.occurred_on)::date
                        else date_trunc('month', e.occurred_on)::date end as b
      from main_cash_entries e
      join venues v on v.id = e.venue_id
     where e.venue_id = any(v_rv)
       and e.kind = 'payment' and e.voided_at is null and e.paid_from in ('safe', 'bank')
       and e.occurred_on between p_from and p_to),
  buckets as (
    select distinct case v_group when 'day' then d::date
                                 when 'week' then date_trunc('week', d)::date
                                 else date_trunc('month', d)::date end as b
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d)
  select jsonb_build_object(
    'from',  p_from,
    'to',    p_to,
    'group', v_group,
    'basis', 'cash',
    'totals', jsonb_build_object(
      'total_iqd',      (select coalesce(sum(amount_iqd), 0) from pay),
      'from_safe_iqd',  (select coalesce(sum(amount_iqd), 0) from pay where paid_from = 'safe'),
      'from_bank_iqd',  (select coalesce(sum(amount_iqd), 0) from pay where paid_from = 'bank'),
      'count',          (select count(*) from pay),
      'revenue_iqd',    v_revenue,
      -- No cost recorded at all for these branches: revenue minus nothing is not a
      -- result, so none is given (the note says why).
      'cash_result_iqd', case when v_legacy or v_revenue is null or v_since is null then null
                              else v_revenue - (select coalesce(sum(amount_iqd), 0) from pay) end),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', c.cat, 'total_iqd', c.total, 'count', c.n)
                                              order by c.ord), '[]'::jsonb)
                      from (select u.cat, u.ord, sum(p.amount_iqd)::bigint as total, count(*)::int as n
                              from unnest(v_cats) with ordinality as u(cat, ord)
                              join pay p on p.category = u.cat
                             group by u.cat, u.ord) c),
    'by_branch', (select coalesce(jsonb_agg(jsonb_build_object('branch', x.branch, 'total_iqd', x.total)
                                            order by x.branch), '[]'::jsonb)
                    from (select branch, sum(amount_iqd)::bigint as total from pay group by branch) x),
    'by_bucket', (select coalesce(jsonb_agg(jsonb_build_object(
                           'period', bk.b,
                           'total_iqd', coalesce((select sum(p.amount_iqd) from pay p where p.b = bk.b), 0))
                           order by bk.b), '[]'::jsonb)
                    from buckets bk),
    'costs_recorded_from', v_since)
    into v_out;

  if v_legacy then
    v_note := 'revenue_iqd includes pre-system monthly reports, which carry revenue but no costs, so no cash result is given for this range';
  end if;
  if v_since is null or v_since > p_from then
    v_note := concat_ws('; ', v_note,
      case when v_since is null then 'no cost is recorded in the safe for these branches yet, so no cash result is given'
           else format('costs are recorded in the safe from %s; earlier days in the range have revenue but no recorded costs', v_since) end);
  end if;
  if v_note is not null then
    v_out := v_out || jsonb_build_object('note', v_note);
  end if;

  return v_out;
end $assistant_costs_summary_0421$;

comment on function app.assistant_costs_summary(date, date, text) is
  '0421. Owner-only, read-only, reached through app.assistant_run_tool (tool costs_summary). Cash basis: the live payments (main_cash_entries kind payment, not voided) paid from the safe or the bank at the branches in app.report_venues() with occurred_on in p_from..p_to (at most 400 days, at most 31 buckets of p_group day | week | month, default month). Deliveries and supplier receipts are stock coming in, not costs here. {from, to, group, basis: cash, totals {total_iqd, from_safe_iqd, from_bank_iqd, count, revenue_iqd (app.panel_headline revenue for the same range), cash_result_iqd (revenue_iqd - total_iqd; null when panel_headline counts a pre-system monthly report, which carries revenue but no costs)}, by_category [{category, total_iqd, count}] (0343 order, categories with a payment only), by_branch [{branch, total_iqd}], by_bucket [{period, total_iqd}] (every bucket), costs_recorded_from (the first safe row at these branches), note (why cash_result_iqd is null, or that the range starts before costs were recorded)}. A cash result, never accounting profit. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.assistant_costs_summary(date, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1c. app.assistant_safe_summary (new, tool safe_summary)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_safe_summary(
  p_from date,
  p_to   date,
  p_rows boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_safe_summary_0421$
declare
  v_rv  uuid[];
  v_out jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must be at most 400 days';
  end if;
  v_rv := app.report_venues();

  with
  live as materialized (
    select e.*
      from main_cash_entries e
     where e.venue_id = any(v_rv) and e.voided_at is null),
  inr as (select * from live where occurred_on between p_from and p_to),
  br as (
    select v.id as venue_id, v.name_en as branch,
           (select coalesce(sum(l.delta_iqd), 0) from live l where l.venue_id = v.id)::bigint as balance_now,
           (select coalesce(sum(l.delta_iqd), 0) from live l where l.venue_id = v.id and l.occurred_on < p_from)::bigint as opening,
           (select coalesce(sum(l.delta_iqd), 0) from live l where l.venue_id = v.id and l.occurred_on <= p_to)::bigint as closing,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'hand_in' and i.box = 'cafe')::bigint as hin_cafe,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'hand_in' and i.box = 'desk')::bigint as hin_desk,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'hand_in' and i.box = 'shop')::bigint as hin_shop,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'owner_in')::bigint as owner_in,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'bank_in')::bigint as bank_in,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'payment' and i.paid_from = 'safe')::bigint as paid_safe,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'to_drawer')::bigint as to_drawer,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'owner_out')::bigint as owner_out,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'bank_out')::bigint as bank_out,
           (select coalesce(sum(i.delta_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'count')::bigint as count_adjust,
           (select coalesce(sum(i.amount_iqd), 0) from inr i where i.venue_id = v.id and i.kind = 'payment' and i.paid_from = 'bank')::bigint as paid_bank,
           (select jsonb_build_object('counted', c.amount_iqd, 'difference', c.delta_iqd, 'at', c.logged_at)
              from live c where c.venue_id = v.id and c.kind = 'count' and c.occurred_on <= p_to
             order by c.occurred_on desc, c.logged_at desc, c.id desc limit 1) as last_count
      from venues v
     where v.id = any(v_rv)
       and exists (select 1 from main_cash_entries e where e.venue_id = v.id))
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'by_branch', (select coalesce(jsonb_agg(jsonb_build_object(
                    'branch',          b.branch,
                    'balance_now_iqd', b.balance_now,
                    'opening_iqd',     b.opening,
                    'closing_iqd',     b.closing,
                    'in',  jsonb_build_object('hand_in_by_box', jsonb_build_object('cafe', b.hin_cafe, 'desk', b.hin_desk, 'shop', b.hin_shop),
                                              'owner_in', b.owner_in, 'bank_in', b.bank_in),
                    'out', jsonb_build_object('paid_from_safe', b.paid_safe, 'to_drawer', b.to_drawer,
                                              'owner_out', b.owner_out, 'bank_out', b.bank_out),
                    'count_adjust_iqd',  b.count_adjust,
                    'paid_by_bank_iqd',  b.paid_bank,
                    'last_count',        b.last_count)
                    order by b.branch, b.venue_id), '[]'::jsonb) from br b),
    'totals', (select jsonb_build_object(
                 'balance_now_iqd',  coalesce(sum(b.balance_now), 0),
                 'opening_iqd',      coalesce(sum(b.opening), 0),
                 'closing_iqd',      coalesce(sum(b.closing), 0),
                 'in_iqd',           coalesce(sum(b.hin_cafe + b.hin_desk + b.hin_shop + b.owner_in + b.bank_in), 0),
                 'hand_in_iqd',      coalesce(sum(b.hin_cafe + b.hin_desk + b.hin_shop), 0),
                 'out_iqd',          coalesce(sum(b.paid_safe + b.to_drawer + b.owner_out + b.bank_out), 0),
                 'paid_from_safe_iqd', coalesce(sum(b.paid_safe), 0),
                 'count_adjust_iqd', coalesce(sum(b.count_adjust), 0),
                 'paid_by_bank_iqd', coalesce(sum(b.paid_bank), 0),
                 'rows_in_range',    (select count(*) from inr),
                 'voided_rows_in_range', (select count(*) from main_cash_entries e
                                           where e.venue_id = any(v_rv) and e.voided_at is not null
                                             and e.occurred_on between p_from and p_to))
                 from br b))
    || case when coalesce(p_rows, false) then jsonb_build_object(
         'rows_total', (select count(*) from inr),
         -- the latest 200 live rows, listed in date order
         'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                    'occurred_on',    r.occurred_on,
                    'branch',         v.name_en,
                    'kind',           r.kind,
                    'category',       r.category,
                    'box',            r.box,
                    'amount',         r.amount_iqd,
                    'delta',          r.delta_iqd,
                    'paid_from',      r.paid_from,
                    'payee',          r.payee,
                    'note',           r.note,
                    'logged_by_name', (select s.display_name from staff s where s.id = r.logged_by),
                    'source',         r.source)
                    order by r.occurred_on, r.logged_at, r.id), '[]'::jsonb)
                    from (select * from inr order by occurred_on desc, logged_at desc, id desc limit 200) r
                    join venues v on v.id = r.venue_id))
       else '{}'::jsonb end
    into v_out;

  return v_out;
end $assistant_safe_summary_0421$;

comment on function app.assistant_safe_summary(date, date, boolean) is
  '0421. Owner-only, read-only, reached through app.assistant_run_tool (tool safe_summary). The safe (main_cash_entries, live rows) of each branch in app.report_venues() that has one, by occurred_on in p_from..p_to (at most 400 days): {from, to, by_branch [{branch, balance_now_iqd (app.main_cash_balance), opening_iqd (before p_from), closing_iqd (to p_to; = opening + in - out + count_adjust), in {hand_in_by_box {cafe, desk, shop}, owner_in, bank_in}, out {paid_from_safe, to_drawer, owner_out, bank_out}, count_adjust_iqd, paid_by_bank_iqd (costs paid by transfer: no effect on the safe), last_count {counted, difference, at} (the latest on or before p_to)}] in branch name order, totals (the same summed, + rows_in_range, voided_rows_in_range)}; p_rows true adds rows_total and rows [{occurred_on, branch, kind, category, box, amount, delta, paid_from, payee, note, logged_by_name, source}] (the latest 200 live rows, in date order). Payee and note of every source, wages, advances and coach pay included (Majed, 2026-11-12: full access). FORBIDDEN, INVALID_RANGE.';

revoke all on function app.assistant_safe_summary(date, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1d. app.assistant_wages_summary (new, tool wages_summary)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_wages_summary(
  p_from   date,
  p_to     date,
  p_detail boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_wages_summary_0421$
declare
  v_rv     uuid[];
  v_m0     date;
  v_m1     date;
  v_months int;
  v_out    jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must touch at most 12 pay months';
  end if;
  v_m0 := date_trunc('month', p_from)::date;
  v_m1 := date_trunc('month', p_to)::date;
  v_months := (extract(year from age(v_m1, v_m0)) * 12 + extract(month from age(v_m1, v_m0)))::int + 1;
  if v_months > 12 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = format('%s pay months; at most 12', v_months);
  end if;
  v_rv := app.report_venues();

  -- wages_month's people (0355) per branch and pay month, and app.wage_line for
  -- each, so every figure is the Wages page's.
  with
  vm as materialized (
    select v.id as venue_id, v.name_en as branch, m::date as month,
           app.venue_business_date(v.id) as today,
           coalesce(app.cafe_setting_int('wage_reminder_days', v.id), 3) as remind
      from venues v
     cross join generate_series(v_m0::timestamp, v_m1::timestamp, interval '1 month') m
     where v.id = any(v_rv)),
  people as (
    select vm.*, s.id as staff_id, s.display_name, s.role
      from vm
      join staff s on s.role <> 'owner'
       and ((s.is_active and exists (select 1 from staff_venues sv
                                      where sv.staff_id = s.id and sv.venue_id = vm.venue_id))
            or exists (select 1 from wage_payments p
                        where p.venue_id = vm.venue_id and p.staff_id = s.id and p.pay_month = vm.month)
            or exists (select 1 from salary_deductions d
                        where d.venue_id = vm.venue_id and d.staff_id = s.id
                          and d.status = 'approved' and d.pay_month = vm.month)
            or exists (select 1 from staff_attendance a
                        where a.venue_id = vm.venue_id and a.staff_id = s.id and a.pay_month = vm.month)
            or exists (select 1 from staff_reward_earnings e
                        where e.venue_id = vm.venue_id and e.staff_id = s.id and e.pay_month = vm.month)
            or exists (select 1 from shop_sale_reward_earnings e
                        where e.venue_id = vm.venue_id and e.staff_id = s.id and e.pay_month = vm.month)
            or exists (select 1 from wage_advances a
                        where a.venue_id = vm.venue_id and a.staff_id = s.id
                          and a.pay_month = vm.month and a.status = 'given'))),
  lines as materialized (
    select p.*, app.wage_line(p.venue_id, p.staff_id, p.month, p.today, p.remind) as line
      from people p),
  agg as (
    select l.*,
           (l.line ->> 'salary_iqd')::bigint     as salary,
           (l.line ->> 'deductions_iqd')::bigint as deductions,
           (l.line ->> 'penalties_iqd')::bigint  as penalties,
           (l.line ->> 'bonuses_iqd')::bigint    as bonuses,
           (l.line ->> 'net_iqd')::bigint        as net,
           (l.line ->> 'advances_iqd')::bigint   as advances,
           (l.line ->> 'to_pay_iqd')::bigint     as to_pay,
           case when l.line ->> 'status' = 'paid' then (l.line #>> '{payment,paid_iqd}')::bigint end as paid,
           case when l.line ->> 'status' = 'paid' then l.line #>> '{payment,paid_from}' end as paid_from,
           l.line ->> 'status' as status
      from lines l)
  select jsonb_build_object(
    'from_month', v_m0,
    'to_month',   v_m1,
    'totals', (select jsonb_build_object(
                 'salary_iqd',     coalesce(sum(a.salary), 0),
                 'deductions_iqd', coalesce(sum(a.deductions), 0),
                 'penalties_iqd',  coalesce(sum(a.penalties), 0),
                 'bonuses_iqd',    coalesce(sum(a.bonuses), 0),
                 'net_iqd',        coalesce(sum(a.net), 0),
                 'advances_iqd',   coalesce(sum(a.advances), 0),
                 'to_pay_iqd',     coalesce(sum(a.to_pay), 0),
                 'paid_iqd',       coalesce(sum(a.paid), 0),
                 'people',         count(distinct a.staff_id),
                 'lines',          count(*),
                 'paid',           count(*) filter (where a.status = 'paid'),
                 'due',            count(*) filter (where a.status = 'due'),
                 'overdue',        count(*) filter (where a.status = 'overdue'),
                 'upcoming',       count(*) filter (where a.status = 'upcoming'),
                 'unset',          count(*) filter (where a.status = 'unset'),
                 'paid_from_safe_iqd', coalesce(sum(a.paid) filter (where a.paid_from = 'safe'), 0),
                 'paid_from_bank_iqd', coalesce(sum(a.paid) filter (where a.paid_from = 'bank'), 0),
                 -- advances handed over between p_from and p_to (by the business date they were given)
                 'advances_given_iqd', (select coalesce(sum(w.amount_iqd), 0) from wage_advances w
                                          where w.venue_id = any(v_rv) and w.status = 'given'
                                            and app.venue_business_date(w.venue_id, w.given_at) between p_from and p_to))
                 from agg a),
    'by_branch_month', (select coalesce(jsonb_agg(jsonb_build_object(
                          'branch', x.branch, 'pay_month', x.month, 'people', x.n,
                          'salary_iqd', x.salary, 'net_iqd', x.net, 'advances_iqd', x.advances,
                          'paid_iqd', x.paid, 'to_pay_iqd', x.to_pay)
                          order by x.month, x.branch), '[]'::jsonb)
                          from (select a.branch, a.month, count(*) as n, sum(a.salary) as salary, sum(a.net) as net,
                                       sum(a.advances) as advances, coalesce(sum(a.paid), 0) as paid, sum(a.to_pay) as to_pay
                                  from agg a group by a.venue_id, a.branch, a.month) x),
    'people_total', (select count(*) from agg),
    -- name order, never by a figure (docs/PRODUCT.md: nothing grades staff)
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
                 'staff_id',       a.staff_id,
                 'staff_name',     a.display_name,
                 'role',           a.role,
                 'branch',         a.branch,
                 'pay_month',      a.month,
                 'salary_iqd',     a.salary,
                 'deductions_iqd', a.deductions,
                 'penalties_iqd',  a.penalties,
                 'bonuses_iqd',    a.bonuses,
                 'advances_iqd',   a.advances,
                 'net_iqd',        a.net,
                 'paid_iqd',       a.paid,
                 'to_pay_iqd',     a.to_pay,
                 'status',         a.status,
                 'paid_from',      a.paid_from)
                 || case when coalesce(p_detail, false) then jsonb_build_object('lines',
                      (select coalesce(jsonb_agg(z.j order by z.d, z.k), '[]'::jsonb) from (
                         select d.deduction_date as d, 1 as k,
                                jsonb_build_object('kind', 'deduction', 'date', d.deduction_date,
                                                   'amount_iqd', d.amount_iqd, 'note', d.reason) as j
                           from salary_deductions d
                          where d.venue_id = a.venue_id and d.staff_id = a.staff_id
                            and d.status = 'approved' and d.pay_month = a.month
                         union all
                         select t.work_date, 2,
                                jsonb_build_object('kind', 'lateness', 'date', t.work_date, 'late_minutes', t.late_minutes,
                                                   'early_leave_minutes', t.early_leave_minutes,
                                                   'amount_iqd', t.penalty_iqd, 'note', t.note)
                           from staff_attendance t
                          where t.venue_id = a.venue_id and t.staff_id = a.staff_id and t.pay_month = a.month
                         union all
                         select (e ->> 'given_at')::timestamptz::date, 3,
                                jsonb_build_object('kind', 'advance', 'date', (e ->> 'given_at')::timestamptz::date,
                                                   'amount_iqd', (e ->> 'amount_iqd')::bigint,
                                                   'paid_from', e ->> 'paid_from', 'note', e ->> 'note')
                           from jsonb_array_elements(a.line -> 'advances') e) z))
                    else '{}'::jsonb end
                 order by a.display_name, a.staff_id, a.month, a.branch), '[]'::jsonb)
                 from (select * from agg order by display_name, staff_id, month, branch limit 300) a))
    into v_out;

  return v_out;
end $assistant_wages_summary_0421$;

comment on function app.assistant_wages_summary(date, date, boolean) is
  '0421. Owner-only, read-only, reached through app.assistant_run_tool (tool wages_summary). Wages of the pay months p_from..p_to touch (at most 12) at the branches in app.report_venues(): app.wage_line for wages_month''s people (0355) of every branch and month, so each figure is the Wages page''s. {from_month, to_month, totals {salary_iqd, deductions_iqd, penalties_iqd, bonuses_iqd, net_iqd, advances_iqd, to_pay_iqd, paid_iqd, people (distinct), lines (person-months), paid, due, overdue, upcoming, unset, paid_from_safe_iqd, paid_from_bank_iqd, advances_given_iqd (advances handed over between p_from and p_to)}, by_branch_month [{branch, pay_month, people, salary_iqd, net_iqd, advances_iqd, paid_iqd, to_pay_iqd}], people_total, people [{staff_id, staff_name, role, branch, pay_month, salary_iqd, deductions_iqd, penalties_iqd, bonuses_iqd, advances_iqd, net_iqd, paid_iqd, to_pay_iqd, status, paid_from}] in name order (at most 300), each with lines [{kind deduction | lateness | advance, date, amount_iqd, late_minutes, early_leave_minutes, paid_from, note}] only when p_detail}. Never ordered by a figure (Majed, 2026-11-12: wages readable by name; docs/PRODUCT.md: nothing grades staff). FORBIDDEN, INVALID_RANGE.';

revoke all on function app.assistant_wages_summary(date, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1e. app.assistant_attendance_summary (new, tool attendance_summary)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_attendance_summary(
  p_from date,
  p_to   date
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_attendance_summary_0421$
declare
  v_rv  uuid[];
  v_out jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must be at most 400 days';
  end if;
  v_rv := app.report_venues();

  with
  rec as materialized (
    select a.*
      from staff_attendance a
     where a.venue_id = any(v_rv) and a.work_date between p_from and p_to),
  per as (
    select r.staff_id, s.display_name, s.role,
           count(*)                                  as days,
           coalesce(sum(r.late_minutes), 0)          as late,
           coalesce(sum(r.early_leave_minutes), 0)   as early,
           count(*) filter (where r.penalty_iqd > 0) as pen_days,
           coalesce(sum(r.penalty_iqd), 0)           as pen
      from rec r
      join staff s on s.id = r.staff_id
     group by r.staff_id, s.display_name, s.role),
  pres as (
    select t.staff_id, s.display_name,
           count(distinct d.business_date) as shift_days,
           min(t.opened_at) as first_open,
           max(t.closed_at) as last_close
      from till_shifts t
      join day_sessions d on d.id = t.day_session_id
      join staff s on s.id = t.staff_id
     where d.venue_id = any(v_rv) and d.business_date between p_from and p_to
     group by t.staff_id, s.display_name)
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'coverage', 'Only lateness and early leaving a manager typed in exist (staff_attendance); there is no clock-in and no rota, so a day with no record is unknown, not on time. presence is cash staff only, from till shift open and close times. Breaks stopped being recorded on 2026-11-01.',
    'totals', jsonb_build_object(
      'days_recorded',       (select count(*) from rec),
      'people',              (select count(distinct staff_id) from rec),
      'late_minutes',        (select coalesce(sum(late_minutes), 0) from rec),
      'early_leave_minutes', (select coalesce(sum(early_leave_minutes), 0) from rec),
      'penalty_days',        (select count(*) from rec where penalty_iqd > 0),
      'penalties_iqd',       (select coalesce(sum(penalty_iqd), 0) from rec)),
    'people_total', (select count(*) from per),
    -- name order, never by a figure (docs/PRODUCT.md: nothing grades staff)
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
                 'staff_id', p.staff_id, 'staff_name', p.display_name, 'role', p.role, 'days', p.days,
                 'late_minutes', p.late, 'early_leave_minutes', p.early,
                 'penalty_days', p.pen_days, 'penalties_iqd', p.pen)
                 order by p.display_name, p.staff_id), '[]'::jsonb)
                 from (select * from per order by display_name, staff_id limit 300) p),
    'presence_total', (select count(*) from pres),
    'presence', (select coalesce(jsonb_agg(jsonb_build_object(
                   'staff_id', x.staff_id, 'staff_name', x.display_name, 'shift_days', x.shift_days,
                   'first_open', x.first_open, 'last_close', x.last_close)
                   order by x.display_name, x.staff_id), '[]'::jsonb)
                   from (select * from pres order by display_name, staff_id limit 300) x))
    into v_out;

  return v_out;
end $assistant_attendance_summary_0421$;

comment on function app.assistant_attendance_summary(date, date) is
  '0421. Owner-only, read-only, reached through app.assistant_run_tool (tool attendance_summary). The lateness managers typed in (staff_attendance, 0270) at the branches in app.report_venues() with work_date in p_from..p_to (at most 400 days): {from, to, coverage (what exists and what does not: no clock-in, no rota, breaks stopped 2026-11-01), totals {days_recorded, people, late_minutes, early_leave_minutes, penalty_days, penalties_iqd}, people_total, people [{staff_id, staff_name, role, days, late_minutes, early_leave_minutes, penalty_days, penalties_iqd}] in name order (at most 300), presence_total, presence [{staff_id, staff_name, shift_days, first_open, last_close}] from till_shifts of the range''s day sessions, in name order (at most 300)}. Never ordered by a figure (Majed, 2026-11-12: attendance readable; docs/PRODUCT.md: nothing grades staff). FORBIDDEN, INVALID_RANGE.';

revoke all on function app.assistant_attendance_summary(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.assistant_run_tool: + the five 0421 tools
-- ---------------------------------------------------------------------------
create or replace function app.assistant_run_tool(p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_run_tool_0421$
declare
  a           jsonb := coalesce(p_args, '{}'::jsonb);
  v_result    jsonb;
  v_path      text;                 -- the catalog's rows_path for this tool
  v_count     int;
  v_truncated boolean;
  v_scope     text;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The wall. STABLE is a promise; this is the enforcement: from here to the
  -- end of the transaction any INSERT/UPDATE/DELETE/DDL reached through a
  -- dispatched RPC fails with 25006 read_only_sql_transaction.
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('statement_timeout', '8000', true);

  if jsonb_typeof(a) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_args', hint = 'an object of p_* keys';
  end if;

  case p_tool
    -- ── Money and headline ────────────────────────────────────────────────
    when 'panel_headline' then
      v_path := 'figures';
      v_result := app.panel_headline((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_compare', 'none'));
    when 'report_revenue' then
      v_path := 'rows';
      v_result := app.report_revenue((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     coalesce(a ->> 'p_group', 'day'), coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_compare' then
      v_result := app.report_compare(a ->> 'p_report', (a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     a ->> 'p_compare', coalesce(a ->> 'p_group', 'day'),
                                     coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_drill' then
      -- The RPC's row array is 'transactions' (the catalog says 'rows'; the
      -- dispatcher follows the RPC so row_count is real, and the mismatch is
      -- reported to the catalog's owner).
      v_path := 'transactions';
      v_result := app.report_drill(a ->> 'p_figure', a ->> 'p_key', (a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'assistant_payments_list' then
      v_path := 'rows';
      v_result := app.assistant_payments_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_method',
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);
    -- 0421: day closes, costs and the cash result, the safe
    when 'assistant_cash_closes' then
      v_path := 'days';
      v_result := app.assistant_cash_closes((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_detail', 'days'));
    when 'assistant_costs_summary' then
      v_path := 'by_category';
      v_result := app.assistant_costs_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_group', 'month'));
    when 'assistant_safe_summary' then
      v_path := 'rows';
      v_result := app.assistant_safe_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce((a ->> 'p_rows')::boolean, false));

    -- ── Cafe ──────────────────────────────────────────────────────────────
    when 'report_cafe' then
      v_result := app.report_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_daily_sales' then
      v_path := '$';
      v_result := app.analytics_daily_sales((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_sold_items' then
      v_path := '$';
      v_result := app.analytics_sold_items((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_best_sellers' then
      v_path := '$';
      v_result := app.analytics_best_sellers((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                             coalesce((a ->> 'p_limit')::int, 20), coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_item_margins' then
      v_result := app.analytics_item_margins((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_price_bands' then
      v_path := '$';
      v_result := app.analytics_price_bands((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_hourly' then
      v_path := '$';
      v_result := app.analytics_hourly((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_bought_together' then
      v_path := '$';
      -- The RPC's basket scope is 'order' | 'tab'; anything else falls back to
      -- its default rather than failing the whole turn.
      v_scope := case when a ->> 'p_scope' in ('order', 'tab') then a ->> 'p_scope' else 'order' end;
      v_result := app.analytics_bought_together((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                                coalesce((a ->> 'p_min_support')::int, 3),
                                                coalesce((a ->> 'p_limit')::int, 30), v_scope);
    when 'analytics_menu_snapshot' then
      v_result := app.analytics_menu_snapshot();
    when 'assistant_tabs_list' then
      v_path := 'rows';
      v_result := app.assistant_tabs_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_status',
                                          (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Courts ────────────────────────────────────────────────────────────
    when 'report_courts' then
      v_result := app.report_courts((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_courts_summary' then
      v_result := app.analytics_courts_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_demand' then
      v_result := app.analytics_courts_demand((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_endings' then
      v_result := app.analytics_courts_endings((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_guests' then
      v_result := app.analytics_courts_guests((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_cafe' then
      v_result := app.analytics_courts_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'assistant_bookings_list' then
      v_path := 'rows';
      v_result := app.assistant_bookings_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid,
                                              a ->> 'p_status', (a ->> 'p_customer_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);
    when 'assistant_unpaid_played_bookings' then   -- 0420
      v_path := 'rows';
      v_result := app.assistant_unpaid_played_bookings((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_limit')::int);
    when 'booking_bill' then
      v_result := app.booking_bill((a ->> 'p_reservation_id')::uuid);
    when 'series_detail' then
      v_result := app.series_detail((a ->> 'p_series_id')::uuid);
    when 'assistant_courts_and_rates' then
      v_result := app.assistant_courts_and_rates();

    -- ── Stock ─────────────────────────────────────────────────────────────
    when 'report_stock' then
      v_result := app.report_stock((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'assistant_stock_view' then
      v_path := 'rows';
      v_result := app.assistant_stock_view(a ->> 'p_view', (a ->> 'p_limit')::int, (a ->> 'p_offset')::int);

    -- ── Staff and ops ─────────────────────────────────────────────────────
    when 'ops_overview' then
      v_result := app.ops_overview();
    when 'list_staff' then
      v_path := '$';
      select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_result from app.list_staff() s;
    when 'staff_requests_page' then
      v_path := 'requests';   -- the RPC returns {requests, total, pending}; the catalog says the same
      v_result := app.staff_requests_page(a ->> 'p_status', coalesce((a ->> 'p_limit')::int, 50),
                                          coalesce((a ->> 'p_offset')::int, 0));
    when 'report_staff_activity' then
      v_path := 'rows';
      v_result := app.report_staff_activity((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid);
    when 'assistant_break_history' then
      v_path := 'rows';
      v_result := app.assistant_break_history((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);
    -- 0421: wages and attendance
    when 'assistant_wages_summary' then
      v_path := 'people';
      v_result := app.assistant_wages_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce((a ->> 'p_detail')::boolean, false));
    when 'assistant_attendance_summary' then
      v_path := 'people';
      v_result := app.assistant_attendance_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Audit ─────────────────────────────────────────────────────────────
    when 'assistant_audit_page' then
      v_path := 'rows';
      v_result := app.assistant_audit_page((a ->> 'p_from')::timestamptz, (a ->> 'p_to')::timestamptz,
                                           (a ->> 'p_actor_id')::uuid, a ->> 'p_action_prefix', a ->> 'p_text',
                                           (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Customers ─────────────────────────────────────────────────────────
    when 'customer_search' then
      v_path := '$';
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result
        from app.customer_search(a ->> 'p_query', coalesce((a ->> 'p_limit')::int, 12)) x;
    when 'customer_record' then
      v_result := app.customer_record((a ->> 'p_customer_id')::uuid);

    -- ── Marketing ─────────────────────────────────────────────────────────
    when 'analytics_promo' then
      v_result := app.analytics_promo((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'marketing_overview' then
      v_result := app.marketing_overview();
    when 'marketing_campaign_performance' then
      v_result := app.marketing_campaign_performance((a ->> 'p_campaign')::uuid);

    -- ── Tournaments, open matches, loyalty (0328) ────────────────────────
    when 'assistant_tournaments_summary' then
      v_path := 'tournaments';
      v_result := app.assistant_tournaments_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'report_matches' then
      v_path := 'byDay';
      v_result := app.report_matches((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'assistant_loyalty_summary' then
      v_path := 'tiers';
      v_result := app.assistant_loyalty_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Stored daily figures (0330) ───────────────────────────────────────
    when 'assistant_history_figures' then
      v_path := 'rows';
      v_result := app.assistant_history_figures((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                                coalesce(a ->> 'p_group', 'day'), coalesce((a ->> 'p_extra')::boolean, false));
    when 'assistant_history_items' then
      v_path := 'rows';
      v_result := app.assistant_history_items((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                              coalesce((a ->> 'p_limit')::int, 10), coalesce(a ->> 'p_order', 'revenue'));
    when 'assistant_history_courts' then
      v_path := 'rows';
      v_result := app.assistant_history_courts((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                               coalesce(a ->> 'p_group', 'range'), coalesce((a ->> 'p_hours')::boolean, false));
    when 'assistant_history_staff' then
      v_path := 'rows';
      v_result := app.assistant_history_staff((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Files (0354) ──────────────────────────────────────────────────────
    when 'assistant_files_list' then
      v_path := 'files';
      v_result := app.assistant_files_list(a ->> 'p_query', coalesce((a ->> 'p_limit')::int, 50));
    when 'assistant_file_get' then
      v_result := app.assistant_file_get((a ->> 'p_file_id')::uuid);

    -- ── Settings, system, any table ───────────────────────────────────────
    when 'assistant_settings_read' then
      v_result := app.assistant_settings_read();
    when 'assistant_system_status' then
      v_result := app.assistant_system_status();
    when 'assistant_table_read' then
      v_path := 'rows';
      v_result := app.assistant_table_read(
                    a ->> 'p_table',
                    case when a ? 'p_columns' and jsonb_typeof(a -> 'p_columns') = 'array'
                         then array(select jsonb_array_elements_text(a -> 'p_columns')) end,
                    a -> 'p_filters', a ->> 'p_order',
                    (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Meter (0111) ──────────────────────────────────────────────────────
    when 'assistant_usage' then
      v_path := 'days';
      v_result := app.assistant_usage((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    else
      raise exception 'ASSISTANT_UNKNOWN_TOOL' using errcode = 'P0001', detail = coalesce(p_tool, 'null');
  end case;

  -- row_count: the length of the array rows_path points at, when known.
  v_count := case
               when v_path = '$' and jsonb_typeof(v_result) = 'array' then jsonb_array_length(v_result)
               when v_path is not null and v_path <> '$' and jsonb_typeof(v_result -> v_path) = 'array'
                 then jsonb_array_length(v_result -> v_path)
             end;
  -- truncated: a paged list whose total exceeds what this page returned.
  v_truncated := case
                   when v_count is not null and jsonb_typeof(v_result) = 'object' and (v_result ->> 'total') ~ '^\d+$'
                     then (v_result ->> 'total')::bigint > coalesce((v_result ->> 'offset')::bigint, coalesce((a ->> 'p_offset')::bigint, 0)) + v_count
                   else false
                 end;

  return jsonb_build_object('tool', p_tool, 'data', v_result, 'row_count', v_count, 'truncated', v_truncated);
end $assistant_run_tool_0421$;

comment on function app.assistant_run_tool(text, jsonb) is
  '0109, 0328, 0330, 0354, 0420, 0421. Owner-only. THE read-only wall for the assistant: turns transaction_read_only on, then dispatches over the fixed catalog of read RPC names (packages/core/src/assistant/tools.ts DISPATCHED_RPCS) with arguments pulled from p_args by p_* name. Unknown names raise ASSISTANT_UNKNOWN_TOOL. Returns {tool, data, row_count, truncated}. Called with the owner''s JWT by the assistant-chat edge function.';

revoke all on function app.assistant_run_tool(text, jsonb) from public, anon;
grant execute on function app.assistant_run_tool(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.assistant_set_scopes: the catalog's full scope list
-- ---------------------------------------------------------------------------
create or replace function app.assistant_set_scopes(p_id uuid, p_scopes text[], p_range jsonb default null)
returns assistant_conversations
language plpgsql security definer set search_path = public as $assistant_set_scopes_0421$
declare
  -- The catalog's ASSISTANT_SCOPES (packages/core/src/assistant/tools.ts), in order.
  -- 0421: + engagement, files (tests/assistant-catalog.test.ts pins this list to the catalog).
  v_known text[] := array['cafe','courts','money','stock','staff','customers','audit',
                          'marketing','engagement','settings','system','howto','docs','tables','files'];
  v_bad   text;
  v_row   assistant_conversations%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_id';
  end if;
  if p_scopes is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_scopes';
  end if;

  select s into v_bad from unnest(p_scopes) s where s is null or not (s = any (v_known)) limit 1;
  if v_bad is not null or exists (select 1 from unnest(p_scopes) s where s is null) then
    raise exception 'ASSISTANT_UNKNOWN_SCOPE' using errcode = 'P0001',
      detail = coalesce(v_bad, 'null'),
      hint   = 'one of ' || array_to_string(v_known, ', ');
  end if;

  if p_range is not null then
    if jsonb_typeof(p_range) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_range',
        hint = '{"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}';
    end if;
    begin
      if (p_range ->> 'from') is not null and (p_range ->> 'to') is not null
         and (p_range ->> 'to')::date < (p_range ->> 'from')::date then
        raise exception 'INVALID_RANGE' using errcode = 'P0001';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_range',
        hint = 'dates as YYYY-MM-DD';
    end;
  end if;

  update assistant_conversations
     set scopes     = (select coalesce(array_agg(distinct s order by s), '{}') from unnest(p_scopes) s),
         range      = p_range,
         updated_at = now()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_row;
end $assistant_set_scopes_0421$;

comment on function app.assistant_set_scopes(uuid, text[], jsonb) is
  '0108, 0421 (engagement and files are known scopes). Owner-only. Replaces a chat''s context scopes (validated against the catalog list; ASSISTANT_UNKNOWN_SCOPE otherwise) and its optional date range, and returns the row. Audits nothing.';

revoke all on function app.assistant_set_scopes(uuid, text[], jsonb) from public, anon;
grant execute on function app.assistant_set_scopes(uuid, text[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. v_day_close_summary leaves table_read (no venue_id, so no branch scope)
-- ---------------------------------------------------------------------------
delete from app.assistant_readable_columns where table_name = 'v_day_close_summary';

-- ---------------------------------------------------------------------------
-- 5. The table comments say what is true now (Majed, 2026-11-12)
-- ---------------------------------------------------------------------------
comment on table main_cash_entries is
  'main_cash_entries (0343): the branch''s main cash (the safe). One row per payment (a cost, paid from the safe or by bank transfer), hand-in from a drawer box, float out to a box, owner or bank move, or count. delta_iqd is the row''s effect on the safe; the balance is the sum of live deltas. Written by the app.main_cash_* RPCs (and 0344''s wage, advance and coach pay RPCs); read through app.main_cash_overview. No client grant. 0421 (Majed, 2026-11-12: full access, payees included): read by the owner assistant''s safe_summary, costs_summary and cash_closes tools, owner only; never by any other model surface (analytics-insights, the free staff assistant) and not by table_read.';
comment on table staff_wages is
  'staff_wages (0270): a person''s monthly salary and pay day at one branch, dated by pay month: the rate for month M is the newest row with effective_month <= M. Written by the owner through app.set_staff_wage; read by the owner only. 0421 (Majed, 2026-11-12): read by the owner assistant''s wages_summary tool, owner only; never by any other model surface and not by table_read.';
comment on table wage_payments is
  'wage_payments (0270): the owner marked a person''s pay month paid at a branch, with a snapshot of the figures (salary, approved deductions, lateness penalties, net, the amount paid). One row per person and month; undone, the row stays with the reason until the month is paid again. A paid month is frozen. Read by the owner only. 0421 (Majed, 2026-11-12): read by the owner assistant''s wages_summary tool, owner only; never by any other model surface and not by table_read.';
comment on table wage_advances is
  'wage_advances (0344): part of a person''s wage handed over before pay day, counted against one pay month at one branch; app.wage_line takes the month''s given advances off what Mark paid hands over. Written by app.give_wage_advance / app.undo_wage_advance; read by the owner only. 0421 (Majed, 2026-11-12): read by the owner assistant''s wages_summary tool, owner only; never by any other model surface and not by table_read.';
comment on table salary_deductions is
  'salary_deductions (wave5-addendum §2.5, 0272): pay deductions a head proposes for a member of their team, or a manager for anyone at the venue, approved by the owner only; the owner''s own entry is recorded approved at once. An approved deduction comes off the person''s wage in its pay month (wages, 0270). Read by MGMT at the venue; the proposer and the person read through RPCs. 0421 (Majed, 2026-11-12): approved deductions are read by the owner assistant''s wages_summary tool, owner only; never by any other model surface and not by table_read.';
comment on table staff_attendance is
  'staff_attendance (0270): a manager or the owner records how late a person arrived and how early they left on a work day at a branch. The day costs penalty_rule_iqd when the minutes together exceed grace_minutes, both copied from the branch''s rule (attendance_grace_minutes, attendance_penalty_iqd) when recorded. It comes off the wage of pay_month: the work day''s month, or the person''s next unpaid month when that one was already paid. Read by MGMT at the branch, never a row about themselves. 0421 (Majed, 2026-11-12): read by the owner assistant''s attendance_summary and wages_summary tools, owner only, in name order and never as a ranking; never by any other model surface and not by table_read.';
comment on table staff_reward_earnings is
  'staff_reward_earnings (0333): a reward the person reached in a business month (earned_month, as 0332 names months), written by app.reward_sweep once that month ended and the next month''s first business day passed, one per person, target and month, with the bonus and prize copied and the wage month it is paid in (pay_month, the first unpaid one from the month after). Frozen once written: a later void or a changed reward never touches it. app.wage_line adds reward_iqd to the net of its pay month. Read by the owner only. 0421 (Majed, 2026-11-12): counted in the bonuses of the owner assistant''s wages_summary tool, owner only; never by any other model surface and not by table_read.';
comment on table shop_sale_reward_earnings is
  'shop_sale_reward_earnings (0355): what one person earned from their Touch Shop sales in a business month (earned_month, as 0332 names months), written by app.shop_reward_sweep once that month ended and the next month''s first business day passed: the net of their lines on the shop tabs settled in it (sales_iqd) and the reward at each tab''s frozen percent (reward_iqd), with the wage month it is paid in (pay_month, the first unpaid one from the month after). Frozen once written. app.wage_line adds reward_iqd to the bonuses of its pay month. Read by the owner only. 0421 (Majed, 2026-11-12): counted in the bonuses of the owner assistant''s wages_summary tool, owner only; never by any other model surface and not by table_read.';
