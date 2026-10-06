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

/**
 * Key for an online-only RPC that takes `p_idempotency_key` but is not a queued mutation type
 * (loyalty_redeem, L-6): "{station}:{rpc}:{ulid}", idemKey's shape with the RPC's name where the
 * mutation type would be. It never enters the queue, so the queue validator never sees it; the
 * server only needs it unique per press (claim_replay).
 */
export function onlineKey(rpc: string): string {
  const s = station();
  return `${s}:${rpc}:${makeClientRef(s).slice(s.length + 1)}`;
}
