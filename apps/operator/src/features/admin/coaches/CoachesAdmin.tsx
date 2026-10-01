/**
 * Setup › Coaches at `/admin/coaches` (docs/design/coaching/operator.md §5.13).
 * Placeholder until the setup lane lands.
 */
import { EmptyState, PageHeader } from '../../../components/kit';
import { useLocale } from '../../../lib/i18n';

export function CoachesAdmin() {
  const { tr } = useLocale();
  return (
    <div>
      <PageHeader title={tr('ws.shell.nav.coaches')} />
      <EmptyState icon="whistle" title={tr('ws.coaching.offline.serverMissing')} />
    </div>
  );
}
