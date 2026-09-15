/**
 * Where supabase-js keeps the session — derived, not guessed.
 *
 * WHY THIS EXISTS AT ALL. The account-deletion purge (SEC-16) has to remove
 * every trace of the session from the keychain, and SecureStore has no "list
 * every key" API: a purge can only delete keys it can NAME. The session lives
 * under supabase-js's default storage key, which the client computes from the
 * project URL and never exposes.
 *
 * WHY NOT JUST PIN `storageKey` IN createClient. That is the obvious fix and it
 * is the wrong one: every install already has its session under the derived
 * key, so pinning a different one signs out the entire user base on upgrade for
 * no benefit. Deriving it the same way costs one function and breaks nobody.
 *
 * THE DERIVATION IS supabase-js's OWN, verified against
 * node_modules/@supabase/supabase-js/dist/index.cjs (v2.112.3):
 *
 *   const defaultStorageKey = `sb-${baseUrl.hostname.split('.')[0]}-auth-token`
 *
 * If a future supabase-js changes that expression this module goes stale
 * SILENTLY — the purge would sweep a key nothing is stored under and report
 * success. `deletion.test.ts` pins the exact format against the real project
 * URL shape so the drift is a red test rather than a quiet regression.
 *
 * Pure (no expo / react-native imports) so it runs under the plain-node vitest
 * setup, same reason chunk.ts is split out of secureStorage.ts.
 */

/**
 * supabase-js's default auth storage key for a project URL.
 *
 * Returns null for a URL that does not parse — the unconfigured-build sentinel
 * (`http://unconfigured.invalid`) parses fine and yields a harmless key, but a
 * genuinely malformed env value must not throw inside a deletion flow. The
 * caller treats null as "nothing derivable to purge" and still purges the
 * static keys.
 */
export function authStorageKeyFor(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const ref = host.split('.')[0];
    return ref ? `sb-${ref}-auth-token` : null;
  } catch {
    return null;
  }
}
