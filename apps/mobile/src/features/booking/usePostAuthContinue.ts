/**
 * Post-auth continuation for the pending-slot flow (design 2026-08-31):
 * after sign-in or email verification, a slot the guest tapped while signed
 * out is held immediately and the flow lands on Review; otherwise, the tabs.
 * If the slot got taken while they were authenticating, the grid explains it.
 *
 * The pending intent is PEEKED here and cleared only once the hold settles.
 * Taking it up front emptied the store while the RPC was in flight, so
 * (auth)/_layout saw `session && !pending`, redirected to the tabs, and the
 * router.replace('/review') below fired from an unmounted screen.
 */
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useLocale } from '../../i18n/LocaleProvider';
import { useToast } from '../../components/overlays';
import { useHoldSlot } from './hooks';
import { clearPendingSlot, getPendingSlot } from './pendingSlot';

export function usePostAuthContinue(): { continueAfterAuth: () => void; holdBusy: boolean } {
  const router = useRouter();
  const { t } = useLocale();
  const toast = useToast();
  const hold = useHoldSlot();
  const { mutate, isPending } = hold;

  const continueAfterAuth = useCallback(() => {
    const pending = getPendingSlot();
    if (!pending) {
      router.replace('/(tabs)');
      return;
    }
    const startAt = new Date(pending.startAt);
    mutate(
      { courtId: pending.courtId, startAt, durationMin: pending.durationMin },
      {
        onSuccess: (result) => {
          router.replace({
            pathname: '/review',
            params: {
              holdId: result.reservationId,
              // '' = no deadline (duplicate replay); Review shows no countdown.
              expiresAt: result.holdExpiresAt ?? '',
              priceIqd: String(result.priceIqd ?? pending.priceIqd ?? ''),
              // Both names: Review picks at render (a switch mid-checkout renames it).
              courtNameEn: pending.courtNameEn,
              courtNameAr: pending.courtNameAr,
              startAt: pending.startAt,
              durationMin: String(pending.durationMin),
            },
          });
        },
        onError: () => {
          // Whatever the refusal (taken, degraded, expired rate), the freshest
          // grid is the honest answer — land there with a short explanation:
          // the Book tab, where the sheet the guest tapped on is still open,
          // or the standalone screen.
          toast(t('booking.slotTakenBody'), 'error');
          router.replace(pending.origin === 'sheet' ? '/(tabs)' : '/availability');
        },
        // After navigation, so the (auth) layout's exemption holds until we are gone.
        onSettled: () => clearPendingSlot(),
      },
    );
  }, [mutate, router, t, toast]);

  return { continueAfterAuth, holdBusy: isPending };
}
