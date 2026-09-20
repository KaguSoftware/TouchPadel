import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import * as pageStaticInfo from 'next/dist/build/analysis/get-page-static-info';
import type { ProxyMatcher } from 'next/dist/build/analysis/get-page-static-info';
import { getMiddlewareRouteMatcher } from 'next/dist/shared/lib/router/utils/middleware-route-matcher';
import { config, proxy } from '../../../proxy';
import { GET } from '../../../app/[locale]/t/[token]/route';
import { buildCsp, TABLE_COOKIE } from './headers';

// Exported at runtime by Next 16.3.4 but missing from its .d.ts, so it is
// typed here by hand. If it disappears, this test fails loudly at import —
// which is preferable to quietly testing a RegExp of our own.
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (matchers: string | string[], nextConfig: object) => ProxyMatcher[];
};

/**
 * The proxy is the only place the CSP is minted, so a path that never reaches
 * it renders with no script policy at all. Two of those existed on production
 * until 2026-09-20 (`/api/t`, `/x.y/t` — security-audit-2026-09-13.md M3),
 * and both were opened by the matcher, not by the function. So this file
 * pins BOTH halves:
 *
 *   1. the matcher, compiled by Next's own compiler rather than read as a
 *      string, against the paths that must and must not reach the proxy;
 *   2. the function, driven with real NextRequests, so a path that does reach
 *      it comes back with the envelope on it.
 *
 * NODE_ENV is "test" here, so the proxy's `isDev` branch is what runs: the
 * cookie is not `Secure` and the policy carries 'unsafe-eval'. Neither is what
 * these tests are about, and the production branch is asserted on buildCsp
 * directly below.
 */

const ORIGIN = 'http://localhost:3000';

function matches(pathname: string): boolean {
  // getMiddlewareMatchers is what `next build` runs over `config.matcher`; the
  // route matcher is what the server runs over the result. Between them there
  // is no interpretation of ours — a test on a hand-written RegExp would only
  // prove the hand-written RegExp.
  const compiled = getMiddlewareMatchers(config.matcher, {});
  const matcher = getMiddlewareRouteMatcher(compiled);
  return matcher(pathname, {} as never, {});
}

function req(pathname: string, init?: { headers?: Record<string, string>; cookie?: string }): NextRequest {
  const headers = new Headers(init?.headers);
  if (init?.cookie) headers.set('cookie', init.cookie);
  return new NextRequest(`${ORIGIN}${pathname}`, { headers });
}

function location(res: Response): string {
  return new URL(res.headers.get('location') ?? '', ORIGIN).pathname;
}

describe('proxy matcher', () => {
  it('reaches every page route, with and without a locale prefix', () => {
    for (const p of ['/', '/en', '/ar', '/ar/', '/en/t', '/ar/t/', '/t/abc123', '/en/t/abc123', '/en/download', '/en/menu', '/ar/privacy']) {
      expect(matches(p), `${p} must be proxied`).toBe(true);
    }
  });

  it('reaches the paths the old matcher let through (M3)', () => {
    // `api` is a prefix, not a route: apps/web has no API routes, and the
    // `[locale]` segment would otherwise take it as a locale. A dot in any
    // segment but the last is not a file either.
    for (const p of ['/api/t', '/apifoo/t', '/api', '/x.y/t', '/x.y/', '/.well-known/t', '/.well-known/apple-app-site-association']) {
      expect(matches(p), `${p} must be proxied`).toBe(true);
    }
  });

  it('skips only Next internals and real files', () => {
    for (const p of [
      '/_next/static/chunks/a.js',
      '/_next/image',
      '/favicon.ico',
      '/manifest.webmanifest',
      '/robots.txt',
      '/.well-known/assetlinks.json',
      '/fonts/lama/LamaSans-Regular.woff2',
      '/brand/cafe/icon-192.png',
    ]) {
      expect(matches(p), `${p} must not be proxied`).toBe(false);
    }
  });
});

