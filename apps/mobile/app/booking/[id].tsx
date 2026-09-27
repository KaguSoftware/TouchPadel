import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '../../src/i18n/text';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { RequireSession } from '../../src/features/auth/RequireSession';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatDateTime, formatIQD, formatTimeRange, isolate } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useCancelReservation, useReservation } from '../../src/features/booking/hooks';
import { canCancel, dayPart, displayRef, endedNotice, isCourtFeePaid } from '../../src/features/booking/logic';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { onlinePaymentOf, openPaymentRef, refundDetailKey } from '../../src/features/deposit/logic';
import {
  useAllCourts,
  useCourtsBroadcast,
  useGuestVenue,
  useVenueSettings,
} from '../../src/features/availability/hooks';
import { DEFAULT_TZ, venuePhoneOf } from '../../src/features/availability/assemble';
import { callPhone } from '../../src/lib/phone';
import { formatPrice } from '../../src/lib/price';
import { radius, space, useTheme } from '../../src/theme';
import {
  Button,
  Card,
  DashedDivider,
  ErrorText,
  Screen,
} from '../../src/components/ui';
import { useBack } from '../../src/navigation/back';
import {
  PayAtDeskCard,
  StatusPill,
  SummaryGrid,
} from '../../src/components/booking';
import { ConfirmAlert, useToast } from '../../src/components/overlays';
import { CalendarIcon, ClockIcon, StopwatchIcon, TagIcon } from '../../src/components/icons';
import { ErrorState, SkeletonList } from '../../src/components/states';

/**
 * Booking detail (design 2026-08-31) — the ONLY place a guest cancels.
 * The cancel control is present in every eligible state and REFUSED with a
 * stated reason when the window is closed (spec R8 — visible, never hidden);
 * refusal offers the venue phone. Cancelled bookings state it plainly.
 */
function BookingDetailScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const insets = useSafeAreaInsets();
  const back = useBack();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  // Fetched by id (RLS-scoped) — finding it in the 100-row list made any older
  // booking opened from a push tap render "not found".
  const reservation = useReservation(typeof id === 'string' ? id : undefined);
  // The settings of the booking's OWN branch (its cancellation window, its
  // phone, its clock), whichever branch the Book tab shows. The row names its
  // branch (0235); a row cached before that falls back to its court's branch.
  // Until the branch is known the settings wait (null), so the policy is never
  // judged against another branch's window.
  const courts = useAllCourts();
  const bookingCourtId = reservation.data?.court_id;
  const bookingVenue =
    reservation.data?.venue_id ?? courts.data?.find((c) => c.id === bookingCourtId)?.venue_id;
  const settings = useVenueSettings(
    bookingVenue ?? (courts.isSuccess && reservation.isSuccess ? undefined : null),
  );
  const guestVenueId = useGuestVenue().venueId;
  const cancel = useCancelReservation();
  const toast = useToast();
  // The desk can end this booking while the guest is looking straight at it —
  // a no-show, a cancel, a move. Bookings mounts this and the grid does; the
  // detail screen did not, so the one screen showing a SINGLE booking was the
  // one that kept showing it after the venue closed it, until a 15 s staleTime
  // happened to lapse against a refocus. Reference-counted and shared, so this
  // adds no second subscription when it is opened from Bookings.
  useCourtsBroadcast(bookingVenue ?? guestVenueId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Eligibility follows the clock: the window can close while the guest looks.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const booking = reservation.data ?? null;
  const court = booking ? courts.data?.find((c) => c.id === booking.court_id) : null;
  const phone = venuePhoneOf(settings.data);

  // The policy is only judged once it is KNOWN. Defaulting the window to 0
  // while settings loaded offered "free cancellation" and then flipped to the
  // red refusal card a second later.
  const policyKnown = settings.isSuccess;
  const windowHours = settings.data?.cancellation_window_hours ?? 0;
  // The venue's clock decides "good evening", not the phone's.
  const tz = settings.data?.timezone ?? DEFAULT_TZ;
  const start = booking ? new Date(booking.start_at) : null;
  const end = booking ? new Date(booking.end_at) : null;
  const upcomingActive =
    booking != null &&
    start != null &&
    start.getTime() > now.getTime() &&
    (booking.status === 'confirmed' || booking.status === 'pending');
  const eligible = booking != null && policyKnown && canCancel(booking, windowHours, now);
  const endedNoticeKey = booking ? endedNotice(booking.status, booking.cancelled_by) : null;
  const windowEnd =
    start && windowHours > 0 ? new Date(start.getTime() - windowHours * 3_600_000) : null;

  // The native alert dismisses itself as soon as a button is tapped, so the
  // open flag closes here rather than on the result; the pending write shows as
  // the Cancel booking button's own spinner (busy={cancel.isPending}).
  const onCancelConfirm = () => {
    if (!booking) return;
    setError(null);
    setDialogOpen(false);
    cancel.mutate(booking.id, {
      onSuccess: () => toast(t('booking.cancelledToast'), 'info'),
      onError: (err) => setError(t(mapErrorToKey(err))),
    });
  };

  const callVenue = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      // Isolated like the availability flow's toast: a space-grouped Latin
      // number inside the Arabic sentence otherwise has its groups reordered.
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  const price = booking ? formatPrice(booking.price_iqd, locale) : null;
  // The online deposit (build-contracts-2026-09-27 §2.2): what was paid in the
  // app, a payment still open on a hold, and a deposit on its way back.
  const online = booking ? onlinePaymentOf(booking) : null;
  const paymentRef = booking ? openPaymentRef(booking) : null;
  const refundKey = booking ? refundDetailKey(booking) : null;
  const money = (n: number) => isolate(formatIQD(n, locale));
  const cardPad = { paddingTop: 13, paddingBottom: 13, paddingStart: space.m, paddingEnd: space.m };

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{ title: booking ? t('booking.bookingRef', { ref: displayRef(booking.id) }) : '' }}
      />
      {/* No venue notice here either (spec 05.16 put one above the detail; the
          owner took every one of them off the top of screens on 2026-09-11 —
          the sheet carries it at booking time). The venue's number stays in
          reach on this screen through the window-closed card's Call button. */}
      {reservation.isLoading ? (
        <SkeletonList rows={2} height={140} />
      ) : reservation.isError ? (
        <ErrorState
          testID="booking-detail.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(reservation.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void reservation.refetch()}
          busy={reservation.isRefetching}
        />
      ) : !booking ? (
        <ErrorState
          testID="booking-detail.not-found"
          title={t('errors.notFound')}
          message={t('booking.notFound')}
          retryLabel={t('common.back')}
          onRetry={back}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <Text
                // flexShrink, not flex: 1 — the box hugs the name, so the row
                // keeps it on the leading edge even when pickLocale hands back
                // the Latin name (a stretched box left-aligns it on iOS under
                // RTL). It still wraps against the pill.
                style={{
                  flexShrink: 1,
                  fontFamily: fonts.display900,
                  fontSize: 20,
                  textTransform: 'uppercase',
                  color: colors.ink,
                }}
              >
                {court ? pickLocale({ en: court.name_en, ar: court.name_ar }, locale) : ''}
              </Text>
              <StatusPill status={booking.status} size="detail" />
            </View>
            <DashedDivider style={{ marginTop: 13, marginBottom: 13 }} />
            <SummaryGrid
              rowGap={11}
              rows={[
                ...(start
                  ? [
                      { icon: CalendarIcon, label: t('booking.date'), value: formatDate(start, locale) },
                      {
                        icon: ClockIcon,
                        label: t('booking.time'),
                        value: end ? formatTimeRange(start, end, locale) : formatDateTime(start, locale),
                      },
                    ]
                  : []),
                ...(start && end
                  ? [
                      {
                        icon: StopwatchIcon,
                        label: t('booking.duration'),
                        value: t('booking.durationMinutes', {
                          minutes: Math.round((end.getTime() - start.getTime()) / 60_000),
                        }),
                      },
                    ]
                  : []),
                ...(price
                  ? [
                      {
                        icon: TagIcon,
                        // Not all of it is "at desk" once part was paid online.
                        label: t(online ? 'booking.price' : 'booking.priceAtDesk'),
                        value: price,
                        valueColor: colors.gtext,
                        emphasis: true,
                      },
                    ]
                  : []),
              ]}
            />
          </Card>

          {/* SCOPE(phase-1): reservations has no series_id yet — this notice
              arms itself the day the column lands. GROWS LATER → venue-created
              weekly series (operator side). */}
          {'series_id' in booking && (booking as { series_id?: string | null }).series_id ? (
            <View
              style={{
                marginTop: 10,
                backgroundColor: colors.tint,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.button,
                ...cardPad,
              }}
            >
              <Text
                style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 }}
              >
                <Text style={{ fontFamily: fonts.body800 }}>↻ {t('booking.weeklySeries')}. </Text>
                {t('booking.seriesNotice')}
              </Text>
            </View>
          ) : null}

          {paymentRef ? (
            // A hold whose online deposit is still open: back to that
            // payment's screen, the only place it can be finished.
            <View
              style={{
                marginTop: 10,
                backgroundColor: colors.amb,
                borderWidth: 1,
                borderColor: colors.ambline,
                borderRadius: radius.button,
                ...cardPad,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 12,
                  letterSpacing: tracking(0.48),
                  textTransform: 'uppercase',
                  color: colors.ambtext,
                }}
              >
                {t('deposit.paymentInProgress')}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 12.5,
                  lineHeight: 19,
                  color: colors.ambtext,
                  marginTop: 4,
                  marginBottom: 10,
                }}
              >
                {t('deposit.paymentInProgressBody')}
              </Text>
              <Button
                testID="booking-detail.finish-payment"
                label={t('deposit.finishPayment')}
                variant="cta"
                size="compact"
                onPress={() => router.push({ pathname: '/pay/status', params: { ref: paymentRef } })}
              />
            </View>
          ) : null}

          {/* Not while a payment is open on the hold: the payment window owns
              it, and the card above is the one thing to do with it. */}
          {upcomingActive && policyKnown && eligible && !paymentRef ? (
            <View
              style={{
                marginTop: 10,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.button,
                ...cardPad,
              }}
            >
              {windowEnd ? (
                <Text
                  style={{
                    fontFamily: fonts.body400,
                    fontSize: 12.5,
                    lineHeight: 19,
                    color: colors.mut2,
                    marginBottom: 10,
                  }}
                >
                  {t('booking.freeCancelUntil', { when: formatDateTime(windowEnd, locale) })}
                </Text>
              ) : null}
              <Button
                testID="booking-detail.cancel"
                label={t('booking.cancelBooking')}
                variant="dangerOutline"
                size="compact"
                // No pressedBg: in dark mode the variant's own ground IS
                // redtint now, so overriding it would delete the press state.
                // The Button's default dim covers both themes.
                busy={cancel.isPending}
                onPress={() => setDialogOpen(true)}
              />
            </View>
          ) : null}

          {upcomingActive && policyKnown && !eligible && !paymentRef ? (
            <View
              style={{
                marginTop: 10,
                backgroundColor: colors.redtint,
                borderWidth: 1,
                borderColor: colors.redline,
                borderRadius: radius.button,
                ...cardPad,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 12,
                  letterSpacing: tracking(0.48),
                  textTransform: 'uppercase',
                  color: colors.redtext,
                }}
              >
                {t('booking.windowClosedTitle')}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 12.5,
                  lineHeight: 19,
                  color: colors.redtext2,
                  marginTop: 4,
                  marginBottom: 10,
                }}
              >
                {t('booking.windowClosedBody', {
                  when: windowEnd ? formatDateTime(windowEnd, locale) : '',
                })}
              </Text>
              <Button
                testID="booking-detail.call-venue"
                label={t('booking.callVenue')}
                variant="danger"
                size="compact"
                disabled={!phone}
                onPress={callVenue}
              />
            </View>
          ) : null}

          {/*
            Why a booking is over, for every way it can be over.

            This used to test `status === 'cancelled'` alone, so a booking the
            venue closed as a no-show — or one that expired before it was
            confirmed — showed a status pill and nothing else: no explanation,
            and no hint that the slot had gone. The desk marks a no-show and
            from the guest's side the booking simply stops meaning anything,
            which is exactly what it looks like when nothing happened at all.

            A cancellation names WHO ended it (0088) when the actor was
            recorded: the venue taking a court back and the guest's own tap
            arrive at the identical badge, and only one of them is worth a
            call to the desk. An older cancellation with no actor stored keeps
            the original sentence rather than guessing at one.
          */}
          {endedNoticeKey ? (
            <View
              style={{
                marginTop: 10,
                backgroundColor: colors.sub,
                borderRadius: radius.button,
                ...cardPad,
              }}
            >
              <Text
                style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut }}
              >
                {t(endedNoticeKey)}
              </Text>
              {refundKey ? (
                // What happened to the deposit: the notice above says what
                // happened to the booking.
                <Text
                  style={{
                    fontFamily: fonts.body600,
                    fontSize: 12.5,
                    lineHeight: 19,
                    color: colors.mut2,
                    marginTop: 6,
                  }}
                >
                  {t(refundKey)}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={{ marginTop: 10 }}>
            {/* Once the desk has taken the money this card is the only place
                the guest would ever learn it: the app takes no payment, so
                "pay at the desk" stood on every booking forever, including
                ones already settled. */}
            {isCourtFeePaid(booking) ? (
              <PayAtDeskCard
                lead={`${t('booking.paidTitle')}.`}
                body={t(dayPart(now, tz) === 'evening' ? 'booking.paidEvening' : 'booking.paidDay')}
              />
            ) : online ? (
              // Part paid in the app: "Paid online X · Pay Y at the desk". A
              // refunded deposit is not in `online_paid_iqd` (net of refunds),
              // so a cancelled booking never reaches this branch.
              <PayAtDeskCard
                lead={`${t('deposit.paidOnline')}.`}
                body={t('deposit.detailPaidOnlineBody', {
                  paid: money(online.paid),
                  rest: money(online.rest),
                })}
              />
            ) : paymentRef ? null : (
              <PayAtDeskCard lead={`${t('booking.payAtDeskTitle')}.`} body={t('booking.payAtDeskShort')} />
            )}
          </View>

          <ErrorText>{error}</ErrorText>
        </ScrollView>
      )}

      <ConfirmAlert
        visible={dialogOpen}
        title={t('booking.cancelDialogTitle')}
        body={[
          t('booking.cancelDialogBody', { when: start ? formatDateTime(start, locale) : '' }),
          // The money outcome, before the guest taps (plan §5.4): a cancelled
          // booking's deposit is always refunded (contract §1).
          online ? t('deposit.cancelRefundLine', { amount: money(online.paid) }) : null,
        ]
          .filter(Boolean)
          .join(' ')}
        // Short labels on purpose: iOS puts two alert buttons side by side only
        // when both fit one row, and stacks them otherwise — "Cancel booking"
        // was long enough to force the stack. The title carries the noun.
        confirmLabel={t('booking.cancelDialogConfirm')}
        // "Keep it", not "Cancel" — next to a cancel-the-booking button, a
        // Cancel button is ambiguous about which cancellation it means.
        cancelLabel={t('common.keepIt')}
        destructive
        onConfirm={onCancelConfirm}
        onDismiss={() => setDialogOpen(false)}
      />
    </Screen>
  );
}

/**
 * On the ROOT stack rather than in `(gated)`: entered from another navigator,
 * a screen inside a nested stack has no history of its own, so UIKit draws no
 * back item and the screen shipped a JS replica instead. Here the push leaves
 * real history, so every screen gets the SAME system back item.
 *
 * The group layout's guard does not reach this file, so the session
 * requirement is declared explicitly — same states, same redirect.
 */
export default function GuardedBookingDetailScreen() {
  return (
    <RequireSession>
      <BookingDetailScreen />
    </RequireSession>
  );
}
