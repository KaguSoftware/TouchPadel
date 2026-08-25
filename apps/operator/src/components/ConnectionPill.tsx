/**
 * Realtime connection pill: Connecting… / Live / Disconnected. The polling
 * refetchIntervals on the caller's queries remain the safety net when
 * disconnected, so the pill is informational, not blocking.
 */
import { useLocale } from '../lib/i18n';
import type { BroadcastStatus } from '../lib/realtime';

export function ConnectionPill({ status }: { status: BroadcastStatus }) {
  const { tr } = useLocale();
  const color =
    status === 'live' ? 'var(--tp-accent-2)' : status === 'connecting' ? '#E8A317' : 'var(--tp-danger)';
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
        fontSize: '0.75rem',
        fontWeight: 600,
        color: status === 'disconnected' ? 'var(--tp-danger)' : 'var(--tp-muted-fg)',
        border: '1px solid var(--tp-border)',
        borderRadius: '999px',
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
          animation: status === 'connecting' ? 'tpPulse 1.2s infinite' : undefined,
        }}
      />
      {label}
    </span>
  );
}
