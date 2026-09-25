/**
 * The public Touch Padel site (apps/web: the landing page, the legal pages, 404/error):
 * `data-theme="padel"`, in two modes.
 *
 *  - LIGHT is the default block (`[data-theme='padel']`). Its values are the guest app's
 *    light palette (apps/mobile/src/theme/tokens.ts `palettes.light`), so the site and the
 *    app are one surface: ground #F3F5F9, ink #1B2C47, Touch Blue for action.
 *  - NIGHT is `[data-theme='padel'][data-mode='night']` — the app's "blue mode"
 *    (`palettes.dark`). Every blue is an exact shade of #3360AB (hue 217.5°, sat 54.05%,
 *    lightness the only thing that moves), so it reads as the brand at night, not as a
 *    grey dark mode. The accent turns WHITE, because blue cannot carry text on blue.
 *    Two attributes (0,3,0) out-specify the theme block (0,2,0) by construction — the
 *    same mechanism as the operator's blue mode (tokens/operatorBlue.ts).
 *
 * The palette is closed (docs/brand/touch-padel-style-reference.md §3): every value
 * below is one of the five brand colours or an exact lightness shade of one, plus the
 * functional status red/amber. Black (`--tp-site-poster`) is the brand's poster ground,
 * not a neutral: the deck's PLAY / SMASH / WIN posters sit on it.
 *
 * Nothing in apps/mobile or apps/operator reads these; the mobile app keeps its own
 * token file. When a value changes there, change it here.
 */

export type SiteVars = Readonly<Record<`--tp-${string}`, string>>;

/** The attribute value that switches the site to night. Light writes no `data-mode`. */
export const SITE_NIGHT_MODE = 'night';

/**
 * Light-mode extras on top of `padelPalette` (which carries the shared semantic names
 * --tp-bg / --tp-fg / --tp-accent / …). Everything here is `--tp-site-*` so it can never
 * collide with the cafe theme's own scale, which a padel subtree inherits from
 * `<html data-theme="cafe">`.
 */
