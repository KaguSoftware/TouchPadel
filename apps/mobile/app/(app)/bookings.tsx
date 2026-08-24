import { useMemo, useState } from 'react';
import { Alert, SectionList, StyleSheet, Text, View } from 'react-native';
import { formatDate, formatIQD, formatTime } from '@touch/i18n';
import type { MessageKey } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useCancelReservation, useMyBookings } from '../../src/features/booking/hooks';
import { canCancel, splitBookings, type BookingRow } from '../../src/features/booking/logic';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useCourts, useCourtsBroadcast, useVenueSettings } from '../../src/features/availability/hooks';
import { theme } from '../../src/theme';
import { Button, ErrorText, Hint, Loading, Screen } from '../../src/components/ui';

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

  const courtName = (courtId: string): string => {
    const c = courts.data?.find((x) => x.id === courtId);
    return c ? pickLocale({ en: c.name_en, ar: c.name_ar }, locale) : '';
  };

  const windowHours = settings.data?.cancellation_window_hours ?? 12;

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

  if (bookings.isLoading) return <Loading />;

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
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
