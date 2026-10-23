/**
 * `/plan` and `/posts` search params, hand-parsed like /tasks
 * (features/tasks/search.ts). Anything malformed is dropped, so a mangled link
 * lands on the plain page.
 *   /plan?month=YYYY-MM     the month shown (default: the branch's current one,
 *                           or for the owner the oldest month waiting on them)
 *   /plan?day=YYYY-MM-DD    the day open beside the calendar
 *   /plan?view=list         every idea of the month in one list
 *   /posts?open=<uuid>      open that content item's sheet
 */
export const PLAN_VIEWS = ['calendar', 'list'] as const;
export type PlanView = (typeof PLAN_VIEWS)[number];

export interface PlanSearch {
  month?: string;
  day?: string;
  view?: PlanView;
}

export interface PostsSearch {
  open?: string;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validatePlanSearch(raw: Record<string, unknown>): PlanSearch {
  const out: PlanSearch = {};
  if (typeof raw.month === 'string' && MONTH_RE.test(raw.month)) out.month = raw.month;
  if (typeof raw.day === 'string' && DAY_RE.test(raw.day)) out.day = raw.day;
  if (typeof raw.view === 'string' && (PLAN_VIEWS as readonly string[]).includes(raw.view)) out.view = raw.view as PlanView;
  // A day outside the month shown means nothing there.
  if (out.day && out.month && !out.day.startsWith(out.month)) delete out.day;
  return out;
}

export function validatePostsSearch(raw: Record<string, unknown>): PostsSearch {
  return typeof raw.open === 'string' && UUID_RE.test(raw.open) ? { open: raw.open.toLowerCase() } : {};
}
