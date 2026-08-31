/**
 * Design tokens ported verbatim from the approved mobile design
 * (`docs/design/mobile-ui/Touch Padel App.dc.html`, 2026-08-31).
 *
 * Token names deliberately mirror the design file's CSS variables (--bg, --card,
 * --ink, --gtint, …) so a side-by-side check against the artboards is a straight
 * rename-free diff. Components never reference raw hex — only these tokens.
 */

/** One palette; `palettes.light` / `palettes.dark` share this exact shape. */
export interface Palette {
  /** Screen background behind cards/lists. */
  bg: string;
  /** Full-bleed page background (courts home). */
  page: string;
  card: string;
  /** Subdued fill: disabled cells, secondary buttons, dividers-on-card. */
  sub: string;
  /** Blue-tinted fill: date badges, info chips, horizon slots. */
  tint: string;
  /** Segmented-control track. */
  seg: string;
  line: string;
  line2: string;
  /** Primary text. */
  ink: string;
  mut: string;
  mut2: string;
  /** Faint text ramp (labels → placeholders → disabled). */
  fnt: string;
  fnt2: string;
  fnt3: string;
  /** Interactive blue (brand #3360AB in light; lifted for dark contrast). */
  blue: string;
  // green family — success/pay-at-desk/price accents
  gtint: string;
  gline: string;
  gtext: string;
  gtext2: string;
  gstrong: string;
  gph: string;
  ph1: string;
  ph2: string;
  // amber family — degraded/blocked notices
  amb: string;
  ambline: string;
  ambtext: string;
  ambstrong: string;
  // red family — errors/cancellation
  redtint: string;
  redline: string;
  redtext: string;
  redtext2: string;
  /** Translucent tab-bar background. */
  tabBg: string;
  // court illustration (courts home)
  crtTurf: string;
  crtTurfLine: string;
  crtLine: string;
  crtShadow: string;
}

export const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    bg: '#F3F5F9',
    page: '#FFFFFF',
    card: '#FFFFFF',
    sub: '#EDF0F5',
    tint: '#EFF3FA',
    seg: '#E4E9F1',
    line: '#E2E8F2',
    line2: '#D6DEEA',
    ink: '#1B2A47',
    mut: '#5A6B8C',
    mut2: '#41527A',
    fnt: '#8494B2',
    fnt2: '#98A6BF',
    fnt3: '#C3CCDB',
    blue: '#3360AB',
    gtint: '#EDF6DF',
    gline: '#CBE3A4',
    gtext: '#3E6318',
    gtext2: '#41541F',
    gstrong: '#4C7F19',
    gph: '#647F45',
    ph1: '#E2EED0',
    ph2: '#ECF4DF',
    amb: '#FAF1DC',
    ambline: '#EAD9A8',
    ambtext: '#6B4E0A',
    ambstrong: '#8A6116',
    redtint: '#FBEAE8',
    redline: '#ECC7C2',
    redtext: '#B42318',
    redtext2: '#7A2E26',
    tabBg: '#FFFFFFF2',
    crtTurf: '#7BA4DE',
    crtTurfLine: '#3E6BB0',
    crtLine: '#FFFFFF',
    crtShadow: '#1B2A47',
  },
  dark: {
    bg: '#0D1830',
    page: '#0A1326',
    card: '#16233F',
    sub: '#1E2D4D',
    tint: '#1C2C50',
    seg: '#0A1428',
    line: '#283A5E',
    line2: '#33466E',
    ink: '#EDF2FB',
    mut: '#9DAECB',
    mut2: '#B4C2DC',
    fnt: '#7E92B8',
    fnt2: '#6C80A6',
    fnt3: '#3D4F75',
    blue: '#8FB0E8',
    gtint: '#20331A',
    gline: '#3A5626',
    gtext: '#BCDF8F',
    gtext2: '#A8CD7F',
    gstrong: '#9CCB62',
    gph: '#7E9B55',
    ph1: '#1A2A14',
    ph2: '#203218',
    amb: '#33290F',
    ambline: '#4D3F17',
    ambtext: '#E7C877',
    ambstrong: '#D9B25C',
    redtint: '#3A1613',
    redline: '#5C2823',
    redtext: '#F09A8D',
    redtext2: '#E8AFA5',
    tabBg: '#0F1B36F2',
    crtTurf: '#2B5CA8',
    crtTurfLine: '#8FB0E8',
    crtLine: '#FFFFFF',
    crtShadow: '#050C1A',
  },
};

