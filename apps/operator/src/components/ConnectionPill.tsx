/**
 * Realtime connection pill: Connecting… / Live / Disconnected. The polling
 * refetchIntervals on the caller's queries remain the safety net when
 * disconnected, so the pill is informational, not blocking.
 */
import { useLocale } from '../lib/i18n';
import type { BroadcastStatus } from '../lib/realtime';

export function ConnectionPill({ status }: { status: BroadcastStatus }) {
  const { tr } = useLocale();
  // Marks, not fills: a 8px dot drawn in --tp-accent-2 measures 1.78:1 on the
  // desk's paper ground, i.e. invisible. And 'live' is a STATUS, so it takes
  // the success family rather than borrowing the marketing accent.
  const color =
    status === 'live'
      ? 'var(--tp-success-mark)'
      : status === 'connecting'
        ? 'var(--tp-warn-mark)'
        : 'var(--tp-danger-mark)';
  const label =
    status === 'live'
      ? tr('op.common.live')
      : status === 'connecting'
        ? tr('op.common.connecting')
        : tr('op.common.disconnected');
  return (
    <span
      title={tr('op.kds.connection')}
      data-testid="connection-pill"
      data-status={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        fontSize: 'var(--tp-fs-xs)',
        fontWeight: 600,
        color: status === 'disconnected' ? 'var(--tp-danger)' : 'var(--tp-muted-fg)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-pill)',
        paddingInline: '0.55rem',
        paddingBlock: '0.15rem',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          inlineSize: '0.5rem',
          blockSize: '0.5rem',
          borderRadius: '50%',
          background: color,
        }}
        // 'connecting' is transient and pending, so it may loop; 'live' is a
        // steady state already carried by the label and never does.
        className={status === 'connecting' ? 'tp-attention' : undefined}
      />
      {label}
    </span>
  );
}
