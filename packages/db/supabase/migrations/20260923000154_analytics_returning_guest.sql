-- 0154_analytics_returning_guest — app.analytics_courts_endings and
-- app.analytics_courts_guests finish at 12 months again.
--
-- Both hit the authenticated role's 8 s statement_timeout (0109) on the bench
-- fixture (packages/db/bench, ~12,800 bookings). Two causes, both fixed here;
-- the output is unchanged, byte for byte.
--
-- 1. THE RETURNING TEST. `exists (select 1 from hist h where h.ident = b.ident
--    and h.start_at < b.start_at)` was inlined into a correlated SubPlan: for
--    every booking in range, an index scan of every history row before it,
--    calling app.analytics_guest_ident on each. Quadratic. It is now
--    `first_seen` (min(start_at) per ident over the same `hist`, filters
--    untouched) and `returning = coalesce(first_at < b.start_at, false)`.
--    "Some earlier row exists" <=> "the earliest row is earlier"; both are
--    strict, so two bookings of one guest at the same instant are not each
--    other's history and the first-ever pair is still new.
--
-- 2. THE PHONE FALLBACK. app.analytics_guest_ident scans `profiles` with
--    app.phone_canon per row for a booking that has a phone and no guest_id
--    (5.85 s for 6,400 such rows, bench/README.md). Each function now builds
--    `phone_owner` once — distinct on the canonical phone, ordered by
--    created_at, id, which is the helper's `order by … limit 1` — and resolves
--    the identity with the helper's own CASE against it. The helper is left
--    as it is (service role only; nothing else changes).
--
-- The CTEs that compute an identity are `materialized`, so each row's
-- identity is worked out once.
--
-- MEASURED (local, Windows + Docker Desktop, bench fixture, owner session,
-- 20 samples per row; `pnpm bench -- --area=analytics`):
--                                  before (0147)    returning fix   + phone map
--   analytics.courts_endings.12mo  8,016 timeout    p95 464 ms      p95 174 ms
--   analytics.courts_guests.12mo   8,028 timeout    p95 390 ms      p95 132 ms
-- The bench identifies every booking by guest_id. With half its bookings
-- turned phone-only (6,175 rows, in a rolled-back transaction) the returning
-- fix alone still took 6.3 s / 6.1 s; with the phone map 233 ms / 128 ms.
-- Parity: the 0147/0097 bodies and these return equal jsonb for 9 range x
-- court cases on the bench fixture with ~600 phone-only rows mixed in (some
-- matching a profile, some not).
--
-- covered by packages/db/tests/analytics-courts.test.ts ('returning guests (0154)')

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.analytics_courts_endings — 0147 body verbatim except the returning
--    test (and the CTEs it reads).
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_endings(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_endings_0154$
declare
  v_b          record;
  v_policy_min int;
  v_out        jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_policy_min := coalesce((select vs.cancellation_window_hours from venue_settings vs limit 1), 12) * 60;

  with
  -- 0154: app.analytics_guest_ident, set-based. The phone -> account map is
  -- built once (earliest profile per canonical phone, as its LIMIT 1 picks)
  -- instead of one profiles scan per phone-only row.
  phone_owner as materialized (
    select distinct on (x.canon) x.canon, 'u:' || x.id::text as ident
      from (select app.phone_canon(p.phone) as canon, p.id, p.created_at
              from profiles p
             where p.phone is not null) x
     where x.canon is not null
     order by x.canon, x.created_at, x.id),
  b as materialized (
    select r.id, r.court_id, r.source::text as source, r.series_id, r.start_at, r.end_at, r.cancelled_at,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60                      as lead_min,
           extract(epoch from (r.start_at - r.cancelled_at)) / 60                    as notice_min,
           coalesce(r.cancelled_by::text, 'unknown')                                 as actor,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show,
           case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as materialized (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident,
           r.start_at
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from - interval '180 days' and r.start_at < v_b.ts_to
       and (r.guest_id is not null or r.guest_phone is not null)),
  -- 0154: an earlier same-ident row exists  <=>  the ident's earliest start is
  -- earlier. Both strict, so two rows at the same instant are not each other's
  -- history. One hash aggregate instead of a correlated SubPlan per booking.
  first_seen as materialized (
    select h.ident, min(h.start_at) as first_at
      from hist h
     where h.ident is not null
     group by h.ident),
  bounds as (
    select distinct v from unnest(array[0, 120, 360, 1440, 4320, v_policy_min]) as v),
  edges as (
    select v as lo, lead(v) over (order by v) as hi, row_number() over (order by v) as ord
      from bounds),
  notice_keys as (
    select null::int as lo, 0 as hi, 0::bigint as ord, 'after_start'::text as bucket, false as policy_edge
    union all
    select e.lo, e.hi, e.ord,
           case when e.hi is null then e.lo::text || '_plus' else e.lo::text || '_' || e.hi::text end,
           e.lo = v_policy_min
      from edges e),
  typed as (
    select b.*,
           case when b.ident is null then 'unidentified'
                when coalesce(fs.first_at < b.start_at, false) then 'returning'
                else 'new' end as typ,
           case when b.series_id is not null then null
                when b.lead_min < 120   then 'lt2h'
                when b.lead_min < 360   then '2_6h'
                when b.lead_min < 1440  then '6_24h'
                when b.lead_min < 4320  then '1_3d'
                when b.lead_min < 10080 then '3_7d'
                else '7d_plus' end as lead_bucket,
           case when b.notice_min is null then null
                when b.notice_min < 0    then 'after_start'
                else (select k.bucket from notice_keys k
                       where k.lo is not null and b.notice_min >= k.lo and (k.hi is null or b.notice_min < k.hi)
                       limit 1) end as notice_bucket
      from b
      left join first_seen fs on fs.ident = b.ident),
  segs as (
    select t.id, t.cancelled, t.no_show, x.dim, x.key, x.ord
      from typed t
      cross join lateral (values
        ('hour',      t.hour::text,                                                   t.hour),
        ('dow',       t.dow::text,                                                    t.dow),
        ('court',     t.court_id::text,                                               0),
        ('source',    t.source,                                                       0),
        ('duration',  t.mins::text,                                                   t.mins),
        ('lead_time', t.lead_bucket,                                                  case t.lead_bucket
                                                                                        when 'lt2h' then 1 when '2_6h' then 2 when '6_24h' then 3
                                                                                        when '1_3d' then 4 when '3_7d' then 5 else 6 end),
        ('series',    case when t.series_id is null then 'single' else 'series' end,  0),
        ('type',      t.typ,                                                          case t.typ when 'returning' then 1 when 'new' then 2 else 3 end)
      ) x(dim, key, ord)
     where x.key is not null),
  agg as (
    select s.dim, s.key, min(s.ord) as ord,
           count(*) filter (where s.cancelled) as canc,
           count(*) filter (where s.no_show)   as ns,
           count(*)                            as total
      from segs s
     group by s.dim, s.key),
  rows_c as (
    select a.dim,
           jsonb_agg(
             jsonb_build_object('key', a.key, 'n', a.canc, 'bookings_total', a.total)
             || case when a.dim = 'court'
                     then jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar)
                     else '{}'::jsonb end
             order by a.ord, c.sort_order nulls last, c.name_en, a.key) as rows
      from agg a
      left join courts c on a.dim = 'court' and c.id::text = a.key
     group by a.dim),
  rows_n as (
    select a.dim,
           jsonb_agg(
             jsonb_build_object('key', a.key, 'n', a.ns, 'bookings_total', a.total)
             || case when a.dim = 'court'
                     then jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar)
                     else '{}'::jsonb end
             order by a.ord, c.sort_order nulls last, c.name_en, a.key) as rows
      from agg a
      left join courts c on a.dim = 'court' and c.id::text = a.key
     group by a.dim),
  actor_keys as (
    select k.actor, k.ord
      from (values ('guest', 1), ('staff', 2), ('unknown', 3)) k(actor, ord)),
  -- Late cancellations and what became of the slot.
  late as (
    select t.id, t.court_id, t.start_at, t.end_at, t.cancelled_at, t.price_iqd
      from typed t
     where t.cancelled and t.notice_min is not null and t.notice_min < v_policy_min),
  resold as (
    select lc.id, lc.price_iqd,
           (select r2.price_iqd
              from reservations r2
             where r2.court_id = lc.court_id
               and r2.kind = 'booking'
               and r2.status in ('confirmed','arrived','completed')
               and r2.id <> lc.id
               and r2.created_at > lc.cancelled_at
               and r2.start_at < lc.end_at and r2.end_at > lc.start_at
             order by r2.created_at, r2.id
             limit 1) as replacement_iqd
      from late lc),
  in_period as (
    select count(*) as n, coalesce(sum(r.price_iqd), 0)::bigint as revenue_iqd
      from reservations r
     where r.kind = 'booking'
       and r.status = 'cancelled'
       and r.cancelled_at >= v_b.ts_from and r.cancelled_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id))
  select jsonb_build_object(
    'policy_window_min', v_policy_min,
    'cancellations', jsonb_build_object(
      'total',             (select count(*) from b where b.cancelled),
      'revenue_iqd',       (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.cancelled),
      'late_revenue_iqd',  (select coalesce(sum(lc.price_iqd), 0)::bigint from late lc),
      'median_notice_min', (select round(percentile_cont(0.5) within group (order by b.notice_min::double precision))::int
                              from b where b.cancelled and b.notice_min is not null),
      'by_notice', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',      k.bucket,
                 'lo_min',      k.lo,
                 'hi_min',      k.hi,
                 'n',           coalesce(x.n, 0),
                 'policy_edge', k.policy_edge
               ) order by k.ord)
          from notice_keys k
          left join (select t.notice_bucket, count(*) as n from typed t where t.cancelled group by t.notice_bucket) x
                 on x.notice_bucket = k.bucket),
      'by_actor', (
        select jsonb_agg(jsonb_build_object('actor', k.actor, 'n', coalesce(x.n, 0)) order by k.ord)
          from actor_keys k
          left join (select b.actor, count(*) as n from b where b.cancelled group by b.actor) x on x.actor = k.actor),
      'cancelled_in_period', (select jsonb_build_object('n', ip.n, 'revenue_iqd', ip.revenue_iqd) from in_period ip),
      'resold', (
        select jsonb_build_object(
                 'cancelled',     count(*),
                 'resold_n',      count(*) filter (where rs.replacement_iqd is not null),
                 'recovered_iqd', coalesce(sum(rs.replacement_iqd), 0)::bigint,
                 'empty_n',       count(*) filter (where rs.replacement_iqd is null),
                 'lost_iqd',      coalesce(sum(rs.price_iqd) filter (where rs.replacement_iqd is null), 0)::bigint)
          from resold rs),
      'by_hour',      coalesce((select rc.rows from rows_c rc where rc.dim = 'hour'),      '[]'::jsonb),
      'by_dow',       coalesce((select rc.rows from rows_c rc where rc.dim = 'dow'),       '[]'::jsonb),
      'by_court',     coalesce((select rc.rows from rows_c rc where rc.dim = 'court'),     '[]'::jsonb),
      'by_source',    coalesce((select rc.rows from rows_c rc where rc.dim = 'source'),    '[]'::jsonb),
      'by_duration',  coalesce((select rc.rows from rows_c rc where rc.dim = 'duration'),  '[]'::jsonb),
      'by_lead_time', coalesce((select rc.rows from rows_c rc where rc.dim = 'lead_time'), '[]'::jsonb),
      'by_series',    coalesce((select rc.rows from rows_c rc where rc.dim = 'series'),    '[]'::jsonb),
      'by_type',      coalesce((select rc.rows from rows_c rc where rc.dim = 'type'),      '[]'::jsonb)),
    'no_shows', jsonb_build_object(
      'total',        (select count(*) from b where b.no_show),
      'revenue_iqd',  (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.no_show),
      'by_hour',      coalesce((select rn.rows from rows_n rn where rn.dim = 'hour'),      '[]'::jsonb),
      'by_dow',       coalesce((select rn.rows from rows_n rn where rn.dim = 'dow'),       '[]'::jsonb),
      'by_court',     coalesce((select rn.rows from rows_n rn where rn.dim = 'court'),     '[]'::jsonb),
      'by_source',    coalesce((select rn.rows from rows_n rn where rn.dim = 'source'),    '[]'::jsonb),
      'by_duration',  coalesce((select rn.rows from rows_n rn where rn.dim = 'duration'),  '[]'::jsonb),
      'by_lead_time', coalesce((select rn.rows from rows_n rn where rn.dim = 'lead_time'), '[]'::jsonb),
      'by_series',    coalesce((select rn.rows from rows_n rn where rn.dim = 'series'),    '[]'::jsonb),
      'by_type',      coalesce((select rn.rows from rows_n rn where rn.dim = 'type'),      '[]'::jsonb)))
    into v_out;

  return v_out;
