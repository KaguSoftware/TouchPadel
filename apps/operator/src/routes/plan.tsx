import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';
import { validatePlanSearch, type PlanSearch } from '../features/plan/search';

const PlanPage = lazyRouteComponent(() => import('../features/plan/PlanPage'), 'PlanScreen');

/**
 * The content plan (0362): marketing writes the month's ideas and sends them;
 * the owner approves the plan here. Marketing's landing screen (ROUTE_ROLES).
 */
export const planRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plan',
  validateSearch: (raw: Record<string, unknown>): PlanSearch => validatePlanSearch(raw),
  component: guarded('/plan', PlanPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
