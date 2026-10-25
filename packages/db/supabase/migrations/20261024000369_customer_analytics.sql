set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0369 customer_analytics — "who our customers are", for the owner and for
-- marketing (Majed 2026-10-24; docs/design/customers/contracts-2026-10-24.md
-- §2, §3). 0368 records the facts; this file is the only thing that adds them
-- up.
--
--   1. app.analytics_customers(p_from, p_to): the owner's People tab. Behind
--      app.analytics_guard (owner, or marketing_insights' own transaction),
--      the analysed branch, business-day bounds like every analytics_* read.
--      Exact figures, because this is the owner's own page:
--        known     guests seen in the range and how many of them the club
--                  actually knows (gender, band, level, a judged level), with
--                  the coverage as a whole percent;
--        genders / ages / levels   one row a bucket: guests, plays, bookings,
--                  spend and the share of the crowd;
--        judged    the claim against the judgment: checked, agree, higher
--                  (claimed above what the club judged), lower;
--        interests one row a derived tag (app.customer_interest_tags);
--        segments  gender x band x level, at most twelve, and every group of
--                  fewer than five guests folded into one `other` row, so no
--                  row can be narrowed down to a person;
--        peak      each bucket's two busiest slots (business day, branch time);
--        fresh     new against returning guests, per bucket.
--      A play is a court booking the guest booked or an open-match seat they
--      sat in — the same definition app.customer_interest_tags uses, so the
--      two never disagree. Spend is what settled on their own tabs and on the
--      tabs of their bookings; no court revenue is split by guesswork.
--
--      WHY NO KEY IS NAMED `gender`: SEC-29 (scripts/check-analytics-payload.mjs)
--      forbids a guest identifier in any client-callable analytics payload,
--      and it is right to — a per-person gender has no business in a payload
--      that may be handed to a model. These are counts of people, never a
--      person, so the bucket arrives as `who` / `bucket` with the gender as
--      its VALUE.
--
--   2. app.marketing_insights (latest 0365) is re-issued verbatim with one
--      more section, `people`, built from the same read through the same
--      app.marketing_read assertion and run through 0360/0365's wording
--      helpers: coverage as a level and a percent, shares as whole percents,
--      counts as about-N, trends with their size, and the three biggest
--      segments as shares. A bucket with fewer than ten guests is left out
--      entirely, so marketing can never narrow a share down to a person. No
--      money figure, no exact count, no identity — 0360's rule, unchanged.
--
-- covered by packages/db/tests/customer-analytics.test.ts

-- ---------------------------------------------------------------------------
-- 1. app.analytics_customers — the owner's People read
-- ---------------------------------------------------------------------------
create or replace function app.analytics_customers(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_customers_0369$
declare
  v_av  uuid := app.analysis_venue();
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  -- A play with a when: a court the guest booked, or an open-match seat they
  -- sat in (app.customer_interest_tags' definition).
  plays as materialized (
    select r.guest_id as pid, r.start_at, 'court'::text as source
      from reservations r
     where r.venue_id = v_av
       and r.kind = 'booking'
       and r.status in ('confirmed', 'arrived', 'completed')
       and r.guest_id is not null
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
    union all
    select ms.guest_id, m.start_at, 'match'
      from match_seats ms
      join matches m on m.id = ms.match_id
     where m.venue_id = v_av
       and not m.sandbox
       and ms.guest_id is not null
       and ms.status in ('in', 'attended', 'left_late')
       and m.start_at >= v_b.ts_from and m.start_at < v_b.ts_to
  ),
  -- Seen at this branch in the year before the range: then they are returning.
  seen_before as materialized (
    select distinct s.pid
      from (select r.guest_id as pid
              from reservations r
             where r.venue_id = v_av and r.kind = 'booking'
               and r.status in ('confirmed', 'arrived', 'completed')
               and r.guest_id is not null
               and r.start_at < v_b.ts_from
               and r.start_at >= v_b.ts_from - interval '365 days'
            union all
            select ms.guest_id
              from match_seats ms
              join matches m on m.id = ms.match_id
             where m.venue_id = v_av and not m.sandbox and ms.guest_id is not null
               and ms.status in ('in', 'attended', 'left_late')
               and m.start_at < v_b.ts_from
               and m.start_at >= v_b.ts_from - interval '365 days') s
     where s.pid is not null
  ),
  -- What settled on their own tabs, and on the tabs of their bookings.
  spend as materialized (
    select coalesce(t.customer_id, r.guest_id) as pid, sum(coalesce(t.total_iqd, 0))::bigint as iqd
      from tabs t
      left join reservations r on r.id = t.reservation_id
     where t.venue_id = v_av
       and t.status = 'settled'
       and t.opened_at >= v_b.ts_from and t.opened_at < v_b.ts_to
       and coalesce(t.customer_id, r.guest_id) is not null
     group by 1
  ),
  tags as materialized (
    select t.profile_id as pid, t.tags
      from app.customer_interest_tags(array[v_av], null, v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) t
  ),
  base as materialized (
    select p.id as pid,
           p.gender,
           p.age_band,
           p.play_level                                              as claimed,
           p.level_confirmed                                         as confirmed,
           app.effective_play_level(p.level_confirmed, p.play_level)  as level,
           count(*)::int                                             as plays,
           count(*) filter (where pl.source = 'court')::int           as bookings,
           coalesce(max(sp.iqd), 0)::bigint                          as iqd,
           bool_or(sb.pid is not null)                               as returning
      from plays pl
      join profiles p on p.id = pl.pid and p.deleted_at is null
      left join spend sp on sp.pid = p.id
      left join seen_before sb on sb.pid = p.id
     group by p.id, p.gender, p.age_band, p.play_level, p.level_confirmed
  ),
  seg_raw as (
    select coalesce(b.gender, 'unknown')   as who,
           coalesce(b.age_band, 'unknown') as band,
           coalesce(b.level, 'unknown')    as level,
           count(*)::int                   as guests,
           sum(b.plays)::int               as plays,
           sum(b.iqd)::bigint              as iqd
      from base b
     group by 1, 2, 3
  ),
  -- A group of fewer than five guests is nobody's row: fold it into `other`.
  seg as (
    select who, band, level, sum(guests)::int as guests, sum(plays)::int as plays, sum(iqd)::bigint as iqd
      from (select case when guests >= 5 then who   else 'other' end as who,
                   case when guests >= 5 then band  else 'other' end as band,
                   case when guests >= 5 then level else 'other' end as level,
                   guests, plays, iqd
              from seg_raw) f
     group by 1, 2, 3
  ),
  -- Every bucket a figure is cut by, as one key per guest.
  keyed as (
    select b.*, k.key
      from base b
      cross join lateral (values (coalesce(b.gender, 'unknown')),
                                 (coalesce(b.age_band, 'unknown')),
                                 (coalesce(b.level, 'unknown'))) k(key)
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'known', (select jsonb_build_object(
                'guests',          count(*),
                'withGenders',     count(*) filter (where b.gender is not null),
                'withAges',        count(*) filter (where b.age_band is not null),
                'withLevels',      count(*) filter (where b.level is not null),
                'judgedLevels',    count(*) filter (where b.confirmed is not null),
                'plays',           coalesce(sum(b.plays), 0),
                'bookings',        coalesce(sum(b.bookings), 0),
                'spend_iqd',       coalesce(sum(b.iqd), 0),
                -- How much of the crowd the club actually knows: all three facts.
                'coveragePct',     case when count(*) = 0 then null else
                                     round(100.0 * count(*) filter (
                                       where b.gender is not null and b.age_band is not null
                                         and b.level is not null) / count(*))::int end,
                'newGuests',       count(*) filter (where not b.returning),
                'returningGuests', count(*) filter (where b.returning))
                from base b),
    'genders',   (select coalesce(jsonb_agg(x.j order by x.guests desc, x.bucket), '[]'::jsonb)
                    from (select coalesce(b.gender, 'unknown') as bucket, count(*)::int as guests,
                                 jsonb_build_object('bucket', coalesce(b.gender, 'unknown'),
                                                    'guests', count(*),
                                                    'plays', coalesce(sum(b.plays), 0),
                                                    'bookings', coalesce(sum(b.bookings), 0),
                                                    'spend_iqd', coalesce(sum(b.iqd), 0),
                                                    'share', round(100.0 * count(*)
                                                               / nullif((select count(*) from base), 0))::int) as j
                            from base b group by 1) x),
    'ages',      (select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb)
                    from (select array_position(array['u18', '18_24', '25_34', '35_44', '45_54', '55_plus', 'unknown'],
                                                coalesce(b.age_band, 'unknown')) as ord,
                                 jsonb_build_object('bucket', coalesce(b.age_band, 'unknown'),
                                                    'guests', count(*),
                                                    'plays', coalesce(sum(b.plays), 0),
                                                    'bookings', coalesce(sum(b.bookings), 0),
                                                    'spend_iqd', coalesce(sum(b.iqd), 0),
                                                    'share', round(100.0 * count(*)
                                                               / nullif((select count(*) from base), 0))::int) as j
                            from base b group by 1, coalesce(b.age_band, 'unknown')) x),
    'levels',    (select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb)
                    from (select array_position(array['new', 'beginner', 'intermediate', 'advanced', 'unknown'],
                                                coalesce(b.level, 'unknown')) as ord,
                                 jsonb_build_object('bucket', coalesce(b.level, 'unknown'),
                                                    'guests', count(*),
                                                    'judged', count(*) filter (where b.confirmed is not null),
                                                    'plays', coalesce(sum(b.plays), 0),
                                                    'share', round(100.0 * count(*)
                                                               / nullif((select count(*) from base), 0))::int) as j
                            from base b group by 1, coalesce(b.level, 'unknown')) x),
    -- The claim against the judgment: the honest answer to "is that level accurate".
    'judged',    (select jsonb_build_object(
                    'checked', count(*) filter (where b.confirmed is not null),
                    'agree',   count(*) filter (where b.confirmed is not null and b.claimed = b.confirmed),
                    'higher',  count(*) filter (where b.confirmed is not null and b.claimed is not null
                                                  and app.play_level_rank(b.claimed) > app.play_level_rank(b.confirmed)),
                    'lower',   count(*) filter (where b.confirmed is not null and b.claimed is not null
                                                  and app.play_level_rank(b.claimed) < app.play_level_rank(b.confirmed)),
                    'unclaimed', count(*) filter (where b.confirmed is not null and b.claimed is null))
                    from base b),
    'interests', (select coalesce(jsonb_agg(x.j order by x.guests desc, x.bucket), '[]'::jsonb)
                    from (select tag as bucket, count(*)::int as guests,
                                 jsonb_build_object('bucket', tag, 'guests', count(*),
                                                    'share', round(100.0 * count(*)
                                                               / nullif((select count(*) from base), 0))::int) as j
                            from tags t
                            join base b on b.pid = t.pid
                            cross join lateral unnest(t.tags) as tag
                           group by tag) x),
    'segments',  (select coalesce(jsonb_agg(x.j order by x.guests desc, x.who, x.band, x.level), '[]'::jsonb)
                    from (select s.who, s.band, s.level, s.guests,
                                 jsonb_build_object('who', s.who, 'band', s.band, 'level', s.level,
                                                    'guests', s.guests, 'plays', s.plays,
                                                    'spend_iqd', s.iqd) as j
                            from seg s
                           order by s.guests desc, s.who, s.band, s.level
                           limit 12) x),
    'peak',      (select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'dow', k.dow, 'hour', k.hour,
                                                              'plays', k.n)
                                            order by k.key, k.rank), '[]'::jsonb)
                    from (select s.key, s.dow, s.hour, s.n,
                                 row_number() over (partition by s.key order by s.n desc, s.dow, s.hour) as rank
                            from (select kk.key,
                                         extract(dow from app.business_date(pl.start_at, v_b.tz, v_b.start_hour))::int as dow,
                                         extract(hour from (pl.start_at at time zone v_b.tz))::int as hour,
                                         count(*)::int as n
                                    from plays pl
                                    join base b on b.pid = pl.pid
                                    cross join lateral (values (coalesce(b.gender, 'unknown')),
                                                               (coalesce(b.age_band, 'unknown'))) kk(key)
                                   group by 1, 2, 3) s) k
                   where k.rank <= 2),
    'fresh',     (select coalesce(jsonb_agg(jsonb_build_object('key', x.key,
                                                              'newGuests', x.fresh_n,
                                                              'returningGuests', x.ret_n)
                                            order by x.key), '[]'::jsonb)
                    from (select k.key,
                                 count(*) filter (where not k.returning)::int as fresh_n,
                                 count(*) filter (where k.returning)::int     as ret_n
                            from keyed k group by k.key) x))
    into v_out;

  return v_out;
