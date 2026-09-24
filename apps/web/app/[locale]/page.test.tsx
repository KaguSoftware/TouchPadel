import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import {
  MENU_ERROR,
  MENU_FIXTURE,
  resetServerData,
  serverData,
  VENUE_FIXTURE,
} from '@/test/fixtures';
import { renderServerPage } from '@/test/renderPage';
import { resetSiteRequest, siteRequest, TEST_NONCE } from '@/lib/site/testSupport';
import { DEFAULT_MAPS_URL } from '@/lib/site/contact';
import { PHOTO_GRADE_ID, PHOTO_GRADE_RAMP, rampTables } from '@/lib/site/photoGrade';
import { hoursPhrase } from '@/lib/site/plural';
import { cafeCategoryList } from '@/lib/site/landing';
import HomePage, { generateMetadata, generateViewport } from './page';

/**
 * The Touch Padel home page, `/{locale}` (contracts-2026-09-23 §0, Revision B): THE CLUB,
 * not the app. Hero, the club with the court, lessons, events (coming soon), Touch Cafe,
 * one app band, the first-visit questions, the visit block, in that order.
 *
 * A SMOKE render with every data state: it proves the page composes, speaks the reading
 * language, builds every booking button from the one venue phone (WhatsApp pre-filled in
 * the page's language, a call), and designs each degraded state: the venue read failed,
 * no phone or an undiallable one ("Plan your visit" everywhere), no café categories,
 * Instagram and the pinned map link set or unset. The look is Playwright's job
 * (e2e/tests/site-landing.spec.ts). Reads are mocked at `@/lib/menu.server`; the mode
 * cookie and CSP nonce at `@/lib/site/mode.server`; the live court (a WebGL canvas) is a
 * stand-in that keeps its contract: a labelled picture plus the children riding the net.
 */
vi.mock('@/lib/menu.server', async () => {
  const { serverData } = await import('@/test/fixtures');
  return {
    getCachedMenu: () => Promise.resolve(serverData.menu),
    getCachedCafeSettings: () => Promise.resolve(serverData.settings),
    getCachedVenue: () => Promise.resolve(serverData.venue),
  };
});

vi.mock('@/lib/site/mode.server', async () => {
  const { siteRequest } = await import('@/lib/site/testSupport');
  return {
    getSiteMode: () => Promise.resolve(siteRequest.mode),
    getRequestNonce: () => Promise.resolve(siteRequest.nonce),
  };
});

vi.mock('@/features/court3d', () => ({
  CourtStage: ({ label, children }: { label: string; children?: ReactNode }) => (
    <div className="tp-court-stage">
      <div role="img" aria-label={label} />
      <div className="tp-court-stage__overlay">{children}</div>
    </div>
  ),
  CourtIllustration: () => null,
  courtCss: '.tp-court-stage{}',
}));

// What Next's loader makes of `import hero from '…/hero.jpg'` (size + blur placeholder);
// Vite would hand over a bare URL string, which next/image rightly refuses to blur.
vi.mock('@/components/landing/photos', () => {
  const still = (name: string) => ({
    src: `/_next/static/media/${name}.jpg`,
    width: 2400,
    height: 1600,
    blurWidth: 8,
    blurHeight: 5,
    blurDataURL:
      'data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/wAALCAAFAAgBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKp//9k=',
  });
  return {
    PHOTOS: {
      hero: still('hero'),
      club: still('club'),
      lessons: still('lessons'),
      cafe: still('cafe'),
      events: still('events'),
    },
  };
});

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const LOCALES = ['en', 'ar'] as const;
/** The fixture phone, +964 770 000 0000, as wa.me and tel: spell it. */
const DIGITS = '9647700000000';

/** Strip bidi isolates, so a sentence can be compared as the eye reads it. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u2066-\u2069]/g, '');

/** A name made of the visible label then a screen-reader-only part (jsdom may space them). */
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelThen = (label: string, rest: string) =>
  new RegExp(`^${esc(label)}\\s*${esc(rest.trim())}$`);
/** The fixture phone as the page prints it. */
const PRINTED = '+964 770 000 0000';

/** The pre-filled WhatsApp message a link carries, decoded. */
const waText = (a: Element) => new URL(a.getAttribute('href')!).searchParams.get('text');

