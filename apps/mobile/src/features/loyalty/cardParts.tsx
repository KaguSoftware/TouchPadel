import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { TIER_SWATCH, tierWantsLightInk, type TierColor, type TierPerk } from '@touch/core/loyalty';
import { countPhrase, formatNumber, isolate, isolateLtr, type Locale } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import {
  CalendarIcon,
  CardUpIcon,
  CheckIcon,
  CourtIcon,
  CupIcon,
  CupPlusIcon,
  GiftIcon,
  SizeUpIcon,
  SparkIcon,
  StampCardIcon,
  TagIcon,
  type IconProps,
} from '../../components/icons';
import { FrameRing } from '../../components/ProfileAvatar';
import { BrandPattern } from '../../components/BrandPattern';
import { GLASS_SMOKE, brand, radius, tierFinish, useTheme, withAlpha } from '../../theme';
import { perkDetail, perkMark, tierName, type CardGives, type PerkMark } from './logic';

type Translate = ReturnType<typeof useLocale>['t'];

/** The small line under a privilege's name (0445), in the guest's language; null when none. */
function detailText(p: TierPerk, t: Translate, locale: Locale): string | null {
  const d = perkDetail(p);
  if (!d) return null;
  if ('days' in d) {
    return t(d.key, { days: d.days ? countPhrase('loyalty.guest.gives.days', d.days, locale) : '' });
  }
  if ('size' in d) return t(d.key, { stamps: countPhrase('loyalty.guest.gives.stamps', d.size, locale) });
  return t(d.key);
}

/**
 * Each privilege's icon (0445): a birthday gift's box, a monthly gift's calendar, a card-up
 * gift's rising card, a free court hour's court, free with, a size up, the drink card; a line the
 * staff honour by hand keeps the tick. A ring draws itself instead (`ring`).
 */
const PERK_ICON: Record<PerkMark, (p: IconProps) => ReactNode> = {
  addons: CupIcon,
  birthday: GiftIcon,
  monthly: CalendarIcon,
  cardUp: CardUpIcon,
  court: CourtIcon,
  freeWith: CupPlusIcon,
  sizeUp: SizeUpIcon,
  stamps: StampCardIcon,
  ring: CheckIcon,
  line: CheckIcon,
};

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
 * staff honour by hand, and since 0445 the birthday gifts, free-withs, the drink card's size and
 * the profile ring) and the deals it unlocks. The owner's name for a privilege is the line; a
 * kind-specific detail sits under it where it helps (`perkDetail`). A ring privilege shows the
 * ring itself in place of an icon. `block` is the way-to-the-next-card list, read as the pitch;
 * `row` is the quieter list under a rung of the ladder.
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
  type Line = { key: string; mark: ReactNode; text: string; detail: string | null; ring: boolean };
  const iconMark = (Icon: (p: IconProps) => ReactNode) => <Icon {...icon} />;
  const lines: Line[] = [
    ...(gives.multiplier !== null
      ? [
          {
            key: 'rate',
            mark: iconMark(SparkIcon),
            text: t('loyalty.guest.gives.multiplier', {
              times: isolateLtr(`${formatNumber(gives.multiplier, locale)}×`),
            }),
            detail: null,
            ring: false,
          },
        ]
      : []),
    ...gives.perks.map((p): Line => {
      const frameId = p.kind === 'frame' && p.config && 'frameId' in p.config ? p.config.frameId : null;
      return {
        key: `perk.${p.id}`,
        mark: frameId ? <FrameRing frame={frameId} size={block ? 26 : 16} /> : iconMark(PERK_ICON[perkMark(p)]),
        text: tierName(p, locale),
        detail: detailText(p, t, locale),
        ring: frameId !== null,
      };
    }),
    ...gives.deals.map((d): Line => ({
      key: `deal.${d.id}`,
      mark: iconMark(TagIcon),
      text: t('loyalty.guest.gives.deal', { name: isolate(tierName(d, locale)) }),
      detail: null,
      ring: false,
    })),
  ];
  if (lines.length === 0) return null;
  return (
    <View style={{ gap: block ? 10 : 4 }}>
      {lines.map(({ key, mark, text, detail, ring }) => (
        <View key={key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: block ? 10 : 6 }}>
          {block ? (
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                // A ring is its own mark: no chip behind it.
                backgroundColor: ring ? undefined : ink ? withAlpha(ink, 0.14) : colors.tint,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {mark}
            </View>
          ) : (
            // Centred on the first line of the text beside it.
            <View style={{ height: 18, justifyContent: 'center' }}>{mark}</View>
          )}
          <View style={{ flex: 1, marginTop: block ? 3 : 0 }}>
            <Text
              style={{
                fontFamily: block ? fonts.body700 : fonts.body400,
                fontSize: block ? 14 : 12.5,
                lineHeight: block ? 20 : 18,
                color: ink ?? (block ? colors.ink : colors.mut),
              }}
            >
              {text}
            </Text>
            {detail ? (
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: block ? 12.5 : 11.5,
                  lineHeight: block ? 17 : 16,
                  color: colors.mut,
                }}
              >
                {detail}
              </Text>
            ) : null}
          </View>
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
