/**
 * The customer record's coach badge (docs/design/coaching/operator.md §5.15):
 * the lesson tokens and the whistle, "Coach", "Coach · paused" or
 * "Coach · retired". It is not a customer flag: FLAG_TYPES and
 * CustomerFlagType do not change. Never colour-only.
 */
import { StatusBadge } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import { LESSON_BADGE_STYLE } from './LessonBadge';

export function CoachBadge({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const { tr } = useLocale();
  const label =
    status === 'paused'
      ? tr('ws.coaching.customers.badge.paused')
      : status === 'retired'
        ? tr('ws.coaching.customers.badge.retired')
        : tr('ws.coaching.customers.badge.active');
  return <StatusBadge icon="whistle" size={size} label={label} style={LESSON_BADGE_STYLE} />;
}
