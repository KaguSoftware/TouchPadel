import * as SecureStore from 'expo-secure-store';
import { CHUNK_SIZE, buildManifest, parseManifest, splitChunks } from './chunk';

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
  const kills: Promise<void>[] = [];
  for (let i = 0; i < upTo; i++) kills.push(SecureStore.deleteItemAsync(`${key}.${i}`));
  await Promise.all(kills);
}

export { splitChunks, parseManifest, buildManifest, CHUNK_SIZE } from './chunk';

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
