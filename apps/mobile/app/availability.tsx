import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localParts, pickLocale, wallTimeToUtc } from '@touch/core';
import { formatDayNumber, formatTime, formatWeekdayShort } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import {
  useCourts,
  useCourtsBroadcast,
  useDayGrid,
  useIsDegraded,
  useVenueSettings,
} from '../src/features/availability/hooks';
import {
  addDays,
  DEFAULT_TZ,
  hasAnySlots,
  listBookableDates,
  mergeAcrossCourts,
  venuePhoneOf,
  type MergedCell,
} from '../src/features/availability/assemble';
import { useHoldSlot } from '../src/features/booking/hooks';
import { setPendingSlot } from '../src/features/booking/pendingSlot';
import { isDegradedRefusal, mapErrorToKey } from '../src/features/booking/errors';
import { useAuth } from '../src/features/auth/context';
import { profileGateState } from '../src/features/auth/social';
import { useOwnProfile } from '../src/features/profile/hooks';
import { callPhone } from '../src/lib/phone';
import { chunkArray } from '../src/lib/chunk';
import { formatPrice } from '../src/lib/price';
import { ErrorState, SkeletonList } from '../src/components/states';
import { space, useTheme } from '../src/theme';
import { ErrorText, Hint, Screen, ScreenHeader, SegmentedControl } from '../src/components/ui';
import { DayChip, DegradedBanner, SlotCell } from '../src/components/booking';
import { NoticeSheet, useToast } from '../src/components/overlays';

const GUTTER = space.l;
/** Design: the grid sits 18 px inside a section that is itself 16 px in. */
const GRID_INSET = 18 + space.l;

/**
 * Merged availability (design 2026-08-31): ONE timeline across both courts —
 * each hour shows capacity; the desk assigns the physical court. A day chip is
 * a TRADING NIGHT (09:00 through the small hours of the next date), not a
 * calendar day — see assembleTradingNight. Public screen; a signed-out tap
 * routes through Welcome with the slot kept as pending intent.
 */
