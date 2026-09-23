/**
 * Owner assistant smoke (docs/design/assistant plan §8, adapted to a stack
 * with NO Anthropic key): the drawer, its scope strip and presets, the
 * Ctrl/⌘ K shortcut, the not-configured refusal, the /assistant and
 * /assistant/usage pages, the cashier's refusal, and the Arabic variant.
 *
 * `supabase functions serve` runs here without ANTHROPIC_API_KEY, so a real
 * question answers 503 NOT_CONFIGURED and the thread must show the i18n
 * sentence for it — nothing is asked or billed. The `dry_run` start sizing and
 * the usage/models RPCs need no key, so those are asserted for real.
 *
 * Selectors are roles, labels and the app's own data-testids; the strings
 * are the EN catalog (packages/i18n/src/catalogs/ws/owner.en.ts) unless the
 * test is tagged @ar.
 */
import { test, expect, type Page } from '@playwright/test';
import { OPERATOR_URL } from '../playwright.config';
import { DEV_PASSWORD, SEED_STAFF, serviceClient } from './helpers';

// ---------------------------------------------------------------------------
// Strings (owner.en.ts `assistant`, shell.en.ts `nav`, kit.en.ts `refused`)
// ---------------------------------------------------------------------------
const EN = {
  railButton: /^Assistant\b/, // "Assistant ⌘K" — the Kbd is part of the name
  drawerTitle: 'Assistant',
  contextToggle: /^What this chat may read/,
  scopeCafe: /^Cafe\b/,
  scopeHowto: /^Pages and how-to\b/,
  // The one start line under the boxes once the dry run has answered: a size
  // where the model's vendor has a key, the no-key sentence where it has none.
  startLine: /^(Every question starts at|The starting size cannot be measured)/,
  presetJustHelp: 'Just help',
  presetEverything: 'Everything',
  ask: 'Ask',
  stop: 'Stop',
  thisMessage: 'This message',
  notConfigured: 'No AI key is configured for this venue, so nothing was asked or billed.',
  noChats: 'No chats yet. Ask something to start one.',
  chatsNav: 'Chats',
  usageTitle: 'Assistant usage',
  monthlyCap: 'Monthly cap',
  capLine: /of .* used|No monthly cap is set\./,
  pricingTitle: 'Pricing (USD per million tokens)',
  defaultModelTitle: 'Default model for new chats',
  refusedTitle: 'Not allowed for your role',
  refusedRole: 'Owner',
  toArabic: 'العربية',
} as const;

const AR = {
  railButton: /^المساعد/,
  drawerTitle: 'المساعد',
  contextToggle: /^ما يمكن لهذه المحادثة/,
  scopeCafe: /^المقهى/,
  scopeHowto: /^الصفحات وطريقة الاستخدام/,
  startLine: /^(كل سؤال يبدأ|تعذّر قياس حجم البداية)/,
  ask: 'اسأل',
  stop: 'إيقاف',
  thisMessage: 'هذه الرسالة',
  notConfigured: 'لا مفتاح ذكاء اصطناعي مضبوط لهذا المكان، فلم يُسأل شيء ولم يُحاسَب شيء.',
  toEnglish: 'English',
} as const;

// The scope catalog (packages/core/src/assistant/tools.ts ASSISTANT_SCOPES)
// grows with the product — a scope was added while this spec was first run —
// so the strip is measured, never counted by a constant.
const QUESTION = 'where do I close the day';

// The first dry run compiles the edge function cold; give it the plan's 30 s.
const DRY_RUN_TIMEOUT = 30_000;

