import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { MENU_ERROR, MENU_FIXTURE, resetServerData, serverData } from '@/test/fixtures';
import { renderServerPage } from '@/test/renderPage';
import CafeRootPage from './page';

/**
 * The cafe root — `/{locale}` — is the page a walk-in guest lands on: the whole
 * app with `token: null`, so "send" and "call waiter" ask for the table QR.
 *
 * This is a SMOKE render: it proves the page composes and picks the reading
 * language, not that the design is right (that is `e2e/tests/cafe-*.spec.ts`).
 * The reads are mocked at `@/lib/menu.server` so no Supabase stack is needed,
 * and `useSupabase` returns null so every live feature degrades exactly as it
 * does on a deployment with no public env vars.
 */
vi.mock('@/lib/menu.server', async () => {
  const { serverData } = await import('@/test/fixtures');
  return {
    getCachedMenu: () => Promise.resolve(serverData.menu),
    getCachedCafeSettings: () => Promise.resolve(serverData.settings),
    getCachedVenue: () => Promise.resolve(serverData.venue),
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
});

describe.each(LOCALES)('cafe root page (%s)', (locale: Locale) => {
  it('renders the app shell with no table bound', async () => {
    await renderServerPage(CafeRootPage, locale);

    // The lockup's alt text is the cafe name in the reading language.
    expect(screen.getByAltText(t(locale, 'common.cafeName'))).toBeTruthy();
    // token === null ⇒ TableChip renders nothing, so no "scan again" affordance.
    expect(screen.queryByRole('button', { name: t(locale, 'cafe.scanAgain') })).toBeNull();
    expect(document.querySelector('.tp-cafe__table')).toBeNull();
  });

  it('names its categories in the reading language', async () => {
    await renderServerPage(CafeRootPage, locale);

    const expected = MENU_FIXTURE.map((c) =>
      locale === 'ar' ? c.name_ar : c.name_en.toUpperCase(),
    );
    expect(bandWords()).toEqual(expected);

    // The other language's category name must not be on the page at all.
    const other = MENU_FIXTURE.map((c) => (locale === 'ar' ? c.name_en.toUpperCase() : c.name_ar));
    for (const word of other) expect(bandWords()).not.toContain(word);
  });

  it('prints every item row in the reading language', async () => {
    await renderServerPage(CafeRootPage, locale);

    for (const category of MENU_FIXTURE) {
      for (const item of category.items) {
        expect(screen.getByText(locale === 'ar' ? item.name_ar : item.name_en)).toBeTruthy();
      }
    }
  });

  /**
   * DIRECTION: `dir` is set in exactly one place in this app — `<html>` in
   * `app/[locale]/layout.tsx:108`, from `dirAttr(locale)`. A page test renders
   * the PAGE, not the layout, so there is no RTL wrapper below it to assert on
   * (grep `dir=` under src/components/cafe: only the phone link and the brand
   * wordmark force `ltr`, and the stylesheets key off `[dir='rtl']` on the
   * document). So Arabic is asserted here as the Arabic catalog strings the
   * page chose; the rendered direction is `e2e/tests/cafe-rtl-layout.spec.ts`.
   */
  it('renders a status, not a blank menu, when the read model failed', async () => {
    serverData.menu = MENU_ERROR;
    await renderServerPage(CafeRootPage, locale);

    const status = screen.getByRole('status');
    expect(status.className).toContain('tp-menu-unavailable');
    expect(status.textContent).toContain(t(locale, 'cafe.menuUnavailable.title'));
    expect(status.textContent).toContain(t(locale, 'cafe.menuUnavailable.body'));
    expect(screen.getByRole('button', { name: t(locale, 'common.retry') })).toBeTruthy();
    // and nothing from the menu stage
    expect(bandWords()).toEqual([]);
  });
});
