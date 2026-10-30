import { useId, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Mask, Path, Rect } from 'react-native-svg';
import { LOGO_BALL_CIRCLE, LOGO_BALL_PATHS } from '../courtTransition/logoPaths';
import { mirror } from '../../i18n/direction';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { brand, palettes, radius, space, useTheme } from '../../theme';
import { CupIcon } from '../../components/icons';
import { pickText } from './logic';

/**
 * The café menu's category drawings, the same ones the web menu hangs off each section band
 * (`apps/web/src/components/cafe/MenuStage/sectionArt.tsx`), for the Club tab's menu (Majed,
 * 2026-10-19). The paths are the web's, converted tag for tag; the web's CSS colours become the
 * theme's, so the drawings follow blue mode with the rest of the screen:
 *
 *   --tp-accent → colors.blue        --tp-bg → colors.card
 *   --tp-cafe-blue-tint → colors.tint --tp-cafe-green-tint → colors.gtint
 *   --tp-cafe-green → brand.green    --tp-cafe-green-light → colors.gline
 *
 * Keyed by `name_en`, as on the web: a category the operator renamed or added has no drawing and
 * its band simply goes without one. A change to a drawing is made on the web first and copied here.
 */
export interface CategoryArtColors {
  accent: string;
  bg: string;
  blueTint: string;
  greenTint: string;
  green: string;
  greenLight: string;
}

export interface CategoryArt {
  /** The design's word for the band, e.g. COFFEE (English only; Arabic shows its own name). */
  word: string;
  /** The band's tint. */
  tone: 'blue' | 'green';
  /** Placement off the design: the drawing's size and tilt, and how far it hangs past the corner. */
  illo: { size: number; end: number; bottom: number; rot: number };
  art: (c: CategoryArtColors) => ReactNode;
}

/**
 * Coffee is the one drawing with `url(#…)` references (a mask cutting the iced glass to the hot
 * cup's outline, a clip holding the liquid in the glass), so it takes ids of its own per copy.
 */
function CoffeeArt({ c }: { c: CategoryArtColors }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const cupCut = `tp-coffee-cut-${uid}`;
  const glassIn = `tp-coffee-glass-${uid}`;
  return (
    <>
      <Defs>
        <Mask id={cupCut} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <Rect x="0" y="0" width="64" height="64" fill="#FFFFFF" />
          <G stroke="#000000" fill="none" strokeLinejoin="round" strokeLinecap="round">
            <Path
              d="M 20.5 42.2 C 11.5 46 14.1 53.8 32 53.8 C 49.9 53.8 52.5 46 43.5 42.2"
              strokeWidth="5"
            />
            <Path
              d="M 16.6 24.3 V 32 A 15.4 15.4 0 0 0 47.4 32 V 24.3 Z"
              fill="#000000"
              strokeWidth="6.2"
            />
            <Ellipse cx="32" cy="24.3" rx="15.4" ry="5.1" fill="#000000" strokeWidth="6.2" />
          </G>
        </Mask>
        <ClipPath id={glassIn}>
          <Path d="M 4.4 13.4 H 18.8 L 16.2 48.6 H 7 Z" />
        </ClipPath>
      </Defs>

      {/* iced coffee, behind, masked to the hot cup's outline */}
      <G stroke={c.accent} strokeLinejoin="round" mask={`url(#${cupCut})`}>
        <Path d="M 15.6 12 L 11.6 2.6" strokeWidth="2.8" strokeLinecap="round" />
        <Path d="M 3 12 H 20.2 L 17.3 50 H 5.9 Z" fill={c.bg} strokeWidth="2.8" />
        <G clipPath={`url(#${glassIn})`}>
          <Path
            d="M 3.65 20.5 c 2.65 -2.2 5.3 -2.2 7.95 0 s 5.3 2.2 7.95 0 L 17.3 50 H 5.9 Z"
            fill={c.green}
            fillOpacity=".22"
            stroke="none"
          />
          <Path
            d="M 3.65 20.5 c 2.65 -2.2 5.3 -2.2 7.95 0 s 5.3 2.2 7.95 0"
            stroke={c.green}
            strokeWidth="2.2"
          />
        </G>
        <Rect x="7.4" y="24.2" width="6.6" height="6.6" rx="1.3" strokeWidth="1.6" opacity=".55" />
        <Rect x="8.6" y="36.2" width="7" height="7" rx="1.4" strokeWidth="1.6" opacity=".55" />
      </G>

      {/* hot coffee */}
      <G stroke={c.green} strokeLinecap="round">
        <Path d="M 25 14.7 C 22.4 11.5 27.5 10.2 25.6 7" strokeWidth="2.9" />
        <Path d="M 32 14 C 29.4 10.2 35.2 9 32.6 5.1" strokeWidth="3.2" />
        <Path d="M 39 14.7 C 36.4 11.5 41.5 10.2 39.6 7" strokeWidth="2.9" />
      </G>
      <Path
        d="M 20.5 42.2 C 11.5 46 14.1 53.8 32 53.8 C 49.9 53.8 52.5 46 43.5 42.2"
        strokeWidth="2.6"
      />
      <Path
        d="M 23.7 43.5 C 19.8 46 22.4 49.9 32 49.9 C 41.6 49.9 44.2 46 40.3 43.5"
        strokeWidth="1.9"
        opacity=".45"
      />
      <Path d="M 47.4 28.2 H 49.9 A 6.4 6.4 0 0 1 49.9 41 H 47.4" strokeWidth="3.8" />
      <Path d="M 16.6 24.3 V 32 A 15.4 15.4 0 0 0 47.4 32 V 24.3 Z" fill={c.bg} strokeWidth="3.8" />
      <Ellipse cx="32" cy="24.3" rx="15.4" ry="5.1" fill={c.bg} strokeWidth="3.8" />
      <Ellipse cx="32" cy="24.3" rx="10.9" ry="3.2" fill={c.greenLight} stroke="none" />
    </>
  );
}

