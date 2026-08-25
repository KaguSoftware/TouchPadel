import type { CSSProperties, ReactNode } from 'react';

/**
 * Repeating coffee-bean pattern (brand p14/p15). Pure CSS: the tile lives in
 * the `--tp-cafe-beans-brown` / `--tp-cafe-beans-white` tokens, so this is
 * just a positioned, decorative layer. Place it inside a `position: relative`
 * box; it fills the box (`inset: 0`) behind the content.
 */
export function BeanPattern({
  tone = 'brown',
  opacity,
  className,
  children,
}: {
  /** brown beans (on light grounds) or white outline beans (on blue/brown) */
  tone?: 'brown' | 'white';
  /** override the default 8 % (white) / 6 % (brown) opacity */
  opacity?: number;
  className?: string;
  children?: ReactNode;
}) {
  const style = opacity != null ? ({ '--tp-beans-opacity': String(opacity) } as CSSProperties) : undefined;
  return (
    <div
      className={['tp-beans', className].filter(Boolean).join(' ')}
      data-tone={tone}
      style={style}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}
