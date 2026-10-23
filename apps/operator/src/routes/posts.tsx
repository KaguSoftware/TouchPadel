import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { RoutePending, guarded } from './admin/_shared';
import { validatePostsSearch, type PostsSearch } from '../features/plan/search';

const PostsPage = lazyRouteComponent(() => import('../features/plan/PostsPage'), 'PostsScreen');

/** Sent for approval (0362): marketing's posts and plan results for the owner (0199). Marketing only. */
export const postsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/posts',
  validateSearch: (raw: Record<string, unknown>): PostsSearch => validatePostsSearch(raw),
  component: guarded('/posts', PostsPage),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
