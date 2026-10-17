/**
 * `/admin` LAYOUT route. It guards the subtree and renders the routed screen.
 *
 * It used to print a strip of sibling tabs above two families (the menu and
 * the guest app). Families now come from the rail (lib/workspaces.ts `tabs`)
 * and every family page shows its tabs under its own title
 * (components/FamilyTabs.tsx), so this layout draws nothing of its own.
 * Child routes live in routes/admin/*.tsx and attach in main.tsx via
 * routes/admin/_children.ts (no import cycle).
 */
import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: () => (
    <RequireRole route="/admin">
      <div style={{ minInlineSize: 0 }}>
        <Outlet />
      </div>
    </RequireRole>
  ),
});
