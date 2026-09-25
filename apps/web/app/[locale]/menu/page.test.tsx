import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { screen, within } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { MENU_ERROR, MENU_FIXTURE, resetServerData, serverData } from '@/test/fixtures';
import { cookieJar, renderServerPage, resetCookieJar } from '@/test/renderPage';
import CafeMenuPage, { generateMetadata } from './page';

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

/** The section band's only text: the design's Latin word, or the category's own name. */
function bandWords(): string[] {
  return Array.from(document.querySelectorAll('.tp-stage__word')).map((el) => el.textContent ?? '');
}

beforeEach(() => {
  resetServerData();
  resetCookieJar();
});

describe('café menu page', () => {
  it('renders the app shell with no table bound when there is no tp-table cookie', async () => {
    await renderServerPage(CafeMenuPage, 'en');

    expect(screen.getByAltText(t('en', 'common.cafeName'))).toBeTruthy();
    // token === null ⇒ TableChip renders nothing, so no "scan again" affordance.
    expect(screen.queryByRole('button', { name: t('en', 'cafe.scanAgain') })).toBeNull();
    expect(document.querySelector('.tp-cafe__table')).toBeNull();
  });

  it('binds the table when the tp-table cookie is present', async () => {
    cookieJar.table = 'tp-fixture-token';
    await renderServerPage(CafeMenuPage, 'en');

    // The token reached CafeApp, so TableChip is mounted; with no Supabase
    // client the binding fails and the chip is the tappable re-scan notice.
    expect(document.querySelector('.tp-cafe__table')?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('button', { name: t('en', 'cafe.scanAgain') })).toBeTruthy();
  });

  /**
   * DIRECTION: `dir` is set in exactly one place in this app — `<html>` in
   * `app/[locale]/layout.tsx`. A page test renders the PAGE, not the layout, so Arabic is
   * asserted here as the Arabic strings the page chose; the rendered direction is
   * `e2e/tests/cafe-rtl-layout.spec.ts`.
   */
  it('names its categories and items in Arabic at /ar, and never in English', async () => {
    await renderServerPage(CafeMenuPage, 'ar');

    expect(bandWords()).toEqual(MENU_FIXTURE.map((c) => c.name_ar));
    for (const category of MENU_FIXTURE) {
      for (const item of category.items) {
        expect(screen.getByText(item.name_ar)).toBeTruthy();
        expect(screen.queryByText(item.name_en)).toBeNull();
      }
    }
  });

  it('renders a status, not a blank menu, when the read model failed', async () => {
    serverData.menu = MENU_ERROR;
    await renderServerPage(CafeMenuPage, 'en');

    const status = screen.getByRole('status');
    expect(status.textContent).toContain(t('en', 'cafe.menuUnavailable.title'));
    expect(screen.getByRole('button', { name: t('en', 'common.retry') })).toBeTruthy();
    expect(bandWords()).toEqual([]);
  });

  it('server-renders the locale switch onto the other language’s menu, never the token', async () => {
    cookieJar.table = 'tp-fixture-token';
    // renderToString runs no effects, so this is exactly the HTML a guest can
    // tap before hydration (after it, the href is refined from the live URL).
    const html = renderToString(await CafeMenuPage({ params: Promise.resolve({ locale: 'en' }) }));
    const switchTag = html.match(/<a[^>]*class="tp-locale-switch"[^>]*>/)?.[0] ?? '';
    expect(switchTag).toContain('href="/ar/menu"');
    // The old default was `/{other}/t/{token}`: the credential in the markup.
    expect(switchTag).not.toContain('tp-fixture-token');
  });

  it('closes on a quiet row out to Touch Padel, support, privacy and terms', async () => {
    await renderServerPage(CafeMenuPage, 'en');

    const nav = screen.getByRole('navigation', { name: t('en', 'site.footer.exploreTitle') });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['/en', '/en/support', '/en/privacy', '/en/terms']);
  });

  it('declares itself, not the landing, as canonical, with hreflang to both menus', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });
    expect(meta.alternates).toEqual({
      canonical: '/en/menu',
      languages: { en: '/en/menu', ar: '/ar/menu', 'x-default': '/ar/menu' },
    });
  });

  it('404s a foreign locale segment before reading the cookie or the menu', async () => {
    cookieJar.table = 'tp-fixture-token';
    await expect(renderServerPage(CafeMenuPage, 'xx' as Locale)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
