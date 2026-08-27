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
