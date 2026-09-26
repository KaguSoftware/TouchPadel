import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../src/i18n/text';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { wallTimeToUtc } from '@touch/core';
import { formatDayNumber, formatTime, formatWeekdayShort } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAvailabilityBooking } from '../src/features/availability/useAvailabilityBooking';
import { BranchPicker } from '../src/features/availability/BranchPicker';
import { mapErrorToKey } from '../src/features/booking/errors';
import { ErrorState, SkeletonList } from '../src/components/states';
import { radius, space, useTheme } from '../src/theme';
import { Hint, Screen, SegmentedControl } from '../src/components/ui';
import {
  CourtFreePill,
  CourtSwitch,
  DayChip,
  DegradedBanner,
  SlotCell,
  freeCountOf,
  slotTestID,
} from '../src/components/booking';
import { chunkArray } from '../src/lib/chunk';
import { ErrorAlert, NoticeSheet } from '../src/components/overlays';

const GUTTER = space.l;
/** Design: the grid sits 18 px inside a section that is itself 16 px in. */
const GRID_INSET = 18 + space.l;

/**
 * Per-court availability (owner, 2026-09-26, layout "C"): a court switch —
 * one segment per court — over the chosen court's night as a three-column
 * grid, and a tap holds that court. (Was one merged timeline across both
 * courts, design 2026-08-31.) A day chip is
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
  // that has already started — so every day/duration opens where it should with
  // no homing scroll.
  //
  // This was a `key` on the ScrollView, which threw the scroller away and
  // rebuilt it — RefreshControl included — on every day chip and every duration
  // tap, to buy the offset back at 0. Reset the offset by hand instead and let
  // React reconcile; the sheet on the Book tab does the same, and has the
  // longer note on why.
  // The court on show. Unset until the guest picks one, and a court that has
  // no times on the chosen day/duration drops out of `lanes` — both fall back
  // to the first court, so there is always one selected.
  const [pickedCourt, setPickedCourt] = useState<string | null>(null);
  const lane = a.lanes.find((l) => l.courtId === pickedCourt) ?? a.lanes[0];
  const courtTabs = useMemo(
    () => a.lanes.map((l, i) => ({ courtId: l.courtId, index: i + 1, name: l.name })),
    [a.lanes],
  );
  // Three per row; an odd trailing cell keeps its width (the row pads with spacers).
  const laneRows = useMemo(() => chunkArray(lane?.cells ?? [], 3), [lane]);

  const gridRef = useRef<ScrollView>(null);
  useEffect(() => {
    gridRef.current?.scrollTo({ y: 0, animated: false });
  }, [a.gridKey, lane?.courtId]);

  // The venue notice floats over the grid and leaves only when the guest
  // closes it — a refetch flipping `degraded` back on must not resurrect it.
  const [noticeClosed, setNoticeClosed] = useState(false);

  return (
    // Unpadded so the day strip can scroll out under the screen edge; every
    // other block carries its own gutter.
    <Screen padded={false} edges={[]}>
      <Stack.Screen options={{ title: t('booking.availabilityTitle') }} />

      {a.degraded && !noticeClosed ? (
        <View style={{ marginTop: space.s, marginStart: GUTTER, marginEnd: GUTTER }}>
          <DegradedBanner
            testID="availability.degraded"
            lead={t('degraded.leadDeskOnly')}
            message={t('degraded.bannerAvailability', { phone: a.phone ?? '' })}
            phone={a.phone}
            blockLead
            onDismiss={() => setNoticeClosed(true)}
          />
        </View>
      ) : null}

      {/* Which branch these times are for; nothing with one open branch. */}
      <BranchPicker
        testID="availability.branch"
        style={{ marginTop: space.s, paddingStart: GUTTER, paddingEnd: GUTTER }}
      />

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
      {/* Inset and clipping, so a pill scrolling out disappears under that line
          rather than running to the screen's edge. The gutter moved OFF the
          content container onto this wrapper: as `contentContainerStyle`
          padding it scrolled with the pills and so clipped nothing, and holding
          it here leaves the first and last pill resting where they did. */}
      <View style={{ marginStart: GUTTER, marginEnd: GUTTER, overflow: 'hidden' }}>
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
            paddingTop: 10,
            paddingBottom: 2,
          }}
        >
          {a.tzDates.map((d) => {
            const noon = wallTimeToUtc(d, 12 * 60, a.tz);
            return (
              <DayChip
                testID={`availability.day.${d}`}
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
      </View>

      {/* Court switch — fixed above the grid like the duration picker, and
          above it (owner, 2026-09-26). Only once there is a court to show: a
          loading, failed or closed day has none. */}
      {lane && !a.day.isLoading && !a.day.isError && !a.closedDay ? (
        <View style={{ marginTop: 10, paddingStart: GUTTER, paddingEnd: GUTTER }}>
          <CourtSwitch
            testID="availability.court"
            courts={courtTabs}
            value={lane.courtId}
            onChange={setPickedCourt}
          />
        </View>
      ) : null}

      {/* Duration segmented control (intrinsic width, per the design), centred
          (owner, 2026-09-26) */}
      <View
        style={{ marginTop: 10, paddingStart: GUTTER, paddingEnd: GUTTER, alignItems: 'center' }}
      >
        <SegmentedControl
          testID="availability.duration"
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


      {a.day.isLoading ? (
        <View
          style={{ flex: 1, marginTop: space.l, paddingStart: GRID_INSET, paddingEnd: GRID_INSET }}
        >
          <SkeletonList rows={4} height={52} />
        </View>
      ) : a.day.isError ? (
        <ErrorState
          testID="availability.error"
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
      ) : a.cells.length === 0 || !lane ? (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={a.day.isRefetching}
              onRefresh={a.day.refetch}
              tintColor={colors.blue}
            />
          }
          contentContainerStyle={{
            paddingTop: space.l,
            paddingBottom: 24 + insets.bottom,
            paddingStart: GRID_INSET,
            paddingEnd: GRID_INSET,
          }}
        >
          <Hint>{t('booking.noSlots')}</Hint>
        </ScrollView>
      ) : (
        // The court's night on a card of its own, FIXED to the rest of the
        // screen (owner, 2026-09-26): the indoor/free line as its header, one
        // border round the lot, and only the grid inside it scrolls — under the
        // header, clipped by the card's rounded edge. Lines up with the court
        // switch above it.
        <View
          style={{
            flex: 1,
            marginTop: space.l,
            marginStart: GUTTER,
            marginEnd: GUTTER,
            marginBottom: 16 + insets.bottom,
            borderRadius: radius.card,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 12,
              paddingBottom: 10,
              paddingStart: 14,
              paddingEnd: 14,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.line,
            }}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.fnt }}>
              {t(lane.indoor ? 'courts.indoor' : 'courts.outdoor')}
            </Text>
            <CourtFreePill free={freeCountOf(lane.cells)} fontSize={12} />
          </View>
          <ScrollView
            ref={gridRef}
            style={{ flex: 1 }}
            refreshControl={
                <RefreshControl
                  refreshing={a.day.isRefetching}
                  onRefresh={a.day.refetch}
                  tintColor={colors.blue}
                />
              }
            contentContainerStyle={{ gap: 8, padding: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Keyed by POSITION: the cells are an interchangeable ladder with
                no state of their own, so a day, duration or court change
                reuses the rows in place (the sheet's copy carries the long
                note). */}
            {laneRows.map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                {row.map((cell, c) => (
                  <SlotCell
                    testID={slotTestID('availability.slot', cell)}
                    key={c}
                    cell={cell}
                    time={formatTime(cell.startAt, locale, a.tz)}
                    sub={a.subFor(cell)}
                    capacityLine=""
                    onPress={a.onTapCell}
                  />
                ))}
                {Array.from({ length: 3 - row.length }, (_, k) => (
                  <View key={`pad${k}`} style={{ flex: 1 }} />
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <ErrorAlert message={a.error} onDismiss={a.dismissError} />

      <NoticeSheet
        visible={a.notice !== null}
        title={
          a.notice === 'horizon' ? t('booking.deskOnlyTitle') : t('booking.slotUnavailableTitle')
        }
        body={a.notice === 'horizon' ? t('booking.deskOnlyBody') : t('booking.blockedBody')}
        // Just "Call" — the number itself is noise in a two-button alert, and an
        // isolated Latin number inside an Arabic label reads badly next to a
        // verb. The dialler shows the number the moment the button is tapped.
        callLabel={a.phone ? t('common.call') : null}
        onCall={a.onCall}
        onClose={a.dismissNotice}
      />
    </Screen>
  );
}
