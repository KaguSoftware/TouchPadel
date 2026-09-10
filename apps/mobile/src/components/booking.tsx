/**
 * Booking-domain presentational components (design 2026-08-31):
 * status pills, date badges, the review/success/detail summary grid, the
 * pay-at-desk card, degraded banners, day chips and merged slot cells.
 * Stateless — all data arrives as props (spec §06).
 */
import { memo, type ComponentType, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '../i18n/text';
import { formatDayNumber, formatMonthShort, isolate, type MessageKey } from '@touch/i18n';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, palettes, radius, shadows, slotStateStyles, space, useTheme, type Palette } from '../theme';
import type { MergedCell } from '../features/availability/assemble';
import {
  CalendarIcon,
  CardIcon,
  ChevronIcon,
  ClockIcon,
  CloseIcon,
  PadelBallIcon,
  TagIcon,
  WifiOffIcon,
  type IconProps,
} from './icons';
import { BrandPattern } from './BrandPattern';
import { Button, SectionLabel } from './ui';

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

// ── My bookings: hero, headings, rows ───────────────────────────────────────

/**
 * One icon + label pair from a booking's metadata ("🕐 7:30 PM–9:00 PM").
 *
 * The list used to run weekday, date, time and price together as a single
 * middot-separated string, which reads as one flat grey sentence — nothing in
 * it can be found without reading all of it. Split into labelled pairs, the eye
 * lands on the time without passing through the price, and the glyph carries
 * the meaning at a glance in either language.
 */
