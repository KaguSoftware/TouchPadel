/**
 * One card frame for the whole dashboard so every card has the SAME four
 * non-happy states (operator-slice.md §5.4 "States per card"):
 * skeleton while loading, empty note, "not configured" notice, error + retry.
 *
 * The private `Chip` that used to live here is gone: it was a second status
 * vocabulary ("good / bad" against the system's "success / danger") painted in
 * a second palette — its "good" was Padel Green, the accent that means live /
 * ready / arrived everywhere else, and its "warn" was plain grey. Every call
 * site now renders `StatusBadge`, so a confidence tag on the owner's screen and
 * a ticket state on the kitchen board mean the same colour.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { MessageKey } from '@touch/i18n';
import { Button, ErrorText, Skeleton, card } from '../../../components/ui';
import { useLocale } from '../../../lib/i18n';

export type CardState = 'loading' | 'ready' | 'empty' | 'unconfigured' | 'error';

const head: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--tp-sp-2)',
  marginBlockEnd: 'var(--tp-sp-2)',
};

export const cardTitle: CSSProperties = { margin: 0, fontSize: 'var(--tp-fs-md)', fontWeight: 700 };
export const muted: CSSProperties = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 };

export function CardShell({
  title,
  state,
  children,
  actions,
  note,
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
  /** Muted line under the title (source, coverage, assumptions). */
  note?: ReactNode;
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
        <h3 style={cardTitle}>{title}</h3>
        {actions && <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center' }}>{actions}</div>}
      </div>
      {note && <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-2)' }}>{note}</p>}
      {state === 'loading' && <Skeleton lines={skeletonLines} />}
      {state === 'empty' && <p style={muted}>{tr(emptyKey)}</p>}
      {state === 'unconfigured' && <p style={muted}>{tr('analytics.notices.noPosthog')}</p>}
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
      {state === 'ready' && children}
    </div>
  );
}
