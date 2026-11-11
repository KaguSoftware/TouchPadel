/**
 * What the thread draws, as pure logic (vitest): how each turn ended, and how
 * the live turn and the stored rows merge into one list without a turn
 * appearing twice. The record is the database; the live turn is only the part
 * not stored yet.
 */
import { turnOutcome, type TurnOutcome } from '@touch/core/assistant/outcome';
import type { AssistantErrorCode, AssistantSentenceCode, LiveTurn } from '@touch/core/assistant/client';
import { sourcesOf, textOfContent, type MessageRow } from './chat';

/** How a turn ended, as the note under it says. `connection` is the phone's own: the stream was lost. */
export type Ending =
  | Exclude<TurnOutcome, { kind: 'error' }>
  | { kind: 'error'; code: AssistantErrorCode }
  | { kind: 'connection' };

const OK: Ending = { kind: 'ok' };

/** A stored assistant row's ending. A row whose sources carry a job id is a job's RESULT, not a proposal. */
export function storedEnding(m: Pick<MessageRow, 'tokens' | 'content' | 'sources'>): Ending {
  const o = turnOutcome(m.tokens, textOfContent(m.content));
  if (o.kind === 'job_proposed' && sourcesOf(m.sources).jobIds.length > 0) return OK;
  return o;
}

/** What the live end of the stream tells besides the reducer's state: `done`'s stop_reason, a lost stream. */
export interface LiveEnd {
  stopReason: string | null;
  lost: boolean;
}

export const NO_END: LiveEnd = { stopReason: null, lost: false };

/** The live turn's ending; `ok` while it is still streaming. */
export function liveEnding(live: Pick<LiveTurn, 'done' | 'stopped' | 'error' | 'jobEstimate'>, end: LiveEnd): Ending {
  if (!live.done) return OK;
  if (live.error) return end.lost ? { kind: 'connection' } : { kind: 'error', code: live.error.code };
  if (end.lost) return { kind: 'connection' };
  if (live.stopped) return { kind: 'stopped' };
  switch (end.stopReason) {
    case 'stopped':
      return { kind: 'stopped' };
    case 'max_tokens':
      return { kind: 'cut_short' };
    case 'refusal':
      return { kind: 'refused' };
    case 'job_proposed':
      return { kind: 'job_proposed' };
    default:
      return live.jobEstimate !== null ? { kind: 'job_proposed' } : OK;
  }
}

export interface Merged {
  /** The stored rows to draw (the live turn's own question is not among them). */
  rows: MessageRow[];
  /** Draw the live turn after them. */
  showLive: boolean;
}

/**
 * Stored rows and the live turn as one thread.
 *
 *  - No live turn: the stored rows.
 *  - The live turn's assistant row is stored (any ending: done, failed, stopped):
 *    the stored rows tell the whole turn, the live turn is retired.
 *  - Otherwise the live turn is drawn, and its question is dropped from the
 *    stored rows if it is already there: by its message id, else the trailing
 *    user row with the same text (a turn that failed before any id arrived).
 */
export function mergeThread(stored: readonly MessageRow[], live: LiveTurn | null): Merged {
  if (live === null) return { rows: [...stored], showLive: false };
  if (live.assistantMessageId !== null && stored.some((m) => m.id === live.assistantMessageId)) {
    return { rows: [...stored], showLive: false };
  }
  const byId = live.userMessageId !== null ? stored.findIndex((m) => m.id === live.userMessageId) : -1;
  if (byId >= 0) return { rows: stored.filter((_, i) => i !== byId), showLive: true };
  const last = stored[stored.length - 1];
  if (last && last.role === 'user' && textOfContent(last.content) === live.userText) {
    return { rows: stored.slice(0, -1), showLive: true };
  }
  return { rows: [...stored], showLive: true };
}

/**
 * The question an "Ask again" on a stored row re-sends: only the LAST row of the
 * thread, when it failed, and only with no live turn in front of it.
 */
export function retryTextFor(rows: readonly MessageRow[], index: number): string | null {
  if (index !== rows.length - 1) return null;
  const row = rows[index];
  const prev = rows[index - 1];
  if (!row || row.role !== 'assistant' || !prev || prev.role !== 'user') return null;
  return storedEnding(row).kind === 'error' ? textOfContent(prev.content) : null;
}

/** The `staff.assistant.errors.*` key suffix for an ending that failed. */
export function endingErrorKey(code: AssistantErrorCode | 'CONNECTION'): AssistantSentenceCode | 'CONNECTION' {
  switch (code) {
    case 'NOT_FOUND':
    case 'INTERNAL':
    case 'INVALID_TRANSITION':
      return 'UNKNOWN';
    default:
      return code;
  }
}
