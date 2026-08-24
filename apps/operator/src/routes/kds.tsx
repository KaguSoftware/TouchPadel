import { createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { KdsBoard } from '../features/kds/KdsBoard';

export const kdsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kds',
  component: () => (
    <RequireRole route="/kds">
      <KdsBoard />
    </RequireRole>
  ),
});
