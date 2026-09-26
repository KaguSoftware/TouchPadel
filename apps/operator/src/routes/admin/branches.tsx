import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

// Setup › Branches (multi-venue slice 4): the owner's branches and "Open a new branch".
const BranchesAdmin = lazyRouteComponent(
  () => import('../../features/admin/branches/BranchesAdmin'),
  'BranchesAdmin',
);

export const adminBranchesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'branches',
  component: guarded('/admin/branches', BranchesAdmin),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
