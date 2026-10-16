/**
 * Opens one of Today's queues from inside another one. "Needs you" holds the
 * online refunds, the lesson money and the player reports as rows that open
 * in place; a lesson whose online share Qi could not take back links to the
 * online refunds (coaching LessonRefundsDue's OnlineRefundsLink). On Today that
 * link opens the online refunds row and brings it into view, rather than
 * scrolling to a panel that is folded away. Anywhere else there is no opener
 * and the link keeps its own way there.
 *
 * Its own module with no imports beyond React, so coaching can read it without
 * a cycle through the ops screen that renders coaching's rows.
 */
import { createContext, useContext } from 'react';

export type QueueKey = 'deposits' | 'lessonRefunds' | 'matchReports';

export const QueueOpenerContext = createContext<((key: QueueKey) => void) | null>(null);

/** Today's opener, or null outside it. */
export function useQueueOpener(): ((key: QueueKey) => void) | null {
  return useContext(QueueOpenerContext);
}
