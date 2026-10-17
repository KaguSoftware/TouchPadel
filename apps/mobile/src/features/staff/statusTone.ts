/**
 * One set of status words and colours on every staff list (Sait, 2026-10-17):
 * Waiting is amber, Approved and Done green, Declined red, Withdrawn and
 * Cancelled grey. Each list's own status values fold onto these; a value that
 * means something only on its page ("Changes asked", "Live", "Scheduled")
 * keeps its page's word and gets no shared one here.
 *
 * PURE (vitest): types only from the Tag's file.
 */
import type { MessageKey } from '@touch/i18n';
import type { TagTone } from './checklists/parts';

export type StatusWord = 'waiting' | 'approved' | 'done' | 'declined' | 'withdrawn' | 'cancelled';

const WORD: Readonly<Record<string, StatusWord>> = {
  // Waiting on someone: a request, a line, a step or a delivery not yet answered.
  pending: 'waiting',
  waiting: 'waiting',
  open: 'waiting',
  submitted: 'waiting',
  to_receive: 'waiting',
  approved: 'approved',
  declined: 'declined',
  rejected: 'declined',
  done: 'done',
  passed: 'done',
  received: 'done',
  withdrawn: 'withdrawn',
  cancelled: 'cancelled',
};

export const STATUS_TONE: Readonly<Record<StatusWord, TagTone>> = {
  waiting: 'warn',
  approved: 'good',
  done: 'good',
  declined: 'bad',
  withdrawn: 'plain',
  cancelled: 'plain',
};

/** The shared word for a list's status, or null when the page keeps its own. */
export function statusWord(status: string): StatusWord | null {
  return WORD[status] ?? null;
}

/** The Tag tone: the shared one when there is a shared word, else the page's `fallback`. */
export function statusTone(status: string, fallback: TagTone = 'plain'): TagTone {
  const word = statusWord(status);
  return word ? STATUS_TONE[word] : fallback;
}

/** The label key: the shared word when there is one, else the page's own key. */
export function statusLabelKey(status: string, own: MessageKey): MessageKey {
  const word = statusWord(status);
  return word ? (`staff.shell.status.${word}` as MessageKey) : own;
}
