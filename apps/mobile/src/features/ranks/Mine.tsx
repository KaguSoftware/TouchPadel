import { Pressable, View } from 'react-native';
import { countPhrase, formatDateTime, formatNumber, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Button, MicroLabel } from '../../components/ui';
import { ChevronIcon } from '../../components/icons';
import { brand, radius, space, useTheme } from '../../theme';
import {
  levelName,
  levelProgress,
  playerLabel,
  type MyRanks,
  type MyResult,
  type ResultPlayer,
  type ToReport,
} from './logic';

type Mine = Extract<MyRanks, { enabled: true }>;

/**
 * The guest's own standing, under the board (Majed: "saved in the user's profile, so they can
 * see how many points they have and how high they are"). Their place in the period, theirs alone
 * (a place below the board is never shown to anyone else), the points behind it, and the level
 * their lifetime points reach with the way to the next one as one thin line.
 */
export function YourPlace({ mine, testID }: { mine: Mine; testID?: string }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const level = levelName(mine.level, locale);
  const next = levelName(mine.nextLevel, locale);
  const { fraction, toNext } = levelProgress(mine.lifetime, mine.level, mine.nextLevel);
  return (
    <View testID={testID} style={{ gap: space.sm }}>
      <MicroLabel>{t('ranks.me.place')}</MicroLabel>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        {mine.rank !== null ? (
          <Text
            style={{
              fontFamily: fonts.display100,
              fontSize: 52,
              lineHeight: 56,
              color: colors.blue,
              fontVariant: ['tabular-nums'],
            }}
          >
            {isolateLtr(`#${mine.rank}`)}
          </Text>
        ) : null}
        <View style={{ flex: 1, paddingBottom: mine.rank !== null ? 8 : 0, gap: 2 }}>
          <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.ink }}>
            {mine.rank !== null ? countPhrase('ranks.me.points', mine.points, locale) : t('ranks.me.unranked')}
          </Text>
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
            {t(`ranks.period.${mine.period}`)}
          </Text>
        </View>
      </View>
      {mine.rank !== null && mine.rank > mine.size ? (
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut }}>
          {t('ranks.me.outsideBoard', { size: isolateLtr(String(mine.size)) })}
        </Text>
      ) : null}

      {/* The level: its name, the line to the next, what is left. */}
      <View style={{ gap: 6, marginTop: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
          <Text style={{ flex: 1, fontFamily: fonts.display800, fontSize: 14, color: colors.ink }}>
            {level ?? ''}
          </Text>
          <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>
            {toNext === null || !next ? t('ranks.me.topLevel') : t('ranks.me.next', { level: isolate(next) })}
          </Text>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
          style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.line, overflow: 'hidden' }}
        >
          <View
            style={{
              width: `${Math.round(fraction * 100)}%`,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: brand.green,
            }}
          />
        </View>
        <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.fnt }}>
          {toNext !== null ? `${countPhrase('ranks.me.toGo', toNext, locale)} · ` : ''}
          {t('ranks.me.lifetime', { points: isolateLtr(formatNumber(mine.lifetime, locale)) })}
        </Text>
      </View>
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
export function ResultRow({ result, testID }: { result: MyResult; testID?: string }) {
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
      {counted ? (
        <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.gstrong, fontVariant: ['tabular-nums'] }}>
          {isolateLtr(`${result.points >= 0 ? '+' : ''}${formatNumber(result.points, locale)}`)}
        </Text>
      ) : (
        <Text style={{ maxWidth: 120, fontFamily: fonts.body600, fontSize: 11.5, color: colors.fnt }}>
          {t(`ranks.status.${result.status as Exclude<MyResult['status'], 'confirmed'>}`)}
        </Text>
      )}
    </View>
  );
}
