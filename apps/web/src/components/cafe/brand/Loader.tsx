import { BeanMark } from './BeanMark';

export type LoaderSize = 'xs' | 'sm' | 'md' | 'lg';
export type LoaderTone = 'onLight' | 'onDark';

/**
 * Brand loader: the bean pulses inside a rotating arc ring (motion.css.ts:
 * `tp-bean-pulse` + `tp-spin-ring`; both collapse to static under
 * prefers-reduced-motion). `label` is announced to AT; visually hidden.
 */
export function Loader({
  size = 'md',
  tone = 'onLight',
  label,
  className,
}: {
  size?: LoaderSize;
  tone?: LoaderTone;
  /** accessible status text (e.g. t('common.loading')) */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={['tp-loader', className].filter(Boolean).join(' ')}
      data-size={size}
      data-tone={tone}
      role={label ? 'status' : undefined}
      aria-live={label ? 'polite' : undefined}
    >
      <svg className="tp-loader__ring" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle
          cx="24"
          cy="24"
          r="21"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="70 62"
        />
      </svg>
      <BeanMark
        className="tp-loader__bean"
        tone={tone === 'onDark' ? 'white' : 'brown'}
        split={tone === 'onDark' ? 'var(--tp-cafe-blue)' : undefined}
        size="52%"
      />
      {label && <span className="tp-visually-hidden">{label}</span>}
    </span>
  );
}
