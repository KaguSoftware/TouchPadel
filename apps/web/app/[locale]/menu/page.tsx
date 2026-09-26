import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { makeT } from '@touch/i18n';
import { cafePalette } from '@touch/ui/tokens/palette';
import { requireLocale } from '@/lib/locales';
import {
  getCachedBranches,
  getCachedCafeSettings,
  getCachedMenu,
  getTableBranch,
} from '@/lib/menu.server';
import { pickBranch } from '@/lib/menu';
import { CafeApp } from '@/components/cafe/CafeApp';
import { BranchChooser } from '@/components/cafe/BranchChooser/BranchChooser';
import { CafeStyles } from '@/components/cafe/CafeStyles';
import { TABLE_COOKIE } from '@/lib/security/headers';

/**
 * The café menu, `/{locale}/menu` (2026-09-23). It used to be the site root;
 * the Touch Padel landing page took `/{locale}` and the menu moved here.
 *
 * ONE PAGE, TWO GUESTS. proxy.ts turns the printed `/t/{token}` into a 307 to
 * this route carrying an HttpOnly `tp-table` cookie, so the address bar reads
 * `/{locale}/menu` for the rest of the session and the token is never handed
 * to a third party in a `Referer`, captured as `$current_url`, or left in
 * browser history. A guest who arrives with no cookie (a walk-in from the
 * landing page, a bookmark, a cookie that aged out) gets the same menu with no
 * table bound: browse and basket work, "send" and "call waiter" ask for the
 * table QR (owner decision 7/9), and a scan binds them.
 *
 * Because either guest can be behind any response, every response here is
 * treated as a session: `no-store, private` + `Referrer-Policy: no-referrer`
 * (next.config.ts headers AND the proxy override). The page stays indexable:
 * the menu is public content and the token never enters this URL.
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
 *             sent in `Referer` to PostHog or the image CDN, no longer captured
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
 *
 * The residual is wider since the move: the cookie is `path: '/'` with a 12 h
 * life and nothing clears it, and this URL is now also the walk-in menu, so a
 * guest who scanned within 12 h and opens the menu from the landing page gets
 * their table bound (or the "scan again" chip) and the token in this payload.
 *
 * ── WHICH BRANCH (multi-venue slice 4) ───────────────────────────────────────
 * The menu, the café settings (hero, featured, ticker) and the degraded check
 * are per branch, each cached per branch (menu.server.ts):
 *   one open branch      that branch, for everyone: the page is what it was.
 *   walk-in, several     `?b=<slug>` names one; without it (or with a slug that
 *                        is not an open branch) the guest picks one first.
 *   table, several       the table decides: `app.table_branch(token)` (0225,
 *                        anon, uncached so the token never keys a cache entry)
 *                        names it for the first paint. A token it cannot place
 *                        (rotated, forged, branch closed) falls back to `?b=` or
 *                        the default branch, and the client still follows the
 *                        branch `open_table_session` returns once bound.
 *   no branch list       (a failed read) the old unfiltered read.
 */
export function generateViewport(): Viewport {
  // The café's own blue for the browser chrome; the layout's default is the
  // site's night navy.
  return { themeColor: cafePalette['--tp-accent'] };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const tr = makeT(locale);
  const title = tr('site.seo.menuTitle');
  const description = tr('seo.menuDescription');
  const cafeName = tr('common.cafeName');
  const ogImage = '/brand/cafe/og-touch-cafe-1200x630.png';
  return {
    // Absolute: the layout's `%s · Touch Padel` template would read
    // "Menu · Touch Cafe · Touch Padel".
    title: { absolute: title },
    description,
    icons: {
      icon: [
        { url: '/brand/cafe/favicon.svg', type: 'image/svg+xml' },
        { url: '/brand/cafe/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/brand/cafe/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: '/brand/cafe/apple-icon-180.png',
    },
    appleWebApp: { capable: true, title: cafeName, statusBarStyle: 'default' },
    // Its own canonical: inheriting none would leave search engines without a
    // canonical, and the pre-move layout's `/{locale}` would have named the
    // landing page as this page's original.
    alternates: {
      canonical: `/${locale}/menu`,
      languages: { en: '/en/menu', ar: '/ar/menu', 'x-default': '/ar/menu' },
    },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/${locale}/menu`,
      locale: locale === 'ar' ? 'ar_IQ' : 'en_US',
      alternateLocale: locale === 'ar' ? 'en_US' : 'ar_IQ',
      siteName: cafeName,
      images: [{ url: ogImage, width: 1200, height: 630, alt: cafeName }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  };
}

export default async function CafeMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /**
   * FIRST STATEMENT, BEFORE ANY await ON DATA (2026-09-21, carried over from
   * the old `/t` page): an unknown first segment 404s before it pays for a
   * cookie read and three read-model reads, and before any of those throwing
   * could render the error boundary instead of the 404.
   */
  const locale = requireLocale((await params).locale);
  const token = (await cookies()).get(TABLE_COOKIE)?.value ?? null;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const requested = (await searchParams).b;
  const slug = typeof requested === 'string' ? requested : null;

  const branches = await getCachedBranches();
  // A table guest's branch is the table's (app.table_branch, 0225): asked only
  // while several branches are open, so today's one-branch page pays nothing.
  const tableBranchId = token && branches.length > 1 ? await getTableBranch(token) : null;
  const tableBranch = branches.find((b) => b.id === tableBranchId) ?? null;
  // Multi-venue audit: a branch the guest names (?b=) wins over a table cookie
  // left from an earlier visit (it lives 12 h). The table then only browses:
  // it can order at its own branch, never another's, so a guest looking at B
  // is not handed A's table to order into.
  const asked = slug ? (branches.find((b) => b.slug === slug) ?? null) : null;
  const branch = asked ?? tableBranch ?? pickBranch(branches, null);
  const orderToken = asked && tableBranch && asked.id !== tableBranch.id ? null : token;

  // The branch list could not be read: say so, rather than render every
  // branch's menu at once (the unfiltered read mixes and repeats them).
  if (branches.length === 0) {
    return (
      <>
        <CafeStyles nonce={nonce} />
        <CafeApp
          locale={locale}
          token={null}
          initialMenu={[]}
          menuStatus="error"
          settings={await getCachedCafeSettings(null)}
          venue={null}
          venueId={null}
          branches={branches}
        />
      </>
    );
  }

  if (!branch && branches.length > 1) {
    return (
      <div className="tp-cafe" data-theme="cafe">
        <CafeStyles nonce={nonce} />
        <BranchChooser locale={locale} branches={branches} />
      </div>
    );
  }

  const venueId = branch?.id ?? null;
  const [menuResult, settings] = await Promise.all([
    getCachedMenu(venueId),
    getCachedCafeSettings(venueId),
  ]);

  return (
    <>
      {/* The café sheet lives with the café's pages, not in the root layout. */}
      <CafeStyles nonce={nonce} />
      <CafeApp
        locale={locale}
        token={orderToken}
        initialMenu={menuResult.categories}
        menuStatus={menuResult.status}
        settings={settings}
        // Footer hours + phone and the hero strapline (web-slice §2): the
        // rendered branch's, or the default one's.
        venue={branch ?? branches[0] ?? null}
        venueId={venueId}
        branches={branches}
      />
    </>
  );
}
