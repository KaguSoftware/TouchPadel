import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const WagesPage = lazyRouteComponent(() => import('../features/wages/WagesPage'), 'WagesPageScreen');

/**
 * Wages (0270–0272): each person's salary and pay day, what comes off it, and
 * marking it paid; the owner approves deductions here. Owner only
 * (ROUTE_ROLES); no search params.
 */
export const wagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wages',
  component: guarded('/wages', WagesPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
