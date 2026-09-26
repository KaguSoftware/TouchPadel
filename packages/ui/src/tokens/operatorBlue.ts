/**
 * Operator BLUE MODE — the operator theme's second appearance
 * (`data-theme="operator"` + `data-mode="blue"`).
 *
 * The owner asked for a dark mode that is not dark: "instead of using dark
 * colours just use the brand's blue", and then, when the first cut sat on a
 * deeper ramp, "use the exact same blue, no change at all" (2026-09-19). So
 * the PAGE IS #3360AB, unmodified, and the ink on it is white and the brand
 * gray's lighter shades. Panels step DOWN from the page rather than up, because
 * the only direction with room for text is darker: white on #3360AB is 6.17:1,
 * and a panel one step lighter (L50) would already drop it under 5:1.
 *
 * Every blue is an EXACT shade of #3360AB — HSL hue 217.5, saturation 54.05%,
 * lightness the only thing that moves — the same rule the mobile app's blue
 * mode follows (`apps/mobile/src/theme/tokens.ts`, `palettes.dark`), and the
 * steps are that ramp's own: L29 / L33 / L38 below the page, L50 / L58 above.
 *
 * Only COLOUR tokens live here. Type, spacing, radii, z-index and layout come
 * from `operator.ts` untouched; this block is emitted after it at a higher
 * specificity (`:root[data-theme='operator'][data-mode='blue']`) and overrides
 * only what it names.
 *
 * Contrast (WCAG, computed 2026-09-19):
 *   white on --tp-bg 6.17:1 · white on --tp-surface 7.46:1
 *   --tp-muted-fg on --tp-bg 4.68:1 · on --tp-surface 5.66:1
 *   --tp-border-input on --tp-surface 3.32:1 (1.4.11 wants 3:1)
 *   white on --tp-accent-soft / --tp-rail-active 4.98:1
 *   --tp-success-fg on -soft 5.6:1 · --tp-warn-fg on -soft 6.4:1 ·
 *   --tp-danger-fg on -soft 6.2:1 · white on --tp-danger 5.06:1
 *   the three -mark rungs on --tp-surface 3.7 – 4.2:1
 *
 * Because the accent is white here, `--tp-accent` cannot carry the brand blue
 * itself: #3360AB on #3360AB is nothing. That is the same call the mobile
 * Welcome screen makes — a white primary button with blue ink on it — and
 * `--tp-accent-contrast` flips to the brand blue to match.
 */
import type { PaletteVars } from './palette';

/** Exact shades of #3360AB, by HSL lightness. #3360AB itself is L43.53. */
const BLUE_L18 = '#152847';
const BLUE_L29 = '#224072';
const BLUE_L33 = '#274982';
const BLUE_L38 = '#2D5495';
const BLUE_L50 = '#3B6EC4';
const BLUE_L58 = '#5A85CE';

/** Shades of the brand gray #BCBDBF (the ink ramp), as the mobile app spells them. */
const GRAY_LIGHT = '#E0E0E1';
const GRAY_SOFT = '#ACADAF';

