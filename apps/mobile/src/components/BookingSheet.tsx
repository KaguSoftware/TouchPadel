/**
 * The booking view of the court → booking transition (design 2026-09-01,
 * `docs/design/mobile-ui/Court Transition Prototype.html`): a frosted card
 * that floats mid-screen over the pitched, dimmed court and carries the REAL
 * availability flow (useAvailabilityBooking — the same hook as the standalone
 * Availability screen): trading-night day pills, the duration picker, the
 * merged two-column time grid, the desk-only / blocked notice sheet, the hold
 * errors. No footer line — the card is too small to spend 42 pt on copy the
 * Availability screen already carries.
 *
 * Every entrance derives from the shared progress value p:
 *   sheet    0.25 → 1.00  translateY 360 → 0, scale 0.92 → 1     PITCH ease (direction-aware)
 *            0.25 → 0.45  opacity 0 → 1                          linear
 *   pill i   0.45 + i·0.035, length 0.22   opacity + rise 14 px   linear
 *   row r    0.58 + r·0.06, length 0.28    opacity + rise 18 px + scale 0.96 → 1 (rows ≥ 3 share row 3)
 *   scroll edges: 10 / 14 px fades on the pills, 12 / 24 px on the grid, their
 *   ink squared towards the edge so the band never bleeds inward over the
 *   content; the leading fade only once scrolled.
 * Frosted: iOS blurs the court behind (expo-blur) under a 35 % tint; Android
 * draws the tint flat at 94 % — the tab bar's own convention. The blur view
 * itself never sits under an animated opacity (a UIVisualEffectView beneath
 * an alpha < 1 ancestor does not render its blur until alpha hits 1, which
 * would pop it in at p = 0.45): the card's transform lives on the outer view
 * and only the tint, border and content fade in inside it.
 *
 * On a short phone the card caps itself to the stage and the grid shrinks
 * (min 96 pt) instead of the card overflowing under the title or tab bar.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../i18n/text';
import { BlurView } from 'expo-blur';
import { wallTimeToUtc } from '@touch/core';
import { formatDayNumber, formatTime, formatWeekdayShort } from '@touch/i18n';
import { useLocale } from '../i18n/LocaleProvider';
import { useAvailabilityBooking } from '../features/availability/useAvailabilityBooking';
import { mapErrorToKey } from '../features/booking/errors';
import {
  pillSlice,
  pitchEase,
  rowSlice,
  sampleEased,
  SPEC,
  type Dir,
  type Range,
} from '../features/courtTransition/spec';
import { brand, shadows, space, useTheme, withAlpha } from '../theme';
import { Button, SegmentedControl } from './ui';
import { DayChip, SlotCell } from './booking';
import { SkeletonList } from './states';
import { ErrorAlert, NoticeSheet } from './overlays';

/** Prototype: a 280 px card in a 390 px phone; a touch narrower here, the duration picker still fits. */
const CARD_MAX_W = 268;
const CARD_RADIUS = 22;
/**
 * Four compact rows show (46 + 6 gap each) plus a peek at the fifth, the rest
 * scroll. The "assigned at the desk" footer used to sit under this and now
 * does not: the grid took its ~42 pt, so the card is the same height with more
 * of the night on screen. That line still runs under the standalone
 * Availability screen's grid, which has the room for it.
 *
 * Grown with the cells (owner, 2026-09-05: bigger, bolder options): the taller
 * rows would otherwise have shown three and a half. Most of it is the ~26 pt
 * the in-card heading gave back when it moved up to the screen title, so the
 * card is barely taller than it was.
 */
const GRID_H = 216;
const PAD = 10;
interface Entrance {
  opacity: Animated.AnimatedInterpolation<number>;
  translateY: Animated.AnimatedInterpolation<number>;
  scale: Animated.AnimatedInterpolation<number>;
}

/** Linear fade + rise (+ scale) over one slice of p. */
function entrance(
  progress: Animated.Value,
  range: Range,
  rise: number,
  scaleFrom: number,
): Entrance {
  const table = (out: Range) =>
    progress.interpolate({ ...sampleEased(range, out, undefined, 1), extrapolate: 'clamp' });
  return { opacity: table([0, 1]), translateY: table([rise, 0]), scale: table([scaleFrom, 1]) };
}