const section = (selector: string) => document.querySelector<HTMLElement>(selector)!;

beforeEach(() => {
  resetServerData();
  resetSiteRequest();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(LOCALES)('home page (%s)', (locale: Locale) => {
  const tr = (key: Parameters<typeof t>[1], vars?: Parameters<typeof t>[2]) => t(locale, key, vars);

  it('presents the club, section by section, in the contract’s order', async () => {
    await renderServerPage(HomePage, locale);

    const main = document.querySelector('main')!;
    const order = [
      '.tp-front',
      '#club',
      '#lessons',
      '.tp-events',
      '.tp-cafe-handoff',
      '.tp-appband',
      '#faq',
      '#visit',
    ].map((sel) => main.querySelector(sel));
    for (const el of order) expect(el).not.toBeNull();
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // Every section is named by its own heading.
    for (const el of main.querySelectorAll('section')) {
      const id = el.getAttribute('aria-labelledby');
      expect(id && document.getElementById(id)?.textContent, el.className).toBeTruthy();
    }
  });

  it('leads with the two-weight headline, where the club is and its live hours', async () => {
    await renderServerPage(HomePage, locale);

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(plain(h1s[0]!.textContent)).toBe(
      `${tr('site.hero.lineOne')} ${tr('site.hero.lineTwo')}`,
    );
    expect(plain(section('.tp-front__lead').textContent)).toBe(
      plain(tr('site.hero.lead', { hours: '09:00–23:00' })),
    );
    expect(section('.tp-front').querySelector('.tp-open')).not.toBeNull();
    expect(screen.getByRole('img', { name: tr('site.photos.heroAlt') })).toBeTruthy();
  });

  it('books on WhatsApp in the page’s language, or calls the desk', async () => {
    await renderServerPage(HomePage, locale);

    const hero = section('.tp-front');
    const book = within(hero).getByRole('link', { name: tr('site.hero.ctaWhatsApp') });
    expect(book.getAttribute('href')!.startsWith(`https://wa.me/${DIGITS}?text=`)).toBe(true);
    expect(waText(book)).toBe(tr('site.whatsapp.court'));
    expect(
      within(hero)
        .getByRole('link', { name: tr('site.hero.ctaCall') })
        .getAttribute('href'),
    ).toBe(`tel:+${DIGITS}`);
    // The app is one band further down, never the hero's action.
    expect(hero.querySelector('a[href="#app"]')).toBeNull();
  });

  it('heads the page with the club’s sections and a green Book a court', async () => {
    await renderServerPage(HomePage, locale);

    // jsdom applies the sheet but not its media queries, so it sees the phone layout: the
    // section links, the language and the theme sit in the closed small-screen panel.
    const hidden = { hidden: true };
    const nav = screen.getByRole('navigation', { name: tr('site.nav.label'), ...hidden });
    const links = within(nav)
      .getAllByRole('link', hidden)
      .map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      [tr('site.nav.club'), '#club'],
      [tr('site.nav.lessons'), '#lessons'],
      [tr('site.nav.menu'), `/${locale}/menu`],
      [tr('site.nav.visit'), '#visit'],
    ]);
    for (const id of ['club', 'lessons', 'visit'])
      expect(document.getElementById(id)).not.toBeNull();

    const banner = screen.getByRole('banner');
    const book = within(banner).getByRole('link', {
      name: labelThen(tr('site.nav.book'), tr('site.onWhatsApp')),
    });
    expect(book.className).toContain('tp-site-btn--go');
    expect(waText(book)).toBe(tr('site.whatsapp.court'));
    // The language, the theme, and the small-screen toggle that never hides the booking.
    const other = locale === 'ar' ? 'en' : 'ar';
    expect(
      within(banner)
        .getByRole('link', {
          name: labelThen(tr('site.nav.language'), `(${tr('site.nav.languageLabel')})`),
          ...hidden,
        })
        .getAttribute('href'),
    ).toBe(`/${other}`);
    expect(
      within(banner).getByRole('button', { name: tr('site.theme.toLight'), ...hidden }),
    ).toBeTruthy();
    const toggle = within(banner).getByRole('button', { name: tr('site.nav.toggle') });
    expect(toggle.getAttribute('aria-controls')).toBe(
      banner.querySelector('.tp-site-menu')!.getAttribute('id'),
    );
    expect(banner.querySelector('.tp-site-menu')!.contains(book)).toBe(false);
  });

  it('shows the club: the confirmed points, the court, Book a court on its net', async () => {
    await renderServerPage(HomePage, locale);

    const club = section('#club');
    expect(plain(within(club).getByRole('heading', { level: 2 }).textContent)).toBe(
      `${tr('site.club.titleOne')} ${tr('site.club.titleTwo')}`,
    );
    expect([...club.querySelectorAll('.tp-point')].map((li) => plain(li.textContent))).toEqual([
      tr('site.club.pointIndoor'),
      plain(tr('site.club.pointHours', { hours: '09:00–23:00' })),
      tr('site.club.pointRent'),
      tr('site.club.pointLockers'),
    ]);
    expect(within(club).getByRole('img', { name: tr('site.club.courtLabel') })).toBeTruthy();
    const net = club.querySelector('.tp-court-stage__overlay a')!;
    // The label, and for screen readers the cue that it opens WhatsApp; the glyph for the eye.
    expect(net.textContent).toBe(`${tr('site.club.courtCta')}${tr('site.onWhatsApp')}`);
    expect(net.querySelector('svg')).not.toBeNull();
    expect(waText(net)).toBe(tr('site.whatsapp.court'));
    expect(within(club).getByRole('img', { name: tr('site.photos.clubAlt') })).toBeTruthy();
  });

  it('hands lessons and events to WhatsApp, each with its own message', async () => {
    await renderServerPage(HomePage, locale);

    const lessons = section('#lessons');
    expect(plain(within(lessons).getByRole('heading', { level: 2 }).textContent)).toBe(
      `${tr('site.lessons.titleOne')} ${tr('site.lessons.titleTwo')}`,
    );
    expect(
      waText(
        within(lessons).getByRole('link', {
          name: labelThen(tr('site.lessons.cta'), tr('site.onWhatsApp')),
        }),
      ),
    ).toBe(tr('site.whatsapp.lesson'));

    const events = section('.tp-events');
    expect(within(events).getByText(tr('site.events.comingSoon'))).toBeTruthy();
    expect(within(events).getByRole('heading', { level: 2 }).textContent).toBe(
      tr('site.events.title'),
    );
    expect(
      waText(
        within(events).getByRole('link', {
          name: labelThen(tr('site.events.cta'), tr('site.onWhatsApp')),
        }),
      ),
    ).toBe(tr('site.whatsapp.events'));
    // The poster words are its picture: read once, as a sentence.
    const words = [...events.querySelectorAll('.tp-events__word')];
    expect(words.map((w) => w.textContent)).toEqual([
      tr('site.events.play'),
      tr('site.events.smash'),
      tr('site.events.win'),
    ]);
    for (const w of words) expect(w.getAttribute('aria-hidden')).toBe('true');
    expect(within(events).getByText(tr('site.events.label'))).toBeTruthy();
  });

  it('names the live café categories in the reading language and links the menu', async () => {
    await renderServerPage(HomePage, locale);

    const body = section('.tp-cafe-handoff__body').textContent ?? '';
    // English names drop their menu capitals inside the sentence.
    for (const c of MENU_FIXTURE) {
      expect(body).toContain(locale === 'ar' ? c.name_ar : c.name_en.toLocaleLowerCase('en'));
    }
    // The fixture menu is short, so the list is whole: the plain line, no "and more".
    expect(body).toBe(
      tr('site.cafe.body', { categories: cafeCategoryList(MENU_FIXTURE, locale)!.list }),
    );
    expect(screen.getByRole('link', { name: tr('site.cafe.cta') }).getAttribute('href')).toBe(
      `/${locale}/menu`,
    );
    expect(screen.getByRole('img', { name: t(locale, 'common.cafeName') })).toBeTruthy();
  });

  it('says "and more" when the menu has more sections than the line names (copy-07)', async () => {
    const extra = Array.from({ length: 6 }, (_, i) => ({
      ...MENU_FIXTURE[0]!,
      id: `extra-${i}`,
      name_en: `Extra ${i}`,
      name_ar: `إضافي ${i}`,
      sort_order: 100 + i,
    }));
    serverData.menu = { status: 'ok', categories: [...MENU_FIXTURE, ...extra] };
    await renderServerPage(HomePage, locale);

    const cut = cafeCategoryList([...MENU_FIXTURE, ...extra], locale)!;
    expect(cut.more).toBe(true);
    expect(section('.tp-cafe-handoff__body').textContent).toBe(
      tr('site.cafe.bodyMore', { categories: cut.list }),
    );
  });

  it('falls back to the category-free café line when the menu read fails', async () => {
    serverData.menu = MENU_ERROR;
    await renderServerPage(HomePage, locale);

    expect(section('.tp-cafe-handoff__body').textContent).toBe(tr('site.cafe.bodyNoCategories'));
    expect(screen.getByRole('link', { name: tr('site.cafe.cta') })).toBeTruthy();
  });

  it('gives the app one compact band: one redrawn screen, coming-soon stores', async () => {
    await renderServerPage(HomePage, locale);

    expect(document.querySelectorAll('.tp-appband')).toHaveLength(1);
    const band = section('.tp-appband');
    expect(within(band).getByRole('heading', { level: 2 }).textContent).toBe(tr('site.app.title'));
    const screens = document.querySelectorAll('.tp-screen');
    expect(screens).toHaveLength(1);
    expect(screens[0]!.getAttribute('aria-hidden')).toBe('true');

    const soon = band.querySelectorAll('.tp-store--soon');
    expect(soon).toHaveLength(2);
    for (const b of soon) expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(
      document.querySelector('a[href*="apps.apple.com"], a[href*="play.google.com"]'),
    ).toBeNull();
  });

  it('draws the app screen as an example, never tonight’s availability (copy-06, ART-08)', async () => {
    await renderServerPage(HomePage, locale);

    const shot = document.querySelector('.tp-screen')!;
    // Weekday names only: no "Today", no date numbers from the real calendar.
    expect(shot.querySelectorAll('.tp-v-day')).toHaveLength(5);
    expect(shot.querySelector('.tp-v-day__num')).toBeNull();
    for (const day of shot.querySelectorAll('.tp-v-day__dow')) {
      expect(day.textContent).not.toMatch(/\d/);
    }
    // The page's 24-hour clock, like the hours line.
    expect([...shot.querySelectorAll('.tp-v-slot__time')].map((e) => plain(e.textContent))).toEqual(
      ['20:00', '21:00', '22:00', '23:00'],
    );
    expect(shot.textContent).not.toMatch(/PM|AM|م\b|ص\b/);
  });

  it('shows the official badges once the listing URLs are set', async () => {
    vi.stubEnv(
      'NEXT_PUBLIC_APP_STORE_URL',
      'https://apps.apple.com/iq/app/touch-padel/id6809045183',
    );
    vi.stubEnv(
      'NEXT_PUBLIC_PLAY_STORE_URL',
      'https://play.google.com/store/apps/details?id=com.kagu.touchpadel',
    );
    await renderServerPage(HomePage, locale);

    expect(document.querySelectorAll('.tp-store--soon')).toHaveLength(0);
    expect(
      screen.getByRole('link', { name: tr('site.app.downloadOnAppStore') }).getAttribute('href'),
    ).toContain('apps.apple.com');
    expect(
      screen.getByRole('link', { name: tr('site.app.getItOnGooglePlay') }).getAttribute('href'),
    ).toContain('play.google.com');
  });

  it('answers the first visit in native details, closed, the answers in the page', async () => {
    serverData.venue = { ...VENUE_FIXTURE, cancellation_window_hours: 6 };
    await renderServerPage(HomePage, locale);

    const faq = section('#faq');
    expect(within(faq).getByRole('heading', { level: 2 }).textContent).toBe(tr('site.faq.title'));
    const items = [...faq.querySelectorAll('details')];
    expect(items.map((d) => d.querySelector('summary')!.textContent)).toEqual([
      tr('site.faq.bookQ'),
      tr('site.faq.payQ'),
      tr('site.faq.racketQ'),
      tr('site.faq.lockersQ'),
      tr('site.faq.beginnerQ'),
      tr('site.faq.cancelQ'),
      tr('site.faq.hoursQ'),
    ]);
    for (const d of items) expect(d.open).toBe(false);
    const answers = items.map((d) => plain(d.querySelector('.tp-faq__a')!.textContent));
    expect(answers[1]).toBe(tr('site.faq.payA'));
    expect(answers[5]).toBe(
      plain(tr('site.faq.cancelA', { cancelHours: hoursPhrase(6, locale) })),
    );
    // 09:00–23:00 closes before midnight: the plain answer, no "past midnight".
    expect(answers[6]).toBe(plain(tr('site.faq.hoursA', { hours: '09:00–23:00' })));
  });

  it('says "past midnight" only when the live window really closes after it', async () => {
    serverData.venue = {
      ...VENUE_FIXTURE,
      opening_hours: Object.fromEntries(
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
          d,
          [
            ['00:00', '02:00'],
            ['09:00', '24:00'],
          ],
        ]),
      ),
    };
    await renderServerPage(HomePage, locale);

    const answers = [...section('#faq').querySelectorAll('.tp-faq__a')].map((p) =>
      plain(p.textContent),
    );
    expect(answers[6]).toBe(plain(tr('site.faq.hoursALate', { hours: '09:00–02:00' })));
  });

  it('says where to find the club: address, the map, hours, WhatsApp, a call, walking in', async () => {
    await renderServerPage(HomePage, locale);

    const visit = section('#visit');
    expect(plain(within(visit).getByRole('heading', { level: 2 }).textContent)).toBe(
      `${tr('site.visit.titleOne')} ${tr('site.visit.titleTwo')}`,
    );
    expect(within(visit).getByText(tr('site.visit.address'))).toBeTruthy();
    expect(
      within(visit)
        .getByRole('link', { name: tr('site.visit.maps') })
        .getAttribute('href'),
    ).toBe(DEFAULT_MAPS_URL);
    expect(within(visit).getByText(tr('site.visit.hoursTitle'))).toBeTruthy();
    expect(plain(visit.textContent)).toContain('09:00–23:00');
    const chat = within(visit).getByRole('link', { name: tr('site.visit.whatsapp') });
    expect(waText(chat)).toBe(tr('site.whatsapp.general'));
    // The call button carries the number itself, printed for reading.
    const call = within(visit).getByRole('link', {
      name: labelThen(tr('site.visit.call'), PRINTED),
    });
    expect(call.getAttribute('href')).toBe(`tel:+${DIGITS}`);
    expect(call.querySelector('.tp-visit__number')?.getAttribute('dir')).toBe('ltr');
    expect(within(visit).getByText(tr('site.visit.walkIn'))).toBeTruthy();
    // No handle is confirmed, so no Instagram anywhere.
    expect(document.querySelector('a[href*="instagram.com"]')).toBeNull();
  });

  it('uses the pinned map link and shows Instagram only when each is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_MAPS_URL', 'https://maps.app.goo.gl/AbCdEf123');
    vi.stubEnv('NEXT_PUBLIC_INSTAGRAM_URL', 'https://instagram.com/touchpadel');
    await renderServerPage(HomePage, locale);

    const visit = section('#visit');
    expect(
      within(visit)
        .getByRole('link', { name: tr('site.visit.maps') })
        .getAttribute('href'),
    ).toBe('https://maps.app.goo.gl/AbCdEf123');
    expect(
      within(screen.getByRole('contentinfo'))
        .getByRole('link', { name: tr('site.visit.maps') })
        .getAttribute('href'),
    ).toBe('https://maps.app.goo.gl/AbCdEf123');
    expect(
      within(visit)
        .getByRole('link', { name: tr('site.visit.instagram') })
        .getAttribute('href'),
    ).toBe('https://www.instagram.com/touchpadel');
  });

  it('keeps a map link that is not https, or an Instagram that is not Instagram, off the page', async () => {
    vi.stubEnv('NEXT_PUBLIC_MAPS_URL', 'http://maps.example/karbala');
    vi.stubEnv('NEXT_PUBLIC_INSTAGRAM_URL', 'https://evil.example/instagram.com/touchpadel');
    await renderServerPage(HomePage, locale);

    expect(
      within(section('#visit'))
        .getByRole('link', { name: tr('site.visit.maps') })
        .getAttribute('href'),
    ).toBe(DEFAULT_MAPS_URL);
    expect(screen.queryByRole('link', { name: tr('site.visit.instagram') })).toBeNull();
    expect(document.querySelector('a[href*="evil.example"], a[href^="http:"]')).toBeNull();
  });

  it.each([
    ['no phone is set', null],
    ['the phone cannot be dialled from abroad', '030 123 4567'],
  ])('turns every booking button into Plan your visit when %s', async (_state, phone) => {
    serverData.venue = { ...VENUE_FIXTURE, phone };
    await renderServerPage(HomePage, locale);

    expect(document.querySelector('a[href*="wa.me"], a[href^="tel:"]')).toBeNull();
    const fallbacks = [...document.querySelectorAll('a[data-contact="visit"]')];
    // Header, hero, the court's net, lessons, events.
    expect(fallbacks).toHaveLength(5);
    for (const a of fallbacks) {
      expect(a.getAttribute('href')).toBe('#visit');
      expect(a.textContent).toBe(tr('site.hero.ctaVisit'));
    }
    expect(section('.tp-front').querySelector('[data-contact="call"]')).toBeNull();
    // #visit itself still says how: the address, the map, walking in; no dead buttons.
    const visit = section('#visit');
    expect(within(visit).getByText(tr('site.visit.walkIn'))).toBeTruthy();
    expect(within(visit).queryByRole('link', { name: tr('site.visit.whatsapp') })).toBeNull();
    expect(
      within(screen.getByRole('contentinfo')).queryByText(tr('site.footer.phoneTitle')),
    ).toBeNull();
    // The hours still stand: only the phone is missing.
    expect(section('.tp-front').querySelector('.tp-open')).not.toBeNull();
  });

  it('drops the hours, the open pill and the phone when the venue read fails', async () => {
    serverData.venue = null;
    await renderServerPage(HomePage, locale);

    expect(section('.tp-front__lead').textContent).toBe(tr('site.hero.leadNoHours'));
    expect(document.querySelector('.tp-open')).toBeNull();
    expect(section('#club').textContent).toContain(tr('site.club.pointHoursNoHours'));
    const faqAnswers = [...section('#faq').querySelectorAll('.tp-faq__a')].map((p) =>
      plain(p.textContent),
    );
    expect(faqAnswers[6]).toBe(tr('site.faq.hoursANoHours'));
    // The cancellation window falls back to the configured 4 h.
    expect(faqAnswers[5]).toBe(
      plain(tr('site.faq.cancelA', { cancelHours: hoursPhrase(4, locale) })),
    );
    expect(within(section('#visit')).queryByText(tr('site.visit.hoursTitle'))).toBeNull();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).queryByText(tr('site.footer.hoursTitle'))).toBeNull();
    expect(document.querySelector('a[href*="wa.me"], a[href^="tel:"]')).toBeNull();
    // Where the club is does not depend on the read.
    expect(within(section('#visit')).getByText(tr('site.visit.address'))).toBeTruthy();
  });

  it('describes every photograph by what is in it, and preloads only the hero', async () => {
    await renderServerPage(HomePage, locale);

    const keys = ['heroAlt', 'clubAlt', 'lessonsAlt', 'eventsAlt', 'cafeAlt'] as const;
    for (const key of keys) {
      expect(screen.getByRole('img', { name: tr(`site.photos.${key}`) })).toBeTruthy();
    }
    const photos = [...document.querySelectorAll('.tp-photo img')];
    expect(photos).toHaveLength(5);
    const hero = section('.tp-front').querySelector('.tp-photo img')!;
    expect(hero.getAttribute('loading')).not.toBe('lazy');
    // The LCP image asks for high priority, the lazy ones do not. (The q=55 in each URL
    // needs next.config's `qualities`, which this render does not load: measured live.)
    expect(hero.getAttribute('fetchpriority')).toBe('high');
    for (const img of photos.filter((p) => p !== hero)) {
      expect(img.getAttribute('fetchpriority')).toBeNull();
    }
    for (const img of photos.filter((p) => p !== hero)) {
      expect(img.getAttribute('loading')).toBe('lazy');
    }
  });

  it('draws the photo grade once, the hero in its night exposure and the rest in print', async () => {
    await renderServerPage(HomePage, locale);

    for (const id of Object.values(PHOTO_GRADE_ID)) {
      expect(document.querySelectorAll(`filter#${id}`)).toHaveLength(1);
    }
    const frames = [...document.querySelectorAll('.tp-photo')];
    expect(frames.filter((f) => f.classList.contains('tp-photo--night'))).toEqual([
      section('.tp-front').querySelector('.tp-photo'),
    ]);
    // The ball masks and the ramp reach the markup as the lib defines them.
    const night = document.querySelector(`filter#${PHOTO_GRADE_ID.night}`)!;
    expect(night.querySelector('feFuncB')?.getAttribute('tableValues')).toBe(
      rampTables(PHOTO_GRADE_RAMP.night).b,
    );
  });

  it('puts the address and the WhatsApp chat in the footer too', async () => {
    await renderServerPage(HomePage, locale);

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText(tr('site.visit.address'))).toBeTruthy();
    expect(waText(within(footer).getByRole('link', { name: tr('site.footer.whatsapp') }))).toBe(
      tr('site.whatsapp.general'),
    );
    const phone = within(footer).getByRole('link', { name: PRINTED });
    expect(phone.getAttribute('href')).toBe(`tel:+${DIGITS}`);
    expect(phone.getAttribute('dir')).toBe('ltr');
    expect(
      within(footer)
        .getByRole('link', { name: tr('site.footer.privacy') })
        .getAttribute('href'),
    ).toBe(`/${locale}/privacy`);
  });

  it('renders night by default and light from the cookie', async () => {
    await renderServerPage(HomePage, locale);
    expect(document.querySelector('.tp-site')?.getAttribute('data-mode')).toBe('night');

    document.body.innerHTML = '';
    siteRequest.mode = 'light';
    await renderServerPage(HomePage, locale);
    expect(document.querySelector('.tp-site')?.getAttribute('data-mode')).toBe('light');
  });

  it('carries JSON-LD with this response’s nonce, the address, and no telephone', async () => {
    await renderServerPage(HomePage, locale);

    const script = document.querySelector('script[type="application/ld+json"]')!;
    expect(script.getAttribute('nonce')).toBe(TEST_NONCE);
    const data = JSON.parse(script.textContent ?? '{}');
    expect(data['@type']).toBe('SportsActivityLocation');
    expect(data.url).toMatch(new RegExp(`/${locale}$`));
    expect(data.description).toBe(tr('site.seo.description'));
    expect(data.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Durrat Karbala',
      addressLocality: 'Karbala',
      addressCountry: 'IQ',
    });
    expect(data.openingHoursSpecification[0]).toMatchObject({ opens: '09:00', closes: '23:00' });
    expect(JSON.stringify(data)).not.toMatch(/telephone|770/);
  });
});

