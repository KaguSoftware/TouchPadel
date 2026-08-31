/**
 * Booking-domain presentational components (design 2026-08-31):
 * status pills, date badges, the review/success/detail summary grid, the
 * pay-at-desk card, degraded banners, day chips and merged slot cells.
 * Stateless — all data arrives as props (spec §06).
 */
import type { ComponentType, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { MessageKey } from '@touch/i18n';
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

export function StatusPill({ status }: { status: string }) {
  const { colors, fonts } = useTheme();
  const { t } = useLocale();
  const { fg, bg } = statusColors(status, colors);
  return (
    <View
      style={{
        paddingStart: 9,
        paddingEnd: 9,
        paddingTop: 5,
        paddingBottom: 5,
        borderRadius: radius.pill,
        backgroundColor: bg,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: 10,
          letterSpacing: 0.5,
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
  const { colors, fonts } = useTheme();
  const { locale } = useLocale();
  const mon = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-US', { month: 'short' }).format(date);
  const day = new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en-US').format(date.getDate());
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
          letterSpacing: 0.57,
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
}: {
  rows: SummaryRow[];
  /** Overrides for the navy success screen. */
  iconColor?: string;
  labelColor?: string;
  valueColor?: string;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 11 }}>
      {rows.map((row) => {
        const Icon = row.icon;
        return (
          <View key={row.label} style={{ width: '50%', paddingEnd: space.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon size={12} color={iconColor ?? colors.gstrong} />
              <Text
                style={{
                  fontFamily: fonts.body700,
                  fontSize: 10,
                  letterSpacing: 0.7,
                  textTransform: 'uppercase',
                  color: labelColor ?? colors.fnt,
                }}
              >
                {row.label}
              </Text>
            </View>
            <Text
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

export function PayAtDeskCard({ title, body }: { title?: string; body: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.gtint,
        borderWidth: 1,
        borderColor: colors.gline,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: 13,
        paddingBottom: 13,
      }}
    >
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <CardIcon size={14} color={colors.gtext} />
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 12,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: colors.gtext,
            }}
          >
            {title}
          </Text>
        </View>
      ) : null}
      <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.gtext2 }}>
        {body}
      </Text>
    </View>
  );
}

// ── Degraded banner (courts / availability / bookings) ──────────────────────

export function DegradedBanner({ message }: { message: string }) {
  const { colors, fonts } = useTheme();
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
        paddingTop: 10,
        paddingBottom: 10,
        flexDirection: 'row',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <WifiOffIcon size={17} color={colors.ambstrong} />
      <Text
        style={{ flex: 1, fontFamily: fonts.body600, fontSize: 12, lineHeight: 17, color: colors.ambtext }}
      >
        {message}
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
}: {
  dow: string;
  dayNum: string;
  selected: boolean;
  closed: boolean;
  closedLabel: string;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minWidth: 52,
        alignItems: 'center',
        gap: 1,
        paddingTop: 8,
        paddingBottom: 8,
        paddingStart: 6,
        paddingEnd: 6,
        borderRadius: radius.cell,
        borderWidth: 1.5,
        borderColor: selected ? brand.blue : colors.line,
        backgroundColor: selected ? brand.blue : closed ? colors.sub : colors.card,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.body700,
          fontSize: 10,
          letterSpacing: 0.6,
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
          fontSize: 16,
          color: selected ? brand.white : closed ? colors.fnt2 : colors.ink,
        }}
      >
        {dayNum}
      </Text>
      {closed ? (
        <Text
          style={{
            fontFamily: fonts.body700,
            fontSize: 8.5,
            textTransform: 'uppercase',
            letterSpacing: 0.34,
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

export function SlotCell({
  cell,
  time,
  sub,
  capacityLine,
  onPress,
}: {
  cell: MergedCell;
  /** Locale-formatted start time. */
  time: string;
  /** Price when free; state label otherwise. */
  sub: string;
  /** "2 courts free" / "1 court left" — empty when not free. */
  capacityLine: string;
  onPress?: () => void;
}) {
  const { colors, fonts } = useTheme();
  const visual = slotStateStyles(colors)[cell.state === 'free' ? 'available' : cell.state];
  const tappable = cell.state === 'free' || cell.state === 'blocked' || cell.state === 'horizon';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !tappable }}
      disabled={!tappable}
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: '48%',
        flexGrow: 1,
        alignItems: 'center',
        gap: 2,
        paddingTop: 10,
        paddingBottom: 10,
        paddingStart: 4,
        paddingEnd: 4,
        minHeight: 56,
        borderRadius: radius.cell,
        backgroundColor: visual.bg,
        borderWidth: 1.5,
        borderColor: visual.border,
        borderStyle: visual.borderStyle,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.display800, fontSize: 15, color: visual.text }}>{time}</Text>
      <Text style={{ fontFamily: fonts.body700, fontSize: 10.5, color: visual.subText }}>{sub}</Text>
      {capacityLine ? (
        <Text
          style={{
            fontFamily: fonts.body700,
            fontSize: 9.5,
            letterSpacing: 0.3,
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
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
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
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
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
        <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>{label}</Text>
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}
