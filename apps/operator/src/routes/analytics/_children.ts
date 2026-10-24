/** Every /analytics child route: the Courts, Cafe and People tabs. Owned by the analytics lane. */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { analyticsRoute, analyticsIndexRoute } from '../analytics';
import { RoutePending, guarded } from '../admin/_shared';

const CourtsTab = lazyRouteComponent(() => import('../../features/analytics/courts/CourtsTab'), 'CourtsTab');
const CafeTab = lazyRouteComponent(() => import('../../features/analytics/cafe/CafeTab'), 'CafeTab');
const PeopleTab = lazyRouteComponent(() => import('../../features/analytics/people/PeopleTab'), 'PeopleTab');

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
  createRoute({
    getParentRoute: () => analyticsRoute,
    path: 'people',
    component: guarded('/analytics', PeopleTab),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  }),
] as const;
