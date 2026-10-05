import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

// Setup › Loyalty (docs/design/loyalty/build-contracts-2026-10-05.md §5): the owner's points
// settings, tiers and rewards, business-wide.
const LoyaltySetup = lazyRouteComponent(
  () => import('../../features/loyalty/LoyaltySetup'),
  'LoyaltySetupScreen',
);

export const adminLoyaltyRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'loyalty',
  component: guarded('/admin/loyalty', LoyaltySetup),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
