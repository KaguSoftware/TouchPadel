import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

// Gender hours (0353): courts kept for women or men at set times.
const GenderHoursEditor = lazyRouteComponent(
  () => import('../../features/admin/genderHours/GenderHoursEditor'),
  'GenderHoursEditor',
);

export const adminGenderHoursRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'gender-hours',
  component: guarded('/admin/gender-hours', GenderHoursEditor),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
