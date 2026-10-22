import { useCallback, useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { MyLoyalty } from '@touch/core/loyalty';
import { formatIQD, formatNumber, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { LtrIsland } from '../../i18n/direction';
import { BrandPattern } from '../../components/BrandPattern';
import { LogoBall, LogoWordmark } from '../../components/LogoMark';
import { ChevronIcon } from '../../components/icons';
import { MicroLabel } from '../../components/ui';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { logoFrame } from '../courtTransition/logoPaths';
import { brand, frame, radius, shadows, space, useTheme, withAlpha } from '../../theme';
import { tierName } from './logic';
import { useCardMotion } from './useCardMotion';

/** A bank card's own proportions (ISO/IEC 7810 ID-1), so it reads as a card before it is read. */
const CARD_RATIO = 85.6 / 53.98;
/** How far the card leans under a finger at its very edge. */
const TILT_DEG = 9;
/** The lockup's width on the card. */
const LOGO_W = 84;

/** The Touch Padel lockup in white with the colour ball, as the boot screen assembles it. */
function Lockup() {
  const f = logoFrame(LOGO_W);
  return (
    <LtrIsland
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: LOGO_W, height: f.height }}
    >
      <LogoWordmark width={LOGO_W} color={brand.white} />
      <View style={{ position: 'absolute', start: f.ball.start, top: f.ball.top }}>
        <LogoBall size={f.ball.size} variant="colour" />
      </View>
    </LtrIsland>
  );
}

/** Arabic letters join, so the bank-card capitals and spacing are for a Latin name only. */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

/** The name's line box, fixed so every layer of the lettering lands on the same pixels. */
const NAME_PT = 17;
const NAME_LINE = 22;
/** The letters' thickness: copies stepped down and toward the end, lit from the top start. */
const PUFF_STEPS = [1.8, 1.2, 0.6];
/**
 * The metal on the letters' faces, a soft one (Majed, 2026-10-22: "a bit of a reflective metal,
 * not this much"; a chrome of seven bands with a dark horizon was rejected on sight). The face is
 * the bright silver; the top of each letter is a touch lighter where it rounds toward the light,
 * the bottom a touch darker where it turns away. Fractions of NAME_LINE; null leaves the face.
 */
const METAL: readonly (readonly [from: number, to: number, color: string])[] = [
  [0, 0.42, withAlpha(brand.white, 0.35)],
  [0.7, 1, withAlpha(frame.silver, 0.6)],
];
/** The glint: one soft stroke through the letters, faint. */
const GLINTS: readonly (readonly [width: number, alpha: number])[] = [[22, 0.3]];

interface NameProps {
  name: string;
  /** The card's band of light, 0..1 across it. */
  sweep: Animated.Value;
  /** The card's lean left and right, -1..1. */
  lean: Animated.AnimatedInterpolation<number> | Animated.AnimatedAddition<number>;
  moving: boolean;
}

/**
 * The bevel, edge to crest (Majed, 2026-10-22: "the text highest at the centre of all lines, like
 * a really thin copy of the same font laid above it, brighter, to show the depth"). Each letter is
 * drawn three times, the heavier weights first, each lighter weight centred on the one below: the
 * ExtraBold is the letter's foot, the SemiBold its shoulder, the Thin its crest: a hairline down the middle
 * of every stroke where the light lands (Regular first; "make the inner one thinner", Majed).
 * Black and Bold, spread 1.1 pt, were "too thick, too bold" (Majed): a weight lighter each, 0.5 pt.
 */
type Bevel = 'foot' | 'shoulder' | 'crest';
const BEVEL_TONES: Record<Bevel, string> = {
  foot: frame.silverLo,
  shoulder: frame.silver,
  // A near-white crest: the brightest line on the letter is the one the eye reads as its top.
  crest: withAlpha(brand.white, 0.92),
};
/**
 * How far the foot is spread past its own outline, in points ("make the outer wider while keeping
 * the inner thin", Majed): the foot's ExtraBold drawn again at SPREAD in eight directions round it,
 * which fattens every stroke evenly and keeps the edge crisp. The shoulder and the crest are not
 * spread, so the crest stays a hairline.
 */
