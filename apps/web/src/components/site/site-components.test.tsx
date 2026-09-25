import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '@touch/i18n';
import { VENUE_FIXTURE } from '@/test/fixtures';
import { SiteShell } from './SiteShell';
import { StoreButtons } from './StoreButtons';
import { OpenNowPill } from './OpenNowPill';

/**
 * The site's frame and its client pieces: SiteShell (skip link, header, one <main>,
 * footer, the stylesheet under the request's nonce), the header's small-screen menu,
 * the footer's facts, StoreButtons and OpenNowPill. The contact links, the language
 * switch and the theme toggle are proven in a real browser (e2e/tests/site-landing.spec.ts).
 */
/** jsdom applies the sheet but not its media queries: the phone layout, panel closed. */
const hidden = { hidden: true };
/** Text without the bidi isolates the hours and numbers are wrapped in. */
const plain = (text: string | null | undefined) => (text ?? '').replace(/[\u2066-\u2069]/g, '');

const renderShell = (props: Partial<Parameters<typeof SiteShell>[0]> = {}) =>
  render(
    <SiteShell locale="en" mode="night" nonce="n-123" venue={VENUE_FIXTURE} path="/privacy" {...props}>
      <p>page body</p>
    </SiteShell>,
  );

describe('SiteShell', () => {
  it('frames the page: skip link, header, one main, footer, the sheet under the nonce', () => {
    renderShell();
    const skip = screen.getByRole('link', { name: t('en', 'site.skipToContent') });
    expect(skip.getAttribute('href')).toBe('#main');
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(document.querySelector('main')?.id).toBe('main');
    expect(within(document.querySelector('main')!).getByText('page body')).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    expect(document.querySelector('style[data-tp-site]')?.getAttribute('nonce')).toBe('n-123');
  });

  it.each([
    ['a legal page', '/privacy'],
    ['the 404', null],
  ])('links the sections home first off the home page (%s)', (_page, path) => {
    renderShell({ path });
    const nav = screen.getByRole('navigation', { name: t('en', 'site.nav.label'), ...hidden });
    expect(
      within(nav)
        .getAllByRole('link', hidden)
        .map((a) => a.getAttribute('href')),
    ).toEqual(['/en#club', '/en#lessons', '/en/menu', '/en#visit']);
    // Never framed as the home page (whose header floats transparent over a photo).
    expect(document.querySelector('.tp-site')?.getAttribute('data-page')).toBe('page');
  });

  it('has Book a court in the bar and the sheet; the menu opens and closes from the keyboard', async () => {
    renderShell();
    const banner = screen.getByRole('banner');
    const panel = banner.querySelector<HTMLElement>('.tp-site-menu')!;
    // One in the bar (desktop, and no JS); the phone sheet has its own, full width. The
    // sheet's is display:none until opened, so it has no accessible name to query by.
    const book = within(banner).getByRole('link', { name: new RegExp(t('en', 'site.nav.book')) });
    expect(panel.contains(book)).toBe(false);
    const sheetBook = panel.querySelector('a[data-contact="whatsapp"]');
    expect(sheetBook?.textContent).toContain(t('en', 'site.nav.book'));
    expect(sheetBook?.getAttribute('href')).toBe(book.getAttribute('href'));
    // Screen readers hear that it leaves for WhatsApp (link purpose).
    expect(book.querySelector('.tp-site-sr')?.textContent).toBe(t('en', 'site.onWhatsApp'));

    const toggle = within(banner).getByRole('button', { name: t('en', 'site.nav.toggle') });
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // The open sheet covers the page: nothing under it can be tabbed to or read.
    const main = document.querySelector<HTMLElement>('main')!;
    expect(main.inert).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(main.inert).toBe(false);
  });

  it('prints the desk’s number left to right inside an Arabic footer, dialled as +digits', () => {
    renderShell({ locale: 'ar' });
    const phone = within(screen.getByRole('contentinfo')).getByRole('link', {
      name: '+964 770 000 0000',
    });
    expect(phone.getAttribute('href')).toBe('tel:+9647700000000');
    expect(phone.getAttribute('dir')).toBe('ltr');
  });

  it('prints the week, day by day, when the days differ', () => {
    renderShell({
      venue: {
        ...VENUE_FIXTURE,
        opening_hours: { ...VENUE_FIXTURE.opening_hours, fri: [['14:00', '23:00']] },
      },
    });
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).queryByText(t('en', 'site.hours.everyDay'))).toBeNull();
    const week = footer.querySelector('dl.tp-hours-list--week')!;
    expect(week.querySelectorAll('dt')).toHaveLength(7);
    expect(plain(week.textContent)).toContain('14:00–23:00');
  });

  it('sends Book a court home to #visit off the home page when there is no phone', () => {
    renderShell({ path: '/privacy', venue: { ...VENUE_FIXTURE, phone: null } });
    const visit = screen.getByRole('banner').querySelector('a[data-contact="visit"]');
    expect(visit?.getAttribute('href')).toBe('/en#visit');
  });

  it('leaves the address, hours and desk to #visit on the home page', () => {
    renderShell({ path: '' });
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).queryByText(t('en', 'site.visit.address'))).toBeNull();
    expect(footer.querySelector('a[href^="tel:"], a[href*="wa.me"]')).toBeNull();
  });
});

describe('StoreButtons', () => {
  it('shows a dimmed "soon" badge without a listing, and links the badge once one is set', () => {
    const { unmount } = render(
      <StoreButtons locale="en" links={{ appStore: null, googlePlay: null }} />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('img', { name: t('en', 'site.app.appStoreSoon') })).toBeTruthy();
    expect(screen.getByRole('img', { name: t('en', 'site.app.googlePlaySoon') })).toBeTruthy();
    unmount();

    render(
      <StoreButtons
        locale="en"
        links={{ appStore: 'https://apps.apple.com/app/id6809045183', googlePlay: null }}
      />,
    );
    const link = screen.getByRole('link', { name: t('en', 'site.app.downloadOnAppStore') });
    expect(link.getAttribute('href')).toBe('https://apps.apple.com/app/id6809045183');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

describe('OpenNowPill', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says "Closed now · Opens 09:00" at 05:00 Baghdad time', async () => {
    vi.useFakeTimers({ now: new Date(Date.UTC(2026, 8, 23, 2, 0)), toFake: ['Date'] });
    const overnight = [
      ['00:00', '02:00'],
      ['09:00', '24:00'],
    ];
    render(
      <OpenNowPill
        hours="09:00–02:00"
        openingHours={Object.fromEntries(
          ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, overnight]),
        )}
        closedDates={[]}
        labels={{
          openNow: 'Open now',
          closedNow: 'Closed now',
          everyDay: 'Every day',
          opensAt: 'Opens {time}',
        }}
      />,
    );
    await act(async () => {});
    const pill = document.querySelector('.tp-open')!;
    expect(pill.getAttribute('data-status')).toBe('closed');
    expect(plain(pill.textContent)).toContain('Closed now');
    expect(plain(pill.textContent)).toContain('Opens 09:00');
  });
});
