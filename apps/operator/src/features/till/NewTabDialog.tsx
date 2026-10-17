/**
 * New order dialog — a counter tab, or a booking's bill (app.open_tab; order
 * first since 0352, the table attached to each order after). Also the
 * home of the reservation picker that 06.17 (charge to booking) reuses.
 *
 * Offline: a queued tab.open becomes a local tab whose identity is the
 * envelope's idempotency key (lib/offlineTabs).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/mutate';
import { LOCAL_TAB_PREFIX, addOfflineTab } from '../../lib/offlineTabs';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { tonightScope } from '../desk/useTradingNight';
import { useLocale, pickName } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { Button, ErrorText, Field, Modal, inputStyle, Select } from '../../components/ui';
import { MessagePresenter, SearchField } from '../../components/kit';
import { bookingTakesNewTab, canReadBookings } from './tillData';
import { isMatchLiteral } from '../matches/matchLogic';
import { isLessonLiteral } from '../coaching/lessonLogic';
import { muted, reasonedFooter, touchTarget } from './tillStyles';

export interface OpenReservationRow {
  id: string;
  start_at: string;
  /** Read so an open match's booking (no account, the literal name) can be left out. */
  guest_id: string | null;
  guest_name: string | null;
  /** Read so a lesson's court row can be left out (coaching operator.md §5.8); absent from rows built elsewhere. */
  kind?: string;
  court: { name_en: string; name_ar: string } | null;
  tabs: { id: string; status: string }[];
}

/**
 * A booking the till may put a bill on: no live tab yet, and not an open
 * match's booking. Cafe lines never go on a match booking (DF-16): its players
 * order on their own bills. The server refuses them anyway
 * (MATCH_BOOKING_NO_CAFE, R20); this keeps the picker from offering one.
 *
 * Nor a lesson's court row (coaching operator.md §5.8): a lesson is paid on
 * its own screen, and open_tab refuses one (LESSON_VIA_COACHING `tab`).
 */
export function tillMayBill(r: Pick<OpenReservationRow, 'guest_id' | 'guest_name' | 'tabs' | 'kind'>): boolean {
  return bookingTakesNewTab(r) && !isMatchLiteral(r) && !isLessonLiteral(r);
}

/**
 * Today's confirmed/arrived bookings without a live tab, open matches' left
 * out (tillMayBill). RLS: since 0106 a cashier reads tonight's bookings too
 * (reservations_cashier_read).
 */
export function useTodaysOpenReservations(enabled = true) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['openTabReservations'],
    enabled,
    queryFn: async () => {
      const night = await tonightScope(() => queryClient.ensureQueryData({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings }));
      const { data, error } = await supabase
        .from('reservations')
        .select('id, start_at, end_at, kind, guest_id, guest_name, court:courts!reservations_court_id_fkey(name_en, name_ar), tabs!tabs_reservation_id_fkey(id, status)')
        .in('status', ['confirmed', 'arrived'])
        .gte('start_at', night.start)
        .lt('start_at', night.end)
        .order('start_at');
      if (error) throw error;
      return (data as unknown as OpenReservationRow[]).filter((r) => night.isTonight(r.start_at) && tillMayBill(r));
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
}: {
  onClose: () => void;
  onOpened: (tabId: string) => void;
  /** `/till?reservation=<id>` — pre-bind the tab to that booking. */
  initialReservationId?: string;
}) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  // A role that cannot read bookings (see canReadBookings) would get a select
  // that only ever held "No booking". Shown when it can hold something, or
  // when the desk already chose the booking.
  const showBookings = canReadBookings(staff) || Boolean(initialReservationId);
  const [label, setLabel] = useState('');
  const [reservationId, setReservationId] = useState(initialReservationId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const reservationsQ = useTodaysOpenReservations(canReadBookings(staff) || Boolean(initialReservationId));
  const reservations = reservationsQ.data ?? [];
  const preboundMissing =
    Boolean(initialReservationId) && reservationsQ.isSuccess && !reservations.some((r) => r.id === initialReservationId);

  // Whitespace is not a name: the server would number it like an empty one.
  const trimmedLabel = label.trim();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      /* Order first (0352): a café order starts at the counter with no table.
         Where each order goes is attached to that order afterwards, from the
         tab ("Bring to…"), whenever the guest sits; a booking is still a bill
         of its own (the court fee joins it at settlement). */
      onOpened(await openTabOn({ label: trimmedLabel || undefined, reservationId: reservationId || undefined }, null));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const bound = reservations.find((r) => r.id === reservationId);

  return (
    <Modal
      title={tr('ws.cashier.newTab.orderTitle')}
      onClose={onClose}
      footer={(close) => (
        <div style={reasonedFooter}>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} onClick={() => void submit()}>
            {tr('ws.cashier.newTab.start')}
          </Button>
        </div>
      )}
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
      <Field label={tr('ws.cashier.newTab.nameLabel')} optional hint={tr('ws.cashier.newTab.counterHint')}>
        <input
          style={inputStyle}
          value={label}
          maxLength={60}
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void submit();
          }}
        />
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
      <ErrorText error={error} />
    </Modal>
  );
}
