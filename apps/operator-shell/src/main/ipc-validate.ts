import type { MutationEnvelope, PrintJob } from '../ipc-channels';

/**
 * Runtime validation for everything crossing the IPC boundary.
 *
 * The five `ipcMain.handle` callbacks previously took their arguments on trust:
 * the TypeScript annotations (`m: MutationEnvelope`, `key: string`, …) are
 * erased at runtime, so whatever the renderer sent went straight into a SQLite
 * insert. That is the wrong default for the process that holds the durable
 * trading queue.
 *
 * WHY THESE PATTERNS ARE COPIED RATHER THAN IMPORTED. The canonical definitions
 * live in `@touch/core/schemas/mutations` (zod). This package compiles to
 * CommonJS and `require()`s its own emitted JS, while `@touch/core` is an
 * ESM-only workspace package that ships raw TypeScript — so it cannot be a
 * runtime dependency until the main process is bundled (a Wave 5 packaging
 * item). The mirror is therefore deliberate, and `ipc-validate.test.ts`
 * asserts it against the real `@touch/core` exports so the two cannot drift
 * silently.
 *
 * Every validator returns a NEW object containing only known fields. That
 * matters as much as the checking: it stops an unexpected extra property riding
 * along into `JSON.stringify(payload)` and back out again on replay.
 */

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

function fail(what: string): never {
  throw new IpcValidationError(`invalid IPC payload: ${what}`);
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const s = value as string;
  if (s.length === 0) fail(`${field} must not be empty`);
  if (s.length > max) fail(`${field} exceeds ${max} characters`);
  return s;
}

// --- mirrors of @touch/core/schemas/mutations ------------------------------

/** Crockford base32, 26 chars (no I, L, O, U). */
const ULID_SRC = '[0-9A-HJKMNP-TV-Z]{26}';
/** Station / device id, e.g. 'TILL-01', 'DESK-01', 'KDS-01'. */
const STATION_SRC = '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*';

export const MUTATION_TYPES = [
  'order.create',
  'order.add_items',
  'ticket.status',
  'payment.record',
  'reservation.create',
  'reservation.update',
  'waiter_call.action',
  'stock.waste',
  'tab.open',
  'tab.settle',
  'adjustment.apply',
] as const;

const MUTATION_TYPE_ALT = MUTATION_TYPES.map((t) => t.replace(/\./g, '\\.')).join('|');

export const stationRegex = new RegExp(`^${STATION_SRC}$`);
export const clientRefRegex = new RegExp(`^${STATION_SRC}-${ULID_SRC}$`);
export const idempotencyKeyRegex = new RegExp(
  `^${STATION_SRC}:(?:${MUTATION_TYPE_ALT}):${ULID_SRC}$`,
);
/** RFC 4122 textual form, either case — matches zod's uuid() acceptance closely enough. */
const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Comfortably above any real ticket; far below anything that could wedge SQLite. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

export function validateMutationEnvelope(value: unknown): MutationEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('envelope must be an object');
  }
  const raw = value as Record<string, unknown>;

  const localId = requireString(raw.localId, 'localId', 64);
  if (!clientRefRegex.test(localId)) fail('localId must be {STATION}-{ULID}');

  const idempotencyKey = requireString(raw.idempotencyKey, 'idempotencyKey', 128);
  if (!idempotencyKeyRegex.test(idempotencyKey)) {
    fail('idempotencyKey must be {STATION}:{mutation_type}:{ULID}');
  }

  const mutationType = requireString(raw.mutationType, 'mutationType', 64);
  if (!(MUTATION_TYPES as readonly string[]).includes(mutationType)) {
    fail(`unknown mutationType '${mutationType}'`);
  }

  // The key embeds the mutation type; a mismatch means one of the two is wrong,
  // and the replay function cross-checks the same pair server-side, so a row
  // that fails here would otherwise sit in the queue undeliverable.
  const [keyStation, keyType] = idempotencyKey.split(':');
  if (keyType !== mutationType) fail('idempotencyKey does not match mutationType');

  const staffId = requireString(raw.staffId, 'staffId', 64);
  if (!uuidRegex.test(staffId)) fail('staffId must be a uuid');

  // The queue OWNER mints the key: its station segment must equal deviceId, and the
  // replay function 400s on the same mismatch. localId's station may legitimately
  // differ — the till enqueues status updates on the KDS's behalf (single writer).
  const deviceId = requireString(raw.deviceId, 'deviceId', 32);
  if (!stationRegex.test(deviceId)) fail('deviceId must be a station id like TILL-01');
  if (keyStation !== deviceId) {
    fail('idempotencyKey and deviceId disagree on the station');
  }

  const createdAt = requireString(raw.createdAt, 'createdAt', 64);
  if (Number.isNaN(Date.parse(createdAt))) fail('createdAt must be an ISO timestamp');

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(raw.payload ?? null);
  } catch {
    fail('payload is not JSON-serialisable');
  }
  if (serialized === undefined) fail('payload is not JSON-serialisable');
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) fail('payload is too large');

  return {
    localId,
    idempotencyKey,
    mutationType,
    payload: raw.payload ?? null,
    createdAt,
    staffId,
    deviceId,
  };
}

/** Cache keys are a closed set (design-arch.md §2.3), not free-form strings. */
export const REF_KEYS = [
  'menu',
  'prices',
  'recipes',
  'courts',
  'tables',
  'tax_config',
  'staff_pins',
  'reservations',
  'open_tabs',
] as const;
export type RefKey = (typeof REF_KEYS)[number];

export function validateRefKey(value: unknown): RefKey {
  const key = requireString(value, 'refKey', 32);
  if (!(REF_KEYS as readonly string[]).includes(key)) fail(`unknown ref key '${key}'`);
  return key as RefKey;
}

const PRINT_KINDS = ['receipt', 'kitchen', 'reprint'] as const;

export function validatePrintJob(value: unknown): PrintJob {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('print job must be an object');
  }
  const raw = value as Record<string, unknown>;
  const kind = requireString(raw.kind, 'kind', 16);
  if (!(PRINT_KINDS as readonly string[]).includes(kind)) fail(`unknown print kind '${kind}'`);
  return { kind: kind as PrintJob['kind'], data: raw.data ?? null };
}

/**
 * PIN: digits only, length-bounded. Verification is server-side against
 * `crypt()` (design-data.md), so this only refuses junk — but a PIN is also the
 * one IPC argument that must never reach a log line, so the value is never
 * echoed in the error message.
 */
export function validatePin(value: unknown): string {
  if (typeof value !== 'string') fail('pin must be a string');
  const pin = value as string;
  if (!/^\d{4,12}$/.test(pin)) fail('pin must be 4-12 digits');
  return pin;
}
