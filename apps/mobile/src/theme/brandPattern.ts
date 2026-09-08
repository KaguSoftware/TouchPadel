/**
 * The Touch Padel line pattern: the brand's own geometry, and the one rule for
 * how it is cropped.
 *
 * The artwork itself is recovered — not redrawn — from docs/brand/identity.pdf
 * page 8 (the board titled "PATTERN", first panel); BrandPattern.tsx's header
 * carries the full account of how eleven band centre lines and a single width
 * of 16 units were pulled back out of the board's flattened union outline, and
 * why that reconstruction is exact rather than approximate. Nothing here may be
 * re-traced or nudged: the moment a number moves it stops being the brand's
 * line and becomes our impression of it.
 *
 * It lives HERE, in a module that imports nothing, because two very different
 * renderers draw the same crop of it and they have to agree to the pixel:
 * BrandPattern (react-native-svg, the page) and patternBackdrop (three.js,
 * inside the court's GL surface — see that file for why the court cannot
 * simply clear transparent and let the page show through). `slicePattern` is
 * the contract between them.
 *
 * Both renderers now read this table and neither holds a copy — BrandPattern
 * did while it was being rewritten in a parallel session, and
 * `__tests__/brandPattern.test.ts` guards against the copy coming back.
 */

/** The brand panel's own box, in its own units (identity.pdf p8, first panel). */
export const PATTERN_VIEWBOX = { width: 239.6797, height: 349.4609 } as const;

/**
 * The eleven bands, as centre lines in panel units: [x1, y1, x2, y2].
 * Endpoints run past the panel edge exactly as the board's bands do — the crop
 * is the viewBox's job, so the caps are flat and never round.
 */
export const PATTERN_LINES: readonly (readonly [number, number, number, number])[] = [
  [233.3, -6.82, -4.17, 138.2],
  [120.95, -4.54, 246.26, 177.12],
  [245.3, 19.16, -5.62, 267.8],
  [-3.21, 38.81, 235.26, 196.89],
  [74.92, -3.4, -7.22, 171.11],
  [31.81, -5.95, -4.11, 26.19],
  [20.1, 130.23, 243.69, 259.48],
  [224.51, 206.45, 1.21, 240.4],
  [232.67, 43.01, 63.62, 353.29],
  [237.23, 216.86, -2.38, 291.85],
  [241.32, 330.1, 111.56, 357.28],
];

/** The board's own band weight, for anyone who wants the poster back. */
export const PATTERN_BAND_WIDTH = 16;

/**
 * ~5.3 px on a 390 pt screen: a texture, not a poster.
 *
 * In PANEL units, so it is tied to PATTERN_ZOOM — the panel is scaled by the
 * crop, and the band with it. 1.1 units at zoom 2 renders the same 5.3 px on
 * screen that 2.2 did at zoom 1; change one and the other has to move or the
 * weight changes with it.
 */
export const PATTERN_DEFAULT_WIDTH = 1.1;

/**
 * Equal *perceived* weight, not equal alpha. Lime on the light page is 1.77:1
 * but on the dark page it is 7.85:1, so the identical drawing reads far heavier
 * in dark; matching opacities would make the two themes different designs.
 */
export const PATTERN_DEFAULT_OPACITY = { light: 0.9, dark: 0.45 } as const;

/**
 * The pattern's ink, already blended into the ground it sits on.
 *
 * react-native-svg draws the bands at an alpha over whatever is behind them;
 * the court's copy cannot. A translucent material would land in three's
 * TRANSPARENT render list, which is drawn after the opaque one — so the
 * backdrop would paint over the turf and the cage instead of under them, which
 * is the opposite of a backdrop. Nothing is ever behind the court's copy but
 * the renderer's clear colour, so the blend has an exact answer up front:
 * ground x (1 - alpha) + ink x alpha, and the material can be opaque.
 *
 * Mixed in sRGB, on the hex, because that is where the GPU blends the page's
 * copy. Doing it in three's linear working space would give a visibly
 * different green from the one above the court.
 */
