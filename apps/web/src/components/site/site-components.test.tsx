import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t, type Locale } from '@touch/i18n';
import { VENUE_FIXTURE } from '@/test/fixtures';
import { SITE_MODE_COOKIE } from '@/lib/site/mode';
import { DEFAULT_MAPS_URL } from '@/lib/site/contact';
import { CallButton, visitHref, WhatsAppButton } from './ContactButton';
import { SiteShell } from './SiteShell';
import { ThemeToggle } from './ThemeToggle';
import { StoreButtons } from './StoreButtons';
import { OpenNowPill } from './OpenNowPill';

/**
 * The site's frame and its client pieces. SiteShell renders the header, one <main>, the
 * footer and the stylesheet with the request's nonce; the header's small-screen menu
 * folds the links but never the green "Book a court"; the contact buttons are WhatsApp
 * and a call from the one venue phone, or "Plan your visit" without one; ThemeToggle
 * flips the wrapper's mode, the cookie and the browser chrome colour; StoreButtons is
 * "coming soon" until a listing exists; OpenNowPill answers on the venue's clock.
 */
const LOCALES = ['en', 'ar'] as const;
/** VENUE_FIXTURE's +964 770 000 0000, as wa.me and tel: spell it. */
const DIGITS = '9647700000000';
/** jsdom applies the sheet but not its media queries: the phone layout, panel closed. */
const hidden = { hidden: true };
const waText = (a: Element) => new URL(a.getAttribute('href')!).searchParams.get('text');
/** A name made of the visible label then a screen-reader-only part (jsdom may space them). */
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelThen = (label: string, rest: string) =>
  new RegExp(`^${esc(label)}\\s*${esc(rest.trim())}$`);
/** Text without the bidi isolates the hours and numbers are wrapped in. */
const plain = (text: string | null | undefined) => (text ?? '').replace(/[\u2066-\u2069]/g, '');

function clearModeCookie() {
  document.cookie = `${SITE_MODE_COOKIE}=; Max-Age=0; Path=/`;
}

