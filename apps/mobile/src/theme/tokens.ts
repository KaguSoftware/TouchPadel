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
  /** The floating court's two-layer cast shadow (design `.tpfloat` drop-shadows). */
  crtCast: string;
  crtCast2: string;
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
    crtCast: '#1B2A4759',
    crtCast2: '#1B2A472E',
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
    // The design's dark-mode `.tpfloat` override: the court GLOWS blue instead
    // of casting a shadow.
    crtCast: '#8FB0E859',
    crtCast2: '#8FB0E82E',
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
  /** Summary-grid icons on Review / Booking detail (design literal `#6FA33A`). */
  leaf: '#6FA33A',
  /** Success toast background (design literal). */
  successToast: '#3E6318',
  /** Ink on the white "Sign in" button of the Welcome screen. */
  welcomeInk: '#132038',
  /** Welcome screen gradient stops, 168deg (design `linear-gradient(168deg, …)`). */
  welcomeGradient: ['#274B87', '#3360AB', '#2A529A'] as const,
  /** Modal scrims: notice sheet (66) and confirmation dialog (80). */
  scrim: '#10182866',
  scrimStrong: '#10182880',
  /** Court illustration: ball fill/glow and the green rackets' darker edge. */
  ballFill: '#EAF7D2',
  racketEdge: '#7FAE4C',
} as const;

/**
 * Third-party sign-in button colours — Google's official light/dark button
 * themes (developers.google.com/identity/branding-guidelines) and Apple's HIG.
 * Theme-invariant like `brand`; the Google mark is never recoloured.
 */
export const vendor = {
  google: {
    light: { bg: '#FFFFFF', stroke: '#747775', text: '#1F1F1F', pressed: '#E6E6E6' },
    dark: { bg: '#131314', stroke: '#8E918F', text: '#E3E3E3', pressed: '#2C2C2D' },
    mark: { blue: '#4285F4', green: '#34A853', yellow: '#FBBC05', red: '#EA4335' },
  },
  /** Surfaces for the busy placeholder that stands in for the native Apple button. */
  apple: { black: '#000000', white: '#FFFFFF' },
} as const;

/** Spacing scale (px). The design works on a 16px gutter with 8/12/14 steps. */
export const space = { xs: 4, s: 8, sm: 12, m: 14, l: 16, xl: 20, xxl: 26 } as const;

/** Corner radii straight from the design. */
export const radius = { cell: 12, button: 14, card: 16, sheet: 20, pill: 99 } as const;

/**
 * Cross-platform shadows (RN 0.81 `boxShadow` renders on iOS AND Android under
 * the new architecture; the legacy `shadow*` props were iOS-only and a stray
 * `elevation` drew grey halos on Android). Values from the design.
 */
export const shadows = {
  /** Segmented-control thumb: `0 1px 2px rgba(27,42,71,.12)`. */
  thumb: '0 1 2 rgba(27,42,71,0.12)',
  /** Confirmation dialog card: `0 12px 40px rgba(16,24,40,.25)`. */
  dialog: '0 12 40 rgba(16,24,40,0.25)',
  /** Toast pill: `0 6px 20px rgba(16,24,40,.25)`. */
  toast: '0 6 20 rgba(16,24,40,0.25)',
} as const;

/**
 * Font families, resolved per locale. Archivo/Mulish carry no Arabic glyphs, so
 * Arabic renders everything in Cairo — same swap-point discipline as
 * `packages/ui/src/tokens/typography.ts` (Next Art / Frutiger LT Arabic land later,
 * as a change in this one place).
 *
 * Values are `string | undefined`: when the Google-font download fails (Expo Go
 * on a slow link) every family resolves to `undefined` — the system face —
 * instead of an unregistered family name, which on iOS red-boxes
 * "Unrecognized font family" on every single <Text>.
 */
export type FontRole =
  | 'display600'
  | 'display700'
  | 'display800'
  | 'display900'
  | 'body400'
  | 'body600'
  | 'body700'
  | 'body800';

export type FontSet = Record<FontRole, string | undefined>;

export const fontSets: Record<'latin' | 'arabic' | 'system', FontSet> = {
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
  /** Platform default faces — the fallback when brand fonts are unavailable. */
  system: {
    display600: undefined,
    display700: undefined,
    display800: undefined,
    display900: undefined,
    body400: undefined,
    body600: undefined,
    body700: undefined,
    body800: undefined,
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

const slotStyleCache = new WeakMap<Palette, Record<SlotVisualState, SlotStateStyle>>();

/** Memoised per palette: SlotCell used to rebuild this object on every render of every cell. */
export function slotStateStyles(p: Palette): Record<SlotVisualState, SlotStateStyle> {
  const cached = slotStyleCache.get(p);
  if (cached) return cached;
  const styles: Record<SlotVisualState, SlotStateStyle> = {
    available: { bg: p.card, border: p.line2, borderStyle: 'solid', text: p.ink, subText: p.gstrong },
    past: { bg: 'transparent', border: 'transparent', borderStyle: 'solid', text: p.fnt3, subText: p.fnt3 },
    booked: { bg: p.sub, border: p.sub, borderStyle: 'solid', text: p.fnt2, subText: p.fnt2 },
    held: { bg: p.sub, border: p.line2, borderStyle: 'dashed', text: p.fnt2, subText: p.fnt2 },
    blocked: { bg: p.amb, border: p.ambline, borderStyle: 'solid', text: p.ambstrong, subText: p.ambstrong },
    horizon: { bg: p.tint, border: p.line, borderStyle: 'solid', text: p.fnt, subText: p.fnt },
  };
  slotStyleCache.set(p, styles);
  return styles;
}
