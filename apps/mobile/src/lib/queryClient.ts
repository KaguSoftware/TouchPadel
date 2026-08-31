import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { QueryCache, QueryClient, MutationCache, focusManager, onlineManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { isTransportError } from './network';
import { addBreadcrumb, captureException } from './telemetry';

/**
 * The whole query layer used to be four lines: `{ staleTime: 30_000, retry: 1 }`.
 * That meant:
 *   - TanStack assumed "always online" on native, so queries FAILED on a dead
 *     connection instead of pausing, and nothing resumed on reconnect;
 *   - nothing refetched when the app came back to the foreground, while a 60 s
 *     poll kept running in the background;
 *   - a cold start with no network was a blank app, because nothing was cached;
 *   - every RPC business error (a P0001 like SLOT_TAKEN) was retried once,
 *     doubling the latency of an error the server had already decided.
 */

// ── online: pause, don't fail ────────────────────────────────────────────────
//
// "Online" is `isConnected` and NOTHING else. NetInfo's `isInternetReachable` is
// a probe of https://clients3.google.com/generate_204 (iOS, from JS, retried
// every 5 s) or Android's own captive-portal validation — also Google-based,
// and forced false behind any VPN reporting zero downstream bandwidth. On a
// network where Google is filtered or slow it stays false FOREVER while every
// Supabase request succeeds, which pinned the red "You are offline" bar to an
// app that was working. The Supabase host is the only reachability that
// matters, and a failed request tells us about that directly.
NetInfo.configure({ reachabilityShouldRun: () => false });

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    const online = state.isConnected !== false; // unknown (null) counts as online
    addBreadcrumb('net.change', { online, type: state.type });
    setOnline(online);
  }),
);

// ── focus: refetch on foreground, not on a timer ─────────────────────────────
export function startFocusLifecycle(): () => void {
  const onChange = (status: AppStateStatus) => focusManager.setFocused(status === 'active');
  const sub = AppState.addEventListener('change', onChange);
  return () => sub.remove();
}

/**
 * A Supabase RPC business error is a decision, not a blip — retrying it just
 * burns time before showing the user the same message. Retry transport
 * failures (lib/network.ts) and server faults only.
 */
function isRetriable(error: unknown): boolean {
  if (isTransportError(error)) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  // PostgREST/PostgREST-adjacent server faults are worth one more go.
  if (/\b(5\d\d)\b/.test(message)) return true;
  // Anything that reads like a raised app code (SLOT_TAKEN, FORBIDDEN, …) is final.
  return !/^[A-Z][A-Z0-9_]{3,}$/m.test(message);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep data around long enough for the persister to be worth having.
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => failureCount < 3 && isRetriable(error),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
    },
    mutations: {
      // A write that never left the device is safe to retry; one that may have
      // committed is not. Idempotency keys make hold_slot safe either way
      // (see src/lib/idempotency.ts), so one retry is the right budget.
      retry: (failureCount, error) => failureCount < 1 && isRetriable(error),
      networkMode: 'offlineFirst',
    },
  },
  // Central failure logging — previously nothing anywhere logged a failed query.
  queryCache: new QueryCache({
    onError: (error, query) =>
      captureException(error, { scope: 'query', queryKey: query.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) =>
      captureException(error, { scope: 'mutation', mutationKey: mutation.options.mutationKey }),
  }),
});

/**
 * Disk cache so a cold start paints real data immediately instead of spinners.
 *
 * `buster` is the app version: a build that changes query shapes must not read
 * a previous build's cache back.
 */
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'tp.query-cache.v1',
  throttleTime: 2_000,
});

/**
 * Never persist authenticated, user-specific data we cannot re-authorise on
 * restore, and never persist a failed query.
 */
export const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60 * 1000,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { state: { status: string }; queryKey: readonly unknown[] }) =>
      query.state.status === 'success' &&
      query.queryKey[0] !== 'my-bookings' &&
      query.queryKey[0] !== 'reservation',
  },
} as const;

/**
 * Sign-out must wipe the cache.
 *
 * Without this, account B signing in on the same device saw account A's cached
 * `my-bookings` until staleTime expired — a cross-account data leak. Clearing
 * the persister too, or the same rows come straight back from disk.
 */
export async function clearAllCaches(): Promise<void> {
  queryClient.clear();
  try {
    await persister.removeClient();
    addBreadcrumb('cache.cleared');
  } catch (error) {
    captureException(error, { label: 'cache.clear' });
  }
}
