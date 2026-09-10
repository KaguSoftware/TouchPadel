/** Every /observation child route. Owned by the owner lane. */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { observationRoute, observationIndexRoute } from '../observation';
import { RoutePending, guarded } from '../admin/_shared';

const StaffRequests = lazyRouteComponent(
  () => import('../../features/observation/StaffRequests'),
  'StaffRequestsScreen',
);

export const observationChildren = [
  observationIndexRoute,
  createRoute({
    getParentRoute: () => observationRoute,
    path: 'requests',
    component: guarded('/observation/requests', StaffRequests),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  }),
] as const;
