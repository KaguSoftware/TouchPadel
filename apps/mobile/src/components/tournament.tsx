/**
 * The guest's tournament building blocks (tournaments plan §5.2): a list row, a round of the
 * schedule and the standings table.
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
import { radius, space, useTheme } from '../theme';
import type { MatchCategory } from '../features/matches/logic';
import { CategoryPill } from './match';
import { ChevronIcon } from './icons';

// ── TournamentRow (the list) ────────────────────────────────────────────────

/** One tournament in the list: the category, the name, when and where, the places and the fee, the guest's own state. */
export function TournamentRow({
  testID,
  category,
  title,
  when,
  places,
  fee,
  mine,
  onPress,
}: {
  testID: string;
  category: MatchCategory;
  title: string;
  when: string;
  /** "Places left: 3", "Waitlist open" or "Full". */
  places: string;
  fee: string;
  /** The guest's own state ("Registered", "Number 2 on the waitlist"), or null. */
  mine: string | null;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, when, places, fee, mine].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.sm,
        paddingTop: 12,
        paddingBottom: 12,
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <CategoryPill category={category} />
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.display800, fontSize: 15, color: colors.ink }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>{when}</Text>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.gtext }}>
            {places}
          </Text>
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut2 }}>
            {fee}
          </Text>
        </View>
        {mine ? (
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.blue }}>
            {mine}
          </Text>
        ) : null}
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
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
