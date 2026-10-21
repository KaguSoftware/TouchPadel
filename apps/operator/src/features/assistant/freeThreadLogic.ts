/**
 * The free AI's thread, the pure half (FreeThread.tsx draws it; named apart because the file system ignores case). Nothing is
 * stored server-side (`assistant-free`, contract in
 * @touch/core/assistant/free): the thread is React state, mirrored to
 * sessionStorage per person so a reload or a closed drawer keeps it, and each
 * question carries the last few finished turns as `history`.
 */
import { freeHistory, type FreeTurn } from '@touch/core/assistant/free';
import { EdgeError } from '../../lib/edge';

/** Why a question got no (whole) answer, in the words FreeThread shows. */
export type FreeErrorInfo =
  | { kind: 'minute'; seconds: number | null }
  | { kind: 'day' }
  | { kind: 'club' }
  | { kind: 'notConfigured' }
  | { kind: 'timeout' }
  | { kind: 'generic' };

/** One question and its answer. */
export interface FreeExchange {
  id: string;
  question: string;
  answer: string;
  done: boolean;
  stopped: boolean;
  error: FreeErrorInfo | null;
}

export const FREE_THREAD_SESSION_KEY = 'touch-assistant-free-thread';
/** Kept in sessionStorage; older exchanges fall off (the model only ever sees the last few). */
export const FREE_THREAD_KEEP = 30;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function newExchange(id: string, question: string): FreeExchange {
  return { id, question, answer: '', done: false, stopped: false, error: null };
}

/** A refusal before the stream (EdgeError) or a thrown network error. */
export function freeErrorOf(err: unknown): FreeErrorInfo {
  if (err instanceof EdgeError) {
    const body = isRecord(err.body) ? err.body : {};
    const code = err.serverCode ?? err.kind;
    if (err.status === 429 || code === 'RATE_LIMITED') {
      const scope = body.scope;
      if (scope === 'day') return { kind: 'day' };
      if (scope === 'minute') {
        const s = body.retry_after_s;
        return { kind: 'minute', seconds: typeof s === 'number' && Number.isFinite(s) && s > 0 ? Math.ceil(s) : null };
      }
      return { kind: 'club' };
    }
    if (code === 'NOT_CONFIGURED' || err.kind === 'NOT_CONFIGURED') return { kind: 'notConfigured' };
    return { kind: 'generic' };
  }
  return { kind: 'generic' };
}

/** The stream's own `error {code}` (after it opened). */
export function freeErrorFromEvent(data: unknown): FreeErrorInfo {
  const code = isRecord(data) ? data.code : null;
  if (code === 'RATE_LIMITED') return { kind: 'club' };
  if (code === 'TIMEOUT') return { kind: 'timeout' };
  if (code === 'NOT_CONFIGURED') return { kind: 'notConfigured' };
  return { kind: 'generic' };
}

/** Apply one SSE event to the exchange being answered. */
export function applyFreeEvent(ex: FreeExchange, name: string, data: unknown): FreeExchange {
  switch (name) {
    case 'delta': {
      const text = isRecord(data) && typeof data.text === 'string' ? data.text : '';
      return text ? { ...ex, answer: ex.answer + text } : ex;
    }
    case 'error':
      return { ...ex, done: true, error: ex.error ?? freeErrorFromEvent(data) };
    case 'done':
      return { ...ex, done: true };
    default:
      return ex;
  }
}

/** The `history` a new question carries: finished exchanges with an answer, as turns, trimmed by freeHistory. */
export function historyOf(exchanges: readonly FreeExchange[]): FreeTurn[] {
  const turns: FreeTurn[] = [];
  for (const ex of exchanges) {
    if (!ex.done || ex.error || ex.answer.trim() === '') continue;
    turns.push({ role: 'user', text: ex.question }, { role: 'assistant', text: ex.answer });
  }
  return freeHistory(turns);
}

/** The i18n key (under ws.assistantFree.errors) and its params. */
export function freeErrorMessage(info: FreeErrorInfo): { key: 'minute' | 'minuteSoon' | 'day' | 'club' | 'notConfigured' | 'timeout' | 'generic'; seconds?: number } {
  if (info.kind === 'minute') return info.seconds ? { key: 'minute', seconds: info.seconds } : { key: 'minuteSoon' };
  return { key: info.kind };
}

/** A retry makes sense unless the day's allowance is gone or the key is missing. */
export function canRetry(info: FreeErrorInfo): boolean {
  return info.kind !== 'day' && info.kind !== 'notConfigured';
}

