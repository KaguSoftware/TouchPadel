/**
 * What a tap on the floor opens when it cannot simply go to a tab.
 *
 *   booking  a booking with no live tab: "Open a tab for this booking?". One
 *            press opens its bill and the till goes straight to the menu.
 *   table    a table carrying two or more tabs (or orders brought there):
 *            which one to go to. One never gets here; the tap goes to it.
 *            A free table opens nothing (0352, order first): the order is
 *            placed at the counter (New order) and this table is attached to
 *            it afterwards, from the tab's "Bring to…". The dialog says so
 *            and offers New order.
 *
 * The booking write is openTabOn (NewTabDialog), the same one the New order
 * dialog makes, so offline opens behave exactly as they always have.
 */
import { useState } from 'react';
import { formatNumber, formatTime } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Modal } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';
import { Icon } from '../../components/icons';
import { formatElapsed } from './elapsed';
import { openTabOn } from './NewTabDialog';
import type { CafeSpot, SpotTab } from './floorPlan';
import { muted, touchTarget } from './tillStyles';
import { OFFLINE_MARK, OfflineMarkIcon } from './offlineMark';

export type SpotTarget =
  | { kind: 'table'; spot: CafeSpot }
  | { kind: 'booking'; reservationId: string; description: string };

export function SpotDialog({
  target,
  onClose,
  onOpened,
  onPickTab,
  onNewOrder,
}: {
  target: SpotTarget;
  onClose: () => void;
  /** A new tab was opened; the id is the one the till selects. */
  onOpened: (tabId: string) => void;
  onPickTab: (tabId: string) => void;
  /** A free table: start the order at the counter instead (0352). */
  onNewOrder: () => void;
}) {
  const { tr } = useLocale();
  const tableName = target.kind === 'table' ? `${tr('op.till.table')} ${target.spot.table.table_number}` : '';
  const free = target.kind === 'table' && target.spot.tabs.length === 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function open() {
    if (busy || target.kind !== 'booking') return;
    setBusy(true);
    setError(null);
    try {
      onOpened(await openTabOn({ reservationId: target.reservationId }, null));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const title =
    target.kind === 'booking'
      ? tr('ws.cashier.floor.spot.openBookingTitle')
      : free
        ? tableName
        : tr('ws.cashier.floor.spot.chooseTitle', { table: tableName });

  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={(close) =>
        target.kind === 'booking' ? (
          <>
            <Button onClick={close} disabled={busy}>
              {tr('common.cancel')}
            </Button>
            <Button kind="primary" icon="plus" busy={busy} onClick={() => void open()} autoFocus>
              {tr('op.till.openTabBtn')}
            </Button>
          </>
        ) : free ? (
          <>
            <Button onClick={close}>{tr('common.cancel')}</Button>
            <Button kind="primary" icon="plus" onClick={onNewOrder} autoFocus>
              {tr('ws.cashier.newTab.orderTitle')}
            </Button>
          </>
        ) : (
          <Button onClick={close}>{tr('common.cancel')}</Button>
        )
      }
    >
      {target.kind === 'booking' && (
        <p style={{ marginBlockEnd: 'var(--tp-sp-2)' }}>
          <bdi>{target.description}</bdi>
        </p>
      )}

      {target.kind === 'table' && free && (
        <MessagePresenter tone="info" icon="info" message={tr('ws.cashier.floor.spot.orderFirst', { table: tableName })} />
      )}

      {target.kind === 'table' && !free && <TabChooser tabs={target.spot.tabs} onPick={onPickTab} />}
      <ErrorText error={error} />
    </Modal>
  );
}

function TabChooser({ tabs, onPick }: { tabs: readonly SpotTab[]; onPick: (id: string) => void }) {
  const { tr, locale } = useLocale();
  const now = Date.now();
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <p style={muted}>{tr('ws.cashier.floor.spot.chooseLead')}</p>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className="tp-row"
            data-clickable="true"
            autoFocus={i === 0}
            onClick={() => onPick(t.id)}
            style={{
              ...touchTarget,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--tp-sp-2)',
              textAlign: 'start',
              border: '1px solid var(--tp-border)',
              background: 'var(--tp-surface)',
              borderRadius: 'var(--tp-radius-ctl)',
              paddingBlock: 'var(--tp-sp-2)',
              paddingInline: 'var(--tp-sp-2-5)',
              cursor: 'pointer',
              font: 'inherit',
              color: 'inherit',
            }}
          >
            <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
              <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <bdi>{t.label ?? tr('ws.cashier.floor.spot.tabN', { n: formatNumber(i + 1, locale) })}</bdi>
              </strong>
              <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
                {tr('ws.cashier.floor.spot.items', { count: formatNumber(t.items, locale) })}
                {t.web && (
                  <>
                    {' · '}
                    <Icon name="globe" size={12} /> {tr('ws.cashier.tabs.sourceWeb')}
                  </>
                )}
                {t.offlineState && (
                  <>
                    {' · '}
                    <OfflineMarkIcon state={t.offlineState} size={12} /> {tr(OFFLINE_MARK[t.offlineState].key)}
                  </>
                )}
              </span>
            </span>
            <span style={{ ...muted, display: 'grid', justifyItems: 'end', whiteSpace: 'nowrap' }}>
              <span>{t.status === 'awaiting_payment' ? tr('ws.cashier.floor.paying') : tr('ws.cashier.floor.openFor', { age: formatElapsed(t.openedAt, now, tr) })}</span>
              <span style={{ fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.floor.spot.since', { time: formatTime(new Date(t.openedAt), locale) })}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
