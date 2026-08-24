import * as path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import type { MutationEnvelope, QueueStatus } from '../ipc-channels';

// SQLite durable write queue — design-arch.md §2.2. Flush-before-confirm is contractual:
// journal_mode=WAL + synchronous=FULL, and the IPC promise resolves only after the
// insert has committed.

let db: Database.Database | null = null;

export function openQueue(): Database.Database {
  if (db) return db;
  const file = path.join(app.getPath('userData'), 'queue.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS mutation_queue (
      seq             INTEGER PRIMARY KEY AUTOINCREMENT, -- replay order
      local_id        TEXT NOT NULL UNIQUE,              -- '{station}-{ulid}' (plan override #2)
      idempotency_key TEXT NOT NULL UNIQUE,              -- '{station}:{mutation_type}:{ulid}'
      mutation_type   TEXT NOT NULL,                     -- 'order.create' | 'ticket.status' | ...
      payload         TEXT NOT NULL,                     -- JSON, zod-validated before insert
      created_at      TEXT NOT NULL,                     -- station clock, informational
      state           TEXT NOT NULL DEFAULT 'pending',   -- pending|inflight|acked|conflict|failed
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT,
      server_result   TEXT                               -- JSON echo (server ids/timestamps) on ack
    );
    CREATE TABLE IF NOT EXISTS ref_cache (
      key        TEXT PRIMARY KEY,                       -- menu|prices|recipes|courts|tables|... (§2.3)
      payload    TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pin_cache (
      staff_id   TEXT PRIMARY KEY,
      pin_hash   TEXT NOT NULL,                          -- refreshed online; offline unlock later (W3)
      role       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

export function enqueue(m: MutationEnvelope): { localId: string; state: 'queued' } {
  // TODO(W2): validate payload against the @touch/core zod schema for m.mutationType
  // BEFORE inserting (design-arch.md §2.2 write protocol).
  openQueue()
    .prepare(
      `INSERT INTO mutation_queue (local_id, idempotency_key, mutation_type, payload, created_at)
       VALUES (@localId, @idempotencyKey, @mutationType, @payload, @createdAt)`,
    )
    .run({
      localId: m.localId,
      idempotencyKey: m.idempotencyKey,
      mutationType: m.mutationType,
      payload: JSON.stringify(m.payload ?? null),
      createdAt: m.createdAt,
    });
  // better-sqlite3 is synchronous; with synchronous=FULL the WAL is fsynced before
  // .run() returns — safe to confirm to the renderer now.
  return { localId: m.localId, state: 'queued' };
}

export function ack(idempotencyKey: string, serverResult: unknown): void {
  openQueue()
    .prepare(
      `UPDATE mutation_queue SET state = 'acked', server_result = @result
       WHERE idempotency_key = @key`,
    )
    .run({ key: idempotencyKey, result: JSON.stringify(serverResult ?? null) });
}

export function queueStatus(): QueueStatus {
  const row = openQueue()
    .prepare(
      `SELECT
         SUM(CASE WHEN state IN ('pending','inflight') THEN 1 ELSE 0 END) AS depth,
         SUM(CASE WHEN state = 'conflict' THEN 1 ELSE 0 END) AS conflicts
       FROM mutation_queue`,
    )
    .get() as { depth: number | null; conflicts: number | null };
  return {
    depth: row.depth ?? 0,
    conflicts: row.conflicts ?? 0,
    degraded: false, // TODO(W3): reflect heartbeat/connection state (design-arch.md §3)
  };
}

export function getCachedRef(key: string): unknown {
  const row = openQueue().prepare('SELECT payload FROM ref_cache WHERE key = ?').get(key) as
    | { payload: string }
    | undefined;
  return row ? (JSON.parse(row.payload) as unknown) : undefined;
}

// TODO(W3): sync worker — on reconnect, upload strictly by seq, ONE at a time, to
// POST {SUPABASE_URL}/functions/v1/replay with { idempotency_key, mutation_type,
// payload, station_id }. Duplicate idempotency_key → server returns stored result (200).
// Reservation replay hitting the EXCLUDE constraint → 409 → state 'conflict', surfaced
// in the desk UI. Negative stock settles server-side (manager flag), never blocks replay.
// Day close is refused while state IN ('pending','inflight','conflict') rows exist.
// (design-arch.md §2.2 replay protocol.)
