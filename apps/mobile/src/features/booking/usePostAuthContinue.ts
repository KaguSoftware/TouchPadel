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
 * THEN AN OPEN-MATCH INTENT (docs/design/open-matches/guest.md §4.18): a link
 * opened signed out goes to its invite, a chip to the list at that time, a
 * start to the new-match form, the entry row to the list on that night.
 * Signing in never joins by itself (GD-2): the guest sees the match, with its
 * gender ask, tickets and refusals, and taps once. A pending slot outranks it
 * (both cannot normally be set; the later tap wins its own store only).
 *
 * A PHONE NOBODY HAS VERIFIED STOPS THE HOLD (owner, 2026-09-27). With a slot
 * pending, the account's confirmed auth phone must be its profile phone
 * (bookingGateState); otherwise the guest goes to /phone-sign-in in continue
 * mode with the slot still pending, and verify-otp comes back here once the
 * code lands. A read that fails proceeds — Review re-checks before Reserve.
 * The same gate stands before an open-match intent that ends in a court
 * booking (owner, 2026-09-29: a start, a chip's or an invite's join;
 * `intentBooksCourt`), with the intent still pending through it — the match
 * screen re-checks before Start or Join. The list is browsing and opens as it is.
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
import { clearPendingSlot, getPendingSlot, type PendingSlot } from './pendingSlot';
import { clearPendingIntents } from './pendingIntent';
import {
  clearPendingJoin,
  getPendingJoin,
  intentBooksCourt,
  pendingJoinHref,
  type PendingJoin,
} from '../matches/pendingJoin';
import {
  clearPendingLesson,
  getPendingLesson,
  pendingLessonHref,
  type PendingLesson,
} from '../coaching/pendingLesson';
import { requestBookingSheet } from '../courtTransition/openIntent';
import { findPaymentToResume } from '../deposit/hooks';
import { supabase } from '../../lib/supabase';
import { fetchOwnProfile } from '../profile/api';
import { bookingGateHref, bookingGateState, type BookingGate } from '../auth/social';

/** Read fresh, not from a cache: this runs straight after a sign-in or a profile save. */
async function readBookingGate(): Promise<{ gate: BookingGate; phone: string }> {
  try {
    const [{ data }, profile] = await Promise.all([supabase.auth.getUser(), fetchOwnProfile(supabase)]);
    return {
      gate: bookingGateState({ status: 'success', data: profile }, data.user),
      phone: profile?.phone ?? '',
    };
  } catch {
    return { gate: 'unknown', phone: '' };
  }
}

export function usePostAuthContinue(): { continueAfterAuth: () => void; holdBusy: boolean } {
  const router = useRouter();
  const { t } = useLocale();
  const toast = useToast();
  const hold = useHoldSlot();
  const { mutate, isPending } = hold;

  const holdPending = useCallback((pending: PendingSlot) => {
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
              // 0252: Review shows the kind hold warning.
              holdWarning: result.holdWarning ? '1' : '',
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

  const openJoin = useCallback((join: PendingJoin) => {
    router.replace(pendingJoinHref(join));
    // After navigation, so the signed-out gate's exemption holds until we are gone.
    clearPendingJoin();
  }, [router]);

  /**
   * A lesson intent (coaching guest.md §4.9.5) opens its review or its class:
   * signing in never books by itself, and those screens run the booking gate
   * on their own primary (back mode), so there is nothing to gate here.
   */
  const openLesson = useCallback((lesson: PendingLesson) => {
    router.replace(pendingLessonHref(lesson));
    // After navigation, so the signed-out gate's exemption holds until we are gone.
    clearPendingLesson();
  }, [router]);

  const continueWithSlot = useCallback(() => {
    const pending = getPendingSlot();
    const join = pending ? null : getPendingJoin();
    const lesson = pending || join ? null : getPendingLesson();
    if (lesson) {
      openLesson(lesson);
      return;
    }
    if (!pending && !join) {
      router.replace('/(tabs)');
      return;
    }
    // The list is browsing: nothing to gate.
    if (join && !intentBooksCourt(join)) {
      openJoin(join);
      return;
    }
    void readBookingGate().then(({ gate, phone }) => {
      const stop = bookingGateHref(gate, phone);
      if (stop) router.replace(stop);
      else if (pending) holdPending(pending);
      else if (join) openJoin(join);
    });
  }, [holdPending, openJoin, openLesson, router]);

  const continueAfterAuth = useCallback(() => {
    void findPaymentToResume().then((resume) => {
      // The root resume hook got there first and is already opening it.
      if (resume === 'claimed') return;
      if (resume) {
        // PUSH, over whatever the sign-in redirect lands on: the payment
        // screen then has the tabs beneath it, and its "Leave" goes to My
        // reservations either way.
        router.push({ pathname: '/pay/status', params: { ref: resume } });
        clearPendingIntents();
        return;
      }
      continueWithSlot();
    });
  }, [continueWithSlot, router]);

  return { continueAfterAuth, holdBusy: isPending };
}
