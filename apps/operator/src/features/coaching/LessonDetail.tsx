/**
 * One lesson at `/desk/lessons/$id` (docs/design/coaching/operator.md §5.10),
 * for every status and kind: the header (§5.10.1: kind, title, court, time,
 * badges, places, the C-24 flag; See on calendar, Move court, Reschedule,
 * Cancel lesson / Cancel the course), the banner (§5.10.2), a course's strip
 * of sessions (§5.10.3), the roster (LessonRosterPanel, §5.10.4–§5.10.8), the
 * desk refunds due for a manager (LessonRefundsDue, §5.10.10) and the history
 * (§5.10.11). Modelled on features/matches/MatchDetail.tsx.
 *
 * `?customer=<id>` (a customer handed back from search or create) opens Add
 * student with that customer picked; `?pay=<enrolment>` (from the Today group
 * or the record) opens Take payment on that sign-up once the detail has
 * loaded. A lesson the server will not show here (LESSON_NOT_FOUND, or a
 * server without coaching: RPC_MISSING) reads "not at this branch" with a way
 * back to Today.
 *
 * Reads `useLessonDetail` (20 s, last data kept) plus the 'courts' broadcast
 * (useLessonsLive). Every write is a direct appRpc with the literal name (CD-6,
 * online only: offline the controls are disabled with the reason).
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  formatDate,
  formatDateTime,
  formatDayNumber,
  formatMonthShort,
  formatNumber,
  formatIQD,
  formatTime,
  formatTimeRange,
  formatWeekdayShort,
  isolate,
  VENUE_TZ,
  type Locale,
} from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useStationReach } from '../../lib/stationReach';
import { currentBranchId } from '../../lib/venueScope';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Skeleton, COACHING_REASON_CODES } from '../../components/ui';
import {
  EmptyState,
  MessagePresenter,
  PageHeader,
  Panel,
  ReasonCodePrompt,
  StatusBadge,
  type MessageTone,
  type Tone,
} from '../../components/kit';
import { tradingDateOf } from '../desk/calendar/monthLogic';
import { AddStudentDialog } from './AddStudentDialog';
import { LessonBadge } from './LessonBadge';
import { LessonReadNotice } from './LessonReadNotice';
import { LessonRefundsDue } from './LessonRefundsDue';
import { LessonRosterPanel } from './LessonRosterPanel';
import { MoveCourtDialog } from './MoveCourtDialog';
import { RescheduleDialog } from './RescheduleDialog';
import {
  coachingErrorText,
  courseStatusKey,
  courseTitleOf,
  countOf,
  blockedRefundDue,
  deskRefundDue,
  eventSentence,
  lessonBannerKey,
  lessonBannerText,
  lessonStatusKey,
  nowOf,
  reasonForm,
  refundsForLesson,
  type BannerTone,
  type Tr,
} from './lessonLogic';
import type { LessonDetail, LessonInfo } from './lessonPayloads';
import { readCancelledCourse } from './lessonPayloads';
import {
  coachBookedUnpaid,
  courseStrip,
  lessonHeaderActions,
  liveStudents,
  placesOf,
  type HeaderAction,
} from './lessonScreenLogic';
import {
  invalidateLessonBooking,
  useCoachingCaps,
  useLessonDetail,
  useLessonRead,
  useLessonsLive,
  useRefundsDue,
} from './useCoaching';

const STATUS_TONE: Record<string, Tone> = {
  held: 'warn',
  scheduled: 'accent',
  completed: 'success',
  cancelled: 'danger',
  expired: 'neutral',
};

const BANNER_TONE: Record<BannerTone, MessageTone> = {
  info: 'info',
  success: 'success',
  warn: 'refused',
  refused: 'refused',
  neutral: 'info',
};

/** "Sun 12 Oct": a session's day in the branch's zone, Latin digits. */
export function shortDay(iso: string, locale: Locale, tz: string): string {
  const d = new Date(iso);
  return `${formatWeekdayShort(d, locale, tz)} ${formatDayNumber(d, locale, tz)} ${formatMonthShort(d, locale, tz)}`;
}

function pickLang(locale: Locale, en: string | null | undefined, ar: string | null | undefined) {
  const a = (locale === 'ar' ? ar : en) ?? '';
  return a.trim() !== '' ? a : ((locale === 'ar' ? en : ar) ?? '');
}

/** The header's eyebrow (§5.10.1): the kind, or "Course · Session 3 of 8". */
export function lessonEyebrow(lesson: LessonInfo, tr: Tr, locale: Locale): string {
  const c = lesson.course;
  if (c && c.session_no !== null && c.sessions_count !== null) {
    return tr('ws.coaching.common.courseSession', {
      n: formatNumber(c.session_no, locale),
      total: formatNumber(c.sessions_count, locale),
    });
  }
  return tr(`ws.coaching.common.kind.${lesson.kind}`);
}

