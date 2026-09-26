/**
 * The Touch Padel site: the home page at /{locale}, its shell around the legal pages, and
 * the night/light mode (docs/design/web-site/contracts-2026-09-23.md §0 Revision B).
 *
 * What only a real browser can prove: night is the first-visit default and the toggle
 * survives a reload and a trip to a legal page (it is a cookie the SERVER paints from);
 * every header and footer link resolves, fragments included; every WhatsApp button opens
 * a chat with the desk's number and the page's own message, and the call button dials
 * the same number; nothing scrolls sideways at 360 px; with WebGL unavailable the flat
 * court stays, Book a court on its net; the rally can be paused (WCAG 2.2.2); Arabic is right to left in natural case; and an address that matches no page
 * gets the site's own 404, in its language and direction, not Next's bare default.
 *
 * The local stack's venue phone is the seed's 00995419010203 (unverified, like
 * production's), so the booking buttons exist here; the no-phone fallback is covered by
 * the page's unit test. English runs in `chromium-en`, the @ar cases in `chromium-ar`
 * (playwright.config.ts).
 */
import { test, expect, type Locator, type Page } from '@playwright/test';

const SMALL = { width: 360, height: 740 };

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth - el.clientWidth, document.body.scrollWidth - el.clientWidth);
  });
}

async function siteMode(page: Page): Promise<string | null> {
  return page.locator('.tp-site').first().getAttribute('data-mode');
}

/** A wa.me link's number and pre-filled message. */
async function whatsapp(link: Locator): Promise<{ digits: string; text: string | null }> {
  const href = (await link.getAttribute('href')) ?? '';
  const url = new URL(href);
  expect(url.origin, href).toBe('https://wa.me');
  const digits = url.pathname.slice(1);
  expect(digits, href).toMatch(/^[1-9]\d{7,14}$/);
  return { digits, text: url.searchParams.get('text') };
}

