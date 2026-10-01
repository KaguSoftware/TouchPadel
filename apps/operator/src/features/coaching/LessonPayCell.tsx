/**
 * What a lesson still has to take, where a booking shows its ChargeCell
 * (docs/design/coaching/operator.md §5.11): "To pay 2" (warn once the lesson
 * has started), "All paid" (success), "Paid online" (neutral), and the C-24
 * flag "Booked by the coach · unpaid" for a coach-booked private lesson that
 * still owes. Every figure is desk_lessons'.
 */
import { formatNumber } from '@touch/i18n';
import { StatusBadge } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import { lessonPayState } from './lessonLogic';
import type { DeskLesson } from './lessonPayloads';

export function LessonPayCell({
  lesson,
  nowMs,
  showCoachFlag = true,
}: {
  lesson: DeskLesson;
  /** The payload's clock (`nowOf(server_now, elapsed)`), never the station's alone. */
  nowMs: number;
  showCoachFlag?: boolean;
}) {
  const { tr, locale } = useLocale();
  const state = lessonPayState(lesson, nowMs);
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 'var(--tp-sp-1)',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {state.pay === 'owing' ? (
        <StatusBadge
          size="sm"
          tone={state.warn ? 'warn' : 'neutral'}
          label={tr('ws.coaching.common.pay.toPay', { count: formatNumber(state.owing, locale) })}
        />
      ) : state.pay === 'allPaid' ? (
        <StatusBadge size="sm" tone="success" label={tr('ws.coaching.common.pay.allPaid')} />
      ) : state.pay === 'online' ? (
        <StatusBadge size="sm" tone="neutral" label={tr('ws.coaching.common.pay.paidOnline')} />
      ) : null}
      {showCoachFlag && state.coachUnpaid ? (
        <StatusBadge size="sm" tone="warn" label={tr('ws.coaching.common.pay.coachBookedUnpaid')} />
      ) : null}
    </span>
  );
}
