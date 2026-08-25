import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const QrPage = lazyRouteComponent(() => import('../../features/admin/qr/QrPage'), 'QrPage');

export const adminQrRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'qr',
  component: guarded('/admin/qr', QrPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