end $fn_analytics_courts_endings_0154$;

revoke all on function app.analytics_courts_endings(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_endings(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.analytics_courts_guests — 0097 body verbatim except the returning
--    test (and the CTEs it reads).
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_guests(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_guests_0154$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  -- 0154: app.analytics_guest_ident, set-based. The phone -> account map is
  -- built once (earliest profile per canonical phone, as its LIMIT 1 picks)
  -- instead of one profiles scan per phone-only row.
  phone_owner as materialized (
    select distinct on (x.canon) x.canon, 'u:' || x.id::text as ident
      from (select app.phone_canon(p.phone) as canon, p.id, p.created_at
              from profiles p
             where p.phone is not null) x
     where x.canon is not null
     order by x.canon, x.created_at, x.id),
  b as materialized (
    select r.id, r.court_id, r.start_at,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)      as d,
           case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as materialized (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident,
           r.start_at
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from - interval '180 days' and r.start_at < v_b.ts_to
       and (r.guest_id is not null or r.guest_phone is not null)),
  -- 0154: see analytics_courts_endings above.
  first_seen as materialized (
    select h.ident, min(h.start_at) as first_at
      from hist h
     where h.ident is not null
     group by h.ident),
  typed as (
    select b.*,
           coalesce(fs.first_at < b.start_at, false) as returning
      from b
      left join first_seen fs on fs.ident = b.ident
     where b.ident is not null),
  per_ident as (
    select t.ident, count(*) as n from typed t group by t.ident),
  visit_keys as (
    select k.bucket, k.ord, k.lo, k.hi
      from (values ('1', 1, 1, 1), ('2_3', 2, 2, 3), ('4_6', 3, 4, 6), ('7_plus', 4, 7, 2147483647)) k(bucket, ord, lo, hi)),
  reg_src as materialized (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident,
           r.start_at,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_to - interval '90 days' and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)
       and (r.guest_id is not null or r.guest_phone is not null)),
  regs as (
    select s.ident, count(*) as n, max(s.start_at) as last_at
      from reg_src s
     where s.ident is not null
     group by s.ident
    having count(*) >= 3),
  reg_slots as (
    select s.ident, max(x.cnt) as top, sum(x.cnt) as total
      from (select s2.ident, s2.dow, s2.hour, count(*) as cnt
              from reg_src s2
             where s2.ident in (select rg.ident from regs rg)
             group by s2.ident, s2.dow, s2.hour) x
      join regs s on s.ident = x.ident
     group by s.ident),
  weeks as (
    select date_trunc('week', t.d)::date as week_start, t.ident, bool_or(not t.returning) as is_new
      from typed t
     group by 1, t.ident),
  week_rows as (
    select w.week_start,
           count(*) filter (where w.is_new)      as new_identities,
           count(*) filter (where not w.is_new)  as returning_identities
      from weeks w
     group by w.week_start),
  week_all as (
    select date_trunc('week', b.d)::date as week_start, count(*) as bookings
      from b group by 1)
  select jsonb_build_object(
    'lookback_days',        180,
    'regular_window_days',  90,
    'lapse_days',           28,
    'identified_bookings',   (select count(*) from typed),
    'unidentified_bookings', (select count(*) from b where b.ident is null),
    'identities',            (select count(*) from per_ident),
    'returning_bookings',    (select count(*) from typed t where t.returning),
    'new_bookings',          (select count(*) from typed t where not t.returning),
    'returning_pct',         (select case when count(*) > 0 then round(count(*) filter (where t.returning) * 100.0 / count(*), 1) end from typed t),
    'visit_buckets', (
      select jsonb_agg(jsonb_build_object(
               'bucket',     k.bucket,
               'identities', (select count(*) from per_ident p where p.n between k.lo and k.hi),
               'bookings',   (select coalesce(sum(p.n), 0)::bigint from per_ident p where p.n between k.lo and k.hi)
             ) order by k.ord)
        from visit_keys k),
    'regulars',          (select count(*) from regs),
    'lapsing_regulars',  (select count(*) from regs rg
                           where rg.last_at <= least(v_b.ts_to, now()) - interval '28 days'),
    'regulars_bookings_pct', (
      select case when count(*) > 0
                  then round(count(*) filter (where b.ident in (select rg.ident from regs rg)) * 100.0 / count(*), 1) end
        from b),
    'regulars_fixed_slot_pct', (
      select case when count(*) > 0
                  then round(count(*) filter (where rs.top * 100.0 / rs.total >= 60) * 100.0 / count(*), 1) end
        from reg_slots rs),
    'by_week', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'week_start',           wa.week_start,
               'new_identities',       coalesce(wr.new_identities, 0),
               'returning_identities', coalesce(wr.returning_identities, 0),
               'bookings',             wa.bookings
             ) order by wa.week_start), '[]'::jsonb)
        from week_all wa
        left join week_rows wr on wr.week_start = wa.week_start))
    into v_out;

  return v_out;
end $fn_analytics_courts_guests_0154$;

revoke all on function app.analytics_courts_guests(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_guests(date, date, uuid) to authenticated;
