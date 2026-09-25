import { makeT, type Locale } from '@touch/i18n';
import { CallButton, WhatsAppButton } from '@/components/site/ContactButton';
import { StoreButtons } from '@/components/site/StoreButtons';
import type { StoreLinks } from '@/lib/site/stores';
import { AppScreens, type AppScreen } from './AppScreens';

/**
 * The app, in one band (owner, 2026-09-25, option E of the band study): "BOOKING IN THE
 * APP. / SOON.", the three things it will do as a list, and one phone showing the real
 * app screen for the one picked (Availability, Review and confirm with its hold timer,
 * My reservations), cut from the app's own store renders in the page's language. Then
 * how to book until it ships (WhatsApp, the desk) and both store badges, "Soon" until a
 * listing URL is set.
 */
export function AppBand({
  locale,
  stores,
  phone,
}: {
  locale: Locale;
  stores: StoreLinks;
  phone: string | null;
}) {
  const tr = makeT(locale);
  const screens: AppScreen[] = (
    [
      { key: 'live', shot: 'availability' },
      { key: 'hold', shot: 'hold' },
      { key: 'place', shot: 'reservations' },
    ] as const
  ).map(({ key, shot }) => ({
    key,
    eyebrow: tr(`site.app.${key}Eyebrow`),
    title: tr(`site.app.${key}Title`),
    alt: tr(`site.app.${key}Alt`),
    src: `/brand/app/${shot}-${locale}.webp`,
  }));

  return (
    <section className="tp-appband" aria-labelledby="app-title">
      <AppScreens
        screens={screens}
        head={
          <h2 id="app-title" className="tp-display tp-appband__title" data-reveal="">
            <span className="tp-display__l1">{tr('site.app.titleOne')}</span>{' '}
            <span className="tp-display__l2">{tr('site.app.titleTwo')}</span>
          </h2>
        }
        foot={
          <>
            <p className="tp-appband__body" data-reveal="">{tr('site.app.body')}</p>
            <div className="tp-appband__ctas" data-reveal="">
              <WhatsAppButton
                locale={locale}
                phone={phone}
                message={tr('site.whatsapp.court')}
                label={tr('site.hero.ctaWhatsApp')}
                onHome
                className="tp-site-btn tp-site-btn--go tp-site-btn--lg"
              />
              <CallButton
                phone={phone}
                label={tr('site.hero.ctaCall')}
                className="tp-site-btn tp-site-btn--blue tp-site-btn--lg"
              />
            </div>
            <StoreButtons locale={locale} links={stores} />
          </>
        }
      />
    </section>
  );
}
