/**
 * `/observation` LAYOUT route — the owner's view-only boards and inboxes
 * (bookings, open tabs, who is working, staff requests). Children attach in
 * main.tsx via routes/observation/_children.ts. `/observation` alone was the
 * owner's Floor now page; its "Needs you" list moved to the Overview (page
 * map, 2026-10-17), so it sends the owner there.
 */
import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';

export const observationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/observation',
  component: () => (
    <RequireRole route="/observation">
      <Outlet />
    </RequireRole>
  ),
});

export const observationIndexRoute = createRoute({
  getParentRoute: () => observationRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/panel', replace: true });
  },
});
