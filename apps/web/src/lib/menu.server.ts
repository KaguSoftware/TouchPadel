import 'server-only';
import { unstable_cache } from 'next/cache';
import { createStaticSupabase } from './supabase/static';
import {
  fetchBranches,
  fetchCafeSettings,
  fetchMenu,
  fetchTableBranch,
  DEFAULT_CAFE_SETTINGS,
  type CafeSettings,
  type MenuCategory,
  type VenueBranch,
} from './menu';

/**
 * Server-side cached read model shared by every page that shows venue or menu
 * data: the café menu at `/{locale}/menu` (walk-in and table-bound alike), the
 * Touch Padel landing at `/{locale}` and the legal pages. Every one of them
 * renders dynamically (the layout's nonce read), so this cache is the only one:
 * one `unstable_cache` entry per read (per branch for the menu and the café
 * settings), tagged `menu`, revalidated every 60 s. A failed or empty read is an
 * explicit status — the page must never render a silent blank (Vercel incident
 * lesson).
 */
export type MenuStatus = 'ok' | 'empty' | 'error';

export interface MenuResult {
  status: MenuStatus;
  categories: MenuCategory[];
}

const ok = (categories: MenuCategory[]): MenuResult => ({
  status: categories.length > 0 ? 'ok' : 'empty',
  categories,
});
const err = (e: unknown): MenuResult => {
  console.error('[menu.server] fetchMenu failed:', e);
  return { status: 'error', categories: [] };
};

/**
 * One cache entry PER BRANCH (multi-venue slice 4): `unstable_cache` keys an
 * entry by its key parts plus the call's arguments, so `getCachedMenu(a)` and
 * `getCachedMenu(b)` never share a copy. `null` is the unfiltered read the menu
 * page falls back to when the branch list could not be read.
 */
// Multi-venue audit: the cached functions THROW on a failed read, and the
// exported wrappers turn that into the fallback. unstable_cache stores what the
// function returns, so a fallback returned from inside it was kept for the whole
// revalidate window — one blip meant a minute of "menu unavailable", or of an
// empty branch list (and with it the unfiltered menu of every branch).
const cachedMenu = unstable_cache(
  (venueId: string | null = null): Promise<MenuResult> =>
    fetchMenu(createStaticSupabase(), venueId).then(ok),
  ['cafe-menu'],
  { tags: ['menu'], revalidate: 60 },
);

export async function getCachedMenu(venueId: string | null = null): Promise<MenuResult> {
  try {
    return await cachedMenu(venueId);
  } catch (e) {
    return err(e); // also missing env: client creation throws synchronously
  }
}

/** The hero / featured / ticker settings of one branch (one entry per branch, as above). */
const cachedCafeSettings = unstable_cache(
  (venueId: string | null = null): Promise<CafeSettings> => fetchCafeSettings(createStaticSupabase(), venueId),
  ['cafe-settings'],
  { tags: ['menu'], revalidate: 60 },
);

export async function getCachedCafeSettings(venueId: string | null = null): Promise<CafeSettings> {
  try {
    return await cachedCafeSettings(venueId);
  } catch {
    return { ...DEFAULT_CAFE_SETTINGS, ticker_en: [], ticker_ar: [] };
  }
}

/**
 * Every open branch, oldest first: names, address, hours, phone. Same `menu`
 * tag as the reads above, so an operator settings change revalidates them
 * together. A failed read is an empty list: the club site then renders its
 * hard-coded address with no hours rather than taking the page down, and the
 * café menu falls back to its unfiltered read.
 */
const cachedBranches = unstable_cache(
  (): Promise<VenueBranch[]> => fetchBranches(createStaticSupabase()),
  ['cafe-branches'],
  { tags: ['menu'], revalidate: 60 },
);

/** The open branches, or null when they could not be read (never cached). */
export async function getBranchesOrNull(): Promise<VenueBranch[] | null> {
  try {
    return await cachedBranches();
  } catch (e) {
    console.error('[menu.server] fetchBranches failed:', e);
    return null; // also missing env
  }
}

/** The open branches; an empty list when they could not be read. */
export async function getCachedBranches(): Promise<VenueBranch[]> {
  return (await getBranchesOrNull()) ?? [];
}

/**
 * The open branch the guest's table token belongs to, or null. DELIBERATELY NOT
 * CACHED: `unstable_cache` keys an entry by its arguments, which would write
 * the table token (a credential) into the data cache. It is one anon RPC, and
 * the menu page only makes it for a table guest while several branches are open.
 */
export async function getTableBranch(token: string): Promise<string | null> {
  try {
    return await fetchTableBranch(createStaticSupabase(), token);
  } catch {
    return null; // missing env
  }
}

/**
 * The DEFAULT branch (the oldest open one, as `app.default_venue()` picks it):
 * venue name / opening hours / phone for the pages that speak for one venue
 * (the site footer, the legal pages, support, delete-account, the 404, the
 * café footer's fallback). With one open branch it is that branch, exactly the
 * old single-row read. Null when no branch could be read.
 */
export async function getCachedVenue(): Promise<VenueBranch | null> {
  return (await getCachedBranches())[0] ?? null;
}
