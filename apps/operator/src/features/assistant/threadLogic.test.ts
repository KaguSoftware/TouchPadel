import { describe, expect, it, vi } from 'vitest';
import { RequestTimeoutError } from '@touch/core';
import { emptyTurn, type MessageRow } from '@touch/core/assistant/client';
import { catalogs } from '@touch/i18n';
import { EdgeError, StreamStalledError } from '../../lib/edge';
import type { JobRow } from './api';
import {
  acceptMayHaveStarted,
  askedByAnswer,
  canAskAgain,
  errorSentenceKey,
  estimateOf,
  isExpiredPause,
  jobCards,
  jobErrorCode,
  jobErrorKey,
  liveOutcome,
  loadSeenJobs,
  pauseOf,
  pendingToolScopes,
  placeEstimates,
  reconcileLive,
  resumeMayHaveStarted,
  resumePrices,
  resumesInBackground,
  saveSeenJobs,
  scopesToRestore,
  storedOutcome,
  storedText,
  type ChatTurn,
} from './threadLogic';

const row = (id: string, seq: number, role: 'user' | 'assistant', text: string, tokens: MessageRow['tokens'] = null): MessageRow => ({
  id,
  conversation_id: 'c1',
  seq,
  role,
  content: role === 'user' ? text : [{ type: 'text', text }],
  sources: null,
  gate: null,
  tokens,
  created_at: `2026-11-11T10:00:0${seq}Z`,
});

const before = [row('u0', 1, 'user', 'Earlier?'), row('a0', 2, 'assistant', 'Earlier answer.')];

function turn(over: Partial<ChatTurn> = {}): ChatTurn {
  return { ...emptyTurn('c1', 'How much today?'), userMessageId: 'u1', assistantMessageId: 'a1', text: 'Partial', knownIds: ['u0', 'a0'], ...over };
}

const stored = [...before, row('u1', 3, 'user', 'How much today?'), row('a1', 4, 'assistant', 'Partial')];
const userOnly = [...before, row('u1', 3, 'user', 'How much today?')];

describe('reconcileLive: the live turn gives way to its stored rows, whatever the outcome', () => {
  const endings: [string, Partial<ChatTurn>][] = [
    ['done', { done: true, stopReason: 'end_turn' }],
    ['stopped', { done: true, stopped: true }],
    ['error', { done: true, error: { code: 'TIMEOUT', message: 'x' }, stopReason: 'TIMEOUT' }],
    ['dropped', { done: true, dropped: true, error: { code: 'UNKNOWN', message: '' } }],
  ];

  for (const [name, over] of endings) {
    it(`${name}, stored answer in the list: only the stored rows are drawn`, () => {
      const r = reconcileLive(turn(over), stored);
      expect(r.showLive).toBe(false);
      expect(r.hiddenRowIds.size).toBe(0);
    });

    it(`${name}, stored answer not yet in the list: the live turn stays and the stored question is hidden`, () => {
      const r = reconcileLive(turn(over), userOnly);
      expect(r.showLive).toBe(true);
      expect([...r.hiddenRowIds]).toEqual(['u1']);
    });

    it(`${name}, nothing stored yet: the live turn stays and nothing is hidden`, () => {
      const r = reconcileLive(turn(over), before);
      expect(r.showLive).toBe(true);
      expect(r.hiddenRowIds.size).toBe(0);
    });
  }

  it('still streaming: the live turn stays even when a refetch already has its rows, and hides them', () => {
    const r = reconcileLive(turn({ done: false }), stored);
    expect(r.showLive).toBe(true);
    expect([...r.hiddenRowIds].sort()).toEqual(['a1', 'u1']);
  });

  it('stopped before message_start (no ids): finds its rows by the new question with the same words', () => {
    const early = turn({ done: true, stopped: true, userMessageId: null, assistantMessageId: null, text: '' });
    expect(reconcileLive(early, stored).showLive).toBe(false);
    const half = reconcileLive(early, userOnly);
    expect(half.showLive).toBe(true);
    expect([...half.hiddenRowIds]).toEqual(['u1']);
  });

  it('never takes an older question with the same words for the live one', () => {
    const repeat = [row('u0', 1, 'user', 'How much today?'), row('a0', 2, 'assistant', 'Old.')];
    const early = turn({ done: true, stopped: true, userMessageId: null, assistantMessageId: null });
    const r = reconcileLive(early, repeat);
    expect(r.showLive).toBe(true);
    expect(r.hiddenRowIds.size).toBe(0);
  });

  it('a refusal before the stream (nothing stored, no ids) stays with its sentence', () => {
    const refused = turn({ done: true, error: { code: 'LLM_MONTHLY_CAP', message: '' }, userMessageId: null, assistantMessageId: null });
    expect(reconcileLive(refused, before)).toEqual({ showLive: true, hiddenRowIds: new Set() });
  });

  it('no live turn: nothing to draw', () => {
    expect(reconcileLive(null, stored).showLive).toBe(false);
  });
});

