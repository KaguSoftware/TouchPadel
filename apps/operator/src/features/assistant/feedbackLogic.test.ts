import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

// The data layer is replaced: these tests own the write.
vi.mock('./api', () => ({
  QK: { messages: (id: string) => ['assistant', 'messages', id] as const },
  rateMessage: vi.fn(),
}));

import { feedbackView, noteFor, noteOpenAfter, rateInCache, shortNote, type RateWrite } from './feedbackLogic';
import type { MessageRow } from './api';

const KEY = ['assistant', 'messages', 'c1'];

const answer = (over: Partial<Record<keyof MessageRow, unknown>> = {}): MessageRow =>
  ({
    id: 'a1',
    conversation_id: 'c1',
    seq: 2,
    role: 'assistant',
    content: [{ type: 'text', text: 'Courts held up.' }],
    sources: null,
    gate: null,
    tokens: { stop_reason: 'end_turn' },
    created_at: '2026-11-12T10:00:00Z',
    feedback: null,
    ...over,
  }) as MessageRow;

function setup(rows: MessageRow[] = [answer(), answer({ id: 'a2', seq: 4 })]) {
  const qc = new QueryClient();
  qc.setQueryData(KEY, rows);
  const read = (id = 'a1') => qc.getQueryData<MessageRow[]>(KEY)!.find((m) => m.id === id)!.feedback ?? null;
  return { qc, read, inFlight: new Set<string>() };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('rateInCache', () => {
  it('changes the row at once, before the write answers, and keeps it when saved', async () => {
    const { qc, read, inFlight } = setup();
    const d = deferred<Awaited<ReturnType<RateWrite>>>();
    const write = vi.fn<RateWrite>(() => d.promise);
    const done = rateInCache({ qc, conversationId: 'c1', messageId: 'a1', rating: 1, inFlight, write });
    expect(read()).toEqual({ rating: 1, note: null });
    expect(write).toHaveBeenCalledWith('a1', 1, null);
    d.resolve({ messageId: 'a1', rating: 1, note: null });
    await expect(done).resolves.toBe('saved');
    expect(read()).toEqual({ rating: 1, note: null });
  });

  it('leaves the other rows as they were (same objects)', async () => {
    const { qc, inFlight } = setup();
    const before = qc.getQueryData<MessageRow[]>(KEY)![1];
    await rateInCache({ qc, conversationId: 'c1', messageId: 'a1', rating: 1, inFlight, write: async () => ({ messageId: 'a1', rating: 1, note: null }) });
    expect(qc.getQueryData<MessageRow[]>(KEY)![1]).toBe(before);
  });

  it('puts the row back as it was when the write fails', async () => {
    const { qc, read, inFlight } = setup([answer({ feedback: { rating: 1, note: null } })]);
    const out = await rateInCache({
      qc,
      conversationId: 'c1',
      messageId: 'a1',
      rating: -1,
      note: 'the total is wrong',
      inFlight,
      write: async () => {
        throw new Error('ASSISTANT_NOT_RATEABLE');
      },
    });
    expect(out).toBe('failed');
    expect(read()).toEqual({ rating: 1, note: null });
    expect(inFlight.size).toBe(0);
  });

  it('clears on a second press of the chosen thumb (rating 0 -> no feedback)', async () => {
    const { qc, read, inFlight } = setup([answer({ feedback: { rating: -1, note: 'old' } })]);
    const write = vi.fn<RateWrite>(async () => ({ messageId: 'a1', rating: 0, note: null }));
    await rateInCache({ qc, conversationId: 'c1', messageId: 'a1', rating: 0, note: 'old', inFlight, write });
    expect(write).toHaveBeenCalledWith('a1', 0, null);
    expect(read()).toBeNull();
  });

  it('sends a note only with a thumbs-down', async () => {
    const { qc, read, inFlight } = setup();
    const write = vi.fn<RateWrite>(async (_id, rating, note) => ({ messageId: 'a1', rating: rating as -1 | 0 | 1, note }));
    await rateInCache({ qc, conversationId: 'c1', messageId: 'a1', rating: 1, note: 'ignored', inFlight, write });
    expect(write).toHaveBeenLastCalledWith('a1', 1, null);
    expect(read()).toEqual({ rating: 1, note: null });
    await rateInCache({ qc, conversationId: 'c1', messageId: 'a1', rating: -1, note: '  the total is wrong ', inFlight, write });
    expect(write).toHaveBeenLastCalledWith('a1', -1, 'the total is wrong');
    expect(read()).toEqual({ rating: -1, note: 'the total is wrong' });
  });

  it('ignores a second press while a write for that message is in flight', async () => {
    const { qc, read, inFlight } = setup();
    const d = deferred<Awaited<ReturnType<RateWrite>>>();
    const write = vi.fn<RateWrite>(() => d.promise);
    const first = rateInCache({ qc, conversationId: 'c1', messageId: 'a1', rating: 1, inFlight, write });
    await expect(rateInCache({ qc, conversationId: 'c1', messageId: 'a1', rating: -1, inFlight, write })).resolves.toBe('skipped');
    expect(write).toHaveBeenCalledTimes(1);
    expect(read()).toEqual({ rating: 1, note: null });
    // Another message is not held up.
    const other = rateInCache({ qc, conversationId: 'c1', messageId: 'a2', rating: -1, inFlight, write: async () => ({ messageId: 'a2', rating: -1, note: null }) });
    await expect(other).resolves.toBe('saved');
    d.resolve({ messageId: 'a1', rating: 1, note: null });
    await first;
    // Once it has landed, the next press goes through.
    await expect(rateInCache({ qc, conversationId: 'c1', messageId: 'a1', rating: 0, inFlight, write: async () => ({ messageId: 'a1', rating: 0, note: null }) })).resolves.toBe('saved');
  });

  it('skips a message the cache does not hold', async () => {
    const { qc, inFlight } = setup();
    const write = vi.fn<RateWrite>();
    await expect(rateInCache({ qc, conversationId: 'c1', messageId: 'nope', rating: 1, inFlight, write })).resolves.toBe('skipped');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('feedbackView', () => {
  it('reads the stored thumb of a rateable answer', () => {
    expect(feedbackView(answer())).toEqual({ rating: 0, note: null });
    expect(feedbackView(answer({ feedback: { rating: -1, note: 'wrong week' } }))).toEqual({ rating: -1, note: 'wrong week' });
    expect(feedbackView(answer({ feedback: { rating: 1, note: 'stray' } }))).toEqual({ rating: 1, note: null });
  });
  it('is null where the thumbs never show: a user row, a failed turn, a job answer', () => {
    expect(feedbackView(answer({ role: 'user' }))).toBeNull();
    expect(feedbackView(answer({ tokens: { error_code: 'UPSTREAM' } }))).toBeNull();
    expect(feedbackView(answer({ tokens: { stop_reason: 'max_tokens' } }))).toBeNull();
    expect(feedbackView(answer({ sources: [{ job_id: 'j1' }] }))).toBeNull();
  });
});

describe('the note', () => {
  it('travels only with -1, trimmed, capped, never empty', () => {
    expect(noteFor(1, 'x')).toBeNull();
    expect(noteFor(0, 'x')).toBeNull();
    expect(noteFor(-1, '   ')).toBeNull();
    expect(noteFor(-1, ' ok ')).toBe('ok');
    expect(noteFor(-1, 'a'.repeat(400))).toHaveLength(280);
  });
  it('opens the field only when a press lands on thumbs-down', () => {
    expect(noteOpenAfter(-1)).toBe(true);
    expect(noteOpenAfter(0)).toBe(false);
    expect(noteOpenAfter(1)).toBe(false);
  });
  it('shortens a long note for the "Noted" line', () => {
    expect(shortNote('short')).toBe('short');
    const s = shortNote('x'.repeat(100));
    expect(s.length).toBe(60);
    expect(s.endsWith('…')).toBe(true);
  });
});
