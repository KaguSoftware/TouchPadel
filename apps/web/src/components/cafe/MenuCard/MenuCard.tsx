'use client';

import { useCallback } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { applyPctDiscountIqd } from '@touch/core';
import type { MenuItem } from '@/lib/menu';
import { TempChips } from '../TempChips';
import { priceLayout } from './sizeColumns';

/**
 * The design prints bare numerals in the price columns - no currency mark and no
 * thousands separator - because the whole menu is in IQD and the columns are
 * 46 px wide. `formatIQD` is still what prices the basket, the sheet and every
 * total, where the unit does have to be stated.
 */
const menuPrice = (iqd: number): string => String(iqd);

/** Names with no Arabic in them (V60, Kit Kat) keep the Latin face on the Arabic page. */
const ARABIC = /[؀-ۿ]/;

/**
 * One menu row, as the design lists it: the name, its serve-temperature chips,
 * an optional small note, then the price cells lined up under the section's
 * size headers.
 *
 * The design carries no thumbnail here - the photo lives in the sheet this row
 * opens, and pointer-down warms it so it is usually decoded by the time the
 * sheet slides up.
 *
 * `data-highlight` paints the operator's blue/green tint + inset ring,
 * `data-sold-out` slams the stamp on, `data-unavailable` greys an 86'd item.
 * A non-orderable row is NOT a button - it must not open a sheet whose CTA
 * would then be dead.
 */
export function MenuCard({
  item,
  locale,
  columns,
  onOpen,
}: {
  item: MenuItem;
  locale: Locale;
  /** the section's size headers; [] when the category prices a single size */
  columns: string[];
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
  const layout = priceLayout(item, columns);
  const discount = item.discountPct;

  /** A price cell: promo price over the struck list price when a promo applies. */
  const cell = (value: number | null, tier: 'base' | 'top', key: string) => (
    <div className="tp-menu-item__price" data-tier={tier} key={key}>
      {value === null ? null : discount > 0 ? (
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
      data-cols={layout?.kind === 'columns' ? columns.length : 1}
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
      <div className="tp-menu-item__body">
        <div className="tp-menu-item__head">
          <span className="tp-menu-item__name" data-latin={ARABIC.test(name) ? undefined : 'true'}>
            {name}
          </span>
          <TempChips temp={item.serve_temp} locale={locale} />
          {!orderable && !item.sold_out && (
            <span className="tp-temp tp-temp--cold">{tr('cafe.unavailableShort')}</span>
          )}
        </div>
        {hook && <div className="tp-menu-item__hook">{hook}</div>}
        {/* Sizes outside the section grid print inline, as espresso does. */}
        {layout?.kind === 'inline' && (
          <div className="tp-menu-item__desc">
            {layout.parts.map((p) => `${p.label} ${menuPrice(p.price)}`).join(' · ')}
          </div>
        )}
        {desc && <div className="tp-menu-item__desc">{desc}</div>}
      </div>

      {layout?.kind === 'columns' &&
        layout.cells.map((value, i) =>
          cell(value, i === layout.cells.length - 1 ? 'top' : 'base', columns[i] ?? String(i)),
        )}
      {layout?.kind === 'single' && cell(layout.price, 'top', 'single')}

      {item.sold_out && <span className="tp-stamp">{tr('cafe.soldOut')}</span>}
    </article>
  );
}
