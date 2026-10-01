/** Every /reports child route. Owned by the owner lane. */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { reportsRoute, reportsIndexRoute } from '../reports';
import { RoutePending, guarded } from '../admin/_shared';

const Revenue = lazyRouteComponent(() => import('../../features/reports/RevenueReport'), 'RevenueReportScreen');
const Courts = lazyRouteComponent(() => import('../../features/reports/CourtsReport'), 'CourtsReportScreen');
const Cafe = lazyRouteComponent(() => import('../../features/reports/CafeReport'), 'CafeReportScreen');
const Stock = lazyRouteComponent(() => import('../../features/reports/StockReport'), 'StockReportScreen');
const Staff = lazyRouteComponent(() => import('../../features/reports/StaffActivityReport'), 'StaffActivityReportScreen');
const CoachPay = lazyRouteComponent(() => import('../../features/reports/coaches/CoachStatements'), 'CoachStatementsScreen');

const MONTH = /^\d{4}-\d{2}-01$/;
/** `/reports/coaches?month=YYYY-MM-01` (coaching operator.md §5.3.2): the month the stepper shows. */
export function validateCoachPaySearch(raw: Record<string, unknown>): { month?: string } {
  return typeof raw.month === 'string' && MONTH.test(raw.month) ? { month: raw.month } : {};
}

/**
 * Coach pay (coaching operator.md §5.16): monthly coach statements. It inherits
 * `/reports` (manager, owner) and is not one of the five reports, so it has
 * its own route (it validates `?month=`) and no ReportTabs strip.
 */
export const reportsCoachesRoute = createRoute({
  getParentRoute: () => reportsRoute,
  path: 'coaches',
  component: guarded('/reports', CoachPay),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateCoachPaySearch,
});

const child = <P extends string>(path: P, guardRoute: string, Component: Parameters<typeof guarded>[1]) =>
  createRoute({
    getParentRoute: () => reportsRoute,
    path,
    component: guarded(guardRoute, Component),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  });

export const reportsChildren = [
  reportsIndexRoute,
  child('revenue', '/reports/revenue', Revenue),
  child('courts', '/reports', Courts),
  child('cafe', '/reports', Cafe),
  child('stock', '/reports', Stock),
  child('staff', '/reports', Staff),
  reportsCoachesRoute,
] as const;