async function signIn(page: Page, email: string) {
  await page.goto(`${OPERATOR_URL}/`);
  const emailBox = page.getByLabel('Email');
  await emailBox.waitFor({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
}

/**
 * Assistant, the language switch and the appearance switch live inside the
 * rail's OPTIONS group (RailMoreMenu), which is shut on every load. The group
 * animates on grid-template-rows 0fr -> 1fr with the rows clipped by an
 * overflow:hidden wrapper, so while it is shut each row still lays out at its
 * natural height and Playwright judges it "visible, enabled and stable". The
 * click then lands on whatever is actually painted there — the Options row
 * itself, or the owner strip — and retries "intercepts pointer events" until
 * the test times out. Open the group first; the guard makes it a no-op when it
 * already stands open, so it is safe to call before every row.
 */
async function openRailOptions(page: Page) {
  const more = page.getByTestId('rail.more');
  await more.waitFor({ timeout: 30_000 });
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
}

/** Open the drawer from the rail and expand the (collapsed-in-compact) scope strip. */
async function openDrawerWithScopes(page: Page, s: { railButton: RegExp; drawerTitle: string; contextToggle: RegExp }) {
  await openRailOptions(page);
  await page.getByRole('button', { name: s.railButton }).click();
  const dialog = page.getByRole('dialog', { name: s.drawerTitle });
  await expect(dialog).toBeVisible();
  // The drawer starts with the strip folded behind "Context · n · starts at … tokens".
  const toggle = dialog.getByRole('button', { name: s.contextToggle });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  return dialog;
}

test.describe('owner assistant', () => {
  test('rail button opens the drawer with Cafe + how-to pre-checked and the start size', async ({ page }) => {
    await signIn(page, SEED_STAFF.owner);
    await page.goto(`${OPERATOR_URL}/analytics/cafe`);
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });

    const dialog = await openDrawerWithScopes(page, EN);

    // The page's own scope plus Pages and how-to — and nothing else.
    await expect(dialog.getByRole('checkbox', { name: EN.scopeCafe })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: EN.scopeHowto })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(2);
    expect(await dialog.getByRole('checkbox').count()).toBeGreaterThan(2);

    // The dry run answers one start line; the boxes carry no size of their own.
    await expect(dialog.getByText(EN.startLine)).toBeVisible({ timeout: DRY_RUN_TIMEOUT });
    await expect(dialog.getByRole('checkbox', { name: /tokens/ })).toHaveCount(0);
  });

  test('Ctrl/⌘ K opens and closes the drawer', async ({ page }) => {
    await signIn(page, SEED_STAFF.owner);
    const dialog = page.getByRole('dialog', { name: EN.drawerTitle });
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog).toBeVisible();
    // The rail row reflects the open state.
    await expect(page.getByRole('button', { name: EN.railButton })).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: EN.railButton })).toHaveAttribute('aria-pressed', 'false');
  });

  test('presets: Just help leaves only how-to; Everything checks all', async ({ page }) => {
    await signIn(page, SEED_STAFF.owner);
    await page.goto(`${OPERATOR_URL}/analytics/cafe`);
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
    const dialog = await openDrawerWithScopes(page, EN);
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(2);

    await dialog.getByRole('button', { name: EN.presetJustHelp, exact: true }).click();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(1);
    await expect(dialog.getByRole('checkbox', { name: EN.scopeHowto })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: EN.scopeCafe })).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: EN.presetJustHelp, exact: true })).toHaveAttribute('aria-pressed', 'true');

    await dialog.getByRole('button', { name: EN.presetEverything, exact: true }).click();
    const all = await dialog.getByRole('checkbox').count();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(all);
    await expect(dialog.getByRole('button', { name: EN.presetEverything, exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a question with no key shows the not-configured sentence, no usage footer, no Stop', async ({ page }) => {
    await signIn(page, SEED_STAFF.owner);
    await openRailOptions(page);
    await page.getByRole('button', { name: EN.railButton }).click();
    const dialog = page.getByRole('dialog', { name: EN.drawerTitle });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('textbox', { name: EN.ask }).fill(QUESTION);
    await dialog.getByRole('button', { name: EN.ask, exact: true }).click();

    // The turn stays on screen with its error sentence (Message.tsx role="alert").
    await expect(dialog.getByRole('alert')).toHaveText(EN.notConfigured, { timeout: DRY_RUN_TIMEOUT });
    await expect(dialog.getByText(QUESTION, { exact: true })).toBeVisible();

    // Nothing was billed: the assistant turn carries no per-message meter,
    // and the composer is back to Ask (Stop only shows while streaming).
    await expect(dialog.getByText(EN.thisMessage)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: EN.stop })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: EN.ask, exact: true })).toBeVisible();
  });

  // routes/assistant.tsx wraps both pages in the TEMPORARY UnderConstruction
  // (inert + aria-hidden), so nothing on them is reachable by role. Un-fixme
  // this when that wrapper goes.
  test.fixme('/assistant lists no chats for a fresh owner; /assistant/usage shows cap, pricing and default model', async ({ page }) => {
    // Other suites and manual runs may have left chats behind — only assert the
    // empty sentence when the owner really has none.
    const svc = serviceClient();
    const { count, error } = await svc
      .from('assistant_conversations')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null);
    if (error) throw new Error(`assistant_conversations probe failed: ${error.message}`);

    await signIn(page, SEED_STAFF.owner);
    await page.goto(`${OPERATOR_URL}/assistant`);
    await expect(page.getByRole('heading', { name: EN.drawerTitle }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: EN.chatsNav })).toBeVisible();
    if ((count ?? 0) === 0) {
      await expect(page.getByText(EN.noChats, { exact: true })).toBeVisible();
    }
    // The full page renders the same thread: composer + model switch.
    await expect(page.getByRole('textbox', { name: EN.ask })).toBeVisible();

    await page.goto(`${OPERATOR_URL}/assistant/usage`);
    await expect(page.getByRole('heading', { name: EN.usageTitle }).first()).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('heading', { name: EN.monthlyCap })).toBeVisible();
    await expect(page.getByText(EN.capLine)).toBeVisible();

    await expect(page.getByRole('heading', { name: EN.defaultModelTitle })).toBeVisible();
    await expect(page.getByTestId('model-claude-opus-5')).toBeVisible();
    await expect(page.getByTestId('model-claude-sonnet-5')).toBeVisible();
    // Exactly one of the two is the venue default.
    await expect(page.locator('[data-testid^="model-"][aria-pressed="true"]')).toHaveCount(1);

    await expect(page.getByRole('heading', { name: EN.pricingTitle })).toBeVisible();
    const pricing = page.getByRole('table', { name: EN.pricingTitle });
    await expect(pricing.getByText('claude-opus-5', { exact: true })).toBeVisible();
    await expect(pricing.getByText('claude-sonnet-5', { exact: true })).toBeVisible();
  });

  test('cashier: no rail button, no shortcut, /assistant is refused', async ({ page }) => {
    await signIn(page, SEED_STAFF.cashier);
    // The till is the cashier's home. Its heading is "Floor" with a business
    // day open and "Till" without one, and this suite opens no day — so the
    // landing is asserted by URL, not by what the till draws.
    await expect(page).toHaveURL(/\/till\b/, { timeout: 30_000 });

    await expect(page.getByRole('button', { name: EN.railButton })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: EN.drawerTitle })).toHaveCount(0);

    await page.goto(`${OPERATOR_URL}/assistant`);
    const notice = page.getByRole('alert').filter({ has: page.getByRole('note') });
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText(EN.refusedTitle);
    await expect(notice).toContainText(EN.refusedRole);
    await expect(page.getByRole('textbox', { name: EN.ask })).toHaveCount(0);
  });
});

