import { isolateLtr, makeT, VENUE_TZ, type Locale } from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import { otherLocale } from '@/lib/locales';
import { branchAddress, branchMapUrl, displayPhone, telUrl, whatsappUrl } from '@/lib/site/contact';
import { BrandLockup } from './brand/BrandLockup';
import { HoursList, hasPublishedHours } from './HoursList';
import { ChatIcon, ExternalIcon } from './icons';
import { LanguageLink } from './LanguageLink';

/**
 * The site footer, on the brand navy in both modes: the lockup and the tagline; where
 * the club is (the confirmed address and a Google Maps link); the hours (live; one line
 * when the venue keeps one window every day, the week otherwise, nothing when the read
 * failed); the front desk (the venue phone as a call link and a WhatsApp chat, both from
 * venue settings so correcting the setting corrects every page, and omitted when there is
 * no dialable number); the site's links; the language, the year and the vendor credit.
 *
 * The home page leaves the address, hours and desk out: its #visit block, right above the
 * footer, has just said all three. Every other page (the legal pages, the 404) keeps
 * them, since there the footer is the only place they appear.
 */
function Desk({ locale, phone }: { locale: Locale; phone: string | null | undefined }) {
  const tr = makeT(locale);
  const printed = displayPhone(phone);
  const tel = telUrl(phone);
  const chat = whatsappUrl(phone, tr('site.whatsapp.general'));
  if (!printed || !tel || !chat) return null;
  return (
    <div className="tp-site-footer__block">
      <h2 className="tp-site-footer__title">{tr('site.footer.phoneTitle')}</h2>
      <ul className="tp-site-footer__contact">
        <li>
          {/* Printed the way it is dialled and grouped for reading, +995 419 010 203,
              whatever spelling the setting holds ("00…", "07…"): the same helper as
              the legal pages and the café menu. dir="ltr": inside Arabic the + would
              otherwise land at the wrong end. */}
          <a className="tp-site-footer__phone tp-num" href={tel} dir="ltr">
            {printed}
          </a>
        </li>
        <li>
          <a className="tp-site-footer__chat" href={chat}>
            <ChatIcon />
            {tr('site.footer.whatsapp')}
          </a>
        </li>
      </ul>
    </div>
  );
}

export function SiteFooter({
  locale,
  venue,
  path,
}: {
  locale: Locale;
  venue: VenueOpeningHours | null;
  /**
   * The current page without its locale prefix, for the language link and aria-current
   * (null: the 404, which is none of the listed pages).
   */
  path: string | null;
}) {
  const tr = makeT(locale);
  const other = otherLocale(locale);
  const facts = path !== '';
  const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: VENUE_TZ }).format(
    new Date(),
  );
  const link = (to: string, label: string) => (
    <li>
      <a href={`/${locale}${to}`} aria-current={to === path ? 'page' : undefined}>
        {label}
      </a>
    </li>
  );
  return (
    <footer className="tp-site-footer tp-on-dark">
      <div className={`tp-site-footer__inner${facts ? '' : ' tp-site-footer__inner--short'}`}>
        <div className="tp-site-footer__brand">
          <a href={`/${locale}`} aria-label={tr('site.brandHome')} className="tp-site-footer__home">
            <BrandLockup />
          </a>
          <p className="tp-site-footer__tagline">{tr('site.footer.tagline')}</p>
        </div>
        {facts ? (
          <div className="tp-site-footer__facts">
            <div className="tp-site-footer__block">
              <h2 className="tp-site-footer__title">{tr('site.footer.addressTitle')}</h2>
              {/* The default branch's stored address, else the confirmed one (slice 4). */}
              <p className="tp-site-footer__address">{branchAddress(locale, venue)}</p>
              <a className="tp-site-footer__maps" href={branchMapUrl(venue)}>
                {tr('site.visit.maps')}
                <ExternalIcon />
              </a>
            </div>
            {hasPublishedHours(venue) ? (
              <div className="tp-site-footer__block">
                <h2 className="tp-site-footer__title">{tr('site.footer.hoursTitle')}</h2>
                <HoursList locale={locale} venue={venue} className="tp-site-footer__hours" />
              </div>
            ) : null}
            <Desk locale={locale} phone={venue?.phone} />
          </div>
        ) : null}
        <nav className="tp-site-footer__nav" aria-label={tr('site.footer.exploreTitle')}>
          <h2 className="tp-site-footer__title">{tr('site.footer.exploreTitle')}</h2>
          <ul>
            {link('#lessons', tr('site.footer.lessons'))}
            {link('/menu', tr('site.footer.menu'))}
            {link('/support', tr('site.footer.support'))}
          </ul>
        </nav>
        <nav className="tp-site-footer__nav" aria-label={tr('site.footer.legalTitle')}>
          <h2 className="tp-site-footer__title">{tr('site.footer.legalTitle')}</h2>
          <ul>
            {link('/privacy', tr('site.footer.privacy'))}
            {link('/terms', tr('site.footer.terms'))}
            {link('/delete-account', tr('site.footer.deleteAccount'))}
          </ul>
        </nav>
      </div>
      <div className="tp-site-footer__base">
        <p className="tp-num">{tr('site.footer.copyright', { year: isolateLtr(year) })}</p>
        <LanguageLink
          className="tp-site-footer__lang"
          href={`/${other}${path ?? ''}`}
          target={other}
          label={tr('site.nav.languageLabel')}
        >
          {tr('site.nav.language')}
        </LanguageLink>
        <p className="tp-site-footer__credit">{tr('site.footer.developedBy')}</p>
      </div>
    </footer>
  );
}
