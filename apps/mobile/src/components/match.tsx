/**
 * The open-match building blocks (docs/design/open-matches/guest.md §4.9,
 * §4.12–§4.18): the poster with its 2×2 seat grid, the list row, the
 * organiser's request row, the quick messages, the money card, the rules, the
 * restricted link card and the one-time gender ask.
 *
 * PRESENTATION ONLY. Every string arrives formatted or is a catalog key; the
 * server decided who may do what (`me.can`, `seats[].can`) and the screens
 * pass those answers in. Nothing here prices, permits or refuses.
 *
 * TEST IDS. Each wrapper that renders a Pressable (`SeatGrid`, `RequestRow`,
 * `QuickMessageBar`, `GenderAsk`, `MatchRow`, `MatchRulesCard`,
 * `MatchRestrictedCard`) takes a REQUIRED `testID` from its call site and
 * forwards `${testID}.<child>` explicitly; all seven are in `testIdElements`
 * (packages/config/src/eslint.js). `MatchPoster`, `MatchMoneyCard` and
 * `MatchMessages` render no Pressable. The seat menu and the cancel reason
 * use the shared native sheet, `components/nativeChoice.ts`.
 */
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { SymbolView } from 'expo-symbols';
import { wallTimeToUtc } from '@touch/core';
import {
  formatDayNumber,
  formatMonthShort,
  formatWeekdayShort,
  type Locale,
  type MessageKey,
  type TParams,
} from '@touch/i18n';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, space, useTheme } from '../theme';
import { addDays, DEFAULT_TZ, type VenueSettingsPublic } from '../features/availability/assemble';
import {
  categoryKey,
  displaySeat,
  MESSAGE_CODES,
  SEATS_TOTAL,
  tradingNightOf,
  type Gender,
  type MatchCategory,
  type MatchSeat,
  type MessageCode,
} from '../features/matches/logic';
import { Button } from './ui';
import { CheckIcon, ChevronIcon } from './icons';

// ── Branch knobs and trading nights ─────────────────────────────────────────

/** What the match screens read from a branch's `venue_settings_public` row (0257 adds the two match knobs). */
export type MatchBranchRow = Pick<
  VenueSettingsPublic,
  'matches_enabled' | 'match_fill_deadline_minutes' | 'timezone' | 'opening_hours' | 'phone'
>;

/**
 * The trading night a match belongs to, as the lists and the poster name it
 * (§4.12): "Tonight", "Tomorrow", else "Thu 3 Oct". A 00:30 start belongs to
 * the night before (`tradingNightOf`), and so does "now" at 00:30.
 */
export function nightLabel(
  startAt: string,
  settings: MatchBranchRow | null,
  nowMs: number,
  t: (key: MessageKey, params?: TParams) => string,
  locale: Locale,
): string {
  const tz = settings?.timezone ?? DEFAULT_TZ;
  const knobs = settings ?? {};
  const night = tradingNightOf(startAt, knobs);
  const today = tradingNightOf(new Date(nowMs), knobs);
  if (night === today) return t('matches.list.tonight');
  if (night === addDays(today, 1)) return t('matches.list.tomorrow');
  const noon = wallTimeToUtc(night, 12 * 60, tz);
  return t('matches.list.day', {
    weekday: formatWeekdayShort(noon, locale, tz),
    day: formatDayNumber(noon, locale, tz),
    month: formatMonthShort(noon, locale, tz),
  });
}

// ── Small pieces ────────────────────────────────────────────────────────────

/** The category pill: "Open to all" / "Women only" / "Men only". */
export function CategoryPill({ category }: { category: MatchCategory }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: colors.tint,
        borderRadius: radius.pill,
        paddingStart: 9,
        paddingEnd: 9,
        paddingTop: 3,
        paddingBottom: 3,
      }}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.blue }}>
        {t(categoryKey(category))}
      </Text>
    </View>
  );
}

/** A quiet information chip (visibility, join policy). */
function InfoChip({ label }: { label: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.sub,
        borderRadius: radius.pill,
        paddingStart: 9,
        paddingEnd: 9,
        paddingTop: 3,
        paddingBottom: 3,
      }}
    >
      <Text style={{ fontFamily: fonts.body600, fontSize: 11.5, color: colors.mut }}>{label}</Text>
    </View>
  );
}

