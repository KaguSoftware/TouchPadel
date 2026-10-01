/**
 * The lesson badge (docs/design/coaching/operator.md §5.8): the kit's
 * StatusBadge with the whistle and the lesson tokens, labelled by kind
 * ("Private lesson", "Group session", "Course"), or "Awaiting payment" for a
 * private lesson held for the guest's online payment. Never colour-only.
 */
import type { CSSProperties } from 'react';
import { StatusBadge } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import type { LessonKind } from './lessonPayloads';

export const LESSON_BADGE_STYLE: CSSProperties = {
  background: 'var(--tp-lesson-soft)',
  color: 'var(--tp-lesson)',
};

export function LessonBadge({
  kind,
  held = false,
  size = 'sm',
}: {
  /** Null when the lesson row is not known (offline): the bare word "Lesson". */
  kind: LessonKind | null;
  held?: boolean;
  size?: 'sm' | 'md';
}) {
  const { tr } = useLocale();
  const label = held
    ? tr('ws.coaching.common.status.held')
    : kind
      ? tr(`ws.coaching.common.kind.${kind}`)
      : tr('ws.coaching.common.lesson');
  return <StatusBadge icon="whistle" size={size} label={label} style={LESSON_BADGE_STYLE} />;
}
