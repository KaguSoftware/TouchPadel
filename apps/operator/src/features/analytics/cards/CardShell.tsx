/**
 * One card frame for the whole dashboard so every card has the SAME four
 * non-happy states (operator-slice.md §5.4 "States per card"):
 * skeleton while loading, empty note, "not configured" notice, error + retry.
 *
 * Two kinds of text sit under a title and they are kept apart on purpose:
 * `tip` is an EXPLANATION (what is counted, the denominator, the bucket rule)
 * and lives behind the info button, read on hover, focus or tap; `note` is
 * STATE (an estimate, a sample size, a gap in the data) and stays visible,
 * because a fact about this period must not hide behind a hover.
 *
 * `refreshing` is the refetch state: the previous render stays in place at
 * reduced opacity instead of collapsing into a skeleton, so nothing jumps
 * while the period is re-read (dataviz: "refetch keeps the frame").
 *
 * The private `Chip` that used to live here is gone: it was a second status
 * vocabulary ("good / bad" against the system's "success / danger") painted in
 * a second palette. Every call site renders `StatusBadge`.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { MessageKey } from '@touch/i18n';
import { Button, ErrorText, Skeleton, card } from '../../../components/ui';
import { InfoTip } from '../../../components/InfoTip';
import { useLocale } from '../../../lib/i18n';

/**
 * `unconfigured` and `unavailable` are the guest-menu (PostHog) states: not
 * set up, or set up and not answering. Both print one short muted line; the
 * page's notice carries the full sentence (and the retry) ONCE, instead of a
 * red "Something went wrong" in every card that reads guest-menu data.
 */
export type CardState = 'loading' | 'ready' | 'empty' | 'unconfigured' | 'unavailable' | 'error';

const head: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--tp-sp-2)',
  marginBlockEnd: 'var(--tp-sp-2)',
  minBlockSize: '1.85rem',
};

export const cardTitle: CSSProperties = { margin: 0, fontSize: 'var(--tp-fs-md)', fontWeight: 700 };
export const muted: CSSProperties = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 };

export function CardShell({
  title,
  state,
  children,
  actions,
  note,
  tip,
  refreshing = false,
  emptyKey = 'analytics.empty.generic',
  error,
  onRetry,
  skeletonLines = 4,
  style,
}: {
  title: string;
  state: CardState;
  children: ReactNode;
  /** Buttons / chips rendered on the inline-end of the title row. */
  actions?: ReactNode;
  /** Muted line under the title: STATE (source, coverage, sample size). */
  note?: ReactNode;
  /** EXPLANATION behind the info button beside the title. */
  tip?: ReactNode;
  /** A refetch is in flight: keep the frame, dim it. */
  refreshing?: boolean;
  emptyKey?: MessageKey;
  error?: unknown;
  onRetry?: () => void;
  skeletonLines?: number;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  return (
    <div style={{ ...card, ...style }}>
      <div style={head}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
          <h3 style={cardTitle}>{title}</h3>
          {tip && <InfoTip content={tip} label={tr('ws.analytics.tips.about', { title })} />}
        </div>
        {actions && <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexShrink: 0 }}>{actions}</div>}
      </div>
      {/* A div, not a paragraph: a note may carry a link or a small share bar. */}
      {note && <div style={{ ...muted, marginBlockEnd: 'var(--tp-sp-2)' }}>{note}</div>}
      {state === 'loading' && <Skeleton lines={skeletonLines} />}
      {state === 'empty' && <p style={muted}>{tr(emptyKey)}</p>}
      {state === 'unconfigured' && <p style={muted}>{tr('ws.analytics.cafe.engagementOff')}</p>}
      {state === 'unavailable' && <p style={muted}>{tr('ws.analytics.cafe.engagementDown')}</p>}
      {state === 'error' && (
        <div>
          {/* A card may know its error or only that one happened — never render an
              empty error state, which reads as "no data" instead of "it broke". */}
          {error == null ? (
            <p role="alert" style={{ ...muted, color: 'var(--tp-danger)' }}>
              {tr('errors.generic')}
            </p>
          ) : (
            <ErrorText error={error} />
          )}
          {onRetry && (
            <Button onClick={onRetry} style={{ fontSize: 'var(--tp-fs-sm)', paddingBlock: 'var(--tp-sp-1-5)' }}>
              {tr('common.retry')}
            </Button>
          )}
        </div>
      )}
      {state === 'ready' && (
        <div
          aria-busy={refreshing || undefined}
          style={{ opacity: refreshing ? 0.55 : 1, transition: 'opacity var(--tp-dur-fast) var(--tp-ease-out)' }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