describe.each(LOCALES)('SiteShell (%s)', (locale: Locale) => {
  const renderShell = (venue = VENUE_FIXTURE, mode: 'night' | 'light' = 'night') =>
    render(
      <SiteShell locale={locale} mode={mode} nonce="n-123" venue={venue} path="/privacy">
        <p>page body</p>
      </SiteShell>,
    );

  it('frames the page: skip link, header nav, one main, footer', () => {
    renderShell();
    const skip = screen.getByRole('link', { name: t(locale, 'site.skipToContent') });
    expect(skip.getAttribute('href')).toBe('#main');
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(document.querySelector('main')?.id).toBe('main');
    expect(within(document.querySelector('main')!).getByText('page body')).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('scopes the padel theme and the mode on its wrapper', () => {
    renderShell(VENUE_FIXTURE, 'light');
    const site = document.querySelector('.tp-site')!;
    expect(site.getAttribute('data-theme')).toBe('padel');
    expect(site.getAttribute('data-mode')).toBe('light');
  });

  it('inlines the site stylesheet with the request nonce', () => {
    renderShell();
    const style = document.querySelector('style[data-tp-site]')!;
    expect(style.getAttribute('nonce')).toBe('n-123');
    expect(style.textContent).toContain('.tp-site-header');
    expect(style.textContent).toContain('.tp-court-stage');
  });

  it('links the club’s sections home, the café menu and this page in the other language', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: t(locale, 'site.nav.label'), ...hidden });
    // Off the home page the section links go home first; every link is a plain anchor.
    expect(
      within(nav)
        .getAllByRole('link', hidden)
        .map((a) => a.getAttribute('href')),
    ).toEqual([`/${locale}#club`, `/${locale}#lessons`, `/${locale}/menu`, `/${locale}#visit`]);
    const other = locale === 'ar' ? 'en' : 'ar';
    const banner = screen.getByRole('banner');
    // Label in Name (WCAG 2.5.3): the accessible name STARTS with the word on screen, and
    // the "Read this page in …" context follows it, never replaces it.
    const lang = within(banner).getByRole('link', {
      name: labelThen(t(locale, 'site.nav.language'), `(${t(locale, 'site.nav.languageLabel')})`),
      ...hidden,
    });
    expect(lang.hasAttribute('aria-label')).toBe(false);
    expect(lang.getAttribute('href')).toBe(`/${other}/privacy`);
    expect(lang.getAttribute('hreflang')).toBe(other);
    expect(lang.querySelector(`[lang="${other}"]`)?.textContent).toBe(
      t(locale, 'site.nav.language'),
    );
    expect(
      within(banner)
        .getByRole('link', { name: t(locale, 'site.brandHome') })
        .getAttribute('href'),
    ).toBe(`/${locale}`);
  });

  it('keeps the green Book a court in the bar, outside the folding menu', async () => {
    renderShell();
    const banner = screen.getByRole('banner');
    // The label, then a screen-reader cue that the button leaves for WhatsApp.
    const book = within(banner).getByRole('link', {
      name: labelThen(t(locale, 'site.nav.book'), t(locale, 'site.onWhatsApp')),
    });
    expect(book.querySelector('svg')).not.toBeNull();
    expect(book.getAttribute('href')!.startsWith(`https://wa.me/${DIGITS}?text=`)).toBe(true);
    expect(waText(book)).toBe(t(locale, 'site.whatsapp.court'));
    const panel = banner.querySelector<HTMLElement>('.tp-site-menu')!;
    expect(panel.contains(book)).toBe(false);

    const toggle = within(banner).getByRole('button', { name: t(locale, 'site.nav.toggle') });
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Mounted: the header knows JS runs (without it, the panel is a plain second row).
    expect(banner.hasAttribute('data-js')).toBe(true);

    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(banner.getAttribute('data-menu')).toBe('open');
    expect(within(panel).getByRole('link', { name: t(locale, 'site.nav.club') })).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(banner.getAttribute('data-menu')).toBe('closed');
    expect(document.activeElement).toBe(toggle);
  });

  it('closes the menu when one of its links is followed', async () => {
    renderShell();
    const banner = screen.getByRole('banner');
    const toggle = within(banner).getByRole('button', { name: t(locale, 'site.nav.toggle') });
    await userEvent.click(toggle);
    const club = within(banner).getByRole('link', { name: t(locale, 'site.nav.club') });
    // jsdom cannot navigate; the menu only has to notice the follow.
    club.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(club);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('prints where the club is, the live hours and the front desk in the footer', () => {
    renderShell();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText(t(locale, 'site.visit.address'))).toBeTruthy();
    expect(
      within(footer)
        .getByRole('link', { name: t(locale, 'site.visit.maps') })
        .getAttribute('href'),
    ).toBe(DEFAULT_MAPS_URL);
    expect(within(footer).getByText(t(locale, 'site.hours.everyDay'))).toBeTruthy();
    expect(plain(footer.textContent)).toContain('09:00–23:00');
    // Printed international and grouped for reading, dialled as +digits.
    const phone = within(footer).getByRole('link', { name: '+964 770 000 0000' });
    expect(phone.getAttribute('href')).toBe(`tel:+${DIGITS}`);
    expect(phone.getAttribute('dir')).toBe('ltr');
    const chat = within(footer).getByRole('link', { name: t(locale, 'site.footer.whatsapp') });
    expect(waText(chat)).toBe(t(locale, 'site.whatsapp.general'));
    expect(
      within(footer)
        .getByRole('link', { name: t(locale, 'site.footer.privacy') })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(footer)
        .getByRole('link', { name: t(locale, 'site.footer.lessons') })
        .getAttribute('href'),
    ).toBe(`/${locale}#lessons`);
    expect(within(footer).getByText(t(locale, 'site.footer.developedBy'))).toBeTruthy();
  });

  it('omits the hours and the desk when the venue read failed; the address stays', () => {
    render(
      <SiteShell locale={locale} mode="night" nonce={undefined} venue={null} path="">
        <p>x</p>
      </SiteShell>,
    );
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).queryByText(t(locale, 'site.footer.hoursTitle'))).toBeNull();
    expect(within(footer).queryByText(t(locale, 'site.footer.phoneTitle'))).toBeNull();
    expect(document.querySelector('a[href^="tel:"], a[href*="wa.me"]')).toBeNull();
    expect(within(footer).getByText(t(locale, 'site.visit.address'))).toBeTruthy();
    // On the home page the header's booking button falls back to the section itself.
    const book = within(screen.getByRole('banner')).getByRole('link', {
      name: t(locale, 'site.hero.ctaVisit'),
    });
    expect(book.getAttribute('href')).toBe('#visit');
  });

  it('prints the week, day by day, when the days differ', () => {
    render(
      <SiteShell
        locale={locale}
        mode="night"
        nonce={undefined}
        venue={{
          ...VENUE_FIXTURE,
          opening_hours: { ...VENUE_FIXTURE.opening_hours, fri: [['14:00', '23:00']] },
        }}
        path=""
      >
        <p>x</p>
      </SiteShell>,
    );
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).queryByText(t(locale, 'site.hours.everyDay'))).toBeNull();
    const week = footer.querySelector('dl.tp-hours-list--week')!;
    expect(week.querySelectorAll('dt')).toHaveLength(7);
    expect(plain(week.textContent)).toContain('14:00–23:00');
  });
});

