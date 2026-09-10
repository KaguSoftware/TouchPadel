/**
 * Chart colours as LITERALS.
 *
 * Recharts renders into SVG attributes it computes in JS — it cannot read the
 * `--tp-*` CSS custom properties the rest of the operator uses, so the values
 * are mirrored here by hand. That duplication is legitimate. What it used to
 * duplicate was not: this file mirrored `cafePalette` — coffee brown #603813,
 * warm ink, cream surface — so every chart the owner read at night was another
 * product's identity floating on operator paper. It now mirrors the OPERATOR
 * tokens (packages/ui/src/tokens/operator.ts). If a token changes there,
 * change it here too.
 *
 * The categorical trio was not chosen by eye. It was run through a
 * colour-vision validator (lightness band, chroma floor, CVD separation,
 * normal-vision separation, contrast vs surface) and every check passes at
 * all pairs. SERIES_1 moved #3057A3 -> #3360AB (the exact brand blue) on
 * 2026-09-05; re-validated, CVD separation is unchanged and normal-vision
 * separation stays comfortably above the floor.
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

// ---------------------------------------------------------------------------
// Categorical — identity. Fixed order, never cycled.
// ---------------------------------------------------------------------------

/** Series 1 — Touch Blue (`--tp-accent`). Revenue, sales, the primary measure. */
export const SERIES_1 = '#3360AB';
/** Series 2 — rust. Views / engagement. */
export const SERIES_2 = '#BE6517';
/** Series 3 — magenta. Waiter calls / the third measure. */
export const SERIES_3 = '#B460BC';

export const SERIES = [SERIES_1, SERIES_2, SERIES_3] as const;

/** Back-compatible alias: the primary series kept its old name. */
export const BLUE = SERIES_1;

// ---------------------------------------------------------------------------
// Emphasis — "this one is the peak"
// ---------------------------------------------------------------------------

/**
 * A highlighted bar takes the accent and the rest step back. This used to be
 * the reverse — the peak in a second hue over a field of accent-blue bars —
 * which reads as two categories rather than as one emphasised value.
 */
export const HIGHLIGHT = SERIES_1;
/** The un-emphasised bars beside a HIGHLIGHT one. */
export const BAR_MUTED = '#8E9FBE';

// ---------------------------------------------------------------------------
// Chrome — recessive, and wearing text tokens rather than series colours
// ---------------------------------------------------------------------------

/** Axis ticks and legends (`--tp-muted-fg`). Text never wears a series colour. */
export const AXIS = '#565E6C';
/** Gridlines and axis strokes (`--tp-border`). */
export const GRID = '#DADEE5';
/** The chart surface (`--tp-surface`). */
export const SURFACE = '#FCFDFE';
/** Body ink (`--tp-fg`). */
export const INK = '#131B29';
/** Status, reserved — never reused as a series (`--tp-danger`). */
export const DANGER = '#B42318';

/**
 * `MUTED` used to be both the axis-tick colour AND the waiter-calls series, so
 * a data line was drawn in the text token. Kept as an alias for the chrome
 * meaning only; series callers take SERIES_3.
 */
export const MUTED = AXIS;

// ---------------------------------------------------------------------------
// Sequential — magnitude. One hue, monotone lightness, floored on the page
// ground rather than on raw white (DESIGN.md: never #fff).
// ---------------------------------------------------------------------------

export const HEAT_RAMP = [
  '#F2F3F7',
  '#D0DDF4',
  '#ACC3ED',
  '#85A6E2',
  '#5E84CA',
  '#3360AB',
] as const;

/** Dwell buckets of the "looked, not bought" stack, light → dark: same ramp. */
export const DWELL = [HEAT_RAMP[1], HEAT_RAMP[3], HEAT_RAMP[5]] as const;

/** Pick a ramp step for a 0..1 intensity. */
export function heatColor(intensity: number): string {
  if (!Number.isFinite(intensity) || intensity <= 0) return HEAT_RAMP[0];
  const idx = Math.min(
    HEAT_RAMP.length - 1,
    Math.max(1, Math.ceil(intensity * (HEAT_RAMP.length - 1))),
  );
  return HEAT_RAMP[idx]!;
}