describe('proxy()', () => {
  it('stamps a fresh nonce CSP on a locale route and hands the nonce to the renderer', () => {
    const res = proxy(req('/en/t'));
    const csp = res.headers.get('content-security-policy') ?? '';
    const nonce = res.headers.get('x-nonce') ?? '';
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(csp).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    // The request-side copy is what Next reads to nonce its own inline scripts.
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    // Each request gets its own nonce, or the policy is a static allowlist.
    expect(proxy(req('/en/t')).headers.get('x-nonce')).not.toBe(nonce);
  });

  it('never renders a bad first segment: /api/t and /x.y/t are sent to a locale, with the CSP on the hop', () => {
    for (const p of ['/api/t', '/x.y/t', '/apifoo/t']) {
      const res = proxy(req(p));
      expect(res.status, p).toBe(307);
      expect(location(res), p).toBe(`/ar${p}`);
      expect(res.headers.get('content-security-policy'), p).toMatch(/script-src 'nonce-/);
      expect(res.headers.get('set-cookie'), `${p} must not mint a table cookie`).toBeNull();
    }
  });

  it('exchanges /t/{token} for the HttpOnly cookie and a token-less URL', () => {
    const res = proxy(req('/t/abc123'));
    expect(res.status).toBe(307);
    expect(location(res)).toBe('/ar/t');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(new RegExp(`^${TABLE_COOKIE}=abc123;`));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=lax/i);
    // The only request whose URL carries the credential: never stored, never referred.
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/);
  });

  it('keeps the locale a switch produced through the exchange', () => {
    expect(location(proxy(req('/en/t/abc123')))).toBe('/en/t');
  });

  it('negotiates the locale in the documented order: path, cookie, Accept-Language, ar', () => {
    expect(location(proxy(req('/')))).toBe('/ar');
    expect(location(proxy(req('/', { headers: { 'accept-language': 'fr-FR,fr;q=0.9' } })))).toBe('/ar');
    expect(location(proxy(req('/', { headers: { 'accept-language': 'en-GB,en;q=0.9' } })))).toBe('/en');
    expect(location(proxy(req('/', { headers: { 'accept-language': 'en-GB' }, cookie: 'tp-locale=ar' })))).toBe('/ar');
    expect(location(proxy(req('/download', { cookie: 'tp-locale=en' })))).toBe('/en/download');
  });

  it('passes /.well-known/* through untouched, with the headers on', () => {
    const res = proxy(req('/.well-known/apple-app-site-association'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/);
  });
});

describe('the route-level exchange (proxy bypassed)', () => {
  // app/[locale]/t/[token]/route.ts is the second copy of the exchange, for a
  // request the proxy matcher did not see. Driven directly, as Next would.
  const params = (locale: string, token: string) => ({ params: Promise.resolve({ locale, token }) });

  it('sets the HttpOnly cookie and 307s to the token-less route', async () => {
    const res = await GET(req('/en/t/abc123'), params('en', 'abc123'));
    expect(res.status).toBe(307);
    expect(location(res)).toBe('/en/t');
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`^${TABLE_COOKIE}=abc123;.*HttpOnly`));
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('refuses a bad locale with a real 404 and no cookie', async () => {
    const res = await GET(req('/xx/t/abc123'), params('xx', 'abc123'));
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('buildCsp', () => {
  const supabaseUrl = 'https://example.supabase.co';

  it('allows no font CDN and no third-party style origin', () => {
    const csp = buildCsp('n0nce', { isDev: false, supabaseUrl });
    expect(csp).not.toMatch(/googleapis|gstatic/);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("font-src 'self' data:");
  });

  it('is nonce + strict-dynamic for scripts, with unsafe-eval only in dev', () => {
    const prod = buildCsp('n0nce', { isDev: false, supabaseUrl });
    const dev = buildCsp('n0nce', { isDev: true, supabaseUrl });
    const scriptSrc = (csp: string) => (csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '').trim();
    expect(scriptSrc(prod)).toBe("script-src 'nonce-n0nce' 'strict-dynamic' 'self'");
    expect(scriptSrc(dev)).toContain("'unsafe-eval'");
    expect(prod).not.toContain('unsafe-inline\' \'self\'');
    expect(prod).toContain('upgrade-insecure-requests');
    expect(dev).not.toContain('upgrade-insecure-requests');
  });

  it("names the one Supabase project in connect-src and img-src, plus its realtime socket", () => {
    const csp = buildCsp('n0nce', { isDev: false, supabaseUrl });
    expect(csp).toMatch(/connect-src [^;]*https:\/\/example\.supabase\.co wss:\/\/example\.supabase\.co/);
    expect(csp).toMatch(/img-src [^;]*https:\/\/example\.supabase\.co/);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
