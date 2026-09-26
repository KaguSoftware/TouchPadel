/** Every /assistant child route. Owned by the owner lane. */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { assistantRoute, assistantIndexRoute } from '../assistant';
import { RoutePending, guarded } from '../admin/_shared';

const UsagePage = lazyRouteComponent(() => import('../../features/assistant/UsagePage'), 'UsagePageScreen');

export const assistantChildren = [
  assistantIndexRoute,
  // One conversation. The layout renders the page and reads `$id` itself.
  createRoute({
    getParentRoute: () => assistantRoute,
    path: '$id',
    component: () => null,
  }),
  createRoute({
    getParentRoute: () => assistantRoute,
    path: 'usage',
    component: guarded('/assistant/usage', UsagePage),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  }),
] as const;
