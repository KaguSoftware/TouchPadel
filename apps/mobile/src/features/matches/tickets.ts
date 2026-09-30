/**
 * Tickets on the phone: buying, and continuing the action a purchase was for
 * (docs/design/open-matches/guest.md §4.10.2, §4.10.3). The React half; the
 * pure half is continuation.ts (the continuation) and logic.ts
 * (`parseTicketWallet`, `buyCounts`, `missingTickets`).
 *
 * Buying is the deposit's flow with a count instead of a hold
 * (`useStartPayment`, features/deposit/hooks.ts):
 *
 *   ticket-begin → save the pointer → the payment screen → Qi's page
 *
 * The pointer is the deposit's own (`tp.pendingPayment.<uid>`), with
 * `purpose: 'ticket'`, an empty `reservationId` and the continuation as
 * `after`, so a purchase killed on Qi's page resumes exactly like a deposit
 * and the continuation survives it. The pointer's reader and writer are
 * features/deposit/pendingPayment.ts's: until it serialises `purpose` and
 * `after`, the pointer resumes the screen and the in-memory continuation
 * covers this app life only.
 */
import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../i18n/LocaleProvider';
import { useAuth } from '../auth/context';
import { openPaymentPage } from '../deposit/browser';
import { savePendingPayment } from '../deposit/hooks';
import { claimResume } from '../deposit/pendingPayment';
import { runContinuation, ticketBegin, type ContinuationResult } from './api';
import {
  bindTicketContinuation,
  clearTicketContinuation,
  getTicketContinuation,
  settleContinuationKey,
  type TicketContinuation,
} from './continuation';
import { matchKeys } from './keys';
import type { TicketBegin } from './logic';

/** The payment window when `ticket-begin` sends no deadline (the deposit's default). */
const DEFAULT_WINDOW_MS = 15 * 60_000;

/** `ticket-begin` as a mutation: run now or fail now (`['match', 'mutation']`). */
export function useTicketBegin() {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: matchKeys.mutation('buy'),
    mutationFn: (count: number) => ticketBegin(supabase, { count, locale }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: matchKeys.tickets });
    },
  });
}

/**
 * Buy `count` tickets (§4.10.2), from the tickets screen or a failed
 * attempt's "Try again":
 *
 *   ticket-begin → the pointer (with the continuation as `after`) → claim the
 *   ref → `router.replace('/pay/status', {ref})` → Qi's page
 *
 * The payment screen is mounted BEFORE the page opens, as for a deposit. A
 * `reused: true` answer is a live attempt: it opens that attempt's screen
 * with its own count. `beforeNavigate` runs first.
 */
export function useStartTicketPurchase() {
  const { mutate, isPending } = useTicketBegin();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const start = useCallback(
    (
      count: number,
      handlers: {
        onError: (error: Error) => void;
        beforeNavigate?: () => void;
        onStarted?: (attempt: TicketBegin) => void;
      },
    ) => {
      mutate(count, {
        onSuccess: async (attempt) => {
          const after = getTicketContinuation();
          // `purpose` and `after` ride on the deposit pointer (§4.10.2); a
          // pointer reader that does not know them keeps the rest.
          const pointer = {
            ref: attempt.ref,
            reservationId: '',
            deadlineAt: attempt.deadlineAt ?? new Date(Date.now() + DEFAULT_WINDOW_MS).toISOString(),
            purpose: 'ticket' as const,
            ...(after ? { after } : {}),
          };
          await savePendingPayment(userId, pointer);
          if (after) bindTicketContinuation(attempt.ref);
          // The screen about to open is this attempt's: no resume path may open it again.
          claimResume(attempt.ref);
          handlers.onStarted?.(attempt);
          handlers.beforeNavigate?.();
          router.replace({ pathname: '/pay/status', params: { ref: attempt.ref } });
          void openPaymentPage(attempt.formUrl);
        },
        onError: handlers.onError,
      });
    },
    [mutate, userId],
  );
  return { start, busy: isPending };
}

/**
 * Run a continuation (§4.10.3 steps 4–7): the same RPC with the same
 * arguments (for a start, the same idempotency key). The caller (the payment
 * screen) decides WHEN with `continuationPlan`, toasts the outcome and
 * navigates: `ContinuationResult` names the match on success
 * (`/match/[id]`), and `continuationBackHref` says where a refusal returns
 * to. Nothing is retried by itself; the in-memory continuation is spent
 * either way.
 */
export function useRunTicketContinuation() {
  const queryClient = useQueryClient();
  const { mutateAsync, isPending } = useMutation({
    // A join or a start: the same prefix, so it runs now or fails now.
    mutationKey: matchKeys.mutation('join'),
    mutationFn: (c: TicketContinuation) => runContinuation(supabase, c),
    // A start's key is spent as `useStartMatch` spends it (§4.23).
    onSuccess: (_data, c) => settleContinuationKey(c, null),
    onError: (err, c) => settleContinuationKey(c, err),
    onSettled: () => {
      clearTicketContinuation();
      void queryClient.invalidateQueries({ queryKey: matchKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
  const run = useCallback(
    (c: TicketContinuation): Promise<ContinuationResult> => mutateAsync(c),
    [mutateAsync],
  );
  return { run, busy: isPending };
}
