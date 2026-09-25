import { makeT, type Locale } from '@touch/i18n';
import type { StoreLinks } from '@/lib/site/stores';

/**
 * App Store and Google Play: the official badge artwork, never redrawn (`/brand/stores/*`),
 * linking to the listing, for each store whose URL is set (a validated https URL on the
 * store's own host, lib/site/stores.ts). A store with no listing draws nothing, and with
 * neither the list is not rendered at all: the band's title already says "Soon".
 */
export function StoreButtons({ locale, links }: { locale: Locale; links: StoreLinks }) {
  const tr = makeT(locale);
  const stores = [
    {
      key: 'app-store',
      url: links.appStore,
      badge: `/brand/stores/app-store-${locale}.svg`,
      badgeAlt: tr('site.app.downloadOnAppStore'),
    },
    {
      key: 'google-play',
      url: links.googlePlay,
      badge: `/brand/stores/google-play-${locale}.png`,
      badgeAlt: tr('site.app.getItOnGooglePlay'),
    },
  ].flatMap(({ url, ...store }) => (url ? [{ ...store, url }] : []));
  if (stores.length === 0) return null;

  return (
    <ul className="tp-stores">
      {stores.map((store) => (
        <li key={store.key}>
          <a className={`tp-store tp-store--${store.key}`} href={store.url}>
            {/* A static, self-hosted badge at its natural size: next/image would add a
                loader and re-encode vendor artwork that must stay untouched. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={store.badge} alt={store.badgeAlt} className="tp-store__badge" />
          </a>
        </li>
      ))}
    </ul>
  );
}
