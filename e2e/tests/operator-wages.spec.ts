/**
 * Wages and attendance on the operator (migrations 0270–0272; Parsa
 * 2026-10-01), one journey per locale:
 *
 *  (a) the owner sets a barista's salary on /wages (pay day 31, so this
 *      month's pay day has not passed and the rate starts this month);
 *  (b) the manager sets the rule on /attendance (X = 15 minutes, Y = 5,000
 *      IQD a day) and records a 20-minute late day for the barista today;
 *  (c) the owner sees the 5,000 IQD penalty and the net on /wages, then marks
 *      the month paid, and the row says Paid.
 *
 * The barista has no seeded login, so each run makes its own (the staff
 * trigger gives it the default branch) and removes it afterwards with every
 * wage, payment and day it made. The rule's two settings are put back as they
 * were. The EN and AR projects run apart (`@ar` is the AR project's grep), so
 * each test sends what it needs itself.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import { DEV_PASSWORD, FIXTURE_VENUE_ID, SEED_STAFF, choose, serviceClient, showEveryRow } from './helpers';

// A run against a second operator server on the local stack (the visual-check
// recipe) points here; the default is the config's own server.
const OPERATOR_URL = process.env.E2E_OPERATOR_URL ?? CONFIG_OPERATOR_URL;
const RULE_KEYS = ['attendance_grace_minutes', 'attendance_penalty_iqd'] as const;

/** Names and amounts are isolate()d wherever they are interpolated: read past the marks. */
const bare = (s: string) => s.replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim();

