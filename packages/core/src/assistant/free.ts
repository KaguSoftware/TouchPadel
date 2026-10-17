/**
 * The free assistant (owner call 2026-10-16): a guide to the app on Groq's
 * free tier, for every staff role and for the owner who picks "The free AI".
 * It finds pages and explains how to do things; it reads no business data,
 * stores nothing and never reaches a paid model. Staff get this one and only
 * this one, in the operator and on the phone.
 *
 * The edge function is `assistant-free`
 * (packages/db/supabase/functions/assistant-free); its pure half,
 * `_shared/assistant/free.ts`, repeats the limits below (Deno cannot import a
 * workspace package) and a parity test pins the two.
 *
 * Request  POST { text, lang, app, route?, history?, pages? }  (FreeAskBody)
 * Response text/event-stream: `message_start {model, free: true}`,
 *          `delta {text}`, `done {stop_reason}`, `error {code, message}`.
 *          Refusals before the stream are JSON: 400 INVALID_REQUEST,
 *          401 AUTH_REQUIRED, 403 FORBIDDEN, 429 RATE_LIMITED,
 *          503 NOT_CONFIGURED.
 *
 * Pure: no imports.
 */

/** The edge function's name. */
export const FREE_ASSISTANT_FN = 'assistant-free';

/**
 * The value the owner's model switch holds when "The free AI" is chosen. Not a
 * model id: the paid chat never sees it, the client sends the question to
 * FREE_ASSISTANT_FN instead.
 */
export const FREE_MODEL_CHOICE = '__free__';

/** The longest question, in characters. */
export const FREE_TEXT_MAX = 1000;
/** Earlier turns sent with a question (the client keeps the thread; nothing is stored). */
export const FREE_HISTORY_MAX = 6;
/** Each earlier turn is cut to this many characters. */
export const FREE_HISTORY_TEXT_MAX = 800;
/** The phone sends the pages its person can open; at most this many. */
export const FREE_PAGES_MAX = 60;
export const FREE_PAGE_LABEL_MAX = 80;

export type FreeApp = 'operator' | 'mobile';

export interface FreeTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** One page the phone offers its person: a staff route and its label in the person's language. */
export interface FreePageHint {
  route: string;
  label: string;
}

export interface FreeAskBody {
  text: string;
  lang: 'en' | 'ar';
  app: FreeApp;
  /** The page the question was asked from, if any. */
  route?: string | null;
  history?: FreeTurn[];
  /** Phone only: the pages this person can open (the operator's come from the server's map). */
  pages?: FreePageHint[];
}

/** The last FREE_HISTORY_MAX finished turns, each cut to FREE_HISTORY_TEXT_MAX, empty ones dropped. */
export function freeHistory(turns: readonly FreeTurn[]): FreeTurn[] {
  return turns
    .filter((t) => t.text.trim().length > 0)
    .slice(-FREE_HISTORY_MAX)
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, FREE_HISTORY_TEXT_MAX) }));
}

/** A phone staff route the free assistant may name: `/staff` or `/staff-<words>`. */
export const MOBILE_STAFF_ROUTE = /^\/staff(?:-[a-z]+)*$/;

/**
 * The phone routes an answer names, in order, once each, that are in `known`
 * (the pages sent with the question). At most `max`.
 */
export function mobileRoutesIn(text: string, known: readonly string[], max = 3): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w/:.])\/staff(?:-[a-z]+)*/g)) {
    const route = m[0];
    if (out.includes(route) || !known.includes(route)) continue;
    out.push(route);
    if (out.length === max) break;
  }
  return out;
}
