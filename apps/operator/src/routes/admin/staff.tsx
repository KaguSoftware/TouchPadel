import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const StaffList = lazyRouteComponent(
  () => import('../../features/admin/staff/StaffList'),
  'StaffList',
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/admin/staff?hire=<run step>`: a hiring run's add_staff step, opened from
 * Protocols; the Add staff member form opens filled in from the run's pick
 * (build-contracts-2026-09-23 §5.1, §5.5). Anything malformed is dropped.
 */
function validateStaffSearch(raw: Record<string, unknown>): { hire?: string } {
  return typeof raw.hire === 'string' && UUID.test(raw.hire) ? { hire: raw.hire.toLowerCase() } : {};
}

export const adminStaffRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'staff',
  component: guarded('/admin/staff', StaffList),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateStaffSearch,
});
