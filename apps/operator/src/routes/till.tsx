/**
 * `/till` LAYOUT route — the cashier workspace. Index = the till itself
 * (spec 06.11); children = open tabs (06.12) and the cash drawer (06.19).
 */
import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';

export const tillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/till',
  component: () => (
    <RequireRole route="/till">
      <Outlet />
    </RequireRole>
  ),
});
