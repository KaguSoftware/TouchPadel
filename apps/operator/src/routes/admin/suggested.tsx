import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const SuggestedEditor = lazyRouteComponent(
  () => import('../../features/admin/suggested/SuggestedEditor'),
  'SuggestedEditor',
);

export const adminSuggestedRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'suggested',
  component: guarded('/admin/suggested', SuggestedEditor),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
