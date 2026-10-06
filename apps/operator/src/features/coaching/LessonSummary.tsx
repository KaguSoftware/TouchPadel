/**
 * What the calendar's actions dialog shows for a lesson
 * (docs/design/coaching/operator.md §5.8, "ReservationActionsDialog, lesson
 * branch"): its places, what is still to pay, the C-24 flag and, before the
 * cut-off with too few, the cut-off line. Read only: a lesson changes on its
 * own screen (R7, R35), so the dialog around this offers Close and Open lesson
 * and nothing else.
 *
 * Every figure is desk_lessons'; the clock is the payload's (`nowMs`). With no
 * lesson row (offline, an older server) it says the court is held for a lesson.
 */
import { formatIQD, formatNumber, formatTime } from '@touch/i18n';
import { StatusBadge } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import { cutoffState, lessonPayState, lessonPlacesChip } from './lessonLogic';
import type { DeskLesson } from './lessonPayloads';

export function LessonSummary({
  lesson,
  held = false,
  nowMs,
  tz,
}: {
  lesson: DeskLesson | null;
  /** A held lesson's hold row: the guest is paying online. */
  held?: boolean;
  /** The payload's clock (lessonLogic.nowOf). */
  nowMs: number;
  tz: string;
}) {
  const { tr, locale } = useLocale();
  const line = { margin: 0, fontSize: 'var(--tp-fs-sm)' } as const;
  if (!lesson) {
    return (
      <p data-testid="lesson-summary" style={{ ...line, color: 'var(--tp-muted-fg)' }}>
        {tr('ws.coaching.calendar.heldForLesson')}
      </p>
    );
  }
  const chip = lessonPlacesChip(lesson);
  const pay = lessonPayState(lesson, nowMs);
  const cut = cutoffState(lesson, nowMs);
  const time = (iso: string | null) => (iso ? formatTime(new Date(iso), locale, tz) : '—');
  return (
    <div data-testid="lesson-summary" style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      {(held || lesson.status === 'held') && (
        <p style={{ ...line, color: 'var(--tp-info-fg)' }}>
          {tr('ws.coaching.banner.held', { time: time(lesson.hold_expires_at) })}
        </p>
      )}
      {chip?.kind === 'places' && (
        <p style={{ ...line, fontVariantNumeric: 'tabular-nums' }}>
          {tr('ws.coaching.common.places', {
            taken: formatNumber(chip.taken, locale),
            total: formatNumber(chip.total, locale),
          })}
        </p>
      )}
      <span
        style={{
          display: 'inline-flex',
          gap: 'var(--tp-sp-1)',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {pay.pay === 'awaiting' ? (
          <StatusBadge size="sm" tone="info" label={tr('ws.coaching.common.pay.awaiting')} />
        ) : pay.pay === 'owing' ? (
          <StatusBadge
            size="sm"
            tone={pay.warn ? 'warn' : 'neutral'}
            label={
              pay.owingIqd === null
                ? tr('ws.coaching.common.pay.toPay', { count: formatNumber(pay.owing, locale) })
                : tr('ws.coaching.common.pay.toPayAmount', {
                    count: formatNumber(pay.owing, locale),
                    amount: formatIQD(pay.owingIqd, locale),
                  })
            }
          />
        ) : pay.pay === 'allPaid' ? (
          <StatusBadge size="sm" tone="success" label={tr('ws.coaching.common.pay.allPaid')} />
        ) : pay.pay === 'online' ? (
          <StatusBadge size="sm" tone="neutral" label={tr('ws.coaching.common.pay.paidOnline')} />
        ) : null}
        {pay.coachUnpaid && (
          <StatusBadge
            size="sm"
            tone="warn"
            label={tr('ws.coaching.common.pay.coachBookedUnpaid')}
          />
        )}
      </span>
      {cut && (
        <p style={{ ...line, color: 'var(--tp-warn-fg)', fontWeight: 600 }}>
          {tr('ws.coaching.banner.underMin', {
            students: formatNumber(cut.short, locale),
            time: time(cut.cutoffAt),
          })}
        </p>
      )}
    </div>
  );
}
