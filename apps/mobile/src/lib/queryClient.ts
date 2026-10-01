import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { QueryCache, QueryClient, MutationCache, focusManager, onlineManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { isRetryableError } from '@touch/core';
import { errorMessageOf, isTransportError } from './network';
import { addBreadcrumb, captureException, captureMessage } from './telemetry';

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
 * A raised app.* code (SLOT_TAKEN, DEGRADED_LOCKOUT, FORBIDDEN, …). PostgREST
 * surfaces `raise exception 'CODE'` as the error MESSAGE.
 *
 * Read through errorMessageOf: supabase-js rejects with a plain PostgrestError
 * OBJECT, not an Error, so the old `error instanceof Error ? … : String(error)`
 * saw '[object Object]' for every RPC refusal — no code ever matched, and each
 * one was retried once before the screen could show a decision the server had
 * already made.
 */
function isAppRefusal(error: unknown): boolean {
  const message = errorMessageOf(error);
  return message !== null && /^[A-Z][A-Z0-9_]{3,}$/m.test(message.trim());
}

/**
 * A Supabase RPC business error is a decision, not a blip — retrying it just
 * burns time before showing the user the same message. The one predicate every
 * client uses (`isRetryableError`, @touch/core net/retry.ts) retries transport
 * failures, timeouts (every request has a deadline, lib/supabase.ts), server
 * faults (5xx, 429) and the transient SQLSTATEs (deadlock, statement timeout);
 * never a raised app code, a 4xx or any other SQLSTATE.
 *
 * It used to retry anything that did not LOOK like an app code, so a
 * permission error or a missing function was asked three more times.
 */
export function isRetriable(error: unknown): boolean {
  return isRetryableError(error);
}

/**
 * Retry for a write that is safe to send twice: one more go, for a failure
 * the server never judged. Only for writes that carry an idempotency key or
 * whose RPC answers a repeat with its first answer — see `mutations` below.
 */
export function retryKeyedWriteOnce(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && isRetriable(error);
}

/**
 * Central failure logging — previously nothing anywhere logged a failed query.
 *
 * A raised app code is a DECISION the screen already renders to the guest
 * (booking/errors.ts maps every one of them), not a fault: reporting it as an
 * exception buries real crashes in the reporter, and in DEV threw the red
 * LogBox "Console Error" dialog over a booking screen that was calmly showing
 * the reason — which is how a desk-only slot refused with DEGRADED_LOCKOUT
 * looked like a crash. Still recorded, as a warning, so the breadcrumb trail
 * keeps it.
 */
function reportFailure(error: unknown, context: Record<string, unknown>): void {
  if (isAppRefusal(error)) {
    captureMessage(errorMessageOf(error) ?? 'rpc refusal', 'warning', context);
    return;
  }
  captureException(error, context);
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
      // Never automatic by default. A write whose answer was lost may well have
      // committed, and sending it again is only safe when the server can tell
      // the repeat from a new write: an idempotency key (hold_slot, match_start,
      // the staff writes), or an RPC that answers a repeat with its first answer
      // (confirm_booking, the deposit and match families). Those opt in with
      // `retryKeyedWriteOnce` (per hook, or per family below). cancel_reservation
      // has neither: its automatic retry got NOT_CANCELLABLE for a booking the
      // first attempt had cancelled, and the guest read "cannot cancel".
      retry: false,
      networkMode: 'offlineFirst',
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => reportFailure(error, { scope: 'query', queryKey: query.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) =>
      reportFailure(error, { scope: 'mutation', mutationKey: mutation.options.mutationKey }),
  }),
});

/**
 * The guest's booking writes that are safe to send twice (features/booking/
 * hooks.ts keys): hold_slot carries a per-intent idempotency key
 * (src/lib/idempotency.ts), and confirm_booking answers a repeat on a booking
 * it already confirmed with `{ duplicate: true }` and the same reservation —
 * the hold id is its key. Both may pause offline and go on reconnect, as
 * before. cancel_reservation is NOT here: see the mutation default above.
 */
queryClient.setMutationDefaults(['hold-slot'], { retry: retryKeyedWriteOnce });
queryClient.setMutationDefaults(['confirm-booking'], { retry: retryKeyedWriteOnce });

/**
 * Staff writes run now or fail now (build-contracts-2026-09-23 §6.4).
 *
 * The app's mutation default above is `offlineFirst`, which can pause a write
 * with no connection and fire it minutes later: right for a guest's booking
 * retry, wrong for a staff decision or a purchase that must be seen to have
 * landed before the person walks away. Every staff `useMutation` carries a key
 * under `['staff', 'mutation']` (staffKeys.mutation, src/features/staff/keys.ts),
 * and TanStack applies these defaults by that prefix. One retry, transport and
 * server faults only, as everywhere else; a keyed write replays its first
 * answer (`app.claim_replay`), so the retry cannot record twice.
 */