describe('outcomes, live and stored, in one shape', () => {
  it('reads the live turn from its error, its Stop, a dropped stream and the done event', () => {
    expect(liveOutcome(turn({ done: false }))).toEqual({ kind: 'ok' });
    expect(liveOutcome(turn({ done: true, stopReason: 'end_turn' }))).toEqual({ kind: 'ok' });
    expect(liveOutcome(turn({ done: true, stopReason: 'max_tokens' }))).toEqual({ kind: 'cut_short' });
    expect(liveOutcome(turn({ done: true, stopReason: 'refusal' }))).toEqual({ kind: 'refused' });
    expect(liveOutcome(turn({ done: true, stopReason: 'stopped' }))).toEqual({ kind: 'stopped' });
    expect(liveOutcome(turn({ done: true, stopped: true }))).toEqual({ kind: 'stopped' });
    expect(liveOutcome(turn({ done: true, stopReason: 'job_proposed' }))).toEqual({ kind: 'job_proposed' });
    expect(liveOutcome(turn({ done: true, error: { code: 'TIMEOUT', message: '' } }))).toEqual({ kind: 'error', code: 'TIMEOUT' });
    expect(liveOutcome(turn({ done: true, dropped: true, error: { code: 'UNKNOWN', message: '' } }))).toEqual({ kind: 'error', code: 'CONNECTION' });
  });

  it('reads a stored row the same way, and hides the legacy placeholder text', () => {
    expect(storedOutcome(row('a', 1, 'assistant', 'Done.', { stop_reason: 'end_turn' } as never))).toEqual({ kind: 'ok' });
    expect(storedOutcome(row('a', 1, 'assistant', 'Half', { stop_reason: 'stopped' } as never))).toEqual({ kind: 'stopped' });
    expect(storedOutcome(row('a', 1, 'assistant', 'Half', { stop_reason: 'max_tokens' } as never))).toEqual({ kind: 'cut_short' });
    expect(storedOutcome(row('a', 1, 'assistant', '', { stop_reason: 'refusal' } as never))).toEqual({ kind: 'refused' });
    expect(storedOutcome(row('a', 1, 'assistant', '', { stop_reason: 'UPSTREAM', error_code: 'UPSTREAM' } as never))).toEqual({ kind: 'error', code: 'UPSTREAM' });
    const legacy = row('a', 1, 'assistant', '[TIMEOUT] the turn did not finish inside 50 s');
    expect(storedOutcome(legacy)).toEqual({ kind: 'error', code: 'TIMEOUT' });
    expect(storedText(legacy)).toBe('');
    expect(storedText(row('a', 1, 'assistant', 'Sales were 10.'))).toBe('Sales were 10.');
  });

  it('words CONNECTION itself and offers Ask again only where asking again can help', () => {
    expect(errorSentenceKey('CONNECTION')).toBe('CONNECTION');
    expect(errorSentenceKey('INTERNAL')).toBe('UNKNOWN');
    expect(errorSentenceKey('TIMEOUT')).toBe('TIMEOUT');
    for (const code of ['TIMEOUT', 'UPSTREAM', 'RATE_LIMITED', 'NOT_CONFIGURED', 'CONNECTION', 'UNKNOWN', 'NOT_SAVED'] as const) expect(canAskAgain(code)).toBe(true);
    for (const code of ['LLM_MONTHLY_CAP', 'LLM_DAILY_QUOTA', 'AUTH_REQUIRED', 'FORBIDDEN', 'ASSISTANT_MODEL_NOT_PRICED', 'INVALID_REQUEST'] as const) expect(canAskAgain(code)).toBe(false);
  });

  it('NOT_SAVED has its own sentence', () => {
    expect(errorSentenceKey('NOT_SAVED')).toBe('NOT_SAVED');
  });

  it('reads the failed message a job writes into its chat: empty text, the job’s code', () => {
    const failed = { ...row('a9', 9, 'assistant', ''), tokens: { error_code: 'LLM_MONTHLY_CAP', stop_reason: 'LLM_MONTHLY_CAP' }, sources: [{ job_id: 'j1' }] } as MessageRow;
    expect(storedOutcome(failed)).toEqual({ kind: 'error', code: 'LLM_MONTHLY_CAP' });
    expect(storedText(failed)).toBe('');
    const odd = { ...row('a8', 8, 'assistant', ''), tokens: { error_code: 'SOMETHING_NEW' } } as MessageRow;
    expect(storedOutcome(odd)).toEqual({ kind: 'error', code: 'UNKNOWN' });
  });
});

