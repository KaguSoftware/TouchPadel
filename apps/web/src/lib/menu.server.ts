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
export const getCachedMenu = unstable_cache(
  (venueId: string | null = null): Promise<MenuResult> => {
    try {
      return fetchMenu(createStaticSupabase(), venueId).then(ok).catch(err);
    } catch (e) {
      return Promise.resolve(err(e)); // missing env → client creation throws synchronously
    }
  },
  ['cafe-menu'],
  { tags: ['menu'], revalidate: 60 },
);

/** The hero / featured / ticker settings of one branch (one entry per branch, as above). */
export const getCachedCafeSettings = unstable_cache(
  (venueId: string | null = null): Promise<CafeSettings> => {
    try {
      return fetchCafeSettings(createStaticSupabase(), venueId).catch(() => ({
        ...DEFAULT_CAFE_SETTINGS,
        ticker_en: [],
        ticker_ar: [],
      }));
    } catch {
      return Promise.resolve({ ...DEFAULT_CAFE_SETTINGS, ticker_en: [], ticker_ar: [] });
    }
  },
  ['cafe-settings'],
  { tags: ['menu'], revalidate: 60 },
);

/**
 * Every open branch, oldest first: names, address, hours, phone. Same `menu`
 * tag as the reads above, so an operator settings change revalidates them
 * together. A failed read is an empty list: the club site then renders its
 * hard-coded address with no hours rather than taking the page down, and the
 * café menu falls back to its unfiltered read.
 */
export const getCachedBranches = unstable_cache(
  (): Promise<VenueBranch[]> => {
    try {
      return fetchBranches(createStaticSupabase()).catch((e: unknown): VenueBranch[] => {
        console.error('[menu.server] fetchBranches failed:', e);
        return [];
      });
    } catch {
      return Promise.resolve([]); // missing env
    }
  },
  ['cafe-branches'],
  { tags: ['menu'], revalidate: 60 },
);

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