/** The header's title (§5.10.1): "{type or course title} · {coach}". */
export function lessonTitle(lesson: LessonInfo, tr: Tr, locale: Locale): string {
  const typeName =
    pickLang(locale, lesson.lesson_type?.name_en, lesson.lesson_type?.name_ar) ||
    tr(`ws.coaching.common.kind.${lesson.kind}`);
  const name = lesson.course ? courseTitleOf(lesson.course, typeName, locale) : typeName;
  const coach = pickLang(locale, lesson.coach?.display_name_en, lesson.coach?.display_name_ar);
  return coach ? tr('ws.coaching.lesson.title', { name, coach: isolate(coach) }) : name;
}

export function LessonDetailScreen() {
  const { tr } = useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as { customer?: string; pay?: string };
  const navigate = useNavigate();
  const q = useLessonDetail(id);
  const status = useLessonRead(q);
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  useLessonsLive();

  const header = (
    <PageHeader eyebrow={tr('ws.coaching.common.lesson')} title={tr('ws.coaching.common.lesson')} />
  );
  const notFound = (
    <div>
      {header}
      <EmptyState
        icon="whistle"
        title={tr('ws.coaching.lesson.notFound')}
        action={
          <Button onClick={() => void navigate({ to: '/desk/today' })}>
            {tr('ws.coaching.lesson.backToToday')}
          </Button>
        }
      />
    </div>
  );

  if (status.kind === 'absent') return notFound;
  if (status.kind === 'loading') {
    return (
      <div>
        {header}
        <Skeleton lines={5} />
      </div>
    );
  }
  if (status.kind === 'failed') {
    if (status.error instanceof AppRpcError && status.error.code === 'LESSON_NOT_FOUND') {
      return notFound;
    }
    return (
      <div>
        {header}
        <LessonReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} />
      </div>
    );
  }
  // The previous lesson's data while a strip chip's lesson loads: wait for this one.
  if (status.data.lesson.id !== id) {
    return (
      <div>
        {header}
        <Skeleton lines={5} />
      </div>
    );
  }
  const clearSearch = () =>
    void navigate({
      to: '/desk/lessons/$id',
      params: { id },
      search: {} as never,
      replace: true,
    });
  return (
    <LessonScreen
      detail={status.data}
      tz={tz}
      hours={settingsQ.data?.opening_hours}
      elapsedMs={Math.max(0, Date.now() - status.updatedAt)}
      stale={
        status.stale ? (
          <LessonReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} />
        ) : null
      }
      handedCustomer={search.customer}
      payEnrolment={search.pay}
      onSearchDone={clearSearch}
    />
  );
}

type Dialog = 'cancelLesson' | 'cancelCourse' | 'reschedule' | 'move' | null;

