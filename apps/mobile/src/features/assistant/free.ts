/**
 * The free assistant on the phone, as pure logic (vitest): the pages a person
 * can open (sent with every question), the request body, the sentence each
 * refusal lands on, and the "Open …" buttons an answer earns. The contract is
 * `@touch/core/assistant/free` (owner call 2026-10-16: every staff role gets
 * this one and only this one; the owner may pick it as "The free AI"); the
 * reducer that folds the `assistant-free` stream into one turn and the refusal
 * codes are `@touch/core/assistant/free-client`, re-exported here for the
 * screen.
 *
 * It reads no business data: navigation and how-to only. Nothing is stored
 * server-side, so the thread lives in the screen and is sent back as history.
 *
 * PURE: no react-native, no expo.
 */
import { rolesOf, type StaffAccess } from '@touch/core';
import {
  FREE_PAGES_MAX,
  FREE_PAGE_LABEL_MAX,
  FREE_TEXT_MAX,
  MOBILE_STAFF_ROUTE,
  freeHistory,
  mobileRoutesIn,
  type FreeAskBody,
  type FreePageHint,
} from '@touch/core/assistant/free';
import { freeTurnsOf, type FreeError, type FreeLiveTurn } from '@touch/core/assistant/free-client';
import type { MessageKey } from '@touch/i18n';
import { staffRows } from '../staff/rows';

export { applyFreeEvent, freeTurn } from '@touch/core/assistant/free-client';
export type { FreeError, FreeLiveTurn } from '@touch/core/assistant/free-client';

// ── Pages ───────────────────────────────────────────────────────────────────

const oneLine = (s: string): string =>
  s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The staff pages this person can open, in their language: Today first, then
 * Today's rows for their jobs, a second job's too (`staffRows`, 0345), once each, at most
 * FREE_PAGES_MAX. A route the server would drop (not `/staff[-words]`) or an
 * empty label is left out here.
 */
export function freePages(who: StaffAccess, label: (key: MessageKey) => string): FreePageHint[] {
  const out: FreePageHint[] = [];
  const add = (route: string, key: MessageKey) => {
    if (out.length >= FREE_PAGES_MAX) return;
    if (!MOBILE_STAFF_ROUTE.test(route) || out.some((p) => p.route === route)) return;
    const text = oneLine(label(key)).slice(0, FREE_PAGE_LABEL_MAX);
    if (text !== '') out.push({ route, label: text });
  };
  add('/staff', 'staff.shell.today.title');
  for (const row of staffRows(who.role, rolesOf(who).slice(1))) add(row.href, row.labelKey);
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
/** Errors that name the assistant have their own "Touch AI" wording for every role but the owner. */
const TOUCH_ERRORS = ['day', 'busy', 'notConfigured', 'forbidden', 'generic'];
export function forRole(key: MessageKey, ns: 'free' | 'touch'): MessageKey {
  if (ns === 'free') return key;
  const m = /^staff\.assistant\.free\.errors\.(\w+)$/.exec(key);
  const name = m?.[1];
  return name && TOUCH_ERRORS.includes(name) ? (`staff.assistant.touch.errors.${name}` as MessageKey) : key;
}

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
