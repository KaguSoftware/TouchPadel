import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { countPhrase, formatDateTime, formatNumber, isolate, isolateLtr, type Locale } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Button, MicroLabel } from '../../components/ui';
import { ChevronIcon } from '../../components/icons';
import { brand, radius, space, useTheme } from '../../theme';
import { ClassBadge } from './Board';
import {
  boostFactor,
  formatFactor,
  formatLevel,
  formatLevelChange,
  higherThanLine,
  historyPath,
  levelName,
  myType,
  playerLabel,
  reliability,
  tierProgress,
  type MyRanks,
  type MyResult,
  type MyTouch,
  type PublicRules,
  type ResultPlayer,
  type ToReport,
} from './logic';

type Mine = Extract<MyRanks, { enabled: true }>;

const SPARK_W = 120;
const SPARK_H = 30;

/** The last games' levels as one thin line (react-native-svg), drawn only with two or more. */
function LevelHistory({ history }: { history: MyTouch['history'] }) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const d = historyPath(history, SPARK_W, SPARK_H);
  if (!d) return null;
  return (
    <View
      accessible
      accessibilityLabel={t('ranks.touch.history', { count: formatNumber(history.length, locale) })}
      style={{ width: SPARK_W, height: SPARK_H }}
    >
      {/* SVG coordinates are physical: time runs left to right in both languages, as a chart does. */}
      <Svg width={SPARK_W} height={SPARK_H}>
        <Path d={d} stroke={colors.blue} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/** "Play 3 more games against 2 more players …", or the line for where they stand. */
function reliabilityText(touch: MyTouch, t: ReturnType<typeof useLocale>['t'], locale: Locale): string | null {
  const r = reliability(touch);
  switch (r.kind) {
    case 'reliable':
      return touch.rank !== null ? t('ranks.touch.rank', { rank: isolateLtr(String(touch.rank)) }) : null;
    case 'needs': {
      const games = countPhrase('ranks.count.moreGames', r.games, locale);
      const players = countPhrase('ranks.count.morePlayers', r.players, locale);
      const line =
        r.games > 0 && r.players > 0
          ? t('ranks.touch.needsBoth', { games, players })
          : r.games > 0
            ? t('ranks.touch.needsGames', { games })
            : t('ranks.touch.needsPlayers', { players });
      return `${line} ${t('ranks.touch.window', { days: isolateLtr(String(r.days)) })}`;
    }
    case 'provisional':
      return countPhrase('ranks.touch.untilBoard', r.games, locale);
    case 'inactive':
      return t('ranks.touch.inactive');
  }
}

/**
 * The guest's Touch Level (0444), under the board: the number big (always theirs to see, even
 * while the boards hide it), the tier with the way to the next one, the class, "higher than X%
 * of players", where they stand against the Touch Level board's gate, and the last games' levels
 * as a line. No neighbours' names (Majed, 2026-11-13).
 */
export function MyLevel({
  touch,
  onChangeType,
  testID,
}: {
  touch: MyTouch;
  /** Opens the type picker; offered only while `touch.canChangeType`. */
  onChangeType?: () => void;
  testID?: string;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const tier = levelName(touch.tier, locale);
  const next = levelName(touch.nextTier, locale);
  const fraction = tierProgress(touch.level, touch.tier, touch.nextTier);
  const pct = higherThanLine(touch);
  const standing = touch.rated ? reliabilityText(touch, t, locale) : t('ranks.touch.notRated');
  const showProvisional = touch.provisionalLeft > 0 && reliability(touch).kind !== 'provisional';
  return (
    <View testID={testID} style={{ gap: space.sm }}>
      <MicroLabel>{t('ranks.touch.title')}</MicroLabel>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.m }}>
        <Text
          testID={testID ? `${testID}.level` : undefined}
          style={{ fontFamily: fonts.display100, fontSize: 56, lineHeight: 60, color: colors.blue, fontVariant: ['tabular-nums'] }}
        >
          {isolateLtr(formatLevel(touch.level))}
        </Text>
        <View style={{ flex: 1, paddingBottom: 8, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}>
            {tier ? <Text style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}>{tier}</Text> : null}
            {touch.klass ? <ClassBadge klass={touch.klass} label={t(`ranks.class.${touch.klass}`)} /> : null}
          </View>
          <LevelHistory history={touch.history} />
        </View>
      </View>

      {/* The tier: the line to the next, what is left. */}
      <View style={{ gap: 6 }}>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
          style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.line, overflow: 'hidden' }}
        >
          <View style={{ width: `${Math.round(fraction * 100)}%`, height: 4, borderRadius: radius.pill, backgroundColor: brand.green }} />
        </View>
        <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
          {next && touch.toNext !== null
            ? t('ranks.touch.toNext', { gap: isolateLtr(formatLevel(Math.max(touch.toNext, 0.1))), tier: isolate(next) })
            : t('ranks.touch.topTier')}
        </Text>
      </View>

      {pct !== null ? (
        <Text testID={testID ? `${testID}.higher` : undefined} style={{ fontFamily: fonts.body700, fontSize: 14.5, lineHeight: 21, color: colors.ink }}>
          {t('ranks.touch.higherThan', { pct: isolateLtr(String(pct)) })}
        </Text>
      ) : null}
      {standing ? (
        <Text testID={testID ? `${testID}.standing` : undefined} style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 }}>
          {standing}
        </Text>
      ) : null}
      {showProvisional ? (
        <Text style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 18, color: colors.fnt }}>
          {countPhrase('ranks.touch.provisional', touch.provisionalLeft, locale)}
        </Text>
      ) : null}
      <TypeLine touch={touch} onChange={onChangeType} testID={testID ? `${testID}.type` : 'ranks.me.type'} />
    </View>
  );
}

