/**
 * _shared/assistant/monitor.ts (2026-11-12, migration 0422): what the
 * assistant edge functions put in a Monitoring event, and that reporting can
 * never cost a turn anything.
 *
 *   * privacy: a guest name placed in a question, an answer, tool arguments,
 *     a note or an error text never reaches the body posted to
 *     app.report_event (the detail is an allowlist; the message a fixed
 *     sentence);
 *   * the level table by kind and code;
 *   * the throttle: one event per key per window, `suppressed` on the next;
 *   * reportInBackground: hands the post to EdgeRuntime.waitUntil when it
 *     exists, returns before the post starts, never throws (a send that
 *     throws or rejects, a waitUntil that throws);
 *   * reportFreeFailure: throttled per code, levels, the suppressed count.
 *
 * Pure: monitor.ts and ../monitoring.ts import nothing from Deno or npm:.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assistantDetail,
  assistantEvent,
  codeOf,
  createThrottle,
  dbCode,
  DETAIL_KEYS,
  levelFor,
  reportFreeFailure,
  reportInBackground,
  type AssistantKind,
} from '../supabase/functions/_shared/assistant/monitor.ts';
import { reportBody, reportEvent, type EdgeMonitorEvent } from '../supabase/functions/_shared/monitoring.ts';

const GUEST = 'Zainab Al-Khafaji';
const CONV = 'aaaaaaaa-0000-4000-8000-000000000001';
const MSG = 'bbbbbbbb-0000-4000-8000-000000000002';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Posts `event` through the real reportEvent against a fake fetch; answers the JSON body sent. */
async function postedBody(event: EdgeMonitorEvent): Promise<string> {
  vi.stubGlobal('Deno', { env: { get: (n: string) => ({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-key' })[n] } });
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await reportEvent(event)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/rest\/v1\/rpc\/report_event$/);
  return String(fetchMock.mock.calls[0]![1].body);
}

describe('privacy: identifiers and codes only', () => {
  it('a guest name in the question, the answer, tool args, a note or an error text never reaches the posted body', async () => {
    const event = assistantEvent({
      fn: 'assistant-chat',
      kind: 'assistant_failed',
      what: 'turn failed',
      code: 'UPSTREAM',
      detail: {
        stage: 'turn',
        conversationId: CONV,
        messageId: MSG,
        model: 'claude-opus-5-5',
        // Everything below must be dropped.
        question: `How much did ${GUEST} spend?`,
        answer: `${GUEST} spent 45,000 IQD`,
        args: { guest_name: GUEST },
        note: `wrong about ${GUEST}`,
        error: new Error(`duplicate key: guest ${GUEST}`),
        message: `Anthropic 529: overloaded for ${GUEST}`,
      },
    });
    const body = await postedBody(event);
    expect(body).not.toContain('Zainab');
    expect(body).not.toContain('Khafaji');
    expect(body).not.toContain('45,000');
    expect(body).not.toContain('overloaded');
    const parsed = JSON.parse(body) as { p_kind: string; p_level: string; p_message: string; p_detail: Record<string, unknown> };
    expect(parsed.p_kind).toBe('assistant_failed');
    expect(parsed.p_level).toBe('error');
    expect(parsed.p_message).toBe('assistant-chat: turn failed (UPSTREAM)');
    expect(parsed.p_detail).toEqual({ stage: 'turn', conversationId: CONV, messageId: MSG, model: 'claude-opus-5-5', code: 'UPSTREAM' });
  });

  it('allowlisted keys still refuse text: an id that is not a uuid, a code that is a sentence, a token with spaces', () => {
    expect(
      assistantDetail({ conversationId: GUEST, jobId: 'job 1', code: `UPSTREAM ${GUEST}`, step: GUEST, model: 'claude-opus-5-5', role: 'court_desk', ms: 1234.6, suppressed: 3, status: 'failed' }),
    ).toEqual({ model: 'claude-opus-5-5', role: 'court_desk', ms: 1235, suppressed: 3, status: 'failed' });
    expect(assistantDetail({ code: 'not a code' })).toEqual({});
    expect(assistantDetail({ ms: Number.NaN, suppressed: Infinity })).toEqual({});
    expect(assistantDetail(null)).toEqual({});
  });

  it('a message phrase that is not a fixed lower-case phrase falls back to the kind; a code-shaped code only', () => {
    const e = assistantEvent({ fn: 'assistant-job', kind: 'assistant_job_failed', what: `Failed for ${GUEST}`, code: `${GUEST}` });
    expect(e.message).toBe('assistant-job: assistant_job_failed');
    expect(e.detail).toEqual({});
    expect(codeOf('57014')).toBe('57014');
    expect(codeOf('PGRST202')).toBe('PGRST202');
    expect(codeOf('upstream')).toBeNull();
  });

  it('dbCode keeps a SQLSTATE or PGRST code, never the message', () => {
    expect(dbCode({ code: '23505', message: `duplicate key: ${GUEST}` })).toBe('23505');
    expect(dbCode({ code: 'PGRST116', message: 'x' })).toBe('PGRST116');
    expect(dbCode({ code: GUEST })).toBeNull();
    expect(dbCode('threw')).toBeNull();
    expect(dbCode(null)).toBeNull();
  });

  it('no allowlisted key is a word the server scrubber drops (0393 monitor_key_is_secret)', () => {
    const secret = /(^|_)(pin|pass|password|secret|token|tokens|jwt|session|otp|phone|email|card|pan)(_|$)/;
    for (const k of DETAIL_KEYS) {
      const words = k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      expect(words, k).not.toMatch(secret);
    }
    // And the body builder keeps every one of them.
    const all = Object.fromEntries(DETAIL_KEYS.map((k) => [k, k.endsWith('Id') ? CONV : k === 'code' ? 'UPSTREAM' : k === 'ms' || k === 'suppressed' ? 1 : 'x']));
    const body = reportBody(assistantEvent({ fn: 'assistant-chat', kind: 'assistant_failed', what: 'turn failed', detail: all }));
    expect(Object.keys(body.p_detail as object).sort()).toEqual([...DETAIL_KEYS].sort());
  });
});

describe('the level table', () => {
  const cases: [AssistantKind, string | null, string | null, string][] = [
    ['assistant_failed', 'UPSTREAM', null, 'error'],
    ['assistant_failed', 'NOT_CONFIGURED', null, 'error'],
    ['assistant_failed', 'INTERNAL', null, 'error'],
    ['assistant_failed', 'TIMEOUT', null, 'warn'],
    ['assistant_failed', 'RATE_LIMITED', null, 'warn'],
    ['assistant_refused', 'LLM_DAILY_QUOTA', null, 'info'],
    ['assistant_refused', 'LLM_MONTHLY_CAP', null, 'info'],
    ['assistant_refused', 'ASSISTANT_MODEL_NOT_PRICED', null, 'warn'],
    ['assistant_not_saved', null, 'message', 'error'],
    ['assistant_not_saved', null, 'usage', 'error'],
    ['assistant_not_saved', null, 'web_search', 'error'],
    ['assistant_not_saved', null, 'job', 'error'],
    ['assistant_not_saved', null, 'persist', 'error'],
    ['assistant_not_saved', '23505', 'calls', 'warn'],
    ['assistant_not_saved', null, 'conversation', 'warn'],
    ['assistant_job_failed', 'TIMEOUT', null, 'warn'],
    ['assistant_job_failed', 'LLM_MONTHLY_CAP', null, 'info'],
    ['assistant_job_failed', 'LLM_DAILY_QUOTA', null, 'info'],
    ['assistant_job_failed', 'UPSTREAM', null, 'error'],
    // 0423: the sweeper's own outcomes; a batch that may run unrecorded is an error
    ['assistant_job_failed', 'JOB_STALLED', 'stalled_live', 'error'],
    ['assistant_job_swept', null, 'stalled_live', 'warn'],
    ['assistant_job_swept', null, 'stalled_reduce', 'warn'],
    ['assistant_job_swept', 'JOB_STALLED', 'batch_unrecorded', 'error'],
    ['assistant_free_failed', 'UPSTREAM', null, 'error'],
    ['assistant_free_failed', 'NOT_CONFIGURED', null, 'error'],
    ['assistant_free_failed', 'TIMEOUT', null, 'warn'],
    ['assistant_free_failed', 'RATE_LIMITED', null, 'warn'],
  ];
  for (const [kind, code, step, level] of cases) {
    it(`${kind} ${code ?? '-'} ${step ?? ''} is ${level}`, () => {
      expect(levelFor(kind, code, step)).toBe(level);
      expect(assistantEvent({ fn: 'assistant-chat', kind, what: 'x', code, detail: { step: step ?? undefined } }).level).toBe(level);
    });
  }
});

describe('the throttle', () => {
  it('one event per key per window; the next after the window carries how many were dropped', () => {
    let t = 1_000_000;
    const throttle = createThrottle(() => t);
    expect(throttle('free:UPSTREAM')).toEqual({ send: true, suppressed: 0 });
    t += 10_000;
    expect(throttle('free:UPSTREAM')).toEqual({ send: false });
    expect(throttle('free:UPSTREAM')).toEqual({ send: false });
    expect(throttle('free:TIMEOUT')).toEqual({ send: true, suppressed: 0 }); // keys are apart
    t += 50_000; // 60 s after the first
    expect(throttle('free:UPSTREAM')).toEqual({ send: true, suppressed: 2 });
    t += 1;
    expect(throttle('free:UPSTREAM')).toEqual({ send: false });
    t += 60_000;
    expect(throttle('free:UPSTREAM')).toEqual({ send: true, suppressed: 1 });
  });

  it('remembers at most 200 keys', () => {
    let t = 0;
    const throttle = createThrottle(() => t);
    for (let i = 0; i < 250; i++) throttle(`k${i}`);
    t += 1;
    // k0 was forgotten (oldest), so it sends again; k249 is remembered.
    expect(throttle('k0')).toEqual({ send: true, suppressed: 0 });
    expect(throttle('k249')).toEqual({ send: false });
  });
});

describe('reportInBackground', () => {
  const event = assistantEvent({ fn: 'assistant-chat', kind: 'assistant_failed', what: 'turn failed', code: 'UPSTREAM' });

  it('returns before the post starts and hands the promise to EdgeRuntime.waitUntil when it exists', async () => {
    const waited: Promise<unknown>[] = [];
    vi.stubGlobal('EdgeRuntime', { waitUntil: (p: Promise<unknown>) => waited.push(p) });
    const send = vi.fn(async () => true);
    const out = reportInBackground(event, send);
    expect(out).toBeUndefined();
    expect(send).not.toHaveBeenCalled(); // not on the caller's stack
    expect(waited).toHaveLength(1);
    await waited[0];
    expect(send).toHaveBeenCalledWith(event);
  });

  it('without EdgeRuntime the post still runs', async () => {
    const send = vi.fn(async () => true);
    reportInBackground(event, send);
    await new Promise((r) => setTimeout(r, 0));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never throws: a send that throws or rejects, a waitUntil that throws', async () => {
    vi.stubGlobal('EdgeRuntime', {
      waitUntil: () => {
        throw new Error('refused');
      },
    });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      expect(() =>
        reportInBackground(event, () => {
          throw new Error('sync');
        }),
      ).not.toThrow();
      expect(() => reportInBackground(event, async () => Promise.reject(new Error('async')))).not.toThrow();
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('the default sender (reportEvent) sends nothing and resolves false without the service env', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await reportEvent(event)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reportFreeFailure', () => {
  it('one event per code per minute, levels by code, the dropped ones on the next', () => {
    let t = 0;
    const throttle = createThrottle(() => t);
    const sent: EdgeMonitorEvent[] = [];
    const report = (e: EdgeMonitorEvent) => sent.push(e);
    expect(reportFreeFailure({ code: 'UPSTREAM', stage: 'before_stream', role: 'waiter', app: 'mobile', model: 'openai/gpt-oss-20b', ms: 812 }, { report, throttle })).toBe(true);
    expect(reportFreeFailure({ code: 'UPSTREAM', stage: 'stream', role: 'cashier', app: 'operator' }, { report, throttle })).toBe(false);
    expect(reportFreeFailure({ code: 'RATE_LIMITED', stage: 'before_stream' }, { report, throttle })).toBe(true);
    t += 60_000;
    expect(reportFreeFailure({ code: 'UPSTREAM', stage: 'stream', role: 'cashier', app: 'operator' }, { report, throttle })).toBe(true);
    expect(sent.map((e) => [e.kind, e.level, e.message])).toEqual([
      ['assistant_free_failed', 'error', 'assistant-free: request failed (UPSTREAM)'],
      ['assistant_free_failed', 'warn', 'assistant-free: request failed (RATE_LIMITED)'],
      ['assistant_free_failed', 'error', 'assistant-free: stream failed (UPSTREAM)'],
    ]);
    expect(sent[0]!.detail).toEqual({ code: 'UPSTREAM', stage: 'before_stream', role: 'waiter', app: 'mobile', model: 'openai/gpt-oss-20b', ms: 812 });
    expect(sent[2]!.detail).toMatchObject({ suppressed: 1, stage: 'stream' });
  });

  it('TIMEOUT is warn, NOT_CONFIGURED error; a code that is not a code is UPSTREAM; never throws', () => {
    const sent: EdgeMonitorEvent[] = [];
    const report = (e: EdgeMonitorEvent) => sent.push(e);
    const throttle = createThrottle(() => 0);
    reportFreeFailure({ code: 'TIMEOUT', stage: 'stream' }, { report, throttle });
    reportFreeFailure({ code: 'NOT_CONFIGURED', stage: 'before_stream' }, { report, throttle });
    reportFreeFailure({ code: `${GUEST}`, stage: 'before_stream' }, { report, throttle });
    expect(sent.map((e) => e.level)).toEqual(['warn', 'error', 'error']);
    expect(sent[2]!.message).toBe('assistant-free: request failed (UPSTREAM)');
    expect(
      reportFreeFailure({ code: 'UPSTREAM', stage: 'stream' }, {
        report: () => {
          throw new Error('x');
        },
        throttle: createThrottle(() => 0),
      }),
    ).toBe(false);
  });
});