describe('the question each stored answer replies to', () => {
  it('is the last user row before it, found in one pass', () => {
    const rows = [row('u1', 1, 'user', 'First?'), row('a1', 2, 'assistant', 'One.'), row('a1b', 3, 'assistant', 'A job’s answer.'), row('u2', 4, 'user', 'Second?'), row('a2', 5, 'assistant', 'Two.')];
    const asked = askedByAnswer([...rows].reverse());
    expect(asked.get('a1')).toBe('First?');
    expect(asked.get('a1b')).toBe('First?');
    expect(asked.get('a2')).toBe('Second?');
    expect(askedByAnswer([row('a0', 1, 'assistant', 'Orphan.')]).has('a0')).toBe(false);
  });
});

describe('the progress line names areas, never tools', () => {
  it('one line per area, in order, with the generic line for a tool without one', () => {
    expect(pendingToolScopes(['report_cafe', 'report_cafe', 'panel_headline', 'web_search', 'made_up'])).toEqual(['cafe', 'money', null]);
  });
});

describe('a failed job in the reader’s words', () => {
  it('reads the code from the stored "CODE: sentence", never the English after it', () => {
    expect(jobErrorCode('LLM_MONTHLY_CAP: the monthly assistant budget is used up')).toBe('LLM_MONTHLY_CAP');
    expect(jobErrorCode('TIMEOUT: 3 of 9 chunks done inside the wall clock; re-run as batch')).toBe('TIMEOUT');
    expect(jobErrorCode('RATE_LIMITED')).toBe('RATE_LIMITED');
    expect(jobErrorCode('boom: something')).toBe('UNKNOWN');
    expect(jobErrorCode(null)).toBe('UNKNOWN');
  });

  it('the cap and the daily limit read as in the chat; a time-out and the rest have job words', () => {
    expect(jobErrorKey('LLM_MONTHLY_CAP')).toBe('ws.owner.assistant.message.errors.LLM_MONTHLY_CAP');
    expect(jobErrorKey('LLM_DAILY_QUOTA')).toBe('ws.owner.assistant.message.errors.LLM_DAILY_QUOTA');
    expect(jobErrorKey('UPSTREAM')).toBe('ws.owner.assistant.message.errors.UPSTREAM');
    expect(jobErrorKey('TIMEOUT')).toBe('ws.owner.assistant.job.errors.TIMEOUT');
    expect(jobErrorKey('INTERNAL')).toBe('ws.owner.assistant.job.errors.UNKNOWN');
    for (const locale of ['en', 'ar'] as const) {
      for (const code of ['LLM_MONTHLY_CAP', 'LLM_DAILY_QUOTA', 'RATE_LIMITED', 'NOT_CONFIGURED', 'UPSTREAM', 'TIMEOUT', 'UNKNOWN'] as const) {
        const key = jobErrorKey(code);
        const text = key.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), catalogs[locale]);
        expect(typeof text, `${locale} ${key}`).toBe('string');
      }
    }
  });
});

