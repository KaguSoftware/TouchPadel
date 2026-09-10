import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const FinancialHome = lazyRouteComponent(
  () => import('../features/financial/FinancialHome'),
  'FinancialHomeScreen',
);

/** Landing screen of Management's Financial section (lib/workspaces.ts). */
export const financialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/financial',
  component: guarded('/financial', FinancialHome),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
