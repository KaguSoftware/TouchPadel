/**
 * The owner's thumbs on a stored answer, the desktop half (0422). What a thumb
 * means, who may be rated and how a row changes live in
 * `@touch/core/assistant/feedback`, shared with the phone; this file holds
 * only what the desktop adds:
 *
 *  - the optimistic write: the messages cache changes at once, the RPC runs,
 *    and on a refusal only that row goes back to the snapshot taken before;
 *  - one write per message at a time: a press while one is in flight is
 *    ignored, so two writes can never cross;
 *  - when the "What was wrong?" field is open.
 *
 * Node-tested against a real QueryClient (feedbackLogic.test.ts).
 */
import { useCallback, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { applyFeedback, canRate, ratingOf, type Rating } from '@touch/core/assistant/feedback';
import { QK, rateMessage, type MessageRow, type RateResult } from './api';

/** The longest note the field takes (the server keeps what it is sent). */
export const NOTE_MAX = 280;

/** What the thumbs show for a stored row, or null when it may not be rated. */
export interface FeedbackView {
  rating: Rating;
  note: string | null;
}

export function feedbackView(row: MessageRow): FeedbackView | null {
  if (!canRate(row)) return null;
  const rating = ratingOf(row.feedback);
  const note = rating === -1 && typeof row.feedback?.note === 'string' && row.feedback.note.trim() !== '' ? row.feedback.note : null;
  return { rating, note };
}

/** A note travels only with a thumbs-down, trimmed, and never empty. */
export function noteFor(rating: Rating, note: string | null | undefined): string | null {
  if (rating !== -1 || typeof note !== 'string') return null;
  const t = note.trim().slice(0, NOTE_MAX);
  return t === '' ? null : t;
}

/**
 * The note field after a press: it opens when the press lands on a
 * thumbs-down (the new rating is -1) and closes on anything else. Escape and
 * sending close it; blur leaves it as it is.
 */
export function noteOpenAfter(next: Rating): boolean {
  return next === -1;
}

/** The note shown as "Noted: …": at most this many characters, then an ellipsis. */
export function shortNote(note: string, max = 60): string {
  const t = note.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export type RateOutcome = 'saved' | 'failed' | 'skipped';

export type RateWrite = (messageId: string, rating: Rating, note: string | null) => Promise<RateResult>;

/**
 * Set one message's thumb in the messages cache, then write it. Resolves
 * 'saved', 'failed' (the row is back as it was) or 'skipped' (a write for
 * this message is still in flight, or the row is not in the cache).
 */
export async function rateInCache(opts: {
  qc: QueryClient;
  conversationId: string;
  messageId: string;
  rating: Rating;
  note?: string | null;
  inFlight: Set<string>;
  write?: RateWrite;
}): Promise<RateOutcome> {
  const { qc, conversationId, messageId, rating, inFlight, write = rateMessage } = opts;
  if (inFlight.has(messageId)) return 'skipped';
  const key = QK.messages(conversationId);
  const row = qc.getQueryData<MessageRow[]>(key)?.find((m) => m.id === messageId);
  if (!row) return 'skipped';
  const snapshot = row.feedback ?? null;
  const note = noteFor(rating, opts.note);
  inFlight.add(messageId);
  qc.setQueryData<MessageRow[]>(key, (rows) => (rows ? applyFeedback(rows, messageId, rating, note) : rows));
  try {
    const saved = await write(messageId, rating, note);
    // The server's word is the record (it may have trimmed the note).
    qc.setQueryData<MessageRow[]>(key, (rows) => (rows ? applyFeedback(rows, messageId, saved.rating, saved.note) : rows));
    return 'saved';
  } catch {
    qc.setQueryData<MessageRow[]>(key, (rows) => (rows ? rows.map((m) => (m.id === messageId ? { ...m, feedback: snapshot } : m)) : rows));
    return 'failed';
  } finally {
    inFlight.delete(messageId);
  }
}

/** The thread's rate function: one identity per conversation, so memoised rows keep theirs. */
export function useRateMessage(conversationId: string | null) {
  const qc = useQueryClient();
  const inFlight = useRef(new Set<string>());
  return useCallback(
    (messageId: string, rating: Rating, note?: string | null): Promise<RateOutcome> =>
      conversationId ? rateInCache({ qc, conversationId, messageId, rating, note, inFlight: inFlight.current }) : Promise.resolve('skipped'),
    [qc, conversationId],
  );
}
