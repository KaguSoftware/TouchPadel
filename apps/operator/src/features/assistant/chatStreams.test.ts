import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { StreamEdgeOptions } from '../../lib/edge';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { EdgeError, StreamStalledError } from '../../lib/edge';
import { errorCodeOf, retryOptions } from './useAssistantChat';
import { liveOutcome } from './threadLogic';

/** Each sendMessage call parks here until the test feeds it events and ends it. */
interface Call {
  body: { conversation_id: string | null; text: string };
  opts: StreamEdgeOptions;
  end: () => void;
  fail: (err: unknown) => void;
}
const h = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock('./api', () => ({
  QK: {
    conversations: ['assistant', 'conversations'],
    messages: (id: string) => ['assistant', 'messages', id],
    jobs: (id: string) => ['assistant', 'jobs', id],
  },
  sendMessage: (body: Call['body'], opts: StreamEdgeOptions) =>
    new Promise<void>((resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      h.calls.push({ body, opts, end: resolve, fail: reject } satisfies Call);
    }),
}));

const { askInChat, chatEntry, followChat, keyOf, resetChatStreams, resetNewChat, settleAlias, stopChat, LATE_REFETCH_MS, NEW_KEY } = await import('./chatStreams');

const calls = () => h.calls as Call[];

function ask(conversationId: string | null, question: string, qc = new QueryClient()) {
  return askInChat({ conversationId, question, scopes: ['cafe'], lang: 'en', qc, codeOf: errorCodeOf });
}

