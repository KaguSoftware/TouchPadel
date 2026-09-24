import { makeT, type Locale } from '@touch/i18n';
import type { StoreLinks } from '@/lib/site/stores';

/**
 * App Store and Google Play.
 *
 * UNSET (today: the app is on neither store): a "coming soon" button per store. Not a
 * link, because there is nowhere to go; a real `<button>` with `aria-disabled`, so it
 * stays in the tab order and a screen reader hears "App Store, coming soon, dimmed"
 * instead of skipping it. Typed store names only: an Apple or Google mark may only
 * appear as the official badge, and only when it links to the real listing.
 *
 * SET (a validated https URL on the store's own host, lib/site/stores.ts): the official
 * badge artwork, never redrawn (`/brand/stores/*`, Lane D), linking to the listing.
 */
export function StoreButtons({ locale, links }: { locale: Locale; links: StoreLinks }) {
  const tr = makeT(locale);
  const stores = [
    {
      key: 'app-store',
      name: tr('site.app.appStore'),
      url: links.appStore,
      badge: `/brand/stores/app-store-${locale}.svg`,
      badgeAlt: tr('site.app.downloadOnAppStore'),
    },
    {
      key: 'google-play',
      name: tr('site.app.googlePlay'),
      url: links.googlePlay,
      badge: `/brand/stores/google-play-${locale}.png`,
      badgeAlt: tr('site.app.getItOnGooglePlay'),
    },
  ] as const;

  return (
    <ul className="tp-stores">
      {stores.map((store) => (
        <li key={store.key}>
          {store.url ? (
            <a className={`tp-store tp-store--live tp-store--${store.key}`} href={store.url}>
              {/* A static, self-hosted badge at its natural size: next/image would add
                  a loader and re-encode vendor artwork that must stay untouched. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={store.badge} alt={store.badgeAlt} className="tp-store__badge" />
            </a>
          ) : (
            <button
              type="button"
              className="tp-store tp-store--soon"
              aria-disabled="true"
              aria-label={tr('site.app.comingSoonLabel', { store: store.name })}
            >
              <span className="tp-store__soon">{tr('site.app.comingSoon')}</span>
              <span className="tp-store__name" lang="en" dir="ltr">
                {store.name}
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