const SPREAD = 0.5;
const D = Math.SQRT1_2;
const AROUND: readonly (readonly [dx: number, dy: number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [D, D],
  [D, -D],
  [-D, D],
  [-D, -D],
];
/** The spread toward the sides' visible edges only: the puffy thickness of a spread foot. */
/**
 * The light, as it falls on raised metal in a room (Majed, 2026-10-22: "colours like real life"):
 * one source above and toward the start. A slope that faces it is near white, a slope that faces
 * away is dark steel, and the sides under the letter are in shade. So every spread copy of the foot
 * takes its tone from its direction (LIT toward the light, SHADE away), each upper step is laid
 * once a hair toward the light in white and once away in steel before its own tone covers the
 * middle, and the crest, a polished highlight, sits a hair toward the light, not dead centre.
 */
const LIT = withAlpha(brand.white, 0.85);
const SHADE = frame.steel;
/** True for a direction that faces the light: up, or level and toward the start. */
const facesLight = (dx: number, dy: number) => dy < 0 || (dy === 0 && dx < 0);
/** How far a step's lit and shaded copies sit from it, and the crest from centre. */
const SLOPE = { x: 0.25, y: 0.4 };
const CREST_NUDGE = { x: -0.2, y: -0.4 };
const SIDE_SPREAD: readonly (readonly [dx: number, dy: number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
];

/**
 * One letter at a time, so the weights stay centred on each other: a whole line in each weight
 * would drift apart letter by letter, a Thin being narrower than an ExtraBold. The ExtraBold letter is
 * in the flow and sizes its box; the others are centred in it. `tones` paints each step (a
 * transparent step is left out of the look but keeps the layout, which is how the glint lights
 * the crests alone on an exact copy of the row). The spread foot is copies round the in-flow ExtraBold,
 * so it never changes the layout; the letters are set apart by the spread on both sides.
 */
function GlyphRow({
  chars,
  tones,
  sides,
}: {
  chars: string[];
  tones: Record<Bevel, string>;
  /** The spread foot, the puffy thickness under it and its shadow; off for the glint's copy. */
  sides: boolean;
}) {
  const { fonts, tracking } = useTheme();
  const line = { fontSize: NAME_PT, lineHeight: NAME_LINE };
  const gap = tracking(1.4) + SPREAD * 2;
  // A copy of the Black letter laid over the in-flow one, moved by (dx, dy).
  const black = (key: string, c: string, color: string, dx: number, dy: number, shadow = false) => (
    <Text
      key={key}
      style={[
        line,
        StyleSheet.absoluteFill,
        {
          fontFamily: fonts.display800,
          color,
          transform: [{ translateX: dx }, { translateY: dy }],
        },
        shadow
          ? {
              textShadowColor: withAlpha(frame.embossShade, 0.55),
              textShadowOffset: { width: 0.5, height: 1.5 },
              textShadowRadius: 3,
            }
          : null,
      ]}
    >
      {c}
    </Text>
  );
  const centred = (
    key: string,
    font: string | undefined,
    color: string,
    c: string,
    dx = 0,
    dy = 0,
  ) => (
    <View
      key={key}
      style={[
        StyleSheet.absoluteFill,
        { alignItems: 'center', transform: [{ translateX: dx }, { translateY: dy }] },
      ]}
    >
      <Text style={[line, { fontFamily: font, color }]}>{c}</Text>
    </View>
  );
  // The spread foot, shaded copies first so a corner between a lit and a shaded side reads lit.
  const around = [...AROUND].sort(
    ([ax, ay], [bx, by]) => Number(facesLight(ax, ay)) - Number(facesLight(bx, by)),
  );
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'flex-start' }}>
      {chars.map((c, i) => (
        <View key={i} style={{ marginEnd: i < chars.length - 1 ? gap : 0 }}>
          {/* The sides, under the spread foot; the deepest stands the stack on the card. */}
          {sides
            ? PUFF_STEPS.flatMap((d, k) =>
                SIDE_SPREAD.map(([dx, dy], j) =>
                  black(
                    `s${k}.${j}`,
                    c,
                    SHADE,
                    d * 0.35 + dx * SPREAD,
                    d + dy * SPREAD,
                    k === 0 && j === 2,
                  ),
                ),
              )
            : null}
          {sides
            ? around.map(([dx, dy], j) =>
                black(`f${j}`, c, facesLight(dx, dy) ? LIT : SHADE, dx * SPREAD, dy * SPREAD),
              )
            : null}
          <Text style={[line, { fontFamily: fonts.display800, color: tones.foot }]}>{c}</Text>
          {/* The shoulder's slopes: away from the light in steel, toward it in white. */}
          {sides ? centred('ss', fonts.display600, SHADE, c, SLOPE.x, SLOPE.y) : null}
          {sides ? centred('sl', fonts.display600, LIT, c, -SLOPE.x, -SLOPE.y) : null}
          {centred('s', fonts.display600, tones.shoulder, c)}
          {centred('c', fonts.display100, tones.crest, c, CREST_NUDGE.x, CREST_NUDGE.y)}
        </View>
      ))}
    </View>
  );
}