function MetaItem({
  icon: Icon,
  text,
  color,
  iconColor,
  bold = false,
  size = 12,
}: {
  icon: ComponentType<IconProps>;
  text: string;
  color: string;
  /** Defaults to the text colour; the hero tints its glyphs brand green. */
  iconColor?: string;
  /** Prices are the one metadata item the design weights up. */
  bold?: boolean;
  size?: number;
}) {
  const { fonts } = useTheme();
  return (
    // No alignSelf here: this is a ROW, so the cross axis is vertical and a
    // `flex-start` would top-align the label against its glyph. The Text hugs
    // its content anyway, which is what the leading-edge trick buys elsewhere.
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Icon size={size + 1} color={iconColor ?? color} strokeWidth={2} />
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          fontFamily: bold ? fonts.body800 : fonts.body600,
          fontSize: size,
          color,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * The next game, lifted out of the list (owner, 2026-09-05: My bookings "reads
 * like just a list").
 *
 * It stands on the brand's navy — the same ground as Review and the success
 * screen — under the brand line pattern at a whisper, so the top of the tab is
 * a POSTER for the next match instead of row one of a table. The list below
 * starts at the SECOND upcoming booking: nothing is shown twice.
 *
 * The pattern is painted on the card's own ground rather than borrowed from the
 * page behind it. Two copies of a `slice`-cropped drawing over one background
 * can never agree — each crops to its own box — and the seam is the loudest
 * thing on screen. An opaque card carrying its own copy has no seam to keep.
 *
 * IN BLUE MODE IT INVERTS TO THE BRAND GREEN (owner, 2026-09-05). The navy that
 * makes this card a poster on a pale page is DARKER than the page in dark mode
 * — #172C4F under a #1C355E ground — so the hero sank into the tab instead of
 * standing off it, and the one card meant to be seen first was the quietest
 * thing on screen. On green it is the brightest thing in the tab by a mile, and
 * it is the same green the Book tab's on-net CTA is cut from, so the two loudest
 * surfaces in the app now agree.
 *
 * The pattern lives HERE and only here (owner, 2026-09-05: "the pattern bg on
 * the card but not on the entire page"). It ran full-bleed behind the whole tab
 * for a moment; on the card it does the same work in the one place the eye is
 * already going, and the list below is left alone to be a list. Its ink is the
 * one thing that has to change with the ground — see BrandPattern's header for
 * why green-on-navy and white-on-green, and why neither alpha is free.
 */
export function NextUpCard({
  label,
  courtName,
  status,
  when,
  timeRange,
  price,
  proximity,
  imminent,
  ctaLabel,
  onPress,
}: {
  /** "Next up". */
  label: string;
  courtName: string;
  /** The row's status; only a non-confirmed one is named (see the eyebrow). */
  status: string;
  /** Weekday + date, already formatted. */
  when: string;
  timeRange: string;
  /** Formatted price, or the duration when the row carries none. */
  price: string;
  /** "In 2 days" / "On now". */
  proximity: string;
  /** On court now, or minutes away: the chip goes solid green. */
  imminent: boolean;
  ctaLabel: string;
  onPress: () => void;
}) {
  const { appearance, fonts, tracking } = useTheme();
  const { t, dir } = useLocale();
  /**
   * The card's own two-sided palette — the ONE thing that flips with the theme
   * here, since everything else on it is theme-invariant brand.
   *
   * The green side's darks are NOT invented and not the dark palette's greens
   * either — blue mode's green ramp is built to sit ON a blue ground and runs
   * pale (`gstrong` is #BCDC93), which is invisible here. They come off
   * `palettes.light`, the ramp already measured against a light ground:
   * `greenInk` for everything that must carry (11.85:1, the brand's own
   * on-green ink), `gtext2` #3D541F for the metadata at 4.77:1, and `gph`
   * #657F45 for the rule. `gtext` #426318 is deliberately NOT used — it looks
   * like the obvious choice and measures 3.91:1, under AA.
   *
   * The chip keeps its meaning on both sides: resting recedes, imminent is the
   * loudest pill on the card. Which colour does that simply swaps — solid green
   * on navy, solid navy on green.
   */
  const ink =
    appearance === 'dark'
      ? {
          ground: brand.green,
          pattern: 0.4,
          patternInk: brand.white,
          eyebrow: brand.greenInk,
          title: brand.greenInk,
          meta: palettes.light.gtext2,
          glyph: palettes.light.gtext2,
          line: palettes.light.gph,
          price: brand.greenInk,
          chipBg: 'transparent',
          chipLine: palettes.light.gph,
          chipInk: palettes.light.gtext2,
          hotBg: brand.navy,
          hotInk: brand.green,
          cta: palettes.light.gtext2,
          // A navy disc whose arcs are the ground showing through.
          ballFill: brand.navy,
          ballStroke: brand.green,
        }
      : {
          ground: brand.navy,
          // 0.2 is the ceiling, not a preference: green lines take the navy to
          // #334D55 under them, and `navyText` on THAT is 4.78:1.
          pattern: 0.2,
          patternInk: brand.green,
          eyebrow: brand.green,
          title: brand.white,
          meta: brand.navyText,
          glyph: brand.green,
          line: brand.navyLine,
          price: brand.green,
          chipBg: brand.navyCard,
          chipLine: brand.navyLine,
          chipInk: brand.navyText,
          hotBg: brand.green,
          hotInk: brand.greenInk,
          cta: brand.navyText,
          ballFill: brand.green,
          ballStroke: brand.navy,
        };
  // Arabic has no letter case (`tracking` already zeroes itself in AR).
  const caps = dir === 'rtl' ? ('none' as const) : ('uppercase' as const);
  // The hero carries no StatusPill — the pill's tints are built for a card in
  // the page palette, and neither of this card's grounds is one, so all seven
  // of them would have to be re-derived twice over. 'confirmed' needs no saying
  // anyway; the two that DO ('pending', 'arrived') are named in the eyebrow,
  // which costs no room and cannot be missed above the court name.
  const eyebrow =
    status === 'confirmed' ? label : `${label} · ${t(STATUS_KEY[status] ?? 'booking.statusPending')}`;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 10,
        borderRadius: radius.card,
        backgroundColor: ink.ground,
        // Clips the pattern to the corners — without it the SVG paints square
        // shoulders over the card's radius.
        overflow: 'hidden',
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <BrandPattern opacity={ink.pattern} color={ink.patternInk} />
      <View style={{ padding: space.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <PadelBallIcon size={15} fill={ink.ballFill} stroke={ink.ballStroke} strokeWidth={3.5} />
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 10,
              letterSpacing: tracking(1.1),
              textTransform: caps,
              color: ink.eyebrow,
            }}
          >
            {eyebrow}
          </Text>
          <View style={{ flex: 1 }} />
          <View
            style={{
              paddingStart: 9,
              paddingEnd: 9,
              paddingTop: 5,
              paddingBottom: 5,
              borderRadius: radius.pill,
              backgroundColor: imminent ? ink.hotBg : ink.chipBg,
              borderWidth: 1,
              borderColor: imminent ? ink.hotBg : ink.chipLine,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.display800,
                fontSize: 10,
                letterSpacing: tracking(0.5),
                textTransform: caps,
                color: imminent ? ink.hotInk : ink.chipInk,
              }}
            >
              {proximity}
            </Text>
          </View>
        </View>
        <Text
          numberOfLines={1}
          // Shrink-wrapped to the leading edge (this one IS in a column):
          // pickLocale can hand back the Latin court name, which iOS aligns from
          // its own first strong character rather than from the layout direction.
          style={{
            alignSelf: 'flex-start',
            marginTop: 11,
            fontFamily: fonts.display900,
            fontSize: 21,
            color: ink.title,
          }}
        >
          {courtName}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            columnGap: 14,
            rowGap: 4,
            marginTop: 5,
          }}
        >
          <MetaItem icon={CalendarIcon} text={when} color={ink.meta} iconColor={ink.glyph} size={12.5} />
          <MetaItem icon={ClockIcon} text={timeRange} color={ink.meta} iconColor={ink.glyph} size={12.5} />
        </View>
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            backgroundColor: ink.line,
            marginTop: space.sm,
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <MetaItem icon={TagIcon} text={price} color={ink.price} bold size={13} />
          <View style={{ flex: 1 }} />
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 10.5,
              letterSpacing: tracking(0.7),
              textTransform: caps,
              color: ink.cta,
            }}
          >
            {ctaLabel}
          </Text>
          <ChevronIcon size={13} color={ink.glyph} strokeWidth={2.6} />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * A section heading that carries its own icon, a rule out to the margin and a
 * count: `🗓 UPCOMING ───────── 3`.
 *
 * Three identical grey labels down a page read as one undifferentiated list;
 * the rule gives each section a top edge and the count says how much is under
 * it without the guest scrolling to find out.
 */
export function ListHeading({
  icon: Icon,
  label,
  count,
  style,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  /** Omitted or 0 renders no number (an empty section says so in its body). */
  count?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>
      <Icon size={13} color={colors.fnt} strokeWidth={2.2} />
      <SectionLabel>{label}</SectionLabel>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />
      {count ? (
        <Text
          style={{
            fontFamily: fonts.display800,
            fontSize: 10.5,
            letterSpacing: tracking(0.4),
            color: colors.fnt,
            fontVariant: ['tabular-nums'],
          }}
        >
          {count}
        </Text>
      ) : null}
    </View>
  );
}

/** A counted fact under the page title ("3 upcoming", "12 played"). */
export function StatChip({
  icon: Icon,
  label,
  accent = false,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  /** The upcoming chip, which is the live one, takes the blue tint. */
  accent?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingStart: 9,
        paddingEnd: 10,
        paddingTop: 5,
        paddingBottom: 5,
        borderRadius: radius.pill,
        backgroundColor: accent ? colors.tint : colors.sub,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Icon size={12} color={accent ? colors.blue : colors.fnt} strokeWidth={2.2} />
      <Text style={{ fontFamily: fonts.body700, fontSize: 11, color: accent ? colors.mut2 : colors.mut }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * An upcoming booking below the hero: date badge, court, metadata pairs, and a
 * status/price stack on the trailing edge.
 */
export function UpcomingBookingRow({
  date,
  courtName,
  weekday,
  timeRange,
  price,
  status,
  onPress,
}: {
  date: Date;
  courtName: string;
  weekday: string;
  timeRange: string;
  price: string | null;
  status: string;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        boxShadow: shadows.thumb,
        paddingStart: space.sm,
        paddingEnd: space.sm,
        paddingTop: space.sm,
        paddingBottom: space.sm,
        flexDirection: 'row',
        gap: space.sm,
        alignItems: 'center',
        marginTop: 9,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <DateBadge date={date} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          // Shrink-wrapped to the leading edge, like the hero's court name.
          style={{ alignSelf: 'flex-start', fontFamily: fonts.display800, fontSize: 14, color: colors.ink }}
        >
          {courtName}
        </Text>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 11, rowGap: 2, marginTop: 3 }}
        >
          <MetaItem icon={CalendarIcon} text={weekday} color={colors.mut} size={11.5} />
          <MetaItem icon={ClockIcon} text={timeRange} color={colors.mut} size={11.5} />
        </View>
      </View>
      {/* Column, so `flex-end` is the cross axis — Yoga resolves it against the
          layout direction, i.e. the trailing edge in both languages. */}
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <StatusPill status={status} />
        {price ? (
          <Text style={{ fontFamily: fonts.body800, fontSize: 11.5, color: colors.gstrong }}>
            {price}
          </Text>
        ) : null}
      </View>
      <ChevronIcon size={14} color={colors.fnt3} strokeWidth={2.2} />
    </Pressable>
  );
}

/**
 * A past booking, hung off a timeline rail.
 *
 * Past was the flattest part of the screen — the same card as Upcoming, dimmed.
 * The rail turns it into one continuous thread with a node per game, and the
 * node's colour says at a glance which of them were actually played: green for
 * turned up, red for cancelled or no-show, grey for anything else. The card's
 * own bottom margin sits INSIDE this row's height, so the rail stretches
 * through the gap and the thread never breaks between rows.
 */
export function PastBookingRow({
  courtName,
  when,
  price,
  status,
  first,
  last,
  onPress,
}: {
  courtName: string;
  when: string;
  price: string | null;
  status: string;
  first: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const node =
    status === 'cancelled' || status === 'no_show'
      ? colors.redline
      : status === 'completed' || status === 'arrived'
        ? colors.gline
        : colors.fnt3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
      <View style={{ width: 22, alignItems: 'center' }}>
        <View
          style={{ width: 1.5, height: 17, backgroundColor: first ? 'transparent' : colors.line }}
        />
        <View style={{ width: 9, height: 9, borderRadius: radius.pill, backgroundColor: node }} />
        <View
          style={{ flex: 1, width: 1.5, backgroundColor: last ? 'transparent' : colors.line }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          marginBottom: 9,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.cell,
          paddingStart: space.sm,
          paddingEnd: space.sm,
          paddingTop: 10,
          paddingBottom: 10,
          flexDirection: 'row',
          gap: space.s,
          alignItems: 'center',
          opacity: pressed ? 0.7 : 0.88,
        })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ alignSelf: 'flex-start', fontFamily: fonts.display800, fontSize: 13, color: colors.mut2 }}
          >
            {courtName}
          </Text>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2, marginTop: 2 }}
          >
            <MetaItem icon={ClockIcon} text={when} color={colors.fnt} size={11} />
            {price ? <MetaItem icon={TagIcon} text={price} color={colors.fnt} size={11} /> : null}
          </View>
        </View>
        <StatusPill status={status} />
      </Pressable>
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
 * leave only when the guest says so.
 */
