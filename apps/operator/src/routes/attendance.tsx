import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const AttendancePage = lazyRouteComponent(() => import('../features/attendance/AttendancePage'), 'AttendancePageScreen');

/**
 * Late and early (0270–0271): the manager records late arrivals and early
 * leaves, and sets the rule that prices a day over the limit. Manager and
 * owner (ROUTE_ROLES); no search params.
 */
export const attendanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/attendance',
  component: guarded('/attendance', AttendancePage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
