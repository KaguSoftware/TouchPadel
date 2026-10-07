import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MutationEnvelope, MutationResult } from '../ipc-channels';
import { setAuthState } from './auth-state';
import {
  enqueue,
  listBlockingRows,
  markInflight,
  openQueue,
  peekNext,
  queueStatus,
  setConnOnline,
  setWorkerUnreachable,
} from './queue';
import { startSyncWorker, type SyncWorker } from './sync-worker';

// The replay client half of design-arch §2.2 — strictly-by-seq upload with the
// exact outcome map the server contract defines. Every test drives the worker
// through a scripted fetch; the real HTTP shape is asserted on the way out.

const STAFF = '5c9f1f1e-2b3a-4c4d-8e9f-0000000000aa';
const AUTH = {
  accessToken: 'jwt-abc',
  staffId: STAFF,
  supabaseUrl: 'https://project.supabase.co',
  anonKey: 'anon-key',
};

let n = 100;
function envelope(over: Partial<MutationEnvelope> = {}): MutationEnvelope {
  const suffix = String(n++).padStart(26, 'C');
  return {
    localId: `TILL1-${suffix}`,
    idempotencyKey: `TILL1:order.create:${suffix}`,
    mutationType: 'order.create',
    payload: { tabId: 'abc', items: [] },
    createdAt: '2026-09-03T09:00:00.000Z',
    staffId: STAFF,
    deviceId: 'TILL1',
    ...over,
  };
}

type Scripted =
  | { status: number; body?: unknown }
  | { throw: string };

