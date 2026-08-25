// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/analytics/AnalyticsPage
// (mount it with lazyRouteComponent so the Recharts chunk never loads on a till/KDS station).
import { createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { ComingSoon } from '../components/ComingSoon';

// Owner-only (ROUTE_ROLES): exposes item costs/margins and each recheck bills Groq.
export const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics',
  component: () => (
    <RequireRole route="/analytics">
      <ComingSoon titleKey="analytics.title" />
    </RequireRole>
  ),
});
