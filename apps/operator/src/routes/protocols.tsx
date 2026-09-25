import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';
import { validateProtocolsSearch, type ProtocolsSearch } from '../features/protocols/search';

const ProtocolsPage = lazyRouteComponent(() => import('../features/protocols/ProtocolsPage'), 'ProtocolsPageScreen');

/**
 * The four protocols and the runs waiting on management. Manager and owner
 * (ROUTE_ROLES). The search params are validated here, so every screen that
 * links in (?start=, ?run=, a price or promo prefill) is type-checked against
 * one shape (build-contracts-2026-09-23 §5.1).
 */
export const protocolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/protocols',
  validateSearch: (raw: Record<string, unknown>): ProtocolsSearch => validateProtocolsSearch(raw),
  component: guarded('/protocols', ProtocolsPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
