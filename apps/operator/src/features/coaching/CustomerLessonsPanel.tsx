/**
 * The customer record's Lessons panel (docs/design/coaching/operator.md
 * §5.15; C-21, R20). Reads `customer_lessons` (the record passes the query it
 * already holds for the coach badge): the counts, the late-cancel and no-show
 * line, and the lessons this customer booked, was picked for at the desk, or
 * confirmed (C-21), upcoming first, then the most recent.
 *
 * A row: time, the kind badge, type and coach, the sign-up status, the
 * attendance, the money line (§5.10.4, every figure the server's). A row at
 * this branch opens `/desk/lessons/$id` (`runLessons`) and, while something
 * is owed at the desk, offers Take payment (`takeLessonPayment`): the record is
 * how a cashier takes lesson money, since the cashier cannot open the lesson
 * screen (R20). A row at another branch names that branch and offers nothing.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  formatDate,
  formatNumber,
  formatTime,
  formatTimeRange,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { pickName, useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useVenue } from '../../lib/venue';
import { Button } from '../../components/ui';
import { MessagePresenter, Panel, StatusBadge, ViewMore, useListCap } from '../../components/kit';
import type { PaymentMethod } from '../till/PaymentPane';
import { LessonBadge } from './LessonBadge';
import { enrolmentLine, enrolmentStatusKey, moneyLineText, type MoneyLine } from './lessonLogic';
import type { CustomerLesson, CustomerLessons } from './lessonPayloads';
import { TakeLessonPayment, type LessonPayTarget } from './TakeLessonPayment';
import { useCoachingCaps } from './useCoaching';

const C = 'ws.coaching.customers';

/** Upcoming: a lesson still to happen with a live sign-up. Everything else is recent. No clock needed. */
export function splitCustomerLessons(lessons: readonly CustomerLesson[]): {
  upcoming: CustomerLesson[];
  recent: CustomerLesson[];
} {
  const live = (l: CustomerLesson) =>
    (l.status === 'held' || l.status === 'scheduled') &&
    (l.enrolment_status === 'booked' || l.enrolment_status === 'held');
  return { upcoming: lessons.filter(live), recent: lessons.filter((l) => !live(l)) };
}

/** The roster's money line for a record row (customer_lessons carries a subset of the money keys). */
export function customerMoneyLines(l: CustomerLesson): MoneyLine[] {
  return enrolmentLine({
    status: l.enrolment_status,
    scope: l.course_id ? 'course' : 'lesson',
    cancel_kind: null,
    payment_mode: l.payment_mode,
    money: {
      price_iqd: null,
      owed_iqd: l.money.owed_iqd,
      desk_paid_iqd: l.money.desk_paid_iqd,
      online_paid_iqd: l.money.online_paid_iqd,
      refunded_iqd: null,
      kept_iqd: null,
      refund_due_iqd: l.money.refund_due_iqd,
      refund_due_desk_iqd: null,
      refund_blocked_iqd: null,
      take_iqd: l.money.take_iqd,
    },
  });
}

/** Take payment is offered on a live desk sign-up at this branch with something to take (the server re-checks). */
export function takeableHere(l: CustomerLesson, branchId: string | null): boolean {
  return (
    isHere(l, branchId) &&
    l.enrolment_status === 'booked' &&
    l.payment_mode !== 'online' &&
    l.status !== 'cancelled' &&
    l.status !== 'expired' &&
    (l.money.take_iqd ?? 0) > 0
  );
}

/** A row at the rail's branch (or any row while the branch is not known yet). */
export function isHere(l: Pick<CustomerLesson, 'venue_id'>, branchId: string | null): boolean {
  return branchId === null || l.venue_id === null || l.venue_id === branchId;
}

