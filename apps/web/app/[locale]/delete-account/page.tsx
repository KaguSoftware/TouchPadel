import type { Metadata, Viewport } from 'next';
import { makeT, type Locale } from '@touch/i18n';
import { LOCALES, requireLocale } from '@/lib/locales';
import { getCachedVenue } from '@/lib/menu.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { SiteShell } from '@/components/site/SiteShell';
import { LegalDocument, isPlaceholder, type LegalSection } from '@/components/legal/LegalDocument';
import { DeleteAccountForm } from '@/components/legal/DeleteAccountForm';

/**
 * Account deletion on the web — /{locale}/delete-account.
 *
 * Google Play requires a URL where a user can delete their account, or ask for
 * it, without installing the app (Play Console → Data safety → Data deletion;
 * SEC-17). The page states what is deleted and kept (the wording follows
 * app.delete_my_account, migration 0077), gives the in-app path, carries the
 * sign-in-and-delete form, and offers an emailed request for anyone who cannot
 * sign in (Apple / Google accounts have no password).
 *
 * The explanatory content is server-rendered for the store's crawler; only the
 * form is a client island.
 *
 * Rendered inside the site's SiteShell (header, footer, night or light) since 2026-09-23.
 * Like every page under [locale] it is dynamic (the layout reads the nonce, C11), and it
 * reads the `tp-site-mode` cookie so the server paints the visitor's mode with no flash.
 * The venue read is still the 60 s `menu`-tagged cache; `revalidate` is kept for the day
 * C11 is fixed, when this page will have to choose between ISR and the server-painted mode.
 */
export const revalidate = 60;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/** The browser chrome follows the site mode (the same cookie the shell paints from). */
export async function generateViewport(): Promise<Viewport> {
  return { themeColor: SITE_THEME_COLOR[await getSiteMode()] };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const tr = makeT(locale);
  const title = `${tr('legal.deleteAccount.title')} · ${tr('common.appName')}`;
  const description = tr('legal.deleteAccount.metaDescription');
  return {
    title: { absolute: title },
    description,
    robots: { index: true, follow: true },
    alternates: {
      canonical: `/${locale}/delete-account`,
      languages: { en: '/en/delete-account', ar: '/ar/delete-account', 'x-default': '/ar/delete-account' },
    },
    openGraph: {
      title,
      description,
      type: 'website',
      locale: locale === 'ar' ? 'ar_IQ' : 'en_US',
      siteName: tr('common.appName'),
    },
  };
}

/** A mailto: with the subject filled in, once the privacy email is a real address. */
function RequestByEmail({ locale }: { locale: Locale }) {
  const tr = makeT(locale);
  const email = tr('legal.entity.email');
  if (isPlaceholder(email)) return null;
  const href = `mailto:${email}?subject=${encodeURIComponent(tr('legal.deleteAccount.request.emailSubject'))}`;
  return (
    <p>
      <a className="tp-btn tp-btn--ghost" href={href}>
        {tr('legal.deleteAccount.request.emailButton')}
      </a>
    </p>
  );
}

function sections(locale: Locale): LegalSection[] {
  return [
    { id: 'in-app', title: 'legal.deleteAccount.inApp.title', blocks: [{ kind: 'p', key: 'legal.deleteAccount.inApp.body' }] },
    {
      id: 'what',
      title: 'legal.deleteAccount.what.title',
      blocks: [
        { kind: 'p', key: 'legal.deleteAccount.what.deleted' },
        { kind: 'p', key: 'legal.deleteAccount.what.kept' },
        { kind: 'link', to: 'privacy', hash: 'retention', label: 'legal.deleteAccount.what.more' },
      ],
    },
    {
      id: 'web',
      title: 'legal.deleteAccount.web.title',
      blocks: [{ kind: 'p', key: 'legal.deleteAccount.web.lead' }],
      extra: <DeleteAccountForm locale={locale} />,
    },
    { id: 'social', title: 'legal.deleteAccount.social.title', blocks: [{ kind: 'p', key: 'legal.deleteAccount.social.body' }] },
    {
      id: 'request',
      title: 'legal.deleteAccount.request.title',
      blocks: [{ kind: 'p', key: 'legal.deleteAccount.request.body' }, { kind: 'phone' }],
      extra: <RequestByEmail locale={locale} />,
    },
  ];
}

export default async function DeleteAccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const [venue, mode, nonce] = await Promise.all([
    getCachedVenue(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  return (
    <SiteShell locale={locale} mode={mode} nonce={nonce} venue={venue} path="/delete-account">
      <LegalDocument
        locale={locale}
        page="delete-account"
        title="legal.deleteAccount.title"
        intro="legal.deleteAccount.intro"
        sections={sections(locale)}
        venue={venue}
      />
    </SiteShell>
  );
}
