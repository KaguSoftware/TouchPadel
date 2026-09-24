import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { resetServerData } from '@/test/fixtures';
import { resetSiteRequest, siteRequest } from '@/lib/site/testSupport';
import LocaleNotFound from './not-found';
import UnknownAddressNotFound from './[...rest]/not-found';
import UnknownAddress, { generateMetadata } from './[...rest]/page';

/**
 * The two 404s (fix pass 2026-09-24).
 *
 * - `[...rest]/not-found.tsx`: what a mistyped or stale address gets. `[...rest]/page.tsx`
 *   matches every path under a locale that no page does and throws `notFound()`; before
 *   it existed such a URL matched nothing and Next served its bare English default (no
 *   `lang`, no way home). This one wears the full site shell.
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
  it('is a 404: the catch-all only throws notFound()', async () => {
    await expect(UnknownAddress(params('en'))).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(UnknownAddress(params('ar'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('refuses a foreign locale the same way', async () => {
    await expect(UnknownAddress(params('xx.y'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is titled "Out of bounds" in the page’s language', async () => {
    expect((await generateMetadata(params('en'))).title).toBe(t('en', 'site.notFound.title'));
    expect((await generateMetadata(params('ar'))).title).toBe(t('ar', 'site.notFound.title'));
  });
});

describe.each(['en', 'ar'] as const)('the 404 a visitor meets (%s)', (locale: Locale) => {
  beforeEach(() => {
    root.locale = locale;
  });

  const renderIt = async () => render(await UnknownAddressNotFound());

  it('says it in the reading language, as the one heading, inside the one main', async () => {
    await renderIt();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe(
      t(locale, 'site.notFound.title'),
    );
    expect(screen.getByText(t(locale, 'site.notFound.body'))).toBeTruthy();
    const other = locale === 'ar' ? 'en' : 'ar';
    expect(screen.queryByText(t(other, 'site.notFound.title'))).toBeNull();
  });

  it('links home and to the café menu with plain anchors', async () => {
    await renderIt();
    const main = screen.getByRole('main');
    expect(
      within(main).getByRole('link', { name: t(locale, 'site.notFound.home') }).getAttribute('href'),
    ).toBe(`/${locale}`);
    expect(
      within(main).getByRole('link', { name: t(locale, 'site.notFound.menu') }).getAttribute('href'),
    ).toBe(`/${locale}/menu`);
  });

  it('wears the site shell in the visitor’s mode, framed as a page (not the home page)', async () => {
    siteRequest.mode = 'light';
    await renderIt();
    const site = document.querySelector('.tp-site')!;
    expect(site.getAttribute('data-mode')).toBe('light');
    // Not 'home': the header is the solid one and its links go home first.
    expect(site.getAttribute('data-page')).toBe('page');
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    const club = document.querySelector('.tp-site-nav__link');
    expect(club?.getAttribute('href')).toBe(`/${locale}#club`);
  });
});

describe.each(['en', 'ar'] as const)('the segment’s fallback 404 (%s)', (locale: Locale) => {
  beforeEach(() => {
    root.locale = locale;
  });

  const renderIt = async () => render(await LocaleNotFound());

  it('says it in the reading language, as the one heading, with the ways back', async () => {
    await renderIt();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe(
      t(locale, 'site.notFound.title'),
    );
    expect(
      within(main).getByRole('link', { name: t(locale, 'site.notFound.home') }).getAttribute('href'),
    ).toBe(`/${locale}`);
    expect(
      within(main).getByRole('link', { name: t(locale, 'site.notFound.menu') }).getAttribute('href'),
    ).toBe(`/${locale}/menu`);
    // A bare frame: the lockup home, and a row of plain links with the other language.
    expect(
      within(screen.getByRole('banner'))
        .getByRole('link', { name: t(locale, 'site.brandHome') })
        .getAttribute('href'),
    ).toBe(`/${locale}`);
    const other = locale === 'ar' ? 'en' : 'ar';
    expect(document.querySelector(`a[hreflang="${other}"]`)?.getAttribute('href')).toBe(
      `/${other}`,
    );
  });

  it('stays light: its own small sheet, no site shell, no client pieces, no venue read', async () => {
    await renderIt();
    // It rides in every route's payload, the café menu's included (perf finding P1).
    expect(document.querySelector('style[data-tp-site]')).toBeNull();
    expect(document.querySelector('.tp-site')).toBeNull();
    expect(document.querySelector('.tp-site-menu-toggle, .tp-theme-toggle')).toBeNull();
    const css = document.querySelector('style')?.textContent ?? '';
    expect(css).toContain('.tp-lost-page');
    expect(css).not.toContain('.tp-front');
    expect(css.length).toBeLessThan(6500);
    expect(venueReads.count).toBe(0);
  });

  it('follows the visitor’s mode', async () => {
    siteRequest.mode = 'light';
    await renderIt();
    expect(document.querySelector('.tp-lost-page')?.getAttribute('data-mode')).toBe('light');
  });
});

describe('the fallback 404 with a foreign first segment', () => {
  it('falls back to Arabic, the default locale', async () => {
    root.locale = 'xx.y';
    render(await LocaleNotFound());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      t('ar', 'site.notFound.title'),
    );
  });
});
