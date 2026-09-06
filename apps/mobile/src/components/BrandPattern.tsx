/**
 * The Touch Padel line pattern, as a full-bleed backdrop.
 *
 * The geometry is the brand's OWN, not a redraw of it, but it is held as ELEVEN
 * LINE SEGMENTS rather than as the outline the brand file ships. That needs
 * explaining, because the obvious reading — that someone re-traced the artwork
 * by eye — is exactly what did not happen.
 *
 * The numbers themselves live in theme/brandPattern.ts, not here, because this
 * is not the only renderer that draws them: the court's GL backdrop
 * (courtTransition/patternBackdrop) strokes the same bands as triangles so the
 * pattern can continue behind an opaque surface, and the two crops have to
 * agree to the pixel. One table, two renderers — the account of where the
 * table came from stays here, with the drawing it was recovered for.
 *
 * docs/brand/identity.pdf page 8 (the board titled "PATTERN") draws the pattern
 * as a single flattened fill: the union outline of a set of straight bands, with
 * every crossing already boolean-ed away. Lifted verbatim that is faithful, and
 * it was what this file held first, but it is also inert — a union outline has
 * no stroke width, so the only way to make the lines thinner is to move control
 * points, i.e. to stop being the brand's artwork. On a phone that mattered: the
 * panel is portrait (0.686 w/h) against a screen nearer 0.46, so the crop scales
 * it several times over and the board's 16-unit band lands tens of pixels wide —
 * a good fraction of the screen. On the printed board that weight is right.
 * Blown up it is a wall, and it was rejected on sight (owner, 2026-09-05: "way
 * too thick and way too bold").
 *
 * So the bands were recovered instead of redrawn. Every long edge of the union
 * outline was grouped by direction and perpendicular offset; band sides come in
 * parallel pairs, and each pair gave a centre line and a width. All eleven pairs
 * came back at 16.00 units (15.97-16.07, i.e. the rounding in the file), which
 * is the tell that the reconstruction is right rather than approximately right —
 * a mis-paired edge would have produced a stray width. Re-stroking these eleven
 * segments at width 16 and diffing against the brand's own 150 dpi render gives
 * a mean absolute difference of 2.67/255, matching the 2.66 of the verbatim fill
 * it replaces. It is the same picture, with the weight now a number.
 *
 * Hence `strokeWidth`. It is in PANEL units, so the crop scales it the way it
 * scales the bands: PATTERN_DEFAULT_WIDTH of 1.1 lands about 5.3 px on a 390 pt
 * screen at the current PATTERN_ZOOM. Raise it toward 16 for the board's own
 * weight; the zoom is the other half of that sum and moving one alone changes
 * what you see.
 *
 * HOW MUCH of the board a screen holds is PATTERN_ZOOM, not how many bands
 * exist. Tiling the eleven out to seventy-four was tried and rejected on a
 * device — "waaaaaaaayyyy too many lines, they should be like less than 7"
 * (owner, 2026-09-05) — so the field is the board's own eleven and the crop
 * tightens instead: six cross a phone, each still the board's line at the
 * board's angle.
 *
 * LINES ONLY (owner's call): the brand board prints the pattern on its own
 * neutral panel, but that panel is not painted here — whatever this is laid
 * over is the ground and shows between the lines, so it follows the theme for
 * free with no second ground to keep in step. The default ink is `brand.green`,
 * off the brand's COLOUR board, not the #9CD757 the pattern board is printed in.
 *
 * `color` exists because the ink has to answer to what it is drawn ON, and the
 * answer is a contrast question, not a taste one. My bookings' hero puts the
 * pattern on two grounds: navy, where the green lightens the ground under the
 * lines (green at 0.2 takes #172C4F to #334D55, and the card's grey metadata
 * from 8:1 down to 4.78:1 — the ceiling on that alpha, not a preference); and
 * the brand green itself, where green-on-green is mud and any darker ink would
 * push that metadata under 4.5:1 wherever a line ran behind a glyph. There the
 * lines are WHITE, which lightens the ground instead, so every ink on the card
 * measures BETTER over a line than over the bare green (4.77:1 → 6.2:1).
 *
 * Opacity is per theme, and deliberately not one number. Lime on the light
 * page is 1.77:1 but on the dark page it is 7.85:1, so the identical drawing
 * reads far heavier in dark; matching opacities would make the two themes
 * different designs. PATTERN_DEFAULT_OPACITY equalises the weight by eye. One
 * alpha is applied to the whole group rather than per line, so the crossings
 * never double-blend into darker knots the way per-path opacity would.
 *
 * Memoised for the reason CourtIllustration is: the Book tab re-renders every
 * minute off the open-now clock, and each render would otherwise hand
 * react-native-svg the whole drawing to parse again for a picture that cannot
 * have changed.
 */
