import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const HeroBuilder = lazyRouteComponent(
  () => import('../../features/admin/hero/HeroBuilder'),
  'HeroBuilder',
);

export const adminHeroRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'hero',
  component: guarded('/admin/hero', HeroBuilder),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
