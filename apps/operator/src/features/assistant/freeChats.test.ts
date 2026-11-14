import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FREE_CHATS_KEEP, FREE_CHATS_KEY, chatTitle, freeChatsKey, newChat, parseFreeChats, readFreeChats, removeChat, serialiseFreeChats, updateChat, writeFreeChats, type FreeChat } from './freeChats';
import { newExchange } from './freeThreadLogic';

const chat = (id: string, at: number): FreeChat => ({ ...newChat(id, `Question ${id}`, at), exchanges: [{ ...newExchange(`${id}-1`, `Question ${id}`), answer: 'A', done: true }] });

describe('free chats (kept on this computer, apart from the paid ones)', () => {
  it('round-trips one person and refuses another person or junk', () => {
    const raw = serialiseFreeChats('u1', [chat('a', 2), chat('b', 1)]);
    expect(parseFreeChats(raw, 'u1').map((c) => c.id)).toEqual(['a', 'b']);
    expect(parseFreeChats(raw, 'u2')).toEqual([]);
    expect(parseFreeChats('{nope', 'u1')).toEqual([]);
    expect(parseFreeChats(null, 'u1')).toEqual([]);
  });

  it('finishes an answer a reload cut short as stopped', () => {
    const c = { ...newChat('a', 'Q', 1), exchanges: [newExchange('x', 'Q')] };
    const [back] = parseFreeChats(serialiseFreeChats('u1', [c]), 'u1');
    expect(back!.exchanges[0]).toMatchObject({ done: true, stopped: true });
  });

  it('moves the chat it changes to the top and drops one on remove', () => {
    const chats = [chat('a', 2), chat('b', 1)];
    const next = updateChat(chats, 'b', (ex) => [...ex, newExchange('b-2', 'More')], 5);
    expect(next.map((c) => c.id)).toEqual(['b', 'a']);
    expect(next[0]!.updatedAt).toBe(5);
    expect(next[0]!.exchanges).toHaveLength(2);
    expect(removeChat(next, 'b').map((c) => c.id)).toEqual(['a']);
  });

  it('titles a chat by its first question, cut short', () => {
    expect(chatTitle('  How   do I start my shift?  ')).toBe('How do I start my shift?');
    expect(chatTitle('x'.repeat(200))).toHaveLength(80);
  });

  it('keeps at most FREE_CHATS_KEEP chats', () => {
    const many = Array.from({ length: FREE_CHATS_KEEP + 5 }, (_, i) => chat(String(i), i));
    expect(parseFreeChats(serialiseFreeChats('u1', many), 'u1')).toHaveLength(FREE_CHATS_KEEP);
  });
});

/** A Map-backed Storage, since these tests run under node. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('free chats on a shared station: one store per person', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
    vi.stubGlobal('sessionStorage', fakeStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the next person’s first question no longer wipes the previous person’s chats', () => {
    writeFreeChats('u1', [chat('a', 2)]);
    writeFreeChats('u2', [chat('b', 3)]);
    expect(readFreeChats('u1').map((c) => c.id)).toEqual(['a']);
    expect(readFreeChats('u2').map((c) => c.id)).toEqual(['b']);
    expect(localStorage.getItem(freeChatsKey('u1'))).not.toBeNull();
    expect(localStorage.getItem(FREE_CHATS_KEY)).toBeNull();
  });

  it('moves the old single key to its owner on their first read, and leaves it for its owner otherwise', () => {
    localStorage.setItem(FREE_CHATS_KEY, serialiseFreeChats('u1', [chat('a', 2)]));
    // Someone else signs in first: they get nothing, and the old key stays for u1.
    expect(readFreeChats('u2')).toEqual([]);
    expect(localStorage.getItem(FREE_CHATS_KEY)).not.toBeNull();
    // u1 reads: the chats move to u1's own key.
    expect(readFreeChats('u1').map((c) => c.id)).toEqual(['a']);
    expect(localStorage.getItem(FREE_CHATS_KEY)).toBeNull();
    expect(parseFreeChats(localStorage.getItem(freeChatsKey('u1')), 'u1').map((c) => c.id)).toEqual(['a']);
    expect(readFreeChats('u1').map((c) => c.id)).toEqual(['a']);
  });

  it('an emptied store stays empty: the old key is not read again', () => {
    localStorage.setItem(FREE_CHATS_KEY, serialiseFreeChats('u1', [chat('a', 2)]));
    readFreeChats('u1');
    writeFreeChats('u1', []);
    localStorage.setItem(FREE_CHATS_KEY, serialiseFreeChats('u1', [chat('stale', 1)]));
    expect(readFreeChats('u1')).toEqual([]);
  });

  it('nobody signed in reads and writes nothing', () => {
    writeFreeChats('', [chat('a', 1)]);
    expect(localStorage.length).toBe(0);
    expect(readFreeChats('')).toEqual([]);
  });
});
