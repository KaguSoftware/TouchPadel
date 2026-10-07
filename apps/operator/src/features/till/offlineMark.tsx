/**
 * How the floor marks a tab that exists only on this till (lib/offlineTabs).
 *
 * Three states, told apart rather than all called "Offline": an open not yet
 * on the server, a settled tab whose payment is still in the outbox, and one
 * the server refused (day close holds the row). The badge was never a
 * connectivity verdict, and staff who learn that it means nothing will ignore
 * it the day it means something.
 */
import type { MessageKey } from '@touch/i18n';
import { Icon, type IconName } from '../../components/icons';
import type { OfflineTabState } from '../../lib/offlineTabs';

export const OFFLINE_MARK: Record<
  OfflineTabState,
  { icon: IconName; key: MessageKey; color?: string }
> = {
  queued: { icon: 'wifiOff', key: 'ws.cashier.till.rail.offline' },
  settled: { icon: 'clock', key: 'ws.cashier.till.rail.settledAwaitingSync' },
  failed: { icon: 'alert', key: 'ws.cashier.till.rail.failed', color: 'var(--tp-danger)' },
};

/** The state's icon; pass `label` where the icon stands alone. */
export function OfflineMarkIcon({
  state,
  size,
  label,
}: {
  state: OfflineTabState;
  size: number;
  label?: string;
}) {
  const m = OFFLINE_MARK[state];
  return (
    <Icon
      name={m.icon}
      size={size}
      label={label}
      style={m.color ? { color: m.color } : undefined}
    />
  );
}
