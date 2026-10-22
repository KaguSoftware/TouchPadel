import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

// Customers › Player ranks (0364): the owner's rules and levels, the public board, results and
// points by hand. A manager reads the rules and works the results.
const Ranks = lazyRouteComponent(() => import('../../features/ranks/RanksScreen'), 'RanksScreen');

export const adminRanksRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'ranks',
  component: guarded('/admin/ranks', Ranks),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
