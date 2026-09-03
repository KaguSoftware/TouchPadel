/**
 * TanStack Query cache persistence — the WARM-START half of the caching story
 * (the shell's SQLite ref_cache is the offline-trading half; see refCache.ts).
 * A kiosk cold boot used to paint nothing until the network answered; now the
 * last session's menu, tab rail, day and courts paint instantly and refetch in
 * the background.
 *
 * Whitelist, not everything: money detail (['tab', id]) must never render
 * stale-as-current, the KDS queue must never show yesterday's tickets, and
 * analytics/audit are heavy and owner-only. The buster drops the whole cache
 * whenever the app version changes — a shape change in any cached query must
 * never be deserialised into new code.
 */
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

export const PERSIST_BUSTER = `op-${import.meta.env.VITE_APP_VERSION ?? 'dev'}`;

const PERSISTED_ROOTS = new Set(['menu', 'tabs', 'day', 'courts', 'activeCafeTables', 'venueSettings', 'taxInclusive']);

/** Structural type: react-query and query-core disagree on Query's privates. */
interface PersistableQuery {
  queryKey: readonly unknown[];
  state: { status: string };
}

export function shouldPersistQuery(query: PersistableQuery): boolean {
  const root = query.queryKey[0];
  return typeof root === 'string' && PERSISTED_ROOTS.has(root) && query.state.status === 'success';
}

export function makePersister() {
  return createSyncStoragePersister({
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
    key: 'touch-operator-query-cache',
    // localStorage writes are sync; throttle so a chatty invalidation burst
    // doesn't serialise the cache dozens of times a second.
    throttleTime: 2_000,
  });
}
