/**
 * "A banner states the mode and the queued count" — SOW L688.
 *
 * Three things a station must never leave a cashier guessing about:
 *
 *   1. the venue is DEGRADED — the server has stopped hearing from the till, so
 *      the app and website are locked out of near-term writes and the desk is
 *      the only channel selling;
 *   2. this station cannot reach the server at all — which is what causes (1),
 *      seen from the other side;
 *   3. how much is still queued, because the day cannot be closed while
 *      anything is unsynced (L688-689) and that number is the reason.
 *
 * Nothing showed any of this. The word "degraded" appeared in the operator only
 * in analytics copy about a missing AI key.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../lib/i18n';
import type { HeartbeatState } from '../lib/heartbeat';
import { touch } from '../ipc/bridge';

/** conflict+failed rows — writes a person must look at (day close lists them). */
function useAttentionCount(): number {
  const [count, setCount] = useState(0);
  useEffect(
    () => touch.onQueueUpdate((s) => setCount((s.conflicts ?? 0) + (s.failed ?? 0))),
    [],
  );
  return count;
}

export function VenueStatusBanner({ state }: { state: HeartbeatState | null }) {
  const { tr } = useLocale();
  const attention = useAttentionCount();
  if (!state) return null;

  const unreachable = state.error !== null;
  const queued = state.queueDepth > 0;
  if (!unreachable && !state.degraded && !queued && attention === 0) return null;

  // Unreachable is the more actionable of the two: a station that cannot reach
  // the server is why the venue is degraded, and it is the one the person
  // standing at this screen can do something about.
  const tone =
    unreachable || state.degraded || attention > 0 ? 'var(--tp-danger)' : 'var(--tp-accent-2)';
  const message = unreachable
    ? tr('op.status.offline')
    : state.degraded
      ? tr('op.status.degraded')
      : attention > 0
        ? tr('op.status.attention', { count: attention })
        : tr('op.status.queued', { count: state.queueDepth });

  return (
    <div
      role="status"
      data-venue-status
      style={{
        background: tone,
        color: 'var(--tp-accent-contrast)',
        paddingBlock: '0.35rem',
        paddingInline: '0.8rem',
        fontSize: '0.85rem',
        fontWeight: 600,
        display: 'flex',
        gap: '0.6rem',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <span>{message}</span>
      {queued && (unreachable || state.degraded || attention > 0) && (
        <span>{tr('op.status.queued', { count: state.queueDepth })}</span>
      )}
      {attention > 0 && (unreachable || state.degraded) && (
        <span>{tr('op.status.attention', { count: attention })}</span>
      )}
    </div>
  );
}
