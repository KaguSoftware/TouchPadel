import { createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { TillScreen } from '../features/till/TillScreen';

export const tillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/till',
  component: () => (
    <RequireRole route="/till">
      <TillScreen />
    </RequireRole>
  ),
});
