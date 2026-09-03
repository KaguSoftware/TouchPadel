/**
 * Quick actions from the calendar: arrived / completed / no-show, shorten,
 * extend, move, cancel — each carrying the desk's chosen reason (SOW L313).
 * The full screen with every action and the customer lives at
 * /desk/bookings/$id ("Open booking"); this dialog stays for speed.
 *
 * e2e selectors kept: dialog named by guest name, label 'Reason for this
 * change', button 'Shorten −30 min', button 'Cancel booking' (click → the
 * cancel panel with label 'Reason' → click again to confirm).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { formatIQD, formatTime, formatTimeRange } from '@touch/i18n';
import { mutate } from '../../lib/mutate';
import type { CourtRow } from '../../lib/queries';
import { useToast } from '../../components/toast';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { BookingStatusIndicator, StatusBadge } from '../../components/kit';
import { allowedMarks, isLive } from './deskLogic';
import type { ReservationRow } from './deskTypes';

const CANCEL_REASONS = ['customer_request', 'weather', 'staff_error', 'duplicate', 'other'] as const;
export const OVERRIDE_REASONS = ['customer_request', 'staff_error', 'weather', 'duplicate', 'other'] as const;

/** Shorten and extend move in half-hour steps, matching the grid. */
export const STEP_MIN = 30;

