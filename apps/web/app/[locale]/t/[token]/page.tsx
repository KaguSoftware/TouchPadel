import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { asLocale } from '@/lib/locales';
import { TABLE_COOKIE, tableCookieOptions } from '@/lib/security/headers';

/**
 * Fallback for `/t/{token}` — defence in depth behind proxy.ts.
 *
 * proxy.ts normally performs the token→cookie exchange before routing, so this
 * route is not reached in practice. It exists because the proxy has a `matcher`
 * and matchers are edited: if a future change excludes this path, the token
 * would silently start living in the address bar again and nothing would fail.
 *
 * So the exchange is implemented twice, and this copy is the one that keeps
 * working when the first is bypassed. It does the same thing — set the cookie,
 * redirect to the token-less route — and never renders the menu with a token in
 * the URL.
 */
export default async function LegacyTableTokenPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = asLocale(rawLocale);

  const store = await cookies();
  store.set(TABLE_COOKIE, token, tableCookieOptions(process.env.NODE_ENV !== 'production'));

  redirect(`/${locale}/t`);
}
