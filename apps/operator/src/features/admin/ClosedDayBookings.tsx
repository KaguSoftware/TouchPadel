/**
 * The bookings on the closed days being added (0390, F-51; Majed 2026-11-01:
 * "each booking must first be cancelled, marked no-show or paid; the closed
 * day cannot be saved until all are resolved").
 *
 * app.closed_day_bookings lists, for the dates the draft adds, every booking
 * still to resolve; each row offers Cancel, No-show (once it has started: the
 * server refuses an earlier one) and Take payment (the desk's own court bill
 * panel). The editor disables Save while the list is not empty, and
 * app.set_opening_hours refuses the same dates on its own
 * (CLOSED_DAY_HAS_BOOKINGS), so a stale screen cannot close a day with a
 * booking on it.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatIQD, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { mutate } from '../../lib/mutate';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Modal } from '../../components/ui';
import { MessagePresenter, Panel } from '../../components/kit';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CourtBillPanel } from '../desk/payment/CourtBillPanel';
import { closedDayActions, readClosedDayBookings, type ClosedDayBooking } from './closedDates';

/** Feature-private: one list per set of added dates. */
export const closedDayBookingsKey = (dates: readonly string[]) => ['closed-day-bookings', ...dates] as const;

export function useClosedDayBookings(dates: readonly string[]) {
  return useQuery({
    queryKey: closedDayBookingsKey(dates),
    queryFn: async () => readClosedDayBookings(await appRpc('closed_day_bookings', { p_dates: dates })),
    enabled: dates.length > 0,
    retry: false,
  });
}

type Pending = { kind: 'cancel' | 'noShow'; booking: ClosedDayBooking } | null;

export function ClosedDayBookings({ dates, tz }: { dates: readonly string[]; tz?: string }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const q = useClosedDayBookings(dates);
  const [pending, setPending] = useState<Pending>(null);
  const [paying, setPaying] = useState<ClosedDayBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [queued, setQueued] = useState(false);

  if (dates.length === 0) return null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['closed-day-bookings'] });
    void qc.invalidateQueries({ queryKey: ['reservations'] });
    void qc.invalidateQueries({ queryKey: ['bookingBill'] });
  };

  const who = (b: ClosedDayBooking) => (b.guestName ? isolate(b.guestName) : tr('op.hours.walkIn'));
  const court = (b: ClosedDayBooking) => isolate((locale === 'ar' ? b.courtNameAr : b.courtNameEn) ?? b.courtNameEn ?? '');
  const when = (b: ClosedDayBooking) => formatDateTime(new Date(b.startAt), locale, tz);

  async function run(p: NonNullable<Pending>) {
    setBusy(true);
    setError(null);
    setQueued(false);
    try {
      const outcome =
        p.kind === 'cancel'
          ? await mutate('reservation.update', { action: 'cancel', reservationId: p.booking.id, reason: tr('op.hours.cancelReason') })
          : await mutate('reservation.update', { action: 'mark', reservationId: p.booking.id, status: 'no_show', reason: null });
      setQueued(outcome.queued);
      setPending(null);
      refresh();
    } catch (e) {
      setPending(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const rows = q.data ?? [];

  return (
    <Panel title={tr('op.hours.bookingsTitle')}>
      <div data-testid="hours.closedBookings" style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {q.isLoading ? (
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('op.hours.bookingsChecking')}</p>
        ) : q.isError ? (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <MessagePresenter tone="error" message={tr('op.hours.bookingsError')} />
            <Button size="sm" onClick={() => void q.refetch()}>
              {tr('op.hours.bookingsRetry')}
            </Button>
          </div>
        ) : rows.length === 0 ? null : (
          <>
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.hours.bookingsLead')}</p>
            <ul style={{ listStyle: 'none', paddingInline: 0, margin: 0, display: 'grid' }}>
              {rows.map((b) => {
                const can = closedDayActions(b);
                return (
                  <li
                    key={b.id}
                    data-testid={`hours.closedBooking.${b.id}`}
                    className="tp-row"
                    style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-1-5)', borderBlockEnd: '1px solid var(--tp-border)' }}
                  >
                    <span style={{ marginInlineEnd: 'auto', display: 'grid' }}>
                      <span style={{ fontWeight: 600 }}>{who(b)}</span>
                      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                        {court(b)} · <bdi>{when(b)}</bdi>
                        {b.remainingIqd !== null && b.remainingIqd > 0 && <> · {tr('op.hours.bookingsOwed', { amount: isolate(formatIQD(b.remainingIqd, locale)) })}</>}
                      </span>
                    </span>
                    <Button size="sm" kind="ghost" disabled={busy} data-testid={`hours.closedBooking.cancel.${b.id}`} onClick={() => setPending({ kind: 'cancel', booking: b })}>
                      {tr('op.hours.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      kind="ghost"
                      disabled={busy || !can.noShow}
                      disabledReason={!can.noShow ? tr('op.hours.noShowNotYet') : undefined}
                      data-testid={`hours.closedBooking.noShow.${b.id}`}
                      onClick={() => setPending({ kind: 'noShow', booking: b })}
                    >
                      {tr('op.hours.noShow')}
                    </Button>
                    {can.pay && (
                      <Button size="sm" kind="primary" disabled={busy} data-testid={`hours.closedBooking.pay.${b.id}`} onClick={() => setPaying(b)}>
                        {tr('op.hours.pay')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {queued && <MessagePresenter tone="info" message={tr('op.hours.queued')} />}
        <ErrorText error={error} style={{ marginBlock: 0 }} />
      </div>
      <ConfirmDialog
        open={pending !== null}
        kind="danger"
        title={tr(pending?.kind === 'noShow' ? 'op.hours.noShowTitle' : 'op.hours.cancelTitle')}
        body={
          pending ? (
            <p style={{ marginBlockStart: 0 }}>
              {tr(pending.kind === 'noShow' ? 'op.hours.noShowBody' : 'op.hours.cancelBody', {
                who: who(pending.booking),
                court: court(pending.booking),
                when: when(pending.booking),
              })}
            </p>
          ) : undefined
        }
        confirmLabel={tr(pending?.kind === 'noShow' ? 'op.hours.noShow' : 'op.hours.cancel')}
        cancelLabel={tr('op.hours.cancelKeep')}
        busy={busy}
        onConfirm={() => pending && void run(pending)}
        onCancel={() => setPending(null)}
      />
      {paying && (
        <Modal
          title={tr('op.hours.payTitle')}
          subtitle={`${who(paying)} · ${court(paying)}`}
          onClose={() => {
            setPaying(null);
            refresh();
          }}
        >
          <CourtBillPanel reservationId={paying.id} tz={tz} />
        </Modal>
      )}
    </Panel>
  );
}
