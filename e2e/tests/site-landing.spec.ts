/**
 * The Touch Padel site: the home page at /{locale}, its shell around the legal pages, and
 * the night/light mode (docs/design/web-site/contracts-2026-09-23.md §0 Revision B).
 *
 * What only a real browser can prove: the page presents the CLUB (the hero books a court
 * on WhatsApp, the app is one band), night is the first-visit default and the toggle
 * survives a reload and a trip to a legal page (it is a cookie the SERVER paints from);
 * every header and footer link resolves, fragments included; every WhatsApp button opens
 * a chat with the desk's number and the page's own message, and the call button dials
 * the same number; the first-visit questions open from the keyboard; the JSON-LD block
 * carries this response's CSP nonce and the address but no telephone; nothing scrolls
 * sideways at 360 px; with WebGL unavailable the flat court stays, Book a court on
 * its net; the rally can be paused (WCAG 2.2.2); and an address that matches no page
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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Touch is');
    await expect(page.locator('.tp-front__lead')).toContainText('Durrat Karbala');
    expect(await siteMode(page)).toBe('night');
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
      'content',
      '#172C4F',
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /padel club and café in Durrat Karbala/,
    );
    // The app is one band, not the story.
    await expect(page.locator('.tp-appband')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Booking in the app. Soon.' })).toBeVisible();
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
    // The section links land on their sections.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('banner').getByRole('link', { name: 'Visit', exact: true }).click();
    await expect(page).toHaveURL(/\/en#visit$/);
    await expect(page.locator('#visit-title')).toBeInViewport();
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

    const expected: [Locator, string][] = [
      [
        page.getByRole('banner').getByRole('link', { name: 'Book a court' }),
        'Hi Touch Padel, I would like to book a court.',
      ],
      [
        page.locator('.tp-court-stage__overlay').getByRole('link', { name: 'Book a court' }),
        'Hi Touch Padel, I would like to book a court.',
      ],
      [
        page.locator('#lessons').getByRole('link', { name: 'Ask about lessons' }),
        'Hi Touch Padel, I would like to book a lesson.',
      ],
      [
        page.locator('.tp-events').getByRole('link', { name: 'Join the list' }),
        'Hi Touch Padel, please add me to the list for tournaments and events.',
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
    // The map is a link out (no iframe: the CSP has no frame-src).
    await expect(page.locator('#visit iframe')).toHaveCount(0);
    const maps = await page
      .locator('#visit')
      .getByRole('link', { name: 'Open in Google Maps' })
      .getAttribute('href');
    expect(maps).toMatch(/^https:\/\//);
  });

  test('the first-visit questions open and close from the keyboard', async ({ page }) => {
    await page.goto('/en');
    const faq = page.locator('#faq');
    const first = faq.locator('details').first();
    const question = first.locator('summary');
    await expect(question).toHaveText('How do I book a court?');
    await expect(first).not.toHaveAttribute('open', '');
    await expect(first.locator('.tp-faq__a')).toBeHidden();

    await question.focus();
    await expect(question).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('open', '');
    await expect(first.locator('.tp-faq__a')).toBeVisible();
    await expect(first.locator('.tp-faq__a')).toContainText('WhatsApp');

    // Tab reaches the next question; Space opens it too.
    await page.keyboard.press('Tab');
    const second = faq.locator('details').nth(1);
    await expect(second.locator('summary')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(second).toHaveAttribute('open', '');

    await question.focus();
    await page.keyboard.press('Enter');
    await expect(first).not.toHaveAttribute('open', '');
  });

  test('the JSON-LD block carries this response’s CSP nonce, the address, no telephone', async ({
    request,
  }) => {
    const res = await request.get('/en');
    const csp = res.headers()['content-security-policy'] ?? '';
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, 'the page is served with a nonce CSP').toBeTruthy();
    const html = await res.text();
    const tag = html.match(/<script type="application\/ld\+json"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain(`nonce="${nonce}"`);
    const body =
      html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '{}';
    const data = JSON.parse(body);
    expect(data['@type']).toBe('SportsActivityLocation');
    expect(data.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Durrat Karbala',
      addressLocality: 'Karbala',
      addressCountry: 'IQ',
    });
    expect(JSON.stringify(data)).not.toMatch(/telephone|995419/);
  });

  test('nothing scrolls sideways at 360 px', async ({ page }) => {
    await page.setViewportSize(SMALL);
    for (const path of ['/en', '/en/privacy', '/en/delete-account']) {
      await page.goto(path);
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(1);
    }
  });

  test('on a phone the section links fold away but Book a court stays in the bar', async ({
    page,
  }) => {
    await page.setViewportSize(SMALL);
    await page.goto('/en');
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: 'Book a court' })).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Lessons' })).toBeHidden();
    const toggle = banner.getByRole('button', { name: 'Site menu' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await banner.getByRole('link', { name: 'Lessons' }).click();
    await expect(page).toHaveURL(/\/en#lessons$/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(banner.getByRole('link', { name: 'Book a court' })).toBeVisible();
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
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Back to Touch Padel' })).toHaveAttribute(
      'href',
      '/en',
    );
    await expect(page.getByRole('main').getByRole('link', { name: 'Café menu' })).toHaveAttribute(
      'href',
      '/en/menu',
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
  test('Arabic is right to left, natural case, in night by default', async ({ page }) => {
    const res = await page.goto('/ar');
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveTitle('تتش بادل · نادي بادل وكافيه في كربلاء');
    expect(await siteMode(page)).toBe('night');
    const transform = await page
      .getByRole('heading', { level: 1 })
      .evaluate((h) => getComputedStyle(h).textTransform);
    expect(transform).toBe('none');
    await expect(
      page.locator('.tp-court-stage__overlay').getByRole('link', { name: 'احجز ملعبًا' }),
    ).toBeVisible();
    const book = await whatsapp(
      page.locator('.tp-front').getByRole('link', { name: 'احجز عبر واتساب' }),
    );
    expect(book.text).toBe('مرحبًا تتش بادل، أرغب بحجز ملعب.');
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
