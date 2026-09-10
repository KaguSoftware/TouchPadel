// Owner-only (ROUTE_ROLES): exposes item costs/margins and each AI re-check bills Groq.
// `lazyRouteComponent` keeps Recharts (and the whole analytics feature) out of the
// main bundle, so a till or KDS station never downloads a charting library.
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { validateSearch, type AnalyticsSearch } from '../features/analytics/search';

const LazyAnalyticsPage = lazyRouteComponent(() => import('../features/analytics/AnalyticsPage'), 'AnalyticsPage');

export const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics',
  validateSearch: (raw: Record<string, unknown>): AnalyticsSearch => validateSearch(raw),
  component: () => (
    <RequireRole route="/analytics">
      <LazyAnalyticsPage />
    </RequireRole>
  ),
});