/**
 * A Latin name in bank-card capitals with the bevel's crest down every stroke, on the puffy
 * sides and their shadow. Too long for the card, the whole row is scaled down from its start,
 * since a row of single letters cannot ellipsize. The glint crosses with the card's band of light
 * on an exact copy of the row with only the crests lit, so it catches the ridges and nothing else.
 */
function EmbossedGlyphs({ name, sweep, lean, moving }: NameProps) {
  const [room, setRoom] = useState(0);
  const [rowW, setRowW] = useState(0);
  const chars = Array.from(name.toLocaleUpperCase('en'));
  const fit = room > 0 && rowW > room ? room / rowW : 1;
  const clear = withAlpha(brand.white, 0);
  const glintX =
    moving && rowW > 0
      ? Animated.add(
          sweep.interpolate({ inputRange: [0, 1], outputRange: [-40, rowW + 40] }),
          lean.interpolate({
            inputRange: [-1, 1],
            outputRange: [rowW * 0.25, -rowW * 0.25],
            extrapolate: 'clamp',
          }),
        )
      : null;
  const W = 24;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setRoom(e.nativeEvent.layout.width)}
    >
      {/* A Latin name reads left to right in either language; the island sits at the start. */}
      <LtrIsland
        style={{
          alignSelf: 'flex-start',
          width: fit < 1 ? room : undefined,
          height: NAME_LINE + 2,
        }}
      >
        <View
          onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
          style={{
            alignSelf: 'flex-start',
            transformOrigin: 'left center',
            transform: [{ scale: fit }],
          }}
        >
          <GlyphRow chars={chars} tones={BEVEL_TONES} sides />
          {glintX ? (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                start: -W / 2,
                width: W,
                overflow: 'hidden',
                transform: [{ translateX: glintX }],
              }}
            >
              {/* The row held still behind the moving window. */}
              <Animated.View
                style={{
                  width: rowW,
                  transform: [{ translateX: Animated.multiply(glintX, -1) }, { translateX: W / 2 }],
                }}
              >
                <GlyphRow
                  chars={chars}
                  tones={{ foot: clear, shoulder: clear, crest: brand.white }}
                  sides={false}
                />
              </Animated.View>
            </Animated.View>
          ) : null}
        </View>
      </LtrIsland>
    </View>
  );
}

/** The holder's name: a Latin one letter by letter with its bevel, an Arabic one as a line. */
function EmbossedName(props: NameProps) {
  return ARABIC.test(props.name) ? <EmbossedLine {...props} /> : <EmbossedGlyphs {...props} />;
}

/**
 * An ARABIC name, puffy in soft metal: Arabic letters join, so they cannot be laid out one by one
 * for EmbossedGlyphs' ridge, and the line is drawn whole. Built from copies of the same line laid
 * over each other, back to front:
 *
 *   the sides   three copies in the darker silver, each a little lower, so the letters have a
 *               thickness, the last one casting a soft black shadow onto the card;
 *   the lit rim a white copy a hair up and back, the edge that catches the light;
 *   the face    the bright silver, lighter over the top of the letters and a touch darker at the
 *               bottom (METAL: copies clipped to those bands);
 *   the glint   one faint stroke through the letters only, crossing them with the card's band of
 *               light and leaning with the card. Still under Reduce Motion.
 *
 * Every copy has the same font, size, line height and single line, and the box hugs the line, so
 * they clip and ellipsize identically. Only the base face is in the flow and gives the box its
 * size. Text with a gradient fill would need a native mask view; slices need nothing new.
 */
