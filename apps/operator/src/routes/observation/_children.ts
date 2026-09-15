/** Every /observation child route. Owned by the owner lane. */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { observationRoute, observationIndexRoute } from '../observation';
import { RoutePending, guarded } from '../admin/_shared';

const StaffRequests = lazyRouteComponent(() => import('../../features/observation/StaffRequests'), 'StaffRequestsScreen');
const CourtsObserve = lazyRouteComponent(() => import('../../features/observation/courts/CourtsObserve'), 'CourtsObserveScreen');
const TillsObserve = lazyRouteComponent(() => import('../../features/observation/tills/TillsObserve'), 'TillsObserveScreen');

export const observationChildren = [
  observationIndexRoute,
  createRoute({
    getParentRoute: () => observationRoute,
    path: 'requests',
    component: guarded('/observation/requests', StaffRequests),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  }),
  createRoute({
    getParentRoute: () => observationRoute,
    path: 'courts',
    component: guarded('/observation/courts', CourtsObserve),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  }),
  createRoute({
    getParentRoute: () => observationRoute,
    path: 'tills',
    component: guarded('/observation/tills', TillsObserve),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  }),
] as const;