async function signIn(browser: Browser, email: string, locale: 'en' | 'ar'): Promise<Page> {
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

const COPY = {
  en: {
    wages: 'Wages',
    attendance: 'Late and early',
    salary: /Monthly salary/,
    grace: /Minutes allowed/,
    penalty: /Cost of a day over the limit/,
    late: /Minutes late/,
    summary: /A day costs .*5,000.* more than 15/,
    over: /Over the limit: costs/,
    paid: 'Paid',
    net: /595,000/,
    penaltyAmount: /5,000/,
  },
  ar: {
    wages: 'الرواتب',
    attendance: 'التأخير والانصراف المبكر',
    salary: /الراتب الشهري/,
    grace: /الدقائق المسموح بها/,
    penalty: /قيمة خصم اليوم المتجاوز للحد/,
    late: /دقائق التأخير/,
    summary: /يُخصم .* عن كل يوم/,
    over: /تجاوز الحد: يُخصم/,
    paid: 'مصروف',
    // Arabic-Indic or Latin digits, whichever the locale formats with.
    net: /(595,000|٥٩٥٬٠٠٠)/,
    penaltyAmount: /(5,000|٥٬٠٠٠)/,
  },
} as const;

test.describe('operator wages and attendance', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  const stamp = Date.now() % 1_000_000;
  const made: { id: string; name: string }[] = [];
  let ruleBefore: { key: string; value: unknown }[] = [];

  test.beforeAll(async () => {
    svc = serviceClient();
    const { data } = await svc.from('cafe_settings').select('key, value').eq('venue_id', FIXTURE_VENUE_ID).in('key', [...RULE_KEYS]);
    ruleBefore = (data ?? []) as { key: string; value: unknown }[];
  });

  test.afterAll(async () => {
    const ids = made.map((s) => s.id);
    if (ids.length > 0) {
      await svc.from('staff_attendance').delete().in('staff_id', ids);
      await svc.from('wage_payments').delete().in('staff_id', ids);
      await svc.from('staff_wages').delete().in('staff_id', ids);
      await svc.from('device_heartbeats').delete().in('staff_id', ids);
      for (const id of ids) {
        await svc.from('staff_venues').delete().eq('staff_id', id);
        await svc.from('staff').delete().eq('id', id);
        await svc.auth.admin.deleteUser(id).catch(() => undefined);
      }
    }
    // The rule as it was: the rows this run wrote go, the ones it found come back.
    for (const key of RULE_KEYS) {
      const before = ruleBefore.find((r) => r.key === key);
      if (before) await svc.from('cafe_settings').update({ value: before.value }).eq('venue_id', FIXTURE_VENUE_ID).eq('key', key);
      else await svc.from('cafe_settings').delete().eq('venue_id', FIXTURE_VENUE_ID).eq('key', key);
    }
  });

  async function makeBarista(tag: string): Promise<{ id: string; name: string }> {
    const email = `e2e-wages-${tag}-${stamp}@test.touch.local`;
    const name = `E2E wages ${tag} ${stamp}`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const ins = await svc.from('staff').insert({ id: data.user.id, display_name: name, role: 'barista', is_active: true });
    if (ins.error) throw new Error(`staff insert failed: ${ins.error.message}`);
    const person = { id: data.user.id, name };
    made.push(person);
    return person;
  }

  async function journey(browser: Browser, locale: 'en' | 'ar') {
    const copy = COPY[locale];
    const barista = await makeBarista(locale);

    // (a) The owner sets the salary.
    const owner = await signIn(browser, SEED_STAFF.owner, locale);
    await owner.goto(`${OPERATOR_URL}/wages`);
    await expect(owner.getByRole('heading', { level: 1, name: copy.wages })).toBeVisible({ timeout: 30_000 });
    // The month table shows three people until "View more".
    await expect(owner.getByRole('table').first()).toBeVisible({ timeout: 30_000 });
    await showEveryRow(owner);
    await owner.getByTestId(`wages.row.set.${barista.id}`).click();
    const setDialog = owner.getByRole('dialog');
    await setDialog.getByRole('textbox', { name: copy.salary }).fill('600000');
    await choose(setDialog.getByRole('combobox').first(), '31');
    await setDialog.getByTestId('wages.set.confirm').click();
    await expect(setDialog).toHaveCount(0);
    await expect(owner.getByTestId(`wages.row.pay.${barista.id}`)).toBeVisible();

    // (b) The manager sets the rule and records a 20-minute late day today.
    const manager = await signIn(browser, SEED_STAFF.manager, locale);
    await manager.goto(`${OPERATOR_URL}/attendance`);
    await expect(manager.getByRole('heading', { level: 1, name: copy.attendance })).toBeVisible({ timeout: 30_000 });
    const rule = manager.getByTestId('attendance.rule');
    const grace = rule.getByRole('textbox', { name: copy.grace });
    await expect(grace).toBeEnabled();
    await grace.fill('15');
    await rule.getByRole('textbox', { name: copy.penalty }).fill('5000');
    const save = rule.getByTestId('attendance.rule.save');
    if (await save.isVisible()) await save.click();
    await expect(rule.getByTestId('attendance.rule.summary')).toHaveText(copy.summary);
    await expect(save).toHaveCount(0);

    await manager.getByTestId('attendance.record.open').click();
    const form = manager.getByTestId('attendance.record-form');
    await choose(form.getByRole('combobox').first(), barista.id);
    await form.getByRole('textbox', { name: copy.late }).fill('20');
    await expect(form.getByTestId('attendance.record.verdict')).toHaveText(copy.over);
    await form.getByTestId('attendance.record.submit').click();
    await expect(form).toHaveCount(0);
    await showEveryRow(manager);
    const days = manager.getByTestId(`attendance.person.${barista.id}`);
    await expect(days).toBeVisible();
    await expect(days).toContainText(copy.penaltyAmount);
    await manager.context().close();

    // (c) The owner sees the penalty and the net, and marks the month paid.
    await owner.reload();
    await expect(owner.getByRole('table').first()).toBeVisible({ timeout: 30_000 });
    await showEveryRow(owner);
    const row = owner.getByRole('row').filter({ has: owner.getByTestId(`wages.row.set.${barista.id}`) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => bare(await row.innerText())).toMatch(copy.net);
    await expect.poll(async () => bare(await row.innerText())).toMatch(copy.penaltyAmount);
    await owner.getByTestId(`wages.row.pay.${barista.id}`).click();
    const payDialog = owner.getByRole('dialog');
    await expect.poll(async () => bare(await payDialog.getByTestId('wages.pay.breakdown').innerText())).toMatch(copy.net);
    await payDialog.getByTestId('wages.pay.confirm').click();
    await expect(payDialog).toHaveCount(0);
    await expect(row).toContainText(copy.paid);
    await expect(owner.getByTestId(`wages.row.undo.${barista.id}`)).toBeVisible();
    await owner.context().close();
  }

  test('the owner sets a salary, the manager records a late day over the rule, and the owner pays the net', async ({ browser }) => {
    await journey(browser, 'en');
  });

  test('@ar the same journey in Arabic', async ({ browser }) => {
    await journey(browser, 'ar');
  });
});
