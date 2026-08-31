import { useMemo, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pickLocale, wallTimeToUtc } from '@touch/core';
import { formatIQD, formatTime } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import {
  useCourts,
  useCourtsBroadcast,
  useDayGrid,
  useIsDegraded,
} from '../src/features/availability/hooks';
import {
  DEFAULT_TZ,
  listBookableDates,
  mergeAcrossCourts,
  venuePhoneOf,
  type MergedCell,
} from '../src/features/availability/assemble';
import { useHoldSlot } from '../src/features/booking/hooks';
import { setPendingSlot } from '../src/features/booking/pendingSlot';
import { isDegradedRefusal, mapErrorToKey } from '../src/features/booking/errors';
import { useAuth } from '../src/features/auth/context';
import { ErrorState, SkeletonList } from '../src/components/states';
import { space, useTheme } from '../src/theme';
import { ErrorText, Hint, Screen, ScreenHeader, SegmentedControl } from '../src/components/ui';
import { DayChip, DegradedBanner, SlotCell } from '../src/components/booking';
import { NoticeSheet } from '../src/components/overlays';

/**
 * Merged availability (design 2026-08-31): ONE timeline across both courts —
 * each hour shows capacity; the desk assigns the physical court. Public screen;
 * a signed-out tap routes through Welcome with the slot kept as pending intent.
 */
