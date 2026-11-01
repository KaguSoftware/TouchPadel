import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const MonitoringPage = lazyRouteComponent(() => import('../features/monitoring/MonitoringPage'), 'MonitoringPageScreen');

/**
 * Monitoring (0393): crashes and errors from every app, the edge functions and
 * the scheduled jobs. The dev role and the owner (ROUTE_ROLES); no search params.
 */
export const monitoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/monitoring',
  component: guarded('/monitoring', MonitoringPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
