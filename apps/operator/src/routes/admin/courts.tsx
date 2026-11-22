import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const CourtsAndPrices = lazyRouteComponent(
  () => import('../../features/admin/courts/CourtsAndPrices'),
  'CourtsAndPrices',
);

export const adminCourtsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'courts',
  component: guarded('/admin/courts', CourtsAndPrices),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
