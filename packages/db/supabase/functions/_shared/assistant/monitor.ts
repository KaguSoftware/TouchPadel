/**
 * monitor.ts: the assistant's failures on the Monitoring page (2026-11-12,
 * migration 0422). The assistant edge functions report through ../monitoring.ts
 * reportEvent (source edge, app.report_event); this file decides WHAT goes in
 * an event, and makes sure reporting can never cost the owner anything:
 *
 *   * no latency and no failure: `reportInBackground` starts the post on a
 *     microtask, hands the promise to EdgeRuntime.waitUntil when the runtime
 *     has one (so a closed request does not drop it) and is never awaited on a
 *     turn's path; it never throws, and reportEvent itself has a 2.5 s timeout
 *     and never throws;
 *   * no model call: an event is built from codes the function already holds;
 *   * privacy: `assistantDetail` is an ALLOWLIST (DETAIL_KEYS), ids must be
 *     UUIDs, `code` an upper-snake code, every other string a short token with
 *     no spaces; the message is a fixed sentence (`<function>: <what> (<code>)`).
 *     So a question, an answer, tool arguments, a thumbs-down note, a guest or
 *     staff name and raw vendor or runtime text never reach it, whatever a
 *     caller passes. Key names avoid the server scrubber's secret words (0393
 *     drops a key named `tokens`, for one).
 *
 * The free guide (many staff, one shared free tier) is throttled per isolate
 * (`throttled`): one event per key per minute, the dropped ones counted into
 * the next event's `suppressed`. The paid chat is human-paced and its counts
 * feed the weekly report exactly, so it is never throttled.
 *
 * Kinds (the weekly report, app.assistant_week_figures, reads the first three):
 *   assistant_failed      a chat turn failed; detail.stage before_stream or turn
 *   assistant_refused     the chat refused before the stream (quota, cap, model)
 *   assistant_free_failed the free guide failed (throttled)
 *   assistant_not_saved   persist could not store part of a turn; detail.step
 *   assistant_job_failed  a job failed
 *   assistant_job_swept   the tick's sweeper (0423) paused or finished a stuck
 *                         job (warn), or found a batch submit that died after it
 *                         may have created a vendor batch with no id saved (error)
 *
 * Pure: no Deno, no npm: imports, so tests/assistant-monitor.test.ts runs it.
 */
import { reportEvent, type EdgeMonitorEvent, type EdgeMonitorLevel } from '../monitoring.ts';

export type AssistantKind = 'assistant_failed' | 'assistant_refused' | 'assistant_free_failed' | 'assistant_not_saved' | 'assistant_job_failed' | 'assistant_job_swept';
export type AssistantFn = 'assistant-chat' | 'assistant-job' | 'assistant-free';

/** The only detail keys an assistant event may carry. */
export const DETAIL_KEYS = [
  'conversationId',
  'messageId',
  'jobId',
  'code',
  'stopReason',
  'model',
  'route',
  'routeReason',
  'stage',
  'step',
  'status',
  'ms',
  'role',
  'app',
  'suppressed',
] as const;
export type DetailKey = (typeof DETAIL_KEYS)[number];
export type AssistantDetail = Partial<Record<DetailKey, string | number | boolean>>;

const ID_KEYS: ReadonlySet<string> = new Set(['conversationId', 'messageId', 'jobId']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An error code: SQL (P0001 messages, SQLSTATEs like 57014, PGRST202) or ours (UPSTREAM). */
const CODE_RE = /^[A-Z0-9][A-Z0-9_]{1,47}$/;
/** A model id, a route, a stage: one short token, no spaces, so never a sentence or a name. */
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,63}$/;
/** The fixed phrase of a message: lower-case words a developer wrote, nothing a person typed. */
const WHAT_RE = /^[a-z][a-z0-9 _,'-]{0,79}$/;

/** A code when `v` is shaped like one, else null. */
export function codeOf(v: unknown): string | null {
  return typeof v === 'string' && CODE_RE.test(v) ? v : null;
}

/**
 * A Postgres or PostgREST error's code (SQLSTATE or PGRST…), else null: the
 * code only, never the message, which can quote a row.
 */
export function dbCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code) ? code : null;
}

