/**
 * The deposit's React bindings: the three calls as queries and a mutation, the
 * pending-payment pointer on AsyncStorage, and the resume that reopens the
 * payment screen after a killed app (build-contracts-2026-09-27 §4).
 *
 * Retry, online-pause and persistence for this family are set once, in
 * lib/queryClient.ts, by the `depositKeys` prefixes: the quote fails fast to
 * Review's plain Confirm, `begin` runs now or fails now, and nothing under
 * `['deposit']` is written to the disk cache.
 */
import { useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, usePathname, useRootNavigationState } from 'expo-router';
import type { Locale } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { captureException } from '../../lib/telemetry';
import { useLocale } from '../../i18n/LocaleProvider';
import { useAuth } from '../auth/context';
import { bookingKeys } from '../booking/hooks';
import { depositBegin, depositQuote, depositStatus } from './api';
import { openPaymentPage } from './browser';
import { depositKeys } from './keys';
import {
  fetchFailureOf,
  isPollingScreen,
  pollDelayMs,
  screenFor,
  serverNowMs,
  type DepositStatus,
} from './logic';
import {
  claimResume,
  isResumable,
  isResumeSafePath,
  readPendingPayment,
  removePendingPayment,
  takeReturnRef,
  writePendingPayment,
  type KeyValueStore,
  type PendingPayment,
} from './pendingPayment';

export { depositKeys };

const store: KeyValueStore = AsyncStorage;

// ── Queries ─────────────────────────────────────────────────────────────────

/** Review's deposit terms for a hold (app.deposit_quote). */
export function useDepositQuote(holdId: string) {
  const { session } = useAuth();
  return useQuery({
    queryKey: depositKeys.quote(holdId),
    queryFn: () => depositQuote(supabase, holdId),
    enabled: !!session && !!holdId,
    // Re-read on every Review: the owner can switch the mode at any time.
    staleTime: 0,
  });
}

/**
 * The payment screen's one read, polled on the contract's cadence (logic.ts
 * `pollDelayMs`) from `startedAtMs`, the moment the screen opened.
 *
 * The foreground refetch is the app-wide one (queryClient.ts wires AppState
 * into focusManager): with `staleTime: 0`, coming back from the bank app or
 * the payment sheet asks the server again at once.
 */
export function useDepositStatus(ref: string, startedAtMs: number) {
  const { session } = useAuth();
  return useQuery({
    queryKey: depositKeys.status(ref),
    queryFn: () => depositStatus(supabase, ref),
    enabled: !!session && !!ref,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = (query.state.data as DepositStatus | undefined) ?? null;
      const deviceNow = Date.now();
      const serverNow = serverNowMs(data?.serverNow ?? null, query.state.dataUpdatedAt, deviceNow);
      const screen = screenFor({
        status: data,
        failure: fetchFailureOf(query.state.error),
        nowMs: serverNow,
      });
      if (!isPollingScreen(screen.kind)) return false;
      // The deadline is on the server's clock; move it onto the device's.
      const deadline = data?.deadlineAt ? Date.parse(data.deadlineAt) : NaN;
      return pollDelayMs({
        startedAtMs,
        nowMs: deviceNow,
        deadlineMs: Number.isFinite(deadline) ? deadline - (serverNow - deviceNow) : null,
      });
    },
  });
}

/** Start (or rejoin) an attempt on a hold: the edge `deposit-begin`. */
export function useDepositBegin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: depositKeys.mutation('begin'),
    mutationFn: (vars: { holdId: string; locale: Locale }) => depositBegin(supabase, vars),
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: depositKeys.quote(vars.holdId) });
      void queryClient.invalidateQueries({ queryKey: bookingKeys.mine });
    },
  });
}

/**
 * Pay for a hold, from Review or from a failed attempt's "Try again" (plan §5.2):
 *
 *   deposit-begin → save the pointer → the payment screen → the bank's page
 *
 * The screen is mounted BEFORE the sheet opens, so whatever happens to the
 * sheet — the return link, the guest closing it, the app being killed on the
 * bank's page — there is already a screen underneath asking the server.
 * `replace`, not `push`: the screen that started the payment is finished with
 * (Review's hold now belongs to the payment window; a failed attempt's screen
 * is superseded by the new one), and a back swipe into it would only offer to
 * pay again. `beforeNavigate` runs first: Review sets its keep-hold ref there,
 * so leaving it does not fire release_hold.
 */
