/**
 * The thread's pure half (Thread.tsx renders what these decide; node tests in
 * threadLogic.test.ts):
 *
 *  - how a turn ended (`storedOutcome` for a saved row through
 *    @touch/core/assistant/outcome, `liveOutcome` for the turn still on
 *    screen), in one shape, so the screen does not change when the stored row
 *    replaces the live one;
 *  - when the live turn gives way to its stored rows (`reconcileLive`);
 *  - which stored job estimates still wait for a press, and where each sits.
 */
import { turnOutcome, outcomeText } from '@touch/core/assistant/outcome';
import { assistantErrorSentence, textOfContent, type AssistantErrorCode, type AssistantSentenceCode, type JobEstimate, type LiveTurn, type MessageRow } from '@touch/core/assistant/client';
import type { JobRow } from './api';

/**
 * Every code a turn can end on, here: the shared ones, plus CONNECTION for a
 * stream that broke (closed without `done`, went silent, or the network
 * failed). CONNECTION is the operator's alone: the phone has its own words.
 */
export type ChatErrorCode = AssistantErrorCode | 'CONNECTION';

/** The live turn as the operator keeps it: the shared reducer's turn plus what only this client knows. */
export type ChatTurn = LiveTurn & {
  /** The stream broke before `done`; `error` is set too, and the sentence is CONNECTION's. */
  dropped?: boolean;
  /** The stored message ids this chat already had when the question was sent. */
  knownIds?: readonly string[];
};

export type OutcomeView =
  | { kind: 'ok' }
  | { kind: 'job_proposed' }
  | { kind: 'stopped' }
  | { kind: 'cut_short' }
  | { kind: 'refused' }
  | { kind: 'error'; code: ChatErrorCode };

const OK: OutcomeView = { kind: 'ok' };

/** How a stored assistant row ended. */
export function storedOutcome(row: Pick<MessageRow, 'tokens' | 'content'>): OutcomeView {
  return turnOutcome(row.tokens, textOfContent(row.content));
}

/** The text to draw for a stored assistant row (the legacy "[CODE] sentence" placeholder is not an answer). */
export function storedText(row: Pick<MessageRow, 'content'>): string {
  return outcomeText(textOfContent(row.content));
}

/** The same outcomes for the live turn: from its error, its Stop, or the `done` event's stop_reason. */
export function liveOutcome(live: ChatTurn): OutcomeView {
  if (live.dropped) return { kind: 'error', code: 'CONNECTION' };
  if (live.error) return { kind: 'error', code: live.error.code };
  if (live.stopped) return { kind: 'stopped' };
  if (!live.done) return OK;
  switch (live.stopReason) {
    case 'stopped':
      return { kind: 'stopped' };
    case 'max_tokens':
      return { kind: 'cut_short' };
    case 'refusal':
      return { kind: 'refused' };
    case 'job_proposed':
      return { kind: 'job_proposed' };
    default:
      return OK;
  }
}

/** The catalog key under `ws.owner.assistant.message.errors`. */
export function errorSentenceKey(code: ChatErrorCode): AssistantSentenceCode | 'CONNECTION' {
  return code === 'CONNECTION' ? 'CONNECTION' : assistantErrorSentence(code);
}

/**
 * Whether asking the same question again can help. Not for a refusal the
 * owner must fix first (sign-in, role, the cap, the daily limit, an unpriced
 * model, a malformed question): the button would only spend a request.
 */
export function canAskAgain(code: ChatErrorCode): boolean {
  switch (code) {
    case 'AUTH_REQUIRED':
    case 'FORBIDDEN':
    case 'LLM_DAILY_QUOTA':
    case 'LLM_MONTHLY_CAP':
    case 'ASSISTANT_MODEL_NOT_PRICED':
    case 'INVALID_REQUEST':
      return false;
    default:
      return true;
  }
}