describe.each(LOCALES)('SiteShell on the 404, path null (%s)', (locale: Locale) => {
  /**
   * The 404 is none of the site's pages (cq-01, 2026-09-24): with `path=""` it used to be
   * framed as the HOME page, so the header's section links were bare fragments (#club)
   * that do not exist on it, its header floated transparent with white ink over a light
   * ground, and "Home" was marked the current page.
   */
  const renderLost = () =>
    render(
      <SiteShell locale={locale} mode="light" nonce={undefined} venue={VENUE_FIXTURE} path={null}>
        <p>lost</p>
      </SiteShell>,
    );

  it('is framed as a page, not the home page', () => {
    renderLost();
    expect(document.querySelector('.tp-site')?.getAttribute('data-page')).toBe('page');
  });

  it('links the sections home first and the other language to its home', () => {
    renderLost();
    const nav = screen.getByRole('navigation', { name: t(locale, 'site.nav.label'), ...hidden });
    expect(
      within(nav)
        .getAllByRole('link', hidden)
        .map((a) => a.getAttribute('href')),
    ).toEqual([`/${locale}#club`, `/${locale}#lessons`, `/${locale}/menu`, `/${locale}#visit`]);
    const other = locale === 'ar' ? 'en' : 'ar';
    for (const lang of document.querySelectorAll(`a[hreflang="${other}"]`)) {
      expect(lang.getAttribute('href')).toBe(`/${other}`);
    }
  });

  it('marks no footer link as the current page', () => {
    renderLost();
    const footer = screen.getByRole('contentinfo');
    expect(footer.querySelector('[aria-current]')).toBeNull();
  });
});

describe.each(LOCALES)('contact buttons (%s)', (locale: Locale) => {
  it('open WhatsApp with the message, or call, from a usable phone', () => {
    render(
      <>
        <WhatsAppButton
          locale={locale}
          phone="0770 123 4567"
          message={t(locale, 'site.whatsapp.lesson')}
          label="Chat"
          onHome
          className="b"
        />
        <CallButton phone="0770 123 4567" label="Call" className="b" />
      </>,
    );
    const chat = screen.getByRole('link', { name: 'Chat' });
    expect(chat.getAttribute('href')).toBe(
      `https://wa.me/9647701234567?text=${encodeURIComponent(t(locale, 'site.whatsapp.lesson'))}`,
    );
    expect(chat.getAttribute('data-contact')).toBe('whatsapp');
    expect(chat.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Call' }).getAttribute('href')).toBe(
      'tel:+9647701234567',
    );
  });

  it('say that they open WhatsApp when the label does not (a screen-reader cue)', () => {
    render(
      <WhatsAppButton
        locale={locale}
        phone="0770 123 4567"
        message="x"
        label={t(locale, 'site.nav.book')}
        cue={t(locale, 'site.onWhatsApp')}
        onHome
        className="b"
      />,
    );
    const book = screen.getByRole('link', {
      name: labelThen(t(locale, 'site.nav.book'), t(locale, 'site.onWhatsApp')),
    });
    // The cue is for screen readers; the chat glyph says it to the eye.
    expect(book.querySelector('.tp-site-sr')?.textContent).toBe(t(locale, 'site.onWhatsApp'));
    expect(book.querySelector('svg')).not.toBeNull();
  });

  it('become Plan your visit (and no call) without one', () => {
    render(
      <>
        <WhatsAppButton
          locale={locale}
          phone={null}
          message="x"
          label="Chat"
          cue=", on WhatsApp"
          onHome={false}
          icon={false}
          className="b"
        />
        <CallButton phone="not a phone" label="Call" className="b" />
      </>,
    );
    const visit = screen.getByRole('link', { name: t(locale, 'site.hero.ctaVisit') });
    expect(visit.getAttribute('href')).toBe(`/${locale}#visit`);
    // No WhatsApp, so no "on WhatsApp" cue either.
    expect(visit.getAttribute('data-contact')).toBe('visit');
    expect(visit.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Call' })).toBeNull();
    expect(visitHref(locale, true)).toBe('#visit');
    expect(visitHref(locale, false)).toBe(`/${locale}#visit`);
  });
});

describe('ThemeToggle', () => {
  beforeEach(() => {
    clearModeCookie();
    document.head.innerHTML = '<meta name="theme-color" content="#172C4F">';
  });
  afterEach(() => {
    clearModeCookie();
    document.head.innerHTML = '';
  });

  it('flips the wrapper, remembers the choice and recolours the browser chrome', async () => {
    render(
      <div className="tp-site" data-mode="night">
        <ThemeToggle
          initialMode="night"
          labels={{ toNight: 'To night', toLight: 'To light' }}
          themeColors={{ night: '#172C4F', light: '#F3F5F9' }}
        />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'To light' });
    await userEvent.click(button);
    expect(document.querySelector('.tp-site')?.getAttribute('data-mode')).toBe('light');
    expect(document.cookie).toContain(`${SITE_MODE_COOKIE}=light`);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#F3F5F9',
    );
    // Now it offers the way back.
    await userEvent.click(screen.getByRole('button', { name: 'To night' }));
    expect(document.querySelector('.tp-site')?.getAttribute('data-mode')).toBe('night');
    expect(document.cookie).toContain(`${SITE_MODE_COOKIE}=night`);
  });
});

