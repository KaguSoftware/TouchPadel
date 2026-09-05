import type { Metadata } from 'next';
import { makeT } from '@touch/i18n';
import { LOCALES, asLocale } from '@/lib/locales';

/**
 * Staff download page for the operator desktop app — /{locale}/download.
 *
 * Not linked from the guest site (guests order from the table QR) and never
 * indexed; staff get the URL from the install runbook. Static: no data, no
 * cookies. The Windows button points at a STABLE URL — the public releases
 * repo's "latest" redirect plus a version-less artifact name
 * (apps/operator-shell/electron-builder.config.cjs) — so this page never
 * needs to know which version is current.
 */
const RELEASES = 'https://github.com/KaguSoftware/touchpadel-releases/releases';
const WIN_STABLE = `${RELEASES}/latest/download/Touch-Padel-Operator-Setup.exe`;
/** Flip to false once the Windows build is code-signed (SmartScreen stops). */
const SHOW_SMARTSCREEN_NOTE = true;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const tr = makeT(locale);
  return {
    title: tr('download.title'),
    description: tr('download.lead'),
    robots: { index: false, follow: false },
  };
}

export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  const tr = makeT(locale);
  return (
    <div className="tp-cafe" data-theme="cafe">
      <main className="tp-boot tp-download">
        <h1 className="tp-download__title">{tr('download.title')}</h1>
        <p>{tr('download.lead')}</p>
        <p className="tp-download__meta">{tr('download.staffOnly')}</p>

        <section className="tp-download__section" aria-labelledby="dl-windows">
          <h2 id="dl-windows">{tr('download.windowsHeading')}</h2>
          <a className="tp-btn tp-btn--primary" href={WIN_STABLE}>
            {tr('download.windowsButton')}
          </a>
          <p className="tp-download__meta">{tr('download.windowsMeta')}</p>
          {SHOW_SMARTSCREEN_NOTE && <p className="tp-download__note">{tr('download.smartScreenNote')}</p>}
        </section>

        <section className="tp-download__section" aria-labelledby="dl-mac">
          <h2 id="dl-mac">{tr('download.macHeading')}</h2>
          <p className="tp-download__meta">{tr('download.macBody')}</p>
          <a className="tp-btn tp-btn--ghost" href={RELEASES}>
            {tr('download.macButton')}
          </a>
        </section>

        <p className="tp-download__meta">
          <a href={RELEASES}>{tr('download.allVersions')}</a> · {tr('download.versionHint')}
        </p>
      </main>
    </div>
  );
}
