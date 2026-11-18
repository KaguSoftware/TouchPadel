import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { TIER_SWATCH, tierWantsLightInk, type TierColor } from '@touch/core/loyalty';
import { formatNumber, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { CheckIcon, CupIcon, SparkIcon, TagIcon } from '../../components/icons';
import { BrandPattern } from '../../components/BrandPattern';
import { GLASS_SMOKE, brand, radius, tierFinish, useTheme, withAlpha } from '../../theme';
import { tierName, type CardGives } from './logic';

/**
 * A tier's own colour as a ground, and the ink that reads on it (0376: the owner's swatch,
 * `TIER_SWATCH`). The light grounds (white, green, the metals) carry the navy; the blue and the
 * black card carry white (0416). Theme-invariant, like the green CTA: a gold card is gold in both
 * modes.
 */
export function tierGround(color: TierColor): { ground: string; ink: string } {
  return { ground: TIER_SWATCH[color], ink: tierWantsLightInk(color) ? brand.white : brand.navy };
}

/** A member card seen small, in its tier's colour: the mark beside a tier's name. */
export function TierChip({ color, width = 30 }: { color: TierColor; width?: number }) {
  const { ground, ink } = tierGround(color);
  const height = Math.round(width / 1.5);
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={{
        width,
        height,
        borderRadius: Math.round(width / 6),
        backgroundColor: ground,
        borderWidth: 1,
        borderColor: withAlpha(ink, 0.3),
        justifyContent: 'flex-end',
        padding: Math.round(width / 7.5),
      }}
    >
      {/* The card's one printed line, so the shape reads as a card and not a swatch. */}
      <View
        style={{ height: 2, width: '55%', borderRadius: 1, backgroundColor: withAlpha(ink, 0.45) }}
      />
    </View>
  );
}

/**
 * What a card gives, one line each: its points rate, its privileges (free add-ons, the lines
 * staff honour by hand) and the deals it unlocks. `block` is the way-to-the-next-card list, read
 * as the pitch; `row` is the quieter list under a rung of the ladder.
 */
export function GivesList({
  gives,
  tone,
  ink,
}: {
  gives: CardGives;
  tone: 'block' | 'row';
  /** Set when the list sits on a card's own colour: icons and lines take this ink. */
  ink?: string;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const block = tone === 'block';
  const icon = {
    size: block ? 15 : 13,
    color: ink ?? (block ? colors.ink : colors.mut),
    strokeWidth: 2,
  };
  const lines = [
    ...(gives.multiplier !== null
      ? [
          {
            key: 'rate',
            Icon: SparkIcon,
            text: t('loyalty.guest.gives.multiplier', {
              times: isolateLtr(`${formatNumber(gives.multiplier, locale)}×`),
            }),
          },
        ]
      : []),
    ...gives.perks.map((p) => ({
      key: `perk.${p.id}`,
      Icon: p.kind === 'free_addons' ? CupIcon : CheckIcon,
      text: tierName(p, locale),
    })),
    ...gives.deals.map((d) => ({
      key: `deal.${d.id}`,
      Icon: TagIcon,
      text: t('loyalty.guest.gives.deal', { name: isolate(tierName(d, locale)) }),
    })),
  ];
  if (lines.length === 0) return null;
  return (
    <View style={{ gap: block ? 10 : 4 }}>
      {lines.map(({ key, Icon, text }) => (
        <View
          key={key}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: block ? 10 : 6 }}
        >
          {block ? (
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: ink ? withAlpha(ink, 0.14) : colors.tint,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon {...icon} />
            </View>
          ) : (
            // Centred on the first line of the text beside it.
            <View style={{ height: 18, justifyContent: 'center' }}>
              <Icon {...icon} />
            </View>
          )}
          <Text
            style={{
              flex: 1,
              fontFamily: block ? fonts.body700 : fonts.body400,
              fontSize: block ? 14 : 12.5,
              lineHeight: block ? 20 : 18,
              // Level with the icon chip's centre on a one-line privilege.
              marginTop: block ? 3 : 0,
              color: ink ?? (block ? colors.ink : colors.mut),
            }}
          >
            {text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A tier's card face, the same glass the member card is drawn on (PointsCard): the smoke under it,
 * the frost, the tier's colour washed in from the top corner, the glow in its middle, the court
 * lines, the sheen of its face and the cut edge. Fills whatever it is put in; the parent clips it
 * to its own corners and puts the ink (white) on top.
 */
export function TierGlass({ color, idKey }: { color: TierColor; idKey: string }) {
  const { appearance } = useTheme();
  const finish = tierFinish[color] ?? tierFinish.classic;
  const smoke = finish.smoke[appearance];
  const glow = `tierGlow.${idKey}`;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {smoke > 0 ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(GLASS_SMOKE, smoke) }]}
        />
      ) : null}
      <LinearGradient
        colors={[
          withAlpha(brand.white, 0.1),
          withAlpha(brand.white, 0.05),
          withAlpha(brand.white, 0.02),
        ]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[
          withAlpha(finish.tint, 0.5),
          withAlpha(finish.tint, 0.34),
          withAlpha(finish.tint, 0.22),
        ]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={glow} cx="50%" cy="48%" rx="62%" ry="78%">
            <Stop offset="0" stopColor={finish.tint} stopOpacity={0.35} />
            <Stop offset="0.6" stopColor={finish.tint} stopOpacity={0.1} />
            <Stop offset="1" stopColor={finish.tint} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${glow})`} />
      </Svg>
      <BrandPattern opacity={finish.linesAlpha} color={finish.lines} />
      <LinearGradient
        colors={[withAlpha(brand.white, 0.16), withAlpha(brand.white, 0)]}
        locations={[0, 0.5]}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius.sheet, borderWidth: 1, borderColor: finish.rim },
        ]}
      />
    </View>
  );
}
