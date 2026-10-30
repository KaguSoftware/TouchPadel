/**
 * Operator BLUE MODE — the operator theme's second appearance
 * (`data-theme="operator"` + `data-mode="blue"`).
 *
 * The owner asked for a dark mode that is not dark: "instead of using dark
 * colours just use the brand's blue", and then "use the exact same blue, no
 * change at all" (2026-09-19). So the PAGE IS #3360AB, unmodified, and the ink
 * on it is white and the brand gray's lighter shades.
 *
 * The panel colours pass (2026-10-17, "the blue in blue mode is too blue";
 * "make the rail the darker blue and the body the true blue") kept the page
 * and changed what sits on it. The rail is a darker exact shade (L22). Panels,
 * toolbars and wells are no longer full-saturation shades of the page; they
 * are calm low-chroma inks of the same hue (INK_* below), so the work sits on
 * something quiet and the true blue frames it. The current page in the rail is
 * a Padel Green pill, as on paper: green marks what is here and now.
 *
 * Every rail blue is an EXACT shade of #3360AB — HSL hue 217.5, saturation
 * 54.05%, lightness the only thing that moves — the same rule the mobile app's
 * blue mode follows (`apps/mobile/src/theme/tokens.ts`, `palettes.dark`). The
 * kitchen board and the till's floor board keep the L29 / L33 / L38 ramp.
 *
 * Only COLOUR tokens live here. Type, spacing, radii, z-index and layout come
 * from `operator.ts` untouched; this block is emitted after it at a higher
 * specificity (`:root[data-theme='operator'][data-mode='blue']`) and overrides
 * only what it names.
 *
 * Contrast (WCAG, computed 2026-10-17; pinned in apps/operator/src/lib/tokens.test.ts):
 *   white on --tp-bg 6.17:1 · on --tp-surface 10.63:1 · on --tp-surface-2 14.40:1
 *   --tp-muted-fg on --tp-bg 4.68:1 · on --tp-surface 8.06:1 · on --tp-hover 6.68:1
 *   --tp-border-input on --tp-bg 3.28:1 · on --tp-surface 5.66:1 (1.4.11 wants 3:1)
 *   white on --tp-accent-soft 4.98:1 · --tp-accent-contrast on --tp-accent 6.17:1
 *   --tp-rail-fg on --tp-rail 9.84:1 · the green pill on the rail 7.40:1 ·
 *   --tp-rail-active-fg on the pill 8.31:1
 *   --tp-success-fg on -soft 5.6:1 · --tp-warn-fg on -soft 6.4:1 ·
 *   --tp-danger-fg on -soft 6.2:1 · white on --tp-danger 5.06:1
 *   the three -mark rungs on --tp-surface 5.32 – 6.00:1
 *   --tp-lesson on --tp-lesson-soft 7.04:1 · on --tp-surface 6.72:1
 *
 * Because the page is the brand blue, `--tp-accent` cannot carry it: #3360AB
 * on #3360AB is nothing. That is the same call the mobile Welcome screen makes
 * — a white primary button with blue ink on it — and `--tp-accent-contrast`
 * flips to the brand blue to match.
 */
import type { PaletteVars } from './palette';

/** Exact shades of #3360AB, by HSL lightness. #3360AB itself is L43.53. */
const BLUE_L18 = '#152847';
const BLUE_L22 = '#1A3156';
const BLUE_L29 = '#224072';
const BLUE_L33 = '#274982';
const BLUE_L38 = '#2D5495';
const BLUE_L50 = '#3B6EC4';
const BLUE_L58 = '#5A85CE';

/** Shades of the brand gray #BCBDBF (the ink ramp), as the mobile app spells them. */
const GRAY_LIGHT = '#E0E0E1';
const GRAY_SOFT = '#ACADAF';

/**
 * The work-area inks (panel colours pass, owner 2026-10-17: "the blue in blue
 * mode is too blue"). Panels, toolbars and wells used to be L38 / L33 / L29
 * shades of the brand blue at its full 54% saturation, so the page AND every
 * panel on it were bright blue and nothing stood out. They are now the brand
 * hue at low chroma, the operator's tinted neutrals rather than brand shades
 * (DESIGN.md allows exactly that exception), so rows sit on something calm and
 * the true blue around them reads as the brand.
 */
const INK_PANEL = '#2A3F5F'; // oklch(36.5% 0.062 259)
const INK_TOOLBAR = '#1A2A44'; // oklch(28.5% 0.052 259)
const INK_WELL = '#142238'; // oklch(25% 0.046 259)
const INK_HOVER = '#354B6E'; // oklch(41% 0.065 259)
const INK_BORDER_STRONG = '#5A6E90';

