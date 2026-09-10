import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const ManagementPanel = lazyRouteComponent(() => import('../features/panel/ManagementPanel'), 'ManagementPanelScreen');

/** The owner's landing screen (spec 06.39). Reports, never writes. */
export const panelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/panel',
  component: guarded('/panel', ManagementPanel),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
