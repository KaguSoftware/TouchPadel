import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

// Setup › Coaches (docs/design/coaching/operator.md §5.13): coaches, lesson
// types and hours, one tab each (`?tab=`).
const CoachesAdmin = lazyRouteComponent(
  () => import('../../features/admin/coaches/CoachesAdmin'),
  'CoachesAdmin',
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidParam(v: unknown): string | undefined {
  return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : undefined;
}

export type CoachesTab = 'coaches' | 'types' | 'hours';

export interface CoachesSearch {
  tab?: CoachesTab;
  /** Opens that coach's editor (Coaches) or picks the coach (Hours). */
  coach?: string;
  /** Opens "Make a coach" with that customer picked (the record's Make coach). */
  promote?: string;
  /** Opens that lesson type (Lesson types). */
  type?: string;
}

/** `/admin/coaches?tab=…&coach=…&promote=…&type=…` (§5.3.2). */
export function validateCoachesSearch(raw: Record<string, unknown>): CoachesSearch {
  const tab =
    raw.tab === 'coaches' || raw.tab === 'types' || raw.tab === 'hours' ? raw.tab : undefined;
  const coach = uuidParam(raw.coach);
  const promote = uuidParam(raw.promote);
  const type = uuidParam(raw.type);
  return {
    ...(tab ? { tab } : {}),
    ...(coach ? { coach } : {}),
    ...(promote ? { promote } : {}),
    ...(type ? { type } : {}),
  };
}

export const adminCoachesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'coaches',
  component: guarded('/admin/coaches', CoachesAdmin),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateCoachesSearch,
});