describe.each(LOCALES)('home page metadata (%s)', (locale: Locale) => {
  it('is Touch Padel’s: absolute title, the club description, canonical, hreflang, share image', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale }) });
    expect(meta.title).toEqual({ absolute: t(locale, 'site.seo.title') });
    expect(meta.description).toBe(t(locale, 'site.seo.description'));
    expect(meta.alternates).toEqual({
      canonical: `/${locale}`,
      languages: { en: '/en', ar: '/ar', 'x-default': '/ar' },
    });
    const og = meta.openGraph as {
      description: string;
      images: { url: string; width: number; height: number; alt: string }[];
    };
    expect(og.description).toBe(t(locale, 'site.seo.description'));
    expect(og.images[0]).toEqual({
      url: `/brand/site/og-touch-padel-${locale}.png`,
      width: 1200,
      height: 630,
      alt: t(locale, 'site.seo.ogAlt'),
    });
    expect(JSON.stringify(meta.icons)).toContain('/brand/site/favicon.svg');
  });

  it('paints the browser chrome in the visitor’s mode', async () => {
    expect((await generateViewport()).themeColor).toBe('#172C4F');
    siteRequest.mode = 'light';
    expect((await generateViewport()).themeColor).toBe('#F3F5F9');
  });

  it('404s a foreign locale', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ locale: 'fr' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});
