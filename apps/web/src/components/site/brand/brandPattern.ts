// DATA copied from apps/mobile/src/theme/brandPattern.ts (the panel box and the eleven bands
// only; the mobile file's tiling code is not copied). Keep every value
// identical to the source.
//
// The Touch Padel court-line pattern, recovered (not redrawn) from docs/brand/identity.pdf
// page 8: eleven straight bands of one width crossing at sharp angles. Only the artwork's
// DATA is copied; the mobile file's tiling and crop arithmetic is not needed on the web,
// where SVG's own `preserveAspectRatio="… slice"` crops the panel (and a crop is all the
// brand asks for: "Never re-trace, redraw or nudge a line. Crop the real one").
//
// The mobile header asks for one copy of this table per renderer; its duplicate guard
// (`theme/__tests__/brandPattern.test.ts`) reads only BrandPattern.tsx. The web is a
// separate renderer that cannot import apps/mobile, so this is that renderer's copy.

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

/**
 * The panel less the strips where bands begin or end INSIDE it (the one from x 20.1,
 * y 130 on the left; x 224.5 and 232.7 on the right), so every band in this window
 * runs off an edge and none stops in the open. A crop, not a redraw: the club's
 * field uses it, where the whole panel showed a band starting in mid-air
 * (owner, 2026-09-25).
 */
export const PATTERN_OPEN_CROP = [22, 0, 202, PATTERN_VIEWBOX.height] as const;

// The mobile file's PATTERN_DEFAULT_OPACITY is not copied: the site's opacities are the
// tokens --tp-site-pattern-opacity(-on-dark), one value per ground, in one place.
