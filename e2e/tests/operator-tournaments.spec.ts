/**
 * Tournaments on the operator (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.6, plan §5.1 "e2e"), against the local stack once the three tournament
 * migrations are in it. The play is tomorrow evening on the branch's clock
 * (dates relative to the business day, fe02efb8), on both fixture courts.
 * Labels are read from the catalogs, so a copy edit does not break a journey.
 *
 *  1. Manager: a seeded done type-1 run (owner-approved feasibility, a fee,
 *     both courts blocked as its event) → "Publish as tournament" on its run
 *     sheet → the tournament screen. Nine guests register the phone's way
 *     (eight places, one waitlisted); the cut-off passes and the sweep closes
 *     it. One player did not show and the waitlisted one substitutes; one
 *     entry fee is taken in cash; the Americano starts on both courts; round 1
 *     is scored, one score corrected with a reason; the standings lead with
 *     the corrected winners.
 *  2. @ar: the tournament screen in Arabic, right to left.
 *
 * The run is seeded straight into the tables (service role) because the
 * protocol's own walk to `done` (plan, feasibility, marketing, courts, ready)
 * is covered by operator-protocols.spec.ts and the db suites; what this spec
 * owns starts at a done run. cleanE2eTournaments ends what a run leaves, so a
 * rerun without a db reset starts clean.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import { ar } from '../../packages/i18n/src/catalogs/ar';
import { en } from '../../packages/i18n/src/catalogs/en';
import {
  DEV_PASSWORD,
  FIXTURE_COURT_IDS,
  FIXTURE_VENUE_ID,
  SEED_STAFF,
  appRpc,
  closeStationShift,
  ensureOpenDay,
  passShiftGate,
  seedMatchPlayers,
  serviceClient,
  showEveryRow,
  signedInClient,
  venueBusinessDate,
  venueTime,
  type MatchPlayer,
} from './helpers';

const OPERATOR_URL = process.env.E2E_OPERATOR_URL ?? CONFIG_OPERATOR_URL;
const [COURT_1, COURT_2] = FIXTURE_COURT_IDS;
const T = en.ws.tournaments;
/** Every seeded run's English name starts with this, so the clean-up finds them. */
const E2E_TOURNAMENT_NAME = 'Playwright Cup';
const FEE = 25_000;

async function signIn(browser: Browser, email: string, locale: 'en' | 'ar' = 'en'): Promise<Page> {
  const context = await browser.newContext({ locale: locale === 'ar' ? 'ar-IQ' : 'en-US' });
  await context.addInitScript((l) => {
    try {
      localStorage.setItem('touch-operator-locale', l);
    } catch {
      /* no storage */
    }
  }, locale);
  const page = await context.newPage();
  await page.goto(`${OPERATOR_URL}/`);
  const emailBox = page.locator('input[type="email"]');
  await emailBox.waitFor({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.locator('input[type="password"]').fill(DEV_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 30_000 });
  return page;
}

/** A catalog sentence as a pattern: its words literal, each `{placeholder}` anything (bidi isolates included). */
function phrase(template: string): RegExp {
  const escaped = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\{\w+\}/g, '.*?').replace(/[{}]/g, '\\$&'));
}

/** The kit's ReasonCodePrompt: pick the reason by its words, then Continue. */
async function giveReason(page: Page, reason: string): Promise<void> {
  const prompt = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('radiogroup') })
    .last();
  await expect(prompt).toBeVisible();
  await prompt.locator('label.tp-choice').filter({ hasText: reason }).click();
  await prompt.getByRole('button', { name: en.ws.kit.reason.confirm }).click();
  await expect(prompt).toBeHidden({ timeout: 30_000 });
}

async function idOf(email: string): Promise<string> {
  const c = await signedInClient(email);
  const id = (await c.auth.getUser()).data.user?.id;
  if (!id) throw new Error(`no user id for ${email}`);
  return id;
}

