'use client';

import { useCallback } from 'react';
import Image from 'next/image';
import { formatIQD, makeT, type Locale } from '@touch/i18n';
import { applyPctDiscountIqd } from '@touch/core';
import type { MenuItem } from '@/lib/menu';

/**
 * One menu row: photo, name, uppercase hook line, clamped description,
 * allergen chips and the price (struck list + promo price when the featured
 * discount applies).
 *
 * `data-highlight` paints the operator's blue/brown tint + inset ring,
 * `data-sold-out` slams the stamp on, `data-unavailable` greys an 86'd item.
 * A non-orderable row is NOT a button — it must not open a sheet whose CTA
 * would then be dead.
 *
 * Pointer-down WARMS the sheet's hero image (`fetchPriority` high on the same
 * URL), so the 4:3 image in the sheet is usually already decoded when the
 * sheet slides up.
 */
export function MenuCard({
  item,
  locale,
  onOpen,
}: {
  item: MenuItem;
  locale: Locale;
  onOpen(item: MenuItem): void;
}) {
  const tr = makeT(locale);
  const ar = locale === 'ar';
  const orderable = item.orderable && item.variants.length > 0;

  const warm = useCallback(() => {
    // NB: `Image` here is next/image — the browser constructor is window.Image.
    if (!item.photo_url || typeof window === 'undefined') return;
    const img = new window.Image();
    img.decoding = 'async';
    img.src = item.photo_url;
  }, [item.photo_url]);

  const from = item.variants.reduce(
    (min, v) => Math.min(min, v.price_iqd),
    Number.MAX_SAFE_INTEGER,
  );
  const hasPrice = from !== Number.MAX_SAFE_INTEGER;
  const hook = ar ? item.hook_ar : item.hook_en;
  const desc = ar ? item.description_ar : item.description_en;

  return (
    <article
      className="tp-menu-item"
      data-highlight={item.highlight !== 'none' ? item.highlight : undefined}
      data-sold-out={item.sold_out ? 'true' : undefined}
      data-unavailable={!orderable ? 'true' : undefined}
      role={orderable ? 'button' : undefined}
      tabIndex={orderable ? 0 : undefined}
      onPointerDown={orderable ? warm : undefined}
      onClick={orderable ? () => onOpen(item) : undefined}
      onKeyDown={
        orderable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(item);
              }
            }
          : undefined
      }
    >
      {item.photo_url && (
        <div className="tp-menu-item__photo">
          <Image
            src={item.photo_url}
            alt=""
            fill
            quality={40}
            sizes="112px"
            placeholder={item.photo_blur ? 'blur' : undefined}
            blurDataURL={item.photo_blur ?? undefined}
          />
        </div>
      )}
      <div className="tp-menu-item__body">
        <div className="tp-menu-item__name">{ar ? item.name_ar : item.name_en}</div>
        {hook && <div className="tp-menu-item__hook">{hook}</div>}
        {desc && <p className="tp-menu-item__desc">{desc}</p>}
        {(item.allergens.length > 0 || !orderable) && (
          <div className="tp-chips">
            {item.allergens.map((a) => (
              <span key={a.code} className="tp-chip">
                {ar ? a.label_ar : a.label_en}
              </span>
            ))}
            {!orderable && !item.sold_out && (
              <span className="tp-chip tp-chip--muted">{tr('cafe.unavailableShort')}</span>
            )}
          </div>
        )}
      </div>
      {hasPrice && (
        <div className="tp-menu-item__prices">
          {item.discountPct > 0 ? (
            <>
              <span className="tp-price--struck">{formatIQD(from, locale)}</span>
              <span className="tp-price--promo">
                {formatIQD(applyPctDiscountIqd(from, item.discountPct), locale)}
              </span>
            </>
          ) : (
            <span>{formatIQD(from, locale)}</span>
          )}
          {item.variants.length > 1 && (
            <div className="tp-menu-item__price-size">{tr('cafe.size')}</div>
          )}
        </div>
      )}
      {item.sold_out && <span className="tp-stamp">{tr('cafe.soldOut')}</span>}
    </article>
  );
}