describe('stored job estimates', () => {
  const job = (id: string, status: JobRow['status'], messageId: string | null, at = '2026-11-11T10:00:00Z'): JobRow =>
    ({
      id,
      conversation_id: 'c1',
      message_id: messageId,
      status,
      plan: {},
      estimate: { rows: 10, chunks: 2, per_tool: [], tokens: { input: 1, cache_read: 0, output: 1, total: 2 }, tokens_high: { input: 1, cache_read: 0, output: 1, total: 2 }, modes: { aggregate: null, live: { allowed: true }, batch: { allowed: true } }, assumptions: [], first_chunk_exact: null },
      mode: null,
      chunks_total: 2,
      chunks_done: 0,
      tokens: {},
      result: null,
      error: null,
      batch_id: null,
      created_at: at,
      started_at: null,
      finished_at: null,
    }) as JobRow;

  it('rebuilds the card under the answer that proposed it while the job waits for a press', () => {
    const jobs = [job('j1', 'estimated', 'a0'), job('j2', 'running', 'a0'), job('j3', 'estimated', 'gone'), job('j4', 'estimated', 'a0', '2026-11-11T09:00:00Z')];
    const placed = placeEstimates(jobs, new Set(['u0', 'a0']), new Set(), null);
    expect(placed.byMessage.get('a0')!.map((j) => j.id)).toEqual(['j4', 'j1']);
    expect(placed.trailing.map((j) => j.id)).toEqual(['j3']);
    expect(estimateOf(jobs[0]!).job_id).toBe('j1');
  });

  it('leaves out what "Not now" put aside and what the live turn already draws', () => {
    const jobs = [job('j1', 'estimated', 'a0'), job('j2', 'estimated', 'a0')];
    const placed = placeEstimates(jobs, new Set(['a0']), new Set(['j1']), 'j2');
    expect(placed.byMessage.size).toBe(0);
    expect(placed.trailing).toEqual([]);
  });

  describe('job cards after the owner was away (2026-11-12)', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    const ended = (id: string, status: JobRow['status'], finished = '2026-11-12T11:00:00Z', error: string | null = null) => ({ ...job(id, status, 'a0'), finished_at: finished, error });
    const none = { watched: [] as string[], seen: new Set<string>(), jobIdsInMessages: new Set<string>(), now };

    it('a job still working, or paused over its estimate, always shows; an estimate never does', () => {
      const cards = jobCards([job('j1', 'running', 'a0'), job('j2', 'over_estimate', 'a0'), job('j3', 'estimated', 'a0')], none);
      expect(cards.map((c) => [c.job.id, c.endedAway])).toEqual([
        ['j1', false],
        ['j2', false],
      ]);
    });

    it('a job that ended while the drawer was closed shows once, marked as news; then it is seen', () => {
      const jobs = [ended('j1', 'done'), ended('j2', 'failed', undefined, 'TIMEOUT: x')];
      expect(jobCards(jobs, none).map((c) => [c.job.id, c.endedAway])).toEqual([
        ['j1', true],
        ['j2', true],
      ]);
      const seen = jobCards(jobs, { ...none, seen: new Set(['j1', 'j2']) });
      // The done job's answer is in the chat; the failure has no message to speak for it, so its card stays.
      expect(seen.map((c) => [c.job.id, c.endedAway])).toEqual([['j2', false]]);
    });

    it('a failure the server wrote a message for is told by that message, not twice', () => {
      expect(jobCards([ended('j2', 'failed')], { ...none, seen: new Set(['j2']), jobIdsInMessages: new Set(['j2']) })).toEqual([]);
    });

    it('a cancelled job shows only while watched; an old end is not news', () => {
      expect(jobCards([ended('j1', 'cancelled')], none)).toEqual([]);
      expect(jobCards([ended('j1', 'cancelled')], { ...none, watched: ['j1'] }).map((c) => c.job.id)).toEqual(['j1']);
      expect(jobCards([ended('j1', 'done', '2026-11-01T10:00:00Z')], none)).toEqual([]);
    });

    it('the seen list lives on this computer', () => {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
      expect(loadSeenJobs().size).toBe(0);
      saveSeenJobs(new Set(['j1']));
      expect([...loadSeenJobs()]).toEqual(['j1']);
      vi.unstubAllGlobals();
    });
  });
});

