import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireLocale } from '@/lib/locales';

/**
 * `/{locale}/t` — the table session's URL until 2026-09-23, now a 307 to the
 * café menu at `/{locale}/menu`, which reads the same `tp-table` cookie.
 *
 * proxy.ts performs this redirect before routing (with the CSP on the hop and
 * no-store + no-referrer on it), so this page is the fallback for a request
 * the proxy did not see, the same defence in depth as `t/[token]/route.ts`.
 * It kept its URL for bookmarks, installed shortcuts and guests whose cookie
 * was set before the move: the cookie is `path: '/'`, so the table still binds
 * on the menu.
 *
 * Temporary, never permanent: a browser that learned `/t` → `/menu` forever
 * could not be taught otherwise if the session moves again (the old
 * `/menu` → `/` 308 is exactly that lesson). `redirect()` in a Server
 * Component is a 307, and there is no `loading.tsx` above this page, so no
 * 200 shell flushes before it (see `t/[token]/route.ts`).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  requireLocale((await params).locale);
  return { robots: { index: false, follow: false } };
}

export default async function TableSessionRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  const locale = requireLocale((await params).locale);
  redirect(`/${locale}/menu`);
}
