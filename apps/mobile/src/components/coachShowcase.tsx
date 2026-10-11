/**
 * The Coaches tab's showcase pieces (play-coaches contracts §6; Majed,
 * 2026-10-11: "a showcase of coaches ... no coaches are offended").
 *
 *   GlassPlate     the frosted plate that rides up over the court's foot,
 *                  the Book card's glass recipe (BookingSheet `glass`)
 *   ShowcaseCard   one coach: a big photo with the name on it, the kinds
 *                  taught and the from-price. EVERY card is the same size and
 *                  weight: a fixed photo ratio, a fixed info block, one line
 *                  each, so no coach reads as featured. A coach without a
 *                  photo gets the brand blue with the line pattern and their
 *                  initial, a picture as finished as a photo, never a grey hole
 *   ShowcaseLink   a tile to another coaching page (group sessions, My lessons)
 *   LevelPills     the coach page's "Player level" pills (no Pressable)
 *
 * PRESENTATION ONLY: strings arrive translated, the order and the filter were
 * decided in `features/coaching/logic.ts` (`showcaseOrder`, `coachesForLevel`).
 *
 * MOTION: transform and opacity on the native driver, Reduce Motion holds
 * still (the photo parallax drops out and the press does not lean). The glass
 * never sits under an animated opacity: a UIVisualEffectView draws nothing
 * there (BookingSheet's note), so `GlassPlate` is never wrapped in `Rise`.
 *
 * TEST IDS: `ShowcaseCard` and `ShowcaseLink` render a `TiltPress` and take a
 * REQUIRED `testID`, forwarded explicitly. `GlassPlate` and
 * `LevelPills` render no Pressable.
 */
import type { ReactNode } from 'react';
import { Animated, Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../i18n/text';
import { useReduceMotion } from '../lib/useReduceMotion';
import { brand, radius, shadows, space, useTheme, withAlpha } from '../theme';
import { coachInitial, coachPhotoUrl } from '../features/coaching/logic';
import { BrandPattern } from './BrandPattern';
import { ChevronIcon } from './icons';
import { TiltPress } from './motion';

// ── GlassPlate ──────────────────────────────────────────────────────────────

/**
 * The Book card's glass (BookingSheet `glass` / `glassLine`): a blur and the
 * page's own ground at a light alpha, edged in white. It earns the glass the
 * way the Book card does, by sitting over the court. NEVER wrap it in an
 * animated opacity (see the header).
 */
export function GlassPlate({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, appearance } = useTheme();
  const dark = appearance === 'dark';
  return (
    <View
      style={[
        {
          borderRadius: radius.sheet,
          overflow: 'hidden',
          boxShadow: dark ? shadows.sheetDark : shadows.sheet,
        },
        style,
      ]}
    >
      <BlurView
        pointerEvents="none"
        intensity={50}
        tint={dark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: withAlpha(colors.bg, dark ? 0.45 : 0.35),
            borderRadius: radius.sheet,
            borderWidth: 1,
            borderColor: withAlpha(brand.white, dark ? 0.14 : 0.55),
          },
        ]}
      />
      {children}
    </View>
  );
}

// ── ShowcaseCard ────────────────────────────────────────────────────────────

/** Photo height over card width: a portrait frame, the same for everyone. */
export const SHOWCASE_PHOTO_RATIO = 1.22;
/** How far the photo drifts against its frame as the card crosses the screen. */
const PARALLAX = 12;
/** The info block's fixed height: two single lines, so every card matches. */
const INFO_H = 58;

/** The scroll the card's photo drifts with, and where the card sits in it. */
export interface ShowcaseParallax {
  scrollY: Animated.Value;
  /** The card's top in the scroll content, once measured. */
  y: number | null;
  /** The visible height of the scroll view. */
  viewport: number;
}

/**
 * One coach. The whole card opens the coach's page. `width` is the grid's
 * column width (the screen computes one width for every card).
 */
