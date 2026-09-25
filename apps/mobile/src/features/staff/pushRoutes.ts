/**
 * The staff push routes the phone opens (build-contracts-2026-09-23 §2.21, §6.8).
 *
 * `send-push` puts `{kind, route, id}` in a staff notification's data. The one
 * list of routes is packages/db/supabase/functions/_shared/staff-push.json,
 * which `send-push` and `app.notify_staff` also read; the phone cannot import
 * it at runtime, so this copy is compared with it in
 * __tests__/pushRoutes.test.ts. A route the phone does not list is never
 * opened, whoever sent it.
 *
 * PURE (vitest).
 */

export const STAFF_PUSH_ROUTES = [
  'staff',
  'staff-step',
  'staff-run',
  'staff-request',
  'staff-shopping',
  'staff-checklist',
  'staff-notes',
] as const;

export type StaffPushRoute = (typeof STAFF_PUSH_ROUTES)[number];

/** Where a staff tap goes: a root-stack screen and its search params. */
export interface StaffHref {
  pathname: `/${StaffPushRoute}`;
  params?: Record<string, string>;
}

const ROUTES: readonly string[] = STAFF_PUSH_ROUTES;

export function isStaffPushRoute(value: unknown): value is StaffPushRoute {
  return typeof value === 'string' && ROUTES.includes(value);
}

/**
 * The screen a staff route opens, with the payload's `id` under the param that
 * screen reads (`/staff-step?id=`, `/staff-notes?itemId=`). A route that needs
 * an id and arrived without one opens Today instead of an empty page.
 */
export function staffPushHref(route: StaffPushRoute, id: string | null | undefined): StaffHref {
  const withId = (pathname: StaffHref['pathname'], param = 'id'): StaffHref =>
    id ? { pathname, params: { [param]: id } } : { pathname: '/staff' };
  switch (route) {
    case 'staff':
      return { pathname: '/staff' };
    case 'staff-shopping':
      return { pathname: '/staff-shopping' };
    case 'staff-step':
      return withId('/staff-step');
    case 'staff-run':
      return withId('/staff-run');
    case 'staff-checklist':
      return withId('/staff-checklist');
    case 'staff-notes':
      return withId('/staff-notes', 'itemId');
    case 'staff-request':
      // The request list opens either way; an id only says which one changed.
      return id ? { pathname: '/staff-request', params: { id } } : { pathname: '/staff-request' };
  }
}
