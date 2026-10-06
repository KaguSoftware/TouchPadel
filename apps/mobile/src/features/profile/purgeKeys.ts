/**
 * SEC-16 — everything this app has written about the signed-in guest.
 *
 * This module exists to be a LIST, and it is PURE (no expo / react-native /
 * AsyncStorage imports) for one reason: the list is the part a test has to be
 * able to read. `localPurge.ts` does the deleting and cannot be loaded under
 * the plain-node vitest setup; if the list lived there it could only be
 * verified by reading it, which is exactly how the web security headers came to
 * ship as nothing (macbook-docker-checks.md §4).
 *
 * Why a hand-maintained list at all: neither store can be enumerated at
 * deletion time. SecureStore has no "list every key" API, and the AsyncStorage
 * keys that matter are built from a uuid at their call site. A purge can only
 * delete keys it can NAME. So they are written down here, next to the reason
 * each one is on the list, and `deletion.test.ts` pins them.
 *
 * WHAT IS DELIBERATELY NOT PURGED:
 *
 *   tp.locale, tp.appearance   Preferences, not identity. They say nothing
 *                              about who the guest was, and wiping them would
 *                              flip an Arabic dark-mode phone back to English
 *                              light at the exact moment its owner is already
 *                              upset. Deleting an account is not a factory
 *                              reset of the app.
 */
import { authStorageKeyFor } from '../../lib/authStorageKey';
import { historyClearedKey } from '../booking/historyKeys';
import { pendingPaymentKey } from '../deposit/pendingPayment';
import { MEMBER_CARD_STORE_KEY } from '../loyalty/logic';

/**
 * The SecureStore keys a purge must sweep.
 *
 * supabase-js's session, under the key it derives from the project URL (see
 * authStorageKey.ts for why it is derived rather than pinned), and the member
 * card's offline copy (loyalty plan §5.1: its TOTP secret, features/loyalty/
 * cardStore.ts). Sign-out removes the card too; it is listed here so a purge
 * that runs without a sign-out event still names it.
 * `purgeSecureKey` expands each of these to its chunk slices, which is where
 * the refresh token actually lives.
 */
export function secureKeysToPurge(supabaseUrl: string | undefined): string[] {
  const authKey = authStorageKeyFor(supabaseUrl);
  return authKey ? [authKey, MEMBER_CARD_STORE_KEY] : [MEMBER_CARD_STORE_KEY];
}

/**
 * The AsyncStorage keys a purge must remove, given the account being deleted.
 *
 * `tp.historyClearedAt.<uid>` is the one that matters and the one that is easy
 * to miss: it is not a session, so no sign-out path touches it, and its KEY
 * contains the guest's auth uuid. Left behind, the device keeps a durable
 * record that this specific account existed and when its owner last tidied
 * their bookings — on a phone whose owner has just been told everything was
 * deleted.
 *
 * `tp.pendingPayment.<uid>` (build-contracts-2026-09-27 §4) is the same kind
 * of key: the device's pointer to an online deposit still in flight, named by
 * the uuid and holding the payment's ref. The money trail lives on the server
 * (guest_id is nulled there, the payment row kept); nothing on this phone may
 * keep pointing at it after the account is gone. An open-match ticket purchase
 * uses the same pointer, and the action it continues (join, ask or start,
 * docs/design/open-matches/guest.md §4.10.3) rides inside it as `after`, so
 * open matches add no key of their own here (§4.23).
 *
 * Returns nothing for a missing id rather than building
 * `tp.historyClearedAt.undefined`, which would delete a key belonging to
 * nobody and report success.
 */
export function localKeysToPurge(userId: string | null | undefined): string[] {
  return userId ? [historyClearedKey(userId), pendingPaymentKey(userId)] : [];
}
