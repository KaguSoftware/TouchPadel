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

export const stockChildren = [
  stockIndexRoute,
  child('ingredients', IngredientsAdmin),
  child('receive', ReceiveDelivery),
  child('waste', WasteAndProduction),
  child('recipes', RecipeEditor),
  child('counts', CountScreen),
  child('variance', VarianceReport),
  child('margins', Margins),
  child('alerts', AlertsPanel),
  child('expiry', Expiry),
] as const;
