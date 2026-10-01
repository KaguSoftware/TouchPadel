/**
 * Paying for a lesson by Qi Card (docs/design/coaching/guest.md §4.9.3): the
 * deposit's flow with an enrolment instead of a hold, in the shape of
 * `useStartTicketPurchase` (features/matches/tickets.ts):
 *
 *   lesson-begin → save the pointer → the payment screen → Qi's page
 *
 * The pointer is the deposit's own (`tp.pendingPayment.<uid>`) with
 * `purpose: 'lesson'`, an empty `reservationId` and the enrolment, so a
 * payment killed on Qi's page resumes exactly like a deposit. The payment
 * screen is mounted BEFORE the page opens. Used by the review, the class
 * screen and the lesson's "Finish payment"; a live attempt for the same
 * enrolment is answered with its own ref (`reused: true`), so the guest
 * returns to the same page.
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
import { lessonBegin } from './api';
import { coachingKeys } from './keys';
import type { LessonBegin } from './logic';

/** The payment window when `lesson-begin` sends no deadline (the deposit's default). */
const DEFAULT_WINDOW_MS = 15 * 60_000;

/** `lesson-begin` as a mutation: run now or fail now (`['coaching', 'mutation']`). */
export function useLessonBegin() {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: coachingKeys.mutation('pay'),
    mutationFn: (enrolmentId: string) => lessonBegin(supabase, { enrolmentId, locale }),
    onSettled: (_data, _error, enrolmentId) => {
      void queryClient.invalidateQueries({ queryKey: coachingKeys.one(enrolmentId) });
    },
  });
}

/**
 * Start (or rejoin) the Qi payment of a held enrolment:
 *
 *   lesson-begin → the pointer → claim the ref → `router.replace('/pay/status',
 *   {ref})` → Qi's page
 *
 * `beforeNavigate` runs first. A refusal leaves the enrolment held: the
 * caller toasts it and opens the lesson, whose "Finish payment" tries again.
 */
export function useStartLessonPayment() {
  const { mutate, isPending } = useLessonBegin();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const start = useCallback(
    (
      enrolmentId: string,
      handlers: {
        onError: (error: Error) => void;
        beforeNavigate?: () => void;
        onStarted?: (attempt: LessonBegin) => void;
      },
    ) => {
      mutate(enrolmentId, {
        onSuccess: async (attempt) => {
          await savePendingPayment(userId, {
            ref: attempt.ref,
            reservationId: '',
            deadlineAt:
              attempt.deadlineAt ?? new Date(Date.now() + DEFAULT_WINDOW_MS).toISOString(),
            purpose: 'lesson',
            lessonEnrolmentId: attempt.enrolmentId ?? enrolmentId,
          });
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
