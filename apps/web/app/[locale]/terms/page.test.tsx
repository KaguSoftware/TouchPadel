import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { CURRENT_TERMS_VERSION } from '@touch/core';
import { resetServerData, serverData, VENUE_FIXTURE, VENUE_PHONE } from '@/test/fixtures';
import { renderServerPage } from '@/test/renderPage';
import { hoursPhrase } from '@/lib/site/plural';
import TermsPage from './page';

/**
 * The Terms of Service the app's consent checkbox points at. The two things a
 * guest's acceptance depends on are asserted here: the VERSION they accepted
 * is printed at the top, and the cancellation window is the venue's live
 * setting — the terms must never promise a window the app does not enforce.
 */
vi.mock('@/lib/menu.server', async () => {
  const { serverData } = await import('@/test/fixtures');
  return {
    getCachedMenu: () => Promise.resolve(serverData.menu),
    getCachedCafeSettings: () => Promise.resolve(serverData.settings),
    getCachedVenue: () => Promise.resolve(serverData.venue),
  };
});

// The site shell (header, footer, mode) reads the mode cookie and the CSP nonce.
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

/** Text with the bidi isolates the page wraps interpolated values in removed. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩]/g, '');

beforeEach(() => {
  resetServerData();
});

describe.each(LOCALES)('terms page (%s)', (locale: Locale) => {
  it('renders the title, date and the version a guest accepts', async () => {
    await renderServerPage(TermsPage, locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t(locale, 'legal.terms.title'));
    expect(screen.getByText(t(locale, 'legal.lastUpdated'))).toBeTruthy();
    const updated = document.querySelector('.tp-legal__updated');
    expect(plain(updated?.textContent)).toContain(CURRENT_TERMS_VERSION);
  });

  it('renders every section as a headed landmark, bookings and liability included', async () => {
    await renderServerPage(TermsPage, locale);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    for (const key of [
      'legal.terms.bookings.title',
      'legal.terms.venue.title',
      'legal.terms.liability.title',
      'legal.terms.law.title',
    ] as const) {
      expect(headings).toContain(t(locale, key));
    }
    // The support page deep-links here.
    expect(document.querySelector('section#bookings')).not.toBeNull();
  });

  it('quotes the venue’s live cancellation window, not a typed number', async () => {
    serverData.venue = { ...VENUE_FIXTURE, cancellation_window_hours: 6 };
    await renderServerPage(TermsPage, locale);

    const bookings = plain(document.querySelector('section#bookings')?.textContent);
    expect(bookings).toContain(
      plain(t(locale, 'legal.terms.bookings.cancel', { cancelHours: hoursPhrase(6, locale) })),
    );
  });

  it('falls back to the configured 4 hours when the venue read fails', async () => {
    serverData.venue = null;
    await renderServerPage(TermsPage, locale);

    const bookings = plain(document.querySelector('section#bookings')?.textContent);
    expect(bookings).toContain(
      plain(t(locale, 'legal.terms.bookings.cancel', { cancelHours: hoursPhrase(4, locale) })),
    );
  });

  it('names the operator in the contact block, and links email only once it is filled in', async () => {
    await renderServerPage(TermsPage, locale);

    const contact = document.querySelector('section#contact');
    expect(plain(contact?.textContent)).toContain(t(locale, 'legal.entity.address'));
    // Still a [FILL: …] placeholder: printed, never a broken mailto: link.
    expect(contact?.querySelector('a[href^="mailto:"]')).toBeNull();
    // The site footer prints the same number; this is the document's own.
    expect(
      within(document.querySelector<HTMLElement>('.tp-legal')!)
        .getByRole('link', { name: VENUE_PHONE })
        .getAttribute('href'),
    ).toBe('tel:+9647700000000');
  });

  it('links every legal page and the other language', async () => {
    await renderServerPage(TermsPage, locale);

    const nav = screen.getByRole('navigation', { name: t(locale, 'legal.nav.label') });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    const other = locale === 'ar' ? 'en' : 'ar';
    expect(hrefs).toEqual([
      `/${locale}/privacy`,
      `/${locale}/terms`,
      `/${locale}/support`,
      `/${locale}/delete-account`,
      `/${other}/terms`,
    ]);
    expect(nav.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe(`/${locale}/terms`);
  });
});
