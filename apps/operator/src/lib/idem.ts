/**
 * Idempotency keys per resolved override #2: "{station}:{mutation_type}:{ulid}".
 * Real Crockford ULIDs via @touch/core (audit M9 closed) — the queue validator and
 * the replay function both refuse the old hex pseudo-ULIDs. The station segment is
 * sanitised once so a dev station id can never produce a key the server rejects.
 */
import {
  makeClientRef,
  makeIdempotencyKey,
  stationRegex,
  type MutationType,
} from '@touch/core/schemas/mutations';
import { touch } from '../ipc/bridge';

export function station(): string {
  const raw = touch
    .getStation()
    .stationId.toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  return stationRegex.test(raw) ? raw : 'OP1';
}

export function idemKey(mutationType: MutationType): string {
  return makeIdempotencyKey(station(), mutationType);
}

/** Client entity ref "{station}-{ulid}" (stored server-side as client_ref). */
export function clientRef(): string {
  return makeClientRef(station());
}

export function deviceId(): string {
  return station();
}
