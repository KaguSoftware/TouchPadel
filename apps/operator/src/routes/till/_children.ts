/** Every /till child route. Owned by the cashier lane. */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { tillRoute } from '../till';
import { RoutePending, guarded } from '../admin/_shared';
import { validateTillSearch, type TillSearch } from '../../features/till/tillSearch';

const TillScreen = lazyRouteComponent(() => import('../../features/till/TillScreen'), 'TillScreen');
const OpenTabs = lazyRouteComponent(() => import('../../features/till/OpenTabs'), 'OpenTabsScreen');
const CashDrawer = lazyRouteComponent(() => import('../../features/till/CashDrawer'), 'CashDrawerScreen');

const child = <P extends string>(path: P, Component: Parameters<typeof guarded>[1]) =>
  createRoute({
    getParentRoute: () => tillRoute,
    path,
    component: guarded('/till', Component),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  });

/**
 * The till index accepts `?tab=<uuid>` (open with that tab selected — from
 * the open-tabs board) and `?reservation=<uuid>` (open the new-tab dialog
 * pre-bound to that booking — from the desk). Anything else is dropped.
 */
export const tillIndexRoute = createRoute({
  getParentRoute: () => tillRoute,
  path: '/',
  validateSearch: (raw: Record<string, unknown>): TillSearch => validateTillSearch(raw),
  component: guarded('/till', TillScreen),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

export const tillChildren = [tillIndexRoute, child('tabs', OpenTabs), child('drawer', CashDrawer)] as const;
