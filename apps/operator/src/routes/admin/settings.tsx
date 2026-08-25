import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const CafeSettings = lazyRouteComponent(
  () => import('../../features/admin/settings/CafeSettings'),
  'CafeSettings',
);

export const adminSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings',
  component: guarded('/admin/settings', CafeSettings),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
