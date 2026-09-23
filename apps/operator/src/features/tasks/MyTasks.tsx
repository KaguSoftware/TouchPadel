/**
 * My tasks (/tasks) — the landing screen of the team workspace, for driver and
 * marketing (0155).
 *
 * Both roles hold the any-staff baseline and nothing more: no till, no kitchen
 * display, no stock, no money. What they will do here does not exist yet —
 * purchases for the driver, campaign tasks for marketing, and the protocol
 * steps and checklists both will follow — so the screen says that plainly
 * rather than showing an empty list that looks like a failed load.
 *
 * No data is fetched. When the first assignable thing lands, it arrives here
 * as a list above this empty state, and the empty state stays for the day
 * nothing is assigned.
 */
import { useLocale } from '../../lib/i18n';
import { EmptyState, PageHeader } from '../../components/kit';

export function MyTasksScreen() {
  const { tr } = useLocale();
  return (
    <>
      <PageHeader title={tr('ws.team.tasks.title')} />
      <EmptyState
        icon="checkCircle"
        title={tr('ws.team.tasks.empty.title')}
        body={tr('ws.team.tasks.empty.body')}
      />
    </>
  );
}
