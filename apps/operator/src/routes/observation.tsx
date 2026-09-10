/**
 * `/observation` LAYOUT route — Management's Observation section. Children
 * attach in main.tsx via routes/observation/_children.ts.
 */
import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { RoutePending, guarded } from './admin/_shared';
import { lazyRouteComponent } from '@tanstack/react-router';

const ObservationHome = lazyRouteComponent(
  () => import('../features/observation/ObservationHome'),
  'ObservationHomeScreen',
);

export const observationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/observation',
  component: () => (
    <RequireRole route="/observation">
      <Outlet />
    </RequireRole>
  ),
});

export const observationIndexRoute = createRoute({
  getParentRoute: () => observationRoute,
  path: '/',
  component: guarded('/observation', ObservationHome),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
