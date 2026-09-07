import type { Metadata } from 'next';
import { makeT } from '@touch/i18n';
import { LOCALES, asLocale } from '@/lib/locales';

/**
 * Staff download page for the operator desktop app — /{locale}/download.
 *
 * Not linked from the guest site (guests order from the table QR) and never
 * indexed; staff get the URL from the install runbook. Static: no data, no
 * cookies. Two buttons, nothing else to read: both point at STABLE URLs — the
 * public releases repo's "latest" redirect plus version-less artifact names
 * (apps/operator-shell/electron-builder.config.cjs) — so this page never needs
 * to know which version is current. The Mac link answers 404 until the mac
 * job in operator-release.yml is enabled (Apple credentials), and then serves
 * the Apple-silicon build; Intel Macs are not a target at this venue.
 */
const RELEASES = 'https://github.com/KaguSoftware/touchpadel-releases/releases';
const WIN_STABLE = `${RELEASES}/latest/download/Touch-Padel-Operator-Setup.exe`;
const MAC_STABLE = `${RELEASES}/latest/download/Touch-Padel-Operator-arm64.dmg`;
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
        <p className="tp-download__meta">{tr('download.lead')}</p>

        <div className="tp-download__buttons">
          <a className="tp-btn tp-btn--primary tp-download__btn" href={WIN_STABLE}>
            {tr('download.windowsButton')}
          </a>
          <a className="tp-btn tp-btn--primary tp-download__btn" href={MAC_STABLE}>
            {tr('download.macButton')}
          </a>
        </div>

        {SHOW_SMARTSCREEN_NOTE && <p className="tp-download__note">{tr('download.smartScreenNote')}</p>}
      </main>
    </div>
  );
}