/**
 * "Your type: Type B" and who set it (0444, Majed 2026-11-16): the player picks it themself and
 * it counts; once the desk or a coach has checked them, or after their first games, it is set
 * and only staff change it. Change opens the picker while the server says it is still open.
 */
function TypeLine({ touch, onChange, testID }: { touch: MyTouch; onChange?: () => void; testID: string }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const mt = myType(touch);
  const who =
    mt.source === 'check'
      ? mt.role
        ? t('ranks.myType.checked', { by: t(`coaching.coach.level.by.${mt.role}`) })
        : null
      : mt.source === 'self'
        ? t('ranks.myType.self')
        : null;
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        marginTop: space.xs,
        paddingTop: space.sm,
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text testID={`${testID}.value`} style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
          {mt.type ? t('ranks.myType.line', { type: t(`coaching.coach.level.type.${mt.type}`) }) : t('ranks.myType.none')}
        </Text>
        {who ? <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut2 }}>{who}</Text> : null}
        {!touch.canChangeType ? (
          <Text testID={`${testID}.locked`} style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.fnt }}>
            {t('ranks.myType.locked')}
          </Text>
        ) : null}
      </View>
      {touch.canChangeType && onChange ? (
        <Pressable
          testID={`${testID}.change`}
          accessibilityRole="button"
          onPress={onChange}
          hitSlop={6}
          style={({ pressed }) => ({
            paddingStart: 12,
            paddingEnd: 12,
            paddingTop: 7,
            paddingBottom: 7,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.line2,
            backgroundColor: pressed ? colors.sub : colors.card,
          })}
        >
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.blue }}>
            {t(mt.type ? 'ranks.myType.change' : 'ranks.myType.pick')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The guest's place in the Season Race (0444; 0364's "your place"): their rank this season,
 * theirs alone (a place below the board is never shown to anyone else), the points behind it,
 * how many games counted of how many played, tournaments and the boosts used. An older server
 * sends no `race`: the rank and points then come from 0364's keys.
 */
