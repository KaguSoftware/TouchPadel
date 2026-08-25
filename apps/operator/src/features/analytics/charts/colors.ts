/**
 * Chart colours as LITERALS.
 *
 * Recharts renders into SVG attributes it computes in JS — it cannot read the
 * `--tp-*` CSS custom properties the rest of the operator uses, so the cafe
 * brand values are mirrored here by hand. Source of truth:
 * packages/ui/src/tokens/palette.ts (`cafePalette`). If a token changes there,
 * change it here too — nothing else in the app duplicates a colour.
 */
export const BLUE = '#3360AB'; // --tp-accent      : sales / primary series
export const BROWN = '#603813'; // --tp-accent-2   : views / peak highlight
export const INK = '#2B1A0E'; // --tp-fg
export const MUTED = '#6B5D4E'; // --tp-muted-fg   : waiter calls / secondary
export const GRID = '#E0D8CE'; // --tp-border
export const SURFACE = '#F8F5F1'; // --tp-surface
export const DANGER = '#B3261E'; // --tp-danger

/** Sequential white → blue ramp for the week heatmap (peak cell uses BROWN). */
export const HEAT_RAMP = ['#FFFFFF', '#E4EBF6', '#C3D2EA', '#93AEDA', '#5F86C6', BLUE] as const;

/** Dwell buckets of the "looked, not bought" stack, light → dark. */
export const DWELL = ['#C3D2EA', '#5F86C6', BLUE] as const;

/** Pick a ramp step for a 0..1 intensity. */
export function heatColor(intensity: number): string {
  if (!Number.isFinite(intensity) || intensity <= 0) return HEAT_RAMP[0];
  const idx = Math.min(HEAT_RAMP.length - 1, Math.max(1, Math.ceil(intensity * (HEAT_RAMP.length - 1))));
  return HEAT_RAMP[idx]!;
}