describe('a failed accept that may have started the job: watch, do not fail', () => {
  it('a timeout, a broken connection, a gateway give-up or "job is running" may have started it', () => {
    expect(acceptMayHaveStarted(new RequestTimeoutError(65_000, 'assistant-job'))).toBe(true);
    expect(acceptMayHaveStarted(new TypeError('Failed to fetch'))).toBe(true);
    expect(acceptMayHaveStarted(new StreamStalledError(45_000))).toBe(true);
    expect(acceptMayHaveStarted(new EdgeError(409, 'UNKNOWN', 'job is running', 'INVALID_TRANSITION'))).toBe(true);
    expect(acceptMayHaveStarted(new EdgeError(504, 'UPSTREAM', 'gateway'))).toBe(true);
  });

  it('a refusal did not start it: the screen says so', () => {
    expect(acceptMayHaveStarted(new EdgeError(429, 'RATE_LIMITED', 'cap', 'LLM_MONTHLY_CAP'))).toBe(false);
    expect(acceptMayHaveStarted(new EdgeError(403, 'FORBIDDEN', 'owner only', 'FORBIDDEN'))).toBe(false);
    expect(acceptMayHaveStarted(new EdgeError(503, 'NOT_CONFIGURED', 'no key', 'NOT_CONFIGURED'))).toBe(false);
  });
});

describe('a new chat whose first question failed while the drawer was closed', () => {
  it('takes back the scopes its question was asked with, and only then', () => {
    expect(scopesToRestore(null, [], ['cafe', 'money'])).toEqual(['cafe', 'money']);
    expect(scopesToRestore(null, ['courts'], ['cafe'])).toBeNull();
    expect(scopesToRestore('c1', [], ['cafe'])).toBeNull();
    expect(scopesToRestore(null, [], null)).toBeNull();
    expect(scopesToRestore(null, [], [])).toBeNull();
  });
});

