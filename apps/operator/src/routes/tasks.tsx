import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';
import { validateTasksSearch, type TasksSearch } from '../features/tasks/search';

const MyTasks = lazyRouteComponent(() => import('../features/tasks/MyTasks'), 'MyTasksScreen');

/**
 * My tasks: the protocol steps of every hireable role but management, its
 * starts, and a read-only copy of what each role does on the phone
 * (build-contracts-2026-09-23 §5.1, §5.4). The driver's and marketing's
 * landing screen, a rail row on the desk and the till, and the kitchen board's
 * "My tasks" button (ROUTE_ROLES).
 */
export const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  validateSearch: (raw: Record<string, unknown>): TasksSearch => validateTasksSearch(raw),
  component: guarded('/tasks', MyTasks),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
