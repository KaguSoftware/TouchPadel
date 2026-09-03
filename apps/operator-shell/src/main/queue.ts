import * as path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import type { MutationEnvelope, QueueStatus } from '../ipc-channels';

// SQLite durable write queue — design-arch.md §2.2. Flush-before-confirm is contractual:
// journal_mode=WAL + synchronous=FULL, and the IPC promise resolves only after the
// insert has committed.

/** One non-acked row, as the sync worker and the day-close pre-check see it. */
export interface QueueRow {
  seq: number;
  localId: string;
  idempotencyKey: string;
  mutationType: string;
  payload: unknown;
  createdAt: string;
  staffId: string | null;
  deviceId: string | null;
  state: 'pending' | 'inflight' | 'acked' | 'conflict' | 'failed';
  attempts: number;
  lastError: string | null;
}

let db: Database.Database | null = null;

const BASE_DDL = `
  CREATE TABLE IF NOT EXISTS mutation_queue (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT, -- replay order
    local_id        TEXT NOT NULL UNIQUE,              -- '{station}-{ulid}' (plan override #2)
    idempotency_key TEXT NOT NULL UNIQUE,              -- '{station}:{mutation_type}:{ulid}'
    mutation_type   TEXT NOT NULL,                     -- 'order.create' | 'ticket.status' | ...
    payload         TEXT NOT NULL,                     -- JSON, zod-validated before insert
    created_at      TEXT NOT NULL,                     -- station clock, informational
    staff_id        TEXT,                              -- attributed actor; replay 400s without it
    device_id       TEXT,                              -- queue-owning station, key's first segment
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
    pin_hash   TEXT NOT NULL,                          -- scrypt(pin, station salt), cached on online verify
    role       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,                            -- e.g. 'pin_salt', cache bookkeeping
    value TEXT NOT NULL
  );
`;

/**
 * Schema versioning via PRAGMA user_version. v1 (2026-09): staff_id/device_id columns
 * (the replay function hard-requires staff_id — a pre-v1 row can never replay) + meta.
 * ALTER TABLE ADD COLUMN is safe on a live SQLite file; columns stay nullable because
 * SQLite cannot add NOT NULL without a table rewrite — the IPC validator guarantees
 * both fields on every new row.
 */
function migrate(d: Database.Database): void {
  const version = d.pragma('user_version', { simple: true }) as number;
  if (version >= 1) return;
  const cols = d.pragma('table_info(mutation_queue)') as { name: string }[];
  if (!cols.some((c) => c.name === 'staff_id')) {
    d.exec('ALTER TABLE mutation_queue ADD COLUMN staff_id TEXT');
  }
  if (!cols.some((c) => c.name === 'device_id')) {
    d.exec('ALTER TABLE mutation_queue ADD COLUMN device_id TEXT');
  }
  d.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  // A pre-v1 row cannot carry the staff attribution replay demands. Dev machines only
  // (no production queue exists yet) — park it visibly rather than wedge the worker.
  d.exec(
    `UPDATE mutation_queue SET state = 'failed', last_error = 'pre-v1 row: missing staff_id'
     WHERE state IN ('pending','inflight') AND staff_id IS NULL`,
  );
  d.pragma('user_version = 1');
}

/** Open (or create) a queue db at an explicit path — the testable seam. */
export function openQueueAt(file: string): Database.Database {
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.pragma('synchronous = FULL');
  d.exec(BASE_DDL);
  migrate(d);
  return d;
}

export function openQueue(): Database.Database {
  if (db) return db;
  db = openQueueAt(path.join(app.getPath('userData'), 'queue.db'));
  return db;
}

export function enqueue(m: MutationEnvelope): { localId: string; state: 'queued' } {
  // Structural validation happens at the IPC boundary (ipc-validate.ts); the renderer
  // additionally parses the full @touch/core zod envelope before calling the bridge.
  openQueue()
    .prepare(
      `INSERT INTO mutation_queue
         (local_id, idempotency_key, mutation_type, payload, created_at, staff_id, device_id)
       VALUES (@localId, @idempotencyKey, @mutationType, @payload, @createdAt, @staffId, @deviceId)`,
    )
    .run({
      localId: m.localId,
      idempotencyKey: m.idempotencyKey,
      mutationType: m.mutationType,
      payload: JSON.stringify(m.payload ?? null),
      createdAt: m.createdAt,
      staffId: m.staffId,
      deviceId: m.deviceId,
    });
  // better-sqlite3 is synchronous; with synchronous=FULL the WAL is fsynced before
  // .run() returns — safe to confirm to the renderer now.
  return { localId: m.localId, state: 'queued' };
}

