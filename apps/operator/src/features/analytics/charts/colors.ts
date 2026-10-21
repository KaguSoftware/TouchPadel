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
 * its set from `useChartColors()`, never from a module-level constant. Since
 * 2026-10-20 (Sait) only the chrome and the heat ramp differ between the two:
 * the data colours (series, highlight, muted bar) are one saturated set, DATA
 * below, the same on paper and on blue, like the customer record's kept ring.
 * Before that the blue turned white and rust and magenta went pastel on blue.
 *
 * Two colours are deliberately ABSENT from the series:
 *   - Padel Green, which means live / ready / arrived / fresh everywhere else
 *     in the product. A "views" line drawn in it would spend a word the status
 *     vocabulary needs.
 *   - Anything outside the closed five-colour palette as a BRAND statement.
 *     SERIES_2 and SERIES_3 are not brand colours and are not trying to be:
 *     a categorical scale needs hue separation to encode data, the same
 *     reason the status red and amber survive the palette rule. SERIES_1
 *     and HIGHLIGHT are a brighter blue than the brand blue, which would
 *     sink into the blue-mode card.
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

  // ── Rings — the donuts and ring meters. The SAME in both modes. ──────────
  /**
   * Full-saturation blue, orange and magenta (same hues as the series, so a
   * legend still reads), like the customer record's kept ring
   * (--tp-ring-kept/-cancelled/-no-show): a ring keeps its colours in blue
   * mode rather than turning white and pastel (Sait, 2026-10-20). On the
   * paper card 3.27 / 2.20 / 3.31:1, on the blue-mode card 3.03 / 4.50 / 2.98:1,
   * the customer ring's range.
   */
  RING_1: string;
  RING_2: string;
  RING_3: string;
  /** The "other" / "unknown" slice. */
  RING_MUTED: string;
  /** The unfilled part of a ring meter. */
  RING_TRACK: string;
}

const RING = { RING_1: '#2F86FF', RING_2: '#FF8A00', RING_3: '#E040D8', RING_MUTED: '#8E9FBE' } as const;

/**
 * The data colours of every line and bar chart: the ring trio, the SAME in
 * both modes, so a chart keeps its colours in blue mode instead of turning
 * white and pastel (Sait, 2026-10-20). Only the chrome below (axis, grid,
 * surface, ink) and the heat ramp, which run from the card's own ground,
 * follow the mode.
 */
const DATA = {
  SERIES_1: RING.RING_1,
  SERIES_2: RING.RING_2,
  SERIES_3: RING.RING_3,
  HIGHLIGHT: RING.RING_1,
  BAR_MUTED: RING.RING_MUTED,
  BAR_CURSOR: 'rgba(47, 134, 255, 0.08)',
} as const;

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
  ...DATA,
  AXIS: '#565E6C',
  GRID: '#D3DCEB',
  SURFACE: '#F2F7FF',
  INK: '#131B29',
  DANGER: '#B42318',
  HEAT_RAMP: ['#EAEFF8', '#D0DDF4', '#ACC3ED', '#85A6E2', '#5E84CA', '#3360AB'],
  ...RING,
  RING_TRACK: '#D0DDF4',
});

/**
 * Blue mode. Mirrors tokens/operatorBlue.ts: the page is #3360AB itself, the
 * card the calm panel ink (#2A3F5F since 2026-10-17), ink is white, ticks the
 * light brand gray. The heat ramp runs from the card up through the brand ramp
 * to white — "more" is brighter, as it is on the month calendar, which mixes
 * the (white) accent into the surface. Graphics need 3:1 on the card (WCAG
 * 1.4.11): rust 4.90:1, magenta 5.08:1, muted bar 5.05:1, rose danger 5.86:1.
 */
export const BLUE_CHART_COLORS: ChartColors = build({
  ...DATA,
  AXIS: '#E0E0E1',
  GRID: '#42536E',
  SURFACE: '#2A3F5F',
  INK: '#FFFFFF',
  DANGER: '#F0B0B4',
  HEAT_RAMP: ['#2A3F5F', '#3B6EC4', '#5A85CE', '#99B4E1', '#D8E2F3', '#FFFFFF'],
  ...RING,
  RING_TRACK: 'rgba(255, 255, 255, 0.14)',
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
