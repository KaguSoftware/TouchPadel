import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { t } from '@touch/i18n';
import { resetServerData } from '@/test/fixtures';
import { resetSiteRequest } from '@/lib/site/testSupport';
import LocaleNotFound from './not-found';
import UnknownAddress from './[...rest]/page';

/**
 * The two 404s (fix pass 2026-09-24).
 *
 * - `[...rest]/not-found.tsx`: what a mistyped or stale address gets. `[...rest]/page.tsx`
 *   matches every path under a locale that no page does and throws `notFound()`; before
 *   it existed such a URL matched nothing and Next served its bare English default (no
 *   `lang`, no way home). This one wears the full site shell; Playwright covers it in
 *   both languages (e2e/tests/site-landing.spec.ts).
 * - `not-found.tsx`: the segment-wide fallback for any other `notFound()` (a refused
 *   locale). Next serialises it into EVERY route's payload, the café menu's included, so
 *   it carries only the small lost sheet and a bare frame: no site sheet, no client
 *   components, no venue read.
 *
 * Next 16 hands `not-found` no params, but the locale is this app's ROOT parameter, which
 * `next/root-params` gives any Server Component; it is mocked here as mutable state. A
 * refused first segment reads as Arabic, the default, as the layout's `lang` already does.
 */
const root = vi.hoisted(() => ({ locale: 'en' as string }));

vi.mock('next/root-params', () => ({ locale: () => Promise.resolve(root.locale) }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const venueReads = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/menu.server', async () => {
  const { serverData } = await import('@/test/fixtures');
  return {
    getCachedMenu: () => Promise.resolve(serverData.menu),
    getCachedCafeSettings: () => Promise.resolve(serverData.settings),
    getCachedVenue: () => {
      venueReads.count += 1;
      return Promise.resolve(serverData.venue);
    },
  };
});

vi.mock('@/lib/site/mode.server', async () => {
  const { siteRequest } = await import('@/lib/site/testSupport');
  return {
    getSiteMode: () => Promise.resolve(siteRequest.mode),
    getRequestNonce: () => Promise.resolve(siteRequest.nonce),
  };
});

beforeEach(() => {
  resetServerData();
  resetSiteRequest();
  venueReads.count = 0;
});

const params = (locale: string) => ({ params: Promise.resolve({ locale, rest: ['nope'] }) });

describe('an address no page matches', () => {
  it('is a 404: the catch-all only throws notFound(), under any first segment', async () => {
    for (const locale of ['en', 'ar', 'xx.y']) {
      await expect(UnknownAddress(params(locale))).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });
});

describe('the segment’s fallback 404', () => {
  it('says it in Arabic, the default, for a foreign first segment, with the ways back', async () => {
    root.locale = 'xx.y';
    render(await LocaleNotFound());
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe(
      t('ar', 'site.notFound.title'),
    );
    expect(
      within(main).getByRole('link', { name: t('ar', 'site.notFound.home') }).getAttribute('href'),
    ).toBe('/ar');
    expect(
      within(main).getByRole('link', { name: t('ar', 'site.notFound.menu') }).getAttribute('href'),
    ).toBe('/ar/menu');
  });

  it('stays light: its own small sheet, no site shell, no client pieces, no venue read', async () => {
    root.locale = 'en';
    render(await LocaleNotFound());
    // It rides in every route's payload, the café menu's included (perf finding P1).
    expect(document.querySelector('style[data-tp-site]')).toBeNull();
    expect(document.querySelector('.tp-site')).toBeNull();
    expect(document.querySelector('.tp-site-menu-toggle, .tp-theme-toggle')).toBeNull();
    expect(document.querySelector('style')?.textContent).toContain('.tp-lost-page');
    expect(venueReads.count).toBe(0);
  });
});
