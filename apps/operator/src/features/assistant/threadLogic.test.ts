import { describe, expect, it } from 'vitest';
import { RequestTimeoutError } from '@touch/core';
import { emptyTurn, type MessageRow } from '@touch/core/assistant/client';
import { EdgeError, StreamStalledError } from '../../lib/edge';
import type { JobRow } from './api';
import { acceptMayHaveStarted, canAskAgain, errorSentenceKey, estimateOf, liveOutcome, placeEstimates, reconcileLive, storedOutcome, storedText, type ChatTurn } from './threadLogic';

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
    for (const code of ['TIMEOUT', 'UPSTREAM', 'RATE_LIMITED', 'NOT_CONFIGURED', 'CONNECTION', 'UNKNOWN'] as const) expect(canAskAgain(code)).toBe(true);
    for (const code of ['LLM_MONTHLY_CAP', 'LLM_DAILY_QUOTA', 'AUTH_REQUIRED', 'FORBIDDEN', 'ASSISTANT_MODEL_NOT_PRICED', 'INVALID_REQUEST'] as const) expect(canAskAgain(code)).toBe(false);
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
