/**
 * What the owner must know before trusting the figures below: a comparison
 * that is not reliable, a period too thin to read rates from, missing opening
 * hours, guest-menu data that is not available. These are STATE, so they stay
 * visible — and each is said ONCE, here, instead of on every tile it touches
 * (the comparison notice used to print under all ten court tiles).
 *
 * Each line is a plain sentence; a line that something on another screen
 * resolves carries that link, and a failed load carries a retry. Nothing is
 * rendered when there is nothing to say.
 *
 * The first two notes always show (the caller orders them: the comparison
 * first); past that the rest fold behind "Show n more notes", so four
 * paragraphs of caveats no longer push the summary below the fold. The
 * failed-load line is never folded.
 */
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui';
import { Icon } from '../../components/icons';
import { useLocale } from '../../lib/i18n';
import { MARK } from '../ops/OpsVisuals';

export interface Notice {
  key: string;
  text: ReactNode;
  /** A link or button that resolves it. */
  action?: ReactNode;
}

/** Notes shown before the rest fold. */
const SHOWN = 2;

export function Notices({ notices, onRetry }: { notices: readonly Notice[]; onRetry?: () => void }) {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  if (notices.length === 0 && !onRetry) return null;
  const folded = notices.length - SHOWN;
  const shown = open || folded <= 0 ? notices : notices.slice(0, SHOWN);
  return (
    <ul
      aria-label={tr('ws.analytics.notices.title')}
      style={{
        listStyle: 'none',
        margin: 0,
        marginBlockEnd: 'var(--tp-sp-4)',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-3)',
        display: 'grid',
        gap: 'var(--tp-sp-1-5)',
        background: 'var(--tp-surface-2)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-panel)',
      }}
    >
      {shown.map((n) => (
        <li key={n.key} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)' }}>
          <Icon name="info" size={14} style={{ color: MARK.warn, flex: '0 0 auto', alignSelf: 'center' }} />
          <span style={{ flex: '1 1 30rem', minInlineSize: 0 }}>{n.text}</span>
          {n.action}
        </li>
      ))}
      {folded > 0 && (
        <li>
          <button type="button" className="tp-link" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginInlineStart: 'calc(14px + var(--tp-sp-2))' }}>
            {open ? tr('ws.analytics.viz.fewerNotes') : tr('ws.analytics.viz.moreNotes', { n: folded })}
          </button>
        </li>
      )}
      {onRetry && (
        <li style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)' }}>
          <Icon name="alert" size={14} style={{ color: MARK.danger, flex: '0 0 auto' }} />
          <span style={{ flex: '1 1 30rem' }}>{tr('ws.analytics.notices.someFailed')}</span>
          <Button size="sm" icon="refresh" onClick={onRetry}>
            {tr('common.retry')}
          </Button>
        </li>
      )}
    </ul>
  );
}
