import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { screen, within } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import {
  MENU_ERROR,
  MENU_FIXTURE,
  resetServerData,
  SECOND_BRANCH,
  serverData,
  VENUE_FIXTURE,
} from '@/test/fixtures';
import { cookieJar, pageProps, renderServerPage, resetCookieJar } from '@/test/renderPage';
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
/** Which branch each per-branch read was asked for, in call order. */
const reads = vi.hoisted(() => ({
  menu: [] as (string | null)[],
  settings: [] as (string | null)[],
  /** tokens `getTableBranch` was asked about, and the branch it answers */
  tokens: [] as string[],
  tableBranch: null as string | null,
}));

vi.mock('@/lib/menu.server', async () => {
  const { serverData, fixtureBranches } = await import('@/test/fixtures');
  return {
    getCachedMenu: (venueId: string | null = null) => {
      reads.menu.push(venueId);
      return Promise.resolve(serverData.menu);
    },
    getCachedCafeSettings: (venueId: string | null = null) => {
      reads.settings.push(venueId);
      return Promise.resolve(serverData.settings);
    },
    getCachedBranches: () => Promise.resolve(fixtureBranches()),
    getTableBranch: (token: string) => {
      reads.tokens.push(token);
      return Promise.resolve(reads.tableBranch);
    },
    getCachedVenue: () => Promise.resolve(fixtureBranches()[0] ?? null),
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
  reads.menu = [];
  reads.settings = [];
  reads.tokens = [];
  reads.tableBranch = null;
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
    const html = renderToString(await CafeMenuPage(pageProps('en')));
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

  it('reads the only open branch’s menu and settings, with no chooser and no branch strip', async () => {
    await renderServerPage(CafeMenuPage, 'en');

    expect(reads.menu).toEqual([VENUE_FIXTURE.id]);
    expect(reads.settings).toEqual([VENUE_FIXTURE.id]);
    expect(document.querySelector('.tp-branches')).toBeNull();
    expect(document.querySelector('.tp-branchbar')).toBeNull();
    expect(bandWords()).toHaveLength(MENU_FIXTURE.length);
  });

  it('falls back to the unfiltered read when the branch list could not be read', async () => {
    serverData.venue = null;
    await renderServerPage(CafeMenuPage, 'en');

    expect(reads.menu).toEqual([null]);
    expect(document.querySelector('.tp-branches')).toBeNull();
  });

  describe('two open branches', () => {
    beforeEach(() => {
      serverData.branches = [VENUE_FIXTURE, SECOND_BRANCH];
    });

    it('asks a walk-in which branch first, one link per branch, and reads no menu', async () => {
      await renderServerPage(CafeMenuPage, 'en');

      expect(
        screen.getByRole('heading', { level: 1, name: t('en', 'branches.web.menuPickerTitle') }),
      ).toBeTruthy();
      expect(screen.getByText(t('en', 'branches.web.menuPickerHint'))).toBeTruthy();
      const list = screen.getByRole('list', { name: t('en', 'branches.common.chooseBranch') });
      const links = within(list).getAllByRole('link');
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        '/en/menu?b=fixture-a',
        '/en/menu?b=fixture-b',
      ]);
      expect(links[0]?.textContent).toContain(VENUE_FIXTURE.name_en);
      // The second branch has its address stored; the first has none (no fallback line here).
      expect(links[1]?.textContent).toContain(SECOND_BRANCH.address_en);
      expect(reads.menu).toEqual([]);
      expect(bandWords()).toEqual([]);
    });

    it('names the branches in Arabic at /ar', async () => {
      await renderServerPage(CafeMenuPage, 'ar');

      expect(screen.getByText(t('ar', 'branches.web.menuPickerTitle'))).toBeTruthy();
      expect(screen.getByText(SECOND_BRANCH.name_ar)).toBeTruthy();
      expect(screen.getByText(SECOND_BRANCH.address_ar!)).toBeTruthy();
      expect(screen.queryByText(SECOND_BRANCH.name_en)).toBeNull();
    });

    it('serves the chosen branch’s menu for ?b=<slug>, with a way back to the chooser', async () => {
      await renderServerPage(CafeMenuPage, 'en', { b: 'fixture-b' });

      expect(reads.menu).toEqual([SECOND_BRANCH.id]);
      expect(reads.settings).toEqual([SECOND_BRANCH.id]);
      expect(document.querySelector('.tp-branches')).toBeNull();
      const strip = document.querySelector<HTMLElement>('.tp-branchbar')!;
      expect(strip.textContent).toContain(SECOND_BRANCH.name_en);
      expect(
        within(strip)
          .getByRole('link', { name: t('en', 'branches.common.changeBranch') })
          .getAttribute('href'),
      ).toBe('/en/menu');
      expect(bandWords()).toHaveLength(MENU_FIXTURE.length);
    });

    it('asks again for a slug that is not an open branch', async () => {
      await renderServerPage(CafeMenuPage, 'en', { b: 'closed-branch' });

      expect(document.querySelector('.tp-branches')).not.toBeNull();
      expect(reads.menu).toEqual([]);
    });

    it('serves a table guest their table’s branch on first paint, never the chooser', async () => {
      cookieJar.table = 'tp-fixture-token';
      reads.tableBranch = SECOND_BRANCH.id;
      await renderServerPage(CafeMenuPage, 'en');

      expect(reads.tokens).toEqual(['tp-fixture-token']);
      expect(reads.menu).toEqual([SECOND_BRANCH.id]);
      expect(reads.settings).toEqual([SECOND_BRANCH.id]);
      expect(document.querySelector('.tp-branches')).toBeNull();
      expect(document.querySelector('.tp-branchbar')).toBeNull();
      expect(document.querySelector('.tp-cafe__table')).not.toBeNull();
    });

    it('lets the table beat a ?b= slug', async () => {
      cookieJar.table = 'tp-fixture-token';
      reads.tableBranch = SECOND_BRANCH.id;
      await renderServerPage(CafeMenuPage, 'en', { b: 'fixture-a' });

      expect(reads.menu).toEqual([SECOND_BRANCH.id]);
    });

    it('falls back to the default branch when the token names no open branch', async () => {
      cookieJar.table = 'tp-fixture-token';
      await renderServerPage(CafeMenuPage, 'en');

      expect(reads.tokens).toEqual(['tp-fixture-token']);
      expect(document.querySelector('.tp-branches')).toBeNull();
      expect(reads.menu).toEqual([VENUE_FIXTURE.id]);
    });
  });

  it('does not ask which branch a table is at while only one is open', async () => {
    cookieJar.table = 'tp-fixture-token';
    await renderServerPage(CafeMenuPage, 'en');

    expect(reads.tokens).toEqual([]);
    expect(reads.menu).toEqual([VENUE_FIXTURE.id]);
  });

  it('404s a foreign locale segment before reading the cookie or the menu', async () => {
    cookieJar.table = 'tp-fixture-token';
    await expect(renderServerPage(CafeMenuPage, 'xx' as Locale)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
