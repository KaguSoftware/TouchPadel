/**
 * Chart colours as LITERALS, one set per appearance.
 *
 * Recharts renders into SVG attributes it computes in JS — it cannot read the
 * `--tp-*` CSS custom properties the rest of the operator uses, so the values
 * are mirrored here by hand. That duplication is legitimate. What it used to
 * duplicate was not: this file mirrored `cafePalette` — coffee brown #603813,
 * warm ink, cream surface — so every chart the owner read at night was another
 * product's identity floating on operator paper. It now mirrors the OPERATOR
 * tokens (packages/ui/src/tokens/operator.ts and operatorBlue.ts). If a token
 * changes there, change it here too.
 *
 * Two sets because the operator has two appearances (lib/themeMode.tsx): the
 * paper one, and BLUE MODE where the brand blue is the ground. A chart takes
 * its set from `useChartColors()`, never from a module-level constant, so a
 * bar drawn in Touch Blue on paper is drawn in white on blue — the same move
 * `--tp-accent` makes in the token sheet.
 *
 * The categorical trio was not chosen by eye. It was run through a
 * colour-vision validator (lightness band, chroma floor, CVD separation,
 * normal-vision separation, contrast vs surface) and every check passes at
 * all pairs. SERIES_1 moved #3057A3 -> #3360AB (the exact brand blue) on
 * 2026-09-05; re-validated, CVD separation is unchanged and normal-vision
 * separation stays comfortably above the floor. The blue-mode trio keeps the
 * same three hues (white takes the blue's seat, rust and magenta lifted to
 * clear 4.5:1 on the blue card) so a legend learned on paper still reads.
 *
 * Two colours are deliberately ABSENT from the series:
 *   - Padel Green, which means live / ready / arrived / fresh everywhere else
 *     in the product. A "views" line drawn in it would spend a word the status
 *     vocabulary needs.
 *   - Anything outside the closed five-colour palette as a BRAND statement.
 *     SERIES_2 and SERIES_3 are not brand colours and are not trying to be:
 *     a categorical scale needs hue separation to encode data, the same
 *     reason the status red and amber survive the palette rule. Only
 *     SERIES_1 and HIGHLIGHT carry the identity, and both are exact.
 */
import { useThemeMode } from '../../../lib/themeMode';

export interface ChartColors {
  // ── Categorical — identity. Fixed order, never cycled. ───────────────────
  /** Series 1 — the accent (`--tp-accent`). Revenue, sales, the primary measure. */
  SERIES_1: string;
  /** Series 2 — rust. Views / engagement. */
  SERIES_2: string;
  /** Series 3 — magenta. Waiter calls / the third measure. */
  SERIES_3: string;
  SERIES: readonly [string, string, string];
  /** Back-compatible alias: the primary series kept its old name. */
  BLUE: string;

  // ── Emphasis — "this one is the peak" ────────────────────────────────────
  /**
   * A highlighted bar takes the accent and the rest step back. This used to be
   * the reverse — the peak in a second hue over a field of accent-blue bars —
   * which reads as two categories rather than as one emphasised value.
   */
  HIGHLIGHT: string;
  /** The un-emphasised bars beside a HIGHLIGHT one. */
  BAR_MUTED: string;
  /**
   * The hover wash Recharts paints under the bar the pointer is on: the accent
   * at low alpha so the bar visibly responds without a second colour appearing.
   */
  BAR_CURSOR: string;

  // ── Chrome — recessive, wearing text tokens rather than series colours ───
  /** Axis ticks and legends (`--tp-muted-fg`). Text never wears a series colour. */
  AXIS: string;
  /** Gridlines and axis strokes (`--tp-border`). */
  GRID: string;
  /** The chart surface (`--tp-surface`). */
  SURFACE: string;
  /** Body ink (`--tp-fg`). */
  INK: string;
  /** Status, reserved — never reused as a series (`--tp-danger`). */
  DANGER: string;
  /**
   * `MUTED` used to be both the axis-tick colour AND the waiter-calls series,
   * so a data line was drawn in the text token. Kept as an alias for the
   * chrome meaning only; series callers take SERIES_3.
   */
  MUTED: string;

  // ── Sequential — magnitude. One hue, monotone lightness. ─────────────────
  /** Six steps, floored on the page ground rather than on raw white. */
  HEAT_RAMP: readonly [string, string, string, string, string, string];
  /** Dwell buckets of the "looked, not bought" stack, light → dark: same ramp. */
  DWELL: readonly [string, string, string];
}

function build(base: Omit<ChartColors, 'SERIES' | 'BLUE' | 'MUTED' | 'DWELL'>): ChartColors {
  return {
    ...base,
    SERIES: [base.SERIES_1, base.SERIES_2, base.SERIES_3],
    BLUE: base.SERIES_1,
    MUTED: base.AXIS,
    DWELL: [base.HEAT_RAMP[1], base.HEAT_RAMP[3], base.HEAT_RAMP[5]],
  };
}

/** Paper. Mirrors tokens/operator.ts. */
export const LIGHT_CHART_COLORS: ChartColors = build({
  SERIES_1: '#3360AB',
  SERIES_2: '#BE6517',
  SERIES_3: '#B460BC',
  HIGHLIGHT: '#3360AB',
  BAR_MUTED: '#8E9FBE',
  BAR_CURSOR: 'rgba(51, 96, 171, 0.06)',
  AXIS: '#565E6C',
  GRID: '#DADEE5',
  SURFACE: '#FCFDFE',
  INK: '#131B29',
  DANGER: '#B42318',
  HEAT_RAMP: ['#F2F3F7', '#D0DDF4', '#ACC3ED', '#85A6E2', '#5E84CA', '#3360AB'],
});

/**
 * Blue mode. Mirrors tokens/operatorBlue.ts: the page is #3360AB itself, the
 * card one step darker (L38), ink is white, ticks the light brand gray. The
 * heat ramp runs from the card up through the ramp to white — "more" is
 * brighter, as it is on the month calendar, which mixes the (white) accent
 * into the surface. Graphics need 3:1 on the card (WCAG 1.4.11): rust 3.44:1,
 * magenta 3.57:1, muted bar 3.54:1, rose danger 4.11:1.
 */
export const BLUE_CHART_COLORS: ChartColors = build({
  SERIES_1: '#FFFFFF',
  SERIES_2: '#E8A06A',
  SERIES_3: '#D9A0DE',
  HIGHLIGHT: '#FFFFFF',
  BAR_MUTED: '#99B4E1',
  BAR_CURSOR: 'rgba(255, 255, 255, 0.08)',
  AXIS: '#E0E0E1',
  GRID: '#3B6EC4',
  SURFACE: '#2D5495',
  INK: '#FFFFFF',
  DANGER: '#F0B0B4',
  HEAT_RAMP: ['#2D5495', '#3B6EC4', '#5A85CE', '#99B4E1', '#D8E2F3', '#FFFFFF'],
});

/** The set for the current appearance. Light when rendered outside the provider (tests). */
export function useChartColors(): ChartColors {
  const { mode } = useThemeMode();
  return mode === 'blue' ? BLUE_CHART_COLORS : LIGHT_CHART_COLORS;
}

/** Pick a ramp step for a 0..1 intensity. */
export function heatColor(ramp: ChartColors['HEAT_RAMP'], intensity: number): string {
  if (!Number.isFinite(intensity) || intensity <= 0) return ramp[0];
  const idx = Math.min(ramp.length - 1, Math.max(1, Math.ceil(intensity * (ramp.length - 1))));
  return ramp[idx]!;
}
