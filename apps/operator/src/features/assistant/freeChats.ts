/**
 * The free AI's saved chats (Sait, 2026-10-20: "the free AI should have chats
 * like the paid one, and the two kept apart"). They live on THIS computer only,
 * per person, in localStorage: the free AI still stores nothing on the server
 * (owner call 2026-10-16). The paid chats stay in the database and in their own
 * list; nothing here ever reaches or reads them.
 *
 * The pure half (parse, create, update, remove) is tested on its own; below it
 * a tiny shared store, so the page's chat drawer, its strip and the thread all
 * see the same chats and the same open one.
 *
 * One key per person (2026-11-11): on a shared station the next person's first
 * question used to overwrite the one key, wiping the previous person's chats.
 * The old single key is moved to its owner's key the first time they read.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { FREE_THREAD_KEEP, FREE_THREAD_SESSION_KEY, loadFreeThread, type FreeExchange } from './freeThreadLogic';

export interface FreeChat {
  id: string;
  /** The first question, cut short. */
  title: string;
  /** ms since the epoch; the list is newest first. */
  updatedAt: number;
  exchanges: FreeExchange[];
}

/** The single key of before 2026-11-11 (one person per computer); read once to migrate. */
export const FREE_CHATS_KEY = 'touch-assistant-free-chats-v1';

/** This person's own key. */
export function freeChatsKey(userId: string): string {
  return `${FREE_CHATS_KEY}:${userId}`;
}
export const FREE_ACTIVE_KEY = 'touch-assistant-free-active';
/** Older chats fall off the end of the list. */
export const FREE_CHATS_KEEP = 50;
const TITLE_MAX = 80;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isExchange(v: unknown): v is FreeExchange {
  return isRecord(v) && typeof v.id === 'string' && typeof v.question === 'string' && typeof v.answer === 'string';
}

export function chatTitle(question: string): string {
  const t = question.trim().replace(/\s+/g, ' ');
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

/** This person's chats as stored; anything malformed or someone else's is dropped. */
export function parseFreeChats(raw: string | null, userId: string): FreeChat[] {
  if (!raw || !userId) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.user !== userId || !Array.isArray(parsed.chats)) return [];
    return parsed.chats
      .filter((c): c is FreeChat => isRecord(c) && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.updatedAt === 'number' && Array.isArray(c.exchanges))
      .map((c) => ({
        ...c,
        // A stream cut by a reload is finished as stopped, never left spinning.
        exchanges: c.exchanges.filter(isExchange).map((e) => (e.done ? e : { ...e, done: true, stopped: true })),
      }))
      .slice(0, FREE_CHATS_KEEP);
  } catch {
    return [];
  }
}

export function serialiseFreeChats(userId: string, chats: readonly FreeChat[]): string {
  return JSON.stringify({ user: userId, chats: chats.slice(0, FREE_CHATS_KEEP).map((c) => ({ ...c, exchanges: c.exchanges.slice(-FREE_THREAD_KEEP) })) });
}

export function newChat(id: string, question: string, now: number): FreeChat {
  return { id, title: chatTitle(question), updatedAt: now, exchanges: [] };
}

/** Change one chat's exchanges; the chat moves to the top of the list. */
export function updateChat(chats: readonly FreeChat[], id: string, fn: (exchanges: FreeExchange[]) => FreeExchange[], now: number): FreeChat[] {
  const chat = chats.find((c) => c.id === id);
  if (!chat) return [...chats];
  const next = { ...chat, updatedAt: now, exchanges: fn(chat.exchanges) };
  return [next, ...chats.filter((c) => c.id !== id)];
}

