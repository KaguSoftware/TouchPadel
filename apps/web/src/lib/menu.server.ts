import 'server-only';
import { unstable_cache } from 'next/cache';
import { createStaticSupabase } from './supabase/static';
import {
  fetchCafeSettings,
  fetchMenu,
  fetchVenuePublic,
  DEFAULT_CAFE_SETTINGS,
  type CafeSettings,
  type MenuCategory,
  type VenueOpeningHours,
} from './menu';

/**
 * Server-side cached read model shared by `/{locale}` (ISR) and
 * `/{locale}/t/{token}` (dynamic): one `unstable_cache` entry tagged `menu`,
 * revalidated every 60 s. A failed or empty read is an explicit status — the
 * page must never render a silent blank (Vercel incident lesson).
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

export const getCachedMenu = unstable_cache(
  (): Promise<MenuResult> => {
    try {
      return fetchMenu(createStaticSupabase()).then(ok).catch(err);
    } catch (e) {
      return Promise.resolve(err(e)); // missing env → client creation throws synchronously
    }
  },
  ['cafe-menu'],
  { tags: ['menu'], revalidate: 60 },
);

export const getCachedCafeSettings = unstable_cache(
  (): Promise<CafeSettings> => {
    try {
      return fetchCafeSettings(createStaticSupabase()).catch(() => ({
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
 * Venue name / opening hours / phone for the footer + hero strapline. Same
 * `menu` tag as the read model above, so an operator settings change
 * revalidates all three together. A failed read renders the footer without
 * hours rather than taking the page down.
 */
export const getCachedVenue = unstable_cache(
  (): Promise<VenueOpeningHours | null> => {
    try {
      return fetchVenuePublic(createStaticSupabase()).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  },
  ['cafe-venue'],
  { tags: ['menu'], revalidate: 60 },
);