export const operatorBlueVars = {
  // ── surfaces: the page is THE brand blue; panels step down from it ───────
  '--tp-bg': 'var(--tp-brand-blue)',
  '--tp-surface': BLUE_L38,
  '--tp-surface-2': BLUE_L33,
  '--tp-surface-3': BLUE_L29,
  '--tp-fg': 'var(--tp-brand-white)',
  // The brand gray itself measures 3.28:1 on #3360AB; one step lighter clears
  // the 4.5:1 body floor on the page and on every panel.
  '--tp-muted-fg': GRAY_LIGHT,
  '--tp-muted': BLUE_L50,
  '--tp-border': BLUE_L50,
  '--tp-border-strong': BLUE_L58,
  '--tp-border-input': GRAY_SOFT,
  '--tp-overlay': `color-mix(in srgb, ${BLUE_L18} 70%, transparent)`,
  '--tp-skeleton': BLUE_L33,
  '--tp-disabled-fg': GRAY_SOFT,
  '--tp-disabled-bg': BLUE_L33,

  // ── accent: white on the blue ground, blue ink on the white ─────────────
  '--tp-accent': 'var(--tp-brand-white)',
  '--tp-accent-contrast': 'var(--tp-brand-blue)',
  '--tp-accent-hover': GRAY_LIGHT,
  '--tp-accent-active': 'var(--tp-brand-gray)',
  // Selection is one step UP from the page — the only place the ramp goes
  // lighter, so a selected row is the brightest blue on the screen.
  '--tp-accent-soft': BLUE_L50,
  '--tp-accent-soft-fg': 'var(--tp-brand-white)',
  // Hover is the accent-soft ground, as in paper mode.
  '--tp-hover': 'var(--tp-accent-soft)',
  '--tp-hover-fg': 'var(--tp-accent-soft-fg)',

  // ── status families: fills unchanged, soft grounds darkened, ink lifted ──
  '--tp-success-soft': '#334918',
  '--tp-success-mark': 'var(--tp-accent-2)',
  '--tp-success-fg': '#BCDC93',
  '--tp-warn-soft': '#4F380D',
  '--tp-warn-mark': '#E3AF4F',
  '--tp-warn-fg': '#F0CB85',
  // The filled destructive surface. The light red (#B42318-ish) sinks into the
  // blue; this is brighter and a touch warmer so it reads as red, and still
  // carries white (5.06:1). The soft family is a dusky rose desaturated toward
  // the navy — the mobile owner call of 2026-09-11: passive, not an alarm.
  '--tp-danger': '#C93B30',
  '--tp-danger-contrast': 'var(--tp-brand-white)',
  '--tp-danger-soft': '#4A2A3A',
  '--tp-danger-mark': '#E9A6AA',
  '--tp-danger-fg': '#F0B0B4',
  '--tp-info-soft': BLUE_L50,
  '--tp-info-fg': 'var(--tp-brand-white)',
  '--tp-neutral-soft': BLUE_L33,
  '--tp-neutral-mark': GRAY_SOFT,
  '--tp-neutral-fg': GRAY_LIGHT,

  // ── the rail: two steps below the page; the active pill is the selection blue
  '--tp-rail': BLUE_L29,
  '--tp-rail-2': BLUE_L33,
  '--tp-rail-fg': GRAY_LIGHT,
  '--tp-rail-fg-active': 'var(--tp-brand-white)',
  '--tp-rail-muted': GRAY_SOFT,
  '--tp-rail-active': BLUE_L50,
  '--tp-rail-border': BLUE_L38,

  // ── the kitchen board: dark on the brand ramp ────────────────────────────
  '--tp-kds-bg': BLUE_L29,
  '--tp-kds-card': BLUE_L33,
  '--tp-kds-card-2': BLUE_L38,
  '--tp-kds-fg': 'var(--tp-brand-white)',
  '--tp-kds-muted': GRAY_LIGHT,
  '--tp-kds-border': BLUE_L50,

  // ── focus ring: the halo is white, the gap is the page ───────────────────
  '--tp-ring': '0 0 0 2px var(--tp-bg), 0 0 0 4px var(--tp-brand-white)',

  // ── elevation: brand black, deeper than on paper so it still reads ───────
  '--tp-shadow-raised': '0 1px 2px rgb(0 0 0 / 0.35)',
  '--tp-shadow-popover': '0 1px 2px rgb(0 0 0 / 0.25), 0 8px 24px rgb(0 0 0 / 0.45)',
  // Glass on the blue ground: the same panel blue carried at 88%, so the menu
  // still reads as one of THIS mode's surfaces and not as a grey pane. The
  // lit hairline is white at a much lower alpha than on paper — on a dark
  // ground a 0.7 white edge reads as a stroke rather than as a highlight.
  '--tp-glass': 'rgb(45 84 149 / 0.86)',
  '--tp-glass-border': 'rgb(255 255 255 / 0.14)',
  // The sticky bar is the page ground, opaque: on a blue page a translucent
  // bar picks up the saturate() in --tp-glass-blur and reads as a lighter
  // blue band across the top, which is exactly what it must not do. Paper
  // can afford the frost because its ground is near-white; here the bar's
  // job is to hide what scrolls under it, so it takes --tp-bg flat.
  '--tp-glass-bar': 'var(--tp-brand-blue)',
  '--tp-glass-ctl': 'rgb(45 84 149 / 0.8)',
  '--tp-shadow-dialog': '0 2px 6px rgb(0 0 0 / 0.3), 0 24px 64px rgb(0 0 0 / 0.55)',
} as const satisfies PaletteVars;

export type OperatorBlueVars = typeof operatorBlueVars;

/** The attribute value ThemeProvider writes to `<html data-mode>` for this block. */
export const OPERATOR_BLUE_MODE = 'blue';
