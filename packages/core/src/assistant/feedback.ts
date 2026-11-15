/**
 * The owner's thumbs on a stored answer, for both apps (assistant_feedback,
 * migration 0422; written through `app.assistant_rate_message`, where
 * `p_rating = 0` clears). Pure: the screens call these, the data layer writes.
 */
import { sourcesOf, textOfContent } from './client';
import { turnOutcome } from './outcome';

export type Rating = -1 | 0 | 1;

/** The part of a stored row these functions read. */
export interface RateableRow {
  id: string;
  role: 'user' | 'assistant';
  content: unknown;
  sources?: unknown;
  tokens?: unknown;
  feedback?: { rating: number; note?: string | null } | null;
}

/**
 * Only a stored, finished, non-failed answer of the paid assistant can be
 * rated: never a user row, a failed, stopped, cut-short, refused or job-proposal
 * turn, an empty one, or a job's result row (its sources name a job_id).
 * A streaming turn is not a stored row, so it never gets here.
 */
export function canRate(row: RateableRow): boolean {
  if (row.role !== 'assistant' || !row.id) return false;
  const text = textOfContent(row.content);
  if (text.trim() === '') return false;
  if (turnOutcome(row.tokens, text).kind !== 'ok') return false;
  return sourcesOf(row.sources).jobIds.length === 0;
}

/** A stored `feedback` (an embed may arrive as an object or a one-item array) read as -1, 0 or 1. */
export function ratingOf(feedback: RateableRow['feedback'] | readonly unknown[]): Rating {
  const f = Array.isArray(feedback) ? feedback[0] : feedback;
  const r = f && typeof f === 'object' ? (f as { rating?: unknown }).rating : null;
  return r === 1 ? 1 : r === -1 ? -1 : 0;
}

/** What a press means: the chosen thumb again clears (0), anything else sets it. */
export function nextRating(current: Rating, pressed: 1 | -1): Rating {
  return current === pressed ? 0 : pressed;
}

/** New rows with one message's feedback set (rating 0 clears it to null). Other rows keep their identity. */
export function applyFeedback<T extends { id: string; feedback?: { rating: number; note?: string | null } | null }>(
  rows: readonly T[],
  messageId: string,
  rating: Rating,
  note?: string | null,
): T[] {
  return rows.map((r) =>
    r.id !== messageId ? r : { ...r, feedback: rating === 0 ? null : { rating, note: note ?? null } },
  );
}
