/**
 * The wave-5 people records on the operator (docs/design/protocols/wave5-addendum-2026-09-25.md
 * §2.5-§2.7, §5.2, §6.3 items 31-33). The head barista, the barista and
 * marketing have no seeded login in CI, so the run makes its own and removes
 * them afterwards, with every record it made:
 *
 *  (a) the head barista proposes two pay deductions for the barista; the
 *      manager declines one with a reason on /deductions, the owner approves
 *      the other, which lands in this month under the barista, and the barista
 *      reads only the approved one, with no proposer's name (§2.5.2);
 *  (b) the court desk reports an incident on /incidents; the manager reviews
 *      it with a note, which the desk reads back (§2.6);
 *  (c) @ar marketing sends a post; the owner asks for changes in Arabic, with
 *      a reason, and marketing reads the decision on that version (§2.7).
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

/** A calendar day on the venue's clock (Baghdad, UTC+3), moved by whole days. */
function venueDay(offset: number): string {
  return new Date(Date.now() + 3 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

type Role = 'head_barista' | 'barista' | 'marketing';

test.describe('operator people records', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  const stamp = Date.now() % 1_000_000;
  const staff: Partial<Record<Role, { id: string; email: string; name: string }>> = {};
  const deductionIds: string[] = [];
  const incidentIds: string[] = [];
  const contentIds: string[] = [];

  test.beforeAll(async () => {
    svc = serviceClient();
    for (const role of ['head_barista', 'barista', 'marketing'] as const) {
      const email = `e2e-people-${role}-${stamp}@test.touch.local`;
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
    if (deductionIds.length > 0) await svc.from('salary_deductions').delete().in('id', deductionIds);
    if (incidentIds.length > 0) await svc.from('incident_reports').delete().in('id', incidentIds);
    // A post's versions go with it (on delete cascade).
    if (contentIds.length > 0) await svc.from('marketing_content').delete().in('id', contentIds);
    await svc.from('device_heartbeats').delete().in('staff_id', ids);
    for (const id of ids) {
      await svc.from('staff').delete().eq('id', id);
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
  });

  test('the manager declines a head’s deduction with a reason, and the owner approves one into the month', async ({ browser }) => {
    const head = await signedInClient(staff.head_barista!.email);
    let declineId = '';
    let approveId = '';
    try {
      // Yesterday, so a business day that has not rolled over yet still takes it.
      const propose = (amount: number, reason: string, key: string) =>
        appRpc<{ id: string }>(head, 'propose_deduction', {
          p_staff_id: staff.barista!.id,
          p_amount_iqd: amount,
          p_date: venueDay(-1),
          p_reason: reason,
          p_idempotency_key: key,
        });
      declineId = (await propose(25_000, `E2E: late three times (${stamp}).`, `e2e:deduction:1:${stamp}`)).id;
      approveId = (await propose(15_000, `E2E: left the bar unattended (${stamp}).`, `e2e:deduction:2:${stamp}`)).id;
      deductionIds.push(declineId, approveId);
    } finally {
      await head.auth.signOut();
    }

    const manager = await signIn(browser, SEED_STAFF.manager);
    await manager.goto(`${OPERATOR_URL}/deductions`);
    await expect(manager.getByRole('heading', { level: 1, name: 'Pay deductions' })).toBeVisible();
    await manager.getByTestId(`deductions.decline.${declineId}`).click();
    const decline = manager.getByRole('dialog', { name: 'Decline this deduction?' });
    // No reason, no decline: the form says so before the server would.
    await decline.getByTestId('deductions.decide.confirm').click();
    await expect(decline.getByText('A reason is required.')).toBeVisible();
    await decline.locator('textarea').fill('Not on shift that day');
    await decline.getByTestId('deductions.decide.confirm').click();
    await expect(manager.getByTestId(`deductions.decline.${declineId}`)).toHaveCount(0);
    await manager.context().close();

    const owner = await signIn(browser, SEED_STAFF.owner);
    await owner.goto(`${OPERATOR_URL}/deductions`);
    await owner.getByTestId(`deductions.approve.${approveId}`).click();
    await owner.getByRole('dialog', { name: 'Approve this deduction?' }).getByTestId('deductions.decide.confirm').click();
    await expect(owner.getByTestId(`deductions.approve.${approveId}`)).toHaveCount(0);
    await owner.getByRole('group', { name: 'Show deductions' }).getByRole('button', { name: 'Month' }).click();
    await owner.getByTestId(`deductions.person.${staff.barista!.id}`).click();
    await expect(owner.getByTestId(`deductions.item.${approveId}`)).toContainText('Approved');
    // The owner may take an approval back; nobody else sees the button.
    await expect(owner.getByTestId(`deductions.cancel.${approveId}`)).toBeVisible();
    await owner.context().close();

    // The barista reads it as the person: the approved one only, and never who proposed it.
    const barista = await signedInClient(staff.barista!.email);
    try {
      const mine = await appRpc<{ deductions: { id: string; status: string }[] }>(barista, 'my_deductions', {});
      const ids = mine.deductions.map((d) => d.id);
      expect(ids).toContain(approveId);
      expect(ids).not.toContain(declineId);
      expect(JSON.stringify(mine)).not.toContain(staff.head_barista!.name);
    } finally {
      await barista.auth.signOut();
    }
  });

  test('the desk reports an incident, and reads the manager’s review note back', async ({ browser }) => {
    const description = `E2E: a guest slipped by the cafe counter (${stamp}).`;
    const desk = await signIn(browser, SEED_STAFF.court_desk);
    await desk.goto(`${OPERATOR_URL}/incidents`);
    const form = desk.getByTestId('incidents.form');
    await expect(form.getByTestId('incidents.form.privacy')).toHaveText('Write only what is needed. Do not add phone numbers.');
    await form.getByRole('group', { name: 'What kind' }).getByRole('button', { name: 'Injury' }).click();
    await form.getByRole('group', { name: 'Where' }).getByRole('button', { name: 'Cafe' }).click();
    await form.getByTestId('incidents.form.description').fill(description);
    await form.getByTestId('incidents.form.submit').click();
    await expect(desk.getByTestId('incidents.mine').getByText(description)).toBeVisible();
    await desk.context().close();

    const row = await svc.from('incident_reports').select('id').eq('description', description).single();
    if (row.error || !row.data) throw new Error(`the report did not land: ${row.error?.message}`);
    const id = (row.data as { id: string }).id;
    incidentIds.push(id);

    const manager = await signIn(browser, SEED_STAFF.manager);
    await manager.goto(`${OPERATOR_URL}/incidents`);
    await manager.getByTestId(`incidents.open.${id}`).click();
    const sheet = manager.getByRole('dialog');
    await expect(sheet.getByText(description)).toBeVisible();
    await sheet.getByTestId('incidents.review.note').fill('Spoke to the guest; the floor was dry.');
    await sheet.getByTestId('incidents.review.confirm').click();
    // Reviewed leaves the To review list.
    await expect(manager.getByTestId(`incidents.open.${id}`)).toHaveCount(0);
    await manager.context().close();

    const deskClient = await signedInClient(SEED_STAFF.court_desk);
    try {
      const mine = await appRpc<{ incidents: { id: string; status: string; review_note: string | null }[] }>(deskClient, 'my_incidents', {});
      const mineRow = mine.incidents.find((i) => i.id === id);
      expect(mineRow?.status).toBe('reviewed');
      expect(mineRow?.review_note).toBe('Spoke to the guest; the floor was dry.');
    } finally {
      await deskClient.auth.signOut();
    }
  });

  test('@ar the owner asks for changes to marketing’s post, with a reason marketing reads', async ({ browser }) => {
    const title = `E2E ليلة البادل ${stamp}`;
    const marketing = await signedInClient(staff.marketing!.email);
    let id = '';
    try {
      const sent = await appRpc<{ id: string }>(marketing, 'submit_content', {
        p_title: title,
        p_channel: 'instagram',
        p_planned_for: venueDay(7),
        p_body: 'ليالي الجمعة للبادل. احجز ملعبك الآن.',
        p_idempotency_key: `e2e:content:${stamp}`,
      });
      id = sent.id;
      contentIds.push(id);
    } finally {
      await marketing.auth.signOut();
    }

    const owner = await signIn(browser, SEED_STAFF.owner, 'ar');
    await owner.goto(`${OPERATOR_URL}/marketing`);
    await expect(owner.locator('html')).toHaveAttribute('dir', 'rtl');
    await owner.getByTestId(`content.item.${id}`).click();
    const sheet = owner.getByRole('dialog', { name: new RegExp(title) });
    await expect(sheet.getByText('ليالي الجمعة للبادل. احجز ملعبك الآن.')).toBeVisible();
    await sheet.getByTestId('content.decide.changes').click();
    await sheet.getByTestId('content.decide.note').fill('اذكر أن الملاعب داخلية');
    await sheet.getByTestId('content.decide.confirm').click();
    // Sent back, it leaves Waiting.
    await expect(owner.getByTestId(`content.item.${id}`)).toHaveCount(0);
    await owner.context().close();

    const again = await signedInClient(staff.marketing!.email);
    try {
      const detail = await appRpc<{ content: { status: string }; versions: { version: number; decision: string | null; decision_note: string | null }[] }>(
        again,
        'content_detail',
        { p_id: id },
      );
      expect(detail.content.status).toBe('changes');
      expect(detail.versions.find((v) => v.version === 1)).toMatchObject({ decision: 'changes', decision_note: 'اذكر أن الملاعب داخلية' });
    } finally {
      await again.auth.signOut();
    }
  });
});