test.describe('site home', () => {
  test('presents the club, in night by default, with the privacy policy one click away', async ({
    page,
  }) => {
    const res = await page.goto('/en');
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('Touch Padel · Padel club and café in Karbala');
    expect(await siteMode(page)).toBe('night');
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
      'content',
      '#172C4F',
    );
    // The app is one band, not the story.
    await expect(page.locator('.tp-appband')).toHaveCount(1);
    // Google's OAuth consent screen lists /en as the app's home page: the policy must be linked.
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'Privacy Policy' }),
    ).toHaveAttribute('href', '/en/privacy');
  });

  test('the theme toggle persists across a reload and into a legal page', async ({
    page,
    context,
  }) => {
    await page.goto('/en');
    expect(await siteMode(page)).toBe('night');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    expect(await siteMode(page)).toBe('light');
    const cookie = (await context.cookies()).find((c) => c.name === 'tp-site-mode');
    expect(cookie?.value).toBe('light');
    expect(cookie?.path).toBe('/');
    expect(cookie?.sameSite).toBe('Lax');

    await page.reload();
    expect(await siteMode(page)).toBe('light');
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
      'content',
      '#F3F5F9',
    );

    await page.goto('/en/privacy');
    expect(await siteMode(page)).toBe('light');
    await page.getByRole('button', { name: 'Switch to night mode' }).click();
    expect(await siteMode(page)).toBe('night');
  });

  test('every header and footer link resolves, fragments included', async ({ page, request }) => {
    await page.goto('/en');
    const hrefs = await page
      .locator('.tp-site-header a[href], .tp-site-footer a[href]')
      .evaluateAll((els) => [
        ...new Set(els.map((a) => (a as HTMLAnchorElement).getAttribute('href')!)),
      ]);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/en',
        '#club',
        '#lessons',
        '/en/menu',
        '#visit',
        '/ar',
        '/en#lessons',
        '/en/support',
        '/en/privacy',
        '/en/terms',
        '/en/delete-account',
      ]),
    );
    for (const href of hrefs) {
      if (/^(https?:|tel:)/.test(href)) continue; // wa.me, maps and tel: are checked below
      const [path, fragment] = href.split('#');
      if (path) {
        const res = await request.get(path);
        expect(res.status(), `${href} must resolve`).toBeLessThan(400);
      }
      if (fragment) {
        expect(await page.locator(`#${fragment}`).count(), `#${fragment} exists on /en`).toBe(1);
      }
    }
  });

  test('the events ticket tears, then leaves for WhatsApp with the name written on it', async ({
    page,
  }) => {
    await page.goto('/en');
    const events = page.locator('.tp-events');
    const join = events.getByRole('link', { name: /^Join a tournament\s*, on WhatsApp$/ });
    await expect(join).toHaveAttribute('aria-disabled', 'true');

    const name = events.getByLabel('Your name');
    await name.fill('Sara Ahmed');
    await expect(join).not.toHaveAttribute('aria-disabled', 'true');
    await expect(events.locator('.tp-ticket__main')).toContainText('Sara Ahmed');

    // Hold the hand-off: the test only needs to see where the page goes, and when.
    let left: URL | null = null;
    await page.route('https://wa.me/**', async (route) => {
      left = new URL(route.request().url());
      await route.fulfill({ status: 204 });
    });
    await join.click();
    await expect(events.locator('.tp-ticket[data-torn]')).toHaveCount(1);
    await expect(name).toHaveJSProperty('readOnly', true);
    await expect.poll(() => left?.searchParams.get('text') ?? null).toBe(
      "Hi Touch Padel, this is Sara Ahmed. I'd like to sign up for the next tournament. Can you send me the details?",
    );
  });

  test('every WhatsApp button opens a chat with the desk, pre-filled; Call dials the same number', async ({
    page,
  }) => {
    await page.goto('/en');
    const hero = page.locator('.tp-front');
    const book = await whatsapp(hero.getByRole('link', { name: 'Book on WhatsApp' }));
    expect(book.text).toBe('Hi Touch Padel, I would like to book a court.');
    await expect(hero.getByRole('link', { name: 'Call the desk' })).toHaveAttribute(
      'href',
      `tel:+${book.digits}`,
    );

    // Each name ends in the screen-reader cue that it leaves for WhatsApp (link purpose);
    // the sr-only span reads as its own chunk, hence the optional space.
    const expected: [Locator, string][] = [
      [
        page.getByRole('banner').getByRole('link', { name: /^Book a court\s*, on WhatsApp$/ }),
        'Hi Touch Padel, I would like to book a court.',
      ],
      [
        page
          .locator('.tp-court-stage__overlay')
          .getByRole('link', { name: /^Book a court\s*, on WhatsApp$/ }),
        'Hi Touch Padel, I would like to book a court.',
      ],
      [
        page
          .locator('#lessons')
          .getByRole('link', { name: /^Ask about lessons\s*, on WhatsApp$/ }),
        'Hi Touch Padel, I would like to book a lesson.',
      ],
      [
        // The ticket's link before a name is written (and the whole of it with no JS).
        page.locator('.tp-events').getByRole('link', { name: /^Join a tournament\s*, on WhatsApp$/ }),
        "Hi Touch Padel, I'd like to sign up for the next tournament. Can you send me the details?",
      ],
      [page.locator('#visit').getByRole('link', { name: 'WhatsApp' }), 'Hi Touch Padel,'],
    ];
    for (const [link, text] of expected) {
      const chat = await whatsapp(link);
      expect(chat).toEqual({ digits: book.digits, text });
    }
    await expect(
      page.locator('#visit').getByRole('link', { name: 'Call the desk' }),
    ).toHaveAttribute('href', `tel:+${book.digits}`);
    const maps = await page
      .locator('#visit')
      .getByRole('link', { name: 'Open in Google Maps' })
      .getAttribute('href');
    expect(maps).toMatch(/^https:\/\//);
  });

  test('nothing scrolls sideways at 360 px', async ({ page }) => {
    await page.setViewportSize(SMALL);
    for (const path of ['/en', '/en/privacy', '/en/delete-account']) {
      await page.goto(path);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(1);
    }
  });

  test('on a phone the section links and Book a court fold into the menu sheet', async ({
    page,
  }) => {
    await page.setViewportSize(SMALL);
    await page.goto('/en');
    const banner = page.getByRole('banner');
    // The bar is just the lockup and the toggle.
    await expect(banner.getByRole('link', { name: 'Book a court' })).toBeHidden();
    await expect(banner.getByRole('link', { name: 'Lessons' })).toBeHidden();
    const toggle = banner.getByRole('button', { name: 'Site menu' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Open, the sheet has it, full width, at the thumb's end of the screen.
    await expect(page.locator('#tp-site-menu').getByRole('link', { name: 'Book a court' })).toBeVisible();
    await banner.getByRole('link', { name: 'Lessons' }).click();
    await expect(page).toHaveURL(/\/en#lessons$/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('the rally stops when the pause switch is pressed, and stays stopped on reload', async ({
    page,
  }) => {
    await page.goto('/en');
    const stage = page.locator('.tp-court-stage').first();
    await stage.scrollIntoViewIfNeeded();
    const pause = stage.getByRole('button', { name: 'Pause the rally' });
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    const visual = stage.locator('.tp-court-stage__visual');
    await page.waitForTimeout(1500);
    // Playing: the picture moves (the control for the assertion below).
    const moving = await visual.screenshot();
    await page.waitForTimeout(800);
    expect(Buffer.compare(moving, await visual.screenshot())).not.toBe(0);
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(stage).toHaveAttribute('data-paused', '');
    // Held still: two pictures of the court 800 ms apart are identical.
    const a = await visual.screenshot();
    await page.waitForTimeout(800);
    const b = await visual.screenshot();
    expect(Buffer.compare(a, b)).toBe(0);

    await page.reload();
    await page.locator('.tp-court-stage').first().scrollIntoViewIfNeeded();
    await expect(
      page.locator('.tp-court-stage').first().getByRole('button', { name: 'Pause the rally' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('an address that matches no page gets the site’s 404, in English', async ({ page }) => {
    const res = await page.goto('/en/does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Out of bounds' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Back to Touch Padel' })).toHaveAttribute(
      'href',
      '/en',
    );
    // Deeper paths and paths under real pages land there too.
    for (const path of ['/en/privacy/x', '/en/menu/x']) {
      const deeper = await page.goto(path);
      expect(deeper?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1, name: 'Out of bounds' })).toBeVisible();
    }
  });

  test('with WebGL unavailable the flat court stays, Book a court on its net', async ({ page }) => {
    await page.addInitScript(() => {
      // Every WebGL context request fails, as on a machine without it; 2D still works.
      const proto = HTMLCanvasElement.prototype as unknown as {
        getContext: (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown;
      };
      const original = proto.getContext;
      proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type.startsWith('webgl') || type === 'experimental-webgl') return null;
        return original.call(this, type, ...rest);
      };
    });
    await page.goto('/en');
    const stage = page.locator('.tp-court-stage').first();
    await stage.scrollIntoViewIfNeeded();
    await expect(stage.locator('.tp-court-illustration')).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(stage).toHaveAttribute('data-court', 'flat');
    await expect(stage.locator('canvas')).toHaveCount(0);
    const cta = stage.getByRole('link', { name: 'Book a court' });
    await expect(cta).toBeVisible();
    // The button sits on the drawn net: its centre within a few pixels of the court's.
    const court = await stage.locator('.tp-court-illustration').boundingBox();
    const button = await cta.boundingBox();
    expect(court && button).toBeTruthy();
    expect(Math.abs(court!.y + court!.height / 2 - (button!.y + button!.height / 2))).toBeLessThan(
      court!.height * 0.03,
    );
  });

  test('under reduced motion nothing is held back for a reveal', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/en');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tp-site')).not.toHaveAttribute('data-reveal', 'on');
    await expect(page.getByRole('heading', { name: /Pure game/i })).toBeVisible();
    await context.close();
  });
});

