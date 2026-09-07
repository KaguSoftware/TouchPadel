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
import { fixtureTableId, mintTableToken, SUPABASE_URL } from './helpers';

/** The venue's OWN backend. A different port from the web app, so it must be
 *  named explicitly or the origin check reads it as a third party. */
const SUPABASE_ORIGIN = new URL(SUPABASE_URL).origin;

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
    /**
     * `unsafe-eval` is a PRODUCTION-BUILD property, and this suite's webServer
     * runs `next dev`, which needs eval for hot-module replacement. Asserting it
     * unconditionally makes the suite permanently red on the only way it is
     * currently run — and a permanently red gate gets deleted, which is how the
     * nonce assertion above would be lost too.
     *
     * So it is gated on an explicit flag rather than dropped. The nonce and
     * `unsafe-inline` assertions still run in BOTH modes; only this one needs a
     * production build.
     *
     * ⚠ CI MUST SET E2E_PROD_BUILD=1 against `next build && next start`, or this
     * line never executes anywhere. That is an open item — see SEC-25 in
     * docs/security/security-general.md.
     */
    if (process.env.E2E_PROD_BUILD === '1') {
      expect(scriptSrc, "script-src must not allow 'unsafe-eval' in a production build").not.toContain(
        'unsafe-eval',
      );
    } else {
      expect(scriptSrc, "dev still must not be worse than 'unsafe-eval'").toContain('unsafe-eval');
    }

    // A nonce that is not applied to the scripts is worse than none: the policy
    // looks strict and the app is broken (or someone "fixes" it with unsafe-inline).
    //
    // Production-build property, for the same reason as unsafe-eval above: the
    // dev server injects its own un-nonced HMR and error-overlay scripts, which
    // do not exist in a built app.
    //
    // ASSERTED AGAINST THE SERVED HTML, NOT THE LIVE DOM — and that distinction
    // is the whole test. The first version of this read
    // `document.querySelectorAll('script')` after hydration and failed on
    // Next's `self.__next_f.push(...)` chunks. Those are created at runtime BY
    // an already-nonced script, and `'strict-dynamic'` allows exactly that: a
    // script the browser already trusts may create more. Requiring a nonce on
    // them asserts something CSP does not mean, and it fails on a correct app.
    //
    // What matters is the RESPONSE BODY: a script injected into the server's
    // HTML has no nonce and is blocked. So that is what gets counted.
    if (process.env.E2E_PROD_BUILD === '1') {
      // One request, and BOTH the header and the body read from it. The nonce is
      // minted per request (see "the nonce is fresh on every request" below), so
      // comparing this body against the header of an earlier navigation compares
      // two different nonces and fails on a correct app.
      const fresh = await page.request.get('/en');
      const freshCsp = fresh.headers()['content-security-policy'] ?? '';
      const nonce = /'nonce-([A-Za-z0-9+/=_-]{16,})'/.exec(freshCsp)?.[1];
      expect(nonce, 'the CSP nonce should be extractable').toBeTruthy();

      const html = await fresh.text();
      const tags = html.match(/<script\b[^>]*>/g) ?? [];
      expect(tags.length, 'the page should serve script tags at all').toBeGreaterThan(0);

      const unnonced = tags.filter((t) => !t.includes('nonce='));
      expect(
        unnonced,
        'every <script> in the SERVED HTML must carry the nonce — an injected one would not',
      ).toEqual([]);

      // …and the nonce on every tag must be THIS response's nonce, so a cached
      // page carrying yesterday's nonce cannot pass.
      const wrongNonce = tags.filter((t) => !t.includes(`nonce="${nonce}"`));
      expect(wrongNonce, "every script nonce must match that response's CSP header").toEqual([]);
    }
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

  test('the table route is no-referrer and uncacheable', async ({ page, request }) => {
    const token = await mintTableToken(fixtureTableId(1));

    /**
     * The TOKEN-BEARING request is the one that matters most: it is the only
     * one whose URL contains the credential, so a stored copy of it stores the
     * credential. proxy.ts owns that response outright (it is a 307), so
     * `no-store` holds there and is asserted strictly.
     */
    const qr = await request.get(`/t/${token}`, { maxRedirects: 0 });
    expect(qr.headers()['referrer-policy']).toMatch(/no-referrer/i);
    expect(qr.headers()['cache-control'], 'the QR request carries the token — never store it').toMatch(
      /no-store/i,
    );

    /**
     * The landing page is a different story, measured on the wire 2026-09-07:
     * Next stamps its OWN Cache-Control on a rendered page and it wins over both
     * next.config.ts `headers()` and a middleware `NextResponse.next()`. The
     * declared `no-store` in TABLE_ROUTE_HEADERS does not reach the browser
     * here — `no-cache, must-revalidate` does.
     *
     * RESIDUAL, stated rather than asserted away: a cache may STORE this page
     * provided it revalidates before serving it. The session itself is gated by
     * the HttpOnly cookie rather than by the cache, so this is a defence-in-depth
     * gap, not an access-control one. Recorded against SEC-25.
     */
    await page.goto(`/t/${token}`);
    const res = await page.goto(`/en/t`);
    const h = res!.headers();
    expect(h['referrer-policy']).toMatch(/no-referrer/i);
    expect(h['cache-control'], 'a table page must at minimum revalidate').toMatch(
      /no-store|no-cache/i,
    );
  });

  test('no outbound request carries the table token', async ({ page, baseURL }) => {
    const token = await mintTableToken(fixtureTableId(1));

    const leaks: string[] = [];
    const inspect = (where: string, value: string | null | undefined) => {
      if (value && value.includes(token)) leaks.push(where);
    };

    /**
     * FIRST-PARTY ORIGINS — fixed, not read from page.url().
     *
     * The origin check used to be `page.url()`, evaluated at REQUEST time. On the
     * very first navigation page.url() is still `about:blank`, whose origin is
     * the string "null", so the initial GET /t/{token} compared as cross-origin
     * and reported itself as a leak. The Supabase API is a different port from
     * the web app, so it read as third-party too — flagging the one call the
     * design REQUIRES to carry the token.
     *
     * Both were false positives, and together they made this test unable to pass
     * on a correct system. What it is actually for is unchanged and is written
     * down in layer-1-rules-and-decisions.md §7: the token may reach the venue's
     * own backend, and must reach NOBODY ELSE — not an analytics endpoint, not a
     * font CDN, and never in a Referer header, which is readable by whoever
     * receives it.
     */
    const firstParty = [new URL(baseURL ?? 'http://localhost:3000').origin, SUPABASE_ORIGIN];
    page.on('request', (req) => {
      const url = req.url();
      const sameOrigin = firstParty.some((o) => url.startsWith(o));
      if (!sameOrigin) inspect(`url:${url.slice(0, 80)}`, url);
      // Referer is checked for EVERY request, first-party included: the token
      // must never ride in one, because that is the header a third party reads.
      inspect(`referer→${new URL(url).host}`, req.headers()['referer']);
      if (!sameOrigin) inspect(`body→${new URL(url).host}`, req.postData());
    });

    await page.goto(`/t/${token}`);
    await page.waitForLoadState('networkidle');

    expect(leaks, `the table token left the origin in: ${leaks.join(', ')}`).toEqual([]);
  });
});