beforeEach(() => {
  h.calls.length = 0;
  resetChatStreams();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('chat streams: each conversation owns its stream state', () => {
  it('switching chats leaves the running answer where it belongs, and the other chat can ask', async () => {
    const a = ask('A', 'In A?');
    expect(chatEntry('A').streaming).toBe(true);
    // Chat B, shown while A streams: not streaming, its composer works.
    expect(chatEntry('B').streaming).toBe(false);
    expect(chatEntry('B').live).toBeNull();
    const b = ask('B', 'In B?');
    expect(calls()).toHaveLength(2);
    expect(calls()[1]!.body).toMatchObject({ conversation_id: 'B', text: 'In B?' });

    // Stop in B stops B only.
    stopChat(keyOf('B'));
    await b;
    expect(chatEntry('B').live!.stopped).toBe(true);
    expect(chatEntry('A').streaming).toBe(true);

    calls()[0]!.opts.onEvent('message_start', { conversation_id: 'A', user_message_id: 'u1', assistant_message_id: 'a1' });
    calls()[0]!.opts.onEvent('delta', { text: 'Hi' });
    calls()[0]!.opts.onEvent('done', { message_id: 'a1', stop_reason: 'end_turn' });
    calls()[0]!.end();
    await a;
    expect(chatEntry('A')).toMatchObject({ streaming: false, lastQuestion: 'In A?' });
    expect(liveOutcome(chatEntry('A').live!)).toEqual({ kind: 'ok' });
  });

  it('never sends a second paid request while that chat is answering (a double press, a remount)', async () => {
    const first = ask('A', 'Once?');
    expect(await ask('A', 'Once?')).toBe(false);
    expect(await ask('A', 'Another?')).toBe(false);
    expect(calls()).toHaveLength(1);
    calls()[0]!.opts.onEvent('done', { message_id: 'a1' });
    calls()[0]!.end();
    await first;
  });

  it('keeps streaming with no view mounted (the drawer closed) and shows the turn to the next view', async () => {
    // No follower, no hook: the stream lives in the store, not in a component.
    const p = ask('A', 'While closed?');
    calls()[0]!.opts.onEvent('delta', { text: 'Still ' });
    calls()[0]!.opts.onEvent('delta', { text: 'here' });
    // A view mounted again later reads the same entry.
    expect(chatEntry('A').live!.text).toBe('Still here');
    expect(chatEntry('A').streaming).toBe(true);
    calls()[0]!.opts.onEvent('done', {});
    calls()[0]!.end();
    await p;
  });

  it('a first question moves to the chat it created, and the views of a new chat follow it', async () => {
    const followed: string[] = [];
    const unfollow = followChat(keyOf(null), (id) => followed.push(id));
    const p = ask(null, 'First?');
    expect(chatEntry('new').streaming).toBe(true);
    calls()[0]!.opts.onEvent('message_start', { conversation_id: 'C9', user_message_id: 'u', assistant_message_id: 'a' });
    expect(followed).toEqual(['C9']);
    // Both keys see the turn until the view has moved.
    expect(chatEntry('C9').live!.conversationId).toBe('C9');
    expect(chatEntry('new')).toBe(chatEntry('C9'));
    unfollow();
    settleAlias('C9');
    expect(chatEntry('new').live).toBeNull();
    calls()[0]!.opts.onEvent('done', {});
    calls()[0]!.end();
    await p;
    expect(chatEntry('C9').streaming).toBe(false);
  });
});

describe('a first question that fails is never a dead end (2026-11-12)', () => {
  function askNew(question: string, scopes: readonly AssistantScope[], model: string | null = null) {
    return askInChat({ conversationId: null, question, scopes, model, lang: 'en', qc: new QueryClient(), codeOf: errorCodeOf });
  }

  it('New chat forgets a first question refused before the stream: the start screen comes back', async () => {
    const p = askNew('First?', ['cafe']);
    calls()[0]!.fail(new EdgeError(429, 'RATE_LIMITED', 'cap', 'LLM_MONTHLY_CAP'));
    await p;
    expect(chatEntry(NEW_KEY).live!.error!.code).toBe('LLM_MONTHLY_CAP');
    resetNewChat();
    // Thread's isNew is `conversationId === null && live === null`.
    expect(chatEntry(NEW_KEY).live).toBeNull();
    expect(chatEntry(NEW_KEY).streaming).toBe(false);
  });

  it('New chat while a first question runs moves it aside: it keeps streaming and lands on its own chat', async () => {
    const qc = new QueryClient();
    const followed: string[] = [];
    const unfollow = followChat(keyOf(null), (id) => followed.push(id));
    const p = askInChat({ conversationId: null, question: 'Long one?', scopes: ['cafe'], lang: 'en', qc, codeOf: errorCodeOf });
    resetNewChat();
    expect(chatEntry(NEW_KEY).live).toBeNull();
    // The new chat's composer is free: a second first question can be asked at once.
    const second = askNew('Another?', ['courts']);
    expect(calls()).toHaveLength(2);
    calls()[0]!.opts.onEvent('message_start', { conversation_id: 'C1', user_message_id: 'u', assistant_message_id: 'a' });
    calls()[0]!.opts.onEvent('delta', { text: 'Still going' });
    // The moved question did not drag the new chat's view along, and reads on its own chat.
    expect(followed).toEqual([]);
    expect(chatEntry('C1').live!.text).toBe('Still going');
    expect(chatEntry(NEW_KEY).live!.userText).toBe('Another?');
    // Stop on its chat still stops it.
    stopChat('C1');
    await p;
    expect(chatEntry('C1').live!.stopped).toBe(true);
    calls()[1]!.opts.onEvent('done', {});
    calls()[1]!.end();
    await second;
    unfollow();
  });

  it('a moved-aside question refused before it named a chat is forgotten (nobody can see it)', async () => {
    const p = askNew('Refused?', ['cafe']);
    resetNewChat();
    calls()[0]!.fail(new EdgeError(503, 'NOT_CONFIGURED', 'no key'));
    await p;
    expect(chatEntry(NEW_KEY).live).toBeNull();
  });

  it('keeps the scopes and model the first question was asked with, so Ask again re-asks exactly that', async () => {
    const p = askNew('Sales?', ['cafe', 'money'], 'claude-sonnet-5-5');
    calls()[0]!.fail(new TypeError('Failed to fetch'));
    await p;
    const entry = chatEntry(NEW_KEY);
    expect(entry.lastScopes).toEqual(['cafe', 'money']);
    expect(retryOptions(entry)).toEqual({ scopes: ['cafe', 'money'], model: 'claude-sonnet-5-5' });
    // The drawer was closed and reopened: its checked set is empty again. Asking with it sends nothing…
    expect(await askNew('Sales?', [])).toBe(false);
    // …but Ask again uses the question's own set and model.
    const retry = retryOptions(entry);
    const again = askNew('Sales?', retry.scopes!, retry.model ?? null);
    expect(calls()).toHaveLength(2);
    expect(calls()[1]!.body).toMatchObject({ conversation_id: null, text: 'Sales?', scopes: ['cafe', 'money'], model: 'claude-sonnet-5-5' });
    calls()[1]!.opts.onEvent('done', {});
    calls()[1]!.end();
    expect(await again).toBe(true);
  });

  it('an existing chat keeps no scopes of its own (its row has them)', async () => {
    const p = ask('A', 'Q?');
    calls()[0]!.end();
    await p;
    expect(chatEntry('A').lastScopes).toBeNull();
    expect(retryOptions(chatEntry('A'))).toEqual({});
  });
});

describe('a stream that breaks is a connection failure, not a finished answer', () => {
  it('closed without done or error', async () => {
    const p = ask('A', 'Q?');
    calls()[0]!.opts.onEvent('message_start', { conversation_id: 'A', user_message_id: 'u', assistant_message_id: 'a' });
    calls()[0]!.opts.onEvent('delta', { text: 'Half an ans' });
    calls()[0]!.end();
    await p;
    const live = chatEntry('A').live!;
    expect(live.done).toBe(true);
    expect(live.text).toBe('Half an ans');
    expect(liveOutcome(live)).toEqual({ kind: 'error', code: 'CONNECTION' });
  });

  it('the watchdog cut a silent stream, or the network failed mid-stream', async () => {
    for (const err of [new StreamStalledError(45_000), new TypeError('network error')]) {
      resetChatStreams();
      h.calls.length = 0;
      const p = ask('A', 'Q?');
      calls()[0]!.opts.onEvent('delta', { text: 'x' });
      calls()[0]!.fail(err);
      await p;
      expect(liveOutcome(chatEntry('A').live!)).toEqual({ kind: 'error', code: 'CONNECTION' });
    }
  });

  it('the server’s own error stays its own sentence', async () => {
    const p = ask('A', 'Q?');
    calls()[0]!.opts.onEvent('error', { code: 'TIMEOUT', message: 'late' });
    calls()[0]!.opts.onEvent('done', { message_id: 'a', stop_reason: 'TIMEOUT' });
    calls()[0]!.end();
    await p;
    expect(liveOutcome(chatEntry('A').live!)).toEqual({ kind: 'error', code: 'TIMEOUT' });
  });

  it('reads the messages again a little later, because the server stores a broken turn after the stream is gone', async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const p = ask('A', 'Q?', qc);
    calls()[0]!.end();
    await p;
    const messageReads = () => spy.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(['assistant', 'messages', 'A'])).length;
    expect(messageReads()).toBe(1);
    await vi.advanceTimersByTimeAsync(LATE_REFETCH_MS[LATE_REFETCH_MS.length - 1]!);
    expect(messageReads()).toBe(1 + LATE_REFETCH_MS.length);
  });

  it('a clean finish reads the messages once', async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const p = ask('A', 'Q?', qc);
    calls()[0]!.opts.onEvent('done', { message_id: 'a', stop_reason: 'end_turn' });
    calls()[0]!.end();
    await p;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spy.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(['assistant', 'messages', 'A']))).toHaveLength(1);
  });
});
