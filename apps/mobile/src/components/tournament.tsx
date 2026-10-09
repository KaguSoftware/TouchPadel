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
 * forwards it explicitly; it is in `testIdElements` (packages/config/src/eslint.js).
 * `TournamentRound` and `StandingsTable` render no Pressable.
 */
import { Pressable, View } from 'react-native';
import { Text } from '../i18n/text';
import { palettes, radius, space, useTheme } from '../theme';
import { useLocale } from '../i18n/LocaleProvider';
import { categoryKey, type MatchCategory } from '../features/matches/logic';
import type { TourTone } from '../features/tournaments/logic';
import { CategoryPill } from './match';
import { ChevronIcon, TrophyIcon } from './icons';
import { DashedDivider } from './ui';

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
  const { colors, fonts } = useTheme();
  const accent = tone === 'running' ? colors.gstrong : tone === 'over' ? colors.sub : colors.blue;
  const onAccent = tone === 'over' ? colors.mut : colors.card;
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
            width: 60,
            height: 68,
            borderRadius: radius.cell,
            backgroundColor: accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: onAccent }}>
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
                backgroundColor: tone === 'over' ? colors.fnt3 : accent,
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
  tone,
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
  tone: TourTone;
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
  const { colors: theme, fonts, tracking } = useTheme();
  // The ticket keeps the light palette in both themes (the Figma design): a paper ticket on the
  // page. Only the notches take the page's own colour, so they read as cut out of it.
  const colors = palettes.light;
  const pill =
    tone === 'running'
      ? { bg: colors.tint, fg: colors.blue }
      : tone === 'over'
        ? { bg: colors.sub, fg: colors.mut }
        : { bg: colors.gtint, fg: colors.gtext };
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
        borderWidth: 1,
        borderColor: colors.line,
      }}
    />
  );
  const blocks = max !== null && max > 0 && max <= MAX_PLACE_BLOCKS;
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
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
              backgroundColor: colors.tint,
              borderRadius: radius.pill,
              paddingStart: 10,
              paddingEnd: 10,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.blue }}>
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
            <Text style={{ fontFamily: fonts.display800, fontSize: 22, color: colors.blue }}>
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
