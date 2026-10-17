import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';
import { validateSafeSearch } from '../features/safe/safeLogic';

const SafePage = lazyRouteComponent(() => import('../features/safe/SafePage'), 'SafePageScreen');

/**
 * The Safe (0343): the branch's main cash. Costs paid out of it (or by bank
 * transfer), cash moved in and out, counts. Managers and the owner
 * (ROUTE_ROLES). `?show=payments` opens it as Pay › Bills & suppliers, the
 * ledger on what was paid out.
 */
export const safeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/safe',
  validateSearch: validateSafeSearch,
  component: guarded('/safe', SafePage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
