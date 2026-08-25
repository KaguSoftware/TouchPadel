import { BeanMark } from './BeanMark';

export type WordmarkTone = 'onLight' | 'onBlue' | 'onBrown';

/**
 * "Touch Cafe" wordmark (brand p04/p05): geometric bold Latin, the "o" of
 * Touch is a coffee bean, a smile arc sweeps from under the bean to the "C".
 *
 * Tones: onLight = blue letters + brown bean/smile; onBlue / onBrown = white
 * letters, white bean (split in the ground colour) and a white smile.
 *
 * Always `lang="en"` — the mark is Latin in both locales (the deck has no
 * Arabic lockup); the accessible name is the plain text "Touch Cafe".
 *
 * // SWAP POINT: replace the markup below with the official SVG lockup when
 * // Touch supplies it (keep the `tp-wordmark` root class + `data-tone`).
 */
export function Wordmark({
  tone = 'onLight',
  className,
}: {
  tone?: WordmarkTone;
  className?: string;
}) {
  const onDark = tone !== 'onLight';
  return (
    <span
      className={['tp-wordmark', className].filter(Boolean).join(' ')}
      data-tone={tone}
      lang="en"
      dir="ltr"
      role="img"
      aria-label="Touch Cafe"
    >
      <span className="tp-wordmark__word" aria-hidden="true">
        T
        <BeanMark
          className="tp-wordmark__bean"
          tone={onDark ? 'white' : 'brown'}
          split={onDark ? 'currentColor' : undefined}
          size=".82em"
        />
        uch
      </span>
      <span className="tp-wordmark__gap" aria-hidden="true" />
      <span className="tp-wordmark__word" aria-hidden="true">
        Cafe
      </span>
      <svg
        className="tp-wordmark__smile"
        viewBox="0 0 300 60"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M6 8 C 80 66, 220 66, 294 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
