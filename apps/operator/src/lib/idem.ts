/**
 * Idempotency keys per resolved override #2: "{station}:{mutation_type}:{ulid}".
 * Mirrors packages/db/tests/helpers.ts testIdemKey (uppercase hex slice is a
 * valid Crockford-base32 subset). TODO(Electron): real ULIDs from @touch/core
 * mutation envelopes once writes flow through the IPC queue.
 */
import { touch } from '../ipc/bridge';

export function idemKey(mutationType: string): string {
  const pseudoUlid = crypto.randomUUID().replaceAll('-', '').toUpperCase().slice(0, 26);
  const station = touch.getStation().stationId.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return `${station || 'OP1'}:${mutationType}:${pseudoUlid}`;
}

export function deviceId(): string {
  return touch.getStation().stationId;
}
