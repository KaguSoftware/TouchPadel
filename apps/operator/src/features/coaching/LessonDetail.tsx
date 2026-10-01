/**
 * One lesson at `/desk/lessons/$id` (docs/design/coaching/operator.md §5.10).
 * Placeholder until the lesson-screen lane lands.
 */
import { EmptyState, PageHeader } from '../../components/kit';
import { useLocale } from '../../lib/i18n';

export function LessonDetailScreen() {
  const { tr } = useLocale();
  return (
    <div>
      <PageHeader
        eyebrow={tr('ws.coaching.common.lesson')}
        title={tr('ws.coaching.common.lesson')}
      />
      <EmptyState icon="whistle" title={tr('ws.coaching.offline.serverMissing')} />
    </div>
  );
}
