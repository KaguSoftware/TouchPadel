import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const IncidentsPage = lazyRouteComponent(() => import('../features/incidents/IncidentsPage'), 'IncidentsPageScreen');

/**
 * Incident reports (wave5-addendum-2026-09-25 §2.6, §5.2): the desk and the
 * till report here (every role reports on the phone), and the manager and the
 * owner review. Court desk, cashier, manager and owner (ROUTE_ROLES); no
 * search params.
 */
export const incidentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/incidents',
  component: guarded('/incidents', IncidentsPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