/** Four dots, the taken ones filled (the list row; no names, GD-5). */
export function SeatDots({ taken, total = SEATS_TOTAL }: { taken: number; total?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessible={false}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: i < taken ? colors.gstrong : 'transparent',
            borderWidth: 1.5,
            borderColor: i < taken ? colors.gstrong : colors.line2,
          }}
        />
      ))}
    </View>
  );
}

/**
 * The header's share glyph (§4.14 Header); the screen owns the button and its
 * id. Each platform's own: iOS draws the system's `square.and.arrow.up` (the
 * SVG below is its fallback), Android Material's "share" node graph.
 */
export function ShareGlyph({ color, size = 20 }: { color: string; size?: number }) {
  const outline = (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Path
        d="M12 15V4M8 8l4-4 4 4M6 11.5v7.5h12v-7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name="square.and.arrow.up"
        size={size}
        weight="medium"
        tintColor={color}
        fallback={outline}
      />
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"
        fill={color}
      />
    </Svg>
  );
}

function MoreGlyph({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Circle cx={6} cy={12} r={1.8} fill={color} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Circle cx={18} cy={12} r={1.8} fill={color} />
    </Svg>
  );
}

// ── MatchPoster (§4.14 item 1) ──────────────────────────────────────────────

/**
 * The top of the match screen: the two-weight "OPEN / MATCH" headline, the
 * time, the day and branch, the category pill, the visibility and policy
 * chips, the seat grid (passed in, with its own ids), the seat count and the
 * fill deadline (amber in its last 30 minutes). Not pressable.
 */
export function MatchPoster({
  time,
  when,
  category,
  chips,
  seatsLine,
  fillLine,
  courtLine,
  stateLine,
  children,
}: {
  time: string;
  when: string;
  category: MatchCategory;
  chips: readonly string[];
  seatsLine: string;
  fillLine?: { text: string; urgent: boolean } | null;
  courtLine?: string | null;
  /** An ended match's §4.15 line. */
  stateLine?: string | null;
  children: ReactNode;
}) {
  const { t, dir } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const rtl = dir === 'rtl';
  const headline = {
    fontSize: 13,
    letterSpacing: rtl ? 0 : tracking(1.2),
    textTransform: rtl ? ('none' as const) : ('uppercase' as const),
  };
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        padding: space.l,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'baseline' }}>
        <Text style={{ ...headline, fontFamily: fonts.display900, color: colors.ink }}>
          {t('matches.detail.headlineTop')}
        </Text>
        <Text style={{ ...headline, fontFamily: fonts.body400, color: colors.mut }}>
          {t('matches.detail.headlineBottom')}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: fonts.display900,
          fontSize: 34,
          lineHeight: rtl ? 48 : 38,
          color: colors.ink,
          marginTop: 6,
        }}
      >
        {time}
      </Text>
      <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, color: colors.mut2, marginTop: 2 }}>
        {when}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
        <CategoryPill category={category} />
        {chips.map((c) => (
          <InfoChip key={c} label={c} />
        ))}
      </View>
      <View style={{ marginTop: space.l }}>{children}</View>
      <Text
        style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink, marginTop: space.sm }}
      >
        {seatsLine}
      </Text>
      {courtLine ? (
        <Text
          style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.gtext, marginTop: 4 }}
        >
          {courtLine}
        </Text>
      ) : null}
      {fillLine ? (
        <View
          style={{
            alignSelf: 'flex-start',
            marginTop: 6,
            backgroundColor: fillLine.urgent ? colors.amb : 'transparent',
            borderRadius: radius.pill,
            paddingStart: fillLine.urgent ? 8 : 0,
            paddingEnd: fillLine.urgent ? 8 : 0,
            paddingTop: fillLine.urgent ? 3 : 0,
            paddingBottom: fillLine.urgent ? 3 : 0,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.body600,
              fontSize: 12.5,
              color: fillLine.urgent ? colors.ambtext : colors.mut,
            }}
          >
            {fillLine.text}
          </Text>
        </View>
      ) : null}
      {stateLine ? (
        <Text
          style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut2, marginTop: 6 }}
        >
          {stateLine}
        </Text>
      ) : null}
    </View>
  );
}

// ── SeatGrid (§4.14 item 1, §4.9) ───────────────────────────────────────────