describe('a paused job and its Continue (0410)', () => {
  const tk = (input: number, output: number) => ({ input, cache_read: 0, output, total: input + output });
  const est = {
    job_id: 'j1', rows: 900, chunks: 4, per_tool: [], tokens: tk(4_000_000, 400_000), tokens_high: tk(4_600_000, 460_000),
    by_step: { extract: { model: 'claude-sonnet-5-5', tokens: tk(4_000_000, 0), tokens_high: tk(4_600_000, 0) }, reduce: { model: null, tokens: tk(0, 400_000), tokens_high: tk(0, 460_000) } },
    modes: { aggregate: null, live: { allowed: true }, batch: { allowed: true } }, assumptions: [], first_chunk_exact: null,
  } as unknown as JobRow['estimate'];
  const paused = (result: unknown, patch: Partial<JobRow> = {}): JobRow =>
    ({ id: 'j1', conversation_id: 'c1', message_id: 'a1', status: 'over_estimate', plan: {}, estimate: est, mode: 'live', chunks_total: 4, chunks_done: 1, tokens: { model: 'claude-opus-5-5' }, result, error: null, batch_id: null, created_at: '', started_at: '', finished_at: null, ...patch }) as JobRow;

  it('reads the reason, the parts read and left and the stored rest; anything else is not paused', () => {
    const rest = { chunks: 1, extract: tk(10, 0), extract_high: tk(12, 0), reduce: tk(0, 5), reduce_high: tk(0, 6) };
    expect(pauseOf(paused({ objects: [{ chunk: 1 }, { chunk: 2 }, { chunk: 3 }], pause: { reason: 'time', at: 'x', chunks_left: [4], rest } }))).toEqual({ reason: 'time', done: 3, total: 4, remaining: 1, rest });
    // paused before 0410: no pause object; the reason it could have had, the parts from the counts
    expect(pauseOf(paused({ objects: [{ chunk: 1 }] }))).toEqual({ reason: 'over_estimate', done: 1, total: 4, remaining: 3, rest: null });
    expect(pauseOf(paused({ objects: [], pause: { reason: 'nonsense', chunks_left: 'x', rest: { extract: 'no' } } }))).toMatchObject({ reason: 'over_estimate', rest: null });
    expect(pauseOf(paused(null, { status: 'running' }))).toBeNull();
  });

  it('prices the rest: the parts at the extraction model (half in the background), the answer at the job model', () => {
    const rest = { chunks: 1, extract: tk(1_000_000, 0), extract_high: tk(1_150_000, 0), reduce: tk(0, 1_000_000), reduce_high: tk(0, 1_150_000) };
    const job = paused({ objects: [{ chunk: 1 }], pause: { reason: 'time', at: 'x', chunks_left: [2], rest } });
    const p = pauseOf(job)!;
    expect(resumesInBackground(job, p)).toBe(true);
    expect(resumePrices(job, p, true, 'claude-opus-5-5', null, 1_000_000)).toEqual({ rest: 1_500_000, high: 1_725_000 });
    expect(resumePrices(job, p, false, 'claude-opus-5-5', null, 1_000_000)).toEqual({ rest: 2_000_000, high: 2_300_000 });
    // a legacy pause: the estimate's share of the parts left (3 of 4) plus the whole answer
    const legacy = paused({ objects: [{ chunk: 1 }] });
    expect(resumePrices(legacy, pauseOf(legacy)!, false, 'claude-opus-5-5', null, 1_000_000).rest).toBe(3_000_000 + 400_000);
    // only the answer left, or a vendor without batch: Continue runs now
    const allRead = paused({ objects: [1, 2, 3, 4].map((chunk) => ({ chunk })), pause: { reason: 'stopped', at: 'x', chunks_left: [], rest } });
    expect(resumesInBackground(allRead, pauseOf(allRead)!)).toBe(false);
    const noBatch = paused({ objects: [] }, { estimate: { ...est, modes: { ...est.modes, batch: { allowed: false } } } as unknown as JobRow['estimate'] });
    expect(resumesInBackground(noBatch, pauseOf(noBatch)!)).toBe(false);
  });

  it('a lost race or a broken request is watched; JOB_DATA_CHANGED is read', () => {
    expect(resumeMayHaveStarted(new EdgeError(409, 'UNKNOWN', 'x', 'INVALID_TRANSITION'))).toBe(true);
    expect(resumeMayHaveStarted(new EdgeError(409, 'UNKNOWN', 'x', 'JOB_DATA_CHANGED'))).toBe(false);
    expect(resumeMayHaveStarted(new EdgeError(503, 'NOT_CONFIGURED', 'x', 'UPSTREAM'))).toBe(false);
  });

  it('a paused job the server expired shows once as news; an expired estimate never does', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    const expiredPause = paused(null, { status: 'cancelled', error: 'EXPIRED: it waited paused for 7 days', finished_at: '2026-11-12T11:00:00Z' });
    const expiredEstimate = paused(null, { id: 'j2', status: 'cancelled', mode: null, error: 'EXPIRED: nobody chose how to run it within 7 days', finished_at: '2026-11-12T11:00:00Z' });
    expect(isExpiredPause(expiredPause)).toBe(true);
    expect(isExpiredPause(expiredEstimate)).toBe(false);
    const cards = jobCards([expiredPause, expiredEstimate], { watched: [], seen: new Set(), jobIdsInMessages: new Set(), now });
    expect(cards).toEqual([{ job: expiredPause, endedAway: true }]);
    expect(jobCards([expiredPause], { watched: [], seen: new Set(['j1']), jobIdsInMessages: new Set(), now })).toEqual([]);
  });
});
