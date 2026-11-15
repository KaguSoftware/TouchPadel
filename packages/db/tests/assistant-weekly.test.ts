/**
 * 0422 the assistant's weekly figures, report and Monitoring panel read.
 *
 * ONE rolled-back psql transaction (tests/psql-scenario.ts); nothing survives:
 *   * app.assistant_week_figures over a planted week in 1990 (far from any
 *     real row) gives exact figures: questions, answers, failed by code
 *     (stored error_code plus before_stream events only), refused by code,
 *     not saved (an answer inside the 2-minute grace counts), marked, seconds
 *     to answer p50/p95 (ok, not stopped), cost per question, jobs by
 *     finished_at, thumbs (a job answer's rating is not a turn's), free
 *     failures with their suppressed counts; job answers count only as jobs;
 *     an event from another source or outside the window counts nowhere;
 *   * the week is Monday to Sunday in business time: assistant_week_clock's
 *     Monday is a Monday, the last COMPLETE week, and a row one second
 *     before the start or at the end is outside it;
 *   * app.assistant_week_level's thresholds;
 *   * app.assistant_weekly_report: one assistant_weekly event for the week,
 *     its detail the week's figures plus weekStart/weekEnd; a second run
 *     reports nothing; a forced failure writes assistant_weekly_report_failed
 *     with the SQLSTATE (not part of tests/sweeps-report.test.ts, whose rule
 *     is the first monitor call after the handler);
 *   * app.assistant_weekly_page: dev and owner, 12 weeks newest first,
 *     p_weeks clamped to 1..12; FORBIDDEN for a manager and a cashier;
 *   * app.setup_missing() is empty (tp_assistant_weekly is scheduled).
 *
 * Needs migration 0422 applied (CI applies it); skips when the stack is down.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { docker, FX, LET, MK, Q, scenario, T, type Results } from './psql-scenario';

const up = await stackAvailable();

/** The planted week: Monday 1990-01-01 04:00 Baghdad (01:00 UTC) to the next Monday. */
const FROM = `timestamptz '1990-01-01 01:00:00+00'`;
const TO = `timestamptz '1990-01-08 01:00:00+00'`;
const T0 = `timestamptz '1990-01-02 09:00:00+00'`;

const msg = (conv: string, seq: number, role: string, at: string, tokens = '{}', extra: { gate?: string; sources?: string } = {}) =>
  `insert into assistant_messages (conversation_id, seq, role, content, tokens, gate, sources, created_at)
   values ({{${conv}}}::uuid, ${seq}, '${role}', '[{"type":"text","text":"x"}]', '${tokens}'::jsonb,
           ${extra.gate ? `'${extra.gate}'::jsonb` : 'null'}, '${extra.sources ?? '[]'}'::jsonb, ${at}) returning id`;
const ev = (kind: string, detail: string, at: string, source = 'edge') =>
  FX(`insert into app.monitoring_events (source, level, kind, message, detail, at)
      values ('${source}', 'error', '${kind}', 'probe', '${detail}'::jsonb, ${at})`);

