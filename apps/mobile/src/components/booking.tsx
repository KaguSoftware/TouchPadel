/**
 * Booking-domain presentational components (design 2026-08-31):
 * status pills, date badges, the review/success/detail summary grid, the
 * pay-at-desk card, degraded banners, day chips and merged slot cells.
 * Stateless — all data arrives as props (spec §06).
 */
import type { ComponentType, ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../i18n/text';
import { formatDayNumber, formatMonthShort, isolate, type MessageKey } from '@touch/i18n';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, shadows, slotStateStyles, space, useTheme, type Palette } from '../theme';
import type { MergedCell } from '../features/availability/assemble';
import { CardIcon, ChevronIcon, CloseIcon, WifiOffIcon, type IconProps } from './icons';
import { Button } from './ui';

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
              // Shrink-wrapped to the leading edge (logical, English unchanged):
              // a value with no strong character outside its isolate — the time
              // range — would otherwise take iOS's default paragraph direction
              // and sit on the trailing edge under RTL.
              style={{
                alignSelf: 'flex-start',
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

// ── Held-slot card (bookings — checkout still in progress) ──────────────────

/**
 * A slot the guest is holding but has not confirmed (0058).
 *
 * Holds were invisible in the app: `splitBookings` dropped them, so a guest who
 * backed out of Review could not see that three slots and three of their hold
 * allowances were still spent in their name — the fourth tap just failed with
 * HOLD_QUOTA_EXCEEDED. This card is where a hold is visible and answerable:
 * finish it, or hand it straight back.
 *
 * The countdown is the guest's own deadline, so it is the loudest thing here,
 * and it turns red in the last quarter — the same signal the Review card uses.
 */
export function HeldSlotCard({
  courtName,
  when,
  price,
  countdown,
  urgent,
  busy,
  onResume,
  onRelease,
}: {
  courtName: string;
  when: string;
  price: string | null;
  countdown: string;
  urgent: boolean;
  busy: boolean;
  onResume: () => void;
  onRelease: () => void;
}) {
  const { colors, fonts, tracking } = useTheme();
  const { t } = useLocale();
  return (
    <View
      style={{
        marginTop: 9,
        backgroundColor: colors.card,
        borderWidth: 1.5,
        borderColor: urgent ? colors.redline : colors.gline,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: space.sm,
        paddingBottom: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            // pickLocale falls back to the English name; a Latin-only name in a
            // stretched Text would sit on the trailing edge under RTL on iOS.
            style={{ alignSelf: 'flex-start', fontFamily: fonts.display800, fontSize: 14, color: colors.ink }}
          >
            {courtName}
          </Text>
          <Text
            numberOfLines={2}
            style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut, marginTop: 2 }}
          >
            {when}
            {price ? ` · ${price}` : ''}
          </Text>
        </View>
        {/* The deadline, in tabular figures so the digits do not jitter. */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: 9.5,
              letterSpacing: tracking(0.6),
              textTransform: 'uppercase',
              color: colors.mut2,
            }}
          >
            {t('booking.holdEndsIn')}
          </Text>
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 17,
              color: urgent ? colors.redtext : colors.gtext,
              fontVariant: ['tabular-nums'],
            }}
          >
            {countdown}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
        <Button
          label={t('booking.finishBooking')}
          onPress={onResume}
          variant="cta"
          size="compact"
          disabled={busy}
          style={{ flex: 1 }}
        />
        <Button
          label={t('booking.releaseHold')}
          onPress={onRelease}
          variant="secondary"
          size="compact"
          busy={busy}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

// ── Degraded banner (courts / availability / bookings) ──────────────────────

/**
 * Amber venue notice. `lead` renders bold ("Venue connection lost."), and the
 * venue phone is bolded inside `message` when present — the design's whole
 * hierarchy for this banner, which a single flat string had lost.
 *
 * With `onDismiss` the notice grows a close (×) button. Nothing else retires
 * it: the venue notice is the guest's only cue that booking has gone
 * desk-only, so it must outlive a scroll, a re-render, or a data refresh, and
 * leave only when the guest says so. See DegradedToast for the floating form.
 */
export function DegradedBanner({
  lead,
  message,
  phone,
  tight = false,
  onDismiss,
}: {
  lead?: string;
  message: string;
  phone?: string | null;
  /** Availability / bookings variant: 9×12 padding, 16 pt icon, top-aligned. */
  tight?: boolean;
  /** When given, renders the close button; the notice never self-dismisses. */
  onDismiss?: () => void;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useLocale();
  const bold = { fontFamily: fonts.body800 };
  const parts: ReactNode[] = [];
  if (phone && message.includes(phone)) {
    // Latin digits inside an Arabic sentence: isolated, or the bidi algorithm
    // reorders the phone's space-separated groups against the RTL paragraph.
    // A caller may have isolated the placeholder already (courts tab): split
    // on that form so the isolate is not nested.
    const wrapped = isolate(phone);
    const marker = message.includes(wrapped) ? wrapped : phone;
    const [before, ...rest] = message.split(marker);
    parts.push(before, <Text key="phone" style={bold}>{wrapped}</Text>, rest.join(marker));
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
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onDismiss}
          // The glyph is 14 pt; the negative margins let a 44 pt touch target
          // hang outside the padding without stretching the notice itself.
          hitSlop={12}
          style={{ marginTop: tight ? -1 : 0, marginEnd: -2, padding: 2 }}
        >
          <CloseIcon size={14} color={colors.ambstrong} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The venue notice as a toast: the same amber card, floated over the screen
 * instead of pushing its content down, and closed ONLY by its × button — no
 * timer, no tap-through dismissal. `pointerEvents="box-none"` on the wrapper
 * keeps the screen behind it tappable everywhere but the card.
 *
 * Callers own the dismissed flag, so a notice stays gone for that screen's
 * lifetime; a fresh mount shows it again, which is right — the guest should
 * be told once per visit that the venue is offline.
 */
export function DegradedToast({
  lead,
  message,
  phone,
  onDismiss,
  /**
   * Gap below the top of the containing Screen's content box. Yoga offsets an
   * absolute child from the parent's PADDING box, so Screen's safe-area inset
   * is already accounted for whichever `edges` it uses — the default is right
   * for a screen whose content starts at the top. Only a screen with its own
   * in-flow header passes more, to clear it.
   */
  top = space.s,
}: {
  lead?: string;
  message: string;
  phone?: string | null;
  onDismiss: () => void;
  top?: number;
}) {
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top,
        start: space.l,
        end: space.l,
        zIndex: 20,
      }}
    >
      <View style={{ boxShadow: shadows.toast, borderRadius: radius.cell }}>
        <DegradedBanner
          tight
          lead={lead}
          message={message}
          phone={phone}
          onDismiss={onDismiss}
        />
      </View>
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
   * radius 10, 5×4 padding, 9 pt weekday + 14 pt day — six fit in the card.
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
        paddingTop: compact ? 5 : 8,
        paddingBottom: compact ? 5 : 8,
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
        <Text
          numberOfLines={1}
          // flexShrink (not flex:1): the label takes only the width it needs so
          // it sits against the icon, and still truncates when a long label
          // would otherwise push into the chevron.
          style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}
        >
          {label}
        </Text>
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}
