/** Every /reports child route. Owned by the owner lane. */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { reportsRoute, reportsIndexRoute } from '../reports';
import { RoutePending, guarded } from '../admin/_shared';

const Revenue = lazyRouteComponent(() => import('../../features/reports/RevenueReport'), 'RevenueReportScreen');
const Courts = lazyRouteComponent(() => import('../../features/reports/CourtsReport'), 'CourtsReportScreen');
const Cafe = lazyRouteComponent(() => import('../../features/reports/CafeReport'), 'CafeReportScreen');
const Stock = lazyRouteComponent(() => import('../../features/reports/StockReport'), 'StockReportScreen');
const Staff = lazyRouteComponent(() => import('../../features/reports/StaffActivityReport'), 'StaffActivityReportScreen');

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
] as const;
