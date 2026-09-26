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

/**
 * The staff writes that take `p_idempotency_key` (build-contracts-2026-09-23
 * §6.4): each one's server body brackets its work with `app.claim_replay`, so a
 * retry that reuses the key replays the first answer instead of recording
 * twice. Decisions, ticks, withdrawals, skips and stops are state-idempotent
 * (a repeat hits a state code) and take no key.
 */
export type StaffMutation =
  | 'start'
  | 'submit'
  | 'launch'
  | 'shopping.add'
  | 'purchase'
  | 'batch'
  | 'note'
  | 'marketing_note'
  | 'campaign'
  | 'event_block'
  | 'candidate'
  // Role spec (H): save_teaching (a new one), add_suggestion, request_recipe_change.
  | 'teaching'
  | 'suggestion'
  | 'recipe_change'
  // Role spec (H): add_marketing_request.
  | 'marketing_request'
  // Role spec (H): submit_release_idea.
  | 'idea'
  // Wave 5 (P, wave5-addendum-2026-09-25 §5.3): propose_deduction,
  // submit_incident, and submit_content and revise_content.
  | 'deduction'
  | 'incident'
  | 'content'
  // Wave 5 (S, §5.3): log_stock, transfer_stock, submit_stock_count.
  | 'stock_log'
  | 'stock_move'
  | 'stock_count';

/** Fresh staff key, `MOBILE:staff.<mutation>:<ulid>`. Only for a genuinely new intent. */
export function staffIdemKey(mutation: StaffMutation): string {
  return `MOBILE:staff.${mutation}:${ulid()}`;
}

/**
 * Stable staff key for one intent, the `idemKeyFor` rule for staff writes: a
 * form mints it when it opens (the intent names the form, e.g.
 * `submit:<runStepId>`), every retry reuses it, and `clearStaffIntentKey` drops
 * it once the write has succeeded, so the next submission is a new intent.
 */
const staffIntentKeys = new Map<string, string>();

export function staffIntentKey(intent: string, mutation: StaffMutation): string {
  const existing = staffIntentKeys.get(intent);
  if (existing) return existing;
  const key = staffIdemKey(mutation);
  staffIntentKeys.set(intent, key);
  return key;
}

export function clearStaffIntentKey(intent: string): void {
  staffIntentKeys.delete(intent);
}
