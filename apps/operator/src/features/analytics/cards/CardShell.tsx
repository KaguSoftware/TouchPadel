/**
 * One card frame for the whole dashboard so every card has the SAME four
 * non-happy states (operator-slice.md §5.4 "States per card"):
 * skeleton while loading, empty note, "not configured" notice, error + retry.
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
  gap: '0.5rem',
  marginBlockEnd: '0.5rem',
};

export const cardTitle: CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 700 };
export const muted: CSSProperties = { color: 'var(--tp-muted-fg)', fontSize: '0.8rem', margin: 0 };

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
        {actions && <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>{actions}</div>}
      </div>
      {note && <p style={{ ...muted, marginBlockEnd: '0.5rem' }}>{note}</p>}
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
            <Button onClick={onRetry} style={{ fontSize: '0.85rem', paddingBlock: '0.3rem' }}>
              {tr('common.retry')}
            </Button>
          )}
        </div>
      )}
      {state === 'ready' && children}
    </div>
  );
}

/** Small pill used for tones, confidence, kinds and inline counters. */
export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'accent' }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    good: { bg: 'var(--tp-accent-2)', fg: 'var(--tp-accent-2-contrast)' },
    warn: { bg: 'var(--tp-muted)', fg: 'var(--tp-fg)' },
    bad: { bg: 'var(--tp-danger)', fg: 'var(--tp-danger-contrast)' },
    accent: { bg: 'var(--tp-accent)', fg: 'var(--tp-accent-contrast)' },
    neutral: { bg: 'transparent', fg: 'var(--tp-muted-fg)' },
  };
  const c = colors[tone] ?? colors.neutral!;
  return (
    <span
      style={{
        display: 'inline-block',
        paddingBlock: '0.1rem',
        paddingInline: '0.45rem',
        borderRadius: '999px',
        border: '1px solid var(--tp-border)',
        background: c.bg,
        color: c.fg,
        fontSize: '0.72rem',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