/** The detail as stored: allowlisted keys, ids as UUIDs, codes as codes, short tokens, finite numbers. Never throws. */
export function assistantDetail(input: Record<string, unknown> | null | undefined): AssistantDetail {
  const out: AssistantDetail = {};
  try {
    if (!input || typeof input !== 'object') return out;
    for (const key of DETAIL_KEYS) {
      const v = (input as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue;
      if (typeof v === 'number') {
        if (Number.isFinite(v)) out[key] = Math.round(v);
      } else if (typeof v === 'boolean') {
        out[key] = v;
      } else if (typeof v === 'string') {
        if (ID_KEYS.has(key) ? UUID_RE.test(v) : key === 'code' ? CODE_RE.test(v) : TOKEN_RE.test(v)) out[key] = v;
      }
    }
  } catch {
    return {};
  }
  return out;
}

/**
 * The level by kind and code (the table in tests/assistant-monitor.test.ts):
 * a person's own limit or the club's budget is info; a slow or busy vendor and
 * an unpriced model are warn; a lost answer is error, a lost side record
 * (calls, the chat's counters) warn; everything else is error.
 */
export function levelFor(kind: AssistantKind, code: string | null | undefined, step?: string | null): EdgeMonitorLevel {
  if (kind === 'assistant_not_saved') return step === 'calls' || step === 'conversation' ? 'warn' : 'error';
  if (kind === 'assistant_job_swept') return step === 'batch_unrecorded' ? 'error' : 'warn';
  if (code === 'LLM_DAILY_QUOTA' || code === 'LLM_MONTHLY_CAP') return 'info';
  if (code === 'TIMEOUT' || code === 'RATE_LIMITED' || code === 'ASSISTANT_MODEL_NOT_PRICED') return 'warn';
  if (kind === 'assistant_refused') return 'info';
  return 'error';
}

export interface AssistantEventInput {
  fn: AssistantFn;
  kind: AssistantKind;
  /** A fixed phrase written in the code ("turn failed"), never text from a person or a vendor. */
  what: string;
  code?: string | null;
  /** Overrides levelFor. */
  level?: EdgeMonitorLevel;
  detail?: Record<string, unknown>;
}

/** One event: `<fn>: <what> (<code>)`, the allowlisted detail, the level from the table. Never throws. */
export function assistantEvent(i: AssistantEventInput): EdgeMonitorEvent {
  try {
    const code = codeOf(i.code ?? i.detail?.code);
    const detail = assistantDetail({ ...(i.detail ?? {}), code: code ?? undefined });
    const what = typeof i.what === 'string' && WHAT_RE.test(i.what) ? i.what : i.kind;
    const step = typeof detail.step === 'string' ? detail.step : null;
    return {
      level: i.level ?? levelFor(i.kind, code, step),
      kind: i.kind,
      message: `${i.fn}: ${what}${code ? ` (${code})` : ''}`,
      detail,
    };
  } catch {
    return { level: 'error', kind: 'assistant_failed', message: 'assistant: event not built', detail: {} };
  }
}

/** What a call site hands an event to; tests inject a recorder. */
export type Report = (event: EdgeMonitorEvent) => void;

/**
 * Posts `event` without blocking the caller: the work starts on a microtask,
 * the promise goes to EdgeRuntime.waitUntil when it exists (feature-detected,
 * as assistant-chat/index.ts does), and nothing is returned to await. Never
 * throws. `send` is reportEvent; tests pass a fake.
 */
export function reportInBackground(event: EdgeMonitorEvent, send: (e: EdgeMonitorEvent) => Promise<boolean> = reportEvent): void {
  try {
    const p: Promise<unknown> = Promise.resolve()
      .then(() => send(event))
      .catch(() => false);
    const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (typeof edge?.waitUntil === 'function') {
      try {
        edge.waitUntil(p);
      } catch {
        // The post still runs; only its keep-alive was refused.
      }
    }
  } catch {
    // Reporting never fails the caller.
  }
}

// ---------------------------------------------------------------------------
// Throttle (the free guide)
// ---------------------------------------------------------------------------

/** Keys a throttle remembers at most; an isolate that sees more forgets the oldest. */
const THROTTLE_KEYS_MAX = 200;

export type ThrottleVerdict = { send: true; suppressed: number } | { send: false };

/**
 * Per-isolate memory: the first event for a key goes, the next ones inside
 * `windowMs` are counted and dropped, and the first one after the window goes
 * with `suppressed` = how many were dropped. A count still held when the
 * isolate ends is lost (best effort, like the free limiter).
 */
export function createThrottle(now: () => number = () => Date.now()) {
  const seen = new Map<string, { at: number; suppressed: number }>();
  return (key: string, windowMs = 60_000): ThrottleVerdict => {
    try {
      const t = now();
      const s = seen.get(key);
      if (s && t - s.at < windowMs) {
        s.suppressed++;
        return { send: false };
      }
      const suppressed = s?.suppressed ?? 0;
      seen.delete(key); // re-inserted last: the map's order is the oldest first
      seen.set(key, { at: t, suppressed: 0 });
      while (seen.size > THROTTLE_KEYS_MAX) seen.delete(seen.keys().next().value as string);
      return { send: true, suppressed };
    } catch {
      return { send: true, suppressed: 0 };
    }
  };
}

/** The isolate's throttle. */
export const throttled = createThrottle();

// ---------------------------------------------------------------------------
// The free guide's one call
// ---------------------------------------------------------------------------

export interface FreeFailure {
  code: string;
  stage: 'before_stream' | 'stream';
  /** The asker's staff role and app (codes, not a person). */
  role?: string;
  app?: string;
  model?: string;
  ms?: number;
}

/**
 * The free guide failed: one assistant_free_failed event through the throttle
 * (keyed on the code). UPSTREAM and NOT_CONFIGURED are error, TIMEOUT and the
 * vendor's rate limit warn (levelFor). A person over their own allowance is
 * not a failure and never reaches here. Never throws; answers whether an
 * event went out.
 */
export function reportFreeFailure(f: FreeFailure, deps: { report?: Report; throttle?: (key: string, windowMs?: number) => ThrottleVerdict } = {}): boolean {
  try {
    const code = codeOf(f.code) ?? 'UPSTREAM';
    const verdict = (deps.throttle ?? throttled)(`free:${code}`, 60_000);
    if (!verdict.send) return false;
    (deps.report ?? reportInBackground)(
      assistantEvent({
        fn: 'assistant-free',
        kind: 'assistant_free_failed',
        what: f.stage === 'stream' ? 'stream failed' : 'request failed',
        code,
        detail: { stage: f.stage, role: f.role, app: f.app, model: f.model, ms: f.ms, ...(verdict.suppressed ? { suppressed: verdict.suppressed } : {}) },
      }),
    );
    return true;
  } catch {
    return false;
  }
}
