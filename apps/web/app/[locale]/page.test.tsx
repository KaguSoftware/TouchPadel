import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { t, type MessageKey, type TParams } from '@touch/i18n';
import {
  MENU_ERROR,
  resetServerData,
  SECOND_BRANCH,
  serverData,
  VENUE_FIXTURE,
} from '@/test/fixtures';
import { MAPS_URL } from '@/lib/site/contact';
import { renderServerPage } from '@/test/renderPage';
import { resetSiteRequest } from '@/lib/site/testSupport';
import { PHOTO_GRADE_ID } from '@/lib/site/photoGrade';
import HomePage, { generateMetadata } from './page';

/**
 * The Touch Padel home page, `/{locale}` (contracts-2026-09-23 §0, Revision B): THE CLUB,
 * not the app. What only this render can prove cheaply: the owner's section order with
 * one app band, and each degraded data state (no dialable phone, the venue read failed,
 * the menu read failed). The Arabic page, the booking links and the look are Playwright's
 * (e2e/tests/site-landing.spec.ts). The live court (a WebGL canvas) is a stand-in: a
 * labelled picture plus the children riding the net.
 */
vi.mock('@/lib/menu.server', async () => {
  const { serverData, fixtureBranches } = await import('@/test/fixtures');
  return {
    getCachedMenu: () => Promise.resolve(serverData.menu),
    getCachedCafeSettings: () => Promise.resolve(serverData.settings),
    getCachedBranches: () => Promise.resolve(fixtureBranches()),
    getCachedVenue: () => Promise.resolve(fixtureBranches()[0] ?? null),
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
      events: still('events'),
    },
  };
});

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const tr = (key: MessageKey, vars?: TParams) => t('en', key, vars);
/** Strip bidi isolates, so a sentence can be compared as the eye reads it. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u2066-\u2069]/g, '');
const section = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const faqAnswers = () =>
  [...section('#faq').querySelectorAll('.tp-faq__a')].map((p) => plain(p.textContent));

beforeEach(() => {
  resetServerData();
  resetSiteRequest();
});

describe('home page', () => {
  it('presents the club, section by section, in the contract’s order, with one app band', async () => {
    await renderServerPage(HomePage, 'en');

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
    expect(main.querySelectorAll('.tp-appband')).toHaveLength(1);
    // Every section is named by its own heading.
    for (const el of main.querySelectorAll('section')) {
      const id = el.getAttribute('aria-labelledby');
      expect(id && document.getElementById(id)?.textContent, el.className).toBeTruthy();
    }
  });

  it('answers the first visit in closed native details; "past midnight" only when true', async () => {
    await renderServerPage(HomePage, 'en');
    const items = [...section('#faq').querySelectorAll('details')];
    expect(items).toHaveLength(7);
    for (const d of items) expect(d.open).toBe(false);
    // One shared name: the browser keeps only one answer open at a time.
    expect(new Set(items.map((d) => d.getAttribute('name')))).toEqual(new Set(['tp-faq']));
    // The stack ends on "still wondering?", handing over to the desk on WhatsApp.
    const ask = section('#faq').querySelector('.tp-faq__ask a[data-contact="whatsapp"]');
    expect(ask?.textContent).toContain(tr('site.faq.askCta'));
    // 09:00–23:00 closes before midnight: the plain answer.
    expect(faqAnswers()[6]).toBe(plain(tr('site.faq.hoursA', { hours: '09:00–23:00' })));

    document.body.innerHTML = '';
    const overnight: [string, string][] = [
      ['00:00', '02:00'],
      ['09:00', '24:00'],
    ];
    serverData.venue = {
      ...VENUE_FIXTURE,
      opening_hours: Object.fromEntries(
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, overnight]),
      ),
    };
    await renderServerPage(HomePage, 'en');
    expect(faqAnswers()[6]).toBe(plain(tr('site.faq.hoursALate', { hours: '09:00–02:00' })));
  });

  it('turns every booking button into Plan your visit when the phone cannot be dialled', async () => {
    serverData.venue = { ...VENUE_FIXTURE, phone: '030 123 4567' };
    await renderServerPage(HomePage, 'en');

    expect(document.querySelector('a[href*="wa.me"], a[href^="tel:"]')).toBeNull();
    const fallbacks = [...document.querySelectorAll('a[data-contact="visit"]')];
    // Header (the bar's, and the phone sheet's), hero, the court's net, lessons, events,
    // the app band, the FAQ's ask card.
    expect(fallbacks).toHaveLength(8);
    for (const a of fallbacks) {
      expect(a.getAttribute('href')).toBe('#visit');
      expect(a.textContent).toBe(tr('site.hero.ctaVisit'));
    }
    // #visit itself still says how: walking in. The hours stand: only the phone is missing.
    expect(within(section('#visit')).getByText(tr('site.visit.walkIn'))).toBeTruthy();
    expect(section('.tp-front').querySelector('.tp-open')).not.toBeNull();
  });

  it('drops the hours, the open pill and the phone when the venue read fails', async () => {
    serverData.venue = null;
    await renderServerPage(HomePage, 'en');

    expect(document.querySelector('.tp-open')).toBeNull();
    expect(faqAnswers()[6]).toBe(tr('site.faq.hoursANoHours'));
    expect(within(section('#visit')).queryByText(tr('site.visit.hoursTitle'))).toBeNull();
    expect(document.querySelector('a[href*="wa.me"], a[href^="tel:"]')).toBeNull();
    // Where the club is does not depend on the read.
    expect(within(section('#visit')).getByText(tr('site.visit.address'))).toBeTruthy();
  });

  it('keeps the one-branch Visit block as it was while no address is stored', async () => {
    await renderServerPage(HomePage, 'en');

    const visit = section('#visit');
    expect(visit.querySelectorAll('.tp-visit__branch')).toHaveLength(0);
    expect(within(visit).getByText(tr('site.visit.addressTitle'))).toBeTruthy();
    expect(within(visit).getByText(tr('site.visit.address'))).toBeTruthy();
    expect(
      within(visit)
        .getByRole('link', { name: tr('site.visit.maps') })
        .getAttribute('href'),
    ).toBe(MAPS_URL);
  });

  it('prints the branch’s own address and pinned map once the owner stores them', async () => {
    serverData.venue = {
      ...VENUE_FIXTURE,
      address_en: 'Fixture Road 1, Karbala',
      map_url: 'https://maps.example.test/fixture-a',
    };
    await renderServerPage(HomePage, 'en');

    const visit = section('#visit');
    expect(within(visit).getByText('Fixture Road 1, Karbala')).toBeTruthy();
    expect(within(visit).queryByText(tr('site.visit.address'))).toBeNull();
    expect(
      within(visit)
        .getByRole('link', { name: tr('site.visit.maps') })
        .getAttribute('href'),
    ).toBe('https://maps.example.test/fixture-a');
  });

  it('lists every open branch in #visit: name, address, map, hours and its own desk', async () => {
    serverData.branches = [VENUE_FIXTURE, SECOND_BRANCH];
    await renderServerPage(HomePage, 'en');

    const blocks = [...section('#visit').querySelectorAll<HTMLElement>('.tp-visit__branch')];
    expect(blocks.map((b) => b.dataset.branch)).toEqual(['fixture-a', 'fixture-b']);
    const [first, second] = blocks as [HTMLElement, HTMLElement];

    // The first branch has nothing stored: the confirmed address and the Maps search.
    expect(within(first).getByRole('heading', { name: VENUE_FIXTURE.name_en })).toBeTruthy();
    expect(within(first).getByText(tr('site.visit.address'))).toBeTruthy();
    expect(
      within(first)
        .getByRole('link', { name: tr('site.visit.maps') })
        .getAttribute('href'),
    ).toBe(MAPS_URL);
    expect(first.querySelector('a[href^="tel:"]')?.getAttribute('href')).toBe('tel:+9647700000000');

    expect(within(second).getByRole('heading', { name: SECOND_BRANCH.name_en })).toBeTruthy();
    expect(within(second).getByText(SECOND_BRANCH.address_en!)).toBeTruthy();
    expect(
      within(second)
        .getByRole('link', { name: tr('site.visit.maps') })
        .getAttribute('href'),
    ).toBe(SECOND_BRANCH.map_url);
    const call = second.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!;
    expect(call.getAttribute('href')).toBe('tel:+9647800000000');
    expect(call.textContent).toContain(tr('branches.common.call', { name: SECOND_BRANCH.name_en }));
    expect(second.querySelector('.tp-hours-list')).not.toBeNull();

    // One walk-in line for all of them.
    expect(within(section('#visit')).getAllByText(tr('site.visit.walkIn'))).toHaveLength(1);
    // The JSON-LD keeps the first branch on top and lists the second as a department.
    const ld = JSON.parse(
      document.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
    ) as { department?: { name: string; address: { streetAddress: string } }[] };
    expect(ld.department).toHaveLength(1);
    expect(ld.department?.[0]?.address.streetAddress).toBe(SECOND_BRANCH.address_en);
  });

  it('names the branches in Arabic at /ar', async () => {
    serverData.branches = [VENUE_FIXTURE, SECOND_BRANCH];
    await renderServerPage(HomePage, 'ar');

    const visit = section('#visit');
    expect(within(visit).getByText(SECOND_BRANCH.name_ar)).toBeTruthy();
    expect(within(visit).getByText(SECOND_BRANCH.address_ar!)).toBeTruthy();
    expect(within(visit).getByText(t('ar', 'site.visit.address'))).toBeTruthy();
    expect(within(visit).queryByText(SECOND_BRANCH.name_en)).toBeNull();
  });

  it('draws a real menu section on the café phone, and the mark when the menu read fails', async () => {
    await renderServerPage(HomePage, 'en');
    let cafe = section('.tp-cafe-handoff');
    expect(section('.tp-cafe-handoff__body').textContent).toBe(tr('site.cafe.body'));
    const steps = within(cafe).getByRole('list', { name: tr('site.cafe.stepsLabel') });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    const rows = [...cafe.querySelectorAll('.tp-cafe-phone__row b')].map((b) => b.textContent);
    expect(rows).toEqual(['Fixture Flat White', 'Fixture Iced Tea']);
    // The drawings picture the steps' words, so they stay out of the accessibility tree.
    for (const art of cafe.querySelectorAll('.tp-cafe-step__art')) {
      expect(art.getAttribute('aria-hidden')).toBe('true');
    }

    document.body.innerHTML = '';
    serverData.menu = MENU_ERROR;
    await renderServerPage(HomePage, 'en');
    cafe = section('.tp-cafe-handoff');
    expect(cafe.querySelector('.tp-cafe-phone__row')).toBeNull();
    expect(cafe.querySelector('.tp-cafe-phone__mark')).not.toBeNull();
    expect(screen.getByRole('link', { name: tr('site.cafe.cta') }).getAttribute('href')).toBe(
      '/en/menu',
    );
  });

  it('describes every photograph by what is in it; the poster words are read once', async () => {
    await renderServerPage(HomePage, 'en');

    for (const key of ['heroAlt', 'clubAlt', 'lessonsAlt', 'eventsAlt'] as const) {
      expect(screen.getByRole('img', { name: tr(`site.photos.${key}`) })).toBeTruthy();
    }
    // PLAY / SMASH / WIN are the poster's picture: hidden, and read once as the label.
    const events = section('.tp-events');
    const words = events.querySelectorAll('.tp-events__word');
    expect(words).toHaveLength(3);
    for (const w of words) expect(w.getAttribute('aria-hidden')).toBe('true');
    expect(within(events).getByText(tr('site.events.label'))).toBeTruthy();
  });

  it('grades only the hero in its night exposure, under the white type (WCAG 1.4.3)', async () => {
    await renderServerPage(HomePage, 'en');

    // Each grade filter is drawn once; the CSS (site-css.test) points at these ids.
    for (const id of Object.values(PHOTO_GRADE_ID)) {
      expect(document.querySelectorAll(`filter#${id}`)).toHaveLength(1);
    }
    const night = [...document.querySelectorAll('.tp-photo--night')];
    expect(night).toEqual([section('.tp-front').querySelector('.tp-photo')]);
  });
});

describe('home page metadata', () => {
  it('names its canonical, the hreflang pair and its language’s share image', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'ar' }) });
    expect(meta.alternates).toEqual({
      canonical: '/ar',
      languages: { en: '/en', ar: '/ar', 'x-default': '/ar' },
    });
    const og = meta.openGraph as { images: { url: string }[] };
    expect(og.images[0]!.url).toBe('/brand/site/og-touch-padel-ar.png');
  });

  it('404s a foreign locale', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ locale: 'fr' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});
