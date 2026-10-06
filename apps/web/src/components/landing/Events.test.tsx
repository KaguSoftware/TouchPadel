import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatIQD, t, type Locale } from '@touch/i18n';
import {
  FEE_IQD,
  NEVER_SHOWN,
  TOUR_FINISHED,
  TOUR_FRIDAY,
  TOUR_FULL,
  TOUR_RUNNING,
  TOUR_WOMEN,
  TOURNAMENTS_ERROR,
  TOURNAMENTS_OFF,
  tournamentsAnswer,
  tournamentsRead,
} from '@/test/tournamentsFixtures';
import type { TournamentsRead } from '@/lib/tournaments';
import { Events } from './Events';

/**
 * Events with and without tournaments (T-8; build contracts §1.11): until one is coming up (off,
 * none upcoming, a failed read) the section is exactly the poster and the entry pass; once one
 * is, the next three sit under the green ticket as cards with the date, the name, the format and
 * category, the fee, the places and the two links, and nothing a server should never have sent.
 * The look and the Arabic mirror are Playwright's (e2e/tests/site-tournaments.spec.ts).
 */
vi.mock('@/components/landing/photos', () => {
  const still = (name: string) => ({
    src: `/_next/static/media/${name}.jpg`,
    width: 2400,
    height: 1600,
    blurWidth: 8,
    blurHeight: 5,
    blurDataURL: 'data:image/jpeg;base64,AAAA',
  });
  return { PHOTOS: { events: still('events') } };
});

// The venue's own WhatsApp number (public), not a guest's: NEVER_SHOWN carries a guest phone.
const PHONE = '+964 780 555 0101';
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩]/g, '');

const renderEvents = (locale: Locale, tournaments: TournamentsRead) =>
  render(<Events locale={locale} phone={PHONE} tournaments={tournaments} />);

describe('Events without tournaments', () => {
  it.each([
    ['switched off', TOURNAMENTS_OFF],
    ['a failed read', TOURNAMENTS_ERROR],
    [
      'none coming up (one finished)',
      tournamentsRead(tournamentsAnswer({ only: [TOUR_FINISHED] })),
    ],
  ])('is the section as it was when %s', (_, read) => {
    const { container } = renderEvents('en', read);
    expect(container.querySelector('.tp-events__cards')).toBeNull();
    expect(container.querySelector('.tp-tour-card')).toBeNull();
    expect(container.querySelector('.tp-events__stage')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      t('en', 'site.events.title'),
    );
  });
});

describe.each(['en', 'ar'] as const)('Events with tournaments (%s)', (locale) => {
  const read = tournamentsRead(tournamentsAnswer());

  it('lists the next three upcoming under the ticket, soonest first, never the finished', () => {
    const { container } = renderEvents(locale, read);
    const cards = container.querySelector('.tp-events__cards')!;
    expect(cards).not.toBeNull();
    expect(
      cards.compareDocumentPosition(container.querySelector('.tp-ticket')!) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(cards.querySelector('h2')?.textContent).toBe(
      t(locale, 'tournaments.web.eventsCards.title'),
    );
    const list = within(cards as HTMLElement).getByRole('list', {
      name: t(locale, 'tournaments.web.eventsCards.title'),
    });
    const ids = within(list)
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-tournament'));
    expect(ids).toEqual([TOUR_RUNNING, TOUR_FRIDAY, TOUR_FULL]);
    expect(ids).not.toContain(TOUR_FINISHED);
    expect(ids).not.toContain(TOUR_WOMEN);
  });

  it('says what each one is: when, name, format and category, fee, places', () => {
    const { container } = renderEvents(locale, read);
    const friday = container.querySelector(`[data-tournament="${TOUR_FRIDAY}"]`)!;
    expect(friday.querySelector('h3')?.textContent).toBe(
      locale === 'ar' ? 'أمريكانو الجمعة' : 'Friday Americano',
    );
    expect(friday.querySelector('.tp-tour-card__when')?.textContent).toBeTruthy();
    // Two branches in the answer: the card names its own.
    expect(friday.querySelector('.tp-tour-card__what')?.textContent).toBe(
      `${t(locale, 'tournaments.common.format.americano')} · ${t(locale, 'matches.common.categoryOpen')} · ${locale === 'ar' ? 'بادل التجربة' : 'Fixture Padel'}`,
    );
    expect(plain(friday.querySelector('.tp-tour-card__fee')?.textContent)).toBe(
      plain(t(locale, 'tournaments.web.fee', { amount: formatIQD(FEE_IQD, locale) })),
    );
    expect(plain(friday.querySelector('.tp-tour-card__places')?.textContent)).toBe(
      plain(t(locale, 'tournaments.web.eventsCards.placesLeft', { count: '5' })),
    );
    const full = container.querySelector(`[data-tournament="${TOUR_FULL}"]`)!;
    expect(full.querySelector('.tp-tour-card__places')?.textContent).toBe(
      t(locale, 'tournaments.web.eventsCards.full'),
    );
    const running = container.querySelector(`[data-tournament="${TOUR_RUNNING}"]`)!;
    expect(running.querySelector('.tp-tour-card__places')?.textContent).toBe(
      t(locale, 'tournaments.common.status.running'),
    );
  });

  it('offers Register in the app only while registration is open, and Details on every card', () => {
    const { container } = renderEvents(locale, read);
    const links = (id: string) =>
      [...container.querySelectorAll(`[data-tournament="${id}"] a`)].map((a) => [
        a.textContent,
        a.getAttribute('href'),
      ]);
    expect(links(TOUR_FRIDAY)).toEqual([
      [t(locale, 'tournaments.web.eventsCards.registerInApp'), `/${locale}#app`],
      [t(locale, 'tournaments.web.eventsCards.details'), `/${locale}/events/${TOUR_FRIDAY}`],
    ]);
    expect(links(TOUR_RUNNING)).toEqual([
      [t(locale, 'tournaments.web.eventsCards.details'), `/${locale}/events/${TOUR_RUNNING}`],
    ]);
  });

  it('drops Register in the app once the cut-off has passed, before the sweep closes it', () => {
    // Friday's cut-off is 2026-10-08 15:00 UTC; the read comes a minute after it.
    const late = tournamentsRead({
      ...tournamentsAnswer(),
      server_now: '2026-10-08T15:01:00+00:00',
    });
    const { container } = renderEvents(locale, late);
    const texts = [...container.querySelectorAll(`[data-tournament="${TOUR_FRIDAY}"] a`)].map(
      (a) => a.textContent,
    );
    expect(texts).toEqual([t(locale, 'tournaments.web.eventsCards.details')]);
  });

  it('keeps the poster, the ticket and the WhatsApp ask above the cards', () => {
    const { container } = renderEvents(locale, read);
    expect(container.querySelector('.tp-events__stage')).not.toBeNull();
    expect(container.querySelector('#events-title')?.textContent).toBe(
      t(locale, 'site.events.title'),
    );
  });

  it('prints nothing a public read must never carry', () => {
    const { container } = renderEvents(locale, read);
    for (const secret of NEVER_SHOWN) expect(container.innerHTML, secret).not.toContain(secret);
  });
});

describe('Events with one branch', () => {
  it('names no branch on the card', () => {
    const raw = tournamentsAnswer({ only: [TOUR_FRIDAY] });
    raw.branches = (raw.branches as unknown[]).slice(0, 1);
    const { container } = renderEvents('en', tournamentsRead(raw));
    expect(container.querySelector('.tp-tour-card__what')?.textContent).toBe(
      `${t('en', 'tournaments.common.format.americano')} · ${t('en', 'matches.common.categoryOpen')}`,
    );
  });
});
