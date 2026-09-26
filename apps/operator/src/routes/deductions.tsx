import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const DeductionsPage = lazyRouteComponent(() => import('../features/deductions/DeductionsPage'), 'DeductionsPageScreen');

/**
 * Pay deductions (wave5-addendum-2026-09-25 §2.5, §5.2): heads propose on the
 * phone, the manager and the owner decide here. Manager and owner
 * (ROUTE_ROLES); no search params.
 */
export const deductionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/deductions',
  component: guarded('/deductions', DeductionsPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