export function ReservationActionsDialog({
  reservation: r,
  courts,
  date,
  tz,
  rows,
  onClose,
  onChanged,
}: {
  reservation: ReservationRow;
  courts: readonly CourtRow[];
  date: string;
  tz: string;
  rows: readonly number[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [showMove, setShowMove] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [moveCourt, setMoveCourt] = useState(r.court_id);
  const [moveStartMin, setMoveStartMin] = useState<number | ''>('');
  const [cancelReason, setCancelReason] = useState<string>(CANCEL_REASONS[0]);
  const [reason, setReason] = useState<string>(OVERRIDE_REASONS[0]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Optimistic status mark: the row flips and the dialog closes immediately —
   * single-row transition, idempotent server-side, and the courts broadcast
   * reconciles anyway. A refusal rolls back via invalidation and lands as a
   * toast, since the dialog is gone.
   */
  function runMark(status: 'arrived' | 'completed' | 'no_show') {
    queryClient.setQueryData(['reservations', date], (list?: ReservationRow[]) =>
      list?.map((row) => (row.id === r.id ? { ...row, status } : row)),
    );
    onChanged();
    void mutate('reservation.update', { action: 'mark', reservationId: r.id, status, reason }).catch((e: unknown) => {
      toast.err(e);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    });
  }

  const durationMs = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
  const live = isLive(r.status);
  const marks = allowedMarks(r.status);
  const court = courts.find((c) => c.id === r.court_id);
  // The floor is the court's own shortest bookable duration: shorter than that
  // and no rate rule prices the slot, so the server refuses. Do not offer it.
  const minDurationMin = court?.duration_options?.length ? Math.min(...court.duration_options) : STEP_MIN;
  const title = r.kind === 'maintenance' ? tr('op.desk.maintenance') : r.kind === 'hold' ? tr('op.desk.hold') : (r.guest_name ?? tr('op.desk.walkIn'));

  return (
    <Modal
      title={title}
      subtitle={
        <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <bdi>{court ? pickName(locale, court) : ''}</bdi>
          <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
          {r.guest_phone && <bdi dir="ltr">{r.guest_phone}</bdi>}
          {r.price_iqd != null && <bdi dir="ltr">{formatIQD(r.price_iqd, locale)}</bdi>}
          {r.kind === 'booking' ? <BookingStatusIndicator status={r.status} size="sm" /> : <StatusBadge size="sm" label={tr(`ws.kit.reservationKind.${r.kind}`)} />}
        </span>
      }
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.close')}
          </Button>
          <Button
            kind="soft"
            icon="arrowUpRight"
            disabled={busy}
            onClick={() => {
              onClose();
              void navigate({ to: '/desk/bookings/$id', params: { id: r.id } });
            }}
          >
            {tr('ws.courtDesk.calendar.openDetail')}
          </Button>
        </>
      }
    >
      {r.notes && <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: '0.6rem' }}>{r.notes}</p>}
      <ErrorText error={error} />
      {live && !showMove && !showCancel && (
        <Field label={tr('op.desk.overrideReason')}>
          <select style={inputStyle} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}>
            {OVERRIDE_REASONS.map((code) => (
              <option key={code} value={code}>
                {tr(`op.reasons.${code}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {live && !showMove && !showCancel && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {marks.includes('arrived') && (
            <Button icon="check" busy={busy} onClick={() => runMark('arrived')}>
              {tr('op.desk.arrived')}
            </Button>
          )}
          {marks.includes('completed') && (
            <Button busy={busy} onClick={() => runMark('completed')}>
              {tr('op.desk.completed')}
            </Button>
          )}
          {marks.includes('no_show') && (
            <Button busy={busy} onClick={() => runMark('no_show')}>
              {tr('op.desk.noShow')}
            </Button>
          )}
          <Button
            busy={busy}
            disabled={durationMs - STEP_MIN * 60_000 < minDurationMin * 60_000}
            onClick={() =>
              void run(() =>
                mutate('reservation.update', {
                  action: 'extend',
                  reservationId: r.id,
                  newEndAt: new Date(new Date(r.end_at).getTime() - STEP_MIN * 60_000).toISOString(),
                  reason,
                }),
              )
            }
          >
            {tr('op.desk.shorten30')}
          </Button>
          <Button
            busy={busy}
            onClick={() =>
              void run(() =>
                mutate('reservation.update', {
                  action: 'extend',
                  reservationId: r.id,
                  newEndAt: new Date(new Date(r.end_at).getTime() + STEP_MIN * 60_000).toISOString(),
                  reason,
                }),
              )
            }
          >
            {tr('op.desk.extend30')}
          </Button>
          <Button busy={busy} onClick={() => setShowMove(true)}>
            {tr('op.desk.move')}
          </Button>
          <Button kind="danger" busy={busy} onClick={() => setShowCancel(true)}>
            {tr('op.desk.cancelBooking')}
          </Button>
        </div>
      )}
      {!live && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.detail.notLive', { status: tr(`ws.kit.bookingStatus.${r.status as 'completed'}`) })}</p>}

      {showMove && (
        <div style={{ marginBlockStart: '0.6rem' }}>
          <h3 style={{ marginBlock: '0.4rem', fontSize: 'var(--tp-fs-md)' }}>{tr('op.desk.moveTitle')}</h3>
          <Field label={tr('op.desk.newCourt')}>
            <select style={inputStyle} value={moveCourt} disabled={busy} onChange={(e) => setMoveCourt(e.target.value)}>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {pickName(locale, c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('op.desk.newStart')}>
            <select style={inputStyle} value={moveStartMin} disabled={busy} onChange={(e) => setMoveStartMin(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">—</option>
              {rows.map((min) => (
                <option key={min} value={min}>
                  {formatTime(wallTimeToUtc(date, min, tz), locale, tz)}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={() => setShowMove(false)} disabled={busy}>
              {tr('common.back')}
            </Button>
            <Button
              kind="primary"
              busy={busy}
              onClick={() => {
                const start = moveStartMin === '' ? new Date(r.start_at) : wallTimeToUtc(date, moveStartMin, tz);
                void run(() =>
                  mutate('reservation.update', {
                    action: 'move',
                    reservationId: r.id,
                    courtId: moveCourt,
                    startAt: start.toISOString(),
                    endAt: new Date(start.getTime() + durationMs).toISOString(),
                    reason,
                  }),
                );
              }}
            >
              {tr('op.desk.move')}
            </Button>
          </div>
        </div>
      )}

      {showCancel && (
        <div style={{ marginBlockStart: '0.6rem' }}>
          <Field label={tr('op.common.reason')}>
            <select style={inputStyle} value={cancelReason} disabled={busy} onChange={(e) => setCancelReason(e.target.value)}>
              {CANCEL_REASONS.map((code) => (
                <option key={code} value={code}>
                  {tr(`op.reasons.${code}`)}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={() => setShowCancel(false)} disabled={busy}>
              {tr('common.back')}
            </Button>
            <Button kind="danger" busy={busy} onClick={() => void run(() => mutate('reservation.update', { action: 'cancel', reservationId: r.id, reason: cancelReason }))}>
              {tr('op.desk.cancelBooking')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
