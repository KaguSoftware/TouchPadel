import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatIQD, formatTime } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Button } from '../../src/components/ui';
import { SummaryGrid } from '../../src/components/booking';
import { CalendarIcon, CheckIcon, ClockIcon, StopwatchIcon, TagIcon } from '../../src/components/icons';
import { displayRef } from '../../src/features/booking/logic';

/**
 * Booking success (design 2026-08-31): full navy screen, green check, derived
 * REF, summary card, and the pay-at-desk statement (spec: must render here).
 */
export default function SuccessScreen() {
  const { t, locale } = useLocale();
  const { fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    reservationId?: string;
    courtName?: string;
    startAt?: string;
    durationMin?: string;
    priceIqd?: string;
  }>();

  const reservationId = typeof params.reservationId === 'string' ? params.reservationId : '';
  const courtName = typeof params.courtName === 'string' ? params.courtName : '';
  const startAt =
    typeof params.startAt === 'string' && params.startAt ? new Date(params.startAt) : null;
  const durationMin = params.durationMin ? Number(params.durationMin) : null;
  const price = params.priceIqd ? Number(params.priceIqd) : NaN;
  const endAt = startAt && durationMin ? new Date(startAt.getTime() + durationMin * 60_000) : null;

  const navyLabel = '#8FA3C7';

  return (
    <View style={{ flex: 1, backgroundColor: brand.navy, paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 40,
          paddingStart: 24,
          paddingEnd: 24,
          paddingBottom: 24,
          alignItems: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: radius.pill,
            backgroundColor: brand.green,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CheckIcon size={30} color={brand.greenInk} strokeWidth={3} />
        </View>
        <Text
          style={{
            fontFamily: fonts.display900,
            fontSize: 26,
            textTransform: 'uppercase',
            color: brand.white,
            marginTop: 20,
            textAlign: 'center',
          }}
        >
          {t('booking.successTitle')}
        </Text>
        {reservationId ? (
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: 12,
              letterSpacing: 0.96,
              color: brand.green,
              marginTop: 6,
            }}
          >
            {t('booking.refLabel', { ref: displayRef(reservationId) })}
          </Text>
        ) : null}

        <View
          style={{
            alignSelf: 'stretch',
            marginTop: 22,
            backgroundColor: brand.navyCard,
            borderRadius: radius.card,
            padding: space.l,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 16,
              textTransform: 'uppercase',
              color: brand.white,
              marginBottom: 12,
            }}
          >
            {courtName}
          </Text>
          <SummaryGrid
            iconColor={brand.green}
            labelColor={navyLabel}
            valueColor={brand.white}
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
                      valueColor: brand.green,
                      emphasis: true,
                    },
                  ]
                : []),
            ]}
          />
        </View>

        <View
          style={{
            alignSelf: 'stretch',
            marginTop: space.sm,
            backgroundColor: brand.navyCard,
            borderRadius: radius.button,
            paddingStart: space.m,
            paddingEnd: space.m,
            paddingTop: space.sm,
            paddingBottom: space.sm,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 12.5,
              lineHeight: 19,
              color: brand.navyText,
            }}
          >
            <Text style={{ fontFamily: fonts.body800, color: brand.white }}>
              {t('booking.payAtDeskTitle')}.{' '}
            </Text>
            {t('booking.successPayBody')}
          </Text>
        </View>
      </ScrollView>

      <View
        style={{
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingBottom: 22 + insets.bottom,
          gap: 9,
        }}
      >
        <Button
          label={t('booking.viewBooking')}
          variant="cta"
          onPress={() =>
            router.replace({ pathname: '/booking/[id]', params: { id: reservationId } })
          }
        />
        <Button
          label={t('common.done')}
          variant="secondary"
          onPress={() => router.replace('/(tabs)/bookings')}
          style={{ backgroundColor: 'transparent', borderColor: brand.navyLine }}
          labelColor={brand.navyText}
        />
      </View>
    </View>
  );
}
