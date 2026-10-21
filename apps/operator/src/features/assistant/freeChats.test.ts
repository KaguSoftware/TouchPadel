import { describe, expect, it } from 'vitest';
import { FREE_CHATS_KEEP, chatTitle, newChat, parseFreeChats, removeChat, serialiseFreeChats, updateChat, type FreeChat } from './freeChats';
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
    expect(chatTitle('  How   do I take a break?  ')).toBe('How do I take a break?');
    expect(chatTitle('x'.repeat(200))).toHaveLength(80);
  });

  it('keeps at most FREE_CHATS_KEEP chats', () => {
    const many = Array.from({ length: FREE_CHATS_KEEP + 5 }, (_, i) => chat(String(i), i));
    expect(parseFreeChats(serialiseFreeChats('u1', many), 'u1')).toHaveLength(FREE_CHATS_KEEP);
  });
});