export interface LiveReconciliation {
  /** Draw the live turn (the owner's bubble and the answer) after the stored rows. */
  showLive: boolean;
  /** Stored rows not drawn because the live turn is still drawing them. */
  hiddenRowIds: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The stored rows of the live turn, by the ids the stream sent, or, for a turn
 * stopped or broken before `message_start` (no ids), by the first new user row
 * with the same words and the assistant row after it.
 */
function liveRowIds(live: ChatTurn, rows: readonly MessageRow[]): { user: string | null; assistant: string | null } {
  let user = live.userMessageId;
  let assistant = live.assistantMessageId;
  if (live.done && (user === null || assistant === null)) {
    const known = new Set(live.knownIds ?? []);
    const idx = user !== null ? rows.findIndex((r) => r.id === user) : rows.findIndex((r) => r.role === 'user' && !known.has(r.id) && textOfContent(r.content) === live.userText);
    if (idx !== -1) {
      user = rows[idx]!.id;
      const next = rows[idx + 1];
      if (assistant === null && next && next.role === 'assistant' && !known.has(next.id)) assistant = next.id;
    }
  }
  return { user, assistant };
}

/**
 * The live turn gives way once it has ended and its stored assistant row is in
 * the list, whatever the turn's outcome (a stopped or failed turn is stored
 * too). Until then the stored copies of its rows are hidden, so neither the
 * question nor the answer is drawn twice.
 */
export function reconcileLive(live: ChatTurn | null, rows: readonly MessageRow[]): LiveReconciliation {
  if (!live) return { showLive: false, hiddenRowIds: NONE };
  const ids = new Set(rows.map((r) => r.id));
  const own = liveRowIds(live, rows);
  const storedAnswer = own.assistant !== null && ids.has(own.assistant);
  if (live.done && storedAnswer) return { showLive: false, hiddenRowIds: NONE };
  const hidden = new Set<string>();
  if (own.user !== null && ids.has(own.user)) hidden.add(own.user);
  if (storedAnswer) hidden.add(own.assistant!);
  return { showLive: true, hiddenRowIds: hidden.size > 0 ? hidden : NONE };
}

// ---------------------------------------------------------------------------
// Job estimates
// ---------------------------------------------------------------------------

/** The estimate card's payload from a stored job row. */
export function estimateOf(job: Pick<JobRow, 'id' | 'estimate'>): JobEstimate {
  return { ...job.estimate, job_id: job.id };
}

export interface EstimatePlacement {
  /** Under the stored answer that proposed them. */
  byMessage: ReadonlyMap<string, JobRow[]>;
  /** Their answer is not drawn as a stored row: after the thread. */
  trailing: JobRow[];
}

/**
 * Every stored job still waiting for a press ('estimated') and not put aside
 * with "Not now", placed under the answer that proposed it. The live turn's own
 * estimate is drawn by the live turn, so it is left out here.
 */
export function placeEstimates(jobs: readonly JobRow[], visibleRowIds: ReadonlySet<string>, dismissed: ReadonlySet<string>, liveEstimateId: string | null): EstimatePlacement {
  const byMessage = new Map<string, JobRow[]>();
  const trailing: JobRow[] = [];
  // Oldest first, so two cards under one answer read in the order they came.
  const waiting = jobs.filter((j) => j.status === 'estimated' && !dismissed.has(j.id) && j.id !== liveEstimateId && j.estimate && typeof j.estimate === 'object').sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  for (const j of waiting) {
    if (j.message_id && visibleRowIds.has(j.message_id)) byMessage.set(j.message_id, [...(byMessage.get(j.message_id) ?? []), j]);
    else trailing.push(j);
  }
  return { byMessage, trailing };
}

/**
 * Whether a failed accept may still have started the job: the request timed
 * out or broke at the network level (the server may be running it inside that
 * very request), the gateway gave up on it (502/504), or the server said the
 * job already left 'estimated' (INVALID_TRANSITION, 409 "job is running").
 * Then the screen watches the row instead of calling it a failure; watching
 * a job that never started costs nothing, its card stays pressable.
 */
export function acceptMayHaveStarted(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch failure, RequestTimeoutError, StreamStalledError
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; serverCode?: unknown; name?: unknown };
    if (e.name === 'TimeoutError') return true;
    if (e.serverCode === 'INVALID_TRANSITION' || e.status === 409) return true;
    // The gateway gave up on the request, not the function: it may still be running.
    if (e.status === 502 || e.status === 504) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// "Not now" on an estimate, remembered on this computer
// ---------------------------------------------------------------------------

export const DISMISSED_JOBS_KEY = 'touch-assistant-dismissed-jobs';
const DISMISSED_KEEP = 200;

export function loadDismissedJobs(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_JOBS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveDismissedJobs(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(DISMISSED_JOBS_KEY, JSON.stringify([...ids].slice(-DISMISSED_KEEP)));
  } catch {
    /* private mode: "Not now" lasts this window */
  }
}