export function DegradedBanner({
  lead,
  message,
  phone,
  tight = false,
  blockLead = false,
  onDismiss,
}: {
  lead?: string;
  message: string;
  phone?: string | null;
  /** Availability / bookings variant: 9×12 padding, 16 pt icon, top-aligned. */
  tight?: boolean;
  /**
   * Break after the bold lead so it keeps a line of its own and the message
   * starts the next. Without it the two run together and a narrow banner wraps
   * the sentence mid-phrase, which reads as one ragged paragraph.
   */
  blockLead?: boolean;
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
        {lead ? <Text style={bold}>{lead}{blockLead ? '\n' : ' '}</Text> : null}
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
   * The booking sheet's pill (court → booking transition, 2026-09-01): 46 wide,
   * radius 12, 6×5 padding, 10 pt weekday + 16 pt day in Black — about five fit
   * in the card and the rest scroll. Grown from 40 / 9 / 14 on 2026-09-05
   * (owner: bigger and bolder), which is why the strip now scrolls a pill
   * sooner than it did.
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
        minWidth: compact ? 46 : 52,
        alignItems: 'center',
        gap: 1,
        paddingTop: compact ? 6 : 8,
        paddingBottom: compact ? 6 : 8,
        paddingStart: compact ? 5 : 6,
        paddingEnd: compact ? 5 : 6,
        borderRadius: compact ? 12 : radius.cell,
        borderWidth: 1.5,
        borderColor: selected ? brand.blue : colors.line,
        backgroundColor: selected ? brand.blue : closed ? colors.sub : colors.card,
      }}
    >
      <Text
        style={{
          fontFamily: compact ? fonts.body800 : fonts.body700,
          fontSize: 10,
          letterSpacing: tracking(compact ? 0.45 : 0.6),
          textTransform: 'uppercase',
          opacity: compact ? 0.85 : 0.75,
          color: selected ? brand.white : closed ? colors.fnt2 : colors.ink,
        }}
      >
        {dow}
      </Text>
      <Text
        style={{
          fontFamily: compact ? fonts.display900 : fonts.display800,
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
/**
 * MEMOISED, and its `onPress` takes the cell rather than closing over it.
 *
 * A trading night is up to ~34 of these, and every re-render of the surface
 * around them — the day strip's selection moving, the minute tick, a refetch
 * flag flipping — used to re-run all ~34 component bodies for a picture that
 * had not changed. On the Book tab that is the JS thread the court's rally is
 * drawn from, so it was frames off the animation for nothing.
 *
 * `memo` only earns that back if the props are shallow-equal, which is why the
 * handler is `(cell) => void` and not `() => void`: an `onPress={() => tap(cell)}`
 * at the call site is a new function on every render and would defeat it on its
 * own. The other props are the cell (a stable object off the memoised grid) and
 * three strings, which compare by value.
 */
export const SlotCell = memo(function SlotCell({
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
  /** Handed the cell it was pressed on — see the note above on why. */
  onPress?: (cell: MergedCell) => void;
  /**
   * The booking sheet's cell (court → booking transition, 2026-09-01): min
   * height 46, radius 12, 8×4 padding, a 2 pt border and 15 / 11 / 9.5 pt in
   * Black / ExtraBold — four rows show in the card's 216 pt grid; the sheet
   * presses with a scale, not a dim. Grown from 40 / 13 / 9.5 / 8.5 on
   * 2026-09-05 (owner: bigger and bolder) — the grid grew with it, and the
   * card's own heading moved out to the screen title to pay for it.
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
      onPress={onPress ? () => onPress(cell) : undefined}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 2,
        paddingTop: compact ? 8 : 10,
        paddingBottom: compact ? 8 : 10,
        paddingStart: 4,
        paddingEnd: 4,
        minHeight: compact ? 46 : 52,
        borderRadius: compact ? 12 : radius.cell,
        backgroundColor: visual.bg,
        borderWidth: compact ? 2 : 1.5,
        borderColor: visual.border,
        borderStyle: visual.borderStyle,
        opacity: pressed && !compact ? 0.85 : 1,
        transform: [{ scale: pressed && compact ? 0.96 : 1 }],
      })}
    >
      <Text
        style={{
          fontFamily: compact ? fonts.display900 : fonts.display800,
          fontSize: 15,
          color: visual.text,
        }}
      >
        {time}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: compact ? fonts.body800 : fonts.body700,
          fontSize: compact ? 11 : 10.5,
          color: visual.subText,
        }}
      >
        {sub}
      </Text>
      {capacityLine ? (
        <Text
          numberOfLines={1}
          style={{
            fontFamily: compact ? fonts.body800 : fonts.body700,
            fontSize: 9.5,
            letterSpacing: tracking(0.3),
            color: cell.freeCount > 1 ? colors.fnt : colors.ambstrong,
          }}
        >
          {capacityLine}
        </Text>
      ) : null}
    </Pressable>
  );
});

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
