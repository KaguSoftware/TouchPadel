import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const FilesPage = lazyRouteComponent(() => import('../features/files/FilesPage'), 'FilesPageScreen');

/**
 * Files (0354): the documents the owner and the managers keep, compressed
 * before they are stored, and read by the owner's assistant. Managers and the
 * owner (ROUTE_ROLES); no search params.
 */
export const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/files',
  component: guarded('/files', FilesPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
