-- 0365 insights_percentages, 2026-10-22 (Majed: "in the analytics / insights
-- page there are percentages, so they are more in the picture of how much up,
-- how much down, how much this, how much that").
--
-- WHAT CHANGES (app.marketing_insights, 0360's body otherwise verbatim)
--   - every trend keeps its word and gains its size beside it:
--       <trend>Pct  the percent change of a count or a sum (bookings, players,
--                   café spend per booking, the money mix), from
--                   app.mkt_change;
--       <trend>Pts  the points a rate moved (court fill, cancellations,
--                   no-shows, app share, café crossover), from
--                   app.mkt_points;
--     both null where the word is 'unknown' (too thin, or no baseline) and
--     a percent change is null when the comparison was zero;
--   - shares are whole percents (they were rounded to 10, the money mix to
--     5); the minimum behind a share stays, so a share of five bookings is
--     still no finding;
--   - the court fill (levelPct) and the tournaments' fill (fillPct) as whole
--     percents beside their levels.
-- Still no money figure, no exact count and no guest identity: a percent
-- change of revenue says how far it moved, never how much it was.
--
-- covered by packages/db/tests/marketing-insights.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The size helpers. Internal: service_role only, as 0360's wording helpers.
-- ---------------------------------------------------------------------------

-- Now against the comparison as a whole percent change; null exactly where
-- app.mkt_trend says 'unknown', and when the comparison was zero (no base to
-- divide by: the word says 'up').
create or replace function app.mkt_change(p_now numeric, p_prev numeric, p_min numeric default 10)
returns int
language sql immutable set search_path = public as $mkt_change_0365$
  select case
           when p_now is null or p_prev is null then null
           when p_now + p_prev < p_min then null
           when p_prev = 0 then null
           else round(100.0 * (p_now - p_prev) / p_prev)::int
         end
$mkt_change_0365$;

-- A rate's move in whole points (both are percentages); null where
-- app.mkt_rate_trend says 'unknown'.
create or replace function app.mkt_points(p_now numeric, p_prev numeric)
returns int
language sql immutable set search_path = public as $mkt_points_0365$
  select case
           when p_now is null or p_prev is null then null
           else round(p_now - p_prev)::int
         end
$mkt_points_0365$;

revoke all on function app.mkt_change(numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function app.mkt_points(numeric, numeric) from public, anon, authenticated;
grant execute on function app.mkt_change(numeric, numeric, numeric) to service_role;
grant execute on function app.mkt_points(numeric, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.marketing_insights — 0360's body, plus the sizes and the percents.
-- ---------------------------------------------------------------------------
create or replace function app.marketing_insights(
  p_from     date,
  p_to       date,
  p_cmp_from date,
  p_cmp_to   date
) returns jsonb
language plpgsql security definer set search_path = public as $marketing_insights_0365$
declare
  v_rv        uuid[];
  v_sum       jsonb;
  v_sum_p     jsonb;
  v_guests    jsonb;
  v_guests_p  jsonb;
  v_demand    jsonb;
  v_demand_p  jsonb;
  v_cafe      jsonb;
  v_cafe_p    jsonb;
  v_hourly    jsonb;
  v_best      jsonb;
  v_daily     jsonb;
  v_daily_p   jsonb;
  v_shop      jsonb;
  v_shop_p    jsonb;
  v_k         jsonb;
  v_kp        jsonb;
  v_out       jsonb;
  v_cafe_iqd  numeric;
  v_cafe_iqd_p numeric;
  v_court_iqd numeric;
  v_court_iqd_p numeric;
  v_shop_iqd  numeric;
  v_shop_iqd_p numeric;
  v_total     numeric;
  v_total_p   numeric;
  v_mobile    numeric;
  v_mobile_p  numeric;
  v_booked    numeric;
  v_booked_p  numeric;
  v_max       numeric;
begin
  if not app.is_staff('marketing', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from
     or p_cmp_from is null or p_cmp_to is null or p_cmp_to < p_cmp_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  -- The owner's reads, for this transaction only (see the header).
  perform set_config('app.marketing_read', 'on', true);

  v_rv := app.report_venues();

  v_sum      := app.analytics_courts_summary(p_from, p_to, null);
  v_sum_p    := app.analytics_courts_summary(p_cmp_from, p_cmp_to, null);
  v_guests   := app.analytics_courts_guests(p_from, p_to, null);
  v_guests_p := app.analytics_courts_guests(p_cmp_from, p_cmp_to, null);
  v_demand   := app.analytics_courts_demand(p_from, p_to, null);
  v_demand_p := app.analytics_courts_demand(p_cmp_from, p_cmp_to, null);
  v_cafe     := app.analytics_courts_cafe(p_from, p_to, null);
  v_cafe_p   := app.analytics_courts_cafe(p_cmp_from, p_cmp_to, null);
  v_hourly   := app.analytics_hourly(p_from, p_to);
  v_best     := app.analytics_best_sellers(p_from, p_to, 500);
  v_daily    := app.analytics_daily_sales(p_from, p_to);
  v_daily_p  := app.analytics_daily_sales(p_cmp_from, p_cmp_to);
  v_shop     := app.analytics_shop(p_from, p_to);
  v_shop_p   := app.analytics_shop(p_cmp_from, p_cmp_to);

  perform set_config('app.marketing_read', '', true);

  v_k  := coalesce(v_sum -> 'kpis', '{}'::jsonb);
  v_kp := coalesce(v_sum_p -> 'kpis', '{}'::jsonb);

  -- ---- Demand: when the courts fill, as levels and ranked slots ----------
  with cells as (
    select (c ->> 'dow')::int as dow,
           (c ->> 'hour')::int as hour,
           coalesce((c ->> 'open_minutes')::numeric, 0) as open_min,
           coalesce((c ->> 'open_days')::numeric, 0) as open_days,
           coalesce((c ->> 'booked_minutes')::numeric, 0) + coalesce((c ->> 'lesson_minutes')::numeric, 0) as used_min
      from jsonb_array_elements(coalesce(v_sum -> 'heatmap', '[]'::jsonb)) c
  ), open_cells as (
    select dow, hour, open_days, least(used_min / nullif(open_min, 0), 1) as ratio
      from cells where open_min > 0
  )
  select jsonb_build_object(
           'level',        app.mkt_level(((v_k ->> 'occupancy_pct')::numeric) / 100),
           'levelPct',     round((v_k ->> 'occupancy_pct')::numeric)::int,
           'levelTrend',   app.mkt_rate_trend((v_k ->> 'occupancy_pct')::numeric, (v_kp ->> 'occupancy_pct')::numeric), 'levelTrendPts', app.mkt_points((v_k ->> 'occupancy_pct')::numeric, (v_kp ->> 'occupancy_pct')::numeric),
           'bookingsTrend', app.mkt_trend((v_k ->> 'bookings')::numeric, (v_kp ->> 'bookings')::numeric), 'bookingsTrendPct', app.mkt_change((v_k ->> 'bookings')::numeric, (v_kp ->> 'bookings')::numeric),
           'cancelTrend',  app.mkt_rate_trend((v_k ->> 'cancellation_rate_pct')::numeric, (v_kp ->> 'cancellation_rate_pct')::numeric), 'cancelTrendPts', app.mkt_points((v_k ->> 'cancellation_rate_pct')::numeric, (v_kp ->> 'cancellation_rate_pct')::numeric),
           'noShowTrend',  app.mkt_rate_trend((v_k ->> 'no_show_rate_pct')::numeric, (v_kp ->> 'no_show_rate_pct')::numeric), 'noShowTrendPts', app.mkt_points((v_k ->> 'no_show_rate_pct')::numeric, (v_kp ->> 'no_show_rate_pct')::numeric),
           'heat',  coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'level', app.mkt_level(ratio)) order by dow, hour) from open_cells), '[]'::jsonb),
           -- At least two open days behind a slot, so one quiet Tuesday is not "the quiet slot".
           'quiet', coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'level', app.mkt_level(ratio)))
                                from (select * from open_cells where open_days >= 2 order by ratio, dow, hour limit 3) q), '[]'::jsonb),
           'full',  coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'level', app.mkt_level(ratio)))
                                from (select * from open_cells where open_days >= 2 and ratio >= 0.6 order by ratio desc, dow, hour limit 3) f), '[]'::jsonb))
    into v_out;
  v_out := jsonb_build_object('demand', v_out);

  -- ---- Guests: new, returning, regulars, how often ----------------------
  v_out := v_out || jsonb_build_object('guests', jsonb_build_object(
    'active',       app.mkt_about((v_guests ->> 'identities')::numeric),
    'activeTrend',  app.mkt_trend((v_guests ->> 'identities')::numeric, (v_guests_p ->> 'identities')::numeric), 'activeTrendPct', app.mkt_change((v_guests ->> 'identities')::numeric, (v_guests_p ->> 'identities')::numeric),
    'newShare',     app.mkt_share((v_guests ->> 'new_bookings')::numeric, (v_guests ->> 'identified_bookings')::numeric, 1),
    'returningShare', app.mkt_share((v_guests ->> 'returning_bookings')::numeric, (v_guests ->> 'identified_bookings')::numeric, 1),
    'newTrend',     app.mkt_trend((v_guests ->> 'new_bookings')::numeric, (v_guests_p ->> 'new_bookings')::numeric), 'newTrendPct', app.mkt_change((v_guests ->> 'new_bookings')::numeric, (v_guests_p ->> 'new_bookings')::numeric),
    'regulars',     app.mkt_about((v_guests ->> 'regulars')::numeric),
    'lapsing',      app.mkt_about((v_guests ->> 'lapsing_regulars')::numeric),
    'lapseDays',    coalesce((v_guests ->> 'lapse_days')::int, 28),
    'frequency', coalesce((
       select jsonb_agg(jsonb_build_object(
                'bucket', b ->> 'bucket',
                'share',  app.mkt_share((b ->> 'identities')::numeric, (v_guests ->> 'identities')::numeric, 1)))
         from jsonb_array_elements(coalesce(v_guests -> 'visit_buckets', '[]'::jsonb)) b), '[]'::jsonb),
    -- The weekly shape only: each week as a share of the busiest week (0..100).
    'weeks', coalesce((
       with w as (
         select x ->> 'week_start' as week_start,
                coalesce((x ->> 'new_identities')::numeric, 0) as n,
                coalesce((x ->> 'returning_identities')::numeric, 0) as r
           from jsonb_array_elements(coalesce(v_guests -> 'by_week', '[]'::jsonb)) x
       ), m as (select greatest(max(n + r), 1) as top from w)
       select jsonb_agg(jsonb_build_object('weekStart', w.week_start,
                                           'newIdx', round(100 * w.n / m.top)::int,
                                           'returningIdx', round(100 * w.r / m.top)::int) order by w.week_start)
         from w, m), '[]'::jsonb)));

  -- ---- Channels: how bookings arrive (the app or the desk; nothing else is recorded) ----
  select coalesce(sum((s ->> 'bookings')::numeric) filter (where s ->> 'source' = 'mobile'), 0),
         coalesce(sum((s ->> 'bookings')::numeric), 0)
    into v_mobile, v_booked
    from jsonb_array_elements(coalesce(v_demand -> 'sources', '[]'::jsonb)) s;
  select coalesce(sum((s ->> 'bookings')::numeric) filter (where s ->> 'source' = 'mobile'), 0),
         coalesce(sum((s ->> 'bookings')::numeric), 0)
    into v_mobile_p, v_booked_p
    from jsonb_array_elements(coalesce(v_demand_p -> 'sources', '[]'::jsonb)) s;

  v_out := v_out || jsonb_build_object('channels', jsonb_build_object(
    'appShare',  app.mkt_share(v_mobile, v_booked, 1),
    'deskShare', app.mkt_share(v_booked - v_mobile, v_booked, 1),
    'appTrend',  app.mkt_rate_trend(100.0 * v_mobile / nullif(v_booked, 0), 100.0 * v_mobile_p / nullif(v_booked_p, 0)), 'appTrendPts', app.mkt_points(100.0 * v_mobile / nullif(v_booked, 0), 100.0 * v_mobile_p / nullif(v_booked_p, 0)),
    -- How far ahead people book, as shares of the six lead-time buckets.
    'lead', coalesce((
       select jsonb_agg(jsonb_build_object('bucket', b ->> 'bucket',
                                           'share', app.mkt_share((b ->> 'bookings')::numeric, v_booked, 1)))
         from jsonb_array_elements(coalesce(v_demand -> 'lead_time' -> 'buckets', '[]'::jsonb)) b), '[]'::jsonb)));

  -- ---- Café and shop: crossover, busy hours, best and least sold ----------
  v_max := (select max((h ->> 'orders')::numeric) from jsonb_array_elements(coalesce(v_hourly, '[]'::jsonb)) h);
  v_out := v_out || jsonb_build_object('cafe', jsonb_build_object(
    'crossoverShare', app.mkt_share((v_cafe -> 'attach' ->> 'linked_bookings')::numeric, (v_cafe -> 'attach' ->> 'live_bookings')::numeric, 1),
    'crossoverTrend', app.mkt_rate_trend((v_cafe -> 'attach' ->> 'attach_pct')::numeric, (v_cafe_p -> 'attach' ->> 'attach_pct')::numeric), 'crossoverTrendPts', app.mkt_points((v_cafe -> 'attach' ->> 'attach_pct')::numeric, (v_cafe_p -> 'attach' ->> 'attach_pct')::numeric),
    'spendTrend',     app.mkt_trend((v_cafe -> 'attach' ->> 'cafe_per_booking_iqd')::numeric, (v_cafe_p -> 'attach' ->> 'cafe_per_booking_iqd')::numeric, 0), 'spendTrendPct', app.mkt_change((v_cafe -> 'attach' ->> 'cafe_per_booking_iqd')::numeric, (v_cafe_p -> 'attach' ->> 'cafe_per_booking_iqd')::numeric, 0),
    -- The café's week as levels against its own busiest hour.
    'heat', coalesce((
       select jsonb_agg(jsonb_build_object('dow', (h ->> 'dow')::int, 'hour', (h ->> 'hour')::int,
                                           'level', app.mkt_level((h ->> 'orders')::numeric / nullif(v_max, 0)))
                        order by (h ->> 'dow')::int, (h ->> 'hour')::int)
         from jsonb_array_elements(coalesce(v_hourly, '[]'::jsonb)) h
        where coalesce((h ->> 'orders')::numeric, 0) > 0), '[]'::jsonb),
    'peaks', coalesce((
       select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour))
         from (select (h ->> 'dow')::int as dow, (h ->> 'hour')::int as hour
                 from jsonb_array_elements(coalesce(v_hourly, '[]'::jsonb)) h
                order by (h ->> 'orders')::numeric desc nulls last limit 3) p), '[]'::jsonb),
    'top', coalesce((
       select jsonb_agg(jsonb_build_object('nameEn', b ->> 'name_en', 'nameAr', b ->> 'name_ar') order by ord)
         from jsonb_array_elements(coalesce(v_best, '[]'::jsonb)) with ordinality t(b, ord)
        where ord <= 5), '[]'::jsonb),
    -- Least sold of the items that sold at all, fewest first; only when the
    -- menu sold more than ten items, or the two lists would overlap.
    'bottom', coalesce((
       select jsonb_agg(jsonb_build_object('nameEn', b ->> 'name_en', 'nameAr', b ->> 'name_ar') order by ord desc)
         from jsonb_array_elements(coalesce(v_best, '[]'::jsonb)) with ordinality t(b, ord)
        where jsonb_array_length(coalesce(v_best, '[]'::jsonb)) > 10
          and ord > jsonb_array_length(v_best) - 5), '[]'::jsonb),
    'shopTrend', app.mkt_trend((v_shop -> 'kpis' ->> 'sales')::numeric, (v_shop_p -> 'kpis' ->> 'sales')::numeric), 'shopTrendPct', app.mkt_change((v_shop -> 'kpis' ->> 'sales')::numeric, (v_shop_p -> 'kpis' ->> 'sales')::numeric)));

  -- ---- Revenue mix: shares of the whole, and its direction ----------------
  v_cafe_iqd    := (select coalesce(sum((d ->> 'revenue_iqd')::numeric), 0) from jsonb_array_elements(coalesce(v_daily, '[]'::jsonb)) d);
  v_cafe_iqd_p  := (select coalesce(sum((d ->> 'revenue_iqd')::numeric), 0) from jsonb_array_elements(coalesce(v_daily_p, '[]'::jsonb)) d);
  v_court_iqd   := coalesce((v_k ->> 'revenue_iqd')::numeric, 0);
  v_court_iqd_p := coalesce((v_kp ->> 'revenue_iqd')::numeric, 0);
  v_shop_iqd    := coalesce((v_shop -> 'kpis' ->> 'net_iqd')::numeric, 0);
  v_shop_iqd_p  := coalesce((v_shop_p -> 'kpis' ->> 'net_iqd')::numeric, 0);
  v_total   := v_cafe_iqd + v_court_iqd + v_shop_iqd;
  v_total_p := v_cafe_iqd_p + v_court_iqd_p + v_shop_iqd_p;
  v_out := v_out || jsonb_build_object('mix', jsonb_build_object(
    'courts', app.mkt_share(v_court_iqd, v_total, 1, 1),
    'cafe',   app.mkt_share(v_cafe_iqd, v_total, 1, 1),
    'shop',   app.mkt_share(v_shop_iqd, v_total, 1, 1),
    'trend',  app.mkt_trend(v_total, v_total_p, 0), 'trendPct', app.mkt_change(v_total, v_total_p, 0),
    'courtsTrend', app.mkt_trend(v_court_iqd, v_court_iqd_p, 0), 'courtsTrendPct', app.mkt_change(v_court_iqd, v_court_iqd_p, 0),
    'cafeTrend',   app.mkt_trend(v_cafe_iqd, v_cafe_iqd_p, 0), 'cafeTrendPct', app.mkt_change(v_cafe_iqd, v_cafe_iqd_p, 0)));

  -- ---- Offers: how much each promotion was used in the period -------------
  v_out := v_out || jsonb_build_object('offers', coalesce((
    with used as (
      select p.id, p.name_en, p.name_ar, p.enabled,
             count(pr.id) filter (where t.status = 'settled'
                                    and t.venue_id = any(v_rv)
                                    and app.business_date(pr.redeemed_at) between p_from and p_to) as uses
        from promotions p
        left join promotion_redemptions pr on pr.promotion_id = p.id
        left join tabs t on t.id = pr.tab_id
       where (p.venue_id is null or p.venue_id = any(v_rv))
         and (p.starts_at is null or app.business_date(p.starts_at) <= p_to)
         and (p.ends_at is null or app.business_date(p.ends_at) >= p_from)
       group by p.id
    ), shown as (
      -- Live offers, and any offer used in the period; at most twelve, most used first.
      select * from used where enabled or uses > 0 order by uses desc, name_en limit 12
    ), top as (select greatest(max(uses), 1) as top from shown)
    select jsonb_agg(jsonb_build_object(
             'id',     u.id,
             'nameEn', u.name_en,
             'nameAr', u.name_ar,
             'live',   u.enabled,
             'uses',   case when u.uses = 0 then null else app.mkt_about(u.uses) end,
             -- Use, not uplift: a redemption is a fact, a lift would be a guess.
             'verdict', case
                          when u.uses = 0 then 'unused'
                          when u.uses < 10 then 'little'
                          when u.uses >= top.top * 0.5 then 'strong'
                          else 'some'
                        end)
           order by u.uses desc, u.name_en)
      from shown u, top), '[]'::jsonb));

  -- ---- Tournaments: how full they ran, and who came back ------------------
  v_out := v_out || jsonb_build_object('events', (
    with t as (
      select t.id, t.status, t.max_entries,
             (select count(*) from tournament_entries e where e.tournament_id = t.id and e.status in ('registered', 'no_show')) as entered
        from tournaments t
       where t.venue_id = any(v_rv)
         and app.business_date(t.starts_at) between p_from and p_to
    ), e as (
      select count(distinct e.guest_id) as entrants,
             count(distinct e.guest_id) filter (where exists (
               select 1 from tournament_entries p join tournaments pt on pt.id = p.tournament_id
                where p.guest_id = e.guest_id and p.status in ('registered', 'no_show')
                  and pt.status <> 'cancelled' and app.business_date(pt.starts_at) < p_from)) as returners
        from tournament_entries e
        join tournaments t on t.id = e.tournament_id
       where t.venue_id = any(v_rv) and t.status <> 'cancelled'
         and e.status in ('registered', 'no_show')
         and app.business_date(t.starts_at) between p_from and p_to
    )
    select jsonb_build_object(
             'tournaments', app.mkt_about(count(*) filter (where t.status <> 'cancelled')),
             'held',        count(*) filter (where t.status <> 'cancelled') > 0,
             'fillLevel',   app.mkt_level(sum(t.entered) filter (where t.status <> 'cancelled')::numeric
                                          / nullif(sum(t.max_entries) filter (where t.status <> 'cancelled'), 0)),
             'fillPct',     round(100.0 * sum(t.entered) filter (where t.status <> 'cancelled')
                                  / nullif(sum(t.max_entries) filter (where t.status <> 'cancelled'), 0))::int,
             'cancelled',   count(*) filter (where t.status = 'cancelled') > 0,
             'entrants',    app.mkt_about((select entrants from e)),
             'returningShare', app.mkt_share((select returners from e), (select entrants from e), 1),
             'next', (select jsonb_build_object('nameEn', n.name_en, 'nameAr', n.name_ar,
                                                'startDate', app.business_date(n.starts_at))
                        from tournaments n
                       where n.venue_id = any(v_rv) and n.status in ('open', 'closed', 'running') and n.ends_at >= now()
                       order by n.starts_at limit 1))
      from t));

  -- ---- Loyalty: members, and whether they use their points ----------------
  v_out := v_out || jsonb_build_object('loyalty', (
    select jsonb_build_object(
             'enabled',        coalesce((select s.enabled from loyalty_settings s where s.id), false),
             'members',        app.mkt_about((select count(*) from loyalty_accounts)),
             'newMembers',     app.mkt_about(count(distinct l.profile_id) filter (
                                 where not exists (select 1 from loyalty_ledger o
                                                    where o.profile_id = l.profile_id
                                                      and app.business_date(o.created_at) < p_from))),
             'activeMembers',  app.mkt_about(count(distinct l.profile_id) filter (where l.kind not in ('expire', 'merge_in'))),
             'redeemingShare', app.mkt_share(count(distinct l.profile_id) filter (where l.kind in ('redeem', 'reward')),
                                             count(distinct l.profile_id) filter (where l.kind not in ('expire', 'merge_in')), 1),
             'holdingPoints',  app.mkt_about((select count(*) from loyalty_accounts a where a.balance > 0)))
      from loyalty_ledger l
     where app.business_date(l.created_at) between p_from and p_to));

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'compare', jsonb_build_object('from', p_cmp_from, 'to', p_cmp_to),
    -- Reports from before the system (0349) carry no hours, channels or guests.
    'legacy',  (v_sum -> 'history') is not null and jsonb_typeof(v_sum -> 'history') = 'object'
               and jsonb_array_length(coalesce(v_sum -> 'history' -> 'included', '[]'::jsonb)) > 0)
         || v_out;
end $marketing_insights_0365$;

comment on function app.marketing_insights(date, date, date, date) is
  '0360, re-issued by 0365 (percentages). Marketing and owner (the operator''s /insights): the whole place for a business-day range against a comparison window, as levels (0 empty .. 4 full) with the fill as a whole percent (levelPct, fillPct), trends (up, steady, down, unknown) each with its size beside it (<trend>Pct: percent change of a count or a sum; <trend>Pts: points moved by a rate; null when the trend is unknown or the baseline was zero), shares as whole percents, counts as about-N or few (under 10), and ranked slots and names. Reads the owner''s analytics_* through app.analytics_guard with a transaction-local app.marketing_read assertion it clears before returning. No money figure, no exact count, no guest identity. FORBIDDEN, INVALID_RANGE.';

revoke all on function app.marketing_insights(date, date, date, date) from public, anon;
grant execute on function app.marketing_insights(date, date, date, date) to authenticated;