export function useStartPayment() {
  const { mutate, isPending } = useDepositBegin();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const { locale } = useLocale();
  const start = useCallback(
    (
      holdId: string,
      handlers: { onError: (error: Error) => void; beforeNavigate?: () => void },
    ) => {
      mutate(
        { holdId, locale },
        {
          onSuccess: async (attempt) => {
            await savePendingPayment(userId, {
              ref: attempt.ref,
              reservationId: holdId,
              // The contract always sends it; the fallback is the default window.
              deadlineAt: attempt.deadlineAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
            });
            // The screen about to open is this attempt's: no resume path may open it again.
            claimResume(attempt.ref);
            handlers.beforeNavigate?.();
            router.replace({ pathname: '/pay/status', params: { ref: attempt.ref } });
            void openPaymentPage(attempt.formUrl);
          },
          onError: handlers.onError,
        },
      );
    },
    [mutate, locale, userId],
  );
  return { start, busy: isPending };
}

/**
 * Once a payment settles, everything that shows a booking or a slot is stale:
 * the hold became a booking (or went back on the grid), and My reservations
 * gains its paid-online line. Same prefixes the booking mutations invalidate.
 */
export function useRefreshAfterPayment(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['availability'] });
    void queryClient.invalidateQueries({ queryKey: bookingKeys.mine });
    void queryClient.invalidateQueries({ queryKey: ['reservation'] });
  }, [queryClient]);
}

// ── The pending-payment pointer ─────────────────────────────────────────────

/** Remember the attempt this device just opened. Best effort: the booking list is the backstop. */
export async function savePendingPayment(userId: string, p: PendingPayment): Promise<void> {
  try {
    await writePendingPayment(store, userId, p);
  } catch (error) {
    captureException(error, { scope: 'deposit.pending.save' });
  }
}

export async function loadPendingPayment(userId: string): Promise<PendingPayment | null> {
  try {
    return await readPendingPayment(store, userId);
  } catch (error) {
    captureException(error, { scope: 'deposit.pending.read' });
    return null;
  }
}

/** Forget the pointer once the server's answer is terminal (only if it is still this ref's). */
export async function forgetPendingPayment(userId: string, ref?: string): Promise<void> {
  try {
    await removePendingPayment(store, userId, ref);
  } catch (error) {
    captureException(error, { scope: 'deposit.pending.clear' });
  }
}

/**
 * The attempt the post-auth continuation should reopen, for whoever has just
 * signed in. Read from the stored session because the auth context may not
 * have caught up yet when a sign-in screen calls this.
 *
 *   string       reopen /pay/status for it (this caller claimed it)
 *   'claimed'    another path is already reopening it: do nothing at all
 *   null         nothing to resume; carry on as before
 */
export async function findPaymentToResume(): Promise<string | 'claimed' | null> {
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data.session?.user.id ?? null;
  } catch (error) {
    captureException(error, { scope: 'deposit.resume.session' });
  }
  let ref: string | null = null;
  if (userId) {
    const stored = await loadPendingPayment(userId);
    if (stored && isResumable(stored, new Date())) ref = stored.ref;
    else if (stored) await forgetPendingPayment(userId, stored.ref);
  }
  ref ??= takeReturnRef();
  if (!ref) return null;
  return claimResume(ref) ? ref : 'claimed';
}

/** Users whose pointer the root resume has already looked at in this app life. */
const checkedUsers = new Set<string>();

/**
 * Reopen the payment screen on launch (plan §5.2 path 3, §10 row 5).
 *
 * Mounted once, in the root stack. It looks once per signed-in account per app
 * life, and only from a screen where the guest is simply resting (the tabs, a
 * booking): the auth screens run their own continuation, which checks the same
 * pointer before the pending slot, and Review and the payment pages are
 * mid-flow already. `claimResume` makes sure only one of the two navigates.
 */
export function usePendingPaymentResume(): void {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const pathname = usePathname();
  // Read after the storage round trip: the guest may have moved on meanwhile.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const ready = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    if (!userId || !ready || checkedUsers.has(userId) || !isResumeSafePath(pathname)) return;
    checkedUsers.add(userId);
    void (async () => {
      const stored = await loadPendingPayment(userId);
      if (!stored) return;
      if (!isResumable(stored, new Date())) {
        await forgetPendingPayment(userId, stored.ref);
        return;
      }
      if (!isResumeSafePath(pathRef.current)) {
        // Mid-flow now: look again from the next screen the guest rests on.
        checkedUsers.delete(userId);
        return;
      }
      if (!claimResume(stored.ref)) return;
      router.push({ pathname: '/pay/status', params: { ref: stored.ref } });
    })();
  }, [userId, ready, pathname]);
}
