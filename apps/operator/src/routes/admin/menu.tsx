import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

// Lazy so the (large) menu editor chunk only loads on this section.
const MenuEditor = lazyRouteComponent(
  () => import('../../features/admin/menu/MenuEditor'),
  'MenuEditor',
);

export const adminMenuRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'menu',
  component: guarded('/admin/menu', MenuEditor),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
