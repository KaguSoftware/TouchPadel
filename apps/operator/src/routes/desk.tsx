/**
 * `/desk` LAYOUT route — the court desk workspace. The index child renders the
 * calendar (its historical path, kept for bookmarks and the e2e suite); the
 * other children are the desk screens of spec §06.1–06.10. Children attach in
 * main.tsx via routes/desk/_children.ts (no import cycle).
 */
import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';

export const deskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/desk',
  component: () => (
    <RequireRole route="/desk">
      <Outlet />
    </RequireRole>
  ),
});
