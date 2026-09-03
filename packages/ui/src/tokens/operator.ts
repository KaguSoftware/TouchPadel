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
  '--tp-bg': `oklch(98.5% 0.004 ${HUE})`,
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
  '--tp-surface-2': `oklch(96.4% 0.006 ${HUE})`,
  '--tp-surface-3': `oklch(93.5% 0.009 ${HUE})`,
  '--tp-border-strong': `oklch(82% 0.015 ${HUE})`,
  '--tp-overlay': `oklch(20% 0.03 ${HUE} / 0.5)`,

  // accent states
  '--tp-accent-hover': `oklch(42% 0.13 ${HUE})`,
  '--tp-accent-active': `oklch(38% 0.13 ${HUE})`,
  '--tp-accent-soft': `oklch(94% 0.03 ${HUE})`,
  '--tp-accent-soft-fg': `oklch(38% 0.12 ${HUE})`,

  // status families (fill / soft ground / text-on-ground)
  '--tp-success': 'oklch(80% 0.13 125)',
  '--tp-success-soft': 'oklch(95% 0.05 125)',
  '--tp-success-fg': 'oklch(42% 0.11 135)',
  '--tp-warn': 'oklch(80% 0.15 78)',
  '--tp-warn-soft': 'oklch(95.5% 0.05 85)',
  '--tp-warn-fg': 'oklch(46% 0.11 65)',
  '--tp-danger-soft': 'oklch(95% 0.03 27)',
  '--tp-danger-fg': 'oklch(45% 0.17 27)',
  '--tp-info-soft': `oklch(94% 0.03 ${HUE})`,
  '--tp-info-fg': `oklch(38% 0.12 ${HUE})`,
  '--tp-neutral-soft': `oklch(94% 0.006 ${HUE})`,
  '--tp-neutral-fg': `oklch(40% 0.02 ${HUE})`,

  // the navigation rail — the one committed brand surface
  '--tp-rail': `oklch(25% 0.05 ${HUE})`,
  '--tp-rail-2': `oklch(30% 0.055 ${HUE})`,
  '--tp-rail-fg': `oklch(90% 0.015 ${HUE})`,
  '--tp-rail-muted': `oklch(68% 0.03 ${HUE})`,
  '--tp-rail-active': `oklch(36% 0.08 ${HUE})`,
  '--tp-rail-border': `oklch(34% 0.05 ${HUE})`,
  '--tp-rail-green': 'oklch(80% 0.13 125)',

  // the kitchen board — read across a room
  '--tp-kds-bg': `oklch(16% 0.02 ${HUE})`,
  '--tp-kds-card': `oklch(23% 0.02 ${HUE})`,
  '--tp-kds-card-2': `oklch(28% 0.025 ${HUE})`,
  '--tp-kds-fg': `oklch(96% 0.005 ${HUE})`,
  '--tp-kds-muted': `oklch(72% 0.02 ${HUE})`,
  '--tp-kds-border': `oklch(34% 0.03 ${HUE})`,
  '--tp-kds-fresh': 'oklch(80% 0.13 125)',
  '--tp-kds-warm': 'oklch(82% 0.16 80)',
  '--tp-kds-late': 'oklch(62% 0.22 27)',

  // focus ring
  '--tp-ring': `0 0 0 2px oklch(99% 0.002 ${HUE}), 0 0 0 4px oklch(47% 0.13 ${HUE})`,

  // shape
  '--tp-radius-ctl': '6px',
  '--tp-radius-panel': '10px',
  '--tp-radius-dialog': '12px',
  '--tp-radius-pill': '999px',

  // elevation (overlays only)
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
  '--tp-fs-kds': '1.25rem',
  '--tp-fs-kds-lg': '1.75rem',

  // spacing
  '--tp-sp-1': '0.25rem',
  '--tp-sp-2': '0.5rem',
  '--tp-sp-3': '0.75rem',
  '--tp-sp-4': '1rem',
  '--tp-sp-5': '1.5rem',
  '--tp-sp-6': '2rem',

  // layout
  '--tp-rail-w': '13.5rem',
  '--tp-row-h': '2.25rem',
  '--tp-touch': '2.75rem',

  // motion
  '--tp-ease-out': 'cubic-bezier(0.25, 1, 0.5, 1)',
  '--tp-dur-fast': '160ms',
  '--tp-dur-base': '220ms',

  // z-index scale
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
} as const satisfies Readonly<Record<`--tp-${string}`, string>>;

export type OperatorVars = typeof operatorVars;
