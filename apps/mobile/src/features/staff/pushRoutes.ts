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
  'staff-rewards',
] as const;

export type StaffPushRoute = (typeof STAFF_PUSH_ROUTES)[number];

/** Where a staff tap goes: a staff screen and its search params. */
export interface StaffHref {
  pathname: `/${StaffPushRoute}` | `/${TitleKeyPage}`;
  params?: Record<string, string>;
}

/**
 * The page a staff push about one thing opens when its route is only `staff`
 * (Today): most of the role-spec and wave 5 pushes send route `staff`, so the
 * tap used to land on Today instead of the page the push is about (F-59).
 * `send-push` puts the push's `title_key` in the data beside the route
 * (packages/db/supabase/functions/send-push/staffStrings.ts); a phone that
 * gets one listed here opens its page. A key not listed (an operator matter
 * such as a supplier price or a loyalty gift) still opens Today, and so does
 * a push from a send-push that sends no title_key yet.
 *
 * Each page's own RequireStaff still decides: a role it is not for, or a page
 * the owner blocked for the person, goes back to Today.
 */
export const STAFF_TITLE_KEY_PAGES = {
  idea_submitted: 'staff-ideas',
  idea_started: 'staff-ideas',
  idea_declined: 'staff-ideas',
  teaching_new: 'staff-teachings',
  recipe_change_submitted: 'staff-recipe-change',
  recipe_change_approved: 'staff-recipe-change',
  recipe_change_declined: 'staff-recipe-change',
  marketing_request_new: 'staff-marketing-requests',
  marketing_request_answered: 'staff-marketing-requests',
  deduction_proposed: 'staff-deductions',
  deduction_approved: 'staff-deductions',
  deduction_declined: 'staff-deductions',
  deduction_recorded: 'staff-deductions',
  incident_reported: 'staff-incidents',
  incident_reviewed: 'staff-incidents',
  content_submitted: 'staff-content',
  content_approved: 'staff-content',
  content_changes: 'staff-content',
  content_declined: 'staff-content',
  plan_submitted: 'staff-content',
  plan_approved: 'staff-content',
  plan_changes: 'staff-content',
  waiter_call_new: 'staff-calls',
  screenshot_taken: 'staff-screenshots',
  shopping_new: 'staff-shopping',
  shopping_to_approve: 'staff-shopping',
  shopping_declined: 'staff-shopping',
  request_submitted: 'staff-request',
  request_approved: 'staff-request',
  request_rejected: 'staff-request',
  checklist_due: 'staff-work',
  checklist_overdue: 'staff-work',
  reward_unlocked: 'staff-rewards',
} as const;

type TitleKeyPage = (typeof STAFF_TITLE_KEY_PAGES)[keyof typeof STAFF_TITLE_KEY_PAGES];

/** The page a title key opens, or null for a key that has none (Today is right for it). */
export function titleKeyHref(titleKey: unknown): StaffHref | null {
  if (typeof titleKey !== 'string' || !Object.prototype.hasOwnProperty.call(STAFF_TITLE_KEY_PAGES, titleKey)) {
    return null;
  }
  return { pathname: `/${STAFF_TITLE_KEY_PAGES[titleKey as keyof typeof STAFF_TITLE_KEY_PAGES]}` };
}

const ROUTES: readonly string[] = STAFF_PUSH_ROUTES;

export function isStaffPushRoute(value: unknown): value is StaffPushRoute {
  return typeof value === 'string' && ROUTES.includes(value);
}

/**
 * The screen a staff route opens, with the payload's `id` under the param that
 * screen reads (`/staff-step?id=`, `/staff-notes?itemId=`). A route that needs
 * an id and arrived without one opens the title key's page (or Today) instead
 * of an empty page; route `staff` opens the title key's page when it has one
 * (STAFF_TITLE_KEY_PAGES), else Today.
 */
export function staffPushHref(
  route: StaffPushRoute,
  id: string | null | undefined,
  titleKey?: unknown,
): StaffHref {
  const today: StaffHref = titleKeyHref(titleKey) ?? { pathname: '/staff' };
  const withId = (pathname: StaffHref['pathname'], param = 'id'): StaffHref =>
    id ? { pathname, params: { [param]: id } } : today;
  switch (route) {
    case 'staff':
      return today;
    case 'staff-shopping':
      return { pathname: '/staff-shopping' };
    case 'staff-rewards':
      // A reward unlocked (0333): the person's own page, which needs no id.
      return { pathname: '/staff-rewards' };
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