const PLANT = [
  MK('dev1', 'dev', null),
  LET('cx', `insert into assistant_conversations (owner_id, title) values ({{owner}}::uuid, 'weekly x') returning id`),
  LET('cy', `insert into assistant_conversations (owner_id, title) values ({{owner}}::uuid, 'weekly y') returning id`),
  // Conversation x: four answered questions (ok, ok+marked, failed, stopped), one lost, one job answer.
  LET('x1', msg('cx', 1, 'user', T0)),
  LET('x2', msg('cx', 2, 'assistant', `${T0} + interval '10 seconds'`, '{"cost_micros":1000,"stop_reason":"end_turn"}', { gate: '{"status":"ok"}' })),
  LET('x3', msg('cx', 3, 'user', `${T0} + interval '1 hour'`)),
  LET('x4', msg('cx', 4, 'assistant', `${T0} + interval '1 hour 30 seconds'`, '{"cost_micros":3000,"stop_reason":"end_turn"}', { gate: '{"status":"unverified"}' })),
  LET('x5', msg('cx', 5, 'user', `${T0} + interval '2 hours'`)),
  LET('x6', msg('cx', 6, 'assistant', `${T0} + interval '2 hours 5 seconds'`, '{"cost_micros":500,"stop_reason":"UPSTREAM","error_code":"UPSTREAM"}')),
  LET('x7', msg('cx', 7, 'user', `${T0} + interval '3 hours'`)),
  LET('x8', msg('cx', 8, 'assistant', `${T0} + interval '3 hours 2 seconds'`, '{"cost_micros":200,"stop_reason":"stopped"}')),
  LET('x9', msg('cx', 9, 'user', `${T0} + interval '4 hours'`)),
  LET('x10', msg('cx', 10, 'assistant', `${T0} + interval '5 hours'`, '{"cost_micros":99999,"stop_reason":"end_turn"}', { sources: '[{"job_id":"cccccccc-0000-4000-8000-000000000003"}]' })),
  // Conversation y: asked 30 s before the end, answered inside the grace.
  LET('y1', msg('cy', 1, 'user', `${TO} - interval '30 seconds'`)),
  LET('y2', msg('cy', 2, 'assistant', `${TO} + interval '60 seconds'`, '{"cost_micros":0,"stop_reason":"end_turn"}')),
  // Ratings: one up, one down, and a job answer's (not a turn).
  FX(`insert into assistant_feedback (message_id, rated_by, rating) values ({{x2}}::uuid, {{owner}}::uuid, 1)`),
  FX(`insert into assistant_feedback (message_id, rated_by, rating, note) values ({{x4}}::uuid, {{owner}}::uuid, -1, 'wrong')`),
  FX(`insert into assistant_feedback (message_id, rated_by, rating) values ({{x10}}::uuid, {{owner}}::uuid, -1)`),
  // Jobs by finished_at.
  FX(`insert into assistant_jobs (conversation_id, status, plan, estimate, finished_at) values ({{cx}}::uuid, 'done', '{}', '{}', ${T0})`),
  FX(`insert into assistant_jobs (conversation_id, status, plan, estimate, finished_at) values ({{cx}}::uuid, 'failed', '{}', '{}', ${T0})`),
  FX(`insert into assistant_jobs (conversation_id, status, plan, estimate, finished_at) values ({{cx}}::uuid, 'done', '{}', '{}', ${FROM} - interval '1 second')`),
  // Events.
  ev('assistant_failed', '{"stage":"before_stream","code":"NOT_CONFIGURED"}', T0),
  ev('assistant_failed', '{"stage":"turn","code":"UPSTREAM"}', T0), // the stored row already counts it
  ev('assistant_failed', '{"stage":"before_stream","code":"INTERNAL"}', `${FROM} - interval '1 second'`), // outside
  ev('assistant_failed', '{"stage":"before_stream","code":"INTERNAL"}', T0, 'web'), // not the edge
  ev('assistant_refused', '{"code":"LLM_DAILY_QUOTA"}', T0),
  ev('assistant_refused', '{"code":"LLM_DAILY_QUOTA"}', T0),
  ev('assistant_refused', '{"code":"ASSISTANT_MODEL_NOT_PRICED"}', T0),
  ev('assistant_free_failed', '{"code":"UPSTREAM"}', T0),
  ev('assistant_free_failed', '{"code":"UPSTREAM","suppressed":4}', T0),
];

const EXPECTED = {
  questions: 6,
  answers: 4,
  failed: 2,
  failedByCode: { NOT_CONFIGURED: 1, UPSTREAM: 1 },
  refused: 3,
  refusedByCode: { ASSISTANT_MODEL_NOT_PRICED: 1, LLM_DAILY_QUOTA: 2 },
  notSaved: 1,
  marked: 1,
  secondsToAnswerP50: 20,
  secondsToAnswerP95: 29,
  costMicros: 4700,
  costPerQuestionMicros: 783,
  jobsDone: 1,
  jobsFailed: 1,
  thumbsUp: 1,
  thumbsDown: 1,
  rated: 2,
  freeFailures: 6,
};

