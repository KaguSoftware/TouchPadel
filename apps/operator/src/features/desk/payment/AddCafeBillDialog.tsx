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
 *
 * A stepped wizard (components/StepWizard.tsx, Sait 2026-10-22): Which bill,
 * then Review, which holds "Add to this booking". Drawn as the approved
 * preview (operator-wizards.html, `cafebill`): a note, the search, then the
 * bills as bordered rows (name at the start, "Items: n · Opened hh:mm" at the
 * end; the picked one framed in the accent).
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, formatTime } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { mutate } from '../../../lib/mutate';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { pickName, useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { ErrorText, inputStyle } from '../../../components/ui';
import { ReviewList, StepWizard, WizardNote, type WizardStep } from '../../../components/StepWizard';
import { useBookingBill } from './useBookingBill';

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
  // The booking it lands on, for the lead and Review (the panel's own read, cached).
  const billQ = useBookingBill(reservationId);

  const tabsQ = useQuery({
    queryKey: ['tabs', 'cafeBillsForBooking'],
    queryFn: async (): Promise<OpenCafeTab[]> => {
      const { data, error: e } = await supabase
        .from('tabs')
        .select('id, label, opened_at, table:cafe_tables(table_number), orders!orders_tab_id_fkey(status, order_items(voided, qty))')
        .eq('status', 'open')
        .is('reservation_id', null)
        .is('merged_into_tab_id', null)
        .order('opened_at');
      if (e) throw e;
      return (data ?? []) as unknown as OpenCafeTab[];
    },
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

  const picked = rows.find((t) => t.id === selected) ?? null;
  const pickedCount = picked ? liveItemCount(picked) : 0;
  const r = billQ.data?.reservation ?? null;
  const bookingLine = r
    ? tr('ws.courtDesk.cafeBill.wizard.booking', {
        court: pickName(locale, { name_en: r.court_name_en ?? '', name_ar: r.court_name_ar ?? '' }),
        time: formatTime(new Date(r.start_at), locale, tz),
        name: r.guest_name ?? '—',
      })
    : null;

  const steps: WizardStep[] = [
    {
      key: 'bill',
      label: tr('ws.courtDesk.cafeBill.wizard.stepBill'),
      note: picked ? nameOf(picked) : null,
      problems: selected ? [] : [tr('ws.courtDesk.cafeBill.chooseFirst')],
      content: (
        <>
          <WizardNote>{tr('ws.courtDesk.cafeBill.lead')}</WizardNote>
          {rows.length > 0 && (
            <input
              type="text"
              style={inputStyle}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('ws.courtDesk.cafeBill.search')}
              aria-label={tr('ws.courtDesk.cafeBill.wizard.searchAria')}
            />
          )}
          {tabsQ.isError ? (
            <ErrorText error={tabsQ.error} />
          ) : tabsQ.isLoading ? (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.payment.loading')}</p>
          ) : rows.length === 0 ? (
            <WizardNote>{tr('ws.courtDesk.cafeBill.empty')}</WizardNote>
          ) : visible.length === 0 ? (
            <WizardNote>{tr('ws.courtDesk.cafeBill.noMatch')}</WizardNote>
          ) : (
            <div role="listbox" aria-label={tr('ws.courtDesk.cafeBill.title')} style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
              {visible.map((t) => {
                const isSelected = t.id === selected;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected ? 'true' : undefined}
                    disabled={busy}
                    onClick={() => setSelected(isSelected ? '' : t.id)}
                    style={isSelected ? { ...billRow, ...billRowPicked } : billRow}
                  >
                    <strong>
                      <bdi>{nameOf(t)}</bdi>
                    </strong>
                    <span style={{ fontSize: 'var(--tp-fs-sm)', opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>
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
        </>
      ),
    },
  ];

  return (
    <StepWizard
      title={tr('ws.courtDesk.cafeBill.wizard.title')}
      lead={bookingLine ? <bdi>{bookingLine}</bdi> : undefined}
      steps={steps}
      busy={busy}
      onClose={onClose}
      submitLabel={tr('ws.courtDesk.cafeBill.add')}
      onSubmit={() => void add()}
      testId="cafeBill"
      notice={
        notice || error ? (
          <>
            {notice && <WizardNote tone="refused">{notice}</WizardNote>}
            <ErrorText error={error} />
          </>
        ) : undefined
      }
      review={(goTo) => (
        <>
          <ReviewList
            goTo={goTo}
            busy={busy}
            rows={[
              { label: tr('ws.courtDesk.cafeBill.wizard.reviewBill'), value: <bdi>{picked ? nameOf(picked) : '—'}</bdi>, step: 'bill' },
              {
                label: tr('ws.courtDesk.cafeBill.wizard.reviewMoves'),
                value:
                  pickedCount === 1
                    ? tr('ws.courtDesk.cafeBill.wizard.movesOne')
                    : tr('ws.courtDesk.cafeBill.wizard.moves', { count: formatNumber(pickedCount, locale) }),
                step: 'bill',
              },
              { label: tr('ws.courtDesk.cafeBill.wizard.reviewBooking'), value: <bdi>{bookingLine ?? '—'}</bdi> },
            ]}
          />
          <WizardNote>{tr('ws.courtDesk.cafeBill.wizard.closes')}</WizardNote>
        </>
      )}
    />
  );
}

/** A bill as the preview's `.row`: bordered, the name at the start, its count and time at the end. */
const billRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--tp-sp-3)',
  flexWrap: 'wrap',
  inlineSize: '100%',
  paddingBlock: 'var(--tp-sp-3)',
  paddingInline: 'calc(var(--tp-sp-3) + var(--tp-sp-0))',
  border: '1px solid var(--tp-border-strong)',
  borderRadius: 'var(--tp-radius-panel)',
  background: 'var(--tp-surface)',
  color: 'var(--tp-fg)',
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
};
/** The picked bill: a 2px accent frame on the accent wash (the padding gives back the extra pixel). */
const billRowPicked: CSSProperties = {
  border: '2px solid var(--tp-accent)',
  paddingBlock: 'calc(var(--tp-sp-3) - 1px)',
  paddingInline: 'calc(var(--tp-sp-3) + var(--tp-sp-0) - 1px)',
  background: 'var(--tp-accent-soft)',
  color: 'var(--tp-accent-soft-fg)',
};
