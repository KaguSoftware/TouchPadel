import { describe, expect, it } from 'vitest';
import { emptyTurn, type LiveTurn } from '@touch/core/assistant/client';
import type { MessageRow } from '../chat';
import { NO_END, endingErrorKey, liveEnding, mergeThread, retryTextFor, storedEnding } from '../thread';

const row = (id: string, role: 'user' | 'assistant', text: string, extra: Partial<MessageRow> = {}): MessageRow => ({
  id,
  conversation_id: 'c',
  seq: 1,
  role,
  content: role === 'user' ? text : [{ type: 'text', text }],
  sources: null,
  gate: null,
  created_at: '2026-11-01T00:00:00Z',
  ...extra,
});

const live = (over: Partial<LiveTurn> = {}): LiveTurn => ({ ...emptyTurn('c', 'How much?'), ...over });

describe('mergeThread', () => {
  const earlier = [row('u0', 'user', 'Hi'), row('a0', 'assistant', 'Hello')];

  it('draws the stored rows alone when there is no live turn', () => {
    expect(mergeThread(earlier, null)).toEqual({ rows: earlier, showLive: false });
  });

  it('draws the live turn after the stored rows while nothing of it is stored', () => {
    expect(mergeThread(earlier, live())).toEqual({ rows: earlier, showLive: true });
  });

  it.each([
    ['finished', { done: true }],
    ['failed', { done: true, error: { code: 'UPSTREAM' as const, message: '' } }],
    ['stopped', { done: true, stopped: true }],
  ])('retires a %s live turn once its assistant row is stored', (_n, over) => {
    const stored = [...earlier, row('u1', 'user', 'How much?'), row('a1', 'assistant', 'x')];
    const m = mergeThread(stored, live({ ...over, assistantMessageId: 'a1', userMessageId: 'u1' }));
    expect(m).toEqual({ rows: stored, showLive: false });
  });

  it('keeps a live turn whose assistant id is not stored yet, and hides its stored question by id', () => {
    const stored = [...earlier, row('u1', 'user', 'How much?')];
    const m = mergeThread(stored, live({ assistantMessageId: 'a1', userMessageId: 'u1' }));
    expect(m.showLive).toBe(true);
    expect(m.rows).toEqual(earlier);
  });

  it('hides a trailing stored question that matches the live text when no id arrived', () => {
    const stored = [...earlier, row('u1', 'user', 'How much?')];
    expect(mergeThread(stored, live({ done: true, error: { code: 'UNKNOWN', message: '' } })).rows).toEqual(earlier);
  });

  it('keeps a trailing user row with different text, and a matching one that is not last', () => {
    const other = [...earlier, row('u1', 'user', 'Something else')];
    expect(mergeThread(other, live()).rows).toEqual(other);
    const notLast = [row('u1', 'user', 'How much?'), row('a1', 'assistant', 'x')];
    expect(mergeThread(notLast, live()).rows).toEqual(notLast);
  });
});

describe('storedEnding', () => {
  const asst = (tokens: unknown, text = 'Answer', sources: MessageRow['sources'] = null) =>
    storedEnding(row('a', 'assistant', text, { tokens, sources }));

  it('reads stop reasons from the tokens', () => {
    expect(asst({ stop_reason: 'end_turn' })).toEqual({ kind: 'ok' });
    expect(asst({ stop_reason: 'stopped' })).toEqual({ kind: 'stopped' });
    expect(asst({ stop_reason: 'max_tokens' })).toEqual({ kind: 'cut_short' });
    expect(asst({ stop_reason: 'refusal' })).toEqual({ kind: 'refused' });
    expect(asst(undefined)).toEqual({ kind: 'ok' });
  });

  it('reads a failed turn from its error code, and the legacy placeholder text', () => {
    expect(asst({ stop_reason: 'error', error_code: 'RATE_LIMITED' }, '')).toEqual({ kind: 'error', code: 'RATE_LIMITED' });
    expect(asst(null, '[TIMEOUT] the turn did not finish inside 50 s')).toEqual({ kind: 'error', code: 'TIMEOUT' });
  });

  it('shows the job note for a proposal but not for a job result', () => {
    expect(asst({ stop_reason: 'job_proposed' })).toEqual({ kind: 'job_proposed' });
    expect(asst({ stop_reason: 'job_proposed' }, 'Result', [{ job_id: 'j1' }])).toEqual({ kind: 'ok' });
    expect(asst(null, 'Result', [{ job_id: 'j1' }])).toEqual({ kind: 'ok' });
  });
});

describe('liveEnding', () => {
  const l = (over: Partial<LiveTurn>) => live({ done: true, ...over });
  it('is ok while streaming', () => {
    expect(liveEnding(live(), NO_END)).toEqual({ kind: 'ok' });
  });
  it('maps the done event’s stop_reason', () => {
    expect(liveEnding(l({}), { stopReason: 'max_tokens', lost: false })).toEqual({ kind: 'cut_short' });
    expect(liveEnding(l({}), { stopReason: 'refusal', lost: false })).toEqual({ kind: 'refused' });
    expect(liveEnding(l({}), { stopReason: 'job_proposed', lost: false })).toEqual({ kind: 'job_proposed' });
    expect(liveEnding(l({}), { stopReason: 'stopped', lost: false })).toEqual({ kind: 'stopped' });
    expect(liveEnding(l({}), { stopReason: 'end_turn', lost: false })).toEqual({ kind: 'ok' });
  });
  it('says stopped for an owner stop, an error by its code, a lost stream as connection', () => {
    expect(liveEnding(l({ stopped: true }), NO_END)).toEqual({ kind: 'stopped' });
    expect(liveEnding(l({ error: { code: 'TIMEOUT', message: 'English' } }), NO_END)).toEqual({ kind: 'error', code: 'TIMEOUT' });
    expect(liveEnding(l({}), { stopReason: null, lost: true })).toEqual({ kind: 'connection' });
    expect(liveEnding(l({ error: { code: 'UNKNOWN', message: '' } }), { stopReason: null, lost: true })).toEqual({
      kind: 'connection',
    });
  });
});

describe('retryTextFor', () => {
  const failed = [row('u', 'user', 'Why?'), row('a', 'assistant', '', { tokens: { error_code: 'UPSTREAM' } })];
  it('offers the question on the last row when it failed', () => {
    expect(retryTextFor(failed, 1)).toBe('Why?');
  });
  it('offers nothing on a finished row, an earlier row or a user row', () => {
    expect(retryTextFor([failed[0]!, row('a', 'assistant', 'ok')], 1)).toBeNull();
    expect(retryTextFor([...failed, row('u2', 'user', 'More'), row('a2', 'assistant', 'ok')], 1)).toBeNull();
    expect(retryTextFor(failed, 0)).toBeNull();
  });
});

describe('endingErrorKey', () => {
  it('words the three unworded codes as UNKNOWN and keeps the rest', () => {
    expect(endingErrorKey('INTERNAL')).toBe('UNKNOWN');
    expect(endingErrorKey('TIMEOUT')).toBe('TIMEOUT');
    expect(endingErrorKey('CONNECTION')).toBe('CONNECTION');
  });
});
