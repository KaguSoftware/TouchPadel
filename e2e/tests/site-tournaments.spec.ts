/**
 * Tournaments on the website (T-8; docs/design/tournaments/build-contracts-2026-10-03.md §1.8,
 * §1.11), against the local stack once the tournaments migrations are in it:
 *
 *  1. The landing lists the tournament as a card under the Events ticket, its Details link on
 *     `/en/events/<id>` (the `tournaments_public` read, cached 60 s).
 *  2. The tournament's page: its name, never indexed or followed, no referrer, the schedule with
 *     round 1's scores and round 2 still to play, and the standings in the server's order, every
 *     player "First I." (no family name, no phone). Nothing scrolls sideways at 360 px.
 *  3. An id that names no tournament reads "not available".
 *  4. @ar: the same page right to left, the Arabic name and words.
 *
 * Seeds go straight into the tables with the service role, BEFORE the first render (the read is
 * cached: a page rendered before the seed would be served for the window, fc1c3e8f): the fixture
 * branch's `tournaments_enabled` switch on, a `done` tournament protocol run, and a running
 * Americano published from it with the eight `e2e-match-<a..h>` players (helpers'
 * seedMatchPlayers: terms accepted, so their names show), round 1 scored (15-9, 12-12) and round 2
 * drawn but unplayed. The publish, desk and phone journeys are their own specs; this one checks
 * only what the public site shows. Fixed ids, so a rerun replaces the same rows. afterAll removes
 * them and switches tournaments back off, so the other suites see the landing as before.
 *
 * The page reads a 30-second cache and the landing a 60-second one (`tournaments.server.ts`), so
 * a change made here is polled for with reloads rather than expected on the next load.
 */
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { en } from '../../packages/i18n/src/catalogs/en';
import { ar } from '../../packages/i18n/src/catalogs/ar';
import {
  FIXTURE_COURT_IDS,
  FIXTURE_VENUE_ID,
  SEED_STAFF,
  seedMatchPlayers,
  serviceClient,
  signedInClient,
} from './helpers';

const TOUR_ID = 'e2e70000-0000-4000-8000-000000000001';
const RUN_ID = 'e2e70000-0000-4000-8000-000000000101';
const ROUND_IDS = ['e2e70000-0000-4000-8000-000000000201', 'e2e70000-0000-4000-8000-000000000202'];
const ENTRY_IDS = [1, 2, 3, 4, 5, 6, 7, 8].map(
  (n) => `e2e70000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`,
);
const MATCH_IDS = [1, 2, 3, 4].map((n) => `e2e70000-0000-4000-8000-00000000040${n}`);
const NAME = { en: 'Playwright Americano', ar: 'أمريكانو التجربة' } as const;
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const CACHE_WINDOW_MS = 90_000;
const SMALL = { width: 360, height: 740 };

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth - el.clientWidth, document.body.scrollWidth - el.clientWidth);
  });
}

/** Reload `path` until `check` passes or the cache window has gone by. */
async function pollPage(page: Page, path: string, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(path);
    await check();
  }).toPass({ timeout: CACHE_WINDOW_MS, intervals: [2_000, 5_000, 10_000] });
}

async function must(label: string, step: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await step;
  if (error) throw new Error(`seedTournament ${label}: ${error.message}`);
}

/** The fixture branch's tournaments switch (`venue_settings.tournaments_enabled`). */
async function setTournamentsEnabled(svc: SupabaseClient, enabled: boolean): Promise<void> {
  await must(
    'switch',
    svc
      .from('venue_settings')
      .update({ tournaments_enabled: enabled })
      .eq('venue_id', FIXTURE_VENUE_ID),
  );
}

/** Everything a run of this spec writes, children first (rounds cascade to their matches). */
async function removeTournament(svc: SupabaseClient): Promise<void> {
  await must('clear matches', svc.from('tournament_matches').delete().eq('tournament_id', TOUR_ID));
  await must('clear rounds', svc.from('tournament_rounds').delete().eq('tournament_id', TOUR_ID));
  await must('clear entries', svc.from('tournament_entries').delete().eq('tournament_id', TOUR_ID));
  await must('clear tournament', svc.from('tournaments').delete().eq('id', TOUR_ID));
  await must('clear run', svc.from('protocol_runs').delete().eq('id', RUN_ID));
}

