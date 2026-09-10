/**
 * Design tokens from the approved mobile design
 * (`docs/design/mobile-ui/Touch Padel App.dc.html`, 2026-08-31).
 *
 * Token names deliberately mirror the design file's CSS variables (--bg, --card,
 * --ink, --gtint, …) so a side-by-side check against the artboards is a straight
 * rename-free diff. Components never reference raw hex — only these tokens.
 *
 * THE PALETTE IS CLOSED (owner, 2026-09-05). Five colours exist:
 *
 *     blue  #3360AB      green #A5D06F      gray #BCBDBF
 *     black #000000      white #FFFFFF
 *
 * Everything else in this file is an EXACT shade of one of them — same hue, same
 * saturation, lightness the only free variable — or one of the two status hues
 * the owner kept (amber, red). No other hue may enter. When you need a new step,
 * take another lightness off the relevant ramp; do not eyedrop a colour.
 *
 * `palettes.dark` DIVERGES from the design file on purpose: the artboards' dark
 * mode was hand-picked navy (#0D1830 is hue 221 at L12 — a colour that merely
 * looks blue-ish), which read as "very dark" instead of as the brand. Dark is
 * now "blue mode", built from true shades of #3360AB. Light is unchanged beyond
 * a hue snap onto the exact brand hue (largest shift: 4/255, invisible).
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
  /** Primary interactive: brand #3360AB in light, white in blue mode (see below). */
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
    ink: '#1B2C47',
    mut: '#5A6D8C',
    mut2: '#41567A',
    fnt: '#8495B2',
    fnt2: '#98A7BF',
    fnt3: '#C3CCDB',
    blue: '#3360AB',
    gtint: '#ECF6DF',
    gline: '#C7E3A4',
    gtext: '#426318',
    gtext2: '#3D541F',
    gstrong: '#527F19',
    gph: '#657F45',
    ph1: '#E1EED0',
    ph2: '#EBF4DF',
    amb: '#FAF1DC',
    ambline: '#EAD9A8',
    ambtext: '#6B4E0A',
    ambstrong: '#8A6116',
    redtint: '#FBEAE8',
    redline: '#ECC7C2',
    redtext: '#B42318',
    redtext2: '#7A2E26',
    tabBg: '#FFFFFFF2',
    crtTurf: '#7D9FD8',
    crtTurfLine: '#3360AB',
    crtLine: '#FFFFFF',
    crtShadow: '#1B2C47',
    crtCast: '#1B2C4759',
    crtCast2: '#1B2C472E',
  },
  // ── Dark = "blue mode" ────────────────────────────────────────────────────
  // Every blue below is an EXACT shade of brand #3360AB: hue 217.5, saturation
  // 54.05%, lightness the only thing that moves. The old ramp was hand-picked
  // navy (#0D1830 was hue 221 at L12 — a different colour that merely looked
  // blue-ish), which is why the theme read as "very dark" rather than as the
  // brand. `line2` is the brand blue itself, unmodified.
  dark: {
    page: '#172C4F', // L20
    bg: '#1C355E', // L24
    card: '#224072', // L29
    sub: '#274982', // L33
    tint: '#284B86', // L34
    seg: '#152847', // L18
    line: '#2D5495', // L38
    line2: '#3360AB', // L43.53 — #3360AB exactly
    ink: '#FFFFFF',
    mut: '#BCBDBF', // brand gray, exactly
    mut2: '#E0E0E1',
    // Faint ramp: shades of the brand gray. Every step measures HIGHER against
    // its own ground than the light theme's equivalent does (light runs this
    // ramp at 1.48-3.06:1), so dark is nowhere fainter than the approved design.
    fnt: '#ACADAF',
    fnt2: '#919396',
    fnt3: '#696A6E',
    // Primary interactive. On a blue ground the brand blue cannot carry text —
    // #3360AB on `bg` is 1.98:1 — so the blue lives in the GROUND here and the
    // accent on top of it is white (12.21:1), exactly as the Welcome screen
    // already works. Light mode keeps #3360AB.
    blue: '#FFFFFF',
    gtint: '#334918',
    gline: '#4C6C23',
    gtext: '#A5D06F', // brand green, exactly
    gtext2: '#B7D98C',
    gstrong: '#BCDC93',
    gph: '#90C54E',
    ph1: '#263612',
    ph2: '#334918',
    amb: '#4F380D',
    ambline: '#7B5714',
    ambtext: '#E9BF72',
    ambstrong: '#E3AF4F',
    redtint: '#5A110C',
    redline: '#871A12',
    redtext: '#ED8078',
    redtext2: '#F2A29C',
    tabBg: '#1C355EF2',
    // The court is the brand blue itself, marked out in white.
    crtTurf: '#3360AB',
    crtTurfLine: '#FFFFFF',
    crtLine: '#FFFFFF',
    crtShadow: '#000000',
    // The design's dark-mode `.tpfloat` override: the court GLOWS instead of
    // casting a shadow. A blue glow is invisible on a blue ground, so it is a
    // white halo.
    crtCast: '#FFFFFF3D',
    crtCast2: '#FFFFFF1F',
  },
};

/**
 * Theme-invariant brand constants — identical in light AND dark in the design
 * (the green CTA, the navy hold/success surfaces, the on-green ink).
 */
