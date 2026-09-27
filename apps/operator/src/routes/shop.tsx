/**
 * `/shop` LAYOUT route — the Touch Shop desk (0243–0246,
 * docs/design/shop/shop-desk-2026-09-27.md). Index = the shop till; children
 * = its drawer, the shop store's pages, products and suppliers. The shop
 * assistant holds this and nothing else; management opens it too.
 */
import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';

export const shopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shop',
  component: () => (
    <RequireRole route="/shop">
      <Outlet />
    </RequireRole>
  ),
});
