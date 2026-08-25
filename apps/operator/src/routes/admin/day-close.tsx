import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const DayClose = lazyRouteComponent(() => import('../../features/admin/DayClose'), 'DayClose');

export const adminDayCloseRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'day-close',
  component: guarded('/admin/day-close', DayClose),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
