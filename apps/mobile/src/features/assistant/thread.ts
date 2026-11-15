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

/** The live turn as the phone keeps it: the shared reducer's turn plus what only this client knows. */
export type PhoneLiveTurn = LiveTurn & {
  /** The stored message ids this chat already had when the question was sent (useAssistantChat). */
  knownIds?: readonly string[];
};

export interface Merged {
  /** The stored rows to draw (the live turn's own question is not among them). */
  rows: MessageRow[];
  /** Draw the live turn after them. */
  showLive: boolean;
}

/**
 * The stored rows of a turn that ended before the stream gave its ids
 * (`message_start` never arrived: the connection dropped, or Stop came first)
 * though the server stored it: the first stored user row that was not there
 * when the question was sent and has the same words, and the assistant row
 * right after it. Same idea as the operator's `liveRowIds` (`knownIds`).
 */
function storedOwnRows(
  stored: readonly MessageRow[],
  live: PhoneLiveTurn,
): { userIdx: number; assistantStored: boolean } {
  const known = new Set(live.knownIds ?? []);
  const userIdx =
    live.userMessageId !== null
      ? stored.findIndex((m) => m.id === live.userMessageId)
      : // By words only when the ids the chat already had are known; without them an older
        // identical question could be taken for this one.
        live.knownIds === undefined
        ? -1
        : stored.findIndex(
            (m) => m.role === 'user' && !known.has(m.id) && textOfContent(m.content) === live.userText,
          );
  if (userIdx < 0) return { userIdx, assistantStored: false };
  const next = stored[userIdx + 1];
  const assistantStored =
    live.assistantMessageId !== null
      ? stored.some((m) => m.id === live.assistantMessageId)
      : !!next && next.role === 'assistant' && !known.has(next.id);
  return { userIdx, assistantStored };
}

/**
 * Stored rows and the live turn as one thread.
 *
 *  - No live turn: the stored rows.
 *  - The live turn's assistant row is stored (any ending: done, failed, stopped),
 *    found by its id, or, for a turn that ended before any id arrived, by the
 *    new user row with the same words and the assistant row after it: the
 *    stored rows tell the whole turn, the live turn is retired. (Otherwise the
 *    question showed twice, the second with an "Ask again" that bills again.)
 *  - Otherwise the live turn is drawn, and its question is dropped from the
 *    stored rows if it is already there: by its message id, else by the same
 *    words among the rows that are new, else the trailing user row with the
 *    same text.
 */
export function mergeThread(stored: readonly MessageRow[], live: PhoneLiveTurn | null): Merged {
  if (live === null) return { rows: [...stored], showLive: false };
  if (live.assistantMessageId !== null && stored.some((m) => m.id === live.assistantMessageId)) {
    return { rows: [...stored], showLive: false };
  }
  const own = storedOwnRows(stored, live);
  if (live.done && own.assistantStored) return { rows: [...stored], showLive: false };
  if (own.userIdx >= 0) return { rows: stored.filter((_, i) => i !== own.userIdx), showLive: true };
  const last = stored[stored.length - 1];
  if (last && last.role === 'user' && !(live.knownIds ?? []).includes(last.id) && textOfContent(last.content) === live.userText) {
    return { rows: stored.slice(0, -1), showLive: true };
  }
  return { rows: [...stored], showLive: true };
}

/**
 * Whether asking the same question again can help. Not for a refusal the owner
 * must fix first (sign-in, role, no AI key, the cap, the daily limit, an
 * unpriced model, a malformed question): the button would only spend a
 * request. NOT_SAVED offers it: the answer was written but not stored, and
 * asking again is the only way to have it in the chat. The operator's
 * `canAskAgain`, plus NOT_CONFIGURED (nothing was asked, and nothing changes by asking).
 */
export function canAskAgain(code: AssistantErrorCode | 'CONNECTION'): boolean {
  switch (code) {
    case 'AUTH_REQUIRED':
    case 'FORBIDDEN':
    case 'NOT_CONFIGURED':
    case 'LLM_DAILY_QUOTA':
    case 'LLM_MONTHLY_CAP':
    case 'ASSISTANT_MODEL_NOT_PRICED':
    case 'INVALID_REQUEST':
      return false;
    default:
      return true;
  }
}

/** The ending's own answer to "may the owner ask again": only a failure can, and only when it is worth it. */
export function endingAllowsRetry(ending: Ending | null | undefined): boolean {
  if (!ending) return false;
  if (ending.kind === 'connection') return true;
  return ending.kind === 'error' && canAskAgain(ending.code);
}

/**
 * The question an "Ask again" on a stored row re-sends: only the LAST row of the
 * thread, when it failed in a way asking again can mend, and only with no live turn in front of it.
 */
export function retryTextFor(rows: readonly MessageRow[], index: number): string | null {
  if (index !== rows.length - 1) return null;
  const row = rows[index];
  const prev = rows[index - 1];
  if (!row || row.role !== 'assistant' || !prev || prev.role !== 'user') return null;
  return endingAllowsRetry(storedEnding(row)) ? textOfContent(prev.content) : null;
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
