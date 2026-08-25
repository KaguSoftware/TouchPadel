import 'server-only';
import { unstable_cache } from 'next/cache';
import { createStaticSupabase } from './supabase/static';
import {
  fetchCafeSettings,
  fetchMenu,
  DEFAULT_CAFE_SETTINGS,
  type CafeSettings,
  type MenuCategory,
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
