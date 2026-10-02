/**
 * Coaching on the website (docs/design/coaching/guest.md §4.14, §4.17; R58, U7), against the
 * local stack once the coaching migrations (0273-0289) are in it:
 *
 *  1. `/en/coaching` lists a public coach with the lesson type they teach and NO price while the
 *     branch's `lesson_prices_public` switch is off, though `coaching_public` sends it (C-11).
 *  2. The owner switches prices on: the page shows them, formatted (within the 60 s cache).
 *  3. A coach card's "Book in the app" opens the coach's `/en/c/<id>` page: their name, "Open in
 *     the app" on `touchpadel://c/<id>`, never indexed, and no automatic jump to the app.
 *  4. The footer's Coaching link leads from the home page to `/en/coaching`; nothing scrolls
 *     sideways at 360 px.
 *  5. @ar: the same page right to left, the Arabic words, and the Arabic coach link page.
 *
 * Seeds go straight into the coaching tables with the service role (the operator's coach admin
 * has its own journey in operator-coaching.spec.ts): one `e2e-coach@dev.touch.local` guest made a
 * coach at the fixture branch, accepted as public (C-22, R61), teaching one launched private
 * lesson type. Reruns converge on the same rows. afterAll switches coaching and the price switch
 * back off at the fixture branch, so the other suites see the site as before.
 *
 * The page reads a 60-second cache (`coaching.server.ts`), so a change made here is polled
 * for with reloads rather than expected on the next load.
 */
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { en } from '../../packages/i18n/src/catalogs/en';
import { ar } from '../../packages/i18n/src/catalogs/ar';
import { DEV_PASSWORD, FIXTURE_VENUE_ID, serviceClient, signedInClient } from './helpers';

const COACH_EMAIL = 'e2e-coach@dev.touch.local';
const COACH_NAME = { en: 'Playwright Coach', ar: 'مدرّب التجربة' } as const;
const LESSON_TYPE_ID = 'e2e0c0ac-0000-4000-8000-000000000001';
const LESSON_TYPE = { en: 'E2E private lesson', ar: 'حصة خاصة للتجربة' } as const;
const PRICE_IQD = 30000;
const CACHE_WINDOW_MS = 90_000;
const SMALL = { width: 360, height: 740 };

/** "30,000 IQD", the way formatIQD prints it in English (Latin digits, unit after). */
const PRICE_EN = /30,000\s*IQD/;

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth - el.clientWidth, document.body.scrollWidth - el.clientWidth);
  });
}

/** The coaching switches of the fixture branch (0277's `venue_settings` columns). */
async function setCoachingSwitches(
  svc: SupabaseClient,
  patch: { coaching_enabled?: boolean; lesson_prices_public?: boolean },
): Promise<void> {
  const { error } = await svc.from('venue_settings').update(patch).eq('venue_id', FIXTURE_VENUE_ID);
  if (error) throw new Error(`venue_settings coaching switches: ${error.message}`);
}

/**
 * One public coach at the fixture branch teaching one launched private lesson type. Returns the
 * coach's id (`coaches.id`, the one the `/c/` link carries; never the profile id, R43).
 */
