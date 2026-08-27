import { factory } from 'ulid';

/**
 * Idempotency keys for mobile-originated reservation writes, per resolved
 * override #2: "{station}:{mutation_type}:{ulid}". Mobile is one logical station.
 *
 * TWO things were wrong here and both are fixed:
 *
 * 1. THE GENERATOR. `@touch/core`'s makeIdempotencyKey uses ulid's ambient PRNG
 *    detection, which is broken under Hermes (see index.js). index.js polyfills
 *    global.crypto so the ambient path works — but relying on an import in
 *    another file for a money-path invariant is too fragile, so we seed the
 *    generator explicitly here as an independent second layer. If the polyfill
 *    is ever lost, this still works.
 *
 * 2. THE LIFETIME. The key used to be minted INSIDE the mutationFn, so every
 *    retry carried a NEW key and app.hold_slot's dedupe could never fire. A
 *    request that timed out at the network layer but committed server-side then
 *    created a SECOND hold — and the guest was told SLOT_TAKEN for a slot they
 *    were already holding. A key must be minted once per user INTENT and reused
 *    across every retry of that intent; `idemKeyFor` does exactly that.
 */

const prng = () => {
  const b = new Uint8Array(1);
  // Polyfilled by react-native-get-random-values (index.js).
  globalThis.crypto.getRandomValues(b);
  return b[0]! / 0xff;
};

const ulid = factory(prng);

/** Fresh key. Only for a genuinely new intent. */
export function reservationIdemKey(): string {
  return `MOBILE:reservation.create:${ulid()}`;
}

/**
 * Stable key for one user intent, memoised by an intent id (e.g.
 * `${courtId}|${startAt}|${durationMin}`). Calling this twice for the same
 * intent returns the SAME key, which is what makes app.hold_slot's
 * idempotency_key dedupe reachable from this client.
 */
const intentKeys = new Map<string, string>();

export function idemKeyFor(intent: string): string {
  const existing = intentKeys.get(intent);
  if (existing) return existing;
  const key = reservationIdemKey();
  intentKeys.set(intent, key);
  return key;
}

/** Drop a memoised key once its intent has definitively completed. */
export function clearIdemKey(intent: string): void {
  intentKeys.delete(intent);
}
