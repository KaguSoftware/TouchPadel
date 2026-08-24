import { createRoute, Navigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, homeRoute } from '../lib/auth';
import { useLocale } from '../lib/i18n';

// Landing: redirect to the signed-in role's home module.
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexRedirect,
});

function IndexRedirect() {
  const { staff } = useAuth();
  const { tr } = useLocale();
  if (!staff) return <p>{tr('common.loading')}</p>;
  return <Navigate to={homeRoute(staff.role)} />;
}