/**
 * A done type-1 tournament run, as the protocol leaves one: the plan in
 * `data` (8–16 players, a fee), a passed feasibility step with the owner's
 * approval (what lets the fee through publish, T-6), and its event blocks on
 * both fixture courts. Returns the run id.
 */
async function seedDoneRun(svc: SupabaseClient, from: Date, to: Date): Promise<string> {
  const ownerId = await idOf(SEED_STAFF.owner);
  const managerId = await idOf(SEED_STAFF.manager);
  const { data: tpl, error: tErr } = await svc
    .from('protocol_templates')
    .select('id, version')
    .eq('venue_id', FIXTURE_VENUE_ID)
    .eq('kind', 'tournament')
    .eq('variant', 'type1')
    .single();
  if (tErr) throw new Error(`seedDoneRun template: ${tErr.message}`);
  const plan = {
    class: 'B',
    name_en: `${E2E_TOURNAMENT_NAME} ${Date.now() % 100000}`,
    name_ar: 'كأس الاختبار',
    format: 'americano',
    capacity: { unit: 'players', count: 8 },
    entry_fee_iqd: FEE,
    ranges: [{ court_ids: [COURT_1, COURT_2], from: from.toISOString(), to: to.toISOString() }],
  };
  const now = new Date().toISOString();
  const { data: run, error: rErr } = await svc
    .from('protocol_runs')
    .insert({
      venue_id: FIXTURE_VENUE_ID,
      kind: 'tournament',
      variant: 'type1',
      template_id: (tpl as { id: string }).id,
      template_version: (tpl as { version: number }).version,
      title_en: plan.name_en,
      title_ar: plan.name_ar,
      status: 'done',
      started_by: managerId,
      started_at: now,
      finished_at: now,
      data: plan,
    })
    .select('id')
    .single();
  if (rErr) throw new Error(`seedDoneRun run: ${rErr.message}`);
  const runId = (run as { id: string }).id;
  const { data: step, error: sErr } = await svc
    .from('protocol_run_steps')
    .insert({
      run_id: runId,
      step_key: 'feasibility',
      name_en: 'Feasibility',
      name_ar: 'الجدوى',
      position: 2,
      round: 1,
      status: 'passed',
      needs_owner_ok: true,
      optional: false,
      actor_roles: ['manager'],
      after_keys: ['plan'],
      passed_at: now,
    })
    .select('id')
    .single();
  if (sErr) throw new Error(`seedDoneRun step: ${sErr.message}`);
  const { error: subErr } = await svc.from('protocol_submissions').insert({
    run_id: runId,
    run_step_id: (step as { id: string }).id,
    round: 1,
    record: { staffing: 'Two', income_iqd: FEE * 8, cost_iqd: 0, risks: 'None' },
    submitted_by: managerId,
    submitted_at: now,
    decision: 'approve',
    decided_by: ownerId,
    decided_at: now,
  });
  if (subErr) throw new Error(`seedDoneRun submission: ${subErr.message}`);
  for (const court of [COURT_1, COURT_2]) {
    const { error } = await svc.from('reservations').insert({
      venue_id: FIXTURE_VENUE_ID,
      court_id: court,
      kind: 'maintenance',
      block_purpose: 'event',
      protocol_run_id: runId,
      status: 'confirmed',
      source: 'desk', // as app.block_courts_for_event writes an event block
      start_at: from.toISOString(),
      end_at: to.toISOString(),
      notes: plan.name_en,
      created_by_staff_id: managerId,
    });
    if (error) throw new Error(`seedDoneRun block: ${error.message}`);
  }
  return runId;
}

/** End every e2e tournament a run left: cancel it the RPC way, so its blocks go too. */
async function cleanE2eTournaments(svc: SupabaseClient): Promise<void> {
  const manager = await signedInClient(SEED_STAFF.manager);
  const { data } = await svc
    .from('tournaments')
    .select('id, status')
    .like('name_en', `${E2E_TOURNAMENT_NAME}%`)
    .in('status', ['open', 'closed', 'running']);
  for (const t of (data ?? []) as { id: string }[]) {
    await appRpc(manager, 'tournament_cancel', {
      p_tournament_id: t.id,
      p_reason: 'staff_error',
    }).catch(() => undefined);
  }
  // A seeded run that never got published: release its blocks.
  await svc
    .from('reservations')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'e2e',
    })
    .eq('block_purpose', 'event')
    .like('notes', `${E2E_TOURNAMENT_NAME}%`)
    .in('status', ['pending', 'confirmed']);
}