// ---------------------------------------------------------------------------
// sessionStorage mirror
// ---------------------------------------------------------------------------

function isExchange(v: unknown): v is FreeExchange {
  return isRecord(v) && typeof v.id === 'string' && typeof v.question === 'string' && typeof v.answer === 'string';
}

/**
 * This person's thread from this tab's session. An exchange that was still
 * streaming when the page went away is shown as stopped.
 */
export function parseFreeThread(raw: string | null, userId: string): FreeExchange[] {
  if (!raw || !userId) return [];
  try {
    const parsed = JSON.parse(raw) as { user?: unknown; exchanges?: unknown };
    if (parsed.user !== userId || !Array.isArray(parsed.exchanges)) return [];
    return parsed.exchanges.filter(isExchange).map((ex) => ({
      id: ex.id,
      question: ex.question,
      answer: ex.answer,
      done: true,
      stopped: ex.done === true ? ex.stopped === true : true,
      error: isRecord(ex.error) && typeof ex.error.kind === 'string' ? (ex.error as FreeErrorInfo) : null,
    }));
  } catch {
    return [];
  }
}

export function loadFreeThread(userId: string): FreeExchange[] {
  try {
    return parseFreeThread(sessionStorage.getItem(FREE_THREAD_SESSION_KEY), userId);
  } catch {
    return [];
  }
}

export function saveFreeThread(userId: string, exchanges: readonly FreeExchange[]): void {
  try {
    if (!userId || exchanges.length === 0) sessionStorage.removeItem(FREE_THREAD_SESSION_KEY);
    else sessionStorage.setItem(FREE_THREAD_SESSION_KEY, JSON.stringify({ user: userId, exchanges: exchanges.slice(-FREE_THREAD_KEEP) }));
  } catch {
    /* private mode */
  }
}

// ---------------------------------------------------------------------------
// The start screen and the answer (2026-10-20, design F1)
// ---------------------------------------------------------------------------

/** One ready question: its test id and its key under `ws.assistantFree.`. */
export interface FreeStarter {
  id: string;
  key: string;
}

/** The six topic cards, in the Breakdown tones (`.tp-starter[data-tone]`). */
export const FREE_TOPICS: readonly { key: 'till' | 'courts' | 'shift' | 'problems' | 'stock' | 'settings'; tone: 'green' | 'violet' | 'teal' | 'rose' | 'sky' | 'gold'; questions: readonly FreeStarter[] }[] = [
  { key: 'till', tone: 'green', questions: [{ id: 'splitBill', key: 'topics.till.splitBill' }, { id: 'voidItem', key: 'topics.till.voidItem' }] },
  { key: 'courts', tone: 'violet', questions: [{ id: 'moveBooking', key: 'topics.courts.moveBooking' }, { id: 'deposit', key: 'topics.courts.deposit' }] },
  { key: 'shift', tone: 'teal', questions: [{ id: 'break', key: 'starters.break' }, { id: 'tasks', key: 'starters.tasks' }] },
  { key: 'problems', tone: 'rose', questions: [{ id: 'incident', key: 'starters.incident' }, { id: 'printer', key: 'topics.problems.printer' }] },
  { key: 'stock', tone: 'sky', questions: [{ id: 'waste', key: 'topics.stock.waste' }, { id: 'count', key: 'topics.stock.count' }] },
  { key: 'settings', tone: 'gold', questions: [{ id: 'hours', key: 'topics.settings.hours' }, { id: 'addStaff', key: 'topics.settings.addStaff' }] },
];

/**
 * The guide is told to say it cannot see the club's data when asked for a
 * figure (_shared/assistant/free.ts); that sentence, in either language, is
 * what offers the owner "Ask the paid assistant instead".
 */
const NEEDS_DATA_EN = /\b(?:can(?:not|'t|’t)|unable to|don(?:'|’)t have access to)\s+(?:see|access|view)\b[^.\n]{0,60}?\b(?:data|figures|numbers|sales|takings|bookings|records)\b/i;
const NEEDS_DATA_AR = /(?:لا|لن)\s+(?:أستطيع|يمكنني|أرى|أملك)[^.\n]{0,40}?(?:البيانات|بيانات|الأرقام|أرقام|المبيعات|الحجوزات)/;

export function needsData(answer: string): boolean {
  return NEEDS_DATA_EN.test(answer) || NEEDS_DATA_AR.test(answer);
}
