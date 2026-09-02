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
import { canCancel, displayRef } from '../../src/features/booking/logic';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useCourts, useIsDegraded, useVenueSettings } from '../../src/features/availability/hooks';
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
  useSafeBack,
} from '../../src/components/ui';
import {
  DegradedBanner,
  PayAtDeskCard,
  StatusPill,
  SummaryGrid,
} from '../../src/components/booking';
import { ConfirmationDialog, useToast } from '../../src/components/overlays';
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
  const safeBack = useSafeBack();
  const { id } = useLocalSearchParams<{ id?: string }>();
  // Fetched by id (RLS-scoped) — finding it in the 100-row list made any older
  // booking opened from a push tap render "not found".
  const reservation = useReservation(typeof id === 'string' ? id : undefined);
  const courts = useCourts();
  const settings = useVenueSettings();
  const degraded = useIsDegraded();
  const cancel = useCancelReservation();
  const toast = useToast();
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
  const start = booking ? new Date(booking.start_at) : null;
  const end = booking ? new Date(booking.end_at) : null;
  const upcomingActive =
    booking != null &&
    start != null &&
    start.getTime() > now.getTime() &&
    (booking.status === 'confirmed' || booking.status === 'pending');
  const eligible = booking != null && policyKnown && canCancel(booking, windowHours, now);
  const windowEnd =
    start && windowHours > 0 ? new Date(start.getTime() - windowHours * 3_600_000) : null;

  const onCancelConfirm = () => {
    if (!booking) return;
    setError(null);
    cancel.mutate(booking.id, {
      onSuccess: () => {
        setDialogOpen(false);
        toast(t('booking.cancelledToast'), 'info');
      },
      onError: (err) => {
        setDialogOpen(false);
        setError(t(mapErrorToKey(err)));
      },
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
          onRetry={safeBack}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          {/* Spec 05.16: the venue contact whenever the venue is degraded. */}
          {degraded ? (
            <View style={{ marginBottom: 10 }}>
              <DegradedBanner
                tight
                lead={t('degraded.leadConnectionLost')}
                message={t('degraded.bannerBookings', { phone: phone ?? '' })}
                phone={phone}
              />
            </View>
          ) : null}

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
                pressedBg={colors.redtint}
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

          {booking.status === 'cancelled' ? (
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
                {t('booking.cancelledNotice')}
              </Text>
            </View>
          ) : null}

          <View style={{ marginTop: 10 }}>
            <PayAtDeskCard lead={`${t('booking.payAtDeskTitle')}.`} body={t('booking.payAtDeskShort')} />
          </View>

          <ErrorText>{error}</ErrorText>
        </ScrollView>
      )}

      <ConfirmationDialog
        visible={dialogOpen}
        title={t('booking.cancelDialogTitle')}
        body={t('booking.cancelDialogBody', {
          when: start ? formatDateTime(start, locale) : '',
        })}
        confirmLabel={cancel.isPending ? t('booking.cancelling') : t('booking.cancelBooking')}
        busy={cancel.isPending}
        danger
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
