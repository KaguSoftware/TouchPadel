/**
 * The paid assistant's running questions, one per conversation, kept above
 * every screen (2026-11-11). Each conversation owns its stream state, so:
 *
 *  - switching chats on the page neither drops a running answer nor blocks the
 *    composer of the chat switched to (it used to stay "streaming" until the
 *    hidden stream ended, and every question was silently ignored);
 *  - closing the drawer no longer aborts a paid answer: the stream keeps
 *    running here and the reopened drawer shows it again. Only Stop aborts.
 *
 * A first question has no conversation yet: it runs under NEW_KEY until
 * `message_start` names the chat, then the entry moves to that id and every
 * view showing a new chat follows it (`onConversation`). A view that is gone
 * (the drawer was closed) leaves the id in sessionStorage, where the drawer
 * reads it on reopen.
 *
 * One question per conversation at a time: a press while that chat streams is
 * ignored, so a remount or a double press never sends a second paid request.
 *
 * New chat always opens a clean start screen (`resetNewChat`, 2026-11-12): a
 * first question that failed before the stream used to stay under NEW_KEY, so
 * New chat showed the dead turn again and its locked composer. A first question
 * still running is detached instead of dropped: it keeps streaming under a key
 * of its own and lands on its chat when `message_start` names it.
 *
 * Each entry keeps the scopes and model its question was asked with, so "Ask
 * again" on a failed first question re-asks exactly that, even after the
 * drawer was closed and its checked set forgotten.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { applyEvent, emptyTurn, settleTools, type DateRange } from '@touch/core/assistant/client';
import { QK, sendMessage, type MessageRow } from './api';
import { saveSessionConversation } from './scopes';
import type { ChatErrorCode, ChatTurn } from './threadLogic';

export const NEW_KEY = 'new';
/** A first question New chat moved aside while it was still running. */
const DETACHED_PREFIX = 'detached:';
let detachedSeq = 0;

/**
 * After a turn that did not end with the server's `done` (Stop, a dropped
 * connection), the server stores its rows a moment later: the messages are
 * read again after these delays so the stored turn replaces the live one. A
 * database read, never a model call.
 */
export const LATE_REFETCH_MS: readonly number[] = [3_000, 10_000];

export interface ChatEntry {
  live: ChatTurn | null;
  streaming: boolean;
  lastQuestion: string | null;
  /** The checked set the last question was asked with (a new chat's; null for an existing chat, which keeps its own). */
  lastScopes: readonly AssistantScope[] | null;
  /** The model the last question was asked with (a new chat's choice; null = the chat's own or the venue default). */
  lastModel: string | null;
}

interface Running {
  controller: AbortController;
  /** Where the question's entry lives now; moved by adopt and resetNewChat. */
  key: { current: string };
}

const EMPTY: ChatEntry = { live: null, streaming: false, lastQuestion: null, lastScopes: null, lastModel: null };

let entries = new Map<string, ChatEntry>();
/** NEW_KEY → the conversation its first question created, until a view follows or the stream ends. */
let aliases = new Map<string, string>();
const running = new Map<string, Running>();
const listeners = new Set<() => void>();
/** Views showing a key, told when the new chat they show gets its id. */
const followers = new Map<string, Set<(id: string) => void>>();

function emit(): void {
  for (const l of [...listeners]) l();
}

function realKey(key: string): string {
  return aliases.get(key) ?? key;
}

export function keyOf(conversationId: string | null): string {
  return conversationId ?? NEW_KEY;
}

