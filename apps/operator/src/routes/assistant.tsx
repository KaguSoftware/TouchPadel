/**
 * `/assistant` LAYOUT route — the owner assistant (docs/design/assistant).
 * Children attach in main.tsx via routes/assistant/_children.ts.
 *
 * The list-and-thread page is rendered HERE, by the layout, for both `/` and
 * `$id`: the first question creates the conversation and moves the URL to
 * `/assistant/<id>`, and a route-component swap at that moment would unmount
 * the thread and abort the stream it is reading. Only `/assistant/usage`
 * renders the outlet.
 */
import { Outlet, createRoute, lazyRouteComponent, useRouterState } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { RoutePending } from './admin/_shared';
import { UnderConstruction } from '../features/assistant/UnderConstruction'; // TEMP under-construction

const AssistantPage = lazyRouteComponent(() => import('../features/assistant/AssistantPage'), 'AssistantPageScreen');

function AssistantLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isUsage = /\/assistant\/usage\/?$/.test(path);
  return <RequireRole route="/assistant"><UnderConstruction>{isUsage ? <Outlet /> : <AssistantPage />}</UnderConstruction></RequireRole>; // TEMP under-construction
}

export const assistantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assistant',
  component: AssistantLayout,
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** `/assistant` — a new chat. The layout draws the screen; this only matches. */
export const assistantIndexRoute = createRoute({
  getParentRoute: () => assistantRoute,
  path: '/',
  component: () => null,
});
