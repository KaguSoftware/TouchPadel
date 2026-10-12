/**
 * The guest's tournament building blocks (tournaments plan §5.2): a list row, a round of the
 * schedule, the standings table, and the detail's ticket and prize card. The list row is a card shaped like the operator's
 * (`apps/operator/src/features/tournaments/TournamentsList.tsx`).
 *
 * PRESENTATION ONLY. Every string arrives formatted or is a catalog key; the server decided the
 * places, the states, the pairings and the ranks, and the screens pass those answers in. Nothing
 * here ranks, pairs or refuses.
 *
 * TEST IDS. `TournamentRow` renders a Pressable, takes a REQUIRED `testID` from its call site and
 * forwards it explicitly; `SeatingBoard` takes a REQUIRED `testID` and forwards
 * `${testID}.court.<no>.chair.<n>` and `${testID}.more` unconditionally. Both are in
 * `testIdElements` (packages/config/src/eslint.js). `TournamentRound` and `StandingsTable` render
 * no Pressable.
 *
 * The seating board (play-coaches contracts §5) is the one piece here that moves: the courts rise
 * in on mount (motion.tsx's `Rise`), an open chair leans into the finger (`TiltPress`), and the
 * guest's own chair, arriving after a registration, rises and fills green once. Nothing loops,
 * and all of it holds still under Reduce Motion.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../i18n/text';
import { brand, palettes, radius, space, useTheme, withAlpha } from '../theme';
import { useLocale } from '../i18n/LocaleProvider';
import { useReduceMotion } from '../lib/useReduceMotion';
import { categoryKey, type MatchCategory } from '../features/matches/logic';
import type { TourTone } from '../features/tournaments/logic';
import { CategoryPill } from './match';
import { ChevronIcon, TrophyIcon } from './icons';
import { Button, DashedDivider } from './ui';
import { EASE_OUT_EXPO, Rise, TiltPress } from './motion';

// ── TournamentRow (the list) ────────────────────────────────────────────────

/** A list card's date tile: month, day and weekday, already formatted in the branch's zone. */
export interface TourDateView {
  month: string;
  day: string;
  weekday: string;
}

/**
 * One tournament in the list, laid out as the operator's cards (2026-10-05 redesign): a date tile
 * coloured by state, the status pill, the name, the day and time, the format and category tags,
 * then a footer with the places, the fee, the guest's own state and how full it is.
 */
