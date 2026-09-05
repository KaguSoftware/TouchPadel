/**
 * New tab dialog — table / by-name / booking anchor (app.open_tab). Also the
 * home of the reservation picker that 06.17 (charge to booking) reuses.
 *
 * Offline: a queued tab.open becomes a local tab whose identity is the
 * envelope's idempotency key (lib/offlineTabs).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/mutate';
import { LOCAL_TAB_PREFIX, addOfflineTab } from '../../lib/offlineTabs';
import { QK, fetchActiveCafeTables } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter, SearchField } from '../../components/kit';
import { muted, reasonedFooter, touchTarget } from './tillStyles';

export interface OpenReservationRow {
  id: string;
  start_at: string;
  guest_name: string | null;
  court: { name_en: string; name_ar: string } | null;
  tabs: { id: string }[];
}

/**
 * Today's confirmed/arrived bookings that have no tab yet. RLS: cashiers may
 * see none — the picker simply stays empty for them.
 */
export function useTodaysOpenReservations(enabled = true) {
  return useQuery({
    queryKey: ['openTabReservations'],
    enabled,
    queryFn: async () => {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const { data, error } = await supabase
        .from('reservations')
        .select('id, start_at, end_at, guest_name, court:courts(name_en, name_ar), tabs(id)')
        .in('status', ['confirmed', 'arrived'])
        .gte('start_at', dayStart.toISOString())
        .lt('start_at', dayEnd.toISOString())
        .order('start_at');
      if (error) throw error;
      return (data as unknown as OpenReservationRow[]).filter((r) => (r.tabs ?? []).length === 0);
    },
  });
}

type Tr = ReturnType<typeof useLocale>['tr'];

export function reservationOptionLabel(tr: Tr, locale: 'en' | 'ar', r: OpenReservationRow): string {
  return tr('ws.cashier.charge.option', {
    time: formatTime(new Date(r.start_at), locale),
    court: pickName(locale, r.court),
    guest: r.guest_name ?? '—',
  });
}

/** Case-insensitive match on guest name or court name (both scripts). */
export function reservationMatches(r: OpenReservationRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (r.guest_name ?? '').toLowerCase().includes(q) ||
    (r.court?.name_en ?? '').toLowerCase().includes(q) ||
    (r.court?.name_ar ?? '').includes(query.trim())
  );
}

/** Searchable list of today's bookings without a tab; one is selected at a time. */
export function ReservationPicker({
  rows,
  selectedId,
  onSelect,
  busy,
}: {
  rows: readonly OpenReservationRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  busy?: boolean;
}) {
  const { tr, locale } = useLocale();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => rows.filter((r) => reservationMatches(r, query)), [rows, query]);
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <SearchField value={query} onChange={setQuery} placeholder={tr('ws.cashier.charge.searchPlaceholder')} aria-label={tr('ws.cashier.charge.search')} busy={busy} />
      {rows.length === 0 ? (
        <p style={muted}>{tr('ws.cashier.charge.noBookings')}</p>
      ) : visible.length === 0 ? (
        <p style={muted}>{tr('ws.cashier.charge.noMatches')}</p>
      ) : (
        <div role="listbox" aria-label={tr('ws.cashier.charge.search')} style={{ display: 'grid', gap: 'var(--tp-sp-1)', maxBlockSize: '14rem', overflowY: 'auto' }}>
          {visible.map((r) => {
            const selected = r.id === selectedId;
            return (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={selected}
                className="tp-row"
                data-clickable="true"
                data-selected={selected ? 'true' : undefined}
                onClick={() => onSelect(selected ? '' : r.id)}
                style={{
                  ...touchTarget,
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
                <bdi>{reservationOptionLabel(tr, locale, r)}</bdi>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function NewTabDialog({
  onClose,
  onOpened,
  initialReservationId,
}: {
  onClose: () => void;
  onOpened: (tabId: string) => void;
  /** `/till?reservation=<id>` — pre-bind the tab to that booking. */
  initialReservationId?: string;
}) {
  const { tr, locale } = useLocale();
  const [tableId, setTableId] = useState('');
  const [label, setLabel] = useState('');
  const [reservationId, setReservationId] = useState(initialReservationId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // ACTIVE tables only (QK.activeCafeTables is separate from the QR admin's all-rows key).
  const tablesQ = useQuery({ queryKey: QK.activeCafeTables, queryFn: fetchActiveCafeTables });
  const reservationsQ = useTodaysOpenReservations();
  const reservations = reservationsQ.data ?? [];
  const preboundMissing =
    Boolean(initialReservationId) && reservationsQ.isSuccess && !reservations.some((r) => r.id === initialReservationId);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await mutate<{ tab_id: string }>('tab.open', {
        ...(tableId ? { tableId } : {}),
        ...(label ? { label } : {}),
        ...(reservationId ? { reservationId } : {}),
      });
      if (outcome.result) {
        onOpened(outcome.result.tab_id);
      } else {
        // Queued offline: durably on disk, replays on reconnect. Its tab.open
        // key is its local identity until the server id exists.
        addOfflineTab({
          idemKey: outcome.idempotencyKey,
          localId: outcome.localId,
          label: label || null,
          tableNumber: tableId
            ? ((tablesQ.data ?? []).find((t) => t.id === tableId)?.table_number ?? null)
            : null,
        });
        onOpened(`${LOCAL_TAB_PREFIX}${outcome.idempotencyKey}`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const bound = reservations.find((r) => r.id === reservationId);
  // app.open_tab needs at least one anchor; which one is the cashier's choice.
  const anchored = Boolean(tableId || label || reservationId);

  return (
    <Modal
      title={tr('op.till.newTab')}
      onClose={onClose}
      footer={
        // Reserved height: the reason line below "Open tab" appears and clears
        // as the cashier picks an anchor, and the button it explains must not
        // travel while they are reaching for it.
        <div style={reasonedFooter}>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={!anchored}
            disabledReason={anchored ? undefined : tr('ws.cashier.newTab.needAnchor')}
            onClick={() => void submit()}
          >
            {tr('op.till.openTabBtn')}
          </Button>
        </div>
      }
    >
      {initialReservationId && bound && (
        <MessagePresenter
          tone="info"
          icon="calendar"
          style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
          message={
            <>
              <strong>{tr('ws.cashier.newTab.fromBooking')}</strong> — <bdi>{reservationOptionLabel(tr, locale, bound)}</bdi>
              <br />
              {tr('ws.cashier.newTab.fromBookingHint')}
            </>
          }
        />
      )}
      {preboundMissing && (
        <MessagePresenter tone="refused" style={{ marginBlockEnd: 'var(--tp-sp-3)' }} message={tr('ws.cashier.newTab.bookingMissing')} />
      )}
      <Field label={tr('op.till.table')}>
        <select style={inputStyle} value={tableId} onChange={(e) => setTableId(e.target.value)} autoFocus>
          <option value="">{tr('op.till.chooseTable')}</option>
          {(tablesQ.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.table_number}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.till.byName')}>
        <input style={inputStyle} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label={tr('op.till.reservationLabel')}>
        <select style={inputStyle} value={reservationId} onChange={(e) => setReservationId(e.target.value)}>
          <option value="">{tr('op.till.noReservation')}</option>
          {reservations.map((r) => (
            <option key={r.id} value={r.id}>
              {reservationOptionLabel(tr, locale, r)}
            </option>
          ))}
        </select>
      </Field>
      <ErrorText error={error} />
    </Modal>
  );
}
