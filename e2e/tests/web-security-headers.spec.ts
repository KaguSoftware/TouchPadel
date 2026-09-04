/**
 * Security-header assertions — Security Layer 1, Block 2 · Clients (SEC-25).
 *
 * scripts/security/check-web-security.mjs reads the SOURCE and proves the
 * headers are configured. This proves they are actually SERVED, which is a
 * different claim: a header can be configured correctly and still never reach a
 * browser — a `matcher` that excludes the route, a hosting layer that strips
 * unknown headers, a redirect that answers before the header is applied.
 *
 * The three assertions the box asks for:
 *   1. each header present
 *   2. no inline script without a nonce
 *   3. no table-token substring in any captured analytics payload
 *
 * (3) is the one that would otherwise be argued about rather than measured, so
 * it is measured: the test intercepts every outbound request the page makes and
 * fails if the token appears in any of them.
 */
import { test, expect, type Page } from '@playwright/test';
import { fixtureTableId, mintTableToken } from './helpers';

const REQUIRED_HEADERS: Array<[string, RegExp]> = [
  ['strict-transport-security', /max-age=\d{7,}.*includeSubDomains/i],
  ['x-content-type-options', /^nosniff$/i],
  ['x-frame-options', /^DENY$/i],
  ['referrer-policy', /strict-origin-when-cross-origin|no-referrer/i],
  ['permissions-policy', /geolocation=\(\)/i],
  ['content-security-policy', /frame-ancestors 'none'/i],
];

test.describe('web security headers', () => {
  test('every required header is served on the menu', async ({ page }) => {
    const res = await page.goto('/en');
    expect(res, 'no response').toBeTruthy();
    const headers = res!.headers();

    for (const [name, shape] of REQUIRED_HEADERS) {
      expect(headers[name], `missing header: ${name}`).toBeTruthy();
      expect(headers[name], `header ${name} has an unexpected value`).toMatch(shape);
    }
  });

  test("the CSP uses a nonce and refuses unsafe-inline for scripts", async ({ page }) => {
    const res = await page.goto('/en');
    const csp = res!.headers()['content-security-policy'];

    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc, 'script-src must carry a nonce').toMatch(/'nonce-[A-Za-z0-9+/=_-]{16,}'/);
    expect(scriptSrc, "script-src must not allow 'unsafe-inline'").not.toContain('unsafe-inline');
    expect(scriptSrc, "script-src must not allow 'unsafe-eval' in a production build").not.toContain(
      'unsafe-eval',
    );

    // A nonce that is not applied to the scripts is worse than none: the policy
    // looks strict and the app is broken (or someone "fixes" it with unsafe-inline).
    const unnonced = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script'))
        .filter((s) => !s.getAttribute('nonce') && !s.src)
        .map((s) => (s.textContent ?? '').slice(0, 60)),
    );
    expect(unnonced, 'every inline <script> must carry the nonce').toEqual([]);
  });

  test('the nonce is fresh on every request', async ({ page }) => {
    // A reused nonce is a constant, and a constant an attacker can read from
    // one response and reuse in an injection is not a nonce at all.
    const first = (await page.goto('/en'))!.headers()['content-security-policy'];
    const second = (await page.goto('/ar'))!.headers()['content-security-policy'];
    const n = (c: string) => c.match(/'nonce-([A-Za-z0-9+/=_-]+)'/)![1];
    expect(n(first)).not.toBe(n(second));
  });

  test('/t/{token} exchanges the token for an HttpOnly cookie and leaves the URL', async ({
    page,
    context,
  }) => {
    const token = await mintTableToken(fixtureTableId(1));

    await page.goto(`/t/${token}`);

    // The address bar must no longer carry it.
    expect(page.url(), 'the token must not survive in the URL').not.toContain(token);
    expect(new URL(page.url()).pathname).toMatch(/^\/(en|ar)\/t$/);

    const cookie = (await context.cookies()).find((c) => c.name === 'tp-table');
    expect(cookie, 'tp-table cookie must be set').toBeTruthy();
    expect(cookie!.value).toBe(token);
    expect(cookie!.httpOnly, 'tp-table must be HttpOnly').toBe(true);
    expect(cookie!.sameSite, 'tp-table must be SameSite=Lax').toBe('Lax');

    // HttpOnly is only meaningful if script genuinely cannot read it.
    const visible = await page.evaluate(() => document.cookie);
    expect(visible, 'tp-table must not be readable from document.cookie').not.toContain('tp-table');
  });

  test('the table route is no-referrer and uncacheable', async ({ page }) => {
    const token = await mintTableToken(fixtureTableId(1));
    await page.goto(`/t/${token}`);
    const res = await page.goto(`/en/t`);
    const h = res!.headers();
    expect(h['referrer-policy']).toMatch(/no-referrer/i);
    expect(h['cache-control'], 'a table page must never be cached').toMatch(/no-store/i);
  });

  test('no outbound request carries the table token', async ({ page }) => {
    const token = await mintTableToken(fixtureTableId(1));

    const leaks: string[] = [];
    const inspect = (where: string, value: string | null | undefined) => {
      if (value && value.includes(token)) leaks.push(where);
    };

    page.on('request', (req) => {
      const url = req.url();
      // Requests to our own origin legitimately carry the session — the leak
      // that matters is the token reaching anywhere else, or riding in a
      // Referer header where a third party can read it.
      const sameOrigin = url.startsWith(new URL(page.url() || 'http://localhost:3000').origin);
      if (!sameOrigin) inspect(`url:${url.slice(0, 80)}`, url);
      inspect(`referer→${new URL(url).host}`, req.headers()['referer']);
      if (!sameOrigin) inspect(`body→${new URL(url).host}`, req.postData());
    });

    await page.goto(`/t/${token}`);
    await page.waitForLoadState('networkidle');

    expect(leaks, `the table token left the origin in: ${leaks.join(', ')}`).toEqual([]);
  });
});
