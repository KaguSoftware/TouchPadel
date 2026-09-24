import { useId } from 'react';
import { BALL_BOX, BALL_D, SWOOSH_D, VB, WORDMARK_D } from './brandPaths';

/**
 * The Touch Padel lockup as vectors (the deck's own beziers, brandPaths.ts).
 *
 * Its two variable colours are CSS, not props: the wordmark fills with
 * `--tp-site-lockup-ink` and the swoosh runs Padel Green → `--tp-site-lockup-swoosh-end`.
 * Light mode sets both to Touch Blue (the colour lockup on light); night and every dark
 * section (the footer, the poster) set both to white, which is the deck's approved
 * version for blue, navy and black grounds (style reference §2.3). So one lockup follows
 * whatever ground it lands on, and the mode toggle recolours it with no re-render.
 *
 * The swoosh gradient is the only gradient in the system and fills the swoosh only.
 */
export function BrandLockup({
  title,
  className,
}: {
  /** Accessible name; omitted = decorative (a link around it names it instead). */
  title?: string;
  className?: string;
}) {
  const gid = `tp-swoosh-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      viewBox={`0 0 ${VB.w} ${VB.h}`}
      className={['tp-lockup', className].filter(Boolean).join(' ')}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="7.7" y1="17" x2="50.5" y2="9">
          <stop offset="0" className="tp-lockup__stop-start" />
          <stop offset="1" className="tp-lockup__stop-end" />
        </linearGradient>
      </defs>
      <path d={SWOOSH_D} fill={`url(#${gid})`} />
      <g className="tp-lockup__word">
        {WORDMARK_D.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <BallPaths />
    </svg>
  );
}

/** The ball's three felt segments plus the white disc that fills the seams. */
function BallPaths() {
  return (
    <g className="tp-ball">
      <circle
        className="tp-ball__seam"
        cx={BALL_BOX.x + BALL_BOX.w / 2}
        cy={BALL_BOX.y + BALL_BOX.h / 2}
        r={BALL_BOX.h / 2}
      />
      {BALL_D.map((d, i) => (
        <path key={i} className="tp-ball__felt" d={d} />
      ))}
    </g>
  );
}

/**
 * The ball alone: the brand's atom, legible at 14px. Decorative by default. Used as
 * the "open now" dot's big sibling, the footer bullet and the 404's lost ball.
 */
export function BrandBall({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox={`${BALL_BOX.x} ${BALL_BOX.y} ${BALL_BOX.w} ${BALL_BOX.h}`}
      className={['tp-ballmark', className].filter(Boolean).join(' ')}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <BallPaths />
    </svg>
  );
}