function toRow(r: Record<string, unknown>): QueueRow {
  return {
    seq: r.seq as number,
    localId: r.local_id as string,
    idempotencyKey: r.idempotency_key as string,
    mutationType: r.mutation_type as string,
    payload: JSON.parse(r.payload as string) as unknown,
    createdAt: r.created_at as string,
    staffId: (r.staff_id as string | null) ?? null,
    deviceId: (r.device_id as string | null) ?? null,
    state: r.state as QueueRow['state'],
    attempts: r.attempts as number,
    lastError: (r.last_error as string | null) ?? null,
  };
}

/**
 * The sync worker's next row: strictly by seq, one at a time. An 'inflight' row
 * (a POST interrupted by a crash or power cut) always precedes later pendings by
 * seq, so a single ordered query resumes it first — re-sending is safe, that is
 * what the idempotency key is for. 'failed' rows are terminal and skipped so a
 * poisoned row cannot wedge every later sale; they still block day close.
 */
export function peekNext(): QueueRow | undefined {
  const r = openQueue()
    .prepare(
      `SELECT * FROM mutation_queue WHERE state IN ('pending','inflight') ORDER BY seq LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;
  return r ? toRow(r) : undefined;
}

export function markInflight(idempotencyKey: string): void {
  openQueue()
    .prepare(
      `UPDATE mutation_queue SET state = 'inflight', attempts = attempts + 1
       WHERE idempotency_key = ?`,
    )
    .run(idempotencyKey);
}

/** Transient failure (5xx/network): back to pending for the backoff retry. */
export function releaseToPending(idempotencyKey: string, error: string): void {
  openQueue()
    .prepare(
      `UPDATE mutation_queue SET state = 'pending', last_error = @error
       WHERE idempotency_key = @key`,
    )
    .run({ key: idempotencyKey, error });
}

/** 409 from replay: the desk resolves manually — never an overwrite. */
export function markConflict(idempotencyKey: string, detail: unknown): void {
  openQueue()
    .prepare(
      `UPDATE mutation_queue SET state = 'conflict', last_error = @detail
       WHERE idempotency_key = @key`,
    )
    .run({ key: idempotencyKey, detail: JSON.stringify(detail ?? null) });
}

/** Deterministic 4xx from replay: terminal, visible, blocks day close. */
export function markFailed(idempotencyKey: string, error: string): void {
  openQueue()
    .prepare(
      `UPDATE mutation_queue SET state = 'failed', last_error = @error
       WHERE idempotency_key = @key`,
    )
    .run({ key: idempotencyKey, error });
}

export function ack(idempotencyKey: string, serverResult: unknown): void {
  openQueue()
    .prepare(
      `UPDATE mutation_queue SET state = 'acked', server_result = @result, last_error = NULL
       WHERE idempotency_key = @key`,
    )
    .run({ key: idempotencyKey, result: JSON.stringify(serverResult ?? null) });
}

/** Everything that blocks day close: pending, inflight, conflict AND failed rows. */
export function listBlockingRows(): QueueRow[] {
  const rows = openQueue()
    .prepare(
      `SELECT * FROM mutation_queue
       WHERE state IN ('pending','inflight','conflict','failed') ORDER BY seq`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(toRow);
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
    degraded: false, // TODO(A2): reflect renderer conn-state + worker reachability (design-arch.md §3)
  };
}

export function getCachedRef(key: string): unknown {
  const row = openQueue().prepare('SELECT payload FROM ref_cache WHERE key = ?').get(key) as
    | { payload: string }
    | undefined;
  return row ? (JSON.parse(row.payload) as unknown) : undefined;
}

export function getMeta(key: string): string | undefined {
  const row = openQueue().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string): void {
  openQueue()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// The sync worker itself (upload strictly by seq, ONE at a time, to
// POST {supabaseUrl}/functions/v1/replay) lands in A2 — sync-worker.ts. Duplicate
// idempotency_key → server returns stored result (200). Reservation replay hitting
// the EXCLUDE constraint → 409 → markConflict, surfaced in the desk UI. Negative
// stock settles server-side (manager flag), never blocks replay. Day close is
// refused while listBlockingRows() is non-empty. (design-arch.md §2.2.)
