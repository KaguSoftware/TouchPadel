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

/** Lockup user-space box. Every sub-mark shares these coordinates. */
const VB = { w: 72.55, h: 26.78 } as const;
/** The ball's box inside the lockup, for the standalone mark. */
const BALL_BOX = { x: 7.47, y: 0, w: 7.06, h: 7.03 } as const;


/** The sweep: starts under the ball, crosses the wordmark, closes the "P". */
const SWOOSH_D =
  'M43.14 3C41.77 3.44 40.45 4.34 39.35 5.61C38.08 7.07 37.32 8.75 36.88 10.41C36.6 11.5 36.45 12.57 36.39 13.6C36.37 13.96 36.37 14.31 36.37 14.66C32.81 14.73 29.15 14.25 26.1 13.65C18.97 12.25 12.14 9.69 8.52 7.77L7.72 9.26C11.45 11.25 18.48 13.88 25.77 15.31C28.93 15.93 32.72 16.43 36.44 16.34C36.75 19.97 38 23.77 39.88 26.78L41.32 25.88C39.59 23.12 38.41 19.64 38.12 16.26C38.19 16.25 38.26 16.25 38.32 16.24C40.3 16.08 42.22 15.72 43.98 15.09C44.75 14.82 45.48 14.5 46.18 14.12C49.4 12.35 50.53 9.82 50.34 7.61C50.28 6.97 50.12 6.37 49.86 5.81C49.08 4.12 47.61 3.01 45.82 2.75C45.56 2.72 45.3 2.7 45.04 2.7C44.41 2.7 43.77 2.81 43.14 3M40.63 6.71C41.91 5.23 43.52 4.39 45.03 4.39C45.22 4.39 45.4 4.41 45.58 4.43C46.81 4.61 47.78 5.35 48.32 6.52C49.31 8.66 48.12 11.12 45.36 12.63C43.26 13.79 40.72 14.37 38.05 14.57C38.07 11.59 38.85 8.78 40.63 6.71';

