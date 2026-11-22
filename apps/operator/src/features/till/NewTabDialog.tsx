/**
 * New order dialog (one screen since 2026-11-20) — a counter tab, or a booking's bill (app.open_tab; order
 * first since 0352, the table attached to each order after). Also the
 * home of the reservation picker that 06.17 (charge to booking) reuses.
 *
 * Offline: a queued tab.open becomes a local tab whose identity is the
 * envelope's idempotency key (lib/offlineTabs).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTime, isolate } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/mutate';
import { LOCAL_TAB_PREFIX, addOfflineTab } from '../../lib/offlineTabs';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { tonightScope } from '../desk/useTradingNight';
import { useLocale, pickName } from '../../lib/i18n';
import { can, useAuth } from '../../lib/auth';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { WizardNote } from '../../components/StepWizard';
import { SearchField } from '../../components/kit';
import type { IdentifiedMember } from '@touch/core/loyalty';
import { isMemberScan, parseAppCode } from '../loyalty/loyaltyLogic';
import { identifyMember, invalidateTabLoyalty, needsAttachPin, setTabCustomer } from '../loyalty/useLoyalty';
import { StaffPinDialog } from '../loyalty/MemberAttach';
import { bookingTakesNewTab } from './tillData';
import { isMatchLiteral } from '../matches/matchLogic';
import { isLessonLiteral } from '../coaching/lessonLogic';
import { muted, touchTarget } from './tillStyles';
import { sanitizePhone } from '../desk/deskLogic';
import { deskAccountInput, useDeskAccount, useToastIfMounted } from '../desk/customers/deskAccount';

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

/**
 * New order, one screen (Majed, 2026-11-20): a name, or the member's card scanned into the same
 * field, then Start order. A phone number may be added under the name (Majed, 2026-11-21, 0448:
 * every customer a desk writes down is in the customer database): the order opens at once, and
 * behind it the name and number become a customer account (the one the number already has, or a
 * new one) that goes on the bill, as a scanned card does. A name with no number is saved too, as
 * an incomplete customer on the bill; an order with no name stays the counter's number, nobody's. A number that belongs to somebody under
 * ANOTHER name is not put on the bill by word of mouth: the till says whose it is and asks for
 * their card. A scanned card (TP-…) is looked up first
 * (loyalty_identify), the order opens under the member's name, and the member goes on the bill
 * (set_tab_customer); a member who works here asks for another manager's PIN (StaffPinDialog), and
 * the order stays open either way. A booking's bill comes from the desk (`/till?reservation=`) or
 * from "Charge to booking"; a table tapped on the floor still opens its order here.
 */