/**
 * Theme-invariant brand constants — identical in light AND dark in the design
 * (the green CTA, the navy hold/success surfaces, the on-green ink).
 */
export const brand = {
  green: '#A5D06F',
  /** Ink used ON the green CTA. */
  greenInk: '#1E3311',
  blue: '#3360AB',
  navy: '#1B2A47',
  /** Card surface on navy screens (booking success). */
  navyCard: '#243756',
  navyText: '#B9C6DE',
  navyMuted: '#8FA3C7',
  navyLine: '#3A507A',
  navyTrack: '#324569',
  white: '#FFFFFF',
  danger: '#B42318',
  /** Countdown bar when nearly out of time. */
  dangerSoft: '#E88B7D',
} as const;

/** Spacing scale (px). The design works on a 16px gutter with 8/12/14 steps. */
export const space = { xs: 4, s: 8, sm: 12, m: 14, l: 16, xl: 20, xxl: 26 } as const;

/** Corner radii straight from the design. */
export const radius = { cell: 12, button: 14, card: 16, sheet: 20, pill: 99 } as const;

/**
 * Font families, resolved per locale. Archivo/Mulish carry no Arabic glyphs, so
 * Arabic renders everything in Cairo — same swap-point discipline as
 * `packages/ui/src/tokens/typography.ts` (Next Art / Frutiger LT Arabic land later,
 * as a change in this one place).
 */
export interface FontSet {
  display600: string;
  display700: string;
  display800: string;
  display900: string;
  body400: string;
  body600: string;
  body700: string;
  body800: string;
}

export const fontSets: Record<'latin' | 'arabic', FontSet> = {
  latin: {
    display600: 'Archivo_600SemiBold',
    display700: 'Archivo_700Bold',
    display800: 'Archivo_800ExtraBold',
    display900: 'Archivo_900Black',
    body400: 'Mulish_400Regular',
    body600: 'Mulish_600SemiBold',
    body700: 'Mulish_700Bold',
    body800: 'Mulish_800ExtraBold',
  },
  arabic: {
    display600: 'Cairo_600SemiBold',
    display700: 'Cairo_700Bold',
    display800: 'Cairo_800ExtraBold',
    display900: 'Cairo_900Black',
    body400: 'Cairo_400Regular',
    body600: 'Cairo_600SemiBold',
    body700: 'Cairo_700Bold',
    body800: 'Cairo_800ExtraBold',
  },
};

/** Availability-cell styling per merged slot state (design has no legend — cells self-label). */
export type SlotVisualState = 'available' | 'past' | 'booked' | 'held' | 'blocked' | 'horizon';

export interface SlotStateStyle {
  bg: string;
  border: string;
  borderStyle: 'solid' | 'dashed';
  text: string;
  subText: string;
}

export function slotStateStyles(p: Palette): Record<SlotVisualState, SlotStateStyle> {
  return {
    available: { bg: p.card, border: p.line2, borderStyle: 'solid', text: p.ink, subText: p.gstrong },
    past: { bg: 'transparent', border: 'transparent', borderStyle: 'solid', text: p.fnt3, subText: p.fnt3 },
    booked: { bg: p.sub, border: p.sub, borderStyle: 'solid', text: p.fnt2, subText: p.fnt2 },
    held: { bg: p.sub, border: p.line2, borderStyle: 'dashed', text: p.fnt2, subText: p.fnt2 },
    blocked: { bg: p.amb, border: p.ambline, borderStyle: 'solid', text: p.ambstrong, subText: p.ambstrong },
    horizon: { bg: p.tint, border: p.line, borderStyle: 'solid', text: p.fnt, subText: p.fnt },
  };
}
