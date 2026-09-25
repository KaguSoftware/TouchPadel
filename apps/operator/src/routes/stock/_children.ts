/**
 * Every /stock child route, in sub-nav order. Attached in main.tsx
 * (`stockRoute.addChildren(stockChildren)`) — same no-cycle pattern as /admin.
 */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { stockRoute } from '../stock';
import { RoutePending, guarded } from '../admin/_shared';

const OnHand = lazyRouteComponent(() => import('../../features/stock/OnHand'), 'OnHand');
const IngredientsAdmin = lazyRouteComponent(
  () => import('../../features/stock/IngredientsAdmin'),
  'IngredientsAdmin',
);
const ReceiveDelivery = lazyRouteComponent(
  () => import('../../features/stock/ReceiveDelivery'),
  'ReceiveDelivery',
);
const WasteAndProduction = lazyRouteComponent(
  () => import('../../features/stock/WasteAndProduction'),
  'WasteAndProduction',
);
const RecipeEditor = lazyRouteComponent(
  () => import('../../features/stock/RecipeEditor'),
  'RecipeEditor',
);
const CountScreen = lazyRouteComponent(
  () => import('../../features/stock/CountScreen'),
  'CountScreen',
);
const VarianceReport = lazyRouteComponent(
  () => import('../../features/stock/VarianceReport'),
  'VarianceReport',
);
const Margins = lazyRouteComponent(() => import('../../features/stock/Margins'), 'Margins');
const AlertsPanel = lazyRouteComponent(
  () => import('../../features/stock/AlertsPanel'),
  'AlertsPanel',
);
const Expiry = lazyRouteComponent(() => import('../../features/stock/Expiry'), 'Expiry');
const ProductsAdmin = lazyRouteComponent(
  () => import('../../features/stock/products/ProductsAdmin'),
  'ProductsAdmin',
);
const SuppliersAdmin = lazyRouteComponent(
  () => import('../../features/stock/products/SuppliersAdmin'),
  'SuppliersAdmin',
);

const child = <P extends string>(path: P, Component: Parameters<typeof guarded>[1]) =>
  createRoute({
    getParentRoute: () => stockRoute,
    path,
    component: guarded('/stock', Component),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  });

export const stockIndexRoute = createRoute({
  getParentRoute: () => stockRoute,
  path: '/',
  component: guarded('/stock', OnHand),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Goods in opened on one of the driver's purchases (build-contracts-2026-09-23
 * §5.1): `?purchase=<id>`. Anything else is dropped, so a mangled link lands
 * on the ordinary Goods in form.
 */
export function validateReceiveSearch(raw: Record<string, unknown>): { purchase?: string } {
  return typeof raw.purchase === 'string' && UUID_RE.test(raw.purchase) ? { purchase: raw.purchase.toLowerCase() } : {};
}

export const stockReceiveRoute = createRoute({
  getParentRoute: () => stockRoute,
  path: 'receive',
  component: guarded('/stock', ReceiveDelivery),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateReceiveSearch,
});

export const stockChildren = [
  stockIndexRoute,
  child('ingredients', IngredientsAdmin),
  stockReceiveRoute,
  child('waste', WasteAndProduction),
  child('recipes', RecipeEditor),
  child('counts', CountScreen),
  child('variance', VarianceReport),
  child('margins', Margins),
  child('alerts', AlertsPanel),
  child('expiry', Expiry),
  child('products', ProductsAdmin),
  child('suppliers', SuppliersAdmin),
] as const;
