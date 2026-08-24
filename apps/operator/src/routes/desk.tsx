import { createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { DeskCalendar } from '../features/desk/DeskCalendar';

export const deskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/desk',
  component: () => (
    <RequireRole route="/desk">
      <DeskCalendar />
    </RequireRole>
  ),
});