export const siteLightVars = {
  '--tp-site-page': '#FFFFFF', // full-bleed paper sections
  '--tp-site-tint': '#EFF3FA', // blue-tinted chips / bands (brand blue L96)
  '--tp-site-ink-2': '#41567A', // stronger secondary text
  '--tp-site-border-strong': '#D6DEEA',
  '--tp-site-accent-hover': '#274982', // brand blue L33
  '--tp-site-green': '#A5D06F',
  '--tp-site-green-hover': '#BCDC93', // brand green, lighter step
  '--tp-site-green-ink': '#000000', // ink ON the green CTA — 11.85:1
  '--tp-site-green-text': '#426318', // green you can read on the light ground
  // Full-bleed brand block (a blue field inside the light page).
  '--tp-site-block': '#3360AB',
  '--tp-site-block-deep': '#274982',
  '--tp-site-block-muted': '#E0E0E1', // brand gray light step; #BCBDBF is only 3.28:1 on blue
  // The poster ground: brand black, both modes.
  '--tp-site-poster': '#000000',
  '--tp-site-poster-fg': '#FFFFFF',
  '--tp-site-navy': '#172C4F', // brand navy (L20), the app's success/hold ground
  // Header once the page has scrolled under it. Solid, never glass.
  '--tp-site-header-bg': '#FFFFFF',
  '--tp-site-header-border': '#E2E8F2',
  // The court-line pattern (always green bands; opacity per ground, §5.1).
  '--tp-site-pattern': '#A5D06F',
  '--tp-site-pattern-opacity': '0.9',
  '--tp-site-pattern-opacity-on-dark': '0.45',
  // The flat court illustration (the 3D court's fallback): app `crt*` tokens.
  '--tp-site-court-turf': '#7D9FD8',
  '--tp-site-court-turf-line': '#3360AB',
  '--tp-site-court-line': '#FFFFFF',
  '--tp-site-court-ball': '#FFFFFF',
  '--tp-site-court-racket-edge': '#77A937',
  '--tp-site-court-cast': 'rgba(27, 44, 71, 0.35)',
  '--tp-site-court-cast-2': 'rgba(27, 44, 71, 0.18)',
  // The ball's ground shadow on the flat court: the app's light ink (#1B2C47) by day,
  // black at night (a navy shadow vanishes into the navy turf).
  '--tp-site-court-shadow': '#1B2C47',
  // Section grounds and the two-weight headline (2026-09-23). `hero-bg` is the app's own
  // page ground, the site's default section ground (the 3D court is verified on #F3F5F9
  // and #172C4F); `band-bg` sets the lessons and app bands apart; the footer is the brand
  // navy in BOTH modes, one step deeper at night. Display sizes come from each block's
  // own column (`.tp-fit`, container units), so there is no fixed hero or poster size.
  '--tp-site-hero-bg': '#F3F5F9',
  '--tp-site-band-bg': '#FFFFFF',
  '--tp-site-footer-bg': '#172C4F', // brand navy L20
  // Two-weight headline on the page grounds: line one regular, line two heavy. On light
  // the deck's blue-on-white pair ("YOUR GAME / YOUR CHALLENGE"); green on light is
  // 1.6:1 and never carries text, so the green lives in the bands, the CTA and the ball.
  '--tp-site-display-1': '#1B2C47',
  '--tp-site-display-2': '#3360AB', // 5.66:1 on #F3F5F9
  // The vector lockup's two variable colours (style reference §2.3): colour on light,
  // white wordmark + green→white swoosh on every dark ground.
  '--tp-site-lockup-ink': '#3360AB',
  '--tp-site-lockup-swoosh-end': '#3360AB',
  // apps/mobile palettes + brand constants.
  '--tp-site-warn-fg': '#8A6116', // app ambstrong: the closed dot of the open-now pill
  '--tp-site-navy-card': '#1E3966', // app brand.navyCard, L26 (both modes)
  // Amber for a status mark that sits on a dark ground in EITHER mode (the open-now
  // pill over the hero photo): the night value of --tp-site-warn-fg.
  '--tp-site-warn-fg-on-dark': '#E3AF4F',
  // Errors on the site's own grounds (the cafe status vars are light-only).
  '--tp-site-error-bg': '#FBEAE8',
  '--tp-site-error-fg': '#B42318',
  '--tp-site-error-border': '#ECC7C2',
  // Focus: a 2px ring 3px off the element (style reference §9). The gap is the
  // outline-offset, so it is always the ground the element stands on, photo and band
  // included; a painted gap colour would be the page's ground on every block instead.
  '--tp-site-ring': '#3360AB',
  // Shadows tint toward the blue ink, never neutral grey (§8.3).
  '--tp-site-shadow-card': '0 1px 2px rgba(22, 42, 75, 0.05), 0 6px 18px rgba(22, 42, 75, 0.07)',
  '--tp-site-shadow-lift': '0 20px 50px rgba(27, 42, 71, 0.18)',
} as const satisfies SiteVars;

/**
 * Night = blue mode. Overrides the semantic names from `padelPalette` AND the light
 * extras above. Values: apps/mobile/src/theme/tokens.ts `palettes.dark` + `brand`.
 */
export const siteNightVars = {
  '--tp-bg': '#1C355E', // L24
  '--tp-fg': '#FFFFFF',
  '--tp-surface': '#224072', // L29 — cards
  '--tp-accent': '#FFFFFF', // the accent turns white on blue (12.21:1 on bg)
  '--tp-accent-contrast': '#3360AB',
  '--tp-muted': '#696A6E',
  '--tp-muted-fg': '#BCBDBF', // brand gray exactly
  '--tp-border': '#2D5495', // L38
  '--tp-danger': '#C93B30',
  '--tp-site-page': '#172C4F', // L20 — the deepest ground
  '--tp-site-tint': '#284B86', // L34
  '--tp-site-ink-2': '#E0E0E1',
  '--tp-site-border-strong': '#3360AB', // the brand blue itself
  '--tp-site-accent-hover': '#E0E0E1',
  '--tp-site-green-text': '#A5D06F', // brand green reads on navy (7.85:1 on #172C4F)
  '--tp-site-block': '#3360AB',
  '--tp-site-block-deep': '#274982',
  '--tp-site-header-bg': '#172C4F',
  '--tp-site-header-border': '#2D5495',
  '--tp-site-pattern-opacity': '0.45',
  '--tp-site-court-turf': '#3360AB',
  '--tp-site-court-turf-line': '#FFFFFF',
  // The court GLOWS on blue instead of casting a shadow (app blue mode).
  '--tp-site-court-cast': 'rgba(255, 255, 255, 0.24)',
  '--tp-site-court-cast-2': 'rgba(255, 255, 255, 0.12)',
  '--tp-site-court-shadow': '#000000',
  '--tp-site-hero-bg': '#172C4F', // L20, the app's blue-mode page
  '--tp-site-band-bg': '#1C355E', // L24
  '--tp-site-footer-bg': '#101F37', // L14, one step below the page
  '--tp-site-display-1': '#FFFFFF',
  '--tp-site-display-2': '#A5D06F', // 7.85:1 on #172C4F (style reference §3.3)
  '--tp-site-lockup-ink': '#FFFFFF',
  '--tp-site-lockup-swoosh-end': '#FFFFFF',
  '--tp-site-warn-fg': '#E3AF4F',
  // The app's blue-mode red family: a dusky rose, not an alarm.
  '--tp-site-error-bg': '#4A2A3A',
  '--tp-site-error-fg': '#E9A6AA',
  '--tp-site-error-border': '#7A4658',
  '--tp-site-ring': '#FFFFFF',
  '--tp-site-shadow-card': '0 1px 2px rgba(0, 0, 0, 0.2), 0 8px 24px rgba(0, 0, 0, 0.22)',
  '--tp-site-shadow-lift': '0 20px 50px rgba(0, 0, 0, 0.45)',
} as const satisfies SiteVars;

