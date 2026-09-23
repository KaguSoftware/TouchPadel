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
import { useAuth, type StaffRole } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { EmptyState, PageHeader } from '../../components/kit';

/**
 * Which empty sentence each role reads: the driver is told about purchases,
 * marketing about its own tasks, and neither about the other's. A role
 * without a line of its own reads the neutral one.
 */
const BODY_BY_ROLE: Partial<Record<StaffRole, 'driver' | 'marketing'>> = {
  driver: 'driver',
  marketing: 'marketing',
};

export function MyTasksScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const body = (staff && BODY_BY_ROLE[staff.role]) ?? 'other';
  return (
    <>
      <PageHeader title={tr('ws.team.tasks.title')} />
      <EmptyState
        icon="checkCircle"
        title={tr('ws.team.tasks.empty.title')}
        body={tr(`ws.team.tasks.empty.body.${body}`)}
      />
    </>
  );
}
