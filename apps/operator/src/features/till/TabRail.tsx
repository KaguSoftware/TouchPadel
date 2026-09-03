/**
 * Open-tabs rail (inline-start region of the till). Roving tabindex: one tab
 * stop, ↑/↓ move, Enter/Space select; hover or focus prefetches the tab detail
 * so switching paints instantly. Offline tabs (queued opens) list after the
 * server ones with their own label.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { Kbd, TabStatusIndicator } from '../../components/kit';
import { Icon } from '../../components/icons';
import { LOCAL_TAB_PREFIX, type OfflineTab } from '../../lib/offlineTabs';
import { moveInList } from './keymap';
import { tabAnchorLabel, tabHasWebOrder, type TabListRow } from './tillData';
import { muted } from './tillStyles';

interface RailEntry {
  id: string;
  label: string;
  status: string;
  offline: boolean;
  web: boolean;
}

export function TabRail({
  tabs,
  offlineTabs,
  selectedId,
  loading,
  onSelect,
  onNew,
  onPrefetch,
}: {
  tabs: readonly TabListRow[];
  offlineTabs: readonly OfflineTab[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onPrefetch: (id: string) => void;
}) {
  const { tr } = useLocale();
  const entries: RailEntry[] = [
    ...tabs.map((t) => ({
      id: t.id,
      label: tabAnchorLabel(t, tr('op.till.table'), tr('op.till.forReservation')),
      status: t.status,
      offline: false,
      web: tabHasWebOrder(t),
    })),
    ...offlineTabs.map((ot) => ({
      id: `${LOCAL_TAB_PREFIX}${ot.idemKey}`,
      label: ot.tableNumber ? `${tr('op.till.table')} ${ot.tableNumber}` : (ot.label ?? '—'),
      status: 'open',
      offline: true,
      web: false,
    })),
  ];

  const [focusIndex, setFocusIndex] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (focusIndex >= entries.length) setFocusIndex(Math.max(0, entries.length - 1));
  }, [entries.length, focusIndex]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const next = moveInList(e.key, focusIndex, entries.length);
    if (next === null) return;
    e.preventDefault();
    setFocusIndex(next);
    refs.current[next]?.focus();
    const entry = entries[next];
    if (entry && !entry.offline) onPrefetch(entry.id);
  }

  return (
    <section aria-label={tr('op.till.openTabs')} style={{ display: 'grid', gap: '0.5rem', alignContent: 'start', minInlineSize: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', minInlineSize: 0 }}>
        <h2 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700 }}>{tr('op.till.openTabs')}</h2>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          <Kbd>F6</Kbd>
          <Button kind="primary" size="lg" onClick={onNew} title={tr('ws.cashier.till.rail.newTab')} style={{ minInlineSize: 'var(--tp-touch)' }}>
            +
          </Button>
        </span>
      </div>

      {loading && entries.length === 0 && (
        <p style={muted} role="status">
          {tr('common.loading')}
        </p>
      )}
      {!loading && entries.length === 0 && <p style={muted}>{tr('ws.cashier.till.rail.empty')}</p>}

      <div role="listbox" aria-label={tr('op.till.openTabs')} onKeyDown={onKeyDown} style={{ display: 'grid', gap: '0.3rem' }}>
        {entries.map((entry, i) => {
          const selected = entry.id === selectedId;
          return (
            <button
              key={entry.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={i === focusIndex ? 0 : -1}
              className="tp-tile"
              onFocus={() => {
                setFocusIndex(i);
                if (!entry.offline) onPrefetch(entry.id);
              }}
              onMouseEnter={() => !entry.offline && onPrefetch(entry.id)}
              onClick={() => onSelect(entry.id)}
              style={{
                display: 'grid',
                gap: '0.2rem',
                textAlign: 'start',
                minBlockSize: 'var(--tp-touch)',
                paddingBlock: '0.45rem',
                paddingInline: '0.65rem',
                border: `1px solid ${selected ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                borderRadius: 'var(--tp-radius-ctl)',
                background: selected ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
                color: 'var(--tp-fg)',
                font: 'inherit',
              }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <bdi>{entry.label}</bdi>
                </strong>
                {selected && <Icon name="check" size={14} label={tr('ws.cashier.till.rail.selected')} />}
              </span>
              <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {entry.offline ? (
                  <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Icon name="wifiOff" size={12} /> {tr('ws.cashier.till.rail.offline')}
                  </span>
                ) : (
                  <>
                    {entry.status === 'awaiting_payment' && <TabStatusIndicator status="awaiting_payment" size="sm" />}
                    {entry.web && (
                      <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Icon name="globe" size={12} /> {tr('ws.cashier.tabs.sourceWeb')}
                      </span>
                    )}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {entries.length > 1 && <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.till.rail.hint')}</p>}
    </section>
  );
}
