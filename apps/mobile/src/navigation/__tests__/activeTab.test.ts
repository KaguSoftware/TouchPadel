/**
 * Finding the tab beneath the current screen — the piece that makes back, after
 * a language switch, lead where it led before it.
 */
import { describe, expect, it } from 'vitest';
import { activeTabHref, tabHref, type NavStateLike } from '../activeTab';

/** The real shape, as read off the device: root → (tabs) → the three tabs. */
const treeWith = (index: number, extra: NavStateLike['routes'] = []): NavStateLike => ({
  index: 0,
  routes: [
    {
      name: '__root',
      state: {
        index: extra.length ? 1 : 0,
        routes: [
          {
            name: '(tabs)',
            state: { index, routes: [{ name: 'bookings' }, { name: 'index' }, { name: 'profile' }] },
          },
          ...extra,
        ],
      },
    },
  ],
});

describe('tabHref — a tab file name as a link', () => {
  it("maps the group's index route to the group root", () => {
    // 'index' is Book, which lives at '/', not at '/index'.
    expect(tabHref('index')).toBe('/');
  });

  it('maps every other tab to its sibling path', () => {
    expect(tabHref('profile')).toBe('/profile');
    expect(tabHref('bookings')).toBe('/bookings');
  });
});

describe('activeTabHref — the tab under the current screen', () => {
  it('finds the selected tab when a screen is pushed above it', () => {
    // The case that prompted this: switching language while in Settings, which
    // was opened from Profile. The pathname says '/settings' and nothing about
    // the tab, so the state is what has to be read.
    expect(activeTabHref(treeWith(2, [{ name: 'settings' }]))).toBe('/profile');
  });

  it('finds it with no screen pushed at all', () => {
    expect(activeTabHref(treeWith(0))).toBe('/bookings');
    expect(activeTabHref(treeWith(1))).toBe('/');
  });

  it('defaults to the first tab when the state carries no index', () => {
    const noIndex: NavStateLike = {
      routes: [{ name: '(tabs)', state: { routes: [{ name: 'bookings' }, { name: 'profile' }] } }],
    };
    expect(activeTabHref(noIndex)).toBe('/bookings');
  });

  it('is null when the tabs are not mounted — an auth screen, a cold deep link', () => {
    // The caller then parks no tab rather than guessing one.
    expect(activeTabHref({ index: 0, routes: [{ name: 'sign-in' }] })).toBeNull();
    expect(activeTabHref({ index: 0, routes: [] })).toBeNull();
    expect(activeTabHref(null)).toBeNull();
    expect(activeTabHref(undefined)).toBeNull();
  });

  it('survives a malformed tree instead of throwing into the switch', () => {
    expect(activeTabHref({ index: 9, routes: [{ name: '(tabs)', state: { routes: [] } }] })).toBeNull();
    expect(activeTabHref({ index: 0, routes: [{ name: '(tabs)' }] })).toBeNull();
  });
});
