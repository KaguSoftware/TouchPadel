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
import {
  Animated,
  type LayoutChangeEvent,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Text } from '../i18n/text';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { wallTimeToUtc } from '@touch/core';
import {
  formatDayNumber,
  formatTime,
  formatWeekdayShort,
  isolate,
  type Direction,
} from '@touch/i18n';
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
import { brand, shadows, space, useTheme } from '../theme';
import { Button, ErrorText, SegmentedControl } from './ui';
import { DayChip, SlotCell } from './booking';
import { SkeletonList } from './states';
import { NoticeSheet } from './overlays';

/** Prototype: a 280 px card in a 390 px phone; a touch narrower here, the duration picker still fits. */
const CARD_MAX_W = 268;
const CARD_RADIUS = 22;
/**
 * Four compact rows show (40 + 6 gap each) plus a peek at the fifth, the rest
 * scroll. The "assigned at the desk" footer used to sit under this and now
 * does not: the grid took its ~42 pt, so the card is the same height with more
 * of the night on screen. That line still runs under the standalone
 * Availability screen's grid, which has the room for it.
 */
const GRID_H = 192;
const PAD = 10;
/** The card's hairline. Edge fades stop just inside it so the border stays crisp. */
const CARD_BORDER = 1;
const FADES = { pillsStart: 10, pillsEnd: 14, gridStart: 12, gridEnd: 24 } as const;

/**
 * How the fade's ink falls off across its strip. A straight ramp is still half
 * opaque at the halfway point, so the band reads as bleeding inward over the
 * pills rather than as content dissolving at the edge; squaring it keeps almost
 * all the ink in the outer third and lets the strip stay a clean hard edge.
 */
const FADE_STOPS = [0, 0.25, 0.5, 0.75, 1] as const;

/** The stops' colours, squared falloff from `alpha` at the edge to nothing. */
const fadeInk = (color: string, alpha: number) => {
  const ink = (t: number) => withAlpha(color, alpha * (1 - t) ** 2);
  const [s0, s1, s2, s3, s4] = FADE_STOPS;
  return [ink(s0), ink(s1), ink(s2), ink(s3), ink(s4)] as const;
};

/** `#RRGGBB` + alpha → `#RRGGBBAA` (RN accepts 8-digit hex; the tab bar tint is one). */
const withAlpha = (hex: string, alpha: number): string =>
  hex.slice(0, 7) +
  Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

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

/**
 * The prototype's CSS mask-image edge fades, as gradient overlays in the card's
 * tint. `visible` = the leading fade, shown only once the list has scrolled.
 */
