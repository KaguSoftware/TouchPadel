/**
 * How a stored assistant turn ended, for the thread on both apps.
 *
 * assistant-chat stores, on every assistant message, `tokens.stop_reason` and,
 * when the turn failed, `tokens.error_code` (persist.ts). The clients read the
 * two through `turnOutcome` and say it in the reader's language, instead of
 * showing a failed or cut-short turn as a finished answer.
 *
 *   stop_reason   end_turn | job_proposed | max_tokens | refusal | stopped |
 *                 cost_capped | rounds_exhausted (the last two already carry
 *                 the server's own closing sentence in the text)
 *   error_code    TIMEOUT | UPSTREAM | RATE_LIMITED | NOT_CONFIGURED
 *
 * Rows stored before these fields existed have neither. A failed turn with no
 * text was then stored as the literal text "[CODE] sentence"; `turnOutcome`
 * still reads that shape and `outcomeText` hides it.
 *
 * Pure: no imports.
 */

export const TURN_ERROR_CODES = ['TIMEOUT', 'UPSTREAM', 'RATE_LIMITED', 'NOT_CONFIGURED'] as const;
export type TurnErrorCode = (typeof TURN_ERROR_CODES)[number];

export type TurnOutcome =
  /** A finished answer (also one the cost ceiling or the round limit closed with its own sentence). */
  | { kind: 'ok' }
  /** The turn ended with a job estimate. */
  | { kind: 'job_proposed' }
  /** The owner pressed Stop or left; the text is what had arrived. */
  | { kind: 'stopped' }
  /** The answer hit the output limit mid-sentence; the text is incomplete. */
  | { kind: 'cut_short' }
  /** The model declined to answer. */
  | { kind: 'refused' }
  /** The turn failed; the text, if any, is what had arrived. */
  | { kind: 'error'; code: TurnErrorCode };

const LEGACY_ERROR_RE = /^\[(TIMEOUT|UPSTREAM|RATE_LIMITED|NOT_CONFIGURED)\] [^\n]*$/;

function asErrorCode(v: unknown): TurnErrorCode | null {
  return typeof v === 'string' && (TURN_ERROR_CODES as readonly string[]).includes(v) ? (v as TurnErrorCode) : null;
}

/** The outcome of a stored assistant message from its `tokens` and its text. Anything unknown is `ok`. */
export function turnOutcome(tokens: unknown, text: string): TurnOutcome {
  const t = tokens && typeof tokens === 'object' && !Array.isArray(tokens) ? (tokens as { stop_reason?: unknown; error_code?: unknown }) : {};
  const code = asErrorCode(t.error_code);
  if (code) return { kind: 'error', code };
  const legacy = LEGACY_ERROR_RE.exec(text.trim());
  if (legacy) return { kind: 'error', code: legacy[1] as TurnErrorCode };
  switch (t.stop_reason) {
    case 'stopped':
      return { kind: 'stopped' };
    case 'max_tokens':
      return { kind: 'cut_short' };
    case 'refusal':
      return { kind: 'refused' };
    case 'job_proposed':
      return { kind: 'job_proposed' };
    default:
      return { kind: 'ok' };
  }
}

/** The text to draw for a stored assistant message: the legacy "[CODE] sentence" placeholder is not an answer. */
export function outcomeText(text: string): string {
  return LEGACY_ERROR_RE.test(text.trim()) ? '' : text;
}
