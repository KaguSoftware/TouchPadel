import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatDate, formatIQD, formatTime } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useConfirmBooking } from '../../src/features/booking/hooks';
import { secondsUntil } from '../../src/features/booking/logic';
import { isDegradedRefusal, mapErrorToKey, rpcErrorCode } from '../../src/features/booking/errors';
import { useVenueSettings } from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { theme } from '../../src/theme';
import { Button, ErrorText, Hint, Screen, Title } from '../../src/components/ui';

/**
 * Hold -> confirm: countdown from hold_expires_at; confirm calls
 * app.confirm_booking; on expiry the hold auto-releases server-side and we
 * message it here.
 */
export default function ConfirmScreen() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams<{
    holdId?: string;
    expiresAt?: string;
    priceIqd?: string;
    courtName?: string;
    startAt?: string;
    durationMin?: string;
  }>();
  const holdId = typeof params.holdId === 'string' ? params.holdId : '';
  const expiresAt = typeof params.expiresAt === 'string' && params.expiresAt ? params.expiresAt : null;
  const price = params.priceIqd ? Number(params.priceIqd) : NaN;
  const startAt = typeof params.startAt === 'string' && params.startAt ? new Date(params.startAt) : null;
  const durationMin = params.durationMin ? Number(params.durationMin) : null;

  const settings = useVenueSettings();
  const confirm = useConfirmBooking();
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(expiresAt, new Date()));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setSecondsLeft(secondsUntil(expiresAt, new Date())), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expired = !confirmed && secondsLeft <= 0;

  const onConfirm = () => {
    setError(null);
    confirm.mutate(holdId, {
      onSuccess: () => setConfirmed(true),
      onError: (err) => {
        const code = rpcErrorCode(err instanceof Error ? err.message : null);
        if (isDegradedRefusal(err instanceof Error ? err.message : null)) {
          const phone = venuePhoneOf(settings.data);
          setError(
            phone ? t('degraded.bookingRefused', { phone }) : t('degraded.bookingRefusedShort'),
          );
        } else if (code === 'HOLD_EXPIRED') {
          setSecondsLeft(0);
        } else {
          setError(t(mapErrorToKey(err)));
        }
      },
    });
  };

  return (
    <Screen>
      <Title>{t('booking.confirmBooking')}</Title>

      <View style={styles.summary}>
        {params.courtName ? (
          <Row label={t('booking.court')} value={String(params.courtName)} />
        ) : null}
        {startAt ? <Row label={t('booking.date')} value={formatDate(startAt, locale)} /> : null}
        {startAt ? <Row label={t('booking.time')} value={formatTime(startAt, locale)} /> : null}
        {durationMin ? (
          <Row label={t('booking.duration')} value={t('booking.durationMinutes', { minutes: durationMin })} />
        ) : null}
        {Number.isInteger(price) ? (
          <Row label={t('common.total')} value={formatIQD(price, locale)} />
        ) : null}
      </View>

      {confirmed ? (
        <>
          <Hint>{t('booking.confirmed')}</Hint>
          <Hint>{t('booking.payAtDesk')}</Hint>
          <Button label={t('booking.myBookings')} onPress={() => router.replace('/(app)/bookings')} />
        </>
      ) : expired ? (
        <>
          <ErrorText>{t('booking.holdExpired')}</ErrorText>
          <Button label={t('common.back')} onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Text style={styles.countdown}>
            {t('booking.holdCountdown', { seconds: secondsLeft })}
          </Text>
          <ErrorText>{error}</ErrorText>
          <Button
            label={t('common.confirm')}
            onPress={onConfirm}
            busy={confirm.isPending}
            disabled={!holdId}
          />
          <Button label={t('common.cancel')} variant="secondary" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    backgroundColor: theme.surface,
    paddingStart: 14,
    paddingEnd: 14,
    paddingTop: 8,
    paddingBottom: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 6,
  },
  rowLabel: { fontSize: 14, color: theme.mutedFg },
  rowValue: { fontSize: 14, color: theme.fg, fontWeight: '600' },
  countdown: { fontSize: 18, fontWeight: '700', color: theme.accent, marginTop: 12 },
});