function LessonScreen({
  detail,
  tz,
  hours,
  elapsedMs,
  stale,
  handedCustomer,
  payEnrolment,
  onSearchDone,
}: {
  detail: LessonDetail;
  tz: string;
  hours: Parameters<typeof tradingDateOf>[2];
  elapsedMs: number;
  stale: ReactNode;
  handedCustomer?: string;
  payEnrolment?: string;
  onSearchDone: () => void;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const caps = useCoachingCaps();
  const { reachable } = useStationReach();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const l = detail.lesson;
  const nowMs = nowOf(l.server_now, elapsedMs);
  const actions = lessonHeaderActions(l, caps, reachable);
  const offline = tr('ws.coaching.offline.needsConnection');
  const start = new Date(l.start_at);
  const end = new Date(l.end_at);
  const court = pickLang(locale, l.court_name_en, l.court_name_ar);
  const statusKey = lessonStatusKey(l.status);
  const banner = lessonBannerKey(l, nowMs);
  const refundDue = deskRefundDue(detail.enrolments);
  const refundBlocked = blockedRefundDue(detail.enrolments);
  const places = placesOf(l);
  const coachUnpaid = coachBookedUnpaid(l, detail.enrolments);
  const handing = Boolean(handedCustomer) && caps.runLessons && l.can.add_student;

  const refundsQ = useRefundsDue(currentBranchId(), caps.refund);
  const refunds = caps.refund ? refundsForLesson(refundsQ.data, l) : [];

  const reasonOf = (a: HeaderAction) =>
    a.reason === 'offline'
      ? offline
      : a.reason === 'held'
        ? tr('ws.coaching.errors.heldWaiting')
        : undefined;
  const words = (e: unknown) => coachingErrorText(e, tr, {}, { scope: 'lesson' });

  function close() {
    setDialog(null);
    setError(null);
  }

  async function cancel(code: string, note: string) {
    const which = dialog;
    setBusy(true);
    setError(null);
    try {
      const reason = reasonForm(code, note);
      if (which === 'cancelCourse' && l.course) {
        const out = readCancelledCourse(
          await appRpc('desk_cancel_course', { p_course_id: l.course.course_id, p_reason: reason }),
        );
        toast.ok(
          tr('ws.coaching.lesson.courseCancelled', {
            sessions:
              out.sessions_cancelled === null
                ? '—'
                : countOf('sessions', out.sessions_cancelled, locale),
          }),
        );
      } else {
        await appRpc('desk_cancel_lesson', { p_lesson_id: l.id, p_reason: reason });
        toast.ok(tr('ws.coaching.lesson.cancelled'));
      }
      invalidateLessonBooking(qc);
      close();
    } catch (e) {
      // A rule refusal never reverts silently: the prompt stays and says why; the screen re-reads.
      setError(e);
      invalidateLessonBooking(qc);
    } finally {
      setBusy(false);
    }
  }

  const date = tradingDateOf(l.start_at, tz, hours);
  const action = (
    a: HeaderAction | null,
    label: string,
    icon: 'court' | 'calendar',
    open: Dialog,
  ) =>
    a && (
      <Button
        icon={icon}
        disabled={!a.enabled}
        disabledReason={reasonOf(a)}
        onClick={() => setDialog(open)}
      >
        {label}
      </Button>
    );

  const strip = courseStrip(l.course, l.id);
  const courseKey = l.course ? courseStatusKey(l.course.status) : null;

  return (
    <div>
      <PageHeader
        eyebrow={lessonEyebrow(l, tr, locale)}
        title={lessonTitle(l, tr, locale)}
        subtitle={
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--tp-sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {court && <bdi>{court}</bdi>}
            <bdi>
              {formatWeekdayShort(start, locale, tz)} {formatDate(start, locale, tz)}
            </bdi>
            <bdi>{formatTimeRange(start, end, locale, tz)}</bdi>
            <LessonBadge kind={l.kind} />
            <StatusBadge
              tone={STATUS_TONE[l.status] ?? 'neutral'}
              label={statusKey ? tr(statusKey) : l.status}
            />
            {places && (
              <span>
                {tr('ws.coaching.common.places', {
                  taken: formatNumber(places.taken, locale),
                  total: formatNumber(places.total, locale),
                })}
              </span>
            )}
            {coachUnpaid && (
              <StatusBadge
                size="sm"
                tone="warn"
                label={tr('ws.coaching.common.pay.coachBookedUnpaid')}
              />
            )}
          </span>
        }
        actions={
          <>
            <Button
              icon="calendar"
              onClick={() => void navigate({ to: '/desk', search: { date } as never })}
            >
              {tr('ws.coaching.lesson.seeOnCalendar')}
            </Button>
            {action(actions.moveCourt, tr('ws.coaching.lesson.moveCourt'), 'court', 'move')}
            {action(
              actions.reschedule,
              tr('ws.coaching.lesson.reschedule'),
              'calendar',
              'reschedule',
            )}
            {actions.cancelLesson && (
              <Button
                kind="danger"
                icon="ban"
                disabled={!actions.cancelLesson.enabled}
                disabledReason={reasonOf(actions.cancelLesson)}
                onClick={() => setDialog('cancelLesson')}
              >
                {tr('ws.coaching.lesson.cancelLesson')}
              </Button>
            )}
            {actions.cancelCourse && (
              <Button
                kind="danger"
                icon="ban"
                disabled={!actions.cancelCourse.enabled}
                disabledReason={reasonOf(actions.cancelCourse)}
                onClick={() => setDialog('cancelCourse')}
              >
                {tr('ws.coaching.lesson.cancelCourse')}
              </Button>
            )}
          </>
        }
      />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', marginBlockEnd: 'var(--tp-sp-4)' }}>
        {stale}
        <MessagePresenter
          tone={BANNER_TONE[banner.tone]}
          message={lessonBannerText(banner, l, { tr, locale, tz })}
        />
        {refundDue > 0 && (
          <MessagePresenter
            tone="refused"
            icon="undo"
            message={tr('ws.coaching.banner.refundDueDesk', {
              amount: formatIQD(refundDue, locale),
            })}
          />
        )}
        {refundBlocked > 0 && (
          <MessagePresenter
            tone="refused"
            message={tr('ws.coaching.banner.refundBlocked', {
              amount: formatIQD(refundBlocked, locale),
            })}
          />
        )}
      </div>

      {strip.length > 0 && l.course && (
        <Panel
          title={tr('ws.coaching.lesson.courseStrip.title')}
          actions={
            courseKey ? <StatusBadge size="sm" tone="neutral" label={tr(courseKey)} /> : undefined
          }
          style={{ marginBlockEnd: 'var(--tp-sp-4)' }}
          data-testid="course-strip"
        >
          <ol
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              flexWrap: 'wrap',
            }}
          >
            {strip.map(({ session: s, current }) => {
              const sKey = lessonStatusKey(s.status);
              const chip = tr('ws.coaching.lesson.courseStrip.chip', {
                n: s.session_no === null ? '—' : formatNumber(s.session_no, locale),
                date: shortDay(s.start_at, locale, tz),
                time: formatTime(new Date(s.start_at), locale, tz),
              });
              return (
                <li key={s.lesson_id}>
                  <Link
                    to="/desk/lessons/$id"
                    params={{ id: s.lesson_id }}
                    aria-current={current ? 'page' : undefined}
                    style={{
                      display: 'inline-flex',
                      gap: 'var(--tp-sp-1-5)',
                      alignItems: 'center',
                      paddingBlock: 'var(--tp-sp-1)',
                      paddingInline: 'var(--tp-sp-2-5)',
                      borderRadius: 'var(--tp-radius-ctl)',
                      border: `1px solid ${current ? 'var(--tp-lesson)' : 'var(--tp-border)'}`,
                      background: current ? 'var(--tp-lesson-soft)' : 'var(--tp-surface)',
                      color: current ? 'var(--tp-lesson)' : 'var(--tp-fg)',
                      fontWeight: current ? 700 : 500,
                      fontSize: 'var(--tp-fs-sm)',
                      textDecoration: 'none',
                    }}
                  >
                    <bdi>{chip}</bdi>
                    {s.status !== 'scheduled' && (
                      <StatusBadge
                        size="sm"
                        dot={false}
                        tone={STATUS_TONE[s.status] ?? 'neutral'}
                        label={sKey ? tr(sKey) : s.status}
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
          {l.course.signup_closes_at && (
            <p
              style={{
                marginBlockStart: 'var(--tp-sp-2)',
                fontSize: 'var(--tp-fs-sm)',
                color: 'var(--tp-muted-fg)',
              }}
            >
              {tr('ws.coaching.lesson.courseStrip.signupCloses', {
                time: formatDateTime(new Date(l.course.signup_closes_at), locale, tz),
              })}
            </p>
          )}
        </Panel>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))',
          gap: 'var(--tp-sp-4)',
          alignItems: 'start',
        }}
      >
        <LessonRosterPanel lessonId={l.id} openPayFor={payEnrolment} onPayOpened={onSearchDone} />

        {refunds.length > 0 && <LessonRefundsDue items={refunds} />}

        <Panel title={tr('ws.coaching.lesson.history.title')}>
          {detail.events.length === 0 ? (
            <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.coaching.lesson.history.empty')}</p>
          ) : (
            <ol
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gap: 'var(--tp-sp-1-5)',
              }}
            >
              {detail.events.map((e, i) => (
                <li
                  key={`${e.at}-${e.type}-${i}`}
                  style={{ display: 'flex', gap: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)' }}
                >
                  <bdi
                    style={{
                      color: 'var(--tp-muted-fg)',
                      fontVariantNumeric: 'tabular-nums',
                      flex: '0 0 auto',
                    }}
                  >
                    {formatDateTime(new Date(e.at), locale, tz)}
                  </bdi>
                  <span>{eventSentence(e, tr)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {(dialog === 'cancelLesson' || dialog === 'cancelCourse') && (
        <ReasonCodePrompt
          action={tr(
            dialog === 'cancelCourse'
              ? 'ws.coaching.lesson.cancelCourse'
              : 'ws.coaching.lesson.cancelLesson',
          )}
          reasonCodes={COACHING_REASON_CODES}
          noteMode="optional"
          busy={busy}
          // The refusal is read from its detail below, so the prompt's own generic line stays off.
          error={null}
          onCancel={close}
          onSubmit={(code, note) => void cancel(code, note)}
        >
          <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
            {dialog === 'cancelCourse'
              ? tr('ws.coaching.cancel.course')
              : tr('ws.coaching.cancel.lesson', {
                  students: countOf('students', liveStudents(detail.enrolments), locale),
                })}
          </p>
          {error != null && <ErrorText error={error} message={words(error)} />}
        </ReasonCodePrompt>
      )}

      {dialog === 'reschedule' && (
        <RescheduleDialog lesson={l} night={date} elapsedMs={elapsedMs} onClose={close} />
      )}
      {dialog === 'move' && <MoveCourtDialog lesson={l} night={date} onClose={close} />}

      {handing && handedCustomer && (
        <AddStudentDialog lesson={l} customerId={handedCustomer} onClose={onSearchDone} />
      )}
    </div>
  );
}