export interface BookingSheetProps {
  progress: Animated.Value;
  direction: Dir;
  /** Space to leave for the floating tab bar, so the card centres in what is visible. */
  bottomInset: number;
  /** The target state: the card takes touches only while the sheet is meant to be open. */
  isOpen: boolean;
  /** A hold call is in flight — the caller keeps the sheet mounted and the back button idle. */
  onBusyChange?: (busy: boolean) => void;
  /** Any touch inside the card (tap, scroll, drag) — the court behind keeps its rally going. */
  onInteraction?: () => void;
}

export function BookingSheet({
  progress,
  direction,
  bottomInset,
  isOpen,
  onBusyChange,
  onInteraction,
}: BookingSheetProps) {
  const { t, locale, dir } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const dark = appearance === 'dark';
  const a = useAvailabilityBooking({ origin: 'sheet' });
  // Seeded from the window rather than starting at zero. This box spans the
  // stage's full width, so `width` is already exact; `height` is an
  // over-estimate that only ever relaxes the card's cap, and onLayout corrects
  // it on the very next commit. Starting at zero meant the card was not
  // rendered AT ALL on its first frame and the whole tree — pills, picker,
  // grid, every animation node in them — was built a second time when the
  // measurement landed, which is precisely the frame the opening spring needs
  // the JS thread for.
  const windowSize = useWindowDimensions();
  const [container, setContainer] = useState(() => ({
    width: windowSize.width,
    height: windowSize.height,
  }));
  const cardW = Math.min(CARD_MAX_W, Math.max(0, container.width - 40));
  const cardMaxH = Math.max(0, container.height - 24);
  useEffect(() => {
    onBusyChange?.(a.holdPending);
  }, [a.holdPending, onBusyChange]);
  // The grid's first row IS tonight's first bookable time — the hook drops every
  // hour that has already started — so each day/duration opens at the top with
  // nothing above it to scroll back to.
  //
  // This used to be a `key` on the ScrollView — a full unmount and remount of
  // the scroller and everything in it on every day chip and every duration tap,
  // to buy one thing: the offset back at 0. Reset the offset by hand instead
  // and let React reconcile. A duration tap is where that pays most: 60 and 90
  // minutes share nearly all their start times, so the cells' keys match and
  // the rows are updated in place rather than destroyed and rebuilt. A day chip
  // still replaces the cells (new start times, new keys) but no longer the
  // scroller around them. Both were long enough to stall the court's rally
  // behind the card (owner, 2026-09-08: picking between dates "glitches and is
  // not running smoothly").
  //
  // A date that is NOT cached shows the skeleton first, so its list mounts
  // fresh at 0 anyway and the ref below is simply null that time round.
  const gridKey = `${a.date}|${a.durationMin}`;
  const gridRef = useRef<ScrollView>(null);
  useEffect(() => {
    gridRef.current?.scrollTo({ y: 0, animated: false });
  }, [gridKey]);

  // Sheet: direction-aware PITCH ease (remapped inside its 0.25 → 1 slice).
  const sheet = useMemo(() => {
    const ease = pitchEase(direction, SPEC.sheet.move[0]);
    const table = (range: Range, out: Range, e?: (t: number) => number) =>
      progress.interpolate({ ...sampleEased(range, out, e), extrapolate: 'clamp' });
    return {
      translateY: table(SPEC.sheet.move, SPEC.sheet.y, ease),
      scale: table(SPEC.sheet.move, SPEC.sheet.scale, ease),
      opacity: table(SPEC.sheet.fade, [0, 1]),
    };
  }, [progress, direction]);

  // Staggers are linear, so they depend only on how many pills there are.
  const pillCount = a.tzDates.length;
  const pills = useMemo(
    () =>
      Array.from({ length: pillCount + 1 }, (_, i) =>
        entrance(progress, pillSlice(i), SPEC.pills.y, 1),
      ),
    [progress, pillCount],
  );
  const rows = useMemo(
    () =>
      Array.from({ length: SPEC.grid.sharedFromRow + 1 }, (_, r) =>
        entrance(progress, rowSlice(r), SPEC.grid.y, SPEC.grid.scale),
      ),
    [progress],
  );

  // Frosted glass: blur + tint on iOS, a near-opaque tint on Android.
  const glass =
    Platform.OS === 'ios' ? withAlpha(colors.bg, dark ? 0.45 : 0.35) : withAlpha(colors.bg, 0.94);
  const glassLine = withAlpha(brand.white, dark ? 0.14 : 0.55);
  const shadow = dark ? shadows.sheetDark : shadows.sheet;

  let grid: ReactNode;
  if (a.day.isLoading) {
    grid = (
      <View style={{ paddingStart: PAD, paddingEnd: PAD }}>
        <SkeletonList rows={4} height={40} />
      </View>
    );
  } else if (a.day.isError) {
    grid = (
      <View
        accessibilityRole="alert"
        style={{
          alignItems: 'center',
          gap: space.s,
          paddingStart: PAD,
          paddingEnd: PAD,
          paddingTop: space.sm,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 12.5,
            lineHeight: 18,
            color: colors.mut,
            textAlign: 'center',
          }}
        >
          {t(mapErrorToKey(a.day.error))}
        </Text>
        <Button
          label={t('common.retry')}
          onPress={a.day.refetch}
          busy={a.day.isRefetching}
          variant="cta"
          size="compact"
          style={{ paddingStart: 22, paddingEnd: 22 }}
        />
      </View>
    );
  } else if (a.closedDay) {
    grid = (
      <View
        style={{
          alignItems: 'center',
          paddingStart: PAD + 6,
          paddingEnd: PAD + 6,
          paddingTop: space.l,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.display900,
            fontSize: 15,
            textTransform: 'uppercase',
            color: colors.mut2,
          }}
        >
          {t('booking.closedDayTitle')}
        </Text>
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 12,
            lineHeight: 18,
            color: colors.mut,
            marginTop: 4,
            textAlign: 'center',
          }}
        >
          {t('booking.closedDayBody')}
        </Text>
      </View>
    );
  } else if (a.cells.length === 0) {
    grid = (
      <Text
        style={{
          paddingStart: PAD,
          paddingEnd: PAD,
          paddingTop: space.sm,
          fontFamily: fonts.body400,
          fontSize: 12.5,
          lineHeight: 18,
          color: colors.mut,
          textAlign: 'center',
        }}
      >
        {t('booking.noSlots')}
      </Text>
    );
  } else {
    grid = (
      <ScrollView
        ref={gridRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingStart: PAD, paddingEnd: PAD, paddingBottom: 14 }}
      >
        {a.rows.map((row, r) => {
          const e = rows[Math.min(r, SPEC.grid.sharedFromRow)]!;
          return (
            <Animated.View
              key={row[0]?.startAt.toISOString() ?? r}
              style={{
                flexDirection: 'row',
                gap: 6,
                marginBottom: 6,
                opacity: e.opacity,
                transform: [{ translateY: e.translateY }, { scale: e.scale }],
              }}
            >
              {row.map((cell) => (
                <SlotCell
                  key={cell.startAt.toISOString()}
                  compact
                  cell={cell}
                  time={formatTime(cell.startAt, locale, a.tz)}
                  sub={a.subFor(cell)}
                  capacityLine={a.capacityLineFor(cell)}
                  onPress={() => a.onTapCell(cell)}
                />
              ))}
              {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
            </Animated.View>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setContainer((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      }}
      style={{
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        bottom: bottomInset,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {cardW > 0 ? (
        <Animated.View
          pointerEvents={isOpen ? 'auto' : 'none'}
          onTouchStart={onInteraction}
          style={{
            width: cardW,
            maxHeight: cardMaxH,
            borderRadius: CARD_RADIUS,
            // The shadow stays on THIS view and the clip on the wrapper below:
            // `overflow: 'hidden'` here would clip the card's own 50 px drop
            // shadow away along with the overflow.
            boxShadow: shadow,
            transform: [{ translateY: sheet.translateY }, { scale: sheet.scale }],
          }}
        >
          {/* The clip carries `maxHeight` too. Bounded only by the parent, this
              wrapper's `flexShrink: 1` could still measure taller than the cap,
              and the excess — the grid's last rows — escaped the clip and drew
              past the card's edge over the court. */}
          <View
            style={{
              flexShrink: 1,
              maxHeight: cardMaxH,
              borderRadius: CARD_RADIUS,
              overflow: 'hidden',
            }}
          >
            {Platform.OS === 'ios' ? (
              <BlurView
                intensity={50}
                tint={dark ? 'dark' : 'light'}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Animated.View
              accessibilityViewIsModal={isOpen}
              style={{ flexShrink: 1, opacity: sheet.opacity, paddingTop: 2, paddingBottom: 2 }}
            >
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: glass,
                    borderRadius: CARD_RADIUS,
                    borderWidth: 1,
                    borderColor: glassLine,
                  },
                ]}
              />

              {/* No heading inside the card: the screen title above it turns
                  from BOOK A COURT into PICK A TIME as the sheet opens (owner,
                  2026-09-05), so a second copy of the same words in the card
                  would only repeat it — and screen readers would read it twice.
                  The ~26 pt it used to cost went to the grid. */}

              {/* Day pills (one = one trading night), ~5 visible, the rest scroll.
                  The wrapper is inset by PAD and CLIPS, so a pill scrolling out
                  disappears under that line rather than running on to the card's
                  own edge. The inset moved OFF the content container onto this
                  view: as `contentContainerStyle` padding it scrolled with the
                  pills and so clipped nothing, and keeping it here leaves the
                  first and last pill resting exactly where they did before. */}
              <View style={{ marginStart: PAD, marginEnd: PAD, overflow: 'hidden' }}>
                <ScrollView
                  key={dir}
                  horizontal
                  // RN's ScrollView base style is { flexGrow: 1, flexShrink: 1 },
                  // which on a card capped to a short stage makes the strip give
                  // up height alongside the grid — and the edge fades, pinned to
                  // its box, squash with it. The chips are a fixed-height control
                  // (availability.tsx carries the same override for this reason).
                  style={{ flexGrow: 0, flexShrink: 0 }}
                  showsHorizontalScrollIndicator={false}
                  scrollEventThrottle={32}
                  contentContainerStyle={{
                    gap: 4,
                    // The heading used to open the card; the pills do now, so
                    // they carry its top breathing room instead of 5 pt.
                    paddingTop: 10,
                  }}
                >
                  {a.tzDates.map((d, i) => {
                    const noon = wallTimeToUtc(d, 12 * 60, a.tz);
                    const e = pills[i]!;
                    return (
                      <Animated.View
                        key={d}
                        style={{ opacity: e.opacity, transform: [{ translateY: e.translateY }] }}
                      >
                        <DayChip
                          compact
                          dow={formatWeekdayShort(noon, locale, a.tz)}
                          dayNum={formatDayNumber(noon, locale, a.tz)}
                          selected={d === a.date}
                          closed={a.isClosedDate(d)}
                          closedLabel={t('booking.closedChip')}
                          onPress={() => a.selectDate(d)}
                        />
                      </Animated.View>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Duration picker enters with the last pill */}
              <Animated.View
                style={{
                  marginTop: 5,
                  paddingStart: PAD,
                  paddingEnd: PAD,
                  opacity: pills[pillCount]!.opacity,
                  transform: [{ translateY: pills[pillCount]!.translateY }],
                }}
              >
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
              </Animated.View>


              {/* Time grid: four rows visible, vertical scroll; rows pass under
                  the card's clipped edge. The one block that gives way on a short stage */}
              <View style={{ height: GRID_H, minHeight: 96, flexShrink: 1, marginTop: 6 }}>
                {grid}
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      ) : null}

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
    </View>
  );
}
