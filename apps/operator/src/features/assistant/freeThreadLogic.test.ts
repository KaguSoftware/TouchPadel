import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FREE_HISTORY_MAX } from '@touch/core/assistant/free';
import { EdgeError } from '../../lib/edge';
import {
  FREE_THREAD_SESSION_KEY,
  applyFreeEvent,
  canRetry,
  freeErrorFromEvent,
  freeErrorMessage,
  freeErrorOf,
  historyOf,
  loadFreeThread,
  newExchange,
  parseFreeThread,
  saveFreeThread,
  type FreeExchange,
} from './freeThreadLogic';

function done(question: string, answer: string, extra: Partial<FreeExchange> = {}): FreeExchange {
  return { ...newExchange(`id-${question}`, question), answer, done: true, ...extra };
}

describe('applyFreeEvent', () => {
  it('grows the answer delta by delta and closes on done', () => {
    let ex = newExchange('a', 'Where are my tasks?');
    ex = applyFreeEvent(ex, 'message_start', { model: 'm', free: true });
    ex = applyFreeEvent(ex, 'delta', { text: 'Open ' });
    ex = applyFreeEvent(ex, 'delta', { text: '/tasks.' });
    expect(ex.answer).toBe('Open /tasks.');
    expect(ex.done).toBe(false);
    ex = applyFreeEvent(ex, 'done', { stop_reason: 'end_turn' });
    expect(ex.done).toBe(true);
    expect(ex.error).toBeNull();
  });

  it('keeps the text so far when the stream errors', () => {
    let ex = applyFreeEvent(newExchange('a', 'q'), 'delta', { text: 'half' });
    ex = applyFreeEvent(ex, 'error', { code: 'TIMEOUT', message: 'x' });
    ex = applyFreeEvent(ex, 'done', { stop_reason: 'TIMEOUT' });
    expect(ex).toMatchObject({ answer: 'half', done: true, error: { kind: 'timeout' } });
  });
});

describe('errors', () => {
  it('maps the 429 scopes from the refusal body', () => {
    expect(freeErrorOf(new EdgeError(429, 'RATE_LIMITED', 'x', 'RATE_LIMITED', { code: 'RATE_LIMITED', scope: 'minute', retry_after_s: 37 }))).toEqual({ kind: 'minute', seconds: 37 });
    expect(freeErrorOf(new EdgeError(429, 'RATE_LIMITED', 'x', 'RATE_LIMITED', { scope: 'minute' }))).toEqual({ kind: 'minute', seconds: null });
    expect(freeErrorOf(new EdgeError(429, 'RATE_LIMITED', 'x', 'RATE_LIMITED', { scope: 'day', retry_after_s: 3600 }))).toEqual({ kind: 'day' });
    expect(freeErrorOf(new EdgeError(429, 'RATE_LIMITED', 'x', 'RATE_LIMITED', { scope: 'club' }))).toEqual({ kind: 'club' });
  });

  it('maps not configured, and anything else to the generic sentence', () => {
    expect(freeErrorOf(new EdgeError(503, 'NOT_CONFIGURED', 'x', 'NOT_CONFIGURED', { code: 'NOT_CONFIGURED' }))).toEqual({ kind: 'notConfigured' });
    expect(freeErrorOf(new EdgeError(502, 'UPSTREAM', 'x', 'UPSTREAM'))).toEqual({ kind: 'generic' });
    expect(freeErrorOf(new TypeError('Failed to fetch'))).toEqual({ kind: 'generic' });
  });

  it('maps the stream error codes', () => {
    expect(freeErrorFromEvent({ code: 'RATE_LIMITED' })).toEqual({ kind: 'club' });
    expect(freeErrorFromEvent({ code: 'UPSTREAM' })).toEqual({ kind: 'generic' });
  });

  it('picks the sentence and whether a retry is offered', () => {
    expect(freeErrorMessage({ kind: 'minute', seconds: 12 })).toEqual({ key: 'minute', seconds: 12 });
    expect(freeErrorMessage({ kind: 'minute', seconds: null })).toEqual({ key: 'minuteSoon' });
    expect(freeErrorMessage({ kind: 'day' })).toEqual({ key: 'day' });
    expect(canRetry({ kind: 'day' })).toBe(false);
    expect(canRetry({ kind: 'notConfigured' })).toBe(false);
    expect(canRetry({ kind: 'club' })).toBe(true);
    expect(canRetry({ kind: 'generic' })).toBe(true);
  });
});

describe('historyOf', () => {
  it('sends finished answered turns only, the last FREE_HISTORY_MAX of them', () => {
    const exchanges = [
      done('one', 'a1'),
      done('two', '', { error: { kind: 'generic' } }),
      done('three', 'a3', { error: { kind: 'timeout' } }),
      newExchange('live', 'four'),
      done('five', 'a5'),
      done('six', 'a6'),
      done('seven', 'a7'),
    ];
    const h = historyOf(exchanges);
    expect(h).toHaveLength(FREE_HISTORY_MAX);
    expect(h[0]).toEqual({ role: 'user', text: 'five' });
    expect(h.at(-1)).toEqual({ role: 'assistant', text: 'a7' });
    expect(h.some((t) => t.text === 'two' || t.text === 'three' || t.text === 'four')).toBe(false);
  });
});

describe('the session mirror', () => {
  const data = new Map<string, string>();
  beforeEach(() => {
    data.clear();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips per person and empties on clear', () => {
    saveFreeThread('u1', [done('q', 'a')]);
    expect(loadFreeThread('u1')).toEqual([done('q', 'a')]);
    expect(loadFreeThread('u2')).toEqual([]);
    saveFreeThread('u1', []);
    expect(data.has(FREE_THREAD_SESSION_KEY)).toBe(false);
  });

  it('shows an answer that was still streaming as stopped', () => {
    const raw = JSON.stringify({ user: 'u1', exchanges: [{ ...newExchange('x', 'q'), answer: 'part' }] });
    expect(parseFreeThread(raw, 'u1')).toEqual([{ id: 'x', question: 'q', answer: 'part', done: true, stopped: true, error: null }]);
  });

  it('ignores junk', () => {
    expect(parseFreeThread('{', 'u1')).toEqual([]);
    expect(parseFreeThread(JSON.stringify({ user: 'u1', exchanges: [{ nope: 1 }] }), 'u1')).toEqual([]);
  });
});
