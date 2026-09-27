/**
 * What a tap on the floor opens when it cannot simply go to a tab.
 *
 *   open    a free table, or a booking with no live tab: "Open a tab on
 *           Table 4?" with an optional guest name (tables only, since a
 *           booking already names its guest). One press opens it and the
 *           till goes straight to the menu.
 *   choose  a table carrying two or more tabs: which one to add to, and a
 *           way to open one more there. One tab on a table never gets here;
 *           the tap goes to it directly.
 *
 * The write is openTabOn (NewTabDialog), the same one the New tab dialog
 * makes, so offline opens behave exactly as they always have.
 */
import { useState } from 'react';
import { formatNumber, formatTime } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { Icon } from '../../components/icons';
import { formatElapsed } from './elapsed';
import { openTabOn } from './NewTabDialog';
import type { CafeSpot, SpotTab } from './floorPlan';
import { muted, touchTarget } from './tillStyles';

export type SpotTarget =
  | { kind: 'table'; spot: CafeSpot }
  | { kind: 'booking'; reservationId: string; description: string };

export function SpotDialog({
  target,
  onClose,
  onOpened,
  onPickTab,
}: {
  target: SpotTarget;
  onClose: () => void;
  /** A new tab was opened; the id is the one the till selects. */
  onOpened: (tabId: string) => void;
  onPickTab: (tabId: string) => void;
}) {
  const { tr } = useLocale();
  const tableName = target.kind === 'table' ? `${tr('op.till.table')} ${target.spot.table.table_number}` : '';
  const shared = target.kind === 'table' && target.spot.tabs.length > 1;
  const [adding, setAdding] = useState(!shared);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const id =
        target.kind === 'table'
          ? await openTabOn({ tableId: target.spot.table.id, label: label.trim() || undefined }, target.spot.table.table_number)
          : await openTabOn({ reservationId: target.reservationId }, null);
      onOpened(id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const title =
    target.kind === 'booking'
      ? tr('ws.cashier.floor.spot.openBookingTitle')
      : shared && !adding
        ? tr('ws.cashier.floor.spot.chooseTitle', { table: tableName })
        : tr('ws.cashier.floor.spot.openTitle', { table: tableName });

  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={(close) =>
        adding ? (
          <>
            <Button onClick={shared ? () => setAdding(false) : close} disabled={busy}>
              {shared ? tr('common.back') : tr('common.cancel')}
            </Button>
            <Button kind="primary" icon="plus" busy={busy} onClick={() => void open()} autoFocus={target.kind === 'booking'}>
              {tr('op.till.openTabBtn')}
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

      {target.kind === 'table' && shared && !adding && (
        <TabChooser tabs={target.spot.tabs} onPick={onPickTab} onAnother={() => setAdding(true)} />
      )}

      {target.kind === 'table' && adding && (
        <Field label={tr('ws.cashier.floor.spot.name')} optional hint={tr('ws.cashier.newTab.nameHint')}>
          <input
            style={inputStyle}
            value={label}
            maxLength={60}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void open();
              }
            }}
          />
        </Field>
      )}
      <ErrorText error={error} />
    </Modal>
  );
}

function TabChooser({ tabs, onPick, onAnother }: { tabs: readonly SpotTab[]; onPick: (id: string) => void; onAnother: () => void }) {
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
                {t.offline && (
                  <>
                    {' · '}
                    <Icon name="wifiOff" size={12} /> {tr('ws.cashier.till.rail.offline')}
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
      <Button kind="ghost" icon="plus" onClick={onAnother} style={{ justifySelf: 'start' }}>
        {tr('ws.cashier.floor.spot.another')}
      </Button>
    </div>
  );
}
