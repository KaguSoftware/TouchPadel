/**
 * Operator desktop theme — the third palette (`data-theme="operator"`).
 *
 * Why a third theme rather than editing `padel`: the mobile app and the public
 * site read the padel tokens, and a product surface wants different neutrals
 * (blue-tinted paper, a navy navigation rail, a dark kitchen board) than a
 * marketing surface. Same semantic names as the other two palettes so every
 * shared component keeps working, plus the operator-only extras below.
 *
 * All colours are OKLCH, every neutral tinted toward the brand-blue hue (262).
 * Never #000 / #fff. See docs/DESIGN.md.
 */
import type { PaletteVars } from './palette';

const HUE = 262;

export const operatorPalette = {
  // raw brand colours (Padel 2026 identity)
  '--tp-brand-green': '#A5D06F',
  '--tp-brand-blue': '#3360AB',
  '--tp-brand-teal': '#1FA79A',
  '--tp-brand-black': '#0B0F17',
  '--tp-brand-white': '#FBFBFD',
  '--tp-brand-gray': '#BCBDBF',

  // semantic (same keys as padel/cafe)
  // The surface ramp is four steps wide on purpose: page ground, panel,
  // toolbar, well. It used to be 98.5 / 99.4 / 96.4 / 93.5, which put only
  // 1.02:1 between the page and a card sitting on it — so DESIGN.md's
  // "elevation is a border first" had nothing to lean on and every panel
  // needed its outline to exist at all. Each step is now >= 1.09:1.
  '--tp-bg': `oklch(96.5% 0.005 ${HUE})`,
  '--tp-fg': `oklch(22% 0.03 ${HUE})`,
  '--tp-surface': `oklch(99.4% 0.002 ${HUE})`,
  '--tp-accent': `oklch(47% 0.13 ${HUE})`,
  '--tp-accent-contrast': `oklch(99% 0.002 ${HUE})`,
  '--tp-accent-2': 'oklch(80% 0.13 125)',
  '--tp-accent-2-contrast': `oklch(22% 0.03 ${HUE})`,
  '--tp-muted': `oklch(86% 0.012 ${HUE})`,
  '--tp-muted-fg': `oklch(48% 0.025 ${HUE})`,
  '--tp-border': `oklch(90% 0.01 ${HUE})`,
  '--tp-danger': 'oklch(52% 0.19 27)',
  '--tp-danger-contrast': `oklch(99% 0.002 ${HUE})`,
} as const satisfies PaletteVars;

