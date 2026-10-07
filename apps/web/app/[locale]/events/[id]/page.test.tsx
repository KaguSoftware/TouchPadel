import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatIQD, t, type Locale } from '@touch/i18n';
import { resetSiteRequest } from '@/lib/site/testSupport';
import {
  FEE_IQD,
  NEVER_SHOWN,
  TOUR_RUNNING,
  TOURNAMENT_ERROR,
  TOURNAMENT_MISSING,
  resetTournamentsServer,
  tournamentAnswer,
  tournamentRead,
  tournamentsServer,
} from '@/test/tournamentsFixtures';
import TournamentPage, { dynamic, generateMetadata } from './page';

/**
 * The tournament page, `/{locale}/events/<id>` (T-8; build contracts §1.8, §1.11), in both
 * languages: a tournament in play shows what, when and where, the facts, the schedule round by
 * round with its scores and the standings, players as "First I." / "Former player" / "Player n"
 * and nothing more; before the draw it says the schedule comes later; a cancelled one shows a
 * notice and no app buttons; an unknown, malformed or unavailable id all read the same "not
 * available", a failed read says so; the page refreshes itself only while play is on; it is never
 * indexed or followed and sends no referrer. The read is mocked at `@/lib/tournaments.server`.
 */
vi.mock('@/lib/tournaments.server', async () => {
  const { tournamentsServer } = await import('@/test/tournamentsFixtures');
  return {
    getCachedTournament: (id: string) => {
      tournamentsServer.calls += 1;
      tournamentsServer.ids.push(id);
      return Promise.resolve(tournamentsServer.page);
    },
    getCachedTournaments: () => Promise.resolve(tournamentsServer.list),
  };
});

vi.mock('@/lib/site/mode.server', async () => {
  const { siteRequest } = await import('@/lib/site/testSupport');
  return {
    getSiteMode: () => Promise.resolve(siteRequest.mode),
    getRequestNonce: () => Promise.resolve(siteRequest.nonce),
  };
});

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ refresh }),
}));

const LOCALES = ['en', 'ar'] as const;
const UNKNOWN = '3f2b8c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b';

const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩]/g, '');
const heading = () => screen.getByRole('heading', { level: 1 }).textContent;

async function renderPage(locale: string, id: string = TOUR_RUNNING) {
  const element = await TournamentPage({ params: Promise.resolve({ locale, id }) });
  return render(element);
}

const metadata = (locale: string, id: string = TOUR_RUNNING) =>
  generateMetadata({ params: Promise.resolve({ locale, id }) });

beforeEach(() => {
  resetSiteRequest();
  resetTournamentsServer(undefined, tournamentRead(tournamentAnswer()));
  refresh.mockClear();
});

afterEach(() => {
  resetTournamentsServer();
});