/**
 * Signature's house mark. The web draws a traced 18 KB image there; the app has the brand ball's
 * own paths (`courtTransition/logoPaths`), so the badge carries the ball: green arcs on a white
 * disc, the brand's colour state, centred in the cup's green panel.
 */
function HouseBall({ c }: { c: CategoryArtColors }) {
  const { cx, cy, r } = LOGO_BALL_CIRCLE;
  const k = 5.6 / r;
  // Mirrored with the band in Arabic, and left so: the ball is symmetric about its axis.
  return (
    <G transform={`translate(32 39) scale(${k}) translate(${-cx} ${-cy})`} stroke="none">
      <Circle cx={cx} cy={cy} r={r} fill={brand.white} />
      {LOGO_BALL_PATHS.map((d, i) => (
        <Path key={i} d={d} fill={c.green} />
      ))}
    </G>
  );
}

const SECTION_ART: Record<string, CategoryArt> = {
  Coffee: {
    word: 'COFFEE',
    tone: 'blue',
    illo: { size: 108, end: -14, bottom: -14, rot: -10 },
    art: (c) => <CoffeeArt c={c} />,
  },
  Smoothie: {
    word: 'SMOOTHIE',
    tone: 'green',
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (c) => (
      <>
        <G transform="scale(0.6667)" strokeWidth="4.5">
          <Path d="M49 36a11 11 0 0 1 22 0z" fill={c.green} stroke="none" />
          <Path d="M60 34.5V27M53.5 32 60 34.5M66.5 32 60 34.5" stroke={c.bg} strokeWidth="2.4" />
          <Path
            d="M38 35c-7.4 0-10.6-3.6-10.6-9.2 6.6-1.2 10.6 2.6 10.6 9.2z"
            fill={c.green}
            stroke="none"
          />
          <Path
            d="M30.4 54c4.4-3.6 8.8-3.6 13.2 0s8.8 3.6 13.2 0c2.9-1.2 5.9-1.4 8.8 0.2L63.1 84a5 5 0 0 1-5 4.6H38.4a5 5 0 0 1-5-4.6L30.4 54z"
            fill={c.green}
            fillOpacity="0.38"
            stroke="none"
          />
          <Path
            d="M30.4 54c4.4-3.6 8.8-3.6 13.2 0s8.8 3.6 13.2 0c2.9-1.2 5.9-1.4 8.8 0.2"
            stroke={c.green}
          />
          <Path d="M47 50.2L40.6 21l8.4-7" />
          <Path d="M22 36h52" />
          <Path d="M26.5 36h43l-4.2 48.5a7 7 0 0 1-7 6.5H37.7a7 7 0 0 1-7-6.5z" />
        </G>
      </>
    ),
  },
  Tea: {
    word: 'TEA',
    tone: 'blue',
    illo: { size: 106, end: -12, bottom: -14, rot: -8 },
    art: (c) => (
      <>
        <G transform="translate(3.43 0) scale(0.5714) translate(0 14)">
          <G
            stroke={c.green}
            strokeLinecap="round"
            transform="translate(0 -15) scale(1 0.86) translate(0 2)"
          >
            <Path d="M39 23c-4-5 4-7 1-12" strokeWidth="4.5" />
            <Path d="M50 22c-4-6 5-8 1-14" strokeWidth="5" />
            <Path d="M61 23c-4-5 4-7 1-12" strokeWidth="4.5" />
          </G>
          <Path
            d="M24 79C25.5 87.5 35.5 92 50 92C64.5 92 74.5 87.5 76 79"
            fill={c.blueTint}
            strokeWidth="5"
            strokeLinecap="round"
          />
          <Ellipse cx="50" cy="79" rx="26" ry="8" fill={c.blueTint} strokeWidth="5" />
          <Ellipse
            cx="50"
            cy="79"
            rx="17"
            ry="4.6"
            fill={c.accent}
            fillOpacity=".2"
            stroke="none"
          />
          <Path
            d="M31 22C31.5 30 36.5 32.5 36.5 39.5C36.5 48 32 53 32 61C32 69.5 37.5 74 41.5 77.5H58.5C62.5 74 68 69.5 68 61C68 53 63.5 48 63.5 39.5C63.5 32.5 68.5 30 69 22Z"
            fill={c.blueTint}
            stroke="none"
          />
          <Path
            d="M31 22C31.5 30 36.5 32.5 36.5 39.5C36.5 48 32 53 32 61C32 69.5 37.5 74 41.5 77.5H58.5C62.5 74 68 69.5 68 61C68 53 63.5 48 63.5 39.5C63.5 32.5 68.5 30 69 22"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <Ellipse cx="50" cy="22" rx="19" ry="6.5" fill={c.blueTint} strokeWidth="6" />
          <Ellipse cx="50" cy="22" rx="13" ry="4" fill={c.accent} fillOpacity=".2" stroke="none" />
        </G>
      </>
    ),
  },
  'Fresh Juice': {
    word: 'JUICE',
    tone: 'green',
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (c) => (
      <>
        <G transform="scale(0.6667)" strokeWidth="4.5">
          <Path
            d="M30.4 54c4.4-3.6 8.8-3.6 13.2 0s8.8 3.6 13.2 0c2.9-1.2 5.9-1.4 8.8 0.2L63.1 84a5 5 0 0 1-5 4.6H38.4a5 5 0 0 1-5-4.6L30.4 54z"
            fill={c.green}
            fillOpacity="0.38"
            stroke="none"
          />
          <Path
            d="M30.4 54c4.4-3.6 8.8-3.6 13.2 0s8.8 3.6 13.2 0c2.9-1.2 5.9-1.4 8.8 0.2"
            stroke={c.green}
          />
          <G transform="rotate(-45 48 75)" stroke={c.green}>
            <Path d="M46 65 A10 10 0 0 0 46 85 Z" fill={c.greenTint} strokeWidth="2.6" />
            <Path d="M46 67.2 A7.8 7.8 0 0 0 46 82.8" strokeWidth="1.5" />
            <Path d="M46 75 H38.7 M46 75 L40.8 69.8 M46 75 L40.8 80.2" strokeWidth="1.5" />
            <Path d="M50 65 A10 10 0 0 1 50 85 Z" fill={c.greenTint} strokeWidth="2.6" />
            <Path d="M50 67.2 A7.8 7.8 0 0 1 50 82.8" strokeWidth="1.5" />
            <Path d="M50 75 H57.3 M50 75 L55.2 69.8 M50 75 L55.2 80.2" strokeWidth="1.5" />
          </G>
          <Path d="M22 36a26 19 0 0 1 52 0" fill={c.blueTint} />
          <Path d="M48 50V5" />
          <Path d="M22 36h52" />
          <Path d="M26.5 36h43l-4.2 48.5a7 7 0 0 1-7 6.5H37.7a7 7 0 0 1-7-6.5z" />
        </G>
      </>
    ),
  },
  Frappuccino: {
    word: 'FRAPPUCCINO',
    tone: 'blue',
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (c) => (
      <>
        <Path d="M 22 28 L 26 56 L 38 56 L 42 28" fill={c.bg} />
        <Path d="M 28 34 L 29.5 51 M 36 34 L 34.5 51" stroke={c.greenLight} strokeWidth="1.3" />
        <Path d="M 20 28 L 44 28" />
        <Path
          d="M 23 28 C 21 22 27 20 28.5 22.5 C 28 16 36 16 35.5 22 C 38.5 20 43 23 41 28 Z"
          fill={c.blueTint}
        />
        <Path d="M 35.5 22 L 40 10 L 47 7" strokeWidth="3.2" />
        <Circle cx="32" cy="16" r="2.4" fill={c.greenLight} stroke="none" />
      </>
    ),
  },
  Cocktail: {
    word: 'COCKTAIL',
    tone: 'green',
    illo: { size: 106, end: -12, bottom: -14, rot: 8 },
    art: (c) => (
      <>
        <Path
          d="M 22.5 54.4 C 26 53.5 29.5 51.6 32 49 C 34.5 51.6 38 53.5 41.5 54.4 A 9.5 2.4 0 0 1 22.5 54.4 Z"
          fill={c.bg}
        />
        <Path d="M 32 33 L 32 49.4" />
        <Path d="M 17 16 L 32 33 L 47 16 Z" fill={c.bg} />
        {/* liquid: inset to the bowl's interior so it needs no clipPath — a
            document-unique id is impossible here, since the same node renders
            in both the band illustration and the row thumbnail. */}
        <Path
          d="M 21 20 C 23.31 18.1 24.19 18.1 26.5 20 C 28.81 21.9 29.69 21.9 32 20 C 34.31 18.1 35.19 18.1 37.5 20 C 39.81 21.9 40.69 21.9 43 20 L 32 33 Z"
          fill={c.green}
          fillOpacity=".38"
          stroke="none"
        />
        <Path
          d="M 21 20 C 23.31 18.1 24.19 18.1 26.5 20 C 28.81 21.9 29.69 21.9 32 20 C 34.31 18.1 35.19 18.1 37.5 20 C 39.81 21.9 40.69 21.9 43 20"
          stroke={c.green}
          strokeWidth="1.8"
        />
        <Path d="M 17 16 L 32 33 L 47 16 Z" />
        <Path d="M 15 16 L 49 16" />
        <Path d="M 31 24 L 23.5 4" />
        <G transform="rotate(-20.6 26.1 11)">
          <Ellipse
            cx="26.1"
            cy="11"
            rx="2.4"
            ry="3.1"
            fill={c.green}
            stroke={c.green}
            strokeWidth="1.8"
          />
          <Ellipse cx="26.1" cy="8.7" rx="1.15" ry="0.8" fill={c.greenTint} stroke="none" />
          <Path
            d="M 24.3 10 C 24.1 11.5 24.5 12.6 25.3 13.3"
            stroke={c.greenLight}
            strokeWidth="1"
          />
        </G>
        <G transform="rotate(45 46 16)" stroke={c.green}>
          <Path d="M 39 16 A 7 7 0 0 1 53 16 Z" fill={c.bg} strokeWidth="2" />
          <Path
            d="M 40.4 16 A 5.6 5.6 0 0 1 51.6 16 Z"
            fill={c.green}
            fillOpacity=".3"
            strokeWidth="1.3"
          />
          <Path
            d="M 46.89 15.35 L 50.53 12.71 M 46.34 14.95 L 47.73 10.67 M 45.66 14.95 L 44.27 10.67 M 45.11 15.35 L 41.47 12.71"
            strokeWidth="1.1"
          />
          <Path d="M 44.9 16 A 1.1 1.1 0 0 1 47.1 16" strokeWidth="1.1" />
        </G>
      </>
    ),
  },
  Milkshake: {
    word: 'MILKSHAKE',
    tone: 'blue',
    illo: { size: 102, end: -10, bottom: -10, rot: -8 },
    art: (c) => (
      <>
        <Path
          d="M 20 20 C 21 31 25.6 39 26.4 45 C 26.7 47.2 27.9 48.2 30 48.2 L 34 48.2 C 36.1 48.2 37.3 47.2 37.6 45 C 38.4 39 43 31 44 20"
          fill={c.bg}
        />
        <Path d="M 29.4 48.2 C 30.2 51.5 29.8 54 29.2 56.4" />
        <Path d="M 34.6 48.2 C 33.8 51.5 34.2 54 34.8 56.4" />
        <Ellipse cx="32" cy="57.4" rx="9" ry="2.4" fill={c.bg} />
        <Path
          d="M 28.4 27 C 28.7 33.7 30.2 38.5 30.35 44"
          stroke={c.greenLight}
          strokeWidth="1.8"
        />
        <Path
          d="M 35.6 27 C 35.3 33.7 33.8 38.5 33.65 44"
          stroke={c.greenLight}
          strokeWidth="1.8"
        />
        <Path d="M 36 16 L 43 5 L 49.5 3" />
        <Path d="M 20 20 C 18 13 25 11 27 14 C 27 7 37 7 37 14 C 39 11 46 13 44 20 Z" fill={c.bg} />
        <Circle cx="32" cy="6" r="2.6" fill={c.greenLight} stroke="none" />
      </>
    ),
  },
  'Milk Drinks': {
    word: 'MILK',
    tone: 'green',
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (c) => (
      <>
        <Path
          d="M 20.6 28.5 L 24.6 54 C 24.8 55.3 25.6 56 27 56 L 37 56 C 38.4 56 39.2 55.3 39.4 54 L 43.4 28.5 Z"
          fill={c.blueTint}
          stroke="none"
        />
        <Path d="M 20 28.5 L 24.6 54 C 24.8 55.3 25.6 56 27 56 L 37 56 C 38.4 56 39.2 55.3 39.4 54 L 44 28.5" />
        <Path
          d="M 17 22.5 C 17 21.4 17.9 21 19 21 L 45 21 C 46.1 21 47 21.4 47 22.5 L 47 27 C 47 28.1 46.1 28.5 45 28.5 L 19 28.5 C 17.9 28.5 17 28.1 17 27 Z"
          fill={c.bg}
        />
        <Path
          d="M 20.5 21 L 20.5 17.6 C 20.5 15.8 21.8 14.8 24 14.8 L 26.8 14.8 C 26.8 12.6 28.2 11.8 30.4 11.8 C 32.6 11.8 34 12.6 34 14.8 L 40 14.8 C 42.2 14.8 43.5 15.8 43.5 17.6 L 43.5 21 Z"
          fill={c.bg}
          stroke="none"
        />
        <Path d="M 28.4 13.6 L 32.4 13.6" stroke={c.green} strokeWidth="1.8" />
        <Path d="M 20.5 21 L 20.5 17.6 C 20.5 15.8 21.8 14.8 24 14.8 L 26.8 14.8 C 26.8 12.6 28.2 11.8 30.4 11.8 C 32.6 11.8 34 12.6 34 14.8 L 40 14.8 C 42.2 14.8 43.5 15.8 43.5 17.6 L 43.5 21 Z" />
        <Path d="M 19.5 24.8 L 44.5 24.8" stroke={c.green} strokeWidth="2" />
      </>
    ),
  },
  Desserts: {
    word: 'DESSERTS',
    tone: 'blue',
    illo: { size: 100, end: -12, bottom: -4, rot: 8 },
    art: (c) => (
      <>
        <G transform="scale(0.6667)" strokeWidth="4.6">
          {/* cream */}
          <Path d="M21 60 C17 51 23 44 30 43 C26 37 30 31 37 30 C34 25 39 19 44 18 C46 13 50 13 52 18 C57 19 62 25 59 30 C66 31 70 37 66 43 C73 44 79 51 75 60 Z" />
          {/* cherry */}
          <Circle cx="48" cy="8" r="4.6" fill={c.green} stroke="none" />
          {/* sprinkles */}
          <G stroke={c.green} strokeWidth="4.2">
            <Path d="M36.6 51.6 L41.4 54.4" />
            <Path d="M58.6 55.3 L55.4 50.7" />
            <Path d="M39.3 39.9 L44.7 38.1" />
            <Path d="M55.4 37.2 L56.6 40.8" />
            <Path d="M46.4 24.8 L51.6 29.2" />
          </G>
          {/* container: opaque mask, green ribs, then the blue outline on top */}
          <Path
            d="M22 60 L29 84 Q30 88 35 88 H61 Q66 88 67 84 L74 60 Z"
            fill={c.bg}
            stroke="none"
          />
          <G stroke={c.green}>
            <Path d="M27 68 H69" />
            <Path d="M29.5 76 H66.5" />
            <Path d="M32 84 H64" />
          </G>
          <Path d="M22 60 L29 84 Q30 88 35 88 H61 Q66 88 67 84 L74 60 Z" />
        </G>
      </>
    ),
  },
  Signature: {
    word: 'SIGNATURE',
    tone: 'green',
    illo: { size: 124, end: -12, bottom: -12, rot: -8 },
    art: (c) => (
      <>
        <Path d="M 32 15 L 32 7 L 37.5 1.5" />
        <Path d="M 20.5 18.3 L 24.5 57 L 39.5 57 L 43.5 18.3" fill={c.bg} />
        <Rect x="18.5" y="13.5" width="27" height="4.8" rx="1.6" fill={c.blueTint} />
        <Path
          d="M 22.9 28 L 25.1 50 L 38.9 50 L 41.1 28 Z"
          fill={c.greenTint}
          stroke={c.green}
          strokeWidth="1.8"
        />
        <HouseBall c={c} />
      </>
    ),
  },
  Mojito: {
    word: 'MOJITO',
    tone: 'blue',
    illo: { size: 104, end: -12, bottom: -12, rot: 8 },
    art: (c) => (
      <>
        <Path d="M 22 16 L 24 56 L 40 56 L 42 16 Z" fill={c.bg} stroke="none" />
        <Path
          d="M 23 27 C 25 25.4 28 25.4 30 27 C 32 28.6 35 28.6 37 27 C 38.3 26.3 39.7 26.2 41 27 L 40 56 L 24 56 Z"
          fill={c.green}
          fillOpacity=".38"
          stroke="none"
        />
        <Path d="M 35 27.6 L 35 13 Q 35 10.9 33.5 9.4 L 28 3.9" />
        <Path
          d="M 23 27 C 25 25.4 28 25.4 30 27 C 32 28.6 35 28.6 37 27 C 38.3 26.3 39.7 26.2 41 27"
          stroke={c.green}
          strokeWidth="1.8"
        />
        {/* mint leaf */}
        <G transform="translate(78.5 0) scale(-1 1)">
          <Path
            transform="translate(36.5 16) scale(1.35) translate(-36.5 -16)"
            d="M 36.5 16 c -4.93 0 -7.07 -2.4 -7.07 -6.13 c 4.4 -0.8 7.07 1.73 7.07 6.13 z"
            fill={c.green}
            stroke={c.green}
            strokeWidth="0.55"
          />
          <G transform="translate(36.5 16) scale(1.35) translate(-36.5 -16)" stroke={c.greenLight}>
            <Path d="M 35.7 15.05 Q 33 12.6 30.35 10.75" strokeWidth="0.75" />
            <Path
              d="M 34.29 13.86 Q 35.1 13.3 34.95 12.6 M 33.03 12.78 Q 32.5 13.4 31.75 13.3 M 31.77 11.74 Q 32.6 11.2 32.45 10.5"
              strokeWidth="0.7"
            />
          </G>
        </G>
        {/* umbrella */}
        <G transform="translate(-24 -1)">
          <G transform="rotate(-45 46 16)" stroke={c.green}>
            <Path d="M 39 16 A 7 7 0 0 1 53 16 Z" fill={c.bg} strokeWidth="2" />
            <Path
              d="M 40.4 16 A 5.6 5.6 0 0 1 51.6 16 Z"
              fill={c.green}
              fillOpacity=".3"
              strokeWidth="1.3"
            />
            <Path
              d="M 46.89 15.35 L 50.53 12.71 M 46.34 14.95 L 47.73 10.67 M 45.66 14.95 L 44.27 10.67 M 45.11 15.35 L 41.47 12.71"
              strokeWidth="1.1"
            />
            <Path d="M 44.9 16 A 1.1 1.1 0 0 1 47.1 16" strokeWidth="1.1" />
          </G>
        </G>
        <Path d="M 22 16 L 24 56 L 40 56 L 42 16 Z" />
      </>
    ),
  },
  Healthy: {
    word: 'HEALTHY',
    tone: 'green',
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (c) => (
      <>
        <Path d="M 29 7 L 38 10.5 L 38 15" />
        <Path d="M 21 15 L 43 15 L 41.5 21 L 22.5 21 Z" fill={c.blueTint} />
        <Path d="M 22.5 21 L 26 56 L 38 56 L 41.5 21" fill={c.bg} />
        <Path
          d="M 24.2 31 L 25.2 41 L 38.8 41 L 39.8 31 Z"
          fill={c.greenTint}
          stroke={c.green}
          strokeWidth="1.8"
        />
        <Path d="M 32 33.2 L 32 38.8 M 29.2 36 L 34.8 36" strokeWidth="2.6" />
        <Path d="M 22.5 21 L 26 56 L 38 56 L 41.5 21" />
      </>
    ),
  },
  'Specialty Coffee': {
    word: 'SPECIALTY',
    tone: 'blue',
    illo: { size: 104, end: -12, bottom: -12, rot: -8 },
    art: (c) => (
      <>
        {/* liquid */}
        <Path
          d="M19 25 L22.4 45.6 L23.2 50.4 Q23.4 51.6 24.8 51.6 L39.2 51.6 Q40.6 51.6 40.8 50.4 L41.6 45.6 L45 25 Z"
          fill={c.accent}
          fillOpacity=".72"
          stroke="none"
        />
        {/* crema band */}
        <Path d="M19 25 L19.8 31.5 Q32 34.6 44.2 31.5 L45 25 Z" fill={c.greenTint} stroke="none" />
        {/* arched panels */}
        <Path
          d="M23.3 50.4 L23.4 43.8 Q23.5 42 24.9 42 Q26.3 42 26.4 43.8 L26.5 50.4"
          strokeWidth="1.6"
          opacity=".4"
        />
        <Path
          d="M28.7 50.4 L28.7 43.8 Q28.7 42 32 42 Q35.3 42 35.3 43.8 L35.3 50.4"
          strokeWidth="1.6"
          opacity=".4"
        />
        <Path
          d="M37.6 50.4 L37.7 43.8 Q37.8 42 39.2 42 Q40.6 42 40.7 43.8 L40.8 50.4"
          strokeWidth="1.6"
          opacity=".4"
        />
        {/* glass */}
        <Path
          d="M19 25 L22.4 45.6 L23.2 50.4 Q23.4 51.6 24.8 51.6 L39.2 51.6 Q40.6 51.6 40.8 50.4 L41.6 45.6 L45 25"
          strokeWidth="2.6"
        />
        <Ellipse
          cx="32"
          cy="25"
          rx="9.8"
          ry="3.15"
          fill={c.greenTint}
          stroke={c.green}
          strokeWidth="1.1"
        />
        <Ellipse cx="32" cy="25" rx="13" ry="4.2" strokeWidth="2.6" />
      </>
    ),
  },
};

