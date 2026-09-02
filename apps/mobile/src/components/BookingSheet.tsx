/**
 * The booking view of the court → booking transition (design 2026-09-01,
 * `docs/design/mobile-ui/Court Transition Prototype.html`): a frosted card
 * that floats mid-screen over the pitched, dimmed court and carries the REAL
 * availability flow (useAvailabilityBooking — the same hook as the standalone
 * Availability screen): trading-night day pills, the duration picker, the
 * merged two-column time grid, the "assigned at the desk" footer, the desk-only
 * / blocked notice sheet, the hold errors.
 *
 * Every entrance derives from the shared progress value p:
 *   sheet    0.25 → 1.00  translateY 360 → 0, scale 0.92 → 1     PITCH ease (direction-aware)
 *            0.25 → 0.45  opacity 0 → 1                          linear
 *   pill i   0.45 + i·0.035, length 0.22   opacity + rise 14 px   linear
 *   row r    0.58 + r·0.06, length 0.28    opacity + rise 18 px + scale 0.96 → 1 (rows ≥ 3 share row 3)
 *   scroll edges: 14 / 22 px fades on the pills, 12 / 28 px on the grid; the
 *   leading fade only once scrolled.
 * Frosted: iOS blurs the court behind (expo-blur) under a 35 % tint; Android
 * draws the tint flat at 94 % — the tab bar's own convention. The blur view
 * itself never sits under an animated opacity (a UIVisualEffectView beneath
 * an alpha < 1 ancestor does not render its blur until alpha hits 1, which
 * would pop it in at p = 0.45): the card's transform lives on the outer view
 * and only the tint, border and content fade in inside it.
 *
 * On a short phone the card caps itself to the stage and the grid shrinks
 * (min 120 pt) instead of the card overflowing under the title or tab bar.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
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
import { brand, shadows, space, useTheme } from '../theme';
import { Button, ErrorText, SegmentedControl } from './ui';
import { DayChip, SlotCell } from './booking';
import { SkeletonList } from './states';
import { NoticeSheet } from './overlays';

/** Prototype: a 280 px card in a 390 px phone; a little wider here for the duration picker. */
const CARD_MAX_W = 296;
const CARD_RADIUS = 24;
/** Four compact rows show (40 + 6 gap each), the rest scroll. */
const GRID_H = 200;
const PAD = 10;
const FADES = { pillsStart: 14, pillsEnd: 22, gridStart: 12, gridEnd: 28 } as const;

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
  rtl,
  visible = true,
}: {
  axis: 'x' | 'y';
  edge: 'start' | 'end';
  size: number;
  color: string;
  rtl: boolean;
  visible?: boolean;
}) {
  if (!visible) return null;
  const clear = withAlpha(color, 0);
  const solidFirst = edge === 'start';
  // Along x the logical start is the physical right under RTL.
  const towardsEnd = axis === 'x' ? !rtl : true;
  const from = solidFirst === towardsEnd ? { x: 0, y: 0 } : { x: 1, y: 1 };
  const to = solidFirst === towardsEnd ? { x: 1, y: 1 } : { x: 0, y: 0 };
  const along = axis === 'x' ? { start: from.x, end: to.x } : { start: from.y, end: to.y };
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[color, clear]}
      start={axis === 'x' ? { x: along.start, y: 0 } : { x: 0, y: along.start }}
      end={axis === 'x' ? { x: along.end, y: 0 } : { x: 0, y: along.end }}
      style={[
        { position: 'absolute' },
        axis === 'x'
          ? { top: 0, bottom: 0, width: size, [edge]: 0 }
          : { start: 0, end: 0, height: size, [edge === 'start' ? 'top' : 'bottom']: 0 },
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
}

export function BookingSheet({
  progress,
  direction,
  bottomInset,
  isOpen,
  onBusyChange,
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
  const [pillsAtStart, setPillsAtStart] = useState(true);
  const [gridAtTop, setGridAtTop] = useState(true);

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
  const fade =
    Platform.OS === 'ios' ? withAlpha(colors.bg, dark ? 0.9 : 0.85) : withAlpha(colors.bg, 0.97);
  const glassLine = withAlpha(brand.white, dark ? 0.14 : 0.55);
  const shadow = dark ? shadows.sheetDark : shadows.sheet;

  const onPillsScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    // iOS reports a logical offset under RTL; Android reports the physical
    // scrollX (offsets from the right edge), so the logical start reads as the
    // maximum there.
    const x =
      rtl && Platform.OS === 'android'
        ? contentSize.width - layoutMeasurement.width - contentOffset.x
        : contentOffset.x;
    setPillsAtStart(Math.abs(x) < 2);
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
              style={{ flexShrink: 1, opacity: sheet.opacity, paddingTop: 2, paddingBottom: 4 }}
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
                  paddingStart: 14,
                  paddingEnd: 14,
                  paddingTop: 14,
                  paddingBottom: 2,
                  fontFamily: fonts.display900,
                  fontSize: 17,
                  lineHeight: 18,
                  textTransform: 'uppercase',
                  color: colors.ink,
                }}
              >
                {t('booking.pickTime')}
              </Text>

              {/* Day pills (one = one trading night), ~6 visible, the rest scroll */}
              <View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  onScroll={onPillsScroll}
                  scrollEventThrottle={32}
                  contentContainerStyle={{
                    gap: 4,
                    paddingStart: PAD,
                    paddingEnd: PAD,
                    paddingTop: 6,
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
                  color={fade}
                  rtl={rtl}
                  visible={!pillsAtStart}
                />
                <EdgeFade axis="x" edge="end" size={FADES.pillsEnd} color={fade} rtl={rtl} />
              </View>

              {/* Duration picker enters with the last pill */}
              <Animated.View
                style={{
                  marginTop: 8,
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
              <View style={{ height: GRID_H, minHeight: 120, flexShrink: 1, marginTop: 10 }}>
                {grid}
                <EdgeFade
                  axis="y"
                  edge="start"
                  size={FADES.gridStart}
                  color={fade}
                  rtl={rtl}
                  visible={!gridAtTop}
                />
                <EdgeFade axis="y" edge="end" size={FADES.gridEnd} color={fade} rtl={rtl} />
              </View>

              <Text
                style={{
                  paddingStart: 14,
                  paddingEnd: 14,
                  paddingTop: 10,
                  paddingBottom: 12,
                  fontFamily: fonts.body400,
                  fontSize: 10,
                  lineHeight: 15,
                  color: colors.fnt,
                  textAlign: 'center',
                }}
              >
                {t('booking.availFooter', { count: a.courtCount })}
              </Text>
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
        callLabel={a.phone ? t('booking.callPhone', { phone: a.phone }) : null}
        onCall={a.onCall}
        onClose={a.dismissNotice}
      />
    </View>
  );
}
