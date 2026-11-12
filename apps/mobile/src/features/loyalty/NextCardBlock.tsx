import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { LadderTier, MyLoyalty } from '@touch/core/loyalty';
import { formatNumber, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Hint, MicroLabel } from '../../components/ui';
import { brand, space, useTheme, withAlpha } from '../../theme';
import { GivesList, tierGround } from './cardParts';
import {
  cardHolds,
  givesAnything,
  ladderPosition,
  rungGives,
  tierName,
  tierProgress,
} from './logic';

/**
 * The way to the next card (0410; Majed, 2026-11-12: "how many points till you reach the next
 * tier and what the next tier gives ... flex them so people want the next tier").
 *
 * The head wears the NEXT card's own colour, edge to edge, so the block reads as that card held
 * out: its name, the points still to go, and a bar from the current card's threshold to its own.
 * Under it, on the page's card ground, what that card adds: its points rate when above the
 * member's, its privileges and the deals it unlocks.
 *
 * At the top card the head wears the member's own colour and says so, and the list is everything
 * the card holds (its own tier's privileges and those of every tier below).
 *
 * Every figure is the server's: `next_tier` and `points_12m` from `my_loyalty`, the privileges
 * from its ladder. With no ladder (a server before 0410) the head still draws and the list is
 * only the points rate. Draws nothing when the answer names no tier at all.
 */
export function NextCardBlock({ testID, loyalty: l }: { testID: string; loyalty: MyLoyalty }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const points = (n: number) => isolateLtr(formatNumber(n, locale));

  const position = ladderPosition(l);
  const progress = tierProgress(l);
  const next = l.next_tier;
  const shown = next ?? l.tier;
  if (!shown) return null;

  const { ground, ink } = tierGround(shown.color);
  const holds = cardHolds(position);
  const gives = (() => {
    if (!next) return holds;
    const rung: LadderTier = position.rungs.find((r) => r.tier.id === next.id)?.tier ?? {
      ...next,
      perks: [],
      deals: [],
    };
    return rungGives(rung, l.tier?.multiplier ?? 1);
  })();
  const name = tierName(shown, locale);

  return (
    <View
      testID={testID}
      style={{
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.card,
      }}
    >
      <View style={{ backgroundColor: ground, padding: space.l, gap: space.sm }}>
        {/* The light a card catches across its face, as the points card above has. */}
        <LinearGradient
          colors={[withAlpha(brand.white, 0.3), withAlpha(brand.white, 0)]}
          locations={[0, 0.6]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
          <View style={{ flex: 1, gap: 2 }}>
            <MicroLabel style={{ color: ink }}>
              {t(next ? 'loyalty.guest.next.label' : 'loyalty.guest.next.topLabel')}
            </MicroLabel>
            <Text
              testID={`${testID}.name`}
              numberOfLines={2}
              style={{ fontFamily: fonts.display900, fontSize: 28, lineHeight: 34, color: ink }}
            >
              {name}
            </Text>
          </View>
          {next && progress ? (
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <MicroLabel style={{ color: ink }}>{t('loyalty.guest.next.toGo')}</MicroLabel>
              <Text
                testID={`${testID}.remaining`}
                style={{
                  fontFamily: fonts.display900,
                  fontSize: 28,
                  lineHeight: 34,
                  color: ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {points(progress.remaining)}
              </Text>
            </View>
          ) : null}
        </View>
        {next && progress ? (
          <View style={{ gap: 6 }}>
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t('loyalty.guest.next.counted')}
              accessibilityValue={{
                min: 0,
                max: next.min_points_12m,
                now: Math.max(0, Math.min(l.points_12m, next.min_points_12m)),
              }}
              style={{
                height: 10,
                borderRadius: 5,
                backgroundColor: withAlpha(ink, 0.18),
                overflow: 'hidden',
              }}
            >
              <View
                testID={`${testID}.progress`}
                style={{
                  height: 10,
                  // A sliver even at zero, so the bar reads as a bar that has a start.
                  width: `${Math.max(3, Math.round(progress.fraction * 100))}%`,
                  borderRadius: 5,
                  backgroundColor: ink,
                }}
              />
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: space.s,
              }}
            >
              <Text style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 12, color: ink }}>
                {t('loyalty.guest.next.counted')}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 12,
                  color: ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {points(l.points_12m)} / {points(next.min_points_12m)}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={{ fontFamily: fonts.body700, fontSize: 13, lineHeight: 19, color: ink }}>
            {t('loyalty.guest.next.top')}
          </Text>
        )}
      </View>
      {givesAnything(gives) ? (
        <View testID={`${testID}.gives`} style={{ padding: space.l, gap: space.sm }}>
          <MicroLabel>
            {next
              ? t('loyalty.guest.next.gives', { tier: isolate(name) })
              : t('loyalty.guest.next.holds')}
          </MicroLabel>
          <GivesList gives={gives} tone="block" />
          {next && givesAnything(holds) ? (
            <Hint style={{ marginTop: 0 }}>{t('loyalty.guest.next.keeps')}</Hint>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