/** The drawing for a category, or undefined when the name is not one of the design's. */
export const categoryArtFor = (nameEn: string): CategoryArt | undefined => SECTION_ART[nameEn];

/** The theme's colours for the drawings (see the mapping above). */
export function useCategoryArtColors(): CategoryArtColors {
  const { colors } = useTheme();
  return {
    accent: colors.blue,
    bg: colors.card,
    blueTint: colors.tint,
    greenTint: colors.gtint,
    green: brand.green,
    greenLight: colors.gline,
  };
}

/** One drawing, `size` points square, at the web band's stroke weight. Decorative. */
export function CategoryArtwork({ art, size }: { art: CategoryArt; size: number }) {
  const c = useCategoryArtColors();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke={c.accent}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
    >
      {art.art(c)}
    </Svg>
  );
}

/** The web band's size, scaled to the phone: the band is 96 px tall there, 80 here. */
const BAND_H = 80;
const ILLO_SCALE = BAND_H / 96;

/**
 * A category's heading, as the web menu draws it (`MenuStage`): a tinted band with the section's
 * name and its drawing hanging off the trailing corner, cut by the band's edge. English shows the
 * design's word (COFFEE), Arabic the operator's Arabic name. A category with no drawing keeps the
 * band, blue, with its own name.
 *
 * The drawing tilts per section; in Arabic it mirrors with the layout, so a straw or a handle that
 * leans into the text in English leans into it in Arabic too (the web's `.tp-stage__illo` rules).
 */