export function ShowcaseCard({
  testID,
  width,
  name,
  photoPath,
  kinds,
  from,
  parallax,
  onPress,
}: {
  testID: string;
  width: number;
  name: string;
  photoPath: string | null;
  /** "Private · Group · Courses", already translated and joined. */
  kinds: string;
  /** "From 30,000 IQD", or null when no offer has a price. */
  from: string | null;
  parallax?: ShowcaseParallax;
  onPress: () => void;
}) {
  const { colors, fonts, appearance } = useTheme();
  const reduce = useReduceMotion();
  const uri = coachPhotoUrl(photoPath);
  const photoH = Math.round(width * SHOWCASE_PHOTO_RATIO);

  const drift =
    !reduce && parallax && parallax.y !== null
      ? parallax.scrollY.interpolate({
          // From the card entering at the bottom to leaving at the top, the
          // picture moves a little slower than its frame: depth, not motion.
          inputRange: [parallax.y - parallax.viewport, parallax.y + photoH],
          outputRange: [-PARALLAX, PARALLAX],
          extrapolate: 'clamp',
        })
      : 0;

  return (
    <TiltPress
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[name, kinds, from].filter(Boolean).join(', ')}
      style={{
        width,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        overflow: 'hidden',
        boxShadow: appearance === 'dark' ? undefined : shadows.card,
      }}
    >
      <View style={{ height: photoH, overflow: 'hidden', backgroundColor: brand.blue }}>
        {uri ? (
          <Animated.View
            style={{
              position: 'absolute',
              start: 0,
              end: 0,
              top: -PARALLAX,
              height: photoH + PARALLAX * 2,
              transform: [{ translateY: drift }],
            }}
          >
            <Image
              source={{ uri }}
              accessibilityIgnoresInvertColors
              resizeMode="cover"
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : (
          <>
            <BrandPattern color={brand.white} opacity={0.16} />
            <View
              style={[
                StyleSheet.absoluteFill,
                { alignItems: 'center', justifyContent: 'center', paddingBottom: photoH * 0.18 },
              ]}
            >
              <Text
                style={{
                  fontFamily: fonts.display900,
                  fontSize: Math.round(width * 0.42),
                  color: brand.green,
                }}
              >
                {coachInitial(name)}
              </Text>
            </View>
          </>
        )}
        {/* The name sits on the picture over a navy scrim, so it reads on any
            photo and the same on the photo-less card. */}
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(brand.navy, 0), withAlpha(brand.navy, 0.82)]}
          style={{ position: 'absolute', start: 0, end: 0, bottom: 0, height: photoH * 0.5 }}
        />
        <View
          style={{
            position: 'absolute',
            start: space.sm,
            end: space.sm,
            bottom: space.sm,
          }}
        >
          <Text
            numberOfLines={2}
            style={{
              fontFamily: fonts.display800,
              fontSize: 17,
              lineHeight: 21,
              color: brand.white,
            }}
          >
            {name}
          </Text>
        </View>
      </View>
      <View
        style={{
          height: INFO_H,
          paddingStart: space.sm,
          paddingEnd: space.sm,
          justifyContent: 'center',
          gap: 3,
        }}
      >
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.body600, fontSize: 12, lineHeight: 17, color: colors.mut }}
        >
          {kinds || ' '}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.display800,
            fontSize: 13,
            lineHeight: 18,
            color: colors.gtext,
          }}
        >
          {from ?? ' '}
        </Text>
      </View>
    </TiltPress>
  );
}

// ── ShowcaseLink ────────────────────────────────────────────────────────────

/** A tile to another coaching page: an icon disc, a title, one line, a chevron. */
export function ShowcaseLink({
  testID,
  icon,
  title,
  sub,
  onPress,
}: {
  testID: string;
  icon: ReactNode;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <TiltPress
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${sub}`}
      style={{
        minHeight: 96,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        padding: space.m,
        gap: space.s,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.gtint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </View>
        <ChevronIcon size={16} color={colors.fnt} />
      </View>
      <View style={{ gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.display800, fontSize: 14, lineHeight: 19, color: colors.ink }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 17, color: colors.mut }}
        >
          {sub}
        </Text>
      </View>
    </TiltPress>
  );
}

// ── LevelPills (the coach page) ─────────────────────────────────────────────

/** "Player level: Beginner · Intermediate" as quiet pills, centred under the name. */
export function LevelPills({ title, labels }: { title: string; labels: string[] }) {
  const { colors, fonts } = useTheme();
  if (labels.length === 0) return null;
  return (
    <View
      accessible
      accessibilityLabel={`${title}: ${labels.join(', ')}`}
      style={{ alignItems: 'center', gap: 6 }}
    >
      <Text style={{ fontFamily: fonts.body600, fontSize: 11.5, color: colors.fnt }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
        {labels.map((l) => (
          <View
            key={l}
            style={{
              backgroundColor: colors.tint,
              borderRadius: radius.pill,
              paddingStart: 10,
              paddingEnd: 10,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.blue }}>{l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
