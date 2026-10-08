/**
 * The roster of a lesson (docs/design/coaching/operator.md §5.10.4–§5.10.8),
 * on the lesson screen. It reads `useLessonDetail(lessonId)` itself, the key
 * the screen shares, so a write here refreshes both.
 *
 * One row per sign-up, the live ones (booked, held) first, then the cancelled
 * and expired under "Earlier". A row shows the name as the server sends it
 * (the recorded one for a coach- or desk-booked student, C-21 / R44), the
 * party, the phone, flags, Open customer only when there is a customer behind
 * the row (never for an unconfirmed phone match), who booked it, a course
 * sign-up's sessions, the money line (every figure the server's), the
 * attendance chip and its buttons, each from the row's `can`, the capability
 * and the station's reach (lessonLogic.enrolmentActionsOf).
 *
 * Writes, each a direct appRpc (CD-6, online only):
 *   - attendance (app.desk_mark_attendance): Arrived, No-show, Undo; one click,
 *     optimistic on QK.coaching.lesson(id), rolled back on any refusal;
 *   - Take payment (app.lesson_settle through TakeLessonPayment): the till's
 *     PaymentPane at `money.take_iqd`, no part payment;
 *   - Cancel a sign-up (app.desk_cancel_enrolment) behind the reason prompt,
 *     with what happens to the money said first;
 *   - Add student (AddStudentDialog) from the footer.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatIQD, formatNumber, isolate, isolateLtr, VENUE_TZ } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, COACHING_REASON_CODES, ErrorText, Skeleton } from '../../components/ui';
import {
  CustomerFlagBadge,
  MessagePresenter,
  Panel,
  ReasonCodePrompt,
  StatusBadge,
  ViewMore,
  useListCap,
  type Tone,
} from '../../components/kit';
import type { PaymentMethod } from '../till/PaymentPane';
import { AddStudentDialog } from './AddStudentDialog';
import { LessonReadNotice } from './LessonReadNotice';
import {
  bookedByKey,
  coachingErrorText,
  enrolmentActionsOf,
  enrolmentLine,
  enrolmentStatusKey,
  isWalkIn,
  moneyLineText,
  nowOf,
  reasonForm,
  rosterGroups,
  rosterName,
  rosterOwing,
  type MoneyLine,
  type RowAction,
} from './lessonLogic';
import { readCancelledEnrolment, type Enrolment, type LessonDetail } from './lessonPayloads';
import {
  courseSignUpRange,
  enrolmentCancelLines,
  optimisticAttendance,
  partyExtra,
  placesOf,
  type AttendanceMark,
} from './lessonScreenLogic';
import { TakeLessonPayment, type LessonPayTarget } from './TakeLessonPayment';
import {
  invalidateLessonAttendance,
  invalidateLessonBooking,
  useCoachingCaps,
  useLessonDetail,
  useLessonRead,
} from './useCoaching';

export interface LessonRosterPanelProps {
  lessonId: string;
  /** `?pay=<enrolment>`: open Take payment on that sign-up once the detail has loaded. */
  openPayFor?: string;
  /** Called once `openPayFor` has been acted on (the screen clears the search). */
  onPayOpened?: () => void;
}

const MONEY_TONE: Record<MoneyLine['tone'], Tone> = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warn: 'warn',
};

