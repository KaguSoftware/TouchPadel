-- ===========================================================================
-- 0103 — reports can compare a period with the one before it.
--
-- The report screens used to offer a "comparison" select that did nothing: no
-- report function returned an earlier period, so the operator removed it. The
-- management panel compares for real (panel_headline, 0068), and an owner
-- reading the revenue, courts or cafe report asks the same question — "is this
-- more or less than last month?".
--
-- One wrapper instead of a new parameter on each report: it runs the SAME
-- report function over the chosen period and over the comparison period, with
-- the same group and filters, and returns both documents side by side. Every
-- figure is still computed by the report that owns it; nothing new is summed
-- here, and each report keeps its own guard (revenue stays owner-only because
-- report_revenue checks it on both calls).
--
-- The comparison periods are panel_headline's exactly: previousPeriod is the
-- same number of days immediately before; sameLastYear is the same dates one
-- year earlier.
--
-- `changes` carries, for every number in the report's headline object (revenue
-- and courts `totals`, cafe `summary`), the previous value and the change —
-- panel_headline's formula: changeAbs = current - previous; changePct to one
-- decimal, only when the previous value is above zero. The operator does no
-- arithmetic on report figures, here or on the panel. A key that is itself a
-- percentage (ends in `Pct`) gets its change in points and no percentage of it.
-- ===========================================================================

create or replace function app.report_compare(
  p_report  text,
  p_from    date,
  p_to      date,
  p_compare text,
  p_group   text  default 'day',
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_compare_0103$
declare
  v_len      int;
  v_cmp_from date;
  v_cmp_to   date;
  v_cur      jsonb;
  v_prev     jsonb;
  v_path     text;
  v_changes  jsonb;
begin
  perform app.reports_guard(false);

  if p_report is null or p_report not in ('revenue','courts','cafe') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_report', hint = 'revenue | courts | cafe';
  end if;
  if p_compare is null or p_compare not in ('previousPeriod','sameLastYear') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_compare', hint = 'previousPeriod | sameLastYear';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  end if;

  if p_compare = 'previousPeriod' then
    v_len      := (p_to - p_from) + 1;
    v_cmp_to   := p_from - 1;
    v_cmp_from := p_from - v_len;
  else
    v_cmp_from := (p_from - interval '1 year')::date;
    v_cmp_to   := (p_to   - interval '1 year')::date;
  end if;

  if p_report = 'revenue' then
    v_cur  := app.report_revenue(p_from, p_to, coalesce(p_group, 'day'), coalesce(p_filters, '{}'::jsonb));
    v_prev := app.report_revenue(v_cmp_from, v_cmp_to, coalesce(p_group, 'day'), coalesce(p_filters, '{}'::jsonb));
  elsif p_report = 'courts' then
    v_cur  := app.report_courts(p_from, p_to, coalesce(p_filters, '{}'::jsonb));
    v_prev := app.report_courts(v_cmp_from, v_cmp_to, coalesce(p_filters, '{}'::jsonb));
  else
    v_cur  := app.report_cafe(p_from, p_to, coalesce(p_filters, '{}'::jsonb));
    v_prev := app.report_cafe(v_cmp_from, v_cmp_to, coalesce(p_filters, '{}'::jsonb));
  end if;

  v_path := case when p_report = 'cafe' then 'summary' else 'totals' end;
  select coalesce(jsonb_object_agg(c.k, jsonb_build_object(
           'previous',  c.prev,
           'changeAbs', c.cur - c.prev,
           'changePct', case when c.k not like '%Pct' and c.prev > 0
                             then round((c.cur - c.prev) * 100.0 / c.prev, 1) end)), '{}'::jsonb)
    into v_changes
    from (select e.key as k,
                 (e.value #>> '{}')::numeric                        as cur,
                 ((v_prev -> v_path) ->> e.key)::numeric             as prev
            from jsonb_each(coalesce(v_cur -> v_path, '{}'::jsonb)) e
           where jsonb_typeof(e.value) = 'number'
             and jsonb_typeof((v_prev -> v_path) -> e.key) = 'number') c;

  return jsonb_build_object(
    'report',     p_report,
    'current',    v_cur,
    'previous',   v_prev,
    'changes',    v_changes,
    'comparison', jsonb_build_object('mode', p_compare, 'from', v_cmp_from, 'to', v_cmp_to));
end $fn_report_compare_0103$;

revoke all on function app.report_compare(text, date, date, text, text, jsonb) from public, anon;
grant execute on function app.report_compare(text, date, date, text, text, jsonb) to authenticated;