export function TournamentRow({
  testID,
  tone,
  date,
  status,
  category,
  format,
  title,
  when,
  places,
  fee,
  mine,
  fill,
  onPress,
}: {
  testID: string;
  tone: TourTone;
  date: TourDateView;
  /** "Registration open", "In play", …, or null for a state the phone does not know. */
  status: string | null;
  category: MatchCategory;
  /** "Americano" / "Mexicano", or null. */
  format: string | null;
  title: string;
  /** The day and the times (and the branch when there are several); carries the date for a screen reader. */
  when: string;
  /** "Places left: 3", "Waitlist open" or "Full"; null once registration has closed (the pill says so). */
  places: string | null;
  fee: string;
  /** The guest's own state ("Registered", "Number 2 on the waitlist"), or null. */
  mine: string | null;
  /** 0–100 of the entries taken, or null when the tournament names no maximum. */
  fill: number | null;
  onPress: () => void;
}) {
  const { colors, fonts, appearance } = useTheme();
  // An upcoming tile is the brand blue in light; in dark `colors.blue` is white, so it turns the
  // brand green with its own ink, as the iOS tab bar does (owner, 2026-10-11).
  const darkUpcoming = tone === 'upcoming' && appearance === 'dark';
  const accent =
    tone === 'running'
      ? colors.gstrong
      : tone === 'over'
        ? colors.sub
        : darkUpcoming
          ? brand.green
          : colors.blue;
  const onAccent = tone === 'over' ? colors.mut : darkUpcoming ? brand.greenInk : colors.card;
  const pill =
    tone === 'running'
      ? { bg: colors.gtint, fg: colors.gtext }
      : tone === 'over'
        ? { bg: colors.sub, fg: colors.mut }
        : { bg: colors.tint, fg: colors.blue };
  const tag = (label: string) => (
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
      <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.ink }}>{label}</Text>
    </View>
  );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, status, when, places, fee, mine].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        overflow: 'hidden',
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space.sm,
          padding: space.m,
          paddingBottom: space.sm,
        }}
      >
        {/* The day is in `when` too, so the tile stays out of the reader's way. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            // A long month ("تشرين الثاني") wraps to two centred lines; the tile grows to fit
            // and the padding keeps it off the edges.
            width: 64,
            minHeight: 68,
            paddingStart: 6,
            paddingEnd: 6,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: radius.cell,
            backgroundColor: accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: 11.5,
              lineHeight: 14,
              textAlign: 'center',
              color: onAccent,
            }}
          >
            {date.month}
          </Text>
          <Text
            style={{ fontFamily: fonts.display800, fontSize: 24, lineHeight: 28, color: onAccent }}
          >
            {date.day}
          </Text>
          <Text style={{ fontFamily: fonts.body600, fontSize: 11, color: onAccent }}>
            {date.weekday}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 6, alignItems: 'flex-start' }}>
          {status ? (
            <View
              style={{
                backgroundColor: pill.bg,
                borderRadius: radius.pill,
                paddingStart: 9,
                paddingEnd: 9,
                paddingTop: 3,
                paddingBottom: 3,
              }}
            >
              <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: pill.fg }}>
                {status}
              </Text>
            </View>
          ) : null}
          <Text
            numberOfLines={2}
            style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}
          >
            {title}
          </Text>
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
            {when}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {format ? tag(format) : null}
            <CategoryPill category={category} />
          </View>
        </View>
      </View>
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingStart: space.m,
          paddingEnd: space.m,
          paddingTop: space.sm,
          paddingBottom: space.sm,
          gap: space.s,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <View style={{ flex: 1, flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            {places ? (
              <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.gtext }}>
                {places}
              </Text>
            ) : null}
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut2 }}>
              {fee}
            </Text>
          </View>
          {mine ? (
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.blue }}>
              {mine}
            </Text>
          ) : null}
          <ChevronIcon size={16} color={colors.fnt2} />
        </View>
        {fill !== null ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              height: 6,
              borderRadius: radius.pill,
              backgroundColor: colors.sub,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${fill}%`,
                height: '100%',
                borderRadius: radius.pill,
                // An upcoming bar is the brand green in both themes, though the light tile stays blue.
                backgroundColor:
                  tone === 'over' ? colors.fnt3 : tone === 'upcoming' ? brand.green : accent,
              }}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ── TournamentTicket (the detail, option B) ─────────────────────────────────

/** Above this many entries the places read as a bar; at or below, one block per place. */
const MAX_PLACE_BLOCKS = 24;

/**
 * The detail's summary, laid out as a ticket (owner's pick, 2026-10-09, option B): the status and
 * category, the name and format; the date, time and branch; a tear line; then the entry fee, the
 * places left, one block per place and the cut-off. Every string arrives formatted.
 */
export function TournamentTicket({
  status,
  category,
  title,
  subtitle,
  cells,
  feeLabel,
  fee,
  placesLabel,
  places,
  entriesLabel,
  entries,
  taken,
  max,
  closes,
}: {
  /** "Registration open", …, or null for a state the phone does not know. */
  status: string | null;
  category: MatchCategory;
  title: string;
  /** "Americano · Games to 21 points", or null. */
  subtitle: string | null;
  /** Date, Time and (when known) Branch, label above value. */
  cells: readonly { label: string; value: string }[];
  feeLabel: string;
  fee: string;
  placesLabel: string;
  /** The places left while registration is open, else null. */
  places: string | null;
  entriesLabel: string;
  /** "10 / 16". */
  entries: string;
  taken: number;
  /** The maximum entries, or null when the tournament names none (no blocks, no bar). */
  max: number | null;
  /** "Registration closes …", or null. */
  closes: string | null;
}) {
  const { t } = useLocale();
  const { colors: theme, fonts, tracking, appearance } = useTheme();
  // The ticket is green paper on the page (owner, 2026-10-11): the light green (`gline`) in light,
  // the brand green in dark. Only the notches take the page's own colour, so they read as cut out of it. No
  // border on the ticket or the notches: iOS draws a border above the children, so it ran across
  // the punches. The muted and green texts darken to the deep green so they keep their contrast
  // on it, and the rules are ink at low alpha.
  const light = palettes.light;
  const colors = {
    ...light,
    card: appearance === 'dark' ? brand.green : light.gline,
    line: withAlpha(light.ink, 0.16),
    line2: withAlpha(light.ink, 0.22),
    mut: light.gtext2,
    gtext: light.ink,
  };
  // Both pills are solid brand blue with white text.
  const pill = { bg: brand.blue, fg: light.card };
  const categoryPill = pill;
  const micro = {
    fontFamily: fonts.body700,
    fontSize: 11,
    letterSpacing: tracking(0.5),
    textTransform: 'uppercase' as const,
    color: colors.mut,
  };
  const notch = (side: 'start' | 'end') => (
    <View
      style={{
        position: 'absolute',
        [side]: -11,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: theme.bg,
      }}
    />
  );
  const blocks = max !== null && max > 0 && max <= MAX_PLACE_BLOCKS;
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.sheet,
        overflow: 'hidden',
      }}
    >
      <View style={{ padding: 18, paddingBottom: space.l, gap: 10 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: space.s,
          }}
        >
          {status ? (
            <View
              style={{
                backgroundColor: pill.bg,
                borderRadius: radius.pill,
                paddingStart: 10,
                paddingEnd: 10,
                paddingTop: 4,
                paddingBottom: 4,
              }}
            >
              <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: pill.fg }}>
                {status}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <View
            style={{
              backgroundColor: categoryPill.bg,
              borderRadius: radius.pill,
              paddingStart: 10,
              paddingEnd: 10,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: categoryPill.fg }}>
              {t(categoryKey(category))}
            </Text>
          </View>
        </View>
        <Text
          style={{ fontFamily: fonts.display800, fontSize: 26, lineHeight: 31, color: colors.ink }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, color: colors.mut }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line }}>
        {cells.map((c, i) => (
          <View
            key={c.label}
            style={{
              flex: 1,
              paddingStart: 12,
              paddingEnd: 12,
              paddingTop: space.m,
              paddingBottom: space.m,
              gap: 4,
              borderEndWidth: i < cells.length - 1 ? 1 : 0,
              borderEndColor: colors.line,
            }}
          >
            <Text numberOfLines={1} style={micro}>
              {c.label}
            </Text>
            <Text
              numberOfLines={2}
              style={{ fontFamily: fonts.display800, fontSize: 15, color: colors.ink }}
            >
              {c.value}
            </Text>
          </View>
        ))}
      </View>

      {/* The tear line: a dashed rule between two notches cut into the card's edges. */}
      <View style={{ height: 22, justifyContent: 'center' }}>
        {notch('start')}
        <DashedDivider color={colors.line2} style={{ marginStart: 18, marginEnd: 18 }} />
        {notch('end')}
      </View>

      <View
        style={{ paddingStart: 18, paddingEnd: 18, paddingTop: 10, paddingBottom: 18, gap: 12 }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: space.s,
          }}
        >
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={micro}>{feeLabel}</Text>
            <Text
              style={{
                fontFamily: fonts.display800,
                fontSize: 22,
                color: brand.greenInk,
              }}
            >
              {fee}
            </Text>
          </View>
          {places !== null ? (
            <View style={{ gap: 2, alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: fonts.display800, fontSize: 22, color: colors.ink }}>
                {places}
              </Text>
              <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.gtext }}>
                {placesLabel}
              </Text>
            </View>
          ) : null}
        </View>
        {max !== null && max > 0 ? (
          blocks ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ flexDirection: 'row', gap: 4 }}
            >
              {Array.from({ length: max }, (_, i) => (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: i < taken ? colors.blue : colors.line2,
                  }}
                />
              ))}
            </View>
          ) : (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                height: 8,
                borderRadius: radius.pill,
                backgroundColor: colors.line2,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.min(100, Math.round((taken / max) * 100))}%`,
                  height: '100%',
                  backgroundColor: colors.blue,
                }}
              />
            </View>
          )
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
            {entriesLabel}
          </Text>
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
            {entries}
          </Text>
        </View>
        {closes ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
            {closes}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The prize, in green under the ticket. */
export function TournamentPrize({ label, prize }: { label: string; prize: string }) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.gtint,
        borderWidth: 1,
        borderColor: colors.gline,
        borderRadius: radius.card,
        paddingStart: space.l,
        paddingEnd: space.l,
        paddingTop: space.m,
        paddingBottom: space.m,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.card,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <TrophyIcon size={20} color={colors.gstrong} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            fontFamily: fonts.body700,
            fontSize: 11,
            letterSpacing: tracking(0.5),
            textTransform: 'uppercase',
            color: colors.gtext,
          }}
        >
          {label}
        </Text>
        <Text style={{ fontFamily: fonts.body700, fontSize: 14.5, color: colors.gtext2 }}>
          {prize}
        </Text>
      </View>
    </View>
  );
}

// ── TournamentRound (the schedule) ──────────────────────────────────────────

export interface RoundMatchView {
  key: string;
  court: string;
  a: string;
  b: string;
  /** "21 – 3" once scored, else null. */
  score: string | null;
}

/** One round: a line per court with both teams and the score, then who sits out. */
export function TournamentRound({
  title,
  matches,
  vs,
  sitOut,
}: {
  title: string;
  matches: readonly RoundMatchView[];
  /** The word between the teams ("vs"). */
  vs: string;
  /** "Sitting out: …", or null. */
  sitOut: string | null;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        padding: space.m,
        gap: space.s,
      }}
    >
      <Text style={{ fontFamily: fonts.display800, fontSize: 14, color: colors.ink }}>{title}</Text>
      {matches.map((m) => (
        <View key={m.key} style={{ gap: 2 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.mut }}>
            {m.court}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13, color: colors.ink }}>
              {`${m.a} ${vs} ${m.b}`}
            </Text>
            {m.score ? (
              <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
                {m.score}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      {sitOut ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut2 }}>
          {sitOut}
        </Text>
      ) : null}
    </View>
  );
}

// ── StandingsTable ──────────────────────────────────────────────────────────

export interface StandingView {
  key: string;
  rank: string;
  player: string;
  points: string;
  diff: string;
  played: string;
}

/** The server's standings, in its order: rank, player, points won, difference, games played. */
export function StandingsTable({
  head,
  rows,
}: {
  head: { rank: string; player: string; points: string; diff: string; played: string };
  rows: readonly StandingView[];
}) {
  const { colors, fonts } = useTheme();
  const cell = (text: string, opts: { flex?: number; bold?: boolean } = {}) => (
    <Text
      numberOfLines={1}
      style={{
        flex: opts.flex ?? 1,
        fontFamily: opts.bold ? fonts.body700 : fonts.body600,
        fontSize: 12.5,
        color: colors.ink,
        textAlign: opts.flex ? undefined : 'center',
      }}
    >
      {text}
    </Text>
  );
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: space.s,
        paddingBottom: space.s,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {cell(head.rank, { bold: true })}
        {cell(head.player, { flex: 4, bold: true })}
        {cell(head.points, { bold: true })}
        {cell(head.diff, { bold: true })}
        {cell(head.played, { bold: true })}
      </View>
      {rows.map((r) => (
        <View key={r.key} style={{ flexDirection: 'row', gap: space.s }}>
          {cell(r.rank)}
          {cell(r.player, { flex: 4 })}
          {cell(r.points)}
          {cell(r.diff)}
          {cell(r.played)}
        </View>
      ))}
    </View>
  );
}

// ── SeatingBoard (the detail, play-coaches contracts §5) ────────────────────

/** A chair as the screen hands it over: its state, the words on it and what a reader says. */
export interface SeatingChairView {
  state: 'taken' | 'mine' | 'open';
  /** "Ali K.", "Player 5", "You", "Open". */
  label: string;
  /** "Court 1, chair 2: Ali K." */
  a11y: string;
}

export interface SeatingCourtView {
  /** The court's number, for the chairs' test ids. */
  no: number;
  /** "Court 1". */
  title: string;
  /** Side A seat 1, seat 2, side B seat 1, seat 2; null for a chair past the maximum (not drawn). */
  chairs: readonly (SeatingChairView | null)[];
}

/** Where chair n (0-based) stands: side A on the start half, side B on the end half, on the service lines. */
const CHAIR_PLACES = [
  { start: '25%', top: '24%' },
  { start: '25%', top: '73%' },
  { start: '75%', top: '24%' },
  { start: '75%', top: '73%' },
] as const;
const CHAIR_SIZE = 40;
const CHAIR_LABEL_WIDTH = 116;
/** The court lies back a little, like the Book tab's court: a static pitch, not a motion. */
const COURT_PITCH = '9deg';

/** An empty chair, drawn as one: a backrest, the seat, two legs. */
function ChairGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7.5 3.5h9a1 1 0 0 1 1 1V12h-11V4.5a1 1 0 0 1 1-1Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path d="M5 12h14v3H5z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M7 15v5.5M17 15v5.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** A taken chair: a figure on it, never a face. */
function SeatedGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={7.5} r={4} fill={color} />
      <Path d="M4.5 21c.9-4.6 4.1-7.2 7.5-7.2s6.6 2.6 7.5 7.2" fill={color} />
    </Svg>
  );
}

/** The court drawn to its 2:1, the net across the middle; the chairs stand on it as `children`. */
function SeatingCourt({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const line = colors.crtLine;
  const net = colors.crtShadow;
  const abs = { position: 'absolute' as const };
  return (
    <View
      style={{
        backgroundColor: colors.crtTurf,
        borderRadius: radius.cell,
        padding: 10,
        transform: [{ perspective: 900 }, { rotateX: COURT_PITCH }],
      }}
    >
      <View style={{ aspectRatio: 2 }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ ...abs, top: 0, bottom: 0, start: 0, end: 0 }}
        >
          <View
            style={{
              ...abs,
              top: 0,
              bottom: 0,
              start: 0,
              end: 0,
              borderWidth: 2,
              borderColor: line,
            }}
          />
          <View
            style={{
              ...abs,
              top: 0,
              bottom: 0,
              start: '25%',
              width: 2,
              marginStart: -1,
              backgroundColor: line,
            }}
          />
          <View
            style={{
              ...abs,
              top: 0,
              bottom: 0,
              end: '25%',
              width: 2,
              marginEnd: -1,
              backgroundColor: line,
            }}
          />
          <View
            style={{
              ...abs,
              top: '50%',
              start: '25%',
              end: '25%',
              height: 2,
              marginTop: -1,
              backgroundColor: line,
            }}
          />
          <View
            style={{
              ...abs,
              top: -6,
              bottom: -6,
              start: '50%',
              width: 3,
              marginStart: -1.5,
              backgroundColor: net,
            }}
          />
          <View
            style={{
              ...abs,
              top: -7,
              start: '50%',
              width: 7,
              height: 7,
              marginStart: -3.5,
              borderRadius: 2,
              backgroundColor: net,
            }}
          />
          <View
            style={{
              ...abs,
              bottom: -7,
              start: '50%',
              width: 7,
              height: 7,
              marginStart: -3.5,
              borderRadius: 2,
              backgroundColor: net,
            }}
          />
        </View>
        {children}
      </View>
    </View>
  );
}

/**
 * One chair: the marker and its label under it. Taken is navy with a figure, the guest's own is
 * green and says "You", open is a white tile with a dashed blue edge and an empty chair. When the
 * chair turns into the guest's own while the board is on screen (a registration landing), it
 * rises into place and fills green once.
 */
function SeatingChair({
  testID,
  place,
  chair,
  onPress,
  hint,
  disabled,
  pending,
}: {
  testID: string;
  place: (typeof CHAIR_PLACES)[number];
  chair: SeatingChairView;
  onPress?: () => void;
  hint?: string;
  disabled: boolean;
  pending: boolean;
}) {
  const { colors, fonts } = useTheme();
  const reduce = useReduceMotion();
  const mine = chair.state === 'mine';
  const taken = chair.state === 'taken';
  const [arrive] = useState(() => new Animated.Value(1));
  const wasMine = useRef(mine);
  useEffect(() => {
    const became = mine && !wasMine.current;
    wasMine.current = mine;
    if (!became || reduce) return;
    arrive.setValue(0);
    const anim = Animated.timing(arrive, {
      toValue: 1,
      duration: 560,
      easing: EASE_OUT_EXPO,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [mine, reduce, arrive]);

  const markerBg = taken ? colors.crtShadow : colors.card;
  const marker = (
    <View
      style={{
        width: CHAIR_SIZE,
        height: CHAIR_SIZE,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: markerBg,
        borderWidth: 2,
        borderStyle: chair.state === 'open' ? 'dashed' : 'solid',
        borderColor: mine ? colors.card : taken ? colors.crtLine : colors.blue,
        overflow: 'hidden',
      }}
    >
      {mine ? (
        // The green fill fades in over the white tile as the chair arrives.
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            start: 0,
            end: 0,
            backgroundColor: colors.gstrong,
            opacity: arrive,
          }}
        />
      ) : null}
      {pending ? (
        <ActivityIndicator size="small" color={colors.blue} />
      ) : chair.state === 'open' ? (
        <ChairGlyph size={20} color={colors.blue} />
      ) : (
        <SeatedGlyph size={20} color={mine ? colors.card : colors.crtLine} />
      )}
    </View>
  );
  const label = (
    <View
      style={{
        maxWidth: CHAIR_LABEL_WIDTH,
        backgroundColor: mine ? colors.gstrong : taken ? colors.crtShadow : colors.card,
        borderRadius: radius.pill,
        paddingStart: 8,
        paddingEnd: 8,
        paddingTop: 2,
        paddingBottom: 2,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.body800,
          fontSize: 11,
          color: mine ? colors.card : taken ? colors.crtLine : colors.blue,
        }}
      >
        {chair.label}
      </Text>
    </View>
  );
  const body = (
    <Animated.View
      style={{
        alignItems: 'center',
        gap: 4,
        transform: [
          { translateY: arrive.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          { scale: arrive.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
        ],
      }}
    >
      {marker}
      {label}
    </Animated.View>
  );
  return (
    <View
      style={{
        position: 'absolute',
        start: place.start,
        top: place.top,
        width: CHAIR_LABEL_WIDTH,
        marginStart: -CHAIR_LABEL_WIDTH / 2,
        marginTop: -CHAIR_SIZE / 2,
        alignItems: 'center',
      }}
    >
      {onPress ? (
        <TiltPress
          testID={testID}
          onPress={onPress}
          disabled={disabled}
          accessibilityLabel={hint ? `${chair.a11y}. ${hint}` : chair.a11y}
          style={{ alignItems: 'center' }}
        >
          {body}
        </TiltPress>
      ) : (
        <View testID={testID} accessible accessibilityLabel={chair.a11y}>
          {body}
        </View>
      )}
    </View>
  );
}

/** One legend entry: a small marker in a chair state, and its word. */
function LegendItem({ state, label }: { state: SeatingChairView['state']; label: string }) {
  const { colors, fonts } = useTheme();
  const bg = state === 'mine' ? colors.gstrong : state === 'taken' ? colors.crtShadow : colors.card;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          backgroundColor: bg,
          borderWidth: 1.5,
          borderStyle: state === 'open' ? 'dashed' : 'solid',
          borderColor: state === 'open' ? colors.blue : bg,
        }}
      />
      <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut }}>{label}</Text>
    </View>
  );
}

/**
 * The tournament's seating board (play-coaches contracts §5): a top-down court per four places,
 * the net across the middle, two chairs on each side. Before the draw the chairs list the entries
 * in registration order; after it they are round 1's real courts. Every string arrives formatted;
 * the screen decides which chairs a tap may act on (`onOpenChair`, the screen's own Register) and
 * whether it is busy. The tapped chair shows the spinner; the seat a registration gets is simply
 * the next one, which the server's answer then shows.
 */
export function SeatingBoard({
  testID,
  title,
  caption,
  note,
  legend,
  courts,
  ownLine,
  sitOut,
  onOpenChair,
  openHint,
  busy,
  more,
}: {
  testID: string;
  /** "Seating" / "Round 1 courts". */
  title: string;
  /** The format's line ("Americano: partners rotate every round."), or null. */
  caption: string | null;
  /** "Tap an open chair…", "Every chair is taken…", or null. */
  note: string | null;
  legend: { taken: string; mine: string; open: string };
  courts: readonly SeatingCourtView[];
  /** "Your chair is on Court 2.", or null. */
  ownLine: string | null;
  /** Round 1's sit-outs, the draw only. */
  sitOut: {
    title: string;
    players: readonly { key: string; label: string; mine: boolean }[];
  } | null;
  /** Set while an open chair may register (the screen's Register); unset, open chairs only read "Open". */
  onOpenChair?: () => void;
  /** What a reader hears after an open chair's label ("Registers you for this tournament"). */
  openHint?: string;
  busy: boolean;
  /** "Show all courts (16)" / "Show fewer courts", or null when every court shows. */
  more: { label: string; onPress: () => void } | null;
}) {
  const { colors, fonts } = useTheme();
  // The chair whose tap started the work under way; forgotten once the screen is idle again.
  const [tapped, setTapped] = useState<string | null>(null);
  if (!busy && tapped !== null) setTapped(null);
  return (
    <View testID={testID} style={{ gap: space.sm }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}>
          {title}
        </Text>
        {caption ? (
          <Text
            style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.mut }}
          >
            {caption}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, rowGap: 6 }}>
        <LegendItem state="taken" label={legend.taken} />
        <LegendItem state="mine" label={legend.mine} />
        <LegendItem state="open" label={legend.open} />
      </View>
      {ownLine ? (
        <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.gtext }}>
          {ownLine}
        </Text>
      ) : null}
      {courts.map((court, i) => (
        <Rise key={court.no} index={i} style={{ gap: 6 }}>
          <Text style={{ fontFamily: fonts.body800, fontSize: 12.5, color: colors.mut2 }}>
            {court.title}
          </Text>
          <SeatingCourt>
            {court.chairs.map((chair, k) => {
              if (!chair) return null;
              const id = `${testID}.court.${court.no}.chair.${k + 1}`;
              const open = chair.state === 'open' && onOpenChair !== undefined;
              return (
                <SeatingChair
                  key={k}
                  testID={id}
                  place={CHAIR_PLACES[k]!}
                  chair={chair}
                  disabled={busy}
                  pending={busy && tapped === id}
                  hint={open ? openHint : undefined}
                  onPress={
                    open
                      ? () => {
                          setTapped(id);
                          onOpenChair();
                        }
                      : undefined
                  }
                />
              );
            })}
          </SeatingCourt>
        </Rise>
      ))}
      {more ? (
        <Button
          testID={`${testID}.more`}
          label={more.label}
          variant="secondary"
          size="compact"
          onPress={more.onPress}
        />
      ) : null}
      {sitOut && sitOut.players.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: fonts.body800, fontSize: 12.5, color: colors.mut2 }}>
            {sitOut.title}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {sitOut.players.map((p) => (
              <View
                key={p.key}
                style={{
                  backgroundColor: p.mine ? colors.gstrong : colors.sub,
                  borderRadius: radius.pill,
                  paddingStart: 10,
                  paddingEnd: 10,
                  paddingTop: 4,
                  paddingBottom: 4,
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.body700,
                    fontSize: 12,
                    color: p.mine ? colors.card : colors.ink,
                  }}
                >
                  {p.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {note ? (
        <Text
          style={{ fontFamily: fonts.body600, fontSize: 12.5, lineHeight: 18, color: colors.mut }}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}
