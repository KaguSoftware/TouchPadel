import { describe, expect, it, vi } from 'vitest';
import type { Locale } from '@touch/i18n';
import TableSessionRedirect, { generateMetadata } from './page';

/**
 * `/{locale}/t` — the table session's URL until 2026-09-23, now a redirect to
 * the café menu at `/{locale}/menu` (which reads the `tp-table` cookie; its
 * two cookie states are pinned in `../menu/page.test.tsx`).
 *
 * proxy.ts takes this path first (`src/lib/security/proxy.test.ts`); this is
 * the page-level fallback for a request the proxy did not see. `redirect()` is
 * mocked to throw the way Next's does, so the test reads where it pointed.
 */
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe.each(['en', 'ar'] as const)('table session redirect (%s)', (locale: Locale) => {
  it('sends the old session URL to the café menu in the same locale', async () => {
    await expect(TableSessionRedirect(params(locale))).rejects.toThrow(`NEXT_REDIRECT /${locale}/menu`);
  });

  it('is never indexed', async () => {
    expect((await generateMetadata(params(locale))).robots).toEqual({ index: false, follow: false });
  });
});

describe('a foreign locale segment', () => {
  it('404s instead of redirecting', async () => {
    await expect(TableSessionRedirect(params('xx'))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