/** The running Americano: 8 players, round 1 scored, round 2 drawn. */
async function seedTournament(svc: SupabaseClient): Promise<void> {
  const players = await seedMatchPlayers(svc, LETTERS);
  for (const p of players) await p.client.auth.signOut();
  const owner = await signedInClient(SEED_STAFF.owner);
  const ownerId = (await owner.auth.getUser()).data.user?.id;
  await owner.auth.signOut();
  if (!ownerId) throw new Error('seedTournament: no owner id');

  const { data: template, error: templateErr } = await svc
    .from('protocol_templates')
    .select('id, version')
    .eq('venue_id', FIXTURE_VENUE_ID)
    .eq('kind', 'tournament')
    .limit(1)
    .single();
  if (templateErr || !template) throw new Error(`seedTournament template: ${templateErr?.message}`);

  await removeTournament(svc);
  const now = Date.now();
  const hours = (h: number) => new Date(now + h * 3_600_000).toISOString();

  await must(
    'run',
    svc.from('protocol_runs').insert({
      id: RUN_ID,
      venue_id: FIXTURE_VENUE_ID,
      template_id: (template as { id: string }).id,
      template_version: (template as { version: number }).version,
      kind: 'tournament',
      variant: 'type1',
      title_en: NAME.en,
      title_ar: NAME.ar,
      status: 'done',
      started_by: ownerId,
      finished_at: hours(-48),
      data: {},
    }),
  );
  await must(
    'tournament',
    svc.from('tournaments').insert({
      id: TOUR_ID,
      venue_id: FIXTURE_VENUE_ID,
      protocol_run_id: RUN_ID,
      name_en: NAME.en,
      name_ar: NAME.ar,
      format: 'americano',
      category: 'open',
      class: 'B',
      points_target: 24,
      rounds_planned: 7,
      max_entries: 8,
      min_entries: 4,
      waitlist_max: 0,
      entry_fee_iqd: 25000,
      prize_en: 'A racket for the winners',
      prize_ar: 'مضرب للفائزين',
      // Started an hour ago, so it is the soonest card on the landing.
      starts_at: hours(-1),
      ends_at: hours(3),
      registration_closes_at: hours(-2),
      status: 'running',
      closed_at: hours(-2),
      published_by: ownerId,
    }),
  );
  await must(
    'entries',
    svc.from('tournament_entries').insert(
      players.map((p, i) => ({
        id: ENTRY_IDS[i],
        venue_id: FIXTURE_VENUE_ID,
        tournament_id: TOUR_ID,
        guest_id: p.id,
        status: 'registered',
        seed_no: i + 1,
        added_by_kind: 'guest',
      })),
    ),
  );
  await must(
    'rounds',
    svc.from('tournament_rounds').insert(
      ROUND_IDS.map((id, i) => ({
        id,
        venue_id: FIXTURE_VENUE_ID,
        tournament_id: TOUR_ID,
        round_no: i + 1,
        generated_by: ownerId,
      })),
    ),
  );
  const e = ENTRY_IDS;
  const match = (
    id: string,
    round: number,
    court: number,
    [a1, a2, b1, b2]: string[],
    score: [number, number] | null,
  ) => ({
    id,
    venue_id: FIXTURE_VENUE_ID,
    tournament_id: TOUR_ID,
    round_id: ROUND_IDS[round - 1],
    round_no: round,
    court_id: FIXTURE_COURT_IDS[court - 1],
    a1,
    a2,
    b1,
    b2,
    points_a: score?.[0] ?? null,
    points_b: score?.[1] ?? null,
    scored_at: score ? hours(-0.5) : null,
    scored_by: score ? ownerId : null,
  });
  await must(
    'matches',
    svc
      .from('tournament_matches')
      .insert([
        match(MATCH_IDS[0]!, 1, 1, [e[0]!, e[1]!, e[2]!, e[3]!], [15, 9]),
        match(MATCH_IDS[1]!, 1, 2, [e[4]!, e[5]!, e[6]!, e[7]!], [12, 12]),
        match(MATCH_IDS[2]!, 2, 1, [e[0]!, e[2]!, e[4]!, e[6]!], null),
        match(MATCH_IDS[3]!, 2, 2, [e[1]!, e[3]!, e[5]!, e[7]!], null),
      ]),
  );
}

let svc: SupabaseClient;

test.beforeAll(async () => {
  svc = serviceClient();
  await seedTournament(svc);
  await setTournamentsEnabled(svc, true);
});

test.afterAll(async () => {
  await setTournamentsEnabled(svc, false);
  await removeTournament(svc);
});

