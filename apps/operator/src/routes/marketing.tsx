import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const MarketingPanel = lazyRouteComponent(() => import('../features/marketing/MarketingPanel'), 'MarketingPanelScreen');

/** Campaigns and what they returned. Owner-only (ROUTE_ROLES). */
export const marketingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/marketing',
  component: guarded('/marketing', MarketingPanel),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
