/**
 * The Touch Cafe mark, drawn from packages/ui/src/brand/cafe-mark.svg's geometry: the
 * coffee bean (rotated −28°) with its white centre split, and the smile arc (the cafe
 * wordmark's swoosh) beneath, on a rounded Touch Blue tile. In Padel Green, not brown:
 * brown is retired and the approved menu is blue + green (style reference §2.5).
 *
 * Colours come from CSS (`.tp-cafemark`), never from this file.
 */
export function CafeMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={['tp-cafemark', className].filter(Boolean).join(' ')}
      viewBox="0 0 512 512"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect className="tp-cafemark__tile" width="512" height="512" rx="112" />
      <g transform="rotate(-28 256 236)">
        <ellipse className="tp-cafemark__bean" cx="256" cy="236" rx="92" ry="134" />
        <path
          className="tp-cafemark__split"
          d="M256 106 C 202 176, 310 296, 256 366"
          fill="none"
          strokeWidth="18"
          strokeLinecap="round"
        />
      </g>
      <path
        className="tp-cafemark__smile"
        d="M112 372 C 176 440, 336 440, 400 372"
        fill="none"
        strokeWidth="26"
        strokeLinecap="round"
      />
    </svg>
  );
}
