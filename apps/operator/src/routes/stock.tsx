import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';

// Module 5 — stock & recipes (SOW L515-547). Lazy children under one guard.
// The stock pages are listed by the Stock section's rail and, within a
// family, by the tabs under each page's title (lib/workspaces.ts STOCK), so
// this layout prints no sub-nav of its own.
export const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock',
  component: StockShellGuarded,
});

function StockShellGuarded() {
  return (
    <RequireRole route="/stock">
      <div style={{ minInlineSize: 0 }}>
        <Outlet />
      </div>
    </RequireRole>
  );
}
