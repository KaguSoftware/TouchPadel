/** Every /analytics child route: the Courts and Cafe tabs. Owned by the analytics lane. */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { analyticsRoute, analyticsIndexRoute } from '../analytics';
import { RoutePending, guarded } from '../admin/_shared';

const CourtsTab = lazyRouteComponent(() => import('../../features/analytics/courts/CourtsTab'), 'CourtsTab');
const CafeTab = lazyRouteComponent(() => import('../../features/analytics/cafe/CafeTab'), 'CafeTab');

export const analyticsChildren = [
  analyticsIndexRoute,
  createRoute({
    getParentRoute: () => analyticsRoute,
    path: 'courts',
    component: guarded('/analytics', CourtsTab),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  }),
  createRoute({
    getParentRoute: () => analyticsRoute,
    path: 'cafe',
    component: guarded('/analytics', CafeTab),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  }),
] as const;
