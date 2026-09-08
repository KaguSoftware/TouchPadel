/**
 * refCache — offline reads for the drill-critical queries (SOW L671-672: the
 * till keeps trading from cached menu, prices, courts, tables and today's
 * reservations).
 *
 * Cache-put-on-read, not a separate refresher loop: every successful fetch of
 * a wrapped query pushes its payload to the shell's SQLite ref_cache (main
 * stamps fetched_at), so the natural query traffic — 10 s staleTime, realtime
 * invalidations, polling safety nets — keeps the cache as fresh as the screens
 * themselves. On a fetch failure in Electron the wrapper answers from the
 * cache instead, tagging nothing: the caller renders exactly what it rendered
 * while online, and the degraded banner carries the mode. Browser mode has no
 * cache and simply rethrows — dev and e2e behave as before.
 */
import { touch, type RefKey } from '../ipc/bridge';
import { isElectron } from './mutate';
import { captureException } from './telemetry';

export async function cachedQuery<T>(key: RefKey, fn: () => Promise<T>): Promise<T> {
  try {
    const value = await fn();
    if (isElectron()) touch.cachePut(key, value);
    return value;
  } catch (error) {
    if (isElectron()) {
      const hit = await touch.getCachedRef(key).catch(() => undefined);
      if (hit !== undefined) {
        captureException(error, { label: 'cachedQuery.fallback', key });
        return hit.payload as T;
      }
    }
    throw error;
  }
}

/** The cached row's age, for the degraded banner ("trading from data as of…"). */
export async function cachedFetchedAt(key: RefKey): Promise<string | null> {
  if (!isElectron()) return null;
  const hit = await touch.getCachedRef(key).catch(() => undefined);
  return hit?.fetchedAt ?? null;
}
