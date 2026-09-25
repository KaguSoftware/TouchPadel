import { makeT, type Locale } from '@touch/i18n';
import type { StoreLinks } from '@/lib/site/stores';

/**
 * App Store and Google Play: the official badge artwork, never redrawn (`/brand/stores/*`).
 * A store whose URL is set (a validated https URL on the store's own host,
 * lib/site/stores.ts) links to its listing. A store with no listing yet still shows its
 * badge, dimmed, tagged "Soon" and NOT a link (owner, 2026-09-25: the app band shows
 * both stores from day one), so setting the env var is all it takes to switch it on.
 */
export function StoreButtons({ locale, links }: { locale: Locale; links: StoreLinks }) {
  const tr = makeT(locale);
  const stores = [
    {
      key: 'app-store',
      url: links.appStore,
      badge: `/brand/stores/app-store-${locale}.svg`,
      badgeAlt: tr('site.app.downloadOnAppStore'),
      soonAlt: tr('site.app.appStoreSoon'),
    },
    {
      key: 'google-play',
      url: links.googlePlay,
      badge: `/brand/stores/google-play-${locale}.png`,
      badgeAlt: tr('site.app.getItOnGooglePlay'),
      soonAlt: tr('site.app.googlePlaySoon'),
    },
  ];

  return (
    <ul className="tp-stores" data-reveal="">
      {stores.map((store) => (
        <li key={store.key}>
          {store.url ? (
            <a className={`tp-store tp-store--${store.key}`} href={store.url}>
              {/* A static, self-hosted badge at its natural size: next/image would add a
                  loader and re-encode vendor artwork that must stay untouched. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={store.badge} alt={store.badgeAlt} className="tp-store__badge" />
            </a>
          ) : (
            <span className={`tp-store tp-store--${store.key} tp-store--soon`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={store.badge} alt={store.soonAlt} className="tp-store__badge" />
              <span className="tp-store__soon" aria-hidden="true">
                {tr('site.app.soon')}
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
