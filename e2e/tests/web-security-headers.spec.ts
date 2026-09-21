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

  /**
   * M3 (security-audit-2026-09-13.md): the matcher used to skip every path
   * beginning `api` and every path containing a dot, and `[locale]` accepted
   * both as a locale — so `/api/t` and `/x.y/t` served the table page with
   * the cookie's token in it and NO CSP. Measured on production. Two layers
   * now close it and both are asserted here, separately, because either one
   * alone can be edited away without the other noticing:
   *
   *   proxy    every non-file path is matched, so the hop itself carries the
   *            policy and a bad first segment is sent to a real locale;
   *   page     requireLocale() refuses the segment, so the landing is a 404
   *            and never the table page — including on paths the proxy still
   *            does not see (a dotted last segment, `_next/`).
   */
  test('paths that used to escape the matcher carry the CSP and never render the table page', async ({
    request,
  }) => {
    for (const path of ['/api/t', '/x.y/t', '/apifoo/t']) {
      // The proxy's own response: the redirect hop, with the policy on it.
      const hop = await request.get(path, { maxRedirects: 0 });
      expect(hop.status(), `${path} must be redirected, not rendered`).toBe(307);
      expect(new URL(hop.headers()['location'] ?? '', hop.url()).pathname, path).toMatch(
        new RegExp(`^/(en|ar)${path.replace(/[.]/g, '\\$&')}$`),
      );
      expect(hop.headers()['content-security-policy'], `${path}: CSP on the hop`).toMatch(/'nonce-/);

      // Where the hop lands: a 404, still under the policy.
      const landing = await request.get(path);
      expect(landing.status(), `${path} must land on a 404`).toBe(404);
      expect(landing.headers()['content-security-policy'], `${path}: CSP on the 404`).toMatch(/'nonce-/);
    }
  });

  test('a bad locale is refused by the page even when the proxy never ran', async ({ request }) => {
    /**
     * `/.well-known/*` is proxied but passed through untouched (Apple fetches
     * the association file at a fixed path), so `.well-known` reaches
     * `[locale]` as a locale. A dotted last segment is skipped by the matcher
     * altogether, so `xx` reaches `[locale]` with no proxy at all. Neither
     * may render anything but a 404.
     *
     * THE MARKER IS A SERIALISED PROP, NOT A CLASS NAME (2026-09-21).
     *
     * This read `.not.toContain('tp-cafe__table')` and was red on the
     * production build from the day it was written, while passing under `next
     * dev` — so it looked like a prod-only rendering bug and was not one.
     * Measured on the built app: `/.well-known/t` is a 404, its body is
     * `app/[locale]/not-found.tsx`, and `app/[locale]/layout.tsx` inlines the
     * whole cafe stylesheet into it — `.tp-cafe__table` among ~7 occurrences of
     * CSS text. The class was in the 404's <style>, not in any element. It
     * never appeared as an element either: the chip is rendered by
     * `TableChip` after hydration, so `class="tp-cafe__table"` is absent even
     * from a real /en/t. `next dev` answers a 404 with a bare shell carrying
     * none of the app's markup, which is the only reason it ever passed.
     *
     * `initialMenu` is the prop `<CafeApp>` is given the menu in, so it appears
     * in the RSC flight payload exactly when the page component actually ran —
     * in dev and in a production build alike, and never on a 404.
     */
    const control = await request.get('/en/t');
    expect(control.status(), 'the control must be the real table page').toBe(200);
    expect(
      await control.text(),
      'the marker must be present where the app DOES render, or the assertions below are vacuous',
    ).toContain('initialMenu');

    for (const path of ['/.well-known/t', '/xx/t/tok.x', '/xx.y']) {
      const res = await request.get(path);
      expect(res.status(), `${path} must be a 404, not Arabic`).toBe(404);
      expect(await res.text(), `${path} must not render the app`).not.toContain('initialMenu');
    }
  });

  test('the exchange still happens when the proxy is bypassed', async ({ request }) => {
    // A dotted last segment is skipped by the matcher, so this request reaches
    // app/[locale]/t/[token]/route.ts with no proxy in front of it. Until
    // 2026-09-20 that copy of the exchange was a page setting a cookie during
    // render, which Next 16 refuses (L1): it rendered the error boundary, no
    // cookie, no redirect, status 200.
    const token = 'e2e.dotted';
    const res = await request.get(`/en/t/${token}`, { maxRedirects: 0 });
    expect(res.status(), 'the fallback must redirect, not render').toBe(307);
    expect(new URL(res.headers()['location'] ?? '', res.url()).pathname).toBe('/en/t');
    expect(res.headers()['set-cookie'], 'the fallback must set the table cookie').toMatch(
      new RegExp(`^tp-table=${token.replace('.', '\\.')};.*HttpOnly`, 'i'),
    );
    expect(res.headers()['cache-control']).toMatch(/no-store/i);
  });

  test('/.well-known/apple-app-site-association is served at its fixed path, headers on', async ({
    request,
  }) => {
    const res = await request.get('/.well-known/apple-app-site-association', { maxRedirects: 0 });
    expect(res.status(), 'a 307 here is a failed iOS link verification').toBe(200);
    expect(res.headers()['content-type']).toMatch(/application\/json/);
    expect(res.headers()['content-security-policy'], 'proxied, not skipped').toMatch(/'nonce-/);
    expect(res.headers()['x-content-type-options']).toMatch(/nosniff/i);
  });

  test('the CSP names no font CDN', async ({ page }) => {
    // Lama Sans is self-hosted from /fonts/lama (@touch/ui fontFace.ts). The
    // Google Fonts origins outlived the move by two weeks in style-src and
    // font-src (S8); an allowed origin nothing uses is a reporting blind spot.
    const res = await page.goto('/en');
    const csp = res!.headers()['content-security-policy'];
    expect(csp).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(csp).toMatch(/font-src 'self'/);
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
