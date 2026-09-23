import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { resetServerData, serverData, VENUE_PHONE } from '@/test/fixtures';
import { renderServerPage } from '@/test/renderPage';
import PrivacyPage from './page';

/**
 * The privacy policy — the App Store Connect "Privacy Policy URL". Apple
 * fetches it, so every word has to be in the server-rendered HTML: these cases
 * assert the title, a section heading and the contact block in both languages.
 *
 * The venue phone is the one piece of live data on the page; it comes from
 * `venue_settings_public` through `getCachedVenue`, mocked here.
 */
vi.mock('@/lib/menu.server', async () => {
  const { serverData } = await import('@/test/fixtures');
  return {
    getCachedMenu: () => Promise.resolve(serverData.menu),
    getCachedCafeSettings: () => Promise.resolve(serverData.settings),
    getCachedVenue: () => Promise.resolve(serverData.venue),
  };
});

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const LOCALES = ['en', 'ar'] as const;

beforeEach(() => {
  resetServerData();
});

describe.each(LOCALES)('privacy page (%s)', (locale: Locale) => {
  it('renders the legal document in the reading language', async () => {
    await renderServerPage(PrivacyPage, locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      t(locale, 'legal.privacy.title'),
    );
    expect(screen.getByText(t(locale, 'legal.privacy.intro'))).toBeTruthy();
    expect(screen.getByText(t(locale, 'legal.lastUpdated'))).toBeTruthy();
  });

  it('renders its sections as headed landmarks', async () => {
    await renderServerPage(PrivacyPage, locale);

    // Every section heading is an <h2> labelling its own <section>.
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.length).toBeGreaterThan(5);
    expect(headings.map((h) => h.textContent)).toContain(t(locale, 'legal.privacy.who.title'));
    expect(headings.map((h) => h.textContent)).toContain(t(locale, 'legal.privacy.rights.title'));
    expect(document.querySelector('section#who')?.getAttribute('aria-labelledby')).toBe(
      'who-title',
    );
  });

  /**
   * DIRECTION: `LegalDocument` sets no `dir` on its wrapper — `dir` is set once,
   * on `<html>` in `app/[locale]/layout.tsx:108` from `dirAttr(locale)`, and a
   * page test does not render the layout. The ONE direction the document owns
   * itself is the phone link's `dir="ltr"`, which exists precisely because an
   * Iraqi number inside Arabic prose would otherwise put its `+` at the wrong
   * end — so that is what is asserted here, in both languages. The rendered
   * page direction is `e2e/tests/cafe-rtl-layout.spec.ts`.
   */
  it('prints the venue phone as an isolated ltr tel: link', async () => {
    await renderServerPage(PrivacyPage, locale);

    const phone = screen.getByRole('link', { name: VENUE_PHONE });
    expect(phone.getAttribute('href')).toBe('tel:+9647700000000');
    expect(phone.getAttribute('dir')).toBe('ltr');
  });

  it('says so instead when the venue has no phone published', async () => {
    serverData.venue = null;
    await renderServerPage(PrivacyPage, locale);

    expect(screen.getByText(t(locale, 'legal.contact.noPhone'))).toBeTruthy();
    expect(screen.queryByRole('link', { name: VENUE_PHONE })).toBeNull();
  });

  /**
   * The disclosures the pre-2026-09-23 policy was missing: every processor that
   * actually receives guest data, where it is stored, cookies, and the web
   * deletion route Google Play reviews.
   */
  it('discloses every processor, transfers, cookies and the web deletion route', async () => {
    await renderServerPage(PrivacyPage, locale);

    const share = document.querySelector('section#share')?.textContent ?? '';
    for (const name of ['Supabase', 'Telegram', 'OTPIQ', 'Groq', 'Vercel', 'PostHog', 'Kagu Software']) {
      expect(share).toContain(name);
    }
    for (const id of ['transfers', 'cookies', 'security']) {
      expect(document.querySelector(`section#${id}`)).not.toBeNull();
    }
    expect(
      screen.getByRole('link', { name: t(locale, 'legal.privacy.rights.deleteLink') }).getAttribute('href'),
    ).toBe(`/${locale}/delete-account`);
  });

  it('offers the other language and the sibling legal page', async () => {
    await renderServerPage(PrivacyPage, locale);

    const other = locale === 'ar' ? 'en' : 'ar';
    const nav = screen.getByRole('navigation', { name: t(locale, 'legal.nav.label') });
    expect(nav.textContent).toContain(t(locale, 'legal.nav.support'));

    const swap = screen.getByRole('link', { name: t(locale, 'legal.nav.otherLanguage') });
    expect(swap.getAttribute('href')).toBe(`/${other}/privacy`);
    expect(swap.getAttribute('hreflang')).toBe(other);
  });
});
