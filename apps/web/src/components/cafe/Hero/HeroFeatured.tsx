'use client';

import Image from 'next/image';
import { formatIQD, makeT, type Locale } from '@touch/i18n';
import { applyPctDiscountIqd } from '@touch/core';
import type { CafeSettings, MenuItem } from '@/lib/menu';

/**
 * Hero mode `featured` — one item promoted with an operator label, a badge
 * pill and (optionally) a percentage discount. Tapping opens the item sheet
 * with `source: 'featured'` so the funnel can be measured.
 *
 * The discount shown here is the SAME integer the server stamps
 * (`applyPctDiscountIqd`, mirrored from 0030) and applies to the variant base
 * price only — modifiers are never discounted.
 */
export function HeroFeatured({
  locale,
  item,
  settings,
  onOpen,
}: {
  locale: Locale;
  item: MenuItem;
  settings: CafeSettings;
  onOpen(item: MenuItem): void;
}) {
  const tr = makeT(locale);
  const ar = locale === 'ar';
  const label = (ar ? settings.featured_label_ar : settings.featured_label_en).trim();
  const badge = (ar ? settings.featured_badge_ar : settings.featured_badge_en).trim();
  const pct = item.discountPct;
  const from = item.variants.reduce(
    (min, v) => Math.min(min, v.price_iqd),
    Number.MAX_SAFE_INTEGER,
  );
  const hasPrice = from !== Number.MAX_SAFE_INTEGER;
  const name = ar ? item.name_ar : item.name_en;

  return (
    <button type="button" className="tp-hero__featured" onClick={() => onOpen(item)}>
      {item.photo_url && (
        <span className="tp-hero__featured-photo">
          <Image
            src={item.photo_url}
            alt=""
            fill
            priority
            quality={75}
            sizes="(min-width: 640px) 44rem, 100vw"
            placeholder={item.photo_blur ? 'blur' : undefined}
            blurDataURL={item.photo_blur ?? undefined}
          />
        </span>
      )}
      <span className="tp-hero__badge">{badge || tr('cafe.hero.featured')}</span>
      {pct > 0 && (
        <span className="tp-hero__discount">{tr('cafe.hero.discountBadge', { pct })}</span>
      )}
      <span className="tp-hero__featured-body">
        <span className="tp-hero__featured-name">{name}</span>
        {hasPrice && (
          <span className="tp-hero__featured-price">
            {pct > 0 ? (
              <>
                <span className="tp-price--struck">{formatIQD(from, locale)}</span>
                <span className="tp-price--promo">
                  {formatIQD(applyPctDiscountIqd(from, pct), locale)}
                </span>
              </>
            ) : (
              formatIQD(from, locale)
            )}
          </span>
        )}
      </span>
      {label && (
        <span className="tp-hero__marquee" aria-hidden="true">
          <span className="tp-hero__marquee-track">
            {[0, 1, 2].map((i) => (
              <span className="tp-hero__marquee-item" key={i}>
                {label}
              </span>
            ))}
          </span>
        </span>
      )}
      {label && <span className="tp-visually-hidden">{label}</span>}
    </button>
  );
}
