import 'server-only';
import { cookies, headers } from 'next/headers';
import { parseSiteMode, SITE_MODE_COOKIE, type SiteMode } from './mode';

/**
 * The visitor's site mode, from the `tp-site-mode` cookie (night when absent).
 *
 * Reading a cookie makes the route dynamic. Every page under `[locale]` already is: the
 * root layout reads `headers()` for the CSP nonce (C11), and a nonce CSP cannot be
 * served from a static page anyway. So this costs no cache the site ever had.
 */
export async function getSiteMode(): Promise<SiteMode> {
  return parseSiteMode((await cookies()).get(SITE_MODE_COOKIE)?.value);
}

/**
 * The per-request CSP nonce proxy.ts mints and passes on `x-nonce`. The site's inline
 * `<style>` and the JSON-LD `<script>` carry it; the production e2e check fails on any
 * `<script>` in served HTML without this response's nonce.
 */
export async function getRequestNonce(): Promise<string | undefined> {
  return (await headers()).get('x-nonce') ?? undefined;
}