function EmbossedLine({ name, sweep, lean, moving }: NameProps) {
  const { fonts } = useTheme();
  const [width, setWidth] = useState(0);
  const line = { fontFamily: fonts.display900, fontSize: NAME_PT, lineHeight: NAME_LINE };
  const layer = { position: 'absolute' as const, top: 0, start: 0, end: 0 };
  // A copy of the line seen through a window of the box: `top`/`height` cut it across, and the
  // copy is moved back up by `top` so its letters stay exactly over the face's.
  const slice = (key: string, top: number, height: number, color: string) => (
    <View key={key} style={[layer, { top, height, overflow: 'hidden' }]}>
      <Text numberOfLines={1} style={[line, { color, marginTop: -top, width }]}>
        {name}
      </Text>
    </View>
  );

  // Where the glint is across the name: with the card's band, leaning a quarter of the name.
  const glintX =
    moving && width > 0
      ? Animated.add(
          sweep.interpolate({ inputRange: [0, 1], outputRange: [-40, width + 40] }),
          lean.interpolate({
            inputRange: [-1, 1],
            outputRange: [width * 0.25, -width * 0.25],
            extrapolate: 'clamp',
          }),
        )
      : null;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // Hugs the line, so every layer is exactly the text's width in either direction.
      style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
    >
      {PUFF_STEPS.map((d, i) => (
        <Text
          key={d}
          numberOfLines={1}
          style={[
            line,
            layer,
            {
              color: frame.silverLo,
              transform: [{ translateX: d * 0.35 }, { translateY: d }],
            },
            // The deepest copy stands the whole stack on the card.
            i === 0
              ? {
                  textShadowColor: withAlpha(frame.embossShade, 0.55),
                  textShadowOffset: { width: 0.5, height: 1.5 },
                  textShadowRadius: 3,
                }
              : null,
          ]}
        >
          {name}
        </Text>
      ))}
      <Text
        numberOfLines={1}
        style={[
          line,
          layer,
          {
            color: withAlpha(brand.white, 0.7),
            transform: [{ translateX: -0.4 }, { translateY: -0.7 }],
          },
        ]}
      >
        {name}
      </Text>
      <Text
        numberOfLines={1}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={[line, { color: frame.silverHi }]}
      >
        {name}
      </Text>
      {width > 0
        ? METAL.map(([from, to, color]) =>
            slice(`c${from}`, from * NAME_LINE, (to - from) * NAME_LINE, color),
          )
        : null}
      {/* The glint, physical left to right like the light it follows. */}
      {glintX ? (
        <LtrIsland pointerEvents="none" style={[layer, { bottom: 0, overflow: 'hidden' }]}>
          {GLINTS.map(([w, alpha]) => (
            <Animated.View
              key={w}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                start: -w / 2,
                width: w,
                overflow: 'hidden',
                transform: [{ translateX: glintX }],
              }}
            >
              {/* The letters held still behind the moving window. */}
              <Animated.View
                style={{
                  width,
                  transform: [{ translateX: Animated.multiply(glintX, -1) }, { translateX: w / 2 }],
                }}
              >
                <Text numberOfLines={1} style={[line, { color: withAlpha(brand.white, alpha) }]}>
                  {name}
                </Text>
              </Animated.View>
            </Animated.View>
          ))}
        </LtrIsland>
      ) : null}
    </View>
  );
}

/**
 * The guest's points as a card in the hand (Majed, 2026-10-22): the Club tab's way into Points &
 * rewards. Navy into the brand blue with the court lines across it, the lockup where a bank puts
 * its name, the tier in Padel Green, the balance with what it is worth at the cashier, and the
 * guest's name in puffy chrome along the bottom, as a bank card carries its holder's (EmbossedName).
 *
 * It is lit, not decorated. A band of light crosses it every few seconds, as a card catches a lamp
 * when the hand turns it; a finger on it presses that spot down (a perspective tilt toward the
 * touch), a glare slides to the raised side, and the band leans with it. The phone's own movement
 * leans it too (useCardMotion: the gyroscope, against the turn, settling when the hand is still),
 * added to the finger's. All of it runs on the native driver, stops while the tab is out of sight,
 * and holds still under Reduce Motion, where the card is the same card without the light moving.
 *
 * Theme-invariant like the navy surfaces in `brand`: a card is the same card on either page. Only
 * its shadow follows the theme.
 */