async function seedPublicCoach(svc: SupabaseClient): Promise<string> {
  const created = await svc.auth.admin.createUser({
    email: COACH_EMAIL,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Coach Seed', phone: '+9647701000099' },
  });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    throw new Error(`seedPublicCoach user: ${created.error.message}`);
  }
  const client = await signedInClient(COACH_EMAIL);
  const profileId = (await client.auth.getUser()).data.user?.id;
  await client.auth.signOut();
  if (!profileId) throw new Error('seedPublicCoach: no user id');

  const now = new Date().toISOString();
  const { data: coach, error: coachErr } = await svc
    .from('coaches')
    .upsert(
      {
        profile_id: profileId,
        display_name_en: COACH_NAME.en,
        display_name_ar: COACH_NAME.ar,
        bio_en: 'Coaches the Playwright suite.',
        bio_ar: 'يدرّب مجموعة اختبارات التجربة.',
        photo_path: null,
        status: 'active',
        retired_at: null,
        sort_order: 0,
        public_accepted_at: now,
      },
      { onConflict: 'profile_id' },
    )
    .select('id')
    .single();
  if (coachErr || !coach) throw new Error(`seedPublicCoach coach: ${coachErr?.message}`);
  const coachId = (coach as { id: string }).id;

  const steps: [string, PromiseLike<{ error: { message: string } | null }>][] = [
    [
      'coach_branches',
      svc
        .from('coach_branches')
        .upsert(
          { coach_id: coachId, venue_id: FIXTURE_VENUE_ID, active: true },
          { onConflict: 'coach_id,venue_id' },
        ),
    ],
    [
      'lesson_types',
      svc.from('lesson_types').upsert(
        {
          id: LESSON_TYPE_ID,
          venue_id: FIXTURE_VENUE_ID,
          kind: 'private',
          name_en: LESSON_TYPE.en,
          name_ar: LESSON_TYPE.ar,
          description_en: 'One coach, you and up to three friends.',
          description_ar: 'مدرّب واحد وحتى ثلاثة أصدقاء.',
          duration_min: 60,
          price_iqd: PRICE_IQD,
          court_share_iqd: 0,
          max_places: 4,
          min_places: 1,
          cutoff_hours: 0,
          sessions_count: null,
          is_active: true,
          launched_at: now,
          sort_order: 0,
        },
        { onConflict: 'id' },
      ),
    ],
  ];
  for (const [name, step] of steps) {
    const { error } = await step;
    if (error) throw new Error(`seedPublicCoach ${name}: ${error.message}`);
  }
  const { error: linkErr } = await svc
    .from('coach_lesson_types')
    .upsert(
      { coach_id: coachId, lesson_type_id: LESSON_TYPE_ID, venue_id: FIXTURE_VENUE_ID },
      { onConflict: 'coach_id,lesson_type_id' },
    );
  if (linkErr) throw new Error(`seedPublicCoach coach_lesson_types: ${linkErr.message}`);
  // No per-coach price: the card shows the type's own price once the switch is on.
  await svc.from('coach_prices').delete().eq('coach_id', coachId);
  return coachId;
}

/** Reload `path` until `check` passes or the cache window has gone by. */
async function pollPage(page: Page, path: string, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(path);
    await check();
  }).toPass({ timeout: CACHE_WINDOW_MS, intervals: [2_000, 5_000, 10_000] });
}

let svc: SupabaseClient;
let coachId: string;

test.beforeAll(async () => {
  svc = serviceClient();
  coachId = await seedPublicCoach(svc);
  await setCoachingSwitches(svc, { coaching_enabled: true, lesson_prices_public: false });
});

test.afterAll(async () => {
  await setCoachingSwitches(svc, { coaching_enabled: false, lesson_prices_public: false });
});