export const operatorBlueVars = {
  // ── surfaces: the page is THE brand blue; panels step down from it ───────
  '--tp-bg': 'var(--tp-brand-blue)',
  '--tp-surface': INK_PANEL,
  '--tp-surface-2': INK_TOOLBAR,
  '--tp-surface-3': INK_WELL,
  '--tp-fg': 'var(--tp-brand-white)',
  // The brand gray itself measures 3.28:1 on #3360AB; one step lighter clears
  // the 4.5:1 body floor on the page and on every panel.
  '--tp-muted-fg': GRAY_LIGHT,
  '--tp-muted': INK_HOVER,
  // White at low alpha rather than a solid ink, so an edge reads the same on
  // the true-blue page and on a panel (round 3, "more white in the blue mode").
  '--tp-border': 'rgb(255 255 255 / 0.22)',
  '--tp-border-strong': INK_BORDER_STRONG,
  // The brand gray itself: 3.28:1 on the true-blue page and 5.66:1 on a panel.
  // #ACADAF measured 2.75:1 on the page, under WCAG 1.4.11's 3:1 for a field
  // sitting straight on it (found by the round 3 contrast test, 2026-10-18).
  '--tp-border-input': 'var(--tp-brand-gray)',
  '--tp-overlay': `color-mix(in srgb, ${BLUE_L18} 70%, transparent)`,
  '--tp-skeleton': INK_HOVER,
  '--tp-disabled-fg': GRAY_SOFT,
  '--tp-disabled-bg': INK_TOOLBAR,

  // ── accent: white on the blue ground, blue ink on the white ─────────────
  '--tp-accent': 'var(--tp-brand-white)',
  '--tp-accent-contrast': 'var(--tp-brand-blue)',
  '--tp-accent-hover': GRAY_LIGHT,
  '--tp-accent-active': 'var(--tp-brand-gray)',
  // Selection is one step UP from the page — the only place the ramp goes
  // lighter, so a selected row is the brightest blue on the screen.
  '--tp-accent-soft': BLUE_L50,
  '--tp-accent-soft-fg': 'var(--tp-brand-white)',
  // Round 3 (2026-10-18) made the headers white; since 2026-10-21 (Sait) a
  // panel or table is a navy band over a deeper navy body, white ink. Inside a
  // selected row the paper palette applies (theme.ts, the cross scopes).
  '--tp-heading': 'var(--tp-brand-white)',
  '--tp-panel-head': '#2E4573',
  '--tp-panel-head-fg': 'var(--tp-brand-white)',
  '--tp-panel-body': '#1D2A42',
  '--tp-panel-edge': '#2E4573',
  // The group band and its frame wear the same navy (Sait, 2026-10-21).
  '--tp-group-head': 'var(--tp-panel-head)',
  '--tp-group-head-fg': 'var(--tp-panel-head-fg)',
  // The Breakdown's cards, calm: the deep "soft" grounds of the status
  // families (success, lesson, danger) with their light inks, and a wash into
  // the deep rail blue instead of white. A step lighter since 2026-10-21 (Sait:
  // "should be lighter", then "barely coloured, but clearly"): each ground
  // and edge at about half its colour, the same hue, then a shade darker
  // ("darker, same opacity"); its ink at 5.6:1 or more.
  '--tp-breakdown-green': '#404D33',
  '--tp-breakdown-green-fg': '#BCDC93',
  '--tp-breakdown-green-edge': '#576646',
  '--tp-breakdown-violet': '#4E3F5A',
  '--tp-breakdown-violet-fg': '#E8C0F4',
  '--tp-breakdown-violet-edge': '#655374',
  '--tp-breakdown-rose': '#4A363E',
  '--tp-breakdown-rose-fg': '#F0B0B4',
  '--tp-breakdown-rose-edge': '#624851',
  // A deep cerulean, not a brand-blue shade: BLUE_L50 is the Breakdown's own
  // header here, and the online card vanished into it (Sait, 2026-10-19).
  '--tp-breakdown-sky': '#3E556A',
  '--tp-breakdown-sky-fg': '#BFE0FA',
  '--tp-breakdown-sky-edge': '#536E87',
  '--tp-breakdown-teal': '#3C5457',
  '--tp-breakdown-teal-fg': '#B9EEE8',
  '--tp-breakdown-teal-edge': '#516C6F',
  '--tp-breakdown-gold': '#514B34',
  '--tp-breakdown-gold-fg': '#EBD98F',
  '--tp-breakdown-gold-edge': '#6B6446',
  // The Breakdown panel's own ground behind the cards (the deep rail blue in blue mode).
  '--tp-card-1': '#BCDC93',
  '--tp-card-2': '#E8C0F4',
  '--tp-card-3': '#F0B0B4',
  '--tp-card-4': '#BFE0FA',
  '--tp-card-5': '#B9EEE8',
  '--tp-card-6': '#EBD98F',
  '--tp-card-ink': '#152847',
  '--tp-breakdown-frame': 'var(--tp-panel-body)',
  '--tp-breakdown-wash': BLUE_L22,
  '--tp-breakdown-wash-mix': '45%',
  '--tp-branch-tile': 'var(--tp-panel-body)',
  '--tp-breakdown-hover-mix': '80%',
  // A hovered row also lifts 20% toward the card's light ink, so it reads
  // lighter than the row, not just more coloured (Sait, 2026-10-21).
  '--tp-breakdown-hover-lift': '20%',
  // Tables (Sait, 2026-10-19): the Breakdown's group band, a Padel Green
  // selected row and total row, a calm dark green with white ink in dark mode (Sait, 2026-10-27).
  '--tp-table-head': 'var(--tp-panel-head)',
  '--tp-table-head-fg': 'var(--tp-panel-head-fg)',
  '--tp-selected': '#38481F',
  '--tp-selected-fg': 'var(--tp-brand-white)',
  '--tp-table-total': '#38481F',
  '--tp-table-total-fg': 'var(--tp-brand-white)',
  // Deliberately the paper values: the drill's figure card and its bar look
  // the same in both modes (Sait, 2026-10-19).
  '--tp-total-card': INK_TOOLBAR,
  '--tp-total-card-fg': 'var(--tp-brand-white)',
  '--tp-total-card-muted': GRAY_LIGHT,
  '--tp-split-green': '#A5D06F',
  '--tp-split-violet': '#C9B0EC',
  '--tp-split-rose': '#E9A6AA',
  '--tp-split-sky': '#9DB4DA',
  '--tp-split-teal': '#9ED9D2',
  '--tp-split-gold': '#E6CF7A',
  // Segmented buttons: the accent blue as the track, white ink on it.
  '--tp-seg-track': 'var(--tp-accent-soft)',
  '--tp-seg-edge': BLUE_L58,
  '--tp-seg-fg': 'var(--tp-brand-white)',
  // A step DARKER on hover: white on the lighter BLUE_L58 measured 3.7:1.
  '--tp-seg-hover': BLUE_L38,
  '--tp-seg-on': '#38481F',
  '--tp-seg-on-fg': 'var(--tp-brand-white)',
  // Hover is a lift of the panel ink, not the selection blue, so a row under
  // the pointer is never mistaken for the selected one.
  '--tp-hover': INK_HOVER,
  '--tp-hover-fg': 'var(--tp-brand-white)',

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
  '--tp-neutral-soft': INK_TOOLBAR,
  '--tp-neutral-mark': GRAY_SOFT,
  '--tp-neutral-fg': GRAY_LIGHT,
  // Coaching lessons (operator.md §5.8): a pale violet ink on a deep violet
  // ground. Computed 2026-10-01: --tp-lesson on --tp-lesson-soft 7.04:1 ·
  // on --tp-surface 4.72:1 · on --tp-bg 3.90:1 (a mark wants 3:1).
  '--tp-lesson': '#E8C0F4',
  '--tp-lesson-soft': '#4B2F63',
  // Tournaments (build contracts §1.11): a pale teal ink on a deep teal ground,
  // the lesson pair's construction (light ink, dark ground) at hue 185–190.
  '--tp-tournament': '#B9EEE8',
  '--tp-tournament-soft': '#1E4F55',

  // The Keeps bookings ring (owner, 2026-10-14: "full green, full orange, full
  // red"): pure, saturated hues, each clear of the blue ground.
  '--tp-ring-kept': '#00BF0D',
  '--tp-ring-cancelled': '#FF8A00',
  '--tp-ring-no-show': '#FF2D2D',

  // The loyalty card's tier colours: the same as paper, because the card looks
  // the same in both modes (owner, 2026-10-15).
  '--tp-tier-gold': 'oklch(82% 0.15 86)',
  '--tp-tier-silver': 'oklch(84% 0.012 260)',
  '--tp-tier-bronze': 'oklch(70% 0.12 55)',
  '--tp-tier-platinum': 'oklch(86% 0.04 220)',

  // The next-booking card's floodlight (owner, 2026-10-15, "floodlit court"): a
  // sky blue glowing through the brand blue, like lights on an evening court.
  // The same in both modes, like the card.
  '--tp-floodlight': 'oklch(66% 0.13 250)',

  // The loyalty dialog's points card outline: the blue it has in blue mode (that
  // mode's --tp-border), in both modes (owner, 2026-10-15).
  '--tp-loyalty-edge': '#3B6EC4',

  // ── the rail: a darker shade of the page blue (owner, 2026-10-17: "the
  // rail the darker blue and the body the true blue"); the current page is the
  // same Padel Green pill as on paper, with brand-blue ink on it.
  '--tp-rail': BLUE_L22,
  '--tp-rail-2': BLUE_L29,
  '--tp-rail-fg': GRAY_LIGHT,
  '--tp-rail-fg-active': 'var(--tp-brand-white)',
  '--tp-rail-muted': GRAY_SOFT,
  '--tp-rail-active': 'var(--tp-accent-2)',
  '--tp-rail-active-fg': 'var(--tp-accent-2-contrast)',
  '--tp-rail-border': BLUE_L33,

  // ── the kitchen board: dark on the brand ramp ────────────────────────────
  '--tp-kds-bg': BLUE_L29,
  '--tp-kds-card': BLUE_L33,
  '--tp-kds-card-2': BLUE_L38,
  '--tp-kds-fg': 'var(--tp-brand-white)',
  '--tp-kds-muted': GRAY_LIGHT,
  '--tp-kds-border': BLUE_L50,

  // ── the till's floor board: a deep blue board on the blue page ───────────
  // Chairs step up a shade so they show on it, and the table under the
  // pointer turns white with blue ink, since white is this mode's accent.
  '--tp-floor-bg': BLUE_L33,
  '--tp-floor-edge': BLUE_L18,
  '--tp-floor-tile': 'rgb(255 255 255 / 0.05)',
  '--tp-floor-fg': 'var(--tp-brand-white)',
  '--tp-floor-muted': GRAY_LIGHT,
  '--tp-floor-line': BLUE_L50,
  '--tp-floor-wall': BLUE_L50,
  '--tp-floor-wall-side': BLUE_L29,
  '--tp-floor-pass': BLUE_L38,
  '--tp-floor-pass-side': BLUE_L29,
  '--tp-floor-free': BLUE_L38,
  '--tp-floor-free-side': BLUE_L18,
  '--tp-floor-bar': BLUE_L58,
  '--tp-floor-bar-side': BLUE_L29,
  '--tp-floor-chair': BLUE_L58,
  '--tp-floor-chair-side': BLUE_L29,
  '--tp-floor-chair-line': 'var(--tp-brand-black)',
  '--tp-floor-stool-ring': GRAY_SOFT,
  '--tp-floor-stool-ring-side': BLUE_L18,
  '--tp-floor-pot': 'var(--tp-brand-white)',
  '--tp-floor-pot-side': GRAY_SOFT,
  '--tp-floor-leaf': 'oklch(64% 0.09 128.68)',
  '--tp-floor-leaf-dark': 'oklch(48% 0.08 128.68)',
  '--tp-floor-success-side': 'oklch(50% 0.12 128.68)',
  '--tp-floor-warn-side': 'oklch(52% 0.12 70)',
  '--tp-floor-live-glow': 'oklch(80% 0.14 128.68 / 0.55)',
  '--tp-floor-hover': 'var(--tp-brand-white)',
  '--tp-floor-hover-side': 'var(--tp-brand-gray)',
  '--tp-floor-hover-fg': 'var(--tp-brand-blue)',
  '--tp-floor-hover-glow': 'rgb(255 255 255 / 0.45)',

  // ── focus ring: the halo is white, the gap is the page ───────────────────
  '--tp-ring': '0 0 0 2px var(--tp-bg), 0 0 0 4px var(--tp-brand-white)',

  // ── elevation: brand black, deeper than on paper so it still reads ───────
  '--tp-shadow-raised': '0 1px 2px rgb(0 0 0 / 0.35)',
  '--tp-shadow-popover': '0 1px 2px rgb(0 0 0 / 0.25), 0 8px 24px rgb(0 0 0 / 0.45)',
  // Glass on the blue ground: the same panel blue carried at 88%, so the menu
  // still reads as one of THIS mode's surfaces and not as a grey pane. The
  // lit hairline is white at a much lower alpha than on paper — on a dark
  // ground a 0.7 white edge reads as a stroke rather than as a highlight.
  '--tp-glass': 'rgb(42 63 95 / 0.88)',
  '--tp-glass-border': 'rgb(255 255 255 / 0.14)',
  // The sticky bar is frosted here too (Sait, 2026-10-24): the page blue at
  // 60%, as translucent as paper's bar. The blur's saturate() is held down from
  // paper's 1.9 so the content scrolling under it does not turn the band into a
  // lighter, louder blue.
  '--tp-glass-bar': 'color-mix(in srgb, var(--tp-brand-blue) 60%, transparent)',
  '--tp-glass-blur': 'blur(28px) saturate(1.25)',
  '--tp-glass-ctl': 'rgb(42 63 95 / 0.8)',
  '--tp-shadow-dialog': '0 2px 6px rgb(0 0 0 / 0.3), 0 24px 64px rgb(0 0 0 / 0.55)',
} as const satisfies PaletteVars;

export type OperatorBlueVars = typeof operatorBlueVars;

/** The attribute value ThemeProvider writes to `<html data-mode>` for this block. */
export const OPERATOR_BLUE_MODE = 'blue';
