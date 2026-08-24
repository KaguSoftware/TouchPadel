/**
 * Brand palettes as CSS-variable maps.
 *
 * Two identities (per the 2026 brand deck — `touch full brand2.pdf` governs):
 *  - "padel"  — Padel 2026: green #A5D06F / blue #3360AB — app, site, operator.
 *  - "cafe"   — Touch Cafe: blue #3360AB / brown #603813 — QR-menu / ordering pages.
 *
 * Both expose the SAME semantic token names (bg/fg/accent/muted/danger + surfaces)
 * so components never reference a brand color directly — only semantic vars.
 */

export type ThemeName = 'padel' | 'cafe';

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
  // raw brand colors
  '--tp-brand-blue': '#3360AB',
  '--tp-brand-brown': '#603813',
  '--tp-brand-white': '#FFFFFF',

  // semantic tokens (same shape as padel)
  '--tp-bg': '#FFFFFF',
  '--tp-fg': '#2B1A0E', // near-black warmed toward the brown
  '--tp-surface': '#F8F5F1', // warm off-white
  '--tp-accent': '#3360AB',
  '--tp-accent-contrast': '#FFFFFF',
  '--tp-accent-2': '#603813',
  '--tp-accent-2-contrast': '#FFFFFF',
  '--tp-muted': '#C9BFB4',
  '--tp-muted-fg': '#6B5D4E',
  '--tp-border': '#E0D8CE',
  '--tp-danger': '#B3261E',
  '--tp-danger-contrast': '#FFFFFF',
} as const satisfies PaletteVars;

export const palettes: Record<ThemeName, PaletteVars> = {
  padel: padelPalette,
  cafe: cafePalette,
};