/**
 * The four seats, 2×2 on a court-line drawing, each printed by `displaySeat`
 * ("Ahmed K.", "Ahmed K. +1", "Former player", "Open seat · taking a player")
 * or "Open seat". Seat `n` is `${testID}.<n>`; a seat the viewer can act on
 * (the server's `seats[].can`, or the viewer's own friend seat) carries a
 * menu button at `${testID}.<n>.menu`.
 */
export function SeatGrid({
  testID,
  seats,
  category,
  hasMenu,
  onMenu,
}: {
  testID: string;
  seats: readonly MatchSeat[];
  category: MatchCategory;
  hasMenu?: (seat: MatchSeat) => boolean;
  onMenu?: (seat: MatchSeat, label: string) => void;
}) {
  const { t } = useLocale();
  const { colors } = useTheme();
  // A seat sits at its own number; any seat whose number is out of range (or
  // taken twice) fills the first empty place, so four seats always show.
  const cells: (MatchSeat | null)[] = Array.from({ length: SEATS_TOTAL }, () => null);
  const spill: MatchSeat[] = [];
  for (const s of seats) {
    const i = s.seatNo - 1;
    if (i >= 0 && i < SEATS_TOTAL && cells[i] === null) cells[i] = s;
    else spill.push(s);
  }
  for (const s of spill) {
    const i = cells.indexOf(null);
    if (i >= 0) cells[i] = s;
  }
  const cell = (index: number) => {
    const seat = cells[index] ?? null;
    const n = index + 1;
    const label = seat ? displaySeat(seat, category, t, seats) : t('matches.common.openSeat');
    const menu = seat && onMenu && hasMenu?.(seat);
    return (
      <SeatCell
        key={n}
        testID={`${testID}.${n}`}
        menuTestID={`${testID}.${n}.menu`}
        label={label}
        seat={seat}
        onMenu={menu ? () => onMenu(seat, label) : undefined}
      />
    );
  };
  return (
    <View
      testID={testID}
      style={{
        borderWidth: 1.5,
        borderColor: colors.gline,
        borderRadius: radius.cell,
        backgroundColor: colors.gtint,
        overflow: 'hidden',
      }}
    >
      <View style={{ flexDirection: 'row' }}>
        {cell(0)}
        <View style={{ width: 1.5, backgroundColor: colors.gline }} />
        {cell(1)}
      </View>
      {/* The net. */}
      <View style={{ height: 2, backgroundColor: colors.gstrong }} />
      <View style={{ flexDirection: 'row' }}>
        {cell(2)}
        <View style={{ width: 1.5, backgroundColor: colors.gline }} />
        {cell(3)}
      </View>
    </View>
  );
}

