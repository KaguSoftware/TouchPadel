set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0422: assistant feedback, assistant errors on the Monitoring page, and a
-- weekly report (2026-11-12, assistant evaluation follow-up).
--
-- Until now nobody could say how the owner assistant was doing week to week:
-- a failed turn lived in the function log, a refusal (quota, unpriced model)
-- nowhere, and the owner had no way to say an answer was wrong. Three parts:
--
-- A. public.assistant_feedback: the owner's thumbs up or down on one answer
--    (one row per message, cascade with it), a short note only with a thumbs
--    down. The analytics_insight_rejections posture (0034): RLS on, select
--    granted, NO client write grant (the 0329 posture for assistant rows);
--    the only writer is app.assistant_rate_message (owner, definer). The
--    primary key is the message id and it references assistant_messages, so
--    PostgREST embeds it one-to-one on the clients' existing message select:
--    `feedback:assistant_feedback(rating,note)` gives an object or null.
--
-- B. The assistant edge functions report their failures to app.monitoring_
--    events through _shared/monitoring.ts reportEvent (source edge), never on
--    the turn's path (_shared/assistant/monitor.ts). Kinds: assistant_failed
--    (detail.stage before_stream or turn), assistant_refused,
--    assistant_not_saved, assistant_job_failed, assistant_free_failed (the
--    free tier is throttled per isolate; detail.suppressed counts the dropped
--    ones). Ids and codes only, never a question, an answer or vendor text.
--    No SQL is needed for that: 0393's app.report_event takes them as they are.
--
-- C. The weekly figures, from rows already stored (no model call, no new
--    write path): app.assistant_week_figures(from, to) (internal),
--    app.assistant_week_level(figures) (the warn thresholds, constants),
--    app.assistant_week_clock() (the venue's business week),
--    app.assistant_weekly_report() (service role; cron tp_assistant_weekly,
--    daily at 02:40 UTC, so a missed Monday heals itself; one assistant_weekly
--    event per week, source cron) and app.assistant_weekly_page(p_weeks)
--    (dev and owner, the Monitoring panel; computed live, so it works before
--    the first cron run). The weekly scans read assistant_messages by
--    created_at with no index: a club's volume, a full scan per week asked.
--
-- New codes: ASSISTANT_MESSAGE_NOT_FOUND, ASSISTANT_NOT_RATEABLE
-- (packages/i18n errors.ts and both catalogs).
--
-- covered by packages/db/tests/assistant-feedback.test.ts,
-- tests/assistant-weekly.test.ts, tests/rls-matrix.ts (0422 rows) and, for
-- the edge half, tests/assistant-monitor.test.ts.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. assistant_feedback
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_feedback (
  message_id uuid        primary key references public.assistant_messages(id) on delete cascade,
  -- The owner account that rated it (staff.id = auth.uid()), as
  -- assistant_conversations.owner_id (0108:43).
  rated_by   uuid        not null references public.staff(id),
  rating     smallint    not null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_feedback_rating_chk check (rating in (-1, 1)),
  -- A note says what was wrong: only beside a thumbs down, 1 to 280 characters.
  constraint assistant_feedback_note_chk
    check (note is null or (rating = -1 and char_length(note) between 1 and 280))
);

comment on table public.assistant_feedback is
  '0422. The owner''s thumbs up (1) or down (-1) on one assistant answer, one row per message (deleted with it), with an optional note beside a thumbs down. Written only by app.assistant_rate_message; the owner reads their own rows (clients embed it on the message select: feedback:assistant_feedback(rating,note)). Counted by app.assistant_week_figures.';
comment on column public.assistant_feedback.rated_by is 'The owner who rated the answer (staff.id = auth.uid()); always the conversation''s owner.';
comment on column public.assistant_feedback.rating is '1 thumbs up, -1 thumbs down. Clearing a rating deletes the row.';
comment on column public.assistant_feedback.note is 'What was wrong, 1 to 280 characters after app.safe_line; only with rating -1. Never sent to monitoring or the weekly report.';

alter table public.assistant_feedback enable row level security;
-- The 0329 posture: clients only read; the definer RPC writes.
revoke all on table public.assistant_feedback from public, anon, authenticated;
grant select on table public.assistant_feedback to authenticated;
grant select, insert, update, delete on table public.assistant_feedback to service_role;

drop policy if exists assistant_feedback_owner_read on public.assistant_feedback;
create policy assistant_feedback_owner_read on public.assistant_feedback
  for select to authenticated
  using ((select app.is_staff('owner')) and rated_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- A. app.assistant_rate_message
-- ---------------------------------------------------------------------------
create or replace function app.assistant_rate_message(
  p_message_id uuid,
  p_rating     int,
  p_note       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $assistant_rate_message_0422$
declare
  v_uid  uuid := auth.uid();
  v_msg  record;
  v_note text;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select m.role, m.tokens, m.sources, c.owner_id
    into v_msg
    from assistant_messages m
    join assistant_conversations c on c.id = m.conversation_id
   where m.id = p_message_id;
  -- Another owner's message reads as missing: its id is not confirmed.
  if not found or v_msg.owner_id is distinct from v_uid then
    raise exception 'ASSISTANT_MESSAGE_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Only an answer the owner read: not their own question, not a failed turn
  -- (its words are our error sentence), not a job's answer (a job is judged
  -- on the job card).
  if v_msg.role <> 'assistant'
     or coalesce(v_msg.tokens ? 'error_code', false)
     or jsonb_path_exists(coalesce(v_msg.sources, '[]'::jsonb), '$[*].job_id') then
    raise exception 'ASSISTANT_NOT_RATEABLE' using errcode = 'P0001';
  end if;

  if p_rating is null or p_rating not in (-1, 0, 1) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_rating', hint = '-1, 0 or 1';
  end if;

  -- 0 clears the rating.
  if p_rating = 0 then
    delete from assistant_feedback where message_id = p_message_id;
    return jsonb_build_object('messageId', p_message_id, 'rating', 0, 'note', null);
  end if;

  -- The note is one line (0080) and is kept only beside a thumbs down.
  v_note := case when p_rating = -1 then nullif(app.safe_line(p_note), '') end;
  if char_length(v_note) > 280 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_note', hint = '280 characters at most';
  end if;

  insert into assistant_feedback (message_id, rated_by, rating, note)
  values (p_message_id, v_uid, p_rating, v_note)
  on conflict (message_id) do update
     set rating     = excluded.rating,
         note       = excluded.note,
         rated_by   = excluded.rated_by,
         updated_at = now();

  return jsonb_build_object('messageId', p_message_id, 'rating', p_rating, 'note', v_note);
end
$assistant_rate_message_0422$;

comment on function app.assistant_rate_message(uuid, int, text) is
  '0422. Owner only. Rates one assistant answer of the caller''s own chat: p_rating 1 or -1 upserts the row (p_note, through app.safe_line, kept only with -1, 280 characters at most), 0 deletes it. Returns {messageId, rating, note}. FORBIDDEN for anyone but the owner; ASSISTANT_MESSAGE_NOT_FOUND for a missing message or another owner''s; ASSISTANT_NOT_RATEABLE for a question, a failed turn or a job answer; INVALID_ARGUMENT (detail p_rating or p_note).';

revoke all on function app.assistant_rate_message(uuid, int, text) from public, anon;
grant execute on function app.assistant_rate_message(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- C. The business week of the venue (internal)
-- ---------------------------------------------------------------------------
-- The venue's timezone and day start, as 0211's venue_business_date reads
-- them, and the Monday of the last COMPLETE business week.
create or replace function app.assistant_week_clock(
  out tz          text,
  out start_hour  int,
  out last_monday date
)
language plpgsql stable security definer set search_path = public as $assistant_week_clock_0422$
declare
  v_venue uuid := app.current_venue_or_default();
begin
  select v.timezone into tz from venues v where v.id = v_venue;
  tz := coalesce(tz, 'Asia/Baghdad');
  start_hour := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v_venue), 4);
  last_monday := date_trunc('week', app.business_date(now(), tz, start_hour)::timestamp)::date - 7;
end
$assistant_week_clock_0422$;

comment on function app.assistant_week_clock() is
  '0422. Internal. The default venue''s timezone, its analytics_business_day_start_hour (default 4) and the Monday of the last complete Monday-to-Sunday business week.';

revoke all on function app.assistant_week_clock() from public, anon, authenticated;
grant execute on function app.assistant_week_clock() to service_role;

-- ---------------------------------------------------------------------------
-- C. app.assistant_week_figures (internal)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_week_figures(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_week_figures_0422$
declare
  -- A turn that started before p_to is stored within seconds (50 s wall plus
  -- persist): its answer counts against its question up to here.
  c_grace constant interval := interval '2 minutes';
  v_out jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to', hint = 'after p_from';
  end if;

  with m as (
    -- Every chat row of the window plus the grace; a job's answer or failure
    -- (sources carry job_id) is counted under jobs, never as a turn.
    select x.id, x.conversation_id, x.seq, x.role, x.created_at, x.tokens, x.gate
      from assistant_messages x
     where x.created_at >= p_from
       and x.created_at < p_to + c_grace
       and not jsonb_path_exists(x.sources, '$[*].job_id')
  ),
  a as (
    select * from m where m.role = 'assistant' and m.created_at < p_to
  ),
  ev as (
    select e.kind, e.detail
      from app.monitoring_events e
     where e.at >= p_from and e.at < p_to
       and e.source = 'edge'
       and e.kind in ('assistant_failed', 'assistant_refused', 'assistant_free_failed')
  ),
  failed as (
    select code, count(*) as n
      from (select a.tokens ->> 'error_code' as code from a where a.tokens ? 'error_code'
            union all
            select coalesce(ev.detail ->> 'code', 'UNKNOWN') from ev
             where ev.kind = 'assistant_failed' and ev.detail ->> 'stage' = 'before_stream') f
     group by code
  ),
  refused as (
    select coalesce(ev.detail ->> 'code', 'UNKNOWN') as code, count(*) as n
      from ev where ev.kind = 'assistant_refused'
     group by 1
  ),
  per_conv as (
    select m.conversation_id,
           count(*) filter (where m.role = 'user' and m.created_at < p_to) as users,
           count(*) filter (where m.role = 'assistant') as answers
      from m group by m.conversation_id
  ),
  secs as (
    select extract(epoch from (a.created_at - qu.created_at))::numeric as s
      from a
      cross join lateral (
        select u.created_at
          from assistant_messages u
         where u.conversation_id = a.conversation_id and u.seq < a.seq and u.role = 'user'
         order by u.seq desc
         limit 1) qu
     where not (a.tokens ? 'error_code')
       and coalesce(a.tokens ->> 'stop_reason', '') <> 'stopped'
  ),
  fb as (
    select count(*) filter (where f.rating = 1)  as up,
           count(*) filter (where f.rating = -1) as down,
           count(*)                              as rated
      from a join assistant_feedback f on f.message_id = a.id
  ),
  jobs as (
    select count(*) filter (where j.status = 'done')   as done,
           count(*) filter (where j.status = 'failed') as failed
      from assistant_jobs j
     where j.finished_at >= p_from and j.finished_at < p_to
  ),
  q as (
    select count(*) as n from m where m.role = 'user' and m.created_at < p_to
  ),
  cost as (
    select coalesce(sum(case when jsonb_typeof(a.tokens -> 'cost_micros') = 'number'
                             then (a.tokens ->> 'cost_micros')::numeric else 0 end), 0)::bigint as micros,
           count(*) as answers,
           count(*) filter (where a.gate ->> 'status' = 'unverified') as marked
      from a
  )
  select jsonb_build_object(
           'questions', q.n,
           'answers', cost.answers,
           'failed', coalesce((select sum(n) from failed), 0),
           'failedByCode', coalesce((select jsonb_object_agg(code, n order by code) from failed), '{}'::jsonb),
           'refused', coalesce((select sum(n) from refused), 0),
           'refusedByCode', coalesce((select jsonb_object_agg(code, n order by code) from refused), '{}'::jsonb),
           'notSaved', coalesce((select sum(greatest(0, users - answers)) from per_conv), 0),
           'marked', cost.marked,
           'secondsToAnswerP50', (select round(percentile_cont(0.5) within group (order by s)::numeric, 1) from secs),
           'secondsToAnswerP95', (select round(percentile_cont(0.95) within group (order by s)::numeric, 1) from secs),
           'costMicros', cost.micros,
           'costPerQuestionMicros', case when q.n > 0 then round(cost.micros::numeric / q.n)::bigint end,
           'jobsDone', jobs.done,
           'jobsFailed', jobs.failed,
           'thumbsUp', fb.up,
           'thumbsDown', fb.down,
           'rated', fb.rated,
           'freeFailures', coalesce((select sum(1 + case when jsonb_typeof(ev.detail -> 'suppressed') = 'number'
                                                         then greatest(0, (ev.detail ->> 'suppressed')::numeric)::int else 0 end)
                                       from ev where ev.kind = 'assistant_free_failed'), 0))
    into v_out
    from q, cost, fb, jobs;

  return v_out;
end
$assistant_week_figures_0422$;

comment on function app.assistant_week_figures(timestamptz, timestamptz) is
  '0422. Internal. The assistant''s figures for [p_from, p_to) from stored rows: questions (user rows), answers, failed (stored error_code plus assistant_failed before_stream events) by code, refused (assistant_refused events) by code, notSaved (per chat, questions minus answers stored up to p_to + 2 minutes), marked (gate unverified), seconds from question to answer p50/p95 (ok, not stopped), costMicros and costPerQuestionMicros, jobsDone/jobsFailed by finished_at, thumbsUp/thumbsDown/rated, freeFailures (assistant_free_failed events plus their suppressed counts). Job answers count only under jobs. Counts and codes only.';

revoke all on function app.assistant_week_figures(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function app.assistant_week_figures(timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- C. app.assistant_week_level (internal): warn or info for one week
-- ---------------------------------------------------------------------------
create or replace function app.assistant_week_level(p_figures jsonb)
returns text
language plpgsql immutable set search_path = public as $assistant_week_level_0422$
declare
  -- The owner should look when one question in twenty fails (with enough
  -- questions to mean it), one rated answer in four is a thumbs down, or any
  -- answer was lost.
  c_failed_share constant numeric := 0.05;
  c_failed_min   constant int     := 20;
  c_down_share   constant numeric := 0.25;
  c_down_min     constant int     := 4;
  v_q      numeric := coalesce((p_figures ->> 'questions')::numeric, 0);
  v_failed numeric := coalesce((p_figures ->> 'failed')::numeric, 0);
  v_rated  numeric := coalesce((p_figures ->> 'rated')::numeric, 0);
  v_down   numeric := coalesce((p_figures ->> 'thumbsDown')::numeric, 0);
  v_lost   numeric := coalesce((p_figures ->> 'notSaved')::numeric, 0);
begin
  if (v_q >= c_failed_min and v_failed >= c_failed_share * v_q)
     or (v_rated >= c_down_min and v_down >= c_down_share * v_rated)
     or v_lost > 0 then
    return 'warn';
  end if;
  return 'info';
end
$assistant_week_level_0422$;

comment on function app.assistant_week_level(jsonb) is
  '0422. Internal, pure. warn when failed/questions >= 5% with at least 20 questions, thumbsDown/rated >= 25% with at least 4 ratings, or notSaved > 0; otherwise info.';

revoke all on function app.assistant_week_level(jsonb) from public, anon, authenticated;
grant execute on function app.assistant_week_level(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- C. app.assistant_weekly_report (service role; cron)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_weekly_report() returns jsonb
language plpgsql security definer set search_path = public as $assistant_weekly_report_0422$
declare
  v_clock record;
  v_from  timestamptz;
  v_to    timestamptz;
  v_fig   jsonb;
  v_level text;
begin
  -- Two runs at once (the cron and a hand call) must not both report.
  perform pg_advisory_xact_lock(hashtext('assistant_weekly'));
  select * into v_clock from app.assistant_week_clock();
  v_from := (v_clock.last_monday::timestamp + make_interval(hours => v_clock.start_hour)) at time zone v_clock.tz;
  v_to   := ((v_clock.last_monday + 7)::timestamp + make_interval(hours => v_clock.start_hour)) at time zone v_clock.tz;

  -- Daily schedule, one event per week: a week already reported is done.
  if exists (select 1 from app.monitoring_events e
              where e.kind = 'assistant_weekly'
                and e.at > now() - interval '21 days'
                and e.detail ->> 'weekStart' = v_clock.last_monday::text) then
    return jsonb_build_object('status', 'already_reported', 'weekStart', v_clock.last_monday);
  end if;

  v_fig := app.assistant_week_figures(v_from, v_to);
  v_level := app.assistant_week_level(v_fig);
  perform app.monitor('cron', v_level, 'assistant_weekly',
    format('Assistant week of %s: %s questions, %s failed, %s refused, %s not saved, %s marked, %s thumbs up, %s thumbs down',
           v_clock.last_monday, v_fig ->> 'questions', v_fig ->> 'failed', v_fig ->> 'refused',
           v_fig ->> 'notSaved', v_fig ->> 'marked', v_fig ->> 'thumbsUp', v_fig ->> 'thumbsDown'),
    v_fig || jsonb_build_object('weekStart', v_clock.last_monday, 'weekEnd', v_clock.last_monday + 6,
                                'timezone', v_clock.tz, 'dayStartHour', v_clock.start_hour));
  return jsonb_build_object('status', 'reported', 'weekStart', v_clock.last_monday, 'level', v_level);
exception when others then
  -- 0402's rule: a caught failure reaches the Monitoring page.
  perform app.monitor('cron', 'error', 'assistant_weekly_report_failed', sqlerrm, jsonb_build_object('sqlstate', sqlstate));
  return jsonb_build_object('status', 'failed');
end
$assistant_weekly_report_0422$;

comment on function app.assistant_weekly_report() is
  '0422. Service role (cron tp_assistant_weekly, daily 02:40 UTC). Reports the last complete business week (Monday to Sunday, the default venue''s timezone and day start) once: one assistant_weekly event (source cron, level from app.assistant_week_level) whose detail is the week''s figures plus weekStart, weekEnd, timezone, dayStartHour; nothing when that week has an event in the last 21 days. A failure is an assistant_weekly_report_failed event. Returns {status, weekStart?, level?}.';

revoke all on function app.assistant_weekly_report() from public, anon, authenticated;
grant execute on function app.assistant_weekly_report() to service_role;

-- ---------------------------------------------------------------------------
-- C. app.assistant_weekly_page (dev and owner)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_weekly_page(p_weeks int default 12)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_weekly_page_0422$
declare
  -- Inside the 90-day event retention (0393), so refusals and free failures
  -- are still there for every week shown.
  v_n     int := least(greatest(coalesce(p_weeks, 12), 1), 12);
  v_clock record;
  v_mon   date;
  v_from  timestamptz;
  v_to    timestamptz;
  v_fig   jsonb;
  v_weeks jsonb := '[]'::jsonb;
begin
  if not app.is_staff('dev', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_clock from app.assistant_week_clock();
  for i in 0 .. v_n - 1 loop
    v_mon  := v_clock.last_monday - 7 * i;
    v_from := (v_mon::timestamp + make_interval(hours => v_clock.start_hour)) at time zone v_clock.tz;
    v_to   := ((v_mon + 7)::timestamp + make_interval(hours => v_clock.start_hour)) at time zone v_clock.tz;
    v_fig  := app.assistant_week_figures(v_from, v_to);
    v_weeks := v_weeks || jsonb_build_array(jsonb_build_object(
      'weekStart', v_mon,
      'weekEnd', v_mon + 6,
      'from', v_from,
      'to', v_to,
      'level', app.assistant_week_level(v_fig),
      'figures', v_fig));
  end loop;

  return jsonb_build_object(
    'weeks', v_weeks,
    'timezone', v_clock.tz,
    'dayStartHour', v_clock.start_hour,
    'serverTime', now());
end
$assistant_weekly_page_0422$;

comment on function app.assistant_weekly_page(int) is
  '0422. Dev and owner (the Monitoring page). The last p_weeks (1..12, default 12) complete business weeks, newest first, computed live by app.assistant_week_figures: {weeks: [{weekStart, weekEnd, from, to, level, figures}], timezone, dayStartHour, serverTime}. FORBIDDEN for anyone else. Read-only.';

revoke all on function app.assistant_weekly_page(int) from public, anon;
grant execute on function app.assistant_weekly_page(int) to authenticated;

-- ---------------------------------------------------------------------------
-- C. The schedule, through 0385's app.ensure_cron.
-- ---------------------------------------------------------------------------
do $assistant_weekly_cron_0422$
begin
  perform app.ensure_cron('tp_assistant_weekly', '40 2 * * *', 'select app.assistant_weekly_report();');
end $assistant_weekly_cron_0422$;
