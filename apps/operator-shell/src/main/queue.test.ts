import { describe, it, expect, beforeEach } from 'vitest';
import { openQueue, enqueue, ack, queueStatus, getCachedRef } from './queue';
import type { MutationEnvelope } from '../ipc-channels';

// The SQLite queue is where the contract's hardest promise lives: "Every write
// flushed to disk before the screen confirms it, so a power cut cannot lose a
// confirmed ticket" (SOW L681-682). It had ZERO tests — the package had no test
// script at all, so `turbo test` skipped it in silence.

function envelope(over: Partial<MutationEnvelope> = {}): MutationEnvelope {
  return {
    localId: 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAA',
    idempotencyKey: 'TILL1:order.create:01J5XAAAAAAAAAAAAAAAAAAAAA',
    mutationType: 'order.create',
    payload: { tabId: 'abc', lines: [] },
    createdAt: '2026-08-28T09:00:00.000Z',
    ...over,
  };
}

let n = 0;
/** Distinct-but-shaped keys, so uniqueness tests are about the schema not the fixture. */
function unique(over: Partial<MutationEnvelope> = {}): MutationEnvelope {
  const suffix = String(n++).padStart(26, 'B');
  return envelope({
    localId: `TILL1-${suffix}`,
    idempotencyKey: `TILL1:order.create:${suffix}`,
    ...over,
  });
}

beforeEach(() => {
  openQueue().exec('DELETE FROM mutation_queue; DELETE FROM ref_cache; DELETE FROM pin_cache;');
});

describe('durability pragmas', () => {
  // These two are the whole reason the queue is SQLite and not a JSON file.
  it('runs in WAL mode', () => {
    expect(openQueue().pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('fsyncs every commit (synchronous = FULL)', () => {
    // 2 === FULL. Anything lower (NORMAL=1) means the WAL is not fsynced on
    // commit, and a power cut can lose a ticket the screen already confirmed.
    expect(openQueue().pragma('synchronous', { simple: true })).toBe(2);
  });
});

describe('enqueue', () => {
  it('persists the envelope as a pending row', () => {
    const m = unique();
    expect(enqueue(m)).toEqual({ localId: m.localId, state: 'queued' });

    const row = openQueue()
      .prepare('SELECT * FROM mutation_queue WHERE idempotency_key = ?')
      .get(m.idempotencyKey) as Record<string, unknown>;

    expect(row.state).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.mutation_type).toBe('order.create');
    expect(JSON.parse(row.payload as string)).toEqual(m.payload);
    expect(row.server_result).toBeNull();
  });

  it('refuses a duplicate idempotency key', () => {
    // "an idempotency key per write, so … a replay cannot double-charge"
    // (SOW L683-684). The uniqueness is enforced by the schema, not by caller
    // discipline — a retried IPC call must not create a second row.
    const m = unique();
    enqueue(m);
    expect(() => enqueue({ ...m, localId: `${m.localId}X` })).toThrow(/UNIQUE/i);
  });

  it('refuses a duplicate local id', () => {
    const m = unique();
    enqueue(m);
    expect(() => enqueue({ ...m, idempotencyKey: `${m.idempotencyKey}X` })).toThrow(/UNIQUE/i);
  });

  it('preserves insertion order in seq', () => {
    // Replay is "in order on reconnect" (SOW L685) — seq is the ordering, and
    // it must not depend on insertion timestamps from an unsynced station clock.
    const a = unique();
    const b = unique();
    enqueue(b);
    enqueue(a);
    const seqs = openQueue()
      .prepare('SELECT idempotency_key FROM mutation_queue ORDER BY seq')
      .all() as { idempotency_key: string }[];
    expect(seqs.map((r) => r.idempotency_key)).toEqual([b.idempotencyKey, a.idempotencyKey]);
  });

  it('stores a null payload without collapsing the row', () => {
    const m = unique({ payload: null });
    enqueue(m);
    const row = openQueue()
      .prepare('SELECT payload FROM mutation_queue WHERE idempotency_key = ?')
      .get(m.idempotencyKey) as { payload: string };
    expect(JSON.parse(row.payload)).toBeNull();
  });
});

describe('queueStatus', () => {
  it('reports zero on an empty queue', () => {
    expect(queueStatus()).toEqual({ depth: 0, conflicts: 0, degraded: false });
  });

  it('counts pending and inflight as depth, and conflicts separately', () => {
    const db = openQueue();
    const pending = unique();
    const inflight = unique();
    const conflict = unique();
    const acked = unique();
    [pending, inflight, conflict, acked].forEach(enqueue);
    db.prepare("UPDATE mutation_queue SET state='inflight' WHERE idempotency_key=?").run(
      inflight.idempotencyKey,
    );
    db.prepare("UPDATE mutation_queue SET state='conflict' WHERE idempotency_key=?").run(
      conflict.idempotencyKey,
    );
    db.prepare("UPDATE mutation_queue SET state='acked' WHERE idempotency_key=?").run(
      acked.idempotencyKey,
    );

    const s = queueStatus();
    expect(s.depth).toBe(2);
    expect(s.conflicts).toBe(1);
  });

  it('KNOWN GAP: degraded is hard-coded false, not derived from the heartbeat', () => {
    // queue.ts:87 — `degraded: false, // TODO(W3)`. The banner the contract
    // requires ("A banner states the mode and the queued count", SOW L688)
    // therefore cannot be driven from this value yet. Locked in a test so the
    // Wave 3 fix has something to flip.
    const m = unique();
    enqueue(m);
    expect(queueStatus().degraded).toBe(false);
  });
});

describe('ack', () => {
  it('marks the row acked and stores the server echo', () => {
    const m = unique();
    enqueue(m);
    ack(m.idempotencyKey, { reservation_id: 'r-1', status: 'held' });

    const row = openQueue()
      .prepare('SELECT state, server_result FROM mutation_queue WHERE idempotency_key = ?')
      .get(m.idempotencyKey) as { state: string; server_result: string };
    expect(row.state).toBe('acked');
    expect(JSON.parse(row.server_result)).toEqual({ reservation_id: 'r-1', status: 'held' });
    expect(queueStatus().depth).toBe(0);
  });

  it('is a no-op for an unknown key rather than throwing', () => {
    expect(() => ack('TILL1:order.create:NOPE', {})).not.toThrow();
  });
});

describe('getCachedRef', () => {
  it('KNOWN GAP: always misses, because nothing populates ref_cache', () => {
    // SOW L671-672 requires the till to keep trading "from cached reference
    // data: menu, prices, recipes, courts, tables and today's reservations".
    // The table exists; there is no writer anywhere in the repo.
    expect(getCachedRef('menu')).toBeUndefined();
  });

  it('round-trips a row once one exists', () => {
    openQueue()
      .prepare('INSERT INTO ref_cache (key, payload, fetched_at) VALUES (?, ?, ?)')
      .run('menu', JSON.stringify([{ id: 'i1' }]), '2026-08-28T09:00:00.000Z');
    expect(getCachedRef('menu')).toEqual([{ id: 'i1' }]);
  });
});
