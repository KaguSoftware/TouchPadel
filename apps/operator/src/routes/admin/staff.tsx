import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const StaffList = lazyRouteComponent(
  () => import('../../features/admin/staff/StaffList'),
  'StaffList',
);

export const adminStaffRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'staff',
  component: guarded('/admin/staff', StaffList),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
