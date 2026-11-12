import { View } from 'react-native';
import type { MyLoyalty } from '@touch/core/loyalty';
import { formatNumber, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Hint, MicroLabel } from '../../components/ui';
import { CheckIcon } from '../../components/icons';
import { radius, space, useTheme } from '../../theme';
import { GivesList, TierChip } from './cardParts';
import { givesAnything, ladderPosition, rungGives, tierName } from './logic';

/**
 * The cards (0410): every tier from the base up, each with its colour, its name, where it starts
 * and what it gives of its own. The member's card is marked as theirs on a tinted row, the cards
 * under it read as included (a card holds what every tier below gives), and the cards above show
 * the points still needed.
 *
 * One list with hairlines, like the history under it, not a card per tier. Draws nothing without
 * a ladder (a server before 0410).
 */
export function TierLadder({
  testID,
  loyalty: l,
}: {
  /** `<route>`; the list takes `${testID}.tiers`, a rung `${testID}.tier.<id>`, the mark on the member's own `${testID}.tier-yours`. */
  testID: string;
  loyalty: MyLoyalty;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const { rungs } = ladderPosition(l);
  if (rungs.length === 0) return null;
  const points = (n: number) => isolateLtr(formatNumber(n, locale));

  return (
    <View testID={`${testID}.tiers`} style={{ gap: 7, marginTop: space.s }}>
      <View>
        <MicroLabel>{t('loyalty.guest.ladder.title')}</MicroLabel>
        <Hint>{t('loyalty.guest.tier.window')}</Hint>
      </View>
      <View
        style={{
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
          overflow: 'hidden',
        }}
      >
        {rungs.map(({ tier, state, remaining }, i) => (
          <View
            key={tier.id}
            testID={`${testID}.tier.${tier.id}`}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: space.sm,
              paddingVertical: space.sm,
              paddingHorizontal: space.m,
              backgroundColor: state === 'current' ? colors.tint : undefined,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.line,
            }}
          >
            {/* Level with the name's line. */}
            <View style={{ height: 21, justifyContent: 'center' }}>
              <TierChip color={tier.color} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <Text
                  style={{
                    flex: 1,
                    fontFamily: fonts.body700,
                    fontSize: 15,
                    lineHeight: 21,
                    color: colors.ink,
                  }}
                >
                  {tierName(tier, locale)}
                </Text>
                {state === 'current' ? (
                  <View
                    testID={`${testID}.tier-yours`}
                    style={{
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: colors.gline,
                      backgroundColor: colors.gtint,
                      paddingVertical: 3,
                      paddingHorizontal: 9,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.gtext }}>
                      {t('loyalty.guest.ladder.yours')}
                    </Text>
                  </View>
                ) : state === 'held' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <CheckIcon size={12} color={colors.mut} strokeWidth={2.4} />
                    <Text style={{ fontFamily: fonts.body600, fontSize: 11.5, color: colors.mut }}>
                      {t('loyalty.guest.ladder.included')}
                    </Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                    <Text style={{ fontFamily: fonts.body600, fontSize: 11.5, color: colors.mut }}>
                      {t('loyalty.guest.next.toGo')}
                    </Text>
                    <Text
                      style={{
                        fontFamily: fonts.display800,
                        fontSize: 14,
                        color: colors.ink,
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {points(remaining)}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>
                {tier.min_points_12m > 0
                  ? t('loyalty.guest.ladder.from', { points: points(tier.min_points_12m) })
                  : t('loyalty.guest.ladder.base')}
              </Text>
              {givesAnything(rungGives(tier)) ? (
                <View style={{ marginTop: 3 }}>
                  <GivesList gives={rungGives(tier)} tone="row" />
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