export const brand = {
  green: '#A5D06F',
  /** Ink used ON the green CTA. Brand black, 11.85:1. */
  greenInk: '#000000',
  blue: '#3360AB',
  /**
   * The deep brand-blue ground (booking success, review, the court's hard drop
   * shadow). L20 on the brand-blue ramp — the same step as `palettes.dark.page`,
   * so a navy screen and blue mode are now the same colour rather than two
   * different invented navies.
   */
  navy: '#172C4F',
  /** Card surface on those screens. L26. */
  navyCard: '#1E3966',
  navyText: '#BCBDBF',
  navyMuted: '#9C9DA0',
  navyLine: '#274982',
  navyTrack: '#234276',
  white: '#FFFFFF',
  danger: '#B42318',
  /** Countdown bar when nearly out of time. */
  dangerSoft: '#ED8078',
  /** Summary-grid icons on Review / Booking detail. The brand green itself. */
  leaf: '#A5D06F',
  /** Success toast background — dark enough to carry the white toast label (6.76:1). */
  successToast: '#466421',
  /** Ink on the white "Sign in" button of the Welcome screen. */
  welcomeInk: '#3360AB',
  /** Welcome screen gradient stops, 168deg — three steps of the brand-blue ramp. */
  welcomeGradient: ['#274982', '#3360AB', '#2D5495'] as const,
  /** Modal scrims: notice sheet (66) and confirmation dialog (80). Brand black. */
  scrim: '#00000066',
  scrimStrong: '#00000080',
  /**
   * The smiley ball's line work — the artwork's own navy, as the racket decal
   * paints it (`courtTransition/racket.ts` COLORS.frame). One step off
   * `palettes.light.ink` and genuinely its own value: it comes out of the
   * brand PDF, not off the blue ramp.
   */
  markInk: '#1B2A47',
  /** Court illustration: ball fill/glow and the green rackets' darker edge. */
  ballFill: '#FFFFFF',
  racketEdge: '#77A937',
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

/**
 * `#RRGGBB` + alpha → `#RRGGBBAA`. RN accepts 8-digit hex everywhere a colour
 * goes (the tab bar tint is one), which is what lets a translucent shade be
 * built out of a PALETTE token rather than a hard-coded rgba() — so it follows
 * the theme instead of being a third colour that has to be kept in step.
 *
 * Every palette entry is a 7-character hex, so the slice is safe; an 8-digit
 * input has its existing alpha replaced rather than multiplied.
 */
export const withAlpha = (hex: string, alpha: number): string =>
  hex.slice(0, 7) +
  Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

/** Spacing scale (px). The design works on a 16px gutter with 8/12/14 steps. */
export const space = { xs: 4, s: 8, sm: 12, m: 14, l: 16, xl: 20, xxl: 26 } as const;

/** Corner radii straight from the design. */
export const radius = { cell: 12, button: 14, card: 16, sheet: 20, pill: 99 } as const;

/**
 * Cross-platform shadows (RN 0.81 `boxShadow` renders on iOS AND Android under
 * the new architecture; the legacy `shadow*` props were iOS-only and a stray
 * `elevation` drew grey halos on Android). Values from the design.
 *
 * Lengths MUST carry `px`: RN's parser (`processBoxShadow.parseLength`) accepts
 * a bare number only when it is `0`, and one rejected length drops the WHOLE
 * shadow silently (seen on device 2026-09-02 — no shadow anywhere).
 */
export const shadows = {
  /** Segmented-control thumb: `0 1px 2px rgba(27,42,71,.12)`. */
  thumb: '0 1px 2px rgba(27,42,71,0.12)',
  /** Confirmation dialog card: `0 12px 40px rgba(16,24,40,.25)`. */
  dialog: '0 12px 40px rgba(16,24,40,0.25)',
  /** Toast pill: `0 6px 20px rgba(16,24,40,.25)`. */
  toast: '0 6px 20px rgba(16,24,40,0.25)',
  /** The booking sheet over the court (transition prototype): `0 20px 50px rgba(27,42,71,.2)`; a deeper black in dark mode. */
  sheet: '0 20px 50px rgba(27,42,71,0.2)',
  sheetDark: '0 20px 50px rgba(0,0,0,0.45)',
} as const;

/**
 * Font families by role. Lama Sans carries Latin and Arabic in the same faces,
 * so a role resolves to one family in both languages — no per-script fork, the
 * same swap-point discipline as `packages/ui/src/tokens/typography.ts`. The
 * display and body roles stay separate names because call sites say what a
 * line IS (a heading, tab or button vs. copy), which is what lets a future
 * face land as a change in this one place.
 *
 * Values are `string | undefined`: the config-error and crash screens mount
 * their own providers ABOVE the `useFonts` in app/_layout.tsx, so they paint
 * with nothing registered — every family resolves to `undefined`, the system
 * face, instead of an unregistered family name, which on iOS red-boxes
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

export const fontSets: Record<'brand' | 'system', FontSet> = {
  /** Every value is a key of BRAND_FONTS in ./fonts.ts — see the note there. */
  brand: {
    display600: 'LamaSans_600SemiBold',
    display700: 'LamaSans_700Bold',
    display800: 'LamaSans_800ExtraBold',
    display900: 'LamaSans_900Black',
    body400: 'LamaSans_400Regular',
    body600: 'LamaSans_600SemiBold',
    body700: 'LamaSans_700Bold',
    body800: 'LamaSans_800ExtraBold',
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
