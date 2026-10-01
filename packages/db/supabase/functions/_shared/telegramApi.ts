/**
 * telegramApi — the one Bot API transport for telegram-send, telegram-callback
 * and telegram-diagnose (each used to carry its own `tg()`).
 *
 * Every call has a deadline (TELEGRAM_TIMEOUT_MS, well under the 30 s first
 * claim lease of app.claim_due_telegram, 0035): a stalled api.telegram.org can
 * no longer hold the sender past its lease, after which an overlapping sweep
 * would claim the same rows again.
 *
 * The bot token is part of the URL, and a runtime's fetch error names the URL
 * it failed on; `transport` text is therefore scrubbed of the token before it
 * reaches a log, a stored last_error or the owner's diagnose screen.
 *
 * No `Deno.*`, no supabase-js: the caller passes the token.
 */
import { errorMessage, fetchWithTimeout, isAbortError } from './http.ts';
import type { TgResult } from './telegramDiagnose.ts';

export type { TgResult } from './telegramDiagnose.ts';

/** Per call; the sender also keeps a whole-batch budget under its lease (telegram-send). */
export const TELEGRAM_TIMEOUT_MS = 10_000;

/** A Bot API envelope plus the HTTP status it came with (absent when nothing came back). */
export type TgCall<T> = TgResult<T> & { http_status?: number };

/** `text` with every occurrence of the token replaced, so a URL in an error message cannot leak it. */
export function scrubToken(text: string, token: string): string {
  return token ? text.split(token).join('<token>') : text;
}

/**
 * POST one Bot API method. Never throws: a transport failure (no answer,
 * timeout) comes back as `{ ok: false, transport }`; an answer that is not
 * JSON as `{ ok: false, error_code: <HTTP status>, description: <status text> }`.
 */
export async function tg<T = unknown>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
  timeoutMs: number = TELEGRAM_TIMEOUT_MS,
): Promise<TgCall<T>> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `https://api.telegram.org/bot${token}/${method}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      timeoutMs,
    );
  } catch (e) {
    const why = isAbortError(e) ? `timeout after ${timeoutMs} ms` : scrubToken(errorMessage(e), token);
    return { ok: false, transport: `fetch: ${why}` };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch (e) {
    if (isAbortError(e)) return { ok: false, transport: `fetch: timeout after ${timeoutMs} ms` };
    data = null;
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error_code: res.status, description: res.statusText, http_status: res.status };
  }
  return { ...(data as TgResult<T>), http_status: res.status };
}
