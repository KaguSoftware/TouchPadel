/**
 * The route parked across a language switch. The switch reloads the JS bundle
 * (the only way a changed RTL flag reaches native views), so where the user was
 * standing has to survive in storage — and must NOT come back on some later,
 * unrelated launch.
 *
 * bootPrefs pulls in react-native and two expo native modules; they are stubbed
 * here so the storage logic can be tested on its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

// react-native's global, read by the telemetry the error paths below go through.
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

const { RESUME_KEY, clearResumeRoute, consumeResumeRoute, readResumeRoute, saveResumeRoute } =
  await import('../bootPrefs');

describe('the route parked across a locale switch', () => {
  beforeEach(() => {
    store.clear();
    vi.useRealTimers();
  });

  it('survives being read twice — the double boot Expo Go does after a reload', async () => {
    // The failure this guards: read-and-clear in one step meant the first mount
    // consumed the route and the second, which is the one the user lands on,
    // found nothing and left them on the tabs.
    await saveResumeRoute('/settings', '/profile');
    expect(await readResumeRoute()).toEqual({ path: '/settings', tab: '/profile' });
    expect(await readResumeRoute()).toEqual({ path: '/settings', tab: '/profile' });
    // Spent only once the push has actually landed.
    await clearResumeRoute();
    expect(await readResumeRoute()).toBeNull();
  });

  it('comes back exactly once — a second read is empty', async () => {
    await saveResumeRoute('/settings', '/profile');
    expect(await consumeResumeRoute()).toEqual({ path: '/settings', tab: '/profile' });
    // Without this, the route would replay on some later, unrelated launch.
    expect(await consumeResumeRoute()).toBeNull();
  });

  it('carries the tab that was under the screen, so back leads there', async () => {
    // Settings is reached from Profile; without the tab the restore rebuilt the
    // tabs at their default and back dropped the user on Book.
    await saveResumeRoute('/settings', '/profile');
    expect(await consumeResumeRoute()).toEqual({ path: '/settings', tab: '/profile' });
  });

  it('keeps the destination when no tab was recorded', async () => {
    await saveResumeRoute('/settings');
    expect(await consumeResumeRoute()).toEqual({ path: '/settings', tab: undefined });
  });

  it('drops a bad tab rather than losing the destination with it', async () => {
    store.set(
      RESUME_KEY,
      JSON.stringify({ path: '/settings', tab: 'https://evil.example', at: Date.now() }),
    );
    expect(await consumeResumeRoute()).toEqual({ path: '/settings', tab: undefined });
  });

  it('is nothing at all when no switch happened', async () => {
    expect(await consumeResumeRoute()).toBeNull();
  });

  it('expires: debris from an abandoned switch is not an intention', async () => {
    await saveResumeRoute('/booking/42', '/bookings');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(await consumeResumeRoute()).toBeNull();
  });

  it('refuses anything that is not an in-app path', async () => {
    for (const bad of ['https://evil.example', '//evil.example', 'settings']) {
      store.set(RESUME_KEY, JSON.stringify({ path: bad, at: Date.now() }));
      expect(await consumeResumeRoute()).toBeNull();
    }
  });

  it('survives a corrupt entry rather than throwing into the boot path', async () => {
    store.set(RESUME_KEY, 'not json');
    expect(await consumeResumeRoute()).toBeNull();
    store.set(RESUME_KEY, JSON.stringify({ path: '/settings' })); // no timestamp
    expect(await consumeResumeRoute()).toBeNull();
  });
});
