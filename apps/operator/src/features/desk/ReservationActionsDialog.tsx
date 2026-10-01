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
 * An open match's booking (docs/design/open-matches/operator.md §5.8, §5.14)
 * is marked player by player, never as a whole: it offers **Players** (the
 * booking screen, where the Players panel is) in place of Mark arrived, no
 * No-show at all (the server refuses one, MATCH_MARK_SEATS), and says what a
 * move, extend or cancel does to the match. It is named by its organiser
 * (bookingLabel) with the seat chip beside the status.
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
import { permissionsFor, useAuth } from '../../lib/auth';
import { Button, ErrorText, Field, Modal, Select } from '../../components/ui';
import { ReservationBadge } from './deskStatus';
import { allowedMarks, canMoveReservation, isLive } from './deskLogic';
import type { ReservationRow } from './deskTypes';
import { bookingLabel, isMatchLiteral } from '../matches/matchLogic';
import type { MatchState } from '../matches/matchPayloads';
import { SeatChip } from '../matches/SeatChip';
import { LessonBadge } from '../coaching/LessonBadge';
import { LessonPlacesChip } from '../coaching/LessonPlacesChip';
import { LessonSummary } from '../coaching/LessonSummary';
import { lessonLabel } from '../coaching/lessonLogic';
import type { DeskLesson } from '../coaching/lessonPayloads';

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
  match = null,
  lesson = null,
  lessonNowMs,
  onClose,
  onChanged,
}: {
  reservation: ReservationRow;
  /** app.desk_match_states for this booking, when it is an open match's (the calendar's read). */
  match?: MatchState | null;
  /**
   * The desk_lessons row this reservation holds (the calendar's read): a
   * lesson's court row, or a held lesson's hold row (coaching operator.md
   * §5.8). Either opens the lesson branch, which offers only Open lesson.
   */
  lesson?: DeskLesson | null;
  /** The lessons payload's clock (lessonLogic.nowOf); the station's when absent. */
  lessonNowMs?: number;
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

  /*
   * A lesson (coaching operator.md §5.8): its summary and Open lesson, nothing
   * else. Arrived, Completed, No-show, Move, Extend, Shorten, Confirm and
   * Cancel would each be refused LESSON_VIA_COACHING (R7, R35): a lesson
   * changes on its own screen. Without its desk_lessons row (offline, an older
   * server) the booking route forwards to it.
   */
  if (r.kind === 'lesson' || (r.kind === 'hold' && lesson)) {
    const court = courts.find((c) => c.id === r.court_id);
    const openLesson = () => {
      onClose();
      if (lesson) void navigate({ to: '/desk/lessons/$id', params: { id: lesson.lesson_id } });
      else void navigate({ to: '/desk/bookings/$id', params: { id: r.id } });
    };
    return (
      <Modal
        title={lessonLabel(lesson, locale, tr)}
        titleAfter={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: 'var(--tp-lesson)' }}>
            <LessonBadge kind={lesson?.kind ?? null} held={r.kind === 'hold' || lesson?.status === 'held'} />
            {lesson && <LessonPlacesChip lesson={lesson} />}
          </span>
        }
        subtitle={
          <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <bdi>{court ? pickName(locale, court) : ''}</bdi>
            <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
          </span>
        }
        onClose={onClose}
        footer={(close) => (
          <>
            <Button onClick={close}>{tr('common.close')}</Button>
            <Button kind="primary" iconEnd="chevronEnd" onClick={openLesson}>
              {tr('ws.coaching.common.openLesson')}
            </Button>
          </>
        )}
      >
        <LessonSummary lesson={lesson} held={r.kind === 'hold'} nowMs={lessonNowMs ?? Date.now()} tz={tz} />
      </Modal>
    );
  }

  async function run(action: () => Promise<{ queued: boolean }>) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await action();
      // The dialog closes either way; a queued change says it is not applied yet.
      if (outcome.queued) toast.info(tr('ws.courtDesk.detail.queued'));
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
    // No mark carries a reason. The server asks for none -- mark_reservation's
    // p_reason is defaulted and coalesced, so a no-show records 'no_show' --
    // and this dialog's reason Select is pre-filled with OVERRIDE_REASONS[0],
    // so attaching it stamped every no-show taken from the calendar as
    // "Customer request". A wrong reason in the audit is worse than none
    // (owner, 2026-09-23). The Select stays: move, shorten and extend use it.
    void mutate('reservation.update', { action: 'mark', reservationId: r.id, status }).catch((e: unknown) => {
      toast.err(e);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    });
  }

  const durationMs = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
  const live = isLive(r.status);
  // Same rule the calendar's drag gate uses: a checked-in guest whose slot has
  // started is playing, and re-timing that is not on offer. Read at render like
  // `allowedMarks` below — the dialog is opened per action, not left standing.
  const nowMs = Date.now();
  const movable = canMoveReservation(r, nowMs);
  // The seat chip reads a late leaver as missing once the booking has started (R39).
  const started = Date.parse(r.start_at) <= nowMs;
  const marks = allowedMarks(r.status, r.start_at);
  const court = courts.find((c) => c.id === r.court_id);
  // The floor is the court's own shortest bookable duration: shorter than that
  // and no rate rule prices the slot, so the server refuses. Do not offer it.
  const minDurationMin = court?.duration_options?.length ? Math.min(...court.duration_options) : STEP_MIN;
  const title = r.kind === 'maintenance' ? tr('op.desk.maintenance') : r.kind === 'hold' ? tr('op.desk.hold') : (bookingLabel(r, match, tr) ?? tr('op.desk.walkIn'));
  // Known from the state, or detected from the row itself when the state has not come.
  const isMatch = r.kind === 'booking' && (match != null || isMatchLiteral(r));
  const openBooking = () => {
    // Leaves the screen entirely: no exit to play, and deferring the close
    // would hold a dead dialog over the new route.
    onClose();
    void navigate({ to: '/desk/bookings/$id', params: { id: r.id } });
  };

  const shortenBelowFloor = durationMs - STEP_MIN * 60_000 < minDurationMin * 60_000;

  const canComplete = marks.includes('completed');
  const canArrive = marks.includes('arrived');

  return (
    <Modal
      title={title}
      titleAfter={
        match ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
            <ReservationBadge reservation={r} size="sm" />
            <SeatChip state={match} started={started} />
          </span>
        ) : (
          <ReservationBadge reservation={r} size="sm" />
        )
      }
      subtitle={
        <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <bdi>{court ? pickName(locale, court) : ''}</bdi>
          <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
          {r.guest_phone && <bdi dir="ltr">{r.guest_phone}</bdi>}
          {r.price_iqd != null && <bdi dir="ltr">{formatIQD(r.price_iqd, locale)}</bdi>}
        </span>
      }
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.close')}
          </Button>
          {canPay && (
            <Button icon="banknote" disabled={busy} onClick={openBooking}>
              {tr('ws.courtDesk.board.takePayment')}
            </Button>
          )}
          <Button
            kind="soft"
            iconEnd="chevronEnd"
            disabled={busy}
            onClick={openBooking}
          >
            {tr('ws.courtDesk.calendar.openDetail')}
          </Button>
        </>
      )}
    >
      {r.notes && <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: '0.6rem', whiteSpace: 'pre-wrap' }}>{r.notes}</p>}
      <ErrorText error={error} />

      {live && !showMove && !showCancel && (canArrive || canComplete || isMatch) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBlockEnd: '1rem' }}>
          {/* A match's players are marked one by one, on the booking's Players panel. */}
          {isMatch && (
            <Button kind="primary" size="lg" icon="users" disabled={busy} onClick={openBooking}>
              {tr('ws.matches.booking.players')}
            </Button>
          )}
          {canArrive && !isMatch && (
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
        <section style={{ borderBlockStart: canArrive || canComplete || isMatch ? '1px solid var(--tp-border)' : undefined, paddingBlockStart: canArrive || canComplete || isMatch ? '0.85rem' : 0 }}>
          <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, marginBlockEnd: '0.5rem' }}>{tr('ws.courtDesk.calendar.changeTitle')}</h3>
          {isMatch && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.5rem' }}>{tr('ws.matches.booking.sharesLine')}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-start' }}>
            {/* Shorten and extend are one control — the same dial, both ways —
                so they share a border and sit flush, seam in the middle. */}
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
                  title={shortenBelowFloor ? tr('ws.courtDesk.detail.shortenFloor', { minutes: tr('ws.courtDesk.common.minutes', { minutes: String(minDurationMin) }) }) : undefined}
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
            </span>
            {movable && (
              <Button icon="repeat" busy={busy} onClick={() => setShowMove(true)}>
                {tr('op.desk.move')}
              </Button>
            )}
            {marks.includes('no_show') && !isMatch && (
              <Button icon="eyeOff" busy={busy} onClick={() => runMark('no_show')}>
                {tr('ws.courtDesk.detail.noShow')}
              </Button>
            )}
            <Button kind="danger" icon="ban" busy={busy} onClick={() => setShowCancel(true)}>
              {tr('op.desk.cancelBooking')}
            </Button>
          </div>
          <Field label={tr('op.desk.overrideReason')} style={{ marginBlockStart: '0.85rem' }}>
            <Select
              value={reason}
              disabled={busy}
              onChange={setReason}
              options={OVERRIDE_REASONS.map((code) => ({ value: code, label: tr(`op.reasons.${code}`) }))}
            />
          </Field>
        </section>
      )}
      {!live && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.detail.notLive', { status: tr(`ws.kit.bookingStatus.${r.status as 'completed'}`) })}</p>}

      {showMove && (
        <div style={{ marginBlockStart: '0.6rem' }}>
          <h3 style={{ marginBlock: '0.4rem', fontSize: 'var(--tp-fs-md)' }}>{tr('op.desk.moveTitle')}</h3>
          {isMatch && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.5rem' }}>{tr('ws.matches.booking.sharesLine')}</p>}
          <Field label={tr('op.desk.newCourt')}>
            <Select
              value={moveCourt}
              disabled={busy}
              onChange={setMoveCourt}
              options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))}
            />
          </Field>
          <Field label={tr('op.desk.newStart')}>
            <Select
              value={moveStartMin === '' ? '' : String(moveStartMin)}
              disabled={busy}
              onChange={(v) => setMoveStartMin(v === '' ? '' : Number(v))}
              options={[
                { value: '', label: tr('ws.courtDesk.calendar.sameTime', { time: formatTime(new Date(r.start_at), locale, tz) }) },
                ...rows.map((min) => {
                  const at = wallTimeToUtc(date, min, tz);
                  // A start MOVED into the past strands the booking: the desk
                  // goes on calling it confirmed while the guest's app drops it
                  // out of Upcoming and shows it nowhere (Parsa, 2026-09-23).
                  // Standing still is fine — that is a court change on a game
                  // already running.
                  const past = at.getTime() < Date.now() && at.getTime() !== new Date(r.start_at).getTime();
                  const label = formatTime(at, locale, tz);
                  return {
                    value: String(min),
                    label: past ? tr('ws.courtDesk.calendar.startPast', { time: label }) : label,
                    disabled: past,
                  };
                }),
              ]}
            />
          </Field>
          <Field label={tr('op.desk.overrideReason')}>
            <Select
              value={reason}
              disabled={busy}
              onChange={setReason}
              options={OVERRIDE_REASONS.map((code) => ({ value: code, label: tr(`op.reasons.${code}`) }))}
            />
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
          {isMatch && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-warn-fg)', fontWeight: 600, marginBlockEnd: '0.5rem' }}>{tr('ws.matches.booking.cancelLine')}</p>}
          <Field label={tr('op.common.reason')}>
            <Select
              value={cancelReason}
              disabled={busy}
              onChange={setCancelReason}
              options={CANCEL_REASONS.map((code) => ({ value: code, label: tr(`op.reasons.${code}`) }))}
            />
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
