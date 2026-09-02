/**
 * The language switch end to end, at the seam where the pieces meet: the tab is
 * read from the live navigation state, parked with the destination, and comes
 * back as the pair the restore replays.
 *
 * The bug this pins: only the destination was parked, so the reload rebuilt the
 * tabs at their default and backing out of the restored Settings landed on Book
 * instead of the Profile it was opened from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeTabHref, type NavStateLike } from '../../navigation/activeTab';

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).__DEV__ = false;

vi.mock('react-native', () => ({
  DevSettings: { reload: vi.fn() },
  I18nManager: { isRTL: false, allowRTL: vi.fn(), forceRTL: vi.fn() },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
    multiGet: async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null]),
  },
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const { readResumeRoute, saveResumeRoute, clearResumeRoute } = await import('../bootPrefs');

/** Settings pushed over the Profile tab — read off the real device. */
const SETTINGS_OVER_PROFILE: NavStateLike = {
  index: 0,
  routes: [
    {
      name: '__root',
      state: {
        index: 1,
        routes: [
          {
            name: '(tabs)',
            state: { index: 2, routes: [{ name: 'bookings' }, { name: 'index' }, { name: 'profile' }] },
          },
          { name: 'settings' },
        ],
      },
    },
  ],
};

/**
 * The restore's decision, mirrored from app/_layout.tsx: which router calls it
 * makes for a given parked entry, and in which order.
 *
 * The real component spreads these over two commits — the tab has to land
 * before the destination goes on top, because at restore time the tabs
 * navigator is not mounted yet and a same-tick selection applies to nothing
 * (measured on device: the tab fell back to Book). What is pinned here is the
 * sequence and the CALL KIND, which is the part that was wrong twice.
 */
function replay(entry: { path: string; tab?: string } | null): { op: string; href: string }[] {
  if (!entry) return [];
  const { path, tab } = entry;
  if (tab && tab !== path) {
    // Two commits: navigate selects the tab, then push appends to it. A second
    // navigate would re-resolve the href and rebuild the tabs at their default.
    return [
      { op: 'navigate', href: tab },
      { op: 'push', href: path },
    ];
  }
  return [{ op: 'navigate', href: path }];
}

describe('switching language in Settings, opened from Profile', () => {
  beforeEach(() => store.clear());

  it('parks the destination AND the tab under it, and replays both', async () => {
    // What Settings does at switch time.
    const tab = activeTabHref(SETTINGS_OVER_PROFILE);
    expect(tab).toBe('/profile');
    await saveResumeRoute('/settings', tab ?? undefined);

    // What the next launch reads, after the bundle reloaded.
    const entry = await readResumeRoute();
    expect(entry).toEqual({ path: '/settings', tab: '/profile' });

    // The restore selects the tab, then layers the destination on it. The two
    // calls differ on purpose: a second `navigate` would re-resolve the href
    // and rebuild the tabs at their default, undoing the selection.
    expect(replay(entry)).toEqual([
      { op: 'navigate', href: '/profile' },
      { op: 'push', href: '/settings' },
    ]);

    await clearResumeRoute();
    expect(await readResumeRoute()).toBeNull();
  });

  it('does not navigate twice when the switch happened on a tab itself', async () => {
    // Book is '/' both as the destination and as the tab; pushing it onto
    // itself would stack a screen on a copy of itself.
    await saveResumeRoute('/', '/');
    expect(replay(await readResumeRoute())).toEqual([{ op: 'navigate', href: '/' }]);
  });

  it('resolves the destination alone when no tab was parked', async () => {
    await saveResumeRoute('/settings');
    expect(replay(await readResumeRoute())).toEqual([{ op: 'navigate', href: '/settings' }]);
  });

  it('still restores the destination when no tabs were mounted', async () => {
    // A switch made from an auth screen: no tab to park, destination survives.
    expect(activeTabHref({ index: 0, routes: [{ name: 'sign-in' }] })).toBeNull();
    await saveResumeRoute('/settings', undefined);
    expect(await readResumeRoute()).toEqual({ path: '/settings', tab: undefined });
  });
});
