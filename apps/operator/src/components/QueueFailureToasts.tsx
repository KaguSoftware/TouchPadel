/**
 * QueueFailureToasts — the moment-of-failure cue for a queued write the server
 * refused later (Phase 2 milestone 0, item 9 / C3).
 *
 * A write that fails while its caller is still waiting (inside mutate()'s
 * 8-second window) is thrown to that caller and shown beside the control that
 * was pressed; queueResults.dispatchResult never re-announces those. This
 * component hears only the OTHER kind: a refund, void, removal or bill close
 * queued on a till that had lost the link and refused minutes later, when the
 * cashier has moved on. It says which write and why, and points at Day close,
 * which lists the row (DayClose.tsx) and is blocked until it is dismissed. The
 * VenueStatusBanner keeps the standing count; this is the three-second cue.
 *
 * Renders nothing. Mounted once inside <ToastProvider> at the root route.
 */
import { useEffect } from 'react';
import type { MessageKey } from '@touch/i18n';
import { useToast } from './toast';
import { useLocale } from '../lib/i18n';
import { errorCodeToMessageKey } from '../lib/errors';
import { onFailedResult, resultErrorCode } from '../lib/queueResults';
import { queueWriteKey } from '../features/admin/dayCloseLogic';

export function QueueFailureToasts() {
  const toast = useToast();
  const { tr } = useLocale();
  useEffect(
    () =>
      onFailedResult((r) => {
        const write = tr(`ws.manager.dayClose.writes.${queueWriteKey(r.mutationType)}` as MessageKey);
        const code = resultErrorCode(r);
        const reasonKey = code ? errorCodeToMessageKey(code) : 'errors.generic';
        toast.err(
          reasonKey === 'errors.generic'
            ? tr('op.queue.refusedGeneric', { write })
            : tr('op.queue.refused', { write, reason: tr(reasonKey) }),
        );
      }),
    [toast, tr],
  );
  return null;
}