export function NewTabDialog({
  onClose,
  onOpened,
  initialReservationId,
  table,
}: {
  onClose: () => void;
  onOpened: (tabId: string) => void;
  /** A free table tapped on the floor: the tab is saved on this table. */
  table?: { id: string; tableNumber: string };
  /** `/till?reservation=<id>` — pre-bind the tab to that booking. */
  initialReservationId?: string;
}) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  // 0448: an optional number beside a typed name makes the guest a customer.
  const [phone, setPhone] = useState('');
  const deskAccount = useDeskAccount();
  const toast = useToastIfMounted();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** A member who works here: the tab is open, the attach waits on another manager's PIN. */
  const [staffPin, setStaffPin] = useState<{ tabId: string; member: IdentifiedMember } | null>(null);

  const reservationsQ = useTodaysOpenReservations(Boolean(initialReservationId));
  const reservations = reservationsQ.data ?? [];
  const bound = reservations.find((r) => r.id === initialReservationId);
  const preboundMissing = Boolean(initialReservationId) && reservationsQ.isSuccess && !bound;

  // Whitespace is not a name: the server would number it like an empty one.
  const trimmed = text.trim();
  const memberCard = isMemberScan(trimmed);
  // A booking's bill already has its guest, and a scanned card is the member: no number is asked for.
  const asksPhone = !memberCard && !initialReservationId;

  /**
   * After the order is open, never in its way: the typed name and number
   * become a customer, who goes on the bill unless the number is somebody's
   * under another name. Every failure is silent; the order stands as typed.
   */
  async function saveTypedCustomer(tabId: string, name: string, number: string) {
    const found = await deskAccount(name, number, { quiet: true });
    if (!found) return;
    const who = isolate(found.customer.name);
    if (found.check) {
      toast?.info(tr('ws.cashier.newTab.phoneOtherName', { name: who }));
      return;
    }
    try {
      await setTabCustomer(tabId, found.customer.id);
      invalidateTabLoyalty(qc, tabId, found.customer.id);
      // A name alone is saved on every named order: said by the hint under the box, not by a toast each time.
      if (!found.incomplete) toast?.info(tr(found.existing ? 'ws.courtDesk.deskAccount.linked' : 'ws.courtDesk.deskAccount.created', { name: who }));
    } catch {
      // Saved as a customer; not on this bill (a colleague's number needs a manager's PIN, or the bill moved on).
      if (!found.existing && !found.incomplete) toast?.info(tr('ws.courtDesk.deskAccount.created', { name: who }));
    }
  }

  async function submit() {
    if (busy) return;
    setError(null);
    setRefusal(null);
    // A reward's or a deal's code belongs on a bill that exists (the member block reads it there).
    if (parseAppCode(trimmed)) {
      setRefusal(tr('ws.cashier.newTab.appCodeHere'));
      return;
    }
    if (memberCard && !can(staff, 'attachMember')) {
      setRefusal(tr('ws.cashier.newTab.memberNotAllowed'));
      return;
    }
    setBusy(true);
    try {
      // The card first: a refused or unknown card opens nothing.
      const member = memberCard ? await identifyMember(trimmed.toUpperCase()) : null;
      const name = member ? member.display_name?.trim().slice(0, 60) || undefined : trimmed || undefined;
      /* Order first (0352): a café order starts at the counter with no table.
         Where each order goes is attached to that order afterwards, from the
         tab ("Bring to…"), whenever the guest sits; a booking is still a bill
         of its own (the court fee joins it at settlement). */
      const tabId = await openTabOn(
        { label: name, reservationId: initialReservationId || undefined, tableId: table?.id },
        table?.tableNumber ?? null,
      );
      if (member && !tabId.startsWith(LOCAL_TAB_PREFIX)) {
        try {
          await setTabCustomer(tabId, member.customer_id);
          invalidateTabLoyalty(qc, tabId, member.customer_id);
        } catch (e) {
          // 0308 (c2): a member who works here is added only behind another manager's PIN.
          if (needsAttachPin(e)) {
            setStaffPin({ tabId, member });
            return;
          }
          // The order is open; the member can still be added from the bill.
          onOpened(tabId);
          throw e;
        }
      }
      // 0448: a typed name (with its number, or alone: an incomplete customer), on a tab the server already has.
      if (!member && asksPhone && deskAccountInput(trimmed, phone) && !tabId.startsWith(LOCAL_TAB_PREFIX)) {
        void saveTypedCustomer(tabId, trimmed, phone);
      }
      onOpened(tabId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (staffPin) {
    return (
      <StaffPinDialog
        tabId={staffPin.tabId}
        member={staffPin.member}
        onClose={() => onOpened(staffPin.tabId)}
        onDone={() => {
          invalidateTabLoyalty(qc, staffPin.tabId, staffPin.member.customer_id);
          onOpened(staffPin.tabId);
        }}
      />
    );
  }

  return (
    <Modal
      title={tr('ws.cashier.newTab.orderTitle')}
      size="sm"
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" icon={memberCard ? 'userPlus' : undefined} busy={busy} onClick={() => void submit()} data-testid="new-order.submit">
            {tr('ws.cashier.newTab.start')}
          </Button>
        </>
      )}
    >
      {table && <WizardNote>{tr('ws.cashier.newTab.tableOrderBody', { table: `${tr('op.till.table')} ${table.tableNumber}` })}</WizardNote>}
      {initialReservationId && bound && (
        <WizardNote>
          <strong>{tr('ws.cashier.newTab.fromBooking')}</strong> — <bdi>{reservationOptionLabel(tr, locale, bound)}</bdi>
          <br />
          {tr('ws.cashier.newTab.fromBookingHint')}
        </WizardNote>
      )}
      {preboundMissing && <WizardNote tone="refused">{tr('ws.cashier.newTab.bookingMissing')}</WizardNote>}
      <Field
        label={tr('ws.cashier.newTab.nameOrMember')}
        optional
        hint={memberCard ? tr('ws.cashier.newTab.memberSeen') : tr('ws.cashier.newTab.nameOrMemberHint')}
        error={refusal ?? undefined}
        style={{ marginBlockEnd: 0 }}
      >
        <input
          style={inputStyle}
          value={text}
          maxLength={60}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          data-testid="new-order.name"
          onChange={(e) => {
            setText(e.target.value);
            setRefusal(null);
          }}
          onKeyDown={(e) => {
            // The scanner ends its burst with Enter, as a person does: either one starts the order.
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </Field>
      {asksPhone && (
        <Field label={tr('ws.cashier.newTab.phone')} optional hint={tr('ws.cashier.newTab.phoneHint')} style={{ marginBlockStart: 'var(--tp-sp-3)', marginBlockEnd: 0 }}>
          <input
            style={inputStyle}
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="off"
            maxLength={30}
            value={phone}
            disabled={busy}
            data-testid="new-order.phone"
            onChange={(e) => setPhone(sanitizePhone(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </Field>
      )}
      {error ? <ErrorText error={error} /> : null}
    </Modal>
  );
}
