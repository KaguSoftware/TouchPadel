set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0328 — The owner assistant sees tournaments, open matches and loyalty
-- (owner call 2026-10-08).
--
-- The advisor role (prompt.ts, 2026-10-08) reasons in moves such as "it's
-- about time for a tournament", but until now the assistant could read none of
-- the data behind them: tournaments were readable only as the on/off setting,
-- open-match fill only as the block inside report_courts, loyalty not at all.
-- Three read tools close that, all aggregates, no guest identity:
--
--   * app.assistant_tournaments_summary(p_from, p_to) — new. Every tournament
--     starting in the range at the branches in scope, with entries against
--     the cap, plus the last one finished and the next one scheduled (days
--     since / until), whatever the range.
--   * app.report_matches (0265) — dispatched as it is: open matches started
--     against booked, seats by kind, no-shows, ticket money.
--   * app.assistant_loyalty_summary(p_from, p_to) — new. Members by tier, new
--     and active members, points earned, redeemed, clawed back and expired in
--     the range, and the outstanding balance with its IQD value. Points are
--     business-wide (L-7), so this is chain-wide whatever the branch scope.
--
-- app.assistant_run_tool is re-issued from its latest body (0266:24, itself
-- 0109:886 verbatim) with three `when` branches and the dollar tag 0328. The
-- two new functions have no client grant: only the definer dispatcher calls
-- them, like the other assistant_* readers (0109).

-- ---------------------------------------------------------------------------
-- 1. app.assistant_tournaments_summary
-- ---------------------------------------------------------------------------
create or replace function app.assistant_tournaments_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_tournaments_summary_0328$
declare
  v_rv    uuid[];
  v_today date;
  v_rows  jsonb;
  v_tot   jsonb;
  v_last  jsonb;
  v_next  jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  v_rv := app.report_venues();
  v_today := app.business_date(now());

  with t as (
    select t.*, v.name_en as branch,
           (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status = 'registered') as registered,
           (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status = 'waitlisted') as waitlisted,
           (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status = 'no_show')    as no_shows,
           (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status = 'withdrawn')  as withdrawn
      from tournaments t
      join venues v on v.id = t.venue_id
     where t.venue_id = any(v_rv)
       and app.business_date(t.starts_at) between p_from and p_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           t.id,
           'name',         t.name_en,
           'branch',       t.branch,
           'status',       t.status,
           'format',       t.format,
           'category',     t.category,
           'class',        t.class,
           'startDate',    app.business_date(t.starts_at),
           'endDate',      app.business_date(t.ends_at),
           'entryFeeIqd',  t.entry_fee_iqd,
           'maxEntries',   t.max_entries,
           'minEntries',   t.min_entries,
           'registered',   t.registered,
           'waitlisted',   t.waitlisted,
           'noShows',      t.no_shows,
           'withdrawn',    t.withdrawn) order by t.starts_at), '[]'::jsonb),
         jsonb_build_object(
           'tournaments', count(*),
           'finished',    count(*) filter (where t.status = 'finished'),
           'cancelled',   count(*) filter (where t.status = 'cancelled'),
           'registered',  coalesce(sum(t.registered), 0),
           'noShows',     coalesce(sum(t.no_shows), 0),
           'places',      coalesce(sum(t.max_entries) filter (where t.status <> 'cancelled'), 0))
    into v_rows, v_tot
    from t;

  -- Distinct entrants across the range, and how many had entered a tournament before it.
  v_tot := v_tot || (
    select jsonb_build_object(
             'distinctPlayers', count(distinct e.guest_id),
             'returningPlayers', count(distinct e.guest_id) filter (where exists (
                select 1 from tournament_entries p join tournaments pt on pt.id = p.tournament_id
                 where p.guest_id = e.guest_id and p.status in ('registered', 'no_show')
                   and pt.status <> 'cancelled' and app.business_date(pt.starts_at) < p_from)))
      from tournament_entries e
      join tournaments t on t.id = e.tournament_id
     where t.venue_id = any(v_rv)
       and t.status <> 'cancelled'
       and e.status in ('registered', 'no_show')
       and app.business_date(t.starts_at) between p_from and p_to);

  select jsonb_build_object('name', t.name_en, 'branch', v.name_en,
                            'finishedDate', app.business_date(t.finished_at),
                            'daysSince', v_today - app.business_date(t.finished_at))
    into v_last
    from tournaments t join venues v on v.id = t.venue_id
   where t.venue_id = any(v_rv) and t.status = 'finished' and t.finished_at is not null
   order by t.finished_at desc
   limit 1;

  select jsonb_build_object('name', t.name_en, 'branch', v.name_en, 'status', t.status,
                            'startDate', app.business_date(t.starts_at),
                            'daysUntil', app.business_date(t.starts_at) - v_today)
    into v_next
    from tournaments t join venues v on v.id = t.venue_id
   where t.venue_id = any(v_rv) and t.status in ('open', 'closed', 'running') and t.ends_at >= now()
   order by t.starts_at
   limit 1;

  return jsonb_build_object(
    'period',         jsonb_build_object('from', p_from, 'to', p_to),
    'totals',         v_tot,
    'lastFinished',   v_last,
    'nextScheduled',  v_next,
    'tournaments',    v_rows);