function SeatCell({
  testID,
  menuTestID,
  label,
  seat,
  onMenu,
}: {
  testID: string;
  menuTestID: string;
  label: string;
  seat: MatchSeat | null;
  onMenu?: () => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const taken = seat !== null && !seat.open;
  return (
    <View
      testID={testID}
      style={{ flex: 1, minHeight: 74, padding: space.sm, justifyContent: 'center', gap: 4 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: taken ? colors.gstrong : 'transparent',
            borderWidth: 1.5,
            borderStyle: taken ? 'solid' : 'dashed',
            borderColor: taken ? colors.gstrong : colors.fnt2,
          }}
        />
        {seat?.isMe ? (
          <Text style={{ fontFamily: fonts.body800, fontSize: 10.5, color: colors.gtext }}>
            {t('matches.common.you')}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {onMenu ? (
          <Pressable
            testID={menuTestID}
            accessibilityRole="button"
            accessibilityLabel={t('matches.detail.seatMenu', { name: label })}
            hitSlop={8}
            onPress={onMenu}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <MoreGlyph color={colors.mut} />
          </Pressable>
        ) : null}
      </View>
      <Text
        numberOfLines={2}
        style={{
          fontFamily: taken ? fonts.body700 : fonts.body400,
          fontSize: 13,
          color: taken ? colors.ink : colors.mut,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ── MatchRow (§4.12, §4.16) ─────────────────────────────────────────────────

/**
 * One match in a list: time (and day), the category pill, four seat dots,
 * the seats-left phrase, a line (the share at the desk, or the guest's §4.15
 * state), the approve glyph when the organiser approves, "Court booked · a
 * seat opened" on a refill, and a "Your match" / "Asked" tag. No names
 * (GD-5). The whole row opens the match.
 */
export function MatchRow({
  testID,
  time,
  day,
  category,
  seatsTaken,
  seatsLeft,
  line,
  approve,
  refill,
  tag,
  highlight,
  onPress,
}: {
  testID: string;
  time: string;
  day?: string | null;
  category: MatchCategory;
  seatsTaken: number;
  /** The counted "1 seat left". */
  seatsLeft: string;
  line?: string | null;
  /** The organiser approves each player: the glyph, with its words for screen readers. */
  approve?: string | null;
  refill?: string | null;
  tag?: string | null;
  /** The `at` param of the list: this row is the time the guest came for. */
  highlight?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const label = [day, time, seatsLeft, line, approve, refill, tag].filter(Boolean).join(', ');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: highlight ? 1.5 : 1,
        borderColor: highlight ? colors.blue : colors.line,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.sm,
        paddingTop: 12,
        paddingBottom: 12,
      })}
    >
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: fonts.display900, fontSize: 17, color: colors.ink }}>
            {time}
          </Text>
          {day ? (
            <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>
              {day}
            </Text>
          ) : null}
          <CategoryPill category={category} />
          {approve ? (
            <View accessible accessibilityLabel={approve}>
              <CheckIcon size={14} color={colors.blue} strokeWidth={2.4} />
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SeatDots taken={seatsTaken} />
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.gtext }}>
            {seatsLeft}
          </Text>
        </View>
        {line ? (
          <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut2 }}>
            {line}
          </Text>
        ) : null}
        {refill ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.ambtext }}>
            {refill}
          </Text>
        ) : null}
      </View>
      {tag ? (
        <View
          style={{
            backgroundColor: colors.gtint,
            borderRadius: radius.pill,
            paddingStart: 8,
            paddingEnd: 8,
            paddingTop: 3,
            paddingBottom: 3,
          }}
        >
          <Text style={{ fontFamily: fonts.body800, fontSize: 10.5, color: colors.gtext }}>
            {tag}
          </Text>
        </View>
      ) : null}
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

// ── RequestRow (§4.14 item 4, OM-41) ────────────────────────────────────────

/**
 * A pending request, for the organiser: "{name} · {games} at Touch ·
 * {noShows} · {seats}", Approve and Decline, and a menu (Report, Block).
 * A REQUESTER_INELIGIBLE answer keeps the row and shows its line under it;
 * Decline stays enabled.
 */
export function RequestRow({
  testID,
  name,
  line,
  error,
  busy,
  onApprove,
  onDecline,
  onMenu,
}: {
  testID: string;
  name: string;
  line: string;
  error?: string | null;
  busy?: 'approve' | 'decline' | null;
  onApprove: () => void;
  onDecline: () => void;
  onMenu?: () => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        padding: space.m,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>{name}</Text>
          <Text
            style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut2, marginTop: 2 }}
          >
            {line}
          </Text>
        </View>
        {onMenu ? (
          <Pressable
            testID={`${testID}.menu`}
            accessibilityRole="button"
            accessibilityLabel={t('matches.detail.seatMenu', { name })}
            hitSlop={8}
            onPress={onMenu}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <MoreGlyph color={colors.mut} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.redtext }}>
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          testID={`${testID}.decline`}
          label={t('matches.detail.decline')}
          variant="secondary"
          size="compact"
          busy={busy === 'decline'}
          disabled={!!busy}
          onPress={onDecline}
          style={{ flex: 1 }}
        />
        <Button
          testID={`${testID}.approve`}
          label={t('matches.detail.approve')}
          variant="cta"
          size="compact"
          busy={busy === 'approve'}
          disabled={!!busy || !!error}
          onPress={onApprove}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

// ── Quick messages (§4.17, OM-17) ───────────────────────────────────────────

const MESSAGE_LABEL: Record<MessageCode, MessageKey> = {
  on_my_way: 'matches.messages.onMyWay',
  running_late: 'matches.messages.runningLate',
  cant_make_it: 'matches.messages.cantMakeIt',
  bring_balls: 'matches.messages.bringBalls',
};

/** The words of a preset message. */
export function messageLabelKey(code: MessageCode): MessageKey {
  return MESSAGE_LABEL[code];
}

/**
 * The four preset chips, `${testID}.<code>`. No free text (OM-17). A chip
 * rests after a send (`resting`, GD-7); the server's `duplicate` and
 * RATE_LIMITED decide.
 */