export default function AvailabilityScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const courts = useCourts();
  const degraded = useIsDegraded();

  const tzDates = useMemo(() => listBookableDates(new Date(), DEFAULT_TZ, 6), []);
  const [date, setDate] = useState<string>(tzDates[0] ?? '');
  const [durationMin, setDurationMin] = useState(60);
  const day = useDayGrid(date);
  useCourtsBroadcast(); // live slot_changed -> availability invalidation

  const [notice, setNotice] = useState<'blocked' | 'horizon' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hold = useHoldSlot();

  const phone = venuePhoneOf(day.settings);
  const tz = day.settings?.timezone ?? DEFAULT_TZ;

  const durations = useMemo(() => {
    const set = new Set<number>();
    for (const c of courts.data ?? []) for (const d of c.duration_options) set.add(d);
    const out = [...set].sort((a, b) => a - b);
    return out.length > 0 ? out : [60, 90];
  }, [courts.data]);

  // Degraded protects "today & tomorrow" (SOW horizon): everything before the
  // day-after-tomorrow's venue-local midnight renders desk-only.
  const horizonEnd = useMemo(() => {
    if (!degraded) return null;
    const dayAfterTomorrow = tzDates[2];
    return dayAfterTomorrow ? wallTimeToUtc(dayAfterTomorrow, 0, tz) : null;
  }, [degraded, tzDates, tz]);

  const cells = useMemo(
    () => mergeAcrossCourts(day.grid, durationMin, horizonEnd),
    [day.grid, durationMin, horizonEnd],
  );

  const closedDay =
    (day.settings?.closed_dates ?? []).includes(date) ||
    (!day.isLoading && !day.isError && cells.length === 0 && day.grid.length > 0);

  const isClosedDate = (d: string) => (day.settings?.closed_dates ?? []).includes(d);

  const onTapCell = (cell: MergedCell) => {
    if (hold.isPending) return; // one hold at a time — no double-tap races
    setError(null);
    if (cell.state === 'blocked') return setNotice('blocked');
    if (cell.state === 'horizon') return setNotice('horizon');
    if (cell.state !== 'free' || !cell.courtId) return;

    const court = courts.data?.find((c) => c.id === cell.courtId);
    if (!session) {
      // Guest browsing: keep the intent, ask for an account, finish the hold
      // right after auth (pendingSlot flow).
      setPendingSlot({
        courtId: cell.courtId,
        startAt: cell.startAt.toISOString(),
        durationMin,
        priceIqd: cell.priceIqd,
        courtNameEn: court?.name_en ?? '',
        courtNameAr: court?.name_ar ?? '',
      });
      router.push('/(auth)/welcome');
      return;
    }

    hold.mutate(
      { courtId: cell.courtId, startAt: cell.startAt, durationMin },
      {
        onSuccess: (result) => {
          router.push({
            pathname: '/review',
            params: {
              holdId: result.reservationId,
              expiresAt: result.holdExpiresAt ?? '',
              priceIqd: String(result.priceIqd ?? cell.priceIqd ?? ''),
              courtName: court ? pickLocale({ en: court.name_en, ar: court.name_ar }, locale) : '',
              startAt: cell.startAt.toISOString(),
              durationMin: String(durationMin),
            },
          });
        },
        onError: (err) => {
          if (isDegradedRefusal(err.message)) {
            setError(
              phone ? t('degraded.bookingRefused', { phone }) : t('degraded.bookingRefusedShort'),
            );
          } else {
            setError(t(mapErrorToKey(err)));
          }
          day.refetch();
        },
      },
    );
  };

  const subFor = (cell: MergedCell): string => {
    switch (cell.state) {
      case 'free':
        return cell.priceIqd != null ? formatIQD(cell.priceIqd, locale) : t('booking.noRate');
      case 'booked':
        return t('booking.stateBooked');
      case 'held':
        return t('booking.stateHeld');
      case 'blocked':
        return t('booking.stateBlocked');
      case 'horizon':
        return t('booking.deskOnly');
      default:
        return '—';
    }
  };

  const dowFmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-US', { weekday: 'short' });
  const numFmt = new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en-US');

  return (
    <Screen style={{ paddingTop: insets.top }}>
      <ScreenHeader title={t('booking.availabilityTitle')} />

      {degraded ? (
        <View style={{ marginBottom: 6 }}>
          <DegradedBanner message={t('degraded.bannerAvailability', { phone: phone ?? '' })} />
        </View>
      ) : null}

      {/* Day strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, marginTop: 4 }}
        contentContainerStyle={{ gap: 7, paddingBottom: 2 }}
      >
        {tzDates.map((d) => {
          const dateObj = new Date(`${d}T12:00:00Z`);
          return (
            <DayChip
              key={d}
              dow={dowFmt.format(dateObj)}
              dayNum={numFmt.format(dateObj.getUTCDate())}
              selected={d === date}
              closed={isClosedDate(d)}
              closedLabel={t('booking.closedChip')}
              onPress={() => setDate(d)}
            />
          );
        })}
      </ScrollView>

      {/* Duration segmented control */}
      <View style={{ marginTop: 10, alignSelf: 'flex-start', minWidth: 170 }}>
        <SegmentedControl
          options={durations.map((m) => ({
            value: m,
            label: t('booking.durationMinutes', { minutes: m }),
          }))}
          value={durationMin}
          onChange={setDurationMin}
          activeColor={colors.gstrong}
        />
      </View>

      <ErrorText>{error}</ErrorText>

      {day.isLoading ? (
        <View style={{ marginTop: space.l }}>
          <SkeletonList rows={4} height={56} />
        </View>
      ) : day.isError ? (
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t('errors.network')}
          retryLabel={t('common.retry')}
          onRetry={day.refetch}
          busy={day.isRefetching}
        />
      ) : closedDay ? (
        <View style={{ marginTop: 60, alignItems: 'center', paddingStart: 24, paddingEnd: 24 }}>
          <Text
            style={{
              fontFamily: fonts.display900,
              fontSize: 18,
              textTransform: 'uppercase',
              color: colors.mut2,
            }}
          >
            {t('booking.closedDayTitle')}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 13,
              lineHeight: 20,
              color: colors.mut,
              marginTop: 6,
              textAlign: 'center',
            }}
          >
            {t('booking.closedDayBody')}
          </Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={day.isRefetching}
              onRefresh={day.refetch}
              tintColor={colors.blue}
            />
          }
          contentContainerStyle={{ paddingTop: space.l, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {cells.length === 0 ? (
            <Hint>{t('booking.noSlots')}</Hint>
          ) : (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {cells.map((cell) => (
                  <SlotCell
                    key={cell.startAt.toISOString()}
                    cell={cell}
                    time={formatTime(cell.startAt, locale)}
                    sub={subFor(cell)}
                    capacityLine={
                      cell.state === 'free'
                        ? cell.freeCount > 1
                          ? t('booking.capacityFree', { count: cell.freeCount })
                          : t('booking.capacityOne')
                        : ''
                    }
                    onPress={() => onTapCell(cell)}
                  />
                ))}
              </View>
              <Text
                style={{
                  marginTop: space.l,
                  textAlign: 'center',
                  fontFamily: fonts.body400,
                  fontSize: 11,
                  lineHeight: 17,
                  color: colors.fnt,
                }}
              >
                {t('booking.availFooter', { count: courts.data?.length ?? 2 })}
              </Text>
            </>
          )}
        </ScrollView>
      )}

      <NoticeSheet
        visible={notice !== null}
        title={notice === 'horizon' ? t('booking.deskOnlyTitle') : t('booking.slotUnavailableTitle')}
        body={notice === 'horizon' ? t('booking.deskOnlyBody') : t('booking.blockedBody')}
        callLabel={phone ? t('booking.callPhone', { phone }) : null}
        onCall={() => {
          if (phone) void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);
        }}
        onClose={() => setNotice(null)}
      />
    </Screen>
  );
}
