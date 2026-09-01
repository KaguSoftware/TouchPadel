/**
 * Booking-domain presentational components (design 2026-08-31):
 * status pills, date badges, the review/success/detail summary grid, the
 * pay-at-desk card, degraded banners, day chips and merged slot cells.
 * Stateless — all data arrives as props (spec §06).
 */
import type { ComponentType, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatDayNumber, formatMonthShort, type MessageKey } from '@touch/i18n';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, slotStateStyles, space, useTheme, type Palette } from '../theme';
import type { MergedCell } from '../features/availability/assemble';
import { CardIcon, ChevronIcon, WifiOffIcon, type IconProps } from './icons';

// ── Status pill (7 statuses, all handled — spec BookingStatusIndicator) ─────

const STATUS_KEY: Record<string, MessageKey> = {
  pending: 'booking.statusPending',
  confirmed: 'booking.statusConfirmed',
  arrived: 'booking.statusArrived',
  completed: 'booking.statusCompleted',
  cancelled: 'booking.statusCancelled',
  no_show: 'booking.statusNoShow',
  expired: 'booking.statusExpired',
};

function statusColors(status: string, c: Palette): { fg: string; bg: string } {
  switch (status) {
    case 'confirmed':
      return { fg: c.gtext, bg: c.gtint };
    case 'arrived':
      return { fg: c.blue, bg: c.tint };
    case 'cancelled':
      return { fg: c.redtext, bg: c.redtint };
    case 'no_show':
      return { fg: c.ambstrong, bg: c.amb };
    default: // pending / completed / expired
      return { fg: c.mut, bg: c.sub };
  }
}

export function StatusPill({ status, size = 'list' }: { status: string; size?: 'list' | 'detail' }) {
  const { colors, fonts, tracking } = useTheme();
  const { t } = useLocale();
  const { fg, bg } = statusColors(status, colors);
  const detail = size === 'detail';
  return (
    <View
      style={{
        paddingStart: detail ? 10 : 9,
        paddingEnd: detail ? 10 : 9,
        paddingTop: detail ? 6 : 5,
        paddingBottom: detail ? 6 : 5,
        borderRadius: radius.pill,
        backgroundColor: bg,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: detail ? 10.5 : 10,
          letterSpacing: tracking(0.5),
          textTransform: 'uppercase',
          color: fg,
        }}
      >
        {t(STATUS_KEY[status] ?? 'booking.statusPending')}
      </Text>
    </View>
  );
}

// ── Date badge (upcoming booking cards) ─────────────────────────────────────

export function DateBadge({ date }: { date: Date }) {
  const { colors, fonts, tracking } = useTheme();
  const { locale } = useLocale();
  // Through the shared formatters: venue timezone + Latin digits, like every
  // other date on the row (this badge used to use the DEVICE zone and, in
  // Arabic, Eastern-Arabic digits).
  const mon = formatMonthShort(date, locale);
  const day = formatDayNumber(date, locale);
  return (
    <View
      style={{
        width: 48,
        alignItems: 'center',
        backgroundColor: colors.tint,
        borderRadius: 10,
        paddingTop: 7,
        paddingBottom: 7,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.body700,
          fontSize: 9.5,
          letterSpacing: tracking(0.57),
          textTransform: 'uppercase',
          color: colors.mut,
        }}
      >
        {mon}
      </Text>
      <Text style={{ fontFamily: fonts.display900, fontSize: 18, color: colors.blue }}>{day}</Text>
    </View>
  );
}

// ── Summary grid (review / success / booking detail) ────────────────────────

export interface SummaryRow {
  icon: ComponentType<IconProps>;
  label: string;
  value: string;
  /** e.g. price rows render green. */
  valueColor?: string;
  /** Prices keep Latin digits/style even in AR (per the brand's menu design). */
  emphasis?: boolean;
}

