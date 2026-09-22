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
import { useAuth } from '../../lib/auth';
import { Button, ErrorText, Field, Modal, inputStyle, Select } from '../../components/ui';
import { MessagePresenter, SearchField } from '../../components/kit';
import { Switch } from '../../components/Switch';
import { bookingTakesNewTab, canReadBookings, type TabListRow } from './tillData';
import { muted, reasonedFooter, touchTarget } from './tillStyles';

export interface OpenReservationRow {
  id: string;
  start_at: string;
  guest_name: string | null;
  court: { name_en: string; name_ar: string } | null;
  tabs: { id: string; status: string }[];
}

/**
 * Today's confirmed/arrived bookings without a live tab. RLS: since 0106 a
 * cashier reads tonight's bookings too (reservations_cashier_read).
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
        .select('id, start_at, end_at, guest_name, court:courts!reservations_court_id_fkey(name_en, name_ar), tabs!tabs_reservation_id_fkey(id, status)')
        .in('status', ['confirmed', 'arrived'])
        .gte('start_at', dayStart.toISOString())
        .lt('start_at', dayEnd.toISOString())
        .order('start_at');
      if (error) throw error;
      return (data as unknown as OpenReservationRow[]).filter(bookingTakesNewTab);
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

/** Searchable list of today's bookings without a live tab; one is selected at a time. */
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

/**
 * app.open_tab through the queue; resolves to the id the till selects. Online
 * that is the server's tab id. Queued offline the tab.open is durably on disk
 * and replays on reconnect, and its key is the tab's local identity until the
 * server id exists. The floor's tap-to-open and this dialog share it.
 */
export async function openTabOn(
  anchor: { tableId?: string; label?: string; reservationId?: string; kind?: 'shop' },
  tableNumber: string | null,
): Promise<string> {
  const outcome = await mutate<{ tab_id: string }>('tab.open', {
    ...(anchor.kind ? { kind: anchor.kind } : {}),
    ...(anchor.tableId ? { tableId: anchor.tableId } : {}),
    ...(anchor.label ? { label: anchor.label } : {}),
    ...(anchor.reservationId ? { reservationId: anchor.reservationId } : {}),
  });
  if (outcome.result) return outcome.result.tab_id;
  addOfflineTab({ idemKey: outcome.idempotencyKey, localId: outcome.localId, label: anchor.label ?? null, tableNumber });
  return `${LOCAL_TAB_PREFIX}${outcome.idempotencyKey}`;
}

