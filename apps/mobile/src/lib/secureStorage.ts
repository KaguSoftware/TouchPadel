import * as SecureStore from 'expo-secure-store';
import {
  CHUNK_SIZE,
  PURGE_SWEEP_LIMIT,
  buildManifest,
  chunkKeyNames,
  parseManifest,
  splitChunks,
} from './chunk';

/**
 * Chunking storage adapter for expo-secure-store.
 *
 * WHY: SecureStore is keychain/keystore-backed and warns (iOS) or fails
 * (Android) above roughly 2048 bytes PER VALUE. A Supabase session — access JWT
 * + refresh token + the full user object with metadata — routinely exceeds
 * that. Writing it unchunked is the single most common Expo+Supabase production
 * failure: the write is silently dropped, and the user is "randomly logged out"
 * on next launch with nothing in any log.
 *
 * HOW: values at or under CHUNK_SIZE are stored verbatim, so existing
 * unchunked sessions keep working with no migration step. Larger values are
 * split into `<key>.0 … <key>.n-1` and `<key>` holds a manifest naming the
 * count. Reads detect the manifest; deletes clean up every slice.
 *
 * The manifest prefix is deliberately not valid JSON so it can never collide
 * with a real (JSON) session payload.
 */


async function clearChunks(key: string, upTo: number): Promise<void> {
  await Promise.all(chunkKeyNames(key, upTo).map((k) => SecureStore.deleteItemAsync(k)));
}

export { splitChunks, parseManifest, buildManifest, chunkKeyNames, CHUNK_SIZE, PURGE_SWEEP_LIMIT } from './chunk';

export const chunkedSecureStore = {
  async getItem(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key);
    const count = parseManifest(head);
    if (count === null) return head; // plain value (or absent)

    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)),
    );
    // A missing slice means a torn write — treat the whole value as absent
    // rather than handing Supabase a truncated session it will fail to parse.
    if (parts.some((p) => p === null)) {
      await this.removeItem(key);
      return null;
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    // Always clear a previous chunked write first, or a shrinking value leaves
    // orphan slices that a later, larger write would read back interleaved.
    const prev = parseManifest(await SecureStore.getItemAsync(key));
    if (prev !== null) await clearChunks(key, prev);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const chunks = splitChunks(value);
    await Promise.all(chunks.map((c, i) => SecureStore.setItemAsync(`${key}.${i}`, c)));
    await SecureStore.setItemAsync(key, buildManifest(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    const count = parseManifest(await SecureStore.getItemAsync(key));
    if (count !== null) await clearChunks(key, count);
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * SEC-16 — remove a key AND every slice that could belong to it.
 *
 * `chunkedSecureStore.removeItem` is the right thing for normal use: it reads
 * the manifest and deletes exactly the slices it names. That is precisely why
 * it is NOT enough for a deletion. It deletes what the manifest CLAIMS, and the
 * two states a deletion has to survive are the ones where the manifest lies:
 *
 *   - the manifest is gone but slices remain (a torn `removeItem`, or a torn
 *     `setItem` that wrote chunks and died before the manifest). `removeItem`
 *     then reads null, concludes "not chunked", deletes the head key alone, and
 *     leaves refresh-token fragments in the keychain forever.
 *   - the value shrank from many chunks to few and an earlier write's orphans
 *     were never claimed by any manifest since.
 *
 * So this sweeps blind to PURGE_SWEEP_LIMIT after doing the manifest-driven
 * removal. Blind means "delete this key whether or not anything is there";
 * SecureStore.deleteItemAsync on an absent key is a no-op, not an error.
 *
 * Never throws. A keychain that refuses one delete must not abort the purge and
 * leave the REST of the session behind — the caller has already destroyed the
 * account server-side, so failing loudly here would strand the user in an app
 * holding a session for a user that no longer exists.
 */
export async function purgeSecureKey(key: string): Promise<void> {
  try {
    await chunkedSecureStore.removeItem(key);
  } catch {
    /* fall through to the blind sweep — it covers the head key too */
  }
  const kills = [key, ...chunkKeyNames(key, PURGE_SWEEP_LIMIT)].map(async (k) => {
    try {
      await SecureStore.deleteItemAsync(k);
    } catch {
      /* one stubborn slice must not abort the rest */
    }
  });
  await Promise.all(kills);
}

/**
 * Purge several keys. Sequential rather than parallel: each key already fans
 * out to PURGE_SWEEP_LIMIT + 1 keychain calls, and iOS's keychain serialises
 * under contention anyway — running the whole cross-product at once buys
 * nothing and has been the source of `errSecNotAvailable` on cold keystores.
 */
export async function purgeSecureKeys(keys: readonly string[]): Promise<void> {
  for (const key of keys) await purgeSecureKey(key);
}
