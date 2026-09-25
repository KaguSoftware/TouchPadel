/**
 * `/tasks` search params — hand parser, the /protocols shape (features/protocols/search.ts).
 *   ?step=<uuid>                   open one of my steps (the kitchen board, a
 *                                  way back from the desk's event blocks)
 *   ?start=product_release|price_promo|tournament
 *                                  open that start form, when the role may start it
 *   ?idea=<uuid>                   with start=product_release: start from a team idea
 * Anything malformed is dropped, so a mangled link lands on the plain page.
 */
export const TASK_STARTS = ['product_release', 'price_promo', 'tournament'] as const;
export type TaskStart = (typeof TASK_STARTS)[number];

export interface TasksSearch {
  step?: string;
  start?: TaskStart;
  idea?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(v: unknown): string | undefined {
  return typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : undefined;
}

export function validateTasksSearch(raw: Record<string, unknown>): TasksSearch {
  const out: TasksSearch = {};
  const step = uuid(raw.step);
  const idea = uuid(raw.idea);
  const start = typeof raw.start === 'string' && (TASK_STARTS as readonly string[]).includes(raw.start) ? (raw.start as TaskStart) : undefined;
  if (step) out.step = step;
  if (start) out.start = start;
  // An idea is only ever a new item's starting point.
  if (idea && start === 'product_release') out.idea = idea;
  return out;
}
