import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

// Lazy: the viewer is opened when someone is investigating, not on every shift.
const AuditLog = lazyRouteComponent(
  () => import('../../features/admin/audit/AuditLog'),
  'AuditLog',
);

export const adminAuditRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'audit',
  component: guarded('/admin/audit', AuditLog),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
