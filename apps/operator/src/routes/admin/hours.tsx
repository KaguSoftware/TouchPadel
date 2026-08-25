import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const OpeningHoursEditor = lazyRouteComponent(
  () => import('../../features/admin/OpeningHoursEditor'),
  'OpeningHoursEditor',
);

export const adminHoursRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'hours',
  component: guarded('/admin/hours', OpeningHoursEditor),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