test.describe('site home @ar', () => {
  test('Arabic is right to left, in natural case, and books in Arabic', async ({ page }) => {
    const res = await page.goto('/ar');
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Arabic has no case, and letter-spacing breaks its joined letters.
    const type = await page
      .getByRole('heading', { level: 1 })
      .evaluate((h) => [getComputedStyle(h).textTransform, getComputedStyle(h).letterSpacing]);
    expect(type[0]).toBe('none');
    expect(['normal', '0px']).toContain(type[1]);
    const book = await whatsapp(
      page.locator('.tp-front').getByRole('link', { name: 'احجز عبر واتساب' }),
    );
    expect(book.text).toBe('مرحبًا تتش بادل، أرغب بحجز ملعب.');
    // The printed desk number keeps its digit groups in order inside Arabic text.
    const number = page.locator('#visit .tp-visit__number');
    await expect(number).toHaveAttribute('dir', 'ltr');
    await expect(number).toHaveText('+995 419 010 203');
  });

  test('nothing scrolls sideways at 360 px in Arabic', async ({ page }) => {
    await page.setViewportSize(SMALL);
    for (const path of ['/ar', '/ar/privacy']) {
      await page.goto(path);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(1);
    }
  });

  test('the language switch lands on the same page in English', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/ar/terms');
    // Label in Name (WCAG 2.5.3): its name starts with the word on screen, "English", and
    // "Read this page in English", in Arabic, follows for screen readers.
    const lang = page.getByRole('banner').getByRole('link', { name: /^English/ });
    await expect(lang).toHaveAccessibleName(/اقرأ هذه الصفحة بالإنجليزية/);
    await lang.click();
    await expect(page).toHaveURL(/\/en\/terms$/);
  });

  test('an Arabic address that matches no page gets the 404 in Arabic, right to left', async ({
    page,
  }) => {
    const res = await page.goto('/ar/nope');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'خارج الملعب' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });
});
