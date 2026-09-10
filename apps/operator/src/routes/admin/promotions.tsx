import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const PromotionsList = lazyRouteComponent(() => import('../../features/admin/promotions/PromotionsList'), 'PromotionsListScreen');
const PromotionEditor = lazyRouteComponent(() => import('../../features/admin/promotions/PromotionEditor'), 'PromotionEditorScreen');

/** Spec 06.26 — every promotion, active and inactive. No delete anywhere. */
export const adminPromotionsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'promotions',
  component: guarded('/admin/promotions', PromotionsList),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Spec 06.27 — one configurable promotion. `$id` may be `new`. */
export const adminPromotionEditorRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'promotions/$id',
  component: guarded('/admin/promotions', PromotionEditor),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
