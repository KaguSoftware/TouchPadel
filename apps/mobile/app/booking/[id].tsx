import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '../../src/i18n/text';
import { useLocalSearchParams, Stack } from 'expo-router';
import { RequireSession } from '../../src/features/auth/RequireSession';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatDateTime, formatTimeRange, isolate } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useCancelReservation, useReservation } from '../../src/features/booking/hooks';
import { canCancel, displayRef, endedNotice } from '../../src/features/booking/logic';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useCourts, useCourtsBroadcast, useIsDegraded, useVenueSettings } from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
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
  DegradedBanner,
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
  const { id } = useLocalSearchParams<{ id?: string }>();
  // Fetched by id (RLS-scoped) — finding it in the 100-row list made any older
  // booking opened from a push tap render "not found".
  const reservation = useReservation(typeof id === 'string' ? id : undefined);
  const courts = useCourts();
  const settings = useVenueSettings();
  const degraded = useIsDegraded();
  const cancel = useCancelReservation();
  const toast = useToast();
  // The desk can end this booking while the guest is looking straight at it —
  // a no-show, a cancel, a move. Bookings mounts this and the grid does; the
  // detail screen did not, so the one screen showing a SINGLE booking was the
  // one that kept showing it after the venue closed it, until a 15 s staleTime
  // happened to lapse against a refocus. Reference-counted and shared, so this
  // adds no second subscription when it is opened from Bookings.
  useCourtsBroadcast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [noticeClosed, setNoticeClosed] = useState(false);
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
  const cardPad = { paddingTop: 13, paddingBottom: 13, paddingStart: space.m, paddingEnd: space.m };

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{ title: booking ? t('booking.bookingRef', { ref: displayRef(booking.id) }) : '' }}
      />
      {/*
        Spec 05.16: the venue contact whenever the venue is degraded, closed
        only by its × — a guest looking at a stale booking needs the number in
        reach however long they spend reading, and however often the query
        refetches. In flow rather than floating, matching the Book tab: an
        overlay covered the top of the detail it was commenting on.
      */}
      {degraded && !noticeClosed ? (
        <View style={{ marginBottom: space.s }}>
          <DegradedBanner
            lead={t('degraded.leadConnectionLost')}
            message={t('degraded.bannerBookings', { phone: phone ?? '' })}
            phone={phone}
            blockLead
            onDismiss={() => setNoticeClosed(true)}
          />
        </View>
      ) : null}
      {reservation.isLoading ? (
        <SkeletonList rows={2} height={140} />
      ) : reservation.isError ? (
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(reservation.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void reservation.refetch()}
          busy={reservation.isRefetching}
        />
      ) : !booking ? (
        <ErrorState
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
                        label: t('booking.priceAtDesk'),
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

          {upcomingActive && policyKnown && eligible ? (
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

          {upcomingActive && policyKnown && !eligible ? (
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
            </View>
          ) : null}

          <View style={{ marginTop: 10 }}>
            <PayAtDeskCard lead={`${t('booking.payAtDeskTitle')}.`} body={t('booking.payAtDeskShort')} />
          </View>

          <ErrorText>{error}</ErrorText>
        </ScrollView>
      )}

      <ConfirmAlert
        visible={dialogOpen}
        title={t('booking.cancelDialogTitle')}
        body={t('booking.cancelDialogBody', {
          when: start ? formatDateTime(start, locale) : '',
        })}
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