export function CategoryBand({ nameEn, nameAr }: { nameEn: string; nameAr: string }) {
  const { colors, fonts, tracking } = useTheme();
  const { locale, dir } = useLocale();
  const art = categoryArtFor(nameEn);
  const rtl = dir === 'rtl';
  const green = art?.tone === 'green';
  const word =
    locale === 'ar' ? pickText(nameEn, nameAr, locale) : (art?.word ?? nameEn.toUpperCase());
  // Long words step down so they never run under the drawing, as on the web.
  const fontSize = (rtl ? 6 : 0) + (word.length > 9 ? 19 : word.length > 6 ? 21 : 23);
  const size = art ? Math.round(art.illo.size * ILLO_SCALE) : 0;
  return (
    <View
      accessibilityRole="header"
      style={{
        height: BAND_H,
        borderRadius: radius.card,
        overflow: 'hidden',
        justifyContent: 'center',
        paddingStart: space.l,
        // Room for the part of the drawing that shows inside the band.
        paddingEnd: art ? size + art.illo.end * ILLO_SCALE + space.s : space.l,
        backgroundColor: green ? colors.gtint : colors.tint,
      }}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{
          fontFamily: fonts.display800,
          fontSize,
          lineHeight: Math.round(fontSize * 1.3),
          letterSpacing: rtl ? 0 : tracking(fontSize * 0.04),
          color: green ? colors.gtext : colors.blue,
        }}
      >
        {word}
      </Text>
      {art ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            end: art.illo.end * ILLO_SCALE,
            bottom: art.illo.bottom * ILLO_SCALE,
            transform: [{ rotate: `${rtl ? art.illo.rot : -art.illo.rot}deg` }],
          }}
        >
          <View style={mirror(dir)}>
            <CategoryArtwork art={art} size={size} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The stand-in for an item with no photo: its category's own drawing on dark mode's green in dark mode and the blue tint in light mode, filling
 * a `width` x `height` box. A category with no drawing keeps the generic cup on the green tint.
 */
export function CategoryPlaceholder({
  nameEn,
  width,
  height,
  fill,
}: {
  nameEn: string;
  width: number | '100%';
  height?: number;
  /** Fill the parent's box instead of taking a 4:3 frame of the given width. */
  fill?: boolean;
}) {
  const { colors, appearance } = useTheme();
  const art = categoryArtFor(nameEn);
  const box = typeof width === 'number' ? Math.min(width, height ?? width) : (height ?? 0);
  return (
    <View
      style={{
        width,
        height: fill ? '100%' : height,
        aspectRatio: !fill && height === undefined ? 4 / 3 : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: appearance === 'dark' ? palettes.dark.gtint : colors.tint,
      }}
    >
      {art ? (
        <CategoryArtwork art={art} size={box > 0 ? Math.round(box * 0.78) : 160} />
      ) : (
        <CupIcon size={box > 0 ? Math.round(box * 0.4) : 56} color={colors.gstrong} />
      )}
    </View>
  );
}
