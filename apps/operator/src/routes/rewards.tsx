import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const RewardsPage = lazyRouteComponent(() => import('../features/rewards/RewardsPage'), 'RewardsPageScreen');

/**
 * Rewards (0332–0333): the owner's standing rewards for orders placed in a
 * month, per waiter, cashier and manager; a bonus reached is added to the
 * wage the month after. Owner only (ROUTE_ROLES); no search params.
 */
export const rewardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rewards',
  component: guarded('/rewards', RewardsPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
