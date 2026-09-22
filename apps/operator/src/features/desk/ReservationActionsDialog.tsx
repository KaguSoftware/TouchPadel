/**
 * Quick actions from the calendar: arrived / completed / no-show, shorten,
 * extend, move, cancel. The full screen with every action and the customer
 * lives at /desk/bookings/$id ("Open booking"); this dialog stays for speed.
 * Payment is taken on that screen (0106), so "Take payment" goes there.
 *
 * Two groups, because they are two different kinds of act:
 *
 *  - **What happened** — the guest arrived, the game finished. That is the
 *    normal course of a booking, it is the click the desk makes most, and it is
 *    the first and filled button. It used to sit in one row of seven equal
 *    buttons, under a "Reason for this change" box that also applied to it: an
 *    arrival audited as "Customer request".
 *  - **Change or end it** — shorten, extend, move, no-show, cancel. Each of
 *    these overrides the booking and carries the reason chosen above them
 *    (SOW L313).
 *
 * e2e selectors kept: dialog named by guest name, label 'Reason for this
 * change', button 'Shorten −30 min', button 'Cancel booking' (click → the
 * cancel panel with label 'Reason' → click again to confirm).
 */
import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { formatIQD, formatTime, formatTimeRange } from '@touch/i18n';
import { mutate } from '../../lib/mutate';
import type { CourtRow } from '../../lib/queries';
import { useToast } from '../../components/toast';
import { useLocale, pickName } from '../../lib/i18n';
import { permissionsFor, useAuth } from '../../lib/auth';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { ReservationBadge } from './deskStatus';
import { allowedMarks, guestNameOf, isLive } from './deskLogic';
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
  const { staff } = useAuth();
  const canPay = permissionsFor(staff?.role).takeCourtPayment && r.kind === 'booking' && ['confirmed', 'arrived', 'completed'].includes(r.status);
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
    // Arrived and completed are the normal course of a booking, not an
    // override: they carry no reason (the server records its own default).
    // A no-show ends the booking and frees the court, so it carries one.
    const why = status === 'no_show' ? { reason } : {};
    void mutate('reservation.update', { action: 'mark', reservationId: r.id, status, ...why }).catch((e: unknown) => {
      toast.err(e);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    });
  }

  const durationMs = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
  const live = isLive(r.status);
  const marks = allowedMarks(r.status, r.start_at);
  const court = courts.find((c) => c.id === r.court_id);
  // The floor is the court's own shortest bookable duration: shorter than that
  // and no rate rule prices the slot, so the server refuses. Do not offer it.
  const minDurationMin = court?.duration_options?.length ? Math.min(...court.duration_options) : STEP_MIN;
  const title = r.kind === 'maintenance' ? tr('op.desk.maintenance') : r.kind === 'hold' ? tr('op.desk.hold') : (guestNameOf(r) ?? tr('op.desk.walkIn'));

  // The pair shares a border, so the floor hint sits under it and is tied to
  // the minus button by id rather than through Button's own disabledReason.
  const shortenBelowFloor = durationMs - STEP_MIN * 60_000 < minDurationMin * 60_000;
  const shortenFloorId = useId();

  const canComplete = marks.includes('completed');
  const canArrive = marks.includes('arrived');

  return (
    <Modal
      title={title}
      titleAfter={<ReservationBadge reservation={r} size="sm" />}
      subtitle={
        <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <bdi>{court ? pickName(locale, court) : ''}</bdi>
          <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
          {r.guest_phone && <bdi dir="ltr">{r.guest_phone}</bdi>}
          {r.price_iqd != null && <bdi dir="ltr">{formatIQD(r.price_iqd, locale)}</bdi>}
        </span>
      }
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.close')}
          </Button>
          {canPay && (
            <Button
              icon="banknote"
              disabled={busy}
              onClick={() => {
                onClose();
                void navigate({ to: '/desk/bookings/$id', params: { id: r.id } });
              }}
            >
              {tr('ws.courtDesk.board.takePayment')}
            </Button>
          )}
          <Button
            kind="soft"
            iconEnd="chevronEnd"
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
      {r.notes && <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: '0.6rem', whiteSpace: 'pre-wrap' }}>{r.notes}</p>}
      <ErrorText error={error} />

      {live && !showMove && !showCancel && (canArrive || canComplete) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBlockEnd: '1rem' }}>
          {canArrive && (
            <Button kind="primary" size="lg" icon="check" busy={busy} onClick={() => runMark('arrived')}>
              {tr('ws.courtDesk.detail.arrived')}
            </Button>
          )}
          {canComplete && (
            <Button size="lg" icon="checkCircle" busy={busy} onClick={() => runMark('completed')}>
              {tr('ws.courtDesk.detail.completed')}
            </Button>
          )}
        </div>
      )}

      {live && !showMove && !showCancel && (
        <section style={{ borderBlockStart: canArrive || canComplete ? '1px solid var(--tp-border)' : undefined, paddingBlockStart: canArrive || canComplete ? '0.85rem' : 0 }}>
          <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, marginBlockEnd: '0.5rem' }}>{tr('ws.courtDesk.calendar.changeTitle')}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-start' }}>
            {/* Shorten and extend are one control — the same dial, both ways —
                so they share a border and sit flush, seam in the middle. The
                floor hint lives under the pair rather than on the minus
                button: Button renders its own reason in a grid wrapper, which
                would break the shared border and wrap "Extend" to the next
                row. */}
            <span style={{ display: 'grid', justifyItems: 'start', rowGap: 'var(--tp-sp-1)' }}>
              <span
                style={{
                  display: 'inline-flex',
                  border: '1px solid var(--tp-border)',
                  borderRadius: 'var(--tp-radius-ctl)',
                  overflow: 'hidden',
                }}
              >
                <Button
                  icon="minus"
                  busy={busy}
                  disabled={shortenBelowFloor}
                  aria-describedby={shortenBelowFloor ? shortenFloorId : undefined}
                  style={{ border: 'none', borderRadius: 0 }}
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
                <span aria-hidden style={{ inlineSize: '1px', background: 'var(--tp-border)' }} />
                <Button
                  icon="plus"
                  busy={busy}
                  style={{ border: 'none', borderRadius: 0 }}
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
              </span>
              {/* Rulebook 4.3: the floor is the court's own shortest priced
                  length, which is not guessable from a greyed button. */}
              {shortenBelowFloor && (
                <span
                  id={shortenFloorId}
                  style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', lineHeight: 1.3, textAlign: 'start' }}
                >
                  {tr('ws.courtDesk.detail.shortenFloor', { minutes: tr('ws.courtDesk.common.minutes', { minutes: String(minDurationMin) }) })}
                </span>
              )}
            </span>
            <Button icon="repeat" busy={busy} onClick={() => setShowMove(true)}>
              {tr('op.desk.move')}
            </Button>
            {marks.includes('no_show') && (
              <Button icon="eyeOff" busy={busy} onClick={() => runMark('no_show')}>
                {tr('ws.courtDesk.detail.noShow')}
              </Button>
            )}
            <Button kind="danger" icon="ban" busy={busy} onClick={() => setShowCancel(true)}>
              {tr('op.desk.cancelBooking')}
            </Button>
          </div>
          <Field label={tr('op.desk.overrideReason')} style={{ marginBlockStart: '0.85rem' }}>
            <select style={inputStyle} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}>
              {OVERRIDE_REASONS.map((code) => (
                <option key={code} value={code}>
                  {tr(`op.reasons.${code}`)}
                </option>
              ))}
            </select>
          </Field>
        </section>
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
              <option value="">{tr('ws.courtDesk.calendar.sameTime', { time: formatTime(new Date(r.start_at), locale, tz) })}</option>
              {rows.map((min) => {
                const at = wallTimeToUtc(date, min, tz);
                // A start MOVED into the past strands the booking: the desk
                // goes on calling it confirmed while the guest's app drops it
                // out of Upcoming and shows it nowhere (Parsa, 2026-09-23).
                // Standing still is fine — that is a court change on a game
                // already running.
                const past = at.getTime() < Date.now() && at.getTime() !== new Date(r.start_at).getTime();
                const label = formatTime(at, locale, tz);
                return (
                  <option key={min} value={min} disabled={past}>
                    {past ? tr('ws.courtDesk.calendar.startPast', { time: label }) : label}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field label={tr('op.desk.overrideReason')}>
            <select style={inputStyle} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}>
              {OVERRIDE_REASONS.map((code) => (
                <option key={code} value={code}>
                  {tr(`op.reasons.${code}`)}
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