test.describe('site coaching', () => {
  test('lists the coach and what they teach, with no price while the switch is off', async ({
    page,
  }) => {
    const card = page.locator(`.tp-coach-card[data-coach="${coachId}"]`);
    // Polled until no price shows: a rerun can meet a price-on read still in the 60 s cache.
    await pollPage(page, '/en/coaching', async () => {
      await expect(card).toBeVisible({ timeout: 2_000 });
      await expect(page.locator('.tp-coach-card__price, .tp-coach-type__price')).toHaveCount(0, {
        timeout: 2_000,
      });
    });
    await expect(page).toHaveTitle(`${en.coaching.web.metaTitle} · Touch Padel`);
    await expect(card.getByRole('heading', { name: COACH_NAME.en })).toBeVisible();
    await expect(card.locator('.tp-coach-card__types')).toContainText(LESSON_TYPE.en);
    await expect(
      card.getByRole('link', { name: new RegExp(en.coaching.web.bookInApp) }),
    ).toHaveAttribute('href', `/en/c/${coachId}`);
    // C-11: the answer carries the price; the page does not print it.
    await expect(page.locator('main')).not.toContainText(PRICE_EN);
    await expect(page.locator('.tp-coach-card__price, .tp-coach-type__price')).toHaveCount(0);
    // Indexed, with its hreflang pair.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/en\/coaching$/);
    await expect(page.locator('link[rel="alternate"][hreflang="ar"]')).toHaveAttribute(
      'href',
      /\/ar\/coaching$/,
    );
  });

  test('shows the prices, formatted, once the branch switches them on', async ({ page }) => {
    await setCoachingSwitches(svc, { lesson_prices_public: true });
    try {
      const card = page.locator(`.tp-coach-card[data-coach="${coachId}"]`);
      await pollPage(page, '/en/coaching', async () => {
        await expect(card.locator('.tp-coach-card__price')).toContainText(PRICE_EN, {
          timeout: 2_000,
        });
      });
      await expect(page.locator(`.tp-coach-type`, { hasText: LESSON_TYPE.en })).toContainText(
        PRICE_EN,
      );
    } finally {
      await setCoachingSwitches(svc, { lesson_prices_public: false });
    }
  });

  test('a coach card leads to the coach’s link page, which opens the app only when asked', async ({
    page,
  }) => {
    const card = page.locator(`.tp-coach-card[data-coach="${coachId}"]`);
    await pollPage(page, '/en/coaching', async () => {
      await expect(card).toBeVisible({ timeout: 2_000 });
    });
    await card.getByRole('link', { name: new RegExp(en.coaching.web.bookInApp) }).click();
    await expect(page).toHaveURL(new RegExp(`/en/c/${coachId}$`));
    await expect(page.getByRole('heading', { level: 1, name: COACH_NAME.en })).toBeVisible();
    await expect(page.getByRole('link', { name: en.coaching.web.link.open })).toHaveAttribute(
      'href',
      `touchpadel://c/${coachId}`,
    );
    await expect(page.getByRole('link', { name: en.coaching.web.link.noApp })).toHaveAttribute(
      'href',
      '/en#app',
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    // Still here: no script sent the browser to the app's scheme.
    await page.waitForTimeout(1_000);
    expect(page.url()).toMatch(new RegExp(`/en/c/${coachId}$`));

    // An id that names nobody reads as not taking bookings, and opens the app's home.
    await page.goto('/en/c/3f2b8c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b');
    await expect(
      page.getByRole('heading', { level: 1, name: en.coaching.web.link.notFound }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: en.coaching.web.link.open })).toHaveAttribute(
      'href',
      'touchpadel://',
    );
  });

  test('a bare /c/<id> link gets a locale first', async ({ page }) => {
    const res = await page.goto(`/c/${coachId}`);
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toMatch(new RegExp(`^/(en|ar)/c/${coachId}$`));
  });

  test('the footer’s Coaching link leads there from the home page; nothing scrolls sideways', async ({
    page,
  }) => {
    await page.goto('/en');
    const link = page.getByRole('contentinfo').getByRole('link', { name: en.site.footer.coaching });
    await expect(link).toHaveAttribute('href', '/en/coaching');
    await link.click();
    await expect(page).toHaveURL(/\/en\/coaching$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/coaching/i);

    await page.setViewportSize(SMALL);
    for (const path of ['/en/coaching', `/en/c/${coachId}`]) {
      await page.goto(path);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('site coaching @ar', () => {
  test('Arabic is right to left, with the Arabic words and the coach’s Arabic name', async ({
    page,
  }) => {
    const card = page.locator(`.tp-coach-card[data-coach="${coachId}"]`);
    // Polled until no price shows: the English price test's switch-on read stays in the 60 s
    // cache for up to a minute after that test switches prices back off.
    await pollPage(page, '/ar/coaching', async () => {
      await expect(card).toBeVisible({ timeout: 2_000 });
      await expect(page.locator('main')).not.toContainText(/د\.ع/, { timeout: 2_000 });
    });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.coaching.web.titleOne);
    await expect(card.getByRole('heading', { name: COACH_NAME.ar })).toBeVisible();
    await expect(card.locator('.tp-coach-card__types')).toContainText(LESSON_TYPE.ar);
    // Arabic has no case, and letter-spacing breaks its joined letters.
    const type = await page
      .getByRole('heading', { level: 1 })
      .evaluate((h) => [getComputedStyle(h).textTransform, getComputedStyle(h).letterSpacing]);
    expect(type[0]).toBe('none');
    expect(['normal', '0px']).toContain(type[1]);
    await expect(page.locator('main')).not.toContainText(/د\.ع/);

    await card.getByRole('link', { name: new RegExp(ar.coaching.web.bookInApp) }).click();
    await expect(page).toHaveURL(new RegExp(`/ar/c/${coachId}$`));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: COACH_NAME.ar })).toBeVisible();
    await expect(page.getByRole('link', { name: ar.coaching.web.link.open })).toHaveAttribute(
      'href',
      `touchpadel://c/${coachId}`,
    );
  });

  test('nothing scrolls sideways at 360 px in Arabic', async ({ page }) => {
    await page.setViewportSize(SMALL);
    for (const path of ['/ar/coaching', `/ar/c/${coachId}`]) {
      await page.goto(path);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(1);
    }
  });
});
