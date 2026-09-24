import { makeT, type Locale } from '@touch/i18n';
import { otherLocale } from '@/lib/locales';
import type { SiteMode } from '@/lib/site/mode';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { BrandLockup } from './brand/BrandLockup';
import { WhatsAppButton } from './ContactButton';
import { LanguageLink } from './LanguageLink';
import { HeaderScrollState } from './Reveal';
import { SiteMenuToggle } from './SiteMenuToggle';
import { ThemeToggle } from './ThemeToggle';

const MENU_ID = 'tp-site-menu';

/**
 * The site header: the vector lockup (home), then The club · Lessons · Café menu · Visit,
 * the language, the theme, and the green "Book a court" (WhatsApp, pre-filled, with the
 * chat glyph and a screen-reader cue that it opens WhatsApp; "Plan your visit" when the
 * venue has no usable phone). Sticky; transparent while the home page
 * sits on its photo, solid with a hairline once it scrolls under content. Solid is also
 * the no-JS state. Never glass.
 *
 * Below 64rem the links, language and theme fold into a panel (SiteMenuToggle); the
 * green button stays in the bar at every width.
 *
 * Every cross-page link is a plain `<a>`: `next/link` would prefetch the cookie-reading
 * menu, rendering it for a table guest on every landing view. On the home page the
 * section links are fragments; elsewhere they go home first (`/en#club`).
 */
export function SiteHeader({
  locale,
  mode,
  path,
  phone,
}: {
  locale: Locale;
  mode: SiteMode;
  /** The current page without its locale prefix ('' for home, '/privacy'; null: the 404). */
  path: string | null;
  /** The venue phone the booking button is built from (null: "Plan your visit"). */
  phone: string | null;
}) {
  const tr = makeT(locale);
  const other = otherLocale(locale);
  const onHome = path === '';
  const section = (id: string) => (onHome ? `#${id}` : `/${locale}#${id}`);
  const links = [
    { href: section('club'), label: tr('site.nav.club') },
    { href: section('lessons'), label: tr('site.nav.lessons') },
    { href: `/${locale}/menu`, label: tr('site.nav.menu') },
    { href: section('visit'), label: tr('site.nav.visit') },
  ];
  return (
    <header className="tp-site-header" data-menu="closed">
      <div className="tp-site-header__inner">
        <a className="tp-site-header__brand" href={`/${locale}`} aria-label={tr('site.brandHome')}>
          <BrandLockup />
        </a>
        <SiteMenuToggle controls={MENU_ID} label={tr('site.nav.toggle')} />
        <div className="tp-site-menu" id={MENU_ID}>
          <nav className="tp-site-nav" aria-label={tr('site.nav.label')}>
            <ul className="tp-site-nav__list">
              {links.map((link) => (
                <li key={link.href}>
                  <a className="tp-site-nav__link" href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="tp-site-tools">
            <LanguageLink
              className="tp-site-nav__link tp-site-nav__lang"
              href={`/${other}${path ?? ''}`}
              target={other}
              label={tr('site.nav.languageLabel')}
            >
              {tr('site.nav.language')}
            </LanguageLink>
            <ThemeToggle
              initialMode={mode}
              labels={{ toNight: tr('site.theme.toNight'), toLight: tr('site.theme.toLight') }}
              themeColors={SITE_THEME_COLOR}
            />
          </div>
        </div>
        <WhatsAppButton
          locale={locale}
          phone={phone}
          message={tr('site.whatsapp.court')}
          label={tr('site.nav.book')}
          cue={tr('site.onWhatsApp')}
          onHome={onHome}
          className="tp-site-btn tp-site-btn--go tp-site-btn--sm tp-site-header__book"
        />
      </div>
      <HeaderScrollState />
    </header>
  );
}