export function SummaryGrid({
  rows,
  iconColor,
  labelColor,
  valueColor,
  rowGap = 10,
}: {
  rows: SummaryRow[];
  /** Overrides for the navy success screen. */
  iconColor?: string;
  labelColor?: string;
  valueColor?: string;
  /** Design: 10 on Review, 11 on Booking detail. */
  rowGap?: number;
}) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap }}>
      {rows.map((row, i) => {
        const Icon = row.icon;
        return (
          <View key={i} style={{ width: '50%', paddingEnd: space.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {/* Design literal #6FA33A in both palettes (brand.leaf), not the palette green. */}
              <Icon size={12} color={iconColor ?? brand.leaf} />
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: fonts.body700,
                  fontSize: 10,
                  letterSpacing: tracking(0.7),
                  textTransform: 'uppercase',
                  color: labelColor ?? colors.fnt,
                }}
              >
                {row.label}
              </Text>
            </View>
            <Text
              numberOfLines={2}
              style={{
                marginTop: 3,
                fontFamily: row.emphasis ? fonts.body800 : fonts.body700,
                fontSize: 13,
                color: row.valueColor ?? valueColor ?? colors.ink,
              }}
            >
              {row.value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Pay at the desk (review, success, detail — spec: never optional) ────────

export function PayAtDeskCard({
  title,
  lead,
  body,
}: {
  /** Icon + uppercase heading row (Review). */
  title?: string;
  /** Bold inline lead sentence (Booking detail: "Pay at the desk."). */
  lead?: string;
  body: string;
}) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.gtint,
        borderWidth: 1,
        borderColor: colors.gline,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: title ? 13 : 12,
        paddingBottom: title ? 13 : 12,
      }}
    >
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <CardIcon size={14} color={colors.gtext} />
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 12,
              letterSpacing: tracking(0.6),
              textTransform: 'uppercase',
              color: colors.gtext,
            }}
          >
            {title}
          </Text>
        </View>
      ) : null}
      <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.gtext2 }}>
        {lead ? <Text style={{ fontFamily: fonts.body800 }}>{lead} </Text> : null}
        {body}
      </Text>
    </View>
  );
}

// ── Degraded banner (courts / availability / bookings) ──────────────────────

/**
 * Amber venue notice. `lead` renders bold ("Venue connection lost."), and the
 * venue phone is bolded inside `message` when present — the design's whole
 * hierarchy for this banner, which a single flat string had lost.
 */
export function DegradedBanner({
  lead,
  message,
  phone,
  tight = false,
}: {
  lead?: string;
  message: string;
  phone?: string | null;
  /** Availability / bookings variant: 9×12 padding, 16 pt icon, top-aligned. */
  tight?: boolean;
}) {
  const { colors, fonts } = useTheme();
  const bold = { fontFamily: fonts.body800 };
  const parts: ReactNode[] = [];
  if (phone && message.includes(phone)) {
    const [before, ...rest] = message.split(phone);
    parts.push(before, <Text key="phone" style={bold}>{phone}</Text>, rest.join(phone));
  } else {
    parts.push(message);
  }
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: colors.amb,
        borderWidth: 1,
        borderColor: colors.ambline,
        borderRadius: radius.cell,
        paddingStart: space.sm,
        paddingEnd: space.sm,
        paddingTop: tight ? 9 : 10,
        paddingBottom: tight ? 9 : 10,
        flexDirection: 'row',
        gap: tight ? 8 : 10,
        alignItems: tight ? 'flex-start' : 'center',
      }}
    >
      <View style={tight ? { marginTop: 1 } : undefined}>
        <WifiOffIcon size={tight ? 16 : 17} color={colors.ambstrong} />
      </View>
      <Text
        style={{ flex: 1, fontFamily: fonts.body600, fontSize: 12, lineHeight: 17, color: colors.ambtext }}
      >
        {lead ? <Text style={bold}>{lead} </Text> : null}
        {parts}
      </Text>
    </View>
  );
}

// ── Day chip (availability date strip) ──────────────────────────────────────

