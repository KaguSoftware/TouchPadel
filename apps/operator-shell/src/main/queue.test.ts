import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  openQueue,
  openQueueAt,
  enqueue,
  ack,
  queueStatus,
  getCachedRef,
  peekNext,
  markInflight,
  markConflict,
  markFailed,
  releaseToPending,
  listBlockingRows,
  getMeta,
  setMeta,
} from './queue';
import type { MutationEnvelope } from '../ipc-channels';

// The SQLite queue is where the contract's hardest promise lives: "Every write
// flushed to disk before the screen confirms it, so a power cut cannot lose a
// confirmed ticket" (SOW L681-682). It had ZERO tests — the package had no test
// script at all, so `turbo test` skipped it in silence.

const STAFF = '5c9f1f1e-2b3a-4c4d-8e9f-0000000000aa';

function envelope(over: Partial<MutationEnvelope> = {}): MutationEnvelope {
  return {
    localId: 'TILL1-01J5XAAAAAAAAAAAAAAAAAAAAA',
    idempotencyKey: 'TILL1:order.create:01J5XAAAAAAAAAAAAAAAAAAAAA',
    mutationType: 'order.create',
    payload: { tabId: 'abc', lines: [] },
    createdAt: '2026-08-28T09:00:00.000Z',
    staffId: STAFF,
    deviceId: 'TILL1',
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
  openQueue().exec(
    'DELETE FROM mutation_queue; DELETE FROM ref_cache; DELETE FROM pin_cache; DELETE FROM meta;',
  );
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

describe('schema v1 migration', () => {
  function legacyDbFile(): string {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tp-queue-')), 'queue.db');
    const legacy = new Database(file);
    // The exact pre-v1 shape: no staff_id/device_id, no meta table.
    legacy.exec(`
      CREATE TABLE mutation_queue (
        seq             INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id        TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        mutation_type   TEXT NOT NULL,
        payload         TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        state           TEXT NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        server_result   TEXT
      );
    `);
    legacy
      .prepare(
        `INSERT INTO mutation_queue (local_id, idempotency_key, mutation_type, payload, created_at, state)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'TILL1-01J5XCCCCCCCCCCCCCCCCCCCCC',
        'TILL1:order.create:01J5XCCCCCCCCCCCCCCCCCCCCC',
        'order.create',
        '{}',
        '2026-08-28T09:00:00.000Z',
        'pending',
      );
    legacy.close();
    return file;
  }

  it('adds staff_id/device_id + meta and stamps user_version 1', () => {
    const d = openQueueAt(legacyDbFile());
    const cols = (d.pragma('table_info(mutation_queue)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('staff_id');
    expect(cols).toContain('device_id');
    expect(d.pragma('user_version', { simple: true })).toBe(1);
    expect(() => d.exec("INSERT INTO meta (key, value) VALUES ('k','v')")).not.toThrow();
    d.close();
  });

  it('parks pre-v1 pending rows as failed — replay hard-requires staff_id', () => {
    const d = openQueueAt(legacyDbFile());
    const row = d
      .prepare('SELECT state, last_error FROM mutation_queue')
      .get() as { state: string; last_error: string };
    expect(row.state).toBe('failed');
    expect(row.last_error).toMatch(/staff_id/);
    d.close();
  });

  it('is idempotent — a v1 db reopens untouched', () => {
    const file = legacyDbFile();
    openQueueAt(file).close();
    const d = openQueueAt(file);
    expect(d.pragma('user_version', { simple: true })).toBe(1);
    d.close();
  });
});

describe('enqueue', () => {
  it('persists the envelope as a pending row with staff and device attribution', () => {
    const m = unique();
    expect(enqueue(m)).toEqual({ localId: m.localId, state: 'queued' });

    const row = openQueue()
      .prepare('SELECT * FROM mutation_queue WHERE idempotency_key = ?')
      .get(m.idempotencyKey) as Record<string, unknown>;

    expect(row.state).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.mutation_type).toBe('order.create');
    expect(row.staff_id).toBe(STAFF);
    expect(row.device_id).toBe('TILL1');
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

describe('worker state machine', () => {
  it('peekNext returns rows strictly by seq, one at a time', () => {
    const a = unique();
    const b = unique();
    enqueue(a);
    enqueue(b);
    expect(peekNext()?.idempotencyKey).toBe(a.idempotencyKey);
    ack(a.idempotencyKey, {});
    expect(peekNext()?.idempotencyKey).toBe(b.idempotencyKey);
  });

  it('resumes an inflight row before later pendings — a crash mid-POST re-sends', () => {
    const a = unique();
    const b = unique();
    enqueue(a);
    enqueue(b);
    markInflight(a.idempotencyKey);
    // Worker restarts here (power cut): the interrupted row comes back first.
    expect(peekNext()?.state).toBe('inflight');
    expect(peekNext()?.idempotencyKey).toBe(a.idempotencyKey);
  });

  it('markInflight counts attempts; releaseToPending keeps the row replayable', () => {
    const m = unique();
    enqueue(m);
    markInflight(m.idempotencyKey);
    releaseToPending(m.idempotencyKey, 'fetch failed: ECONNREFUSED');
    markInflight(m.idempotencyKey);
    const row = peekNext();
    expect(row?.attempts).toBe(2);
    expect(row?.lastError).toMatch(/ECONNREFUSED/);
  });

  it('a failed row is terminal and skipped — a poisoned write must not wedge later sales', () => {
    const poison = unique();
    const good = unique();
    enqueue(poison);
    enqueue(good);
    markFailed(poison.idempotencyKey, 'staff_id is not active staff');
    expect(peekNext()?.idempotencyKey).toBe(good.idempotencyKey);
  });

  it('a conflict row leaves the replay lane but still blocks day close', () => {
    const clash = unique();
    const next = unique();
    enqueue(clash);
    enqueue(next);
    markConflict(clash.idempotencyKey, { code: 'SLOT_TAKEN' });
    expect(peekNext()?.idempotencyKey).toBe(next.idempotencyKey);
    const blocking = listBlockingRows().map((r) => r.state);
    expect(blocking).toEqual(['conflict', 'pending']);
  });

  it('listBlockingRows reports pending, inflight, conflict and failed — never acked', () => {
    const states = [unique(), unique(), unique(), unique(), unique()];
    states.forEach(enqueue);
    markInflight(states[1]!.idempotencyKey);
    markConflict(states[2]!.idempotencyKey, {});
    markFailed(states[3]!.idempotencyKey, 'boom');
    ack(states[4]!.idempotencyKey, {});
    expect(listBlockingRows().map((r) => r.state)).toEqual([
      'pending',
      'inflight',
      'conflict',
      'failed',
    ]);
  });
});

describe('queueStatus', () => {
  it('reports zero on an empty queue', () => {
    expect(queueStatus()).toEqual({ depth: 0, conflicts: 0, degraded: false });
  });

  it('counts pending and inflight as depth, and conflicts separately', () => {
    const pending = unique();
    const inflight = unique();
    const conflict = unique();
    const acked = unique();
    [pending, inflight, conflict, acked].forEach(enqueue);
    markInflight(inflight.idempotencyKey);
    markConflict(conflict.idempotencyKey, {});
    ack(acked.idempotencyKey, {});

    const s = queueStatus();
    expect(s.depth).toBe(2);
    expect(s.conflicts).toBe(1);
  });

  it('KNOWN GAP: degraded is hard-coded false, not derived from the heartbeat', () => {
    // queue.ts — `degraded: false, // TODO(A2)`. The banner the contract
    // requires ("A banner states the mode and the queued count", SOW L688)
    // therefore cannot be driven from this value yet. Locked in a test so the
    // A2 fix has something to flip.
    const m = unique();
    enqueue(m);
    expect(queueStatus().degraded).toBe(false);
  });
});

describe('ack', () => {
  it('marks the row acked, stores the server echo and clears the last error', () => {
    const m = unique();
    enqueue(m);
    markInflight(m.idempotencyKey);
    releaseToPending(m.idempotencyKey, 'transient');
    ack(m.idempotencyKey, { reservation_id: 'r-1', status: 'held' });

    const row = openQueue()
      .prepare('SELECT state, server_result, last_error FROM mutation_queue WHERE idempotency_key = ?')
      .get(m.idempotencyKey) as { state: string; server_result: string; last_error: string | null };
    expect(row.state).toBe('acked');
    expect(JSON.parse(row.server_result)).toEqual({ reservation_id: 'r-1', status: 'held' });
    expect(row.last_error).toBeNull();
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
    // The table exists; the writer lands in A4 (touch:cache-put).
    expect(getCachedRef('menu')).toBeUndefined();
  });

  it('round-trips a row once one exists', () => {
    openQueue()
      .prepare('INSERT INTO ref_cache (key, payload, fetched_at) VALUES (?, ?, ?)')
      .run('menu', JSON.stringify([{ id: 'i1' }]), '2026-08-28T09:00:00.000Z');
    expect(getCachedRef('menu')).toEqual([{ id: 'i1' }]);
  });
});

describe('meta', () => {
  it('round-trips and upserts', () => {
    expect(getMeta('pin_salt')).toBeUndefined();
    setMeta('pin_salt', 'aaaa');
    setMeta('pin_salt', 'bbbb');
    expect(getMeta('pin_salt')).toBe('bbbb');
  });
});
