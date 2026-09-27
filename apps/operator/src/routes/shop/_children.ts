/**
 * Every /shop child route, in rail order. Attached in main.tsx
 * (`shopRoute.addChildren(shopChildren)`) — the /till pattern.
 */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { shopRoute } from '../shop';
import { RoutePending, guarded } from '../admin/_shared';

const ShopTill = lazyRouteComponent(() => import('../../features/shop/ShopTill'), 'ShopTill');
const CashDrawer = lazyRouteComponent(() => import('../../features/till/CashDrawer'), 'CashDrawerScreen');
const ShopStock = lazyRouteComponent(() => import('../../features/shop/ShopStockPages'), 'ShopStock');
const ShopReceive = lazyRouteComponent(() => import('../../features/shop/ShopStockPages'), 'ShopReceive');
const ShopCounts = lazyRouteComponent(() => import('../../features/shop/ShopStockPages'), 'ShopCounts');
const ShopWaste = lazyRouteComponent(() => import('../../features/shop/ShopStockPages'), 'ShopWaste');
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
    getParentRoute: () => shopRoute,
    path,
    component: guarded('/shop', Component),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  });

export const shopIndexRoute = createRoute({
  getParentRoute: () => shopRoute,
  path: '/',
  component: guarded('/shop', ShopTill),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

export const shopChildren = [
  shopIndexRoute,
  child('drawer', CashDrawer),
  child('stock', ShopStock),
  child('receive', ShopReceive),
  child('counts', ShopCounts),
  child('waste', ShopWaste),
  child('products', ProductsAdmin),
  child('suppliers', SuppliersAdmin),
] as const;
