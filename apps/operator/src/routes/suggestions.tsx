import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const SuggestionsPage = lazyRouteComponent(() => import('../features/roleExtras/SuggestionsPage'), 'SuggestionsPageScreen');

/**
 * The staff suggestion box (role spec #63): every role posts on the phone,
 * management reads here and marks what it has seen. Manager and owner
 * (ROUTE_ROLES); no search params (build-contracts-2026-09-23 §5.1).
 */
export const suggestionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suggestions',
  component: guarded('/suggestions', SuggestionsPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
