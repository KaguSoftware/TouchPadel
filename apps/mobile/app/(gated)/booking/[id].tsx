import { useMemo, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatIQD, formatTime } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../src/i18n/LocaleProvider';
import { useCancelReservation, useMyBookings } from '../../../src/features/booking/hooks';
import { canCancel, displayRef } from '../../../src/features/booking/logic';
import { mapErrorToKey } from '../../../src/features/booking/errors';
import { useCourts, useVenueSettings } from '../../../src/features/availability/hooks';
import { venuePhoneOf } from '../../../src/features/availability/assemble';
import { radius, space, useTheme } from '../../../src/theme';
import { Button, Card, ErrorText, Screen, ScreenHeader } from '../../../src/components/ui';
import { PayAtDeskCard, StatusPill, SummaryGrid } from '../../../src/components/booking';
import { ConfirmationDialog , useToast } from '../../../src/components/overlays';
import { CalendarIcon, ClockIcon, StopwatchIcon, TagIcon } from '../../../src/components/icons';
import { ErrorState, SkeletonList } from '../../../src/components/states';

/**
 * Booking detail (design 2026-08-31) — the ONLY place a guest cancels.
 * The cancel control is present in every eligible state and REFUSED with a
 * stated reason when the window is closed (spec R8 — visible, never hidden);
 * refusal offers the venue phone. Cancelled bookings state it plainly.
 */
export default function BookingDetailScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const bookings = useMyBookings();
  const courts = useCourts();
  const settings = useVenueSettings();
  const cancel = useCancelReservation();
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const booking = useMemo(
    () => (bookings.data ?? []).find((b) => b.id === id) ?? null,
    [bookings.data, id],
  );
  const court = booking ? courts.data?.find((c) => c.id === booking.court_id) : null;
  const phone = venuePhoneOf(settings.data);

  /**
   * When the policy is unknown, offer the action anyway: app.cancel_reservation
   * enforces the window server-side and its refusal maps to a real message. A
   * refusal the guest can read beats a control that quietly is not there.
   */
  const windowHours = settings.data?.cancellation_window_hours ?? 0;
  const now = new Date();
  const start = booking ? new Date(booking.start_at) : null;
  const end = booking ? new Date(booking.end_at) : null;
  const upcomingActive =
    booking != null &&
    start != null &&
    start.getTime() > now.getTime() &&
    (booking.status === 'confirmed' || booking.status === 'pending');
  const eligible = booking != null && canCancel(booking, windowHours, now);
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
    if (phone) void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);
  };

  return (
    <Screen style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={booking ? t('booking.bookingRef', { ref: displayRef(booking.id) }) : ''}
      />
      {bookings.isLoading ? (
        <SkeletonList rows={2} height={140} />
      ) : bookings.isError ? (
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(bookings.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void bookings.refetch()}
          busy={bookings.isRefetching}
        />
      ) : !booking ? (
        <ErrorState
          title={t('errors.notFound')}
          message={t('booking.notFound')}
          retryLabel={t('common.back')}
          onRetry={() => router.back()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
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
                style={{
                  flex: 1,
                  fontFamily: fonts.display900,
                  fontSize: 20,
                  textTransform: 'uppercase',
                  color: colors.ink,
                }}
              >
                {court ? pickLocale({ en: court.name_en, ar: court.name_ar }, locale) : ''}
              </Text>
              <StatusPill status={booking.status} />
            </View>
            <View
              style={{
                borderTopWidth: 1,
                borderStyle: 'dashed',
                borderTopColor: colors.line,
                marginTop: 13,
                marginBottom: 13,
              }}
            />
            <SummaryGrid
              rows={[
                ...(start
                  ? [
                      { icon: CalendarIcon, label: t('booking.date'), value: formatDate(start, locale) },
                      {
                        icon: ClockIcon,
                        label: t('booking.time'),
                        value: `${formatTime(start, locale)}${end ? `–${formatTime(end, locale)}` : ''}`,
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
                ...(booking.price_iqd != null
                  ? [
                      {
                        icon: TagIcon,
                        label: t('booking.priceAtDesk'),
                        value: formatIQD(booking.price_iqd, locale),
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
                padding: space.m,
              }}
            >
              <Text
                style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 }}
              >
                <Text style={{ fontFamily: fonts.body800 }}>{t('booking.weeklySeries')}. </Text>
                {t('booking.seriesNotice')}
              </Text>
            </View>
          ) : null}

          {upcomingActive && eligible ? (
            <View
              style={{
                marginTop: 10,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.button,
                padding: space.m,
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
                  {t('booking.freeCancelUntil', { when: formatDate(windowEnd, locale) + ", " + formatTime(windowEnd, locale) })}
                </Text>
              ) : null}
              <Button
                label={t('booking.cancelBooking')}
                variant="dangerOutline"
                busy={cancel.isPending}
                onPress={() => setDialogOpen(true)}
              />
            </View>
          ) : null}

          {upcomingActive && !eligible ? (
            <View
              style={{
                marginTop: 10,
                backgroundColor: colors.redtint,
                borderWidth: 1,
                borderColor: colors.redline,
                borderRadius: radius.button,
                padding: space.m,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 12,
                  letterSpacing: 0.48,
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
                  when: windowEnd ? formatDate(windowEnd, locale) + ", " + formatTime(windowEnd, locale) : '',
                })}
              </Text>
              <Button label={t('booking.callVenue')} variant="danger" onPress={callVenue} />
            </View>
          ) : null}

          {booking.status === 'cancelled' ? (
            <View
              style={{
                marginTop: 10,
                backgroundColor: colors.sub,
                borderRadius: radius.button,
                padding: space.m,
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
            <PayAtDeskCard body={t('booking.payAtDeskShort')} />
          </View>

          <ErrorText>{error}</ErrorText>
        </ScrollView>
      )}

      <ConfirmationDialog
        visible={dialogOpen}
        title={t('booking.cancelDialogTitle')}
        body={t('booking.cancelDialogBody', {
          when: start ? formatDate(start, locale) + ", " + formatTime(start, locale) : '',
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
