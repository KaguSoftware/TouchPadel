import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { resetServerData, serverData, VENUE_FIXTURE } from '@/test/fixtures';
import { renderServerPage } from '@/test/renderPage';
import SupportPage from './page';

/**
 * The support page — the App Store Connect "Support URL". Same shell as
 * privacy, plus the opening-hours block, which is the page's one conditional:
 * a venue with no published windows must say nothing rather than print
 * "Closed" seven times (a false statement about a venue that is open).
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

describe.each(LOCALES)('support page (%s)', (locale: Locale) => {
  it('renders the legal document in the reading language', async () => {
    await renderServerPage(SupportPage, locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      t(locale, 'legal.support.title'),
    );
    expect(screen.getByText(t(locale, 'legal.support.intro'))).toBeTruthy();
  });

  it('renders its sections as headed landmarks', async () => {
    await renderServerPage(SupportPage, locale);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toContain(t(locale, 'legal.support.about.title'));
    expect(headings).toContain(t(locale, 'legal.support.delete.title'));
    expect(document.querySelector('section#delete')?.getAttribute('aria-labelledby')).toBe(
      'delete-title',
    );
  });

  it('prints the week when the venue has published hours', async () => {
    await renderServerPage(SupportPage, locale);

    expect(screen.getByText(t(locale, 'legal.contact.hours'))).toBeTruthy();
    // Seven days, each a <dt>/<dd> pair inside the hours list.
    expect(document.querySelectorAll('.tp-legal__hours dt')).toHaveLength(7);
  });

  it('omits the hours block entirely when the venue has none', async () => {
    serverData.venue = { ...VENUE_FIXTURE, opening_hours: {} };
    await renderServerPage(SupportPage, locale);

    expect(screen.queryByText(t(locale, 'legal.contact.hours'))).toBeNull();
    expect(document.querySelector('.tp-legal__hours')).toBeNull();
  });

  it('links to the privacy page retention section', async () => {
    await renderServerPage(SupportPage, locale);

    const more = screen.getByRole('link', { name: t(locale, 'legal.support.delete.more') });
    expect(more.getAttribute('href')).toBe(`/${locale}/privacy#retention`);
  });
});
