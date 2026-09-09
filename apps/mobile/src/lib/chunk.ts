/**
 * Pure chunking helpers for the SecureStore adapter.
 *
 * Split out of secureStorage.ts so they can be unit-tested: that module imports
 * expo-secure-store, and the vitest setup runs under plain node where nothing
 * may import expo/react-native.
 */

export const CHUNK_SIZE = 1800; // headroom under SecureStore's ~2048-byte limit

/** Not valid JSON, so it can never collide with a real session payload. */
const MANIFEST = '__tpchunk__:';

export function splitChunks(value: string, size: number = CHUNK_SIZE): string[] {
  if (size <= 0) throw new RangeError('chunk size must be positive');
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out;
}

/** Read a manifest string, or null when the value is not chunked. */
export function parseManifest(raw: string | null): number | null {
  if (!raw || !raw.startsWith(MANIFEST)) return null;
  const n = Number(raw.slice(MANIFEST.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function buildManifest(count: number): string {
  return `${MANIFEST}${count}`;
}

/** Split an array into consecutive groups of `size` (the last may be shorter). */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The slice keys a chunked value of `count` parts occupies: `k.0 … k.{count-1}`.
 *
 * Shared by the adapter's own cleanup and by the deletion purge (SEC-16), so
 * the two can never disagree about where a slice lives — a purge that swept a
 * different naming scheme than the writer used would look like it worked and
 * leave JWT fragments in the keychain.
 */
export function chunkKeyNames(key: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer');
  return Array.from({ length: count }, (_, i) => `${key}.${i}`);
}

/**
 * How far past the manifest a purge sweeps for ORPHAN slices (SEC-16).
 *
 * A torn write — the process dying between `setItem`'s chunk writes and its
 * manifest write, or between `removeItem`'s two steps — leaves slices with no
 * manifest pointing at them. `removeItem` reads the manifest to decide what to
 * delete, so it deletes nothing in that state and the fragments survive. A
 * deletion has to remove them anyway, so it sweeps blind to this bound.
 *
 * 64 * 1800 bytes = ~115 KB, two orders of magnitude past any Supabase session,
 * and the sweep costs 64 keychain misses once, on a screen the user only ever
 * reaches to destroy their account.
 */
export const PURGE_SWEEP_LIMIT = 64;
