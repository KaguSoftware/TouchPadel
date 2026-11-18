import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { LadderTier, MyLoyalty } from '@touch/core/loyalty';
import { formatNumber, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Hint, MicroLabel } from '../../components/ui';
import { CheckIcon } from '../../components/icons';
import { brand, radius, space, useTheme, withAlpha } from '../../theme';
import { GivesList, TierGlass, tierGround } from './cardParts';
import { givesAnything, ladderPosition, rungGives, tierName, tierProgress } from './logic';

/**
 * The way to the next card and every card, as one block (0410; Majed, 2026-11-12: "how many
 * points till you reach the next tier and what the next tier gives ... flex them so people want
 * the next tier"; 2026-11-15: the next card's "what you get" and "The cards" are one part).
 *
 * The head wears the NEXT card's own colour, edge to edge, so the block reads as that card held
 * out: its name, the points still to go, and a bar from the current card's threshold to its own.
 * Under it, on the page's card ground, the cards from the base up, one row each with hairlines:
 * the member's own on a tint, the ones under it included, the ones above with the points they
 * still need. The next card's row is the pitch: what it gives is listed in full, its points rate
 * when above the member's.
 *
 * At the top card the head wears the member's own colour and says so; the rows under it read as
 * included, so the list is everything the card holds.
 *
 * Every figure is the server's: `next_tier` and `points_12m` from `my_loyalty`, the cards from its
 * ladder. With no ladder (a server before 0410) the head still draws and the body is only what the
 * next card gives (its points rate). Draws nothing when the answer names no tier at all.
 */
/** Space between two cards in the row; the next one peeks in by this much more than a gutter. */
const SLIDE_GAP = 12;

export function NextCardBlock({
  testID,
  route,
  loyalty: l,
}: {
  /** The block; the head's parts take `${testID}.name|remaining|progress`, the next card's list `${testID}.gives`. */
  testID: string;
  /** The rows: the list takes `${route}.tiers`, a row `${route}.tier.<id>`, the member's mark `${route}.tier-yours`. */
  route: string;
  loyalty: MyLoyalty;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const points = (n: number) => isolateLtr(formatNumber(n, locale));
  // A card is most of the row's width, so the next one shows at its edge and says "swipe".
  const [rowW, setRowW] = useState(0);
  const slideW = rowW > 0 ? Math.round((rowW - space.l * 2) * 0.82) : 260;

  const position = ladderPosition(l);
  const progress = tierProgress(l);
  const next = l.next_tier;
  const shown = next ?? l.tier;
  if (!shown) return null;

  const { ground, ink } = tierGround(shown.color);
  const name = tierName(shown, locale);
  const myRate = l.tier?.multiplier ?? 1;
  // What the next card gives, over the member's own rate. Without a ladder only its rate is known.
  const nextGives = (rung: LadderTier | undefined) =>
    next ? rungGives(rung ?? { ...next, perks: [], deals: [] }, myRate) : null;

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

      {position.rungs.length > 0 ? (
        <View testID={`${route}.tiers`}>
          <View
            style={{ paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.xs }}
          >
            <MicroLabel>{t('loyalty.guest.ladder.title')}</MicroLabel>
          </View>
          {/* The cards, side by side: swipe to the next, the one after it peeking in. Each is
              that card in its own colour: its name, where it starts, what it gives. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={slideW + SLIDE_GAP}
            snapToAlignment="start"
            contentContainerStyle={{
              paddingHorizontal: space.l,
              paddingVertical: space.sm,
              gap: SLIDE_GAP,
            }}
            onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
          >
            {position.rungs.map(({ tier, state, remaining }) => {
              const isNext = next !== null && tier.id === next.id;
              const gives = isNext ? nextGives(tier) : rungGives(tier);
              // The member card's own glass and its white ink, not a flat swatch.
              const ti = brand.white;
              const tg = brand.navy;
              return (
                <View
                  key={tier.id}
                  testID={`${route}.tier.${tier.id}`}
                  style={{
                    width: slideW,
                    borderRadius: radius.sheet,
                    overflow: 'hidden',
                    padding: space.m,
                    gap: space.sm,
                  }}
                >
                  <TierGlass color={tier.color} idKey={tier.id} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        fontFamily: fonts.display900,
                        fontSize: 24,
                        lineHeight: 30,
                        color: ti,
                      }}
                    >
                      {tierName(tier, locale)}
                    </Text>
                    {state === 'current' ? (
                      <View
                        testID={`${route}.tier-yours`}
                        style={{
                          borderRadius: radius.pill,
                          backgroundColor: ti,
                          paddingVertical: 3,
                          paddingHorizontal: 10,
                        }}
                      >
                        <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: tg }}>
                          {t('loyalty.guest.ladder.yours')}
                        </Text>
                      </View>
                    ) : state === 'held' ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <CheckIcon size={12} color={ti} strokeWidth={2.4} />
                        <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: ti }}>
                          {t('loyalty.guest.ladder.included')}
                        </Text>
                      </View>
                    ) : isNext ? null : (
                      // The next card's points to go are the head's big figure; the cards past it say theirs here.
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                        <Text style={{ fontFamily: fonts.body600, fontSize: 11.5, color: ti }}>
                          {t('loyalty.guest.next.toGo')}
                        </Text>
                        <Text
                          style={{
                            fontFamily: fonts.display800,
                            fontSize: 14,
                            color: ti,
                            fontVariant: ['tabular-nums'],
                          }}
                        >
                          {points(remaining)}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={{ fontFamily: fonts.body700, fontSize: 14, lineHeight: 20, color: ti }}
                  >
                    {tier.min_points_12m > 0
                      ? t('loyalty.guest.ladder.from', { points: points(tier.min_points_12m) })
                      : t('loyalty.guest.ladder.base')}
                  </Text>
                  {gives && givesAnything(gives) ? (
                    isNext ? (
                      <View
                        testID={`${testID}.gives`}
                        style={{ marginTop: space.xs, gap: space.sm }}
                      >
                        <MicroLabel style={{ color: ti }}>
                          {t('loyalty.guest.next.gives', { tier: isolate(name) })}
                        </MicroLabel>
                        <GivesList gives={gives} tone="block" ink={ti} />
                      </View>
                    ) : (
                      <View style={{ marginTop: space.xs }}>
                        <GivesList gives={gives} tone="block" ink={ti} />
                      </View>
                    )
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          <View style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
            <Hint>{t('loyalty.guest.tier.window')}</Hint>
          </View>
        </View>
      ) : (
        // A server before 0410: no ladder, only what the next card gives (its points rate).
        (() => {
          const gives = nextGives(undefined);
          return gives && givesAnything(gives) ? (
            <View testID={`${testID}.gives`} style={{ padding: space.l, gap: space.sm }}>
              <MicroLabel>{t('loyalty.guest.next.gives', { tier: isolate(name) })}</MicroLabel>
              <GivesList gives={gives} tone="block" />
            </View>
          ) : null;
        })()
      )}
    </View>
  );
}
