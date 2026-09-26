/**
 * `/analytics` LAYOUT route — Management's Analytics, on the workspace's own
 * rail with two tabs, /analytics/courts and /analytics/cafe (children attach
 * in main.tsx via routes/analytics/_children.ts).
 *
 * Owner-only (ROUTE_ROLES): it exposes item costs/margins and each AI re-check
 * bills Groq. The search params (range, dates, compare basis, court filter)
 * are validated here once and inherited by both tabs, so switching tabs keeps
 * the owner on the same period. Each tab is a `lazyRouteComponent`, which
 * keeps Recharts (and the whole analytics feature) out of the main bundle, so
 * a till or KDS station never downloads a charting library.
 */
import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { ReportBranchScope } from '../features/reports/ReportBranchScope';
import { validateSearch, type AnalyticsSearch } from '../features/analytics/search';

export const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics',
  validateSearch: (raw: Record<string, unknown>): AnalyticsSearch => validateSearch(raw),
  component: () => (
    <RequireRole route="/analytics">
      {/* Multi-venue slice 4 (MV8): the owner may widen these pages to every branch. */}
      <ReportBranchScope />
      <Outlet />
    </RequireRole>
  ),
});

/** `/analytics` alone → the Courts tab, carrying the search params along. */
export const analyticsIndexRoute = createRoute({
  getParentRoute: () => analyticsRoute,
  path: '/',
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/analytics/courts', search, replace: true });
  },
});