export function LessonRosterPanel({ lessonId, openPayFor, onPayOpened }: LessonRosterPanelProps) {
  const { tr } = useLocale();
  const q = useLessonDetail(lessonId);
  const status = useLessonRead(q);
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const title = tr('ws.coaching.roster.title');

  // RPC_MISSING: a server without coaching. Nothing to show, not "offline".
  if (status.kind === 'absent') return null;
  if (status.kind === 'loading') {
    return (
      <Panel title={title} data-testid="lesson-roster">
        <Skeleton lines={4} />
      </Panel>
    );
  }
  if (status.kind === 'failed') {
    const notFound =
      status.error instanceof AppRpcError && status.error.code === 'LESSON_NOT_FOUND';
    return (
      <Panel title={title} data-testid="lesson-roster">
        {notFound ? (
          <MessagePresenter tone="refused" message={tr('ws.coaching.lesson.notFound')} />
        ) : (
          <LessonReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} />
        )}
      </Panel>
    );
  }
  return (
    <RosterView
      detail={status.data}
      // How long ago the payload's clock was read: "started" moves on between polls.
      elapsedMs={Math.max(0, Date.now() - status.updatedAt)}
      refetch={async () => (await q.refetch()).data ?? null}
      openPayFor={openPayFor}
      onPayOpened={onPayOpened}
    />
  );
}

interface PayState {
  target: LessonPayTarget;
  method: PaymentMethod;
}