end $assistant_tournaments_summary_0328$;

comment on function app.assistant_tournaments_summary(date, date) is
  '0328. Owner-only, read-only, reached through app.assistant_run_tool (tool tournaments_summary). Tournaments starting in the range at the branches in scope (app.report_venues) with entries by status against the cap, totals with distinct and returning players, and the last finished and next scheduled tournament whatever the range. No guest identity.';

revoke all on function app.assistant_tournaments_summary(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.assistant_loyalty_summary
-- ---------------------------------------------------------------------------
create or replace function app.assistant_loyalty_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_loyalty_summary_0328$
declare
  v_settings record;
  v_points   jsonb;
  v_members  jsonb;
  v_tiers    jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  select enabled, point_value_iqd, iqd_per_point into v_settings from loyalty_settings where id;

  select jsonb_build_object(
           'earned',      coalesce(sum(l.delta) filter (where l.kind = 'earn'), 0),
           'redeemed',    coalesce(-sum(l.delta) filter (where l.kind in ('redeem', 'reward', 'redeem_void')), 0),
           'clawedBack',  coalesce(-sum(l.delta) filter (where l.kind = 'clawback'), 0),
           'expired',     coalesce(-sum(l.delta) filter (where l.kind = 'expire'), 0),
           'adjusted',    coalesce(sum(l.delta) filter (where l.kind = 'adjust'), 0),
           'activeMembers', count(distinct l.profile_id) filter (where l.kind not in ('expire', 'merge_in')),
           'redeemingMembers', count(distinct l.profile_id) filter (where l.kind in ('redeem', 'reward')))
    into v_points
    from loyalty_ledger l
   where app.business_date(l.created_at) between p_from and p_to;

  select jsonb_build_object(
           'members',          count(*),
           'newMembers',       count(*) filter (where f.first_day between p_from and p_to),
           'balancePoints',    coalesce(sum(a.balance), 0),
           'balanceValueIqd',  coalesce(sum(a.balance), 0)::bigint * coalesce(v_settings.point_value_iqd, 0))
    into v_members
    from loyalty_accounts a
    left join lateral (select app.business_date(min(l.created_at)) as first_day
                         from loyalty_ledger l where l.profile_id = a.profile_id) f on true;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tier',          t.name_en,
           'minPoints12m',  t.min_points_12m,
           'members',       (select count(*) from loyalty_accounts a where a.tier_id = t.id)) order by t.sort), '[]'::jsonb)
    into v_tiers
    from loyalty_tiers t;

  return jsonb_build_object(
    'period',        jsonb_build_object('from', p_from, 'to', p_to),
    'enabled',       coalesce(v_settings.enabled, false),
    'pointValueIqd', v_settings.point_value_iqd,
    'iqdPerPoint',   v_settings.iqd_per_point,
    'chainWide',     true,
    'members',       v_members,
    'points',        v_points,
    'tiers',         v_tiers);
end $assistant_loyalty_summary_0328$;

comment on function app.assistant_loyalty_summary(date, date) is
  '0328. Owner-only, read-only, reached through app.assistant_run_tool (tool loyalty_summary). Chain-wide (points are business-wide, L-7): members, new and active members, members by tier, points earned / redeemed / clawed back / expired / adjusted in the range (business days of the ledger rows), and the outstanding balance with its IQD value at point_value_iqd. No guest identity.';

revoke all on function app.assistant_loyalty_summary(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.assistant_run_tool — re-issued from 20261001000266_hosted_drift_0109_0111.sql:24
--    with three branches (tournaments, open matches, loyalty)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_run_tool(p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_run_tool_0328$
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
end $assistant_run_tool_0328$;

comment on function app.assistant_run_tool(text, jsonb) is
  '0109, 0328. Owner-only. THE read-only wall for the assistant: turns transaction_read_only on, then dispatches over the fixed catalog of read RPC names (packages/core/src/assistant/tools.ts DISPATCHED_RPCS) with arguments pulled from p_args by p_* name. Unknown names raise ASSISTANT_UNKNOWN_TOOL. Returns {tool, data, row_count, truncated}. Called with the owner''s JWT by the assistant-chat edge function.';

revoke all on function app.assistant_run_tool(text, jsonb) from public, anon;
grant execute on function app.assistant_run_tool(text, jsonb) to authenticated;