/**
 * Scale, shape and motion — identical in both modes. Fluid where the brand register
 * wants it (display type, section rhythm), fixed where a finger needs it.
 * Display steps are ≥1.25× apart.
 */
export const siteScaleVars = {
  // Type (Lama Sans only — the family comes from --tp-font-*).
  '--tp-site-fs-xs': '0.8125rem', // 13 — labels, legal meta
  '--tp-site-fs-sm': '0.9375rem', // 15 — secondary
  '--tp-site-fs-md': '1.0625rem', // 17 — body
  '--tp-site-fs-lg': 'clamp(1.1875rem, 1.05rem + 0.6vw, 1.4375rem)', // lead
  '--tp-site-fs-xl': 'clamp(1.5rem, 1.2rem + 1.4vw, 2.125rem)', // h3, the app band's title
  '--tp-site-fs-2xl': 'clamp(2.25rem, 1.5rem + 3.6vw, 4.25rem)', // section display
  '--tp-site-fw-body': '400',
  '--tp-site-fw-label': '800',
  '--tp-site-fw-display': '900',
  '--tp-site-lh-body': '1.6',
  '--tp-site-lh-display': '0.92', // Latin caps
  // Arabic: the brand reference's 1.45 (§4.4), so ج ح ي and the marks above and below
  // the line never clip or touch the next line.
  '--tp-site-lh-display-ar': '1.45',
  '--tp-site-track-display': '-0.02em', // Latin only; Arabic is never letter-spaced
  '--tp-site-track-label': '0.12em',
  '--tp-site-measure': '62ch',
  // Space: section rhythm and the page gutter. Inside a block the site spaces in
  // plain rem, sized per component (styles/site/*.css.ts).
  '--tp-site-section-pad': 'clamp(4.5rem, 2.5rem + 8vw, 10rem)',
  '--tp-site-gutter': 'clamp(1rem, 0.4rem + 2.6vw, 2.75rem)',
  '--tp-site-max': '1320px',
  '--tp-site-header-h': '4.25rem',
  // Shape: guest surfaces are soft (14–22), CTAs rounded-rect to pill (§8.2).
  '--tp-site-radius-sm': '10px',
  '--tp-site-radius-md': '16px',
  '--tp-site-radius-btn': '14px',
  '--tp-site-radius-pill': '999px',
  '--tp-site-touch': '48px', // minimum hit target on the site
  // Motion: "a ball in play" — quick arrival, a small settle. No bounce.
  '--tp-site-ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
  '--tp-site-dur-fast': '160ms',
  '--tp-site-dur-base': '260ms',
  '--tp-site-dur-reveal': '720ms',
  '--tp-site-stagger': '70ms',
  // Layers. `below` is a fill painted under a control's own label inside its isolated
  // stacking context (the hover layer that fades in by opacity alone).
  '--tp-site-z-below': '-1',
  '--tp-site-z-raised': '1',
  '--tp-site-z-header': '20',
  '--tp-site-z-skip': '30',
} as const satisfies SiteVars;