describe.each(LOCALES)('tournament page (%s)', (locale: Locale) => {
  const name = locale === 'ar' ? 'ليلة النادي' : 'Club Night';

  it('shows what, when and where, and the facts', async () => {
    const { container } = await renderPage(locale);
    const frame = container.querySelector('.tp-tpage');
    expect(frame?.getAttribute('data-state')).toBe('ok');
    expect(frame?.getAttribute('data-status')).toBe('running');
    expect(heading()).toBe(name);
    expect(container.querySelector('.tp-tpage__eyebrow')?.textContent).toBe(
      `${t(locale, 'tournaments.common.format.americano')} · ${t(locale, 'matches.common.categoryOpen')}`,
    );
    expect(container.querySelector('.tp-tpage__at')?.textContent).toBe(
      locale === 'ar' ? 'بادل التجربة' : 'Fixture Padel',
    );
    expect(container.querySelector('.tp-tpage__when')?.textContent).toBeTruthy();
    const facts = [...container.querySelectorAll('.tp-tpage__fact dd')].map((d) =>
      plain(d.textContent),
    );
    expect(facts).toEqual([
      plain(t(locale, 'tournaments.web.fee', { amount: formatIQD(FEE_IQD, locale) })),
      plain(t(locale, 'tournaments.common.pointsTarget', { points: '24' })),
      t(locale, 'tournaments.common.status.running'),
      locale === 'ar' ? 'مضرب للفائزين' : 'A racket for the winners',
    ]);
  });

  it('shows the schedule round by round, courts by number, scores and the unplayed', async () => {
    const { container } = await renderPage(locale);
    const rounds = [...container.querySelectorAll('.tp-tpage__round')];
    expect(rounds.map((r) => r.getAttribute('data-round'))).toEqual(['1', '2']);
    const first = rounds[0]!;
    expect(plain(first.querySelector('h3')?.textContent)).toBe(
      plain(t(locale, 'tournaments.common.round', { round: '1' })),
    );
    const matches = [...first.querySelectorAll('.tp-tpage__match')];
    expect(plain(matches[0]!.querySelector('.tp-tpage__court')?.textContent)).toBe(
      plain(t(locale, 'tournaments.web.page.court', { court: '1' })),
    );
    expect(plain(matches[0]!.querySelector('.tp-tpage__team--a')?.textContent)).toBe(
      plain(t(locale, 'tournaments.web.page.team', { one: 'Aya S.', two: 'Basma K.' })),
    );
    expect(plain(matches[0]!.querySelector('.tp-tpage__score')?.textContent)).toBe('15–9');
    // A former account and a desk-added profile without accepted terms.
    const second = plain(matches[1]!.textContent);
    expect(second).toContain(t(locale, 'tournaments.common.formerPlayer'));
    expect(second).toContain(plain(t(locale, 'tournaments.common.player', { no: '7' })));
    const unplayed = rounds[1]!.querySelector('.tp-tpage__score');
    expect(unplayed?.getAttribute('data-played')).toBe('false');
    expect(unplayed?.textContent).toBe(t(locale, 'tournaments.web.page.notPlayed'));
  });

  it('shows the standings with shared ranks and signed differences', async () => {
    const { container } = await renderPage(locale);
    const table = screen.getByRole('table', { name: t(locale, 'tournaments.web.page.standings') });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(8);
    const cells = (i: number) =>
      [...rows[i]!.querySelectorAll('td')].map((td) => plain(td.textContent));
    expect(cells(0)).toEqual(['1', 'Aya S.', '15', '+6', '1']);
    expect(cells(1)[0]).toBe('1');
    expect(cells(6)).toEqual(['7', 'Celine N.', '9', '−6', '1']);
    // 0311 (c27): an entry that left the play is marked.
    expect(cells(7)[1]).toContain(locale === 'ar' ? 'انسحب' : 'left');
    expect(container.querySelector('.tp-tpage__table')).not.toBeNull();
  });

  it('opens the app on the tournament, offers the app band, and refreshes while in play', async () => {
    const { container } = await renderPage(locale);
    const open = screen.getByRole('link', { name: t(locale, 'tournaments.web.page.openInApp') });
    expect(open.getAttribute('href')).toBe(`touchpadel://tournament/${TOUR_RUNNING}`);
    expect(
      screen
        .getByRole('link', { name: t(locale, 'tournaments.web.page.noApp') })
        .getAttribute('href'),
    ).toBe(`/${locale}#app`);
    expect(
      screen
        .getByRole('link', { name: t(locale, 'tournaments.web.page.allEvents') })
        .getAttribute('href'),
    ).toBe(`/${locale}#events`);
    expect(container.querySelector('.tp-tpage__live')?.textContent).toBe(
      t(locale, 'tournaments.web.page.live'),
    );
    expect(container.querySelector('script')).toBeNull();
  });

  it('asks to register in the app while registration is open, before the draw', async () => {
    resetTournamentsServer(
      undefined,
      tournamentRead(
        tournamentAnswer({ status: 'open', rounds: false, serverNow: '2026-10-02T12:00:00+00:00' }),
      ),
    );
    const { container } = await renderPage(locale);
    expect(
      screen
        .getByRole('link', { name: t(locale, 'tournaments.web.page.registerInApp') })
        .getAttribute('href'),
    ).toBe(`touchpadel://tournament/${TOUR_RUNNING}`);
    expect(container.querySelector('.tp-tpage__empty')?.textContent).toBe(
      t(locale, 'tournaments.web.page.noSchedule'),
    );
    expect(container.querySelector('.tp-tpage__table')).toBeNull();
    expect(container.querySelector('.tp-tpage__live')).toBeNull();
  });

  it('past the cut-off, before the sweep closes it, opens the app instead of asking to register', async () => {
    resetTournamentsServer(
      undefined,
      tournamentRead(
        tournamentAnswer({ status: 'open', rounds: false, serverNow: '2026-10-02T15:00:30+00:00' }),
      ),
    );
    await renderPage(locale);
    expect(
      screen.queryByRole('link', { name: t(locale, 'tournaments.web.page.registerInApp') }),
    ).toBeNull();
    expect(
      screen.getByRole('link', { name: t(locale, 'tournaments.web.page.openInApp') }),
    ).toBeTruthy();
  });

  it('shows a cancelled tournament with its notice, no app buttons and no schedule', async () => {
    resetTournamentsServer(
      undefined,
      tournamentRead(tournamentAnswer({ status: 'cancelled', rounds: false })),
    );
    const { container } = await renderPage(locale);
    expect(heading()).toBe(name);
    expect(screen.getByRole('status').textContent).toBe(
      t(locale, 'tournaments.web.page.cancelled'),
    );
    expect(container.querySelector('.tp-tpage__open')).toBeNull();
    expect(container.querySelector('.tp-tpage__rounds, .tp-tpage__empty')).toBeNull();
    expect(container.querySelector('.tp-tpage__live')).toBeNull();
  });

  it('reads every missing case the same, and a failed read as an error', async () => {
    resetTournamentsServer(undefined, TOURNAMENT_MISSING);
    const { container, unmount } = await renderPage(locale, UNKNOWN);
    expect(container.querySelector('.tp-tpage')?.getAttribute('data-state')).toBe('missing');
    expect(heading()).toBe(t(locale, 'tournaments.web.page.missing'));
    expect(container.querySelector('.tp-tpage__open')).toBeNull();
    unmount();

    resetTournamentsServer(undefined, TOURNAMENT_ERROR);
    await renderPage(locale);
    expect(heading()).toBe(t(locale, 'tournaments.web.page.error'));
  });

  it('names nobody beyond "First I.": no guest id, phone, full name or court id', async () => {
    const { container } = await renderPage(locale);
    for (const secret of NEVER_SHOWN) expect(container.innerHTML, secret).not.toContain(secret);
  });

  it('keeps the tournament across the language switch, and offers home and support', async () => {
    await renderPage(locale);
    const other = locale === 'en' ? 'ar' : 'en';
    expect(document.querySelector(`a[hreflang="${other}"]`)?.getAttribute('href')).toBe(
      `/${other}/events/${TOUR_RUNNING}`,
    );
    expect(
      screen.getByRole('link', { name: t(locale, 'site.brandHome') }).getAttribute('href'),
    ).toBe(`/${locale}`);
    expect(
      screen.getByRole('link', { name: t(locale, 'site.footer.support') }).getAttribute('href'),
    ).toBe(`/${locale}/support`);
  });

  it('is never indexed or followed, sends no referrer, and titles the page with the tournament', async () => {
    const meta = await metadata(locale);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.referrer).toBe('no-referrer');
    expect(meta.title).toBe(name);
    const image = `og-touch-padel-${locale}.png`;
    expect(JSON.stringify(meta.openGraph)).toContain(image);
    expect(JSON.stringify(meta.openGraph)).toContain(name);
    expect(JSON.stringify(meta.twitter)).toContain(image);

    resetTournamentsServer(undefined, TOURNAMENT_MISSING);
    const missing = await metadata(locale, UNKNOWN);
    expect(missing.title).toBe(t(locale, 'tournaments.web.page.title'));
    expect(missing.robots).toEqual({ index: false, follow: false });
    expect(missing.referrer).toBe('no-referrer');
  });

  it('paints in the visitor’s mode, in the padel theme, with its sheet under the nonce', async () => {
    const { container } = await renderPage(locale);
    const frame = container.querySelector('.tp-tpage');
    expect(frame?.getAttribute('data-theme')).toBe('padel');
    expect(frame?.getAttribute('data-mode')).toBe('night');
    expect(container.querySelector('style')?.getAttribute('nonce')).toBe('test-nonce-0123456789');
  });
});

