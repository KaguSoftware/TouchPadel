import { makeT, type Locale } from '@touch/i18n';
import { otherLocale } from '@/lib/locales';
import type { SiteMode } from '@/lib/site/mode';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { BrandLockup } from './brand/BrandLockup';
import { WhatsAppButton } from './ContactButton';
import { LanguageLink } from './LanguageLink';
import { ArrowIcon, GlobeIcon } from './icons';
import { HeaderScrollState } from './Reveal';
import { SiteMenuToggle } from './SiteMenuToggle';
import { ThemeToggle } from './ThemeToggle';

const MENU_ID = 'tp-site-menu';

/**
 * The site header: the vector lockup (home), then The club · Lessons · Café menu · Visit,
 * the theme, the green "Book a court" (WhatsApp, pre-filled, with the chat glyph and a
 * screen-reader cue that it opens WhatsApp; "Plan your visit" when the venue has no
 * usable phone), and the language as a pill with the globe at the inline end. Sticky; transparent while the home page
 * sits on its photo, solid with a hairline once it scrolls under content. Solid is also
 * the no-JS state. Never glass.
 *
 * Below 64rem the bar is the lockup and the menu toggle at the inline end; the links,
 * language and theme fold into a full-height sheet (SiteMenuToggle) with the links as big
 * display rows, each with its arrow, then a full-width green "Book a court" and the
 * language and theme as two labelled pills at the foot. The bar's own green button is
 * the desktop one (and the no-JS one); the sheet's twin shows only in the sheet. The
 * language has twins the same way: the bar's pill from 64rem, the sheet's below it.
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
                    <span>{link.label}</span>
                    <ArrowIcon className="tp-site-nav__arrow" />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <WhatsAppButton
            locale={locale}
            phone={phone}
            message={tr('site.whatsapp.court')}
            label={tr('site.nav.book')}
            cue={tr('site.onWhatsApp')}
            onHome={onHome}
            className="tp-site-btn tp-site-btn--go tp-site-btn--lg tp-site-menu__book"
          />
          <div className="tp-site-tools">
            <LanguageLink
              className="tp-site-nav__link tp-site-nav__lang"
              href={`/${other}${path ?? ''}`}
              target={other}
              label={tr('site.nav.languageLabel')}
              icon={<GlobeIcon />}
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
        <LanguageLink
          className="tp-site-header__lang"
          href={`/${other}${path ?? ''}`}
          target={other}
          label={tr('site.nav.languageLabel')}
          icon={<GlobeIcon />}
        >
          {tr('site.nav.language')}
        </LanguageLink>
      </div>
      <HeaderScrollState />
    </header>
  );
}