/** Eight outlines: T u c h a d e l. The P is drawn by the swoosh. */
const WORDMARK_D: readonly string[] = [
  'M-0 2.73L6.16 2.73L6.16 4.1L3.91 4.1L3.91 10.48L2.24 10.48L2.24 4.1L-0 4.1',
  'M19.94 4.83L21.56 4.83L21.56 10.48L19.94 10.48ZM17.62 7.93C17.62 8.3 17.72 8.59 17.91 8.8C18.1 9.01 18.36 9.11 18.69 9.11C19.08 9.11 19.39 8.96 19.61 8.68C19.83 8.4 19.94 8.04 19.94 7.62L20.33 7.62C20.33 8.28 20.24 8.82 20.05 9.25C19.87 9.69 19.61 10.01 19.27 10.22C18.93 10.43 18.52 10.54 18.05 10.55C17.62 10.55 17.26 10.46 16.96 10.28C16.66 10.1 16.43 9.85 16.26 9.52C16.09 9.2 16 8.82 16 8.37L16 4.83L17.62 4.83',
  'M26.53 6.7C26.39 6.51 26.2 6.36 25.98 6.26C25.77 6.15 25.52 6.1 25.24 6.1C24.98 6.1 24.74 6.16 24.54 6.29C24.34 6.42 24.18 6.61 24.06 6.84C23.94 7.08 23.89 7.36 23.89 7.67C23.89 7.98 23.94 8.25 24.06 8.49C24.18 8.73 24.34 8.91 24.54 9.04C24.74 9.17 24.98 9.24 25.24 9.24C25.52 9.24 25.78 9.19 26.01 9.08C26.23 8.96 26.41 8.8 26.55 8.59L27.67 9.32C27.43 9.71 27.1 10.01 26.66 10.22C26.23 10.43 25.73 10.53 25.16 10.53C24.59 10.53 24.08 10.42 23.64 10.18C23.21 9.94 22.87 9.6 22.63 9.17C22.39 8.74 22.27 8.24 22.27 7.67C22.27 7.09 22.39 6.59 22.63 6.15C22.87 5.71 23.21 5.38 23.65 5.13C24.09 4.89 24.59 4.77 25.16 4.77C25.71 4.77 26.19 4.87 26.62 5.07C27.04 5.27 27.37 5.55 27.63 5.92',
  'M32.4 7.38C32.4 7.02 32.3 6.72 32.1 6.51C31.9 6.3 31.63 6.19 31.28 6.19C30.88 6.2 30.56 6.35 30.33 6.62C30.1 6.91 29.98 7.26 29.98 7.69L29.58 7.69C29.58 7.03 29.68 6.48 29.86 6.05C30.05 5.62 30.32 5.3 30.68 5.08C31.03 4.87 31.45 4.76 31.94 4.76C32.37 4.76 32.74 4.85 33.05 5.03C33.36 5.21 33.6 5.46 33.77 5.78C33.94 6.11 34.03 6.49 34.03 6.93L34.03 10.48L32.4 10.48ZM28.36 2.67L29.98 2.67L29.98 10.48L28.36 10.48ZM28.36 2.67',
  'M55.12 7.01C55.12 6.7 55.02 6.46 54.81 6.28C54.62 6.11 54.32 6.02 53.93 6.02C53.68 6.02 53.41 6.06 53.12 6.15C52.84 6.24 52.55 6.37 52.25 6.52L51.74 5.47C52.03 5.32 52.3 5.2 52.56 5.11C52.83 5 53.11 4.93 53.39 4.87C53.67 4.82 53.97 4.8 54.3 4.8C55.07 4.8 55.66 4.98 56.07 5.34C56.49 5.69 56.7 6.19 56.71 6.82L56.72 10.52L55.12 10.52ZM53.84 8.06C53.53 8.06 53.3 8.12 53.14 8.22C52.99 8.33 52.91 8.5 52.91 8.73C52.91 8.95 52.99 9.13 53.15 9.26C53.31 9.39 53.52 9.46 53.8 9.46C54.03 9.46 54.25 9.41 54.43 9.33C54.62 9.25 54.78 9.14 54.9 9.01C55.02 8.87 55.1 8.71 55.12 8.53L55.37 9.43C55.21 9.81 54.95 10.1 54.61 10.3C54.27 10.5 53.84 10.59 53.35 10.59C52.94 10.59 52.6 10.52 52.3 10.36C52.02 10.21 51.79 10 51.63 9.73C51.47 9.46 51.39 9.16 51.39 8.82C51.39 8.29 51.58 7.88 51.95 7.58C52.32 7.28 52.86 7.12 53.55 7.12L55.28 7.12L55.28 8.06',
  'M61.91 2.7L63.52 2.7L63.52 10.52L61.91 10.52ZM60.5 6.09C60.22 6.09 59.97 6.16 59.76 6.3C59.54 6.44 59.37 6.63 59.26 6.87C59.14 7.12 59.07 7.4 59.07 7.71C59.07 8.02 59.14 8.3 59.26 8.54C59.37 8.79 59.54 8.98 59.76 9.11C59.97 9.25 60.22 9.32 60.5 9.32C60.78 9.32 61.02 9.25 61.23 9.11C61.45 8.98 61.61 8.79 61.73 8.54C61.85 8.3 61.91 8.02 61.91 7.71C61.91 7.39 61.85 7.11 61.73 6.87C61.61 6.62 61.45 6.44 61.23 6.3C61.02 6.16 60.78 6.09 60.5 6.09M60.08 4.8C60.58 4.8 61 4.92 61.35 5.15C61.7 5.39 61.97 5.72 62.16 6.14C62.35 6.58 62.45 7.08 62.45 7.67C62.45 8.27 62.36 8.79 62.17 9.22C61.98 9.66 61.72 10 61.37 10.23C61.02 10.46 60.61 10.58 60.12 10.58C59.59 10.58 59.12 10.46 58.71 10.22C58.31 9.98 58 9.64 57.78 9.2C57.55 8.76 57.44 8.25 57.44 7.66C57.44 7.1 57.55 6.6 57.78 6.17C58 5.74 58.3 5.4 58.7 5.16C59.09 4.92 59.55 4.8 60.08 4.8',
  'M68.47 7.23C68.46 6.97 68.41 6.75 68.3 6.56C68.2 6.37 68.05 6.23 67.87 6.12C67.68 6.02 67.46 5.97 67.21 5.97C66.94 5.97 66.7 6.04 66.5 6.18C66.3 6.32 66.14 6.51 66.02 6.76C65.91 7 65.86 7.29 65.86 7.61C65.86 7.98 65.92 8.29 66.05 8.55C66.17 8.81 66.35 9.01 66.58 9.15C66.81 9.29 67.08 9.36 67.38 9.36C67.93 9.36 68.41 9.16 68.82 8.75L69.67 9.59C69.39 9.91 69.04 10.15 68.63 10.32C68.22 10.48 67.76 10.57 67.25 10.57C66.64 10.57 66.12 10.45 65.68 10.21C65.23 9.98 64.89 9.64 64.65 9.21C64.41 8.77 64.28 8.27 64.28 7.71C64.28 7.12 64.41 6.62 64.66 6.18C64.9 5.75 65.24 5.42 65.68 5.18C66.12 4.94 66.63 4.82 67.2 4.81C67.87 4.81 68.42 4.95 68.84 5.23C69.27 5.5 69.57 5.89 69.77 6.39C69.96 6.89 70.03 7.49 69.98 8.18L65.62 8.18L65.62 7.23',
  'M70.93 10.52L72.55 10.52L72.55 2.7L70.93 2.7ZM70.93 10.52',
];

