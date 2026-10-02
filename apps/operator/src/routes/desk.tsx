/**
 * `/desk` LAYOUT route — the court desk workspace. The index child renders the
 * calendar (its historical path, kept for bookmarks and the e2e suite); the
 * other children are the desk screens of spec §06.1–06.10. Children attach in
 * main.tsx via routes/desk/_children.ts (no import cycle).
 *
 * The layout asks about the path it is showing, not about `/desk`: the
 * customers screens are the till's too (ROUTE_ROLES `/desk/customers`, the
 * cashier's Customers row; coaching R20 takes lesson money from the record),
 * and a fixed `/desk` guard turned the cashier away from them. Each child
 * keeps its own explicit guard (routes/desk/_children.ts).
 */
import { Outlet, createRoute, useLocation } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';

function DeskLayout() {
  const { pathname } = useLocation();
  return (
    <RequireRole route={pathname}>
      <Outlet />
    </RequireRole>
  );
}

export const deskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/desk',
  component: DeskLayout,
});
