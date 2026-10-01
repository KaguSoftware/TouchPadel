/**
 * Coach pay at `/reports/coaches` (docs/design/coaching/operator.md §5.16).
 * Placeholder until the money lane lands.
 */
import { EmptyState, PageHeader } from '../../../components/kit';
import { useLocale } from '../../../lib/i18n';

export function CoachStatementsScreen() {
  const { tr } = useLocale();
  return (
    <div>
      <PageHeader title={tr('ws.shell.nav.coachPay')} />
      <EmptyState icon="whistle" title={tr('ws.coaching.offline.serverMissing')} />
    </div>
  );
}