export function NewTabDialog({
  onClose,
  onOpened,
  initialReservationId,
  openTabs = [],
  onPickExisting,
  shopEnabled = false,
}: {
  onClose: () => void;
  onOpened: (tabId: string) => void;
  /** `/till?reservation=<id>` — pre-bind the tab to that booking. */
  initialReservationId?: string;
  /** The floor's open tabs, so a table that already has one can say so. */
  openTabs?: readonly Pick<TabListRow, 'id' | 'table'>[];
  /** Go to a table's existing tab instead of opening a second one. */
  onPickExisting?: (tabId: string) => void;
  /** The menu has a Touch Shop section, so a counter sale (no table) is on offer (0145). */
  shopEnabled?: boolean;
}) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  // A role that cannot read bookings (see canReadBookings) would get a select
  // that only ever held "No booking". Shown when it can hold something, or
  // when the desk already chose the booking.
  const showBookings = canReadBookings(staff?.role) || Boolean(initialReservationId);
  const [tableId, setTableId] = useState('');
  const [label, setLabel] = useState('');
  const [reservationId, setReservationId] = useState(initialReservationId ?? '');
  // A shop counter sale: no table, no booking, a name or a number instead.
  const [counter, setCounter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // ACTIVE tables only (QK.activeCafeTables is separate from the QR admin's all-rows key).
  const tablesQ = useQuery({ queryKey: QK.activeCafeTables, queryFn: fetchActiveCafeTables });
  const reservationsQ = useTodaysOpenReservations(canReadBookings(staff?.role) || Boolean(initialReservationId));
  const reservations = reservationsQ.data ?? [];
  const preboundMissing =
    Boolean(initialReservationId) && reservationsQ.isSuccess && !reservations.some((r) => r.id === initialReservationId);

  // Whitespace is not an anchor. Untrimmed, a single space in "By name" both
  // satisfied the anchor gate here and passed app.open_tab's
  // TAB_ANCHOR_REQUIRED check (`p_label is null`), opening a tab the board can
  // only render as a blank row.
  const trimmedLabel = label.trim();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onOpened(
        counter
          ? await openTabOn({ kind: 'shop', label: trimmedLabel }, null)
          : await openTabOn(
              { tableId: tableId || undefined, label: trimmedLabel || undefined, reservationId: reservationId || undefined },
              tableId ? ((tablesQ.data ?? []).find((t) => t.id === tableId)?.table_number ?? null) : null,
            ),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const bound = reservations.find((r) => r.id === reservationId);
  /*
   * A tab is anchored to a SEAT: a table, or a booking (which carries its own
   * court). A name on its own is not an anchor — it used to be, and a tab with
   * nothing but a name cannot be found by anyone who was not standing at the
   * till when it was opened. The name stays as the tab's display label, which
   * is the job it was actually doing. Mirrored by app.open_tab (0084).
   */
  const anchored = counter ? trimmedLabel.length > 0 : Boolean(tableId || reservationId);
  const chosenTable = (tablesQ.data ?? []).find((t) => t.id === tableId);
  // Two tabs on one table split its bill in a way nobody asked for; the usual
  // intent is "add to the table's tab". Said, not blocked — a second party at
  // a shared table is real.
  const existing = chosenTable ? openTabs.find((t) => t.table?.table_number === chosenTable.table_number) : undefined;

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
            disabledReason={
              anchored
                ? undefined
                : counter
                  ? tr('ws.cashier.newTab.needLabel')
                  : showBookings
                    ? tr('ws.cashier.newTab.needAnchor')
                    : tr('ws.cashier.newTab.needTable')
            }
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
      {shopEnabled && !initialReservationId && (
        <div style={{ marginBlockEnd: 'var(--tp-sp-3)', display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <Switch checked={counter} onChange={setCounter} label={tr('ws.cashier.newTab.counterSale')} />
          <span style={muted}>{tr('ws.cashier.newTab.counterSaleHint')}</span>
        </div>
      )}
      {counter ? (
        <Field label={tr('op.till.byName')} required hint={tr('ws.cashier.newTab.counterNameHint')}>
          <input style={inputStyle} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </Field>
      ) : (
      <>
      <Field label={tr('op.till.table')} required={!reservationId}>
        <Select
          value={tableId}
          onChange={setTableId}
          options={[
            { value: '', label: tr('op.till.chooseTable') },
            ...(tablesQ.data ?? []).map((t) => ({ value: t.id, label: String(t.table_number) })),
          ]}
        />
      </Field>
      {existing && (
        <MessagePresenter
          tone="info"
          icon="receipt"
          style={{ marginBlock: 'calc(-1 * var(--tp-sp-1)) var(--tp-sp-3)' }}
          message={
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
              {tr('ws.cashier.newTab.tableHasTab')}
              {onPickExisting && (
                <Button size="sm" iconEnd="arrowUpRight" onClick={() => onPickExisting(existing.id)}>
                  {tr('ws.cashier.newTab.goToTab')}
                </Button>
              )}
            </span>
          }
        />
      )}
      <Field label={tr('op.till.byName')} optional hint={tr('ws.cashier.newTab.nameHint')}>
        <input style={inputStyle} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      {showBookings && (
        <Field label={tr('op.till.reservationLabel')} optional>
          <Select
            value={reservationId}
            onChange={setReservationId}
            options={[
              { value: '', label: tr('op.till.noReservation') },
              ...reservations.map((r) => ({ value: r.id, label: reservationOptionLabel(tr, locale, r) })),
            ]}
          />
        </Field>
      )}
      </>
      )}
      <ErrorText error={error} />
    </Modal>
  );
}