export function QuickMessageBar({
  testID,
  resting,
  busy,
  onSend,
}: {
  testID: string;
  resting: ReadonlySet<MessageCode>;
  busy: MessageCode | null;
  onSend: (code: MessageCode) => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {MESSAGE_CODES.map((code) => {
        const disabled = resting.has(code) || busy !== null;
        return (
          <Pressable
            key={code}
            testID={`${testID}.${code}`}
            accessibilityRole="button"
            accessibilityState={{ disabled, busy: busy === code }}
            disabled={disabled}
            onPress={() => onSend(code)}
            style={({ pressed }) => ({
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pressed ? colors.sub : colors.card,
              borderRadius: radius.pill,
              paddingStart: 12,
              paddingEnd: 12,
              paddingTop: 8,
              paddingBottom: 8,
              opacity: disabled ? 0.5 : 1,
            })}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
              {t(MESSAGE_LABEL[code])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The last 20 messages, oldest first: "{name} · {label} · {time}". */
export function MatchMessages({ lines }: { lines: readonly { key: string; text: string }[] }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  if (lines.length === 0) {
    return (
      <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>
        {t('matches.messages.empty')}
      </Text>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      {lines.map((l) => (
        <Text
          key={l.key}
          style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut2 }}
        >
          {l.text}
        </Text>
      ))}
    </View>
  );
}

// ── Money (§4.14 item 3, OM-45) ─────────────────────────────────────────────

/**
 * What a member owes and what their tickets do: "You pay {share} at the desk,
 * and your ticket comes back after you play", the tickets in this match, and
 * the reminder that a ticket is not the share. A linked desk seat holds no
 * ticket and shows the share line only.
 */
export function MatchMoneyCard({
  share,
  tickets,
  desk,
}: {
  /** The formatted share, or null when the server sent none. */
  share: string | null;
  /** The formatted count of the guest's tickets in this match. */
  tickets: string | null;
  desk: boolean;
}) {
  const { t } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  if (!share && (desk || !tickets)) return null;
  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.gtext2 };
  return (
    <View
      style={{
        backgroundColor: colors.gtint,
        borderWidth: 1,
        borderColor: colors.gline,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: 12,
        paddingBottom: 12,
        gap: 4,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: 12,
          letterSpacing: tracking(0.6),
          textTransform: 'uppercase',
          color: colors.gtext,
        }}
      >
        {t('matches.detail.moneyTitle')}
      </Text>
      {share ? (
        <Text style={body}>
          {desk
            ? t('matches.detail.moneyShareDesk', { share })
            : t('matches.detail.moneyShare', { share })}
        </Text>
      ) : null}
      {!desk && tickets ? (
        <>
          <Text style={body}>{t('matches.detail.moneyTickets', { count: tickets })}</Text>
          <Text style={body}>{t('matches.detail.moneyNote')}</Text>
        </>
      ) : null}
    </View>
  );
}

// ── MatchRulesCard (§4.10.1 rules + the court rule) ─────────────────────────

/** The wallet's seven rules (one copy, `matches.tickets.*`), then the court rule. */
const RULES: readonly MessageKey[] = [
  'matches.tickets.rule1',
  'matches.tickets.rule2',
  'matches.tickets.rule3',
  'matches.tickets.rule4',
  'matches.tickets.rule5',
  'matches.tickets.rule6',
  'matches.tickets.rule7',
  'matches.detail.courtRule',
];

/** "How open matches work", folded until the guest opens it (`${testID}.toggle`). */
export function MatchRulesCard({ testID }: { testID: string }) {
  const { t, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        overflow: 'hidden',
      }}
    >
      <Pressable
        testID={`${testID}.toggle`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: space.m,
          backgroundColor: pressed ? colors.sub : 'transparent',
        })}
      >
        <Text style={{ fontFamily: fonts.body800, fontSize: 13.5, color: colors.ink }}>
          {t('matches.detail.rulesTitle')}
        </Text>
        {/* The chevron is mirrored in Arabic, so "open" turns it the other way to point down. */}
        <View
          testID={`${testID}.chevron`}
          style={{ transform: [{ rotate: open ? (dir === 'rtl' ? '-90deg' : '90deg') : '0deg' }] }}
        >
          <ChevronIcon size={16} color={colors.fnt2} />
        </View>
      </Pressable>
      {open ? (
        <View
          style={{ paddingStart: space.m, paddingEnd: space.m, paddingBottom: space.m, gap: 8 }}
        >
          {RULES.map((key, i) => (
            <View key={key} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ fontFamily: fonts.body800, fontSize: 12.5, color: colors.gtext }}>
                {i + 1}
              </Text>
              <Text
                style={{
                  flex: 1,
                  fontFamily: fonts.body400,
                  fontSize: 12.5,
                  lineHeight: 19,
                  color: colors.mut2,
                }}
              >
                {t(key)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── MatchRestrictedCard (§4.18, R32) ────────────────────────────────────────

/**
 * A link viewer who may not join (banned, the other gender, a block either
 * way): the day, time, branch and category from `match_invite` (no names),
 * the refusal's copy, and "Find another match" (`${testID}.find`). The card
 * itself is `${testID}.restricted`.
 */
export function MatchRestrictedCard({
  testID,
  when,
  branch,
  category,
  message,
  onFind,
}: {
  testID: string;
  when: string | null;
  branch: string | null;
  category: MatchCategory | null;
  message: string;
  onFind: () => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={`${testID}.restricted`}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        padding: space.l,
        gap: 8,
      }}
    >
      <Text style={{ fontFamily: fonts.display900, fontSize: 18, color: colors.ink }}>
        {t('matches.common.title')}
      </Text>
      {when ? (
        <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>{when}</Text>
      ) : null}
      {branch ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut2 }}>
          {branch}
        </Text>
      ) : null}
      {category ? <CategoryPill category={category} /> : null}
      <View
        style={{
          backgroundColor: colors.amb,
          borderWidth: 1,
          borderColor: colors.ambline,
          borderRadius: radius.cell,
          padding: space.sm,
          marginTop: 4,
        }}
      >
        <Text
          style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.ambtext }}
        >
          {message}
        </Text>
      </View>
      <Button
        testID={`${testID}.find`}
        label={t('matches.link.findAnother')}
        variant="cta"
        onPress={onFind}
        style={{ marginTop: 4 }}
      />
    </View>
  );
}