/** Operator-only extras, emitted inside the operator theme block. */
export const operatorVars = {
  // surfaces
  '--tp-surface-2': `oklch(93.5% 0.008 ${HUE})`,
  '--tp-surface-3': `oklch(90% 0.011 ${HUE})`,
  '--tp-border-strong': `oklch(82% 0.015 ${HUE})`,
  // A boundary you must SEE to operate — input, select, textarea, outlined
  // button. WCAG 1.4.11 wants 3:1 for those; --tp-border-strong measures
  // 1.72:1 on --tp-surface and was doing this job anyway. 3.18:1.
  '--tp-border-input': `oklch(65% 0.02 ${HUE})`,
  '--tp-overlay': `oklch(20% 0.03 ${HUE} / 0.5)`,
  // The loading ground. --tp-surface-3 sat at 1.09:1 against the panel it
  // renders on, so a skeleton read as an empty panel rather than as pending.
  '--tp-skeleton': `oklch(90% 0.012 ${HUE})`,
  // The third text colour rulebook 10.4 asks for. Disabled is currently
  // opacity 0.5 applied to a whole control, which fades its border and its
  // icon by the same amount and cannot be reasoned about.
  '--tp-disabled-fg': `oklch(62% 0.015 ${HUE})`,
  '--tp-disabled-bg': `oklch(94% 0.006 ${HUE})`,
  '--tp-opacity-disabled': '0.5',

  // accent states
  '--tp-accent-hover': `oklch(42% 0.13 ${HUE})`,
  '--tp-accent-active': `oklch(38% 0.13 ${HUE})`,
  '--tp-accent-soft': `oklch(94% 0.03 ${HUE})`,
  '--tp-accent-soft-fg': `oklch(38% 0.12 ${HUE})`,

  // Status families. Four rungs each, and the rung decides the job:
  //   FILL   a ground large enough to read colour off (a chip, a band)
  //   SOFT   the tinted ground a label sits on
  //   MARK   a DOT, an icon, a 2px rule — anything small. The fills measure
  //          1.78:1 (success) and 1.87:1 (warn) on paper, so a 7px dot drawn
  //          in one is invisible; these are ~4:1 and exist for that reason.
  //   FG     text on the soft ground
  // Padel Green is declared once, as --tp-accent-2, and aliased from here.
  // It used to be spelled out identically in four places, so a partial edit
  // could silently split the identity between the rail, the board and a badge.
  '--tp-success': 'var(--tp-accent-2)',
  '--tp-success-soft': 'oklch(95% 0.05 125)',
  '--tp-success-mark': 'oklch(58% 0.13 135)',
  '--tp-success-fg': 'oklch(42% 0.11 135)',
  '--tp-warn': 'oklch(80% 0.15 78)',
  '--tp-warn-soft': 'oklch(95.5% 0.05 85)',
  '--tp-warn-mark': 'oklch(58% 0.14 70)',
  '--tp-warn-fg': 'oklch(46% 0.11 65)',
  '--tp-danger-soft': 'oklch(95% 0.03 27)',
  // --tp-danger is already 5.97:1, so it is its own mark; the alias exists so
  // a caller never has to know which families need a separate rung.
  '--tp-danger-mark': 'var(--tp-danger)',
  '--tp-danger-fg': 'oklch(45% 0.17 27)',
  '--tp-info-soft': `oklch(94% 0.03 ${HUE})`,
  '--tp-info-fg': `oklch(38% 0.12 ${HUE})`,
  '--tp-neutral-soft': `oklch(94% 0.006 ${HUE})`,
  '--tp-neutral-mark': `oklch(55% 0.02 ${HUE})`,
  '--tp-neutral-fg': `oklch(40% 0.02 ${HUE})`,

  // the navigation rail — the one committed brand surface
  '--tp-rail': `oklch(25% 0.05 ${HUE})`,
  '--tp-rail-2': `oklch(30% 0.055 ${HUE})`,
  '--tp-rail-fg': `oklch(90% 0.015 ${HUE})`,
  '--tp-rail-fg-active': 'var(--tp-brand-white)',
  '--tp-rail-muted': `oklch(68% 0.03 ${HUE})`,
  // The pill under the current screen. At 36% it measured 1.47:1 against the
  // rail — the one element on the rail whose whole job is to be found at a
  // glance was the hardest thing on it to see. 1.88:1.
  '--tp-rail-active': `oklch(42% 0.09 ${HUE})`,
  '--tp-rail-border': `oklch(34% 0.05 ${HUE})`,
  '--tp-rail-green': 'var(--tp-accent-2)',
  // The court-line motif's stroke. Was borrowed from --tp-rail-green with a
  // raw #A5D06F fallback baked into the component, so it could not be tuned
  // per surface and it hardcoded a brand colour outside this file.
  '--tp-court-line': 'var(--tp-accent-2)',

  // the kitchen board — read across a room
  '--tp-kds-bg': `oklch(16% 0.02 ${HUE})`,
  '--tp-kds-card': `oklch(23% 0.02 ${HUE})`,
  '--tp-kds-card-2': `oklch(28% 0.025 ${HUE})`,
  '--tp-kds-fg': `oklch(96% 0.005 ${HUE})`,
  '--tp-kds-muted': `oklch(72% 0.02 ${HUE})`,
  '--tp-kds-border': `oklch(34% 0.03 ${HUE})`,
  '--tp-kds-fresh': 'var(--tp-accent-2)',
  '--tp-kds-warm': 'oklch(82% 0.16 80)',
  // Read at three metres through steam, and the most operationally important
  // colour in the product. At 62% it was 4.17:1 on the card — under the body
  // floor, and the only age state that failed it. 5.36:1.
  '--tp-kds-late': 'oklch(68% 0.20 27)',
  /** Ink on an age-state or alarm fill; was reaching for --tp-brand-black direct. */
  '--tp-kds-on-fill': 'var(--tp-brand-black)',

  // focus ring
  '--tp-ring': `0 0 0 2px oklch(99% 0.002 ${HUE}), 0 0 0 4px oklch(47% 0.13 ${HUE})`,

  // shape
  /** Chips, grid cells, skeleton blocks — below a control. Was hand-typed as
   *  '4px', '3px', '0.25rem', '0.3rem', '0.35rem' and '0.4rem' for one weight. */
  '--tp-radius-sm': '4px',
  '--tp-radius-ctl': '6px',
  '--tp-radius-panel': '10px',
  '--tp-radius-dialog': '12px',
  '--tp-radius-pill': '999px',

  // elevation (overlays only)
  /** One level, for a thumb or an active segment. Three components each
   *  invented their own neutral-black rgba on a blue-tinted surface. */
  '--tp-shadow-raised': `0 1px 2px oklch(20% 0.03 ${HUE} / 0.12)`,
  '--tp-shadow-popover': `0 1px 2px oklch(20% 0.03 ${HUE} / 0.06), 0 8px 24px oklch(20% 0.03 ${HUE} / 0.12)`,
  '--tp-shadow-dialog': `0 2px 6px oklch(20% 0.03 ${HUE} / 0.08), 0 24px 64px oklch(20% 0.03 ${HUE} / 0.22)`,

  // type scale (rem) — ratio ≈ 1.2, product register
  '--tp-fs-xs': '0.75rem',
  '--tp-fs-sm': '0.8125rem',
  '--tp-fs-md': '0.875rem',
  '--tp-fs-lg': '1rem',
  '--tp-fs-xl': '1.125rem',
  '--tp-fs-2xl': '1.375rem',
  '--tp-fs-3xl': '1.75rem',
  /** The prep board's FLOOR. It borrowed the desk scale, so the age label,
   *  the key legend and the Kbd chips landed at 11-13px on a wall screen. */
  '--tp-fs-kds-sm': '1rem',
  '--tp-fs-kds': '1.25rem',
  '--tp-fs-kds-lg': '1.75rem',

  // spacing — a true 4px scale now that the root is 16px
  '--tp-sp-0': '0.125rem',
  '--tp-sp-1': '0.25rem',
  '--tp-sp-1-5': '0.375rem',
  '--tp-sp-2': '0.5rem',
  '--tp-sp-2-5': '0.625rem',
  '--tp-sp-3': '0.75rem',
  '--tp-sp-4': '1rem',
  '--tp-sp-5': '1.5rem',
  '--tp-sp-6': '2rem',

  // Layout. Reading sizes stay in rem and scale with the root; a PHYSICAL
  // target does not — a finger is 44px whatever the root says. These four
  // were rem, and against the old 14px root they silently resolved to
  // 38.5px / 31.5px / 66.5px, breaking three promises DESIGN.md makes by name.
  '--tp-rail-w': '208px',
  '--tp-subnav-w': '176px',
  '--tp-row-h': '40px',
  '--tp-row-h-dense': '34px',
  '--tp-touch': '44px',
  '--tp-tile-min-block': '72px',
  /** Prose measure. Seven hand-picked maxInlineSize values existed. */
  '--tp-measure-form': '44rem',
  '--tp-measure-wide': '64rem',

  // Motion. One easing was not enough to express anything but arrival;
  // --tp-ease-out (easeOutQuart) arrives then stops dead when stretched past
  // --tp-dur-base, which is why --tp-ease-settle exists and why it is the
  // ONLY new curve. Every duration here has a named consumer.
  '--tp-ease-out': 'cubic-bezier(0.25, 1, 0.5, 1)',
  /** Deceleration for anything on ceremony duration. iOS sheet curve. */
  '--tp-ease-settle': 'cubic-bezier(0.32, 0.72, 0, 1)',
  '--tp-dur-fast': '160ms',
  '--tp-dur-base': '220ms',
  /**
   * Ceremony. EXACTLY ONE call site in the codebase — the sign-in swoosh.
   * Named so that it is self-evidently wrong on a button, a row or a badge:
   * `grep -rn 'dur-ceremony' apps/` must return one line. If it returns two,
   * one of them is decoration.
   */
  '--tp-dur-ceremony': '420ms',
  /** The sanctioned attention loop: stale ticket, escalated call, connecting. */
  '--tp-dur-attention': '1600ms',
  '--tp-dur-spin': '900ms',
  /** The distance every .tp-rise travels, so all of them provably agree. */
  '--tp-rise': '6px',

  // z-index scale
  /** Sticky table heads sat on a bare z-index:1, outside the scale. */
  '--tp-z-table-head': '5',
  '--tp-z-sticky': '10',
  '--tp-z-rail': '20',
  '--tp-z-banner': '30',
  '--tp-z-popover': '40',
  '--tp-z-overlay': '100',
  '--tp-z-lock': '150',
  '--tp-z-toast': '200',

  // fonts — the operator is Windows-only; Segoe covers Latin + Arabic without a download.
  // SWAP: the licensed faces already lead each stack; drop the files in and register @font-face.
  '--tp-font-body':
    "'Next Art', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
  '--tp-font-arabic':
    "'Frutiger LT Arabic', 'Segoe UI', 'Noto Sans Arabic', 'IBM Plex Sans Arabic', Tahoma, system-ui, sans-serif",
  '--tp-font-numeric':
    "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
  // These two resolved to the CAFE stacks (Poppins / Cascadia) from the base
  // :root block, because the operator theme never overrode them — so the
  // Next Art swap the typography comment promises never reached this app.
  '--tp-font-display':
    "'Next Art', 'Segoe UI Variable Display', 'Segoe UI', system-ui, -apple-system, sans-serif",
  '--tp-font-mono': "'Cascadia Mono', 'Consolas', 'SF Mono', 'Roboto Mono', monospace",
} as const satisfies Readonly<Record<`--tp-${string}`, string>>;

