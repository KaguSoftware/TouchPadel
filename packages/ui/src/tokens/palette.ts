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
  '--tp-surface': '#F6F7F5', // near-white with a hint of the gray
  '--tp-accent': '#3360AB', // primary interactive
  '--tp-accent-contrast': '#FFFFFF',
  '--tp-accent-2': '#A5D06F', // secondary accent / success-ish highlights
  '--tp-accent-2-contrast': '#000000',
  '--tp-muted': '#BCBDBF',
  '--tp-muted-fg': '#5C5E62', // darkened gray for readable secondary text
  '--tp-border': '#D9DADC',
  '--tp-danger': '#B3261E',
  '--tp-danger-contrast': '#FFFFFF',
} as const satisfies PaletteVars;

export const cafePalette = {
  // raw brand colors — the approved 2026 Touch Cafe menu design pairs the deep
  // Touch blue with the padel green; there is no brown anywhere in it, so the
  // second brand colour is green and `--tp-cafe-brown*` survives only as a
  // deprecated alias (tokens/cafeBrand.ts) for modules still naming it.
  '--tp-brand-blue': '#2456B4',
  '--tp-brand-green': '#7FB05A',
  '--tp-brand-white': '#FFFFFF',

  // semantic tokens (same shape as padel)
  '--tp-bg': '#FFFFFF',
  '--tp-fg': '#1E2B45', // near-black cooled toward the blue (design body ink)
  '--tp-surface': '#EDF2FB', // the design's blue section band
  '--tp-accent': '#2456B4',
  '--tp-accent-contrast': '#FFFFFF',
  '--tp-accent-2': '#7FB05A',
  '--tp-accent-2-contrast': '#FFFFFF',
  '--tp-muted': '#9AA6B8',
  '--tp-muted-fg': '#7D8CA6',
  '--tp-border': '#F0F3F8', // the hairline under every menu row
  '--tp-danger': '#E8432A',
  '--tp-danger-contrast': '#FFFFFF',
} as const satisfies PaletteVars;

export const palettes: Record<ThemeName, PaletteVars> = {
  padel: padelPalette,
  cafe: cafePalette,
  operator: operatorPalette,
};