describe.each(LOCALES)('StoreButtons (%s)', (locale: Locale) => {
  it('shows coming-soon buttons, not links, while the app is on neither store', () => {
    render(<StoreButtons locale={locale} links={{ appStore: null, googlePlay: null }} />);
    const appStore = screen.getByRole('button', {
      name: t(locale, 'site.app.comingSoonLabel', { store: t(locale, 'site.app.appStore') }),
    });
    expect(appStore.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('link')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows the official badge linking to the listing once a URL is set', () => {
    render(
      <StoreButtons
        locale={locale}
        links={{ appStore: 'https://apps.apple.com/app/id6809045183', googlePlay: null }}
      />,
    );
    const link = screen.getByRole('link', { name: t(locale, 'site.app.downloadOnAppStore') });
    expect(link.getAttribute('href')).toBe('https://apps.apple.com/app/id6809045183');
    expect(link.querySelector('img')?.getAttribute('src')).toBe(
      `/brand/stores/app-store-${locale}.svg`,
    );
    // Play is still coming soon.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('OpenNowPill', () => {
  const labels = {
    openNow: 'Open now',
    closedNow: 'Closed now',
    everyDay: 'Every day',
    opensAt: 'Opens {time}',
  };
  const OVERNIGHT = [
    ['00:00', '02:00'],
    ['09:00', '24:00'],
  ];
  const week = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, OVERNIGHT]),
  );

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says "Open now" at 20:00 Baghdad time, with the green state', async () => {
    vi.useFakeTimers({ now: new Date(Date.UTC(2026, 8, 23, 17, 0)), toFake: ['Date'] });
    render(
      <OpenNowPill hours="09:00–02:00" openingHours={week} closedDates={[]} labels={labels} />,
    );
    await act(async () => {});
    const pill = document.querySelector('.tp-open')!;
    expect(pill.getAttribute('data-status')).toBe('open');
    expect(pill.textContent).toContain('Open now');
    expect(pill.textContent).toContain('09:00–02:00');
  });

  it('says "Closed now · Opens 09:00" at 05:00 Baghdad time', async () => {
    vi.useFakeTimers({ now: new Date(Date.UTC(2026, 8, 23, 2, 0)), toFake: ['Date'] });
    render(
      <OpenNowPill hours="09:00–02:00" openingHours={week} closedDates={[]} labels={labels} />,
    );
    await act(async () => {});
    const pill = document.querySelector('.tp-open')!;
    expect(pill.getAttribute('data-status')).toBe('closed');
    expect(pill.textContent).toContain('Closed now');
    expect(pill.textContent?.replace(/[\u2066-\u2069]/g, '')).toContain('Opens 09:00');
  });
});
