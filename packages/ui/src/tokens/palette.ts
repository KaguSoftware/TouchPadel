/**
 * Brand palettes as CSS-variable maps.
 *
 * Two identities (per the 2026 brand deck — `touch full brand2.pdf` governs):
 *  - "padel"  — Padel 2026: green #A5D06F / blue #3360AB — app, site, operator.
 *  - "operator" — the desktop app (tokens/operator.ts): blue-tinted paper, navy rail,
 *               dark kitchen board. Product register, see docs/DESIGN.md.
 *  - "cafe"   — Touch Cafe: blue #2456B4 / green #7FB05A — QR-menu / ordering
 *               pages, per the approved menu design (brand/Touch Cafe Menu Final).
 *
 * Both expose the SAME semantic token names (bg/fg/accent/muted/danger + surfaces)
 * so components never reference a brand color directly — only semantic vars.
 */

import { operatorPalette } from './operator';

export type ThemeName = 'padel' | 'cafe' | 'operator';

/** A palette is a flat map of CSS custom property name → value. */
export type PaletteVars = Readonly<Record<`--tp-${string}`, string>>;

export const padelPalette = {
  // raw brand colors
  '--tp-brand-green': '#A5D06F',
  '--tp-brand-blue': '#3360AB',
  '--tp-brand-black': '#000000',
  '--tp-brand-white': '#FFFFFF',
  '--tp-brand-gray': '#BCBDBF',

  // semantic tokens (derived)
  '--tp-bg': '#FFFFFF',
  '--tp-fg': '#000000',
  '--tp-surface': '#F6F6F6', // near-white: an exact shade of the brand gray
  '--tp-accent': '#3360AB', // primary interactive
  '--tp-accent-contrast': '#FFFFFF',
  '--tp-accent-2': '#A5D06F', // secondary accent / success-ish highlights
  '--tp-accent-2-contrast': '#000000',
  '--tp-muted': '#BCBDBF',
  '--tp-muted-fg': '#5C5E61', // brand gray at L37 — readable secondary text (6.5:1)
  '--tp-border': '#DADBDC', // brand gray at L86
  '--tp-danger': '#B42318', // one red across the product
  '--tp-danger-contrast': '#FFFFFF',
} as const satisfies PaletteVars;

export const cafePalette = {
  // Raw brand colours. The cafe deck names "Touch Blue #3360AB" — the SAME blue
  // as padel — so the #2456B4 that used to sit here was drift, not a second
  // identity; likewise #7FB05A for the green. Both are now the exact brand
  // values. There is no brown in the approved menu design, so `--tp-cafe-brown*`
  // survives only as a deprecated alias (tokens/cafeBrand.ts).
  '--tp-brand-blue': '#3360AB',
  '--tp-brand-green': '#A5D06F',
  '--tp-brand-white': '#FFFFFF',

  // semantic tokens (same shape as padel)
  '--tp-bg': '#FFFFFF',
  '--tp-fg': '#162A4B', // body ink: brand blue at L19 (14.32:1 on white)
  '--tp-surface': '#EFF3FA', // the design's blue section band — brand blue at L96
  '--tp-accent': '#3360AB',
  '--tp-accent-contrast': '#FFFFFF',
  '--tp-accent-2': '#A5D06F',
  '--tp-accent-2-contrast': '#000000', // white on the green was 1.77:1; black is 11.85:1
  '--tp-muted': '#ACADAF',
  '--tp-muted-fg': '#707275', // 4.82:1 on white (was 3.1:1)
  '--tp-border': '#E4EBF7', // the hairline under every menu row — brand blue at L93
  '--tp-danger': '#B42318',
  '--tp-danger-contrast': '#FFFFFF',
} as const satisfies PaletteVars;

export const palettes: Record<ThemeName, PaletteVars> = {
  padel: padelPalette,
  cafe: cafePalette,
  operator: operatorPalette,
};