export function DayChip({
  dow,
  dayNum,
  selected,
  closed,
  closedLabel,
  onPress,
  compact = false,
}: {
  dow: string;
  dayNum: string;
  selected: boolean;
  closed: boolean;
  closedLabel: string;
  onPress: () => void;
  /**
   * The booking sheet's pill (court → booking transition, 2026-09-01): 40 wide,
   * radius 10, 6×4 padding, 9 pt weekday + 14 pt day — six fit in the card.
   */
  compact?: boolean;
}) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minWidth: compact ? 40 : 52,
        alignItems: 'center',
        gap: compact ? 0 : 1,
        paddingTop: compact ? 6 : 8,
        paddingBottom: compact ? 6 : 8,
        paddingStart: compact ? 4 : 6,
        paddingEnd: compact ? 4 : 6,
        borderRadius: compact ? 10 : radius.cell,
        borderWidth: 1.5,
        borderColor: selected ? brand.blue : colors.line,
        backgroundColor: selected ? brand.blue : closed ? colors.sub : colors.card,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.body700,
          fontSize: compact ? 9 : 10,
          letterSpacing: tracking(compact ? 0.45 : 0.6),
          textTransform: 'uppercase',
          opacity: 0.75,
          color: selected ? brand.white : closed ? colors.fnt2 : colors.ink,
        }}
      >
        {dow}
      </Text>
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: compact ? 14 : 16,
          color: selected ? brand.white : closed ? colors.fnt2 : colors.ink,
        }}
      >
        {dayNum}
      </Text>
      {closed ? (
        <Text
          style={{
            fontFamily: fonts.body700,
            fontSize: compact ? 7.5 : 8.5,
            textTransform: 'uppercase',
            letterSpacing: tracking(0.34),
            opacity: 0.7,
            color: selected ? brand.white : colors.fnt2,
          }}
        >
          {closedLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── Merged slot cell (availability grid) ────────────────────────────────────

/**
 * One cell of the two-column grid. The PARENT lays cells out in rows of two
 * (each `flex: 1`); a wrapping row with `flexGrow` stretched an odd last cell
 * to the full width, which the design's `repeat(2, 1fr)` never does.
 */
export function SlotCell({
  cell,
  time,
  sub,
  capacityLine,
  onPress,
  compact = false,
}: {
  cell: MergedCell;
  /** Locale-formatted start time. */
  time: string;
  /** Price when free; state label otherwise. */
  sub: string;
  /** "2 courts free" / "1 court left" — empty when not free. */
  capacityLine: string;
  onPress?: () => void;
  /**
   * The booking sheet's cell (court → booking transition, 2026-09-01): min
   * height 40, radius 10, 7×4 padding, 13 / 9.5 / 8.5 pt — four rows show in
   * the card's 200 pt grid; the sheet presses with a scale, not a dim.
   */
  compact?: boolean;
}) {
  const { colors, fonts, tracking } = useTheme();
  const visual = slotStateStyles(colors)[cell.state === 'free' ? 'available' : cell.state];
  const tappable = cell.state === 'free' || cell.state === 'blocked' || cell.state === 'horizon';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !tappable }}
      disabled={!tappable}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: compact ? 1 : 2,
        paddingTop: compact ? 7 : 10,
        paddingBottom: compact ? 7 : 10,
        paddingStart: 4,
        paddingEnd: 4,
        minHeight: compact ? 40 : 52,
        borderRadius: compact ? 10 : radius.cell,
        backgroundColor: visual.bg,
        borderWidth: 1.5,
        borderColor: visual.border,
        borderStyle: visual.borderStyle,
        opacity: pressed && !compact ? 0.85 : 1,
        transform: [{ scale: pressed && compact ? 0.96 : 1 }],
      })}
    >
      <Text style={{ fontFamily: fonts.display800, fontSize: compact ? 13 : 15, color: visual.text }}>
        {time}
      </Text>
      <Text
        numberOfLines={1}
        style={{ fontFamily: fonts.body700, fontSize: compact ? 9.5 : 10.5, color: visual.subText }}
      >
        {sub}
      </Text>
      {capacityLine ? (
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.body700,
            fontSize: compact ? 8.5 : 9.5,
            letterSpacing: tracking(0.3),
            color: cell.freeCount > 1 ? colors.fnt : colors.ambstrong,
          }}
        >
          {capacityLine}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── List row (profile menu rows) ────────────────────────────────────────────

export function MenuRow({
  icon,
  label,
  onPress,
  last,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  last?: boolean;
  disabled?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingStart: space.l,
        paddingEnd: space.l,
        paddingTop: 15,
        paddingBottom: 15,
        backgroundColor: pressed ? colors.sub : 'transparent',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.sub,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1 }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: colors.gtint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
          {label}
        </Text>
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}