// ── GenderAsk (§4.9, OM-28, DF-10) ──────────────────────────────────────────

/**
 * The one-time question, inline (not a modal): "Before your first open
 * match: are you a woman or a man?…", with "Woman" (`${testID}.female`) and
 * "Man" (`${testID}.male`). The answer is `set_my_gender`; the front desk can
 * correct it.
 */
export function GenderAsk({
  testID,
  busy,
  error,
  onPick,
}: {
  testID: string;
  busy: Gender | null;
  error?: string | null;
  onPick: (gender: Gender) => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.tint,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        padding: space.m,
        gap: space.sm,
      }}
    >
      <Text
        style={{ fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 20, color: colors.ink }}
      >
        {t('matches.gender.ask')}
      </Text>
      {error ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.redtext }}>
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          testID={`${testID}.female`}
          label={t('matches.gender.female')}
          variant="secondary"
          size="compact"
          busy={busy === 'female'}
          disabled={busy !== null}
          onPress={() => onPick('female')}
          style={{ flex: 1 }}
        />
        <Button
          testID={`${testID}.male`}
          label={t('matches.gender.male')}
          variant="secondary"
          size="compact"
          busy={busy === 'male'}
          disabled={busy !== null}
          onPress={() => onPick('male')}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

/** A notice block (refusal, banned, switched off): amber, not pressable. */
export function MatchNotice({ text, tone = 'amber' }: { text: string; tone?: 'amber' | 'red' }) {
  const { colors, fonts } = useTheme();
  const red = tone === 'red';
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: red ? colors.redtint : colors.amb,
        borderWidth: 1,
        borderColor: red ? colors.redline : colors.ambline,
        borderRadius: radius.button,
        padding: space.m,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.body600,
          fontSize: 13,
          lineHeight: 19,
          color: red ? colors.redtext : colors.ambtext,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/** A section heading inside a match screen. */
export function MatchSectionTitle({ children }: { children: ReactNode }) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: space.xl,
        marginBottom: space.s,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: 11.5,
          letterSpacing: tracking(0.6),
          textTransform: 'uppercase',
          color: colors.fnt,
        }}
      >
        {children}
      </Text>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />
    </View>
  );
}