end $analytics_customers_0369$;

comment on function app.analytics_customers(date, date) is
  '0369 (customers contracts §2). Owner (app.analytics_guard; also the transaction of app.marketing_insights): who the customers of the analysed branch were over a business-day range. {period, known {guests, withGenders, withAges, withLevels, judgedLevels, plays, bookings, spend_iqd, coveragePct, newGuests, returningGuests}, genders [], ages [], levels [] (each {bucket, guests, plays, bookings, spend_iqd | judged, share}), judged {checked, agree, higher, lower, unclaimed}, interests [{bucket, guests, share}] (app.customer_interest_tags, derived, never asked), segments [{who, band, level, guests, plays, spend_iqd}] (at most 12; every group under 5 guests folded into one `other` row), peak [{key, dow, hour, plays}] (each bucket''s two busiest slots), fresh [{key, newGuests, returningGuests}]}. A play is a court booking the guest booked or an open-match seat they sat in; spend is what settled on their own tabs and their bookings'' tabs. No key is named `gender` (SEC-29): the bucket is `who` / `bucket` and the gender is its value, and nothing here names a person. FORBIDDEN, INVALID_RANGE.';

revoke all on function app.analytics_customers(date, date) from public, anon;
grant execute on function app.analytics_customers(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The marketing wording helpers for a bucket list. Internal, as 0360's.
-- ---------------------------------------------------------------------------

-- A bucket list (from app.analytics_customers) as shares of the known crowd,
-- biggest first. A bucket of fewer than ten guests is LEFT OUT: a share over a
-- handful of people is a person, and marketing never sees one.
create or replace function app.mkt_buckets(p_rows jsonb, p_total numeric) returns jsonb
language sql immutable set search_path = public as $mkt_buckets_0369$
  select coalesce(jsonb_agg(jsonb_build_object(
                    'bucket', r ->> 'bucket',
                    'share',  app.mkt_share((r ->> 'guests')::numeric, p_total, 1))
                  order by (r ->> 'guests')::numeric desc, r ->> 'bucket'), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where coalesce((r ->> 'guests')::numeric, 0) >= 10
$mkt_buckets_0369$;

-- Which buckets are moving, and how far, against the comparison window. A
-- bucket absent from the comparison counts as zero there; one under ten
-- guests now is left out, as above.
create or replace function app.mkt_bucket_trends(p_now jsonb, p_prev jsonb) returns jsonb
language sql immutable set search_path = public as $mkt_bucket_trends_0369$
  select coalesce(jsonb_agg(jsonb_build_object(
                    'bucket',   x.bucket,
                    'trend',    app.mkt_trend(x.n, x.p),
                    'trendPct', app.mkt_change(x.n, x.p))
                  order by x.n desc, x.bucket), '[]'::jsonb)
    from (select r ->> 'bucket' as bucket,
                 coalesce((r ->> 'guests')::numeric, 0) as n,
                 coalesce((select (q ->> 'guests')::numeric
                             from jsonb_array_elements(coalesce(p_prev, '[]'::jsonb)) q
                            where q ->> 'bucket' = r ->> 'bucket'), 0) as p
            from jsonb_array_elements(coalesce(p_now, '[]'::jsonb)) r
           where coalesce((r ->> 'guests')::numeric, 0) >= 10) x
$mkt_bucket_trends_0369$;

-- The biggest segments as shares only: who they are, never how many or what
-- they spent. `other` (the fold of every group under five guests) is dropped:
-- it describes nobody.
create or replace function app.mkt_segments(p_rows jsonb, p_total numeric, p_limit int default 3)
returns jsonb
language sql immutable set search_path = public as $mkt_segments_0369$
  select coalesce(jsonb_agg(x.j order by x.n desc, x.j ->> 'who'), '[]'::jsonb)
    from (select coalesce((r ->> 'guests')::numeric, 0) as n,
                 jsonb_build_object('who',   r ->> 'who',
                                    'band',  r ->> 'band',
                                    'level', r ->> 'level',
                                    'share', app.mkt_share((r ->> 'guests')::numeric, p_total, 1)) as j
            from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
           where coalesce((r ->> 'guests')::numeric, 0) >= 10
             and r ->> 'who' <> 'other'
           order by coalesce((r ->> 'guests')::numeric, 0) desc
           limit greatest(coalesce(p_limit, 3), 1)) x
$mkt_segments_0369$;

revoke all on function app.mkt_buckets(jsonb, numeric) from public, anon, authenticated;
revoke all on function app.mkt_bucket_trends(jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.mkt_segments(jsonb, numeric, int) from public, anon, authenticated;
grant execute on function app.mkt_buckets(jsonb, numeric) to service_role;
grant execute on function app.mkt_bucket_trends(jsonb, jsonb) to service_role;
grant execute on function app.mkt_segments(jsonb, numeric, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.marketing_insights: re-issued from
--    20261022000365_insights_percentages.sql:65 verbatim, plus the `people`
--    section (§3 of the contract).
-- ---------------------------------------------------------------------------
create or replace function app.marketing_insights(
  p_from     date,
  p_to       date,
  p_cmp_from date,
  p_cmp_to   date
) returns jsonb
language plpgsql security definer set search_path = public as $marketing_insights_0369$
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
  -- 0369: who the customers are, this window and the comparison.
  v_people    jsonb;
  v_people_p  jsonb;
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
  v_people   := app.analytics_customers(p_from, p_to);
  v_people_p := app.analytics_customers(p_cmp_from, p_cmp_to);

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

  -- ---- People: who comes, in words and shares only (0369) ----------------
  -- Majed 2026-10-24: "make sure that the marketing panel also gets this
  -- insight". Everything here is a share of the known crowd, an about-N or a
  -- trend with its size; a bucket under ten guests is left out by the helpers,
  -- and no money figure, exact count or identity is built at all.
  v_out := v_out || jsonb_build_object('people', (
    with k as (
      select coalesce((v_people   -> 'known' ->> 'guests')::numeric, 0) as guests,
             coalesce((v_people_p -> 'known' ->> 'guests')::numeric, 0) as guests_p,
             (v_people   -> 'known' ->> 'coveragePct')::numeric         as cov,
             (v_people_p -> 'known' ->> 'coveragePct')::numeric         as cov_p,
             coalesce((v_people -> 'known' ->> 'judgedLevels')::numeric, 0) as judged,
             coalesce((v_people -> 'judged' ->> 'checked')::numeric, 0)     as checked,
             coalesce((v_people -> 'judged' ->> 'higher')::numeric, 0)      as higher
    )
    select jsonb_build_object(
             'known',            app.mkt_about(k.guests),
             'knownTrend',       app.mkt_trend(k.guests, k.guests_p),
             'knownTrendPct',    app.mkt_change(k.guests, k.guests_p),
             -- How much of the crowd the club knows (gender, age and level all
             -- answered): marketing's own lever on asking at sign-up.
             'coverage',         app.mkt_level(k.cov / 100.0),
             'coveragePct',      round(k.cov)::int,
             'coverageTrend',    app.mkt_rate_trend(k.cov, k.cov_p),
             'coverageTrendPts', app.mkt_points(k.cov, k.cov_p),
             'genders',          app.mkt_buckets(v_people -> 'genders',   k.guests),
             'ages',             app.mkt_buckets(v_people -> 'ages',      k.guests),
             'levels',           app.mkt_buckets(v_people -> 'levels',    k.guests),
             'interests',        app.mkt_buckets(v_people -> 'interests', k.guests),
             -- Of the levels the club judged, how many were claimed too high.
             'judgedShare',      app.mkt_share(k.judged, k.guests, 1),
             'overClaimedShare', app.mkt_share(k.higher, k.checked, 1),
             'growing',          app.mkt_bucket_trends(
                                   coalesce(v_people   -> 'genders', '[]'::jsonb)
                                     || coalesce(v_people   -> 'ages', '[]'::jsonb)
                                     || coalesce(v_people   -> 'levels', '[]'::jsonb)
                                     || coalesce(v_people   -> 'interests', '[]'::jsonb),
                                   coalesce(v_people_p -> 'genders', '[]'::jsonb)
                                     || coalesce(v_people_p -> 'ages', '[]'::jsonb)
                                     || coalesce(v_people_p -> 'levels', '[]'::jsonb)
                                     || coalesce(v_people_p -> 'interests', '[]'::jsonb)),
             'top',              app.mkt_segments(v_people -> 'segments', k.guests, 3))
      from k));

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'compare', jsonb_build_object('from', p_cmp_from, 'to', p_cmp_to),
    -- Reports from before the system (0349) carry no hours, channels or guests.
    'legacy',  (v_sum -> 'history') is not null and jsonb_typeof(v_sum -> 'history') = 'object'
               and jsonb_array_length(coalesce(v_sum -> 'history' -> 'included', '[]'::jsonb)) > 0)
         || v_out;
end $marketing_insights_0369$;
comment on function app.marketing_insights(date, date, date, date) is
  '0360, re-issued by 0365 (percentages) and 0369 (people). Marketing and owner (the operator''s /insights): the whole place for a business-day range against a comparison window, as levels (0 empty .. 4 full) with the fill as a whole percent (levelPct, fillPct), trends (up, steady, down, unknown) each with its size beside it (<trend>Pct: percent change of a count or a sum; <trend>Pts: points moved by a rate; null when the trend is unknown or the baseline was zero), shares as whole percents, counts as about-N or few (under 10), and ranked slots and names. 0369 adds `people`: {known (about-N), knownTrend(+Pct), coverage (level) with coveragePct and its trend in points, genders [], ages [], levels [], interests [] (each [{bucket, share}], a bucket under ten guests left out), judgedShare, overClaimedShare, growing [{bucket, trend, trendPct}], top [{who, band, level, share}] (at most three segments)} — who the customers are, in words and shares only. Reads the owner''s analytics_* (app.analytics_customers included) through app.analytics_guard with a transaction-local app.marketing_read assertion it clears before returning. No money figure, no exact count, no guest identity. FORBIDDEN, INVALID_RANGE.';

revoke all on function app.marketing_insights(date, date, date, date) from public, anon;
grant execute on function app.marketing_insights(date, date, date, date) to authenticated;
