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
 *
 * Rulebook 9.6 asks for FOUR permanently visible connectivity states, each with
 * a distinct treatment. This component used to render NOTHING while healthy, so
 * "syncing fine" and "the banner crashed" looked identical from a metre away;
 * and it collapsed unreachable, degraded and unsynced-writes into one red bar,
 * so the person standing at the screen could not tell whether the problem was
 * theirs to fix. Each state now carries a matched ground/ink pair from a status
 * family AND its own icon, so the meaning never rests on colour alone (13).
 *
 * NO MOTION lives here on purpose. The strip sits in the shell's flex column;
 * animating it would advertise a layout shift rather than remove one, and the
 * removal is what the permanent, fixed-height strip below actually does.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../lib/i18n';
import type { HeartbeatState } from '../lib/heartbeat';
import { touch } from '../ipc/bridge';
import { Icon, type IconName } from './icons';

/** conflict+failed rows — writes a person must look at (day close lists them). */
function useAttentionCount(): number {
  const [count, setCount] = useState(0);
  useEffect(
    () => touch.onQueueUpdate((s) => setCount((s.conflicts ?? 0) + (s.failed ?? 0))),
    [],
  );
  return count;
}

type ConnectivityState = 'ok' | 'syncing' | 'degraded' | 'offline';

/**
 * The four treatments, in one place. Every pair is a status family's own soft
 * ground and its own foreground, so each is a measured, documented contrast —
 * the previous single rule painted --tp-accent-contrast (near white) on
 * --tp-accent-2 (a light green) at 1.76:1, on the one line telling a cashier
 * how many writes are unsynced before day close.
 */
const TREATMENT: Record<ConnectivityState, { bg: string; fg: string; icon: IconName }> = {
  ok: { bg: 'var(--tp-success-soft)', fg: 'var(--tp-success-fg)', icon: 'check' },
  syncing: { bg: 'var(--tp-info-soft)', fg: 'var(--tp-info-fg)', icon: 'refresh' },
  degraded: { bg: 'var(--tp-warn-soft)', fg: 'var(--tp-warn-fg)', icon: 'alert' },
  offline: { bg: 'var(--tp-danger-soft)', fg: 'var(--tp-danger-fg)', icon: 'wifiOff' },
};

/**
 * The strip's own height, reserved whether or not there is anything to say.
 * Before this the banner appeared out of nothing the moment a station dropped
 * offline and pushed the rail, the toolbar and every row on screen down by its
 * own height — moving the till keypad under a finger already travelling (11.5).
 */
const stripBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-2)',
  blockSize: 'var(--tp-row-h-dense)',
  paddingInline: 'var(--tp-sp-3)',
  fontSize: 'var(--tp-fs-md)',
  fontWeight: 600,
  overflow: 'hidden',
  borderBlockEnd: '1px solid var(--tp-border)',
  // --tp-z-banner was minted for this component and set by nothing; the strip
  // must stay above a screen's own sticky table head when one scrolls under it.
  zIndex: 'var(--tp-z-banner)',
} as const;

export function VenueStatusBanner({ state }: { state: HeartbeatState | null }) {
  const { tr } = useLocale();
  const attention = useAttentionCount();

  // Before the first heartbeat the station genuinely does not know its state.
  // Reserve the height anyway — the alternative is claiming "connected" a
  // moment before finding out otherwise — and say nothing while it is unknown.
  if (!state) {
    return (
      <div
        aria-hidden="true"
        data-venue-status
        data-connectivity="unknown"
        style={{ ...stripBase, background: 'var(--tp-surface-2)' }}
      />
    );
  }

  const unreachable = state.error !== null;
  const queued = state.queueDepth > 0;

  // Order is severity, and it is also actionability: a station that cannot
  // reach the server is WHY the venue is degraded, and it is the one thing the
  // person standing at this screen can do something about.
  const connectivity: ConnectivityState = unreachable
    ? 'offline'
    : state.degraded || attention > 0
      ? 'degraded'
      : queued
        ? 'syncing'
        : 'ok';

  const t = TREATMENT[connectivity];
  const message = unreachable
    ? tr('op.status.offline')
    : state.degraded
      ? tr('op.status.degraded')
      : attention > 0
        ? tr('op.status.attention', { count: attention })
        : queued
          ? tr('op.status.queued', { count: state.queueDepth })
          : tr('ws.shell.status.ok');

  return (
    <div
      role="status"
      data-venue-status
      data-connectivity={connectivity}
      style={{ ...stripBase, background: t.bg, color: t.fg }}
    >
      <Icon name={t.icon} size={16} />
      {/* One line, always. The strip's job is to be the same shape every second
          of a shift; a message long enough to wrap would put the layout shift
          back. The full sentence stays reachable through the title. */}
      <span
        title={message}
        style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {message}
      </span>
      {queued && connectivity !== 'syncing' && (
        <span style={{ flexShrink: 0, fontWeight: 500 }}>
          {tr('op.status.queued', { count: state.queueDepth })}
        </span>
      )}
      {attention > 0 && (unreachable || state.degraded) && (
        <span style={{ flexShrink: 0, fontWeight: 500 }}>
          {tr('op.status.attention', { count: attention })}
        </span>
      )}
    </div>
  );
}
