import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { screen, within } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { FLAT_WHITE, MENU_ERROR, MENU_FIXTURE, resetServerData, serverData } from '@/test/fixtures';
import { cookieJar, renderServerPage, resetCookieJar } from '@/test/renderPage';
import CafeMenuPage, { generateMetadata, generateViewport } from './page';

/**
 * The café menu — `/{locale}/menu` since 2026-09-23 (it was the site root; the
 * table session was `/{locale}/t`). One page, two guests, told apart only by
 * the HttpOnly `tp-table` cookie proxy.ts sets on the QR exchange:
 *
 *   no cookie  a walk-in: the whole app with `token: null`, so "send" and
 *              "call waiter" ask for the table QR;
 *   cookie     a scanned guest: token → `<CafeApp token=…>` → a table chip.
 *
 * This is a SMOKE render: it proves the page composes and picks the reading
 * language, not that the design is right (that is `e2e/tests/cafe-*.spec.ts`).
 * The reads are mocked at `@/lib/menu.server` so no Supabase stack is needed,
 * and `useSupabase` returns null so every live feature degrades exactly as it
 * does on a deployment with no public env vars — which is why the bound chip
 * lands on `error` here (the BOUND state needs a live `app.open_table_session`
 * and belongs to the e2e suite).
 */
vi.mock('@/lib/menu.server', async () => {
  const { serverData } = await import('@/test/fixtures');
  return {
    getCachedMenu: () => Promise.resolve(serverData.menu),
    getCachedCafeSettings: () => Promise.resolve(serverData.settings),
    getCachedVenue: () => Promise.resolve(serverData.venue),
  };
});

vi.mock('next/headers', async () => {
  const { fakeCookieStore, fakeHeaderStore } = await import('@/test/renderPage');
  return {
    cookies: () => Promise.resolve(fakeCookieStore()),
    headers: () => Promise.resolve(fakeHeaderStore()),
  };
});

vi.mock('@/hooks/cafe/useSupabase', () => ({
  useSupabase: () => null,
  __resetSupabaseForTests: () => {},
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useParams: () => ({}),
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}));

const LOCALES = ['en', 'ar'] as const;

/** The section band's only text: the design's Latin word, or the category's own name. */
function bandWords(): string[] {
  return Array.from(document.querySelectorAll('.tp-stage__word')).map((el) => el.textContent ?? '');
}

beforeEach(() => {
  resetServerData();
  resetCookieJar();
});

