import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const SetupHome = lazyRouteComponent(
  () => import('../features/admin/SetupHome'),
  'SetupHomeScreen',
);

/** Landing screen of the owner's Setup section (lib/workspaces.ts). */
export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: guarded('/setup', SetupHome),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
