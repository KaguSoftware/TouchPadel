import { padelPalette } from '@touch/ui';

/**
 * RN-side theme derived from the shared @touch/ui padel palette tokens.
 * @touch/ui's ThemeProvider is DOM-only (injects CSS variables); native screens
 * consume the same semantic token VALUES through this object so both surfaces
 * stay on one palette. Visual polish is FE1's later pass.
 */
export const theme = {
  bg: padelPalette['--tp-bg'],
  fg: padelPalette['--tp-fg'],
  surface: padelPalette['--tp-surface'],
  accent: padelPalette['--tp-accent'],
  accentContrast: padelPalette['--tp-accent-contrast'],
  accent2: padelPalette['--tp-accent-2'],
  accent2Contrast: padelPalette['--tp-accent-2-contrast'],
  muted: padelPalette['--tp-muted'],
  mutedFg: padelPalette['--tp-muted-fg'],
  border: padelPalette['--tp-border'],
  danger: padelPalette['--tp-danger'],
  dangerContrast: padelPalette['--tp-danger-contrast'],
} as const;

/** Slot-state colors for the availability grid (legend uses the same map). */
export const slotColors: Record<string, { bg: string; fg: string }> = {
  free: { bg: theme.accent2, fg: theme.accent2Contrast },
  held: { bg: '#F0C868', fg: '#3A2E00' },
  booked: { bg: theme.muted, fg: theme.mutedFg },
  blocked: { bg: '#8A8C90', fg: '#FFFFFF' },
  past: { bg: theme.surface, fg: theme.muted },
};
