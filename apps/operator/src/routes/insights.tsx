import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';
import { validateSearch, type AnalyticsSearch } from '../features/analytics/search';

const InsightsPage = lazyRouteComponent(() => import('../features/insights/InsightsPage'), 'InsightsPageScreen');

/**
 * Insights (0360): the marketing role's view of the whole place, as levels,
 * trends and rounded shares. Marketing and the owner (ROUTE_ROLES). The
 * period and the comparison are the Analytics page's search params, parsed by
 * the same validator (the court filter is ignored here).
 */
export const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/insights',
  validateSearch: (raw: Record<string, unknown>): AnalyticsSearch => validateSearch(raw),
  component: guarded('/insights', InsightsPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
