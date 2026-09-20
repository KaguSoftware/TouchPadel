/**
 * A figure the answer gate could not find in the data read this turn (plan
 * §4.5, §7.2). A labelled mark with a sentence, not red text: a dotted
 * underline the eye can pass over, a `title` that says what it means, and
 * the same sentence for assistive tech. The footnote under the message counts
 * them (Message.tsx).
 */
import type { ReactNode } from 'react';
import { useLocale } from '../../lib/i18n';

export function UnverifiedMark({ children }: { children: ReactNode }) {
  const { tr } = useLocale();
  const title = tr('ws.owner.assistant.message.unverifiedTitle');
  return (
    <mark
      data-unverified=""
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
