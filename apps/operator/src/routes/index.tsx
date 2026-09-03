import { createRoute, Navigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, homeRoute } from '../lib/auth';
import { hasStoredWorkspace, workspacesForRole } from '../lib/workspaces';
import { Spinner } from '../components/ui';

// Landing: a single-role account goes straight to its workspace home; an
// account holding more than one role is presented with the switcher the first
// time on this station (spec §05 WorkspaceSwitcherScreen), then remembered.
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexRedirect,
});

function IndexRedirect() {
  const { staff } = useAuth();
  if (!staff) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minBlockSize: '40vh' }}>
        <Spinner size="md" />
      </div>
    );
  }
  const multi = workspacesForRole(staff.role).length > 1;
  if (multi && !hasStoredWorkspace()) return <Navigate to="/workspaces" replace />;
  return <Navigate to={homeRoute(staff.role)} replace />;
}
