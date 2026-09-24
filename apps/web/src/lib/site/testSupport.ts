import type { SiteMode } from './mode';

/**
 * TEST DOUBLE for `@/lib/site/mode.server` (the request's mode cookie and CSP nonce),
 * as MUTABLE state, the same pattern as `serverData` in src/test/fixtures.ts: a module
 * mock factory runs once, and `restoreMocks: true` would wipe a `vi.fn()` implementation
 * between cases. A page test mocks the module with plain functions over this object:
 *
 *   vi.mock('@/lib/site/mode.server', async () => {
 *     const { siteRequest } = await import('@/lib/site/testSupport');
 *     return {
 *       getSiteMode: () => Promise.resolve(siteRequest.mode),
 *       getRequestNonce: () => Promise.resolve(siteRequest.nonce),
 *     };
 *   });
 *
 * Never imported by app code.
 */
export const TEST_NONCE = 'test-nonce-0123456789';

export const siteRequest: { mode: SiteMode; nonce: string | undefined } = {
  mode: 'night',
  nonce: TEST_NONCE,
};

export function resetSiteRequest(): void {
  siteRequest.mode = 'night';
  siteRequest.nonce = TEST_NONCE;
}
