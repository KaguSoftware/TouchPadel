/**
 * The flat padel court from the app's courts home (apps/mobile/src/components/
 * CourtIllustration.tsx, traced from `docs/design/mobile-ui/Touch Padel App.dc.html`
 * `.tpcourt`): top-down turf with a floating drop-shadow, white lines, a green
 * net tape, four swaying rackets and a ball rallying corner to corner with its
 * ground shadow on a 6.6 s loop.
 *
 * Server-safe (no hooks, no client code): it is what SSR, no-JS visitors,
 * Save-Data, weak devices and browsers without WebGL see, and what the live
 * canvas cross-fades from. The motion is the design's own CSS keyframes
 * (court.css.ts), so it runs with no JavaScript at all, and holds still under
 * `prefers-reduced-motion`.
 *
 * Two stacked SVGs, one viewBox: the turf sits alone in the back one so a CSS
 * `filter: drop-shadow` on that element casts the design's two-layer float
 * (a filter on an SVG child is not honoured everywhere; on the outer element it
 * is). Colours come only from site tokens. The picture is never mirrored in
 * Arabic: a symmetric court has nothing to mirror, and every motion is an SVG
 * transform in viewBox units.
 *
 * Geometry is the app's: viewBox 320 × 396, turf 26/8 268 × 380, net tape on
 * y 198, which is the viewBox's exact centre, so an overlay centred on the box
 * sits on the net (CourtStage relies on that before the canvas takes over).
 */
const RACKETS = [
  { cls: 'a1', x: 100, y: 88, rotate: -16, green: false },
  { cls: 'a2', x: 220, y: 88, rotate: 15, green: false },
  { cls: 'a3', x: 100, y: 308, rotate: 14, green: true },
  { cls: 'a4', x: 220, y: 308, rotate: -15, green: true },
] as const;

/** String dots, top rackets (face up the court); the near pair flips on y. */
const DOTS = [
  [-2.7, -5.4],
  [2.7, -5.4],
  [0, -2.4],
  [-2.7, 0.6],
  [2.7, 0.6],
] as const;

function Racket({ green }: { green: boolean }) {
  const dir = green ? -1 : 1; // the near pair (green) faces the other way
  return (
    <>
      <ellipse
        className={green ? 'tp-court-illustration__face--green' : 'tp-court-illustration__face'}
        cx={0}
        cy={-3 * dir}
        rx={7.2}
        ry={8.4}
        strokeWidth={green ? 1.4 : 1.6}
      />
      {DOTS.map(([x, y], i) => (
        <circle
          key={i}
          className={green ? 'tp-court-illustration__dot--green' : 'tp-court-illustration__dot'}
          cx={x}
          cy={y * dir}
          r={0.9}
        />
      ))}
      <path
        className="tp-court-illustration__grip"
        d={green ? 'M0-5.2V-15' : 'M0 5.2V15'}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
    </>
  );
}

export function CourtIllustration({ className }: { className?: string }) {
  return (
    <div
      className={['tp-court-illustration', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <svg
        className="tp-court-illustration__turf"
        viewBox="0 0 320 396"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <rect className="tp-court-illustration__ground" x={26} y={8} width={268} height={380} rx={5} />
        <rect
          className="tp-court-illustration__edge"
          x={26}
          y={8}
          width={268}
          height={380}
          rx={5}
          fill="none"
          strokeWidth={1}
        />
      </svg>
      <svg
        className="tp-court-illustration__play"
        viewBox="0 0 320 396"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        {/* court lines */}
        <rect
          className="tp-court-illustration__line"
          x={40}
          y={22}
          width={240}
          height={352}
          fill="none"
          strokeWidth={1.6}
          opacity={0.9}
        />
        <path className="tp-court-illustration__line" d="M40 108h240M40 288h240" strokeWidth={1.4} opacity={0.7} />
        <path className="tp-court-illustration__line" d="M160 22v86M160 288v86" strokeWidth={1.4} opacity={0.7} />
        {/* net: green tape, dashed white mesh, two posts */}
        <path className="tp-court-illustration__tape" d="M20 198h280" strokeWidth={2.6} opacity={0.95} />
        <path
          className="tp-court-illustration__line"
          d="M20 198h280"
          strokeWidth={1}
          strokeDasharray="3 4"
          opacity={0.8}
        />
        <circle className="tp-court-illustration__post" cx={20} cy={198} r={2.8} />
        <circle className="tp-court-illustration__post" cx={300} cy={198} r={2.8} />
        {/* rackets: an outer group sways (CSS), the inner one places + poses */}
        {RACKETS.map((r) => (
          <g key={r.cls} className={`tp-court-illustration__racket tp-court-illustration__${r.cls}`}>
            <g transform={`translate(${r.x},${r.y}) rotate(${r.rotate}) scale(1.5)`}>
              <Racket green={r.green} />
            </g>
          </g>
        ))}
        {/* ball: ground shadow, a soft halo a beat behind, the ball */}
        <ellipse className="tp-court-illustration__shadow" rx={4.8} ry={2.3} />
        <circle className="tp-court-illustration__halo" r={5} />
        <circle className="tp-court-illustration__ball" r={5.2} strokeWidth={1.4} />
      </svg>
    </div>
  );
}