export function PointsCard({
  testID,
  loyalty,
  holder,
  onPress,
}: {
  /** `<route>.<element>`; the balance takes `${testID}.balance`. */
  testID: string;
  loyalty: Pick<MyLoyalty, 'balance' | 'tier' | 'point_value_iqd'>;
  /** The guest's name as their profile has it; the card goes without one while it is empty. */
  holder: string;
  onPress: () => void;
}) {
  const { t, locale } = useLocale();
  const { fonts, appearance } = useTheme();
  const reduce = useReduceMotion();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Finger position on the card, -1..1 on each axis, and how far it is pressed in.
  const [tiltX] = useState(() => new Animated.Value(0));
  const [tiltY] = useState(() => new Animated.Value(0));
  const [press] = useState(() => new Animated.Value(0));
  // The light band's run across the card, 0..1.
  const [sweep] = useState(() => new Animated.Value(0));

  // The band runs only while the tab is in front: no light on a card nobody is looking at.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    if (reduce || !focused) return;
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(sweep, {
          toValue: 1,
          duration: 2600,
          easing: Easing.bezier(0.45, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.delay(3800),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, focused, sweep]);

  // The phone's movement, added to the finger's lean; a lean past the edge stops at the edge.
  const motion = useCardMotion(focused && !reduce);
  const leanX = Animated.add(tiltX, motion.x);
  const leanY = Animated.add(tiltY, motion.y);

  const lean = (x: number, y: number, pressed: boolean) => {
    const settle = { useNativeDriver: true, speed: pressed ? 22 : 12, bounciness: pressed ? 0 : 4 };
    Animated.parallel([
      Animated.spring(tiltX, { toValue: x, ...settle }),
      Animated.spring(tiltY, { toValue: y, ...settle }),
      Animated.spring(press, { toValue: pressed ? 1 : 0, ...settle }),
    ]).start();
  };
  // The layers inside take no touches, so the location is always the card's own.
  const leanTo = (e: GestureResponderEvent) => {
    if (reduce || !size) return;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    lean(
      clamp((e.nativeEvent.locationX / size.w) * 2 - 1),
      clamp((e.nativeEvent.locationY / size.h) * 2 - 1),
      true,
    );
  };

  const balance = isolateLtr(formatNumber(loyalty.balance, locale));
  const worth =
    loyalty.balance > 0 && loyalty.point_value_iqd > 0
      ? t('loyalty.guest.home.worth', {
          amount: isolate(formatIQD(loyalty.balance * loyalty.point_value_iqd, locale)),
        })
      : null;
  const ink = brand.navyText;

  // Pressing a spot pushes it away: the right edge recedes under a finger on the right, the top
  // under a finger at the top.
  const rotateY = leanX.interpolate({
    inputRange: [-1, 1],
    outputRange: [`-${TILT_DEG}deg`, `${TILT_DEG}deg`],
    extrapolate: 'clamp',
  });
  const rotateX = leanY.interpolate({
    inputRange: [-1, 1],
    outputRange: [`${TILT_DEG}deg`, `-${TILT_DEG}deg`],
    extrapolate: 'clamp',
  });
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.975] });

  const fx = (() => {
    if (!size) return null;
    const { w, h } = size;
    const band = w * 0.6;
    // The band starts and ends wholly off the card; the tilt leans it toward the lowered side.
    const bandX = Animated.add(
      sweep.interpolate({ inputRange: [0, 1], outputRange: [-band - w * 0.35, w + w * 0.35] }),
      leanX.interpolate({
        inputRange: [-1, 1],
        outputRange: [w * 0.15, -w * 0.15],
        extrapolate: 'clamp',
      }),
    );
    const glare = w * 1.2;
    // Lit by a press, or by the phone leaning the card: either lean's size, never past full.
    const glareOpacity = Animated.add(
      press,
      Animated.add(
        motion.x.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.8, 0, 0.8] }),
        motion.y.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.8, 0, 0.8] }),
      ),
    ).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
    return (
      <LtrIsland pointerEvents="none" style={StyleSheet.absoluteFill}>
        {/* The light band: clear, a breath of Padel Green, white, clear. */}
        {reduce ? null : (
          <Animated.View
            style={{
              position: 'absolute',
              start: 0,
              top: -h * 0.6,
              width: band,
              height: h * 2.2,
              transform: [{ translateX: bandX }, { rotate: '22deg' }],
            }}
          >
            <LinearGradient
              colors={[
                withAlpha(brand.white, 0),
                withAlpha(brand.green, 0.07),
                withAlpha(brand.white, 0.2),
                withAlpha(brand.white, 0.05),
                withAlpha(brand.white, 0),
              ]}
              locations={[0, 0.35, 0.52, 0.62, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}
        {/* The glare: on the raised side, opposite the lean, while pressed or moving. */}
        {reduce ? null : (
          <Animated.View
            style={{
              position: 'absolute',
              start: (w - glare) / 2,
              top: (h - glare) / 2,
              width: glare,
              height: glare,
              opacity: glareOpacity,
              transform: [
                {
                  translateX: leanX.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [w * 0.45, -w * 0.45],
                    extrapolate: 'clamp',
                  }),
                },
                {
                  translateY: leanY.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [h * 0.45, -h * 0.45],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            }}
          >
            <Svg width={glare} height={glare}>
              <Defs>
                <RadialGradient id="glare" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={brand.white} stopOpacity={0.22} />
                  <Stop offset="1" stopColor={brand.white} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={glare / 2} cy={glare / 2} r={glare / 2} fill="url(#glare)" />
            </Svg>
          </Animated.View>
        )}
      </LtrIsland>
    );
  })();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${t('loyalty.guest.home.title')}, ${t('loyalty.guest.home.balance')} ${balance}`}
      onPress={onPress}
      onPressIn={(e) => {
        void Haptics.selectionAsync().catch(() => {});
        leanTo(e);
      }}
      onTouchMove={leanTo}
      onPressOut={() => {
        if (!reduce) lean(0, 0, false);
      }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) =>
          prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
        );
      }}
      // A little more air under it than the panel's gap, for the shadow to land in.
      style={{ width: '100%', aspectRatio: CARD_RATIO, marginBottom: space.s }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          flex: 1,
          borderRadius: radius.sheet,
          backgroundColor: brand.navy,
          boxShadow: appearance === 'dark' ? shadows.pointsCardDark : shadows.pointsCard,
          transform: [{ perspective: 900 }, { rotateX }, { rotateY }, { scale }],
        }}
      >
        <View style={{ flex: 1, borderRadius: radius.sheet, overflow: 'hidden' }}>
          <LinearGradient
            colors={[brand.navy, brand.navyCard, brand.navyLine]}
            locations={[0, 0.55, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <BrandPattern opacity={0.16} />
          {/* The sheen of a laminated face: brighter at the top edge, gone by the middle. */}
          <LinearGradient
            colors={[withAlpha(brand.white, 0.1), withAlpha(brand.white, 0)]}
            locations={[0, 0.5]}
            style={StyleSheet.absoluteFill}
          />
          {fx}
          <View
            style={{
              flex: 1,
              paddingHorizontal: space.xl,
              paddingVertical: space.l,
              justifyContent: 'space-between',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: space.sm,
              }}
            >
              <Lockup />
              {loyalty.tier ? (
                <MicroLabel style={{ color: brand.green, flexShrink: 1 }}>
                  {tierName(loyalty.tier, locale)}
                </MicroLabel>
              ) : null}
            </View>
            <View>
              <MicroLabel style={{ color: ink }}>{t('loyalty.guest.home.balance')}</MicroLabel>
              <Text
                testID={`${testID}.balance`}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  fontFamily: fonts.display900,
                  fontSize: 44,
                  lineHeight: 50,
                  color: brand.white,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {balance}
              </Text>
              {worth ? (
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: fonts.body600, fontSize: 13, color: ink }}
                >
                  {worth}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                {holder ? (
                  <EmbossedName name={holder} sweep={sweep} lean={leanX} moving={!reduce} />
                ) : null}
              </View>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: radius.pill,
                  backgroundColor: withAlpha(brand.white, 0.12),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ChevronIcon size={16} color={brand.white} />
              </View>
            </View>
          </View>
          {/* The cut edge catching the light, over everything. */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: radius.sheet,
                borderWidth: 1,
                borderColor: withAlpha(brand.white, 0.14),
              },
            ]}
          />
        </View>
      </Animated.View>
    </Pressable>
  );
}