/** The real last complete week's bounds from the clock (the page's own are checked against the clock below). */
const LAST_WEEK = `(select jsonb_build_object(
    'from', (c.last_monday::timestamp + make_interval(hours => c.start_hour)) at time zone c.tz,
    'to', ((c.last_monday + 7)::timestamp + make_interval(hours => c.start_hour)) at time zone c.tz)
  from app.assistant_week_clock() c)`;

const LEVELS: [string, string, string][] = [
  ['l_fail_at', `{"questions":20,"failed":1}`, 'warn'],
  ['l_fail_none', `{"questions":20,"failed":0}`, 'info'],
  ['l_fail_few_q', `{"questions":19,"failed":19}`, 'info'],
  ['l_fail_low', `{"questions":40,"failed":1}`, 'info'],
  ['l_down_at', `{"rated":4,"thumbsDown":1}`, 'warn'],
  ['l_down_few', `{"rated":3,"thumbsDown":3}`, 'info'],
  ['l_down_low', `{"rated":5,"thumbsDown":1}`, 'info'],
  ['l_lost', `{"notSaved":1}`, 'warn'],
  ['l_empty', `{}`, 'info'],
];

const CALLS = [
  Q('figures', `select app.assistant_week_figures(${FROM}, ${TO})`),
  Q('level_planted', `select to_jsonb(app.assistant_week_level(app.assistant_week_figures(${FROM}, ${TO})))`),
  Q('bad_window', `select app.assistant_week_figures(${TO}, ${FROM})`),
  ...LEVELS.map(([label, fig]) => Q(label, `select to_jsonb(app.assistant_week_level('${fig}'::jsonb))`)),
  // The clock and the business week.
  Q('clock', `select to_jsonb(c) from app.assistant_week_clock() c`),
  Q('today', `select to_jsonb(app.venue_business_date(app.current_venue_or_default(), now()))`),
  Q('isodow', `select to_jsonb(extract(isodow from (select last_monday from app.assistant_week_clock()))::int)`),
  // Boundaries: one second before the start and at the end are outside.
  LET('cb', `insert into assistant_conversations (owner_id, title) values ({{owner}}::uuid, 'weekly bounds') returning id`),
  Q('before_bounds', `select app.assistant_week_figures((${LAST_WEEK} ->> 'from')::timestamptz, (${LAST_WEEK} ->> 'to')::timestamptz) -> 'questions'`),
  FX(`insert into assistant_messages (conversation_id, seq, role, content, created_at)
      select {{cb}}::uuid, s.seq, 'user', '[]', s.at
        from (select ${LAST_WEEK} as w) b,
             lateral (values (1, (b.w ->> 'from')::timestamptz - interval '1 second'),
                             (2, (b.w ->> 'from')::timestamptz),
                             (3, (b.w ->> 'to')::timestamptz - interval '1 second'),
                             (4, (b.w ->> 'to')::timestamptz)) s(seq, at)`),
  Q('after_bounds', `select app.assistant_week_figures((${LAST_WEEK} ->> 'from')::timestamptz, (${LAST_WEEK} ->> 'to')::timestamptz) -> 'questions'`),
  // The page: who, how many, which order.
  T('page_owner', 'owner', `select app.assistant_weekly_page()`),
  T('page_dev', 'dev1', `select app.assistant_weekly_page(3)`),
  T('page_zero', 'owner', `select jsonb_array_length(app.assistant_weekly_page(0) -> 'weeks')`),
  T('page_many', 'owner', `select jsonb_array_length(app.assistant_weekly_page(50) -> 'weeks')`),
  T('page_null', 'owner', `select jsonb_array_length(app.assistant_weekly_page(null) -> 'weeks')`),
  T('page_manager', 'manager', `select app.assistant_weekly_page()`),
  T('page_cashier', 'cashier', `select app.assistant_weekly_page()`),
  // The report: once per week.
  FX(`delete from app.monitoring_events where kind in ('assistant_weekly', 'assistant_weekly_report_failed')`),
  Q('report_1', `select app.assistant_weekly_report()`),
  Q('report_2', `select app.assistant_weekly_report()`),
  Q('events', `select coalesce(jsonb_agg(jsonb_build_object('source', source, 'level', level, 'message', message, 'detail', detail) order by id), '[]')
                 from app.monitoring_events where kind = 'assistant_weekly'`),
  Q('week_figures', `select app.assistant_week_figures((${LAST_WEEK} ->> 'from')::timestamptz, (${LAST_WEEK} ->> 'to')::timestamptz)`),
  Q('week_level', `select to_jsonb(app.assistant_week_level(app.assistant_week_figures((${LAST_WEEK} ->> 'from')::timestamptz, (${LAST_WEEK} ->> 'to')::timestamptz)))`),
  // Setup and the schedule.
  Q('setup_missing', `select coalesce(jsonb_agg(m.kind || ':' || m.name), '[]') from app.setup_missing() m`),
  Q('cron', `select jsonb_build_object('schedule', schedule, 'command', command) from cron.job where jobname = 'tp_assistant_weekly'`),
  // A forced failure (the function replaced inside this rolled-back transaction).
  FX(`delete from app.monitoring_events where kind in ('assistant_weekly', 'assistant_weekly_report_failed')`),
  FX(`create or replace function app.assistant_week_figures(p_from timestamptz, p_to timestamptz) returns jsonb
      language plpgsql as $f$ begin raise exception 'weekly probe failure'; end $f$`),
  Q('report_fail', `select app.assistant_weekly_report()`),
  Q('fail_events', `select coalesce(jsonb_agg(jsonb_build_object('source', source, 'level', level, 'kind', kind, 'message', message, 'detail', detail) order by id), '[]')
                      from app.monitoring_events where kind in ('assistant_weekly', 'assistant_weekly_report_failed')`),
];

