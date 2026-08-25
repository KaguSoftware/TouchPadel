/**
 * The white "swoosh" band (brand p01/p07): a wide curved sweep that closes a
 * solid blue panel. Rendered as an SVG with `preserveAspectRatio="none"` so it
 * stretches to whatever box it sits in (TopBar bottom edge, Hero-none footer).
 *
 * RTL: the brand deck always draws the sweep rising from the leading edge
 * toward the trailing edge. We therefore mirror it under `[dir='rtl']` with
 * `scale(-1, 1)` (see `topbar.css.ts` → `.tp-swoosh`), so the curve keeps its
 * reading-direction meaning ("starts low where you start reading"). Pass
 * `mirror={false}` to pin the physical shape (e.g. behind a photo).
 */
export function Swoosh({
  className,
  mirror = true,
  tone = 'white',
}: {
  className?: string;
  mirror?: boolean;
  /** `white` = fill with the brand white; `surface` = page background (--tp-bg). */
  tone?: 'white' | 'surface';
}) {
  const fill = tone === 'surface' ? 'var(--tp-bg)' : 'var(--tp-brand-white)';
  return (
    <svg
      className={['tp-swoosh', className].filter(Boolean).join(' ')}
      data-mirror={mirror ? 'true' : 'false'}
      viewBox="0 0 1000 120"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0 120 L0 92 C 220 140, 520 30, 1000 4 L1000 120 Z" fill={fill} />
      <path
        d="M0 74 C 230 120, 540 22, 1000 -14"
        fill="none"
        stroke={fill}
        strokeOpacity=".45"
        strokeWidth="3"
      />
    </svg>
  );
}
