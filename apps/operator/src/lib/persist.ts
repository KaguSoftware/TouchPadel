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

/**
 * Bump on ANY shape change to a persisted query's payload — a column added to
 * its select, a field renamed, an embed added or dropped.
 *
 * The buster is the only thing standing between an old payload and new code
 * that reads it, but `VITE_APP_VERSION` is undefined in dev: without this the
 * dev buster is the constant `op-dev`, so a station warm-starts forever from
 * the shape it cached before the change and the version half never fires.
 * That is not hypothetical — c1b98ef added `orders`, `tab_adjustments`,
 * `payments` and `total_iqd` to ['tabs'], and every station that had cached
 * the previous shape hydrated rows with no `orders` straight into
 * `computeTabTotals`, taking /till/tabs down with a TypeError mid-service.
 *
 * 2 — c1b98ef: ['tabs'] gained the totals embeds + total_iqd and the court on
 *     the reservation; ['menu'] gained sold_out / unavailable_on.
 */
const PERSIST_SHAPE = 2;

export const PERSIST_BUSTER = `op-${import.meta.env.VITE_APP_VERSION ?? 'dev'}-s${PERSIST_SHAPE}`;

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
