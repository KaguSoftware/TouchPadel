import { PATTERN_LINES, PATTERN_VIEWBOX } from './brandPattern';

/**
 * The court-line pattern (identity.pdf p8), cropped, never redrawn.
 *
 * `band` is the band width in panel units, set per use: the app's thin backdrop line
 * behind the court (2.2), and per crop on the events poster, where `slice` scales the
 * portrait panel up to cover a landscape box and the board's own 16 would be a stripe.
 *
 * `crop` picks the window onto the panel (in panel units). SVG's `slice` then scales that
 * window to COVER the box, so bands always run off the edge and the crop does the
 * framing, flat caps and all. Colour and opacity come from CSS (`.tp-pattern`), so the
 * same drawing reads at 0.9 on light grounds and 0.45 on dark ones.
 *
 * Never mirrored in RTL: the pattern is abstract, and SVG content does not follow `dir`.
 */
export function CourtPattern({
  band,
  crop,
  className,
}: {
  /** Band width in panel units. */
  band: number;
  /** `x y w h` in panel units; defaults to the whole panel. */
  crop?: readonly [number, number, number, number];
  className?: string;
}) {
  const [x, y, w, h] = crop ?? [0, 0, PATTERN_VIEWBOX.width, PATTERN_VIEWBOX.height];
  return (
    <svg
      className={['tp-pattern', className].filter(Boolean).join(' ')}
      viewBox={`${x} ${y} ${w} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <g className="tp-pattern__bands" strokeWidth={band} strokeLinecap="butt">
        {PATTERN_LINES.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
    </svg>
  );
}
