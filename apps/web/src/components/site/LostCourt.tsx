import { BALL_BOX, BALL_D } from './brand/brandPaths';

/**
 * The 404's picture: a padel court from above in outline, the net across it in green,
 * and the ball, the brand's own, landed past the back line, with the dotted path it
 * took to get there. "Out of bounds", drawn. Decorative; never mirrored (a court has no
 * reading direction). No hooks, so the client error boundary can use it too.
 */
export function LostCourt({ className }: { className?: string }) {
  return (
    <svg
      className={['tp-lost__court', className].filter(Boolean).join(' ')}
      viewBox="0 0 220 300"
      aria-hidden="true"
      focusable="false"
    >
      <g className="tp-lost__lines">
        <rect x="30" y="20" width="120" height="240" rx="2" />
        <path d="M30 71h120M30 209h120M90 71v138" />
      </g>
      <path className="tp-lost__net" d="M22 140h136" />
      <path className="tp-lost__trace" d="M72 228C96 150 150 96 186 58" />
      <svg
        x="172"
        y="28"
        width="30"
        height="30"
        viewBox={`${BALL_BOX.x} ${BALL_BOX.y} ${BALL_BOX.w} ${BALL_BOX.h}`}
      >
        <circle
          className="tp-lost__ball-seam"
          cx={BALL_BOX.x + BALL_BOX.w / 2}
          cy={BALL_BOX.y + BALL_BOX.h / 2}
          r={BALL_BOX.h / 2}
        />
        {BALL_D.map((d, i) => (
          <path key={i} className="tp-lost__ball-felt" d={d} />
        ))}
      </svg>
    </svg>
  );
}
