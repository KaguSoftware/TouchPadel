/**
 * Add a cafe bill to a booking (0106).
 *
 * A group at a court orders from a cafe table (there are no court QR codes
 * yet), so their drinks land on that table's bill. The desk pulls that bill
 * onto the booking and the group pays once.
 *
 * Direction is fixed: the table bill is merged INTO the booking's bill. The
 * server refuses the other way (BOOKING_TAB_DONOR) because a merge does not
 * carry the booking, and the court fee would vanish from the bill.
 *
 * The list shows where each bill is and how many items it holds, not a
 * money figure — the booking's bill shows the server's total once merged.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, formatTime } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { mutate } from '../../../lib/mutate';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Modal } from '../../../components/ui';
import { MessagePresenter, SearchField } from '../../../components/kit';

interface OpenCafeTab {
  id: string;
  label: string | null;
  opened_at: string;
  table: { table_number: string } | null;
  orders: { status: string; order_items: { voided: boolean; qty: number }[] }[];
}

/** Units still on a bill: a voided line, or any line of a voided order, is gone. A count, not money. */
export function liveItemCount(tab: Pick<OpenCafeTab, 'orders'>): number {
  return (tab.orders ?? [])
    .filter((o) => o.status !== 'voided')
    .reduce((n, o) => n + (o.order_items ?? []).filter((i) => !i.voided).reduce((q, i) => q + (i.qty ?? 1), 0), 0);
}

export function AddCafeBillDialog({
  reservationId,
  liveTabId,
  tz,
  onClose,
  onAdded,
}: {
  reservationId: string;
  /** The booking's open bill, when it already has one. */
  liveTabId: string | null;
  tz: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tabsQ = useQuery({
    queryKey: ['tabs', 'cafeBillsForBooking'],
    queryFn: async (): Promise<OpenCafeTab[]> => {
      const { data, error: e } = await supabase
        .from('tabs')
        .select('id, label, opened_at, table:cafe_tables(table_number), orders(status, order_items(voided, qty))')
        .eq('status', 'open')
        .is('reservation_id', null)
        .is('merged_into_tab_id', null)
        .order('opened_at');
      if (e) throw e;
      return (data ?? []) as unknown as OpenCafeTab[];
    },
    retry: false,
  });

  const nameOf = (t: OpenCafeTab) => (t.table ? tr('ws.courtDesk.cafeBill.table', { number: t.table.table_number }) : (t.label ?? '—'));
  const rows = useMemo(() => tabsQ.data ?? [], [tabsQ.data]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((t) => (t.table?.table_number ?? '').toLowerCase().includes(q) || (t.label ?? '').toLowerCase().includes(q));
  }, [rows, query]);

  async function add() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let survivor = liveTabId;
    try {
      if (!survivor) {
        try {
          const opened = await mutate<{ tab_id: string }>('tab.open', { reservationId });
          if (opened.queued || !opened.result) {
            setNotice(tr('ws.courtDesk.cafeBill.offline'));
            return;
          }
          survivor = opened.result.tab_id;
        } catch (e) {
          // Another clerk opened the booking's bill a moment ago: use that one.
          if (e instanceof AppRpcError && e.code === 'BOOKING_TAB_OPEN' && e.details) survivor = e.details;
          else throw e;
        }
      }
      try {
        await appRpc('merge_tabs', { p_donor_tab_id: selected, p_survivor_tab_id: survivor });
      } catch (e) {
        if (!liveTabId) setNotice(tr('ws.courtDesk.cafeBill.halfDone'));
        throw e;
      }
      toast.ok(tr('ws.courtDesk.cafeBill.added'));
      onAdded();
    } catch (e) {
      setError(e);
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['bookingBill'] });
      void queryClient.invalidateQueries({ queryKey: ['bookingBillStates'] });
      void queryClient.invalidateQueries({ queryKey: ['tabs'] });
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.courtDesk.cafeBill.title')}
      subtitle={tr('ws.courtDesk.cafeBill.lead')}
      onClose={busy ? () => {} : onClose}
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('ws.courtDesk.cafeBill.cancel')}
          </Button>
          <Button kind="primary" icon="plus" busy={busy} disabled={!selected} disabledReason={tr('ws.courtDesk.cafeBill.chooseFirst')} onClick={() => void add()}>
            {tr('ws.courtDesk.cafeBill.add')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {notice && <MessagePresenter tone="refused" message={notice} />}
        <ErrorText error={error} />
        {rows.length > 0 && <SearchField value={query} onChange={setQuery} placeholder={tr('ws.courtDesk.cafeBill.search')} aria-label={tr('ws.courtDesk.cafeBill.search')} />}
        {tabsQ.isError ? (
          <ErrorText error={tabsQ.error} />
        ) : tabsQ.isLoading ? (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.payment.loading')}</p>
        ) : rows.length === 0 ? (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.cafeBill.empty')}</p>
        ) : visible.length === 0 ? (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.cafeBill.noMatch')}</p>
        ) : (
          <div role="listbox" aria-label={tr('ws.courtDesk.cafeBill.title')} style={{ display: 'grid', gap: 'var(--tp-sp-1)', maxBlockSize: '18rem', overflowY: 'auto' }}>
            {visible.map((t) => {
              const isSelected = t.id === selected;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className="tp-row"
                  data-clickable="true"
                  data-selected={isSelected ? 'true' : undefined}
                  disabled={busy}
                  onClick={() => setSelected(isSelected ? '' : t.id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--tp-sp-3)',
                    flexWrap: 'wrap',
                    textAlign: 'start',
                    minBlockSize: '2.75rem',
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
                  <strong>
                    <bdi>{nameOf(t)}</bdi>
                  </strong>
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                    <bdi>
                      {tr('ws.courtDesk.cafeBill.items', { count: formatNumber(liveItemCount(t), locale) })} ·{' '}
                      {tr('ws.courtDesk.cafeBill.opened', { time: formatTime(new Date(t.opened_at), locale, tz) })}
                    </bdi>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
