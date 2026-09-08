import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const OperationsOverview = lazyRouteComponent(() => import('../features/ops/OperationsOverview'), 'OperationsOverviewScreen');

/** The manager's landing screen (spec 06.21). */
export const opsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ops',
  component: guarded('/ops', OperationsOverview),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
