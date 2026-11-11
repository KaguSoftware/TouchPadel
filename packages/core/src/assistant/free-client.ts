/**
 * The free assistant's client half (owner call 2026-10-16; the contract is
 * `./free`): the refusal codes `assistant-free` sends, a JSON refusal read
 * into one `FreeError`, and the reducer that folds the stream's
 * `message_start` / `delta` / `done` / `error` events into one turn. The apps
 * keep the I/O and the sentences (the phone's `free.ts`, the operator's
 * `FreeThread`); nothing here is stored server-side, so the thread lives in
 * the screen and goes back as `history` (`freeTurnsOf` → `freeHistory`).
 *
 * Pure: imports only its siblings in this folder (no DOM, no fetch).
 */
import { bodyCode } from './client';
import type { FreeTurn } from './free';

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export const FREE_ERROR_CODES = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'INVALID_REQUEST',
  'NOT_CONFIGURED',
  'RATE_LIMITED',
  'UPSTREAM',
  'TIMEOUT',
  'UNKNOWN',
] as const;
export type FreeErrorCode = (typeof FREE_ERROR_CODES)[number];

export interface FreeError {
  code: FreeErrorCode;
  /** RATE_LIMITED only: whose allowance ran out. */
  scope?: 'minute' | 'day' | 'club';
  /** RATE_LIMITED only: when to ask again, in seconds. */
  retryAfterS?: number;
}

export function asFreeErrorCode(code: unknown): FreeErrorCode {
  return typeof code === 'string' && (FREE_ERROR_CODES as readonly string[]).includes(code)
    ? (code as FreeErrorCode)
    : 'UNKNOWN';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** A JSON refusal before the stream: its own code first, then the HTTP class. */
export function freeRefusal(status: number, body: unknown): FreeError {
  let code = asFreeErrorCode(bodyCode(body));
  if (code === 'UNKNOWN') {
    if (status === 401) code = 'AUTH_REQUIRED';
    else if (status === 403) code = 'FORBIDDEN';
    else if (status === 429) code = 'RATE_LIMITED';
    // A bare 503 is the platform failing, not a missing key: assistant-free
    // always says NOT_CONFIGURED in the body when the key is the problem, and
    // the body code is read first (operator parity, 2026-11-11).
    else if (status >= 500) code = 'UPSTREAM';
    else if (status === 400 || status === 413) code = 'INVALID_REQUEST';
  }
  if (code !== 'RATE_LIMITED') return { code };
  const b = isRecord(body) ? body : {};
  const scope = b.scope === 'minute' || b.scope === 'day' || b.scope === 'club' ? b.scope : undefined;
  const s = typeof b.retry_after_s === 'number' && Number.isFinite(b.retry_after_s) ? b.retry_after_s : null;
  return {
    code,
    ...(scope ? { scope } : {}),
    ...(s !== null && s > 0 ? { retryAfterS: Math.ceil(s) } : {}),
  };
}

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------

/** One question and its answer, as the screen holds it. */
export interface FreeLiveTurn {
  id: number;
  question: string;
  text: string;
  done: boolean;
  stopped: boolean;
  error: FreeError | null;
}

export function freeTurn(id: number, question: string): FreeLiveTurn {
  return { id, question, text: '', done: false, stopped: false, error: null };
}

/** Apply one SSE event (`message_start`, `delta`, `done`, `error`) to a turn. */
export function applyFreeEvent(turn: FreeLiveTurn, name: string, data: unknown): FreeLiveTurn {
  const d = isRecord(data) ? data : {};
  switch (name) {
    case 'delta':
      return typeof d.text === 'string' ? { ...turn, text: turn.text + d.text } : turn;
    case 'error':
      return { ...turn, done: true, error: turn.error ?? { code: asFreeErrorCode(d.code) } };
    case 'done':
      return { ...turn, done: true };
    default:
      return turn;
  }
}

/** The earlier turns worth sending back: questions with a whole answer, in order. */
export function freeTurnsOf(turns: readonly FreeLiveTurn[]): FreeTurn[] {
  const out: FreeTurn[] = [];
  for (const t of turns) {
    if (!t.done || t.error || t.stopped || t.text.trim() === '') continue;
    out.push({ role: 'user', text: t.question }, { role: 'assistant', text: t.text });
  }
  return out;
}
