/**
 * Post-auth continuation for the pending-slot flow (design 2026-08-31):
 * after sign-in or email verification, a slot the guest tapped while signed
 * out is held immediately and the flow lands on Review; otherwise, the tabs.
 * If the slot got taken while they were authenticating, the grid explains it.
 *
 * A PAYMENT IN FLIGHT COMES FIRST (build-contracts-2026-09-27 §4; plan §5.2
 * path 3, §10 row 35). If this account has an online deposit this device began
 * and its window (plus grace) is still open, or a payment return link landed
 * while nobody was signed in, the guest goes to that payment's screen: money
 * the bank may already have taken outranks a slot tapped a minute ago, and the
 * tapped slot is dropped. `findPaymentToResume` claims the ref, so the root
 * resume hook cannot open the same screen a second time.
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
import { requestBookingSheet } from '../courtTransition/openIntent';
import { findPaymentToResume } from '../deposit/hooks';

export function usePostAuthContinue(): { continueAfterAuth: () => void; holdBusy: boolean } {
  const router = useRouter();
  const { t } = useLocale();
  const toast = useToast();
  const hold = useHoldSlot();
  const { mutate, isPending } = hold;

  const continueWithSlot = useCallback(() => {
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
          // the Book tab's sheet — still open if that is where the guest
          // tapped, opened for them if not (the standalone Availability screen
          // is gone, owner 2026-09-26).
          toast(t('booking.slotTakenBody'), 'error');
          requestBookingSheet();
          router.replace('/(tabs)');
        },
        // After navigation, so the (auth) layout's exemption holds until we are gone.
        onSettled: () => clearPendingSlot(),
      },
    );
  }, [mutate, router, t, toast]);

  const continueAfterAuth = useCallback(() => {
    void findPaymentToResume().then((resume) => {
      // The root resume hook got there first and is already opening it.
      if (resume === 'claimed') return;
      if (resume) {
        // PUSH, over whatever the sign-in redirect lands on: the payment
        // screen then has the tabs beneath it, and its "Leave" goes to My
        // reservations either way.
        router.push({ pathname: '/pay/status', params: { ref: resume } });
        clearPendingSlot();
        return;
      }
      continueWithSlot();
    });
  }, [continueWithSlot, router]);

  return { continueAfterAuth, holdBusy: isPending };
}
