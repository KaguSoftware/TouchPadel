/**
 * ChargeToBookingScreen (spec 06.17) for a tab that is ALREADY open.
 *
 * There is no single RPC that re-anchors an open tab to a booking; the two
 * audited primitives that exist are `app.open_tab(p_reservation_id)` (which
 * stamps the court fee at settlement) and `app.merge_tabs`. This dialog
 * composes them: open the booking's tab, then merge this tab into it. The
 * consequence is stated before the action fires. If the merge is refused after
 * the open succeeded, the copy says so — the original tab is untouched and the
 * (empty) booking tab is visible on Open tabs.
 *
 * A booking has at most one live tab (0106). When someone opened it between
 * the picker loading and this press, `open_tab` refuses with BOOKING_TAB_OPEN
 * and names that tab in `details` — which is the tab this one belongs on, so
 * the merge goes there instead of the press failing.
 *
 * A tab opened with a booking from the start uses NewTabDialog's picker.
 */
import { useState } from 'react';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { mutate } from '../../lib/mutate';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Modal } from '../../components/ui';
import { AsyncStateWrapper, MessagePresenter, asyncStatus } from '../../components/kit';
import { ReservationPicker, reservationOptionLabel, useTodaysOpenReservations } from './NewTabDialog';
import { muted, reasonedFooter } from './tillStyles';

export function ChargeToBookingDialog({
  tabId,
  tabLabel,
  onDone,
  onClose,
}: {
  tabId: string;
  tabLabel: string;
  /** The surviving (booking-bound) tab id. */
  onDone(newTabId: string): void;
  onClose(): void;
}) {
  const { tr, locale } = useLocale();
  const reservationsQ = useTodaysOpenReservations();
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [partialFailure, setPartialFailure] = useState(false);

  const rows = reservationsQ.data ?? [];
  const selected = rows.find((r) => r.id === selectedId);

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setPartialFailure(false);
    let survivorId: string | null = null;
    try {
      let target: string;
      try {
        const outcome = await mutate<{ tab_id: string }>('tab.open', { reservationId: selected.id });
        if (!outcome.result) {
          // Queued offline: the merge cannot reference a tab that has no server
          // id yet. Refuse cleanly rather than half-do it.
          throw new Error('QUEUED');
        }
        target = outcome.result.tab_id;
        survivorId = target;
      } catch (e) {
        // The booking already has its live tab: merge into that one. Not a
        // partial failure if the merge is then refused — nothing was opened.
        const existing = e instanceof AppRpcError && e.code === 'BOOKING_TAB_OPEN' ? e.details?.trim() : undefined;
        if (!existing) throw e;
        target = existing;
      }
      await appRpc('merge_tabs', { p_donor_tab_id: tabId, p_survivor_tab_id: target });
      onDone(target);
    } catch (e) {
      setError(e);
      if (survivorId) setPartialFailure(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.cashier.charge.title')}
      subtitle={tr('ws.cashier.charge.lead')}
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <div style={reasonedFooter}>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="calendar"
            busy={busy}
            disabled={!selected}
            disabledReason={selected ? undefined : tr('ws.cashier.charge.pickBooking')}
            onClick={() => void confirm()}
          >
            {tr('ws.cashier.charge.confirm')}
          </Button>
        </div>
      )}
    >
      <p style={{ marginBlockEnd: 'var(--tp-sp-2-5)' }}>
        <strong>
          <bdi>{tabLabel}</bdi>
        </strong>
      </p>
      <AsyncStateWrapper
        status={asyncStatus(reservationsQ, (d) => d.length === 0)}
        onRetry={() => void reservationsQ.refetch()}
        error={reservationsQ.error}
        compact
        emptyContent={<p style={muted}>{tr('ws.cashier.charge.noBookings')}</p>}
      >
        <ReservationPicker rows={rows} selectedId={selectedId} onSelect={setSelectedId} busy={busy} />
      </AsyncStateWrapper>
      {selected && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-3)' }}>
          <p>
            <span style={muted}>{tr('ws.cashier.charge.selected')}</span>
            <br />
            <strong>
              <bdi>{reservationOptionLabel(tr, locale, selected)}</bdi>
            </strong>
          </p>
          <MessagePresenter tone="info" icon="info" message={tr('ws.cashier.charge.consequence')} />
        </div>
      )}
      {partialFailure && <MessagePresenter tone="refused" style={{ marginBlockStart: 'var(--tp-sp-2)' }} message={tr('ws.cashier.charge.partialFailure')} />}
      <ErrorText error={error} />
    </Modal>
  );
}
