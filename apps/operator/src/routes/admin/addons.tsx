import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const AddonsPage = lazyRouteComponent(
  () => import('../../features/admin/addons/AddonsPage'),
  'AddonsPage',
);

export const adminAddonsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'addons',
  component: guarded('/admin/addons', AddonsPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
