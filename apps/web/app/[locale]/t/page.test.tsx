import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { FLAT_WHITE, resetServerData } from '@/test/fixtures';
import { cookieJar, renderServerPage, resetCookieJar } from '@/test/renderPage';
import TableSessionPage from './page';

/**
 * `/{locale}/t` — the table page AFTER proxy.ts has moved the printed token out
 * of the URL and into the HttpOnly `tp-table` cookie (see the page's own box).
 *
 * The two states that matter here are the cookie's: a scanned guest (token →
 * `<CafeApp token=…>` → a table chip in the top bar) and a bookmarked guest
 * with no cookie, who must get the same walk-in menu the site root renders
 * rather than an error.
 *
 * `useSupabase` is null, so the binding never reaches Supabase and
 * `useTableSession` lands on `error` — which is precisely the chip the guest is
 * meant to be able to tap ("scan the QR again"). The BOUND chip needs a live
 * `app.open_table_session`, so it belongs to `e2e/tests/cafe-*.spec.ts`.
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

beforeEach(() => {
  resetServerData();
  resetCookieJar();
});

describe.each(LOCALES)('table page (%s)', (locale: Locale) => {
  it('renders the menu with a table chip when the tp-table cookie is present', async () => {
    cookieJar.table = 'tp-fixture-token';
    await renderServerPage(TableSessionPage, locale);

    const chip = document.querySelector('.tp-cafe__table');
    expect(chip).not.toBeNull();
    // The token reached CafeApp, so TableChip is mounted; with no Supabase
    // client the binding fails and the chip is the tappable re-scan notice.
    expect(chip?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('button', { name: t(locale, 'cafe.scanAgain') })).toBeTruthy();

    // and the menu itself is on screen, in the reading language
    expect(
      screen.getByText(locale === 'ar' ? FLAT_WHITE.name_ar : FLAT_WHITE.name_en),
    ).toBeTruthy();
  });

  it('falls back to the walk-in menu when the cookie has aged out', async () => {
    await renderServerPage(TableSessionPage, locale);

    // No cookie ⇒ token null ⇒ TableChip renders nothing at all (state 'none').
    expect(document.querySelector('.tp-cafe__table')).toBeNull();
    expect(screen.getByAltText(t(locale, 'common.cafeName'))).toBeTruthy();
    expect(
      screen.getByText(locale === 'ar' ? FLAT_WHITE.name_ar : FLAT_WHITE.name_en),
    ).toBeTruthy();
  });
});