describe.each(LOCALES)('café menu page (%s)', (locale: Locale) => {
  it('renders the app shell with no table bound when there is no tp-table cookie', async () => {
    await renderServerPage(CafeMenuPage, locale);

    // The lockup's alt text is the cafe name in the reading language.
    expect(screen.getByAltText(t(locale, 'common.cafeName'))).toBeTruthy();
    // token === null ⇒ TableChip renders nothing, so no "scan again" affordance.
    expect(screen.queryByRole('button', { name: t(locale, 'cafe.scanAgain') })).toBeNull();
    expect(document.querySelector('.tp-cafe__table')).toBeNull();
  });

  it('binds the table when the tp-table cookie is present', async () => {
    cookieJar.table = 'tp-fixture-token';
    await renderServerPage(CafeMenuPage, locale);

    const chip = document.querySelector('.tp-cafe__table');
    expect(chip).not.toBeNull();
    // The token reached CafeApp, so TableChip is mounted; with no Supabase
    // client the binding fails and the chip is the tappable re-scan notice.
    expect(chip?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('button', { name: t(locale, 'cafe.scanAgain') })).toBeTruthy();

    // and the menu itself is on screen, in the reading language
    expect(screen.getByText(locale === 'ar' ? FLAT_WHITE.name_ar : FLAT_WHITE.name_en)).toBeTruthy();
  });

  it('names its categories in the reading language', async () => {
    await renderServerPage(CafeMenuPage, locale);

    const expected = MENU_FIXTURE.map((c) => (locale === 'ar' ? c.name_ar : c.name_en.toUpperCase()));
    expect(bandWords()).toEqual(expected);

    // The other language's category name must not be on the page at all.
    const other = MENU_FIXTURE.map((c) => (locale === 'ar' ? c.name_en.toUpperCase() : c.name_ar));
    for (const word of other) expect(bandWords()).not.toContain(word);
  });

  it('prints every item row in the reading language', async () => {
    await renderServerPage(CafeMenuPage, locale);

    for (const category of MENU_FIXTURE) {
      for (const item of category.items) {
        expect(screen.getByText(locale === 'ar' ? item.name_ar : item.name_en)).toBeTruthy();
      }
    }
  });

  /**
   * DIRECTION: `dir` is set in exactly one place in this app — `<html>` in
   * `app/[locale]/layout.tsx`, from `dirAttr(locale)`. A page test renders the
   * PAGE, not the layout, so Arabic is asserted here as the Arabic catalog
   * strings the page chose; the rendered direction is
   * `e2e/tests/cafe-rtl-layout.spec.ts`.
   */
  it('renders a status, not a blank menu, when the read model failed', async () => {
    serverData.menu = MENU_ERROR;
    await renderServerPage(CafeMenuPage, locale);

    const status = screen.getByRole('status');
    expect(status.className).toContain('tp-menu-unavailable');
    expect(status.textContent).toContain(t(locale, 'cafe.menuUnavailable.title'));
    expect(status.textContent).toContain(t(locale, 'cafe.menuUnavailable.body'));
    expect(screen.getByRole('button', { name: t(locale, 'common.retry') })).toBeTruthy();
    // and nothing from the menu stage
    expect(bandWords()).toEqual([]);
  });

  it('server-renders the locale switch onto the other language’s menu, never the token', async () => {
    cookieJar.table = 'tp-fixture-token';
    // renderToString runs no effects, so this is exactly the HTML a guest can
    // tap before hydration (after it, the href is refined from the live URL).
    const html = renderToString(await CafeMenuPage({ params: Promise.resolve({ locale }) }));
    const other = locale === 'ar' ? 'en' : 'ar';
    const switchTag = html.match(/<a[^>]*class="tp-locale-switch"[^>]*>/)?.[0] ?? '';
    expect(switchTag).toContain(`href="/${other}/menu"`);
    // The old default was `/{other}/t/{token}`: the credential in the markup.
    expect(switchTag).not.toContain('tp-fixture-token');
  });

  it('closes on a quiet row out to Touch Padel, support, privacy and terms, and no Kagu credit', async () => {
    await renderServerPage(CafeMenuPage, locale);

    const nav = screen.getByRole('navigation', { name: t(locale, 'site.footer.exploreTitle') });
    const links = within(nav)
      .getAllByRole('link')
      .map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      [t(locale, 'site.footer.exploreTitle'), `/${locale}`],
      [t(locale, 'site.footer.support'), `/${locale}/support`],
      [t(locale, 'site.footer.privacy'), `/${locale}/privacy`],
      [t(locale, 'site.footer.terms'), `/${locale}/terms`],
    ]);
    expect(document.querySelector('.tp-footer')?.textContent).not.toContain(
      t(locale, 'cafe.footer.developedBy'),
    );
  });

  it('declares itself, not the landing, as canonical, with hreflang to both menus', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale }) });

    expect(meta.title).toEqual({ absolute: t(locale, 'site.seo.menuTitle') });
    expect(meta.description).toBe(t(locale, 'seo.menuDescription'));
    expect(meta.alternates).toEqual({
      canonical: `/${locale}/menu`,
      languages: { en: '/en/menu', ar: '/ar/menu', 'x-default': '/ar/menu' },
    });
    // Indexable: the menu is public, and the token never enters this URL.
    expect(meta.robots).toBeUndefined();
    const og = meta.openGraph as { images: Array<{ url: string }> } | undefined;
    expect(og?.images[0]?.url).toBe('/brand/cafe/og-touch-cafe-1200x630.png');
    expect(JSON.stringify(meta.icons)).toContain('/brand/cafe/');
  });
});

describe('café menu viewport', () => {
  it('paints the browser chrome in the café blue', () => {
    expect(generateViewport().themeColor).toBe('#3360AB');
  });
});

describe('a foreign locale segment', () => {
  it('404s before reading the cookie or the menu', async () => {
    cookieJar.table = 'tp-fixture-token';
    await expect(renderServerPage(CafeMenuPage, 'xx' as Locale)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