export function MyRaceCard({ mine, testID }: { mine: Mine; testID?: string }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const race = mine.race;
  const rank = race ? race.rank : mine.rank;
  const points = race ? race.points : mine.points;
  const line = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut2 } as const;
  return (
    <View testID={testID} style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <MicroLabel>{t('ranks.race.title')}</MicroLabel>
        <MicroLabel style={{ color: colors.blue }}>{t(`ranks.period.${mine.period}`)}</MicroLabel>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        {rank !== null ? (
          <Text style={{ fontFamily: fonts.display100, fontSize: 44, lineHeight: 48, color: colors.blue, fontVariant: ['tabular-nums'] }}>
            {isolateLtr(`#${rank}`)}
          </Text>
        ) : null}
        <View style={{ flex: 1, paddingBottom: rank !== null ? 6 : 0 }}>
          <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.ink }}>
            {rank !== null ? countPhrase('ranks.me.points', points, locale) : t('ranks.me.unranked')}
          </Text>
        </View>
      </View>
      {rank !== null && rank > mine.size ? (
        <Text style={line}>{t('ranks.me.outsideBoard', { size: isolateLtr(String(mine.size)) })}</Text>
      ) : null}
      {race ? (
        <View style={{ gap: 2 }}>
          <Text testID={testID ? `${testID}.counted` : undefined} style={line}>
            {t('ranks.race.counted', {
              counted: isolateLtr(String(race.matchesCounted)),
              matches: isolateLtr(String(race.matches)),
              best: isolateLtr(String(race.bestMatches)),
            })}
          </Text>
          {race.tournaments > 0 ? (
            <Text style={line}>
              {t('ranks.race.tournaments', {
                count: isolateLtr(String(race.tournaments)),
                best: isolateLtr(String(race.bestTournaments)),
              })}
            </Text>
          ) : null}
          {race.boostsMax > 0 ? (
            <Text style={line}>
              {t('ranks.race.boosts', { used: isolateLtr(String(race.boostsUsed)), max: isolateLtr(String(race.boostsMax)) })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** "Sara M. & Ali K." from a side's two seats; an empty seat is left out, a nameless one "Player". */
function sideNames(side: readonly (ResultPlayer | null)[], t: ReturnType<typeof useLocale>['t']): string {
  const names = side
    .filter((p): p is ResultPlayer => p !== null)
    .map((p) => isolate(playerLabel(p) ?? t('ranks.player')));
  if (names.length === 2) return t('ranks.results.and', { a: names[0]!, b: names[1]! });
  return names[0] ?? t('ranks.player');
}

/** "Lost · 6-4, 6-3": the outcome from the guest's side, and the score when there is one. */
function OutcomeLine({ result }: { result: MyResult }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const tone =
    result.outcome === 'won' ? colors.gstrong : result.outcome === 'draw' ? colors.mut2 : colors.ink;
  return (
    <Text style={{ fontFamily: fonts.display800, fontSize: 15, color: tone }}>
      {t(`ranks.outcome.${result.outcome}`)}
      {result.score ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 14, color: colors.mut2 }}>
          {`  ${isolateLtr(result.score)}`}
        </Text>
      ) : null}
    </Text>
  );
}

/**
 * A score an opponent reported, waiting on this guest: what it says from their side, who said it,
 * and the two answers. Nothing counts until one of them says yes.
 */
export function WaitingCard({
  result,
  onAnswer,
  busy,
  testID,
}: {
  result: MyResult;
  onAnswer: (accept: boolean) => void;
  busy: boolean;
  testID: string;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.gline,
        borderRadius: radius.card,
        padding: space.l,
        gap: space.s,
      }}
    >
      <MicroLabel style={{ color: colors.gtext }}>{t('ranks.waiting.title')}</MicroLabel>
      <OutcomeLine result={result} />
      <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 }}>
        {t('ranks.waiting.by', { names: sideNames(result.them, t) })}
        {' · '}
        {formatDateTime(new Date(result.playedAt), locale)}
      </Text>
      {result.expiresAt ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.fnt }}>
          {t('ranks.waiting.answerBy', { time: formatDateTime(new Date(result.expiresAt), locale) })}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.xs }}>
        <Button
          testID={`${testID}.no`}
          label={t('ranks.waiting.no')}
          variant="secondary"
          size="compact"
          disabled={busy}
          onPress={() => onAnswer(false)}
          style={{ flex: 1 }}
        />
        <Button
          testID={`${testID}.yes`}
          label={t('ranks.waiting.yes')}
          variant="cta"
          size="compact"
          busy={busy}
          disabled={busy}
          onPress={() => onAnswer(true)}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

