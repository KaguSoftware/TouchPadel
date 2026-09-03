/**
 * `/reports` LAYOUT route — owner and manager reporting (spec 06.40–06.44).
 * Children attach in main.tsx via routes/reports/_children.ts.
 */
import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';

export const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: () => (
    <RequireRole route="/reports">
      <Outlet />
    </RequireRole>
  ),
});

/** `/reports` alone → the first report the role can open (courts is manager+owner). */
export const reportsIndexRoute = createRoute({
  getParentRoute: () => reportsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/reports/courts', replace: true });
  },
});
