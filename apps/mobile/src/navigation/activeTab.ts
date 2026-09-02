/**
 * Which tab is selected underneath the current screen.
 *
 * Needed by the language switch: reloading the bundle rebuilds the tabs at
 * their DEFAULT (Book), so a switch made in Settings — which is reached from
 * Profile — used to leave the user backing out into a tab they had never been
 * on. Parking the active tab alongside the destination lets the restore put
 * Profile back underneath, so back and edge-swipe behave as they did before.
 *
 * Read from the navigation state rather than the pathname, because the pathname
 * of a PUSHED screen ('/settings') says nothing about the tab beneath it.
 */

/** The shape we care about; react-navigation's own state is wider. */
export interface NavStateLike {
  index?: number;
  routes?: { name?: string; state?: NavStateLike }[];
}

/** The tabs group as it appears in the route tree. */
const TABS_ROUTE = '(tabs)';

/**
 * The tab route's own file name maps to its href: `index` is the group root
 * ('/'), anything else is a sibling ('/profile'). Kept here rather than at the
 * call site so the mapping is tested in one place.
 */
export function tabHref(name: string): string {
  return name === 'index' ? '/' : `/${name}`;
}

/**
 * Depth-first search for the tabs navigator, then the name of its selected
 * route. Returns null when the tabs are not mounted (an auth screen, a deep
 * link straight into a pushed route) — the caller then parks no tab, and the
 * restore falls back to the default.
 */
export function activeTabHref(state: NavStateLike | null | undefined): string | null {
  const tabs = findTabsState(state);
  if (!tabs?.routes?.length) return null;
  const index = tabs.index ?? 0;
  const name = tabs.routes[index]?.name;
  return name ? tabHref(name) : null;
}

function findTabsState(state: NavStateLike | null | undefined): NavStateLike | null {
  if (!state?.routes) return null;
  for (const route of state.routes) {
    if (route.name === TABS_ROUTE && route.state) return route.state;
    const nested = findTabsState(route.state);
    if (nested) return nested;
  }
  return null;
}
