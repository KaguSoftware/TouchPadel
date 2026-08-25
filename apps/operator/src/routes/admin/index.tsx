import { createRoute, redirect } from '@tanstack/react-router';
import { adminRoute } from '../admin';

// `/admin` alone → first section.
export const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/admin/menu', replace: true });
  },
});
