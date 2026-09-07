import * as path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import type { MutationEnvelope, QueueStatus } from '../ipc-channels';
import { decryptSecret, encryptSecret, isEncryptionAvailable } from './secret-store';

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
  state: 'pending' | 'inflight' | 'acked' | 'conflict' | 'failed' | 'resolved';
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
    payload_enc     INTEGER NOT NULL DEFAULT 0,        -- v4/SEC-32: 1 = safeStorage ciphertext
    created_at      TEXT NOT NULL,                     -- station clock, informational
    staff_id        TEXT,                              -- attributed actor; replay 400s without it
    device_id       TEXT,                              -- queue-owning station, key's first segment
    state           TEXT NOT NULL DEFAULT 'pending',   -- pending|inflight|acked|conflict|failed|resolved
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    server_result   TEXT,                              -- JSON echo (server ids/timestamps) on ack
    resolved_by     TEXT,                              -- v3: staff id of the manager who dismissed it
    resolved_at     TEXT                               -- v3: when (station clock)
  );
  CREATE TABLE IF NOT EXISTS ref_cache (
    key        TEXT PRIMARY KEY,                       -- menu|prices|recipes|courts|tables|... (§2.3)
    payload    TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pin_cache (
    pin_hash   TEXT PRIMARY KEY,                       -- scrypt(pin, station salt), cached on online success
    role       TEXT NOT NULL,                          -- authorisation level the pin demonstrated
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
  if (version < 1) {
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
  if (version < 2) {
    // v2: pin_cache re-keyed from staff_id to pin_hash (authorisation-token
    // model — the server never exposes whose pin a hash is). The v1 table was
    // never written by anything, so drop-and-recreate loses no data.
    const pinCols = d.pragma('table_info(pin_cache)') as { name: string }[];
    if (pinCols.some((c) => c.name === 'staff_id')) {
      d.exec('DROP TABLE pin_cache');
      d.exec(`CREATE TABLE pin_cache (
        pin_hash   TEXT PRIMARY KEY,
        role       TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
    }
    d.pragma('user_version = 2');
  }
  if (version < 4) {
    // v4 (SEC-32): the payload column is encrypted at rest. `payload_enc` says
    // which encoding a row uses, so an existing plaintext queue keeps replaying
    // instead of being lost — a station mid-service must not have its queue
    // invalidated by an upgrade.
    const cols = d.pragma('table_info(mutation_queue)') as { name: string }[];
    if (!cols.some((c) => c.name === 'payload_enc')) {
      d.exec('ALTER TABLE mutation_queue ADD COLUMN payload_enc INTEGER NOT NULL DEFAULT 0');
    }
  }
  if (version < 3) {
    // v3: a manager can dismiss a conflict/failed row from the day-close
    // screen (resolveRow). Who and when live on the row — it is never deleted.
    const cols = d.pragma('table_info(mutation_queue)') as { name: string }[];
    if (!cols.some((c) => c.name === 'resolved_by')) {
      d.exec('ALTER TABLE mutation_queue ADD COLUMN resolved_by TEXT');
    }
    if (!cols.some((c) => c.name === 'resolved_at')) {
      d.exec('ALTER TABLE mutation_queue ADD COLUMN resolved_at TEXT');
    }
    d.pragma('user_version = 3');
  }
  d.pragma('user_version = 4');
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

/**
 * A queued row whose payload cannot be read back — the Windows profile was
 * recreated, the app runs as a different user, the machine was reimaged. The
 * mutation can never replay; what matters is that it becomes VISIBLE to a
 * manager rather than being silently skipped or replayed with a null body.
 */
export class QueuePayloadUnreadableError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`queued payload cannot be decrypted (${idempotencyKey})`);
    this.name = 'QueuePayloadUnreadableError';
  }
}

/**
 * Thrown by enqueue when the station cannot encrypt. SEC-32 asks the till to
 * REFUSE TO TRADE OFFLINE rather than fall back to plaintext, and this is that
 * refusal: the renderer surfaces it and the sale is taken online or not at all.
 */
export class QueueEncryptionUnavailableError extends Error {
  constructor() {
    super('offline queue unavailable: this machine cannot encrypt at rest');
    this.name = 'QueueEncryptionUnavailableError';
  }
}

/**
 * SEC-32 — the queue payload is encrypted at rest.
 *
 * WHY. A queued PIN-gated mutation carries the TYPED PIN: apps/operator
 * src/lib/mutate.ts maps `p_pin: p?.pin` into the replayed RPC args for
 * override_price and apply_discount, because the server re-verifies it at
 * replay. So `queue.db` held staff authorisation PINs in plaintext JSON on an
 * unmanaged Windows box — the same credential the pin_cache work went to
 * lengths to protect, sitting in the next table over.
 *
 * safeStorage binds the key to the logged-in Windows account (DPAPI), so the
 * file is inert once copied off the machine.
 */
function encodePayload(payload: unknown): { text: string; enc: 0 | 1 } {
  const json = JSON.stringify(payload ?? null);
  if (!isEncryptionAvailable()) throw new QueueEncryptionUnavailableError();
  return { text: encryptSecret(json), enc: 1 };
}

function decodePayload(text: string, enc: number, idempotencyKey: string): unknown {
  if (enc !== 1) return JSON.parse(text) as unknown; // pre-v4 row, still replayable
  const plain = decryptSecret(text);
  if (plain === null) throw new QueuePayloadUnreadableError(idempotencyKey);
  return JSON.parse(plain) as unknown;
}

export function enqueue(m: MutationEnvelope): { localId: string; state: 'queued' } {
  // Structural validation happens at the IPC boundary (ipc-validate.ts); the renderer
  // additionally parses the full @touch/core zod envelope before calling the bridge.
  // Encoded BEFORE the insert so a station that cannot encrypt refuses the write
  // outright rather than half-committing it.
  const encoded = encodePayload(m.payload);
  openQueue()
    .prepare(
      `INSERT INTO mutation_queue
         (local_id, idempotency_key, mutation_type, payload, payload_enc, created_at, staff_id, device_id)
       VALUES (@localId, @idempotencyKey, @mutationType, @payload, @payloadEnc, @createdAt, @staffId, @deviceId)`,
    )
    .run({
      localId: m.localId,
      idempotencyKey: m.idempotencyKey,
      mutationType: m.mutationType,
      payload: encoded.text,
      payloadEnc: encoded.enc,
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
    payload: decodePayload(
      r.payload as string,
      (r.payload_enc as number) ?? 0,
      r.idempotency_key as string,
    ),
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
  // Loop rather than a single read: a row whose payload cannot be decrypted is
  // parked as `failed` and the worker moves on. It stays visible in
  // listBlockingRows (and so still blocks day close) instead of wedging every
  // later sale behind a row that can never replay.
  for (;;) {
    const r = openQueue()
      .prepare(
        `SELECT * FROM mutation_queue WHERE state IN ('pending','inflight') ORDER BY seq LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;
    if (!r) return undefined;
    try {
      return toRow(r);
    } catch (err) {
      if (!(err instanceof QueuePayloadUnreadableError)) throw err;
      markFailed(r.idempotency_key as string, err.message);
    }
  }
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

/**
 * A manager dismissing a row the worker will never deliver. Only 'conflict' and
 * 'failed' qualify — a pending/inflight row is still travelling and an acked
 * row is already on the server. The row stays in the table as 'resolved' with
 * who and when, so the audit trail of what this station tried to write is
 * complete; it just stops blocking day close and disappears from the banner.
 * Returns false when the key is unknown or the row is not in a resolvable state.
 */
export function resolveRow(idempotencyKey: string, resolvedBy: string | null): boolean {
  const info = openQueue()
    .prepare(
      `UPDATE mutation_queue
         SET state = 'resolved', resolved_by = @by, resolved_at = @at
       WHERE idempotency_key = @key AND state IN ('conflict','failed')`,
    )
    .run({ key: idempotencyKey, by: resolvedBy, at: new Date().toISOString() });
  return info.changes === 1;
}

/** Everything that blocks day close: pending, inflight, conflict AND failed rows. */
export function listBlockingRows(): QueueRow[] {
  const rows = openQueue()
    .prepare(
      `SELECT * FROM mutation_queue
       WHERE state IN ('pending','inflight','conflict','failed') ORDER BY seq`,
    )
    .all() as Record<string, unknown>[];
  // A row that cannot be decrypted still BLOCKS: the manager must see that
  // something is stuck even though its contents are unrecoverable.
  return rows.map((r) => {
    try {
      return toRow(r);
    } catch (err) {
      if (!(err instanceof QueuePayloadUnreadableError)) throw err;
      return {
        seq: r.seq as number,
        localId: r.local_id as string,
        idempotencyKey: r.idempotency_key as string,
        mutationType: r.mutation_type as string,
        payload: null,
        createdAt: r.created_at as string,
        staffId: (r.staff_id as string | null) ?? null,
        deviceId: (r.device_id as string | null) ?? null,
        state: 'failed' as QueueRow['state'],
        attempts: r.attempts as number,
        lastError: err.message,
      };
    }
  });
}

/**
 * Degraded inputs — two independent witnesses, either one flips the flag:
 * the renderer's heartbeat verdict (pushed over touch:conn-state after every
 * beat) and the sync worker's own transport failures. The renderer's BANNER
 * still prefers the server's res.degraded when a beat succeeds; this local
 * flag is what remains truthful when the server cannot be reached at all.
 */
let rendererOnline = true;
let workerUnreachable = false;

export function setConnOnline(online: boolean): void {
  rendererOnline = online;
}

export function setWorkerUnreachable(unreachable: boolean): void {
  workerUnreachable = unreachable;
}

export function queueStatus(): QueueStatus {
  const row = openQueue()
    .prepare(
      `SELECT
         SUM(CASE WHEN state IN ('pending','inflight') THEN 1 ELSE 0 END) AS depth,
         SUM(CASE WHEN state = 'conflict' THEN 1 ELSE 0 END) AS conflicts,
         SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM mutation_queue`,
    )
    .get() as { depth: number | null; conflicts: number | null; failed: number | null };
  const depth = row.depth ?? 0;
  const conflicts = row.conflicts ?? 0;
  const failed = row.failed ?? 0;
  return {
    depth,
    conflicts,
    failed,
    blocking: depth + conflicts + failed,
    degraded: !rendererOnline || workerUnreachable,
  };
}

export function getCachedRef(key: string): { payload: unknown; fetchedAt: string } | undefined {
  const row = openQueue()
    .prepare('SELECT payload, fetched_at FROM ref_cache WHERE key = ?')
    .get(key) as { payload: string; fetched_at: string } | undefined;
  return row
    ? { payload: JSON.parse(row.payload) as unknown, fetchedAt: row.fetched_at }
    : undefined;
}

/** Upsert one reference-data payload; main stamps fetched_at (SOW L671: the till
 *  trades from cached menu/prices/courts/tables/reservations, and the banner
 *  shows the data's age). */
export function putCachedRef(key: string, payload: unknown): void {
  openQueue()
    .prepare(
      `INSERT INTO ref_cache (key, payload, fetched_at) VALUES (@key, @payload, @at)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .run({ key, payload: JSON.stringify(payload ?? null), at: new Date().toISOString() });
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
// refused while listBlockingRows() is non-empty; a conflict/failed row leaves
// that set only through resolveRow (manager PIN, day-close screen). (design-arch.md §2.2.)
