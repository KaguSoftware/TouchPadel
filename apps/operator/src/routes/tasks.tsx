import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';

const MyTasks = lazyRouteComponent(() => import('../features/tasks/MyTasks'), 'MyTasksScreen');

/** Landing screen of the team workspace: driver and marketing (ROUTE_ROLES). */
export const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: guarded('/tasks', MyTasks),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
