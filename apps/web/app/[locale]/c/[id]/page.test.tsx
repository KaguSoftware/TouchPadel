import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatIQD, t, type Locale } from '@touch/i18n';
import { resetSiteRequest } from '@/lib/site/testSupport';
import {
  COACH_ALI,
  COACH_HIDDEN,
  COACH_SARA,
  COACHING_ERROR,
  COACHING_OFF,
  NEVER_SHOWN,
  PRICES,
  coachingAnswer,
  coachingRead,
  coachingServer,
  resetCoachingServer,
} from '@/test/coachingFixtures';
import CoachLinkPage, { dynamic, generateMetadata } from './page';

/**
 * The coach link, `/{locale}/c/<coachId>` (docs/design/coaching/guest.md §4.12, §4.14.3, §4.17),
 * in both languages: a found coach shows their card and the types they teach (prices only where
 * the branch shows them); an unknown, malformed, hidden or switched-off coach all read the same
 * "not taking bookings online"; a failed read says so; Open in the app carries
 * `touchpadel://c/<id>` (the app's home when nobody was found) and nothing jumps by itself; the
 * page is never indexed and sends no referrer. The read is mocked at `@/lib/coaching.server`.
 */
vi.mock('@/lib/coaching.server', async () => {
  const { coachingServer } = await import('@/test/coachingFixtures');
  return {
    getCachedCoaching: () => {
      coachingServer.calls += 1;
      return Promise.resolve(coachingServer.read);
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

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const LOCALES = ['en', 'ar'] as const;
const ENV = { ...process.env };

const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u2066-\u2069]/g, '');
const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

async function renderLink(locale: string, id: string = COACH_ALI) {
  const element = await CoachLinkPage({ params: Promise.resolve({ locale, id }) });
  return render(element);
}

const metadata = (locale: string, id: string = COACH_ALI) =>
  generateMetadata({ params: Promise.resolve({ locale, id }) });

beforeEach(() => {
  resetSiteRequest();
  resetCoachingServer(coachingRead(coachingAnswer()));
  coachingServer.calls = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

afterEach(() => {
  process.env = { ...ENV };
  coachingServer.read = COACHING_OFF;
});

describe.each(LOCALES)('coach link page (%s)', (locale: Locale) => {
  const name = locale === 'ar' ? 'علي التجربة' : 'Ali Fixture';

  it('shows the coach: photo, name, where they teach, bio and the lesson types they teach', async () => {
    const { container } = await renderLink(locale);
    expect(container.querySelector('.tp-clink')?.getAttribute('data-state')).toBe('found');
    expect(heading()).toBe(name);
    expect(screen.getByText(t(locale, 'coaching.web.link.eyebrow'))).toBeTruthy();
    expect(container.querySelector('.tp-clink__photo img')).not.toBeNull();
    expect(plain(container.querySelector('.tp-clink__at')?.textContent)).toBe(
      t(locale, 'coaching.web.link.at', {
        branches: locale === 'ar' ? 'بادل التجربة' : 'Fixture Padel',
      }),
    );
    expect(container.querySelector('.tp-clink__bio')?.textContent).toContain(
      locale === 'ar' ? 'عشر سنوات' : 'Ten years on court',
    );
    const types = [...container.querySelectorAll('.tp-clink__type-name')].map((n) => n.textContent);
    expect(types).toEqual(
      locale === 'ar' ? ['حصة خاصة', 'حصة جماعية'] : ['Private lesson', 'Group clinic'],
    );
    // Prices are private at this branch: none on the page.
    expect(container.querySelector('.tp-clink__type-price')).toBeNull();
    expect(plain(container.textContent)).not.toMatch(/IQD|د\.ع/);
  });

  it('shows the coach’s own prices once the branch shows them', async () => {
    resetCoachingServer(coachingRead(coachingAnswer({ pricesPublic: true })));
    const { container } = await renderLink(locale);
    const prices = [...container.querySelectorAll('.tp-clink__type-price')].map((p) =>
      plain(p.textContent),
    );
    expect(prices).toEqual([
      t(locale, 'coaching.web.pricePrivate', { price: formatIQD(PRICES.aliPrivate, locale) }),
      t(locale, 'coaching.web.pricePlace', { price: formatIQD(PRICES.group, locale) }),
    ]);
  });

  it('opens the app on the coach, offers the app band and every coach, and never jumps by itself', async () => {
    const { container } = await renderLink(locale);
    const open = screen.getByRole('link', { name: t(locale, 'coaching.web.link.open') });
    expect(open.getAttribute('href')).toBe(`touchpadel://c/${COACH_ALI}`);
    expect(
      screen.getByRole('link', { name: t(locale, 'coaching.web.link.noApp') }).getAttribute('href'),
    ).toBe(`/${locale}#app`);
    expect(
      screen
        .getByRole('link', { name: t(locale, 'coaching.web.link.allCoaches') })
        .getAttribute('href'),
    ).toBe(`/${locale}/coaching`);
    expect(container.querySelector('script')).toBeNull();
  });

  it.each([
    ['an unknown coach', '3f2b8c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b'],
    ['a coach the server leaves out (paused, retired or not yet public)', COACH_HIDDEN],
  ])('reads %s as not taking bookings online, and opens the app’s home', async (_, id) => {
    const { container } = await renderLink(locale, id);
    expect(container.querySelector('.tp-clink')?.getAttribute('data-state')).toBe('missing');
    expect(heading()).toBe(t(locale, 'coaching.web.link.notFound'));
    expect(
      screen.getByRole('link', { name: t(locale, 'coaching.web.link.open') }).getAttribute('href'),
    ).toBe('touchpadel://');
    expect(
      screen
        .getByRole('link', { name: t(locale, 'coaching.web.link.allCoaches') })
        .getAttribute('href'),
    ).toBe(`/${locale}/coaching`);
    expect(container.querySelector('.tp-clink__photo')).toBeNull();
  });

  it('reads coaching switched off exactly as an unknown coach', async () => {
    resetCoachingServer(COACHING_OFF);
    await renderLink(locale, COACH_SARA);
    expect(heading()).toBe(t(locale, 'coaching.web.link.notFound'));
  });

  it('says the page could not be loaded on a failed read, and still offers the coach in the app', async () => {
    resetCoachingServer(COACHING_ERROR);
    await renderLink(locale);
    expect(heading()).toBe(t(locale, 'coaching.web.link.error'));
    expect(
      screen.getByRole('link', { name: t(locale, 'coaching.web.link.open') }).getAttribute('href'),
    ).toBe(`touchpadel://c/${COACH_ALI}`);
  });

  it('names nobody but the coach: no profile id, phone or student', async () => {
    resetCoachingServer(coachingRead(coachingAnswer({ pricesPublic: true })));
    const { container } = await renderLink(locale);
    for (const secret of NEVER_SHOWN) expect(container.innerHTML, secret).not.toContain(secret);
  });

  it('keeps the coach across the language switch, and offers home and support', async () => {
    await renderLink(locale);
    const other = locale === 'en' ? 'ar' : 'en';
    expect(document.querySelector(`a[hreflang="${other}"]`)?.getAttribute('href')).toBe(
      `/${other}/c/${COACH_ALI}`,
    );
    expect(
      screen.getByRole('link', { name: t(locale, 'site.brandHome') }).getAttribute('href'),
    ).toBe(`/${locale}`);
    expect(
      screen.getByRole('link', { name: t(locale, 'site.footer.support') }).getAttribute('href'),
    ).toBe(`/${locale}/support`);
  });

  it('is never indexed, sends no referrer, and titles the page with the coach when found', async () => {
    const meta = await metadata(locale);
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.referrer).toBe('no-referrer');
    expect(meta.title).toBe(t(locale, 'coaching.web.link.metaTitle', { name }));
    const image = `og-touch-padel-${locale}.png`;
    expect(JSON.stringify(meta.openGraph)).toContain(image);
    expect(JSON.stringify(meta.twitter)).toContain(image);

    const missing = await metadata(locale, '3f2b8c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b');
    expect(missing.title).toBe(t(locale, 'coaching.web.link.title'));
    expect(missing.robots).toEqual({ index: false, follow: true });
  });

  it('paints in the visitor’s mode, in the padel theme, with its sheet under the nonce', async () => {
    const { container } = await renderLink(locale);
    const frame = container.querySelector('.tp-clink');
    expect(frame?.getAttribute('data-theme')).toBe('padel');
    expect(frame?.getAttribute('data-mode')).toBe('night');
    expect(container.querySelector('style')?.getAttribute('nonce')).toBe('test-nonce-0123456789');
  });
});

describe('coach link page, the id', () => {
  it.each([
    ['not a uuid', 'ali'],
    ['too short', COACH_ALI.slice(1)],
    ['a match token', 'Ab3_-x9ZqT0kLm2NpQr7sU'],
    ['markup', '"><script>alert(1)</script>'],
  ])(
    'never reads for an id that is %s: not found, the app home, the other language’s coaches',
    async (_, id) => {
      await renderLink('en', id);
      expect(coachingServer.calls).toBe(0);
      expect(heading()).toBe(t('en', 'coaching.web.link.notFound'));
      expect(
        screen.getByRole('link', { name: t('en', 'coaching.web.link.open') }).getAttribute('href'),
      ).toBe('touchpadel://');
      expect(document.querySelector('a[hreflang="ar"]')?.getAttribute('href')).toBe('/ar/coaching');
    },
  );

  it('reads an upper-case id as its coach', async () => {
    await renderLink('en', COACH_ALI.toUpperCase());
    expect(heading()).toBe('Ali Fixture');
  });
});

describe('coach link page, the route', () => {
  it('is rendered per request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('404s on a segment that is not a locale', async () => {
    await expect(renderLink('de')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(metadata('de')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sets no cookie and never jumps to the app: nothing on the page does either', () => {
    // Static, because a page render cannot observe a Set-Cookie or a navigation. The site's
    // LanguageLink and ThemeToggle both write a cookie on click, and OpenAppOnLoad jumps.
    const source = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    for (const src of [source('./page.tsx'), source('../../../../src/lib/site/coachLink.ts')]) {
      expect(src).not.toMatch(/document\.cookie|cookies\(\)\)?\.set\(|set-cookie/i);
      expect(src).not.toMatch(/import[^;]*\b(LanguageLink|ThemeToggle|OpenAppOnLoad)\b/);
      expect(src).not.toMatch(/location\.(replace|assign|href\s*=)/);
    }
  });
});
