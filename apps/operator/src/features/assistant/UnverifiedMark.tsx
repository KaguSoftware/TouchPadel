/**
 * A figure the answer gate could not find in the data read this turn (plan
 * §4.5, §7.2). A labelled mark with a sentence, not red text: a dotted
 * underline the eye can pass over, a `title` that says what it means, and
 * the same sentence for assistive tech. The footnote under the message counts
 * them (Message.tsx).
 */
import type { ReactNode } from 'react';
import { useLocale } from '../../lib/i18n';

export type MarkVariant = 'unverified' | 'changed';

/**
 * `variant="changed"` is the re-check's mark (plan §3.5): the same dotted
 * underline, but the sentence says the figure has moved since the answer was
 * written, and the attribute is `data-changed` so the two are countable apart.
 */
export function UnverifiedMark({ children, variant = 'unverified' }: { children: ReactNode; variant?: MarkVariant }) {
  const { tr } = useLocale();
  const title = variant === 'changed' ? tr('ws.owner.assistant.message.recheck.changedTitle') : tr('ws.owner.assistant.message.unverifiedTitle');
  const attrs = variant === 'changed' ? { 'data-changed': '' } : { 'data-unverified': '' };
  return (
    <mark
      {...attrs}
      title={title}
      aria-label={title}
      style={{
        background: 'transparent',
        color: 'inherit',
        textDecorationLine: 'underline',
        textDecorationStyle: 'dotted',
        textDecorationColor: 'var(--tp-warn-fg, currentColor)',
        textDecorationThickness: '2px',
        textUnderlineOffset: '0.2em',
        cursor: 'help',
      }}
    >
      {children}
    </mark>
  );
}
