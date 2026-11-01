/**
 * `/shop` LAYOUT route — the Touch Shop desk (0243–0246,
 * docs/design/shop/shop-desk-2026-09-27.md). Index = the shop till; children
 * = its drawer, the shop store's pages, products and suppliers. The shop
 * assistant holds this and nothing else; management opens it too.
 *
 * F-29: the till and the drawer take money, so they open on the shop station
 * only (lib/stationKind.ts). The store, products and suppliers stay open to
 * management on any machine: they move no cash.
 */
import { Outlet, createRoute, useRouterState } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { StationKindGate } from '../components/StationKindGate';
import { shopPathTakesMoney } from '../lib/stationKind';

function ShopLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <RequireRole route="/shop">
      {shopPathTakesMoney(path) ? (
        <StationKindGate screen="shopTill">
          <Outlet />
        </StationKindGate>
      ) : (
        <Outlet />
      )}
    </RequireRole>
  );
}

export const shopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shop',
  component: ShopLayout,
});