export function CustomerLessonsPanel({
  customerName,
  data,
  tz,
  refetch,
}: {
  /** The record's name: the student as Take payment names them. */
  customerName: string;
  data: CustomerLessons;
  tz: string;
  /** Re-read the panel; resolves to the fresh answer (for LESSON_OWED_CHANGED). */
  refetch: () => Promise<CustomerLessons | null | undefined>;
}) {
  const { tr, locale } = useLocale();
  const caps = useCoachingCaps();
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ target: LessonPayTarget; method: PaymentMethod } | null>(
    null,
  );
  const showList = caps.runLessons || caps.takeLessonPayment;
  const { upcoming, recent } = splitCustomerLessons(data.lessons);
  const n = (v: number | null) => (v == null ? '—' : isolateLtr(formatNumber(v, locale)));
  const strikes = data.lesson_strikes_30d ?? 0;
  const nothing =
    data.lessons.length === 0 &&
    !data.counts.lessons &&
    !data.counts.no_shows &&
    strikes === 0 &&
    !data.coach;
  if (nothing) return null;

  function pay(l: CustomerLesson, method: PaymentMethod) {
    setNotice(null);
    setPaying({
      method,
      target: {
        enrolmentId: l.enrolment_id,
        name: customerName,
        course: !!l.course_id,
        dueIqd: l.money.take_iqd ?? 0,
      },
    });
  }

  async function refetchDue(enrolmentId: string): Promise<number | null> {
    const fresh = await refetch();
    const row = fresh?.lessons.find((x) => x.enrolment_id === enrolmentId);
    return row ? (row.money.take_iqd ?? 0) : null;
  }

  return (
    <Panel title={tr(`${C}.panelTitle`)} data-testid="customer-lessons">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <div
          style={{ display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', alignItems: 'center' }}
        >
          <span data-testid="lesson-counts">
            {tr(`${C}.counts`, {
              lessons: n(data.counts.lessons),
              noShows: n(data.counts.no_shows),
            })}
          </span>
          {strikes > 0 && (
            <StatusBadge tone="warn" size="sm" label={tr(`${C}.strikes`, { count: n(strikes) })} />
          )}
        </div>
        {notice && <MessagePresenter tone="info" message={notice} />}
        {showList &&
          (data.lessons.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr(`${C}.empty`)}</p>
          ) : (
            <>
              {upcoming.length > 0 && (
                <LessonRows title={tr(`${C}.upcoming`)} rows={upcoming} tz={tz} onPay={pay} />
              )}
              {recent.length > 0 && (
                <LessonRows title={tr(`${C}.recent`)} rows={recent} tz={tz} onPay={pay} />
              )}
            </>
          ))}
      </div>
      {paying && (
        <TakeLessonPayment
          target={paying.target}
          method={paying.method}
          onClose={() => setPaying(null)}
          onPaid={() => void refetch()}
          refetchDue={() => refetchDue(paying.target.enrolmentId)}
          onNotice={setNotice}
        />
      )}
    </Panel>
  );
}

