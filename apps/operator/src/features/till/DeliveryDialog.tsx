/**
 * "Bring to…" (0352, order first): how one sent order reaches the guest,
 * chosen at any time after it was placed. Pick up, or bring it to a table, to
 * a booking's court, or (not chosen yet) the tab's own seat, which on a
 * counter tab is nowhere: the kitchen card then says "No table yet".
 *
 * One app.order_set_delivery call, online only (it moves no money, and the
 * board re-reads it from the kds broadcast the call sends).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { QK, fetchActiveCafeTables } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { Button, ErrorText, Modal } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { useCourtBookings } from './FloorView';
import { canReadBookings, type OrderService, type TabOrderRow } from './tillData';
import { reservationNameOf } from '../matches/matchLogic';
import { muted, sectionTitle, touchTarget } from './tillStyles';

type Spot = { kind: 'table'; id: string } | { kind: 'reservation'; id: string } | null;

/** The order's current spot, as the dialog's selection. */
function spotOf(order: Pick<TabOrderRow, 'deliver_table_id' | 'deliver_reservation_id'>): Spot {
  if (order.deliver_table_id) return { kind: 'table', id: order.deliver_table_id };
  if (order.deliver_reservation_id) return { kind: 'reservation', id: order.deliver_reservation_id };
  return null;
}

export function DeliveryDialog({
  order,
  tabId,
  seatLabel,
  onClose,
}: {
  order: TabOrderRow;
  tabId: string;
  /** "Table 4" / "Court 2" when the tab itself sits somewhere, else null (a counter tab). */
  seatLabel: string | null;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const queryClient = useQueryClient();
  const tablesQ = useQuery({ queryKey: QK.activeCafeTables, queryFn: fetchActiveCafeTables });
  const courtsQ = useCourtBookings();
  const tables = tablesQ.data ?? [];
  const showCourts = canReadBookings(staff);

  const [service, setService] = useState<OrderService>(order.service ?? 'deliver');
  const [spot, setSpot] = useState<Spot>(() => spotOf(order));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('order_set_delivery', {
        p_order_id: order.id,
        p_service: service,
        p_table_id: service === 'deliver' && spot?.kind === 'table' ? spot.id : null,
        p_reservation_id: service === 'deliver' && spot?.kind === 'reservation' ? spot.id : null,
        p_device_id: deviceId(),
      });
      void queryClient.invalidateQueries({ queryKey: ['tab', tabId] });
      void queryClient.invalidateQueries({ queryKey: ['tabs'] });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const courts = courtsQ.data?.courts ?? [];
  const bookings = courtsQ.data?.bookings ?? [];
  const courtById = new Map(courts.map((c) => [c.id, c]));
  const choice = (selected: boolean) => ({
    ...touchTarget,
    border: `1px solid ${selected ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
    background: selected ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
    borderRadius: 'var(--tp-radius-ctl)',
    paddingInline: 'var(--tp-sp-2-5)',
    font: 'inherit',
    color: 'inherit',
    fontWeight: selected ? 700 : 500,
    cursor: 'pointer',
  });

  return (
    <Modal
      title={tr('ws.cashier.delivery.title')}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} onClick={() => void save()} data-testid="delivery-save">
            {tr('common.save')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <SegmentedControl<OrderService>
          block
          aria-label={tr('ws.cashier.till.basket.service')}
          value={service}
          onChange={setService}
          options={[
            { value: 'deliver', icon: 'arrowEnd', label: tr('ws.cashier.till.basket.deliver'), testId: 'delivery-deliver' },
            { value: 'pickup', icon: 'package', label: tr('ws.cashier.till.basket.pickup'), testId: 'delivery-pickup' },
          ]}
        />

        {service === 'deliver' && (
          <>
            <button
              type="button"
              aria-pressed={spot === null}
              data-testid="delivery-spot-none"
              onClick={() => setSpot(null)}
              style={{ ...choice(spot === null), textAlign: 'start' }}
            >
              {seatLabel ? tr('ws.cashier.delivery.tabSeat', { spot: seatLabel }) : tr('ws.cashier.delivery.notYet')}
            </button>

            <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
              <h3 style={sectionTitle}>{tr('ws.cashier.delivery.tables')}</h3>
              {tables.length === 0 ? (
                <p style={muted}>{tablesQ.isLoading ? tr('common.loading') : tr('ws.cashier.delivery.noTables')}</p>
              ) : (
                <div role="group" aria-label={tr('ws.cashier.delivery.tables')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(4.5rem, 1fr))', gap: 'var(--tp-sp-1)' }}>
                  {tables.map((t) => {
                    const selected = spot?.kind === 'table' && spot.id === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={selected}
                        data-testid="delivery-table"
                        onClick={() => setSpot({ kind: 'table', id: t.id })}
                        style={choice(selected)}
                      >
                        <bdi>{t.table_number}</bdi>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {showCourts && (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
                <h3 style={sectionTitle}>{tr('ws.cashier.delivery.courts')}</h3>
                {bookings.length === 0 ? (
                  <p style={muted}>{courtsQ.isLoading ? tr('common.loading') : tr('ws.cashier.delivery.noBookings')}</p>
                ) : (
                  <div role="group" aria-label={tr('ws.cashier.delivery.courts')} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                    {bookings.map((b) => {
                      const selected = spot?.kind === 'reservation' && spot.id === b.id;
                      const court = courtById.get(b.court_id);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          aria-pressed={selected}
                          data-testid="delivery-booking"
                          onClick={() => setSpot({ kind: 'reservation', id: b.id })}
                          style={{ ...choice(selected), textAlign: 'start' }}
                        >
                          <bdi>
                            {tr('ws.cashier.charge.option', {
                              time: formatTime(new Date(b.start_at), locale),
                              court: court ? pickName(locale, court) : '—',
                              guest: reservationNameOf(b, tr) ?? '—',
                            })}
                          </bdi>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}
