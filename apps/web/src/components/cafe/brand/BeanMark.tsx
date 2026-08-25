import type { SVGProps } from 'react';

export type BeanTone = 'brown' | 'white' | 'blue';

const TONE_FILL: Record<BeanTone, string> = {
  brown: 'var(--tp-cafe-brown)',
  white: 'var(--tp-brand-white)',
  blue: 'var(--tp-cafe-blue)',
};

/**
 * The coffee bean from the wordmark's "o" (brand p04): a tilted ellipse with
 * the curved centre split. `split` is the colour of the split line — defaults
 * to white on a brown bean, and to the bean's ground (blue/brown) when the bean
 * itself is white. Sized by `size` (any CSS length; default 1em so it scales
 * with the surrounding text).
 */
export function BeanMark({
  tone = 'brown',
  split,
  size = '1em',
  ...rest
}: {
  tone?: BeanTone;
  split?: string;
  size?: string | number;
} & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>) {
  const fill = TONE_FILL[tone];
  const splitColor = split ?? (tone === 'white' ? 'var(--tp-cafe-blue)' : 'var(--tp-brand-white)');
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <g transform="rotate(-28 50 50)">
        <ellipse cx="50" cy="50" rx="30" ry="44" fill={fill} />
        <path
          d="M50 8 C 32 30, 68 70, 50 92"
          fill="none"
          stroke={splitColor}
          strokeWidth="7"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