test.describe('owner assistant @ar', () => {
  /** Sign in (the form is EN until the station's locale is switched) and flip the rail to Arabic. */
  async function signInArabic(page: Page) {
    await signIn(page, SEED_STAFF.owner);
    await openRailOptions(page);
    await page.getByRole('button', { name: EN.toArabic }).click();
    await expect(page.getByRole('button', { name: AR.toEnglish })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  }

  test('rail button opens the drawer with المقهى + how-to pre-checked and the pack size', async ({ page }) => {
    await signInArabic(page);
    await page.goto(`${OPERATOR_URL}/analytics/cafe`);
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });

    const dialog = await openDrawerWithScopes(page, AR);
    await expect(dialog.getByRole('checkbox', { name: AR.scopeCafe })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: AR.scopeHowto })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(2);
    await expect(dialog.getByText(AR.startLine)).toBeVisible({ timeout: DRY_RUN_TIMEOUT });
  });

  test('a question with no key shows the Arabic not-configured sentence', async ({ page }) => {
    await signInArabic(page);
    await openRailOptions(page);
    await page.getByRole('button', { name: AR.railButton }).click();
    const dialog = page.getByRole('dialog', { name: AR.drawerTitle });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('textbox', { name: AR.ask }).fill(QUESTION);
    await dialog.getByRole('button', { name: AR.ask, exact: true }).click();

    await expect(dialog.getByRole('alert')).toHaveText(AR.notConfigured, { timeout: DRY_RUN_TIMEOUT });
    await expect(dialog.getByText(AR.thisMessage)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: AR.stop })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: AR.ask, exact: true })).toBeVisible();
  });
});
