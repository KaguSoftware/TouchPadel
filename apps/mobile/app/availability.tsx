import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../src/i18n/text';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { wallTimeToUtc } from '@touch/core';
import { formatDayNumber, formatTime, formatWeekdayShort, isolate } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAvailabilityBooking } from '../src/features/availability/useAvailabilityBooking';
import { mapErrorToKey } from '../src/features/booking/errors';
import { ErrorState, SkeletonList } from '../src/components/states';
import { space, useTheme } from '../src/theme';
import { ErrorText, Hint, Screen, SegmentedControl } from '../src/components/ui';
import { DayChip, DegradedToast, SlotCell } from '../src/components/booking';
import { NoticeSheet } from '../src/components/overlays';

const GUTTER = space.l;
/** Design: the grid sits 18 px inside a section that is itself 16 px in. */
const GRID_INSET = 18 + space.l;

/**
 * Merged availability (design 2026-08-31): ONE timeline across both courts —
 * each hour shows capacity; the desk assigns the physical court. A day chip is
 * a TRADING NIGHT (09:00 through the small hours of the next date), not a
 * calendar day — see assembleTradingNight. Public screen; a signed-out tap
 * routes through Welcome with the slot kept as pending intent.
 *
 * Still reachable in its own right (My bookings' empty states, Review's
 * "back to availability", the post-auth fallback); the Book tab now opens the
 * same flow in place, as a sheet over the court (components/BookingSheet.tsx).
 * All state and handlers live in useAvailabilityBooking — this file is layout.
 */
export default function AvailabilityScreen() {
  const { t, dir, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const a = useAvailabilityBooking({ origin: 'screen' });

  // The list starts at tonight's first bookable time — the hook drops every hour
  // that has already started — so a fresh ScrollView per day/duration opens
  // where it should with no homing scroll. `key` does the remount.
  const gridKey = `${a.date}|${a.durationMin}`;

  // The venue notice floats over the grid and leaves only when the guest
  // closes it — a refetch flipping `degraded` back on must not resurrect it.
  const [noticeClosed, setNoticeClosed] = useState(false);

  return (
    // Unpadded so the day strip can scroll out under the screen edge; every
    // other block carries its own gutter.
    <Screen padded={false} edges={[]}>
      <Stack.Screen options={{ title: t('booking.availabilityTitle') }} />

      {a.degraded && !noticeClosed ? (
        <DegradedToast
          lead={t('degraded.leadDeskOnly')}
          message={t('degraded.bannerAvailability', { phone: a.phone ?? '' })}
          phone={a.phone}
          onDismiss={() => setNoticeClosed(true)}
        />
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
        // A fresh mount starts at the leading edge on both platforms; a strip
        // already on screen keeps its scroll offset across a language switch
        // (this screen sits under Welcome/Sign-up while a guest flips to
        // Arabic), and on Android that offset is physical — the strip would
        // then show its logical END. Remount on the direction instead.
        key={dir}
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
        {a.tzDates.map((d) => {
          const noon = wallTimeToUtc(d, 12 * 60, a.tz);
          return (
            <DayChip
              key={d}
              dow={formatWeekdayShort(noon, locale, a.tz)}
              dayNum={formatDayNumber(noon, locale, a.tz)}
              selected={d === a.date}
              closed={a.isClosedDate(d)}
              closedLabel={t('booking.closedChip')}
              onPress={() => a.selectDate(d)}
            />
          );
        })}
      </ScrollView>

      {/* Duration segmented control (intrinsic width, per the design) */}
      <View style={{ marginTop: 10, paddingStart: GUTTER, paddingEnd: GUTTER }}>
        <SegmentedControl
          fit
          options={a.durations.map((m) => ({
            value: m,
            label: t('booking.durationMinutes', { minutes: m }),
          }))}
          value={a.durationMin}
          onChange={a.setDurationMin}
          activeColor={colors.gstrong}
        />
      </View>

      <View style={{ paddingStart: GUTTER, paddingEnd: GUTTER }}>
        <ErrorText>{a.error}</ErrorText>
      </View>

      {a.day.isLoading ? (
        <View
          style={{ flex: 1, marginTop: space.l, paddingStart: GRID_INSET, paddingEnd: GRID_INSET }}
        >
          <SkeletonList rows={4} height={52} />
        </View>
      ) : a.day.isError ? (
        <ErrorState
          title={t('errors.loadFailedTitle')}
          message={t(mapErrorToKey(a.day.error))}
          retryLabel={t('common.retry')}
          onRetry={a.day.refetch}
          busy={a.day.isRefetching}
        />
      ) : a.closedDay ? (
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
          key={gridKey}
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={a.day.isRefetching}
              onRefresh={a.day.refetch}
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
          {a.cells.length === 0 ? (
            <Hint>{t('booking.noSlots')}</Hint>
          ) : (
            <>
              {a.rows.map((row, i) => (
                <View
                  key={row[0]?.startAt.toISOString() ?? i}
                  style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}
                >
                  {row.map((cell) => (
                    <SlotCell
                      key={cell.startAt.toISOString()}
                      cell={cell}
                      time={formatTime(cell.startAt, locale, a.tz)}
                      sub={a.subFor(cell)}
                      capacityLine={a.capacityLineFor(cell)}
                      onPress={() => a.onTapCell(cell)}
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
                {t('booking.availFooter', { count: a.courtCount })}
              </Text>
            </>
          )}
        </ScrollView>
      )}

      <NoticeSheet
        visible={a.notice !== null}
        title={
          a.notice === 'horizon' ? t('booking.deskOnlyTitle') : t('booking.slotUnavailableTitle')
        }
        body={a.notice === 'horizon' ? t('booking.deskOnlyBody') : t('booking.blockedBody')}
        callLabel={a.phone ? t('booking.callPhone', { phone: isolate(a.phone) }) : null}
        onCall={a.onCall}
        onClose={a.dismissNotice}
      />
    </Screen>
  );
}
