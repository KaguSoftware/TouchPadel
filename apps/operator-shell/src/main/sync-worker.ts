import type { MutationResult } from '../ipc-channels';
import { getReplayAuth, markTokenRejected, onAuthStateChange } from './auth-state';
import {
  ack,
  markConflict,
  markFailed,
  markInflight,
  peekNext,
  releaseToPending,
  setWorkerUnreachable,
  type QueueRow,
} from './queue';

/**
 * The sync worker — the missing half of design-arch.md §2.2. Uploads the durable
 * queue strictly by seq, ONE row at a time, to POST {supabaseUrl}/functions/v1/replay
 * as the staff session the renderer pushed (auth-state.ts).
 *
 * Outcome map (mirrors the replay function's contract):
 *   200                  → ack(echo). 'duplicate' is an ack too — the server already
 *                          holds the result; re-sending is what the key is for —
 *                          UNLESS prior_result is 'conflict': the server holds a
 *                          terminal refusal for this key, so acking would report a
 *                          settle or a discount as done that never applied (C1).
 *                          That is a conflict, exactly as a fresh 409 is.
 *   409                  → markConflict(detail): the desk resolves manually, replay
 *                          of LATER rows continues (an exclusion clash on one
 *                          reservation must not stop tonight's food orders).
 *   other 4xx            → markFailed: deterministic, retrying cannot change it.
 *                          Terminal + visible + blocks day close, but does NOT wedge
 *                          the rows behind it. This is the one deliberate deviation
 *                          from strict-order replay: an unreplayable row (say, staff
 *                          deactivated since) must not block every later sale forever.
 *   429 / 5xx / network  → releaseToPending + exponential backoff (1s → 30s cap).
 *   / timeout              This covers the server's "not judged" answers: 503
 *                          RETRY_LATER (a deadlock or statement timeout), 503
 *                          DEGRADED_LOCKOUT and 501 RPC_NOT_DEPLOYED (this build
 *                          is ahead of the server). None is ever a conflict or a
 *                          failure: the row waits and is sent again.
 *   401                  → the token is marked rejected (auth-state.ts) and replay
 *                          PAUSES: no request goes out — not from the timer, not
 *                          from a kick — until the renderer pushes a DIFFERENT
 *                          token (TOKEN_REFRESHED, a new sign-in). While paused the
 *                          upload path reads BLOCKED (queueStatus().uploadBlocked):
 *                          this branch used to call noteTransportOk(), which
 *                          cleared the unreachable flag, so a dead token looked
 *                          healthy on the station's status strip.
 *   no token             → paused-auth the same way; the auth push resumes.
 *
 * Every POST has a deadline (requestTimeoutMs, 20 s), the body read included.
 * Replay is strictly ordered, so one request the network swallowed used to hold
 * the single in-flight slot — and every queued sale behind it — forever; now it
 * is cut, the row goes back to pending, and the backoff takes over.
 *
 * A row found 'inflight' on boot is a POST interrupted by a crash or power cut —
 * peekNext returns it first (lowest seq) and it is simply re-sent.
 */

export interface SyncWorkerOptions {
  onResult(result: MutationResult): void;
  /** Called after any state change so main can push a fresh queueStatus(). */
  onActivity(): void;
  fetchImpl?: typeof fetch;
  tickMs?: number;
  backoffCapMs?: number;
  /** Deadline for one replay POST, body included (default 20 s). */
  requestTimeoutMs?: number;
}

export interface SyncWorker {
  /** Drain now (new enqueue, fresh token) — clears any pending backoff. */
  kick(): void;
  stop(): void;
  /** ≥2 consecutive transport failures — an uploadBlocked input (queue.ts). */
  isUnreachable(): boolean;
  /** Await the in-progress drain — tests only. */
  idle(): Promise<void>;
}

const TICK_MS = 3_000;
const BACKOFF_CAP_MS = 30_000;
export const REPLAY_TIMEOUT_MS = 20_000;

