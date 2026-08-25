import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const CategoryEditor = lazyRouteComponent(
  () => import('../../features/admin/menu/CategoryEditor'),
  'CategoryEditor',
);

export const adminCategoriesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'categories',
  component: guarded('/admin/categories', CategoryEditor),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
