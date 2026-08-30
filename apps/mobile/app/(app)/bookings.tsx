import { useMemo, useState } from 'react';
import { Alert, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { formatDate, formatIQD, formatTime } from '@touch/i18n';
import type { MessageKey } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useCancelReservation, useMyBookings } from '../../src/features/booking/hooks';
import { canCancel, splitBookings, type BookingRow } from '../../src/features/booking/logic';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useCourts, useCourtsBroadcast, useVenueSettings } from '../../src/features/availability/hooks';
import { theme } from '../../src/theme';
import { Button, ErrorText, Hint, Screen } from '../../src/components/ui';
import { ErrorState, SkeletonList } from '../../src/components/states';

const STATUS_KEY: Record<string, MessageKey> = {
  pending: 'booking.statusPending',
  confirmed: 'booking.statusConfirmed',
  arrived: 'booking.statusArrived',
  completed: 'booking.statusCompleted',
  cancelled: 'booking.statusCancelled',
  no_show: 'booking.statusNoShow',
  expired: 'booking.statusExpired',
};

/** Upcoming + past own bookings; cancel via app.cancel_reservation. */
export default function BookingsScreen() {
  const { t, locale } = useLocale();
  const bookings = useMyBookings();
  const courts = useCourts();
  const settings = useVenueSettings();
  const cancel = useCancelReservation();
  const [error, setError] = useState<string | null>(null);
  useCourtsBroadcast(); // desk moves/cancels reflect live

  const sections = useMemo(() => {
    const { upcoming, past } = splitBookings(bookings.data ?? [], new Date());
    return [
      { title: t('booking.upcoming'), key: 'upcoming', data: upcoming },
      { title: t('booking.past'), key: 'past', data: past },
    ];
  }, [bookings.data, t]);

  // O(1) lookup built once, instead of an O(n) `.find` per row inside
  // renderItem (which ran on every render of every visible row).
  const courtNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courts.data ?? []) {
      m.set(c.id, pickLocale({ en: c.name_en, ar: c.name_ar }, locale));
    }
    return m;
  }, [courts.data, locale]);

  const courtName = (courtId: string): string => courtNames.get(courtId) ?? '';

  /**
   * The venue's real policy is 4 hours (client intake pack 2026-08-29), read live from
   * `venue_settings_public`. The fallback used to be a hardcoded 12 — so whenever the settings
   * fetch failed, a guest was silently denied cancellation for three times longer than the policy
   * actually allows, with no button and no explanation.
   *
   * When the policy is unknown, offer the action: `app.cancel_reservation` enforces the window
   * server-side and returns CANCELLATION_WINDOW, which `booking/errors.ts` already maps to a real
   * message. A refusal the guest can read beats a control that quietly is not there.
   */
  const windowHours = settings.data?.cancellation_window_hours ?? 0;

  const onCancel = (row: BookingRow) => {
    Alert.alert(t('booking.cancelBooking'), t('booking.cancelConfirmPrompt'), [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          cancel.mutate(row.id, {
            onError: (err) => setError(t(mapErrorToKey(err))),
          });
        },
      },
    ]);
  };

  if (bookings.isLoading) {
    return (
      <Screen>
        <SkeletonList rows={3} height={96} />
      </Screen>
    );
  }

  // Same lie as the court list: a failed fetch used to render the empty-state
  // copy, telling the guest they have no bookings when we simply could not
  // reach the server. That is the worst possible thing to be wrong about here.
  if (bookings.isError) {
    return (
      <Screen>
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(bookings.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void bookings.refetch()}
          busy={bookings.isRefetching}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={bookings.isRefetching}
            onRefresh={() => void bookings.refetch()}
            tintColor={theme.accent}
          />
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0 && section.key === 'upcoming' ? (
            <Hint>{t('booking.noBookings')}</Hint>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardCourt}>{courtName(item.court_id)}</Text>
              <Text style={styles.cardStatus}>
                {t(STATUS_KEY[item.status] ?? 'booking.statusPending')}
              </Text>
            </View>
            <Text style={styles.cardWhen}>
              {formatDate(new Date(item.start_at), locale)}
              {' · '}
              {formatTime(new Date(item.start_at), locale)}–{formatTime(new Date(item.end_at), locale)}
            </Text>
            {item.price_iqd != null ? (
              <Text style={styles.cardPrice}>{formatIQD(item.price_iqd, locale)}</Text>
            ) : null}
            {canCancel(item, windowHours, new Date()) ? (
              <Button
                label={t('booking.cancelBooking')}
                variant="danger"
                busy={cancel.isPending && cancel.variables === item.id}
                onPress={() => onCancel(item)}
              />
            ) : null}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.fg,
    marginTop: 16,
    marginBottom: 4,
    backgroundColor: theme.bg,
  },
  card: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    backgroundColor: theme.surface,
    paddingStart: 14,
    paddingEnd: 14,
    paddingTop: 10,
    paddingBottom: 10,
    marginTop: 8,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCourt: { fontSize: 16, fontWeight: '700', color: theme.fg },
  cardStatus: { fontSize: 13, fontWeight: '600', color: theme.accent },
  cardWhen: { fontSize: 14, color: theme.mutedFg, marginTop: 4 },
  cardPrice: { fontSize: 14, color: theme.fg, fontWeight: '600', marginTop: 4 },
});
