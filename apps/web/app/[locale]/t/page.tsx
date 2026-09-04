import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { makeT } from '@touch/i18n';
import { asLocale } from '@/lib/locales';
import { getCachedCafeSettings, getCachedMenu, getCachedVenue } from '@/lib/menu.server';
import { CafeApp } from '@/components/cafe/CafeApp';
import { TABLE_COOKIE } from '@/lib/security/headers';

/**
 * The table page, AFTER the token has left the URL.
 *
 * proxy.ts turns the printed `/t/{token}` into a 307 to this route carrying an
 * HttpOnly `tp-table` cookie, so the address bar reads `/{locale}/t` for the
 * rest of the session and the token is never handed to a third party in a
 * `Referer`, captured as `$current_url`, or left in browser history.
 *
 * A guest who lands here with no cookie is not an error: it is someone who
 * bookmarked the page, or whose cookie has aged out. They get the menu with no
 * table bound — exactly the walk-in browsing state the site root renders — and
 * a re-scan binds them again.
 *
 * `cookies()` opts this route into dynamic rendering. That is the intended
 * trade: the menu itself still comes from the shared cached read model
 * (getCachedMenu), so this costs a render, not a database round trip.
 *
 * ── KNOWN RESIDUAL, measured not assumed ─────────────────────────────────────
 * The token is read from the HttpOnly cookie here and then passed to <CafeApp>
 * as a prop, which means it is serialised into the RSC payload and IS readable
 * by page script. Verified: it appears exactly once in the rendered HTML.
 *
 * So what the exchange actually bought is precise, and worth stating plainly:
 *   FIXED     the token no longer sits in the address bar, so it is no longer
 *             sent in `Referer` to Google Fonts or PostHog, no longer captured
 *             as `$current_url`, no longer written to browser history, and no
 *             longer visible in a screenshot or a shared link.
 *   NOT FIXED an XSS in this app could still read the token out of the RSC
 *             payload. HttpOnly stops `document.cookie`, not this.
 *
 * Closing that last gap means never sending the token to the client at all:
 * a route handler would read the cookie server-side and call
 * `app.open_table_session` as the guest (their Supabase session is already in
 * cookies via @supabase/ssr), returning only the resulting session. That is a
 * real refactor of the guest ordering boot in `useTableSession.ts`, and it is
 * NOT done here — it could not be validated without the e2e suite, which needs
 * the local Supabase stack. Tracked as the follow-up to this box.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const tr = makeT(locale);
  return {
    title: tr('seo.tableTitle'),
    // A table URL must never be indexed — it is one guest's session.
    robots: { index: false, follow: false },
  };
}

export default async function TableSessionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const token = (await cookies()).get(TABLE_COOKIE)?.value ?? null;

  const [menuResult, settings, venue] = await Promise.all([
    getCachedMenu(),
    getCachedCafeSettings(),
    getCachedVenue(),
  ]);

  return (
    <CafeApp
      locale={asLocale(rawLocale)}
      token={token}
      initialMenu={menuResult.categories}
      menuStatus={menuResult.status}
      settings={settings}
      venue={venue}
    />
  );
}