function LessonRows({
  title,
  rows,
  tz,
  onPay,
}: {
  title: string;
  rows: readonly CustomerLesson[];
  tz: string;
  onPay: (l: CustomerLesson, method: PaymentMethod) => void;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const caps = useCoachingCaps();
  const { reachable } = useStationReach();
  const { branchId, venues } = useVenue();
  const offline = tr('ws.coaching.offline.needsConnection');
  const cap = useListCap(rows);
  const pick = (en: string | null, ar: string | null) =>
    (locale === 'ar' ? ar || en : en || ar) ?? '';
  const branchName = (venueId: string | null) => {
    const v = venues.find((b) => b.id === venueId);
    return v ? pickName(locale, v) : tr(`${C}.anotherBranch`);
  };

  return (
    <section aria-label={title} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <h3
        style={{
          margin: 0,
          fontSize: 'var(--tp-fs-sm)',
          fontWeight: 600,
          color: 'var(--tp-muted-fg)',
        }}
      >
        {title}
      </h3>
      <ul
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}
      >
        {cap.shown.map((l) => {
          const start = new Date(l.start_at);
          const when = l.end_at
            ? formatTimeRange(start, new Date(l.end_at), locale, tz)
            : formatTime(start, locale, tz);
          const typeName =
            pick(l.course_title_en, l.course_title_ar) || pick(l.type_name_en, l.type_name_ar);
          const coach = pick(l.coach_name_en, l.coach_name_ar);
          const statusKey = enrolmentStatusKey(l.enrolment_status);
          const here = isHere(l, branchId);
          const lines = customerMoneyLines(l);
          const take = caps.takeLessonPayment && takeableHere(l, branchId);
          return (
            <li
              key={l.enrolment_id}
              data-testid="customer-lesson-row"
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-1)',
                paddingBlock: 'var(--tp-sp-2)',
                paddingInline: 'var(--tp-sp-2)',
                borderRadius: 'var(--tp-radius-ctl)',
                background: 'var(--tp-surface-2)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--tp-sp-2)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <bdi style={{ whiteSpace: 'nowrap' }}>{formatDate(start, locale, tz)}</bdi>
                <bdi style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {when}
                </bdi>
                <LessonBadge kind={l.kind} held={l.status === 'held'} />
                <span style={{ minInlineSize: 0 }}>
                  {coach ? (
                    tr(`${C}.typeAndCoach`, {
                      type: isolate(typeName || '—'),
                      coach: isolate(coach),
                    })
                  ) : (
                    <bdi>{typeName || '—'}</bdi>
                  )}
                </span>
                <StatusBadge
                  size="sm"
                  tone="neutral"
                  label={statusKey ? tr(statusKey) : l.enrolment_status}
                />
                {l.attendance === 'attended' || l.attendance === 'no_show' ? (
                  <StatusBadge
                    size="sm"
                    tone={l.attendance === 'attended' ? 'success' : 'warn'}
                    label={tr(`ws.coaching.common.attendance.${l.attendance}`)}
                  />
                ) : null}
              </div>
              {lines.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--tp-sp-2)',
                    flexWrap: 'wrap',
                    fontSize: 'var(--tp-fs-sm)',
                  }}
                >
                  {lines.map((m) => (
                    <span
                      key={m.id}
                      style={{
                        color:
                          m.tone === 'warn'
                            ? 'var(--tp-warn-fg)'
                            : m.tone === 'success'
                              ? 'var(--tp-success-fg)'
                              : 'var(--tp-muted-fg)',
                      }}
                    >
                      {moneyLineText(m, tr, locale)}
                    </span>
                  ))}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--tp-sp-2)',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                {!here && (
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                    {tr(`${C}.atBranch`, { branch: isolate(branchName(l.venue_id)) })}
                  </span>
                )}
                {here && caps.runLessons && l.lesson_id && (
                  <Button
                    size="sm"
                    kind="ghost"
                    iconEnd="arrowUpRight"
                    onClick={() =>
                      void navigate({ to: '/desk/lessons/$id', params: { id: l.lesson_id! } })
                    }
                  >
                    {tr(`${C}.openLesson`)}
                  </Button>
                )}
                {take && (
                  <>
                    <Button
                      size="sm"
                      icon="banknote"
                      disabled={!reachable}
                      disabledReason={offline}
                      onClick={() => onPay(l, 'cash')}
                    >
                      {tr('ws.coaching.common.take.button')}
                    </Button>
                    <Button
                      size="sm"
                      kind="ghost"
                      icon="card"
                      aria-label={tr(`${C}.takeCardAria`)}
                      disabled={!reachable}
                      disabledReason={offline}
                      onClick={() => onPay(l, 'card')}
                    >
                      {tr(`${C}.takeCard`)}
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <ViewMore
        hidden={cap.hidden}
        open={cap.open}
        onToggle={cap.toggle}
        style={{ marginBlockStart: 0 }}
      />
    </section>
  );
}
