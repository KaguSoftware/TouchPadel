import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';
import { isPromotionFilter, type PromotionLifecycle } from '../../features/admin/promotions/promotionLogic';

const PromotionsList = lazyRouteComponent(() => import('../../features/admin/promotions/PromotionsList'), 'PromotionsListScreen');
const PromotionEditor = lazyRouteComponent(() => import('../../features/admin/promotions/PromotionEditor'), 'PromotionEditorScreen');

/**
 * Spec 06.26 — every promotion, active and inactive. No delete anywhere.
 * `?show=live|scheduled|disabled|expired` keeps the list's filter in the URL,
 * so coming Back from a promotion lands on the same filtered list.
 */
export const adminPromotionsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'promotions',
  component: guarded('/admin/promotions', PromotionsList),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: (raw: Record<string, unknown>): { show?: PromotionLifecycle } =>
    isPromotionFilter(raw.show) && raw.show !== 'all' ? { show: raw.show } : {},
});

/** Spec 06.27 — one configurable promotion. `$id` may be `new`. */
export const adminPromotionEditorRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'promotions/$id',
  component: guarded('/admin/promotions', PromotionEditor),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
