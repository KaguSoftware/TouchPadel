-- 0355 legacy_report_months — each pre-system monthly report counted in a
-- range now carries its own figures, so Analytics › Courts can draw it.
--
-- Majed 2026-10-21: the analytics charts "only show for 30 days even if the
-- selected period is more; make sure it always shows the selected data fully
-- with nothing missed". Since 0349 the reports count in the Bookings and Padel
-- revenue figures, but the lines under them are drawn from by_day, which the
-- reports cannot fill (they have no days), so a range over the report months
-- showed only the system's own weeks. With each report's figures the page can
-- draw such a range by month, a report month as the report wrote it; nothing
-- is split into days.
--
-- Re-issued from its latest body (20261017000349_legacy_reports_in_figures.sql:41),
-- verbatim except the marked 0355 lines: each `included` entry gains bookings
-- (completed), cancellations (cancelled), noShows (no_show) and lessons
-- (training), from the summary figures as the totals are, null where the
-- report does not have that figure. Same signature, same revoke. Its callers
-- (panel_headline, analytics_courts_summary) pass the object through
-- unchanged, so their `history.included` gains the same keys; nothing else moves.

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.legacy_report_totals(p_venues uuid[], p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $legacy_report_totals_0355$
declare
  v_out jsonb;
begin
  with
  inc as (
    select lr.* from legacy_reports lr
     where lr.venue_id = any(coalesce(p_venues, '{}'::uuid[]))
       and lr.period_from >= p_from and lr.period_to <= p_to),
  part as (
    select lr.* from legacy_reports lr
     where lr.venue_id = any(coalesce(p_venues, '{}'::uuid[]))
       and lr.period_from <= p_to and lr.period_to >= p_from
       and not (lr.period_from >= p_from and lr.period_to <= p_to)),
  fig as (
    select f.category, sum(f.count)::bigint as n
      from legacy_report_figures f
      join inc on inc.id = f.report_id
     where f.source = 'summary'
     group by f.category),
  -- 0355: the same summary figures, per report.
  per as (
    select f.report_id,
           sum(f.count) filter (where f.category = 'completed')::bigint as bookings,
           sum(f.count) filter (where f.category = 'cancelled')::bigint as cancellations,
           sum(f.count) filter (where f.category = 'no_show')::bigint   as no_shows,
           sum(f.count) filter (where f.category = 'training')::bigint  as lessons
      from legacy_report_figures f
      join inc on inc.id = f.report_id
     where f.source = 'summary'
     group by f.report_id)
  select jsonb_build_object(
    'bookings',      (select n from fig where category = 'completed'),
    'cancellations', (select n from fig where category = 'cancelled'),
    'noShows',       (select n from fig where category = 'no_show'),
    'lessons',       (select n from fig where category = 'training'),
    'revenue',       (select sum(revenue_amount)::bigint from inc),
    'revenueApproximate', coalesce((select bool_or(revenue_approximate) from inc where revenue_amount is not null), false),
    'included', coalesce((select jsonb_agg(jsonb_build_object(
                    'from', inc.period_from, 'to', inc.period_to, 'department', inc.department,
                    'revenue', inc.revenue_amount, 'revenueApproximate', inc.revenue_approximate,
                    -- 0355: the report's own figures.
                    'bookings', per.bookings, 'cancellations', per.cancellations,
                    'noShows', per.no_shows, 'lessons', per.lessons)
                    order by inc.period_from)
                    from inc left join per on per.report_id = inc.id), '[]'::jsonb),
    'partial',  coalesce((select jsonb_agg(jsonb_build_object(
                    'from', part.period_from, 'to', part.period_to, 'department', part.department)
                    order by part.period_from) from part), '[]'::jsonb))
    into v_out;
  return v_out;
end $legacy_report_totals_0355$;

comment on function app.legacy_report_totals(uuid[], date, date) is
  '0349, 0355. Internal (read by panel_headline and analytics_courts_summary). The pre-system monthly reports (legacy_reports) of p_venues whose WHOLE period lies in [p_from, p_to], summed from their summary figures (Majed 2026-10-17: summary and chart win over a disagreeing table): bookings (completed), cancellations (cancelled), noShows (no_show), lessons (training), revenue (revenue_amount, padel court money from desk reservations) and revenueApproximate (a report calls its amount approximate); null where no included report has that figure. included: those reports {from, to, department, revenue, revenueApproximate, bookings, cancellations, noShows, lessons} (0355: each report''s own summary figures, null where it has none, so a chart can draw the report''s month); partial: the reports the range overlaps but does not wholly contain (left out, never split into days).';

revoke all on function app.legacy_report_totals(uuid[], date, date) from public, anon, authenticated;