export function removeChat(chats: readonly FreeChat[], id: string): FreeChat[] {
  return chats.filter((c) => c.id !== id);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

interface State {
  userId: string;
  chats: FreeChat[];
  activeId: string | null;
}

let state: State = { userId: '', chats: [], activeId: null };
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Write one person's chats under their own key. */
export function writeFreeChats(userId: string, chats: readonly FreeChat[]): void {
  if (!userId) return;
  localStorage.setItem(freeChatsKey(userId), serialiseFreeChats(userId, chats));
}

/**
 * One person's chats: their own key; else the old single key when it is
 * theirs (moved to their key, and the old key removed); else the single
 * thread of before 2026-10-20. Another person's old key is left for them.
 */
export function readFreeChats(userId: string): FreeChat[] {
  if (!userId) return [];
  try {
    const own = localStorage.getItem(freeChatsKey(userId));
    if (own !== null) return parseFreeChats(own, userId);
    const legacyRaw = localStorage.getItem(FREE_CHATS_KEY);
    const legacy = parseFreeChats(legacyRaw, userId);
    if (legacy.length > 0) {
      writeFreeChats(userId, legacy);
      localStorage.removeItem(FREE_CHATS_KEY);
      return legacy;
    }
    // The single thread of before 2026-10-20 becomes the first saved chat.
    const old = loadFreeThread(userId);
    if (old.length === 0) return [];
    sessionStorage.removeItem(FREE_THREAD_SESSION_KEY);
    const chat: FreeChat = { id: `free-chat-${Date.now().toString(36)}`, title: chatTitle(old[0]!.question), updatedAt: Date.now(), exchanges: old };
    writeFreeChats(userId, [chat]);
    return [chat];
  } catch {
    return [];
  }
}

function readActive(userId: string, chats: readonly FreeChat[]): string | null {
  try {
    const raw = sessionStorage.getItem(FREE_ACTIVE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { user?: unknown; id?: unknown }) : null;
    return parsed && parsed.user === userId && typeof parsed.id === 'string' && chats.some((c) => c.id === parsed.id) ? parsed.id : null;
  } catch {
    return null;
  }
}

/** Load a person's chats the first time they are asked for (idempotent, no emit). */
function ensureUser(userId: string): State {
  if (state.userId !== userId) {
    const chats = userId ? readFreeChats(userId) : [];
    state = { userId, chats, activeId: userId ? readActive(userId, chats) : null };
  }
  return state;
}

function persist(): void {
  // A streamed answer patches the chat many times a second: write once it settles.
  if (saveTimer) clearTimeout(saveTimer);
  const { userId, chats, activeId } = state;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!userId) return;
      writeFreeChats(userId, chats);
      if (activeId) sessionStorage.setItem(FREE_ACTIVE_KEY, JSON.stringify({ user: userId, id: activeId }));
      else sessionStorage.removeItem(FREE_ACTIVE_KEY);
    } catch {
      /* private mode: the chats last the session */
    }
  }, 250);
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  persist();
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: forget what is in memory. */
export function resetFreeChatsMemory(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  state = { userId: '', chats: [], activeId: null };
}

export interface UseFreeChats {
  chats: FreeChat[];
  activeId: string | null;
  active: FreeChat | null;
  select: (id: string | null) => void;
  /** Open a new, empty chat (none is created until the first question). */
  startNew: () => void;
  /** Make a chat for a first question and open it. */
  create: (chat: FreeChat) => void;
  update: (id: string, fn: (exchanges: FreeExchange[]) => FreeExchange[]) => void;
  remove: (id: string) => void;
}

export function useFreeChats(userId: string): UseFreeChats {
  const snap = useSyncExternalStore(subscribe, () => ensureUser(userId));
  const select = useCallback((id: string | null) => set({ activeId: id }), []);
  const startNew = useCallback(() => set({ activeId: null }), []);
  const create = useCallback((chat: FreeChat) => set({ chats: [chat, ...state.chats].slice(0, FREE_CHATS_KEEP), activeId: chat.id }), []);
  const update = useCallback((id: string, fn: (exchanges: FreeExchange[]) => FreeExchange[]) => set({ chats: updateChat(state.chats, id, fn, Date.now()) }), []);
  const remove = useCallback((id: string) => set({ chats: removeChat(state.chats, id), activeId: state.activeId === id ? null : state.activeId }), []);
  return { chats: snap.chats, activeId: snap.activeId, active: snap.chats.find((c) => c.id === snap.activeId) ?? null, select, startNew, create, update, remove };
}