/** One of the guest's played bookings with no score yet: where and when, and the way to add it. */
export function ToReportRow({
  item,
  onPress,
  testID,
}: {
  item: ToReport;
  onPress: () => void;
  testID: string;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const court = locale === 'ar' ? item.courtAr : item.courtEn;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: 13,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.body700, fontSize: 14.5, color: colors.ink }}>
          {court ? `${court} · ` : ''}
          {formatDateTime(new Date(item.startAt), locale)}
        </Text>
        <Text style={{ fontFamily: fonts.body800, fontSize: 12.5, color: colors.blue }}>
          {t('ranks.toReport.action')}
        </Text>
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

/** One of the guest's games: outcome and score, who with and against, what it gave or where it stands. */
export function ResultRow({
  result,
  rules = null,
  testID,
}: {
  result: MyResult;
  /** The rules in force, for the boost's size; null from an older server. */
  rules?: PublicRules | null;
  testID?: string;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const partner = result.us.find((p) => p !== null && !p.me) ?? null;
  const counted = result.status === 'confirmed';
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 12 }}>
      <View style={{ flex: 1, gap: 3 }}>
        <OutcomeLine result={result} />
        <Text numberOfLines={2} style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut2 }}>
          {partner ? `${t('ranks.results.with', { name: isolate(playerLabel(partner) ?? t('ranks.player')) })} · ` : ''}
          {t('ranks.results.vs', { names: sideNames(result.them, t) })}
        </Text>
        <Text style={{ fontFamily: fonts.body600, fontSize: 11.5, color: colors.fnt }}>
          {result.source !== 'player' ? `${t(`ranks.source.${result.source}`)} · ` : ''}
          {formatDateTime(new Date(result.playedAt), locale)}
        </Text>
      </View>
      {counted ? <ResultGain result={result} rules={rules} testID={testID ? `${testID}.gain` : undefined} /> : (
        <Text style={{ maxWidth: 120, fontFamily: fonts.body600, fontSize: 11.5, color: colors.fnt }}>
          {t(`ranks.status.${result.status as Exclude<MyResult['status'], 'confirmed'>}`)}
        </Text>
      )}
    </View>
  );
}

/**
 * What a confirmed game gave (0444): its Race points, the level change under them (+0.12 green,
 * a fall or none in a neutral tone, never red), and a small badge when a boost was on it, with
 * its size from the rules ("Off-peak ×1.5") when the read sends them.
 */
function ResultGain({ result, rules, testID }: { result: MyResult; rules: PublicRules | null; testID?: string }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const factor = result.boost ? boostFactor(result.boost, rules) : null;
  const change = result.levelChange === null ? null : formatLevelChange(result.levelChange);
  return (
    <View testID={testID} style={{ alignItems: 'flex-end', gap: 3, maxWidth: 140 }}>
      <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] }}>
        {isolateLtr(`${result.points >= 0 ? '+' : ''}${formatNumber(result.points, locale)}`)}
        <Text style={{ fontFamily: fonts.body600, fontSize: 11, color: colors.fnt }}>{` ${t('ranks.unit')}`}</Text>
      </Text>
      {change ? (
        <Text
          accessibilityLabel={t('ranks.levelChange', { change: change.text })}
          style={{
            fontFamily: fonts.body700,
            fontSize: 12.5,
            fontVariant: ['tabular-nums'],
            color: change.tone === 'up' ? colors.gstrong : change.tone === 'down' ? colors.mut2 : colors.fnt,
          }}
        >
          {isolateLtr(change.text)}
        </Text>
      ) : null}
      {result.boost ? (
        <View
          style={{
            paddingStart: 7,
            paddingEnd: 7,
            paddingTop: 2,
            paddingBottom: 2,
            borderRadius: radius.pill,
            backgroundColor: colors.gtint,
          }}
        >
          <Text numberOfLines={1} style={{ fontFamily: fonts.body700, fontSize: 10.5, color: colors.gtext }}>
            {factor !== null
              ? t(`ranks.boostSized.${result.boost}`, { x: isolateLtr(formatFactor(factor)) })
              : t(`ranks.boost.${result.boost}`)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