export default function AvailabilityScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session } = useAuth();
  // D3: a profile without a phone cannot book; the gate reuses the guest flow
  // (pending slot -> complete-profile -> hold). 'unknown' proceeds — Review re-checks.
  const profile = useOwnProfile(!!session);
  const profileGate = profileGateState(profile);
  const courts = useCourts();
  const venueSettings = useVenueSettings();
  const degraded = useIsDegraded();

  // One minute tick drives "past" cells and the day strip. The heavy grid
  // build (useDayGrid) is data-driven only; applying the clock is O(cells).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const tz = venueSettings.data?.timezone ?? DEFAULT_TZ;
  // Venue-local today + 6 days, re-derived every minute so an app left open
  // past midnight does not keep offering yesterday as "today" — except while
  // yesterday's night is still trading (until 02:00), when it leads the strip.
  const tzDates = useMemo(
    () => listBookableDates(now, tz, 6, venueSettings.data),
    [now, tz, venueSettings.data],
  );
  const [date, setDate] = useState<string>(() => tzDates[0] ?? '');
  // Until the guest picks a chip, the strip's first entry is the selection —
  // so the still-running night takes over once venue hours arrive (a cold
  // start used to land on today and a warm one, from the persisted cache, on
  // last night), and a date that drops off the strip falls back the same way.
  const picked = useRef(false);
  useEffect(() => {
    const first = tzDates[0];
    if (first === undefined) return;
    if (!tzDates.includes(date) || (!picked.current && date !== first)) setDate(first);
  }, [tzDates, date]);

  const [durationMin, setDurationMin] = useState(60);
  const day = useDayGrid(date);
  useCourtsBroadcast(); // live slot_changed -> availability invalidation

  const [notice, setNotice] = useState<'blocked' | 'horizon' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hold = useHoldSlot();

  // Transient state belongs to the day/duration it happened on.
  useEffect(() => {
    setError(null);
    setNotice(null);
  }, [date, durationMin]);

  const phone = venuePhoneOf(day.settings);

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
    // Counted from the venue-local calendar day, not the strip: the strip can
    // open on yesterday's still-running night.
    return wallTimeToUtc(addDays(localParts(now, tz).date, 2), 0, tz);
  }, [degraded, now, tz]);

  const cells = useMemo(
    () => mergeAcrossCourts(day.grid, durationMin, horizonEnd, now),
    [day.grid, durationMin, horizonEnd, now],
  );
  // Rows of two: an odd trailing cell stays half width (design `repeat(2, 1fr)`).
  const rows = useMemo(() => chunkArray(cells, 2), [cells]);

  // "Closed" means the venue does not trade that day. A duration that simply
  // has no priced slots is "no times", not "closed" — the old check compared
  // the COURT count, so picking 90 min on a 60-only tariff said VENUE CLOSED.
  const closedDay =
    (day.settings?.closed_dates ?? []).includes(date) ||
    (!day.isLoading && !day.isError && day.grid.length > 0 && !hasAnySlots(day.grid));

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
    if (profileGate === 'incomplete') {
      setPendingSlot({
        courtId: cell.courtId,
        startAt: cell.startAt.toISOString(),
        durationMin,
        priceIqd: cell.priceIqd,
        courtNameEn: court?.name_en ?? '',
        courtNameAr: court?.name_ar ?? '',
      });
      router.push({ pathname: '/(auth)/complete-profile', params: { returnTo: 'continue' } });
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
              // '' = no deadline (duplicate replay of a hold we already have).
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
        return formatPrice(cell.priceIqd, locale) ?? t('booking.noRate');
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

  const onCall = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone }), 'error');
    });
  };

  return (
    // Unpadded so the day strip can scroll out under the screen edge; every
    // other block carries its own gutter.
    <Screen padded={false}>
      <View style={{ paddingStart: GUTTER, paddingEnd: GUTTER }}>
        <ScreenHeader title={t('booking.availabilityTitle')} />
      </View>

      {degraded ? (
        <View style={{ marginTop: 6, marginStart: GUTTER, marginEnd: GUTTER }}>
          <DegradedBanner
            tight
            lead={t('degraded.leadDeskOnly')}
            message={t('degraded.bannerAvailability', { phone: phone ?? '' })}
            phone={phone}
          />
        </View>
      ) : null}

      {/*
        Day strip — venue timezone + Latin digits via the shared formatters.

        `flexShrink: 0` is load-bearing. RN's ScrollView base style is
        `{ flexGrow: 1, flexShrink: 1 }`, so overriding flexGrow alone left this
        strip as the ONLY shrinkable child of the screen column: every time the
        content below overflowed, Yoga took the height out of the chips. Result:
        tapping a day made the strip snap to full height (skeleton — nothing
        overflows) and squash again a second later when the grid landed. The day
        chips are a fixed-height control; they never give up height.
      */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{
          gap: 7,
          paddingStart: GUTTER,
          paddingEnd: GUTTER,
          paddingTop: 10,
          paddingBottom: 2,
        }}
      >
        {tzDates.map((d) => {
          const noon = wallTimeToUtc(d, 12 * 60, tz);
          return (
            <DayChip
              key={d}
              dow={formatWeekdayShort(noon, locale, tz)}
              dayNum={formatDayNumber(noon, locale, tz)}
              selected={d === date}
              closed={isClosedDate(d)}
              closedLabel={t('booking.closedChip')}
              onPress={() => {
                picked.current = true;
                setDate(d);
              }}
            />
          );
        })}
      </ScrollView>

      {/* Duration segmented control (intrinsic width, per the design) */}
      <View style={{ marginTop: 10, paddingStart: GUTTER, paddingEnd: GUTTER }}>
        <SegmentedControl
          fit
          options={durations.map((m) => ({
            value: m,
            label: t('booking.durationMinutes', { minutes: m }),
          }))}
          value={durationMin}
          onChange={setDurationMin}
          activeColor={colors.gstrong}
        />
      </View>

      <View style={{ paddingStart: GUTTER, paddingEnd: GUTTER }}>
        <ErrorText>{error}</ErrorText>
      </View>

      {day.isLoading ? (
        <View
          style={{ flex: 1, marginTop: space.l, paddingStart: GRID_INSET, paddingEnd: GRID_INSET }}
        >
          <SkeletonList rows={4} height={52} />
        </View>
      ) : day.isError ? (
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(day.error))}
          retryLabel={t('common.retry')}
          onRetry={day.refetch}
          busy={day.isRefetching}
        />
      ) : closedDay ? (
        <View
          style={{ flex: 1, marginTop: 30, alignItems: 'center', paddingStart: 24, paddingEnd: 24 }}
        >
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
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={day.isRefetching}
              onRefresh={day.refetch}
              tintColor={colors.blue}
            />
          }
          contentContainerStyle={{
            paddingTop: space.xl,
            paddingBottom: 24 + insets.bottom,
            paddingStart: GRID_INSET,
            paddingEnd: GRID_INSET,
          }}
          showsVerticalScrollIndicator={false}
        >
          {cells.length === 0 ? (
            <Hint>{t('booking.noSlots')}</Hint>
          ) : (
            <>
              {rows.map((row, i) => (
                <View
                  key={row[0]?.startAt.toISOString() ?? i}
                  style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}
                >
                  {row.map((cell) => (
                    <SlotCell
                      key={cell.startAt.toISOString()}
                      cell={cell}
                      time={formatTime(cell.startAt, locale, tz)}
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
                  {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                </View>
              ))}
              <Text
                style={{
                  marginTop: 10,
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
        onCall={onCall}
        onClose={() => setNotice(null)}
      />
    </Screen>
  );
}