queryClient.setMutationDefaults(['staff', 'mutation'], {
  networkMode: 'always',
  retry: retryKeyedWriteOnce,
});

/**
 * The online deposit (build-contracts-2026-09-27 §4), keyed under
 * `depositKeys` (features/deposit/keys.ts).
 *
 * `begin` runs now or fails now, like a staff write: a payment page that a
 * paused mutation opened minutes after the tap, on whatever screen the guest
 * had moved to, is worse than "no connection". One retry is safe because the
 * edge function answers a live attempt with the same ref and page.
 *
 * The quote fails FAST. Review falls back to its plain Confirm when it cannot
 * read the terms (a server without deposit_quote answers PGRST202, which
 * reads as a server fault and would otherwise hold the button for three
 * backed-off retries); only a dropped connection is worth one more go.
 */
queryClient.setMutationDefaults(['deposit', 'mutation'], {
  networkMode: 'always',
  retry: retryKeyedWriteOnce,
});
queryClient.setQueryDefaults(['deposit', 'quote'], {
  retry: (failureCount, error) => failureCount < 1 && isTransportError(error),
});

/**
 * Open matches (docs/design/open-matches/guest.md §4.23), keyed under
 * `matchKeys` (features/matches/keys.ts).
 *
 * Every match write runs now or fails now (DF-11): nothing is queued, so a
 * join never lands minutes after the tap on a match that has moved on. One
 * retry is safe because every write is keyed (`match_start`) or answers a
 * repeat as `duplicate`, and `ticket-begin` answers a live attempt with the
 * same ref.
 *
 * The Book tab's chips fail FAST, like the deposit quote: a server without
 * `match_slots` answers PGRST202, and the sheet must not sit on three
 * backed-off retries of a call that can only fail again.
 */
queryClient.setMutationDefaults(['match', 'mutation'], {
  networkMode: 'always',
  retry: retryKeyedWriteOnce,
});
queryClient.setQueryDefaults(['match', 'slots'], {
  retry: (failureCount, error) => failureCount < 1 && isTransportError(error),
});

/**
 * Coach mode (docs/design/coaching/guest.md §4.7.3), keyed under `coachKeys`
 * (features/coach/keys.ts). Every coaching write runs now or fails now (CD-6):
 * nothing is queued. One retry is safe because the booking and creation
 * writes are keyed and every other coach write is state-idempotent. The book
 * screen's free times fail fast, like the match chips: the screen falls back
 * to a start picker.
 */
queryClient.setMutationDefaults(['coach', 'mutation'], {
  networkMode: 'always',
  retry: retryKeyedWriteOnce,
});
queryClient.setQueryDefaults(['coach', 'slots'], {
  retry: (failureCount, error) => failureCount < 1 && isTransportError(error),
});

/**
 * Coaching, the guest's side (docs/design/coaching/guest.md §4.7.3), keyed
 * under `coachingKeys` (features/coaching/keys.ts). As for open matches: every
 * lesson write runs now or fails now (CD-6, nothing is queued); one retry is
 * safe because the bookings and joins are keyed and every other write is
 * state-idempotent. A coach's grid fails fast on a server without
 * `coach_slots`, like the match chips.
 */
queryClient.setMutationDefaults(['coaching', 'mutation'], {
  networkMode: 'always',
  retry: retryKeyedWriteOnce,
});
queryClient.setQueryDefaults(['coaching', 'slots'], {
  retry: (failureCount, error) => failureCount < 1 && isTransportError(error),
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
 * restore, and never persist a failed query. The whole `staff` family stays in
 * memory: a staff row, a work list or a purchase read back from disk would be
 * shown before the account is re-checked, possibly a previous account's. So
 * does the `deposit` family: a payment's state painted from disk on a cold
 * start is exactly the "paid" (or "failed") the server never said. And the
 * `match` family (open matches, the ticket wallet): a match read carries other
 * players' names, and a wallet read back from disk would be shown before it
 * is re-checked (guest.md §4.23). And the `coaching` family (lessons): a
 * lesson read carries money, and a held enrolment read back from disk would
 * be shown before it is re-checked (coaching guest.md §4.7.3). And the
 * `coach` family (coach mode): a roster carries students' phones and a
 * statement the coach's pay (coaching guest.md §4.7.3).
 */
export const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60 * 1000,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { state: { status: string }; queryKey: readonly unknown[] }) =>
      query.state.status === 'success' &&
      query.queryKey[0] !== 'my-bookings' &&
      query.queryKey[0] !== 'reservation' &&
      query.queryKey[0] !== 'staff' &&
      query.queryKey[0] !== 'deposit' &&
      query.queryKey[0] !== 'match' &&
      query.queryKey[0] !== 'coaching' &&
      query.queryKey[0] !== 'coach',
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
