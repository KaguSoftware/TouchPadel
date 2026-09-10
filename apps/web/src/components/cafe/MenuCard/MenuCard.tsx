'use client';

import { useCallback } from 'react';
import Image from 'next/image';
import { makeT, type Locale } from '@touch/i18n';
import { applyPctDiscountIqd } from '@touch/core';
import type { MenuItem } from '@/lib/menu';
import { TempChips } from '../TempChips';
import { CategoryIcon, type SectionArt } from '../MenuStage/sectionArt';
import { rowPrice } from './rowPrice';

/**
 * The design prints bare numerals in the price column - no currency mark and no
 * thousands separator - because the whole menu is in IQD and the column is
 * narrow. `formatIQD` is still what prices the basket, the sheet and every
 * total, where the unit does have to be stated.
 */
const menuPrice = (iqd: number): string => String(iqd);

/** Names with no Arabic in them (V60, Kit Kat) keep the Latin face on the Arabic page. */
const ARABIC = /[؀-ۿ]/;

/**
 * One menu row, as the design lists it: the name and an optional small note,
 * then the serve-temperature chips and the row's single price. The menu sells
 * one size per item, so there is exactly one price cell, and it is a fixed
 * width at the end of the row — every price in the section lines up vertically
 * however long the names beside them run. The chips sit in a fixed column of
 * their own rather than trailing the name, for the same reason.
 *
 * The row leads with a thumbnail: the item's own photo when it has one, and
 * otherwise the section's icon on the band's tint - a category-true placeholder
 * for the whole menu until the photography exists, rather than an empty frame.
 * The full photo still lives in the sheet this row opens, and pointer-down
 * warms it so it is usually decoded by the time the sheet slides up.
 *
 * `data-highlight` paints the operator's blue/green tint + inset ring,
 * `data-sold-out` slams the stamp on, `data-unavailable` greys an 86'd item.
 * A non-orderable row is NOT a button - it must not open a sheet whose CTA
 * would then be dead.
 */
export function MenuCard({
  item,
  locale,
  art,
  onOpen,
}: {
  item: MenuItem;
  locale: Locale;
  /** the section's art — its icon stands in for a missing item photo */
  art?: SectionArt;
  onOpen(item: MenuItem): void;
}) {
  const tr = makeT(locale);
  const ar = locale === 'ar';
  const orderable = item.orderable && item.variants.length > 0;

  const warm = useCallback(() => {
    // NB: the browser constructor is window.Image, not next/image.
    if (!item.photo_url || typeof window === 'undefined') return;
    const img = new window.Image();
    img.decoding = 'async';
    img.src = item.photo_url;
  }, [item.photo_url]);

  const name = ar ? item.name_ar : item.name_en;
  const desc = ar ? item.description_ar : item.description_en;
  const hook = ar ? item.hook_ar : item.hook_en;
  const price = rowPrice(item);
  const discount = item.discountPct;

  /**
   * The row's price cell: the promo price over the struck list price when a
   * promo applies. The two stack rather than sit side by side, so a discounted
   * row keeps the same column width as every other row in the section.
   */
  const priceCell = (value: number) => (
    <div className="tp-menu-item__price">
      {discount > 0 ? (
        <>
          <span className="tp-price--promo">
            {menuPrice(applyPctDiscountIqd(value, discount))}
          </span>
          <span className="tp-price--struck">{menuPrice(value)}</span>
        </>
      ) : (
        menuPrice(value)
      )}
    </div>
  );

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
      {/* A category the design draws no icon for (an operator's own) and an item
          with no photo have nothing to put here — that section keeps the
          design's text-only rows rather than printing an empty frame. */}
      {(item.photo_url || art) && (
        <div className="tp-menu-item__thumb" data-tone={art?.tone ?? 'blue'}>
          {item.photo_url ? (
            <Image src={item.photo_url} alt="" width={66} height={66} quality={55} sizes="66px" />
          ) : (
            <CategoryIcon art={art} className="tp-menu-item__thumb-icon" />
          )}
        </div>
      )}

      <div className="tp-menu-item__body">
        <div className="tp-menu-item__head">
          <span className="tp-menu-item__name" data-latin={ARABIC.test(name) ? undefined : 'true'}>
            {name}
          </span>
          {!orderable && !item.sold_out && (
            <span className="tp-temp tp-temp--cold">{tr('cafe.unavailableShort')}</span>
          )}
        </div>
        {hook && <div className="tp-menu-item__hook">{hook}</div>}
        {/* The description belongs to the item's own sheet, so the row stays a
            name and a price however much prose an item carries. A row that
            cannot open one (not orderable — see above) keeps it inline, or the
            text would have nowhere left to appear. */}
        {desc && !orderable && <div className="tp-menu-item__desc">{desc}</div>}
      </div>

      {/* The serve-temp chips ride in their own column just before the price,
          so they line up down the whole section however long the names run
          (the design stacks حار over بارد rather than trailing the name). */}
      {item.serve_temp !== 'none' && (
        <div className="tp-menu-item__temps">
          <TempChips temp={item.serve_temp} locale={locale} />
        </div>
      )}

      {price !== null && priceCell(price)}

      {item.sold_out && <span className="tp-stamp">{tr('cafe.soldOut')}</span>}
    </article>
  );
}