function ok(r: Results, label: string): unknown {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''}`).toBe(true);
  return o!.data;
}

interface Week {
  weekStart: string;
  weekEnd: string;
  from: string;
  to: string;
  level: string;
  figures: Record<string, unknown>;
}
interface Page {
  weeks: Week[];
  timezone: string;
  dayStartHour: number;
  serverTime: string;
}

const day = (iso: string, plus: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plus);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!up || !docker)('0422 the assistant weekly figures, report and page (rolled back)', () => {
  let r: Results = {};

  beforeAll(() => {
    r = scenario([...PLANT, ...CALLS]);
  });

  it('a planted week gives exact figures (job answers only as jobs; other sources and other weeks nowhere)', () => {
    expect(ok(r, 'figures')).toEqual(EXPECTED);
    expect(ok(r, 'level_planted')).toBe('warn'); // one answer lost
  });

  it('an empty or reversed window is INVALID_ARGUMENT', () => {
    expect(r.bad_window?.ok).toBe(false);
    expect(r.bad_window?.code).toBe('INVALID_ARGUMENT');
  });

  it('the warn thresholds: 5% failed from 20 questions, 25% thumbs down from 4 ratings, any lost answer', () => {
    for (const [label, , level] of LEVELS) expect(ok(r, label), label).toBe(level);
  });

  it('the week is the last COMPLETE Monday-to-Sunday business week, from the day start in the venue timezone', () => {
    const clock = ok(r, 'clock') as { tz: string; start_hour: number; last_monday: string };
    const today = ok(r, 'today') as string;
    expect(ok(r, 'isodow')).toBe(1);
    // Today is in the week after it: Monday + 7 <= today <= Monday + 13.
    expect(today >= day(clock.last_monday, 7) && today <= day(clock.last_monday, 13), `${clock.last_monday} vs ${today}`).toBe(true);
    const page = ok(r, 'page_owner') as Page;
    const w = page.weeks[0]!;
    expect(w.weekStart).toBe(clock.last_monday);
    expect(w.weekEnd).toBe(day(clock.last_monday, 6));
    expect(page.timezone).toBe(clock.tz);
    expect(page.dayStartHour).toBe(clock.start_hour);
    if (clock.tz === 'Asia/Baghdad') {
      // UTC+3 all year: the week opens at start_hour local on Monday.
      const opens = Date.parse(`${clock.last_monday}T00:00:00Z`) + (clock.start_hour - 3) * 3_600_000;
      expect(Date.parse(w.from)).toBe(opens);
      expect(Date.parse(w.to)).toBe(opens + 7 * 86_400_000);
    }
    // A question one second before the start and one at the end are outside; at the start and one second before the end inside.
    expect(Number(ok(r, 'after_bounds')) - Number(ok(r, 'before_bounds'))).toBe(2);
  });

  it('the page: owner and dev, newest week first, consecutive Mondays, p_weeks clamped to 1..12; FORBIDDEN for a manager and a cashier', () => {
    const owner = ok(r, 'page_owner') as Page;
    expect(owner.weeks).toHaveLength(12);
    owner.weeks.forEach((w, i) => {
      expect(w.weekStart).toBe(day(owner.weeks[0]!.weekStart, -7 * i));
      expect(['info', 'warn']).toContain(w.level);
      expect(Object.keys(w.figures).sort()).toEqual(Object.keys(EXPECTED).sort());
    });
    expect((ok(r, 'page_dev') as Page).weeks.map((w) => w.weekStart)).toEqual(owner.weeks.slice(0, 3).map((w) => w.weekStart));
    expect(ok(r, 'page_zero')).toBe(1);
    expect(ok(r, 'page_many')).toBe(12);
    expect(ok(r, 'page_null')).toBe(12);
    for (const label of ['page_manager', 'page_cashier']) {
      expect(r[label]?.ok, label).toBe(false);
      expect(r[label]?.code, label).toBe('FORBIDDEN');
    }
  });

  it('the report: one assistant_weekly event for the week with its figures, then nothing on a second run', () => {
    const page = ok(r, 'page_owner') as Page;
    const monday = page.weeks[0]!.weekStart;
    const level = ok(r, 'week_level') as string;
    expect(ok(r, 'report_1')).toEqual({ status: 'reported', weekStart: monday, level });
    expect(ok(r, 'report_2')).toEqual({ status: 'already_reported', weekStart: monday });
    const events = ok(r, 'events') as { source: string; level: string; message: string; detail: Record<string, unknown> }[];
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.source).toBe('cron');
    expect(e.level).toBe(level);
    expect(e.message).toMatch(new RegExp(`^Assistant week of ${monday}: \\d+ questions, \\d+ failed, \\d+ refused, \\d+ not saved, \\d+ marked, \\d+ thumbs up, \\d+ thumbs down$`));
    expect(e.detail).toEqual({
      ...(ok(r, 'week_figures') as Record<string, unknown>),
      weekStart: monday,
      weekEnd: day(monday, 6),
      timezone: page.timezone,
      dayStartHour: page.dayStartHour,
    });
  });

  it('a forced failure writes assistant_weekly_report_failed (source cron, error, the SQLSTATE) and no weekly event', () => {
    expect(ok(r, 'report_fail')).toEqual({ status: 'failed' });
    expect(ok(r, 'fail_events')).toEqual([
      { source: 'cron', level: 'error', kind: 'assistant_weekly_report_failed', message: 'weekly probe failure', detail: { sqlstate: 'P0001' } },
    ]);
  });

  it('setup is complete: tp_assistant_weekly runs daily at 02:40 UTC', () => {
    expect(ok(r, 'setup_missing')).toEqual([]);
    expect(ok(r, 'cron')).toEqual({ schedule: '40 2 * * *', command: 'select app.assistant_weekly_report();' });
  });
});
