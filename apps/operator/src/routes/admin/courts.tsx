import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const CourtsAdmin = lazyRouteComponent(
  () => import('../../features/admin/courts/CourtsAdmin'),
  'CourtsAdmin',
);

export const adminCourtsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'courts',
  component: guarded('/admin/courts', CourtsAdmin),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
