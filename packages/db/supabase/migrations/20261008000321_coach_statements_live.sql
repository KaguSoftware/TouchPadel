set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0321 coach_statements_live — Coach pay shows who is getting what NOW.
-- A statement is drafted on the 1st for the month before, so for the month in
-- progress (and any month not yet drafted) the Coach pay screen had no
-- coach to list. app.report_coach_statements gains one key, `live`: for every
-- coach and branch with a statement lesson in the asked month, the accrual at
-- the figures now (the same app.coach_statement_lessons the statements are
-- drafted from; a draft is rebuilt to it, but an approved or paid statement is
-- frozen, so money that moved after it shows here and reaches the coach as an
-- adjustment on the next statement), and the pair's live statement when there
-- is one. Re-issued from its latest body (0293),
-- verbatim except for `live` (v_live, its query, the returned key and the
-- comment); same signature, same grants; dollar tag _0321.

create or replace function app.report_coach_statements(p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $report_coach_statements_0321$
declare
  v_rv      uuid[] := app.report_venues();
  v_tz      text;
  v_now     date;
  v_month   date;
  v_rows    jsonb;
  v_missing jsonb;
  v_totals  jsonb;
  v_live    jsonb;
begin
  perform app.reports_guard(false);
  v_tz    := coalesce((select v.timezone from venues v where v.id = app.analysis_venue()), 'Asia/Baghdad');
  v_now   := date_trunc('month', (now() at time zone v_tz)::date)::date;
  v_month := coalesce(date_trunc('month', p_month)::date, (v_now - interval '1 month')::date);

  select coalesce(jsonb_agg(jsonb_build_object(
           'statement_id',     s.id,
           'coach_id',         s.coach_id,
           'coach_name_en',    c.display_name_en,
           'coach_name_ar',    c.display_name_ar,
           'venue_id',         s.venue_id,
           'venue_name_en',    v.name_en,
           'venue_name_ar',    v.name_ar,
           'month',            s.month,
           'status',           s.status,
           'lessons_count',    s.lessons_count,
           'collected_iqd',    s.collected_iqd,
           'court_share_iqd',  s.court_share_iqd,
           'coach_iqd',        s.coach_iqd,
           'adjustments_iqd',  s.adjustments_iqd,
           'total_iqd',        s.coach_iqd + s.adjustments_iqd,
           'payable_iqd',      s.coach_iqd + s.adjustments_iqd,
           'drafted_at',       s.drafted_at,
           'refreshed_at',     s.refreshed_at,
           'approved_at',      s.approved_at,
           'approved_by_name', ab.display_name,
           'paid_at',          s.paid_at,
           'paid_by_name',     pb.display_name,
           'paid_reference',   s.paid_reference,
           'voided_at',        s.voided_at,
           'void_reason',      s.void_reason)
           order by v.name_en, c.display_name_en, s.drafted_at), '[]'::jsonb),
         jsonb_build_object(
           'statements',          count(*) filter (where s.status <> 'void'),
           'collected_iqd',       coalesce(sum(s.collected_iqd)   filter (where s.status <> 'void'), 0)::bigint,
           'court_share_iqd',     coalesce(sum(s.court_share_iqd) filter (where s.status <> 'void'), 0)::bigint,
           'coach_iqd',           coalesce(sum(s.coach_iqd)       filter (where s.status <> 'void'), 0)::bigint,
           'adjustments_iqd',     coalesce(sum(s.adjustments_iqd) filter (where s.status <> 'void'), 0)::bigint,
           'total_iqd',           coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status <> 'void'), 0)::bigint,
           'payable_iqd',         coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status <> 'void'), 0)::bigint,
           'approved_unpaid_iqd', coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status = 'approved'), 0)::bigint,
           'unpaid_iqd',          coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status = 'approved'), 0)::bigint,
           'paid_iqd',            coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status = 'paid'), 0)::bigint)
    into v_rows, v_totals
    from coach_statements s
    join coaches c on c.id = s.coach_id
    join venues v on v.id = s.venue_id
    left join staff ab on ab.id = s.approved_by
    left join staff pb on pb.id = s.paid_by
   where s.venue_id = any (v_rv) and s.month = v_month;

  -- Pairs with statement lessons in the month and no live statement: blocked
  -- by a live draft of another month (CM-8), or the month not drafted yet.
  -- 0293 (DB-25): a pair is kept only while one of those lessons has no line
  -- on a statement that is not void (a voided month whose lessons a later
  -- statement settled as adjustments waits for nothing). 0293 (DB-24): the
  -- blocking draft is older_draft when its month is before this one,
  -- newer_draft when after, and named (blocking_month, blocking_statement_id).
  with pairs as (
    select sl.coach_id, sl.venue_id
      from unnest(v_rv) as rv(vid)
      join venues v on v.id = rv.vid
      cross join lateral app.coach_statement_lessons(
                   array[rv.vid],
                   v_month::timestamp at time zone coalesce(v.timezone, 'Asia/Baghdad'),
                   ((v_month + interval '1 month')::date)::timestamp at time zone coalesce(v.timezone, 'Asia/Baghdad'),
                   null) sl
     where not exists (select 1
                         from coach_statement_lines ln
                         join coach_statements s4 on s4.id = ln.statement_id and s4.status <> 'void'
                        where ln.lesson_id = sl.lesson_id)
     group by sl.coach_id, sl.venue_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'coach_id',              p.coach_id,
           'coach_name_en',         c.display_name_en,
           'coach_name_ar',         c.display_name_ar,
           'venue_id',              p.venue_id,
           'reason',                case when b.id is null then 'not_drafted'
                                         when b.month < v_month then 'older_draft'
                                         else 'newer_draft' end,
           'blocking_month',        b.month,
           'blocking_statement_id', b.id)
           order by c.display_name_en, p.venue_id), '[]'::jsonb)
    into v_missing
    from pairs p
    join coaches c on c.id = p.coach_id
    left join lateral (select s2.id, s2.month
                         from coach_statements s2
                        where s2.coach_id = p.coach_id and s2.venue_id = p.venue_id
                          and s2.status = 'draft' and s2.month <> v_month
                        order by s2.month
                        limit 1) b on true
   where not exists (select 1 from coach_statements s3
                      where s3.coach_id = p.coach_id and s3.venue_id = p.venue_id
                        and s3.month = v_month and s3.status <> 'void');

  -- 0321: who is getting what, at the figures now. One row per coach and
  -- branch with a statement lesson starting in the month (over, and completed
  -- or still scheduled, or kept after a late cancel: app.coach_statement_lessons),
  -- their lesson counts by kind, minutes taught, the money collected on them,
  -- the court's share and the coach's share, and the pair's live statement of
  -- the month (draft, approved or paid; void ones are not live) when one is
  -- drafted. Biggest coach share first.
  with sl as (
    select s.*
      from unnest(v_rv) as rv(vid)
      join venues v on v.id = rv.vid
      cross join lateral app.coach_statement_lessons(
                   array[rv.vid],
                   v_month::timestamp at time zone coalesce(v.timezone, 'Asia/Baghdad'),
                   ((v_month + interval '1 month')::date)::timestamp at time zone coalesce(v.timezone, 'Asia/Baghdad'),
                   null) s),
  agg as (
    select sl.coach_id, sl.venue_id,
           count(*)::int                                   as lessons,
           (count(*) filter (where sl.kind = 'private'))::int as n_private,
           (count(*) filter (where sl.kind = 'group'))::int   as n_group,
           (count(*) filter (where sl.kind = 'course'))::int  as n_course,
           coalesce(sum(sl.minutes), 0)::int               as minutes,
           coalesce(sum(sl.collected_iqd), 0)::bigint      as collected,
           coalesce(sum(sl.court_share_iqd), 0)::bigint    as court_share,
           coalesce(sum(sl.coach_iqd), 0)::bigint          as coach_iqd
      from sl
     group by sl.coach_id, sl.venue_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'coach_id',            a.coach_id,
           'coach_name_en',       c.display_name_en,
           'coach_name_ar',       c.display_name_ar,
           'venue_id',            a.venue_id,
           'venue_name_en',       v.name_en,
           'venue_name_ar',       v.name_ar,
           'lessons_count',       a.lessons,
           'private_count',       a.n_private,
           'group_count',         a.n_group,
           'course_count',        a.n_course,
           'minutes',             a.minutes,
           'collected_iqd',       a.collected,
           'court_share_iqd',     a.court_share,
           'coach_iqd',           a.coach_iqd,
           'statement_id',        st.id,
           'statement_status',    st.status,
           'statement_total_iqd', st.coach_iqd + st.adjustments_iqd)
           order by a.coach_iqd desc, c.display_name_en, a.venue_id), '[]'::jsonb)
    into v_live
    from agg a
    join coaches c on c.id = a.coach_id
    join venues v on v.id = a.venue_id
    left join lateral (select s5.id, s5.status, s5.coach_iqd, s5.adjustments_iqd
                         from coach_statements s5
                        where s5.coach_id = a.coach_id and s5.venue_id = a.venue_id
                          and s5.month = v_month and s5.status <> 'void'
                        order by s5.drafted_at desc
                        limit 1) st on true;

  return jsonb_build_object(
    'month',         v_month,
    'current_month', v_now,
    'server_now',    now(),
    'statements',    v_rows,
    'missing',       v_missing,
    'totals',        v_totals,
    'live',          v_live);