export function subscribeChats(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The entry a view of `key` shows; the same object until it changes. */
export function chatEntry(key: string): ChatEntry {
  return entries.get(realKey(key)) ?? EMPTY;
}

function patch(key: string, fn: (cur: ChatEntry) => ChatEntry): void {
  const k = realKey(key);
  const cur = entries.get(k) ?? EMPTY;
  const next = fn(cur);
  if (next === cur) return;
  entries = new Map(entries).set(k, next);
  emit();
}

function patchLive(key: string, fn: (live: ChatTurn) => ChatTurn): void {
  patch(key, (cur) => (cur.live ? { ...cur, live: fn(cur.live) } : cur));
}

/** A view of `key` wants to hear when the new chat it shows gets its id. */
export function followChat(key: string, onConversation: (id: string) => void): () => void {
  const set = followers.get(key) ?? new Set();
  set.add(onConversation);
  followers.set(key, set);
  return () => {
    set.delete(onConversation);
    if (set.size === 0) followers.delete(key);
  };
}

/** A view now shows `conversationId`: the NEW_KEY alias that led there has done its job. */
export function settleAlias(conversationId: string): void {
  if (aliases.get(NEW_KEY) !== conversationId) return;
  aliases = new Map(aliases);
  aliases.delete(NEW_KEY);
  emit();
}

/** Move an entry and its running question from one key to another. */
function moveEntry(from: string, to: string): void {
  const cur = entries.get(from);
  if (cur) {
    const nextEntries = new Map(entries);
    nextEntries.delete(from);
    nextEntries.set(to, cur);
    entries = nextEntries;
  }
  const run = running.get(from);
  if (run) {
    running.delete(from);
    running.set(to, run);
    run.key.current = to;
  }
}

/** The first question's chat exists: its entry moves from NEW_KEY to the id, and the views follow. */
function adopt(id: string): void {
  if (!entries.has(NEW_KEY) && !running.has(NEW_KEY)) return;
  moveEntry(NEW_KEY, id);
  // Views of a new chat keep seeing the turn until they have moved to the id.
  aliases = new Map(aliases).set(NEW_KEY, id);
  emit();
  const views = [...(followers.get(NEW_KEY) ?? [])];
  if (views.length === 0) saveSessionConversation(id);
  for (const follow of views) follow(id);
}

/**
 * New chat: the start screen, whatever the last new chat left behind. A
 * finished or failed first question is forgotten (a refusal before the stream
 * was never stored, and a stored one is in the chat list); one still running
 * moves aside under a key of its own and keeps streaming, so its answer lands
 * on its chat (or is aborted by Stop from that chat), never on this screen.
 */
export function resetNewChat(): void {
  let changed = false;
  if (aliases.has(NEW_KEY)) {
    aliases = new Map(aliases);
    aliases.delete(NEW_KEY);
    changed = true;
  }
  if (running.has(NEW_KEY)) {
    detachedSeq += 1;
    moveEntry(NEW_KEY, `${DETACHED_PREFIX}${detachedSeq}`);
    changed = true;
  } else if (entries.has(NEW_KEY)) {
    const nextEntries = new Map(entries);
    nextEntries.delete(NEW_KEY);
    entries = nextEntries;
    changed = true;
  }
  if (changed) emit();
}

export interface AskInput {
  conversationId: string | null;
  question: string;
  scopes: readonly AssistantScope[];
  model?: string | null;
  range?: DateRange;
  lang: 'en' | 'ar';
  qc: QueryClient;
  /** Map a thrown value to the sentence's code (useAssistantChat.errorCodeOf). */
  codeOf: (err: unknown) => ChatErrorCode;
}

function isAbort(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError');
}

/**
 * Send one question and fold its stream into the conversation's entry. Resolves
 * when the stream ends. Returns false (and sends nothing) when that chat is
 * already answering or the question is empty.
 */
export async function askInChat(input: AskInput): Promise<boolean> {
  const { conversationId, question, scopes, model, range, lang, qc, codeOf } = input;
  const startKey = keyOf(conversationId);
  if (question === '' || chatEntry(startKey).streaming || running.has(realKey(startKey))) return false;
  if (!conversationId && scopes.length === 0) return false;

  const ac = new AbortController();
  // A new chat's question no longer resolves through an old alias.
  if (!conversationId && aliases.has(NEW_KEY)) {
    aliases = new Map(aliases);
    aliases.delete(NEW_KEY);
  }
  const key = { current: startKey };
  running.set(startKey, { controller: ac, key });
  const knownIds = conversationId ? (qc.getQueryData<MessageRow[]>(QK.messages(conversationId)) ?? []).map((r) => r.id) : [];
  const turn: ChatTurn = { ...emptyTurn(conversationId, question), knownIds };
  patch(startKey, () => ({
    live: turn,
    streaming: true,
    lastQuestion: question,
    lastScopes: conversationId ? null : [...scopes],
    lastModel: conversationId ? null : (model ?? null),
  }));

  let convId = conversationId;
  let ended = false; // `done` or `error` arrived
  let clean = false;
  try {
    await sendMessage(
      {
        conversation_id: conversationId,
        text: question,
        lang,
        // A new chat carries its checked set and its model; an existing row already has both.
        ...(conversationId ? {} : { scopes: [...scopes], ...(model ? { model } : {}) }),
        ...(range ? { range } : {}),
      },
      {
        signal: ac.signal,
        onEvent: (name, data) => {
          if (name === 'done' || name === 'error') ended = true;
          const startedId = name === 'message_start' && typeof data === 'object' && data !== null ? (data as { conversation_id?: unknown }).conversation_id : null;
          if (typeof startedId === 'string' && startedId !== convId) {
            convId = startedId;
            if (key.current === NEW_KEY) adopt(startedId);
            // Moved aside by New chat: it lands on its chat, and no view follows it there.
            else if (key.current.startsWith(DETACHED_PREFIX)) moveEntry(key.current, startedId);
          }
          patchLive(key.current, (cur) => ({ ...cur, ...applyEvent(cur, name, data) }));
        },
      },
    );
    if (ended) clean = true;
    else {
      // The stream closed without `done` or `error`: the answer did not finish.
      patchLive(key.current, (cur) => ({ ...cur, done: true, dropped: true, error: cur.error ?? { code: 'UNKNOWN', message: 'stream closed before done' }, tools: settleTools(cur.tools) }));
    }
  } catch (err) {
    if (isAbort(err)) {
      patchLive(key.current, (cur) => ({ ...cur, done: true, stopped: true, tools: settleTools(cur.tools) }));
    } else {
      const code = codeOf(err);
      const message = err instanceof Error ? err.message : '';
      patchLive(key.current, (cur) =>
        cur.error
          ? { ...cur, done: true, tools: settleTools(cur.tools) }
          : code === 'CONNECTION'
            ? { ...cur, done: true, dropped: true, error: { code: 'UNKNOWN', message }, tools: settleTools(cur.tools) }
            : { ...cur, done: true, error: { code, message }, tools: settleTools(cur.tools) },
      );
    }
  } finally {
    running.delete(key.current);
    patch(key.current, (cur) => ({ ...cur, streaming: false, live: cur.live && !cur.live.done ? { ...cur.live, done: true } : cur.live }));
    // No view followed the new chat (the drawer was closed): drop the alias.
    if (aliases.get(NEW_KEY) === key.current && key.current !== NEW_KEY && !followers.has(NEW_KEY)) settleAlias(key.current);
    // Moved aside and never named a chat (refused before the stream): nobody can see it, so forget it.
    if (key.current.startsWith(DETACHED_PREFIX)) {
      const nextEntries = new Map(entries);
      nextEntries.delete(key.current);
      entries = nextEntries;
      emit();
    }
    // Whatever happened, the stored rows are the record: refetch them so the
    // persisted turn replaces the live one (or shows what survived).
    const refetchMessages = () => {
      if (convId) void qc.invalidateQueries({ queryKey: QK.messages(convId) });
    };
    refetchMessages();
    if (convId) void qc.invalidateQueries({ queryKey: QK.jobs(convId) });
    void qc.invalidateQueries({ queryKey: QK.conversations });
    // The turn just spent tokens: the meter and the cap must move with it.
    void qc.invalidateQueries({ queryKey: ['assistant', 'usage'] });
    // The server stores a stopped or broken turn after the stream is gone.
    if (!clean && convId) for (const ms of LATE_REFETCH_MS) setTimeout(refetchMessages, ms);
  }
  return true;
}

/** Stop the question running in `key`'s conversation (the Stop button). */
export function stopChat(key: string): void {
  running.get(realKey(key))?.controller.abort();
}

/**
 * Stop every running question and forget every chat's stream, alias and
 * follower. Called when the person at the station changes (the drawer
 * provider, on sign-out or another sign-in): a stream is its asker's, so it
 * must neither stay readable in memory nor keep a paid answer running for
 * someone who left. Tests call it between cases.
 */
export function resetChatStreams(): void {
  for (const r of running.values()) r.controller.abort();
  running.clear();
  entries = new Map();
  aliases = new Map();
  followers.clear();
  emit();
}