class ReplayTimeout extends Error {
  constructor(ms: number) {
    super(`timeout after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * `p`, or a rejection as soon as `signal` aborts — even when whatever produced
 * `p` ignores the signal, so a stuck fetch can never hold the drain.
 */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** The machine code in a replay answer body ({ code } or { error: 'CODE' }), if any. */
function bodyCode(body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.code === 'string') return b.code;
  if (typeof b.error === 'string' && /^[A-Z][A-Z0-9_]*$/.test(b.error)) return b.error;
  return null;
}

export function startSyncWorker(opts: SyncWorkerOptions): SyncWorker {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tickMs = opts.tickMs ?? TICK_MS;
  const backoffCapMs = opts.backoffCapMs ?? BACKOFF_CAP_MS;
  const requestTimeoutMs = opts.requestTimeoutMs ?? REPLAY_TIMEOUT_MS;

  let stopped = false;
  let draining: Promise<void> | null = null;
  /** The POST in flight, so stop() can cut it. */
  let inflight: AbortController | null = null;
  let backoffMs = 0;
  let nextAllowedAt = 0;
  let transportFailures = 0;
  /** Replay answered 401: paused until a fresh token, and the upload path is blocked. */
  let pausedOnAuth = false;
  /** Mirrors what we last told queue.ts, so only TRANSITIONS are logged. */
  let reportedUnreachable = false;

  /**
   * The write path had no logging at all: 144 consecutive failed uploads
   * produced two lines of stdout, neither about sync (2026-09-04).
   * Transitions only, never one line per attempt.
   */
  function reportUnreachable(): void {
    const unreachable = transportFailures >= 2 || pausedOnAuth;
    if (unreachable === reportedUnreachable) return;
    reportedUnreachable = unreachable;
    setWorkerUnreachable(unreachable);
    if (unreachable) console.warn('[sync] replay blocked: writes are queueing, not sending');
    else console.warn('[sync] replay reachable again: draining');
  }

  function noteTransportFailure(): void {
    transportFailures += 1;
    backoffMs = Math.min(backoffMs === 0 ? 1_000 : backoffMs * 2, backoffCapMs);
    nextAllowedAt = Date.now() + backoffMs;
    reportUnreachable();
  }

  function noteTransportOk(): void {
    transportFailures = 0;
    backoffMs = 0;
    nextAllowedAt = 0;
    reportUnreachable();
  }

  function emit(row: QueueRow, state: MutationResult['state'], extra: Partial<MutationResult>): void {
    opts.onResult({
      localId: row.localId,
      idempotencyKey: row.idempotencyKey,
      mutationType: row.mutationType,
      state,
      ...extra,
    });
    opts.onActivity();
  }

  /** One replay attempt. Returns false when the drain loop should stop. */
  async function replayOne(row: QueueRow): Promise<boolean> {
    // paused-auth (no token, or the token replay refused): resumed by the auth-state listener
    const auth = getReplayAuth();
    if (!auth) return false;

    if (!row.staffId || !row.deviceId) {
      // Should be impossible past the v1 migration + IPC validation; park it
      // rather than send a request the server will 400 forever.
      markFailed(row.idempotencyKey, 'row is missing staff_id/device_id');
      emit(row, 'failed', { error: 'row is missing staff_id/device_id' });
      return true;
    }

    markInflight(row.idempotencyKey);
    opts.onActivity();

    let res: Response;
    let body: unknown = null;
    const controller = new AbortController();
    inflight = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    try {
      res = await untilAborted(
        fetchImpl(`${auth.supabaseUrl}/functions/v1/replay`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            apikey: auth.anonKey,
            authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({
            idempotency_key: row.idempotencyKey,
            mutation_type: row.mutationType,
            payload: row.payload,
            station_id: row.deviceId,
            staff_id: row.staffId,
            // 0228: the branch the write was queued under (x-venue-scope on replay).
            ...(row.venueScope ? { venue_scope: row.venueScope } : {}),
          }),
          signal: controller.signal,
        }),
        controller.signal,
      );
      // Inside the deadline too: an answer whose body never finishes is no answer.
      // (Lost after a 200, the row is simply re-sent and the key replays the result.)
      const text = await untilAborted(res.text(), controller.signal);
      try {
        body = text === '' ? null : (JSON.parse(text) as unknown);
      } catch {
        body = null;
      }
    } catch (error) {
      const reason = timedOut ? new ReplayTimeout(requestTimeoutMs) : error;
      releaseToPending(row.idempotencyKey, `transport: ${String(reason)}`);
      if (transportFailures === 0) console.warn('[sync] replay unreachable:', String(reason));
      noteTransportFailure();
      opts.onActivity();
      return false;
    } finally {
      clearTimeout(timer);
      if (inflight === controller) inflight = null;
    }

    if (res.ok) {
      noteTransportOk();
      const dup = (body ?? {}) as { result?: unknown; prior_result?: unknown };
      if (dup.result === 'duplicate' && dup.prior_result === 'conflict') {
        // The key was already judged and refused. Never ack it as applied.
        markConflict(row.idempotencyKey, body);
        emit(row, 'conflict', { serverResult: body });
        return true;
      }
      ack(row.idempotencyKey, body);
      emit(row, 'acked', { serverResult: body });
      return true;
    }

    if (res.status === 409) {
      noteTransportOk();
      markConflict(row.idempotencyKey, body);
      emit(row, 'conflict', { serverResult: body });
      return true;
    }

    if (res.status === 429 || res.status >= 500) {
      // Not judged: 503 RETRY_LATER (deadlock, statement timeout, pool), 503
      // DEGRADED_LOCKOUT, 501 RPC_NOT_DEPLOYED, a gateway's 502/504. The server
      // recorded nothing, so the row is neither a conflict nor a failure: back
      // to pending with backoff, and the code is kept for whoever looks.
      const code = bodyCode(body);
      const why = code ? `server ${res.status}: ${code}` : `server ${res.status}`;
      releaseToPending(row.idempotencyKey, why);
      if (transportFailures === 0) console.warn('[sync] replay failed:', why, row.mutationType);
      noteTransportFailure();
      opts.onActivity();
      return false;
    }

    if (res.status === 401) {
      // The token the renderer pushed no longer verifies. Not the row's fault:
      // back to pending, and this token is never sent again — the timer and
      // every kick find no replay auth until a different token is pushed.
      // Deliberately NOT noteTransportOk(): the server answered, but the upload
      // path is not healthy, and saying so used to clear the unreachable flag.
      transportFailures = 0;
      backoffMs = 0;
      nextAllowedAt = 0;
      pausedOnAuth = true;
      reportUnreachable();
      markTokenRejected(auth.accessToken);
      releaseToPending(row.idempotencyKey, 'staff session rejected (401)');
      console.warn('[sync] staff session rejected (401): paused until a fresh token');
      opts.onActivity();
      return false;
    }

    // Deterministic 4xx — replaying the same bytes cannot succeed.
    noteTransportOk();
    const b = (body ?? {}) as Record<string, unknown>;
    const detail =
      typeof b.code === 'string' ? b.code : typeof b.error === 'string' ? b.error : `HTTP ${res.status}`;
    // Terminal: this row will never replay, and a person has to deal with it.
    console.error('[sync] row will never replay:', row.mutationType, `${res.status}: ${detail}`);
    markFailed(row.idempotencyKey, `${res.status}: ${detail}`);
    // serverResult rides along so the renderer can surface the machine code
    // (PIN_INVALID, FORBIDDEN, ...) through its normal error mapping.
    emit(row, 'failed', { error: `${res.status}: ${detail}`, serverResult: body });
    return true;
  }

  async function drain(): Promise<void> {
    for (;;) {
      if (stopped) return;
      const row = peekNext();
      if (!row) return;
      const proceed = await replayOne(row);
      if (!proceed) return;
    }
  }

  function scheduleDrain(force: boolean): void {
    if (stopped || draining) return;
    // Paused for auth: not even a queue read until the auth push says otherwise.
    if (!getReplayAuth()) return;
    if (!force && Date.now() < nextAllowedAt) return;
    draining = drain().finally(() => {
      draining = null;
    });
  }

  const timer = setInterval(() => scheduleDrain(false), tickMs);
  const unsubscribeAuth = onAuthStateChange(() => {
    if (!getReplayAuth()) return;
    // A fresh token lifts the 401 pause; the drain it starts proves the rest.
    if (pausedOnAuth) {
      pausedOnAuth = false;
      reportUnreachable();
    }
    kick();
  });

  function kick(): void {
    backoffMs = 0;
    nextAllowedAt = 0;
    scheduleDrain(true);
  }

  // First pass on boot: resume any inflight row a power cut left behind.
  scheduleDrain(true);

  return {
    kick,
    stop() {
      stopped = true;
      clearInterval(timer);
      unsubscribeAuth();
      // A POST in flight is cut; its row goes back to pending for the next start.
      inflight?.abort();
    },
    isUnreachable() {
      return transportFailures >= 2;
    },
    async idle() {
      while (draining) await draining;
    },
  };
}
