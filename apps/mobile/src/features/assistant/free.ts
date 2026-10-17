/**
 * The free assistant on the phone, as pure logic (vitest): the pages a person
 * can open (sent with every question), the request body, the event table the
 * `assistant-free` edge function streams folded into one turn, the refusals
 * and the sentence each one lands on, and the "Open …" buttons an answer
 * earns. The contract is `@touch/core/assistant/free` (owner call 2026-10-16:
 * every staff role gets this one and only this one; the owner may pick it as
 * "The free AI").
 *
 * It reads no business data: navigation and how-to only. Nothing is stored
 * server-side, so the thread lives in the screen and is sent back as history.
 *
 * PURE: no react-native, no expo.
 */
import type { StaffRole } from '@touch/core';
import {
  FREE_PAGES_MAX,
  FREE_PAGE_LABEL_MAX,
  FREE_TEXT_MAX,
  MOBILE_STAFF_ROUTE,
  freeHistory,
  mobileRoutesIn,
  type FreeAskBody,
  type FreePageHint,
  type FreeTurn,
} from '@touch/core/assistant/free';
import type { MessageKey } from '@touch/i18n';
import { staffRows } from '../staff/rows';
import { bodyCode } from './chat';

// ── Pages ───────────────────────────────────────────────────────────────────

const oneLine = (s: string): string =>
  s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The staff pages this role can open, in the person's language: Today first,
 * then Today's rows for the role (`staffRows`), once each, at most
 * FREE_PAGES_MAX. A route the server would drop (not `/staff[-words]`) or an
 * empty label is left out here.
 */
export function freePages(role: StaffRole, label: (key: MessageKey) => string): FreePageHint[] {
  const out: FreePageHint[] = [];
  const add = (route: string, key: MessageKey) => {
    if (out.length >= FREE_PAGES_MAX) return;
    if (!MOBILE_STAFF_ROUTE.test(route) || out.some((p) => p.route === route)) return;
    const text = oneLine(label(key)).slice(0, FREE_PAGE_LABEL_MAX);
    if (text !== '') out.push({ route, label: text });
  };
  add('/staff', 'staff.shell.today.title');
  for (const row of staffRows(role)) add(row.href, row.labelKey);
  return out;
}

/**
 * The page the question was asked from (the button's `from` param): a staff
 * route, not the assistant's own; anything else is no page.
 */
export function freeFrom(param: unknown): string | null {
  const raw = Array.isArray(param) ? param[0] : param;
  if (typeof raw !== 'string') return null;
  const route = raw.replace(/[?#].*$/, '').trim();
  if (!MOBILE_STAFF_ROUTE.test(route) || route.startsWith('/staff-assistant')) return null;
  return route;
}

// ── The thread ──────────────────────────────────────────────────────────────

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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

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

/** The request body for one question (`FreeAskBody`, app 'mobile'). */
export function buildFreeBody(args: {
  text: string;
  lang: 'en' | 'ar';
  route: string | null;
  earlier: readonly FreeLiveTurn[];
  pages: readonly FreePageHint[];
}): FreeAskBody {
  const history = freeHistory(freeTurnsOf(args.earlier));
  return {
    text: args.text.trim().slice(0, FREE_TEXT_MAX),
    lang: args.lang,
    app: 'mobile',
    ...(args.route ? { route: args.route } : {}),
    ...(history.length > 0 ? { history } : {}),
    pages: args.pages.slice(0, FREE_PAGES_MAX).map((p) => ({ route: p.route, label: p.label })),
  };
}

// ── Refusals ────────────────────────────────────────────────────────────────

/** A JSON refusal before the stream: its own code first, then the HTTP class. */
export function freeRefusal(status: number, body: unknown): FreeError {
  let code = asFreeErrorCode(bodyCode(body));
  if (code === 'UNKNOWN') {
    if (status === 401) code = 'AUTH_REQUIRED';
    else if (status === 403) code = 'FORBIDDEN';
    else if (status === 429) code = 'RATE_LIMITED';
    else if (status === 503) code = 'NOT_CONFIGURED';
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

/** A refusal that arrives as a thrown value. */
export class FreeStreamError extends Error {
  readonly info: FreeError;
  constructor(info: FreeError, message?: string) {
    super(message ?? info.code);
    this.name = 'FreeStreamError';
    this.info = info;
  }
}

export type FreeErrorMessage =
  | { kind: 'minute'; seconds: number }
  | { kind: 'text'; key: MessageKey };

/**
 * What the person reads for a refusal, and whether "Try again" makes sense
 * (asking again cannot help a used-up day, a missing key, a refused role or a
 * question the server would not take).
 */
export function freeErrorMessage(err: FreeError): { message: FreeErrorMessage; retry: boolean } {
  const text = (key: MessageKey, retry: boolean) => ({ message: { kind: 'text' as const, key }, retry });
  switch (err.code) {
    case 'RATE_LIMITED':
      if (err.scope === 'day') return text('staff.assistant.free.errors.day', false);
      if (err.scope === 'minute') {
        return { message: { kind: 'minute', seconds: Math.max(1, err.retryAfterS ?? 60) }, retry: true };
      }
      return text('staff.assistant.free.errors.busy', true);
    case 'NOT_CONFIGURED':
      return text('staff.assistant.free.errors.notConfigured', false);
    case 'AUTH_REQUIRED':
      return text('staff.assistant.free.errors.auth', false);
    case 'FORBIDDEN':
      return text('staff.assistant.free.errors.forbidden', false);
    case 'INVALID_REQUEST':
      return text('staff.assistant.free.errors.invalid', false);
    default:
      return text('staff.assistant.free.errors.generic', true);
  }
}

// ── Answers ─────────────────────────────────────────────────────────────────

/** The pages an answer names, as buttons: at most three, each a page that was sent. */
export function answerPages(text: string, pages: readonly FreePageHint[]): FreePageHint[] {
  return mobileRoutesIn(
    text,
    pages.map((p) => p.route),
  ).map((route) => pages.find((p) => p.route === route)!);
}

/** A route as a testID segment: `/staff-shopping` → `staff-shopping`. */
export function routeSegment(route: string): string {
  return route.replace(/^\//, '');
}

/** The starters on an empty thread: pages every staff role has (requests, suggestions, incidents). */
export const FREE_STARTERS = ['dayOff', 'suggestion', 'incident'] as const;
export type FreeStarter = (typeof FREE_STARTERS)[number];