test.describe('site tournaments', () => {
  test('the landing lists the tournament under the Events ticket, linking to its page', async ({
    page,
  }) => {
    const card = page.locator(`.tp-tour-card[data-tournament="${TOUR_ID}"]`);
    await pollPage(page, '/en', async () => {
      await expect(card).toBeVisible({ timeout: 2_000 });
    });
    await expect(page.locator('.tp-events__cards-title')).toHaveText(
      en.tournaments.web.eventsCards.title,
    );
    await expect(card.getByRole('heading', { level: 3 })).toHaveText(NAME.en);
    await expect(card).toContainText(en.tournaments.common.status.running);
    // The cards sit under the green ticket.
    const under = await page.evaluate(() => {
      const cards = document.querySelector('.tp-events__cards');
      const ticket = document.querySelector('.tp-ticket');
      return !!cards && !!ticket && !!(cards.compareDocumentPosition(ticket) & 2);
    });
    expect(under).toBe(true);
    await card.getByRole('link', { name: en.tournaments.web.eventsCards.details }).click();
    await expect(page).toHaveURL(new RegExp(`/en/events/${TOUR_ID}$`));
    await expect(page.getByRole('heading', { level: 1, name: NAME.en })).toBeVisible();
  });

  test('the page shows the schedule and the standings, First I. only, and is never indexed', async ({
    page,
  }) => {
    await pollPage(page, `/en/events/${TOUR_ID}`, async () => {
      await expect(page.locator('.tp-tpage__standing')).toHaveCount(8, { timeout: 2_000 });
    });
    await expect(page).toHaveTitle(`${NAME.en} · Touch Padel`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /nofollow/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');

    const rounds = page.locator('.tp-tpage__round');
    await expect(rounds).toHaveCount(2);
    const first = rounds.nth(0).locator('.tp-tpage__match').nth(0);
    await expect(first.locator('.tp-tpage__team--a')).toHaveText(/Aya S\..*Basma K\./);
    await expect(first.locator('.tp-tpage__score')).toHaveText(/15–9/);
    await expect(rounds.nth(1).locator('.tp-tpage__score').first()).toHaveText(
      en.tournaments.web.page.notPlayed,
    );

    // Server order: the two 15-point winners share rank 1 (seed order), the 9s last.
    const firstRow = page.locator('.tp-tpage__standing').nth(0).locator('td');
    await expect(firstRow.nth(0)).toContainText('1');
    await expect(firstRow.nth(1)).toContainText('Aya S.');
    await expect(firstRow.nth(2)).toContainText('15');
    await expect(firstRow.nth(3)).toContainText('+6');
    await expect(page.locator('.tp-tpage__standing').nth(7).locator('td').nth(0)).toContainText(
      '7',
    );

    // No family name, no phone: "First I." is all the page says about a player.
    const main = page.locator('main');
    for (const hidden of ['Saleh', 'Kareem', '+9647701'])
      await expect(main).not.toContainText(hidden);

    await expect(
      page.getByRole('link', { name: en.tournaments.web.page.openInApp }),
    ).toHaveAttribute('href', `touchpadel://tournament/${TOUR_ID}`);
    await page.setViewportSize(SMALL);
    await page.goto(`/en/events/${TOUR_ID}`);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('an id that names no tournament reads as not available', async ({ page }) => {
    await page.goto('/en/events/3f2b8c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b');
    await expect(
      page.getByRole('heading', { level: 1, name: en.tournaments.web.page.missing }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});

test.describe('site tournaments @ar', () => {
  test('Arabic is right to left, with the Arabic name and words', async ({ page }) => {
    await pollPage(page, `/ar/events/${TOUR_ID}`, async () => {
      await expect(page.locator('.tp-tpage__standing')).toHaveCount(8, { timeout: 2_000 });
    });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: NAME.ar })).toBeVisible();
    await expect(page.locator('#tpage-standings')).toHaveText(ar.tournaments.web.page.standings);
    await expect(page.locator('#tpage-schedule')).toHaveText(ar.tournaments.web.page.schedule);
    await expect(page.locator('.tp-tpage__eyebrow')).toContainText(
      ar.tournaments.common.format.americano,
    );
    await page.setViewportSize(SMALL);
    await page.goto(`/ar/events/${TOUR_ID}`);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('the Arabic landing names the tournament on its card', async ({ page }) => {
    const card = page.locator(`.tp-tour-card[data-tournament="${TOUR_ID}"]`);
    await pollPage(page, '/ar', async () => {
      await expect(card).toBeVisible({ timeout: 2_000 });
    });
    await expect(card.getByRole('heading', { level: 3 })).toHaveText(NAME.ar);
    await expect(
      card.getByRole('link', { name: ar.tournaments.web.eventsCards.details }),
    ).toHaveAttribute('href', `/ar/events/${TOUR_ID}`);
  });
});