function EdgeFade({
  axis,
  edge,
  size,
  color,
  alpha,
  rtl,
  visible = true,
  inset = 0,
}: {
  axis: 'x' | 'y';
  edge: 'start' | 'end';
  size: number;
  /** Opaque `#RRGGBB`; the stops carry their own alpha. */
  color: string;
  /** Peak opacity, reached only at the very edge. */
  alpha: number;
  rtl: boolean;
  visible?: boolean;
  /** Pull the fade off the card's edge by this much — the border's width. */
  inset?: number;
}) {
  if (!visible) return null;
  const solidFirst = edge === 'start';
  // Along x the logical start is the physical right under RTL.
  const towardsEnd = axis === 'x' ? !rtl : true;
  const from = solidFirst === towardsEnd ? { x: 0, y: 0 } : { x: 1, y: 1 };
  const to = solidFirst === towardsEnd ? { x: 1, y: 1 } : { x: 0, y: 0 };
  const along = axis === 'x' ? { start: from.x, end: to.x } : { start: from.y, end: to.y };
  return (
    <LinearGradient
      pointerEvents="none"
      colors={fadeInk(color, alpha)}
      locations={FADE_STOPS}
      start={axis === 'x' ? { x: along.start, y: 0 } : { x: 0, y: along.start }}
      end={axis === 'x' ? { x: along.end, y: 0 } : { x: 0, y: along.end }}
      style={[
        { position: 'absolute' },
        axis === 'x'
          ? { top: 0, bottom: 0, width: size, [edge]: inset }
          : { start: inset, end: inset, height: size, [edge === 'start' ? 'top' : 'bottom']: 0 },
      ]}
    />
  );
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
  const rtl = dir === 'rtl';
  const dark = appearance === 'dark';
  const a = useAvailabilityBooking({ origin: 'sheet' });
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const cardW = Math.min(CARD_MAX_W, Math.max(0, container.width - 40));
  const cardMaxH = Math.max(0, container.height - 24);
  useEffect(() => {
    onBusyChange?.(a.holdPending);
  }, [a.holdPending, onBusyChange]);
  // The direction the pill strip was scrolled off its leading edge in. A
  // language switch remounts the strip (key={dir} below) so both platforms
  // re-home it at the new leading edge — neither emits a scroll event on a
  // direction change — and the flag must not outlive that strip.
  const [pillsScrolledIn, setPillsScrolledIn] = useState<Direction | null>(null);
  const pillsAtStart = pillsScrolledIn !== dir;
  const [gridAtTop, setGridAtTop] = useState(true);

  // The grid opens on the first time that has not started yet (a.openRow), so a
  // 21:00 guest does not scroll 09:00 → 21:00 to reach tonight. Rows are not a
  // fixed height (a capacity line makes one taller), so the target row reports
  // its own y through onLayout rather than the offset being multiplied out.
  // `key` remounts the list per day/duration — a fresh ScrollView starts at 0
  // and always lays its rows out, so the homing runs exactly once per list and
  // never fights a scroll the guest is in the middle of.
  const gridRef = useRef<ScrollView>(null);
  const gridKey = `${a.date}|${a.durationMin}`;
  const homedFor = useRef<string | null>(null);
  const homeGrid = (r: number) => (e: LayoutChangeEvent) => {
    if (r !== a.openRow || homedFor.current === gridKey) return;
    homedFor.current = gridKey;
    const { y } = e.nativeEvent.layout;
    if (y > 0) gridRef.current?.scrollTo({ y, animated: false });
    // A programmatic scroll does not reliably emit onScroll on Android, and the
    // flag outlives the remount either way — say where the list landed.
    setGridAtTop(y <= 0);
  };

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
  const fadeAlpha = Platform.OS === 'ios' ? (dark ? 0.9 : 0.85) : 0.97;
  const glassLine = withAlpha(brand.white, dark ? 0.14 : 0.55);
  const shadow = dark ? shadows.sheetDark : shadows.sheet;

  const onPillsScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    // BOTH platforms report a PHYSICAL contentOffset.x under RTL, measured from
    // the content's left edge: Android emits HorizontalScrollView.scrollX as is,
    // and iOS Fabric mirrors its UIScrollView but converts the offset back
    // (RCTScrollViewComponentView _scrollViewMetrics). So the logical start
    // reads as the maximum on both; undo that here.
    // Clamped at 0: when the content is NARROWER than the strip there is
    // nothing to scroll, `contentOffset.x` stays 0 and the undo goes negative
    // by the slack — which reads as "scrolled" and would paint the leading
    // fade permanently, in Arabic only. Seven or eight day pills always
    // overflow the card today, so this is a guard, not a live bug.
    const x = rtl
      ? Math.max(0, contentSize.width - layoutMeasurement.width - contentOffset.x)
      : contentOffset.x;
    setPillsScrolledIn(Math.abs(x) < 2 ? null : dir);
  };
  const onGridScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setGridAtTop(e.nativeEvent.contentOffset.y < 2);

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
        key={gridKey}
        ref={gridRef}
        showsVerticalScrollIndicator={false}
        onScroll={onGridScroll}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingStart: PAD, paddingEnd: PAD, paddingBottom: 14 }}
      >
        {a.rows.map((row, r) => {
          const e = rows[Math.min(r, SPEC.grid.sharedFromRow)]!;
          return (
            <Animated.View
              key={row[0]?.startAt.toISOString() ?? r}
              onLayout={homeGrid(r)}
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
            boxShadow: shadow,
            transform: [{ translateY: sheet.translateY }, { scale: sheet.scale }],
          }}
        >
          <View style={{ flexShrink: 1, borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
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

              <Text
                accessibilityRole="header"
                style={{
                  paddingStart: 12,
                  paddingEnd: 12,
                  paddingTop: 10,
                  paddingBottom: 0,
                  fontFamily: fonts.display900,
                  fontSize: 15,
                  lineHeight: 16,
                  textTransform: 'uppercase',
                  color: colors.ink,
                }}
              >
                {t('booking.pickTime')}
              </Text>

              {/* Day pills (one = one trading night), ~6 visible, the rest scroll */}
              <View>
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
                  onScroll={onPillsScroll}
                  scrollEventThrottle={32}
                  contentContainerStyle={{
                    gap: 4,
                    paddingStart: PAD,
                    paddingEnd: PAD,
                    paddingTop: 5,
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
                <EdgeFade
                  axis="x"
                  edge="start"
                  size={FADES.pillsStart}
                  color={colors.bg}
                  alpha={fadeAlpha}
                  rtl={rtl}
                  inset={CARD_BORDER}
                  visible={!pillsAtStart}
                />
                <EdgeFade
                  axis="x"
                  edge="end"
                  size={FADES.pillsEnd}
                  color={colors.bg}
                  alpha={fadeAlpha}
                  rtl={rtl}
                  inset={CARD_BORDER}
                />
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

              <View style={{ paddingStart: PAD, paddingEnd: PAD }}>
                <ErrorText>{a.error}</ErrorText>
              </View>

              {/* Time grid: four rows visible, vertical scroll with edge fades; the one block that gives way on a short stage */}
              <View style={{ height: GRID_H, minHeight: 96, flexShrink: 1, marginTop: 6 }}>
                {grid}
                <EdgeFade
                  axis="y"
                  edge="start"
                  size={FADES.gridStart}
                  color={colors.bg}
                  alpha={fadeAlpha}
                  rtl={rtl}
                  inset={CARD_BORDER}
                  visible={!gridAtTop}
                />
                <EdgeFade
                  axis="y"
                  edge="end"
                  size={FADES.gridEnd}
                  color={colors.bg}
                  alpha={fadeAlpha}
                  rtl={rtl}
                  inset={CARD_BORDER}
                />
              </View>

            </Animated.View>
          </View>
        </Animated.View>
      ) : null}

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
    </View>
  );
}