function RosterView({
  detail,
  elapsedMs,
  refetch,
  openPayFor,
  onPayOpened,
}: {
  detail: LessonDetail;
  elapsedMs: number;
  refetch: () => Promise<LessonDetail | null>;
  openPayFor?: string;
  onPayOpened?: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const caps = useCoachingCaps();
  const { reachable } = useStationReach();

  const [rowErrors, setRowErrors] = useState<Record<string, unknown>>({});
  const [marking, setMarking] = useState<ReadonlySet<string>>(new Set());
  const [pay, setPay] = useState<PayState | null>(null);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Enrolment | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);

  const l = detail.lesson;
  const key = QK.coaching.lesson(l.id);
  const money = (n: number | null | undefined) =>
    n === null || n === undefined ? '—' : formatIQD(n, locale);
  const offline = tr('ws.coaching.offline.needsConnection');
  const words = (e: unknown) => coachingErrorText(e, tr, {}, { scope: 'lesson' });
  const actionsOf = (e: Enrolment) =>
    enrolmentActionsOf(
      e,
      l,
      reachable,
      { runLessons: caps.runLessons, takeLessonPayment: caps.takeLessonPayment },
      elapsedMs,
    );
  const reasonOf = (a: RowAction) =>
    a.reason === 'offline'
      ? offline
      : a.reason === 'notStarted'
        ? tr('ws.coaching.errors.attendance.not_started')
        : a.reason === 'marksClosed'
          ? tr('ws.coaching.errors.attendance.marks_closed')
          : undefined;

  // -------------------------------------------------------------------------
  // Take payment (§5.10.5)
  // -------------------------------------------------------------------------

  function openPay(e: Enrolment, method: PaymentMethod) {
    const due = e.money.take_iqd ?? 0;
    if (due <= 0) return;
    setPanelNotice(null);
    setPay({
      target: {
        enrolmentId: e.enrolment_id,
        name: rosterName(e, tr),
        course: e.scope === 'course',
        dueIqd: due,
      },
      method,
    });
  }

  // `?pay=<enrolment>`: once, when the detail is here.
  const payHandled = useRef(false);
  useEffect(() => {
    if (!openPayFor || payHandled.current) return;
    payHandled.current = true;
    const e = detail.enrolments.find((x) => x.enrolment_id === openPayFor);
    if (e && actionsOf(e).takePayment?.enabled) openPay(e, 'cash');
    onPayOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPayFor, detail]);

  async function refetchDue(enrolmentId: string): Promise<number | null> {
    const fresh = await refetch();
    const e = fresh?.enrolments.find((x) => x.enrolment_id === enrolmentId);
    return e && e.status === 'booked' ? e.money.take_iqd : null;
  }

  // -------------------------------------------------------------------------
  // Attendance (§5.10.6)
  // -------------------------------------------------------------------------

  async function mark(e: Enrolment, status: AttendanceMark) {
    const id = e.enrolment_id;
    setMarking((prev) => new Set([...prev, id]));
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await qc.cancelQueries({ queryKey: key });
    const before = qc.getQueryData<LessonDetail | null>(key);
    if (before) {
      qc.setQueryData(
        key,
        optimisticAttendance(
          before,
          id,
          status,
          new Date(nowOf(l.server_now, elapsedMs)).toISOString(),
        ),
      );
    }
    try {
      await appRpc('desk_mark_attendance', {
        p_lesson_id: l.id,
        p_enrolment_id: id,
        p_status: status,
      });
    } catch (err) {
      // A refusal never reverts silently: the row goes back and says why.
      if (before) qc.setQueryData(key, before);
      setRowErrors((prev) => ({ ...prev, [id]: err }));
    } finally {
      setMarking((prev) => new Set([...prev].filter((x) => x !== id)));
      invalidateLessonAttendance(qc, l.id);
    }
  }

  // -------------------------------------------------------------------------
  // Cancel a sign-up (§5.10.8)
  // -------------------------------------------------------------------------

  async function cancel(code: string, note: string) {
    if (!cancelling) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      const out = readCancelledEnrolment(
        await appRpc('desk_cancel_enrolment', {
          p_enrolment_id: cancelling.enrolment_id,
          p_reason: reasonForm(code, note),
        }),
      );
      invalidateLessonBooking(qc);
      toast.ok(
        (out.refund_due_iqd ?? 0) > 0
          ? tr('ws.coaching.cancel.signUpDoneRefund', { amount: money(out.refund_due_iqd) })
          : tr('ws.coaching.cancel.signUpDone'),
      );
      setCancelling(null);
    } catch (e) {
      setDialogError(e);
      // The sign-up changed under the desk (ENROLMENT_NOT_FOUND, a cancel elsewhere): show the server's roster.
      invalidateLessonBooking(qc);
    } finally {
      setDialogBusy(false);
    }
  }

  function closeCancel() {
    setCancelling(null);
    setDialogError(null);
  }

  // -------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------

  function row(e: Enrolment, isEarlier: boolean) {
    const a = actionsOf(e);
    const name = rosterName(e, tr);
    const extra = partyExtra(e);
    const booked = bookedByKey(e);
    const range = courseSignUpRange(e, l.course);
    const lines = enrolmentLine(e);
    const busy = marking.has(e.enrolment_id);
    const statusKey = enrolmentStatusKey(e.status);
    const att = e.attendance;
    const attWord =
      att && (att.status === 'attended' || att.status === 'no_show')
        ? tr(`ws.coaching.common.attendance.${att.status}`)
        : (att?.status ?? null);
    const markButton = (
      action: RowAction | null,
      label: 'arrived' | 'noShow' | 'undo',
      status: AttendanceMark,
      primary = false,
    ) =>
      action && (
        <Button
          size="sm"
          kind={primary ? 'primary' : 'default'}
          disabled={!action.enabled || busy}
          disabledReason={reasonOf(action)}
          onClick={() => void mark(e, status)}
        >
          {tr(`ws.coaching.attendance.${label}`)}
        </Button>
      );
    return (
      <li
        key={e.enrolment_id}
        data-testid={`enrolment-${e.enrolment_id}${isEarlier ? '-earlier' : ''}`}
        style={{
          display: 'grid',
          gap: 'var(--tp-sp-1-5)',
          paddingBlock: 'var(--tp-sp-3)',
          borderBlockStart: '1px solid var(--tp-border)',
        }}
      >
        <div
          style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <strong>
            <bdi>{name}</bdi>
            {extra !== null && <> {isolateLtr(`+${formatNumber(extra, locale)}`)}</>}
          </strong>
          {isWalkIn(e) && e.full_name?.trim() && (
            <StatusBadge
              size="sm"
              dot={false}
              tone="neutral"
              label={tr('ws.coaching.common.walkIn')}
            />
          )}
          {e.phone && (
            <bdi
              dir="ltr"
              style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}
            >
              {e.phone}
            </bdi>
          )}
          {e.flags.map((f, i) => (
            <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
          ))}
          {isEarlier && (
            <StatusBadge
              size="sm"
              dot={false}
              tone="neutral"
              label={statusKey ? tr(statusKey) : e.status}
            />
          )}
          {a.openCustomer && e.customer_id && (
            <Link
              to="/desk/customers/$id"
              params={{ id: e.customer_id }}
              style={{
                color: 'var(--tp-accent)',
                fontWeight: 600,
                fontSize: 'var(--tp-fs-sm)',
                textDecoration: 'none',
              }}
            >
              {tr('ws.coaching.roster.openCustomer')}
            </Link>
          )}
        </div>
        {e.friend_names.length > 0 && (
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('ws.coaching.roster.friends', {
              names: e.friend_names.map((n) => isolate(n)).join(locale === 'ar' ? '، ' : ', '),
            })}
          </span>
        )}
        <div
          style={{
            display: 'flex',
            gap: 'var(--tp-sp-3)',
            flexWrap: 'wrap',
            fontSize: 'var(--tp-fs-sm)',
            color: 'var(--tp-muted-fg)',
          }}
        >
          {booked && (
            <span>{tr(booked.key, booked.name ? { name: isolate(booked.name) } : undefined)}</span>
          )}
          {range && (
            <span>
              {tr('ws.coaching.common.courseSignUp', {
                from: formatNumber(range.from, locale),
                to: formatNumber(range.to, locale),
              })}
            </span>
          )}
          {range?.late && (
            <span>
              {tr('ws.coaching.common.joinedAt', { n: formatNumber(range.from, locale) })}
            </span>
          )}
        </div>
        {(lines.length > 0 || attWord) && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {attWord && (
              <StatusBadge
                size="sm"
                tone={att?.status === 'attended' ? 'success' : 'danger'}
                label={
                  att?.marked_by_name
                    ? tr('ws.coaching.common.attendance.markedBy', {
                        status: attWord,
                        name: isolate(att.marked_by_name),
                      })
                    : attWord
                }
              />
            )}
            {lines.map((m) => (
              <StatusBadge
                key={m.id}
                size="sm"
                dot={false}
                tone={MONEY_TONE[m.tone]}
                label={moneyLineText(m, tr, locale)}
              />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          {markButton(a.markAttended, 'arrived', 'attended', true)}
          {markButton(a.markNoShow, 'noShow', 'no_show')}
          {markButton(a.unmark, 'undo', 'clear')}
          {a.takePayment && (
            <>
              <Button
                size="sm"
                icon="banknote"
                disabled={!a.takePayment.enabled}
                disabledReason={reasonOf(a.takePayment)}
                onClick={() => openPay(e, 'cash')}
              >
                {tr('ws.coaching.common.take.button')}
              </Button>
              <Button
                size="sm"
                kind="ghost"
                icon="card"
                aria-label={tr('ws.coaching.roster.takeCard')}
                disabled={!a.takePayment.enabled}
                disabledReason={reasonOf(a.takePayment)}
                onClick={() => openPay(e, 'card')}
              >
                {tr('ws.coaching.common.take.card')}
              </Button>
            </>
          )}
          {a.cancel && (
            <Button
              size="sm"
              kind="ghost"
              icon="x"
              disabled={!a.cancel.enabled}
              disabledReason={reasonOf(a.cancel)}
              onClick={() => {
                setDialogError(null);
                setCancelling(e);
              }}
              style={{ color: 'var(--tp-danger-fg)' }}
            >
              {tr('ws.coaching.roster.cancelSignUp')}
            </Button>
          )}
        </div>
        <ErrorText
          error={rowErrors[e.enrolment_id] ?? null}
          message={rowErrors[e.enrolment_id] ? words(rowErrors[e.enrolment_id]) : null}
        />
      </li>
    );
  }

  // -------------------------------------------------------------------------
  // Footer
  // -------------------------------------------------------------------------

  const { live, earlier } = rosterGroups(detail.enrolments);
  // Only the earlier / cancelled sign-ups fold; the live roster is the class.
  const earlierCap = useListCap(earlier);
  const places = placesOf(l);
  const owing = rosterOwing(detail.enrolments);
  const canAdd = caps.runLessons && l.can.add_student;

  const footer: ReactNode[] = [];
  if (canAdd) {
    footer.push(
      <Button
        key="add"
        icon="userPlus"
        disabled={!reachable}
        disabledReason={reachable ? undefined : offline}
        onClick={() => setAdding(true)}
      >
        {tr('ws.coaching.roster.addStudent')}
      </Button>,
    );
  }
  if (places) {
    footer.push(
      <span key="places" style={{ fontSize: 'var(--tp-fs-sm)' }}>
        {tr('ws.coaching.common.places', {
          taken: formatNumber(places.taken, locale),
          total: formatNumber(places.total, locale),
        })}
      </span>,
    );
  }
  if (owing.count > 0) {
    footer.push(
      <span
        key="owing"
        style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-warn-fg)', fontWeight: 600 }}
      >
        {tr('ws.coaching.common.pay.toPayAmount', {
          count: formatNumber(owing.count, locale),
          amount: money(owing.amount),
        })}
      </span>,
    );
  }

  return (
    <Panel
      title={tr('ws.coaching.roster.title')}
      style={{ gridColumn: '1 / -1' }}
      data-testid="lesson-roster"
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {panelNotice && <MessagePresenter tone="refused" message={panelNotice} />}
        {live.length === 0 && earlier.length === 0 ? (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.coaching.roster.empty')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {live.map((e) => row(e, false))}
          </ul>
        )}
        {earlier.length > 0 && (
          <section>
            <h3
              style={{
                fontSize: 'var(--tp-fs-sm)',
                fontWeight: 700,
                marginBlockStart: 'var(--tp-sp-2)',
              }}
            >
              {tr('ws.coaching.roster.earlier')}
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {earlierCap.shown.map((e) => row(e, true))}
            </ul>
            <ViewMore
              hidden={earlierCap.hidden}
              open={earlierCap.open}
              onToggle={earlierCap.toggle}
            />
          </section>
        )}
        {footer.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-3)',
              alignItems: 'center',
              flexWrap: 'wrap',
              paddingBlockStart: 'var(--tp-sp-2)',
            }}
          >
            {footer}
          </div>
        )}
      </div>

      {pay && (
        <TakeLessonPayment
          target={pay.target}
          method={pay.method}
          onClose={() => setPay(null)}
          refetchDue={() => refetchDue(pay.target.enrolmentId)}
          onNotice={setPanelNotice}
        />
      )}

      {cancelling && (
        <ReasonCodePrompt
          action={tr('ws.coaching.cancel.signUpAction', {
            name: isolate(rosterName(cancelling, tr)),
          })}
          reasonCodes={COACHING_REASON_CODES}
          noteMode="optional"
          busy={dialogBusy}
          // The refusal is read from its detail below, so the prompt's own generic line stays off.
          error={null}
          onCancel={closeCancel}
          onSubmit={(code, note) => void cancel(code, note)}
        >
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockEnd: 'var(--tp-sp-3)' }}>
            {enrolmentCancelLines(
              cancelling,
              l.kind,
              // OP-15: once the session has begun the money is kept.
              nowOf(l.server_now, elapsedMs) >= new Date(l.start_at).getTime(),
            ).map((c) => (
              <p key={c.id}>
                {c.id === 'deskPaid'
                  ? tr('ws.coaching.cancel.deskPaid', { amount: money(c.amount) })
                  : tr(`ws.coaching.cancel.${c.id}`)}
              </p>
            ))}
          </div>
          {dialogError != null && <ErrorText error={dialogError} message={words(dialogError)} />}
        </ReasonCodePrompt>
      )}

      {adding && <AddStudentDialog lesson={l} onClose={() => setAdding(false)} />}
    </Panel>
  );
}