test.describe('operator tournaments', () => {
  test.describe.configure({ mode: 'serial' });

  const night = venueBusinessDate(1);
  let svc: SupabaseClient;
  let players: MatchPlayer[] = [];

  test.beforeAll(async () => {
    svc = serviceClient();
    await cleanE2eTournaments(svc);
    await ensureOpenDay(svc);
    await closeStationShift();
    const owner = await signedInClient(SEED_STAFF.owner);
    await appRpc(owner, 'set_tournaments_enabled', {
      p_venue_id: FIXTURE_VENUE_ID,
      p_enabled: true,
    });
    // Nine guests: eight fill the field (capacity 8), the ninth waits.
    players = await seedMatchPlayers(svc, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  });

  test.afterAll(async () => {
    await cleanE2eTournaments(svc);
    const owner = await signedInClient(SEED_STAFF.owner);
    await appRpc(owner, 'set_tournaments_enabled', {
      p_venue_id: FIXTURE_VENUE_ID,
      p_enabled: false,
    });
    await closeStationShift();
  });

  test('publish from a done run, a no-show with a substitute, a fee, round 1 scored and corrected, the standings', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const runId = await seedDoneRun(svc, venueTime(night, '18:00'), venueTime(night, '22:00'));

    // 1. Publish from the run sheet (the dialog opens on the plan's defaults).
    const page = await signIn(browser, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/protocols?run=${runId}`);
    await page.getByRole('button', { name: T.publish.action }).click();
    await expect(page.getByTestId('publish-dialog')).toBeVisible();
    await page.getByRole('button', { name: T.publish.submit, exact: true }).click();
    await page.getByRole('button', { name: T.publish.openTournament }).click();
    await expect(page.getByTestId('tournament-detail')).toBeVisible({ timeout: 30_000 });
    const tournamentId = /\/desk\/tournaments\/([0-9a-f-]{36})/.exec(page.url())![1]!;

    // 2. Nine register the phone's way: eight places, the ninth on the waitlist.
    for (const p of players)
      await appRpc(p.client, 'tournament_register', { p_tournament_id: tournamentId });
    // The cut-off passes; the sweep closes a tournament with enough players.
    await svc
      .from('tournaments')
      .update({ registration_closes_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', tournamentId);
    await appRpc(svc, 'tournament_sweep', {});
    await page.reload();
    const entries = page.getByTestId('entries-panel');
    // The entries table shows three until "View more" (header + 3).
    await expect(entries.getByRole('row')).toHaveCount(4, { timeout: 30_000 });
    await showEveryRow(page);
    await expect(entries.getByRole('row')).toHaveCount(10); // header + 9

    // 3. One did not show: the waitlisted player takes the place.
    const absent = entries.getByRole('row').filter({ hasText: players[1]!.name });
    await absent.getByRole('button', { name: T.entries.noShow }).click();
    const noShow = page.getByRole('dialog', { name: phrase(T.entries.noShowTitle) });
    await noShow.locator('label.tp-choice').filter({ hasText: players[8]!.name }).click();
    await noShow.getByRole('button', { name: T.entries.noShowConfirm }).click();
    await expect(noShow).toBeHidden({ timeout: 30_000 });
    await expect(absent).toContainText(en.tournaments.common.entryStatus.no_show, {
      timeout: 30_000,
    });
    await expect(entries.getByRole('row').filter({ hasText: players[8]!.name })).toContainText(
      en.tournaments.common.entryStatus.registered,
    );

    // 4. One entry fee, in cash.
    const payer = entries.getByRole('row').filter({ hasText: players[0]!.name });
    await payer.getByRole('button', { name: T.entries.takePayment }).click();
    await passShiftGate(page);
    const cash = page.getByRole('dialog', { name: 'Cash' });
    await cash.getByLabel('Tendered').fill(String(FEE));
    await cash.getByRole('button', { name: 'Record payment' }).click();
    await expect(cash).toBeHidden({ timeout: 30_000 });
    await expect(payer).toContainText(T.entries.paid, { timeout: 30_000 });

    // 5. Start the Americano on both courts.
    await page.getByRole('tab', { name: new RegExp(T.detail.tabs.rounds) }).click();
    await page.getByRole('button', { name: T.rounds.start }).click();
    const start = page.getByRole('dialog', { name: T.rounds.startTitle });
    await start.getByRole('button', { name: T.rounds.generate }).click();
    await expect(start).toBeHidden({ timeout: 30_000 });
    const roundOne = page.getByTestId('rounds-board').locator('section').first();
    await expect(roundOne).toBeVisible({ timeout: 30_000 });

    // 6. Score round 1: both matches 15 to 9 (side B is filled as 24 − 15), each
    //    in the pop-up its "Enter score" opens.
    for (let i = 0; i < 2; i++) {
      await roundOne.getByRole('button', { name: T.score.enter }).first().click();
      const entry = page.getByRole('dialog', { name: T.score.enter });
      await entry.getByLabel(phrase(T.score.pointsFor)).first().fill('15');
      await expect(entry.getByTestId('score-other')).toContainText('9');
      await entry.getByRole('button', { name: T.score.save }).click();
      await expect(entry).toBeHidden({ timeout: 30_000 });
      await expect(roundOne.getByTestId('match-score')).toHaveCount(i + 1, { timeout: 30_000 });
    }

    // 7. Correct one score, with a reason.
    await roundOne.getByRole('button', { name: T.score.correct }).first().click();
    const correction = page
      .getByRole('dialog', { name: T.score.correctionTitle })
      .filter({ has: page.getByTestId('score-other') });
    await correction.getByLabel(phrase(T.score.pointsFor)).first().fill('20');
    await correction.getByRole('button', { name: T.score.save }).click();
    await giveReason(page, en.op.reasons.staff_error);
    await expect(roundOne.getByTestId('match-score').first()).toContainText('20–4', {
      timeout: 30_000,
    });

    // 8. The standings lead with the corrected 20-point winners.
    await page.getByRole('tab', { name: T.detail.tabs.standings }).click();
    const table = page.getByRole('table', { name: T.standings.title });
    await expect(table.getByRole('row').nth(1)).toContainText('20', { timeout: 30_000 });
    await page.context().close();
  });

  test('@ar the tournament screen in Arabic, right to left', async ({ browser }) => {
    test.setTimeout(120_000);
    const runId = await seedDoneRun(svc, venueTime(night, '14:00'), venueTime(night, '17:00'));
    const manager = await signedInClient(SEED_STAFF.manager);
    const pub = await appRpc<{ tournament_id: string }>(manager, 'tournament_publish', {
      p_run_id: runId,
      p_settings: {
        format: 'americano',
        category: 'open',
        points_target: 24,
        min_entries: 4,
        waitlist_max: 8,
        registration_closes_at: venueTime(night, '12:00').toISOString(),
        prize_en: null,
        prize_ar: null,
      },
      p_idempotency_key: `tournament.publish:${crypto.randomUUID()}`,
    });
    const page = await signIn(browser, SEED_STAFF.court_desk, 'ar');
    await page.goto(`${OPERATOR_URL}/desk/tournaments/${pub.tournament_id}`);
    await expect(page.getByTestId('tournament-detail')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('tab', { name: new RegExp(ar.ws.tournaments.detail.tabs.entries) }),
    ).toBeVisible();
    await expect(page.getByText(ar.tournaments.common.status.open).first()).toBeVisible();
    await page.context().close();
  });
});