export function patternInk(ground: string, ink: string, alpha: number): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  const mix = (at: number) => {
    const g = channel(ground, at);
    const i = channel(ink, at);
    return Math.round(g + (i - g) * alpha)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/**
 * How far out the panel is tiled to build the field, in panels.
 *
 * 0 gives the brand's eleven bands, which is what the board prints and what
 * this shipped first. On a phone that is too sparse to read as a pattern at all
 * (owner, 2026-09-05: "why is there barely any lines"): `slice` scales the
 * portrait panel by ~2.4x to cover a 390x844 screen, so you see a zoomed-in
 * crop of eleven lines, and the court covers the middle of it.
 *
 * 1 gives 45 bands, 2 gives 74, 3 gives 101 — and 2 was tried on a device and
 * rejected on sight (owner, 2026-09-05: "waaaaaaaayyyy too many lines, they
 * should be like less than 7"). The board's own scatter is the design; tiling
 * it turns a mark into wallpaper.
 *
 * So this is 0, and the field IS the eleven. The derivation stays because the
 * dial has to exist somewhere and one constant is a better home for it than a
 * hand-edited table — but the answer to "how dense" is the board's answer.
 *
 * Note the count does NOT converge as the radius grows (see PATTERN_MIN_GAP),
 * so there was never a right density to discover here, only one to choose.
 */
export const PATTERN_TILE_RADIUS = 0;

/**
 * The closest two parallel bands in the field may sit, in panel units.
 *
 * This is what makes tiling legitimate rather than a mess. Translating a band
 * by a lattice vector generally lands on a NEW line, and for a direction that
 * is irrational against the lattice the offsets are dense — so as the radius
 * grows, translations land arbitrarily close to bands already placed, and two
 * bands 0.4 units apart at a 1.8 weight render as one fat double-width band.
 * At radius 2 there are seven such collisions and they are plainly visible as
 * a blunder in the middle of the artwork.
 *
 * 3x the default weight: far enough that two bands always read as two.
 */
export const PATTERN_MIN_GAP = PATTERN_DEFAULT_WIDTH * 3;

/** A band as drawn: [x1, y1, x2, y2] in panel units. */
export type PatternBand = readonly [number, number, number, number];

/**
 * The bands the renderers actually draw: the brand's eleven, tiled.
 *
 * The move that makes this the brand's artwork rather than an impression of it
 * is that every band is a STRAIGHT LINE running past the panel edge. A straight
 * line has no ends to align, so translating the arrangement by whole panels and
 * taking the union has no seam anywhere — there is nothing to cut. Each band is
 * then clipped back to the panel box, which is all `slice` would show anyway.
 *
 * Built once, at module load: 275 candidates at radius 2, each checked against
 * what is already placed. Both renderers read this, so the page and the court
 * cannot draw different fields.
 */
export const PATTERN_FIELD: readonly PatternBand[] = buildField(
  PATTERN_TILE_RADIUS,
  PATTERN_MIN_GAP,
);

/** A line as a*x + b*y = c with |(a, b)| = 1, signed so the same line has one form. */
function canonical(x1: number, y1: number, x2: number, y2: number): [number, number, number] {
  let a = y2 - y1;
  let b = x1 - x2;
  const n = Math.hypot(a, b);
  a /= n;
  b /= n;
  if (a < -1e-12 || (Math.abs(a) < 1e-12 && b < 0)) {
    a = -a;
    b = -b;
  }
  return [a, b, a * x1 + b * y1];
}

/** Does the infinite line meet the panel box? The corners fall on both sides of it. */
function meetsPanel([a, b, c]: [number, number, number]): boolean {
  const corners: readonly (readonly [number, number])[] = [
    [0, 0],
    [PATTERN_VIEWBOX.width, 0],
    [0, PATTERN_VIEWBOX.height],
    [PATTERN_VIEWBOX.width, PATTERN_VIEWBOX.height],
  ];
  const side = corners.map(([x, y]) => a * x + b * y - c);
  return Math.min(...side) <= 1e-9 && Math.max(...side) >= -1e-9;
}

/** The line's chord across the panel box, so a band is a segment again. */
function clipToPanel([a, b, c]: [number, number, number]): PatternBand | null {
  const { width: W, height: H } = PATTERN_VIEWBOX;
  // Nearest point to the origin, and the direction along the line.
  const ox = a * c;
  const oy = b * c;
  const dx = -b;
  const dy = a;
  const ts: number[] = [];
  const hit = (t: number, x: number, y: number) => {
    if (x >= -1e-6 && x <= W + 1e-6 && y >= -1e-6 && y <= H + 1e-6) ts.push(t);
  };
  if (Math.abs(dx) > 1e-12) {
    for (const x of [0, W]) {
      const t = (x - ox) / dx;
      hit(t, x, oy + t * dy);
    }
  }
  if (Math.abs(dy) > 1e-12) {
    for (const y of [0, H]) {
      const t = (y - oy) / dy;
      hit(t, ox + t * dx, y);
    }
  }
  if (ts.length < 2) return null;
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  if (hi - lo < 1e-6) return null; // a corner graze, not a band
  return [ox + lo * dx, oy + lo * dy, ox + hi * dx, oy + hi * dy];
}

function buildField(radius: number, minGap: number): PatternBand[] {
  // Ring by ring, so the brand's own eleven are placed first and a crowded
  // translation from further out is the one dropped, never an original.
  const steps: [number, number][] = [];
  for (let ring = 0; ring <= radius; ring++)
    for (let i = -radius; i <= radius; i++)
      for (let j = -radius; j <= radius; j++)
        if (Math.max(Math.abs(i), Math.abs(j)) === ring) steps.push([i, j]);

  const placed: [number, number, number][] = [];
  const field: PatternBand[] = [];
  for (const [i, j] of steps)
    for (const [x1, y1, x2, y2] of PATTERN_LINES) {
      const line = canonical(
        x1 + i * PATTERN_VIEWBOX.width,
        y1 + j * PATTERN_VIEWBOX.height,
        x2 + i * PATTERN_VIEWBOX.width,
        y2 + j * PATTERN_VIEWBOX.height,
      );
      if (!meetsPanel(line)) continue;
      const crowded = placed.some(
        ([a, b, c]) => Math.abs(a * line[1] - b * line[0]) < 1e-6 && Math.abs(c - line[2]) < minGap,
      );
      if (crowded) continue;
      const band = clipToPanel(line);
      if (!band) continue;
      placed.push(line);
      field.push(band);
    }
  return field;
}

/**
 * How far past "cover" the panel is scaled, and the answer to how many bands a
 * phone sees at once.
 *
 * Plain `slice` (zoom 1) fits the panel's full height to the screen and shows
 * TEN of the eleven bands. That is more than the design wants (owner,
 * 2026-09-05: "they should be like less than 7"), and the count cannot come
 * down by dropping bands — every one of them is the brand's. So the crop tightens
 * instead: at 2 the screen holds a smaller piece of the same panel, six bands
 * cross it, and each is still the board's own line at the board's own angle.
 *
 * Both renderers reach this through `patternInBox`, so it moves the page and
 * the court together or not at all. That was NOT true when the zoom was added:
 * the page cropped with SVG's own `preserveAspectRatio="xMidYMid slice"`, which
 * cannot express a zoom, so the court doubled and the page did not — two
 * copies of the artwork at different scales on one screen. Sharing the numbers
 * was never enough; the CROP has to be shared, and there is one of it now.
 *
 * Raising this shows fewer, farther-apart bands; PATTERN_DEFAULT_WIDTH has to
 * come down with it to hold the on-screen weight.
 */
export const PATTERN_ZOOM = 2;

export interface PatternSlice {
  /** Multiply panel units by this to reach box units. */
  scale: number;
  /** Where the scaled panel's TOP-LEFT lands, in the box's own coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * `preserveAspectRatio="xMidYMid slice"`, as arithmetic.
 *
 * SVG's own words for it: scale to COVER the box, centre the overflow on both
 * axes, crop the rest — a CSS `background-size: cover`. react-native-svg does
 * this for us from the attribute; three.js has no such attribute, so the GL
 * backdrop has to be handed the same numbers. Writing it once and feeding both
 * is the only way the two crops cannot drift.
 *
 * `x` and `y` come out ZERO OR NEGATIVE — the panel is always at least as big
 * as the box, so its corner sits outside it — which is exactly the offset a
 * renderer needs to place the artwork's origin.
 */
export function slicePattern(boxWidth: number, boxHeight: number): PatternSlice {
  const scale =
    Math.max(boxWidth / PATTERN_VIEWBOX.width, boxHeight / PATTERN_VIEWBOX.height) * PATTERN_ZOOM;
  const width = PATTERN_VIEWBOX.width * scale;
  const height = PATTERN_VIEWBOX.height * scale;
  return { scale, x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

export interface PatternInBox {
  /** The field's bands, cropped and placed in the box's own coordinates. */
  bands: readonly PatternBand[];
  /** Multiply a band weight in panel units by this to get the box's units. */
  scale: number;
}

/**
 * The pattern, ready to draw in a box of this size.
 *
 * This is the ONE place the crop is applied, and it exists because there being
 * two renderers is not a reason for there to be two crops. The page hands the
 * bands straight to react-native-svg; the court's backdrop needs `slicePattern`
 * raw, because it has to turn the same offset and scale into a placement in
 * camera space rather than into coordinates. Same arithmetic, one source.
 *
 * A renderer that crops some other way — SVG's own `preserveAspectRatio`, say —
 * is a second implementation of this, and will agree right up until one of them
 * changes. That is not hypothetical: it is what put the page at 2.44x and the
 * court at 4.88x on the same screen.
 */
export function patternInBox(boxWidth: number, boxHeight: number): PatternInBox {
  const cut = slicePattern(boxWidth, boxHeight);
  return {
    bands: PATTERN_FIELD.map(
      ([x1, y1, x2, y2]) =>
        [
          cut.x + x1 * cut.scale,
          cut.y + y1 * cut.scale,
          cut.x + x2 * cut.scale,
          cut.y + y2 * cut.scale,
        ] as PatternBand,
    ),
    scale: cut.scale,
  };
}