/** Three felt segments; the seams are the gaps between them. */
const BALL_D: readonly string[] = [
  'M7.6 4.28C7.47 3.71 7.48 3.11 7.66 2.5C8.01 1.37 8.89 0.53 9.94 0.2C10.22 0.82 10.28 1.54 10.07 2.23C9.72 3.39 8.72 4.17 7.6 4.28',
  'M11.33 6.99C10.89 7.03 10.43 6.99 9.98 6.86C8.94 6.53 8.15 5.77 7.77 4.83C9.07 4.65 10.21 3.73 10.61 2.4C10.86 1.61 10.8 0.79 10.5 0.07C10.99-0 11.5 0.03 12.01 0.19C13.1 0.52 13.91 1.34 14.27 2.33C12.91 2.46 11.68 3.39 11.26 4.78C11.03 5.53 11.07 6.3 11.33 6.99',
  'M14.32 4.53C13.97 5.73 13.02 6.58 11.9 6.88C11.65 6.28 11.6 5.61 11.8 4.94C12.16 3.74 13.24 2.95 14.42 2.88C14.52 3.41 14.49 3.98 14.32 4.53',
];


export type BrandTone = 'full' | 'onDark';

/** Wordmark ink. The swoosh and the ball keep their own colours in both tones. */
const WORDMARK_FILL: Record<BrandTone, string> = {
  full: 'var(--tp-accent)',
  onDark: 'var(--tp-brand-white)',
};

/**
 * The gradient the swoosh runs along: Padel Green at the tail, through the
 * teal of the brand deck's applications page, into Touch Blue where it becomes
 * the "P". Declared per instance because two lockups on one screen would
 * otherwise share an id.
 */
function SwooshGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="7.7" y1="17" x2="50.5" y2="9">
      <stop offset="0" stopColor="var(--tp-brand-green)" />
      <stop offset="0.55" stopColor="var(--tp-brand-teal)" />
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
