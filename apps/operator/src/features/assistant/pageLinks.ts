/**
 * "Go to" buttons under an answer. The prompt tells the model to answer a
 * where-is question with the page's route (`/admin/day-close`); this finds
 * those routes in the text so the owner can open the page in one press
 * instead of reading a path and hunting for it in the rail.
 *
 * Only real pages become buttons: the caller passes a check against the
 * router, so a path the model made up, a URL, or `/2026` in a date never
 * does. Dynamic routes (`/desk/customers/$id`) are never matched, because
 * the model only ever sees handles, not ids.
 */
import { WORKSPACES, workspaceItems, type NavItem } from '../../lib/workspaces';

/** At most this many buttons; an answer that names more is a list, and the list is in the text. */
export const MAX_PAGE_LINKS = 3;

/**
 * A path: `/` then lowercase segments. Not after a letter, digit, `/`, `:` or
 * `.`, so `https://x.io/a`, `a/b` and `12/05` are skipped. Trailing sentence
 * punctuation is outside the character set, so `/stock/waste.` is `/stock/waste`.
 */
const PATH_RE = /(?<![\w/:.])\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*/g;

/** The routes the text names, in order, once each, that pass `isPage`. */
export function routesIn(text: string, isPage: (path: string) => boolean, max = MAX_PAGE_LINKS): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PATH_RE)) {
    const path = m[0];
    if (out.includes(path) || !isPage(path)) continue;
    out.push(path);
    if (out.length === max) break;
  }
  return out;
}

let navByPath: Map<string, NavItem> | null = null;

/** The rail row whose target is exactly `path`, for its label; null when the page has no row. */
export function navItemFor(path: string): NavItem | null {
  if (!navByPath) {
    navByPath = new Map();
    for (const ws of Object.values(WORKSPACES)) {
      for (const item of workspaceItems(ws)) if (!navByPath.has(item.to)) navByPath.set(item.to, item);
    }
  }
  return navByPath.get(path) ?? null;
}
