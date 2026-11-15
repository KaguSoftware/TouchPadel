/**
 * The thread's pure half (Thread.tsx renders what these decide; node tests in
 * threadLogic.test.ts):
 *
 *  - how a turn ended (`storedOutcome` for a saved row through
 *    @touch/core/assistant/outcome, `liveOutcome` for the turn still on
 *    screen), in one shape, so the screen does not change when the stored row
 *    replaces the live one;
 *  - when the live turn gives way to its stored rows (`reconcileLive`);
 *  - which stored job estimates still wait for a press, and where each sits;
 *  - a paused job's reason, the parts left and what Continue costs (0410).
 */
import { turnOutcome, outcomeText } from '@touch/core/assistant/outcome';
import { asAssistantErrorCode, assistantErrorSentence, textOfContent, type AssistantErrorCode, type AssistantSentenceCode, type JobEstimate, type LiveTurn, type MessageRow } from '@touch/core/assistant/client';
import { toolByName, type AssistantScope } from '@touch/core/assistant/tools';
import { priceFor, type PricingMap } from '../../lib/assistantPricing';
import type { JobPause, JobPauseReason, JobRow, JobStatus, JobTokenBreakdown } from './api';

/** api.ts TERMINAL_JOB_STATUSES, repeated so this file stays free of the data layer's imports (node tests). */
const ENDED_JOB_STATUSES: readonly JobStatus[] = ['done', 'failed', 'cancelled'];

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
 * NOT_SAVED offers it: the answer was written but not stored, and asking again
 * is the only way to have it in the chat.
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

/**
 * The checked set a new chat's view takes back: a first question failed while
 * the drawer was closed, the reopened drawer forgot its set, and the composer
 * sat locked under the failed turn. Its own question's scopes come back; an
 * existing chat or a set the owner already picked is left alone.
 */
