/**
 * F-11: "Not received by the kitchen yet" on the till (kitchenReach.ts).
 *
 *   KitchenReachFlag    on a tab (the tabs board row, the tab panel) while an
 *                       order on it has not been drawn by any kitchen screen
 *                       twenty seconds after it was sent.
 *   KitchenSendStatus   under the basket, for the last order sent to the
 *                       selected tab: waiting for a kitchen screen, on it, or
 *                       not received — never a bare "Order sent." with no
 *                       screen on.
 */
import { useLocale } from '../../lib/i18n';
import { Icon } from '../../components/icons';
import { StatusBadge } from '../../components/kit';
import { useNotReceivedTabs, useSendStatus } from './kitchenReachStore';

export function KitchenReachFlag({ tabId, compact = false }: { tabId: string; compact?: boolean }) {
  const { tr } = useLocale();
  const flagged = useNotReceivedTabs();
  if (!flagged.has(tabId)) return null;
  if (compact) {
    return (
      <span data-testid="kitchen-not-received" style={{ display: 'inline-flex' }}>
        <StatusBadge tone="danger" icon="alert" size="sm" label={tr('ws.cashier.kitchenReach.flag')} title={tr('ws.cashier.kitchenReach.flagHint')} />
      </span>
    );
  }
  return (
    <p
      role="alert"
      data-testid="kitchen-not-received"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-2)',
        margin: 0,
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-3)',
        borderRadius: 'var(--tp-radius-panel)',
        background: 'var(--tp-danger-soft)',
        color: 'var(--tp-danger-fg)',
        fontWeight: 700,
        fontSize: 'var(--tp-fs-sm)',
      }}
    >
      <Icon name="alert" size={18} />
      {tr('ws.cashier.kitchenReach.notReceived')}
    </p>
  );
}

export function KitchenSendStatus({ tabId }: { tabId: string | null }) {
  const { tr } = useLocale();
  const state = useSendStatus(tabId);
  if (!state) return null;
  const notReceived = state === 'notReceived';
  return (
    <p
      role={notReceived ? 'alert' : 'status'}
      data-testid="kitchen-send-status"
      data-state={state}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-1-5)',
        margin: 0,
        fontSize: 'var(--tp-fs-sm)',
        fontWeight: notReceived ? 700 : 400,
        color: notReceived ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)',
      }}
    >
      <Icon name={notReceived ? 'alert' : state === 'seen' ? 'checkCircle' : 'clock'} size={14} />
      {tr(
        notReceived
          ? 'ws.cashier.kitchenReach.notReceived'
          : state === 'seen'
            ? 'ws.cashier.kitchenReach.seen'
            : 'ws.cashier.kitchenReach.waiting',
      )}
    </p>
  );
}
