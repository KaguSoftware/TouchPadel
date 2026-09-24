import { PATTERN_BAND_WIDTH, PATTERN_LINES, PATTERN_VIEWBOX } from './brandPattern';

/**
 * The court-line pattern (identity.pdf p8), cropped, never redrawn.
 *
 * - `weight="poster"` draws the board's own band width (16 panel units): the loud,
 *   graphic bands of the PLAY / SMASH / WIN posters and the roll-ups.
 * - `weight="texture"` is the app's backdrop weight, a thin line behind the court.
 *
 * `band` overrides the band width (panel units) where the box is LANDSCAPE: `slice` has
 * to scale the portrait panel ~6× to cover a 1440 px wide poster, which would make the
 * board's 16-unit band ~96 px; a thinner band keeps the drawing a poster, not a stripe.
 *
 * `crop` picks the window onto the panel (in panel units). SVG's `slice` then scales that
 * window to COVER the box, so bands always run off the edge and the crop does the
 * framing, flat caps and all. Colour and opacity come from CSS (`.tp-pattern`), so the
 * same drawing reads at 0.9 on light grounds and 0.45 on dark ones.
 *
 * Never mirrored in RTL: the pattern is abstract, and SVG content does not follow `dir`.
 */
export function CourtPattern({
  weight = 'poster',
  band,
  crop,
  className,
}: {
  weight?: 'poster' | 'texture';
  /** Band width in panel units, overriding the weight's own. */
  band?: number;
  /** `x y w h` in panel units; defaults to the whole panel. */
  crop?: readonly [number, number, number, number];
  className?: string;
}) {
  const [x, y, w, h] = crop ?? [0, 0, PATTERN_VIEWBOX.width, PATTERN_VIEWBOX.height];
  const stroke = band ?? (weight === 'poster' ? PATTERN_BAND_WIDTH : 2.2);
  return (
    <svg
      className={['tp-pattern', className].filter(Boolean).join(' ')}
      viewBox={`${x} ${y} ${w} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <g className="tp-pattern__bands" strokeWidth={stroke} strokeLinecap="butt">
        {PATTERN_LINES.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
    </svg>
  );
}
