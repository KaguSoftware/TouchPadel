/**
 * The role-spec pages on the operator (docs/design/protocols/build-contracts-2026-09-23.md
 * §5.4, plan #61–#74). The six new roles have no seeded login in CI (their dev
 * logins are a separate fixture), so the run makes its own barista, chef
 * assistant, head chef and marketing, and removes them afterwards:
 *
 *  (a) the barista posts a suggestion from the phone; the manager reads it on
 *      /suggestions, signed with name and role, and marks it seen, and the
 *      barista's own list says seen (#63);
 *  (b) the chef assistant sends a new-item idea; the head chef's kitchen board
 *      offers "My tasks (N)" counting it, and /tasks lists it under Ideas from
 *      your team with the way back to the board (#65, §5.1);
 *  (c) @ar — the head chef declines an idea in Arabic, a reason required, and
 *      the author's list shows it declined with that reason;
 *  (d) marketing works its step of a manager's tournament from /tasks: the
 *      step form on the desktop, sent and then waiting for a manager (Q2, §5.4).
 *
 * The EN and AR projects run apart (`@ar` is the AR project's grep), so each
 * test sends what it needs itself.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import { DEV_PASSWORD, SEED_STAFF, appRpc, serviceClient, signedInClient } from './helpers';

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

type Role = 'barista' | 'chef' | 'head_chef' | 'marketing';

test.describe('operator role pages', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  const stamp = Date.now() % 1_000_000;
  const staff: Partial<Record<Role, { id: string; email: string; name: string }>> = {};
  const suggestionIds: string[] = [];
  const ideaIds: string[] = [];
  const runIds: string[] = [];

  /** A chef assistant's idea for a dessert, as the phone sends it; returns its id. */
  async function sendIdea(name: string, key: string): Promise<string> {
    const chef = await signedInClient(staff.chef!.email);
    try {
      const res = await appRpc<{ id: string }>(chef, 'submit_release_idea', {
        p_record: { name_ar: name, item_kind: 'dessert', lines: [{ label: 'تمر', qty: 200, unit: 'g' }], sizes: [{ name_ar: 'قطعة' }] },
        p_idempotency_key: key,
      });
      ideaIds.push(res.id);
      return res.id;
    } finally {
      await chef.auth.signOut();
    }
  }

  test.beforeAll(async () => {
    svc = serviceClient();
    for (const role of ['barista', 'chef', 'head_chef', 'marketing'] as const) {
      const email = `e2e-roles-${role}-${stamp}@test.touch.local`;
      const name = `E2E ${role} ${stamp}`;
      const { data, error } = await svc.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${role} failed: ${error?.message}`);
      const ins = await svc.from('staff').insert({ id: data.user.id, display_name: name, role, is_active: true });
      if (ins.error) throw new Error(`staff insert ${role} failed: ${ins.error.message}`);
      staff[role] = { id: data.user.id, email, name };
    }
  });

  test.afterAll(async () => {
    const ids = Object.values(staff).map((s) => s.id);
    if (suggestionIds.length > 0) await svc.from('staff_suggestions').delete().in('id', suggestionIds);
    if (ideaIds.length > 0) await svc.from('release_ideas').delete().in('id', ideaIds);
    // A run's steps, submissions and items go with it (on delete cascade).
    if (runIds.length > 0) await svc.from('protocol_runs').delete().in('id', runIds);
    await svc.from('device_heartbeats').delete().in('staff_id', ids);
    for (const id of ids) {
      await svc.from('staff').delete().eq('id', id);
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
  });

  test('the manager reads a barista’s suggestion, signed, and marks it seen', async ({ browser }) => {
    const body = `E2E: the oat milk runs out by 8pm on Fridays (${stamp}).`;
    const barista = await signedInClient(staff.barista!.email);
    try {
      const res = await appRpc<{ id: string }>(barista, 'add_suggestion', { p_body: body, p_idempotency_key: `e2e:suggestion:${stamp}` });
      suggestionIds.push(res.id);
    } finally {
      await barista.auth.signOut();
    }
    const id = suggestionIds[0]!;

    const page = await signIn(browser, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/suggestions`);
    await expect(page.getByRole('heading', { level: 1, name: 'Suggestions' })).toBeVisible();
    const row = page.getByTestId(`suggestion-${id}`);
    await expect(row).toBeVisible();
    await expect(row.getByText(body)).toBeVisible();
    await expect(row.getByText(staff.barista!.name)).toBeVisible();
    await expect(row.getByText('Barista', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Mark as seen' }).click();
    await expect(page.getByText('Marked as seen.')).toBeVisible();
    // Seen leaves the New tab; the Seen tab carries it with who saw it.
    await expect(row).toHaveCount(0);
    // New, Seen, All: the second segment.
    await page.getByRole('group', { name: 'Show suggestions' }).getByRole('button').nth(1).click();
    // The name is bidi-isolated inside the sentence, so match the two apart.
    const seen = page.getByTestId(`suggestion-${id}`).getByText(/^Seen by /);
    await expect(seen).toBeVisible();
    await expect(seen).toContainText('Dev Manager');
    await page.context().close();

    const again = await signedInClient(staff.barista!.email);
    try {
      const mine = await appRpc<{ suggestions: { id: string; seen: boolean }[] }>(again, 'my_suggestions', {});
      expect(mine.suggestions.find((s) => s.id === id)?.seen).toBe(true);
    } finally {
      await again.auth.signOut();
    }
  });

  test('a chef assistant’s idea reaches the head chef’s kitchen board and My tasks', async ({ browser }) => {
    const ideaId = await sendIdea(`كيكة التمر ${stamp}`, `e2e:idea:${stamp}`);

    const page = await signIn(browser, staff.head_chef!.email);
    await page.goto(`${OPERATOR_URL}/kds`);
    const button = page.getByTestId('kds-tasks');
    await expect(button).toBeVisible({ timeout: 15_000 });
    // Its steps to do plus the team's ideas: at least this one.
    await expect.poll(async () => Number(await button.getAttribute('data-count'))).toBeGreaterThanOrEqual(1);
    await expect(button).toHaveText(/My tasks \(\d+\)/);
    await button.click();

    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole('heading', { level: 1, name: 'My tasks' })).toBeVisible();
    await expect(page.getByTestId('tasks.back-to-board')).toBeVisible();
    await expect(page.getByTestId('tasks.start.product_release')).toBeVisible();
    const idea = page.getByTestId(`idea-${ideaId}`);
    await expect(idea).toBeVisible();
    await expect(idea).toContainText(staff.chef!.name);
    await page.getByTestId('tasks.back-to-board').click();
    await expect(page).toHaveURL(/\/kds/);
    await page.context().close();
  });

  test('@ar the head chef declines the idea with a reason the author reads', async ({ browser }) => {
    const name = `كعكة الهيل ${stamp}`;
    const ideaId = await sendIdea(name, `e2e:idea-ar:${stamp}`);
    const page = await signIn(browser, staff.head_chef!.email, 'ar');
    await page.goto(`${OPERATOR_URL}/tasks`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByTestId(`idea-${ideaId}`).click();
    const sheet = page.getByRole('dialog', { name: new RegExp(name) });
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('idea-decline').click();
    // No reason, no decline.
    const confirm = sheet.getByRole('button', { name: 'ارفض الفكرة' });
    await expect(confirm).toBeDisabled();
    await sheet.locator('textarea').fill('التمر غالٍ هذا الموسم');
    await confirm.click();
    await expect(page.getByTestId(`idea-${ideaId}`)).toHaveCount(0);
    await page.context().close();

    const chef = await signedInClient(staff.chef!.email);
    try {
      const mine = await appRpc<{ ideas: { id: string; status: string; decline_reason: string | null }[] }>(chef, 'my_release_ideas', {});
      const row = mine.ideas.find((i) => i.id === ideaId);
      expect(row?.status).toBe('declined');
      expect(row?.decline_reason).toBe('التمر غالٍ هذا الموسم');
    } finally {
      await chef.auth.signOut();
    }
  });

  test('marketing sends its step of a tournament from My tasks, and it waits for a manager', async ({ browser }) => {
    // A type 2 tournament from the manager: the plan passes at once (the
    // manager decides it), which opens marketing's step and the desk's.
    const day = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const court = await svc.from('courts').select('id').eq('is_active', true).limit(1).single();
    if (court.error) throw new Error(`no active court: ${court.error.message}`);
    const manager = await signedInClient(SEED_STAFF.manager);
    let runId: string;
    try {
      const res = await appRpc<{ run_id: string }>(manager, 'start_protocol', {
        p_kind: 'tournament',
        p_variant: 'type2',
        p_title_en: `E2E community night ${stamp}`,
        p_first_record: {
          class: 'C',
          name_en: `Community night ${stamp}`,
          name_ar: `ليلة المجتمع ${stamp}`,
          ranges: [{ court_ids: [court.data.id], from: `${day}T15:00:00Z`, to: `${day}T19:00:00Z` }],
          capacity: { unit: 'players', count: 16 },
        },
        p_idempotency_key: `e2e:tournament:${stamp}`,
      });
      runId = res.run_id;
      runIds.push(runId);
    } finally {
      await manager.auth.signOut();
    }
    const step = await svc.from('protocol_run_steps').select('id').eq('run_id', runId).eq('step_key', 'marketing').single();
    if (step.error) throw new Error(`no marketing step: ${step.error.message}`);
    const stepId = step.data.id as string;

    const page = await signIn(browser, staff.marketing!.email);
    await page.goto(`${OPERATOR_URL}/tasks`);
    await expect(page.getByRole('heading', { level: 1, name: 'My tasks' })).toBeVisible();
    const todo = page.getByTestId(`tasks.todo.${stepId}`);
    await expect(todo).toBeVisible();
    await expect(todo).toContainText(`E2E community night ${stamp}`);
    await todo.getByRole('button', { name: 'Open' }).click();

    const sheet = page.getByRole('dialog', { name: /Marketing/ });
    await expect(sheet).toBeVisible();
    // The phone's field list, drawn on the desktop: nothing sent without the two highlights.
    await sheet.getByTestId('step.submit').click();
    await expect(sheet.getByText('Some details are missing or not valid. The marked fields say which.')).toBeVisible();
    await sheet.getByTestId('field.highlights_en').fill('Sixteen players, one night, open to everyone.');
    await sheet.getByTestId('field.highlights_ar').fill('ستة عشر لاعبًا في ليلة واحدة، والدعوة للجميع.');
    await sheet.getByTestId('step.submit').click();
    await expect(page.getByText('Sent. It waits for a decision now.')).toBeVisible();
    await expect(page.getByTestId(`tasks.waiting.${stepId}`)).toBeVisible();
    await expect(page.getByTestId(`tasks.todo.${stepId}`)).toHaveCount(0);
    await page.context().close();

    const detail = await svc.from('protocol_submissions').select('record, decision').eq('run_step_id', stepId).single();
    expect(detail.data?.decision).toBeNull();
    expect((detail.data?.record as { highlights_en?: string }).highlights_en).toBe('Sixteen players, one night, open to everyone.');
  });
});
