import type { MutationResult } from '../ipc-channels';
import { getAuthState, onAuthStateChange } from './auth-state';
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
 *                          holds the result; re-sending is what the key is for.
 *   409                  → markConflict(detail): the desk resolves manually, replay
 *                          of LATER rows continues (an exclusion clash on one
 *                          reservation must not stop tonight's food orders).
 *   other 4xx            → markFailed: deterministic, retrying cannot change it.
 *                          Terminal + visible + blocks day close, but does NOT wedge
 *                          the rows behind it. This is the one deliberate deviation
 *                          from strict-order replay: an unreplayable row (say, staff
 *                          deactivated since) must not block every later sale forever.
 *   429 / 5xx / network  → releaseToPending + exponential backoff (1s → 30s cap).
 *   no/expired token     → paused-auth: no spinning; a TOKEN_REFRESHED push resumes.
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
}

export interface SyncWorker {
  /** Drain now (new enqueue, fresh token) — clears any pending backoff. */
  kick(): void;
  stop(): void;
  /** ≥2 consecutive transport failures — a degraded input (queue.ts). */
  isUnreachable(): boolean;
  /** Await the in-progress drain — tests only. */
  idle(): Promise<void>;
}

const TICK_MS = 3_000;
const BACKOFF_CAP_MS = 30_000;

export function startSyncWorker(opts: SyncWorkerOptions): SyncWorker {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tickMs = opts.tickMs ?? TICK_MS;
  const backoffCapMs = opts.backoffCapMs ?? BACKOFF_CAP_MS;

  let stopped = false;
  let draining: Promise<void> | null = null;
  let backoffMs = 0;
  let nextAllowedAt = 0;
  let transportFailures = 0;

  function noteTransportFailure(): void {
    transportFailures += 1;
    backoffMs = Math.min(backoffMs === 0 ? 1_000 : backoffMs * 2, backoffCapMs);
    nextAllowedAt = Date.now() + backoffMs;
    if (transportFailures >= 2) setWorkerUnreachable(true);
  }

  function noteTransportOk(): void {
    transportFailures = 0;
    backoffMs = 0;
    nextAllowedAt = 0;
    setWorkerUnreachable(false);
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
    const auth = getAuthState();
    if (!auth) return false; // paused-auth: resumed by the auth-state listener

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
    try {
      res = await fetchImpl(`${auth.supabaseUrl}/functions/v1/replay`, {
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
        }),
      });
    } catch (error) {
      releaseToPending(row.idempotencyKey, `transport: ${String(error)}`);
      noteTransportFailure();
      opts.onActivity();
      return false;
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (res.ok) {
      noteTransportOk();
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
      releaseToPending(row.idempotencyKey, `server ${res.status}`);
      noteTransportFailure();
      opts.onActivity();
      return false;
    }

    if (res.status === 401) {
      // The token the renderer pushed no longer verifies. Not the row's fault:
      // back to pending, pause until a fresh TOKEN_REFRESHED push arrives.
      noteTransportOk();
      releaseToPending(row.idempotencyKey, 'staff session rejected (401)');
      opts.onActivity();
      return false;
    }

    // Deterministic 4xx — replaying the same bytes cannot succeed.
    noteTransportOk();
    const b = (body ?? {}) as Record<string, unknown>;
    const detail =
      typeof b.code === 'string' ? b.code : typeof b.error === 'string' ? b.error : `HTTP ${res.status}`;
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
    if (!force && Date.now() < nextAllowedAt) return;
    draining = drain().finally(() => {
      draining = null;
    });
  }

  const timer = setInterval(() => scheduleDrain(false), tickMs);
  const unsubscribeAuth = onAuthStateChange(() => {
    if (getAuthState()) kick();
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
    },
    isUnreachable() {
      return transportFailures >= 2;
    },
    async idle() {
      while (draining) await draining;
    },
  };
}