import { memo, useMemo, useState } from 'react';
import { StyleSheet, type LayoutRectangle } from 'react-native';
import Svg, { G, Line } from 'react-native-svg';
import { brand, useTheme } from '../theme';
import {
  PATTERN_DEFAULT_OPACITY,
  PATTERN_DEFAULT_WIDTH,
  patternInBox,
} from '../theme/brandPattern';
import { LtrIsland } from '../i18n/direction';

interface BrandPatternProps {
  /** Whole-drawing alpha. Defaults per theme; pass a number to override both. */
  opacity?: number;
  /** Band weight in panel units. `PATTERN_BAND_WIDTH` is the printed board's. */
  strokeWidth?: number;
  /** The ink the lines are drawn in — see the header before changing it. */
  color?: string;
}

function BrandPatternImpl({
  opacity,
  strokeWidth = PATTERN_DEFAULT_WIDTH,
  color = brand.green,
}: BrandPatternProps) {
  const { appearance } = useTheme();
  const alpha = opacity ?? PATTERN_DEFAULT_OPACITY[appearance];
  // The crop needs a box, and only layout knows it. One frame of bare ground at
  // mount is the cost; a `preserveAspectRatio` would avoid it and is exactly
  // what put this drawing at half the court's scale — SVG's crop cannot express
  // PATTERN_ZOOM, so the page silently kept plain cover while the court did not.
  // patternInBox is now the only crop either renderer runs.
  const [box, setBox] = useState<LayoutRectangle | null>(null);
  const cut = useMemo(() => (box ? patternInBox(box.width, box.height) : null), [box]);
  // Never mirrored. The pattern is abstract — nothing in it points anywhere —
  // so flipping it under Arabic would only make the Book tab a different
  // picture in each language, and the crop seams of a full-bleed backdrop would
  // jump the instant someone switched. Yoga never touches path data, so this
  // simply declines the `mirror(dir)` that icons.tsx opts INTO; the root is an
  // LtrIsland on top of that, pinning the subtree's layout direction, so no
  // descendant can resolve itself right-to-left either.
  return (
    <LtrIsland
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // `overflow` because the artwork is bigger than this box by construction
      // — the crop is what puts a piece of it here — and without a viewBox the
      // SVG is no longer the thing doing the clipping.
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
      onLayout={(e) => {
        const next = e.nativeEvent.layout;
        setBox((prev) =>
          prev && prev.width === next.width && prev.height === next.height ? prev : next,
        );
      }}
    >
      {cut && box ? (
        <Svg width={box.width} height={box.height}>
          <G opacity={alpha}>
            {cut.bands.map(([x1, y1, x2, y2], i) => (
              <Line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                // The prop is in PANEL units, as its doc says, so it takes the
                // crop's scale the way the coordinates do — otherwise the band
                // weight would drift every time the zoom moved.
                strokeWidth={strokeWidth * cut.scale}
                strokeLinecap="butt"
              />
            ))}
          </G>
        </Svg>
      ) : null}
    </LtrIsland>
  );
}

export const BrandPattern = memo(BrandPatternImpl);
