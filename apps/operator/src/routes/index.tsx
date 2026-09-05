import { createRoute, Navigate } from '@tanstack/react-router';
import { rootRoute, AppBootScreen } from './__root';
import { useAuth, homeRoute } from '../lib/auth';
import { hasStoredWorkspace, workspacesForRole } from '../lib/workspaces';

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
  // The same wait as the shell's, so it gets the shell's screen. This used to
  // be a naked Spinner in a 40vh grid — a second, plainer face for boot, two
  // components away from AppBootScreen doing the identical job, and the first
  // thing a staff member sees on every cold start.
  if (!staff) return <AppBootScreen />;
  const multi = workspacesForRole(staff.role).length > 1;
  if (multi && !hasStoredWorkspace()) return <Navigate to="/workspaces" replace />;
  return <Navigate to={homeRoute(staff.role)} replace />;
}