export type OperatorVars = typeof operatorVars;

/**
 * Chart colours as plain values, because Recharts reads props and not CSS
 * custom properties. The duplication is legitimate; what it duplicated was
 * not — `features/analytics/charts/colors.ts` shipped the CAFE brand (coffee
 * brown #603813 on cream) into the operator, so every chart the owner read at
 * night was another product's identity floating on operator paper.
 *
 * Mirrors of the OKLCH tokens above. Keep them in step by hand: a chart that
 * drifts from the panel around it is worse than one that never matched.
 *
 * Series order is a categorical ramp with no brand statement in it. Padel
 * Green is deliberately absent from `series` — it means live / ready /
 * arrived / fresh everywhere else in the product, and a "page views" line
 * drawn in it would spend a word the status vocabulary needs.
 */
export const operatorChartColors = {
  /** Categorical. Distinguishable in order, and none of them is the status green. */
  series: ['#3057A3', '#7C7F94', '#1F7A8C', '#8C5BA8', '#B0763B'],
  /** "This one is the peak." The one sanctioned use of Padel Green in a chart. */
  highlight: '#ABCC6B',
  danger: '#BE2323',
  grid: '#DADEE5',
  axis: '#565E6C',
  surface: '#FCFDFE',
  ink: '#131B29',
  /** Sequential ramp, floored on the panel rather than on raw white. */
  heat: ['#F2F3F7', '#DDE3EF', '#BFCCE4', '#97AED4', '#6B8AC0', '#3057A3'],
} as const;
