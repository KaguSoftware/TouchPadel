import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatIQD, formatTime } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useConfirmBooking } from '../../src/features/booking/hooks';
import { secondsUntil } from '../../src/features/booking/logic';
import {
  isDegradedRefusal,
  mapErrorToKey,
  rpcErrorCode,
} from '../../src/features/booking/errors';
import { useVenueSettings } from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Button, Card, ErrorText, Screen, ScreenHeader } from '../../src/components/ui';
import { PayAtDeskCard, SummaryGrid } from '../../src/components/booking';
import { ConfirmationDialog } from '../../src/components/overlays';
import { CalendarIcon, ClockIcon, StopwatchIcon, TagIcon } from '../../src/components/icons';

/**
 * Review & confirm (design 2026-08-31): navy hold card with live countdown and
 * progress bar, summary grid, the pay-at-desk card (spec: never optional), the
 * cancellation policy line, and a ConfirmationDialog before the write (R7).
 * Distinct full-screen states for hold-expired and slot-taken.
 */
export default function ReviewScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    holdId?: string;
    expiresAt?: string;
    priceIqd?: string;
    courtName?: string;
    startAt?: string;
    durationMin?: string;
  }>();
  const holdId = typeof params.holdId === 'string' ? params.holdId : '';
  const expiresAt =
    typeof params.expiresAt === 'string' && params.expiresAt ? params.expiresAt : null;
  const price = params.priceIqd ? Number(params.priceIqd) : NaN;
  const startAt =
    typeof params.startAt === 'string' && params.startAt ? new Date(params.startAt) : null;
  const durationMin = params.durationMin ? Number(params.durationMin) : null;
  const courtName = typeof params.courtName === 'string' ? params.courtName : '';

  const settings = useVenueSettings();
  const confirm = useConfirmBooking();
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(expiresAt, new Date()));
  // Progress bar baseline: the remaining time when this screen mounted.
  const initialSeconds = useRef(Math.max(secondsLeft, 1)).current;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slotTaken, setSlotTaken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setSecondsLeft(secondsUntil(expiresAt, new Date())), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const confirmed = confirm.isSuccess;
  const expired = !confirmed && !slotTaken && secondsLeft <= 0;
  const pct = Math.max(0, Math.min(100, Math.round((secondsLeft / initialSeconds) * 100)));
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  const endAt =
    startAt && durationMin ? new Date(startAt.getTime() + durationMin * 60_000) : null;
  const whenLine = startAt
    ? `${formatDate(startAt, locale)}, ${formatTime(startAt, locale)}${
        endAt ? `–${formatTime(endAt, locale)}` : ''
      }`
    : '';
  const windowHours = settings.data?.cancellation_window_hours ?? null;

  const onConfirm = () => {
    setError(null);
    confirm.mutate(holdId, {
      onSuccess: (result) => {
        setDialogOpen(false);
        const id = result.reservation_id ?? holdId;
        router.replace({
          pathname: '/success',
          params: {
            reservationId: id,
            courtName,
            startAt: params.startAt ?? '',
            durationMin: params.durationMin ?? '',
            priceIqd: String(result.price_iqd ?? price ?? ''),
          },
        });
      },
      onError: (err) => {
        setDialogOpen(false);
        const message = err instanceof Error ? err.message : null;
        const code = rpcErrorCode(message);
        if (isDegradedRefusal(message)) {
          const phone = venuePhoneOf(settings.data);
          setError(
            phone ? t('degraded.bookingRefused', { phone }) : t('degraded.bookingRefusedShort'),
          );
        } else if (code === 'HOLD_EXPIRED') {
          setSecondsLeft(0);
        } else if (code === 'SLOT_TAKEN') {
          setSlotTaken(true);
        } else {
          setError(t(mapErrorToKey(err)));
        }
      },
    });
  };

  const backToAvailability = () => router.replace('/availability');

  // ── Terminal states ────────────────────────────────────────────────────────
  if (expired || slotTaken) {
    const taken = slotTaken;
    return (
      <Screen style={{ paddingTop: insets.top }}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingStart: 32,
            paddingEnd: 32,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: radius.pill,
              backgroundColor: taken ? colors.redtint : colors.sub,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                fontFamily: fonts.display800,
                fontSize: taken ? 22 : 24,
                color: taken ? colors.redtext : colors.fnt,
              }}
            >
              {taken ? '!' : '0'}
            </Text>
          </View>
          <Text
            style={{
              fontFamily: fonts.display900,
              fontSize: 20,
              textTransform: 'uppercase',
              color: colors.ink,
              marginTop: 18,
              textAlign: 'center',
            }}
          >
            {taken ? t('booking.slotTakenTitle') : t('booking.holdExpiredTitle')}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 13,
              lineHeight: 21,
              color: colors.mut,
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            {taken ? t('booking.slotTakenBody') : t('booking.holdExpiredBody')}
          </Text>
          <Button
            label={t('booking.backToAvailability')}
            onPress={backToAvailability}
            variant="cta"
            style={{ marginTop: 22, alignSelf: 'stretch' }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingTop: insets.top }}>
      <ScreenHeader title={t('booking.reviewTitle')} />

      {/* Navy hold card with countdown */}
      <View
        style={{
          backgroundColor: brand.navy,
          borderRadius: radius.button,
          paddingStart: space.m,
          paddingEnd: space.m,
          paddingTop: space.sm,
          paddingBottom: space.sm,
        }}
      >
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <StopwatchIcon size={13} color={brand.green} />
            <Text
              style={{
                fontFamily: fonts.body700,
                fontSize: 11,
                letterSpacing: 0.66,
                textTransform: 'uppercase',
                color: brand.green,
              }}
            >
              {t('booking.heldForYou')}
            </Text>
          </View>
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 18,
              color: brand.white,
              fontVariant: ['tabular-nums'],
            }}
          >
            {countdown}
          </Text>
        </View>
        <View
          style={{
            height: 5,
            backgroundColor: brand.navyTrack,
            borderRadius: radius.pill,
            marginTop: 9,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: radius.pill,
              backgroundColor: pct < 25 ? brand.dangerSoft : brand.green,
            }}
          />
        </View>
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 11,
            lineHeight: 16,
            color: brand.navyText,
            marginTop: 8,
          }}
        >
          {t('booking.holdExplainer')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <Text
            style={{
              fontFamily: fonts.display900,
              fontSize: 20,
              textTransform: 'uppercase',
              color: colors.ink,
            }}
          >
            {courtName}
          </Text>
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
              ...(startAt
                ? [
                    { icon: CalendarIcon, label: t('booking.date'), value: formatDate(startAt, locale) },
                    {
                      icon: ClockIcon,
                      label: t('booking.time'),
                      value: `${formatTime(startAt, locale)}${endAt ? `–${formatTime(endAt, locale)}` : ''}`,
                    },
                  ]
                : []),
              ...(durationMin
                ? [
                    {
                      icon: StopwatchIcon,
                      label: t('booking.duration'),
                      value: t('booking.durationMinutes', { minutes: durationMin }),
                    },
                  ]
                : []),
              ...(Number.isInteger(price)
                ? [
                    {
                      icon: TagIcon,
                      label: t('booking.price'),
                      value: formatIQD(price, locale),
                      valueColor: colors.gtext,
                      emphasis: true,
                    },
                  ]
                : []),
            ]}
          />
        </Card>

        <View style={{ marginTop: space.sm }}>
          <PayAtDeskCard title={t('booking.payAtDeskTitle')} body={t('booking.payAtDeskBody')} />
        </View>

        {windowHours != null ? (
          <Text
            style={{
              marginTop: space.sm,
              paddingStart: 4,
              paddingEnd: 4,
              fontFamily: fonts.body400,
              fontSize: 11.5,
              lineHeight: 18,
              color: colors.fnt,
            }}
          >
            {t('booking.policyLine', { hours: windowHours })}
          </Text>
        ) : null}

        <ErrorText>{error}</ErrorText>
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, start: 0, end: 0, paddingStart: space.l, paddingEnd: space.l, paddingBottom: 20 + insets.bottom, paddingTop: space.sm, backgroundColor: colors.bg }}>
        <Button
          label={t('booking.reserveCta')}
          onPress={() => setDialogOpen(true)}
          variant="cta"
          disabled={!holdId}
        />
      </View>

      <ConfirmationDialog
        visible={dialogOpen}
        title={t('booking.reserveDialogTitle')}
        body={t('booking.reserveDialogBody', {
          court: courtName,
          when: whenLine,
          price: Number.isInteger(price) ? formatIQD(price, locale) : '',
        })}
        confirmLabel={confirm.isPending ? t('booking.reserving') : t('booking.reserveCta')}
        busy={confirm.isPending}
        onConfirm={onConfirm}
        onDismiss={() => setDialogOpen(false)}
      />
    </Screen>
  );
}