end $report_coach_statements_0321$;

comment on function app.report_coach_statements(date) is
  '0287, 0293, 0321 (money.md §7.5, X22; C-12, C-28, R21, R42; DB-24, DB-25). Manager or owner (reports_guard): the coach statements of month p_month (default the previous month in the analysed branch''s time zone) at every branch in the report scope, void ones listed and left out of the totals. {month, current_month, server_now, statements [{statement_id, coach_id, coach_name_en, coach_name_ar, venue_id, venue_name_en, venue_name_ar, month, status, lessons_count, collected_iqd, court_share_iqd, coach_iqd, adjustments_iqd, total_iqd, payable_iqd (= coach_iqd + adjustments_iqd), drafted_at, refreshed_at, approved_at, approved_by_name, paid_at, paid_by_name, paid_reference, voided_at, void_reason}], missing [{coach_id, coach_name_en, coach_name_ar, venue_id, reason: older_draft | newer_draft | not_drafted, blocking_month, blocking_statement_id}] (pairs with a statement lesson of the month on no statement that is not void and no live statement of the month; older_draft / newer_draft: the pair''s live draft of an earlier / later month stands in the way, named by blocking_month and blocking_statement_id, both NULL for not_drafted), totals {statements, collected_iqd, court_share_iqd, coach_iqd, adjustments_iqd, total_iqd, payable_iqd, approved_unpaid_iqd, unpaid_iqd, paid_iqd}, live [{coach_id, coach_name_en, coach_name_ar, venue_id, venue_name_en, venue_name_ar, lessons_count, private_count, group_count, course_count, minutes, collected_iqd, court_share_iqd, coach_iqd, statement_id, statement_status, statement_total_iqd}] (0321: one row per coach and branch with a statement lesson in the month, at the figures now from app.coach_statement_lessons, biggest coach_iqd first; an approved or paid statement is frozen, so after a later refund its totals differ from this row until the next statement carries the adjustment; statement_* name the pair''s live statement of the month, NULL when none is drafted yet)}. A person-money report: coach display names, never a guest; never an assistant tool (R42). FORBIDDEN.';

revoke all on function app.report_coach_statements(date) from public, anon;
grant execute on function app.report_coach_statements(date) to authenticated;
