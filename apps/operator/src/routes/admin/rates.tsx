import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const RateRuleEditor = lazyRouteComponent(
  () => import('../../features/admin/RateRuleEditor'),
  'RateRuleEditor',
);

export const adminRatesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'rates',
  component: guarded('/admin/rates', RateRuleEditor),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
