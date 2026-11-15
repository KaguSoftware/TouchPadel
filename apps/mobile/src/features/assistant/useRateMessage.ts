/**
 * The thumbs' write, optimistic. A press changes the row in the messages cache
 * at once (`applyFeedback`), then calls `rateMessage`; on failure only THAT
 * row goes back to what it was and `onFailed` says so quietly (the screen's
 * toast). While a message's write is in flight a second press on it is
 * ignored, so two conflicting writes can never be sent or land out of order.
 * The returned function keeps one identity (the rows are memoised on it).
 */
import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { applyFeedback, nextRating, ratingOf } from '@touch/core/assistant/feedback';
import { captureException } from '../../lib/telemetry';
import { assistantKeys, rateMessage } from './api';
import type { MessageRow } from './chat';

export function useRateMessage(conversationId: string | null, onFailed: () => void) {
  const qc = useQueryClient();
  const inFlight = useRef(new Set<string>());
  const failed = useRef(onFailed);
  failed.current = onFailed;

  return useCallback(
    (messageId: string, pressed: 1 | -1) => {
      if (!conversationId || inFlight.current.has(messageId)) return;
      const key = assistantKeys.messages(conversationId);
      const row = qc.getQueryData<MessageRow[]>(key)?.find((m) => m.id === messageId);
      if (!row) return;
      const before = ratingOf(row.feedback);
      const beforeFeedback = row.feedback ?? null;
      const next = nextRating(before, pressed);
      inFlight.current.add(messageId);
      qc.setQueryData<MessageRow[]>(key, (rows) => (rows ? applyFeedback(rows, messageId, next) : rows));
      rateMessage(messageId, next)
        .catch((err: unknown) => {
          captureException(err, { scope: 'assistant.rate' });
          qc.setQueryData<MessageRow[]>(key, (rows) =>
            rows
              ? rows.map((m) => (m.id === messageId ? { ...m, feedback: beforeFeedback } : m))
              : rows,
          );
          failed.current();
        })
        .finally(() => {
          inFlight.current.delete(messageId);
        });
    },
    [qc, conversationId],
  );
}
