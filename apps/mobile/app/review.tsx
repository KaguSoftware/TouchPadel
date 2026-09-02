import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { formatDate, formatDateTime, formatIQD, formatTimeRange } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useConfirmBooking } from '../src/features/booking/hooks';
import { secondsUntil } from '../src/features/booking/logic';
import {
  isDegradedRefusal,
  mapErrorToKey,
  rpcErrorCode,
} from '../src/features/booking/errors';
import { useVenueSettings } from '../src/features/availability/hooks';
import { venuePhoneOf } from '../src/features/availability/assemble';
import { useAuth } from '../src/features/auth/context';
import { profileGateState } from '../src/features/auth/social';
import { useOwnProfile } from '../src/features/profile/hooks';
import { brand, radius, space, useTheme } from '../src/theme';
import {
  Button,
  Card,
  DashedDivider,
  ErrorText,
  LinkText,
  Screen,
} from '../src/components/ui';
import { PayAtDeskCard, SummaryGrid } from '../src/components/booking';
import { ConfirmationDialog } from '../src/components/overlays';
import { CalendarIcon, ClockIcon, StopwatchIcon, TagIcon } from '../src/components/icons';

/**
 * Review & confirm (design 2026-08-31): navy hold card with live countdown and
 * progress bar, summary grid, the pay-at-desk card (spec: never optional), the
 * cancellation policy line, and a ConfirmationDialog before the write (R7).
 * Distinct full-screen states for hold-expired and slot-taken.
 *
 * Back is a plain pop: there is no app.release_hold() yet (HANDOFF gotcha —
 * cancel_reservation refuses a same-day hold), so the countdown is what
 * returns an abandoned slot to the grid.
 */
function ReviewScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    holdId?: string;
    expiresAt?: string;
    priceIqd?: string;
    courtName?: string;
    startAt?: string;
    durationMin?: string;
    /** 'sheet' when the hold came from the Book tab's booking sheet (still mounted beneath). */
    origin?: string;
  }>();
  const holdId = typeof params.holdId === 'string' ? params.holdId : '';
  // '' means "no deadline" — the duplicate-replay path of app.hold_slot, when
  // the guest re-taps a slot they already hold. It used to count as expired.
  const expiresAt =
    typeof params.expiresAt === 'string' && params.expiresAt ? params.expiresAt : null;
  const price = params.priceIqd ? Number(params.priceIqd) : NaN;
  const startAt =
    typeof params.startAt === 'string' && params.startAt ? new Date(params.startAt) : null;
  const durationMin = params.durationMin ? Number(params.durationMin) : null;
  const courtName = typeof params.courtName === 'string' ? params.courtName : '';

  const settings = useVenueSettings();
  const confirm = useConfirmBooking();
  // D3: no phone, no booking. The hold keeps ticking while the guest adds one;
  // useUpdateProfile's invalidation re-enables Reserve on return.
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const profileGate = profileGateState(profile);
  const addPhone = () =>
    router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() =>
    secondsUntil(expiresAt, new Date()),
  );
  // Progress bar baseline: the remaining time when this screen mounted.
  const initialSeconds = useRef(Math.max(secondsLeft ?? 0, 1)).current;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slotTaken, setSlotTaken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [footerHeight, setFooterHeight] = useState(96);

  const confirmed = confirm.isSuccess;
  const expired = !confirmed && !slotTaken && secondsLeft === 0;

  // Tick only while there is a live countdown.
  useEffect(() => {
    if (expiresAt === null || confirmed || expired) return;
    const id = setInterval(() => setSecondsLeft(secondsUntil(expiresAt, new Date())), 1000);
    return () => clearInterval(id);
  }, [expiresAt, confirmed, expired]);

  const pct =
    secondsLeft === null
      ? 100
      : Math.max(0, Math.min(100, Math.round((secondsLeft / initialSeconds) * 100)));

  // Design: `transition: width .3s linear` — animate between ticks.
  const barWidth = useRef(new Animated.Value(pct)).current;
  useEffect(() => {
    Animated.timing(barWidth, { toValue: pct, duration: 300, useNativeDriver: false }).start();
  }, [barWidth, pct]);

  const countdown =
    secondsLeft === null
      ? ''
      : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  const endAt = startAt && durationMin ? new Date(startAt.getTime() + durationMin * 60_000) : null;
  const whenLine = startAt ? formatDateTime(startAt, locale) : '';
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
        } else if (code === 'PHONE_REQUIRED') {
          // 0059's backstop fired (the gate above was 'unknown'): collect it now.
          addPhone();
        } else {
          setError(t(mapErrorToKey(err)));
        }
      },
    });
  };

  // From the sheet, the grid the guest left is still open underneath — pop back
  // to it (the settled hold invalidated availability, so it is fresh); from the
  // standalone screen, land on the standalone screen.
  const backToAvailability = () => {
    if (params.origin === 'sheet' && router.canGoBack()) router.back();
    else router.replace('/availability');
  };

  // ── Terminal states ────────────────────────────────────────────────────────
  if (expired || slotTaken) {
    const taken = slotTaken;
    return (
      <Screen edges={['bottom']}>
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
          {/* Design: inline-width green button (padding 14×26, 13 pt). */}
          <Button
            label={t('booking.backToAvailability')}
            onPress={backToAvailability}
            variant="cta"
            style={{
              marginTop: 22,
              paddingTop: 14,
              paddingBottom: 14,
              paddingStart: 26,
              paddingEnd: 26,
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('booking.reviewTitle') }} />

      {/* Navy hold card with countdown */}
      <View
        style={{
          marginTop: 4,
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
                letterSpacing: tracking(0.66),
                textTransform: 'uppercase',
                color: brand.green,
              }}
            >
              {t('booking.heldForYou')}
            </Text>
          </View>
          {countdown ? (
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
          ) : null}
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
          <Animated.View
            style={{
              height: '100%',
              width: barWidth.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
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
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: footerHeight + 12 }}
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
          <DashedDivider style={{ marginTop: 13, marginBottom: 13 }} />
          <SummaryGrid
            rows={[
              ...(startAt
                ? [
                    {
                      icon: CalendarIcon,
                      label: t('booking.date'),
                      value: formatDate(startAt, locale),
                    },
                    {
                      icon: ClockIcon,
                      label: t('booking.time'),
                      value: endAt
                        ? formatTimeRange(startAt, endAt, locale)
                        : formatDateTime(startAt, locale),
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

        {profileGate === 'incomplete' ? (
          <View
            style={{
              marginTop: space.sm,
              backgroundColor: colors.amb,
              borderWidth: 1,
              borderColor: colors.ambline,
              borderRadius: radius.cell,
              paddingStart: 13,
              paddingEnd: 13,
              paddingTop: 10,
              paddingBottom: 10,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.body600,
                fontSize: 12.5,
                lineHeight: 19,
                color: colors.ambtext,
              }}
            >
              {t('auth.profileIncompleteNotice')}
            </Text>
            <LinkText
              label={t('auth.addPhoneLink')}
              color={colors.ambstrong}
              onPress={addPhone}
              style={{ marginTop: 6 }}
            />
          </View>
        ) : null}

        <ErrorText>{error}</ErrorText>
      </ScrollView>

      {/* Bottom bar: the design's transparent → bg gradient fade over the content. */}
      <LinearGradient
        colors={[`${colors.bg}00`, colors.bg]}
        locations={[0, 0.4]}
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
        style={{
          position: 'absolute',
          bottom: 0,
          start: 0,
          end: 0,
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: space.sm,
          paddingBottom: 20 + insets.bottom,
        }}
      >
        <Button
          label={t('booking.reserveCta')}
          onPress={() => setDialogOpen(true)}
          variant="cta"
          disabled={!holdId || profileGate === 'incomplete'}
          style={{ paddingTop: 16, paddingBottom: 16 }}
        />
      </LinearGradient>

      <ConfirmationDialog
        visible={dialogOpen}
        title={t('booking.reserveDialogTitle')}
        body={t('booking.reserveDialogBody', {
          court: courtName,
          when: whenLine,
          price: Number.isInteger(price) ? formatIQD(price, locale) : '',
        })}
        confirmLabel={confirm.isPending ? t('booking.reserving') : t('booking.reserveCta')}
        cancelLabel={t('common.notYet')}
        busy={confirm.isPending}
        onConfirm={onConfirm}
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
export default function GuardedReviewScreen() {
  return (
    <RequireSession>
      <ReviewScreen />
    </RequireSession>
  );
}
