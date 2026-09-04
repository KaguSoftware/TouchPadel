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
 *      anything is unsynced (L688-689) and that number is the reason;
 *   4. this station can READ the server but cannot get its writes out — the
 *      state with no witness at all until 2026-09-04, when a till sat on a
 *      green banner through 144 consecutive failed uploads because the only
 *      flag that knew (QueueStatus.uploadBlocked) was read by nobody.
 *
 * Nothing showed any of this. The word "degraded" appeared in the operator only
 * in analytics copy about a missing AI key.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../lib/i18n';
import type { HeartbeatState } from '../lib/heartbeat';
import { touch, type QueueStatus } from '../ipc/bridge';

/**
 * The station's own view of its queue. Subscribing to the WHOLE status rather
 * than one derived count is the point: `uploadBlocked` is pushed here every 2s
 * and used to be dropped on the floor.
 */
function useQueueStatus(): QueueStatus | null {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  useEffect(() => touch.onQueueUpdate(setStatus), []);
  return status;
}

export function VenueStatusBanner({ state }: { state: HeartbeatState | null }) {
  const { tr } = useLocale();
  const queue = useQueueStatus();
  if (!state) return null;

  const attention = (queue?.conflicts ?? 0) + (queue?.failed ?? 0);
  const unreachable = state.error !== null;
  // Reads work, writes cannot leave. Not implied by `unreachable`: the beat is a
  // READ (app.heartbeat over PostgREST) and the queue drains over a DIFFERENT
  // transport (the replay edge function), so the beat can keep succeeding while
  // every sale in the outbox is stuck.
  const uploadBlocked = queue?.uploadBlocked === true && !unreachable;
  const queued = state.queueDepth > 0;
  if (!unreachable && !uploadBlocked && !state.degraded && !queued && attention === 0)
    return null;

  // Unreachable is the more actionable of the two: a station that cannot reach
  // the server is why the venue is degraded, and it is the one the person
  // standing at this screen can do something about.
  const tone =
    unreachable || uploadBlocked || state.degraded || attention > 0
      ? 'var(--tp-danger)'
      : 'var(--tp-accent-2)';
  const message = unreachable
    ? tr('op.status.offline')
    : uploadBlocked
      ? tr('op.status.uploadBlocked')
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
      {queued && (unreachable || uploadBlocked || state.degraded || attention > 0) && (
        <span>{tr('op.status.queued', { count: state.queueDepth })}</span>
      )}
      {attention > 0 && (unreachable || uploadBlocked || state.degraded) && (
        <span>{tr('op.status.attention', { count: attention })}</span>
      )}
    </div>
  );
}