export function scopesToRestore(conversationId: string | null, newScopes: readonly AssistantScope[], lastScopes: readonly AssistantScope[] | null): readonly AssistantScope[] | null {
  return conversationId === null && newScopes.length === 0 && lastScopes && lastScopes.length > 0 ? lastScopes : null;
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

/**
 * The progress line while tools run, in the reader's words: one line per area
 * the running tools read (the scope that owns each tool), never a tool's own
 * name; a tool with no area (web search, a tool this build does not know) is
 * `null`, the generic line. Order of first appearance, no repeats.
 */
export function pendingToolScopes(names: readonly string[]): (AssistantScope | null)[] {
  const out: (AssistantScope | null)[] = [];
  for (const name of names) {
    const scope = toolByName(name)?.scope ?? null;
    if (!out.includes(scope)) out.push(scope);
  }
  return out;
}

/**
 * The question each stored answer replies to (the last user row before it, by
 * seq), keyed by the answer's id, in one pass over the thread.
 */
export function askedByAnswer(rows: readonly Pick<MessageRow, 'id' | 'seq' | 'role' | 'content'>[]): Map<string, string> {
  const out = new Map<string, string>();
  let asked: string | undefined;
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (r.role === 'user') asked = textOfContent(r.content);
    else if (asked !== undefined) out.set(r.id, asked);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Jobs that ended
// ---------------------------------------------------------------------------

/**
 * The code of a failed job's stored `error` ("CODE: our sentence", jobRunner
 * `fail`): the shared codes, else UNKNOWN. The English after the colon is the
 * server's and is never shown; the catalog words the code.
 */
export function jobErrorCode(error: string | null | undefined): AssistantErrorCode {
  const m = /^\s*([A-Z][A-Z0-9_]*)\s*:/.exec(error ?? '');
  return asAssistantErrorCode(m ? m[1] : error?.trim());
}

/**
 * The sentence for a job that failed, as a full catalog key. The cap, the daily
 * limit, a busy or missing vendor key read as they do in the chat; a job that
 * ran out of time and anything unworded have job words of their own (a job's
 * time-out is not the chat's 50 seconds, and "ask again" means a new job).
 */
export type JobErrorKey =
  | 'ws.owner.assistant.job.errors.TIMEOUT'
  | 'ws.owner.assistant.job.errors.UNKNOWN'
  | `ws.owner.assistant.message.errors.${'LLM_MONTHLY_CAP' | 'LLM_DAILY_QUOTA' | 'RATE_LIMITED' | 'NOT_CONFIGURED' | 'UPSTREAM' | 'AUTH_REQUIRED' | 'FORBIDDEN'}`;

export function jobErrorKey(code: ChatErrorCode): JobErrorKey {
  switch (code) {
    case 'LLM_MONTHLY_CAP':
    case 'LLM_DAILY_QUOTA':
    case 'RATE_LIMITED':
    case 'NOT_CONFIGURED':
    case 'UPSTREAM':
    case 'AUTH_REQUIRED':
    case 'FORBIDDEN':
      return `ws.owner.assistant.message.errors.${code}`;
    case 'TIMEOUT':
      return 'ws.owner.assistant.job.errors.TIMEOUT';
    default:
      return 'ws.owner.assistant.job.errors.UNKNOWN';
  }
}

/** How recently a job must have ended to be shown as news on return. */
export const AWAY_JOB_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface JobCard {
  job: JobRow;
  /** It ended without the owner watching it here: say so once. */
  endedAway: boolean;
}

/**
 * The job cards under the thread. A job still working (or paused over its
 * estimate) always shows. A job that ended shows:
 *  - when it was watched in this view (the press that started it);
 *  - when it failed and no stored message of the chat speaks for it (the
 *    server writes one since 2026-11-12; older failures only have the row);
 *  - once, when it ended (done or failed) within AWAY_JOB_WINDOW_MS and this
 *    computer has not shown its end yet: the owner was away, and the answer or
 *    the failure must not slip by unnoticed.
 * A cancelled job shows only while watched: the owner cancelled it. A paused
 * job the server closed after 7 days (EXPIRED, 0410) counts as an end the
 * owner did not see. An expired estimate never shows: it cost nothing.
 */
export function jobCards(
  jobs: readonly JobRow[],
  opts: { watched: readonly string[]; seen: ReadonlySet<string>; jobIdsInMessages: ReadonlySet<string>; now: number },
): JobCard[] {
  const out: JobCard[] = [];
  for (const job of jobs) {
    if (job.status === 'estimated') continue;
    if (!ENDED_JOB_STATUSES.includes(job.status)) {
      out.push({ job, endedAway: false });
      continue;
    }
    const watched = opts.watched.includes(job.id);
    const ended = job.finished_at ? Date.parse(job.finished_at) : NaN;
    const recent = Number.isFinite(ended) && opts.now - ended <= AWAY_JOB_WINDOW_MS;
    // 0410: a paused job the server closed after 7 days is news once, like an end
    const endedAway = !watched && (job.status !== 'cancelled' || isExpiredPause(job)) && recent && !opts.seen.has(job.id);
    const unexplainedFailure = job.status === 'failed' && !opts.jobIdsInMessages.has(job.id);
    if (watched || endedAway || unexplainedFailure) out.push({ job, endedAway });
  }
  return out;
}

/**
 * A job app.assistant_job_expire closed (0410): cancelled with error
 * `EXPIRED: …` after it had started (mode set; an estimate has none).
 */
export function isExpiredPause(job: Pick<JobRow, 'status' | 'mode' | 'error'>): boolean {
  return job.status === 'cancelled' && job.mode !== null && /^\s*EXPIRED\b/.test(job.error ?? '');
}

// ---------------------------------------------------------------------------
// Paused jobs (0410)
// ---------------------------------------------------------------------------

const PAUSE_REASONS: readonly JobPauseReason[] = ['over_estimate', 'time', 'cap', 'stopped'];

export interface PauseView {
  reason: JobPauseReason;
  /** Parts already read and paid for. */
  done: number;
  total: number;
  /** Parts Continue reads. */
  remaining: number;
  /** What they and the answer should cost (result.pause.rest); null on a job paused before 0410. */
  rest: JobPause['rest'] | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isBreakdown = (v: unknown): v is JobTokenBreakdown =>
  isObj(v) && ['input', 'cache_read', 'output'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k] as number));

/** A paused job as the card shows it, read defensively from `result` (untyped jsonb); null when it is not paused. */
export function pauseOf(job: Pick<JobRow, 'status' | 'result' | 'chunks_total' | 'chunks_done' | 'estimate'>): PauseView | null {
  if (job.status !== 'over_estimate') return null;
  const r = isObj(job.result) ? job.result : {};
  const done = Array.isArray(r.objects) ? r.objects.length : Math.max(0, job.chunks_done ?? 0);
  const total = Math.max(done, job.chunks_total ?? job.estimate?.chunks ?? done);
  const p = isObj(r.pause) ? r.pause : null;
  const reason = p && PAUSE_REASONS.includes(p.reason as JobPauseReason) ? (p.reason as JobPauseReason) : 'over_estimate';
  const remaining = p && Array.isArray(p.chunks_left) ? p.chunks_left.length : Math.max(0, total - done);
  const rv = p && isObj(p.rest) ? p.rest : null;
  const rest = rv && ['extract', 'extract_high', 'reduce', 'reduce_high'].every((k) => isBreakdown(rv[k])) ? (rv as unknown as JobPause['rest']) : null;
  return { reason, done, total, remaining, rest };
}

/**
 * Whether Continue runs the rest in the background: parts are left and the
 * estimate offered batch (on a vendor without it the server runs them live;
 * with only the answer left it writes it in the request).
 */
export function resumesInBackground(job: Pick<JobRow, 'estimate'>, pause: PauseView): boolean {
  // modes.batch is typed { allowed: true }, but the chat stores false on a vendor without batch (runners.ts)
  return pause.remaining > 0 && (job.estimate?.modes?.batch as { allowed?: boolean } | undefined)?.allowed !== false;
}

/**
 * What Continue costs, in USD micros: the parts left at the extraction model
 * (half price in the background, Decision 8) and the answer at the job's
 * model; `high` is the +15 % band. A job paused before 0410 has no stored
 * rest: the estimate's per-part share then stands in.
 */
export function resumePrices(
  job: Pick<JobRow, 'estimate' | 'tokens'>,
  pause: PauseView,
  background: boolean,
  model: string,
  pricing: PricingMap | null | undefined,
  fallback: number,
): { rest: number; high: number } {
  const steps = job.estimate?.by_step;
  const exModel = steps?.extract.model ?? job.tokens?.model ?? model;
  const rdModel = job.tokens?.model ?? model;
  const share = (t: JobTokenBreakdown | undefined): JobTokenBreakdown => {
    const chunks = Math.max(1, job.estimate?.chunks ?? 1);
    const f = pause.remaining / chunks;
    const s = { input: Math.ceil((t?.input ?? 0) * f), cache_read: Math.ceil((t?.cache_read ?? 0) * f), output: Math.ceil((t?.output ?? 0) * f), total: 0 };
    return { ...s, total: s.input + s.cache_read + s.output };
  };
  const rest = pause.rest ?? {
    chunks: pause.remaining,
    extract: share(steps?.extract.tokens ?? job.estimate?.tokens),
    extract_high: share(steps?.extract.tokens_high ?? job.estimate?.tokens_high),
    reduce: steps?.reduce.tokens ?? { input: 0, cache_read: 0, output: 0, total: 0 },
    reduce_high: steps?.reduce.tokens_high ?? { input: 0, cache_read: 0, output: 0, total: 0 },
  };
  const at = (m: string, t: JobTokenBreakdown) => priceFor({ model: m, input: t.input, cache_read: t.cache_read, output: t.output }, pricing, fallback);
  const ex = (t: JobTokenBreakdown) => (background ? Math.round(at(exModel, t) / 2) : at(exModel, t));
  return { rest: ex(rest.extract) + at(rdModel, rest.reduce), high: ex(rest.extract_high) + at(rdModel, rest.reduce_high) };
}

export const SEEN_JOBS_KEY = 'touch-assistant-seen-jobs';
const SEEN_KEEP = 200;

/** The jobs whose end this computer has already shown. */
export function loadSeenJobs(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_JOBS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveSeenJobs(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SEEN_JOBS_KEY, JSON.stringify([...ids].slice(-SEEN_KEEP)));
  } catch {
    /* private mode: the notice may show again next time */
  }
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
/**
 * The same for Continue (0410), except that JOB_DATA_CHANGED (also a 409) is
 * a refusal the owner must read: the job stayed paused.
 */
export function resumeMayHaveStarted(err: unknown): boolean {
  if (err && typeof err === 'object' && (err as { serverCode?: unknown }).serverCode === 'JOB_DATA_CHANGED') return false;
  return acceptMayHaveStarted(err);
}

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