function makeFetch(script: Scripted[]) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const step = script.length > 0 ? script.shift()! : { status: 200, body: { result: 'applied' } };
    calls.push({
      url: String(url),
      init: init!,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    if ('throw' in step) throw new TypeError(step.throw);
    return new Response(JSON.stringify(step.body ?? { result: 'applied' }), {
      status: step.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

let worker: SyncWorker | null = null;
const results: MutationResult[] = [];

function start(fetchImpl: typeof fetch): SyncWorker {
  worker = startSyncWorker({
    onResult: (r) => results.push(r),
    onActivity: () => {},
    fetchImpl,
    tickMs: 3_600_000, // tests drive the worker via kick(), never the timer
  });
  return worker;
}

beforeEach(() => {
  openQueue().exec('DELETE FROM mutation_queue;');
  setAuthState(AUTH);
  setConnOnline(true);
  setWorkerUnreachable(false);
  results.length = 0;
});

afterEach(() => {
  worker?.stop();
  worker = null;
  setAuthState(null);
});

describe('startSyncWorker', () => {
  it('drains strictly by seq, one at a time, and acks with the server echo', async () => {
    const a = envelope();
    const b = envelope();
    enqueue(a);
    enqueue(b);
    const { fetchImpl, calls } = makeFetch([
      { status: 200, body: { result: 'applied', echo: { order_id: 'o-1' } } },
      { status: 200, body: { result: 'applied', echo: { order_id: 'o-2' } } },
    ]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();

    expect(calls.map((c) => c.body.idempotency_key)).toEqual([a.idempotencyKey, b.idempotencyKey]);
    expect(calls[0]!.url).toBe('https://project.supabase.co/functions/v1/replay');
    // The exact replay body contract: replay/index.ts:242-250 hard-requires all five.
    expect(calls[0]!.body).toEqual({
      idempotency_key: a.idempotencyKey,
      mutation_type: 'order.create',
      payload: a.payload,
      station_id: 'TILL1',
      staff_id: STAFF,
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer jwt-abc');
    expect(headers.apikey).toBe('anon-key');
    expect(listBlockingRows()).toEqual([]);
    expect(results.map((r) => r.state)).toEqual(['acked', 'acked']);
    expect(results[0]!.serverResult).toEqual({ result: 'applied', echo: { order_id: 'o-1' } });
  });

  it('treats a 200 duplicate as an ack — the server already holds the result', async () => {
    const m = envelope();
    enqueue(m);
    const { fetchImpl } = makeFetch([
      { status: 200, body: { result: 'duplicate', prior_result: 'applied', echo: null } },
    ]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    expect(queueStatus().blocking).toBe(0);
    expect(results[0]!.state).toBe('acked');
  });

  it('a 200 duplicate whose prior result is a CONFLICT is a conflict, never an ack', async () => {
    // C1 regression: the first attempt hit a terminal refusal and the server
    // recorded it; the retry sees 200 {duplicate, prior_result: conflict}. Acking
    // that would report money as settled that never was.
    const m = envelope();
    const next = envelope();
    enqueue(m);
    enqueue(next);
    const { fetchImpl } = makeFetch([
      { status: 200, body: { result: 'duplicate', prior_result: 'conflict', echo: { code: 'PIN_INVALID' } } },
      { status: 200, body: { result: 'applied' } },
    ]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    const blocking = listBlockingRows();
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.state).toBe('conflict');
    expect(results.map((r) => r.state)).toEqual(['conflict', 'acked']);
    expect(queueStatus().conflicts).toBe(1);
  });

  it('releases a 503 retry answer back to pending with backoff — the server never judged it', async () => {
    const m = envelope();
    enqueue(m);
    const { fetchImpl, calls } = makeFetch([
      { status: 503, body: { result: 'retry', code: 'RETRY_LATER', message: 'deadlock detected' } },
    ]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    expect(calls).toHaveLength(1);
    // Back to pending (still blocking day close, as any unacked row is), never
    // conflict or failed, and no result reached the renderer.
    const rows = listBlockingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('pending');
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.lastError).toBe('server 503: RETRY_LATER');
    expect(results).toEqual([]);
    expect(peekNext()?.idempotencyKey).toBe(m.idempotencyKey);
  });

  it('re-sends an inflight row first on boot — a power cut mid-POST', async () => {
    const interrupted = envelope();
    const later = envelope();
    enqueue(interrupted);
    enqueue(later);
    markInflight(interrupted.idempotencyKey); // the crash left it here
    const { fetchImpl, calls } = makeFetch([]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    expect(calls[0]!.body.idempotency_key).toBe(interrupted.idempotencyKey);
    expect(queueStatus().blocking).toBe(0);
  });

  it('marks a 409 as conflict and continues to later rows', async () => {
    const suffix = String(n++).padStart(26, 'D');
    const conflictEnv = envelope({
      localId: `TILL1-${suffix}`,
      idempotencyKey: `TILL1:reservation.create:${suffix}`,
      mutationType: 'reservation.create',
    });
    const next = envelope();
    enqueue(conflictEnv);
    enqueue(next);
    const { fetchImpl } = makeFetch([
      { status: 409, body: { result: 'conflict', error: 'SLOT_TAKEN', detail: null } },
      { status: 200, body: { result: 'applied' } },
    ]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();

    const states = listBlockingRows();
    expect(states).toHaveLength(1);
    expect(states[0]!.state).toBe('conflict');
    expect(results.map((r) => r.state)).toEqual(['conflict', 'acked']);
    expect(queueStatus().conflicts).toBe(1);
  });

  it('marks a deterministic 4xx as failed and does NOT wedge later rows', async () => {
    const poison = envelope();
    const good = envelope();
    enqueue(poison);
    enqueue(good);
    const { fetchImpl } = makeFetch([
      { status: 403, body: { error: 'staff_id is not active staff' } },
      { status: 200, body: { result: 'applied' } },
    ]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();

    const rows = listBlockingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('failed');
    expect(rows[0]!.lastError).toMatch(/staff_id is not active staff/);
    expect(results.map((r) => r.state)).toEqual(['failed', 'acked']);
    // failed still blocks day close:
    expect(queueStatus().blocking).toBe(1);
  });

  it('keeps a row pending on 5xx and flags unreachable after two failures', async () => {
    const m = envelope();
    enqueue(m);
    const { fetchImpl } = makeFetch([{ status: 503 }, { status: 503 }]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    expect(peekNext()?.state).toBe('pending');
    expect(w.isUnreachable()).toBe(false); // one failure is a blip

    w.kick();
    await w.idle();
    expect(w.isUnreachable()).toBe(true);
    expect(queueStatus().uploadBlocked).toBe(true); // the worker is a degraded input
    expect(peekNext()?.attempts).toBe(2);
  });

  it('keeps a row pending on a network throw', async () => {
    const m = envelope();
    enqueue(m);
    const { fetchImpl } = makeFetch([{ throw: 'fetch failed: ECONNREFUSED' }]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    const row = peekNext();
    expect(row?.state).toBe('pending');
    expect(row?.lastError).toMatch(/ECONNREFUSED/);
    expect(results).toEqual([]); // transient — no terminal result pushed
  });

  it('sends nothing without a token and resumes on the auth push', async () => {
    setAuthState(null);
    const m = envelope();
    enqueue(m);
    const { fetchImpl, calls } = makeFetch([{ status: 200, body: { result: 'applied' } }]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    expect(calls).toHaveLength(0);
    expect(peekNext()?.state).toBe('pending');

    setAuthState(AUTH); // TOKEN_REFRESHED push — the worker's auth listener kicks
    await w.idle();
    expect(calls).toHaveLength(1);
    expect(queueStatus().blocking).toBe(0);
  });

  it('a 401 releases the row — an expired token is not the row’s fault', async () => {
    const m = envelope();
    enqueue(m);
    const { fetchImpl } = makeFetch([{ status: 401, body: { error: 'staff session required' } }]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    const row = peekNext();
    expect(row?.state).toBe('pending');
    expect(row?.lastError).toMatch(/401/);
    expect(results).toEqual([]);
  });

  it('a 401 pauses replay until a DIFFERENT token is pushed — no resend of the refused one', async () => {
    const m = envelope();
    enqueue(m);
    const { fetchImpl, calls } = makeFetch([{ status: 401, body: { error: 'staff session required' } }]);
    // A fast timer this time: the old worker reset its backoff on a 401 and the
    // 3 s tick resent the same rejected token forever.
    const w = startSyncWorker({ onResult: (r) => results.push(r), onActivity: () => {}, fetchImpl, tickMs: 5 });
    worker = w;
    await w.idle();
    expect(calls).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 60));
    w.kick(); // a new sale enqueued meanwhile kicks the worker
    enqueue(envelope());
    w.kick();
    await w.idle();
    expect(calls).toHaveLength(1);
    expect(peekNext()?.state).toBe('pending');
    expect(results).toEqual([]);

    // The renderer re-pushing the SAME session (a SIGNED_IN echo) changes nothing.
    setAuthState({ ...AUTH });
    await w.idle();
    expect(calls).toHaveLength(1);

    // TOKEN_REFRESHED: a new token un-pauses and is the one sent.
    setAuthState({ ...AUTH, accessToken: 'jwt-fresh' });
    await w.idle();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt-fresh');
  });

  it('a 401 reads as uploadBlocked until a fresh token is pushed', async () => {
    // The 401 branch used to call noteTransportOk(), which cleared the
    // unreachable flag, so a station stuck on a dead token read as healthy.
    const m = envelope();
    enqueue(m);
    const { fetchImpl } = makeFetch([{ status: 401, body: { error: 'staff session required' } }]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    expect(queueStatus().uploadBlocked).toBe(true);

    // The SAME token pushed again does not lift it.
    setAuthState({ ...AUTH });
    await w.idle();
    expect(queueStatus().uploadBlocked).toBe(true);

    // A fresh token does, and the row drains.
    setAuthState({ ...AUTH, accessToken: 'jwt-fresh' });
    await w.idle();
    expect(queueStatus().uploadBlocked).toBe(false);
    expect(ackCount()).toBe(1);
  });

  it('a 401 after transport failures does not launder the station back to healthy', async () => {
    const m = envelope();
    enqueue(m);
    const { fetchImpl } = makeFetch([{ status: 503 }, { status: 503 }, { status: 401 }]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    w.kick();
    await w.idle();
    expect(queueStatus().uploadBlocked).toBe(true);

    w.kick();
    await w.idle();
    expect(queueStatus().uploadBlocked).toBe(true);
  });

  it('501 RPC_NOT_DEPLOYED and 503 DEGRADED_LOCKOUT wait with backoff — never a conflict or a failure', async () => {
    for (const [status, code] of [
      [501, 'RPC_NOT_DEPLOYED'],
      [503, 'DEGRADED_LOCKOUT'],
    ] as const) {
      openQueue().exec('DELETE FROM mutation_queue;');
      results.length = 0;
      const m = envelope();
      enqueue(m);
      const { fetchImpl, calls } = makeFetch([
        { status, body: { result: 'retry', code, message: code } },
        { status: 200, body: { result: 'applied' } },
      ]);
      const w = start(fetchImpl);
      w.kick();
      await w.idle();
      const row = peekNext();
      expect(row?.state, code).toBe('pending');
      expect(row?.lastError, code).toBe(`server ${status}: ${code}`);
      expect(queueStatus().conflicts, code).toBe(0);
      expect(queueStatus().failed, code).toBe(0);
      expect(results, code).toEqual([]);
      // The backoff holds the timer path; the next attempt (here a kick) applies it.
      w.kick();
      await w.idle();
      expect(calls, code).toHaveLength(2);
      expect(queueStatus().blocking, code).toBe(0);
      w.stop();
      worker = null;
    }
  });

  it('a 400 cascade (its tab.open never applied) is a failure that does not wedge the queue', async () => {
    const order = envelope({ payload: { tabIdemKey: 'TILL1:tab.open:01J0000000000000000000000X', items: [] } });
    const next = envelope();
    enqueue(order);
    enqueue(next);
    const { fetchImpl } = makeFetch([
      { status: 400, body: { error: "no tab for tabIdemKey 'TILL1:tab.open:01J0000000000000000000000X' — its tab.open never applied" } },
      { status: 200, body: { result: 'applied' } },
    ]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    expect(results.map((r) => r.state)).toEqual(['failed', 'acked']);
    expect(listBlockingRows()[0]!.lastError).toMatch(/^400: no tab for tabIdemKey/);
  });

  it('cuts a POST that never answers at the deadline, and the queue moves on', async () => {
    const stuck = envelope();
    enqueue(stuck);
    let call = 0;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      call += 1;
      // The first request is swallowed by the network (and ignores its signal);
      // the second, after the backoff, gets through.
      if (call === 1) return new Promise<Response>(() => {});
      expect(init?.signal).toBeDefined();
      return new Response(JSON.stringify({ result: 'applied' }), { status: 200 });
    }) as typeof fetch;
    const w = startSyncWorker({
      onResult: (r) => results.push(r),
      onActivity: () => {},
      fetchImpl,
      tickMs: 3_600_000,
      requestTimeoutMs: 30,
    });
    worker = w;
    await w.idle();
    const row = peekNext();
    expect(row?.state).toBe('pending');
    expect(row?.lastError).toMatch(/timeout after 30 ms/);
    expect(results).toEqual([]);
    w.kick();
    await w.idle();
    expect(queueStatus().blocking).toBe(0);
  });

  it('cuts an answer whose body never finishes, too', async () => {
    enqueue(envelope());
    const fetchImpl = (async () =>
      new Response(new ReadableStream({ start() {} }), { status: 200 })) as unknown as typeof fetch;
    const w = startSyncWorker({
      onResult: (r) => results.push(r),
      onActivity: () => {},
      fetchImpl,
      tickMs: 3_600_000,
      requestTimeoutMs: 30,
    });
    worker = w;
    await w.idle();
    expect(peekNext()?.state).toBe('pending');
    expect(peekNext()?.lastError).toMatch(/timeout/);
    expect(results).toEqual([]); // not acked on a body nobody read
  });

  it('stop() cuts the POST in flight and leaves its row pending', async () => {
    enqueue(envelope());
    let seen: AbortSignal | undefined;
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    const w = startSyncWorker({ onResult: (r) => results.push(r), onActivity: () => {}, fetchImpl, tickMs: 3_600_000 });
    worker = w;
    await new Promise((r) => setTimeout(r, 0));
    w.stop();
    await w.idle();
    expect(seen?.aborted).toBe(true);
    expect(peekNext()?.state).toBe('pending');
  });

  it('acked rows clear uploadBlocked-by-worker on the next success', async () => {
    const m = envelope();
    enqueue(m);
    const { fetchImpl } = makeFetch([{ status: 503 }, { status: 503 }, { status: 200 }]);
    const w = start(fetchImpl);
    w.kick();
    await w.idle();
    w.kick();
    await w.idle();
    expect(queueStatus().uploadBlocked).toBe(true);
    w.kick();
    await w.idle();
    expect(queueStatus().uploadBlocked).toBe(false);
    expect(ackCount()).toBe(1);
  });
});

function ackCount(): number {
  return (
    openQueue()
      .prepare("SELECT COUNT(*) AS c FROM mutation_queue WHERE state = 'acked'")
      .get() as { c: number }
  ).c;
}
