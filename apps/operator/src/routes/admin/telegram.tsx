import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

const TelegramSettings = lazyRouteComponent(
  () => import('../../features/admin/telegram/TelegramSettings'),
  'TelegramSettings',
);

export const adminTelegramRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'telegram',
  component: guarded('/admin/telegram', TelegramSettings),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
