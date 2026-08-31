/**
 * Post-auth continuation for the pending-slot flow (design 2026-08-31):
 * after sign-in or email verification, a slot the guest tapped while signed
 * out is held immediately and the flow lands on Review; otherwise, the tabs.
 * If the slot got taken while they were authenticating, the grid explains it.
 */
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../i18n/LocaleProvider';
import { useToast } from '../../components/overlays';
import { useHoldSlot } from './hooks';
import { takePendingSlot } from './pendingSlot';

export function usePostAuthContinue(): { continueAfterAuth: () => void; holdBusy: boolean } {
  const router = useRouter();
  const { t, locale } = useLocale();
  const toast = useToast();
  const hold = useHoldSlot();

  const continueAfterAuth = useCallback(() => {
    const pending = takePendingSlot();
    if (!pending) {
      router.replace('/(tabs)');
      return;
    }
    const startAt = new Date(pending.startAt);
    hold.mutate(
      { courtId: pending.courtId, startAt, durationMin: pending.durationMin },
      {
        onSuccess: (result) => {
          router.replace({
            pathname: '/review',
            params: {
              holdId: result.reservationId,
              expiresAt: result.holdExpiresAt ?? '',
              priceIqd: String(result.priceIqd ?? pending.priceIqd ?? ''),
              courtName: pickLocale({ en: pending.courtNameEn, ar: pending.courtNameAr }, locale),
              startAt: pending.startAt,
              durationMin: String(pending.durationMin),
            },
          });
        },
        onError: () => {
          // Whatever the refusal (taken, degraded, expired rate), the freshest
          // grid is the honest answer — land there with a short explanation.
          toast(t('booking.slotTakenBody'), 'error');
          router.replace('/availability');
        },
      },
    );
  }, [hold, router, t, locale, toast]);

  return { continueAfterAuth, holdBusy: hold.isPending };
}
