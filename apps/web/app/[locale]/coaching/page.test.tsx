import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { countPhrase, formatIQD, t, type Locale } from '@touch/i18n';
import { resetServerData, serverData, VENUE_FIXTURE } from '@/test/fixtures';
import { renderServerPage } from '@/test/renderPage';
import { resetSiteRequest } from '@/lib/site/testSupport';
import {
  BRANCH_A,
  BRANCH_B,
  COACH_ALI,
  COACH_HIDDEN,
  COACH_OMAR,
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
import CoachingPage, { generateMetadata } from './page';

/**
 * Coaching at Touch, `/{locale}/coaching` (docs/design/coaching/guest.md §4.14.2, §4.17), in
 * both languages: each state of the read renders its own words; the coach cards link to their
 * `/c/` pages; places left is a counted phrase; prices show only where the branch's switch is on,
 * even though the answer always carries them (C-11); and no profile id, phone or student reaches
 * the page (a value scan, R43). The read is mocked at `@/lib/coaching.server`; its parsing is
 * src/lib/coaching.test.ts, the look and the rendered direction are Playwright's
 * (e2e/tests/site-coaching.spec.ts).
 */
vi.mock('@/lib/menu.server', async () => {
  const { serverData } = await import('@/test/fixtures');
  return { getCachedVenue: () => Promise.resolve(serverData.venue) };
});

vi.mock('@/lib/coaching.server', async () => {
  const { coachingServer } = await import('@/test/coachingFixtures');
  return { getCachedCoaching: () => Promise.resolve(coachingServer.read) };
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

/** Strip bidi isolates, so a sentence can be compared as the eye reads it. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u2066-\u2069]/g, '');
const main = () => document.querySelector('main')!;
const cards = () => [...document.querySelectorAll<HTMLElement>('.tp-coach-card')];

beforeEach(() => {
  resetServerData();
  resetSiteRequest();
  resetCoachingServer(coachingRead(coachingAnswer()));
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  delete process.env.NEXT_PUBLIC_APP_STORE_URL;
  delete process.env.NEXT_PUBLIC_PLAY_STORE_URL;
});

afterEach(() => {
  process.env = { ...ENV };
});

describe.each(LOCALES)('coaching page (%s)', (locale: Locale) => {
  const tr = (key: Parameters<typeof t>[1], vars?: Parameters<typeof t>[2]) => t(locale, key, vars);

  it('heads the page with the two-line title and the intro', async () => {
    await renderServerPage(CoachingPage, locale);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toContain(tr('coaching.web.titleOne'));
    expect(h1.textContent).toContain(tr('coaching.web.titleTwo'));
    expect(screen.getByText(tr('coaching.web.intro'))).toBeTruthy();
    expect(document.querySelector('.tp-coaching')?.getAttribute('data-status')).toBe('ok');
  });

  it('shows a card per coach: photo or letter, name, bio, what they teach, Book in the app', async () => {
    await renderServerPage(CoachingPage, locale);
    expect(cards().map((c) => c.dataset.coach)).toEqual([COACH_ALI, COACH_SARA]);
    const [ali, sara] = cards() as [HTMLElement, HTMLElement];

    expect(
      within(ali).getByRole('heading', { name: locale === 'ar' ? 'علي التجربة' : 'Ali Fixture' }),
    ).toBeTruthy();
    expect(ali.querySelector('.tp-coach-card__photo img')).not.toBeNull();
    expect(ali.querySelector('.tp-coach-card__photo img')?.getAttribute('alt')).toBe('');
    expect(ali.querySelector('.tp-coach-card__bio')?.textContent).toBe(
      locale === 'ar'
        ? 'عشر سنوات في الملعب، صبور مع المبتدئين.'
        : 'Ten years on court. Patient with beginners, sharp with the bandeja.',
    );
    const types = [...ali.querySelectorAll('.tp-coach-card__types li')].map((li) => li.textContent);
    expect(types).toEqual(
      locale === 'ar' ? ['حصة خاصة', 'حصة جماعية'] : ['Private lesson', 'Group clinic'],
    );

    // No photo: the first letter, hidden from screen readers (the name follows).
    const letter = sara.querySelector('.tp-coach-card__photo');
    expect(letter?.hasAttribute('data-letter')).toBe(true);
    expect(letter?.getAttribute('aria-hidden')).toBe('true');
    expect(letter?.textContent).toBe(locale === 'ar' ? 'س' : 'S');
    // An empty bio prints nothing.
    expect(sara.querySelector('.tp-coach-card__bio')).toBeNull();

    // Every card books through its coach's link; the app claims it where installed.
    for (const [card, id] of [
      [ali, COACH_ALI],
      [sara, COACH_SARA],
    ] as const) {
      const book = card.querySelector('a.tp-coach-card__book')!;
      expect(book.getAttribute('href')).toBe(`/${locale}/c/${id}`);
      expect(book.textContent).toContain(tr('coaching.web.bookInApp'));
    }
  });

  it('lists the lesson types by kind, and the upcoming sessions with places left', async () => {
    await renderServerPage(CoachingPage, locale);
    const kinds = [...document.querySelectorAll<HTMLElement>('.tp-coach-types__group')];
    expect(kinds.map((k) => k.dataset.kind)).toEqual(['private', 'group', 'course']);
    expect(kinds.map((k) => k.querySelector('.tp-coach-types__kind')?.textContent)).toEqual([
      tr('coaching.web.kind.private'),
      tr('coaching.web.kind.group'),
      tr('coaching.web.kind.course'),
    ]);

    const sessions = [...document.querySelectorAll<HTMLAnchorElement>('a.tp-coach-session')];
    expect(sessions).toHaveLength(2);
    const [group, course] = sessions as [HTMLAnchorElement, HTMLAnchorElement];
    expect(group.getAttribute('href')).toBe(`/${locale}/c/${COACH_ALI}`);
    expect(group.querySelector('.tp-coach-session__places')?.textContent).toBe(
      countPhrase('coaching.web.count.placesLeft', 3, locale),
    );
    expect(plain(group.querySelector('.tp-coach-session__who')?.textContent)).toBe(
      tr('coaching.web.withCoach', { coach: locale === 'ar' ? 'علي التجربة' : 'Ali Fixture' }),
    );
    expect(course.getAttribute('href')).toBe(`/${locale}/c/${COACH_SARA}`);
    expect(course.querySelector('.tp-coach-session__what')?.textContent).toBe(
      locale === 'ar' ? 'مبتدئو أكتوبر' : 'October beginners',
    );
    expect(course.querySelector('.tp-coach-session__places')?.textContent).toBe(
      countPhrase('coaching.web.count.placesLeft', 2, locale),
    );
    // A coach the server did not send has no session here.
    expect(document.querySelector(`a[href$="/c/${COACH_HIDDEN}"]`)).toBeNull();
  });

  it('shows no price while the branch keeps them private, though the answer carries them', async () => {
    const { container } = await renderServerPage(CoachingPage, locale);
    const text = plain(main().textContent);
    for (const p of Object.values(PRICES)) {
      expect(text).not.toContain(formatIQD(p, locale));
      expect(container.innerHTML).not.toContain(String(p));
    }
    expect(text).not.toMatch(/IQD|د\.ع/);
    expect(
      document.querySelector(
        '.tp-coach-card__price, .tp-coach-type__price, .tp-coach-session__price',
      ),
    ).toBeNull();
  });

  it('shows the prices, formatted, when the branch has switched them on', async () => {
    resetCoachingServer(coachingRead(coachingAnswer({ pricesPublic: true })));
    await renderServerPage(CoachingPage, locale);
    const [ali] = cards() as [HTMLElement];
    expect(plain(ali.querySelector('.tp-coach-card__price')?.textContent)).toBe(
      tr('coaching.web.from', { price: formatIQD(PRICES.group, locale) }),
    );
    const typePrices = [...document.querySelectorAll('.tp-coach-type__price')].map((p) =>
      plain(p.textContent),
    );
    expect(typePrices).toEqual([
      tr('coaching.web.pricePrivate', { price: formatIQD(PRICES.private, locale) }),
      tr('coaching.web.pricePlace', { price: formatIQD(PRICES.group, locale) }),
      tr('coaching.web.priceCourse', { price: formatIQD(PRICES.course, locale) }),
    ]);
    // A group session costs a place; a course not yet started, the whole course.
    const sessionPrices = [...document.querySelectorAll('.tp-coach-session__price')].map((p) =>
      plain(p.textContent),
    );
    expect(sessionPrices).toEqual([
      tr('coaching.web.pricePlace', { price: formatIQD(PRICES.group, locale) }),
      tr('coaching.web.priceCourse', { price: formatIQD(PRICES.course, locale) }),
    ]);
  });

  it('never prints a profile id, a phone or a student, even when the answer carries them', async () => {
    resetCoachingServer(coachingRead(coachingAnswer({ pricesPublic: true })));
    const { container } = await renderServerPage(CoachingPage, locale);
    const html = main().innerHTML;
    for (const secret of NEVER_SHOWN) expect(html, secret).not.toContain(secret);
    expect(container.innerHTML).not.toMatch(/profile_id|full_name/);
  });

  it('heads each branch with its name when more than one has coaches', async () => {
    resetCoachingServer(coachingRead(coachingAnswer({ secondBranch: true })));
    await renderServerPage(CoachingPage, locale);
    const branches = [...document.querySelectorAll<HTMLElement>('.tp-coaching__branch')];
    expect(branches.map((b) => b.dataset.branch)).toEqual([BRANCH_A, BRANCH_B]);
    expect(branches.map((b) => b.querySelector('h2')?.textContent)).toEqual(
      locale === 'ar'
        ? ['بادل التجربة', 'بادل التجربة الثاني']
        : ['Fixture Padel', 'Fixture Padel Two'],
    );
    const [a, b] = branches as [HTMLElement, HTMLElement];
    expect(within(a).getAllByRole('heading', { level: 3 })[0]?.textContent).toBe(
      tr('coaching.web.coachesTitle'),
    );
    expect(
      [...b.querySelectorAll<HTMLElement>('.tp-coach-card')].map((c) => c.dataset.coach),
    ).toEqual([COACH_OMAR]);
    // Branch A keeps its prices private; branch B shows its own.
    expect(a.querySelector('.tp-coach-type__price')).toBeNull();
    expect(plain(b.querySelector('.tp-coach-type__price')?.textContent)).toContain(
      formatIQD(40000, locale),
    );
  });

  it('points to the app, and keeps the WhatsApp ask while the app is in no store', async () => {
    await renderServerPage(CoachingPage, locale);
    const app = document.querySelector<HTMLElement>('.tp-coaching__app')!;
    expect(
      within(app)
        .getByRole('link', { name: tr('coaching.web.getApp') })
        .getAttribute('href'),
    ).toBe(`/${locale}#app`);
    expect(app.querySelector('.tp-stores')).not.toBeNull();
    const ask = app.querySelector('a[data-contact="whatsapp"]');
    expect(ask?.textContent).toContain(tr('site.lessons.cta'));
    expect(ask?.getAttribute('href')).toMatch(/^https:\/\/wa\.me\//);

    document.body.innerHTML = '';
    process.env.NEXT_PUBLIC_APP_STORE_URL = 'https://apps.apple.com/app/id6809045183';
    await renderServerPage(CoachingPage, locale);
    expect(document.querySelector('.tp-coaching__app a[data-contact="whatsapp"]')).toBeNull();
  });

  it.each([
    ['off', COACHING_OFF],
    ['empty', coachingRead({ ...coachingAnswer(), coaches: [] })],
  ])('turns %s into the head and the lessons ask, never a blank page', async (_state, read) => {
    resetCoachingServer(read);
    await renderServerPage(CoachingPage, locale);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      tr('coaching.web.titleOne'),
    );
    expect(screen.getByText(tr('site.lessons.body'))).toBeTruthy();
    const ask = main().querySelector('a[data-contact="whatsapp"]');
    expect(ask?.textContent).toContain(tr('site.lessons.cta'));
    expect(cards()).toHaveLength(0);
    expect(document.querySelector('.tp-coaching__error')).toBeNull();
  });

  it('says the coaches could not be loaded above the same ask on a failed read', async () => {
    resetCoachingServer(COACHING_ERROR);
    await renderServerPage(CoachingPage, locale);
    expect(document.querySelector('.tp-coaching__error')?.textContent).toBe(
      tr('coaching.web.error'),
    );
    expect(screen.getByText(tr('site.lessons.body'))).toBeTruthy();
    expect(cards()).toHaveLength(0);
  });

  it('plans the visit instead when the desk has no number to message', async () => {
    resetCoachingServer(COACHING_OFF);
    serverData.venue = { ...VENUE_FIXTURE, phone: null };
    await renderServerPage(CoachingPage, locale);
    const visit = main().querySelector('a[data-contact="visit"]');
    expect(visit?.getAttribute('href')).toBe(`/${locale}#visit`);
  });

  it('is the current page in the footer', async () => {
    await renderServerPage(CoachingPage, locale);
    const current = screen.getByRole('contentinfo').querySelector('a[aria-current="page"]');
    expect(current?.getAttribute('href')).toBe(`/${locale}/coaching`);
    expect(current?.textContent).toBe(tr('site.footer.coaching'));
  });
});

describe('coaching page metadata', () => {
  it.each(LOCALES)(
    'is indexed, with its canonical, the hreflang pair and the site’s share image (%s)',
    async (locale) => {
      const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
      expect(meta.robots).toEqual({ index: true, follow: true });
      expect(meta.alternates).toEqual({
        canonical: `/${locale}/coaching`,
        languages: { en: '/en/coaching', ar: '/ar/coaching', 'x-default': '/ar/coaching' },
      });
      expect(meta.title).toEqual({
        absolute: `${t(locale, 'coaching.web.metaTitle')} · ${t(locale, 'common.appName')}`,
      });
      expect(meta.description).toBe(t(locale, 'coaching.web.metaDescription'));
      const og = meta.openGraph as { images: { url: string }[] };
      expect(og.images[0]!.url).toBe(
        `https://www.touch-padel.com/brand/site/og-touch-padel-${locale}.png?v=2`,
      );
      expect(JSON.stringify(meta.twitter)).toContain(`og-touch-padel-${locale}.png`);
    },
  );

  it('404s a foreign locale', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ locale: 'fr' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    await expect(renderServerPage(CoachingPage, 'fr' as Locale)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

// Keep the shared read state from leaking into another file's cases.
afterEach(() => {
  coachingServer.read = COACHING_OFF;
});
