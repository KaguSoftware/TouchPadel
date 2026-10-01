/**
 * The Touch Padel mark, as vectors.
 *
 * Extracted from the 2026 brand deck (`docs/brand/full-brand2.pdf`, the logo
 * page) rather than redrawn: the wordmark outlines, the ball and the swoosh are
 * the artwork's own beziers, translated so the lockup sits at 0,0 and rounded to
 * two decimals. Replaces the typographic placeholder that stood in while the
 * logo files were "not yet delivered" — they were in `docs/brand/` all along.
 *
 * Three pieces, because the identity is three pieces:
 *   - `BrandBall`   the padel ball that replaces the "o" of Touch. The atom:
 *                   it survives 14px, so it is also the busy indicator.
 *   - `BrandSwoosh` the green-to-teal-to-blue sweep that becomes the "P" of
 *                   Padel. The one sanctioned gradient in the whole system.
 *   - `BrandLockup` all three together. Brand surfaces only (sign-in, boot,
 *                   lock, rail head, kitchen head) — never inside the data.
 *
 * Colour comes from tokens, never from these files. `tone="onDark"` is the
 * deck's own blue-ground treatment: white wordmark, green ball, same swoosh.
 */
import { useId, type CSSProperties } from 'react';
import { BALL_BOX, BALL_D, SWOOSH_D, VB, WORDMARK_D } from './brandMark';

export type BrandTone = 'full' | 'onDark';

/** Wordmark ink. The swoosh and the ball keep their own colours in both tones. */
const WORDMARK_FILL: Record<BrandTone, string> = {
  full: 'var(--tp-accent)',
  onDark: 'var(--tp-brand-white)',
};

/**
 * The gradient the swoosh runs along: Padel Green at the tail running straight
 * into Touch Blue where it becomes the "P". It used to pass through a teal
 * midpoint (`--tp-brand-teal`, #1FA79A) borrowed from the deck's applications
 * page; the palette is closed to five colours, so the teal is gone and the
 * green now meets the blue directly. Declared per instance because two lockups
 * on one screen would otherwise share an id.
 */
function SwooshGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="7.7" y1="17" x2="50.5" y2="9">
      <stop offset="0" stopColor="var(--tp-brand-green)" />
      <stop offset="1" stopColor="var(--tp-brand-blue)" />
    </linearGradient>
  );
}

/**
 * The full lockup. Sized by block-size so it never fights a text baseline;
 * `title` makes it an image with a name, omitting it leaves it decorative.
 */
export function BrandLockup({
  size = 28,
  tone = 'full',
  title,
  style,
}: {
  /** Block size in px; inline size follows the artwork's ratio. */
  size?: number;
  tone?: BrandTone;
  /** Accessible name. Omit where a heading beside it already says "Touch Padel". */
  title?: string;
  style?: CSSProperties;
}) {
  const gid = useId();
  return (
    <svg
      viewBox={`0 0 ${VB.w} ${VB.h}`}
      height={size}
      width={(size * VB.w) / VB.h}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <defs>
        <SwooshGradient id={gid} />
      </defs>
      <path d={SWOOSH_D} fill={`url(#${gid})`} />
      {WORDMARK_D.map((d, i) => (
        <path key={i} d={d} fill={WORDMARK_FILL[tone]} />
      ))}
      <BallPaths />
    </svg>
  );
}

/**
 * The ball's three segments plus the disc behind them that fills the seams.
 * Without the disc the seams show whatever is behind the mark, which reads as
 * cracks on a busy ground.
 */
function BallPaths({ seam = 'var(--tp-brand-white)' }: { seam?: string }) {
  return (
    <g>
      <circle
        cx={BALL_BOX.x + BALL_BOX.w / 2}
        cy={BALL_BOX.y + BALL_BOX.h / 2}
        r={BALL_BOX.h / 2}
        fill={seam}
      />
      {BALL_D.map((d, i) => (
        <path key={i} d={d} fill="var(--tp-brand-green)" />
      ))}
    </g>
  );
}

/**
 * The ball on its own. Legible at 14px, which is why it doubles as the busy
 * indicator (`components/ui.tsx` Spinner) instead of a generic arc.
 *
 * `spin` is for waiting only — a ball that turns while nothing is pending is
 * decoration, and this app has staff looking at it for eight hours.
 */
export function BrandBall({
  size = 16,
  spin,
  seam = 'var(--tp-brand-white)',
  title,
  style,
}: {
  /** px, or a CSS length when the parent sizes it (the Spinner passes '100%'). */
  size?: number | string;
  spin?: boolean;
  /** The colour of the two seams. Match the surface the ball sits on. */
  seam?: string;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox={`${BALL_BOX.x} ${BALL_BOX.y} ${BALL_BOX.w} ${BALL_BOX.h}`}
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={spin ? 'tp-ball-spin' : undefined}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <BallPaths seam={seam} />
    </svg>
  );
}

/**
 * The swoosh alone, as a surface accent: the sign-in panel, the lock screen,
 * the boot screen. Scales to its container and bleeds off the inline end, the
 * way it does across the brand deck's covers.
 *
 * Not for use inside data. It is the loudest thing the identity owns.
 */
export function BrandSwoosh({
  opacity = 0.5,
  style,
}: {
  opacity?: number;
  style?: CSSProperties;
}) {
  const gid = useId();
  return (
    <svg
      viewBox="7 2 44 25"
      // `meet`, not `slice`. Cropping the swoosh turns the "P" loop into an
      // anonymous arc and the sweep into a stripe — tested side by side. The
      // gesture only reads as Touch Padel when it keeps its whole shape.
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', inlineSize: '100%', blockSize: '100%', opacity, ...style }}
    >
      <defs>
        <SwooshGradient id={gid} />
      </defs>
      <path d={SWOOSH_D} fill={`url(#${gid})`} />
    </svg>
  );
}
