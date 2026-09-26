import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

// The editor has no header of its own because it is also a tab inside venue
// settings, which names it; standing alone at /admin/hours it needs one.
const OpeningHoursPage = lazyRouteComponent(() => import('../../features/admin/OpeningHoursPage'), 'OpeningHoursPage');

export const adminHoursRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'hours',
  component: guarded('/admin/hours', OpeningHoursPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