describe('tournament page, the id', () => {
  it.each([
    ['not a uuid', 'friday'],
    ['too short', TOUR_RUNNING.slice(1)],
    ['markup', '"><script>alert(1)</script>'],
  ])(
    'never reads for an id that is %s: not available, the other language’s events',
    async (_, id) => {
      await renderPage('en', id);
      expect(tournamentsServer.calls).toBe(0);
      expect(heading()).toBe(t('en', 'tournaments.web.page.missing'));
      expect(document.querySelector('a[hreflang="ar"]')?.getAttribute('href')).toBe('/ar#events');
    },
  );

  it('reads an upper-case id as its tournament', async () => {
    await renderPage('en', TOUR_RUNNING.toUpperCase());
    expect(tournamentsServer.ids).toEqual([TOUR_RUNNING]);
    expect(heading()).toBe('Club Night');
  });
});

describe('tournament page, the route', () => {
  it('is rendered per request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('404s on a segment that is not a locale', async () => {
    await expect(renderPage('de')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(metadata('de')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sets no cookie, never jumps to the app, and is not in the sitemap', () => {
    const source = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    for (const src of [source('./page.tsx'), source('../../../../src/lib/tournaments.ts')]) {
      expect(src).not.toMatch(/document\.cookie|cookies\(\)\)?\.set\(|set-cookie/i);
      expect(src).not.toMatch(/import[^;]*\b(LanguageLink|ThemeToggle|OpenAppOnLoad)\b/);
      expect(src).not.toMatch(/location\.(replace|assign|href\s*=)/);
    }
    expect(source('../../../sitemap.ts')).not.toMatch(/events/);
  });
});
