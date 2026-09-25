import { siteLightVars, siteNightVars } from '@touch/ui/tokens/site';

/**
 * The site's photo grade, as SVG filter data (components/landing/PhotoGrade.tsx renders
 * it once per page; styles/site/photo.css.ts points every photo at it).
 *
 * It is the style reference's duotone option, "blue-and-white duotone photos with a green
 * accent" (§7), built by its shade rule: each pixel's luminance is mapped onto a ramp of
 * exact Touch Blue shades (hue and saturation fixed, only lightness moves), and the one
 * thing kept in its own colour is a padel ball, so the green ball stays the brightest,
 * most saturated thing in the frame. Stock today and Touch's own photos later come out as
 * one set without anyone regrading a file.
 *
 * Two exposures of the one grade:
 * - `print` runs black → navy → Touch Blue → the light court blue → white. Crisp whites
 *   (the net tape, porcelain, the court lines), for photos no words sit on.
 * - `night` is the same idea one stop down, for the photo words sit on (the hero): black →
 *   navy → the deep blue → the line blue → Touch Blue, and never brighter. White type on
 *   it is never under 6.17:1 and the green headline line never under 3.48:1, whatever the
 *   photo; only the kept ball can be brighter, and the hero keeps it clear of the words.
 *
 * Every stop is a site token, so the ramp cannot drift from the palette.
 */
export type PhotoGrade = 'print' | 'night';

export const PHOTO_GRADE_ID: Record<PhotoGrade, string> = {
  print: 'tp-photo-grade',
  night: 'tp-photo-grade-night',
};

export const PHOTO_GRADE_RAMP: Record<PhotoGrade, readonly string[]> = {
  print: [
    siteLightVars['--tp-site-poster'], // #000000
    siteLightVars['--tp-site-navy'], // #172C4F, L20
    siteLightVars['--tp-site-block'], // #3360AB, Touch Blue
    siteLightVars['--tp-site-court-turf'], // #7D9FD8, L67
    siteLightVars['--tp-site-poster-fg'], // #FFFFFF
  ],
  night: [
    siteLightVars['--tp-site-poster'], // #000000
    siteLightVars['--tp-site-navy'], // #172C4F, L20
    siteLightVars['--tp-site-block-deep'], // #274982, L33
    siteNightVars['--tp-border'], // #2D5495, L38
    siteLightVars['--tp-site-block'], // #3360AB: the ceiling
  ],
};

/** sRGB luma (Rec. 709 weights) into all three channels: the duotone's input. */
export const LUMA_MATRIX = [
  '0.2126 0.7152 0.0722 0 0',
  '0.2126 0.7152 0.0722 0 0',
  '0.2126 0.7152 0.0722 0 0',
  '0 0 0 1 0',
].join('  ');

/**
 * The ball keeps its colour where BOTH masks let it through (alpha only; the colour rows
 * are zero). A padel ball is yellow-green: green well above blue, and red no more than a
 * little above green.
 * - GREEN_OVER_BLUE: 6·(G − B) − 0.3. Blue turf, white lines, greys and teal stay out.
 * - NOT_WARM: 12·(G − R) + 1. Skin, orange shoes and timber (red above green) stay out.
 */
export const BALL_MASK_GREEN_OVER_BLUE = '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 6 -6 0 -0.3';
export const BALL_MASK_NOT_WARM = '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -12 12 0 0 1';

/**
 * THE BALL'S LIT SIDE (fix pass 2026-09-24). A lit ball's specular side is WHITE
 * (measured on hero.jpg: 237,238,238), so the colour masks alone drop it, and the night
 * ramp, which is capped at Touch Blue, painted it blue: the hero's ball read as a yellow
 * crescent with a blue bite out of it. Colour cannot tell that white from a court line,
 * so the fill is spatial: the colour mask is blurred outward by `BALL_FILL_BLUR` px
 * (and its alpha steepened by `BALL_FILL_SLOPE`) to reach the ball's whole disc, and
 * inside that reach only what is bright and not blue is added back (the turf around the
 * ball is blue, so no halo of source pixels forms around it):
 * - BRIGHT: 8·luma − 5.6, so luma ≥ 0.825 is fully in and the turf (≈ 0.47) out.
 * - NOT_BLUE: 12·(G − B) + 1, so neutral whites are in and blue-leaning pixels out.
 * NOT_WARM applies too, so a lit face next to a ball stays graded. The masks need
 * neighbours, so the browser is their test (the screenshots in the fix-pass report).
 */
export const BALL_FILL_BLUR = 6;
export const BALL_FILL_SLOPE = 6;
export const BALL_MASK_BRIGHT =
  '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.7008 5.7216 0.5776 0 -5.6';
export const BALL_MASK_NOT_BLUE = '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 12 -12 0 1';

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `feFuncR/G/B` tableValues for a ramp: each stop's channel as 0–1, four decimals. */
export function rampTables(stops: readonly string[]): { r: string; g: string; b: string } {
  const rgb = stops.map(channels);
  const table = (i: 0 | 1 | 2) => rgb.map((c) => (c[i] / 255).toFixed(4)).join(' ');
  return { r: table(0), g: table(1), b: table(2) };
}
