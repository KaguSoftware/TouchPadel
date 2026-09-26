/**
 * Protocols on the operator (docs/design/protocols/build-contracts-2026-09-23.md §5.4),
 * driven the way management will drive it, with the seeded manager and owner only:
 *
 *  (a) start — the manager starts a hiring from its card: the open position is
 *      the first step, sent with the start, and waits for the owner (its OK is on);
 *  (b) decide — the owner finds it under Waiting on you and approves it; the
 *      interviews step opens;
 *  (b2) interviews — the manager keeps two candidates beside the step, picks
 *      one and sends it: the record carries their ids, never a name;
 *  (c) @ar — in Arabic, the owner sends a manager's open position back: without a
 *      reason the dialog refuses, with one the manager's step opens again for a
 *      second round; How it works shows the price step's OK as fixed, with no switch.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import { DEV_PASSWORD, SEED_STAFF, appRpc, choose, serviceClient, signedInClient } from './helpers';

// A run against a second operator server on the local stack (the visual-check
// recipe) points here; the default is the config's own server.
const OPERATOR_URL = process.env.E2E_OPERATOR_URL ?? CONFIG_OPERATOR_URL;

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

async function openStep(svc: SupabaseClient, runId: string, stepKey: string) {
  const { data, error } = await svc.from('protocol_run_steps').select('id, status, round').eq('run_id', runId).eq('step_key', stepKey).single();
  if (error) throw new Error(error.message);
  return data as { id: string; status: string; round: number };
}

test.describe('operator protocols', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  const stamp = Date.now() % 1_000_000;
  const TITLE = `E2E weekend barista ${stamp}`;
  let runId = '';

  test.beforeAll(() => {
    svc = serviceClient();
  });

  test('the manager starts a hiring from its card; the open position waits for the owner', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/protocols`);
    await expect(page.getByRole('heading', { level: 1, name: 'Protocols' })).toBeVisible();
    const card = page.getByTestId('protocol-card-hiring');
    await expect(card).toBeVisible();
    // How it works is the owner's alone.
    await expect(page.getByTestId('how-hiring')).toHaveCount(0);

    await card.getByTestId('start-hiring').click();
    const sheet = page.getByTestId('start-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Starting sends this first step for a decision.')).toBeVisible();

    // Nothing filled in: marked, and nothing is started.
    await page.getByTestId('start-send').click();
    await expect(sheet.getByText('Check the marked fields.')).toBeVisible();

    await sheet.getByTestId('title-en').fill(TITLE);
    await choose(sheet.getByRole('combobox', { name: 'Role' }), 'barista');
    const boxes = sheet.locator('textarea');
    await boxes.nth(0).fill('Weekend mornings run short at the bar.');
    await boxes.nth(1).fill('Friday and Saturday, 7:00 to 15:00');
    await sheet.locator('input[type="date"]').fill('2026-12-01');
    await page.getByTestId('start-send').click();

    // The new run opens on its first step, sent and waiting for the owner.
    const run = page.getByTestId('run-sheet');
    await expect(run).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog', { name: new RegExp(TITLE) })).toBeVisible();
    const panel = page.getByTestId('step-panel');
    await expect(panel.getByText('Needs the owner’s OK')).toBeVisible();
    await expect(panel.getByText(/Sent\. The owner decides\./)).toBeVisible();

    const { data } = await svc.from('protocol_runs').select('id, status').eq('title_en', TITLE).single();
    runId = (data as { id: string }).id;
    expect((data as { status: string }).status).toBe('active');
    const first = await openStep(svc, runId, 'open_position');
    expect(first.status).toBe('submitted');
    await page.context().close();
  });

  test('the owner finds it under Waiting on you and approves it; the interviews open', async ({ browser }) => {
    test.skip(runId === '', 'needs the run the first test started');
    const page = await signIn(browser, SEED_STAFF.owner);
    await page.goto(`${OPERATOR_URL}/protocols?filter=waiting`);
    await page.getByRole('row', { name: new RegExp(TITLE) }).click();
    const panel = page.getByTestId('step-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('decide').click();
    const dialog = page.getByRole('dialog', { name: /Decide: Open position/ });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('decision-send').click();
    await expect(page.getByText('Approved.')).toBeVisible();

    await expect.poll(async () => (await openStep(svc, runId, 'open_position')).status).toBe('passed');
    await expect.poll(async () => (await openStep(svc, runId, 'interviews')).status).toBe('open');
    await page.context().close();
  });

  test('the manager keeps the candidates, picks one and sends the interviews by id', async ({ browser }) => {
    test.skip(runId === '', 'needs the run the first test started');
    const page = await signIn(browser, SEED_STAFF.manager);
    const interviews = await openStep(svc, runId, 'interviews');
    await page.goto(`${OPERATOR_URL}/protocols?run=${runId}&step=${interviews.id}`);
    const panel = page.getByTestId('step-panel');
    const list = panel.getByTestId('candidates');
    await expect(list).toBeVisible();
    // Nothing to send until someone is picked.
    await expect(panel.getByTestId('interviews-state')).toHaveText('Add the candidates you interviewed, then pick one.');
    await expect(panel.getByTestId('step-send')).toBeDisabled();

    for (const [name, phone] of [
      ['Ali Hassan', '0770 123 4567'],
      ['Sara Kareem', '0780 765 4321'],
    ] as const) {
      await list.getByLabel('Name').fill(name);
      await list.getByLabel('Phone').fill(phone);
      await list.getByRole('button', { name: 'Add candidate' }).click();
      await expect(list.getByText(name)).toBeVisible();
    }
    await expect(panel.getByTestId('interviews-state')).toHaveText('Pick the candidate you want to hire first.');
    await list.getByRole('button', { name: 'Pick' }).nth(1).click();
    await expect(panel.getByTestId('interviews-state')).toContainText('Sends 2 candidates, with');
    await panel.getByTestId('step-send').click();
    await expect(page.getByText('Sent.', { exact: true })).toBeVisible();

    await expect.poll(async () => (await openStep(svc, runId, 'interviews')).status).toBe('submitted');
    const { data: cands } = await svc.from('hiring_candidates').select('id, candidate_name, picked').eq('run_id', runId);
    const rows = (cands ?? []) as { id: string; candidate_name: string; picked: boolean }[];
    const { data: sub } = await svc
      .from('protocol_submissions')
      .select('record')
      .eq('run_step_id', interviews.id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();
    const record = (sub as { record: { candidate_ids: string[]; picked_id: string } }).record;
    expect([...record.candidate_ids].sort()).toEqual(rows.map((c) => c.id).sort());
    expect(record.picked_id).toBe(rows.find((c) => c.picked)?.id);
    expect(JSON.stringify(record)).not.toContain('Kareem');
    await page.context().close();
  });

  test('@ar the owner sends an open position back with a reason; How it works keeps the price step’s OK', async ({ browser }) => {
    // A second hiring, started by the manager through the RPC the card calls.
    const manager = await signedInClient(SEED_STAFF.manager);
    const arTitle = `E2E باريستا ${stamp}`;
    let arRun: string;
    try {
      const res = await appRpc<{ run_id: string }>(manager, 'start_protocol', {
        p_kind: 'hiring',
        p_title_ar: arTitle,
        p_first_record: { role: 'barista', why: 'صباحات نهاية الأسبوع', hours: 'الجمعة والسبت', start_date: '2026-12-01' },
        p_idempotency_key: `e2e:protocols:${stamp}`,
      });
      arRun = res.run_id;
    } finally {
      await manager.auth.signOut();
    }

    const page = await signIn(browser, SEED_STAFF.owner, 'ar');
    await page.goto(`${OPERATOR_URL}/protocols?run=${arRun}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const panel = page.getByTestId('step-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('decide').click();
    const dialog = page.getByRole('dialog', { name: /القرار/ });
    await dialog.getByRole('button', { name: 'أعده للتعديل' }).click();
    await dialog.getByTestId('decision-send').click();
    await expect(dialog.getByText('السبب مطلوب.')).toBeVisible();
    await dialog.locator('textarea').fill('أضف ساعات العمل بدقة');
    await dialog.getByTestId('decision-send').click();
    await expect(page.getByText('تمت الإعادة.')).toBeVisible();
    await expect.poll(async () => {
      const s = await openStep(svc, arRun, 'open_position');
      return `${s.status}:${s.round}`;
    }).toBe('open:2');

    // How it works: the price step's OK is fixed, so there is no switch for it.
    await page.goto(`${OPERATOR_URL}/protocols`);
    await expect(page.getByRole('heading', { level: 1, name: 'البروتوكولات' })).toBeVisible();
    await page.getByTestId('how-product_release').click();
    const how = page.getByTestId('how-it-works');
    const price = how.locator('[data-testid="how-step"][data-step="analysis"]');
    await expect(price.getByTestId('ok-fixed')).toHaveText('تحتاج موافقتك دائمًا');
    await expect(price.getByRole('switch')).toHaveCount(0);
    await page.context().close();
  });
});
