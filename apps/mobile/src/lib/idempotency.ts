import { makeIdempotencyKey } from '@touch/core';

/**
 * Idempotency key for mobile-originated reservation writes, per resolved
 * override #2: "{station}:{mutation_type}:{ulid}". The mobile app is one
 * logical station.
 */
export function reservationIdemKey(): string {
  return makeIdempotencyKey('MOBILE', 'reservation.create');
}
